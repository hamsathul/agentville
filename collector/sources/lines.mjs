import { modAtLeast } from './pending.mjs';

// Animal lines (✨ Helper): Haiku writes what the animals on screen say about what is happening, through
// an open session's mod. This decides what is news (events), what is sent (facts only: names, states, a
// step word, counts, events; never a path, a command, a branch or anyone's words), which session runs a
// call, when a batch is due, and which reply rows are kept (docs/worlds.md, README "✨ Helper").
export const SITUATIONS = ['idle', 'deployFailed', 'deployOk', 'harvest', 'merged', 'arrive'];
export const CREATURE_KINDS = ['cow', 'goat', 'sheepdog', 'ostrich', 'lion', 'tiger', 'duck', 'cat', 'dog', 'pigeon', 'mouse', 'fish', 'robodog', 'vacuum']; // creatures.js (a test fails when they drift)
// The mod that first knew a kind (its LINE_KINDS); the rest, 0.9.0. An older mod drops a kind it doesn't know from
// the cast, so that animal gets no lines, and a cast of only such kinds comes back as an error, counted as a call.
const KIND_SINCE = { robodog: '0.9.1', vacuum: '0.9.1' };
const CONTROLS = /[\x00-\x1f\x7f-\x9f\p{Bidi_Control}]/gu;
const plain = (v, max) => String(v ?? '').replace(CONTROLS, '').trim().slice(0, max);
const EVENT_KEEP_MS = 30 * 60_000;

/** A world's animals as the page reported them: library kinds, names of 30 characters or fewer made plain, a kind once; null for no list or more than 12. */
export function checkCast(list) {
  if (!Array.isArray(list) || list.length > 12) return null;
  const out = new Map();
  for (const c of list) {
    if (!c || typeof c !== 'object' || !CREATURE_KINDS.includes(c.kind) || typeof c.name !== 'string' || c.name.length > 30) continue;
    if (!out.has(c.kind)) out.set(c.kind, { kind: c.kind, name: plain(c.name, 30) || c.kind });
  }
  return [...out.values()];
}

const STEPS = { Edit: 'editing', Write: 'editing', MultiEdit: 'editing', NotebookEdit: 'editing', Read: 'reading', Grep: 'searching', Glob: 'searching', WebSearch: 'searching', WebFetch: 'searching', Bash: 'running', ExitPlanMode: 'planning', TodoWrite: 'planning', Task: 'delegating' };
/** What an agent is doing, as one word from its tool's name (never its arguments: they can hold paths). */
export function stepOf(a) {
  if (a?.state === 'waiting') return 'asking';
  if (a?.state !== 'working') return null;
  const tool = a.now?.tool;
  return tool ? STEPS[tool] ?? 'working' : 'thinking';
}

/** What is news between one snapshot and the next: a deploy that turns failed or ok, a compaction, a new merge, a new agent. */
export function createLinesWatch({ now = () => Date.now() } = {}) {
  let seen = null, events = [];
  const startedAt = now(); // what happened before this (learned late: a transcript read, a deploy or PR check) is no news
  const before = t => Number.isFinite(t) && t <= startedAt;
  return {
    observe(snap) {
      const at = now(), agents = snap?.agents ?? [], repos = snap?.repos ?? [];
      const repoOf = new Map();
      for (const r of repos) for (const id of r.agentIds ?? []) repoOf.set(id, r.name ?? null);
      const push = (kind, agent, repo) => events.push({ kind, agent, repo, at });
      if (seen) {
        for (const r of repos) {
          if (!seen.deploys.has(r.path)) continue; // a repo first seen now: no news
          const s = r.lastDeploy?.state ?? null;
          if ((s === 'failed' || s === 'ok') && seen.deploys.get(r.path) !== s && !before(r.lastDeploy?.at)) push(s === 'failed' ? 'deployFailed' : 'deployOk', null, r.name ?? null);
          for (const p of r.prs?.merged ?? []) if (!seen.merged.has(`${r.path}#${p.number}`) && (p.at ?? 0) > at - EVENT_KEEP_MS && !before(p.at)) push('merged', null, r.name ?? null);
        }
        for (const a of agents) {
          if (!seen.agents.has(a.id)) push('arrive', a.name ?? null, repoOf.get(a.id) ?? null);
          else if ((a.compactions ?? 0) > (seen.compactions.get(a.id) ?? 0) && !before(a.lastCompactAt)) push('harvest', a.name ?? null, repoOf.get(a.id) ?? null);
        }
      }
      seen = {
        deploys: new Map(repos.map(r => [r.path, r.lastDeploy?.state ?? null])),
        merged: new Set(repos.flatMap(r => (r.prs?.merged ?? []).map(p => `${r.path}#${p.number}`))),
        agents: new Set(agents.map(a => a.id)),
        compactions: new Map(agents.map(a => [a.id, a.compactions ?? 0])),
      };
      events = events.filter(e => e.at > at - EVENT_KEEP_MS);
    },
    /** The five newest of the last 30 minutes, newest first. */
    recent: () => [...events].sort((x, y) => y.at - x.at).slice(0, 5),
    /** Whether anything happened after `t`. */
    since: t => events.some(e => e.at > t),
  };
}

