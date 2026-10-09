// A world of four hooks, mounted and drawn on a stand-in DOM; the defaults the engine fills in
// (docs/worlds.md, "Hooks"): the fields kept for the labels, overflow of any group, a grid centred on W.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const code = ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js'].map(web).join('\n;\n');
const plain = v => JSON.parse(JSON.stringify(v));
const NOW = Date.now();
const tiny = { W: 200, slots: () => ({ group: 'all', cap: 9, at: i => [20 + i * 10, 40], zone: 'all' }), drawChar() {}, bg() {} };

// Every element and canvas context is a proxy that takes any call and answers with another.
function stubDom() {
  const rects = { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 };
  const numbers = new Set(['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight', 'width', 'height', 'length', 'size']);
  const calls = { fillRect: 0 };
  const make = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (numbers.has(k)) return t[k] ?? (k === 'offsetWidth' || k === 'width' ? 400 : k === 'offsetHeight' || k === 'height' ? 300 : 0);
      if (k === 'getBoundingClientRect') return () => rects;
      if (k === 'style' || k === 'dataset') return (t[k] ??= {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'isConnected') return true;
      if (k === 'hidden' || k === 'open') return t[k] ?? false;
      if (k === 'fillRect') return () => { calls.fillRect++; };
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getContext') return () => ctx;
      if (k === 'measureText') return () => ({ width: 0 });
      return (t[k] ??= make());
    },
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => make(),
  });
  const ctx = make();
  return { make, calls, document: Object.assign(make(), { hidden: false }), globals: { ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} } };
}
function load() {
  const dom = stubDom();
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ...dom.globals });
  vm.runInContext(`${code}\n;window.sdk = { makeGrid, withDefaults, engineScene, makePixelView, ACTIVE, defaultHud };`, ctx);
  return { window, dom, sdk: window.sdk };
}
const twoAgents = window => window.AgentvilleScene.toScene({ generatedAt: NOW, collisions: [], agents: [
  { id: 'a', name: 'a', kind: 'interactive', cwd: '/c/x', state: 'working', feed: [], children: [], touching: [] },
  { id: 'b', name: 'b', kind: 'interactive', cwd: '/c/y', state: 'waiting', ask: 'ok?', feed: [], children: [], touching: [] }],
repos: [{ path: '/c/x', name: 'x' }, { path: '/c/y', name: 'y' }] });
// working agents stand in their field, the rest on a porch with room for one
const fourHooks = (extra = {}) => ({ W: 200, slots: f => (f.state === 'working' ? { group: 'st:/c/x', at: used => { used.push(0); return [60, 90]; }, zone: 'field' } : { group: 'porch', cap: 1, at: () => [100, 40], zone: 'porch' }), drawChar() {}, bg() {}, ...extra });
const prefs = { get: () => null, set() {} };

test('a world of four hooks mounts and draws agents in a field and on the porch', () => {
  const { window, dom, sdk } = load();
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks()), prefs);
  view.update(sdk.engineScene(twoAgents(window)));
  assert.doesNotThrow(() => view.mount(dom.make(), { still: true }));
  assert.ok(dom.calls.fillRect > 0, 'it drew');
});

test("a world's own setScene still leaves the default labels the field names", () => {
  const { window, sdk } = load();
  const seen = [];
  const th = sdk.withDefaults(fourHooks({ setScene(next) { seen.push(next.fields.length); return []; } }));
  const view = sdk.makePixelView(th, prefs);
  view.update(sdk.engineScene(twoAgents(window)));
  assert.deepEqual(seen, [2], "the world's setScene ran");
  const labels = [];
  th.labels((x, y, html) => labels.push(html));
  assert.equal(labels.length, 2);
  assert.ok(labels.every(Boolean));
});

test('a group over its cap counts a number, whatever the world calls the group', () => {
  const { window, dom, sdk } = load();
  const got = [];
  const th = sdk.withDefaults(fourHooks({ labels(lab, overflow) { got.push(overflow.porch); } }));
  const view = sdk.makePixelView(th, prefs);
  const s = sdk.engineScene(twoAgents(window));
  s.farmers[0].state = 'waiting';
  view.mount(dom.make(), { still: true });
  view.update(s);
  assert.equal(got.at(-1), 1);
});

test('the default grid is centred on W, from the config given over 3 × 88 × 62', () => {
  const { sdk } = load();
  const fields = [{ key: '/a/b/one', name: 'one' }];
  const narrow = plain(sdk.withDefaults({ ...tiny }).grid.layoutFor(fields, {}, NOW));
  assert.ok(narrow.slots.every(s => s.cx >= 0 && s.cx <= 200), 'every bed inside the world');
  assert.ok(narrow.GRID.x0 >= 0 && narrow.GRID.x1 <= 200);
  const two = plain(sdk.withDefaults({ ...tiny, grid: { cols: 2, colW: 50 } }).grid.layoutFor(fields, {}, NOW));
  assert.deepEqual([two.slots[0].cx, two.slots[1].cx], [75, 125], 'beds centred on W / 2');
});

