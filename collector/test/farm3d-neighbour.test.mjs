// The 3D farm's neighbour farm (spec 2026-10-14-farm3d-neighbour-design.md): the second Claude account's farm, east of
// yours across the road and the creek. The model, the layout, the walks, the machines, the animals and the visits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kit, toScene, privateScene, NOW, HOME, touch, agent, repo, snap } from './farm3d-vm.mjs';
import { makeModel } from '../../web/worlds/farm3d/model.js';
import { clampTarget, makeCameraRig } from '../../web/worlds/farm3d/camera.js';
import { plantsOf } from '../../web/worlds/farm3d/nature.js';
import { landRoute, walkRoute } from '../../web/worlds/farm3d/route.js';
import { dialogFor } from '../../web/worlds/farm3d/dialogs.js';
import { createMachines, passesFor } from '../../web/worlds/farm3d/machines.js';
import { cartOf, createCarts } from '../../web/worlds/farm3d/carts.js';
import { BED, SHED_DOOR } from '../../web/worlds/farm3d/layout.js';
import { roamOf } from '../../web/worlds/farm3d/roam.js';
import { HERDS, areaOn, makeAnimal, advance } from '../../web/worlds/farm3d/antics.js';
import { createVisits, VISIT_FIRST_MS, VISIT_GAP_MS, VISIT_NEAR } from '../../web/worlds/farm3d/visits.js';
import { createTalk, visitExchange } from '../../web/worlds/farm3d/talk.js';
import { CREEK, FARMSTEAD, GAP, LANE, NEIGHBOUR_X, PORCH_Y, ROAD, SILO_X, W, crossingsOf, east, extentOf, farmAt, farmOf, farmsteadOf, forestOf, landOf, pastureOf, slotTables } from '../../web/worlds/farm3d/layout.js';

const M = makeModel(kit);
const account = (key, name, pct = null) => ({ key, name, email: null, signedIn: true, open: 0, costUsd: 0, plan: pct === null ? null : { from: 'test', at: NOW, windows: [{ kind: 'seven_day', percentUsed: pct, resetsAt: null }] } });
const ACCOUNTS = [account('main', 'work', 40), account('zeta', 'home', 92)];
const two = (agents, repos = []) => ({ ...snap(agents, repos), accounts: ACCOUNTS });
const model = (s, keep = { beds: {}, packed: false }) => M.farmModel(toScene(s), keep);
const at = (m, id) => m.farmers.find(f => f.id === id)?.at;
const SHOP = `${HOME}/shop`, BLOG = `${HOME}/blog`, API = `${HOME}/api`;
const worker = (id, path, account) => agent(id, { cwd: path, touching: [touch(path)], account });

test('the layout: a 12 m gap (the road, the creek), the neighbour moved east by it, which farm a point is on', () => {
  assert.equal(GAP, 96);
  assert.equal(NEIGHBOUR_X, W + 96);
  assert.ok(ROAD.x0 > W && ROAD.x1 < CREEK.x0 && CREEK.x1 < NEIGHBOUR_X, 'the road, then the creek, inside the gap');
  assert.deepEqual([farmAt(10), farmAt(W + 10), farmAt(CREEK.x1), farmAt(NEIGHBOUR_X + 5)], [0, 0, 1, 1]);
  assert.deepEqual(east([10, 20]), [10 + NEIGHBOUR_X, 20]);
  assert.deepEqual(east({ x0: 1, x1: 2, y: 3 }), { x0: 1 + NEIGHBOUR_X, x1: 2 + NEIGHBOUR_X, y: 3 });
  assert.deepEqual(landOf(false), { w: W, ox: 0 });
  assert.deepEqual(landOf(true), { w: NEIGHBOUR_X + W, ox: NEIGHBOUR_X });
  assert.equal(extentOf(400, landOf(true).w).x1 - extentOf(400).x1, NEIGHBOUR_X, 'the extent runs past the neighbour');
  const L = { GRID: { y1: 546 }, rows: 3, H: 750 }, c = crossingsOf(L), pa = pastureOf(L);
  assert.deepEqual(c.lane, [LANE - 10, LANE + 10]);
  assert.ok(c.cattle[0] > pa.y0 && c.cattle[1] < pa.y1, "the cattle bridge at the pastures' middle");
  assert.ok(c.stones[0] > pa.y1, "the stepping stones at the forest's edge, under the pasture");
  const theirs = farmsteadOf(NEIGHBOUR_X);
  assert.ok(!theirs.some(o => ['henhouse', 'stall', 'board'].includes(o.k)), 'no henhouse, stall or board on the neighbour\'s');
  assert.equal(theirs.find(o => o.k === 'barn').x, FARMSTEAD.find(o => o.k === 'barn').x + NEIGHBOUR_X);
  assert.equal(farmsteadOf(0), FARMSTEAD);
});

