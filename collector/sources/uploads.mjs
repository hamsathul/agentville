import { mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Screenshots sent with a dashboard message. A plugin's prompt can't carry images, so they are
// saved under state/uploads/<sessionId>/ and the message names them for the agent to open with
// its Read tool, which shows images to the model.
export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const KEEP_MS = 7 * 86_400_000;
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

const KINDS = [
  { ext: 'png', is: b => b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG' },
  { ext: 'jpg', is: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', is: b => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: 'webp', is: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/** Decodes the attachments of a message: { images: [{ bytes, ext }] } or { error }. Kind comes from the bytes. */
export function checkImages(list) {
  if (list === undefined) return { images: [] };
  if (!Array.isArray(list)) return { error: 'Those attachments could not be read.' };
  if (list.length > MAX_IMAGES) return { error: `Attach at most ${MAX_IMAGES} screenshots at a time.` };
  const images = [];
  for (const item of list) {
    const bytes = typeof item?.data === 'string' ? Buffer.from(item.data, 'base64') : Buffer.alloc(0);
    if (!bytes.length) return { error: 'A screenshot was empty.' };
    if (bytes.length > MAX_IMAGE_BYTES) return { error: 'A screenshot is too large (10 MB at most).' };
    const kind = KINDS.find(k => k.is(bytes));
    if (!kind) return { error: 'Only PNG, JPEG, GIF and WebP images can be attached.' };
    images.push({ bytes, ext: kind.ext });
  }
  return { images };
}

/** Writes each image whole (temp file + rename) and returns their absolute paths. */
export function saveImages(dir, sessionId, images, now = Date.now()) {
  if (!SESSION_ID.test(sessionId)) throw new Error('not a session id');
  const folder = join(dir, sessionId);
  mkdirSync(folder, { recursive: true });
  const stamp = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  return images.map((image, i) => {
    const file = join(folder, `${stamp}-${i + 1}.${image.ext}`);
    writeFileSync(`${file}.tmp`, image.bytes);
    renameSync(`${file}.tmp`, file);
    return file;
  });
}

/** The message text with the screenshots named, so the agent opens them. */
export function withScreenshots(text, paths) {
  if (!paths.length) return text;
  const many = paths.length > 1;
  const list = paths.join('\n');
  return text
    ? `${text}\n\nI attached ${many ? `${paths.length} screenshots. Open each` : 'a screenshot. Open it'} with the Read tool to see it:\n${list}`
    : `Please look at the screenshot${many ? 's' : ''} I attached. Open ${many ? 'each' : 'it'} with the Read tool to see it:\n${list}`;
}

/** Removes screenshots older than a week, and session folders left empty. */
export function pruneUploads(dir, now, keepMs = KEEP_MS) {
  let sessions;
  try {
    sessions = readdirSync(dir);
  } catch {
    return;
  }
  for (const session of sessions) {
    const folder = join(dir, session);
    try {
      const names = readdirSync(folder);
      let left = names.length;
      for (const name of names) {
        const file = join(folder, name);
        if (now - statSync(file).mtimeMs > keepMs) {
          unlinkSync(file);
          left -= 1;
        }
      }
      if (left === 0) rmdirSync(folder);
    } catch {
      // not a folder, or changed under us: next time
    }
  }
}
