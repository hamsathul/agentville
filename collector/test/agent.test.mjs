import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../config.mjs';
import { applySince, buildAgent, countStates, sortAgents } from '../derive/agent.mjs';
import { at, modelOf, prompt, title, toolResult, toolUse } from './fixtures.mjs';

const cfg = { ...DEFAULTS };
const repoOf = p => (p.startsWith('/p/backend') ? '/p/backend' : null);
const base = (over = {}) => ({ id: 's1', kind: 'interactive', name: 'my-app', cwd: '/p', pid: 10, ...over });

test('buildAgent assembles state, now, feed, process and repo-mapped touches', () => {
  const m = modelOf(
    title('Fix invoices'),
    prompt(0, 'fix it'),
    toolUse(5, 't1', 'Edit', { file_path: '/p/backend/src/a.ts' }),
    toolResult(6, 't1'),
    toolUse(7, 't2', 'Bash', { command: 'npm test', description: 'Run tests' }, '/p/backend'),
  );
  const a = buildAgent({
    base: base({ cliId: 'abc' }), model: m, registry: { status: 'busy' },
    proc: { cpu: 5, rssMb: 300, childCount: 1, children: ['node x'] }, cpuHistory: [{ at: at(7), cpu: 5, rssMb: 300 }],
    repoOf, now: at(8), cfg, home: '/h',
  });
  assert.equal(a.state, 'working');
  assert.equal(a.name, 'my-app');
  assert.equal(a.title, 'Fix invoices');
  assert.equal(a.cliId, 'abc');
  assert.deepEqual(a.now, { tool: 'Bash', summary: 'Run tests', startedAt: at(7) });
  assert.equal(a.feed[0].tool, 'Bash');
  assert.equal(a.touching.find(t => t.mode === 'write').repo, '/p/backend');
  assert.deepEqual(a.proc.history, { at: [at(7)], cpu: [5], rssMb: [300] });
  assert.equal(a.lastPrompt, 'fix it');
});

test('name falls back to the transcript title, then the folder name', () => {
  const titled = buildAgent({ base: base({ name: '' }), model: modelOf(title('Fix invoices')), repoOf, now: at(0), cfg, home: '/h' });
  assert.equal(titled.name, 'Fix invoices');
  const bare = buildAgent({ base: base({ name: '', cwd: '/x/site' }), model: null, repoOf, now: at(0), cfg, home: '/h' });
  assert.equal(bare.name, 'site');
});

test('codex agents take their state from CPU and have no feed', () => {
  const a = buildAgent({ base: { id: 'codex:200', kind: 'codex', name: 'Codex (VS Code)', cwd: '', pid: 200 }, model: null, proc: { cpu: 30, rssMb: 50, childCount: 0, children: [] }, cpuHistory: [{ at: at(0), cpu: 30 }], repoOf, now: at(1), cfg, home: '/h' });
  assert.equal(a.state, 'working');
  assert.deepEqual(a.feed, []);
});

test("a subagent's own transcript keeps it running, and its calls count as the parent's touches", () => {
  const parent = modelOf(prompt(0, 'go'), toolUse(1, 'tA', 'Agent', { description: 'Find routes', run_in_background: true }), toolResult(2, 'tA'));
  const child = modelOf(prompt(1, 'task'), toolUse(50, 'c1', 'Edit', { file_path: '/p/backend/x.ts' }));
  const a = buildAgent({ base: base(), model: parent, childModels: new Map([['tA', child]]), repoOf, now: at(55), cfg, home: '/h' });
  assert.equal(a.children[0].state, 'running');
  assert.equal(a.children[0].now.tool, 'Edit');
  assert.ok(a.touching.some(t => t.repo === '/p/backend' && t.mode === 'write'));
});

test('finished children older than an hour are dropped', () => {
  const parent = modelOf(prompt(0, 'go'), toolUse(1, 'tA', 'Agent', { description: 'Old' }), toolResult(2, 'tA'));
  const a = buildAgent({ base: base(), model: parent, repoOf, now: at(2 + 3700), cfg, home: '/h' });
  assert.deepEqual(a.children, []);
});

test('applySince keeps the first time an agent entered its state', () => {
  const first = applySince({ id: 'a', state: 'working', sinceHint: undefined }, undefined, 1000);
  assert.equal(first.stateSince, 1000);
  assert.equal('sinceHint' in first, false);
  const again = applySince({ id: 'a', state: 'working' }, first, 5000);
  assert.equal(again.stateSince, 1000);
  const moved = applySince({ id: 'a', state: 'yourTurn', sinceHint: 4000 }, again, 6000);
  assert.equal(moved.stateSince, 4000);
  const switched = applySince({ id: 'a', state: 'idle' }, moved, 7000);
  assert.equal(switched.stateSince, 7000);
});

