import { execFile } from 'node:child_process';
import { join } from 'node:path';

// Anything cmd.exe reads as syntax (quotes, %VAR%, ^, &, |, <, >, !) or a control character. A .cmd shim is run through
// cmd.exe because Node 24 refuses to spawn one directly; so an argument holding any of these is refused, never escaped.
const CMD_SYNTAX = /[\u0000-\u001f"%^&|<>!]/;
const isCmdShim = cmd => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

/** Runs a command without a shell. Never rejects: failures resolve with a non-zero code. */
export function run(cmd, args, { timeoutMs = 15000, cwd, env } = {}) {
  let file = cmd;
  let argv = args;
  const opts = { timeout: timeoutMs, cwd, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 32 * 1024 * 1024 };
  if (isCmdShim(cmd)) {
    const bad = [cmd, ...args].find(a => CMD_SYNTAX.test(String(a)));
    if (bad !== undefined) return Promise.resolve({ code: 1, stdout: '', stderr: `refused: an argument for ${cmd} holds characters cmd.exe would read as syntax` });
    file = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'cmd.exe');
    const q = a => (a === '' || /\s/.test(a) ? `"${a}"` : a); // quoted only when it has a space, so a script sees the same text a program would
    argv = ['/d', '/s', '/c', `"${[cmd, ...args].map(q).join(' ')}"`];
    opts.windowsVerbatimArguments = true;
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
