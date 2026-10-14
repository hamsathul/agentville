// The crops, as the 2D farm grows them (web/worlds/farm/world.js, drawCrop): seven crops, each in six stages from a
// seed in its mound to ripe, plus the weeds of a fallow bed and the dry stalks of one whose farmers are all stale.
// From stage 2 a crop is its model (models/: Quaternius's and Kenney's, CC0) once that has loaded, growing from 30% to
// full size; the tomato is a code-built plant hung with model fruit, the sunflower code-built; the seeds and sprouts
// are code-built, and so is any crop until its model loads (or if it doesn't). Every plant of one crop and stage
// shares one InstancedMesh per part, across the whole farm, so a full farm of 1,296 plants is a few dozen draw calls.
// Plants sway in the wind, a little more where a farmer is working.
const G = '#3f9b3a', GL = '#6cc04a', GP = '#8fd16a'; // stem, leaf, pale leaf
const SEED_COLOR = { wheat: '#d9b26a', corn: '#f2d14b', carrot: '#c98d4f', cabbage: '#6b4320', sunflower: '#3a3a40', tomato: '#f4d58d', pumpkin: '#f1e4c3' };
const U = 1 / 8 * 1.15; // a 2D pixel of plant height, in metres (a touch taller: they are seen from above)
/** A ripe crop's size in metres: the tall ones by height (the carrot's leaves above the soil), the rest by width, a
 *  touch bigger than life so a field reads from the farm's height; and the stage its model comes in at (the fruit, for
 *  the pumpkin and the tomato). */
const RIPE = { wheat: { h: 9 * U, from: 2 }, corn: { h: 10 * U, from: 2 }, carrot: { h: 7 * U, from: 2 }, cabbage: { w: 0.7, from: 2 }, pumpkin: { w: 0.75, from: 4 }, tomato: { w: 0.18, from: 4 } };
const GROWN = { 2: 0.3, 3: 0.55, 4: 0.8, 5: 1 }; // a model's share of its ripe size, by stage
const FRUIT = { 4: 0.7, 5: 1 }; // the pumpkin's and the tomato's, which come in at 4
/** The colours a crop's model takes before it is ripe, by colour area and stage. */
const UNRIPE = { wheat: { 2: { Yellow: '#8fc25a' }, 3: { Yellow: '#a9cf62' }, 4: { Yellow: '#cdd27a' } }, corn: { 2: { Yellow: '#8fc25a' }, 3: { Yellow: '#cdd27a' } }, tomato: { 4: { DarkRed: '#f0a040' } } };

/** The crops. `load(kind)` (build/models.js) resolves a model's parts ({ geometry, color, name }) and its box;
 *  `onLoad(kind, err)` hears when one has loaded (and is shown) or failed. */
