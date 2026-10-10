// The farm's sidebar. On top: who you are looking at (a picker for any agent, ‹ › through them, the
// diary, hide), the other agents that need you (each a card you answer in place: Allow, Yes, an
// option), and this agent's own question. Then its tabs: Chat (what it is doing now, the conversation
// with the newest message at the bottom, and one box for a message, a side question or a note),
// Activity (filtered), Subagents and Files. The session's settings and actions are in its Session menu.
// app.js calls renderFarmSidebar from render(); the answer, message, note and session buttons reuse
// app.js's handlers, so this file handles only what is new here.

const fsSaved = key => { try { return localStorage.getItem(key); } catch { return null; } };
const fsSave = (key, value) => { try { localStorage.setItem(key, value); } catch { /* lasts this page only */ } };

let fsPop = null; // the open popover: 'switcher' (every agent) or 'session' (its settings), or none
let fsPopShown = null; // which popover's frame is drawn, so the picker's search box isn't redrawn while you type
let fsFind = ''; // what the picker's search box holds
let fsMode = 'message'; // what the box writes: a message, a side question (btw) or a note
let fsSteps = 'all'; // the Activity tab's filter
let fsChatKey = ''; // the agent and mode the chat last showed: a new one starts at its newest message
let fsLatest = ''; // what the chat's newest entry was: a new one scrolls to it, wherever you were
let fsPinned = true; // the chat sits at its newest message (you scrolling up lets go; back at the bottom holds again)
let fsQueueOpen = fsSaved('tracker-fs-queue') !== 'closed'; // the cards of the agents that need you
let fsShellsOpen = fsSaved('tracker-fs-shells') === 'open'; // the commands running, under Now

const FS_ICON = {
  down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4L6 8l4 4"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>',
  book: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4.5C6.5 3.5 4.5 3.3 2.5 3.5V12c2-.2 4 0 5.5 1 1.5-1 3.5-1.2 5.5-1V3.5c-2-.2-4 0-5.5 1z"/><path d="M8 4.5V13"/></svg>',
  hide: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M10 3v10"/></svg>',
  sliders: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5h6M12 5h1.5M2.5 11h1.5M7.5 11h6"/><circle cx="10.3" cy="5" r="1.6"/><circle cx="5.7" cy="11" r="1.6"/></svg>',
  search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13 13"/></svg>',
  back: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4"/></svg>',
};

/** An agent needs you while it waits on you (a question or a permission prompt) or ended its turn with a question. */
const needsYou = a => a.state === 'waiting' || Boolean(a.question);
const FS_GROUPS = [['needs', 'Needs you'], ['working', 'Working'], ['yourTurn', 'Your turn'], ['idle', 'Idle'], ['stale', 'Stale']];
const fsGroupOf = a => (needsYou(a) ? 'needs' : a.state);
/** Every agent in the picker's order: what needs you first (the longest waiting first), then working, your turn, idle and stale. */
function fsOrder() {
  const agents = snap?.agents ?? [];
  return FS_GROUPS.flatMap(([g]) => {
    const group = agents.filter(a => fsGroupOf(a) === g);
    return g === 'needs' ? group.sort((x, y) => (x.stateSince || 0) - (y.stateSince || 0)) : group;
  });
}
const fsColor = a => window.TrackerFarm?.colorOf?.(a.id) ?? colorOf(a.id);
/** How long since `ms`: ticking under a day (as the rest of the page), in days past one (a stale agent's 1419h51m reads as 59d). */
const fsSince = ms => (!ms ? '' : Date.now() - ms >= 86_400_000 ? `${Math.floor((Date.now() - ms) / 86_400_000)}d` : `<span data-since="${ms}"></span>`);
const fsRepo = a => (snap?.repos ?? []).find(r => r.agentIds?.includes(a.id));
const fsDiaryNoun = () => $('farm-diary-pane')?.getAttribute?.('aria-label') || 'Diary';

/** One line on an agent for the picker: what it asks, what it is doing, or what it last said. */
function fsBrief(a) {
  if (a.ask?.kind === 'question') return `Asks: ${a.ask.questions?.[0]?.question ?? ''}`;
  if (a.ask) return `Permission: ${a.ask.tool} ${a.ask.summary}`;
  if (a.state === 'waiting') return a.stateReason || 'Waiting on you';
  if (a.question) return `Asks: ${a.question}`;
  if (a.now) return `${a.now.tool} ${a.now.summary}`;
  if (a.state === 'working') return a.stateReason || 'Working';
  const said = String(a.lastReply ?? '').split('\n').find(l => l.trim())?.trim();
  return (a.state === 'yourTurn' && said) || short(a.cwd);
}

