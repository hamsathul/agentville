// npm run check-world: the tour run headless against a world; exceptions with file and line, hooks left
// to defaults, checklist items drawn the same, outfit parts the kit lacks, creatures that break the kit's
// rules; never hangs.
import { NO_FILE_LINKS } from './win-links.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { RUNNER, plainLines, runContained, worldFiles } from '../../scripts/lib/contained.mjs';
import { RULES, checkWorld, creatureProblems, guardedGagCheck } from '../../scripts/lib/world-vm.mjs';

const fixture = n => fileURLToPath(new URL(`./fixtures/worlds/${n}`, import.meta.url));
const builtIn = n => fileURLToPath(new URL(`../../web/worlds/${n}`, import.meta.url));
/** npm run check-world, in a process of its own. */
const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-world.mjs', import.meta.url)), ...args], { encoding: 'utf8', timeout: 60_000 });

test('the starter passes clean', async () => {
  const r = await checkWorld({ dir: builtIn('starter') });
  assert.deepEqual(r.errors, []);
  assert.equal(r.json, null);
  assert.ok(r.ran >= 30, 'every stop ran');
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.creatures, [], 'its cat keeps the kit\'s rules');
  assert.deepEqual(r.notes, []);
});

test('the farm passes clean too', async () => {
  // a slow runner needs more than the 2 s a hook gets by default: the limit is what is tested elsewhere
  const r = await checkWorld({ dir: builtIn('farm'), timeoutMs: 20_000 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.creatures, [], 'its animals keep the kit\'s rules');
});

test("the factory's creatures pass clean: its robot dog, vacuum and cat, its gag and play, as the kit reads them", async () => {
  const r = await checkWorld({ dir: builtIn('factory'), timeoutMs: 20_000 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.creatures, [], 'no creature problem');
  assert.deepEqual(r.notes.filter(n => /creature|roam/.test(n)), [], 'no pointer about them either');
});

test('an exception is reported with its stop, and world.js with the line', async () => {
  const r = await checkWorld({ dir: fixture('throws') });
  const e = r.errors.find(x => x.stop === 'waiting');
  assert.ok(e, JSON.stringify(r.errors));
  assert.match(e.message, /no door here/);
  assert.match(e.where, /world\.js:\d+/);
});

test('an error the SDK throws for the world is reported at the world.js line that called it', async () => {
  const r = await checkWorld({ dir: fixture('sdk-misuse') });
  assert.ok(r.errors.length > 0, 'drawChar hands pixelOrigin a null');
  for (const e of r.errors) assert.match(e.where, /^world\.js:5(:\d+)?$/, JSON.stringify(e));
  const tmp = mkdtempSync(join(tmpdir(), 'check world ')); // a path with a space in it
  try {
    cpSync(fixture('sdk-misuse'), join(tmp, 'my world'), { recursive: true });
    const spaced = await checkWorld({ dir: join(tmp, 'my world') });
    assert.ok(spaced.errors.length > 0 && spaced.errors.every(e => /^world\.js:5(:\d+)?$/.test(e.where)), JSON.stringify(spaced.errors[0]));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('a hook that never returns is cut off and reported; the run finishes', { timeout: 30_000 }, async () => {
  const t0 = Date.now(), r = await checkWorld({ dir: fixture('loops'), timeoutMs: 300 });
  assert.ok(r.errors.some(e => /didn't return within 0.3 s \(a loop\?\), while \w+/.test(e.message)), JSON.stringify(r.errors));
  assert.ok(r.errors.every(e => !/world-vm|scripts/.test(e.where)), 'never a line of check-world\'s own');
  assert.ok(Date.now() - t0 < 60_000);
});

// These two run the command in a process of its own: the test runner takes a failing promise as its own test's
// failure, and tracks promises in a way that a promise callback cut off mid-run upsets.
test('promise callbacks that never end are cut off too', () => {
  const loop = run('promise-loop', '--worlds', fixture(''));
  assert.equal(loop.status, 1, loop.stdout + loop.stderr);
  assert.match(loop.stdout, /✗ everyone: a hook didn't return within 2 s \(a loop\?\), while starting/);
  assert.match(loop.stdout, /the rest of the tour was skipped/);
});

test('a failing promise is reported once a stop, with its line', () => {
  const r = run('rejects', '--worlds', fixture(''));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const everyone = r.stdout.split('\n').filter(l => l.includes('✗ everyone:'));
  assert.equal(everyone.length, 1, r.stdout);
  assert.match(everyone[0], /a promise failed: the ground went wrong \(world\.js:6:\d+\)/);
});

test("where a problem is from names world.js or the SDK's files only: a stack naming any other file gives no place", () => {
  const r = run('elsewhere', '--worlds', fixture(''));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const everyone = r.stdout.split('\n').filter(l => l.includes('✗ everyone:'));
  assert.deepEqual(everyone, ['  ✗ everyone: a promise failed: the ground went wrong'], r.stdout);
});

test('a world that never registers, or does not parse, is reported', async () => {
  assert.match((await checkWorld({ dir: fixture('silent') })).errors[0].message, /never registered/);
  const bad = (await checkWorld({ dir: fixture('bad-syntax') })).errors[0];
  assert.match(bad.message, /SyntaxError|Unexpected/);
  assert.match(bad.where, /world\.js:\d+/);
});

test('pointers: hooks left to defaults, deploys drawn the same, outfit parts the kit lacks', async () => {
  const same = await checkWorld({ dir: fixture('same-deploys') });
  assert.ok(same.same.some(s => /deploy failed/.test(s)), JSON.stringify(same.same));
  assert.ok(same.defaults.includes('labels') && same.defaults.includes('hud'));
  assert.deepEqual((await checkWorld({ dir: fixture('typo-outfit') })).unknown, ['hat:hardhatt']);
});

test('creatures: a kind the world has taken, a line over 40 characters, a single action', async () => {
  const taken = await checkWorld({ dir: fixture('taken-cat') });
  assert.ok(taken.creatures.some(s => /^cat: /.test(s) && /"taken"/.test(s)), JSON.stringify(taken.creatures));
  const long = await checkWorld({ dir: fixture('long-line') });
  assert.deepEqual(long.creatures, ['cat: lines.idle has a line of 41 characters (40 at most): "I knocked your coffee off the desk. Sorry"']);
  const one = await checkWorld({ dir: fixture('one-action') });
  assert.deepEqual(one.creatures, ['cat: 1 action in its menu; a creature has 2 to 4']);
  for (const r of [taken, long, one]) assert.deepEqual(r.errors, [], 'a creature problem is not an exception');
});

test('animals() may return { cast }: its creatures are checked as the plain list is', async () => {
  const list = await checkWorld({ dir: fixture('long-line') }), cast = await checkWorld({ dir: fixture('cast-object') });
  assert.equal(cast.creatures.length, 1);
  assert.deepEqual(cast.creatures, list.creatures);
});

test('the command: exit 0 for a clean world, 1 with a ✗ line for a creature problem; it says it runs contained', () => {
  const clean = run('starter');
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /✓ \d+ stops of the tour/);
  assert.match(clean.stdout, /· contained: it can read only the SDK and this world's world\.js and world\.json, and can't write or start programs \(it can still reach the network\)/);
  const bad = run('one-action', '--worlds', fixture(''));
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /✗ creatures: cat: 1 action in its menu/);
});

test("the command prints a world's words plain: no control sequence of the world's reaches your terminal", () => {
  const r = run('escapes', '--worlds', fixture(''));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const [name, out] of [['stdout', r.stdout], ['stderr', r.stderr]]) {
    assert.ok(!out.includes('\x1b'), `no ESC in ${name}: ${JSON.stringify(out)}`);
    assert.ok(!out.includes('\x07'), `no BEL in ${name}`);
    assert.ok(!/[\x80-\x9f]/.test(out), `no C1 control in ${name}`);
    assert.ok(!out.includes('\r'), `no carriage return in ${name}`);
  }
  const lines = r.stdout.split('\n');
  assert.ok(lines.includes('  ✗ everyone: Error2J: 2J ✓ clean'), 'what is left of the message is there, as plain text on its line');
  assert.ok(lines.includes('  ✗ creatures: cat: lines.purr2J is a list of lines'));
  assert.ok(lines.includes("  · outfit parts the people kit doesn't have (drawn as the default): hat:cap2J"));
});

test("what a contained run prints reaches you a line at a time through plain()", () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'check-world-'))), dir = join(tmp, 'world');
  try {
    mkdirSync(dir);
    writeFileSync(join(dir, 'world.js'), '// a world\n');
    const code = "process.stdout.write('one\\x1b]0;owned\\x07\\n\\x1b[2Jtwo\\r\\n'); process.stderr.write('three\\x9b2J\\n'); process.exitCode = 3;";
    const r = runContained(worldFiles(dir), ['-e', code]);
    assert.equal(r.status, 3, 'its exit code is kept');
    assert.equal(plainLines(r.stdout), 'one\ntwo\n');
    assert.equal(plainLines(r.stderr), 'three2J\n');
    assert.equal(plainLines(null), '');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

/* ---------- containment: the command's world code runs in a Node that may read only the check's files ---------- */

test("contained as the command runs a world: it reads the SDK and the world's two files, nothing else (not through a link in its folder), and writes and starts nothing", { skip: NO_FILE_LINKS }, () => {
  // Real paths throughout (macOS's temp folder is behind a link): Node judges a path as it is given.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'check-world-'))), outside = join(tmp, 'outside.txt'), target = join(tmp, 'written.txt'), dir = join(tmp, 'world');
  try {
    writeFileSync(outside, 'not for worlds');
    mkdirSync(dir);
    writeFileSync(join(dir, 'world.js'), '// a world\n');
    writeFileSync(join(dir, 'world.json'), '{ "name": "w", "api": 1 }\n');
    writeFileSync(join(dir, 'notes.txt'), "the world's own, but not a file the check reads");
    symlinkSync(outside, join(dir, 'peek')); // links in the world's folder, made here, never committed
    symlinkSync(tmp, join(dir, 'up'));
    const world = worldFiles(dir);
    // Plain Node, with exactly the flags and the empty environment the command gives its contained check.
    const code = `const fs = require('node:fs'), cp = require('node:child_process');
      const t = f => { try { f(); return 'allowed'; } catch (e) { return e.code ?? e.message; } };
      const read = p => t(() => fs.readFileSync(p));
      console.log(JSON.stringify({ sdk: read(${JSON.stringify(builtIn('sdk/engine.js'))}), js: read(${JSON.stringify(world.js)}), json: read(${JSON.stringify(world.json)}),
        notes: read(${JSON.stringify(join(dir, 'notes.txt'))}), peek: read(${JSON.stringify(join(dir, 'peek'))}), up: read(${JSON.stringify(join(dir, 'up', 'outside.txt'))}),
        outside: read(${JSON.stringify(outside)}), write: t(() => fs.writeFileSync(${JSON.stringify(target)}, 'x')), program: t(() => cp.spawnSync('ls')),
        env: Object.keys(process.env) }));`;
    const r = runContained(world, ['-e', code], { stdio: 'pipe' });
    assert.equal(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    for (const k of ['sdk', 'js', 'json']) assert.equal(got[k], 'allowed', k);
    for (const k of ['notes', 'peek', 'up', 'outside', 'write', 'program']) assert.equal(got[k], 'ERR_ACCESS_DENIED', k);
    // Windows adds its own base variables to any process (PATH, USERPROFILE, TEMP...): a Mac adds only its text encoding.
    const base = new Set(['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'PATH', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'OS', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'COMPUTERNAME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']);
    const ours = process.platform === 'win32' ? got.env.filter(k => !base.has(k.toUpperCase())) : got.env.filter(k => k !== '__CF_USER_TEXT_ENCODING'); // a Mac adds its text encoding
    assert.deepEqual(ours, [], `no environment of yours: ${got.env}`);
    if (process.platform !== 'win32') assert.ok(!got.env.includes('HOME') && !got.env.includes('PATH'));
    assert.equal(existsSync(target), false, 'nothing written');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("the command refuses a world whose world.js leads out of its folder, before starting anything; one inside it is fine", { skip: NO_FILE_LINKS }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'check-world-')), worlds = join(tmp, 'worlds');
  try {
    const starter = readFileSync(join(builtIn('starter'), 'world.js'), 'utf8'), json = '{ "name": "w", "api": 1 }\n';
    writeFileSync(join(tmp, 'elsewhere.js'), starter);
    mkdirSync(join(worlds, 'linked'), { recursive: true });
    writeFileSync(join(worlds, 'linked', 'world.json'), json);
    symlinkSync(join('..', '..', 'elsewhere.js'), join(worlds, 'linked', 'world.js')); // made here, never committed
    const out = run('linked', '--worlds', worlds);
    assert.equal(out.status, 1);
    assert.equal(out.stderr.trim(), "u/linked: world.js is a link to a file outside the world's folder: check-world won't run this world.");
    assert.equal(out.stdout, '', 'no check started');

    mkdirSync(join(worlds, 'inside', 'src'), { recursive: true });
    writeFileSync(join(worlds, 'inside', 'world.json'), json);
    writeFileSync(join(worlds, 'inside', 'src', 'main.js'), starter);
    symlinkSync(join('src', 'main.js'), join(worlds, 'inside', 'world.js'));
    const ok = run('inside', '--worlds', worlds);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /✓ 34 stops of the tour/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("worldFiles: each of the two files a regular file inside the folder's real path, or one line saying which", { skip: NO_FILE_LINKS }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'check-world-')), dir = join(tmp, 'w');
  try {
    mkdirSync(dir);
    assert.throws(() => worldFiles(dir), { message: 'world.js is missing.' });
    writeFileSync(join(dir, 'world.js'), '// a world\n');
    const real = realpathSync(dir);
    assert.deepEqual(worldFiles(dir), { dir: real, js: join(real, 'world.js'), json: join(real, 'world.json') }, 'no world.json: let through, for the check to report');
    symlinkSync(join(tmp, 'gone.json'), join(dir, 'world.json'));
    assert.throws(() => worldFiles(dir), { message: "world.json is a link to something that isn't there." });
    unlinkSync(join(dir, 'world.json'));
    writeFileSync(join(tmp, 'outside.json'), '{}');
    symlinkSync(join(tmp, 'outside.json'), join(dir, 'world.json'));
    assert.throws(() => worldFiles(dir), { message: "world.json is a link to a file outside the world's folder: check-world won't run this world." });
    unlinkSync(join(dir, 'world.json'));
    mkdirSync(join(dir, 'world.json'));
    assert.throws(() => worldFiles(dir), { message: "world.json isn't a file." });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('a contained run is started with env {}: it starts (also on Windows, where {} is not empty) and nothing of ours is passed on', () => {
  const was = process.env.AGENTVILLE_TEST_SECRET;
  process.env.AGENTVILLE_TEST_SECRET = 'not for a world';
  try {
    const world = worldFiles(fixture('throws'));
    const r = runContained(world, ['-e', 'console.log(JSON.stringify({ node: process.version, env: Object.keys(process.env) }))']);
    assert.equal(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    assert.equal(got.node, process.version, 'a Node of the same version ran it');
    assert.equal(got.env.includes('AGENTVILLE_TEST_SECRET'), false, 'nothing of ours is passed on');
    // Windows adds its own base variables (PATH, TEMP, USERPROFILE...) to any process: only what we hold is checked for
  } finally {
    if (was === undefined) delete process.env.AGENTVILLE_TEST_SECRET; else process.env.AGENTVILLE_TEST_SECRET = was;
  }
});

test('the contained half refuses to run unless it is contained', () => {
  const r = spawnSync(process.execPath, [RUNNER, 'starter', builtIn('starter')], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /runs a world only contained/);
  assert.equal(r.stdout, '', 'no check ran');
});

/* ---------- the creature rules, one by one (creatureProblems is pure: a world's animals() as plain data) ---------- */

const KINDS = ['cow', 'goat', 'sheepdog', 'ostrich', 'lion', 'tiger', 'duck', 'cat', 'dog', 'pigeon', 'mouse', 'fish'];
const cat = over => ({ kind: 'cat', actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', pose: 'eat' }], lines: { idle: ['mrrp.'], petted: ['purr'] }, ...over });
const rules = (creature, taken = []) => creatureProblems([creature], { kinds: KINDS, taken });

test('creature rules: a good cat has neither problems nor pointers', () => {
  assert.deepEqual(rules(cat()), { problems: [], pointers: [] });
});

test('creature rules: count is a whole number from 1 to 12', () => {
  for (const count of [0, 13, '3', 1.5]) assert.deepEqual(rules(cat({ count })).problems, [`cat: count is ${JSON.stringify(count)}: a whole number from 1 to 12`], String(count));
  for (const count of [1, 12]) assert.deepEqual(rules(cat({ count })).problems, []);
});

test("creature rules: looks are the kind's own (a pointer: an unknown one is drawn as the first)", () => {
  const duck = looks => ({ kind: 'duck', count: 2, looks, actions: [{ label: 'Feed bread', gather: true }, { label: 'Quack back' }] });
  assert.deepEqual(rules(duck(['drake', 'hen'])), { problems: [], pointers: [] });
  assert.deepEqual(rules(duck(['drake', 'hne'])), { problems: [], pointers: ['duck: look "hne" isn\'t one of the duck\'s (drake, hen, duckling): drawn as the drake'] });
  assert.deepEqual(rules(cat({ looks: ['tabby'] })).pointers, ['cat: look "tabby": the cat has no looks']);
  assert.deepEqual(rules(cat({ look: 'tabby' })).pointers, ['cat: look "tabby": the cat has no looks'], 'a single look too');
  assert.deepEqual(rules(cat({ looks: 'tabby' })).problems, ['cat: looks is a list, one look per creature']);
});

test('creature rules: an fx is one the engine draws (a pointer: an unknown one draws nothing)', () => {
  const r = rules(cat({ actions: [{ label: 'Pet', fx: 'sparkles' }, { label: 'Feed', fx: 'dust' }] }));
  assert.deepEqual(r, { problems: [], pointers: ['cat: action "Pet": fx "sparkles" isn\'t one of hearts, crumbs, dust: nothing is drawn'] });
});

test('creature rules: a pose is one the creature has (a pointer: an unknown one stands)', () => {
  const r = rules(cat({ actions: [{ label: 'Bath', pose: 'swim' }, { label: 'Feed', pose: 'eat' }] }));
  assert.deepEqual(r, { problems: [], pointers: ['cat: action "Bath": pose "swim" isn\'t one the cat has (stand, walk, run, eat, sleep, happy, yawn, startled, stretch, roll): it stands'] });
  assert.deepEqual(rules({ kind: 'duck', actions: [{ label: 'Bath', pose: 'swim' }, { label: 'Dive', pose: 'dabble' }] }), { problems: [], pointers: [] }, 'the duck swims');
  assert.deepEqual(rules(cat({ actions: [{ label: 'Wake', pose: 'yawn' }, { label: 'Tickle', pose: 'roll' }] })), { problems: [], pointers: [] }, 'every creature yawns and rolls');
});

test("creature rules: an action's line is a key of lines", () => {
  assert.deepEqual(rules(cat({ actions: [{ label: 'Pet', line: 'purred' }, { label: 'Feed' }] })).problems, ['cat: action "Pet": line "purred" isn\'t a key of lines']);
});

test('creature rules: home is { x, y, w, h } and bank a list of [x, y], in numbers', () => {
  assert.deepEqual(rules(cat({ home: { x: 1, y: 2, w: 3, h: 4 }, bank: [[1, 2], [3, 4]] })).problems, []);
  for (const home of [{ x: 1, y: 2, w: 3 }, [1, 2, 3, 4], { x: 1, y: 2, w: 3, h: '4' }]) assert.deepEqual(rules(cat({ home })).problems, ['cat: home is { x, y, w, h }, in numbers'], JSON.stringify(home));
  for (const bank of [[1, 2], [[1]], [[1, '2']], { x: 1 }]) assert.deepEqual(rules(cat({ bank })).problems, ['cat: bank is a list of [x, y]'], JSON.stringify(bank));
});

test('creature rules: the kind, the labels and the shapes', () => {
  assert.match(rules(cat({ kind: 'kat' })).problems[0], /^kat: no creature called "kat": the library has cow, /);
  assert.match(rules(cat({ kind: undefined })).problems[0], /^creature 1: no kind: the library has /);
  assert.deepEqual(rules(cat(), ['cat']).problems, ['cat: world.json\'s "taken" lists it: this world draws data in that shape, so its animals can\'t be one']);
  assert.deepEqual(rules(cat({ actions: [{ label: ' ' }, { label: 'Feed' }] })).problems, ['cat: action 1 has no label']);
  assert.deepEqual(rules(cat({ actions: Array.from({ length: 5 }, (_, i) => ({ label: `A${i}` })) })).problems, ['cat: 5 actions in its menu; a creature has 2 to 4']);
  assert.deepEqual(rules(cat({ lines: ['mrrp'] })).problems, ['cat: lines is { idle: [...], <key>: [...] }', 'cat: action "Pet": line "petted" isn\'t a key of lines']);
  assert.deepEqual(rules(null).problems, ['creature 1: not an object { kind, actions, lines, … }']);
  assert.deepEqual(creatureProblems({ cats: [] }, { kinds: KINDS }).problems, ['animals(): it returns a list of creatures, or { cast: [...] }']);
  assert.deepEqual(creatureProblems(null, { kinds: KINDS }), { problems: [], pointers: [] }, 'no animals: nothing to check');
});

test('creature rules: animals() without roam() is a pointer, not a problem', async () => {
  const r = await checkWorld({ dir: fixture('no-roam') });
  assert.deepEqual(r.creatures, []);
  assert.deepEqual(r.notes, ["no roam(): its creatures aren't shown"]);
  assert.deepEqual(r.errors, []);
});

test("creature rules: the copied lists match what creatures.js, animals.js and engine.js define (drift fails here, not a user's world)", () => {
  const src = f => readFileSync(builtIn(`sdk/${f}`), 'utf8'), lits = (s, re) => new Set([...s.matchAll(re)].map(m => m[1]));
  // fx: the engine's showFx
  assert.deepEqual(lits(src('engine.js'), /r\.fx === '(\w+)'/g), new Set(RULES.FX));
  // poses: every pose creatures.js and the kit name (POSE_AS: the ones every creature is drawn in as
  // another), and each creature's own beyond the common ones
  const creatures = src('creatures.js'), poseAs = Object.keys(vm.runInContext(`(${creatures.match(/const POSE_AS = (\{[^}]*\})/)[1]})`, vm.createContext({})));
  assert.ok(poseAs.length, 'creatures.js has its POSE_AS');
  const named = new Set([...lits(creatures, /pose === '(\w+)'/g), ...poseAs, ...lits(src('animals.js'), /pose(?: ===|:) '(\w+)'/g)]);
  assert.deepEqual(named, new Set([...RULES.POSES, ...Object.values(RULES.POSES_OF).flat()]));
  // Each creature's own draw, from the source: creatures.js wraps every draw (POSE_AS, what it wears), so
  // the draw it exports no longer reads as the creature's own.
  const lib = vm.runInContext(`${creatures}; CREATURES`, vm.createContext({ px() {} }));
  const body = creatures.slice(creatures.indexOf('const CREATURES = {'), creatures.indexOf('const POSE_AS'));
  const drawOf = Object.fromEntries(body.split(/^ {4}(?=\w+: \{ w: )/m).slice(1).map(s => [s.match(/^(\w+):/)[1], s]));
  assert.deepEqual(Object.keys(drawOf), Object.keys(lib), 'each creature found in the source');
  for (const [kind, draw] of Object.entries(drawOf)) {
    const own = [...lits(draw, /pose === '(\w+)'/g)].filter(p => !RULES.POSES.includes(p));
    assert.deepEqual(new Set(own), new Set((RULES.POSES_OF[kind] ?? RULES.POSES).filter(p => !RULES.POSES.includes(p) && !poseAs.includes(p))), `${kind}'s own poses`);
    assert.deepEqual(lits(draw, /look (?:===|!==|=) '(\w+)'/g), new Set(RULES.LOOKS_OF[kind] ?? []), `${kind}'s looks`);
  }
  assert.match(src('animals.js'), new RegExp(`LINE_MAX = ${RULES.LINE_MAX}\\b`));
});

/* ---------- gags and play: the kit's own gagProblem says what's written wrong, so check-world says it before the browser's console does ---------- */

const kitCtx = (() => { const ctx = vm.createContext({ console }); vm.runInContext(readFileSync(builtIn('sdk/animals.js'), 'utf8'), ctx); return ctx; })();
const POUNCE = { id: 'pounce', needs: { cat: 1 }, steps: [{ pose: 'cat', is: 'startled', ms: 600 }, { say: 'cat', line: 'idle' }] };
const gagRules = (world, spots = {}) => creatureProblems({ cast: [cat()], ...world }, { kinds: KINDS, gagProblem: kitCtx.gagProblem, spots });

test("gag rules: the guide's pounce gag, and a play with a farmer, are fine", () => {
  assert.deepEqual(gagRules({ gags: [POUNCE], play: [{ id: 'pet', needs: { farmer: 'idle', cat: 1 }, steps: [{ go: 'farmer', to: 'cat' }, { fx: 'hearts', at: 'cat' }] }] }), { problems: [], pointers: [] });
});

test("gag rules: one written wrong is a cross, with the kit's own reason", () => {
  const one = gag => gagRules({ gags: [gag] }).problems;
  assert.deepEqual(one({ id: 'a', steps: [{ wait: 1 }] }), ['gag a: its needs is not an object']);
  assert.deepEqual(one({ id: 'b', needs: { cat: 1 }, steps: 'wait' }), ['gag b: its steps are not a list']);
  assert.deepEqual(one({ id: 'c', needs: { cat: 1 }, steps: [{ dance: 'cat' }] }), ["gag c: it has a step it doesn't know (dance)"]);
  assert.deepEqual(one({ id: 'd', needs: { cat: 1 }, steps: [{ go: 'cat', to: 'dog' }] }), ["gag d: it has a role it wasn't cast (dog)"]);
  assert.deepEqual(one({ id: 'e', needs: { cat: 1, farmer: 'idle' }, steps: [{ chase: 'cat', after: 'farmer', ms: 100 }] }), ['gag e: only the farmer chases']);
  assert.deepEqual(one({ needs: { cat: 1 }, steps: [{ wait: 1 }] }), ['gag 1: it has no id']);
  assert.deepEqual(gagRules({ gags: [POUNCE, POUNCE] }).problems, ['gag pounce: another gag has the same id (a gag dropped drops both)']);
  assert.deepEqual(gagRules({ gags: { pounce: POUNCE } }).problems, ['animals(): gags is a list of gags']);
  assert.deepEqual(one({ ...POUNCE, lines: { idle: ['x'.repeat(41)] } }), [`gag pounce: lines.idle has a line of 41 characters (40 at most): "${'x'.repeat(41)}"`]);
});

test("gag rules: a spot the world's spots() doesn't have is a cross (the kit drops the gag, or it never starts)", () => {
  const nap = { id: 'nap', needs: { cat: 1, spot: 'basket' }, steps: [{ go: 'cat', to: 'spot:basket' }, { stay: 'cat', ms: 1000, while: 'spot:basket' }] };
  assert.deepEqual(gagRules({ gags: [nap] }).problems, ['gag nap: its spot "basket" isn\'t in spots()']);
  assert.deepEqual(gagRules({ gags: [nap] }, { basket: [10, 10] }).problems, []);
});

test('gag rules: pointers for what never happens: a kind the cast lacks, a play without a farmer, an unknown habit or reaction', () => {
  assert.deepEqual(gagRules({ gags: [{ id: 'moo', needs: { cow: 1 }, steps: [{ say: 'cow', line: 'idle' }] }] }).pointers, ['gag moo: it needs a cow, and the cast has none: it never starts']);
  assert.deepEqual(gagRules({ play: [{ ...POUNCE, id: 'solo' }] }).pointers, ['play solo: no farmer in its needs: it plays out like a gag']);
  const r = creatureProblems([cat({ habits: ['climb', 'juggle'], reacts: { deployFailed: 'faint', merged: null, harvest: 'hop' } })], { kinds: KINDS });
  assert.deepEqual(r, { problems: [], pointers: [`cat: habit "juggle" isn't one of ${RULES.HABITS.join(', ')}: it never does it`, `cat: reacts.deployFailed is "faint", not one of ${RULES.REACTS.join(', ')} (or null): it does nothing`] });
  assert.deepEqual(creatureProblems([cat({ habits: 'climb', reacts: ['hop'] })], { kinds: KINDS }).problems, ['cat: habits is a list', 'cat: reacts is { <event kind>: what }']);
});

test("check-world runs a world's gags through the kit: the fixture's spot that isn't there and its stray role are crosses", async () => {
  const r = await checkWorld({ dir: fixture('bad-gag') });
  assert.deepEqual(r.creatures, ['gag nap: its spot "basket" isn\'t in spots()', "gag stray: it has a role it wasn't cast (dog)"]);
  assert.deepEqual(r.errors, []);
});

test('the starter has a gag, and it passes', async () => {
  const src = readFileSync(builtIn('starter/world.js'), 'utf8');
  assert.match(src, /gags: \[\{ id: 'pounce'/);
  assert.deepEqual((await checkWorld({ dir: builtIn('starter') })).creatures, []);
});

test("gag rules: the copied habits and reactions match animals.js (drift fails here, not a user's world)", () => {
  const src = readFileSync(builtIn('sdk/animals.js'), 'utf8');
  assert.deepEqual(new Set(JSON.parse(src.match(/const HABITS = new Set\((\[[^\]]*\])\)/)[1].replaceAll("'", '"'))), new Set(RULES.HABITS));
  assert.deepEqual(new Set([...src.matchAll(/byWhat\('(\w+)'\)/g)].map(m => m[1])), new Set(RULES.REACTS));
});

test("a world that swaps the kit's gag check can't use it to hang or fool check-world: the kit's own, read before world.js, still finds its bad gags", async () => {
  const r = await checkWorld({ dir: fixture('fake-gag-check') });
  assert.deepEqual(r.creatures, ['gag nap: its spot "basket" isn\'t in spots()', "gag stray: it has a role it wasn't cast (dog)"]);
});

test("the kit's gag check is called as world code: under the timeout, and only a string comes back, on one line", () => {
  const ctx = vm.createContext({});
  vm.runInContext("globalThis.loop = () => { for (;;) {} }; globalThis.odd = () => ({ toString() { for (;;) {} } }); globalThis.many = () => 'two\\nlines \\u001b[31mred'; globalThis.fine = () => '';", ctx);
  const call = fn => { ctx.__job = fn; return vm.runInContext('__job()', ctx, { timeout: 200 }); };
  assert.equal(guardedGagCheck(ctx.loop, call)({ id: 'a' }), "check-world couldn't check it: the kit's check didn't return");
  assert.equal(guardedGagCheck(ctx.odd, call)({ id: 'a' }), 'it is written wrong');
  assert.equal(guardedGagCheck(ctx.many, call)({ id: 'a' }), 'two lines red');
  assert.equal(guardedGagCheck(ctx.fine, call)({ id: 'a' }), '');
  assert.equal(guardedGagCheck(undefined, call), null, 'no kit: no gag checks');
});

test("the starter draws several accounts (a meter for each), so check-world doesn't flag the item", async () => {
  const r = await checkWorld({ dir: builtIn('starter') });
  assert.ok(!r.same.some(s => s.includes('several accounts')), r.same.join('\n'));
});
