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

// From the review: runs, a shrinking yard, a creature's whole body, the world's own fields, turns, the busy cap, still, names.
const FARMISH = { roam: [{ x: 4, y: 100, w: 100, h: 200 }], avoid: [{ x: 8, y: 194, w: 70, h: 32 }, { x: 84, y: 196, w: 24, h: 34 }, { x: 0, y: 95, w: 106, h: 44 }] };
const boxHits = (k, c, avoid) => { const s = k.CREATURES[c.kind]; return avoid.some(r => c.x + s.w / 2 > r.x && c.x - s.w / 2 < r.x + r.w && c.y > r.y && c.y - s.h < r.y + r.h); };

test('a run (Ride, Race it, Throw a stick) never crosses or ends in a place it must keep off, and nothing stays stranded', () => {
  const k = load();
  for (let seed = 1; seed <= 40; seed++) {
    const a = k.makeAnimals([{ kind: 'cow', count: 2, actions: [{ label: 'Ride', pose: 'run', run: true }] }, { kind: 'ostrich', actions: [{ label: 'Race it', pose: 'run', run: true }] }], { random: k.seededRandom(seed) });
    a.place(FARMISH);
    for (let i = 0; i < 600; i++) {
      if (i % 50 === 0) for (const id of ['cow-0', 'cow-1', 'ostrich-0']) a.perform(id, 0, null);
      a.tick(0.1, { night: false, still: false });
      for (const c of plain(a.list())) assert.ok(!boxHits(k, c, FARMISH.avoid), `seed ${seed} t=${i / 10}: ${c.id} at ${c.x},${c.y}`);
    }
  }
});

test('when the yard shrinks, everything ends up inside the new one and stays there', () => {
  const k = load();
  for (let seed = 1; seed <= 40; seed++) {
    const a = k.makeAnimals([{ kind: 'cow', count: 2, actions: [{ label: 'Ride', pose: 'run', run: true }] }, { kind: 'goat', count: 2 }], { random: k.seededRandom(seed) });
    a.place({ roam: [{ x: 4, y: 100, w: 100, h: 260 }], avoid: [] });
    for (let i = 0; i < 50; i++) a.tick(0.1, { night: false, still: false });
    a.perform('cow-0', 0, null);
    a.place({ roam: [{ x: 4, y: 100, w: 100, h: 120 }], avoid: [] });
    for (let i = 0; i < 600; i++) {
      a.tick(0.1, { night: false, still: false });
      for (const c of plain(a.list())) assert.ok(c.y <= 220 && c.y >= 100, `seed ${seed} t=${i / 10}: ${c.id} at ${c.x},${c.y}`);
    }
  }
});

test("a creature's whole body keeps off what it must, not just its feet; the world's own fields and buildings too", () => {
  const k = load();
  const field = { x: 40, y: 100, w: 30, h: 100 };
  const blocked = (x, y) => x >= field.x && x <= field.x + field.w && y >= field.y && y <= field.y + field.h;
  const a = k.makeAnimals([{ kind: 'ostrich', count: 3 }, { kind: 'cow', count: 3 }], { random: k.seededRandom(9) });
  a.place({ ...FARMISH, blocked });
  for (let i = 0; i < 6000; i++) {
    a.tick(0.1, { night: false, still: false });
    for (const c of plain(a.list())) {
      assert.ok(!boxHits(k, c, FARMISH.avoid), `${c.id} at ${c.x},${c.y} reaches into a place it keeps off`);
      assert.ok(!boxHits(k, c, [field]), `${c.id} at ${c.x},${c.y} is on the world's field`);
    }
  }
});

test('with nowhere to be (no roam), a creature is away: not drawn, not clickable', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'cat' }], { random: k.seededRandom(2) });
  a.place({ roam: [], avoid: [] });
  assert.equal(a.items().length, 0);
  assert.equal(a.at(0, 0), null);
  assert.equal(plain(a.list())[0].away, true);
});

test('a farmer whose turn ended is waiting for you too: never chosen, and it drops an errand at once', () => {
  const k = load();
  const at = { t: { x: 10, y: 10 }, w: { x: 40, y: 40 } };
  const posOf = id => at[id] ?? null;
  assert.equal(k.chooseDoer([{ id: 't', state: 'turn' }, { id: 'w', state: 'working' }], posOf, 10, 10).id, 'w');
  assert.equal(k.chooseDoer([{ id: 't', state: 'turn' }], posOf, 10, 10), null);
  assert.equal(k.chooseDoer([{ id: 'w', state: 'working' }], posOf, 10, 10, new Set(), f => f.id !== 'w'), null, 'one that cannot make it in time is not chosen');
  const e = k.makeErrands(), log = [];
  e.start('t', { x: 50, y: 0, now: 0, busy: false, missed: () => log.push('you') });
  assert.equal(e.target({ id: 't', state: 'turn' }), null);
  assert.deepEqual(log, ['you']);
  e.start('u', { x: 50, y: 0, now: 0, busy: false, missed: () => log.push('you') });
  assert.equal(e.tick(1, () => ({ x: 0, y: 0 }), () => 'turn'), true);
  assert.deepEqual(log, ['you', 'you']);
});