test("the forest goes round the whole land, and leaves the road and the creek's corridor clear", () => {
  const H = 750, w = landOf(true).w, trees = forestOf(H, w);
  assert.ok(trees.some(([x]) => x > w), 'trees past the neighbour');
  assert.ok(!trees.some(([x, , r]) => x + r * 1.25 > ROAD.x0 - 8 && x - r * 1.25 < CREEK.x1 + 8), 'none over the road or the creek');
  assert.ok(!trees.some(([x, y]) => x > 0 && x < w && y > 12 && y < H + 22), 'none on the land itself');
  assert.deepEqual(forestOf(H), forestOf(H, W), 'one farm: as before');
});

test("farmOf: the second account's sessions live on the neighbour's farm; the first, none or a third on yours", () => {
  const accs = [{ key: 'main' }, { key: 'zeta' }, { key: 'third' }];
  assert.deepEqual(['zeta', 'main', null, 'third'].map(a => farmOf({ account: a }, accs)), [1, 0, 0, 0]);
  assert.equal(farmOf({ account: 'zeta' }, [{ key: 'zeta' }]), 0, 'one account: no neighbour');
});

test('one account: the model is as before, with no neighbour', () => {
  const s = snap([worker('a', SHOP), agent('w', { state: 'waiting', now: null })], [repo('shop')]);
  const m = model(s);
  assert.equal(m.neighbour, null);
  assert.deepEqual(m.land, { w: W, ox: 0 });
  assert.ok(m.beds.every(b => b.farm === undefined && b.ox === undefined), 'no new fields on its beds');
  assert.ok(m.farmers.every(f => f.farm === undefined));
  assert.equal(m.ground.land, undefined);
  assert.deepEqual(at(m, 'w'), [168, PORCH_Y]);
});

test("two accounts: a repo only the second works in is only on the neighbour's; one both work in is on both; one nobody works in is yours", () => {
  const s = two([worker('a', SHOP, 'main'), worker('b', SHOP, 'zeta'), worker('c', BLOG, 'zeta')], [repo('shop'), repo('blog'), repo('api')]);
  const m = model(s), keys = m.beds.map(b => b.key).sort();
  assert.deepEqual(keys, [API, SHOP, `${BLOG}@n`, `${SHOP}@n`].sort());
  const nShop = m.beds.find(b => b.key === `${SHOP}@n`), shop = m.beds.find(b => b.key === SHOP);
  assert.equal(nShop.repo, SHOP);
  assert.deepEqual([nShop.farm, nShop.ox], [1, NEIGHBOUR_X]);
  assert.ok(nShop.x0 >= NEIGHBOUR_X, 'moved east');
  assert.equal(nShop.crop, shop.crop, "the repo's own crop, fence and soil");
  assert.deepEqual([nShop.fence, nShop.soil, nShop.name], [shop.fence, shop.soil, shop.name]);
  assert.equal(m.farmers.find(f => f.id === 'b').field, `${SHOP}@n`);
  assert.equal(m.farmers.find(f => f.id === 'a').field, SHOP);
  assert.equal(nShop.plot.kind, 'grow', 'its own farmer grows it');
  assert.deepEqual(at(m, 'b'), [nShop.cx + 26 * 2, nShop.lane], "the 2D farm's offset, on the neighbour's bed");
});

test("a repo on both farms: its deploy's weather and its piles on both copies", () => {
  const s = two([worker('a', SHOP, 'main'), worker('b', SHOP, 'zeta')], [repo('shop', { dirty: 7, ahead: 5, lastDeploy: { status: 'completed', conclusion: 'failure', label: 'deploy', url: null } })]);
  const m = model(s), [mine, theirs] = [SHOP, `${SHOP}@n`].map(k => m.beds.find(b => b.key === k));
  assert.equal(theirs.weather, mine.weather);
  assert.deepEqual(theirs.piles, mine.piles);
});

test("the neighbour's farmers stand at their farm's places; both farms have the same rows; +N signs per farm", () => {
  const ws = ['w1', 'w2', 'w3', 'w4'].map(id => agent(id, { state: 'waiting', now: null, account: 'zeta' }));
  const s = two([...ws, agent('i', { state: 'idle', now: null, account: 'zeta' }), agent('m', { state: 'waiting', now: null, account: 'main' })], []);
  const m = model(s);
  assert.deepEqual(at(m, 'w1'), [168 + NEIGHBOUR_X, PORCH_Y], 'its porch');
  assert.deepEqual(at(m, 'm'), [168, PORCH_Y], 'yours');
  assert.equal(m.neighbour.over.desk, 1, 'a fourth waiting on its porch: its +1');
  assert.equal(m.over.desk, 0);
  const T = slotTables(m.neighbour.ground);
  assert.deepEqual(at(m, 'i'), east(T.charge.at(0)), 'idle: under its shade tree');
  assert.equal(m.farmers.find(f => f.id === 'w1').farm, 1);
  // many repos on the neighbour's farm: your farm grows the same rows
  const many = Array.from({ length: 10 }, (_, k) => `r${k}`);
  const m2 = model(two(many.map(n => worker(n, `${HOME}/${n}`, 'zeta')), many.map(n => repo(n))));
  assert.equal(m2.neighbour.ground.rows, 4);
  assert.equal(m2.ground.rows, 4, 'your farm has as many rows');
  assert.equal(m2.ground.H, m2.neighbour.ground.H);
  assert.deepEqual(m2.ground.land, landOf(true));
});

