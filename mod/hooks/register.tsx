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

const MOD_VERSION = '0.9.0'

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

// Model and effort switches, compacting, plugin reloads and renames from the dashboard run as the
// person's own /model, /effort, /compact, /reload-plugins and /rename, the arguments checked again
// here: an alias (opus, sonnet, opus[1m]…), an effort level, what the summary should keep (one
// line), nothing, or a name (letters, digits, spaces, . _ -; 1 to 60).
// A stop is Esc's: it cancels the running turn.
const SETTINGS: Record<string, RegExp> = { model: /^(?:default|opus|sonnet|haiku|fable)(?:\[1m\])?$/, effort: /^(?:low|medium|high|xhigh|max)$/, compact: /^[^\n\r]{0,500}$/, 'reload-plugins': /^$/, stop: /^$/, rename: /^[\p{L}\p{N} ._-]{1,60}$/u }

// The main turn running now, which a stop cancels: its id comes with turn.start, and its own
// turn.complete ends it (a subagent's run completes under another id).
let runningTurn: string | null = null
export const turnStarted = (turnId: string) => { runningTurn = turnId }
export const turnEnded = (turnId: string) => { if (runningTurn === turnId) runningTurn = null }

// What Esc leaves in the conversation. The abort writes nothing, so the mod adds it: the model reads
// that it was cut off, and the dashboard sees the turn end.
const INTERRUPTED = '[Request interrupted by user]'

// Turns stopped from the dashboard (the last few: a stopped turn completes before its shell call
// returns). The abort moves a command running in them to the background (backgroundedByTurnAbort),
// where Esc would end it: so it is stopped there.
const stoppedTurns = new Set<string>()
function noteStopped(turnId: string) {
  stoppedTurns.add(turnId)
  for (const old of stoppedTurns) if (stoppedTurns.size > 8) stoppedTurns.delete(old)
}

/**
 * A Bash call's hook: when a stop from here sent the command to the background, it is ended
 * (TaskStop) once the turn is over, since a tool called inside the aborted turn is refused.
 */
export async function endStoppedCommand($: any, e: any, next: any) {
  const turn = runningTurn
  const r = await next(e)
  const out = r?.result
  if (turn && stoppedTurns.has(turn) && out?.backgroundedByTurnAbort === true && typeof out.backgroundTaskId === 'string') {
    const taskId = out.backgroundTaskId
    $.clock.after(250, async () => {
      try {
        const done = await $.tool.call({ tool: 'TaskStop', task_id: taskId })
        if (done?.deny) logFailure($, `a stopped command was not ended (${done.deny}); stop it under Commands running`)
      } catch (err) {
        logFailure($, `a stopped command could not be ended (${String(err)}); stop it under Commands running`)
      }
    })
  }
  return r
}

/** Stop from the dashboard: the running turn is cancelled as Esc cancels it, its tools stopped. */
async function stopTurn($: any) {
  if (!runningTurn) return { text: 'It had already finished.' }
  noteStopped(runningTurn)
  await $.turn.abort({ turnId: runningTurn })
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: INTERRUPTED }] } })
  return { text: 'Stopped.' }
}

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
        const r = command === 'stop' ? await stopTurn($) : await $.command.run({ command, args })
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

// The helper: small writing jobs for the dashboard with Haiku (names and animal lines), through $.model.complete in this
// session (your sign-in, your plan; nothing added to the conversation). A request names only its
// kind: the prompt for each kind is fixed here, so a file in state/ can't make the model do
// anything else. The collector only asks while the helper is on; a request found after it was
// switched off is dropped.
export const NAME_SYSTEM = 'You name coding sessions. From the start of a session below, reply with one short kebab-case name of 2 to 4 words for what it is working on (for example login-bug or worlds-kit), and nothing else.'

/** The start of this session, for naming it: your first three messages and Claude's first reply's first 1,000 characters, 2,000 at most. */
export function namePrompt(messages: any[]): string {
  const said = (m: any) => (typeof m?.text === 'string' ? m.text.trim() : '')
  const list = Array.isArray(messages) ? messages : []
  const yours = list.filter(m => m?.role === 'user').map(said).filter(Boolean).slice(0, 3)
  const reply = said(list.find(m => m?.role === 'assistant')).slice(0, 1000)
  return [...yours.map(t => `The person: ${t}`), ...(reply ? [`Claude: ${reply}`] : [])].join('\n\n').slice(0, 2000)
}

