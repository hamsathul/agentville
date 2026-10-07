import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/**
 * Reads complete lines appended to files since the last read. Offsets advance only
 * past the last newline, so a half-written line (or half of a UTF-8 character) is
 * read whole next time.
 */
export class TailReader {
  constructor({ initialBytes = 256 * 1024, maxChunkBytes = 8 * 1024 * 1024 } = {}) {
    this.initialBytes = initialBytes;
    this.maxChunkBytes = maxChunkBytes;
    this.offsets = new Map();
    this.starts = new Map(); // where the first read of each file began: the part before it was skipped
  }

  read(path) {
    let fd;
    try {
      fd = openSync(path, 'r');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    try {
      const size = fstatSync(fd).size;
      const known = this.offsets.get(path);
      let offset;
      let dropFirst = false;
      if (known === undefined || size - known > this.maxChunkBytes) {
        offset = Math.max(0, size - this.initialBytes);
        dropFirst = offset > 0;
        if (known === undefined) this.starts.set(path, offset);
      } else if (size < known) {
        offset = 0;
      } else {
        offset = known;
      }
      if (size === offset) {
        this.offsets.set(path, offset);
        return [];
      }
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      const nl = buf.lastIndexOf(0x0a);
      if (nl === -1) {
        if (!dropFirst) this.offsets.set(path, offset);
        return [];
      }
      this.offsets.set(path, offset + nl + 1);
      const lines = buf.subarray(0, nl).toString('utf8').split('\n');
      if (dropFirst) lines.shift();
      return lines.filter(line => line.trim() !== '');
    } finally {
      closeSync(fd);
    }
  }

  /** Byte offset where the first read of this file began (0 = read from the start), or undefined if never read. */
  startOf(path) {
    return this.starts.get(path);
  }

  forget(path) {
    this.offsets.delete(path);
    this.starts.delete(path);
  }
}
