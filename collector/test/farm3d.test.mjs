// The 3D farm's model (web/worlds/farm3d/model.js, layout.js, route.js, camera.js's helpers): the 2D farm's rules,
// pinned to the farm's own functions (window.AgentvilleFarm), so the two farms always agree on who stands where
// and what each field shows. The SDK and the farm run in a vm, as the frame has them; the model is imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { makeModel } from '../../web/worlds/farm3d/model.js';
import { walkRoute } from '../../web/worlds/farm3d/route.js';
import { CORR, toWorld, W } from '../../web/worlds/farm3d/layout.js';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the vm have another realm's prototypes
function stubDom() { // enough of a DOM for the SDK and the farm to load (they draw nothing here)
  const make = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (['width', 'height', 'offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'length'].includes(k)) return t[k] ?? 0;
      if (k === 'style') return (t[k] ??= { setProperty() {}, removeProperty() {} });
      if (k === 'dataset') return (t[k] ??= {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'querySelectorAll') return () => [];
      if (k === 'measureText') return () => ({ width: 0 });
      return (t[k] ??= make());
    },
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => make(),
  });
  return Object.assign(make(), { hidden: false });
}
function load() {
  const window = { Agentville: { raw: () => {} } };
  const ctx = vm.createContext({ window, document: stubDom(), console, Math, Date, JSON, Map, Set, Intl, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} });
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js', 'worlds/farm/world.js', 'worlds/test/tour.js']) vm.runInContext(web(f), ctx, { filename: f });
  const g = name => vm.runInContext(name, ctx);
  const kit = { makeGrid: g('makeGrid'), engineScene: g('engineScene'), tagText: g('tagText'), cutMid: g('cutMid'), lastPart: g('lastPart'), ago: g('ago'), lookFor: window.Agentville.people.lookFor, pick: window.Agentville.people.pick };
  return { kit, farm: window.AgentvilleFarm, toScene: window.AgentvilleScene.toScene, stops: window.AgentvilleTour.stops };
}
const { kit, farm, toScene, stops } = load();
const M = makeModel(kit);
const NOW = Date.UTC(2026, 9, 9, 9, 0), HOME = '/Users/you/code';
const touch = (repo, mode = 'write', lastAt = NOW) => ({ path: `${repo}/f.ts`, mode, lastAt, repo });
const agent = (id, over = {}) => ({
  id, kind: 'interactive', name: id, cwd: `${HOME}/shop`, state: 'working', stateReason: 'busy', stateSince: NOW, feed: [], children: [], touching: [], contextTokens: 40_000,
  proc: { cpu: 5, rssMb: 300, pid: 1, childCount: 0, children: [] }, usage: { costUsd: 0.4 }, mode: 'default', model: 'claude-sonnet-5-5', fast: false, tasks: null, compactions: 0, mcp: [],
  now: { tool: 'Edit', summary: 'src/app.ts', step: 'edit', startedAt: NOW }, ...over,
});
const repo = (name, over = {}) => ({ path: `${HOME}/${name}`, name, branch: 'main', dirty: 0, ahead: 0, behind: 0, lastDeploy: null, ...over });
const snap = (agents, repos = []) => ({ generatedAt: NOW, agents, repos, collisions: [], settings: { cpuAlertPct: 90 } });
const model = (s, state = { beds: {}, packed: false }) => M.farmModel(toScene(s), state);

test("each state goes to the 2D farm's place, in order; a farmer over the cap is left out and counted", () => {
  const idle = { state: 'idle', now: null };
  const agents = [
    ...['w1', 'w2', 'w3', 'w4'].map(id => agent(id, { state: 'waiting', now: null })),
    ...['t1', 't2'].map(id => agent(id, { state: 'yourTurn', now: null })),
    ...['s1', 's2', 's3', 's4', 's5'].map(id => agent(id, { state: 'stale', now: null })),
    ...['i1', 'i2'].map(id => agent(id, idle)),
    ...['m1', 'm2', 'm3', 'm4', 'm5'].map(id => agent(id, { cwd: '/elsewhere' })),
  ];
  const m = model(snap(agents));
  const at = id => m.farmers.find(f => f.id === id)?.at;
  assert.deepEqual([at('w1'), at('w2'), at('w3')], [[142, 78], [166, 78], [190, 78]], 'waiting: the porch, left');
  assert.equal(at('w4'), undefined, 'a fourth waiting farmer is not drawn');
  assert.equal(m.over.desk, 1);
  assert.deepEqual([at('t1'), at('t2')], [[258, 78], [234, 78]], 'turn: the porch, right');
  assert.deepEqual(at('s1'), [328, 78]);
  assert.equal(m.over.storage, 1);
  assert.ok(m.farmers.find(f => f.id === 's1').scarecrow);
  const y = m.ground.GRID.y1 - 6;
  assert.deepEqual([at('i1'), at('i2')], [[64, y], [40, y + 2]], 'idle: under the shade tree');
  assert.deepEqual(at('m1'), [28, 162], 'working outside any repo: the meadow');
  assert.equal(m.over.meadow, 1);
  assert.equal(m.farmers.length, 3 + 2 + 4 + 2 + 4);
});