test("a world's corridors are checked: at least one x position", () => {
  const { sdk } = load();
  for (const bad of [[], 'x', [NaN], [1, 'a']]) assert.throws(() => sdk.withDefaults({ ...tiny, corridors: bad }), /corridors/);
  assert.deepEqual(plain(sdk.withDefaults({ ...tiny, corridors: [50, 150] }).corridors), [50, 150]);
});

test('a saved view is restored once the first scene is in, not at mount (the canvas is empty-sized until then)', () => {
  const { window, dom, sdk } = load();
  const els = {}, host = dom.make();
  host.querySelector = sel => (els[sel] ??= dom.make());
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks()), { get: k => (k === 'view' ? '120,80' : null), set() {} });
  view.mount(host, { still: true });
  const v = els['.px-view'];
  assert.equal(v.scrollTop, 0, 'not at mount');
  view.update(sdk.engineScene(twoAgents(window)));
  assert.deepEqual([v.scrollLeft, v.scrollTop], [120, 80], 'after the first scene');
  v.scrollTop = 5;
  view.update(sdk.engineScene(twoAgents(window)));
  assert.equal(v.scrollTop, 5, 'only once');
});

test("the engine's own words come from the world's nouns; place defaults to world", () => {
  const { sdk } = load();
  assert.equal(sdk.withDefaults(fourHooks()).nouns.place, 'world');
  const th = sdk.withDefaults(fourHooks({ nouns: { agents: 'bakers', place: 'bakery' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(th.nouns)), { agent: 'agent', agents: 'bakers', repo: 'repo', repos: 'repos', place: 'bakery' });
});

test('a world with animals gets the Animals switch in its HUD; one without gets none', () => {
  const { sdk } = load();
  assert.match(sdk.defaultHud({ animals: true }), /data-farm-animals[^>]*>[\s\S]*Animals: on/);
  assert.match(sdk.defaultHud({ animals: false }), /Animals: off/);
  assert.doesNotMatch(sdk.defaultHud({}), /data-farm-animals/);
  assert.doesNotMatch(sdk.defaultHud({ animals: null }), /data-farm-animals/);
});

test('a world with animals draws them, and draws nothing more with them switched off', () => {
  const cast = [{ kind: 'cow', count: 3 }];
  const roam = () => [{ x: 10, y: 50, w: 150, h: 40 }];
  const run = animalsPref => {
    const { window, dom, sdk } = load();
    const view = sdk.makePixelView(sdk.withDefaults(fourHooks({ animals: () => cast, roam, avoid: () => [] })), { get: k => (k === 'animals' ? animalsPref : null), set() {} });
    view.mount(dom.make(), { still: true });
    dom.calls.fillRect = 0;
    view.update(sdk.engineScene(twoAgents(window)));
    return dom.calls.fillRect;
  };
  assert.ok(run(null) > run('off'), 'on by default: more drawn');
});

test('a world event with a kind reaches the animals; one without text pops nothing', () => {
  const { window, dom, sdk } = load();
  const reacted = [];
  const world = fourHooks({ animals: () => [{ kind: 'cow' }], roam: () => [{ x: 10, y: 50, w: 150, h: 40 }], setScene: () => [{ kind: 'deployFailed', at: [60, 60], text: '' }] });
  const view = sdk.makePixelView(sdk.withDefaults(world), prefs);
  view.mount(dom.make(), { still: true });
  view.animalsKit().react = (kind, at) => { reacted.push([kind, at]); return true; };
  view.update(sdk.engineScene(twoAgents(window)));
  assert.deepEqual(plain(reacted), [['deployFailed', [60, 60]]]);
});

test('a world event with no text pops nothing; one with text still pops', () => {
  const { window, dom, sdk } = load();
  const made = [];
  dom.document.createElement = () => { const el = dom.make(); made.push(el); return el; };
  const world = fourHooks({ setScene: () => [{ kind: 'deployFailed', at: [60, 60], text: '' }, { at: [70, 70], text: 'sold!' }] });
  const view = sdk.makePixelView(sdk.withDefaults(world), prefs);
  view.mount(dom.make(), { still: false });
  view.update(sdk.engineScene(twoAgents(window)));
  assert.equal(made.filter(el => String(el.className).startsWith('px-pop')).length, 1);
});

test('a world whose animals() gives { cast, gags, play } gets its creatures and its gags', () => {
  const { dom, sdk } = load();
  const gag = { id: 'baa', needs: { cow: 1 }, steps: [{ wait: 100 }] };
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks({ animals: () => ({ cast: [{ kind: 'cow', count: 2 }], gags: [gag], play: [] }), roam: () => [{ x: 10, y: 50, w: 150, h: 40 }] })), prefs);
  view.mount(dom.make(), { still: true });
  assert.equal(view.animalsKit().list().length, 2);
});

