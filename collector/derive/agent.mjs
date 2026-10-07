import { basename } from 'node:path';
import { summarizeTool } from '../transcript/summarize.mjs';
import { stepOf } from './step.mjs';
import { collectTouches } from './touches.mjs';
import { STATE_ORDER, deriveCodexState, deriveState } from './state.mjs';
import { trailingQuestion } from './question.mjs';

const CHILD_KEEP_MS = 60 * 60_000;
const HISTORY_SAMPLES = 200; // 10 minutes at the 3 s poll
const ACTIVITY_MINUTES = 30;
const TIMELINE_MAX = 120;
const CHILD_RECENT_MS = 60_000;
const DOCS_MAX = 20;

export function nowOf(model) {
  const p = model?.latestPending();
  return p ? { tool: p.name, summary: summarizeTool(p.name, p.input), step: stepOf(p.name, p.input), startedAt: p.at } : undefined;
}

export function childrenOf(model, childModels, now) {
  const out = [];
  for (const c of model.children.values()) {
    const cm = childModels.get(c.id);
    let state = c.state;
    if (cm && (cm.pending.size > 0 || now - cm.lastActivityAt < CHILD_RECENT_MS)) state = 'running';
    const lastAt = cm?.lastActivityAt || c.startedAt;
    if (state !== 'running' && now - lastAt > CHILD_KEEP_MS) continue;
    out.push({ id: c.id, kind: c.kind, agentType: c.agentType, label: c.label, state, startedAt: c.startedAt, now: cm ? nowOf(cm) : undefined });
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
  if (offer.kind === 'question' && model?.pending.has(offer.toolUseId)) {
    return { kind: 'question', toolUseId: offer.toolUseId, questions: offer.questions };
  }
  if (offer.kind === 'permission' && offer.expiresAt > now) {
    return { kind: 'permission', toolUseId: offer.toolUseId, tool: offer.tool, summary: offer.summary, expiresAt: offer.expiresAt };
  }
  return undefined;
}

export function buildAgent({ base, model, registry, proc, cpuHistory = [], childModels = new Map(), offer, beacon, repoOf, now, cfg, home }) {
  const ask = askOf(offer, model, now);
  const derived = base.kind === 'codex'
    ? deriveCodexState(cpuHistory, now)
    : ask?.kind === 'permission'
      ? { state: 'waiting', reason: `permission needed: ${ask.tool}`, since: offer.createdAt }
      : deriveState({ model, registry, cpuHistory, now, cfg });
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
    contextTokens: model?.contextTokens ?? undefined,
    state: derived.state,
    stateReason: derived.reason,
    sinceHint: derived.since,
    ask,
    mod: beacon ? { version: beacon.version, live: beacon.live } : undefined,
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
