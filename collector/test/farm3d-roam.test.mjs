// The 3D farm's animals keep to their ground (web/worlds/farm3d/roam.js): off the water, out of the trees and inside
// the fences, their bodies and not just their middles, whatever they get up to (antics.js), on every size of farm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID_CONFIG, LILY_PADS, POND, forestOf, pastureOf } from '../../web/worlds/farm3d/layout.js';
import { roamOf } from '../../web/worlds/farm3d/roam.js';
import { HERDS, advance, command, makeAnimal, menuFor } from '../../web/worlds/farm3d/antics.js';
import { MODELS } from '../../web/worlds/farm3d/models/index.js';

const groundOf = rows => { const GRID = GRID_CONFIG.fence(rows); return { GRID, rows, H: GRID_CONFIG.height(GRID) }; };
const seeded = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
// each animal's half-length on the farm in 2D px (8 a metre), as build/animals.js measures it from its model, rounded up
const BODY = { cow: 16, bull: 18, alpaca: 9, donkey: 10, horse: 14, whitehorse: 14, husky: 7, shiba: 6, deer: 10, stag: 11, fox: 8, wolf: 12, frog: 3, trout: 4, koi: 4, roach: 4 };
const inPond = (x, y, r) => ((x - POND.cx) / (POND.rx + r)) ** 2 + ((y - POND.cy) / (POND.ry + r)) ** 2 < 1;

test("the herds: every animal of the pack and the pond's, each with a ground to roam (the frog its lily pads, the fish the water)", () => {
  assert.deepEqual([...new Set(HERDS.map(h => h.kind))].sort(), Object.keys(MODELS).filter(k => MODELS[k].family !== 'still').sort());
  assert.equal(HERDS.reduce((n, h) => n + h.n, 0), 18);
  for (const h of HERDS) assert.equal(h.area, { frog: 'pond', fish: 'water' }[MODELS[h.kind].family] ?? h.area, h.kind);
  for (const h of HERDS) assert.ok(['pasture', 'yard', 'edge', 'pond', 'water'].includes(h.area), h.kind);
});

test("the pond: a fish's places are in the water clear of its bank, the frog's on a lily pad, and nothing on land goes in", () => {
  const roam = roamOf(groundOf(3)), rand = seeded(5);
  assert.ok(LILY_PADS.length >= 4 && LILY_PADS.every(([x, y]) => inPond(x, y, -8)), 'the pads float well inside the pond');
  for (let i = 0; i < 100; i++) {
    const [x, y] = roam.spot('water', rand, { r: BODY.koi });
    assert.ok(inPond(x, y, -BODY.koi - 3), `a fish at ${x},${y}, by the bank`);
    const pad = roam.spot('pond', rand, { r: BODY.frog });
    assert.ok(LILY_PADS.some(([px, py]) => Math.hypot(pad[0] - px, pad[1] - py) < 0.5), `the frog at ${pad}, off its pads`);
    for (const area of ['pasture', 'yard', 'edge']) { const [lx, ly] = roam.spot(area, rand, { r: 6 }); assert.ok(!inPond(lx, ly, 6), `${area} at ${lx},${ly}`); }
  }
});

test('a way across the pond is refused, and a spot picked from beside it is never in it or reached through it', () => {
  const roam = roamOf(groundOf(3)), rand = seeded(7), r = BODY.husky;
  const north = [POND.cx, POND.cy - POND.ry - 14], south = [POND.cx, POND.cy + POND.ry + 14];
  assert.ok(roam.inside('yard', ...north, r) && roam.inside('yard', ...south, r), 'both banks are yard');
  assert.equal(roam.clear('yard', north, south, r), false);
  assert.equal(roam.inside('yard', POND.cx, POND.cy, 0), false);
  for (let i = 0; i < 200; i++) {
    const to = roam.spot('yard', rand, { from: north, r });
    assert.ok(roam.inside('yard', ...to, r) && !inPond(...to, r), `${to} in the pond`);
    for (let k = 0; k <= 20; k++) assert.ok(!inPond(north[0] + (to[0] - north[0]) * k / 20, north[1] + (to[1] - north[1]) * k / 20, r - 1), `the way to ${to} crosses the pond`);
  }
});

test('every ground has room for its biggest animal on every size of farm, the forest edge between the pasture fence and the trees', () => {
  for (let rows = GRID_CONFIG.minRows; rows <= GRID_CONFIG.maxRows; rows++) {
    const L = groundOf(rows), roam = roamOf(L), rand = seeded(rows), pa = pastureOf(L), crowns = forestOf(L.H).map(([x, y, r]) => [x, y, r * 1.25]);
    for (const h of HERDS) for (let i = 0; i < 40; i++) {
      const r = BODY[h.kind], [x, y] = roam.spot(h.area, rand, { r });
      assert.ok(roam.inside(h.area, x, y, r), `${rows} rows: the ${h.kind} at ${x},${y}`);
      if (h.area === 'edge') {
        assert.ok(y - r > pa.y1, `${rows} rows: the ${h.kind}'s body over the pasture fence`);
        for (const [tx, ty, tr] of crowns) assert.ok(Math.hypot(x - tx, y - ty) > tr + r - 0.5, `${rows} rows: the ${h.kind} in a tree at ${tx},${ty}`);
      }
    }
  }
});

