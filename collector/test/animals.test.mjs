// The animals kit (web/worlds/sdk/animals.js), on a seeded random source and a stand-in canvas:
// where creatures may be, what they do over time, clicks, lines, actions; who goes, and errands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
function load() {
  const window = { Agentville: {} };
  const sandbox = { window, console, Math, Date, JSON, Map, Set, __ctx: { fillRect() {}, set fillStyle(_) {} } };
  vm.createContext(sandbox);
  vm.runInContext(`${['worlds/sdk/pixel.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js'].map(web).join('\n;\n')}\n;PXG.ctx = __ctx; window.kit = { makeAnimals, seededRandom, chooseDoer, makeErrands, CREATURES };`, sandbox);
  return window.kit;
}
const plain = v => JSON.parse(JSON.stringify(v));
const YARD = { x: 0, y: 100, w: 100, h: 100 }, POND = { x: 10, y: 160, w: 40, h: 30 }, HENHOUSE = { x: 0, y: 100, w: 30, h: 30 };
const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const CAST = [
  { kind: 'cow', count: 2, actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Ride', pose: 'run', run: true }], lines: { idle: ['MOO.'], petted: ['moo ♥'] } },
  { kind: 'duck', count: 3, looks: ['drake', 'hen', 'duckling'], home: POND, bank: [[30, 158]], name: 'Ducks', actions: [{ label: 'Feed bread', fx: 'crumbs', gather: true, line: 'fed' }], lines: { idle: ['quack.'], fed: ['BREAD!'] } },
  { kind: 'lion', lines: { idle: ['<b>roar</b>'] } },
];
const kitOf = () => { const k = load(); const a = k.makeAnimals(CAST, { random: k.seededRandom(3) }); a.place({ roam: [YARD], avoid: [POND, HENHOUSE] }); return { k, a }; };

test('every creature starts somewhere it may be: land animals in the yard, never on the pond or the henhouse; ducks on the pond', () => {
  const { a } = kitOf();
  const all = plain(a.list());
  assert.equal(all.length, 6);
  for (const c of all) {
    if (c.kind === 'duck') assert.ok(inside(POND, c.x, c.y), `${c.id} on the pond`);
    else assert.ok(inside(YARD, c.x, c.y) && !inside(POND, c.x, c.y) && !inside(HENHOUSE, c.x, c.y), `${c.id} at ${c.x},${c.y}`);
  }
});

test('over ten minutes of wandering, nothing ever stands in a place it may not', () => {
  const { a } = kitOf();
  for (let i = 0; i < 6000; i++) {
    a.tick(0.1, { night: false, still: false });
    for (const c of plain(a.list())) {
      if (c.kind === 'duck') assert.ok(inside(POND, c.x, c.y), `${c.id} left the pond at ${c.x},${c.y}`);
      else assert.ok(inside(YARD, c.x, c.y) && !inside(POND, c.x, c.y) && !inside(HENHOUSE, c.x, c.y), `${c.id} at ${c.x},${c.y} (t=${i / 10})`);
    }
  }
  assert.ok(plain(a.list()).some(c => c.pose === 'walk' || c.pose === 'swim'), 'they do move');
});

test('re-placed when the yard changes: anything left outside the new yard is moved back in', () => {
  const { a } = kitOf();
  a.place({ roam: [{ x: 0, y: 100, w: 100, h: 40 }], avoid: [HENHOUSE] });
  for (const c of plain(a.list()).filter(c => c.kind !== 'duck')) assert.ok(c.y <= 140 && !inside(HENHOUSE, c.x, c.y), `${c.id} at ${c.x},${c.y}`);
});

test('at night most sleep where they are; the lion wanders; with motion off all doze and nothing moves', () => {
  const { a } = kitOf();
  for (let i = 0; i < 100; i++) a.tick(0.1, { night: true, still: false });
  const night = plain(a.list());
  assert.ok(night.filter(c => c.kind !== 'lion').every(c => c.pose === 'sleep'));
  assert.notEqual(night.find(c => c.kind === 'lion').pose, 'sleep');
  const before = plain(a.list());
  for (let i = 0; i < 100; i++) a.tick(0.1, { night: false, still: true });
  const after = plain(a.list());
  assert.deepEqual(after.map(c => [c.x, c.y]), before.map(c => [c.x, c.y]), 'nothing moves');
  assert.ok(after.every(c => c.pose === 'sleep'), 'they doze');
});

test('a click finds the creature under it, or the ducks by their pond', () => {
  const { a } = kitOf();
  const cow = plain(a.list()).find(c => c.kind === 'cow');
  assert.equal(a.at(cow.x, cow.y - 3), cow.id);
  assert.equal(a.at(-50, -50), null);
  assert.equal(a.homeAt(POND.x + 5, POND.y + 5), 'duck-0', 'the pond opens the ducks');
  assert.equal(a.homeAt(80, 110), null);
  assert.deepEqual(plain(a.menu('duck-0')), { id: 'duck-0', kind: 'duck', title: 'Ducks', actions: ['Feed bread'] });
  assert.deepEqual(plain(a.where('duck-0')).stand, [30, 158], 'a farmer stands on the bank to feed them');
  assert.equal(a.menu('nobody'), null);
});

test('an action: its line, its effect; Feed bread gathers the whole family; Ride runs off', () => {
  const { a } = kitOf();
  const r = plain(a.perform('cow-0', 0, 'Pip'));
  assert.equal(r.fx, 'hearts');
  assert.deepEqual(plain(a.bubbles()).map(b => b.text), ['moo ♥']);
  const fed = plain(a.perform('duck-0', 0, null));
  assert.equal(fed.fx, 'crumbs');
  for (let i = 0; i < 30; i++) a.tick(0.1, { night: false, still: false });
  const ducks = plain(a.list()).filter(c => c.kind === 'duck');
  assert.ok(ducks.every(d => Math.hypot(d.x - fed.at[0], d.y - fed.at[1]) < Math.hypot(POND.w, POND.h)), 'all paddle over');
  const cow = plain(a.list()).find(c => c.id === 'cow-1');
  a.perform('cow-1', 1, null);
  a.tick(0.1, { night: false, still: false });
  assert.equal(plain(a.list()).find(c => c.id === 'cow-1').pose, 'run');
  assert.equal(a.perform('cow-0', 9, null), null, 'no such action');
  assert.ok(cow);
});

test('lines: at most two bubbles at once, 40 characters at most, gone after 4 s; text as given (the engine shows it as text)', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'cow', count: 4, lines: { idle: ['x'.repeat(60)], petted: ['moo'] }, actions: [{ label: 'Pet', line: 'petted' }] }, { kind: 'lion', lines: { idle: ['<b>roar</b>'] } }], { random: k.seededRandom(5) });
  a.place({ roam: [YARD], avoid: [] });
  for (const id of ['cow-0', 'cow-1', 'cow-2']) a.perform(id, 0, null);
  assert.equal(plain(a.bubbles()).length, 2, 'two at once');
  for (let i = 0; i < 41; i++) a.tick(0.1, { night: false, still: false });
  assert.equal(plain(a.bubbles()).filter(b => b.text === 'moo').length, 0, 'gone after 4 s');
  let seen = [];
  for (let i = 0; i < 3000; i++) { a.tick(0.1, { night: false, still: false }); seen.push(...plain(a.bubbles()).map(b => b.text)); }
  assert.ok(seen.length > 0, 'they talk now and then');
  assert.ok(seen.every(t => t.length <= 40), 'clipped to 40');
  assert.ok(seen.includes('<b>roar</b>') || seen.some(t => t.startsWith('xxx')), 'text untouched here');
});

