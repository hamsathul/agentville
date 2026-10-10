// scripts/lib/worlds-dir.mjs: a malformed config.json falls back to the defaults, with one warning line;
// a world's key from what you typed (a built-in name wins over one of yours, and says so).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtInKeys, keyOf, worldsDir } from '../../scripts/lib/worlds-dir.mjs';

const script = name => fileURLToPath(new URL(`../../scripts/${name}.mjs`, import.meta.url));
const shadowLine = name => `There is a built-in world and one of yours named ${name}: checking the built-in. For yours, use u/${name}.`;

test("a world's key from its name: every built-in world by its folder's name, yours under u/", () => {
  assert.deepEqual(builtInKeys(), ['farm', 'factory', 'starter'], 'the folders of web/worlds with a world.json (not sdk or test), the farm first');
  for (const key of ['farm', 'factory', 'starter', 'u/mine']) assert.equal(keyOf(key), key);
  assert.equal(keyOf('mine'), 'u/mine');
  assert.equal(keyOf('factory', { builtIns: ['farm'] }), 'u/factory', 'the built-in names can be given');
});

test('a name both built in and yours: the built-in, and one line saying how to reach yours', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentville-keyof-'));
  try {
    mkdirSync(join(root, 'factory'));
    writeFileSync(join(root, 'farm'), 'a file, not a world');
    const said = [], warn = m => said.push(m);
    assert.equal(keyOf('factory', { userDir: root, warn }), 'factory');
    assert.deepEqual(said, [shadowLine('factory')]);
    assert.equal(keyOf('u/factory', { userDir: root, warn }), 'u/factory', 'yours, by u/');
    assert.equal(keyOf('farm', { userDir: root, warn }), 'farm', 'a file of that name is no world of yours');
    assert.equal(keyOf('starter', { userDir: root, warn }), 'starter');
    assert.equal(keyOf('mine', { userDir: root, warn }), 'u/mine');
    assert.equal(keyOf('factory', { userDir: join(root, 'missing'), warn }), 'factory', 'no worlds folder yet');
    assert.deepEqual(said, [shadowLine('factory')], 'said once, only for the name that is both');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check-world and world-shots: the usage names the built-in worlds; a shadowed name says so on stderr', () => {
  for (const name of ['check-world', 'world-shots']) {
    const r = spawnSync(process.execPath, [script(name)], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`Which world\\? npm run ${name} -- <farm \\| factory \\| starter \\| your folder>`), `${name}: ${r.stderr}`);
  }
  const root = mkdtempSync(join(tmpdir(), 'agentville-shadow-'));
  try {
    mkdirSync(join(root, 'starter'));
    const r = spawnSync(process.execPath, [script('check-world'), 'starter', '--worlds', root], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stderr.split('\n').includes(shadowLine('starter')), r.stderr);
    assert.match(r.stdout, /check-world: starter \(.*web\/worlds\/starter\)/, 'it checked the built-in');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a malformed config.json warns once and uses the defaults; a missing one is no error', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentville-worlds-dir-')), cfgPath = join(root, 'config.json');
  const warn = console.warn, warnings = [];
  console.warn = m => warnings.push(m);
  try {
    writeFileSync(cfgPath, '{ not json');
    const r = worldsDir(['node', 'x'], cfgPath);
    assert.equal(r.dir, join(homedir(), '.agentville', 'worlds'));
    assert.equal(r.cfg.port, 7777);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /config\.json/);
    assert.equal(worldsDir(['node', 'x', '--worlds', root], cfgPath).dir, root); // --worlds still wins
    assert.equal(warnings.length, 2);
    assert.equal(worldsDir(['node', 'x'], join(root, 'missing.json')).cfg.port, 7777);
    assert.equal(warnings.length, 2); // a missing file says nothing
  } finally { console.warn = warn; rmSync(root, { recursive: true, force: true }); }
});
