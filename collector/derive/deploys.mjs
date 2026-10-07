import { isDirectDeploy } from './step.mjs';

// Deploys done straight from a session (a deploy script over ssh, rsync to a server, vercel --prod…),
// next to the repo's GitHub Actions runs: whichever is newer says how the repo stands. A run GitHub
// never started (a billing or spending-limit stop) is not a failed deploy.

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The repo a deploy command belongs to: the one repo it names (`--backend`, `/frontend`) among
 * those in the session's folder and the repo it ran in; else the repo it ran in (the shell may have
 * been left in another checkout, so a name in the command wins); else the only repo in the folder.
 * No guess when it names two, or none and ran in no repo of a folder holding several.
 */
export function repoOfCall(call, { lookup, known, folder }) {
  const own = call.cwd ? lookup(call.cwd) : null;
  const base = folder ? `${folder.replace(/\/+$/, '')}/` : null;
  const inside = base ? known.filter(path => path.startsWith(base)) : [];
  const candidates = [...new Set([...inside, ...(own ? [own] : [])])];
  const command = String(call.input?.command ?? '');
  const named = candidates.filter(path => new RegExp(`(?:^|[^\\w.])${escapeRe(path.split('/').pop())}(?![\\w-])`).test(command));
  if (named.length === 1) return named[0];
  if (named.length > 1) return null;
  return own ?? (inside.length === 1 ? inside[0] : null);
}

/** Keeps in `into` (repo → { at, ok, by, summary }) the newest finished direct deploy of each repo among `calls`. */
export function noteDirectDeploys(into, { calls, by, lookup, known, folder }) {
  for (const call of calls) {
    if (call.ok === undefined || !isDirectDeploy(call.name, call.input)) continue;
    const repo = repoOfCall(call, { lookup, known, folder });
    if (!repo) continue;
    const at = call.endedAt ?? call.at;
    if ((into.get(repo)?.at ?? -Infinity) >= at) continue;
    const said = String(call.input?.description || call.input?.command || '').replace(/\s+/g, ' ').trim();
    into.set(repo, { at, ok: call.ok, by, summary: said.length > 120 ? `${said.slice(0, 119)}…` : said });
  }
  return into;
}

const RUN_WORDS = { running: '◌ deploying', ok: '✓ deployed', failed: '✗ deploy failed', blocked: "⏸ Actions didn't run" };

/**
 * How a repo's last deploy went: the newer of its Actions run and its last direct deploy, as
 * { source, state: running | ok | failed | blocked | other, at, label, detail, url? }.
 */
export function lastDeployOf(run, direct) {
  const fromDirect = direct && {
    source: 'direct', state: direct.ok ? 'ok' : 'failed', at: direct.at,
    label: direct.ok ? '✓ deployed directly' : '✗ deploy failed',
    detail: direct.ok ? `${direct.by} deployed it directly: ${direct.summary}` : `${direct.by}'s deploy command failed: ${direct.summary}`,
  };
  let fromRun = null;
  if (run) {
    const state = run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'ok' : run.conclusion === 'failure' ? (run.blocked ? 'blocked' : 'failed') : 'other';
    const what = state === 'blocked' ? 'never started' : state === 'running' ? run.status : run.conclusion ?? 'finished';
    fromRun = {
      source: 'actions', state, at: run.at ?? 0, label: RUN_WORDS[state] ?? run.conclusion ?? 'done',
      detail: `${run.workflow ?? 'GitHub Actions'} ${what}${run.sha ? ` at ${run.sha}` : ''}${run.reason ? `: ${run.reason}` : ''}`,
      ...(run.url ? { url: run.url } : {}),
    };
  }
  if (!fromRun || !fromDirect) return fromRun ?? fromDirect ?? null;
  return fromDirect.at >= fromRun.at ? fromDirect : fromRun;
}