test('an unknown creature is refused with its name', () => {
  const k = load();
  assert.throws(() => k.makeAnimals([{ kind: 'dragon' }]), /no creature called dragon/);
});

test('who goes: the nearest farmer not waiting and not away, idle before busy; none: you', () => {
  const k = load();
  const at = { a: { x: 10, y: 10 }, b: { x: 50, y: 50 }, c: { x: 12, y: 12 }, d: { x: 11, y: 11 } };
  const posOf = id => at[id] ?? null;
  const F = (id, state) => ({ id, state });
  assert.equal(k.chooseDoer([F('a', 'working'), F('b', 'idle')], posOf, 10, 10).id, 'b', 'idle before busy, even further away');
  assert.equal(k.chooseDoer([F('a', 'working'), F('c', 'working')], posOf, 13, 13).id, 'c', 'the nearest of the busy');
  assert.equal(k.chooseDoer([F('d', 'waiting')], posOf, 10, 10), null, 'never one waiting on you');
  assert.equal(k.chooseDoer([F('a', 'idle')], posOf, 10, 10, new Set(['a'])), null, 'never one already away');
  assert.equal(k.chooseDoer([F('x', 'idle')], posOf, 10, 10), null, 'not on the map: no');
});

test('an errand: there, a moment, back; a busy farmer at most 5 s; waiting drops it at once and you do it', () => {
  const k = load();
  const e = k.makeErrands();
  const log = [];
  let pos = { x: 0, y: 0 }, state = 'idle';
  e.start('a', { x: 20, y: 0, now: 0, busy: false, stay: 1.5, then: () => log.push('done'), missed: () => log.push('you') });
  assert.deepEqual(plain(e.target({ id: 'a', state })), [20, 0]);
  assert.equal(e.tick(1, () => pos, () => state), false);
  pos = { x: 20, y: 0 };
  e.tick(2, () => pos, () => state);
  assert.deepEqual(log, ['done']);
  assert.equal(e.tick(3, () => pos, () => state), false, 'staying a moment');
  assert.equal(e.tick(3.6, () => pos, () => state), true, 'then back');
  assert.equal(e.has('a'), false);
  log.length = 0;
  e.start('b', { x: 200, y: 0, now: 10, busy: true, then: () => log.push('done'), missed: () => log.push('you') });
  pos = { x: 0, y: 0 };
  assert.equal(e.tick(14, () => pos, () => 'working'), false);
  assert.equal(e.tick(15.1, () => pos, () => 'working'), true, 'busy: 5 s at most');
  assert.deepEqual(log, ['you']);
  log.length = 0;
  e.start('c', { x: 200, y: 0, now: 20, busy: false, then: () => log.push('done'), missed: () => log.push('you') });
  assert.equal(e.target({ id: 'c', state: 'waiting' }), null, 'it needs you: no errand');
  assert.equal(e.has('c'), false);
  assert.deepEqual(log, ['you'], 'dropped as its place is worked out: you do it');
  log.length = 0;
  e.start('d', { x: 200, y: 0, now: 20, busy: false, then: () => log.push('done'), missed: () => log.push('you') });
  assert.equal(e.tick(21, () => pos, () => 'waiting'), true);
  assert.deepEqual(log, ['you'], 'dropped, and you do it');
});