test("a working farmer stands in its bed at its step's offset, the next free offset when several share it", () => {
  const shop = `${HOME}/shop`;
  const s = snap([agent('a', { touching: [touch(shop)] }), agent('b', { now: { tool: 'Read', step: 'read', summary: 'x', startedAt: NOW }, touching: [touch(shop)] }), agent('c', { touching: [touch(shop)] })], [repo('shop')]);
  const m = model(s), bed = m.beds[0], f = id => m.farmers.find(x => x.id === id);
  assert.equal(f('a').field, bed.key);
  assert.deepEqual(f('a').at, [bed.cx + 26, bed.lane], 'edit: the soil side');
  assert.deepEqual(f('b').at, [bed.cx - 26, bed.lane], 'read: the reading side');
  assert.deepEqual(f('c').at, [bed.cx, bed.lane], 'a second edit: the next free offset');
  assert.equal(f('a').prop, 'hoe');
  assert.equal(f('a').action, 'swing');
  assert.equal(f('b').action, 'hold');
});

test("the props and the verbs are the farm's, step by step", () => {
  for (const step of ['edit', 'write', 'read', 'search', 'web', 'mcp', 'skill', 'test', 'lint', 'build', 'install', 'commit', 'push', 'deploy', 'pull', 'serve', 'delete', 'agent', 'plan', 'ask', 'shell', 'other', 'nonsense', null]) {
    assert.deepEqual(plain(M.actionOf(step, 'Bash')), plain(farm.actionOf(step, 'Bash')), String(step));
  }
  assert.deepEqual(plain(M.actionOf(null, 'Grep')), plain(farm.actionOf(null, 'Grep')), 'an older snapshot: by its tool');
});

test("beds: the same places as the 2D farm's, from an empty bed map", () => {
  const names = ['api', 'web', 'docs', 'infra', 'mobile', 'site', 'cli'];
  const repos = names.map(n => repo(n)), agents = names.map((n, i) => agent(`a${i}`, { touching: [touch(`${HOME}/${n}`)] }));
  const s = toScene(snap(agents, repos));
  const mine = M.farmModel(s, { beds: {}, packed: false }).ground;
  const theirs = farm.packedLayout(farm.farmScene(s).fields, {});
  assert.deepEqual(plain(mine.ST.map(x => [x.key, x.i, x.cx, x.lane, x.x0, x.y0])), plain(theirs.ST.map(x => [x.key, x.i, x.cx, x.lane, x.x0, x.y0])));
  assert.equal(mine.rows, theirs.rows);
  assert.deepEqual(plain(mine.GRID), plain(theirs.GRID));
});

test('a field keeps its bed while you look: the bed map comes back to remember, and the next scene packs no more', () => {
  const two = snap([agent('a', { touching: [touch(`${HOME}/api`)] }), agent('b', { touching: [touch(`${HOME}/web`)] })], [repo('api'), repo('web')]);
  const first = model(two);
  assert.equal(first.keep.packed, true);
  const webBed = first.beds.find(b => b.name === 'web').i;
  const onlyWeb = snap([agent('b', { touching: [touch(`${HOME}/web`)] })], [repo('web')]);
  const next = M.farmModel(toScene(onlyWeb), first.keep);
  assert.equal(next.beds.find(b => b.name === 'web').i, webBed, 'web keeps its bed when api goes');
});

