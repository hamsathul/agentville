// A PNG read into RGBA bytes: 8 bits a channel, colour type 2 (RGB) or 6 (RGBA), not interlaced. Enough for a model
// kit's palette texture (scripts/farm3d-models.mjs bakes Kenney's into colours). No dependencies: node's zlib.
import { inflateSync } from 'node:zlib';

/** { width, height, rgba } of a PNG's bytes. */
export function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), kind = buf.toString('latin1', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace) throw new Error(`a PNG this can't read: depth ${depth}, colour type ${type}${interlace ? ', interlaced' : ''}`);
  const bpp = type === 6 ? 4 : 3, row = width * bpp, raw = inflateSync(Buffer.concat(idat)), out = Buffer.alloc(height * row);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (row + 1)], line = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1)), prev = y ? out.subarray((y - 1) * row, y * row) : null, cur = out.subarray(y * row, (y + 1) * row);
    for (let i = 0; i < row; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      cur[i] = (line[i] + pred) & 0xff;
    }
  }
  if (bpp === 4) return { width, height, rgba: new Uint8Array(out) };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) { rgba[j] = out[i]; rgba[j + 1] = out[i + 1]; rgba[j + 2] = out[i + 2]; rgba[j + 3] = 255; }
  return { width, height, rgba };
}
