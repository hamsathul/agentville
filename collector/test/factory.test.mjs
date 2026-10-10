// The robot factory (web/worlds/factory/): its mix-and-match robots (a head, a body in the agent's colour,
// a drive, picked by the agent's id), the world's registration on the engine, and its floor: the buildings,
// the windows, the safety line and the conveyor, and where every robot stands.
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
function stubDom() { // as in starter.test.mjs, and each fillRect is kept with its colour: a sprite's pixels
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
/** The SDK and the factory in a vm; `wrap(hooks)` may change the hooks before the engine takes them (to watch one). */
function load({ wrap = null } = {}) {
  const dom = stubDom();
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} });
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js']) vm.runInContext(web(f), ctx, { filename: f });
  const engineWorld = window.Agentville.world; // the hooks the factory gives, kept for the tests
  window.Agentville.world = hooks => { window.hooks = hooks; wrap?.(hooks); return engineWorld(hooks); };
  vm.runInContext(web('worlds/factory/world.js'), ctx, { filename: 'worlds/factory/world.js' });
  return { window, dom, ctx, F: window.AgentvilleFactory };
}
const VIEWS = ['down', 'up', 'right', 'left'], FRAMES = ['s', 'a', 'b'];
// k outline · C body · c its shade · H head metal · h its light · v visor · e eye · A arm · T tread or tyre ·
// W wheel hub · L leg joint · B the chest panel's light · a antenna
const LETTERS = /^[.kCcHhveATWLBa]{14}$/;
const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
/** The colour each pixel of a fresh sprite was painted, by "x,y" (what is cleared after is gone). */
function pixelsOf(dom, draw) {
  dom.calls.rects.length = 0;
  draw();
  const out = new Map();
  for (const [c, x0, y0, w, h] of dom.calls.rects) for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) { if (c === null) out.delete(`${x},${y}`); else out.set(`${x},${y}`, c); }
  return out;
}

test('every head, body and drive, in every view and frame, is 16 rows of 14 known letters; left is the mirror of right', () => {
  const { F } = load();
  assert.deepEqual(plain(Object.keys(F.HEADS)), ['dome', 'box', 'antenna', 'screen']);
  assert.deepEqual(plain(Object.keys(F.DRIVES)), ['wheels', 'legs', 'treads']);
  assert.ok(F.BODIES.length >= 3, 'a few chest panels');
  for (const head of Object.keys(F.HEADS)) for (const drive of Object.keys(F.DRIVES)) for (let chest = 0; chest < F.BODIES.length; chest++) for (const line of ['claude', 'codex']) {
    const look = { head, drive, line, chest };
    for (const view of VIEWS) for (const legs of FRAMES) {
      const r = plain(F.robotRows(look, view, legs));
      assert.equal(r.length, 16, `${head}/${drive}/${chest} ${view} ${legs}`);
      for (const row of r) assert.match(row, LETTERS, `${head}/${drive}/${chest} ${view} ${legs}: ${row}`);
    }
    for (const legs of FRAMES) assert.deepEqual(plain(F.robotRows(look, 'left', legs)), plain(F.robotRows(look, 'right', legs)).map(row => [...row].reverse().join('')), `${head}/${drive} ${legs}: left mirrors right`);
  }
});

test('no two parts alike: heads, chest panels and drives each look their own, and every drive moves when it walks', () => {
  const { F } = load();
  const base = { head: 'dome', drive: 'wheels', line: 'claude', chest: 0 };
  for (const view of ['down', 'up', 'right']) {
    const heads = Object.keys(F.HEADS).map(head => plain(F.robotRows({ ...base, head }, view, 's')).slice(0, 9).join('\n'));
    assert.equal(new Set(heads).size, heads.length, `every head differs (${view})`);
    const drives = Object.keys(F.DRIVES).map(drive => plain(F.robotRows({ ...base, drive }, view, 's')).slice(13).join('\n'));
    assert.equal(new Set(drives).size, drives.length, `every drive differs (${view})`);
  }
  const chests = F.BODIES.map((_, chest) => plain(F.robotRows({ ...base, chest }, 'down', 's')).slice(9, 13).join('\n'));
  assert.equal(new Set(chests).size, chests.length, 'every chest panel differs');
  for (const drive of Object.keys(F.DRIVES)) for (const view of ['down', 'right']) {
    const at = legs => plain(F.robotRows({ ...base, drive }, view, legs)).join('\n');
    assert.notEqual(at('a'), at('s'), `${drive} ${view}: frame a moves`);
    assert.notEqual(at('b'), at('s'), `${drive} ${view}: frame b moves`);
    assert.notEqual(at('a'), at('b'), `${drive} ${view}: a and b are different steps`);
  }
  for (const head of Object.keys(F.HEADS)) { // drawChar draws the eyes in x 4–9 from the front, at x 10 from the right; rows 5–7
    const front = plain(F.robotRows({ ...base, head }, 'down', 's')), side = plain(F.robotRows({ ...base, head }, 'right', 's'));
    for (let y = 5; y <= 7; y++) {
      for (let x = 4; x <= 9; x++) assert.equal(front[y][x], 'v', `${head}: the eyes go on its visor (${x}, ${y})`);
      assert.equal(side[y][10], 'v', `${head}: from the side too (10, ${y})`);
    }
  }
});

test('a look comes from the id with the fixed salts (head 1, drive 2, chest 3): the same agent is the same robot', () => {
  const { F, window } = load();
  const { pick } = window.Agentville.people;
  assert.deepEqual(plain(F.lookOf({ id: 'x' })), plain(F.lookOf({ id: 'x' })));
  assert.deepEqual(plain(Object.keys(F.lookOf({ id: 'x' }))).sort(), ['chest', 'drive', 'head', 'line']);
  for (const id of [...IDS, 'x', 'g-ask', 'codex:g1']) {
    const look = F.lookOf({ id });
    assert.equal(look.head, Object.keys(F.HEADS)[pick(id, 1, Object.keys(F.HEADS).length)], `${id}: head`);
    assert.equal(look.drive, Object.keys(F.DRIVES)[pick(id, 2, Object.keys(F.DRIVES).length)], `${id}: drive`);
    assert.equal(look.chest, pick(id, 3, F.BODIES.length), `${id}: chest`);
    assert.equal(look.line, 'claude');
  }
  const looks = IDS.map(id => F.lookOf({ id }));
  assert.ok(new Set(looks.map(l => l.head)).size >= 3, 'eight ids: at least three heads');
  assert.ok(new Set(looks.map(l => l.drive)).size >= 2, 'eight ids: at least two drives');
});

