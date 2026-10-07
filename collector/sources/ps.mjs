import { run } from '../lib/exec.mjs';

export function parsePs(stdout) {
  const procs = new Map();
  for (const line of stdout.split('\n')) {
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

const isCodex = p => /(^|\/)codex(\s|$)/.test(p?.command ?? '');

export function findCodexRoots(procs) {
  return [...procs.values()].filter(p => isCodex(p) && !isCodex(procs.get(p.ppid)));
}

export function findPidByArg(procs, needle) {
  for (const p of procs.values()) if (p.command.includes(needle)) return p.pid;
  return undefined;
}

export async function readPs(runner = run) {
  const res = await runner('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,command=']);
  if (res.code !== 0) throw new Error(`ps failed: ${res.stderr.trim().slice(0, 200)}`);
  return parsePs(res.stdout);
}
