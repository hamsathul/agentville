// The props kit (web/worlds/sdk/props.js): every step Claude Code takes has a prop that draws, no two
// alike; a world swaps in its own and keeps the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function load() {
  const window = { Agentville: {} };
  const ctx = vm.createContext({ window, console, Math, JSON, Map, Set });
  vm.runInContext(`${web('worlds/sdk/pixel.js')}\n;${web('worlds/sdk/props.js')}`, ctx);
  const PXG = vm.runInContext('PXG', ctx), rpAt = vm.runInContext('rpAt', ctx);
  /** What a prop draws at a few moments: rectangles with their colours. */
  const drawing = (draw, prop, flag = false) => [0.1, 0.4, 0.7].map(T => {
    const rects = [];
    PXG.ctx = { set fillStyle(c) { this.c = c; }, get fillStyle() { return this.c; }, fillRect(x, y, w, h) { if (w > 0 && h > 0) rects.push([this.c, x, y, w, h]); }, globalAlpha: 1 };
    PXG.T = T; PXG.k = 1; PXG.lights = [];
    draw(prop, rpAt(0, 0), T, flag);
    return rects;
  });
  return { props: window.Agentville.props, drawing };
}
const FARM_STEPS = ['edit', 'write', 'read', 'search', 'web', 'mcp', 'skill', 'test', 'lint', 'build', 'install', 'commit', 'push', 'deploy', 'pull', 'serve', 'delete', 'agent', 'plan', 'ask', 'shell', 'other'];

test('every step the farm knows has a prop, a verb and a spot', () => {
  const { props } = load();
  assert.deepEqual(plain(Object.keys(props.STEPS)), FARM_STEPS);
  for (const [step, a] of Object.entries(props.STEPS)) {
    assert.ok(props.PROPS.includes(a.prop), `${step}: ${a.prop} is drawn`);
    assert.ok(a.verb && Number.isFinite(a.spot), step);
  }
  assert.equal(props.PLAN_MODE.prop, 'blueprint');
});

test('every prop draws, and no two look alike', () => {
  const { props, drawing } = load();
  const seen = new Map();
  for (const prop of props.PROPS) {
    const d = JSON.stringify(drawing(props.draw, prop));
    assert.ok(drawing(props.draw, prop).every(r => r.length > 0), `${prop} draws at every moment`);
    assert.ok(!seen.has(d), `${prop} looks like ${seen.get(d)}`);
    seen.set(d, prop);
  }
  assert.equal(props.draw('nothing-here', () => {}, 0), false, 'a prop the kit lacks draws nothing');
});

test("a world's own: steps and props it gives, the kit's for the rest", () => {
  const { props, drawing } = load();
  const mine = props.kit({ steps: { test: { prop: 'beaker', verb: 'testing samples' } }, props: { beaker: rp => rp(0, 0, 3, 3, '#5ab4ff') } });
  assert.deepEqual(plain(mine.actionOf('test')), { prop: 'beaker', verb: 'testing samples', spot: 0 });
  assert.equal(mine.actionOf('edit').prop, 'pencil');
  assert.equal(mine.actionOf(undefined, 'Grep').prop, 'magnifier', "an older snapshot's tool");
  assert.equal(mine.actionOf('nonsense').prop, 'wrench');
  assert.equal(drawing(mine.draw, 'beaker')[0].length, 1);
  assert.deepEqual(drawing(mine.draw, 'pencil'), drawing(props.draw, 'pencil'));
  assert.equal(mine.doing({ state: 'working', mode: 'plan', step: 'edit' }).prop, 'blueprint');
  assert.equal(mine.doing({ state: 'working', step: 'read' }).prop, 'book');
  assert.equal(mine.doing({ state: 'working' }), null, 'between steps: nothing in its hands');
});
