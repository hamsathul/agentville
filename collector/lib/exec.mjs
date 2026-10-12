import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { findProgram, shimTarget } from './winbin.mjs';

// Anything cmd.exe reads as syntax (quotes, %VAR%, ^, &, |, <, >, !) or a control character. A .cmd that is not an npm shim
// is run through cmd.exe because Node 24 refuses to spawn one directly; so an argument holding any of these is refused, never escaped.
const CMD_SYNTAX = /[\u0000-\u001f"%^&|<>!]/;
const WIN = process.platform === 'win32';

/**
 * Runs a command without a shell. Never rejects: failures resolve with a non-zero code. On Windows the program is found on PATH
 * (never in the working folder: see winbin.mjs), and an npm .cmd shim runs what it points at, without cmd.exe.
 */
export function run(cmd, args, { timeoutMs = 15000, cwd, env, windowsVerbatimArguments } = {}) {
  let file = cmd;
  let argv = args;
  const opts = { timeout: timeoutMs, cwd, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 32 * 1024 * 1024, ...(windowsVerbatimArguments ? { windowsVerbatimArguments } : {}) };
  if (WIN) {
    file = findProgram(cmd);
    if (!file) return Promise.resolve({ code: 1, stdout: '', stderr: `spawn ${cmd} ENOENT (not found on PATH)` }); // Node's own words, as on a Mac
    const shim = shimTarget(file);
    if (shim) {
      file = shim.program;
      argv = [...shim.args, ...args];
    } else if (/\.(cmd|bat)$/i.test(file)) {
      const bad = [file, ...args].find(a => CMD_SYNTAX.test(String(a)));
      if (bad !== undefined) return Promise.resolve({ code: 1, stdout: '', stderr: `refused: an argument for ${cmd} holds characters cmd.exe would read as syntax` });
      // Quoted only when it has a space, so a script sees the same text a program would. Backslashes before the closing quote
      // are doubled, or the last one would escape it ("C:\My Dir\" ends the next argument, not this one).
      const q = a => (a === '' || /\s/.test(a) ? `"${a.replace(/(\\+)$/, '$1$1')}"` : a);
      argv = ['/d', '/s', '/c', `"${[file, ...args].map(q).join(' ')}"`];
      file = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'cmd.exe');
      opts.windowsVerbatimArguments = true;
    }
  }
  return new Promise(resolve => {
    const child = execFile(file, argv, opts, (err, stdout, stderr) => {
      if (err) {
        resolve({ code: typeof err.code === 'number' ? err.code : 1, stdout: String(stdout ?? ''), stderr: String(stderr || err.message) });
      } else {
        resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
      }
    });
    // Nothing is ever written to it: close it, so a program that reads its input gets the end and not a pipe that stays open
    // until the timeout (a Windows shim, git or bash waiting on it held a call for its whole timeout).
    child.stdin?.end();
  });
}
