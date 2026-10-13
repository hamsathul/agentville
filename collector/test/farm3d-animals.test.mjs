// The 3D farm's animals: the models (scripts/farm3d-animals.mjs made them from Quaternius's Animated Animal Pack), how
// they are slimmed (scripts/lib/glb.mjs), and what they get up to (web/worlds/farm3d/antics.js): their habits when left
// alone and what each does when you pick it from its menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { thinKeys, packWeights } from '../../scripts/lib/glb.mjs';
import { ACTS, advance, command, habitsOf, makeAnimal, menuFor, stepsFor } from '../../web/worlds/farm3d/antics.js';

test('slimming a model: a key a straight line from its neighbours already gives is dropped; a turn, the ends and a lone key are kept', () => {
  // x rises steadily to t = 3, then falls back: keys 1 and 2 lie on the line from 0 to 3, key 4 on the line from 3 to 5
  const times = [0, 1, 2, 3, 4, 5], values = [0, 1, 2, 3, 2, 1];
  assert.deepEqual(thinKeys(times, values, 1, 1e-4), [0, 3, 5]);
  // every key in between is checked, not just the last one dropped: a slow curve keeps enough keys to stay within eps
  const curve = Array.from({ length: 21 }, (_, i) => i / 20), arc = curve.map(t => Math.sin(t * Math.PI));
  const kept = thinKeys(curve, arc, 1, 0.01);
  assert.ok(kept.length > 3 && kept.length < 21, `${kept.length} of 21 kept`);
  for (let k = 0; k < 21; k++) {
    const b = kept.findIndex(i => i >= k), i1 = kept[b], i0 = kept[Math.max(0, b - 1)];
    const u = i1 === i0 ? 0 : (curve[k] - curve[i0]) / (curve[i1] - curve[i0]), v = arc[i0] + (arc[i1] - arc[i0]) * u;
    assert.ok(Math.abs(v - arc[k]) <= 0.01 + 1e-9, `key ${k}: ${v} for ${arc[k]}`);
  }
  // a channel that never moves keeps one key; a vec3 channel is judged on all three parts
  assert.deepEqual(thinKeys([0, 1, 2], [5, 5, 5], 1, 1e-4), [0]);
  assert.deepEqual(thinKeys([0, 1, 2], [0, 0, 0, 1, 0, 0, 2, 0, 0], 3, 1e-4), [0, 2]);
  assert.deepEqual(thinKeys([0, 1, 2], [0, 0, 0, 1, 1, 0, 2, 0, 0], 3, 1e-4), [0, 1, 2]);
  assert.deepEqual(thinKeys([0], [1], 1, 1e-4), [0]);
});

test("slimming a model: skin weights packed in bytes still add up to one, each vertex's biggest share taking the rounding", () => {
  const w = new Float32Array([0.5, 0.25, 0.25, 0, 1 / 3, 1 / 3, 1 / 3, 0, 0.9, 0.05, 0.03, 0.02]);
  const p = packWeights(w);
  assert.ok(p instanceof Uint8Array);
  for (let v = 0; v < 3; v++) {
    const q = [...p.slice(v * 4, v * 4 + 4)];
    assert.equal(q.reduce((a, b) => a + b, 0), 255, `vertex ${v}: ${q}`);
    for (let c = 0; c < 4; c++) assert.ok(Math.abs(q[c] / 255 - w[v * 4 + c]) < 2 / 255, `vertex ${v}, joint ${c}`);
  }
});

const PACK = 'https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS';
const KINDS = ['alpaca', 'bull', 'cow', 'deer', 'donkey', 'fox', 'horse', 'husky', 'shiba', 'stag', 'whitehorse', 'wolf'];

