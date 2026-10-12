// Runs in the terminal window a session opens in on Windows: node launch-claude.mjs <spec.json>
// The spec is data written by the collector: { claude, cwd, args[], prefillFile?, env? } (env: only CLAUDE_CONFIG_DIR, a folder to set or null to remove). Nothing in it is ever read as code or
// as a shell line: the program is started directly with an argument list, and Node quotes each argument for Windows itself.
import { readFileSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { findOnPath, shimTarget } from '../lib/winbin.mjs';

const refuse = why => { process.stderr.write(`launch refused: ${why}\n`); process.exit(2); };

const file = process.argv[2];
let spec;
try {
  const text = readFileSync(file, 'utf8');
  rmSync(file, { force: true }); // used once
  spec = JSON.parse(text);
} catch {
  refuse('the spec file could not be read');
}
if (!spec || typeof spec !== 'object') refuse('the spec is not an object');
const { claude, cwd, args, prefillFile, env } = spec;
if (typeof claude !== 'string' || !claude) refuse('no program to start');
if (typeof cwd !== 'string' || !cwd) refuse('no folder to start in');
if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) refuse('arguments must be a list of strings');
try { if (!statSync(cwd).isDirectory()) refuse('the folder is not a folder'); } catch { refuse('the folder does not exist'); }
// The collector names it by its full path; a bare name is found on PATH, never in the session's folder. npm's claude.cmd
// cannot be started by Node itself: what it points at is started instead (node and Claude Code's script, or its .exe).
const program = process.platform === 'win32' ? findOnPath(claude) : isAbsolute(claude) ? claude : null; // its tests run on a Mac too
if (!program) refuse(`the program was not found: ${claude}`);
try { if (!statSync(program).isFile()) refuse('the program is not a file'); } catch { refuse(`the program was not found: ${program}`); }
const shim = /\.(cmd|bat)$/i.test(program) ? shimTarget(program) : null;
if (/\.(cmd|bat)$/i.test(program) && !shim) refuse(`${program} is a script, not a program: set TRACKER_CLAUDE_BIN to claude.exe`);
// The one thing a spec may change in the environment is which account Claude runs on.
const childEnv = { ...process.env };
if (env !== undefined) {
  if (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).some(k => k !== 'CLAUDE_CONFIG_DIR')) refuse('the only variable a launch may set is CLAUDE_CONFIG_DIR');
  const dir = env.CLAUDE_CONFIG_DIR;
  if (dir === null) delete childEnv.CLAUDE_CONFIG_DIR;
  else if (typeof dir === 'string' && isAbsolute(dir)) childEnv.CLAUDE_CONFIG_DIR = dir;
  else refuse('CLAUDE_CONFIG_DIR must be a folder path, or null to remove it');
}
const full = [...args];
if (prefillFile !== undefined) {
  if (typeof prefillFile !== 'string') refuse('prefillFile must be a path');
  try { full.push('--prefill', readFileSync(prefillFile, 'utf8')); } catch { refuse('the prefill file could not be read'); }
}
const child = spawn(shim ? shim.program : program, shim ? [...shim.args, ...full] : full, { cwd, env: childEnv, stdio: 'inherit' });
child.on('error', err => refuse(`could not start: ${err.code ?? err.message}`));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
