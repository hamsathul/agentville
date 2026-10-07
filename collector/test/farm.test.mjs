// Loads web/farm.js in a vm with a stub window and checks the scene adapter: the canvas code
// only ever reads what toScene returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = readFileSync(fileURLToPath(new URL('../../web/farm.js', import.meta.url)), 'utf8');
function load() {
  const window = {};
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  return window.TrackerFarm;
}
const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the vm have another realm's prototypes

const NOW = Date.now();
const repo = (path, over = {}) => ({ path, name: path.split('/').pop(), branch: 'main', dirty: 0, ahead: 0, behind: 0, agentIds: [], ...over });
const agent = (id, over = {}) => ({ id, kind: 'interactive', name: id, cwd: '/x', state: 'working', stateReason: 'busy', feed: [], children: [], touching: [], ...over });
const snapOf = (agents, repos, collisions = []) => ({ generatedAt: NOW, agents, repos, collisions, settings: { cpuAlertPct: 90 } });

test('the farm script loads without a DOM and exposes the adapter', () => {
  const farm = load();
  for (const name of ['mount', 'update', 'unmount', 'toScene', 'fieldOf', 'weatherOf', 'contextPct', 'askText']) assert.equal(typeof farm[name], 'function', name);
});

test('weather follows the deploy: rainbow on success, rain on failure, windmill while running, nothing otherwise', () => {
  const { weatherOf } = load();
  assert.equal(weatherOf({ status: 'completed', conclusion: 'success' }), 'rainbow');
  assert.equal(weatherOf({ status: 'completed', conclusion: 'failure' }), 'rain');
  assert.equal(weatherOf({ status: 'completed', conclusion: 'cancelled' }), null);
  assert.equal(weatherOf({ status: 'in_progress' }), 'windmill');
  assert.equal(weatherOf({ status: 'queued' }), 'windmill');
  assert.equal(weatherOf(undefined), null);
});

test("a farmer's field: its newest write, else its newest touch, else the repo holding its folder, else none", () => {
  const { fieldOf } = load();
  const repos = [repo('/code/app'), repo('/code/api'), repo('/code/app/packages/ui')];
  const t = (path, mode, lastAt, r) => ({ path, mode, lastAt, repo: r });
  assert.equal(fieldOf(agent('a', { touching: [t('/code/app/x', 'read', 9, '/code/app'), t('/code/api/y', 'write', 5, '/code/api')] }), repos), '/code/api');
  assert.equal(fieldOf(agent('a', { touching: [t('/code/app/x', 'read', 9, '/code/app'), t('/code/api/y', 'git', 7, '/code/api'), t('/code/app/z', 'write', 3, '/code/app')] }), repos), '/code/api');
  assert.equal(fieldOf(agent('a', { touching: [t('/code/app/x', 'read', 4, '/code/app'), t('/code/api/y', 'read', 8, '/code/api')] }), repos), '/code/api');
  assert.equal(fieldOf(agent('a', { cwd: '/code/app/packages/ui/src' }), repos), '/code/app/packages/ui');
  assert.equal(fieldOf(agent('a', { cwd: '/code/app' }), repos), '/code/app');
  assert.equal(fieldOf(agent('a', { cwd: '/code/apple' }), repos), null);
  assert.equal(fieldOf(agent('a', { kind: 'codex', cwd: '' }), repos), null);
});

test('context left: same limit rule as the list view', () => {
  const { contextPct } = load();
  assert.equal(contextPct(undefined), 0);
  assert.equal(contextPct(100_000), 0.5);
  assert.equal(contextPct(500_000), 0.5);
  assert.equal(contextPct(5_000_000), 1);
});

test('the porch bubble says what the agent is asking, or why it waits', () => {
  const { askText } = load();
  assert.equal(askText(agent('a', { ask: { kind: 'question', questions: [{ question: 'Ship it?' }] } })), 'Ship it?');
  assert.equal(askText(agent('a', { ask: { kind: 'permission', tool: 'Bash', summary: 'rm -rf build' } })), 'Bash: rm -rf build');
  assert.equal(askText(agent('a', { stateReason: 'question pending' })), 'question pending');
});