test("the body is the agent's colour, exact; codex robots are the slate model line; a stale one is powered down grey", () => {
  const { F, dom } = load();
  const shirt = '#d55181', look = { head: 'box', drive: 'legs', line: 'claude', chest: 1 };
  const rows = plain(F.robotRows(look, 'down', 's')), y = rows.findIndex(r => r.includes('C')), x = rows[y].indexOf('C');
  const body = (lk, opts = {}) => pixelsOf(dom, () => F.robotSprite(lk, shirt, opts)).get(`${x},${y}`);
  assert.equal(body(look), shirt, "a claude robot's body");
  const codex = F.lookOf({ id: 'x', kind: 'codex' });
  assert.equal(codex.line, 'codex');
  const slate = body({ ...look, line: 'codex' });
  assert.equal(slate, '#5f6b7a', "a codex robot's body is slate");
  assert.notEqual(slate, shirt);
  const off = body(look, { off: true });
  assert.notEqual(off, shirt, 'stale: not its colour');
  const [r, g, b] = [1, 3, 5].map(i => parseInt(off.slice(i, i + 2), 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 24, `stale: grey (${off})`);
});

test('a sprite is 14 × 16, made once for each look, colour and pose', () => {
  const { F, dom } = load();
  const look = { head: 'antenna', drive: 'treads', line: 'claude', chest: 0 };
  const s = F.robotSprite(look, '#4a7bd0', { view: 'right', legs: 'a' });
  assert.equal(s.width, 14);
  assert.equal(s.height, 16);
  assert.equal(F.robotSprite(look, '#4a7bd0', { view: 'right', legs: 'a' }), s, 'cached');
  assert.equal(pixelsOf(dom, () => F.robotSprite(look, '#4a7bd0', { view: 'right', legs: 'a' })).size, 0, 'not drawn again');
  for (const opts of [{ view: 'left', legs: 'a' }, { view: 'right', legs: 'b' }, { view: 'right', legs: 'a', off: true }]) assert.notEqual(F.robotSprite(look, '#4a7bd0', opts), s, JSON.stringify(opts));
  assert.notEqual(F.robotSprite(look, '#2fa57a', { view: 'right', legs: 'a' }), s, 'another colour');
  for (const odd of [undefined, null, '', 'red', '#abc']) assert.doesNotThrow(() => F.robotSprite(look, odd), `no colour to speak of (${odd}): drawn, not thrown`);
  const still = pixelsOf(dom, () => F.robotSprite(look, '#4a7bd0', { view: 'down' }));
  const waving = pixelsOf(dom, () => F.robotSprite(look, '#4a7bd0', { view: 'down', wave: true }));
  const moved = new Set([...still.keys(), ...waving.keys()].filter(k => still.get(k) !== waving.get(k)));
  assert.ok(moved.size >= 3, `waving raises an arm (${moved.size} pixels change)`);
  assert.ok([...moved].every(k => Number(k.split(',')[0]) >= 9), 'its right arm (on the right of the picture), the rest as it was');
});

test('the factory registers on the engine, places every agent of a busy morning, and draws them', () => {
  const { window, dom, ctx } = load();
  assert.ok(window.registered, 'it registered with Agentville.world');
  const h = window.hooks;
  assert.equal(h.W, 400);
  assert.equal(h.SH, 16);
  assert.deepEqual(plain(h.nouns), { agent: 'robot', agents: 'robots', repo: 'bay', repos: 'bays', place: 'factory' });
  assert.deepEqual(plain(h.seasonNames), { switch: 'Heat', spring: 'cool', summer: 'warm', autumn: 'hot', winter: 'steaming' });
  window.registered.start({ el: dom.make(), opts: { still: true }, prefs: { get: () => null, set() {} } });
  const scene = window.AgentvilleScene.toScene(goldenSnapshot());
  window.registered.scene(scene);
  assert.ok(dom.calls.fillRect > 0, 'it drew its floor');
  assert.ok(dom.calls.drawImage > 0, 'it drew robots');
  const farmers = (h.fromScene ?? ctx.engineScene)(scene).farmers;
  assert.equal(farmers.length, 11);
  for (const f of farmers) {
    const s = h.slots(f), at = s.group.startsWith('st:') ? s.at([]) : s.at(0);
    assert.ok(s.zone && at.length === 2 && at.every(Number.isFinite), `${f.name} has a place (${s.group})`);
  }
  assert.ok(farmers.filter(f => f.state === 'working' && f.field).every(f => h.slots(f).group === `st:${f.field}`), 'working robots stand at their bays');
});

test("its world.json is valid, in factory words, and says drones are taken", () => {
  const j = JSON.parse(web('worlds/factory/world.json'));
  assert.equal(checkWorldJson(j), null);
  assert.equal(j.name, 'Robot factory');
  assert.deepEqual(j.taken, ['drone']);
  assert.deepEqual(j.nouns, { agent: 'robot', agents: 'robots', repo: 'bay', repos: 'bays', start: 'fabricator', diary: 'Floor log' });
});

/* ---------- the floor, the buildings, and where everyone stands ---------- */

const TOUR_NOW = Date.UTC(2026, 9, 9, 9, 0), SHOP = '/Users/you/code/shop';
const person = (id, over = {}) => ({
  id, kind: 'interactive', name: id, cwd: SHOP, state: 'working', stateReason: 'busy', stateSince: TOUR_NOW - 60_000, feed: [], children: [], touching: [],
  contextTokens: 40_000, usage: { costUsd: 0.4 }, mode: 'default', model: 'claude-sonnet-5-5', modelLabel: 'Sonnet 5.5', now: { tool: 'Edit', summary: 'src/a.ts', step: 'edit', startedAt: TOUR_NOW - 1000 }, ...over,
});
/** A crowded day: more of each kind than its place holds (5 waiting, 4 your turn, 6 idle, 6 stale, 3 napping, 6 with no repo), and 2 at a bay. */
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
const PLACES = { desk: 3, turn: 3, charge: 4, storage: 4, nap: 2, floor: 4 };
const STATE_OF = { desk: 'waiting', turn: 'turn', charge: 'idle', storage: 'stale', nap: 'turn', floor: 'working' };
/** The i-th place of a group, from the world's slots. */
const placeOf = (h, group, i) => plain(h.slots({ id: 'x', state: STATE_OF[group], nap: group === 'nap', field: null }).at(i));
/** Two robots (14 × 16, standing on their feet) whose boxes overlap. */
const overlap = ([ax, ay], [bx, by]) => Math.abs(ax - bx) < 14 && Math.abs(ay - by) < 16;

test('slots: waiting at your desk (3), your turn at its right (3), idle on the pads (4), stale on the shelf (4), naps in the pods (2), no repo at the open table (4)', () => {
  const { window, F } = load();
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
  assert.deepEqual(at.desk, [[150, 80], [170, 80], [190, 80]], 'the queue at your desk, on the walkway, 20 apart');
  assert.deepEqual(at.turn, [[250, 80], [230, 80], [210, 80]], 'your turn: at the desk, from its right, 20 apart');
  const desk = [...at.desk, ...at.turn];
  for (let i = 0; i < desk.length; i++) for (let j = i + 1; j < desk.length; j++) assert.ok(!overlap(desk[i], desk[j]), `at your desk, ${desk[i]} and ${desk[j]} don't touch, both queues full`);
  assert.deepEqual(plain(h.slots({ state: 'idle', nap: true }).at(1)), at.nap[1], 'an idle session that wakes by itself sleeps in a pod too');
  assert.deepEqual(plain(h.slots({ state: 'working', field: '/Users/you/gone' }).at(0)), at.floor[0], 'working in a repo with no bay (more than 18): the open table');
  assert.equal(h.slots({ state: 'working', field: SHOP, step: 'edit' }).group, `st:${SHOP}`, 'working in a repo: at its bay');
  assert.deepEqual(plain(h.spawn()), [62, 80], "new robots roll out of the fabricator's door");
  // Every place: in the world, its feet on no building, out of the bays' grid; the left side's on the left, below the walkway.
  const all = [...Object.entries(at).flatMap(([g, list]) => list.map(p => [g, p])), ...F.RANK.map(p => ['rank', plain(p)])];
  for (const [g, [x, y]] of all) {
    assert.ok(x >= 7 && x <= h.W - 7 && y >= 16 && y <= L.H, `${g} ${x},${y}: in the world`);
    assert.equal(h.buildingAt(x, y), null, `${g} ${x},${y}: its feet on the floor, not in a building`);
    assert.ok(x + 7 < L.GRID.x0 || x - 7 > L.GRID.x1 || y < L.GRID.y0 || y - 16 > L.GRID.y1, `${g} ${x},${y}: outside the bays`);
    if (g === 'desk' || g === 'turn') assert.ok(y >= 74 && y <= 92, `${g}: on the walkway`);
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
  assert.equal(drawn.length, 22, 'everyone who fits, at a bay or a place');
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) assert.ok(!overlap(drawn[i], drawn[j]), `two robots overlap at ${drawn[i]} and ${drawn[j]}`);
  const signs = seen.labs.map(([, , html]) => String(html)).join('\n');
  for (const t of ['+2 waiting', '+1 your turn', '+2 idle', '+2 stale', '+1 asleep', '+2 working']) assert.ok(signs.includes(t), `the sign "${t}"`);
});

test('buildingAt: a point in each building is its key; the floor, the walkway, a window, a bay and [0, 300] are none', () => {
  const { window } = load();
  const h = window.hooks;
  h.relayout(h.grid.layoutFor([{ key: SHOP, name: 'shop' }]));
  const inside = { barn: [60, 50], drones: [111, 50], desk: [200, 62], board: [270, 50], bank: [298, 50], dock: [357, 40] };
  for (const [k, [x, y]] of Object.entries(inside)) assert.equal(h.buildingAt(x, y), k, `${k} at ${x},${y}`);
  for (const [x, y] of [[0, 300], [116, 84], [200, 18], [174, 140], [56, 160]]) assert.equal(h.buildingAt(x, y), null, `${x},${y}`);
  // the desk's edges (x 140–260, y 34–76), in and just out; the gaps between buildings
  for (const [x, y] of [[140, 60], [260, 60], [200, 34], [200, 76]]) assert.equal(h.buildingAt(x, y), 'desk', `${x},${y}: just inside the desk`);
  for (const [x, y] of [[139, 60], [261, 60], [200, 33], [200, 77]]) assert.equal(h.buildingAt(x, y), null, `${x},${y}: just outside the desk`);
  for (const [x, y] of [[93, 50], [133, 50], [282, 50], [315, 50]]) assert.equal(h.buildingAt(x, y), null, `${x},${y}: between two buildings`);
});

test('no farm words: the help, every building tip, dialog, log line, pop-up and tip is in factory words', () => {
  const { window, F } = load();
  const h = window.hooks, FARM = /\b(farm|field|crop|harvest|porch|barn|silo|henhouse|stall|scarecrow|meadow|hammock|pigeon)/i;
  assert.equal(h.boardTitle, 'The manuals shelf: what your projects remember', "the manuals shelf's dialog title (the engine's board)");
  const texts = [['help', h.help()], ['startText', h.startText(1)], ['startText', h.startText(7)], ['arriveText', h.arriveText], ['boardTitle', h.boardTitle]];
  for (const k of ['barn', 'drones', 'desk', 'board', 'bank', 'dock']) { assert.ok(h.buildingTip(k), `${k} has a tip`); texts.push([`buildingTip ${k}`, h.buildingTip(k)]); }
  const animals = plain(h.animals()); // the creatures' names, menus and lines (the gags' role "farmer" is the kit's word, never shown)
  for (const c of animals.cast) texts.push([`creature ${c.kind}`, [c.name, ...c.actions.map(a => a.label), ...Object.values(c.lines).flat()].join('\n')]);
  for (const g of [...animals.gags, ...animals.play]) texts.push([`gag ${g.id}`, Object.values(g.lines ?? {}).flat().join('\n')]);
  const busy = crowd({ prs: { open: [{ number: 12, title: 'New cart', url: 'https://github.com/you/shop/pull/12', checks: 'ok', draft: false }], merged: [{ number: 9, title: 'Old cart', url: 'https://github.com/you/shop/pull/9', at: TOUR_NOW }] },
    plan: { windows: [{ kind: 'five_hour', percentUsed: 40, resetsAt: TOUR_NOW + 3_600_000 }, { kind: 'seven_day', percentUsed: 75, resetsAt: TOUR_NOW + 86_400_000 }] },
    children: [{ id: 'c1', kind: 'subagent', state: 'running', label: 'Look around', agentType: 'Explore', startedAt: TOUR_NOW }] });
  for (const snap of [{ generatedAt: TOUR_NOW, agents: [], repos: [], collisions: [] }, busy]) {
    const scene = F.factoryScene(window.AgentvilleScene.toScene(snap));
    h.relayout(h.grid.layoutFor(scene.fields));
    h.setScene(scene);
    for (const k of ['desk', 'bank', 'drones', 'dock']) { const d = h.dialog(k); assert.ok(d?.title && d.html, `${k} opens a dialog`); texts.push([`dialog ${k}`, `${d.title}\n${d.html}`]); }
    h.labels((x, y, html, cls = '', title = '') => texts.push([`label at ${x},${y}`, `${html}\n${title}`]), { desk: 2, turn: 1, storage: 1, charge: 1, floor: 1, nap: 1 });
    for (const f of scene.farmers) {
      texts.push([`tip ${f.id}`, h.tip(f)]);
      const z = h.slots(f).zone;
      texts.push([`zoneText ${z}`, h.zoneText(f, z)]);
      h.onMove(f, z, 'somewhere', t => texts.push([`pop ${z}`, t]));
    }
  }
  for (const k of ['barn', 'board', 'nothing']) assert.equal(h.dialog(k), null, `${k}: the engine's own, or none`);
  assert.match(h.dialog('desk').html, /data-farm-pick="w0"/, 'your desk: an Open button for each robot waiting on you');
  assert.match(h.dialog('dock').html, /#12/, 'the loading dock lists the open pull requests');
  // What a person reads: the words, not the markup (the engine's own attributes are data-farm-*).
  for (const [where, t] of texts) assert.doesNotMatch(String(t).replace(/<[^>]*>/g, ' '), FARM, `${where}: ${t}`);
});

test('the floor: no hole in the ground, the walkway across it, the safety line round the bays, the conveyor at GRID.y1 + 12', () => {
  const { window, ctx } = load();
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
    const walk = at(0, 83), belt = at(0, L.GRID.y1 + 12);
    for (let x = 0; x < h.W; x++) { assert.equal(at(x, 83), walk, `the walkway at ${x}`); assert.equal(at(x, L.GRID.y1 + 12), belt, `the conveyor at ${x}`); }
    assert.notEqual(walk, at(60, 200), 'the walkway is not the floor');
    const G = L.GRID, line = new Set([ink('#ffd43b'), ink('#2a1d14')]), edge = [];
    for (let x = G.x0; x < G.x1; x++) edge.push(at(x, G.y0), at(x, G.y1 - 1));
    for (let y = G.y0; y < G.y1; y++) edge.push(at(G.x0, y), at(G.x1 - 1, y));
    const on = edge.filter(c => line.has(c)).length;
    assert.ok(on / edge.length >= 0.9, `${rows} rows: the safety line goes round the bays (${on} of ${edge.length}, gaps for the paths)`);
    assert.ok(edge.includes(ink('#ffd43b')) && edge.includes(ink('#2a1d14')), 'yellow and black');
  }
});

test('the windows show the sky by the clock, only in their panes: day and night apart', () => {
  const { window, dom, ctx, F } = load();
  const h = window.hooks, PXG = vm.runInContext('PXG', ctx);
  PXG.ctx = dom.document.createElement('canvas').getContext('2d');
  PXG.T = 3;
  const paint = sky => { dom.calls.rects.length = 0; h.weather(sky); return dom.calls.rects.map(r => [...r]); };
  const day = paint({ phase: 'day', light: 1, sun: { x: 170, y: 6 }, moon: null }), night = paint({ phase: 'night', light: 0, sun: null, moon: { x: 230, y: 8 } });
  assert.ok(F.WINDOWS.every(([, wy, , wh]) => wy >= 6 && wy + wh <= 30), 'the windows are at y 6–30');
  for (const [when, rects] of [['day', day], ['night', night]]) {
    assert.ok(rects.length > 0, `${when}: drawn`);
    for (const [c, x, y, w, hh] of rects) assert.ok(F.WINDOWS.some(([wx, wy, ww, wh]) => x >= wx && y >= wy && x + w <= wx + ww && y + hh <= wy + wh), `${when}: ${c} at ${x},${y} ${w}×${hh} is in a window`);
  }
  const colours = rects => new Set(rects.map(r => r[0]));
  assert.ok([...colours(day)].some(c => !colours(night).has(c)), 'the day sky is not the night sky');
});

test('the loading dock: a crate for each open pull request across the bays, up to 8, each tagged with its checks', () => {
  const { F } = load();
  const pr = (number, checks, draft = false) => ({ number, title: `pr ${number}`, url: '', checks, draft });
  const fields = [
    { key: 'a', prs: { open: [pr(1, 'ok'), pr(2, 'failed'), pr(3, 'running'), pr(4, 'ok', true)], merged: [] } },
    { key: 'b', prs: null },
    { key: 'c', prs: { open: [pr(5, null), pr(6, 'ok'), pr(7, 'ok'), pr(8, 'failed'), pr(9, 'ok'), pr(10, 'ok')], merged: [] } },
  ];
  const crates = plain(F.dockCrates(fields));
  assert.equal(crates.length, 8, 'eight at most');
  assert.deepEqual(crates.map(c => c.qa), ['ok', 'failed', 'running', 'draft', 'none', 'ok', 'ok', 'failed'], 'its QA tag: green pass, red failed, amber running, grey draft (a draft whatever its checks)');
  for (const c of crates) assert.ok(c.x >= 320 && c.x + 8 <= 394 && c.y >= 14 && c.y + 7 <= 78, `crate at ${c.x},${c.y} on the dock`);
  for (let i = 0; i < crates.length; i++) for (let j = i + 1; j < crates.length; j++) assert.ok(Math.abs(crates[i].x - crates[j].x) >= 8 || Math.abs(crates[i].y - crates[j].y) >= 7, 'crates side by side or stacked, not in each other');
  assert.deepEqual(plain(F.dockCrates([])), []);
});

test("ground: the beacon over your desk is lit while a robot waits on you; the fabricator's door glows while one rolls out, never when still", () => {
  const { window, dom, ctx, F } = load();
  const h = window.hooks, PXG = vm.runInContext('PXG', ctx), ink = vm.runInContext('ink', ctx);
  PXG.ctx = dom.document.createElement('canvas').getContext('2d');
  PXG.T = 0;
  h.relayout(h.grid.layoutFor([]));
  const draw = () => { dom.calls.rects.length = 0; h.ground(); return dom.calls.rects.map(r => [...r]); };
  const at = (rects, x, y) => rects.filter(([, rx, ry, w, hh]) => x >= rx && x < rx + w && y >= ry && y < ry + hh).map(r => r[0]).at(-1);
  const sceneOf = state => F.factoryScene(window.AgentvilleScene.toScene({ generatedAt: TOUR_NOW, agents: [person('a', { state, now: null })], repos: [], collisions: [] }));
  h.setScene(sceneOf('idle'));
  const off = at(draw(), 142, 37);
  h.setScene(sceneOf('waiting'));
  const lit = at(draw(), 142, 37);
  assert.notEqual(lit, off, 'the beacon lights up');
  assert.ok([ink('#ff6b6b'), ink('#e04a3a')].includes(lit), `red (${lit})`);
  const door = rects => rects.filter(([c, x, y]) => c === ink('#ffe8a3') && x >= 47 && x < 77 && y >= 44 && y < 82).length;
  assert.equal(door(draw()), 0, 'no glow while nobody rolls out');
  const out = { walk: true, x: 70, y: 80 }, posOf = () => out;
  h.tick(0.03, posOf);
  assert.ok(door(draw()) > 0, "a robot rolling out: the door glows");
  h.tick(0, posOf, true);
  assert.equal(door(draw()), 0, 'drawn still (motion off): nothing rolls out, so no glow');
  h.tick(0.03, posOf);
  out.x = 200;
  h.tick(0.03, posOf);
  assert.ok(door(draw()) > 0, 'it fades, not off at once');
  for (let i = 0; i < 40; i++) h.tick(0.03, posOf);
  assert.equal(door(draw()), 0, 'gone by: the glow has faded');
});

test("items: the open table between its back and front places, the pods' glass over their sleepers, a fresh list each call", () => {
  const { window } = load();
  const h = window.hooks;
  const a = h.items();
  assert.notEqual(a, h.items(), 'a fresh array each call (the engine pushes its own into it)');
  assert.ok(a.every(it => Number.isFinite(it[0]) && typeof it[1] === 'function'));
  const ys = a.map(it => it[0]), table = Array.from({ length: 4 }, (_, i) => placeOf(h, 'floor', i));
  const backY = Math.min(...table.map(p => p[1])), frontY = Math.max(...table.map(p => p[1]));
  assert.ok(backY < frontY && table[0][1] === frontY, 'two behind the table, two in front (filled first)');
  assert.ok(ys.some(y => y > backY && y < frontY), 'the table is drawn after the robots behind it, before the ones in front');
  for (let i = 0; i < 2; i++) { const [, y] = placeOf(h, 'nap', i); assert.ok(ys.some(v => v > y && v <= y + 4), `pod ${i}: its glass over its sleeper`); }
});

/* ---------- the bays: a robot built as the context fills, and what its repo's state puts round it ---------- */

const FARM_WORDS = /\b(farm|field|crop|harvest|porch|barn|silo|henhouse|stall|scarecrow|meadow|hammock|pigeon|market)/i;
/** A snapshot of the shop's bay and its robots, in the collector's shapes; `collision` is the collision's severity. */
function bay({ collision = null, ...over } = {}, agents = []) {
  return {
    generatedAt: Date.now(), agents, collisions: collision ? [{ repo: SHOP, severity: collision, reason: 'two agents edit the same files', since: 0, agentIds: [] }] : [],
    repos: [{ path: SHOP, name: 'shop', branch: 'main', dirty: 0, ahead: 0, behind: 0, lastDeploy: null, agentIds: agents.map(a => a.id), ...over }],
  };
}
const deployed = (state, label = state, detail = undefined) => ({ lastDeploy: { state, source: 'actions', label, detail, at: TOUR_NOW } });
/** The factory with a canvas to draw on, and the floor's drawing each frame (ground) for a snapshot: its fills and pictures. */
function bays() {
  const { window, dom, ctx, F } = load();
  const h = window.hooks, PXG = vm.runInContext('PXG', ctx);
  PXG.ctx = dom.document.createElement('canvas').getContext('2d');
  PXG.T = 1.3;
  const sceneOf = snap => F.factoryScene(window.AgentvilleScene.toScene(snap));
  const ground = snap => {
    if (snap) { const scene = sceneOf(snap); h.relayout(h.grid.layoutFor(scene.fields)); h.setScene(scene); }
    dom.calls.rects.length = 0; dom.calls.images.length = 0;
    h.ground();
    return { rects: dom.calls.rects.map(r => [...r]), images: dom.calls.images.map(i => [...i]) };
  };
  return { window, dom, ctx, F, h, PXG, sceneOf, ground };
}

test('a bay builds its robot as the context fills: the frame, wiring (30%), plating (50%), the head (70%), its eyes lit (85%)', () => {
  const { sceneOf } = bays();
  const buildAt = (...pcts) => sceneOf(bay({}, pcts.map((p, i) => person(`p${i}`, { contextTokens: Math.round(p * 200_000) })))).fields[0].build;
  assert.deepEqual([0, 0.3, 0.5, 0.7, 0.9].map(p => buildAt(p)), [0, 1, 2, 3, 4]);
  assert.deepEqual([0.29, 0.49, 0.69, 0.84, 0.85, 1].map(p => buildAt(p)), [0, 1, 2, 3, 4, 4], 'at the edges');
  assert.equal(buildAt(0.2, 0.6), 2, 'the fullest robot at work there');
  const as = (state, p) => sceneOf(bay({}, [person('x', { state, contextTokens: p * 200_000, now: null })])).fields[0].build;
  assert.equal(as('waiting', 0.9), 4, 'waiting on you: still its robot');
  assert.equal(as('yourTurn', 0.9), 4, 'your turn: still its robot');
  assert.equal(as('idle', 0.9), 0, 'idle: nobody builds there, a bare frame');
  assert.equal(as('stale', 0.9), 0, 'stale: nobody builds there');
  assert.equal(sceneOf(bay()).fields[0].build, 0, 'no robots: the frame');
});

test("a bay's flag is a branch other than main; its stack light is its last deploy's state; each robot keeps its look", () => {
  const { sceneOf, F } = bays();
  const field = over => sceneOf(bay(over)).fields[0];
  for (const [branch, flag] of [['feature/cart', true], ['main', false], ['master', false], ['(detached)', false], [null, false]]) assert.equal(field({ branch }).flag, flag, String(branch));
  for (const state of ['ok', 'failed', 'running', 'blocked', 'other']) assert.equal(field(deployed(state)).light, state);
  assert.equal(field(deployed('cancelled')).light, 'other', "a state it doesn't name: drawn one way");
  assert.equal(field({}).light, null, 'no deploy: no stack light');
  assert.equal(field({ lastDeploy: undefined, deploy: { status: 'in_progress' } }).light, 'running', 'a bare Actions run (no words)');
  assert.deepEqual(plain(sceneOf(bay({}, [person('x')])).farmers[0].look), plain(F.lookOf({ id: 'x' })));
});

test('a bare bay (no deploy, pull requests, git counts or project) draws only its bench and the frame; each thing its repo has adds to it', () => {
  const { ground, ctx } = bays();
  const none = ground({ generatedAt: Date.now(), agents: [], repos: [], collisions: [] }).rects.length;
  const fills = (over = {}, agents = []) => { let n = 0; assert.doesNotThrow(() => { n = ground(bay(over, agents)).rects.length - none; }, JSON.stringify(over)); return n; };
  const bare = fills();
  assert.ok(bare > 0, 'it draws its bench and frame');
  assert.ok(bare <= 120, `only those: ${bare} fills`);
  const worker = [person('w')], job = [person('w', { children: [{ id: 'j1', kind: 'bgjob', state: 'running', startedAt: TOUR_NOW }] })];
  const more = {
    'a deploy (its stack light)': deployed('ok', '✓ deployed'),
    'uncommitted files (loose parts)': { dirty: 3 },
    'unpushed commits (boxed parts)': { ahead: 2 },
    'behind its remote (a capsule at the tube outlet)': { behind: 1 },
    'a collision (hazard tape)': { collision: 'low' },
  };
  for (const [what, over] of Object.entries(more)) assert.ok(fills(over) > bare, `${what}: ${fills(over)} fills, bare ${bare}`);
  const ink = vm.runInContext('ink', ctx), colours = over => ground(bay(over)).rects.map(r => r[0]);
  const open = colours({}), glass = colours({ worktree: true, main: '/Users/you/code/other' });
  assert.ok(glass.includes(ink('#a9dcf7')) && !open.includes(ink('#a9dcf7')), 'a worktree: pale-blue glass round the bench');
  assert.ok(glass.filter(c => c === ink('#ffd43b')).length < open.filter(c => c === ink('#ffd43b')).length, '… in place of the yellow frame');
  assert.ok(fills({}, job) > fills({}, worker), 'a background command (a part printer)');
  assert.ok(fills({ dirty: 6 }) > fills({ dirty: 3 }) && fills({ dirty: 9 }) === fills({ dirty: 6 }), 'one loose part a file, up to 6');
  assert.ok(fills({ ahead: 4 }) > fills({ ahead: 2 }) && fills({ ahead: 9 }) === fills({ ahead: 4 }), 'one box a commit, up to 4');
  assert.equal(fills({ behind: 5 }), fills({ behind: 1 }), 'one capsule, however far behind');
});

test('the robot on the bench differs at each stage, and each stack light differs', () => {
  const { ground } = bays();
  const sig = snap => JSON.stringify(ground(snap));
  const stages = [0, 0.3, 0.5, 0.7, 0.9].map(p => sig(bay({}, [person('a', { contextTokens: p * 200_000 })])));
  assert.equal(new Set(stages).size, 5, 'five stages, five pictures');
  const lights = ['ok', 'failed', 'running', 'blocked', 'other'].map(state => sig(bay(deployed(state))));
  assert.equal(new Set(lights).size, 5, 'ok, failed, running, blocked and other: five stack lights');
});

test('setScene tells what happened: Built! for a compaction, Shipped! at the loading dock for a newly merged pull request, a deploy failing or going through', () => {
  const { h, sceneOf } = bays();
  const a = n => [person('a', { compactions: n })];
  h.relayout(h.grid.layoutFor(sceneOf(bay()).fields));
  assert.deepEqual(plain(h.setScene(sceneOf(bay({}, a(1))))), [], 'the first scene: nothing has happened yet');
  const built = plain(h.setScene(sceneOf(bay({}, a(2)))));
  assert.deepEqual(built.map(e => [e.kind, e.id, e.text, e.cls]), [['harvest', 'a', 'Built!', 'good']]);
  assert.match(built[0].log, /compacted/);
  assert.deepEqual(plain(h.setScene(sceneOf(bay({}, a(2))))), [], 'nothing new');
  const pr = (number, at) => ({ number, title: 'New cart', url: '', at });
  assert.deepEqual(plain(h.setScene(sceneOf(bay({ prs: { open: [], merged: [pr(9, Date.now() - 3 * 3_600_000)] } }, a(2))))), [], 'merged hours ago: old news');
  const shipped = plain(h.setScene(sceneOf(bay({ prs: { open: [], merged: [pr(9, Date.now() - 3 * 3_600_000), pr(12, Date.now())] } }, a(2)))));
  assert.deepEqual(shipped.map(e => [e.kind, e.text, e.cls]), [['merged', 'Shipped! #12', 'good']]);
  assert.equal(h.buildingAt(...shipped[0].at), 'dock', 'it pops at the loading dock');
  assert.equal(shipped[0].who, 'The loading dock', 'the floor log names the dock');
  assert.match(shipped[0].log, /#12 merged/);
  assert.deepEqual(plain(h.setScene(sceneOf(bay({ prs: { open: [], merged: [pr(12, Date.now())] } }, a(2))))), [], 'seen');
  const [s] = h.layout().ST, at = plain([s.cx, s.rowTop + 30]);
  const kinds = over => plain(h.setScene(sceneOf(bay(over, a(2))))).map(e => [e.kind, e.at, e.text]);
  assert.deepEqual(kinds(deployed('failed')), [['deployFailed', at, '']], 'a deploy fails: for the animals, no words');
  assert.deepEqual(kinds(deployed('failed')), [], 'not again while it stays failed');
  assert.deepEqual(kinds(deployed('running')), []);
  assert.deepEqual(kinds(deployed('ok')), [['deployOk', at, '']], 'it goes through');
  for (const e of [...built, ...shipped]) assert.doesNotMatch(`${e.text} ${e.log} ${e.who ?? ''}`, FARM_WORDS, 'in factory words');
});

test('a compaction rolls the finished robot from its bay down the aisle onto the conveyor, which carries it off; with motion off nothing rolls', () => {
  const { h, sceneOf, ground } = bays();
  const robot = n => [person('a', { compactions: n, contextTokens: n % 2 ? 190_000 : 10_000 })];
  const L = h.relayout(h.grid.layoutFor(sceneOf(bay()).fields)), [s] = L.ST, belt = L.GRID.y1 + 12;
  const rolling = () => ground().images.filter(([, , w, hh]) => w === 14 && hh === 16); // the bench's robot is a bare frame now: any robot drawn is the one rolling
  h.setScene(sceneOf(bay({}, robot(1))));
  h.setScene(sceneOf(bay({}, robot(2))));
  const seen = [];
  for (let i = 0; i < 1200 && (seen.length < 2 || rolling().length); i++) {
    const r = rolling();
    assert.ok(r.length <= 1, 'one robot');
    if (r.length) seen.push(r[0]);
    h.tick(0.05, () => null);
  }
  assert.ok(seen.length > 20, 'it rolls a while');
  const feet = ([x, y]) => [x + 7, y + 16];
  assert.ok(seen.some(r => { const [x, y] = feet(r); return Math.abs(x - 218) <= 1 && y > s.rowTop + 30 && y < belt - 8; }), 'down the aisle beside its bay');
  const onBelt = seen.filter(r => Math.abs(feet(r)[1] - (belt + 3)) <= 1);
  assert.ok(onBelt.length > 5, 'then on the conveyor');
  assert.ok(onBelt.every((r, i) => i === 0 || r[0] >= onBelt[i - 1][0]) && onBelt.at(-1)[0] > onBelt[0][0], 'carried along it');
  assert.equal(rolling().length, 0, 'and off the edge');
  h.setScene(sceneOf(bay({}, robot(3))));
  h.setScene(sceneOf(bay({}, robot(4))));
  h.tick(0, () => null, true);
  assert.equal(rolling().length, 0, 'drawn still (motion off): nothing rolls');
});

test("a bay's sign: its name, a blue flag for a branch other than main, the deploy's words (why its stack light shows), a worktree's repo, a collision, and its git counts", () => {
  const { h, window } = bays();
  const signs = (snap, priv = false) => {
    let scene = window.AgentvilleScene.toScene(snap);
    if (priv) scene = window.AgentvilleScene.privateScene(scene);
    scene = window.AgentvilleFactory.factoryScene(scene);
    h.relayout(h.grid.layoutFor(scene.fields)); h.setScene(scene);
    const labs = [];
    h.labels((x, y, html, cls = '', title = '') => labs.push({ x, y, html: String(html), cls, title }), {});
    return labs;
  };
  const words = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const signOf = labs => labs.find(l => l.html.includes('data-farm-field'));
  const titleOf = l => l.html.match(/title="([^"]*)"/)?.[1] ?? '';
  const branch = signOf(signs(bay({ branch: 'feature/cart', ...deployed('failed', '✗ deploy failed', 'Build step failed') })));
  assert.match(branch.html, /px-flag/, 'a blue flag on the sign');
  assert.match(words(branch.html), /shop/);
  assert.match(words(branch.html), /feature\/cart/);
  assert.match(words(branch.html), /✗ deploy failed/, 'the deploy, in words, under the name');
  assert.match(titleOf(branch), /Build step failed/, 'and why, on hover');
  assert.match(titleOf(branch), /on feature\/cart/);
  assert.doesNotMatch(signOf(signs(bay({ branch: 'main' }))).html, /px-flag/, 'on main: no flag');
  assert.match(words(signOf(signs(bay({ worktree: true, main: '/Users/you/code/api' }))).html), /worktree of api/);
  const crowded = signOf(signs(bay({ collision: 'high' })));
  assert.match(words(crowded.html), /⚠ crowded/);
  assert.equal(crowded.cls, 'bad');
  const counts = signs(bay({ dirty: 3, ahead: 2, behind: 1 })).filter(l => l.cls === 'cnt').map(l => [words(l.html), l.title]);
  assert.deepEqual(counts, [['↓1', '1 commit behind the remote'], ['↑2', '2 unpushed commits'], ['+3', '3 uncommitted files']]);
  const priv = signOf(signs(bay({ branch: 'feature/cart', ...deployed('failed', '✗ deploy failed', 'Build step failed') }), true));
  assert.doesNotMatch(priv.html, /px-flag|feature|Build step|deploy failed|shop/, 'privacy mode: no branch, no words, no name');
  for (const l of [branch, crowded, priv]) assert.doesNotMatch(`${words(l.html)} ${titleOf(l)}`, FARM_WORDS);
});

test('fieldAt: a point on a bay is its key (a click opens its close-up); the aisle, the walkway and an empty slot are none', () => {
  const { h } = bays();
  const L = h.relayout(h.grid.layoutFor([{ key: SHOP, name: 'shop' }])), [s] = L.ST;
  for (const [x, y] of [[s.cx, s.rowTop + 20], [s.cx - 36, s.rowTop + 12], [s.cx + 36, s.rowTop + 42], [s.cx, s.rowTop + 50]]) assert.equal(h.fieldAt(x, y), SHOP, `${x},${y}`);
  for (const [x, y] of [[218, s.rowTop + 20], [s.cx, 84], [s.cx + 88, s.rowTop + 20], [56, 160]]) assert.equal(h.fieldAt(x, y), null, `${x},${y}`);
});

test('an empty slot is bare floor with a faint outline', () => {
  const { window, ctx } = load();
  const h = window.hooks, ink = vm.runInContext('ink', ctx);
  const L = h.relayout(h.grid.layoutFor([{ key: SHOP, name: 'shop' }]));
  const ext = { x0: 0, x1: h.W, y0: 0, y1: L.H }, pix = new Map();
  h.bg((x, y, w, hh, c) => { for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + w; xx++) pix.set(`${xx},${yy}`, ink(c)); }, 'summer', ext);
  const plainFloor = new Set([ink('#f4ecd8'), ink('#e8d8b0')]); // the tiles and their grout (and scuffs)
  assert.ok(L.empty.length >= 8);
  for (const s of L.empty) {
    const edge = [];
    for (let x = s.x0; x < s.x0 + 72; x++) edge.push(pix.get(`${x},${s.y0}`), pix.get(`${x},${s.y0 + 29}`));
    for (let y = s.y0; y < s.y0 + 30; y++) edge.push(pix.get(`${s.x0},${y}`), pix.get(`${s.x0 + 71},${y}`));
    const marked = edge.filter(c => !plainFloor.has(c)).length;
    assert.ok(marked >= edge.length * 0.3, `slot ${s.i}: an outline (${marked} of ${edge.length})`);
    for (let y = s.y0 + 3; y < s.y0 + 27; y++) for (let x = s.x0 + 3; x < s.x0 + 69; x++) assert.ok(plainFloor.has(pix.get(`${x},${y}`)), `slot ${s.i}: bare floor inside (${x},${y})`);
  }
});

