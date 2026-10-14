// The 3D farm's neighbour farm (spec 2026-10-14-farm3d-neighbour-design.md): the second Claude account's farm, east of
// yours across the road and the creek. The model, the layout, the walks, the machines, the animals and the visits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kit, toScene, privateScene, NOW, HOME, touch, agent, repo, snap } from './farm3d-vm.mjs';
import { makeModel } from '../../web/worlds/farm3d/model.js';
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
