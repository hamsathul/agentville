import { basename } from 'node:path';
import { clip, firstLine, summarizeTool } from '../transcript/summarize.mjs';
import { serviceOf, stepOf } from './step.mjs';
import { collectTouches } from './touches.mjs';
import { DECIDES_ALONE, STATE_ORDER, deriveCodexState, deriveState } from './state.mjs';
import { trailingQuestion } from './question.mjs';

const CHILD_KEEP_MS = 60 * 60_000;
const HISTORY_SAMPLES = 200; // 10 minutes at the 3 s poll
const ACTIVITY_MINUTES = 30;
const TIMELINE_MAX = 120;
const CHILD_RECENT_MS = 60_000;
const DOCS_MAX = 20;

export function nowOf(model) {
  const p = model?.latestPending();
  if (!p) return undefined;
  const service = serviceOf(p.name, p.input);
  return { tool: p.name, summary: summarizeTool(p.name, p.input), step: stepOf(p.name, p.input), startedAt: p.at, ...(service ? { service } : {}) };
}

const TASKS_SHOWN = 12;
/** The session's task list in short: how many are done, what it is on now, and the items. Undefined without one. */
export function tasksOf(model) {
  const list = model?.tasks?.() ?? [];
  if (!list.length) return undefined;
  const current = list.find(t => t.status === 'in_progress');
  return {
    done: list.filter(t => t.status === 'completed').length,
    total: list.length,
    ...(current ? { current: current.activeForm || current.subject } : {}),
    items: list.slice(0, TASKS_SHOWN).map(t => ({ text: t.subject, status: t.status })),
  };
}

