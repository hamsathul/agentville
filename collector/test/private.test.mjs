import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPrivate, makePrivate, onlyAccount } from '../platform/private.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'agentville-priv-'));

test('a file made private is private by the platform\'s own measure (mode 0600 on Mac, owner-only ACL on Windows)', () => {
  const f = join(tmp(), 'token');
  writeFileSync(f, 'x');
  assert.equal(isPrivate(f), false, 'a freshly written file inherits access and must not already count as private');
  makePrivate(f);
  assert.equal(isPrivate(f), true);
});

test('a folder made private is private, and a file written inside it later is not left open', () => {
  const d = join(tmp(), 'secrets');
  mkdirSync(d);
  makePrivate(d);
  assert.equal(isPrivate(d), true);
  const f = join(d, 'later');
  writeFileSync(f, 'x');
  makePrivate(f);
  assert.equal(isPrivate(f), true);
});

test('making a missing path private throws instead of pretending it worked', () => {
  assert.throws(() => makePrivate(join(tmp(), 'nope')), /private|ENOENT|cannot/i);
});

test('isPrivate of a missing path is false, never an exception', () => {
  assert.equal(isPrivate(join(tmp(), 'nope')), false);
});

test('icacls output is read from the end of each line: the path it prints need not be the one it was given', () => {
  const b = String.fromCharCode(92);
  const me = `HOST1${b}someuser`;
  const done = '\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n';
  // given C:\Users\RUNNER~1\...\token, icacls prints the long path
  assert.equal(onlyAccount(`C:${b}Users${b}someuser${b}AppData${b}Temp${b}x${b}token ${me}:(F)\r\n${done}`, me), true);
  assert.equal(onlyAccount(`C:${b}Users${b}me${b}a folder${b}token ${me}:(OI)(CI)(F)\r\n${done}`, me), true, 'a space in the path');
  assert.equal(onlyAccount(`C:${b}x${b}token ${me}:(F)\r\n       NT AUTHORITY${b}SYSTEM:(F)\r\n${done}`, me), false, 'a second entry');
  assert.equal(onlyAccount(`C:${b}x${b}token BUILTIN${b}Administrators:(F)\r\n${done}`, me), false, 'another account');
  assert.equal(onlyAccount(`C:${b}x${b}token X${me}:(F)\r\n${done}`, me), false, 'an account that merely ends the same');
  assert.equal(onlyAccount('', me), false);
  assert.equal(onlyAccount(`C:${b}x${b}token ${me}:(F)\r\n${done}`, ''), false, 'no account to compare: not private');
});

// The CI runner's temp folders carry SYSTEM, Administrators and the user as explicit entries, which "/inheritance:r" leaves in place:
// "private" there needs the others taken off, not only the user added.
test('a folder that carries other accounts as explicit entries is private after makePrivate, and a stranger added is gone', { skip: process.platform !== 'win32' ? 'Windows only' : false }, () => {
  const sys32 = join(process.env.SystemRoot, 'System32', 'icacls.exe');
  const d = join(tmp(), 'secrets');
  mkdirSync(d);
  for (const sid of ['*S-1-5-32-545', '*S-1-1-0', '*S-1-5-18', '*S-1-5-32-544']) execFileSync(sys32, [d, '/grant', `${sid}:(OI)(CI)R`], { stdio: 'pipe' });
  assert.equal(isPrivate(d), false, 'the control: Users, Everyone, SYSTEM and Administrators can read it');
  makePrivate(d);
  assert.equal(isPrivate(d), true);
  const listed = execFileSync(sys32, [d], { encoding: 'utf8' });
  assert.ok(!/Everyone|BUILTIN|SYSTEM/i.test(listed), listed);
});
