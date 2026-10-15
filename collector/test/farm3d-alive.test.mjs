// The 3D farm's second round (spec 2026-10-15-farm3d-alive-design.md): the task fence, the orchard of merged pull
// requests, the tour, wildlife, the mood sky and smoke, headlights, seasonal play and the soundscape's rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kit, toScene, NOW, HOME, touch, agent, repo, snap } from './farm3d-vm.mjs';
import { makeModel } from '../../web/worlds/farm3d/model.js';
import { fruitOf, orchardOf } from '../../web/worlds/farm3d/orchard.js';
import { plantsOf } from '../../web/worlds/farm3d/nature.js';
import { roamOf } from '../../web/worlds/farm3d/roam.js';
import { fenceOf } from '../../web/worlds/farm3d/fence.js';
import { createTour, TOUR_IDLE_MS, SHOT_MS } from '../../web/worlds/farm3d/tour.js';
import { makeCameraRig } from '../../web/worlds/farm3d/camera.js';
import { PASTURE_GATES, W, pastureOf } from '../../web/worlds/farm3d/layout.js';

const M = makeModel(kit);
const account = (key, name) => ({ key, name, email: null, signedIn: true, open: 0, costUsd: 0, plan: null });
const two = (agents, repos = []) => ({ ...snap(agents, repos), accounts: [account('main', 'work'), account('zeta', 'home')] });
const model = (s, keep = { beds: {}, packed: false }) => M.farmModel(toScene(s), keep);
const worker = (id, path, account, over = {}) => agent(id, { cwd: path, touching: [touch(path)], account, ...over });
const DAY = 86_400_000, SHOP = `${HOME}/shop`, BLOG = `${HOME}/blog`;

const withMerges = (name, ages) => repo(name, { prs: { open: [], merged: [], recent: ages.map((d, k) => ({ number: k + 1, at: NOW - d * DAY })) } });
test('the orchard: a tree per merge of the last 90 days in two rows along the front, blocks by repo, saplings growing', () => {
  const m = model(snap([worker('a', SHOP)], [withMerges('shop', [0, 7, 14, 30]), withMerges('blog', [2])]));
  const { trees, signs } = m.orchard, pa = pastureOf(m.ground);
  assert.equal(trees.length, 5);
  assert.ok(trees.every(t => [pa.y1 + 20, pa.y1 + 46].includes(t.y)), 'two rows');
  assert.deepEqual(trees.filter(t => t.key === SHOP).map(t => t.size).sort(), [0.4, 0.7, 1, 1].sort(), 'a sapling today, full at 14 days');
  assert.ok(!trees.some(t => t.x > PASTURE_GATES.bottom[0] - 8 && t.x < PASTURE_GATES.bottom[1] + 8), 'the forest gate clear');
  assert.deepEqual(signs.map(s => [s.name, s.count]), [['shop', 4], ['blog', 1]], 'shop first: its bed comes first');
  const shopX = trees.filter(t => t.key === SHOP).map(t => t.x), blogX = trees.filter(t => t.key === BLOG).map(t => t.x);
  assert.ok(Math.max(...shopX) < Math.min(...blogX), 'a block each');
});

test('the orchard: 80 trees at most (the newest), none without merges, none on the neighbour farm', () => {
  const many = model(snap([], [withMerges('shop', Array.from({ length: 120 }, (_, k) => k * 0.5))]));
  assert.equal(many.orchard.trees.length, 80);
  assert.equal(many.orchard.signs[0].count, 120, 'the sign counts them all');
  assert.ok(many.orchard.trees.every(t => t.x < W));
  assert.deepEqual(model(snap([], [repo('shop')])).orchard, { trees: [], signs: [] });
  const t2 = model(two([worker('b', SHOP, 'zeta')], [withMerges('shop', [1])]));
  assert.equal(t2.orchard.trees.length, 1);
  assert.ok(t2.orchard.trees.every(t => t.x < W), 'yours only');
  assert.deepEqual(orchardOf([], model(snap([], [])).ground, NOW), { trees: [], signs: [] });
});

