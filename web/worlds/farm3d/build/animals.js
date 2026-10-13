// The farm's animals, just for fun, never for data: all twelve of Quaternius's Animated Animal Pack (CC0; see
// models/LICENSE.md). Two cows, a bull, two alpacas, a donkey and two horses in the pasture; the husky (in a red
// bandana) and the Shiba Inu (in a blue one) in the yard, so neither is taken for a dog that means something; a deer,
// a stag, a fox and a wolf at the forest's edge; and in the pond his frog on his lily pads and three of his fish. What
// they do is antics.js's, where they may go roam.js's (the whole farm, round what stands on it): they walk, rest and
// graze, get up to something now and then, rest at night, and do what you pick from an animal's menu. This draws it: each kind's model loaded once (after the
// farm has drawn), every animal its own copy with its own animation player, playing the clip for each part
// (models/index.js), repainted in the farm's colours and finish (coats.js), the cows spotted; the frog on a pad, the
// fish just under the water, a splash where one breaks it. The Animals switch hides them all (not the lily pads).
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/SkeletonUtils.js';
import { LILY_PADS, PX, WATER } from '../layout.js';
import { MODELS } from '../models/index.js';
import { ACTS, HERDS, advance, command, forgetWalk, makeAnimal, menuFor, perform, placeAt, release } from '../antics.js';
import { roamOf } from '../roam.js';
import { COATS, FINISH, SPOTS, spotsOf } from '../coats.js';

// Larger than life, as the farmers are (figurine.js): at their true size a cow is a speck from the whole farm's view.
const BIGGER = 1.5;
const HABIT_CHANCE = 0.25; // how often one gets up to something when it stops

const POND_KINDS = new Set(['frog', 'fish']); // the pond's families: under the ice in winter
/** How high an animal stands: on the ground, on a lily pad (the frog), or just under the water (a fish, its back too). */
const baseOf = w => (w.a.family === 'frog' ? WATER.y + 0.05 : w.a.family === 'fish' ? WATER.y - 0.05 - w.t.top : 0);
const PLUMP = 1.8; // a fish is as thin as a fish: a little plumper, it shows from above