// Animal lines: the collector sends facts only (the animals on screen, agents' names, states, a step word, counts,
// events); this prompt is fixed here, so a request can't make the model do anything else.
export const LINES_SYSTEM = 'You write short, funny, kind lines for animals on a pixel farm where coding agents work as farmers. Reply only with rows of the form kind|when|text: kind is one of the animals given, when is one of idle, deployFailed, deployOk, harvest, merged, arrive, and text is what that animal says, 40 characters or fewer, plain words, no quotes. Write two idle rows for every animal, and rows for an event only if it is in what just happened. At most 40 rows. Use only the names given and never invent names. Never mention files, code or secrets.'
const LINE_KINDS = ['cow', 'goat', 'sheepdog', 'ostrich', 'lion', 'tiger', 'duck', 'cat', 'dog', 'pigeon', 'mouse', 'fish']
const LINE_EVENTS = ['deployFailed', 'deployOk', 'harvest', 'merged', 'arrive']

/** The facts of a lines request, as plain lines for the model; null when it names no animal from the library. */
export function linesPrompt(req: any): string | null {
  const s = (v: any, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, n)
  const num = (v: any) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
  const list = (v: any, n: number) => (Array.isArray(v) ? v.slice(0, n) : [])
  const cast = list(req?.cast, 12).filter((c: any) => LINE_KINDS.includes(c?.kind))
  if (!cast.length) return null
  const agents = list(req?.agents, 12).filter((a: any) => a && typeof a === 'object')
  const events = list(req?.events, 5).filter((e: any) => LINE_EVENTS.includes(e?.kind))
  const c = req?.counts ?? {}
  return [
    `Animals: ${cast.map((x: any) => `${x.kind} (${s(x.name, 30)})`).join(', ')}`,
    `Farmers: ${agents.length ? agents.map((a: any) => `${s(a.name, 40)} is ${s(a.state, 10)}${a.step ? `, ${s(a.step, 12)}` : ''}${a.repo ? ` in ${s(a.repo, 40)}` : ''}`).join('; ') : 'none'}`,
    `Waiting on the person: ${num(c.waiting)}; working: ${num(c.working)}; idle: ${num(c.idle)}`,
    `What just happened: ${events.length ? events.map((e: any) => `${e.kind}${e.agent ? ` (${s(e.agent, 40)})` : ''}${e.repo ? ` in ${s(e.repo, 40)}` : ''}, ${num(e.ago)} min ago`).join('; ') : 'nothing'}`,
  ].join('\n')
}

const USE_OF: Record<string, string> = { name: 'names', lines: 'lines' }

/** Runs the helper's requests for this session (names, animal lines), each on its own. */
export async function runHelper($: any, stateDir: string, sessionId: string, snapshot: any) {
  for (const req of await claimRequests($, `${stateDir}/helper/${sessionId}`)) {
    const id = String(req?.id ?? '')
    const kind = typeof req?.kind === 'string' && Object.hasOwn(USE_OF, req.kind) ? req.kind : null
    if (!SAFE_ID.test(id) || !kind) continue
    if (snapshot?.helper?.on !== true || snapshot?.helper?.uses?.[USE_OF[kind]] !== true) continue
    void (async () => {
      let out: { ok: boolean; text?: string; error?: string }
      try {
        if (kind === 'lines') {
          const prompt = linesPrompt(req)
          if (!prompt) out = { ok: false, error: 'no animals to write for' }
          else {
            const r = await $.model.complete({ model: 'haiku', system: LINES_SYSTEM, prompt, maxTokens: 700, timeoutMs: 25000 })
            out = r?.isAnswered ? { ok: true, text: String(r.text ?? '').slice(0, 8000) } : { ok: false, error: String(r?.error ?? r?.reason ?? 'no answer') }
          }
        } else {
          const prompt = namePrompt(await $.session.messages())
          if (!prompt) out = { ok: false, error: 'nothing said yet' }
          else {
            const r = await $.model.complete({ model: 'haiku', system: NAME_SYSTEM, prompt, maxTokens: 30, timeoutMs: 20000 })
            out = r?.isAnswered ? { ok: true, text: String(r.text ?? '').slice(0, 200) } : { ok: false, error: String(r?.error ?? r?.reason ?? 'no answer') }
          }
        }
      } catch (err) {
        out = { ok: false, error: String(err) }
      }
      await writeReply($, `${stateDir}/helper-replies/${sessionId}.${id}.json`, { id, sessionId, kind, ...out, at: await $.clock.now() })
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
      // A stop goes first: a message sent with it is then the next turn, as when you type after Esc.
      await runSettings($, stateDirFor($.plugin.root), selfId)
      await deliverMessages($, stateDirFor($.plugin.root), selfId)
      await answerAsides($, stateDirFor($.plugin.root), selfId)
      await runHelper($, stateDirFor($.plugin.root), selfId, snapshot)
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
    turnStarted(e.turnId)
    await ensurePolling($)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    startTurn(null)
    turnEnded(e.turnId)
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

  // A shell command a stop from the dashboard sent to the background is ended, as Esc ends it.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => endStoppedCommand($, e, next))
    .catch(($, e, next) => next(e)) // replay-safe: a call already made is not run again

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