test("two accounts: a silo on each farm, each its account's week", () => {
  const m = model(two([], []));
  assert.deepEqual(m.silos.map(s => [s.x, s.name, s.silo?.label]), [[SILO_X[0], 'work', '40%'], [SILO_X[0] + NEIGHBOUR_X, 'home', '92%']]);
  assert.deepEqual([m.neighbour.key, m.neighbour.name, m.neighbour.ox], ['zeta', 'home', NEIGHBOUR_X]);
});

test('the beds stay put on each farm from scene to scene, and the second account going takes the neighbour away', () => {
  const s = two([worker('b', BLOG, 'zeta'), worker('a', SHOP, 'main')], [repo('shop'), repo('blog')]);
  const m1 = model(s);
  assert.ok(m1.keep.nbeds[`${BLOG}@n`]);
  const m2 = model(s, m1.keep);
  assert.deepEqual(m2.beds.map(b => [b.key, b.x0]), m1.beds.map(b => [b.key, b.x0]));
  const gone = model({ ...s, accounts: [ACCOUNTS[0]] }, m1.keep);
  assert.equal(gone.neighbour, null);
  assert.ok(gone.beds.every(b => !b.key.endsWith('@n')), 'its fields come home');
  assert.ok(gone.farmers.every(f => f.at[0] < W));
});

test('private mode: keys a1, a2, the neighbour named account 2, its fields keyed by the stand-in repo', () => {
  const s = two([worker('b', SHOP, 'zeta')], [repo('shop')]);
  const m = M.farmModel(privateScene(toScene(s)), { beds: {}, packed: false });
  assert.equal(m.neighbour.name, 'account 2');
  assert.equal(m.neighbour.key, 'a2');
  assert.ok(m.beds.some(b => /^r\d+@n$/.test(b.key)));
});

test('the camera keeps its target over the land round its middle, and at 100% the middle is in the middle', () => {
  const c = { x: 60, z: 0 }, half = { x: 113, z: 50 };
  assert.deepEqual(clampTarget({ x: 400, z: 0 }, half, c), { x: 173, z: 0 });
  assert.deepEqual(clampTarget({ x: -400, z: 0 }, half, c), { x: -53, z: 0 });
  assert.deepEqual(clampTarget({ x: 400, z: 0 }, half), { x: 113, z: 0 }, 'no centre: round the origin, as before');
  const camera = { position: { set() {} }, lookAt() {}, updateProjectionMatrix() {}, clearViewOffset() {}, setViewOffset() {} };
  const hadDoc = 'document' in globalThis, doc = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} }; // the rig's keys
  const rig = makeCameraRig(null, camera, { addEventListener() {}, clientHeight: 800 });
  if (hadDoc) globalThis.document = doc; else delete globalThis.document;
  rig.setFrame(1280, 800);
  rig.setFarm({ centre: c, half, points: [{ x: -53, y: 0, z: -50 }, { x: 173, y: 0, z: 50 }] });
  rig.reset();
  assert.deepEqual(rig.state().target, c);
  rig.setZoom(3);
  rig.glideTo({ x: 500, z: 0 });
  for (let k = 0; k < 20; k++) rig.update(0.1);
  assert.equal(rig.state().target.x, 173, 'panned no further than the land');
});

test("the plants: the neighbour's shade tree, bushes and rocks; the forest round the land; no orchard there", () => {
  const m = model(two([], [])), P = plantsOf(m.ground, 'summer');
  const shade = P.filter(p => p.role === 'shade');
  assert.equal(shade.length, 2);
  assert.equal(shade[1].x - shade[0].x, NEIGHBOUR_X);
  assert.ok(P.some(p => p.role === 'bush' && p.x > NEIGHBOUR_X));
  assert.ok(P.some(p => p.role === 'rock' && p.x > NEIGHBOUR_X));
  assert.ok(P.some(p => p.role === 'forest' && p.x > landOf(true).w), 'the forest past the neighbour');
  assert.ok(!P.some(p => p.role === 'orchard' && p.x > W), 'the orchard is yours');
  assert.ok(!P.some(p => p.x > ROAD.x0 - 4 && p.x < CREEK.x1 + 4 && p.y > 0 && p.y < m.ground.H), 'nothing on the road or in the creek');
  assert.ok(!P.some(p => p.role === 'forest' && p.x > W + 4 && p.x < NEIGHBOUR_X - 4 && p.y > 12 && p.y < m.ground.H + 22), 'no forest between the farms');
  const one = plantsOf(model(snap([], [])).ground, 'summer');
  assert.equal(one.filter(p => p.role === 'shade').length, 1, 'one farm: one shade tree');
});

