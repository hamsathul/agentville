import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The mod writes state/pending/<toolUseId>.json when it offers a question or a permission
// prompt to the dashboard; the collector writes state/answers/<toolUseId>.json to answer it.
export const TOOL_USE_ID = /^toolu_[A-Za-z0-9]+$/;
const MAX_ANSWER = 2000;
const DAY_MS = 24 * 3_600_000;
const ORPHAN_MS = 10 * 60_000; // an offer nobody has refreshed for this long belongs to a wait that died

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function cleanQuestions(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 4) return null;
  const out = [];
  for (const q of list) {
    if (!q || typeof q.question !== 'string' || !q.question.trim()) return null;
    const options = (Array.isArray(q.options) ? q.options : [])
      .filter(o => o && typeof o.label === 'string' && o.label.trim())
      .slice(0, 10)
      .map(o => ({ label: o.label.slice(0, 200), description: typeof o.description === 'string' ? o.description.slice(0, 300) : undefined }));
    out.push({ question: q.question.slice(0, MAX_ANSWER), header: text(q.header, 60), multiSelect: q.multiSelect === true, options });
  }
  return out;
}

/** Offers still open, newest per session, plus files old enough to delete. */
export function readPending(dir, now) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return { bySession: new Map(), expired: [] };
    throw err;
  }
  const bySession = new Map();
  const expired = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    if (!TOOL_USE_ID.test(id)) continue;
    const path = join(dir, name);
    let entry;
    let heartbeatAt;
    try {
      entry = JSON.parse(readFileSync(path, 'utf8'));
      heartbeatAt = statSync(path).mtimeMs; // the waiting mod touches its offer every second
    } catch {
      continue;
    }
    if (entry?.toolUseId !== id || typeof entry.sessionId !== 'string' || !entry.sessionId) continue;
    const createdAt = Number(entry.createdAt) || 0;
    if (now - createdAt > DAY_MS || now - heartbeatAt > ORPHAN_MS) {
      expired.push(path);
      continue;
    }
    let item;
    if (entry.kind === 'question') {
      const questions = cleanQuestions(entry.questions);
      if (!questions) continue;
      item = { kind: 'question', toolUseId: id, createdAt, heartbeatAt, questions };
    } else if (entry.kind === 'permission') {
      const expiresAt = Number(entry.expiresAt) || 0;
      if (expiresAt <= now) {
        expired.push(path);
        continue;
      }
      item = { kind: 'permission', toolUseId: id, tool: text(entry.tool, 100), summary: text(entry.summary, 500), createdAt, heartbeatAt, expiresAt };
    } else {
      continue;
    }
    const prev = bySession.get(entry.sessionId);
    if (!prev || item.createdAt >= prev.createdAt) bySession.set(entry.sessionId, item);
  }
  return { bySession, expired };
}

/** { answers } keyed by question text, or { error } — every question needs a non-empty answer. */
export function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { error: 'Answer every question first.' };
  const out = {};
  for (const q of questions) {
    const value = answers[q.question];
    if (typeof value !== 'string' || !value.trim()) return { error: 'Answer every question first.' };
    out[q.question] = value.trim().slice(0, MAX_ANSWER);
  }
  return { answers: out };
}

/** Writes answers/<id>.json via a temp file + rename, so the mod never reads half a file. */
export function writeAnswerFile(dir, toolUseId, payload) {
  if (!TOOL_USE_ID.test(toolUseId)) throw new Error('not a tool use id');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${toolUseId}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(payload));
  renameSync(`${file}.tmp`, file);
}

const BEACON_LIVE_MS = 10_000;
const BEACON_KEEP_MS = 3 * 86_400_000;
const TURN_MODES = new Set(['requesting', 'responding', 'thinking', 'tool-input', 'tool-use']);
const EFFORT_LEVEL = /^(?:low|medium|high|xhigh|max)$/;

