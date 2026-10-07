import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksOf, deployStatus, parseRunList, pullRequests } from '../sources/gh.mjs';

test('parseRunList takes the newest run', () => {
  const d = parseRunList(JSON.stringify([{ status: 'in_progress', conclusion: '', headSha: 'abcdef1234', createdAt: '2026-10-06T12:00:00Z', workflowName: 'Deploy Backend', url: 'https://github.com/o/r/actions/runs/7', displayTitle: 'Fix the login', databaseId: 7 }]));
  assert.deepEqual(d, { status: 'in_progress', conclusion: undefined, sha: 'abcdef1', at: Date.parse('2026-10-06T12:00:00Z'), workflow: 'Deploy Backend', url: 'https://github.com/o/r/actions/runs/7', title: 'Fix the login', id: 7 });
});

test('an empty run list is null', () => {
  assert.equal(parseRunList('[]'), null);
});

test('deployStatus rejects with gh stderr', async () => {
  await assert.rejects(deployStatus('o/r', async () => ({ code: 1, stdout: '', stderr: 'not logged in' })), /not logged in/);
});

test("a failed deploy says why, from GitHub's annotation, asked once per run", async () => {
  const calls = [];
  const runner = async (cmd, args) => {
    calls.push(args.slice(0, 2).join(' '));
    if (args[0] === 'run' && args[1] === 'list') return { code: 0, stdout: JSON.stringify([{ status: 'completed', conclusion: 'failure', headSha: '6131f98877', createdAt: '2026-10-07T10:48:46Z', workflowName: 'Deploy Backend', url: 'https://github.com/o/r/actions/runs/99', displayTitle: 'x', databaseId: 99 }]), stderr: '' };
    if (args[0] === 'run' && args[1] === 'view') return { code: 0, stdout: '1234\n', stderr: '' };
    if (args[0] === 'api') return { code: 0, stdout: 'The job was not started because recent account payments have failed.\n', stderr: '' };
    throw new Error(args.join(' '));
  };
  const cache = new Map();
  const d = await deployStatus('o/r', runner, cache);
  assert.equal(d.reason, 'The job was not started because recent account payments have failed.');
  assert.equal(d.blocked, true, 'GitHub never started it: blocked, not failed');
  assert.deepEqual(calls, ['run list', 'run view', 'api repos/o/r/check-runs/1234/annotations']);
  await deployStatus('o/r', runner, cache);
  assert.deepEqual(calls.slice(3), ['run list']);
});

test('a passing or running deploy asks for nothing more', async () => {
  const calls = [];
  const runner = async (cmd, args) => { calls.push(args[1]); return { code: 0, stdout: JSON.stringify([{ status: 'completed', conclusion: 'success', headSha: 'a', createdAt: '2026-10-07T10:00:00Z', workflowName: 'Deploy', databaseId: 5 }]), stderr: '' }; };
  const d = await deployStatus('o/r', runner, new Map());
  assert.equal(d.reason, undefined);
  assert.deepEqual(calls, ['list']);
});

test('a run that failed in its own steps is not blocked', async () => {
  const runner = async (cmd, args) => {
    if (args[1] === 'list') return { code: 0, stdout: JSON.stringify([{ status: 'completed', conclusion: 'failure', headSha: 'a', createdAt: '2026-10-07T10:48:46Z', databaseId: 7 }]), stderr: '' };
    if (args[1] === 'view') return { code: 0, stdout: '55\n', stderr: '' };
    return { code: 0, stdout: 'Process completed with exit code 1.\n', stderr: '' };
  };
  const d = await deployStatus('o/r', runner, new Map());
  assert.equal(d.blocked, false);
});

test("a pull request's checks in one word: failed beats running beats ok", () => {
  assert.equal(checksOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]), 'ok');
  assert.equal(checksOf([{ status: 'IN_PROGRESS', conclusion: '' }, { status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'running');
  assert.equal(checksOf([{ status: 'IN_PROGRESS', conclusion: '' }, { status: 'COMPLETED', conclusion: 'FAILURE' }]), 'failed');
  assert.equal(checksOf([{ state: 'PENDING' }]), 'running');
  assert.equal(checksOf([]), null);
  assert.equal(checksOf(undefined), null);
});

test('pull requests: the open ones with their checks, and the last merged', async () => {
  const calls = [];
  const runner = async (cmd, args) => {
    calls.push(args.join(' '));
    return args.includes('open')
      ? { code: 0, stdout: JSON.stringify([{ number: 12, title: 'Add the stall', url: 'https://github.com/o/r/pull/12', isDraft: false, headRefName: 'stall', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }, { number: 13, title: 'WIP', isDraft: true, statusCheckRollup: [] }]), stderr: '' }
      : { code: 0, stdout: JSON.stringify([{ number: 9, title: 'Old', url: 'https://github.com/o/r/pull/9', mergedAt: '2026-10-07T10:00:00Z' }]), stderr: '' };
  };
  const prs = await pullRequests('o/r', runner);
  assert.deepEqual(prs.open.map(p => [p.number, p.checks, p.draft, p.branch]), [[12, 'ok', false, 'stall'], [13, null, true, undefined]]);
  assert.deepEqual(prs.merged, [{ number: 9, title: 'Old', url: 'https://github.com/o/r/pull/9', at: Date.parse('2026-10-07T10:00:00Z') }]);
  assert.ok(calls.every(c => c.includes('-R o/r')));
  await assert.rejects(pullRequests('o/r', async () => ({ code: 1, stdout: '', stderr: 'not logged in' })), /gh pr list failed/);
});
