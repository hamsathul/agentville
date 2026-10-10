// 💬 All chats: every Claude session's conversation in one timeline, oldest first, from the collector's
// /api/timeline (what it holds for each session: its latest 200 messages and 200 steps). Opened from the
// top bar's 💬 All chats and a world's Menu (nav { what: 'chats' }). Each agent's steps between two of its
// messages fold into one line; chips pick whose messages show. Your last look (the time of the newest
// item you saw) is kept in the browser, so it opens at what is new since.
// It loads before sidebar.js: its click handler takes the modal's own card buttons before the sidebar's.

const CHATS_LOOK = 'tracker-chats-look'; // the time of the newest item seen, when it last shut
const CHATS_LONG = 900; // a message longer than this, or than 12 lines, folds with Show more
let chats = null; // while open: what it holds (chatsState)
const chatsPicked = new Set(); // the agents whose chips are picked; none picked shows everyone
const chatsOpenRuns = new Set(); // runs of steps opened with ▸
const chatsOpenLong = new Set(); // long messages opened with Show more

/** Every agent's last activity, to tell when one has done something since. */
const chatsActivity = () => new Map((snap?.agents ?? []).map(a => [a.id, a.lastActivityAt ?? 0]));
const chatsState = look => ({ items: [], keys: new Set(), loading: true, error: null, truncated: false, look, html: '', first: true, rebase: false, shown: 0, unseen: 0, fetchedAt: 0, seen: chatsActivity(), timer: 0 });
const chKey = i => `${i.agent}|${i.kind}|${i.at}|${String(i.body ?? i.text ?? '').slice(0, 80)}`; // the same item, read twice
/** A short id for an item, safe in an attribute (Show more's). */
const chId = i => { let h = 0x811c9dc5; for (const c of chKey(i)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h.toString(36); };
const chByTime = (x, y) => x.at - y.at || (x.kind === 'restored') - (y.kind === 'restored'); // as the collector sorts them
const chSaid = i => i.kind === 'prompt' || i.kind === 'reply' || i.kind === 'peer' || i.kind === 'subagent'; // a message, not a step or a restore
const chSpeaker = i => (i.kind === 'peer' ? i.fromId ?? i.agent : i.agent); // whose chip a message counts on
const chNearBottom = el => (el.scrollHeight ?? 0) - (el.scrollTop ?? 0) - (el.clientHeight ?? 0) <= 40;

async function openChats() {
  if (chats && $('chats').open) return;
  chats = chatsState(Number(loadSaved(CHATS_LOOK)) || null); // no storage: no "new" line
  const mine = chats;
  $('chats').showModal();
  drawChats();
  chats.fetchedAt = Date.now();
  const r = await chatsFetch(0);
  if (chats !== mine) return; // shut meanwhile
  chatsTake(r);
  drawChats();
}

/** Shuts it: the newest item seen becomes your last look. */
function closeChats() {
  chatsSaveLook();
  if (chats?.timer) clearTimeout(chats.timer);
  chats = null;
  chatsPicked.clear();
  chatsOpenRuns.clear();
  chatsOpenLong.clear();
  $('chats-body').innerHTML = '';
  if ($('chats').open) $('chats').close();
}
function chatsSaveLook() {
  const newest = chats?.items.at(-1)?.at;
  if (newest && newest > (chats.look ?? 0)) save(CHATS_LOOK, String(newest));
}

async function chatsFetch(since) {
  try {
    const r = await fetch(`/api/timeline?since=${since}`, { headers: { 'x-tracker-token': TOKEN } });
    return r.ok ? await r.json() : { error: (await r.json().catch(() => ({}))).error ?? `The tracker said ${r.status}.` };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

/** Adds what was read, each item once, in order. How many were new. */
function chatsTake(r) {
  chats.loading = false;
  if (r.error) { chats.error = r.error; return 0; }
  chats.error = null;
  if (r.truncated) chats.truncated = true;
  let added = 0;
  for (const i of Array.isArray(r.items) ? r.items : []) {
    const k = chKey(i);
    if (chats.keys.has(k)) continue;
    chats.keys.add(k);
    chats.items.push(i);
    added++;
  }
  if (added) chats.items.sort(chByTime);
  return added;
}

async function chatsRetry() {
  chats.loading = true;
  chats.error = null;
  drawChats();
  const mine = chats;
  chats.fetchedAt = Date.now();
  const r = await chatsFetch(chats.items.at(-1)?.at ?? 0);
  if (chats !== mine) return;
  chatsTake(r);
  drawChats();
}

/** Each agent's messages since your last look (not your own), on the chip of whoever said them. */
function chatsNewCounts() {
  const counts = new Map();
  if (!chats?.look) return counts;
  for (const i of chats.items) if (chSaid(i) && i.kind !== 'prompt' && i.at > chats.look) counts.set(chSpeaker(i), (counts.get(chSpeaker(i)) ?? 0) + 1);
  return counts;
}

function chatsSubText() {
  const n = (snap?.agents ?? []).filter(a => a.kind !== 'codex').length;
  const fresh = [...chatsNewCounts().values()].reduce((sum, k) => sum + k, 0);
  return `${n} agent${n === 1 ? '' : 's'}${fresh ? ` · ${fresh} new since ${convoWhen(chats.look)}` : ''}`;
}

/** All, a chip per agent (its state's dot, its new messages), the gone ones greyed, Needs you; and why Codex isn't here. */
function chatsChipsHtml() {
  const agents = fsOrder().filter(a => a.kind !== 'codex');
  const here = new Set(agents.map(a => a.id));
  const gone = new Map();
  for (const i of chats.items) if (!here.has(i.agent)) gone.set(i.agent, i.name);
  const counts = chatsNewCounts();
  const chip = (id, name, state, extra = '') => `<button type="button" class="ch-chip${chatsPicked.has(id) ? ' on' : ''}${state === 'gone' ? ' gone' : ''}" data-chats-chip="${esc(id)}" aria-pressed="${chatsPicked.has(id)}"><span class="ch-dot s-${esc(state)}"></span>${esc(name)}${extra}${counts.get(id) ? `<span class="ch-n">${counts.get(id)}</span>` : ''}</button>`;
  const needs = agents.filter(needsYou);
  return `<button type="button" class="ch-chip${chatsPicked.size ? '' : ' on'}" data-chats-chip="" aria-pressed="${!chatsPicked.size}">All</button>`
    + agents.map(a => chip(a.id, a.name, needsYou(a) ? 'waiting' : a.state)).join('')
    + [...gone].map(([id, name]) => chip(id, name, 'gone', ' <span class="faint">gone</span>')).join('')
    + (needs.length ? `<button type="button" class="ch-chip warn" data-chats-needs>⚠ Needs you · ${needs.length}</button>` : '')
    + ((snap?.agents ?? []).some(a => a.kind === 'codex') ? '<span class="faint ch-codex">Codex agents have no transcript, so they aren\'t here.</span>' : '');
}

/** One message (or a restore's line), tagged with who said it, in its agent's colour. */
function chatsItemHtml(i, taken) {
  const color = fsColor({ id: chSpeaker(i) }), dim = taken ? ' ch-taken' : '';
  if (i.kind === 'restored') return `<div class="ch-line">↺ <b style="color:${color}">${esc(i.name)}</b> went back to an earlier message (${esc(convoWhen(i.back))})</div>`;
  const body = String(i.body ?? ''), id = chId(i), open = chatsOpenLong.has(id);
  const long = body.length > CHATS_LONG || body.split('\n').length > 12;
  const fold = long ? ` ch-long${open ? ' open' : ''}` : '';
  const rest = i.more ? `<button type="button" class="act mini" data-convo="${esc(i.kind === 'subagent' ? `${i.agent}:${i.childId}` : i.agent)}">The rest: ⤢ Read all</button>` : '';
  const more = !long ? '' : open ? `<button type="button" class="act mini" data-chats-long="${id}">Show less</button>${rest}` : `<button type="button" class="act mini" data-chats-long="${id}">Show more</button>`;
  const when = `<time>${esc(convoWhen(i.at))}</time>`;
  const tag = `data-chats-agent="${esc(chSpeaker(i))}"`;
  if (i.kind === 'prompt') return `<div class="bub you${fold}${dim}" ${tag}><div class="ch-who">You → ${esc(i.name)}</div><div class="cv-text ch-text">${esc(body)}</div>${more}${when}</div>`;
  if (i.kind === 'peer') return `<div class="bub peer${fold}${dim}" ${tag}><div class="peer-head">✉ ${esc(i.from)} → ${esc(i.to)}${i.summary ? ` · ${esc(i.summary)}` : ''}</div><div class="bub-md cv-text ch-text">${renderMarkdown(body)}</div>${more}${when}</div>`;
  const who = i.kind === 'subagent' ? `↳ ${esc(i.name)}'s subagent · ${esc(i.agentType)} · ${esc(i.label)}` : esc(i.name);
  return `<div class="bub agent${i.kind === 'subagent' ? ' ch-sub' : ''}${fold}${dim}" ${tag}><div class="ch-who" style="color:${color}">${who}</div><div class="bub-md cv-text ch-text">${renderMarkdown(body)}</div>${more}${when}</div>`;
}

/** An agent's steps between two of its messages, as one line (▸ opens them). A working agent's last run says what it does now. */
function chatsRunHtml(run, live, agent) {
  const key = `${run.agent}|${run.steps[0].at}`, open = chatsOpenRuns.has(key), n = run.steps.length;
  const line = s => `${s.tool} ${s.text ?? ''}`.trim();
  const distinct = [...new Set(run.steps.map(line))];
  const what = live
    ? `<span class="ch-now">now: ${esc(agent?.now ? `${agent.now.tool} ${agent.now.summary ?? ''}`.trim() : line(run.steps.at(-1)))}</span>`
    : `${esc(distinct.slice(0, 3).join(', '))}${distinct.length > 3 ? '…' : ''}`;
  const list = open ? `<div class="ch-steps">${run.steps.map(s => `<div class="mono"><time>${esc(clock(s.at))}</time>${esc(line(s))}</div>`).join('')}</div>` : '';
  return `<div class="ch-run${live ? ' ch-live' : ''}"><button type="button" class="ch-run-btn" data-chats-run="${esc(key)}" aria-expanded="${open}">${open ? '▾' : '▸'} <b style="color:${fsColor({ id: run.agent })}">${esc(run.name)}</b> · ${live ? 'working · ' : ''}${n} step${n === 1 ? '' : 's'} · ${what}</button>${list}</div>`;
}

/** The timeline as HTML: messages, folded runs of steps, restores' lines, and the "new" line. */
function chatsView() {
  if (chats.loading && !chats.items.length) return { html: '<div class="loading"><span class="spinner"></span>Reading every conversation…</div>', said: 0, fresh: false };
  if (chats.error && !chats.items.length) return { html: `<div class="empty">Couldn't read the chats: ${esc(chats.error)} <button type="button" class="act mini" data-chats-retry>Try again</button></div>`, said: 0, fresh: false };
  const agents = new Map((snap?.agents ?? []).map(a => [a.id, a]));
  const shows = id => !chatsPicked.size || chatsPicked.has(id);
  const items = chats.items.filter(i => (i.kind === 'peer' ? shows(i.fromId ?? i.agent) || (i.toId !== undefined && shows(i.toId)) : shows(i.agent)));
  const restores = items.filter(i => i.kind === 'restored');
  const taken = i => restores.some(r => r !== i && r.agent === i.agent && i.at >= r.back && i.at <= r.at); // what a restore took back
  const entries = [], runs = new Map();
  const endRun = id => { const run = runs.get(id); if (run) { entries.push({ at: run.steps.at(-1).at, run }); runs.delete(id); } };
  for (const i of items) {
    if (i.kind === 'tool') {
      if (!runs.has(i.agent)) runs.set(i.agent, { agent: i.agent, name: i.name, steps: [] });
      runs.get(i.agent).steps.push(i);
      continue;
    }
    endRun(i.kind === 'peer' ? chSpeaker(i) : i.agent);
    entries.push({ at: i.at, item: i });
  }
  for (const [id, run] of runs) entries.push({ at: run.steps.at(-1).at, run, live: agents.get(id)?.state === 'working' });
  entries.sort((x, y) => x.at - y.at);
  const look = chats.look, firstNew = look ? entries.find(e => !e.ask && e.at > look) : null;
  let html = `<div class="ch-line faint">${chats.truncated ? 'Older messages not shown: they are' : 'Older messages are'} in each agent's ⤢ Read all</div>`, said = 0;
  for (const e of entries) {
    if (e === firstNew) html += `<div class="ch-new" id="chats-new">new since you last looked · ${esc(convoWhen(look))}</div>`;
    if (e.run) html += chatsRunHtml(e.run, e.live, agents.get(e.run.agent));
    else {
      html += chatsItemHtml(e.item, taken(e.item));
      if (chSaid(e.item)) said++;
    }
  }
  if (!entries.length) html += `<div class="empty">${chatsPicked.size ? 'Nothing from the agents picked.' : 'Nothing has been said yet.'}</div>`;
  if (chats.error && chats.items.length) html += `<div class="ch-line">Couldn't read what is new: ${esc(chats.error)} <button type="button" class="act mini" data-chats-retry>Try again</button></div>`;
  return { html, said, fresh: Boolean(firstNew) };
}

/** Draws it: the line under its title, the chips, and the timeline (rewritten only when it changed, keeping your place). */
function drawChats() {
  if (!chats || !$('chats').open) return;
  $('chats-sub').textContent = chatsSubText();
  $('chats-chips').innerHTML = chatsChipsHtml();
  const body = $('chats-body'), view = chatsView();
  if (view.html !== chats.html) {
    const follow = chats.first || chNearBottom(body), top = body.scrollTop;
    body.innerHTML = view.html;
    chats.html = view.html;
    if (chats.first && !chats.loading) { // just read: at the "new" line, or the newest
      chats.first = false;
      if (view.fresh) document.getElementById('chats-new')?.scrollIntoView?.({ block: 'start' });
      else body.scrollTop = body.scrollHeight;
    } else if (follow) body.scrollTop = body.scrollHeight;
    else {
      body.scrollTop = top; // you are reading further up: you stay there
      if (!chats.rebase) chats.unseen += Math.max(0, view.said - chats.shown);
    }
    chats.shown = view.said;
    chats.rebase = false;
  }
  $('chats-down').hidden = !chats.unseen;
  $('chats-down').textContent = `↓ ${chats.unseen} new`;
}

/** On each render (app.js): redrawn while open. */
function renderChats() {
  if (!chats || !$('chats').open) return;
  drawChats();
}

function chatsScrolled() {
  if (chats?.unseen && chNearBottom($('chats-body'))) { chats.unseen = 0; $('chats-down').hidden = true; }
}

document.addEventListener('click', e => {
  const el = e.target?.closest?.('button');
  if (!el) return;
  const d = el.dataset ?? {};
  if (el.id === 'chats-open') { void openChats(); return; }
  if (!chats) return;
  if (d.chatsClose !== undefined) { closeChats(); return; }
  if (d.chatsChip !== undefined || d.chatsNeeds !== undefined) {
    if (d.chatsNeeds !== undefined) { chatsPicked.clear(); for (const a of snap?.agents ?? []) if (needsYou(a)) chatsPicked.add(a.id); }
    else if (d.chatsChip === '') chatsPicked.clear();
    else if (chatsPicked.has(d.chatsChip)) chatsPicked.delete(d.chatsChip);
    else chatsPicked.add(d.chatsChip);
    chats.rebase = true;
    drawChats();
    return;
  }
  if (d.chatsRun || d.chatsLong) {
    const open = d.chatsRun ? chatsOpenRuns : chatsOpenLong, key = d.chatsRun || d.chatsLong;
    if (open.has(key)) open.delete(key); else open.add(key);
    chats.rebase = true;
    drawChats();
    return;
  }
  if (d.chatsRetry !== undefined) { void chatsRetry(); return; }
  if (el.id === 'chats-down') {
    const body = $('chats-body');
    body.scrollTop = body.scrollHeight;
    chats.unseen = 0;
    drawChats();
  }
});
$('chats')?.addEventListener?.('close', () => { if (chats && !$('chats').open) closeChats(); }); // Esc
$('chats')?.addEventListener?.('click', e => { if (e.target === $('chats')) closeChats(); }); // the backdrop
$('chats-body')?.addEventListener?.('scroll', chatsScrolled);
window.addEventListener?.('pagehide', chatsSaveLook); // the tab shut with it open: what you saw still counts
