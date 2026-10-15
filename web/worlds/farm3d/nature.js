// The farm's plants and stones (models/: Quaternius's flat-coloured trees, bushes and rocks), where the layout puts
// them, in the season's variant: the forest round the farm (forestOf: leafy trees and birches near, pines further out),
// the shade tree, the orchard, the yard's bushes and rocks, and stumps, logs, mushrooms and flowers under the fringe of
// the trees. No three.js: build/nature.js draws them, roam.js keeps the animals out of the same places, and the tests
// run it. Positions in the 2D farm's pixels; w and h the box each fits in (metres), turn its heading.
import { BUSHES, CREEK, PX, ROAD, SHADE, W, forestOf, orchardOf, rocksOf } from './layout.js';

/**
 * The wind's clock wraps every WIND_PERIOD seconds (build/nature.js): every speed in its sway is a whole number of
 * turns in that time, so the wrap is seamless, and the clock stays small (a float on the graphics card loses its
 * fractions after days of seconds).
 */
export const WIND_PERIOD = 20 * Math.PI;

/** A plant's variant for the season: autumn colours, and snow (or bare branches) in winter. `n` mixes them a little. */
export function seasonal(kind, season, n = 0) {
  if (season === 'winter') return { tree: 'deadtreesnow', tree2: 'deadtreesnow', birch: n % 2 ? 'birchsnow' : 'birchdead', pine: 'pinesnow', bush: 'bushsnow', bushberries: 'bushsnow', rockmoss: 'rocksnow' }[kind] ?? kind;
  if (season === 'autumn') return { tree: 'autumntree', tree2: n % 3 ? 'autumntree' : 'tree2', pine: n % 2 ? 'pineautumn' : 'pine', bushberries: 'bush' }[kind] ?? kind;
  return kind;
}
const turnOf = n => ((n * 2.39996) % (Math.PI * 2));

/** Every plant and stone on a farm L (its GRID, rows and H; its land, with a neighbour farm) in a season; `orchard`:
 *  the merge orchard's trees (orchard.js), each a fruit tree its size. */
export function plantsOf(L, season, orchard = []) {
  const land = L.land ?? { w: W, ox: 0 }, out = [], H = L.H, forest = forestOf(H, land.w), farms = land.ox ? [0, land.ox] : [0];
  const corridor = x => land.ox && x > ROAD.x0 - 8 && x < CREEK.x1 + 8; // the road to town and the creek: nothing on them
  for (const [x, y, r, n] of forest) {
    const far = x < -20 || x > land.w + 20 || y < -16 || y > H + 34; // the ring's outer trees: pines, and their shadows fall off the farm
    const base = far ? 'pine' : ['tree', 'tree2', 'birch', 'pine', 'tree2'][n % 5];
    out.push({ kind: seasonal(base, season, n), x, y, w: (r * 1.25 * 2.1) / PX, h: 7.5, turn: turnOf(n), role: 'forest', ...(far ? { shadow: false } : {}) }); // as wide as roam.js's crown
  }
  // each farm's shade tree, bushes and rocks (yours, and the neighbour's in its yard by the road); the orchard is yours
  for (const ox of farms) out.push({ kind: seasonal('tree', season, 3), x: SHADE.x + ox, y: L.GRID.y1 + SHADE.dy - 10, w: 5.5, h: 6, turn: 0.6, role: 'shade' });
  for (const [x, y] of orchardOf(L)) out.push({ kind: seasonal('tree2', season, x + y), x, y, w: 3, h: 5, turn: turnOf(x + y), role: 'orchard' });
  for (const t of orchard) out.push({ kind: seasonal('tree2', season, t.x + t.y), x: t.x, y: t.y, w: 3 * t.size, h: 5 * t.size, turn: turnOf(t.x * 3 + t.y), role: 'merge' }); // the merge orchard
  for (const ox of farms) for (const [x, y, r] of BUSHES) out.push({ kind: seasonal((x + y) % 2 ? 'bushberries' : 'bush', season), x: x + ox, y, w: (r * 2.8) / PX, h: 2, turn: turnOf(x), role: 'bush' });
  for (const ox of farms) for (const [x, y, s] of rocksOf(L)) out.push({ kind: seasonal('rockmoss', season), x: x + ox, y, w: (s * 2.8) / PX, h: 2, turn: turnOf(y), role: 'rock' });
  // the forest floor: in front of every third tree along the bottom edge and down the yard's side, under its fringe
  // (where roam.js keeps the animals off anyway): a stump, a log, mushrooms in summer and autumn, flowers in spring and summer
  const things = season === 'winter' ? ['stump', 'log'] : season === 'autumn' ? ['stump', 'log', 'mushroom', 'mushroom'] : ['stump', 'flowers', 'mushroom', 'log', 'flowers'];
  for (const [x, y, r, n] of forest) {
    const crown = r * 1.25, bottom = y >= H + 22 && y < H + 40 && x > 8 && x < land.w - 8 && !corridor(x), side = x < -4 && x > -24 && y > 160 && y < H;
    if (!(bottom || side) || n % 3) continue;
    const kind = things[(n >> 2) % things.length], at = bottom ? [x + ((n % 9) - 4), y - crown + 2] : [x + crown - 2, y + ((n % 9) - 4)];
    out.push({ kind, x: at[0], y: at[1], w: kind === 'log' ? 2.2 : kind === 'stump' ? 1.1 : 0.7, h: kind === 'log' || kind === 'stump' ? 1 : 0.6, turn: turnOf(n), role: 'floor' });
  }
  return out;
}
