// The collector with two Claude accounts: a config folder each, the second's history shared or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCollector } from '../collector.mjs';

const ID = { nco: '11111111-1111-4111-8111-111111111111', zeta: '22222222-2222-4222-8222-222222222222', old: '33333333-3333-4333-8333-333333333333', bg: '44444444-4444-4444-8444-444444444444' };
const iso = ms => new Date(ms).toISOString();
const literal = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const say = (cwd, text, ms, extra = {}) => JSON.stringify({ type: 'user', timestamp: iso(ms), cwd, message: { role: 'user', content: text }, ...extra });
const answer = (cwd, text, ms, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: iso(ms), cwd, message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }] }, ...extra });

/**
 * Two accounts (claude, named nco, and claude-zeta, whose projects is a link to claude's unless
 * `shared` is false), a live session on each (this process and its parent stand in for them), a
 * past one, and the folder they ran in.
 */
function twoAccounts({ shared = true } = {}) {
  const top = mkdtempSync(join(tmpdir(), 'multi-'));
  const root = join(top, 'root'), claudeDir = join(top, 'claude'), zeta = join(top, 'claude-zeta'), work = join(top, 'work');
  for (const d of [join(root, 'web'), join(claudeDir, 'sessions'), join(claudeDir, 'projects', '-work'), join(zeta, 'sessions'), work]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, 'web', 'index.html'), '<html>__TRACKER_TOKEN__</html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, pollMs: 200, accounts: { [claudeDir]: 'nco' } }));
  writeFileSync(`${claudeDir}.json`, JSON.stringify({ oauthAccount: { emailAddress: 'me@nco.example' } }));
  writeFileSync(join(zeta, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@zeta.example' } }));
  if (shared) symlinkSync(join(claudeDir, 'projects'), join(zeta, 'projects'));
  else mkdirSync(join(zeta, 'projects', '-work'), { recursive: true });
  const now = Date.now();
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: ID.nco, cwd: work, name: 'on nco', kind: 'interactive', status: 'idle' }));
  writeFileSync(join(zeta, 'sessions', `${process.ppid}.json`), JSON.stringify({ pid: process.ppid, sessionId: ID.zeta, cwd: work, name: 'on zeta', kind: 'interactive', status: 'idle' }));
  for (const [id, text] of [[ID.nco, 'nco work'], [ID.zeta, 'zeta work'], [ID.old, 'old work']]) {
    const projects = id === ID.zeta && !shared ? join(zeta, 'projects') : join(claudeDir, 'projects');
    writeFileSync(join(projects, '-work', `${id}.jsonl`), `${say(work, text, now - 5000)}\n`);
  }
  // nco's session has a reply and a second message, to fork from and restore to
  writeFileSync(join(claudeDir, 'projects', '-work', `${ID.nco}.jsonl`), `${[say(work, 'nco work', now - 9000, { uuid: 'u1' }), answer(work, 'done', now - 8000, { uuid: 'r1', parentUuid: 'u1' }), say(work, 'more nco work', now - 7000, { uuid: 'u2', parentUuid: 'r1' })].join('\n')}\n`);
  return { top, root, claudeDir, zeta, work };
}

/**
 * A stand-in claude that logs `<CLAUDE_CONFIG_DIR or none>|<args>` for every call: zeta's
 * `agents --json` lists a background session two days old (stale); `auth status` says signed in.
 */