test('an idle farmer that starts working mid-errand gets the busy cap from then; finish() ends every errand in place', () => {
  const k = load();
  const e = k.makeErrands(), log = [];
  e.start('a', { x: 500, y: 0, now: 0, busy: false, missed: () => log.push('you') });
  e.tick(1, () => ({ x: 0, y: 0 }), () => 'working');
  assert.equal(e.tick(5.5, () => ({ x: 0, y: 0 }), () => 'working'), false);
  assert.equal(e.tick(6.1, () => ({ x: 0, y: 0 }), () => 'working'), true, 'five seconds from when it got busy');
  e.start('b', { x: 500, y: 0, now: 10, busy: false, missed: () => log.push('b') });
  e.finish();
  assert.equal(e.has('b'), false);
  assert.deepEqual(log, ['you', 'b']);
});

test('a world of your own may use the same short names as the kit (INK, inRect, LINE_MAX…) without breaking', () => {
  const window = { Agentville: {} };
  const sandbox = { window, console, Math, Date, JSON, Map, Set };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => vm.runInContext(`${['worlds/sdk/pixel.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js'].map(web).join('\n;\n')}\n;const INK = 1, inRect = 2, legStep = 3, LINE_MAX = 4, LINE_S = 5, LINES_AT_ONCE = 6;`, sandbox));
});

test('with motion off, time still passes for the lines: they go after 4 s, though nothing moves', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'cow', actions: [{ label: 'Pet', line: 'petted' }], lines: { petted: ['moo'] } }], { random: k.seededRandom(1) });
  a.place({ roam: [YARD], avoid: [] });
  a.perform('cow-0', 0, null);
  a.tick(4.5, { still: true });
  assert.equal(plain(a.bubbles()).length, 0);
});

test('habits: a goat climbs a perch (lifted), the ostrich hides, the tiger chases its tail, the dog fetches; all where they may', () => {
  const k = load();
  const perches = [[30, 160, 4], [70, 250, 3]];
  const a = k.makeAnimals([{ kind: 'goat', count: 2, habits: ['climb'] }, { kind: 'ostrich', habits: ['hide', 'circles'] }, { kind: 'tiger', habits: ['chaseTail', 'pounce'] }, { kind: 'sheepdog', habits: ['fetch', 'roll', 'laps'] }], { random: k.seededRandom(4) });
  a.place({ ...FARMISH, perches });
  const seen = new Set();
  for (let i = 0; i < 6000; i++) {
    a.tick(0.1, { night: false, still: false });
    for (const c of plain(a.list())) {
      assert.ok(!boxHits(k, c, FARMISH.avoid), `${c.id} at ${c.x},${c.y}`);
      if (c.kind === 'goat' && c.lift > 0) { seen.add('climb'); assert.ok(perches.some(p => p[0] === c.x && p[1] === c.y && p[2] === c.lift), 'on a perch'); }
      if (c.kind === 'ostrich' && c.pose === 'hide') seen.add('hide');
      if (c.kind === 'sheepdog' && c.pose === 'roll') seen.add('roll');
      if (c.kind === 'tiger' && c.pose === 'run') seen.add('pounce or chase');
    }
  }
  for (const h of ['climb', 'hide', 'roll', 'pounce or chase']) assert.ok(seen.has(h), `${h} happens in ten minutes`);
});

test('the ducklings swim in a line behind their mother', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'duck', count: 4, looks: ['drake', 'hen', 'duckling', 'duckling'], home: { x: 0, y: 0, w: 200, h: 60 } }], { random: k.seededRandom(6) });
  a.place({ roam: [], avoid: [] });
  let near = 0, total = 0;
  for (let i = 0; i < 3000; i++) {
    a.tick(0.1, { night: false, still: false });
    const ds = plain(a.list()), hen = ds.find(d => d.id === 'duck-1');
    for (const d of ds.filter(x => x.id === 'duck-2' || x.id === 'duck-3')) { total++; if (Math.hypot(d.x - hen.x, d.y - hen.y) < 26) near++; }
  }
  assert.ok(near / total > 0.7, `ducklings near their mother ${Math.round((100 * near) / total)}% of the time`);
});

test('winter: goats wear scarves, the ducks are on ice (sliding, no water), the rest huddle near the huddle spot', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'goat', count: 2 }, { kind: 'cow', count: 2 }, { kind: 'duck', count: 2, looks: ['drake', 'hen'], home: { x: 10, y: 160, w: 40, h: 30 } }], { random: k.seededRandom(8) });
  a.place({ roam: [YARD], avoid: [], spots: { huddle: [50, 150] } });
  for (let i = 0; i < 1200; i++) a.tick(0.1, { night: false, still: false, winter: true });
  const all = plain(a.list());
  assert.ok(all.filter(c => c.kind === 'goat').every(c => c.wear?.scarf));
  assert.ok(all.filter(c => c.kind === 'duck').every(c => c.wear?.ice && c.pose !== 'swim' && c.pose !== 'dabble'));
  const land = all.filter(c => c.kind !== 'duck'), d = land.reduce((t, c) => t + Math.hypot(c.x - 50, c.y - 150), 0) / land.length;
  assert.ok(d < 35, `they huddle: ${Math.round(d)} px from the spot on average`);
});

