// The creature library (web/worlds/sdk/creatures.js), drawn on a recording stand-in canvas: every
// creature, in every pose, stays inside its own box and is mirrored when it faces left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
function load() {
  const rects = [];
  const ctx = { fillRect: (x, y, w, h) => rects.push({ x, y, w, h, c: ctx.c }), set fillStyle(c) { ctx.c = c; } }; // each rectangle with its colour
  const window = { Agentville: {} };
  const sandbox = { window, console, Math, Date, JSON, Map, Set };
  vm.createContext(sandbox);
  vm.runInContext(`${web('worlds/sdk/pixel.js')}\n;${web('worlds/sdk/creatures.js')}\n;PXG.ctx = __ctx; window.lib = { CREATURES, creaturePainter };`, Object.assign(sandbox, { __ctx: ctx }));
  return { ...window.lib, rects };
}
const KINDS = ['cow', 'goat', 'sheepdog', 'ostrich', 'lion', 'tiger', 'duck', 'cat', 'dog', 'pigeon', 'mouse', 'fish', 'robodog', 'vacuum'];
const POSES = ['stand', 'walk', 'run', 'eat', 'sleep', 'happy', 'swim', 'dabble', 'hide'];

test('every creature has a size, a speed, a night habit and draws itself', () => {
  const { CREATURES } = load();
  assert.deepEqual(Object.keys(CREATURES).sort(), [...KINDS].sort());
  for (const k of KINDS) {
    const c = CREATURES[k];
    assert.ok(c.w > 0 && c.h > 0 && c.w <= 16 && c.h <= 16, `${k} size`);
    assert.ok(c.speed > 0 && c.speed <= 40, `${k} speed`);
    assert.ok(['sleep', 'awake'].includes(c.night), `${k} night`);
    assert.equal(typeof c.draw, 'function');
  }
  assert.equal(CREATURES.lion.night, 'awake', 'the lion is a cat: it wanders at night');
  assert.equal(CREATURES.duck.water, true);
});

test('every creature, in every pose and look, stays inside its box on its feet', () => {
  const lib = load();
  for (const k of KINDS) for (const pose of POSES) for (const look of [undefined, 'drake', 'hen', 'duckling']) for (const T of [0, 0.1, 0.2, 0.7]) {
    lib.rects.length = 0;
    lib.CREATURES[k].draw(lib.creaturePainter(100, 100, 1), pose, T, look);
    assert.ok(lib.rects.length > 0, `${k} ${pose} draws`);
    const c = lib.CREATURES[k];
    for (const r of lib.rects) {
      assert.ok(r.x >= 100 - Math.ceil(c.w / 2) - 1 && r.x + r.w <= 100 + Math.ceil(c.w / 2) + 1, `${k} ${pose} ${look} x ${r.x}+${r.w}`);
      assert.ok(r.y >= 100 - c.h - 1 && r.y + r.h <= 101, `${k} ${pose} ${look} y ${r.y}+${r.h}`);
    }
  }
});

test('facing left mirrors a creature about its feet', () => {
  const lib = load();
  lib.CREATURES.cow.draw(lib.creaturePainter(100, 100, 1), 'stand', 0);
  const right = lib.rects.splice(0).map(r => r.x + r.w / 2 - 100);
  lib.CREATURES.cow.draw(lib.creaturePainter(100, 100, -1), 'stand', 0);
  const left = lib.rects.splice(0).map(r => r.x + r.w / 2 - 100);
  assert.deepEqual(left, right.map(x => -x));
});

test('the new poses draw inside the box too; wear (scarf, a hat in the mouth, a bucket, ice) as well', () => {
  const lib = load();
  const POSES2 = ['yawn', 'stretch', 'roll', 'startled', 'slide'];
  for (const k of KINDS) for (const pose of POSES2) for (const wear of [{}, { scarf: true }, { hat: '#e9c46a' }, { bucket: true }, { ice: true }]) {
    lib.rects.length = 0;
    lib.CREATURES[k].draw(lib.creaturePainter(100, 100, 1), pose, 0.3, undefined, wear);
    const c = lib.CREATURES[k];
    for (const r of lib.rects) {
      assert.ok(r.x >= 100 - Math.ceil(c.w / 2) - 1 && r.x + r.w <= 100 + Math.ceil(c.w / 2) + 1, `${k} ${pose} ${JSON.stringify(wear)} x`);
      assert.ok(r.y >= 100 - c.h - 1 && r.y + r.h <= 101, `${k} ${pose} ${JSON.stringify(wear)} y`);
    }
  }
});