test('walks: within a farm as before; between the farms along the lane and over the bridge', () => {
  const corridors = [176, 398, 602, ...[176, 398, 602].map(c => c + NEIGHBOUR_X)], gap = [W, NEIGHBOUR_X];
  assert.deepEqual(landRoute([61, 110], [296, 232], { corridors, gap }), walkRoute([61, 110], [296, 232], corridors));
  const r = landRoute([168, PORCH_Y], [168 + NEIGHBOUR_X, PORCH_Y], { corridors, gap });
  assert.ok(r.some(([x, y]) => y === LANE && x < W) && r.some(([x, y]) => y === LANE && x > NEIGHBOUR_X), 'onto the lane, across, off it');
  let from = [168, PORCH_Y];
  for (const p of r) { if (Math.min(from[0], p[0]) < CREEK.x0 && Math.max(from[0], p[0]) > CREEK.x1) assert.ok(from[1] === LANE && p[1] === LANE, 'it crosses the creek on the lane'); from = p; }
  assert.deepEqual(r.at(-1), [168 + NEIGHBOUR_X, PORCH_Y]);
  const back = landRoute([400 + NEIGHBOUR_X, 300], [96, 520], { corridors, gap });
  assert.deepEqual(back.at(-1), [96, 520], 'and back home, from a field to the shade tree');
  assert.ok(back.some(([x, y]) => y === LANE && x > NEIGHBOUR_X) && back.some(([x, y]) => y === LANE && x < W));
  assert.deepEqual(landRoute([61, 110], [200, 110], { corridors, gap: null }), [[200, 110]], 'no neighbour: as before');
});

test("the porches' dialogs: yours lists your account's, the neighbour's its own", () => {
  const e = { farmers: [{ id: 'a', name: 'a', state: 'waiting', ask: 'x', account: 'main' }, { id: 'b', name: 'b', state: 'waiting', ask: 'y', account: 'zeta' }], accounts: [{ key: 'main', name: 'work' }, { key: 'zeta', name: 'home' }], fields: [] };
  const esc = v => String(v), ago = () => '';
  const mine = dialogFor('house', e, { esc, ago }), theirs = dialogFor('house2', e, { esc, ago });
  assert.ok(mine.html.includes('data-farm-pick="a"') && !mine.html.includes('data-farm-pick="b"'));
  assert.equal(theirs.title, "home's porch");
  assert.ok(theirs.html.includes('data-farm-pick="b"') && !theirs.html.includes('data-farm-pick="a"'));
  const one = dialogFor('house', { ...e, accounts: [e.accounts[0]] }, { esc, ago });
  assert.ok(one.html.includes('data-farm-pick="a"') && one.html.includes('data-farm-pick="b"'), 'one account: everyone, as before');
});

test("machines: a neighbour field's machine leaves its own shed, passes its bed from its walkway, and works there", () => {
  const land = landOf(true), bed = { key: 'r1@n', cx: 296 + land.ox, x0: 296 - BED.w / 2 + land.ox, y0: 180, lane: 242, farm: 1, ox: land.ox };
  assert.deepEqual(passesFor(bed)[0], [bed.x0 + BED.w + 12, bed.y0 + 6], 'column 0: from its walkway on the right, as on yours');
  const M2 = createMachines();
  M2.want({ farmers: [{ id: 'f', state: 'working', field: 'r1@n', step: 'test', writes: 0 }] }, 0, new Set());
  const ctx = { farmers: new Map([['f', { x: east(SHED_DOOR)[0], y: SHED_DOOR[1], state: 'working', field: 'r1@n' }]]), beds: new Map([['r1@n', bed]]), boarded: () => true, blocked: () => false, still: false, now: 0, land };
  const [first] = M2.tick(0.1, ctx);
  assert.ok(Math.abs(first.x - east(SHED_DOOR)[0]) < 10, `out of its own shed (${first.x})`);
  let it = first;
  for (let k = 0; k < 400; k++) it = M2.tick(0.1, ctx)[0] ?? it;
  assert.equal(it.phase, 'work');
  assert.ok(it.x > land.ox, "it works on the neighbour's farm");
});

test('with a neighbour the truck goes to town up the road; with Motion off it stands on the road', () => {
  const land = landOf(true), bed = { key: 'r1', cx: 296, x0: 296 - BED.w / 2, y0: 180, lane: 242 };
  const M2 = createMachines();
  M2.want({ farmers: [{ id: 'f', state: 'working', field: 'r1', step: 'deploy', writes: 0 }] }, 0, new Set());
  const ctx = { farmers: new Map([['f', { x: 300, y: 250, state: 'working', field: 'r1' }]]), beds: new Map([['r1', bed]]), boarded: () => true, blocked: () => false, still: true, now: 0, land };
  const [it] = M2.tick(0.1, ctx);
  assert.equal(it.x, ROAD.mid);
  assert.ok(it.y < LANE, 'north of the junction');
  const M3 = createMachines();
  M3.want({ farmers: [{ id: 'f', state: 'working', field: 'r1', step: 'deploy', writes: 0 }] }, 0, new Set());
  let t = null;
  for (let k = 0; k < 600; k++) t = M3.tick(0.1, { ...ctx, still: false })[0] ?? t;
  assert.ok(t.x > ROAD.x0 && t.x < ROAD.x1 && t.y < 0, `driving, it goes up the road out of sight (${t.x}, ${t.y})`);
});

