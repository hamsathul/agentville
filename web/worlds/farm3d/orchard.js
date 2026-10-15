// The orchard (spec 2026-10-15 alive §4): a fruit tree for each pull request merged in the last 90 days (the scene's
// prs.recent), along the front of your farm between the pasture's fence and the forest: two rows, a block per repo
// (in its bed's order) under a sign with its count, the newest 80 at most; a sapling the day it merges, a full tree
// two weeks on. Pure: nature.js draws the trees with the plants, overlay.js the signs, roam.js keeps the animals off
// the trunks.
import { PASTURE_GATES, W, pastureOf } from './layout.js';

export const ORCHARD_MAX = 80, ORCHARD_STEP = 18, GROW_MS = 14 * 86_400_000;
/** A tree's size by its merge's age: 0.35 the day it merges, 1 at two weeks, in tenths. */
export const sizeOf = (at, now) => Math.round((0.35 + 0.65 * Math.min(1, Math.max(0, now - at) / GROW_MS)) * 10) / 10;

/**
 * The orchard for the scene's fields (the engine's, each with prs.recent) on a ground L at a time `now`, the repos in
 * `order` first (their beds' keys): { trees: [{ key, x, y, size }], signs: [{ key, name, count, x, y }] }.
 */
export function orchardOf(fields, L, now, order = []) {
  const pa = pastureOf(L), rows = [pa.y1 + 20, pa.y1 + 46], gate = [PASTURE_GATES.bottom[0] - 8, PASTURE_GATES.bottom[1] + 8];
  const cols = [];
  for (let x = 24; x <= W - 24; x += ORCHARD_STEP) if (x < gate[0] || x > gate[1]) cols.push(x); // the forest gate's way clear
  const all = fields.flatMap(f => (f.worktree ? [] : (f.prs?.recent ?? []).map(p => ({ key: f.key, at: p.at })))).sort((a, b) => b.at - a.at).slice(0, ORCHARD_MAX);
  const rank = k => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const keys = [...new Set(all.map(t => t.key))].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const trees = [], signs = [];
  let c = 0;
  for (const key of keys) {
    const mine = all.filter(t => t.key === key), f = fields.find(x => x.key === key), span = Math.ceil(mine.length / 2);
    if (c + span > cols.length) break; // no more room: the newest repos' blocks fit
    signs.push({ key, name: f?.name ?? key, count: (f?.prs?.recent ?? []).length, x: cols[c], y: pa.y1 + 8 });
    mine.forEach((t, k) => trees.push({ key, x: cols[c + Math.floor(k / 2)], y: rows[k % 2], size: sizeOf(t.at, now) }));
    c += span + 1; // a free column between blocks
  }
  return { trees, signs };
}
/** Fruit on the orchard's trees for a season (blossom in spring, apples in summer, orange in autumn, none in winter):
 *  { colour, at: [{ x, y, h }] }, six a tree round its crown (x, y on the map; h metres up). */
const FRUIT = { spring: '#f6c6c0', summer: '#e04a3a', autumn: '#e9a23b' };
export function fruitOf(trees, season) {
  const colour = FRUIT[season] ?? null;
  if (!colour) return { colour: null, at: [] };
  return {
    colour,
    at: trees.flatMap(t => Array.from({ length: 6 }, (_, k) => {
      const a = k * 1.05 + (t.x % 7), r = 1.0 * t.size * 8; // round the crown (a full tree's about 3 m across), in px
      return { x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r * 0.8, h: (2.9 + (k % 3) * 0.5) * t.size + 0.3 };
    })),
  };
}
