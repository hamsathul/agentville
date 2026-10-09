// Worlds on disk. The built-in ones live in web/worlds/<key>/, the SDK in web/worlds/sdk/; each world is
// a folder with world.json and world.js. This serves a world's files from inside its own folder only
// (no way out through .., a hidden name or a symlink), and writes the page its sandboxed frame loads.
// No dependencies.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
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

/** What is wrong with a world.json (as parsed), or null. */
export function checkWorldJson(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return 'world.json is not a JSON object.';
  if (typeof j.name !== 'string' || !j.name.trim() || j.name.length > 40) return 'world.json needs a "name", up to 40 characters.';
  if (j.icon !== undefined && (typeof j.icon !== 'string' || [...j.icon].length > 8)) return 'world.json: "icon" is one emoji.';
  if (j.description !== undefined && (typeof j.description !== 'string' || j.description.length > 140)) return 'world.json: "description" is up to 140 characters.';
  if (!Number.isInteger(j.api) || j.api < 1) return 'world.json needs "api": 1.';
  if (j.api > API_VERSION) return `This world needs a newer Agentville (it was made for api ${j.api}; this one has ${API_VERSION}).`;
  if (j.nouns !== undefined && (!j.nouns || typeof j.nouns !== 'object' || Array.isArray(j.nouns) || Object.values(j.nouns).some(v => typeof v !== 'string' || v.length > 30))) return 'world.json: "nouns" are short words.';
  return null;
}

export function makeWorlds({ builtinDir, userDir = null }) {
  /** A world's folder from its key ('sdk' is the SDK's, 'u/<name>' one of yours); null for a key that names none. */
  function dirOf(key) {
    if (key === 'sdk') return join(builtinDir, 'sdk');
    if (key.startsWith('u/')) { const name = key.slice(2); return userDir && WORLD_NAME.test(name) ? join(userDir, name) : null; }
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
  function describe(key, builtIn) {
    let j = null, error = null;
    const meta = file(key, 'world.json'); // through the folder check: a world.json linked out of the folder counts as missing
    try { if (!meta.real) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); j = JSON.parse(readFileSync(meta.real, 'utf8')); }
    catch (err) { error = err.code === 'ENOENT' ? 'world.json is missing.' : `world.json can't be read: ${String(err.message).slice(0, 120)}`; }
    error ??= checkWorldJson(j) ?? (file(key, 'world.js').real ? null : 'world.js is missing (or is a link out of the folder).');
    return {
      key, builtIn, error,
      name: typeof j?.name === 'string' && j.name.trim() ? j.name.slice(0, 40) : key.replace(/^u\//, ''),
      icon: typeof j?.icon === 'string' && [...j.icon].length <= 8 ? j.icon : '🧩',
      description: typeof j?.description === 'string' ? j.description.slice(0, 140) : '',
      nouns: !error && j.nouns ? j.nouns : {},
      preview: file(key, 'preview.png').real ? `/world/${key}/preview.png` : null,
    };
  }
  const folders = dir => {
    try { return readdirSync(dir).filter(n => !n.startsWith('.') && statSync(join(dir, n)).isDirectory()).sort(); } catch { return []; }
  };
  /** Every world: the built-in ones (the farm first), then yours (A to Z), each with what is wrong with it, if anything. */
  function list() {
    const built = folders(builtinDir).filter(n => WORLD_NAME.test(n) && !RESERVED.has(n)).sort((a, b) => (a === 'farm' ? -1 : b === 'farm' ? 1 : a.localeCompare(b)));
    const out = built.map(n => describe(n, true));
    for (const n of userDir ? folders(userDir) : []) {
      out.push(WORLD_NAME.test(n) ? describe(`u/${n}`, false)
        : { key: null, builtIn: false, name: n, icon: '🧩', description: '', nouns: {}, preview: null, error: "A world's folder name is lowercase letters, digits and dashes (up to 40)." });
    }
    return out;
  }
  /** A world that can run, as list() describes it; null for one that can't (or isn't). */
  function info(key) {
    if (!dirOf(key) || key === 'sdk') return null;
    const w = list().find(x => x.key === key);
    return w && !w.error ? w : null;
  }
  /** The page a world's frame loads (web/worlds/sdk/frame.html filled in), or null for a world that can't run. */
  function frame(key) {
    const w = info(key);
    if (!w) return null;
    return readFileSync(join(builtinDir, 'sdk', 'frame.html'), 'utf8')
      .replaceAll('__TITLE__', () => esc(w.name))
      .replaceAll('__BASE__', () => `/world/${key}/`);
  }
  return { dirOf, file, info, list, frame, userDir };
}