/* ---------- the limits: floor heat for the 5-hour limit, the power-cell bank for the week, and night ---------- */

const RESETS = Date.UTC(2026, 9, 13, 9, 0), LEVELS = ['spring', 'summer', 'autumn', 'winter'];
/** The shop's bay with a plan: the 5-hour limit's % used and the week's (null: no window of that kind); `over` goes in each window. */
function planned(five, week, over = {}) {
  const w = (kind, pct) => (pct === null ? [] : [{ kind, percentUsed: pct, resetsAt: RESETS, ...over }]);
  return { ...bay(), plan: { from: 'test', at: TOUR_NOW, windows: [...w('five_hour', five), ...w('seven_day', week)] } };
}
/** Fills entirely inside a box [x, y, w, h]. */
const inBox = ([bx, by, bw, bh]) => ([, x, y, w, hh]) => x >= bx && y >= by && x + w <= bx + bw && y + hh <= by + bh;
/** Fills over a floor vent (its middle x, its top y): where its shimmer and its steam go. */
const overVents = (rects, vents) => rects.filter(([, x, y, w, hh]) => vents.some(([vx, vy]) => x >= vx - 6 && x + w <= vx + 6 && y >= vy - 18 && y + hh <= vy));

test("season(): the floor's heat by the 5-hour limit, at the farm's bounds (cool, warm, hot, steaming); warm with no reading; cool again in a new window", () => {
  const { h, sceneOf } = bays();
  assert.equal(typeof h.season, 'function', 'the factory gives its own season(): the engine gives it the Heat switch');
  const heatOf = snap => { h.setScene(sceneOf(snap)); return h.season(); };
  assert.deepEqual([10, 40, 70, 95].map(p => heatOf(planned(p, 20))), LEVELS);
  assert.deepEqual([0, 24, 25, 59, 60, 84, 85, 100].map(p => heatOf(planned(p, 20))), ['spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter'], "the farm's seasonOf bounds: 25, 60, 85");
  assert.equal(heatOf({ ...bay(), plan: null }), 'summer', 'no plan reading: warm');
  assert.equal(heatOf(planned(null, 50)), 'summer', 'no 5-hour window: warm');
  assert.equal(heatOf(planned(undefined, 50)), 'summer', 'a 5-hour window with no number is no reading: warm, not steaming');
  assert.equal(heatOf(planned(95, 50, { reset: true })), 'spring', 'a new 5-hour window: cool again');
});

