// The farm's animals, just for fun, never for data: all twelve of Quaternius's Animated Animal Pack (CC0; see
// models/LICENSE.md). Two cows, a bull, two alpacas, a donkey and two horses in the pasture; the husky (in a red
// bandana) and the Shiba Inu (in a blue one) in the yard, so neither is taken for a dog that means something; a deer,
// a stag, a fox and a wolf at the forest's edge. What they do is antics.js's: they walk, rest and graze, get up to
// something now and then, rest at night, and do what you pick from an animal's menu. This draws it: each kind's model
// loaded once (after the farm has drawn), every animal its own copy with its own animation player, playing the clip
// for each part (models/index.js), repainted in the farm's colours and finish (coats.js). The Animals switch hides them all.
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/SkeletonUtils.js';
import { NAPS, POND, SHADE, WOODPILE, forestEdgeOf, pastureOf } from '../layout.js';
import { MODELS } from '../models/index.js';
import { ACTS, advance, command, makeAnimal, menuFor } from '../antics.js';
import { COATS, FINISH, SPOTS, spotsOf } from '../coats.js';

// Who lives where, and their pace (2D pixels a second: 8 a metre): walking, and running.
const HERDS = [
  { kind: 'cow', n: 2, area: 'pasture', walk: 7, run: 40 },
  { kind: 'bull', n: 1, area: 'pasture', walk: 7, run: 40 },
  { kind: 'alpaca', n: 2, area: 'pasture', walk: 8, run: 40 },
  { kind: 'donkey', n: 1, area: 'pasture', walk: 8, run: 40 },
  { kind: 'horse', n: 1, area: 'pasture', walk: 10, run: 52 },
  { kind: 'whitehorse', n: 1, area: 'pasture', walk: 10, run: 52 },
  { kind: 'husky', n: 1, area: 'yard', walk: 12, run: 44, bandana: '#d64545' },
  { kind: 'shiba', n: 1, area: 'yard', walk: 11, run: 40, bandana: '#3b74d6' },
  { kind: 'deer', n: 1, area: 'edge', walk: 9, run: 48 },
  { kind: 'stag', n: 1, area: 'edge', walk: 9, run: 48 },
  { kind: 'fox', n: 1, area: 'edge', walk: 11, run: 40 },
  { kind: 'wolf', n: 1, area: 'edge', walk: 11, run: 44 },
];
// Larger than life, as the farmers are (figurine.js): at their true size a cow is a speck from the whole farm's view.
const BIGGER = 1.5;
const HABIT_CHANCE = 0.25; // how often one gets up to something when it stops
/** A small seeded random, so the farm's animals start the same every time. */
const seeded = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

