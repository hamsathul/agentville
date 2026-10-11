import { fromGit } from '../platform/paths.mjs';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { run } from '../lib/exec.mjs';
import { GIT_ENV } from './git.mjs';

// The dashboard's file explorer: an agent's working folder, read-only. In a git folder it lists
// what git tracks plus new files git doesn't ignore; elsewhere it walks the folder, skipping
// dependency and hidden folders. Files that commonly hold secrets are never listed or served.
const MAX_FILES = 5000;
const MAX_BYTES = 2 * 1024 * 1024;
const WALK_DEPTH = 8;
const SKIP_DIRS = new Set(['node_modules', '.git']);
export const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]*)?|[^/]*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|dsa|ecdsa|ed25519)|\.npmrc|\.pypirc|\.netrc)$/i;

const STATUS_CODE = xy => (xy === '??' ? 'U' : xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : xy.includes('R') ? 'R' : 'M');

/** `git status --porcelain=v1 -z` → { path relative to the folder: M | U | A | D | R }. */
export function parsePorcelain(out, prefix) {
  const status = {};
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the next part is the original path
    if (path.startsWith(prefix)) status[path.slice(prefix.length)] = STATUS_CODE(xy);
  }
  return status;
}

/** A git folder as git sees it: tracked files plus new ones it doesn't ignore, with their status. Null outside git. */
async function listRepo(dir, runner) {
  const git = args => runner('git', ['-C', dir, ...args], { env: GIT_ENV, timeoutMs: 10_000 });
  const inRepo = await git(['rev-parse', '--show-toplevel', '--show-prefix']);
  if (inRepo.code !== 0) return null;
  const [gitTop, prefix = ''] = inRepo.stdout.split('\n');
  const top = fromGit(gitTop);
  const listed = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (listed.code !== 0) return { error: `git could not list this folder (${listed.stderr.trim().slice(0, 200)}).` };
  const files = [...new Set(listed.stdout.split('\0').filter(Boolean))].filter(p => !SECRET_FILE.test(p)).sort();
  const st = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  let branch = (await git(['branch', '--show-current'])).stdout.trim();
  if (!branch) {
    const head = (await git(['rev-parse', '--short', 'HEAD'])).stdout.trim();
    branch = head ? `detached ${head}` : '?';
  }
  return { files, status: st.code === 0 ? parsePorcelain(st.stdout, prefix.trim()) : {}, top, name: basename(top), branch };
}