test('sortAgents orders by state, then newest activity', () => {
  const list = [
    { id: 'i', state: 'idle' },
    { id: 'w1', state: 'working', lastActivityAt: 1 },
    { id: 'q', state: 'waiting' },
    { id: 'w2', state: 'working', lastActivityAt: 2 },
    { id: 's', state: 'stale' },
    { id: 'y', state: 'yourTurn' },
  ];
  assert.deepEqual(sortAgents(list).map(a => a.id), ['q', 'w2', 'w1', 'y', 's', 'i']);
});

test('countStates counts each state and the collisions', () => {
  assert.deepEqual(countStates([{ state: 'working' }, { state: 'working' }, { state: 'stale' }], [{}]), { waiting: 0, working: 2, yourTurn: 0, stale: 1, idle: 0, collisions: 1 });
});

test('an offered question that is still pending can be answered from the dashboard', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_Q1', 'AskUserQuestion', { questions: [{ question: 'Pick a colour?' }] }));
  const questions = [{ question: 'Pick a colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }];
  const a = buildAgent({ base: base(), model: m, offer: { kind: 'question', toolUseId: 'toolu_Q1', createdAt: at(5), questions }, repoOf, now: at(6), cfg, home: '/h' });
  assert.equal(a.state, 'waiting');
  assert.deepEqual(a.ask, { kind: 'question', toolUseId: 'toolu_Q1', questions });
});

test('an offered question that was already answered in the terminal is not answerable', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_Q1', 'AskUserQuestion'), toolResult(7, 'toolu_Q1'));
  const a = buildAgent({ base: base(), model: m, offer: { kind: 'question', toolUseId: 'toolu_Q1', createdAt: at(5), questions: [] }, repoOf, now: at(8), cfg, home: '/h' });
  assert.equal(a.ask, undefined);
});

test('an offered permission prompt makes the agent certainly waiting, with Allow/Deny details', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_P1', 'Bash', { command: 'mkdir /tmp/x' }));
  const offer = { kind: 'permission', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'mkdir /tmp/x', createdAt: at(5), expiresAt: at(20) };
  const a = buildAgent({ base: base(), model: m, registry: { status: 'busy' }, cpuHistory: [{ at: at(5), cpu: 40 }], offer, repoOf, now: at(6), cfg, home: '/h' });
  assert.equal(a.state, 'waiting');
  assert.equal(a.stateReason, 'permission needed: Bash');
  assert.equal(a.sinceHint, at(5));
  assert.deepEqual(a.ask, { kind: 'permission', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'mkdir /tmp/x', expiresAt: at(20) });
});

test('an expired permission offer is ignored', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_P1', 'Bash'));
  const offer = { kind: 'permission', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'x', createdAt: at(5), expiresAt: at(20) };
  const a = buildAgent({ base: base(), model: m, registry: { status: 'busy' }, offer, repoOf, now: at(21), cfg, home: '/h' });
  assert.equal(a.state, 'working');
  assert.equal(a.ask, undefined);
});

test('process history keeps the last 200 samples for the 10-minute charts', () => {
  const hist = Array.from({ length: 250 }, (_, i) => ({ at: at(i * 3), cpu: i, rssMb: 100 + i }));
  const a = buildAgent({ base: base(), model: null, proc: { cpu: 1, rssMb: 1, childCount: 0, children: [] }, cpuHistory: hist, repoOf, now: at(750), cfg, home: '/h' });
  assert.equal(a.proc.history.cpu.length, 200);
  assert.equal(a.proc.history.cpu[0], 50);
  assert.equal(a.proc.history.rssMb.at(-1), 349);
});

test('activity counts tool calls per minute over the last 30 minutes, newest last', () => {
  const m = modelOf(
    prompt(0, 'go'),
    toolUse(10, 't1', 'Read', { file_path: '/a' }),
    toolUse(20, 't2', 'Read', { file_path: '/b' }),
    toolUse(29 * 60 + 5, 't3', 'Bash', { command: 'ls' }),
  );
  const a = buildAgent({ base: base(), model: m, repoOf, now: at(30 * 60), cfg, home: '/h' });
  assert.equal(a.activity.length, 30);
  assert.equal(a.activity[0], 2);
  assert.equal(a.activity[29], 1);
  assert.equal(a.activity.reduce((t, n) => t + n, 0), 3);
});

test('the timeline lists recent tool calls with their time, newest last', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 't1', 'Edit', { file_path: '/a' }), toolUse(9, 't2', 'Bash', { command: 'ls' }));
  const a = buildAgent({ base: base(), model: m, repoOf, now: at(10), cfg, home: '/h' });
  assert.deepEqual(a.timeline, [{ at: at(5), tool: 'Edit' }, { at: at(9), tool: 'Bash' }]);
});
