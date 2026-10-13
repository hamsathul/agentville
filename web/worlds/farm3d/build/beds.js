// A raised bed for each field (the 2D farm's bed, drawPlot and drawPiles): its frame in the repo's fence colour (grey
// for a worktree, under a greenhouse), its soil and furrows, its crops at their stage (build/crops.js), weeds when it
// lies fallow and dry stalks when its farmers are all stale; above it the piles (hay for uncommitted files, crates for
// unpushed commits, a mailbox when it is behind), a pennant for a branch other than main, a rope with orange flags for
// a collision, and its weather. An empty bed in the grid is fallow ground: a patch of darker grass.
import { PX } from '../layout.js';
import { disposeTree, noise, seasonPalette } from './util.js';

export const SOIL_Y = 0.45; // the soil's top: farmers working in a bed stand this high
const m = v => v / PX;

export function makeBeds(THREE, mats, S, weather, crops) {
  const group = new THREE.Group();
  const shown = new Map(); // key → { obj, sig, fx: [{ tick }], flag, hit }
  const hitMat = new THREE.MeshBasicMaterial({ visible: false }); // the click boxes': never drawn

  const shade = (hex, k) => `#${[1, 3, 5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('')}`;

  function buildBed(b, H, winter) {
    const g = new THREE.Group(), P = (x, y) => S.at(x, y, H), fx = [];
    const c = P(b.x0 + 36, b.y0 + 17), w = m(76), d = m(38), frame = b.worktree ? '#9aa4ad' : b.fence ?? '#c98d4f', soil = b.soil ?? '#7a5230';
    S.rbox(w, SOIL_Y, d, frame, c.x, 0, c.z, g, 0.08);
    S.box(w - 0.4, 0.06, d - 0.4, soil, c.x, SOIL_Y - 0.04, c.z, g);
    for (let k = 0; k < 4; k++) { // the furrows: a lit ridge under each row of plants
      const ridge = S.capsule(0.08, w - 0.9, shade(soil, 1.15), c.x, SOIL_Y + 0.02, P(0, b.y0 + 3 + k * 8).z, g);
      ridge.rotation.z = Math.PI / 2; ridge.scale.z = 0.7;
    }
    if (winter && b.plot.kind !== 'grow') S.box(w - 0.45, 0.04, d - 0.45, '#f4f8fb', c.x, SOIL_Y + 0.02, c.z, g); // frost on bare soil
    // the piles, on the bed's top edge
    const back = P(0, b.rowTop + 4).z;
    if (b.piles.mailbox) {
      const mb = P(b.cx - 40, 0).x;
      S.box(0.1, 1.05, 0.1, '#6b4320', mb, 0, back, g);
      S.box(0.62, 0.38, 0.36, '#5f6b7a', mb, 1.0, back, g);
      S.box(0.62, 0.05, 0.36, '#9aa4ad', mb, 1.38, back, g);
      S.box(0.04, 0.32, 0.04, '#e04a3a', mb + 0.33, 1.15, back, g);
      S.box(0.04, 0.12, 0.2, '#e04a3a', mb + 0.33, 1.38, back + 0.08, g);
    }
    for (let i = 0; i < b.piles.crates; i++) {
      const x = P(b.cx - 30 + (i % 2) * 8 + 3, 0).x, y = Math.floor(i / 2) * 0.62;
      S.box(0.82, 0.6, 0.7, '#8b5a2b', x, y, back, g);
      S.box(0.84, 0.06, 0.72, '#c98d4f', x, y + 0.56, back, g);
      S.box(0.08, 0.6, 0.72, '#6b4320', x, y, back, g);
    }
    for (let i = 0; i < b.piles.hay; i++) {
      const x = P(b.cx + 12 + (i % 3) * 9 + 4, 0).x, y = Math.floor(i / 3) * 0.64;
      S.box(0.95, 0.62, 0.72, '#e9c46a', x, y, back, g);
      for (const dx of [-0.22, 0.22]) S.box(0.05, 0.63, 0.73, '#c9a24a', x + dx, y, back, g);
    }
    // a branch other than main: a pennant on the bed's corner, waving
    let flag = null;
    if (b.pennant) {
      const p = P(b.x0 + 74, b.y0 - 2);
      S.cyl(0.035, 0.035, 2.1, '#6b4320', p.x, 0, p.z, g, 6);
      const tri = new THREE.Shape();
      tri.moveTo(0, 0); tri.lineTo(0.75, -0.22); tri.lineTo(0, -0.45); tri.lineTo(0, 0);
      flag = S.mesh(new THREE.ShapeGeometry(tri), mats.std('#3d7be0', { side: THREE.DoubleSide }), p.x + 0.03, 2.08, p.z, g);
      S.box(0.06, 0.08, 0.04, '#a9dcf7', p.x + 0.06, 2.02, p.z, g);
    }
    // a collision: a rope of orange and cream round the bed, flags at its back corners
    if (b.collision) {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ x: c.x + sx * (w / 2 + 0.3), z: c.z + sz * (d / 2 + 0.3) }));
      corners.forEach((a, i) => {
        const z = corners[(i + 1) % 4], len = Math.hypot(z.x - a.x, z.z - a.z), n = Math.round(len / 0.5);
        S.box(0.06, 1.0, 0.06, '#6b4320', a.x, 0, a.z, g);
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n, seg = S.box(len / n, 0.05, 0.05, j % 2 ? '#fff3d6' : '#ff8c42', a.x + (z.x - a.x) * t, 0.82, a.z + (z.z - a.z) * t, g);
          seg.rotation.y = -Math.atan2(z.z - a.z, z.x - a.x);
        }
      });
      for (const k of [0, 1]) S.box(0.35, 0.25, 0.03, '#ff5a1f', corners[k].x + 0.2, 0.75, corners[k].z, g);
    }
    // a worktree: a greenhouse over the bed, glazing bars and faint glass
    if (b.worktree) {
      const gw = w + 0.3, gd = d + 0.9, gh = 1.9, glass = mats.std('#a9dcf7', { opacity: 0.18, roughness: 0.1 });
      S.box(gw, gh, gd, glass, c.x, 0, c.z, g).castShadow = false;
      for (let x = -gw / 2; x <= gw / 2 + 0.01; x += gw / 6) for (const sz of [-1, 1]) S.box(0.05, gh + 0.7, 0.05, '#e6eef5', c.x + x, 0, c.z + (sz * gd) / 2, g);
      for (const sz of [-1, 1]) S.box(gw, 0.05, 0.05, '#e6eef5', c.x, gh, c.z + (sz * gd) / 2, g);
      S.box(gw, 0.06, 0.06, '#e6eef5', c.x, gh + 0.7, c.z, g);
      for (const sz of [-1, 1]) { const pane = S.box(gw, 0.03, Math.hypot(gd / 2, 0.7), glass, c.x, 0, c.z + (sz * gd) / 4, g); pane.position.y = gh + 0.35; pane.rotation.x = sz * Math.atan2(0.7, gd / 2); pane.castShadow = false; }
    }
    // the weather over it
    const fxOf = b.weather === 'rain' ? weather.rain(w, d) : b.weather === 'rainbow' ? weather.rainbow(w) : b.weather === 'windmill' ? weather.windmill() : null;
    if (fxOf) {
      g.add(fxOf.object);
      if (b.weather === 'windmill') fxOf.object.position.set(c.x - w / 2 - 0.5, 0, c.z - d / 2);
      else fxOf.object.position.set(c.x, 0, c.z - (b.weather === 'rainbow' ? d / 2 - 0.2 : 0));
      fx.push(fxOf);
    }
    if (flag) flag.userData.live = true;
    for (const f of fx) f.object.userData.live = true;
    S.bake(g, { keep: o => Boolean(o.userData.live) }); // the bed in one draw call; its flag and weather move
    // a pump at the bed's corner for each background command running here (two at most), its handle going while it runs
    for (let j = 0; j < (b.pumps ?? 0); j++) {
      const at = P(b.x0 - 9 + j * 5, b.y0 - 2 + j * 2), pump = new THREE.Group();
      S.box(0.36, 0.08, 0.36, '#5f6b7a', 0, 0, 0, pump);
      S.cyl(0.11, 0.13, 0.75, '#3d7be0', 0, 0.08, 0, pump);
      S.box(0.22, 0.06, 0.06, '#3d7be0', 0.15, 0.55, 0, pump);
      const handle = S.box(0.45, 0.05, 0.05, '#9aa4ad', -0.12, 0.85, 0, pump);
      pump.position.set(at.x, 0, at.z);
      g.add(pump);
      fx.push({ object: pump, tick: t => { handle.rotation.z = Math.floor(t * 3 + j) % 2 ? 0.35 : -0.35; } });
    }
    // what a click finds: a box over the bed and its piles (invisible), its field's key on it
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), hitMat);
    hit.position.set(c.x, 0.8, c.z);
    hit.userData.field = b.key;
    g.add(hit);
    group.add(g);
    return { obj: g, fx, flag, hit };
  }
  function buildFallow(s, H, season) {
    const g = new THREE.Group(), P = (x, y) => S.at(x, y, H), pal = seasonPalette(season), c = P(s.x0 + 36, s.y0 + 17);
    const patch = S.box(m(76), 0.03, m(38), pal.tuft, c.x, 0.03, c.z, g);
    patch.castShadow = false;
    S.box(m(74), 0.035, m(36), pal.grass[0], c.x, 0.03, c.z, g).castShadow = false;
    for (let n = 0; n < 14; n++) { const p = P(s.x0 + 3 + (noise(n, s.cx) % 66), s.y0 + 3 + (noise(s.cx, n) % 28)); S.cone(0.05, 0.22, n % 3 ? pal.tuft : pal.blade, p.x, 0.05, p.z, g, 4); }
    S.bake(g);
    group.add(g);
    return { obj: g, fx: [], flag: null };
  }

  /** The beds and the empty slots for this ground; the plants to the crop instancer. */
  function sync(beds, ground, season) {
    const H = ground.H, winter = Boolean(seasonPalette(season).snow), keep = new Set(), plants = [];
    const want = [
      ...beds.map(b => ({ key: `bed:${b.key}`, sig: JSON.stringify([H, b.cx, b.rowTop, b.x0, b.y0, b.fence, b.soil, b.worktree, b.pennant, b.collision, b.plot.kind, b.piles, b.weather, b.pumps, winter]), make: () => buildBed(b, H, winter) })),
      ...ground.empty.map(s => ({ key: `fallow:${s.i}`, sig: JSON.stringify([H, s.cx, s.x0, s.y0, season]), make: () => buildFallow(s, H, season) })),
    ];
    for (const { key, sig, make } of want) {
      keep.add(key);
      const old = shown.get(key);
      if (old?.sig === sig) continue;
      if (old) disposeTree(old.obj);
      shown.set(key, { ...make(), sig });
    }
    for (const [key, v] of shown) if (!keep.has(key)) { disposeTree(v.obj); shown.delete(key); }
    for (const b of beds) for (let k = 0; k < 4; k++) for (let i = 0; i < 9; i++) {
      const p = S.at(b.x0 + 4 + i * 8, b.y0 + 3 + k * 8, H), seed = (i * 7 + k * 3) % 5, base = { x: p.x, z: p.z, y: SOIL_Y, busy: b.plot.busy, seed: (i * 13 + k * 7) * 0.37 };
      if (b.plot.kind === 'grow') plants.push({ ...base, crop: b.crop, stage: Math.max(0, b.plot.stage - (b.plot.stage > 0 && seed === 0 ? 1 : 0)) }); // a few run a stage behind
      else if (b.plot.kind === 'dry') plants.push({ ...base, crop: 'dry', stage: 0 });
      else if ((i * 5 + k * 3) % 7 === 0) plants.push({ ...base, crop: 'weeds', stage: 0 });
    }
    crops.sync(plants);
  }
  function tick(t, dt) {
    for (const v of shown.values()) {
      for (const f of v.fx) f.tick(t, dt);
      if (v.flag) v.flag.rotation.y = Math.sin(t * 3) * 0.25;
    }
  }
  return {
    group, sync, tick,
    /** What a click can find: each bed's box (userData.field: its key). */
    hits: () => [...shown.values()].map(v => v.hit).filter(Boolean),
    dispose: () => { for (const v of shown.values()) disposeTree(v.obj); shown.clear(); } };
}
