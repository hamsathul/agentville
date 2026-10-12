import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export function expandHome(path, home = homedir()) {
  if (path === '~') return home;
  return path.startsWith('~/') || path.startsWith('~' + String.fromCharCode(92)) ? join(home, path.slice(2)) : path;
}

// Absolute paths inside a word or a heredoc's text. A drive path (C:\x, C:/x) only on Windows: on a Mac `sed 's:/a:/b:'` would be one.
const ABSOLUTE = /(?:^|[\s'"=:(])((?:~|\/Users|\/private|\/tmp|\/Volumes|\/opt)\/[^\s'";|&)<>]*)/g;
const ABSOLUTE_WIN = /(?:^|[\s'"=:(])((?:~|\/Users|\/private|\/tmp|\/Volumes|\/opt)\/[^\s'";|&)<>]*|[A-Za-z]:[\\/][^\s'";|&)<>]*)/g;
// A word that is a path from end to end.
const PATH_WORD = /^(?:~|\/Users|\/private|\/tmp|\/Volumes|\/opt)\//;
const PATH_WORD_WIN = /^(?:(?:~|\/Users|\/private|\/tmp|\/Volumes|\/opt)\/|[A-Za-z]:[\\/])/;

const RANK = { read: 0, write: 1, git: 2 };
const GIT_CHANGES = new Set(['commit', 'checkout', 'switch', 'stash', 'reset', 'rebase', 'merge', 'push', 'pull', 'mv', 'rm', 'restore', 'clean', 'apply', 'am', 'cherry-pick', 'revert']);
const CHANGES_ALL = new Set(['rm', 'rmdir', 'mkdir', 'touch', 'mv', 'tee']); // every path it is given
const COPIES = new Set(['cp', 'ln']); // reads its sources, writes the last path
// Words before the command itself: a prefix that runs it, a shell keyword, a variable set for it.
const LEADING = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time', 'nice', 'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{']);
const SHELLS = new Set(['sh', 'bash', 'zsh']);
const INTERPRETERS = /^(?:python[\d.]*|node|ruby|perl|php|deno|bun)$/;
// Code that writes a file (Python, Node, Ruby, Perl…); printing to stdout or stderr isn't.
const CODE_WRITES = /open\([^)]*,\s*['"][wax]b?\+?['"]|(?<!stdout|stderr)\.write(?:_text|_bytes)?\(|(?:write|append)File(?:Sync)?\(|createWriteStream|(?:copyFile|rename|unlink|rm|rmdir|mkdir)(?:Sync)?\(|shutil\.|os\.(?:remove|rename|replace|unlink|makedirs|mkdir|rmdir)\(|\.(?:unlink|mkdir|touch)\(/;
const NOWHERE = /^(?:\/dev\/|nul$)/i;
// What a backslash escapes outside quotes; elsewhere it stays (a Windows path's C:\work).
const ESCAPABLE = new Set([' ', '\t', '\n', '"', "'", '\\', '$', '`', ';', '&', '|', '<', '>', '(', ')']);

/**
 * A shell command as the shell reads it: its simple commands (split at ; && || | & newlines and
 * parentheses), each with its words (quotes gone; $(…) and `…` kept inside their word), its
 * redirections, and what it gets on its input (heredoc bodies and here-strings).
 */
function parseShell(s) {
  const segments = [], heredocs = [];
  const fresh = () => ({ words: [], redirs: [], stdin: [] });
  let seg = fresh(), word = null, redirect = null, heredocNext = false;
  const add = text => { word = (word ?? '') + text; };
  const endWord = () => {
    if (word === null) return;
    if (heredocNext) { heredocs.push({ delim: word, seg }); heredocNext = false; }
    else if (redirect === '<<<') { seg.stdin.push(word); redirect = null; }
    else if (redirect) { seg.redirs.push({ op: redirect, target: word }); redirect = null; }
    else seg.words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (seg.words.length || seg.redirs.length || seg.stdin.length || heredocs.some(h => h.seg === seg)) segments.push(seg);
    seg = fresh(); redirect = null;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && ESCAPABLE.has(s[i + 1])) { if (s[i + 1] !== '\n') add(s[i + 1]); i += 2; continue; }
    if (c === "'") {
      const close = s.indexOf("'", i + 1), end = close < 0 ? s.length : close;
      add(s.slice(i + 1, end)); i = end + 1; continue;
    }
    if (c === '"') {
      let j = i + 1, text = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && '"\\$`'.includes(s[j + 1] ?? '')) { text += s[j + 1]; j += 2; } else text += s[j++];
      }
      add(text); i = j + 1; continue;
    }
    if ((c === '$' && s[i + 1] === '(') || c === '`') { // a command substitution stays inside its word
      let j = i + 1;
      if (c === '`') while (j < s.length && s[j] !== '`') j++;
      else for (let depth = 0; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
      add(s.slice(i, j + 1)); i = j + 1; continue;
    }
    if (c === '\n') {
      endSegment(); i++;
      for (const { delim, seg: owner } of heredocs.splice(0)) { // the bodies follow, one after another, each up to its delimiter's line
        while (i < s.length) {
          const nl = s.indexOf('\n', i), end = nl < 0 ? s.length : nl, line = s.slice(i, end);
          i = end + 1;
          if (line.replace(/^\t+/, '') === delim) break;
          owner.stdin.push(line);
        }
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue; }
    if (c === '&' && s[i + 1] === '>') { endWord(); redirect = '>'; i += s[i + 2] === '>' ? 3 : 2; continue; } // &> and &>>: both outputs
    if (';&|()'.includes(c)) { endSegment(); i += s[i + 1] === c && ';&|'.includes(c) ? 2 : 1; continue; }
    if (c === '>' && word !== null && /[=-]$/.test(word)) { add(c); i++; continue; } // => and -> in a word aren't redirects
    if (c === '>' || c === '<') {
      if (word !== null && /^\d+$/.test(word)) word = null; else endWord(); // 2> : the number is the stream, not a word
      if (s.startsWith('<<<', i)) { redirect = '<<<'; i += 3; continue; }
      if (s.startsWith('<<', i)) { heredocNext = true; i += s[i + 2] === '-' ? 3 : 2; continue; }
      if (s[i + 1] === '&') { i += 2; while (i < s.length && /[\d-]/.test(s[i])) i++; continue; } // 2>&1, >&2: into another stream
      redirect = c; i += s[i + 1] === '>' || s[i + 1] === '|' ? 2 : 1; continue;
    }
    add(c); i++;
  }
  endSegment();
  return segments;
}

/**
 * The folders and files a shell command touches, as absolute paths, each with what it does there:
 * `git` for the repo a git command that changes it (commit, checkout, push…) acts on; `write` for
 * what it redirects to (> >> &>) or changes (rm, rmdir, mkdir, touch, mv, tee, the last path of cp
 * or ln, the files of sed -i and perl -i), and for the paths an inline script that writes files
 * names (python3 - <<EOF, node -e…), or the folder it runs in if it names none; `read` for any other
 * path it names. A path only named (in an echo, a commit message, a pattern) is never a write. With
 * no path at all: the folder it runs in, read.
 */
export function bashTouches(command, cwd, home = homedir()) {
  const win = process.platform === 'win32';
  const found = new Map();
  let here = cwd; // the folder the next command runs in: cd moves it
  const pathOf = (raw, base = here) => {
    if (!raw || NOWHERE.test(raw)) return null;
    const expanded = expandHome(raw, home);
    // On Windows one path has many spellings (drive with either slash, or rooted): resolve to one native form so it counts once.
    // (a rooted path with no drive is on the drive of the command's own folder, not of this process)
    if (isAbsolute(expanded)) return resolve(win ? base || '.' : '/', expanded);
    return base ? resolve(base, expanded) : null;
  };
  const put = (path, mode) => { if (path && !(RANK[found.get(path)] >= RANK[mode])) found.set(path, mode); };
  // a path to change: one with a glob or a variable in it counts as the folder before that
  const operand = w => {
    const cut = w.search(/[*?[$`]/);
    if (cut < 0) return w;
    const slash = Math.max(w.lastIndexOf('/', cut), win ? w.lastIndexOf('\\', cut) : -1);
    return w.slice(0, slash + 1) || '.';
  };
  // the absolute paths a word or some text names; how many
  const names = (text, mode = 'read') => {
    if (!/\s/.test(text) && (win ? PATH_WORD_WIN : PATH_WORD).test(text)) { put(pathOf(text), mode); return 1; }
    let n = 0;
    for (const m of text.matchAll(win ? ABSOLUTE_WIN : ABSOLUTE)) { put(pathOf(m[1].replace(/[.,:!?]+$/, '')), mode); n++; } // a sentence's full stop isn't the path's
    return n;
  };
  const reads = text => { names(text); };
  for (const { words, redirs, stdin } of parseShell(command)) {
    for (const r of redirs) put(pathOf(operand(r.target)), r.op === '<' ? 'read' : 'write');
    const args = [...words];
    while (args.length && (LEADING.has(args[0]) || /^[A-Za-z_]\w*=/.test(args[0]))) reads(args.shift()); // sudo, do, X=1
    const [cmd = '', ...rest] = args;
    const name = cmd.split(/[\\/]/).pop();
    const operands = rest.filter(w => !w.startsWith('-'));
    const input = stdin.join('\n');
    if (name === 'cd' || name === 'pushd') {
      if (!operands.length) { here = home; continue; }
      const to = pathOf(operand(operands[0]));
      if (to) { put(to, 'read'); here = to; }
      continue;
    }
    if (name === 'git') {
      let at = here, sub;
      for (let k = 0; k < rest.length; k++) {
        if (rest[k] === '-C') at = pathOf(rest[++k] ?? '', at) ?? at;
        else if (rest[k] === '-c') k++;
        else if (!rest[k].startsWith('-')) { sub = rest[k]; break; }
      }
      if (at) put(at, GIT_CHANGES.has(sub) ? 'git' : 'read');
      rest.forEach(reads); reads(input);
      continue;
    }
    if (CHANGES_ALL.has(name)) { for (const w of operands) put(pathOf(operand(w)), 'write'); reads(input); continue; }
    if (COPIES.has(name)) { operands.forEach((w, k) => put(pathOf(operand(w)), k === operands.length - 1 ? 'write' : 'read')); continue; }
    if (name === 'sed' && rest.some(w => /^-[a-zA-Z]*i|^--in-place/.test(w))) {
      let script = rest.some(w => /^(?:-e|-f|--expression|--file)/.test(w)); // given with -e/-f: every other word is a file
      for (let k = 0; k < rest.length; k++) {
        const w = rest[k];
        if (/^-[a-zA-Z]*i$/.test(w) && rest[k + 1] === '') k++; // BSD's -i '' (no backup file)
        else if (w === '-e' || w === '-f' || w === '--expression' || w === '--file') k++;
        else if (w.startsWith('-')) continue;
        else if (!script) script = true;
        else put(pathOf(operand(w)), 'write');
      }
      continue;
    }
    if (name === 'find') { // it changes what it finds with -delete or -exec rm…: the folders it searches
      const firstTest = rest.findIndex(w => /^[-(!]/.test(w));
      const starts = firstTest < 0 ? rest : rest.slice(0, firstTest);
      const exec = rest.findIndex(w => w === '-exec' || w === '-execdir');
      const changes = rest.includes('-delete') || (exec >= 0 && (CHANGES_ALL.has(rest[exec + 1]) || COPIES.has(rest[exec + 1])));
      for (const w of starts.length ? starts : ['.']) put(pathOf(operand(w)), changes ? 'write' : 'read');
      continue;
    }
    if (name === 'xargs') { // the command it runs gets its paths from the input: unknown, so the folder it runs in
      let k = 0;
      while (k < rest.length && rest[k].startsWith('-')) k += /^-[IdnLPsE]$/.test(rest[k]) ? 2 : 1;
      const runs = (rest[k] ?? '').split(/[\\/]/).pop();
      if (CHANGES_ALL.has(runs) || COPIES.has(runs) || (runs === 'sed' && rest.some(w => /^-[a-zA-Z]*i/.test(w)))) put(here, 'write');
      rest.forEach(reads);
      continue;
    }
    if (SHELLS.has(name) && (rest.includes('-c') || (!operands.length && input))) { // a shell in a shell: what it runs counts
      const inner = rest.includes('-c') ? rest[rest.indexOf('-c') + 1] ?? '' : input;
      for (const t of bashTouches(inner, here, home)) put(t.path, t.mode);
      continue;
    }
    if (INTERPRETERS.test(name)) {
      const perl = name.startsWith('perl');
      const at = rest.findIndex(w => (perl ? /^-[a-zA-Z]*[eE]$/ : /^(?:-[ceErp]|--eval|--print)$/).test(w));
      const code = at >= 0 ? rest[at + 1] ?? '' : !operands.length || rest.includes('-') ? input : null; // - : the code is on its input
      if (code !== null) { // inline code: what it does is in the command
        if (perl && rest.some(w => /^-[a-zA-Z]*i/.test(w))) rest.forEach((w, k) => { if (k !== at + 1 && !w.startsWith('-')) put(pathOf(operand(w)), 'write'); }); // perl -pi -e: edits its files
        if (CODE_WRITES.test(code)) { if (!names(code, 'write')) put(here, 'write'); } else reads(code);
        continue;
      }
    }
    args.forEach(reads); reads(input);
  }
  if (found.size === 0 && cwd) found.set(cwd, 'read');
  return [...found].map(([path, mode]) => ({ path, mode }));
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
      return bashTouches(input.command, call.cwd, home);
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