/** A folder outside git: walked breadth-first, skipping dependency and hidden folders; repos inside it are listed by git. */
async function walk(cwd, max, runner) {
  const files = [];
  const status = {};
  const repos = [];
  const queue = [['', 0]];
  const add = rel => {
    if (files.length >= max) return false;
    files.push(rel);
    return true;
  };
  while (queue.length) {
    const [dir, depth] = queue.shift();
    let entries;
    try {
      entries = readdirSync(join(cwd, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const repo = existsSync(join(cwd, rel, '.git')) ? await listRepo(join(cwd, rel), runner) : null;
        if (repo?.files) {
          repos.push({ path: rel, top: repo.top, name: repo.name, branch: repo.branch });
          for (const f of repo.files) if (!add(`${rel}/${f}`)) return { files: files.sort(), status, repos, truncated: true };
          for (const [path, code] of Object.entries(repo.status)) status[`${rel}/${path}`] = code;
        } else if (depth + 1 < WALK_DEPTH) {
          queue.push([rel, depth + 1]);
        }
      } else if ((e.isFile() || e.isSymbolicLink()) && !SECRET_FILE.test(rel)) {
        if (!add(rel)) return { files: files.sort(), status, repos, truncated: true };
      }
    }
  }
  const shown = new Set(files);
  for (const path of Object.keys(status)) if (!shown.has(path)) delete status[path];
  return { files: files.sort(), status, repos: repos.sort((a, b) => (a.path < b.path ? -1 : 1)), truncated: false };
}

/** The files under `cwd`, relative to it, with git status where there is one. */
export async function listFolder(cwd, { home = homedir(), runner = run, max = MAX_FILES } = {}) {
  if (!cwd || cwd === '/' || cwd === home) {
    return { error: 'This agent works in your home folder (or the disk root), so the explorer stays off here.' };
  }
  const repo = await listRepo(cwd, runner);
  if (!repo) return { git: false, ...(await walk(cwd, max, runner)) };
  if (repo.error) return { error: repo.error };
  const files = repo.files.slice(0, max);
  const shown = new Set(files);
  const status = Object.fromEntries(Object.entries(repo.status).filter(([path]) => shown.has(path)));
  return { git: true, files, status, repos: [{ path: '', top: repo.top, name: repo.name, branch: repo.branch }], truncated: repo.files.length > max };
}

/**
 * Whether a file may be shown, under the rules the listing follows: inside the folder (links
 * followed), not git's own, not one that may hold secrets, not one git ignores or in a skipped
 * folder. { real, size, mtimeMs } (its real path), or { status, error }.
 */
export async function checkFolderFile(cwd, path, { runner = run } = {}) {
  const outside = { status: 403, error: "That file is outside the agent's folder." };
  if (typeof path !== 'string' || !isAbsolute(path)) return outside;
  try {
    const root = realpathSync.native(cwd);
    const real = realpathSync.native(path);
    const rel = relative(root, real);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return outside;
    const parts = rel.split(sep);
    if (parts.includes('.git')) return { status: 403, error: "Git's own files aren't shown here." };
    if (SECRET_FILE.test(parts.join('/'))) return { status: 403, error: "Files that may hold secrets (.env, keys) aren't shown here." };
    // Ask git from the file's own folder, so a repo nested inside a plain folder applies its own ignores.
    const here = dirname(real);
    const inRepo = await runner('git', ['-C', here, 'rev-parse', '--is-inside-work-tree'], { env: GIT_ENV, timeoutMs: 5000 });
    if (inRepo.code === 0) {
      const ignored = await runner('git', ['-C', here, 'check-ignore', '-q', '--', basename(real)], { env: GIT_ENV, timeoutMs: 5000 });
      if (ignored.code === 0) return { status: 403, error: "Git ignores this file, so it isn't shown here." };
    } else if (parts.slice(0, -1).some(p => SKIP_DIRS.has(p) || p.startsWith('.'))) {
      return { status: 403, error: "Files in dependency and hidden folders aren't shown here." };
    }
    const st = statSync(real);
    if (!st.isFile()) return { status: 403, error: 'Only files can be shown here.' };
    return { real, size: st.size, mtimeMs: st.mtimeMs };
  } catch (err) {
    if (err?.code === 'ENOENT') return { status: 404, error: 'That file no longer exists.' };
    return { status: 500, error: `Could not read it (${err?.code ?? err?.message}).` };
  }
}

/** One text file from the agent's folder, under those rules: 2 MB at most, and not binary. */
export async function readFolderFile(cwd, path, { runner = run, maxBytes = MAX_BYTES } = {}) {
  const ok = await checkFolderFile(cwd, path, { runner });
  if (ok.error) return ok;
  if (ok.size > maxBytes) return { status: 413, error: 'That file is too large to show here (2 MB at most).' };
  try {
    const buf = readFileSync(ok.real);
    if (buf.subarray(0, 8000).includes(0)) return { status: 415, error: "This is a binary file, so it isn't shown here." };
    return { doc: { path, text: buf.toString('utf8'), mtimeMs: ok.mtimeMs, size: ok.size } };
  } catch (err) {
    if (err?.code === 'ENOENT') return { status: 404, error: 'That file no longer exists.' };
    return { status: 500, error: `Could not read it (${err?.code ?? err?.message}).` };
  }
}