test("the floor vents sit on top of a project's painted zone: a project of bays side by side paints across the aisle, the vent stays", () => {
  const { window, ctx, F } = load();
  const h = window.hooks, ink = vm.runInContext('ink', ctx), project = '/Users/you/work/shop';
  const fields = ['api', 'web', 'admin'].map(name => ({ key: `${project}/${name}`, name, project, projectName: 'shop' }));
  const L = h.relayout(h.grid.layoutFor(fields));
  assert.deepEqual(plain(L.groups[0].slots), [0, 1, 2], 'one project, its three bays side by side on the first row');
  const ZONES = new Set(['#a9dcf7', '#c6e89a', '#f4b6c2', '#ffe8a3'].map(ink)); // the projects' floor paints
  const pix = new Map(), painted = new Set(); // the last colour at each point; the points a zone's paint ever covered
  h.bg((x, y, w, hh, c) => {
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + w; xx++) { pix.set(`${xx},${yy}`, ink(c)); if (ZONES.has(ink(c))) painted.add(`${xx},${yy}`); }
  }, 'summer', { x0: 0, x1: h.W, y0: 0, y1: L.H });
  const firstRow = plain(F.ventsOf(L)).filter(([, y]) => y < 100 + 62);
  assert.equal(firstRow.length, 2);
  for (const [x, y] of firstRow) {
    assert.ok(painted.has(`${x},${y + 3}`), `${x},${y}: the project's zone paint reaches the vent (the case under test)`);
    assert.equal(pix.get(`${x - 4},${y + 3}`), ink('#5f6b7a'), `${x},${y}: its steel frame, over the paint`);
    assert.equal(pix.get(`${x},${y + 3}`), ink('#3a3a40'), `${x},${y}: its dark shaft, over the paint`);
  }
});

test('the heat drawn is the one shown (PXG.season, which the Heat switch may hold), else the live one: steam over the floor vents only when steaming', () => {
  const { h, F, PXG, ground, ctx } = bays();
  const ink = vm.runInContext('ink', ctx);
  ground(planned(10, 20)); // live: cool
  const G = h.layout().GRID, vents = plain(F.ventsOf(h.layout()));
  assert.ok(vents.length >= 6, `a vent in each aisle on each row (${vents.length})`);
  for (const [x, y] of vents) assert.ok(G.y0 < y && y < G.y1 && [218, 306].includes(x), `${x},${y}: in an aisle between the bays`);
  const steam = rects => overVents(rects, vents).filter(r => r[0] === ink(F.STEAM));
  const puffs = () => { const out = []; for (let i = 0; i < 10; i++) h.ambient(0.5, p => out.push(p)); return out.filter(p => p.color === F.STEAM); };
  PXG.season = null;
  assert.equal(steam(ground().rects).length + puffs().length, 0, 'live and cool: no steam');
  PXG.season = 'winter';
  assert.ok(steam(ground().rects).length >= vents.length, 'held at steaming while the live level is cool: steam over every vent');
  const rising = puffs();
  assert.ok(rising.length > 0 && rising.every(p => p.vy < 0), 'and puffs of it rising (ambient)');
  const sparks = []; for (let i = 0; i < 60; i++) h.ambient(1, p => { if (p.color !== F.STEAM) sparks.push(p); });
  assert.ok(sparks.length > 0, 'now and then, sparks');
  for (const p of sparks) assert.ok(h.buildingAt(p.x, p.y) === 'barn' || h.fieldAt(p.x, p.y), `a spark at ${p.x},${p.y}: off a machine (the fabricator, a bay's frame)`);
  for (const level of ['spring', 'summer', 'autumn']) { PXG.season = level; assert.equal(steam(ground().rects).length + puffs().length, 0, `${level}: no steam`); }
  PXG.season = 'autumn';
  assert.ok(overVents(ground().rects, vents).length >= vents.length, 'hot: a shimmer over the vents');
  PXG.season = 'summer';
  assert.equal(overVents(ground().rects, vents).length, 0, 'warm: nothing over the vents');
  ground(planned(95, 20)); // live: steaming
  PXG.season = 'spring';
  assert.equal(steam(ground().rects).length + puffs().length, 0, 'held at cool while the live level is steaming: none');
  PXG.season = null;
  assert.ok(steam(ground().rects).length > 0 && puffs().length > 0, 'live and steaming: steam');
});

