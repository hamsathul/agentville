import type { TrackerAgent, TrackerSnapshot, TrackerView } from '../types'

/** The collector's state folder sits beside the mod folder: <repo>/mod → <repo>/state. */
export function stateDirFor(pluginRoot: string): string {
  // On Windows the folder may come with backslashes; Windows takes forward slashes too, so one form is used. (On a Mac a
  // backslash can be part of a name, so it is left alone there.)
  const root = /^[A-Za-z]:|^\\\\/.test(pluginRoot) ? pluginRoot.replace(/\\/g, '/') : pluginRoot
  return `${root.replace(/\/+$/, '').replace(/\/[^/]+$/, '')}/state`
}

export function stateFileFor(pluginRoot: string): string {
  return `${stateDirFor(pluginRoot)}/state.json`
}

export const DASHBOARD_URL = 'http://localhost:7777'
export const STALE_AFTER_MS = 15_000

export function isFresh(view: TrackerView, now: number): boolean {
  return view.snapshot !== null && now - view.snapshot.generatedAt <= STALE_AFTER_MS
}

export function statusText(view: TrackerView, now: number): string | undefined {
  if (!view.snapshot || !isFresh(view, now)) return undefined
  const c = view.snapshot.counts
  const parts = [
    c.waiting ? `${c.waiting} waiting` : '',
    c.working ? `${c.working} working` : '',
    c.collisions ? `${c.collisions} collision${c.collisions === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.length ? `⚑ ${parts.join(' · ')}` : undefined
}

/**
 * Agents that started waiting since the previous read; none on the first read. `seen`
 * remembers every waiting episode already toasted, so one that flaps to working and back
 * (same stateSince) toasts once.
 */
export function newlyWaiting(prev: TrackerSnapshot | null, next: TrackerSnapshot, selfId: string, seen: Set<string> = new Set()): TrackerAgent[] {
  const key = (a: TrackerAgent) => `${a.id}:${a.stateSince}`
  for (const a of prev?.agents ?? []) if (a.state === 'waiting') seen.add(key(a))
  const waiting = next.agents.filter(a => a.state === 'waiting' && a.id !== selfId)
  const fresh = prev ? waiting.filter(a => !seen.has(key(a))) : []
  for (const a of waiting) seen.add(key(a))
  return fresh
}

export function groups(snapshot: TrackerSnapshot): { title: string; agents: TrackerAgent[] }[] {
  const of = (state: TrackerAgent['state']) => snapshot.agents.filter(a => a.state === state)
  return [
    { title: 'Waiting on you', agents: of('waiting') },
    { title: 'Working', agents: of('working') },
    { title: 'Your turn', agents: of('yourTurn') },
    { title: 'Idle', agents: of('idle') },
  ].filter(g => g.agents.length > 0)
}

export function elapsed(fromMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`
}

export function rowText(agent: TrackerAgent, now: number): string {
  if (agent.state === 'waiting') return `${agent.stateReason} · ${elapsed(agent.stateSince, now)}`
  if (agent.now) return `${agent.now.tool} ${agent.now.summary} · ${elapsed(agent.now.startedAt, now)}`
  if (agent.state === 'yourTurn') return agent.lastReply ?? 'finished'
  return agent.stateReason
}

type Question = { question: string }

const parse = (text: string): any => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The AskUserQuestion result for a dashboard answer, or null unless every question has one. */
export function buildQuestionResult<Q extends Question>(questions: Q[], text: string): { questions: Q[]; answers: Record<string, string> } | null {
  const answers = parse(text)?.answers
  if (!answers || typeof answers !== 'object') return null
  const out: Record<string, string> = {}
  for (const q of questions) {
    const value = answers[q.question]
    if (typeof value !== 'string' || !value.trim()) return null
    out[q.question] = value.trim()
  }
  return { questions, answers: out }
}

export function decisionFrom(text: string): 'allow' | 'deny' | 'always' | null {
  const decision = parse(text)?.decision
  return decision === 'allow' || decision === 'deny' || decision === 'always' ? decision : null
}

/** Which of Claude Code's `count` options the dashboard picked (an index), or null: cancelled, or no such option. */
export function optionFrom(text: string, count: number): number | null {
  const option = parse(text)?.option
  return Number.isInteger(option) && option >= 0 && option < count ? option : null
}

/** One line saying what a tool call would do, for the dashboard's Allow / Deny prompt. */
export function permissionSummary(_tool: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const pick = ['command', 'file_path', 'notebook_path', 'url', 'path', 'pattern', 'query'].map(k => i[k]).find(v => typeof v === 'string')
  return String(pick ?? JSON.stringify(i)).slice(0, 300)
}

// Modes whose decider never puts a call to the person: bypass allows it, don't-ask refuses it, auto's
// classifier judges it. A call Claude Code's check hands on ("ask") goes to that decider, so holding
// it for the dashboard would only slow it down (and show a prompt nobody has to answer).
const DECIDES_ALONE = new Set(['bypassPermissions', 'dontAsk', 'auto'])

/**
 * Seconds a permission prompt is offered to the dashboard: 0 when the collector isn't running, or
 * when the collector knows this session is in a mode that decides without you.
 */
export function dashboardWindowSec(view: TrackerView, now: number, sessionId = ''): number {
  if (!view.snapshot || !isFresh(view, now)) return 0
  const mode = view.snapshot.agents?.find(a => a.id === sessionId)?.mode
  if (mode && DECIDES_ALONE.has(mode)) return 0
  const sec = Number(view.snapshot.settings?.permissionDashboardSec ?? 15)
  return Number.isFinite(sec) ? Math.min(120, Math.max(0, sec)) : 0
}
