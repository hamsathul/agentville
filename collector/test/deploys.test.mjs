// Deploys done straight from a session (a deploy script over ssh, rsync, vercel…), and which
// deploy counts: that one or the repo's latest GitHub Actions run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastDeployOf, noteDirectDeploys, repoOfCall } from '../derive/deploys.mjs';

const T = Date.parse('2026-10-07T13:00:00Z');
const MIN = 60_000;
const known = ['/code/shop/backend', '/code/shop/frontend', '/code/shop/.wt-fix-be', '/code/blog'];
const lookup = p => known.find(k => p === k || p?.startsWith(`${k}/`)) ?? null;
const call = (command, over = {}) => ({ id: command, name: 'Bash', input: { command, description: `Run ${command}` }, at: T, endedAt: T + MIN, ok: true, cwd: '/code/shop', ...over });

test('a deploy belongs to the repo it names (in the session folder), else the repo it ran in, else the only one there', () => {
  const where = { lookup, known, folder: '/code/shop' };
  assert.equal(repoOfCall(call('vercel --prod', { cwd: '/code/blog/site' }), { ...where, folder: '/code/blog' }), '/code/blog');
  assert.equal(repoOfCall(call("ssh prod 'cd /srv && ./deploy-zero-downtime.sh --backend'"), where), '/code/shop/backend');
  assert.equal(repoOfCall(call("ssh prod 'cd /srv && ./deploy-zero-downtime.sh --frontend'"), where), '/code/shop/frontend');
  // the shell was left in a worktree, but the command says which repo it ships
  assert.equal(repoOfCall(call("ssh prod './deploy-zero-downtime.sh --frontend'", { cwd: '/code/shop/.wt-fix-be' }), where), '/code/shop/frontend');
  assert.equal(repoOfCall(call('./deploy.sh', { cwd: '/code/shop/.wt-fix-be' }), where), '/code/shop/.wt-fix-be', 'it names none: the repo it ran in');
  assert.equal(repoOfCall(call("ssh prod './deploy.sh --all'"), where), null, 'it names none and ran in no repo: no guess');
  assert.equal(repoOfCall(call("ssh prod './deploy.sh backend frontend'"), where), null, 'it names two: no guess');
});

test('the newest finished direct deploy per repo is kept, whether it worked or not', () => {
  const into = new Map();
  noteDirectDeploys(into, { by: 'shop-1', lookup, known, folder: '/code/shop', calls: [
    call("ssh prod './deploy.sh --backend'", { endedAt: T + MIN }),
    call("ssh prod './deploy.sh --backend'", { id: 'b2', endedAt: T + 5 * MIN, ok: false }),
    call("ssh prod './deploy.sh --frontend'", { endedAt: T + 3 * MIN }),
    call("ssh prod './deploy.sh --frontend'", { id: 'f2', ok: undefined, endedAt: undefined }), // still running
    call("ssh prod 'docker compose logs backend'"), // not a deploy
    call('gh workflow run deploy.yml -f target=backend'), // CI will deploy: its run says how it went
  ] });
  assert.deepEqual([...into].map(([repo, d]) => [repo, d.ok, d.at, d.by]).sort(), [
    ['/code/shop/backend', false, T + 5 * MIN, 'shop-1'],
    ['/code/shop/frontend', true, T + 3 * MIN, 'shop-1'],
  ]);
  assert.match(into.get('/code/shop/frontend').summary, /deploy\.sh --frontend/);
  noteDirectDeploys(into, { by: 'shop-2', lookup, known, folder: '/code/shop', calls: [call("ssh prod './deploy.sh --frontend'", { endedAt: T + 2 * MIN })] });
  assert.equal(into.get('/code/shop/frontend').by, 'shop-1', 'an older one does not replace a newer one');
});

const run = over => ({ status: 'completed', conclusion: 'failure', sha: 'abc1234', at: T, workflow: 'Deploy', url: 'https://github.com/o/r/actions/runs/1', ...over });
const direct = over => ({ at: T + 2 * MIN, ok: true, by: 'shop-1', summary: 'Run the backend deploy', ...over });

test('the newer of the Actions run and a direct deploy says how the repo stands', () => {
  assert.deepEqual(lastDeployOf(run(), direct()), { source: 'direct', state: 'ok', at: T + 2 * MIN, label: '✓ deployed directly', detail: 'shop-1 deployed it directly: Run the backend deploy' });
  assert.equal(lastDeployOf(run({ at: T + 9 * MIN }), direct()).state, 'failed', 'a later failed run wins');
  assert.equal(lastDeployOf(null, direct({ ok: false })).label, '✗ deploy failed');
  assert.equal(lastDeployOf(run({ status: 'in_progress', at: T + 9 * MIN }), direct()).label, '◌ deploying');
  assert.equal(lastDeployOf(run({ conclusion: 'success' }), null).label, '✓ deployed');
  assert.equal(lastDeployOf(null, null), null);
});

test("an Actions run GitHub never started (billing, spending limit) is not a failed deploy", () => {
  const d = lastDeployOf(run({ blocked: true, reason: 'The job was not started because your spending limit needs to be increased.' }), null);
  assert.equal(d.state, 'blocked');
  assert.equal(d.label, "⏸ Actions didn't run");
  assert.match(d.detail, /spending limit/);
  assert.equal(d.url, 'https://github.com/o/r/actions/runs/1');
});
