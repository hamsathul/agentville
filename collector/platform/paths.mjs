import { posix, win32 } from 'node:path';

const ON_WINDOWS = process.platform === 'win32';

// Strictly below base: not the base itself, not a sibling sharing its prefix, not a .. escape, not another drive.
// Replaces startsWith(base + '/'), which was wrong on Windows twice over (the separator, and the case).
export function isInside(base, candidate, { win = ON_WINDOWS } = {}) {
  if (typeof base !== 'string' || typeof candidate !== 'string' || !base || !candidate) return false;
  const p = win ? win32 : posix;
  const fold = s => (win ? s.toLowerCase() : s);
  const rel = p.relative(fold(p.resolve(base)), fold(p.resolve(candidate)));
  if (!rel || rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return false;
  return true;
}

// A path's parts, whichever system wrote it: a Windows one (C:\a\b, C:/a/b, \\server\share) by either separator, any other by
// '/' alone (a backslash is a letter in a Mac file name). The page has the same pair (web/core.js).
const WIN_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;
export const pathParts = path => String(path ?? '').split(WIN_PATH.test(String(path ?? '')) ? /[\\/]/ : '/').filter(Boolean);
export const lastPart = path => pathParts(path).pop() ?? '';

// A path as the dashboard shows it: forward slashes.
export function toPosix(path) {
  return String(path).replaceAll(String.fromCharCode(92), '/');
}

// Git prints C:/Users/me/repo on Windows; every other path here is native (C:\Users\me\repo). Convert once, at the source.
export function fromGit(path, { win = ON_WINDOWS } = {}) {
  if (typeof path !== 'string' || !path || !win) return path;
  return win32.normalize(path);
}
