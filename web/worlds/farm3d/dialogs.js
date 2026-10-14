// The farm's buildings, clicked: their dialogs and tooltips, copied from web/worlds/farm/world.js (dialog,
// buildingTip, boardSessions; the stall's crates and label) and web/worlds/sdk/engine.js (openBoard), with the scene
// and the frame's helpers (esc, ago, lastPart: pixel.js) passed in; collector/test/farm3d-parity.test.mjs pins them.
import { farmOf } from './layout.js';

/** A building's tooltip on the canvas (`names.neighbour`: the second account's name, for its farm's buildings). */
export const buildingTip = (k, names = {}) => ({ barn2: `${names.neighbour ?? 'The neighbour'}'s barn: start a session on your ${names.neighbour ?? 'second'} account (a new farmer walks out of its door)`, house2: `${names.neighbour ?? 'The neighbour'}'s farmhouse: who is on its porch`, shed2: `${names.neighbour ?? 'The neighbour'}'s machine shed: who is out on a machine there`, barn: 'The barn: start a new session or resume one (a new farmer walks out of its door)', silo: "The silo: your plan's usage (a silo for each of your Claude accounts, when you have two)", board: 'The notice board: what your projects remember (CLAUDE.md and memory)', house: 'The farmhouse: who is on your porch', stall: 'The market stall: pull requests', henhouse: 'The henhouse: subagents', shed: 'The machine shed: who is out on a machine' })[k] ?? '';

