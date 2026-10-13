// A few of the farm's animals, just for fun, never for data: two cows and the sheepdog (with its red bandana, so it
// is never taken for the Explore dog) wander and graze in the yard and along the bottom meadow, kept off the beds;
// the duck family (a mallard pair and three ducklings) paddles round the pond, and slides on it in winter. At night
// they lie down. The Animals switch hides them all. Each animal is a baked mesh or two (shapes.merge).
import { POND, PX } from '../layout.js';

const COW = '#f4f1ea', PATCH = '#2a2a2e';
/** A small seeded random, so the farm's animals start the same every time. */
const seeded = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

export function makeAnimals(THREE, mats, S) {
  const group = new THREE.Group(), material = mats.std('#ffffff', { vertexColors: true });
  const mesh = (parts, parent) => { const m = new THREE.Mesh(S.merge(parts), material); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const rand = seeded(424242);
  const cowParts = () => [
    { geo: 'capsule', color: COW, pos: [0, 0.95, 0], rot: [Math.PI / 2, 0, 0], scale: [0.42, 0.85, 0.42] },
    { geo: 'sphere', color: PATCH, pos: [0.25, 1.1, 0.2], scale: [0.22, 0.2, 0.3] }, { geo: 'sphere', color: PATCH, pos: [-0.28, 0.95, -0.25], scale: [0.2, 0.25, 0.28] }, { geo: 'sphere', color: PATCH, pos: [0.05, 1.3, -0.45], scale: [0.18, 0.1, 0.2] },
    ...[[-0.2, 0.45], [0.2, 0.45], [-0.2, -0.45], [0.2, -0.45]].map(([x, z]) => ({ geo: 'cyl', color: COW, pos: [x, 0.35, z], scale: [0.09, 0.7, 0.09] })),
    ...[[-0.2, 0.45], [0.2, 0.45], [-0.2, -0.45], [0.2, -0.45]].map(([x, z]) => ({ geo: 'cyl', color: '#4e3626', pos: [x, 0.04, z], scale: [0.1, 0.08, 0.1] })),
    { geo: 'sphere', color: '#f4b6c2', pos: [0, 0.6, -0.1], scale: [0.14, 0.1, 0.16] },
    { geo: 'cyl', color: COW, pos: [0, 1.0, -0.98], rot: [0.5, 0, 0], scale: [0.03, 0.5, 0.03] },
  ];
  const cowHead = () => [
    { geo: 'box', color: COW, pos: [0, 0, 0.25], scale: [0.36, 0.38, 0.5] }, { geo: 'box', color: '#e8a0a0', pos: [0, -0.08, 0.52], scale: [0.34, 0.22, 0.12] },
    { geo: 'cone', color: '#e8d8b0', pos: [-0.14, 0.24, 0.1], rot: [0, 0, 0.5], scale: [0.04, 0.16, 0.04] }, { geo: 'cone', color: '#e8d8b0', pos: [0.14, 0.24, 0.1], rot: [0, 0, -0.5], scale: [0.04, 0.16, 0.04] },
    { geo: 'box', color: PATCH, pos: [-0.24, 0.1, 0.12], scale: [0.14, 0.06, 0.1] }, { geo: 'box', color: PATCH, pos: [0.24, 0.1, 0.12], scale: [0.14, 0.06, 0.1] },
    { geo: 'sphere', color: '#1b1420', pos: [-0.13, 0.06, 0.4], scale: [0.03, 0.03, 0.03] }, { geo: 'sphere', color: '#1b1420', pos: [0.13, 0.06, 0.4], scale: [0.03, 0.03, 0.03] },
  ];
  const dogParts = () => [
    { geo: 'capsule', color: '#1f1f22', pos: [0, 0.45, 0], rot: [Math.PI / 2, 0, 0], scale: [0.17, 0.42, 0.17] },
    { geo: 'sphere', color: '#f4f1ea', pos: [0, 0.4, 0.25], scale: [0.15, 0.15, 0.14] },
    ...[[-0.09, 0.2], [0.09, 0.2], [-0.09, -0.2], [0.09, -0.2]].map(([x, z]) => ({ geo: 'cyl', color: '#f4f1ea', pos: [x, 0.17, z], scale: [0.045, 0.34, 0.045] })),
    { geo: 'cyl', color: '#1f1f22', pos: [0, 0.55, -0.38], rot: [-0.9, 0, 0], scale: [0.05, 0.36, 0.05] }, { geo: 'sphere', color: '#f4f1ea', pos: [0, 0.68, -0.5], scale: [0.05, 0.05, 0.05] },
    { geo: 'cyl', color: '#d64545', pos: [0, 0.6, 0.3], rot: [0.3, 0, 0], scale: [0.15, 0.06, 0.15] }, { geo: 'box', color: '#d64545', pos: [0, 0.52, 0.42], rot: [0.3, 0, 0], scale: [0.12, 0.12, 0.03] },
  ];
  const dogHead = () => [
    { geo: 'sphere', color: '#1f1f22', pos: [0, 0, 0.08], scale: [0.14, 0.13, 0.15] }, { geo: 'box', color: '#f4f1ea', pos: [0, -0.04, 0.2], scale: [0.1, 0.1, 0.14] },
    { geo: 'box', color: '#f4f1ea', pos: [0, 0.08, 0.13], scale: [0.04, 0.08, 0.1] }, { geo: 'sphere', color: '#1b1420', pos: [0, -0.02, 0.28], scale: [0.03, 0.025, 0.025] },
    { geo: 'cone', color: '#1f1f22', pos: [-0.08, 0.14, 0.02], rot: [0, 0, 0.3], scale: [0.04, 0.1, 0.03] }, { geo: 'cone', color: '#1f1f22', pos: [0.08, 0.14, 0.02], rot: [0, 0, -0.3], scale: [0.04, 0.1, 0.03] },
  ];
  const duckParts = (look, k) => {
    const body = look === 'drake' ? '#9aa4ad' : look === 'hen' ? '#8b5a2b' : '#ffd43b', head = look === 'drake' ? '#2f6b2f' : look === 'hen' ? '#6b4320' : '#ffd43b';
    return [
      { geo: 'sphere', color: body, pos: [0, 0.1 * k, 0], scale: [0.13 * k, 0.1 * k, 0.2 * k] },
      { geo: 'sphere', color: head, pos: [0, 0.24 * k, 0.12 * k], scale: [0.07 * k, 0.07 * k, 0.07 * k] },
      { geo: 'cone', color: '#f08a24', pos: [0, 0.22 * k, 0.21 * k], rot: [Math.PI / 2, 0, 0], scale: [0.03 * k, 0.07 * k, 0.025 * k] },
      ...(look === 'drake' ? [{ geo: 'cyl', color: '#ffffff', pos: [0, 0.18 * k, 0.1 * k], scale: [0.06 * k, 0.015 * k, 0.06 * k] }] : []),
      { geo: 'cone', color: body, pos: [0, 0.14 * k, -0.2 * k], rot: [-1.9, 0, 0], scale: [0.05 * k, 0.1 * k, 0.03 * k] },
    ];
  };

  const walkers = [], ducks = [];
  let H = 400, roam = [], avoid = [], on = true, built = false;
  function add(kind, parts, head, headAt, speed) {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    mesh(parts, body);
    const neck = new THREE.Group();
    neck.position.set(...headAt);
    body.add(neck);
    mesh(head, neck);
    group.add(root);
    walkers.push({ kind, root, body, neck, speed, x: 0, y: 0, tx: 0, ty: 0, rest: rand() * 4, face: rand() * 6 });
  }
  function build() {
    add('cow', cowParts(), cowHead(), [0, 1.15, 0.85], 8);
    add('cow', cowParts(), cowHead(), [0, 1.15, 0.85], 8);
    add('dog', dogParts(), dogHead(), [0, 0.62, 0.42], 30);
    for (const [i, look] of ['drake', 'hen', 'duckling', 'duckling', 'duckling'].entries()) {
      const root = new THREE.Group();
      mesh(duckParts(look, look === 'duckling' ? 0.6 : 1), root);
      group.add(root);
      ducks.push({ root, lag: i === 0 ? 0 : i === 1 ? 0.35 : 0.6 + (i - 2) * 0.22, small: look === 'duckling' });
    }
    built = true;
  }
  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const blocked = (x, y) => avoid.some(r => (r.rx ? ((x - r.cx) / r.rx) ** 2 + ((y - r.cy) / r.ry) ** 2 <= 1 : inRect(x, y, r)));
  function pickSpot() {
    for (let i = 0; i < 30; i++) {
      const r = roam[Math.floor(rand() * roam.length)], x = r.x + rand() * r.w, y = r.y + rand() * r.h;
      if (!blocked(x, y)) return [x, y];
    }
    return [roam[0].x + roam[0].w / 2, roam[0].y + roam[0].h / 2];
  }
  /** Where they may go, for a ground (in 2D pixels): the yard and the meadow under the fields; off the pond, the hammocks and the woodpile. */
  function setGround(ground) {
    H = ground.H;
    if (!built) build();
    const y1 = ground.GRID.y1;
    roam = [{ x: 8, y: 138, w: 96, h: Math.max(20, y1 - 150) }, { x: 10, y: y1 + 8, w: 380, h: Math.max(8, H - y1 - 16) }];
    avoid = [{ cx: POND.cx, cy: POND.cy, rx: POND.rx + 10, ry: POND.ry + 10 }, { x: 80, y: 190, w: 34, h: 44 }, { x: 4, y: 176, w: 22, h: 18 }, { x: 52, y: y1 - 44, w: 30, h: 30 }];
    for (const w of walkers) if (!roam.some(r => inRect(w.x, w.y, r)) || blocked(w.x, w.y)) { [w.x, w.y] = pickSpot(); [w.tx, w.ty] = [w.x, w.y]; }
  }
  /** Moves them on; t the clock (0 while still), night 0 by day … 1 at night. */
  function tick(t, dt, night) {
    group.visible = on;
    if (!on || !built) return;
    const asleep = night > 0.7;
    for (const w of walkers) {
      if (t && !asleep) {
        const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy);
        if (w.rest > 0) w.rest -= dt;
        else if (d < 1) { w.rest = 3 + rand() * (w.kind === 'cow' ? 9 : 4); [w.tx, w.ty] = pickSpot(); }
        else { const step = Math.min(d, w.speed * dt); w.x += (dx / d) * step; w.y += (dy / d) * step; w.face = Math.atan2(dx, dy); }
      }
      const p = S.at(w.x, w.y, H), walking = t && !asleep && w.rest <= 0;
      w.root.position.set(p.x, 0, p.z);
      w.root.rotation.y = w.face;
      // grazing: the head goes down while resting; asleep: lying down, head on the ground
      w.neck.rotation.x = asleep ? 0.5 : !walking && w.kind === 'cow' ? 0.8 + Math.sin(t * 1.3) * 0.08 : walking ? Math.sin(t * 6) * 0.05 : 0.1;
      w.body.position.y = asleep ? (w.kind === 'cow' ? -0.55 : -0.2) : walking ? Math.abs(Math.sin(t * (w.kind === 'dog' ? 12 : 6))) * 0.04 : 0;
      w.body.rotation.z = asleep && w.kind === 'dog' ? 0.25 : 0;
    }
    // the ducks: round the pond in a line, the littlest last; on the ice in winter they slide, faster and wobbling
    const ice = Boolean(tick.ice), speed = ice ? 0.32 : 0.12;
    for (const d of ducks) {
      const a = (t || 0.5) * speed - d.lag, cx = POND.cx, cy = POND.cy;
      const x = cx + Math.cos(a) * (POND.rx - 9), y = cy + Math.sin(a) * (POND.ry - 4), p = S.at(x, y, H);
      d.root.position.set(p.x, ice ? 0.12 : 0.09 + (t ? Math.sin(t * 3 + d.lag * 5) * 0.015 : 0), p.z);
      d.root.rotation.y = Math.atan2(-Math.sin(a) * (POND.rx - 9), Math.cos(a) * (POND.ry - 4)) + (ice ? Math.sin(t * 4 + d.lag) * 0.3 : 0);
    }
  }
  return {
    group, setGround, tick,
    setOn(v) { on = v; group.visible = v; },
    setIce(v) { tick.ice = v; },
    dispose() { group.traverse(o => o.geometry?.dispose()); group.clear(); walkers.length = 0; ducks.length = 0; built = false; },
  };
}
