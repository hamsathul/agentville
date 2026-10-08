import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TrackerSnapshot, TrackerView } from '../types'
import {
  DASHBOARD_URL, buildQuestionResult, dashboardWindowSec, decisionFrom, elapsed, groups, isFresh, newlyWaiting, optionFrom,
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
const DASHBOARD_REASON = 'Answered from the Agentville dashboard'

type Offer = { stateDir: string; sessionId: string; isLive: boolean; windowSec: number; now: number }
type Waited = { kind: 'answer'; text: string } | { kind: 'withdrawn' } | { kind: 'timeout' }

const MOD_VERSION = '0.6.2'

let latest: TrackerView = EMPTY
// The terminal's working line (Slithering… while thinking), for the dashboard: when the turn began,
// the line's word and what the turn is doing; and the effort the model requests go out with.
let turnNow: { startedAt: number; word?: string; mode?: string } | null = null
let effortNow: string | null = null
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
  return { stateDir: stateDirFor($.plugin.root), sessionId, isLive: Boolean(sessionId) && isFresh(latest, now), windowSec: dashboardWindowSec(latest, now, sessionId), now }
}

/**
 * Chat messages sent from the dashboard wait in <state>/messages/<sessionId>/. Each is claimed by
 * renaming it (which tells the collector it was taken, and stops a later poll sending it again),
 * then submitted as the person's own words, oldest first. In a busy session the submit only
 * returns once the queued prompt is taken, so every message is claimed before any is submitted.
 * If the collector already withdrew a message, the rename fails and it is not sent.
 */
export async function deliverMessages($: any, stateDir: string, sessionId: string) {
  const texts = (await claimRequests($, `${stateDir}/messages/${sessionId}`))
    .map(v => (typeof v?.text === 'string' ? v.text.trim() : ''))
    .filter(Boolean)
  for (const text of texts) {
    try {
      await $.prompt.submit({ text, asUser: true })
    } catch (err) {
      logFailure($, `a message from the dashboard could not be sent (${String(err)}): ${text.slice(0, 200)}`)
    }
  }
}

/**
 * The requests waiting in an inbox, oldest first: each claimed by renaming it (which tells the
 * collector it was taken), read, then removed. A request already withdrawn is skipped.
 */
export async function claimRequests($: any, inbox: string): Promise<any[]> {
  let entries: { name: string }[]
  try {
    entries = await $.fs.list(inbox)
  } catch {
    return []
  }
  const out: any[] = []
  for (const name of entries.map(e => e.name).filter(n => n.endsWith('.json')).sort()) {
    const claimed = `${inbox}/${name}.claimed`
    const moved = await $.process.run(['mv', `${inbox}/${name}`, claimed])
    if (moved.exitCode !== 0) continue
    try {
      out.push(JSON.parse(await $.fs.read(claimed)))
    } catch {
      // unreadable: dropped
    }
    await removeFiles($, [claimed])
  }
  return out
}

// Model and effort switches, compacting and plugin reloads from the dashboard run as the person's
// own /model, /effort, /compact and /reload-plugins, the arguments checked again here: an alias
// (opus, sonnet, opus[1m]…), an effort level, what the summary should keep (one line), or nothing.
const SETTINGS: Record<string, RegExp> = { model: /^(?:default|opus|sonnet|haiku|fable)(?:\[1m\])?$/, effort: /^(?:low|medium|high|xhigh|max)$/, compact: /^[^\n\r]{0,500}$/, 'reload-plugins': /^$/ }

/**
 * Runs the switches the dashboard asked for. A slash command waits for the session to be idle, so
 * each runs on its own, never holding up the poll; what Claude Code said comes back to the collector.
 */
