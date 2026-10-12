// What differs between macOS and Windows for the mod: the few programs it asks the system to run, and how it waits.
// Pure functions: they return the argument list to run (or null when it must not be run) and take no `$`, so they test
// without the engine. The mod never builds a shell line: every program is started with an argument list.

/** A Windows path: a drive letter (C:\x, C:/x, d:foo) or a UNC share (\\server\share). */
export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith(String.fromCharCode(92, 92))
}

// Anything cmd.exe reads as syntax in an argument (it is the one Windows program the mod hands paths to), or a control character.
const CMD_SYNTAX = /[&|<>^%!"\u0000-\u001f]/

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

export type Waited = { kind: 'answer'; text: string } | { kind: 'withdrawn' } | { kind: 'timeout' }

/**
 * Waits for the answer file; ends if the offer file is withdrawn; touches the offer every fourth tick (one tick is 250 ms) as a
 * heartbeat, so the dashboard only offers answering while this wait is alive. It replaces a /bin/sh loop, so it runs anywhere.
 */
export async function pollForAnswer(o: {
  answerPath: string
  pendingPath: string
  maxTicks: number
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  touch: (path: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
}): Promise<Waited> {
  for (let n = 0; n < o.maxTicks; n++) {
    if (await o.exists(o.answerPath)) return { kind: 'answer', text: await o.read(o.answerPath) }
    if (!(await o.exists(o.pendingPath))) return { kind: 'withdrawn' }
    if (n % 4 === 0) await o.touch(o.pendingPath)
    await o.sleep(250)
  }
  return { kind: 'timeout' }
}