function fakeClaude(f) {
  const log = join(f.top, 'claude-cli.log');
  const bin = join(f.top, process.platform === 'win32' ? 'claude-cli.cmd' : 'claude-cli');
  const bg = JSON.stringify([{ id: 'bg1', sessionId: ID.bg, cwd: f.work, kind: 'background', startedAt: 1, state: 'blocked' }]);
  if (process.platform === 'win32') return fakeClaudeWindows(f, bin, log, bg);
  // A file named cli-fails makes `agents --json` fail; zeta-out makes zeta's `auth status` say signed out.
  writeFileSync(bin, `#!/bin/sh
echo "\${CLAUDE_CONFIG_DIR:-none}|$*" >> '${log}'
case "$1 $2" in
  "agents --json") if [ -e '${f.top}/cli-fails' ]; then exit 1; fi; if [ "$CLAUDE_CONFIG_DIR" = '${f.zeta}' ]; then echo '${bg}'; else echo '[]'; fi ;;
  "auth status") if [ -e '${f.top}/zeta-out' ] && [ "$CLAUDE_CONFIG_DIR" = '${f.zeta}' ]; then echo '{"loggedIn":false}'; else echo '{"loggedIn":true}'; fi ;;
esac
exit 0
`);
  chmodSync(bin, 0o755);
  writeFileSync(join(f.claudeDir, 'projects', '-work', `${ID.bg}.jsonl`), `${say(f.work, 'background work', Date.now() - 2 * 86_400_000)}\n`);
  return { bin, calls: () => { try { return readFileSync(log, 'utf8').trim().split('\n'); } catch { return []; } } };
}

// The same stand-in for Windows, where there is no /bin/sh: a node script behind a .cmd (which the collector runs through
// cmd.exe, as it runs npm's claude.cmd). A file named cli-bg-on-main makes the first account list the background session too.
function fakeClaudeWindows(f, bin, log, bg) {
  const script = bin.replace(/\.cmd$/, '.mjs');
  const top = JSON.stringify(f.top), zeta = JSON.stringify(f.zeta), logFile = JSON.stringify(log);
  writeFileSync(script, [
    "import { appendFileSync, existsSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `const top = ${top}, zeta = ${zeta}, bg = ${JSON.stringify(bg)};`,
    'const args = process.argv.slice(2), cfg = process.env.CLAUDE_CONFIG_DIR;',
    `appendFileSync(${logFile}, \`\${cfg || 'none'}|\${args.join(' ')}\n\`);`,
    "const two = `${args[0]} ${args[1]}`;",
    "if (two === 'agents --json') {",
    "  if (existsSync(join(top, 'cli-fails'))) process.exit(1);",
    "  console.log(cfg === zeta || existsSync(join(top, 'cli-bg-on-main')) ? bg : '[]');",
    "} else if (two === 'auth status') {",
    "  console.log(existsSync(join(top, 'zeta-out')) && cfg === zeta ? '{\"loggedIn\":false}' : '{\"loggedIn\":true}');",
    '}',
    '',
  ].join('\n'));
  writeFileSync(bin, `@"${process.execPath}" "${script}" %*\r\n`);
  writeFileSync(join(f.claudeDir, 'projects', '-work', `${ID.bg}.jsonl`), `${say(f.work, 'background work', Date.now() - 2 * 86_400_000)}\n`);
  return { bin, calls: () => { try { return readFileSync(log, 'utf8').trim().split('\n'); } catch { return []; } } };
}

async function start(f, extra = {}) {
  const launched = [];
  const handle = await startCollector({ root: f.root, claudeDir: f.claudeDir, home: f.top, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, launch: async args => { launched.push(args.at(-1)); return { code: 0, stdout: '', stderr: '' }; }, ...extra });
  return { handle, launched, snap: () => handle.getSnapshot() };
}
const remembered = f => JSON.parse(readFileSync(join(f.root, 'state', 'session-accounts.json'), 'utf8'));

test('two accounts: agents tagged by the folder that lists them, the accounts in the snapshot', async () => {
  const f = twoAccounts();
  const { handle, snap } = await start(f);
  try {
    const s = snap();
    assert.deepEqual(s.accounts.map(a => [a.key, a.name, a.email, a.open]), [['main', 'nco', 'me@nco.example', 1], ['zeta', 'zeta', 'me@zeta.example', 1]]);
    assert.equal(s.agents.find(a => a.id === ID.nco).account, 'main');
    const z = s.agents.find(a => a.id === ID.zeta);
    assert.equal(z.account, 'zeta');
    assert.equal(z.lastPrompt, 'zeta work', 'its transcript was found through the shared folder');
    assert.equal(remembered(f)[ID.zeta].dir, f.zeta);
  } finally { await handle.stop(); }
});