test("a web call's cart to town turns up the road with a neighbour; as before without", () => {
  const f = { id: 'x', state: 'working', service: 'example.com', step: 'web', tool: 'WebFetch' };
  assert.deepEqual(cartOf(f, 3), cartOf(f, 3, landOf(false)));
  const all = Array.from({ length: 80 }, (_, k) => cartOf(f, k * 0.1, landOf(true)));
  assert.ok(all.every(c => c.x <= ROAD.mid + 0.5), 'never past the road');
  assert.ok(all.some(c => c.y < LANE - 40), 'up the road');
  assert.ok(all.every(c => c.y === undefined || c.y <= LANE + 4));
});

const landGround = () => model(two([], [])).ground;
test('roam: both pastures, the creek in the way but for its three crossings, a way from one pasture to the other', () => {
  const L = landGround(), R = roamOf(L), c = crossingsOf(L), pa = pastureOf(L), mid = (CREEK.x0 + CREEK.x1) / 2, py = (pa.y0 + pa.y1) / 2;
  assert.ok(R.inside('pasture', 300, py, 6) && R.inside('pasture@n', 300 + NEIGHBOUR_X, py, 6));
  assert.ok(!R.inside('pasture', 300 + NEIGHBOUR_X, py, 6), "the neighbour's pasture isn't yours");
  assert.ok(!R.inside('farm', mid, 300, 4), 'in the creek: no');
  assert.ok(R.inside('farm', mid, (c.lane[0] + c.lane[1]) / 2, 4), "on the lane's bridge");
  assert.ok(R.inside('farm', mid, (c.cattle[0] + c.cattle[1]) / 2, 4), 'on the cattle bridge');
  assert.ok(R.inside('farm', mid, (c.stones[0] + c.stones[1]) / 2, 4), 'on the stepping stones');
  assert.ok(R.inside('farm', ROAD.mid, 300, 6), 'the road is open ground');
  assert.ok(!R.clear('farm', [CREEK.x0 - 10, 300], [CREEK.x1 + 10, 300], 4), 'no straight way through the water');
  const way = R.route([400, py], [400 + NEIGHBOUR_X, py], 9);
  assert.ok(way?.length, 'a way');
  let from = [400, py];
  for (const p of way) { assert.ok(R.clear('farm', from, p, 9), 'every leg walkable'); from = p; }
  assert.equal(roamOf(model(snap([], [])).ground).areas['pasture@n'], undefined, 'one farm: no neighbour areas');
});

test('herds: the 18 as before with one farm; with two, each its home farm, and three new ones there', () => {
  const firstEighteen = HERDS.filter(h => !h.only);
  assert.equal(firstEighteen.reduce((n, h) => n + h.n, 0), 18);
  assert.ok(HERDS.findIndex(h => h.only) > HERDS.findLastIndex(h => !h.only), 'the new ones last');
  const farmOfKind = k => HERDS.find(h => h.kind === k && !h.only).farm ?? 0;
  assert.deepEqual(['cow', 'bull', 'horse', 'husky'].map(farmOfKind), [0, 0, 0, 0]);
  assert.deepEqual(['alpaca', 'donkey', 'whitehorse', 'shiba'].map(farmOfKind), [1, 1, 1, 1]);
  assert.deepEqual(HERDS.filter(h => h.only).map(h => [h.kind, h.scale ?? 1, h.mother ?? null]), [['cow', 1, null], ['cow', 0.6, 'cow'], ['whitehorse', 0.6, 'whitehorse']]);
  assert.deepEqual([areaOn('pasture', 1), areaOn('pasture', 0), areaOn('edge', 1), areaOn('water', 1), areaOn('home', 1)], ['pasture@n', 'pasture', 'edge', 'water', 'home@n']);
});

