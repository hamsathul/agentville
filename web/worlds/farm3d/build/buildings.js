// The farmstead and the yard, from the 2D farm's drawings (web/worlds/farm/world.js: barn, silo, house, henhouse,
// stall, hammock, shadeTree, drawLand's fences), at 8 px a metre: the black barn with its glass door, the black
// steel silo(s) with a grain gauge and a lamp, the timber farmhouse with glass walls and its deck (your porch) with
// string lights, the henhouse and its run, the market stall, the scarecrow patch, the hammocks, the shade tree, the
// orchard that comes with more rows, the woodpile and the rock, and the fence round the fields. Snow on the roofs in
// winter. Rebuilt only when the rows, the season or the silos change.
import { BARN, BARN_DOOR, BUSHES, CORR, DECK, HENHOUSE, HOUSE, NAPS, PORCH_Y, PX, SCARECROWS, SHADE, SILO_Y, STALL, WOODPILE, orchardOf, pastureOf, rocksOf } from '../layout.js';
import { disposeTree, seasonPalette } from './util.js';

const m = v => v / PX; // 2D pixels to metres
export const DECK_H = 0.35; // the porch's deck: farmers on it stand this high

export function makeBuildings(THREE, mats, S) {
  const group = new THREE.Group();
  let built = null, key = '';

  function build(ground, season, silos) {
    const k = `${ground.rows}|${season}|${JSON.stringify(silos)}`;
    if (k === key) return built.userData.info;
    key = k;
    if (built) disposeTree(built);
    const g = new THREE.Group(), H = ground.H, P = (x, y) => S.at(x, y, H), pal = seasonPalette(season), snow = Boolean(pal.snow);
    const glass = mats.glow('#a9cde6', '#ffcf7a', { day: 0, night: 1.1, roughness: 0.15 });
    const steel = '#121215';
    const fencePosts = [], fenceRails = [];

    /** A pitched roof over a w × d box whose walls are wallH high: its ridge along z (gable at the front) or along x. */
    function roof(parent, { x, z, w, d, wallH, rise, along = 'z', color, over = 0.35 }) {
      const span = (along === 'z' ? w : d) / 2 + over, a = Math.atan2(rise, span - over), L = span / Math.cos(a), len = (along === 'z' ? d : w) + over * 2;
      for (const side of [-1, 1]) {
        const cx = (side * L * Math.cos(a)) / 2, cy = wallH + rise - (L * Math.sin(a)) / 2 + 0.06;
        const slab = S.box(along === 'z' ? L : len, 0.14, along === 'z' ? len : L, color, 0, 0, 0, g);
        if (along === 'z') { slab.position.set(x + cx, cy, z); slab.rotation.z = -side * a; } else { slab.position.set(x, cy, z + cx); slab.rotation.x = side * a; }
        if (snow) { const cap = S.box(along === 'z' ? L : len, 0.1, along === 'z' ? len : L, '#f4f8fb', 0, 0, 0, g); cap.position.copy(slab.position); cap.position.y += 0.1; cap.rotation.copy(slab.rotation); }
      }
      // the gables: a triangle at each end, in the walls' colour
      const tri = new THREE.Shape();
      const half = (along === 'z' ? w : d) / 2;
      tri.moveTo(-half, 0); tri.lineTo(0, rise); tri.lineTo(half, 0); tri.lineTo(-half, 0);
      const geo = new THREE.ExtrudeGeometry(tri, { depth: along === 'z' ? d : w, bevelEnabled: false });
      geo.translate(0, 0, -(along === 'z' ? d : w) / 2);
      const gab = S.mesh(geo, parent.userData.wall, x, wallH, z, g);
      if (along === 'x') gab.rotation.y = Math.PI / 2;
    }
    /** A fence of posts every metre with two rails, along a 2D line, leaving gaps ([from, to] pixel ranges). */
    function fence(x0, y0, x1, y1, gaps = []) {
      const horiz = y0 === y1, a = P(x0, y0), b = P(x1, y1), n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z)));
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t, along = horiz ? px : py;
        if (gaps.some(([lo, hi]) => along > lo && along < hi)) { prev = null; continue; }
        const p = P(px, py);
        fencePosts.push(p);
        if (prev) fenceRails.push([prev, p]);
        prev = p;
      }
    }

    /* ---------- the barn: black board-and-batten, a light metal roof, a big glass door ---------- */
    {
      const w = m(55), d = 5.6, wallH = 4.2, c = P(BARN.x + 27.5, BARN.front), z = c.z - d / 2;
      const barn = new THREE.Group();
      barn.userData = { hit: 'barn', wall: mats.std('#26262b') };
      g.add(barn);
      S.box(w, wallH, d, '#26262b', c.x, 0, z, barn);
      for (let x = -w / 2 + 0.25; x < w / 2; x += 0.5) if (Math.abs(x) > 2.15) S.box(0.07, wallH, 0.05, '#34343b', c.x + x, 0, c.z + 0.02, barn);
      for (let zz = -d / 2 + 0.25; zz < d / 2; zz += 0.5) for (const sx of [-1, 1]) S.box(0.05, wallH, 0.07, '#34343b', c.x + sx * (w / 2 + 0.02), 0, z + zz, barn);
      roof(barn, { x: c.x, z, w, d, wallH, rise: 2.4, along: 'z', color: '#8d949c' });
      // the glass door: six panes in a steel frame, and a clerestory up in the gable
      S.box(4.2, 3.7, 0.1, steel, c.x, 0, c.z + 0.04, barn);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) S.box(1.22, 1.68, 0.12, glass, c.x - 1.37 + i * 1.37, 0.12 + j * 1.8, c.z + 0.05, barn);
      S.box(2.7, 0.8, 0.1, steel, c.x, wallH + 0.55, c.z + 0.04, barn);
      S.box(2.5, 0.62, 0.12, glass, c.x, wallH + 0.64, c.z + 0.05, barn);
      for (const sx of [-1, 1]) S.box(0.22, 0.32, 0.16, mats.glow('#ffe6a6', '#ffd58a', { day: 0.2, night: 2.2 }), c.x + sx * 2.65, 2.9, c.z + 0.1, barn);
    }

    /* ---------- the silo(s): black steel, a dome, a catwalk, a grain gauge, a lamp near the limit ---------- */
    const siloTops = [];
    for (const { x, silo } of silos) {
      const c = P(x + 10, SILO_Y), r = 1.25, h = 8, front = c.z + r;
      S.box(3, 0.5, 3, '#8d8f92', c.x, 0, c.z, g);
      S.cyl(r, r, h, '#26262b', c.x, 0.5, c.z, g, 22);
      for (const y of [2.5, 4.5, 6.5]) S.cyl(r + 0.02, r + 0.02, 0.07, '#1d1d21', c.x, 0.5 + y, c.z, g, 22);
      S.sphere(r + 0.02, '#5f6b7a', c.x, 0.5 + h, c.z, g, 22, 8, Math.PI * 2, Math.PI / 2);
      S.cyl(r + 0.3, r + 0.3, 0.08, steel, c.x, 0.5 + h - 0.9, c.z, g, 22);
      if (snow) S.sphere(r * 0.75, '#ffffff', c.x, 0.5 + h + r * 0.55, c.z, g, 14, 6, Math.PI * 2, Math.PI / 2);
      // the gauge: a dark window up the front, grain to the week's use, marks at a quarter, a half and three quarters
      const gh = 6;
      S.box(1.15, gh + 0.15, 0.12, steel, c.x, 1.1, front - 0.02, g);
      S.box(0.95, gh, 0.14, '#3a3f45', c.x, 1.18, front - 0.01, g);
      if (silo?.fill > 0) S.box(0.95, gh * silo.fill, 0.16, '#e9c46a', c.x, 1.18, front, g);
      for (const t of [0.25, 0.5, 0.75]) S.box(0.18, 0.05, 0.17, '#c3cbd2', c.x + 0.6, 1.18 + gh * t, front, g);
      if (silo?.lamp) {
        const lamp = S.ball(0.24, mats.glow(silo.lamp === 'red' ? '#e04a3a' : '#f0b429', silo.lamp === 'red' ? '#e04a3a' : '#f0b429', { day: 0.9, night: 2.5 }), c.x, 0.5 + h + r + 0.25, c.z, g);
        lamp.userData.blink = silo.lamp === 'red';
      }
      siloTops.push({ x: c.x, y: 0.5 + h + r, z: c.z });
    }

    /* ---------- the farmhouse: timber, two glass walls and a glass door, one sloping roof, the deck ---------- */
    let porch;
    {
      const x0 = HOUSE.x + 4, x1 = HOUSE.x + HOUSE.w - 4, front = PORCH_Y - 10, w = m(x1 - x0), d = 5.2, wallH = 3.4;
      const c = P((x0 + x1) / 2, front), z = c.z - d / 2;
      S.box(w, wallH, d, '#c8a271', c.x, 0, z, g);
      S.box(w + 0.04, 0.45, d + 0.04, '#b08a5a', c.x, 0, z, g);
      for (let y = 0.8; y < wallH; y += 0.42) S.box(w + 0.02, 0.035, d + 0.02, '#b08a5a', c.x, y, z, g);
      for (const gx of [HOUSE.x + 10, HOUSE.x + 84]) { // the glass walls
        const gc = P(gx + 21, front);
        S.box(m(44), 2.6, 0.1, '#1d1d21', gc.x, 0.55, c.z + 0.03, g);
        S.box(m(42), 2.45, 0.12, glass, gc.x, 0.62, c.z + 0.04, g);
        for (let x = gx + 10; x < gx + 42; x += 11) S.box(0.06, 2.45, 0.14, '#1d1d21', P(x, front).x, 0.62, c.z + 0.05, g);
      }
      const dc = P(HOUSE.x + 68, front); // the glass door
      S.box(m(22), 3.0, 0.1, '#1d1d21', dc.x, 0, c.z + 0.03, g);
      S.box(m(18), 2.85, 0.12, glass, dc.x, 0.05, c.z + 0.04, g);
      // one sloping roof, higher at the left, reaching out over the deck
      // (it reaches only a little past the front wall, so the porch below stays in view)
      for (const [h, y, col] of [[0.26, wallH + 0.55, '#2a2a2e'], [0.08, wallH + 0.38, '#3f3f45'], ...(snow ? [[0.12, wallH + 0.72, '#f4f8fb']] : [])]) {
        const slab = S.box(w + 1.4, h, d + 1.0, col, c.x, 0, z + 0.1, g);
        slab.position.y = y; slab.rotation.z = -0.055;
      }
      const flue = P(HOUSE.x + 114, front);
      S.cyl(0.22, 0.22, 2.1, '#8a8f96', flue.x, wallH, z - 0.8, g, 10);
      S.cyl(0.3, 0.3, 0.12, '#5f6b7a', flue.x, wallH + 2.1, z - 0.8, g, 10);
      // the deck: wide boards, a slim steel railing open at the steps, a planter of grasses at each end
      const dx0 = DECK.x0, dx1 = DECK.x1, dfront = DECK.y1, dd = m(dfront - front) + 0.1, dcx = P((dx0 + dx1) / 2, front).x, dz = c.z + dd / 2 - 0.1;
      S.box(m(dx1 - dx0), DECK_H, dd, '#8d7e6e', dcx, 0, dz, g);
      for (let i = 1; i < 5; i++) S.box(m(dx1 - dx0), 0.012, 0.03, '#776a5c', dcx, DECK_H, c.z + (i * dd) / 5 - 0.1, g);
      const steps = P(HOUSE.x + 68, dfront);
      S.box(m(24), DECK_H / 2, 0.45, '#8d7e6e', steps.x, 0, steps.z + 0.2, g);
      for (const [a, b] of [[dx0, HOUSE.x + 56], [HOUSE.x + 80, dx1]]) {
        const pa = P(a, dfront), pb = P(b, dfront), railZ = pa.z - 0.08;
        for (let x = pa.x + 0.05; x <= pb.x; x += 1.5) S.box(0.05, 0.9, 0.05, '#1d1d21', x, DECK_H, railZ, g);
        S.box(pb.x - pa.x, 0.05, 0.06, '#1d1d21', (pa.x + pb.x) / 2, DECK_H + 0.9, railZ, g);
      }
      for (const px of [dx0 + 4, dx1 - 4]) {
        const pc = P(px, front + 5);
        S.box(1.1, 0.55, 0.6, '#3f3f45', pc.x, DECK_H, pc.z, g);
        for (let i = 0; i < 4; i++) S.cone(0.09, 0.45, snow ? '#e6eef5' : '#7fbf5a', pc.x - 0.36 + i * 0.24, DECK_H + 0.55, pc.z, g, 5);
      }
      // the string lights, sagging between slim posts along the front of the deck
      const bulb = mats.glow('#ffe08a', '#ffd43b', { day: 0.35, night: 2.4 }), wireZ = c.z + dd - 0.25, xa = P(dx0, 0).x, xb = P(dx1, 0).x, span = (xb - xa) / 6;
      for (let i = 0; i <= 6; i++) S.box(0.05, 2.75, 0.05, '#1d1d21', xa + i * span, DECK_H, wireZ, g);
      for (let x = xa + 0.25; x < xb; x += 0.6) {
        const sag = Math.sin((((x - xa) % span) / span) * Math.PI) * 0.35;
        const b = S.ball(0.07, bulb, x, DECK_H + 2.7 - sag, wireZ, g, 0);
        b.castShadow = false;
      }
      porch = { y: DECK_H, lamps: [P(HOUSE.x + 30, PORCH_Y - 4), P(HOUSE.x + 106, PORCH_Y - 4)].map(p => ({ x: p.x, y: wallH - 0.3, z: p.z + 0.6, color: '#ffd08a', distance: 10 })) };
    }

    /* ---------- the henhouse and its run ---------- */
    {
      const front = HENHOUSE.y + 31, c = P(HENHOUSE.x + 17, front), w = m(30), d = 2.2, wallH = 1.6, z = c.z - d / 2;
      const coop = new THREE.Group();
      coop.userData.wall = mats.std('#c98d4f');
      g.add(coop);
      S.box(w, wallH, d, '#c98d4f', c.x, 0, z, coop);
      roof(coop, { x: c.x, z, w, d, wallH, rise: 0.9, along: 'x', color: '#9c3b30', over: 0.2 });
      S.box(1.0, 1.2, 0.06, '#2a1d14', c.x, 0, c.z + 0.02, coop);
      for (const sx of [-1, 1]) S.box(0.5, 0.45, 0.06, '#2a1d14', c.x + sx * 1.15, 0.85, c.z + 0.02, coop);
      const ramp = S.box(0.75, 0.06, 0.8, '#8b5a2b', c.x, 0, c.z + 0.4, coop);
      ramp.rotation.x = 0.35; ramp.position.y = 0.22;
      fence(HENHOUSE.x + 36, HENHOUSE.y + 6, HENHOUSE.x + 92, HENHOUSE.y + 6);
      fence(HENHOUSE.x + 36, HENHOUSE.y + 36, HENHOUSE.x + 92, HENHOUSE.y + 36);
      fence(HENHOUSE.x + 90, HENHOUSE.y + 6, HENHOUSE.x + 90, HENHOUSE.y + 36);
    }

    /* ---------- the market stall: a striped awning over a counter ---------- */
    {
      const front = STALL.y + 34, c = P(STALL.x + 14, front), w = m(30);
      S.box(w, 0.9, 1.0, '#8b5a2b', c.x, 0, c.z - 0.5, g);
      S.box(w + 0.1, 0.08, 1.15, '#a8703c', c.x, 0.9, c.z - 0.5, g);
      for (const sx of [-1, 1]) S.box(0.12, 2.5, 0.12, '#6b4320', c.x + sx * (w / 2 - 0.1), 0, c.z - 0.9, g);
      for (let i = 0; i < 7; i++) {
        const st = S.box(w / 7, 0.06, 1.5, i % 2 ? '#f4ecd8' : '#e04a3a', c.x - w / 2 + (w / 7) * (i + 0.5), 0, c.z - 0.6, g);
        st.position.y = 2.5; st.rotation.x = 0.22;
      }
      if (snow) { const cap = S.box(w, 0.08, 1.5, '#ffffff', c.x, 0, c.z - 0.6, g); cap.position.y = 2.58; cap.rotation.x = 0.22; }
    }

    /* ---------- the scarecrow patch: stubble behind a low fence, a hay bale ---------- */
    {
      const { x: sx0, y: sy0, w: sw } = SCARECROWS, c = P(sx0 + sw / 2, (sy0 + PORCH_Y + 4) / 2), dd = m(PORCH_Y + 4 - sy0);
      S.box(m(sw), 0.04, dd, '#8a7140', c.x, 0.01, c.z, g).receiveShadow = true;
      const stubble = [];
      for (let y = sy0 + 3; y < PORCH_Y + 2; y += 4) for (let x = sx0 + 3 + (y % 8 ? 2 : 0); x < sx0 + sw - 2; x += 5) stubble.push(P(x, y));
      const st = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.035, 0.3, 4), mats.std(snow ? '#dfe9f2' : '#6d5830'), stubble.length);
      const m4 = new THREE.Matrix4();
      stubble.forEach((p, i) => st.setMatrixAt(i, m4.makeTranslation(p.x, 0.18, p.z)));
      g.add(st);
      fence(sx0 - 2, sy0, sx0 + sw + 2, sy0);
      const bale = S.cyl(0.42, 0.42, 0.9, '#e9c46a', 0, 0, 0, g, 12), hb = P(SCARECROWS.x + SCARECROWS.w - 12, SCARECROWS.y + 14);
      bale.rotation.z = Math.PI / 2; bale.position.set(hb.x, 0.42, hb.z);
    }

    /* ---------- the hammocks by the pond ---------- */
    for (const [cx, y] of NAPS) {
      const a = P(cx - 13, y), b = P(cx + 12, y);
      for (const p of [a, b]) S.box(0.12, 1.45, 0.12, '#6b4320', p.x, 0, p.z, g);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, sag = Math.sin(t * Math.PI) * 0.45;
        S.box((b.x - a.x) / n + 0.02, 0.06, 0.55, i < 1 || i > n - 2 ? '#c9b48a' : i % 2 ? '#8a5fc0' : '#d55181', a.x + (b.x - a.x) * t, 1.15 - sag, a.z, g).castShadow = true;
      }
    }

    /* ---------- the shade tree, the orchard, bushes, stones, the woodpile and the rock ---------- */
    const canopy = pal.canopy, plants = new THREE.Group(); // stand-ins until build/nature.js has drawn the models
    plants.userData.plants = true;
    g.add(plants);
    // `shade`: the shade tree, whose idle farmers stand in front of its trunk: its crown higher and set back, so they show
    function tree(x, y, r, { fruit = null, seed = 0, shade = false } = {}) {
      const p0 = P(x, y), s = m(r) * (shade ? 0.95 : 1.15), h = 1.4 + s * 0.4 + (shade ? 1.2 : 0), p = shade ? { x: p0.x, z: p0.z - 1.3 } : p0;
      S.cyl(0.18 + s * 0.06, 0.28 + s * 0.08, h + s * 0.5, '#4e3626', p.x, 0, p.z, plants, 7);
      if (snow) { // bare branches reaching up, with snow along them
        for (let i = 0; i < 5; i++) {
          const a = seed + i * 1.25, br = S.box(s * 0.9, 0.11, 0.11, '#4e3626', 0, 0, 0, plants);
          br.position.set(p.x + Math.cos(a) * s * 0.3, h + s * 0.2 + (i % 3) * 0.3, p.z + Math.sin(a) * s * 0.3); br.rotation.set(0, -a, 0.85);
          const sn = S.box(s * 0.8, 0.05, 0.12, '#ffffff', 0, 0, 0, plants); sn.position.copy(br.position); sn.position.y += 0.07; sn.rotation.copy(br.rotation);
        }
        return;
      }
      S.ball(s, canopy[1], p.x, h + s * 0.8, p.z, plants, 0);
      S.ball(s * 0.8, canopy[2], p.x + s * 0.45, h + s * 0.65, p.z + s * 0.3, plants, 0);
      S.ball(s * 0.65, canopy[3], p.x - s * 0.3, h + s * 1.35, p.z - s * 0.2, plants, 0);
      if (fruit) for (let i = 0; i < 9; i++) { const a = seed + i * 2.4, rr = s * (0.75 + (i % 3) * 0.12); S.ball(0.11, fruit, p.x + Math.cos(a) * rr, h + s * (0.5 + (i % 4) * 0.28), p.z + Math.sin(a) * rr, plants, 0); }
    }
    const fruit = season === 'spring' ? pal.bloom : season === 'autumn' ? '#e9a23b' : '#e04a3a';
    tree(SHADE.x, ground.GRID.y1 + SHADE.dy, 21, { fruit, seed: 3, shade: true });
    for (const [x, y] of orchardOf(ground)) tree(x, y, 10, { seed: x + y });
    for (const [x, y, r] of BUSHES) {
      const p = P(x, y);
      S.ball(m(r) * 1.4, snow ? '#dfe9f2' : canopy[2], p.x, m(r) * 0.9, p.z, plants, 0);
      if (season === 'summer') for (let i = 0; i < 4; i++) S.ball(0.06, '#e04a3a', p.x + Math.cos(i * 1.7) * m(r), m(r) * (0.9 + (i % 2) * 0.4), p.z + Math.sin(i * 1.7) * m(r), plants, 0);
    }
    for (const [x, y, s] of rocksOf(ground)) {
      const p = P(x, y), rock = S.mesh(new THREE.DodecahedronGeometry(m(s) * 1.4, 0), '#8c96a0', p.x, m(s) * 0.6, p.z, plants);
      rock.scale.y = 0.6;
    }
    {
      const p = P(...WOODPILE);
      for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 3 - layer; i++) {
        const log = S.cyl(0.14, 0.14, 1.3, layer % 2 ? '#a8703c' : '#8b5a2b', 0, 0, 0, g, 8);
        log.rotation.z = Math.PI / 2; log.position.set(p.x, 0.14 + layer * 0.26, p.z - 0.3 + i * 0.3 + layer * 0.15);
      }
    }

    /* ---------- the fence round the fields: open at the walkways and where each row meets the yard's path ---------- */
    const { GRID } = ground, lanes = [...new Set(ground.slots.map(s => s.lane))];
    fence(GRID.x0, GRID.y0, GRID.x1 + 2, GRID.y0, CORR.slice(1).map(c => [c - 7, c + 7]));
    fence(GRID.x0, GRID.y1, GRID.x1 + 2, GRID.y1);
    fence(GRID.x0, GRID.y0, GRID.x0, GRID.y1, lanes.map(y => [y - 4, y + 5]));
    fence(GRID.x1, GRID.y0, GRID.x1, GRID.y1);
    // the pasture across the front: a fence all round, a gate where the yard's path comes down
    const pa = pastureOf(ground);
    fence(pa.x0, pa.y0, pa.x1, pa.y0, [[CORR[0] - 10, CORR[0] + 10]]);
    fence(pa.x0, pa.y1, pa.x1, pa.y1);
    fence(pa.x0, pa.y0, pa.x0, pa.y1);
    fence(pa.x1, pa.y0, pa.x1, pa.y1);
    {
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.85, 0.14), mats.std('#a8703c'), fencePosts.length);
      const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 0.06), mats.std(snow ? '#e6eef5' : '#e2b07a'), fenceRails.length * 2);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      fencePosts.forEach((p, i) => posts.setMatrixAt(i, m4.makeTranslation(p.x, 0.42, p.z)));
      fenceRails.forEach(([a, b], i) => {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        q.setFromAxisAngle(up, -Math.atan2(b.z - a.z, b.x - a.x));
        for (const [k, y] of [[0, 0.32], [1, 0.62]]) rails.setMatrixAt(i * 2 + k, m4.compose(new THREE.Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2), q, new THREE.Vector3(len, 1, 1)));
      });
      posts.castShadow = rails.castShadow = posts.receiveShadow = rails.receiveShadow = true;
      g.add(posts, rails);
    }

    // one draw call for the barn (its own, so it can still be clicked), one for the rest
    for (const o of g.children.filter(c => c.userData.hit || c.userData.plants)) S.bake(o);
    S.bake(g, { keep: o => Boolean(o.userData.hit || o.userData.plants) });
    const barnDoor = P(BARN_DOOR[0], BARN.front + 2);
    const info = { porch, siloTops, lamps: [...porch.lamps, { x: barnDoor.x, y: 3.2, z: barnDoor.z + 0.6, color: '#ffe0a0', distance: 9 }] };
    g.userData.info = info;
    group.add(g);
    built = g;
    return info;
  }
  /** The barn, for clicks (its meshes carry userData.hit on their group). */
  const hits = () => (built ? built.children.filter(o => o.userData.hit) : []);
  return {
    group, build, hits,
    /** Shows or hides the yard's ball trees, bushes and rocks (they stand in until build/nature.js has drawn the models). */
    setPlants(on) { for (const o of built?.children ?? []) if (o.userData.plants) o.visible = on; },
    dispose: () => { if (built) disposeTree(built); built = null; key = ''; },
  };
}