test("the models: all twelve of Quaternius's Animated Animal Pack, each with every one of its animations, slimmed", async () => {
  const { MODELS } = await import('../../web/worlds/farm3d/models/index.js');
  const { readGlb } = await import('../../scripts/lib/glb.mjs');
  assert.deepEqual(Object.keys(MODELS).sort(), KINDS);
  let total = 0;
  for (const [kind, m] of Object.entries(MODELS)) {
    assert.equal(m.author, 'Quaternius', kind);
    assert.match(m.licence, /^CC0/, kind);
    assert.ok(['hooves', 'paws'].includes(m.family), kind);
    const b64 = (await import(`../../web/worlds/farm3d/models/${kind}.js`)).default, glb = Buffer.from(b64, 'base64'), { json } = readGlb(glb);
    total += b64.length;
    const clips = json.animations.map(a => a.name).sort();
    assert.deepEqual(clips, [...new Set(Object.values(m.clips))].sort(), `${kind}: every clip once, and every clip has a part`);
    assert.equal(clips.length, m.family === 'hooves' ? 13 : 12, kind);
    for (const part of ['walk', 'run', 'leap', 'hop', 'idle', 'look', 'headlow', 'eat', 'flinchLeft', 'flinchRight', 'dead']) assert.ok(m.clips[part], `${kind}: ${part}`);
    assert.ok(m.family === 'hooves' ? m.clips.kick && m.clips.headbutt && !m.clips.pounce : m.clips.pounce && !m.clips.kick, `${kind}: its family's own moves`);
    assert.equal(json.skins?.length, 1, `${kind}: a skeleton to play them on`);
    for (const mesh of json.meshes) for (const p of mesh.primitives) {
      assert.ok(!('NORMAL' in p.attributes) && !Object.keys(p.attributes).some(k => k.startsWith('TEXCOORD')), `${kind}: no normals or texture coordinates (flat shading, no textures)`);
      if ('WEIGHTS_0' in p.attributes) assert.equal(json.accessors[p.attributes.WEIGHTS_0].componentType, 5121, `${kind}: weights in bytes`);
    }
    assert.ok(!json.images && !json.textures, `${kind}: no textures: a frame couldn't load them`);
    const rotations = json.animations.flatMap(a => a.channels.filter(c => c.target.path === 'rotation').map(c => json.accessors[a.samplers[c.sampler].output]));
    assert.ok(rotations.length && rotations.every(r => r.componentType === 5122 && r.normalized), `${kind}: rotations in 16 bits`);
    assert.ok(m.height > 0.4 && m.height < 2.2, `${kind}: ${m.height} m`);
    assert.ok(glb.length < 420 * 1024, `${kind}: ${Math.round(glb.length / 1024)} KB, slimmed`);
  }
  assert.ok(total < 6 * 1024 * 1024, `all the animals: ${Math.round(total / 1024)} KB served`);
  assert.ok(MODELS.horse.height > MODELS.cow.height && MODELS.cow.height > MODELS.donkey.height && MODELS.donkey.height > MODELS.wolf.height && MODELS.wolf.height > MODELS.husky.height && MODELS.husky.height > MODELS.fox.height, 'sizes that make sense side by side');
});

// The colour areas a model's eyes are, where their names don't say so.
const EYES = { husky: ['Material.002', 'Material.003'], stag: ['Material.011'] };