/* ---------- the top: who, the agents that need you, its own question ---------- */

function fsHeadHtml(a, order) {
  const at = order.findIndex(x => x.id === a.id);
  const branch = fsRepo(a)?.branch;
  const modeChip = a.mode === 'bypassPermissions' ? '<span class="chip c-crit" data-tip="Every tool runs without asking (--dangerously-skip-permissions)">⚠ Bypass permissions</span>'
    : a.mode === 'plan' ? '<span class="chip c-warn">Plan mode</span>' : '';
  const plainMode = a.mode && a.mode !== 'bypassPermissions' && a.mode !== 'plan' ? modeName(a.mode) : '';
  const meta = [short(a.cwd), branch ? `⎇ ${branch}` : '', modelOf(a) ? modelName(modelOf(a)) : '', a.effort ? `${a.effort} effort` : '', plainMode,
    a.kind === 'background' ? 'background' : a.kind === 'codex' ? 'Codex' : ''].filter(Boolean).join(' · ');
  const setting = a.setting && Date.now() - a.setting.at < 120_000
    ? `<div class="${a.setting.ok ? 'msg-ok' : 'msg-bad'} set-note" data-tip="${esc(a.setting.text)}">${a.setting.ok ? '✓' : '✗'} ${esc(a.setting.text ? a.setting.text.replace(/`/g, '').slice(0, 80) : `/${a.setting.command} ${a.setting.args}`)}</div>` : '';
  const noun = fsDiaryNoun();
  return `<div class="fs-top">
    <div class="fs-row">
      <button type="button" class="fs-switch" id="fs-switch" data-fs-pop="switcher" aria-haspopup="dialog" aria-expanded="${fsPop === 'switcher'}" data-tip="Every agent, to pick one (what needs you first)"><span class="swatch" style="background:${fsColor(a)}"></span><span class="fs-name">${esc(a.name)}</span><span class="fs-pos">${at + 1} of ${order.length}</span>${FS_ICON.down}</button>
      <span class="fs-steps"><button type="button" class="fs-icon" data-fs-step="-1" aria-label="Previous agent" data-tip="Previous agent">${FS_ICON.prev}</button><button type="button" class="fs-icon" data-fs-step="1" aria-label="Next agent" data-tip="Next agent">${FS_ICON.next}</button></span>
      <button type="button" class="fs-icon" id="fs-diary" aria-label="${esc(noun)}" data-tip="${esc(noun)}: what happened, newest first">${FS_ICON.book}</button>
      <button type="button" class="fs-icon" id="fs-hide" aria-label="Hide the sidebar" data-tip="Hide the sidebar">${FS_ICON.hide}</button>
    </div>
    <div class="fs-row fs-wrap"><span class="chip c-${a.state}">${STATE_CHIP[a.state] ?? esc(a.state)}${a.stateSince ? ` · ${fsSince(a.stateSince)}` : ''}</span>${modeChip}${acctTag(a)}${suggestBtn(a, snap?.helper)}${a.kind === 'codex' ? ''
      : `<button type="button" class="fs-session" id="fs-session" data-fs-pop="session" aria-haspopup="dialog" aria-expanded="${fsPop === 'session'}" data-tip="Model, effort, permissions, compact, end the session…">${FS_ICON.sliders}Session</button>`}</div>
    <div class="fs-meta" data-tip="${esc(meta)}">${esc(meta)}</div>${setting}${nameLineHtml(a)}
  </div>`;
}

/** The other agents that need you, longest waiting first: a line saying who, and a card each to answer in place. */
function fsQueueHtml(a) {
  const others = fsOrder().filter(x => x.id !== a.id && needsYou(x));
  if (!others.length) return '';
  const names = others.map(x => x.name), also = needsYou(a) ? 'also ' : '';
  const who = names.length === 1 ? `${names[0]} ${also}needs you` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} ${also}need you`;
  return `<div class="fs-queue" role="region" aria-label="Other agents that need you">
    <div class="fs-queue-row"><button type="button" class="fs-queue-toggle" data-fs-queue aria-expanded="${fsQueueOpen}" data-tip="${fsQueueOpen ? 'Fold the cards away' : 'Show a card for each, to answer it here'}"><span class="fs-badge">${others.length}</span><span class="fs-queue-label">${esc(who)}</span>${fsQueueOpen ? FS_ICON.down : FS_ICON.next}</button><button type="button" class="fs-next" data-pick-agent="${esc(others[0].id)}" data-tip="Open ${esc(others[0].name)}, waiting longest">Next ›</button></div>
    ${fsQueueOpen ? `<div class="fs-cards">${others.map(fsCardHtml).join('')}</div>` : ''}
  </div>`;
}