/** What a building shows when clicked: { title, html } (house, silo, henhouse, stall), or null. */
export function dialogFor(k, scene, { esc, ago } = globalThis) {
  if (k === 'house' || k === 'house2') { // with two accounts, each farmhouse's porch: yours, or the neighbour's (house2)
    const accs = scene.accounts ?? [], farm = k === 'house2' ? 1 : 0;
    const list = scene.farmers.filter(f => (f.state === 'waiting' || f.state === 'turn') && (accs.length < 2 || farmOf(f, accs) === farm));
    return { title: farm ? `${accs[1]?.name ?? 'The neighbour'}'s porch` : 'Your porch', html: list.length ? `<ul class="px-dl">${list.map(f => `<li><button type="button" class="act" data-farm-pick="${esc(f.id)}">Open</button><span><b>${esc(f.name)}</b> ${esc(f.state === 'waiting' ? (f.planAsk ? 'has a plan for you to approve' : `needs you: ${f.ask}`) : f.question ? `asks: ${f.question}` : `finished${f.reply ? `: ${f.reply}` : ''}`)}</span></li>`).join('')}</ul>` : '<p class="muted">Nobody is waiting on you.</p>' };
  }
  if (k === 'silo') {
    const name = w => ({ five_hour: '5-hour limit', seven_day: 'Weekly limit' })[w.kind] ?? w.kind;
    const meters = ws => ws.map(w => { const pct = w.reset ? 0 : Math.round(w.percentUsed); return `<div class="px-meter"><b>${esc(name(w))}</b><span class="bar"><i style="width:${Math.min(100, pct)}%"></i></span><span>${w.reset ? 'just reset' : `${pct}% used`}${w.resetsAt ? ` · resets ${esc(new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}` : ''}</span></div>`; }).join('');
    const accs = scene.accounts ?? [];
    if (accs.length > 1) return { title: "The silos: your accounts' plans", html: accs.map(a => `<h4>${esc(a.name)}</h4>${a.plan?.windows?.length ? meters(a.plan.windows) : '<p class="muted">No reading yet: it comes from the mod in a session running on it.</p>'}`).join('') + `<p class="muted">Each silo's grain is its account's week. The season follows ${esc(accs[0].name)}'s 5-hour limit (winter when it is nearly used up).</p>` };
    const ws = scene.plan?.windows ?? [];
    return { title: 'The silo: your plan', html: ws.length ? ws.map(w => { const pct = w.reset ? 0 : Math.round(w.percentUsed); return `<div class="px-meter"><b>${esc(name(w))}</b><span class="bar"><i style="width:${Math.min(100, pct)}%"></i></span><span>${w.reset ? 'just reset' : `${pct}% used`}${w.resetsAt ? ` · resets ${esc(new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}` : ''}</span></div>`; }).join('') + '<p class="muted">The grain is the week; the season is the 5-hour limit (winter when it is nearly used up).</p>' : '<p class="muted">No reading of your plan yet: it comes from the mod in a running session.</p>' };
  }
  if (k === 'henhouse') {
    const subs = scene.subagents ?? [];
    return { title: 'The henhouse: subagents', html: subs.length ? `<ul class="px-dl">${subs.slice(0, 40).map(c => `<li><i class="px-dot st-${esc(c.state)}"></i><span><b>${esc(c.parent)}</b> ${esc(c.label || 'a subagent')}${c.type ? ` <em>${esc(c.type)}</em>` : ''} · ${esc(c.state)}</span></li>`).join('')}</ul>` : '<p class="muted">No subagents lately.</p>' };
  }
  if (k === 'stall') {
    const link = pr => (typeof pr.url === 'string' && pr.url.startsWith('https://github.com/') ? `<a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number}</a>` : `#${pr.number}`);
    const checks = pr => (pr.draft ? 'draft' : { ok: '✓ checks pass', failed: '✗ checks failed', running: '◌ checks running' }[pr.checks] ?? 'no checks');
    const repos = scene.fields.filter(fl => fl.prs);
    return { title: 'The market stall: pull requests', html: repos.length ? repos.map(fl => `<h4>${esc(fl.name)}</h4><ul class="px-dl">${(fl.prs.open ?? []).map(pr => `<li><span>${link(pr)} ${esc(pr.title)} <em class="ck-${esc(pr.draft ? 'draft' : pr.checks ?? 'none')}">${checks(pr)}</em></span></li>`).join('') || '<li class="muted">No open pull requests.</li>'}${(fl.prs.merged ?? []).map(m => `<li class="muted"><span>${link(m)} merged${m.at ? ` ${ago(m.at)} ago` : ''}: ${esc(m.title)}</span></li>`).join('')}</ul>`).join('') : '<p class="muted">No pull requests to show: the repos here have no GitHub origin, or gh is not signed in.</p>' };
  }
  return null;
}

/** The projects whose memory the notice board shows: one session in each folder (no Codex), eight at most. */
export const boardSessions = scene => [...new Map(scene.farmers.filter(f => f.kind !== 'codex' && f.cwd).map(f => [f.cwd, f])).values()].slice(0, 8);
/** The notice board's dialog title (the engine's boardTitle). */
export const BOARD_TITLE = 'The notice board: what your projects remember';
/**
 * The notice board's body, as the engine's openBoard writes it: rows are { f (the session: id, cwd), r (its
 * agentFiles reply: { ok, status, data, error }, or null when the request threw) }.
 */
export function boardHtml(rows, { esc, lastPart } = globalThis) {
  return rows.map(({ f, r }) => {
    if (!r || (!r.ok && r.status === 0)) return `<h4>${esc(f.cwd)}</h4><p class="muted">Could not read it.</p>`; // the request itself failed
    const files = (r.ok ? r.data : null)?.memory ?? [];
    return `<h4>${esc(lastPart(f.cwd) || f.cwd)}</h4>${files.length ? `<ul class="px-dl">${files.map(m => `<li><button type="button" class="act" data-farm-mem="${esc(f.id)}" data-path="${esc(m.path)}">${esc(m.label)}</button><span class="muted">${esc(m.where)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing remembered here yet.</p>'}`;
  }).join('') || '<p class="muted">No sessions here.</p>';
}

/**
 * The market stall: a crate on its counter for each open pull request (eight at most), its tag the checks' (draft,
 * ok, failed, running, none: the 2D farm's colours, build/buildings.js draws them), and the label under it with its
 * tooltip; no label without open pull requests.
 */
export function stallOf(scene) {
  const open = (scene?.fields ?? []).flatMap(fl => fl.prs?.open ?? []);
  const crates = open.slice(0, 8).map(pr => ({ tag: pr.draft ? 'draft' : ['ok', 'failed', 'running'].includes(pr.checks) ? pr.checks : 'none' }));
  if (!open.length) return { crates, label: null, tip: null };
  return { crates, label: `${open.length} PR${open.length === 1 ? '' : 's'}`, tip: `Open pull requests: ${open.slice(0, 6).map(pr => `#${pr.number}${pr.title ? ` ${pr.title}` : ''}`).join(' · ')}${open.length > 6 ? ' …' : ''}. Click the stall for them all` };
}
/** The colours of a crate's tag, by its checks (running blinks between the two). */
export const TAG_COLOURS = { draft: '#9aa4ad', ok: '#2fa57a', failed: '#e04a3a', running: ['#f0b429', '#ffd43b'], none: '#e8d8b0' };
