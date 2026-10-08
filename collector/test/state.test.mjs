import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../config.mjs';
import { deriveCodexState, deriveState } from '../derive/state.mjs';
import { at, modelOf, prompt, reply, title, toolResult, toolUse, turnEnd } from './fixtures.mjs';

const cfg = { ...DEFAULTS };
const samples = (fromSec, toSec, cpu) => {
  const out = [];
  for (let s = fromSec; s <= toSec; s += 3) out.push({ at: at(s), cpu });
  return out;
};

test('no transcript is idle', () => {
  assert.equal(deriveState({ model: null, now: at(0), cfg }).state, 'idle');
});

test('a pending AskUserQuestion is waiting even while the registry says busy', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'q1', 'AskUserQuestion', { questions: [{ question: 'Ship?' }] }));
  const s = deriveState({ model: m, registry: { status: 'busy' }, now: at(6), cfg });
  assert.deepEqual(s, { state: 'waiting', reason: 'question pending', since: at(5) });
});

test('a pending ExitPlanMode is waiting for plan approval', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'p1', 'ExitPlanMode', { plan: 'x' }));
  assert.equal(deriveState({ model: m, now: at(6), cfg }).reason, 'plan approval');
});

test('a tool pending 20 s while the process is quiet is probably a permission prompt', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(10, 't1', 'Bash', { command: 'rm -rf build' }));
  const s = deriveState({ model: m, registry: { status: 'busy' }, cpuHistory: samples(0, 40, 0.2), now: at(40), cfg });
  assert.deepEqual(s, { state: 'waiting', reason: 'probably a permission prompt', since: at(10) });
});

test("in bypass or don't-ask mode a quiet tool call is never taken for a permission prompt: none can show there", () => {
  const m = modelOf(prompt(0, 'go'), toolUse(10, 't1', 'mcp__claude-in-chrome__navigate', { url: 'http://localhost' }));
  for (const mode of ['bypassPermissions', 'dontAsk']) assert.equal(deriveState({ model: m, registry: { status: 'busy' }, cpuHistory: samples(0, 40, 0.2), now: at(40), cfg, mode }).state, 'working', mode);
  assert.equal(deriveState({ model: m, registry: { status: 'busy' }, cpuHistory: samples(0, 40, 0.2), now: at(40), cfg, mode: 'auto' }).state, 'waiting', "auto's classifier may still hand one to you");
});

test('the same pending tool with a busy process is working', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(10, 't1', 'Bash', { command: 'npm run build' }));
  const s = deriveState({ model: m, registry: { status: 'busy' }, cpuHistory: samples(0, 40, 40), now: at(40), cfg });
  assert.deepEqual(s, { state: 'working', reason: 'running Bash' });
});

test('without CPU samples the permission guess is never made', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(10, 't1', 'Bash'));
  assert.equal(deriveState({ model: m, now: at(60), cfg }).state, 'working');
});

test('a tool pending for less than 20 s is working', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(10, 't1', 'Bash'));
  assert.equal(deriveState({ model: m, cpuHistory: samples(0, 15, 0), now: at(15), cfg }).state, 'working');
});

test('a session the registry marks busy is working', () => {
  const m = modelOf(prompt(0, 'go'), reply(5, 'ok'), turnEnd(6));
  assert.equal(deriveState({ model: m, registry: { status: 'busy' }, now: at(100), cfg }).state, 'working');
});

test('an open turn written in the last 60 s is working', () => {
  const m = modelOf(prompt(0, 'go'), reply(5, 'thinking about it'));
  assert.equal(deriveState({ model: m, registry: { status: 'idle' }, now: at(30), cfg }).state, 'working');
});

test('a finished turn is your turn, since the turn ended', () => {
  const m = modelOf(prompt(0, 'go'), reply(5, 'done'), turnEnd(6));
  assert.deepEqual(deriveState({ model: m, registry: { status: 'idle' }, now: at(30), cfg }), { state: 'yourTurn', reason: 'turn finished', since: at(6) });
});

test('an open turn quiet for over 60 s falls back to your turn', () => {
  const m = modelOf(prompt(0, 'go'), reply(5, 'done'));
  const s = deriveState({ model: m, now: at(200), cfg });
  assert.equal(s.state, 'yourTurn');
  assert.equal(s.since, at(5));
});

test('24 h without activity is stale, even with a question still pending', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'q1', 'AskUserQuestion'));
  const s = deriveState({ model: m, now: at(5) + 24 * 3_600_000, cfg });
  assert.equal(s.state, 'stale');
  assert.equal(s.since, at(5));
});

test('a finished turn whose prompt lies beyond the tail window is still your turn', () => {
  const m = modelOf(toolUse(1, 't1', 'Bash'), toolResult(2, 't1'), reply(5, 'done'), turnEnd(6));
  assert.deepEqual(deriveState({ model: m, registry: { status: 'shell' }, now: at(600), cfg }), { state: 'yourTurn', reason: 'turn finished', since: at(6) });
});

test('a session that has never had a prompt is idle', () => {
  assert.equal(deriveState({ model: modelOf(title('x')), now: at(0), cfg }).state, 'idle');
});

test('codex is working only when its average CPU over 15 s is above 5 %', () => {
  assert.equal(deriveCodexState([{ at: at(0), cpu: 20 }, { at: at(3), cpu: 20 }], at(5)).state, 'working');
  assert.equal(deriveCodexState([{ at: at(0), cpu: 1 }], at(5)).state, 'idle');
  assert.equal(deriveCodexState([], at(5)).state, 'idle');
});
