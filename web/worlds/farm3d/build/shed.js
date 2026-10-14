// The machine shed (spec 2026-10-14 §7): an open-fronted timber shed on the lane past the scarecrow patch, its metal
// roof sloping to the back, holding Kenney's loader tractor and the combine as stock (so the farm has machines even when
// none are out; the combine hides while it is out). A click on it opens who is out on a machine (machines.js
// machinesDialog).
import { PX, SHED } from '../layout.js';
import { disposeTree } from './util.js';

export function makeShed(THREE, mats, S, machines) {
  const group = new THREE.Group(), hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const stock = { loader: machines.stock('loader'), combine: machines.stock('combine') };
  for (const m of Object.values(stock)) group.add(m.root);
  let built = null, hit = null;

  /** The shed for a ground H pixels tall. */
  function build(H) {
    if (built) disposeTree(built);
    const g = new THREE.Group(), m = v => v / PX, c = S.at(SHED.x + SHED.w / 2, SHED.y + SHED.h / 2, H), w = m(SHED.w), d = m(SHED.h), h = 4.4;
    const back = c.z - d / 2, front = c.z + d / 2;
    S.box(w, 0.1, d, '#9a9488', c.x, 0, c.z, g); // its floor
    S.box(w, h, 0.25, '#8a5a35', c.x, 0, back + 0.12, g); // the back wall, and the sides
    for (const sx of [-1, 1]) S.box(0.25, h, d, '#8a5a35', c.x + sx * (w / 2 - 0.12), 0, c.z, g);
    for (let k = 1; k < 7; k++) { // the planks' lines
      S.box(w - 0.1, 0.05, 0.28, '#6e4628', c.x, (k * h) / 7, back + 0.12, g);
      for (const sx of [-1, 1]) S.box(0.28, 0.05, d - 0.1, '#6e4628', c.x + sx * (w / 2 - 0.12), (k * h) / 7, c.z, g);
    }
    for (const fx of [-0.5, 0, 0.5]) S.box(0.32, h + 0.5, 0.32, '#6e4628', c.x + fx * (w - 0.32), 0, front - 0.16, g); // the open front's posts
    S.box(w + 0.2, 0.35, 0.3, '#6e4628', c.x, h + 0.25, front - 0.16, g); // and the beam over it
    const roof = S.box(w + 1.0, 0.12, d + 1.6, '#a3abb3', c.x, 0, c.z + 0.3, g); // the metal roof, high at the front
    roof.position.y = h + 0.55; roof.rotation.x = -0.1;
    for (let k = 0; k < 9; k++) { const rib = S.box(0.08, 0.08, d + 1.6, '#7d868f', -w / 2 - 0.3 + (k * (w + 0.6)) / 8, 0.06, 0, roof); rib.position.y = 0.1; }
    S.bake(g);
    hit = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.6, d), hitMat); // what a click finds
    hit.position.set(c.x, (h + 0.6) / 2, c.z);
    hit.userData.hit = 'shed';
    g.add(hit);
    group.add(g);
    built = g;
    // the stock, parked facing the lane: the tractor in the left bay, the combine in the right
    stock.loader.root.position.set(c.x - w / 2 + 1.7, 0.1, c.z - 0.2);
    stock.combine.root.position.set(c.x + w / 2 - 2.6, 0.1, c.z - 0.6);
  }
  return {
    group, build,
    /** Each frame: the loader's model once it loads; the combine hides while it is out. */
    tick(items) {
      machines.restock(stock.loader);
      stock.combine.root.visible = !items.some(i => i.vehicle === 'combine' && i.phase !== 'walking'); // waiting for its farmer, it is still in the shed
    },
    /** What a click can find: the shed's box (userData.hit: 'shed'). */
    hits: () => (hit ? [hit] : []),
  };
}
