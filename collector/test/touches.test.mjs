import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from 'node:path';
import { bashMode, bashTargets, collectTouches, touchesFromCall } from '../derive/touches.mjs';

// Fixture paths are written POSIX-style; on Windows they get a drive so they are absolute there too.
const P = p => normalize(process.platform === 'win32' ? `C:${p}` : p);

const HOME = P('/h');

test('bash targets come from cd, git -C, absolute and ~ paths, else the entry cwd', () => {
  assert.deepEqual(bashTargets('cd backend && git status', P('/p'), HOME), [P('/p/backend')]);
  assert.ok(bashTargets('git -C /p/frontend log', P('/p'), HOME).includes(P('/p/frontend')));
  assert.deepEqual(bashTargets('cat ~/notes.txt', P('/p'), HOME), [P('/h/notes.txt')]);
  assert.deepEqual(bashTargets('ls', P('/p'), HOME), [P('/p')]);
  assert.deepEqual(bashTargets('npm test', undefined, HOME), []);
  assert.ok(bashTargets('cd "/Users/a b/c" && ls', P('/p'), HOME).includes(P('/Users/a b/c')));
});

test('bash mode: mutating git commands, writes, and reads', () => {
  assert.equal(bashMode('git commit -m x'), 'git');
  assert.equal(bashMode('cd b && git -C /x push origin main'), 'git');
  assert.equal(bashMode('git status'), 'read');
  assert.equal(bashMode('git log | head'), 'read');
  assert.equal(bashMode('echo x > out.txt'), 'write');
  assert.equal(bashMode('npm test 2>&1 | tail'), 'read');
  assert.equal(bashMode('cmd > /dev/null 2>&1'), 'read');
  assert.equal(bashMode("sed -i '' s/a/b/ f"), 'write');
  assert.equal(bashMode('rm -rf dist && npm run build'), 'write');
  assert.equal(bashMode('node -e "a => a"'), 'read');
});

test('file tools map to read/write touches', () => {
  assert.deepEqual(touchesFromCall({ name: 'Edit', input: { file_path: P('/p/a.ts') } }, HOME), [{ path: P('/p/a.ts'), mode: 'write' }]);
  assert.deepEqual(touchesFromCall({ name: 'Read', input: { file_path: '~/x' } }, HOME), [{ path: P('/h/x'), mode: 'read' }]);
  assert.deepEqual(touchesFromCall({ name: 'Grep', input: { pattern: 'x' }, cwd: P('/p') }, HOME), [{ path: P('/p'), mode: 'read' }]);
  assert.deepEqual(touchesFromCall({ name: 'Bash', input: { command: 'cd backend && git commit -m x' }, cwd: P('/p') }, HOME), [{ path: P('/p/backend'), mode: 'git' }]);
  assert.deepEqual(touchesFromCall({ name: 'WebSearch', input: { query: 'x' } }, HOME), []);
});

test('collectTouches keeps the latest touch per path and mode inside the window', () => {
  const calls = [
    { name: 'Edit', input: { file_path: P('/p/a.ts') }, at: 5 },
    { name: 'Edit', input: { file_path: P('/p/a.ts') }, at: 10 },
    { name: 'Edit', input: { file_path: P('/p/a.ts') }, at: 20 },
    { name: 'Read', input: { file_path: P('/p/b.ts') }, at: 15 },
  ];
  const got = collectTouches(calls, 8, HOME);
  assert.deepEqual(got, [
    { path: P('/p/a.ts'), mode: 'write', firstAt: 10, lastAt: 20 },
    { path: P('/p/b.ts'), mode: 'read', firstAt: 15, lastAt: 15 },
  ]);
});

test('a > inside quotes is not a redirect, so read-only commands are not writes', () => {
  assert.equal(bashMode(`node -e 'if (a > 1) console.log(a)'`), 'read');
  assert.equal(bashMode(`jq 'select(.n > 1)' data.json`), 'read');
  assert.equal(bashMode('grep -c "a > b" notes.txt'), 'read');
  assert.equal(bashMode('echo "a > b" > out.txt'), 'write');
  assert.equal(bashMode(`printf '%s' x >> log.txt`), 'write');
});

// The drive forms are turned into one native path only on Windows (touches.mjs); on a Mac a C: path is not absolute there.
test('a rooted path with no drive is on the drive of the command\'s own folder, not of this process', { skip: process.platform !== 'win32' ? 'Windows only' : false }, () => {
  const b = String.fromCharCode(92);
  const got = bashTargets('git -C /p/frontend log', `Z:${b}p`, `Z:${b}h`);
  assert.ok(got.includes(`Z:${b}p${b}frontend`), got.join(' | '));
});

test('a Windows drive path in a shell command counts as a target, with either separator', { skip: process.platform !== 'win32' ? 'Windows only' : false }, () => {
  const b = String.fromCharCode(92);
  const want = normalize('C:/work/app/a.txt');
  assert.ok(bashTargets(`type C:${b}work${b}app${b}a.txt`, undefined, 'C:/h').includes(want), 'backslash form');
  assert.ok(bashTargets('cat C:/work/app/a.txt', undefined, 'C:/h').includes(want), 'forward-slash form');
  assert.deepEqual(bashTargets('echo hi', undefined, 'C:/h'), []);
});

test('~ expands to the home folder in one native form, with either separator after it', () => {
  const b = String.fromCharCode(92);
  assert.deepEqual(bashTargets('cat ~/notes.txt', undefined, P('/h')), [P('/h/notes.txt')]);
  assert.equal(touchesFromCall({ name: 'Read', input: { file_path: `~${b}x` } }, P('/h'))[0].path, P('/h/x'));
});
