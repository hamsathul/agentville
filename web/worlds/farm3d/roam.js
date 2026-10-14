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
import { BED, BUSHES, CORR, FARMSTEAD, GRID_CONFIG, LILY_PADS, NAPS, PASTURE_GATES, POND, SHADE, W, WALKWAY_GATES, WOODPILE, forestEdgeOf, forestOf, orchardOf, pastureOf, rocksOf, CART_RANK } from './layout.js';

const STEP = 2; // how finely a way is checked, in px
const TRUNK = 4; // a yard tree's trunk, in px: the dogs run under its crown
const WET = new Set(['water', 'pond']); // grounds in the pond: nothing on land is in their way, and the frog jumps
const CELL = 4; // route()'s grid, in px
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

/** The grounds and what stands on them, for a farm L (its GRID, rows and H, as model.js makes it). */
export function roamOf(L) {
  const pa = pastureOf(L), y1 = L.GRID.y1;
  const areas = {
    pasture: [{ x: pa.x0 + 1, y: pa.y0 + 1, w: pa.x1 - pa.x0 - 2, h: pa.y1 - pa.y0 - 2 }], // inside its fence
    yard: [{ x: 0, y: 166, w: 186, h: y1 + 22 - 166 }], // under the henhouse's run, left of the fields' fence, over the pasture's
    edge: forestEdgeOf(L),
    water: [{ cx: POND.cx, cy: POND.cy, rx: POND.rx - 3, ry: POND.ry - 3 }], // clear of the bank
    pond: LILY_PADS.map(([cx, cy]) => ({ cx, cy, r: 0.5 })), // the middle of a pad
    farm: [{ x: 0, y: 0, w: W, h: L.H + 22 }], // the whole farm, for roaming: everything walkable on it
    fields: [{ x: L.GRID.x0, y: L.GRID.y0, w: L.GRID.x1 - L.GRID.x0, h: L.GRID.y1 - L.GRID.y0 }], // among the fields: their walkways and headlands
  };
  const near = (x, y, pad) => x > -pad && x < W + pad && y > -pad && y < L.H + 22 + pad;
  const G = L.GRID;
  // the pasture's fence, less its gates; the fields' fence, less its gates at the walkways and the farmers' gaps on the
  // yard's side (as build/buildings.js draws it); inside it, the field patches, with the walkways and headlands between
  const patches = patchesOf(L.rows ?? 3), lanes = [...new Set(patches.map(p => p.lane))];
  const fences = [...fenceX(pa.x0, pa.x1, pa.y0, [PASTURE_GATES.top, ...WALKWAY_GATES]), ...fenceX(pa.x0, pa.x1, pa.y1, [PASTURE_GATES.bottom]), [pa.x0, pa.y0, pa.x0, pa.y1], [pa.x1, pa.y0, pa.x1, pa.y1],
    ...fenceX(G.x0, G.x1, G.y0, WALKWAY_GATES), ...fenceX(G.x0, G.x1, G.y1, WALKWAY_GATES), [G.x1, G.y0, G.x1, G.y1], ...fenceY(G.x0, G.y0, G.y1, lanes.map(y => [y - 4, y + 5]))];
  const obstacles = [
    ...patches.map(patchBox), // the fields
    { cx: POND.cx, cy: POND.cy, rx: POND.rx + 4, ry: POND.ry + 4 }, // the water and its sandy bank
    { x: NAPS[0][0] - 15, y: NAPS[0][1] - 8, w: 29, h: NAPS.at(-1)[1] - NAPS[0][1] + 16 }, // the hammocks, post to post
    { x: WOODPILE[0] - 14, y: WOODPILE[1] - 10, w: 28, h: 20 },
    { cx: SHADE.x, cy: y1 + SHADE.dy - 10, r: TRUNK + 1 }, // the shade tree's trunk stands behind its middle
    ...orchardOf(L).map(([cx, cy]) => ({ cx, cy, r: TRUNK })),
    ...BUSHES.map(([cx, cy, r]) => ({ cx, cy, r: r * 1.4 })),
    ...rocksOf(L).map(([cx, cy, s]) => ({ cx, cy, r: s * 1.4 })),
    ...forestOf(L.H).filter(([x, y, r]) => near(x, y, r * 1.25 + 24)).map(([cx, cy, r]) => ({ cx, cy, r: r * 1.25 })), // their crowns: the deer would stand in them
    ...FARMSTEAD, // the buildings, the deck, the henhouse's run, the stall, the scarecrow patch
    { x: CART_RANK.at(-1)[0] - 10, y: CART_RANK[0][1] - 8, w: CART_RANK[0][0] - CART_RANK.at(-1)[0] + 20, h: 16 }, // the row where the tool carts park
  ];
  const box = (o, x, y, r) => x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r;
  /** Whether a body of size r at (x, y) touches something: a thing on the ground, a field, or a fence. */
  const hits = (x, y, r) => obstacles.some(o => (o.rx ? ((x - o.cx) / (o.rx + r)) ** 2 + ((y - o.cy) / (o.ry + r)) ** 2 < 1
    : o.r !== undefined ? Math.hypot(x - o.cx, y - o.cy) < o.r + r
      : box(o, x, y, r)))
    || fences.some(f => toSegment(x, y, f) < r + 1);
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
  const grids = new Map(), cols = Math.ceil(W / CELL) + 1, rows = Math.ceil((L.H + 22) / CELL) + 1;
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
  return { areas, obstacles, inside, free, busyAt, clear, spot, route, setBusy };
}