/**
 * One agent that needs you, answered without leaving the one you are on: Allow or Deny a command, pick
 * one of a question's options, Yes to a yes/no question. Longer answers (several questions, a reply in
 * your own words) open the agent. Its buttons are action controls, so the click guard holds them too.
 */
function fsCardHtml(x) {
  const id = esc(x.id), ask = x.ask;
  const where = fsRepo(x)?.name ?? short(x.cwd).split('/').pop();
  const head = `<div class="fs-card-head"><span class="swatch" style="background:${fsColor(x)}"></span><b>${esc(x.name)}</b><span class="faint">${esc(where)}${x.stateSince ? ` · ${fsSince(x.stateSince)}` : ''}</span><span class="grow"></span><button type="button" class="fs-open" data-pick-agent="${id}" data-tip="Open ${esc(x.name)} here">Open ›</button></div>`;
  const ids = `data-agent="${id}" data-tool="${esc(ask?.toolUseId ?? '')}"`;
  let body, kind = 'ask';
  if (ask?.kind === 'permission') {
    kind = 'perm';
    body = `<div class="fs-card-what mono"><b>${esc(ask.tool)}</b> ${esc(ask.summary)}</div><div class="fs-card-acts"><button type="button" class="act primary" data-permit="allow" ${ids}>Allow</button><button type="button" class="act" data-permit="deny" ${ids}>Deny</button><span class="faint fs-card-note">to its terminal in <b data-until="${ask.expiresAt}"></b></span></div>`;
  } else if (ask?.kind === 'always') {
    kind = 'perm';
    body = `<div class="fs-card-what">Allowed <b>${esc(ask.tool)}</b>: open it to pick how to keep allowing it.</div>`;
  } else if (ask?.kind === 'question') {
    const q = ask.questions?.[0], count = ask.questions?.length ?? 0;
    const inPlace = count === 1 && !q.multiSelect && q.options?.length > 0 && q.options.length <= 4;
    body = `<div class="fs-card-q">${esc(q?.question ?? x.stateReason)}${count > 1 ? ` <span class="faint">(${count} questions)</span>` : ''}</div><div class="fs-card-acts">${inPlace
      ? q.options.map(o => `<button type="button" class="act" data-fs-answer="${esc(o.label)}" ${ids}${o.description ? ` data-tip="${esc(o.description)}"` : ''}>${esc(o.label)}</button>`).join('')
      : `<button type="button" class="act" data-pick-agent="${id}">Answer…</button>`}</div>`;
  } else if (x.state === 'waiting') {
    kind = 'perm';
    body = `<div class="fs-card-what">${askLine(x)}</div><div class="faint fs-card-note">The dashboard can't answer this one: answer it in its terminal.</div>`;
  } else {
    const off = x.mod?.live ? '' : ` disabled data-tip="${esc(modWhy(x))}"`;
    body = `<div class="fs-card-q">${esc(x.question)}</div><div class="fs-card-acts">${YES_NO.test(x.question)
      ? `<button type="button" class="act primary" data-quick-reply="Yes." data-agent="${id}"${off}>Yes</button><button type="button" class="act" data-quick-draft="No, " data-agent="${id}"${off}>No…</button>`
      : `<button type="button" class="act" data-quick-draft="" data-agent="${id}"${off}>Reply…</button>`}</div>`;
  }
  return `<div class="fs-card ${kind}">${head}${body}</div>`;
}

/** This agent's own question or permission prompt, above the tabs so it shows on every tab. */
function fsAskHtml(a) {
  const html = askHtml(a) + questionHtml(a);
  return html ? `<div class="fs-ask">${html}</div>` : '';
}

/* ---------- Chat: now, the conversation, the box ---------- */

/** What it is doing now: its working line with ■ Stop, its step, and its commands (folded); or since when it rests. */
function fsNowHtml(a) {
  if (a.state === 'waiting' && !a.now) return '';
  const shells = a.shells ?? [];
  const working = workingLineHtml(a);
  const now = a.now ? `<div class="now mono"><span class="pulse"></span> ${esc(a.now.tool)} ${esc(a.now.summary)} · <b data-since="${a.now.startedAt}"></b></div>` : '';
  if (!working && !now && !shells.length) return a.stateReason || a.state !== 'working' ? `<div class="fs-rest">${restHtml(a)}</div>` : '';
  const cmds = shells.length
    ? `<button type="button" class="fs-cmds" data-fs-shells aria-expanded="${fsShellsOpen}">${fsShellsOpen ? FS_ICON.down : FS_ICON.next}${shells.length} command${shells.length === 1 ? '' : 's'} running</button>${fsShellsOpen ? shells.map(s => shellRowHtml(a, s)).join('') : ''}`
    : '';
  return `<div class="fs-now">${working}${now}${cmds}${jobsHtml(a)}</div>`;
}