test('a shared projects folder is listed once; past sessions carry their account and where they can run', async () => {
  const f = twoAccounts();
  const { handle } = await start(f);
  try {
    const past = await handle.pastSessions();
    assert.deepEqual(past.sessions.map(s => s.id).sort(), [ID.nco, ID.zeta, ID.old].sort(), 'each once');
    const by = id => past.sessions.find(s => s.id === id);
    assert.equal(by(ID.zeta).account, 'zeta');
    assert.equal(by(ID.old).account, 'main', 'never seen running: the first account');
    assert.deepEqual(by(ID.old).canRunOn, ['main', 'zeta']);
    assert.equal(by(ID.old).projectsDir, undefined, 'where it lives stays in the collector');
    assert.equal(past.projects.find(p => p.cwd === f.work).account, by(past.sessions[0].id).account, "a folder's account is its newest session's");
  } finally { await handle.stop(); }
});

test('an unshared projects folder: its sessions can run only on its own account', async () => {
  const f = twoAccounts({ shared: false });
  const { handle, snap } = await start(f);
  try {
    const past = await handle.pastSessions();
    assert.deepEqual(past.sessions.find(s => s.id === ID.zeta).canRunOn, ['zeta']);
    assert.deepEqual(past.sessions.find(s => s.id === ID.old).canRunOn, ['main']);
    assert.equal(snap().agents.find(a => a.id === ID.zeta).lastPrompt, 'zeta work', "found in zeta's own folder");
  } finally { await handle.stop(); }
});

test("the plan per account: each its own freshest reading; plan is the first account's", async () => {
  const f = twoAccounts();
  mkdirSync(join(f.root, 'state', 'mods'), { recursive: true });
  const beacon = (id, five) => writeFileSync(join(f.root, 'state', 'mods', `${id}.json`), JSON.stringify({ sessionId: id, version: '0.9.0', at: Date.now(), usage: { costUsd: 2, rateLimits: [{ kind: 'five_hour', percentUsed: five, resetsAt: Date.now() + 3_600_000 }] } }));
  beacon(ID.nco, 40);
  beacon(ID.zeta, 95);
  const { handle, snap } = await start(f);
  try {
    const s = snap();
    assert.equal(s.accounts[0].plan.windows[0].percentUsed, 40);
    assert.equal(s.accounts[1].plan.windows[0].percentUsed, 95);
    assert.equal(s.plan.windows[0].percentUsed, 40, "plan stays the first account's");
    assert.equal(s.accounts[1].costUsd, 2);
  } finally { await handle.stop(); }
});

test('remembered on nco but live on zeta: the live registry wins and the memory moves', async () => {
  const f = twoAccounts();
  mkdirSync(join(f.root, 'state'), { recursive: true });
  writeFileSync(join(f.root, 'state', 'session-accounts.json'), JSON.stringify({ [ID.zeta]: { dir: f.claudeDir, at: 1 } }));
  const { handle, snap } = await start(f);
  try {
    assert.equal(snap().agents.find(a => a.id === ID.zeta).account, 'zeta');
    assert.equal(remembered(f)[ID.zeta].dir, f.zeta);
  } finally { await handle.stop(); }
});

test('a session remembered on a folder that is no longer an account', async () => {
  const f = twoAccounts();
  mkdirSync(join(f.root, 'state'), { recursive: true });
  writeFileSync(join(f.root, 'state', 'session-accounts.json'), JSON.stringify({ [ID.old]: { dir: join(f.top, 'claude-gone'), at: 1 } }));
  const { handle } = await start(f);
  try {
    const old = (await handle.pastSessions()).sessions.find(s => s.id === ID.old);
    assert.equal(old.account, null);
    assert.equal(old.accountGone, 'gone');
  } finally { await handle.stop(); }
});

test('one account: the snapshot has one account and agents are on it', async () => {
  const f = twoAccounts();
  rmSync(f.zeta, { recursive: true, force: true });
  const { handle, snap } = await start(f);
  try {
    assert.deepEqual(snap().accounts.map(a => a.key), ['main']);
    assert.deepEqual(snap().agents.map(a => a.account), ['main']);
  } finally { await handle.stop(); }
});

