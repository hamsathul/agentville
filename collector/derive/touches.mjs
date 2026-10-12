import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const GIT_MUTATING = /\bgit\b(?:\s+-C\s+\S+|\s+-c\s+\S+)*\s+(commit|checkout|switch|stash|reset|rebase|merge|push|pull)\b/;
const WRITE_CMD = /(^|[\s;&|(])(tee|rm|mv|cp|mkdir|touch)\s|\bsed\s+-i\b/;

export function expandHome(path, home = homedir()) {
  if (path === '~') return home;
  return path.startsWith('~/') || path.startsWith('~' + String.fromCharCode(92)) ? join(home, path.slice(2)) : path;
}

/** Folders/files a shell command works on, as absolute paths. */
export function bashTargets(command, cwd, home = homedir()) {
  const found = new Set();
  const add = raw => {
    const clean = raw.replace(/^['"]|['"]$/g, '');
    if (!clean) return;
    const expanded = expandHome(clean, home);
    // On Windows one path has many spellings (drive with either slash, or rooted): resolve to one native form so it counts once.
    // (a rooted path with no drive is on the drive of the command's own folder, not of this process)
    if (isAbsolute(expanded)) found.add(process.platform === 'win32' ? resolve(cwd || '.', expanded) : expanded);
    else if (cwd) found.add(resolve(cwd, expanded));
  };
  for (const m of command.matchAll(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/g)) add(m[1]);
  for (const m of command.matchAll(/(?:^|[;&|(]\s*|\s)cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g)) add(m[1]);
  for (const m of command.matchAll(/(?:^|[\s'"=:(])((?:~|\/Users|\/private|\/tmp|\/Volumes|\/opt)\/[^\s'";|&)<>]*|[A-Za-z]:[\\/][^\s'";|&)<>]*)/g)) add(m[1]);
  if (found.size === 0 && cwd) found.add(cwd);
  return [...found];
}

export function bashMode(command) {
  if (GIT_MUTATING.test(command)) return 'git';
  // Quoted text ('a > 1' in node -e, jq or grep patterns) is not a redirect.
  const unquoted = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
  const stripped = unquoted.replace(/\d*>&\d+/g, '').replace(/&?>>?\s*\/dev\/null/g, '');
  if (/>/.test(stripped.replace(/=>|->/g, '')) || WRITE_CMD.test(stripped)) return 'write';
  return 'read';
}

export function touchesFromCall(call, home = homedir()) {
  const input = call.input ?? {};
  switch (call.name) {
    case 'Edit':
    case 'Write':
      return input.file_path ? [{ path: expandHome(input.file_path, home), mode: 'write' }] : [];
    case 'NotebookEdit': {
      const p = input.notebook_path ?? input.file_path;
      return p ? [{ path: expandHome(p, home), mode: 'write' }] : [];
    }
    case 'Read':
      return input.file_path ? [{ path: expandHome(input.file_path, home), mode: 'read' }] : [];
    case 'Grep':
    case 'Glob': {
      const p = input.path ?? call.cwd;
      return p ? [{ path: expandHome(p, home), mode: 'read' }] : [];
    }
    case 'Bash': {
      if (typeof input.command !== 'string') return [];
      const mode = bashMode(input.command);
      return bashTargets(input.command, call.cwd, home).map(path => ({ path, mode }));
    }
    default:
      return [];
  }
}

/** One entry per path+mode touched at or after `since`, newest first. */
export function collectTouches(calls, since, home = homedir()) {
  const latest = new Map();
  for (const call of calls) {
    if (call.at < since) continue;
    for (const t of touchesFromCall(call, home)) {
      const key = `${t.mode}\0${t.path}`;
      const prev = latest.get(key);
      latest.set(key, {
        path: t.path,
        mode: t.mode,
        firstAt: prev ? Math.min(prev.firstAt, call.at) : call.at,
        lastAt: prev ? Math.max(prev.lastAt, call.at) : call.at,
      });
    }
  }
  return [...latest.values()].sort((a, b) => b.lastAt - a.lastAt);
}
