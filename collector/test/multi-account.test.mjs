// The collector with two Claude accounts: a config folder each, the second's history shared or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCollector } from '../collector.mjs';

const ID = { nco: '11111111-1111-4111-8111-111111111111', zeta: '22222222-2222-4222-8222-222222222222', old: '33333333-3333-4333-8333-333333333333' };
const iso = ms => new Date(ms).toISOString();
const say = (cwd, text, ms) => JSON.stringify({ type: 'user', timestamp: iso(ms), cwd, message: { role: 'user', content: text } });

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
  return { top, root, claudeDir, zeta, work };
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
