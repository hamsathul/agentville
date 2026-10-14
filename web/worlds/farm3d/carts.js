// The MCP servers' carts and the web calls' cart to town, by the 2D farm's rules (web/worlds/farm/world.js: cartRoute,
// cartGoal, besideOf, the carts' tick, cartOf), on the 3D farm's map; collector/test/farm3d-parity.test.mjs pins them.
// Each server called in the last hour (scene.carts, six at most) has a cart in a row at the lane's end; while a farmer
// calls it, it drives over beside it (onto the lane, along it, down the nearest walkway), stays while the call goes on
// and 3 s after, then drives home. Pure: build/carts.js draws them.
import { CART_RANK, CORR as CORRIDORS, CORR_OF, LANE as LANE_Y, ROAD, W, farmAt } from './layout.js';

/** A cart's way between two places: onto the lane (straight down or up to it, or up the path nearest), along it, then down the path nearest the place, and over to it. */
export function cartRoute([x, y], [tx, ty], { lane: LANE = LANE_Y, corr: CORR = CORRIDORS } = {}) {
  if (Math.abs(y - ty) < 0.5) return [[tx, ty]];
  const near = to => CORR.reduce((best, c) => (Math.abs(to - c) < Math.abs(to - best) ? c : best));
  const pts = [];
  if (Math.abs(y - LANE) > 0.5) {
    const c = y < LANE ? x : near(x);
    if (y > LANE) pts.push([c, y]);
    pts.push([c, LANE]);
  }
  if (Math.abs(ty - LANE) <= 0.5) pts.push([tx, ty]);
  else {
    const c = ty < LANE ? tx : near(tx);
    pts.push([c, LANE]);
    if (ty > LANE) pts.push([c, ty]);
    pts.push([tx, ty]);
  }
  return pts.filter((p, i) => { const q = i ? pts[i - 1] : [x, y]; return p[0] !== q[0] || p[1] !== q[1]; });
}
export const CART_STAY_MS = 3000;
/**
 * Where a server's cart heads: beside the farmer calling it. Once there it stays while the call goes
 * on and a few seconds after (so a short call is seen, and a run of them keeps it there), then home.
 * `c` is the cart's own memory: { goal, arrivedAt, lastBusy }.
 */
export function cartGoal(c, busyAt, home, now) {
  if (busyAt) {
    if (!c.goal || c.goal[0] !== busyAt[0] || c.goal[1] !== busyAt[1]) { c.goal = busyAt; c.arrivedAt = null; }
    c.lastBusy = now;
    return c.goal;
  }
  if (c.goal && (c.arrivedAt == null || now - Math.max(c.lastBusy ?? 0, c.arrivedAt) < CART_STAY_MS)) return c.goal;
  c.goal = null;
  return home;
}
export const CART_SPEED = 55; // 2D pixels a second
/** A crate colour for each server, by its name (the people kit's hash). */
export const CRATES = ['#c9a46a', '#e04a3a', '#3d7be0', '#6cc04a', '#8a5fc0', '#f0b429'];
export const hashOf = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
/** Beside a farmer, on the side away from its farm's edge (`ox`: the farm's offset, the neighbour's): where it is going rather than where it is, so the cart does not chase it step by step. */
export const besideOf = (b, ox = 0) => { const x = Number.isFinite(b.tx) ? b.tx : b.x, y = Number.isFinite(b.ty) ? b.ty : b.y; return [Math.round(x + (x - ox > W - 60 ? -13 : 13)), Math.round(y)]; };

/**
 * The carts: tick(list (scene.carts: { server, busy }), dt, posOf (a farmer's place, or null when not drawn), snap (Motion
 * off: each where it is going), now, land ({ w, ox }: with a neighbour farm, both farms' walkways: a cart to a neighbour's
 * farmer goes along the lane, over the bridge and down its walkway)) → [{ server, x, y, dir, moving, away (out of its
 * place), crate, who (the caller) }].
 */