test('reactions: a failed deploy scatters those near and hides the ostrich; one reaction per kind per 30 s; all where they may', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'cow', count: 2, lines: { deployFailed: ['moo!?'] } }, { kind: 'ostrich', habits: ['hide'], lines: { deployFailed: ['not my fault'] } }, { kind: 'sheepdog', reacts: { merged: 'run', arrive: 'run' }, lines: { merged: ['WOOF!'], arrive: ['woof! hi!'] } }], { random: k.seededRandom(2) });
  a.place(FARMISH);
  const at = [60, 170];
  assert.equal(a.react('deployFailed', at), true);
  a.tick(0.1, {});
  assert.equal(plain(a.list()).find(c => c.kind === 'ostrich').pose, 'hide');
  assert.equal(a.react('deployFailed', at), false, 'not again within 30 s');
  assert.equal(a.react('merged', [100, 120]), true, 'another kind may');
  for (let i = 0; i < 301; i++) a.tick(0.1, {});
  assert.equal(a.react('deployFailed', at), true, 'after 30 s, again');
  for (let i = 0; i < 300; i++) { a.tick(0.1, {}); for (const c of plain(a.list())) assert.ok(!boxHits(k, c, FARMISH.avoid), `${c.id} at ${c.x},${c.y}`); }
  assert.equal(a.react('nonsense', at), false);
});

test('habits and spots respect a new yard: after the yard shrinks, no one stays on a perch or anywhere outside it', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'goat', count: 3, habits: ['climb'] }], { random: k.seededRandom(11) });
  a.place({ roam: [{ x: 4, y: 100, w: 100, h: 200 }], avoid: [], perches: [[50, 280, 4]] });
  for (let i = 0; i < 2000; i++) a.tick(0.1, {});
  a.place({ roam: [{ x: 4, y: 100, w: 100, h: 100 }], avoid: [], perches: [] });
  for (let i = 0; i < 600; i++) { a.tick(0.1, {}); for (const c of plain(a.list())) assert.ok(c.y <= 200 && !(c.lift > 0), `${c.id} at ${c.x},${c.y} lift ${c.lift}`); }
});

// A fake crew: farmers on a line, moved at once when sent (the engine walks them for real).
function fakeCrew(farmers) {
  const log = [], flags = {}, free = { hammock: true };
  return {
    log, flags, free, farmers,
    idle: () => farmers.filter(f => f.state === 'idle' && !f.sent),
    busy: () => farmers.filter(f => f.state === 'working'),
    longIdle: () => farmers.filter(f => f.state === 'idle' && !f.sent && f.long),
    at: id => farmers.find(f => f.id === id) ?? null,
    state: id => farmers.find(f => f.id === id)?.state,
    send: (id, [x, y]) => { const f = farmers.find(z => z.id === id); f.sent = true; f.x = x; f.y = y; log.push(['send', id]); },
    release: id => { const f = farmers.find(z => z.id === id); if (f) f.sent = false; log.push(['release', id]); },
    flag: (id, name, on) => { flags[`${id}.${name}`] = on; log.push(['flag', id, name, on]); },
    chickens: () => [],
    spotFree: name => free[name] ?? true,
    fx: (kind) => log.push(['fx', kind]),
  };
}
const HAT_GAG = { id: 'hat', needs: { goat: 1, farmer: 'idle' }, steps: [
  { go: 'goat', to: 'farmer' }, { wear: 'goat', what: 'hat', on: true }, { say: 'goat', line: 'hat' },
  { go: 'goat', to: 'away', run: true, ms: 3000 }, { chase: 'farmer', after: 'goat', ms: 3000 },
  { wear: 'goat', what: 'hat', on: false },
] };

test('a gag runs its steps: the goat takes the farmer’s hat, runs, is chased, gives it back; the farmer is let go', () => {
  const k = load();
  const a = k.makeAnimals({ cast: [{ kind: 'goat', lines: { hat: ['tastes of deadlines'] } }], gags: [HAT_GAG] }, { random: k.seededRandom(1) });
  a.place({ roam: [YARD], avoid: [] });
  const crew = fakeCrew([{ id: 'pip', state: 'idle', x: 50, y: 150 }]);
  for (let i = 0; i < 1300 && !a.gagNow(); i++) a.tick(0.1, { crew });
  assert.equal(a.gagNow()?.id, 'hat', 'a gag starts within two minutes');
  let hatless = false;
  for (let i = 0; i < 400 && a.gagNow(); i++) { a.tick(0.1, { crew }); hatless ||= crew.flags['pip.hatless'] === true; }
  assert.equal(a.gagNow(), null, 'it ends');
  assert.ok(hatless, 'the farmer was hatless for a while');
  assert.equal(crew.flags['pip.hatless'], false, 'and has its hat back');
  assert.ok(crew.log.some(l => l[0] === 'release' && l[1] === 'pip'), 'and is let go');
  assert.ok(plain(a.bubbles()).length > 0 || crew.log.length > 0);
});

