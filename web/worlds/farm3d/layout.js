// The 3D farm's map, in the 2D farm's pixels (8 px a metre; the 2D x along 3D x, the 2D y along 3D z, centred on the
// map). The places are the 2D farm's (web/worlds/farm/world.js): the same groups, in the same order, with the same
// room, and the same bed for each repo; only the distances are the 3D farm's own, roomier, since the 3D farm has the
// space: 5 m walkways and rows between the fields, farmers 4 m apart on a longer deck, a wider yard, and a pasture
// across the front. collector/test/farm3d.test.mjs pins both.
import { noise } from './build/util.js';

export const W = 560, PX = 8;
export const COLW = 116, ROWH = 82, MIN_ROWS = 3, MAX_ROWS = 6, MAX_FIELDS = 18;
export const LANE = 110, LANE_HALF = 10; // the lane in front of the buildings (2.5 m wide)
export const PORCH_Y = 98; // where farmers stand on the deck (and among the scarecrows)
export const CORR = [176, 306, 422]; // the paths running down: the yard's, then the walkways between the columns of beds
// The farmstead along the back, left to right: a second account's silo, the barn, the silo, the farmhouse on its
// long deck (your porch), the market stall, the scarecrow patch.
export const SILO_X = [100, 6]; // the first account's silo beside the barn; a second account's on the barn's other side
export const SILO_Y = 86; // the silos' middle (their front 1.25 m nearer)
export const BARN = { x: 34, front: 100 };
export const BARN_DOOR = [61, LANE];
export const HOUSE = { x: 176, y: 30, w: 136 }; // its walls from x + 4 to x + w - 4, its front at PORCH_Y - 10
export const DECK = { x0: 150, x1: 362, y0: PORCH_Y - 10, y1: PORCH_Y + 3 }; // longer than the house: six farmers 4 m apart
export const STALL = { x: 384, y: 62 };
/** The notice board (what your projects remember): by the porch's steps, between the silo and the deck, as the 2D farm has it. */
export const BOARD = { x: 128, y: 74, w: 16, h: 10 };
export const SCARECROWS = { x: 430, y: 36, w: 120 };
// The yard on the left: the henhouse and its run, the pond, the hammocks, the shade tree, a woodpile, bushes, rocks.
export const HENHOUSE = { x: 10, y: 122 };
export const POND = { cx: 70, cy: 262, rx: 40, ry: 17 };
/** The pond's water: its surface's height, and how deep it is in the middle (metres); fish swim just under the surface. */
export const WATER = { y: 0.06, deep: 0.6 };
/** The pond's lily pads, [x, y, size, in flower]: the frog's stepping stones, a hop apart. */
export const LILY_PADS = [[46, 263, 1, true], [60, 256, 0.8, false], [73, 266, 1.1, false], [84, 257, 0.75, false], [96, 263, 0.9, true]];
export const MEADOW = [[30, 196], [96, 200], [36, 304], [120, 304]]; // farmers working outside any repo
export const NAPS = [[142, 236], [142, 262]]; // hammocks: sessions that wake up by themselves (/loop); room to their right for a cow to pass
export const SHADE = { x: 96, dy: -24 }; // the shade tree, this far above the fields' fence's bottom
export const WOODPILE = [150, 300];
export const BUSHES = [[150, 196, 4], [112, 226, 3]];
export const rocksOf = L => [[120, L.GRID.y1 - 30, 4], [10, L.GRID.y1 - 14, 3], [56, L.GRID.y1 - 2, 2]]; // the last kept clear of the way down to the pasture's gate
/** The yard's orchard, which grows a tree pair with each row of fields past the third. */
export const orchardOf = L => Array.from({ length: Math.max(0, L.rows - 3) }, (_, k) => [[40, 130 + (k + 3) * ROWH - 30], [130, 130 + (k + 3) * ROWH - 14]]).flat();

export const GRID_CONFIG = {
  cols: 3, colW: COLW, rowH: ROWH, cx0: 248, top0: 130, minRows: MIN_ROWS, maxRows: MAX_ROWS, max: MAX_FIELDS,
  slot: (cx, rowTop) => ({ lane: rowTop + 44, x0: cx - 36, y0: rowTop + 12 }),
  fence: rows => ({ x0: 192, x1: 528, y0: 124, y1: 132 + rows * ROWH }),
  height: fence => fence.y1 + 204, // the pasture under the fields, and the forest's edge under that
};
/** The pasture across the front of the farm, under the fields: the cows, the sheep and the horses graze there. */
export const pastureOf = L => ({ x0: 16, x1: 544, y0: L.GRID.y1 + 26, y1: L.GRID.y1 + 150 });
/**
 * The pasture's gates, [from, to] along its top fence and its bottom one: a 6 m double gate where the yard's path comes
 * down (wide to its left, so a bull coming down beside the fields fits through), and a 5 m one to the forest.
 */
