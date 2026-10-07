import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

// What a session remembers, for the explorer's Memory section: the CLAUDE.md files Claude Code
// loads for it, the project's auto memory, and (once the conversation was compacted) the summary
// it carries forward. Plus where its scratchpad lives.
const isFile = path => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

/** [{ path, label, where }]: global CLAUDE.md, parent folders' and the project's, then auto memory. */
export function memoryFiles({ cwd, home, claudeDir, transcriptPath }) {
  const out = [];
  const add = (path, label, where) => {
    if (isFile(path) && !out.some(o => o.path === path)) out.push({ path, label, where });
  };
  const short = p => (p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
  add(join(claudeDir, 'CLAUDE.md'), 'CLAUDE.md', 'all projects');
  if (cwd) {
    const parents = [];
    for (let d = dirname(cwd); ; d = dirname(d)) {
      parents.unshift(d);
      if (d === home || d === dirname(d)) break;
    }
    for (const d of parents) {
      add(join(d, 'CLAUDE.md'), 'CLAUDE.md', short(d));
      add(join(d, 'CLAUDE.local.md'), 'CLAUDE.local.md', short(d));
    }
    add(join(cwd, 'CLAUDE.md'), 'CLAUDE.md', 'this project');
    add(join(cwd, 'CLAUDE.local.md'), 'CLAUDE.local.md', 'this project');
    add(join(cwd, '.claude', 'CLAUDE.md'), 'CLAUDE.md', 'this project · .claude');
  }
  if (transcriptPath) {
    const dir = join(dirname(transcriptPath), 'memory');
    let names = [];
    try {
      names = readdirSync(dir).filter(n => n.endsWith('.md'));
    } catch {
      // no auto memory for this project
    }
    names.sort((a, b) => (a === 'MEMORY.md' ? -1 : b === 'MEMORY.md' ? 1 : a.localeCompare(b)));
    for (const name of names) add(join(dir, name), name, 'auto memory');
  }
  return out;
}

/** The newest compaction summary in a transcript: what the session carries of its earlier conversation. */
export function compactSummary(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"isCompactSummary":true')) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.isCompactSummary !== true) continue;
    const c = entry.message?.content;
    const body = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';
    return { text: body, at: Date.parse(entry.timestamp) || 0 };
  }
  return null;
}

/**
 * A session's scratchpad: <base>/<project slug>/<sessionId>/scratchpad, found by the session id.
 * A session resumed in another folder has one per folder: the current folder's wins, else the newest.
 */
export function scratchpadOf(sessionId, base, cwd = '') {
  if (!SESSION_ID.test(sessionId ?? '')) return null;
  let slugs;
  try {
    slugs = readdirSync(base);
  } catch {
    return null;
  }
  const found = [];
  for (const slug of slugs) {
    const dir = join(base, slug, sessionId, 'scratchpad');
    try {
      const st = statSync(dir);
      if (st.isDirectory()) found.push({ dir, slug, at: st.mtimeMs });
    } catch {
      // not this project
    }
  }
  const mine = cwd ? found.find(f => f.slug === cwd.replace(/[^A-Za-z0-9]/g, '-')) : null;
  return mine?.dir ?? found.sort((a, b) => b.at - a.at)[0]?.dir ?? null;
}
