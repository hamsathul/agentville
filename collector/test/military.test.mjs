// The field exercise (web/worlds/military/): its soldiers (people-kit soldiers in a field jacket of the
// agent's colour, khaki trousers and headgear picked by the agent's id; codex agents with a slate stripe
// down the jacket), the world's registration on the engine, and its base: the sky over a clipped hedge,
// the buildings at the back, the track, the left side's tents, and where every soldier stands. Its
// positions: fortified as the context fills, what each repo's state puts round them, their signs, and
// the news setScene tells (Advanced!, Supplies in!, a deploy failing or going through). Its limits: the
// alert level (the 5-hour limit), the fuel depots (the week, one for each Claude account), and night. What
// soldiers hold (the world's props kit, in drill words), what is on and over them, their drones and the K9,
// the drone pad, the jeeps from the vehicle park, and the dispatch riders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkWorldJson } from '../worlds.mjs';
import { goldenSnapshot } from '../../scripts/golden/fixture.mjs';
import { creatureProblems } from '../../scripts/lib/world-vm.mjs';

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
/**
 * The SDK and the field exercise in a vm; the hooks it gives the engine are kept as window.hooks. `wrap(hooks)` may
 * change them before the engine takes them (to watch one); `raf` is the frame's requestAnimationFrame (none by default).
 */
function load({ wrap = null, raf = () => 0 } = {}) {
  const dom = stubDom();
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: raf, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} });
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
 * its tooltips and labels (each title="…" and aria-label="…", unescaped); without the drill's compounds.
 */