const ORDER = { waiting: 0, yourTurn: 1, working: 2, idle: 3, stale: 4 };
/** The request's facts: the cast, up to 12 agents (waiting ones first), the counts and the events. Nothing else. */
export function factsOf(snap, cast, events, now) {
  const all = snap?.agents ?? [], repoOf = new Map();
  for (const r of snap?.repos ?? []) for (const id of r.agentIds ?? []) repoOf.set(id, r.name);
  const agents = [...all].sort((x, y) => (ORDER[x.state] ?? 5) - (ORDER[y.state] ?? 5)).slice(0, 12).map(a => {
    const step = stepOf(a), repo = repoOf.get(a.id);
    return { name: plain(a.name, 40), state: a.state === 'yourTurn' ? 'turn' : plain(a.state, 10), ...(step ? { step } : {}), ...(repo ? { repo: plain(repo, 40) } : {}) };
  });
  return {
    cast: (cast ?? []).slice(0, 12).map(c => ({ kind: c.kind })), // kinds only: a world's own names for its animals never reach the model
    agents,
    counts: { waiting: all.filter(a => a.state === 'waiting').length, working: all.filter(a => a.state === 'working').length, idle: all.filter(a => a.state === 'idle').length },
    events: (events ?? []).slice(0, 5).map(e => ({ kind: e.kind, ...(e.agent ? { agent: plain(e.agent, 40) } : {}), ...(e.repo ? { repo: plain(e.repo, 40) } : {}), ago: Math.max(0, Math.round((now - e.at) / 60_000)) })),
  };
}

/** Every name a request could have put in a line: the snapshot's agents, repos and branches, and the names in its facts (an agent gone since, a name before a rename). */
export function namesOf(snap, facts) {
  return [...new Set([
    ...(snap?.agents ?? []).map(a => a.name), ...(snap?.repos ?? []).flatMap(r => [r.name, r.branch]),
    ...(facts?.agents ?? []).flatMap(a => [a.name, a.repo]), ...(facts?.events ?? []).flatMap(e => [e.agent, e.repo]),
  ].filter(n => typeof n === 'string' && n.trim()))];
}
/** Whether a line holds a name (as the page's private filter decides): one of 4 or more characters anywhere, or a part of one; a shorter one as a whole word; any case. */
function isNamed(text, names) {
  const long = new Set(), short = new Set();
  for (const n of names ?? []) {
    const s = n.toLowerCase().trim();
    (s.length >= 4 ? long : short).add(s);
    for (const part of s.split(/[-_/. ]+/)) if (part.length >= 4) long.add(part);
  }
  const t = text.toLowerCase();
  if ([...long].some(n => t.includes(n))) return true;
  return [...short].some(n => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u').test(t));
}

/** The rows of Haiku's reply worth keeping: `kind|when|text`, a kind of the cast, a known situation, plain text of 1 to 40; 40 at most. A row holding one of `names` is marked `named` (a private world never gets it). */
export function parseLines(text, castKinds, names = []) {
  const kinds = new Set(castKinds ?? []), out = [];
  for (const row of String(text ?? '').slice(0, 8000).split('\n')) {
    const parts = row.split('|');
    if (parts.length !== 3) continue;
    const [kind, when] = parts.map(p => p.trim()), t = plain(parts[2].trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''), 41);
    if (!kinds.has(kind) || !SITUATIONS.includes(when) || !t || t.length > 40) continue;
    out.push({ kind, when, text: t, ...(isNamed(t, names) ? { named: true } : {}) });
    if (out.length >= 40) break;
  }
  return out;
}

const RANK = { idle: 0, yourTurn: 1, working: 2 };
/**
 * The session to run a batch for this cast: listening, with a mod that knows every kind in it (0.9.0, or 0.9.1 for
 * the robot dog and the vacuum), not codex; idle first, then on its turn, then working; least recently used first.
 */
export function chooseSession(agents, lastUsed = new Map(), cast = []) {
  const need = (cast ?? []).map(c => (Object.hasOwn(KIND_SINCE, c?.kind) ? KIND_SINCE[c.kind] : '0.9.0')).reduce((v, w) => (modAtLeast(v, w) ? v : w), '0.9.0');
  const ok = (agents ?? []).filter(a => a.kind !== 'codex' && a.mod?.live && modAtLeast(a.mod.version, need) && a.state in RANK);
  ok.sort((x, y) => RANK[x.state] - RANK[y.state] || (lastUsed.get(x.id) ?? 0) - (lastUsed.get(y.id) ?? 0));
  return ok[0] ?? null;
}

/** Whether a batch is due: the first at once; after an event, once `gapMs` has passed; else every `idleMs`. */
export function dueLines({ now, lastAskedAt, eventSince, gapMs = 300_000, idleMs = 1_800_000 }) {
  if (lastAskedAt == null) return true;
  if (eventSince && now - lastAskedAt >= gapMs) return true;
  return now - lastAskedAt >= idleMs;
}