export async function runSettings($: any, stateDir: string, sessionId: string) {
  for (const req of await claimRequests($, `${stateDir}/commands/${sessionId}`)) {
    const command = String(req?.command ?? ''), args = String(req?.args ?? ''), id = String(req?.id ?? '')
    if (!SETTINGS[command]?.test(args) || !SAFE_ID.test(id)) continue
    void (async () => {
      let result: { ok: boolean; text: string }
      try {
        const r = await $.command.run({ command, args })
        result = { ok: true, text: String(r?.text ?? '') }
      } catch (err) {
        result = { ok: false, text: String(err) }
      }
      await writeReply($, `${stateDir}/command-results/${sessionId}.${id}.json`, { id, sessionId, command, args, ...result, at: await $.clock.now() })
    })()
  }
}

// A side question asked on the dashboard is /btw's: one answer from the conversation so far, no
// tools, nothing added to the conversation, and it may be asked while the session works.
const ASIDE_NOTE = 'This is a side question from the person, asked from the Agentville dashboard (like /btw) while you work. Answer it directly in a single reply, from what this conversation already shows. You cannot use tools here: if answering would need reading files, running commands or searching, say so and suggest asking in the main conversation.\n\nThe question: '

/** Answers the side questions waiting, each on its own (a model call takes a while): over this session's own transcript. */
export async function answerAsides($: any, stateDir: string, sessionId: string) {
  for (const req of await claimRequests($, `${stateDir}/btw/${sessionId}`)) {
    const id = String(req?.id ?? ''), question = typeof req?.question === 'string' ? req.question.trim().slice(0, 2000) : ''
    if (!SAFE_ID.test(id) || !question) continue
    void (async () => {
      let answer: { text?: string; reason?: string }
      try {
        const r = await $.model.fork({ prompt: ASIDE_NOTE + question })
        answer = r?.isAnswered ? { text: String(r.text ?? '') } : { reason: String(r?.reason ?? 'no answer') }
      } catch (err) {
        answer = { reason: String(err) }
      }
      await writeReply($, `${stateDir}/asides/${sessionId}.${id}.json`, { id, sessionId, question, ...answer, at: Number(req.at) || 0, answeredAt: await $.clock.now() })
    })()
  }
}

async function writeReply($: any, path: string, value: unknown) {
  try {
    await $.fs.write(path, JSON.stringify(value))
  } catch (err) {
    logFailure($, `could not tell the dashboard (${String(err)})`)
  }
}

/**
 * This session's usage as the status line has it ($.session.usage(), free without a breakdown):
 * its cost so far, its context fill, and the plan's rate-limit windows from the last API response.
 * The dashboard shows the cost per session and the windows as the plan's usage.
 */
export async function usageNow($: any) {
  try {
    const u = await $.session.usage()
    return {
      costUsd: u.cost?.usd,
      contextPercent: u.context?.percent,
      rateLimits: (u.rateLimits ?? []).map((w: any) => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt })),
    }
  } catch {
    return undefined
  }
}

/** A turn began (at), or ended (null): the working line starts afresh. */
export function startTurn(at: number | null) {
  turnNow = at === null ? null : { startedAt: at }
}
/** The turn as the beacon tells it. */
export const turnForBeacon = () => turnNow

/** What the working line shows now (its word, and thinking, responding or a tool), kept for the beacon. */
export function noteSpinner(props: any) {
  if (!turnNow || !props) return
  if (typeof props.word === 'string') turnNow.word = props.word.slice(0, 40)
  if (typeof props.mode === 'string') turnNow.mode = props.mode
}

/** Reads the collector's state for the pane, status line and toasts, and leaves a beacon saying this session's mod is listening (with its usage). */
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
    if (selfId) {
      await $.fs.write(`${stateDirFor($.plugin.root)}/mods/${selfId}.json`, JSON.stringify({ sessionId: selfId, version: MOD_VERSION, at: now, usage: await usageNow($), turn: turnNow, effort: effortNow }))
      await deliverMessages($, stateDirFor($.plugin.root), selfId)
      await runSettings($, stateDirFor($.plugin.root), selfId)
      await answerAsides($, stateDirFor($.plugin.root), selfId)
    }
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
  if (decision === 'always') { // on to Claude Code's permission step, which brings its own "Yes, and…" options
    alwaysFor = { key: callKey(e.tool, e.input), toolUseId: id, at: offer.now }
    return verdict
  }
  return decision ? { ...verdict, decision, reason: DASHBOARD_REASON } : verdict
}

