// A skinned model's parts in one mesh: one draw call (and one in the shadow pass) instead of one per colour area. The
// parts on one skeleton (and placed alike) are merged, each colour area's colour baked per vertex, onto that skeleton;
// a part kept `apart` stays as it is (a cow's spotted coat, painted per animal). build/animals.js bakes each animal
// kind's model so as it loads; build/character.js does the same for the farmers its own way.
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

/** Bakes `scene`'s skinned parts into one SkinnedMesh with `material` (vertexColors). Returns { colours }: what each
 *  colour area was painted, by its material's name (sRGB hex), the parts kept apart too. */
export function bakeSkinned(THREE, scene, { material, apart = () => false }) {
  const parts = [];
  scene.traverse(o => { if (o.isSkinnedMesh && !Array.isArray(o.material)) parts.push(o); });
  const colours = Object.fromEntries(parts.map(m => [m.material.name, `#${m.material.color.getHexString()}`]));
  const first = parts.find(m => !apart(m));
  if (!first) return { colours };
  const bones = first.skeleton.bones;
  const same = m => m.parent === first.parent && m.matrix.equals(first.matrix) && m.bindMatrix.equals(first.bindMatrix)
    && m.skeleton.bones.length === bones.length && m.skeleton.bones.every((b, i) => b === bones[i]);
  const merging = parts.filter(m => !apart(m) && same(m));
  if (merging.length < 2) return { colours };
  let geos = merging.map(m => {
    const g = m.geometry.clone(), n = g.attributes.position.count, c = m.material.color;
    for (const k of Object.keys(g.attributes)) if (!['position', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
    for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k];
    return g;
  });
  if (!geos.every(g => g.index)) geos = geos.map(g => (g.index ? g.toNonIndexed() : g)); // all indexed, or none
  const merged = mergeGeometries(geos);
  if (!merged) return { colours }; // parts that don't merge (their data of different kinds): left as they were
  const mesh = new THREE.SkinnedMesh(merged, material);
  mesh.name = first.name;
  mesh.position.copy(first.position); mesh.quaternion.copy(first.quaternion); mesh.scale.copy(first.scale);
  mesh.bind(first.skeleton, first.bindMatrix);
  mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.frustumCulled = first.frustumCulled;
  first.parent.add(mesh);
  for (const m of merging) m.removeFromParent();
  return { colours };
}
