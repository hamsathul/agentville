import { test } from 'node:test';
import assert from 'node:assert/strict';
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
