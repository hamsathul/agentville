// Where the 3D farm's animals may go: each herd's ground (the pasture inside its fence, the yard below the henhouse's
// run, the forest's edge between the pasture's fence and the trees) less what stands on it (the pond and its bank,
// the trees, bushes and rocks, the woodpile, the hammocks), for a body of a given size; and in the pond, the water
// for the fish (clear of its bank) and the lily pads for the frog, which jumps between them. An animal is a circle as wide
// as it is long (r, half its length, in px), so it fits whichever way it faces, and it goes only where the straight
// way there is clear. The animals roam the whole farm (`farm`: everything walkable on it, round the buildings, between
// the fields along their walkways and headlands, in through the gates of the fields' fence and the pasture's), and
// route() finds a way there, round what stands between. A field a machine is working is busy (setBusy): no animal picks
// a place on it to stop (free), though one may walk across or out. A place picked keeps clear of others (`avoid`) when
// there is room. Positions are in the 2D farm's pixels. No three.js: build/animals.js uses it, the tests run it.
import { BED, BUSHES, CORR, CREEK, FARMSTEAD, GRID_CONFIG, LILY_PADS, NAPS, PASTURE_GATES, POND, SHADE, W, WALKWAY_GATES, WOODPILE, crossingsOf, farmAt, farmsteadOf, forestEdgeOf, forestOf, orchardOf, pastureOf, rocksOf, CART_RANK } from './layout.js';
import { areaOn } from './antics.js';

const STEP = 2; // how finely a way is checked, in px
const TRUNK = 4; // a yard tree's trunk, in px: the dogs run under its crown
const WET = new Set(['water', 'pond']); // grounds in the pond: nothing on land is in their way, and the frog jumps
const CELL = 4; // route()'s grid, in px
const BUCKET = 32, REACH = 24, MARGIN = 96; // hits()'s buckets: their size, how far round its box a thing is put, how far past the land they run
const SIZES = [6, 9, 12, 15, 18]; // the bodies route() keeps a grid for: an animal's is the next up
/** A field patch's ground, kept clear (its piles above it, its pumps and windmill on its left, its edging), and a busy
 *  one's (the machine's turns at its ends too), round a slot's corner (x0, y0). */
const patchBox = ({ x0, y0 }) => ({ x: x0 - 14, y: y0 - 12, w: BED.w + 22, h: BED.d + 18 });
const busyBox = ({ x0, y0 }) => ({ x: x0 - 26, y: y0 - 12, w: BED.w + 52, h: BED.d + 20 });

/** How far (x, y) is from a line from (x0, y0) to (x1, y1). */
function toSegment(x, y, [x0, y0, x1, y1]) {
  const dx = x1 - x0, dy = y1 - y0, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l)) : 0;
  return Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
}
/** A fence from (a, y) to (b, y), less its gates ([from, to] in x), as the lines left. */
const fenceX = (a, b, y, gates) => { const out = []; let from = a; for (const [g0, g1] of gates.slice().sort((p, q) => p[0] - q[0])) { out.push([from, y, g0, y]); from = g1; } out.push([from, y, b, y]); return out; };
/** The same for a fence from (x, a) to (x, b), its gaps in y. */
const fenceY = (x, a, b, gaps) => fenceX(a, b, x, gaps).map(([p, , q]) => [x, p, x, q]);
/** Every field patch of a farm of `rows` (a bed's or an empty slot's): its corner and its farmers' lane, as model.js lays them. */
export const patchesOf = rows => Array.from({ length: rows * GRID_CONFIG.cols }, (_, k) => {
  const cx = GRID_CONFIG.cx0 + (k % GRID_CONFIG.cols) * GRID_CONFIG.colW, s = GRID_CONFIG.slot(cx, GRID_CONFIG.top0 + Math.floor(k / GRID_CONFIG.cols) * GRID_CONFIG.rowH);
  return { x0: s.x0, y0: s.y0, lane: s.lane };
});

/**
 * The grounds and what stands on them, for a farm L (its GRID, rows and H, as model.js makes it; its land with a
 * neighbour farm). With a neighbour (spec 2026-10-14 neighbour §8) its grounds are '@n' ones (pasture@n, yard@n,
 * fields@n, home@n: its own farm), `farm` is the whole land, the edge runs along both, and the creek between them is
 * in the way but for its three crossings (the lane's bridge, the cattle bridge between the pastures, the stones).
 */
