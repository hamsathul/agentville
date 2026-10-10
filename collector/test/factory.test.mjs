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

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function stubDom() { // as in starter.test.mjs, and each fillRect is kept with its colour: a sprite's pixels
  const numbers = new Set(['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight', 'width', 'height', 'length', 'size']);
  const calls = { fillRect: 0, drawImage: 0, rects: [] };
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
      if (k === 'drawImage') return () => { calls.drawImage++; };
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
/**
 * Two robots (14 × 16, standing on their feet) whose boxes overlap. At your desk the two queues meet in the
 * middle, the brief's numbers 12 apart (194 and 206): there their arms may touch, by 2 pixels.
 */
const overlap = ([ax, ay], [bx, by]) => Math.abs(ax - bx) < (ay === 80 && by === 80 ? 12 : 14) && Math.abs(ay - by) < 16;

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
  assert.deepEqual(at.desk, [[150, 80], [172, 80], [194, 80]], 'the queue at your desk, on the walkway');
  assert.deepEqual(at.turn, [[250, 80], [228, 80], [206, 80]], 'your turn: at the desk, from its right');
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
});

test('no farm words: the help, every building tip, dialog, log line, pop-up and tip is in factory words', () => {
  const { window, F } = load();
  const h = window.hooks, FARM = /\b(farm|field|crop|harvest|porch|barn|silo|henhouse|stall|scarecrow|meadow|hammock|pigeon)/i;
  const texts = [['help', h.help()], ['startText', h.startText(1)], ['startText', h.startText(7)], ['arriveText', h.arriveText]];
  for (const k of ['barn', 'drones', 'desk', 'board', 'bank', 'dock']) { assert.ok(h.buildingTip(k), `${k} has a tip`); texts.push([`buildingTip ${k}`, h.buildingTip(k)]); }
  const busy = crowd({ prs: { open: [{ number: 12, title: 'New cart', url: 'https://github.com/you/shop/pull/12', checks: 'ok', draft: false }], merged: [{ number: 9, title: 'Old cart', url: 'https://github.com/you/shop/pull/9', at: TOUR_NOW }] },
    plan: { windows: [{ kind: 'five_hour', percentUsed: 40, resetsAt: TOUR_NOW + 3_600_000 }, { kind: 'seven_day', percentUsed: 75, resetsAt: TOUR_NOW + 86_400_000 }] },
    children: [{ id: 'c1', kind: 'subagent', state: 'running', label: 'Look around', agentType: 'Explore', startedAt: TOUR_NOW }] });
  for (const snap of [{ generatedAt: TOUR_NOW, agents: [], repos: [], collisions: [] }, busy]) {
    const scene = F.factoryScene(window.AgentvilleScene.toScene(snap));
    h.relayout(h.grid.layoutFor(scene.fields));
    h.setScene(scene);
    for (const k of ['desk', 'bank', 'drones', 'dock']) { const d = h.dialog(k); assert.ok(d?.title && d.html, `${k} opens a dialog`); texts.push([`dialog ${k}`, `${d.title}\n${d.html}`]); }
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