/** An animal's world for antics.js on a land, with the given rolls in turn (the walk's: its pace, then its choices). */
function walkEnv(R, rolls, neighbour = true, rand = null) {
  let k = 0;
  const picked = [];
  return { picked, e: { rand: () => rolls[k++ % rolls.length], neighbour, farmAt, spot: (area, from, far, r, o) => { picked.push(area); return R.spot(area, rand ?? (() => 0.5), { from, far, r, ...o }); }, inside: (a, x, y, r) => R.inside(a, x, y, r), clear: (a, f, t, r) => R.clear(a, f, t, r), route: (f, t, r) => R.route(f, t, r), resting: false, habitChance: 0, duration: () => 1 } };
}
const cowAt = (x, y, farm = 0, o = {}) => { const a = makeAnimal({ kind: 'cow', family: 'hooves', area: 'pasture', walk: 7, run: 40, r: 10, farm, ...o }, x, y, () => 0.5); a.rest = 0; return a; };
test('a walk: 1 in 6 to the other farm with a neighbour, home 1 in 2 while away, none across without one', () => {
  const L = landGround(), R = roamOf(L), pa = pastureOf(L), y = (pa.y0 + pa.y1) / 2;
  const visit = walkEnv(R, [0.5, 0.1, 0.5]); // its pace, then the roll to go across (under 1/6), then the walk's
  advance(cowAt(300, y), 0.1, visit.e);
  assert.equal(visit.picked[0], 'pasture@n', "off to the neighbour's pasture");
  const stay = walkEnv(R, [0.5, 0.5, 0.5]);
  advance(cowAt(300, y), 0.1, stay.e);
  assert.ok(!stay.picked[0].endsWith('@n'), 'a roll over 1/6: it stays on its farm');
  const back = walkEnv(R, [0.5, 0.4]); // away: no roll to go across; the walk's under 1/2: home
  advance(cowAt(300 + NEIGHBOUR_X, y), 0.1, back.e);
  assert.equal(back.picked[0], 'pasture', 'away: home on a roll under 1/2');
  const alone = walkEnv(R, [0.5, 0.1], false);
  advance(cowAt(300, y), 0.1, alone.e);
  assert.deepEqual(alone.picked.slice(0, 1), ['home'], 'no neighbour: somewhere else on its farm, never across');
});

test('a calf picks its places within 6 m of its mother', () => {
  const L = landGround(), R = roamOf(L), pa = pastureOf(L), y = (pa.y0 + pa.y1) / 2, mum = [400 + NEIGHBOUR_X, y];
  for (let k = 0; k < 10; k++) {
    const calf = cowAt(330 + NEIGHBOUR_X, y, 1, { r: 6 });
    calf.mother = () => mum;
    advance(calf, 0.1, walkEnv(R, [0.5, 0.9, 0.3], true, Math.random).e);
    const end = calf.path.length ? calf.path.at(-1) : [calf.tx, calf.ty];
    assert.ok(Math.hypot(end[0] - mum[0], end[1] - mum[1]) <= 48 + 1, `within 6 m of its mother (${end})`);
  }
});

