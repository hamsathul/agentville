import { run } from '../lib/exec.mjs';

/** Parses `claude agents --json`. Its `state: "blocked"` is kept as cliState only, never used as "waiting". */
export function parseAgentsJson(stdout) {
  const list = JSON.parse(stdout);
  if (!Array.isArray(list)) throw new Error('claude agents --json did not return an array');
  return list
    .filter(a => a && typeof a.sessionId === 'string')
    .map(a => ({
      id: String(a.id ?? a.sessionId.slice(0, 8)),
      sessionId: a.sessionId,
      cwd: a.cwd ?? '',
      kind: a.kind === 'background' ? 'background' : 'interactive',
      name: a.name ?? '',
      pid: Number.isInteger(a.pid) ? a.pid : undefined,
      startedAt: a.startedAt ?? 0,
      cliState: a.state ?? a.status ?? '',
    }));
}

/** `claude agents --json`, run in `env` (an account's, or the collector's own when undefined). */
export async function readAgentsCli(claudeBin = 'claude', runner = run, env = undefined) {
  const res = await runner(claudeBin, ['agents', '--json'], { timeoutMs: 20000, ...(env ? { env } : {}) });
  if (res.code !== 0) throw new Error(`claude agents --json failed: ${res.stderr.trim().slice(0, 200)}`);
  return parseAgentsJson(res.stdout);
}
