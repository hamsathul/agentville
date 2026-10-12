import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { run } from '../lib/exec.mjs';

// The same job as `ps -axo pid,ppid,pgid,etime,%cpu,rss,command` on a Mac, from Win32_Process. Windows has no process
// groups, so pgid is the pid. rss is the working set. %CPU is the share of one core between two reads, from the cumulative
// user+kernel time (the perf-counter class that gives it directly took 23 s a call on this PC, 2026-10-10, so it is not used).
const LIST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Get-CimInstance Win32_Process | ForEach-Object {',
  '  [pscustomobject]@{',
  '    pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId',
  "    created = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null })",
  '    cpuSec = ([double]$_.UserModeTime + [double]$_.KernelModeTime) / 10000000; ws = [int64]$_.WorkingSetSize',
  "    cmd = $(if ($_.CommandLine) { $_.CommandLine -replace '[\r\n\t]', ' ' } else { $null })",
  '  }',
  '} | ConvertTo-Json -Compress',
].join('\n');

/** The rows PowerShell printed as a process map. `prev` is `.samples` of the earlier map; the map returned carries its own. */
export function parseWinProcs(stdout, now = Date.now(), prev = new Map()) {
  let rows;
  try {
    rows = JSON.parse(stdout);
  } catch {
    throw new Error('process list was not readable (PowerShell output was not JSON)');
  }
  if (!Array.isArray(rows)) rows = rows && typeof rows === 'object' ? [rows] : [];
  const procs = new Map();
  const samples = new Map();
  for (const r of rows) {
    if (!Number.isInteger(r?.pid)) continue;
    const born = r.created ? Date.parse(r.created) : NaN;
    const cpuSec = Number(r.cpuSec) || 0;
    const before = prev.get(r.pid);
    // Same pid is the same process only if it started at the same moment (pids are reused).
    const cpu = before && before.created === r.created && now > before.at ? Math.max(0, Math.round(((cpuSec - before.cpuSec) / ((now - before.at) / 1000)) * 1000) / 10) : 0;
    samples.set(r.pid, { created: r.created ?? null, cpuSec, at: now });
    procs.set(r.pid, {
      pid: r.pid, ppid: Number.isInteger(r.ppid) ? r.ppid : 0, pgid: r.pid,
      ageSec: Number.isFinite(born) ? Math.max(0, Math.round((now - born) / 1000)) : 0,
      cpu, rssKb: Math.round((Number(r.ws) || 0) / 1024), command: typeof r.cmd === 'string' ? r.cmd : '',
    });
  }
  procs.samples = samples;
  return procs;
}

/** Keeps the last read so each read can say how busy a process was since. The first read reports 0 %CPU, never a guess. */
export class WinProcReader {
  #prev = new Map();
  constructor(runner = run) { this.runner = runner; }
  async read() {
    const exe = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const res = await this.runner(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LIST_SCRIPT], { timeoutMs: 20_000 });
    if (res.code !== 0) throw new Error(`process list failed: ${res.stderr.trim().slice(0, 200)}`);
    const procs = parseWinProcs(res.stdout, Date.now(), this.#prev);
    this.#prev = procs.samples;
    return procs;
  }
}

const SYS32 = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
const reader = new WinProcReader();
// A pid the caller took from a process listing: a plain positive integer, and not one of the System / idle pids.
const checkPid = pid => { if (!Number.isInteger(pid) || pid <= 4) throw new Error(`refused: ${String(pid)} is not a process id this may stop`); };
const aliveNow = pid => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/** The Windows twin of the Mac session-process helpers: no ttys, and a "process group" is the whole process tree. */
export const winSessionProcs = {
  commandOf: async pid => (await reader.read()).get(pid)?.command ?? null,
  ttyOf: async () => null,
  // Windows has no polite SIGTERM for a console program: this ends the process at once.
  kill: (pid, sig) => { checkPid(pid); process.kill(pid, sig); },
  alive: pid => Number.isInteger(pid) && pid > 0 && aliveNow(pid),
  // Ends the tree from this pid down. The pid was found in the process listing as a session's shell command, never typed by a user.
  killGroup: pid => {
    checkPid(pid);
    const r = spawnSync(join(SYS32, 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true });
    if (r.status !== 0) throw Object.assign(new Error(`could not end the process tree: ${String(r.stderr).trim().slice(0, 120)}`), { code: r.status });
  },
  groupAlive: pid => Number.isInteger(pid) && pid > 4 && aliveNow(pid),
};
