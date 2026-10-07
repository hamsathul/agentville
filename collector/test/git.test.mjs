import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { RepoResolver, repoStatus } from '../sources/git.mjs';

const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: { ...process.env, ...ID } });
const tmp = prefix => realpathSync(mkdtempSync(join(tmpdir(), prefix)));

function makeRepo() {
  const dir = tmp('tracker-git-');
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('topOf finds the repo for a folder, a file, and a file that does not exist yet', async () => {
  const repo = makeRepo();
  mkdirSync(join(repo, 'src'));
  const r = new RepoResolver();
  assert.equal(await r.topOf(repo), repo);
  assert.equal(await r.topOf(join(repo, 'a.txt')), repo);
  assert.equal(await r.topOf(join(repo, 'src', 'new', 'deep.ts')), repo);
  assert.equal(r.lookup(join(repo, 'a.txt')), repo);
});

test('topOf is null outside a repo and lookup is undefined before resolving', async () => {
  const dir = tmp('tracker-norepo-');
  const r = new RepoResolver();
  assert.equal(r.lookup(dir), undefined);
  assert.equal(await r.topOf(dir), null);
  assert.equal(r.lookup(dir), null);
});

test('repoStatus reports branch, dirty count and ahead/behind against origin/main', async () => {
  const origin = makeRepo();
  const clone = tmp('tracker-clone-');
  git(clone, 'clone', '-q', origin, '.');
  writeFileSync(join(clone, 'b.txt'), 'b');
  git(clone, 'add', 'b.txt');
  git(clone, 'commit', '-q', '-m', 'b');
  writeFileSync(join(clone, 'dirty.txt'), 'x');
  const s = await repoStatus(clone);
  assert.equal(s.branch, 'main');
  assert.equal(s.dirty, 1);
  assert.equal(s.ahead, 1);
  assert.equal(s.behind, 0);
  assert.equal(s.name, basename(clone));
});

test('repoStatus without a remote leaves ahead/behind undefined', async () => {
  const s = await repoStatus(makeRepo());
  assert.equal(s.ahead, undefined);
  assert.equal(s.behind, undefined);
});

test('every git call runs with GIT_OPTIONAL_LOCKS=0', async () => {
  const seen = [];
  const runner = async (cmd, args, opts) => {
    seen.push(opts?.env?.GIT_OPTIONAL_LOCKS);
    return { code: 0, stdout: args.includes('rev-list') ? '0\t0\n' : '', stderr: '' };
  };
  await repoStatus('/x', runner);
  await new RepoResolver({ runner }).topOf(tmpdir());
  assert.ok(seen.length >= 4);
  assert.ok(seen.every(v => v === '0'));
});

test('an expired entry keeps being served (so collisions do not blink) and is flagged for refresh', async () => {
  let clock = 0;
  const repo = makeRepo();
  const r = new RepoResolver({ ttlMs: 1000, now: () => clock });
  assert.equal(r.needsRefresh(repo), true);
  await r.topOf(repo);
  assert.equal(r.needsRefresh(repo), false);
  clock = 5000;
  assert.equal(r.lookup(repo), repo);
  assert.equal(r.needsRefresh(repo), true);
  await r.topOf(repo);
  assert.equal(r.needsRefresh(repo), false);
});
