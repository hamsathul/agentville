import { execFile } from 'node:child_process';

/** Runs a command without a shell. Never rejects: failures resolve with a non-zero code. */
export function run(cmd, args, { timeoutMs = 15000, cwd, env } = {}) {
  return new Promise(resolve => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, cwd, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ code: typeof err.code === 'number' ? err.code : 1, stdout: String(stdout ?? ''), stderr: String(stderr || err.message) });
        } else {
          resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}