/** The conversation as a chat: oldest at the top, the newest at the bottom by the box, after a Latest line. */
function fsChatHtml(a) {
  if (fsMode === 'btw') return fsAsidesHtml(a);
  if (fsMode === 'note') return fsNotesHtml(a);
  const said = saidOf(a, 12);
  if (!said.length) return '<div class="empty">No messages yet.</div>';
  const cut = latestCut(said), bubble = f => bubbleHtml(a, f);
  const top = a.kind === 'codex' ? '' : `<div class="fs-chat-top"><button type="button" class="act mini" data-convo="${esc(a.id)}" data-tip="The whole conversation, from its first message, with search">⤢ Read the whole conversation</button>${fullFeeds.has(a.id) ? `<button type="button" class="act mini" data-full-feed="${esc(a.id)}">Show less</button>` : ''}</div>`;
  return `${top}<div class="chat">${said.slice(cut).reverse().map(bubble).join('')}<div class="fs-latest" role="separator">Latest</div>${said.slice(0, cut).reverse().map(bubble).join('')}</div>`;
}

function fsAsidesHtml(a) {
  const list = (a.asides ?? []).map(asideItemHtml).join('');
  return `<div class="fs-intro">Side questions are answered from ${esc(a.name)}'s conversation so far, and aren't added to it. They work while it is busy.</div>${list || '<div class="empty">No side questions yet.</div>'}`;
}

function fsNotesHtml(a) {
  const got = notesCache.get(a.id), list = got?.notes ?? [];
  const status = got?.error ? `<div class="msg-bad">Could not read them: ${esc(got.error)}</div>`
    : !got ? '<div class="faint">Loading…</div>'
    : !list.length ? '<div class="empty">No notes yet. Write down what you may want to tell it later.</div>' : '';
  const clear = list.some(n => n.usedAt) ? ` <button type="button" class="act mini" data-notes-clear data-agent="${esc(a.id)}" data-tip="Remove the notes you have used">Clear used</button>` : '';
  return `<div class="fs-intro">Only you see notes. Nothing goes to ${esc(a.name)} until you use one, and they stay after the session ends.${clear}</div>${status}${list.length ? `<ul class="notes">${list.map(n => noteHtml(a, n, Boolean(a.mod?.live))).join('')}</ul>` : ''}`;
}

/** One box, three things it can write: a message (sent as yours), a side question (/btw) or a note for later. */
function fsComposeHtml(a) {
  if (a.kind === 'codex') return '';
  const modes = [['message', 'Message', 0], ['btw', 'Side question', (a.asides ?? []).length], ['note', 'Note', a.notes?.unused ?? 0]]
    .map(([m, label, n]) => `<button type="button" role="tab" aria-selected="${fsMode === m}" data-fs-mode="${m}">${label}${n ? `<span class="grp-n">${n}</span>` : ''}</button>`).join('');
  const keys = fsMode === 'message' ? '↩ send · ⇧↩ new line · ↑ earlier' : fsMode === 'btw' ? '↩ asks · ⇧↩ new line' : '↩ adds · ⇧↩ new line';
  const id = esc(a.id), live = modCan(a);
  const box = fsMode === 'btw'
    ? `<div class="compose"><textarea id="aside-text" data-aside-agent="${id}" rows="2" placeholder="${live ? `Ask ${esc(a.name)} something on the side…` : esc(modWhy(a))}"${live ? '' : ' disabled'}>${esc(asideDrafts.get(a.id) ?? '')}</textarea><div class="compose-row"><span class="faint">Not added to its conversation</span><span class="grow"></span><button type="button" class="act primary" id="aside-send" data-agent="${id}"${live ? '' : ' disabled'}>Ask</button></div></div>`
    : fsMode === 'note'
      ? `<div class="compose"><textarea id="note-text" data-note-agent="${id}" rows="2" placeholder="A note for later…">${esc(noteDrafts.get(a.id) ?? '')}</textarea><div class="compose-row"><span class="faint">Only you see notes</span><span class="grow"></span><button type="button" class="act primary" id="note-add" data-agent="${id}">Add note</button></div></div>`
      : composeHtml(a, 'msg', { short: true });
  return `<div class="fs-modes-row"><div class="seg fs-modes" role="tablist" aria-label="What you are writing">${modes}</div><span class="grow"></span><span class="fs-keys">${keys}</span></div>${box}`;
}

/* ---------- Activity, with a filter ---------- */