// The engine running frame by frame, with its real crew lending farmers to the animals.
function live(world, agents, { warn = () => {} } = {}) {
  const dom = stubDom();
  let pending = null;
  dom.globals.requestAnimationFrame = cb => { pending = cb; return 1; };
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console: { ...console, warn }, Math, Date, JSON, Map, Set, Intl, ...dom.globals });
  vm.runInContext(`${code}\n;window.sdk = { withDefaults, engineScene, makePixelView };`, ctx);
  const sdk = window.sdk, view = sdk.makePixelView(sdk.withDefaults(world), { get: k => (k === 'sky' ? 'day' : null), set() {} }); // day: the animals awake whatever the clock says
  view.mount(dom.make(), { still: false });
  const sceneOf = list => sdk.engineScene(window.AgentvilleScene.toScene({ generatedAt: Date.now(), collisions: [], agents: list, repos: [{ path: '/c/x', name: 'x' }] }));
  view.update(sceneOf(agents));
  let now = 1000, errors = 0;
  const run = n => { for (let i = 0; i < n && pending; i++) { const cb = pending; pending = null; try { cb(now += 100); } catch { errors++; } } };
  return { view, dom, run, errors: () => errors, update: list => view.update(sceneOf(list)) };
}
const someone = (id, over = {}) => ({ id, name: id, kind: 'interactive', cwd: '/c/x', state: 'idle', feed: [], children: [], touching: [], ...over });
const PEN = () => [{ x: 10, y: 20, w: 180, h: 80 }];

test('a world with a gag written wrong keeps running, frame after frame', () => {
  const warns = [];
  const w = live(fourHooks({ animals: () => ({ cast: [{ kind: 'goat' }], gags: [{ id: 'bad', steps: [{ wait: 1 }] }] }), roam: PEN, avoid: () => [] }), [someone('p')], { warn: m => warns.push(m) });
  w.run(1500);
  const drawn = w.dom.calls.fillRect;
  w.run(100);
  assert.equal(w.errors(), 0);
  assert.ok(w.dom.calls.fillRect > drawn, 'still drawing');
  assert.equal(warns.filter(m => /gag bad was dropped/.test(m)).length, 1);
});

test('the real crew: a goat takes an idle farmer’s hat; the farmer gets work and has it back at once', () => {
  const seen = [];
  const hat = { id: 'hat', needs: { goat: 1, farmer: 'idle' }, steps: [{ go: 'goat', to: 'farmer' }, { wear: 'goat', what: 'hat', on: true }, { go: 'goat', to: 'away', run: true, ms: 3000 }, { chase: 'farmer', after: 'goat', ms: 3000 }, { wear: 'goat', what: 'hat', on: false }] };
  const w = live(fourHooks({ animals: () => ({ cast: [{ kind: 'goat' }], gags: [hat] }), roam: PEN, avoid: () => [], drawChar: (f, b) => { if (f.id === 'p') seen.push(Boolean(b.hatless)); } }), [someone('p')]);
  for (let i = 0; i < 1500 && !seen.at(-1); i++) w.run(1);
  assert.equal(seen.at(-1), true, 'the goat has its hat');
  w.update([someone('p', { state: 'working' })]);
  w.run(2);
  assert.equal(seen.at(-1), false, 'work came: its hat back');
  assert.equal(w.view.animalsKit().gagNow(), null);
});

test('the real crew: play borrows a farmer idle three minutes, but never one napping in its hammock', () => {
  const run = nap => {
    const at = [];
    const pet = { id: 'pet', needs: { farmer: 'idle', goat: 1 }, steps: [{ go: 'farmer', to: 'goat' }, { wait: 5000 }] };
    const w = live(fourHooks({ animals: () => ({ cast: [{ kind: 'goat' }], play: [pet] }), roam: PEN, avoid: () => [], drawChar: (f, b) => { if (f.id === 'p') at.push(`${Math.round(b.x)},${Math.round(b.y)}`); } }),
      [someone('p', nap ? { wakeAt: Date.now() + 3600_000 } : {})]);
    w.run(3000);
    return new Set(at);
  };
  assert.ok(run(false).size > 1, 'an idle farmer goes to play');
  assert.deepEqual([...run(true)], ['100,40'], 'a napping one stays put');
});
