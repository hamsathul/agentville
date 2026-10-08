// Made-up Claude Code sessions for the demo videos: each one a sleeping process (so it looks alive)
// and a transcript, with the lines Claude Code writes to it.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const iso = ms => new Date(ms).toISOString();

/**
 * Gives each session an id (a UUID from `idBase`), a process and an empty transcript under
 * `claudeDir`. Returns the sessions by key and the processes, to stop at the end.
 */
export function setUpSessions(claudeDir, sessions, { idBase, now }) {
  mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
  sessions.forEach((s, i) => { s.id = `${idBase}-0000-4000-8000-${String(i + 1).padStart(12, '0')}`; });
  const sleepers = [];
  for (const s of sessions) {
    const p = spawn('sleep', ['900'], { stdio: 'ignore' });
    sleepers.push(p);
    s.pid = p.pid;
    s.file = join(claudeDir, 'projects', s.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${s.id}.jsonl`);
    mkdirSync(dirname(s.file), { recursive: true });
    writeFileSync(s.file, '');
    s.open = null; // the tool call still running
    s.turnAt = now - 4 * 60_000;
  }
  return { byId: Object.fromEntries(sessions.map(s => [s.key, s])), sleepers };
}

/** Transcript lines, as Claude Code writes them. A shell command a session begins runs at pid `shellBase` and up. */
export function transcriptWriter({ shellBase = 4_000_100 } = {}) {
  let msgN = 0, taskN = 0, callN = 0;
  const write = (s, ...entries) => appendFileSync(s.file, `${entries.map(e => JSON.stringify(e)).join('\n')}\n`);
  const prompt = (s, text, ms = Date.now(), extra = {}) => ({ type: 'user', timestamp: iso(ms), cwd: s.cwd, permissionMode: s.mode ?? 'default', message: { role: 'user', content: text }, ...extra });
  const assistant = (s, content, ms = Date.now(), out = 400) => ({ type: 'assistant', timestamp: iso(ms), cwd: s.cwd, message: { id: `msg_${++msgN}`, model: s.model, role: 'assistant', content, usage: { input_tokens: 1200, cache_read_input_tokens: s.ctx, cache_creation_input_tokens: 800, output_tokens: out, ...(s.fast ? { speed: 'fast' } : {}) } } });
  function use(s, name, input, ms = Date.now()) {
    const id = `toolu_${++callN}`;
    write(s, assistant(s, [{ type: 'tool_use', id, name, input }], ms, 200 + (callN % 7) * 180));
    return id;
  }
  /** A call the session is in the middle of: a shell command runs as a process of its own (see readProcs). */
  function begin(s, name, input, ms = Date.now()) {
    s.open = use(s, name, input, ms);
    s.openBash = name === 'Bash' && !input.run_in_background ? { pid: shellBase + 2 * callN, command: input.command, startedAt: ms } : null;
    return s.open;
  }
  const result = (s, id, { error = false, ms = Date.now(), text = 'ok', extra = {} } = {}) => write(s, { type: 'user', timestamp: iso(ms), cwd: s.cwd, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: error }] }, ...extra });
  const reply = (s, text, ms = Date.now()) => write(s, assistant(s, [{ type: 'text', text }], ms, 900));
  const turnEnd = (s, ms = Date.now()) => write(s, { type: 'system', subtype: 'turn_duration', timestamp: iso(ms), durationMs: 60_000 });
  function task(s, subject, activeForm, status, ms) {
    const id = use(s, 'TaskCreate', { subject, activeForm, description: subject }, ms);
    const n = String(++taskN);
    result(s, id, { ms, text: `Task #${n} created successfully: ${subject}`, extra: { toolUseResult: { task: { id: n, subject } } } });
    if (status !== 'pending') { const u = use(s, 'TaskUpdate', { taskId: n, status }, ms + 1); result(s, u, { ms: ms + 2 }); }
  }
  return { write, prompt, assistant, use, begin, result, reply, turnEnd, task };
}