test('toScene maps repos to fields and agents to farmers', () => {
  const { toScene } = load();
  const repos = [
    repo('/code/app', { dirty: 7, ahead: 3, behind: 2, agentIds: ['w1'], deploy: { status: 'completed', conclusion: 'failure' } }),
    repo('/code/api', { branch: 'feature/x', ahead: undefined, behind: undefined }),
  ];
  const agents = [
    agent('w1', { touching: [{ path: '/code/app/a.ts', mode: 'write', lastAt: 5, repo: '/code/app' }], now: { tool: 'Edit' }, contextTokens: 180_000, proc: { cpu: 95 }, children: [{ id: 'c1', state: 'running', agentType: 'Explore' }, { id: 'c2', state: 'running' }, { id: 'c3', state: 'done' }] }),
    agent('t1', { state: 'yourTurn', lastReply: 'All done.\nSecond line', feed: [{ kind: 'reply', text: 'x' }, { kind: 'tool', tool: 'Bash' }] }),
    agent('q1', { state: 'waiting', ask: { kind: 'question', questions: [{ question: 'Which colour?' }] } }),
    agent('x1', { kind: 'codex', cwd: '', state: 'idle' }),
  ];
  const scene = toScene(snapOf(agents, repos, [{ repo: '/code/app', severity: 'high' }]), { cpuAlertPct: 90 });
  assert.deepEqual(plain(scene.fields.map(f => [f.key, f.name, f.branch, f.dirty, f.ahead, f.behind, f.weather, f.collision])), [
    ['/code/app', 'app', 'main', 7, 3, 2, 'rain', 'high'],
    ['/code/api', 'api', 'feature/x', 0, 0, 0, null, null],
  ]);
  const [w, t, q, x] = plain(scene.farmers);
  assert.deepEqual([w.state, w.field, w.tool, w.hot, w.hearts, w.kids], ['working', '/code/app', 'Edit', true, 0, [{ id: 'c1', dog: true }, { id: 'c2', dog: false }]]);
  assert.equal(Math.round(w.pct * 100), 90);
  assert.deepEqual([t.state, t.tool, t.reply, t.hearts], ['turn', 'Bash', 'All done.', 4]);
  assert.deepEqual([q.state, q.ask], ['waiting', 'Which colour?']);
  assert.deepEqual([x.kind, x.field, x.state], ['codex', null, 'idle']);
  assert.equal(w.color, toScene(snapOf([agents[0]], repos), { cpuAlertPct: 90 }).farmers[0].color, 'colour follows the id, not the list position');
});

test("a farmer's colour comes from its id, so the sidebar can match the shirt", () => {
  const farm = load();
  assert.equal(typeof farm.select, 'function');
  assert.match(farm.colorOf('abc'), /^#[0-9a-f]{6}$/);
  assert.equal(farm.colorOf('abc'), farm.colorOf('abc'));
  assert.equal(farm.colorOf('abc'), SHIRT_OF(farm, 'abc'));
});
const SHIRT_OF = (farm, id) => farm.toScene({ agents: [{ id, name: id, state: 'idle', touching: [] }], repos: [], collisions: [] }).farmers[0].shirt;

test('how to read the farm is one block of help, for the info dialog', () => {
  const html = load().helpHtml();
  for (const item of ['Your porch', 'Fields', 'Above a field', 'Weather', 'Hearts, crops', 'Click']) assert.match(html, new RegExp(`<b>${item}</b>`));
  assert.match(html, /^<div class="px-key">/);
});

test('a farmer whose turn ended with a question carries it, for the porch bubble', () => {
  const { toScene } = load();
  const [f] = plain(toScene(snapOf([agent('t', { state: 'yourTurn', question: 'Should I deploy?' })], []), { cpuAlertPct: 90 }).farmers);
  assert.equal(f.question, 'Should I deploy?');
});