test('start: a new session on zeta, a resume on its own account by default, an unknown account refused', async () => {
  const f = twoAccounts();
  const { handle, launched } = await start(f);
  try {
    assert.equal((await handle.actions.start({ cwd: f.work, account: 'zeta' })).ok, true);
    assert.equal(launched.at(-1), `cd '${f.work}' && exec env CLAUDE_CONFIG_DIR='${f.zeta}' claude`);
    assert.equal((await handle.actions.start({ resume: ID.old })).ok, true);
    assert.equal(launched.at(-1), `cd '${f.work}' && exec env -u CLAUDE_CONFIG_DIR claude --resume ${ID.old}`);
    assert.equal((await handle.actions.start({ resume: ID.old, account: 'zeta' })).ok, true, 'shared history: it moves');
    assert.equal(launched.at(-1), `cd '${f.work}' && exec env CLAUDE_CONFIG_DIR='${f.zeta}' claude --resume ${ID.old}`);
    assert.deepEqual(await handle.actions.start({ cwd: f.work, account: 'nope' }), { ok: false, error: 'No account "nope".' });
    assert.equal(launched.length, 3);
    assert.equal((await handle.pastSessions()).sessions.find(s => s.id === ID.old).account, 'zeta', 'remembered as launched');
  } finally { await handle.stop(); }
});

test('start: a new session in a folder starts on the account its last session ran on', async () => {
  const f = twoAccounts();
  mkdirSync(join(f.root, 'state'), { recursive: true });
  const { handle, launched } = await start(f);
  try {
    const folder = (await handle.pastSessions()).projects.find(p => p.cwd === f.work);
    assert.equal((await handle.actions.start({ cwd: f.work })).ok, true);
    assert.match(launched.at(-1), folder.account === 'zeta' ? /CLAUDE_CONFIG_DIR='.*claude-zeta' claude$/ : /env -u CLAUDE_CONFIG_DIR claude$/);
  } finally { await handle.stop(); }
});