export function makeCrops(THREE, mats, { load, onLoad = () => {} } = {}) {
  const group = new THREE.Group();
  const geos = {
    stem: new THREE.CylinderGeometry(0.5, 0.5, 1, 5).translate(0, 0.5, 0), // a unit stem, from the ground up
    blade: new THREE.ConeGeometry(0.5, 1, 4).translate(0, 0.5, 0),
    leaf: new THREE.SphereGeometry(0.5, 6, 4),
    ball: new THREE.IcosahedronGeometry(0.5, 1),
    lump: new THREE.IcosahedronGeometry(0.5, 0),
    disc: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  };
  const v = new THREE.Vector3(), e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  /** One part of a plant: a shared geometry, a colour, and where it sits on the plant. */
  const part = (geo, color, [x, y, z], [sx, sy, sz], [rx = 0, ry = 0, rz = 0] = []) => ({ geo, color, m: new THREE.Matrix4().compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz)) });
  const stem = (h, color = G, r = 0.035, lean = 0, x = 0) => part('stem', color, [x, 0, 0], [r * 2, h, r * 2], [0, 0, lean]);
  const blade = (h, color, lean, turn = 0, w = 0.07) => part('blade', color, [0, 0, 0], [w, h, w], [Math.sin(turn) * lean, 0, Math.cos(turn) * lean]);
  const leaf = (len, color, y, turn, w = 0.12, tilt = 0.35) => part('leaf', color, [Math.cos(turn) * len * 0.45, y, -Math.sin(turn) * len * 0.45], [len, 0.04, w], [0, turn, tilt]);
  const ball = (r, color, x, y, z, [sx, sy, sz] = [1, 1, 1], geo = 'ball') => part(geo, color, [x, y, z], [r * 2 * sx, r * 2 * sy, r * 2 * sz]);

  const models = new Map(); // crop → { ready, failed, parts, box }
  /** A crop's model, asked for once: null until it has loaded (and if it doesn't). */
  function modelOf(crop) {
    if (!load) return null;
    if (!models.has(crop)) {
      const m = { ready: false };
      models.set(crop, m);
      Promise.resolve().then(() => load(crop)).then(t => {
        t.parts.forEach((p, n) => { geos[`model:${crop}:${n}`] = p.geometry; });
        Object.assign(m, t, { ready: true });
        for (const k of [...templates.keys()]) if (k.startsWith(`${crop}|`)) templates.delete(k);
        for (const [k, mesh] of [...meshes]) if (k.startsWith(`${crop}|`)) { group.remove(mesh); mesh.dispose(); meshes.delete(k); }
        sync(plants);
        onLoad(crop);
      }, err => { m.failed = true; onLoad(crop, err); }); // the code-built crop stays
    }
    const m = models.get(crop);
    return m.ready ? m : null;
  }
  /** A model's parts, placed: at `[x, y, z]` (its foot on the soil, or its middle with `middle`), `k` times its size. */
  function placed(crop, t, k, [x, y, z], { stage, middle = false } = {}) {
    const b = t.box, foot = middle ? -(b.min.y + b.max.y) / 2 : -b.min.y, recolour = UNRIPE[crop]?.[stage] ?? {};
    return t.parts.map((p, n) => ({ geo: `model:${crop}:${n}`, color: recolour[p.name] ?? p.color, m: new THREE.Matrix4().compose(v.set(x - ((b.min.x + b.max.x) / 2) * k, y + foot * k, z - ((b.min.z + b.max.z) / 2) * k), q.identity(), s.set(k, k, k)) }));
  }
  /** One plant from its model, if it has loaded; null for the code-built one. */
  function fromModel(crop, stage) {
    const r = RIPE[crop];
    if (!r || stage < r.from) return null;
    const t = modelOf(crop);
    if (!t) return null;
    const b = t.box, height = b.max.y - b.min.y, width = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    switch (crop) {
      case 'carrot': { // planted: its leaves above the soil, the orange shoulder just showing
        const k = (r.h * GROWN[stage]) / (b.max.y || height);
        return placed(crop, t, k, [0, 0.03 + b.min.y * k, 0], { stage });
      }
      case 'pumpkin': // on its vine's leaves
        return [...template(crop, 3).filter(p => p.geo === 'leaf'), ...placed(crop, t, (r.w * FRUIT[stage]) / width, [0, 0, 0.06], { stage })];
      case 'tomato': { // the code-built plant, hung with model fruit
        const h = [0, 0, 3, 5, 6, 7][stage] * U, k = (r.w * FRUIT[stage]) / width;
        const fruit = [[-0.11, h * 0.6, 0.09], [0.1, h * 0.35, 0.08], [0.02, h * 0.8, 0.12]].flatMap(at => placed(crop, t, k, at, { stage, middle: true }));
        return [...template(crop, stage).filter(p => p.geo !== 'ball'), ...fruit];
      }
      default: return placed(crop, t, r.h ? (r.h * GROWN[stage]) / height : (r.w * GROWN[stage]) / width, [0, 0, 0], { stage });
    }
  }

  /** The parts of one plant of a crop at a stage, code-built. */
  function template(crop, stage) {
    if (crop === 'weeds') return [blade(0.22, '#4f7f2f', 0.4, 0), blade(0.18, '#4f7f2f', 0.5, 2.1), blade(0.2, '#5d8f3a', 0.45, 4.2)];
    if (crop === 'stubble') return [stem(0.18, '#c9a46a', 0.02, 0.15), stem(0.14, '#c9a46a', 0.02, -0.25, 0.06), stem(0.16, '#b8925a', 0.02, 0.1, -0.06)]; // behind the combine
    if (crop === 'dry') return [stem(0.3, '#9c7a4a', 0.02, 0.3), stem(0.22, '#9c7a4a', 0.02, -0.4, 0.05), ball(0.03, '#b5925a', 0.1, 0.29, 0)];
    if (stage <= 0) return [ball(0.14, '#8a6040', 0, 0, 0, [1.4, 0.5, 1.2], 'lump'), ball(0.06, SEED_COLOR[crop] ?? '#d9b26a', -0.06, 0.06, 0), ball(0.05, SEED_COLOR[crop] ?? '#d9b26a', 0.07, 0.05, 0.03)]; // a mound, its seeds showing
    if (stage === 1) {
      if (crop === 'wheat' || crop === 'corn') return [blade(3 * U, GL, 0.15), blade(2 * U, GP, 0.4, 2)];
      if (crop === 'carrot') return [blade(2.5 * U, GL, 0.1), blade(2 * U, GP, 0.6, 1), blade(2 * U, GP, 0.6, 4)];
      const wide = crop === 'pumpkin' ? 1.6 : 1;
      return [stem(2 * U), leaf(0.16 * wide, GP, 2 * U, 0, 0.1), leaf(0.16 * wide, GP, 2 * U, Math.PI, 0.1)];
    }
    switch (crop) {
      case 'wheat': {
        const h = [0, 0, 5, 7, 8, 9][stage] * U, head = stage >= 4 ? (stage === 5 ? '#e9c46a' : '#cdd27a') : '#9ed36a';
        return [0, 1.3, 2.6, 3.9, 5.2].flatMap((turn, i) => {
          const lean = 0.08 + (i % 3) * 0.06, hh = h * (0.85 + (i % 2) * 0.15), x = Math.cos(turn) * 0.06, z = Math.sin(turn) * 0.06;
          const out = [part('stem', '#7fae4a', [x, 0, z], [0.03, hh, 0.03], [Math.sin(turn) * lean, 0, Math.cos(turn) * lean])];
          if (stage >= 3) out.push(part('blade', head, [x + Math.cos(turn) * lean * hh * 0.9, hh * 0.92, z - Math.sin(turn) * lean * hh * 0.2], [0.07, 0.24, 0.07], [Math.PI, 0, 0]));
          return out;
        });
      }
      case 'corn': {
        const h = [0, 0, 5, 8, 9, 10][stage] * U, out = [stem(h, '#4f9a35', 0.05)];
        for (const [y, turn] of [[0.3, 0.4], [0.5, 2.6], [0.7, 4.4]]) out.push(leaf(0.55, GL, h * y, turn, 0.12, -0.25));
        if (stage >= 3) out.push(part('blade', '#d9b26a', [0, h, 0], [0.1, 0.22, 0.1]));
        if (stage === 4) out.push(ball(0.07, '#9ed36a', 0.08, h * 0.6, 0.04, [0.9, 2.2, 0.9]));
        if (stage === 5) out.push(ball(0.08, '#f2d14b', 0.09, h * 0.6, 0.04, [0.9, 2.4, 0.9]), ball(0.05, GP, 0.08, h * 0.6 - 0.18, 0.04, [1, 1.4, 1]));
        return out;
      }
      case 'carrot': {
        const h = [0, 0, 3, 4, 4, 5][stage] * U, out = [0, 1.25, 2.5, 3.75, 5].map((turn, i) => blade(h * (0.8 + (i % 2) * 0.25), i % 2 ? GL : G, 0.35, turn, 0.06));
        if (stage === 3) out.push(ball(0.05, '#f4f1e1', 0, h + 0.03, 0));
        if (stage >= 4) out.push(part('blade', stage === 5 ? '#ff7a1a' : '#f0a060', [0, 0.06, 0], [0.16, 0.22, 0.16], [Math.PI, 0, 0]));
        return out;
      }
      case 'cabbage': {
        const r = [0, 0, 0.14, 0.18, 0.23, 0.25][stage], out = [];
        for (let i = 0; i < 5; i++) out.push(leaf(r * 2.2, '#4f9a35', 0.04, i * 1.26, r * 1.2, -0.25));
        out.push(ball(r * (stage >= 4 ? 1 : 0.7), stage === 5 ? '#c6e89a' : stage >= 4 ? '#a8d070' : GP, 0, r * 0.75, 0, [1, 0.9, 1]));
        return out;
      }
      case 'sunflower': {
        const h = [0, 0, 4, 7, 9, 10][stage] * U, out = [stem(h, G, 0.035), leaf(0.3, GL, h * 0.35, 0.3), leaf(0.28, GL, h * 0.55, 3.4)];
        if (stage === 3) out.push(ball(0.07, '#9ed36a', 0, h + 0.05, 0));
        if (stage >= 4) {
          const r = stage === 5 ? 0.22 : 0.13;
          out.push(part('disc', '#f4c430', [0, h + 0.04, 0.06], [r * 2, 0.04, r * 2], [1.1, 0, 0]), part('disc', stage === 5 ? '#6b4320' : '#6b8f3a', [0, h + 0.06, 0.09], [r * 1.0, 0.05, r * 1.0], [1.1, 0, 0]));
        }
        return out;
      }
      case 'tomato': {
        const h = [0, 0, 3, 5, 6, 7][stage] * U, out = [stem(h + 0.1, '#8b5a2b', 0.015, 0, 0.06)];
        for (const [y, x, z] of [[0.45, -0.06, 0.03], [0.7, 0.05, -0.04], [0.95, -0.02, 0.02]]) out.push(ball(0.11 + stage * 0.012, y > 0.9 ? GL : G, x, h * y, z, [1, 0.85, 1], 'lump'));
        if (stage === 3) out.push(ball(0.03, '#f4d03f', -0.1, h * 0.7, 0.07), ball(0.03, '#f4d03f', 0.07, h * 0.95, 0.06));
        const fruit = stage === 4 ? ['#9ed36a', '#f08a3a'] : ['#e04a3a', '#e04a3a'];
        if (stage >= 4) out.push(ball(0.06, fruit[0], -0.11, h * 0.6, 0.09), ball(0.06, fruit[1], 0.1, h * 0.35, 0.08), ball(0.05, fruit[1], 0.02, h * 0.8, 0.12));
        return out;
      }
      case 'pumpkin': {
        const out = [leaf(0.32, G, 0.03, 0.2, 0.22, 0), leaf(0.28, GL, 0.05, 2.4, 0.2, 0.1)];
        if (stage >= 3) out.push(leaf(0.3, GL, 0.04, 4.3, 0.22, 0.05));
        if (stage === 3) out.push(part('blade', '#f4d03f', [0.05, 0.08, 0.05], [0.09, 0.1, 0.09], [Math.PI, 0, 0]));
        if (stage === 4) out.push(ball(0.09, '#6b8f3a', 0, 0.08, 0.08, [1.2, 0.85, 1.2]));
        if (stage === 5) out.push(ball(0.2, '#ff8c1a', 0, 0.15, 0.06, [1.25, 0.8, 1.15]), stem(0.08, G, 0.02, 0.2), ball(0.2, '#e07a10', 0, 0.15, 0.06, [0.5, 0.82, 1.18]));
        return out;
      }
      default: return [ball(0.08, G, 0, 0.08, 0)];
    }
  }

  const templates = new Map(); // `${crop}|${stage}` → { parts, source: 'model' | 'code' }
  const meshes = new Map(); // `${crop}|${stage}|${wet}|${i}` → InstancedMesh (wet: 'w' while sprayed, else '')
  const wetColor = hex => `#${[1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.78).toString(16).padStart(2, '0')).join('')}`;
  let plants = [], byKey = new Map();
  const plantM = new THREE.Matrix4(), out = new THREE.Matrix4();
  /** The plants to show now: [{ crop, stage, x, z, y, busy, seed }]. */
  function sync(list) {
    plants = list;
    byKey = new Map();
    for (const p of list) { const k = `${p.crop}|${p.stage}|${p.wet ? 'w' : ''}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }
    for (const [k, mesh] of meshes) if (!byKey.has(k.split('|').slice(0, 3).join('|'))) mesh.count = 0;
    for (const [k, list2] of byKey) {
      const [crop, stage, wet] = k.split('|'), tk = `${crop}|${stage}`;
      if (!templates.has(tk)) {
        const model = fromModel(crop, Number(stage));
        templates.set(tk, model ? { parts: model, source: 'model' } : { parts: template(crop, Number(stage)), source: 'code' });
      }
      templates.get(tk).parts.forEach((pt, i) => {
        const mk = `${k}|${i}`;
        let mesh = meshes.get(mk);
        if (!mesh || mesh.instanceMatrix.count < list2.length) {
          if (mesh) { group.remove(mesh); mesh.dispose(); }
          mesh = new THREE.InstancedMesh(geos[pt.geo], wet ? mats.std(wetColor(pt.color), { roughness: 0.3 }) : mats.std(pt.color), Math.max(16, list2.length)); // sprayed: wet, darker and glossy
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.frustumCulled = false; // the plants are spread over the whole farm, nearly always in view
          mesh.userData.list = null;
          meshes.set(mk, mesh);
          group.add(mesh);
        }
        mesh.count = list2.length;
        mesh.userData.part = pt;
        mesh.userData.list = list2;
      });
    }
    tick(0);
  }
  /** Sways the plants (t: seconds; 0 holds them still). */
  function tick(t) {
    for (const mesh of meshes.values()) {
      const list = mesh.userData.list;
      if (!mesh.count || !list) continue;
      const pt = mesh.userData.part;
      for (let i = 0; i < mesh.count; i++) {
        const p = list[i], amp = t ? (p.busy ? 0.07 : 0.045) : 0;
        e.set(Math.sin(t * 1.3 + p.seed) * amp * 0.5, p.seed, Math.sin(t * 1.7 - p.x * 0.7 + p.z * 0.4) * amp);
        plantM.compose(v.set(p.x, p.y, p.z), q.setFromEuler(e), s.set(1, 1, 1));
        mesh.setMatrixAt(i, out.multiplyMatrices(plantM, pt.m));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  /** The plants shown now, by crop and what draws them: { corn: { model: 72, code: 0 } }. */
  function stats() {
    const out = {};
    for (const [k, list] of byKey) {
      const crop = k.split('|')[0], t = templates.get(k.split('|').slice(0, 2).join('|'));
      out[crop] ??= { code: 0, model: 0 };
      out[crop][t.source] += list.length;
    }
    return out;
  }
  function dispose() { for (const mesh of meshes.values()) mesh.dispose(); meshes.clear(); for (const [k, g] of Object.entries(geos)) if (!k.startsWith('model:')) g.dispose(); } // a model's geometry is its loader's
  return { group, sync, tick, dispose, stats, count: () => plants.length };
}
