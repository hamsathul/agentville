// The starter world: a plain world with everything a world needs, short enough to read at once. Make your
// own from it with `npm run new-world -- <name>` and change anything (docs/worlds.md, "Making a world").
// It draws with the SDK in its frame (pixel.js, people.js, props.js, engine.js), whose names the frame
// shares, so it keeps its own inside this function.
(() => {
  'use strict';
  const W = 400, DOOR_Y = 76, BENCH = [292, 52];
  const { lookFor, sprite } = window.Agentville.people;
  const props = window.Agentville.props.kit(); // every step's prop; pass { steps, props } to draw your own

  // Each agent dresses from this outfit, by its id: the same agent always looks the same.
  const OUTFIT = { hat: ['cap', 'beanie', 'none'], top: 'shirt', bottom: 'trousers', extra: ['none', 'glasses'] };
  const looks = new Map();
  const lookOf = f => { if (!looks.has(f.id)) looks.set(f.id, lookFor(f, OUTFIT)); return looks.get(f.id); };

  // The plots: the engine's repo grid, three columns in a fence. A repo keeps its plot.
  const grid = makeGrid({
    cols: 3, colW: 88, rowH: 62, cx0: 112, top0: 100,
    slot: (cx, rowTop) => ({ lane: rowTop + 44 }),
    fence: rows => ({ x0: 64, x1: 336, y0: 96, y1: 104 + rows * 62 }),
    height: fence => fence.y1 + 28,
  });
  let L = grid.layoutFor([]), scene = { fields: [], farmers: [] };
  const DEPLOY = { ok: '#2fa57a', failed: '#e04a3a', running: '#f0b429', skipped: '#9aa4ad' };

  window.Agentville.world({
    W, grid, corridors: [64, 156, 244, 336],
    nouns: { agent: 'person', agents: 'people', repo: 'plot', repos: 'plots', place: 'world' },
    layout: () => L,
    relayout(next) { L = next; return L; },
    setScene(next) { scene = next; return []; },
    spawn: () => [W / 2, DOOR_Y],

    // A cat, just for fun: it never stands for data (docs/worlds.md, "Creatures"). It walks the grass below the
    // path (the door and the bench are above it) down to the fence's foot, beside the fence: never on the plots.
    animals: () => [{ kind: 'cat', name: 'Cat', actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }], lines: { idle: ['mrrp.'], petted: ['purr ♥'], fed: ['MEOW'] } }],
    roam: () => [{ x: 8, y: DOOR_Y + 22, w: W - 16, h: L.GRID.y1 - DOOR_Y - 22 }],
    avoid: () => [{ x: L.GRID.x0 - 4, y: L.GRID.y0 - 4, w: L.GRID.x1 - L.GRID.x0 + 8, h: L.GRID.y1 - L.GRID.y0 + 8 }],

    /** Where each agent stands: in its plot while it works, at the door when it needs you, on the bench otherwise. */
    slots(f) {
      const plot = f.state === 'working' && L.ST.find(s => s.key === f.field);
      if (plot) return { group: `st:${plot.key}`, zone: `st:${plot.key}`, at: used => { const off = [props.doing(f)?.spot ?? 0, -26, 26, 0, -13, 13].find(o => !used.includes(o)) ?? 0; used.push(off); return [plot.cx + off, plot.lane]; } };
      if (f.state === 'waiting' || f.state === 'turn') return { group: 'door', zone: 'door', cap: 12, at: i => [36 + i * 18, DOOR_Y] };
      return { group: 'bench', zone: 'bench', cap: 12, at: i => [BENCH[0] + (i % 4) * 16, BENCH[1] + Math.floor(i / 4) * 12] };
    },

    /** The ground, drawn once (again when the plots change): grass, the path to the door, the fence, a bed for each plot. */
    bg(fill, season, ext) {
      fill(ext.x0, ext.y0, ext.x1 - ext.x0, ext.y1 - ext.y0, '#5d9b46');
      fill(ext.x0, DOOR_Y + 2, ext.x1 - ext.x0, 8, '#c9a46a');
      const g = L.GRID;
      for (const [x, y, w, h] of [[g.x0, g.y0, g.x1 - g.x0, 2], [g.x0, g.y1, g.x1 - g.x0, 2], [g.x0, g.y0, 2, g.y1 - g.y0], [g.x1 - 2, g.y0, 2, g.y1 - g.y0]]) fill(x, y, w, h, '#8b5a2b');
      for (const s of L.ST) fill(s.cx - 36, s.rowTop + 12, 72, 30, '#7a5230');
    },

    /** Drawn every frame, under the people: each plot fills with green as its agents use their context; its last deploy is a flag. */
    ground() {
      for (const s of L.ST) {
        const pct = Math.max(0, ...scene.farmers.filter(f => f.field === s.key).map(f => f.pct ?? 0));
        px(s.cx - 34, s.rowTop + 14, Math.round(68 * pct), 4, '#6cc04a');
        const d = scene.fields.find(x => x.key === s.key)?.lastDeploy?.state;
        if (d) { px(s.cx + 30, s.rowTop + 2, 1, 10, '#4e3626'); px(s.cx + 31, s.rowTop + 2, 5, 4, '#2fa57a'); }
      }
    },

    /** A person from the people kit: walking, it faces where it goes; waiting on you, it waves. */
    drawChar(f, b) {
      const [ox, oy] = pixelOrigin(b, 16), view = b.walk ? b.face ?? 'down' : 'down';
      PXG.ctx.drawImage(sprite(lookOf(f), f.shirt, { view, legs: legFrame(b), wave: f.state === 'waiting' }), ox, oy, 14 * SC, 16 * SC);
      if (view === 'down' && f.state !== 'idle') { const rp = rpAt(ox, oy); rp(5, 6, 1, 1, '#2a1d14'); rp(8, 6, 1, 1, '#2a1d14'); } // eyes, shut while idle
    },

    /** Over each person: its prop while it works, a bubble when it needs you, zzz while idle, a ring at its feet while it waits. */
    drawFx(f, b) {
      const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), act = props.doing(f);
      if (f.state === 'working' && !b.walk && act) props.draw(act.prop, rp, PXG.T, act.flag);
      if (f.state === 'waiting') { bubble(rp, 12, -8, f.planAsk ? 'plan' : '!'); px(Math.round(b.x) - 6, Math.round(b.y) + 2, 13, 1, '#e04a3a'); }
      if (f.state === 'turn') bubble(rp, 12, -8, f.question ? '?' : 'v');
      if (f.state === 'idle' && !b.walk) rp(11, -2 - Math.floor((PXG.T * 2) % 4), 3, 1, '#e6eef5');
      if (f.state === 'stale') { PXG.ctx.globalAlpha = 0.4; rp(1, 0, 12, 16, '#9aa4ad'); PXG.ctx.globalAlpha = 1; }
    },
  });
})();