/** Whether a mod's version is at least `want` (1.2.3 against 1.2.0). */
export function modAtLeast(version, want) {
  const a = String(version ?? '0').split('.').map(n => Number.parseInt(n, 10) || 0), b = want.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** The mod in each session writes state/mods/<sessionId>.json every 2 s while it is listening. */
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
/** A mod's usage reading ($.session.usage()), kept to plain numbers and short names. */
function usageOf(u) {
  const windows = Array.isArray(u.rateLimits) ? u.rateLimits : [];
  return {
    costUsd: num(u.costUsd, 1e7),
    contextPercent: num(u.contextPercent, 100),
    rateLimits: windows.slice(0, 6).flatMap(w => {
      if (!w || typeof w !== 'object' || typeof w.kind !== 'string' || num(w.percentUsed, 1000) === null) return [];
      const resetsAt = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN;
      return [{ kind: w.kind.slice(0, 40), percentUsed: w.percentUsed, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null }];
    }),
  };
}

export function readBeacons(dir, now) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }
  const beacons = new Map();
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const b = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (now - (Number(b.at) || 0) > BEACON_KEEP_MS) { unlinkSync(join(dir, name)); continue; } // a session long gone
      if (typeof b.sessionId !== 'string' || !b.sessionId) continue;
      const beacon = { version: text(b.version, 20), live: now - (Number(b.at) || 0) < BEACON_LIVE_MS };
      if (b.usage && typeof b.usage === 'object') Object.assign(beacon, { at: Number(b.at) || 0, usage: usageOf(b.usage) });
      if (b.turn && typeof b.turn === 'object' && num(b.turn.startedAt, 1e14)) { // the terminal's working line: Slithering… while thinking
        beacon.turn = { startedAt: b.turn.startedAt, ...(text(b.turn.word, 40) ? { word: text(b.turn.word, 40) } : {}), ...(TURN_MODES.has(b.turn.mode) ? { mode: b.turn.mode } : {}) };
      }
      if (EFFORT_LEVEL.test(b.effort ?? '')) beacon.effort = b.effort; // the effort its model requests go out with
      beacons.set(b.sessionId, beacon);
    } catch {
      // half-written: next tick
    }
  }
  return beacons;
}

const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Queues a chat message for a session's mod: state/messages/<sessionId>/<time>-<n>.json, written whole. */
export function writeMessageFile(dir, sessionId, text) {
  return writeRequestFile(dir, sessionId, { text, at: Date.now() });
}

/** A request for a session's mod (a message, a model switch, a side question), in its inbox under `dir`; written whole, then named. */
export function writeRequestFile(dir, sessionId, value, id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  if (!SESSION_ID.test(sessionId)) throw new Error('not a session id');
  const inbox = join(dir, sessionId);
  mkdirSync(inbox, { recursive: true });
  const file = join(inbox, `${id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
  return file;
}

/**
 * What the mods wrote back (switch results, side-question answers): `<dir>/<session>.<id>.json`,
 * newest first, at most `perSession` for each session. Files older than `keepMs` are removed.
 */
export function readReplies(dir, now, { keepMs = 86_400_000, perSession = 5 } = {}) {
  const bySession = new Map();
  let names = [];
  try { names = readdirSync(dir).filter(n => n.endsWith('.json')); } catch { return bySession; }
  for (const name of names) {
    const path = join(dir, name);
    let value;
    try {
      if (now - statSync(path).mtimeMs > keepMs) { unlinkSync(path); continue; }
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue; // half written, or gone
    }
    const sid = typeof value?.sessionId === 'string' ? value.sessionId : name.split('.')[0];
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(value);
  }
  for (const [sid, list] of bySession) bySession.set(sid, list.sort((a, b) => (b.answeredAt ?? b.at ?? 0) - (a.answeredAt ?? a.at ?? 0)).slice(0, perSession));
  return bySession;
}

/**
 * Waits for the mod to take a file it was handed (it deletes or renames it). If that doesn't happen
 * in time, the file is withdrawn and the failure returned; a file already gone by then was taken
 * in the last instant, which counts as delivered.
 */
export async function confirmDelivery(file, { timeoutMs, failure, exists = existsSync, unlink = unlinkSync }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!exists(file)) return { ok: true };
    await new Promise(r => setTimeout(r, 100));
  }
  try {
    unlink(file);
  } catch (err) {
    if (err?.code === 'ENOENT') return { ok: true };
    throw err;
  }
  return { ok: false, error: failure };
}
