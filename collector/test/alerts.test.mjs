import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../config.mjs';
import { AlertEngine } from '../alerts.mjs';

const agent = over => ({ id: 'a1', name: 'my-app', state: 'working', stateReason: 'busy', stateSince: 1000, proc: { cpu: 1, rssMb: 100 }, ...over });
const snap = (agents, collisions = []) => ({ agents, collisions });
function engine(cfg = { ...DEFAULTS, notify: { ...DEFAULTS.notify } }) {
  const sent = [];
  const e = new AlertEngine({ cfg, notify: (title, message) => sent.push([title, message]), startedAt: 0, warmupMs: 10_000 });
  return { e, sent };
}
const NONE = new Map();

test('an agent that starts waiting raises one notification', () => {
  const { e, sent } = engine();
  const s = snap([agent({ state: 'waiting', stateReason: 'question pending', stateSince: 20_000 })]);
  e.process(s, 20_000, NONE);
  e.process(s, 23_000, NONE);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], ['my-app needs you', 'question pending']);
});

test('state already present during warm-up never notifies, even after warm-up', () => {
  const { e, sent } = engine();
  const s = snap([agent({ state: 'waiting', stateSince: 1 })]);
  e.process(s, 5_000, NONE);
  e.process(s, 15_000, NONE);
  assert.equal(sent.length, 0);
});

test('flapping between waiting and working does not repeat the alert', () => {
  const { e, sent } = engine();
  const waiting = snap([agent({ state: 'waiting', stateSince: 20_000 })]);
  e.process(waiting, 20_000, NONE);
  e.process(snap([agent({ state: 'working' })]), 23_000, NONE);
  e.process(waiting, 26_000, NONE);
  assert.equal(sent.length, 1);
});

test('a new waiting episode alerts again', () => {
  const { e, sent } = engine();
  e.process(snap([agent({ state: 'waiting', stateSince: 20_000 })]), 20_000, NONE);
  e.process(snap([agent({ state: 'working' })]), 30_000, NONE);
  e.process(snap([agent({ state: 'waiting', stateSince: 40_000 })]), 40_000, NONE);
  assert.equal(sent.length, 2);
});

test('a finished turn alerts with the last reply', () => {
  const { e, sent } = engine();
  e.process(snap([agent({ state: 'yourTurn', stateSince: 20_000, lastReply: 'All done.' })]), 20_000, NONE);
  assert.deepEqual(sent, [['my-app finished', 'All done.']]);
});

test('stale agents never notify', () => {
  const { e, sent } = engine();
  e.process(snap([agent({ state: 'stale', proc: { cpu: 1, rssMb: 9000 } })]), 20_000, NONE);
  assert.equal(sent.length, 0);
});

test('a notify toggle silences its family', () => {
  const { e, sent } = engine({ ...DEFAULTS, notify: { ...DEFAULTS.notify, waiting: false } });
  e.process(snap([agent({ state: 'waiting', stateSince: 20_000 })]), 20_000, NONE);
  assert.equal(sent.length, 0);
});

test('memory over the threshold alerts once and re-arms only below 80 %', () => {
  const { e, sent } = engine();
  const rss = mb => snap([agent({ proc: { cpu: 1, rssMb: mb } })]);
  e.process(rss(2100), 20_000, NONE);
  e.process(rss(1800), 23_000, NONE);
  e.process(rss(2100), 26_000, NONE);
  assert.equal(sent.length, 1);
  e.process(rss(1000), 29_000, NONE);
  e.process(rss(2100), 32_000, NONE);
  assert.equal(sent.length, 2);
});

test('CPU alerts only once the whole sustain window is above the threshold', () => {
  const { e, sent } = engine();
  const hot = (fromMs, toMs) => {
    const h = [];
    for (let t = fromMs; t <= toMs; t += 3000) h.push({ at: t, cpu: 95 });
    return h;
  };
  const s = snap([agent({ proc: { cpu: 95, rssMb: 100 } })]);
  e.process(s, 60_000, new Map([['a1', hot(20_000, 60_000)]]));
  assert.equal(sent.length, 0);
  e.process(s, 150_000, new Map([['a1', hot(20_000, 150_000)]]));
  assert.equal(sent.length, 1);
});

test('a collision alerts once, and again after it clears and comes back', () => {
  const { e, sent } = engine();
  const c = { repo: '/p/backend', agentIds: ['a', 'b'], severity: 'high', since: 1, reason: '2 agents writing · git command' };
  e.process(snap([], [c]), 20_000, NONE);
  e.process(snap([], [c]), 23_000, NONE);
  e.process(snap([], []), 26_000, NONE);
  e.process(snap([], [c]), 29_000, NONE);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], ['Collision in backend', '2 agents writing · git command']);
});

// Windows: with a dozen sessions running, the memory and cpu alerts and a burst of "needs you" pop-ups were
// constant PowerShell toasts. The Windows defaults leave memory and cpu off and cap how many toasts one minute can raise.
test('Windows defaults turn memory and cpu alerts off; macOS defaults are unchanged', async () => {
  const { mergeConfig } = await import('../config.mjs');
  const win = mergeConfig({}, 'win32');
  assert.equal(win.notify.memory, false);
  assert.equal(win.notify.cpu, false);
  assert.equal(win.notify.waiting, true);
  assert.equal(win.notifyMaxPerMin, 3);
  const mac = mergeConfig({}, 'darwin');
  assert.deepEqual(mac.notify, { waiting: true, collision: true, yourTurn: true, memory: true, cpu: true });
  assert.equal(mac.notifyMaxPerMin, 0);
  // the owner's own config.json still wins
  const own = mergeConfig({ notify: { cpu: true }, notifyMaxPerMin: 10 }, 'win32');
  assert.equal(own.notify.cpu, true);
  assert.equal(own.notifyMaxPerMin, 10);
});

test('past the per-minute cap the extra alerts become one summary toast, not a flood', () => {
  const cfg = { ...DEFAULTS, notify: { ...DEFAULTS.notify }, notifyMaxPerMin: 3 };
  const { e, sent } = engine(cfg);
  const agents = Array.from({ length: 8 }, (_, i) => agent({ id: `a${i}`, name: `app${i}`, state: 'waiting', stateSince: 20_000 }));
  e.process(snap(agents), 20_000, NONE);
  assert.equal(sent.length, 4); // 3 individual + 1 summary
  assert.deepEqual(sent[3], ['5 more alerts', 'See the dashboard']);
  // a minute later the cap resets
  e.process(snap([agent({ id: 'z', name: 'later', state: 'waiting', stateSince: 90_000 })]), 90_000, NONE);
  assert.equal(sent.length, 5);
  assert.equal(sent[4][0], 'later needs you');
});

test('a cap of 0 means no limit', () => {
  const { e, sent } = engine({ ...DEFAULTS, notify: { ...DEFAULTS.notify }, notifyMaxPerMin: 0 });
  const agents = Array.from({ length: 8 }, (_, i) => agent({ id: `a${i}`, state: 'waiting', stateSince: 20_000 }));
  e.process(snap(agents), 20_000, NONE);
  assert.equal(sent.length, 8);
});
