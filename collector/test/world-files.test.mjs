import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FRAME_CSP, makeWorlds } from '../worlds.mjs';

function builtins() {
  const dir = mkdtempSync(join(tmpdir(), 'worlds-'));
  mkdirSync(join(dir, 'sdk'));
  writeFileSync(join(dir, 'sdk', 'frame.html'), '<title>__TITLE__</title><script src="__BASE__world.js"></script>');
  writeFileSync(join(dir, 'sdk', 'bridge.js'), '1');
  mkdirSync(join(dir, 'farm', 'art'), { recursive: true });
  writeFileSync(join(dir, 'farm', 'world.json'), JSON.stringify({ name: 'The <farm>', icon: '🌾', api: 1 }));
  writeFileSync(join(dir, 'farm', 'world.js'), 'Agentville.world({})');
  writeFileSync(join(dir, 'farm', 'art', 'barn.png'), 'png');
  writeFileSync(join(dir, 'farm', '.secret.js'), 'no');
  writeFileSync(join(dir, 'farm', 'run.sh'), 'no');
  symlinkSync('/etc/hosts', join(dir, 'farm', 'leak.js'));
  mkdirSync(join(dir, 'starter'));
  writeFileSync(join(dir, 'starter', 'world.json'), '{}');
  return dir;
}

test("a world's own files are served, typed; nothing outside its folder, hidden, of an unknown kind, or linked out", () => {
  const w = makeWorlds({ builtinDir: builtins() });
  assert.equal(w.file('farm', 'world.js').type, 'text/javascript; charset=utf-8');
  assert.equal(w.file('farm', 'art/barn.png').type, 'image/png');
  assert.equal(w.file('sdk', 'bridge.js').size, 1);
  for (const [key, rel] of [['farm', '../sdk/bridge.js'], ['farm', 'art/../../sdk/bridge.js'], ['farm', '.secret.js'], ['farm', 'run.sh'], ['farm', 'leak.js'], ['farm', 'nope.js'], ['farm', 'art'], ['sdk', 'frame.html'], ['starter', 'world.json'], ['../farm', 'world.js'], ['FARM', 'world.js'], ['u', 'world.js']]) {
    assert.equal(w.file(key, rel).status, 404, `${key}/${rel}`);
  }
});

test("a world's frame page: the SDK's template with its name (escaped) and its own address; none for an unknown world", () => {
  const w = makeWorlds({ builtinDir: builtins() });
  assert.equal(w.frame('farm'), '<title>The &lt;farm&gt;</title><script src="/world/farm/world.js"></script>');
  assert.equal(w.frame('nope'), null);
  assert.equal(w.frame('sdk'), null);
  assert.equal(w.frame('starter'), null);
});

test("a world.json that is a link to a file outside its folder is not read: no frame, no file", () => {
  const dir = builtins();
  const outside = join(mkdtempSync(join(tmpdir(), 'outside-')), 'x.json');
  writeFileSync(outside, JSON.stringify({ name: 'LEAKED-NAME' }));
  mkdirSync(join(dir, 'linky'));
  symlinkSync(outside, join(dir, 'linky', 'world.json'));
  const w = makeWorlds({ builtinDir: dir });
  assert.equal(w.frame('linky'), null);
  assert.equal(w.info('linky'), null);
  assert.equal(w.file('linky', 'world.json').status, 404);
});

test('the frame runs sandboxed, its scripts from the dashboard only, and can reach nothing', () => {
  for (const part of ['sandbox allow-scripts', "default-src 'none'", "script-src 'self'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "frame-ancestors 'self'"]) assert.ok(FRAME_CSP.includes(part), part);
  assert.ok(!/allow-same-origin|allow-popups|allow-top-navigation|allow-forms/.test(FRAME_CSP));
});