// "Always allow…" picked on the dashboard: the call goes on to Claude Code's permission step (the
// PermissionRequest event), which carries its own options: the terminal's "Yes, and…" ones, such as
// a rule to keep or a folder to allow. They are offered on the dashboard for the 8 s that step allows
// (a hook there gets 10), and the one picked is applied as Claude Code would; else the terminal asks.
let alwaysFor: { key: string; toolUseId: string; at: number } | null = null
const callKey = (tool: unknown, input: unknown) => JSON.stringify([String(tool ?? ''), input ?? null])
const ALWAYS_SEC = 8

export async function chooseAlways($: any, e: any, next: any, offer: Offer) {
  const want = alwaysFor
  if (!want || want.key !== callKey(e.tool_name, e.tool_input) || offer.now - want.at > 60_000) return next(e)
  alwaysFor = null
  const options: unknown[] = Array.isArray(e.permission_suggestions) ? e.permission_suggestions : []
  if (!options.length) return { decision: { behavior: 'allow' } } // nothing to keep: allowed this once
  if (!offer.isLive) return next(e)
  const pendingPath = `${offer.stateDir}/pending/${want.toolUseId}.json`
  const answerPath = `${offer.stateDir}/answers/${want.toolUseId}.json`
  await $.fs.write(pendingPath, JSON.stringify({
    kind: 'always', toolUseId: want.toolUseId, sessionId: offer.sessionId, tool: e.tool_name, summary: permissionSummary(e.tool_name, e.tool_input),
    suggestions: options, createdAt: offer.now, expiresAt: offer.now + ALWAYS_SEC * 1000,
  }))
  let got: Waited = { kind: 'timeout' }
  try {
    got = await waitForAnswer($, answerPath, pendingPath, ALWAYS_SEC)
  } catch (err) {
    logFailure($, `waiting for a dashboard choice failed, the terminal will ask: ${String(err)}`)
  } finally {
    await removeFiles($, [pendingPath, answerPath])
  }
  const pick = got.kind === 'answer' ? optionFrom(got.text, options.length) : null
  return pick === null ? next(e) : { decision: { behavior: 'allow', updatedPermissions: [options[pick]] } }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    selfId = await $.session.id()
    // /agents is a built-in command, so the pane opens with /tracker. A refused registration
    // must not stop the status line and toasts below from starting.
    try {
      await $.command.register({ name: 'tracker', description: 'Show every agent working on this Mac (Agentville)' })
    } catch (err) {
      $.ui.log(`agent-tracker: /tracker not registered: ${String(err)}`)
    }

    await ensurePolling($)

    return next(e)
  })

  // After a hot reload session.start may not run again, so the next turn starts the poll.
  on('turn.start', async ($, e, next) => {
    startTurn(await $.clock.now())
    await ensurePolling($)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    startTurn(null)
    return next(e)
  })

  // Watched, never changed: the working line's word and mode, and the main loop's effort.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    noteSpinner(e.props)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) effortNow = String(e.effort)
    return yield* next(e) // the request goes out as it was, streamed through
  })

  // If answering fails, the question falls back to the terminal dialog as usual.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => answerFromDashboard($, e, next, await offerContext($)))
    .catch(($, e, next) => {
      $.ui.log(`agent-tracker: answering from the dashboard stopped (${next.error?.kind}): ${next.error?.message ?? 'no message'}`)
      return next(e)
    })

  // A failing permission hook is skipped, leaving the normal terminal prompt.
  on('tool.check', async ($, e, next) => permitFromDashboard($, e, next, await offerContext($)))
  on('classic.PermissionRequest', async ($, e, next) => chooseAlways($, e, next, await offerContext($)))
    .catch(($, e, next) => next(e)) // if choosing fails, the terminal asks as usual

  on('command.run', { command: 'tracker' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agents' })

    return { text: 'Agentville pane opened.' }
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
          <Text color="warning">Agentville: collector not running</Text>
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
