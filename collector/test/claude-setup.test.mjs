// Claude Code's own setup, read for the ⚙ Claude Code dialog: plugins, skills, MCP servers, permission rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMcpList, parsePluginDetails, projectServersOf, readOwnSkills, readRules, removeRule, tokensOf } from '../sources/claude-setup.mjs';

// What `claude plugin details <name>` printed for real (shortened).
const DETAILS = `marketing 1.2.0
  Description: Create content, plan campaigns, and analyze performance across marketing channels.
  Source: marketing@synced

Component inventory
  Skills (3)  brand-review, campaign-plan, seo-audit
  Agents (0)
  Hooks (1)  SessionStart  (harness-only — no model context cost)
  MCP servers (2)  slack, google calendar  (tool schemas resolved at runtime; not counted)
  LSP servers (0)

Projected token cost
  Always-on:   ~2,843 tok   added to every session

Per-component (rounded)
  component                     always-on  on-invoke
  brand-review                        ~70      ~6.3k
  campaign-plan                       ~60        ~4k
  seo-audit                           ~20       ~960
`;

test("a plugin's details: what it holds, and what it costs in context", () => {
  assert.deepEqual(parsePluginDetails(DETAILS), {
    description: 'Create content, plan campaigns, and analyze performance across marketing channels.',
    inventory: { skills: ['brand-review', 'campaign-plan', 'seo-audit'], agents: [], hooks: ['SessionStart'], mcpServers: ['slack', 'google calendar'], lspServers: [] },
    alwaysOn: 2843,
    components: [{ name: 'brand-review', alwaysOn: 70, onInvoke: 6300 }, { name: 'campaign-plan', alwaysOn: 60, onInvoke: 4000 }, { name: 'seo-audit', alwaysOn: 20, onInvoke: 960 }],
  });
  assert.deepEqual(parsePluginDetails('nonsense'), { description: '', inventory: { skills: [], agents: [], hooks: [], mcpServers: [], lspServers: [] }, alwaysOn: null, components: [] });
  assert.deepEqual(['~840', '~2,843', '~2.4k', '~4k', '—', ''].map(tokensOf), [840, 2843, 2400, 4000, null, null]);
});

test('MCP servers as `claude mcp list` checks them: who provides each, how it is, and never a secret from its command or URL', () => {
  const text = `Checking MCP server health…

claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication
plugin:design:google calendar:  (HTTP) - - Not configured
magic: npx -y @21st-dev/magic@latest --api-key=abc123 - ✘ Failed to connect — -32001: Not authenticated - your API key is missing
playwright: npx @playwright/mcp --cdp-endpoint http://localhost:9222 - ✔ Connected
notes: https://mcp.example.com/mcp?token=s3cret (HTTP) - ✔ Connected
`;
  assert.deepEqual(parseMcpList(text), [
    { name: 'claude.ai Gmail', where: 'gmailmcp.googleapis.com', status: 'connected', statusText: 'Connected', detail: '', group: 'connector' },
    { name: 'plugin:design:slack', where: 'mcp.slack.com', status: 'auth', statusText: 'Needs authentication', detail: '', group: 'plugin', plugin: 'design', server: 'slack' },
    { name: 'plugin:design:google calendar', where: '', status: 'off', statusText: 'Not configured', detail: '', group: 'plugin', plugin: 'design', server: 'google calendar' },
    { name: 'magic', where: 'npx @21st-dev/magic@latest', status: 'failed', statusText: 'Failed to connect', detail: '-32001: Not authenticated - your API key is missing', group: 'yours' },
    { name: 'playwright', where: 'npx @playwright/mcp', status: 'connected', statusText: 'Connected', detail: '', group: 'yours' },
    { name: 'notes', where: 'mcp.example.com', status: 'connected', statusText: 'Connected', detail: '', group: 'yours' },
  ]);
});

test("each project's own MCP servers, from Claude Code's config", () => {
  const config = { mcpServers: { magic: {} }, projects: { '/h/a': { mcpServers: { rive: {}, stitch: {} } }, '/h/b': {}, '/h/c': { mcpServers: {} } } };
  assert.deepEqual(projectServersOf(config), [{ project: '/h/a', names: ['rive', 'stitch'] }]);
  assert.deepEqual(projectServersOf(null), []);
});

test('your own skills: name, what they do, and roughly what one costs when used', () => {
  const home = mkdtempSync(join(tmpdir(), 'tracker-skills-'));
  const skill = (dir, text) => { mkdirSync(join(home, '.claude', 'skills', dir), { recursive: true }); writeFileSync(join(home, '.claude', 'skills', dir, 'SKILL.md'), text); };
  const long = `---\nname: report-writing\ndescription: "Write a report: findings first"\n---\n${'x'.repeat(4000)}`;
  skill('report-writing', long);
  skill('loose', 'No front matter at all');
  mkdirSync(join(home, '.claude', 'skills', 'empty-folder'));
  assert.deepEqual(readOwnSkills(home).map(s => ({ ...s, path: s.path.replace(home, '~') })), [
    { name: 'loose', description: '', path: '~/.claude/skills/loose/SKILL.md', tokens: 6 },
    { name: 'report-writing', description: 'Write a report: findings first', path: '~/.claude/skills/report-writing/SKILL.md', tokens: Math.round(long.length / 4) }, // about 4 characters a token
  ]);
  assert.deepEqual(readOwnSkills('/nonexistent'), []);
});

test('permission rules are read from settings files, and one is removed leaving the rest of the file as it was', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-rules-'));
  const file = join(dir, 'settings.local.json');
  writeFileSync(file, `${JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(npm test:*)', 'Read'], deny: ['Bash(rm -rf:*)'], additionalDirectories: ['/Users/me'] }, env: { A: '1' } }, null, 2)}\n`);
  const rules = readRules([{ path: file, label: 'app, just you' }, { path: join(dir, 'missing.json'), label: 'none' }]);
  assert.deepEqual(rules, [{ path: file, label: 'app, just you', allow: ['Bash(npm test:*)', 'Read'], ask: [], deny: ['Bash(rm -rf:*)'], additionalDirectories: ['/Users/me'] }]);
  assert.deepEqual(removeRule(file, 'allow', 'Read'), { ok: true });
  assert.deepEqual(removeRule(file, 'additionalDirectories', '/Users/me'), { ok: true });
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(after, { model: 'opus', permissions: { allow: ['Bash(npm test:*)'], deny: ['Bash(rm -rf:*)'], additionalDirectories: [] }, env: { A: '1' } });
  assert.match(readFileSync(file, 'utf8'), /^\{\n {2}"model"[\s\S]*\}\n$/, 'two-space indents and a final newline, as Claude Code writes it');
  assert.match(removeRule(file, 'allow', 'Read').error, /no longer there/);
  assert.match(removeRule(file, 'nonsense', 'x').error, /not a list/);
  assert.match(removeRule(join(dir, 'missing.json'), 'allow', 'x').error, /could not read/i);
});
