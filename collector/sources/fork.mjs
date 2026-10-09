import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { cleanPrompt } from '../transcript/parse.mjs';

// Forking a conversation at one of its messages. Claude Code can fork a whole session (--resume
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
              prefill = cleanPrompt(typeof row.message?.content === 'string' ? row.message.content : (row.message?.content ?? []).filter(b => b?.type === 'text').map(b => b.text ?? '').join('\n'));
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
