// Small things the builders share: the farm's noise (the same every build), its season palettes, and a few shapes.

// copied from web/worlds/farm/world.js (noise, vnoise, SEASONS)
/** 0–1023 for a spot, well mixed, the same every build. */
export const noise = (x, y) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x9e37, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) & 1023;
};
/** Smooth noise, 0–1, that changes over about s units: patches of lighter and darker grass. */
export function vnoise(x, y, s) {
  const gx = Math.floor(x / s), gy = Math.floor(y / s), tx = x / s - gx, ty = y / s - gy;
  const n = (i, j) => noise(gx + i, gy + j + 7919) / 1023, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return (n(0, 0) * (1 - sx) + n(1, 0) * sx) * (1 - sy) + (n(0, 1) * (1 - sx) + n(1, 1) * sx) * sy;
}
// grass: [dark, base, light]; canopy: [outline, shade, leaves, lit leaves]
export const SEASONS = {
  spring: { grass: ['#4f8f3a', '#5d9b46', '#6aa84f'], tuft: '#3f7d3a', blade: '#7fbf5a', shadow: '#3f7d3a', canopy: ['#1c3320', '#2f6b2f', '#3f9b3a', '#6cc04a'], bloom: '#f4b6c2', flowers: ['#ffffff', '#f4b6c2', '#ffd43b', '#e58a8a'] },
  summer: { grass: ['#4f8f3a', '#5d9b46', '#6aa84f'], tuft: '#3f7d3a', blade: '#7fbf5a', shadow: '#3f7d3a', canopy: ['#1c3320', '#264a2a', '#2f6b2f', '#3f9b3a'], flowers: ['#ffffff', '#ffd43b'] },
  autumn: { grass: ['#6b7a35', '#8a8f3a', '#a8a350'], tuft: '#6b7a35', blade: '#c9c45a', shadow: '#6b7a35', canopy: ['#5a1f19', '#9c3b30', '#c8681a', '#e9a23b'], flowers: ['#c8681a'] },
  winter: { grass: ['#c3cbd2', '#dfe9f2', '#f4f8fb'], tuft: '#9aa4ad', blade: '#ffffff', shadow: '#9aa4ad', canopy: ['#1c3320', '#264a2a', '#2f6b2f', '#ffffff'], flowers: [], snow: true },
};
export const seasonPalette = s => SEASONS[s] ?? SEASONS.summer;

/** Every mesh under an object casts and takes shadows (but those marked noShadow). */
export function shadows(obj) {
  obj.traverse(o => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } });
  return obj;
}
/** Frees the geometry of every mesh under an object (materials are shared: the cache frees them). */
export function disposeTree(obj) {
  obj.traverse(o => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
  obj.removeFromParent();
}
/**
 * An instanced mesh that grows as needed (doubling): `use(n)` makes room for n and shows the first n; `at(i, matrix,
 * color?)` places one; `flush()` sends them. One draw call however many; never casts a shadow (the small things moving each frame).
 */
export function makePool(THREE, parent, geometry, material, cap = 16) {
  let mesh = null;
  function make(n) {
    if (mesh) { parent.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.castShadow = false;
    mesh.frustumCulled = false; // its instances spread over the land
    mesh.count = 0;
    parent.add(mesh);
  }
  make(cap);
  return {
    /** Room for n, the first n shown: call before placing them (a pool that grows starts afresh). */
    use(n) { if (n > mesh.instanceMatrix.count) make(Math.max(n, mesh.instanceMatrix.count * 2)); mesh.count = n; },
    at(i, matrix, color) { mesh.setMatrixAt(i, matrix); if (color) mesh.setColorAt(i, color); },
    /** The places (and colours) set: to the graphics card. */
    flush() { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; },
    shown: () => mesh.count,
    get mesh() { return mesh; },
  };
}
