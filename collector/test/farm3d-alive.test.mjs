// The 3D farm's second round (spec 2026-10-15-farm3d-alive-design.md): the task fence, the orchard of merged pull
// requests, the tour, wildlife, the mood sky and smoke, headlights, seasonal play and the soundscape's rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kit, toScene, NOW, HOME, touch, agent, repo, snap } from './farm3d-vm.mjs';
import { makeModel } from '../../web/worlds/farm3d/model.js';
import { fruitOf, orchardOf } from '../../web/worlds/farm3d/orchard.js';
import { plantsOf } from '../../web/worlds/farm3d/nature.js';
import { roamOf } from '../../web/worlds/farm3d/roam.js';
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
