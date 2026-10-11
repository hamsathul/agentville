import { chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';


const WIN = process.platform === 'win32';
// System32 binaries by full path: a PATH copy (Git for Windows ships its own whoami, which omits the domain) must not stand in.
const SYS32 = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
const whoami = () => execFileSync(join(SYS32, 'whoami.exe'), { encoding: 'utf8' }).trim();

// SYSTEM, Administrators, Users, Authenticated Users, Everyone, CREATOR OWNER, by SID so that no language or domain changes them.
const OTHERS = ['*S-1-5-18', '*S-1-5-32-544', '*S-1-5-32-545', '*S-1-5-11', '*S-1-1-0', '*S-1-3-0'];

// Owner-only access. Mac: mode 0600 / 0700. Windows has no such modes, so the ACL is replaced with one entry for this
// user and inheritance is removed (what chmod 600 means there). It throws if it cannot, rather than leave a token readable.
export function makePrivate(path) {
  const isDir = statSync(path).isDirectory();
  if (!WIN) {
    chmodSync(path, isDir ? 0o700 : 0o600);
    return;
  }
  const icacls = args => execFileSync(join(SYS32, 'icacls.exe'), [path, ...args], { stdio: 'pipe' });
  icacls(['/inheritance:r']);
  // "/inheritance:r" drops only what was inherited. A folder that names SYSTEM, Administrators, Users or Everyone as entries of its
  // own (a CI runner's temp folders do) keeps them, so the well-known ones are taken off by SID before the user is granted, which
  // is also what keeps this right when the user is SYSTEM. An account named in some other way is left and is refused below.
  icacls(['/remove:g', ...OTHERS]);
  icacls(['/grant:r', `${whoami()}:${isDir ? '(OI)(CI)F' : 'F'}`]);
  if (!isPrivate(path)) {
    // say what was read, so a refusal on a machine nobody can sit at (a CI runner) is not a guess
    let seen;
    try { seen = `icacls printed ${JSON.stringify(execFileSync(join(SYS32, 'icacls.exe'), [path], { encoding: 'utf8', stdio: 'pipe' }))} for ${JSON.stringify(whoami())}`; } catch (err) { seen = `icacls could not be read again: ${err.message}`; }
    throw new Error(`could not make ${path} private: the ACL check after icacls failed (${seen})`);
  }
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