export function makeAnimals(THREE, mats, S) {
  const group = new THREE.Group(), loader = new GLTFLoader(), rand = seeded(424242);
  const templates = new Map(); // kind → { scene, clips, scale, lift, raw, box }
  const animals = [], hidden = new THREE.MeshBasicMaterial({ visible: false }), v = new THREE.Vector3();
  let H = 400, ground = null, areas = {}, avoid = [], on = true, started = false, shown = 0;

  /** A kind's model, loaded once: its module, the GLB in it, repainted, sized to its height (larger than life) with its feet at 0. */
  async function template(kind) {
    if (templates.has(kind)) return templates.get(kind);
    const b64 = (await import(`../models/${kind}.js`)).default, bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const gltf = await loader.parseAsync(bytes.buffer, '');
    gltf.scene.updateMatrixWorld(true);
    const clips = new Map(gltf.animations.map(c => [c.name, c]));
    const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), raw = size.y || 1;
    const scale = (MODELS[kind].height * BIGGER) / raw;
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    paint(gltf.scene, kind); // its copies share its materials
    // what a click finds: a box round it, larger than its body so a small one is easy to hit
    const hit = new THREE.BoxGeometry(Math.max(0.8, size.x * scale * 1.2), size.y * scale * 1.1, Math.max(0.8, size.z * scale * 1.1));
    hit.translate(0, (size.y * scale * 1.1) / 2, (box.min.z + box.max.z) * 0.5 * scale);
    const t = { scene: gltf.scene, clips, scale, lift: -box.min.y * scale, raw, hit, top: size.y * scale };
    templates.set(kind, t);
    return t;
  }
  /** A model in the farm's colours and finish (coats.js): every material matte, each colour area named there recoloured. */
  function paint(scene, kind) {
    scene.traverse(o => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        if (COATS[kind][m.name]) m.color.set(COATS[kind][m.name]);
        Object.assign(m, FINISH);
        if (SPOTS[kind]?.area === m.name) m.vertexColors = true; // each copy's own spots, on its own copy of the coat (paintSpots)
      }
    });
  }
  /** Spots for one animal of a spotted kind: its own copy of the coat's mesh, each face white or the spots' colour. */
  function paintSpots(model, kind, seed) {
    const { area, colour } = SPOTS[kind], dark = new THREE.Color(colour);
    model.traverse(o => {
      if (!o.isMesh || o.material.name !== area) return;
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(), p = geo.attributes.position, middles = [];
      for (let f = 0; f < p.count; f += 3) for (let k = 0; k < 3; k++) middles.push((p.getComponent(f, k) + p.getComponent(f + 1, k) + p.getComponent(f + 2, k)) / 3);
      const spots = spotsOf(middles, seed), c = new Float32Array(p.count * 3);
      spots.forEach((on, f) => { for (let v = f * 3; v < f * 3 + 3; v++) c.set(on ? [dark.r, dark.g, dark.b] : [1, 1, 1], v * 3); });
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      o.geometry = geo;
    });
  }
  /** The colours a model is painted in, by colour area, its most metallic part's metalness, and how much of it is spots. */
  function coatOf(model) {
    const colours = {};
    let metal = 0, spots = 0, faces = 0;
    model.traverse(o => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) { colours[m.name] = `#${m.color.getHexString()}`; metal = Math.max(metal, m.metalness); }
      const c = o.geometry.attributes.color;
      if (c) for (let v = 0; v < c.count; v += 3) { faces++; if (c.getX(v) < 0.5) spots++; }
    });
    return { colours, metal, ...(faces ? { spots: spots / faces } : {}) };
  }
  /** One animal: its own copy of the model in a holder that sizes it, its own animation player, and its hit box. */
  function instance(h, t, i) {
    const root = new THREE.Group(), holder = new THREE.Group(), model = cloneSkinned(t.scene);
    holder.scale.setScalar(t.scale);
    holder.position.y = t.lift;
    holder.add(model);
    root.add(holder);
    const hit = new THREE.Mesh(t.hit, hidden);
    hit.userData.animal = i;
    root.add(hit);
    group.add(root);
    const mixer = new THREE.AnimationMixer(model), actions = new Map();
    for (const [name, clip] of t.clips) actions.set(name, mixer.clipAction(clip));
    if (h.bandana) bandana(model, h.bandana, t.raw);
    if (SPOTS[h.kind]) paintSpots(model, h.kind, i + 1);
    let head = null;
    model.traverse(o => { if (!head && o.isBone && /head/i.test(o.name)) head = o; });
    const spot = ground ? pickSpot(h.area) : [0, 0];
    const a = makeAnimal({ kind: h.kind, family: MODELS[h.kind].family, area: h.area, walk: h.walk, run: h.run }, spot[0], spot[1], rand);
    return { a, root, model, mixer, actions, head, t, hitBox: hit, playing: null, seq: -1, yaw: a.face, placed: Boolean(ground), stick: null };
  }
  /** A dog's bandana, round its neck bone, so it follows the head as it moves; sized to the dog. */
  function bandana(model, colour, raw) {
    let neck = null;
    model.traverse(o => { if (!neck && o.isBone && /neck/i.test(o.name)) neck = o; });
    if (!neck) return;
    model.updateMatrixWorld(true);
    const s = new THREE.Vector3();
    neck.getWorldScale(s);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.054 * raw, 0.019 * raw, 6, 14), mats.std(colour));
    band.scale.setScalar(1 / (s.x || 1)); // in step with the dog's size, whatever the bone's scale
    band.rotation.x = Math.PI / 2; // round the neck: the bone points along it
    band.castShadow = true;
    neck.add(band);
  }
  /** Plays an animal's part as antics.js set it: a clip once (staying at its end) or round and round, faded from the last. */
  function play(w) {
    const a = w.a, next = w.actions.get(MODELS[a.kind].clips[a.part]);
    w.seq = a.seq;
    if (!next) return;
    next.setLoop(a.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = a.once;
    next.timeScale = a.timeScale;
    next.reset().setEffectiveWeight(1).play();
    if (w.playing && w.playing !== next) { next.fadeIn(a.fade); w.playing.fadeOut(a.fade); }
    w.playing = next;
  }
  /** Loads every kind, then lets them out (in the background: the farm draws before they are here). */
  async function start() {
    if (started) return;
    started = true;
    for (const h of HERDS) {
      const t = await template(h.kind);
      for (let k = 0; k < h.n; k++) animals.push(instance(h, t, animals.length));
    }
  }
  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const blocked = (x, y) => avoid.some(r => (r.rx ? ((x - r.cx) / r.rx) ** 2 + ((y - r.cy) / r.ry) ** 2 <= 1 : inRect(x, y, r)));
  const inside = (area, x, y) => Boolean(areas[area]?.some(r => inRect(x, y, r))) && !blocked(x, y);
  /** A free place in an area; with from and far, one at least that far from there if it can find one (else the farthest). */
  function pickSpot(area, from, far = 0) {
    const rects = areas[area];
    let best = null, bestD = -1;
    for (let i = 0; i < 30; i++) {
      const r = rects[Math.floor(rand() * rects.length)], x = r.x + rand() * r.w, y = r.y + rand() * r.h;
      if (blocked(x, y)) continue;
      const d = from ? Math.hypot(x - from[0], y - from[1]) : 0;
      if (d >= far) return [x, y];
      if (d > bestD) { best = [x, y]; bestD = d; }
    }
    return best ?? [rects[0].x + rects[0].w / 2, rects[0].y + rects[0].h / 2];
  }
  const env = { resting: false, rand, habitChance: HABIT_CHANCE, spot: pickSpot, inside, duration: (kind, part) => templates.get(kind)?.clips.get(MODELS[kind].clips[part])?.duration ?? 1 };
  /** Their areas for a ground (in 2D pixels): the pasture, the yard (off the pond, the hammocks, the woodpile and the shade tree), the forest's edge. */
  function setGround(g) {
    ground = g; H = g.H;
    const pa = pastureOf(g), y1 = g.GRID.y1;
    areas = {
      pasture: [{ x: pa.x0 + 14, y: pa.y0 + 14, w: pa.x1 - pa.x0 - 28, h: pa.y1 - pa.y0 - 28 }],
      yard: [{ x: 12, y: 172, w: 150, h: Math.max(30, y1 - 196) }],
      edge: forestEdgeOf(g),
    };
    avoid = [
      { cx: POND.cx, cy: POND.cy, rx: POND.rx + 12, ry: POND.ry + 12 },
      { x: NAPS[0][0] - 20, y: NAPS[0][1] - 16, w: 40, h: NAPS.at(-1)[1] - NAPS[0][1] + 24 },
      { x: WOODPILE[0] - 14, y: WOODPILE[1] - 10, w: 28, h: 20 },
      { x: SHADE.x - 14, y: y1 + SHADE.dy - 12, w: 28, h: 24 },
    ];
    for (const w of animals) if (!w.placed || !inside(w.a.area, w.a.x, w.a.y)) { // each inside its area: when the ground changes, or it has just arrived
      const [x, y] = pickSpot(w.a.area);
      Object.assign(w.a, { x, y, tx: x, ty: y, queue: [], cur: null, act: null, stick: null, home: [x, y] });
      w.placed = true;
    }
    start().catch(err => { started = false; throw err; }); // a model that won't load: the bridge reports it, the farm goes on
  }
  /** The fetch stick: flying from the thrower to where it lands, lying there, or in the dog's mouth. */
  function stickOf(w) {
    const s = w.a.stick;
    if (!s) { if (w.stick) w.stick.visible = false; return; }
    if (!w.stick) {
      w.stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 6), mats.std('#8a5a2b'));
      w.stick.castShadow = true;
      group.add(w.stick);
    }
    w.stick.visible = true;
    const across = yaw => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)));
    if (s.held && w.head) {
      w.head.getWorldPosition(v);
      w.stick.position.set(v.x + Math.sin(w.yaw) * 0.35, v.y - 0.12, v.z + Math.cos(w.yaw) * 0.35);
      w.stick.quaternion.copy(across(w.yaw));
      return;
    }
    const u = Math.min(1, s.t / 0.7), x = s.from[0] + (s.at[0] - s.from[0]) * u, y = s.from[1] + (s.at[1] - s.from[1]) * u, p = S.at(x, y, H);
    w.stick.position.set(p.x, 0.05 + Math.sin(u * Math.PI) * 3, p.z);
    w.stick.quaternion.copy(across(Math.atan2(s.at[0] - s.from[0], s.at[1] - s.from[1]) + u * 8));
  }
  /**
   * Moves them on; t the clock (0 while still: they stand where they are), dt the seconds since the last frame, night
   * 0 by day … 1 at night. True when the picture changed while still (an animal arrived, or stood up in a new pose).
   */
  function tick(t, dt, night) {
    group.visible = on;
    if (!on || !ground) return false;
    env.resting = night > 0.7;
    let changed = animals.length !== shown;
    shown = animals.length;
    for (const w of animals) {
      if (t) advance(w.a, dt, env);
      const fresh = w.a.seq !== w.seq;
      if (fresh) play(w);
      const d = Math.atan2(Math.sin(w.a.face - w.yaw), Math.cos(w.a.face - w.yaw)); // it turns toward where it is going
      w.yaw = t ? w.yaw + d * Math.min(1, dt * 8) : w.a.face;
      const p = S.at(w.a.x, w.a.y, H);
      w.root.position.set(p.x, 0, p.z);
      w.root.rotation.y = w.yaw;
      if (t) w.mixer.update(dt);
      else if (fresh) { w.mixer.update(0); changed = true; } // still: its pose, not the model's T-pose
      stickOf(w);
    }
    return changed && !t;
  }
  return {
    group, setGround, tick,
    setOn(v) { on = v; group.visible = v; },
    /** How many animals are out (0 with the switch off); they arrive as their models load. */
    count: () => (on ? animals.length : 0),
    /** How many there will be, once every model has loaded. */
    total: HERDS.reduce((n, h) => n + h.n, 0),
    /** What a click can find: each animal's hit box (none with the switch off). */
    hits: () => (on ? animals.map(w => w.hitBox) : []),
    /** An animal: its kind and name, its menu, what it is doing, where it is on the map, and the point over its head, in the world. */
    info(i) {
      const w = animals[i];
      if (!w || !on) return null;
      w.root.updateMatrixWorld();
      return { kind: w.a.kind, title: MODELS[w.a.kind].title, menu: menuFor(w.a.kind, w.a.family).map(id => ({ id, label: ACTS[id].label })), act: w.a.act, part: w.a.part, spot: [w.a.x, w.a.y], top: { x: w.root.position.x, y: w.t.top + 0.3, z: w.root.position.z } };
    },
    /** Animal i's colours, by colour area, and how metallic its most metallic part is (for the check). */
    coat: i => (animals[i] && on ? coatOf(animals[i].model) : null),
    /** Asks animal i to do act (from its menu). */
    command(i, act) { const w = animals[i]; if (w && menuFor(w.a.kind, w.a.family).includes(act)) command(w.a, act, env); },
    dispose() { for (const w of animals) w.mixer.stopAllAction(); group.clear(); animals.length = 0; templates.clear(); },
  };
}
