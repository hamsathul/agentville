import { mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Files sent with a dashboard message: screenshots, PDFs, Markdown, text… A plugin's prompt can't
// carry them, so they are saved under state/uploads/<sessionId>/ and the message names them for the
// agent to open with its Read tool, which shows images and PDFs to the model and reads text.
export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const KEEP_MS = 7 * 86_400_000;
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

// Pictures known by their bytes, so a pasted one that came without a name still gets its extension.
const IMAGES = [
  { ext: 'png', is: b => b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG' },
  { ext: 'jpg', is: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', is: b => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: 'webp', is: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

const clean = s => s.replace(/[^\w.-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[.-]+|[.-]+$/g, '');
/** A file's name made safe to save (letters, digits, dot, dash, underscore), its extension kept: never a path. */
export function safeName(name, bytes = Buffer.alloc(0)) {
  const base = String(name ?? '').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  const stem = clean(dot > 0 ? base.slice(0, dot) : base).slice(0, 60) || 'file';
  const ext = (dot > 0 ? clean(base.slice(dot + 1)).slice(0, 12).toLowerCase() : '') || (IMAGES.find(k => k.is(bytes))?.ext ?? '');
  return ext ? `${stem}.${ext}` : stem;
}

/** Decodes the attachments of a message: { files: [{ bytes, name }] } or { error }. */
export function checkFiles(list) {
  if (list === undefined) return { files: [] };
  if (!Array.isArray(list)) return { error: 'Those attachments could not be read.' };
  if (list.length > MAX_FILES) return { error: `Attach at most ${MAX_FILES} files at a time.` };
  const files = [];
  for (const item of list) {
    const bytes = typeof item?.data === 'string' ? Buffer.from(item.data, 'base64') : Buffer.alloc(0);
    const name = safeName(item?.name, bytes);
    if (!bytes.length) return { error: `${name} is empty.` };
    if (bytes.length > MAX_FILE_BYTES) return { error: `${name} is too large (10 MB at most).` };
    files.push({ bytes, name });
  }
  return { files };
}

/** Writes each file whole (temp file + rename), under its own name after a stamp, and returns their absolute paths. */
export function saveFiles(dir, sessionId, files, now = Date.now()) {
  if (!SESSION_ID.test(sessionId)) throw new Error('not a session id');
  const folder = join(dir, sessionId);
  mkdirSync(folder, { recursive: true });
  const stamp = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  return files.map((f, i) => {
    const file = join(folder, `${stamp}-${i + 1}-${f.name}`);
    writeFileSync(`${file}.tmp`, f.bytes);
    renameSync(`${file}.tmp`, file);
    return file;
  });
}

/** The message text with the attached files named, so the agent opens them. */
export function withAttachments(text, paths) {
  if (!paths.length) return text;
  const many = paths.length > 1;
  const list = paths.join('\n');
  return text
    ? `${text}\n\nI attached ${many ? `${paths.length} files. Open each` : 'a file. Open it'} with the Read tool:\n${list}`
    : `Please look at the file${many ? 's' : ''} I attached. Open ${many ? 'each' : 'it'} with the Read tool:\n${list}`;
}

/** Removes attachments older than a week, and session folders left empty. */
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
