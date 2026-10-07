import { expect, test } from 'claude-code/testing'

import type { TrackerAgent, TrackerSnapshot } from '../types'
import { elapsed, groups, isFresh, newlyWaiting, rowText, stateFileFor, statusText } from '../hooks/view'

const agent = (over: Partial<TrackerAgent>): TrackerAgent => ({
  id: 'a', kind: 'interactive', name: 'a', cwd: '/w', state: 'working', stateReason: 'busy', stateSince: 0,
  feed: [], children: [], touching: [], ...over,
})

const snapshot = (agents: TrackerAgent[], collisions = 0): TrackerSnapshot => ({
  generatedAt: 100_000,
  settings: { modToasts: true },
  counts: {
    waiting: agents.filter(a => a.state === 'waiting').length,
    working: agents.filter(a => a.state === 'working').length,
    yourTurn: agents.filter(a => a.state === 'yourTurn').length,
    stale: agents.filter(a => a.state === 'stale').length,
    idle: agents.filter(a => a.state === 'idle').length,
    collisions,
  },
  agents,
  collisions: [],
})

test('the status line names waiting, working and collisions, and is empty when nothing is going on', () => {
  const s = snapshot([agent({ state: 'waiting' }), agent({ id: 'b' }), agent({ id: 'c' })], 1)
  expect(statusText({ snapshot: s, readAt: 0 }, 101_000)).toBe('⚑ 1 waiting · 2 working · 1 collision')
  expect(statusText({ snapshot: snapshot([agent({ state: 'idle' })]), readAt: 0 }, 101_000)).toBe(undefined)
})

test('a snapshot older than 15 s is not fresh and clears the status line', () => {
  const s = snapshot([agent({})])
  expect(isFresh({ snapshot: s, readAt: 0 }, 115_000)).toBe(true)
  expect(isFresh({ snapshot: s, readAt: 0 }, 115_001)).toBe(false)
  expect(statusText({ snapshot: s, readAt: 0 }, 200_000)).toBe(undefined)
})

test('only agents that newly start waiting toast, never this session and never on the first read', () => {
  const before = snapshot([agent({ id: 'x', state: 'working' })])
  const after = snapshot([agent({ id: 'x', state: 'waiting', stateSince: 5 }), agent({ id: 'self', state: 'waiting', stateSince: 6 })])
  expect(newlyWaiting(null, after, 'self')).toEqual([])
  expect(newlyWaiting(before, after, 'self').map(a => a.id)).toEqual(['x'])
  expect(newlyWaiting(after, after, 'self')).toEqual([])
})

test('groups come in triage order and leave out empty and stale groups', () => {
  const s = snapshot([agent({ id: 'i', state: 'idle' }), agent({ id: 'w', state: 'waiting' }), agent({ id: 's', state: 'stale' })])
  expect(groups(s).map(g => g.title)).toEqual(['Waiting on you', 'Idle'])
})

test('row text shows the running tool with a timer, or the waiting reason', () => {
  expect(rowText(agent({ now: { tool: 'Bash', summary: 'Run tests', startedAt: 0 } }), 65_000)).toBe('Bash Run tests · 1:05')
  expect(rowText(agent({ state: 'waiting', stateReason: 'question pending', stateSince: 0 }), 5_000)).toBe('question pending · 0:05')
  expect(elapsed(0, 3_725_000)).toBe('1h02m')
})

test('a waiting agent that flaps to working and back with the same start time toasts only once', () => {
  const seen = new Set<string>()
  const working = snapshot([agent({ id: 'x', state: 'working' })])
  const waiting = snapshot([agent({ id: 'x', state: 'waiting', stateSince: 5 })])
  newlyWaiting(null, working, 'self', seen)
  expect(newlyWaiting(working, waiting, 'self', seen).map(a => a.id)).toEqual(['x'])
  expect(newlyWaiting(waiting, working, 'self', seen)).toEqual([])
  expect(newlyWaiting(working, waiting, 'self', seen)).toEqual([])
  const later = snapshot([agent({ id: 'x', state: 'waiting', stateSince: 99 })])
  expect(newlyWaiting(working, later, 'self', seen).map(a => a.id)).toEqual(['x'])
})

test('the state file is found next to the mod folder, wherever the repo is cloned', () => {
  expect(stateFileFor('/home/me/agent-tracker/mod')).toBe('/home/me/agent-tracker/state/state.json')
  expect(stateFileFor('/home/me/agent-tracker/mod/')).toBe('/home/me/agent-tracker/state/state.json')
})