test('a farmer that starts waiting ends the gag at once: hat back, let go', () => {
  const k = load();
  const a = k.makeAnimals({ cast: [{ kind: 'goat', lines: { hat: ['x'] } }], gags: [HAT_GAG] }, { random: k.seededRandom(1) });
  a.place({ roam: [YARD], avoid: [] });
  const crew = fakeCrew([{ id: 'pip', state: 'idle', x: 50, y: 150 }]);
  for (let i = 0; i < 1300 && crew.flags['pip.hatless'] !== true; i++) a.tick(0.1, { crew });
  assert.equal(crew.flags['pip.hatless'], true);
  crew.farmers[0].state = 'waiting';
  a.tick(0.1, { crew });
  assert.equal(a.gagNow(), null);
  assert.equal(crew.flags['pip.hatless'], false);
  assert.ok(crew.log.some(l => l[0] === 'release'));
});

test('no gag without its roles; never two at once; one every one to two minutes', () => {
  const k = load();
  const a = k.makeAnimals({ cast: [{ kind: 'goat' }], gags: [HAT_GAG] }, { random: k.seededRandom(3) });
  a.place({ roam: [YARD], avoid: [] });
  const crew = fakeCrew([{ id: 'x', state: 'waiting', x: 50, y: 150 }, { id: 'y', state: 'turn', x: 60, y: 150 }]);
  for (let i = 0; i < 3000; i++) { a.tick(0.1, { crew }); assert.equal(a.gagNow(), null, 'no idle farmer: no hat gag'); }
  const b = k.makeAnimals({ cast: [{ kind: 'goat' }], gags: [{ id: 'baa', needs: { goat: 1 }, steps: [{ say: 'goat', line: 'idle' }, { wait: 500 }] }] }, { random: k.seededRandom(3) });
  b.place({ roam: [YARD], avoid: [] });
  const starts = [];
  let was = null;
  for (let i = 0; i < 6000; i++) { b.tick(0.1, { crew: fakeCrew([]) }); const now = b.gagNow()?.id ?? null; if (now && !was) starts.push(i / 10); was = now; }
  assert.ok(starts.length >= 4 && starts.length <= 11, `${starts.length} gags in ten minutes`);
  for (let j = 1; j < starts.length; j++) assert.ok(starts[j] - starts[j - 1] >= 59.5, `gaps of a minute or more (${starts[j] - starts[j - 1]})`);
});

test('a gag written wrong is dropped, once, and the world goes on', () => {
  const k = load();
  const warn = [];
  const a = k.makeAnimals({ cast: [{ kind: 'goat' }], gags: [{ id: 'bad', needs: { goat: 1 }, steps: [{ teleport: 'goat' }] }, { id: 'baa', needs: { goat: 1 }, steps: [{ wait: 100 }] }] }, { random: k.seededRandom(5), warn: m => warn.push(m) });
  a.place({ roam: [YARD], avoid: [] });
  for (let i = 0; i < 6000; i++) a.tick(0.1, { crew: fakeCrew([]) });
  assert.equal(warn.filter(m => /bad/.test(m)).length, 1, 'logged once');
  assert.ok(plain(a.list()).length === 1);
});

test('the cow naps in the empty hammock and leaves the moment a farmer needs it', () => {
  const k = load();
  const a = k.makeAnimals({ cast: [{ kind: 'cow' }], gags: [{ id: 'hammock', needs: { cow: 1, spot: 'hammock' }, steps: [{ go: 'cow', to: 'spot:hammock' }, { stay: 'cow', is: 'sleep', ms: 20000, while: 'spot:hammock' }, { go: 'cow', to: 'back' }] }] }, { random: k.seededRandom(2) });
  a.place({ roam: [YARD], avoid: [{ x: 84, y: 196, w: 24, h: 34 }], spots: { hammock: [97, 204] } });
  const crew = fakeCrew([]);
  for (let i = 0; i < 2000 && !(plain(a.list())[0].x === 97 && plain(a.list())[0].y === 204); i++) a.tick(0.1, { crew });
  assert.deepEqual([plain(a.list())[0].x, plain(a.list())[0].y], [97, 204], 'in the hammock');
  crew.free.hammock = false;
  for (let i = 0; i < 100; i++) a.tick(0.1, { crew });
  const c = plain(a.list())[0];
  assert.ok(!(c.x >= 84 && c.x <= 108 && c.y >= 196 && c.y <= 230), `out of the hammock (${c.x},${c.y})`);
});

test('idle-only errands drop when work comes (play); end() lets a farmer go with nothing done', () => {
  const k = load();
  const e = k.makeErrands(), log = [];
  e.start('a', { x: 50, y: 0, now: 0, busy: false, idleOnly: true, missed: () => log.push('missed') });
  assert.equal(e.tick(1, () => ({ x: 0, y: 0 }), () => 'working'), true, 'work came: it goes back');
  assert.equal(e.has('a'), false);
  e.start('b', { x: 50, y: 0, now: 0, busy: false, missed: () => log.push('missed') });
  e.end('b');
  assert.equal(e.has('b'), false);
  assert.deepEqual(log, [], 'nothing is done for a play or an end');
});