export function makeAnimals(THREE, mats, S) {
  const group = new THREE.Group(), loader = new GLTFLoader(), rand = Math.random; // a different wander every time
  const creatures = new THREE.Group(), pads = new THREE.Group(), splashes = []; // the Animals switch hides the creatures, not the pads
  group.add(creatures, pads);
  let winter = false;
  const templates = new Map(); // kind → { scene, clips, scale, lift, raw, box }
  const animals = [], hidden = new THREE.MeshBasicMaterial({ visible: false }), v = new THREE.Vector3();
  let H = 400, ground = null, roam = null, on = true, started = false, shown = 0;

  /** A kind's model, loaded once: its module, the GLB in it, repainted, sized to its height (larger than life) with its feet at 0. */
  async function template(kind) {
    if (templates.has(kind)) return templates.get(kind);
    const b64 = (await import(`../models/${kind}.js`)).default, bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const gltf = await loader.parseAsync(bytes.buffer, '');
    gltf.scene.updateMatrixWorld(true);
    const clips = new Map(gltf.animations.map(c => [c.name, c]));
    const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), raw = size.y || 1;
    const m = MODELS[kind], scale = m.height ? (m.height * BIGGER) / raw : (m.length * BIGGER) / (Math.max(size.x, size.z) || 1); // a fish or a pad by its length
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    paint(gltf.scene, kind); // its copies share its materials
    // what a click finds: a box round it, larger than its body so a small one is easy to hit
    const hit = new THREE.BoxGeometry(Math.max(0.8, size.x * scale * 1.2), size.y * scale * 1.1, Math.max(0.8, size.z * scale * 1.1));
    hit.translate(0, (size.y * scale * 1.1) / 2, (box.min.z + box.max.z) * 0.5 * scale);
    // its size, for where it may go (roam.js): half its length, so it fits whichever way it faces, in 2D px
    const t = { scene: gltf.scene, clips, scale, lift: -box.min.y * scale, raw, hit, top: size.y * scale, r: (Math.max(size.x, size.z) * scale * PX) / 2 };
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
    if (MODELS[h.kind].family === 'fish') holder.scale.x *= PLUMP;
    holder.position.y = t.lift;
    holder.add(model);
    root.add(holder);
    const hit = new THREE.Mesh(t.hit, hidden);
    hit.userData.animal = i;
    root.add(hit);
    creatures.add(root);
    const mixer = new THREE.AnimationMixer(model), actions = new Map();
    for (const [name, clip] of t.clips) actions.set(name, mixer.clipAction(clip));
    if (h.bandana) bandana(model, h.bandana, t.raw);
    if (SPOTS[h.kind]) paintSpots(model, h.kind, i + 1);
    let head = null;
    model.traverse(o => { if (!head && o.isBone && /head/i.test(o.name)) head = o; });
    const spot = roam ? roam.spot(h.area, rand, { r: t.r }) : [0, 0];
    const a = makeAnimal({ kind: h.kind, family: MODELS[h.kind].family, area: h.area, walk: h.walk, run: h.run, r: t.r }, spot[0], spot[1], rand);
    return { a, root, holder, model, mixer, actions, head, t, hitBox: hit, wet: null, playing: null, seq: -1, yaw: a.face, placed: Boolean(ground), stick: null };
  }
  /** A dog's bandana, round its neck bone, so it follows the head as it moves; sized to the dog. */
  function bandana(model, colour, raw, size = 1) {
    let neck = null;
    model.traverse(o => { if (!neck && o.isBone && /neck/i.test(o.name)) neck = o; });
    if (!neck) return;
    model.updateMatrixWorld(true);
    const s = new THREE.Vector3();
    neck.getWorldScale(s);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.054 * raw, 0.019 * raw, 6, 14), mats.std(colour));
    band.scale.setScalar(size / (s.x || 1)); // in step with the dog's size, whatever the bone's scale
    band.rotation.x = Math.PI / 2; // round the neck: the bone points along it
    band.castShadow = true;
    neck.add(band);
    return band;
  }
  /**
   * A copy of a kind's model for something that isn't one of the farm's animals (the Explore dog, a cart's pony): its
   * own animation player, `size` times the animal's size, in its own `coat` (colour areas, as coats.js's) or its kind's,
   * a bandana when given. part(name) plays one of the kind's parts (models/index.js), round and round; tick(dt) moves it.
   */
  async function copy(kind, { size = 1, coat = null, scarf = null } = {}) {
    const t = await template(kind), root = new THREE.Group(), holder = new THREE.Group(), model = cloneSkinned(t.scene);
    holder.scale.setScalar(t.scale * size);
    holder.position.y = t.lift * size;
    holder.add(model);
    root.add(holder);
    const own = [];
    if (coat) model.traverse(o => {
      if (!o.isMesh) return;
      const re = m => { const c = m.clone(); if (coat[m.name]) c.color.set(coat[m.name]); own.push(c); return c; };
      o.material = Array.isArray(o.material) ? o.material.map(re) : re(o.material);
    });
    const band = scarf ? bandana(model, scarf, t.raw, size) : null; // its own ring: freed with it
    const mixer = new THREE.AnimationMixer(model);
    let playing = null, now = null;
    return {
      root,
      part(name) {
        if (name === now) return;
        now = name;
        const clip = t.clips.get(MODELS[kind].clips[name]);
        if (!clip) return;
        const next = mixer.clipAction(clip);
        next.reset().setEffectiveWeight(1).play();
        if (playing && playing !== next) { next.fadeIn(0.25); playing.fadeOut(0.25); }
        playing = next;
      },
      tick(dt) { mixer.update(dt); },
      dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); root.removeFromParent(); for (const m of own) m.dispose(); band?.geometry.dispose(); },
    };
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
  /** The pond's lily pads (Quaternius's), each its size and turned its own way; those not in flower without one. */
  async function lilyPads() {
    const t = await template('lilypad');
    LILY_PADS.forEach(([x, y, size, flower], k) => {
      const pad = t.scene.clone(), p = S.at(x, y, H);
      pad.scale.setScalar(t.scale * size);
      pad.position.set(p.x, WATER.y + 0.005 + t.lift * size, p.z); // floating
      pad.rotation.y = k * 2.1;
      pad.traverse(o => { if (o.isMesh && o.material.name === 'Pink' && !flower) o.visible = false; });
      pad.userData.at = [x, y];
      pad.userData.rest = { y: pad.position.y, turn: pad.rotation.y, phase: k * 1.7 };
      pads.add(pad);
    });
  }
  /** A splash where something breaks the water: a ring that spreads and fades. */
  function splash(x, z) {
    let s = splashes.find(r => !r.visible);
    if (!s) {
      s = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
      s.rotation.x = -Math.PI / 2;
      splashes.push(s);
      group.add(s);
    }
    s.position.set(x, WATER.y + 0.02, z);
    s.userData.age = 0;
    s.visible = true;
  }
  /** Loads every kind, then lets them out (in the background: the farm draws before they are here). */
  async function start() {
    if (started) return;
    started = true;
    await lilyPads();
    for (const h of HERDS) {
      const t = await template(h.kind);
      for (let k = 0; k < h.n; k++) animals.push(instance(h, t, animals.length));
    }
  }
  const env = {
    resting: false, rand, habitChance: HABIT_CHANCE,
    spot: (area, from, far, r, o) => roam.spot(area, rand, { from, far, r, ...o }),
    inside: (area, x, y, r) => roam.inside(area, x, y, r),
    clear: (area, from, to, r) => roam.clear(area, from, to, r),
    route: (from, to, r) => roam.route(from, to, r), // a way round, for roaming the farm
    duration: (kind, part) => templates.get(kind)?.clips.get(MODELS[kind].clips[part])?.duration ?? 1,
  };
  /** Their grounds for a farm (roam.js): the pasture, the yard (off the pond, its trees and things), the forest's edge. */
  function setGround(g) {
    ground = g; H = g.H;
    for (const w of animals) if (w.a.romp) release(w.a); // a new ground: whatever they did together stops
    roam = roamOf(g);
    for (const w of animals) { // each on its ground: when the ground changes, or it has just arrived; a walk planned on the old one is dropped
      if (!w.placed || !roam.inside(w.a.area, w.a.x, w.a.y, w.a.r)) { const [x, y] = roam.spot(w.a.area, rand, { r: w.a.r }); placeAt(w.a, x, y); }
      else forgetWalk(w.a);
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
    creatures.visible = on;
    pads.visible = !winter;
    if (t) for (const pad of pads.children) { const r = pad.userData.rest; pad.position.y = r.y + Math.sin(t * 1.2 + r.phase) * 0.012; pad.rotation.y = r.turn + Math.sin(t * 0.4 + r.phase) * 0.05; } // bobbing on the water
    for (const s of splashes) if (s.visible) { // spreading, fading
      s.userData.age += dt;
      const k = s.userData.age / 0.9;
      s.scale.setScalar(0.2 + k * 0.85);
      s.material.opacity = 0.8 * (1 - k);
      if (k >= 1 || !t) s.visible = false;
    }
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
      const p = S.at(w.a.x, w.a.y, H), y = baseOf(w) + w.a.lift;
      w.root.position.set(p.x, y, p.z);
      w.root.rotation.y = w.yaw;
      const jump = w.a.cur?.jump !== undefined ? Math.min(1, w.a.curT / w.a.cur.len) : null;
      if (w.a.family === 'fish') w.holder.rotation.x = jump === null ? 0 : -Math.cos(Math.PI * jump) * 0.9; // nose up out of the water, down into it
      w.root.visible = !w.a.under && !(winter && POND_KINDS.has(w.a.family));
      const wet = POND_KINDS.has(w.a.family) && (w.a.under || y < WATER.y); // in the water: a splash as it goes in or comes out
      if (t && w.wet !== null && wet !== w.wet && !winter) splash(p.x, p.z);
      w.wet = wet;
      if (t) w.mixer.update(dt);
      else if (fresh) { w.mixer.update(0); changed = true; } // still: its pose, not the model's T-pose
      stickOf(w);
    }
    return changed && !t;
  }
  return {
    group, setGround, tick, copy,
    setOn(v) { on = v; creatures.visible = v; if (!v) for (const w of animals) if (w.a.romp) release(w.a); }, // hidden: no one stays in a play
    /** In winter the pond is ice: its frog, fish and lily pads are out of sight. */
    setWinter(v) { winter = Boolean(v); },
    /** How many animals are out (0 with the switch off); they arrive as their models load. */
    count: () => (on ? animals.length : 0),
    /** How many there will be, once every model has loaded. */
    total: HERDS.reduce((n, h) => n + h.n, 0),
    /** What a click can find: each animal's hit box (none with the switch off). */
    hits: () => (on ? animals.filter(w => w.root.visible).map(w => w.hitBox) : []),
    /** An animal: its kind and name, its menu, what it is doing, where it is on the map, and the point over its head, in the world. */
    info(i) {
      const w = animals[i];
      if (!w || !on) return null;
      w.root.updateMatrixWorld();
      return { shown: w.root.visible, kind: w.a.kind, title: MODELS[w.a.kind].title, menu: menuFor(w.a.kind, w.a.family).map(id => ({ id, label: ACTS[id].label })), act: w.a.act, part: w.a.part, spot: [w.a.x, w.a.y], top: { x: w.root.position.x, y: w.t.top + 0.3, z: w.root.position.z } };
    },
    /** Animal i's colours, by colour area, and how metallic its most metallic part is (for the check). */
    coat: i => (animals[i] && on ? coatOf(animals[i].model) : null),
    /** Turns animal i to face a place on the map (one it talks to). */
    face(i, [x, y]) { const w = animals[i]; if (w && Math.hypot(x - w.a.x, y - w.a.y) > 1) w.a.face = Math.atan2(x - w.a.x, y - w.a.y); },
    /** Asks animal i to do act (from its menu). */
    command(i, act) { const w = animals[i]; if (w && menuFor(w.a.kind, w.a.family).includes(act)) command(w.a, act, env); },
    /** Animal i does these steps with another (a play, a romp: `tag`), then waits till release(i). */
    perform(i, steps, tag) { const w = animals[i]; if (w) perform(w.a, steps, env, tag); },
    release(i) { const w = animals[i]; if (w?.a.romp) release(w.a); },
    /** Whether animal i has done its steps (it waits, or has nothing to do). */
    settled: i => { const w = animals[i]; return !w || (!w.a.cur && !w.a.queue.length); },
    /** The animals as plays and romps see them: kind, family, where, free (doing nothing asked of it, shown), resting (standing still). */
    world: () => (on ? animals.map((w, i) => ({ i, kind: w.a.kind, family: w.a.family, area: w.a.area, x: w.a.x, y: w.a.y, run: w.a.run, free: !w.a.act && !w.a.romp && w.root.visible && !w.a.under, resting: !w.a.act && w.a.rest > 0 && !w.a.cur, a: w.a })) : []),
    dispose() { for (const w of animals) w.mixer.stopAllAction(); creatures.clear(); pads.clear(); animals.length = 0; templates.clear(); },
  };
}
