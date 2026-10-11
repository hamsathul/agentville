import { run } from '../lib/exec.mjs';
import { readPs } from '../sources/ps.mjs';
/** macOS notification. Title/message travel as argv, never inside the script text. */
export function notifyMac(title, message, runner = run) {
  const script = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'];
  return runner('osascript', [...script.flatMap(line => ['-e', line]), String(title), String(message)], { timeoutMs: 5000 });
}

export const notify = notifyMac;

// macOS's textutil: the document as a page, and as plain text to quote from.
export async function readWordFile(real, runner = run) {
  const [html, text] = await Promise.all(['html', 'txt'].map(as => runner('textutil', ['-convert', as, '-stdout', real], { timeoutMs: 30_000 })));
  if (html.code !== 0) return { status: 415, error: `macOS could not read this document (${html.stderr.trim().split('\n')[0] || `exit ${html.code}`}).` };
  return { view: 'word', html: html.stdout, text: text.code === 0 ? text.stdout : '' };
}

// A session's process, for ending it: its command line, its terminal, a signal, whether it still runs.
export const sessionProcs = {
  commandOf: async pid => { const r = await run('ps', ['-o', 'command=', '-p', String(pid)], { timeoutMs: 5000 }); return r.code === 0 ? r.stdout.trim() : null; },
  ttyOf: async pid => { const r = await run('ps', ['-o', 'tty=', '-p', String(pid)], { timeoutMs: 5000 }); const t = r.code === 0 ? r.stdout.trim() : ''; return /^ttys\d+$/.test(t) ? t : null; },
  kill: (pid, sig) => process.kill(pid, sig),
  alive: pid => { try { process.kill(pid, 0); return true; } catch { return false; } },
  killGroup: (pgid, sig) => process.kill(-pgid, sig), // a shell command and everything it started
  groupAlive: pgid => { try { process.kill(-pgid, 0); return true; } catch { return false; } },
};

export const readProcs = readPs;

export const scratchBase = () => `/private/tmp/claude-${process.getuid?.() ?? 0}`;
export const folderRoots = home => [home, '/Volumes'];
export const openFolder = (dir, runner = run) => runner('open', ['-a', 'Finder', dir], { timeoutMs: 10_000 }); // by name: a dir that names an app is shown, never launched
export const revealFile = (real, runner = run) => runner('open', ['-R', real], { timeoutMs: 10_000 });

export const isClaudeCommand = command => /(^|\/|\s)claude(\s|$)/.test(command ?? '');
export const name = 'mac';
export const fileManager = 'Finder'; // named in the texts the dashboard shows
