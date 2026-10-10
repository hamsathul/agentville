import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

// Messages you sent a session while it worked: kept here, where you can remove, edit or send each
// one early, until its turn ends and the collector sends them (one per turn, or all together).
// Under state/held/<sessionId>.json (the folder 0700, the file 0600); nothing reaches the session
// until one goes out. Files sent with one are saved already (uploads); their lines are added only
// when it goes out, so an edit changes only what you typed.
export const MAX_HELD = 50;
export const MAX_HELD_CHARS = 20_000;
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;
const GONE = 'That message is no longer waiting.';

export function createHeld(dir, { now = () => Date.now(), newId = () => randomBytes(6).toString('hex') } = {}) {
  const cache = new Map(); // sessionId → { together, items }, read once
  const revs = new Map();
  let lastRev = 0;
  const bump = id => { lastRev = Math.max(lastRev + 1, now()); revs.set(id, lastRev); };
  const fileOf = id => join(dir, `${id}.json`);

  function load(id) {
    if (cache.has(id)) return cache.get(id);
    let got = { together: false, items: [] };
    try {
      const raw = JSON.parse(readFileSync(fileOf(id), 'utf8'));
      got = { together: raw?.together === true, items: Array.isArray(raw?.items) ? raw.items.filter(i => i && typeof i.id === 'string' && typeof i.text === 'string') : [] };
    } catch { /* none yet, or unreadable: none */ }
    cache.set(id, got);
    return got;
  }
  function save(id, got) {
    cache.set(id, got);
    bump(id);
    if (!got.items.length && !got.together) { try { unlinkSync(fileOf(id)); } catch { /* none */ } return; }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const tmp = `${fileOf(id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(got), { mode: 0o600 });
    renameSync(tmp, fileOf(id));
  }
  const clean = t => (typeof t === 'string' ? t.trim() : '');

  return {
    /** Holds a message: { ok, item, count } or { ok: false, error }. */
    add(id, { text, files = [], folders = [] } = {}) {
      if (!SESSION_ID.test(id ?? '')) return { ok: false, error: 'That is not a session.' };
      const body = clean(text);
      if (!body && !files.length && !folders.length) return { ok: false, error: 'Type a message first.' };
      if (body.length > MAX_HELD_CHARS) return { ok: false, error: 'That message is too long (20,000 characters at most).' };
      const got = load(id);
      if (got.items.length >= MAX_HELD) return { ok: false, error: `${MAX_HELD} messages are waiting already.` };
      const item = { id: newId(), text: body, files, folders, at: now() };
      save(id, { ...got, items: [...got.items, item] });
      return { ok: true, item, count: got.items.length + 1 };
    },
    edit(id, itemId, text) {
      const got = load(id), body = clean(text);
      if (!got.items.some(i => i.id === itemId)) return { ok: false, error: GONE };
      if (!body) return { ok: false, error: 'Type a message, or remove it.' };
      if (body.length > MAX_HELD_CHARS) return { ok: false, error: 'That message is too long (20,000 characters at most).' };
      save(id, { ...got, items: got.items.map(i => (i.id === itemId ? { ...i, text: body, editedAt: now() } : i)) });
      return { ok: true };
    },
    remove(id, itemId) {
      const got = load(id);
      if (!got.items.some(i => i.id === itemId)) return { ok: false, error: GONE };
      save(id, { ...got, items: got.items.filter(i => i.id !== itemId) });
      return { ok: true };
    },
    /** The first one (or the one with `itemId`), taken off the list to go out; null if none. */
    take(id, itemId) {
      const got = load(id);
      const item = itemId === undefined ? got.items[0] : got.items.find(i => i.id === itemId);
      if (!item) return null;
      save(id, { ...got, items: got.items.filter(i => i !== item) });
      return item;
    },
    takeAll(id) {
      const got = load(id);
      if (got.items.length) save(id, { ...got, items: [] });
      return got.items;
    },
    /** Items that didn't go out, back where they were (`at`; the front by default), in their order. */
    putBack(id, items, at = 0) {
      if (!items.length) return;
      const got = load(id);
      save(id, { ...got, items: [...got.items.slice(0, at), ...items, ...got.items.slice(at)] });
    },
    setTogether(id, on) {
      const got = load(id);
      save(id, { ...got, together: on === true });
    },
    list(id) {
      const got = load(id);
      return { items: got.items, together: got.together, rev: revs.get(id) ?? 0 };
    },
    /** { count, together, rev } while any wait: no text. */
    summary(id) {
      const got = load(id);
      return got.items.length ? { count: got.items.length, together: got.together, rev: revs.get(id) ?? 0 } : null;
    },
    /** The sessions with messages waiting (those read already, and those on disk). */
    sessions() {
      let names = [];
      try { names = readdirSync(dir).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)); } catch { /* none */ }
      for (const id of names) if (SESSION_ID.test(id)) load(id);
      return [...cache].filter(([, got]) => got.items.length).map(([id]) => id);
    },
    drop(id) {
      cache.set(id, { together: false, items: [] });
      bump(id);
      try { unlinkSync(fileOf(id)); } catch { /* none */ }
    },
  };
}
