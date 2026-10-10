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
    let names = [];
    try { names = readdirSync(inbox).sort(); } catch { return; } // not a folder (a test's broken inbox)
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const text = JSON.parse(readFileSync(join(inbox, name), 'utf8')).text;
      received.push(text);
      unlinkSync(join(inbox, name));
      mod.onClaim?.(text);
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
  return { root, claudeDir, handle, agent, received, mod, registry, line, turnEnds, quickTurn, stop, inbox, transcriptPath: transcript };
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

test("Claude Code's queue lines before the released prompt lands don't let the next one go", async () => {
  const f = await fixture();
  try {
    // as Claude Code does: queue lines at once, the prompt itself a moment later
    f.mod.onClaim = text => {
      appendFileSync(f.transcriptPath, `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), content: text })}\n${JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: new Date().toISOString() })}\n`);
      setTimeout(() => f.line('user', text), 900);
    };
    for (const t of ['first', 'second']) await f.handle.actions.message({ agentId: SID, text: t });
    f.turnEnds();
    assert.ok(await until(() => f.received.length === 1));
    await sleep(1500); // the queue lines, then the prompt, then its turn running
    assert.deepEqual(f.received, ['first'], 'the second waits for the first one\'s turn');
    f.mod.onClaim = undefined;
    f.line('assistant', 'done'); f.line('end');
    assert.ok(await until(() => f.received.length === 2));
    assert.deepEqual(f.received, ['first', 'second']);
  } finally { await f.stop(); }
});

test('a message sent while older ones still wait goes after them, not before', async () => {
  const f = await fixture();
  try {
    await f.handle.actions.message({ agentId: SID, text: 'older' });
    f.mod.alive = false;
    f.turnEnds();
    assert.ok(await until(() => Boolean(f.agent()?.held?.failed), 4000), 'its release was not taken: still waiting');
    f.mod.alive = true;
    assert.equal(f.agent().state, 'yourTurn');
    assert.deepEqual(await f.handle.actions.message({ agentId: SID, text: 'newer' }), { ok: true, held: true, count: 2 }, 'held behind the older one');
    assert.deepEqual(f.received, []);
  } finally { await f.stop(); }
});

test('a release whose message file cannot be written is not lost: back in the list, the failure shown, sent once it can be', async () => {
  const f = await fixture();
  try {
    for (const t of ['keep me', 'and me']) await f.handle.actions.message({ agentId: SID, text: t });
    mkdirSync(join(f.root, 'state', 'messages'), { recursive: true });
    writeFileSync(f.inbox, 'not a folder'); // its inbox can't be made
    f.turnEnds();
    assert.ok(await until(() => Boolean(f.agent()?.held?.failed), 4000), 'the failure shows');
    assert.deepEqual(f.handle.getHeld(SID).items.map(i => i.text), ['keep me', 'and me']);
    const now = await f.handle.actions.held({ agentId: SID, op: 'send-now', id: f.handle.getHeld(SID).items[1].id });
    assert.equal(now.ok, false, 'send now fails too');
    assert.deepEqual(f.handle.getHeld(SID).items.map(i => i.text), ['keep me', 'and me'], 'and keeps it where it was');
    unlinkSync(f.inbox);
    f.quickTurn('nothing'); // the next chance
    assert.ok(await until(() => f.received.length === 1, 4000));
    assert.deepEqual(f.received, ['keep me']);
  } finally { await f.stop(); }
});

test('messages of a gone session are not lost when their notes cannot be written', async () => {
  const f = await fixture({ heldGoneMs: 300 });
  try {
    await f.handle.actions.message({ agentId: SID, text: 'precious' });
    rmSync(join(f.root, 'state', 'notes'), { recursive: true, force: true });
    writeFileSync(join(f.root, 'state', 'notes'), 'not a folder'); // notes can't be saved
    rmSync(join(f.claudeDir, 'sessions', `${process.pid}.json`));
    await sleep(900);
    assert.deepEqual(f.handle.getHeld(SID).items.map(i => i.text), ['precious'], 'still held');
  } finally { await f.stop(); }
});
