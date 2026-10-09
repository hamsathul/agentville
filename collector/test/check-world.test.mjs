// npm run check-world: the tour run headless against a world; exceptions with file and line, hooks left
// to defaults, checklist items drawn the same, outfit parts the kit lacks, creatures that break the kit's
// rules; never hangs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkWorld } from '../../scripts/lib/world-vm.mjs';

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
  const r = await checkWorld({ dir: builtIn('farm') });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.creatures, [], 'its animals keep the kit\'s rules');
});

test('an exception is reported with its stop, and world.js with the line', async () => {
  const r = await checkWorld({ dir: fixture('throws') });
  const e = r.errors.find(x => x.stop === 'waiting');
  assert.ok(e, JSON.stringify(r.errors));
  assert.match(e.message, /no door here/);
  assert.match(e.where, /world\.js:\d+/);
});

test('a hook that never returns is cut off and reported; the run finishes', async () => {
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

test('the command: exit 0 for a clean world, 1 with a ✗ line for a creature problem', () => {
  const clean = run('starter');
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /✓ \d+ stops of the tour/);
  const bad = run('one-action', '--worlds', fixture(''));
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /✗ creatures: cat: 1 action in its menu/);
});
