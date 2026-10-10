// The field exercise (web/worlds/military/): its soldiers (people-kit soldiers in a field jacket of the
// agent's colour, khaki trousers and headgear picked by the agent's id; codex agents with a slate stripe
// down the jacket), the world's registration on the engine, and its base: the sky over a clipped hedge,
// the buildings at the back, the track, the left side's tents, and where every soldier stands. Its
// positions: fortified as the context fills, what each repo's state puts round them, their signs, and
// the news setScene tells (Advanced!, Supplies in!, a deploy failing or going through).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkWorldJson } from '../worlds.mjs';
import { goldenSnapshot } from '../../scripts/golden/fixture.mjs';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function stubDom() { // as in factory.test.mjs: each fillRect is kept with its colour (a sprite's pixels)
  const numbers = new Set(['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight', 'width', 'height', 'length', 'size']);
  const calls = { fillRect: 0, drawImage: 0, rects: [], images: [] }; // images: where each drawImage put its picture, [x, y, w, h]
  const make = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (numbers.has(k)) return t[k] ?? (k === 'offsetWidth' || k === 'width' ? 400 : k === 'offsetHeight' || k === 'height' ? 300 : 0);
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
      if (k === 'style') return (t[k] ??= { setProperty() {}, removeProperty() {} });
      if (k === 'dataset') return (t[k] ??= {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'isConnected') return true;
      if (k === 'hidden' || k === 'open') return t[k] ?? false;
      if (k === 'fillRect') return (x, y, w, h) => { calls.fillRect++; calls.rects.push([t.fillStyle, x, y, w, h]); };
      if (k === 'clearRect') return (x, y, w, h) => { calls.rects.push([null, x, y, w, h]); };
      if (k === 'drawImage') return (img, ...a) => { calls.drawImage++; calls.images.push(a.length === 8 ? a.slice(4) : a.slice(0, 4)); };
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getContext') return () => ctx;
      if (k === 'measureText') return () => ({ width: 0 });
      return (t[k] ??= make());
    },
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => make(),
  });
  const ctx = make();
  return { make, calls, document: Object.assign(make(), { hidden: false }) };
}
/** The SDK and the field exercise in a vm; the hooks it gives the engine are kept as window.hooks. `wrap(hooks)` may change them before the engine takes them (to watch one). */
function load({ wrap = null } = {}) {
  const dom = stubDom();
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} });
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js']) vm.runInContext(web(f), ctx, { filename: f });
  const engineWorld = window.Agentville.world;
  window.Agentville.world = hooks => { window.hooks = hooks; wrap?.(hooks); return engineWorld(hooks); };
  vm.runInContext(web('worlds/military/world.js'), ctx, { filename: 'worlds/military/world.js' });
  return { window, dom, ctx, M: window.AgentvilleMilitary, people: window.Agentville.people };
}
/** The colour each pixel of a fresh sprite was painted, by "x,y" (what is cleared after is gone). */
function pixelsOf(dom, draw) {
  dom.calls.rects.length = 0;
  draw();
  const out = new Map();
  for (const [c, x0, y0, w, h] of dom.calls.rects) for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) { if (c === null) out.delete(`${x},${y}`); else out.set(`${x},${y}`, c); }
  return out;
}
/** Where a look's rows have one of `letters`, as "x,y". */
const lettersAt = (rows, letters) => rows.flatMap((r, y) => [...r].flatMap((ch, x) => (letters.includes(ch) ? [`${x},${y}`] : [])));
const VIEWS = ['down', 'up', 'right', 'left'];
const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const SLATE = '#5f6b7a';

/* ---------- the soldiers ---------- */

test("the outfit: a jacket, khaki trousers, headgear from helmet, beret and cap in olive and khaki, a radio on some", () => {
  const { M } = load();
  assert.deepEqual(plain(M.OUTFIT), {
    hat: ['helmet', 'beret', 'cap'],
    hatColors: { helmet: [['#5b6b3a', '#3c4a26'], ['#6b7a45', '#46532c']], beret: [['#2f5a2a', '#1e3a1b'], ['#7a2a2a', '#4e1a1a'], ['#2c4a85', '#1c3058']], cap: [['#8a7a52', '#5e5236'], ['#6b7a45', '#46532c']] },
    top: 'jacket', bottom: 'trousers', bottomColors: ['#a08a5a', '#8e7a4e'], extra: ['none', 'none', 'none', 'radio'],
  });
});

test("a soldier's look comes from its id (the people kit's lookFor with the outfit): the same agent is the same soldier", () => {
  const { M, people } = load();
  assert.deepEqual(plain(M.lookOf({ id: 'x' })), plain(M.lookOf({ id: 'x' })));
  for (const id of [...IDS, 'x', 'g-ask', 'codex:g1']) {
    const look = M.lookOf({ id });
    assert.deepEqual(plain(look), { ...plain(people.lookFor({ id }, M.OUTFIT)), codex: false }, `${id}: the kit's look, not codex`);
    assert.equal(look.top, 'jacket', `${id}: a jacket`);
    assert.equal(look.bottom, 'trousers', `${id}: trousers`);
    assert.ok(M.OUTFIT.hat.includes(look.hat), `${id}: headgear from the outfit (${look.hat})`);
    assert.ok(M.OUTFIT.hatColors[look.hat].some(([h, b]) => h === look.hatColor && b === look.band), `${id}: its headgear's colours are its kind's (${look.hat})`);
    assert.ok(M.OUTFIT.bottomColors.includes(look.bottomColor), `${id}: khaki trousers (${look.bottomColor})`);
    assert.ok(['none', 'radio'].includes(look.extra), `${id}: ${look.extra}`);
  }
  const hats = new Set(IDS.map(id => M.lookOf({ id }).hat));
  assert.ok(hats.size >= 2, `eight ids: at least two kinds of headgear (${[...hats]})`);
  assert.equal(M.lookOf({ id: 'x', kind: 'codex' }).codex, true, 'codex agents are marked');
  assert.deepEqual(plain({ ...M.lookOf({ id: 'x', kind: 'codex' }), codex: false }), plain(M.lookOf({ id: 'x' })), 'and otherwise dressed as anyone with their id');
});

test("the jacket is the agent's colour, exact, in every view (read back from the sprite's paint)", () => {
  const { M, people, dom } = load();
  // list colours, none of them the pixel kit's: the kit would snap them if they weren't kept exact (one each, so no sprite is cached yet)
  for (const [id, shirt] of [['a', '#4a7bd0'], ['b', '#8a6fd8'], ['c', '#c99a16']]) {
    const look = M.lookOf({ id });
    for (const view of VIEWS) {
      const paint = pixelsOf(dom, () => M.soldierSprite(look, shirt, { view }));
      const jacket = lettersAt(plain(people.rows(look, view, 's')), 'C');
      assert.ok(jacket.length >= 8, `${id} ${view}: a jacket (${jacket.length} pixels)`);
      for (const at of jacket) assert.equal(paint.get(at), shirt, `${id} ${view}: the jacket at ${at}`);
    }
  }
  const s = M.soldierSprite(M.lookOf({ id: 'a' }), '#4a7bd0', { view: 'right', legs: 'a' });
  assert.equal(s.width, 14);
  assert.equal(s.height, 16);
  for (const odd of [undefined, null, '', 'red']) for (const kind of ['interactive', 'codex']) assert.doesNotThrow(() => M.soldierSprite(M.lookOf({ id: 'a', kind }), odd), `no colour to speak of (${odd}, ${kind}): drawn, not thrown`);
});

