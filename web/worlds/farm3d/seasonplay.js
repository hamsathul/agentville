// Seasonal play (spec 2026-10-15 alive §9): in winter now and then two idle farmers on one farm throw snowballs at
// each other (6 to 8 throws, in turn, 2 s apart); in autumn three leaf piles lie in each farm's yard, and the dogs dive
// into them (antics.js's `pile` habit). Pure: app.js turns the farmers and throws, build/life.js draws the balls,
// the piles and the leaves.
export const SNOW_FIRST_MS = 60_000, SNOW_GAP_MS = 180_000, THROW_MS = 2000;
/** Free for a fight: idle, not napping, on no errand, not followed. */
const free = f => f.state === 'idle' && !f.nap && !f.errand && !f.followed;

/**
 * tick(ctx) → {} | { start: { a, b } } | { end: true }; ctx: { now (ms), still, winter, farmers: [{ id, farm, state,
 * nap, errand, followed, at }] }. fight() → { a, b, throws: [{ from, to, at }] } or null; force() (the check).
 */
export function createSnowballs({ rand = Math.random } = {}) {
  let next = null, fight = null;
  return {
    tick({ now, still, winter, farmers }) {
      next ??= now + SNOW_FIRST_MS;
      if (fight) {
        const ok = id => farmers.some(f => f.id === id && free(f));
        if (still || !winter || !ok(fight.a) || !ok(fight.b) || now > fight.throws.at(-1).at + 1500) { fight = null; return { end: true }; }
        return {};
      }
      if (still || !winter || now < next) return {};
      for (const farm of [0, 1]) {
        const pool = farmers.filter(f => free(f) && (f.farm ?? 0) === farm);
        if (pool.length < 2) continue;
        const a = pool[Math.floor(rand() * pool.length) % pool.length], rest = pool.filter(f => f !== a), b = rest[Math.floor(rand() * rest.length) % rest.length];
        const n = 6 + Math.floor(rand() * 3);
        fight = { a: a.id, b: b.id, throws: Array.from({ length: n }, (_, k) => ({ from: k % 2 ? b.id : a.id, to: k % 2 ? a.id : b.id, at: now + 500 + k * THROW_MS })) };
        next = now + SNOW_GAP_MS;
        return { start: { a: a.id, b: b.id } };
      }
      next = now + 30_000; // no pair just now: look again in a while
      return {};
    },
    fight: () => fight,
    force() { next = -Infinity; },
  };
}

/** The leaf piles' places in a yard (your farm's layout): open ground clear of the pond, the hammocks and the trees. */
export const LEAF_PILES = [[40, 330], [70, 400], [140, 360]];
/** The leaf piles on a ground L: three in your yard, three in the neighbour's with one. */
export const leafPilesOf = L => [0, ...(L.land?.ox ? [L.land.ox] : [])].flatMap(ox => LEAF_PILES.map(([x, y]) => [x + ox, y]));
