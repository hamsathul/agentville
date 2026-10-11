import { renameSync } from 'node:fs';

// Put `tmp` in place of `file`. On a Mac that is rename(2). On Windows a rename over a file that another program has open
// without sharing it for deleting (a reader, a virus scanner, a backup) fails with EPERM, EBUSY or EACCES for as long as it is
// open, which is usually a fraction of a second: so those three are retried for up to `waitMs`, and then thrown as they were.
// Any other error is thrown at once.
const IN_USE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function replaceFile(tmp, file, { waitMs = 2000 } = {}) {
  const until = Date.now() + waitMs;
  for (let step = 10; ; step = Math.min(step * 2, 200)) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      if (process.platform !== 'win32' || !IN_USE.has(err.code) || Date.now() >= until) throw err;
      pause(step);
    }
  }
}