const idleF = (id, farm, x) => ({ id, farm, state: 'idle', nap: false, at: [x, 300], errand: false, followed: false });
const pair = () => [idleF('a', 0, 96), idleF('b', 1, 96 + NEIGHBOUR_X)];
test('visits: none with one farm, while still, or before 2 minutes; then an idle pair across the farms', () => {
  const v = createVisits({ rand: () => 0 }), fs = pair();
  assert.deepEqual(v.tick({ now: 0, still: false, neighbour: true, farmers: fs }), {});
  assert.deepEqual(v.tick({ now: VISIT_FIRST_MS - 1, still: false, neighbour: true, farmers: fs }), {});
  assert.deepEqual(v.tick({ now: VISIT_FIRST_MS, still: true, neighbour: true, farmers: fs }), {}, 'still');
  assert.deepEqual(v.tick({ now: VISIT_FIRST_MS, still: false, neighbour: false, farmers: fs }), {}, 'no neighbour');
  const r = v.tick({ now: VISIT_FIRST_MS, still: false, neighbour: true, farmers: fs });
  assert.ok(r.start && r.start.guest !== r.start.host);
  const host = fs.find(f => f.id === r.start.host), guest = fs.find(f => f.id === r.start.guest);
  assert.notEqual(host.farm, guest.farm, 'across the farms');
  assert.equal(Math.hypot(r.start.to[0] - host.at[0], r.start.to[1] - host.at[1]), VISIT_NEAR, '1.5 m from its host');
  assert.deepEqual(r.start.face, host.at);
});
test('a visit ends when either stops being idle, and the next waits at least 4 minutes', () => {
  const v = createVisits({ rand: () => 0 }), fs = pair();
  v.tick({ now: 0, still: false, neighbour: true, farmers: fs });
  const { start } = v.tick({ now: VISIT_FIRST_MS, still: false, neighbour: true, farmers: fs });
  const busy = fs.map(f => (f.id === start.host ? { ...f, state: 'working' } : f));
  assert.deepEqual(v.tick({ now: VISIT_FIRST_MS + 1000, still: false, neighbour: true, farmers: busy }), { end: start.guest });
  assert.deepEqual(v.tick({ now: VISIT_FIRST_MS + VISIT_GAP_MS - 1, still: false, neighbour: true, farmers: fs }), {});
  assert.ok(v.tick({ now: VISIT_FIRST_MS + VISIT_GAP_MS, still: false, neighbour: true, farmers: fs }).start);
});
test('a visit talks once the guest arrives, and ends when its talk is over; Motion off ends it', () => {
  const v = createVisits({ rand: () => 0 }), fs = pair();
  v.tick({ now: 0, still: false, neighbour: true, farmers: fs });
  const { start } = v.tick({ now: VISIT_FIRST_MS, still: false, neighbour: true, farmers: fs });
  v.arrived(VISIT_FIRST_MS + 30000, 10000);
  assert.deepEqual(v.tick({ now: VISIT_FIRST_MS + 39000, still: false, neighbour: true, farmers: fs }), {});
  assert.deepEqual(v.tick({ now: VISIT_FIRST_MS + 40000, still: false, neighbour: true, farmers: fs }), { end: start.guest });
  const w = createVisits({ rand: () => 0 });
  w.tick({ now: 0, still: false, neighbour: true, farmers: fs });
  const s2 = w.tick({ now: VISIT_FIRST_MS, still: false, neighbour: true, farmers: fs }).start;
  assert.deepEqual(w.tick({ now: VISIT_FIRST_MS + 10, still: true, neighbour: true, farmers: fs }), { end: s2.guest });
  const x = createVisits({ rand: () => 0 });
  x.tick({ now: 0, still: false, neighbour: true, farmers: fs });
  const s3 = x.tick({ now: VISIT_FIRST_MS, still: false, neighbour: true, farmers: fs }).start;
  assert.deepEqual(x.tick({ now: VISIT_FIRST_MS + 10, still: false, neighbour: false, farmers: fs }), { end: s3.guest }, 'the neighbour farm gone');
});
test('no visit with no idle pair across the farms (napping, followed, on an errand, or one farm only)', () => {
  const v = createVisits({ rand: () => 0 });
  v.tick({ now: 0, still: false, neighbour: true, farmers: [] });
  for (const fs of [[idleF('a', 0, 96), idleF('c', 0, 120)], [idleF('a', 0, 96), { ...idleF('b', 1, 96 + NEIGHBOUR_X), nap: true }], [idleF('a', 0, 96), { ...idleF('b', 1, 96 + NEIGHBOUR_X), followed: true }], [idleF('a', 0, 96), { ...idleF('b', 1, 96 + NEIGHBOUR_X), errand: true }], [idleF('a', 0, 96), { ...idleF('b', 1, 96 + NEIGHBOUR_X), state: 'stale' }]]) {
    assert.deepEqual(v.tick({ now: VISIT_FIRST_MS * 10, still: false, neighbour: true, farmers: fs }), {});
  }
});
test("the visit's talk: the guest greets, they take turns, and it lasts its lines (8 s at least)", () => {
  const lines = visitExchange([{ id: 'a', name: 'agent 1' }, { id: 'b', name: 'agent 2' }], {}, () => 0);
  assert.ok(lines.length >= 2 && lines[0].who === 'a' && lines[1].who === 'b');
  assert.ok(lines.every(l => typeof l.text === 'string' && l.text.length && l.text.length <= 60));
  const t = createTalk({ rand: () => 0 });
  const secs = t.meet({ id: 'a', name: 'agent 1', state: 'idle', x: 0, y: 0 }, { id: 'b', name: 'agent 2', state: 'idle', x: 12, y: 0 });
  assert.ok(secs >= 7);
  assert.equal(t.bubbles()[0].who, 'a');
  assert.ok(t.busyIds().has('a') && t.busyIds().has('b'));
});

test("a visit whose guest's walk is cut short is dropped (cancel), and the next waits its gap", () => {
  const v = createVisits({ rand: () => 0 }), fs = pair();
  v.tick({ now: 0, still: false, neighbour: true, farmers: fs });
  v.tick({ now: VISIT_FIRST_MS, still: false, neighbour: true, farmers: fs });
  v.cancel();
  assert.equal(v.now(), null);
  assert.deepEqual(v.tick({ now: VISIT_FIRST_MS + 1000, still: false, neighbour: true, farmers: fs }), {});
});

// The final review's fixes (spec 2026-10-14 neighbour, review c1af5aa..4e970c9)
test("the route grids over the whole land are quick to build: each body size's first route under 200 ms at six rows", () => {
  const many = Array.from({ length: 16 }, (_, k) => `n${k}`);
  const L = model(two(many.map(n => worker(n, `${HOME}/${n}`, 'zeta')), many.map(n => repo(n)))).ground;
  assert.equal(L.rows, 6);
  const R = roamOf(L), pa = pastureOf(L), y = (pa.y0 + pa.y1) / 2;
  for (const r of [5, 7, 9, 11]) { // the animals' reach (antics.js reachOf): 5 to the bull's 11
    const t0 = performance.now(), way = R.route([60, 200], [300 + NEIGHBOUR_X, y + 30], r), ms = performance.now() - t0; // from your yard: round, through the gates
    assert.ok(way?.length, `a way for a body of ${r}`);
    assert.ok(ms < 200, `the first route for a body of ${r} took ${ms.toFixed(0)} ms`);
  }
});

