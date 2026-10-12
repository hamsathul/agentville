// Folders a new session may start in: suggested as you type, checked, and made when missing.
import { NO_FILE_LINKS } from './win-links.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDirs, makeDir, startPlace } from '../sources/folders.mjs';

function fixture() {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'tracker-home-')));
  for (const d of ['code/app', 'code/api', 'Docs', '.hidden', 'Volumes-like']) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(home, 'notes.txt'), 'x');
  symlinkSync(mkdtempSync(join(tmpdir(), 'tracker-out-')), join(home, 'out')); // a link to a folder outside (one that exists: a link to a missing one is just missing)
  symlinkSync(join(home, 'code'), join(home, 'work')); // a link to one inside
  return { home, roots: [home] };
}

test('suggestions: the subfolders of what you typed, starting with its last part, hidden ones only once you type the dot', { skip: NO_FILE_LINKS }, async () => {
  const f = fixture();
  const at = async typed => listDirs(typed, f);
  assert.deepEqual((await at('~/')).dirs, ['code', 'Docs', 'Volumes-like', 'work'], 'A–Z, folders only, no hidden ones, no link out of the allowed places');
  assert.deepEqual((await at('~')).dirs, ['code', 'Docs', 'Volumes-like', 'work']);
  const co = await at('~/co');
  assert.deepEqual([co.dir, co.dirs, co.path, co.exists], [f.home, ['code'], join(f.home, 'co'), false], 'the last part is the start of a name');
  assert.deepEqual((await at('~/.h')).dirs, ['.hidden']);
  const code = await at(`${f.home}/code/`);
  assert.deepEqual([code.dir, code.dirs, code.exists, code.up, code.home], [join(f.home, 'code'), ['api', 'app'], true, f.home, f.home]);
  assert.equal((await at('~/')).up, null, 'nothing above the allowed places');
  assert.deepEqual((await at('~/work/')).dirs, ['api', 'app'], 'a link to a folder inside is followed');
  assert.equal((await at('~/notes.txt')).isFile, true);
  for (const typed of ['/etc/', '~/../../etc/', '~/out/', 'relative/path', '', '~/a\0b', 42]) assert.ok((await at(typed)).error, JSON.stringify(typed));
  assert.match((await at('/etc/')).error, /home folder or a drive/);
});

test('a folder to start in must exist, be a folder, and be in an allowed place: its real path', { skip: NO_FILE_LINKS }, async () => {
  const f = fixture();
  assert.deepEqual(await startPlace('~/work', f), { path: join(f.home, 'code') });
  assert.deepEqual(await startPlace(`${f.home}/Docs/`, f), { path: join(f.home, 'Docs') });
  assert.match((await startPlace('~/missing', f)).error, /doesn't exist/);
  assert.match((await startPlace('~/notes.txt', f)).error, /not a folder/);
  for (const typed of ['/etc', '~/out', '~/..', 'code']) assert.ok((await startPlace(typed, f)).error, typed);
});

test('a missing folder is made, with any missing parents, only in an allowed place', { skip: NO_FILE_LINKS }, async () => {
  const f = fixture();
  assert.deepEqual(await makeDir('~/code/new/deep', f), { ok: true, path: join(f.home, 'code', 'new', 'deep') });
  assert.ok(existsSync(join(f.home, 'code', 'new', 'deep')));
  assert.deepEqual(await makeDir('~/work/viaLink', f), { ok: true, path: join(f.home, 'code', 'viaLink') }, 'made at its real path');
  assert.deepEqual(await makeDir('~/Docs', f), { ok: true, path: join(f.home, 'Docs') }, 'one that exists is fine');
  assert.match((await makeDir('~/notes.txt/x', f)).error, /file/);
  for (const typed of ['/etc/x', '~/out/x', '~/../x', 'x', '']) {
    const r = await makeDir(typed, f);
    assert.equal(r.ok, false, typed);
    assert.ok(r.error, typed);
  }
});
