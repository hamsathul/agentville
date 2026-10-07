import { run } from '../lib/exec.mjs';

const RUN_FIELDS = 'status,conclusion,headSha,createdAt,workflowName,url,displayTitle,databaseId';
const reasons = new Map(); // run id → why it failed (GitHub's annotation), asked once per run

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

export async function deployStatus(repo, runner = run, cache = reasons) {
  const res = await runner('gh', ['run', 'list', '-R', repo, '--limit', '1', '--json', RUN_FIELDS], { timeoutMs: 20000 });
  if (res.code !== 0) throw new Error(`gh run list failed for ${repo}: ${res.stderr.trim().slice(0, 200)}`);
  const d = parseRunList(res.stdout);
  if (d?.conclusion === 'failure' && d.id) d.reason = await failureReason(repo, d.id, runner, cache);
  return d;
}
