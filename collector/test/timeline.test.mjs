import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../derive/timeline.mjs';
import { at, modelOf, prompt, reply, toolUse } from './fixtures.mjs';

const rewound = leafUuid => JSON.stringify({ type: 'last-prompt', leafUuid, sessionId: 's', explicit: true, rewound: true });
/** A message from another session, as Claude Code writes it into the receiver's transcript. */
const peerIn = (sec, from, text, origin = {}) => JSON.stringify({ type: 'user', timestamp: new Date(at(sec)).toISOString(), origin: { kind: 'peer', name: from, ...origin }, message: { content: `<cross-session-message from-name="${from}">\n${text}\n</cross-session-message>` } });
const sendTo = (sec, id, to, message, summary) => toolUse(sec, id, 'SendMessage', { to, message, ...(summary ? { summary } : {}) });

/** The timeline of sessions given as { id: { name, pid, kind, model } }. */
function timeline(sessions, opts = {}) {
  const agents = Object.entries(sessions).map(([id, s]) => ({ id, name: s.name ?? id, kind: s.kind ?? 'interactive', pid: s.pid }));
  return buildTimeline({ agents, recordOf: id => (sessions[id]?.model ? { model: sessions[id].model } : undefined), now: at(999), ...opts });
}
const brief = t => t.items.map(i => `${i.agent} ${i.kind} ${i.kind === 'tool' ? i.tool : i.body}`);

test("every session's messages and steps, merged oldest first, each with its session's id and name; since is inclusive", () => {
  const sessions = {
    s1: { name: 'api', model: modelOf(prompt(0, 'Fix the login'), toolUse(2, 't1', 'Bash', { command: 'npm test' }), reply(4, 'Fixed.')) },
    s2: { name: 'web', model: modelOf(prompt(1, 'Restyle the page'), reply(3, 'Restyled.')) },
  };
  const t = timeline(sessions);
  assert.deepEqual(brief(t), ['s1 prompt Fix the login', 's2 prompt Restyle the page', 's1 tool Bash', 's2 reply Restyled.', 's1 reply Fixed.']);
  assert.deepEqual(t.items.map(i => i.name), ['api', 'web', 'api', 'web', 'api']);
  assert.deepEqual(Object.keys(t.items[2]).sort(), ['agent', 'at', 'kind', 'name', 'step', 'text', 'tool'], 'a step: its one-liner only, never its input or output');
  assert.equal(t.truncated, false);
  assert.equal(t.now, at(999));
  assert.deepEqual(brief(timeline(sessions, { since: at(3) })), ['s2 reply Restyled.', 's1 reply Fixed.']);
});

test('a message over 4,000 characters comes cut there, marked more', () => {
  const t = timeline({ s1: { model: modelOf(prompt(0, 'go'), reply(1, 'x'.repeat(4500))) } });
  const r = t.items.find(i => i.kind === 'reply');
  assert.equal(r.body.length, 4000);
  assert.equal(r.more, true);
  assert.equal(t.items.find(i => i.kind === 'prompt').more, undefined);
});

test('at most maxItems, the newest, and truncated says some were left out', () => {
  const lines = Array.from({ length: 30 }, (_, k) => (k % 2 ? reply(k, `r${k}`) : prompt(k, `p${k}`)));
  const t = timeline({ s1: { model: modelOf(...lines) } }, { maxItems: 10 });
  assert.equal(t.truncated, true);
  assert.equal(t.items.length, 10);
  assert.equal(t.items[0].body, 'p20');
  assert.equal(t.items.at(-1).body, 'r29');
});

test('Codex, and a session with no transcript read yet, are left out', () => {
  const t = timeline({ c1: { kind: 'codex', model: modelOf(prompt(0, 'hidden')) }, s0: {}, s1: { model: modelOf(prompt(1, 'shown')) } });
  assert.deepEqual(brief(t), ['s1 prompt shown']);
});

