import { run } from '../lib/exec.mjs';

// ps's elapsed time: [[dd-]hh:]mm:ss, in seconds.
const ETIME = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/;
const ageOf = etime => { const m = ETIME.exec(etime); return m ? ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4]) : 0; };

/** ps lines: pid ppid pgid etime %cpu rss command (what readPs asks for), or the shorter pid ppid %cpu rss command. */
export function parsePs(stdout) {
  const procs = new Map();
  for (const line of stdout.split('\n')) {
    const full = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+((?:\d+-)?(?:\d+:)?\d+:\d+)\s+([\d.,]+)\s+(\d+)\s+(.*)$/);
    if (full) {
      const pid = Number(full[1]);
      procs.set(pid, { pid, ppid: Number(full[2]), pgid: Number(full[3]), ageSec: ageOf(full[4]), cpu: Number(full[5].replace(',', '.')), rssKb: Number(full[6]), command: full[7] });
      continue;
    }
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    procs.set(pid, { pid, ppid: Number(m[2]), cpu: Number(m[3].replace(',', '.')), rssKb: Number(m[4]), command: m[5] });
  }
  return procs;
}

export function childrenIndex(procs) {
  const idx = new Map();
  for (const p of procs.values()) {
    if (!idx.has(p.ppid)) idx.set(p.ppid, []);
    idx.get(p.ppid).push(p.pid);
  }
  return idx;
}

export function label(command) {
  const [exe, ...rest] = command.split(' ');
  const base = exe.split('/').pop();
  const arg = rest.find(a => a && !a.startsWith('-'));
  return (arg ? `${base} ${arg.split('/').pop()}` : base).slice(0, 40);
}

/** CPU % and RSS of a process plus all its descendants. */
export function treeStats(procs, rootPid, idx = childrenIndex(procs)) {
  if (!procs.has(rootPid)) return null;
  let cpu = 0;
  let rssKb = 0;
  const kids = [];
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const p = procs.get(pid);
    if (!p) continue;
    cpu += p.cpu;
    rssKb += p.rssKb;
    if (pid !== rootPid) kids.push(p);
    for (const child of idx.get(pid) ?? []) stack.push(child);
  }
  kids.sort((a, b) => b.rssKb - a.rssKb);
  return { cpu: Math.round(cpu * 10) / 10, rssMb: Math.round(rssKb / 1024), childCount: kids.length, children: kids.slice(0, 5).map(k => label(k.command)) };
}

// The Bash tool runs each command as `zsh -c "source <its shell snapshot> … && eval '<command>' < /dev/null
// && pwd -P >| <file>"`, a child of the session in a process group of its own (so it can be stopped whole).
// On Windows it is Git's bash.exe: -c "source /c/Users/..../.claude/shell-snapshots/snapshot-..." (read from a live process list, 2026-10-10).
const BASH_TOOL = /^(?:\/bin\/(?:zsh|bash|sh)|"?[^"]*bash\.exe"?) -c .*\/shell-snapshots\/snapshot-/;
/** Whether a process is one of a session's shell commands: its Bash tool's, never its MCP servers or the session itself. */
export const isShellCommand = (p, sessionPid) => Boolean(p) && p.ppid === sessionPid && p.pgid === p.pid && BASH_TOOL.test(p.command);

/** The command as typed, from its shell's line: the eval'd text, unquoted, with ps's escapes read back (a newline shows as \012). */
export function typedCommand(line) {
  const text = line.replace(/\\([0-3][0-7]{2})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  const m = /\beval '([\s\S]*)'(?: < \/dev\/null)? && pwd -P >\| \S+$/.exec(text); // stdin from /dev/null, unless the command reads it already
  return m ? m[1].replaceAll(`'"'"'`, "'").replaceAll(`'\\''`, "'") : text.replace(/^\S+ -c /, '');
}

/** The shell commands a session runs now (its subagents' too): each command, when it started, and its CPU and memory with all it started. */
export function shellsOf(procs, sessionPid, now, idx = childrenIndex(procs)) {
  const out = [];
  for (const pid of idx.get(sessionPid) ?? []) {
    const p = procs.get(pid);
    if (!isShellCommand(p, sessionPid)) continue;
    const t = treeStats(procs, pid, idx);
    out.push({ pid, command: typedCommand(p.command), startedAt: now - (p.ageSec ?? 0) * 1000, cpu: t.cpu, rssMb: t.rssMb });
  }
  return out.sort((x, y) => x.startedAt - y.startedAt);
}

const isCodex = p => /(^|\/)codex(\s|$)/.test(p?.command ?? '');

export function findCodexRoots(procs) {
  return [...procs.values()].filter(p => isCodex(p) && !isCodex(procs.get(p.ppid)));
}

export function findPidByArg(procs, needle) {
  for (const p of procs.values()) if (p.command.includes(needle)) return p.pid;
  return undefined;
}

export async function readPs(runner = run) {
  const res = await runner('ps', ['-axo', 'pid=,ppid=,pgid=,etime=,%cpu=,rss=,command=']);
  if (res.code !== 0) throw new Error(`ps failed: ${res.stderr.trim().slice(0, 200)}`);
  return parsePs(res.stdout);
}