export function createCarts() {
  const rankOf = new Map(), carts = new Map(); // server → its place in the row; server → { x, y, path, to, dir, moving, goal, arrivedAt, lastBusy }
  return {
    tick(list, dt, posOf, snap, now, land = null) {
      list = list ?? [];
      const ox = land?.ox ?? 0, corr = ox ? [...CORRIDORS, ...CORR_OF(ox)] : CORRIDORS;
      for (const k of [...rankOf.keys()]) if (!list.some(c => c.server === k)) { rankOf.delete(k); carts.delete(k); }
      for (const c of list) if (!rankOf.has(c.server)) { const used = new Set(rankOf.values()); rankOf.set(c.server, CART_RANK.findIndex((_, i) => !used.has(i))); }
      return list.filter(c => rankOf.get(c.server) >= 0).map(c => {
        const home = CART_RANK[rankOf.get(c.server)];
        let s = carts.get(c.server);
        if (!s) carts.set(c.server, (s = { x: home[0], y: home[1], path: [], to: home, dir: -1 }));
        const b = c.busy ? posOf(c.busy) : null;
        const goal = cartGoal(s, b ? besideOf(b, ox && farmAt(Number.isFinite(b.tx) ? b.tx : b.x) ? ox : 0) : null, home, now);
        if (goal[0] !== s.to[0] || goal[1] !== s.to[1]) { s.to = goal; s.path = cartRoute([s.x, s.y], goal, { corr }); }
        if (snap) { // no motion: it stands where it is going, facing the farmer (or the farm, in its place)
          [s.x, s.y] = goal;
          s.path = [];
          s.dir = b && s.goal ? (goal[0] > (Number.isFinite(b.tx) ? b.tx : b.x) ? -1 : 1) : -1;
        }
        if (s.path.length) {
          const [qx, qy] = s.path[0], dx = qx - s.x, dy = qy - s.y, d = Math.hypot(dx, dy), sp = CART_SPEED * dt;
          if (Math.abs(dx) > 0.1) s.dir = Math.sign(dx);
          if (d <= sp) { s.x = qx; s.y = qy; s.path.shift(); } else { s.x += (dx / d) * sp; s.y += (dy / d) * sp; }
        } else if (s.goal && s.arrivedAt == null) s.arrivedAt = now; // there: it waits (cartGoal says how long)
        else if (!s.goal) s.dir = -1; // back in its place, facing the farm
        s.moving = s.path.length > 0;
        const along = s.path.length ? Math.abs(s.path[0][1] - s.y) > Math.abs(s.path[0][0] - s.x) : false; // down or up a walkway
        return { server: c.server, x: s.x, y: s.y, dir: s.dir, along, moving: s.moving, away: Boolean(s.goal || s.moving), crate: CRATES[hashOf(c.server) % CRATES.length], who: c.busy ?? null };
      });
    },
  };
}

/**
 * A farmer's cart on the road while a web call goes on (T: the clock, seconds): out to town past the farm's right edge,
 * and back, every 8 s. (A connector's has a cart of its own.) With a neighbour farm (`land.ox`), town is up the road
 * between the farms: along the lane to the road, then north up it ({ x, y, dir, along }: along while on the road).
 */
export function cartOf(f, T, land = null) {
  if (f.state !== 'working' || !f.service || f.step !== 'web' || String(f.tool ?? '').startsWith('mcp__')) return null;
  const ph = (T / 8 + (hashOf(f.id) % 97) / 97) % 1, out = ph < 0.5, t = out ? ph * 2 : (1 - ph) * 2;
  if (!land?.ox) return { x: Math.round(W - 160 + t * 180), dir: out ? 1 : -1 };
  const x0 = W - 160, y0 = LANE_Y + 4, along = ROAD.mid - x0, up = y0 + 30, d = t * (along + up);
  return d <= along ? { x: Math.round(x0 + d), y: y0, dir: out ? 1 : -1, along: false } : { x: ROAD.mid, y: Math.round(y0 - (d - along)), dir: out ? 1 : -1, along: true };
}
