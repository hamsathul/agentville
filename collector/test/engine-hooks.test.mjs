// A world of four hooks, mounted and drawn on a stand-in DOM; the defaults the engine fills in
// (docs/worlds.md, "Hooks"): the fields kept for the labels, overflow of any group, a grid centred on W.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const code = ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/engine.js'].map(web).join('\n;\n');
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
  return { make, calls, document: Object.assign(make(), { hidden: false }), globals: { ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, Image: class {}, Path2D: class {} } };
}
function load() {
  const dom = stubDom();
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ...dom.globals });
  vm.runInContext(`${code}\n;window.sdk = { makeGrid, withDefaults, engineScene, makePixelView, ACTIVE };`, ctx);
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