test('the orchard is drawn with the plants, and its trunks are in the animals’ way', () => {
  const m = model(snap([], [withMerges('shop', [0, 20])])), trees = m.orchard.trees;
  const merge = plantsOf(m.ground, 'summer', trees).filter(p => p.role === 'merge');
  assert.deepEqual(merge.map(p => [p.x, p.y, p.w]), trees.map(t => [t.x, t.y, 3 * t.size]));
  assert.equal(plantsOf(m.ground, 'summer').filter(p => p.role === 'merge').length, 0);
  const R = roamOf(m.ground, { orchard: trees });
  for (const t of trees) assert.ok(!R.inside('farm', t.x, t.y, 2), `a trunk at ${t.x},${t.y}`);
  assert.ok(roamOf(m.ground).inside('farm', trees[0].x, trees[0].y, 2), 'without it, open ground');
});

test("the orchard's fruit: red in summer, orange in autumn, blossom in spring, none in winter; six a tree, in its crown", () => {
  const trees = [{ key: 'a', x: 100, y: 700, size: 1 }, { key: 'a', x: 118, y: 726, size: 0.4 }];
  assert.deepEqual(['spring', 'summer', 'autumn', 'winter'].map(s => fruitOf(trees, s).colour), ['#f6c6c0', '#e04a3a', '#e9a23b', null]);
  const f = fruitOf(trees, 'summer');
  assert.equal(f.at.length, 12);
  assert.equal(fruitOf(trees, 'winter').at.length, 0);
  for (const p of f.at.slice(0, 6)) assert.ok(Math.hypot(p.x - 100, p.y - 700) <= 3 * 8 * 0.5 && p.h > 2.5 && p.h < 5, `in the full tree's crown (${JSON.stringify(p)})`);
  for (const p of f.at.slice(6)) assert.ok(p.h < 2.2, 'lower on a sapling');
});

const tasks = (done, total) => ({ done, total, current: null });
test('the task fence: a stake per task along the front of its bed, a flag on each done one, a lantern while it works', () => {
  const m = model(snap([worker('a', SHOP, null, { tasks: tasks(2, 5) })], [repo('shop')]));
  const bed = m.beds[0], f = fenceOf(m.beds, m.farmers, m.scene.farmers);
  assert.equal(f.length, 5);
  assert.deepEqual(f.map(s => s.x), [0, 1, 2, 3, 4].map(j => bed.x0 + 4 + j * 6));
  assert.ok(f.every(s => s.y === bed.y0 + bed.d + 3 && s.key === bed.key));
  assert.deepEqual(f.map(s => s.done), [true, true, false, false, false]);
  assert.deepEqual(f.map(s => s.lantern), [false, false, true, false, false]);
  assert.equal(f[0].colour, m.farmers[0].shirt);
});
test('the task fence: past 20 tasks a stake stands for several; a row per agent, three at most', () => {
  const big = model(snap([worker('a', SHOP, null, { tasks: tasks(30, 45) })], [repo('shop')]));
  const f = fenceOf(big.beds, big.farmers, big.scene.farmers);
  assert.equal(f.length, 15, '45 tasks: 3 a stake');
  assert.equal(f.filter(s => s.done).length, 10, 'a stake is done when all its tasks are');
  const four = model(snap(['a', 'b', 'c', 'd'].map(id => worker(id, SHOP, null, { tasks: tasks(0, 2) })), [repo('shop')]));
  const bed = four.beds[0], rows = [...new Set(fenceOf(four.beds, four.farmers, four.scene.farmers).map(s => s.y))].sort((x, y) => x - y);
  assert.deepEqual(rows, [3, 7, 11].map(k => bed.y0 + bed.d + k));
});
test('the task fence: none for a stale agent, one outside any repo, or one with no list; no lantern while idle; on the neighbour bed', () => {
  const m = model(snap([agent('s', { state: 'stale', now: null, cwd: SHOP, touching: [touch(SHOP)], tasks: tasks(1, 3) }), agent('o', { cwd: '/elsewhere', tasks: tasks(0, 2) }), worker('n', SHOP, null, { tasks: null }), agent('i', { state: 'idle', now: null, cwd: SHOP, touching: [touch(SHOP)], tasks: tasks(1, 3) })], [repo('shop')]));
  const f = fenceOf(m.beds, m.farmers, m.scene.farmers);
  assert.equal(f.length, 3, "only the idle one's");
  assert.ok(f.every(st => !st.lantern));
  const t2 = model(two([worker('z', SHOP, 'zeta', { tasks: tasks(1, 2) })], [repo('shop')]));
  const f2 = fenceOf(t2.beds, t2.farmers, t2.scene.farmers);
  assert.equal(f2.length, 2);
  assert.ok(f2.every(st => st.key === `${SHOP}@n`));
});