test('a codex soldier has a slate stripe down its jacket, in every view; no one else does', () => {
  const { M, people, dom } = load();
  const shirt = '#d9673a', codex = M.lookOf({ id: 'x', kind: 'codex' }), other = M.lookOf({ id: 'x' });
  const stripes = {};
  for (const view of VIEWS) {
    const jacket = lettersAt(plain(people.rows(codex, view, 's')), 'Cc');
    const paint = pixelsOf(dom, () => M.soldierSprite(codex, shirt, { view }));
    stripes[view] = jacket.filter(at => paint.get(at) === SLATE);
    const stripe = stripes[view].map(at => at.split(',').map(Number));
    assert.ok(stripe.length >= 3, `${view}: a stripe (${stripe.length} slate pixels on the jacket)`);
    const rows = new Set(stripe.map(([, y]) => y)), cols = new Set(stripe.map(([x]) => x));
    assert.ok(rows.size >= 3, `${view}: it runs down the jacket (rows ${[...rows]})`);
    assert.ok(cols.size <= 2, `${view}: as a stripe, one or two pixels wide (columns ${[...cols]})`);
    assert.ok(jacket.filter(at => paint.get(at) === shirt).length > stripe.length, `${view}: the rest of the jacket is the agent's colour`);
    const plainPaint = pixelsOf(dom, () => M.soldierSprite(other, shirt, { view }));
    assert.equal(jacket.filter(at => plainPaint.get(at) === SLATE).length, 0, `${view}: not codex, no stripe`);
  }
  const waving = pixelsOf(dom, () => M.soldierSprite(codex, shirt, { view: 'down', wave: true }));
  assert.ok(stripes.down.every(at => waving.get(at) === SLATE), 'waving, the stripe stays');
  assert.equal(M.soldierSprite(codex, shirt, { view: 'up' }), M.soldierSprite(codex, shirt, { view: 'up' }), 'made once');
  assert.notEqual(M.soldierSprite(codex, shirt, { view: 'up' }), M.soldierSprite(codex, shirt, { view: 'down' }), 'each view its own');
});

/* ---------- the world ---------- */

test('the field exercise registers on the engine, gives each soldier its look, places everyone, and draws them', () => {
  const { window, dom, M } = load();
  assert.ok(window.registered, 'it registered with Agentville.world');
  const h = window.hooks;
  assert.equal(h.W, 400);
  assert.equal(h.SH, 16);
  assert.deepEqual(plain(h.nouns), { agent: 'soldier', agents: 'soldiers', repo: 'position', repos: 'positions', place: 'base' });
  assert.deepEqual(plain(h.seasonNames), { switch: 'Alert', spring: 'calm', summer: 'ready', autumn: 'high', winter: 'max' });
  assert.equal(h.coldSeason, null, 'no level is cold: the mascots never act cold at max alert');
  assert.equal(h.fromScene, M.militaryScene);
  window.registered.start({ el: dom.make(), opts: { still: true }, prefs: { get: () => null, set() {} } });
  const scene = window.AgentvilleScene.toScene(goldenSnapshot());
  window.registered.scene(scene);
  assert.ok(dom.calls.fillRect > 0, 'it drew its ground');
  assert.ok(dom.calls.drawImage > 0, 'it drew soldiers');
  const e = M.militaryScene(scene), farmers = e.farmers;
  assert.equal(farmers.length, 11);
  for (const f of farmers) assert.deepEqual(plain(f.look), plain(M.lookOf(f)), `${f.name}: its look`);
  assert.ok(farmers.some(f => f.look.codex) && farmers.some(f => !f.look.codex), 'the codex agent is marked, the others not');
  h.relayout(h.grid.layoutFor(e.fields));
  const positions = new Set(h.layout().ST.map(s => s.key));
  for (const f of farmers) {
    const s = h.slots(f), at = s.group.startsWith('st:') ? s.at([]) : s.at(0);
    assert.ok(s.zone && at.length === 2 && at.every(Number.isFinite), `${f.name} has a place (${s.group})`);
    if (f.state === 'working' && positions.has(f.field)) assert.equal(s.group, `st:${f.field}`, `${f.name}: at its position`);
    else if (f.state === 'waiting' || f.state === 'turn') assert.ok(at[1] >= 74 && at[1] <= 92, `${f.name}: at HQ, on the track (y ${at[1]})`);
    else assert.ok(at[0] >= 4 && at[0] <= 110 && at[1] > 92, `${f.name}: on the left side (${at})`);
  }
});

test('its world.json is valid, in drill words, and says dogs and pigeons are taken', () => {
  const j = JSON.parse(web('worlds/military/world.json'));
  assert.equal(checkWorldJson(j), null);
  assert.equal(j.name, 'Field exercise');
  assert.equal(j.icon, '🎖️');
  assert.equal(j.description, 'Every agent a soldier, every repo a position');
  assert.deepEqual(j.taken, ['dog', 'pigeon']);
  assert.deepEqual(j.nouns, { agent: 'soldier', agents: 'soldiers', repo: 'position', repos: 'positions', start: 'motor pool', diary: 'Field log' });
});

/* ---------- the base, its tents, and where every soldier stands ---------- */

const TOUR_NOW = Date.UTC(2026, 9, 9, 9, 0), SHOP = '/Users/you/code/shop';
const person = (id, over = {}) => ({
  id, kind: 'interactive', name: id, cwd: SHOP, state: 'working', stateReason: 'busy', stateSince: TOUR_NOW - 60_000, feed: [], children: [], touching: [],
  contextTokens: 40_000, usage: { costUsd: 0.4 }, mode: 'default', model: 'claude-sonnet-5-5', modelLabel: 'Sonnet 5.5', now: { tool: 'Edit', summary: 'src/a.ts', step: 'edit', startedAt: TOUR_NOW - 1000 }, ...over,
});
/** A crowded day: more of each kind than its place holds (5 waiting, 4 your turn, 6 idle, 6 stale, 3 asleep, 6 with no repo), and 2 at a position. */
function crowd({ prs = null, plan = null, children = [] } = {}) {
  const many = (n, prefix, over) => Array.from({ length: n }, (_, i) => person(`${prefix}${i}`, over));
  const agents = [
    ...many(5, 'w', { state: 'waiting', stateReason: 'permission', ask: { kind: 'permission', toolUseId: 't1', tool: 'Bash', summary: 'npm publish' }, now: null }),
    ...many(4, 't', { state: 'yourTurn', lastReply: 'Done: the tests pass.', now: null }),
    ...many(6, 'i', { state: 'idle', stateReason: 'idle', now: null }),
    ...many(6, 's', { state: 'stale', stateReason: 'stale', now: null }),
    ...many(3, 'n', { state: 'yourTurn', now: null, wakeAt: TOUR_NOW + 20 * 60_000 }),
    ...many(6, 'f', { cwd: '/Users/you/elsewhere' }),
    ...many(2, 'b', { children }),
  ];
  return { generatedAt: TOUR_NOW, agents, collisions: [], plan, repos: [{ path: SHOP, name: 'shop', branch: 'main', dirty: 0, ahead: 0, behind: 0, lastDeploy: null, prs, agentIds: agents.map(a => a.id) }] };
}
const PR12 = { number: 12, title: 'New cart', url: 'https://github.com/you/shop/pull/12', checks: 'ok', draft: false };
const busyDay = () => crowd({ prs: { open: [PR12], merged: [{ number: 9, title: 'Old cart', url: 'https://github.com/you/shop/pull/9', at: TOUR_NOW }] },
  plan: { windows: [{ kind: 'five_hour', percentUsed: 40, resetsAt: TOUR_NOW + 3_600_000 }, { kind: 'seven_day', percentUsed: 75, resetsAt: TOUR_NOW + 86_400_000 }] },
  children: [{ id: 'c1', kind: 'subagent', state: 'running', label: 'Look around', agentType: 'Explore', startedAt: TOUR_NOW }] });
const PLACES = { desk: 3, turn: 3, charge: 4, storage: 4, nap: 2, floor: 4 };
const STATE_OF = { desk: 'waiting', turn: 'turn', charge: 'idle', storage: 'stale', nap: 'turn', floor: 'working' };
/** The i-th place of a group, from the world's slots. */
const placeOf = (h, group, i) => plain(h.slots({ id: 'x', state: STATE_OF[group], nap: group === 'nap', field: null }).at(i));
/** Two soldiers (14 × 16, standing on their feet) whose boxes overlap. */
const overlap = ([ax, ay], [bx, by]) => Math.abs(ax - bx) < 14 && Math.abs(ay - by) < 16;

