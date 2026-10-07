import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TrackerSnapshot, TrackerView } from '../types'
import {
  DASHBOARD_URL, buildQuestionResult, dashboardWindowSec, decisionFrom, elapsed, groups, isFresh, newlyWaiting,
  permissionSummary, rowText, stateDirFor, stateFileFor, statusText,
} from './view'

const PANE = 'agent-tracker'
const EMPTY: TrackerView = { snapshot: null, readAt: 0 }
const view = atom({ plugin: 'agent-tracker', key: 'view' } as const, EMPTY)
const selected = atom({ plugin: 'agent-tracker', key: 'selected' } as const, null as string | null)

// Answering from the dashboard. The mod offers a waiting question or permission prompt by
// writing <state>/pending/<toolUseId>.json; the collector writes <state>/answers/<toolUseId>.json
// when the person answers on the dashboard. A shell loop waits for that file (a $ call, so it
// does not use up the hook's time budget) and gives up when the offer file is withdrawn.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
const PERSON_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
// Waits for the answer file ($1); stops when the offer ($2) is withdrawn; touches the offer every
// second as a heartbeat, so the dashboard only offers answering while this wait is alive.
const WAIT_SH = 'n=0; while [ "$n" -lt "$3" ]; do if [ -f "$1" ]; then cat "$1"; exit 0; fi; if [ ! -f "$2" ]; then exit 2; fi; if [ $((n % 4)) -eq 0 ]; then touch "$2"; fi; sleep 0.25; n=$((n+1)); done; exit 1'
const DASHBOARD_REASON = 'Answered from the Agent Tracker dashboard'

type Offer = { stateDir: string; sessionId: string; isLive: boolean; windowSec: number; now: number }
type Waited = { kind: 'answer'; text: string } | { kind: 'withdrawn' } | { kind: 'timeout' }

const MOD_VERSION = '0.2.0'

let latest: TrackerView = EMPTY
let selfId = ''
let previous: TrackerSnapshot | null = null
const toasted = new Set<string>()
let isPolling = false

/**
 * What a hook needs to offer something to the dashboard. Reads state.json itself when the poll's
 * copy is stale, so offering never depends on the poll having started (after a hot reload,
 * session.start may not run again).
 */
export async function offerContext($: any): Promise<Offer> {
  const now = await $.clock.now()
  const sessionId = selfId || (await $.session.id())
  if (!isFresh(latest, now)) {
    try {
      latest = { snapshot: JSON.parse(await $.fs.read(stateFileFor($.plugin.root))) as TrackerSnapshot, readAt: now }
    } catch (err) {
      latest = { snapshot: null, readAt: now, error: String(err) }
    }
  }
  return { stateDir: stateDirFor($.plugin.root), sessionId, isLive: Boolean(sessionId) && isFresh(latest, now), windowSec: dashboardWindowSec(latest, now), now }
}

/** Reads the collector's state for the pane, status line and toasts, and leaves a beacon saying this session's mod is listening. */
async function pollOnce($: any) {
  const now = await $.clock.now()
  let fresh: TrackerView
  try {
    const snapshot = JSON.parse(await $.fs.read(stateFileFor($.plugin.root))) as TrackerSnapshot
    fresh = { snapshot, readAt: now }
    if (snapshot.settings?.modToasts !== false) {
      for (const agent of newlyWaiting(previous, snapshot, selfId, toasted)) $.ui.toast(`${agent.name}: ${agent.stateReason}`)
    }
    previous = snapshot
    if (selfId) await $.fs.write(`${stateDirFor($.plugin.root)}/mods/${selfId}.json`, JSON.stringify({ sessionId: selfId, version: MOD_VERSION, at: now }))
  } catch (err) {
    fresh = { snapshot: null, readAt: now, error: String(err) }
  }
  latest = fresh
  await update($, view, () => fresh)
  $.ui.status(statusText(fresh, now))
}

/** Starts the 2-second poll once per module load, from whichever hook runs first. */
async function ensurePolling($: any) {
  if (isPolling) return
  isPolling = true
  try {
    selfId = selfId || (await $.session.id())
    await pollOnce($)
    $.clock.every(2000, () => pollOnce($))
  } catch (err) {
    isPolling = false
    logFailure($, `could not start polling the collector: ${String(err)}`)
  }
}