test('growth, dry and bare beds; the piles and their caps', () => {
  for (const p of [0, 0.05, 0.12, 0.3, 0.5, 0.7, 0.85, 1]) assert.equal(M.growthStage(p), farm.growthStage(p), String(p));
  const s = snap([agent('a', { contextTokens: 120_000, touching: [touch(`${HOME}/api`)] }), agent('z', { state: 'stale', now: null, touching: [touch(`${HOME}/old`)] })],
    [repo('api', { dirty: 20, ahead: 30, behind: 2 }), repo('old', { dirty: 1, ahead: 1 }), repo('idle')]);
  const beds = Object.fromEntries(model(s).beds.map(b => [b.name, b]));
  assert.equal(beds.api.plot.kind, 'grow');
  assert.equal(beds.api.plot.busy, true);
  assert.deepEqual(beds.api.piles, { hay: 4, crates: 4, mailbox: true, dirty: 20, ahead: 30, behind: 2 });
  assert.deepEqual(beds.old.piles, { hay: 1, crates: 1, mailbox: false, dirty: 1, ahead: 1, behind: 0 });
  assert.equal(beds.old.plot.kind, 'dry');
  assert.equal(beds.idle.plot.kind, 'bare');
});

test("crop, fence, soil, pennant and weather are the farm's for each repo", () => {
  const repos = [repo('api'), repo('web', { branch: 'feature/x' }), repo('docs', { lastDeploy: { state: 'failed', label: 'deploy failed' } }), repo('cli', { lastDeploy: { state: 'ok', label: 'deployed' } }), repo('site', { lastDeploy: { state: 'running', label: 'deploying' } })];
  const s = toScene(snap([], repos)), theirs = farm.farmScene(s).fields, mine = M.farmModel(s, { beds: {}, packed: false }).beds;
  for (const f of theirs) {
    const b = mine.find(x => x.key === f.key);
    assert.deepEqual([b.crop, b.fence, b.soil, b.pennant, b.weather], [f.crop, f.fence, f.soil, f.pennant, f.weather], f.name);
  }
  for (const d of [{ state: 'running' }, { state: 'ok' }, { state: 'failed' }, { state: 'blocked' }, { state: 'other' }, { status: 'in_progress' }, { status: 'completed', conclusion: 'success' }, null]) assert.equal(M.weatherOf(d), farm.weatherOf(d), JSON.stringify(d));
});

test("the season and the silos follow the farm's thresholds; two accounts, two silos", () => {
  for (const pct of [0, 24, 25, 59, 60, 69, 70, 84, 85, 89, 90, 100]) {
    const plan = { windows: [{ kind: 'five_hour', percentUsed: pct }, { kind: 'seven_day', percentUsed: pct }] };
    assert.equal(M.seasonOf(plan), farm.seasonOf(plan), `${pct}%`);
    assert.deepEqual(plain(M.siloOf(plan)), plain(farm.siloOf(plan)), `${pct}%`);
  }
  assert.equal(M.seasonOf(null), 'summer');
  const s = toScene({ ...snap([], []), accounts: [{ key: 'main', name: 'work', plan: { windows: [{ kind: 'seven_day', percentUsed: 40 }] } }, { key: 'zeta', name: 'home', plan: { windows: [{ kind: 'seven_day', percentUsed: 92 }] } }] });
  assert.deepEqual(plain(M.farmModel(s, { beds: {}, packed: false }).silos), plain(farm.silosOf(farm.farmScene(s))));
});

test("labels: the name, a branch other than main, and a worktree's repo by its folder's name, on Windows too", () => {
  const repos = [{ ...repo('api'), path: 'C:\\Users\\me\\code\\api' }, { ...repo('api-wt', { branch: 'feature/cart' }), path: 'C:\\Users\\me\\code\\api-wt', worktree: true, main: 'C:\\Users\\me\\code\\api' }];
  const agents = [agent('a', { cwd: 'C:\\Users\\me\\code\\api', touching: [touch('C:\\Users\\me\\code\\api')] }), agent('b', { cwd: 'C:\\Users\\me\\code\\api-wt', touching: [touch('C:\\Users\\me\\code\\api-wt')] })];
  const m = model(snap(agents, repos));
  const [first, second] = [...m.beds].sort((x, y) => x.i - y.i);
  assert.equal(second.i, first.i + 1, 'the worktree right after its repo');
  assert.deepEqual(first.label, ['api']);
  assert.deepEqual(second.label, ['api-wt feature/cart', 'worktree of api']);
  assert.equal(second.worktree, true);
});