test("an MCP cart to a neighbour's farmer goes along the lane, over the bridge and down its walkway: never across a field or the creek", () => {
  const land = landOf(true), C = createCarts(), farmer = { x: 1196, y: 242, tx: 1196, ty: 242 }, beds = Array.from({ length: 3 }, (_, k) => 296 + k * 204 - BED.w / 2);
  const seen = [];
  for (let k = 0; k < 600; k++) seen.push(C.tick([{ server: 'tickets', busy: 'f' }], 0.1, () => farmer, false, k * 100, land)[0]);
  const last = seen.at(-1);
  assert.ok(Math.hypot(last.x - farmer.x, last.y - farmer.y) < 20, `beside its farmer (${last.x}, ${last.y})`);
  for (const c of seen) {
    if (c.x > CREEK.x0 && c.x < CREEK.x1) assert.ok(Math.abs(c.y - LANE) <= 10, `over the creek off the bridge at ${c.x}, ${c.y}`);
    for (const x0 of beds) assert.ok(!(c.x > x0 && c.x < x0 + BED.w && c.y > 180 && c.y < 180 + BED.d), `across your field at ${c.x}, ${c.y}`);
  }
});

test("a neighbour's worktree field is labelled with its repo's own name, never the '@n' of its key", () => {
  const WT = `${HOME}/shop-wt`;
  const repos = [repo('shop'), { ...repo('shop-wt', { branch: 'feature/cart' }), worktree: true, main: SHOP }];
  const m = model(two([worker('a', WT, 'zeta'), worker('b', SHOP, 'zeta')], repos));
  const wt = m.beds.find(b => b.key === `${WT}@n`);
  assert.deepEqual(wt.label, ['shop-wt feature/cart', 'worktree of shop']);
  assert.equal(wt.i, m.beds.find(b => b.key === `${SHOP}@n`).i + 1, 'still right after its repo');
  const p = M.farmModel(privateScene(toScene(two([worker('a', WT, 'zeta')], repos))), { beds: {}, packed: false });
  assert.ok(p.beds.every(b => !b.label.join(' ').includes('@n')), `private: ${JSON.stringify(p.beds.map(b => b.label))}`);
});

const hbed = { key: 'r1', cx: 704, x0: 704 - BED.w / 2, y0: 180, lane: 242 };
const nbed = { key: 'r1@n', cx: 296 + NEIGHBOUR_X, x0: 296 - BED.w / 2 + NEIGHBOUR_X, y0: 180, lane: 242, farm: 1, ox: NEIGHBOUR_X };
/** A neighbour's sprayer out at work in its field, and the context it ran in. */
function sprayerAtWork() {
  const M2 = createMachines();
  M2.want({ farmers: [{ id: 'f', state: 'working', field: 'r1@n', step: 'test', writes: 0 }] }, 0, new Set());
  const ctx = { farmers: new Map([['f', { x: east(SHED_DOOR)[0], y: SHED_DOOR[1], state: 'working', field: 'r1@n' }]]), beds: new Map([['r1@n', nbed], ['r1', hbed]]), boarded: () => true, blocked: () => false, still: false, now: 0, land: landOf(true) };
  let it = null;
  for (let k = 0; k < 600 && it?.phase !== 'work'; k++) it = M2.tick(0.1, ctx)[0] ?? it;
  assert.equal(it.phase, 'work');
  return { M2, ctx };
}
test('a session moved to your account: its machine goes home to its own shed, and a new one comes out of yours (none crosses the bridge)', () => {
  const { M2, ctx } = sprayerAtWork();
  M2.want({ farmers: [{ id: 'f', state: 'working', field: 'r1', step: 'test', writes: 0 }] }, 1, new Set());
  const moved = { ...ctx, farmers: new Map([['f', { x: SHED_DOOR[0], y: SHED_DOOR[1], state: 'working', field: 'r1' }]]) };
  let last = null;
  for (let k = 0; k < 1500; k++) for (const it of M2.tick(0.1, moved)) {
    assert.ok(!(it.x > W + 4 && it.x < NEIGHBOUR_X - 4), `in the gap at ${it.x.toFixed(0)}, ${it.y.toFixed(0)} (${it.phase})`);
    last = it;
  }
  assert.ok(last && last.x < W && last.phase === 'work', `at work on your farm (${last?.x}, ${last?.phase})`);
});
test('the second account gone: its machines go with its farm, and none drives across yours', () => {
  const { M2, ctx } = sprayerAtWork();
  M2.want({ farmers: [{ id: 'f', state: 'working', field: 'r1', step: 'test', writes: 0 }] }, 1, new Set());
  const gone = { ...ctx, farmers: new Map([['f', { x: SHED_DOOR[0], y: SHED_DOOR[1], state: 'working', field: 'r1' }]]), beds: new Map([['r1', hbed]]), land: landOf(false) };
  for (let k = 0; k < 600; k++) for (const it of M2.tick(0.1, gone)) assert.ok(it.x <= W + 20, `off your farm at ${it.x.toFixed(0)}, ${it.y.toFixed(0)} (${it.phase})`);
});
