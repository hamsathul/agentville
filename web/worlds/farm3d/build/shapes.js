// The few shapes every builder makes, placed by their bottom centre, in metres, with the 2D farm's pixels turned
// into ground positions by `at(x, y)`. Geometry is shared by size, so a hundred posts of one size are one geometry.
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { toWorld } from '../layout.js';

export function makeShapes(THREE, mats) {
  const geos = new Map();
  const shared = (key, make) => {
    if (!geos.has(key)) { const g = make(); g.userData.shared = true; geos.set(key, g); }
    return geos.get(key);
  };
  const r3 = v => Math.round(v * 1000) / 1000;
  // Unit shapes to bake from (see merge): a sphere, half a sphere, a capsule, a cylinder, a cone, a box, a ring.
  const units = new Map();
  const unit = name => {
    if (!units.has(name)) units.set(name, ({
      sphere: () => new THREE.SphereGeometry(1, 12, 8), dome: () => new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      capsule: () => new THREE.CapsuleGeometry(1, 1, 3, 8), cyl: () => new THREE.CylinderGeometry(1, 1, 1, 12), cone: () => new THREE.ConeGeometry(1, 1, 8),
      box: () => new THREE.BoxGeometry(1, 1, 1), ring: () => new THREE.TorusGeometry(1, 0.22, 5, 14), lump: () => new THREE.IcosahedronGeometry(1, 0),
    })[name]());
    return units.get(name);
  };
  const mat = m => (typeof m === 'string' ? mats.std(m) : m);
  const mesh = (geo, m, x, y, z, parent) => { const o = new THREE.Mesh(geo, mat(m)); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent?.add(o); return o; };
  return {
    /** The ground position of a 2D farm pixel, for a ground H pixels tall. */
    at: (x, y, H) => toWorld(x, y, H),
    box: (w, h, d, m, x, y, z, parent) => mesh(shared(`b|${r3(w)}|${r3(h)}|${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)), m, x, y + h / 2, z, parent),
    rbox: (w, h, d, m, x, y, z, parent, r = 0.08) => mesh(shared(`r|${r3(w)}|${r3(h)}|${r3(d)}|${r3(r)}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2))), m, x, y + h / 2, z, parent),
    cyl: (rt, rb, h, m, x, y, z, parent, seg = 10) => mesh(shared(`c|${r3(rt)}|${r3(rb)}|${r3(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), m, x, y + h / 2, z, parent),
    ball: (r, m, x, y, z, parent, detail = 1) => mesh(shared(`s|${r3(r)}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail)), m, x, y, z, parent),
    cone: (r, h, m, x, y, z, parent, seg = 8) => mesh(shared(`k|${r3(r)}|${r3(h)}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)), m, x, y + h / 2, z, parent),
    capsule: (r, len, m, x, y, z, parent) => mesh(shared(`p|${r3(r)}|${r3(len)}`, () => new THREE.CapsuleGeometry(r, len, 4, 10)), m, x, y, z, parent),
    sphere: (r, m, x, y, z, parent, wseg = 14, hseg = 10, phiLen = Math.PI * 2, thetaLen = Math.PI) => mesh(shared(`h|${r3(r)}|${wseg}|${hseg}|${r3(thetaLen)}`, () => new THREE.SphereGeometry(r, wseg, hseg, 0, phiLen, 0, thetaLen)), m, x, y, z, parent),
    /**
     * Parts baked into one geometry with a colour per vertex: [{ geo, color, pos, rot, scale }], `geo` one of the
     * unit shapes in UNIT (or a geometry). One mesh then draws them all, in one call.
     */
    merge(parts) {
      const pos = [], nor = [], col = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
      for (const p of parts) {
        const src = typeof p.geo === 'string' ? unit(p.geo) : p.geo, g = src.index ? src.toNonIndexed() : src.clone();
        if (p.matrix) m4.copy(p.matrix);
        else m4.compose(new THREE.Vector3(...(p.pos ?? [0, 0, 0])), q.setFromEuler(e.set(...(p.rot ?? [0, 0, 0]))), new THREE.Vector3(...(p.scale ?? [1, 1, 1])));
        g.applyMatrix4(m4);
        c.set(p.color);
        const P = g.attributes.position, N = g.attributes.normal;
        for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(c.r, c.g, c.b); }
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      out.computeBoundingSphere();
      return out;
    },
    /**
     * The still, opaque, plain-coloured meshes under a group baked into one mesh (a colour per vertex), so a building
     * of a hundred parts is one draw call. Glowing, see-through and instanced meshes stay as they are, and so does
     * anything `keep(o)` names (what moves, what is clicked). Returns the baked mesh, or null.
     */
    bake(root, { keep = () => false } = {}) {
      root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), parts = [], drop = [];
      const kept = o => { for (let p = o; p && p !== root; p = p.parent) if (keep(p)) return true; return false; };
      root.traverse(o => {
        const mt = o.material;
        if (!o.isMesh || o.isInstancedMesh || !mt || Array.isArray(mt) || !mt.isMeshStandardMaterial || mt.transparent || mt.vertexColors || mt.userData.glow || kept(o)) return;
        parts.push({ geo: o.geometry, color: `#${mt.color.getHexString()}`, matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
        drop.push(o);
      });
      if (parts.length < 2) return null;
      const baked = new THREE.Mesh(this.merge(parts), mats.std('#ffffff', { vertexColors: true }));
      baked.castShadow = baked.receiveShadow = true;
      for (const o of drop) { o.removeFromParent(); if (!o.geometry.userData?.shared) o.geometry.dispose(); }
      root.add(baked);
      return baked;
    },
    /**
     * Meshes under a group that share a material (a glowing window's, a lamp's, the glass's) merged into one mesh each,
     * where they stood, so a farmstead's forty windows are a few draw calls; the night still lights them, through
     * their material. Skinned, instanced and kept meshes (`keep(o)`: what is clicked, what moves) stay as they are.
     */
    mergeByMaterial(root, { keep = () => false } = {}) {
      root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), byMat = new Map();
      const kept = o => { for (let p = o; p && p !== root; p = p.parent) if (keep(p)) return true; return false; };
      root.traverse(o => {
        if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible || kept(o)) return;
        if (!byMat.has(o.material)) byMat.set(o.material, []);
        byMat.get(o.material).push(o);
      });
      for (const [material, list] of byMat) {
        if (list.length < 2) continue;
        const geos = list.map(o => {
          const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
          for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); // flat shading needs no normals
          return g;
        });
        const P = [];
        for (const g of geos) { P.push(...g.attributes.position.array); g.dispose(); }
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        out.computeBoundingSphere();
        const merged = new THREE.Mesh(out, material);
        merged.castShadow = list.some(o => o.castShadow); merged.receiveShadow = list.some(o => o.receiveShadow);
        for (const o of list) { o.removeFromParent(); if (!o.geometry.userData?.shared) o.geometry.dispose(); }
        root.add(merged);
      }
    },
    /** A one-off geometry (its own, freed with its builder). */
    mesh,
    disposeAll() { for (const g of geos.values()) g.dispose(); geos.clear(); for (const g of units.values()) g.dispose(); units.clear(); },
  };
}
