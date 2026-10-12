// Past sessions to resume, read from ~/.claude/projects, and the terminal window that starts one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountLaunchEnv, accountPrefix, claudeCommand, claudeLaunch, closeTerminalScript, forkCommand, forkLaunch, listSessions, projectsOf, terminalScript } from '../sources/sessions.mjs';

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

test('each session says when it started, how long it is, its last model and its git branch', () => {
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-sessions-'));
  const dir = join(claudeDir, 'projects', '-code-app');
  mkdirSync(dir, { recursive: true });
  const on = (branch, line) => JSON.stringify({ ...JSON.parse(line), gitBranch: branch });
  const lines = [
    JSON.stringify({ type: 'permission-mode', permissionMode: 'default' }), // no time: not when it started
    on('main', user(NOW - DAY, 'Start here')),
    on('main', said(NOW - DAY + 1000, 'ok')),
    JSON.stringify({ type: 'assistant', timestamp: iso(NOW - 3000), gitBranch: 'feature/x', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'done' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: iso(NOW - 2000), gitBranch: 'feature/x', message: { model: '<synthetic>', content: [{ type: 'text', text: 'API error' }] } }),
    on('', user(NOW - 1000, 'thanks')),
  ];
  writeFileSync(join(dir, `${ID(5)}.jsonl`), `${lines.join('\n')}\n`);
  const [s] = listSessions({ claudeDir, now: NOW });
  assert.equal(s.startedAt, NOW - DAY);
  assert.equal(s.model, 'claude-opus-5-5', 'the last real model, not a synthetic error');
  assert.equal(s.branch, 'feature/x', 'the last branch named');
  assert.equal(s.size, `${lines.join('\n')}\n`.length);
});