async function waitForAnswer($: any, answerPath: string, pendingPath: string, seconds: number): Promise<Waited> {
  const r = await $.process.run(['/bin/sh', '-c', WAIT_SH, 'sh', answerPath, pendingPath, String(Math.max(1, Math.round(seconds * 4)))], { timeoutMs: (seconds + 10) * 1000 })
  if (r.exitCode === 0) return { kind: 'answer', text: r.stdout }
  return r.exitCode === 2 ? { kind: 'withdrawn' } : { kind: 'timeout' }
}

async function removeFiles($: any, paths: string[]) {
  try {
    await $.process.run(['rm', '-f', ...paths])
  } catch (err) {
    logFailure($, `could not withdraw the dashboard offer: ${String(err)}`)
  }
}

function logFailure($: any, text: string) {
  try {
    $.ui.log(`agent-tracker: ${text}`)
  } catch {
    // nowhere to report it; the offer's heartbeat stops and the dashboard stops offering answers
  }
}

/** AskUserQuestion: the question stays in the terminal and is offered on the dashboard; the first answer wins. */
export async function answerFromDashboard($: any, e: any, next: any, offer: Offer) {
  const id = String(e.tool_use_id ?? '')
  if (!offer.isLive || !SAFE_ID.test(id)) return next(e)
  const pendingPath = `${offer.stateDir}/pending/${id}.json`
  const answerPath = `${offer.stateDir}/answers/${id}.json`
  await $.fs.write(pendingPath, JSON.stringify({ kind: 'question', toolUseId: id, sessionId: offer.sessionId, createdAt: offer.now, questions: e.questions }))
  const terminal = Promise.resolve(next(e)).then((r: unknown) => ({ from: 'terminal' as const, r }))
  // A failing dashboard wait must never take the question down with it: it is logged and the
  // terminal answers as usual.
  const dashboard = (async () => {
    try {
      for (;;) {
        const got = await waitForAnswer($, answerPath, pendingPath, 540)
        if (got.kind === 'withdrawn') break
        if (got.kind !== 'answer') continue
        const result = buildQuestionResult(e.questions, got.text)
        if (result) return { from: 'dashboard' as const, result }
        await removeFiles($, [answerPath])
      }
    } catch (err) {
      logFailure($, `waiting for a dashboard answer failed, answer in the terminal: ${String(err)}`)
    }
    return new Promise<never>(() => {})
  })()
  try {
    const winner = await Promise.race([terminal, dashboard])
    return winner.from === 'terminal' ? winner.r : { result: winner.result }
  } finally {
    await removeFiles($, [pendingPath, answerPath])
  }
}

