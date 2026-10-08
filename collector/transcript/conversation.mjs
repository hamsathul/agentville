import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { SessionModel } from './session-model.mjs';

// A session's whole conversation, for the conversation dialog: every message from the first. A
// transcript can be hundreds of MB, so it is read a chunk at a time (letting the collector get on
// with other work in between), and after that only what was added since.
const CHUNK_BYTES = 4 * 1024 * 1024;
const breather = () => new Promise(resolve => setImmediate(resolve));

export class Conversation {
  constructor(path, { chunkBytes = CHUNK_BYTES } = {}) {
    this.path = path;
    this.chunkBytes = chunkBytes;
    this.offset = 0; // read up to here: always just past a newline
    this.usedAt = 0;
    this.reading = null;
    this.model = new SessionModel({ feedCap: 1, saidCap: Infinity, callCap: 1, fileCap: 1 }); // only its messages are kept whole
  }

  /** Reads what was added since the last read (all of it, the first time). Two at once read once. */
  update() {
    this.reading ??= this.#read().finally(() => { this.reading = null; });
    return this.reading;
  }

  async #read() {
    let fd;
    try {
      fd = openSync(this.path, 'r');
    } catch {
      return; // gone: what was read stays
    }
    try {
      const size = fstatSync(fd).size;
      if (size < this.offset) { // replaced by a shorter file: start again
        this.offset = 0;
        this.model = new SessionModel({ feedCap: 1, saidCap: Infinity, callCap: 1, fileCap: 1 });
      }
      let want = this.chunkBytes;
      while (this.offset < size) {
        const buf = Buffer.alloc(Math.min(want, size - this.offset));
        readSync(fd, buf, 0, buf.length, this.offset);
        const nl = buf.lastIndexOf(0x0a);
        if (nl === -1) { // no whole line yet: a line longer than a chunk, or one still being written
          if (this.offset + buf.length >= size) break;
          want *= 2;
          continue;
        }
        this.model.applyLines(buf.subarray(0, nl).toString('utf8').split('\n').filter(line => line.trim() !== ''));
        this.offset += nl + 1;
        want = this.chunkBytes;
        await breather();
      }
    } finally {
      closeSync(fd);
    }
  }

  /** The messages from the `from`-th on, oldest first: { total, from, items: [{ at, kind, body, … }] }. */
  messages(from = 0) {
    const said = this.model.said; // newest first
    const total = said.length;
    return { total, from, items: said.slice(0, Math.max(0, total - from)).reverse() };
  }
}
