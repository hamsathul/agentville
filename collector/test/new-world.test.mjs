// npm run new-world: the starter copied into your worlds folder under a name, with that name in world.json;
// a taken or bad name is refused, and nothing is left half-made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newWorld } from '../../scripts/lib/new-world.mjs';
import { checkWorldJson, makeWorlds } from '../worlds.mjs';

const starterDir = fileURLToPath(new URL('../../web/worlds/starter', import.meta.url));
const temp = () => mkdtempSync(join(tmpdir(), 'agentville-new-world-'));

test('copies the starter, with the name in world.json, and the world lists without an error', () => {
  const root = temp(), worldsDir = join(root, 'worlds'); // not there yet: made
  try {
    const { dir, title } = newWorld({ name: 'my-bakery', worldsDir, starterDir });
    assert.equal(dir, join(worldsDir, 'my-bakery'));
    assert.equal(title, 'My bakery');
    assert.deepEqual(readdirSync(dir).sort(), readdirSync(starterDir).sort());
    const j = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
    assert.equal(j.name, 'My bakery');
    assert.equal(checkWorldJson(j), null);
    assert.equal(readFileSync(join(dir, 'world.js'), 'utf8'), readFileSync(join(starterDir, 'world.js'), 'utf8'));
    const listed = makeWorlds({ builtinDir: join(root, 'none'), userDir: worldsDir }).list().find(w => w.key === 'u/my-bakery');
    assert.ok(listed && !listed.error, listed?.error);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses a name that is taken (even by a broken link), and leaves it alone', () => {
  const root = temp();
  try {
    mkdirSync(join(root, 'mine'));
    writeFileSync(join(root, 'mine', 'note.txt'), 'keep me');
    assert.throws(() => newWorld({ name: 'mine', worldsDir: root, starterDir }), /already exists/);
    assert.equal(readFileSync(join(root, 'mine', 'note.txt'), 'utf8'), 'keep me');
    symlinkSync(join(root, 'nowhere'), join(root, 'dangling'));
    assert.throws(() => newWorld({ name: 'dangling', worldsDir: root, starterDir }), /already exists/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses a bad name, and a worlds folder that is a file; makes nothing', () => {
  const root = temp();
  try {
    for (const name of ['', 'My World', '../escape', '-dash', 'a'.repeat(41), 'u/x']) assert.throws(() => newWorld({ name, worldsDir: root, starterDir }), /lowercase letters, digits and dashes/, name);
    assert.deepEqual(readdirSync(root), []);
    writeFileSync(join(root, 'file'), '');
    assert.throws(() => newWorld({ name: 'ok', worldsDir: join(root, 'file'), starterDir }), /not a folder/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a copy that fails half-way leaves nothing behind', () => {
  const root = temp(), worldsDir = join(root, 'worlds');
  try {
    assert.throws(() => newWorld({ name: 'half', worldsDir, starterDir: join(root, 'no-starter') }));
    assert.equal(existsSync(join(worldsDir, 'half')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
