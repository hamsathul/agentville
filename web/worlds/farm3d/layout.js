// The 2D farm's ground, in its own pixels (web/worlds/farm/world.js), and the 3D farm's mapping from it: 8 px a
// metre, the 2D x along 3D x, the 2D y along 3D z, centred on the farm. Copies of the farm's numbers, pinned by
// collector/test/farm3d.test.mjs.
export const W = 400, PX = 8;
export const COLW = 88, ROWH = 62, MIN_ROWS = 3, MAX_ROWS = 6, MAX_FIELDS = 18;
export const PORCH_Y = 78, LANE = 87; // where farmers stand on the porch (and among the scarecrows); the lane in front of the buildings
export const CORR = [116, 218, 306]; // the paths running down: the yard's, then the walkways between the field columns
export const BARN_DOOR = [62, LANE];
export const MEADOW = [[28, 162], [74, 166], [40, 186], [86, 186]]; // farmers working outside any repo
export const NAPS = [[97, 204], [97, 224]]; // hammocks by the pond: sessions that wake up by themselves (/loop)
export const STALL = { x: 284, y: 48 };
export const POND = { cx: 42, cy: 210, rx: 34, ry: 15 };
export const SILO_X = [92, 8]; // the first account's silo; a second account's left of the barn
export const BARN = { x: 36, y: 14 }, HOUSE = { x: 132, y: 10, w: 136 }, HENHOUSE = { x: 8, y: 98 }, SCARECROWS = { x: 316, y: 30, w: 80 };
export const GRID_CONFIG = {
  cols: 3, colW: COLW, rowH: ROWH, cx0: 174, top0: 100, minRows: MIN_ROWS, maxRows: MAX_ROWS, max: MAX_FIELDS,
  slot: (cx, rowTop) => ({ lane: rowTop + 44, x0: cx - 36, y0: rowTop + 12 }),
  fence: rows => ({ x0: 128, x1: 396, y0: 96, y1: 104 + rows * ROWH }), height: fence => fence.y1 + 28,
};
/** The places that hold a few farmers each, for a ground L (the shade tree moves down with more rows). */
export function slotTables(L) {
  const y = L.GRID.y1 - 6;
  return {
    desk: { cap: 3, at: i => [142 + 24 * i, PORCH_Y] }, // waiting on you: the porch's left
    turn: { cap: 3, at: i => [258 - 24 * i, PORCH_Y] }, // its turn ended: the porch's right
    storage: { cap: 4, at: i => [328 + 20 * i, PORCH_Y] }, // stale: the scarecrows
    charge: { cap: 4, at: i => [[64, y], [40, y + 2], [88, y + 2], [16, y + 4]][i] }, // idle: under the shade tree
    meadow: { cap: MEADOW.length, at: i => MEADOW[i] },
    nap: { cap: NAPS.length, at: i => NAPS[i] },
  };
}
/** A 2D farm point, in metres on the 3D ground. */
export const toWorld = (x, y, H) => ({ x: (x - W / 2) / PX, z: (y - H / 2) / PX });
