import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { makePrivate } from '../platform/private.mjs';

// Your notes on a session: things you may want to say to it later, or not. They are yours alone:
// kept under state/notes/<sessionId>.json (the folder 0700, the file 0600), never sent anywhere,
// and nothing reaches the session until you use one. They outlive the session, so a resumed or
// restored one has them again, and a fork gets a copy.
export const MAX_NOTES = 200;
export const MAX_NOTE_CHARS = 4000;
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;
const NOTE_ID = /^[\w-]{1,32}$/;

export function createNotes(dir, { now = () => Date.now(), newId = () => randomBytes(6).toString('hex') } = {}) {
  const cache = new Map(); // sessionId → its notes, read once
  const revs = new Map(); // sessionId → a number that moves with every change, for the page to know when to read them again
  let lastRev = 0;
  const bump = id => { lastRev = Math.max(lastRev + 1, now()); revs.set(id, lastRev); };
  const fileOf = id => join(dir, `${id}.json`);

  function load(id) {
    if (cache.has(id)) return cache.get(id);
    let notes = [];
    try {
      const got = JSON.parse(readFileSync(fileOf(id), 'utf8'))?.notes;
      if (Array.isArray(got)) notes = got.filter(n => n && NOTE_ID.test(n.id) && typeof n.text === 'string');
      revs.set(id, Math.floor(statSync(fileOf(id)).mtimeMs));
    } catch { /* none yet, or unreadable: none */ }
    cache.set(id, notes);
    return notes;
  }
  function save(id, notes) {
    cache.set(id, notes);
    bump(id);
    if (!notes.length) {
      try { unlinkSync(fileOf(id)); } catch { /* already gone */ }
      return;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    makePrivate(dir);
    const tmp = `${fileOf(id)}.tmp`;
    writeFileSync(tmp, JSON.stringify({ notes }), { mode: 0o600 });
    makePrivate(tmp);
    renameSync(tmp, fileOf(id));
  }
  const textOf = text => {
    if (typeof text !== 'string' || !text.trim()) return { error: 'Write something first.' };
    const clean = text.trim();
    return clean.length > MAX_NOTE_CHARS ? { error: 'A note holds 4,000 characters at most.' } : { text: clean };
  };
  /** Runs a change on a session's notes: { ok, notes } or { ok: false, error }, nothing changed. */
  function change(id, fn) {
    if (typeof id !== 'string' || !SESSION_ID.test(id)) return { ok: false, error: 'That is not a session.' };
    const notes = load(id).map(n => ({ ...n }));
    const err = fn(notes);
    if (err) return { ok: false, error: err };
    save(id, notes);
    return result(id);
  }
  const result = id => ({ ok: true, notes: list(id), rev: revs.get(id) ?? 0 });
  const gone = 'That note is no longer there.';
  const list = id => (typeof id === 'string' && SESSION_ID.test(id) ? load(id).map(n => ({ ...n })) : []);

  return {
    list,
    add(id, text) {
      const t = textOf(text);
      if (t.error) return { ok: false, error: t.error };
      return change(id, notes => {
        if (notes.length >= MAX_NOTES) return 'A session holds 200 notes at most: delete some first.';
        notes.push({ id: newId(), text: t.text, at: now() });
      });
    },
    edit(id, noteId, text) {
      const t = textOf(text);
      if (t.error) return { ok: false, error: t.error };
      return change(id, notes => {
        const n = notes.find(x => x.id === noteId);
        if (!n) return gone;
        n.text = t.text;
        n.editedAt = now();
      });
    },
    remove(id, noteId) {
      return change(id, notes => {
        const i = notes.findIndex(x => x.id === noteId);
        if (i < 0) return gone;
        notes.splice(i, 1);
      });
    },
    /** Marks notes used (those still there): they stay, crossed out, until Clear used. */
    markUsed(id, ids) {
      const wanted = new Set(Array.isArray(ids) ? ids : []);
      return change(id, notes => { for (const n of notes) if (wanted.has(n.id) && !n.usedAt) n.usedAt = now(); });
    },
    clearUsed(id) {
      return change(id, notes => { notes.splice(0, notes.length, ...notes.filter(n => !n.usedAt)); });
    },
    /** A fork's copy: the notes as they are now, from then on its own. Nothing to copy leaves it as it is. */
    copy(from, to) {
      const src = list(from);
      if (!src.length) return result(to);
      return change(to, notes => { notes.push(...src.filter(n => !notes.some(x => x.id === n.id))); });
    },
    /**
     * How many notes a session has, how many unused, and the rev: undefined when it has none and
     * never had (once it had, a count of 0 tells the page its last note went).
     */
    summary(id) {
      const notes = list(id);
      if (!notes.length && !revs.has(id)) return undefined;
      return { count: notes.length, unused: notes.filter(n => !n.usedAt).length, rev: revs.get(id) ?? 0 };
    },
    /** Every session with unused notes: sessionId → how many. */
    counts() {
      const out = new Map();
      let names = [];
      try { names = existsSync(dir) ? readdirSync(dir) : []; } catch { /* unreadable: none */ }
      for (const name of names) {
        const id = name.endsWith('.json') ? name.slice(0, -5) : '';
        if (!SESSION_ID.test(id)) continue;
        const unused = load(id).filter(n => !n.usedAt).length;
        if (unused) out.set(id, unused);
      }
      return out;
    },
  };
}
