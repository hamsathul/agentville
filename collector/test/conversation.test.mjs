// A session's whole conversation, for the conversation dialog: read in chunks, then only what was added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conversation } from '../transcript/conversation.mjs';

const T0 = Date.parse('2026-10-08T09:00:00Z');
const iso = sec => new Date(T0 + sec * 1000).toISOString();
const you = (sec, text) => JSON.stringify({ type: 'user', timestamp: iso(sec), origin: { kind: 'human' }, message: { role: 'user', content: text } });
const said = (sec, text) => JSON.stringify({ type: 'assistant', timestamp: iso(sec), message: { model: 'claude-opus-5-5', content: [{ type: 'text', text }] } });
const tool = sec => JSON.stringify({ type: 'assistant', timestamp: iso(sec), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `t${sec}`, name: 'Bash', input: { command: 'ls' } }] } });
const file = lines => {
  const path = join(mkdtempSync(join(tmpdir(), 'tracker-convo-')), 's.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
};

test('the whole conversation, from the first message, oldest first: messages only, read a small chunk at a time', async () => {
  const lines = [you(0, 'Plan the release')];
  for (let i = 1; i <= 300; i++) lines.push(tool(i * 2), said(i * 2 + 1, `step ${i} ${'x'.repeat(300)}`));
  lines.push(you(1000, 'Ship it'), said(1001, 'Shipped.'));
  const c = new Conversation(file(lines), { chunkBytes: 4096 }); // far smaller than the file
  await c.update();
  const { total, from, items } = c.messages();
  assert.equal(total, 303);
  assert.equal(from, 0);
  assert.deepEqual(items.slice(0, 2).map(m => [m.kind, m.body.slice(0, 6)]), [['prompt', 'Plan t'], ['reply', 'step 1']]);
  assert.deepEqual(items.slice(-2).map(m => [m.kind, m.body, m.at]), [['prompt', 'Ship it', T0 + 1_000_000], ['reply', 'Shipped.', T0 + 1_001_000]]);
  assert.ok(items.every(m => m.kind !== 'tool'));
  assert.deepEqual(c.messages(301).items.map(m => m.body), ['Ship it', 'Shipped.'], 'from: only the newer ones');
  assert.deepEqual(c.messages(400).items, []);
});

test('a later read takes only what was added; a line still being written waits for its end', async () => {
  const path = file([you(0, 'hello'), said(1, 'hi')]);
  const c = new Conversation(path);
  await c.update();
  assert.equal(c.messages().total, 2);
  appendFileSync(path, `${you(2, 'more')}\n${said(3, 'half').slice(0, 30)}`);
  await c.update();
  assert.deepEqual(c.messages(2).items.map(m => m.body), ['more']);
  appendFileSync(path, `${said(3, 'half').slice(30)}\n`);
  await c.update();
  assert.deepEqual(c.messages(2).items.map(m => m.body), ['more', 'half']);
  await Promise.all([c.update(), c.update()]); // two at once read once
  assert.equal(c.messages().total, 4);
});

test('a line longer than a chunk is read whole; a transcript that is gone reads as empty', async () => {
  const long = 'y'.repeat(20_000);
  const c = new Conversation(file([you(0, 'go'), said(1, long)]), { chunkBytes: 1024 });
  await c.update();
  assert.equal(c.messages().items[1].body.length, 20_000);
  const gone = new Conversation('/nonexistent/s.jsonl');
  await gone.update();
  assert.deepEqual(gone.messages(), { total: 0, from: 0, items: [] });
});
