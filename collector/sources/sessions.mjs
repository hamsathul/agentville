import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
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
const timeOf = e => (typeof e?.timestamp === 'string' ? Date.parse(e.timestamp) : NaN);
const startOf = entries => entries.map(timeOf).find(Number.isFinite) ?? null;
const branchOf = entries => entries.findLast(e => typeof e?.gitBranch === 'string' && e.gitBranch)?.gitBranch ?? null;
const modelOf = entries => entries.findLast(e => e?.type === 'assistant' && typeof e.message?.model === 'string' && !e.message.model.startsWith('<'))?.message.model ?? null;

/** { cwd, title, firstPrompt, lastPrompt, startedAt, model, branch } of one transcript, or null when nobody said anything in it. */
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
    startedAt: startOf(head),
    model: modelOf(tail) ?? modelOf(head), // the model of its last reply
    branch: branchOf(tail) ?? branchOf(head), // the git branch it was last on
  };
}

/**
 * Sessions with a transcript changed in the last `maxAgeDays` (Infinity: all of them), newest first:
 * [{ id, cwd, title, firstPrompt, lastPrompt, startedAt, model, branch, size, at }]. `cache`
 * (path → { key, info }) skips files that have not changed since they were last read.
 */
export function listSessions({ claudeDir, now = Date.now(), maxAgeDays = 30, limit = Infinity, cache = new Map() }) {
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
    if (hit.info) out.push({ id: f.id, ...hit.info, size: f.size, at: f.at });
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

export const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Models and effort levels a session can start with, or switch to (aliases, as --model and /model take them).
export const MODELS = ['default', 'opus', 'opus[1m]', 'sonnet', 'haiku', 'fable'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Permission modes a session can start in: their command-line flags. Bypass skips every permission check.
export const MODE_FLAGS = {
  default: '', acceptEdits: ' --permission-mode acceptEdits', plan: ' --permission-mode plan', auto: ' --permission-mode auto',
  bypassPermissions: ' --dangerously-skip-permissions',
};

/**
 * The shell line that starts Claude Code in a folder (or resumes a session there) in a permission
 * mode, with a model and effort for this session only (flags, not your saved defaults). `exec` puts
 * Claude in the shell's place, so its window closes when it ends.
 */
export function claudeCommand(cwd, resume, mode = 'default', { model = 'default', effort, prefillFile } = {}) {
  if (resume !== undefined && !SESSION_ID.test(resume)) throw new Error('not a session id');
  return `cd ${shellQuote(cwd)} && exec claude${resume ? ` --resume ${resume}` : ''}${startFlags(mode, { model, effort })}${prefillFlag(prefillFile)}`;
}

/**
 * The shell line that forks a conversation: Claude Code resumes the cut copy of its transcript at
 * `copy` as a new session of its own (--fork-session), in the folder, under `name`, in a permission
 * mode with a model and effort for it alone. `prefillFile` holds the text for its prompt box, read by
 * the shell (--prefill), so the text never goes into the command line.
 */
export function forkCommand(cwd, copy, mode = 'default', { model = 'default', effort, name, prefillFile, sessionId } = {}) {
  if (!isAbsolute(copy) || !copy.endsWith('.jsonl')) throw new Error('not a transcript copy');
  if (sessionId !== undefined && !SESSION_ID.test(sessionId)) throw new Error('not a session id');
  return `cd ${shellQuote(cwd)} && exec claude --resume ${shellQuote(copy)} --fork-session${sessionId ? ` --session-id ${sessionId}` : ''}${name ? ` --name ${shellQuote(name)}` : ''}${startFlags(mode, { model, effort })}${prefillFlag(prefillFile)}`;
}

/** Text for the prompt box (--prefill), read from a file by the shell, so it never goes into the command line. */
const prefillFlag = file => (file ? ` --prefill "$(cat ${shellQuote(file)})"` : '');

/** A session's permission mode, model and effort, as flags (checked: these go into a shell line). */
function startFlags(mode, { model = 'default', effort } = {}) {
  if (!Object.hasOwn(MODE_FLAGS, mode)) throw new Error('not a permission mode');
  if (!MODELS.includes(model)) throw new Error('not a model');
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new Error('not an effort level');
  return `${MODE_FLAGS[mode]}${model !== 'default' ? ` --model ${shellQuote(model)}` : ''}${effort ? ` --effort ${effort}` : ''}`;
}

/**
 * osascript arguments that close the iTerm session or Terminal window on a tty (/dev/ttys012),
 * only if that app is running already (never starts it); prints "closed" or "none".
 */
export function closeTerminalScript(app, tty) {
  if (!/^\/dev\/ttys\d{1,4}$/.test(tty)) throw new Error('not a tty');
  const lines = app === 'iTerm'
    ? ['on run argv', 'set t to item 1 of argv', 'if application "iTerm" is running then', 'tell application "iTerm"', 'repeat with w in windows', 'repeat with tb in tabs of w', 'repeat with s in sessions of tb',
      'if (tty of s) is t then', 'close s', 'return "closed"', 'end if', 'end repeat', 'end repeat', 'end repeat', 'end tell', 'end if', 'return "none"', 'end run']
    : ['on run argv', 'set t to item 1 of argv', 'if application "Terminal" is running then', 'tell application "Terminal"', 'repeat with w in windows', 'repeat with tb in tabs of w',
      'if (tty of tb) is t then', 'close w', 'return "closed"', 'end if', 'end repeat', 'end repeat', 'end tell', 'end if', 'return "none"', 'end run'];
  return [...lines.flatMap(line => ['-e', line]), tty];
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