const STEP_FILTERS = [['all', 'All'], ['cmd', 'Commands', /^(Bash|BashOutput|KillShell|Monitor|PowerShell)$/], ['edit', 'Edits', /^(Edit|Write|MultiEdit|NotebookEdit)$/], ['read', 'Reads', /^(Read|Grep|Glob|LS|NotebookRead)$/], ['fail', 'Failed']];
const stepMatches = (key, f) => (key === 'all' ? true : key === 'fail' ? f.ok === false : STEP_FILTERS.find(([k]) => k === key)?.[2]?.test(f.tool ?? '') ?? true);

function fsActivityHtml(a) {
  const all = fullFeeds.has(a.id);
  const steps = feedOf(a).filter(f => f.kind === 'tool');
  const chips = STEP_FILTERS.map(([k, label]) => `<button type="button" class="fs-chip" data-fs-steps="${k}" aria-pressed="${fsSteps === k}">${label}<span class="grp-n">${steps.filter(f => stepMatches(k, f)).length}</span></button>`).join('');
  const shown = steps.filter(f => stepMatches(fsSteps, f)).slice(0, all ? Infinity : 40);
  const links = a.kind === 'codex' ? '' : `<span class="grow"></span><button type="button" class="act mini" data-full-feed="${esc(a.id)}">${all ? 'Show less' : 'Show all'}</button><a class="act mini" href="/agent/${encodeURIComponent(a.id)}/transcript" target="_blank" rel="noopener">Full transcript ↗</a>`;
  return `<div class="sec" style="margin-top:0">Activity${all ? ` · ${steps.length} steps` : ''}${links}</div><div class="fs-chips" role="group" aria-label="Show">${chips}</div>
    <div class="feed">${shown.map(feedRow).join('') || `<div class="empty">${fsSteps === 'all' ? 'No tool steps yet.' : 'No steps like that.'}</div>`}</div>`;
}

/* ---------- the popovers: every agent, and the session's settings ---------- */

function fsSwitcherFrame() {
  return `<div class="fs-pop" role="dialog" aria-label="Agents"><label class="fs-find">${FS_ICON.search}<input type="text" id="fs-find" placeholder="Find an agent, folder or branch…" aria-label="Find an agent" autocomplete="off" spellcheck="false" value="${esc(fsFind)}"></label><div id="fs-find-list"></div><div class="fs-pop-foot">↑ ↓ move · ↩ open · Esc close</div></div>`;
}
function fsSwitcherList(cur) {
  const q = fsFind.trim().toLowerCase();
  const found = fsOrder().filter(a => !q || [a.name, short(a.cwd), fsRepo(a)?.branch ?? ''].some(s => String(s).toLowerCase().includes(q)));
  return FS_GROUPS.map(([g, title]) => {
    const group = found.filter(a => fsGroupOf(a) === g);
    if (!group.length) return '';
    return `<div class="fs-grp fs-grp-${g}">${title}<span class="grp-n">${group.length}</span></div>${group.map(a => `<button type="button" class="fs-pick" data-pick-agent="${esc(a.id)}" aria-current="${a.id === cur?.id}"><span class="swatch" style="background:${fsColor(a)}"></span><span class="fs-pick-main"><b>${esc(a.name)}</b><span>${esc(fsBrief(a))}</span></span><span class="fs-pick-since">${fsSince(a.stateSince)}</span></button>`).join('')}`;
  }).join('') || '<div class="empty">No agent matches.</div>';
}