test('a message from one watched session to another is one item, from → to, with both ids', () => {
  const t = timeline({
    a: { name: 'docs', pid: 11, model: modelOf(prompt(0, 'go'), sendTo(5, 'm1', 'release', 'The README is done.', 'Docs are done')) },
    b: { name: 'release', pid: 22, model: modelOf(prompt(1, 'go'), peerIn(6, 'docs', 'The README is done.', { verifiedPeerPid: 11, msg_id: 'x1' })) },
  });
  const peers = t.items.filter(i => i.kind === 'peer');
  assert.deepEqual(peers, [{ agent: 'a', name: 'docs', at: at(5), kind: 'peer', from: 'docs', to: 'release', fromId: 'a', toId: 'b', summary: 'Docs are done', body: 'The README is done.' }]);
});

test("a message whose other end isn't watched is kept from the side that has it", () => {
  const t = timeline({
    a: { name: 'docs', model: modelOf(prompt(0, 'go'), sendTo(2, 'm1', 'a0123456789abcdef', 'Look into the cache.'), sendTo(3, 'm2', 'elsewhere', 'Ping.')) },
    b: { name: 'release', pid: 22, model: modelOf(prompt(1, 'go'), peerIn(4, 'outsider', 'Hello from outside.')) },
  });
  const peers = t.items.filter(i => i.kind === 'peer').map(({ from, to, fromId, toId, helper }) => ({ from, to, fromId, toId, helper }));
  assert.deepEqual(peers, [
    { from: 'docs', to: 'a0123456789abcdef', fromId: 'a', toId: undefined, helper: true },
    { from: 'docs', to: 'elsewhere', fromId: 'a', toId: undefined, helper: undefined },
    { from: 'outsider', to: 'release', fromId: undefined, toId: 'b', helper: undefined },
  ]);
});

test('two sessions with the same name: a message to that name is merged with neither copy', () => {
  const t = timeline({
    a: { name: 'docs', model: modelOf(prompt(0, 'go'), sendTo(2, 'm1', 'twin', 'Hi.')) },
    b: { name: 'twin', model: modelOf(prompt(1, 'go'), peerIn(3, 'docs', 'Hi.')) },
    c: { name: 'twin', model: modelOf(prompt(1, 'go')) },
  });
  const peers = t.items.filter(i => i.kind === 'peer');
  assert.equal(peers.length, 2, 'the sent one and the received one, apart');
  assert.equal(peers[0].toId, undefined, "which twin can't be told");
  assert.equal(peers[1].fromId, 'a', 'the received one still knows its sender');
});

test("a subagent's result is an item at the time it finished; one still running, one with no result, or a background job, is not", () => {
  const m = modelOf(prompt(0, 'go'));
  m.children.set('t1', { id: 't1', kind: 'subagent', agentType: 'Explore', label: 'Survey the fields', state: 'done', startedAt: at(1), endedAt: at(7), result: 'Wheat in the north field.' });
  m.children.set('t2', { id: 't2', kind: 'subagent', agentType: 'Explore', label: 'Still going', state: 'running', startedAt: at(2) });
  m.children.set('t3', { id: 't3', kind: 'bgjob', label: 'npm run dev', state: 'done', startedAt: at(2), endedAt: at(3), result: 'ready' });
  const t = timeline({ s1: { model: m } });
  assert.deepEqual(t.items.filter(i => i.kind === 'subagent'), [{ agent: 's1', name: 's1', at: at(7), kind: 'subagent', childId: 't1', agentType: 'Explore', label: 'Survey the fields', body: 'Wheat in the north field.' }]);
});

test('a restore is an item at the time it happened, saying where it went back to, so a read since then gets it', () => {
  const model = modelOf(prompt(0, 'Plan it', { uuid: 'p-1' }), reply(1, 'Planned.'), prompt(2, 'Ship it', { uuid: 'p-2', parentUuid: 'r-1' }), reply(5, 'Shipped.'), rewound('r-1'));
  const t = timeline({ s1: { model } }, { since: at(5) });
  assert.deepEqual(t.items, [{ agent: 's1', name: 's1', at: at(5), kind: 'restored', text: 'Ship it', back: at(2) }]);
});
