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
    /** A one-off geometry (its own, freed with its builder). */
    mesh,
    disposeAll() { for (const g of geos.values()) g.dispose(); geos.clear(); },
  };
}
