import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPidAlive, readRegistry } from '../sources/registry.mjs';

test('keeps live sessions and drops dead pids, malformed files and other file names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-reg-'));
  writeFileSync(join(dir, '111.json'), JSON.stringify({ pid: 111, sessionId: 's1', cwd: '/w', name: 'one', kind: 'interactive', status: 'busy', version: '2.1.291' }));
  writeFileSync(join(dir, '222.json'), JSON.stringify({ pid: 222, sessionId: 's2' }));
  writeFileSync(join(dir, '333.json'), '{ broken');
  writeFileSync(join(dir, '111.abcdef.key'), 'secret');
  writeFileSync(join(dir, '2026-10-06-x-session.tmp'), 'x');
  const got = readRegistry(dir, pid => pid === 111);
  assert.deepEqual(got.map(r => r.sessionId), ['s1']);
  assert.equal(got[0].status, 'busy');
  assert.equal(got[0].name, 'one');
  assert.equal(got[0].version, '2.1.291');
});

test('a missing sessions folder reads as empty', () => {
  assert.deepEqual(readRegistry('/nonexistent/sessions'), []);
});

test('isPidAlive is true for this process', () => {
  assert.equal(isPidAlive(process.pid), true);
});

test('a session’s nameSource is kept, so a default name can be told from one you gave it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's1', name: 'app-9c', nameSource: 'derived' }));
  assert.equal(readRegistry(dir)[0].nameSource, 'derived');
});
