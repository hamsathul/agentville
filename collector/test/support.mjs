import { deflateRawSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { isPrivate } from '../platform/private.mjs';

// Mac: the exact mode. Windows has no modes, so the same promise ("yours only") is checked as an owner-only ACL.
export function assertPrivate(path, posixMode, message) {
  if (process.platform === 'win32') assert.ok(isPrivate(path), message ?? `${path} is not owner-only`);
  else assert.equal(statSync(path).mode & 0o777, posixMode, message);
}

// A stand-in for the claude command, written as a shell script. On Windows a script cannot be run directly, so it gets a
// claude.cmd that hands it to Git's bash (which Claude Code itself needs there). Returns the path to run, or null when
// there is no bash to run it with (the caller then skips, with that reason).
export const GIT_BASH = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find(p => existsSync(p)) ?? null;
export function shellStandIn(bin, script) {
  if (process.platform !== 'win32') {
    writeFileSync(bin, script, { mode: 0o755 });
    return bin;
  }
  if (!GIT_BASH) return null;
  const sh = `${bin}.sh`;
  writeFileSync(sh, script);
  writeFileSync(`${bin}.cmd`, `@"${GIT_BASH.replaceAll('/', String.fromCharCode(92))}" "${sh.replaceAll(String.fromCharCode(92), '/')}" %*${String.fromCharCode(13, 10)}`);
  return `${bin}.cmd`;
}
export const toSh = p => p.replaceAll(String.fromCharCode(92), '/');

/** A zip archive of { name: text }, deflated (CRCs left out: the readers here do not check them). */
export function zipOf(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
