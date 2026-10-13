// A 3D farmer as its character (web/worlds/farm3d/build/figurine.js, character.js), in Node with three.js: what it
// shows stays when the character arrives, a tool comes and goes without leaving anything behind, a still pose shows at
// once, and nothing is held when it goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/worlds/farm3d/vendor/three.module.js';

const { makeMaterials } = await import('../../web/worlds/farm3d/build/materials.js');
const { makeShapes } = await import('../../web/worlds/farm3d/build/shapes.js');
const { makeFigures } = await import('../../web/worlds/farm3d/build/figurine.js');

async function arrived(fig, pose = 'idle') {
  for (let k = 0; k < 300 && !fig.info(); k++) { fig.pose(pose, 0); await new Promise(r => setTimeout(r, 20)); }
  fig.pose(pose, 0);
  return fig.info();
}
const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

test('a farmer whose turn ended keeps its basket when its character arrives', async () => {
  const mats = makeMaterials(THREE), figs = makeFigures(THREE, mats, makeShapes(THREE, mats));
  const fig = figs.make({ id: 'turn-1', shirt: '#3d7be0', look: {}, family: 'opus', state: 'turn' });
  fig.setBadge('basket');
  assert.ok(await arrived(fig, 'basket'), 'its character loads');
  fig.setBadge('basket'); // farmers.tick says it every frame
  assert.equal(fig.info().badge, 'basket', 'the basket shows');
  fig.dispose();
});

test("a tool in the character's hand comes and goes without leaving anything on its hand", async () => {
  const mats = makeMaterials(THREE), figs = makeFigures(THREE, mats, makeShapes(THREE, mats));
  const fig = figs.make({ id: 'tool-1', shirt: '#d9673a', look: {}, family: 'sonnet', state: 'working' });
  assert.ok(await arrived(fig, 'swing'));
  const hand = fig.root.getObjectByName('WristR'), count = () => { let n = 0; hand.traverse(() => n++); return n; };
  const bare = count();
  for (let k = 0; k < 30; k++) { fig.setProp(k % 2 ? 'magnifier' : 'hoe'); fig.setProp(null); }
  assert.equal(count(), bare, 'nothing left behind');
  fig.setProp('hoe');
  assert.ok(count() > bare, 'a tool in hand');
  fig.dispose();
});

test('with Motion off a new pose shows at once, in full', async () => {
  const mats = makeMaterials(THREE), figs = makeFigures(THREE, mats, makeShapes(THREE, mats));
  const fig = figs.make({ id: 'still-1', shirt: '#2fa57a', look: {}, family: 'haiku', state: 'working' });
  assert.ok(await arrived(fig, 'swing'));
  fig.pose('swing', 1); fig.pose('swing', 1.05);
  fig.pose('wave', 0);
  assert.deepEqual([fig.info().clip, fig.info().weight], ['Wave', 1]);
  fig.dispose();
});

test("when a farmer goes its character's skeletons are freed, and a pointer's ray skips its skinned meshes (the figurine is its click box)", async () => {
  const mats = makeMaterials(THREE), figs = makeFigures(THREE, mats, makeShapes(THREE, mats));
  const fig = figs.make({ id: 'gone-1', shirt: '#8a5fc0', look: {}, family: 'opus', state: 'idle' });
  assert.ok(await arrived(fig));
  fig.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.2, 5), new THREE.Vector3(0, 0, -1));
  const hits = ray.intersectObject(fig.root, true);
  assert.ok(hits.length > 0, 'it can be hit');
  assert.ok(!hits.some(h => h.object.isSkinnedMesh), 'not by skinning its meshes on the CPU');
  let freed = 0;
  fig.root.traverse(o => { if (o.isSkinnedMesh) { const was = o.skeleton.dispose.bind(o.skeleton); o.skeleton.dispose = () => { freed++; was(); }; } });
  fig.dispose();
  assert.ok(freed >= 2, `${freed} skeletons freed`);
});
