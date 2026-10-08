import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

// Where a new session may start: any folder in your home folder or on a mounted drive (/Volumes),
// typed, picked from suggestions, or made. Every path is checked here at its real place (links
// followed), so neither "..", nor a link, leads out of those places.

const OUTSIDE = 'Only a folder in your home folder or a drive (/Volumes) can be used.';
const MAX_DIRS = 300;
const byName = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' });

/** ~ and ~/x as your home folder; anything else must start with /. Null for what isn't a path. */
function absolute(typed, home) {
  if (typeof typed !== 'string') return null;
  const t = typed.trim();
  if (!t || t.length > 1024 || /[\0\r\n]/.test(t)) return null;
  const p = t === '~' ? home : t.startsWith('~/') ? join(home, t.slice(2)) : t;
  return isAbsolute(p) ? resolve(p) : null;
}

const realRoots = async roots => (await Promise.all(roots.map(r => realpath(r).catch(() => null)))).filter(Boolean);
const inside = (real, roots) => roots.some(r => real === r || real.startsWith(r.endsWith(sep) ? r : `${r}${sep}`));

/** Where a path really is: the real path of the nearest part of it that exists, and the names still to make below that. */
async function realOf(path) {
  const rest = [];
  for (let at = path; ; at = dirname(at)) {
    try {
      return { real: await realpath(at), rest };
    } catch {
      if (dirname(at) === at) return { real: null, rest };
      rest.unshift(basename(at));
    }
  }
}

/** A typed path, checked: { path (absolute, as typed), real, rest, kind: 'dir', 'file' or null (missing), roots } or { error }. */
async function place(typed, { home, roots }) {
  const path = absolute(typed, home);
  if (!path) return { error: 'Type a folder: a full path, starting with / or ~.' };
  const { real, rest } = await realOf(path);
  const allowed = await realRoots(roots);
  if (!real || !inside(real, allowed)) return { error: OUTSIDE };
  const s = rest.length ? null : await stat(real).catch(() => null);
  return { path, real, rest, kind: s?.isDirectory() ? 'dir' : s ? 'file' : null, roots: allowed };
}

/**
 * Suggestions for what you typed, like a terminal's Tab: "~/co" lists ~ for names starting "co",
 * "~/code/" lists ~/code. Folders only (links too, if they stay in the allowed places), hidden ones
 * only once you type the dot. Also says whether the typed folder exists, and the one above.
 */
export async function listDirs(typed, { home, roots }) {
  const at = await place(typed, { home, roots });
  if (at.error) return { error: at.error };
  const t = typed.trim();
  const whole = t === '~' || t.endsWith('/');
  const dir = whole ? at : await place(dirname(at.path), { home, roots });
  if (dir.error) return { error: dir.error };
  const prefix = whole ? '' : basename(at.path);
  const out = { home, path: at.path, exists: at.kind === 'dir', isFile: at.kind === 'file', dir: dir.path, up: dir.roots.includes(dir.real) ? null : dirname(dir.path), dirs: [], truncated: false };
  if (dir.kind !== 'dir') return out;
  let entries;
  try {
    entries = await readdir(dir.real, { withFileTypes: true });
  } catch {
    return { ...out, unreadable: true };
  }
  const names = [];
  for (const e of entries) {
    if ((e.name.startsWith('.') && !prefix.startsWith('.')) || !e.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    if (e.isDirectory()) names.push(e.name);
    else if (e.isSymbolicLink()) {
      const real = await realpath(join(dir.real, e.name)).catch(() => null);
      if (real && inside(real, dir.roots) && (await stat(real).catch(() => null))?.isDirectory()) names.push(e.name);
    }
  }
  names.sort(byName);
  return { ...out, dirs: names.slice(0, MAX_DIRS), truncated: names.length > MAX_DIRS };
}

/** A folder to start a session in: { path } (its real path) if it exists in an allowed place, else { error }. */
export async function startPlace(typed, opts) {
  const at = await place(typed, opts);
  if (at.error) return at;
  if (at.kind === 'dir') return { path: at.real };
  return { error: at.kind === 'file' ? "That is a file, not a folder." : "That folder doesn't exist yet: create it first." };
}

/** Makes a folder (and any missing folders above it) in an allowed place, at its real path. */
export async function makeDir(typed, opts) {
  const at = await place(typed, opts);
  if (at.error) return { ok: false, error: at.error };
  if (at.kind === 'dir') return { ok: true, path: at.real };
  if (at.kind === 'file' || !(await stat(at.real).catch(() => null))?.isDirectory()) return { ok: false, error: 'A file of that name is in the way.' };
  const path = join(at.real, ...at.rest);
  try {
    await mkdir(path, { recursive: true });
  } catch (err) {
    return { ok: false, error: `The folder could not be made (${err.code ?? err.message}).` };
  }
  return { ok: true, path };
}