test("the thermometer on the back wall shows the level shown; the vents' fans turn slow when cool, faster when warm, racing when hot", () => {
  const { h, F, PXG, ground, ctx } = bays();
  const ink = vm.runInContext('ink', ctx);
  ground(planned(95, 20)); // live: steaming, so each picture below is the held level's
  const [tx, ty, tw, th] = F.THERMOMETER;
  assert.ok(tx >= 127 && tx + tw <= 139 && ty >= 2 && ty + th <= 34, 'on the back wall, between the drone dock and your desk');
  for (const [k, x0, y0, x1, y1] of [['drones', 96, 30, 126, 78], ['desk', 140, 34, 260, 76]]) assert.ok(tx + tw <= x0 || tx >= x1 || ty + th <= y0 || ty >= y1, `clear of the ${k}`);
  const reading = level => { PXG.season = level; return ground().rects.filter(inBox(F.THERMOMETER)); };
  const pics = LEVELS.map(reading);
  assert.equal(new Set(pics.map(p => JSON.stringify(p))).size, 4, 'four levels, four readings');
  assert.ok(pics[0].some(r => r[0] === ink('#3d7be0')) && !pics[3].some(r => r[0] === ink('#3d7be0')), 'cool: blue');
  const [vx, vy] = F.ventsOf(h.layout())[0];
  const turns = level => {
    PXG.season = level;
    let n = 0, last = null;
    for (let k = 0; k <= 60; k++) { PXG.T = k / 60; const sig = JSON.stringify(ground().rects.filter(inBox([vx - 3, vy + 1, 6, 6]))); if (last !== null && sig !== last) n++; last = sig; }
    return n;
  };
  const [cool, warm, hot, steaming] = LEVELS.map(turns);
  assert.ok(cool > 0, `cool: the fans still turn (${cool} turns a second)`);
  assert.ok(cool < warm && warm < hot && hot <= steaming, `slow, faster, racing: ${cool}, ${warm}, ${hot}, ${steaming} turns a second`);
});

test('the power-cell bank: 8 cells, round(8 × (1 − week)) lit; its lamp green, amber from 70%, blinking red from 90%; no reading, nothing lit', () => {
  const { F, PXG, ground, ctx } = bays();
  const ink = vm.runInContext('ink', ctx);
  const weekly = (pct, over = {}) => ({ windows: [{ kind: 'seven_day', percentUsed: pct, resetsAt: RESETS, ...over }] });
  for (const [week, lit, lamp, pct = week] of [[0, 8, 'green'], [50, 4, 'green'], [69, 2, 'green'], [69.6, 2, 'amber', 70], [70, 2, 'amber'], [89, 1, 'amber'], [89.6, 1, 'red', 90], [90, 1, 'red'], [100, 0, 'red']]) {
    const b = plain(F.bankOf(weekly(week)));
    assert.deepEqual([b.lit, b.lamp, b.pct], [lit, lamp, pct], `${week}% of the week: the cells and the lamp go by the % it shows`);
  }
  assert.equal(F.bankOf(weekly(95, { reset: true })).lit, 8, 'a new week: every cell charged');
  for (const plan of [null, { windows: [] }, { windows: [{ kind: 'five_hour', percentUsed: 50 }] }, weekly(undefined), weekly(null), weekly('lots')]) assert.equal(F.bankOf(plan), null, `no reading: ${JSON.stringify(plan)}`);
  const LAMP = [295, 15, 6, 4];
  const drawn = (week, T = 0) => {
    PXG.T = T;
    const { rects } = ground(week === null ? { ...bay(), plan: null } : planned(30, week));
    const lit = F.CELLS.filter(([x, y]) => rects.some(r => r[0] === ink(F.CHARGED) && inBox([x, y, 8, 10])(r))).length;
    return { lit, lamp: rects.filter(inBox(LAMP)).map(r => r[0]) };
  };
  assert.deepEqual([0, 50, 90, 100].map(w => drawn(w).lit), [8, 4, 1, 0], 'drawn: 8, 4, 1 and 0 cells lit');
  assert.ok(drawn(50).lamp.includes(ink('#6cc04a')), 'the lamp green');
  assert.ok(drawn(75).lamp.includes(ink('#f0b429')) && drawn(75, 0.3).lamp.includes(ink('#f0b429')), 'amber, steady');
  const red = [0, 0.3, 0.6, 0.9].map(T => drawn(95, T).lamp.includes(ink('#e04a3a')));
  assert.ok(red.includes(true) && red.includes(false), `red, blinking (${red})`);
  const none = drawn(null);
  assert.deepEqual([none.lit, none.lamp.length], [0, 0], 'no reading: no cell lit, the lamp off');
  const bad = drawn(undefined);
  assert.deepEqual([bad.lit, bad.lamp.length], [0, 0], 'a weekly window with no number: as no reading');
});

test("the bank's tooltip gives the week's % and when it resets; with no reading it says so", () => {
  const { h, sceneOf } = bays();
  const resets = new Date(RESETS).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  h.setScene(sceneOf(planned(30, 72)));
  const tip = h.buildingTip('bank');
  assert.match(tip, /power-cell bank/);
  assert.match(tip, /72% used/);
  assert.ok(tip.includes(`resets ${resets}`), tip);
  h.setScene(sceneOf(planned(30, 72, { reset: true })));
  assert.match(h.buildingTip('bank'), /just reset/);
  h.setScene(sceneOf(planned(30, 69.6)));
  assert.match(h.buildingTip('bank'), /70% used, 2 of 8 cells left/, 'the % it shows is the one the lamp and cells go by');
  h.setScene(sceneOf(planned(30, undefined)));
  const bad = h.buildingTip('bank');
  assert.match(bad, /no reading/, 'a weekly window with no number: no reading');
  assert.doesNotMatch(bad, /NaN/);
  assert.doesNotMatch(h.dialog('bank').html, /NaN/, 'nor in its dialog');
  assert.match(h.dialog('bank').html, /no reading/);
  h.setScene(sceneOf({ ...bay(), plan: null }));
  const none = h.buildingTip('bank');
  assert.match(none, /no reading/);
  for (const t of [tip, none]) assert.doesNotMatch(t, FARM_WORDS);
});

test("lights(): the desk lamp, the screens, every bay's stack light, the fabricator's glow and each welding robot's spark; the same drawn still", () => {
  const { h, F, sceneOf } = bays();
  const reader = person('r', { cwd: '/Users/you/code/blog', now: { tool: 'Read', summary: 'a.ts', step: 'read', startedAt: TOUR_NOW } });
  const repo = (name, state, agentIds = []) => ({ path: `/Users/you/code/${name}`, name, branch: 'main', dirty: 0, ahead: 0, behind: 0, lastDeploy: state ? deployed(state).lastDeploy : null, agentIds });
  const scene = sceneOf({ generatedAt: TOUR_NOW, collisions: [], agents: [person('w'), reader], repos: [repo('shop', 'ok', ['w']), repo('blog', 'failed', ['r']), repo('api', 'running'), repo('docs', 'blocked'), repo('notes', null)] });
  const L = h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const at = { w: { x: 200, y: 144, walk: false }, r: { x: 290, y: 144, walk: false } }, posOf = id => at[id] ?? null;
  const shown = () => plain(h.lights());
  const within = (lights, [x0, y0, w, hh]) => lights.some(([x, y]) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + hh);
  const near = (lights, [x, y], d = 3) => lights.some(([lx, ly]) => Math.abs(lx - x) <= d && Math.abs(ly - y) <= d);
  const check = (lights, when) => {
    assert.ok(lights.every(l => l.length === 4 && l.slice(0, 3).every(Number.isFinite)), `${when}: each [x, y, reach, the lit shape]`);
    assert.ok(within(lights, [148, 43, 15, 13]), `${when}: the desk lamp`);
    assert.ok(within(lights, [189, 41, 24, 13]), `${when}: your desk's screen`);
    assert.ok(within(lights, [40, 29, 15, 8]), `${when}: the fabricator's screen`);
    for (const s of L.ST) {
      const lit = scene.fields.find(f => f.key === s.key).light !== null;
      assert.equal(near(lights, plain(F.stackLightAt(s))), lit, `${when}: ${s.key}'s stack light ${lit ? 'glows' : '(none: no deploy)'}`);
    }
  };
  h.tick(0.03, posOf);
  const live = shown();
  check(live, 'live');
  const tip = ({ x, y }) => [x - 7 + F.WELD_TIP[0], y - 16 + F.WELD_TIP[1]]; // the welder's tip, in the robot's pixels from its sprite's top left
  assert.ok(near(live, tip(at.w), 1), "the welding robot's spark, at its welder's tip (editing: a welder)");
  assert.ok(!near(live, tip(at.r), 4), 'none for a robot reading');
  assert.ok(!within(live, [47, 44, 30, 40]), "the fabricator's door is dark while nobody rolls out");
  at.w.walk = true;
  assert.ok(!near(shown(), tip(at.w), 4), 'nor while it walks');
  at.w.walk = false;
  h.tick(0.03, () => ({ walk: true, x: 62, y: 80 }));
  assert.ok(within(shown(), [47, 44, 30, 40]), "a robot rolling out: the fabricator's door glows");
  h.tick(0, posOf, true);
  check(shown(), 'drawn still (motion off)');
});

test('no plan reading: warm, the bank shows no reading, and the Heat switch can still hold a level (held at steaming, the engine draws steam)', () => {
  const seen = {};
  const { window, dom, ctx, F } = load({ wrap: hooks => { hooks.hud = p => { seen.hud = p; return ''; }; } });
  const ink = vm.runInContext('ink', ctx);
  window.registered.start({ el: dom.make(), opts: { still: true }, prefs: { get: k => (k === 'season' ? 'winter' : null), set() {} } });
  dom.calls.rects.length = 0;
  window.registered.scene(window.AgentvilleScene.toScene({ ...bay(), plan: null }));
  const h = window.hooks;
  assert.equal(h.season(), 'summer', 'live: warm');
  assert.match(h.buildingTip('bank'), /no reading/);
  assert.equal(seen.hud.seasons, true, 'the engine gives the factory its Heat switch');
  assert.equal(seen.hud.seasonMode, 'winter', '… held at steaming');
  const vents = plain(F.ventsOf(h.layout()));
  assert.ok(overVents(dom.calls.rects, vents).filter(r => r[0] === ink(F.STEAM)).length >= vents.length, 'held at steaming: steam over the vents');
  assert.ok(!F.CELLS.some(([x, y]) => dom.calls.rects.some(r => r[0] === ink(F.CHARGED) && inBox([x, y, 8, 10])(r))), 'no cell lit');
});

/* ---------- what robots hold, their details, their drones, the AGVs, and messages through the tubes ---------- */

// The spec's table (§5): each step and the prop a robot holds for it; plan mode is the kit's blueprint.
const HELD = {
  read: 'datapad', search: 'scanner', web: 'antenna', edit: 'welder', write: 'printer', test: 'multimeter', lint: 'polisher', build: 'wrench',
  install: 'forklift', commit: 'crate', push: 'ramp', deploy: 'rocketCrate', pull: 'capsule', serve: 'rack', delete: 'shredder', agent: 'megaphone',
  plan: 'clipboard', ask: 'card', shell: 'terminal', other: 'terminal', planMode: 'blueprint',
};
const FAMILY_PIN = { opus: '#8a5fc0', sonnet: '#3d7be0', haiku: '#2fa57a', fable: '#f08a24' }; // the farm's pins: purple Opus, blue Sonnet, green Haiku, orange Fable
const SKIN = ['#f1c7a1', '#e0a878', '#c68a5a', '#9c6644', '#7d5236']; // the people kit's hands: never on a robot
/** What a prop draws at a few moments, as the props kit's test records it: its fills, with their colours. */
function propDrawing({ ctx }, kit, prop) {
  const PXG = vm.runInContext('PXG', ctx), rpAt = vm.runInContext('rpAt', ctx);
  return [0.1, 0.4, 0.7].map(T => {
    const rects = [];
    PXG.ctx = { set fillStyle(c) { this.c = c; }, get fillStyle() { return this.c; }, fillRect(x, y, w, h) { if (w > 0 && h > 0) rects.push([this.c, x, y, w, h]); }, globalAlpha: 1 };
    PXG.T = T; PXG.k = 1; PXG.lights = [];
    kit.draw(prop, rpAt(0, 0), T);
    return rects;
  });
}

