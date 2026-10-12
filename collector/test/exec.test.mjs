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
    const r = await run(process.execPath, ['-e', 'process.stdout.write(String("AGENTVILLE_TEST_UNSET" in process.env))'], { env: { AGENTVILLE_TEST_UNSET: undefined } });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'false');
  } finally {
    delete process.env.AGENTVILLE_TEST_UNSET;
  }
});

// Node 24 will not spawn a .cmd directly (EINVAL), and npm installs claude as claude.cmd. run() goes through cmd.exe for those
// and refuses any argument cmd.exe would read as syntax, so an argument can never become a command.
const winOnly = { skip: process.platform !== 'win32' ? 'Windows only' : false };

test('a .cmd file runs on Windows and its arguments arrive intact', winOnly, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'agentville-cmd-'));
  const bin = join(dir, 'tool.cmd');
  writeFileSync(bin, '@echo off\r\necho [%1] [%2]\r\n');
  const r = await run(bin, ['--rewind-files', 'abc-123']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\[--rewind-files\] \[abc-123\]/);
});

test('an argument cmd.exe would read as syntax is refused, and nothing runs', winOnly, async () => {
  const { mkdtempSync, writeFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'agentville-cmd-'));
  const bin = join(dir, 'tool.cmd');
  const marker = join(dir, 'ran');
  writeFileSync(bin, '@echo off\r\necho x\r\n');
  for (const bad of ['a & echo pwned > ' + marker, 'a | b', 'a > ' + marker, '%PATH%', 'a^b', 'say "hi"', 'x\ny']) {
    const r = await run(bin, [bad]);
    assert.notEqual(r.code, 0, `should refuse: ${bad}`);
    assert.match(r.stderr, /refused/i);
  }
  assert.equal(existsSync(marker), false, 'no argument became a command');
});

test('a program that reads its input gets the end of it at once, not a pipe nobody closes', async () => {
  const t0 = Date.now();
  const r = await run(process.execPath, ['-e', "let n = 0; process.stdin.on('data', d => { n += d.length; }).on('end', () => process.stdout.write('eof ' + n));"], { timeoutMs: 8000 });
  assert.equal(r.stdout, 'eof 0', r.stderr);
  assert.ok(Date.now() - t0 < 6000, 'it did not wait for the timeout');
});
