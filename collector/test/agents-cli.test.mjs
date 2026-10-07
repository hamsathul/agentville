import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentsJson, readAgentsCli } from '../sources/agents-cli.mjs';

const SAMPLE = JSON.stringify([
  { id: 'aaaa1111', cwd: '/Users/x/site', kind: 'background', startedAt: 1, sessionId: 'aaaa1111-2222-3333', name: 'Build landing page', state: 'blocked' },
  { pid: 12345, cwd: '/Users/x/app', kind: 'interactive', startedAt: 2, sessionId: 'bbbb4444-5555-6666', name: 'my-app', status: 'busy' },
  { id: 'no-session' },
]);

test('parses interactive and background sessions and skips entries with no sessionId', () => {
  const got = parseAgentsJson(SAMPLE);
  assert.equal(got.length, 2);
  assert.deepEqual(got[0], { id: 'aaaa1111', sessionId: 'aaaa1111-2222-3333', cwd: '/Users/x/site', kind: 'background', name: 'Build landing page', pid: undefined, startedAt: 1, cliState: 'blocked' });
  assert.equal(got[1].pid, 12345);
  assert.equal(got[1].id, 'bbbb4444');
  assert.equal(got[1].kind, 'interactive');
});

test('output that is not an array throws', () => {
  assert.throws(() => parseAgentsJson('{}'), /array/);
});

test('a failing CLI rejects with its stderr', async () => {
  await assert.rejects(readAgentsCli('claude', async () => ({ code: 1, stdout: '', stderr: 'boom' })), /boom/);
});
