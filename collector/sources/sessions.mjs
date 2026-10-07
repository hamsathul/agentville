import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseEntry } from '../transcript/parse.mjs';
import { firstLine } from '../transcript/summarize.mjs';

// Past sessions to resume, from the transcripts in ~/.claude/projects, and the terminal window
// that starts or resumes one. A transcript can be hundreds of MB, so only its start (for the
// folder and the first message) and its end (for the title and the last message) are read.

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;

function readRange(path, start, length) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    return buf.subarray(0, readSync(fd, buf, 0, length, start)).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** The JSON entries in a piece of a transcript; a line cut at either end of the piece is dropped. */
function entriesOf(text, { cutStart, cutEnd }) {
  const lines = text.split('\n');
  if (cutStart) lines.shift();
  if (cutEnd) lines.pop();
  return lines.flatMap(line => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

const promptsOf = entries => entries.flatMap(e => parseEntry(e).events.filter(ev => ev.kind === 'prompt').map(ev => ev.text));
const titleOf = entries => entries.findLast(e => e?.type === 'ai-title' && typeof e.aiTitle === 'string')?.aiTitle ?? null;
const cwdOf = entries => entries.find(e => typeof e?.cwd === 'string' && e.cwd)?.cwd ?? null;

/** { cwd, title, firstPrompt, lastPrompt } of one transcript, or null when nobody said anything in it. */
function readSessionInfo(path, size) {
  let head, tail;
  if (size <= HEAD_BYTES + TAIL_BYTES) {
    head = tail = entriesOf(readRange(path, 0, size), { cutStart: false, cutEnd: false });
  } else {
    head = entriesOf(readRange(path, 0, HEAD_BYTES), { cutStart: false, cutEnd: true });
    tail = entriesOf(readRange(path, size - TAIL_BYTES, TAIL_BYTES), { cutStart: true, cutEnd: false });
  }
  const first = promptsOf(head), last = promptsOf(tail);
  if (!first.length && !last.length) return null;
  return {
    cwd: cwdOf(head) ?? cwdOf(tail),
    title: titleOf(tail) ?? titleOf(head),
    firstPrompt: firstLine(first[0] ?? last[0]),
    lastPrompt: firstLine(last.at(-1) ?? first.at(-1)),
  };
}

/**
 * Sessions with a transcript changed in the last `maxAgeDays`, newest first:
 * [{ id, cwd, title, firstPrompt, lastPrompt, at }]. `cache` (path → { key, info }) skips files
 * that have not changed since they were last read.
 */
export function listSessions({ claudeDir, now = Date.now(), maxAgeDays = 30, limit = 80, cache = new Map() }) {
  const projects = join(claudeDir, 'projects');
  const files = [];
  let dirs = [];
  try { dirs = readdirSync(projects); } catch { return []; }
  for (const dir of dirs) {
    let names = [];
    try { names = readdirSync(join(projects, dir)); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl') || !SESSION_ID.test(name.slice(0, -6))) continue;
      const path = join(projects, dir, name);
      try {
        const st = statSync(path);
        if (st.isFile() && now - st.mtimeMs <= maxAgeDays * 86_400_000) files.push({ id: name.slice(0, -6), path, size: st.size, at: st.mtimeMs });
      } catch {
        // gone since the listing
      }
    }
  }
  files.sort((x, y) => y.at - x.at);
  const out = [];
  for (const f of files) {
    if (out.length >= limit) break;
    const key = `${f.size}:${f.at}`;
    let hit = cache.get(f.path);
    if (hit?.key !== key) {
      let info = null;
      try { info = readSessionInfo(f.path, f.size); } catch { /* unreadable: skipped */ }
      hit = { key, info };
      cache.set(f.path, hit);
    }
    if (hit.info) out.push({ id: f.id, ...hit.info, at: f.at });
  }
  return out;
}

/** The folders sessions ran in, newest first, each once: [{ cwd, name, at, sessions }]. */
export function projectsOf(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!s.cwd || s.cwd === '/') continue;
    const p = map.get(s.cwd);
    if (p) { p.sessions++; p.at = Math.max(p.at, s.at); } else map.set(s.cwd, { cwd: s.cwd, name: s.cwd.split('/').filter(Boolean).pop() ?? s.cwd, at: s.at, sessions: 1 });
  }
  return [...map.values()].sort((x, y) => y.at - x.at);
}

const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The shell line that starts Claude Code in a folder, or resumes a session there. */
export function claudeCommand(cwd, resume) {
  if (resume !== undefined && !SESSION_ID.test(resume)) throw new Error('not a session id');
  return `cd ${shellQuote(cwd)} && claude${resume ? ` --resume ${resume}` : ''}`;
}

/**
 * osascript arguments that open a new window of the terminal app (iTerm, else Terminal) and run
 * `command` in it. The command goes in as an argument, never into the script's text.
 */
export function terminalScript(app, command) {
  const lines = app === 'iTerm'
    ? ['on run argv', 'tell application "iTerm"', 'activate', 'set w to (create window with default profile)', 'tell current session of w to write text (item 1 of argv)', 'end tell', 'end run']
    : ['on run argv', 'tell application "Terminal"', 'activate', 'do script (item 1 of argv)', 'end tell', 'end run'];
  return [...lines.flatMap(line => ['-e', line]), command];
}
