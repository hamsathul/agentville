// The field exercise (web/worlds/military/): its soldiers (people-kit soldiers in a field jacket of the
// agent's colour, khaki trousers and headgear picked by the agent's id; codex agents with a slate stripe
// down the jacket), and the world's registration on the engine.
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
/** The SDK and the field exercise in a vm; the hooks it gives the engine are kept as window.hooks. */
function load() {
  const dom = stubDom();
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} });
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js']) vm.runInContext(web(f), ctx, { filename: f });
  const engineWorld = window.Agentville.world;
  window.Agentville.world = hooks => { window.hooks = hooks; return engineWorld(hooks); };
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
    else assert.ok(at[1] >= 74 && at[1] <= 92, `${f.name}: on the track (y ${at[1]})`);
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
