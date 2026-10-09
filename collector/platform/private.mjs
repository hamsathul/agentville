import { chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';


const WIN = process.platform === 'win32';
// System32 binaries by full path: a PATH copy (Git for Windows ships its own whoami, which omits the domain) must not stand in.
const SYS32 = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
const whoami = () => execFileSync(join(SYS32, 'whoami.exe'), { encoding: 'utf8' }).trim();

// Owner-only access. Mac: mode 0600 / 0700. Windows has no such modes, so the ACL is replaced with one entry for this
// user and inheritance is removed (what chmod 600 means there). It throws if it cannot, rather than leave a token readable.
export function makePrivate(path) {
  const isDir = statSync(path).isDirectory();
  if (!WIN) {
    chmodSync(path, isDir ? 0o700 : 0o600);
    return;
  }
  const grant = `${whoami()}:${isDir ? '(OI)(CI)F' : 'F'}`;
  execFileSync(join(SYS32, 'icacls.exe'), [path, '/inheritance:r', '/grant:r', grant], { stdio: 'pipe' });
  if (!isPrivate(path)) throw new Error(`could not make ${path} private: the ACL check after icacls failed`);
}

// True when `who` is the only account in icacls output. The first line is the path followed by the first entry, the rest are the
// entry alone, and the path icacls prints need not be the one it was given (a short 8.3 name such as C:\Users\RUNNER~1 comes back in
// its long form), so a line is read from its end: whatever stands before ":(flags)" must finish with the account, after a space or at
// the start. Anything else, a second entry included, is not private. A pure function, so it is tested on text.
export function onlyAccount(out, who) {
  const entries = [];
  for (const raw of String(out).split(/\r?\n/)) {
    const m = raw.match(/^(.*?):((?:\([^()]*\))+)\s*$/);
    if (m) entries.push(m[1]);
  }
  if (entries.length !== 1 || !who) return false;
  const before = entries[0].toLowerCase(), account = who.toLowerCase();
  return before === account || before.endsWith(` ${account}`);
}

// True when nobody but the owner has any access. False (never an exception) when the path is missing or unreadable.
export function isPrivate(path) {
  try {
    if (!WIN) return (statSync(path).mode & 0o077) === 0;
    const out = execFileSync(join(SYS32, 'icacls.exe'), [path], { encoding: 'utf8', stdio: 'pipe' });
    return onlyAccount(out, whoami());
  } catch {
    return false;
  }
}
