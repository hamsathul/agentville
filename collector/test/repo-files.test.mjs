import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoFiles } from '../derive/repo-files.mjs';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const R = '/code/app';

test('files from every session in the repo are merged, newest first, relative to the repo', () => {
  const r = repoFiles({
    repo: R, now: NOW,
    sessions: [
      { id: 's1', touched: [{ path: `${R}/web/index.html`, wrote: true, at: NOW - 2 * MIN }, { path: `${R}/README.md`, wrote: false, at: NOW - 9 * MIN }, { path: '/elsewhere/x.ts', wrote: true, at: NOW }] },
      { id: 's2', touched: [{ path: `${R}/web/index.html`, wrote: true, at: NOW - 1 * MIN }, { path: `${R}/src/a.ts`, wrote: false, at: NOW - 5 * MIN }] },
    ],
    status: { 'web/index.html': 'M' },
  });
  assert.deepEqual(r, {
    files: [
      { path: 'web/index.html', wrote: true, doc: false, git: 'M', at: NOW - MIN, agents: [{ id: 's2', wrote: true, at: NOW - MIN }, { id: 's1', wrote: true, at: NOW - 2 * MIN }] },
      { path: 'src/a.ts', wrote: false, doc: false, git: null, at: NOW - 5 * MIN, agents: [{ id: 's2', wrote: false, at: NOW - 5 * MIN }] },
      { path: 'README.md', wrote: false, doc: true, git: null, at: NOW - 9 * MIN, agents: [{ id: 's1', wrote: false, at: NOW - 9 * MIN }] },
    ],
    truncated: false,
  });
});

test('one session that read then wrote a file counts once, as a writer', () => {
  const r = repoFiles({ repo: R, now: NOW, sessions: [{ id: 's1', touched: [{ path: `${R}/a.ts`, wrote: false, at: NOW - 3 * MIN }, { path: `${R}/a.ts`, wrote: true, at: NOW - MIN }] }] });
  assert.deepEqual(r.files[0].agents, [{ id: 's1', wrote: true, at: NOW - MIN }]);
});

test('secret-looking files, files older than a day, and a folder that only shares the prefix are left out', () => {
  const r = repoFiles({
    repo: R, now: NOW,
    sessions: [{ id: 's1', touched: [
      { path: `${R}/.env`, wrote: true, at: NOW },
      { path: `${R}/keys/deploy.pem`, wrote: false, at: NOW },
      { path: `${R}/old.ts`, wrote: true, at: NOW - 25 * 60 * MIN },
      { path: `${R}-other/x.ts`, wrote: true, at: NOW },
      { path: `${R}/ok.mdx`, wrote: true, at: NOW },
    ] }],
  });
  assert.deepEqual(r.files.map(f => [f.path, f.doc]), [['ok.mdx', true]]);
});

test('at most 300 files, then truncated', () => {
  const touched = Array.from({ length: 305 }, (_, i) => ({ path: `${R}/f${i}.ts`, wrote: false, at: NOW - i }));
  const r = repoFiles({ repo: R, now: NOW, sessions: [{ id: 's1', touched }] });
  assert.equal(r.files.length, 300);
  assert.equal(r.truncated, true);
  assert.equal(r.files[0].path, 'f0.ts');
});