test('slots: waiting at HQ (3), reporting back at its right (3), idle at the mess tent (4), stale by the reserve tents (4), asleep on the cots (2), no repo on the drill ground (4)', () => {
  const { window, M } = load();
  const h = window.hooks, L = h.relayout(h.grid.layoutFor([{ key: SHOP, name: 'shop' }]));
  const of = (f, group, cap) => {
    const s = h.slots({ id: 'x', ...f });
    assert.equal(s.group, group, JSON.stringify(f));
    assert.equal(s.zone, group);
    assert.equal(s.cap, cap, `${group} holds ${cap}`);
    return Array.from({ length: cap }, (_, i) => plain(s.at(i)));
  };
  const at = {
    desk: of({ state: 'waiting' }, 'desk', 3), turn: of({ state: 'turn' }, 'turn', 3), charge: of({ state: 'idle' }, 'charge', 4),
    storage: of({ state: 'stale' }, 'storage', 4), nap: of({ state: 'turn', nap: true }, 'nap', 2), floor: of({ state: 'working', field: null }, 'floor', 4),
  };
  assert.deepEqual(at.desk, [[150, 80], [170, 80], [190, 80]], 'the queue at HQ, on the track, 20 apart');
  assert.deepEqual(at.turn, [[250, 80], [230, 80], [210, 80]], 'reporting back: at HQ, from its right, 20 apart');
  assert.deepEqual(plain(h.slots({ state: 'idle', nap: true }).at(1)), at.nap[1], 'an idle session that wakes by itself sleeps on a cot too');
  assert.deepEqual(plain(h.slots({ state: 'working', field: '/Users/you/gone' }).at(0)), at.floor[0], 'working in a repo with no position (more than 18): the drill ground');
  assert.equal(h.slots({ state: 'working', field: SHOP, step: 'edit' }).group, `st:${SHOP}`, 'working in a repo: at its position');
  assert.deepEqual(plain(h.spawn()), [62, 80], 'reinforcements jump down at the motor pool gate');
  // Every place: in the world, its feet on no building, off the positions; HQ's on the track, the rest on the left side. No two overlap, the vehicle park's too.
  const all = [...Object.entries(at).flatMap(([g, list]) => list.map(p => [g, p])), ...M.PARK.map(p => ['park', plain(p)])];
  for (const [g, [x, y]] of all) {
    assert.ok(x >= 7 && x <= h.W - 7 && y >= 16 && y <= L.H, `${g} ${x},${y}: in the world`);
    assert.equal(h.buildingAt(x, y), null, `${g} ${x},${y}: its feet on the ground, not in a building`);
    assert.ok(x + 7 < L.GRID.x0 || x - 7 > L.GRID.x1 || y < L.GRID.y0 || y - 16 > L.GRID.y1, `${g} ${x},${y}: off the positions`);
    if (g === 'desk' || g === 'turn') assert.ok(y >= 74 && y <= 92, `${g}: on the track`);
    else assert.ok(x >= 4 && x <= 110 && y > 92 + 16, `${g} ${x},${y}: on the left side`);
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i][1], all[j][1]), `${all[i][0]} ${all[i][1]} and ${all[j][0]} ${all[j][1]} overlap`);
});

test("the engine counts who doesn't fit: a crowded day draws each place up to its cap, the rest as +N signs", () => {
  const seen = { at: new Map(), overflow: null, labs: [] };
  const { window, dom } = load({
    wrap: hooks => {
      const { drawChar, labels } = hooks;
      hooks.drawChar = (f, b) => { seen.at.set(f.id, [b.x, b.y]); return drawChar(f, b); };
      hooks.labels = (lab, overflow) => { seen.overflow = { ...overflow }; seen.labs = []; return labels((...a) => { seen.labs.push(a); return lab(...a); }, overflow); };
    },
  });
  window.registered.start({ el: dom.make(), opts: { still: true }, prefs: { get: () => null, set() {} } });
  window.registered.scene(window.AgentvilleScene.toScene(crowd()));
  const h = window.hooks;
  assert.deepEqual(Object.fromEntries(Object.keys(PLACES).map(g => [g, seen.overflow[g]])), { desk: 2, turn: 1, charge: 2, storage: 2, nap: 1, floor: 2 }, 'the engine counts the ones over each cap');
  const prefix = { w: 'desk', t: 'turn', i: 'charge', s: 'storage', n: 'nap', f: 'floor' };
  for (const [p, group] of Object.entries(prefix)) {
    const places = Array.from({ length: PLACES[group] }, (_, i) => JSON.stringify(placeOf(h, group, i)));
    const drawn = [...seen.at].filter(([id]) => id.startsWith(p));
    assert.equal(drawn.length, PLACES[group], `${group}: ${PLACES[group]} drawn, the rest counted`);
    for (const [id, xy] of drawn) assert.ok(places.includes(JSON.stringify(xy)), `${id} stands in one of the ${group} places (${xy})`);
  }
  const drawn = [...seen.at.values()];
  assert.equal(drawn.length, 22, 'everyone who fits, at a position or a place');
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) assert.ok(!overlap(drawn[i], drawn[j]), `two soldiers overlap at ${drawn[i]} and ${drawn[j]}`);
  const signs = seen.labs.map(([, , html]) => String(html)).join('\n');
  for (const t of ['+2 waiting', '+1 your turn', '+2 idle', '+2 stale', '+1 asleep', '+2 working']) assert.ok(signs.includes(t), `the sign "${t}"`);
});

test('buildingAt: a point just inside each building is its key; just outside, between two buildings, at the alert board and at [0, 300] there is none', () => {
  const { window, M } = load();
  const h = window.hooks;
  h.relayout(h.grid.layoutFor([{ key: SHOP, name: 'shop' }]));
  assert.deepEqual(plain(M.BUILDINGS.map(([k, x0, , x1]) => [k, x0, x1])),
    [['barn', 30, 90], ['drones', 96, 126], ['desk', 140, 260], ['board', 262, 278], ['bank', 286, 310], ['dock', 320, 394]],
    "left to right: the motor pool gate, the drone pad, the HQ tent, the briefing board, the fuel depot, the quartermaster's depot");
  for (const [k, x0, y0, x1, y1] of M.BUILDINGS) {
    const mx = Math.round((x0 + x1) / 2), my = Math.round((y0 + y1) / 2);
    assert.ok(y0 > 18 && y1 < 80, `${k}: in front of the hedge, behind the track (y ${y0}–${y1})`);
    for (const [x, y] of [[x0, my], [x1, my], [mx, y0], [mx, y1]]) assert.equal(h.buildingAt(x, y), k, `${x},${y}: just inside ${k}`);
    for (const [x, y] of [[x0 - 1, my], [x1 + 1, my], [mx, y0 - 1], [mx, y1 + 1]]) assert.equal(h.buildingAt(x, y), null, `${x},${y}: just outside ${k}`);
  }
  for (const [x, y] of [[93, 50], [133, 30], [282, 50], [315, 50]]) assert.equal(h.buildingAt(x, y), null, `${x},${y}: between two buildings (the alert board is none)`);
  for (const [x, y] of [[0, 300], [116, 84], [200, 8], [174, 140], [56, 160]]) assert.equal(h.buildingAt(x, y), null, `${x},${y}: the ground, the track, the sky, a position, the left side`);
});

// The ruling's sweep: whole words only ("install" is no "stall"), and "field" only in the drill's own compounds.
const DRILL_COMPOUNDS = /\b(field (exercise|log|jacket|manual|generator|telephone|cap)|exercise field)\b/gi;
const FARM_OR_FACTORY = /\b(farms?|fields?|crops?|harvests?|porch(es)?|barns?|silos?|henhouses?|stalls?|farmers?|robots?|factory|factories|bays?|conveyors?)\b/i;
const unescaped = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[k]);
/**
 * What a person reads of some HTML: its words without the markup (the engine's own attributes are data-farm-*), and
 * its tooltips (each title="…", unescaped); without the drill's compounds.
 */
