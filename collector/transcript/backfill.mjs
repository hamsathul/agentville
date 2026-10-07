import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseEntry } from './parse.mjs';

// After a restart the collector reads only the tail of each transcript. This finds, in the part it
// skipped, the file-tool calls (so Documents, the explorer's marks and the farm's field close-ups keep
// the session's earlier files) and the conversation (so your earlier messages and the replies stay).
// Lines that can hold neither are skipped before parsing.
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read']);
const SAID_KEPT = 200;

/**
 * Bytes [0, end) of a transcript, oldest first: `files` [{ name, input, at, cwd }] for file-tool calls
 * and `said` [{ kind: 'prompt' | 'reply', text, at }] for the last 200 messages.
 */
export async function earlierHistory(path, end) {
  const files = [], said = [];
  if (!(end > 0)) return { files, said };
  const lines = createInterface({ input: createReadStream(path, { start: 0, end: end - 1 }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const fileCall = line.includes('"tool_use"') && /"(file_path|notebook_path)"/.test(line);
      const message = (line.includes('"type":"user"') && !line.includes('"tool_result"')) || (line.includes('"type":"assistant"') && line.includes('"type":"text"'));
      if (!fileCall && !message) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // the line cut at `end`, or a broken one
      }
      const { at, events } = parseEntry(entry);
      for (const ev of events) {
        if (ev.kind === 'tool_use' && FILE_TOOLS.has(ev.name)) files.push({ name: ev.name, input: ev.input, at: at ?? 0, cwd: ev.cwd });
        else if (ev.kind === 'prompt' || ev.kind === 'reply') {
          said.push({ kind: ev.kind, text: ev.text, at: at ?? 0 });
          if (said.length > SAID_KEPT) said.shift();
        }
      }
    }
  } catch {
    // gone or unreadable: whatever was found so far
  }
  return { files, said };
}

/** Just the file-tool calls of earlierHistory. */
export async function earlierFileCalls(path, end) {
  return (await earlierHistory(path, end)).files;
}
