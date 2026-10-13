// The farm's animals, just for fun, never for data: Quaternius's animated models (CC0) and two still ducks (CC BY 3.0;
// see models/LICENSE.md). Two cows, three sheep and two horses graze in the pasture; the sheepdog (a husky in a red
// bandana, so it is never taken for the Explore dog) runs about the yard; a deer, a stag and a fox keep to the
// forest's edge; the duck family paddles round the pond, and slides on it in winter. Each plays its own animations:
// walking, grazing, standing; a sheep hops; at night they stand and rest. The models load after the farm has drawn,
// each kind once, and every animal of a kind is its own copy of it. The Animals switch hides them all. None of them is
// a chicken (subagents) or another bird but the ducks, and the sheepdog is the one dog.
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/SkeletonUtils.js';
import { NAPS, POND, SHADE, WOODPILE, forestEdgeOf, pastureOf } from '../layout.js';
import { MODELS } from '../models/index.js';

// Who lives where, and their pace (2D pixels a second; the sheepdog's is a run).
const HERDS = [
  { kind: 'cow', n: 2, area: 'pasture', speed: 7 },
  { kind: 'sheep', n: 3, area: 'pasture', speed: 8 },
  { kind: 'horse', n: 1, area: 'pasture', speed: 10 },
  { kind: 'whitehorse', n: 1, area: 'pasture', speed: 10 },
  { kind: 'sheepdog', n: 1, area: 'yard', speed: 26 },
  { kind: 'deer', n: 1, area: 'edge', speed: 9 },
  { kind: 'stag', n: 1, area: 'edge', speed: 9 },
  { kind: 'fox', n: 1, area: 'edge', speed: 14 },
];
const DUCKS = ['duck', 'duck', 'duckling', 'duckling', 'duckling']; // a mallard pair and three ducklings
// Larger than life, as the farmers are (figurine.js): at their true size a cow is a speck from the whole farm's view.
const BIGGER = 1.5, DUCK_BIGGER = 1.2;
/** A small seeded random, so the farm's animals start the same every time. */
const seeded = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

