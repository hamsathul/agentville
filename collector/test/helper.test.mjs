import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAME_RE, cleanName, createHelper } from '../sources/helper.mjs';

const at = s => new Date(s).getTime();
function make(start = '2026-10-09T10:00:00') {
  const dir = mkdtempSync(join(tmpdir(), 'helper-'));
  let t = at(start);
  return { dir, helper: () => createHelper(dir, { now: () => t }), set: s => { t = at(s); } };
}

test('the helper starts off, with names unticked and a limit of 200; nothing may be called', () => {
  const { helper } = make();
  const h = helper();
  assert.deepEqual(h.view(), { on: false, uses: { names: false }, dailyLimit: 200, today: 0 });
  assert.match(h.canCall('names').error, /off/);
});

test('switching on records consent, needs a use ticked, and takes a limit of 1 to 2,000', () => {
  const { dir, helper } = make();
  const h = helper();
  assert.match(h.update({ on: true, uses: { names: false } }).error, /Tick at least one/);
  for (const dailyLimit of [0, 2001, 1.5, '50']) assert.equal(h.update({ on: true, uses: { names: true }, dailyLimit }).ok, false, String(dailyLimit));
  const r = h.update({ on: true, uses: { names: true }, dailyLimit: 50 });
  assert.deepEqual(r, { ok: true, helper: { on: true, uses: { names: true }, dailyLimit: 50, today: 0 } });
  assert.equal(h.settings().consentedAt, at('2026-10-09T10:00:00'));
  assert.deepEqual(h.canCall('names'), { ok: true });
  assert.equal(statSync(join(dir, 'helper.json')).mode & 0o777, 0o600);
  assert.equal(h.update({ on: false }).helper.on, false);
  assert.match(h.canCall('names').error, /off/);
  assert.equal(h.settings().consentedAt, at('2026-10-09T10:00:00'), 'switching off keeps when you first agreed');
});

test('the daily limit holds, persists across a restart, and resets on a new local day', () => {
  const { helper, set } = make();
  const h = helper();
  h.update({ on: true, uses: { names: true }, dailyLimit: 2 });
  h.count(); h.count();
  assert.match(h.canCall('names').error, /daily limit of 2/);
  assert.match(helper().canCall('names').error, /daily limit/, 'a restart remembers today’s count');
  set('2026-10-10T00:00:05');
  const next = helper();
  assert.deepEqual(next.canCall('names'), { ok: true });
  assert.equal(next.view().today, 0);
});

test('the last error is kept for the dialog; outcomes are kept per session', () => {
  const { dir, helper } = make();
  const h = helper();
  h.fail('model_not_found');
  assert.equal(h.view().lastError, 'model_not_found');
  h.record('s1', 'offered');
  h.record('s1', 'dismissed');
  assert.equal(helper().outcome('s1'), 'dismissed');
  assert.equal(h.outcome('s2'), undefined);
  assert.equal(JSON.parse(readFileSync(join(dir, 'names.json'), 'utf8')).s1.outcome, 'dismissed');
  assert.equal(statSync(join(dir, 'names.json')).mode & 0o777, 0o600);
});

test('what Haiku answers is cleaned into a short kebab name, or nothing', () => {
  assert.equal(cleanName('fix-login-bug'), 'fix-login-bug');
  assert.equal(cleanName('  "Name: Fix-Login Bug."  '), 'fix-login-bug');
  assert.equal(cleanName('`worlds_kit`\nThis session builds the worlds kit.'), 'worlds-kit', 'the first line only');
  assert.equal(cleanName('Café — résumé parser!!'), 'caf-r-sum-parser');
  assert.equal(cleanName('🚀🚀'), '');
  assert.equal(cleanName(''), '');
  assert.equal(cleanName(42), '');
  assert.equal(cleanName('a'.repeat(60)).length, 40);
  assert.equal(cleanName('this-is-a-very-long-name-that-goes-on-and-on-forever'), 'this-is-a-very-long-name-that-goes-on-an');
});

test('a name you type: letters, digits, spaces, dots, dashes, underscores; 1 to 60', () => {
  for (const ok of ['login-bug', 'Login bug v2', 'résumé_parser.v1', 'a']) assert.ok(NAME_RE.test(ok), ok);
  for (const bad of ['', 'x'.repeat(61), 'a;rm -rf ~', 'two\nlines', '🚀 launch', '$(id)']) assert.ok(!NAME_RE.test(bad), JSON.stringify(bad));
});
