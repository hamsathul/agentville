// The 3D farm's drawing budget (the person: "lower it", to the spec's 400 draw calls): each animal one skinned mesh
// (build/bake.js bakeSkinned), the farmstead's lit windows and lamps merged by material (build/shapes.js mergeByMaterial).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/worlds/farm3d/vendor/three.module.js';
import { GLTFLoader } from '../../web/worlds/farm3d/vendor/GLTFLoader.js';
import { bakeSkinned } from '../../web/worlds/farm3d/build/bake.js';
import { makeShapes } from '../../web/worlds/farm3d/build/shapes.js';
import { makeMaterials } from '../../web/worlds/farm3d/build/materials.js';
import { COATS, SPOTS } from '../../web/worlds/farm3d/coats.js';

const load = async kind => {
  const b64 = (await import(`../../web/worlds/farm3d/models/${kind}.js`)).default;
  const g = await new GLTFLoader().parseAsync(Uint8Array.from(Buffer.from(b64, 'base64')).buffer, '');
  g.scene.traverse(o => { if (o.isMesh && COATS[kind]?.[o.material.name]) o.material.color.set(COATS[kind][o.material.name]); }); // painted, as animals.js does first
  return g;
};
const skinned = scene => { const out = []; scene.traverse(o => { if (o.isSkinnedMesh) out.push(o); }); return out; };

test("an animal baked: its skinned parts one mesh on its skeleton, each colour area's colour per vertex, what each area was painted kept", async () => {
  const { scene } = await load('bull'), before = skinned(scene), painted = Object.fromEntries(before.map(m => [m.material.name, `#${m.material.color.getHexString()}`]));
  assert.ok(before.length >= 3, `${before.length} parts to start with`);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true }), { colours } = bakeSkinned(THREE, scene, { material: mat });
  const after = skinned(scene);
  assert.equal(after.length, 1, 'one mesh: one draw call');
  assert.equal(after[0].material, mat);
  assert.equal(after[0].skeleton.bones.length, before[0].skeleton.bones.length, 'on the same skeleton');
  assert.deepEqual(colours, painted);
  const c = after[0].geometry.attributes.color, seen = new Set();
  for (let i = 0; i < c.count; i++) seen.add(`#${new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString()}`);
  for (const hex of Object.values(painted)) assert.ok(seen.has(hex), `${hex} painted on its vertices`);
  assert.equal(after[0].geometry.attributes.position.count, before.reduce((n, m) => n + m.geometry.attributes.position.count, 0), 'every vertex kept');
});

test("a cow baked: her spotted coat kept apart (each cow paints her own spots on her own copy), the rest one mesh", async () => {
  const { scene } = await load('cow');
  bakeSkinned(THREE, scene, { material: new THREE.MeshStandardMaterial({ vertexColors: true }), apart: m => m.material.name === SPOTS.cow.area });
  const after = skinned(scene);
  assert.equal(after.length, 2);
  assert.ok(after.some(m => m.material.name === SPOTS.cow.area), 'her coat, its own mesh and material');
});

test('the lit windows and lamps: meshes sharing a material merged into one each (not the click boxes or what is kept apart), where they stood', () => {
  const mats = makeMaterials(THREE), S = makeShapes(THREE, mats), g = new THREE.Group();
  const glass = mats.glow('#a9dcf7', '#ffd27a', { night: 1 }), lamp = mats.glow('#ffe0a0', '#ffe0a0', { night: 2 });
  for (let k = 0; k < 6; k++) S.box(1, 1, 0.1, glass, k * 2, 0, 0, g);
  for (let k = 0; k < 4; k++) S.ball(0.2, lamp, k, 3, 1, g);
  const kept = S.box(1, 1, 1, glass, 20, 0, 0, g);
  kept.userData.hit = 'barn';
  S.mergeByMaterial(g, { keep: o => Boolean(o.userData.hit) });
  const meshes = g.children.filter(o => o.isMesh);
  assert.equal(meshes.length, 3, 'one for the glass, one for the lamps, and the one kept');
  assert.ok(meshes.includes(kept));
  const merged = meshes.find(m => m.material === glass && m !== kept);
  merged.geometry.computeBoundingBox();
  assert.ok(Math.abs(merged.geometry.boundingBox.max.x - 10.5) < 1e-6 && Math.abs(merged.geometry.boundingBox.min.x + 0.5) < 1e-6, 'where they stood');
});
