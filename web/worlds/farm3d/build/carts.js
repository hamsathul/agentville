// The carts (carts.js says where): each MCP server's, a wooden cart with a crate in the server's colour pulled by a
// pony (a copy of the donkey's model, smaller), walking while it drives and standing while it waits; and a web call's
// cart to town, out along the lane past the farm's edge and back, a parcel on it. The carts are a few simple shapes,
// shared by all.
import { LANE } from '../layout.js';

const PONY = { size: 0.8 };

export function makeCarts(THREE, mats, S, { copy }) {
  const group = new THREE.Group();
  const geo = { bed: new THREE.BoxGeometry(1.4, 0.45, 0.95), rim: new THREE.BoxGeometry(1.5, 0.08, 1.05), wheel: new THREE.CylinderGeometry(0.36, 0.36, 0.1, 12), shaft: new THREE.BoxGeometry(1.3, 0.06, 0.06), crate: new THREE.BoxGeometry(0.55, 0.5, 0.55) };
  const mat = { wood: mats.std('#a8703c'), rim: mats.std('#c98d4f'), wheel: mats.std('#4e3626'), parcel: mats.std('#f4ecd8') };
  const carts = new Map(), roads = new Map(); // server → { obj, pony, crate }; farmer id → { obj, pony }
  let H = 400, groundAt = () => 0;

  /** A cart facing +x (its shafts ahead), its crate on it in `colour`; its pony comes when the donkey's model has. */
  function makeCart(colour) {
    const g = new THREE.Group(), add = (gm, m, x, y, z) => { const o = new THREE.Mesh(gm, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    add(geo.bed, mat.wood, 0, 0.6, 0);
    add(geo.rim, mat.rim, 0, 0.84, 0);
    for (const sz of [-0.52, 0.52]) add(geo.wheel, mat.wheel, -0.15, 0.36, sz).rotation.x = Math.PI / 2;
    for (const sz of [-0.3, 0.3]) add(geo.shaft, mat.wood, 1.25, 0.62, sz);
    const crate = add(geo.crate, colour ? mats.std(colour) : mat.parcel, -0.1, 1.12, 0);
    const c = { obj: g, pony: null, crate, gone: false };
    copy('donkey', PONY).then(p => { if (c.gone) { p.dispose(); return; } c.pony = p; p.root.position.set(2.1, 0, 0); p.root.rotation.y = Math.PI / 2; g.add(p.root); }).catch(() => {}); // no model: a cart without a pony
    group.add(g);
    return c;
  }
  const drop = c => { c.gone = true; c.pony?.dispose(); c.obj.removeFromParent(); };
  /** Puts a cart at a 2D point, facing along x (dir 1 right, -1 left) or, going down or up a walkway, along z. */
  function place(c, x, y, dir, along, down, moving, dt, still) {
    const p = S.at(x, y, H);
    c.obj.position.set(p.x, groundAt(x, y), p.z); // on the ground under it: a bed's soil, the grass
    c.obj.rotation.y = along ? (down ? -Math.PI / 2 : Math.PI / 2) : dir > 0 ? 0 : Math.PI;
    if (c.pony) { c.pony.part(moving && !still ? 'walk' : 'idle'); if (!still) c.pony.tick(dt); }
  }
  return {
    group,
    setGround(h, at) { H = h; if (at) groundAt = at; },
    /** The MCP carts (carts.js's items) and the web calls' carts ([{ id, x, dir }]), each frame. */
    tick(items, road, dt, still) {
      const keep = new Set();
      for (const it of items) {
        keep.add(it.server);
        let c = carts.get(it.server);
        if (!c) { c = makeCart(it.crate); c.last = [it.x, it.y]; carts.set(it.server, c); }
        const down = it.y > c.last[1];
        place(c, it.x, it.y, it.dir, it.along, down, it.moving, dt, still);
        c.last = [it.x, it.y];
      }
      for (const [k, c] of carts) if (!keep.has(k)) { drop(c); carts.delete(k); }
      const keepR = new Set();
      for (const r of road) {
        keepR.add(r.id);
        let c = roads.get(r.id);
        if (!c) { c = makeCart(null); roads.set(r.id, c); }
        place(c, r.x, r.y ?? LANE + 4, r.dir, Boolean(r.along), Boolean(r.along) && r.dir < 0, true, dt, still); // up the road to town, with a neighbour farm
      }
      for (const [k, c] of roads) if (!keepR.has(k)) { drop(c); roads.delete(k); }
    },
    count: () => ({ carts: carts.size, roadCarts: roads.size }),
  };
}
