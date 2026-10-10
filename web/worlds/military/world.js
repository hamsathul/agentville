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
  /** Its eyes, as the farm draws its farmers': shut while idle (and now and then, a blink), two dots wide while waiting on you, a grin on your turn, looking down at its work. */
  function eyes(f, b, rp, view) {
    if (view === 'left' || view === 'right') { rp(view === 'right' ? 9 : 4, 6, 1, 1, K); return; }
    const ex = 5, blinking = ((PXG.T + (f.color ?? 0) * 0.37) % 3.7) < 0.12; // each soldier on its own beat
    if ((f.state === 'idle' && !b.walk) || blinking) { rp(ex, 6, 1, 1, '#8a5a3a'); rp(ex + 3, 6, 1, 1, '#8a5a3a'); return; } // shut
    const ey = f.state === 'working' && !b.walk ? 7 : 6;
    if (f.state === 'turn' && !b.walk) { rp(ex - 1, ey, 2, 1, K); rp(ex + 3, ey, 2, 1, K); rp(ex + 1, 7, 2, 1, '#b5562f'); return; }
    const h = f.state === 'waiting' ? 2 : 1;
    rp(ex, ey, 1, h, K); rp(ex + 3, ey, 1, h, K);
  }

  /* ---------- the base: the exercise field, the track, the positions' grid ---------- */

  // 400 wide like the farm and the factory, growing down with the positions' rows. The track (y 74–92) runs
  // across in front of the back; the positions are in the engine's grid, the farm's and the factory's numbers.
  const W = 400, COLW = 88, ROWH = 62, TRACK = { y0: 74, y1: 92 }, TRACK_Y = 80;
  const TRACK_PLACES = 24; // along the track, 16 apart
  const SPOTS = [0, -26, 26, -13, 13]; // where the soldiers at a position stand, from its middle
  const MILITARY_GRID = makeGrid({
    cols: 3, colW: COLW, rowH: ROWH, cx0: 174, top0: 100,
    slot: (cx, rowTop) => ({ lane: rowTop + 44 }), // where its soldiers stand
    fence: rows => ({ x0: 128, x1: 396, y0: 96, y1: 104 + rows * ROWH }), height: fence => fence.y1 + 28,
  });
  const GRASS = '#6aa84f', MOWN = '#7fbf5a', SAND = '#dcc08a', SAND_EDGE = '#c9a46a';
  /** The ground, drawn once (again when the positions change): sunny grass in mown stripes, the sandy track across it. */
  function drawField(f, ext) {
    const { x0, x1, y0, y1 } = ext;
    f(x0, y0, x1 - x0, y1 - y0, GRASS);
    for (let x = Math.floor(x0 / 32) * 32; x < x1; x += 32) f(x, y0, 16, y1 - y0, MOWN);
    f(x0, TRACK.y0, x1 - x0, TRACK.y1 - TRACK.y0, SAND);
    f(x0, TRACK.y0, x1 - x0, 1, SAND_EDGE); f(x0, TRACK.y1 - 1, x1 - x0, 1, SAND_EDGE);
  }

  /* ---------- the hooks ---------- */

  function makeMilitary() {
    let L = MILITARY_GRID.layoutFor([]);
    return {
      key: 'military', W, SH: 16, grid: MILITARY_GRID, fromScene: militaryScene,
      nouns: { agent: 'soldier', agents: 'soldiers', repo: 'position', repos: 'positions', place: 'base' },
      // The 5-hour limit is the alert level; the setting still saves spring … winter.
      seasonNames: { switch: 'Alert', spring: 'calm', summer: 'ready', autumn: 'high', winter: 'max' },
      coldSeason: null, // max alert is no weather: the mascots never act cold
      layout: () => L,
      relayout(ground) { L = ground; return L; },
      /** Where each soldier stands: at its position while it works there; everyone else on the track. */
      slots(f) {
        const pos = f.state === 'working' ? L.ST.find(s => s.key === f.field) : null;
        if (pos) return { group: `st:${pos.key}`, zone: `st:${pos.key}`, at: used => { const off = SPOTS.find(o => !used.includes(o)) ?? 0; used.push(off); return [pos.cx + off, pos.lane]; } };
        return { group: 'track', zone: 'track', cap: TRACK_PLACES, at: i => [12 + 16 * i, TRACK_Y] };
      },
      bg(fill, season, ext) { drawField(fill, ext); },
      /** A soldier: walking, it faces where it goes; waiting on you, it waves; its eyes as the farm's. */
      drawChar(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), look = f.look ?? lookOf(f);
        const view = b.walk ? b.face ?? 'down' : 'down';
        PXG.ctx.drawImage(soldierSprite(look, f.shirt, { view, legs: legFrame(b), wave: f.state === 'waiting' }), ox, oy, 14 * SC, 16 * SC);
        if (view !== 'up') eyes(f, b, rp, view);
      },
    };
  }

  /* ---------- the field exercise, as a world: the bridge (web/worlds/sdk/bridge.js) runs it ---------- */

  window.Agentville.world(makeMilitary());
  // The field exercise's own pieces, for its tests.
  window.AgentvilleMilitary = { OUTFIT, lookOf, soldierSprite, militaryScene, makeMilitary };
})();
