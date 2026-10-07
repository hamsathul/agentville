import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bashMode, bashTargets, collectTouches, touchesFromCall } from '../derive/touches.mjs';

const HOME = '/h';

test('bash targets come from cd, git -C, absolute and ~ paths, else the entry cwd', () => {
  assert.deepEqual(bashTargets('cd backend && git status', '/p', HOME), ['/p/backend']);
  assert.ok(bashTargets('git -C /p/frontend log', '/p', HOME).includes('/p/frontend'));
  assert.deepEqual(bashTargets('cat ~/notes.txt', '/p', HOME), ['/h/notes.txt']);
  assert.deepEqual(bashTargets('ls', '/p', HOME), ['/p']);
  assert.deepEqual(bashTargets('npm test', undefined, HOME), []);
  assert.ok(bashTargets('cd "/Users/a b/c" && ls', '/p', HOME).includes('/Users/a b/c'));
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
  assert.deepEqual(touchesFromCall({ name: 'Edit', input: { file_path: '/p/a.ts' } }, HOME), [{ path: '/p/a.ts', mode: 'write' }]);
  assert.deepEqual(touchesFromCall({ name: 'Read', input: { file_path: '~/x' } }, HOME), [{ path: '/h/x', mode: 'read' }]);
  assert.deepEqual(touchesFromCall({ name: 'Grep', input: { pattern: 'x' }, cwd: '/p' }, HOME), [{ path: '/p', mode: 'read' }]);
  assert.deepEqual(touchesFromCall({ name: 'Bash', input: { command: 'cd backend && git commit -m x' }, cwd: '/p' }, HOME), [{ path: '/p/backend', mode: 'git' }]);
  assert.deepEqual(touchesFromCall({ name: 'WebSearch', input: { query: 'x' } }, HOME), []);
});

test('collectTouches keeps the latest touch per path and mode inside the window', () => {
  const calls = [
    { name: 'Edit', input: { file_path: '/p/a.ts' }, at: 5 },
    { name: 'Edit', input: { file_path: '/p/a.ts' }, at: 10 },
    { name: 'Edit', input: { file_path: '/p/a.ts' }, at: 20 },
    { name: 'Read', input: { file_path: '/p/b.ts' }, at: 15 },
  ];
  const got = collectTouches(calls, 8, HOME);
  assert.deepEqual(got, [
    { path: '/p/a.ts', mode: 'write', firstAt: 10, lastAt: 20 },
    { path: '/p/b.ts', mode: 'read', firstAt: 15, lastAt: 15 },
  ]);
});

test('a > inside quotes is not a redirect, so read-only commands are not writes', () => {
  assert.equal(bashMode(`node -e 'if (a > 1) console.log(a)'`), 'read');
  assert.equal(bashMode(`jq 'select(.n > 1)' data.json`), 'read');
  assert.equal(bashMode('grep -c "a > b" notes.txt'), 'read');
  assert.equal(bashMode('echo "a > b" > out.txt'), 'write');
  assert.equal(bashMode(`printf '%s' x >> log.txt`), 'write');
});
