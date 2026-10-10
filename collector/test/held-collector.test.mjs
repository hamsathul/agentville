// Held messages in the collector: kept while a session works, changed from the page, sent one per
// turn end (or all together), turned into notes when the session is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCollector } from '../collector.mjs';

const SID = 'held-sess';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) if (fn()) return true; return fn(); };

/** One live session (this process), its transcript, a live mod beacon, and a stand-in mod that takes its messages. */
async function fixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'held-root-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, pollMs: 100, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'held-claude-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  const registry = status => writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID, cwd: '/w', name: 'busy-bee', status }));
  const transcript = join(claudeDir, 'projects', '-w', `${SID}.jsonl`);
  const line = (type, text) => appendFileSync(transcript, `${JSON.stringify(type === 'user'
    ? { type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: text } }
    : type === 'end' ? { type: 'system', subtype: 'turn_duration', timestamp: new Date().toISOString(), durationMs: 1000 }
    : { type: 'assistant', timestamp: new Date().toISOString(), message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }] } })}\n`);
  registry('busy');
  line('user', 'build it');
  mkdirSync(join(root, 'state', 'mods'), { recursive: true });
  const beat = () => writeFileSync(join(root, 'state', 'mods', `${SID}.json`), JSON.stringify({ sessionId: SID, version: '0.9.0', at: Date.now() }));
  beat();
  const received = [];
  const mod = { alive: true };
  const inbox = join(root, 'state', 'messages', SID);
  const timer = setInterval(() => {
    beat();
    if (!mod.alive || !existsSync(inbox)) return;
    for (const name of readdirSync(inbox).sort()) {
      if (!name.endsWith('.json')) continue;
      received.push(JSON.parse(readFileSync(join(inbox, name), 'utf8')).text);
      unlinkSync(join(inbox, name));
    }
  }, 40);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, deliveryTimeoutMs: 500, ...extra });
  const agent = () => handle.getSnapshot()?.agents.find(a => a.id === SID);
  await until(() => agent()?.state === 'working');
  /** The turn ends: the session idle, a reply in its transcript. */
  const turnEnds = () => { registry('idle'); line('assistant', 'done'); line('end'); };
  /** A whole turn, too quick for any update to see it working: the prompt that went out, and its reply. */
  const quickTurn = text => { line('user', text); line('assistant', 'ok'); line('end'); };
  const stop = async () => { clearInterval(timer); await handle.stop(); };
  return { root, claudeDir, handle, agent, received, mod, registry, line, turnEnds, quickTurn, stop, inbox };
}

test('a message to a working session is held, with no text in the snapshot; to one on its turn it goes at once', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.handle.actions.message({ agentId: SID, text: 'also update the README' }), { ok: true, held: true, count: 1 });
    await sleep(200);
    assert.deepEqual(f.received, [], 'nothing went to the session');
    await until(() => f.agent()?.held?.count === 1);
    assert.equal(f.agent().held.together, false);
    assert.doesNotMatch(JSON.stringify(f.handle.getSnapshot()), /update the README/, 'no message text in the snapshot');
    assert.deepEqual(f.handle.getHeld(SID).items.map(i => i.text), ['also update the README']);
    assert.deepEqual(await f.handle.actions.message({ agentId: SID, text: 'steer now', now: true }), { ok: true }, 'now: sent at once even while it works');
    assert.deepEqual(f.received, ['steer now']);
  } finally { await f.stop(); }
});