test("the factory's kit: each step of the spec's table holds its prop, in the factory's own words", () => {
  const { F, window } = load();
  for (const [step, prop] of Object.entries(HELD)) assert.equal(F.props.steps[step].prop, prop, step);
  assert.equal(F.props.steps.mcp.prop, 'plug', "an MCP call keeps the kit's plug (its AGV is what shows it)");
  const kit = { ...window.Agentville.props.STEPS, planMode: window.Agentville.props.PLAN_MODE };
  for (const [step, a] of Object.entries(F.props.steps)) {
    assert.ok(typeof a.verb === 'string' && a.verb.length > 3, step);
    assert.notEqual(a.verb, kit[step]?.verb, `${step}: the factory's words, not the kit's (${a.verb})`);
    assert.doesNotMatch(a.verb, FARM_WORDS, step);
    assert.equal(a.spot, kit[step].spot, `${step}: where it stands at its bay, the kit's`);
  }
  assert.equal(F.props.doing({ state: 'working', step: 'edit' }).prop, 'welder');
  assert.equal(F.props.doing({ state: 'working', mode: 'plan', step: 'edit' }).prop, 'blueprint', "plan mode: the kit's blueprint");
});

test('every prop a robot holds draws at three moments, no two alike, each of the factory\'s own moves, and all with metal claws (no skin)', () => {
  const loaded = load(), { F } = loaded;
  const used = [...new Set(Object.values(F.props.steps).map(a => a.prop))];
  for (const own of F.FACTORY_PROPS) assert.ok(used.includes(own), `${own} is held for a step`);
  const seen = new Map();
  for (const prop of used) {
    const d = propDrawing(loaded, F.props, prop);
    assert.ok(d.every(r => r.length > 0), `${prop} draws at every moment`);
    const sig = JSON.stringify(d);
    assert.ok(!seen.has(sig), `${prop} looks like ${seen.get(sig)}`);
    seen.set(sig, prop);
    assert.ok(!d.flat().some(r => SKIN.includes(r[0])), `${prop}: a robot's claw, not a hand`);
    if (F.FACTORY_PROPS.includes(prop)) assert.ok(new Set(d.map(r => JSON.stringify(r))).size > 1, `${prop} moves`);
  }
  const kitOf = prop => JSON.stringify(propDrawing(loaded, loaded.window.Agentville.props, prop));
  for (const same of ['wrench', 'card', 'terminal']) assert.notEqual(JSON.stringify(propDrawing(loaded, F.props, same)), kitOf(same), `the factory's own ${same}, not the kit's`);
  const flame = propDrawing(loaded, F.props, 'welder').flat().filter(r => r[0] === '#ffffff');
  assert.ok(flame.some(r => r[1] === F.WELD_TIP[0] && r[2] === F.WELD_TIP[1]), "the welder's flame is at its tip (WELD_TIP), where its spark glows at night");
});

const OX = 193, OY = 128; // a robot standing at (200, 144): its sprite's top left
const ROBOT = { id: 'r', name: 'r', state: 'working', shirt: '#4a7bd0', look: { head: 'box', drive: 'wheels', line: 'claude', chest: 0 }, kids: [], family: null, cost: null, mode: 'default', fast: false, hot: false, tasks: null, thinking: false, color: 0 };
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
/** The factory, its canvas keeping its fills, and a robot drawn with its details (drawChar, then drawFx) at T: standing at (200, 144), or as `body` says. */
function robots() {
  const all = bays(), { h, dom, PXG } = all;
  const fills = draw => { dom.calls.rects.length = 0; dom.calls.images.length = 0; draw(); return dom.calls.rects.map(r => [...r]); };
  const drawn = (over = {}, body = {}, T = 1) => {
    const f = { ...ROBOT, ...over }, b = { x: 200, y: 144, walk: false, face: 'down', zone: 'st:x', kids: [], ...body };
    PXG.T = T;
    h.drawChar(f, b); // its sprite, made once
    return fills(() => { h.drawChar(f, b); h.drawFx(f, b); });
  };
  return { ...all, fills, drawn, ink: vm.runInContext('ink', all.ctx) };
}

test("a robot's beacon on top of its head: green working, red blinking waiting on you, amber your turn, blue idle; a stale one's is off", () => {
  const { drawn, F } = robots();
  const lamp = (state, T = 1) => drawn({ state }, {}, T).filter(inRect(OX + 5, OY - 4, 4, 6)).map(r => hue(r[0]));
  assert.ok(lamp('working').includes('green'), 'working: green');
  assert.ok(lamp('turn').includes('amber'), 'your turn: amber');
  assert.ok(lamp('idle').includes('blue'), 'idle: blue');
  const red = [0, 0.13, 0.26, 0.39].map(T => lamp('waiting', T).includes('red'));
  assert.ok(red.includes(true) && red.includes(false), `waiting on you: red, blinking (${red})`);
  assert.ok(lamp('stale').length > 0 && lamp('stale').every(c => c === 'grey'), 'stale: powered down, its beacon off');
  for (const head of Object.keys(F.HEADS)) { // on top of every head, touching it
    const look = { ...ROBOT.look, head }, rows = plain(F.robotRows(look, 'down', 's')), top = rows.findIndex(r => r.slice(5, 9) !== '....');
    const beacon = drawn({ look }).filter(r => r[1] >= OX + 5 && r[1] + r[3] <= OX + 9 && r[2] + r[4] <= OY + top);
    assert.ok(beacon.length > 0, `${head}: a beacon`);
    assert.equal(Math.max(...beacon.map(r => r[2] + r[4])), OY + top, `${head}: it sits on the head's top (row ${top})`);
  }
});

test("the light on a robot's antenna is its model's colour (the farm's pins: purple Opus, blue Sonnet, green Haiku, orange Fable)", () => {
  const { F, h, dom, PXG } = robots();
  const look = { head: 'antenna', drive: 'legs', line: 'claude', chest: 2 }, lights = [];
  plain(F.robotRows(look, 'down', 's')).forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'a') lights.push(`${x},${y}`); }));
  assert.ok(lights.length > 0);
  for (const [family, colour] of Object.entries(FAMILY_PIN)) {
    const sprite = pixelsOf(dom, () => F.robotSprite(look, '#d55181', { light: colour }));
    for (const k of lights) assert.equal(sprite.get(k), colour, `${family}: its antenna light at ${k}`);
    PXG.T = 1;
    const made = pixelsOf(dom, () => h.drawChar({ ...ROBOT, id: family, look, shirt: '#2fa57a', family }, { x: 200, y: 144, walk: false, kids: [] })); // its sprite is made now
    for (const k of lights) assert.equal(made.get(k), colour, `drawn for a ${family} agent`);
  }
});

test('on a robot: hazard stripes for bypass permissions, speed lines for fast mode, a chest badge for what it has cost (copper, then silver from $10, gold from $50)', () => {
  const { drawn, ink } = robots();
  const base = drawn();
  const body = rects => rects.filter(inRect(OX + 2, OY + 9, 10, 4));
  const stripes = body(drawn({ mode: 'bypassPermissions' })).map(r => r[0]);
  assert.ok(stripes.includes(ink('#ffd43b')) && stripes.includes(ink('#2a1d14')), 'bypass: yellow and black stripes on its body');
  assert.ok(!body(base).some(r => r[0] === ink('#ffd43b')), 'none without');
  const beside = rects => rects.filter(r => r[2] >= OY && r[2] < OY + 16 && (r[1] + r[3] <= OX || r[1] >= OX + 14));
  assert.equal(beside(base).length, 0, 'nothing beside a plain robot');
  assert.ok(beside(drawn({ fast: true })).length >= 2, 'fast mode: speed lines beside it');
  assert.ok(beside(drawn({ fast: true }, { walk: true, face: 'right' })).length >= 2, '… and behind it as it goes');
  const badge = cost => body(drawn({ cost })).map(r => r[0]);
  assert.deepEqual(badge(0.5), body(base).map(r => r[0]), 'under $1: no badge');
  const [copper, silver, gold] = [5, 20, 80].map(badge);
  assert.ok(copper.length > 0 && silver.length > 0 && gold.length > 0, 'a badge');
  assert.equal(new Set([copper, silver, gold].map(c => JSON.stringify(c))).size, 3, 'copper, silver and gold differ');
  assert.ok(silver.some(c => hue(c) === 'grey') && gold.some(c => hue(c) === 'amber'), 'silver is grey, gold is gold');
});

test('over and beside a robot: a spinning gear while it thinks, a checklist screen for its task list, smoke from a hot CPU, a charging bolt while idle', () => {
  const { drawn, ink } = robots();
  const above = rects => rects.filter(r => r[2] + r[4] <= OY - 1 && Math.abs(r[1] - 200) < 24);
  assert.equal(above(drawn()).length, 0, 'nothing over a plain robot');
  const gear = T => above(drawn({ thinking: true }, {}, T));
  assert.ok(gear(1).some(r => r[0] === ink('#e9a23b')), 'thinking: a brass gear over its head');
  assert.notDeepEqual(gear(1), gear(1.13), 'spinning');
  const left = rects => rects.filter(r => r[1] + r[3] <= OX && r[2] < OY + 16);
  assert.equal(left(drawn()).length, 0);
  const ticks = done => left(drawn({ tasks: { done, total: 3 } })).filter(r => r[0] === ink('#6cc04a')).length;
  assert.ok(left(drawn({ tasks: { done: 0, total: 3 } })).length > 0 && ticks(1) > ticks(0) && ticks(3) > ticks(1), `a checklist screen beside it, ticked as tasks are done (${ticks(0)}, ${ticks(1)}, ${ticks(3)})`);
  const smoke = T => above(drawn({ hot: true }, {}, T));
  assert.ok(smoke(1).some(r => hue(r[0]) === 'grey'), 'a hot CPU: grey smoke');
  assert.notDeepEqual(smoke(1), smoke(1.4), 'rising');
  const bolt = rects => rects.filter(r => r[0] === ink('#ffd43b') || r[0] === ink('#f0b429'));
  assert.ok(bolt(above(drawn({ state: 'idle' }))).length > 0, 'idle: a charging bolt');
  assert.equal(bolt(above(drawn({ state: 'idle' }, { walk: true, face: 'left' }))).length, 0, 'not while it walks');
});

test("waiting on you: a red ! bubble and a ring at its feet; a plan to approve: a blueprint on your desk; your turn: a crate of finished parts, with a ✓ (a ? for a question)", () => {
  const { drawn, ink } = robots();
  const desk = { x: 170, y: 80, zone: 'desk' }, colours = rects => new Set(rects.map(r => r[0]));
  const waiting = drawn({ state: 'waiting' }, desk);
  assert.ok(colours(waiting).has(ink('#d03b3b')), 'the ! bubble');
  assert.ok(waiting.some(r => r[0] === ink('#e04a3a') && r[2] >= 80 && r[2] <= 82 && r[3] >= 9), 'a red ring at its feet');
  const onDesk = rects => rects.filter(inRect(140, 50, 120, 12)).filter(r => hue(r[0]) === 'blue'); // the desk's top
  assert.equal(onDesk(waiting).length, 0, 'a permission: no blueprint');
  const plan = onDesk(drawn({ state: 'waiting', planAsk: true }, desk));
  assert.ok(plan.length >= 2, 'a plan to approve: a blueprint on the desk');
  assert.ok(plan.every(r => r[1] >= 205), "by its in-tray, clear of the waiting queue's name tags (150–190 ± a name)");
  assert.equal(onDesk(drawn({ state: 'waiting', planAsk: true }, { ...desk, walk: true, face: 'up' })).length, 0, 'not until it gets there');
  const turn = drawn({ state: 'turn' }, { x: 230, y: 80, zone: 'turn' });
  assert.ok(turn.filter(inRect(223, 70, 14, 10)).some(r => r[0] === ink('#c98d4f')), 'your turn: a crate held in front of it');
  assert.ok(colours(turn).has(ink('#0ca30c')), 'a ✓ bubble');
  assert.ok(colours(drawn({ state: 'turn', question: 'Ship it?' }, { x: 230, y: 80, zone: 'turn' })).has(ink('#c98500')), 'a ? for a question');
});

