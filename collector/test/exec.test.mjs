import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../lib/exec.mjs';

test('returns stdout and code 0 on success', async () => {
  const r = await run(process.execPath, ['-e', 'process.stdout.write("hi")']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'hi');
});

test('returns the exit code on failure without throwing', async () => {
  const r = await run(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(r.code, 3);
});

test('a missing binary resolves with a non-zero code', async () => {
  const r = await run('/nonexistent/binary-xyz', []);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /ENOENT/);
});

test('env is merged over process.env', async () => {
  const r = await run(process.execPath, ['-e', 'process.stdout.write(process.env.TRACKER_X + ":" + (process.env.PATH ? "path" : "none"))'], { env: { TRACKER_X: 'y' } });
  assert.equal(r.stdout, 'y:path');
});

test('an undefined variable is left out of the child environment', async () => {
  process.env.AGENTVILLE_TEST_UNSET = 'set';
  try {
    const r = await run('/usr/bin/env', [], { env: { AGENTVILLE_TEST_UNSET: undefined } });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /AGENTVILLE_TEST_UNSET/);
  } finally {
    delete process.env.AGENTVILLE_TEST_UNSET;
  }
});