/** The Session menu: model, effort and permissions as a form, then its actions, with End session apart. */
function fsSessionHtml(a) {
  const id = esc(a.id), running = a.kind === 'interactive' && Boolean(a.pid);
  const live = modCan(a), off = live ? '' : ' disabled';
  const models = MODELS.map(([m, label]) => `<option value="${esc(m)}">${esc(label)}</option>`).join('');
  const efforts = EFFORTS.map(e => `<option value="${e}"${e === a.effort ? ' disabled' : ''}>${e}${e === a.effort ? ' (now)' : ''}</option>`).join('');
  const modes = MODES.map(([m, label]) => `<option value="${m}"${m === a.mode ? ' disabled' : ''}>${esc(label)}${m === a.mode ? ' (now)' : ''}</option>`).join('')
    + (accountsOn() ? `<optgroup label="Move to another account">${snap.accounts.filter(x => x.key !== a.account).map(x => `<option value="account:${esc(x.key)}">${esc(acctChoice(x))}</option>`).join('')}</optgroup>` : '');
  const form = running ? `<div class="fs-form">
      <label for="fs-model">Model</label><select id="fs-model" data-switch-model data-agent="${id}"${off}><option value="">${esc(modelOf(a) ? modelName(modelOf(a)) : 'Not known yet')} (now)</option>${models}</select>
      <label for="fs-effort">Effort</label><select id="fs-effort" data-switch-effort data-agent="${id}"${off}><option value="">${esc(a.effort ?? 'its default')} (now)</option>${efforts}</select>
      <span class="fs-hint">${live ? 'Both switch after its current turn, as /model and /effort do.' : esc(modWhy(a))}</span>
      <label for="fs-mode">Permissions</label><select id="fs-mode" data-restart-mode data-agent="${id}"><option value="">${esc(a.mode ? modeName(a.mode) : 'Not known yet')} (now)</option>${modes}</select>
      <span class="fs-hint">Another mode${accountsOn() ? ' or account' : ''} restarts it there, in a new terminal window.</span>
    </div><div class="fs-sep"></div>` : '';
  const resume = a.kind === 'codex' ? '' : `cd ${shellQuote(a.cwd)} && claude --resume ${a.id}`;
  const answers = a.kind === 'codex' ? '' : a.mod?.live
    ? '<div class="fs-mod msg-ok">📡 Dashboard answers on</div>'
    : `<div class="fs-mod faint" data-tip="${esc(modWhy(a))}">Dashboard answers off: send it anything in its terminal once</div>`;
  const items = [
    running ? `<button type="button" class="act fs-item" data-compact="${id}"${modCan(a, '0.6.0') ? '' : ` disabled data-tip="${esc(!a.mod?.live ? modWhy(a) : `Compacting from here needs tracker mod 0.6.0: run /reload-plugins in it`)}"`}><b>Compact the conversation…</b><span>The conversation so far becomes a summary, freeing context</span></button>` : '',
    a.kind === 'background' && a.cliId ? '<button type="button" class="act fs-item" id="act-open"><b>Open the session</b></button>' : '',
    resume ? `<button type="button" class="act fs-item" id="act-copy" data-text="${esc(resume)}"><b>Copy the resume command</b></button>` : '',
    a.kind === 'codex' ? '' : `<a class="fs-item" href="/agent/${encodeURIComponent(a.id)}/transcript" target="_blank" rel="noopener"><b>Open the full transcript ↗</b></a>`,
    '<button type="button" class="act fs-item" id="fs-list"><b>Show it in the list view</b></button>',
  ].join('');
  const end = running ? `<div class="fs-sep"></div><button type="button" class="act fs-item danger" data-end-session="${id}"><b>End session…</b><span>Claude stops and its terminal window closes. Resume it later from ＋ Session.</span></button>`
    : a.kind === 'background' && a.state === 'stale' && a.cliId ? `<div class="fs-sep"></div><button type="button" class="act fs-item danger" data-remove-session="${id}"><b>Remove…</b><span>Deletes this background session and its conversation (claude rm)</span></button>` : '';
  return `<div class="fs-pop fs-menu" role="dialog" aria-label="Session settings"><div class="fs-pop-title"><b>Session</b><span class="faint">${esc(a.name)}</span></div>${form}${items}${answers}${end}</div>`;
}

function fsRenderPop(a) {
  const pop = $('fs-pop');
  if (!fsPop || !a) {
    if (pop.innerHTML) pop.innerHTML = '';
    fsPopShown = null;
    return;
  }
  if (fsPop === 'switcher') {
    if (fsPopShown !== 'switcher') {
      pop.innerHTML = fsSwitcherFrame();
      fsPopShown = 'switcher';
      setTimeout(() => $('fs-find')?.focus?.(), 0);
    }
    $('fs-find-list').innerHTML = fsSwitcherList(a);
  } else {
    pop.innerHTML = fsSessionHtml(a);
    fsPopShown = 'session';
  }
  // under the button that opened it (the header grows with a name offer or a setting's result)
  const button = $(fsPop === 'switcher' ? 'fs-switch' : 'fs-session'), top = (button?.offsetTop ?? NaN) + (button?.offsetHeight ?? NaN);
  if (Number.isFinite(top) && pop.firstElementChild?.style) pop.firstElementChild.style.top = `${top + 6}px`;
}
function fsClosePop() {
  fsPop = null;
  fsPopShown = null;
  if ($('fs-pop')) $('fs-pop').innerHTML = '';
}

/* ---------- drawing it ---------- */

