// The machines drawn (machines.js says where each is): Kenney's tractor and flatbed truck (models/, CC0, from his Car
// Kit), repainted the farm's (coats.js PAINT: a red tractor with cream wheels, a green flatbed), their wheels turning
// as they drive; the tractor's implements, the combine and a stand-in tractor (till the model loads) built in code
// from shared shapes and cached materials, as the carts are; the driver seated in the cab in its farmer's shirt; mist
// behind the sprayer's boom, chaff behind the combine, grass behind the mower (none with Motion off).
import { PX } from '../layout.js';
import { MODELS } from '../models/index.js';
import { repaint } from '../coats.js';

export const SCALE = 1.3; // a touch larger than life, as the farmers are: they are seen from above
export const MODEL_OF = { tractor: 'tractor', truck: 'truckflat', loader: 'tractorloader' }; // the loader stands in the shed
const toSrgb = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055), toLinear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const SKIN = '#e8b08a', CAP = '#3a3a40';
const FX = { sprayer: { colour: '#ffffff', opacity: 0.45, size: 0.32, width: 7, up: 0.5 }, combine: { colour: '#e2c56a', opacity: 1, size: 0.12, width: 3, up: 1.6 }, mower: { colour: '#7fbf5a', opacity: 1, size: 0.1, width: 2.2, up: 1.2 } };
const PARTICLES = 12;

/** The machines drawn. gltf(kind): a packed model's glTF (build/models.js); onError(err, kind): a model that didn't load,
 *  told once (a stand-in drives instead). */