test("their colours: the farm's matte finish, and every colour area but the eyes repainted, by a name the model has, no darker than before", async () => {
  const { COATS, FINISH } = await import('../../web/worlds/farm3d/coats.js');
  const { readGlb } = await import('../../scripts/lib/glb.mjs');
  assert.deepEqual(FINISH, { roughness: 0.85, metalness: 0 }, "build/materials.js's std(): no metal");
  assert.deepEqual(Object.keys(COATS).sort(), KINDS);
  const linear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (const kind of KINDS) {
    const { json } = readGlb(Buffer.from((await import(`../../web/worlds/farm3d/models/${kind}.js`)).default, 'base64'));
    const own = new Map(json.materials.map(m => [m.name, m.pbrMetallicRoughness.baseColorFactor]));
    for (const [name, hex] of Object.entries(COATS[kind])) {
      assert.ok(own.has(name), `${kind}: no colour area "${name}" (it has ${[...own.keys()].join(', ')})`);
      assert.match(hex, /^#[0-9a-f]{6}$/, `${kind} ${name}`);
      const rgb = [1, 3, 5].map(i => linear(parseInt(hex.slice(i, i + 2), 16) / 255));
      assert.ok(lum(rgb) >= lum(own.get(name)), `${kind} ${name}: ${hex} is darker than the model's own`);
    }
    for (const name of own.keys()) if (!(name in COATS[kind])) assert.ok(/^eyes?(_|$)/i.test(name) || EYES[kind]?.includes(name), `${kind}: "${name}" keeps the model's colour, but it isn't an eye`);
  }
});

test("the models' credit: LICENSE.md names the pack, its author, its licence and each model; the README credits it", async () => {
  const { MODELS } = await import('../../web/worlds/farm3d/models/index.js');
  const licence = readFileSync(fileURLToPath(new URL('../../web/worlds/farm3d/models/LICENSE.md', import.meta.url)), 'utf8');
  for (const words of ['Quaternius', 'CC0', PACK, 'https://creativecommons.org/publicdomain/zero/1.0/']) assert.ok(licence.includes(words), words);
  for (const m of Object.values(MODELS)) assert.ok(licence.includes(m.source), m.title);
  assert.ok(!/CC BY|Farm-Animal-Pack/.test(licence), 'only the one pack');
  const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');
  const section = readme.slice(readme.indexOf('### The 3D farm (prototype)'), readme.indexOf('### Notifications and the bell'));
  assert.match(section, /Quaternius.{0,200}Animated Animal Pack.{0,200}CC0/s);
  assert.ok(!/Farm Animal Pack|CC BY/.test(section), 'the README credits only the one pack');
});

/* ---------- what they get up to (antics.js) ---------- */
const PARTS_OF = steps => steps.filter(s => s.part).map(s => s.part);
/** A stand-in world: every clip lasts 1 s; "far" is 100 px east, inside a big field. */
const world = (over = {}) => ({ resting: false, rand: () => 0.5, duration: () => 1, spot: (area, from) => (from ? [from[0] + 100, from[1]] : [50, 50]), inside: () => true, habitChance: 0, ...over });
/** Runs an animal for secs in 1/20 s ticks, and the parts it showed, in order, once each time one starts. */
function run(a, secs, env) {
  const shown = [];
  let seq = -1;
  for (let i = 0; i < secs * 20; i++) {
    advance(a, 0.05, env);
    if (a.seq !== seq) { seq = a.seq; shown.push(a.part); }
  }
  return shown;
}

test("antics: every animal's menu and habits give every one of its clips a part; playing dead and headbutts are asked for, never habits", async () => {
  const { MODELS } = await import('../../web/worlds/farm3d/models/index.js');
  for (const [kind, m] of Object.entries(MODELS)) {
    const menu = menuFor(kind, m.family), habits = Object.keys(habitsOf(kind, m.family));
    const parts = new Set(['walk', 'idle', 'eat', ...[...menu, ...habits].flatMap(act => PARTS_OF(stepsFor(act, makeAnimal({ kind, family: m.family, area: 'yard' }, 0, 0), world())))]);
    for (const part of parts) assert.ok(m.clips[part], `${kind}: plays "${part}", which it has`);
    for (const part of Object.keys(m.clips)) assert.ok(parts.has(part) || (part.startsWith('flinch') && menu.includes('pet')), `${kind}: its "${part}" clip has a part`); // a pet wriggles one way or the other
    assert.ok(!habits.includes('dead'), `${kind}: plays dead only when asked`);
    assert.equal(habits.includes('headbutt'), ['bull', 'stag'].includes(kind), `${kind}: only the bull and the stag butt the air by themselves`);
    assert.equal(menu.includes('fetch'), ['husky', 'shiba'].includes(kind), `${kind}: only the dogs fetch`);
    const labels = menu.map(act => ACTS[act].label);
    assert.equal(new Set(labels).size, labels.length, `${kind}: a menu with no two the same`);
    assert.ok(menu.length >= 9 && labels.every(l => l && l.length <= 14), `${kind}: ${labels.join(', ')}`);
  }
});

test('antics: a command plays its steps in order, then the animal goes back to what it was doing', () => {
  const a = makeAnimal({ kind: 'horse', family: 'hooves', area: 'pasture', walk: 10, run: 40 }, 200, 100);
  command(a, 'run', world());
  assert.equal(a.act, 'run');
  const shown = [];
  for (let i = 0, seq = -1; i < 400 && a.act; i++) { advance(a, 0.05, world()); if (a.seq !== seq) { seq = a.seq; shown.push(a.part); } }
  assert.deepEqual(shown.slice(0, 4), ['run', 'leap', 'run', 'look'], 'out at a gallop, a leap, back, a look round');
  assert.ok(shown.length === 5 && ['idle', 'eat'].includes(shown[4]), `and rests there (standing or grazing): ${shown}`);
  assert.equal(a.act, null);
  assert.ok(Math.hypot(a.x - 200, a.y - 100) < 1, `home again: ${a.x}, ${a.y}`);
  // a new command drops the one under way
  command(a, 'hop', world());
  command(a, 'kick', world());
  assert.deepEqual(run(a, 3, world()).slice(0, 1), ['kick']);
});

test('antics: playing dead holds still a while, then it gets up and looks round; a pet makes it wriggle', () => {
  const a = makeAnimal({ kind: 'husky', family: 'paws', area: 'yard', walk: 10, run: 40 }, 50, 50);
  command(a, 'dead', world());
  advance(a, 0.05, world());
  assert.deepEqual([a.part, a.once, a.hold], ['dead', true, true], 'falls over and stays down');
  for (let i = 0; i < 60; i++) advance(a, 0.05, world()); // 3 s in: past the clip's 1 s, still down
  assert.equal(a.part, 'dead');
  const rest = run(a, 6, world());
  assert.deepEqual(rest.slice(0, 3), ['dead', 'idle', 'look'], 'up again, slowly');
  command(a, 'pet', world({ rand: () => 0.1 }));
  assert.ok(['flinchLeft', 'flinchRight'].includes(run(a, 1, world())[0]));
});

test('antics: fetch: the stick flies, the dog runs to it, brings it back and drops it at your feet', () => {
  const a = makeAnimal({ kind: 'shiba', family: 'paws', area: 'yard', walk: 10, run: 40 }, 50, 50);
  command(a, 'fetch', world());
  advance(a, 0.05, world());
  assert.ok(a.stick && !a.stick.held, 'thrown');
  const seen = { held: false };
  for (let i = 0; i < 400 && a.act; i++) { advance(a, 0.05, world()); if (a.stick?.held && !seen.held) { seen.held = true; seen.at = [a.x, a.y]; } }
  assert.ok(seen.held && seen.at[0] > 100, 'picked up out where it fell');
  assert.equal(a.stick, null, 'dropped once home');
  assert.ok(Math.hypot(a.x - 50, a.y - 50) < 1);
});

test('antics: left alone they walk, rest and now and then get up to something; at night they rest and only a command wakes one', () => {
  let r = 7;
  const rand = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const a = makeAnimal({ kind: 'donkey', family: 'hooves', area: 'pasture', walk: 10, run: 40 }, 100, 100, rand);
  const env = world({ rand, habitChance: 0.5, spot: () => [100 + rand() * 200, 100 + rand() * 60] });
  const acts = new Set();
  for (let i = 0; i < 20 * 600; i++) { advance(a, 0.05, env); if (a.act) acts.add(a.act); }
  assert.ok(acts.size >= 4, `10 minutes: ${[...acts].join(', ')}`);
  assert.ok(!acts.has('dead') && !acts.has('fetch'));
  const night = world({ resting: true, habitChance: 1 });
  const b = makeAnimal({ kind: 'cow', family: 'hooves', area: 'pasture', walk: 10, run: 40 }, 100, 100);
  run(b, 30, night);
  assert.deepEqual([b.part, b.timeScale, b.act], ['idle', 0.35, null], 'resting');
  command(b, 'feed', night);
  assert.deepEqual(run(b, 10, night).slice(0, 2), ['headlow', 'eat'], 'fed at night, it eats');
});
