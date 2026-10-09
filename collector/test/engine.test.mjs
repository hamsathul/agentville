// Loads the SDK (web/worlds/sdk/pixel.js, engine.js) in a vm, with a stand-in bridge: the engine with
// a world of its own, the grid, the defaults, and the engine's scene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const code = ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/engine.js'].map(web).join('\n;\n');
function load() {
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  vm.runInNewContext(`${code}\n;window.sdk = { makeGrid, withDefaults, engineScene, makePixelView, ACTIVE };`, { window, console, Math, Date, JSON, Map, Set });
  return window;
}
const plain = v => JSON.parse(JSON.stringify(v));
const NOW = Date.now();
const tiny = { W: 200, slots: () => ({ group: 'all', cap: 9, at: i => [20 + i * 10, 40], zone: 'all' }), drawChar() {}, bg() {} };

test('a world needs only its width and three hooks; everything else has a default', () => {
  const { sdk } = load();
  const th = sdk.withDefaults({ ...tiny });
  for (const hook of ['layout', 'relayout', 'setScene', 'spawn', 'follow', 'startText', 'tag', 'tip', 'onMove', 'speed', 'zoneText', 'hud', 'ground', 'season', 'shadows', 'lights', 'items', 'top', 'movers', 'labels', 'fieldAt', 'buildingAt', 'buildingTip', 'dialog', 'boardSessions', 'help', 'fromScene']) assert.equal(typeof th[hook], 'function', hook);
  assert.equal(typeof th.arriveText, 'string', 'arriveText is the log line, not a function');
  assert.deepEqual(plain(th.corridors), [100]);
  assert.equal(th.SH, 16);
  assert.deepEqual(plain(th.items()), []);
  assert.equal(th.dialog('barn'), null);
  for (const missing of ['W', 'slots', 'drawChar', 'bg']) {
    const h = { ...tiny };
    delete h[missing];
    assert.throws(() => sdk.withDefaults(h), new RegExp(missing));
  }
  assert.equal(sdk.withDefaults({ ...tiny, SH: 20 }).SH, 20, "a world's own hook wins");
});

test("the engine's scene: the plain facts, under the names the engine draws from", () => {
  const { sdk, AgentvilleScene } = load();
  const s = AgentvilleScene.toScene({ generatedAt: NOW, collisions: [], plan: { windows: [{ kind: 'five_hour', percentUsed: 40, resetsAt: 1 }] },
    agents: [{ id: 'a', name: 'a', kind: 'interactive', cwd: '/c/x', state: 'working', feed: [], children: [], touching: [], contextTokens: 50_000 }],
    repos: [{ path: '/c/x', name: 'x', branch: 'dev', lastDeploy: { state: 'ok', label: '✓' } }] });
  const e = plain(sdk.engineScene(s));
  assert.deepEqual([e.farmers[0].field, e.farmers[0].pct, e.farmers[0].hearts, e.farmers[0].shirt], ['/c/x', 0.25, 3, s.agents[0].color]);
  assert.equal(e.fields[0].lastDeploy.label, '✓');
  assert.deepEqual(e.plan.windows, [{ kind: 'five_hour', percentUsed: 40, resetsAt: 1, reset: false }]);
  assert.deepEqual(e.henhouse, { eggs: 0, roosting: 0 });
  assert.ok(!('look' in e.farmers[0]) && !('crop' in e.fields[0]), 'no farm in it');
});

test('a world of its own takes scenes without a page: it places its fields, and draws nothing until mounted', () => {
  const window = load();
  const { sdk } = window;
  const th = sdk.withDefaults({ ...tiny });
  const view = sdk.makePixelView(th, { get: () => null, set() {} });
  const s = window.AgentvilleScene.toScene({ generatedAt: NOW, collisions: [], agents: [{ id: 'a', name: 'a', kind: 'interactive', cwd: '/c/x', state: 'idle', feed: [], children: [], touching: [] }], repos: [{ path: '/c/x', name: 'x' }] });
  assert.doesNotThrow(() => view.update(sdk.engineScene(s)));
  assert.deepEqual(plain(th.layout().ST.map(x => x.key)), ['/c/x']);
});

test("the engine's grid lays out like the farm's, from a config: beds kept, a project's repos together", () => {
  const { sdk } = load();
  const grid = sdk.makeGrid({ cols: 2, colW: 50, rowH: 40, cx0: 30, top0: 10, minRows: 1, maxRows: 2, max: 4, slot: (cx, rowTop) => ({ lane: rowTop + 30 }), fence: rows => ({ x0: 0, x1: 100, y0: 5, y1: 10 + rows * 40 }), height: f => f.y1 + 5 });
  const f = (key, over = {}) => ({ key, name: key.split('/').pop(), ...over });
  const L = plain(grid.layoutFor([f('/a/b/c/one'), f('/a/b/c/two'), f('/x/solo')], {}, NOW));
  assert.deepEqual(L.ST.map(s => [s.key.split('/').pop(), s.i, s.cx, s.rowTop, s.lane]), [['one', 0, 30, 10, 40], ['two', 1, 80, 10, 40], ['solo', 2, 30, 50, 80]]);
  assert.deepEqual(L.groups, [{ name: 'c', slots: [0, 1] }]);
  assert.equal(L.H, 95);
  const scene = plain(grid.layoutFor([f('r1', { project: 'p1', projectName: 'shop' }), f('r2', { project: 'p1', projectName: 'shop' })], {}, NOW));
  assert.deepEqual(scene.groups, [{ name: 'shop', slots: [0, 1] }], "the scene's project and its name win over the path");
  assert.equal(plain(grid.layoutFor(Array.from({ length: 6 }, (_, i) => f(`/z/r${i}`)), {}, NOW)).more, 2);
});

// The frame loads its scripts as separate scripts in one page, so their top-level `const`s are shared.
// Run them the same way, in frame.html's order: a name the farm hides in its wrapper that the engine
// still needs fails here, not only in a browser.
test("the frame's scripts, loaded one by one in one context, register the farm with the bridge", () => {
  const listeners = {}, posted = [];
  const el = () => new Proxy(function () {}, { get: (_, k) => (k === 'style' ? {} : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : el()), apply: () => el(), set: () => true });
  const parent = { postMessage: m => posted.push(m) };
  const window = { addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); }, removeEventListener() {}, parent, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), requestAnimationFrame() {}, setTimeout, clearTimeout };
  const document = { addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); }, createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {}, style: {} }, body: el(), readyState: 'loading', hidden: false };
  Object.assign(window, { window, document, parent, console, Math, Date, JSON, Map, Set, Intl, URL });
  const ctx = vm.createContext(window);
  for (const f of ['worlds/sdk/bridge.js', 'brand.js', 'worlds/sdk/pixel.js', 'worlds/sdk/engine.js', 'worlds/farm/world.js']) vm.runInContext(web(f), ctx, { filename: f });
  assert.equal(typeof window.AgentvilleFarm.layoutFor, 'function', 'the farm exported its helpers');
  assert.equal(vm.runInContext("legFrame({ walk: true }) + pixelOrigin({ x: 9, y: 9, walk: true }, 16).length", ctx), 'a2', 'the kit draws a walker without a name the farm hides');
  for (const fn of listeners.DOMContentLoaded ?? []) fn();
  assert.ok(posted.some(m => m && m.type === 'loaded'), `the bridge sent loaded; got ${JSON.stringify(posted)}`);
});
