import { mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { replaceFile } from '../platform/replace.mjs';

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

/** The folders attached to a message, by path (nothing is copied): { folders } or { error }. */
export function checkFolders(list) {
  if (list === undefined) return { folders: [] };
  if (!Array.isArray(list) || list.length > MAX_FILES) return { error: `Attach at most ${MAX_FILES} folders at a time.` };
  const folders = [];
  for (const item of list) {
    if (typeof item !== 'string' || !isAbsolute(item) || /[\0\r\n]/.test(item)) return { error: 'That folder could not be read.' };
    const path = resolve(item);
    let isDir = false;
    try { isDir = statSync(path).isDirectory(); } catch { /* gone */ }
    if (!isDir) return { error: `${path} is not a folder (any more).` };
    folders.push(path);
  }
  return { folders };
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
    replaceFile(`${file}.tmp`, file);
    return file;
  });
}

/** The message text with the attached files and folders named, so the agent opens them (files with Read, folders with its own tools). */
export function withAttachments(text, paths, folders = []) {
  const files = paths.length ? `I attached ${paths.length > 1 ? `${paths.length} files. Open each` : 'a file. Open it'} with the Read tool:\n${paths.join('\n')}` : '';
  const dirs = folders.length ? `I attached ${folders.length > 1 ? `${folders.length} folders. Look in each` : 'a folder. Look in it'} with your tools:\n${folders.join('\n')}` : '';
  if (text) return [text, files, dirs].filter(Boolean).join('\n\n');
  if (files && dirs) return `Please look at what I attached.\n\n${files}\n\n${dirs}`;
  if (files) return `Please look at the file${paths.length > 1 ? 's' : ''} I attached. Open ${paths.length > 1 ? 'each' : 'it'} with the Read tool:\n${paths.join('\n')}`;
  if (dirs) return `Please look at the folder${folders.length > 1 ? 's' : ''} I attached. Look in ${folders.length > 1 ? 'each' : 'it'} with your tools:\n${folders.join('\n')}`;
  return text;
}

/** What you typed in a message `withAttachments` made: its notes taken off ('' when it was only files or folders). */
export function typedPart(text) {
  const t = String(text ?? '');
  if (/^Please look at (?:the (?:files?|folders?)|what) I attached[.:]/.test(t)) return '';
  const note = t.search(/\n\nI attached (?:a (?:file|folder)|\d+ (?:files|folders))\. (?:Open|Look in) (?:it|each) with /);
  return note >= 0 ? t.slice(0, note) : t;
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