test('every session in the time asked for is listed, not only the newest few; Infinity days lists them all', () => {
  const claudeDir = fixture();
  const dir = join(claudeDir, 'projects', '-code-many');
  mkdirSync(dir, { recursive: true });
  for (let n = 10; n < 110; n++) {
    const file = join(dir, `${String(n).padStart(8, '0')}-bbbb-4bbb-8ccc-${String(n).padStart(12, '0')}.jsonl`);
    writeFileSync(file, `${user(NOW - 1000, `task ${n}`, { kind: 'human' }, '/code/many')}\n`);
    utimesSync(file, new Date(NOW - 1000), new Date(NOW - 1000));
  }
  assert.equal(listSessions({ claudeDir, now: NOW }).length, 102);
  assert.equal(listSessions({ claudeDir, now: NOW, maxAgeDays: Infinity }).length, 103, 'the 90-day-old one too');
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

test('a restored session resumes with your message back in its prompt box, read from a file by the shell', () => {
  assert.equal(claudeCommand('/code/app', ID(1), 'plan', { prefillFile: '/t/forks/f-3/prompt.txt' }),
    `cd '/code/app' && exec claude --resume ${ID(1)} --permission-mode plan --prefill "$(cat '/t/forks/f-3/prompt.txt')"`);
});

test('a fork resumes the cut copy as a new session, named as a fork, its prompt box filled from a file by the shell', () => {
  assert.equal(forkCommand('/code/my app', '/t/forks/f-1/s.jsonl', 'plan', { model: 'sonnet', effort: 'high', name: "Bob's work (fork)" }),
    `cd '/code/my app' && exec claude --resume '/t/forks/f-1/s.jsonl' --fork-session --name 'Bob'\\''s work (fork)' --permission-mode plan --model 'sonnet' --effort high`);
  assert.equal(forkCommand('/code/app', '/t/forks/f-2/s.jsonl', 'default', { prefillFile: '/t/forks/f-2/prompt.txt' }),
    `cd '/code/app' && exec claude --resume '/t/forks/f-2/s.jsonl' --fork-session --prefill "$(cat '/t/forks/f-2/prompt.txt')"`);
  assert.equal(forkCommand('/code/app', '/t/forks/f-4/s.jsonl', 'default', { sessionId: '6f1c2a3b-0000-4000-8000-000000000002' }),
    `cd '/code/app' && exec claude --resume '/t/forks/f-4/s.jsonl' --fork-session --session-id 6f1c2a3b-0000-4000-8000-000000000002`); // its id chosen here, so its notes can go with it
  assert.throws(() => forkCommand('/code/app', '/t/s.jsonl', 'default', { sessionId: "x'; rm -rf ~" }), /session id/);
  assert.throws(() => forkCommand('/code/app', 'relative.jsonl'), /transcript/);
  assert.throws(() => forkCommand('/code/app', '/t/s.jsonl', 'yolo'));
  assert.throws(() => forkCommand('/code/app', '/t/s.jsonl', 'default', { model: 'gpt' }));
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

test('commands on an account: none with one, env -u for the first, the folder quoted for another', () => {
  assert.equal(claudeCommand('/w', undefined, 'default'), "cd '/w' && exec claude");
  assert.equal(claudeCommand('/w', undefined, 'default', { account: { dir: '/h/.claude', first: true } }), "cd '/w' && exec env -u CLAUDE_CONFIG_DIR claude");
  const id = '11111111-2222-3333-4444-555555555555';
  assert.equal(claudeCommand('/w', id, 'plan', { account: { dir: "/h/it's/.claude-zeta", first: false } }),
    `cd '/w' && exec env CLAUDE_CONFIG_DIR='/h/it'\\''s/.claude-zeta' claude --resume ${id} --permission-mode plan`);
  assert.match(forkCommand('/w', '/f/x.jsonl', 'default', { account: { dir: '/h/.claude-zeta', first: false } }), /^cd '\/w' && exec env CLAUDE_CONFIG_DIR='\/h\/.claude-zeta' claude --resume '\/f\/x.jsonl' --fork-session$/);
  assert.throws(() => accountPrefix({ dir: 'relative', first: false }), /not an account folder/);
  assert.throws(() => accountPrefix({ dir: '/h/.claude-zeta/', first: false }), /not an account folder/);
  assert.equal(accountPrefix(null), '');
});

test('listSessions reads several projects folders, one row per session, the newest file winning', () => {
  const a = mkdtempSync(join(tmpdir(), 'proj-a-')), b = mkdtempSync(join(tmpdir(), 'proj-b-'));
  const id = '11111111-2222-3333-4444-555555555555';
  const line = text => `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), cwd: '/w', message: { role: 'user', content: text } })}\n`;
  mkdirSync(join(a, '-w')); mkdirSync(join(b, '-w'));
  writeFileSync(join(a, '-w', `${id}.jsonl`), line('old'));
  writeFileSync(join(b, '-w', `${id}.jsonl`), line('new'));
  utimesSync(join(a, '-w', `${id}.jsonl`), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  const got = listSessions({ projectsDirs: [a, b] });
  assert.equal(got.length, 1);
  assert.equal(got[0].firstPrompt, 'new');
  assert.equal(got[0].projectsDir, b);
});

test('claudeLaunch: the same session as claudeCommand, as folder + argument list + prefill file, checked the same way', () => {
  assert.deepEqual(claudeLaunch('/code/my app'), { cwd: '/code/my app', args: [] });
  assert.deepEqual(claudeLaunch('/code/app', ID(1), 'plan', { model: 'sonnet', effort: 'high', prefillFile: '/t/f/prompt.txt' }),
    { cwd: '/code/app', args: ['--resume', ID(1), '--permission-mode', 'plan', '--model', 'sonnet', '--effort', 'high'], prefillFile: '/t/f/prompt.txt' });
  assert.deepEqual(claudeLaunch('/code/app', undefined, 'bypassPermissions').args, ['--dangerously-skip-permissions']);
  assert.throws(() => claudeLaunch('/code/app', 'x; rm -rf ~'), /session id/);
  assert.throws(() => claudeLaunch('/code/app', undefined, 'yolo; rm -rf ~'), /permission mode/);
  assert.throws(() => claudeLaunch('/code/app', undefined, 'default', { model: 'gpt; x' }), /model/);
  assert.throws(() => claudeLaunch('/code/app', undefined, 'default', { effort: 'extreme' }), /effort/);
});

test('forkLaunch: the fork as an argument list; the name and copy path stay single arguments, whatever they hold', () => {
  const spec = forkLaunch('/code/app', '/t/forks/f-1/s.jsonl', 'plan', { name: `Bob's "plan"; calc`, sessionId: ID(2), prefillFile: '/t/f/p.txt' });
  assert.deepEqual(spec, { cwd: '/code/app', args: ['--resume', '/t/forks/f-1/s.jsonl', '--fork-session', '--session-id', ID(2), '--name', `Bob's "plan"; calc`, '--permission-mode', 'plan'], prefillFile: '/t/f/p.txt' });
  assert.throws(() => forkLaunch('/code/app', 'relative.jsonl'), /transcript copy/);
  assert.throws(() => forkLaunch('/code/app', '/t/x.txt'), /transcript copy/);
});

test('a project\'s name is its last folder, whichever separator the path uses', () => {
  const b = String.fromCharCode(92);
  const names = projectsOf([{ cwd: `C:${b}Users${b}me${b}my app`, at: 3 }, { cwd: '/Users/me/other', at: 2 }, { cwd: 'D:/work/third', at: 1 }]).map(p => p.name);
  assert.deepEqual(names, ['my app', 'other', 'third']);
});

test('accounts on Windows: the launch spec carries CLAUDE_CONFIG_DIR as data, checked as accountPrefix checks the shell form', () => {
  const win = String.fromCharCode(92);
  const other = { dir: process.platform === 'win32' ? `C:${win}Users${win}me${win}.claude-zeta` : '/h/.claude-zeta', first: false };
  assert.equal(accountLaunchEnv(null), undefined);
  assert.deepEqual(accountLaunchEnv({ dir: '/h/.claude', first: true }), { CLAUDE_CONFIG_DIR: null });
  assert.deepEqual(accountLaunchEnv(other), { CLAUDE_CONFIG_DIR: other.dir });
  assert.throws(() => accountLaunchEnv({ dir: 'relative', first: false }), /not an account folder/);
  assert.throws(() => accountLaunchEnv({ dir: `${other.dir}/`, first: false }), /not an account folder/);
  assert.deepEqual(claudeLaunch('/code/app', undefined, 'default', { account: other }).env, { CLAUDE_CONFIG_DIR: other.dir });
  assert.deepEqual(forkLaunch('/code/app', '/t/forks/f-1/s.jsonl', 'default', { account: other }).env, { CLAUDE_CONFIG_DIR: other.dir });
  assert.equal('env' in claudeLaunch('/code/app'), false, 'one account: nothing set');
  assert.throws(() => claudeLaunch('/code/app', undefined, 'default', { account: { dir: 'relative', first: false } }), /not an account folder/);
});
