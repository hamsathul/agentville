// Where the 3D farm's animals may go: each herd's ground (the pasture inside its fence, the yard below the henhouse's
// run, the forest's edge between the pasture's fence and the trees) less what stands on it (the pond and its bank,
// the trees, bushes and rocks, the woodpile, the hammocks), for a body of a given size; and in the pond, the water
// for the fish (clear of its bank) and the lily pads for the frog, which jumps between them. An animal is a circle as wide
// as it is long (r, half its length, in px), so it fits whichever way it faces, and it goes only where the straight
// way there is clear. Positions are in the 2D farm's pixels. No three.js: build/animals.js uses it, the tests run it.
import { BUSHES, LILY_PADS, NAPS, POND, SHADE, WOODPILE, forestEdgeOf, forestOf, orchardOf, pastureOf, rocksOf } from './layout.js';

const STEP = 2; // how finely a way is checked, in px
const TRUNK = 4; // a yard tree's trunk, in px: the dogs run under its crown
const WET = new Set(['water', 'pond']); // grounds in the pond: nothing on land is in their way, and the frog jumps

/** The grounds and what stands on them, for a farm L (its GRID, rows and H, as model.js makes it). */
export function roamOf(L) {
  const pa = pastureOf(L), y1 = L.GRID.y1;
  const areas = {
    pasture: [{ x: pa.x0 + 1, y: pa.y0 + 1, w: pa.x1 - pa.x0 - 2, h: pa.y1 - pa.y0 - 2 }], // inside its fence
    yard: [{ x: 0, y: 166, w: 186, h: y1 + 22 - 166 }], // under the henhouse's run, left of the fields' fence, over the pasture's
    edge: forestEdgeOf(L),
    water: [{ cx: POND.cx, cy: POND.cy, rx: POND.rx - 3, ry: POND.ry - 3 }], // clear of the bank
    pond: LILY_PADS.map(([cx, cy]) => ({ cx, cy, r: 0.5 })), // the middle of a pad
  };
  const near = (x, y, pad) => ['pasture', 'yard', 'edge'].flatMap(k => areas[k]).some(a => x > a.x - pad && x < a.x + a.w + pad && y > a.y - pad && y < a.y + a.h + pad);
  const obstacles = [
    { cx: POND.cx, cy: POND.cy, rx: POND.rx + 4, ry: POND.ry + 4 }, // the water and its sandy bank
    { x: NAPS[0][0] - 20, y: NAPS[0][1] - 16, w: 40, h: NAPS.at(-1)[1] - NAPS[0][1] + 24 },
    { x: WOODPILE[0] - 14, y: WOODPILE[1] - 10, w: 28, h: 20 },
    { cx: SHADE.x, cy: y1 + SHADE.dy - 10, r: TRUNK + 1 }, // the shade tree's trunk stands behind its middle
    ...orchardOf(L).map(([cx, cy]) => ({ cx, cy, r: TRUNK })),
    ...BUSHES.map(([cx, cy, r]) => ({ cx, cy, r: r * 1.4 })),
    ...rocksOf(L).map(([cx, cy, s]) => ({ cx, cy, r: s * 1.4 })),
    ...forestOf(L.H).filter(([x, y, r]) => near(x, y, r * 1.25 + 24)).map(([cx, cy, r]) => ({ cx, cy, r: r * 1.25 })), // their crowns: the deer would stand in them
  ];
  /** Whether a body of size r at (x, y) touches something. */
  const hits = (x, y, r) => obstacles.some(o => (o.rx ? ((x - o.cx) / (o.rx + r)) ** 2 + ((y - o.cy) / (o.ry + r)) ** 2 < 1
    : o.r !== undefined ? Math.hypot(x - o.cx, y - o.cy) < o.r + r
      : x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r));
  /** Whether a body of size r is all inside one of a ground's shapes: a rectangle, an ellipse, or a pad's middle. */
  const within = (a, x, y, r) => (a.w !== undefined ? x - r >= a.x && x + r <= a.x + a.w && y - r >= a.y && y + r <= a.y + a.h
    : a.rx !== undefined ? a.rx > r && a.ry > r && ((x - a.cx) / (a.rx - r)) ** 2 + ((y - a.cy) / (a.ry - r)) ** 2 <= 1
      : Math.hypot(x - a.cx, y - a.cy) <= a.r);
  /** Whether a body of size r at (x, y) is on its ground, all of it, and clear of everything on it. */
  function inside(area, x, y, r = 0) {
    return Boolean(areas[area]?.some(a => within(a, x, y, r))) && (WET.has(area) || !hits(x, y, r));
  }
  /** Whether a body of size r can go in a straight line from one place to another (the frog jumps: always). */
  function clear(area, [x0, y0], [x1, y1], r = 0) {
    if (area === 'pond') return true;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP));
    for (let k = 0; k <= n; k++) if (!inside(area, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r)) return false;
    return true;
  }
  /**
   * A free place on a ground for a body of size r. From somewhere: one it can walk to in a straight line, at least far
   * away if it can find one (else the farthest it found; else where it is).
   */
  function spot(area, rand, { from, far = 0, r = 0 } = {}) {
    const rects = areas[area];
    let best = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const a = rects[Math.floor(rand() * rects.length)], u = rand(), v = rand();
      const [x, y] = a.w !== undefined ? [a.x + r + u * Math.max(0, a.w - 2 * r), a.y + r + v * Math.max(0, a.h - 2 * r)]
        : a.rx !== undefined ? [a.cx + (u * 2 - 1) * (a.rx - r), a.cy + (v * 2 - 1) * (a.ry - r)] : [a.cx, a.cy];
      if (!inside(area, x, y, r) || (from && !clear(area, from, [x, y], r))) continue;
      const d = from ? Math.hypot(x - from[0], y - from[1]) : 0;
      if (d >= far) return [x, y];
      if (d > bestD) { best = [x, y]; bestD = d; }
    }
    return best ?? (from ? [...from] : rects[0].w !== undefined ? [rects[0].x + rects[0].w / 2, rects[0].y + rects[0].h / 2] : [rects[0].cx, rects[0].cy]);
  }
  return { areas, obstacles, inside, clear, spot };
}
