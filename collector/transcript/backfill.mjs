import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseEntry } from './parse.mjs';

// After a restart the collector reads only the tail of each transcript. This finds the file-tool
// calls in the part it skipped, so Documents, the explorer's marks and the farm's field close-ups
// keep the session's earlier files. Lines without a file-tool call are skipped before parsing.
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read']);

/** [{ name, input, at, cwd }] for file-tool calls in bytes [0, end) of a transcript, oldest first. */
export async function earlierFileCalls(path, end) {
  const calls = [];
  if (!(end > 0)) return calls;
  const lines = createInterface({ input: createReadStream(path, { start: 0, end: end - 1 }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes('"tool_use"') || !/"(file_path|notebook_path)"/.test(line)) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // the line cut at `end`, or a broken one
      }
      const { at, events } = parseEntry(entry);
      for (const ev of events) if (ev.kind === 'tool_use' && FILE_TOOLS.has(ev.name)) calls.push({ name: ev.name, input: ev.input, at: at ?? 0, cwd: ev.cwd });
    }
  } catch {
    // gone or unreadable: whatever was found so far
  }
  return calls;
}
