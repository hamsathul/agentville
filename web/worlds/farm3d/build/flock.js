// Subagents on the 3D farm (flock.js's rules, the 2D farm's): each farmer's running subagents as hens at its heels,
// hopping while it walks, an Explore one as a small tan dog circling it (a copy of the Shiba's model, its own coat and a
// green bandana); at the henhouse the eggs (subagents done lately) and the hens no farmer can lead, roosting in the run;
// and notes rising from a farmer's whistle while it calls subagents. The hens are a few simple shapes, shared by all.
import { HENHOUSE } from '../layout.js';
import { EXPLORE_DOG } from '../coats.js';
import { henhouseView, kidSpot } from '../flock.js';

const DOG = { size: 0.75, coat: EXPLORE_DOG, scarf: '#3f9b3a' };

export function makeFlock(THREE, mats, S, { copy }) {
  const group = new THREE.Group(), coop = new THREE.Group(), notes = new THREE.Group();
  group.add(coop, notes);
  const geo = {
    body: new THREE.SphereGeometry(0.22, 10, 8), head: new THREE.SphereGeometry(0.13, 8, 6), comb: new THREE.BoxGeometry(0.05, 0.09, 0.12),
    beak: new THREE.ConeGeometry(0.045, 0.1, 6), leg: new THREE.CylinderGeometry(0.018, 0.018, 0.16, 5), egg: new THREE.SphereGeometry(0.07, 8, 6),
    note: new THREE.BoxGeometry(0.09, 0.07, 0.02), stem: new THREE.BoxGeometry(0.018, 0.16, 0.02),
  };
  const mat = { white: mats.std('#f7f3ea'), red: mats.std('#d64545'), yellow: mats.std('#f0b429'), egg: mats.std('#fbf6ea'), ink: mats.std('#2a1d14') };
  const hens = new Map(), dogs = new Map(); // `${farmer}#${k}` → { obj, x, y, face, k, id } (a dog's obj is its model's copy, once loaded)
  let H = 400, coopKey = '';

  /** One hen: a plump white body, a head with a red comb and a yellow beak, two yellow legs; facing +z. */
  function makeHen() {
    const g = new THREE.Group(), add = (gm, m, x, y, z) => { const o = new THREE.Mesh(gm, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    add(geo.body, mat.white, 0, 0.32, 0).scale.set(1.2, 0.95, 1.4);
    add(geo.head, mat.white, 0, 0.55, 0.22);
    add(geo.comb, mat.red, 0, 0.69, 0.22);
    add(geo.beak, mat.yellow, 0, 0.54, 0.36).rotation.x = Math.PI / 2;
    for (const sx of [-0.08, 0.08]) add(geo.leg, mat.yellow, sx, 0.08, 0);
    g.scale.setScalar(1.25); // larger than life, as the farmers and the animals are
    return g;
  }
  /** The kids of the farmers drawn now (id → their kids, each { id, dog }): a hen or a dog for each, at its farmer's heels. */
  function sync(kidsById, posOf) {
    const keepH = new Set(), keepD = new Set();
    for (const [id, kids] of kidsById) (kids ?? []).slice(0, 4).forEach((kid, k) => {
      const key = `${id}#${k}`, p = posOf(id), [x, y] = p ? kidSpot([p.x, p.y], k, 0, kid.dog) : [0, 0];
      if (kid.dog) {
        keepD.add(key);
        if (!dogs.has(key)) {
          const d = { obj: null, x, y, face: 0, k, id, gone: false };
          dogs.set(key, d);
          copy('shiba', DOG).then(c => { if (d.gone) { c.dispose(); return; } d.obj = c; c.part('walk'); group.add(c.root); }).catch(() => {}); // no model: no dog
        }
      } else {
        keepH.add(key);
        if (!hens.has(key)) { const obj = makeHen(); group.add(obj); hens.set(key, { obj, x, y, face: 0, k, id }); }
      }
    });
    for (const [key, h] of hens) if (!keepH.has(key)) { h.obj.removeFromParent(); hens.delete(key); }
    for (const [key, d] of dogs) if (!keepD.has(key)) { d.gone = true; d.obj?.dispose(); dogs.delete(key); }
  }
  /** The henhouse for a ground H high: its eggs in the nest, its roosting hens in the run. */
  function setHenhouse(view, h) {
    H = h;
    const key = `${h}|${view.eggs}|${view.roosting}`;
    if (key === coopKey) return;
    coopKey = key;
    while (coop.children.length) coop.children[0].removeFromParent();
    for (let i = 0; i < view.eggs; i++) { const p = S.at(HENHOUSE.x + 8 + i * 3, HENHOUSE.y + 31, H), e = new THREE.Mesh(geo.egg, mat.egg); e.position.set(p.x, 0.07, p.z + 0.25); e.scale.set(1, 1.25, 1); coop.add(e); }
    for (let i = 0; i < view.roosting; i++) { const p = S.at(HENHOUSE.x + 50 + i * 12, HENHOUSE.y + 18 + (i % 2) * 6, H), hen = makeHen(); hen.position.set(p.x, 0, p.z); hen.rotation.y = i * 1.9; hen.userData.roost = i; coop.add(hen); }
  }
  /** Each frame: the hens and dogs to their places by their farmers (t: the clock, 0 while still: there at once). */
  function tick(t, dt, posOf, still, groundAt = () => 0) {
    const ease = still ? 1 : Math.min(1, dt * 4);
    const move = (o, at, p, rise) => {
      const dx = at[0] - o.x, dy = at[1] - o.y;
      o.x += dx * ease; o.y += dy * ease;
      if (Math.hypot(dx, dy) > 0.3) o.face = Math.atan2(dx, dy);
      const w = S.at(o.x, o.y, H);
      return { x: w.x, y: groundAt(o.x, o.y) + rise, z: w.z }; // on the ground under it: the deck, a bed, the grass
    };
    for (const h of hens.values()) {
      const p = posOf(h.id);
      if (!p) { h.obj.visible = false; continue; }
      h.obj.visible = true;
      const at = move(h, kidSpot([p.x, p.y], h.k, t, false), p, p.moving && !still ? Math.abs(Math.sin(t * 12 + h.k)) * 0.12 : 0);
      h.obj.position.set(at.x, at.y, at.z);
      h.obj.rotation.y = h.face;
    }
    for (const d of dogs.values()) {
      const p = posOf(d.id);
      if (!d.obj) continue;
      d.obj.root.visible = Boolean(p);
      if (!p) continue;
      const before = [d.x, d.y], at = move(d, kidSpot([p.x, p.y], d.k, t, true), p, 0), moved = Math.hypot(d.x - before[0], d.y - before[1]);
      d.obj.root.position.set(at.x, at.y, at.z);
      d.obj.root.rotation.y = d.face;
      d.obj.part(moved > 0.05 || !t ? 'walk' : 'idle');
      if (!still) d.obj.tick(dt);
    }
    for (const hen of coop.children) if (hen.userData.roost !== undefined) hen.rotation.z = still ? 0 : Math.sin(t * 2 + hen.userData.roost) * 0.1; // wobbling on the roost
  }
  /** Notes rising from the whistles of the farmers calling subagents (`heads`: their heads, in the world), every 1.2 s. */
  let lastNotes = -1;
  function whistle(t, heads, still) {
    for (const n of [...notes.children]) {
      const k = (t - n.userData.born) / 1.2;
      if (still || k >= 1) { n.removeFromParent(); continue; }
      n.position.y = n.userData.y + k * 0.8;
      n.scale.setScalar(1 - k * 0.7);
    }
    if (still || !heads.length || t - lastNotes < 1.2) return;
    lastNotes = t;
    for (const h of heads) for (const side of [-1, 1]) {
      const n = new THREE.Group(), head = new THREE.Mesh(geo.note, mat.ink), stem = new THREE.Mesh(geo.stem, mat.ink);
      stem.position.set(0.04, 0.08, 0);
      n.add(head, stem);
      n.position.set(h.x + side * 0.35, h.y, h.z);
      n.userData = { born: t + (side > 0 ? 0.3 : 0), y: h.y };
      notes.add(n);
    }
  }
  return {
    group, sync, tick, setHenhouse, whistle,
    /** How many hens and dogs follow farmers now (for the check). */
    count: () => ({ hens: hens.size, dogs: [...dogs.values()].filter(d => d.obj).length, eggs: coop.children.filter(c => c.userData.roost === undefined).length, roosting: coop.children.filter(c => c.userData.roost !== undefined).length }),
  };
}