test('a goat in a scarf draws more than without; one with a hat in its mouth too; a duck on ice draws no water', () => {
  const lib = load();
  const count = (k, pose, wear, look) => { lib.rects.length = 0; lib.CREATURES[k].draw(lib.creaturePainter(100, 100, 1), pose, 0, look, wear); return lib.rects.length; };
  assert.ok(count('goat', 'stand', { scarf: true }) > count('goat', 'stand', {}));
  assert.ok(count('goat', 'stand', { hat: '#e9c46a' }) > count('goat', 'stand', {}));
  assert.ok(count('ostrich', 'run', { bucket: true }) > count('ostrich', 'run', {}));
  assert.ok(count('duck', 'sleep', { ice: true }, 'drake') < count('duck', 'sleep', {}, 'drake'), 'no water line on ice');
  assert.ok(count('ostrich', 'sleep', {}) > 0);
});

test('the robot dog: a little chrome terrier (chrome body, slate legs and ears), its antenna tail blinking red; asleep, a green standby light blinks', () => {
  const lib = load();
  assert.deepEqual({ ...lib.CREATURES.robodog, draw: undefined }, { w: 10, h: 8, speed: 16, night: 'sleep', draw: undefined });
  const colours = (pose, T) => { lib.rects.length = 0; lib.CREATURES.robodog.draw(lib.creaturePainter(100, 100, 1), pose, T); return new Set(lib.rects.map(r => r.c)); };
  const stand = colours('stand', 0);
  for (const c of ['#c3cbd2', '#5f6b7a']) assert.ok(stand.has(c), `standing, it has ${c}`);
  const Ts = Array.from({ length: 8 }, (_, i) => i / 4);
  const tipLit = Ts.map(T => colours('stand', T).has('#ff6b6b'));
  assert.ok(tipLit.includes(true) && tipLit.includes(false), `its antenna's red tip blinks (${tipLit})`);
  const standby = Ts.map(T => colours('sleep', T).has('#6cc04a'));
  assert.ok(standby.includes(true) && standby.includes(false), `asleep, its green standby light blinks (${standby})`);
  assert.ok(!Ts.some(T => colours('stand', T).has('#6cc04a')), 'awake, no standby light');
});

test('the robot vacuum: a round sweeper (a pale top, a blue ring light, a dark skirt); walking, its brush pixel turns', () => {
  const lib = load();
  assert.deepEqual({ ...lib.CREATURES.vacuum, draw: undefined }, { w: 9, h: 4, speed: 6, night: 'sleep', draw: undefined });
  const draw = (pose, T) => { lib.rects.length = 0; lib.CREATURES.vacuum.draw(lib.creaturePainter(100, 100, 1), pose, T); return JSON.stringify(lib.rects); };
  const stand = new Set(JSON.parse(draw('stand', 0)).map(r => r.c));
  for (const c of ['#e6eef5', '#3d7be0', '#3a3a40']) assert.ok(stand.has(c), `standing, it has ${c}`);
  const walks = new Set(Array.from({ length: 8 }, (_, i) => draw('walk', i / 16)));
  assert.ok(walks.size > 1, 'walking, its brush turns');
  assert.equal(new Set(Array.from({ length: 8 }, (_, i) => draw('stand', i / 16))).size, 1, 'standing, it is still');
  assert.ok(!draw('sleep', 0).includes('#3d7be0'), 'asleep, its ring light is off');
});

test('the robot dog and the vacuum ignore the season: what the kit puts on in winter (a scarf, ice) changes nothing on them', () => {
  const lib = load();
  for (const k of ['robodog', 'vacuum']) for (const pose of ['stand', 'walk', 'sleep', 'happy']) {
    const draw = wear => { lib.rects.length = 0; lib.CREATURES[k].draw(lib.creaturePainter(100, 100, 1), pose, 0.3, undefined, wear); return JSON.stringify(lib.rects); };
    assert.equal(draw({ scarf: true, ice: true }), draw({}), `${k} ${pose}`);
  }
});
