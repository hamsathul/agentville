// Held messages: what you sent a working session, kept until its turn ends (state/held).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_HELD, MAX_HELD_CHARS, createHeld } from '../sources/held.mjs';

const SID = '11111111-1111-4111-8111-111111111111';
let n = 0;
const fresh = () => { const dir = join(mkdtempSync(join(tmpdir(), 'held-')), 'held'); return { dir, held: createHeld(dir, { newId: () => `h${++n}` }) }; };
const texts = list => list.items.map(i => i.text);

test('added in order; listed with their files and folders; together off to start', () => {
  const { held } = fresh();
  assert.equal(held.add(SID, { text: 'first' }).count, 1);
  const r = held.add(SID, { text: 'second', files: [{ name: 'a.png', path: '/u/a.png' }], folders: ['/w/docs'] });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  const list = held.list(SID);
  assert.deepEqual(texts(list), ['first', 'second']);
  assert.deepEqual(list.items[1].files, [{ name: 'a.png', path: '/u/a.png' }]);
  assert.deepEqual(list.items[1].folders, ['/w/docs']);
  assert.equal(list.together, false);
  assert.deepEqual(held.sessions(), [SID]);
});

test('edit and remove by id; an id no longer waiting is refused', () => {
  const { held } = fresh();
  const a = held.add(SID, { text: 'one' }).item, b = held.add(SID, { text: 'two' }).item;
  assert.equal(held.edit(SID, a.id, 'one, changed').ok, true);
  assert.equal(held.remove(SID, b.id).ok, true);
  assert.deepEqual(texts(held.list(SID)), ['one, changed']);
  assert.deepEqual(held.remove(SID, b.id), { ok: false, error: 'That message is no longer waiting.' });
  assert.deepEqual(held.edit(SID, 'nope', 'x'), { ok: false, error: 'That message is no longer waiting.' });
  assert.equal(held.edit(SID, a.id, '   ').ok, false, 'an edit to nothing is refused');
});

test('take the first or one by id, take them all, put them back at the front', () => {
  const { held } = fresh();
  const [a, b, c] = ['a', 'b', 'c'].map(t => held.add(SID, { text: t }).item);
  assert.equal(held.take(SID).text, 'a');
  assert.equal(held.take(SID, c.id).text, 'c');
  assert.equal(held.take(SID, 'nope'), null);
  held.putBack(SID, [a]);
  assert.deepEqual(texts(held.list(SID)), ['a', 'b']);
  assert.deepEqual(held.takeAll(SID).map(i => i.text), ['a', 'b']);
  assert.equal(held.summary(SID), null, 'none left: no summary');
  assert.deepEqual(held.sessions(), []);
  held.putBack(SID, [a, b]);
  assert.deepEqual(texts(held.list(SID)), ['a', 'b']);
  held.putBack(SID, [c], 1);
  assert.deepEqual(texts(held.list(SID)), ['a', 'c', 'b'], 'back where it was');
  assert.equal(held.take('22222222-2222-4222-8222-222222222222'), null);
});

test('limits: 50 waiting, 20,000 characters each, something to send', () => {
  const { held } = fresh();
  for (let i = 0; i < MAX_HELD; i++) assert.equal(held.add(SID, { text: `m${i}` }).ok, true);
  assert.deepEqual(held.add(SID, { text: 'one more' }), { ok: false, error: `${MAX_HELD} messages are waiting already.` });
  const other = '33333333-3333-4333-8333-333333333333';
  assert.equal(held.add(other, { text: 'x'.repeat(MAX_HELD_CHARS + 1) }).ok, false);
  assert.equal(held.add(other, { text: '' }).ok, false, 'nothing to send');
  assert.equal(held.add(other, { text: '', files: [{ name: 'a.png', path: '/u/a.png' }] }).ok, true, 'a file alone is something');
  assert.equal(held.add('../escape', { text: 'x' }).ok, false, 'not a session id');
});

test('together is kept per session; the summary says how many, together, and moves its rev', () => {
  const { held } = fresh();
  held.add(SID, { text: 'a' });
  const before = held.summary(SID);
  held.setTogether(SID, true);
  const after = held.summary(SID);
  assert.deepEqual({ count: after.count, together: after.together }, { count: 1, together: true });
  assert.ok(after.rev > before.rev);
  assert.ok(!('items' in after) && !JSON.stringify(after).includes('"a"'), 'no text in the summary');
});

test('kept in a file only you can read; read again after a restart; a broken file is empty', () => {
  const { dir, held } = fresh();
  held.add(SID, { text: 'survives' });
  held.setTogether(SID, true);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, `${SID}.json`)).mode & 0o777, 0o600);
  const again = createHeld(dir);
  assert.deepEqual(texts(again.list(SID)), ['survives']);
  assert.equal(again.list(SID).together, true);
  assert.deepEqual(again.sessions(), [SID], 'found on disk after a restart');
  writeFileSync(join(dir, `${SID}.json`), '{broken');
  assert.deepEqual(createHeld(dir).list(SID).items, []);
});

test('drop removes the session\'s file', () => {
  const { dir, held } = fresh();
  held.add(SID, { text: 'a' });
  held.drop(SID);
  assert.equal(existsSync(join(dir, `${SID}.json`)), false);
  assert.deepEqual(held.sessions(), []);
});
