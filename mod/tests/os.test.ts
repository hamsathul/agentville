import { expect, test } from 'claude-code/testing'

import { claimArgv, isWindowsPath, openArgv, pollForAnswer, removeArgv } from '../hooks/os'
import { stateDirFor, stateFileFor } from '../hooks/view'

const B = String.fromCharCode(92)

test('a Windows path is told from a POSIX one by its shape', () => {
  for (const p of [`C:${B}Users${B}me${B}mod`, 'C:/Users/me/mod', `${B}${B}server${B}share${B}mod`, 'd:foo']) expect(isWindowsPath(p)).toBe(true)
  for (const p of ['/Users/me/mod', '/mnt/c/x', 'relative/mod', '']) expect(isWindowsPath(p)).toBe(false)
})

test('the state folder is next to the mod folder with either separator', () => {
  expect(stateDirFor('/Users/me/agentville/mod')).toBe('/Users/me/agentville/state')
  expect(stateDirFor(`C:${B}Users${B}me${B}agentville${B}mod`)).toBe('C:/Users/me/agentville/state')
  expect(stateDirFor('C:/Users/me/agentville/mod/')).toBe('C:/Users/me/agentville/state')
  expect(stateFileFor(`C:${B}x${B}mod`)).toBe('C:/x/state/state.json')
})

test('claiming a request file: mv on a Mac, cmd move on Windows, and a path cmd would read as syntax is refused', () => {
  expect(claimArgv(false, '/s/inbox/a.json', '/s/inbox/a.json.claimed')).toEqual(['mv', '/s/inbox/a.json', '/s/inbox/a.json.claimed'])
  expect(claimArgv(true, 'C:/s/inbox/a.json', 'C:/s/inbox/a.json.claimed')).toEqual(['cmd.exe', '/d', '/c', 'move', '/Y', 'C:/s/inbox/a.json', 'C:/s/inbox/a.json.claimed'])
  for (const bad of ['C:/s/a&calc.json', 'C:/s/a|b.json', 'C:/s/%PATH%.json', 'C:/s/a^b.json', 'C:/s/a"b.json', 'C:/s/a>b.json', 'C:/s/a!b.json', 'C:/s/a\nb.json']) {
    expect(claimArgv(true, bad, 'C:/s/ok')).toBeNull()
  }
})

test('removing files: rm -f on a Mac, cmd del on Windows, refused for paths cmd would read as syntax', () => {
  expect(removeArgv(false, ['/s/a', '/s/b'])).toEqual(['rm', '-f', '/s/a', '/s/b'])
  expect(removeArgv(true, ['C:/s/a', 'C:/s/b'])).toEqual(['cmd.exe', '/d', '/c', 'del', '/f', '/q', 'C:/s/a', 'C:/s/b'])
  expect(removeArgv(true, ['C:/s/a', 'C:/s/b&calc'])).toBeNull()
  expect(removeArgv(true, [])).toBeNull()
})

test('opening the dashboard: open on a Mac, cmd start on Windows, and only an http address on this machine', () => {
  expect(openArgv(false, 'http://localhost:7777')).toEqual(['open', 'http://localhost:7777'])
  expect(openArgv(true, 'http://localhost:7777')).toEqual(['cmd.exe', '/d', '/c', 'start', '', 'http://localhost:7777'])
  for (const bad of ['http://evil.example/', 'file:///C:/Windows/System32/calc.exe', 'http://localhost:7777/&calc', 'javascript:alert(1)', 'http://localhost:7777 calc.exe', '']) {
    expect(openArgv(true, bad)).toBeNull()
    expect(openArgv(false, bad)).toBeNull()
  }
})

function fakeFiles(script: (tick: number) => { answer?: string; pending: boolean }) {
  let tick = 0
  const touched: number[] = []
  return {
    touched,
    deps: {
      exists: async (p: string) => (p === 'answer' ? script(tick).answer !== undefined : script(tick).pending),
      read: async () => script(tick).answer ?? '',
      touch: async () => { touched.push(tick) },
      sleep: async () => { tick++ },
    },
  }
}

test('waiting for an answer: the answer file wins, and its text is returned', async () => {
  const f = fakeFiles(t => (t >= 3 ? { answer: 'yes', pending: true } : { pending: true }))
  expect(await pollForAnswer({ ...f.deps, answerPath: 'answer', pendingPath: 'pending', maxTicks: 100 })).toEqual({ kind: 'answer', text: 'yes' })
})

test('waiting for an answer: if the offer is withdrawn the wait ends at once, and no answer means a timeout', async () => {
  const w = fakeFiles(t => ({ pending: t < 2 }))
  expect(await pollForAnswer({ ...w.deps, answerPath: 'answer', pendingPath: 'pending', maxTicks: 100 })).toEqual({ kind: 'withdrawn' })
  const n = fakeFiles(() => ({ pending: true }))
  expect(await pollForAnswer({ ...n.deps, answerPath: 'answer', pendingPath: 'pending', maxTicks: 10 })).toEqual({ kind: 'timeout' })
})

test('waiting for an answer: the offer is touched every fourth tick as a heartbeat, from the first', async () => {
  const n = fakeFiles(() => ({ pending: true }))
  await pollForAnswer({ ...n.deps, answerPath: 'answer', pendingPath: 'pending', maxTicks: 9 })
  expect(n.touched).toEqual([0, 4, 8])
})
