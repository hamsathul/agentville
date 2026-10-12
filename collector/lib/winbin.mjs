import { lstatSync, readFileSync, statSync } from 'node:fs';
import { win32 } from 'node:path';

// Finding a program on Windows. Windows looks for a program named without a folder in the working folder before PATH, and a
// session's folder is any repository: a claude.exe or git.exe put there would run. So programs are found here, on PATH only.

// A regular file, or an app-execution alias (wt.exe in WindowsApps), which stat reports missing and lstat sees.
function isProgramFile(p) {
  try { return statSync(p).isFile(); } catch { /* an alias, or nothing */ }
  try { return !lstatSync(p).isDirectory(); } catch { return false; }
}

/**
 * The full path of program `name` on PATH, trying PATHEXT's extensions when it has none; a full path is checked as it is. Never
 * the working folder, and never a relative PATH entry (an empty one means the working folder). Null when it is not found.
 */
export function findOnPath(name, { path = process.env.PATH ?? '', pathext = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD', isFile = isProgramFile } = {}) {
  if (typeof name !== 'string' || !name) return null;
  // with an extension it is run as named; without one, as Windows would: each PATHEXT extension in turn
  const exts = win32.extname(name) ? [''] : pathext.split(';').map(e => e.trim().toLowerCase()).filter(e => e.startsWith('.'));
  if (win32.isAbsolute(name)) {
    if (/^[\\/](?![\\/])/.test(name)) return null; // \x: on whichever drive the working folder is
    for (const ext of ['', ...exts]) if (isFile(name + ext)) return name + ext;
    return null;
  }
  if (/[\\/]/.test(name) || /^[A-Za-z]:/.test(name)) return null; // a relative path: relative to the working folder
  for (const raw of path.split(';')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(dir)) continue;
    for (const ext of exts) {
      const full = win32.join(dir, name + ext);
      if (isFile(full)) return full;
    }
  }
  return null;
}

/**
 * What an npm .cmd shim runs, so it can be started without cmd.exe: { program, args } (node and the package's script, or the
 * package's own .exe), or null for any other .cmd. npm's shims end with the target in quotes before %*, as
 *   "%_prog%"  "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
 * Node 24 will not start a .cmd itself, and through cmd.exe every argument is cmd syntax: this avoids both.
 */
export function shimTarget(cmdFile, { read = f => readFileSync(f, 'utf8'), isFile = isProgramFile, node = process.execPath } = {}) {
  if (typeof cmdFile !== 'string' || !/\.(cmd|bat)$/i.test(cmdFile)) return null;
  let text;
  try { text = String(read(cmdFile)); } catch { return null; }
  const m = text.match(/"%~?dp0%?\\([^"%\r\n]+)"\s*%\*/i);
  if (!m) return null;
  const target = win32.join(win32.dirname(cmdFile), m[1]);
  if (!isFile(target)) return null;
  if (/\.(c|m)?js$/i.test(target)) return { program: node, args: [target] };
  if (/\.exe$/i.test(target)) return { program: target, args: [] };
  return null;
}

// run() asks for git and the rest on every tick: a program found is remembered (checked again with one stat) until PATH changes,
// and one not found is not looked for again for 30 s (gh not installed would otherwise cost a look in every PATH folder each time).
const found = new Map(), missed = new Map();
/** findOnPath for this process's own PATH, remembered. */
export function findProgram(name, now = Date.now()) {
  const key = `${name}\u0000${process.env.PATH ?? ''}`;
  const hit = found.get(key);
  if (hit && isProgramFile(hit)) return hit;
  if (now - (missed.get(key) ?? -Infinity) < 30_000) return null;
  const full = findOnPath(name);
  if (full) { found.set(key, full); missed.delete(key); } else { found.delete(key); missed.set(key, now); }
  return full;
}