test('play: a farmer idle a long while plays with a creature, two at most, and stops when work comes', () => {
  const k = load();
  const PLAY = { id: 'pet', needs: { goat: 1, farmer: 'idle' }, steps: [{ go: 'farmer', to: 'goat' }, { fx: 'hearts', at: 'goat' }, { wait: 60000 }] };
  const a = k.makeAnimals({ cast: [{ kind: 'goat', count: 3 }], play: [PLAY] }, { random: k.seededRandom(2) });
  a.place({ roam: [YARD], avoid: [] });
  const crew = fakeCrew([{ id: 'p', state: 'idle', x: 50, y: 150 }, { id: 'q', state: 'idle', x: 60, y: 150 }, { id: 'r', state: 'idle', x: 70, y: 150 }]);
  a.play(crew);
  assert.equal(crew.log.filter(l => l[0] === 'send').length, 0, 'no one idle long enough: no play');
  for (const f of crew.farmers) f.long = true;
  a.play(crew); a.play(crew); a.play(crew);
  assert.equal(a.gagNow(), null, 'play is not the gag: one may still start');
  for (let i = 0; i < 50; i++) a.tick(0.1, { crew });
  const sent = new Set(crew.log.filter(l => l[0] === 'send').map(l => l[1]));
  assert.equal(sent.size, 2, 'two farmers playing at most');
  assert.ok(crew.log.some(l => l[0] === 'fx' && l[1] === 'hearts'));
  const one = [...sent][0];
  crew.farmers.find(f => f.id === one).state = 'working';
  a.tick(0.1, { crew });
  assert.ok(crew.log.some(l => l[0] === 'release' && l[1] === one), 'work came: it goes back to it');
});

test('stopGags ends every gag and play at once (motion off, animals hidden): hats back, farmers let go', () => {
  const k = load();
  const a = k.makeAnimals({ cast: [{ kind: 'goat', lines: { hat: ['x'] } }], gags: [HAT_GAG] }, { random: k.seededRandom(1) });
  a.place({ roam: [YARD], avoid: [] });
  const crew = fakeCrew([{ id: 'pip', state: 'idle', x: 50, y: 150 }]);
  for (let i = 0; i < 1300 && crew.flags['pip.hatless'] !== true; i++) a.tick(0.1, { crew });
  assert.equal(crew.flags['pip.hatless'], true);
  a.stopGags(crew);
  assert.equal(a.gagNow(), null);
  assert.equal(crew.flags['pip.hatless'], false);
  assert.equal(a.list()[0].wear?.hat, undefined, 'the goat has no hat');
  assert.ok(crew.log.some(l => l[0] === 'release' && l[1] === 'pip'));
});

test('Feed bread with steal: the last duckling gets there first and says so', () => {
  const k = load();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const a = k.makeAnimals([{ kind: 'duck', count: 4, looks: ['drake', 'hen', 'duckling', 'duckling'], home: POND, bank: [[30, 158]], name: 'Ducks',
      actions: [{ label: 'Feed bread', fx: 'crumbs', gather: true, steal: true, line: 'fed' }], lines: { idle: ['quack.'], fed: ['BREAD!'], bread: ['mine!'] } }], { random: k.seededRandom(seed) });
    a.place({ roam: [YARD], avoid: [] });
    const r = a.perform('duck-0', 0, null);
    for (let i = 0; i < 20; i++) a.tick(0.1);
    const near = a.list().map(o => ({ id: o.id, d: Math.hypot(o.x - r.at[0], o.y - r.at[1]) })).sort((x, y) => x.d - y.d);
    assert.equal(near[0].id, 'duck-3', `the last duckling is nearest the crumbs (seed ${seed})`);
    assert.ok(near[0].d <= 6, `right by the crumbs, as near as the water lets it (${near[0].d})`);
    assert.ok(plain(a.bubbles()).some(b => b.id === 'duck-3' && b.text === 'mine!'));
  }
});

test('a gag lets a creature into its spot, but the way there and back keeps off the rest (the pond)', () => {
  const k = load();
  const PONDR = { x: 8, y: 194, w: 70, h: 32 }, HAMMOCK = { x: 84, y: 196, w: 24, h: 34 }, YARD2 = { x: 4, y: 100, w: 104, h: 140 };
  for (const seed of [1, 2, 3, 4]) {
    const a = k.makeAnimals({ cast: [{ kind: 'cow' }], gags: [{ id: 'hammock', needs: { cow: 1, spot: 'hammock' }, steps: [{ go: 'cow', to: 'spot:hammock' }, { stay: 'cow', is: 'sleep', ms: 3000, while: 'spot:hammock' }, { go: 'cow', to: 'back' }] }] }, { random: k.seededRandom(seed) });
    a.place({ roam: [YARD2], avoid: [PONDR, HAMMOCK], spots: { hammock: [97, 224] } });
    const crew = fakeCrew([]);
    let napped = false;
    for (let i = 0; i < 3000; i++) {
      a.tick(0.1, { crew });
      const c = plain(a.list())[0];
      if (c.x === 97 && c.y === 224) napped = true;
      assert.ok(!(c.x > PONDR.x && c.x < PONDR.x + PONDR.w && c.y > PONDR.y && c.y < PONDR.y + PONDR.h), `seed ${seed}: in the pond at (${c.x},${c.y})`);
    }
    assert.ok(napped, `seed ${seed}: it got to the hammock`);
  }
});