export function roamOf(L) {
  const land = L.land ?? { w: W, ox: 0 }, pa = pastureOf(L), y1 = L.GRID.y1, G = L.GRID;
  const farms = land.ox ? [0, land.ox] : [0];
  /** A farm's own grounds, at its offset: inside its pasture's fence; its yard below the henhouse's run, left of the
   *  fields' fence, over the pasture's; among its fields (their walkways and headlands); the farm itself. */
  const own = ox => ({
    pasture: [{ x: pa.x0 + 1 + ox, y: pa.y0 + 1, w: pa.x1 - pa.x0 - 2, h: pa.y1 - pa.y0 - 2 }],
    yard: [{ x: ox, y: 166, w: 186, h: y1 + 22 - 166 }],
    fields: [{ x: G.x0 + ox, y: G.y0, w: G.x1 - G.x0, h: G.y1 - G.y0 }],
    home: [{ x: ox, y: 0, w: W, h: L.H + 22 }],
  });
  const areas = {
    ...own(0),
    edge: forestEdgeOf(L),
    water: [{ cx: POND.cx, cy: POND.cy, rx: POND.rx - 3, ry: POND.ry - 3 }], // clear of the bank
    pond: LILY_PADS.map(([cx, cy]) => ({ cx, cy, r: 0.5 })), // the middle of a pad
    farm: [{ x: 0, y: 0, w: land.w, h: L.H + 22 }], // the whole land, for roaming: everything walkable on it
  };
  if (land.ox) for (const [k, v] of Object.entries(own(land.ox))) areas[areaOn(k, 1)] = v;
  const near = (x, y, pad) => x > -pad && x < land.w + pad && y > -pad && y < L.H + 22 + pad;
  // each farm's pasture fence, less its gates (and, with a neighbour, a gate in the sides that face the cattle bridge);
  // the fields' fence, less its gates at the walkways and the farmers' gaps on the yard's side (as build/buildings.js
  // draws it); inside it, the field patches, with the walkways and headlands between
  const patches = patchesOf(L.rows ?? 3), lanes = [...new Set(patches.map(p => p.lane))], cattle = crossingsOf(L).cattle;
  const fences = farms.flatMap(ox => {
    const sh = gs => gs.map(([g0, g1]) => [g0 + ox, g1 + ox]);
    return [...fenceX(pa.x0 + ox, pa.x1 + ox, pa.y0, sh([PASTURE_GATES.top, ...WALKWAY_GATES])), ...fenceX(pa.x0 + ox, pa.x1 + ox, pa.y1, sh([PASTURE_GATES.bottom])),
      ...fenceY(pa.x0 + ox, pa.y0, pa.y1, land.ox && ox ? [cattle] : []), ...fenceY(pa.x1 + ox, pa.y0, pa.y1, land.ox && !ox ? [cattle] : []),
      ...fenceX(G.x0 + ox, G.x1 + ox, G.y0, sh(WALKWAY_GATES)), ...fenceX(G.x0 + ox, G.x1 + ox, G.y1, sh(WALKWAY_GATES)), [G.x1 + ox, G.y0, G.x1 + ox, G.y1], ...fenceY(G.x0 + ox, G.y0, G.y1, lanes.map(y => [y - 4, y + 5]))];
  });
  /** What stands on a farm at ox (yours: the pond, the woodpile, the orchard and the carts' rank too). */
  const standing = ox => [
    ...patches.map(p => patchBox({ x0: p.x0 + ox, y0: p.y0 })), // the fields
    { x: NAPS[0][0] - 15 + ox, y: NAPS[0][1] - 8, w: 29, h: NAPS.at(-1)[1] - NAPS[0][1] + 16 }, // the hammocks, post to post
    { cx: SHADE.x + ox, cy: y1 + SHADE.dy - 10, r: TRUNK + 1 }, // the shade tree's trunk stands behind its middle
    ...BUSHES.map(([cx, cy, r]) => ({ cx: cx + ox, cy, r: r * 1.4 })),
    ...rocksOf(L).map(([cx, cy, s]) => ({ cx: cx + ox, cy, r: s * 1.4 })),
    ...farmsteadOf(ox), // the buildings, the deck, the scarecrow patch (yours: the henhouse's run, the stall, the board)
    ...(ox ? [] : [
      { cx: POND.cx, cy: POND.cy, rx: POND.rx + 4, ry: POND.ry + 4 }, // the water and its sandy bank
      { x: WOODPILE[0] - 14, y: WOODPILE[1] - 10, w: 28, h: 20 },
      ...orchardOf(L).map(([cx, cy]) => ({ cx, cy, r: TRUNK })),
      { x: CART_RANK.at(-1)[0] - 10, y: CART_RANK[0][1] - 8, w: CART_RANK[0][0] - CART_RANK.at(-1)[0] + 20, h: 16 }, // the row where the tool carts park
    ]),
  ];
  // the creek between the farms: in the way from the forest at the back to the forest at the front, but for its crossings
  const creek = [];
  if (land.ox) {
    const c = crossingsOf(L), gaps = [c.lane, c.cattle, c.stones].sort((p, q) => p[0] - q[0]);
    let from = -60;
    for (const [g0, g1] of gaps) { creek.push({ x: CREEK.x0, y: from, w: CREEK.x1 - CREEK.x0, h: g0 - from }); from = g1; }
    creek.push({ x: CREEK.x0, y: from, w: CREEK.x1 - CREEK.x0, h: L.H + 60 - from });
  }
  const obstacles = [
    ...farms.flatMap(standing),
    ...creek,
    ...forestOf(L.H, land.w).filter(([x, y, r]) => near(x, y, r * 1.25 + 24)).map(([cx, cy, r]) => ({ cx, cy, r: r * 1.25 })), // their crowns: the deer would stand in them
  ];
  const box = (o, x, y, r) => x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r;
  const touches = (o, x, y, r) => (o.rx ? ((x - o.cx) / (o.rx + r)) ** 2 + ((y - o.cy) / (o.ry + r)) ** 2 < 1
    : o.r !== undefined ? Math.hypot(x - o.cx, y - o.cy) < o.r + r
      : box(o, x, y, r));
  // What stands near each place: the obstacles and fences in buckets of BUCKET px, each in every bucket its box (and
  // REACH round it) covers, so a body no wider than REACH tests only what is near it, not all of the land's (the route
  // grids test every cell: with a neighbour farm the land is twice your farm, its obstacles nearly twice as many)
  const bx0 = -MARGIN, by0 = -MARGIN, bcols = Math.ceil((land.w + 2 * MARGIN) / BUCKET) + 1, brows = Math.ceil((L.H + 22 + 2 * MARGIN) / BUCKET) + 1;
  const bucketOf = (x, y) => { const i = Math.floor((x - bx0) / BUCKET), j = Math.floor((y - by0) / BUCKET); return i < 0 || j < 0 || i >= bcols || j >= brows ? -1 : j * bcols + i; };
  function bucketed(list, boxOf) {
    const cells = Array.from({ length: bcols * brows }, () => []);
    for (const o of list) {
      const [x0, y0, x1, y1] = boxOf(o);
      const i0 = Math.max(0, Math.floor((x0 - REACH - bx0) / BUCKET)), i1 = Math.min(bcols - 1, Math.floor((x1 + REACH - bx0) / BUCKET));
      const j0 = Math.max(0, Math.floor((y0 - REACH - by0) / BUCKET)), j1 = Math.min(brows - 1, Math.floor((y1 + REACH - by0) / BUCKET));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * bcols + i].push(o);
    }
    return cells;
  }
  const near0 = bucketed(obstacles, o => (o.w !== undefined ? [o.x, o.y, o.x + o.w, o.y + o.h] : o.rx !== undefined ? [o.cx - o.rx, o.cy - o.ry, o.cx + o.rx, o.cy + o.ry] : [o.cx - o.r, o.cy - o.r, o.cx + o.r, o.cy + o.r]));
  const nearF = bucketed(fences, ([x0, y0, x1, y1]) => [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]);
  /** Whether a body of size r at (x, y) touches something: a thing on the ground, a field, or a fence. */
  const hits = (x, y, r) => {
    const k = r + 1 < REACH ? bucketOf(x, y) : -1; // a wider body, or a place off the land: everything
    return (k < 0 ? obstacles : near0[k]).some(o => touches(o, x, y, r)) || (k < 0 ? fences : nearF[k]).some(f => toSegment(x, y, f) < r + 1);
  };
  let busy = []; // the fields a machine is working: setBusy
  /** Whether a body of size r is all inside one of a ground's shapes: a rectangle, an ellipse, or a pad's middle. */
  const within = (a, x, y, r) => (a.w !== undefined ? x - r >= a.x && x + r <= a.x + a.w && y - r >= a.y && y + r <= a.y + a.h
    : a.rx !== undefined ? a.rx > r && a.ry > r && ((x - a.cx) / (a.rx - r)) ** 2 + ((y - a.cy) / (a.ry - r)) ** 2 <= 1
      : Math.hypot(x - a.cx, y - a.cy) <= a.r);
  /** Whether a body of size r at (x, y) is on its ground, all of it, and clear of everything on it. */
  function inside(area, x, y, r = 0) {
    return Boolean(areas[area]?.some(a => within(a, x, y, r))) && (WET.has(area) || !hits(x, y, r));
  }
  /** Whether a body of size r at (x, y) would stop on a busy field (one a machine is working, or its ends). */
  const busyAt = (x, y, r = 0) => busy.some(o => box(o, x, y, r));
  /** Whether a body of size r may stop at (x, y): inside its ground, and not on a busy field. */
  const free = (area, x, y, r = 0) => inside(area, x, y, r) && !busyAt(x, y, r);
  /** Whether a body of size r can go in a straight line from one place to another (the frog jumps: always). */
  function clear(area, [x0, y0], [x1, y1], r = 0) {
    if (area === 'pond') return true;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP));
    for (let k = 0; k <= n; k++) if (!inside(area, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r)) return false;
    return true;
  }
  /**
   * A free place on a ground for a body of size r. From somewhere: one it can walk to in a straight line (unless
   * `straight` is false: route() finds the way), at least far away if it can find one (else the farthest it found; else
   * where it is), and within `near` of it if that is given; never on a busy field, and clear of each of `avoid` ([x, y,
   * r]: another animal, a farmer) when it can be (`strict`: always, else null).
   */
  function spot(area, rand, { from, far = 0, near: within2 = Infinity, straight = true, r = 0, avoid = [], strict = false } = {}) {
    const rects = areas[area], crowded = (x, y) => avoid.some(([ox, oy, or]) => Math.hypot(x - ox, y - oy) < r + or + 4);
    let best = null, bestD = -1, squeezed = null; // the farthest found; one on top of another, if that is all there is
    for (let i = 0; i < 40; i++) {
      const a = rects[Math.floor(rand() * rects.length)], u = rand(), v = rand();
      let [x, y] = a.w !== undefined ? [a.x + r + u * Math.max(0, a.w - 2 * r), a.y + r + v * Math.max(0, a.h - 2 * r)]
        : a.rx !== undefined ? [a.cx + (u * 2 - 1) * (a.rx - r), a.cy + (v * 2 - 1) * (a.ry - r)] : [a.cx, a.cy];
      if (from && Number.isFinite(within2)) [x, y] = [from[0] + (u * 2 - 1) * within2, from[1] + (v * 2 - 1) * within2]; // somewhere near: within that of it
      if (!free(area, x, y, r) || (from && straight && !clear(area, from, [x, y], r))) continue;
      if (crowded(x, y)) { squeezed ??= [x, y]; continue; }
      const d = from ? Math.hypot(x - from[0], y - from[1]) : 0;
      if (d >= far) return [x, y];
      if (d > bestD) { best = [x, y]; bestD = d; }
    }
    if (strict) return best;
    return best ?? squeezed ?? (from ? [...from] : rects[0].w !== undefined ? [rects[0].x + rects[0].w / 2, rects[0].y + rects[0].h / 2] : [rects[0].cx, rects[0].cy]);
  }
  /**
   * The way for a body of size r from one place to another on the farm, round whatever stands between: its turning
   * points then the place itself (just the place when the straight way is clear), or null when there is none.
   */
  const grids = new Map(), cols = Math.ceil(land.w / CELL) + 1, rows = Math.ceil((L.H + 22) / CELL) + 1;
  function gridFor(r) {
    const size = SIZES.find(c => c >= r) ?? Math.ceil(r);
    if (!grids.has(size)) {
      const g = new Uint8Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) g[j * cols + i] = inside('farm', i * CELL, j * CELL, size) ? 1 : 0;
      grids.set(size, g);
    }
    return grids.get(size);
  }
  function route(from, to, r = 0) {
    if (clear('farm', from, to, r)) return [to];
    const g = gridFor(r), id = (i, j) => j * cols + i;
    const nearest = ([x, y]) => { const i0 = Math.round(x / CELL), j0 = Math.round(y / CELL); for (let d = 0; d <= 3; d++) for (let j = j0 - d; j <= j0 + d; j++) for (let i = i0 - d; i <= i0 + d; i++) if (i >= 0 && j >= 0 && i < cols && j < rows && g[id(i, j)]) return id(i, j); return -1; };
    const s = nearest(from), e = nearest(to);
    if (s < 0 || e < 0) return null;
    // A*: eight ways, a corner cut only where both sides are open; the open list a binary heap in typed arrays
    const n = cols * rows, cost = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    let hf = new Float32Array(1024), hk = new Int32Array(1024), size = 0;
    const ei = e % cols, ej = Math.floor(e / cols);
    const h = k => { const dx = Math.abs((k % cols) - ei), dy = Math.abs(Math.floor(k / cols) - ej); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    const push = (k, f) => {
      if (size === hf.length) { const f2 = new Float32Array(size * 2), k2 = new Int32Array(size * 2); f2.set(hf); k2.set(hk); hf = f2; hk = k2; }
      let c = size++;
      while (c > 0) { const p = (c - 1) >> 1; if (hf[p] <= f) break; hf[c] = hf[p]; hk[c] = hk[p]; c = p; }
      hf[c] = f; hk[c] = k;
    };
    const pop = () => {
      const top = hk[0], lf = hf[--size], lk = hk[size];
      let c = 0;
      for (;;) { const a = 2 * c + 1, b = a + 1; let m = -1, mf = lf; if (a < size && hf[a] < mf) { m = a; mf = hf[a]; } if (b < size && hf[b] < mf) { m = b; } if (m < 0) break; hf[c] = hf[m]; hk[c] = hk[m]; c = m; }
      if (size) { hf[c] = lf; hk[c] = lk; }
      return top;
    };
    cost[s] = 0;
    push(s, h(s));
    while (size) {
      const k = pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === e) break;
      const i = k % cols, j = Math.floor(k / cols);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const m = id(ni, nj);
        if (!g[m] || done[m] || (di && dj && (!g[id(i + di, j)] || !g[id(i, j + dj)]))) continue;
        const c = cost[k] + (di && dj ? 1.414 : 1);
        if (c < cost[m]) { cost[m] = c; came[m] = k; push(m, c + h(m)); }
      }
    }
    if (e !== s && came[e] < 0) return null;
    const cells = [];
    for (let k = e; k !== s && k >= 0; k = came[k]) cells.push(k);
    cells.reverse();
    // straight legs: on to the furthest cell (40 at most ahead) the grid sees in a straight line, then the place itself
    const xy = k => [(k % cols) * CELL, Math.floor(k / cols) * CELL];
    const sees = ([x0, y0], [x1, y1]) => { const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL / 2)); for (let t = 0; t <= steps; t++) { const q = id(Math.round((x0 + ((x1 - x0) * t) / steps) / CELL), Math.round((y0 + ((y1 - y0) * t) / steps) / CELL)); if (!g[q]) return false; } return true; };
    const out = [];
    let at = xy(s);
    for (let k = 0; k < cells.length;) {
      let far = k;
      for (let m = Math.min(cells.length - 1, k + 40); m > k; m--) if (sees(at, xy(cells[m]))) { far = m; break; }
      while (far > k && !clear('farm', at, xy(cells[far]), r)) far--; // the grid rounds: each leg walkable for this body exactly
      at = xy(cells[far]);
      out.push(at);
      k = far + 1;
    }
    if (!out.length || !clear('farm', from, out[0], r)) out.unshift(xy(s)); // onto the grid first, where the start isn't on it
    if (clear('farm', out.at(-1), to, r)) out.push(to);
    return out;
  }
  /** The fields a machine is working now ([{ x0, y0 }]: their corners), busy till the next call. */
  function setBusy(list) { busy = list.map(busyBox); }
  /** An area on the farm a place is on: 'pasture' at x on the neighbour's farm is 'pasture@n' (romps, plays). */
  const localArea = (area, x) => areaOn(area, land.ox ? farmAt(x) : 0);
  return { areas, obstacles, inside, free, busyAt, clear, spot, route, setBusy, localArea };
}
