// The 3D farm's animals keep to their ground (web/worlds/farm3d/roam.js): off the water, out of the trees and inside
// the fences, their bodies and not just their middles, whatever they get up to (antics.js), on every size of farm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BED, CORR, FARMSTEAD, GRID_CONFIG, LILY_PADS, PASTURE_GATES, POND, WALKWAY_GATES, forestOf, pastureOf } from '../../web/worlds/farm3d/layout.js';
import { roamOf } from '../../web/worlds/farm3d/roam.js';
import { HERDS, advance, command, makeAnimal, menuFor, reachOf } from '../../web/worlds/farm3d/antics.js';
import { MODELS } from '../../web/worlds/farm3d/models/index.js';

const groundOf = rows => { const GRID = GRID_CONFIG.fence(rows); return { GRID, rows, H: GRID_CONFIG.height(GRID) }; };
const seeded = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
// each animal's half-length on the farm in 2D px (8 a metre), as build/animals.js measures it from its model, rounded up
const BODY = { cow: 16, bull: 18, alpaca: 9, donkey: 10, horse: 14, whitehorse: 14, husky: 7, shiba: 6, deer: 10, stag: 11, fox: 8, wolf: 12, frog: 3, trout: 4, koi: 4, roach: 4 };
const inPond = (x, y, r) => ((x - POND.cx) / (POND.rx + r)) ** 2 + ((y - POND.cy) / (POND.ry + r)) ** 2 < 1;
/** Every field patch of a farm of `rows` (a bed or an empty slot): the grid's slots, as model.js lays them. */
const patchesOf = rows => Array.from({ length: rows * 3 }, (_, k) => { const cx = GRID_CONFIG.cx0 + (k % 3) * GRID_CONFIG.colW, s = GRID_CONFIG.slot(cx, GRID_CONFIG.top0 + Math.floor(k / 3) * GRID_CONFIG.rowH); return { x0: s.x0, y0: s.y0, lane: s.lane }; });
/** A fence along y from x0 to x1, less its gates, as lines. */
const alongX = (x0, x1, y, gates) => { const out = []; let from = x0; for (const [a, b] of [...gates].sort((p, q) => p[0] - q[0])) { out.push([from, y, a, y]); from = b; } out.push([from, y, x1, y]); return out; };
/** The fence round the fields as lines: gates 5 m wide where the walkways meet the lane and the pasture, the farmers' gaps on the yard's side. */
const fieldFenceOf = (G, rows) => {
  const lanes = [...new Set(patchesOf(rows).map(p => p.lane))].sort((a, b) => a - b);
  const left = []; let fy = G.y0; for (const y of lanes) { left.push([G.x0, fy, G.x0, y - 4]); fy = y + 5; } left.push([G.x0, fy, G.x0, G.y1]);
  return [...alongX(G.x0, G.x1, G.y0, WALKWAY_GATES), ...alongX(G.x0, G.x1, G.y1, WALKWAY_GATES), ...left, [G.x1, G.y0, G.x1, G.y1]];
};

