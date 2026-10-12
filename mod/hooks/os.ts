// What differs between macOS and Windows for the mod: the few programs it asks the system to run, and how it waits.
// Pure functions: they return the argument list to run (or null when it must not be run) and take no `$`, so they test
// without the engine. The mod never builds a shell line: every program is started with an argument list.

/** A Windows path: a drive letter (C:\x, C:/x, d:foo) or a UNC share (\\server\share). */
export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith(String.fromCharCode(92, 92))
}

// Anything cmd.exe reads as syntax in an argument (it is the one Windows program the mod hands paths to), or a control character.
// A comma, semicolon or equals sign separates arguments for move and del as a space does.
const CMD_SYNTAX = /[&|<>^%!",;=\u0000-\u001f]/

const safeForCmd = (...args: string[]) => args.every(a => typeof a === 'string' && a.length > 0 && !CMD_SYNTAX.test(a))

/** Moving a request file to its claimed name. Null if the Windows paths hold anything cmd would read as syntax. */
export function claimArgv(win: boolean, from: string, to: string): string[] | null {
  if (!win) return ['mv', from, to]
  return safeForCmd(from, to) ? ['cmd.exe', '/d', '/c', 'move', '/Y', from, to] : null
}

/** Deleting files that may or may not exist. Null if there is nothing to delete or a Windows path is not safe for cmd. */
export function removeArgv(win: boolean, paths: string[]): string[] | null {
  if (paths.length === 0) return null
  if (!win) return ['rm', '-f', ...paths]
  return safeForCmd(...paths) ? ['cmd.exe', '/d', '/c', 'del', '/f', '/q', ...paths] : null
}

// Only this machine's dashboard: http, localhost or 127.0.0.1, a port, and a plain path.
const DASHBOARD = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}(?:\/[A-Za-z0-9_./-]*)?$/

/** Opening the dashboard in the browser. Null for anything that is not this machine's http address. */
export function openArgv(win: boolean, url: string): string[] | null {
  if (typeof url !== 'string' || !DASHBOARD.test(url)) return null
  return win ? ['cmd.exe', '/d', '/c', 'start', '', url] : ['open', url]
}

// The dashboard wait runs as a program of its own, never as a loop of $.clock.sleep in the hook: a $ call's time does not count
// against the hook's 10-second budget, a sleep does, and a permission window is 15 s by default (up to 120). It waits for the
// answer file, ends if the offer file is withdrawn, and touches the offer every fourth tick (one tick is 250 ms) as a heartbeat,
// so the dashboard only offers answering while the wait is alive. Exit 0: the answer is there; 2: withdrawn; else nothing came.
const WAIT_SH = 'n=0; while [ "$n" -lt "$3" ]; do if [ -f "$1" ]; then cat "$1"; exit 0; fi; if [ ! -f "$2" ]; then exit 2; fi; if [ $((n % 4)) -eq 0 ]; then touch "$2"; fi; sleep 0.25; n=$((n+1)); done; exit 1'
// The same in Windows PowerShell, the paths and the count in the environment, never in the script text. It prints nothing:
// the answer is read with $.fs, so its text is not passed through the console's code page. Both scripts stay one line each:
// collector/test/mod-wait.test.mjs runs them for real (the mod's own tests cannot start a program).
const WAIT_PS = '$a=$env:AGENTVILLE_ANSWER; $p=$env:AGENTVILLE_PENDING; $n=[int]$env:AGENTVILLE_TICKS; for ($i = 0; $i -lt $n; $i++) { if ([IO.File]::Exists($a)) { exit 0 }; if (-not [IO.File]::Exists($p)) { exit 2 }; if ($i % 4 -eq 0) { try { [IO.File]::SetLastWriteTime($p, [DateTime]::Now) } catch {} }; Start-Sleep -Milliseconds 250 }; exit 1'

/** The program that waits for a dashboard answer: the shell loop on a Mac, PowerShell on Windows with its inputs in `env`. */
export function waitArgv(win: boolean, answerPath: string, pendingPath: string, ticks: number): { argv: string[]; env?: Record<string, string> } {
  if (!win) return { argv: ['/bin/sh', '-c', WAIT_SH, 'sh', answerPath, pendingPath, String(ticks)] }
  return {
    argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WAIT_PS],
    env: { AGENTVILLE_ANSWER: answerPath, AGENTVILLE_PENDING: pendingPath, AGENTVILLE_TICKS: String(ticks) },
  }
}
