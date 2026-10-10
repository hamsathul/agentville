// scripts/lib/worlds-dir.mjs: a malformed config.json falls back to the defaults, with one warning line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtInKeys, keyOf, worldsDir } from '../../scripts/lib/worlds-dir.mjs';

test("a world's key from its name: every built-in world by its folder's name, yours under u/", () => {
  assert.deepEqual(builtInKeys().sort(), ['factory', 'farm', 'starter'], 'the folders of web/worlds with a world.json (not sdk or test)');
  for (const key of ['farm', 'factory', 'starter', 'u/mine']) assert.equal(keyOf(key), key);
  assert.equal(keyOf('mine'), 'u/mine');
  assert.equal(keyOf('factory', ['farm']), 'u/factory', 'the built-in names can be given');
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