const readOf = t => [String(t).replace(/<[^>]*>/g, ' '), ...[...String(t).matchAll(/\btitle="([^"]*)"/g)].map(m => unescaped(m[1]))].join('\n').replace(DRILL_COMPOUNDS, ' ');
/** Everything the world says to a person about a scene: help, building tips and dialogs, the signs, each soldier's tip, log lines and pop-ups. */
function wordsOf(h, scene) {
  h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const texts = [['help', h.help()], ['startText', h.startText(1)], ['startText', h.startText(7)], ['arriveText', h.arriveText], ['boardTitle', h.boardTitle]];
  for (const k of ['barn', 'drones', 'desk', 'board', 'bank', 'dock']) { assert.ok(h.buildingTip(k), `${k} has a tip`); texts.push([`buildingTip ${k}`, h.buildingTip(k)]); }
  for (const k of ['desk', 'bank', 'drones', 'dock']) { const d = h.dialog(k); assert.ok(d?.title && d.html, `${k} opens a dialog`); texts.push([`dialog ${k}`, `${d.title}\n${d.html}`]); }
  h.labels((x, y, html, cls = '', title = '') => texts.push([`label at ${x},${y}`, `${html}\n${title}`]), { desk: 2, turn: 1, storage: 1, charge: 1, floor: 1, nap: 1 });
  for (const f of scene.farmers) {
    texts.push([`tip ${f.id}`, h.tip(f)]);
    const z = h.slots(f).zone;
    texts.push([`zoneText ${z}`, h.zoneText(f, z)]);
    h.onMove(f, z, 'somewhere', t => texts.push([`pop ${z}`, t]));
  }
  return texts;
}

test('no farm or factory words: the help, every building tip and dialog, the signs, and each soldier\'s tip, log line and pop-up are in drill words', () => {
  const { window, M } = load();
  const h = window.hooks;
  assert.equal(h.boardTitle, 'The briefing board: what your projects remember', "the briefing board's dialog title (the engine's board)");
  assert.equal(h.startText(1), 'Muster: <b>1</b> soldier on the base');
  assert.equal(h.startText(7), 'Muster: <b>7</b> soldiers on the base');
  assert.equal(h.arriveText, 'jumps down from the truck');
  const texts = [];
  // a day with all a position's sign can say: a branch, deploys and why, git counts, a worktree, a collision (the busy day last: the dialogs below read it)
  const signsDay = {
    generatedAt: TOUR_NOW, agents: [person('a')], collisions: [{ repo: SHOP, severity: 'high', reason: 'two agents edit the same files', since: 0, agentIds: [] }],
    repos: [
      { path: SHOP, name: 'shop', branch: 'feature/cart', dirty: 3, ahead: 2, behind: 1, lastDeploy: { state: 'failed', source: 'actions', label: '✗ deploy failed', detail: 'Build step failed', at: TOUR_NOW }, agentIds: ['a'] },
      { path: `${SHOP}-cart`, name: 'shop-cart', branch: 'cart', worktree: true, main: SHOP, dirty: 0, ahead: 0, behind: 0, lastDeploy: { state: 'running', source: 'direct', label: '◌ deploying', detail: 'rsync to the server', at: TOUR_NOW }, agentIds: [] },
    ],
  };
  for (const snap of [{ generatedAt: TOUR_NOW, agents: [], repos: [], collisions: [] }, signsDay, busyDay()]) texts.push(...wordsOf(h, M.militaryScene(window.AgentvilleScene.toScene(snap))));
  const tips = texts.map(([, t]) => readOf(t)).join('\n');
  for (const tip of ['Build step failed', '3 uncommitted files', '2 unpushed commits', '1 commit behind the remote', 'Click to see the files soldiers touched here']) assert.ok(tips.includes(tip), `the sweep reads the tooltip "${tip}"`);
  for (const k of ['barn', 'board', 'nothing']) assert.equal(h.dialog(k), null, `${k}: the engine's own, or none`);
  assert.deepEqual(['desk', 'bank', 'drones', 'dock'].map(k => h.dialog(k).title), ['The HQ tent', 'The fuel depot: your plan', 'The drone pad: subagents', "The quartermaster's depot: pull requests"]);
  assert.match(h.dialog('desk').html, /data-farm-pick="w0"/, 'the HQ tent: an Open button for each soldier waiting on you');
  assert.match(h.dialog('dock').html, /#12/, "the quartermaster's depot lists the open pull requests");
  for (const [where, t] of texts) assert.doesNotMatch(readOf(t), FARM_OR_FACTORY, `${where}: ${t}`);
  assert.doesNotMatch(readOf('the field log, a field jacket, the exercise field'), FARM_OR_FACTORY, 'the drill compounds are allowed');
  assert.match(readOf('across the field'), FARM_OR_FACTORY, 'a field alone is not');
  assert.doesNotMatch(readOf('installing'), FARM_OR_FACTORY, 'whole words only');
  assert.match(readOf('<button type="button" title="Click to see the farm">shop</button>'), FARM_OR_FACTORY, 'a tooltip is read too');
  assert.match(readOf('<b title="Tom &amp; Jerry&#39;s &quot;depot&quot;">x</b>'), /Tom & Jerry's "depot"/, 'unescaped');
});

test('the log lines and pop-ups in drill words: to HQ, reporting back, in reserve, at the mess tent, on a cot, on the drill ground, at a position', () => {
  const { window, M } = load();
  const h = window.hooks;
  const scene = M.militaryScene(window.AgentvilleScene.toScene(busyDay()));
  h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const f = id => scene.farmers.find(a => a.id === id), line = id => h.zoneText(f(id), h.slots(f(id)).zone);
  assert.equal(line('w0'), 'comes to HQ: needs a permission');
  assert.equal(h.zoneText({ ...f('w0'), askKind: 'question' }, 'desk'), 'comes to HQ with a question');
  assert.equal(line('t0'), 'reports back at HQ');
  assert.equal(line('s0'), 'waits in reserve (stale)');
  assert.equal(line('i0'), 'eats at the mess tent (idle)');
  assert.match(line('n0'), /^sleeps on a cot until it wakes up by itself at \d/);
  assert.equal(line('f0'), 'drills on the drill ground (no repo)');
  assert.equal(line('b0'), 'editing at the shop position');
  const pops = id => { const out = []; h.onMove(f(id), h.slots(f(id)).zone, 'somewhere', t => out.push(t)); return out; };
  assert.deepEqual(pops('t0'), ['Done!']);
  assert.deepEqual(pops('w0'), ['Needs you!']);
  assert.deepEqual(pops('s0'), ['…zzz']);
  assert.deepEqual(pops('n0'), ['…zzz']);
  assert.deepEqual(pops('i0'), []);
  const tip = h.tip(f('b0'));
  for (const part of ['b0', 'editing at the shop position', '% context left', '$0.40 so far']) assert.ok(tip.includes(part), `the tip has "${part}": ${tip}`);
});

test("the private scene: what a person reads has no undefined, NaN or [object], no farm or factory word, and none of the snapshot's real names, titles, branches or services", () => {
  const { window, M } = load();
  const h = window.hooks, snap = goldenSnapshot();
  const scene = M.militaryScene(window.AgentvilleScene.privateScene(window.AgentvilleScene.toScene(snap)));
  const texts = wordsOf(h, scene);
  assert.ok(texts.some(([, t]) => /Open pull requests: #41/.test(String(t))), 'the open pull requests sign has a tip to check');
  assert.ok(texts.some(([, t]) => /title="r\d+ · Click to see the files soldiers touched here"/.test(String(t))), "a position's sign has a tooltip to check: its stand-in key, no branch, no deploy's words");
  // the snapshot's real words (MCP server names stay in a private scene, so Gmail is not among them)
  const real = [...snap.agents.map(a => a.name), ...snap.repos.map(r => r.name), 'New basket', 'Footer copy', 'feature/cart', 'example.com', 'Build step failed', 'Deploy #212', 'rsync', 'Ship the new cart', 'npm publish', 'Basket.tsx', 'The post is drafted', 'Keep the old footer', '/Users/sam']
    .map(w => new RegExp(`(^|[^\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`, 'i'));
  // what a soldier is doing is the world's own words (its props kit's verbs: "on the web" is no repo called web)
  const verbs = Object.values(M.props.steps).map(s => s.verb).sort((a, b) => b.length - a.length);
  for (const [where, t] of texts) {
    const read = readOf(t);
    assert.doesNotMatch(read, /\bundefined\b|\bNaN\b|\[object/, `${where}: ${read}`);
    assert.doesNotMatch(read, FARM_OR_FACTORY, `${where}: ${read}`);
    const theirs = verbs.reduce((s, v) => s.split(v).join(' '), read);
    if (where !== 'help') for (const re of real) assert.doesNotMatch(theirs, re, `${where}: ${read}`); // the help is static, and names tools (Gmail, Codex) a snapshot may share
  }
});

test('the ground: no hole in it, the sky over a clipped hedge, the track across, the rope round the positions, and at least 20 px of plain grass at the bottom', () => {
  const { window, ctx, M } = load();
  const h = window.hooks, ink = vm.runInContext('ink', ctx);
  for (const rows of [3, 6]) {
    const L = h.relayout(h.grid.layoutFor(Array.from({ length: rows * 3 }, (_, i) => ({ key: `/r/${i}`, name: `r${i}` }))));
    assert.equal(L.rows, rows);
    const ext = { x0: -24, x1: h.W + 24, y0: -12, y1: L.H + 12 }, w = ext.x1 - ext.x0, hgt = ext.y1 - ext.y0;
    const pix = new Array(w * hgt).fill(null), at = (x, y) => pix[(y - ext.y0) * w + (x - ext.x0)];
    h.bg((x, y, fw, fh, c) => {
      for (let yy = Math.max(ext.y0, y); yy < Math.min(ext.y1, y + fh); yy++) for (let xx = Math.max(ext.x0, x); xx < Math.min(ext.x1, x + fw); xx++) pix[(yy - ext.y0) * w + (xx - ext.x0)] = ink(c);
    }, 'summer', ext);
    assert.equal(pix.indexOf(null), -1, `${rows} rows: every pixel of the ground is painted`);
    const sky = at(0, 0), hedge = at(0, 24), track = at(0, 83), grass = new Set([ink('#6aa84f'), ink('#7fbf5a')]);
    for (let x = ext.x0; x < ext.x1; x++) { assert.equal(at(x, M.SKY_Y - 1), sky, `the sky's place at ${x}`); assert.equal(at(x, 83), track, `the track at ${x}`); }
    assert.ok(new Set([sky, hedge, track, at(-20, 200)]).size === 4 && grass.has(at(-20, 200)), 'sky, hedge, track and grass, each its own');
    // the bottom: the last 20 rows of the world are plain grass (the Menu's bottom row may lie over them)
    const bare = [];
    for (let y = L.H - 20; y < L.H; y++) for (let x = 0; x < h.W; x++) if (!grass.has(at(x, y))) bare.push(`${x},${y} ${at(x, y)}`);
    assert.deepEqual(bare.slice(0, 5), [], `${rows} rows: plain grass along the bottom`);
    assert.ok(![...Array(h.W).keys()].every(x => grass.has(at(x, L.H - 21 - 14))), `${rows} rows: the field's edge (a hedge and a fence) is drawn just above it`);
    // the rope round the positions: on its line all round, but where the paths come in
    const G = L.GRID, rope = new Set([ink('#f4ecd8'), ink('#e6eef5'), ink('#e04a3a')]), edge = [];
    for (let x = G.x0 + 1; x < G.x1 - 1; x++) edge.push(at(x, G.y0 + 1), at(x, G.y1 - 2));
    for (let y = G.y0 + 1; y < G.y1 - 1; y++) edge.push(at(G.x0 + 1, y), at(G.x1 - 2, y));
    const on = edge.filter(c => rope.has(c)).length;
    assert.ok(on / edge.length >= 0.8, `${rows} rows: the rope goes round the positions (${on} of ${edge.length}, gaps for the paths)`);
    for (const c of [218, 306]) assert.ok(!rope.has(at(c, G.y0 + 1)), `a gap in the rope where the aisle at ${c} comes in from the track`);
  }
});

test("the sky by the clock over the hedge, the flagpoles against it with bunting and flags in the agents' colours, and HQ's red pennant run up while a soldier waits on you", () => {
  const { window, dom, ctx, M } = load();
  const h = window.hooks, PXG = vm.runInContext('PXG', ctx), ink = vm.runInContext('ink', ctx);
  PXG.ctx = dom.document.createElement('canvas').getContext('2d');
  PXG.T = 3;
  PXG.ext = { x0: -20, x1: 420, y0: -10, y1: 400 };
  h.relayout(h.grid.layoutFor([]));
  const sceneOf = (...agents) => M.militaryScene(window.AgentvilleScene.toScene({ generatedAt: TOUR_NOW, agents, repos: [], collisions: [] }));
  const paint = sky => { dom.calls.rects.length = 0; h.weather(sky); return dom.calls.rects.map(r => [...r]); };
  const DAY = { phase: 'day', light: 1, sun: { x: 170, y: 12 }, moon: null }, NIGHT = { phase: 'night', light: 0, sun: null, moon: { x: 230, y: 2 } };
  const idle = sceneOf(person('a', { state: 'idle', now: null }), person('b', { state: 'stale', now: null }), person('c'));
  h.setScene(idle);
  const day = paint(DAY), night = paint(NIGHT);
  for (const [when, rects] of [['day', day], ['night', night]]) {
    assert.ok(rects.length > 0, `${when}: drawn`);
    for (const [c, x, y, , hh] of rects) assert.ok(y + hh <= 27, `${when}: ${c} at ${x},${y} is above the roofs (the sky, the poles' tops, HQ's pennant)`);
    assert.ok(rects.some(([, x, y, w]) => x <= -20 && x + w >= 420 && y <= -10), `${when}: the sky goes across the whole ground shown, past its edges`);
  }
  const colours = rects => new Set(rects.map(r => r[0]));
  assert.ok([...colours(day)].some(c => !colours(night).has(c)), 'the day sky is not the night sky');
  for (const f of idle.farmers) assert.ok(day.filter(r => r[0] === f.shirt).length >= 2, `bunting and a flag in ${f.name}'s colour, ${f.shirt}, exactly`);
  const red = new Set([ink('#e04a3a'), ink('#ff6b6b'), ink('#b23a2e')]);
  const flying = rects => rects.filter(([c, x, y]) => red.has(c) && x > 200 && x < 216 && y < 12).length;
  assert.equal(flying(day), 0, 'no one waiting on you: the pennant is down');
  h.setScene(sceneOf(person('a', { state: 'waiting', stateReason: 'permission', ask: { kind: 'permission', toolUseId: 't1', tool: 'Bash', summary: 'npm publish' }, now: null })));
  assert.ok(flying(paint(DAY)) > 0, 'a soldier waiting on you: the red pennant flies over HQ');
  h.setScene(sceneOf());
  const pennants = paint(DAY).filter(([, , y, w, hh]) => y >= 12 && w <= 3 && hh <= 2);
  assert.ok(new Set(pennants.map(r => r[0])).size >= 4, 'no one on the base: still bunting, in a cheerful set of colours');
});

test("the motor pool's barrier lifts while a soldier comes through the gate, and comes down after; drawn still, it stays down", () => {
  const { window, dom, ctx, M } = load();
  const h = window.hooks, PXG = vm.runInContext('PXG', ctx), ink = vm.runInContext('ink', ctx);
  PXG.ctx = dom.document.createElement('canvas').getContext('2d');
  PXG.T = 0;
  h.relayout(h.grid.layoutFor([]));
  h.setScene(M.militaryScene(window.AgentvilleScene.toScene({ generatedAt: TOUR_NOW, agents: [person('a', { state: 'idle', now: null })], repos: [], collisions: [] })));
  const arm = new Set([ink('#e04a3a'), ink('#ffffff')]);
  /** How high the barrier's arm reaches: the top of its red and white pixels in the gate. */
  const top = () => { dom.calls.rects.length = 0; h.ground(); return Math.min(...dom.calls.rects.filter(([c, x, y]) => arm.has(c) && x >= 34 && x <= 90 && y > 18 && y < 74).map(r => r[2])); };
  const down = top();
  assert.ok(down >= 62 && down <= 70, `down, across the gate (y ${down})`);
  const out = { walk: true, x: 70, y: 80 }, posOf = () => out;
  for (let i = 0; i < 10; i++) h.tick(0.03, posOf);
  assert.ok(top() < down - 20, `a soldier coming through: the barrier lifts (y ${top()})`);
  h.tick(0, posOf, true);
  assert.equal(top(), down, 'drawn still (motion off): no one comes through, the barrier is down');
  for (let i = 0; i < 10; i++) h.tick(0.03, posOf);
  out.x = 200;
  h.tick(0.03, posOf);
  assert.ok(top() < down, 'it comes down slowly, not at once');
  for (let i = 0; i < 60; i++) h.tick(0.03, posOf);
  assert.equal(top(), down, 'gone by: the barrier is down again');
});

test("items: the mess table in front of the idle soldiers, a crate before each soldier in reserve, a blanket over each cot; a fresh list each call", () => {
  const { window, dom, ctx } = load();
  const h = window.hooks, PXG = vm.runInContext('PXG', ctx);
  PXG.ctx = dom.document.createElement('canvas').getContext('2d');
  const a = h.items();
  assert.notEqual(a, h.items(), 'a fresh array each call (the engine pushes its own into it)');
  assert.ok(a.every(it => Number.isFinite(it[0]) && typeof it[1] === 'function'));
  const after = ([x, y]) => a.filter(([iy, draw]) => {
    if (iy <= y || iy > y + 2) return false;
    dom.calls.rects.length = 0;
    draw();
    return dom.calls.rects.some(([, rx, ry, rw, rh]) => rx < x + 6 && rx + rw > x - 6 && ry < y && ry + rh > y - 8); // over its body, below the shoulders
  }).length;
  for (let i = 0; i < 4; i++) assert.ok(after(placeOf(h, 'charge', i)) > 0, `the mess table in front of idle place ${i}`);
  for (let i = 0; i < 4; i++) assert.ok(after(placeOf(h, 'storage', i)) > 0, `a crate before reserve place ${i}`);
  for (let i = 0; i < 2; i++) assert.ok(after(placeOf(h, 'nap', i)) > 0, `a blanket over cot ${i}`);
});

test("the quartermaster's depot: a crate for each open pull request across the positions, up to 8, each tagged with its checks", () => {
  const { M } = load();
  const pr = (number, checks, draft = false) => ({ number, title: `pr ${number}`, url: '', checks, draft });
  const fields = [
    { key: 'a', prs: { open: [pr(1, 'ok'), pr(2, 'failed'), pr(3, 'running'), pr(4, 'ok', true)], merged: [] } },
    { key: 'b', prs: null },
    { key: 'c', prs: { open: [pr(5, null), pr(6, 'ok'), pr(7, 'ok'), pr(8, 'failed'), pr(9, 'ok'), pr(10, 'ok')], merged: [] } },
  ];
  const crates = plain(M.depotCrates(fields));
  assert.equal(crates.length, 8, 'eight at most');
  assert.deepEqual(crates.map(c => c.tag), ['ok', 'failed', 'running', 'draft', 'none', 'ok', 'ok', 'failed'], 'its tag: green pass, red failed, amber running, grey draft (a draft whatever its checks)');
  for (const c of crates) assert.ok(c.x >= 320 && c.x + 8 <= 394 && c.y >= 22 && c.y + 7 <= 78, `crate at ${c.x},${c.y} at the depot`);
  for (let i = 0; i < crates.length; i++) for (let j = i + 1; j < crates.length; j++) assert.ok(Math.abs(crates[i].x - crates[j].x) >= 8 || Math.abs(crates[i].y - crates[j].y) >= 7, 'crates side by side or stacked, not in each other');
  assert.deepEqual(plain(M.depotCrates([])), []);
});

test("the paths down: the left side's, then the aisles between the positions' columns; none crosses a position", () => {
  const { window } = load();
  const h = window.hooks, L = h.grid.layoutFor(Array.from({ length: 18 }, (_, i) => ({ key: `/r/${i}`, name: `r${i}` })));
  assert.deepEqual(plain(h.corridors), [116, 218, 306]);
  for (const c of h.corridors) for (const s of L.slots) assert.ok(Math.abs(c - s.cx) >= 40, `the path at x ${c} keeps clear of the position at ${s.cx}`);
  assert.ok(h.corridors[0] < L.GRID.x0 && h.corridors[0] > 110, "the left side's path runs between the left side and the range");
});

test("the signs: HQ, the motor pool, the mess, the reserve, the drill ground and the range; each position's name (click it for its files), each project's, and the open pull requests", () => {
  const { window, M } = load();
  const h = window.hooks;
  const labelsOf = snap => {
    const scene = M.militaryScene(window.AgentvilleScene.toScene(snap)), labs = [];
    h.relayout(h.grid.layoutFor(scene.fields));
    h.setScene(scene);
    h.labels((x, y, html, cls = '', title = '') => labs.push({ x, y, html: String(html), cls, title, text: readOf(html) }), {});
    return labs;
  };
  const busy = labelsOf(busyDay());
  for (const sign of ['HQ', 'MOTOR POOL', 'MESS', 'RESERVE', 'DRILL', 'RANGE']) assert.ok(busy.some(l => l.cls.includes('zone') && l.text.includes(sign)), `the ${sign} sign`);
  const shop = busy.find(l => l.html.includes(`data-farm-field="${SHOP}"`));
  assert.ok(shop && shop.text.includes('shop'), "the shop position's sign: its name, a button that opens its close-up");
  assert.ok(busy.some(l => /\b1 PR\b/.test(l.text) && /#12 New cart/.test(l.title)), 'the open pull requests, counted by the depot');
  assert.ok(labelsOf(goldenSnapshot()).some(l => l.cls.includes('proj') && l.text.includes('shop')), "a project's sign over its positions");
  assert.ok(labelsOf({ generatedAt: TOUR_NOW, agents: [], repos: [], collisions: [] }).some(l => /No positions yet/.test(l.text)), 'no positions: the sign says so');
});

/* ---------- the positions: fortified as the context fills, and what its repo's state puts round each ---------- */

/** A snapshot of the shop's position and its soldiers, in the collector's shapes; `collision` is the collision's severity. */
function position({ collision = null, ...over } = {}, agents = []) {
  return {
    generatedAt: Date.now(), agents, collisions: collision ? [{ repo: SHOP, severity: collision, reason: 'two agents edit the same files', since: 0, agentIds: [] }] : [],
    repos: [{ path: SHOP, name: 'shop', branch: 'main', dirty: 0, ahead: 0, behind: 0, lastDeploy: null, agentIds: agents.map(a => a.id), ...over }],
  };
}
const deployed = (state, label = state, detail = undefined) => ({ lastDeploy: { state, source: 'actions', label, detail, at: TOUR_NOW } });
const NOBODY = { generatedAt: TOUR_NOW, agents: [], repos: [], collisions: [] };
/** The field exercise with a canvas to draw on, and the ground's drawing each frame (ground) for a snapshot: its fills and pictures. */
function positions() {
  const { window, dom, ctx, M } = load();
  const h = window.hooks, PXG = vm.runInContext('PXG', ctx), ink = vm.runInContext('ink', ctx);
  PXG.ctx = dom.document.createElement('canvas').getContext('2d');
  PXG.T = 1.3;
  const sceneOf = snap => M.militaryScene(window.AgentvilleScene.toScene(snap));
  const ground = snap => {
    if (snap) { const scene = sceneOf(snap); h.relayout(h.grid.layoutFor(scene.fields)); h.setScene(scene); }
    dom.calls.rects.length = 0; dom.calls.images.length = 0;
    h.ground();
    return { rects: dom.calls.rects.map(r => [...r]), images: dom.calls.images.map(i => [...i]) };
  };
  return { window, dom, ctx, M, h, PXG, ink, sceneOf, ground };
}
/** The fills on the exercise field (below the track), where the positions are: the barrier and the depot's crates are above it. */
const onField = ({ rects }) => rects.filter(([, , y]) => y >= 93);

test('a position is fortified as the context fills: marker stakes, a sandbag ring (30%), a low wall (50%), a lookout post (70%), the flag raised (85%)', () => {
  const { sceneOf } = positions();
  const buildAt = (...pcts) => sceneOf(position({}, pcts.map((p, i) => person(`p${i}`, { contextTokens: Math.round(p * 200_000) })))).fields[0].build;
  assert.deepEqual([0, 0.3, 0.5, 0.7, 0.9].map(p => buildAt(p)), [0, 1, 2, 3, 4]);
  assert.deepEqual([0.29, 0.49, 0.69, 0.84, 0.85, 1].map(p => buildAt(p)), [0, 1, 2, 3, 4, 4], 'at the edges');
  assert.equal(buildAt(0.2, 0.6), 2, 'the fullest soldier at work there');
  const as = (state, p) => sceneOf(position({}, [person('x', { state, contextTokens: p * 200_000, now: null })])).fields[0].build;
  assert.equal(as('waiting', 0.9), 4, 'waiting on you: still its position');
  assert.equal(as('yourTurn', 0.9), 4, 'your turn: still its position');
  assert.equal(as('idle', 0.9), 0, 'idle: nobody fortifies it, its stakes');
  assert.equal(as('stale', 0.9), 0, 'stale: nobody fortifies it');
  assert.equal(sceneOf(position()).fields[0].build, 0, 'no soldiers: its stakes');
});

test("a position's flag is a branch other than main; its light is its last deploy's state; each soldier keeps its look", () => {
  const { sceneOf, M } = positions();
  const field = over => sceneOf(position(over)).fields[0];
  for (const [branch, flag] of [['feature/cart', true], ['main', false], ['master', false], ['(detached)', false], [null, false]]) assert.equal(field({ branch }).flag, flag, String(branch));
  for (const state of ['ok', 'failed', 'running', 'blocked', 'other']) assert.equal(field(deployed(state)).light, state);
  assert.equal(field(deployed('cancelled')).light, 'other', "a state it doesn't name: drawn one way");
  assert.equal(field({}).light, null, 'no deploy: none');
  assert.equal(field({ lastDeploy: undefined, deploy: { status: 'in_progress' } }).light, 'running', 'a bare Actions run (no words)');
  assert.deepEqual(plain(sceneOf(position({}, [person('x')])).farmers[0].look), plain(M.lookOf({ id: 'x' })));
});

test('a bare position (no deploy, pull requests, git counts or project) draws only its stakes and its post, and nothing throws; each thing its repo has adds to it', () => {
  const { ground, h, ink } = positions();
  assert.equal(onField(ground(NOBODY)).length, 0, 'no repo: nothing on the field each frame');
  const fills = (over = {}, agents = []) => { let n = 0; assert.doesNotThrow(() => { n = onField(ground(position(over, agents))).length; }, JSON.stringify(over)); return n; };
  const bare = onField(ground(position()));
  const [s] = h.layout().ST, t = s.rowTop;
  assert.ok(bare.length > 0, 'it draws its stakes and post');
  assert.ok(bare.length <= 40, `only those: ${bare.length} fills`);
  for (const [c, x, y, w, hh] of bare) assert.ok(x >= s.cx - 41 && x + w <= s.cx + 41 && y >= t && y + hh <= t + 30, `${c} at ${x},${y} ${w}×${hh}: behind where its soldiers stand`);
  const effects = new Set(['#2fa57a', '#6cc04a', '#c3cbd2', '#e04a3a', '#ffd43b', '#3a3a40'].map(ink)); // a flare's green, smoke, red flags and letters, caution tape, a scorched patch
  assert.deepEqual(bare.filter(([c]) => effects.has(c)).map(r => r[0]), [], 'none of the deploys\' or the tape\'s colours');
  const one = fills(), worker = [person('w')], job = [person('w', { children: [{ id: 'j1', kind: 'bgjob', state: 'running', startedAt: TOUR_NOW }] })];
  const more = {
    'deployed (a green flare)': deployed('ok', '✓ deployed'),
    'deploy failed (a practice charge)': deployed('failed', '✗ deploy failed'),
    'deploying (range flags)': deployed('running', '◌ deploying'),
    "Actions didn't run (a HOLD board)": deployed('blocked', "⏸ Actions didn't run"),
    'uncommitted files (loose sandbags)': { dirty: 3 },
    'unpushed commits (supply crates)': { ahead: 2 },
    'behind its remote (a mail sack at the post)': { behind: 1 },
    'a collision (caution tape)': { collision: 'low' },
  };
  for (const [what, over] of Object.entries(more)) assert.ok(fills(over) > one, `${what}: ${fills(over)} fills, bare ${one}`);
  assert.equal(fills(deployed('cancelled')), one, "a deploy state it doesn't name: nothing");
  assert.ok(fills({}, job) > fills({}, worker), 'a background command (a field generator)');
  assert.ok(fills({ dirty: 6 }) > fills({ dirty: 3 }) && fills({ dirty: 9 }) === fills({ dirty: 6 }), 'one loose sandbag a file, up to 6');
  assert.ok(fills({ ahead: 4 }) > fills({ ahead: 2 }) && fills({ ahead: 9 }) === fills({ ahead: 4 }), 'one crate a commit, up to 4');
  assert.equal(fills({ behind: 5 }), fills({ behind: 1 }), 'one mail sack, however far behind');
  const net = ground(position({ worktree: true, main: '/Users/you/code/other' })).images.filter(([x, y]) => x > s.cx - 41 && x < s.cx + 41 && y >= t && y < t + 30);
  assert.equal(net.length, 1, 'a worktree: a camouflage net over the position');
  assert.equal(ground(position()).images.length, 0, '… and none otherwise');
});

test('each stage of the fortification differs, and so does each deploy', () => {
  const { ground } = positions();
  const sig = snap => JSON.stringify(ground(snap));
  const stages = [0, 0.3, 0.5, 0.7, 0.9].map(p => sig(position({}, [person('a', { contextTokens: p * 200_000 })])));
  assert.equal(new Set(stages).size, 5, 'five stages, five pictures');
  const deploys = [{}, deployed('ok'), deployed('failed'), deployed('running'), deployed('blocked')].map(over => sig(position(over)));
  assert.equal(new Set(deploys).size, 5, 'none, ok, failed, running and blocked: five pictures');
});

test('the flag raised is in the colour of the soldier filling the position; a compaction carries it forward with a cheer, a few pixels up-field, then the stakes again; with motion off nothing walks', () => {
  const { h, sceneOf, ground } = positions();
  const soldier = n => [person('a', { compactions: n, contextTokens: n % 2 ? 190_000 : 10_000 })];
  const L = h.relayout(h.grid.layoutFor(sceneOf(position()).fields)), [s] = L.ST, colour = sceneOf(position({}, soldier(1))).farmers[0].shirt;
  const flagAt = () => onField(ground()).filter(([c, x]) => c === colour && Math.abs(x - s.cx) <= 41); // the soldier's colour, exact, at its position
  h.setScene(sceneOf(position({}, soldier(1))));
  const raised = flagAt();
  assert.ok(raised.length >= 4, 'nearly full: the flag raised, in its soldier\'s colour');
  assert.equal(sceneOf(position({}, soldier(2))).fields[0].build, 0, 'compacted: the stakes again');
  const events = plain(h.setScene(sceneOf(position({}, soldier(2)))));
  assert.deepEqual(events.map(e => [e.kind, e.text]), [['harvest', 'Advanced!']]);
  const tops = [];
  for (let i = 0; i < 200 && (tops.length < 2 || flagAt().length); i++) {
    const f = flagAt();
    if (f.length) tops.push(Math.min(...f.map(r => r[2])));
    h.tick(0.05, () => null);
  }
  assert.ok(tops.length > 20, `it is carried a while (${tops.length} frames)`);
  assert.ok(tops.every((y, i) => i === 0 || y <= tops[i - 1]), 'forward, never back');
  const walked = tops[0] - tops.at(-1);
  assert.ok(walked >= 3 && walked <= 14, `a few pixels up-field (${walked})`);
  assert.equal(flagAt().length, 0, 'then gone: the stakes again');
  h.setScene(sceneOf(position({}, soldier(3))));
  h.setScene(sceneOf(position({}, soldier(4))));
  h.tick(0, () => null, true);
  assert.equal(flagAt().length, 0, 'drawn still (motion off): nothing is carried');
});

test("setScene tells what happened: Advanced! for a compaction, Supplies in! at the quartermaster's depot for a newly merged pull request, a deploy failing or going through", () => {
  const { h, sceneOf } = positions();
  const a = n => [person('a', { compactions: n })];
  h.relayout(h.grid.layoutFor(sceneOf(position()).fields));
  assert.deepEqual(plain(h.setScene(sceneOf(position({}, a(1))))), [], 'the first scene: nothing has happened yet');
  const advanced = plain(h.setScene(sceneOf(position({}, a(2)))));
  assert.deepEqual(advanced.map(e => [e.kind, e.id, e.text, e.cls]), [['harvest', 'a', 'Advanced!', 'good']]);
  assert.match(advanced[0].log, /compacted/);
  assert.deepEqual(plain(h.setScene(sceneOf(position({}, a(2))))), [], 'nothing new');
  const pr = (number, at) => ({ number, title: 'New cart', url: '', at });
  assert.deepEqual(plain(h.setScene(sceneOf(position({ prs: { open: [], merged: [pr(9, Date.now() - 3 * 3_600_000)] } }, a(2))))), [], 'merged hours ago: old news');
  const merged = plain(h.setScene(sceneOf(position({ prs: { open: [], merged: [pr(9, Date.now() - 3 * 3_600_000), pr(12, Date.now())] } }, a(2)))));
  assert.deepEqual(merged.map(e => [e.kind, e.text, e.cls]), [['merged', 'Supplies in! #12', 'good']]);
  assert.equal(h.buildingAt(...merged[0].at), 'dock', "it pops at the quartermaster's depot");
  assert.equal(merged[0].who, "The quartermaster's depot", 'the field log names the depot');
  assert.match(merged[0].log, /#12 merged/);
  assert.deepEqual(plain(h.setScene(sceneOf(position({ prs: { open: [], merged: [pr(12, Date.now())] } }, a(2))))), [], 'seen');
  const [s] = h.layout().ST;
  const kinds = over => plain(h.setScene(sceneOf(position(over, a(2))))).map(e => [e.kind, e.text, h.fieldAt(...e.at)]);
  assert.deepEqual(kinds(deployed('failed')), [['deployFailed', '', s.key]], 'a deploy fails: for the animals, no words, at its position');
  assert.deepEqual(kinds(deployed('failed')), [], 'not again while it stays failed');
  assert.deepEqual(kinds(deployed('running')), []);
  assert.deepEqual(kinds(deployed('ok')), [['deployOk', '', s.key]], 'it goes through');
  for (const e of [...advanced, ...merged]) assert.doesNotMatch(readOf(`${e.text} ${e.log} ${e.who ?? ''}`), FARM_OR_FACTORY, 'in drill words');
});

test("a merged pull request's crate is carried into the quartermaster's depot, fading as it goes in; with motion off it isn't", () => {
  const { h, sceneOf, ground, ink } = positions();
  const pr = { number: 12, title: 'New cart', url: '', at: Date.now() };
  const crateWood = new Set(['#4e3626', '#c98d4f'].map(ink));
  /** The crates drawn at the depot, above its pallet (where an open one stands, y 57 and below 64, none here): their tops. */
  const carried = () => ground().rects.filter(([c, x, y]) => crateWood.has(c) && x >= 340 && x <= 370 && y < 64 && y > 36).map(r => r[2]);
  h.relayout(h.grid.layoutFor(sceneOf(position()).fields));
  h.setScene(sceneOf(position({ prs: { open: [pr], merged: [] } })));
  const before = carried().length;
  h.setScene(sceneOf(position({ prs: { open: [], merged: [pr] } })));
  const tops = [];
  for (let i = 0; i < 100 && (tops.length < 2 || carried().length > before); i++) { const c = carried(); if (c.length > before) tops.push(Math.min(...c)); h.tick(0.05, () => null); }
  assert.ok(tops.length > 10, `carried a while (${tops.length} frames)`);
  assert.ok(tops.at(-1) < tops[0], 'into the depot');
  assert.equal(carried().length, before, 'and in');
  h.setScene(sceneOf(position({ prs: { open: [{ ...pr, number: 13 }], merged: [pr] } })));
  h.setScene(sceneOf(position({ prs: { open: [], merged: [pr, { ...pr, number: 13 }] } })));
  h.tick(0, () => null, true);
  assert.equal(carried().length, before, 'drawn still (motion off): nothing is carried');
});

test("a position's sign: its name, a blue pennant for a branch other than main, the deploy's words (why, on hover), a worktree's repo, a collision, and its git counts with what they count", () => {
  const { h, window, M } = positions();
  const signs = (snap, priv = false) => {
    let scene = window.AgentvilleScene.toScene(snap);
    if (priv) scene = window.AgentvilleScene.privateScene(scene);
    scene = M.militaryScene(scene);
    h.relayout(h.grid.layoutFor(scene.fields)); h.setScene(scene);
    const labs = [];
    h.labels((x, y, html, cls = '', title = '') => labs.push({ x, y, html: String(html), cls, title }), {});
    return labs;
  };
  const words = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const signOf = labs => labs.find(l => l.html.includes('data-farm-field'));
  const titleOf = l => l.html.match(/title="([^"]*)"/)?.[1] ?? '';
  const branch = signOf(signs(position({ branch: 'feature/cart', ...deployed('failed', '✗ deploy failed', 'Build step failed') })));
  assert.match(branch.html, /px-flag/, 'a blue pennant on the sign');
  assert.match(words(branch.html), /shop/);
  assert.match(words(branch.html), /feature\/cart/);
  assert.match(words(branch.html), /✗ deploy failed/, 'the deploy, in words, under the name');
  assert.match(titleOf(branch), /Build step failed/, 'and why, on hover');
  assert.match(titleOf(branch), /on feature\/cart/);
  assert.doesNotMatch(signOf(signs(position({ branch: 'main' }))).html, /px-flag/, 'on main: no pennant');
  assert.match(words(signOf(signs(position({ worktree: true, main: '/Users/you/code/api' }))).html), /worktree of api/);
  const crowded = signOf(signs(position({ collision: 'high' })));
  assert.match(words(crowded.html), /⚠ crowded/);
  assert.equal(crowded.cls, 'bad');
  const counts = signs(position({ dirty: 3, ahead: 2, behind: 1 })).filter(l => l.cls === 'cnt').map(l => [words(l.html), l.title]);
  assert.deepEqual(counts, [['↓1', '1 commit behind the remote'], ['+3', '3 uncommitted files'], ['↑2', '2 unpushed commits']]);
  const priv = signOf(signs(position({ branch: 'feature/cart', ...deployed('failed', '✗ deploy failed', 'Build step failed') }), true));
  assert.doesNotMatch(priv.html, /px-flag|feature|Build step|deploy failed|shop/, 'privacy mode: no branch, no words, no name');
  for (const l of [branch, crowded, priv]) assert.doesNotMatch(readOf(l.html), FARM_OR_FACTORY);
});

test('fieldAt: a point on a position is its key (a click opens its close-up); the aisle, the track, an empty slot and the left side are none', () => {
  const { h } = positions();
  const L = h.relayout(h.grid.layoutFor([{ key: SHOP, name: 'shop' }])), [s] = L.ST;
  for (const [x, y] of [[s.cx, s.rowTop + 20], [s.cx - 40, s.rowTop], [s.cx + 40, s.rowTop + 56], [s.cx, s.rowTop + 50]]) assert.equal(h.fieldAt(x, y), SHOP, `${x},${y}`);
  for (const [x, y] of [[218, s.rowTop + 20], [s.cx, 84], [s.cx + 88, s.rowTop + 20], [56, 160], [s.cx, s.rowTop + 57]]) assert.equal(h.fieldAt(x, y), null, `${x},${y}`);
});

test('an empty slot is trampled grass with a faint outline', () => {
  const { window, ctx } = load();
  const h = window.hooks, ink = vm.runInContext('ink', ctx);
  const L = h.relayout(h.grid.layoutFor([{ key: SHOP, name: 'shop' }]));
  const ext = { x0: 0, x1: h.W, y0: 0, y1: L.H }, pix = new Map();
  h.bg((x, y, w, hh, c) => { for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + w; xx++) pix.set(`${xx},${yy}`, ink(c)); }, 'summer', ext);
  const grass = new Set(['#6aa84f', '#7fbf5a'].map(ink)), trampled = new Set(['#9ed36a', '#4f8f3a'].map(ink)); // flattened blades, boot prints
  assert.ok(L.empty.length >= 8);
  for (const s of L.empty) {
    const x0 = s.cx - 34, x1 = s.cx + 33, y0 = s.rowTop + 6, y1 = s.rowTop + 34, edge = [];
    for (let x = x0; x <= x1; x++) edge.push(pix.get(`${x},${y0}`), pix.get(`${x},${y1}`));
    for (let y = y0; y <= y1; y++) edge.push(pix.get(`${x0},${y}`), pix.get(`${x1},${y}`));
    const marked = edge.filter(c => !grass.has(c)).length;
    assert.ok(marked >= edge.length * 0.3, `slot ${s.i}: an outline (${marked} of ${edge.length})`);
    let flat = 0;
    for (let y = y0 + 2; y < y1 - 1; y++) for (let x = x0 + 2; x < x1 - 1; x++) {
      const c = pix.get(`${x},${y}`);
      assert.ok(grass.has(c) || trampled.has(c), `slot ${s.i}: only grass inside, some of it trampled (${x},${y} ${c})`);
      if (trampled.has(c)) flat++;
    }
    assert.ok(flat >= 10, `slot ${s.i}: trampled (${flat} flattened pixels)`);
  }
});
