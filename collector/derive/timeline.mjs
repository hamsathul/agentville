// 💬 All chats: what every Claude session on the dashboard said and did, merged into one timeline,
// oldest first. It reads only what each session's model already holds (up to 200 messages and 200
// steps), never a transcript, so it is cheap enough to ask whenever a session moves.

const BODY_CUT = 4000; // a message longer than this comes cut, with `more` (the whole of it is in ⤢ Read all)
const MAX_ITEMS = 2000; // the newest this many at most; `truncated` says some were left out
const KEPT = 200; // each session's messages and steps, as many as its model keeps
const PEER_GAP_MS = 60_000; // a message sent and the same one received, at most this far apart, are one

const cut = text => {
  const t = String(text ?? '');
  return t.length > BODY_CUT ? { body: t.slice(0, BODY_CUT), more: true } : { body: t };
};
const sameText = (x, y) => String(x.body ?? x.text ?? '').trim() === String(y.body ?? y.text ?? '').trim();
/** Oldest first; a restore's line after anything at the same moment (it took that back). */
export const byTime = (x, y) => x.at - y.at || (x.kind === 'restored') - (y.kind === 'restored');

/**
 * The timeline since `since` (inclusive): { now, since, truncated, items }. `agents` are the snapshot's;
 * `recordOf(id)` gives a session's record ({ model }). Codex agents and sessions with no model are left
 * out. Every item has `at`, `agent` (a session id), `name` (its name) and `kind`.
 */
export function buildTimeline({ agents, recordOf, since = 0, now = Date.now(), maxItems = MAX_ITEMS }) {
  const watched = agents.filter(a => a.kind !== 'codex' && recordOf(a.id)?.model);
  const named = new Map(); // a name → its session, or null when two have that name
  for (const a of watched) named.set(a.name, named.has(a.name) ? null : a);
  const byPid = new Map(watched.filter(a => a.pid).map(a => [a.pid, a]));
  const items = [], outs = [], ins = [];
  for (const a of watched) {
    const { model } = recordOf(a.id);
    const base = { agent: a.id, name: a.name };
    for (const it of model.history(KEPT)) {
      if (it.kind === 'tool') items.push({ ...base, at: it.at, kind: 'tool', tool: it.tool, step: it.step, text: it.text });
      else if (it.kind === 'prompt' || it.kind === 'reply') items.push({ ...base, at: it.at, kind: it.kind, ...cut(it.body ?? it.text) });
      else if (it.kind === 'restored') items.push({ ...base, at: it.restoredAt ?? it.at, kind: 'restored', text: it.text, back: it.at });
      else if (it.kind === 'peer') (it.dir === 'out' ? outs : ins).push({ a, it });
    }
    for (const c of model.children.values()) {
      if (c.kind !== 'subagent' || !c.endedAt || !c.result) continue;
      items.push({ ...base, at: c.endedAt, kind: 'subagent', childId: c.id, agentType: c.agentType ?? 'subagent', label: c.label ?? '', ...cut(c.result) });
    }
  }
  // A message between two watched sessions is in both transcripts: sent in one, received in the other. One item.
  const merged = new Set();
  for (const { a, it } of outs) {
    const to = named.get(it.other) ?? watched.find(x => x.id === it.other) ?? null;
    const copy = to && ins.find(x => !merged.has(x) && x.a === to && ((x.it.pid && x.it.pid === a.pid) || named.get(x.it.other) === a) && sameText(x.it, it) && Math.abs(x.it.at - it.at) <= PEER_GAP_MS);
    if (copy) merged.add(copy);
    items.push({ agent: a.id, name: a.name, at: it.at, kind: 'peer', from: a.name, to: to?.name ?? it.other, fromId: a.id, ...(to ? { toId: to.id } : {}), ...(it.summary ? { summary: it.summary } : {}), ...(it.helper ? { helper: true } : {}), ...cut(it.body ?? it.text) });
  }
  for (const x of ins) {
    if (merged.has(x)) continue;
    const { a, it } = x;
    const from = (it.pid && byPid.get(it.pid)) || named.get(it.other) || null;
    items.push({ agent: a.id, name: a.name, at: it.at, kind: 'peer', from: from?.name ?? it.other, to: a.name, ...(from ? { fromId: from.id } : {}), toId: a.id, ...cut(it.body ?? it.text) });
  }
  const kept = items.filter(i => i.at >= since).sort(byTime);
  const truncated = kept.length > maxItems;
  return { now, since, truncated, items: truncated ? kept.slice(-maxItems) : kept };
}
