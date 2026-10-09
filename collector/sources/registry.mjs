import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Live Claude Code processes from ~/.claude/sessions/<pid>.json. */
export function readRegistry(dir, isAlive = isPidAlive) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    let entry;
    try {
      entry = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    if (!entry?.sessionId || !Number.isInteger(entry.pid) || !isAlive(entry.pid)) continue;
    out.push({
      pid: entry.pid,
      sessionId: entry.sessionId,
      cwd: entry.cwd ?? '',
      name: entry.name ?? '',
      kind: entry.kind ?? 'interactive',
      entrypoint: entry.entrypoint ?? '',
      status: entry.status ?? '',
      version: entry.version ?? '',
      startedAt: entry.startedAt ?? 0,
      nameSource: entry.nameSource ?? '',
    });
  }
  return out;
}
