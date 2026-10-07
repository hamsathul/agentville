// Past sessions to resume, read from ~/.claude/projects, and the terminal window that starts one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCommand, closeTerminalScript, listSessions, projectsOf, terminalScript } from '../sources/sessions.mjs';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const DAY = 86_400_000;
const ID = n => `0000000${n}-aaaa-4bbb-8ccc-${String(n).padStart(12, '0')}`;
const iso = ms => new Date(ms).toISOString();
const user = (ms, text, origin = { kind: 'human' }, cwd = '/code/app') => JSON.stringify({ type: 'user', timestamp: iso(ms), cwd, origin, message: { role: 'user', content: text } });
const said = (ms, text) => JSON.stringify({ type: 'assistant', timestamp: iso(ms), cwd: '/code/app', message: { model: 'm', content: [{ type: 'text', text }] } });
const titled = text => JSON.stringify({ type: 'ai-title', aiTitle: text });

function fixture() {
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-sessions-'));
  const put = (dir, name, lines, ageMs) => {
    mkdirSync(join(claudeDir, 'projects', dir), { recursive: true });
    const file = join(claudeDir, 'projects', dir, name);
    writeFileSync(file, `${lines.join('\n')}\n`);
    utimesSync(file, new Date(NOW - ageMs), new Date(NOW - ageMs));
  };
  put('-code-app', `${ID(1)}.jsonl`, [user(NOW - DAY, 'Plan the release'), said(NOW - DAY + 1000, 'Here is the plan'), titled('Release planning'), user(NOW - DAY + 2000, 'Ship it on Friday')], DAY);
  // a long one: its title and last message are near the end, past what is read from the start
  put('-code-api', `${ID(2)}.jsonl`, [user(NOW - 2 * DAY, 'Fix the login bug', { kind: 'human' }, '/code/api'), ...Array.from({ length: 3000 }, (_, i) => said(NOW - 2 * DAY + i, `step ${i} ${'x'.repeat(200)}`)), titled('Login bug fix'), user(NOW - DAY, 'sent from the dashboard', { kind: 'plugin', name: 'agent-tracker', asUser: true }, '/code/api')], 2 * 60_000);
  put('-code-app', `${ID(3)}.jsonl`, [JSON.stringify({ type: 'summary', summary: 'nothing said' })], 60_000); // no prompt: not offered
  put('-code-old', `${ID(4)}.jsonl`, [user(NOW - 90 * DAY, 'ancient', { kind: 'human' }, '/code/old')], 90 * DAY); // too old
  put('-code-app', 'not-a-session.jsonl', [user(NOW, 'x')], 0);
  put(`-code-app/${ID(1)}/subagents`, 'agent-1.jsonl', [user(NOW, 'subagent work')], 0);
  return claudeDir;
}

test('past sessions come newest first with their folder, title and last message', () => {
  const sessions = listSessions({ claudeDir: fixture(), now: NOW });
  assert.deepEqual(sessions.map(s => [s.id, s.cwd, s.title, s.lastPrompt]), [
    [ID(2), '/code/api', 'Login bug fix', 'sent from the dashboard'],
    [ID(1), '/code/app', 'Release planning', 'Ship it on Friday'],
  ]);
  assert.equal(sessions[1].firstPrompt, 'Plan the release');
  assert.equal(sessions[0].at, NOW - 2 * 60_000);
});

test('a file read before is not read again while it is unchanged', () => {
  const claudeDir = fixture();
  const cache = new Map();
  listSessions({ claudeDir, now: NOW, cache });
  const first = cache.size;
  for (const v of cache.values()) v.info = { ...v.info, title: 'from the cache' };
  const again = listSessions({ claudeDir, now: NOW, cache });
  assert.equal(cache.size, first);
  assert.ok(again.every(s => s.title === 'from the cache'));
});

test('projects are the folders sessions ran in, newest first, one each', () => {
  const projects = projectsOf([{ cwd: '/code/api', at: 5 }, { cwd: '/code/app', at: 4 }, { cwd: '/code/api', at: 3 }, { cwd: '/', at: 9 }, { cwd: null, at: 9 }]);
  assert.deepEqual(projects, [{ cwd: '/code/api', name: 'api', at: 5, sessions: 2 }, { cwd: '/code/app', name: 'app', at: 4, sessions: 1 }]);
});

test('the command cds into the folder (quoted) and starts or resumes claude in its place, so the window closes when it ends', () => {
  assert.equal(claudeCommand('/code/my app'), "cd '/code/my app' && exec claude");
  assert.equal(claudeCommand("/code/it's", ID(1)), `cd '/code/it'\\''s' && exec claude --resume ${ID(1)}`);
  assert.throws(() => claudeCommand('/code/app', 'x; rm -rf ~'));
});

test('a permission mode goes on the command line; bypass is the dangerous flag', () => {
  assert.equal(claudeCommand('/code/app', undefined, 'plan'), "cd '/code/app' && exec claude --permission-mode plan");
  assert.equal(claudeCommand('/code/app', ID(2), 'acceptEdits'), `cd '/code/app' && exec claude --resume ${ID(2)} --permission-mode acceptEdits`);
  assert.equal(claudeCommand('/code/app', undefined, 'auto'), "cd '/code/app' && exec claude --permission-mode auto");
  assert.equal(claudeCommand('/code/app', undefined, 'bypassPermissions'), "cd '/code/app' && exec claude --dangerously-skip-permissions");
  assert.equal(claudeCommand('/code/app', undefined, 'default'), "cd '/code/app' && exec claude");
  assert.throws(() => claudeCommand('/code/app', undefined, 'yolo; rm -rf ~'));
});

test("closing a session's window finds it by its tty, only in a terminal app that is already running", () => {
  for (const app of ['iTerm', 'Terminal']) {
    const args = closeTerminalScript(app, '/dev/ttys012');
    assert.equal(args.at(-1), '/dev/ttys012');
    const script = args.slice(0, -1).filter((_, i) => i % 2 === 1).join('\n');
    assert.match(script, new RegExp(`if application "${app}" is running then`));
    assert.match(script, /tty of/);
    assert.ok(!script.includes('ttys012'), 'the tty goes in as an argument');
  }
  assert.throws(() => closeTerminalScript('iTerm', 'ttys012; rm'));
});

test('the terminal script gets the command as an argument, never inside the script', () => {
  const cmd = "cd '/code/app' && claude";
  for (const app of ['iTerm', 'Terminal']) {
    const args = terminalScript(app, cmd);
    assert.equal(args.at(-1), cmd);
    const script = args.slice(0, -1).filter((_, i) => i % 2 === 1).join('\n');
    assert.ok(args.slice(0, -1).every((a, i) => (i % 2 === 0 ? a === '-e' : true)));
    assert.ok(!script.includes('claude'));
    assert.match(script, new RegExp(`tell application "${app}"`));
  }
  assert.match(terminalScript('iTerm', cmd).join('\n'), /create window with default profile/);
  assert.match(terminalScript('Hyper', cmd).join('\n'), /tell application "Terminal"/, 'an unknown app falls back to Terminal');
});
