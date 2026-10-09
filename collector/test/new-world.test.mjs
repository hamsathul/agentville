// npm run new-world: the starter copied into your worlds folder under a name, with that name in world.json;
// a taken or bad name is refused, and nothing is left half-made.
import { NO_FILE_LINKS } from './win-links.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newWorld, nextSteps } from '../../scripts/lib/new-world.mjs';
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

test('refuses a name that is taken (even by a broken link), and leaves it alone', { skip: NO_FILE_LINKS }, () => {
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

test("the next steps name the world as u/<name>, so a world called farm is yours and not the built-in one", () => {
  const steps = nextSteps({ dir: '/Users/you/.agentville/worlds/farm', name: 'farm', title: 'Farm', port: 7788 });
  assert.match(steps, /^ {2}3\. npm run check-world -- u\/farm$/m);
  assert.match(steps, /^ {2}4\. npm run world-shots -- u\/farm$/m);
  assert.match(steps, /http:\/\/localhost:7788\/worlds\/test\?world=u\/farm$/m);
  assert.match(steps, /World ▾ → Farm, among your worlds/);
  assert.ok(!steps.includes('--worlds'), 'no --worlds when none was given');
});

test('with --worlds, the next steps repeat it (quoted when it needs to be), and say the dashboard shows only your worlds folder', () => {
  const steps = nextSteps({ dir: '/tmp/my worlds/my-bakery', name: 'my-bakery', title: 'My bakery', worlds: '/tmp/my worlds', windows: false });
  assert.match(steps, /^ {2}3\. npm run check-world -- u\/my-bakery --worlds '\/tmp\/my worlds'$/m);
  assert.match(steps, /^ {2}4\. npm run world-shots -- u\/my-bakery --worlds '\/tmp\/my worlds'$/m);
  assert.match(steps, /show only your worlds folder/);
  assert.match(nextSteps({ dir: '/w/x', name: 'x', title: 'X', worlds: "/it's", windows: false }), /--worlds '\/it'\\''s'$/m);
  assert.match(nextSteps({ dir: '/w/x', name: 'x', title: 'X', worlds: '/w', windows: false }), /check-world -- u\/x --worlds \/w$/m);
});

test('on Windows the folder is left plain when it is plain (a backslash, a drive colon and a ~ of a short name are not special), else in double quotes', () => {
  const b = String.fromCharCode(92);
  assert.ok(nextSteps({ dir: `C:${b}w`, name: 'x', title: 'X', worlds: `C:${b}Users${b}RUNNER~1${b}worlds`, windows: true }).includes(`--worlds C:${b}Users${b}RUNNER~1${b}worlds\n`), 'a short 8.3 name');
  const plain = nextSteps({ dir: `C:${b}w${b}x`, name: 'x', title: 'X', worlds: `C:${b}Users${b}me${b}worlds`, windows: true });
  assert.ok(plain.includes(`check-world -- u/x --worlds C:${b}Users${b}me${b}worlds
`), plain);
  const spaced = nextSteps({ dir: `C:${b}w${b}x`, name: 'x', title: 'X', worlds: `C:${b}My Worlds`, windows: true });
  assert.ok(spaced.includes(`world-shots -- u/x --worlds "C:${b}My Worlds"
`), spaced);
  assert.ok(!spaced.includes("'"), 'single quotes mean nothing to cmd.exe');
});

test('the command, run with --worlds: it prints those steps, and the check-world it prints checks the new world', () => {
  const root = realpathSync(temp()), worlds = join(root, 'worlds');
  try {
    const script = n => fileURLToPath(new URL(`../../scripts/${n}.mjs`, import.meta.url));
    const made = spawnSync(process.execPath, [script('new-world'), 'farm', '--worlds', worlds], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(made.status, 0, made.stderr);
    assert.ok(made.stdout.startsWith(`Made Farm in ${join(worlds, 'farm')}.`), made.stdout);
    assert.ok(made.stdout.includes(`npm run check-world -- u/farm --worlds ${worlds}\n`), made.stdout);
    assert.ok(made.stdout.includes(`npm run world-shots -- u/farm --worlds ${worlds}\n`), made.stdout);
    const checked = spawnSync(process.execPath, [script('check-world'), 'u/farm', '--worlds', worlds], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.ok(checked.stdout.startsWith(`check-world: u/farm (${join(worlds, 'farm')})`), checked.stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a copy that fails half-way leaves nothing behind', () => {
  const root = temp(), worldsDir = join(root, 'worlds');
  try {
    assert.throws(() => newWorld({ name: 'half', worldsDir, starterDir: join(root, 'no-starter') }));
    assert.equal(existsSync(join(worldsDir, 'half')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