test('an hour of the farm: whatever they do, by habit or asked, no body touches the water, a tree or a fence', () => {
  for (const rows of [GRID_CONFIG.minRows, GRID_CONFIG.maxRows]) {
    const L = groundOf(rows), roam = roamOf(L), rand = seeded(rows * 11), pa = pastureOf(L), crowns = forestOf(L.H).map(([x, y, r]) => [x, y, r * 1.25]);
    const env = { resting: false, rand, habitChance: 0.5, duration: () => 1.2, spot: (area, from, far, r) => roam.spot(area, rand, { from, far, r }), inside: roam.inside, clear: roam.clear };
    const herd = HERDS.flatMap(h => Array.from({ length: h.n }, () => {
      const [x, y] = roam.spot(h.area, rand, { r: BODY[h.kind] });
      return makeAnimal({ ...h, family: MODELS[h.kind].family, r: BODY[h.kind] }, x, y, rand);
    }));
    let acts = 0;
    for (let t = 0; t < 3600; t += 0.1) {
      if (Math.round(t * 10) % 150 === 0) for (const a of herd) if (rand() < 0.3) { const m = menuFor(a.kind, a.family); command(a, m[Math.floor(rand() * m.length)], env); acts++; }
      for (const a of herd) {
        advance(a, 0.1, env);
        const { x, y, r } = a, where = `${rows} rows, ${t.toFixed(1)} s: the ${a.kind} (${a.act ?? a.part}) at ${x.toFixed(1)},${y.toFixed(1)}`;
        if (a.area === 'pond') { if (!a.cur?.jump && !a.under) assert.ok(LILY_PADS.some(([px, py]) => Math.hypot(x - px, y - py) < 0.5), `${where}: off its pads`); continue; }
        assert.ok(roam.inside(a.area, x, y, r - 1), where);
        if (a.area === 'pasture') assert.ok(x - r > pa.x0 && x + r < pa.x1 && y - r > pa.y0 && y + r < pa.y1, `${where}: through the pasture's fence`);
        if (a.area === 'yard') assert.ok(!inPond(x, y, r - 1), `${where}: in the pond`);
        if (a.area === 'edge') {
          assert.ok(y - r > pa.y1 - 1, `${where}: through the pasture's fence`);
          for (const [tx, ty, tr] of crowns) assert.ok(Math.hypot(x - tx, y - ty) > tr + r - 1, `${where}: in a tree`);
        }
        if (a.stick && !a.stick.held) assert.ok(roam.inside(a.area, ...a.stick.at, 0), `${where}: its stick landed off its ground`);
      }
    }
    assert.ok(acts > 500, `${acts} things asked of them`);
  }
});

test('left alone they wander: walks bend, paces and rests spread, and two days differ', () => {
  const L = groundOf(4), roam = roamOf(L);
  const day = seed => {
    const rand = seeded(seed), env = { resting: false, rand, habitChance: 0, duration: () => 1, spot: (area, from, far, r) => roam.spot(area, rand, { from, far, r }), inside: roam.inside, clear: roam.clear };
    const h = HERDS.find(x => x.kind === 'horse'), [x, y] = roam.spot('pasture', rand, { r: BODY.horse });
    const a = makeAnimal({ ...h, family: 'hooves', r: BODY.horse }, x, y, rand);
    const paces = new Set(), rests = [];
    let resting = false, restStart = 0, longest = 0;
    for (let t = 0; t < 1800; t += 0.1) {
      advance(a, 0.1, env);
      if (a.part === 'walk') paces.add(a.pace.toFixed(2));
      if (a.path.length) longest = Math.max(longest, a.path.length + 1);
      if (a.rest > 0 && !resting) { resting = true; restStart = t; }
      if (a.rest <= 0 && resting) { resting = false; rests.push(t - restStart); }
    }
    return { at: [a.x, a.y], paces, rests, longest };
  };
  const one = day(1), two = day(2);
  assert.ok(one.longest >= 2, 'a walk goes by more than one point');
  assert.ok(one.paces.size >= 5, `paces: ${[...one.paces]}`);
  assert.ok(Math.min(...one.rests) < 3 && Math.max(...one.rests) > 15, `rests from ${Math.min(...one.rests).toFixed(1)} to ${Math.max(...one.rests).toFixed(1)} s`);
  assert.notDeepEqual(one.at, two.at, 'another day, another wander');
});
