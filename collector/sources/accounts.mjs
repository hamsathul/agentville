import { readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

// Your Claude accounts: one config folder each (CLAUDE_CONFIG_DIR). The collector's own folder
// (~/.claude) is the first; its siblings ~/.claude-<name> with a login are the others, and
// config.json can name more. A session runs on the account whose sessions/ folder lists it; once
// it ends, the account it last ran on is remembered here.

const KEY = /[^a-z0-9_-]/g;
const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const realOrNull = p => { try { return realpathSync(p); } catch { return null; } };
const trim = p => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** The login an account file records ({ email, org }), or null. */
function loginOf(file) {
  try {
    const a = JSON.parse(readFileSync(file, 'utf8'))?.oauthAccount;
    if (!a || typeof a !== 'object') return null;
    return { email: typeof a.emailAddress === 'string' ? a.emailAddress : null, org: typeof a.organizationName === 'string' ? a.organizationName : null };
  } catch {
    return null;
  }
}

/** The key a config folder gets: main for the first, the suffix for <claudeDir>-<x>, else its name. */
export function keyOfDir(dir, claudeDir) {
  if (trim(dir) === trim(claudeDir)) return 'main';
  const stem = `${basename(trim(claudeDir))}-`, base = basename(trim(dir));
  return (base.startsWith(stem) ? base.slice(stem.length) : base).toLowerCase().replace(KEY, '').slice(0, 32) || 'account';
}

/**
 * Your accounts, the first (claudeDir) first: [{ key, name, dir, first, email, org, projectsReal }].
 * Only claudeDir's siblings are looked at, never the home folder. `names` is config.json's accounts
 * ({ folder: name }; ~ and a trailing slash allowed). A folder is never resolved through links: the
 * keychain knows a login by the folder's path exactly as CLAUDE_CONFIG_DIR gives it.
 */
export function findAccounts({ claudeDir, names, home, log = () => {} }) {
  const named = new Map();
  for (const [folder, name] of Object.entries(names && typeof names === 'object' && !Array.isArray(names) ? names : {})) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const dir = trim(folder === '~' ? home : folder.startsWith('~/') ? join(home, folder.slice(2)) : folder);
    if (isAbsolute(dir)) named.set(dir, name.trim().slice(0, 24));
  }
  const first = trim(claudeDir);
  const dirs = [first];
  let siblings = [];
  try { siblings = readdirSync(dirname(first)).filter(n => n.startsWith(`${basename(first)}-`)).sort(); } catch { /* none */ }
  for (const n of siblings) {
    const d = join(dirname(first), n);
    if (isDir(d) && loginOf(join(d, '.claude.json'))) dirs.push(d);
  }
  for (const d of named.keys()) {
    if (dirs.includes(d)) continue;
    if (isDir(d)) dirs.push(d); else log(`accounts: ${d} (config.json) is not a folder`);
  }
  const keys = new Set();
  return dirs.map((dir, i) => {
    let key = keyOfDir(dir, first);
    for (let n = 2; keys.has(key); n++) key = `${keyOfDir(dir, first)}-${n}`;
    keys.add(key);
    const login = loginOf(i === 0 ? `${dir}.json` : join(dir, '.claude.json'));
    return { key, name: named.get(dir) ?? key, dir, first: i === 0, email: login?.email ?? null, org: login?.org ?? null, projectsReal: realOrNull(join(dir, 'projects')) };
  });
}

/**
 * The environment `claude` runs in for an account: nothing to change with one account; with several,
 * CLAUDE_CONFIG_DIR unset for the first (an undefined value is left out of a child's environment)
 * and set to its folder for the others.
 */
export function accountEnv(account, many) {
  if (!many) return undefined;
  return { CLAUDE_CONFIG_DIR: account.first ? undefined : account.dir };
}

/** Which account (config folder) each session last ran on, in a file: the `cap` most recently seen kept. */
export function createSessionAccounts(file, { cap = 2000 } = {}) {
  const map = new Map();
  try {
    for (const [id, v] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) {
      if (typeof v?.dir === 'string' && Number.isFinite(v.at)) map.set(id, { dir: v.dir, at: v.at });
    }
  } catch { /* none yet, or broken: starts empty */ }
  let dirty = false;
  return {
    get: id => map.get(id)?.dir ?? null,
    see(id, dir, at) {
      const prev = map.get(id);
      if (prev?.dir === dir && at - prev.at < 3_600_000) return;
      map.delete(id);
      map.set(id, { dir, at });
      dirty = true;
    },
    save() {
      if (!dirty) return;
      while (map.size > cap) map.delete(map.keys().next().value);
      try {
        writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(map)));
        renameSync(`${file}.tmp`, file);
        dirty = false;
      } catch { /* tried again on the next change */ }
    },
  };
}
