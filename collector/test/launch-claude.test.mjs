import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAUNCHER = join(dirname(fileURLToPath(import.meta.url)), '..', 'platform', 'launch-claude.mjs');
const B = String.fromCharCode(92);
const ECHO = ['-e', 'console.log(JSON.stringify([process.cwd(), ...process.argv.slice(1)]))', '--'];

function launch(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-launch-'));
  const file = join(dir, 'spec.json');
  writeFileSync(file, JSON.stringify(spec));
  const r = spawnSync(process.execPath, [LAUNCHER, file], { encoding: 'utf8' });
  return { ...r, file, dir };
}

test('every argument arrives as one argument, whatever it holds (quotes, a trailing backslash, ; $( ) %, spaces, a newline)', () => {
  const args = [`say "hi" there`, `ends with backslash${B}`, 'a; calc', '$(whoami)', '%PATH%', 'x y', 'line1\nline2', `C:${B}Program Files${B}x`];
  const dir = mkdtempSync(join(tmpdir(), 'agentville-cwd-'));
  const r = launch({ claude: process.execPath, cwd: dir, args: [...ECHO, ...args] });
  assert.equal(r.status, 0, r.stderr);
  const [cwd, ...got] = JSON.parse(r.stdout);
  assert.deepEqual(got, args);
  // macOS reports a temp folder through its /private symlink, so compare the real folders
  assert.equal(realpathSync(cwd).toLowerCase(), realpathSync(dir).toLowerCase(), 'started in the session\'s folder');
});

test('the prefill file\'s text arrives as ONE --prefill argument, and the spec file is gone afterwards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-pre-'));
  const pre = join(dir, 'prompt.txt');
  writeFileSync(pre, 'Fix the "login" bug; then run $(x)\nand stop.');
  const r = launch({ claude: process.execPath, cwd: dir, args: ECHO, prefillFile: pre });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).slice(1), ['--prefill', 'Fix the "login" bug; then run $(x)\nand stop.']);
  assert.equal(existsSync(r.file), false, 'a spec is used once');
});

test('a spec that is wrong is refused with a reason and nothing is started', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-bad-'));
  const marker = join(dir, 'ran');
  const echoMarker = ['-e', `require('fs').writeFileSync(${JSON.stringify(marker.split(B).join('/'))}, 'x')`];
  for (const bad of [
    { claude: process.execPath, cwd: dir, args: [...echoMarker, 5] },
    { claude: process.execPath, cwd: dir, args: 'not-a-list' },
    { claude: process.execPath, cwd: join(dir, 'missing'), args: echoMarker },
    { claude: join(dir, 'no-such-claude.exe'), cwd: dir, args: echoMarker },
    { cwd: dir, args: echoMarker },
  ]) {
    const r = launch(bad);
    assert.notEqual(r.status, 0, JSON.stringify(bad).slice(0, 80));
    assert.match(r.stderr, /^launch refused:/m);
  }
  assert.equal(existsSync(marker), false, 'nothing ran');
});

test('a missing or unreadable spec file is a refusal, not a crash with a stack trace', () => {
  const r = spawnSync(process.execPath, [LAUNCHER, join(tmpdir(), 'agentville-no-such-spec.json')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /refused/i);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
});

const SHOW_ENV = ['-e', 'console.log(JSON.stringify(process.env.CLAUDE_CONFIG_DIR ?? null))'];

test('an account is a CLAUDE_CONFIG_DIR in the environment of the session: set for another account, removed for the first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-acct-'));
  const other = join(dir, '.claude-zeta');
  const set = launch({ claude: process.execPath, cwd: dir, args: SHOW_ENV, env: { CLAUDE_CONFIG_DIR: other } });
  assert.equal(set.status, 0, set.stderr);
  assert.equal(JSON.parse(set.stdout), other);
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(dir, 'inherited');
  try {
    const unset = launch({ claude: process.execPath, cwd: dir, args: SHOW_ENV, env: { CLAUDE_CONFIG_DIR: null } });
    assert.equal(unset.status, 0, unset.stderr);
    assert.equal(JSON.parse(unset.stdout), null, 'the first account runs with the variable removed');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

test('only CLAUDE_CONFIG_DIR may be set from a spec: any other variable, or a value that is not a path, is refused and nothing runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-envbad-'));
  for (const env of [{ PATH: 'x' }, { NODE_OPTIONS: '--require x' }, { CLAUDE_CONFIG_DIR: 5 }, { CLAUDE_CONFIG_DIR: '' }, { CLAUDE_CONFIG_DIR: 'relative/dir' }, 'CLAUDE_CONFIG_DIR=x', ['CLAUDE_CONFIG_DIR']]) {
    const r = launch({ claude: process.execPath, cwd: dir, args: SHOW_ENV, env });
    assert.notEqual(r.status, 0, JSON.stringify(env));
    assert.match(r.stderr, /^launch refused:/m);
    assert.equal(r.stdout, '', 'nothing ran');
  }
});