test("start: an account whose history isn't shared can't resume the session", async () => {
  const f = twoAccounts({ shared: false });
  const { handle, launched } = await start(f);
  try {
    const r = await handle.actions.start({ resume: ID.old, account: 'zeta' });
    assert.equal(r.ok, false);
    assert.match(r.error, /history isn't shared with zeta/);
    assert.equal(launched.length, 0);
  } finally { await handle.stop(); }
});

test('fork: on the account picked, else the original\'s; an unknown account refused before cutting', async () => {
  const f = twoAccounts();
  const { handle, launched } = await start(f);
  try {
    assert.deepEqual(await handle.actions.fork({ agentId: ID.nco, at: 'r1', account: 'nope' }), { ok: false, error: 'No account "nope".' });
    assert.equal((await handle.actions.fork({ agentId: ID.nco, at: 'r1', account: 'zeta' })).ok, true);
    assert.match(launched.at(-1), new RegExp(`^cd '${literal(f.work)}' && exec env CLAUDE_CONFIG_DIR='${literal(f.zeta)}' claude --resume '[^']+' --fork-session --session-id `));
    assert.equal((await handle.actions.fork({ agentId: ID.nco, at: 'r1' })).ok, true);
    assert.match(launched.at(-1), /exec env -u CLAUDE_CONFIG_DIR claude --resume/);
  } finally { await handle.stop(); }
});

test('restart with another account ends the session and resumes it there, same id', async () => {
  const f = twoAccounts();
  let alive = true;
  const sessionProcs = { commandOf: async () => 'claude', ttyOf: async () => null, kill: () => { alive = false; }, alive: () => alive, killGroup: () => {}, groupAlive: () => false };
  const { handle, launched } = await start(f, { sessionProcs });
  try {
    assert.deepEqual(await handle.actions.restart({ agentId: ID.nco, mode: 'default', account: 'nope' }), { ok: false, error: 'No account "nope".' });
    assert.equal(alive, true, 'refused before ending it');
    const r = await handle.actions.restart({ agentId: ID.nco, mode: 'default', account: 'zeta' });
    assert.equal(r.ok, true, r.error);
    assert.equal(launched.at(-1), `cd '${f.work}' && exec env CLAUDE_CONFIG_DIR='${f.zeta}' claude --resume ${ID.nco}`);
  } finally { await handle.stop(); }
});

test("restart can't move a session to an account whose history isn't shared", async () => {
  const f = twoAccounts({ shared: false });
  let alive = true;
  const sessionProcs = { commandOf: async () => 'claude', ttyOf: async () => null, kill: () => { alive = false; }, alive: () => alive, killGroup: () => {}, groupAlive: () => false };
  const { handle, launched } = await start(f, { sessionProcs });
  try {
    const r = await handle.actions.restart({ agentId: ID.nco, mode: 'default', account: 'zeta' });
    assert.equal(r.ok, false);
    assert.match(r.error, /history isn't shared with zeta/);
    assert.equal(alive, true, 'it was not ended');
    assert.equal(launched.length, 0);
  } finally { await handle.stop(); }
});

test("restore, remove and attach run on the session's account; the collector's own CLAUDE_CONFIG_DIR never leaks", async () => {
  const f = twoAccounts();
  const claude = fakeClaude(f);
  let alive = true;
  const sessionProcs = { commandOf: async () => 'claude', ttyOf: async () => null, kill: () => { alive = false; }, alive: () => alive, killGroup: () => {}, groupAlive: () => false };
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = '/elsewhere';
  const { handle, launched, snap } = await start(f, { sessionProcs, claudeBin: claude.bin });
  try {
    const agentsCalls = claude.calls().filter(c => c.endsWith('|agents --json'));
    assert.deepEqual(agentsCalls.slice(0, 2), ['none|agents --json', `${f.zeta}|agents --json`]);
    const bg = snap().agents.find(a => a.id === ID.bg);
    assert.equal(bg?.account, 'zeta');
    assert.equal(bg.state, 'stale');
    assert.equal((await handle.actions.open('bg1')).ok, true);
    assert.equal(launched.at(-1), `env CLAUDE_CONFIG_DIR='${f.zeta}' claude attach bg1`);
    assert.equal((await handle.actions.rm([ID.bg])).results[0].ok, true);
    assert.ok(claude.calls().includes(`${f.zeta}|rm bg1`));
    const r = await handle.actions.restore({ agentId: ID.nco, at: 'u2', what: 'code' });
    assert.equal(r.ok, true, r.error);
    assert.ok(claude.calls().includes(`none|--resume ${ID.nco} --rewind-files u2`), claude.calls().join('\n'));
    assert.equal(launched.at(-1), `cd '${f.work}' && exec env -u CLAUDE_CONFIG_DIR claude --resume ${ID.nco}`);
    assert.ok(!claude.calls().some(c => c.startsWith('/elsewhere|')));
  } finally {
    if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was;
    await handle.stop();
  }
});

const settle = ms => new Promise(r => setTimeout(r, ms));
/** Waits until `ok()` holds, for at most `ms`: what a fixed sleep guesses at. */
async function until(ok, ms = 8000) { for (const end = Date.now() + ms; Date.now() < end && !ok();) await settle(50); }

test('an account that leaves the list (its folder removed) never stops the collector; its sessions fall to the first account', async () => {
  const f = twoAccounts();
  const claude = fakeClaude(f);
  const logs = [];
  const { handle, snap } = await start(f, { claudeBin: claude.bin, log: m => logs.push(m) });
  try {
    assert.equal(snap().agents.find(a => a.id === ID.bg)?.account, 'zeta');
    rmSync(f.zeta, { recursive: true, force: true });
    await handle.reloadConfig(); // the accounts are read again
    await settle(700);
    assert.deepEqual(logs.filter(m => m.includes('tick failed')), []);
    assert.deepEqual(snap().accounts.map(a => a.key), ['main']);
    assert.equal(snap().agents.find(a => a.id === ID.bg)?.account, 'main');
  } finally { await handle.stop(); }
});

test('`claude agents --json` failing keeps the sessions it listed last time (one account too)', async () => {
  const f = twoAccounts();
  rmSync(f.zeta, { recursive: true, force: true });
  const claude = fakeClaude(f);
  writeFileSync(join(f.top, 'cli-bg-on-main'), '');
  // with one account, main lists the background session
  writeFileSync(claude.bin, readFileSync(claude.bin, 'utf8').replace(`if [ "$CLAUDE_CONFIG_DIR" = '${f.zeta}' ]`, 'if true'));
  writeFileSync(join(f.root, 'config.json'), JSON.stringify({ port: 0, pollMs: 200, agentsCliPollMs: 300 }));
  const { handle, snap } = await start(f, { claudeBin: claude.bin });
  try {
    assert.ok(snap().agents.some(a => a.id === ID.bg), 'listed at first');
    writeFileSync(join(f.top, 'cli-fails'), '');
    await settle(1000); // a few polls fail
    assert.ok(claude.calls().filter(c => c.endsWith('agents --json')).length >= 3, 'it was asked again');
    assert.ok(snap().agents.some(a => a.id === ID.bg), 'still listed');
  } finally { await handle.stop(); }
});

test("an unshared account's past session that was never seen running is that account's, and resumes there", async () => {
  const f = twoAccounts({ shared: false });
  const only = '55555555-5555-4555-8555-555555555555';
  writeFileSync(join(f.zeta, 'projects', '-work', `${only}.jsonl`), `${say(f.work, 'zeta only work', Date.now() - 60_000)}\n`);
  const { handle, launched } = await start(f);
  try {
    const s = (await handle.pastSessions()).sessions.find(x => x.id === only);
    assert.equal(s.account, 'zeta');
    assert.deepEqual(s.canRunOn, ['zeta']);
    assert.equal((await handle.actions.start({ resume: only })).ok, true);
    assert.equal(launched.at(-1), `cd '${f.work}' && exec env CLAUDE_CONFIG_DIR='${f.zeta}' claude --resume ${only}`);
  } finally { await handle.stop(); }
});

test("the refusal says which account's folders to link, and to which", async () => {
  const f = twoAccounts({ shared: false });
  const only = '55555555-5555-4555-8555-555555555555';
  writeFileSync(join(f.zeta, 'projects', '-work', `${only}.jsonl`), `${say(f.work, 'zeta only work', Date.now() - 60_000)}\n`);
  const { handle } = await start(f);
  try {
    const onto = await handle.actions.start({ resume: ID.old, account: 'zeta' }); // nco's session onto zeta
    assert.match(onto.error, /link zeta's projects and file-history folders to nco's/);
    const back = await handle.actions.start({ resume: only, account: 'main' }); // zeta's session onto nco
    assert.match(back.error, /link zeta's projects and file-history folders to nco's/);
  } finally { await handle.stop(); }
});

test('with one account, nothing is remembered about accounts', async () => {
  const f = twoAccounts();
  rmSync(f.zeta, { recursive: true, force: true });
  const { handle, launched } = await start(f);
  try {
    assert.equal((await handle.actions.start({ resume: ID.old })).ok, true);
    assert.equal(launched.at(-1), `cd '${f.work}' && exec claude --resume ${ID.old}`);
    await settle(400);
    assert.equal(existsSync(join(f.root, 'state', 'session-accounts.json')), false);
  } finally { await handle.stop(); }
});

test('a signed-out account is asked again within signedInMs, so a /login shows soon', async () => {
  const f = twoAccounts();
  const claude = fakeClaude(f);
  writeFileSync(join(f.top, 'zeta-out'), '');
  const { handle, snap } = await start(f, { claudeBin: claude.bin, signedInMs: 300 });
  try {
    const signedIn = () => snap().accounts.find(a => a.key === 'zeta').signedIn;
    await until(() => signedIn() === false); // a call takes longer where starting a program is slow (Windows)
    assert.equal(signedIn(), false);
    rmSync(join(f.top, 'zeta-out'));
    await until(() => signedIn() === true);
    assert.equal(signedIn(), true);
  } finally { await handle.stop(); }
});