test('drones: each running subagent hovers by its robot (four at most), an Explore one circles it sweeping a beam; drawn where they hover', () => {
  const { h, drawn } = robots();
  const b = { x: 200, y: 144 };
  const at = (k, T, dog = false) => plain(h.follow(b, k, T, { id: `c${k}`, dog }));
  const spots = [0, 1, 2, 3].map(k => at(k, 1));
  for (const [x, y] of spots) assert.ok(Math.abs(x - 200) <= 20 && y < 144 - 8 && y > 144 - 40, `${x},${y}: hovering by its robot`);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]) >= 8, `drones ${i} and ${j} apart`);
  assert.notDeepEqual(at(0, 1), at(0, 1.4), 'they bob');
  const sweep = [0, 1, 2, 3, 4, 5, 6, 7].map(T => at(0, T, true)[0] - 200);
  assert.ok(Math.min(...sweep) < -8 && Math.max(...sweep) > 8, `an Explore drone circles its robot (${sweep.map(Math.round)})`);
  const kids = [{ x: 186, y: 132 }, { x: 214, y: 120 }];
  const two = drawn({ kids: [{ id: 'c1', dog: false }, { id: 'c2', dog: true }] }, { kids });
  for (const d of kids) assert.ok(two.some(r => Math.abs(r[1] - d.x) <= 6 && Math.abs(r[2] - d.y) <= 4), `a drone at ${d.x},${d.y}`);
  const below = rects => rects.filter(r => r[1] >= OX + 14 && r[1] < 232 && r[2] > 124 && r[2] < 145 && hue(r[0]) === 'blue');
  assert.ok(below(two).length >= 6, `the Explore drone's beam, down to the floor (${below(two).length} fills)`);
  assert.equal(below(drawn({ kids: [{ id: 'c1', dog: false }, { id: 'c2', dog: false }] }, { kids })).length, 0, 'a plain drone has no beam');
});

test('the drone dock: finished subagents docked in its six slots; more running than their robots lead circle over it, with +N', () => {
  const { h, sceneOf, fills, PXG } = robots();
  const kids = (done, running) => [...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, kind: 'subagent', state: 'done', startedAt: TOUR_NOW })), ...Array.from({ length: running }, (_, i) => ({ id: `r${i}`, kind: 'subagent', state: 'running', startedAt: TOUR_NOW }))];
  const scene = (done, running) => { const s = sceneOf(bay({}, [person('p', { children: kids(done, running) })])); h.relayout(h.grid.layoutFor(s.fields)); h.setScene(s); };
  const SLOTS = [100, 38, 21, 34]; // the dock's slots, two across, three down
  const docked = done => { scene(done, 0); PXG.T = 1; return fills(() => h.ground()).filter(inRect(...SLOTS)).length; };
  const [none, one, three, six] = [0, 1, 3, 6].map(docked);
  assert.ok(none < one && one < three && three < six, `a drone a slot (${none}, ${one}, ${three}, ${six})`);
  assert.equal(docked(9), six, 'six at most');
  const over = rects => rects.filter(inRect(92, 4, 40, 28));
  scene(0, 4);
  assert.equal(over(fills(() => h.top())).length, 0, 'four running: their robot leads them all');
  assert.equal(h.movers(() => null).filter(m => /\+\d/.test(m.html)).length, 0);
  scene(0, 6);
  assert.ok(over(fills(() => h.top())).length > 0, 'six running: two circle over the dock');
  const sign = h.movers(() => null).find(m => m.html.includes('+2'));
  assert.ok(sign && Math.abs(sign.x - 111) <= 16 && sign.y < 34, 'with +2 over it');
  assert.match(sign.title, /2 more subagents/);
  assert.doesNotMatch(sign.title, FARM_WORDS);
});

test("an AGV's way: along its row to the left side's path, up or down it, and along the robot's row; and back", () => {
  const { F } = load();
  assert.deepEqual(plain(F.agvRoute([14, 284], [187, 144])), [[116, 284], [116, 144], [187, 144]], 'from the rank to a bay in the first row');
  assert.deepEqual(plain(F.agvRoute([187, 144], [14, 284])), [[116, 144], [116, 284], [14, 284]], 'and home');
  assert.deepEqual(plain(F.agvRoute([14, 284], [163, 80])), [[116, 284], [116, 80], [163, 80]], 'to your desk');
  assert.deepEqual(plain(F.agvRoute([150, 144], [300, 144])), [[300, 144]], 'along a row');
  assert.deepEqual(plain(F.agvRoute([116, 200], [53, 204])), [[116, 204], [53, 204]], 'from the path');
});

test('an AGV stays with its robot while the call goes on, and a few seconds after it has got there, then heads home', () => {
  const { F } = load();
  const home = [14, 284], robot = [213, 144], c = {};
  assert.deepEqual(plain(F.agvGoal(c, robot, home, 0)), robot, 'called: it goes');
  assert.deepEqual(plain(F.agvGoal(c, null, home, 1000)), robot, 'a short call ended on the way: it still gets there');
  c.arrivedAt = 3000;
  assert.deepEqual(plain(F.agvGoal(c, null, home, 5000)), robot, 'there: it waits a moment');
  assert.deepEqual(plain(F.agvGoal(c, null, home, 7000)), home, 'then home');
  const busy = {};
  F.agvGoal(busy, robot, home, 0);
  assert.deepEqual(plain(F.agvGoal(busy, robot, home, 60_000)), robot, 'a long call: it stays');
});

test('AGVs: one in the rank for each MCP server called lately; the one a robot calls drives over and waits beside it, with its name; drawn still, it is already there', () => {
  const { h, sceneOf, F } = robots();
  const caller = person('m', { now: { tool: 'mcp__tickets__search', summary: 'open tickets', step: 'mcp', service: 'tickets', startedAt: Date.now() - 2000 }, mcp: [{ server: 'tickets', at: Date.now() - 2000 }, { server: 'gmail', at: Date.now() - 60_000 }] });
  const scene = sceneOf(bay({}, [caller]));
  h.relayout(h.grid.layoutFor(scene.fields));
  h.setScene(scene);
  const [x, y] = h.slots(scene.farmers[0]).at([]), posOf = id => (id === 'm' ? { x, y, tx: x, ty: y, walk: false } : null);
  const ys = () => h.items().slice(3).map(it => it[0]), home = new Set(F.RANK.map(p => p[1])); // after the open table and the two pods' glass
  h.tick(0.03, posOf);
  assert.equal(ys().length, 2, 'two AGVs, one for each server');
  assert.ok(ys().every(v => home.has(v)), 'in the rank');
  assert.deepEqual(plain(h.movers(posOf).filter(m => m.key.startsWith('mcp:')).map(m => m.key)), ['mcp:tickets'], 'the one called sets off, with its name');
  for (let i = 0; i < 400; i++) h.tick(0.05, posOf);
  const label = h.movers(posOf).find(m => m.key === 'mcp:tickets');
  assert.ok(label?.html.includes('tickets'), 'its name on it');
  assert.ok(Math.abs(label.x - x) >= 8 && Math.abs(label.x - x) <= 14 && Math.abs(label.y - (y - 11)) <= 2, `it waits beside the robot (${label.x},${label.y} by ${x},${y})`);
  assert.ok(ys().includes(y) && ys().some(v => home.has(v)), 'one beside the robot, drawn among the robots by where it stands; the other still in the rank');
  assert.match(label.title, /tickets/);
  assert.doesNotMatch(label.title, FARM_WORDS);
  const still = robots();
  still.h.relayout(still.h.grid.layoutFor(scene.fields));
  still.h.setScene(scene);
  still.h.tick(0, posOf, true);
  const snapped = still.h.movers(posOf).find(m => m.key === 'mcp:tickets');
  assert.ok(snapped && Math.abs(snapped.x - x) <= 14 && Math.abs(snapped.y - (y - 11)) <= 2, 'motion off: it stands beside the robot at once');
});

test('a web call: a delivery drone flies from its robot out of a window and back, its errand on it; none for a browser (its AGV goes)', () => {
  const { h, sceneOf, fills, PXG, F } = robots();
  const caller = tool => person('w', { now: { tool, summary: 'the docs', step: 'web', service: tool === 'WebFetch' ? 'docs.example.com' : 'playwright', startedAt: Date.now() - 2000 } });
  const withCall = sceneOf(bay({}, [caller('WebFetch')])), without = sceneOf(bay({}, [person('w')]));
  h.relayout(h.grid.layoutFor(withCall.fields));
  const [x, y] = h.slots(withCall.farmers[0]).at([]), posOf = () => ({ x, y, tx: x, ty: y, walk: false });
  h.setScene(without);
  h.tick(0, posOf, true);
  const base = new Set(fills(() => h.top()).map(r => JSON.stringify(r))); // the tubes overhead
  const drone = (scene, T) => { h.setScene(scene); h.tick(0, posOf, true); PXG.T = T; return fills(() => h.top()).filter(r => !base.has(JSON.stringify(r))); };
  const inWindow = r => F.WINDOWS.some(([wx, wy, ww, wh]) => r[1] >= wx - 2 && r[1] < wx + ww + 2 && r[2] >= wy - 2 && r[2] < wy + wh + 2);
  const seen = Array.from({ length: 80 }, (_, i) => drone(withCall, i / 10));
  assert.ok(seen.some(d => d.length && d.every(r => Math.abs(r[1] - x) < 20 && r[2] > y - 44 && r[2] < y)), 'by its robot, setting off or back');
  assert.ok(seen.some(d => d.some(inWindow)), 'at a window: going out of it, over the sky (top() is drawn after the windows)');
  assert.ok(seen.some(d => d.length === 0 || d.every(inWindow)), 'and away out there a while');
  assert.ok(seen.filter(d => d.length).length > 40, 'drawn most of its round');
  h.setScene(withCall);
  const label = h.movers(posOf).find(m => m.key.startsWith('drone:'));
  assert.ok(label?.html.includes('docs.example.com'), 'its errand on it');
  assert.doesNotMatch(label.title, FARM_WORDS);
  const browser = sceneOf(bay({}, [caller('mcp__playwright__browser_click')]));
  assert.equal(Array.from({ length: 80 }, (_, i) => drone(browser, i / 10).length).reduce((a, n) => a + n, 0), 0, "a browser's web step: no delivery drone");
});

