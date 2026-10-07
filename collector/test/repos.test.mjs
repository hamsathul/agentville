// Which repos the dashboard lists (the repo rail and the farm's fields).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reposFor } from '../derive/repos.mjs';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const HOUR = 3_600_000;
const agent = (id, over = {}) => ({ id, state: 'working', cwd: null, touching: [], ...over });
const opts = (over = {}) => ({
  deployRepos: {}, repoInfo: new Map(), deploys: new Map(), lookup: cwd => (cwd?.startsWith('/code/') ? cwd.split('/').slice(0, 3).join('/') : null), home: '/Users/me', now: NOW, ...over,
});
const paths = repos => repos.map(r => r.path);

test("a repo is listed while an agent writes to it or works in its folder", () => {
  const repos = reposFor([agent('a', { touching: [{ repo: '/code/app' }] }), agent('b', { cwd: '/code/api/src', state: 'idle' })], opts());
  assert.deepEqual(paths(repos).sort(), ['/code/api', '/code/app']);
  assert.deepEqual(repos.find(r => r.path === '/code/api').agentIds, ['b']);
});

test('a stale agent (no activity for a day) no longer keeps its folder listed', () => {
  const repos = reposFor([agent('old', { cwd: '/code/site', state: 'stale' }), agent('now', { cwd: '/code/app' })], opts());
  assert.deepEqual(paths(repos), ['/code/app']);
});

test('a repo watched for deploys shows without agents only while its deploy runs', () => {
  const deployRepos = { '/code/backend': 'o/backend', '/code/frontend': 'o/frontend', '/code/docs': 'o/docs', '/code/web': 'o/web' };
  const deploys = new Map([
    ['/code/backend', { status: 'completed', conclusion: 'failure', at: NOW - 5 * HOUR }],
    ['/code/frontend', { status: 'in_progress', at: NOW - 5 * 60_000 }],
    ['/code/docs', { status: 'completed', conclusion: 'failure', at: NOW - 9 * 60_000 }], // you closed the project just after pushing
  ]);
  const repos = reposFor([], opts({ deployRepos, deploys }));
  assert.deepEqual(paths(repos), ['/code/frontend']);
  // with an agent there it is listed whatever its deploy did
  const withAgent = reposFor([agent('a', { cwd: '/code/backend' })], opts({ deployRepos, deploys }));
  assert.equal(withAgent.find(r => r.path === '/code/backend').deploy.conclusion, 'failure');
});

test('the home folder and / are nobody\'s repo; the busiest repo comes first', () => {
  const repos = reposFor([
    agent('h', { cwd: '/Users/me' }),
    agent('a', { cwd: '/code/b' }), agent('b', { cwd: '/code/b' }), agent('c', { cwd: '/code/a' }),
  ], opts({ lookup: cwd => (cwd === '/Users/me' ? '/Users/me' : cwd) }));
  assert.deepEqual(paths(repos), ['/code/b', '/code/a']);
});
