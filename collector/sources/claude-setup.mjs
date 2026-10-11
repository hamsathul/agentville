import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replaceFile } from '../platform/replace.mjs';

// Claude Code's own setup, for the ⚙ Claude Code dialog: what `claude plugin details` and `claude
// mcp list` print (neither has a JSON form), your own skills, each project's MCP servers from
// ~/.claude.json, and the permission rules in settings files, one of which can be removed.

/** A token count as Claude Code prints it: ~840, ~2,843, ~2.4k, ~4k; null for anything else. */
export function tokensOf(text) {
  const m = String(text ?? '').trim().match(/^~?([\d,.]+)(k?)$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * (m[2] ? 1000 : 1)) : null;
}

const INVENTORY = { Skills: 'skills', Agents: 'agents', Hooks: 'hooks', 'MCP servers': 'mcpServers', 'LSP servers': 'lspServers' };

/** `claude plugin details <name>`: what the plugin holds and what it costs in context. */
export function parsePluginDetails(text) {
  const out = { description: '', inventory: { skills: [], agents: [], hooks: [], mcpServers: [], lspServers: [] }, alwaysOn: null, components: [] };
  let inTable = false;
  for (const line of String(text ?? '').split('\n')) {
    const description = line.match(/^\s+Description:\s*(.*)$/);
    if (description) { out.description = description[1].trim(); continue; }
    const part = line.match(/^\s+(Skills|Agents|Hooks|MCP servers|LSP servers) \(\d+\)\s*(.*)$/);
    if (part) {
      const names = part[2].replace(/\s*\([^)]*\)\s*$/, '').trim(); // without Claude Code's note after them: (harness-only…), (tool schemas…)
      out.inventory[INVENTORY[part[1]]] = names ? names.split(/,\s*|\s{2,}/).map(n => n.trim()).filter(Boolean) : [];
      continue;
    }
    const always = line.match(/^\s+Always-on:\s+(\S+)\s+tok/);
    if (always) { out.alwaysOn = tokensOf(always[1]); continue; }
    if (/^\s+component\s+always-on\s+on-invoke/.test(line)) { inTable = true; continue; }
    const row = inTable && line.match(/^\s+(\S.*?)\s{2,}(\S+)\s+(\S+)\s*$/);
    if (row) out.components.push({ name: row[1], alwaysOn: tokensOf(row[2]), onInvoke: tokensOf(row[3]) });
    else if (inTable && line.trim()) inTable = false;
  }
  return out;
}

const STATUS = { '✔': 'connected', '!': 'auth', '✘': 'failed', '✗': 'failed', '-': 'off' };

/**
 * Where a server is, safe to show: a URL's host, or a command and the first thing it runs. A full
 * command line or URL can carry an API key or a token, so neither is ever kept.
 */
function whereOf(target) {
  const url = target.trim().match(/^https?:\/\/[^\s)]+/)?.[0]; // a remote server; a command may have a URL among its arguments
  if (url) { try { return new URL(url).host; } catch { return ''; } }
  const words = target.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  const first = words.slice(1).find(w => !w.startsWith('-'));
  return [words[0], first].filter(Boolean).join(' ').slice(0, 80);
}

/** `claude mcp list`: each server, who provides it (a claude.ai connector, a plugin, or you), and how it is. */
export function parseMcpList(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^(.+?): (.*) - ([✔!✘✗-]) (.+)$/);
    if (!m) continue;
    const name = m[1].trim(), plugin = name.match(/^plugin:([^:]+):(.+)$/);
    const [statusText, ...detail] = m[4].split(' — ');
    out.push({
      name, where: whereOf(m[2]), status: STATUS[m[3]], statusText: statusText.trim(), detail: detail.join(' — ').trim().slice(0, 300),
      group: name.startsWith('claude.ai ') ? 'connector' : plugin ? 'plugin' : 'yours',
      ...(plugin ? { plugin: plugin[1], server: plugin[2] } : {}),
    });
  }
  return out;
}

/** The MCP servers each project has of its own (local scope), from ~/.claude.json. */
export function projectServersOf(claudeJson) {
  return Object.entries(claudeJson?.projects ?? {})
    .map(([project, p]) => ({ project, names: Object.keys(p?.mcpServers ?? {}).sort() }))
    .filter(p => p.names.length);
}

/** Your own skills (~/.claude/skills/<name>/SKILL.md): name, description, and about what one costs when used. */
export function readOwnSkills(home) {
  const dir = join(home, '.claude', 'skills');
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const folder of names) {
    const path = join(dir, folder, 'SKILL.md');
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    const field = key => front.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
    out.push({ name: field('name') || folder, description: field('description'), path, tokens: Math.round(text.length / 4) }); // about 4 characters a token
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const LISTS = ['allow', 'ask', 'deny', 'additionalDirectories'];

/** The permission rules (and extra folders) in each settings file that exists: [{ path, label, allow, ask, deny, additionalDirectories }]. */
export function readRules(files) {
  const out = [];
  for (const { path, label } of files) {
    let settings;
    try { settings = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    const p = settings?.permissions ?? {};
    const list = key => (Array.isArray(p[key]) ? p[key].filter(r => typeof r === 'string') : []);
    out.push({ path, label, allow: list('allow'), ask: list('ask'), deny: list('deny'), additionalDirectories: list('additionalDirectories') });
  }
  return out;
}

/**
 * Removes one rule (or folder) from a settings file, leaving everything else in it as it was. The
 * file is written whole (temp file, then rename), with two-space indents, as Claude Code writes it.
 */
export function removeRule(path, list, value) {
  if (!LISTS.includes(list)) return { error: `${list} is not a list of rules.` };
  let text, settings;
  try {
    text = readFileSync(path, 'utf8');
    settings = JSON.parse(text);
  } catch (err) {
    return { error: `Could not read ${path}: ${err.message}` };
  }
  const rules = settings?.permissions?.[list];
  const at = Array.isArray(rules) ? rules.indexOf(value) : -1;
  if (at === -1) return { error: 'That rule is no longer there.' };
  rules.splice(at, 1);
  const indent = text.match(/^\{\n( +)"/)?.[1].length ?? 2;
  const tmp = `${path}.agentville-${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, indent)}\n`, { mode: statSync(path).mode });
  replaceFile(tmp, path);
  return { ok: true };
}
