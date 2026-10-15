// Wildlife on the farm (spec 2026-10-15 alive §6): fireflies at night over the pastures, the yards and the headlands;
// bees by day over the well-grown fields; crows on a harvested field and for two minutes after it is sown again, off
// when a farmer or a machine comes near. Pure: build/life.js draws them.
import { GRID_CONFIG, pastureOf } from './layout.js';

export const CROW_STAY_MS = 120_000, BEE_BEDS = 4, SCARE_PX = 24;
/** Whether the fireflies are out: at night (the night factor over 0.6), and never in winter. */
export const firefliesOn = (night, season) => night > 0.6 && season !== 'winter';

/** Where the fireflies drift, as rectangles on the map: each farm's pasture, yard and the headlands above its rows. */
export function fireflyRects(L) {
  const pa = pastureOf(L), G = L.GRID, farms = L.land?.ox ? [0, L.land.ox] : [0], rows = L.rows ?? 3;
  return farms.flatMap(ox => [
    { x: pa.x0 + ox, y: pa.y0, w: pa.x1 - pa.x0, h: pa.y1 - pa.y0 },
    { x: ox, y: 166, w: 186, h: G.y1 + 22 - 166 },
    ...Array.from({ length: rows }, (_, k) => ({ x: G.x0 + ox, y: GRID_CONFIG.top0 + k * GRID_CONFIG.rowH + 4, w: G.x1 - G.x0, h: 22 })),
  ]);
}

/** The fields with bees: growing or ripe at stage 3 or more (season.js's look), the most grown four, by day, not in winter. */
export function beesFor(beds, looks, night, season) {
  if (night > 0.5 || season === 'winter') return [];
  return beds.map(b => ({ b, l: looks.get(b.key) })).filter(({ l }) => l && (l.stage === 'growing' || l.stage === 'ripe') && l.growth >= 3)
    .sort((p, q) => q.l.growth - p.l.growth).slice(0, BEE_BEDS).map(({ b }) => ({ key: b.key, x: b.cx, y: b.y0 + b.d / 2 }));
}

const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
/**
 * The crows: update(looks, beds, now) each frame (a field turns `cut`: they come; sown again: they stay two minutes);
 * flocks(scare) → [{ key, x, y, n }] (scare([x, y]): a farmer or a machine near: that flock flies off till the next harvest).
 */
export function createCrows() {
  const fields = new Map(); // key → { until (null while cut), scared }
  return {
    update(looks, beds, now) {
      const here = new Set(beds.map(b => b.key));
      for (const k of [...fields.keys()]) if (!here.has(k)) fields.delete(k);
      for (const b of beds) {
        const cut = looks.get(b.key)?.stage === 'cut', st = fields.get(b.key);
        if (cut) { if (!st || st.until !== null) fields.set(b.key, { until: null, scared: false, bed: b }); else st.bed = b; }
        else if (st) { if (st.until === null) st.until = now + CROW_STAY_MS; else if (now > st.until) fields.delete(b.key); }
      }
    },
    flocks(scare) {
      const out = [];
      for (const [key, st] of fields) {
        if (st.scared) continue;
        const x = st.bed.cx, y = st.bed.y0 + st.bed.d / 2;
        if (scare([x, y])) { st.scared = true; continue; }
        out.push({ key, x, y, n: 3 + (hash(key) % 3) });
      }
      return out;
    },
  };
}
