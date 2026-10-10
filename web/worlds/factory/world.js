// The robot factory: the second built-in world. Every agent is a robot, put together from a head, a body in
// its agent's colour and a drive, picked by its id; every repo is an assembly bay. A bright, friendly
// workshop on the shared engine (web/worlds/sdk/engine.js), like the farm, in the frame's shared scope
// (pixel.js, people.js, props.js, creatures.js, animals.js, engine.js), so it keeps its own names inside
// this function. Classic script, no dependencies, one file (the frame loads only world.js).
(() => {
  'use strict';
  const { pick } = window.Agentville.people; // the people kit's seeded pick: one of n for an id and a salt

  /* ---------- the scene: what the factory draws, from the snapshot ---------- */

  /** The factory's scene: the engine's, with each robot's look. */
  function factoryScene(s) {
    const e = engineScene(s);
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
   * is slate, and its chest light the agent's colour. The rest are snapped to the pixel kit's palette.
   */
  function robotPalette(look, color, off = false) {
    const own = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : SLATE; // a colour that isn't one (none at all): slate, rather than a throw
    const codex = look?.line === 'codex', body = codex ? SLATE : own;
    const pal = off ? { ...OFF } : { ...METAL, C: body, c: shade(body, 0.78), B: codex ? own : METAL.B };
    for (const k of Object.keys(pal)) if (off || !(k === 'C' || k === 'c' || (k === 'B' && codex))) pal[k] = ink(pal[k]);
    return pal;
  }
  const sprites = new Map();
  /**
   * A robot's sprite, a 14 × 16 canvas, made once: `view` down, up, right or left; `legs` a walking frame
   * (s, a, b); `wave` its right arm up (from the front); `off` powered down, grey (stale).
   */
  function robotSprite(look, color, { view = 'down', legs = 's', wave = false, off = false } = {}) {
    const key = `${look?.head}|${look?.drive}|${look?.line}|${look?.chest}|${color}|${view}|${legs}|${Boolean(wave)}|${Boolean(off)}`;
    if (sprites.has(key)) return sprites.get(key);
    const pal = robotPalette(look, color, off);
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

  /* ---------- the floor (a first one: Task 4 builds the workshop) ---------- */

  const W = 400, DESK_Y = 80, FAB_DOOR = [62, DESK_Y];
  const FACTORY_GRID = makeGrid({
    cols: 3, colW: 88, rowH: 62, cx0: 174, top0: 100,
    slot: (cx, rowTop) => ({ lane: rowTop + 44, x0: cx - 36, y0: rowTop + 12 }),
    fence: rows => ({ x0: 128, x1: 396, y0: 96, y1: 104 + rows * 62 }), height: fence => fence.y1 + 28,
  });
  const FLOOR = '#f4ecd8', GROUT = '#e8d8b0', WALL = '#d4c294', SAFETY = '#ffd43b', BAY = '#c3cbd2'; // warm pale tiles, so the robots' white heads stand out

  /* ---------- the hooks ---------- */

  function makeFactory() {
    let L = FACTORY_GRID.layoutFor([]);
    const stOf = k => L.ST.find(s => s.key === k);
    /** Its eyes on its visor (rows 5–7), as the farm draws its farmers': shut while idle, wide while waiting on you, smiling on your turn, looking down at its work. */
    const eyes = (f, b, rp, view) => {
      const E = METAL.e, DIM = '#5f7f9a', down = f.state === 'working' && !b.walk;
      if (view === 'left' || view === 'right') { rp(view === 'right' ? 10 : 3, down ? 6 : 5, 1, 2, E); return; }
      const blinking = ((PXG.T + (f.color ?? 0) * 0.37) % 3.7) < 0.12; // now and then, each robot on its own beat
      if ((f.state === 'idle' && !b.walk) || blinking) { rp(4, 6, 2, 1, DIM); rp(8, 6, 2, 1, DIM); return; } // shut
      if (f.state === 'waiting') { rp(4, 5, 2, 2, E); rp(8, 5, 2, 2, E); return; } // wide
      if (f.state === 'turn' && !b.walk) { rp(4, 5, 2, 1, E); rp(8, 5, 2, 1, E); rp(6, 7, 2, 1, E); return; } // pleased: a squint and a grin
      rp(5, down ? 6 : 5, 1, 2, E); rp(8, down ? 6 : 5, 1, 2, E);
    };
    return {
      key: 'factory', W, SH: 16, corridors: [116, 218, 306], grid: FACTORY_GRID, fromScene: factoryScene,
      nouns: { agent: 'robot', agents: 'robots', repo: 'bay', repos: 'bays', place: 'factory' },
      seasonNames: { switch: 'Heat', spring: 'cool', summer: 'warm', autumn: 'hot', winter: 'steaming' },
      layout: () => L,
      relayout(ground) { L = ground; return L; },
      spawn: () => FAB_DOOR,
      /** Where each robot stands: at its bay while it works, at your desk when it needs you, else on a holding line on the left. */
      slots(f) {
        const s = f.state === 'working' ? stOf(f.field) : null;
        if (s) return { group: `st:${s.key}`, zone: `st:${s.key}`, at: used => { const off = [0, -26, 26, -13, 13].find(o => !used.includes(o)) ?? 0; used.push(off); return [s.cx + off, s.lane]; } };
        if (f.state === 'waiting') return { group: 'desk', zone: 'desk', cap: 3, at: i => [150 + 22 * i, DESK_Y] };
        if (f.state === 'turn') return { group: 'turn', zone: 'turn', cap: 3, at: i => [250 - 22 * i, DESK_Y] };
        return { group: 'hold', zone: 'hold', cap: 12, at: i => [20 + (i % 4) * 24, 128 + Math.floor(i / 4) * 26] };
      },
      /** The floor, drawn once (again when the bays change): pale tiles, the back wall, a yellow safety line round the bays, a pad for each bay. */
      bg(fill, season, ext) {
        fill(ext.x0, ext.y0, ext.x1 - ext.x0, ext.y1 - ext.y0, FLOOR);
        for (let x = Math.floor(ext.x0 / 16) * 16; x < ext.x1; x += 16) fill(x, 64, 1, ext.y1 - 64, GROUT);
        for (let y = 64; y < ext.y1; y += 16) fill(ext.x0, y, ext.x1 - ext.x0, 1, GROUT);
        fill(ext.x0, ext.y0, ext.x1 - ext.x0, 64 - ext.y0, WALL);
        const g = L.GRID;
        for (const [x, y, w, h] of [[g.x0, g.y0, g.x1 - g.x0, 2], [g.x0, g.y1, g.x1 - g.x0, 2], [g.x0, g.y0, 2, g.y1 - g.y0], [g.x1 - 2, g.y0, 2, g.y1 - g.y0]]) fill(x, y, w, h, SAFETY);
        for (const s of L.ST) fill(s.cx - 36, s.rowTop + 12, 72, 30, BAY);
      },
      /** A robot: walking, it faces where it goes; waiting on you, it waves; stale, it is powered down. Its eyes go on its visor. */
      drawChar(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), off = f.state === 'stale';
        const view = b.walk ? b.face ?? 'down' : 'down';
        PXG.ctx.drawImage(robotSprite(f.look ?? lookOf(f), f.shirt, { view, legs: legFrame(b), wave: f.state === 'waiting', off }), ox, oy, 14 * SC, 16 * SC);
        if (!off && view !== 'up') eyes(f, b, rp, view);
      },
    };
  }

  /* ---------- the factory, as a world: the bridge (web/worlds/sdk/bridge.js) runs it ---------- */

  window.Agentville.world(makeFactory());
  // The factory's own pieces, for its tests.
  window.AgentvilleFactory = { HEADS, BODIES, DRIVES, lookOf, robotRows, robotSprite, factoryScene, makeFactory };
})();