test('a gag whose creature can’t get to its farmer (in a field) ends: no hat taken from across the fence', () => {
  const k = load();
  const NIBBLE = { id: 'nibble', needs: { goat: 1, farmer: 'busy' }, steps: [{ go: 'goat', to: 'farmer', ms: 6000 }, { wear: 'goat', what: 'hat', on: true }, { say: 'goat', line: 'nibble' }, { wait: 3000 }, { wear: 'goat', what: 'hat', on: false }, { go: 'goat', to: 'away' }] };
  const a = k.makeAnimals({ cast: [{ kind: 'goat' }], gags: [NIBBLE] }, { random: k.seededRandom(1) });
  a.place({ roam: [YARD], avoid: [], blocked: x => x >= 120 });
  const crew = fakeCrew([{ id: 'w', state: 'working', x: 170, y: 140 }]);
  let started = false;
  for (let i = 0; i < 3000; i++) { a.tick(0.1, { crew }); if (a.gagNow()) started = true; }
  assert.ok(started, 'it was tried');
  assert.equal(crew.flags['w.hatless'], undefined, 'never hatless');
  const b = k.makeAnimals({ cast: [{ kind: 'goat' }], gags: [NIBBLE] }, { random: k.seededRandom(1) });
  b.place({ roam: [YARD], avoid: [], blocked: x => x >= 120 });
  const near = fakeCrew([{ id: 'm', state: 'working', x: 40, y: 160 }]); // in the meadow: in reach
  for (let i = 0; i < 3000 && near.flags['m.hatless'] !== true; i++) b.tick(0.1, { crew: near });
  assert.equal(near.flags['m.hatless'], true, 'a farmer in reach loses its hat a moment');
  assert.ok(!near.log.some(l => l[0] === 'send'), 'a busy farmer is never sent');
});

test('the guide’s cat with a gag runs as written (docs/worlds.md, "Gags and play")', () => {
  const k = load();
  const guide = readFileSync(fileURLToPath(new URL('../../docs/worlds.md', import.meta.url)), 'utf8');
  const block = guide.split('The same cat with habits')[1].match(/```js\n([\s\S]*?)```/)[1];
  const hooks = vm.runInNewContext(`({ ${block} })`, {});
  const warns = [];
  const a = k.makeAnimals(hooks.animals(), { random: k.seededRandom(5), warn: m => warns.push(m) });
  a.place({ roam: hooks.roam(), avoid: hooks.avoid() });
  let ran = false;
  for (let i = 0; i < 3000 && !ran; i++) { a.tick(0.1, { crew: fakeCrew([]) }); ran = a.gagNow()?.id === 'pounce'; }
  assert.ok(ran, 'its gag runs within five minutes');
  for (let i = 0; i < 100; i++) a.tick(0.1, { crew: fakeCrew([]) });
  assert.deepEqual(warns, [], 'nothing dropped');
});

test('gags written wrong in any way are dropped once each, and the rest still run (no needs, steps not a list, a step not an object, a role not cast, a chase not by the farmer, a spot not there)', () => {
  const k = load();
  const bad = [
    { id: 'noNeeds', steps: [{ wait: 100 }] },
    { id: 'stringSteps', needs: { goat: 1 }, steps: 'wait' },
    { id: 'stringStep', needs: { goat: 1 }, steps: ['wait'] },
    { id: 'strayRole', needs: { goat: 1 }, steps: [{ go: 'goat', to: 'cow' }] },
    { id: 'goatChases', needs: { goat: 1, farmer: 'idle' }, steps: [{ chase: 'goat', after: 'farmer', ms: 100 }] },
    { id: 'noSpot', needs: { goat: 1 }, steps: [{ go: 'goat', to: 'spot:nowhere' }] },
    null,
  ];
  const warns = [];
  const a = k.makeAnimals({ cast: [{ kind: 'goat', lines: { idle: ['baa'] } }], gags: [...bad, { id: 'ok', needs: { goat: 1 }, steps: [{ say: 'goat', line: 'idle' }, { wait: 200 }] }] }, { random: k.seededRandom(1), warn: m => warns.push(m) });
  a.place({ roam: [YARD], avoid: [] });
  let ok = 0, was = null;
  for (let i = 0; i < 12000; i++) { a.tick(0.1, { crew: fakeCrew([{ id: 'p', state: 'idle', x: 50, y: 150 }]) }); const g = a.gagNow()?.id ?? null; if (g === 'ok' && was !== 'ok') ok++; was = g; }
  for (const id of ['noNeeds', 'stringSteps', 'stringStep', 'strayRole', 'goatChases', 'noSpot']) assert.equal(warns.filter(w => w.includes(`gag ${id} was dropped`)).length, 1, `${id}: ${JSON.stringify(warns)}`);
  assert.ok(ok >= 2, `the good gag still runs (${ok})`);
});

