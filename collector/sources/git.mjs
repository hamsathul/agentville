import { statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { run } from '../lib/exec.mjs';

// GIT_OPTIONAL_LOCKS=0 stops `git status` taking index.lock, so polling never makes
// another agent's commit fail in a shared checkout.
export const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

/** The nearest existing folder for a file or folder path (paths may not exist yet). */
export function folderOf(path) {
  let p = path;
  while (p && p !== '/') {
    try {
      return statSync(p).isDirectory() ? p : dirname(p);
    } catch {
      p = dirname(p);
    }
  }
  return null;
}

export class RepoResolver {
  constructor({ runner = run, ttlMs = 10 * 60_000, now = Date.now } = {}) {
    this.runner = runner;
    this.ttlMs = ttlMs;
    this.now = now;
    this.cache = new Map();
  }

  /** Git top level for a path, or null outside a repo. */
  async topOf(path) {
    const dir = folderOf(path);
    if (!dir) return null;
    const hit = this.cache.get(dir);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.top;
    const res = await this.runner('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { env: GIT_ENV, timeoutMs: 5000 });
    const top = res.code === 0 && res.stdout.trim() ? res.stdout.trim() : null;
    this.cache.set(dir, { top, at: this.now() });
    return top;
  }

  /**
   * Cached answer only: undefined means "never resolved". An expired entry is still
   * served (stale-while-revalidate) so collisions and the repo rail don't blink at the
   * TTL boundary; needsRefresh() says when to resolve it again.
   */
  lookup(path) {
    const dir = folderOf(path);
    if (!dir) return null;
    return this.cache.get(dir)?.top;
  }

  needsRefresh(path) {
    const dir = folderOf(path);
    if (!dir) return false;
    const hit = this.cache.get(dir);
    return !hit || this.now() - hit.at >= this.ttlMs;
  }
}

const worktrees = new Map(); // top → the main checkout it is a worktree of, or null (it never changes)
/** The main checkout a worktree belongs to (its shared .git's folder), or null for a repo's own checkout. */
export async function mainOf(top, runner = run) {
  if (worktrees.has(top)) return worktrees.get(top);
  const res = await runner('git', ['-C', top, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], { env: GIT_ENV, timeoutMs: 5000 });
  const [dir, common] = res.code === 0 ? res.stdout.trim().split('\n') : [];
  const main = dir && common && dir !== common && basename(common) === '.git' ? dirname(common) : null;
  if (res.code === 0) worktrees.set(top, main);
  return main;
}

const slugs = new Map(); // top → "owner/name" on GitHub, or null
/** The GitHub repo a checkout pushes to (its origin), as "owner/name", or null. */
export async function githubSlug(top, runner = run) {
  if (slugs.has(top)) return slugs.get(top);
  const res = await runner('git', ['-C', top, 'remote', 'get-url', 'origin'], { env: GIT_ENV, timeoutMs: 5000 });
  const slug = res.code === 0 ? res.stdout.trim().match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1] ?? null : null;
  slugs.set(top, slug);
  return slug;
}

export async function repoStatus(top, runner = run) {
  const git = args => runner('git', ['-C', top, ...args], { env: GIT_ENV, timeoutMs: 8000 });
  const [branch, status, main] = await Promise.all([git(['branch', '--show-current']), git(['status', '--porcelain']), mainOf(top, runner)]);
  if (status.code !== 0) throw new Error(`git status failed in ${top}: ${status.stderr.trim().slice(0, 200)}`);
  let ahead;
  let behind;
  for (const base of ['origin/main', 'origin/master']) {
    const res = await git(['rev-list', '--left-right', '--count', `${base}...HEAD`]);
    if (res.code === 0) {
      [behind, ahead] = res.stdout.trim().split(/\s+/).map(Number);
      break;
    }
  }
  return {
    path: top,
    name: basename(top),
    branch: branch.stdout.trim() || '(detached)',
    dirty: status.stdout.split('\n').filter(Boolean).length,
    ahead,
    behind,
    ...(main ? { worktree: true, main } : {}),
  };
}