test("messages: a capsule goes from one robot into its bay's tube outlet, through the overhead tubes, and out of the other's to it; the tubes come down to every bay's outlet", () => {
  const { h, fills, PXG, F, window } = robots();
  const fields = Array.from({ length: 5 }, (_, i) => ({ key: `/r/${i}`, name: `r${i}` }));
  const L = h.relayout(h.grid.layoutFor(fields));
  h.setScene(F.factoryScene(window.AgentvilleScene.toScene({ generatedAt: TOUR_NOW, agents: [], collisions: [], repos: fields.map(f => ({ path: f.key, name: f.name, agentIds: [] })) })));
  PXG.T = 1;
  const tubes = fills(() => h.top());
  const covered = (x, y) => tubes.some(r => x >= r[1] && x < r[1] + r[3] && y >= r[2] && y < r[2] + r[4]);
  for (const s of L.ST) { const [ox, oy] = F.outletAt(s); assert.ok(covered(ox, oy - 1), `${s.key}: a tube comes down to its outlet (${ox},${oy})`); }
  /** Where the capsule is (the middle of what flight draws) on its way from a to z, t along. */
  const capsule = (a, z, t) => {
    const d = fills(() => h.flight(a, z, t, 1 + t * 2.4));
    assert.ok(d.length > 0, `t ${t}: drawn`);
    const xs = d.flatMap(r => [r[1], r[1] + r[3]]), ys = d.flatMap(r => [r[2], r[2] + r[4]]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  };
  const [s0, s4] = [L.ST[0], L.ST[4]], a = { x: s0.cx + 26, y: s0.lane }, z = { x: s4.cx - 26, y: s4.lane };
  assert.ok(s4.rowTop > s0.rowTop, 'the receiver is a row further down');
  const path = Array.from({ length: 400 }, (_, i) => capsule(a, z, i / 400));
  const near = ([x, y], [px, py], d) => Math.hypot(x - px, y - py) <= d;
  assert.ok(near(path[0], [a.x, a.y - 8], 3), `it sets off from the sender (${path[0]})`);
  assert.ok(near(capsule(a, z, 0.9999), [z.x, z.y - 8], 3), 'and comes to the receiver');
  for (let i = 1; i < path.length; i++) assert.ok(near(path[i], path[i - 1], 4), `no jump at t ${i / 400}`);
  const into = path.findLastIndex(p => near(p, F.outletAt(s0), 2)), out = path.findIndex((p, i) => i > into && near(p, F.outletAt(s4), 2));
  assert.ok(into > 0 && out > into, `through the sender's bay outlet (${into}), then the receiver's (${out})`);
  for (let i = into + 1; i < out; i++) assert.ok(covered(Math.round(path[i][0]), Math.round(path[i][1])), `in between, inside the tubes (t ${i / 400}: ${path[i]})`);
  const desk = { x: 170, y: 80 };
  assert.ok(near(capsule(a, desk, 0.9999), [desk.x, desk.y - 8], 3), 'a robot away from the bays gets one too (at your desk)');
});

/* ---------- the creatures: a robot dog, a robot vacuum and a cat on the conveyor (sdk/animals.js) ---------- */

/** The factory with n repos' bays, and the animals kit from its frame; `animals(seed)` is a fresh kit placed on its floor, as the engine places it. */
function creatureFloor(n = 3) {
  const { window, ctx, F } = load();
  const h = window.hooks, L = h.relayout(h.grid.layoutFor(Array.from({ length: n }, (_, i) => ({ key: `/r/${i}`, name: `r${i}` }))));
  const kit = vm.runInContext('({ makeAnimals, seededRandom, CREATURES, gagProblem })', ctx);
  const place = a => a.place({ roam: h.roam(), avoid: h.avoid(), perches: h.perches?.() ?? [], spots: h.spots(), blocked: (x, y) => Boolean(h.fieldAt(x, y) || h.buildingAt(x, y)) });
  const animals = seed => { const a = kit.makeAnimals(h.animals(), { random: kit.seededRandom(seed) }); place(a); return a; };
  return { h, L, F, kit, place, animals };
}
const inArea = (r, x, y, slack = 0) => x >= r.x - slack && x <= r.x + r.w + slack && y >= r.y - slack && y <= r.y + r.h + slack;
/** A creature's whole body (w × h above its feet, a pixel in from each side: list() rounds) inside a rectangle. */
const bodyIn = (c, o, r) => o.x + c.w / 2 - 1 > r.x && o.x - c.w / 2 + 1 < r.x + r.w && o.y - 1 > r.y && o.y - c.h + 1 < r.y + r.h;
/** The engine's crew, stood in for: robots that are where they're sent at once (animals.test.mjs's). */
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

test("the factory's animals: a robot dog, a robot vacuum and a cat, held to the kit's own rules (check-world's), with a gag and play", () => {
  const { h, kit } = creatureFloor();
  const world = plain(h.animals());
  assert.deepEqual(Object.keys(world).sort(), ['cast', 'gags', 'play']);
  assert.deepEqual(world.cast.map(c => [c.kind, c.name, c.count ?? 1]), [['robodog', 'Robot dog', 1], ['vacuum', 'Robot vacuum', 1], ['cat', 'Cat', 1]]);
  const [dog, vacuum, cat] = world.cast;
  assert.deepEqual(dog.actions.map(a => a.label), ['Pet', 'Oil', 'Fetch']);
  assert.deepEqual(dog.habits, ['roll']);
  assert.deepEqual(dog.reacts, { merged: 'run', arrive: 'run' }, 'it runs to a merged pull request, and to meet a new robot');
  assert.deepEqual(vacuum.actions.map(a => a.label), ['Pet', 'Empty it']);
  assert.deepEqual(cat.actions.map(a => a.label), ['Pet', 'Feed']);
  assert.deepEqual(cat.habits, ['yawn', 'stretch']);
  assert.deepEqual(world.gags.map(g => g.id), ['chase']);
  assert.deepEqual(world.play.map(g => g.id), ['fetch', 'pet']);
  const taken = JSON.parse(web('worlds/factory/world.json')).taken;
  assert.deepEqual(creatureProblems(world, { kinds: Object.keys(kit.CREATURES), taken, gagProblem: kit.gagProblem, spots: plain(h.spots()) }), { problems: [], pointers: [] }, 'nothing the kit would drop or do its own way');
});

test("where they may go: the walkway, the left side and the conveyor; never the bays, the queue at your desk, the AGV rank, or into the left side's shelf, table and pods", () => {
  for (const n of [3, 18]) {
    const { h, L, F } = creatureFloor(n), cy = L.GRID.y1 + 12;
    const roam = plain(h.roam()), avoid = plain(h.avoid());
    const roams = (x, y) => roam.some(r => inArea(r, x, y)), avoids = (x, y) => avoid.some(r => inArea(r, x, y));
    for (const [x, y, where] of [[20, 88, 'the walkway by the fabricator'], [300, 90, 'the walkway by the bank'], [60, 140, 'under the storage shelf'], [104, 168, 'beside the charging pads'], [116, 200, "the left side's path"], [90, 240, 'beside the pods'], [20, cy + 2, 'the belt, at the left'], [380, cy + 2, 'the belt, at the right']]) {
      assert.ok(roams(x, y), `${n} bays: ${where} (${x},${y}) is theirs`);
      assert.ok(!avoids(x, y), `${n} bays: ${where} (${x},${y}) isn't kept off`);
    }
    assert.ok(!roams(200, 40) && !roams(200, 200) && !roams(200, cy + 14), `${n} bays: not the buildings, the bays' floor or under the belt`);
    const queue = [0, 1, 2].flatMap(i => [[150 + 20 * i, 78], [250 - 20 * i, 78]]);
    for (const [x, y, what] of [[L.GRID.x0 + 4, L.GRID.y0 + 4, 'the bays'], [L.GRID.x1 - 4, L.GRID.y1 - 4, 'the bays'], ...queue.map(([x, y]) => [x, y, 'the queue at your desk']), ...F.RANK.map(([x, y]) => [x, y - 4, 'the AGV rank']), [56, 115, 'the storage shelf'], [56, 176, 'the open table'], [24, 240, 'a sleep pod'], [54, 240, 'a sleep pod']]) assert.ok(avoids(x, y), `${n} bays: ${what} (${x},${y}) is kept off`);
    const { corner } = plain(h.spots());
    assert.ok(roams(...corner) && !avoids(...corner), `${n} bays: the gag's corner (${corner}) is floor they may stand on`);
    assert.ok(Math.abs(corner[0] - 108) <= 6 && Math.abs(corner[1] - 131) <= 6, `the storage shelf's corner, at its foot (${corner})`);
  }
});

test('placement: whatever they do, no creature stands in what avoid() keeps off, or on a bay or a building; the dog and the vacuum stay where they may roam, the cat on the belt', () => {
  const regions = new Set();
  for (const n of [3, 18]) for (const seed of [1, 2, 3]) {
    const { h, L, kit, animals } = creatureFloor(n), a = animals(seed), crew = fakeCrew([{ id: 'r1', state: 'idle', x: 18, y: 158 }]);
    const avoid = plain(h.avoid()), roam = plain(h.roam()), home = plain(h.animals()).cast.find(c => c.kind === 'cat').home, cy = L.GRID.y1 + 12;
    const events = [['merged', [357, 44]], ['arrive', [62, 80]], ['deployFailed', [174, 130]], ['harvest', [262, 160]], ['deployOk', [350, 160]]];
    for (let i = 0; i < 6000; i++) {
      if (i % 400 === 0) { a.perform('robodog-0', 2, null); a.perform('vacuum-0', 1, null); a.perform('cat-0', 1, null); } // Fetch (a run), Empty it, Feed
      if (i % 900 === 300) a.react(...events[Math.floor(i / 900) % events.length]);
      a.tick(0.1, { crew });
      for (const o of plain(a.list())) {
        const c = kit.CREATURES[o.kind], at = `${n} bays, seed ${seed}, t ${i / 10}: ${o.id} at ${o.x},${o.y}`;
        if (o.kind === 'cat') { assert.ok(inArea(home, o.x, o.y, 1), `${at}: on the belt`); continue; }
        assert.ok(roam.some(r => inArea(r, o.x, o.y, 1)), `${at}: where it may roam`);
        for (const r of avoid) assert.ok(!bodyIn(c, o, r), `${at}: in ${JSON.stringify(r)}`);
        for (const [px, py] of [[o.x - c.w / 2 + 1, o.y - c.h + 1], [o.x + c.w / 2 - 1, o.y - c.h + 1], [o.x - c.w / 2 + 1, o.y - 1], [o.x + c.w / 2 - 1, o.y - 1]]) assert.ok(!h.fieldAt(px, py) && !h.buildingAt(px, py), `${at}: on a bay or a building`);
        regions.add(o.y <= 92 ? 'the walkway' : o.y >= cy ? 'the belt' : 'the left side');
      }
    }
  }
  assert.deepEqual([...regions].sort(), ['the belt', 'the left side', 'the walkway']);
});

test("the cat naps on the conveyor and rides along it: its home is the belt's strip, which moves down with the bays' rows; a robot pets it from behind the belt", () => {
  const { h, L, place, animals } = creatureFloor(3);
  const a = animals(5), cat = () => plain(a.list()).find(o => o.kind === 'cat'), beltOf = G => [G.y1 + 12 - 3, G.y1 + 12 + 5];
  const xs = new Set(), poses = new Set();
  for (let i = 0; i < 4000; i++) {
    a.tick(0.1);
    const c = cat(), [top, bottom] = beltOf(L.GRID);
    assert.ok(c.y >= top && c.y <= bottom, `t ${i / 10}: the cat at ${c.x},${c.y}, on the belt (${top}–${bottom})`);
    xs.add(Math.floor(c.x / 40));
    poses.add(c.pose);
  }
  assert.ok(xs.size >= 4, `it gets about along the belt (${[...xs]})`);
  assert.ok(poses.has('sleep'), 'it naps there');
  const L6 = h.relayout(h.grid.layoutFor(Array.from({ length: 18 }, (_, i) => ({ key: `/r/${i}`, name: `r${i}` }))));
  assert.ok(L6.GRID.y1 > L.GRID.y1, 'six rows of bays: the conveyor is further down');
  place(a); // the engine places them again after a new layout
  for (let i = 0; i < 20; i++) a.tick(0.1);
  const [top, bottom] = beltOf(L6.GRID), c = cat();
  assert.ok(c.y >= top && c.y <= bottom, `the cat is on the moved belt (${c.y})`);
  const stand = plain(a.where('cat-0').stand);
  assert.equal(stand[1], L6.GRID.y1 + 4, 'a robot stands behind the belt to pet it');
  assert.ok(Math.abs(stand[0] - c.x) <= 20, `beside it (${stand})`);
});

test('the gag: the vacuum chases the cat, which hisses and runs; it wedges itself in the shelf corner and beeps until a robot comes to free it', () => {
  const STUCK = ['help. stuck. beep.', 'corner: 1, me: 0'];
  let done = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { h, animals } = creatureFloor(3), a = animals(seed), corner = plain(h.spots()).corner;
    const crew = fakeCrew([{ id: 'r1', state: 'idle', x: 18, y: 158 }]);
    let said = null; // during a chase: each line first said → where the vacuum and the cat were, and how many robots had been sent
    for (let i = 0; i < 40000 && !done; i++) {
      a.tick(0.1, { crew });
      const on = a.gagNow()?.id === 'chase';
      if (on && !said) said = new Map();
      if (said) {
        const at = Object.fromEntries(plain(a.list()).map(o => [o.kind, o]));
        for (const b of plain(a.bubbles())) if (!said.has(b.text)) said.set(b.text, { vacuum: at.vacuum, cat: at.cat, sent: crew.log.filter(l => l[0] === 'send').length });
      }
      if (on || !said) continue;
      const stuck = STUCK.find(t => said.has(t));
      if (said.has('HISS') && stuck && said.has('freedom! vrrr')) { // a chase played out, every line said: check where everyone was
        const hiss = said.get('HISS'), beep = said.get(stuck), free = said.get('freedom! vrrr');
        assert.ok(Math.hypot(hiss.vacuum.x - hiss.cat.x, hiss.vacuum.y - hiss.cat.y) <= 30, `seed ${seed}: the vacuum is at the cat when it hisses (${JSON.stringify(hiss)})`);
        assert.deepEqual([beep.vacuum.x, beep.vacuum.y], corner, `seed ${seed}: it beeps from the corner`);
        assert.equal(beep.sent, 0, 'before any robot comes');
        assert.deepEqual([free.vacuum.x, free.vacuum.y], corner, 'freed where it was stuck');
        assert.ok(free.sent >= 1, 'a robot came');
        const sent = crew.log.find(l => l[0] === 'send');
        assert.ok(Math.hypot(sent[2] - corner[0], sent[3] - corner[1]) <= 12, `beside the vacuum (${sent})`);
        assert.ok(crew.log.some(l => l[0] === 'release' && l[1] === 'r1'), 'and is let go after');
        done = true;
      }
      said = null;
    }
    if (done) break;
  }
  assert.ok(done, 'a chase played out with every line');
});

test("a steaming floor (the kit hears winter) doesn't make them act cold: nothing they wear changes, and there is no huddle spot", () => {
  const { h, animals } = creatureFloor(3), a = animals(4);
  for (let i = 0; i < 600; i++) a.tick(0.1, { winter: true });
  for (const o of plain(a.list())) assert.deepEqual(o.wear, {}, `${o.id} wears nothing for the cold`);
  assert.ok(!('huddle' in plain(h.spots())), 'no huddle on a hot floor');
});
