import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { earlierFileCalls } from '../transcript/backfill.mjs';

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