test('the list: edit, remove, together; an id no longer waiting is refused; send now sends that one', async () => {
  const f = await fixture();
  try {
    for (const t of ['one', 'two', 'three']) await f.handle.actions.message({ agentId: SID, text: t });
    const [a, b, c] = f.handle.getHeld(SID).items;
    assert.deepEqual(await f.handle.actions.held({ agentId: SID, op: 'edit', id: a.id, text: 'one, better' }), { ok: true });
    assert.deepEqual(await f.handle.actions.held({ agentId: SID, op: 'remove', id: b.id }), { ok: true });
    assert.deepEqual(await f.handle.actions.held({ agentId: SID, op: 'remove', id: b.id }), { ok: false, error: 'That message is no longer waiting.' });
    assert.deepEqual(await f.handle.actions.held({ agentId: SID, op: 'together', on: true }), { ok: true });
    assert.equal(f.handle.getHeld(SID).together, true);
    assert.deepEqual(await f.handle.actions.held({ agentId: SID, op: 'send-now', id: c.id }), { ok: true });
    assert.deepEqual(f.received, ['three']);
    assert.deepEqual(f.handle.getHeld(SID).items.map(i => i.text), ['one, better']);
    assert.match((await f.handle.actions.held({ agentId: SID, op: 'shuffle' })).error, /not something/);
    assert.match((await f.handle.actions.held({ agentId: 'nope', op: 'remove', id: a.id })).error, /not found/);
    f.mod.alive = false;
    const r = await f.handle.actions.held({ agentId: SID, op: 'send-now', id: a.id });
    assert.equal(r.ok, false, 'not taken');
    assert.deepEqual(f.handle.getHeld(SID).items.map(i => i.text), ['one, better'], 'back where it was');
  } finally { await f.stop(); }
});

test('released one per turn end, never two before the next turn; a turn too quick to see still lets the next go', async () => {
  const f = await fixture();
  try {
    for (const t of ['first', 'second', 'third']) await f.handle.actions.message({ agentId: SID, text: t });
    f.turnEnds();
    assert.ok(await until(() => f.received.length === 1), 'one goes out when the turn ends');
    assert.deepEqual(f.received, ['first']);
    await sleep(500);
    assert.deepEqual(f.received, ['first'], 'not the next before the first one\'s turn');
    f.quickTurn('first'); // its turn ran and ended between two updates: never seen working
    assert.ok(await until(() => f.received.length === 2));
    assert.deepEqual(f.received, ['first', 'second']);
    assert.equal(f.agent().held.count, 1);
  } finally { await f.stop(); }
});

test('together: everything waiting goes as one message, in order', async () => {
  const f = await fixture();
  try {
    for (const t of ['alpha', 'beta']) await f.handle.actions.message({ agentId: SID, text: t });
    await f.handle.actions.held({ agentId: SID, op: 'together', on: true });
    f.turnEnds();
    assert.ok(await until(() => f.received.length === 1));
    assert.deepEqual(f.received, ['alpha\n\nbeta']);
    await sleep(300);
    assert.equal(f.agent()?.held, undefined, 'none left');
  } finally { await f.stop(); }
});

test('a release the session does not take goes back to the front, says so, and goes at the next chance', async () => {
  const f = await fixture();
  try {
    for (const t of ['a', 'b']) await f.handle.actions.message({ agentId: SID, text: t });
    f.mod.alive = false;
    f.turnEnds();
    assert.ok(await until(() => Boolean(f.agent()?.held?.failed), 4000), 'the failure shows');
    assert.deepEqual(f.handle.getHeld(SID).items.map(i => i.text), ['a', 'b'], 'back at the front');
    f.mod.alive = true;
    f.quickTurn('a'); // the transcript moves: the next chance
    assert.ok(await until(() => f.received.length === 1, 4000));
    assert.deepEqual(f.received, ['a']);
  } finally { await f.stop(); }
});

test('a session gone for a while has its held messages as notes; one back sooner keeps them', async () => {
  const f = await fixture({ heldGoneMs: 600 });
  try {
    await f.handle.actions.message({ agentId: SID, text: 'remember this' });
    rmSync(join(f.claudeDir, 'sessions', `${process.pid}.json`));
    await sleep(250);
    f.registry('busy'); // back (a restart) before 600 ms
    await sleep(700);
    assert.deepEqual(f.handle.getHeld(SID).items.map(i => i.text), ['remember this'], 'kept');
    rmSync(join(f.claudeDir, 'sessions', `${process.pid}.json`));
    assert.ok(await until(() => (f.handle.getNotes(SID)?.notes ?? []).some(n => n.text === 'remember this'), 3000), 'a note now');
    assert.deepEqual(f.handle.getHeld(SID)?.items ?? [], []);
  } finally { await f.stop(); }
});
