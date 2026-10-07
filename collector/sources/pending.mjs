import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The mod writes state/pending/<toolUseId>.json when it offers a question or a permission
// prompt to the dashboard; the collector writes state/answers/<toolUseId>.json to answer it.
export const TOOL_USE_ID = /^toolu_[A-Za-z0-9]+$/;
const MAX_ANSWER = 2000;
const DAY_MS = 24 * 3_600_000;

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
    try {
      entry = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    if (entry?.toolUseId !== id || typeof entry.sessionId !== 'string' || !entry.sessionId) continue;
    const createdAt = Number(entry.createdAt) || 0;
    if (now - createdAt > DAY_MS) {
      expired.push(path);
      continue;
    }
    let item;
    if (entry.kind === 'question') {
      const questions = cleanQuestions(entry.questions);
      if (!questions) continue;
      item = { kind: 'question', toolUseId: id, createdAt, questions };
    } else if (entry.kind === 'permission') {
      const expiresAt = Number(entry.expiresAt) || 0;
      if (expiresAt <= now) {
        expired.push(path);
        continue;
      }
      item = { kind: 'permission', toolUseId: id, tool: text(entry.tool, 100), summary: text(entry.summary, 500), createdAt, expiresAt };
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