test("the herds: every animal of the pack and the pond's, each with a ground to roam (the frog its lily pads, the fish the water)", () => {
  assert.deepEqual([...new Set(HERDS.map(h => h.kind))].sort(), Object.keys(MODELS).filter(k => !['still', 'person', 'crop', 'vehicle'].includes(MODELS[k].family)).sort());
  assert.equal(HERDS.filter(h => !h.only).reduce((n, h) => n + h.n, 0), 18, 'and three more with a neighbour farm (farm3d-neighbour.test.mjs)');
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

test('an hour of the farm: they roam it all, the walkways and headlands between the fields too, by habit or asked, and no body touches the water, a tree, a building, a field or a fence (but at its gates)', () => {
  for (const rows of [GRID_CONFIG.minRows, GRID_CONFIG.maxRows]) {
    const L = groundOf(rows), roam = roamOf(L), rand = seeded(rows * 11), pa = pastureOf(L), crowns = forestOf(L.H).map(([x, y, r]) => [x, y, r * 1.25]), G = L.GRID;
    const env = { resting: false, rand, habitChance: 0.5, duration: () => 1.2, spot: (area, from, far, r, o) => roam.spot(area, rand, { from, far, r, ...o }), inside: roam.inside, clear: roam.clear, route: roam.route };
    const herd = HERDS.filter(h => !h.only).flatMap(h => Array.from({ length: h.n }, () => { // one farm: the 18, all yours (build/animals.js)
      const [x, y] = roam.spot(h.area, rand, { r: BODY[h.kind] });
      return makeAnimal({ ...h, family: MODELS[h.kind].family, r: BODY[h.kind], farm: 0 }, x, y, rand);
    }));
    const home = new Map(herd.map(a => [a, 0])), away = new Set();
    // the pasture's fence, less its gates, as lines; how far a point is from one
    const fenceLines = [...alongX(pa.x0, pa.x1, pa.y0, [PASTURE_GATES.top, ...WALKWAY_GATES]), [pa.x0, pa.y1, PASTURE_GATES.bottom[0], pa.y1], [PASTURE_GATES.bottom[1], pa.y1, pa.x1, pa.y1], [pa.x0, pa.y0, pa.x0, pa.y1], [pa.x1, pa.y0, pa.x1, pa.y1], ...fieldFenceOf(G, rows)];
    const patches = patchesOf(rows), big = new Set(['cow', 'bull', 'alpaca', 'donkey', 'horse', 'whitehorse', 'deer', 'stag']), among = new Set();
    const toLine = (x, y, [x0, y0, x1, y1]) => { const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - x0 - t * dx, y - y0 - t * dy); };
    let acts = 0, ticks = 0;
    for (let t = 0; t < 3600; t += 0.1) {
      ticks++;
      if (Math.round(t * 10) % 150 === 0) for (const a of herd) if (rand() < 0.3) { const m = menuFor(a.kind, a.family); command(a, m[Math.floor(rand() * m.length)], env); acts++; }
      for (const a of herd) {
        advance(a, 0.1, env);
        const { x, y } = a, where = `${rows} rows, ${t.toFixed(1)} s: the ${a.kind} (${a.act ?? a.part}) at ${x.toFixed(1)},${y.toFixed(1)}`;
        if (a.area === 'pond') { if (!a.cur?.jump && !a.under) assert.ok(LILY_PADS.some(([px, py]) => Math.hypot(x - px, y - py) < 0.5), `${where}: off its pads`); continue; }
        if (a.area === 'water') { assert.ok(roam.inside('water', x, y, a.r - 1), where); continue; }
        const r = reachOf(a); // about the farm it is as wide as it is (it walks lengthways)
        assert.ok(roam.inside('farm', x, y, r - 1), where);
        if (roam.inside(a.area, x, y, 0)) home.set(a, home.get(a) + 1); else away.add(a);
        assert.ok(!inPond(x, y, r - 1), `${where}: in the pond`);
        for (const [tx, ty, tr] of crowns) assert.ok(Math.hypot(x - tx, y - ty) > tr + r - 1, `${where}: in a tree`);
        for (const f of fenceLines) assert.ok(toLine(x, y, f) > r - 1, `${where}: through the pasture's fence`);
        for (const b of FARMSTEAD) assert.ok(!(x > b.x - r + 1 && x < b.x + b.w + r - 1 && y > b.y - r + 1 && y < b.y + b.h + r - 1), `${where}: in a building`);
        for (const p of patches) assert.ok(!(x > p.x0 - r + 1 && x < p.x0 + BED.w + r - 1 && y > p.y0 - r + 1 && y < p.y0 + BED.d + r - 1), `${where}: on a field`);
        if (x > G.x0 && x < G.x1 && y > G.y0 && y < G.y1 && big.has(a.kind)) among.add(a.kind); // the walkways and headlands, between the fields
      }
    }
    assert.ok(acts > 500, `${acts} things asked of them`);
    assert.ok(among.size >= 2, `${rows} rows: big animals among the fields: ${[...among].join(', ') || 'none'}`);
    assert.ok(away.size >= 4, `${away.size} roamed off their own ground`);
    for (const [a, n] of home) if (a.area !== 'pond' && a.area !== 'water') assert.ok(n / ticks > 0.2, `${rows} rows: the ${a.kind} at home ${(100 * n / ticks).toFixed(0)}% of the time`);
  }
});

test('a way round: from the yard into the pasture through its gate, on to the forest through the other; from the pasture up into a walkway through the gates between them, a cow as well as a Shiba', () => {
  const L = groundOf(4), roam = roamOf(L), rand = seeded(8), pa = pastureOf(L), G = L.GRID;
  const walk = (from, path, r) => { let at = from; for (const p of path) { assert.ok(roam.clear('farm', at, p, r), `${at} → ${p}`); at = p; } return at; };
  const crossed = (from, path, fy) => { let at = from; for (const p of path) { if ((at[1] - fy) * (p[1] - fy) <= 0) return at[0] + ((fy - at[1]) / (p[1] - at[1] || 1)) * (p[0] - at[0]); at = p; } return null; };
  const cow = reachOf({ r: BODY.cow }), shiba = reachOf({ r: BODY.shiba });
  const yard = roam.spot('yard', rand, { r: BODY.cow }), pasture = roam.spot('pasture', rand, { r: BODY.cow }), edge = roam.spot('edge', rand, { r: BODY.cow });
  const into = roam.route(yard, pasture, cow);
  assert.ok(into?.length, 'the cow finds a way into the pasture');
  walk(yard, into, cow);
  const x0 = crossed(yard, into, pa.y0);
  assert.ok(x0 > PASTURE_GATES.top[0] && x0 < PASTURE_GATES.top[1], `through the top gate (at ${x0})`);
  const out = roam.route(pasture, edge, cow);
  assert.ok(out?.length);
  const x1 = crossed(pasture, out, pa.y1);
  assert.ok(x1 > PASTURE_GATES.bottom[0] && x1 < PASTURE_GATES.bottom[1], `through the bottom gate (at ${x1})`);
  const walkway = [CORR[1] - 4, G.y1 - 100], grazing = [CORR[1] + 60, pa.y0 + 50];
  assert.ok(roam.route(grazing, walkway, shiba)?.length, 'the Shiba fits the walkway');
  const way = roam.route(grazing, walkway, cow);
  assert.ok(way?.length, 'and so does the cow');
  walk(grazing, way, cow);
  for (const fy of [pa.y0, G.y1]) { const xg = crossed(grazing, way, fy); assert.ok(Math.abs(xg - CORR[1]) < 20, `through the gate at ${fy} (at ${xg})`); }
  const headland = [500, GRID_CONFIG.top0 + GRID_CONFIG.rowH + 4];
  assert.ok(roam.inside('farm', headland[0], headland[1], cow), 'a headland between two rows of fields has room for a cow');
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

test("the farm's plants: a forest tree wherever forestOf puts one, the season's variants, the yard's where the layout puts them, the forest floor under the trees' fringe", async () => {
  const { plantsOf } = await import('../../web/worlds/farm3d/nature.js');
  const { BUSHES, SHADE, orchardOf, rocksOf } = await import('../../web/worlds/farm3d/layout.js');
  const STILL = Object.keys(MODELS).filter(k => MODELS[k].family === 'still' && k !== 'lilypad');
  const SNOWY = ['birchsnow', 'birchdead', 'deadtreesnow', 'pinesnow', 'bushsnow', 'rocksnow'], GREEN = ['tree', 'tree2', 'autumntree', 'bush', 'bushberries', 'rockmoss', 'flowers'];
  for (const rows of [GRID_CONFIG.minRows, GRID_CONFIG.maxRows]) for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    const L = groundOf(rows), plants = plantsOf(L, season), forest = forestOf(L.H), crowns = forest.map(([x, y, r]) => [x, y, r * 1.25]);
    const where = `${rows} rows, ${season}`;
    assert.ok(plants.every(p => STILL.includes(p.kind) && p.w > 0 && p.h > 0 && Number.isFinite(p.turn)), `${where}: every plant a model, with a size`);
    assert.equal(plants.filter(p => p.role === 'forest').length, forest.length, `${where}: the forest`);
    assert.ok(plants.filter(p => p.role === 'forest').every((p, k) => p.x === forest[k][0] && p.y === forest[k][1] && p.w <= (forest[k][2] * 1.25 * 2.2) / 8), `${where}: each where forestOf puts it, no wider than roam's crown`);
    assert.ok(plants.some(p => p.role === 'shade' && p.x === SHADE.x && p.y === L.GRID.y1 + SHADE.dy - 10), `${where}: the shade tree over roam's trunk`);
    assert.equal(plants.filter(p => p.role === 'orchard').length, orchardOf(L).length);
    assert.equal(plants.filter(p => p.role === 'bush').length, BUSHES.length);
    assert.equal(plants.filter(p => p.role === 'rock').length, rocksOf(L).length);
    const floor = plants.filter(p => p.role === 'floor');
    assert.ok(floor.length >= 8, `${where}: ${floor.length} things on the forest floor`);
    for (const p of floor) assert.ok(crowns.some(([x, y, r]) => Math.hypot(p.x - x, p.y - y) <= r + 3), `${where}: the ${p.kind} at ${p.x},${p.y} out from under the trees`);
    const kinds = new Set(plants.map(p => p.kind));
    if (season === 'winter') assert.ok(!GREEN.some(k => kinds.has(k)), `${where}: ${[...kinds]}`);
    else assert.ok(!SNOWY.some(k => kinds.has(k)), `${where}: ${[...kinds]}`);
    if (season === 'autumn') assert.ok(kinds.has('autumntree'), `${where}: autumn colours`);
  }
});

test('when its ground moves (a row more), an animal put somewhere new forgets the walk it was on, and stays inside', async () => {
  const { placeAt } = await import('../../web/worlds/farm3d/antics.js');
  const before = roamOf(groundOf(3)), after = roamOf(groundOf(6)), rand = seeded(21);
  const env = { resting: false, rand, habitChance: 0, duration: () => 1, spot: (area, from, far, r) => after.spot(area, rand, { from, far, r }), inside: after.inside, clear: after.clear };
  for (let k = 0; k < 50; k++) {
    const [x, y] = before.spot('pasture', rand, { r: BODY.cow });
    const a = makeAnimal({ kind: 'cow', family: 'hooves', area: 'pasture', walk: 7, run: 40, r: BODY.cow }, x, y, rand);
    a.path = [[x + 40, y], [x + 80, y + 10]]; a.tx = x + 20; a.ty = y; a.looked = true; // mid-walk on the old ground
    const [nx, ny] = after.spot('pasture', rand, { r: BODY.cow });
    placeAt(a, nx, ny);
    assert.deepEqual([a.path, a.looked, a.tx, a.ty], [[], false, nx, ny]);
    for (let t = 0; t < 60; t += 0.1) { advance(a, 0.1, env); assert.ok(after.inside('pasture', a.x, a.y, a.r - 1), `${k}: off its new pasture at ${a.x},${a.y}`); }
  }
});

test("the wind's clock wraps without a jump: every speed in the sway repeats a whole number of times in its period", async () => {
  const { readFileSync } = await import('node:fs');
  const { WIND_PERIOD } = await import('../../web/worlds/farm3d/nature.js');
  const src = readFileSync(new URL('../../web/worlds/farm3d/build/nature.js', import.meta.url), 'utf8');
  const speeds = [...src.matchAll(/uTime \* ([\d.]+)/g)].map(m => Number(m[1]));
  assert.ok(speeds.length >= 3, `${speeds}`);
  for (const w of speeds) { const turns = (w * WIND_PERIOD) / (2 * Math.PI); assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9, `${w} rad/s: ${turns} turns`); }
  assert.match(src, /% WIND_PERIOD/, 'the clock wraps');
});

test('a field a machine is working is busy: no animal picks a place on it or its headland ends, and it is free again after', () => {
  const L = groundOf(3), roam = roamOf(L), rand = seeded(21), [p] = patchesOf(3).slice(4, 5), cow = 10;
  roam.setBusy([p]);
  const onIt = ([x, y]) => x > p.x0 - 26 && x < p.x0 + BED.w + 26 && y > p.y0 - 12 && y < p.y0 + BED.d + 8;
  assert.equal(roam.free('farm', p.x0 - 30, p.y0 + 30, cow), false, 'its walkway end: not a place to stop');
  assert.equal(roam.inside('farm', p.x0 - 30, p.y0 + 30, cow), true, 'though one may walk through (or out)');
  for (let k = 0; k < 300; k++) assert.ok(!onIt(roam.spot('farm', rand, { from: [p.x0 - 20, p.y0 - 30], near: 80, straight: false, r: cow })), 'a place picked near it');
  roam.setBusy([]);
  assert.equal(roam.free('farm', p.x0 - 30, p.y0 + 30, cow), true, 'free again');
});

test('a place picked keeps clear of others (animals, farmers) when there is room', () => {
  const L = groundOf(3), roam = roamOf(L), rand = seeded(5), others = [[120, 230, 16], [140, 240, 6], [100, 250, 14]];
  for (let k = 0; k < 200; k++) {
    const [x, y] = roam.spot('yard', rand, { r: 12, avoid: others });
    for (const [ox, oy, or] of others) assert.ok(Math.hypot(x - ox, y - oy) >= 12 + or + 4 - 1e-9, `${x.toFixed(0)},${y.toFixed(0)} on one at ${ox},${oy}`);
  }
});
