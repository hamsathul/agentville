import { run } from '../lib/exec.mjs';

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
  };
}

export async function deployStatus(repo, runner = run) {
  const res = await runner('gh', ['run', 'list', '-R', repo, '--limit', '1', '--json', 'status,conclusion,headSha,createdAt,workflowName'], { timeoutMs: 20000 });
  if (res.code !== 0) throw new Error(`gh run list failed for ${repo}: ${res.stderr.trim().slice(0, 200)}`);
  return parseRunList(res.stdout);
}
