// The robot factory (web/worlds/factory/): its mix-and-match robots (a head, a body in the agent's colour,
// a drive, picked by the agent's id), and the world's registration on the engine.
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
function load() {
  const dom = stubDom();
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} });
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js']) vm.runInContext(web(f), ctx, { filename: f });
  const engineWorld = window.Agentville.world; // the hooks the factory gives, kept for the tests
  window.Agentville.world = hooks => { window.hooks = hooks; return engineWorld(hooks); };
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
