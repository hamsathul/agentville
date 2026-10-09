import { appendFileSync, closeSync, createReadStream, createWriteStream, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { cleanPrompt } from '../transcript/parse.mjs';

// Forking a conversation at one of its messages, and restoring one to before a message of yours. Claude Code can fork a whole session (--resume
// --fork-session), and --resume takes a transcript's path: so the tracker writes a copy cut at the
// message, and Claude Code makes the new session from it. The original is never touched.
const KEEP_MS = 3_600_000; // a copy is only read as the new session starts

/**
 * A copy of a session's transcript cut at one of its messages: up to and including a reply of
 * Claude's, or, for a message of yours, up to the last message before it (your message's text then
 * goes to `prefillFile`, for the new session's prompt box). Both go in a new folder under `dir`,
 * yours only, the copy named as the session. { file, prefillFile? } or { error }.
 */
export async function cutTranscript(path, uuid, dir, sessionId) {
  const target = `"uuid":"${uuid}"`;
  let at = 0, lastMessageEnd = 0, cut = null, prefill, refused = null;
  const input = createReadStream(path);
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      const end = at + Buffer.byteLength(line) + 1;
      at = end;
      if (line.includes(target)) {
        let row = null;
        try { row = JSON.parse(line); } catch { /* a broken line: not the one */ }
        if (row?.uuid === uuid) {
          if (row.type === 'assistant') cut = end;
          else if (row.type === 'user' && row.isMeta !== true) {
            if (lastMessageEnd) {
              cut = lastMessageEnd;
              prefill = cleanPrompt(textOf(row.message?.content));
            } else refused = "That is the conversation's first message: start a new session instead (＋ Session).";
          } else refused = 'That is not a message to fork from.';
          break;
        }
      }
      if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) lastMessageEnd = end;
    }
  } catch {
    return { error: "That session's transcript could not be read." };
  } finally {
    input.destroy();
  }
  if (refused) return { error: refused };
  if (cut === null) return { error: 'That message is not in its transcript any more.' };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const folder = mkdtempSync(join(dir, 'f-'));
  const file = join(folder, `${sessionId}.jsonl`);
  await pipeline(createReadStream(path, { start: 0, end: cut - 1 }), createWriteStream(file, { mode: 0o600 }));
  if (prefill === undefined) return { file };
  const prefillFile = join(folder, 'prompt.txt');
  writeFileSync(prefillFile, prefill, { mode: 0o600 });
  return { file, prefillFile };
}

const textOf = content => (typeof content === 'string' ? content : (content ?? []).filter(b => b?.type === 'text').map(b => b.text ?? '').join('\n'));

/**
 * Where a restore to before one of your messages goes back to: the row your message follows
 * (Claude Code walks up from it to the message before), and your message's text, for the prompt box.
 * { leafUuid, prompt } or { error }.
 */
export async function restorePoint(path, uuid) {
  const target = `"uuid":"${uuid}"`;
  const rows = new Map(); // uuid → { type, parent } of the rows before it
  let found = null;
  const input = createReadStream(path);
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (typeof row?.uuid !== 'string') continue;
      if (line.includes(target) && row.uuid === uuid) { found = row; break; }
      rows.set(row.uuid, { type: row.type, parent: row.parentUuid });
    }
  } catch {
    return { error: "That session's transcript could not be read." };
  } finally {
    input.destroy();
  }
  if (!found) return { error: 'That message is not in its transcript any more.' };
  const content = found.message?.content;
  if (found.type !== 'user' || found.isMeta === true || (Array.isArray(content) && content.some(b => b?.type === 'tool_result'))) {
    return { error: 'A session can only be restored to before one of your own messages.' };
  }
  let up = found.parentUuid;
  while (up && rows.has(up) && !['user', 'assistant'].includes(rows.get(up).type)) up = rows.get(up).parent;
  if (!up || !rows.has(up)) return { error: "That is the conversation's first message: start a new session instead (＋ Session)." };
  return { leafUuid: found.parentUuid, prompt: cleanPrompt(textOf(content)) };
}

/**
 * Restores a conversation to `leafUuid` the way /rewind does: Claude Code's own row saying where it
 * goes on from, added at the end. Nothing is removed; what came after stays in the file, unused.
 * Only for a session that is not running.
 */
export function appendRewind(path, { leafUuid, sessionId }) {
  const fd = openSync(path, 'r');
  let last = '\n';
  try {
    const size = fstatSync(fd).size;
    if (size > 0) {
      const b = Buffer.alloc(1);
      readSync(fd, b, 0, 1, size - 1);
      last = b.toString();
    }
  } finally {
    closeSync(fd);
  }
  appendFileSync(path, `${last === '\n' ? '' : '\n'}${JSON.stringify({ type: 'last-prompt', leafUuid, sessionId, explicit: true, rewound: true })}\n`);
}

/** Removes fork copies older than an hour. */
export function pruneForks(dir, now, keepMs = KEEP_MS) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return; // no forks yet
  }
  for (const name of names) {
    try {
      if (now - statSync(join(dir, name)).mtimeMs > keepMs) rmSync(join(dir, name), { recursive: true, force: true });
    } catch {
      // gone already
    }
  }
}
