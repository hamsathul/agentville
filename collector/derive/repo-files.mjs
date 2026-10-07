import { SECRET_FILE } from '../sources/files.mjs';

// The farm's field close-up: the files agents read or wrote in one repo, from every session's
// file-tool calls, merged per file with who touched it and when.
const DOC_FILE = /\.(md|markdown|mdx)$/i;
const DAY_MS = 86_400_000;

/** sessions: [{ id, touched: [{ path, wrote, at }] }]; status: git letters by path relative to the repo. */
export function repoFiles({ repo, sessions, status = {}, now, max = 300, windowMs = DAY_MS }) {
  const byPath = new Map();
  for (const s of sessions) {
    for (const f of s.touched) {
      if (f.at < now - windowMs || !f.path.startsWith(`${repo}/`)) continue;
      const rel = f.path.slice(repo.length + 1);
      if (SECRET_FILE.test(rel)) continue;
      let entry = byPath.get(rel);
      if (!entry) byPath.set(rel, (entry = { path: rel, wrote: false, at: 0, agents: new Map() }));
      entry.wrote ||= f.wrote;
      entry.at = Math.max(entry.at, f.at);
      const prev = entry.agents.get(s.id);
      entry.agents.set(s.id, { id: s.id, wrote: Boolean(prev?.wrote || f.wrote), at: Math.max(prev?.at ?? 0, f.at) });
    }
  }
  const all = [...byPath.values()].sort((a, b) => b.at - a.at);
  const files = all.slice(0, max).map(e => ({
    path: e.path,
    wrote: e.wrote,
    doc: DOC_FILE.test(e.path),
    git: status[e.path] ?? null,
    at: e.at,
    agents: [...e.agents.values()].sort((a, b) => b.at - a.at),
  }));
  return { files, truncated: all.length > max };
}
