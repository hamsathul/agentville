// Worlds on disk. The built-in ones live in web/worlds/<key>/, the SDK in web/worlds/sdk/; each world is
// a folder with world.json and world.js. This serves a world's files from inside its own folder only
// (no way out through .., a hidden name or a symlink), and writes the page its sandboxed frame loads.
// No dependencies.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

export const API_VERSION = 1;
export const WORLD_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED = new Set(['sdk', 'starter', 'test', 'u']);
const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
// The frame: a sandbox of its own even when opened in a tab, scripts only from the dashboard, and no way
// to send anything anywhere (no fetch, frames, forms or workers). Only the dashboard may embed it.
export const FRAME_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NOT_FOUND = { status: 404, error: 'not found' };

export function makeWorlds({ builtinDir }) {
  /** A world's folder from its key ('sdk' is the SDK's); null for a key that names none. */
  function dirOf(key) {
    if (key === 'sdk') return join(builtinDir, 'sdk');
    return WORLD_NAME.test(key) && !RESERVED.has(key) ? join(builtinDir, key) : null;
  }
  /** One of a world's files: { real, type, size }; anything else is a plain 404, saying nothing about what is there. */
  function file(key, rel) {
    const dir = dirOf(key), type = TYPES[extname(rel).toLowerCase()];
    if (!dir || !type || rel.split('/').some(p => p === '' || p === '..' || p.startsWith('.'))) return NOT_FOUND;
    if (key === 'sdk' && rel === 'frame.html') return NOT_FOUND;
    try {
      const root = realpathSync(dir), real = realpathSync(join(dir, rel)), st = statSync(real);
      if (!real.startsWith(root + sep) || !st.isFile()) return NOT_FOUND;
      return { real, type, size: st.size };
    } catch {
      return NOT_FOUND;
    }
  }
  /** A world's world.json as an object, or null. */
  function info(key) {
    const dir = key === 'sdk' ? null : dirOf(key);
    if (!dir) return null;
    try {
      const j = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
      return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  }
  /** The page a world's frame loads (web/worlds/sdk/frame.html filled in), or null for an unknown world. */
  function frame(key) {
    const w = info(key);
    if (!w) return null;
    return readFileSync(join(builtinDir, 'sdk', 'frame.html'), 'utf8')
      .replaceAll('__TITLE__', esc(typeof w.name === 'string' ? w.name : key))
      .replaceAll('__BASE__', `/world/${key}/`);
  }
  return { dirOf, file, info, frame };
}
