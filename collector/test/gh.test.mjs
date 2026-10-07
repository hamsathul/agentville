import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployStatus, parseRunList } from '../sources/gh.mjs';

test('parseRunList takes the newest run', () => {
  const d = parseRunList(JSON.stringify([{ status: 'in_progress', conclusion: '', headSha: 'abcdef1234', createdAt: '2026-10-06T12:00:00Z', workflowName: 'Deploy Backend' }]));
  assert.deepEqual(d, { status: 'in_progress', conclusion: undefined, sha: 'abcdef1', at: Date.parse('2026-10-06T12:00:00Z'), workflow: 'Deploy Backend' });
});

test('an empty run list is null', () => {
  assert.equal(parseRunList('[]'), null);
});

test('deployStatus rejects with gh stderr', async () => {
  await assert.rejects(deployStatus('o/r', async () => ({ code: 1, stdout: '', stderr: 'not logged in' })), /not logged in/);
});
