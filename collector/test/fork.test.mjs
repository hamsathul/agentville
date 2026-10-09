import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRewind, cutTranscript, pruneForks, restorePoint } from '../sources/fork.mjs';

const SID = '5e551011-aaaa-4bbb-8ccc-000000000001';
const row = (type, uuid, content, extra = {}) => JSON.stringify({ parentUuid: null, type, uuid, message: { role: type, content }, ...extra });
// A conversation as Claude Code writes it: rows that aren't messages (attachments, queue operations,
// the turn's end) come between the messages.
const LINES = [
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
  JSON.stringify({ type: 'attachment', uuid: 'att-1' }),
  row('user', 'p-1', 'Plan the release'),
  row('assistant', 'r-1', [{ type: 'thinking', thinking: '' }]),
  row('assistant', 'r-2', [{ type: 'text', text: 'Here is the plan.' }]),
  JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
  JSON.stringify({ type: 'attachment', uuid: 'att-2' }),
  row('user', 'p-2', [{ type: 'text', text: 'Now ship it\nto staging' }]),
  row('assistant', 'r-3', [{ type: 'text', text: 'Shipped.' }]),
];
function transcript() {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-fork-'));
  const path = join(dir, `${SID}.jsonl`);
  writeFileSync(path, `${LINES.join('\n')}\n`);
  return { path, forks: join(dir, 'forks') };
}
const linesOf = file => readFileSync(file, 'utf8').trim().split('\n');

test("a fork from Claude's reply keeps the conversation up to and including it", async () => {
  const { path, forks } = transcript();
  const cut = await cutTranscript(path, 'r-2', forks, SID);
  assert.equal(cut.prefillFile, undefined);
  assert.deepEqual(linesOf(cut.file), LINES.slice(0, 5));
  assert.match(cut.file, new RegExp(`/forks/[^/]+/${SID}\\.jsonl$`), 'in a folder of its own, named as the session');
  assert.equal(statSync(cut.file).mode & 0o777, 0o600, 'yours only');
});

test('a fork from your own message keeps what came before it, and your message goes in the new prompt box', async () => {
  const { path, forks } = transcript();
  const cut = await cutTranscript(path, 'p-2', forks, SID);
  assert.deepEqual(linesOf(cut.file), LINES.slice(0, 5), "the conversation up to Claude's last message before it");
  assert.equal(readFileSync(cut.prefillFile, 'utf8'), 'Now ship it\nto staging');
  assert.equal(statSync(cut.prefillFile).mode & 0o777, 0o600);
  const two = await cutTranscript(path, 'p-2', forks, SID);
  assert.notEqual(two.file, cut.file, 'each fork gets its own copy');
});

test('a message not in the transcript, a row that is not a message, or your first message cannot be forked from', async () => {
  const { path, forks } = transcript();
  assert.match((await cutTranscript(path, 'nope', forks, SID)).error, /not in its transcript/);
  assert.match((await cutTranscript(path, 'att-2', forks, SID)).error, /not a message/);
  assert.match((await cutTranscript(path, 'p-1', forks, SID)).error, /first message/);
  assert.match((await cutTranscript(join(forks, 'gone.jsonl'), 'r-2', forks, SID)).error, /could not be read/);
  assert.ok(!existsSync(forks) || readdirSync(forks).length === 0, 'nothing left behind');
});

test('fork copies are removed after an hour', () => {
  const forks = mkdtempSync(join(tmpdir(), 'tracker-forks-'));
  for (const name of ['f-old', 'f-new']) { mkdirSync(join(forks, name)); writeFileSync(join(forks, name, `${SID}.jsonl`), '{}\n'); }
  const now = Date.now();
  utimesSync(join(forks, 'f-old'), new Date(now - 2 * 3_600_000), new Date(now - 2 * 3_600_000));
  pruneForks(forks, now);
  assert.deepEqual(readdirSync(forks), ['f-new']);
  pruneForks(join(forks, 'missing'), now); // no folder yet: nothing to do
});

// A conversation as a chain: each row names the one it follows.
const CHAIN = [
  JSON.stringify({ type: 'attachment', uuid: 'att-0', parentUuid: null }),
  JSON.stringify({ type: 'user', uuid: 'p-1', parentUuid: 'att-0', message: { role: 'user', content: 'Plan the release' } }),
  JSON.stringify({ type: 'attachment', uuid: 'att-9', parentUuid: 'p-1' }),
  JSON.stringify({ type: 'assistant', uuid: 'r-1', parentUuid: 'att-9', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the plan.' }] } }),
  JSON.stringify({ type: 'user', uuid: 'p-2', parentUuid: 'r-1', message: { role: 'user', content: [{ type: 'text', text: 'Ship it' }] } }),
  JSON.stringify({ type: 'assistant', uuid: 'r-2', parentUuid: 'p-2', message: { role: 'assistant', content: [{ type: 'text', text: 'Shipped.' }] } }),
  JSON.stringify({ type: 'attachment', uuid: 'att-10', parentUuid: 'r-2' }),
  JSON.stringify({ type: 'user', uuid: 'p-3', parentUuid: 'att-10', message: { role: 'user', content: 'Tag it' } }),
];
const chain = (end = '\n') => {
  const path = join(mkdtempSync(join(tmpdir(), 'tracker-restore-')), `${SID}.jsonl`);
  writeFileSync(path, CHAIN.join('\n') + end);
  return path;
};

test('a restore point is one of your messages: the conversation goes back to what it followed, and its text comes back for the prompt box', async () => {
  const path = chain();
  assert.deepEqual(await restorePoint(path, 'p-2'), { leafUuid: 'r-1', prompt: 'Ship it' });
  assert.deepEqual(await restorePoint(path, 'p-3'), { leafUuid: 'att-10', prompt: 'Tag it' }, 'the row it follows, which Claude Code walks up from');
  assert.match((await restorePoint(path, 'r-2')).error, /your own messages/);
  assert.match((await restorePoint(path, 'p-1')).error, /first message/, 'only attachments before it');
  assert.match((await restorePoint(path, 'nope')).error, /not in its transcript/);
});

test("a restore is written as Claude Code's own rewind row, on a line of its own; nothing else changes", () => {
  for (const end of ['\n', '']) {
    const path = chain(end);
    appendRewind(path, { leafUuid: 'r-1', sessionId: SID });
    const lines = readFileSync(path, 'utf8').split('\n');
    assert.equal(lines.at(-1), '', 'ends with a newline');
    assert.deepEqual(lines.slice(0, -2), CHAIN, 'the conversation is untouched');
    assert.deepEqual(JSON.parse(lines.at(-2)), { type: 'last-prompt', leafUuid: 'r-1', sessionId: SID, explicit: true, rewound: true });
  }
});
