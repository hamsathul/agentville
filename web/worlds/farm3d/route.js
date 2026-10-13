// How a farmer walks, the 2D engine's way (web/worlds/sdk/engine.js, plan): along its row to the path nearest both
// ends, down the path, along to its spot, so it never crosses a field; a newcomer walks out of its door first.
export function walkRoute([x0, y0], [tx, ty], corridors, door = null) {
  const [x, y] = door ?? [x0, y0], out = door ? [[x, y]] : [];
  if (Math.abs(y - ty) < 0.5) return [...out, [tx, ty]];
  const c = corridors.reduce((best, cx) => (Math.abs(x - cx) + Math.abs(tx - cx) < Math.abs(x - best) + Math.abs(tx - best) ? cx : best));
  return [...out, [c, y], [c, ty], [tx, ty]];
}