export function makeMachines(THREE, mats, S, { gltf, onError = () => {} }) {
  const group = new THREE.Group();
  const templates = new Map(), asked = new Set(); // model kind → { scene, scale, rear, top, seat, wheels: Map(name → radius) }
  const shown = new Map(); // item id → the machine drawn
  let H = 400, groundAt = () => 0;

  /** A Kenney model, once: repainted the farm's (its baked colours, by part and look), matte, its size the farm's. */
  function template(kind) {
    if (asked.has(kind)) return templates.get(kind) ?? null;
    asked.add(kind);
    gltf(kind).then(g => {
      const scene = g.scene, paint = mats.std('#ffffff', { vertexColors: true });
      scene.traverse(o => {
        if (!o.isMesh) return;
        let part = o;
        while (part && !/^(body|wheel|shovel)/.test(part.name ?? '')) part = part.parent;
        const c = o.geometry.attributes.color;
        if (c) for (let i = 0; i < c.count; i++) {
          const rgb = repaint(kind, part?.name ?? '', [c.getX(i), c.getY(i), c.getZ(i)].map(v => Math.round(toSrgb(v) * 255)));
          c.setXYZ(i, ...rgb.map(v => toLinear(v / 255)));
        }
        if (c) c.needsUpdate = true;
        o.geometry.userData.shared = true; // every copy draws it; never freed with one
        o.material = paint;
        o.castShadow = o.receiveShadow = true;
      });
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene), scale = (MODELS[kind].length * SCALE) / (box.max.z - box.min.z || 1);
      const wheels = new Map();
      scene.traverse(o => { if (/^wheel/.test(o.name) && !wheels.has(o.name)) { const b = new THREE.Box3().setFromObject(o); wheels.set(o.name, ((b.max.y - b.min.y) / 2) * scale); } });
      const rearWheel = [...scene.children].filter(o => /^wheel-back/.test(o.name)).reduce((z, o) => Math.min(z, o.position.z), 0);
      templates.set(kind, { scene, scale, lift: -box.min.y * scale, rear: box.min.z * scale, top: box.max.y * scale, wheels, seat: new THREE.Vector3(0, box.max.y * scale * 0.5, rearWheel * scale * (kind === 'truckflat' ? -1.1 : 0.55)) });
    }).catch(err => onError(err, kind)); // no model: told once, and the stand-in stays
    return null;
  }

  // the parts built in code, each facing +z (the way it drives), its bottom at y. Each kind is built once and baked into
  // one mesh (its moving parts apart, by name: a wheel, the reel, the load, the torso), and every machine gets a copy
  const built = new Map();
  /** A copy of a part built once by `make(group)`: its fixed parts baked into one draw call, its geometry kept. */
  function once(key, make) {
    if (!built.has(key)) {
      const g = new THREE.Group();
      make(g);
      const baked = S.bake(g, { keep: o => Boolean(o.userData.live) });
      if (baked) baked.geometry.userData.shared = true; // every copy draws it; never freed with one
      for (const o of g.children) if (o.userData.live && o.name !== 'torso') { const b = S.bake(o); if (b) b.geometry.userData.shared = true; } // a wheel, the reel, the load: each one draw call
      built.set(key, g);
    }
    return built.get(key).clone(true);
  }
  const box = (w, h, d, colour, x, y, z, parent) => S.box(w, h, d, colour, x, y, z, parent);
  /** A wheel that turns (its hub a group, named, its radius kept). */
  const wheel = (r, w, colour, x, y, z, parent) => {
    const hub = new THREE.Group(), tyre = S.cyl(r, r, w, colour, 0, -w / 2, 0, hub, 14), rim = S.cyl(r * 0.55, r * 0.55, w + 0.02, '#f4ecd8', 0, -w / 2 - 0.01, 0, hub, 10);
    for (const o of [tyre, rim]) { o.rotation.z = Math.PI / 2; o.position.set(0, 0, 0); }
    hub.position.set(x, y, z);
    Object.assign(hub.userData, { live: true, r });
    hub.name = 'wheel';
    parent.add(hub);
    return hub;
  };
  const wheelsOf = obj => { const out = []; obj.traverse(o => { if (o.name === 'wheel') out.push({ o, r: o.userData.r }); }); return out; };
  /** A tractor of boxes and wheels, standing in till Kenney's model has loaded. */
  const standIn = () => once('stand-in', g => {
    box(1.6, 0.9, 2.6, '#c8432f', 0, 0.55, 0.2, g);
    box(1.3, 1.1, 1.1, '#f4ecd8', 0, 1.45, -0.55, g);
    box(1.4, 0.08, 1.2, '#c8432f', 0, 2.55, -0.55, g);
    wheel(0.48, 0.4, '#2a2a2e', -0.95, 0.48, 1.0, g); wheel(0.48, 0.4, '#2a2a2e', 0.95, 0.48, 1.0, g);
    wheel(0.75, 0.5, '#2a2a2e', -1.0, 0.75, -0.8, g); wheel(0.75, 0.5, '#2a2a2e', 1.0, 0.75, -0.8, g);
  });
  /** The combine: a body, its cab, a header 4.5 m wide with a reel that turns, an unloading pipe, big front wheels. */
  const COMBINE = { seat: [0, 3.2, 1.0], rear: -2.5 };
  const combine = () => once('combine', g => {
    box(2.4, 2.0, 4.4, '#4c9a3f', 0, 0.9, -0.3, g);
    box(2.0, 0.5, 3.6, '#3f7d3a', 0, 0.55, -0.4, g);
    box(1.6, 1.3, 1.4, '#bfe3f2', 0, 2.9, 1.0, g);
    box(1.8, 0.1, 1.6, '#f4ecd8', 0, 4.2, 1.0, g);
    box(4.6, 0.45, 1.1, '#e2b33a', 0, 0.35, 2.6, g); // the header
    for (const x of [-2.25, 2.25]) box(0.12, 0.8, 1.1, '#e2b33a', x, 0.35, 2.6, g);
    const pipe = S.cyl(0.14, 0.14, 3.2, '#4c9a3f', 0, 0, 0, g, 8); pipe.rotation.z = Math.PI / 2 - 0.25; pipe.position.set(-2.4, 2.9, -0.8);
    const reel = new THREE.Group();
    reel.position.set(0, 1.25, 2.85);
    for (let k = 0; k < 4; k++) { const bat = S.box(4.3, 0.06, 0.06, '#c8432f', 0, -0.03, 0, reel); bat.position.set(0, Math.cos((k * Math.PI) / 2) * 0.4, Math.sin((k * Math.PI) / 2) * 0.4); }
    const axle = S.cyl(0.06, 0.06, 4.4, '#5f6b7a', 0, -2.2, 0, reel, 6); axle.rotation.z = Math.PI / 2; axle.position.set(0, 0, 0);
    reel.name = 'reel'; reel.userData.live = true;
    g.add(reel);
    wheel(0.85, 0.55, '#2a2a2e', -1.35, 0.85, 1.2, g); wheel(0.85, 0.55, '#2a2a2e', 1.35, 0.85, 1.2, g);
    wheel(0.5, 0.4, '#2a2a2e', -1.2, 0.5, -2.0, g); wheel(0.5, 0.4, '#2a2a2e', 1.2, 0.5, -2.0, g);
  });
  /** A tractor's implement, hitched behind it: the plough with its seed drill, the sprayer's tank and boom, the mower's
   *  deck, or a trailer with sacks or crates (its load named, to show or hide). userData.fx: where its bits fly from. */
  const implementOf = job => once(`implement:${job}`, g => {
    g.userData.fx = -1;
    if (job === 'plough') {
      box(2.2, 0.16, 0.25, '#c8432f', 0, 0.55, 0.9, g);
      box(0.2, 0.16, 1.6, '#c8432f', 0, 0.55, 0.1, g);
      for (let k = 0; k < 4; k++) { const sh = box(0.12, 0.5, 0.42, '#9aa4ad', -0.75 + k * 0.5, 0.1, 0.5 - k * 0.32, g); sh.rotation.y = 0.5; }
      box(2.0, 0.55, 0.6, '#e2b33a', 0, 0.8, -0.65, g); // the seed drill's hopper
    } else if (job === 'sprayer') {
      const tank = S.cyl(0.55, 0.55, 1.5, '#f4ecd8', 0, 0, 0, g, 12); tank.rotation.x = Math.PI / 2; tank.position.set(0, 1.05, 0.2);
      box(1.2, 0.12, 1.6, '#5f6b7a', 0, 0.42, 0.2, g);
      box(7.0, 0.1, 0.12, '#5f6b7a', 0, 0.85, -0.75, g); // the boom
      for (let k = 0; k < 8; k++) box(0.06, 0.18, 0.06, '#3a3a40', -3.2 + k * 0.92, 0.66, -0.75, g);
      for (const x of [-0.75, 0.75]) S.cyl(0.4, 0.4, 0.2, '#2a2a2e', x, 0.3, 0.2, g, 12).rotation.z = Math.PI / 2;
      g.userData.fx = -0.9;
    } else if (job === 'mower') {
      box(2.4, 0.3, 1.4, '#3f7d3a', 0, 0.12, 0, g);
      box(2.4, 0.06, 0.2, '#e2b33a', 0, 0.42, 0.4, g);
      g.userData.fx = -0.8;
    } else { // supplies, crates: a trailer
      box(1.9, 0.12, 2.4, '#8b5a2b', 0, 0.6, 0, g);
      for (const x of [-0.95, 0.95]) box(0.08, 0.35, 2.4, '#a8703c', x, 0.72, 0, g);
      box(0.12, 0.12, 1.2, '#5f6b7a', 0, 0.55, 1.6, g); // the drawbar
      for (const x of [-1.05, 1.05]) S.cyl(0.42, 0.42, 0.25, '#2a2a2e', x, 0.3, -0.2, g, 12).rotation.z = Math.PI / 2;
      const load = new THREE.Group();
      if (job === 'crates') for (let k = 0; k < 4; k++) box(0.7, 0.55, 0.7, '#a8703c', -0.4 + (k % 2) * 0.8, 0.72, -0.5 + Math.floor(k / 2) * 0.95, load);
      else for (let k = 0; k < 5; k++) { const sk = S.capsule(0.22, 0.5, '#e8dcc0', -0.5 + (k % 3) * 0.5, 0.98, -0.6 + Math.floor(k / 3) * 0.9, load); sk.rotation.z = Math.PI / 2; }
      load.name = 'load'; load.userData.live = true;
      g.add(load);
    }
  });
  /** The driver, seated: its torso (named: its farmer's shirt), its head, a cap. */
  const driverOf = () => once('driver', g => {
    const torso = box(0.5, 0.62, 0.34, '#9aa0a6', 0, -0.95, 0, g);
    torso.name = 'torso'; torso.userData.live = true;
    box(0.44, 0.22, 0.5, '#3d4a5c', 0, -1.1, 0.12, g); // its lap
    S.ball(0.19, SKIN, 0, -0.12, 0, g, 1);
    box(0.38, 0.1, 0.4, CAP, 0, 0.02, 0.02, g);
    box(0.3, 0.04, 0.2, CAP, 0, 0.03, 0.27, g);
  });
  const bit = new THREE.BoxGeometry(1, 1, 1);
  bit.userData.shared = true;
  /** A few bits behind a machine at work (mist, chaff or grass): one draw call. */
  function particlesOf(kind) {
    const f = FX[kind], mesh = new THREE.InstancedMesh(bit, mats.std(f.colour, f.opacity < 1 ? { opacity: f.opacity } : {}), PARTICLES);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return { g: mesh, bits: Array.from({ length: PARTICLES }, (_, k) => ({ life: (k / PARTICLES) * 1.2, p: [0, 0, 0], v: [0, 0, 0] })), f };
  }
  const pm = new THREE.Matrix4(), pq = new THREE.Quaternion(), pv = new THREE.Vector3(), ps = new THREE.Vector3();
  function tickParticles(p, dt, on, z) {
    p.g.count = on ? PARTICLES : 0;
    if (!on) return;
    p.bits.forEach((b, k) => {
      b.life -= dt;
      if (b.life <= 0) { b.life = 1.2; b.p = [(Math.random() - 0.5) * p.f.width, 0.3 + Math.random() * 0.4, z]; b.v = [(Math.random() - 0.5) * 0.6, p.f.up * (0.5 + Math.random()), -0.8 - Math.random()]; }
      b.p[0] += b.v[0] * dt; b.p[1] = Math.max(0.05, b.p[1] + b.v[1] * dt); b.p[2] += b.v[2] * dt;
      b.v[1] -= 2.5 * dt;
      p.g.setMatrixAt(k, pm.compose(pv.set(...b.p), pq, ps.setScalar(p.f.size)));
    });
    p.g.instanceMatrix.needsUpdate = true;
  }

  /** A machine for an item: its vehicle (Kenney's, or a stand-in, or the combine), its driver, its effects. */
  function make(item) {
    const root = new THREE.Group(), body = new THREE.Group(), m = { root, body, vehicle: item.vehicle, wheels: [], implement: null, impObj: null, last: [item.x, item.y], standIn: false, seat: new THREE.Vector3(0, 2.2, -0.5), rear: -1.6 };
    root.add(body);
    dress(m);
    m.driver = driverOf();
    m.driver.traverse(o => { if (o.name === 'torso') m.torso = o; });
    root.add(m.driver);
    group.add(root);
    return m;
  }
  /** Its vehicle's body: the model once loaded, else the stand-in; the combine always in code. */
  function dress(m) {
    for (const c of [...m.body.children]) c.removeFromParent();
    m.wheels = []; m.reel = null;
    if (m.vehicle === 'combine') {
      const c = combine();
      m.body.add(c);
      c.traverse(o => { if (o.name === 'reel') m.reel = o; });
      Object.assign(m, { wheels: wheelsOf(c), rear: COMBINE.rear, standIn: false });
      m.seat.set(...COMBINE.seat);
      if (!m.fx) { m.fx = particlesOf('combine'); m.fx.z = COMBINE.rear - 0.1; m.body.add(m.fx.g); } // chaff out of its back
      else m.body.add(m.fx.g);
      return;
    }
    const t = template(MODEL_OF[m.vehicle]);
    if (!t) { const si = standIn(); m.body.add(si); m.wheels = wheelsOf(si); m.standIn = true; m.seat.set(0, 2.2, -0.55); m.rear = -1.5; return; }
    const copy = t.scene.clone(true);
    copy.scale.setScalar(t.scale);
    copy.position.y = t.lift;
    m.body.add(copy);
    copy.traverse(o => { if (/^wheel/.test(o.name) && t.wheels.has(o.name) && !m.wheels.some(w => w.o === o)) m.wheels.push({ o, r: t.wheels.get(o.name) }); });
    m.seat.copy(t.seat).setY(t.seat.y + t.lift);
    m.rear = t.rear;
    m.standIn = false;
    if (m.vehicle === 'truck') { const f = flagOf(); f.position.set(0.7, t.top + t.lift, t.rear + 0.4); m.body.add(f); } // a red flag: off to town with a delivery
  }
  /** The deploy truck's red flag on its pole. */
  const flagOf = () => once('flag', g => {
    S.cyl(0.04, 0.04, 1.4, '#6b4320', 0, 0, 0, g, 6);
    box(0.6, 0.35, 0.03, '#e04a3a', 0.3, 0.95, 0, g);
  });
  /** Its tractor's implement, hitched 1.2 m behind it; none on the truck or the combine. */
  function hitch(m, job) {
    const want = m.vehicle === 'tractor' ? job : null;
    if (m.implement === want) return;
    m.impObj?.removeFromParent();
    if (m.vehicle !== 'combine') { m.fx?.g.removeFromParent(); m.fx?.g.dispose(); m.fx = null; }
    m.impObj = null; m.load = null; m.implement = want;
    if (!want) return;
    m.impObj = implementOf(want);
    m.impObj.position.z = m.rear - 1.2 - 1.0;
    m.impObj.traverse(o => { if (o.name === 'load') m.load = o; });
    m.root.add(m.impObj);
    if (FX[want]) { m.fx = particlesOf(want); m.fx.z = m.rear - 2.2 + m.impObj.userData.fx; m.root.add(m.fx.g); }
  }
  /** Lets a machine go: its bits' buffers (its parts' geometry is shared). */
  function drop(m) { m.fx?.g.dispose(); m.root.removeFromParent(); }

  return {
    group,
    setGround(h, at) { H = h; if (at) groundAt = at; },
    /** The machines (machines.js's items), each frame. shirtOf(id): its farmer's shirt colour. */
    tick(items, dt, still, shirtOf = () => '#9aa0a6') {
      const keep = new Set();
      for (const it of items) {
        if (it.phase === 'walking') continue; // in the shed till its farmer climbs in
        keep.add(it.id);
        let m = shown.get(it.id);
        if (!m || m.vehicle !== it.vehicle) { if (m) drop(m); m = make(it); shown.set(it.id, m); }
        if (m.standIn && templates.has(MODEL_OF[m.vehicle])) { dress(m); m.implement = undefined; } // the model has loaded
        hitch(m, it.implement);
        if (m.load) m.load.visible = Boolean(it.load);
        const p = S.at(it.x, it.y, H);
        m.root.position.set(p.x, groundAt(it.x, it.y), p.z);
        m.root.rotation.y = Math.PI / 2 - it.heading;
        const dist = Math.hypot(it.x - m.last[0], it.y - m.last[1]) / PX;
        m.last = [it.x, it.y];
        if (!still) for (const w of m.wheels) w.o.rotation.x += dist / (w.r || 0.5);
        if (m.reel && !still && it.phase === 'work') m.reel.rotation.x -= dt * 2.5;
        m.driver.visible = it.driver;
        m.driver.position.copy(m.seat);
        m.torso.material = mats.std(shirtOf(it.id));
        m.root.userData.id = it.driver ? it.id : undefined; // a click on a driven machine is its farmer
        if (m.fx) tickParticles(m.fx, dt, !still && it.phase === 'work' && it.moving, m.fx.z);
      }
      for (const [id, m] of shown) if (!keep.has(id)) { drop(m); shown.delete(id); }
    },
    /** Where a driver's head is (in metres), which way it faces and where its machine is on the 2D map; null if none. */
    seatOf(id) {
      const m = shown.get(id);
      if (!m) return null;
      m.root.updateMatrixWorld(true);
      const p = m.root.localToWorld(m.seat.clone());
      return { x: p.x, y: p.y, z: p.z, heading: m.root.rotation.y, at: m.last };
    },
    /** What a click can find: each driven machine (userData.id: its farmer). */
    hits: () => [...shown.values()].filter(m => m.root.userData.id).map(m => m.root),
    count: () => shown.size,
    /** A parked machine for the shed: Kenney's tractor (a stand-in till it loads) or the combine, facing out. */
    stock(vehicle) { const m = make({ vehicle, x: 0, y: 0 }); m.driver.visible = false; m.root.removeFromParent(); return m; },
    /** Swaps a stock stand-in for the model once it has loaded; true if it did. */
    restock(m) { if (m.standIn && templates.has(MODEL_OF[m.vehicle])) { dress(m); return true; } return false; },
  };
}
