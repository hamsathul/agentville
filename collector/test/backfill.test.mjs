import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { earlierFileCalls, earlierHistory } from '../transcript/backfill.mjs';

const use = (sec, name, input, cwd = '/w') => JSON.stringify({ type: 'assistant', timestamp: new Date(Date.UTC(2026, 9, 7, 10, 0, sec)).toISOString(), cwd, message: { model: 'm', content: [{ type: 'tool_use', id: `t${sec}`, name, input }] } });

test('file-tool calls before a byte offset are found; everything else is skipped cheaply', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const head = [
    JSON.stringify({ type: 'user', timestamp: '2026-10-07T10:00:00.000Z', message: { content: 'go' } }),
    use(1, 'Write', { file_path: '/w/docs/spec.md', content: '# Spec' }),
    use(2, 'Bash', { command: 'cat /w/a.md' }),
    '{ broken',
    use(3, 'Read', { file_path: 'notes.md' }),
    use(4, 'NotebookEdit', { notebook_path: '/w/n.ipynb' }),
  ].join('\n') + '\n';
  writeFileSync(f, head + use(9, 'Edit', { file_path: '/w/late.ts' }) + '\n');
  const calls = await earlierFileCalls(f, Buffer.byteLength(head));
  assert.deepEqual(calls.map(c => [c.name, c.input.file_path ?? c.input.notebook_path, c.cwd, new Date(c.at).getUTCSeconds()]), [
    ['Write', '/w/docs/spec.md', '/w', 1],
    ['Read', 'notes.md', '/w', 3],
    ['NotebookEdit', '/w/n.ipynb', '/w', 4],
  ]);
  assert.deepEqual(await earlierFileCalls('/no/such/file', 100), []);
});

test('the conversation before a byte offset is found too: your prompts (typed or sent from the dashboard) and the replies', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const t = sec => new Date(Date.UTC(2026, 9, 7, 10, 0, sec)).toISOString();
  const head = [
    JSON.stringify({ type: 'user', timestamp: t(0), origin: { kind: 'human' }, message: { content: 'typed ask' } }),
    JSON.stringify({ type: 'assistant', timestamp: t(1), message: { model: 'm', content: [{ type: 'text', text: 'A reply' }] } }),
    JSON.stringify({ type: 'user', timestamp: t(2), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'big output' }] } }),
    JSON.stringify({ type: 'user', timestamp: t(3), origin: { kind: 'task-notification' }, message: { content: '<task-notification>done' } }),
    JSON.stringify({ type: 'user', timestamp: t(4), origin: { kind: 'plugin', name: 'agent-tracker', asUser: true }, message: { content: 'sent from the dashboard' } }),
    use(5, 'Write', { file_path: '/w/a.md', content: '#' }),
  ].join('\n') + '\n';
  writeFileSync(f, head + JSON.stringify({ type: 'user', timestamp: t(9), message: { content: 'after the offset' } }) + '\n');
  const h = await earlierHistory(f, Buffer.byteLength(head));
  assert.deepEqual(h.said.map(s => [s.kind, s.text, new Date(s.at).getUTCSeconds()]), [
    ['prompt', 'typed ask', 0], ['reply', 'A reply', 1], ['prompt', 'sent from the dashboard', 4],
  ]);
  assert.deepEqual(h.files.map(c => c.input.file_path), ['/w/a.md']);
  assert.deepEqual(await earlierHistory('/no/such/file', 100), { files: [], said: [] });
});
