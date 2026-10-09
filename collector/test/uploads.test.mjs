import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFiles, checkFolders, pruneUploads, safeName, saveFiles, typedPart, withAttachments } from '../sources/uploads.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const b64 = buf => buf.toString('base64');

test('any file can be attached: screenshots, PDFs, Markdown, text', () => {
  const r = checkFiles([{ name: 'a.png', data: b64(PNG) }, { name: 'notes.md', data: b64(Buffer.from('# Notes')) }, { name: 'Report.PDF', data: b64(Buffer.from('%PDF-1.7')) }]);
  assert.deepEqual(r.files.map(f => f.name), ['a.png', 'notes.md', 'Report.pdf']);
  assert.ok(r.files[0].bytes.equals(PNG));
  assert.deepEqual(checkFiles(undefined), { files: [] });
});

test('an empty file, too many files, or too big a file is refused', () => {
  assert.match(checkFiles([{ name: 'x.md', data: '' }]).error, /x\.md is empty/);
  assert.match(checkFiles('nope').error, /could not be read/);
  assert.match(checkFiles(Array.from({ length: 7 }, () => ({ data: b64(PNG) }))).error, /at most 6/);
  const huge = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
  assert.match(checkFiles([{ name: 'big.pdf', data: b64(huge) }]).error, /big\.pdf is too large/);
});

test("a file's name is kept, made safe to save; a pasted picture without a name is named by its bytes", () => {
  assert.equal(safeName('Screenshot 2026-10-08 at 8.31.12 AM.png'), 'Screenshot-2026-10-08-at-8.31.12-AM.png');
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('C:\\Users\\me\\plan.docx'), 'plan.docx');
  assert.equal(safeName('.env'), 'env');
  assert.equal(safeName('تقرير.pdf'), 'file.pdf', 'a name with no letters it can keep');
  assert.equal(safeName('', PNG), 'file.png');
  assert.equal(safeName('image', JPEG), 'image.jpg');
  assert.equal(safeName(`${'x'.repeat(200)}.md`), `${'x'.repeat(60)}.md`);
});

test('files are saved whole under the session, and the message tells the agent where they are', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-uploads-'));
  const paths = saveFiles(dir, 'sess-1', checkFiles([{ name: 'shot.png', data: b64(PNG) }, { name: 'notes.md', data: b64(Buffer.from('# Notes')) }]).files);
  assert.equal(paths.length, 2);
  assert.match(paths[0], /\/sess-1\/[\w-]+-1-shot\.png$/);
  assert.match(paths[1], /-2-notes\.md$/);
  assert.ok(readFileSync(paths[0]).equals(PNG));
  assert.throws(() => saveFiles(dir, '../evil', []), /session id/);
  assert.equal(withAttachments('Fix this', []), 'Fix this');
  assert.equal(withAttachments('Fix this', ['/u/1.png']), 'Fix this\n\nI attached a file. Open it with the Read tool:\n/u/1.png');
  assert.equal(withAttachments('', ['/u/1.png', '/u/2.pdf']), 'Please look at the files I attached. Open each with the Read tool:\n/u/1.png\n/u/2.pdf');
});

test('a folder is attached by its path: the agent looks in it with its own tools', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-folder-'));
  writeFileSync(join(dir, 'a.txt'), 'x');
  assert.deepEqual(checkFolders([`${dir}/`]), { folders: [dir] });
  assert.deepEqual(checkFolders(undefined), { folders: [] });
  for (const bad of [['relative/x'], [join(dir, 'a.txt')], [join(dir, 'gone')], 'x', [42], Array(7).fill(dir)]) assert.ok(checkFolders(bad).error, JSON.stringify(bad));
  assert.equal(withAttachments('See this', [], ['/w/site']), 'See this\n\nI attached a folder. Look in it with your tools:\n/w/site');
  assert.equal(withAttachments('', [], ['/w/a', '/w/b']), 'Please look at the folders I attached. Look in each with your tools:\n/w/a\n/w/b');
  assert.equal(withAttachments('Both', ['/u/1.png'], ['/w/a']), 'Both\n\nI attached a file. Open it with the Read tool:\n/u/1.png\n\nI attached a folder. Look in it with your tools:\n/w/a');
  assert.equal(withAttachments('', ['/u/1.png'], ['/w/a']), 'Please look at what I attached.\n\nI attached a file. Open it with the Read tool:\n/u/1.png\n\nI attached a folder. Look in it with your tools:\n/w/a');
});

test('attachments older than a week are cleared away', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-uploads-'));
  mkdirSync(join(dir, 's1'));
  writeFileSync(join(dir, 's1', 'old.png'), 'x');
  writeFileSync(join(dir, 's1', 'new.png'), 'x');
  const now = Date.now();
  const old = (now - 8 * 86_400_000) / 1000;
  utimesSync(join(dir, 's1', 'old.png'), old, old);
  pruneUploads(dir, now);
  assert.equal(existsSync(join(dir, 's1', 'old.png')), false);
  assert.equal(existsSync(join(dir, 's1', 'new.png')), true);
  pruneUploads('/nonexistent/uploads', now);
});

test('what you typed in a message is told apart from the attachment notes added to it', () => {
  for (const [text, files, folders] of [['Fix this', ['/u/1.png'], []], ['See this\nand that', [], ['/w/site']], ['Both', ['/u/1.png', '/u/2.pdf'], ['/w/a', '/w/b']], ['Plain', [], []]]) {
    assert.equal(typedPart(withAttachments(text, files, folders)), text, text);
  }
  for (const [files, folders] of [[['/u/1.png'], []], [['/u/1.png', '/u/2.pdf'], []], [[], ['/w/a']], [['/u/1.png'], ['/w/a']]]) {
    assert.equal(typedPart(withAttachments('', files, folders)), '', 'only files: nothing typed');
  }
  assert.equal(typedPart('I attached a file earlier, did you see it?'), 'I attached a file earlier, did you see it?', 'words of your own are kept');
});
