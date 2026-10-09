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
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js']) vm.runInContext(web(f), ctx, { filename: f });
  const engineWorld = window.Agentville.world; // the hooks the starter gives, kept for the tests
  window.Agentville.world = hooks => { window.hooks = hooks; return engineWorld(hooks); };
  vm.runInContext(web('worlds/starter/world.js'), ctx, { filename: 'worlds/starter/world.js' });
  return { window, dom, ctx };
}

test('the starter registers, places every agent, and draws them with the kits', () => {
  const { window, dom } = load();
  assert.ok(window.registered, 'it registered with Agentville.world');
  const prefs = { get: () => null, set() {} };
  window.registered.start({ el: dom.make(), opts: { still: true }, prefs });
  window.registered.scene(window.AgentvilleScene.toScene(goldenSnapshot()));
  assert.ok(dom.calls.fillRect > 0, 'it drew its ground');
  assert.ok(dom.calls.drawImage > 0, 'it drew people');
  assert.deepEqual([...window.Agentville.animalsNow()].map(c => c.kind), ['cat'], 'one cat from the creature library, the working example of animals()');
});

test('its cat keeps to the grass below the path, beside the fence: never on the plots, at the door or on the bench', () => {
  const { window, dom, ctx } = load();
  window.registered.start({ el: dom.make(), opts: { still: true }, prefs: { get: () => null, set() {} } });
  window.registered.scene(window.AgentvilleScene.toScene(goldenSnapshot()));
  const h = window.hooks, fence = h.layout().GRID, { w, h: tall } = ctx.CREATURES.cat;
  const PATH_FOOT = 86; // the starter's path runs from y 78 to 86; the door and the bench are above it
  for (const seed of [1, 7, 42]) {
    const kit = ctx.makeAnimals(h.animals(), { random: ctx.seededRandom(seed) });
    kit.place({ roam: h.roam(), avoid: h.avoid(), blocked: () => false });
    let moved = 0, last = null;
    for (let i = 0; i < 3000; i++) { // five minutes of its time
      kit.tick(0.1);
      const [c] = kit.list();
      assert.ok(!c.away, 'it has somewhere to be');
      assert.ok(c.y - tall > PATH_FOOT, `its whole body below the path, so off the door and the bench (y ${c.y})`);
      assert.ok(c.x + w / 2 <= fence.x0 || c.x - w / 2 >= fence.x1, `beside the fence, off the plots (${c.x}, ${c.y})`);
      assert.ok(c.y <= fence.y1, `not below the fence, under the buttons (y ${c.y})`);
      if (last && (c.x !== last.x || c.y !== last.y)) moved++;
      last = c;
    }
    assert.ok(moved > 0, 'it wanders');
  }
});

test('its world.json is valid, and its world.js short enough to read at once', () => {
  assert.equal(checkWorldJson(JSON.parse(web('worlds/starter/world.json'))), null);
  assert.ok(web('worlds/starter/world.js').split('\n').length <= 120, 'at most 120 lines');
});
