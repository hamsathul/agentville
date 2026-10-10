// The field exercise: the third built-in world. A bright, friendly army base on manoeuvres: every agent is a
// soldier in a field jacket of its agent's colour, and every repo a position on the exercise field. It is a
// drill: nobody is ever shown hurt. On the shared engine (web/worlds/sdk/engine.js), like the farm and the
// factory, in the frame's shared scope (pixel.js, people.js, props.js, creatures.js, animals.js, engine.js),
// so it keeps its own names inside this function. Classic script, no dependencies, one file (the frame loads
// only world.js).
(() => {
  'use strict';
  const { lookFor, rows: personRows, sprite: personSprite } = window.Agentville.people;

  /* ---------- the scene: what the base draws, from the snapshot ---------- */

  /** The field exercise's scene: the engine's, with each soldier's look. */
  function militaryScene(s) {
    const e = engineScene(s);
    e.farmers = e.farmers.map(f => ({ ...f, look: lookOf(f) }));
    return e;
  }

  /* ---------- the soldiers: people-kit soldiers in a field jacket of the agent's colour ---------- */

  // The people kit's outfit (people.js, lookFor): picked by the agent's id, so the same agent is always the same
  // soldier. A field jacket in its colour (C, exact), khaki trousers, headgear in olive and khaki tones (a beret
  // in its regiment's colour), and a radio on some.
  const OUTFIT = {
    hat: ['helmet', 'beret', 'cap'],
    hatColors: {
      helmet: [['#5b6b3a', '#3c4a26'], ['#6b7a45', '#46532c']],
      beret: [['#2f5a2a', '#1e3a1b'], ['#7a2a2a', '#4e1a1a'], ['#2c4a85', '#1c3058']],
      cap: [['#8a7a52', '#5e5236'], ['#6b7a45', '#46532c']],
    },
    top: 'jacket', bottom: 'trousers', bottomColors: ['#a08a5a', '#8e7a4e'], extra: ['none', 'none', 'none', 'radio'],
  };
  /** A soldier's look, by its agent's id: the kit's look in the outfit; codex agents are marked, for their stripe. */
  const lookOf = a => ({ ...lookFor(a, OUTFIT), codex: a?.kind === 'codex' });

  const K = '#2a1d14', SLATE = '#5f6b7a';
  // The codex stripe's columns in each view, painted only over the jacket (C and c), so it runs down the jacket's
  // middle, front and back, and down its side clear of a radio: rows 9–11 (the belt below keeps its buckle).
  const STRIPE = { down: [6, 7], up: [6, 7], right: [6], left: [7] };
  const striped = new Map();
  /**
   * A soldier's sprite, a 14 × 16 canvas: the people kit's (`opts` as its sprite's: view, legs, wave, palette).
   * A codex soldier's is the kit's with a slate stripe down the jacket, made once for each look, colour and pose.
   * A colour that isn't one (none at all): slate, rather than a throw.
   */
  function soldierSprite(look, color, opts = {}) {
    const shirt = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : SLATE;
    const base = personSprite(look, shirt, opts);
    if (!look?.codex) return base;
    const { view = 'down', legs = 's' } = opts;
    const key = JSON.stringify([look, shirt, view, legs, Boolean(opts.wave), opts.palette ?? null]);
    if (striped.has(key)) return striped.get(key);
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const g = c.getContext('2d');
    g.drawImage(base, 0, 0);
    g.fillStyle = SLATE;
    const cols = STRIPE[view] ?? STRIPE.down;
    personRows(look, view, legs).forEach((r, y) => { for (const x of cols) if (r[x] === 'C' || r[x] === 'c') g.fillRect(x, y, 1, 1); });
    striped.set(key, c);
    return c;
  }
  /** Its eyes, as the farm draws its farmers': shut while idle or asleep on a cot (and now and then, a blink), two dots wide while waiting on you, a grin on your turn, looking down at its work. */
  function eyes(f, b, rp, view) {
    if (view === 'left' || view === 'right') { rp(view === 'right' ? 9 : 4, 6, 1, 1, K); return; }
    const ex = 5, blinking = ((PXG.T + (f.color ?? 0) * 0.37) % 3.7) < 0.12; // each soldier on its own beat
    if (((f.state === 'idle' || b.zone === 'nap') && !b.walk) || blinking) { rp(ex, 6, 1, 1, '#8a5a3a'); rp(ex + 3, 6, 1, 1, '#8a5a3a'); return; } // shut
    const ey = f.state === 'working' && !b.walk ? 7 : 6;
    if (f.state === 'turn' && !b.walk) { rp(ex - 1, ey, 2, 1, K); rp(ex + 3, ey, 2, 1, K); rp(ex + 1, 7, 2, 1, '#b5562f'); return; }
    const h = f.state === 'waiting' ? 2 : 1;
    rp(ex, ey, 1, h, K); rp(ex + 3, ey, 1, h, K);
  }

  /* ---------- the base: the sky over a clipped hedge, the buildings at the back, the track, the left side, the positions' grid ---------- */

  // A bright, friendly army base on manoeuvres, seen from the front and above, 400 wide like the farm and the
  // factory, growing down with the positions' rows:
  // - the back (y 0–64): the sky by your clock over a clipped hedge, flagpoles with bunting in the agents' colours,
  //   and in front, left to right: the motor pool gate, the drone pad, the alert board, the HQ tent, the briefing
  //   board, the fuel depot and the quartermaster's depot;
  // - the track (y 74–92) in front of them, where soldiers queue at HQ;
  // - the positions in the engine's grid (the farm's and the factory's numbers), inside the range's rope;
  // - the left side (x 4–110): the mess tent, the reserve tents, the drill ground, the cots, the vehicle park;
  // - along the bottom, the edge of the exercise field (a low hedge and a fence), then plain grass: the Menu's
  //   bottom row may lie over that, never over a drawing (the factory learnt this).
  const W = 400, COLW = 88, ROWH = 62, TRACK = { y0: 74, y1: 92 }, TRACK_Y = 80, GATE = [62, TRACK_Y];
  const SKY_Y = 18; // the sky, down to the hedge's clipped top: painted each frame (weather), so nothing drawn once rises into it
  const QUEUE = { from: 150, to: 250, step: 20, cap: 3 }; // HQ's two queues on the track: waiting from its left, reporting back from its right
  const CORR = [116, 218, 306]; // the paths running down: the left side's, then the aisles between the positions' columns
  const EDGE = { top: 8, bottom: 22, plain: 22 }; // the exercise field's edge, from 8 to 22 px below the grid; then plain grass
  const MILITARY_GRID = makeGrid({
    cols: 3, colW: COLW, rowH: ROWH, cx0: 174, top0: 100,
    slot: (cx, rowTop) => ({ lane: rowTop + 44 }), // where its soldiers stand
    fence: rows => ({ x0: 128, x1: 396, y0: 96, y1: 104 + rows * ROWH }), height: fence => fence.y1 + EDGE.bottom + EDGE.plain,
  });
  // The fuel depots (24 wide): the first account's where it always stands; a second account's left of the motor pool gate.
  const DEPOT_X = [286, 4];
  /** A fuel depot's click box, from its left. */
  const depotBox = x => ['bank', x, 20, x + 24, 78];
  /**
   * The buildings and their click boxes, [key, x0, y0, x1, y1]. The engine opens two itself: the motor pool gate
   * ('barn': it starts or resumes a session) and the briefing board ('board': CLAUDE.md and memory); the rest open
   * dialog(key). The alert board between the drone pad and HQ is none: it only shows the level.
   */
  const BUILDINGS = [
    ['barn', 30, 22, 90, 78], // the motor pool gate: reinforcements come in by truck
    ['drones', 96, 40, 126, 78], // the drone pad: subagents
    ['desk', 140, 26, 260, 76], // the HQ tent: who is waiting on you
    ['board', 262, 28, 278, 78], // the briefing board
    depotBox(DEPOT_X[0]), // the fuel depot: your plan
    ['dock', 320, 22, 394, 78], // the quartermaster's depot: pull requests
  ];
  // The flagpoles, standing behind the buildings with their tops against the sky, and HQ's own on its ridge, for
  // its red pennant. Bunting runs from pole to pole.
  const POLES = [20, 93, 281, 315, 396], HQ_POLE = 200, POLE_TOP = 4, POLE_FOOT = 72, HQ_RIDGE = 26;
  // The left side's places, each a soldier's feet: idle at the mess tent's table (behind it), stale on crates before the
  // reserve tents, working outside any repo on the drill ground (two ranks, the front one first), asleep on the cots;
  // and the vehicle park, where each MCP server's jeep waits.
  const MESS = [0, 1, 2, 3].map(i => [22 + 24 * i, 132]);
  const RESERVE = [0, 1, 2, 3].map(i => [18 + 24 * i, 172]);
  const DRILL = [[34, 222], [82, 222], [34, 200], [82, 200]];
  const COTS = [[30, 256], [78, 256]];
  const PARK = [0, 1, 2, 3, 4, 5].map(i => [14 + 16 * i, 288]);
  // What the left side is drawn in, each its box: its drawing keeps to it (and the mascots will keep off it). A box
  // with dx, dy goes round a place's feet; one with x, y stands where it is.
  const MESS_BOX = { x: 4, y: 98, w: 106, h: 40 }; // the mess tent's fly, its poles, its table and their shadows
  const RESERVE_BOX = { x: 6, y: 140, w: 98, h: 35 }; // the two reserve tents, their guy ropes, the crates before them
  const DRILL_BOX = { x: 10, y: 184, w: 96, h: 44 }; // the drill ground's sand
  const COT_BOX = { dx: -8, dy: -18, w: 17, h: 23 }; // a cot round its sleeper's feet: its pillow end to its legs' shadow
  const CLOCK = [54, 236]; // the little clock over the cots: its post's top
  const PARK_BOX = { x: 4, y: 274, w: 106, h: 20 }; // the vehicle park's gravel
  // Colours: sunny grass, a sandy track, khaki canvas, olive paint, white poles and a cream rope.
  const GRASS = '#6aa84f', MOWN = '#7fbf5a', SHADE = '#5d9b46', PATCH = ['#9ed36a', '#c6e89a', '#6cc04a'], SAND = '#dcc08a', SAND_EDGE = '#c9a46a', PEBBLE = '#b08850';
  const HEDGE = ['#264a2a', '#2f6b2f', '#3f9b3a', '#6cc04a']; // its foot in shade, its face, its leaves, its clipped top in the sun
  const CANVAS = '#d4c294', CANVAS_LIGHT = '#e8d8b0', CANVAS_SHADE = '#c9a46a', CANVAS_DARK = '#b08850', INSIDE = '#8a7140';
  const OLIVE = ['#2f5a2a', '#6b7a35', '#8a8f3a']; // shade, paint, its light
  const WOOD = ['#4e3626', '#6b4320', '#8b5a2b', '#a8703c', '#c98d4f', '#e2b07a'];
  const RED = '#e04a3a', RED_LIGHT = '#ff6b6b', RED_DARK = '#b23a2e', ROPE = '#f4ecd8', POLE = '#e6eef5', POLE_SIDE = '#9aa4ad', STEEL = '#5f6b7a', DARK = '#3a3a40';
  /** 0–1023 for a spot, well mixed, the same every build (the factory's: leaves and pebbles without stripes). */
  const noise = (x, y) => {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x9e37, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) & 1023;
  };
  /** A project's positions in runs side by side, row by row: [[row, [columns]]] (the farm's). Another repo's position between them splits a run. */
  function rowsOfGroup(g) {
    const runs = [];
    for (const i of [...g.slots].sort((a, b) => a - b)) {
      const last = runs.at(-1), r = Math.floor(i / 3), c = i % 3;
      if (last && last[0] === r && last[1].at(-1) === c - 1) last[1].push(c); else runs.push([r, [c]]);
    }
    return runs;
  }

  // Shapes. f paints a rectangle (the ground's painter, or px each frame); the light comes from the top left.
  /** A line of single pixels from (x0, y0) to (x1, y1): a guy rope, a stay. */
  function line(f, x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) f(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1, c);
  }
  /** A clipped hedge across the ground, its flat top at y, h tall: lit along the top, its foot in shade, leaves here and there, its shadow on the grass. */
  function hedge(f, x0, x1, y, h) {
    const [foot, face, leaf, top] = HEDGE, w = x1 - x0;
    f(x0, y, w, h, face); f(x0, y, w, 2, leaf); f(x0, y, w, 1, top); f(x0, y + h - 1, w, 1, foot); f(x0, y + h, w, 1, SHADE);
    for (let yy = y + 3; yy < y + h - 2; yy += 2) for (let x = Math.floor(x0 / 3) * 3 + (yy % 4 ? 1 : 0); x < x1; x += 3) {
      const n = noise(x, yy) % 6;
      if (n === 0) f(x, yy, 1, 1, leaf); else if (n === 1) f(x, yy, 1, 1, foot);
    }
  }
  /** The sandy track across the ground: its edges, tyre ruts, a pebble here and there. */
  function track(f, x0, x1) {
    const { y0, y1 } = TRACK;
    f(x0, y0, x1 - x0, y1 - y0, SAND); f(x0, y0, x1 - x0, 1, SAND_EDGE); f(x0, y1 - 1, x1 - x0, 1, SAND_EDGE);
    for (let x = Math.floor(x0 / 8) * 8; x < x1; x += 8) {
      if (noise(x, 77) % 3) f(x, 77, 5, 1, SAND_EDGE);
      if (noise(x, 88) % 3) f(x + 2, 88, 5, 1, SAND_EDGE);
      if (noise(x, 85) % 5 === 0) f(x + 5, 85, 1, 1, PEBBLE);
    }
  }
  /** A white post of the range's rope, a red cap on it, its foot at (x, y + 1): the rope runs through its middle. */
  function ropePost(f, x, y) { f(x + 2, y - 1, 1, 3, SHADE); f(x, y - 2, 2, 4, POLE); f(x, y - 3, 2, 1, RED); }
  /** The range's rope, `len` long from (x, y), across or down, on a post at each end and one every 12 px. */
  function ropeRun(f, x, y, len, across) {
    if (len <= 0) return;
    for (let d = 0; d < len; d += 12) ropePost(f, across ? x + d : x, across ? y : y + d);
    ropePost(f, across ? x + len - 2 : x, across ? y : y + len - 1);
    if (across) f(x, y, len, 1, ROPE); else f(x, y, 1, len, ROPE);
  }
  /** Where a line from a to b runs, between its gaps ([from, to) each): [from, to) runs. */
  function between(a, b, gaps) {
    const out = [];
    let s = a;
    for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > s) out.push([s, Math.min(g0, b)]); s = Math.max(s, g1); }
    if (s < b) out.push([s, b]);
    return out;
  }
  /**
   * The range's rope round the positions, one pixel inside the grid's fence, with gaps where the paths come in: from
   * the track down the aisles, and from the left side's path along each row's lane.
   */
  function rangeRope(f, L) {
    const G = L.GRID, lanes = [...new Set(L.slots.map(s => s.lane))], x0 = G.x0 + 1, x1 = G.x1 - 2, y0 = G.y0 + 1, y1 = G.y1 - 2;
    for (const [a, b] of between(x0, x1 + 1, CORR.slice(1).map(c => [c - 6, c + 6]))) ropeRun(f, a, y0, b - a, true);
    ropeRun(f, x0, y1, x1 - x0 + 1, true);
    for (const [a, b] of between(y0, y1, lanes.map(l => [l - 7, l + 3]))) ropeRun(f, x0, a, b - a, false);
    ropeRun(f, x1, y0, y1 - y0, false);
  }
  /** A flagpole's foot and shaft, from the hedge's top down to its foot behind the buildings (its top, against the sky, is drawn each frame). */
  function poleShaft(f, x, y1) { f(x, SKY_Y, 1, y1 - SKY_Y, POLE); f(x + 1, SKY_Y, 1, y1 - SKY_Y, POLE_SIDE); f(x - 1, y1, 4, 2, STEEL); }

  /** An army truck, side on, facing right, its top left at (x, y), 44 × 29: a khaki canvas over its bed, an olive cab with a white star on its door. */
  function truck(f, x, y) {
    const [shade, paint, light] = OLIVE;
    f(x + 1, y, 26, 1, CANVAS_DARK); f(x, y + 1, 28, 14, CANVAS); f(x, y + 1, 28, 2, CANVAS_LIGHT); for (const rx of [x + 7, x + 14, x + 21]) f(rx, y + 3, 1, 12, CANVAS_SHADE); // the canvas, its hoops
    f(x, y + 15, 28, 5, paint); f(x, y + 15, 28, 1, light); f(x, y + 19, 28, 1, shade); // the bed's side
    f(x + 29, y + 4, 10, 16, paint); f(x + 29, y + 4, 10, 1, light); f(x + 29, y + 4, 1, 16, shade); // the cab
    f(x + 32, y + 6, 6, 5, '#a9dcf7'); f(x + 32, y + 6, 2, 1, '#ffffff'); // its window
    f(x + 34, y + 12, 1, 1, '#ffffff'); f(x + 32, y + 13, 5, 1, '#ffffff'); f(x + 33, y + 14, 3, 1, '#ffffff'); f(x + 33, y + 15, 1, 1, '#ffffff'); f(x + 35, y + 15, 1, 1, '#ffffff'); // a white star
    f(x + 39, y + 10, 5, 10, paint); f(x + 39, y + 10, 5, 1, light); f(x + 43, y + 13, 1, 6, DARK); f(x + 43, y + 11, 1, 2, '#ffe8a3'); // its bonnet, grille and headlight
    f(x, y + 20, 44, 2, DARK); // the chassis
    for (const wx of [x + 6, x + 19, x + 35]) { f(wx - 3, y + 21, 7, 7, '#2a1d14'); f(wx - 2, y + 22, 5, 5, DARK); f(wx - 1, y + 23, 3, 3, '#8a8f96'); } // wheels
    f(x + 1, y + 28, 44, 1, SAND_EDGE); // its shadow
  }
  /** The motor pool gate: a sandy yard with an army truck parked in it, white gate posts banded red, a board across them for its sign; the barrier's post (its arm lifts: drawn each frame). */
  function motorPool(f) {
    f(34, 30, 52, 44, SAND); f(34, 30, 52, 1, SAND_EDGE); // the yard, out to the track
    truck(f, 38, 33);
    for (const x of [30, 86]) { f(x, 28, 4, 46, POLE); for (let y = 32; y < 72; y += 8) f(x, y, 4, 4, RED); f(x + 3, 28, 1, 46, '#c3cbd2'); f(x, 72, 4, 2, STEEL); } // the posts
    f(30, 22, 60, 6, WOOD[1]); f(31, 23, 58, 4, WOOD[2]); f(31, 23, 58, 1, WOOD[3]); // the board across (its sign is a label)
    f(34, 62, 4, 12, STEEL); f(34, 62, 4, 1, POLE_SIDE); // the barrier's post
    f(84, 64, 2, 3, DARK); // the fork its arm rests in
  }
  /** The drone pad: a raised deck on four legs, a white ring and a yellow H on it, yellow and black stripes round its edge, a light at each corner. */
  function dronePad(f) {
    f(98, 75, 29, 1, SHADE); // its shadow
    for (const x of [98, 108, 114, 124]) { f(x, 54, 2, 21, STEEL); f(x, 54, 1, 21, '#8a8f96'); } // its legs
    line(f, 100, 58, 107, 70, '#8a8f96'); line(f, 107, 58, 100, 70, '#8a8f96'); line(f, 116, 58, 123, 70, '#8a8f96'); line(f, 123, 58, 116, 70, '#8a8f96'); // stays
    f(96, 42, 30, 10, DARK); f(97, 43, 28, 8, STEEL); // the deck
    f(107, 43, 9, 1, '#ffffff'); f(104, 44, 3, 1, '#ffffff'); f(116, 44, 3, 1, '#ffffff'); f(103, 45, 1, 3, '#ffffff'); f(119, 45, 1, 3, '#ffffff'); f(104, 48, 3, 1, '#ffffff'); f(116, 48, 3, 1, '#ffffff'); f(107, 49, 9, 1, '#ffffff'); // the ring
    f(108, 44, 1, 5, '#ffd43b'); f(114, 44, 1, 5, '#ffd43b'); f(109, 46, 5, 1, '#ffd43b'); // the H
    for (let x = 96; x < 126; x++) f(x, 52, 1, 2, (x >> 1) % 2 ? '#2a1d14' : '#ffd43b'); // its edge
    f(96, 41, 2, 1, '#6cc04a'); f(124, 41, 2, 1, RED); // its corner lights
  }
  /** The alert board's post and its board (blank here: the alert level shows on it each frame), a housing on top for its beacon. */
  function alertBoard(f) {
    f(132, 37, 3, 37, WOOD[2]); f(132, 37, 1, 37, WOOD[3]); f(131, 73, 5, 2, WOOD[1]); // the post
    f(128, 24, 11, 13, DARK); f(129, 25, 9, 11, '#c3cbd2'); // the board
    f(131, 21, 5, 3, STEEL); f(132, 21, 3, 1, '#8a8f96'); // the beacon's housing
  }
  /**
   * The HQ tent: a big khaki marquee, its roof ridged across with a red valance, its front open between flaps tied
   * back: inside, a map table, a lamp hanging over it, a field telephone. Guy ropes at its ends. Soldiers queue on the
   * track in front; its pennant pole stands on its ridge (drawn each frame above it: the pennant goes up and down).
   */
  function hqTent(f) {
    for (let j = 0; j < 16; j++) { const inset = Math.round((15 - j) * 0.55); f(140 + inset, HQ_RIDGE + j, 120 - 2 * inset, 1, j < 2 ? CANVAS_LIGHT : CANVAS); } // the roof
    for (let x = 160; x < 260; x += 20) f(x, HQ_RIDGE + 2, 1, 14, CANVAS_SHADE); // its seams
    f(140, 42, 120, 2, RED_DARK); for (let x = 140; x < 260; x += 8) { f(x + 1, 44, 6, 1, RED_DARK); f(x + 2, 45, 4, 1, RED_DARK); } // the valance
    f(141, 44, 118, 30, CANVAS); f(141, 44, 1, 30, CANVAS_LIGHT); f(258, 44, 1, 30, CANVAS_SHADE); f(141, 73, 118, 1, CANVAS_SHADE); // the walls
    for (const x of [160, 240]) f(x, 46, 1, 27, CANVAS_SHADE);
    for (const x of [146, 238]) { f(x, 50, 16, 10, CANVAS_DARK); f(x + 1, 51, 14, 8, '#a9dcf7'); f(x + 8, 51, 1, 8, CANVAS_DARK); f(x + 1, 55, 14, 1, CANVAS_DARK); f(x + 1, 51, 3, 1, '#ffffff'); } // its windows
    f(176, 46, 48, 28, INSIDE); f(176, 46, 48, 2, CANVAS_DARK); // the way in, the inside in the shade
    for (let j = 0; j < 12; j++) { f(176, 46 + j, 11 - j, 1, CANVAS_SHADE); f(213 + j, 46 + j, 11 - j, 1, CANVAS_SHADE); } // the flaps, tied back
    f(177, 57, 3, 2, RED_DARK); f(220, 57, 3, 2, RED_DARK); // their ties
    f(HQ_POLE, 46, 1, 5, DARK); f(198, 51, 5, 1, DARK); f(198, 52, 5, 4, '#ffd43b'); f(199, 53, 3, 2, '#ffe8a3'); f(198, 56, 5, 1, DARK); // the lamp
    f(184, 60, 32, 4, WOOD[2]); f(184, 60, 32, 1, WOOD[4]); f(186, 64, 2, 10, WOOD[1]); f(212, 64, 2, 10, WOOD[1]); // the table
    f(187, 58, 24, 3, '#f4ecd8'); f(189, 58, 7, 2, '#9ed36a'); f(197, 59, 8, 1, '#5ab4ff'); f(205, 58, 4, 2, '#9ed36a'); f(192, 58, 1, 1, RED); f(203, 59, 1, 1, RED); // the map, pinned
    f(209, 55, 5, 1, DARK); f(209, 56, 5, 3, OLIVE[1]); // a field telephone
    line(f, 140, 44, 137, 73, ROPE); f(136, 73, 2, 1, WOOD[1]); line(f, 259, 44, 261, 73, ROPE); f(261, 73, 2, 1, WOOD[1]); // guy ropes, pegged
    f(HQ_POLE, SKY_Y, 1, HQ_RIDGE - SKY_Y, POLE); // the pennant pole's foot (the rest stands against the sky)
  }
  /** The briefing board: a cork board on two legs under a little roof, orders, a memo and a map pinned to it. */
  function briefingBoard(f) {
    f(264, 76, 15, 1, SHADE);
    f(263, 46, 2, 30, WOOD[1]); f(275, 46, 2, 30, WOOD[1]); // its legs
    f(261, 28, 18, 2, WOOD[1]); f(262, 28, 16, 1, WOOD[3]); // its roof
    f(262, 30, 16, 17, WOOD[1]); f(263, 31, 14, 15, WOOD[4]); // the cork
    f(264, 32, 5, 6, '#f4ecd8'); f(265, 34, 3, 1, POLE_SIDE); f(265, 36, 2, 1, POLE_SIDE); // orders
    f(270, 32, 6, 5, '#ffffff'); f(271, 34, 4, 1, POLE_SIDE); // a memo
    f(265, 39, 9, 6, '#9ed36a'); f(266, 41, 7, 1, '#5ab4ff'); f(269, 39, 1, 6, SAND_EDGE); // a map
    for (const [x, y] of [[266, 32], [272, 32], [269, 39]]) f(x, y, 1, 1, RED); // pins
  }
  /** A fuel depot, its left at x: a shelter with a tin roof, a lamp and a fuel sign under it, two shelves for its drums (the weekly limit fills them: drawn each frame). */
  function fuelDepot(f, x = DEPOT_X[0]) {
    f(x + 1, 76, 25, 1, SHADE);
    f(x, 25, 24, 50, INSIDE); f(x, 25, 2, 50, WOOD[2]); f(x + 22, 25, 2, 50, WOOD[2]); // its back and posts
    f(x - 1, 20, 26, 4, POLE_SIDE); for (let i = x; i < x + 25; i += 3) f(i, 20, 1, 4, '#c3cbd2'); f(x - 1, 24, 26, 1, STEEL); // the tin roof
    f(x + 9, 25, 6, 3, DARK); f(x + 10, 26, 4, 1, STEEL); // its lamp
    f(x + 5, 29, 14, 7, '#ffd43b'); f(x + 5, 29, 14, 1, '#ffe8a3'); f(x + 11, 30, 2, 2, RED); f(x + 10, 32, 4, 3, RED); // the fuel sign: a red drop on yellow
    f(x + 2, 52, 20, 2, WOOD[3]); f(x + 2, 72, 20, 2, WOOD[3]); // its shelves
    f(x, 74, 3, 2, DARK); f(x + 21, 74, 3, 2, DARK);
  }
  // The stores on the quartermaster's shelves, [x, w, h, colour]: boxes, tins, sacks, a crate of rations.
  const STORES = [[333, 5, 5, WOOD[4]], [339, 4, 4, WOOD[2]], [344, 6, 5, WOOD[4]], [351, 4, 3, POLE_SIDE], [356, 5, 4, CANVAS_LIGHT], [362, 6, 5, OLIVE[1]], [369, 4, 4, WOOD[2]], [374, 6, 5, WOOD[4]]];
  /** The quartermaster's depot: a supply tent, its front rolled up over a counter, shelves of stores inside; a pallet in front, where a crate stands for each open pull request (drawn each frame). */
  function quartermaster(f) {
    for (let j = 0; j < 12; j++) { const inset = Math.round((11 - j) * 0.4); f(320 + inset, 22 + j, 74 - 2 * inset, 1, j < 2 ? CANVAS_LIGHT : CANVAS); } // the roof
    for (let x = 338; x < 390; x += 18) f(x, 24, 1, 10, CANVAS_SHADE);
    f(320, 34, 74, 2, OLIVE[1]); for (let x = 320; x < 394; x += 8) f(x + 1, 36, 6, 1, OLIVE[1]); // its valance
    f(321, 36, 72, 38, CANVAS); f(321, 36, 1, 38, CANVAS_LIGHT); f(392, 36, 1, 38, CANVAS_SHADE); f(321, 73, 72, 1, CANVAS_SHADE); // the walls
    f(330, 39, 54, 25, INSIDE); f(330, 37, 54, 3, CANVAS_SHADE); f(330, 37, 54, 1, CANVAS_LIGHT); // the front, rolled up
    for (const [y, k] of [[47, 0], [56, 3]]) { // two shelves of stores
      f(331, y, 52, 1, WOOD[3]);
      for (const [sx, w, h, c] of STORES) { const x = sx + ((k * 3) % 5); if (x + w < 383) { f(x, y - h, w, h, c); f(x, y - h, w, 1, '#ffffff'); } }
    }
    f(327, 62, 60, 3, WOOD[3]); f(327, 62, 60, 1, WOOD[5]); f(329, 65, 2, 8, WOOD[1]); f(383, 65, 2, 8, WOOD[1]); // the counter
    f(333, 71, 39, 2, WOOD[4]); for (let x = 335; x < 372; x += 6) f(x, 72, 2, 1, WOOD[1]); f(333, 73, 39, 1, WOOD[1]); // the pallet
    line(f, 321, 37, 318, 73, ROPE); line(f, 392, 37, 394, 73, ROPE); // guy ropes
  }

  /** The mess tent: a khaki fly on poles over the trestle table (drawn among the soldiers: items), its front edge scalloped, guy ropes at its ends, shade under it. */
  function messTent(f) {
    const { x, y, w } = MESS_BOX;
    f(x + 3, y + 12, w - 6, 26, SHADE); // the shade under it
    for (const px0 of [x + 3, x + 52, x + w - 5]) { f(px0, y + 9, 2, 29, WOOD[2]); f(px0, y + 9, 1, 29, WOOD[3]); } // its poles
    f(x + 6, y, w - 12, 2, CANVAS_LIGHT); f(x + 2, y + 2, w - 4, 8, CANVAS); f(x + 2, y + 2, w - 4, 1, CANVAS_LIGHT); // its ridge, its fly
    for (let sx = x + 15; sx < x + w - 4; sx += 13) f(sx, y + 2, 1, 8, CANVAS_SHADE); // its seams
    for (let sx = x + 2; sx < x + w - 3; sx += 6) { f(sx + 1, y + 10, 4, 1, CANVAS); f(sx + 2, y + 11, 2, 1, CANVAS); } // its scallops
    line(f, x + 2, y + 6, x, y + 18, ROPE); line(f, x + w - 3, y + 6, x + w - 1, y + 18, ROPE); // guy ropes
  }
  /** The mess table, drawn among the soldiers just in front of the idle ones (they stand behind it): a trestle table, a plate of stew and a mug at each place, the pot. */
  function messTable() {
    const y = MESS[0][1], x0 = 10, x1 = 106; // the soldiers' feet behind it
    px(x0 + 2, y + 3, x1 - x0, 1, SHADE); // its shadow
    px(x0 + 3, y - 3, 2, 6, WOOD[1]); px(x1 - 5, y - 3, 2, 6, WOOD[1]); // its trestles
    px(x0, y - 6, x1 - x0, 4, WOOD[2]); px(x0, y - 6, x1 - x0, 1, WOOD[5]); px(x0, y - 5, x1 - x0, 1, WOOD[4]); px(x0, y - 3, x1 - x0, 1, WOOD[1]); // its top
    for (const [mx] of MESS) { px(mx - 5, y - 7, 5, 1, '#c3cbd2'); px(mx - 4, y - 8, 3, 1, '#c8681a'); px(mx + 2, y - 9, 2, 3, '#3d7be0'); px(mx + 2, y - 9, 2, 1, '#5ab4ff'); } // a plate and a mug
    px(55, y - 11, 7, 5, DARK); px(56, y - 12, 5, 1, STEEL); px(56, y - 10, 5, 1, '#8a8f96'); // the pot
  }
  /** A pup tent, its apex at (cx, y), 22 tall and 44 wide at its foot: khaki, lit on its left, its door open, guy ropes to pegs. */
  function pupTent(f, cx, y) {
    f(cx - 22, y + 22, 45, 1, SHADE); // its shadow
    for (let j = 0; j < 22; j++) { f(cx - j, y + j, j + 1, 1, CANVAS); f(cx + 1, y + j, j, 1, CANVAS_SHADE); f(cx - j, y + j, 1, 1, CANVAS_LIGHT); } // its two sides
    for (let j = 8; j < 22; j++) { const half = (j - 8) >> 1; f(cx - half - 1, y + j, 1, 1, CANVAS_LIGHT); f(cx - half, y + j, 2 * half + 1, 1, INSIDE); } // its door, open
    f(cx, y - 2, 1, 2, WOOD[2]); // its pole's tip
    line(f, cx - 17, y + 17, cx - 21, y + 21, ROPE); line(f, cx + 17, y + 17, cx + 21, y + 21, ROPE); // guy ropes
  }
  /** A crate a soldier in reserve sits on, drawn among the soldiers just in front of it. */
  function seatCrate(x, y) {
    px(x - 6, y + 2, 13, 1, SHADE);
    px(x - 6, y - 4, 12, 6, WOOD[1]); px(x - 5, y - 4, 10, 5, WOOD[4]); px(x - 5, y - 4, 10, 1, WOOD[5]); px(x - 5, y - 2, 10, 1, WOOD[3]);
  }
  /** The drill ground: packed sand edged darker, boot prints, a white mark where each soldier stands in its rank, a marker flag at a corner. */
  function drillGround(f) {
    const { x, y, w, h } = DRILL_BOX;
    f(x, y, w, h, SAND); f(x, y, w, 1, SAND_EDGE); f(x, y + h - 1, w, 1, SAND_EDGE); f(x, y, 1, h, SAND_EDGE); f(x + w - 1, y, 1, h, SAND_EDGE);
    for (let yy = y + 3; yy < y + h - 2; yy += 4) for (let xx = x + 3; xx < x + w - 3; xx += 6) if (noise(xx, yy) % 4 === 0) { f(xx, yy, 1, 1, SAND_EDGE); f(xx + 2, yy + 1, 1, 1, SAND_EDGE); } // boot prints
    for (const [mx, my] of DRILL) f(mx - 4, my + 1, 9, 1, ROPE); // the marks
    f(x + w - 6, y + 2, 1, 9, WOOD[2]); f(x + w - 5, y + 2, 4, 3, RED); f(x + w - 5, y + 3, 4, 1, RED_LIGHT); // a marker flag
  }
  /** A camp cot for a sleeper at (x, y): its pillow at the back, olive canvas on a frame, legs; its blanket goes over the sleeper (items). */
  function cot(f, x, y) {
    const { dy, h } = COT_BOX, top = y + dy;
    f(x - 7, top + h - 1, 16, 1, SHADE);
    f(x - 8, top + 1, 2, h - 3, WOOD[2]); f(x + 7, top + 1, 2, h - 3, WOOD[2]); // its rails
    f(x - 6, top + 1, 13, h - 4, OLIVE[1]); f(x - 6, top + 1, 13, 1, OLIVE[2]); // its canvas
    f(x - 8, top + h - 3, 2, 2, WOOD[1]); f(x + 7, top + h - 3, 2, 2, WOOD[1]); // its legs
    f(x - 5, top + 2, 11, 5, ROPE); f(x - 5, top + 6, 11, 1, CANVAS_LIGHT); // its pillow
  }
  /** A cot's blanket, drawn among the soldiers just in front of its sleeper: over it from the shoulders down (over the bare cot when no one sleeps there). */
  function blanket(x, y) {
    px(x - 6, y - 8, 13, 10, OLIVE[2]); px(x - 6, y - 8, 13, 2, ROPE); px(x - 6, y - 3, 13, 1, OLIVE[1]); px(x + 6, y - 6, 1, 8, OLIVE[1]);
  }
  /** The little clock on its post over the cots: a round white dial, its hands at ten past ten. */
  function cotClock(f, [x, y]) {
    f(x, y, 2, 24, WOOD[2]); f(x, y, 1, 24, WOOD[3]);
    f(x - 3, y - 7, 8, 7, DARK); f(x - 2, y - 8, 6, 9, DARK); f(x - 2, y - 6, 6, 5, '#ffffff'); f(x - 1, y - 7, 4, 7, '#ffffff');
    f(x, y - 6, 1, 3, DARK); f(x + 1, y - 4, 2, 1, RED);
  }
  /** The vehicle park: gravel, white corner marks round each place where an MCP server's jeep waits. */
  function vehiclePark(f) {
    const { x, y, w, h } = PARK_BOX;
    f(x, y, w, h, '#c3cbd2'); f(x, y, w, 1, POLE_SIDE); f(x, y + h - 1, w, 1, POLE_SIDE); f(x + 1, y + h, w, 1, SHADE);
    for (let yy = y + 2; yy < y + h - 1; yy += 3) for (let xx = x + 1 + (yy % 2); xx < x + w - 1; xx += 4) if (noise(xx, yy) % 3 === 0) f(xx, yy, 1, 1, POLE_SIDE); // gravel
    for (const [cx, cy] of PARK) for (const [px0, sx] of [[cx - 7, 1], [cx + 6, -1]]) { f(px0, cy - 11, 1, 3, '#ffffff'); f(Math.min(px0, px0 + sx * 2), cy - 11, 3, 1, '#ffffff'); f(px0, cy - 1, 1, 2, '#ffffff'); f(Math.min(px0, px0 + sx * 2), cy + 1, 3, 1, '#ffffff'); }
  }
  /** The edge of the exercise field, along the bottom: a low hedge with a post-and-rail fence before it. */
  function fieldEdge(f, x0, x1, y) {
    hedge(f, x0, x1, y, 8);
    for (let x = Math.floor(x0 / 16) * 16; x < x1; x += 16) { f(x, y + 4, 2, 10, WOOD[2]); f(x, y + 4, 1, 10, WOOD[3]); }
    f(x0, y + 7, x1 - x0, 1, WOOD[3]); f(x0, y + 11, x1 - x0, 1, WOOD[3]); f(x0, y + 12, x1 - x0, 1, WOOD[1]);
    f(x0, y + 14, x1 - x0, 1, SHADE);
  }

  /**
   * The ground, drawn once (again when the positions change or the frame grows): everything that doesn't move. `ext`
   * is the ground to cover; the grass, the hedge and the track go on past the world's edges.
   */
  function drawBase(f, L, ext) {
    const { x0, x1, y0, y1 } = ext, G = L.GRID, w = x1 - x0;
    f(x0, y0, w, SKY_Y - y0, '#a9dcf7'); // the sky's place (weather paints the sky of the hour over it)
    f(x0, SKY_Y, w, y1 - SKY_Y, GRASS); // sunny grass, mown in stripes
    for (let x = Math.floor(x0 / 32) * 32; x < x1; x += 32) f(x, SKY_Y, 16, y1 - SKY_Y, MOWN);
    hedge(f, x0, x1, SKY_Y, 12);
    for (const x of POLES) poleShaft(f, x, POLE_FOOT);
    track(f, x0, x1);
    // a project's positions: a mown patch round them, striped (its sign is a label)
    for (const g of L.groups) for (const [r, cols] of rowsOfGroup(g)) {
      const top = 100 + r * ROWH, gx0 = 174 + Math.min(...cols) * COLW - 43, gx1 = 174 + Math.max(...cols) * COLW + 43;
      f(gx0, top + 2, gx1 - gx0 + 1, 58, PATCH[0]);
      for (let y = top + 6; y < top + 58; y += 8) f(gx0, y, gx1 - gx0 + 1, 4, PATCH[1]);
      for (let x = gx0; x <= gx1; x += 4) { f(x, top + 2, 2, 1, PATCH[2]); f(x, top + 59, 2, 1, PATCH[2]); }
      for (let y = top + 2; y <= top + 59; y += 4) { f(gx0, y, 1, 2, PATCH[2]); f(gx1, y, 1, 2, PATCH[2]); }
    }
    // the paths down: the left side's, out to the vehicle park, and the aisles between the positions' columns
    f(111, TRACK.y1, 10, G.y1 - TRACK.y1, SAND); f(111, TRACK.y1, 1, G.y1 - TRACK.y1, SAND_EDGE); f(120, TRACK.y1, 1, G.y1 - TRACK.y1, SAND_EDGE);
    for (const c of CORR.slice(1)) f(c - 3, TRACK.y1, 6, G.y1 - TRACK.y1, SAND);
    rangeRope(f, L);
    // the left side
    messTent(f);
    for (const cx of [30, 78]) pupTent(f, cx, RESERVE_BOX.y + 2); // the reserve tents, behind their crates
    drillGround(f);
    for (const [x, y] of COTS) cot(f, x, y);
    cotClock(f, CLOCK);
    vehiclePark(f);
    fieldEdge(f, x0, x1, G.y1 + EDGE.top);
    // the buildings at the back, in front of the hedge and the poles
    motorPool(f); dronePad(f); alertBoard(f); hqTent(f); briefingBoard(f); fuelDepot(f); quartermaster(f);
  }

  // The quartermaster's crates: one for each open pull request across the positions (8 at most), its tag the checks.
  const TAGS = { ok: '#2fa57a', failed: RED, draft: POLE_SIDE, none: CANVAS_LIGHT }; // running: amber, blinking
  /** The crates on the quartermaster's pallet, two rows of four: [{ x, y, tag }], tag ok, failed, running, draft (whatever its checks) or none. */
  function depotCrates(fields) {
    return fields.flatMap(fl => fl.prs?.open ?? []).slice(0, 8).map((pr, i) => ({
      x: 335 + (i % 4) * 9, y: 64 - Math.floor(i / 4) * 7, tag: pr.draft ? 'draft' : ['ok', 'failed', 'running'].includes(pr.checks) ? pr.checks : 'none',
    }));
  }
  /** A supply crate on the pallet, its tag hanging on its front. */
  function supplyCrate({ x, y, tag }) {
    px(x, y, 8, 7, WOOD[1]); px(x + 1, y + 1, 6, 5, WOOD[4]); px(x + 1, y + 1, 6, 1, WOOD[5]); px(x + 1, y + 3, 6, 1, WOOD[3]);
    px(x + 4, y + 2, 3, 3, tag === 'running' ? (blink(2) ? '#f0b429' : '#ffd43b') : TAGS[tag]);
  }
  /** The motor pool's barrier: a red and white arm from its post across the gate, lifted by `lift` (0 down … 1 up). */
  function barrier(lift) {
    const x0 = 36, y0 = 65, a = lift * 1.25;
    for (let i = 0; i < 49; i++) px(Math.round(x0 + Math.cos(a) * i), Math.round(y0 - Math.sin(a) * i), 1, 2, Math.floor(i / 6) % 2 ? '#ffffff' : RED);
    px(x0 - 1, y0 - 1, 3, 3, DARK); // its hinge
  }

  // The sky above the hedge, at each time of day: [high, middle, low].
  const SKIES = { day: ['#3d7be0', '#5ab4ff', '#a9dcf7'], dusk: ['#5a3b85', '#d55181', '#f4b6c2'], night: ['#1b1420', '#2c4a85', '#3d7be0'] };
  /**
   * The sky by your clock (the engine's, which the Sky switch can hold at day or night), down to the hedge, across all
   * the ground shown: blue by day with the sun and clouds going by, rose at dawn and dusk, dark with stars and the moon at night.
   */
  function drawSky(sky) {
    const T = PXG.T, e = PXG.ext ?? { x0: 0, x1: W, y0: 0 }, w = e.x1 - e.x0, top = Math.min(0, e.y0);
    const night = sky.phase === 'night', dusk = sky.phase === 'dawn' || sky.phase === 'dusk', [hi, mid, lo] = night ? SKIES.night : dusk ? SKIES.dusk : SKIES.day;
    px(e.x0, top, w, 6 - top, hi); px(e.x0, 6, w, 6, mid); px(e.x0, 12, w, SKY_Y - 12, lo);
    if (night) for (let i = 0; i < 40; i++) if ((i + Math.floor(T * 0.7 + i * 0.3)) % 5) px(e.x0 + ((i * 53 + 7) % w), 1 + ((i * 17) % 14), 1, 1, i % 3 ? '#ffffff' : '#ffe8a3'); // stars, twinkling
    if (sky.sun) { const x = Math.round(sky.sun.x), y = 2 + Math.round(sky.sun.y); px(x - 2, y - 3, 5, 7, '#ffd43b'); px(x - 3, y - 2, 7, 5, '#ffd43b'); px(x - 1, y - 2, 3, 3, '#ffe8a3'); }
    if (sky.moon) { const x = Math.round(sky.moon.x), y = 2 + Math.round(sky.moon.y); px(x - 2, y - 3, 5, 7, '#e6eef5'); px(x - 3, y - 2, 7, 5, '#e6eef5'); px(x + 1, y - 3, 3, 4, hi); } // a crescent
    if (!night) for (let k = 0; k < 3; k++) { // clouds drifting by
      const x = Math.round(e.x0 + ((T * (1.5 + k * 0.6) + k * 157) % (w + 60)) - 30), y = 3 + k * 4, c = dusk ? '#f4b6c2' : '#ffffff';
      px(x, y + 2, 20, 3, c); px(x + 3, y, 8, 2, c); px(x + 10, y - 1, 7, 3, c); px(x + 1, y + 5, 18, 1, dusk ? '#d55181' : '#e6eef5');
    }
  }
  // The bunting's colours and the flags', with no soldier on the base: a cheerful set.
  const BUNTING = [RED, '#ffd43b', '#3d7be0', '#2fa57a', '#f08a24', '#8a5fc0'];
  /** The agents' colours, each once, for the bunting and the flags; the cheerful set when no one is on the base. */
  const coloursOf = farmers => { const c = [...new Set(farmers.map(f => f.shirt).filter(s => /^#[0-9a-f]{6}$/i.test(s ?? '')))]; return c.length ? c : BUNTING; };
  /** Paints in a colour exactly: the agents' colours, as on their jackets (px would match it to the palette). */
  const exact = (x, y, w, h, c) => { PXG.ctx.fillStyle = c; PXG.ctx.fillRect(x, y, w, h); };
  const BUNT_Y = POLE_TOP + 7; // where the bunting is tied to each pole
  /** Bunting from the pole at a to the pole at b, sagging a little: a cream string, small pennants on it, each in the next colour. */
  function bunting(a, b, colours, k0) {
    const sag = Math.min(4, Math.round((b - a) / 24)), yAt = x => BUNT_Y + Math.round(sag * 4 * ((x - a) / (b - a)) * (1 - (x - a) / (b - a)));
    let s = a + 1;
    for (let x = a + 2; x <= b; x++) if (x === b || yAt(x) !== yAt(s)) { px(s, yAt(s), x - s, 1, ROPE); s = x; } // the string, in runs of one height
    for (let x = a + 4, k = k0; x < b - 3; x += 6, k++) { const y = yAt(x + 1) + 1, c = colours[k % colours.length]; exact(x, y, 3, 1, c); exact(x + 1, y + 1, 1, 1, c); }
  }
  /** A flag at a pole's top, flying out to its right, a ripple running along it. */
  function flag(x, c, T, i) {
    for (let col = 0; col < 8; col++) exact(x + 1 + col, POLE_TOP + 1 + (Math.sin(T * 5 - col * 0.8 + i) > 0.35 ? 1 : 0), 1, 4, c);
  }
  /**
   * What stands against the sky, over it: each flagpole's top with a gilt ball and a flag, bunting from pole to pole (the
   * flags and the bunting in the agents' colours), and HQ's pennant pole on its ridge: its red pennant run up while a
   * soldier waits on you ("awaiting orders"), furled at the pole's foot when no one does.
   */
  function drawSkyline(colours, waiting, T) {
    const anchors = [...POLES, HQ_POLE].sort((a, b) => a - b);
    for (let i = 0; i + 1 < anchors.length; i++) bunting(anchors[i], anchors[i + 1], colours, i * 3);
    for (const x of anchors) { const foot = x === HQ_POLE ? HQ_RIDGE : SKY_Y; px(x, POLE_TOP, 1, foot - POLE_TOP, POLE); px(x + 1, POLE_TOP, 1, foot - POLE_TOP, POLE_SIDE); px(x - 1, POLE_TOP - 2, 3, 2, '#f0b429'); }
    POLES.forEach((x, i) => flag(x, colours[i % colours.length], T, i));
    const x = HQ_POLE + 1;
    if (!waiting) { px(x, SKY_Y + 1, 2, 6, RED_DARK); px(x, SKY_Y + 1, 1, 6, RED); return; } // furled
    const flap = Math.floor(T * 5) % 2;
    px(x, POLE_TOP + 1, 10, 2, RED); px(x, POLE_TOP + 1, 10, 1, RED_LIGHT); px(x, POLE_TOP + 3, 7 + flap, 1, RED); px(x, POLE_TOP + 4, 4, 1, RED_DARK); px(x + 10, POLE_TOP + 1 + flap, 3, 1, RED);
  }

  /* ---------- the props: what a soldier holds for each step (sdk/props.js) ---------- */

  // The props kit's set: each step's prop, what the soldier is doing (its tip and the field log's line), and where
  // it stands at its position (left for looking things up, right for working, the middle for the rest).
  const props = window.Agentville.props.kit();

  /* ---------- the hooks ---------- */

  /** A time of day, short: 14:05. */
  const clock = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  /** When a limit resets, short: Tue 09:00. */
  const resetAt = at => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  /** A limit's % used, from its window: 0 in a new window; null with no window, or one without a number (no reading). */
  const usedOf = w => (!w ? null : w.reset ? 0 : Number.isFinite(w.percentUsed) ? w.percentUsed : null);

  function makeMilitary() {
    let L = MILITARY_GRID.layoutFor([]);
    let scene = { fields: [], farmers: [] };
    let gateLift = 0; // the motor pool's barrier: 0 down … 1 up, while a soldier comes through the gate
    const stOf = k => L.ST.find(s => s.key === k);
    const fieldByKey = k => scene.fields.find(f => f.key === k);
    return {
      key: 'military', W, SH: 16, corridors: CORR, grid: MILITARY_GRID, fromScene: militaryScene, help: helpHtml,
      nouns: { agent: 'soldier', agents: 'soldiers', repo: 'position', repos: 'positions', place: 'base' },
      // The 5-hour limit is the alert level; the setting still saves spring … winter.
      seasonNames: { switch: 'Alert', spring: 'calm', summer: 'ready', autumn: 'high', winter: 'max' },
      coldSeason: null, // max alert is no weather: the mascots never act cold
      boardTitle: 'The briefing board: what your projects remember', // the engine opens it (the 'board' building)
      /** A new scene: kept, for what the base shows of it (the pennant, the crates, the signs). */
      setScene(next) { scene = next; return []; },
      layout: () => L,
      relayout(ground) { L = ground; return L; },
      spawn: () => GATE,
      /**
       * Where each soldier stands: at its position while it works there; on the drill ground while it works outside
       * any repo (or in one with no position left); on a cot while it waits to wake up by itself; at HQ when it needs
       * you (on the left) or reports back (on the right); stale, on a crate by the reserve tents; idle, at the mess
       * tent's table. Each place holds a few; the engine counts the rest, and labels() shows them as "+N".
       */
      slots(f) {
        const s = f.state === 'working' ? stOf(f.field) : null;
        if (s) return { group: `st:${s.key}`, zone: `st:${s.key}:${props.doing(f)?.prop ?? ''}`, at: used => { const off = [props.doing(f)?.spot ?? 0, 0, -26, 26, -13, 13].find(o => !used.includes(o)) ?? 0; used.push(off); return [s.cx + off, s.lane]; } };
        if (f.state === 'working') return { group: 'floor', zone: 'floor', cap: DRILL.length, at: i => DRILL[i] };
        if (f.nap) return { group: 'nap', zone: 'nap', cap: COTS.length, at: i => COTS[i] }; // it wakes up by itself: a cot, not HQ
        if (f.state === 'waiting') return { group: 'desk', zone: 'desk', cap: QUEUE.cap, at: i => [QUEUE.from + QUEUE.step * i, TRACK_Y] }; // the queue at HQ, from its left
        if (f.state === 'turn') return { group: 'turn', zone: 'turn', cap: QUEUE.cap, at: i => [QUEUE.to - QUEUE.step * i, TRACK_Y] }; // reporting back: from its right (full, the two queues still don't touch)
        if (f.state === 'stale') return { group: 'storage', zone: 'storage', cap: RESERVE.length, at: i => RESERVE[i] };
        return { group: 'charge', zone: 'charge', cap: MESS.length, at: i => MESS[i] };
      },
      startText: n => `Muster: <b>${n}</b> soldier${n === 1 ? '' : 's'} on the base`,
      arriveText: 'jumps down from the truck',
      tip: f => {
        const pos = fieldByKey(f.field);
        const what = f.state === 'waiting' ? `needs you: ${f.ask}` : f.state === 'turn' ? (f.question ? `asks you: ${f.question}` : `your turn: ${f.reply || 'reports back'}`)
          : f.state === 'working' ? `${props.doing(f)?.verb ?? 'working'}${pos ? ` at the ${pos.name} position` : ' on the drill ground'}${f.summary ? ` · ${f.summary}` : ''}`
          : f.state === 'stale' ? 'stale: in reserve' : 'idle: at the mess tent';
        const mode = { acceptEdits: 'accept edits', plan: 'plan mode', auto: 'auto mode', bypassPermissions: '⚠ bypass permissions', dontAsk: "don't ask" }[f.mode];
        const extra = [
          f.tasks && `tasks ${f.tasks.done}/${f.tasks.total}${f.tasks.current ? `: ${f.tasks.current}` : ''}`,
          f.jobs && `${f.jobs} background command${f.jobs === 1 ? '' : 's'} running`,
          f.nap && f.wakeAt && `wakes up by itself at ${clock(f.wakeAt)}`,
          f.compactions && `advanced ${f.compactions}×`,
          f.model && `${f.model}${f.fast ? ' (fast)' : ''}`,
        ].filter(Boolean).map(t => ` · ${t}`).join('');
        const line = f.turn ? `${f.turn.word ?? (f.thinking ? 'Thinking' : 'Working')}… ${ago(f.turn.startedAt)}${f.turn.outTokens ? ` · ↓ ${f.turn.outTokens >= 1000 ? `${(f.turn.outTokens / 1000).toFixed(1)}k` : f.turn.outTokens} tokens` : ''}${f.thinking && f.effort ? ` · thinking with ${f.effort} effort` : ''} · ` : '';
        return `${f.name} · ${line}${f.thinking ? 'thinking' : what}${f.kind === 'codex' ? '' : ` · ${Math.round((1 - f.pct) * 100)}% context left`}${f.cost != null ? ` · $${f.cost.toFixed(2)} so far` : ''}${mode ? ` · ${mode}` : ''}${extra}`;
      },
      onMove(f, zone, prev, pop) {
        if (!prev) return;
        if (zone === 'turn') pop('Done!', 'good');
        else if (zone === 'desk') pop(f.planAsk ? 'A plan for you' : 'Needs you!', 'warn');
        else if (zone === 'storage' || zone === 'nap') pop('…zzz', 'dim');
      },
      zoneText(f, z) {
        if (z === 'desk') return f.askKind === 'permission' || f.askKind === 'always' ? 'comes to HQ: needs a permission' : 'comes to HQ with a question';
        if (z === 'turn') return f.question ? 'reports back at HQ with a question' : 'reports back at HQ';
        if (z === 'storage') return 'waits in reserve (stale)';
        if (z === 'charge') return 'eats at the mess tent (idle)';
        if (z === 'floor') return 'drills on the drill ground (no repo)';
        if (z === 'nap') return `sleeps on a cot until it wakes up by itself${f.wakeAt ? ` at ${clock(f.wakeAt)}` : ''}`;
        return `${props.doing(f)?.verb ?? 'working'} at the ${fieldByKey(f.field)?.name ?? ''} position`;
      },
      bg(fill, season, ext) { drawBase(fill, L, ext); },
      /** Each frame, on the ground: the motor pool's barrier (lifted while a soldier comes through), the crates on the quartermaster's pallet. */
      ground() {
        barrier(gateLift);
        for (const c of depotCrates(scene.fields)) supplyCrate(c);
      },
      /** Drawn among the soldiers, by how far down they stand: the mess table in front of the idle ones, a crate before each in reserve, a blanket over each cot. */
      items: () => [[MESS[0][1] + 1, messTable], ...RESERVE.map(([x, y]) => [y + 1, () => seatCrate(x, y)]), ...COTS.map(([x, y]) => [y + 1, () => blanket(x, y)])],
      /** Each frame: is a soldier coming through the motor pool gate (walking by it)? The barrier lifts, and comes down slowly after. Still, it is down. */
      tick(dt, posOf, snap = false) {
        const coming = !snap && scene.farmers.some(f => { const b = posOf(f.id); return b?.walk && Math.abs(b.x - GATE[0]) < 24 && Math.abs(b.y - GATE[1]) < 4; });
        gateLift = snap ? 0 : coming ? Math.min(1, gateLift + dt * 5) : Math.max(0, gateLift - dt * 1.5);
      },
      /** The sky by your clock above the hedge, and what stands against it: the flagpoles, the bunting and the flags, HQ's pennant. */
      weather(sky) {
        drawSky(sky);
        drawSkyline(coloursOf(scene.farmers), scene.farmers.some(f => f.state === 'waiting'), PXG.T);
      },
      /** The building at a point of the base, if any: each opens something. */
      buildingAt(x, y) { return BUILDINGS.find(([, x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)?.[0] ?? null; },
      buildingTip: k => ({
        barn: 'The motor pool gate: start a new session or resume one (a truck brings the new soldier in)', drones: 'The drone pad: subagents', desk: 'The HQ tent: who is waiting on you',
        board: 'The briefing board: what your projects remember (CLAUDE.md and memory)', bank: "The fuel depot: your plan's usage (its drums are the weekly limit). Click for your plan", dock: "The quartermaster's depot: pull requests",
      }[k] ?? ''),
      /** What a building shows when clicked: { title, html }. */
      dialog(k) {
        if (k === 'desk') {
          const list = scene.farmers.filter(f => f.state === 'waiting' || f.state === 'turn');
          return { title: 'The HQ tent', html: list.length ? `<ul class="px-dl">${list.map(f => `<li><button type="button" class="act" data-farm-pick="${esc(f.id)}">Open</button><span><b>${esc(f.name)}</b> ${esc(f.state === 'waiting' ? (f.planAsk ? 'has a plan for you to approve' : `needs you: ${f.ask}`) : f.question ? `asks: ${f.question}` : `reports back${f.reply ? `: ${f.reply}` : ''}`)}</span></li>`).join('')}</ul>` : '<p class="muted">No soldier is waiting on you.</p>' };
        }
        if (k === 'bank') {
          const name = w => ({ five_hour: '5-hour limit', seven_day: 'Weekly limit' })[w.kind] ?? w.kind;
          const meters = ws => ws.map(w => { const used = usedOf(w), pct = used === null ? 0 : Math.round(used); return `<div class="px-meter"><b>${esc(name(w))}</b><span class="bar"><i style="width:${Math.min(100, pct)}%"></i></span><span>${w.reset ? 'just reset' : used === null ? 'no reading' : `${pct}% used`}${w.resetsAt ? ` · resets ${esc(resetAt(w.resetsAt))}` : ''}</span></div>`; }).join('');
          const ws = scene.plan?.windows ?? [];
          return { title: 'The fuel depot: your plan', html: ws.length ? meters(ws) + '<p class="muted">The drums are the week; the alert level is the 5-hour limit (max when it is nearly used up).</p>' : '<p class="muted">No reading of your plan yet: it comes from the mod in a running session.</p>' };
        }
        if (k === 'drones') {
          const subs = scene.subagents ?? [];
          return { title: 'The drone pad: subagents', html: subs.length ? `<ul class="px-dl">${subs.slice(0, 40).map(c => `<li><i class="px-dot st-${esc(c.state)}"></i><span><b>${esc(c.parent)}</b> ${esc(c.label || 'a subagent')}${c.type ? ` <em>${esc(c.type)}</em>` : ''} · ${esc(c.state)}</span></li>`).join('')}</ul>` : '<p class="muted">No subagents lately.</p>' };
        }
        if (k === 'dock') {
          const link = pr => (typeof pr.url === 'string' && pr.url.startsWith('https://github.com/') ? `<a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number}</a>` : `#${pr.number}`);
          const checks = pr => (pr.draft ? 'draft' : { ok: '✓ checks pass', failed: '✗ checks failed', running: '◌ checks running' }[pr.checks] ?? 'no checks');
          const repos = scene.fields.filter(fl => fl.prs);
          return { title: "The quartermaster's depot: pull requests", html: repos.length ? repos.map(fl => `<h4>${esc(fl.name)}</h4><ul class="px-dl">${(fl.prs.open ?? []).map(pr => `<li><span>${link(pr)} ${esc(pr.title)} <em class="ck-${esc(pr.draft ? 'draft' : pr.checks ?? 'none')}">${checks(pr)}</em></span></li>`).join('') || '<li class="muted">No open pull requests.</li>'}${(fl.prs.merged ?? []).map(m => `<li class="muted"><span>${link(m)} merged${m.at ? ` ${ago(m.at)} ago` : ''}: ${esc(m.title)}</span></li>`).join('')}</ul>`).join('') : '<p class="muted">No pull requests to show: these repos have no GitHub origin, or gh is not signed in.</p>' };
        }
        return null;
      },
      /** The projects whose memory the briefing board shows: one session in each folder. */
      boardSessions: () => [...new Map(scene.farmers.filter(f => f.kind !== 'codex' && f.cwd).map(f => [f.cwd, f])).values()].slice(0, 8),
      /**
       * The signs: each position's name (click it for the files soldiers touched there), each project's over its mown
       * patch, the places' (HQ, the motor pool, the mess, the reserve, the drill ground, the range), the open pull
       * requests at the quartermaster's, and "+N" for whoever doesn't fit their place.
       */
      labels(lab, overflow) {
        const { ST, more } = L;
        const cnt = t => pxt(t, '#5a3a1a', null), sign = t => pxt(t, '#fff3d6', '#4e3626');
        for (const s of ST) {
          const f = fieldByKey(s.key);
          if (!f) continue;
          const tip = [f.key, f.branch && `on ${f.branch}`, 'Click to see the files soldiers touched here'].filter(Boolean).join(' · ');
          lab(s.cx, s.rowTop + 49, `<button type="button" class="px-field" data-farm-field="${esc(f.key)}" title="${esc(tip)}"><span class="px-fl">${pxt(cutMid(f.name, 16), '#e6eef5')}</span></button>`);
        }
        if (!ST.length) lab(262, 150, sign('No positions yet: no soldier has touched a repo in the last 30 minutes'), 'zone');
        lab(200, 30, sign('HQ'), 'zone'); lab(60, 21, sign('MOTOR POOL'), 'zone');
        lab(57, 93, sign('MESS'), 'zone'); lab(54, 147, sign('RESERVE'), 'zone'); lab(58, 177, sign('DRILL'), 'zone'); lab(150, 95, sign('RANGE'), 'zone');
        for (const g of L.groups) { const [r, cols] = rowsOfGroup(g)[0]; lab(174 + Math.min(...cols) * COLW + 44, 100 + r * ROWH - 1, sign(clip(g.name, 16)), 'zone proj', `The ${g.name} project: its repos side by side`); }
        const open = scene.fields.flatMap(fl => fl.prs?.open ?? []);
        if (open.length) lab(357, 91, cnt(`${open.length} PR${open.length === 1 ? '' : 's'}`), 'cnt', `Open pull requests: ${open.slice(0, 6).map(pr => `#${pr.number}${pr.title ? ` ${pr.title}` : ''}`).join(' · ')}${open.length > 6 ? ' …' : ''}. Click the quartermaster's depot for them all`);
        const plus = (x, y, n, what) => n > 0 && lab(x, y, cnt(`+${n} ${what}`), 'cnt');
        plus(QUEUE.from, 91, overflow.desk, 'waiting'); plus(QUEUE.to, 91, overflow.turn, 'your turn'); // under each queue's first soldier
        plus(116, MESS[0][1] - 4, overflow.charge, 'idle'); plus(116, RESERVE[0][1] - 4, overflow.storage, 'stale'); plus(116, DRILL[0][1] - 4, overflow.floor, 'working'); plus(116, COTS[0][1] - 4, overflow.nap, 'asleep');
        if (more > 0) lab(350, L.GRID.y1 + 5, `<button type="button" class="px-more" data-farm-more>${pxt(`+${more} more position${more === 1 ? '' : 's'}`, '#fff3d6', '#4e3626')}</button>`, 'wood');
      },
      /** A soldier: walking, it faces where it goes; waiting on you, it waves; its eyes as the farm's. */
      drawChar(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), look = f.look ?? lookOf(f);
        const view = b.walk ? b.face ?? 'down' : 'down';
        PXG.ctx.drawImage(soldierSprite(look, f.shirt, { view, legs: legFrame(b), wave: f.state === 'waiting' }), ox, oy, 14 * SC, 16 * SC);
        if (view !== 'up') eyes(f, b, rp, view);
      },
    };
  }

  /** The field exercise's legend, shown in a dialog from the Help button: the catalogue, in drill words. */
  function helpHtml() {
    return `<div class="px-key">
      <b>The HQ tent</b><span>at the back, in the middle: soldiers waiting on you queue at its left under a red pennant, “awaiting orders”, waving a red “!”; when it's your turn they report back at its right with a dispatch (a “?” is a question for you). A rolled map at HQ = a plan for you to approve. The stats panel's “needs you” button opens the first one</span>
      <b>Positions</b><span>one position per repo on the exercise field, inside the range's rope, fortified as the session's context fills: marker stakes, a sandbag ring, a low wall, a lookout post, then the flag raised when it is nearly full. Empty positions are trampled grass until a repo needs one, up to 18. A blue pennant on its sign = a branch other than main; a camouflage net = a worktree, beside its repo's position; a mown patch with a sign = one project's repos</span>
      <b>Advanced!</b><span>when a session's conversation is compacted, the line advances: the flag is carried forward with a cheer, and the position starts again from its stakes</span>
      <b>Kit</b><span>what a working soldier holds is its current step: field manual = reading, binoculars = searching, a radio set = the web, shovel = editing, sandbag = a new file, mine detector on the practice range = running tests, brush = lint or format, toolbox = a build, a crate on a dolly = installing, stamped crate = a commit, wheelbarrow = a push, signal flare pistol = a deploy, mail sack = a pull, field generator = a server, sapper's spade = deleting, whistle = calling subagents, map case = planning, a message card = a question for you, field telephone = any other command, blueprint = plan mode</span>
      <b>On a soldier</b><span>a field jacket in its agent's colour in the list, its headgear (a helmet, a beret or a cap) picked by its agent, so the same agent is always the same soldier. The chevrons on its sleeve = what it has cost (one from $1, two from $10, three from $50); the pin on its headgear = its model (purple Opus, blue Sonnet, green Haiku, orange Fable); a radio on its back, the aerial blinking = thinking between steps; a clipboard = its task list (its name says how many, e.g. 3/7); sweat drops = a hot CPU; a yellow and black armband = bypass permissions (no checks); speed lines = fast mode. Codex soldiers have a slate-grey stripe down the jacket</span>
      <b>Drones</b><span>small drones hovering by a soldier = its subagents, up to four (a K9 dog sniffing about = an Explore subagent). The drone pad holds the ones that finished lately; drones circling over it, with a +N, = more running than their soldiers can lead</span>
      <b>Jeeps, dispatch riders</b><span>a jeep waits in the vehicle park on the left for each MCP server (Gmail, playwright, Chrome…) your soldiers called in the last hour; while a soldier calls it, it drives over with the server's name and waits beside it until the call is done. A dispatch rider on a motorbike rides the track to a soldier and back for each web call going on</span>
      <b>By a position</b><span>loose sandbags = uncommitted files, supply crates = unpushed commits, a mail sack at its post = behind the remote; a field generator humming by the post = a background command still running</span>
      <b>Deploys</b><span>the repo's last deploy, from GitHub Actions or a deploy an agent ran itself (a deploy script over ssh, rsync, vercel…), whichever is newer: a green flare = deployed; a practice charge, a big grey puff and a scorched patch, nobody hurt = deploy failed (hover its sign for why; the close-up links to the run); red range flags flapping, with distant practice thumps = deploying; a “HOLD” board = Actions didn't run (billing, a spending limit). Yellow caution tape round a position = two agents writing one repo, pulsing faster when it's serious</span>
      <b>The quartermaster's depot</b><span>a supply crate on its pallet for each open pull request, its tag the checks (green pass, red failed, amber running, grey draft); “Supplies in!” = one merged, carried in</span>
      <b>Mess, reserve, cots, drill ground</b><span>idle soldiers eat at the mess tent on the left (eyes shut); stale ones sit on crates by the reserve tents, in reserve; a soldier asleep on a cot under the little clock = a session that wakes up by itself (/loop, a scheduled wake-up), with when; soldiers working outside any repo drill on the drill ground. When more come than a place holds, a +N says how many more</span>
      <b>Buildings</b><span>click the motor pool gate to start or resume a session (a truck brings the new soldier in, and it jumps down), the HQ tent for who is waiting on you, the fuel depot for your plan's usage (a depot for each Claude account, when you have two), the drone pad for subagents, the briefing board for CLAUDE.md and memory, the quartermaster's depot for pull requests</span>
      <b>Fuel depot</b><span>its drums are what is left of your plan's weekly limit: they empty as the week is used (the % on hover, and when it resets); its lamp turns amber from 70% and blinks red from 90%. With two Claude accounts, each has a fuel depot (the second left of the motor pool gate), its name and week on the tag at its foot; the alert level follows the first account's 5-hour limit</span>
      <b>Alert</b><span>the alert level follows your plan's 5-hour limit, on the alert board by HQ: calm while it is fresh (green, the flags hanging limp), then ready (yellow, the flags flying), high (amber, the base's lights warm, soldiers walking faster) and max (a red beacon spinning, the flags snapping, soldiers at the double) when it is nearly used up; a new window brings it back to calm. The Alert switch holds one instead (each click moves it on, then back to live): the panel then shows the level with a 📌 and your real 5-hour use</span>
      <b>Soldiers</b><span>one per agent. Hover one for its name; names always show for the soldier you picked and those at HQ</span>
      <b>Speech bubbles</b><span>what a soldier asked or last said; × hides one to a 💬 (click it to show the bubble again); a new message brings it back by itself. The Bubbles switch hides or shows them all</span>
      <b>Carrier pigeons</b><span>one agent messaging another (Claude Code's SendMessage between sessions): a carrier pigeon flies the letter from one soldier to the other, and the field log says what it said; the agents' conversations show it too</span>
      <b>Mascots</b><span>the regimental mascots live here just for fun: a mascot goat in a red dress coat, the mess cat, and mice in the quartermaster's depot. They never stand for anything. Click one to pet it, feed it or salute the goat: the nearest soldier that isn't waiting on you walks over and does it. The Animals switch hides them</span>
      <b>Day and night</b><span>the sky follows your clock; at night searchlights sweep, the tents glow from inside, lanterns light the track, and now and then a slow white flare drifts down. The Sky switch holds it at day or night</span>
      <b>Click</b><span>a soldier to answer or message it in the sidebar; a position's sign for the files soldiers touched there</span>
      <b>Zoom</b><span>+ / − (or ⌘/Ctrl + scroll, or pinch) zooms the base inside its frame; drag or scroll to move around (the map in the corner shows where you are; click it to go somewhere); the % button shows the whole base again</span>
      <b>Stats, bell</b><span>the stats add up what the sessions have cost and how often the line advanced (each compaction). Bell: a chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you</span>
    </div>`;
  }

  /* ---------- the field exercise, as a world: the bridge (web/worlds/sdk/bridge.js) runs it ---------- */

  window.Agentville.world(makeMilitary());
  // The field exercise's own pieces, for its tests (and where the browser test clicks: the buildings' boxes, the positions' grid).
  window.AgentvilleMilitary = { OUTFIT, lookOf, soldierSprite, militaryScene, makeMilitary, props, BUILDINGS, MILITARY_GRID, DEPOT_X, PARK, SKY_Y, depotCrates };
})();