test('an idle farmer that gets work mid-gag goes back to it at once: the gag ends, its hat back, no more sends', () => {
  const k = load();
  const a = k.makeAnimals({ cast: [{ kind: 'goat', lines: { hat: ['x'] } }], gags: [HAT_GAG] }, { random: k.seededRandom(1) });
  a.place({ roam: [YARD], avoid: [] });
  const crew = fakeCrew([{ id: 'pip', state: 'idle', x: 50, y: 150 }]);
  for (let i = 0; i < 1300 && crew.flags['pip.hatless'] !== true; i++) a.tick(0.1, { crew });
  assert.equal(crew.flags['pip.hatless'], true);
  crew.farmers[0].state = 'working';
  a.tick(0.1, { crew });
  assert.equal(a.gagNow(), null);
  assert.equal(crew.flags['pip.hatless'], false);
  const sends = crew.log.filter(l => l[0] === 'send').length;
  for (let i = 0; i < 60; i++) a.tick(0.1, { crew });
  assert.equal(crew.log.filter(l => l[0] === 'send').length, sends, 'a working farmer is not sent');
});

test('a gag whose farmer can’t be lent (crew.send says no: you sent it somewhere) ends at once', () => {
  const k = load();
  const a = k.makeAnimals({ cast: [{ kind: 'goat' }], gags: [{ id: 'visit', needs: { goat: 1, farmer: 'idle' }, steps: [{ go: 'farmer', to: 'goat' }, { wait: 60000 }] }] }, { random: k.seededRandom(1) });
  a.place({ roam: [YARD], avoid: [] });
  const crew = fakeCrew([{ id: 'pip', state: 'idle', x: 50, y: 150 }]);
  crew.send = () => false;
  for (let i = 0; i < 1300 && !a.gagNow(); i++) a.tick(0.1, { crew });
  assert.equal(a.gagNow()?.id, 'visit');
  a.tick(0.1, { crew }); a.tick(0.1, { crew });
  assert.equal(a.gagNow(), null);
});

test('the yard changing while the cow naps in the hammock: the same yard keeps her there; a new one ends the gag and puts her inside it', () => {
  const k = load();
  const HAMMOCK = { x: 84, y: 196, w: 24, h: 34 }, YARD2 = { x: 4, y: 100, w: 104, h: 140 };
  const make = () => {
    const a = k.makeAnimals({ cast: [{ kind: 'cow' }], gags: [{ id: 'hammock', needs: { cow: 1, spot: 'hammock' }, steps: [{ go: 'cow', to: 'spot:hammock' }, { stay: 'cow', is: 'sleep', ms: 60000, while: 'spot:hammock' }, { go: 'cow', to: 'back' }] }] }, { random: k.seededRandom(2) });
    a.place({ roam: [YARD2], avoid: [HAMMOCK], spots: { hammock: [97, 224] } });
    const crew = fakeCrew([]);
    for (let i = 0; i < 3000 && !(a.list()[0].x === 97 && a.list()[0].y === 224); i++) a.tick(0.1, { crew });
    assert.deepEqual([a.list()[0].x, a.list()[0].y], [97, 224]);
    return { a, crew };
  };
  const same = make();
  same.a.place({ roam: [YARD2], avoid: [HAMMOCK], spots: { hammock: [97, 224] } });
  same.a.tick(0.1, { crew: same.crew });
  assert.deepEqual([same.a.list()[0].x, same.a.list()[0].y], [97, 224], 'the same yard: still napping');
  assert.equal(same.a.gagNow()?.id, 'hammock');
  const moved = make(), SMALL = { x: 4, y: 100, w: 70, h: 80 };
  moved.a.place({ roam: [SMALL], avoid: [], spots: {} });
  moved.a.tick(0.1, { crew: moved.crew });
  const c = moved.a.list()[0];
  assert.equal(moved.a.gagNow(), null, 'the gag is over');
  assert.ok(c.x >= SMALL.x && c.x <= SMALL.x + SMALL.w && c.y >= SMALL.y && c.y <= SMALL.y + SMALL.h, `inside the new yard (${c.x},${c.y})`);
});

test('a goat on its perch that runs off comes down first', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'goat', habits: ['climb'] }], { random: k.seededRandom(3) });
  a.place({ roam: [YARD], avoid: [], perches: [[50, 150, 6]] });
  for (let i = 0; i < 6000 && !a.list()[0].lift; i++) a.tick(0.1);
  assert.ok(a.list()[0].lift > 0, 'up on the perch');
  a.react('deployFailed', [50, 150]);
  a.tick(0.1);
  assert.equal(a.list()[0].lift, 0);
});

