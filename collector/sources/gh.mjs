import { run } from '../lib/exec.mjs';

const RUN_FIELDS = 'status,conclusion,headSha,createdAt,workflowName,url,displayTitle,databaseId';
const reasons = new Map(); // run id → why it failed (GitHub's annotation), asked once per run
// GitHub's words when it refuses to start a job (billing, spending limit), not a failure of the deploy itself.
const BLOCKED = /job was not started|spending limit|account payments|billing/i;

export function parseRunList(stdout) {
  const list = JSON.parse(stdout);
  const r = Array.isArray(list) ? list[0] : undefined;
  if (!r) return null;
  return {
    status: r.status,
    conclusion: r.conclusion || undefined,
    sha: String(r.headSha ?? '').slice(0, 7),
    at: Date.parse(r.createdAt) || undefined,
    workflow: r.workflowName,
    url: typeof r.url === 'string' ? r.url : undefined,
    title: typeof r.displayTitle === 'string' ? r.displayTitle : undefined,
    id: Number.isInteger(r.databaseId) ? r.databaseId : undefined,
  };
}

/** Why a run failed, in GitHub's words: the first failure annotation of its failed job (e.g. a billing stop). */
async function failureReason(repo, id, runner, cache) {
  if (cache.has(id)) return cache.get(id);
  let reason;
  try {
    const jobs = await runner('gh', ['run', 'view', String(id), '-R', repo, '--json', 'jobs', '--jq', '[.jobs[] | select(.conclusion == "failure") | .databaseId][0]'], { timeoutMs: 20000 });
    const jobId = jobs.code === 0 ? jobs.stdout.trim() : '';
    if (/^\d+$/.test(jobId)) {
      const notes = await runner('gh', ['api', `repos/${repo}/check-runs/${jobId}/annotations`, '--jq', '[.[] | select(.annotation_level == "failure") | .message][0] // ""'], { timeoutMs: 20000 });
      const text = notes.code === 0 ? notes.stdout.trim() : '';
      reason = text ? text.slice(0, 300) : undefined;
    }
  } catch {
    // no reason, just the failure
  }
  cache.set(id, reason);
  return reason;
}

/** A pull request's checks in one word: failed if any failed, running while any runs, else ok; null without checks. */
export function checksOf(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return null;
  const states = rollup.map(c => String(c?.conclusion || c?.state || c?.status || '').toUpperCase());
  if (states.some(s => /^(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE)$/.test(s))) return 'failed';
  if (states.some(s => !s || /^(PENDING|IN_PROGRESS|QUEUED|EXPECTED|WAITING|REQUESTED)$/.test(s))) return 'running';
  return 'ok';
}

const clipTitle = t => (typeof t === 'string' ? t.slice(0, 120) : '');
/** A repo's open pull requests (with their checks) and the last few merged: { open, merged }. */
export async function pullRequests(repo, runner = run) {
  const res = await runner('gh', ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '10', '--json', 'number,title,url,isDraft,headRefName,statusCheckRollup'], { timeoutMs: 20000 });
  if (res.code !== 0) throw new Error(`gh pr list failed for ${repo}: ${res.stderr.trim().slice(0, 200)}`);
  const merged = await runner('gh', ['pr', 'list', '-R', repo, '--state', 'merged', '--limit', '3', '--json', 'number,title,url,mergedAt'], { timeoutMs: 20000 });
  const list = text => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
  return {
    open: list(res.stdout).map(p => ({ number: p.number, title: clipTitle(p.title), url: typeof p.url === 'string' ? p.url : undefined, draft: p.isDraft === true, branch: typeof p.headRefName === 'string' ? p.headRefName : undefined, checks: checksOf(p.statusCheckRollup) })),
    merged: merged.code === 0 ? list(merged.stdout).map(p => ({ number: p.number, title: clipTitle(p.title), url: typeof p.url === 'string' ? p.url : undefined, at: Date.parse(p.mergedAt) || undefined })) : [],
  };
}

export async function deployStatus(repo, runner = run, cache = reasons) {
  const res = await runner('gh', ['run', 'list', '-R', repo, '--limit', '1', '--json', RUN_FIELDS], { timeoutMs: 20000 });
  if (res.code !== 0) throw new Error(`gh run list failed for ${repo}: ${res.stderr.trim().slice(0, 200)}`);
  const d = parseRunList(res.stdout);
  if (d?.conclusion === 'failure' && d.id) {
    d.reason = await failureReason(repo, d.id, runner, cache);
    d.blocked = BLOCKED.test(d.reason ?? ''); // GitHub never started it: not a failed deploy
  }
  return d;
}
