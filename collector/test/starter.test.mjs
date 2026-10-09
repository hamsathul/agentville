// The starter world (web/worlds/starter/): it registers, places every agent, draws, gives a valid
// world.json, and stays short enough to read at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkWorldJson } from '../worlds.mjs';
import { goldenSnapshot } from '../../scripts/golden/fixture.mjs';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
function stubDom() { // as in engine-hooks.test.mjs: every element and context a proxy that takes any call
  const numbers = new Set(['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight', 'width', 'height', 'length', 'size']);
  const calls = { fillRect: 0, drawImage: 0 };
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
      if (k === 'fillRect') return () => { calls.fillRect++; };
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
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js', 'worlds/starter/world.js']) vm.runInContext(web(f), ctx, { filename: f });
  return { window, dom };
}

test('the starter registers, places every agent, and draws them with the kits', () => {
  const { window, dom } = load();
  assert.ok(window.registered, 'it registered with Agentville.world');
  const prefs = { get: () => null, set() {} };
  window.registered.start({ el: dom.make(), opts: { still: true }, prefs });
  window.registered.scene(window.AgentvilleScene.toScene(goldenSnapshot()));
  assert.ok(dom.calls.fillRect > 0, 'it drew its ground');
  assert.ok(dom.calls.drawImage > 0, 'it drew people');
  assert.equal(window.Agentville.animalsNow().length, 0, 'no animals() hook: no animals, and the animals kit loaded beside it throws nothing');
});

test('its world.json is valid, and its world.js short enough to read at once', () => {
  assert.equal(checkWorldJson(JSON.parse(web('worlds/starter/world.json'))), null);
  assert.ok(web('worlds/starter/world.js').split('\n').length <= 120, 'at most 120 lines');
});
