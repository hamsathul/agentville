import { NO_FILE_LINKS } from './win-links.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { checkFolderFile, listFolder, readFolderFile } from '../sources/files.mjs';

const write = (dir, rel, body) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
};

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-files-'));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q', '-b', 'main');
  write(dir, '.gitignore', 'node_modules/\n.env\n*.log\n');
  write(dir, 'README.md', '# Hi\n');
  write(dir, 'src/app.ts', 'export const a = 1;\n');
  write(dir, 'src/util/x.ts', 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  write(dir, 'src/app.ts', 'export const a = 2;\n');
  write(dir, 'notes.txt', 'new\n');
  write(dir, '.env', 'SECRET=1\n');
  write(dir, '.env.local', 'SECRET=2\n');
  write(dir, 'node_modules/lib/index.js', '');
  write(dir, 'debug.log', 'x');
  write(dir, 'bin.dat', Buffer.from([0, 1, 2, 3]));
  write(dir, 'big.txt', 'x'.repeat(2 * 1024 * 1024 + 1));
  return dir;
}

test('a git folder lists tracked and new files with their status; ignored and secret-looking files are left out', async () => {
  const dir = repo();
  assert.deepEqual(await listFolder(dir, { home: '/nowhere' }), {
    git: true,
    files: ['.gitignore', 'README.md', 'big.txt', 'bin.dat', 'notes.txt', 'src/app.ts', 'src/util/x.ts'],
    status: { 'big.txt': 'U', 'bin.dat': 'U', 'notes.txt': 'U', 'src/app.ts': 'M' },
    repos: [{ path: '', top: realpathSync.native(dir), name: basename(dir), branch: 'main' }],
    truncated: false,
  });
});

test('a subfolder of a repo lists only its own files, relative to itself', async () => {
  const dir = repo();
  const r = await listFolder(join(dir, 'src'), { home: '/nowhere' });
  assert.deepEqual(r.files, ['app.ts', 'util/x.ts']);
  assert.deepEqual(r.status, { 'app.ts': 'M' });
  assert.deepEqual(r.repos, [{ path: '', top: realpathSync.native(dir), name: basename(dir), branch: 'main' }]);
});

test('a long listing is cut at the limit and says so', async () => {
  const r = await listFolder(repo(), { home: '/nowhere', max: 3 });
  assert.equal(r.files.length, 3);
  assert.equal(r.truncated, true);
});

test('a folder outside git is walked, skipping dependencies, hidden folders and secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-plain-'));
  write(dir, 'a.md', '# A');
  write(dir, 'sub/b.ts', 'b');
  write(dir, 'node_modules/x.js', '');
  write(dir, '.hidden/y.txt', '');
  write(dir, '.env', 'S=1');
  write(dir, 'keys/server.pem', 'k');
  assert.deepEqual(await listFolder(dir, { home: '/nowhere' }), { git: false, files: ['a.md', 'sub/b.ts'], status: {}, repos: [], truncated: false });
});

test('the home folder and the disk root are not listed', async () => {
  const dir = repo();
  assert.match((await listFolder(dir, { home: dir })).error, /home folder/);
  assert.match((await listFolder('/', { home: '/nowhere' })).error, /home folder/);
});

test('a file inside the folder is read; everything the explorer hides is refused', { skip: NO_FILE_LINKS }, async () => {
  const dir = repo();
  symlinkSync('/etc/hosts', join(dir, 'hosts.txt'));
  const ok = await readFolderFile(dir, join(dir, 'src/app.ts'));
  assert.equal(ok.doc.text, 'export const a = 2;\n');
  assert.equal(ok.doc.path, join(dir, 'src/app.ts'));
  const refused = async (cwd, path, re) => assert.match((await readFolderFile(cwd, path)).error, re, path);
  await refused(join(dir, 'src'), join(dir, 'README.md'), /outside/);
  await refused(dir, join(dir, 'hosts.txt'), /outside/);
  await refused(dir, 'src/app.ts', /outside/);
  await refused(dir, join(dir, 'debug.log'), /ignores/);
  await refused(dir, join(dir, 'node_modules/lib/index.js'), /ignores/);
  await refused(dir, join(dir, '.env.local'), /secrets/);
  await refused(dir, join(dir, '.git/config'), /Git's own/);
  await refused(dir, join(dir, 'bin.dat'), /binary/);
  await refused(dir, join(dir, 'big.txt'), /too large/);
  await refused(dir, join(dir, 'gone.txt'), /no longer exists/);
});

test("a picture, a PDF or any binary passes the same rules for its bytes: binary and large files too, the rest refused alike", async () => {
  const dir = repo();
  const ok = await checkFolderFile(dir, join(dir, 'bin.dat'));
  assert.equal(ok.real, join(realpathSync.native(dir), 'bin.dat'));
  assert.ok(ok.size > 0);
  assert.ok((await checkFolderFile(dir, join(dir, 'big.txt'))).real, 'size is for the caller to judge');
  for (const [path, re] of [['debug.log', /ignores/], ['.env.local', /secrets/], ['.git/config', /Git's own/], ['gone.txt', /no longer exists/]]) assert.match((await checkFolderFile(dir, join(dir, path))).error, re, path);
  assert.match((await checkFolderFile(join(dir, 'src'), join(dir, 'README.md'))).error, /outside/);
});

test('outside git, files in skipped folders are refused too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-plain-'));
  write(dir, 'node_modules/x.js', 'x');
  write(dir, '.hidden/y.txt', 'y');
  write(dir, 'ok.txt', 'fine');
  assert.equal((await readFolderFile(dir, join(dir, 'ok.txt'))).doc.text, 'fine');
  assert.match((await readFolderFile(dir, join(dir, 'node_modules/x.js'))).error, /hidden/);
  assert.match((await readFolderFile(dir, join(dir, '.hidden/y.txt'))).error, /hidden/);
});

test('a plain folder holding git repos lists each repo the way git sees it', async () => {
  const outer = mkdtempSync(join(tmpdir(), 'tracker-outer-'));
  write(outer, 'notes.md', 'n');
  write(outer, 'svc/.gitignore', 'dist/\n');
  write(outer, 'svc/src.ts', 'one');
  const git = (...args) => execFileSync('git', ['-C', join(outer, 'svc'), '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q', '-b', 'dev');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  write(outer, 'svc/src.ts', 'two');
  write(outer, 'svc/dist/out.js', 'built');
  assert.deepEqual(await listFolder(outer, { home: '/nowhere' }), {
    git: false,
    files: ['notes.md', 'svc/.gitignore', 'svc/src.ts'],
    status: { 'svc/src.ts': 'M' },
    repos: [{ path: 'svc', top: realpathSync.native(join(outer, 'svc')), name: 'svc', branch: 'dev' }],
    truncated: false,
  });
  assert.equal((await readFolderFile(outer, join(outer, 'svc/src.ts'))).doc.text, 'two');
  assert.match((await readFolderFile(outer, join(outer, 'svc/dist/out.js'))).error, /ignores/);
});