export const PASTURE_GATES = { top: [CORR[0] - 36, CORR[0] + 14], bottom: [W / 2 - 20, W / 2 + 20] };
/**
 * What stands on the farm that an animal walks round (2D pixels, rectangles): the barn, the silos (both accounts'
 * places), the farmhouse and its deck, the henhouse and its run, the market stall, the notice board, the scarecrow patch.
 */
export const FARMSTEAD = [
  { x: BARN.x, y: BARN.front - 45, w: 55, h: 45 },
  ...SILO_X.map(x => ({ x: x, y: SILO_Y - 10, w: 20, h: 20 })),
  { x: HOUSE.x + 4, y: PORCH_Y - 52, w: HOUSE.w - 8, h: 42 },
  { x: DECK.x0, y: DECK.y0, w: DECK.x1 - DECK.x0, h: DECK.y1 - DECK.y0 + 3 },
  { x: HENHOUSE.x, y: HENHOUSE.y, w: 92, h: 36 },
  { x: STALL.x - 2, y: STALL.y, w: 34, h: 36 },
  { x: BOARD.x - 1, y: BOARD.y - 1, w: BOARD.w + 2, h: BOARD.h + 2 },
  { x: SCARECROWS.x - 2, y: SCARECROWS.y - 2, w: SCARECROWS.w + 4, h: PORCH_Y + 4 - SCARECROWS.y + 2 },
];
/** The forest's edge, where the deer and the fox come out: a strip of grass between the pasture's fence and the trees. */
export const forestEdgeOf = L => [{ x: 0, y: pastureOf(L).y1 + 1, w: W, h: L.H + 22 - pastureOf(L).y1 - 1 }];

export const MARGIN_X = 48, MARGIN_TOP = 40, MARGIN_BOTTOM = 40; // the forest's ring past the farm's edges
/** The ground's rectangle for a farm H high: the farm and its forest ring. */
export const extentOf = H => ({ x0: -MARGIN_X, x1: W + MARGIN_X, y0: -MARGIN_TOP, y1: H + MARGIN_BOTTOM });
/**
 * The forest's trees round a farm H high, each [x, y, r, n]: round trees just past the farm's edges, a crown r * 1.25
 * across from its middle (build/terrain.js draws them; roam.js keeps the animals out of them), n its own noise.
 */
export function forestOf(H) {
  const ext = extentOf(H), trees = [];
  for (let gy = Math.floor((ext.y0 - 20) / 18); gy * 18 < ext.y1 + 10; gy++) for (let gx = Math.floor((ext.x0 - 24) / 20); gx * 20 < ext.x1 + 10; gx++) {
    const n = noise(gx * 31, gy * 17), x = gx * 20 + (n % 13) - 6 + (gy % 2) * 10, y = gy * 18 + ((n >> 4) % 9);
    if (!(x < -4 || x > W + 4 || y <= 12 || y >= H + 22)) continue;
    if (x < ext.x0 + 6 || x > ext.x1 - 6 || y < ext.y0 + 6 || y > ext.y1 - 4) continue;
    trees.push([x, y, 9 + ((n >> 6) % 5), n]);
  }
  return trees;
}

/** The places that hold a few farmers each, for a ground L (the shade tree moves down with more rows). */
export function slotTables(L) {
  const y = L.GRID.y1 - 6;
  return {
    desk: { cap: 3, at: i => [168 + 32 * i, PORCH_Y] }, // waiting on you: the porch's left
    turn: { cap: 3, at: i => [344 - 32 * i, PORCH_Y] }, // its turn ended: the porch's right
    storage: { cap: 4, at: i => [446 + 30 * i, PORCH_Y] }, // stale: the scarecrows
    charge: { cap: 4, at: i => [[96, y], [64, y + 3], [128, y + 3], [32, y + 6]][i] }, // idle: under the shade tree
    meadow: { cap: MEADOW.length, at: i => MEADOW[i] },
    nap: { cap: NAPS.length, at: i => NAPS[i] },
  };
}
/** Where the "+N" signs stand for farmers beyond a place's room, and the words they say. */
export const signsOf = L => ({
  desk: [200, PORCH_Y - 34, 'waiting'], turn: [312, PORCH_Y - 34, 'your turn'], storage: [490, PORCH_Y - 34, 'stale'],
  charge: [SHADE.x, L.GRID.y1 + 10, 'idle'], meadow: [70, 182, 'in the meadow'], nap: [150, 222, 'napping'],
  more: [480, L.GRID.y1 + 12, 'more'],
});
/** A 2D map point, in metres on the 3D ground. */
export const toWorld = (x, y, H) => ({ x: (x - W / 2) / PX, z: (y - H / 2) / PX });