/** The sidebar for `a` (the agent picked, or the default one), on the tab you are on. */
function renderFarmSidebar(a) {
  $('tab-subagents').innerHTML = subTabLabel(subagentsOf(a));
  if (!a) {
    clearFarmSidebar();
    $('fs-head').innerHTML = `<div class="fs-top"><div class="fs-row"><b class="fs-name">No agents</b><button type="button" class="fs-icon" id="fs-hide" aria-label="Hide the sidebar" data-tip="Hide the sidebar">${FS_ICON.hide}</button></div></div>`;
    $('farm-agent').innerHTML = '<div class="empty">No agents are running.</div>';
    return;
  }
  $('fs-head').innerHTML = fsHeadHtml(a, fsOrder()) + fsQueueHtml(a) + fsAskHtml(a);
  if (farmTab === 'agent') {
    refreshNotes(a, fsMode === 'note');
    $('fs-now').innerHTML = fsNowHtml(a);
    // Always at the newest message: when it opens, for another agent or mode, and whenever a new one
    // comes, even if you had scrolled up to read. Scrolled up with nothing new, it stays where you are.
    const key = `${a.id}|${fsMode}`, latest = fsLatestOf(a);
    $('farm-agent').innerHTML = fsChatHtml(a);
    if (key !== fsChatKey || latest !== fsLatest || fsPinned) fsToNewest();
    fsChatKey = key;
    fsLatest = latest;
    $('fs-compose').innerHTML = fsComposeHtml(a);
  } else {
    for (const id of ['fs-now', 'farm-agent', 'fs-compose']) $(id).innerHTML = ''; // one message box at a time, and only where it shows
    fsChatKey = '';
  }
  if (farmTab === 'activity') $('farm-activity').innerHTML = fsActivityHtml(a);
  if (farmTab === 'subagents') $('farm-subagents').innerHTML = subagentsHtml(a);
  if (farmTab === 'files') syncExplorer();
  if (farmTab === 'diary') $('diary-back').innerHTML = `${FS_ICON.back}Back to ${esc(a.name)}`;
  fsRenderPop(a);
}

/** What the chat's newest entry is, in the mode it shows: a message, a side question (or its answer), a note. */
function fsLatestOf(a) {
  if (fsMode === 'btw') return (a.asides ?? []).map(x => `${x.question}|${x.pending ? '…' : x.answer ? 'a' : 'x'}`).join('\n');
  if (fsMode === 'note') { const got = notesCache.get(a.id); return `${got?.rev ?? ''}|${got?.notes?.length ?? ''}`; }
  const f = saidOf(a, 1)[0];
  return f ? `${f.at}|${f.kind}|${String(f.body ?? f.text ?? '').length}` : '';
}
/** Scrolls the chat to its newest message, and keeps it there as pictures in it load. */
function fsToNewest() {
  const box = $('fs-chat');
  box.scrollTop = box.scrollHeight ?? 0;
  fsPinned = true;
}
// You scrolling up lets go of the newest message; back near the bottom, the chat holds it again.
$('fs-chat')?.addEventListener?.('scroll', () => { const b = $('fs-chat'); fsPinned = b.scrollHeight - b.scrollTop - b.clientHeight < 60; }, { passive: true });
// A picture (a screenshot a reply names) or a long message drawn after the scroll grows the chat: held at the newest, it follows.
if (typeof ResizeObserver === 'function' && $('farm-agent')) new ResizeObserver(() => { if (fsPinned) $('fs-chat').scrollTop = $('fs-chat').scrollHeight; }).observe($('farm-agent'));

/** Empties what the sidebar drew, so the list view's centre is the only place with its ids (msg-text, ask-send…). */
function clearFarmSidebar() {
  for (const id of ['fs-head', 'fs-now', 'farm-agent', 'fs-compose', 'farm-activity', 'farm-subagents']) $(id).innerHTML = '';
  fsClosePop();
  fsChatKey = '';
  fsLatest = '';
}

/** Shows another agent in the sidebar (your own click: the picker, ‹ ›, a card's Open). */
function fsPick(id) {
  if (!snap?.agents.some(a => a.id === id)) return;
  if (selected !== id) openChildren.clear();
  selected = id;
  fsClosePop();
  if (farmTab === 'diary') { farmTab = farmTabBefore; save('tracker-farm-tab', farmTab); }
  applyFarmSide();
  render();
}

async function fsPermit(button) {
  const d = button.dataset, decision = d.permit === 'deny' ? 'deny' : 'allow';
  const a = snap?.agents.find(x => x.id === d.agent);
  if (a?.ask?.kind !== 'permission' || a.ask.toolUseId !== d.tool) { notice('That request is no longer waiting.'); return; }
  button.disabled = true;
  button.textContent = decision === 'allow' ? 'Allowing…' : 'Denying…';
  const r = await post('/api/actions/permit', { agentId: a.id, toolUseId: d.tool, decision });
  notice(r.ok ? `${decision === 'allow' ? 'Allowed' : 'Denied'} for ${a.name}.` : `Could not send: ${r.error}`);
}