export function childrenOf(model, childModels, now) {
  const out = [];
  for (const c of model.children.values()) {
    const cm = childModels.get(c.id);
    let state = c.state;
    if (cm && !c.endedAt && (cm.pending.size > 0 || now - cm.lastActivityAt < CHILD_RECENT_MS)) state = 'running'; // a finish the parent recorded stands
    const lastAt = cm?.lastActivityAt || c.startedAt;
    if (state !== 'running' && now - lastAt > CHILD_KEEP_MS) continue;
    out.push({
      id: c.id, kind: c.kind, agentType: c.agentType, label: c.label, state, startedAt: c.startedAt, now: cm ? nowOf(cm) : undefined,
      // from its own transcript: its steps so far, what it last said; from the parent: when it finished, and its result's first line
      steps: cm?.toolCount, lastSaid: cm?.lastReply ? firstLine(cm.lastReply) : undefined, lastAt, endedAt: c.endedAt, result: c.result ? firstLine(c.result) : undefined,
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
}

/**
 * What the mod has offered for answering from the dashboard, if it still applies: a
 * question whose call is still pending, or a permission prompt inside its window.
 */
// The mod refreshes its offer file every second while it is really waiting; an offer that has
// gone quiet means the session can no longer take a dashboard answer.
const HEARTBEAT_MS = 5_000;

export function askOf(offer, model, now) {
  if (!offer || now - (offer.heartbeatAt ?? 0) > HEARTBEAT_MS) return undefined;
  // Claude Code writes a question to the transcript only once it is answered, so a live offer counts
  // unless the transcript already has its answer (then the mod is about to withdraw the offer).
  if (offer.kind === 'question' && (model?.pending.has(offer.toolUseId) || !model?.hasResult?.(offer.toolUseId))) {
    return { kind: 'question', toolUseId: offer.toolUseId, questions: offer.questions };
  }
  if (offer.kind === 'permission' && offer.expiresAt > now) {
    return { kind: 'permission', toolUseId: offer.toolUseId, tool: offer.tool, summary: offer.summary, expiresAt: offer.expiresAt };
  }
  if (offer.kind === 'always' && offer.expiresAt > now) { // after Always allow…: Claude Code's options, each by its place
    const options = offer.suggestions.flatMap((s, option) => (s ? [{ option, label: suggestionLabel(s) }] : []));
    return { kind: 'always', toolUseId: offer.toolUseId, tool: offer.tool, summary: offer.summary, options, expiresAt: offer.expiresAt };
  }
  return undefined;
}

const and = list => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
const SCOPE = { session: 'for this session', cliArg: 'for this run', localSettings: 'in this project (just you)', projectSettings: 'in this project (shared)', userSettings: 'everywhere' };
const MODE_WORDS = { acceptEdits: 'Accept edits', auto: 'Switch to auto mode', plan: 'Switch to plan mode', default: 'Ask first', dontAsk: "Switch to don't-ask mode", bypassPermissions: 'Bypass permissions' };
/** One of Claude Code's permission suggestions in words, as its terminal offers them ("Yes, and always allow…"). */
export function suggestionLabel(s) {
  const kept = s.destination !== 'session' && s.destination !== 'cliArg';
  if (s.type === 'addRules') {
    const verb = { allow: 'allow', deny: 'deny', ask: 'ask for' }[s.behavior];
    const rules = and(s.rules.map(r => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)));
    return `${kept ? `Always ${verb}` : verb[0].toUpperCase() + verb.slice(1)} ${rules} ${SCOPE[s.destination]}`;
  }
  if (s.type === 'addDirectories') {
    const where = kept ? SCOPE[s.destination].replace(/^in this/, 'from this') : SCOPE[s.destination];
    return `${kept ? 'Always allow' : 'Allow'} access to ${and(s.directories)} ${where}`;
  }
  return `${MODE_WORDS[s.mode]} ${kept ? `by default, ${SCOPE[s.destination]}` : SCOPE[s.destination]}`;
}

/**
 * A session's permission mode: the flag its process started with (--permission-mode X, or
 * --dangerously-skip-permissions), unless its transcript recorded a mode since that process
 * started (Shift+Tab); else what the transcript last recorded. Undefined when neither says.
 */
export function modeOf(model, command, startedAt) {
  const c = String(command ?? '');
  const fromFlag = /(?:^|\s)--dangerously-skip-permissions(?:\s|$)/.test(c) ? 'bypassPermissions' : c.match(/(?:^|\s)--permission-mode[ =]([A-Za-z]+)/)?.[1];
  const logged = model?.permissionMode;
  if (logged && (!fromFlag || !startedAt || (model.permissionModeAt ?? 0) >= startedAt)) return logged;
  return fromFlag ?? logged ?? undefined;
}

/**
 * A session's effort level: what /effort last set since its process started, else the --effort
 * flag it started with, else what the transcript last recorded. Undefined: the model's default.
 */
export function effortOf(model, command, startedAt) {
  const fromFlag = String(command ?? '').match(/(?:^|\s)--effort[ =]([a-z]+)/)?.[1];
  const logged = model?.effort;
  if (logged && (!fromFlag || !startedAt || (model.effortAt ?? 0) >= startedAt)) return logged;
  return fromFlag ?? logged ?? undefined;
}

/**
 * A working session's turn, as its terminal's working line shows it: since when, the tokens
 * received, and (from its mod) the line's word and what the turn is doing (thinking, responding…).
 */
export function turnOf(model, beacon) {
  const startedAt = beacon?.turn?.startedAt ?? model?.turnStartedAt;
  if (!startedAt) return undefined;
  const outTokens = model?.turnTokens?.() ?? 0;
  return { startedAt, ...(outTokens ? { outTokens } : {}), ...(beacon?.turn?.word ? { word: beacon.turn.word } : {}), ...(beacon?.turn?.mode ? { mode: beacon.turn.mode } : {}) };
}

/**
 * The shell commands it runs now (from ps), each matched to its Bash call where the transcript has it:
 * whether it runs in the background, and whether its output can be read (a background one's file).
 */
function shellsNow(shells, model, childModels) {
  if (!shells?.length) return undefined;
  // Its process is alive, so it is running whatever the transcript last said: the latest call with that command.
  const running = [model, ...childModels.values()].filter(Boolean).flatMap(m => m.bashCalls().filter(c => typeof c.input?.command === 'string'));
  return shells.map(s => {
    const call = running.findLast(c => c.input.command === s.command) ?? running.findLast(c => c.input.command && s.command.includes(c.input.command));
    return {
      pid: s.pid, command: clip(s.command.split('\n')[0], 200), ...(call?.input.description ? { about: clip(call.input.description) } : {}),
      startedAt: s.startedAt, cpu: s.cpu, rssMb: s.rssMb, background: Boolean(call?.background), ...(call ? { toolUseId: call.id } : {}), output: Boolean(call?.outputPath),
    };
  });
}

/** The MCP servers it (or a subagent) called in the last hour, newest first: [{ server, at }], for their carts on the farm. */
function mcpUsed(model, childModels, now) {
  const last = new Map();
  for (const m of [model, ...childModels.values()].filter(Boolean)) {
    for (const c of m.callsSince(now - 3_600_000)) {
      const server = c.name?.startsWith('mcp__') ? serviceOf(c.name) : undefined;
      if (server && c.at > (last.get(server) ?? 0)) last.set(server, c.at);
    }
  }
  return last.size ? [...last].map(([server, at]) => ({ server, at })).sort((x, y) => y.at - x.at).slice(0, 8) : undefined;
}

export function buildAgent({ base, model, registry, proc, command, cpuHistory = [], childModels = new Map(), offer, beacon, repoOf, now, cfg, home, asides, setting, shells }) {
  const mode = modeOf(model, command, registry?.startedAt);
  // An older mod offers every call Claude Code's check hands on, even where the mode decides it without you.
  const ask = offer?.kind === 'permission' && DECIDES_ALONE.has(mode) ? undefined : askOf(offer, model, now);
  const derived = base.kind === 'codex'
    ? deriveCodexState(cpuHistory, now)
    : ask?.kind === 'permission' || ask?.kind === 'always'
      ? { state: 'waiting', reason: `permission needed: ${ask.tool}`, since: offer.createdAt }
      : ask?.kind === 'question' ? { state: 'waiting', reason: 'question pending', since: offer.createdAt }
      : deriveState({ model, registry, cpuHistory, now, cfg, mode });
  const since = now - cfg.collisionWindowMin * 60_000;
  const calls = model ? model.callsSince(since) : [];
  for (const cm of childModels.values()) calls.push(...cm.callsSince(since));
  const touching = collectTouches(calls, since, home).map(t => ({ ...t, repo: repoOf(t.path) ?? undefined }));
  const recent = calls.filter(c => c.at > now - ACTIVITY_MINUTES * 60_000).sort((x, y) => x.at - y.at);
  return {
    id: base.id,
    kind: base.kind,
    cliId: base.cliId,
    name: base.name || model?.title || basename(base.cwd || '') || base.id,
    title: model?.title ?? undefined,
    cwd: base.cwd,
    pid: base.pid,
    model: model?.model ?? undefined,
    modelLabel: model?.modelSet ?? undefined, // what /model last set it to, shown before its next reply says
    fast: model?.fast || undefined,
    contextTokens: model?.contextTokens ?? undefined,
    tasks: tasksOf(model),
    compactions: model?.compactions || undefined,
    lastCompactAt: model?.lastCompactAt || undefined,
    wakeAt: model?.wakeAt > now ? model.wakeAt : undefined, // a /loop or scheduled wake-up still to come
    state: derived.state,
    stateReason: derived.reason,
    sinceHint: derived.since,
    ask,
    mod: beacon ? { version: beacon.version, live: beacon.live } : undefined,
    mode,
    shells: shellsNow(shells, model, childModels), // its shell commands running now, to watch and stop
    mcp: mcpUsed(model, childModels, now),
    effort: beacon?.effort ?? effortOf(model, command, registry?.startedAt),
    turn: derived.state === 'working' ? turnOf(model, beacon) : undefined,
    asides: asides?.length ? asides : undefined, // side questions (/btw) asked from the dashboard, newest first
    setting, // the last model or effort switch asked from the dashboard, and what Claude Code said
    usage: beacon?.usage ? { costUsd: beacon.usage.costUsd, contextPercent: beacon.usage.contextPercent } : undefined, // the plan's windows go in snapshot.plan
    lastActivityAt: model?.lastActivityAt || undefined,
    now: nowOf(model),
    lastPrompt: model?.lastPrompt ?? undefined,
    lastReply: model?.lastReply ?? undefined,
    question: derived.state === 'yourTurn' ? trailingQuestion(model?.finalReply) ?? undefined : undefined,
    feed: model ? model.recent(20, 10).map(previewOf) : [], // the latest steps, and the latest messages however busy it was
    children: model ? childrenOf(model, childModels, now) : [],
    touching,
    docs: docsOf(model, childModels),
    proc: proc ? { ...proc, history: historyOf(cpuHistory) } : undefined,
    activity: activityOf(recent, now),
    timeline: recent.slice(-TIMELINE_MAX).map(c => ({ at: c.at, tool: c.name })),
  };
}

/** The snapshot goes out on every change for every agent, so long messages travel as a preview; /feed has them whole. */
const PREVIEW_MAX = 600;
function previewOf(item) {
  if (!item.body || item.body.length <= PREVIEW_MAX) return item;
  return { ...item, body: `${item.body.slice(0, PREVIEW_MAX)}…`, more: true };
}

/** Markdown files the session and its subagents wrote or read, newest first. */
function docsOf(model, childModels) {
  const byPath = new Map();
  for (const m of [model, ...childModels.values()]) {
    for (const d of m?.documents() ?? []) {
      const prev = byPath.get(d.path);
      byPath.set(d.path, prev ? { path: d.path, wrote: prev.wrote || d.wrote, at: Math.max(prev.at, d.at) } : d);
    }
  }
  return [...byPath.values()].sort((a, b) => b.at - a.at).slice(0, DOCS_MAX);
}

function historyOf(samples) {
  const last = samples.slice(-HISTORY_SAMPLES);
  return { at: last.map(s => s.at), cpu: last.map(s => s.cpu), rssMb: last.map(s => s.rssMb ?? 0) };
}

/** Tool calls per minute over the last 30 minutes; index 29 is the current minute. */
function activityOf(calls, now) {
  const buckets = new Array(ACTIVITY_MINUTES).fill(0);
  for (const c of calls) {
    const minutesAgo = Math.floor((now - c.at) / 60_000);
    if (minutesAgo >= 0 && minutesAgo < ACTIVITY_MINUTES) buckets[ACTIVITY_MINUTES - 1 - minutesAgo] += 1;
  }
  return buckets;
}

export function applySince(agent, prev, now) {
  const { sinceHint, ...rest } = agent;
  const stateSince = sinceHint ?? (prev && prev.state === agent.state ? prev.stateSince : now);
  return { ...rest, stateSince };
}

export function sortAgents(agents) {
  return [...agents].sort((a, b) =>
    STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
}

export function countStates(agents, collisions) {
  const counts = { waiting: 0, working: 0, yourTurn: 0, stale: 0, idle: 0, collisions: collisions.length };
  for (const a of agents) counts[a.state] += 1;
  return counts;
}
