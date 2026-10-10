// The field exercise: the third built-in world. A bright, friendly army base on manoeuvres: every agent is a
// soldier in a field jacket of its agent's colour, and every repo a position on the exercise field. It is a
// drill: nobody is ever shown hurt. On the shared engine (web/worlds/sdk/engine.js), like the farm and the
// factory, in the frame's shared scope (pixel.js, people.js, props.js, creatures.js, animals.js, engine.js),
// so it keeps its own names inside this function. Classic script, no dependencies, one file (the frame loads
// only world.js).
(() => {
  'use strict';
  const { lookFor, rows: personRows, sprite: personSprite, hashOf } = window.Agentville.people;

  /* ---------- the scene: what the base draws, from the snapshot ---------- */

  /** The fortification's stage by the context used: 0 marker stakes, 1 a sandbag ring (from 30%), 2 a low wall (50%), 3 a lookout post (70%), 4 the flag raised (85%: nearly full). */
  const stageOf = p => (p >= 0.85 ? 4 : p >= 0.7 ? 3 : p >= 0.5 ? 2 : p >= 0.3 ? 1 : 0);
  /** Who fortifies a position: of the soldiers at work on its repo (working, waiting on you, your turn; not idle or stale), the one whose context is fullest; null if none. */
  const builderOf = (farmers, key) => farmers.filter(a => a.field === key && ACTIVE.has(a.state)).reduce((best, a) => (best && (best.pct ?? 0) >= (a.pct ?? 0) ? best : a), null);
  /** A position's deploy, from its last one: ok, failed, running, blocked (Actions didn't run), or other for any state it doesn't name; null with none. */
  const lightOf = d => (d ? (['ok', 'failed', 'running', 'blocked'].includes(d.state) ? d.state : 'other') : null);
  /**
   * The field exercise's scene: the engine's, with each soldier's look, and each position's `build` stage (by its
   * fullest soldier at work), its `flag` (a branch other than main) and its deploy's `light` (its last deploy).
   */
  function militaryScene(s) {
    const e = engineScene(s);
    e.fields = e.fields.map(f => ({ ...f, build: stageOf(builderOf(e.farmers, f.key)?.pct ?? 0), flag: Boolean(f.branch) && f.branch !== '(detached)' && !f.onMain, light: lightOf(f.deploy) }));
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
  // - the track (y 74–92) in front of them, where soldiers queue at HQ, lanterns along its front edge;
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
  const RESERVE_TENTS = [30, 78]; // the reserve tents' apexes (x), behind their crates
  const MESS_LAMP = [61, 112]; // the lantern hanging under the mess tent's fly: its glass
  // What lights the base at night (lights), and from high alert by day: the lanterns on posts along the track's
  // front edge (each one's middle; clear of the paths, the range rope's posts, the signs on the track, and below the
  // feet of the soldiers on it), HQ's windows (each one's left), and the two searchlights on HQ's roof (each one's
  // lens: its middle, its top).
  const LANTERNS = [40, 90, 195, 266, 330, 388], LANTERN_Y = 87; // the glass's top
  const HQ_WINDOWS = [146, 238];
  const SEARCHLIGHTS = [[158, 19], [242, 19]];
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
   * track in front; its pennant pole stands on its ridge (drawn each frame above it: the pennant goes up and down),
   * between two searchlights on its roof.
   */
  function hqTent(f) {
    for (let j = 0; j < 16; j++) { const inset = Math.round((15 - j) * 0.55); f(140 + inset, HQ_RIDGE + j, 120 - 2 * inset, 1, j < 2 ? CANVAS_LIGHT : CANVAS); } // the roof
    for (let x = 160; x < 260; x += 20) f(x, HQ_RIDGE + 2, 1, 14, CANVAS_SHADE); // its seams
    f(140, 42, 120, 2, RED_DARK); for (let x = 140; x < 260; x += 8) { f(x + 1, 44, 6, 1, RED_DARK); f(x + 2, 45, 4, 1, RED_DARK); } // the valance
    f(141, 44, 118, 30, CANVAS); f(141, 44, 1, 30, CANVAS_LIGHT); f(258, 44, 1, 30, CANVAS_SHADE); f(141, 73, 118, 1, CANVAS_SHADE); // the walls
    for (const x of [160, 240]) f(x, 46, 1, 27, CANVAS_SHADE);
    for (const x of HQ_WINDOWS) { f(x, 50, 16, 10, CANVAS_DARK); f(x + 1, 51, 14, 8, '#a9dcf7'); f(x + 8, 51, 1, 8, CANVAS_DARK); f(x + 1, 55, 14, 1, CANVAS_DARK); f(x + 1, 51, 3, 1, '#ffffff'); } // its windows
    f(176, 46, 48, 28, INSIDE); f(176, 46, 48, 2, CANVAS_DARK); // the way in, the inside in the shade
    for (let j = 0; j < 12; j++) { f(176, 46 + j, 11 - j, 1, CANVAS_SHADE); f(213 + j, 46 + j, 11 - j, 1, CANVAS_SHADE); } // the flaps, tied back
    f(177, 57, 3, 2, RED_DARK); f(220, 57, 3, 2, RED_DARK); // their ties
    f(HQ_POLE, 46, 1, 5, DARK); f(198, 51, 5, 1, DARK); f(198, 52, 5, 4, '#ffd43b'); f(199, 53, 3, 2, '#ffe8a3'); f(198, 56, 5, 1, DARK); // the lamp
    f(184, 60, 32, 4, WOOD[2]); f(184, 60, 32, 1, WOOD[4]); f(186, 64, 2, 10, WOOD[1]); f(212, 64, 2, 10, WOOD[1]); // the table
    f(187, 58, 24, 3, '#f4ecd8'); f(189, 58, 7, 2, '#9ed36a'); f(197, 59, 8, 1, '#5ab4ff'); f(205, 58, 4, 2, '#9ed36a'); f(192, 58, 1, 1, RED); f(203, 59, 1, 1, RED); // the map, pinned
    f(209, 55, 5, 1, DARK); f(209, 56, 5, 3, OLIVE[1]); // a field telephone
    line(f, 140, 44, 137, 73, ROPE); f(136, 73, 2, 1, WOOD[1]); line(f, 259, 44, 261, 73, ROPE); f(261, 73, 2, 1, WOOD[1]); // guy ropes, pegged
    f(HQ_POLE, SKY_Y, 1, HQ_RIDGE - SKY_Y, POLE); // the pennant pole's foot (the rest stands against the sky)
    for (const [x, y] of SEARCHLIGHTS) searchlight(f, x, y);
  }
  /** A searchlight on HQ's roof, its lens at (x, y): a dark drum on a steel yoke, its glass on top (it shines up: its beam sweeps the sky at night, top). */
  function searchlight(f, x, y) {
    f(x - 1, y + 4, 3, 2, STEEL); f(x - 3, y + 6, 7, 1, DARK); // its yoke, its base on the ridge
    f(x - 2, y, 5, 4, DARK); f(x - 2, y + 1, 1, 3, STEEL); // its drum, lit on its left
    f(x - 1, y, 3, 1, '#c3cbd2'); // its glass
  }
  /** A lantern on its post at the track's front edge, its glass's middle at x: a dark cap and base round pale glass, unlit (lit from high alert by day, and at night). */
  function lantern(f, x) {
    f(x + 1, LANTERN_Y + 9, 2, 1, SHADE); f(x, LANTERN_Y + 4, 1, 5, WOOD[1]); // its post, its shadow
    f(x - 1, LANTERN_Y - 1, 3, 1, DARK); f(x - 1, LANTERN_Y, 3, 3, '#e6eef5'); f(x - 1, LANTERN_Y + 3, 3, 1, DARK); // its cap, its glass, its base
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
  /** A fuel depot, its left at x: a shelter with a tin roof, a lamp and a fuel sign under it, two shelves for its drums (the weekly limit fills them: depotDrums, each frame). */
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
    const [lx, ly] = MESS_LAMP; // a lantern hanging under the fly, by its middle pole (it glows at night)
    f(lx, ly - 2, 1, 1, DARK); f(lx - 1, ly - 1, 3, 4, DARK); f(lx, ly, 1, 2, '#e6eef5');
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
  const TRAMPLED = ['#9ed36a', '#4f8f3a']; // flattened blades, pale in the sun; a boot print pressed in
  /** An empty slot, where no repo has a position yet: trampled grass (blades flattened one way, a boot print here and there) inside a faint dashed outline. */
  function emptySlot(f, { cx, rowTop: t }) {
    const x0 = cx - 34, x1 = cx + 33, y0 = t + 6, y1 = t + 34;
    for (let x = x0; x <= x1; x += 4) { f(x, y0, 2, 1, SHADE); f(x, y1, 2, 1, SHADE); }
    for (let y = y0; y <= y1; y += 4) { f(x0, y, 1, 2, SHADE); f(x1, y, 1, 2, SHADE); }
    for (let y = y0 + 3; y < y1 - 3; y += 3) for (let x = x0 + 3; x < x1 - 4; x += 5) {
      const n = noise(x, y) % 9, dx = noise(y, x) % 3;
      if (n < 2) { f(x + dx, y, 2, 1, TRAMPLED[0]); f(x + dx + 2, y + 1, 1, 1, TRAMPLED[0]); } // a blade, flattened
      else if (n === 2) { f(x + dx, y, 1, 2, TRAMPLED[1]); f(x + dx + 2, y + 1, 1, 2, TRAMPLED[1]); } // a boot print
    }
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
    for (const s of L.empty) emptySlot(f, s);
    // the paths down: the left side's, out to the vehicle park, and the aisles between the positions' columns
    f(111, TRACK.y1, 10, G.y1 - TRACK.y1, SAND); f(111, TRACK.y1, 1, G.y1 - TRACK.y1, SAND_EDGE); f(120, TRACK.y1, 1, G.y1 - TRACK.y1, SAND_EDGE);
    for (const c of CORR.slice(1)) f(c - 3, TRACK.y1, 6, G.y1 - TRACK.y1, SAND);
    rangeRope(f, L);
    for (const x of LANTERNS) lantern(f, x);
    // the left side
    messTent(f);
    for (const cx of RESERVE_TENTS) pupTent(f, cx, RESERVE_BOX.y + 2); // the reserve tents, behind their crates
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
  /**
   * A flag at a pole's top, by the alert level: at calm it hangs limp down its pole; at ready and high it flies out to
   * the right, a ripple running along it; at max it stands straight out, longer, its end snapping in the wind.
   */
  function flag(x, c, T, i, level) {
    if (level === 'spring') { exact(x + 1, POLE_TOP + 1, 1, 8, c); exact(x + 2, POLE_TOP + 1, 1, 7, c); exact(x + 3, POLE_TOP + 2, 1, 4, c); return; }
    if (level === 'winter') {
      for (let col = 0; col < 9; col++) exact(x + 1 + col, POLE_TOP + 1 + (col < 4 ? 0 : Math.round(Math.sin(T * 16 - col * 1.1 + i) * (col - 3) * 0.3)), 1, 4, c);
      return;
    }
    for (let col = 0; col < 8; col++) exact(x + 1 + col, POLE_TOP + 1 + (Math.sin(T * 5 - col * 0.8 + i) > 0.35 ? 1 : 0), 1, 4, c);
  }
  /**
   * What stands against the sky, over it: each flagpole's top with a gilt ball and a flag, bunting from pole to pole (the
   * flags and the bunting in the agents' colours; the flags as the alert level has them), and HQ's pennant pole on its
   * ridge: its red pennant run up while a soldier waits on you ("awaiting orders"), furled at the pole's foot when no one does.
   */
  function drawSkyline(colours, waiting, T, level) {
    const anchors = [...POLES, HQ_POLE].sort((a, b) => a - b);
    for (let i = 0; i + 1 < anchors.length; i++) bunting(anchors[i], anchors[i + 1], colours, i * 3);
    for (const x of anchors) { const foot = x === HQ_POLE ? HQ_RIDGE : SKY_Y; px(x, POLE_TOP, 1, foot - POLE_TOP, POLE); px(x + 1, POLE_TOP, 1, foot - POLE_TOP, POLE_SIDE); px(x - 1, POLE_TOP - 2, 3, 2, '#f0b429'); }
    POLES.forEach((x, i) => flag(x, colours[i % colours.length], T, i, level));
    const x = HQ_POLE + 1;
    if (!waiting) { px(x, SKY_Y + 1, 2, 6, RED_DARK); px(x, SKY_Y + 1, 1, 6, RED); return; } // furled
    const flap = Math.floor(T * 5) % 2;
    px(x, POLE_TOP + 1, 10, 2, RED); px(x, POLE_TOP + 1, 10, 1, RED_LIGHT); px(x, POLE_TOP + 3, 7 + flap, 1, RED); px(x, POLE_TOP + 4, 4, 1, RED_DARK); px(x + 10, POLE_TOP + 1 + flap, 3, 1, RED);
  }

  /* ---------- the positions: fortified as the context fills, and what its repo's state puts round each ---------- */

  // A position at its slot s (s.cx its middle, s.rowTop its row's top, t below) takes cx ± 41 across and t to t + 30
  // down, behind where its soldiers stand (on t + 44, their heads from t + 28) and its sign hangs (a label, from
  // t + 49). Its top few pixels are left to the signs over it (its git counts; the row above's sign, two lines tall):
  // the flag raised flies below them. Back to front: the deploy's corner at the back right (a green flare, a
  // practice charge, red range flags or a HOLD board); its post at the back left (a blue pennant over it for a
  // branch other than main, a mail sack at its foot, a field generator by it); the fortification in the middle (a
  // camouflage net over it for a worktree); loose sandbags at the front left and supply crates at the front right;
  // yellow caution tape round it all, soldiers too, when two agents write one repo. Every effect is a drill's:
  // flares, puffs, flags and signs, and nobody hurt.
  /** Where a position's post stands (its foot), and where its deploy goes off (its middle, on the ground): for what is drawn there, its signs, and the animals' reactions. */
  const postAt = s => [s.cx - 37, s.rowTop + 24];
  const deployAt = s => [s.cx + 31, s.rowTop + 16];
  /** Where a position's field generator stands, its top left, by its post (its lamp glows at night: lights). */
  const generatorAt = s => [postAt(s)[0] + 8, postAt(s)[1] - 14];
  // Stage 0: a stake at each corner of where the ring will go, [dx, dy] of its foot from cx and t, a string between them.
  const STAKES = [[-15, 17], [14, 17], [-15, 29], [14, 29]];
  // The sandbags, [dx, dy] of each one's top left from cx and t: the ring one bag high (stage 1) and a second course on
  // it, the low wall (stage 2). Each in its back half (behind the lookout) and its front half, drawn back to front.
  const RING = {
    back: [[-12, 16], [-7, 16], [-2, 16], [3, 16], [8, 16], [-17, 18], [13, 18]],
    front: [[-19, 21], [15, 21], [-17, 24], [13, 24], [-12, 26], [-7, 26], [-2, 26], [3, 26], [8, 26]],
  };
  const WALL = {
    back: [[-10, 13], [-5, 13], [0, 13], [5, 13], [-15, 15], [11, 15]],
    front: [[-18, 18], [14, 18], [-15, 21], [11, 21], [-10, 23], [-5, 23], [0, 23], [5, 23]],
  };
  const DECK = 11; // the lookout's platform, from t: its railing over it, its legs under it, the flag's pole on it
  // One loose sandbag for each uncommitted file (6 at most), at the front left; one supply crate for each unpushed
  // commit (4 at most), at the front right: two on the ground, two on them.
  const LOOSE = [[-39, 24], [-33, 26], [-27, 24], [-38, 29], [-31, 31], [-25, 29]];
  const CRATES = [[21, 24], [28, 24], [21, 18], [28, 18]];

  /** A sandbag lying across, its top left at (x, y), 5 × 4: khaki canvas lit along its top, its tied end in shade, its seam under it. */
  function sandbag(x, y) {
    px(x, y, 5, 3, CANVAS); px(x, y, 4, 1, CANVAS_LIGHT); px(x + 4, y, 1, 3, CANVAS_SHADE); px(x, y + 3, 5, 1, CANVAS_DARK);
  }
  /** Stage 0: four marker stakes, an orange tag on each, a string between them round where the ring will go. */
  function markerStakes(cx, t) {
    px(cx - 14, t + 14, 29, 1, ROPE); px(cx - 14, t + 26, 29, 1, ROPE); px(cx - 15, t + 14, 1, 12, ROPE); px(cx + 15, t + 14, 1, 12, ROPE); // the string
    for (const [dx, dy] of STAKES) { const x = cx + dx, y = t + dy; px(x + 1, y, 2, 1, SHADE); px(x, y - 5, 2, 5, WOOD[1]); px(x, y - 5, 1, 5, WOOD[3]); px(x, y - 6, 2, 1, '#f08a24'); }
  }
  /** The lookout post inside the ring (stage 3): a wooden tower on braced legs, a platform with a railing round it. */
  function lookout(cx, t) {
    const d = t + DECK;
    for (const x of [cx - 6, cx + 5]) { px(x, d + 2, 2, 11, WOOD[1]); px(x, d + 2, 1, 11, WOOD[3]); } // its legs
    line(px, cx - 4, d + 3, cx + 4, d + 10, WOOD[2]); line(px, cx + 4, d + 3, cx - 4, d + 10, WOOD[2]); // its braces
    px(cx - 8, d, 17, 2, WOOD[2]); px(cx - 8, d, 17, 1, WOOD[4]); px(cx - 8, d + 2, 17, 1, WOOD[0]); // its platform
    px(cx - 8, d - 3, 1, 3, WOOD[1]); px(cx + 8, d - 3, 1, 3, WOOD[1]); px(cx - 8, d - 3, 17, 1, WOOD[3]); // its railing
  }
  /** A flag's colour: its soldier's when it is one, else red. */
  const flagColour = c => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : RED);
  /** The flag raised on the lookout (stage 4, nearly full), in its soldier's colour, flying out to the right; a glint on its pole's gilt ball now and then. */
  function raisedFlag(cx, t, color, T) {
    const d = t + DECK;
    px(cx + 6, d - 8, 1, 8, POLE); px(cx + 5, d - 9, 3, 1, '#f0b429');
    for (let col = 0; col < 7; col++) exact(cx + 7 + col, d - 7 + (Math.sin(T * 5 - col * 0.8) > 0.35 ? 1 : 0), 1, 3, flagColour(color));
    if (Math.floor(T * 3 + cx) % 11 === 0) { px(cx + 3, d - 11, 1, 3, '#ffffff'); px(cx + 2, d - 10, 3, 1, '#ffffff'); }
  }
  /**
   * The fortification at its stage: 0 its marker stakes; 1 a ring of sandbags round a dug floor; 2 a second course on
   * it, a low wall; 3 a lookout post inside; 4 the flag raised on the lookout, in `color` (its soldier's).
   */
  function fortification(cx, t, stage, color, T) {
    if (!(stage >= 1)) { markerStakes(cx, t); return; }
    px(cx - 14, t + 18, 29, 9, SAND_EDGE); px(cx - 16, t + 20, 33, 5, SAND_EDGE); px(cx - 12, t + 20, 25, 5, SAND); // the dug floor
    const bags = list => list.forEach(([dx, dy]) => sandbag(cx + dx, t + dy));
    bags(RING.back);
    if (stage >= 2) bags(WALL.back);
    if (stage >= 3) lookout(cx, t);
    bags(RING.front);
    if (stage >= 2) bags(WALL.front);
    if (stage >= 4) raisedFlag(cx, t, color, T);
  }

  /** A position's post at the back left, its foot at (x, y): a stout post with a cream plate on it; a blue pennant flying over it for a branch other than main. */
  function positionPost(x, y, flag) {
    px(x + 2, y, 3, 1, SHADE); // its shadow
    px(x, y - 15, 2, 16, WOOD[1]); px(x, y - 15, 1, 16, WOOD[3]); // the post
    px(x - 3, y - 18, 8, 5, WOOD[0]); px(x - 2, y - 17, 6, 3, CANVAS_LIGHT); px(x - 1, y - 16, 4, 1, CANVAS_DARK); // its plate
    if (!flag) return;
    const wave = blink(2);
    px(x, y - 23, 1, 5, POLE); px(x + 1, y - 23, 4 + wave, 1, '#3d7be0'); px(x + 1, y - 22, 3, 1, '#5ab4ff'); px(x + 1, y - 21, 2 + wave, 1, '#3d7be0'); // the pennant
  }
  /** A mail sack left at the post (the repo is behind its remote), its top left at (x, y): tied at the neck, the mail's red and blue stripes. */
  function mailSack(x, y) {
    px(x, y + 6, 6, 1, SHADE);
    px(x + 1, y, 4, 6, CANVAS_LIGHT); px(x, y + 2, 6, 4, CANVAS_LIGHT); px(x + 4, y + 1, 2, 5, CANVAS_SHADE); // the sack
    px(x, y + 3, 6, 1, RED); px(x, y + 4, 6, 1, '#3d7be0'); // its stripes
    px(x + 2, y - 1, 2, 1, WOOD[1]); px(x + 2, y - 2, 2, 1, CANVAS_LIGHT); // its neck, tied
  }
  /** A small field generator humming by the post while a background command runs, its top left at (x, y): an olive box on skids, its grille, a green lamp blinking, a wisp from its exhaust now and then; it shakes a little. */
  function generator(x, y, T) {
    const j = blink(12); // its hum
    px(x, y + 7, 10, 1, SHADE); px(x, y + 6, 10, 1, WOOD[1]); // its skids
    px(x + j, y, 9, 6, OLIVE[0]); px(x + 1 + j, y + 1, 7, 4, OLIVE[1]); px(x + 1 + j, y + 1, 7, 1, OLIVE[2]);
    for (let i = 0; i < 3; i++) px(x + 2 + i * 2 + j, y + 3, 1, 2, OLIVE[0]); // its grille
    px(x + 7 + j, y + 2, 1, 1, blink(2) ? '#6cc04a' : '#2f6b2f'); // its lamp
    px(x + 1 + j, y - 2, 2, 2, STEEL); // its exhaust
    if (Math.floor(T * 1.5) % 2) px(x + 1, y - 4, 2, 1, POLE_SIDE); // a wisp
  }
  /** A supply crate (an unpushed commit), its top left at (x, y): olive, its lid lit, a yellow stencil mark; its shadow when it stands on the ground. */
  function fieldCrate(x, y, onGround) {
    if (onGround) px(x + 1, y + 6, 6, 1, SHADE);
    px(x, y, 6, 6, OLIVE[0]); px(x + 1, y + 1, 4, 4, OLIVE[1]); px(x + 1, y + 1, 4, 1, OLIVE[2]); px(x + 2, y + 3, 2, 1, '#e9c46a');
  }

  /** A round blob, its middle at (x, y), r out from it: a row of pixels at a time. */
  function disc(x, y, r, c) {
    for (let dy = -r; dy <= r; dy++) { const half = Math.round(Math.sqrt(r * r - dy * dy)); px(x - half, y + dy, 2 * half + 1, 1, c); }
  }
  // A puff of smoke: round blobs, [dx, dy, r] from its foot, shaded under, lit at the top left.
  const PUFF = [[0, -2, 2], [-5, -7, 4], [3, -8, 5], [9, -6, 3], [-1, -13, 4], [5, -15, 3]];
  /** A puff of smoke at (x, y), its foot, scale k (1 full): soft grey blobs, their undersides in shade, their tops lit. */
  function smokePuff(x, y, k, T) {
    const blobs = PUFF.map(([dx, dy, r], i) => [x + Math.round(dx * k), y + Math.round(dy * k), Math.max(1, Math.round(r * k + (Math.sin(T * 2 + i) > 0.6 ? 1 : 0)))]);
    for (const [bx, by, r] of blobs) disc(bx, by + 1, r, POLE_SIDE);
    for (const [bx, by, r] of blobs) disc(bx, by, r, '#c3cbd2');
    for (const [bx, by, r] of blobs) if (r > 1) disc(bx - 1, by - 1, r - 2, '#e6eef5');
  }
  /** A green flare from its canister at (x, y), at T: every 2.4 seconds one goes up ({ x, y, k }), then bursts into its star ({ x, y, k, star: true }); null between. */
  function flareOf(x, y, T) {
    const p = (T % 2.4) / 2.4;
    if (p < 0.4) { const k = p / 0.4; return { x: x + 1 + Math.round(k * 2), y: Math.round(y - 10 - k * 14), k }; }
    if (p < 0.92) return { x: x + 3, y: y - 24, k: (p - 0.4) / 0.52, star: true };
    return null;
  }
  /** Deployed: a green flare's canister on the ground at (x, y), and every 2.4 seconds a flare going up from it, a trail of sparks behind it, bursting into a green star that fades. */
  function greenFlare(x, y, T) {
    px(x - 1, y, 5, 1, SHADE); px(x - 1, y - 6, 4, 6, '#2f6b2f'); px(x - 1, y - 6, 2, 6, '#2fa57a'); px(x - 1, y - 7, 4, 1, '#6cc04a'); px(x, y - 4, 2, 1, '#ffffff'); // its canister
    const fl = flareOf(x, y, T);
    if (fl && !fl.star) { // going up
      const { x: fx, y: fy } = fl;
      px(fx, fy + 3, 1, 2, '#9ed36a'); px(fx, fy + 6, 1, 1, '#c6e89a'); px(fx, fy + 8, 1, 1, '#c6e89a');
      PXG.ctx.globalAlpha = 0.5; disc(fx, fy, 3, '#9ed36a'); PXG.ctx.globalAlpha = 1;
      disc(fx, fy, 1, '#6cc04a'); px(fx, fy, 1, 1, '#ffffff');
    } else if (fl) { // its star, fading
      const { k, x: gx, y: gy } = fl, r = 3 + Math.round(k * 3), a = 1 - k * 0.8;
      PXG.ctx.globalAlpha = a * 0.5; disc(gx, gy, 4, '#9ed36a'); // its glow
      PXG.ctx.globalAlpha = a; disc(gx, gy, 2, '#6cc04a'); px(gx, gy, 1, 1, '#ffffff');
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) px(gx + Math.round(dx * r * (dx && dy ? 0.7 : 1)), gy + Math.round(dy * r * (dx && dy ? 0.7 : 1)), 1, 1, '#c6e89a');
      PXG.ctx.globalAlpha = 1;
    }
  }
  // The scorched patch's rows, from the ground's middle: [dy, half-widths of the singed grass, the burnt earth, its black heart].
  const SCORCH = [[-3, 5, 0, 0], [-2, 9, 6, 0], [-1, 11, 9, 5], [0, 11, 9, 6], [1, 9, 6, 0], [2, 5, 0, 0]];
  /**
   * Deploy failed: a practice charge gone off at (x, y). A scorched patch on the grass and a big grey puff of smoke
   * over it, billowing as it drifts off and forms again. Nobody near it, nobody hurt.
   */
  function practiceCharge(x, y, T) {
    for (const [dy, singed, burnt, dark] of SCORCH) { // the scorched patch: singed grass round burnt earth, black at its heart
      px(x - singed, y + dy, 2 * singed + 1, 1, '#8a8f3a');
      if (burnt) px(x - burnt, y + dy, 2 * burnt + 1, 1, '#6b4a35');
      if (dark) px(x - dark, y + dy, 2 * dark + 1, 1, DARK);
    }
    for (const [dx, dy] of [[-4, 0], [3, -1], [6, 1], [-8, 0], [9, -1]]) px(x + dx, y + dy, 1, 1, '#1b1420'); // soot
    const p = (T % 4) / 4; // the puff forms, drifts up and off, and thins: then another
    PXG.ctx.globalAlpha = p < 0.7 ? 0.95 : 0.95 - ((p - 0.7) / 0.3) * 0.6;
    smokePuff(x + Math.round(p * 3), y - 3 - Math.round(p * 4), 0.75 + Math.min(1, p * 3) * 0.25, T);
    PXG.ctx.globalAlpha = 1;
  }
  /** Deploying: red range flags flapping on two white poles either side of (x, y), the range in use; now and then a small practice thump far off, a little grey puff that swells and fades. */
  function rangeFlags(x, y, T) {
    for (const [dx, k] of [[-8, 0], [7, 1]]) {
      const fx = x + dx, top = y - 12, flap = Math.floor(T * 6 + k) % 2;
      px(fx + 1, y, 2, 1, SHADE); px(fx, top, 1, 13, POLE);
      if (flap) { px(fx + 1, top, 5, 3, RED); px(fx + 1, top, 5, 1, RED_LIGHT); px(fx + 6, top + 1, 1, 2, RED); }
      else { px(fx + 1, top + 1, 4, 3, RED); px(fx + 1, top + 1, 4, 1, RED_LIGHT); px(fx + 5, top, 2, 2, RED); }
    }
    const p = (T % 2.4) / 2.4; // a thump far off
    if (p < 0.4) { PXG.ctx.globalAlpha = 1 - (p / 0.4) * 0.7; disc(x, y - 17, 1 + Math.round(p * 5), '#c3cbd2'); disc(x - 1, y - 18, Math.round(p * 5), '#e6eef5'); PXG.ctx.globalAlpha = 1; }
  }
  // "HOLD" in a 3 × 5 font: each letter's rows, a bit a pixel (4 its left).
  const MINI = { H: [5, 5, 7, 5, 5], O: [7, 5, 5, 5, 7], L: [4, 4, 4, 4, 7], D: [6, 5, 5, 5, 6] };
  const mini = (text, x, y, c) => [...text].forEach((ch, i) => MINI[ch].forEach((bits, r) => { for (let b = 0; b < 3; b++) if (bits & (4 >> b)) px(x + i * 4 + b, y + r, 1, 1, c); }));
  /** Actions didn't run (billing, a spending limit): a HOLD board on two legs at (x, y), the deploy held. */
  function holdBoard(x, y) {
    px(x - 7, y + 1, 15, 1, SHADE); px(x - 7, y - 5, 1, 6, WOOD[1]); px(x + 6, y - 5, 1, 6, WOOD[1]); // its legs
    px(x - 9, y - 14, 19, 10, DARK); px(x - 8, y - 13, 17, 8, '#ffffff'); mini('HOLD', x - 7, y - 12, RED);
  }

  let netSprite = null;
  const NET = { w: 46, h: 20, dy: 12 }; // the camouflage net: its picture's size, and its top from t (the lookout's platform and the flag stand clear of it)
  /**
   * The camouflage net over a worktree's position (a picture, made once): draped from two poles over the sandbags,
   * sagging between them and spreading to the ground, its hem ragged; leaf scraps in greens and browns on a dark
   * mesh, with holes where the position shows through.
   */
  function camoNet() {
    if (netSprite) return netSprite;
    const { w, h } = NET, rows = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - w / 2, n = noise(x, y);
        if ((x === 4 || x === w - 5) && y < 4) r += 'p'; // its poles' tips
        else if (Math.abs(dx) > 17 + y * 0.3 || y < 2 * (1 - (dx / 19) ** 2) || (y >= h - 2 && n % 3 === 0)) r += '.'; // its sagging top, its sides, its ragged hem
        else if ((x + y) % 4 === 0 || (x - y + 64) % 4 === 0) r += 'm'; // the mesh
        else { const clump = noise(x >> 2, (y >> 1) + 40) % 6; r += clump < 2 ? '.' : 'abcd'[clump - 2]; } // leaf scraps in clumps, holes between
      }
      rows.push(r);
    }
    return (netSprite = makeSprite(rows, { p: WOOD[2], m: '#2f5a2a', a: '#4f8f3a', b: '#6b7a35', c: '#8a8f3a', d: '#86603a' }));
  }
  /** Yellow caution tape round a position two agents are writing at once (its soldiers too), black-striped, on stakes at its corners, pulsing (faster when it's serious). */
  function cautionTape(cx, t, high, T) {
    const x0 = cx - 40, x1 = cx + 40, y0 = t - 1, y1 = t + 45, c = i => (i % 3 === 2 ? '#2a1d14' : '#ffd43b');
    PXG.ctx.globalAlpha = 0.8 + 0.2 * Math.sin(T * (high ? 14 : 6)); // it pulses, and stays yellow
    for (let x = x0, i = 0; x < x1; x += 2, i++) { px(x, y0, Math.min(2, x1 - x), 2, c(i)); px(x, y1, Math.min(2, x1 - x), 2, c(i)); }
    for (let y = y0 + 2, i = 0; y < y1; y += 2, i++) { px(x0, y, 2, Math.min(2, y1 - y), c(i)); px(x1 - 2, y, 2, Math.min(2, y1 - y), c(i)); }
    PXG.ctx.globalAlpha = 1;
    for (const [x, y] of [[x0, y0], [x1 - 2, y0], [x0, y1], [x1 - 2, y1]]) { px(x, y - 4, 2, 6, WOOD[1]); px(x, y - 4, 1, 6, WOOD[3]); }
  }

  /**
   * A position, each frame: its deploy's corner, its post (a mail sack, a generator), the fortification at its stage
   * (under a net for a worktree), its loose sandbags and crates, and the tape. `color`: whose flag it raises.
   */
  function drawPosition(s, f, { color, jobs = 0, T = 0 }) {
    const { cx, rowTop: t } = s, [dx, dy] = deployAt(s), [px0, py0] = postAt(s);
    if (f.light === 'ok') greenFlare(dx, dy, T);
    else if (f.light === 'failed') practiceCharge(dx, dy, T);
    else if (f.light === 'running') rangeFlags(dx, dy, T);
    else if (f.light === 'blocked') holdBoard(dx, dy);
    positionPost(px0, py0, f.flag);
    if (f.behind > 0) mailSack(px0 + 2, py0 - 6);
    if (jobs > 0) generator(...generatorAt(s), T);
    fortification(cx, t, f.build ?? 0, color, T);
    if (f.worktree) PXG.ctx.drawImage(camoNet(), cx - NET.w / 2, t + NET.dy);
    LOOSE.slice(0, Math.min(6, f.dirty ?? 0)).forEach(([x, y]) => sandbag(cx + x, t + y));
    CRATES.slice(0, Math.min(4, f.ahead ?? 0)).forEach(([x, y], i) => fieldCrate(cx + x, t + y, i < 2));
    if (f.collision) cautionTape(cx, t, f.collision === 'high', T);
  }

  // A compaction: the line advances. The flag is carried a few pixels up-field from the middle of the position with a
  // cheer (confetti over it), then it is gone, and the position starts again from its stakes. A
  // merged pull request's crate is carried from the quartermaster's pallet into the depot, fading as it goes in.
  const CHEER = 1.8, WALK = 1.8, GONE = 0.8, UPFIELD = 8, CARRY = 2; // seconds; seconds; seconds; px; seconds
  const CONFETTI = ['#ff6b6b', '#ffd43b', '#6cc04a', '#5ab4ff', '#f4b6c2'];
  const DEPOT_DOOR = [357, 50]; // where "Supplies in!" pops: in the quartermaster's depot
  /** The flag being carried forward, t seconds after its position's compaction: on its pole, in its soldier's colour; confetti over it while they cheer; fading at the end. */
  function carriedFlag(s, { color, t }, T) {
    const foot = s.rowTop + 22 - Math.round(Math.min(1, t / WALK) * UPFIELD), x = s.cx + Math.round(Math.sin(t * 6));
    PXG.ctx.globalAlpha = t < WALK ? 1 : Math.max(0, 1 - (t - WALK) / GONE);
    px(x, foot - 12, 1, 12, POLE); px(x - 1, foot - 13, 3, 1, '#f0b429');
    for (let col = 0; col < 7; col++) exact(x + 1 + col, foot - 12 + (Math.sin(T * 6 - col * 0.8) > 0.35 ? 1 : 0), 1, 4, flagColour(color));
    PXG.ctx.globalAlpha = 1;
    if (t < CHEER) for (let i = 0; i < 10; i++) { const p = (t * 1.4 + i / 10) % 1; px(x - 8 + ((i * 7 + Math.round(t * 9)) % 20), foot - 20 + Math.round(p * 14), 1, 1, CONFETTI[i % CONFETTI.length]); }
  }
  /** A merged pull request's crate being carried in, t seconds after: up from the pallet into the depot, fading as it goes in. */
  function carriedCrate(t) {
    const p = Math.min(1, t / CARRY);
    PXG.ctx.globalAlpha = 1 - Math.max(0, p - 0.6) / 0.4;
    supplyCrate({ x: 353, y: Math.round(64 - p * 14), tag: 'ok' });
    PXG.ctx.globalAlpha = 1;
  }
  /** Drops what `ok` turns down from a list, in place. */
  const keep = (list, ok) => { for (let i = list.length - 1; i >= 0; i--) if (!ok(list[i])) list.splice(i, 1); };
  // The sign's blue pennant (a branch other than main): an image the pixel font's height, before the position's name.
  const PENNANT = ['pb....', 'pbbb..', 'pbllbb', 'pbbb..', 'pb....', 'p.....', 'p.....', 'p.....', '......', '......'];
  let pennantUrl = null;
  function pennantImg() {
    pennantUrl ??= makeSprite(PENNANT, { p: '#e6eef5', b: '#3d7be0', l: '#5ab4ff' }).toDataURL();
    const k = fontPx();
    return `<i class="pxt px-flag" aria-hidden="true" style="width:${(6 * k).toFixed(1)}px;height:${(10 * k).toFixed(1)}px;background-image:url(${pennantUrl})"></i>`;
  }

  /* ---------- the limits: the alert level for the 5-hour limit, the fuel depots for the week, and night ---------- */

  // The alert level is the engine's season (its Season switch is the field exercise's Alert): calm, ready, high, max.
  // Each level: the alert board's face, its shade, how many of the board's four bars are lit, and how fast the
  // soldiers walk (world px a second; the farm's is 40). The flags (drawSkyline) and the beacon (top) go by it too.
  const ALERT = {
    spring: { face: '#6cc04a', shade: '#3f9b3a', bars: 1, speed: 32 }, // calm: green; the flags hang limp, soldiers stroll
    summer: { face: '#ffd43b', shade: '#f0b429', bars: 2, speed: 40 }, // ready: yellow; the flags fly
    autumn: { face: '#f08a24', shade: '#c8681a', bars: 3, speed: 50 }, // high: amber; the base's lights warm, soldiers walk faster
    winter: { face: '#e04a3a', shade: '#9c3b30', bars: 4, speed: 64 }, // max: red; the beacon spins, the flags snap, soldiers at the double
  };
  // The levels' names, and the switch's (the engine's seasonNames): the setting still saves spring … winter.
  const ALERT_NAMES = { switch: 'Alert', spring: 'calm', summer: 'ready', autumn: 'high', winter: 'max' };
  /** A limit's % used, from its window: 0 in a new window; null with no window, or one without a number (no reading). */
  const usedOf = w => (!w ? null : w.reset ? 0 : Number.isFinite(w.percentUsed) ? w.percentUsed : null);
  /**
   * The alert level by the plan's 5-hour limit, at the farm's seasonOf bounds: calm while it is fresh, then ready
   * and high, max when it is nearly used up; ready with no reading, calm again in a new window.
   */
  function alertOf(plan) {
    const p = usedOf(plan?.windows?.find(x => x.kind === 'five_hour'));
    if (p === null) return 'summer';
    return p < 25 ? 'spring' : p < 60 ? 'summer' : p < 85 ? 'autumn' : 'winter';
  }
  /**
   * The fuel depot, by the plan's weekly limit, all from the whole % it shows: the drums still full (8 in a fresh
   * week, none when it is used up), its lamp (green; amber from 70%; red, blinking, from 90%), and when it resets;
   * null with no reading.
   */
  function depotOf(plan) {
    const w = plan?.windows?.find(x => x.kind === 'seven_day'), used = usedOf(w);
    if (used === null) return null;
    const pct = Math.round(Math.max(0, Math.min(100, used)));
    return { drums: Math.round(8 * (1 - pct / 100)), lamp: pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green', pct, resetsAt: w.resetsAt ?? null, reset: Boolean(w.reset) };
  }
  /** An account's name, or its number when it has none (account 1, account 2). */
  const accountName = (a, i) => a?.name || `account ${i + 1}`;
  /**
   * A fuel depot per Claude account (two at most), as the factory's banksOf: [{ x, name, depot }]. With fewer than
   * two accounts, the plan's depot and no name on it. The alert level stays the plan's: the first account's.
   */
  function depotsOf(scene) {
    const accs = scene.accounts ?? [];
    if (accs.length < 2) return [{ x: DEPOT_X[0], name: null, depot: depotOf(scene.plan) }];
    return accs.slice(0, 2).map((a, i) => ({ x: DEPOT_X[i], name: accountName(a, i), depot: depotOf(a.plan) }));
  }
  /** When a limit resets, short: Tue 09:00. */
  const resetAt = at => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  /** The alert board's face at a level: its colour, and its four bars lit white from the bottom, one for each step up. */
  function alertFace(level) {
    const { face, shade, bars } = ALERT[level] ?? ALERT.summer;
    px(129, 25, 9, 11, face); px(129, 35, 9, 1, shade);
    for (let i = 0; i < 4; i++) px(131, 33 - i * 2, 5, 1, i < bars ? '#ffffff' : shade);
  }
  const BEACON = [133, 19]; // the beacon's dome on the alert board, on its housing: its middle
  /**
   * The alert board's beacon: a red dome, dark below max. At max it spins: a glint going round the dome, its beam
   * flaring out to the left, then towards you (a flash), then to the right, then away.
   */
  function alertBeacon(spinning, T) {
    const [x, y] = BEACON;
    if (!spinning) { px(x - 1, y - 1, 3, 3, '#9c3b30'); px(x, y - 2, 1, 1, '#9c3b30'); return; }
    const quarter = Math.floor(((T * 1.5) % 1) * 4); // its beam to the left, towards you, to the right, away
    px(x - 1, y - 1, 3, 3, RED); px(x, y - 2, 1, 1, RED);
    if (quarter === 1) { // towards you: a flash, its glare round it and short spikes of light
      PXG.ctx.globalAlpha = 0.5; disc(x, y, 4, RED_LIGHT); PXG.ctx.globalAlpha = 1;
      px(x - 1, y - 1, 3, 3, RED_LIGHT); px(x, y - 1, 1, 1, '#ffffff');
      for (const [dx, dy] of [[-4, 0], [-3, 0], [3, 0], [4, 0], [0, -4], [0, -3]]) px(x + dx, y + dy, 1, 1, RED_LIGHT);
      return;
    }
    const side = quarter === 0 ? -1 : quarter === 2 ? 1 : 0;
    px(x + side, y - 1, 1, 2, RED_LIGHT); // the glint, on the side its beam faces (the middle while it faces away)
    for (let i = 2; side && i <= 6; i++) px(x + side * i, y - (i > 3 ? 1 : 0), 1, i > 3 ? 3 : 1, RED_LIGHT); // its beam out to that side, widening
  }
  /** Lit lanterns along the track (by day from high alert: the base's lights warm), and HQ's lamp glowing over its map table. */
  function warmLights() {
    for (const x of LANTERNS) { px(x - 1, LANTERN_Y, 3, 3, '#ffd43b'); px(x, LANTERN_Y + 1, 1, 1, '#ffe8a3'); }
    PXG.ctx.globalAlpha = 0.35; disc(200, 54, 6, '#ffe8a3'); PXG.ctx.globalAlpha = 1;
    px(198, 52, 5, 4, '#ffd43b'); px(199, 53, 3, 2, '#ffe8a3');
  }

  // A fuel depot's eight drums, [x, y] of each one's top left (4 × 8), for the depot at x: four on its floor shelf,
  // then four on the shelf above. The full ones are the first (the week empties the top shelf first, from its right).
  const drumsOf = x => [64, 44].flatMap(y => [3, 8, 13, 18].map(dx => [x + dx, y]));
  const FUEL = RED; // a full drum's paint
  const LAMP_COLOURS = { green: '#6cc04a', amber: '#f0b429', red: RED };
  /** A depot's drums and lamp, its left at x, for its reading (none: no drum full, the lamp off); f paints. A drum gone leaves its ring on the shelf. */
  function depotDrums(depot, x = DEPOT_X[0], f = px) {
    drumsOf(x).forEach(([dx, dy], i) => {
      if (!depot || i >= depot.drums) { f(dx, dy + 7, 4, 1, WOOD[1]); return; }
      f(dx, dy, 4, 8, FUEL); f(dx, dy, 4, 1, RED_LIGHT); f(dx + 3, dy + 1, 1, 7, RED_DARK); f(dx, dy + 3, 4, 1, RED_DARK); f(dx, dy + 6, 4, 1, RED_DARK); // its rim, its shaded side, its two hoops
    });
    if (!depot) return;
    if (depot.lamp !== 'red' || blink(2)) { f(x + 10, 26, 4, 2, LAMP_COLOURS[depot.lamp]); f(x + 10, 26, 1, 1, '#ffffff'); } else f(x + 10, 26, 4, 2, '#5a1f19'); // red blinks: between flashes, unlit red
  }

  // Night: the searchlights' beams sweeping the sky, and now and then an illumination flare drifting down over the
  // field under a little parachute. Both are drawn over everything (top), the sky too, with their light (PXG.lights,
  // as the farm's fireflies) so the night shows them; nothing else at night is drawn there. White light only: no tracers.
  const BEAM = '#f4ecd8';
  /** Where a searchlight's beam points at T: radians from straight up (left negative), each sweeping its own slow way across the sky. */
  const beamAngle = (i, T) => (i ? 0.3 : -0.3) + Math.sin(T * 0.3 + i * 2.2) * 0.85;
  /** How strongly the night's beams and flare show, from how dark it is (0 day … 1 night): none by day, all at night. */
  const nightOf = dark => Math.max(0, Math.min(1, (dark - 0.4) / 0.4));
  /** A searchlight's beam, from its lens at (x, y) up through the sky at angle a, widening and fading; k how strongly (nightOf). Its light goes along it. */
  function searchBeam(x, y, a, k) {
    const top = Math.min(0, PXG.ext?.y0 ?? 0), tan = Math.tan(a), sec = 1 / Math.cos(a);
    for (let t = 1; y - t >= top; t++) {
      const cx = x + tan * t, half = (0.6 + t * 0.14) * sec;
      PXG.ctx.globalAlpha = k * 0.5 * Math.max(0.3, 1 - t / 40);
      px(Math.round(cx - half), y - t, Math.max(1, Math.round(2 * half)), 1, BEAM);
      if (t % 4 === 0) PXG.lights?.push([Math.round(cx), y - t, Math.round(half) + 2, null]);
    }
    PXG.ctx.globalAlpha = 1;
  }
  const FLARE = { every: 45, burn: 16, lead: 6, drop: 180 }; // seconds between flares, seconds each burns, how far into its burn the first is at T 0, how far down it drifts (px)
  /** The illumination flare at T: { x, y, k: how far through its burn } while one drifts down over the field (from the sky, under its parachute), else null. */
  function flareAt(T) {
    const n = Math.floor((T + FLARE.lead) / FLARE.every), t = T + FLARE.lead - n * FLARE.every;
    if (t >= FLARE.burn) return null;
    const k = t / FLARE.burn;
    return { x: Math.round(170 + ((n * 97) % 190) + k * 16 + Math.sin(t * 0.7) * 3), y: Math.round(k * FLARE.drop), k };
  }
  /** The illumination flare at { x, y, k }: a little white parachute, its cords, and under them the flare burning white in its glare, dimming at the end of its burn; its light pools on the field under it. */
  function illuminationFlare({ x, y, k }, strength, T) {
    const fade = k > 0.85 ? (1 - k) / 0.15 : 1;
    px(x - 2, y - 10, 5, 1, '#ffffff'); px(x - 3, y - 9, 7, 2, '#e6eef5'); px(x - 3, y - 9, 7, 1, '#ffffff'); // its parachute
    line(px, x - 3, y - 7, x, y - 2, '#c3cbd2'); line(px, x + 3, y - 7, x, y - 2, '#c3cbd2'); // its cords
    PXG.ctx.globalAlpha = (0.45 + 0.1 * Math.sin(T * 13)) * fade; disc(x, y, 3, '#ffffff'); PXG.ctx.globalAlpha = 1; // its glare, flickering
    px(x - 1, y - 1, 2, 2, '#ffffff'); // the flare
    PXG.lights?.push([x, y, Math.round(30 * fade * strength), null]);
  }

  /* ---------- the props and movers: what soldiers hold, what is on and over them, drones, jeeps, dispatch riders ---------- */

  // What a soldier holds for each step, drawn round its 14 × 16 sprite (rp paints in its pixels: the soldier spans
  // x 1–12 and rows 0–15, its hands at x 2 and 11 on row 12, its mouth on row 7); what it works with stands on the
  // ground at its right, on row 15. The field exercise's own props, through the props kit; the kit's for the rest
  // (a plug for an MCP call, whose jeep is what shows it, a scroll for a skill, and plan mode's blueprint). A
  // drill's kit: nothing is a weapon, and the signal flare goes straight up, never at anyone.
  const HAND = '#e0a878', EARTH = '#7a5230', EARTH_LIGHT = '#86603a', TIN = '#9aa4ad', SHINE = '#c3cbd2';
  const MILITARY_PROPS = {
    manual(rp, T) { // reading: the field manual open in both hands, its olive cover round it, a page turning
      const turn = Math.floor(T * 1.5) % 4;
      rp(2, 10, 10, 4, OLIVE[0]); rp(3, 10, 8, 3, '#f4ecd8'); rp(7, 10, 1, 3, SHINE); // its cover, its pages, the spine
      rp(4, 11, 2, 1, TIN); rp(8, 12, 2, 1, TIN); // its print
      if (turn === 1) rp(8, 9, 3, 1, '#ffffff'); else if (turn === 2) rp(6, 9, 3, 1, '#ffffff'); // a page lifting, turning over
      rp(2, 12, 1, 1, HAND); rp(11, 12, 1, 1, HAND);
    },
    binoculars(rp, T) { // searching: binoculars to its eyes, sweeping slowly across
      const dx = Math.round(Math.sin(T * 1.6));
      rp(3 + dx, 5, 3, 3, DARK); rp(8 + dx, 5, 3, 3, DARK); rp(6 + dx, 6, 2, 1, STEEL); // the two barrels, the bridge
      rp(3 + dx, 5, 3, 1, OLIVE[1]); rp(8 + dx, 5, 3, 1, OLIVE[1]); // their olive tops
      rp(4 + dx, 6, 1, 1, '#a9dcf7'); rp(9 + dx, 6, 1, 1, blink(2) ? '#ffffff' : '#a9dcf7'); // the lenses, a glint
      rp(3 + dx, 8, 1, 1, HAND); rp(10 + dx, 8, 1, 1, HAND);
    },
    radioSet(rp, T) { // the web: a field radio set on the ground beside it, its aerial up and sending, the handset at its ear
      rp(14, 9, 7, 6, OLIVE[0]); rp(15, 10, 5, 4, OLIVE[1]); rp(15, 10, 5, 1, OLIVE[2]); // the set
      rp(16, 12, 2, 1, DARK); rp(19, 12, 1, 1, blink(3) ? '#ffd43b' : '#c8681a'); // its dial, its lamp
      rp(19, 2, 1, 7, SHINE); rp(19, 1, 1, 1, RED); // its aerial, the tip
      for (let k = 1, n = Math.floor(T * 4) % 4; k <= n; k++) { rp(19 + 2 * k, 2 - k, 1, 2 * k - 1, '#5ab4ff'); rp(19 - 2 * k, 2 - k, 1, 2 * k - 1, '#5ab4ff'); } // its waves going out
      rp(10, 5, 2, 3, DARK); rp(12, 8, 1, 1, DARK); rp(13, 9, 1, 1, DARK); // the handset at its ear, its cord
    },
    shovel(rp) { // editing: digging in with a long shovel, a heap of earth beside it
      rp(18, 13, 5, 3, EARTH); rp(19, 12, 3, 1, EARTH_LIGHT); // the heap
      if (blink(2.5)) { rp(10, 7, 2, 1, WOOD[1]); line(rp, 12, 8, 15, 12, WOOD[3]); rp(15, 13, 3, 3, TIN); rp(15, 13, 3, 1, SHINE); } // the blade driven in
      else { rp(10, 11, 2, 1, WOOD[1]); line(rp, 12, 10, 15, 7, WOOD[3]); rp(16, 4, 3, 3, TIN); rp(16, 4, 3, 1, SHINE); rp(18, 2, 2, 2, EARTH); } // lifted, a clod thrown onto the heap
    },
    sandbag(rp, T) { // a new file: filling a fresh sandbag from a scoop; full, it is tied off
      const n = Math.floor(T * 2) % 4;
      rp(14, 9, 6, 6, CANVAS_LIGHT); rp(14, 9, 1, 6, CANVAS_SHADE); rp(19, 9, 1, 6, CANVAS_SHADE); rp(14, 14, 6, 1, CANVAS_DARK); // the bag, open
      rp(15, 13 - n, 4, n + 1, SAND_EDGE); // the sand in it
      if (n === 3) { rp(15, 8, 4, 1, WOOD[1]); return; } // full: tied off
      rp(11, 8, 1, 2, WOOD[2]); rp(12, 7, 4, 1, TIN); rp(15, 6, 2, 1, TIN); rp(16, 8 + (Math.floor(T * 8) % 2), 1, 1, SAND_EDGE); // the scoop tipped over it, sand pouring
    },
    mineDetector(rp, T) { // tests: a mine detector swept to and fro over the practice range, headphones on: its round search ring flat on the ground at its feet, on a pole steeply down from its hands; over the training marker, its light shows green
      const c = 15 + Math.round(Math.sin(T * 2.4) * 2); // the ring's middle, swept from x 13 to 17
      rp(2, 5, 2, 2, DARK); rp(10, 5, 2, 2, DARK); // its headphones
      rp(14, 14, 3, 1, '#ffd43b'); rp(15, 14, 1, 1, K); // a training marker, half buried
      line(rp, 12, 9, c, 14, STEEL); // its pole, from its hands down to the ring's middle
      rp(c - 2, 13, 5, 1, DARK); rp(c - 3, 14, 1, 1, DARK); rp(c + 3, 14, 1, 1, DARK); rp(c - 2, 15, 5, 1, DARK); // the search ring, an open loop lying flat round the pole's foot
      rp(10, 8, 2, 2, OLIVE[1]); rp(10, 8, 1, 1, Math.abs(c - 15) <= 1 ? '#6cc04a' : '#2f6b2f'); // its control box at its hands, its light
    },
    brush(rp) { // lint: cleaning its kit, brushing a helmet on the ground till it shines
      rp(13, 14, 3, 2, TIN); rp(13, 14, 3, 1, '#e6eef5'); // the cleaning kit's tin
      rp(17, 12, 5, 3, OLIVE[1]); rp(18, 11, 3, 1, OLIVE[1]); rp(18, 11, 2, 1, OLIVE[2]); rp(16, 14, 7, 1, OLIVE[0]); // the helmet
      const bx = 16 + blink(3) * 3;
      rp(12, 10, bx - 12, 1, WOOD[2]); rp(bx, 9, 3, 2, WOOD[3]); rp(bx, 11, 3, 1, '#e9c46a'); // the brush, to and fro over it
      if (blink(2)) rp(21, 12, 1, 1, '#ffffff'); // a shine
    },
    toolbox(rp) { // a build: its red toolbox open on the ground, a spanner in its hand, turning
      rp(14, 11, 8, 4, RED_DARK); rp(14, 11, 8, 1, RED); rp(16, 9, 4, 1, DARK); rp(16, 10, 1, 1, DARK); rp(19, 10, 1, 1, DARK); // the box, its handle
      rp(15, 10, 1, 1, SHINE); rp(20, 9, 1, 2, '#ffd43b'); // a spanner and a screwdriver sticking out
      if (blink(3)) { rp(12, 5, 1, 6, SHINE); rp(11, 4, 1, 1, SHINE); rp(13, 4, 1, 1, SHINE); } // raised
      else { line(rp, 12, 10, 15, 8, SHINE); rp(16, 7, 1, 1, SHINE); rp(16, 9, 1, 1, SHINE); rp(17, 8, 1, 1, '#ffd43b'); } // turning, a glint
    },
    crateDolly(rp) { // installing: a supply crate wheeled in on a dolly, rocking as it rolls; an arrow: in
      const tilt = blink(4);
      rp(12, 6, 1, 9, STEEL); rp(12, 14, 6, 1, STEEL); // the dolly's upright, its toe plate
      rp(13, 8 + tilt, 5, 6 - tilt, OLIVE[1]); rp(13, 8 + tilt, 5, 1, OLIVE[2]); rp(14, 10 + tilt, 3, 1, '#ffffff'); // the crate, its stencil
      rp(11, 15, 3, 1, DARK); rp(12 - blink(6), 15, 1, 1, TIN); // its wheel, turning
      rp(20, 4, 1, 4, '#2fa57a'); rp(19, 7, 3, 1, '#2fa57a'); rp(20, 8, 1, 1, '#2fa57a'); // an arrow down: in
    },
    stampedCrate(rp) { // a commit: a stamp brought down on a supply crate, leaving its red mark
      const up = blink(2);
      rp(14, 10, 7, 5, WOOD[1]); rp(15, 11, 5, 3, WOOD[4]); rp(15, 12, 5, 1, WOOD[3]); // the crate, its slats
      rp(15, 7 - up * 3, 4, 2, '#9c3b30'); rp(16, 4 - up * 3, 2, 3, WOOD[2]); // the stamp on its handle
      if (!up) { rp(16, 12, 3, 1, RED); rp(17, 11, 1, 1, RED); } // its mark
    },
    wheelbarrow(rp) { // a push: a wheelbarrow of sandbags pushed off, its wheel turning; an arrow: up, to the remote
      const bump = blink(4);
      rp(11, 11, 3, 1, WOOD[2]); // its handles, from its hands
      rp(14, 10 - bump, 7, 3, OLIVE[1]); rp(14, 10 - bump, 7, 1, OLIVE[2]); rp(15, 13 - bump, 5, 1, OLIVE[0]); // its tray
      rp(15, 8 - bump, 3, 2, CANVAS); rp(18, 8 - bump, 2, 2, CANVAS_LIGHT); // sandbags in it
      rp(19, 13, 3, 3, DARK); rp(20, 14, 1, 1, blink(6) ? TIN : DARK); rp(14, 13, 1, 3, WOOD[1]); // its wheel, its leg
      rp(23, 4, 1, 5, '#2fa57a'); rp(22, 4, 3, 1, '#2fa57a'); rp(23, 3, 1, 1, '#2fa57a'); // an arrow up
    },
    flarePistol(rp, T) { // a deploy: a fat orange flare launcher held straight up beside its head, a signal flare shooting up out of it and bursting green high over its head
      rp(11, 3, 5, 1, '#c8681a'); // its wide mouth
      rp(12, 4, 3, 7, '#f08a24'); rp(12, 4, 1, 7, '#ffd43b'); rp(14, 4, 1, 7, '#c8681a'); rp(12, 6, 3, 1, '#ffffff'); // the fat tube, lit on its left, a white band
      rp(12, 11, 3, 1, '#9c3b30'); rp(11, 10, 1, 2, HAND); rp(15, 10, 1, 2, HAND); // its foot, held in both hands
      const p = (T * 0.7) % 1;
      if (p < 0.12) { rp(12, 1, 3, 2, '#e6eef5'); rp(13, 0, 1, 1, '#ffffff'); } // just fired: a puff at its mouth
      if (p < 0.5) { const y = 1 - Math.round((p / 0.5) * 14); rp(13, y, 1, 2, '#ffffff'); rp(13, y + 2, 1, 1, '#9ed36a'); rp(13, y + 4, 1, 1, '#ffd43b'); } // the flare going up, sparks trailing
      else if (p < 0.85) { // its green star, bursting
        const r = 2 + Math.round(((p - 0.5) / 0.35) * 2);
        rp(12, -14, 3, 3, '#6cc04a'); rp(13, -13, 1, 1, '#ffffff');
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) rp(13 + dx * r, -13 + dy * r, 1, 1, '#c6e89a');
      }
    },
    mailSack(rp, T) { // a pull: a mail sack held by its neck, letters dropping in
      const dy = Math.floor(T * 3) % 4;
      rp(13, 9, 6, 6, CANVAS_LIGHT); rp(14, 8, 4, 1, CANVAS_LIGHT); rp(17, 9, 2, 6, CANVAS_SHADE); rp(13, 14, 6, 1, CANVAS_DARK); // the sack
      rp(13, 11, 6, 1, RED); rp(13, 12, 6, 1, '#3d7be0'); rp(15, 7, 2, 1, WOOD[1]); // the mail's stripes, its neck tied
      if (dy < 3) { rp(14, 1 + dy * 2, 4, 3, '#f4ecd8'); rp(15, 2 + dy * 2, 2, 1, RED); } // a letter dropping in, sealed
    },
    fieldGenerator(rp, T) { // a server: a field generator on the ground beside it, humming (it shakes), its lamp blinking, a wisp from its exhaust
      const j = blink(12);
      rp(14, 15, 9, 1, WOOD[1]); // its skids
      rp(14 + j, 9, 8, 6, OLIVE[0]); rp(15 + j, 10, 6, 4, OLIVE[1]); rp(15 + j, 10, 6, 1, OLIVE[2]); // its case
      for (let i = 0; i < 3; i++) rp(16 + i * 2 + j, 12, 1, 2, OLIVE[0]); // its grille
      rp(20 + j, 11, 1, 1, blink(2) ? '#6cc04a' : '#2f6b2f'); rp(15 + j, 7, 2, 2, STEEL); // its lamp, its exhaust
      if (Math.floor(T * 1.5) % 2) rp(15, 4, 2, 2, SHINE); // a wisp
    },
    spade(rp) { // deleting: clearing a heap away with a short sapper's spade, clods flying off it
      rp(16, 13, 5, 3, EARTH_LIGHT); rp(17, 12, 3, 1, EARTH); // the heap
      if (blink(3)) { rp(12, 5, 1, 5, WOOD[2]); rp(11, 2, 3, 3, TIN); rp(12, 1, 1, 1, TIN); rp(11, 2, 3, 1, SHINE); } // raised, its pointed blade up
      else { line(rp, 12, 10, 14, 12, WOOD[2]); rp(15, 12, 2, 2, TIN); rp(16, 14, 1, 1, TIN); rp(19, 10, 1, 1, EARTH); rp(21, 8, 1, 1, EARTH); rp(20, 11, 1, 1, EARTH_LIGHT); } // chopping in, clods flying
    },
    whistle(rp, T) { // calling helpers: blowing its whistle for its drones, the call going out
      rp(7, 7, 3, 1, SHINE); rp(10, 7, 1, 1, TIN); rp(8, 8, 1, 2, '#ffd43b'); // the whistle at its mouth, its lanyard
      for (let k = 1, n = 1 + (Math.floor(T * 4) % 3); k <= n; k++) { const x = 11 + 2 * k; rp(x, 7 - k, 1, 1, '#ffffff'); rp(x + 1, 8 - k, 1, 2 * k - 1, '#ffffff'); rp(x, 7 + k, 1, 1, '#ffffff'); } // its call going out
    },
    mapCase(rp, T) { // planning: an open map case in its hands, a route marked in red across the map as it goes
      rp(1, 9, 12, 5, WOOD[1]); rp(2, 10, 10, 3, '#9ed36a'); rp(5, 10, 1, 3, '#5ab4ff'); rp(9, 10, 2, 2, '#6b8f4a'); // the case, the map: a river, a wood
      const n = Math.floor(T * 2.5) % 5;
      for (let i = 0; i < n; i++) rp(2 + i * 2, 12 - (i % 2), 1, 1, RED); // the route, marked as it goes
      rp(2 + n * 2, 7, 1, 3, '#f0b429'); rp(2 + n * 2, 10, 1, 1, K); // the pencil
    },
    messageCard(rp) { // asking: holding up a message card, a red stripe along its top, a big question mark
      rp(13, 4, 7, 9, '#e8d8b0'); rp(13, 4, 7, 2, RED); // the card, its stripe
      rp(15, 7, 3, 1, K); rp(17, 8, 1, 1, K); rp(16, 9, 1, 1, K); rp(16, 11, 1, 1, blink(2) ? K : '#c9b48a'); // ?
      rp(12, 11, 2, 1, HAND);
    },
    fieldPhone(rp) { // a command: the field telephone in its wooden case on the ground, its crank turned to ring through, the handset at its ear
      const up = blink(4);
      rp(14, 10, 7, 5, WOOD[1]); rp(15, 11, 5, 3, WOOD[3]); rp(15, 11, 5, 1, WOOD[4]); rp(16, 12, 3, 1, DARK); // its case
      rp(21, 12, 1, 1, STEEL); if (up) { rp(22, 10, 1, 2, STEEL); rp(22, 9, 1, 1, K); } else { rp(22, 13, 1, 2, STEEL); rp(22, 15, 1, 1, K); } // its crank, turning
      if (up) { rp(17, 7, 1, 1, '#ffd43b'); rp(19, 8, 1, 1, '#ffd43b'); } // ringing
      rp(10, 5, 2, 3, K); rp(12, 8, 1, 1, K); rp(13, 9, 1, 1, K); // the handset at its ear, its cord
    },
  };
  // Each step's prop, and what the soldier is doing (its tip and the field log's line), in drill words; where it
  // stands at its position stays the kit's (left for looking things up, right for working, the middle for the rest).
  const props = window.Agentville.props.kit({
    steps: {
      read: { prop: 'manual', verb: 'reading the field manual' },
      search: { prop: 'binoculars', verb: 'scanning with binoculars' },
      web: { prop: 'radioSet', verb: 'on the radio set' },
      mcp: { verb: 'calling up a jeep' },
      skill: { verb: 'following standing orders' },
      edit: { prop: 'shovel', verb: 'digging in' },
      write: { prop: 'sandbag', verb: 'filling a sandbag' },
      test: { prop: 'mineDetector', verb: 'sweeping the practice range' },
      lint: { prop: 'brush', verb: 'cleaning its kit' },
      build: { prop: 'toolbox', verb: 'fixing up with the toolbox' },
      install: { prop: 'crateDolly', verb: 'wheeling in supplies' },
      commit: { prop: 'stampedCrate', verb: 'stamping a supply crate' },
      push: { prop: 'wheelbarrow', verb: 'barrowing supplies out' },
      deploy: { prop: 'flarePistol', verb: 'sending up a signal flare' },
      pull: { prop: 'mailSack', verb: 'collecting the mail sack' },
      serve: { prop: 'fieldGenerator', verb: 'running the field generator' },
      delete: { prop: 'spade', verb: "clearing with a sapper's spade" },
      agent: { prop: 'whistle', verb: 'whistling up its drones' },
      plan: { prop: 'mapCase', verb: 'plotting a route' },
      ask: { prop: 'messageCard', verb: 'holding up a message card' },
      shell: { prop: 'fieldPhone', verb: 'on the field telephone' },
      other: { prop: 'fieldPhone', verb: 'working the field telephone' },
      planMode: { verb: 'drawing up the plan of manoeuvres (plan mode)' },
    },
    props: MILITARY_PROPS,
  });

  // On a soldier, drawn with it (drawChar): its model's pin on its headgear, its chevrons, a hazard armband; behind
  // it while it thinks, a radio pack; in reserve, greyed a little.
  const FAMILY_PIN = { opus: '#8a5fc0', sonnet: '#3d7be0', haiku: '#2fa57a', fable: '#f08a24' }; // the farm's pins: purple Opus, blue Sonnet, green Haiku, orange Fable
  /** How many chevrons a soldier wears for what it has cost: one from $1, two from $10, three from $50 (the farm's and the factory's thresholds); none below $1, or with no cost. */
  const chevronsOf = cost => (cost >= 50 ? 3 : cost >= 10 ? 2 : cost >= 1 ? 1 : 0);
  const GOLD = ['#ffd43b', '#c9a24a']; // the chevrons' gold and brass, by turns, so each shows
  /**
   * Its chevrons on its sleeve (on the left as you look at it, from the front or behind): a stripe each across the
   * arm, gold and brass by turns; one or two on the sleeve, a third up to the shoulder. (A soldier's arm is two
   * pixels wide: stripes, not Vs, are what show and count at its size.)
   */
  function chevrons(rp, n) {
    for (let i = 0; i < n; i++) rp(1, (n < 3 ? 10 : 9) + i, 2, 1, GOLD[i % 2]);
  }
  // The pin's column on the headgear's front in each view (none from behind); its rows are the headgear's front, 3–4.
  const PIN_X = { down: 7, right: 8, left: 4 };
  /** Its model's pin on its headgear: a 2 × 2 badge in the model's colour, a glint on it. */
  function headgearPin(rp, view, colour) {
    if (PIN_X[view] == null || !colour) return;
    rp(PIN_X[view], 3, 2, 2, colour); rp(PIN_X[view], 3, 1, 1, '#ffffff');
  }
  /** Bypass permissions: a yellow and black hazard band round its upper arm (on the right as you look at it; raised, while it waves). */
  function armband(rp, waving) {
    const [x, y] = waving ? [12, 7] : [11, 10];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) rp(x + i, y + j, 1, 1, (i + j) % 2 ? K : '#ffd43b');
  }
  /** Thinking: a radio pack on its back (drawn before it, so it shows round its shoulders), its aerial up past its headgear, the tip blinking as it sends. */
  function radioPack(rp, T) {
    rp(1, 6, 12, 7, OLIVE[0]); rp(1, 6, 12, 1, OLIVE[1]); // the pack
    rp(12, -5, 1, 11, SHINE); // its aerial
    const on = blink(3);
    rp(12, -6, 1, 1, on ? RED_LIGHT : '#9c3b30');
    if (on) { rp(10, -7, 1, 1, '#ffffff'); rp(14, -7, 1, 1, '#ffffff'); } // sending
  }
  // Every letter of a soldier grey: its veil in reserve, laid over it half seen.
  const VEIL = Object.fromEntries([...'khwbrsgpCcoOPLlVvUuXxJjNeE'].map(k => [k, TIN]));
  /** In reserve: its sprite greyed a little, a grey veil of its shape over it. */
  function greyVeil(look, opts, ox, oy) {
    PXG.ctx.globalAlpha = 0.4;
    PXG.ctx.drawImage(personSprite(look, TIN, { ...opts, palette: VEIL }), ox, oy, 14 * SC, 16 * SC);
    PXG.ctx.globalAlpha = 1;
  }

  // Over and beside a soldier (drawFx).
  /** Fast mode: speed lines streaming off it: behind it as it goes (on its left, unless it goes left). */
  function speedLines(rp, b, T) {
    const right = b.walk && b.face === 'left';
    for (const [y, n] of [[4, 3], [8, 2], [12, 3]]) { const w = n + ((Math.floor(T * 10) + y) % 2); rp(right ? 15 : -1 - w, y, w, 1, '#ffffff'); }
  }
  /** A hot CPU: sweat drops flying off its brow either side, and one running down its cheek. */
  function sweat(rp, T) {
    for (const [k, side] of [[0, -1], [1, 1]]) {
      const p = (T * 1.8 + k / 2) % 1;
      rp((side < 0 ? 2 : 11) + side * Math.round(p * 3), 3 + Math.round(p * 4 + p * p * 4), 1, 2, '#5ab4ff');
    }
    rp(9, 6 + (Math.floor(T * 3) % 2), 1, 1, '#a9dcf7');
  }
  /** Its task list: a clipboard on a stake beside it, a tick for each done (on three rows), a bar for how far it has got. */
  function clipboard(rp, t) {
    const rows = Math.min(3, t.total), done = Math.max(0, Math.min(t.done, t.total)), ticked = Math.round((done / t.total) * rows);
    rp(-6, 11, 1, 5, WOOD[1]); // its stake
    rp(-10, 2, 8, 10, WOOD[2]); rp(-9, 4, 6, 7, '#f4ecd8'); rp(-8, 1, 4, 2, TIN); // the board, its sheet, its clip
    for (let r = 0; r < rows; r++) { rp(-8, 5 + r * 2, 1, 1, r < ticked ? '#2fa57a' : SHINE); rp(-6, 5 + r * 2, 2, 1, '#c9b48a'); }
    rp(-9, 10, Math.max(done ? 1 : 0, Math.round((6 * done) / t.total)), 1, '#6cc04a');
  }
  /** Idle: eating at the mess table, a spoon from its plate to its mouth and back (its eyes shut: it's good). */
  function eating(rp) {
    if (blink(1.2)) { rp(7, 7, 2, 1, SHINE); rp(7, 7, 1, 1, '#c8681a'); line(rp, 9, 8, 11, 11, SHINE); } // up to its mouth, stew on it
    else { rp(11, 9, 1, 3, SHINE); rp(10, 12, 2, 1, SHINE); } // down to its plate
  }
  /** A plan for you: a rolled map carried in both arms, the map's green showing at its ends, tied with red. */
  function rolledMap(rp) {
    rp(0, 11, 14, 2, '#f4ecd8'); rp(0, 11, 14, 1, '#ffffff'); rp(0, 11, 1, 2, '#9ed36a'); rp(13, 11, 1, 2, '#9ed36a'); rp(6, 11, 1, 2, RED);
  }
  /** Your turn: the dispatch it brings back, held in front: a buff envelope, its flap, a red seal. */
  function dispatch(rp) {
    rp(3, 9, 8, 5, '#e8d8b0'); rp(3, 9, 8, 1, '#c9b48a'); rp(4, 10, 1, 1, '#c9b48a'); rp(9, 10, 1, 1, '#c9b48a'); rp(5, 11, 1, 1, '#c9b48a'); rp(8, 11, 1, 1, '#c9b48a');
    rp(6, 11, 2, 2, RED); rp(2, 11, 1, 2, HAND); rp(11, 11, 1, 2, HAND);
  }

  // The drones: subagents. A small quadcopter hovers by its soldier for each running one (follow), and an Explore
  // one is the K9: the library's dog in a harness, trotting about its soldier. Finished ones sit docked on the drone
  // pad's deck; the running ones no soldier can lead circle over it (top: they rise past the hedge into the sky).
  /** A small quadcopter at (x, y), its middle, seen from the front: a rotor whirring at each end of its arms, an olive body, a band in its soldier's colour, a light under it. */
  function drone(x, y, band, T, k = 0) {
    const spin = Math.floor(T * 16 + k) % 2;
    for (const r of [x - 4, x + 4]) { px(r - 2, y - 3, 5, 1, spin ? SHINE : TIN); px(r, y - 3, 1, 1, DARK); } // its rotors, a blur
    px(x - 4, y - 2, 9, 1, DARK); // its arms
    px(x - 2, y - 1, 5, 3, OLIVE[0]); px(x - 1, y - 1, 3, 1, OLIVE[2]); exact(x - 1, y, 3, 1, /^#[0-9a-f]{6}$/i.test(band ?? '') ? band : '#ffd43b'); // its body, its band
    px(x, y + 2, 1, 1, blink(3) ? '#6cc04a' : '#2fa57a'); // its light
  }
  /** An Explore subagent: the K9, the library's dog in an olive harness with a yellow patch, trotting about its soldier and stopping to sniff at each turn. */
  function k9(x, y, T, k) {
    const s = Math.sin(T * 0.8 + k), p = creaturePainter(x, y, s > 0 ? -1 : 1);
    CREATURES.dog.draw(p, Math.abs(s) > 0.35 ? 'walk' : 'stand', T);
    p(-1, -6, 3, 3, OLIVE[0]); p(-1, -6, 3, 1, OLIVE[1]); p(0, -5, 1, 1, '#ffd43b'); // its harness
  }
  const PAD_BERTHS = [[98, 43], [107, 43], [116, 43], [98, 47], [107, 47], [116, 47]]; // the drone pad's six berths on its deck: a docked drone's top left
  const PAD_SKY = [111, 26]; // where drones circle over the pad
  /** A finished subagent's drone, docked on the pad at (x, y), its top left: its rotors folded along its arms (pale on the steel deck), charging. */
  function dockedDrone(x, y) {
    px(x, y, 7, 1, SHINE); px(x + 1, y + 1, 5, 2, OLIVE[1]); px(x + 2, y + 1, 3, 1, OLIVE[2]); px(x + 3, y + 2, 1, 1, blink(1) ? '#ffd43b' : '#f0b429');
  }

  // The jeeps: one for each MCP server called in the last hour (the scene's carts, six at most), each in its own
  // place in the vehicle park (PARK). While a soldier calls its server, its jeep drives over and waits beside it until
  // the call is done and a moment after (the farm's carts' rule), then drives back.
  const JEEP_SPEED = 55, JEEP_STAY_MS = 3000;
  const JEEP_LOADS = ['#c9a46a', '#e04a3a', '#3d7be0', '#6cc04a', '#8a5fc0', '#f0b429']; // a crate in the back in each server's colour
  /** A jeep's way between two places: along its row to the left side's path, up or down it, then along the other row. */
  function jeepRoute([x, y], [tx, ty]) {
    if (Math.abs(y - ty) < 0.5) return [[tx, ty]];
    const pts = [[CORR[0], y], [CORR[0], ty], [tx, ty]];
    return pts.filter((p, i) => { const q = i ? pts[i - 1] : [x, y]; return p[0] !== q[0] || p[1] !== q[1]; });
  }
  /**
   * Where a jeep heads: beside the soldier calling it; once there it stays while the call goes on and a few
   * seconds after (so a short call is seen, and a run of them keeps it there), then back to the park. `c` is its
   * memory: { goal, arrivedAt, lastBusy }.
   */
  function jeepGoal(c, busyAt, home, now) {
    if (busyAt) {
      if (!c.goal || c.goal[0] !== busyAt[0] || c.goal[1] !== busyAt[1]) { c.goal = busyAt; c.arrivedAt = null; }
      c.lastBusy = now;
      return c.goal;
    }
    if (c.goal && (c.arrivedAt == null || now - Math.max(c.lastBusy ?? 0, c.arrivedAt) < JEEP_STAY_MS)) return c.goal;
    c.goal = null;
    return home;
  }
  /** A painter for something seen from the side at (x, y), its feet, facing `dir` (1 right, −1 left): (dx, dy, w, h, c) as facing right, mirrored round x. */
  const sideOn = (x, y, dir) => (dx, dy, w, h, c) => px(dir > 0 ? x + dx : x - dx - w + 1, y + dy, w, h, c);
  /** A jeep at (x, y), its wheels on the ground, facing `dir`: an olive tub and bonnet, a white star, its windscreen, a crate in the back in its server's colour; moving, its wheels turn. */
  function drawJeep(x, y, dir, moving, load) {
    const m = sideOn(x, y, dir), turn = moving ? blink(8) : 0;
    px(x - 7, y + 1, 14, 1, SHADE); // its shadow
    m(-6, -6, 7, 4, OLIVE[1]); m(-6, -6, 7, 1, OLIVE[2]); m(1, -5, 6, 3, OLIVE[1]); m(1, -5, 6, 1, OLIVE[2]); m(-6, -3, 13, 1, OLIVE[0]); // its tub, its bonnet
    m(-7, -5, 1, 3, DARK); m(1, -9, 1, 4, DARK); m(2, -8, 1, 2, '#a9dcf7'); // its spare wheel, its windscreen
    m(3, -4, 1, 1, '#ffffff'); m(4, -5, 1, 3, '#ffffff'); m(5, -4, 1, 1, '#ffffff'); m(6, -4, 1, 1, '#ffe8a3'); // a white star, its headlight
    m(-5, -8, 4, 2, load); m(-5, -8, 4, 1, '#fff4d6'); // a crate in the back
    for (const wx of [-5, 3]) { m(wx, -2, 3, 3, K); m(wx + 1, -1, 1, 1, turn ? SHINE : STEEL); } // its wheels
  }

  // The dispatch riders: a web call going on (not a browser's: its jeep goes). Its rider rides out of the motor pool
  // gate along the track to the soldier, waits there a moment, and rides back: 8 s a round, each on its own beat.
  const RIDER_Y = 88; // where riders ride: the track's front, in front of HQ's queue
  /** Where a soldier's dispatch rider is (b: where the soldier is): { x, dir, moving } on the track, or null with no web call going on. */
  function riderAt(f, b, T) {
    if (!b || f.state !== 'working' || !f.service || f.step !== 'web' || String(f.tool ?? '').startsWith('mcp__')) return null;
    const ph = (T / 8 + (hashOf(f.id) % 97) / 97) % 1, to = Math.max(12, Math.min(W - 12, Math.round(Number.isFinite(b.tx) ? b.tx : b.x)));
    const d = to - GATE[0], out = d < 0 ? -1 : 1, ease = s => (s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2);
    if (ph < 0.35) return { x: GATE[0] + d * ease(ph / 0.35), dir: out, moving: true };
    if (ph < 0.65) return { x: to, dir: out, moving: false };
    return { x: to - d * ease((ph - 0.65) / 0.35), dir: -out, moving: true };
  }
  /** A dispatch rider on its motorbike at (x, y), facing `dir`: olive, a satchel of dispatches on the back, the rider in khaki and an olive helmet; a puff of exhaust as it rides. */
  function motorbike(x, y, dir, moving) {
    const m = sideOn(x, y, dir);
    px(x - 6, y + 1, 12, 1, SHADE); // its shadow
    for (const wx of [-5, 3]) { m(wx, -2, 3, 3, K); m(wx + 1, -1, 1, 1, moving && blink(8) ? SHINE : STEEL); } // its wheels
    m(-3, -4, 7, 2, OLIVE[1]); m(-1, -5, 3, 1, OLIVE[2]); m(4, -6, 1, 3, DARK); m(5, -4, 1, 1, '#ffe8a3'); // its frame and tank, its forks, its headlight
    m(-5, -6, 3, 3, CANVAS); m(-5, -5, 3, 1, RED); // the satchel of dispatches
    m(-1, -10, 3, 5, '#a08a5a'); m(2, -8, 2, 1, '#a08a5a'); m(0, -5, 2, 2, '#8e7a4e'); // the rider: body, arm to the handlebar, leg
    m(-1, -12, 3, 2, HAND); m(1, -12, 1, 1, K); m(-1, -14, 3, 2, OLIVE[0]); m(-2, -13, 1, 1, OLIVE[0]); // its face, an eye, its helmet
    if (moving && blink(6)) px(dir > 0 ? x - 9 : x + 7, y - 2, 2, 1, SHINE); // exhaust
  }

  /* ---------- the hooks ---------- */

  /** A time of day, short: 14:05. */
  const clock = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  /** How long until a time, in short: 12m, 2h. */
  const until = at => { const m = Math.max(0, (at - Date.now()) / 60_000); return m < 1 ? 'a moment' : m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`; };

  function makeMilitary() {
    let L = MILITARY_GRID.layoutFor([]);
    let scene = { fields: [], farmers: [] };
    let gateLift = 0; // the motor pool's barrier: 0 down … 1 up, while a soldier comes through the gate
    let seenCompactions = null, seenMerged = null, seenLights = null; // what the last scene had, so news can be told
    const advancing = [], carried = []; // flags carried up-field (compactions): { key, color, t }; crates carried into the depot (merges): { t }
    let alert = 'summer'; // the live alert level, from your 5-hour limit
    // The level to draw: the engine's (the Alert switch may hold one), else the live one. What is drawn by the level reads this.
    const shown = () => PXG.season ?? alert;
    let dark = 0; // how dark it is (0 day … 1 night), from the sky last drawn (weather): for the night's beams, flare and smoke
    let where = () => null; // where each soldier is (the engine's, given to tick): for their headgear lamps at night
    const stOf = k => L.ST.find(s => s.key === k);
    const fieldByKey = k => scene.fields.find(f => f.key === k);
    const parkOf = new Map(), jeeps = new Map(); // server → its place in the vehicle park; server → its jeep: { x, y, path, to, dir, moving, goal, arrivedAt, lastBusy }
    /** The jeeps there are now (the scene's carts), each keeping its place in the park while its server has one. */
    function placeJeeps() {
      const list = scene.carts ?? [];
      for (const k of [...parkOf.keys()]) if (!list.some(c => c.server === k)) { parkOf.delete(k); jeeps.delete(k); }
      for (const c of list) if (!parkOf.has(c.server)) { const used = new Set(parkOf.values()); parkOf.set(c.server, PARK.findIndex((_, i) => !used.has(i))); }
      return list.filter(c => parkOf.get(c.server) >= 0); // the scene gives six at most, one a place
    }
    /** Beside a soldier (on the side away from the base's right edge): where it is going rather than where it is, so the jeep does not chase it step by step. */
    const besideOf = b => { const x = Number.isFinite(b.tx) ? b.tx : b.x, y = Number.isFinite(b.ty) ? b.ty : b.y; return [Math.round(x + (x > 360 ? -13 : 13)), Math.round(y)]; };
    /** Each frame: each jeep drives towards where jeepGoal sends it (or is put there, drawn still). */
    function moveJeeps(dt, posOf, snap) {
      const now = Date.now();
      for (const c of placeJeeps()) {
        const home = PARK[parkOf.get(c.server)];
        let s = jeeps.get(c.server);
        if (!s) jeeps.set(c.server, (s = { x: home[0], y: home[1], path: [], to: home, dir: 1 }));
        const b = c.busy ? posOf(c.busy) : null;
        const goal = jeepGoal(s, b ? besideOf(b) : null, home, now);
        if (goal[0] !== s.to[0] || goal[1] !== s.to[1]) { s.to = goal; s.path = jeepRoute([s.x, s.y], goal); }
        if (snap) { // no motion: it stands where it is going, facing the soldier (or the path, in the park)
          [s.x, s.y] = goal;
          s.path = [];
          s.dir = b && s.goal ? (goal[0] > (Number.isFinite(b.tx) ? b.tx : b.x) ? -1 : 1) : 1;
        }
        if (s.path.length) {
          const [qx, qy] = s.path[0], dx = qx - s.x, dy = qy - s.y, d = Math.hypot(dx, dy), sp = JEEP_SPEED * dt;
          if (Math.abs(dx) > 0.1) s.dir = Math.sign(dx);
          if (d <= sp) { s.x = qx; s.y = qy; s.path.shift(); } else { s.x += (dx / d) * sp; s.y += (dy / d) * sp; }
        } else if (s.goal && s.arrivedAt == null) s.arrivedAt = now; // there: it waits (jeepGoal says how long)
        else if (!s.goal) s.dir = 1; // back in its place, facing the path
        s.moving = s.path.length > 0;
      }
    }
    /** The dispatch riders out now, one for each soldier on a web call (where it is: the engine's, from tick). */
    const riders = () => scene.farmers.map(f => riderAt(f, where(f.id), PXG.T)).filter(Boolean);
    /** Each position shown, with its repo and what its soldiers bring: [{ s, f, color: whose flag it raises, jobs: background commands running }]. */
    const shownPositions = () => L.ST.flatMap(s => {
      const f = fieldByKey(s.key);
      if (!f) return [];
      const here = scene.farmers.filter(a => a.field === f.key);
      return [{ s, f, color: builderOf(here, f.key)?.shirt, jobs: here.reduce((n, a) => n + (a.jobs ?? 0), 0) }];
    });
    /** The positions, each frame: each one and what its repo's state puts round it; then the flags being carried up-field. */
    function drawPositions() {
      const T = PXG.T;
      for (const { s, f, color, jobs } of shownPositions()) drawPosition(s, f, { color, jobs, T });
      for (const a of advancing) { const s = stOf(a.key); if (s) carriedFlag(s, a, T); }
    }
    /**
     * The limits, each frame: the alert board at the level shown, the base's lights warm from high, and each fuel
     * depot's drums and lamp (a second account's depot is drawn here too, the ground having only the first).
     */
    function drawLimits() {
      const level = shown();
      alertFace(level);
      if (level === 'autumn' || level === 'winter') warmLights();
      for (const { x, depot } of depotsOf(scene)) {
        if (x !== DEPOT_X[0]) fuelDepot(px, x);
        depotDrums(depot, x);
      }
    }
    /**
     * The fuel depot's tooltip: the week's % used, the drums left and when it resets; or that there is no reading.
     * With two accounts, that there is a depot for each, and each one's week.
     */
    function depotTip() {
      const depots = depotsOf(scene);
      if (depots.length > 1) return `The fuel depots, one for each of your Claude accounts (the week used: ${depots.map(({ name, depot }) => `${name} ${depot ? `${depot.pct}%` : 'no reading'}`).join(', ')}). Click for their plans`;
      const d = depots[0].depot;
      if (!d) return "The fuel depot: your plan's weekly limit, no reading yet (it comes from the mod in a running session)";
      return `The fuel depot: your plan's weekly limit, ${d.reset ? 'just reset' : `${d.pct}% used`}, ${d.drums} of 8 drums left${d.resetsAt ? `; resets ${resetAt(d.resetsAt)}` : ''}. Click for your plan`;
    }
    return {
      key: 'military', W, SH: 16, corridors: CORR, grid: MILITARY_GRID, fromScene: militaryScene, help: helpHtml,
      nouns: { agent: 'soldier', agents: 'soldiers', repo: 'position', repos: 'positions', place: 'base' },
      seasonNames: ALERT_NAMES,
      coldSeason: null, // max alert is no weather: the mascots never act cold
      boardTitle: 'The briefing board: what your projects remember', // the engine opens it (the 'board' building)
      /**
       * A new scene; returns what happened since the last one: the line advanced (a compaction: its flag is carried
       * up-field), supplies came in (a pull request merged in the last 30 minutes: its crate is carried into the
       * quartermaster's depot), a deploy failing or going through (for the animals only).
       */
      setScene(next) {
        const events = [];
        const comp = new Map(next.farmers.map(f => [f.id, f.compactions ?? 0]));
        if (seenCompactions) for (const f of next.farmers) if (seenCompactions.has(f.id) && comp.get(f.id) > seenCompactions.get(f.id)) {
          events.push({ id: f.id, kind: 'harvest', text: 'Advanced!', cls: 'good', log: 'advances the line: its conversation was compacted, and its position starts again from the stakes' });
          if (f.field) { advancing.push({ key: f.field, color: f.shirt, t: 0 }); if (advancing.length > 6) advancing.shift(); }
        }
        seenCompactions = comp;
        const merged = next.fields.flatMap(fl => (fl.prs?.merged ?? []).map(m => ({ ...m, repo: fl.name, key: `${fl.key}#${m.number}` })));
        if (seenMerged) for (const m of merged) if (!seenMerged.has(m.key) && (m.at ?? 0) > Date.now() - 30 * 60_000) {
          events.push({ at: DEPOT_DOOR, kind: 'merged', text: `Supplies in! #${m.number}`, cls: 'good', who: "The quartermaster's depot", log: `${m.repo}: pull request #${m.number} merged${m.title ? ` (${clip(m.title, 50)})` : ''}` });
          if (carried.length < 4) carried.push({ t: 0 });
        }
        seenMerged = new Set(merged.map(m => m.key));
        const lights = new Map(next.fields.map(fl => [fl.key, fl.light ?? null]));
        if (seenLights) for (const [key, l] of lights) {
          const s = stOf(key), kind = l === 'failed' ? 'deployFailed' : l === 'ok' ? 'deployOk' : null;
          if (kind && s && seenLights.get(key) !== l) events.push({ kind, at: deployAt(s), text: '' });
        }
        seenLights = lights;
        scene = next;
        alert = alertOf(next.plan);
        return events;
      },
      layout: () => L,
      relayout(ground) { L = ground; return L; },
      spawn: () => GATE,
      /** Where its k-th running subagent's drone hovers: by its head, two a side; the K9 (an Explore one) trots to and fro at its feet. */
      follow: (b, k, T, kid) => (kid?.dog
        ? [b.x + Math.cos(T * 0.8 + k) * 20, b.y + 3 + Math.sin(T * 1.6 + k) * 2]
        : [b.x + (k % 2 ? 13 : -13) + Math.sin(T * 1.3 + k) * 1.5, b.y - 12 - (k > 1 ? 11 : 0) + Math.sin(T * 3 + k * 1.7) * 1.5]),
      /** The alert level, live: the engine shows it (or the level the Alert switch holds) as PXG.season. */
      season: () => alert,
      /** How fast a soldier walks: strolling at calm, faster when high, at the double at max; fast mode faster still. */
      speed: f => Math.round((ALERT[shown()] ?? ALERT.summer).speed * (f.fast ? 1.7 : 1)),
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
      /** Each frame, on the ground: the motor pool's barrier (lifted while a soldier comes through), the limits (the alert board, the fuel depots), the drones docked on the pad, the crates on the quartermaster's pallet and those carried in, the positions. */
      ground() {
        barrier(gateLift);
        drawLimits();
        PAD_BERTHS.slice(0, Math.min(6, scene.henhouse?.eggs ?? 0)).forEach(([x, y]) => dockedDrone(x, y)); // subagents that finished lately
        for (const c of depotCrates(scene.fields)) supplyCrate(c);
        for (const c of carried) carriedCrate(c.t);
        drawPositions();
      },
      /**
       * Drawn among the soldiers, by how far down they stand: the mess table in front of the idle ones, a crate before
       * each in reserve, a blanket over each cot; the jeeps, and the dispatch riders on the track.
       */
      items: () => [
        [MESS[0][1] + 1, messTable], ...RESERVE.map(([x, y]) => [y + 1, () => seatCrate(x, y)]), ...COTS.map(([x, y]) => [y + 1, () => blanket(x, y)]),
        ...placeJeeps().map(c => {
          const s = jeeps.get(c.server), [hx, hy] = PARK[parkOf.get(c.server)], x = Math.round(s?.x ?? hx), y = Math.round(s?.y ?? hy);
          return [y, () => drawJeep(x, y, s?.dir ?? 1, s?.moving, JEEP_LOADS[hashOf(c.server) % JEEP_LOADS.length])];
        }),
        ...riders().map(r => [RIDER_Y, () => motorbike(Math.round(r.x), RIDER_Y, r.dir, r.moving)]),
      ],
      /**
       * Each frame: the jeeps drive on. Is a soldier coming through the motor pool gate (walking by it)? The barrier
       * lifts, and comes down slowly after. Flags are carried up-field and crates into the depot, until they're gone.
       * Still, the barrier is down, nothing is carried, and a jeep stands where it is going. Where the soldiers are is
       * kept, for their headgear lamps at night (lights) and their dispatch riders (items).
       */
      tick(dt, posOf, snap = false) {
        where = posOf;
        moveJeeps(dt, posOf, snap);
        const coming = !snap && scene.farmers.some(f => { const b = posOf(f.id); return b?.walk && Math.abs(b.x - GATE[0]) < 24 && Math.abs(b.y - GATE[1]) < 4; });
        gateLift = snap ? 0 : coming ? Math.min(1, gateLift + dt * 5) : Math.max(0, gateLift - dt * 1.5);
        if (snap) { advancing.length = 0; carried.length = 0; return; }
        for (const a of [...advancing, ...carried]) a.t += dt;
        keep(advancing, a => a.t < WALK + GONE && Boolean(stOf(a.key)));
        keep(carried, c => c.t < CARRY);
      },
      /** The sky by your clock above the hedge, and what stands against it: the flagpoles, the bunting and the flags (by the alert level), HQ's pennant. How dark it is is kept, for the night's beams and flare (top). */
      weather(sky) {
        dark = 1 - (sky?.light ?? 1);
        drawSky(sky);
        drawSkyline(coloursOf(scene.farmers), scene.farmers.some(f => f.state === 'waiting'), PXG.T, shown());
      },
      /**
       * Over everything, the sky too: the alert board's beacon (spinning at max); the drones circling over the pad (more
       * running than their soldiers lead); at night, the searchlights' beams sweeping the sky, and now and then the
       * illumination flare drifting down over the field.
       */
      top() {
        const T = PXG.T, k = nightOf(dark);
        alertBeacon(shown() === 'winter', T);
        const more = Math.min(3, scene.henhouse?.roosting ?? 0);
        for (let i = 0; i < more; i++) { const a = T * 1.4 + (i * 2 * Math.PI) / 3; drone(Math.round(PAD_SKY[0] + Math.cos(a) * 12), Math.round(PAD_SKY[1] + Math.sin(a) * 4), '#ffd43b', T, i); }
        if (k <= 0) return;
        SEARCHLIGHTS.forEach(([x, y], i) => searchBeam(x, y, beamAngle(i, T), k));
        const fl = flareAt(T);
        if (fl) illuminationFlare(fl, k, T);
      },
      /** At night, the illumination flare trails a little smoke as it drifts down. */
      ambient(dt, add) {
        const fl = nightOf(dark) > 0 ? flareAt(PXG.T) : null;
        if (fl && Math.random() < dt * 5) add({ x: fl.x + rand(-1, 1), y: fl.y - 1, vx: rand(-2, 2), vy: rand(-3, 0), g: 0, life: 2.4, max: 2.4, size: 2, grow: 0.8, color: '#e6eef5', alpha: 0.35 });
      },
      /**
       * Lights that glow at night, [x, y, reach, the lit shape or null]: HQ's lamp, windows and way in; the reserve
       * tents' doorways, the mess tent's lantern and the quartermaster's tent; the lanterns along the track; the
       * searchlights' heads; each fuel depot's lamp; the alert beacon at max; a green flare going up and its star, a
       * generator's lamp as it blinks; and each working soldier's headgear lamp. The engine adds those who need you;
       * the beams and the flare give their own (top).
       */
      lights() {
        const T = PXG.T;
        const out = [
          [200, 54, 18, [198, 52, 5, 4]], [200, 64, 16, null], // HQ's lamp over its map table, its way in
          ...HQ_WINDOWS.map(x => [x + 8, 55, 8, [x + 1, 51, 14, 8, true]]), // its windows, lit from inside, their frames dark
          ...RESERVE_TENTS.map(cx => [cx, 158, 10, [cx - 2, 155, 5, 8]]), // the reserve tents' doorways
          [MESS_LAMP[0], MESS_LAMP[1] + 4, 20, [MESS_LAMP[0] - 1, MESS_LAMP[1], 3, 2]], [357, 52, 18, null], // the mess tent's lantern; the quartermaster's tent
          ...LANTERNS.map(x => [x, LANTERN_Y + 1, 10, [x - 1, LANTERN_Y, 3, 3]]),
          ...SEARCHLIGHTS.map(([x, y]) => [x, y + 1, 6, [x - 1, y, 3, 1]]),
        ];
        for (const { x, depot } of depotsOf(scene)) if (depot && (depot.lamp !== 'red' || blink(2))) out.push([x + 12, 27, 6, null]);
        if (shown() === 'winter') out.push([...BEACON, 10, null]);
        for (const { s, f, jobs } of shownPositions()) {
          const fl = f.light === 'ok' ? flareOf(...deployAt(s), T) : null;
          if (fl) out.push([fl.x, fl.y, fl.star ? 8 : 4, null]);
          if (jobs > 0 && blink(2)) { const [gx, gy] = generatorAt(s); out.push([gx + 7, gy + 2, 3, null]); }
        }
        for (const f of scene.farmers) { const b = f.state === 'working' ? where(f.id) : null; if (b && !b.walk) { const x = Math.round(b.x), y = Math.round(b.y) - 13; out.push([x, y, 4, [x, y, 1, 1]]); } } // on its headgear's front
        return out;
      },
      /** The position at a point of the base, if any: a click there opens its close-up, and the mascots keep off it. */
      fieldAt(x, y) { return L.ST.find(s => Math.abs(x - s.cx) <= 40 && y >= s.rowTop && y <= s.rowTop + 56)?.key ?? null; },
      /** The building at a point of the base, if any: each opens something (a second account's fuel depot too). */
      buildingAt(x, y) { return [...BUILDINGS, ...depotsOf(scene).slice(1).map(d => depotBox(d.x))].find(([, x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)?.[0] ?? null; },
      buildingTip: k => (k === 'bank' ? depotTip() : {
        barn: 'The motor pool gate: start a new session or resume one (a truck brings the new soldier in)', drones: 'The drone pad: subagents', desk: 'The HQ tent: who is waiting on you',
        board: 'The briefing board: what your projects remember (CLAUDE.md and memory)', dock: "The quartermaster's depot: pull requests",
      }[k] ?? ''),
      /** What a building shows when clicked: { title, html }. */
      dialog(k) {
        if (k === 'desk') {
          const list = scene.farmers.filter(f => f.state === 'waiting' || f.state === 'turn');
          return { title: 'The HQ tent', html: list.length ? `<ul class="px-dl">${list.map(f => `<li><button type="button" class="act" data-farm-pick="${esc(f.id)}">Open</button><span><b>${esc(f.name)}</b> ${esc(f.state === 'waiting' ? (f.planAsk ? 'has a plan for you to approve' : `needs you: ${f.ask}`) : f.question ? `asks: ${f.question}` : `reports back${f.reply ? `: ${f.reply}` : ''}`)}</span></li>`).join('')}</ul>` : '<p class="muted">No soldier is waiting on you.</p>' };
        }
        if (k === 'bank') { // with two accounts or more, each one's meters under its name (as the factory's banks)
          const name = w => ({ five_hour: '5-hour limit', seven_day: 'Weekly limit' })[w.kind] ?? w.kind;
          const meters = ws => ws.map(w => { const used = usedOf(w), pct = used === null ? 0 : Math.round(used); return `<div class="px-meter"><b>${esc(name(w))}</b><span class="bar"><i style="width:${Math.min(100, pct)}%"></i></span><span>${w.reset ? 'just reset' : used === null ? 'no reading' : `${pct}% used`}${w.resetsAt ? ` · resets ${esc(resetAt(w.resetsAt))}` : ''}</span></div>`; }).join('');
          const accs = scene.accounts ?? [];
          if (accs.length > 1) return { title: "The fuel depots: your accounts' plans", html: accs.map((a, i) => `<h4>${esc(accountName(a, i))}</h4>${a.plan?.windows?.length ? meters(a.plan.windows) : '<p class="muted">No reading yet: it comes from the mod in a session running on it.</p>'}`).join('') + `<p class="muted">Each depot's drums are its account's week. The alert level follows ${esc(accountName(accs[0], 0))}'s 5-hour limit (max when it is nearly used up).</p>` };
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
       * The signs: each position's (click it for the files soldiers touched there): its name, a blue pennant and the
       * branch when it isn't main, then a worktree's repo, the last deploy in words and a collision; why the deploy
       * shows on hover; its git counts along its back edge. Each project's sign over its mown patch, the places' (HQ,
       * the motor pool, the mess, the reserve, the drill ground, the range), the open pull requests at the
       * quartermaster's, and "+N" for whoever doesn't fit their place.
       */
      labels(lab, overflow) {
        const { ST, more } = L;
        const cnt = t => pxt(t, '#5a3a1a', null), sign = t => pxt(t, '#fff3d6', '#4e3626');
        for (const s of ST) {
          const f = fieldByKey(s.key);
          if (!f) continue;
          const branch = f.branch === '(detached)' ? ` ${pxt('?', '#c3cbd2')}` : f.flag ? ` ${pxt(clip(f.branch, 12), '#a9dcf7')}` : '';
          const d = f.lastDeploy, deploy = d?.label ? pxt(d.label, { ok: '#8ef0a0', failed: '#ff8a80', running: '#ffd166' }[d.state] ?? '#c9b48a') : '';
          const second = [f.worktree && f.main ? pxt(`worktree of ${f.main.split('/').pop()}`, '#a9dcf7') : '', deploy, f.collision ? pxt('⚠ crowded', '#ffd166') : ''].filter(Boolean).join(' ');
          const tip = [f.key, f.branch && `on ${f.branch}`, d && [d.label, d.detail].filter(Boolean).join(': '), 'Click to see the files soldiers touched here'].filter(Boolean).join(' · ');
          lab(s.cx, s.rowTop + 49, `<button type="button" class="px-field" data-farm-field="${esc(f.key)}" title="${esc(tip)}"><span class="px-fl">${f.flag ? pennantImg() : ''}${pxt(cutMid(f.name, 16), f.collision ? '#ffd166' : '#e6eef5')}${branch}</span>${second ? `<span class="px-fl">${second}</span>` : ''}</button>`, f.collision ? 'bad' : '');
          // the counts along the position's back edge: behind over its post, uncommitted on the loose sandbags' side, unpushed on the crates'
          if (f.behind > 0) lab(postAt(s)[0] + 1, s.rowTop + 1, cnt(`↓${f.behind}`), 'cnt', `${f.behind} commit${f.behind === 1 ? '' : 's'} behind the remote`);
          if (f.dirty > 0) lab(s.cx - 21, s.rowTop + 1, cnt(`+${f.dirty}`), 'cnt', `${f.dirty} uncommitted file${f.dirty === 1 ? '' : 's'}`);
          if (f.ahead > 0) lab(s.cx + 22, s.rowTop + 1, cnt(`↑${f.ahead}`), 'cnt', `${f.ahead} unpushed commit${f.ahead === 1 ? '' : 's'}`);
        }
        if (!ST.length) lab(262, 150, sign('No positions yet: no soldier has touched a repo in the last 30 minutes'), 'zone');
        for (const { x, name, depot } of depotsOf(scene)) { // with two accounts, each depot's tag on the track at its foot: its account's name and week (the engine's tag colours near the limit)
          if (!name) continue;
          const text = `${name} ${depot ? `${depot.pct}%` : '–'}`, near = depot?.lamp === 'green' ? null : depot?.lamp;
          lab(x + 12, 87, near === 'red' ? pxt(text, '#ffffff', null) : cnt(text), `cnt${near ? ` silo-${near}` : ''}`, `The fuel depot of ${name}: ${depot ? `its plan's weekly limit, ${depot.reset ? 'just reset' : `${depot.pct}% used`}, ${depot.drums} of 8 drums left${depot.resetsAt ? `; resets ${resetAt(depot.resetsAt)}` : ''}` : 'no reading of its plan yet'}`);
        }
        lab(200, 30, sign('HQ'), 'zone'); lab(60, 21, sign('MOTOR POOL'), 'zone');
        lab(57, 93, sign('MESS'), 'zone'); lab(54, 147, sign('RESERVE'), 'zone'); lab(58, 177, sign('DRILL'), 'zone');
        lab(CORR[0], L.slots[0].lane - 8, sign('RANGE'), 'zone'); // on the left side's path where it comes into the range (the first row's lane), clear of the first position, its tape and its soldiers
        for (const g of L.groups) { const [r, cols] = rowsOfGroup(g)[0]; lab(174 + Math.min(...cols) * COLW + 44, 100 + r * ROWH - 1, sign(clip(g.name, 16)), 'zone proj', `The ${g.name} project: its repos side by side`); }
        const open = scene.fields.flatMap(fl => fl.prs?.open ?? []);
        if (open.length) lab(357, 91, cnt(`${open.length} PR${open.length === 1 ? '' : 's'}`), 'cnt', `Open pull requests: ${open.slice(0, 6).map(pr => `#${pr.number}${pr.title ? ` ${pr.title}` : ''}`).join(' · ')}${open.length > 6 ? ' …' : ''}. Click the quartermaster's depot for them all`);
        const plus = (x, y, n, what) => n > 0 && lab(x, y, cnt(`+${n} ${what}`), 'cnt');
        plus(QUEUE.from, 91, overflow.desk, 'waiting'); plus(QUEUE.to, 91, overflow.turn, 'your turn'); // under each queue's first soldier
        plus(116, MESS[0][1] - 4, overflow.charge, 'idle'); plus(116, RESERVE[0][1] - 4, overflow.storage, 'stale'); plus(116, DRILL[0][1] - 4, overflow.floor, 'working'); plus(116, COTS[0][1] - 4, overflow.nap, 'asleep');
        if (more > 0) lab(350, L.GRID.y1 + 5, `<button type="button" class="px-more" data-farm-more>${pxt(`+${more} more position${more === 1 ? '' : 's'}`, '#fff3d6', '#4e3626')}</button>`, 'wood');
      },
      /**
       * A soldier: walking, it faces where it goes; waiting on you, it waves. On it: a radio pack on its back while it
       * thinks (drawn first: behind it), a grey veil in reserve, its model's pin on its headgear, its chevrons, a
       * hazard armband for bypass permissions, and its eyes, as the farm's.
       */
      drawChar(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), look = f.look ?? lookOf(f);
        const view = b.walk ? b.face ?? 'down' : 'down', opts = { view, legs: legFrame(b), wave: f.state === 'waiting' };
        if (f.thinking && !b.walk) radioPack(rp, PXG.T);
        PXG.ctx.drawImage(soldierSprite(look, f.shirt, opts), ox, oy, 14 * SC, 16 * SC);
        if (f.state === 'stale') greyVeil(look, opts, ox, oy);
        headgearPin(rp, view, FAMILY_PIN[f.family]);
        if (view === 'down' || view === 'up') chevrons(rp, chevronsOf(f.cost));
        if (f.mode === 'bypassPermissions' && view === 'down') armband(rp, opts.wave);
        if (view !== 'up') eyes(f, b, rp, view);
      },
      /**
       * Over and beside a soldier: speed lines (fast mode) and sweat (a hot CPU); asleep on a cot, a zzz. Working: what
       * it holds for its step, its task list's clipboard. Its drones and the K9. Waiting on you: the ! bubble (a plan's,
       * with the rolled map it carries) and a ring at its feet; your turn: the dispatch it brings back, and a ✓ (a ?
       * for a question); idle: eating.
       */
      drawFx(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), T = PXG.T, still = !b.walk;
        if (f.fast && f.state !== 'stale') speedLines(rp, b, T);
        if (f.hot && f.state !== 'stale') sweat(rp, T);
        if (b.zone === 'nap' && still) { // asleep on its cot until it wakes by itself: zzz
          const zy = -4 - Math.floor((T * 2) % 4);
          PXG.ctx.globalAlpha = 0.85; rp(10, zy, 3, 1, '#e6eef5'); rp(11, zy + 1, 1, 1, '#e6eef5'); rp(10, zy + 2, 3, 1, '#e6eef5'); PXG.ctx.globalAlpha = 1;
          return;
        }
        if (f.state === 'working' && still) { const act = props.doing(f); if (act) props.draw(act.prop, rp, T, act.flag); }
        if (f.tasks?.total && f.state === 'working' && still) clipboard(rp, f.tasks);
        b.kids.forEach((d, k) => { const x = Math.round(d.x), y = Math.round(d.y); if (f.kids[k]?.dog) k9(x, y, T, k); else drone(x, y, f.shirt, T, k); });
        if (f.state === 'waiting') {
          if (f.planAsk) rolledMap(rp);
          bubble(rp, 12, -7 - blink(3), f.planAsk ? 'plan' : '!');
          const x = Math.round(b.x), y = Math.round(b.y); // a ring at its feet that pulses: it needs you
          PXG.ctx.globalAlpha = 0.45 + 0.35 * Math.sin(T * 5);
          px(x - 6, y + 2, 13, 1, RED); px(x - 8, y + 1, 2, 1, RED); px(x + 7, y + 1, 2, 1, RED); px(x - 8, y - 1, 1, 2, RED); px(x + 8, y - 1, 1, 2, RED);
          PXG.ctx.globalAlpha = 1;
        }
        if (f.state === 'turn') { dispatch(rp); if (still) bubble(rp, 12, -7 - (f.question ? blink(3) : 0), f.question ? '?' : 'v'); }
        if (f.state === 'idle' && still) eating(rp);
      },
      /** Labels that move with what they name: a jeep out of the park (its server), a dispatch rider (its errand), a cot's wake-up time; and +N over the drone pad. */
      movers(posOf) {
        const out = [];
        for (const c of scene.carts ?? []) {
          const s = jeeps.get(c.server);
          if (!s || (!s.goal && !s.moving)) continue; // in its place in the park
          const who = c.busy ? scene.farmers.find(f => f.id === c.busy) : null;
          out.push({ key: `mcp:${c.server}`, x: s.x, y: s.y - 12, html: pxt(cutMid(c.server, 16), '#5a3a1a', null), title: `${c.server}, an MCP server${who ? `: ${who.name} is calling it` : ''}` });
        }
        for (const f of scene.farmers) {
          const b = posOf(f.id), r = riderAt(f, b, PXG.T);
          if (r) out.push({ key: `rider:${f.id}`, x: r.x, y: RIDER_Y - 15, html: pxt(clip(f.service, 18), '#5a3a1a', null), title: `${f.name}: ${f.summary || f.service}` });
          if (f.nap && f.wakeAt && b?.zone === 'nap' && !b.walk) out.push({ key: `nap:${f.id}`, x: b.x, y: b.y - 26, html: pxt(`wakes in ${until(f.wakeAt)}`, '#5a3a1a', null), title: `${f.name} wakes up by itself at ${clock(f.wakeAt)}` });
        }
        const more = scene.henhouse?.roosting ?? 0;
        if (more > 0) out.push({ key: 'pad:more', x: PAD_SKY[0], y: 18, html: pxt(`+${more}`, '#5a3a1a', null), title: `${more} more subagent${more === 1 ? '' : 's'} running than their soldiers can lead` });
        return out;
      },
    };
  }

  /** The field exercise's legend, shown in a dialog from the Help button: the catalogue, in drill words. */
  function helpHtml() {
    return `<div class="px-key">
      <b>The HQ tent</b><span>at the back, in the middle: soldiers waiting on you queue at its left under a red pennant, “awaiting orders”, waving a red “!”; when it's your turn they report back at its right with a dispatch (a “?” is a question for you). A rolled map at HQ = a plan for you to approve. The stats panel's “needs you” button opens the first one</span>
      <b>Positions</b><span>one position per repo on the exercise field, inside the range's rope, fortified as the session's context fills: marker stakes, a sandbag ring, a low wall, a lookout post, then the flag raised when it is nearly full. Empty positions are trampled grass until a repo needs one, up to 18. A blue pennant on its sign = a branch other than main; a camouflage net = a worktree, beside its repo's position; a mown patch with a sign = one project's repos</span>
      <b>Advanced!</b><span>when a session's conversation is compacted, the line advances: the flag is carried forward with a cheer, and the position starts again from its stakes</span>
      <b>Kit</b><span>what a working soldier holds is its current step: field manual = reading, binoculars = searching, a radio set = the web, shovel = editing, sandbag = a new file, mine detector on the practice range = running tests, brush = lint or format, toolbox = a build, a crate on a dolly = installing, stamped crate = a commit, wheelbarrow = a push, a signal flare going up from its launcher = a deploy, mail sack = a pull, field generator = a server, sapper's spade = deleting, whistle = calling subagents, map case = planning, a message card = a question for you, field telephone = any other command, a plug = an MCP call (its jeep comes over), a scroll = standing orders (a skill), blueprint = plan mode</span>
      <b>On a soldier</b><span>a field jacket in its agent's colour in the list, its headgear (a helmet, a beret or a cap) picked by its agent, so the same agent is always the same soldier. The chevrons on its sleeve = what it has cost (one from $1, two from $10, three from $50); the pin on its headgear = its model (purple Opus, blue Sonnet, green Haiku, orange Fable); a radio on its back, the aerial blinking = thinking between steps; a clipboard = its task list (its name says how many, e.g. 3/7); sweat drops = a hot CPU; a yellow and black armband = bypass permissions (no checks); speed lines = fast mode. Codex soldiers have a slate-grey stripe down the jacket</span>
      <b>Drones</b><span>small drones hovering by a soldier = its subagents, up to four (a K9 dog sniffing about = an Explore subagent). The drone pad holds the ones that finished lately; drones circling over it, with a +N, = more running than their soldiers can lead</span>
      <b>Jeeps, dispatch riders</b><span>a jeep waits in the vehicle park on the left for each MCP server (Gmail, playwright, Chrome…) your soldiers called in the last hour; while a soldier calls it, it drives over with the server's name and waits beside it until the call is done. A dispatch rider on a motorbike rides out of the motor pool along the track to a soldier and back for each web call going on, with where it goes</span>
      <b>By a position</b><span>loose sandbags = uncommitted files, supply crates = unpushed commits, a mail sack at its post = behind the remote; a field generator humming by the post = a background command still running</span>
      <b>Deploys</b><span>the repo's last deploy, from GitHub Actions or a deploy an agent ran itself (a deploy script over ssh, rsync, vercel…), whichever is newer: a green flare = deployed; a practice charge, a big grey puff and a scorched patch, nobody hurt = deploy failed (hover its sign for why; the close-up links to the run); red range flags flapping, with distant practice thumps = deploying; a “HOLD” board = Actions didn't run (billing, a spending limit). Yellow caution tape round a position = two agents writing one repo, pulsing faster when it's serious</span>
      <b>The quartermaster's depot</b><span>a supply crate on its pallet for each open pull request, its tag the checks (green pass, red failed, amber running, grey draft); “Supplies in!” = one merged, carried in</span>
      <b>Mess, reserve, cots, drill ground</b><span>idle soldiers eat at the mess tent on the left (eyes shut); stale ones sit on crates by the reserve tents, greyed a little, in reserve; a soldier asleep on a cot under the little clock = a session that wakes up by itself (/loop, a scheduled wake-up), with when; soldiers working outside any repo drill on the drill ground. When more come than a place holds, a +N says how many more</span>
      <b>Buildings</b><span>click the motor pool gate to start or resume a session (a truck brings the new soldier in, and it jumps down), the HQ tent for who is waiting on you, the fuel depot for your plan's usage (a depot for each Claude account, when you have two), the drone pad for subagents, the briefing board for CLAUDE.md and memory, the quartermaster's depot for pull requests</span>
      <b>Fuel depot</b><span>its drums are what is left of your plan's weekly limit: they empty as the week is used (the % on hover, and when it resets); its lamp turns amber from 70% and blinks red from 90%. With two Claude accounts, each has a fuel depot (the second left of the motor pool gate), its name and week on the tag at its foot; the alert level follows the first account's 5-hour limit</span>
      <b>Alert</b><span>the alert level follows your plan's 5-hour limit, on the alert board by HQ: calm while it is fresh (green, the flags hanging limp), then ready (yellow, the flags flying), high (amber, the base's lights warm, soldiers walking faster) and max (a red beacon spinning, the flags snapping, soldiers at the double) when it is nearly used up; a new window brings it back to calm. The Alert switch holds one instead (each click moves it on, then back to live): the panel then shows the level with a 📌 and your real 5-hour use</span>
      <b>Soldiers</b><span>one per agent. Hover one for its name; names always show for the soldier you picked and those at HQ</span>
      <b>Speech bubbles</b><span>what a soldier asked or last said; × hides one to a 💬 (click it to show the bubble again); a new message brings it back by itself. The Bubbles switch hides or shows them all</span>
      <b>Carrier pigeons</b><span>one agent messaging another (Claude Code's SendMessage between sessions): a carrier pigeon flies the letter from one soldier to the other, and the field log says what it said; the agents' conversations show it too</span>
      <b>Mascots</b><span>the regimental mascots live here just for fun: a mascot goat in a red dress coat, the mess cat, and mice in the quartermaster's depot. They never stand for anything. Click one to pet it, feed it or salute the goat: the nearest soldier that isn't waiting on you walks over and does it. The Animals switch hides them</span>
      <b>Day and night</b><span>the sky follows your clock; at night searchlights sweep, the tents glow from inside, lanterns light the track, and now and then a slow white flare drifts down. The Sky switch holds it at day or night</span>
      <b>Click</b><span>a soldier to answer or message it in the sidebar; a position, or its sign, for the files soldiers touched there</span>
      <b>Zoom</b><span>+ / − (or ⌘/Ctrl + scroll, or pinch) zooms the base inside its frame; drag or scroll to move around (the map in the corner shows where you are; click it to go somewhere); the % button shows the whole base again</span>
      <b>Stats, bell</b><span>the stats add up what the sessions have cost and how often the line advanced (each compaction). Bell: a chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you</span>
    </div>`;
  }

  /* ---------- the field exercise, as a world: the bridge (web/worlds/sdk/bridge.js) runs it ---------- */

  window.Agentville.world(makeMilitary());
  // The field exercise's own pieces, for its tests (and where the browser test clicks: the buildings' boxes, the positions' grid).
  window.AgentvilleMilitary = {
    OUTFIT, lookOf, soldierSprite, militaryScene, makeMilitary, props, BUILDINGS, MILITARY_GRID, DEPOT_X, PARK, SKY_Y, depotCrates,
    depotOf, depotsOf, drumsOf, FUEL, LANTERNS, SEARCHLIGHTS, BEACON, BEAM, FLARE, flareAt,
    MILITARY_PROPS: Object.keys(MILITARY_PROPS), chevronsOf, jeepRoute, jeepGoal, RIDER_Y,
  };
})();
