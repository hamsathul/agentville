import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseEntry } from './parse.mjs';
import { SessionModel } from './session-model.mjs';

// After a restart the collector reads only the tail of each transcript. This finds, in the part it
// skipped, the file-tool calls (so Documents, the explorer's marks and the farm's field close-ups keep
// the session's earlier files), the conversation (so your earlier messages and the replies stay), and
// the task list and compactions (so the farm's chore boards and harvests count from the start), and the
// background commands with the files their output goes to (so one still running can be watched).
// Lines that can hold none of these are skipped before parsing.
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read']);
const SAID_KEPT = 200;

const TASK_LINE = /"(?:TaskCreate|TaskUpdate|TodoWrite)"|compact_boundary|"task":\{"id"|created successfully/;
const BACKGROUND_KEPT = 50;

/**
 * Bytes [0, end) of a transcript, oldest first: `files` [{ name, input, at, cwd }] for file-tool calls,
 * `said` [{ kind: 'prompt' | 'reply', text, at }] for the last 200 messages, and `tasks`
 * { ops, compactions, lastCompactAt } for the task list's changes and the compactions.
 */
export async function earlierHistory(path, end) {
  const files = [], said = [], background = [];
  const tasks = new SessionModel({ feedCap: 1, saidCap: 1, callCap: 50, fileCap: 1 }); // only task lines go in
  const result = () => ({ files, said, tasks: { ops: tasks.taskOps, compactions: tasks.compactions, lastCompactAt: tasks.lastCompactAt }, background: background.slice(-BACKGROUND_KEPT) });
  if (!(end > 0)) return result();
  const lines = createInterface({ input: createReadStream(path, { start: 0, end: end - 1 }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const fileCall = line.includes('"tool_use"') && /"(file_path|notebook_path)"/.test(line);
      const message = (line.includes('"type":"user"') && !line.includes('"tool_result"')) || (line.includes('"type":"assistant"') && line.includes('"type":"text"'))
        || line.includes('"name":"SendMessage"') || line.includes('<cross-session-message');
      const taskLine = TASK_LINE.test(line);
      const bgLine = line.includes('"run_in_background":true') || line.includes('Output is being written to:');
      if (!fileCall && !message && !taskLine && !bgLine) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // the line cut at `end`, or a broken one
      }
      const { at, events } = parseEntry(entry);
      if (taskLine) tasks.apply({ at, events: events.filter(ev => ev.kind !== 'prompt' && ev.kind !== 'turn_start') });
      for (const ev of events) {
        if (ev.kind === 'tool_use' && ev.name === 'Bash' && ev.input?.run_in_background === true) background.push({ id: ev.id, name: 'Bash', input: ev.input, background: true, at: at ?? 0 });
        else if (ev.kind === 'tool_result' && ev.text) {
          const call = background.findLast(c => c.id === ev.toolUseId);
          const out = call && /Output is being written to: (\S+\.output)\b/.exec(ev.text)?.[1];
          if (out) call.outputPath = out;
        }
        if (ev.kind === 'tool_use' && FILE_TOOLS.has(ev.name)) files.push({ name: ev.name, input: ev.input, at: at ?? 0, cwd: ev.cwd });
        else if (ev.kind === 'prompt' || ev.kind === 'reply' || ev.kind === 'peer_in' || (ev.kind === 'tool_use' && ev.name === 'SendMessage' && typeof ev.input?.to === 'string')) {
          said.push(ev.kind === 'peer_in' ? { kind: 'peer', dir: 'in', other: ev.from, text: ev.text, at: at ?? 0 }
            : ev.kind === 'tool_use' ? { kind: 'peer', dir: 'out', other: ev.input.to, ...(ev.input.summary ? { summary: String(ev.input.summary) } : {}), ...(/^a[0-9a-f]{16}$/.test(ev.input.to) ? { helper: true } : {}), text: String(ev.input.message ?? ''), at: at ?? 0 }
            : { kind: ev.kind, text: ev.text, at: at ?? 0, ...(ev.uuid ? { uuid: ev.uuid } : {}) });
          if (said.length > SAID_KEPT) said.shift();
        }
      }
    }
  } catch {
    // gone or unreadable: whatever was found so far
  }
  return result();
}

/** Just the file-tool calls of earlierHistory. */
export async function earlierFileCalls(path, end) {
  return (await earlierHistory(path, end)).files;
}