const world = (o = {}) => ({ waiting: [], machine: null, busiest: null, neighbour: null, animal: null, ...o });
const tctx = (o = {}) => ({ on: true, still: false, shown: true, dialog: false, world: world(), ...o });
test('the tour: starts after 3 idle minutes, not while still, hidden, with a dialog or the switch off', () => {
  for (const off of [{ on: false }, { still: true }, { shown: false }, { dialog: true }]) {
    const t = createTour(); t.touch(0);
    assert.deepEqual(t.tick(TOUR_IDLE_MS + 1, tctx({ ...off, world: world({ busiest: [300, 200] }) })), {});
  }
  const t = createTour(); t.touch(0);
  assert.deepEqual(t.tick(TOUR_IDLE_MS - 1, tctx({ world: world({ busiest: [300, 200] }) })), {});
  const r = t.tick(TOUR_IDLE_MS, tctx({ world: world({ busiest: [300, 200] }) }));
  assert.ok(r.start && r.shot.kind === 'busiest');
  assert.deepEqual(r.shot.at, [300, 200]);
});
test('the tour: waiting farmers first, then machine, busiest, neighbour, animal; empty kinds skipped; every fifth the whole land', () => {
  const t = createTour(); t.touch(0);
  const w = world({ waiting: [[168, 98]], machine: [600, 250], busiest: [300, 200], animal: [400, 650] });
  const kinds = [];
  for (let k = 0; k < 6; k++) kinds.push(t.tick(TOUR_IDLE_MS + k * SHOT_MS, tctx({ world: w })).shot?.kind);
  assert.deepEqual(kinds, ['waiting', 'machine', 'busiest', 'animal', 'whole', 'waiting']);
  const empty = createTour(); empty.touch(0);
  assert.equal(empty.tick(TOUR_IDLE_MS, tctx()).shot.kind, 'whole', 'nothing to show: the whole land');
});
test('the tour: any touch stops it; Motion off or the switch off stops it', () => {
  for (const stopper of [t => { t.touch(TOUR_IDLE_MS + 10); return tctx(); }, () => tctx({ still: true }), () => tctx({ on: false })]) {
    const t = createTour(); t.touch(0);
    t.tick(TOUR_IDLE_MS, tctx({ world: world({ busiest: [1, 1] }) }));
    assert.ok(t.touring());
    assert.deepEqual(t.tick(TOUR_IDLE_MS + 20, stopper(t)), { stop: true });
    assert.ok(!t.touring());
  }
  const f = createTour(); f.touch(1e12); f.force();
  assert.ok(f.tick(1e12 + 1, tctx()).start, 'force: now');
});
test('the camera: a view taken is put back exactly', () => {
  const camera = { position: { set() {} }, lookAt() {}, updateProjectionMatrix() {}, clearViewOffset() {}, setViewOffset() {} };
  const hadDoc = 'document' in globalThis, doc = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  const rig = makeCameraRig(null, camera, { addEventListener() {}, clientHeight: 800 });
  if (hadDoc) globalThis.document = doc; else delete globalThis.document;
  rig.setFrame(1280, 800);
  rig.setFarm({ half: { x: 60, z: 50 }, points: [{ x: -60, y: 0, z: -50 }, { x: 60, y: 0, z: 50 }] });
  rig.setZoom(2.5); rig.glideTo({ x: 10, z: 5 }); for (let k = 0; k < 20; k++) rig.update(0.1);
  const v = rig.view();
  rig.zoomBy(1); rig.turn(1); rig.glideTo({ x: -30, z: 20 }); for (let k = 0; k < 20; k++) rig.update(0.1);
  assert.notDeepEqual(rig.view(), v);
  rig.restore(v);
  assert.deepEqual(rig.view(), v);
});
