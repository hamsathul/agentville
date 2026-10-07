import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmDelivery, readBeacons, readPending, validateAnswers, writeAnswerFile } from '../sources/pending.mjs';

const NOW = 1_000_000_000;
const tmp = () => mkdtempSync(join(tmpdir(), 'tracker-pending-'));
const put = (dir, name, value) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
const question = (id, sessionId, createdAt = NOW - 1000) => ({
  kind: 'question', toolUseId: id, sessionId, createdAt,
  questions: [{ question: 'Pick a colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }] }],
});

test('reads offered questions and permission prompts, keyed by session', () => {
  const dir = tmp();
  put(dir, 'toolu_A1.json', question('toolu_A1', 's1'));
  put(dir, 'toolu_B2.json', { kind: 'permission', toolUseId: 'toolu_B2', sessionId: 's2', tool: 'Bash', summary: 'mkdir /tmp/x', createdAt: NOW - 500, expiresAt: NOW + 14_000 });
  const { bySession } = readPending(dir, NOW);
  const strip = ({ heartbeatAt, ...rest }) => { assert.ok(heartbeatAt > 0); return rest; };
  assert.deepEqual(strip(bySession.get('s1')), { kind: 'question', toolUseId: 'toolu_A1', createdAt: NOW - 1000, questions: [{ question: 'Pick a colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: undefined }] }] });
  assert.deepEqual(strip(bySession.get('s2')), { kind: 'permission', toolUseId: 'toolu_B2', tool: 'Bash', summary: 'mkdir /tmp/x', createdAt: NOW - 500, expiresAt: NOW + 14_000 });
});

test('the newest offer wins when a session has two', () => {
  const dir = tmp();
  put(dir, 'toolu_Old.json', question('toolu_Old', 's1', NOW - 9000));
  put(dir, 'toolu_New.json', question('toolu_New', 's1', NOW - 100));
  assert.equal(readPending(dir, NOW).bySession.get('s1').toolUseId, 'toolu_New');
});

test('malformed, mismatched or unsafe files are ignored', () => {
  const dir = tmp();
  put(dir, 'toolu_Bad.json', '{ nope');
  put(dir, 'toolu_Mis.json', question('toolu_Other', 's1'));
  put(dir, 'x;rm -rf.json', question('x;rm -rf', 's1'));
  put(dir, 'toolu_Kind.json', { ...question('toolu_Kind', 's1'), kind: 'plan' });
  put(dir, 'toolu_NoQ.json', { ...question('toolu_NoQ', 's1'), questions: [] });
  put(dir, 'toolu_NoS.json', { ...question('toolu_NoS', ''), sessionId: '' });
  assert.equal(readPending(dir, NOW).bySession.size, 0);
});

test('expired permission prompts and day-old offers are listed for cleanup, not returned', () => {
  const dir = tmp();
  put(dir, 'toolu_Exp.json', { kind: 'permission', toolUseId: 'toolu_Exp', sessionId: 's1', tool: 'Bash', summary: 'x', createdAt: NOW - 20_000, expiresAt: NOW - 5_000 });
  put(dir, 'toolu_Day.json', question('toolu_Day', 's2', NOW - 25 * 3_600_000));
  const { bySession, expired } = readPending(dir, NOW);
  assert.equal(bySession.size, 0);
  assert.deepEqual(expired.map(p => p.split('/').pop()).sort(), ['toolu_Day.json', 'toolu_Exp.json']);
});

test('a missing pending folder reads as nothing offered', () => {
  assert.equal(readPending('/nonexistent/pending', NOW).bySession.size, 0);
});

test('answers must cover every question with non-empty text', () => {
  const qs = [{ question: 'Pick a colour?' }, { question: 'Size?' }];
  assert.deepEqual(validateAnswers(qs, { 'Pick a colour?': 'Blue', 'Size?': 'Large' }), { answers: { 'Pick a colour?': 'Blue', 'Size?': 'Large' } });
  assert.match(validateAnswers(qs, { 'Pick a colour?': 'Blue' }).error, /every question/);
  assert.match(validateAnswers(qs, { 'Pick a colour?': '  ', 'Size?': 'L' }).error, /every question/);
  assert.match(validateAnswers(qs, 'Blue').error, /every question/);
  assert.equal(validateAnswers(qs, { 'Pick a colour?': 'B', 'Size?': 'L', extra: 'x' }).answers.extra, undefined);
  assert.equal(validateAnswers(qs, { 'Pick a colour?': 'x'.repeat(5000), 'Size?': 'L' }).answers['Pick a colour?'].length, 2000);
});

test('answer files are written whole, and only for safe ids', () => {
  const dir = tmp();
  writeAnswerFile(dir, 'toolu_A1', { decision: 'allow' });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'toolu_A1.json'), 'utf8')), { decision: 'allow' });
  assert.equal(existsSync(join(dir, 'toolu_A1.json.tmp')), false);
  assert.throws(() => writeAnswerFile(dir, '../evil', {}), /tool use id/);
});

test('each offer carries its heartbeat: the time the waiting mod last refreshed the file', () => {
  const dir = tmp();
  put(dir, 'toolu_H1.json', question('toolu_H1', 's1'));
  const beat = NOW - 2_000;
  utimesSync(join(dir, 'toolu_H1.json'), beat / 1000, beat / 1000);
  assert.equal(readPending(dir, NOW).bySession.get('s1').heartbeatAt, beat);
});

test('mod beacons say which sessions are listening for dashboard answers', () => {
  const dir = tmp();
  put(dir, 's1.json', { sessionId: 's1', version: '0.2.0', at: NOW - 1000 });
  put(dir, 's2.json', { sessionId: 's2', version: '0.2.0', at: NOW - 60_000 });
  put(dir, 'bad.json', '{ nope');
  const beacons = readBeacons(dir, NOW);
  assert.deepEqual(beacons.get('s1'), { version: '0.2.0', live: true });
  assert.deepEqual(beacons.get('s2'), { version: '0.2.0', live: false });
  assert.equal(beacons.size, 2);
  assert.equal(readBeacons('/nonexistent/mods', NOW).size, 0);
});

test('an offer whose heartbeat stopped over 10 minutes ago is cleaned up', () => {
  const dir = tmp();
  put(dir, 'toolu_Dead.json', question('toolu_Dead', 's1', NOW - 20 * 60_000));
  const beat = NOW - 11 * 60_000;
  utimesSync(join(dir, 'toolu_Dead.json'), beat / 1000, beat / 1000);
  const { bySession, expired } = readPending(dir, NOW);
  assert.equal(bySession.size, 0);
  assert.deepEqual(expired.map(p => p.split('/').pop()), ['toolu_Dead.json']);
});

test('delivery is confirmed when the mod takes the file, even in the last instant before it is withdrawn', async () => {
  const dir = tmp();
  const file = join(dir, 'm.json');
  put(dir, 'm.json', '{}');
  setTimeout(() => unlinkSync(file), 150);
  assert.deepEqual(await confirmDelivery(file, { timeoutMs: 2000, failure: 'nope' }), { ok: true });
  put(dir, 'm.json', '{}');
  assert.deepEqual(await confirmDelivery(file, { timeoutMs: 250, failure: 'nope' }), { ok: false, error: 'nope' });
  assert.equal(existsSync(file), false, 'an untaken file is withdrawn');
  const lastInstant = await confirmDelivery(file, {
    timeoutMs: 0, failure: 'nope',
    exists: () => true,
    unlink: () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); },
  });
  assert.deepEqual(lastInstant, { ok: true });
});