test('an empty farm, and a scene with odd or missing fields, never throw', () => {
  const m = model(snap([], []));
  assert.deepEqual([m.beds.length, m.farmers.length, m.ground.rows], [0, 0, 3]);
  const odd = snap([agent('a', { now: { tool: 'Mystery' }, model: null, tasks: undefined, name: undefined }), agent('b', { state: 'waiting', now: null })], []);
  const o = model(odd);
  assert.equal(o.farmers.find(f => f.id === 'a').prop, 'can', 'an unknown tool: the watering can');
  assert.equal(o.farmers.find(f => f.id === 'b').badge, '!');
});

test('every stop of the tour runs through the model, and each drawn farmer has a tag and a place', () => {
  for (const stop of stops) for (const frame of stop.frames) {
    const m = model(frame);
    for (const f of m.farmers) {
      assert.equal(typeof f.tag, 'string', `${stop.name}: ${f.id}`);
      assert.ok(Number.isFinite(f.at[0]) && Number.isFinite(f.at[1]), `${stop.name}: ${f.id}`);
    }
  }
});

test('walking: along the row to the nearest path, down it, along to the spot; a door first', () => {
  assert.deepEqual(walkRoute([62, 87], [200, 87], CORR), [[200, 87]]);
  assert.deepEqual(walkRoute([62, 87], [200, 144], CORR), [[116, 87], [116, 144], [200, 144]]);
  assert.deepEqual(walkRoute([62, 87], [300, 206], CORR), [[116, 87], [116, 206], [300, 206]], 'a tie between paths: the first, as the engine has it');
  assert.deepEqual(walkRoute([330, 87], [300, 206], CORR), [[306, 87], [306, 206], [300, 206]]);
  assert.deepEqual(walkRoute([62, 80], [200, 144], CORR, [62, 87]), [[62, 87], [116, 87], [116, 144], [200, 144]]);
});

test('the 2D → 3D mapping: 8 px a metre, centred on the farm', () => {
  assert.deepEqual(toWorld(W / 2, 200, 400), { x: 0, z: 0 });
  assert.deepEqual(toWorld(W, 400, 400), { x: 25, z: 25 });
  assert.deepEqual(toWorld(0, 0, 400), { x: -25, z: -25 });
});

test('the camera: four turns a quarter apart, the porch at the back first; a target kept over the farm; zoom steps', async () => {
  const { yawOf, clampTarget, ZOOMS, nextZoom, shortestTurn } = await import('../../web/worlds/farm3d/camera.js');
  assert.deepEqual([0, 1, 2, 3].map(t => +(yawOf(t) / Math.PI).toFixed(2)), [0.25, 0.75, 1.25, 1.75]);
  assert.deepEqual(clampTarget({ x: 99, z: -99 }, { x: 25, z: 30 }), { x: 25, z: -30 });
  assert.deepEqual(clampTarget({ x: 3, z: 4 }, { x: 25, z: 30 }), { x: 3, z: 4 });
  assert.ok(ZOOMS.includes(1));
  assert.equal(nextZoom(1, 1), 1.25); assert.equal(nextZoom(1, -1), 0.75); assert.equal(nextZoom(3, 1), 4, 'closer than the 2D farm goes: down to one farmer'); assert.equal(nextZoom(6, 1), 6); assert.equal(nextZoom(1.1, 1), 1.25, 'from between two steps: the next one up');
  assert.ok(Math.abs(shortestTurn(yawOf(3), yawOf(0)) - Math.PI / 2) < 1e-9, 'from the last turn to the first: a quarter on, not three back');
});

test('the camera fits the whole farm: every point lands inside the picture, and a bigger farm needs more distance', async () => {
  const { fitDistance, project } = await import('../../web/worlds/farm3d/camera.js');
  const box = (w, d, h) => [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [0, h].map(y => ({ x: sx * w / 2, y, z: sz * d / 2 }))));
  const view = { yaw: Math.PI / 4, pitch: (50 * Math.PI) / 180, fov: (30 * Math.PI) / 180, aspect: 1.6, target: { x: 0, y: 0, z: 0 } };
  const small = fitDistance(box(50, 40, 8), view), big = fitDistance(box(50, 63, 8), view);
  assert.ok(big > small);
  for (const p of box(50, 40, 8)) {
    const s = project(p, { ...view, distance: small });
    assert.ok(Math.abs(s.x) <= 0.93 && Math.abs(s.y) <= 0.93, JSON.stringify(s));
  }
  assert.ok(box(50, 40, 8).some(p => { const s = project(p, { ...view, distance: small }); return Math.abs(s.x) > 0.85 || Math.abs(s.y) > 0.85; }), 'and fills it: some point is near an edge');
});
