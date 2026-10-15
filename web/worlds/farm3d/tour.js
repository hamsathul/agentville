// The tour (spec 2026-10-15 alive §5): left alone for 3 minutes, the camera goes round the farm, a shot every 12 s:
// farmers waiting on you, a machine at work, the busiest field, the neighbour farm, an animal at something, and every
// fifth shot the whole land. Any input stops it (app.js puts the view back). Pure: app.js gives it the time and the world.
export const TOUR_IDLE_MS = 180_000, SHOT_MS = 12_000;
/** Ticks this far apart: the farm was out of sight (the frame loop skips a hidden tab and the page's List view). */
const AWAY_MS = 30_000;
const KINDS = ['waiting', 'machine', 'busiest', 'neighbour', 'animal'];
const ZOOM = { waiting: 3, machine: 2.5, busiest: 2, neighbour: 2, animal: 3 };

/**
 * touch(now): there was input. pick(id, now): the page's pick, sent again with every snapshot: only a new one counts.
 * press(now): a press on the farm, true if it stopped the tour (its click then picks nothing). tick(now, ctx) → {} |
 * { start: true, shot } | { shot } | { stop: true }, ctx: { on (the switch), still, shown, dialog (one open, or the
 * close-up, or Help), follow (Follow keeps a farmer in view), world: { waiting: [[x, y]], machine, busiest, neighbour,
 * animal: [x, y] | null } }; a shot is { kind, at: [x, y] | null (the whole land), zoom }. Back after a while out of
 * sight counts as input: the 3 minutes start again.
 */
export function createTour({ idleMs = TOUR_IDLE_MS, shotMs = SHOT_MS } = {}) {
  let last = null, on = false, shotAt = 0, next = 0, shots = 0, ticked = null, picked;
  const pointOf = (kind, w) => (kind === 'waiting' ? w.waiting?.[0] ?? null : w[kind] ?? null);
  function nextShot(w) {
    shots++;
    if (shots % 5 === 0) return { kind: 'whole', at: null, zoom: 1 };
    for (let k = 0; k < KINDS.length; k++) {
      const kind = KINDS[(next + k) % KINDS.length], at = pointOf(kind, w);
      if (!at) continue;
      next = kind === 'animal' ? 0 : KINDS.indexOf(kind) + 1; // after the animal, a new round: waiting first
      return { kind, at, zoom: ZOOM[kind] };
    }
    next = 0;
    return { kind: 'whole', at: null, zoom: 1 };
  }
  return {
    touch(now) { last = now; },
    pick(id, now) { if ((id ?? null) !== picked) { picked = id ?? null; last = now; } },
    press(now) { const was = on; last = now; return was; },
    touring: () => on,
    /** The tour now (the check): as if left alone long enough. */
    force() { last = -Infinity; },
    tick(now, ctx) {
      if (ticked !== null && now - ticked > AWAY_MS) last = now; // back from a hidden tab or the List view
      ticked = now;
      last ??= now;
      const can = ctx.on && !ctx.still && ctx.shown && !ctx.dialog && !ctx.follow;
      if (on && (!can || last > shotAt)) { on = false; last = Math.max(last, now); return { stop: true }; }
      if (!can) { last = now; return {}; } // its 3 minutes count from when it could run
      if (!on) {
        if (now - last < idleMs) return {};
        on = true; shotAt = now; shots = 0; next = 0;
        return { start: true, shot: nextShot(ctx.world) };
      }
      if (now - shotAt < shotMs) return {};
      shotAt = now;
      return { shot: nextShot(ctx.world) };
    },
  };
}
