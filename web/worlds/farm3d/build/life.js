// The farm's small life, drawn (life.js says where and when): fireflies drifting and blinking at night, bees looping
// over the well-grown fields, crows pecking on a harvested one and flying off. Each kind one instanced mesh (the crows
// two: bodies and wings), updated in place each frame; none casts a shadow. With Motion off (t 0) they stand still.
import { firefliesOn, fireflyRects } from '../life.js';
import { PX, W } from '../layout.js';
import { makePool, noise } from './util.js';
import { SOIL_Y } from './beds.js';

const FIREFLIES = 60, BEES_PER_BED = 6, FLY_OFF_S = 3, CLOUDS = 6, PUFFS = 3, SMOKE = 8, SMOKE_S = 5, LEAVES = 30, LEAF_S = 2, PUFF_S = 0.6;

export function makeLife(THREE, mats, S) {
  const group = new THREE.Group(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const flies = makePool(THREE, group, new THREE.SphereGeometry(0.2, 6, 4), mats.basic('#f2ff8a'), FIREFLIES); // unlit: as bright as their light
  const bees = makePool(THREE, group, new THREE.SphereGeometry(0.05, 5, 4), mats.std('#f0b429'), 24);
  const crowBodies = makePool(THREE, group, new THREE.SphereGeometry(0.16, 8, 6).scale(0.9, 0.7, 1.4), mats.std('#1d1d21'), 20);
  const crowWings = makePool(THREE, group, new THREE.BoxGeometry(0.34, 0.02, 0.14).translate(0.17, 0, 0), mats.std('#26262b'), 40);
  const puffs = makePool(THREE, group, new THREE.IcosahedronGeometry(1, 1), mats.std('#eef2f5', { opacity: 0.88 }), CLOUDS * PUFFS);
  const grey = makePool(THREE, group, new THREE.IcosahedronGeometry(1, 1), mats.std('#a9b2bb', { opacity: 0.9 }), CLOUDS * PUFFS);
  const smoke = makePool(THREE, group, new THREE.SphereGeometry(0.32, 6, 5), mats.std('#d9d9d9', { opacity: 0.55 }), SMOKE * 2);
  const lamps = makePool(THREE, group, new THREE.SphereGeometry(0.11, 6, 4), mats.basic('#fff6d0'), 20);
  const cones = makePool(THREE, group, new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), mats.basic('#fff3c0', { opacity: 0.2 }), 10);
  const piles = makePool(THREE, group, new THREE.SphereGeometry(0.7, 8, 5).scale(1, 0.35, 1), mats.std('#c8681a'), 6);
  const leaves = makePool(THREE, group, new THREE.PlaneGeometry(0.16, 0.12), mats.std('#e09a3a', { side: THREE.DoubleSide }), LEAVES * 2);
  const balls = makePool(THREE, group, new THREE.SphereGeometry(0.1, 8, 6), mats.std('#ffffff'), 8);
  const snowPuffs = makePool(THREE, group, new THREE.SphereGeometry(0.07, 6, 4), mats.std('#f4f8fb'), 24);
  const bursts = [], puffsAt = []; // leaf bursts { x, z, t0 } and snow puffs { x, y, z, t0 }, on the frame clock
  let H = 400, LW = W, seeds = [], counts = { fireflies: 0, bees: 0, crows: 0, clouds: 0, smoke: 0, headlights: 0 }, last = new Map(), leaving = new Map(), clock = 0;
  let shownClouds = 0; // eased toward the wanted count: new clouds fade in, extra ones fade out
  /** Where the fireflies live on a ground (fireflyRects'), a place each, by noise (the same every time). */
  function setGround(L) {
    H = L.H; LW = L.land?.w ?? W;
    const rects = fireflyRects(L), area = rects.reduce((a, r) => a + r.w * r.h, 0);
    seeds = Array.from({ length: FIREFLIES }, (_, i) => {
      let pick = (noise(i * 13, 7) / 1023) * area, r = rects[0];
      for (const rr of rects) { pick -= rr.w * rr.h; r = rr; if (pick <= 0) break; }
      return { x: r.x + (noise(i, 31) / 1023) * r.w, y: r.y + (noise(31, i) / 1023) * r.h, phase: (noise(i, i) / 1023) * 6.28 };
    });
  }
  const place = (pool, i, x, y, h, rx = 0, ry = 0, rz = 0, s = 1) => {
    const p = S.at(x, y, H);
    pool.at(i, m4.compose(pos.set(p.x, h, p.z), q.setFromEuler(e.set(rx, ry, rz)), scale.set(s, s, s)));
  };
  /** One crow: its body at (x, y) map, h up, facing `turn`; its wings folded (flap 0) or beating. */
  function crow(i, x, y, h, turn, flap) {
    place(crowBodies, i, x, y, h, 0, turn);
    const p = S.at(x, y, H);
    for (const side of [-1, 1]) {
      const k = i * 2 + (side > 0 ? 1 : 0);
      crowWings.at(k, m4.compose(pos.set(p.x + Math.cos(turn) * side * 0.1, h + 0.04, p.z - Math.sin(turn) * side * 0.1), q.setFromEuler(e.set(0, turn + (side > 0 ? 0 : Math.PI), side * flap)), scale.set(1, 1, 1)));
    }
  }
  /**
   * The moment's life: t the farm's clock (0 while still), dt the seconds since the last frame, s: { night, season,
   * bees: beesFor's, flocks: the crows' flocks, clouds: how many (mood.js), dim, smoke: [{ x, y, z }] the smoking
   * chimneys' tops, machines: the machines' items, headlights: on or not }.
   */
  function tick(t, dt, s) {
    clock += t ? dt : 0;
    // fireflies: drifting about their places, blinking each on its own beat
    const on = firefliesOn(s.night, s.season);
    flies.use(on ? seeds.length : 0);
    if (on) seeds.forEach((f, i) => {
      const blink = 0.25 + 0.75 * Math.max(0, Math.sin(clock * 1.7 + f.phase * 3)); // never quite out
      place(flies, i, f.x + Math.sin(clock * 0.3 + f.phase) * 10, f.y + Math.cos(clock * 0.25 + f.phase * 1.3) * 10, 0.5 + (Math.sin(clock * 0.4 + f.phase) + 1), 0, 0, 0, blink);
    });
    flies.flush();
    // bees: quick loops over each well-grown field
    const nb = s.bees.length * BEES_PER_BED;
    bees.use(nb);
    s.bees.forEach((b, j) => {
      for (let k = 0; k < BEES_PER_BED; k++) {
        const a = clock * (2.5 + k * 0.3) + k * 1.05 + j, r = 8 + (k % 3) * 4;
        place(bees, j * BEES_PER_BED + k, b.x + Math.cos(a) * r * 1.6, b.y + Math.sin(a * 1.3) * r, SOIL_Y + 0.6 + 0.35 * Math.sin(clock * 5 + k));
      }
    });
    bees.flush();
    // crows: pecking on their field; a flock that went (scared, or its time up) flies off up and away for 3 s
    const now = new Map(s.flocks.map(f => [f.key, f]));
    for (const [key, f] of last) if (!now.has(key) && !leaving.has(key)) leaving.set(key, { f, t0: clock });
    for (const [key, l] of leaving) if (clock - l.t0 > FLY_OFF_S || now.has(key)) leaving.delete(key);
    last = now;
    const perched = [...now.values()], away = [...leaving.values()], n = perched.reduce((a, f) => a + f.n, 0) + away.reduce((a, l) => a + l.f.n, 0);
    crowBodies.use(n); crowWings.use(n * 2);
    let i = 0;
    for (const f of perched) for (let k = 0; k < f.n; k++, i++) {
      const dx = ((noise(k, f.x) % 80) - 40), dy = ((noise(f.y, k) % 40) - 20), peck = Math.abs(Math.sin(clock * 6 + k * 1.7)) > 0.8 ? -0.06 : 0;
      crow(i, f.x + dx, f.y + dy, SOIL_Y + 0.12 + peck, k * 1.3, 0);
    }
    for (const l of away) for (let k = 0; k < l.f.n; k++, i++) {
      const u = (clock - l.t0) / FLY_OFF_S, dx = ((noise(k, l.f.x) % 80) - 40) + u * 120, dy = ((noise(l.f.y, k) % 40) - 20) - u * 60;
      crow(i, l.f.x + dx, l.f.y + dy, SOIL_Y + 0.12 + u * 8, -Math.PI / 4, Math.sin(clock * 30 + k) * 0.9);
    }
    crowBodies.flush(); crowWings.flush();
    // clouds: drifting east over the land at 25–35 m, as many as agents waiting want (mood.js), greyer when the sky dims
    shownClouds += Math.sign((s.clouds ?? 0) - shownClouds) * Math.min(Math.abs((s.clouds ?? 0) - shownClouds), (dt || 0.1) * 0.5);
    const nc = Math.ceil(shownClouds - 1e-6), pool = s.dim > 0 ? grey : puffs, other = s.dim > 0 ? puffs : grey;
    pool.use(nc * PUFFS); other.use(0);
    const span = LW / PX + 80, x0 = S.at(0, 0, H).x - 40;
    for (let c = 0; c < nc; c++) {
      const fade = Math.min(1, shownClouds - c), cx = x0 + ((c * 37 + clock * 1.0) % span), cz = S.at(0, H * (0.15 + 0.14 * c), H).z, cy = 25 + (c % 3) * 5;
      for (let k = 0; k < PUFFS; k++) {
        pool.at(c * PUFFS + k, m4.compose(pos.set(cx + (k - 1) * 3.2, cy + (k % 2) * 0.8, cz + (k % 2 ? 1.2 : -0.6)), q.identity(), scale.set(4 * fade, 1.8 * fade, 3 * fade)));
      }
    }
    pool.flush();
    // chimney smoke: puffs rising from each smoking farm's flue, growing and thinning over 5 s
    const flues = s.smoke ?? [];
    smoke.use(flues.length * SMOKE);
    flues.forEach((f, j) => {
      for (let k = 0; k < SMOKE; k++) {
        const age = (clock + (k * SMOKE_S) / SMOKE) % SMOKE_S, u = age / SMOKE_S, size = (0.5 + u * 1.8) * (1 - u * u);
        smoke.at(j * SMOKE + k, m4.compose(pos.set(f.x + u * 1.5, f.y + age * 1.0, f.z - u * 0.6), q.identity(), scale.set(size, size, size)));
      }
    });
    smoke.flush();
    // headlights: two lamps on each machine's nose and a soft cone of light on the ground ahead, at night
    const ms = s.headlights ? s.machines ?? [] : [];
    lamps.use(ms.length * 2); cones.use(ms.length);
    ms.forEach((m, j) => {
      const p = S.at(m.x, m.y, H), fx = Math.cos(m.heading), fz = Math.sin(m.heading); // its heading on the map, x right and y down: the same on the ground
      for (const [k, side] of [[0, -1], [1, 1]]) lamps.at(j * 2 + k, m4.makeTranslation(p.x + fx * 1.6 - fz * side * 0.5, 1.1, p.z + fz * 1.6 + fx * side * 0.5));
      cones.at(j, m4.compose(pos.set(p.x + fx * 4.2, 0.06, p.z + fz * 4.2), q.setFromEuler(e.set(0, -m.heading + Math.PI / 2, 0)), scale.set(1.6, 1, 3)));
    });
    lamps.flush(); cones.flush();
    // autumn's leaf piles, and the leaves a dog sends flying (thrown up and out, falling back over 2 s)
    const ps = s.piles ?? [];
    piles.use(ps.length);
    ps.forEach(([x, y], i) => place(piles, i, x, y, 0.05));
    piles.flush();
    for (let i = bursts.length - 1; i >= 0; i--) if (clock - bursts[i].t0 > LEAF_S) bursts.splice(i, 1);
    leaves.use(bursts.length * LEAVES);
    bursts.forEach((b, j) => {
      const u = clock - b.t0;
      for (let k = 0; k < LEAVES; k++) {
        const a = k * 0.21 + j, sp = 1.2 + (k % 5) * 0.35, h = Math.max(0.05, 0.4 + (2.6 + (k % 4) * 0.4) * u - 2.6 * u * u);
        leaves.at(j * LEAVES + k, m4.compose(pos.set(b.x + Math.cos(a) * sp * u, h, b.z + Math.sin(a) * sp * u), q.setFromEuler(e.set(u * 6 + k, u * 4, k)), scale.set(1, 1, 1)));
      }
    });
    leaves.flush();
    // snowballs in the air (s.balls: { a, b, u }: from a to b in the world, u of the way), and the puffs where they land
    const bs = s.balls ?? [];
    balls.use(bs.length);
    bs.forEach((b, i) => balls.at(i, m4.makeTranslation(b.a.x + (b.b.x - b.a.x) * b.u, b.a.y + (b.b.y - b.a.y) * b.u + Math.sin(Math.PI * b.u) * 1.8, b.a.z + (b.b.z - b.a.z) * b.u)));
    balls.flush();
    for (let i = puffsAt.length - 1; i >= 0; i--) if (clock - puffsAt[i].t0 > PUFF_S) puffsAt.splice(i, 1);
    snowPuffs.use(puffsAt.length * 6);
    puffsAt.forEach((p, j) => {
      const u = (clock - p.t0) / PUFF_S;
      for (let k = 0; k < 6; k++) snowPuffs.at(j * 6 + k, m4.compose(pos.set(p.x + Math.cos(k) * u * 0.6, p.y + Math.sin(k * 2) * u * 0.3, p.z + Math.sin(k) * u * 0.6), q.identity(), scale.set(1 - u, 1 - u, 1 - u)));
    });
    snowPuffs.flush();
    counts = { fireflies: on ? seeds.length : 0, bees: nb, crows: n, clouds: nc, smoke: flues.length * SMOKE, headlights: ms.length * 2, piles: ps.length, leaves: bursts.length * LEAVES, snowballs: bs.length };
    return on || nb > 0 || n > 0 || nc > 0 || flues.length > 0 || ms.length > 0 || bursts.length > 0 || bs.length > 0 || puffsAt.length > 0; // something moved
  }
  return {
    group, setGround, tick, count: () => ({ ...counts }),
    /** Leaves burst from a pile at (x, y) on the map (a dog dived in). */
    leaves(x, y) { const p = S.at(x, y, H); bursts.push({ x: p.x, z: p.z, t0: clock }); },
    /** A snowball lands at a point in the world: a puff of snow. */
    puff(p) { puffsAt.push({ x: p.x, y: p.y, z: p.z, t0: clock }); },
  };
}
