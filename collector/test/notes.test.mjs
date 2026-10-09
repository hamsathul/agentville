import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotes, MAX_NOTES, MAX_NOTE_CHARS } from '../sources/notes.mjs';

const S = '6f1c2a3b-0000-4000-8000-000000000001';
function store(start = 1000) {
  const dir = join(mkdtempSync(join(tmpdir(), 'notes-')), 'notes');
  let t = start, n = 0;
  return { dir, notes: createNotes(dir, { now: () => t, newId: () => `n${++n}` }), tick: (ms = 1) => { t += ms; } };
}

test('a note is added, kept in the order written, and read back after a restart', () => {
  const { dir, notes, tick } = store();
  assert.deepEqual(notes.list(S), []);
  assert.deepEqual(notes.add(S, '  ask about the cache  '), { ok: true, notes: [{ id: 'n1', text: 'ask about the cache', at: 1000 }], rev: 1000 });
  tick();
  notes.add(S, 'then the tests');
  const again = createNotes(dir);
  assert.deepEqual(again.list(S).map(x => x.text), ['ask about the cache', 'then the tests']);
});

test('the file is private to you: the folder 0700, the file 0600, written whole', () => {
  const { dir, notes } = store();
  notes.add(S, 'secret plan');
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, `${S}.json`)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), [`${S}.json`]); // no temp file left behind
});

test('a note is edited, used, deleted; Clear used removes only the used ones', () => {
  const { notes, tick } = store();
  notes.add(S, 'one');
  notes.add(S, 'two');
  notes.add(S, 'three');
  tick(5);
  assert.equal(notes.edit(S, 'n2', 'two, reworded').notes[1].text, 'two, reworded');
  assert.equal(notes.list(S)[1].editedAt, 1005);
  const used = notes.markUsed(S, ['n1', 'n3', 'nope']);
  assert.deepEqual(used.notes.map(x => x.usedAt ?? null), [1005, null, 1005]);
  assert.deepEqual(notes.remove(S, 'n2').notes.map(x => x.id), ['n1', 'n3']);
  const cleared = notes.clearUsed(S);
  assert.deepEqual(cleared.notes, []);
  assert.deepEqual(notes.summary(S), { count: 0, unused: 0, rev: cleared.rev }, 'its last note gone: a count of 0, so the page knows');
});

test('a session with no notes left has no file', () => {
  const { dir, notes } = store();
  notes.add(S, 'only one');
  notes.remove(S, 'n1');
  assert.equal(existsSync(join(dir, `${S}.json`)), false);
});

test('what is refused says why, and changes nothing', () => {
  const { notes } = store();
  assert.match(notes.add(S, '   ').error, /Write something/);
  assert.match(notes.add(S, 'x'.repeat(MAX_NOTE_CHARS + 1)).error, /4,000 characters/);
  assert.match(notes.add('../etc/passwd', 'x').error, /not a session/);
  assert.match(notes.add(S, 42).error, /Write something/);
  assert.match(notes.edit(S, 'n9', 'x').error, /no longer there/);
  assert.match(notes.remove(S, 'n9').error, /no longer there/);
  assert.equal(notes.add(S, 'x'.repeat(MAX_NOTE_CHARS)).ok, true);
  for (let i = 1; i < MAX_NOTES; i++) notes.add(S, `note ${i}`);
  assert.match(notes.add(S, 'one too many').error, /200 notes/);
  assert.equal(notes.list(S).length, MAX_NOTES);
});

test('the summary counts the notes and the unused ones, and its rev moves with every change', () => {
  const { notes, tick } = store();
  assert.equal(notes.summary(S), undefined);
  notes.add(S, 'a');
  const first = notes.summary(S);
  assert.deepEqual({ count: first.count, unused: first.unused }, { count: 1, unused: 1 });
  notes.add(S, 'b'); // same clock: the rev still moves
  notes.markUsed(S, ['n1']);
  const later = notes.summary(S);
  assert.deepEqual({ count: later.count, unused: later.unused }, { count: 2, unused: 1 });
  assert.ok(later.rev > first.rev);
  tick();
});

test('a fork gets a copy of the notes, which then go their own way', () => {
  const { notes } = store();
  const F = '6f1c2a3b-0000-4000-8000-000000000002';
  notes.add(S, 'carry this');
  notes.markUsed(S, ['n1']);
  notes.add(S, 'and this');
  assert.equal(notes.copy(S, F).ok, true);
  assert.deepEqual(notes.list(F).map(x => [x.text, Boolean(x.usedAt)]), [['carry this', true], ['and this', false]]);
  notes.add(F, 'only in the fork');
  assert.equal(notes.list(S).length, 2);
  assert.deepEqual(notes.copy('6f1c2a3b-0000-4000-8000-00000000000f', F).notes, notes.list(F)); // nothing to copy: left as it is
});

test('the sessions that have notes, for the resume list', () => {
  const { dir, notes } = store();
  notes.add(S, 'a');
  writeFileSync(join(dir, 'junk.json'), 'not json');
  writeFileSync(join(dir, 'README'), 'x');
  const again = createNotes(dir);
  assert.deepEqual([...again.counts()], [[S, 1]]);
  assert.equal(JSON.parse(readFileSync(join(dir, `${S}.json`), 'utf8')).notes.length, 1);
});
