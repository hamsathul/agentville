import { test } from 'node:test';
import { assertPrivate } from './support.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  assert.deepEqual(h.view(), { on: false, uses: { names: false, lines: false }, dailyLimit: 200, today: 0 });
  assert.match(h.canCall('names').error, /off/);
});

test('switching on records consent, needs a use ticked, and takes a limit of 1 to 2,000', () => {
  const { dir, helper } = make();
  const h = helper();
  assert.match(h.update({ on: true, uses: { names: false } }).error, /Tick at least one/);
  for (const dailyLimit of [0, 2001, 1.5, '50']) assert.equal(h.update({ on: true, uses: { names: true }, dailyLimit }).ok, false, String(dailyLimit));
  const r = h.update({ on: true, uses: { names: true }, dailyLimit: 50 });
  assert.deepEqual(r, { ok: true, helper: { on: true, uses: { names: true, lines: false }, dailyLimit: 50, today: 0 } });
  assert.equal(h.settings().consentedAt, at('2026-10-09T10:00:00'));
  assert.deepEqual(h.canCall('names'), { ok: true });
  assertPrivate(join(dir, 'helper.json'), 0o600);
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
  assertPrivate(join(dir, 'names.json'), 0o600);
});

test('what Haiku answers is cleaned into a short kebab name, or nothing', () => {
  assert.equal(cleanName('fix-login-bug'), 'fix-login-bug');
  assert.equal(cleanName('  "Name: Fix-Login Bug."  '), 'fix-login-bug');
  assert.equal(cleanName('`worlds_kit`\nThis session builds the worlds kit.'), 'worlds-kit', 'the first line only');
  assert.equal(cleanName('Café — résumé parser!!'), 'cafe-resume-parser', 'accents kept as their letters');
  assert.equal(cleanName("Here's a name:\nfix-login-bug"), 'fix-login-bug', 'a preamble line, the name below it');
  assert.equal(cleanName('Suggested name: login-bug'), 'login-bug', 'a label before the name');
  assert.equal(cleanName('Name:\nfix-login-bug'), 'fix-login-bug');
  assert.equal(cleanName('This session is about fixing the login bug in the app'), '', 'a sentence is not a name');
  assert.equal(cleanName('worlds-platform-integration-tests-for-farm'), 'worlds-platform-integration-tests-for', 'cut at a dash, never mid-word');
  assert.equal(cleanName('🚀🚀'), '');
  assert.equal(cleanName(''), '');
  assert.equal(cleanName(42), '');
  assert.equal(cleanName('a'.repeat(60)).length, 40);
  assert.equal(cleanName('this-is-a-very-long-name-that-goes-on-and-on-forever'), '', 'eleven words: a sentence, not a name');
});

test('a name you type: letters, digits, spaces, dots, dashes, underscores; 1 to 60', () => {
  for (const ok of ['login-bug', 'Login bug v2', 'résumé_parser.v1', 'a']) assert.ok(NAME_RE.test(ok), ok);
  for (const bad of ['', 'x'.repeat(61), 'a;rm -rf ~', 'two\nlines', '🚀 launch', '$(id)']) assert.ok(!NAME_RE.test(bad), JSON.stringify(bad));
});

test('a damaged helper.json or names.json never stops the collector: the defaults stand in', () => {
  const { dir, helper } = make();
  for (const bad of ['null', '[1,2]', '"text"', '{"on":"yes","dailyLimit":"lots","uses":"all","today":null}']) {
    writeFileSync(join(dir, 'helper.json'), bad);
    writeFileSync(join(dir, 'names.json'), bad);
    const h = helper();
    assert.deepEqual(h.view(), { on: false, uses: { names: false, lines: false }, dailyLimit: 200, today: 0 }, bad);
    assert.equal(h.outcome('s1'), undefined, bad);
    assert.match(h.canCall('names').error, /off/, bad);
  }
});

test('a good answer clears the last error', () => {
  const { helper } = make();
  const h = helper();
  h.fail('model_not_found');
  h.ok();
  assert.equal(h.view().lastError, undefined);
  assert.equal(helper().view().lastError, undefined, 'and stays cleared after a restart');
});

test('the helper has a second use, Animal lines: off by default, ticked on its own, saved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'helper-lines-'));
  const h = createHelper(dir);
  assert.deepEqual(h.view().uses, { names: false, lines: false });
  assert.deepEqual(h.update({ on: true, uses: { lines: true } }).helper.uses, { names: false, lines: true });
  assert.equal(h.canCall('lines').ok, true);
  assert.equal(h.canCall('names').ok, false);
  assert.deepEqual(createHelper(dir).view().uses, { names: false, lines: true }, 'saved');
});
