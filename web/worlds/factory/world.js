// The robot factory: the second built-in world. Every agent is a robot, put together from a head, a body in
// its agent's colour and a drive, picked by its id; every repo is an assembly bay. A bright, friendly
// workshop on the shared engine (web/worlds/sdk/engine.js), like the farm, in the frame's shared scope
// (pixel.js, people.js, props.js, creatures.js, animals.js, engine.js), so it keeps its own names inside
// this function. Classic script, no dependencies, one file (the frame loads only world.js).
(() => {
  'use strict';
  const { pick, hashOf } = window.Agentville.people; // the people kit's seeded pick (one of n for an id and a salt) and its hash

  /* ---------- the scene: what the factory draws, from the snapshot ---------- */

  /** The build stage by the context used: 0 the frame, 1 wiring (from 30%), 2 plating (50%), 3 the head (70%), 4 its eyes lit (85%: nearly full). */
  const stageOf = p => (p >= 0.85 ? 4 : p >= 0.7 ? 3 : p >= 0.5 ? 2 : p >= 0.3 ? 1 : 0);
  /** Whose robot a bay builds: of the robots at work on its repo (working, waiting on you, your turn; not idle or stale), the one whose context is fullest; null if none. */
  const builderOf = (farmers, key) => farmers.filter(a => a.field === key && ACTIVE.has(a.state)).reduce((best, a) => (best && (best.pct ?? 0) >= (a.pct ?? 0) ? best : a), null);
  /** The stack light, from a bay's last deploy: ok, failed, running, blocked (Actions didn't run), or other for any state it doesn't name; null with none. */
  const lightOf = d => (d ? (['ok', 'failed', 'running', 'blocked'].includes(d.state) ? d.state : 'other') : null);
  /**
   * The factory's scene: the engine's, with each robot's look, and each bay's `build` stage (by its fullest robot
   * at work), its `flag` (a branch other than main) and its stack `light` (its last deploy).
   */
  function factoryScene(s) {
    const e = engineScene(s);
    e.fields = e.fields.map(f => ({ ...f, build: stageOf(builderOf(e.farmers, f.key)?.pct ?? 0), flag: Boolean(f.branch) && f.branch !== '(detached)' && !f.onMain, light: lightOf(f.deploy) }));
    e.farmers = e.farmers.map(f => ({ ...f, look: lookOf(f) }));
    return e;
  }

  /* ---------- the robots: mix and match, 14 × 16, like the people kit's people ---------- */

  // One letter per pixel, '.' clear:
  // k outline · C body (the agent's colour, exact) · c its shade · H head metal · h its light ·
  // v visor or screen · e eye (not in the rows: drawChar draws the eyes on top, in this colour) · A arm ·
  // T tread or tyre · W wheel hub (and a bolt) · L leg joint · B the chest panel's light · a antenna (a light).
  // A robot is a head (rows 0–8: room on top for an antenna, the face's visor on rows 5–7, where the eyes
  // go), a body (rows 9–12, its arms at the sides) and a drive (rows 13–15, standing on the bottom row).
  // Each part has a front (down), a back (up) and a right side; the left side is the right's mirror.
  const HEADS = {
    dome: { // a rounded cap in the body's colour, a light on its crown
      down: ['..............', '.....kaak.....', '...kkhCCCkk...', '..khCCCCCCck..', '.kCCCCCCCCCck.', '.kHvvvvvvvvHk.', '.kHvvvvvvvvHk.', '.kHvvvvvvvvHk.', '..kkkkkkkkkk..'],
      up: ['..............', '.....kaak.....', '...kkCCChkk...', '..kcCCCCCChk..', '.kcCCCCCCCCCk.', '.kHHHHHHHHHHk.', '.kHHkkkkkkHHk.', '.kHHHHHHHHHHk.', '..kkkkkkkkkk..'],
      right: ['..............', '.....kaak.....', '...kkhCCCkk...', '..khCCCCCCck..', '.kCCCCCCCCCck.', '.kHHHHHvvvvvk.', '.kHWWHHvvvvvk.', '.kHHHHHvvvvvk.', '..kkkkkkkkkk..'],
    },
    box: { // square metal, a light at the corner, bolts for ears
      down: ['..............', '..............', '.kkkkkkkkkkkk.', '.khhhhhhhhhhk.', '.kHHHHHHHHaHk.', 'kkHvvvvvvvvHkk', 'kWHvvvvvvvvHWk', 'kkHvvvvvvvvHkk', '.kkkkkkkkkkkk.'],
      up: ['..............', '..............', '.kkkkkkkkkkkk.', '.khhhhhhhhhhk.', '.kHaHHHHHHHHk.', 'kkHHkkkkkkHHkk', 'kWHHHHHHHHHHWk', 'kkHHkkkkkkHHkk', '.kkkkkkkkkkkk.'],
      right: ['..............', '..............', '.kkkkkkkkkkkk.', '.khhhhhhhhhhk.', '.kHHHHHHHHaHk.', '.kHkkkHHvvvvk.', '.kHkWkHHvvvvk.', '.kHkkkHHvvvvk.', '.kkkkkkkkkkkk.'],
    },
    antenna: { // round metal, an antenna with a light on top
      down: ['......aa......', '......kk......', '....kkkkkk....', '..kkhhHHHHkk..', '.khhHHHHHHHHk.', '.kHvvvvvvvvHk.', '.kHvvvvvvvvHk.', '.kHHvvvvvvHHk.', '..kkkkkkkkkk..'],
      up: ['......aa......', '......kk......', '....kkkkkk....', '..kkHHHHhhkk..', '.kHHHHHHHHhhk.', '.kHHHHHHHHHHk.', '.kHHHkkkkHHHk.', '.kHHHHHHHHHHk.', '..kkkkkkkkkk..'],
      right: ['......aa......', '......kk......', '....kkkkkk....', '..kkhhHHHHkk..', '.khhHHHHHHHHk.', '.kHHWHHHvvvvk.', '.kHWWWHHvvvvk.', '.kHHWHHHvvvHk.', '..kkkkkkkkkk..'],
    },
    screen: { // a screen for a face, with a glint, in a wide case; rabbit-ear aerials
      down: ['..k........k..', '...k......k...', '.kkkkkkkkkkkk.', 'kHHHHHHHHHHaHk', 'kHvhvvvvvvvvHk', 'kHvvvvvvvvvvHk', 'kHvvvvvvvvvvHk', 'kHvvvvvvvvvvHk', '.kkkkkkkkkkkk.'],
      up: ['..k........k..', '...k......k...', '.kkkkkkkkkkkk.', 'kHaHHHHHHHHHHk', 'kHHkkkkkkkkHHk', 'kHHHHHHHHHHHHk', 'kHHkkkkkkkkHHk', 'kHHHHHHHHHHHHk', '.kkkkkkkkkkkk.'],
      right: ['...k.....k....', '....k...k.....', '.kkkkkkkkkkkk.', 'kHHHHHHHHHHaHk', 'kHHHHHHkvhvvHk', 'kHkHkHHkvvvvHk', 'kHHHHHHkvvvvHk', 'kHkHkHHkvvvvHk', '.kkkkkkkkkkkk.'],
    },
  };
  // The body, in the agent's colour, short arms at its sides; its chest panel (rows 10–11, x 5–8) is
  // one of CHESTS, laid over the front, picked by the id. The back has a battery; the side shows an arm,
  // and the chest light peeking round.
  const BODY = {
    down: ['.kkCCCCCCCckk.', 'kAkCCCCCCCckAk', 'kAkCCCCCCCckAk', '.kkCCCCCCCckk.'],
    up: ['.kkCCCCCCCckk.', 'kAkCChhhhCckAk', 'kAkCCHHHHCckAk', '.kkCCCCCCCckk.'],
    right: ['...kCCCCCck...', '...kCkAkCBk...', '...kCkAkCck...', '...kCCkCCck...'],
  };
  const CHESTS = [
    ['HHHH', 'HBBH'], // a plate with two lights
    ['kBBk', 'kBBk'], // a power core
    ['BBBB', '....'], // a light bar
    ['....', 'BWBW'], // a row of buttons
  ];
  /** Row b with row t laid over it: t's letters win, its dots let b show (the people kit's rule). */
  const over = (b, t) => (t ? [...b].map((ch, i) => (t[i] && t[i] !== '.' ? t[i] : ch)).join('') : b);
  const BODIES = CHESTS.map(([r10, r11]) => ({
    down: BODY.down.map((r, i) => over(r, i === 1 ? `.....${r10}.....` : i === 2 ? `.....${r11}.....` : null)), up: BODY.up, right: BODY.right,
  }));
  // The drives: hips and what it moves on, 3 rows, in each frame: s standing, a and b the two steps of the
  // walk (the engine's walkFrame: a, s, b, s); `front` serves the front and the back, `side` the right side.
  const tread = o => `.k${Array.from({ length: 10 }, (_, i) => ((i + o) % 3 === 2 ? 'k' : 'T')).join('')}k.`; // a tread's run, its lugs moved on by o
  const DRIVES = {
    wheels: { // a tyre each side of an axle; rolling, a glint goes round them
      front: {
        s: ['.kTTkHHHHkTTk.', '.kTTkkkkkkTTk.', '.kkkk....kkkk.'],
        a: ['.kWTkHHHHkTWk.', '.kTTkkkkkkTTk.', '.kkkk....kkkk.'],
        b: ['.kTTkHHHHkTTk.', '.kTWkkkkkkWTk.', '.kkkk....kkkk.'],
      },
      side: {
        s: ['..kTkHHHHkTk..', '..TWTkkkkTWT..', '..kTk....kTk..'],
        a: ['..kWkHHHHkWk..', '..TWTkkkkTWT..', '..kTk....kTk..'],
        b: ['..kTkHHHHkTk..', '..TWTkkkkTWT..', '..kWk....kWk..'],
      },
    },
    legs: { // two stubby legs with big feet; walking, one foot lifts
      front: {
        s: ['...kHHHHHHk...', '...kLk..kLk...', '..kkkk..kkkk..'],
        a: ['...kHHHHHHk...', '...kLk..kkkk..', '..kkkk........'],
        b: ['...kHHHHHHk...', '..kkkk..kLk...', '........kkkk..'],
      },
      side: {
        s: ['....kHHHHk....', '.....kLLk.....', '.....kkkkk....'],
        a: ['....kHHHHk....', '....kL..Lk....', '...kk....kkk..'],
        b: ['....kHHHHk....', '.....kLkLk....', '....kkk.kkk...'],
      },
    },
    treads: { // a tank's treads, wide and low; rolling, the lugs move along
      front: {
        s: ['kTTTkHHHHkTTTk', 'kTkTkkkkkkTkTk', 'kkkkk....kkkkk'],
        a: ['kTkTkHHHHkTkTk', 'kTTTkkkkkkTTTk', 'kkkkk....kkkkk'],
        b: ['kTTTkHHHHkTTTk', 'kTTTkkkkkkTTTk', 'kTkTk....kTkTk'],
      },
      side: {
        s: [tread(0), 'kTWTTWTTWTTWTk', tread(0)],
        a: [tread(1), 'kTWTTWTTWTTWTk', tread(2)],
        b: [tread(2), 'kTWTTWTTWTTWTk', tread(1)],
      },
    },
  };
  const HEAD_NAMES = Object.keys(HEADS), DRIVE_NAMES = Object.keys(DRIVES);

  /** A robot's look, by its agent's id (the same agent is always the same robot): a head, a drive and a chest panel; codex agents are the slate model line. */
  const lookOf = a => {
    const id = a?.id ?? '';
    return { head: HEAD_NAMES[pick(id, 1, HEAD_NAMES.length)], drive: DRIVE_NAMES[pick(id, 2, DRIVE_NAMES.length)], line: a?.kind === 'codex' ? 'codex' : 'claude', chest: pick(id, 3, BODIES.length) };
  };
  /** A robot's rows: 16 strings of 14 letters, for a view (down, up, right, left) and a walking frame (s, a, b). */
  function robotRows(look, view = 'down', legs = 's') {
    if (view === 'left') return robotRows(look, 'right', legs).map(r => [...r].reverse().join(''));
    const v = view === 'up' || view === 'right' ? view : 'down';
    const head = HEADS[look?.head] ?? HEADS.dome, body = BODIES[look?.chest] ?? BODIES[0], drive = DRIVES[look?.drive] ?? DRIVES.wheels;
    const frames = v === 'right' ? drive.side : drive.front;
    return [...head[v], ...body[v], ...(frames[legs] ?? frames.s)];
  }

  const K = '#2a1d14', SLATE = '#5f6b7a';
  const METAL = { k: K, H: '#e6eef5', h: '#ffffff', v: '#2c4a85', e: '#a9dcf7', A: '#9aa4ad', T: '#3a3a40', W: '#c3cbd2', L: '#8a8f96', B: '#ffd43b', a: '#ff6b6b' };
  // Powered down (stale): every part grey, the visor and the lights off.
  const OFF = { k: '#3a3a40', C: '#9aa4ad', c: '#8a8f96', H: '#c3cbd2', h: '#e6eef5', v: '#5f6b7a', e: '#5f6b7a', A: '#8a8f96', T: '#5f6b7a', W: '#9aa4ad', L: '#8a8f96', B: '#5f6b7a', a: '#8a8f96' };
  /**
   * Each letter's colour: the body is the agent's colour, exact (its shade made from it); a codex robot's body
   * is slate, and its chest light the agent's colour; its antenna light is `light` (its model's colour) when
   * given. The rest are snapped to the pixel kit's palette.
   */
  function robotPalette(look, color, off = false, light = null) {
    const own = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : SLATE; // a colour that isn't one (none at all): slate, rather than a throw
    const codex = look?.line === 'codex', body = codex ? SLATE : own;
    const pal = off ? { ...OFF } : { ...METAL, C: body, c: shade(body, 0.78), B: codex ? own : METAL.B, a: light ?? METAL.a };
    for (const k of Object.keys(pal)) if (off || !(k === 'C' || k === 'c' || (k === 'B' && codex))) pal[k] = ink(pal[k]);
    return pal;
  }
  const sprites = new Map();
  /**
   * A robot's sprite, a 14 × 16 canvas, made once: `view` down, up, right or left; `legs` a walking frame
   * (s, a, b); `wave` its right arm up (from the front); `off` powered down, grey (stale); `light` its antenna
   * light's colour (its model's; the default red without).
   */
  function robotSprite(look, color, { view = 'down', legs = 's', wave = false, off = false, light = null } = {}) {
    const key = `${look?.head}|${look?.drive}|${look?.line}|${look?.chest}|${color}|${view}|${legs}|${Boolean(wave)}|${Boolean(off)}|${light ?? ''}`;
    if (sprites.has(key)) return sprites.get(key);
    const pal = robotPalette(look, color, off, light);
    const c = makeSprite(robotRows(look, view, legs), pal);
    if (wave && view === 'down') { // its right arm up beside its head, waving
      const g = c.getContext('2d');
      g.clearRect(12, 10, 2, 3);
      g.fillStyle = pal.A; g.fillRect(12, 4, 1, 6);
      g.fillStyle = pal.W; g.fillRect(12, 2, 1, 2);
      g.fillStyle = pal.k; g.fillRect(13, 2, 1, 8);
    }
    sprites.set(key, c);
    return c;
  }

  /* ---------- the floor: the back wall and its buildings, the walkway, the left side, the bays' floor, the conveyor ---------- */

  // A bright workshop seen from the front and above, 400 wide like the farm, growing down with the bays' rows:
  // - the back wall (y 0–64), its tall windows (y 6–30) showing the sky, and the buildings in front of it;
  // - the walkway (y 74–92) in front of them, where robots queue at your desk;
  // - the bays in the engine's grid (the farm's numbers), inside a yellow and black safety line;
  // - the left side (x 4–110): the storage shelf, the charging pads, the open table, the sleep pods, the AGVs' rank;
  // - the conveyor along the bottom.
  const W = 400, COLW = 88, ROWH = 62, WALK = { y0: 74, y1: 92 }, DESK_Y = 80, FAB_DOOR = [62, DESK_Y];
  const QUEUE = { from: 150, to: 250, step: 20, cap: 3 }; // your desk's two queues on the walkway: waiting from its left, your turn from its right
  const ROBOT = { w: 14, h: 16 }; // a robot's sprite, standing on its feet (their middle)
  const CORR = [116, 218, 306]; // the paths running down: the left side's, then the aisles between the bays' columns
  const FACTORY_GRID = makeGrid({
    cols: 3, colW: COLW, rowH: ROWH, cx0: 174, top0: 100,
    slot: (cx, rowTop) => ({ lane: rowTop + 44, x0: cx - 36, y0: rowTop + 12 }),
    fence: rows => ({ x0: 128, x1: 396, y0: 96, y1: 104 + rows * ROWH }), height: fence => fence.y1 + 28,
  });
  /**
   * The buildings and their click boxes, [key, x0, y0, x1, y1]. The engine opens two itself: the fabricator
   * ('barn': it starts or resumes a session) and the manuals shelf ('board': CLAUDE.md and memory); the rest
   * open dialog(key).
   */
  const BUILDINGS = [
    ['barn', 30, 8, 90, 78], // the fabricator: new robots roll out of its door
    ['drones', 96, 30, 126, 78], // the drone dock: subagents
    ['desk', 140, 34, 260, 76], // your desk: who is waiting on you
    ['board', 262, 26, 278, 78], // the manuals shelf
    ['bank', 286, 14, 310, 78], // the power-cell bank: your plan
    ['dock', 320, 12, 394, 78], // the loading dock: pull requests
  ];
  // The back wall's windows, [x, y, w, h]: the sky by your clock shows in them (drawn each frame, by weather()).
  const WINDOWS = [[4, 6, 22, 24], [98, 6, 26, 22], [142, 6, 54, 24], [204, 6, 54, 24], [264, 6, 14, 20]];
  // The left side's furniture, each as the box it is drawn in (its shadow too): its drawing keeps to it, and the
  // animals keep off it (avoidOf). A box with dx, dy goes round a place's feet; one with x, y stands where it is.
  const SHELF_BOX = { x: 4, y: 98, w: 106, h: 34 }; // the storage shelf: its rack 104 wide, its shadow 2 more
  const TABLE_BOX = { x: 25, y: 166, w: 62, h: 26 }; // the open table: from its toolbox's handle down to its legs' shadow
  const POD_BOX = { dx: -10, dy: -34, w: 22, h: 40 }; // a sleep pod round its sleeper's feet: its dome's top to its floor's shadow
  const RANK_BOX = { dx: -7, dy: -11, w: 14, h: 13 }; // a parking bay of the rank round its AGV's place: its yellow corners
  const CABINET_BOX = { w: 30, h: 26 }; // a tool cabinet from its top left: 28 × 24, its shadow 2 more
  const PLANT_BOX = { dx: -6, dy: -17, w: 13, h: 18 }; // a potted plant round its foot
  // The left side's places, each a robot's feet: stale on the storage shelf, idle on the charging pads, working
  // outside any repo at the open table (two in front, then two behind it), asleep in the pods; and the rank,
  // where each MCP server's AGV waits.
  const SHELF = [0, 1, 2, 3].map(i => [20 + 22 * i, SHELF_BOX.y + 28]); // on its deck
  const PADS = [0, 1, 2, 3].map(i => [18 + 24 * i, 158]);
  const TABLE = [[40, 204], [72, 204], [40, 178], [72, 178]], TABLE_Y = 186; // TABLE_Y: where the table is sorted among the robots
  const PODS = [[24, 250], [54, 250]];
  const RANK = [0, 1, 2, 3, 4, 5].map(i => [14 + 16 * i, 284]);
  // The power-cell bank's eight cells, [x, y] each (8 × 10): the weekly limit lights them.
  const CELLS = Array.from({ length: 8 }, (_, i) => [289 + (i % 2) * 10, 29 + (i >> 1) * 11]);
  // Colours: warm pale tiles (so the robots' white heads stand out), cream walls over a pale-blue skirting, a cool walkway.
  const FLOOR = '#f4ecd8', GROUT = '#e8d8b0', SHADOW = '#d4c294', WALL = '#e8d8b0', WALL_SEAM = '#d4c294', SKIRT = '#a9dcf7', SKIRT_TOP = '#5ab4ff', BASEBOARD = '#5f7f9a';
  const WALKWAY = '#e6eef5', WALK_SHADOW = '#c3cbd2', YELLOW = '#ffd43b', BLACK = '#2a1d14', BELT = '#a9dcf7';
  const BAY = '#c3cbd2'; // a bay's floor plate (the bays draw on it)
  // A project's painted floor zone, picked by its name: [paint, its dashed edge].
  const PAINTS = [['#a9dcf7', '#5ab4ff'], ['#c6e89a', '#6cc04a'], ['#f4b6c2', '#d55181'], ['#ffe8a3', '#f0b429']];
  /** 0–1023 for a spot, well mixed, the same every build (the farm's: scuffs without stripes). */
  const noise = (x, y) => {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x9e37, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) & 1023;
  };
  /** A project's bays in runs side by side, row by row: [[row, [columns]]] (the farm's). Another repo's bay between them splits a run. */
  function rowsOfGroup(g) {
    const runs = [];
    for (const i of [...g.slots].sort((a, b) => a - b)) {
      const last = runs.at(-1), r = Math.floor(i / 3), c = i % 3;
      if (last && last[0] === r && last[1].at(-1) === c - 1) last[1].push(c); else runs.push([r, [c]]);
    }
    return runs;
  }

  // Shapes. f paints a rectangle; the light comes from the top left, so shadows fall to the right and down.
  /** Hazard stripes, yellow and black on the slant, filling a box. */
  function hazard(f, x, y, w, h) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) f(x + i, y + j, 1, 1, (x + i + y + j) % 6 < 3 ? YELLOW : BLACK);
  }
  /** The back wall across the ground: cream panels, a pale-blue skirting, the window frames (their glass is the sky's), an extinguisher and a first-aid box. */
  function backWall(f, x0, x1, y0) {
    f(x0, y0, x1 - x0, 64 - y0, WALL);
    for (let x = Math.floor(x0 / 40) * 40; x < x1; x += 40) f(x, y0, 1, 46 - y0, WALL_SEAM);
    f(x0, 0, x1 - x0, 2, '#c9b48a'); // the cornice
    f(x0, 46, x1 - x0, 16, SKIRT); f(x0, 46, x1 - x0, 1, '#ffffff'); f(x0, 47, x1 - x0, 1, SKIRT_TOP);
    f(x0, 62, x1 - x0, 2, BASEBOARD);
    for (const [x, y, w, h] of WINDOWS) {
      f(x - 2, y - 2, w + 4, h + 4, '#9aa4ad'); f(x - 1, y - 1, w + 2, h + 2, '#ffffff'); f(x, y, w, h, '#a9dcf7');
      f(x - 3, y + h + 1, w + 6, 2, '#ffffff'); f(x - 3, y + h + 3, w + 6, 1, '#c3cbd2'); // the sill
    }
    f(12, 36, 7, 1, '#5f6b7a'); f(13, 37, 5, 12, '#e04a3a'); f(13, 37, 1, 12, '#ff6b6b'); f(17, 37, 1, 12, '#b23a2e'); f(14, 34, 3, 3, '#3a3a40'); f(17, 34, 3, 1, '#3a3a40'); f(14, 41, 3, 3, '#ffffff'); // a fire extinguisher
    f(21, 36, 8, 8, '#ffffff'); f(21, 36, 8, 1, '#c3cbd2'); f(24, 37, 2, 6, '#2fa57a'); f(22, 39, 6, 2, '#2fa57a'); f(21, 44, 8, 1, '#9aa4ad'); // a first-aid box
    f(314, 0, 2, 64, '#9aa4ad'); f(314, 0, 1, 64, '#c3cbd2'); for (let y = 8; y < 64; y += 14) f(313, y, 4, 2, '#5f6b7a'); // a pipe up the wall
  }
  // The fabricator's hopper (the middle of its mouth, on top) and the elbow of its pipe from the wall: steaming, sparks fly off them.
  const FAB_HOPPER = [60, 8], FAB_PIPE = [86, 11];
  /** The fabricator: a big friendly red machine; parts go in its hopper, and new robots roll out of its door onto the walkway. */
  function fabricator(f) {
    const [hx, hy] = FAB_HOPPER, [px0, py0] = FAB_PIPE;
    f(89, 22, 3, 52, WALL_SEAM); f(36, 76, 56, 2, WALK_SHADOW); // its shadow on the wall and the walkway
    for (let j = 0; j < 12; j++) { const d = Math.round((j * 8) / 11); f(hx - 19 + d, hy + j, 38 - 2 * d, 1, '#5f6b7a'); f(hx - 18 + d, hy + j, 36 - 2 * d, 1, j < 2 ? '#e6eef5' : '#c3cbd2'); f(hx + 12 - d, hy + j, 6, 1, '#9aa4ad'); } // the hopper
    f(px0 - 8, py0, 10, 3, '#9aa4ad'); f(px0 - 8, py0, 10, 1, '#c3cbd2'); f(px0, py0, 2, 12, '#9aa4ad'); // a pipe from the wall
    f(33, 20, 54, 1, '#5a1f19'); f(32, 21, 56, 53, '#5a1f19'); f(33, 21, 54, 52, '#e04a3a');
    f(33, 21, 54, 2, '#ff6b6b'); f(33, 21, 2, 52, '#ff6b6b'); f(83, 21, 4, 52, '#b23a2e'); f(33, 70, 54, 3, '#9c3b30'); f(33, 73, 54, 1, '#5a1f19');
    f(32, 74, 6, 2, '#3a3a40'); f(82, 74, 6, 2, '#3a3a40'); // its feet
    f(37, 26, 46, 14, '#9c3b30'); f(38, 27, 44, 12, '#e6eef5'); f(38, 27, 44, 1, '#ffffff'); // the control panel
    f(40, 29, 15, 8, '#3a3a40'); f(41, 30, 13, 6, '#2c4a85'); f(45, 31, 5, 3, '#5ab4ff'); f(46, 32, 1, 1, '#ffffff'); f(48, 32, 1, 1, '#ffffff'); f(46, 34, 3, 1, '#5ab4ff'); // its screen: a robot's face
    ['#2fa57a', '#ffd43b', '#3d7be0', '#ff6b6b'].forEach((c, i) => { f(59 + i * 6, 30, 4, 4, '#3a3a40'); f(60 + i * 6, 31, 2, 2, c); });
    f(59, 36, 22, 1, '#c3cbd2');
    for (const [x, y] of [[35, 23], [84, 23], [35, 68], [84, 68]]) f(x, y, 1, 1, '#9c3b30'); // bolts
    hazard(f, 48, 42, 28, 2); hazard(f, 48, 44, 2, 30); hazard(f, 74, 44, 2, 30); // the door's frame
    f(50, 44, 24, 30, '#3a3a40'); f(50, 44, 24, 3, BLACK); f(66, 47, 2, 8, '#5f6b7a'); f(64, 55, 6, 2, '#9aa4ad'); // inside: dark, a robot arm hanging
    f(50, 68, 24, 4, '#5f6b7a'); for (let x = 51; x < 74; x += 3) f(x, 69, 1, 2, '#9aa4ad'); // its rollers
    f(47, 74, 30, 2, '#9aa4ad'); f(47, 74, 30, 1, '#c3cbd2'); // the plate out onto the walkway
  }
  /** The drone dock: a blue cabinet of six slots, a landing deck on top (finished subagents' drones sit in the slots). */
  function droneDock(f) {
    f(126, 34, 2, 40, WALL_SEAM); f(98, 76, 30, 1, WALK_SHADOW);
    f(95, 31, 32, 3, '#5f6b7a'); f(96, 31, 30, 1, '#e6eef5'); f(99, 32, 4, 1, YELLOW); f(119, 32, 4, 1, YELLOW); // the landing deck
    f(97, 34, 28, 41, '#2c4a85'); f(98, 34, 26, 40, '#3d7be0'); f(98, 34, 26, 2, '#5ab4ff'); f(98, 34, 1, 40, '#5ab4ff'); f(121, 34, 3, 40, '#2c4a85');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const x = 100 + c * 11, y = 38 + r * 12;
      f(x, y, 10, 10, '#2c4a85'); f(x + 1, y + 1, 8, 8, '#3a3a40'); f(x + 2, y + 8, 6, 1, '#c3cbd2'); f(x + 8, y + 1, 1, 1, '#6cc04a');
    }
    f(98, 74, 3, 2, '#3a3a40'); f(121, 74, 3, 2, '#3a3a40');
  }
  /** Your desk: a long wooden desk with a lamp, a screen, a mug, an in-tray and a plant; robots queue at it (the beacon over it is drawn each frame). */
  function desk(f) {
    f(141, 74, 120, 2, WALK_SHADOW); f(260, 57, 2, 17, WALL_SEAM);
    f(140, 55, 120, 1, '#6b4320'); f(140, 56, 120, 5, '#e2b07a'); f(140, 56, 120, 1, '#f4d58d'); f(140, 61, 120, 1, '#a8703c'); // the top
    f(140, 62, 120, 12, '#6b4320'); f(141, 62, 118, 11, '#c98d4f'); f(141, 62, 118, 1, '#e2b07a'); f(141, 72, 118, 1, '#a8703c');
    for (let x = 160; x < 260; x += 20) f(x, 63, 1, 9, '#a8703c'); // its panels
    f(148, 53, 8, 2, '#5f6b7a'); f(151, 46, 1, 7, '#9aa4ad'); f(151, 45, 5, 1, '#9aa4ad'); f(155, 43, 7, 3, '#f0b429'); f(155, 43, 7, 1, '#ffd43b'); f(156, 46, 5, 1, '#ffe8a3'); // the lamp
    f(142, 42, 2, 14, '#5f6b7a'); f(140, 40, 6, 2, '#3a3a40'); // the beacon's post
    f(176, 51, 4, 5, '#e04a3a'); f(176, 51, 4, 1, '#ff6b6b'); f(180, 52, 1, 2, '#e04a3a'); // a mug
    f(189, 41, 24, 13, '#3a3a40'); f(191, 43, 20, 9, '#2c4a85'); // the screen
    f(193, 44, 8, 1, '#5ab4ff'); f(193, 46, 11, 1, '#a9dcf7'); f(193, 48, 6, 1, '#6cc04a'); f(193, 50, 9, 1, '#5ab4ff');
    f(205, 47, 2, 4, '#3d7be0'); f(208, 45, 2, 6, '#5ab4ff');
    f(199, 54, 4, 1, '#5f6b7a'); f(196, 55, 10, 1, '#3a3a40');
    f(221, 52, 13, 3, '#9aa4ad'); f(221, 52, 13, 1, '#c3cbd2'); f(223, 50, 9, 2, '#ffffff'); // the in-tray
    f(244, 49, 7, 6, '#c8681a'); f(244, 49, 7, 1, '#e9a23b'); f(243, 42, 9, 7, '#3f9b3a'); f(245, 40, 5, 3, '#6cc04a'); f(242, 45, 2, 2, '#6cc04a'); f(250, 44, 2, 3, '#2f6b2f'); // a plant
  }
  /** The manuals shelf: a narrow case of coloured binders (what your projects remember). */
  function manualsShelf(f) {
    f(278, 30, 2, 44, WALL_SEAM); f(263, 76, 17, 1, WALK_SHADOW);
    f(261, 26, 18, 2, '#3a3a40'); f(262, 28, 16, 47, '#5f6b7a'); f(263, 28, 14, 46, '#e6eef5');
    const BINDERS = ['#e04a3a', '#3d7be0', '#2fa57a', '#ffd43b', '#8a5fc0', '#f08a24'];
    [39, 51, 63, 73].forEach((y, s) => {
      for (let i = 0; i < 6; i++) {
        if ((i + s) % 5 === 4) continue; // a gap: a manual out
        const h = 6 + (noise(i, s) % 3), x = 264 + i * 2;
        f(x, y - h, 2, h, BINDERS[(i + s * 2) % BINDERS.length]); f(x, y - h + 2, 1, 1, '#ffffff');
      }
      f(263, y, 14, 2, '#8a8f96'); f(263, y, 14, 1, '#c3cbd2');
    });
  }
  /** The power-cell bank: a cabinet of eight cells under a lamp (the weekly limit lights them). */
  function powerBank(f) {
    f(310, 22, 2, 52, WALL_SEAM); f(287, 76, 25, 1, WALK_SHADOW);
    f(297, 4, 2, 10, '#3a3a40'); f(294, 14, 8, 6, '#5f6b7a'); f(295, 15, 6, 4, '#c3cbd2'); // its cable, its lamp
    f(286, 20, 24, 55, '#3a3a40'); f(287, 21, 22, 53, '#c3cbd2'); f(287, 21, 22, 1, '#e6eef5'); f(287, 21, 1, 53, '#e6eef5'); f(306, 21, 3, 53, '#9aa4ad');
    f(287, 23, 19, 3, '#2fa57a'); f(296, 23, 2, 1, YELLOW); f(295, 24, 2, 1, YELLOW); f(294, 25, 2, 1, YELLOW); // a bolt on its green band
    for (const [x, y] of CELLS) { f(x, y + 1, 8, 9, '#3a3a40'); f(x + 3, y, 2, 1, '#3a3a40'); f(x + 1, y + 2, 6, 7, '#5f6b7a'); }
    f(287, 74, 3, 2, '#3a3a40'); f(306, 74, 3, 2, '#3a3a40');
  }
  /** The loading dock: a roll-up door half up in a hazard-striped frame, a trailer's dark inside, the dock plate in front (the crates are drawn each frame). */
  function loadingDock(f) {
    hazard(f, 321, 13, 73, 3); hazard(f, 321, 16, 3, 50); hazard(f, 391, 16, 3, 50);
    f(324, 16, 67, 50, '#3a3a40'); for (let x = 328; x < 390; x += 8) f(x, 50, 2, 16, '#5f6b7a'); // the trailer's inside, its ribs
    f(324, 16, 67, 33, '#f08a24'); for (let y = 18; y < 48; y += 3) f(324, y, 67, 1, '#c8681a'); f(324, 47, 67, 3, '#9c3b30'); f(352, 48, 11, 1, '#3a3a40'); // the door
    f(326, 54, 3, 12, BLACK); f(387, 54, 3, 12, BLACK); // bumpers
    f(320, 64, 74, 10, '#9aa4ad'); f(320, 64, 74, 1, '#c3cbd2');
    for (let y = 66; y < 72; y += 3) for (let x = 322 + (y % 2) * 2; x < 392; x += 4) f(x, y, 1, 1, '#c3cbd2'); // its plate's tread
    hazard(f, 320, 72, 74, 2); f(321, 74, 74, 2, WALK_SHADOW);
    f(333, 71, 39, 2, '#c98d4f'); for (let x = 336; x < 372; x += 6) f(x, 72, 2, 1, '#8b5a2b'); // the pallet
  }
  /** The storage shelf: a rack with a pegboard back; stale robots stand powered down on its deck. */
  function storageShelf(f) {
    const { x, y, w, h } = SHELF_BOX, rack = w - 2; // its shadow falls 2 to the right
    f(x + 4, y + 2, rack - 8, 26, '#e6eef5');
    for (let py = y + 5; py < y + 27; py += 4) for (let bx = x + 7 + (py % 8 ? 2 : 0); bx < x + 99; bx += 4) f(bx, py, 1, 1, '#c3cbd2'); // its pegboard
    f(x, y, rack, 3, '#8a8f96'); f(x, y, rack, 1, '#c3cbd2');
    f(x, y, 4, h, '#5f6b7a'); f(x + 1, y, 1, h, '#8a8f96'); f(x + rack - 4, y, 4, h, '#5f6b7a'); f(x + rack - 3, y, 1, h, '#8a8f96'); // its legs
    f(x, y + 28, rack, 3, '#9aa4ad'); f(x, y + 28, rack, 1, '#c3cbd2'); f(x, y + 31, rack, 2, '#5f6b7a'); f(x + 2, y + h - 1, rack, 1, SHADOW); // its deck
    for (const [sx] of SHELF) f(sx - 2, y + 31, 5, 1, '#ffffff'); // bin tags
  }
  /** A charging pad under a robot's feet at (x, y): a painted green bay, a green disc with a bolt on its front, a charger beside it. */
  function chargingPad(f, x, y) {
    f(x - 11, y - 9, 22, 13, '#9ed36a'); f(x - 10, y - 8, 20, 11, '#c6e89a'); // its painted bay
    f(x + 8, y - 15, 5, 16, '#5f6b7a'); f(x + 9, y - 14, 3, 14, '#e6eef5'); f(x + 9, y - 12, 3, 4, '#2f6b2f'); f(x + 10, y - 11, 1, 2, '#6cc04a'); f(x + 13, y - 13, 1, 14, SHADOW); // the charger
    f(x + 6, y + 1, 4, 1, '#3a3a40'); // its cable
    f(x - 6, y - 3, 13, 1, '#2f6b2f'); f(x - 8, y - 2, 17, 5, '#2f6b2f'); f(x - 6, y + 3, 13, 1, '#2f6b2f');
    f(x - 6, y - 2, 13, 5, '#2fa57a'); f(x - 7, y - 1, 15, 3, '#2fa57a'); f(x - 6, y - 2, 13, 1, '#6cc04a'); f(x - 7, y - 1, 1, 1, '#6cc04a');
    f(x - 1, y + 2, 1, 1, YELLOW); f(x, y + 1, 1, 1, YELLOW); f(x + 1, y, 1, 1, YELLOW); f(x - 1, y + 1, 1, 1, YELLOW); f(x + 1, y + 1, 1, 1, YELLOW);
  }
  /** A sleep pod for a robot's feet at (x, y): a white capsule, padded inside, a clock on its crown (its glass goes over the sleeper: items). */
  function sleepPod(f, x, y) {
    const { dx, dy, w, h } = POD_BOX, top = y + dy;
    f(x + dx + 2, top + h - 2, w - 2, 2, SHADOW);
    for (let j = 0; j < 5; j++) { const half = [5, 7, 8, 9, 10][j]; f(x - half, top + j, half * 2, 1, '#5f6b7a'); f(x - half + 1, top + j, half * 2 - 2, 1, j < 2 ? '#ffffff' : '#e6eef5'); } // its dome
    f(x + dx, top + 5, 20, 34, '#5f6b7a'); f(x - 9, top + 5, 18, 33, '#e6eef5'); f(x - 9, top + 5, 1, 33, '#ffffff'); f(x + 7, top + 5, 2, 33, '#c3cbd2');
    f(x - 8, y - 25, 16, 25, '#2c4a85'); for (let yy = y - 22; yy < y; yy += 5) f(x - 8, yy, 16, 1, '#3d7be0'); // the padded inside
    f(x - 9, y, 18, 3, '#9aa4ad'); f(x - 9, y, 18, 1, '#c3cbd2'); // the floor it stands on
    f(x - 2, top, 5, 7, '#3a3a40'); f(x - 3, top + 1, 7, 5, '#3a3a40'); f(x - 1, top + 1, 3, 5, '#ffffff'); f(x - 2, top + 2, 5, 3, '#ffffff'); // its clock, a round dial,
    f(x, top + 2, 1, 2, '#3a3a40'); f(x + 1, top + 3, 1, 1, '#e04a3a'); // and its hands
  }
  /** A pod's glass over its sleeper, drawn among the robots (items). */
  function podGlass(x, y) {
    PXG.ctx.globalAlpha = 0.22; px(x - 8, y - 25, 16, 25, '#a9dcf7'); PXG.ctx.globalAlpha = 0.7;
    px(x - 6, y - 23, 1, 7, '#ffffff'); px(x - 5, y - 24, 2, 1, '#ffffff'); px(x + 5, y - 8, 1, 4, '#ffffff'); PXG.ctx.globalAlpha = 1;
    px(x - 9, y - 26, 18, 1, '#9aa4ad');
  }
  /** The open table (robots working outside any repo stand round it), drawn among them: two behind it, two in front. */
  function openTable() {
    const { x, y, w, h } = TABLE_BOX; // its top's top is y + 5, its legs' shadow y + h − 1
    px(x + 3, y + 17, 3, 8, '#5f6b7a'); px(x + w - 6, y + 17, 3, 8, '#5f6b7a'); px(x + 4, y + h - 1, w - 6, 1, SHADOW); // legs and shadow
    px(x, y + 5, w, 13, '#8b5a2b'); px(x + 1, y + 5, w - 2, 9, '#e2b07a'); px(x + 1, y + 5, w - 2, 1, '#f4d58d'); for (let gx = x + 7; gx < x + w - 1; gx += 11) px(gx, y + 7, 4, 1, '#c98d4f'); // the top, its grain
    px(x + 1, y + 14, w - 2, 3, '#c98d4f'); px(x + 1, y + 17, w - 2, 1, '#6b4320');
    px(x + 23, y + 1, 9, 5, '#e04a3a'); px(x + 23, y + 1, 9, 1, '#ff6b6b'); px(x + 26, y, 3, 1, '#3a3a40'); // a toolbox
    px(x + 8, y + 8, 3, 3, '#9aa4ad'); px(x + 9, y + 9, 1, 1, '#5f6b7a'); px(x + 39, y + 9, 6, 2, '#3d7be0'); px(x + 51, y + 8, 2, 3, '#ffd43b'); // a gear, a board, a part
  }
  /** A parking bay in the AGVs' rank: yellow corners and a charging plate, where an MCP server's AGV waits. */
  function rankBay(f, x, y) {
    const x0 = x + RANK_BOX.dx, y0 = y + RANK_BOX.dy, x1 = x0 + RANK_BOX.w - 1, y1 = y0 + RANK_BOX.h - 1; // its corners
    for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) { f(Math.min(cx, cx + sx * 2), cy, 3, 1, YELLOW); f(cx, Math.min(cy, cy + sy * 2), 1, 3, YELLOW); }
    f(x - 3, y - 4, 7, 3, '#c3cbd2'); f(x - 2, y - 3, 5, 1, '#9aa4ad');
  }
  /** With more than three rows of bays the left side grows too: for each row more, a tool cabinet (its top left) and a potted plant (its foot). */
  const rowFurniture = L => Array.from({ length: Math.max(0, L.rows - 3) }, (_, i) => {
    const r = 3 + i, y = 100 + r * ROWH;
    return { cabinet: [r % 2 ? 60 : 14, y + 16], plant: [r % 2 ? 24 : 90, y + 44] };
  });
  /** A red tool cabinet, its top left at (x, y). */
  function toolCabinet(f, x, y) {
    const w = CABINET_BOX.w - 2, h = CABINET_BOX.h - 2; // its shadow is the 2 more
    f(x + 2, y + h, w, 2, SHADOW); f(x, y, w, h, '#5a1f19'); f(x + 1, y + 1, 26, 22, '#e04a3a'); f(x + 1, y + 1, 26, 1, '#ff6b6b');
    for (let k = 0; k < 4; k++) { f(x + 1, y + 6 + k * 5, 26, 1, '#9c3b30'); f(x + 11, y + 3 + k * 5, 6, 1, '#c3cbd2'); }
  }
  /** A potted plant standing at (x, y). */
  function pottedPlant(f, x, y) {
    f(x - 3, y - 6, 7, 6, '#c8681a'); f(x - 3, y - 6, 7, 1, '#e9a23b'); f(x - 1, y, 7, 1, SHADOW);
    f(x - 5, y - 14, 11, 8, '#3f9b3a'); f(x - 3, y + PLANT_BOX.dy, 6, 4, '#6cc04a'); f(x + PLANT_BOX.dx, y - 10, 2, 2, '#6cc04a'); f(x + 4, y - 12, 2, 3, '#2f6b2f'); // its leaves, from the top of its box
  }
  /** An empty slot, where no repo has a bay yet: bare floor, a faint dashed outline. */
  function emptyBay(f, { x0, y0 }) {
    for (let x = x0; x < x0 + 72; x += 4) { f(x, y0, 2, 1, SHADOW); f(x, y0 + 29, 2, 1, SHADOW); }
    for (let y = y0; y < y0 + 30; y += 4) { f(x0, y, 1, 2, SHADOW); f(x0 + 71, y, 1, 2, SHADOW); }
  }
  /** The conveyor along the bottom, centred on cy, across the whole ground: a pale-blue belt between rails, on legs (its slats move each frame). */
  function conveyor(f, x0, x1, cy) {
    f(x0, cy + 8, x1 - x0, 2, SHADOW);
    for (let x = Math.floor(x0 / 24) * 24 + 4; x < x1; x += 24) { f(x, cy + 7, 2, 5, '#8a8f96'); f(x + 2, cy + 8, 1, 4, SHADOW); }
    f(x0, cy - 7, x1 - x0, 2, '#5f6b7a'); f(x0, cy - 7, x1 - x0, 1, '#9aa4ad');
    f(x0, cy - 5, x1 - x0, 10, BELT); f(x0, cy - 5, x1 - x0, 1, '#e6eef5');
    f(x0, cy + 5, x1 - x0, 2, '#5f6b7a'); f(x0, cy + 7, x1 - x0, 1, '#3a3a40');
    for (let x = Math.floor(x0 / 12) * 12; x < x1; x += 12) f(x, cy + 5, 1, 1, '#9aa4ad'); // rivets
  }

  /**
   * The floor, drawn once (again when the bays change or the frame grows): everything that doesn't move. `ext`
   * is the ground to cover; the hall goes on past the world's edges.
   */
  function drawFloor(f, L, ext) {
    const { x0, x1, y0, y1 } = ext, G = L.GRID, cy = G.y1 + 12;
    f(x0, 64, x1 - x0, y1 - 64, FLOOR); // pale tiles, soft grout, a scuff here and there
    for (let x = Math.floor(x0 / 16) * 16; x < x1; x += 16) f(x, 64, 1, y1 - 64, GROUT);
    for (let y = 64; y < y1; y += 16) f(x0, y, x1 - x0, 1, GROUT);
    for (let y = 68; y < y1; y += 16) for (let x = Math.floor(x0 / 16) * 16 + 4; x < x1; x += 16) if (noise(x, y) % 11 === 0) f(x + (noise(y, x) % 8), y + (noise(x, x) % 8), 2, 1, GROUT);
    backWall(f, x0, x1, y0);
    // the walkway in front of the buildings, its edges painted in dashes
    f(x0, WALK.y0, x1 - x0, WALK.y1 - WALK.y0, WALKWAY);
    for (let x = Math.floor(x0 / 8) * 8; x < x1; x += 8) { f(x, WALK.y0 + 1, 5, 1, YELLOW); f(x, WALK.y1 - 2, 5, 1, YELLOW); }
    f(x0, WALK.y1 - 1, x1 - x0, 1, WALK_SHADOW);
    // the paths down: the left side's, and the aisles between the bays' columns
    f(CORR[0] - 6, WALK.y1, 12, G.y1 - WALK.y1, WALKWAY); f(CORR[0] + 5, WALK.y1, 1, G.y1 - WALK.y1, WALK_SHADOW);
    for (const c of CORR.slice(1)) f(c - 5, G.y0, 10, G.y1 - G.y0, WALKWAY);
    // a project's bays: a painted floor zone round them (its sign is a label)
    for (const g of L.groups) {
      const [paint, edge] = PAINTS[hashOf(g.name ?? '') % PAINTS.length];
      for (const [r, cols] of rowsOfGroup(g)) {
        const top = 100 + r * ROWH, gx0 = 174 + Math.min(...cols) * COLW - 43, gx1 = 174 + Math.max(...cols) * COLW + 43;
        f(gx0, top + 2, gx1 - gx0 + 1, 58, paint);
        for (let x = gx0; x <= gx1; x += 4) { f(x, top + 2, 2, 1, edge); f(x, top + 59, 2, 1, edge); }
        for (let y = top + 2; y <= top + 59; y += 4) { f(gx0, y, 1, 2, edge); f(gx1, y, 1, 2, edge); }
      }
    }
    for (const s of L.ST) f(s.x0, s.y0, 72, 30, BAY); // each bay's floor plate (the bays draw on it)
    for (const s of L.empty) emptyBay(f, s);
    for (const [x, y] of ventsOf(L)) floorVent(f, x, y); // over a project's paint, which runs across the aisle between its bays
    // the safety line round the bays, with gaps where the paths come in: from the walkway down the aisles, and from the left side's path along each row's lane
    const lanes = [...new Set(L.slots.map(s => s.lane))], open = (v, gaps) => gaps.some(([a, b]) => v >= a && v < b);
    for (let x = G.x0; x < G.x1; x++) {
      if (!open(x, CORR.slice(1).map(c => [c - 6, c + 6]))) hazard(f, x, G.y0, 1, 3);
      hazard(f, x, G.y1 - 3, 1, 3);
    }
    for (let y = G.y0 + 3; y < G.y1 - 3; y++) {
      if (!open(y, lanes.map(l => [l - 6, l + 4]))) hazard(f, G.x0, y, 3, 1);
      hazard(f, G.x1 - 3, y, 3, 1);
    }
    // the left side
    storageShelf(f);
    for (const [x, y] of PADS) chargingPad(f, x, y);
    for (const [x, y] of PODS) sleepPod(f, x, y);
    for (const [x, y] of RANK) rankBay(f, x, y);
    for (const { cabinet, plant } of rowFurniture(L)) { toolCabinet(f, ...cabinet); pottedPlant(f, ...plant); }
    conveyor(f, x0, x1, cy);
    // the buildings along the back wall
    fabricator(f); droneDock(f); desk(f); manualsShelf(f); powerBank(f); loadingDock(f);
  }

  /** The loading dock's crates: one for each open pull request across the bays (8 at most), and its QA tag: ok, failed, running, draft (whatever its checks) or none. */
  function dockCrates(fields) {
    return fields.flatMap(fl => fl.prs?.open ?? []).slice(0, 8).map((pr, i) => ({
      x: 335 + (i % 4) * 9, y: 64 - Math.floor(i / 4) * 7, qa: pr.draft ? 'draft' : ['ok', 'failed', 'running'].includes(pr.checks) ? pr.checks : 'none',
    }));
  }
  const QA = { ok: '#2fa57a', failed: '#e04a3a', draft: '#9aa4ad', none: '#e8d8b0' }; // running: amber, blinking
  /**
   * The sky in the windows, by your clock (the engine's sky, which the Sky switch can hold at day or night):
   * blue by day with the sun and clouds going by, rose at dawn and dusk, dark with stars and the moon at night.
   */
  function drawWindows(sky) {
    const T = PXG.T, night = sky.phase === 'night', dusk = sky.phase === 'dawn' || sky.phase === 'dusk';
    const [hi, mid, lo] = night ? ['#1b1420', '#2c4a85', '#3d7be0'] : dusk ? ['#5a3b85', '#d55181', '#f4b6c2'] : ['#3d7be0', '#5ab4ff', '#a9dcf7'];
    /** A rectangle of the sky, only where it shows: inside the windows. */
    const pane = (x, y, w, h, c) => {
      for (const [wx, wy, ww, wh] of WINDOWS) {
        const a = Math.max(x, wx), b = Math.max(y, wy), e = Math.min(x + w, wx + ww), g = Math.min(y + h, wy + wh);
        if (e > a && g > b) px(a, b, e - a, g - b, c);
      }
    };
    pane(0, 6, W, 8, hi); pane(0, 14, W, 8, mid); pane(0, 22, W, 8, lo);
    if (night) for (let i = 0; i < 24; i++) if ((i + Math.floor(T * 0.7 + i * 0.3)) % 5) pane((i * 53 + 7) % W, 7 + ((i * 17) % 20), 1, 1, i % 3 ? '#ffffff' : '#ffe8a3'); // stars, twinkling
    if (sky.sun) { const x = Math.round(sky.sun.x), y = 10 + Math.round(sky.sun.y); pane(x - 2, y - 3, 5, 7, '#ffd43b'); pane(x - 3, y - 2, 7, 5, '#ffd43b'); pane(x - 1, y - 2, 3, 3, '#ffe8a3'); }
    if (sky.moon) { const x = Math.round(sky.moon.x), y = 10 + Math.round(sky.moon.y); pane(x - 2, y - 3, 5, 7, '#e6eef5'); pane(x - 3, y - 2, 7, 5, '#e6eef5'); pane(x + 1, y - 3, 3, 4, hi); } // a crescent
    if (!night) for (let k = 0; k < 3; k++) { // clouds drifting by
      const x = Math.round(((T * (1.5 + k * 0.6) + k * 157) % (W + 60)) - 30), y = 9 + k * 6, c = dusk ? '#f4b6c2' : '#ffffff';
      pane(x, y + 2, 20, 3, c); pane(x + 3, y, 8, 2, c); pane(x + 10, y - 1, 7, 3, c); pane(x + 1, y + 5, 18, 1, dusk ? '#d55181' : '#e6eef5');
    }
    for (const [x, y, w, h] of WINDOWS) { // the glazing bars
      const n = Math.max(1, Math.round(w / 13));
      for (let i = 1; i < n; i++) px(x + Math.round((i * w) / n), y, 1, h, '#ffffff');
      px(x, y + (h >> 1), w, 1, '#ffffff');
    }
  }

  /* ---------- the bays: a robot built on each bench as the context fills, and what its repo's state puts round it ---------- */

  // A bay at its slot s (s.cx its middle, s.rowTop its row's top, t below): the floor plate is cx ± 36, t + 12 to
  // t + 42 (drawFloor paints it), and the robots working there stand on t + 44, in front of it. On the plate,
  // back to front: the tube outlet (back left, the overhead tube comes down to it), the bench in the middle with
  // the robot being built standing on it in its yellow frame (a glass clean room for a worktree), the part
  // printer and the boxed parts at the bench's right, the stack light (back right); the loose parts lie on the
  // floor at the front left. The sign under it is a label (labels()).
  const BUILD_Y = 23; // the robot being built stands here, on the bench (from the row's top)
  /** Where a bay's overhead tube comes down: the top of its outlet's pipe. And where its stack light's lamps are (their middle). */
  const outletAt = s => [s.cx - 30, s.rowTop];
  const stackLightAt = s => [s.cx + 31, s.rowTop + 6];

  /** The bench under the robot being built: a steel top, a yellow and black front edge, two legs, its shadow. */
  function bench(cx, t) {
    px(cx - 15, t + 33, 31, 1, '#9aa4ad');
    px(cx - 16, t + 20, 32, 10, K);
    px(cx - 15, t + 21, 30, 1, '#ffffff'); px(cx - 15, t + 22, 30, 3, '#e6eef5'); // the top, lit along its back
    px(cx - 15, t + 25, 30, 2, BLACK); for (let x = cx - 15; x < cx + 15; x += 4) px(x, t + 25, 2, 2, YELLOW);
    px(cx - 15, t + 27, 30, 2, '#9aa4ad'); px(cx + 11, t + 27, 4, 2, '#8a8f96'); // its front, in shade at the right
    px(cx - 14, t + 30, 2, 3, '#5f6b7a'); px(cx + 12, t + 30, 2, 3, '#5f6b7a');
  }
  /** The open assembly frame on the bench: two yellow posts and a beam over the robot, a hoist under it. */
  function assemblyFrame(cx, t) {
    px(cx - 12, t + 2, 24, 5, K); px(cx - 11, t + 3, 22, 3, YELLOW); px(cx - 11, t + 3, 22, 1, '#ffe8a3'); px(cx - 11, t + 5, 22, 1, '#f0b429');
    for (const x of [cx - 12, cx + 8]) { px(x, t + 6, 4, 17, K); px(x + 1, t + 6, 2, 16, YELLOW); px(x + 1, t + 6, 1, 16, '#ffe8a3'); }
    px(cx - 1, t + 6, 2, 1, '#5f6b7a');
  }
  /** A worktree's clean room in place of the open frame: pale-blue glass in a white frame, a filter unit on its roof, glints. Drawn over the robot. */
  function cleanRoom(cx, t) {
    PXG.ctx.globalAlpha = 0.3; px(cx - 12, t + 3, 24, 18, '#a9dcf7'); PXG.ctx.globalAlpha = 1;
    px(cx - 13, t + 1, 26, 2, '#9aa4ad'); px(cx - 13, t + 1, 26, 1, '#e6eef5'); px(cx - 6, t - 1, 12, 2, '#c3cbd2'); px(cx - 4, t - 1, 8, 1, '#5f6b7a'); // its roof, the filter unit
    px(cx - 13, t + 3, 1, 19, '#e6eef5'); px(cx + 12, t + 3, 1, 19, '#c3cbd2'); px(cx - 13, t + 12, 26, 1, '#e6eef5'); // its corners, a rail
    PXG.ctx.globalAlpha = 0.75; px(cx - 10, t + 5, 1, 3, '#ffffff'); px(cx - 9, t + 4, 1, 2, '#ffffff'); px(cx + 9, t + 15, 1, 3, '#ffffff'); PXG.ctx.globalAlpha = 1;
  }
  const FRAME_K = '#8a8f96', FRAME_H = '#c3cbd2';
  /**
   * The robot being built, standing on the bench, at its stage: 0 its frame (a ring for the head, shoulders, a
   * spine, hips, two struts), 1 wired (red, yellow and blue wires, a circuit board), 2 plated (its body and drive
   * in its robot's colour, wires in its empty head), 3 its head on (the visor dark), 4 its eyes lit, a sparkle now and then.
   */
  function builtRobot(cx, t, stage, look, color, T) {
    const ox = cx - 7, oy = t + BUILD_Y - 16, rp = rpAt(ox, oy);
    if (stage >= 3) {
      PXG.ctx.drawImage(robotSprite(look, color), ox, oy, 14, 16);
      if (stage === 4) {
        rp(5, 5, 1, 2, METAL.e); rp(8, 5, 1, 2, METAL.e);
        if (Math.floor(T * 3 + cx) % 11 === 0) { rp(13, -3, 1, 3, '#ffffff'); rp(12, -2, 3, 1, '#ffffff'); }
      }
      return;
    }
    if (stage === 2) PXG.ctx.drawImage(robotSprite(look, color), 0, 9, 14, 7, ox, oy + 9, 14, 7);
    else {
      rp(2, 9, 10, 1, FRAME_K); rp(6, 9, 2, 4, FRAME_K); rp(3, 12, 8, 1, FRAME_K); rp(1, 10, 1, 2, FRAME_K); rp(12, 10, 1, 2, FRAME_K);
      rp(4, 13, 1, 2, FRAME_K); rp(9, 13, 1, 2, FRAME_K); rp(3, 15, 3, 1, '#3a3a40'); rp(8, 15, 3, 1, '#3a3a40'); rp(6, 9, 1, 3, FRAME_H);
      if (stage === 1) { rp(5, 9, 1, 5, '#e04a3a'); rp(8, 10, 1, 4, '#ffd43b'); rp(9, 10, 2, 2, '#2fa57a'); rp(10, 10, 1, 1, '#ffd43b'); }
    }
    rp(3, 3, 8, 1, FRAME_K); rp(2, 4, 1, 4, FRAME_K); rp(11, 4, 1, 4, FRAME_K); rp(3, 8, 8, 1, FRAME_K); rp(3, 3, 3, 1, FRAME_H);
    if (stage >= 1) { rp(7, 4, 1, 5, '#3d7be0'); rp(6, 4, 1, 1, '#3d7be0'); rp(5, 6, 1, 3, '#e04a3a'); rp(8, 7, 2, 1, '#ffd43b'); }
  }

  // The stack light's lamps, top to bottom, [lit, its glint, off]: red (failed), amber (running), green (ok).
  const LAMPS = [['failed', '#e04a3a', '#ff6b6b', '#5a1f19'], ['running', '#f0b429', '#ffd43b', '#6b4320'], ['ok', '#2fa57a', '#6cc04a', '#2f6b2f']];
  // "SHIPPED" in a 3 × 5 font, for the stack light's flash: each letter's rows, a bit a pixel (4 its left).
  const MINI = { S: [7, 4, 7, 1, 7], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], P: [6, 5, 6, 4, 4], E: [7, 4, 6, 4, 7], D: [6, 5, 5, 5, 6] };
  const mini = (text, x, y, c) => [...text].forEach((ch, i) => MINI[ch].forEach((bits, r) => { for (let b = 0; b < 3; b++) if (bits & (4 >> b)) px(x + i * 4 + b, y + r, 1, 1, c); }));
  /** A brass gear at (x, y): a round body, a hub, and teeth that turn by an eighth each step (straight, then slanted). */
  function gear(x, y, r, step) {
    px(x - r + 1, y - r + 2, 2 * r - 1, 2 * r - 3, '#e9a23b'); px(x - r + 2, y - r + 1, 2 * r - 3, 2 * r - 1, '#e9a23b');
    const teeth = step % 2 ? [[r - 1, r - 1], [r - 1, 1 - r], [1 - r, r - 1], [1 - r, 1 - r]] : [[0, -r], [r, 0], [0, r], [-r, 0]];
    for (const [dx, dy] of teeth) px(x + dx, y + dy, 1, 1, '#c8681a');
    px(x - r + 2, y - r + 1, 2 * r - 3, 1, '#f4d58d'); px(x, y, 1, 1, '#6b4320');
  }
  /**
   * The stack light at the back right, for the bay's last deploy: red, amber and green lamps on a pole, the
   * deploy's one lit. ok: green, a "SHIPPED" flash now and then; failed: red, blinking, with alarm rays and
   * sparks, the tower wobbling; running: amber, pulsing, gears turning on the pole; blocked (Actions didn't
   * run): a grey pause light; another state: every lamp off.
   */
  function stackLight(cx, t, light, T) {
    const x = cx + 29 + (light === 'failed' ? Math.round(Math.sin(T * 16)) : 0);
    px(cx + 28, t + 25, 7, 2, '#3a3a40'); px(cx + 30, t + 13, 1, 12, '#9aa4ad'); px(cx + 31, t + 13, 1, 12, '#5f6b7a'); // its foot and pole
    if (light === 'running') { const step = Math.floor(T * 4); gear(cx + 31, t + 17, 3, step); gear(cx + 33, t + 22, 2, step + 1); } // two gears turning, meshed
    px(x - 1, t, 7, 14, K); px(x, t + 1, 5, 1, '#5f6b7a'); px(x, t + 11, 5, 2, '#5f6b7a'); px(x, t + 11, 5, 1, '#9aa4ad'); // the tower: a cap, its lamps, a collar
    LAMPS.forEach(([state, lit, glint, off], i) => {
      const y = t + 2 + i * 3, on = light === state && !(state === 'failed' && blink(4)), bright = on && !(state === 'running' && blink(1.5));
      px(x, y, 5, 2, on ? (bright ? lit : glint) : light === 'blocked' ? '#8a8f96' : off);
      if (on) px(x + 1, y, 1, 1, '#ffffff');
    });
    if (light === 'blocked') { px(x, t + 5, 5, 2, '#c3cbd2'); px(x + 1, t + 5, 1, 2, '#3a3a40'); px(x + 3, t + 5, 1, 2, '#3a3a40'); } // pause
    if (light === 'ok' && T % 3 < 1.4) { // the flash: SHIPPED
      px(cx - 3, t - 7, 31, 9, K); px(cx - 2, t - 6, 29, 7, '#2fa57a'); px(cx - 2, t - 6, 29, 1, '#6cc04a');
      mini('SHIPPED', cx, t - 5, '#ffffff');
      px(x - 3, t + 8, 2, 1, '#6cc04a'); px(x + 6, t + 8, 2, 1, '#6cc04a');
    }
    if (light === 'failed') {
      if (!blink(4)) for (const [dx, dy] of [[-4, 2], [6, 2], [-3, -1], [5, -1]]) px(x + dx, t + dy, 3, 1, '#ff6b6b'); // the alarm's rays
      for (let i = 0; i < 4; i++) { // sparks from its foot
        const p = (T * 1.7 + i * 0.29) % 1, dir = i % 2 ? 1 : -1;
        if (p < 0.85) px(Math.round(cx + 31 + dir * (1 + p * 7)), Math.round(t + 24 - p * 9 + p * p * 12), 1, 1, i % 3 ? '#ffd43b' : '#ffffff');
      }
    }
  }
  /** The tube outlet at the back left: the overhead tube comes down its glass pipe into a receiver; a capsule waits on it while the repo is behind its remote, a light blinking. */
  function tubeOutlet(cx, t, waiting) {
    const [x] = outletAt({ cx, rowTop: t });
    px(x - 1, t, 3, 7, '#5f7f9a'); px(x, t, 1, 7, '#e6eef5');
    px(x - 4, t + 6, 9, 6, K); px(x - 3, t + 7, 7, 4, '#9aa4ad'); px(x - 3, t + 7, 7, 1, '#c3cbd2'); px(x - 1, t + 7, 3, 1, '#3a3a40');
    if (!waiting) return;
    px(x - 4, t + 3, 9, 4, K); px(x - 3, t + 4, 7, 2, '#e6eef5'); px(x - 3, t + 4, 7, 1, '#ffffff'); px(x - 3, t + 4, 1, 2, '#5f6b7a'); px(x + 3, t + 4, 1, 2, '#5f6b7a'); px(x, t + 4, 1, 2, '#f08a24');
    px(x + 3, t + 9, 1, 1, blink(2) ? '#ffd43b' : '#f0b429');
  }
  // One loose part for each uncommitted file (6 at most), on the floor in front of the outlet: a gear, a bolt, a spring, a chip, a wheel, a plate.
  const PARTS = [
    [-34, 19, (x, y) => { px(x, y + 1, 4, 2, '#9aa4ad'); px(x + 1, y, 2, 4, '#9aa4ad'); px(x + 1, y + 1, 1, 1, '#5f6b7a'); }],
    [-28, 20, (x, y) => { px(x, y, 3, 1, '#c3cbd2'); px(x + 1, y + 1, 1, 3, '#9aa4ad'); }],
    [-23, 19, (x, y) => { px(x, y, 3, 1, '#5ab4ff'); px(x + 2, y + 1, 1, 1, '#5ab4ff'); px(x, y + 2, 3, 1, '#5ab4ff'); px(x, y + 3, 1, 1, '#3d7be0'); }],
    [-33, 25, (x, y) => { px(x, y, 4, 2, '#2fa57a'); px(x + 1, y, 1, 1, '#ffd43b'); px(x, y + 2, 1, 1, '#c3cbd2'); px(x + 3, y + 2, 1, 1, '#c3cbd2'); }],
    [-27, 26, (x, y) => { px(x, y, 3, 3, '#3a3a40'); px(x + 1, y + 1, 1, 1, '#c3cbd2'); }],
    [-22, 25, (x, y) => { px(x, y, 4, 2, '#e04a3a'); px(x, y, 4, 1, '#ff6b6b'); }],
  ];
  // One box of parts for each unpushed commit (4 at most), at the bench's right end: two on the floor, two on them.
  const BOXES = [[16, 21], [22, 21], [16, 15], [22, 15]];
  function box(x, y) { px(x, y, 6, 6, '#8b5a2b'); px(x, y, 5, 5, '#c98d4f'); px(x, y, 5, 1, '#e2b07a'); px(x + 2, y, 1, 5, '#f4d58d'); }
  /** A part printer humming by the bench while a background command runs: its head runs to and fro over the part taking shape, its light blinks. */
  function partPrinter(cx, t, T) {
    const x = cx + 15, y = t + 3;
    px(x, y, 11, 11, K); px(x + 1, y + 1, 9, 9, '#e6eef5'); px(x + 1, y + 1, 9, 1, '#ffffff'); px(x + 8, y + 2, 2, 8, '#c3cbd2');
    px(x + 2, y + 3, 6, 5, '#3a3a40'); px(x + 3, y + 7, 4, 1, '#5ab4ff');
    px(x + 2 + Math.round((Math.sin(T * 5) + 1) * 2), y + 3, 2, 1, '#e04a3a');
    px(x + 8, y + 1, 1, 1, blink(2) ? '#6cc04a' : '#2f6b2f');
    if (blink(10)) { px(x - 2, y + 4, 1, 2, '#9aa4ad'); px(x + 12, y + 4, 1, 2, '#9aa4ad'); }
  }
  /** Hazard tape round a bay two robots are writing at once, red and white (the floor's safety line is yellow and black), on posts at its corners, pulsing (faster when it's serious). */
  function hazardTape(cx, t, high, T) {
    const x0 = cx - 38, x1 = cx + 38, y0 = t - 1, y1 = t + 45;
    PXG.ctx.globalAlpha = 0.7 + 0.3 * Math.sin(T * (high ? 14 : 6));
    for (let x = x0; x < x1; x += 3) { const c = ((x - x0) / 3) % 2 ? '#ffffff' : '#e04a3a'; px(x, y0, Math.min(3, x1 - x), 2, c); px(x, y1, Math.min(3, x1 - x), 2, c); }
    for (let y = y0 + 2; y < y1; y += 3) { const c = ((y - y0 - 2) / 3) % 2 ? '#ffffff' : '#e04a3a'; px(x0, y, 2, 3, c); px(x1 - 2, y, 2, 3, c); }
    PXG.ctx.globalAlpha = 1;
    for (const [x, y] of [[x0, y0], [x1 - 2, y0], [x0, y1], [x1 - 2, y1]]) { px(x, y - 4, 2, 6, '#3a3a40'); px(x, y - 5, 2, 1, YELLOW); }
  }
  /** A bay, each frame: its stack light, tube outlet, printer, bench, frame (or clean room) and robot, its parts and boxes, and the tape. `color`: whose robot it builds. */
  function drawBay(s, f, { look, color, jobs = 0, T = 0 }) {
    const { cx, rowTop: t } = s;
    if (f.light) stackLight(cx, t, f.light, T);
    tubeOutlet(cx, t, f.behind > 0);
    if (jobs > 0) partPrinter(cx, t, T);
    bench(cx, t);
    if (!f.worktree) assemblyFrame(cx, t);
    builtRobot(cx, t, f.build ?? 0, look, color, T);
    if (f.worktree) cleanRoom(cx, t);
    PARTS.slice(0, Math.min(6, f.dirty ?? 0)).forEach(([dx, dy, part]) => part(cx + dx, t + dy));
    BOXES.slice(0, Math.min(4, f.ahead ?? 0)).forEach(([dx, dy]) => box(cx + dx, t + dy));
    if (f.collision) hazardTape(cx, t, f.collision === 'high', T);
  }

  // A compaction: the finished robot waves on its bench (a cheer, confetti over it), rolls off to the aisle
  // beside its bay, down it onto the conveyor, and rides the belt off the floor. A merged pull request's crate
  // rolls up the dock plate into the trailer.
  const CHEER = 0.8, ROLL = 48, BELT_SPEED = 12, LEAVE = 1.6; // seconds; px a second (the belt's: its slats' speed); seconds
  const CONFETTI = ['#ff6b6b', '#ffd43b', '#6cc04a', '#5ab4ff', '#d55181'];
  const DOCK_DOOR = [357, 44];
  /** Where a finished robot is, t seconds after its bay's compaction: its feet, which way it faces, and whether it cheers or rides the belt. */
  function rollAt(s, cy, t) {
    const aisle = s.cx + 44 <= CORR[2] ? s.cx + 44 : s.cx - 44, y0 = s.rowTop + BUILD_Y, y1 = cy + 3;
    const a = CHEER, b = a + Math.abs(aisle - s.cx) / ROLL, c = b + (y1 - y0) / ROLL;
    if (t < a) return { x: s.cx, y: y0, view: 'down', cheer: true };
    if (t < b) return { x: s.cx + Math.sign(aisle - s.cx) * (t - a) * ROLL, y: y0, view: aisle > s.cx ? 'right' : 'left' };
    if (t < c) return { x: aisle, y: y0 + (t - b) * ROLL, view: 'down' };
    return { x: aisle + (t - c) * BELT_SPEED, y: y1, view: 'right', riding: true };
  }
  /** A finished robot rolling off: its eyes lit; waving with confetti over it while it cheers, then rolling, then carried still. */
  function rollingRobot({ look, color, t }, at, T) {
    const ox = Math.round(at.x) - 7, oy = Math.round(at.y) - 16, rp = rpAt(ox, oy);
    PXG.ctx.drawImage(robotSprite(look, color, { view: at.view, legs: at.cheer || at.riding ? 's' : walkFrame(T).legs, wave: at.cheer }), ox, oy, 14, 16);
    if (at.view === 'down') { rp(5, 5, 1, 2, METAL.e); rp(8, 5, 1, 2, METAL.e); } else rp(at.view === 'right' ? 10 : 3, 5, 1, 2, METAL.e);
    if (t < CHEER + 1) for (let i = 0; i < 6; i++) { const p = (t * 1.5 + i / 6) % 1; px(ox + ((i * 5 + Math.round(t * 8)) % 15), oy - 7 + Math.round(p * 9), 1, 1, CONFETTI[i % CONFETTI.length]); }
  }
  /** A merged pull request's crate leaving: up the dock plate into the trailer, fading as it goes in. */
  function leavingCrate(t) {
    const p = Math.min(1, t / LEAVE), y = Math.round(64 - p * 12);
    PXG.ctx.globalAlpha = 1 - Math.max(0, p - 0.6) / 0.4;
    px(353, y, 8, 7, '#6b4320'); px(354, y + 1, 6, 5, '#c98d4f'); px(354, y + 1, 6, 1, '#e2b07a'); px(357, y + 2, 2, 3, '#2fa57a');
    PXG.ctx.globalAlpha = 1;
  }
  /** Drops what `ok` turns down from a list, in place. */
  const keep = (list, ok) => { for (let i = list.length - 1; i >= 0; i--) if (!ok(list[i])) list.splice(i, 1); };
  // The sign's blue flag (a branch other than main): an image the pixel font's height, before the bay's name.
  const FLAG = ['pbbbbb', 'plllbb', 'pbbbbb', 'pbbb..', 'p.....', 'p.....', 'p.....', 'p.....', '......', '......'];
  let flagUrl = null;
  function flagImg() {
    flagUrl ??= makeSprite(FLAG, { p: '#e6eef5', b: '#3d7be0', l: '#5ab4ff' }).toDataURL();
    const k = fontPx();
    return `<i class="pxt px-flag" aria-hidden="true" style="width:${(6 * k).toFixed(1)}px;height:${(10 * k).toFixed(1)}px;background-image:url(${flagUrl})"></i>`;
  }

  /* ---------- the limits: floor heat for the 5-hour limit, the power-cell bank for the week ---------- */

  // The floor's heat is the engine's season (its Season switch is the factory's Heat): cool, warm, hot, steaming.
  // Each level: how fast the vents' fans turn (turns a second), how full the thermometer is, and its colour.
  const HEAT = {
    spring: { fan: 2, fill: 0.2, fluid: '#3d7be0' }, // cool: fans slow, the thermometer low and blue
    summer: { fan: 5, fill: 0.5, fluid: '#f0b429' }, // warm: fans faster, the gauge mid
    autumn: { fan: 11, fill: 0.75, fluid: '#f08a24' }, // hot: fans racing, a shimmer over the vents
    winter: { fan: 14, fill: 1, fluid: '#e04a3a' }, // steaming: steam from the vents, sparks off the machines now and then
  };
  /** A limit's % used, from its window: 0 in a new window; null with no window, or one without a number (no reading). */
  const usedOf = w => (!w ? null : w.reset ? 0 : Number.isFinite(w.percentUsed) ? w.percentUsed : null);
  /**
   * The floor's heat by the plan's 5-hour limit, at the farm's seasonOf bounds: cool while it is fresh, then warm
   * and hot, steaming when it is nearly used up; warm with no reading, cool again in a new window.
   */
  function heatOf(plan) {
    const p = usedOf(plan?.windows?.find(x => x.kind === 'five_hour'));
    if (p === null) return 'summer';
    return p < 25 ? 'spring' : p < 60 ? 'summer' : p < 85 ? 'autumn' : 'winter';
  }
  /**
   * The power-cell bank, by the plan's weekly limit, all from the whole % it shows: the cells still lit (8 in a
   * fresh week, none when it is used up), its lamp (green; amber from 70%; red, blinking, from 90%), and when it
   * resets; null with no reading.
   */
  function bankOf(plan) {
    const w = plan?.windows?.find(x => x.kind === 'seven_day'), used = usedOf(w);
    if (used === null) return null;
    const pct = Math.round(Math.max(0, Math.min(100, used)));
    return { lit: Math.round(8 * (1 - pct / 100)), lamp: pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green', pct, resetsAt: w.resetsAt ?? null, reset: Boolean(w.reset) };
  }
  /** When a limit resets, short: Tue 09:00. */
  const resetAt = at => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  // The thermometer on the back wall, between the drone dock and your desk: its plate, [x, y, w, h].
  const THERMOMETER = [129, 4, 9, 28];
  /** The thermometer at a level: a white plate, a scale from blue (bottom) to red (top), the glass tube filled to the level in its colour. */
  function thermometer(level) {
    const { fill, fluid } = HEAT[level] ?? HEAT.summer, [x, y, w, h] = THERMOMETER;
    px(x + 1, y + h, w, 1, WALL_SEAM); px(x + w, y + 1, 1, h, WALL_SEAM); // its shadow on the wall
    px(x, y, w, h, '#5f6b7a'); px(x + 1, y + 1, w - 2, h - 2, '#ffffff'); px(x + 1, y + h - 2, w - 2, 1, '#e6eef5'); px(x + 4, y, 1, 1, '#c3cbd2');
    for (const [c, j, n] of [['#e04a3a', 3, 4], ['#f08a24', 7, 4], ['#f0b429', 11, 4], ['#5ab4ff', 15, 5]]) px(x + 7, y + j, 1, n, c); // the scale
    for (let j = 5; j < 20; j += 4) px(x + 1, y + j, 1, 1, '#9aa4ad'); // its marks
    px(x + 2, y + 2, 4, 20, '#9aa4ad'); px(x + 3, y + 3, 2, 18, '#e6eef5'); // the glass tube
    const n = Math.round(18 * fill);
    px(x + 3, y + 21 - n, 2, n, fluid);
    px(x + 1, y + 20, 6, 6, '#9aa4ad'); px(x + 2, y + 21, 4, 4, fluid); px(x + 2, y + 21, 1, 1, '#ffffff'); // the bulb
  }
  /** The floor vents: one in each aisle between the bays' columns, on each row; each [its middle x, its top y]. */
  const ventsOf = L => Array.from({ length: L.rows }, (_, r) => CORR.slice(1).map(c => [c, 100 + r * ROWH + 22])).flat();
  /** A floor vent (drawn once, with the floor): a steel frame round a dark shaft; its fan turns in it each frame. */
  function floorVent(f, x, y) {
    f(x - 4, y, 8, 8, '#5f6b7a'); f(x - 4, y, 8, 1, '#9aa4ad'); f(x - 3, y + 1, 6, 6, '#3a3a40'); f(x - 4, y + 8, 8, 1, WALK_SHADOW);
  }
  /** The fan down a vent: a hub and four blades, square to the frame (pose 0) or slanted (1); turning, one pose follows the other. */
  function ventFan(x, y, pose) {
    for (const [dx, dy] of pose ? [[-3, 1], [1, 1], [-3, 5], [1, 5]] : [[-1, 1], [1, 3], [-1, 5], [-3, 3]]) px(x + dx, y + dy, 2, 2, '#8a8f96');
    px(x - 1, y + 3, 2, 2, '#c3cbd2');
  }
  /** Hot: a shimmer over a vent, three threads of hot air wavering up from it. */
  function shimmer(x, y, T) {
    PXG.ctx.globalAlpha = 0.5;
    for (let k = 0; k < 3; k++) for (let j = 2; j < 16; j += 2) px(x - 3 + k * 3 + Math.round(Math.sin(T * 6 + j * 0.6 + k * 2.1)), y - j, 1, 2, '#f08a24');
    PXG.ctx.globalAlpha = 1;
  }
  const STEAM = '#ffffff';
  /** Steaming: puffs of steam billowing out of a vent, swelling and thinning as they rise (a frozen moment of it when drawn still). */
  function steamPuffs(x, y, T, i) {
    const puffs = [0, 1, 2, 3].map(k => { // each swells and drifts to its side as it rises: a billow, not a column
      const p = (T * 0.4 + k / 4 + i * 0.29) % 1, s = 3 + Math.round(p * 3);
      return { s, x: x - (s >> 1) + Math.round(((k % 2 ? -1.4 : 1.4) + Math.sin(T * 1.3 + k * 2 + i) * 0.6) * p), y: Math.round(y - 1 - s - p * 10), a: p < 0.5 ? 1 : 1.5 - p * 1.2 };
    });
    // a grey edge round them all, then the white: one cloud, which shows on the pale floor
    for (const pass of ['#9aa4ad', STEAM]) for (const q of puffs) {
      PXG.ctx.globalAlpha = q.a;
      if (pass === STEAM) px(q.x, q.y, q.s, q.s, STEAM);
      else { px(q.x - 1, q.y, q.s + 2, q.s, pass); px(q.x, q.y - 1, q.s, q.s + 2, pass); }
    }
    PXG.ctx.globalAlpha = 1;
  }
  // The power-cell bank's cells fill from the bottom row up (CELLS: two a row, top to bottom).
  const FILL_ORDER = [6, 7, 4, 5, 2, 3, 0, 1], CHARGED = '#2fa57a';
  const LAMP_COLOURS = { green: '#6cc04a', amber: '#f0b429', red: '#e04a3a' };
  /** The bank's cells and lamp, for its reading (none: every cell dark, the lamp off). */
  function powerCells(bank) {
    if (!bank) return;
    for (const i of FILL_ORDER.slice(0, bank.lit)) { const [x, y] = CELLS[i]; px(x + 1, y + 2, 6, 7, CHARGED); px(x + 1, y + 2, 6, 1, '#6cc04a'); px(x + 2, y + 3, 1, 5, '#9ed36a'); }
    if (bank.lamp !== 'red' || blink(2)) { px(295, 15, 6, 4, LAMP_COLOURS[bank.lamp]); px(296, 15, 2, 1, '#ffffff'); } else px(295, 15, 6, 4, '#5a1f19'); // red blinks: between flashes, unlit red (no reading: grey)
  }

  /* ---------- the props and drones: what robots hold, what is on and over them, drones, AGVs, capsules ---------- */

  // What a robot holds for each step, drawn round its 14 × 16 sprite (rp paints in its pixels): its claws are at
  // x 1 and 12, rows 10–11, metal (a robot has no hands); what it works on stands at its right, on the floor at
  // row 15. The factory's own props, through the props kit; the kit's for the rest (a megaphone, a clipboard, a
  // plug for an MCP call, whose AGV is what shows it, a scroll for a skill, and plan mode's blueprint).
  const DARK = '#3a3a40', STEEL = '#5f6b7a', CLAW = '#9aa4ad';
  /** A claw closed on what it holds: the arm's metal, a dark joint under it. */
  const claw = (rp, x = 12, y = 11) => { rp(x, y, 2, 1, CLAW); rp(x, y + 1, 1, 1, STEEL); };
  const WELD_TIP = [18, 13]; // the welder's flame, in the robot's pixels: its spark glows there at night (lights)
  const FACTORY_PROPS = {
    datapad(rp, T) { // reading: a datapad in both claws, its lines scrolling
      const n = Math.floor(T * 3) % 3;
      rp(2, 9, 10, 6, DARK); rp(3, 10, 8, 4, '#2c4a85');
      for (let i = 0; i < 3; i++) rp(4, 11 + i, [5, 3, 4][(i + n) % 3], 1, '#a9dcf7');
      rp(10, 10 + n, 1, 2, '#5ab4ff'); // its scroll bar
      rp(1, 11, 1, 2, CLAW); rp(12, 11, 1, 2, CLAW);
    },
    scanner(rp, T) { // searching: a scanner gun, its red beam sweeping
      const sweep = Math.round(Math.sin(T * 3) * 3);
      rp(13, 9, 5, 3, DARK); rp(14, 10, 3, 1, STEEL); rp(13, 12, 2, 2, DARK); // its body and grip
      rp(18, 10, 1, 1, blink(4) ? '#ff6b6b' : '#e04a3a'); // its lens
      for (let i = 1; i <= 5; i++) rp(18 + i, 10 + Math.round((sweep * i) / 5), 1, 1, '#ff6b6b');
      claw(rp, 12, 12);
    },
    antenna(rp, T) { // the web: a transmitter held up, sending out a delivery drone
      rp(12, 8, 3, 5, STEEL); rp(12, 8, 3, 1, CLAW); rp(13, 10, 1, 1, blink(2) ? '#6cc04a' : '#2f6b2f'); // the transmitter, its light
      rp(13, 3, 1, 5, '#c3cbd2'); rp(13, 2, 1, 1, blink(3) ? '#ff6b6b' : '#ffd43b'); // its aerial, the tip blinking
      const n = Math.floor(T * 4) % 4;
      for (let k = 0; k < n; k++) rp(15 + k * 2, 2 - k, 1, 3 + k * 2, '#5ab4ff'); // waves going out, one more each beat
      claw(rp, 11, 12);
    },
    welder(rp, T) { // editing: a welding torch on a seam, its flame white-hot, sparks flying
      const [x, y] = WELD_TIP, f = Math.floor(T * 12) % 3;
      rp(15, 14, 8, 2, '#8a8f96'); rp(15, 14, 8, 1, '#c3cbd2'); rp(x - 1, 14, 3, 1, '#f08a24'); // the plates it joins, the seam glowing
      rp(12, 10, 2, 3, DARK); rp(14, 11, 3, 1, STEEL); rp(17, 12, 1, 1, STEEL); // the torch: its grip, its neck bent down to the seam
      rp(x, y, 1, 1, '#ffffff'); rp(x + (f !== 1 ? 1 : 0), y - (f !== 0 ? 1 : 0), 1, 1, '#a9dcf7'); // the flame, flickering
      for (let i = 0; i < 3; i++) { const p = (T * 2.5 + i / 3) % 1; rp(x + Math.round((i - 1) * p * 4), y - Math.round(p * 5 - p * p * 6), 1, 1, i % 2 ? '#ffd43b' : '#f08a24'); } // sparks
      claw(rp);
    },
    printer(rp, T) { // a new file: a part printer, a new part rising out of it layer by layer
      const n = Math.floor(T * 2.5) % 5;
      rp(14, 10, 7, 5, DARK); rp(15, 10, 5, 4, '#e6eef5'); rp(15, 10, 5, 1, '#ffffff'); rp(15, 13, 5, 1, '#c3cbd2'); // its case
      if (n) rp(16, 10 - n, 3, n, '#2fa57a'); // the part, taking shape
      rp(15 + (Math.floor(T * 8) % 5), 9 - n, 1, 1, '#e04a3a'); // its print head, to and fro over it
      rp(19, 12, 1, 1, blink(2) ? '#6cc04a' : '#2f6b2f');
      claw(rp);
    },
    multimeter(rp, T) { // tests: a meter, its probes on a circuit board, its reading changing
      rp(13, 8, 5, 7, '#f0b429'); rp(13, 8, 5, 1, '#ffd43b'); // its case
      rp(14, 9, 3, 2, DARK); rp(14 + (Math.floor(T * 5) % 3), 9, 1, 1, '#6cc04a'); rp(15, 12, 1, 1, DARK); // its display, its dial
      rp(18, 10, 3, 1, '#e04a3a'); rp(21, 10, 1, 5, '#e04a3a'); rp(18, 13, 1, 1, BLACK); rp(19, 13, 1, 2, BLACK); // its leads, red and black
      rp(18, 15, 5, 1, '#2c4a85'); rp(20, 15, 1, 1, blink(2) ? '#6cc04a' : '#2f6b2f'); // the board they test, its light
      claw(rp);
    },
    polisher(rp, T) { // lint: an orbital polisher on the floor, gleaming
      const x = 15 + Math.round(Math.sin(T * 6) * 2);
      rp(13, 11, x - 13, 1, STEEL); // its handle
      rp(x, 11, 4, 2, '#3d7be0'); rp(x, 11, 4, 1, '#5ab4ff'); rp(x - 1, 13, 6, 2, '#e6eef5'); rp(x - 1, 14, 6, 1, '#c3cbd2'); // its motor, its pad
      if (blink(3)) rp(x + 6, 12, 1, 1, '#ffffff'); else rp(x - 3, 13, 1, 1, '#ffffff'); // a gleam
      claw(rp);
    },
    wrench(rp) { // a build: a spanner turning a bolt on a red girder
      rp(15, 13, 8, 2, '#e04a3a'); rp(15, 13, 8, 1, '#ff6b6b'); rp(18, 12, 2, 1, STEEL); // the girder, its bolt
      if (blink(3)) { rp(12, 6, 1, 6, '#c3cbd2'); rp(11, 5, 3, 1, '#c3cbd2'); rp(11, 4, 1, 1, '#c3cbd2'); rp(13, 4, 1, 1, '#c3cbd2'); } // raised
      else { rp(13, 11, 4, 1, '#c3cbd2'); rp(17, 10, 4, 1, '#c3cbd2'); rp(17, 11, 1, 1, '#c3cbd2'); rp(20, 11, 1, 1, '#c3cbd2'); rp(21, 9, 1, 1, '#ffd43b'); } // on the bolt, turning it
      claw(rp);
    },
    forklift(rp, T) { // installing: a little forklift lifting a box of supplies in
      const lift = Math.floor(T * 2) % 3;
      rp(14, 9, 5, 5, '#f0b429'); rp(14, 9, 5, 1, '#ffd43b'); rp(15, 10, 2, 2, '#a9dcf7'); // its cab, a window
      rp(19, 4, 1, 11, STEEL); rp(20, 13 - lift, 3, 1, CLAW); // its mast, the forks
      rp(20, 9 - lift, 3, 4, '#c98d4f'); rp(20, 9 - lift, 3, 1, '#e2b07a'); // a box on them
      rp(14, 14, 2, 2, DARK); rp(17, 14, 2, 2, DARK); // its wheels
      claw(rp);
    },
    crate(rp) { // a commit: a crate, stamped as packed
      const up = blink(2);
      rp(14, 10, 7, 5, '#8b5a2b'); rp(15, 11, 5, 3, '#c98d4f'); rp(14, 10, 7, 1, '#a8703c'); // the crate
      rp(15, 8 - up * 3, 4, 2, '#9c3b30'); rp(16, 5 - up * 3, 2, 3, STEEL); // the stamp, on its handle
      if (!up) rp(16, 12, 3, 1, '#e04a3a'); // its mark
      claw(rp, 12, 10);
    },
    ramp(rp, T) { // a push: a cart of boxes going up a ramp
      for (let i = 0; i < 9; i++) { const h = 1 + Math.floor(i * 0.6); rp(14 + i, 16 - h, 1, h, i % 3 ? '#9aa4ad' : '#8a8f96'); } // the ramp, rising to the right
      const p = (T * 0.8) % 1, x = 14 + Math.round(p * 5), y = 12 - Math.round(p * 3);
      rp(x, y, 4, 2, '#3d7be0'); rp(x + 1, y - 2, 2, 2, '#c98d4f'); rp(x, y + 2, 1, 1, DARK); rp(x + 3, y + 2, 1, 1, DARK); // the cart and its box
      rp(23, 3, 1, 5, '#2fa57a'); rp(22, 4, 3, 1, '#2fa57a'); // up
      claw(rp);
    },
    rocketCrate(rp, T) { // a deploy: a crate with a rocket strapped on, lifting off
      const lift = Math.floor(T * 3) % 3;
      rp(15, 8 - lift, 5, 4, '#c98d4f'); rp(15, 8 - lift, 5, 1, '#e2b07a'); rp(15, 10 - lift, 5, 1, '#8b5a2b'); // the crate, its strap
      rp(16, 3 - lift, 3, 5, '#e6eef5'); rp(17, 2 - lift, 1, 1, '#e04a3a'); rp(16, 5 - lift, 3, 1, '#3d7be0'); // the rocket
      rp(14, 10 - lift, 1, 2, '#e04a3a'); rp(20, 10 - lift, 1, 2, '#e04a3a'); // its fins
      rp(16, 12 - lift, 3, 1 + blink(6), '#f08a24'); rp(17, 12 - lift, 1, 1, '#ffd43b'); // its flame
      rp(14, 14, 3, 2, '#c3cbd2'); rp(19, 14, 3, 2, '#e6eef5'); // its smoke on the floor
      claw(rp);
    },
    capsule(rp, T) { // a pull: a capsule dropping out of a tube into its claw
      const dy = Math.floor(T * 3) % 4;
      rp(14, 0, 5, 2, '#5f7f9a'); rp(15, 0, 3, 2, '#a9dcf7'); // the tube's mouth over it
      rp(14, 3 + dy, 5, 7, DARK); rp(15, 3 + dy, 3, 7, '#e6eef5'); rp(15, 5 + dy, 3, 1, '#f08a24'); // the capsule, its band
      claw(rp);
    },
    rack(rp, T) { // a server: a rack of units beside it, their lights blinking
      rp(15, 2, 7, 13, DARK); rp(15, 15, 7, 1, STEEL);
      for (let r = 0; r < 4; r++) {
        rp(16, 3 + r * 3, 5, 2, STEEL); rp(16, 3 + r * 3, 5, 1, '#8a8f96');
        rp(20, 4 + r * 3, 1, 1, blink(2 + r) ? '#6cc04a' : '#2f6b2f'); rp(17, 4 + r * 3, 1, 1, (Math.floor(T * 5) + r) % 3 ? '#5ab4ff' : '#2c4a85');
      }
      claw(rp);
    },
    shredder(rp, T) { // deleting: scrap fed into a shredder, strips falling out
      const ph = (T * 1.5) % 1;
      rp(14, 10, 7, 5, STEEL); rp(14, 9, 7, 1, DARK); rp(15, 12, 5, 1, '#e04a3a'); // the shredder, its slot, a red band
      if (ph < 0.6) rp(15, 3 + Math.round(ph * 9), 5, 2, '#f4ecd8'); // scrap going in
      for (let i = 0; i < 3; i++) rp(15 + i * 2, 15, 1, 1 + ((Math.floor(T * 6) + i) % 2), '#f4ecd8'); // strips coming out
      claw(rp);
    },
    card(rp) { // asking: a card held up with a question mark on it
      rp(13, 5, 7, 8, DARK); rp(14, 6, 5, 6, '#ffffff');
      rp(15, 7, 3, 1, '#3d7be0'); rp(17, 8, 1, 1, '#3d7be0'); rp(16, 9, 1, 1, '#3d7be0'); rp(16, 11, 1, 1, blink(2) ? '#3d7be0' : '#a9dcf7');
      claw(rp);
    },
    terminal(rp, T) { // a command: typing at a terminal on its stand
      rp(14, 5, 9, 7, DARK); rp(15, 6, 7, 5, '#1b1420'); rp(17, 12, 3, 2, STEEL); rp(15, 14, 7, 1, STEEL); // the screen on its stand
      const n = Math.floor(T * 4) % 4;
      for (let i = 0; i < 3; i++) rp(16, 7 + i, i < n ? [4, 2, 3][i] : 1, 1, '#6cc04a'); // lines typed, one after another
      if (blink(2)) rp(20, 9, 1, 1, '#e6eef5'); // its cursor
      claw(rp, 12, 10 + blink(4)); // tapping
    },
  };
  const props = window.Agentville.props.kit({
    steps: {
      read: { prop: 'datapad', verb: 'reading a datapad' },
      search: { prop: 'scanner', verb: 'scanning for parts' },
      web: { prop: 'antenna', verb: 'sending out a delivery drone' },
      mcp: { verb: 'calling up an AGV' },
      skill: { verb: 'following a manual' },
      edit: { prop: 'welder', verb: 'welding' },
      write: { prop: 'printer', verb: 'printing a new part' },
      test: { prop: 'multimeter', verb: 'testing the circuits' },
      lint: { prop: 'polisher', verb: 'polishing the plating' },
      build: { prop: 'wrench', verb: 'tightening the bolts' },
      install: { prop: 'forklift', verb: 'forklifting in supplies' },
      commit: { prop: 'crate', verb: 'stamping a crate' },
      push: { prop: 'ramp', verb: 'pushing a cart up the ramp' },
      deploy: { prop: 'rocketCrate', verb: 'launching a rocket crate' },
      pull: { prop: 'capsule', verb: 'catching a capsule from the tubes' },
      serve: { prop: 'rack', verb: 'running the server rack' },
      delete: { prop: 'shredder', verb: 'shredding scrap' },
      agent: { prop: 'megaphone', verb: 'calling up helper drones' },
      plan: { prop: 'clipboard', verb: 'writing up a work order' },
      ask: { prop: 'card', verb: 'holding up a question card' },
      shell: { prop: 'terminal', verb: 'running a command on its terminal' },
      other: { prop: 'terminal', verb: 'working on its terminal' },
      planMode: { verb: 'drawing up blueprints (plan mode)' },
    },
    props: FACTORY_PROPS,
  });

  // On a robot, drawn with it (drawChar): its beacon, sitting on its head's top (the row its base is on, for each
  // head), lit by its state; hazard stripes round its waist (bypass permissions); its cost badge on its chest.
  const BEACON_BASE = { dome: 0, box: 1, antenna: -1, screen: 1 };
  const BEACON = { working: '#6cc04a', waiting: '#ff6b6b', turn: '#f0b429', idle: '#5ab4ff' };
  const FAMILY_LIGHT = { opus: '#8a5fc0', sonnet: '#3d7be0', haiku: '#2fa57a', fable: '#f08a24' }; // the antenna light: the farm's FAMILY_PIN colours
  const BADGES = [[50, '#f0b429', '#ffe8a3'], [10, '#c3cbd2', '#ffffff'], [1, '#c8681a', '#e9a23b']]; // from $: gold, silver, copper (and a glint)
  /** Its beacon: green working, red blinking waiting on you, amber your turn, blue idle; off (grey) when stale. */
  function beacon(rp, look, state) {
    const y = BEACON_BASE[look?.head] ?? 0, lit = BEACON[state], on = Boolean(lit) && !(state === 'waiting' && blink(4));
    rp(5, y, 4, 1, DARK);
    rp(6, y - 2, 2, 2, on ? lit : state === 'waiting' ? '#9c3b30' : STEEL);
    if (on) rp(6, y - 2, 1, 1, '#ffffff');
  }

  // Over and beside a robot (drawFx).
  /** Fast mode: speed lines streaming off it: behind it as it goes (on its left, unless it goes left). */
  function speedLines(rp, b, T) {
    const right = b.walk && b.face === 'left';
    for (const [y, n] of [[4, 3], [8, 2], [12, 3]]) { const w = n + ((Math.floor(T * 10) + y) % 2); rp(right ? 15 : -1 - w, y, w, 1, '#5ab4ff'); }
  }
  /** A hot CPU: grey smoke puffing off its head, rising and thinning. */
  function smoke(rp, T) {
    for (let k = 0; k < 3; k++) {
      const p = (T * 0.7 + k / 3) % 1, s = 1 + Math.round(p * 2);
      PXG.ctx.globalAlpha = 0.9 - p * 0.5;
      rp(2 + Math.round(Math.sin(T * 2 + k) - p * 2), -Math.round(p * 9) - s, s, s, k % 2 ? '#9aa4ad' : '#5f6b7a');
    }
    PXG.ctx.globalAlpha = 1;
  }
  /** Its task list: a little screen on a stand beside it, a tick for each done (on three rows), a bar for how far it has got. */
  function checklistScreen(rp, t) {
    const rows = Math.min(3, t.total), done = Math.round((t.done / t.total) * rows);
    rp(-7, 10, 1, 5, STEEL); rp(-9, 15, 5, 1, STEEL); // its stand
    rp(-11, 1, 9, 9, DARK); rp(-10, 2, 7, 7, '#2c4a85'); // the screen
    for (let r = 0; r < rows; r++) { rp(-9, 3 + r * 2, 1, 1, r < done ? '#6cc04a' : '#5f7f9a'); rp(-7, 3 + r * 2, 3, 1, '#a9dcf7'); }
    rp(-10, 8, Math.max(t.done ? 1 : 0, Math.round((7 * t.done) / t.total)), 1, '#6cc04a');
  }
  /** Thinking: a brass gear over its head, outlined so it shows over the bench behind, its teeth turning by an eighth each step. */
  function thinkingGear(x, y, step) {
    const teeth = step % 2 ? [[-3, -3], [3, -3], [-3, 3], [3, 3]] : [[0, -4], [4, 0], [0, 4], [-4, 0]];
    for (const [dx, dy] of teeth) px(x + dx - 1, y + dy - 1, 3, 3, K);
    px(x - 4, y - 2, 9, 5, K); px(x - 2, y - 4, 5, 9, K); px(x - 3, y - 3, 7, 7, K); // its outline
    for (const [dx, dy] of teeth) px(x + dx, y + dy, 1, 1, '#c8681a');
    px(x - 3, y - 1, 7, 3, '#e9a23b'); px(x - 1, y - 3, 3, 7, '#e9a23b'); px(x - 2, y - 2, 5, 5, '#e9a23b'); px(x - 2, y - 2, 3, 1, '#f4d58d'); // its body, a glint
    px(x - 1, y - 1, 3, 3, '#6b4320'); px(x, y, 1, 1, K); // its hub
  }
  /** Idle: charging, a yellow bolt over it, pulsing. */
  function chargingBolt(rp) {
    const c = blink(1.5) ? '#ffd43b' : '#f0b429';
    rp(12, -8, 2, 1, c); rp(11, -7, 2, 1, c); rp(11, -6, 3, 1, c); rp(12, -5, 2, 1, c); rp(12, -4, 1, 1, c);
  }
  /** Your turn: a crate of finished parts held in front of it (a gear and a board peeking out). */
  function heldCrate(rp) {
    rp(4, 8, 2, 1, '#9aa4ad'); rp(8, 8, 2, 1, '#5ab4ff');
    rp(2, 9, 10, 5, '#8b5a2b'); rp(3, 10, 8, 3, '#c98d4f'); rp(3, 10, 8, 1, '#e2b07a'); rp(7, 10, 1, 3, '#a8703c');
    rp(1, 10, 1, 2, CLAW); rp(12, 10, 1, 2, CLAW);
  }
  /**
   * A plan for you to approve: a blueprint unrolled on your desk by its in-tray (right of the screen: the robots'
   * name tags over the waiting queue would hide it in front of them).
   */
  function deskBlueprint() {
    px(214, 55, 18, 5, '#3d7be0'); px(213, 55, 1, 5, '#2c4a85'); px(232, 55, 1, 5, '#2c4a85'); // the sheet, rolled at its ends
    px(215, 57, 16, 1, '#a9dcf7'); px(219, 55, 1, 5, '#a9dcf7'); px(225, 56, 4, 2, '#a9dcf7'); // its lines: a frame, a part
  }

  // The drones: subagents. A mini drone hovers by its robot for each running one (follow), an Explore one a scanner
  // drone; finished ones sit in the drone dock's slots, and the running ones no robot can lead circle over it.
  /** A mini drone at (x, y), its middle, seen from the front: a rotor spinning at each end of its arms (a blur), a white shell with a band in `band`, a light under it. */
  function drone(x, y, band, T, k = 0) {
    const spin = Math.floor(T * 16 + k) % 2;
    for (const r of [x - 4, x + 4]) { px(r - 2, y - 3, 5, 1, spin ? '#9aa4ad' : '#5f6b7a'); px(r - (spin ? 1 : 2), y - 3, spin ? 3 : 1, 1, DARK); } // its rotors
    px(x - 4, y - 2, 9, 1, K); // its arms
    px(x - 2, y - 1, 5, 3, K); px(x - 1, y - 1, 3, 1, '#ffffff'); px(x - 1, y, 3, 1, band); // its shell, its band
    px(x, y + 2, 1, 1, blink(3) ? '#6cc04a' : '#2fa57a'); // its light
  }
  /** An Explore subagent: a scanner drone sweeping a pale-blue beam over the floor below it (at `floor`), its lens red. */
  function scannerDrone(x, y, floor, T, k) {
    const spot = x + Math.round(Math.sin(T * 2.4 + k) * 6), h = floor - (y + 3);
    if (h > 2) {
      PXG.ctx.globalAlpha = 0.35;
      for (let j = 0; j < h; j++) { const p = j / h, w = 1 + Math.round(p * 4), cx = Math.round(x + (spot - x) * p); px(cx - (w >> 1), y + 3 + j, w, 1, '#5ab4ff'); }
      PXG.ctx.globalAlpha = 0.6; px(spot - 3, floor, 7, 1, '#a9dcf7'); PXG.ctx.globalAlpha = 1;
    }
    drone(x, y, '#3d7be0', T, k);
    px(x, y + 2, 1, 1, '#ff6b6b'); // its lens
  }
  /** A finished subagent's drone, docked in the dock's slot whose top left is (x, y): its rotors folded, charging. */
  function dockedDrone(x, y) {
    px(x + 1, y + 4, 8, 1, '#9aa4ad'); px(x + 2, y + 5, 6, 3, K); px(x + 3, y + 5, 4, 1, '#ffffff'); px(x + 3, y + 6, 4, 1, '#5ab4ff');
    px(x + 8, y + 1, 1, 1, blink(1) ? '#ffd43b' : '#f0b429');
  }

  // The AGVs: a little floor robot for each MCP server called in the last hour (the scene's carts, six at most),
  // each with its own bay in the rank on the left (RANK). While a robot calls its server, its AGV drives over and
  // waits beside it until the call is done and a moment after (the farm's carts' rule), then drives home.
  const AGV_SPEED = 55, AGV_STAY_MS = 3000;
  const AGV_CRATES = ['#c9a46a', '#e04a3a', '#3d7be0', '#6cc04a', '#8a5fc0', '#f0b429']; // a crate colour for each server
  /** An AGV's way between two places: along its row to the left side's path, up or down it, then along the other row. */
  function agvRoute([x, y], [tx, ty]) {
    if (Math.abs(y - ty) < 0.5) return [[tx, ty]];
    const pts = [[CORR[0], y], [CORR[0], ty], [tx, ty]];
    return pts.filter((p, i) => { const q = i ? pts[i - 1] : [x, y]; return p[0] !== q[0] || p[1] !== q[1]; });
  }
  /**
   * Where an AGV heads: beside the robot calling it; once there it stays while the call goes on and a few
   * seconds after (so a short call is seen, and a run of them keeps it there), then home. `c` is its memory:
   * { goal, arrivedAt, lastBusy }.
   */
  function agvGoal(c, busyAt, home, now) {
    if (busyAt) {
      if (!c.goal || c.goal[0] !== busyAt[0] || c.goal[1] !== busyAt[1]) { c.goal = busyAt; c.arrivedAt = null; }
      c.lastBusy = now;
      return c.goal;
    }
    if (c.goal && (c.arrivedAt == null || now - Math.max(c.lastBusy ?? 0, c.arrivedAt) < AGV_STAY_MS)) return c.goal;
    c.goal = null;
    return home;
  }
  /** An AGV at (x, y), its middle at the floor, facing `dir` (1 right, −1 left): a low yellow body, a striped skirt, a crate in its server's colour; moving, its wheels turn and its light blinks. */
  function drawAgv(x, y, dir, moving, crate) {
    const step = moving ? blink(8) : 0;
    px(x - 6, y + 1, 13, 1, SHADOW); // its shadow
    px(x - 6, y - 5, 12, 5, DARK); px(x - 5, y - 5, 10, 4, '#f0b429'); px(x - 5, y - 5, 10, 1, '#ffd43b'); // its body
    for (let i = 0; i < 10; i++) px(x - 5 + i, y - 2, 1, 1, (i >> 1) % 2 ? BLACK : YELLOW); // its skirt
    px(x - 4, y, 2, 1, BLACK); px(x + 2, y, 2, 1, BLACK); px(x - 4 + step, y, 1, 1, '#9aa4ad'); px(x + 2 + step, y, 1, 1, '#9aa4ad'); // its wheels
    px(dir > 0 ? x + 5 : x - 6, y - 4, 1, 2, '#5ab4ff'); // its sensor, at the front
    px(x - 3, y - 9, 6, 4, crate); px(x - 3, y - 9, 6, 1, '#fff4d6'); px(x - 1, y - 9, 1, 4, '#8b5a2b'); // its crate
    px(dir > 0 ? x - 5 : x + 4, y - 8, 1, 3, STEEL); px(dir > 0 ? x - 5 : x + 4, y - 9, 1, 1, moving && blink(4) ? '#ff6b6b' : '#f08a24'); // its light, on a post at the back
  }

  // The delivery drone: a web call going on (not a browser's: its AGV goes). It rises from its robot, flies out of
  // the window nearest it and is away a while, then comes back with a parcel: 8 s a round, each robot on its own beat.
  /** Where a robot's delivery drone is: { x, y, far (going through the window: seen small), parcel, away (out of sight, at its window) }, or null. */
  function deliveryAt(f, b, T) {
    if (!b || f.state !== 'working' || !f.service || f.step !== 'web' || String(f.tool ?? '').startsWith('mcp__')) return null;
    const ph = (T / 8 + (hashOf(f.id) % 97) / 97) % 1;
    const [wx, wy, ww, wh] = WINDOWS.reduce((best, w) => (Math.abs(w[0] + w[2] / 2 - b.x) < Math.abs(best[0] + best[2] / 2 - b.x) ? w : best));
    const from = [b.x + 2, b.y - 26], to = [wx + ww / 2, wy + wh / 2];
    if (ph >= 0.4 && ph < 0.6) return { x: to[0], y: to[1], away: true };
    const s = ph < 0.4 ? ph / 0.4 : 1 - (ph - 0.6) / 0.4, e = s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2;
    return { x: from[0] + (to[0] - from[0]) * e, y: from[1] + (to[1] - from[1]) * e - Math.sin(Math.PI * e) * 12, far: e > 0.85, parcel: ph >= 0.6 };
  }
  /** The delivery drone, drawn over the windows (top): small going through its window; out there, a speck now and then. */
  function deliveryDrone(d, T) {
    const x = Math.round(d.x), y = Math.round(d.y);
    if (d.away) { if (blink(2)) px(x, y, 1, 1, DARK); return; }
    if (d.far) { px(x - 1, y, 3, 1, DARK); px(x, y - 1, 1, 1, '#f0b429'); return; }
    drone(x, y, '#f0b429', T);
    if (d.parcel) { px(x, y + 3, 1, 1, '#8b5a2b'); px(x - 2, y + 4, 5, 4, '#c98d4f'); px(x - 2, y + 4, 5, 1, '#e2b07a'); px(x, y + 4, 1, 4, '#8b5a2b'); } // a parcel back
    else px(x, y + 3, 1, 2, STEEL); // its empty hook, going out
  }

  // The pneumatic tubes overhead: a header along the walkway's edge, a downpipe from it down the left edge of each
  // column of bays (as far as its last bay: in the gap beside the bays' plates, clear of the aisles' vents and the
  // signs), and from the downpipe an elbow over to each bay's tube outlet (outletAt). A message between robots
  // shoots through them in a capsule (flight). They are drawn over everything (top), so a capsule, drawn before
  // them, shows through their glass.
  const HEADER_Y = 90, PIPE_DX = -38, ELBOW_UP = 3;
  const colOf = s => Math.round((s.cx - 174) / COLW);
  const pipeX = c => 174 + c * COLW + PIPE_DX;
  const elbowAt = s => [s.cx - 30, s.rowTop - ELBOW_UP]; // the elbow's end, over its bay's outlet
  /** The tubes for a layout, as runs [from, to, the downpipe's column or null for the header]: the header, each downpipe, each elbow. */
  function tubesOf(L) {
    const deepest = new Map();
    for (const s of L.ST) deepest.set(colOf(s), Math.max(deepest.get(colOf(s)) ?? HEADER_Y, elbowAt(s)[1]));
    return [
      [[pipeX(0), HEADER_Y], [pipeX(2), HEADER_Y], null],
      ...[...deepest].map(([c, y]) => [[pipeX(c), HEADER_Y], [pipeX(c), y], c]),
      ...L.ST.map(s => { const [x, y] = elbowAt(s); return [[pipeX(colOf(s)), y], [x, y], colOf(s)]; }),
    ];
  }
  /** The tubes: glass between steel rims, 5 wide; a steel box at each joint, caps at the header's ends. */
  function drawTubes(L) {
    const runs = tubesOf(L).map(([[x0, y0], [x1, y1]]) => [Math.min(x0, x1) - 2, Math.min(y0, y1) - 2, Math.abs(x1 - x0) + 5, Math.abs(y1 - y0) + 5, y0 === y1]);
    PXG.ctx.globalAlpha = 0.4;
    for (const [x, y, w, h] of runs) px(x, y, w, h, '#a9dcf7'); // the glass
    PXG.ctx.globalAlpha = 0.55;
    for (const [x, y, w, h, across] of runs) if (across) px(x, y + 1, w, 1, '#ffffff'); else px(x + 1, y, 1, h, '#ffffff'); // its shine
    PXG.ctx.globalAlpha = 0.9;
    for (const [x, y, w, h, across] of runs) if (across) { px(x, y, w, 1, '#5f7f9a'); px(x, y + h - 1, w, 1, '#5f7f9a'); } else { px(x, y, 1, h, '#5f7f9a'); px(x + w - 1, y, 1, h, '#5f7f9a'); } // its rims
    PXG.ctx.globalAlpha = 1;
    const joints = tubesOf(L).slice(1).flatMap(([from, to]) => (from[1] === HEADER_Y && from[0] === to[0] ? [from] : [from, to])); // a downpipe's top; an elbow's two ends
    for (const [x, y] of joints) { px(x - 2, y - 2, 5, 5, STEEL); px(x - 1, y - 1, 3, 3, '#8a8f96'); }
    for (const x of [pipeX(0) - 3, pipeX(2) + 3]) px(x, HEADER_Y - 2, 1, 5, STEEL); // the header's caps
  }
  /**
   * How a robot's capsule gets into the tubes: { lead, at, c }. From a robot at a bay, `lead` goes to its bay's
   * outlet and up it, and `at` is the elbow's end over it; from anywhere else, `at` is the nearest point of the
   * tubes. `c`: the column of the downpipe `at` hangs from (null on the header).
   */
  function portOf(L, b) {
    const start = [b.x, b.y - 8], s = L.ST.find(st => Math.abs(b.x - st.cx) <= 40 && Math.abs(b.y - st.lane) <= 6);
    if (s) { const [x, y] = outletAt(s); return { lead: [start, [x, y + 9], [x, y]], at: elbowAt(s), c: colOf(s) }; }
    const clamp = (v, lo, hi) => Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), v)), d = p => Math.hypot(p[0] - start[0], p[1] - start[1]);
    const spots = tubesOf(L).map(([[x0, y0], [x1, y1], c]) => ({ lead: [start], at: [clamp(start[0], x0, x1), clamp(start[1], y0, y1)], c }));
    return spots.reduce((best, p) => (d(p.at) < d(best.at) ? p : best));
  }
  /** From a point of the tubes up to the header: along its elbow to the downpipe, up the downpipe. */
  const toHeader = n => (n.c === null ? [] : [...(n.at[0] !== pipeX(n.c) ? [[pipeX(n.c), n.at[1]]] : []), [pipeX(n.c), HEADER_Y]]);
  /** A capsule's way from a to z: into the tubes, along them (up its downpipe, along the header, down the other's; or straight down one they share), out to z. */
  function tubeRoute(L, a, z) {
    const p = portOf(L, a), q = portOf(L, z), pipe = n => (n.at[0] !== pipeX(n.c) ? [[pipeX(n.c), n.at[1]]] : []);
    const between = p.c !== null && p.c === q.c ? [...pipe(p), ...pipe(q).reverse()] : [...toHeader(p), ...toHeader(q).reverse()];
    const pts = [...p.lead, p.at, ...between, q.at, ...[...q.lead].reverse()];
    return pts.filter((pt, i) => i === 0 || pt[0] !== pts[i - 1][0] || pt[1] !== pts[i - 1][1]);
  }
  /** A capsule at (x, y), lying along its way (across or up and down): a white shell, an orange band, dark caps (it shows on the pale floor too). */
  function capsuleAt(x, y, across) {
    if (across) { px(x - 2, y - 1, 5, 3, '#ffffff'); px(x - 2, y - 1, 1, 3, DARK); px(x + 2, y - 1, 1, 3, DARK); px(x, y - 1, 1, 3, '#f08a24'); }
    else { px(x - 1, y - 2, 3, 5, '#ffffff'); px(x - 1, y - 2, 3, 1, DARK); px(x - 1, y + 2, 3, 1, DARK); px(x - 1, y, 3, 1, '#f08a24'); }
  }

  /* ---------- the creatures: a robot dog, a robot vacuum and a cat on the conveyor (sdk/animals.js) ---------- */

  // Just for fun, never data. The dog and the vacuum go about the walkway, the left side and the conveyor: never
  // into the bays (inside the safety line), the queue at your desk or the AGVs' rank, nor through the left side's
  // shelf, open table, sleep pods and cabinets; the dog rests a while by the chargers. The cat keeps to the belt (its home, as the farm's ducks keep to
  // their pond), napping and ambling along it, and a robot pets it from behind the belt. No drone: drones are
  // subagents (world.json's "taken"). The heat doesn't make them act cold: a steaming floor tells the kit
  // 'winter', which dresses only goats and freezes only ponds; with no huddle spot here, all it does is keep them
  // from their habits and rest them twice as long (too hot to play).
  const FACTORY_ANIMALS = [
    { kind: 'robodog', name: 'Robot dog', habits: ['roll', 'climb'], reacts: { merged: 'run', arrive: 'run' }, // climb: a while by a charger (DOG_REST)
      actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Oil', fx: 'crumbs', pose: 'happy', line: 'oiled' }, { label: 'Fetch', pose: 'run', run: true, fx: 'dust', line: 'fetch' }],
      lines: { idle: ['Bark.exe running', 'Bolt detected!', 'beep boop woof', 'wag.wag()'], petted: ['woof ♥ (beep)'], oiled: ['so smooth'], fetch: ['BOLT!'],
        merged: ['SHIPPED! woof!'], arrive: ['new friend detected'], deployFailed: ['woof?! error 500'], deployOk: ['good deploy! good!'] } },
    { kind: 'vacuum', name: 'Robot vacuum', actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Empty it', fx: 'dust', line: 'emptied' }],
      lines: { idle: ['dust. so much dust.', 'vrrrr', 'crumb located', 'clean floor = happy floor'], petted: ['vrr ♥'], emptied: ['ahh. lighter.'], stuck: ['help. stuck. beep.', 'corner: 1, me: 0'], free: ['freedom! vrrr'] } },
    { kind: 'cat', name: 'Cat', habits: ['yawn', 'stretch'], actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }],
      lines: { idle: ['mrrp.', 'this belt is warm', 'I supervise.'], petted: ['purr ♥'], fed: ['MEOW (thanks)'], chased: ['HISS'] } },
  ];
  // Now and then the vacuum chases the cat (all the way to it: it is slow), then wedges itself in the storage shelf's
  // corner and beeps until a robot frees it. It goes along the belt to the foot of the left side's path first: the
  // corner is straight up the path from there.
  const FACTORY_GAGS = [
    { id: 'chase', needs: { vacuum: 1, cat: 1, farmer: 'idle', spot: 'corner' }, steps: [
      { go: 'vacuum', to: 'cat', run: true }, { say: 'cat', line: 'chased' }, { go: 'cat', to: 'away', run: true, ms: 2500 },
      { go: 'vacuum', to: 'spot:path' }, { go: 'vacuum', to: 'spot:corner' }, { say: 'vacuum', line: 'stuck' }, { stay: 'vacuum', is: 'stand', ms: 6000, while: 'spot:corner' },
      { go: 'farmer', to: 'vacuum' }, { say: 'vacuum', line: 'free' } ] },
  ];
  // A robot idle three minutes or more sometimes plays: fetch with the dog, a pat for the vacuum.
  const FACTORY_PLAY = [
    { id: 'fetch', needs: { farmer: 'idle', robodog: 1 }, steps: [{ go: 'farmer', to: 'robodog' }, { go: 'robodog', to: 'away', run: true, ms: 3000 }, { go: 'robodog', to: 'farmer', run: true }, { say: 'robodog', line: 'fetch' }] },
    { id: 'pet', needs: { farmer: 'idle', vacuum: 1 }, steps: [{ go: 'farmer', to: 'vacuum' }, { fx: 'hearts', at: 'vacuum' }, { say: 'vacuum', line: 'petted' }, { wait: 2000 }] },
  ];
  // The gag's corner: on the floor at the storage shelf's front right corner, its feet 6 below the shelf's box (the
  // vacuum is 4 tall: 2 clear of it).
  const SHELF_CORNER = [SHELF_BOX.x + SHELF_BOX.w + 2, SHELF_BOX.y + SHELF_BOX.h + 6];
  // Where the dog rests by the chargers ([x, y, lift 0]: the kit's perches, which its 'climb' habit goes to and stays at
  // a while): between two pads, in front of a charger's foot, clear of the robots charging and of the open table.
  const DOG_REST = PADS.map(([x, y]) => [x + 12, y + 7, 0]);
  /** The belt's strip the cat keeps to (its feet on the belt), and where a robot stands behind the belt to pet it, for a layout. */
  function catBelt(L) {
    const cy = L.GRID.y1 + 12;
    return { home: { x: 6, y: cy + 1, w: W - 12, h: 3 }, bank: Array.from({ length: 17 }, (_, i) => [8 + 24 * i, cy - 8]) };
  }
  /** Where the dog and the vacuum may walk: the walkway, the left side with its path down beside the bays, and on the belt. */
  function roamOf(L) {
    const cy = L.GRID.y1 + 12;
    return [{ x: 4, y: WALK.y0, w: W - 8, h: WALK.y1 - WALK.y0 }, { x: 4, y: WALK.y1, w: CORR[0] + 2, h: cy - WALK.y1 }, { x: 4, y: cy, w: W - 8, h: 4 }];
  }
  /** One box round a row of places, each with its box round its feet ({ dx, dy, w, h }): a row of pods, the rank's bays. */
  function around(places, b) {
    const xs = places.map(p => p[0]), ys = places.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
    return { x: x + b.dx, y: y + b.dy, w: Math.max(...xs) - x + b.w, h: Math.max(...ys) - y + b.h };
  }
  /**
   * What they keep off (besides the bays and buildings themselves: fieldAt, buildingAt), from the same places and boxes
   * the floor is drawn with: the bays' floor, the queues at your desk, the rank, and the left side's furniture.
   */
  function avoidOf(L) {
    const G = L.GRID;
    return [
      { x: G.x0, y: G.y0, w: G.x1 - G.x0, h: G.y1 - G.y0 }, // the bays, inside the safety line
      around([[QUEUE.from, DESK_Y], [QUEUE.to, DESK_Y]], { dx: -ROBOT.w / 2 - 1, dy: -ROBOT.h - 2, w: ROBOT.w + 2, h: ROBOT.h + 6 }), // the queues: their robots, a pixel round, the rings at their feet
      around(RANK, RANK_BOX), // the AGVs' rank
      { ...SHELF_BOX }, { ...TABLE_BOX }, around(PODS, POD_BOX), // the storage shelf, the open table, the sleep pods
      ...rowFurniture(L).flatMap(({ cabinet: [x, y], plant }) => [{ x, y, ...CABINET_BOX }, around([plant], PLANT_BOX)]), // a fourth row's cabinet and plant, and on
    ];
  }

  /* ---------- the hooks ---------- */

  /** A time of day, short: 14:05. */
  const clock = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  /** How long until a time, in short: 12m, 2h. */
  const until = at => { const m = Math.max(0, (at - Date.now()) / 60_000); return m < 1 ? 'a moment' : m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`; };

  function makeFactory() {
    let L = FACTORY_GRID.layoutFor([]);
    let scene = { fields: [], farmers: [] };
    let fabGlow = 0; // the fabricator's door, lit while a robot rolls out (0–1)
    let heat = 'summer'; // the live heat, from your 5-hour limit
    // The heat to draw: the engine's (the Heat switch may hold one), else the live one. What is drawn or emitted by heat reads this.
    const shown = () => PXG.season ?? heat;
    let where = () => null; // where each robot is (the engine's, given to tick): for the welders' sparks at night
    let seenCompactions = null, seenMerged = null, seenLights = null; // what the last scene had, so news can be told
    const rolling = [], leaving = []; // finished robots rolling off to the conveyor (compactions); crates leaving the dock (merges): { …, t }
    const stOf = k => L.ST.find(s => s.key === k);
    const fieldByKey = k => scene.fields.find(f => f.key === k);
    const rankOf = new Map(), agvs = new Map(); // server → its bay in the rank; server → its AGV: { x, y, path, to, dir, moving, goal, arrivedAt, lastBusy }
    // The cat's home and bank: the kit keeps the cast it was given, so when the bays' rows move the belt, they move in place.
    const catHome = {}, catBank = [];
    const fitBelt = () => { const b = catBelt(L); Object.assign(catHome, b.home); catBank.splice(0, catBank.length, ...b.bank); };
    fitBelt();
    const cast = FACTORY_ANIMALS.map(c => (c.kind === 'cat' ? { ...c, home: catHome, bank: catBank } : c));
    /** The AGVs there are now (the scene's carts), each keeping its bay in the rank while its server has one. */
    function placeAgvs() {
      const list = scene.carts ?? [];
      for (const k of [...rankOf.keys()]) if (!list.some(c => c.server === k)) { rankOf.delete(k); agvs.delete(k); }
      for (const c of list) if (!rankOf.has(c.server)) { const used = new Set(rankOf.values()); rankOf.set(c.server, RANK.findIndex((_, i) => !used.has(i))); }
      return list;
    }
    /** Beside a robot (on the side away from the bays' right edge): where it is going rather than where it is, so the AGV does not chase it step by step. */
    const besideOf = b => { const x = Number.isFinite(b.tx) ? b.tx : b.x, y = Number.isFinite(b.ty) ? b.ty : b.y; return [Math.round(x + (x > 360 ? -13 : 13)), Math.round(y)]; };
    /** Each frame: each AGV drives towards where agvGoal sends it (or is put there, drawn still). */
    function moveAgvs(dt, posOf, snap) {
      const now = Date.now();
      for (const c of placeAgvs()) {
        const home = RANK[rankOf.get(c.server)];
        let s = agvs.get(c.server);
        if (!s) agvs.set(c.server, (s = { x: home[0], y: home[1], path: [], to: home, dir: 1 }));
        const b = c.busy ? posOf(c.busy) : null;
        const goal = agvGoal(s, b ? besideOf(b) : null, home, now);
        if (goal[0] !== s.to[0] || goal[1] !== s.to[1]) { s.to = goal; s.path = agvRoute([s.x, s.y], goal); }
        if (snap) { // no motion: it stands where it is going, facing the robot (or the floor, in its bay)
          [s.x, s.y] = goal;
          s.path = [];
          s.dir = b && s.goal ? (goal[0] > (Number.isFinite(b.tx) ? b.tx : b.x) ? -1 : 1) : 1;
        }
        if (s.path.length) {
          const [qx, qy] = s.path[0], dx = qx - s.x, dy = qy - s.y, d = Math.hypot(dx, dy), sp = AGV_SPEED * dt;
          if (Math.abs(dx) > 0.1) s.dir = Math.sign(dx);
          if (d <= sp) { s.x = qx; s.y = qy; s.path.shift(); } else { s.x += (dx / d) * sp; s.y += (dy / d) * sp; }
        } else if (s.goal && s.arrivedAt == null) s.arrivedAt = now; // there: it waits (agvGoal says how long)
        else if (!s.goal) s.dir = 1; // back in its bay, facing the floor
        s.moving = s.path.length > 0;
      }
    }
    const bayLooks = new Map();
    /** The robot a bay builds: a model of its own, picked by its repo as a robot's look is by its agent. */
    const bayLook = key => { if (!bayLooks.has(key)) bayLooks.set(key, lookOf({ id: key })); return bayLooks.get(key); };
    /** The bays, each frame: each bench and what is round it; then the finished robots rolling off, the crates leaving the dock. */
    function drawBays() {
      const T = PXG.T, cy = L.GRID.y1 + 12;
      for (const s of L.ST) {
        const f = fieldByKey(s.key);
        if (!f) continue;
        const here = scene.farmers.filter(a => a.field === f.key);
        drawBay(s, f, { look: bayLook(f.key), color: builderOf(here, f.key)?.shirt, jobs: here.reduce((n, a) => n + (a.jobs ?? 0), 0), T });
      }
      for (const r of rolling) { const s = stOf(r.key); if (s) rollingRobot(r, rollAt(s, cy, r.t), T); }
      for (const c of leaving) leavingCrate(c.t);
    }
    /** Its eyes on its visor (rows 5–7), as the farm draws its farmers': shut while idle or asleep in a pod, wide while waiting on you, smiling on your turn, looking down at its work. */
    const eyes = (f, b, rp, view) => {
      const E = METAL.e, DIM = '#5f7f9a', down = f.state === 'working' && !b.walk;
      if (view === 'left' || view === 'right') { rp(view === 'right' ? 10 : 3, down ? 6 : 5, 1, 2, E); return; }
      const blinking = ((PXG.T + (f.color ?? 0) * 0.37) % 3.7) < 0.12; // now and then, each robot on its own beat
      if (((f.state === 'idle' || b.zone === 'nap') && !b.walk) || blinking) { rp(4, 6, 2, 1, DIM); rp(8, 6, 2, 1, DIM); return; } // shut
      if (f.state === 'waiting') { rp(4, 5, 2, 2, E); rp(8, 5, 2, 2, E); return; } // wide
      if (f.state === 'turn' && !b.walk) { rp(4, 5, 2, 1, E); rp(8, 5, 2, 1, E); rp(6, 7, 2, 1, E); return; } // pleased: a squint and a grin
      rp(5, down ? 6 : 5, 1, 2, E); rp(8, down ? 6 : 5, 1, 2, E);
    };
    /** The limits, each frame: the thermometer and the floor vents at the heat shown (fans, a shimmer, steam), the power-cell bank's cells and lamp. */
    function drawLimits() {
      const level = shown(), T = PXG.T, fan = (HEAT[level] ?? HEAT.summer).fan;
      thermometer(level);
      ventsOf(L).forEach(([x, y], i) => {
        if (level === 'autumn' || level === 'winter') px(x - 3, y + 1, 6, 6, level === 'winter' ? '#9c3b30' : '#6b2a22'); // the shaft glows, hot under the fan
        ventFan(x, y, Math.floor(T * fan + i * 0.5) % 2);
        if (level === 'autumn') shimmer(x, y, T);
        if (level === 'winter') steamPuffs(x, y, T, i);
      });
      powerCells(bankOf(scene.plan));
    }
    /** The power-cell bank's tooltip: the week's % used, the cells left and when it resets; or that there is no reading. */
    function bankTip() {
      const b = bankOf(scene.plan);
      if (!b) return "The power-cell bank: your plan's weekly limit, no reading yet (it comes from the mod in a running session)";
      return `The power-cell bank: your plan's weekly limit, ${b.reset ? 'just reset' : `${b.pct}% used`}, ${b.lit} of 8 cells left${b.resetsAt ? `; resets ${resetAt(b.resetsAt)}` : ''}. Click for your plan`;
    }
    /** A robot welding: working on an edit (the welder's step; plan mode is the blueprint). */
    const welding = f => f.state === 'working' && props.doing(f) === props.steps.edit;
    /** What moves on the floor, or reads the scene, each frame: the beacon over your desk, the drones docked, the crates on the dock, the conveyor's slats, the fabricator's glow. */
    function drawWorkshop() {
      const T = PXG.T, waiting = scene.farmers.some(f => f.state === 'waiting'), on = waiting && !blink(2);
      px(139, 35, 7, 5, '#3a3a40'); px(140, 35, 5, 4, on ? '#ff6b6b' : waiting ? '#e04a3a' : '#9c3b30'); px(141, 36, 1, 1, on ? '#ffffff' : '#b23a2e'); // red, blinking, while a robot waits on you
      for (let i = 0; i < Math.min(6, scene.henhouse?.eggs ?? 0); i++) dockedDrone(100 + (i % 2) * 11, 38 + (i >> 1) * 12); // subagents that finished lately, in the dock's slots
      for (const c of dockCrates(scene.fields)) {
        px(c.x, c.y, 8, 7, '#6b4320'); px(c.x + 1, c.y + 1, 6, 5, '#c98d4f'); px(c.x + 1, c.y + 1, 6, 1, '#e2b07a'); px(c.x + 1, c.y + 3, 6, 1, '#a8703c');
        px(c.x + 4, c.y + 2, 3, 3, c.qa === 'running' ? (blink(2) ? '#f0b429' : '#ffd43b') : QA[c.qa]); // its QA tag
      }
      const cy = L.GRID.y1 + 12, e = PXG.ext ?? { x0: 0, x1: W }, off = Math.floor(T * 12) % 6;
      for (let x = Math.floor(e.x0 / 6) * 6 + off; x < e.x1; x += 6) px(x, cy - 4, 1, 9, '#5ab4ff'); // the belt moving along
      if (fabGlow > 0) { // a robot rolling out: the door glows
        PXG.ctx.globalAlpha = fabGlow * (0.6 + 0.15 * Math.sin(T * 8));
        px(50, 44, 24, 30, '#ffe8a3'); px(53, 47, 18, 22, '#ffffff'); px(47, 76, 30, 6, '#ffe8a3');
        PXG.ctx.globalAlpha = 1;
      }
    }
    return {
      key: 'factory', W, SH: 16, corridors: CORR, grid: FACTORY_GRID, fromScene: factoryScene, help: helpHtml,
      nouns: { agent: 'robot', agents: 'robots', repo: 'bay', repos: 'bays', place: 'factory' },
      seasonNames: { switch: 'Heat', spring: 'cool', summer: 'warm', autumn: 'hot', winter: 'steaming' },
      boardTitle: 'The manuals shelf: what your projects remember', // the engine opens it (the 'board' building)
      /**
       * A new scene; returns what happened since the last one: a robot finished (a compaction: it rolls off along
       * the conveyor), a pull request shipped (merged in the last 30 minutes: its crate leaves the dock), a deploy
       * failing or going through (for the animals only).
       */
      setScene(next) {
        const events = [];
        const comp = new Map(next.farmers.map(f => [f.id, f.compactions ?? 0]));
        if (seenCompactions) for (const f of next.farmers) if (seenCompactions.has(f.id) && comp.get(f.id) > seenCompactions.get(f.id)) {
          events.push({ id: f.id, kind: 'harvest', text: 'Built!', cls: 'good', log: 'finishes its robot: its conversation was compacted, and a fresh frame goes on' });
          if (f.field) { rolling.push({ key: f.field, look: bayLook(f.field), color: f.shirt, t: 0 }); if (rolling.length > 6) rolling.shift(); }
        }
        seenCompactions = comp;
        const merged = next.fields.flatMap(fl => (fl.prs?.merged ?? []).map(m => ({ ...m, repo: fl.name, key: `${fl.key}#${m.number}` })));
        if (seenMerged) for (const m of merged) if (!seenMerged.has(m.key) && (m.at ?? 0) > Date.now() - 30 * 60_000) {
          events.push({ at: DOCK_DOOR, kind: 'merged', text: `Shipped! #${m.number}`, cls: 'good', who: 'The loading dock', log: `${m.repo}: pull request #${m.number} merged${m.title ? ` (${clip(m.title, 50)})` : ''}` });
          if (leaving.length < 4) leaving.push({ t: 0 });
        }
        seenMerged = new Set(merged.map(m => m.key));
        const lights = new Map(next.fields.map(fl => [fl.key, fl.light ?? null]));
        if (seenLights) for (const [key, l] of lights) {
          const s = stOf(key), kind = l === 'failed' ? 'deployFailed' : l === 'ok' ? 'deployOk' : null;
          if (kind && s && seenLights.get(key) !== l) events.push({ kind, at: [s.cx, s.rowTop + 30], text: '' });
        }
        seenLights = lights;
        scene = next;
        heat = heatOf(next.plan);
        return events;
      },
      layout: () => L,
      relayout(ground) { L = ground; fitBelt(); return L; },
      spawn: () => FAB_DOOR,
      /** Where its k-th running subagent's drone hovers: by its head, two a side; an Explore one circles it, sweeping its beam. */
      follow: (b, k, T, kid) => (kid?.dog
        ? [b.x + Math.cos(T * 0.8 + k) * 18, b.y - 24 + Math.sin(T * 1.6 + k) * 2]
        : [b.x + (k % 2 ? 13 : -13) + Math.sin(T * 1.3 + k) * 1.5, b.y - 12 - (k > 1 ? 11 : 0) + Math.sin(T * 3 + k * 1.7) * 1.5]),
      speed: f => (f.fast ? 68 : 40), // fast mode rolls faster
      /**
       * Where each robot stands: at its bay while it works there; at the open table while it works outside any repo
       * (or in one with no bay left); in a sleep pod while it waits to wake up by itself; at your desk when it needs
       * you (on the left) or its turn ended (on the right); stale, on the storage shelf; idle, on a charging pad.
       * Each place holds a few; the engine counts the rest, and labels() shows them as "+N".
       */
      slots(f) {
        const s = f.state === 'working' ? stOf(f.field) : null;
        if (s) return { group: `st:${s.key}`, zone: `st:${s.key}:${props.doing(f)?.prop ?? ''}`, at: used => { const off = [props.doing(f)?.spot ?? 0, 0, -26, 26, -13, 13].find(o => !used.includes(o)) ?? 0; used.push(off); return [s.cx + off, s.lane]; } };
        if (f.state === 'working') return { group: 'floor', zone: 'floor', cap: TABLE.length, at: i => TABLE[i] };
        if (f.nap) return { group: 'nap', zone: 'nap', cap: PODS.length, at: i => PODS[i] }; // it wakes up by itself: a pod, not your desk
        if (f.state === 'waiting') return { group: 'desk', zone: 'desk', cap: QUEUE.cap, at: i => [QUEUE.from + QUEUE.step * i, DESK_Y] }; // the queue at your desk, from its left
        if (f.state === 'turn') return { group: 'turn', zone: 'turn', cap: QUEUE.cap, at: i => [QUEUE.to - QUEUE.step * i, DESK_Y] }; // your turn: from its right (full, the two queues still don't touch)
        if (f.state === 'stale') return { group: 'storage', zone: 'storage', cap: SHELF.length, at: i => SHELF[i] };
        return { group: 'charge', zone: 'charge', cap: PADS.length, at: i => PADS[i] };
      },
      startText: n => `Shift started: <b>${n}</b> robot${n === 1 ? '' : 's'} on the floor`,
      arriveText: 'rolls out of the fabricator',
      tip: f => {
        const bay = fieldByKey(f.field);
        const what = f.state === 'waiting' ? `needs you: ${f.ask}` : f.state === 'turn' ? (f.question ? `asks you: ${f.question}` : `your turn: ${f.reply || 'finished'}`)
          : f.state === 'working' ? `${props.doing(f)?.verb ?? 'working'}${bay ? ` at the ${bay.name} bay` : ''}${f.summary ? ` · ${f.summary}` : ''}`
          : f.state === 'stale' ? 'stale: powered down' : 'idle: charging';
        const mode = { acceptEdits: 'accept edits', plan: 'plan mode', auto: 'auto mode', bypassPermissions: '⚠ bypass permissions', dontAsk: "don't ask" }[f.mode];
        const extra = [
          f.tasks && `tasks ${f.tasks.done}/${f.tasks.total}${f.tasks.current ? `: ${f.tasks.current}` : ''}`,
          f.jobs && `${f.jobs} background command${f.jobs === 1 ? '' : 's'} running`,
          f.nap && f.wakeAt && `wakes up by itself at ${clock(f.wakeAt)}`,
          f.compactions && `compacted ${f.compactions}×`,
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
        if (z === 'desk') return f.askKind === 'permission' || f.askKind === 'always' ? 'comes to your desk: needs a permission' : 'comes to your desk with a question';
        if (z === 'turn') return f.question ? 'comes to your desk with a question' : 'brings finished parts to your desk';
        if (z === 'storage') return 'powers down on the storage shelf (stale)';
        if (z === 'charge') return 'charges on a pad (idle)';
        if (z === 'floor') return 'works at the open table (no repo)';
        if (z === 'nap') return `sleeps in a pod until it wakes up by itself${f.wakeAt ? ` at ${clock(f.wakeAt)}` : ''}`;
        return `${props.doing(f)?.verb ?? 'working'} at the ${fieldByKey(f.field)?.name ?? ''} bay`;
      },
      bg(fill, season, ext) { drawFloor(fill, L, ext); },
      ground() { drawLimits(); drawWorkshop(); drawBays(); },
      /** The floor's heat, live: the engine shows it (or the level the Heat switch holds) as PXG.season. */
      season: () => heat,
      /** The robot dog, the robot vacuum and the cat (the creatures, above): just for fun, never data. */
      animals: () => ({ cast, gags: FACTORY_GAGS, play: FACTORY_PLAY }),
      roam: () => roamOf(L),
      avoid: () => avoidOf(L),
      /** Where the dog rests a while, by the chargers. */
      perches: () => DOG_REST,
      /** Where the chase goes: the storage shelf's corner, by way of the foot of the left side's path, on the belt. No huddle: a hot floor is no place to huddle. */
      spots: () => ({ corner: SHELF_CORNER, path: [CORR[0], L.GRID.y1 + 14] }),
      /**
       * Steaming: steam puffs rising from the floor vents, and now and then a burst of sparks off a machine (the
       * fabricator, a bay's assembly frame). Only for the heat shown.
       */
      ambient(dt, add) {
        if (shown() !== 'winter') return;
        for (const [x, y] of ventsOf(L)) if (Math.random() < dt * 2) add({ x: x + rand(-2, 2), y: y + 1, vx: rand(-2, 2), vy: rand(-12, -7), g: 0, life: 1.8, max: 1.8, size: 2, grow: 1.2, color: STEAM, alpha: 0.6, sway: 2 });
        if (Math.random() < dt * 0.6) {
          const spots = [[FAB_HOPPER[0], FAB_HOPPER[1] + 1], [FAB_PIPE[0], FAB_PIPE[1] + 1], ...L.ST.map(s => [s.cx + 11, s.rowTop + 3])], [x, y] = spots[Math.floor(Math.random() * spots.length)];
          for (let i = 0; i < 6; i++) add({ x, y, vx: rand(-28, 28), vy: rand(-34, -10), g: 90, life: 0.45, max: 0.45, size: 1, color: i % 3 ? '#ffd43b' : '#ffe8a3' });
        }
      },
      /**
       * Lights that glow at night, [x, y, reach, the lit shape or null]: the desk lamp (its bulb lit), your desk's
       * screen and the fabricator's, every stack light with a lamp on, the bank's lamp, the fabricator's door while a
       * robot rolls out, and each welding robot's spark. The rest (the robots waiting on you) the engine adds.
       */
      lights() {
        const out = [[158, 49, 14, [156, 46, 5, 1]], [201, 47, 12, null], [47, 33, 9, null]];
        for (const s of L.ST) { const f = fieldByKey(s.key); if (f?.light && f.light !== 'other') out.push([...stackLightAt(s), 9, null]); } // 'other': every lamp off
        const bank = bankOf(scene.plan);
        if (bank && (bank.lamp !== 'red' || blink(2))) out.push([298, 17, 7, null]);
        if (fabGlow > 0) out.push([62, 62, Math.round(20 * fabGlow), null]);
        for (const f of scene.farmers) { const b = welding(f) ? where(f.id) : null; if (b && !b.walk) out.push([Math.round(b.x) - 7 + WELD_TIP[0], Math.round(b.y) - 16 + WELD_TIP[1], 5 + 2 * blink(9), null]); } // at its welder's tip
        return out;
      },
      /** Drawn among the robots, by how far down they stand: the open table (two robots behind it, two in front), each pod's glass over its sleeper, and the AGVs. */
      items: () => [[TABLE_Y, openTable], ...PODS.map(([x, y]) => [y + 1, () => podGlass(x, y)]), ...placeAgvs().map(c => {
        const s = agvs.get(c.server), [hx, hy] = RANK[rankOf.get(c.server)], x = Math.round(s?.x ?? hx), y = Math.round(s?.y ?? hy);
        return [y, () => drawAgv(x, y, s?.dir ?? 1, s?.moving, AGV_CRATES[hashOf(c.server) % AGV_CRATES.length])];
      })],
      /**
       * Each frame: the AGVs drive on. Is a robot rolling out of the fabricator (walking near its door)? Its door
       * glows, and fades after. Finished robots roll on, and crates leave the dock, until they're gone. Still,
       * nothing moves (an AGV stands where it is going). Where the robots are is kept, for the welders' sparks at
       * night (lights) and the delivery drones (top).
       */
      tick(dt, posOf, snap = false) {
        where = posOf;
        moveAgvs(dt, posOf, snap);
        const out = !snap && scene.farmers.some(f => { const b = posOf(f.id); return b?.walk && Math.abs(b.x - FAB_DOOR[0]) < 30 && Math.abs(b.y - FAB_DOOR[1]) < 4; });
        fabGlow = snap ? 0 : out ? 1 : Math.max(0, fabGlow - dt * 1.5);
        if (snap) { rolling.length = 0; leaving.length = 0; return; }
        const cy = L.GRID.y1 + 12, edge = (PXG.ext?.x1 ?? W) + 10;
        for (const r of [...rolling, ...leaving]) r.t += dt;
        keep(rolling, r => { const s = stOf(r.key); return Boolean(s) && rollAt(s, cy, r.t).x < edge; });
        keep(leaving, c => c.t < LEAVE);
      },
      /** The bay at a point of the floor, if any: a click there opens its close-up. */
      fieldAt(x, y) { return L.ST.find(s => Math.abs(x - s.cx) <= 40 && y >= s.rowTop && y <= s.rowTop + 56)?.key ?? null; },
      /** The sky by your clock, in the back wall's windows. */
      weather(sky) { drawWindows(sky); },
      /** The building at a point of the floor, if any: each opens something. */
      buildingAt(x, y) { return BUILDINGS.find(([, x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)?.[0] ?? null; },
      buildingTip: k => (k === 'bank' ? bankTip() : {
        barn: 'The fabricator: start a new session or resume one (a new robot rolls out of its door)', drones: 'The drone dock: subagents', desk: 'Your desk: who is waiting on you',
        board: 'The manuals shelf: what your projects remember (CLAUDE.md and memory)', dock: 'The loading dock: pull requests',
      }[k] ?? ''),
      /** What a building shows when clicked: { title, html }. */
      dialog(k) {
        if (k === 'desk') {
          const list = scene.farmers.filter(f => f.state === 'waiting' || f.state === 'turn');
          return { title: 'Your desk', html: list.length ? `<ul class="px-dl">${list.map(f => `<li><button type="button" class="act" data-farm-pick="${esc(f.id)}">Open</button><span><b>${esc(f.name)}</b> ${esc(f.state === 'waiting' ? (f.planAsk ? 'has a plan for you to approve' : `needs you: ${f.ask}`) : f.question ? `asks: ${f.question}` : `finished${f.reply ? `: ${f.reply}` : ''}`)}</span></li>`).join('')}</ul>` : '<p class="muted">No robot is waiting on you.</p>' };
        }
        if (k === 'bank') {
          const ws = scene.plan?.windows ?? [], name = w => ({ five_hour: '5-hour limit', seven_day: 'Weekly limit' })[w.kind] ?? w.kind;
          return { title: 'The power-cell bank: your plan', html: ws.length ? ws.map(w => { const used = usedOf(w), pct = used === null ? 0 : Math.round(used); return `<div class="px-meter"><b>${esc(name(w))}</b><span class="bar"><i style="width:${Math.min(100, pct)}%"></i></span><span>${w.reset ? 'just reset' : used === null ? 'no reading' : `${pct}% used`}${w.resetsAt ? ` · resets ${esc(resetAt(w.resetsAt))}` : ''}</span></div>`; }).join('') + '<p class="muted">The cells are the week; the floor heat is the 5-hour limit (steaming when it is nearly used up).</p>' : '<p class="muted">No reading of your plan yet: it comes from the mod in a running session.</p>' };
        }
        if (k === 'drones') {
          const subs = scene.subagents ?? [];
          return { title: 'The drone dock: subagents', html: subs.length ? `<ul class="px-dl">${subs.slice(0, 40).map(c => `<li><i class="px-dot st-${esc(c.state)}"></i><span><b>${esc(c.parent)}</b> ${esc(c.label || 'a subagent')}${c.type ? ` <em>${esc(c.type)}</em>` : ''} · ${esc(c.state)}</span></li>`).join('')}</ul>` : '<p class="muted">No subagents lately.</p>' };
        }
        if (k === 'dock') {
          const link = pr => (typeof pr.url === 'string' && pr.url.startsWith('https://github.com/') ? `<a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number}</a>` : `#${pr.number}`);
          const checks = pr => (pr.draft ? 'draft' : { ok: '✓ checks pass', failed: '✗ checks failed', running: '◌ checks running' }[pr.checks] ?? 'no checks');
          const repos = scene.fields.filter(fl => fl.prs);
          return { title: 'The loading dock: pull requests', html: repos.length ? repos.map(fl => `<h4>${esc(fl.name)}</h4><ul class="px-dl">${(fl.prs.open ?? []).map(pr => `<li><span>${link(pr)} ${esc(pr.title)} <em class="ck-${esc(pr.draft ? 'draft' : pr.checks ?? 'none')}">${checks(pr)}</em></span></li>`).join('') || '<li class="muted">No open pull requests.</li>'}${(fl.prs.merged ?? []).map(m => `<li class="muted"><span>${link(m)} merged${m.at ? ` ${ago(m.at)} ago` : ''}: ${esc(m.title)}</span></li>`).join('')}</ul>`).join('') : '<p class="muted">No pull requests to show: the repos here have no GitHub origin, or gh is not signed in.</p>' };
        }
        return null;
      },
      /** The projects whose memory the manuals shelf shows: one session in each folder. */
      boardSessions: () => [...new Map(scene.farmers.filter(f => f.kind !== 'codex' && f.cwd).map(f => [f.cwd, f])).values()].slice(0, 8),
      /**
       * The signs: each bay's (click it for the files robots touched there): its name, a blue flag and the branch
       * when it isn't main, then a worktree's repo, the last deploy in words and a collision; why the stack light
       * shows on hover; its git counts along its back edge. The places' names, each project's, the open pull
       * requests, and "+N" for whoever doesn't fit their place.
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
          const tip = [f.key, f.branch && `on ${f.branch}`, d && [d.label, d.detail].filter(Boolean).join(': '), 'Click to see the files robots touched here'].filter(Boolean).join(' · ');
          lab(s.cx, s.rowTop + 49, `<button type="button" class="px-field" data-farm-field="${esc(f.key)}" title="${esc(tip)}"><span class="px-fl">${f.flag ? flagImg() : ''}${pxt(cutMid(f.name, 16), f.collision ? '#ffd166' : '#e6eef5')}${branch}</span>${second ? `<span class="px-fl">${second}</span>` : ''}</button>`, f.collision ? 'bad' : '');
          // the counts, along the bay's back edge as the farm's are over its beds: behind over the tube outlet, uncommitted on the loose parts' side,
          // unpushed over the stack light, on the boxes' side (clear of the SHIPPED flash)
          if (f.behind > 0) lab(outletAt(s)[0], s.rowTop, cnt(`↓${f.behind}`), 'cnt', `${f.behind} commit${f.behind === 1 ? '' : 's'} behind the remote`);
          if (f.ahead > 0) lab(stackLightAt(s)[0] + 1, s.rowTop, cnt(`↑${f.ahead}`), 'cnt', `${f.ahead} unpushed commit${f.ahead === 1 ? '' : 's'}`);
          if (f.dirty > 0) lab(s.cx - 17, s.rowTop, cnt(`+${f.dirty}`), 'cnt', `${f.dirty} uncommitted file${f.dirty === 1 ? '' : 's'}`);
        }
        if (!ST.length) lab(262, 150, pxt('No bays yet: no robot has touched a repo in the last 30 minutes', '#fff3d6', '#4e3626'), 'zone');
        lab(200, 31, sign('YOUR DESK'), 'zone'); lab(56, 95, sign('STORAGE'), 'zone'); lab(56, 132, sign('CHARGING'), 'zone'); lab(56, 177, sign('OPEN TABLE'), 'zone');
        for (const g of L.groups) { const [r, cols] = rowsOfGroup(g)[0]; lab(174 + Math.min(...cols) * COLW + 44, 100 + r * ROWH - 1, sign(clip(g.name, 16)), 'zone proj', `The ${g.name} project: its repos side by side`); }
        const open = scene.fields.flatMap(fl => fl.prs?.open ?? []);
        if (open.length) lab(357, 91, cnt(`${open.length} PR${open.length === 1 ? '' : 's'}`), 'cnt', `Open pull requests: ${open.slice(0, 6).map(pr => `#${pr.number} ${pr.title}`).join(' · ')}${open.length > 6 ? ' …' : ''}. Click the loading dock for them all`);
        const plus = (x, y, n, what) => n > 0 && lab(x, y, cnt(`+${n} ${what}`), 'cnt');
        plus(QUEUE.from, 91, overflow.desk, 'waiting'); plus(QUEUE.to, 91, overflow.turn, 'your turn'); // under each queue's first robot
        plus(116, 124, overflow.storage, 'stale'); plus(116, 156, overflow.charge, 'idle'); plus(116, 202, overflow.floor, 'working'); plus(116, 248, overflow.nap, 'asleep');
        if (more > 0) lab(350, L.GRID.y1 + 12, `<button type="button" class="px-more" data-farm-more>${pxt(`+${more} more bay${more === 1 ? '' : 's'}`, '#fff3d6', '#4e3626')}</button>`, 'wood');
      },
      /**
       * A robot: walking, it faces where it goes; waiting on you, it waves; stale, it is powered down. On it: its
       * antenna light in its model's colour, its beacon by its state; hazard stripes round its waist for bypass
       * permissions, its cost badge on its chest, its eyes on its visor.
       */
      drawChar(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), off = f.state === 'stale', look = f.look ?? lookOf(f);
        const view = b.walk ? b.face ?? 'down' : 'down';
        PXG.ctx.drawImage(robotSprite(look, f.shirt, { view, legs: legFrame(b), wave: f.state === 'waiting', off, light: off ? null : FAMILY_LIGHT[f.family] ?? null }), ox, oy, ROBOT.w * SC, ROBOT.h * SC);
        beacon(rp, look, f.state);
        if (off) return; // powered down: nothing else on it
        if (f.mode === 'bypassPermissions') for (let x = 3; x < 11; x++) rp(x, 12, 1, 1, (x >> 1) % 2 ? BLACK : YELLOW); // no permission checks: hazard stripes
        const badge = f.cost >= 1 ? BADGES.find(([min]) => f.cost >= min) : null;
        if (badge && view === 'down') { rp(9, 10, 2, 2, badge[1]); rp(9, 10, 1, 1, badge[2]); } // what it has cost
        if (view !== 'up') eyes(f, b, rp, view);
      },
      /**
       * Over and beside a robot: speed lines (fast mode) and smoke (a hot CPU); asleep in a pod, a zzz. Working:
       * what it holds for its step, a gear spinning while it thinks, its task list's screen. Its drones. Waiting
       * on you: the ! bubble (a plan's, with the blueprint on your desk) and a ring at its feet; your turn: a crate
       * of finished parts and a ✓ (a ? for a question); idle: a charging bolt.
       */
      drawFx(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), T = PXG.T, still = !b.walk;
        if (f.fast && f.state !== 'stale') speedLines(rp, b, T);
        if (f.hot && f.state !== 'stale') smoke(rp, T);
        if (b.zone === 'nap' && still) { // asleep in its pod until it wakes by itself
          const zy = -4 - Math.floor((T * 2) % 4);
          PXG.ctx.globalAlpha = 0.85; rp(10, zy, 3, 1, '#e6eef5'); rp(11, zy + 1, 1, 1, '#e6eef5'); rp(10, zy + 2, 3, 1, '#e6eef5'); PXG.ctx.globalAlpha = 1;
          return;
        }
        if (f.state === 'working' && still) { const act = props.doing(f); if (act) props.draw(act.prop, rp, T, act.flag); }
        if (f.thinking && still) thinkingGear(ox + 14, oy - 7, Math.floor(T * 8));
        if (f.tasks?.total && f.state === 'working' && still) checklistScreen(rp, f.tasks);
        b.kids.forEach((d, k) => { const x = Math.round(d.x), y = Math.round(d.y); if (f.kids[k]?.dog) scannerDrone(x, y, Math.round(b.y), T, k); else drone(x, y, f.shirt ?? '#5ab4ff', T, k); });
        if (f.state === 'waiting') {
          bubble(rp, 12, -7 - blink(3), f.planAsk ? 'plan' : '!');
          if (f.planAsk && b.zone === 'desk' && still) deskBlueprint();
          const x = Math.round(b.x), y = Math.round(b.y); // a ring at its feet that pulses: it needs you
          PXG.ctx.globalAlpha = 0.45 + 0.35 * Math.sin(T * 5);
          px(x - 6, y + 2, 13, 1, '#e04a3a'); px(x - 8, y + 1, 2, 1, '#e04a3a'); px(x + 7, y + 1, 2, 1, '#e04a3a'); px(x - 8, y - 1, 1, 2, '#e04a3a'); px(x + 8, y - 1, 1, 2, '#e04a3a');
          PXG.ctx.globalAlpha = 1;
        }
        if (f.state === 'turn') { heldCrate(rp); if (still) bubble(rp, 12, -7 - (f.question ? blink(3) : 0), f.question ? '?' : 'v'); }
        if (f.state === 'idle' && still) chargingBolt(rp);
      },
      /** Labels that move with what they name: an AGV out of the rank (its server), a delivery drone (its errand), a pod's wake-up time; and +N over the drone dock. */
      movers(posOf) {
        const out = [];
        for (const c of scene.carts ?? []) {
          const s = agvs.get(c.server);
          if (!s || (!s.goal && !s.moving)) continue; // in its bay in the rank
          const who = c.busy ? scene.farmers.find(f => f.id === c.busy) : null;
          out.push({ key: `mcp:${c.server}`, x: s.x, y: s.y - 11, html: pxt(cutMid(c.server, 16), '#5a3a1a', null), title: `${c.server}, an MCP server${who ? `: ${who.name} is calling it` : ''}` });
        }
        for (const f of scene.farmers) {
          const b = posOf(f.id), d = deliveryAt(f, b, PXG.T);
          if (d) out.push({ key: `drone:${f.id}`, x: d.x, y: d.y - 5, html: pxt(clip(f.service, 18), '#5a3a1a', null), title: `${f.name}: ${f.summary || f.service}` });
          if (f.nap && f.wakeAt && b?.zone === 'nap' && !b.walk) out.push({ key: `nap:${f.id}`, x: b.x, y: b.y - 36, html: pxt(`wakes in ${until(f.wakeAt)}`, '#5a3a1a', null), title: `${f.name} wakes up by itself at ${clock(f.wakeAt)}` });
        }
        const more = scene.henhouse?.roosting ?? 0;
        if (more > 0) out.push({ key: 'dock:more', x: 111, y: 13, html: pxt(`+${more}`, '#5a3a1a', null), title: `${more} more subagent${more === 1 ? '' : 's'} running than their robots can lead` });
        return out;
      },
      /** Over everything, the windows' sky too: the tubes overhead, the drones circling over the dock (more running than their robots lead), the delivery drones. */
      top() {
        const T = PXG.T;
        drawTubes(L);
        const more = Math.min(3, scene.henhouse?.roosting ?? 0);
        for (let i = 0; i < more; i++) { const a = T * 1.4 + (i * 2 * Math.PI) / 3; drone(Math.round(111 + Math.cos(a) * 11), Math.round(21 + Math.sin(a) * 4), '#f0b429', T, i); }
        for (const f of scene.farmers) { const d = deliveryAt(f, where(f.id), T); if (d) deliveryDrone(d, T); }
      },
      /** A message from one robot to another: a capsule through the tubes, from a to z, t of the way (0–1), eased. */
      flight(a, z, t) {
        const pts = tubeRoute(L, a, z), lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        let d = e * lens.reduce((sum, l) => sum + l, 0), i = 0;
        while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1] ?? pts[i], k = lens[i] ? Math.min(1, d / lens[i]) : 0;
        capsuleAt(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), Math.abs(x1 - x0) >= Math.abs(y1 - y0));
      },
    };
  }

  /** The factory's legend, shown in a dialog from the Help button: the catalogue, in its words. */
  function helpHtml() {
    return `<div class="px-key">
      <b>Your desk</b><span>at the back, in front of the windows: robots waiting on you queue at its left under a red beacon, waving a red “!”; when it's your turn they bring finished parts to its right (a “?” is a question for you). A blueprint on the desk = a plan for you to approve. The stats panel's “needs you” button opens the first one</span>
      <b>Bays</b><span>one assembly bay per repo inside the yellow and black safety line, where a robot is built as the session's context fills: the frame, the wiring, the plating, the head, then its eyes light up when it is nearly full. Empty bays are bare floor until a repo needs one, up to 18. A blue flag on its sign = a branch other than main; a glass clean room = a worktree, beside its repo's bay; a painted floor zone with a sign = one project's repos</span>
      <b>Compacted</b><span>when a session's conversation is compacted, the finished robot rolls off along the conveyor with a cheer, and a new frame goes on</span>
      <b>Tools</b><span>what a working robot holds is its current step: datapad = reading, scanner = searching, an antenna and a delivery drone = the web, welder = editing, part printer = a new file, multimeter = running tests, polisher = lint or format, wrench = a build, forklift = installing, stamped crate = a commit, a cart up a ramp = a push, rocket crate = a deploy, capsule = a pull, server rack = a server, shredder = deleting, megaphone = calling subagents, clipboard = planning, a question card = a question for you, a plug = an MCP call (its AGV comes over), a scroll = a skill, terminal = any other command, blueprint = plan mode</span>
      <b>Above a robot</b><span>a spinning gear = thinking between steps; a little checklist screen beside it = its task list (its name says how many, e.g. 3/7)</span>
      <b>On a robot</b><span>its beacon: green working, red blinking waiting on you, amber your turn, blue idle. The light on its antenna = its model (purple Opus, blue Sonnet, green Haiku, orange Fable); speed lines = fast mode; hazard stripes = bypass permissions (no checks); a badge on its chest = what it has cost (copper, silver, gold from $50); smoke = a hot CPU. Codex robots are the slate-grey model line</span>
      <b>Drones</b><span>mini drones hovering by a robot = its subagents (a scanner drone sweeping a beam = an Explore subagent). The drone dock holds the ones that finished lately; drones circling over it, with a +N, = more running than their robots can lead</span>
      <b>Delivery drones, AGVs</b><span>a delivery drone flies out of a window and back for each web call going on. An AGV, a little floor robot, waits in the rank on the left for each MCP server (Gmail, playwright, Chrome…) your robots called in the last hour; while a robot calls it, it drives over with the server's name and waits beside it until the call is done</span>
      <b>Part printers, sleep pods</b><span>a part printer humming by a bench = a background command still running; a robot asleep in a pod = a session that wakes up by itself (/loop, a scheduled wake-up), with when</span>
      <b>By a bay</b><span>loose parts on the floor = uncommitted files, boxed parts = unpushed commits, a capsule waiting at the bay's tube outlet = behind the remote</span>
      <b>Stack light</b><span>the repo's last deploy, from GitHub Actions or a deploy an agent ran itself (a deploy script over ssh, rsync, vercel…), whichever is newer: green with a SHIPPED flash = deployed, red with sparks = deploy failed (hover its sign for why; the close-up links to the run), amber with turning gears = deploying, a grey pause light = Actions didn't run (billing, a spending limit). Hazard tape round a bay = two agents writing one repo, pulsing faster when it's serious</span>
      <b>Loading dock</b><span>a crate for each open pull request, its QA tag the checks (green pass, red failed, amber running, grey draft); “Shipped!” = one merged, rolling out of the door</span>
      <b>Charging pads, storage, the open table</b><span>idle robots charge on the pads on the left (eyes shut, a charging bolt); stale ones stand powered down and grey on the storage shelf; robots working outside any repo work at the open table. When more come than a place holds, a +N says how many more</span>
      <b>Buildings</b><span>click the fabricator to start or resume a session, your desk for who is waiting on you, the power-cell bank for your plan's usage, the drone dock for subagents, the manuals shelf for CLAUDE.md and memory, the loading dock for pull requests</span>
      <b>Robots</b><span>one per agent, put together from a head, a body and a drive picked by its agent, so the same agent is always the same robot; its body is the agent's colour in the list. Hover one for its name; names always show for the robot you picked and those at your desk</span>
      <b>Speech bubbles</b><span>what a robot asked or last said; × hides one to a 💬 (click it to show the bubble again); a new message brings it back by itself. The Bubbles switch hides or shows them all</span>
      <b>Power-cell bank</b><span>its lit cells are what is left of your plan's weekly limit: they drain as the week is used (the % on hover, and when it resets); its lamp turns amber from 70% and blinks red from 90%</span>
      <b>Floor heat</b><span>follows your plan's 5-hour limit, on the thermometer by your desk and in the floor vents between the bays: cool while it is fresh (blue, the vents' fans turning slowly), then warm (the fans faster), hot (the fans racing, a shimmer over the vents), and steaming (steam from the vents, sparks off the machines) when it is nearly used up; a new window cools it again. The Heat switch holds one instead (each click moves it on, then back to live): the panel then shows the heat with a 📌 and your real 5-hour use</span>
      <b>Capsules</b><span>one agent messaging another (Claude Code's SendMessage between sessions): a capsule shoots through the pneumatic tubes overhead from one robot to the other, and the floor log says what it said; the agents' conversations show it too</span>
      <b>Animals</b><span>a robot dog, a robot vacuum and a cat that naps on the conveyor live here just for fun: they never stand for anything. Click one (or the belt, for the cat) to pet it, oil the dog, empty the vacuum or feed the cat: the nearest robot that isn't waiting on you rolls over and does it. Now and then the vacuum chases the cat and wedges itself in a corner until a robot frees it; the dog runs to meet a new robot and to the loading dock when a pull request ships. The Animals switch hides them</span>
      <b>Day and night</b><span>the windows show the sky by your clock; at night the lights dim, and desk lamps, screens, stack lights and welding sparks glow. The Sky switch holds it at day or night</span>
      <b>Click</b><span>a robot to answer or message it in the sidebar; a bay's sign for the files robots touched there</span>
      <b>Zoom</b><span>+ / − (or ⌘/Ctrl + scroll, or pinch) zooms the factory inside its frame; drag or scroll to move around (the map in the corner shows where you are; click it to go somewhere); the % button shows the whole factory again</span>
      <b>Stats, bell</b><span>the stats add up what the sessions have cost and how often they were compacted. Bell: a chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you</span>
    </div>`;
  }

  /* ---------- the factory, as a world: the bridge (web/worlds/sdk/bridge.js) runs it ---------- */

  window.Agentville.world(makeFactory());
  // The factory's own pieces, for its tests.
  window.AgentvilleFactory = {
    HEADS, BODIES, DRIVES, lookOf, robotRows, robotSprite, factoryScene, makeFactory, WINDOWS, RANK, CELLS, dockCrates, outletAt, stackLightAt, ventsOf, bankOf, THERMOMETER, STEAM, CHARGED,
    props, FACTORY_PROPS: Object.keys(FACTORY_PROPS), WELD_TIP, agvRoute, agvGoal,
  };
})();
