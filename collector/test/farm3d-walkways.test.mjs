// The 3D farm's animals among the fields (the person: "1", and "Animals give way"): they walk the walkways and
// headlands, keep off a field a machine is working, and step out of a machine's way (antics.js stepAside, moveOff;
// machines.js inPathOf). roam.js's side is in farm3d-roam.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BED, CORR, GRID_CONFIG } from '../../web/worlds/farm3d/layout.js';
import { roamOf } from '../../web/worlds/farm3d/roam.js';
import { advance, command, makeAnimal, moveOff, reachOf, stepAside } from '../../web/worlds/farm3d/antics.js';
import { inPathOf } from '../../web/worlds/farm3d/machines.js';

const groundOf = rows => { const GRID = GRID_CONFIG.fence(rows); return { GRID, rows, H: GRID_CONFIG.height(GRID) }; };
const seeded = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const envOf = (roam, rand) => ({ resting: false, rand, habitChance: 0, duration: () => 1, spot: (area, from, far, r, o) => roam.spot(area, rand, { from, far, r, ...o }), inside: roam.inside, clear: roam.clear, route: roam.route });
const cowAt = (x, y, rand) => makeAnimal({ kind: 'cow', family: 'hooves', area: 'pasture', walk: 7, run: 40, r: 16 }, x, y, rand);
const run = (a, s, env) => { for (let t = 0; t < s; t += 0.1) advance(a, 0.1, env); };

test("what is in a machine's path: ahead of it within 5 m and close to its line; the point on its line beside it", () => {
  const m = { x: 100, y: 200, heading: 0, moving: true };
  assert.deepEqual(inPathOf(m, 130, 206), [130, 200]);
  assert.equal(inPathOf(m, 160, 200), null, 'beyond 5 m');
  assert.equal(inPathOf(m, 80, 200), null, 'behind');
  assert.equal(inPathOf(m, 120, 230), null, 'well aside');
  assert.equal(inPathOf({ ...m, moving: false }, 120, 200), null, 'a machine standing still');
  const down = inPathOf({ x: CORR[1], y: 200, heading: Math.PI / 2, moving: true }, CORR[1] + 3, 225);
  assert.ok(Math.abs(down[0] - CORR[1]) < 1e-9 && Math.abs(down[1] - 225) < 1e-9, 'down a walkway');
});

test("a cow in a walkway a tractor is coming down walks clear of its way (into a headland, or back out); one busy with what it was asked does not", () => {
  const L = groundOf(3), roam = roamOf(L), rand = seeded(3), env = envOf(roam, rand), s1 = GRID_CONFIG.slot(GRID_CONFIG.cx0 + GRID_CONFIG.colW, GRID_CONFIG.top0 + GRID_CONFIG.rowH);
  const m = { x: CORR[1], y: s1.y0 - 10, heading: Math.PI / 2, moving: true }, a = cowAt(CORR[1] - 6, s1.y0 + 20, rand);
  assert.ok(roam.inside('farm', a.x, a.y, reachOf(a)), 'it stands in the walkway');
  assert.ok(inPathOf(m, a.x, a.y), "in the tractor's way");
  assert.equal(stepAside(a, m, env), true);
  run(a, 6, env);
  const off = Math.min(...Array.from({ length: 10 }, (_, k) => Math.hypot(a.x - m.x, a.y - (m.y + k * 8)))); // from its way ahead, 72 px of it
  assert.ok(off >= 20, `clear of its way: ${off.toFixed(1)} px, at ${a.x.toFixed(0)},${a.y.toFixed(0)}`);
  assert.ok(roam.inside('farm', a.x, a.y, reachOf(a) - 1), 'somewhere it can be');
  const b = cowAt(CORR[1] - 6, s1.y0 + 20, rand);
  command(b, 'pet', env);
  assert.equal(stepAside(b, m, env), false, 'busy: the tractor waits for it');
});

test('a field turned busy (a machine working it): a cow on its headland end walks off it', () => {
  const L = groundOf(3), roam = roamOf(L), rand = seeded(9), env = envOf(roam, rand);
  const s = GRID_CONFIG.slot(GRID_CONFIG.cx0 + GRID_CONFIG.colW, GRID_CONFIG.top0 + GRID_CONFIG.rowH), a = cowAt(s.x0 - 30, s.y0 + 36, rand);
  assert.ok(roam.inside('farm', a.x, a.y, reachOf(a)), 'it stands in the walkway');
  roam.setBusy([{ x0: s.x0, y0: s.y0 }]);
  assert.equal(moveOff(a, env), true);
  run(a, 8, env);
  assert.ok(!(a.x > s.x0 - 26 && a.x < s.x0 + BED.w + 26 && a.y > s.y0 - 12 && a.y < s.y0 + BED.d + 8), `off it: ${a.x.toFixed(0)},${a.y.toFixed(0)}`);
});