test('reacts: null switches a reaction off, as the guide says', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'sheepdog', reacts: { deployFailed: null } }], { random: k.seededRandom(3) });
  a.place({ roam: [YARD], avoid: [] });
  a.tick(0.1);
  const before = plain(a.list())[0];
  a.react('deployFailed', [before.x, before.y]);
  for (let i = 0; i < 10; i++) a.tick(0.1);
  assert.notEqual(plain(a.list())[0].pose, 'run');
});

test('errands: a gag’s errand is let go by release; one you asked for is not, and says so', () => {
  const k = load();
  const e = k.makeErrands();
  e.start('a', { x: 1, y: 1, now: 0, busy: false, idleOnly: true });
  e.start('b', { x: 1, y: 1, now: 0, busy: false });
  assert.equal(e.kindOf('a'), 'lent');
  assert.equal(e.kindOf('b'), 'asked');
  assert.equal(e.kindOf('c'), null);
  e.release('a'); e.release('b');
  assert.equal(e.has('a'), false);
  assert.equal(e.has('b'), true, 'your errand stays');
});

test('chatter: an animal says the helper’s fresh line first, each once, then its fixed lines; actions keep theirs; an empty batch clears', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'cow', actions: [{ label: 'Pet', line: 'petted' }, { label: 'Feed' }], lines: { idle: ['MOO.'], petted: ['moo ♥'] } }, { kind: 'cat', lines: { idle: ['mrrp'] }, actions: [{ label: 'Pet' }, { label: 'Feed' }] }], { random: k.seededRandom(1) });
  a.place({ roam: [YARD], avoid: [] });
  a.chatter([{ kind: 'cow', when: 'idle', text: 'fresh one' }, { kind: 'cow', when: 'idle', text: 'fresh two' }, { kind: 'cow', when: 'petted', text: 'not for actions' }, { kind: 'dog', when: 'idle', text: 'no dog here' }, { kind: 'cow', when: 'idle', text: 'x'.repeat(41) }, { kind: 'cow', when: 'deployFailed', text: 'not my fault' }]);
  assert.deepEqual(plain(a.freshLines()).sort(), ['fresh one', 'fresh two', 'not my fault'].sort());
  const said = [];
  for (let i = 0; i < 4000 && said.filter(t => t.startsWith('fresh')).length < 2; i++) { a.tick(0.1); for (const b of a.bubbles()) if (b.id.startsWith('cow') && !said.includes(b.text)) said.push(b.text); }
  assert.deepEqual(said.slice(0, 2), ['fresh one', 'fresh two'], 'fresh first, in order, each once');
  for (let i = 0; i < 100 && a.bubbles().length; i++) a.tick(0.1); // the last line goes (4 s): one line at a time per animal
  a.perform('cow-0', 0, null);
  assert.equal(plain(a.bubbles()).find(b => b.id === 'cow-0')?.text, 'moo ♥', 'an action keeps its own line');
  for (let i = 0; i < 100 && a.bubbles().length; i++) a.tick(0.1);
  a.react('deployFailed', [50, 150]);
  assert.ok(plain(a.bubbles()).some(b => b.text === 'not my fault'), 'a reaction says the fresh line for it');
  assert.equal(a.freshLines().includes('not my fault'), false, 'once');
  a.chatter([]);
  assert.deepEqual(plain(a.freshLines()), []);
});

test('cast(): the kinds a world has, each once, with its name', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'cow', count: 2, name: 'Cow' }, { kind: 'duck', count: 3, name: 'Ducks', home: POND }], { random: k.seededRandom(1) });
  assert.deepEqual(plain(a.cast()), [{ kind: 'cow', name: 'Cow' }, { kind: 'duck', name: 'Ducks' }]);
});

test('a creature with no fixed idle lines still says the helper’s fresh ones; a gag keeps its fixed line', () => {
  const k = load();
  const a = k.makeAnimals([{ kind: 'cat', actions: [{ label: 'Pet' }, { label: 'Feed' }] }], { random: k.seededRandom(2) });
  a.place({ roam: [YARD], avoid: [] });
  a.chatter([{ kind: 'cat', when: 'idle', text: 'fresh mrrp' }]);
  let said = false;
  for (let i = 0; i < 1000 && !said; i++) { a.tick(0.1); said = plain(a.bubbles()).some(b => b.text === 'fresh mrrp'); }
  assert.ok(said, 'no fixed idle line needed');
  const g = k.makeAnimals({ cast: [{ kind: 'cat', lines: { idle: ['mrrp.'] }, actions: [{ label: 'Pet' }, { label: 'Feed' }] }], gags: [{ id: 'pounce', needs: { cat: 1 }, steps: [{ say: 'cat', line: 'idle' }, { wait: 100 }] }] }, { random: k.seededRandom(2) });
  g.place({ roam: [YARD], avoid: [] });
  g.chatter([{ kind: 'cat', when: 'idle', text: 'fresh mrrp' }]);
  let gagSaid = null;
  for (let i = 0; i < 1500 && !gagSaid; i++) { g.tick(0.1, { crew: fakeCrew([]) }); if (g.gagNow()) gagSaid = plain(g.bubbles())[0]?.text ?? null; }
  assert.equal(gagSaid, 'mrrp.', 'the gag says its fixed line');
});