const readOf = t => [String(t).replace(/<[^>]*>/g, ' '), ...[...String(t).matchAll(/\b(?:title|aria-label)="([^"]*)"/g)].map(m => unescaped(m[1]))].join('\n').replace(DRILL_COMPOUNDS, ' ');
// The hud's state as the engine gives it (the Menu open, so all of it is there to read).
const HUD_STATE = { still: true, zoom: 1, saysOn: true, skyMode: 'live', seasonMode: 'live', seasons: true, follow: false, canFollow: false, restingHidden: null, bell: false, nav: {}, panelOpen: true, animals: true };
/**
 * Everything the world says to a person about a scene: help, building tips and dialogs, the signs, each soldier's tip,
 * log lines and pop-ups; and the panel and Menu, live and held at max.
 */
function wordsOf(h, scene) {
  h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const texts = [['help', h.help()], ['startText', h.startText(1)], ['startText', h.startText(7)], ['arriveText', h.arriveText], ['boardTitle', h.boardTitle]];
  for (const seasonMode of ['live', 'winter']) texts.push([`hud ${seasonMode}`, h.hud({ ...HUD_STATE, seasonMode, seasonNames: h.seasonNames, menuOpen: true })]);
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

test('no farm or factory words: the help, every building tip and dialog, the signs, each soldier\'s tip, log line and pop-up, and the panel and Menu are in drill words', () => {
  const { window, M } = load();
  const h = window.hooks;
  assert.equal(h.boardTitle, 'The briefing board: what your projects remember', "the briefing board's dialog title (the engine's board)");
  assert.equal(h.startText(1), 'Muster: <b>1</b> soldier on the base');
  assert.equal(h.startText(7), 'Muster: <b>7</b> soldiers on the base');
  assert.equal(h.arriveText, 'jumps down from the truck');
  const texts = [];
  const mascots = plain(h.animals()); // the mascots' names, menus and lines (the gags' role "farmer" is the kit's word, never shown)
  for (const c of mascots.cast) texts.push([`creature ${c.kind}`, [c.name, ...c.actions.map(a => a.label), ...Object.values(c.lines).flat()].join('\n')]);
  for (const g of [...mascots.gags, ...mascots.play]) texts.push([`gag ${g.id}`, Object.values(g.lines ?? {}).flat().join('\n')]);
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
  for (const said of ['ON THE BASE', 'Alert: max', 'How to read the base', 'Zoom out']) assert.ok(tips.includes(said), `the sweep reads the panel and Menu: "${said}"`);
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
  assert.equal(line('b0'), 'digging in at the shop position', "at a position: its step in drill words (the world's kit's verb)");
  const pops = id => { const out = []; h.onMove(f(id), h.slots(f(id)).zone, 'somewhere', t => out.push(t)); return out; };
  assert.deepEqual(pops('t0'), ['Done!']);
  assert.deepEqual(pops('w0'), ['Needs you!']);
  assert.deepEqual(pops('s0'), ['…zzz']);
  assert.deepEqual(pops('n0'), ['…zzz']);
  assert.deepEqual(pops('i0'), []);
  const tip = h.tip(f('b0'));
  for (const part of ['b0', 'digging in at the shop position', '% context left', '$0.40 so far']) assert.ok(tip.includes(part), `the tip has "${part}": ${tip}`);
});

test("the private scene: what a person reads (the panel and Menu too) has no undefined, NaN or [object], no farm or factory word, and none of the snapshot's real names, titles, branches or services", () => {
  const { window, M } = load();
  const h = window.hooks, snap = goldenSnapshot();
  const scene = M.militaryScene(window.AgentvilleScene.privateScene(window.AgentvilleScene.toScene(snap)));
  const texts = wordsOf(h, scene);
  assert.ok(texts.some(([where, t]) => where === 'hud live' && /ON THE BASE/.test(t)), 'the panel and Menu are read');
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
  // a Windows path has backslashes, and a long name is cut in the middle, so the label never runs over its neighbours
  assert.match(words(signOf(signs(position({ worktree: true, main: `C:${String.fromCharCode(92)}Users${String.fromCharCode(92)}you${String.fromCharCode(92)}code${String.fromCharCode(92)}api` }))).html), /worktree of api/);
  const longName = words(signOf(signs(position({ worktree: true, main: '/Users/you/code/a-repository-with-a-very-long-name' }))).html);
  assert.match(longName, /worktree of a-reposi…ng-name$/);
  assert.doesNotMatch(longName, /a-repository-with-a-very-long-name/);
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

/* ---------- the limits: the alert level for the 5-hour limit, the fuel depots for the week, and night ---------- */

const RESETS = Date.UTC(2026, 9, 13, 9, 0), LEVELS = ['spring', 'summer', 'autumn', 'winter'];
const SKY_DAY = { phase: 'day', light: 1, sun: { x: 170, y: 12 }, moon: null }, SKY_NIGHT = { phase: 'night', light: 0, sun: null, moon: { x: 230, y: 2 } };
/** The shop's position with a plan: the 5-hour limit's % used and the week's (null: no window of that kind); `over` goes in each window. */
function planned(five, week, over = {}) {
  const w = (kind, pct) => (pct === null ? [] : [{ kind, percentUsed: pct, resetsAt: RESETS, ...over }]);
  return { ...position(), plan: { from: 'test', at: TOUR_NOW, windows: [...w('five_hour', five), ...w('seven_day', week)] } };
}
/** Fills entirely inside a box [x, y, w, h]. */
const inBox = ([bx, by, bw, bh]) => ([, x, y, w, hh]) => x >= bx && y >= by && x + w <= bx + bw && y + hh <= by + bh;
/** The colour last painted at a point, of these fills. */
const lastAt = (rects, x, y) => rects.reduce((c, [col, rx, ry, w, hh]) => (x >= rx && x < rx + w && y >= ry && y < ry + hh ? col : c), null);
/** The field exercise drawn for a snapshot under a sky: the fills of the ground each frame, of the sky (weather) and of what is over everything (top); and the lights pushed while drawing. */
function limits() {
  const p = positions();
  const frame = (snap, sky = SKY_DAY) => {
    if (snap) { const scene = p.sceneOf(snap); p.h.relayout(p.h.grid.layoutFor(scene.fields)); p.h.setScene(scene); }
    p.PXG.lights = [];
    const fills = draw => { p.dom.calls.rects.length = 0; draw(); return p.dom.calls.rects.map(r => [...r]); };
    return { ground: fills(() => p.h.ground()), sky: fills(() => p.h.weather(sky)), top: fills(() => p.h.top()), pushed: [...p.PXG.lights] };
  };
  return { ...p, frame };
}

test("season(): the alert level by the 5-hour limit, at the farm's bounds (calm, ready, high, max); ready with no reading or a % that isn't a number; calm again in a new window", () => {
  const { h, sceneOf } = positions();
  assert.equal(typeof h.season, 'function', 'the field exercise gives its own season(): the engine gives it the Alert switch');
  const alertOf = snap => { h.setScene(sceneOf(snap)); return h.season(); };
  assert.deepEqual([10, 40, 70, 95].map(p => alertOf(planned(p, 20))), LEVELS, 'calm, ready, high, max');
  assert.deepEqual([0, 24, 25, 59, 60, 84, 85, 100].map(p => alertOf(planned(p, 20))), ['spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter'], "the farm's seasonOf bounds: 25, 60, 85");
  assert.equal(alertOf({ ...position(), plan: null }), 'summer', 'no plan reading: ready');
  assert.equal(alertOf(planned(null, 50)), 'summer', 'no 5-hour window: ready');
  for (const odd of [undefined, null, 'lots', NaN]) {
    const snap = planned(95, 50);
    snap.plan.windows[0].percentUsed = odd;
    assert.equal(alertOf(snap), 'summer', `a 5-hour window whose % is ${String(odd)}: no reading, ready (not max)`);
  }
  assert.equal(alertOf(planned(95, 50, { reset: true })), 'spring', 'a new 5-hour window: calm again');
});

test('the alert drawn is the level shown (PXG.season, which the Alert switch may hold), else the live one: the alert board green, yellow, amber or red, its bars lit by the level; at max a red beacon spins on it', () => {
  const { PXG, ink, frame } = limits();
  const BOARD = [129, 25, 9, 11], BEACON = [124, 12, 19, 12];
  const beaconOf = rects => rects.filter(r => r[0] === ink('#ff6b6b') && inBox(BEACON)(r));
  frame(planned(10, 20)); // live: calm
  const faces = {}, bars = {};
  for (const level of LEVELS) {
    PXG.season = level;
    const { ground } = frame();
    faces[level] = lastAt(ground, 130, 26);
    bars[level] = ground.filter(r => r[0] === ink('#ffffff') && inBox(BOARD)(r)).length;
  }
  assert.deepEqual(faces, { spring: ink('#6cc04a'), summer: ink('#ffd43b'), autumn: ink('#f08a24'), winter: ink('#e04a3a') }, 'the board green at calm, yellow at ready, amber at high, red at max');
  assert.deepEqual(bars, { spring: 1, summer: 2, autumn: 3, winter: 4 }, 'and one bar lit for each step up');
  PXG.season = 'winter';
  assert.ok(beaconOf(frame().top).length > 0, 'held at max while the live level is calm: the beacon lit');
  const turns = new Set([0, 0.15, 0.3, 0.45, 0.6].map(T => { PXG.T = T; return JSON.stringify(frame().top.filter(inBox(BEACON))); }));
  assert.ok(turns.size >= 3, `it spins: its flash and its beam go round (${turns.size} pictures)`);
  for (const level of ['spring', 'summer', 'autumn']) { PXG.season = level; assert.equal(beaconOf(frame().top).length, 0, `${level}: the beacon dark`); }
  frame(planned(95, 20)); // live: max
  PXG.season = 'spring';
  assert.equal(beaconOf(frame().top).length, 0, 'held at calm while the live level is max: dark');
  PXG.season = null;
  assert.ok(beaconOf(frame().top).length > 0, 'live and max: the beacon spins');
});

test('the flags by the level shown: hanging limp at calm, flying at ready and high, snapping at max; soldiers stroll at calm, walk faster when high, and move at the double at max', () => {
  const { h, PXG, frame } = limits();
  frame(planned(30, 20));
  // the first pole's flag (its pole at x 20): no one on the base, so the cheerful set's first colour, red, exact
  const flagOf = sky => sky.filter(([c, x, y, w, hh]) => c === '#e04a3a' && w === 1 && hh >= 2 && x >= 21 && x <= 31 && y <= 7);
  const at = level => { PXG.season = level; return flagOf(frame().sky); };
  PXG.T = 3;
  const limp = at('spring'), flying = at('summer'), high = at('autumn'), snapping = at('winter');
  assert.ok(limp.length >= 2 && limp.every(([, x]) => x <= 23) && limp.some(r => r[4] >= 6), 'calm: it hangs down by its pole');
  assert.deepEqual(flying.map(r => r[1]), [21, 22, 23, 24, 25, 26, 27, 28], 'ready: it flies out from its pole');
  assert.equal(high.length, 8, 'high: it flies');
  assert.ok(snapping.length >= 9, 'max: it stands straight out in the wind');
  const changes = level => new Set(Array.from({ length: 10 }, (_, i) => { PXG.T = 3 + i * 0.03; return JSON.stringify(at(level)); })).size;
  assert.ok(changes('winter') > changes('summer'), `max: it snaps, changing faster than it flies at ready (${changes('winter')} pictures to ${changes('summer')})`);
  const speeds = LEVELS.map(level => { PXG.season = level; return h.speed({ id: 'x' }); });
  assert.ok(speeds.every((v, i) => i === 0 || v > speeds[i - 1]), `slower at calm, faster each level up: ${speeds}`);
  PXG.season = 'summer';
  assert.equal(h.speed({ id: 'x' }), 40, "ready: the farm's walk");
  assert.ok(h.speed({ id: 'x', fast: true }) > 40, 'fast mode walks faster');
  PXG.season = null;
});

test("from high, the base's lights warm: the lanterns along the track lit by day, HQ's lamp glowing; at calm and ready, unlit", () => {
  const { M, PXG, ink, frame } = limits();
  frame(planned(30, 20));
  const lit = level => { PXG.season = level; const { ground } = frame(); return M.LANTERNS.filter(x => ground.some(r => r[0] === ink('#ffd43b') && inBox([x - 1, 87, 3, 3])(r))).length; };
  assert.ok(M.LANTERNS.length >= 5, `lanterns along the track (${M.LANTERNS.length})`);
  for (const x of M.LANTERNS) for (const c of [116, 218, 306]) assert.ok(Math.abs(x - c) > 8, `the lantern at ${x} keeps off the path at ${c}`);
  assert.deepEqual(LEVELS.map(lit), [0, 0, M.LANTERNS.length, M.LANTERNS.length], 'lit at high and max, not at calm or ready');
  const glow = level => { PXG.season = level; return frame().ground.filter(r => r[0] === ink('#ffe8a3') && inBox([192, 46, 17, 17])(r)).length; };
  assert.ok(glow('autumn') > glow('summer'), "HQ's lamp glows over its map table");
  PXG.season = null;
});

test('the fuel depot: 8 drums, round(8 × (1 − week)) of them full; its lamp green, amber from 70%, blinking red from 90%; no reading, no drum full and the lamp off', () => {
  const { M, PXG, ink, frame } = limits();
  const weekly = (pct, over = {}) => ({ windows: [{ kind: 'seven_day', percentUsed: pct, resetsAt: RESETS, ...over }] });
  for (const [week, drums, lamp, pct = week] of [[0, 8, 'green'], [50, 4, 'green'], [69, 2, 'green'], [69.6, 2, 'amber', 70], [70, 2, 'amber'], [89, 1, 'amber'], [89.6, 1, 'red', 90], [90, 1, 'red'], [100, 0, 'red']]) {
    const d = plain(M.depotOf(weekly(week)));
    assert.deepEqual([d.drums, d.lamp, d.pct], [drums, lamp, pct], `${week}% of the week: the drums and the lamp go by the % it shows`);
  }
  assert.equal(M.depotOf(weekly(95, { reset: true })).drums, 8, 'a new week: every drum full');
  for (const plan of [null, { windows: [] }, { windows: [{ kind: 'five_hour', percentUsed: 50 }] }, weekly(undefined), weekly(null), weekly('lots'), weekly(NaN)]) assert.equal(M.depotOf(plan), null, `no reading: ${JSON.stringify(plan)}`);
  const [x] = M.DEPOT_X, drums = plain(M.drumsOf(x)), LAMP = [x + 10, 26, 4, 2];
  assert.equal(drums.length, 8);
  for (const [dx, dy] of drums) assert.ok(dx >= x + 2 && dx + 4 <= x + 22 && dy >= 36 && dy + 8 <= 72, `the drum at ${dx},${dy}: on a shelf, inside the depot`);
  const drawn = (week, T = 0) => {
    PXG.T = T;
    const { ground } = frame(week === null ? { ...position(), plan: null } : planned(30, week));
    const full = drums.filter(([dx, dy]) => ground.some(r => r[0] === ink(M.FUEL) && inBox([dx, dy, 4, 8])(r))).length;
    return { full, lamp: ground.filter(inBox(LAMP)).map(r => r[0]) };
  };
  assert.deepEqual([0, 50, 69.6, 90, 100].map(w => drawn(w).full), [8, 4, 2, 1, 0], 'drawn: 8, 4, 2, 1 and 0 drums full');
  assert.ok(drawn(50).lamp.includes(ink('#6cc04a')), 'the lamp green');
  assert.ok(drawn(75).lamp.includes(ink('#f0b429')) && drawn(75, 0.3).lamp.includes(ink('#f0b429')), 'amber, steady');
  const red = [0, 0.3, 0.6, 0.9].map(T => drawn(95, T).lamp.includes(ink('#e04a3a')));
  assert.ok(red.includes(true) && red.includes(false), `red, blinking (${red})`);
  const none = drawn(null);
  assert.deepEqual([none.full, none.lamp.length], [0, 0], 'no reading: no drum full, the lamp off');
  const bad = drawn(undefined);
  assert.deepEqual([bad.full, bad.lamp.length], [0, 0], 'a weekly window with no number: as no reading');
});

test("the fuel depot's tip and dialog give the week's % and when it resets; with no reading they say so", () => {
  const { h, sceneOf } = positions();
  const resets = new Date(RESETS).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  h.setScene(sceneOf(planned(30, 72)));
  const tip = h.buildingTip('bank');
  assert.match(tip, /fuel depot/);
  assert.match(tip, /72% used, 2 of 8 drums left/);
  assert.ok(tip.includes(`resets ${resets}`), tip);
  const dialog = plain(h.dialog('bank'));
  assert.equal(dialog.title, 'The fuel depot: your plan');
  assert.match(dialog.html, /30% used/);
  assert.match(dialog.html, /72% used/);
  assert.ok(dialog.html.includes(`resets ${resets}`), 'the dialog says when each resets');
  assert.match(dialog.html, /The drums are the week; the alert level is the 5-hour limit/);
  h.setScene(sceneOf(planned(30, 72, { reset: true })));
  assert.match(h.buildingTip('bank'), /just reset/);
  h.setScene(sceneOf(planned(30, 69.6)));
  assert.match(h.buildingTip('bank'), /70% used, 2 of 8 drums left/, 'the % it shows is the one the lamp and drums go by');
  h.setScene(sceneOf(planned(30, undefined)));
  const bad = h.buildingTip('bank');
  assert.match(bad, /no reading/, 'a weekly window with no number: no reading');
  assert.doesNotMatch(bad, /NaN|undefined/);
  assert.doesNotMatch(h.dialog('bank').html, /NaN|undefined/, 'nor in its dialog');
  assert.match(h.dialog('bank').html, /no reading/);
  h.setScene(sceneOf({ ...position(), plan: null }));
  const none = h.buildingTip('bank');
  assert.match(none, /no reading/);
  assert.match(h.dialog('bank').html, /No reading of your plan yet/);
  for (const t of [tip, none, dialog.html]) assert.doesNotMatch(readOf(t), FARM_OR_FACTORY);
});

/** A Claude account as the collector sends it: its name, and its plan's 5-hour and weekly % (both null: no reading). */
const account = (name, five, week) => ({ key: name, name, plan: five === null && week === null ? null : planned(five, week).plan });
/** The shop's position, the plan the first account's (as the collector sends it), and these accounts. */
const accounts = (...list) => ({ ...planned(30, 40), accounts: list });
const TWO = accounts(account('work', 30, 40), account('home', 95, 92));

test("depotsOf: a fuel depot for each Claude account, two at most, the first where it always stood; with one account, the plan's and no name", () => {
  const { M, sceneOf } = positions();
  const depots = snap => plain(M.depotsOf(sceneOf(snap)).map(d => [d.x, d.name, d.depot?.pct ?? null, d.depot?.drums ?? null]));
  const [first, second] = M.DEPOT_X;
  assert.equal(first, 286, 'the first where it always stood');
  assert.ok(second >= 2 && second + 26 <= 30, `the second left of the motor pool gate (x ${second}–${second + 24}, its roof and shadow a pixel more each side)`);
  assert.deepEqual(depots(planned(30, 40)), [[first, null, 40, 5]], "no accounts (an older collector): the plan's depot");
  assert.deepEqual(depots(accounts(account('work', 30, 40))), [[first, null, 40, 5]], 'one account: no name on it');
  assert.deepEqual(depots(TWO), [[first, 'work', 40, 5], [second, 'home', 92, 1]], "two: each its own account's week");
  assert.deepEqual(depots(accounts(account('work', 30, 40), account('home', 95, 92), account('lab', 5, 5))), [[first, 'work', 40, 5], [second, 'home', 92, 1]], 'three: the first two');
  assert.deepEqual(depots(accounts(account('work', 30, 40), account('home', null, null))), [[first, 'work', 40, 5], [second, 'home', null, null]], 'a missing plan: no reading');
  assert.deepEqual(depots(accounts({ key: 'a', plan: null }, { key: 'b', name: '', plan: null })).map(d => d[1]), ['account 1', 'account 2'], 'a nameless account: by its number');
  assert.deepEqual(depots({ ...position(), plan: null }), [[first, null, null, null]], 'no plan reading');
});

test('buildingAt: with two accounts, the second fuel depot is a depot too; with one, the ground there is none', () => {
  const { h, sceneOf, M } = positions();
  const scene = sceneOf(planned(30, 40)), x = M.DEPOT_X[1];
  h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const inside = [[x + 12, 50], [x, 20], [x + 24, 78], [x + 12, 30]];
  for (const [px, py] of inside) assert.equal(h.buildingAt(px, py), null, `one account: ${px},${py} is the ground`);
  h.setScene(sceneOf(TWO));
  for (const [px, py] of inside) assert.equal(h.buildingAt(px, py), 'bank', `two accounts: ${px},${py} is the second depot`);
  assert.equal(h.buildingAt(298, 50), 'bank', 'the first where it stood');
  assert.equal(h.buildingAt(60, 50), 'barn', 'the motor pool gate beside it');
  assert.equal(h.buildingAt(x + 25, 50), null, 'a gap between the second depot and the gate');
});

test("the second depot: drawn only with two accounts, left of the motor pool gate, its drums full from its own account's week, its lamp by it", () => {
  const { M, PXG, ink, frame } = limits();
  const [first, second] = M.DEPOT_X;
  const full = (rects, x) => M.drumsOf(x).filter(([dx, dy]) => rects.some(r => r[0] === ink(M.FUEL) && inBox([dx, dy, 4, 8])(r))).length;
  const lamp = (rects, x) => lastAt(rects, x + 11, 26);
  PXG.T = 0;
  const one = frame(accounts(account('work', 30, 40))).ground;
  assert.equal(one.filter(inBox([0, 18, 30, 60])).length, 0, 'one account: nothing drawn left of the gate each frame');
  assert.equal(full(one, first), 5, "the depot: the plan's week, 40%");
  const two = frame(accounts(account('work', 30, 40), account('home', 30, 75))).ground;
  assert.ok(two.some(r => r[0] === ink('#ffd43b') && inBox([second, 20, 24, 56])(r)), 'two: the second depot drawn, its fuel sign on it');
  assert.equal(full(two, first), 5, "the first: work's week, 40%");
  assert.equal(full(two, second), 2, "the second: home's week, 75%");
  assert.equal(lamp(two, first), ink('#6cc04a'), 'the first lamp green');
  assert.equal(lamp(two, second), ink('#f0b429'), 'the second amber');
  const none = frame(accounts(account('work', 30, 40), account('home', null, null))).ground;
  assert.ok(none.some(inBox([second, 20, 24, 56])), 'a second account with no reading still has its depot');
  assert.deepEqual([full(none, second), lamp(none, second)], [0, ink('#5f6b7a')], 'no drum full, its lamp off');
});

test("with two accounts: each depot's tag at its foot, its account's name and week; the tip says there is one for each account; the dialog each account's meters, and whose 5-hour limit sets the alert level", () => {
  const { h, sceneOf, M } = positions();
  const tags = snap => {
    const scene = sceneOf(snap);
    h.relayout(h.grid.layoutFor(scene.fields));
    h.setScene(scene);
    const out = [];
    h.labels((x, y, html, cls = '', title = '') => out.push({ x, y, html: String(html), cls, title }), {});
    return out.filter(l => /fuel depot/.test(l.title));
  };
  assert.deepEqual(tags(planned(30, 40)), [], 'one account: no tag (the drums show the week, the tip its %)');
  const oneTip = h.buildingTip('bank'), oneDialog = plain(h.dialog('bank'));
  tags(accounts(account('work', 30, 40)));
  assert.deepEqual([h.buildingTip('bank'), plain(h.dialog('bank'))], [oneTip, oneDialog], "one account: the plan's tip and dialog");
  const [work, home] = tags(TWO);
  for (const [tag, x, name, pct] of [[work, M.DEPOT_X[0], 'work', 40], [home, M.DEPOT_X[1], 'home', 92]]) {
    assert.ok(tag && Math.abs(tag.x - (x + 12)) <= 2 && tag.y >= 80 && tag.y <= 92, `${name}'s tag on the track at its depot's foot (${tag?.x},${tag?.y})`);
    assert.ok(tag.html.includes(`${name} ${pct}%`), `${name}'s tag: its name and week (${tag.html})`);
    assert.match(tag.title, new RegExp(`fuel depot of ${name}: its plan's weekly limit, ${pct}% used`));
  }
  assert.match(home.cls, /\bcnt\b/);
  assert.match(home.cls, /red/, 'nearly used up: the red tag');
  assert.doesNotMatch(work.cls, /red|amber/);
  const tip = h.buildingTip('bank');
  assert.match(tip, /fuel depots, one for each of your Claude accounts/);
  assert.match(tip, /work 40%, home 92%/);
  const d = h.dialog('bank'), [, first, second] = d.html.split('<h4>');
  assert.equal(d.title, "The fuel depots: your accounts' plans");
  assert.ok(first.startsWith('work</h4>') && /30% used/.test(first) && /40% used/.test(first), "work's meters under its name");
  assert.ok(second.startsWith('home</h4>') && /95% used/.test(second) && /92% used/.test(second), "home's under its");
  assert.match(d.html, /alert level follows work's 5-hour limit/);
  tags(accounts(account('work', 30, 40), { key: 'b', plan: null }));
  assert.match(h.dialog('bank').html, /<h4>account 2<\/h4><p class="muted">No reading yet/, 'a nameless account with no reading: by its number, and says so');
  assert.match(h.buildingTip('bank'), /account 2 no reading/);
  const help = h.help();
  assert.match(help, /two Claude accounts, each has a fuel depot \(the second left of the motor pool gate\)/);
  for (const t of [tip, d.title, d.html, help, ...[work, home].flatMap(l => [l.html, l.title])]) assert.doesNotMatch(readOf(t), FARM_OR_FACTORY);
});

test("lights(): HQ's lamp and windows, the tents' glow, the lanterns, the searchlights' heads, each depot's lamp, a green flare going up, a generator's lamp, and working soldiers' headgear lamps; the beacon only at max; the same drawn still", () => {
  const { h, M, PXG, sceneOf } = positions();
  const worker = person('w', { children: [{ id: 'j1', kind: 'bgjob', state: 'running', startedAt: TOUR_NOW }] }), idler = person('i', { state: 'idle', now: null });
  const scene = sceneOf({ ...position(deployed('ok'), [worker, idler]), plan: planned(30, 40).plan });
  const L = h.relayout(h.grid.layoutFor(scene.fields)), [s] = L.ST;
  h.setScene(scene);
  const at = { w: { x: s.cx, y: s.lane, walk: false }, i: { x: 46, y: 132, walk: false } }, posOf = id => at[id] ?? null;
  const near = (lights, [x, y], d = 3) => lights.some(([lx, ly]) => Math.abs(lx - x) <= d && Math.abs(ly - y) <= d);
  const cored = (lights, [x, y]) => lights.some(([, , , c]) => c && x >= c[0] && x < c[0] + c[2] && y >= c[1] && y < c[1] + c[3]);
  const within = (lights, [x0, y0, w, hh]) => lights.some(([x, y]) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + hh);
  const lamp = ([x, y]) => [x, y - 13]; // a soldier's headgear, over its face
  const shown = T => { PXG.T = T; return plain(h.lights()); };
  const check = (lights, when) => {
    assert.ok(lights.every(l => l.length === 4 && l.slice(0, 3).every(Number.isFinite)), `${when}: each [x, y, reach, the lit shape]`);
    assert.ok(cored(lights, [200, 54]), `${when}: HQ's lamp`);
    for (const x of [150, 246]) assert.ok(cored(lights, [x, 53]), `${when}: HQ's window at ${x}, lit from inside`);
    for (const x of [30, 78]) assert.ok(cored(lights, [x, 158]), `${when}: the reserve tent at ${x}, its doorway lit`);
    assert.ok(within(lights, [4, 98, 106, 20]), `${when}: the mess tent glows under its fly`);
    assert.ok(within(lights, [330, 39, 54, 25]), `${when}: the quartermaster's tent glows`);
    for (const x of M.LANTERNS) assert.ok(cored(lights, [x, 88]), `${when}: the lantern at ${x}`);
    for (const [x, y] of M.SEARCHLIGHTS) assert.ok(cored(lights, [x, y]), `${when}: the searchlight's head at ${x}`);
    assert.ok(near(lights, [M.DEPOT_X[0] + 12, 27]), `${when}: the fuel depot's lamp`);
    assert.ok(near(lights, lamp([s.cx, s.lane]), 1), `${when}: the working soldier's headgear lamp`);
    assert.ok(!near(lights, lamp([46, 132]), 1), `${when}: none for an idle one`);
  };
  h.tick(0.03, posOf);
  PXG.season = null;
  const live = shown(0.6);
  check(live, 'live');
  assert.ok(!near(live, M.BEACON, 2), 'below max: no beacon');
  const corner = [s.cx + 25, s.rowTop - 12, 15, 30], post = [s.cx - 30, s.rowTop + 5, 16, 12]; // the deploy's corner, over its canister; the post, where the generator hums
  assert.ok(within(shown(0.3), corner) && within(shown(1.5), corner) && !within(shown(2.3), corner), 'the green flare lights the night going up and as its star bursts; not between');
  assert.ok(within(shown(0.6), post) && !within(shown(0.2), post), "the generator's lamp, as it blinks");
  PXG.season = 'winter';
  assert.ok(near(shown(0.6), M.BEACON, 2), 'at max: the beacon glows');
  PXG.season = null;
  at.w.walk = true;
  assert.ok(!near(shown(0.6), lamp([s.cx, s.lane]), 4), 'not while it walks');
  at.w.walk = false;
  h.tick(0, posOf, true);
  check(shown(0.6), 'drawn still (motion off)');
});

test("top(), at night: the searchlights on HQ's roof sweep their beams slowly across the sky, and now and then a white illumination flare drifts down over the field, lighting it; by day neither; no tracers", () => {
  const { M, PXG, frame, ink } = limits();
  frame(planned(30, 20));
  PXG.season = null;
  const beams = rects => rects.filter(r => r[0] === ink(M.BEAM));
  const quiet = Array.from({ length: 2 * M.FLARE.every }, (_, i) => i).find(T => !M.flareAt(T) && !M.flareAt(T + 6.2)); // between two flares, for a while
  assert.equal(M.flareAt(quiet), null, 'the case under test: no flare then');
  PXG.T = quiet;
  const day = frame(null, SKY_DAY), night = frame(null, SKY_NIGHT);
  assert.equal(beams(day.top).length + day.pushed.length, 0, 'by day: no beam, nothing lit');
  const lit = beams(night.top);
  assert.ok(lit.length >= 20, `at night: the beams (${lit.length} rows)`);
  for (const [x, y] of M.SEARCHLIGHTS) assert.ok(lit.some(([, rx, ry, w]) => ry === y - 1 && rx <= x + 2 && rx + w >= x - 2), `a beam from the searchlight at ${x}`);
  assert.ok(lit.every(([, , y]) => y < M.SEARCHLIGHTS[0][1]) && lit.some(([, , y]) => y <= 1), 'rising from the heads up through the sky');
  assert.ok(night.pushed.filter(([, y]) => y < 18).length >= 4, 'their light goes along them (the night shows them)');
  PXG.T = quiet + 6;
  assert.notDeepEqual(beams(frame(null, SKY_NIGHT).top), lit, 'they sweep');
  const tips = [0, 0.2].map(dt => { PXG.T = quiet + dt; const rows = beams(frame(null, SKY_NIGHT).top).filter(r => r[2] === 0); return rows.map(r => r[1]); });
  assert.ok(tips[0].every((x, i) => Math.abs(x - tips[1][i]) <= 3), `slowly: their tips move a few pixels in a fifth of a second (${tips})`);
  // the illumination flare
  const times = Array.from({ length: 4 * M.FLARE.every }, (_, i) => i / 2), up = times.filter(T => M.flareAt(T));
  assert.ok(up.length > 0 && up.length < times.length / 2, `now and then: ${up.length} of ${times.length} moments`);
  const start = up.find(T => T > 0 && !M.flareAt(T - 0.5)), burn = []; // one flare, from when it lights to when it is gone
  for (let T = start; M.flareAt(T); T += 0.5) burn.push(M.flareAt(T));
  assert.ok(burn.every((f, i) => i === 0 || f.y >= burn[i - 1].y), 'it drifts down, never up');
  assert.ok(burn[0].y <= 18 && burn.at(-1).y >= 100, `from the sky down over the field (y ${burn[0].y} to ${burn.at(-1).y})`);
  assert.ok(burn.every(f => f.x >= 130 && f.x <= 396), 'over the field');
  const T = up.find(t => M.flareAt(t).y > 60), f = M.flareAt(T);
  PXG.T = T;
  const flareNight = frame(null, SKY_NIGHT), flareDay = frame(null, SKY_DAY);
  assert.ok(flareNight.top.some(r => r[0] === ink('#ffffff') && inBox([f.x - 2, f.y - 2, 4, 4])(r)), 'at night: the flare, burning white');
  assert.ok(flareNight.pushed.some(([x, y, reach]) => Math.abs(x - f.x) <= 1 && Math.abs(y - f.y) <= 1 && reach >= 15), 'its light over the field');
  assert.equal(flareDay.top.filter(r => inBox([f.x - 12, f.y - 14, 24, 24])(r)).length, 0, 'by day: none');
  const pale = new Set([M.BEAM, '#ffffff', '#e6eef5', '#c3cbd2', '#9c3b30'].map(ink));
  assert.deepEqual([...new Set(flareNight.top.map(r => r[0]))].filter(c => !pale.has(c)), [], 'at night, below max: only pale light over the base (no tracers)');
});

test('ambient: at night, the illumination flare trails a little smoke as it drifts down; none by day or between flares', () => {
  const { h, M, PXG, frame } = limits();
  frame(planned(30, 20));
  const T = Array.from({ length: 2 * M.FLARE.every }, (_, i) => i / 2).find(t => M.flareAt(t)?.y > 60), f = M.flareAt(T);
  const puffs = () => { const out = []; for (let i = 0; i < 40; i++) h.ambient(0.1, p => out.push(p)); return out; };
  PXG.T = T;
  frame(null, SKY_NIGHT);
  const smoke = puffs();
  assert.ok(smoke.length > 0, 'smoke, now and then');
  for (const p of smoke) assert.ok(Math.abs(p.x - f.x) <= 3 && Math.abs(p.y - f.y) <= 4 && p.vy <= 0 && p.alpha < 1, `at the flare, hanging or rising, thin (${p.x},${p.y})`);
  frame(null, SKY_DAY);
  assert.equal(puffs().length, 0, 'by day: none');
  PXG.T = Array.from({ length: 2 * M.FLARE.every }, (_, i) => i).find(t => !M.flareAt(t));
  frame(null, SKY_NIGHT);
  assert.equal(puffs().length, 0, 'at night between flares: none');
});

test('no plan reading: the alert is ready, the depot says there is no reading, and the Alert switch can still hold a level (held at max, the engine draws the beacon)', () => {
  const seen = {};
  const { window, dom, ctx, M } = load({ wrap: hooks => { hooks.hud = p => { seen.hud = p; return ''; }; } });
  const ink = vm.runInContext('ink', ctx);
  window.registered.start({ el: dom.make(), opts: { still: true }, prefs: { get: k => (k === 'season' ? 'winter' : null), set() {} } });
  dom.calls.rects.length = 0;
  window.registered.scene(window.AgentvilleScene.toScene({ ...position(), plan: null }));
  const h = window.hooks;
  assert.equal(h.season(), 'summer', 'live: ready');
  assert.match(h.buildingTip('bank'), /no reading/);
  assert.equal(seen.hud.seasons, true, 'the engine gives the field exercise its Alert switch');
  assert.equal(seen.hud.seasonMode, 'winter', '… held at max');
  assert.ok(dom.calls.rects.some(r => r[0] === ink('#ff6b6b') && inBox([124, 12, 19, 12])(r)), 'held at max: the beacon lit on the alert board');
  assert.ok(!M.drumsOf(M.DEPOT_X[0]).some(([x, y]) => dom.calls.rects.some(r => r[0] === ink(M.FUEL) && inBox([x, y, 4, 8])(r))), 'no drum full');
});

/* ---------- the panel and buttons: the engine's panelHud, in drill words ---------- */

/** Draws each icon as its rows (so a test can tell which icon a button shows) and keeps each one's palette. */
const ICON_STUB = "globalThis.iconsMade = []; makeSprite = (rows, pal) => { iconsMade.push({ rows, pal }); return { toDataURL: () => 'icon:' + rows.join('|') }; }";
/** The field exercise with its icons stubbed (ICON_STUB), on a crowded day with a plan: `five` % of the 5-hour limit used. */
function withPanel(five = 40) {
  const loaded = load(), { window, ctx, M } = loaded, h = window.hooks;
  vm.runInContext(ICON_STUB, ctx);
  const snap = crowd({ plan: { windows: [{ kind: 'five_hour', percentUsed: five, resetsAt: TOUR_NOW + 3_600_000 }, { kind: 'seven_day', percentUsed: 75, resetsAt: TOUR_NOW + 86_400_000 }] } });
  snap.agents[0].compactions = 2; snap.agents[1].compactions = 1; snap.agents[0].usage = { costUsd: 3.5 };
  const scene = M.militaryScene(window.AgentvilleScene.toScene(snap));
  h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const hud = (mode, over = {}) => h.hud({ ...HUD_STATE, seasonMode: mode, seasonNames: h.seasonNames, ...over });
  const icon = name => `url(icon:${M.ICONS[name].join('|')})`;
  /** The Alert switch's button, and the panel's alert line. */
  const alertParts = html => ({ button: /<button type="button" data-farm-season[^>]*>[\s\S]*?<\/button>/.exec(html)[0], line: /<span class="px-season"[\s\S]*?<\/span><\/div>/.exec(html)[0] });
  return { ...loaded, h, hud, icon, alertParts };
}

test("the panel and buttons are the engine's panelHud in drill words: soldiers, how often the line advanced, the alert level; every button the engine clicks", () => {
  const { h, hud } = withPanel();
  assert.equal(typeof h.hud, 'function');
  for (const mode of ['live', 'spring', 'winter']) {
    const html = hud(mode);
    assert.match(html, /class="px-stats"/, `${mode}: the panel`);
    assert.match(html, />\$15\.90</, `${mode}: what the sessions cost (31 soldiers at $0.40, one at $3.50)`);
    assert.match(html, />3 advanced</, `${mode}: three compactions, the line advanced three times`);
    assert.match(html, /<b class="advance"><\/b>/, `${mode}: beside it a flag of the base's own, not the farm's basket`);
    for (const attr of ['data-farm-panel', 'data-farm-need', 'data-farm-menu', 'data-farm-nav="list"', 'data-farm-nav="worlds"', 'data-farm-nav="session"', 'data-farm-nav="broadcast"', 'data-farm-nav="chats"', 'data-farm-follow', 'data-farm-resting', 'data-farm-bubbles', 'data-farm-animals', 'data-farm-sky', 'data-farm-season', 'data-farm-motion', 'data-farm-bell', 'data-farm-help', 'data-farm-zoom="0"']) assert.ok(html.includes(attr), `${mode}: ${attr}`);
    const read = readOf(html);
    assert.doesNotMatch(read, FARM_OR_FACTORY, mode);
    assert.doesNotMatch(read, /\bseasons?\b/i, `${mode}: the switch and its tooltips say alert`);
    for (const word of ['soldier', 'base', 'alert level', 'Alert: ']) assert.ok(read.includes(word), `${mode}: says ${word}`);
  }
});

test("its buttons are in the engine's Menu, top right: the dashboard's (Broadcast and Chats too), then the base's switches ON THE BASE, the bell, help and zoom; nothing along the bottom", () => {
  const { h, icon } = withPanel();
  const shut = h.hud({ ...HUD_STATE, seasonNames: h.seasonNames }), open = h.hud({ ...HUD_STATE, seasonNames: h.seasonNames, menuOpen: true });
  const nav = shut.slice(shut.indexOf('<div class="px-nav">'));
  const menuBtn = /<button type="button" data-farm-menu[^>]*>[\s\S]*?<\/button>/.exec(nav)[0];
  assert.match(menuBtn, /aria-expanded="false" title="The dashboard's buttons, the base's switches, the bell, help and zoom"/);
  assert.ok(menuBtn.includes(icon('menu')) && /class="px-sr">Menu</.test(menuBtn), "its button: the base's menu icon, and the word Menu");
  assert.match(nav, /class="px-menu" role="group" aria-label="Menu" hidden>/);
  const menu = nav.slice(nav.indexOf('class="px-menu"'));
  const heads = [...menu.matchAll(/<div class="px-menu-h">[\s\S]*?class="px-sr">([^<]*)</g)].map(m => m[1]);
  assert.deepEqual(heads, ['DASHBOARD', 'ON THE BASE'], "its headings: the dashboard's, then the base's own");
  for (const [what, name] of [['broadcast', 'broadcast'], ['chats', 'chats'], ['list', 'list'], ['worlds', 'world']]) assert.ok(new RegExp(`data-farm-nav="${what}"[^>]*>[\\s\\S]*?</button>`).exec(menu)[0].includes(icon(name)), `${what}: the base's icon`);
  const at = s => menu.indexOf(s);
  for (const attr of ['data-farm-nav="list"', 'data-farm-nav="broadcast"', 'data-farm-nav="chats"', 'data-farm-follow', 'data-farm-season', 'data-farm-bell', 'data-farm-help', 'data-farm-zoom="1"']) assert.ok(at(attr) > 0, `${attr} is in the menu`);
  assert.ok(at('DASHBOARD') < at('data-farm-nav="list"') && at('ON THE BASE') < at('data-farm-follow') && at('data-farm-nav="theme"') < at('ON THE BASE'), 'each heading over its buttons');
  assert.doesNotMatch(shut, /px-tools/, 'no row along the bottom');
  assert.match(open, /data-farm-menu aria-expanded="true"/);
  assert.doesNotMatch(open, /class="px-menu"[^>]*hidden/);
});

test("the Alert switch and the panel: the alert board by HQ for each level (its face green, yellow, amber or red, a bar lit for each step up, its beacon lit at max); live follows the 5-hour limit, a held level shows its 📌 and the real use", () => {
  const { M, ctx, hud, icon, alertParts } = withPanel(40);
  const levels = ['calm', 'ready', 'high', 'max'];
  for (const name of levels) assert.ok(M.ICONS[name].length === 9 && M.ICONS[name].every(r => /^[.PFSwdRL]{9}$/.test(r)), `${name}: 9 rows of 9 known letters`);
  assert.equal(new Set(levels.map(n => M.ICONS[n].join())).size, 4, 'four boards, no two alike');
  assert.deepEqual(levels.map(n => M.ICONS[n].filter(r => r.includes('PFwwwFP')).length), [1, 2, 3, 4], 'a bar lit for each step up');
  assert.deepEqual(levels.map(n => M.ICONS[n][0].includes('R')), [false, false, false, true], 'the beacon lit only at max');
  for (const mode of LEVELS) hud(mode); // each level's board drawn
  const pal = name => vm.runInContext('iconsMade', ctx).find(s => s.rows.join() === M.ICONS[name].join())?.pal ?? {};
  assert.deepEqual(levels.map(n => [pal(n).F, pal(n).S]), [['#6cc04a', '#3f9b3a'], ['#ffd43b', '#f0b429'], ['#f08a24', '#c8681a'], ['#e04a3a', '#9c3b30']], "each board's face and unlit bars in the colours of the board by HQ at that level");
  const live = alertParts(hud('live'));
  assert.ok(live.button.includes(icon('ready')) && /Alert: live/.test(live.button), 'live at 40%: the switch shows the ready board, and says live');
  assert.ok(live.line.includes(icon('ready')) && />ready</.test(live.line) && !live.line.includes('📌'), "the panel's line: ready, live");
  assert.match(live.line, /title="The alert level follows your plan&#39;s 5-hour limit: 40% used\. Calm while it is fresh, then ready and high; max when it is nearly used up/);
  for (const [mode, name] of [['spring', 'calm'], ['autumn', 'high'], ['winter', 'max']]) {
    const held = alertParts(hud(mode));
    assert.ok(held.button.includes(icon(name)) && new RegExp(`Alert: ${name}<`).test(held.button), `held ${name}: its board and its name on the switch`);
    assert.ok(held.line.includes(icon(name)) && /📌/.test(held.line) && /· 5-hour 40%/.test(held.line), `held ${name}: the panel shows it with a 📌 and the real 5-hour use`);
    assert.match(held.line, new RegExp(`title="Held at ${name} by the Alert switch, not live\\. The live alert level would be ready \\(your plan&#39;s 5-hour limit: 40% used\\)\\. The switch goes back to live after max"`));
  }
  assert.match(alertParts(withPanel(95).hud('live')).line, /title="The alert level follows your plan&#39;s 5-hour limit: 95% used/, 'live at 95%: the tip follows the plan');
  assert.ok(alertParts(withPanel(95).hud('live')).line.includes(icon('max')), '… and the panel shows the max board');
});

test("the panel with no plan reading: the alert level is ready and its tooltip says there is no reading yet, a % that isn't a number counts as none; a held level says no 5-hour reading", () => {
  const { window, M, ctx } = load(), h = window.hooks;
  vm.runInContext(ICON_STUB, ctx);
  const state = { ...HUD_STATE, seasonNames: h.seasonNames };
  for (const plan of [null, { windows: [{ kind: 'five_hour', percentUsed: 'lots', resetsAt: TOUR_NOW }] }]) {
    h.setScene(M.militaryScene(window.AgentvilleScene.toScene(crowd({ plan }))));
    const live = h.hud(state), held = h.hud({ ...state, seasonMode: 'autumn' }), what = plan ? 'a % that is no number' : 'no plan';
    assert.match(live, /title="The alert level follows your plan&#39;s 5-hour limit \(no reading yet: ready\)/, what);
    assert.ok(live.includes(`url(icon:${M.ICONS.ready.join('|')})`), `${what}: the ready board`);
    assert.match(held, /title="Held at high by the Alert switch, not live\. The live alert level would be ready \(your plan&#39;s 5-hour limit: no reading yet\)/, what);
  }
  h.setScene(M.militaryScene(window.AgentvilleScene.toScene(crowd())));
  assert.match(h.hud({ ...state, seasonMode: 'autumn' }), /· no 5-hour reading/);
  h.setScene(M.militaryScene(window.AgentvilleScene.toScene(crowd({ plan: { windows: [{ kind: 'five_hour', percentUsed: 97, reset: true, resetsAt: TOUR_NOW }] } }))));
  assert.match(h.hud(state), /title="The alert level follows your plan&#39;s 5-hour limit: just reset\./, 'a new window: just reset');
});

test("with two Claude accounts, the panel has a gauge for each (its name and week), as the base has a fuel depot for each; a nameless one is account N; the alert level is the first's", () => {
  const { window, M } = load(), h = window.hooks;
  h.setScene(M.militaryScene(window.AgentvilleScene.toScene(TWO)));
  const html = h.hud({ ...HUD_STATE, seasonNames: h.seasonNames });
  assert.deepEqual([...html.matchAll(/class="px-gauge" title="(Your [^"]*)"/g)].map(m => m[1]), ['Your work account: 40% of its week, 30% of its 5 hours (from the mod)', 'Your home account: 92% of its week, 95% of its 5 hours (from the mod)']);
  assert.match(html, /The alert level follows your plan&#39;s 5-hour limit: 30% used/);
  h.setScene(M.militaryScene(window.AgentvilleScene.toScene(accounts(account('work', 30, 40), { ...account('home', 95, 92), name: '' }))));
  const nameless = h.hud({ ...HUD_STATE, seasonNames: h.seasonNames, menuOpen: true });
  assert.ok(nameless.includes('title="Your account 2: 92% of its week, 95% of its 5 hours (from the mod)"'), 'the nameless one is account 2');
  assert.doesNotMatch(readOf(nameless), /\bundefined\b|\bNaN\b|\[object/);
});

test("the panel's colours suit the base: olive glass with a brass edge, khaki words, the AGENTVILLE mark in brass; on the Menu's buttons olive names, brass states and headings; a flag beside how often the line advanced", () => {
  const { M } = load(), W = M.MILITARY_WORDS;
  /** A colour's hue (degrees), saturation and lightness (0–1). */
  const hsl = c => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d + 6) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return { h, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
  };
  const hex = rgb => `#${rgb.map(n => Number(n).toString(16).padStart(2, '0')).join('')}`;
  const olive = c => { const { h, l } = hsl(c); return h >= 55 && h <= 85 && l < 0.35; };
  const khaki = c => { const { h, s, l } = hsl(c); return h >= 35 && h <= 60 && s < 0.65 && l >= 0.5; };
  const brass = c => { const { h, s, l } = hsl(c); return h >= 35 && h <= 52 && s >= 0.45 && l >= 0.2 && l <= 0.75; };
  for (const k of ['textColor', 'dimColor', 'labelColor']) assert.ok(khaki(W[k]), `${k} ${W[k]}: khaki`);
  for (const k of ['brandColor', 'toolStateColor']) assert.ok(brass(W[k]), `${k} ${W[k]}: brass`);
  for (const k of ['toolColor', 'shadowColor']) assert.ok(olive(W[k]), `${k} ${W[k]}: olive`);
  const glass = /\.px-stats \{ background: rgba\((\d+), (\d+), (\d+), [\d.]+\); border-color: (#[0-9a-f]{6});/.exec(M.PANEL_STYLE);
  assert.ok(glass && olive(hex(glass.slice(1, 4))) && brass(glass[4]), `the glass olive, its edge brass: ${M.PANEL_STYLE}`);
  assert.match(M.PANEL_STYLE, /\.px-hud \.advance \{/, 'the flag beside "advanced" is the base\'s own class');
  assert.equal(W.compactedIcon, 'advance');
  assert.equal(W.costIcon, 'coin', 'the cost stays a coin');
});

/* ---------- what soldiers hold, their details, and what moves: props, drones and the K9, the drone pad, jeeps, dispatch riders ---------- */

// The spec's table (§5): each step and the prop a soldier holds for it; plan mode is the kit's blueprint.
const HELD = {
  read: 'manual', search: 'binoculars', web: 'radioSet', edit: 'shovel', write: 'sandbag', test: 'mineDetector', lint: 'brush', build: 'toolbox',
  install: 'crateDolly', commit: 'stampedCrate', push: 'wheelbarrow', deploy: 'flarePistol', pull: 'mailSack', serve: 'fieldGenerator', delete: 'spade',
  agent: 'whistle', plan: 'mapCase', ask: 'messageCard', shell: 'fieldPhone', other: 'fieldPhone', planMode: 'blueprint',
};
const FAMILY_PIN = { opus: '#8a5fc0', sonnet: '#3d7be0', haiku: '#2fa57a', fable: '#f08a24' }; // the farm's pins: purple Opus, blue Sonnet, green Haiku, orange Fable
/** What a prop draws at a few moments, as the props kit's test records it: its fills, with their colours. */
function propDrawing({ ctx }, kit, prop, moments = [0.1, 0.4, 0.7]) {
  const PXG = vm.runInContext('PXG', ctx), rpAt = vm.runInContext('rpAt', ctx);
  return moments.map(T => {
    const rects = [];
    PXG.ctx = { set fillStyle(c) { this.c = c; }, get fillStyle() { return this.c; }, fillRect(x, y, w, h) { if (w > 0 && h > 0) rects.push([this.c, x, y, w, h]); }, globalAlpha: 1 };
    PXG.T = T; PXG.k = 1; PXG.lights = [];
    kit.draw(prop, rpAt(0, 0), T);
    return rects;
  });
}
/** Fills entirely inside [x, y, w, h]. */
const inRect = (x0, y0, w, h) => r => r[1] >= x0 && r[2] >= y0 && r[1] + r[3] <= x0 + w && r[2] + r[4] <= y0 + h;
/** A colour, roughly: grey, red, amber, green, blue or other. */
function hue(c) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(String(c).slice(i, i + 2), 16));
  if (Math.max(r, g, b) - Math.min(r, g, b) < 60) return 'grey';
  if (r > 180 && g < 140 && b < 140) return 'red';
  if (r > 200 && g > 120 && b < 100) return 'amber';
  if (g > r && g > b) return 'green';
  if (b > r && b >= g) return 'blue';
  return 'other';
}
const OX = 193, OY = 128; // a soldier standing at (200, 144): its sprite's top left
const SOLDIER = { id: 's', name: 's', state: 'working', shirt: '#4a7bd0', kids: [], family: null, cost: null, mode: 'default', fast: false, hot: false, tasks: null, thinking: false, color: 0, step: null, tool: null };
/** The field exercise, its canvas keeping its fills, and a soldier drawn with its details (drawChar, then drawFx) at T: standing at (200, 144), or as `body` says. */
function soldiers() {
  const all = positions(), { h, dom, PXG, M } = all;
  const fills = draw => { dom.calls.rects.length = 0; dom.calls.images.length = 0; draw(); return dom.calls.rects.map(r => [...r]); };
  const soldier = (over, body) => ({ f: { ...SOLDIER, look: M.lookOf({ id: over.id ?? 's' }), ...over }, b: { x: 200, y: 144, walk: false, face: 'down', zone: 'st:x', kids: [], ...body } });
  const drawn = (over = {}, body = {}, T = 1) => {
    const { f, b } = soldier(over, body);
    PXG.T = T;
    h.drawChar(f, b); // its sprites, made once
    return fills(() => { h.drawChar(f, b); h.drawFx(f, b); });
  };
  /** The pictures drawChar puts down for a soldier: [x, y, w, h] each. */
  const pictures = (over = {}, body = {}) => { const { f, b } = soldier(over, body); h.drawChar(f, b); fills(() => h.drawChar(f, b)); return dom.calls.images.map(i => [...i]); };
  return { ...all, fills, drawn, pictures };
}

test("the field exercise's kit: each step of the spec's table holds its prop, in drill words; a soldier's tip and log line say them", () => {
  const { M, window } = load();
  for (const [step, prop] of Object.entries(HELD)) assert.equal(M.props.steps[step].prop, prop, step);
  assert.equal(M.props.steps.mcp.prop, 'plug', "an MCP call keeps the kit's plug (its jeep is what shows it)");
  assert.equal(M.props.steps.skill.prop, 'scroll', "a skill keeps the kit's scroll");
  const kit = { ...window.Agentville.props.STEPS, planMode: window.Agentville.props.PLAN_MODE };
  for (const [step, a] of Object.entries(M.props.steps)) {
    assert.ok(typeof a.verb === 'string' && a.verb.length > 3, step);
    assert.notEqual(a.verb, kit[step]?.verb, `${step}: drill words, not the kit's (${a.verb})`);
    assert.doesNotMatch(readOf(a.verb), FARM_OR_FACTORY, step);
    assert.equal(a.spot, kit[step].spot, `${step}: where it stands at its position, the kit's`);
  }
  assert.equal(M.props.doing({ state: 'working', step: 'edit' }).prop, 'shovel');
  assert.equal(M.props.doing({ state: 'working', mode: 'plan', step: 'edit' }).prop, 'blueprint', "plan mode: the kit's blueprint");
  const h = window.hooks;
  const scene = M.militaryScene(window.AgentvilleScene.toScene({ generatedAt: TOUR_NOW, collisions: [], agents: [
    person('a', { now: { tool: 'Grep', summary: 'x', step: 'search', startedAt: TOUR_NOW } }),
    person('b', { cwd: '/Users/you/elsewhere', now: { tool: 'Bash', summary: 'npm test', step: 'test', startedAt: TOUR_NOW } }),
  ], repos: [{ path: SHOP, name: 'shop', branch: 'main', agentIds: ['a'] }] }));
  h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const [a, b] = scene.farmers;
  assert.equal(h.zoneText(a, h.slots(a).zone), `${M.props.steps.search.verb} at the shop position`);
  assert.ok(h.tip(a).includes(`${M.props.steps.search.verb} at the shop position`), h.tip(a));
  assert.ok(h.tip(b).includes(`${M.props.steps.test.verb} on the drill ground`), h.tip(b));
});

test("every prop a soldier holds draws at three moments, no two alike, each of its own moves; the signal flare goes straight up out of a fat orange launcher and bursts over its head", () => {
  const loaded = load(), { M, ctx } = loaded, ink = vm.runInContext('ink', ctx);
  const used = [...new Set(Object.values(M.props.steps).map(a => a.prop))];
  for (const own of M.MILITARY_PROPS) {
    assert.ok(used.includes(own), `${own} is held for a step`);
    assert.ok(!loaded.window.Agentville.props.PROPS.includes(own), `${own}: the world's own, not the kit's drawn another way`);
  }
  const seen = new Map();
  for (const prop of used) {
    const d = propDrawing(loaded, M.props, prop);
    assert.ok(d.every(r => r.length > 0), `${prop} draws at every moment`);
    const sig = JSON.stringify(d);
    assert.ok(!seen.has(sig), `${prop} looks like ${seen.get(sig)}`);
    seen.set(sig, prop);
    if (M.MILITARY_PROPS.includes(prop)) assert.ok(new Set(d.map(r => JSON.stringify(r))).size > 1, `${prop} moves`);
  }
  // the deploy's flare: a fat orange launcher held up beside its head at every moment, its flare going straight up out of it and bursting high over its head
  const flare = propDrawing(loaded, M.props, 'flarePistol', Array.from({ length: 40 }, (_, i) => i / 20));
  const launcher = rects => rects.filter(r => r[0] === ink('#f08a24') && inRect(10, 2, 7, 11)(r));
  assert.ok(flare.every(rects => launcher(rects).length > 0), 'a fat orange launcher at every moment');
  const over = flare.map(rects => rects.filter(r => r[2] + r[4] <= 0)); // what is over its head (row 0 is its headgear's top)
  assert.ok(over.filter(o => o.length).length >= 10, 'a flare in the air much of the time');
  assert.ok(Math.min(...over.flat().map(r => r[2])) <= -10, 'going high over its head');
  assert.ok(over.flat().every(r => r[1] >= 8 && r[1] + r[3] <= 19), 'straight up, over the launcher: never off to the side');
  assert.ok(over.flat().some(r => hue(r[0]) === 'green'), 'bursting green: a signal');
});

test("the mine detector reads as one at a glance, never as a long gun: a wide open ring lying flat on the ground at its feet, swept to and fro, on a steep pole from its hands down to the ring's middle; headphones on, a yellow marker", () => {
  const loaded = load(), { M, ctx } = loaded, ink = vm.runInContext('ink', ctx), COIL = ink('#3a3a40'), POLE = ink('#5f6b7a');
  const middles = new Set();
  for (const rects of propDrawing(loaded, M.props, 'mineDetector', Array.from({ length: 12 }, (_, i) => i / 6))) {
    const px = new Map();
    for (const [c, x, y, w, h] of rects) for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) px.set(`${x + i},${y + j}`, c);
    const at = (x, y) => px.get(`${x},${y}`), of = c => [...px].filter(([, k]) => k === c).map(([xy]) => xy.split(',').map(Number));
    const coil = of(COIL).filter(([, y]) => y >= 12), xs = coil.map(([x]) => x), x0 = Math.min(...xs), x1 = Math.max(...xs), cx = (x0 + x1) / 2;
    assert.ok(x1 - x0 + 1 >= 6 && x1 - x0 + 1 <= 8, `a wide ring (${x1 - x0 + 1} px across)`);
    assert.ok(coil.every(([, y]) => y >= 13 && y <= 15), 'lying flat on the ground, at its feet (rows 13–15)');
    assert.ok(at(x0, 14) === COIL && at(x1, 14) === COIL && at(cx, 13) === COIL && at(cx, 15) === COIL, 'a loop: its two sides, its far and near rims');
    for (let x = x0 + 1; x < x1; x++) assert.notEqual(at(x, 14), COIL, `open in the middle (${x},14)`);
    const pole = of(POLE), top = pole.reduce((a, p) => (p[1] < a[1] ? p : a));
    assert.ok(pole.some(([x, y]) => x === cx && y === 14), "the pole ends at the ring's middle");
    assert.ok(top[1] <= 9 && top[0] >= 10 && top[0] <= 13, `from its hands (${top})`);
    assert.ok(Math.abs(cx - top[0]) <= 14 - top[1], `steeply down (${Math.abs(cx - top[0])} across, ${14 - top[1]} down)`);
    assert.ok(at(2, 5) === COIL && at(10, 5) === COIL, 'headphones on');
    assert.ok(rects.some(r => r[0] === ink('#ffd43b')), 'the yellow training marker');
    middles.add(cx);
  }
  assert.ok(middles.size >= 3, `swept to and fro (its middle at ${[...middles]})`);
});

test("chevrons on its sleeve for what it has cost: one from $1, two from $10, three from $50; none below $1 or with no cost", () => {
  const { M, drawn } = soldiers();
  assert.deepEqual([null, undefined, Number.NaN, 0, 0.99, 1, 9.99, 10, 49.99, 50, 400].map(M.chevronsOf), [0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3]);
  const sleeve = rects => rects.filter(inRect(OX - 2, OY + 7, 6, 8)); // its left sleeve as you look at it, from the shoulder down
  const chevrons = (cost, body) => new Set(sleeve(drawn({ cost }, body)).map(r => r[2])).size; // a stripe a row
  assert.deepEqual([null, 0.5, 1, 5, 10, 20, 50, 80].map(cost => chevrons(cost)), [0, 0, 1, 1, 2, 2, 3, 3], 'read back from the paint: one, two, three chevrons');
  const stripes = sleeve(drawn({ cost: 80 }));
  assert.ok(stripes.every(r => hue(r[0]) === 'amber' && r[3] <= 3), 'gold stripes across its arm');
  assert.ok(stripes.every((r, i) => i === 0 || r[0] !== stripes[i - 1][0]), 'gold and brass by turns, so each one shows');
  assert.equal(chevrons(80, { walk: true, face: 'up' }), 3, 'from behind too');
});

test("on a soldier: its model's pin on its headgear (the farm's colours), a hazard armband for bypass permissions, speed lines in fast mode", () => {
  const { drawn, ctx } = soldiers(), ink = vm.runInContext('ink', ctx);
  const head = rects => rects.filter(inRect(OX + 2, OY, 10, 5));
  for (const [family, colour] of Object.entries(FAMILY_PIN)) {
    assert.ok(head(drawn({ family })).some(r => r[0] === ink(colour)), `${family}: a ${colour} pin on its headgear`);
    assert.ok(head(drawn({ family }, { walk: true, face: 'right' })).some(r => r[0] === ink(colour)), `${family}: seen from the side too`);
  }
  assert.equal(head(drawn()).length, 0, 'no model known: no pin');
  assert.equal(head(drawn({ family: 'opus' }, { walk: true, face: 'up' })).length, 0, 'from behind: none');
  const arm = rects => rects.filter(inRect(OX + 10, OY + 6, 5, 7)); // its right arm as you look at it
  const band = arm(drawn({ mode: 'bypassPermissions' })).map(r => r[0]);
  assert.ok(band.includes(ink('#ffd43b')) && band.includes(ink('#2a1d14')), 'bypass permissions: a yellow and black hazard armband');
  assert.equal(arm(drawn()).length, 0, 'none without');
  const raised = arm(drawn({ mode: 'bypassPermissions', state: 'waiting' }));
  assert.ok(raised.length > 0 && Math.max(...raised.map(r => r[2] + r[4])) <= OY + 10, 'on its raised arm while it waves');
  const beside = rects => rects.filter(r => r[2] >= OY && r[2] < OY + 16 && (r[1] + r[3] <= OX || r[1] >= OX + 14));
  assert.equal(beside(drawn()).length, 0, 'nothing beside a plain soldier');
  assert.ok(beside(drawn({ fast: true })).length >= 2, 'fast mode: speed lines beside it');
  assert.ok(beside(drawn({ fast: true }, { walk: true, face: 'right' })).length >= 2, '… and behind it as it goes');
});

test('over and beside a soldier: a radio on its back while it thinks (its aerial blinking), a clipboard for its task list, sweat drops for a hot CPU; idle, eyes shut and eating; stale, greyed a little', () => {
  const { drawn, pictures, ctx } = soldiers(), ink = vm.runInContext('ink', ctx);
  const above = rects => rects.filter(r => r[2] + r[4] <= OY && Math.abs(r[1] - 200) < 24);
  assert.equal(above(drawn()).length, 0, 'nothing over a plain soldier');
  const aerial = T => above(drawn({ thinking: true }, {}, T));
  assert.ok(aerial(1).length > 0, "thinking: its radio's aerial up over its headgear");
  assert.ok(new Set([0, 0.13, 0.26, 0.39, 0.52].map(T => JSON.stringify(aerial(T)))).size > 1, 'blinking');
  const shoulders = rects => rects.filter(inRect(OX - 1, OY + 4, 16, 10)).filter(r => hue(r[0]) !== 'red');
  assert.ok(shoulders(drawn({ thinking: true })).length > shoulders(drawn()).length, 'its radio pack showing round its shoulders');
  assert.equal(above(drawn({ thinking: true }, { walk: true, face: 'left' }, 1)).length, 0, 'not while it walks');
  const left = rects => rects.filter(r => r[1] + r[3] <= OX && r[2] < OY + 16);
  assert.equal(left(drawn()).length, 0);
  const ticks = done => left(drawn({ tasks: { done, total: 3 } })).filter(r => r[0] === ink('#2fa57a')).length;
  assert.ok(left(drawn({ tasks: { done: 0, total: 3 } })).length > 0 && ticks(1) > ticks(0) && ticks(3) > ticks(1), `a clipboard beside it, ticked as tasks are done (${ticks(0)}, ${ticks(1)}, ${ticks(3)})`);
  const drops = T => drawn({ hot: true }, {}, T).filter(r => hue(r[0]) === 'blue');
  assert.equal(drawn().filter(r => hue(r[0]) === 'blue').length, 0);
  assert.ok(drops(1).length >= 2, 'a hot CPU: sweat drops');
  assert.notDeepEqual(drops(1), drops(1.2), 'flying off');
  const idle = T => drawn({ state: 'idle' }, { zone: 'charge' }, T);
  for (const [x, y] of [[5, 6], [8, 6]]) assert.ok(idle(1).some(r => r[0] === ink('#8a5a3a') && r[1] === OX + x && r[2] === OY + y), `idle: eyes shut (${x},${y})`);
  const spoon = T => idle(T).filter(r => r[0] === ink('#c3cbd2'));
  assert.ok(spoon(0.2).length > 0 && JSON.stringify(spoon(0.2)) !== JSON.stringify(spoon(1.1)), 'eating: a spoon from its plate to its mouth');
  assert.ok([0.2, 1.1].some(T => spoon(T).some(r => r[2] <= OY + 8)), 'up to its mouth');
  const here = list => list.filter(([x, y, w, hh]) => x === OX && y === OY && w === 14 && hh === 16).length;
  assert.equal(here(pictures()), 1, 'a soldier: its sprite');
  assert.equal(here(pictures({ state: 'stale' })), 2, 'in reserve: its sprite, greyed a little (a grey veil over it)');
});

test("waiting on you: the red ! bubble and a ring at its feet; a plan to approve: a rolled map carried to HQ, and the plan bubble; your turn: a dispatch envelope, with a ✓ (a ? for a question)", () => {
  const { drawn, ctx } = soldiers(), ink = vm.runInContext('ink', ctx);
  const hq = { x: 170, y: 80, zone: 'desk' }, colours = rects => new Set(rects.map(r => r[0]));
  const bang = rects => rects.some(r => r[0] === ink('#d03b3b') && r[3] === 1 && r[4] === 3); // the !'s red stroke, in its bubble
  const waiting = drawn({ state: 'waiting' }, hq);
  assert.ok(bang(waiting), 'the red ! bubble');
  assert.ok(waiting.some(r => r[0] === ink('#e04a3a') && r[2] >= 80 && r[2] <= 82 && r[3] >= 9), 'a red ring at its feet');
  const map = rects => rects.filter(r => r[0] === ink('#9ed36a') && inRect(160, 70, 20, 10)(r)); // the map's green, showing at the roll's ends
  assert.equal(map(waiting).length, 0, 'a permission: no map');
  const plan = drawn({ state: 'waiting', planAsk: true }, hq);
  assert.ok(map(plan).length >= 2, 'a plan to approve: a rolled map carried (its green inside at both ends)');
  assert.ok(colours(plan).has(ink('#c9a24a')) && !bang(plan), "the engine's plan bubble, not the !");
  const turnAt = { x: 230, y: 80, zone: 'turn' }, front = inRect(223, 70, 14, 8);
  const turn = drawn({ state: 'turn' }, turnAt);
  assert.ok(turn.filter(front).some(r => r[0] === ink('#e8d8b0')), 'your turn: a dispatch envelope held in front');
  assert.ok(turn.filter(front).some(r => r[0] === ink('#e04a3a')), 'its red seal');
  assert.ok(colours(turn).has(ink('#0ca30c')), 'a ✓ bubble');
  assert.ok(colours(drawn({ state: 'turn', question: 'Ship it?' }, turnAt)).has(ink('#c98500')), 'a ? for a question');
  assert.ok(!colours(drawn({ state: 'turn' }, { ...turnAt, walk: true, face: 'up' })).has(ink('#0ca30c')), 'on its way back: no bubble yet');
});

test('drones: each running subagent hovers by its soldier, four at most; an Explore one is the K9 (the library dog, its kind taken), trotting about its soldier on the ground; messages are the engine\'s pigeon', () => {
  const { h, drawn, window, M, ctx } = soldiers(), ink = vm.runInContext('ink', ctx);
  const running = n => [{ id: 'x', kind: 'subagent', state: 'running', agentType: 'Explore', startedAt: TOUR_NOW }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: `c${i}`, kind: 'subagent', state: 'running', startedAt: TOUR_NOW }))];
  const six = M.militaryScene(window.AgentvilleScene.toScene({ generatedAt: TOUR_NOW, collisions: [], repos: [], agents: [person('p', { children: running(6) })] }));
  assert.equal(six.farmers[0].kids.length, 4, 'six running: four follow their soldier');
  assert.equal(six.henhouse.roosting, 2, '… the other two are counted at the drone pad');
  assert.deepEqual(plain(six.farmers[0].kids.map(k => k.dog)), [true, false, false, false], 'the Explore one is the dog');
  const b = { x: 200, y: 144 };
  const at = (k, T, dog = false) => plain(h.follow(b, k, T, { id: `c${k}`, dog }));
  const spots = [0, 1, 2, 3].map(k => at(k, 1));
  for (const [x, y] of spots) assert.ok(Math.abs(x - 200) <= 20 && y < 144 - 8 && y > 144 - 40, `${x},${y}: hovering by its soldier`);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]) >= 8, `drones ${i} and ${j} apart`);
  assert.notDeepEqual(at(0, 1), at(0, 1.4), 'they bob');
  const dog = [0, 1, 2, 3, 4, 5, 6, 7].map(T => at(0, T, true));
  assert.ok(dog.every(([, y]) => y >= 144 && y <= 150), `the K9 on the ground at its soldier's feet (${dog.map(d => Math.round(d[1]))})`);
  const xs = dog.map(([x]) => x - 200);
  assert.ok(Math.min(...xs) < -8 && Math.max(...xs) > 8, `trotting about it (${xs.map(Math.round)})`);
  const kids = [{ x: 186, y: 132 }, { x: 214, y: 148 }];
  const two = drawn({ kids: [{ id: 'c1', dog: false }, { id: 'c2', dog: true }] }, { kids });
  assert.ok(two.some(r => r[0] === '#4a7bd0' && Math.abs(r[1] - 186) <= 3 && Math.abs(r[2] - 132) <= 2), "a drone at 186,132, a band in its soldier's colour (exact)");
  const coat = two.filter(r => r[0] === ink('#a8703c'));
  assert.ok(coat.length > 0 && coat.every(r => Math.abs(r[1] - 214) <= 8 && r[2] >= 148 - 9 && r[2] <= 148), "the K9 at 214,148, in the library dog's coat");
  assert.equal(drawn({ kids: [{ id: 'c1', dog: false }, { id: 'c2', dog: false }] }, { kids }).filter(r => r[0] === ink('#a8703c')).length, 0, 'no Explore one: no dog');
  assert.ok(JSON.parse(web('worlds/military/world.json')).taken.includes('dog'), "the dog's kind is taken: no mascot is one");
  assert.equal(h.flight, undefined, "messages between agents: the engine's carrier pigeon (no flight hook)");
});

test('the drone pad: finished subagents docked on its deck, up to six; more running than their soldiers lead circle over it (drawn last, over the sky: top), with +N', () => {
  const { h, sceneOf, fills, PXG } = soldiers();
  const kids = (done, running) => [...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, kind: 'subagent', state: 'done', startedAt: TOUR_NOW })), ...Array.from({ length: running }, (_, i) => ({ id: `r${i}`, kind: 'subagent', state: 'running', startedAt: TOUR_NOW }))];
  const scene = (done, running) => { const s = sceneOf(position({}, [person('p', { children: kids(done, running) })])); h.relayout(h.grid.layoutFor(s.fields)); h.setScene(s); };
  const DECK = [96, 42, 31, 10];
  const docked = done => { scene(done, 0); PXG.T = 1; return fills(() => h.ground()).filter(inRect(...DECK)).length; };
  const [none, one, three, six] = [0, 1, 3, 6].map(docked);
  assert.ok(none < one && one < three && three < six, `a drone a berth (${none}, ${one}, ${three}, ${six})`);
  assert.equal(docked(9), six, 'six at most');
  const over = rects => rects.filter(inRect(92, 10, 40, 30));
  scene(0, 4);
  assert.equal(over(fills(() => h.top())).length, 0, 'four running: their soldier leads them all');
  assert.equal(h.movers(() => null).filter(m => /\+\d/.test(m.html)).length, 0);
  scene(0, 6);
  const circling = [1, 1.5, 2].map(T => { PXG.T = T; return over(fills(() => h.top())); });
  assert.ok(circling.every(c => c.length > 0), 'six running: two circle over the pad');
  assert.notDeepEqual(circling[0], circling[2], 'circling');
  assert.equal(over(fills(() => h.ground())).filter(r => r[2] < 40).length, 0, 'drawn over the sky (top), not on the ground');
  const sign = h.movers(() => null).find(m => m.html.includes('+2'));
  assert.ok(sign && Math.abs(sign.x - 111) <= 16 && sign.y < 30, 'with +2 over it');
  assert.match(sign.title, /2 more subagents/);
  assert.doesNotMatch(readOf(sign.title), FARM_OR_FACTORY);
});

test("a jeep's way: along the vehicle park's row to the left side's path, up or down it, and along the soldier's row; and back", () => {
  const { M } = load();
  assert.deepEqual(plain(M.jeepRoute([14, 288], [187, 144])), [[116, 288], [116, 144], [187, 144]], 'from the park to a position in the first row');
  assert.deepEqual(plain(M.jeepRoute([187, 144], [14, 288])), [[116, 144], [116, 288], [14, 288]], 'and back');
  assert.deepEqual(plain(M.jeepRoute([14, 288], [47, 222])), [[116, 288], [116, 222], [47, 222]], 'to the drill ground');
  assert.deepEqual(plain(M.jeepRoute([150, 144], [300, 144])), [[300, 144]], 'along a row');
  assert.deepEqual(plain(M.jeepRoute([116, 200], [47, 204])), [[116, 204], [47, 204]], 'from the path');
});

test('a jeep stays with its soldier while the call goes on, and a few seconds after it has got there, then heads back', () => {
  const { M } = load();
  const home = [14, 288], soldier = [213, 144], c = {};
  assert.deepEqual(plain(M.jeepGoal(c, soldier, home, 0)), soldier, 'called: it goes');
  assert.deepEqual(plain(M.jeepGoal(c, null, home, 1000)), soldier, 'a short call ended on the way: it still gets there');
  c.arrivedAt = 3000;
  assert.deepEqual(plain(M.jeepGoal(c, null, home, 5000)), soldier, 'there: it waits a moment');
  assert.deepEqual(plain(M.jeepGoal(c, null, home, 7000)), home, 'then back to the park');
  const busy = {};
  M.jeepGoal(busy, soldier, home, 0);
  assert.deepEqual(plain(M.jeepGoal(busy, soldier, home, 60_000)), soldier, 'a long call: it stays');
});

test('jeeps: one in the vehicle park for each MCP server called lately; the one a soldier calls drives over and waits beside it, with its name; drawn still, it is already there', () => {
  const { h, sceneOf, M, fills, ctx } = soldiers(), ink = vm.runInContext('ink', ctx);
  const caller = person('m', { now: { tool: 'mcp__tickets__search', summary: 'open tickets', step: 'mcp', service: 'tickets', startedAt: Date.now() - 2000 }, mcp: [{ server: 'tickets', at: Date.now() - 2000 }, { server: 'gmail', at: Date.now() - 60_000 }] });
  const scene = sceneOf(position({}, [caller]));
  h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const [x, y] = h.slots(scene.farmers[0]).at([]), posOf = id => (id === 'm' ? { x, y, tx: x, ty: y, walk: false } : null);
  const PLACES_DRAWN = 7; // the mess table, a crate before each of the four in reserve, a blanket over each of the two cots
  const jeeps = () => h.items().slice(PLACES_DRAWN), ys = () => jeeps().map(it => it[0]), home = new Set(M.PARK.map(p => p[1]));
  h.tick(0.03, posOf);
  assert.equal(ys().length, 2, 'two jeeps, one for each server');
  assert.ok(ys().every(v => home.has(v)), 'in the vehicle park');
  assert.ok(fills(() => jeeps().forEach(([, draw]) => draw())).some(r => r[0] === ink('#6b7a35')), 'olive');
  assert.deepEqual(plain(h.movers(posOf).filter(m => m.key.startsWith('mcp:')).map(m => m.key)), ['mcp:tickets'], 'the one called sets off, with its name');
  for (let i = 0; i < 400; i++) h.tick(0.05, posOf);
  const label = h.movers(posOf).find(m => m.key === 'mcp:tickets');
  assert.ok(label?.html.includes('tickets'), 'its name on it');
  assert.ok(Math.abs(label.x - x) >= 8 && Math.abs(label.x - x) <= 14 && Math.abs(label.y - (y - 12)) <= 2, `it waits beside the soldier (${label.x},${label.y} by ${x},${y})`);
  assert.ok(ys().includes(y) && ys().some(v => home.has(v)), 'one beside the soldier, drawn among the soldiers by where it stands; the other still in the park');
  assert.match(label.title, /tickets/);
  assert.doesNotMatch(readOf(label.title), FARM_OR_FACTORY);
  const still = soldiers();
  still.h.relayout(still.h.grid.layoutFor(scene.fields));
  still.h.setScene(scene);
  still.h.tick(0, posOf, true);
  const snapped = still.h.movers(posOf).find(m => m.key === 'mcp:tickets');
  assert.ok(snapped && Math.abs(snapped.x - x) <= 14 && Math.abs(snapped.y - (y - 12)) <= 2, 'motion off: it stands beside the soldier at once');
});

test('a web call: a dispatch rider on a motorbike rides out of the motor pool gate along the track to its soldier and back, its errand on it; none for a browser (its jeep goes)', () => {
  const { h, sceneOf, fills, PXG, M } = soldiers();
  const caller = tool => person('w', { now: { tool, summary: 'the docs', step: 'web', service: tool === 'WebFetch' ? 'docs.example.com' : 'playwright', startedAt: Date.now() - 2000 } });
  const withCall = sceneOf(position({}, [caller('WebFetch')])), without = sceneOf(position({}, [person('w')]));
  h.relayout(h.grid.layoutFor(withCall.fields));
  const [x, y] = h.slots(withCall.farmers[0]).at([]), posOf = () => ({ x, y, tx: x, ty: y, walk: false });
  const PLACES_DRAWN = 7;
  h.setScene(without);
  h.tick(0, posOf, true);
  assert.equal(h.items().length, PLACES_DRAWN, 'no web call: no rider');
  h.setScene(withCall);
  h.tick(0, posOf, true);
  const seen = Array.from({ length: 80 }, (_, i) => i / 10).map(T => {
    PXG.T = T;
    const riders = h.items().slice(PLACES_DRAWN), xs = fills(() => riders.forEach(([, draw]) => draw())).flatMap(r => [r[1], r[1] + r[3]]);
    return { n: riders.length, y: riders[0]?.[0], mid: (Math.min(...xs) + Math.max(...xs)) / 2 };
  });
  assert.ok(seen.every(s => s.n === 1 && s.y === M.RIDER_Y), 'a rider on the track, drawn among the soldiers by where it rides');
  assert.ok(seen.some(s => Math.abs(s.mid - 62) <= 8), 'at the motor pool gate');
  assert.ok(seen.filter(s => Math.abs(s.mid - x) <= 8).length >= 15, 'at its soldier a while');
  assert.ok(seen.some(s => s.mid > 70 && s.mid < x - 10), 'on the way');
  PXG.T = 3;
  const label = h.movers(posOf).find(m => m.key.startsWith('rider:'));
  assert.ok(label?.html.includes('docs.example.com'), 'its errand on it');
  assert.ok(label.y < M.RIDER_Y - 8, 'over the rider');
  assert.doesNotMatch(readOf(label.title), FARM_OR_FACTORY);
  h.setScene(sceneOf(position({}, [caller('mcp__playwright__browser_click')])));
  h.tick(0, posOf, true);
  assert.ok(!h.movers(posOf).some(m => m.key.startsWith('rider:')) && !h.items().some(it => it[0] === M.RIDER_Y), "a browser's web step: no rider");
  assert.ok(h.movers(posOf).some(m => m.key === 'mcp:playwright'), '… its jeep goes');
});

test('asleep on a cot until it wakes by itself: a zzz over it (and nothing in its hands), and over its cot when it wakes', () => {
  const { h, drawn, sceneOf, ctx } = soldiers(), ink = vm.runInContext('ink', ctx);
  const [x, y] = placeOf(h, 'nap', 0), cot = { x, y, zone: 'nap' }, wakeAt = Date.now() + 20 * 60_000;
  const asleep = drawn({ state: 'turn', nap: true, wakeAt }, cot);
  assert.ok(asleep.some(r => r[0] === ink('#e6eef5') && r[2] + r[4] <= y - 16), 'a zzz over its head');
  assert.ok(!asleep.some(r => r[0] === ink('#e8d8b0')), 'no dispatch in its hands: it is asleep');
  const scene = sceneOf({ generatedAt: Date.now(), collisions: [], repos: [], agents: [person('n', { state: 'yourTurn', now: null, wakeAt })] });
  h.setScene(scene);
  const label = h.movers(id => (id === 'n' ? { ...cot, walk: false } : null)).find(m => m.key === 'nap:n');
  assert.ok(label && label.x === x && label.y < y - 16, 'over its cot');
  assert.match(label.html, /wakes in 20m/);
  assert.match(label.title, /n wakes up by itself at \d/);
  assert.equal(h.movers(id => (id === 'n' ? { ...cot, walk: true } : null)).filter(m => m.key === 'nap:n').length, 0, 'not while it walks there');
});

/* ---------- the mascots: the regimental goat, the mess cat and the depot mice (sdk/animals.js) ---------- */

/** The field exercise with n repos' positions, and the animals kit from its frame; `animals(seed)` is a fresh kit placed on the base, as the engine places it. */
function mascotBase(n = 3) {
  const { window, ctx, M } = load();
  const h = window.hooks, L = h.relayout(h.grid.layoutFor(Array.from({ length: n }, (_, i) => ({ key: `/r/${i}`, name: `r${i}` }))));
  const kit = vm.runInContext('({ makeAnimals, seededRandom, CREATURES, gagProblem })', ctx);
  const place = a => a.place({ roam: h.roam(), avoid: h.avoid(), perches: h.perches(), spots: h.spots(), blocked: (x, y) => Boolean(h.fieldAt(x, y) || h.buildingAt(x, y)) });
  const animals = seed => { const a = kit.makeAnimals(h.animals(), { random: kit.seededRandom(seed) }); place(a); return a; };
  return { h, L, M, kit, animals };
}
const inArea = (r, x, y, slack = 0) => x >= r.x - slack && x <= r.x + r.w + slack && y >= r.y - slack && y <= r.y + r.h + slack;
/** Does a creature's body (c.w × c.h above its feet at x, y) overlap a rectangle? The kit's own test (animals.js, okAt). */
const bodyOver = (c, x, y, r) => x + c.w / 2 > r.x && x - c.w / 2 < r.x + r.w && y > r.y && y - c.h < r.y + r.h;
/** The same, a pixel in from each side: where list() puts it is rounded. */
const bodyIn = (c, o, r) => o.x + c.w / 2 - 1 > r.x && o.x - c.w / 2 + 1 < r.x + r.w && o.y - 1 > r.y && o.y - c.h + 1 < r.y + r.h;
/** May a creature of kind c stand with its feet at (x, y)? As the kit's okAt has it: its feet where they roam, its body clear of what they keep off, its corners and middle on no position or building. */
function standsAt(h, c, x, y) {
  if (!plain(h.roam()).some(r => inArea(r, x, y)) || plain(h.avoid()).some(r => bodyOver(c, x, y, r))) return false;
  return [[x - c.w / 2, y - c.h], [x + c.w / 2, y - c.h], [x - c.w / 2, y], [x + c.w / 2, y], [x, y - c.h / 2]].every(([px, py]) => !h.fieldAt(px, py) && !h.buildingAt(px, py));
}
/** The engine's crew, stood in for: soldiers that are where they're sent at once (factory.test.mjs's). */
function fakeCrew(farmers) {
  const log = [];
  return {
    log, farmers,
    idle: () => farmers.filter(f => f.state === 'idle' && !f.sent),
    busy: () => farmers.filter(f => f.state === 'working'),
    longIdle: () => [],
    at: id => farmers.find(f => f.id === id) ?? null,
    state: id => farmers.find(f => f.id === id)?.state,
    send: (id, [x, y]) => { const f = farmers.find(z => z.id === id); f.sent = true; f.x = x; f.y = y; log.push(['send', id, x, y]); },
    release: id => { const f = farmers.find(z => z.id === id); if (f) f.sent = false; log.push(['release', id]); },
    flag() {}, chickens: () => [], spotFree: () => true, fx: kind => log.push(['fx', kind]),
  };
}
/** Where soldiers stand on the base outside the positions, and the jeeps wait: [x, y (feet), what, w, h of what stands there]. */
const soldierPlaces = (h, M) => [
  ...[0, 1, 2].flatMap(i => [placeOf(h, 'desk', i), placeOf(h, 'turn', i)]).map(([x, y]) => [x, y, "HQ's queue", 14, 16]),
  ...[0, 1, 2, 3].map(i => [...placeOf(h, 'charge', i), 'the mess table', 14, 16]),
  ...[0, 1, 2, 3].map(i => [...placeOf(h, 'storage', i), 'the reserve', 14, 16]),
  ...[0, 1, 2, 3].map(i => [...placeOf(h, 'floor', i), 'the drill ground', 14, 16]),
  ...[0, 1].map(i => [...placeOf(h, 'nap', i), 'a cot', 14, 16]),
  ...M.PARK.map(([x, y]) => [x, y, 'the vehicle park', 14, 9]),
];

test("the mascots: the regimental goat in its dress coat, the mess cat and two depot mice, held to the kit's own rules (check-world's), with two gags", () => {
  const { h, kit } = mascotBase();
  const world = plain(h.animals());
  assert.deepEqual(Object.keys(world).sort(), ['cast', 'gags', 'play']);
  assert.deepEqual(world.cast.map(c => [c.kind, c.name, c.count ?? 1, c.look ?? null]), [['goat', 'Mascot', 1, 'mascot'], ['cat', 'Mess cat', 1, null], ['mouse', 'Depot mice', 2, null]]);
  const [goat, cat, mice] = world.cast;
  assert.deepEqual(goat.actions, [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }, { label: 'Salute', pose: 'happy', fx: 'hearts', line: 'saluted' }]);
  assert.deepEqual(goat.habits, ['stretch']);
  assert.deepEqual(goat.reacts, { merged: 'hop', arrive: 'hop' }, "pleased at a merge and at a new soldier: it hops (the kit's happy)");
  assert.deepEqual(goat.lines, {
    idle: ['I outrank you all.', 'Baa-ttention!', "At ease. I'm eating.", 'Inspection: passed.'], petted: ['Carry on.'], fed: ['Rations accepted.'], saluted: ['At ease, soldier.'],
    merged: ['Supplies! Baa!'], arrive: ['Fall in, new one.'], deployOk: ['Well drilled.'], deployFailed: ['Again. From the top.'], snack: ['Map? What map?'],
  });
  assert.deepEqual(cat.actions, [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }]);
  assert.deepEqual(cat.habits, ['yawn', 'stretch', 'climb'], "and up onto the mess tent's crates now and then (climb: its perch)");
  assert.deepEqual(cat.reacts, { deployFailed: 'scatter' }, "a failed deploy's puff startles it: it runs off (or starts where it is)");
  assert.deepEqual(cat.lines, { idle: ['mrrp. mess is mine.', 'I guard the stew.', 'zzz… rations…'], petted: ['purr ♥'], fed: ['MEOW (thanks)'], chased: ['…where did it go'] });
  assert.deepEqual(mice.actions.map(a => a.label), ['Pet', 'Feed'], 'a menu of its own (a creature has 2 to 4 actions)');
  assert.deepEqual(mice.lines.idle, ['crumbs, sir?', 'rations: found', 'squeak (quietly)']);
  assert.deepEqual(mice.lines.chased, ['eep!']);
  assert.ok(mice.home, "the mice keep to their home, by the quartermaster's depot");
  assert.deepEqual(world.gags.map(g => g.id), ['map snack', 'mouse patrol']);
  assert.deepEqual(world.play, []);
  const taken = JSON.parse(web('worlds/military/world.json')).taken;
  assert.deepEqual(creatureProblems(world, { kinds: Object.keys(kit.CREATURES), taken, gagProblem: kit.gagProblem, spots: plain(h.spots()) }), { problems: [], pointers: [] }, 'nothing the kit would drop or do its own way: lines of 40 at most, known poses, fx, habits, reactions and looks');
});

test("where they go: the goat along the track's front edge, end to end; the cat about the track, by the mess tent, down the left side's path and between its places, and along the exercise field's edge; never the positions, HQ's queue, the vehicle park, or where soldiers eat, wait in reserve, drill or sleep", () => {
  for (const n of [3, 18]) {
    const { h, L, M, kit } = mascotBase(n), { goat, cat, mouse } = kit.CREATURES, at = `${n} positions`;
    const avoid = plain(h.avoid()), cast = plain(h.animals()).cast, parade = cast.find(c => c.kind === 'goat').home, home = cast.find(c => c.kind === 'mouse').home;
    // the goat's home, the parade line: the track's front edge from end to end, past HQ's queue; wherever it stands on it, all of it is clear of what they keep off, the positions and the buildings
    assert.ok(parade.x <= 4 && parade.x + parade.w >= h.W - 4 && parade.y > 92 && parade.y + parade.h <= L.GRID.y0, `${at}: the parade line (${JSON.stringify(parade)})`);
    for (let x = parade.x; x <= parade.x + parade.w; x++) for (const y of [parade.y, parade.y + parade.h]) {
      for (const r of avoid) assert.ok(!bodyOver(goat, x, y, r), `${at}: the goat at ${x},${y} is clear of ${JSON.stringify(r)}`);
      for (const [px, py] of [[x - goat.w / 2, y - goat.h], [x + goat.w / 2, y - goat.h], [x, y - goat.h / 2]]) assert.ok(!h.fieldAt(px, py) && !h.buildingAt(px, py), `${at}: the goat at ${x},${y}, on no position or building`);
    }
    for (const [x, y, where] of [
      [20, 85, 'the track, by the motor pool'], [70, 91, 'the track, before the motor pool gate'], [300, 91, 'the track, before the fuel depot'], [370, 90, "the track, before the quartermaster's depot"],
      [200, 95, "the parade line, past HQ's queue"], [60, 96, 'by the mess tent'], [116, 120, "the left side's path, by the mess tent"], [116, 240, "the left side's path, by the cots"],
      [60, 272, 'between the cots and the vehicle park'], [200, L.GRID.y1 + 22, "the exercise field's edge"], [380, L.GRID.y1 + 24, "the exercise field's edge, at the right"],
    ]) assert.ok(standsAt(h, cat, x, y), `${at}: the cat may stand ${where} (${x},${y})`);
    for (const [x, y, where] of [[200, 90, "on HQ's queue"], [160, 92, "over the feet of HQ's queue"], [200, 120, 'on a position'], [60, 120, 'in the mess tent'], [200, 50, 'in HQ'], [60, 200, 'on the drill ground'], [60, 285, 'in the vehicle park']]) assert.ok(!standsAt(h, cat, x, y), `${at}: never ${where} (${x},${y})`);
    for (const [x, y, w] of [[L.GRID.x0 + 4, L.GRID.y0 + 4, 'the positions'], [L.GRID.x1 - 4, L.GRID.y1 - 4, 'the positions']]) assert.ok(avoid.some(r => inArea(r, x, y)), `${at}: ${w} (${x},${y}) are kept off`);
    for (const [x, y, what, w, hh] of soldierPlaces(h, M)) assert.ok(avoid.some(r => x - w / 2 >= r.x && x + w / 2 <= r.x + r.w && y - hh >= r.y && y <= r.y + r.h), `${at}: ${what} (${x},${y}), all of what stands there, is kept off`);
    // the gags' spots: the board on the parade line before the briefing board; the depot by the quartermaster's crates, in the mice's home
    const spots = plain(h.spots()), [bx, by] = spots.board, [dx, dy] = spots.depot;
    const boardBox = M.BUILDINGS.find(b => b[0] === 'board'), dock = M.BUILDINGS.find(b => b[0] === 'dock');
    assert.deepEqual(Object.keys(spots).sort(), ['board', 'depot']);
    assert.ok(inArea(parade, bx, by) && bx >= boardBox[1] && bx <= boardBox[3] && by > boardBox[4], `${at}: on the parade line before the briefing board (${spots.board})`);
    assert.ok(!avoid.some(r => inArea(r, bx, by)) && !avoid.some(r => inArea(r, dx, dy)), `${at}: both spots clear of what avoid() keeps off`);
    assert.ok(inArea(home, dx, dy) && dx >= dock[1] && dx <= dock[3] && dy > dock[4], `${at}: the depot spot, before the quartermaster's depot, where the mice live (${spots.depot})`);
    assert.ok(home.x >= dock[1] && home.x + home.w <= dock[3] && home.y - mouse.h > dock[4] && home.y + home.h <= 92, `${at}: the mice's home, on the track before the depot, clear of its click box (${JSON.stringify(home)})`);
    for (const r of avoid) assert.ok(!(home.x + home.w > r.x && home.x < r.x + r.w && home.y + home.h > r.y && home.y - mouse.h < r.y + r.h), `${at}: the mice's home is clear of ${JSON.stringify(r)}`);
    // the cat's perch: on the mess tent's ration crates, its feet where it may stand
    const perches = plain(h.perches()), crates = plain(M.MESS_CRATES);
    assert.equal(perches.length, 1);
    const [px0, py0, lift] = perches[0];
    assert.ok(standsAt(h, cat, px0, py0), `${at}: the cat may stand at the crates' foot (${px0},${py0})`);
    assert.equal(py0 - lift, crates.y, 'lifted onto their lids');
    assert.ok(px0 - cat.w / 2 >= crates.x - 1 && px0 + cat.w / 2 <= crates.x + crates.w + 1, `on the crates, not beside them (${perches[0]}, ${JSON.stringify(crates)})`);
    assert.ok(crates.y + crates.h < 98 && crates.y > 91 && crates.x > 92 && crates.x + crates.w < 111, "behind the mess tent's right end, between it and the track (clear of the lantern and the path)");
  }
});

test("placement: whatever they do, no mascot stands on a position, a building or what avoid() keeps off; the goat parades the track's front edge end to end, the mice keep to the depot, and the cat goes about the track, the left side and the exercise field's edge", () => {
  const catWent = new Set(), goatWent = new Set();
  for (const n of [3, 18]) for (const seed of [1, 2, 3]) {
    const { h, L, kit, animals } = mascotBase(n), a = animals(seed), crew = fakeCrew([{ id: 's1', state: 'idle', x: 22, y: 132 }]);
    const avoid = plain(h.avoid()), roam = plain(h.roam()), cast = plain(h.animals()).cast, homes = { goat: cast[0].home, mouse: cast[2].home };
    const events = [['merged', [357, 50]], ['arrive', [62, 80]], ['deployFailed', [205, 116]], ['harvest', [174, 130]], ['deployOk', [293, 116]]];
    for (let i = 0; i < 6000; i++) {
      if (i % 400 === 0) { a.perform('goat-0', 2, null); a.perform('cat-0', 1, null); a.perform('mouse-1', 0, null); } // Salute, Feed, Pet
      if (i % 900 === 300) a.react(...events[Math.floor(i / 900) % events.length]);
      a.tick(0.1, { crew });
      for (const o of plain(a.list())) {
        const c = kit.CREATURES[o.kind], where = `${n} positions, seed ${seed}, t ${i / 10}: ${o.id} at ${o.x},${o.y}`;
        if (homes[o.kind]) assert.ok(inArea(homes[o.kind], o.x, o.y, 1), `${where}: at home`);
        else assert.ok(roam.some(r => inArea(r, o.x, o.y, 1)), `${where}: where it may roam`);
        for (const r of avoid) assert.ok(!bodyIn(c, o, r), `${where}: in ${JSON.stringify(r)}`);
        for (const [px, py] of [[o.x - c.w / 2 + 1, o.y - c.h + 1], [o.x + c.w / 2 - 1, o.y - c.h + 1], [o.x - c.w / 2 + 1, o.y - 1], [o.x + c.w / 2 - 1, o.y - 1]]) assert.ok(!h.fieldAt(px, py) && !h.buildingAt(px, py), `${where}: on a position or a building`);
        if (o.kind === 'cat') catWent.add(o.y <= L.GRID.y0 ? 'the track' : o.y > L.GRID.y1 + 8 ? "the exercise field's edge" : 'the left side');
        if (o.kind === 'goat') goatWent.add(o.x < 110 ? 'by the mess tent' : o.x > 260 ? 'past HQ' : 'before HQ');
      }
    }
  }
  assert.deepEqual([...catWent].sort(), ["the exercise field's edge", 'the left side', 'the track']);
  assert.deepEqual([...goatWent].sort(), ['before HQ', 'by the mess tent', 'past HQ']);
});

test("the mess cat gets about: whatever its luck (the engine's seed for this cast too), over two hours it spends a tenth of its time or more on each of the track, the left side and the exercise field's edge; none of them traps it", () => {
  for (const n of [3, 18]) for (const seed of [1, 2, 3 * 7919]) {
    const { L, animals } = mascotBase(n), a = animals(seed), time = { track: 0, left: 0, edge: 0 };
    for (let i = 0; i < 72000; i++) {
      a.tick(0.1);
      const cat = plain(a.list()).find(o => o.kind === 'cat');
      time[cat.y <= L.GRID.y0 ? 'track' : cat.y > L.GRID.y1 + 8 ? 'edge' : 'left']++;
    }
    for (const [where, ticks] of Object.entries(time)) assert.ok(ticks >= 7200, `${n} positions, seed ${seed}: ${where} ${Math.round(ticks / 720)}% of the time (${JSON.stringify(time)})`);
  }
});

test("the mess cat climbs onto the mess tent's ration crates now and then, and stays up there a while", () => {
  const { h, animals } = mascotBase(3), [px0, py0, lift] = plain(h.perches())[0];
  let longest = 0;
  for (const seed of [1, 2, 3, 4]) {
    const a = animals(seed);
    let run = 0;
    for (let i = 0; i < 12000; i++) {
      a.tick(0.1);
      const cat = plain(a.list()).find(o => o.kind === 'cat');
      run = cat.x === px0 && cat.y === py0 && cat.lift === lift ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  assert.ok(longest >= 40, `it sits up on the crates 4 s or more at a time (longest ${longest / 10} s)`);
});

test('the map snack: the goat parades to the briefing board and eats the map there ("Map? What map?"), an idle soldier walks over, and it trots off', () => {
  const SNACK = 'Map? What map?';
  let played = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { h, animals } = mascotBase(3), a = animals(seed), board = plain(h.spots()).board;
    const crew = fakeCrew([{ id: 's1', state: 'idle', x: 22, y: 132 }]);
    let run = null; // a snack under way: the goat's poses and places, and where it was (and who had been sent) when it said its line
    for (let i = 0; i < 40000; i++) {
      a.tick(0.1, { crew });
      const on = a.gagNow()?.id === 'map snack', goat = plain(a.list()).find(o => o.kind === 'goat');
      if (on && !run) run = { seen: [], sends: crew.log.filter(l => l[0] === 'send').length };
      if (!run) continue;
      if (on) {
        run.seen.push([goat.pose, goat.x, goat.y]);
        if (!run.said && plain(a.bubbles()).some(b => b.text === SNACK)) run.said = { at: [goat.x, goat.y], sent: crew.log.filter(l => l[0] === 'send').length - run.sends };
        continue;
      }
      if (run.said) { // a snack played out: check where everyone was
        assert.deepEqual(run.said.at, board, `seed ${seed}: it says so at the board`);
        assert.equal(run.said.sent, 0, `seed ${seed}: before the soldier comes`);
        assert.ok(run.seen.some(([p, x, y]) => p === 'eat' && x === board[0] && y === board[1]), `seed ${seed}: it eats there`);
        const sent = crew.log.filter(l => l[0] === 'send').slice(run.sends);
        assert.ok(sent.length && Math.abs(sent[0][2] - board[0]) <= 12 && Math.abs(sent[0][3] - board[1]) <= 2, `seed ${seed}: then the soldier is sent over to it (${sent[0]})`);
        const last = run.seen.at(-1);
        assert.ok(Math.hypot(last[1] - board[0], last[2] - board[1]) > 8, `seed ${seed}: and it trots off (${last})`);
        played++;
      }
      run = null;
    }
  }
  assert.ok(played >= 4, `the snack played out a few times (${played})`);
});

test('the mouse patrol: a mouse pops out by the quartermaster\'s crates, the mess cat runs at it ("eep!"), the mouse is off, and the cat is left with nothing ("…where did it go")', () => {
  let played = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { h, animals } = mascotBase(3), a = animals(seed), depot = plain(h.spots()).depot, crew = fakeCrew([]);
    let run = null; // a patrol under way: where the cat and its mouse were when each line was first said
    for (let i = 0; i < 40000; i++) {
      a.tick(0.1, { crew });
      const on = a.gagNow()?.id === 'mouse patrol';
      if (on && !run) run = {};
      if (!run) continue;
      const list = plain(a.list()), cat = list.find(o => o.kind === 'cat');
      // the kit puts a creature back where it may be when a step of its walk grazes a corner its 2 px check passed (it
      // jumps): that patrol says nothing of this world's places
      if (run.at && Math.hypot(cat.x - run.at[0], cat.y - run.at[1]) > 6) run.jumped = true;
      run.at = [cat.x, cat.y];
      for (const b of plain(a.bubbles())) {
        if (b.text === 'eep!' && !run.eep) run.eep = { cat, mouse: list.find(o => o.id === b.id) };
        if (b.text === '…where did it go' && run.eep && !run.gone) run.gone = { cat, mouse: list.find(o => o.id === run.eep.mouse.id) };
      }
      if (on) continue;
      const { eep, gone } = run, far = ({ cat: c, mouse: m }) => Math.hypot(c.x - m.x, c.y - m.y);
      if (eep && gone && !run.jumped) { // a patrol played out
        assert.ok(Math.hypot(eep.mouse.x - depot[0], eep.mouse.y - depot[1]) <= 2, `seed ${seed}: the mouse squeaks by the crates (${eep.mouse.x},${eep.mouse.y})`);
        assert.ok(far(eep) <= 24, `seed ${seed}: the cat right at it (${eep.cat.x},${eep.cat.y})`);
        assert.ok(far(gone) > far(eep) + 8, `seed ${seed}: the mouse got away (${gone.mouse.x},${gone.mouse.y}; the cat at ${gone.cat.x},${gone.cat.y})`);
        played++;
      }
      run = null;
    }
  }
  assert.ok(played >= 4, `the patrol played out a few times (${played})`);
});

test('at max alert the mascots never act cold: the goat wears no scarf and keeps going about (the world\'s coldSeason is null; with the engine\'s default it would)', () => {
  const run = coldSeason => {
    let pending = null;
    const { window, dom, ctx } = load({ raf: cb => { pending = cb; return 1; }, wrap: hooks => { if (coldSeason !== undefined) hooks.coldSeason = coldSeason; } });
    window.registered.start({ el: dom.make(), opts: { still: false }, prefs: { get: k => ({ season: 'winter', sky: 'day' })[k] ?? null, set() {} } });
    window.registered.scene(window.AgentvilleScene.toScene(goldenSnapshot()));
    const seen = [];
    let now = 1000;
    for (let i = 0; i < 1200 && pending; i++) { // two minutes, a tenth of a second a frame
      const cb = pending;
      pending = null;
      dom.calls.rects.length = 0;
      cb(now += 100);
      const goat = window.Agentville.animalsNow().find(o => o.kind === 'goat');
      if (goat) seen.push(plain(goat));
    }
    return { seen, season: vm.runInContext('PXG.season', ctx) };
  };
  const max = run();
  assert.equal(max.season, 'winter', 'the Alert switch held at max');
  assert.ok(max.seen.length > 1000, 'the goat is on the base, frame after frame');
  assert.ok(max.seen.every(g => !g.wear.scarf), 'no scarf at max alert');
  assert.ok(new Set(max.seen.map(g => `${g.x},${g.y}`)).size > 5 && max.seen.some(g => g.pose === 'walk'), 'it keeps going about');
  const cold = run('winter'); // the engine's default, for contrast
  assert.ok(cold.seen.length && cold.seen.every(g => g.wear.scarf), 'were max alert the cold season, it would wear a scarf');
});
