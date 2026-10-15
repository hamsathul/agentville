// The farm's small life, drawn (life.js says where and when): fireflies drifting and blinking at night, bees looping
// over the well-grown fields, crows pecking on a harvested one and flying off. Each kind one instanced mesh (the crows
// two: bodies and wings), updated in place each frame; none casts a shadow. With Motion off (t 0) they stand still.
import { firefliesOn, fireflyRects } from '../life.js';
import { makePool, noise } from './util.js';
import { SOIL_Y } from './beds.js';

const FIREFLIES = 60, BEES_PER_BED = 6, FLY_OFF_S = 3;

export function makeLife(THREE, mats, S) {
  const group = new THREE.Group(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const flies = makePool(THREE, group, new THREE.SphereGeometry(0.2, 6, 4), mats.basic('#f2ff8a'), FIREFLIES); // unlit: as bright as their light
  const bees = makePool(THREE, group, new THREE.SphereGeometry(0.05, 5, 4), mats.std('#f0b429'), 24);
  const crowBodies = makePool(THREE, group, new THREE.SphereGeometry(0.16, 8, 6).scale(0.9, 0.7, 1.4), mats.std('#1d1d21'), 20);
  const crowWings = makePool(THREE, group, new THREE.BoxGeometry(0.34, 0.02, 0.14).translate(0.17, 0, 0), mats.std('#26262b'), 40);
  let H = 400, seeds = [], counts = { fireflies: 0, bees: 0, crows: 0 }, last = new Map(), leaving = new Map(), clock = 0;
  /** Where the fireflies live on a ground (fireflyRects'), a place each, by noise (the same every time). */
  function setGround(L) {
    H = L.H;
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
   * bees: beesFor's, flocks: the crows' flocks }.
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
    counts = { fireflies: on ? seeds.length : 0, bees: nb, crows: n };
    return on || nb > 0 || n > 0; // something moved
  }
  return { group, setGround, tick, count: () => ({ ...counts }) };
}