export function makeAnimals(THREE, mats, S) {
  const group = new THREE.Group(), loader = new GLTFLoader(), rand = seeded(424242);
  const templates = new Map(); // kind → { scene, clips, scale, lift }
  const walkers = [], ducks = [];
  let H = 400, ground = null, areas = {}, avoid = [], on = true, ice = false, started = false;

  /** A kind's model, loaded once: its module, the GLB in it, sized to its height (larger than life) with its feet at 0. */
  async function template(kind) {
    if (templates.has(kind)) return templates.get(kind);
    const b64 = (await import(`../models/${kind}.js`)).default, bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const gltf = await loader.parseAsync(bytes.buffer, '');
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene), h = box.max.y - box.min.y || 1;
    const scale = (MODELS[kind].height * (kind.startsWith('duck') ? DUCK_BIGGER : BIGGER)) / h;
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    const t = { scene: gltf.scene, clips: new Map(gltf.animations.map(c => [c.name, c])), scale, lift: -box.min.y * scale };
    templates.set(kind, t);
    return t;
  }
  /** One animal: its own copy of the model, in a holder that sizes it, and its own animation player. */
  function instance(kind, t) {
    const root = new THREE.Group(), holder = new THREE.Group(), model = cloneSkinned(t.scene);
    holder.scale.setScalar(t.scale);
    holder.position.y = t.lift;
    holder.add(model);
    root.add(holder);
    group.add(root);
    const mixer = t.clips.size ? new THREE.AnimationMixer(model) : null, actions = new Map();
    for (const [name, clip] of t.clips) actions.set(name, mixer.clipAction(clip));
    if (kind === 'sheepdog') bandana(model);
    return { root, holder, mixer, actions, playing: null };
  }
  /** The sheepdog's red bandana, round its neck bone, so it follows the head as it moves. */
  function bandana(model) {
    let neck = null;
    model.traverse(o => { if (!neck && o.isBone && /neck/i.test(o.name)) neck = o; });
    if (!neck) return;
    model.updateMatrixWorld(true);
    const s = new THREE.Vector3();
    neck.getWorldScale(s);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.06, 6, 14), mats.std('#d64545'));
    band.scale.setScalar(1 / (s.x || 1)); // in metres, whatever the bone's own scale
    band.rotation.x = Math.PI / 2; // round the neck: the bone points along it
    band.castShadow = true;
    neck.add(band);
  }
  /** Plays a clip, fading from the one before. */
  function play(a, name, timeScale = 1) {
    const next = a.actions.get(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (a.playing === next) return;
    next.reset().setEffectiveWeight(1).fadeIn(0.3).play();
    if (a.playing) a.playing.fadeOut(0.3);
    a.playing = next;
  }
  /** Loads every kind, then lets them out (in the background: the farm draws before they are here). */
  async function start() {
    if (started) return;
    started = true;
    for (const h of HERDS) {
      const t = await template(h.kind), m = MODELS[h.kind];
      for (let i = 0; i < h.n; i++) walkers.push({ ...h, ...instance(h.kind, t), clips: m.clips, x: 0, y: 0, tx: 0, ty: 0, rest: rand() * 4, face: rand() * 6, phase: rand() * 6, placed: false });
      if (ground) place();
    }
    for (const [i, kind] of DUCKS.entries()) ducks.push({ ...instance(kind, await template(kind)), lag: i === 0 ? 0 : i === 1 ? 0.35 : 0.6 + (i - 2) * 0.22 });
  }
  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const blocked = (x, y) => avoid.some(r => (r.rx ? ((x - r.cx) / r.rx) ** 2 + ((y - r.cy) / r.ry) ** 2 <= 1 : inRect(x, y, r)));
  function pickSpot(area) {
    const rects = areas[area];
    for (let i = 0; i < 30; i++) {
      const r = rects[Math.floor(rand() * rects.length)], x = r.x + rand() * r.w, y = r.y + rand() * r.h;
      if (!blocked(x, y)) return [x, y];
    }
    return [rects[0].x + rects[0].w / 2, rects[0].y + rects[0].h / 2];
  }
  /** Each walker inside its area (when the ground changes, or it has just arrived). */
  function place() {
    for (const w of walkers) if (!w.placed || !areas[w.area].some(r => inRect(w.x, w.y, r)) || blocked(w.x, w.y)) { [w.x, w.y] = pickSpot(w.area); [w.tx, w.ty] = [w.x, w.y]; w.placed = true; }
  }
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
    place();
    start().catch(err => { started = false; throw err; }); // a model that won't load: the bridge reports it, the farm goes on
  }
  /** Moves them on; t the clock (0 while still), dt the seconds since the last frame, night 0 by day … 1 at night. */
  function tick(t, dt, night) {
    group.visible = on;
    if (!on || !ground) return;
    const resting = night > 0.7;
    for (const w of walkers) {
      let moving = false;
      if (t && !resting) {
        const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy);
        if (w.rest > 0) w.rest -= dt;
        else if (d < 1) { w.rest = 3 + rand() * 8; [w.tx, w.ty] = pickSpot(w.area); }
        else { const step = Math.min(d, w.speed * dt); w.x += (dx / d) * step; w.y += (dy / d) * step; w.face = Math.atan2(dx, dy); moving = true; }
      }
      const p = S.at(w.x, w.y, H);
      w.root.position.set(p.x, 0, p.z);
      w.root.rotation.y = w.face;
      // walking (the sheepdog runs; a sheep hops), grazing now and then while it stands, standing; at night resting
      if (moving) play(w, w.clips.run && w.speed > 20 ? w.clips.run : w.clips.walk);
      else if (resting) play(w, w.clips.idle, 0.35);
      else play(w, Math.sin((t || 0) * 0.35 + w.phase) > 0 ? w.clips.graze : w.clips.idle);
      if (t && w.mixer) w.mixer.update(dt);
    }
    // the ducks: round the pond in a line, the littlest last; on the ice in winter they slide, faster and wobbling
    const speed = ice ? 0.32 : 0.12;
    for (const d of ducks) {
      const a = (t || 0.5) * speed - d.lag, x = POND.cx + Math.cos(a) * (POND.rx - 10), y = POND.cy + Math.sin(a) * (POND.ry - 5), p = S.at(x, y, H);
      d.root.position.set(p.x, ice ? 0.1 : 0.04 + (t ? Math.sin(t * 3 + d.lag * 5) * 0.012 : 0), p.z);
      d.root.rotation.y = Math.atan2(-Math.sin(a) * (POND.rx - 10), Math.cos(a) * (POND.ry - 5)) + (ice ? Math.sin(t * 4 + d.lag) * 0.3 : 0);
    }
  }
  return {
    group, setGround, tick,
    setOn(v) { on = v; group.visible = v; },
    setIce(v) { ice = v; },
    /** How many animals are out (0 with the switch off); they arrive as their models load. */
    count: () => (on ? walkers.length + ducks.length : 0),
    /** How many there will be, once every model has loaded. */
    total: HERDS.reduce((n, h) => n + h.n, 0) + DUCKS.length,
    dispose() { for (const w of walkers) w.mixer?.stopAllAction(); group.clear(); walkers.length = 0; ducks.length = 0; templates.clear(); },
  };
}
