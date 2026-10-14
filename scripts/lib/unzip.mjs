// A zip read into its files: name → bytes, stored or deflated entries (what a model kit's download holds). No
// dependencies: node's zlib.
import { inflateRawSync } from 'node:zlib';

/** Every file in a zip, by its name in the zip. */
export function readZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip (no end of central directory)');
  const count = buf.readUInt16LE(end + 10), files = new Map();
  let at = buf.readUInt32LE(end + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('a broken zip (central directory)');
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(dataAt, dataAt + size);
    if (!name.endsWith('/')) files.set(name, method === 8 ? inflateRawSync(data) : method === 0 ? Buffer.from(data) : (() => { throw new Error(`${name}: compression ${method} not handled`); })());
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
