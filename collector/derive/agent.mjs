import { basename } from 'node:path';
import { summarizeTool } from '../transcript/summarize.mjs';
import { collectTouches } from './touches.mjs';
import { STATE_ORDER, deriveCodexState, deriveState } from './state.mjs';

const CHILD_KEEP_MS = 60 * 60_000;
const CHILD_RECENT_MS = 60_000;

export function nowOf(model) {
  const p = model?.latestPending();
  return p ? { tool: p.name, summary: summarizeTool(p.name, p.input), startedAt: p.at } : undefined;
}

export function childrenOf(model, childModels, now) {
  const out = [];
  for (const c of model.children.values()) {
    const cm = childModels.get(c.id);
    let state = c.state;
    if (cm && (cm.pending.size > 0 || now - cm.lastActivityAt < CHILD_RECENT_MS)) state = 'running';
    const lastAt = cm?.lastActivityAt || c.startedAt;
    if (state !== 'running' && now - lastAt > CHILD_KEEP_MS) continue;
    out.push({ id: c.id, kind: c.kind, label: c.label, state, startedAt: c.startedAt, now: cm ? nowOf(cm) : undefined });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
}

export function buildAgent({ base, model, registry, proc, cpuHistory = [], childModels = new Map(), repoOf, now, cfg, home }) {
  const derived = base.kind === 'codex'
    ? deriveCodexState(cpuHistory, now)
    : deriveState({ model, registry, cpuHistory, now, cfg });
  const since = now - cfg.collisionWindowMin * 60_000;
  const calls = model ? model.callsSince(since) : [];
  for (const cm of childModels.values()) calls.push(...cm.callsSince(since));
  const touching = collectTouches(calls, since, home).map(t => ({ ...t, repo: repoOf(t.path) ?? undefined }));
  return {
    id: base.id,
    kind: base.kind,
    cliId: base.cliId,
    remoteUrl: base.bridgeSessionId ? `https://claude.ai/code/${base.bridgeSessionId}` : undefined,
    name: base.name || model?.title || basename(base.cwd || '') || base.id,
    title: model?.title ?? undefined,
    cwd: base.cwd,
    pid: base.pid,
    model: model?.model ?? undefined,
    contextTokens: model?.contextTokens ?? undefined,
    state: derived.state,
    stateReason: derived.reason,
    sinceHint: derived.since,
    lastActivityAt: model?.lastActivityAt || undefined,
    now: nowOf(model),
    lastPrompt: model?.lastPrompt ?? undefined,
    lastReply: model?.lastReply ?? undefined,
    feed: model ? model.feed.slice(0, 20) : [],
    children: model ? childrenOf(model, childModels, now) : [],
    touching,
    proc: proc ? { ...proc, cpuHistory: cpuHistory.slice(-20).map(s => s.cpu) } : undefined,
  };
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
