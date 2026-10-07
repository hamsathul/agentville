import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkImages, pruneUploads, saveImages, withScreenshots } from '../sources/uploads.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const b64 = buf => buf.toString('base64');

test('screenshots are decoded and recognised by their bytes, not their names', () => {
  const r = checkImages([{ name: 'a.png', data: b64(PNG) }, { name: 'b.txt', data: b64(JPEG) }]);
  assert.deepEqual(r.images.map(i => i.ext), ['png', 'jpg']);
  assert.ok(r.images[0].bytes.equals(PNG));
  assert.deepEqual(checkImages(undefined), { images: [] });
});

test('anything that is not a picture, too many pictures, or too big a picture is refused', () => {
  assert.match(checkImages([{ data: b64(Buffer.from('<svg onload=x>')) }]).error, /PNG, JPEG, GIF and WebP/);
  assert.match(checkImages([{ data: '' }]).error, /empty/);
  assert.match(checkImages('nope').error, /could not be read/);
  assert.match(checkImages(Array.from({ length: 7 }, () => ({ data: b64(PNG) }))).error, /at most 6/);
  const huge = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
  assert.match(checkImages([{ data: b64(huge) }]).error, /too large/);
});

test('screenshots are saved whole under the session, and the message tells the agent where they are', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-uploads-'));
  const paths = saveImages(dir, 'sess-1', checkImages([{ data: b64(PNG) }, { data: b64(JPEG) }]).images);
  assert.equal(paths.length, 2);
  assert.match(paths[0], /\/sess-1\/[\w-]+-1\.png$/);
  assert.match(paths[1], /-2\.jpg$/);
  assert.ok(readFileSync(paths[0]).equals(PNG));
  assert.throws(() => saveImages(dir, '../evil', []), /session id/);
  assert.equal(withScreenshots('Fix this', []), 'Fix this');
  assert.equal(withScreenshots('Fix this', ['/u/1.png']), 'Fix this\n\nI attached a screenshot. Open it with the Read tool to see it:\n/u/1.png');
  assert.equal(withScreenshots('', ['/u/1.png', '/u/2.png']), 'Please look at the screenshots I attached. Open each with the Read tool to see it:\n/u/1.png\n/u/2.png');
});

test('screenshots older than a week are cleared away', () => {
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