/** A tool call that would prompt for permission is offered on the dashboard first, for a short window. */
export async function permitFromDashboard($: any, e: any, next: any, offer: Offer) {
  const verdict = await next(e)
  const id = String(e.tool_use_id ?? '')
  if (verdict?.decision !== 'ask' || !SAFE_ID.test(id) || PERSON_TOOLS.has(e.tool) || !offer.isLive || offer.windowSec <= 0) return verdict
  const pendingPath = `${offer.stateDir}/pending/${id}.json`
  const answerPath = `${offer.stateDir}/answers/${id}.json`
  await $.fs.write(pendingPath, JSON.stringify({
    kind: 'permission', toolUseId: id, sessionId: offer.sessionId, tool: e.tool,
    summary: permissionSummary(e.tool, e.input), createdAt: offer.now, expiresAt: offer.now + offer.windowSec * 1000,
  }))
  let got: Waited = { kind: 'timeout' }
  try {
    got = await waitForAnswer($, answerPath, pendingPath, offer.windowSec)
  } catch (err) {
    logFailure($, `waiting for a dashboard decision failed, the terminal will ask: ${String(err)}`)
  } finally {
    await removeFiles($, [pendingPath, answerPath])
  }
  const decision = got.kind === 'answer' ? decisionFrom(got.text) : null
  return decision ? { ...verdict, decision, reason: DASHBOARD_REASON } : verdict
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    selfId = await $.session.id()
    // /agents is a built-in command, so the pane opens with /tracker. A refused registration
    // must not stop the status line and toasts below from starting.
    try {
      await $.command.register({ name: 'tracker', description: 'Show every agent working on this Mac (Agent Tracker)' })
    } catch (err) {
      $.ui.log(`agent-tracker: /tracker not registered: ${String(err)}`)
    }

    await ensurePolling($)

    return next(e)
  })

  // After a hot reload session.start may not run again, so the next turn starts the poll.
  on('turn.start', async ($, e, next) => {
    await ensurePolling($)
    return next(e)
  })

  // If answering fails, the question falls back to the terminal dialog as usual.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => answerFromDashboard($, e, next, await offerContext($)))
    .catch(($, e, next) => {
      $.ui.log(`agent-tracker: answering from the dashboard stopped (${next.error?.kind}): ${next.error?.message ?? 'no message'}`)
      return next(e)
    })

  // A failing permission hook is skipped, leaving the normal terminal prompt.
  on('tool.check', async ($, e, next) => permitFromDashboard($, e, next, await offerContext($)))

  on('command.run', { command: 'tracker' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agents' })

    return { text: 'Agent Tracker pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, view)
    const chosen = await read($, selected)
    const now = await $.clock.now()
    const snapshot = current.snapshot

    if (!snapshot || !isFresh(current, now)) {
      return (
        <Box flexDirection="column">
          <Text color="warning">Agent Tracker: collector not running</Text>
          <Text dimColor>Start it with: agent-tracker start</Text>
        </Box>
      )
    }

    const agent = chosen ? snapshot.agents.find(a => a.id === chosen) : undefined
    if (agent) {
      const repos = [...new Set(agent.touching.map(t => t.repo ?? t.path))].slice(0, 4)
      return (
        <Box flexDirection="column">
          <Box>
            <Button key="back" label="Back" onPress={() => update($, selected, () => null)} />
            <Text bold> {agent.name}</Text>
            <Text dimColor> · {agent.state}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">{agent.cwd}</Text>
          {agent.now
            ? <Text color="success" wrap="truncate-end">▶ {agent.now.tool} {agent.now.summary} · {elapsed(agent.now.startedAt, now)}</Text>
            : <Text dimColor>{agent.stateReason}</Text>}
          {agent.lastPrompt ? <Text wrap="truncate-end">» {agent.lastPrompt}</Text> : null}
          <Text bold>Activity</Text>
          {agent.feed.slice(0, 10).map(item => (
            <Text dimColor={item.kind !== 'tool'} wrap="truncate-end">
              {item.kind === 'tool'
                ? `${item.ok === false ? '✗' : item.ok ? '✓' : '…'} ${item.tool ?? ''} ${item.text}`
                : `${item.kind === 'prompt' ? 'You' : 'Claude'}: ${item.text}`}
            </Text>
          ))}
          {agent.children.length > 0 ? <Text bold>Subagents & jobs</Text> : null}
          {agent.children.map(child => <Text wrap="truncate-end">↳ {child.kind} {child.label} · {child.state}</Text>)}
          {repos.length > 0 ? <Text dimColor wrap="truncate-end">Touching: {repos.join(', ')}</Text> : null}
          {agent.proc ? <Text dimColor>CPU {agent.proc.cpu}% · RAM {agent.proc.rssMb} MB</Text> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {snapshot.collisions.map(c => <Text color="warning" wrap="truncate-end">⚠ {c.repo.split('/').pop()}: {c.reason}</Text>)}
        {groups(snapshot).map(group => (
          <Box flexDirection="column">
            <Text bold>{group.title}</Text>
            {group.agents.map(a => (
              <Box>
                <Button key={`agent-${a.id}`} plain label={a.id === selfId ? `${a.name} (this session)` : a.name} onPress={() => update($, selected, () => a.id)} />
                <Text dimColor wrap="truncate-end"> {rowText(a, now)}</Text>
              </Box>
            ))}
          </Box>
        ))}
        {snapshot.counts.stale > 0 ? <Text dimColor>{snapshot.counts.stale} stale (see the dashboard)</Text> : null}
        <Button key="open-browser" label="Open in browser" onPress={() => void $.process.run(['open', DASHBOARD_URL])} />
      </Box>
    )
  })
}