async function fsAnswer(button) {
  const d = button.dataset, a = snap?.agents.find(x => x.id === d.agent), q = a?.ask?.questions?.[0];
  if (a?.ask?.kind !== 'question' || a.ask.toolUseId !== d.tool || !q) { notice('That question is no longer waiting.'); return; }
  button.disabled = true;
  const r = await post('/api/actions/answer', { agentId: a.id, toolUseId: d.tool, answers: { [q.question]: d.fsAnswer } });
  if (r.ok) drafts.delete(d.tool);
  notice(r.ok ? `Answer sent to ${a.name}: ${d.fsAnswer}.` : `Could not send: ${r.error}`);
}

/* ---------- its clicks, keys and typing (this runs before app.js's handlers, which do the rest) ---------- */

document.addEventListener('click', async e => {
  if (view !== 'farm') return;
  const inPop = e.target?.closest?.('#fs-pop'), el = e.target?.closest?.('button');
  if (fsPop && !inPop && !el?.dataset?.fsPop) { fsClosePop(); if (!el) render(); } // a click outside the popover closes it
  if (!el) return;
  const d = el.dataset ?? {};
  if (d.fsPop) {
    fsPop = fsPop === d.fsPop ? null : d.fsPop;
    if (fsPop !== 'switcher') fsPopShown = null;
    render();
    return;
  }
  if (d.fsStep !== undefined) {
    const order = fsOrder(), at = order.findIndex(a => a.id === selected);
    if (order.length) fsPick(order[(at + Number(d.fsStep) + order.length) % order.length].id);
    return;
  }
  if (d.pickAgent) { fsPick(d.pickAgent); return; }
  if (el.id === 'fs-diary') { fsClosePop(); setFarmTab('diary'); return; }
  if (el.id === 'diary-back') { setFarmTab(farmTabBefore); return; }
  if (el.id === 'fs-hide') { setFarmSide(false); return; }
  if (d.fsQueue !== undefined) { fsQueueOpen = !fsQueueOpen; fsSave('tracker-fs-queue', fsQueueOpen ? 'open' : 'closed'); render(); return; }
  if (d.fsShells !== undefined) { fsShellsOpen = !fsShellsOpen; fsSave('tracker-fs-shells', fsShellsOpen ? 'open' : 'closed'); render(); return; }
  if (d.fsMode) {
    fsMode = d.fsMode;
    render();
    $(fsMode === 'btw' ? 'aside-text' : fsMode === 'note' ? 'note-text' : 'msg-text')?.focus?.();
    return;
  }
  if (d.fsSteps) { fsSteps = d.fsSteps; render(); return; }
  if (d.permit) { await fsPermit(el); return; }
  if (d.fsAnswer !== undefined) { await fsAnswer(el); return; }
  // These go on to app.js: a reply started for another agent opens that agent first, and a note
  // put to use goes to the message box, so the box is a message box again.
  if ((d.quickDraft !== undefined || d.quote !== undefined) && d.agent) {
    fsMode = 'message';
    if (d.agent !== selected && snap?.agents.some(a => a.id === d.agent)) {
      openChildren.clear();
      selected = d.agent;
      if (farmTab !== 'agent') { farmTab = 'agent'; applyFarmSide(); }
    }
    return;
  }
  if (d.noteUse) { fsMode = 'message'; return; }
  if (inPop && (d.compact || d.endSession || d.removeSession || el.id === 'act-copy' || el.id === 'act-open' || el.id === 'fs-list')) fsClosePop(); // the menu has done its job
});

document.addEventListener('change', e => {
  if (view === 'farm' && e.target?.closest?.('#fs-pop')) fsClosePop(); // a pick in the Session menu: its confirm comes next
});

document.addEventListener('input', e => {
  if (e.target?.id !== 'fs-find') return;
  fsFind = e.target.value;
  const a = centreAgent();
  if (a) $('fs-find-list').innerHTML = fsSwitcherList(a);
});

document.addEventListener('keydown', e => {
  if (view !== 'farm' || !fsPop) return;
  if (e.key === 'Escape') {
    e.preventDefault?.();
    const back = fsPop === 'switcher' ? 'fs-switch' : 'fs-session';
    fsClosePop();
    render();
    $(back)?.focus?.();
    return;
  }
  if (fsPop !== 'switcher') return;
  const items = [...($('fs-find-list')?.querySelectorAll?.('.fs-pick') ?? [])];
  if (e.key === 'Enter' && e.target?.id === 'fs-find') {
    e.preventDefault?.();
    if (items[0]) fsPick(items[0].dataset.pickAgent);
    return;
  }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
    e.preventDefault?.();
    const at = items.indexOf(document.activeElement);
    const to = e.key === 'ArrowDown' ? Math.min(at + 1, items.length - 1) : at - 1;
    if (to < 0) $('fs-find')?.focus?.();
    else items[to].focus?.();
  }
});
