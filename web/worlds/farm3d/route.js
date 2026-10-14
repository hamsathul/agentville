// How a farmer walks, the 2D engine's way (web/worlds/sdk/engine.js, plan): along its row to the path nearest both
// ends, down the path, along to its spot, so it never crosses a field; a newcomer walks out of its door first.
import { LANE } from './layout.js';

export function walkRoute([x0, y0], [tx, ty], corridors, door = null) {
  const [x, y] = door ?? [x0, y0], out = door ? [[x, y]] : [];
  if (Math.abs(y - ty) < 0.5) return [...out, [tx, ty]];
  const c = corridors.reduce((best, cx) => (Math.abs(x - cx) + Math.abs(tx - cx) < Math.abs(x - best) + Math.abs(tx - best) ? cx : best));
  return [...out, [c, y], [c, ty], [tx, ty]];
}
/**
 * A walk on the land (spec 2026-10-14 neighbour §7): within a farm, walkRoute; from one farm to the other, along its
 * lane to the gap, over the bridge, and on along the other's. `corridors`: both farms' paths; `gap`: [its west edge,
 * its east edge] in x (your farm's edge and the neighbour's), or null with one farm.
 */
export function landRoute(from, to, { corridors, gap = null, lane = LANE }, door = null) {
  const side = x => (gap && x > (gap[0] + gap[1]) / 2 ? 1 : 0), start = door ?? from;
  if (!gap || side(start[0]) === side(to[0])) return walkRoute(from, to, corridors, door);
  const [exit, entry] = side(start[0]) ? [[gap[1] + 4, lane], [gap[0] - 4, lane]] : [[gap[0] - 4, lane], [gap[1] + 4, lane]];
  return [...walkRoute(from, exit, corridors, door), entry, ...walkRoute(entry, to, corridors)];
}
