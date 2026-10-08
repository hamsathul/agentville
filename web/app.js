// The agent overview, rendering, the two views (list and farm with its sidebar), and the
// page's events: clicks, typing, pasting and dropping files, the theme, start-up.
function overviewHtml(a) {
  const color = colorOf(a.id);
  const h = a.proc?.history;
  const charts = h ? `<div class="charts">${lineChart('CPU', h.at, h.cpu, color, v => `${Math.round(v)}%`)}${lineChart('Memory', h.at, h.rssMb, color, v => gb(v))}</div>
    <details class="data"><summary>Table view</summary><table><tr><th>Time</th><th>CPU</th><th>Memory</th></tr>${h.at.slice(-10).map((t, i, arr) => {
      const j = h.at.length - arr.length + i;
      return `<tr><td>${clock(t)}</td><td>${Math.round(h.cpu[j])}%</td><td>${gb(h.rssMb[j])}</td></tr>`;
    }).join('')}</table></details>` : '';
  const children = a.children.length ? a.children.map(c => {
    const isOpen = openChildren.has(c.id);
    const feed = isOpen ? `<div class="feed">${(openChildren.get(c.id) ?? []).map(feedRow).join('') || '<div class="empty">No activity.</div>'}</div>` : '';
    return `<div class="child"><button class="act" data-child="${esc(c.id)}">${isOpen ? '▾' : '▸'}</button><b>${esc(c.kind)}</b> ${esc(c.label)} <span class="chip ${c.state === 'running' ? 'c-working live-dot' : 'c-plain'}">${esc(c.state)}${c.now ? ` · ${esc(c.now.tool)}` : ''}</span>${feed}</div>`;
  }).join('') : '<div class="empty">None.</div>';
  const touching = a.touching.length
    ? `<div class="badges">${a.touching.slice(0, 12).map(t => `<span class="chip ${t.mode === 'read' ? 'c-plain' : t.mode === 'git' ? 'c-serious' : 'c-warn'}" data-tip="${esc(t.path)}">${esc(short(t.repo ?? t.path))} · ${esc(t.mode)}</span>`).join('')}</div>`
    : '<div class="empty">Nothing in the last 30 minutes.</div>';
  const proc = a.proc
    ? `CPU <b>${Math.round(a.proc.cpu)}%</b> · RAM <b>${gb(a.proc.rssMb)}</b> · ${a.proc.childCount} child process${a.proc.childCount === 1 ? '' : 'es'}${a.proc.children.length ? ` <span class="muted">(${esc(a.proc.children.join(', '))})</span>` : ''}`
    : '<span class="muted">No process found.</span>';
  const resume = a.kind === 'codex' ? '' : `cd ${shellQuote(a.cwd)} && claude --resume ${a.id}`;
  return `<div class="ov"><div class="head"><span class="swatch" style="background:${color}"></span><span class="name">${esc(a.name)}</span><span class="chip c-${a.state}">${STATE_CHIP[a.state] ?? esc(a.state)} · <span data-since="${a.stateSince}"></span></span></div>
    ${askHtml(a)}
    <div class="muted where" style="margin-top:6px">${esc(short(a.cwd))} · ${esc(a.kind)}${modelOf(a) ? ` · ${esc(modelOf(a))}` : ''}
      ${a.kind === 'codex' ? '' : a.mod?.live
        ? ' <span class="chip c-good" data-tip="This session can be answered from the dashboard">📡 dashboard answers on</span>'
        : ' <span class="chip c-plain" data-tip="The Agentville mod in this session isn\'t listening. It starts with the next message you send the session, or with a new session.">dashboard answers off</span>'}</div>
    ${sessionBarHtml(a)}
    ${a.state === 'stale' ? '' : `<div style="margin-top:8px">${metricsHtml(a)}</div>`}
    <div class="sec">Now</div>${workingLineHtml(a)}${a.now ? `<div class="now mono"><span class="pulse"></span> ${esc(a.now.tool)} ${esc(a.now.summary)} · <b data-since="${a.now.startedAt}"></b></div>` : a.turn ? '' : `<div class="muted">${esc(a.stateReason)}</div>`}
    ${questionHtml(a)}
    ${composeHtml(a)}
    ${asideHtml(a)}
    ${conversationHtml(a)}
    ${activityHtml(a)}
    ${docsHtml(a)}
    ${charts ? `<div class="sec">Last 10 minutes</div>${charts}` : ''}
    ${a.kind === 'codex' ? '' : `<div class="sec">Tool calls · last 30 minutes</div>${timelineChart(a.timeline)}`}
    <div class="sec">Subagents &amp; background jobs</div>${children}
    <div class="sec">Touching</div>${touching}
    <div class="sec">Process</div><div>${proc}</div>
    <div class="sec">Actions</div>
    ${a.kind === 'background' && a.cliId ? '<button class="act" id="act-open">Open session</button>' : ''}
    ${resume ? `<button class="act" id="act-copy" data-text="${esc(resume)}">Copy resume command</button>` : ''}
    ${a.kind === 'codex' ? '' : `<a class="act" href="/agent/${encodeURIComponent(a.id)}/transcript" target="_blank" rel="noopener">Full transcript</a>`}</div>`;
}

function render() {
  if (!snap) return;
  syncSlots(snap.agents);
  $('kpis').innerHTML = kpisHtml();
  $('errors').innerHTML = Object.entries(snap.sources).filter(([, s]) => !s.ok)
    .map(([n, s]) => `<span class="pill p-err" title="${esc(s.error)}">${esc(n)}: ${esc(String(s.error).slice(0, 40))}</span>`).join(' ');
  $('hstats').innerHTML = hstatsHtml();
  const needs = snap.counts.waiting + snap.agents.filter(a => a.question).length; // waiting, or asked something
  document.title = needs ? `(${needs}) Agentville` : 'Agentville';
  window.Agentville?.favicon(needs > 0); // a red light on the tab's farmhouse while an agent waits
  refreshFullFeeds();
  void followConversation(); // the conversation dialog, if open, takes the new messages
  renderConvoCompose(); // and its message box
  if (view === 'farm') {
    // The farm draws the agents; the list and the centre are not drawn (so their ids don't exist twice).
    // The sidebar shows the selected farmer: its answer form, message box and activity, then its files.
    window.TrackerFarm?.update(snap);
    const a = farmSide ? centreAgent() : null;
    window.TrackerFarm?.select?.(a?.id ?? null);
    if (farmSide && farmTab === 'agent') $('farm-agent').innerHTML = a ? farmSideHtml(a) : '<div class="empty">No agents are running.</div>';
    if (farmSide && farmTab === 'activity') $('farm-activity').innerHTML = a ? activityHtml(a) : '<div class="empty">No agents are running.</div>';
    if (farmSide && farmTab === 'files') syncExplorer();
    updateTimers();
    return;
  }
  centreAgent(); // settle the default before the rows mark the selected one
  $('list').innerHTML = listHtml();
  $('rail').innerHTML = railHtml();
  renderCentre();
  syncExplorer();
  updateTimers();
}

/* ---------- the whole history (Show all) ---------- */

async function loadFullFeed(id) {
  const prev = fullFeeds.get(id);
  try {
    const r = await fetch(`/api/agent/${encodeURIComponent(id)}/feed?limit=200`);
    const items = r.ok ? await r.json() : prev?.items ?? [];
    fullFeeds.set(id, { items, at: Date.now(), activity: snap?.agents.find(a => a.id === id)?.lastActivityAt });
  } catch {
    if (!prev) fullFeeds.set(id, { items: [], at: Date.now() });
  }
}
async function toggleFullFeed(id) {
  if (fullFeeds.has(id)) fullFeeds.delete(id);
  else await loadFullFeed(id);
  render();
}
/** While Show all is on, the history follows the agent: reloaded when it has done something, at most every 3 s. */
function refreshFullFeeds() {
  for (const [id, f] of fullFeeds) {
    const a = snap.agents.find(x => x.id === id);
    if (!a) { fullFeeds.delete(id); continue; }
    if (a.lastActivityAt !== f.activity && Date.now() - f.at > 3000 && !f.loading) {
      f.loading = true;
      void loadFullFeed(id).then(() => requestRender());
    }
  }
}

/* ---------- two views: the list (default) and the pixel farm ---------- */

let view = loadView();
let farmSide = loadSaved('tracker-farm-side') === 'open'; // the farm's sidebar: answer, message, activity, files
const FARM_TABS = ['agent', 'activity', 'files', 'diary'];
let farmTab = FARM_TABS.includes(loadSaved('tracker-farm-tab')) ? loadSaved('tracker-farm-tab') : 'agent';
function loadSaved(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* lasts this page only */ }
}
function loadView() {
  return loadSaved('tracker-view') === 'farm' ? 'farm' : 'list';
}
function setView(next, { remember = true } = {}) {
  if (next === 'farm' && !window.TrackerFarm) {
    notice('The farm view could not load.');
    next = 'list';
    remember = false;
  }
  if (view === 'farm' && next === 'list') window.TrackerFarm?.unmount();
  view = next;
  if (remember) save('tracker-view', next);
  $('main').dataset.view = next;
  document.documentElement.dataset.view = next; // the farm fills the window: the top bar and count cards go into it
  $('view-list').setAttribute('aria-pressed', next === 'list');
  $('view-farm').setAttribute('aria-pressed', next === 'farm');
  $('side-toggle').hidden = next !== 'farm';
  applyFarmSide();
  // Only one of the centre and the farm sidebar holds the agent's answer and message boxes at a time.
  if (next === 'farm') {
    $('center-tabs').innerHTML = '';
    $('center-body').innerHTML = '';
    reader = null;
    window.TrackerFarm.mount($('farm'), {
      token: TOKEN, diary: $('farm-diary'), onPickAgent: pickFromFarm, onOpenDoc: openDocFromFarm, onShowRepos: showReposFromFarm, onStartSession: () => $('sessions-open').click(), onBell: bellSwitched,
      // the top bar's buttons, on the farm
      onNav: what => ({ list: () => setView('list'), session: () => $('sessions-open').click(), side: () => setFarmSide(!farmSide), theme: () => $('theme-toggle').click() })[what]?.(),
      navState: () => ({ theme, side: farmSide, live: !$('live').classList.contains('off') }),
    });
  } else {
    $('farm-agent').innerHTML = '';
  }
  shownKey = ''; // the centre is drawn afresh when the list comes back
  render();
}
function applyFarmSide() {
  $('main').dataset.side = farmSide ? 'open' : 'closed';
  $('main').dataset.sideTab = farmTab;
  $('side-toggle').setAttribute('aria-pressed', farmSide);
  for (const tab of FARM_TABS) $(`tab-${tab}`).setAttribute('aria-selected', tab === farmTab);
  if (!farmSide) $('farm-agent').innerHTML = '';
}
/** The sidebar's tabs: the selected farmer (answer, message, conversation, activity), its files, the diary. */
function setFarmTab(tab) {
  farmTab = FARM_TABS.includes(tab) ? tab : 'agent';
  save('tracker-farm-tab', farmTab);
  applyFarmSide();
  render();
}
function setFarmSide(open) {
  farmSide = open;
  save('tracker-farm-side', open ? 'open' : 'closed');
  applyFarmSide();
  render();
}

/** The farm sidebar for one agent: what it asks, a message box, what it is doing, what it did. */
function farmSideHtml(a) {
  const color = window.TrackerFarm?.colorOf?.(a.id) ?? colorOf(a.id);
  const now = a.now ? `<div class="now mono"><span class="pulse"></span> ${esc(a.now.tool)} ${esc(a.now.summary)} · <b data-since="${a.now.startedAt}"></b></div>` : `<div class="muted">${esc(a.stateReason)}</div>`;
  return `<div class="fs-head"><span class="swatch" style="background:${color}"></span><span class="name">${esc(a.name)}</span><span class="chip c-${a.state}">${STATE_CHIP[a.state] ?? esc(a.state)} · <span data-since="${a.stateSince}"></span></span><span class="grow"></span><button class="act mini" id="fs-list" type="button" data-tip="Show this agent in the list view">☰ List</button></div>
    <div class="muted where" style="margin-top:4px">${esc(short(a.cwd))}${modelOf(a) ? ` · ${esc(modelOf(a))}` : ''}</div>
    ${sessionBarHtml(a)}
    ${askHtml(a)}
    <div class="sec">Now</div>${workingLineHtml(a)}${a.turn && !a.now ? '' : now}
    ${questionHtml(a)}
    ${composeHtml(a)}
    ${asideHtml(a)}
    ${conversationHtml(a)}`;
}

/** A farmer was clicked: show it in the farm's sidebar, where it can be answered or messaged. */
async function pickFromFarm(id, { from } = {}) {
  if (selected !== id) openChildren.clear();
  selected = id;
  farmTab = 'agent';
  save('tracker-farm-tab', farmTab);
  // A speech bubble only shows the start of a message: when its reply was cut, open the sidebar with it whole.
  const reply = snap?.agents.find(a => a.id === id)?.feed?.find(f => f.kind === 'reply');
  if (from === 'say' && reply?.more && !fullFeeds.has(id)) await loadFullFeed(id);
  if (farmSide) { applyFarmSide(); render(); }
  else setFarmSide(true);
}
/** A noticeboard in a field close-up: read that document in the list view's reader. */
async function openDocFromFarm(agentId, path) {
  setView('list');
  await openFile(agentId, path);
}
/** The "+N more fields" signpost: the list view, with the repos group open. */
function showReposFromFarm() {
  closedGroups.delete('repos');
  save('tracker-closed-groups', JSON.stringify([...closedGroups]));
  setView('list');
  $('rail').scrollIntoView?.({ block: 'start' });
}

/* ---------- interaction ---------- */

function showTip(text, e) {
  const tip = $('tip');
  tip.textContent = text;
  tip.classList.add('show');
  tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${e.clientY + 16}px`;
}
const hideTip = () => $('tip').classList.remove('show');

// Crosshair snaps to the nearest sample; other marks carry their own data-tip.
document.addEventListener('pointermove', e => {
  const svg = e.target.closest?.('svg[data-chart]');
  if (svg) {
    const data = JSON.parse(svg.dataset.chart);
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
    let best = 0;
    for (let i = 1; i < data.x.length; i++) if (Math.abs(data.x[i] - vx) < Math.abs(data.x[best] - vx)) best = i;
    const xh = svg.querySelector('.xh');
    xh.setAttribute('x1', data.x[best]);
    xh.setAttribute('x2', data.x[best]);
    xh.style.opacity = 1;
    const xd = svg.querySelector('.xd');
    xd.setAttribute('cx', data.x[best]);
    xd.setAttribute('cy', data.y[best]);
    xd.style.opacity = 1;
    showTip(data.t[best], e);
    return;
  }
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(el.dataset.tip, e);
  else hideTip();
});
document.addEventListener('pointerout', e => {
  const svg = e.target.closest?.('svg[data-chart]');
  if (svg && !svg.contains(e.relatedTarget)) {
    svg.querySelector('.xh').style.opacity = 0;
    svg.querySelector('.xd').style.opacity = 0;
    hideTip();
  }
});

async function post(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tracker-token': TOKEN }, body: JSON.stringify(body) });
    return await r.json();
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function notice(text) {
  $('notice').textContent = text;
  $('notice').classList.add('show');
  setTimeout(() => $('notice').classList.remove('show'), 6000);
}

function openCleanup() {
  const stale = snap.agents.filter(a => a.state === 'stale' && a.kind === 'background');
  $('cleanup-list').innerHTML = stale.length
    ? stale.map(a => `<label style="display:block;margin:4px 0"><input type="checkbox" value="${esc(a.id)}"> ${esc(a.name)} <span class="muted">· ${esc(short(a.cwd))} · last active ${ago(a.lastActivityAt)}</span></label>`).join('')
    : '<p class="empty">No stale background sessions.</p>';
  $('cleanup').showModal();
}

$('cleanup').addEventListener('close', async () => {
  if ($('cleanup').returnValue !== 'go') return;
  const ids = [...$('cleanup-list').querySelectorAll('input:checked')].map(i => i.value);
  if (!ids.length) return;
  const r = await post('/api/actions/rm', { ids });
  const failed = (r.results ?? []).filter(x => !x.ok);
  notice(failed.length ? `Could not remove ${failed.length}: ${failed.map(f => f.error).join('; ')}` : `Removed ${ids.length} stale session${ids.length > 1 ? 's' : ''}.`);
});

document.addEventListener('click', async e => {
  const row = e.target.closest('.row[data-id]');
  if (row) {
    if (row.dataset.id !== selected) {
      selected = row.dataset.id;
      openChildren.clear();
    }
    render();
    return;
  }
  const el = e.target.closest('button');
  if (!el) return;
  const d = el.dataset;
  if (d.confirm) { settleConfirm(d.confirm === 'yes'); return; }
  if (d.endSession) { void endSessionFlow(d.endSession); return; } // not awaited: the confirm box waits for you
  if (d.compact) { void compactFlow(d.compact); return; }
  if (d.removeSession) { void removeFlow(d.removeSession); return; }
  if (el.id === 'view-list' || el.id === 'view-farm') { setView(el.id === 'view-farm' ? 'farm' : 'list'); return; }
  if (el.id === 'side-toggle') { setFarmSide(!farmSide); return; }
  if (d.farmTab) { setFarmTab(d.farmTab); return; }
  if (el.id === 'fs-list') { setView('list'); return; }
  if (el.id === 'msg-send' || el.id === 'convo-msg-send') { await sendMessage(d.agent, el); return; }
  if (el.id === 'aside-send') { await askAside(d.agent, el); return; }
  if (d.quickReply !== undefined) { await sendMessage(d.agent, el, d.quickReply); return; }
  if (d.quickDraft !== undefined || d.quote !== undefined) {
    const prev = msgDrafts.get(d.agent) ?? '';
    const add = d.quote !== undefined ? `${d.quote.split('\n').map(l => `> ${l}`.trimEnd()).join('\n')}\n\n` : d.quickDraft;
    msgDrafts.set(d.agent, prev && d.quote !== undefined ? `${prev.replace(/\n*$/, '')}\n\n${add}` : d.quote !== undefined ? add : `${add}${prev}`);
    render();
    $('msg-text')?.focus?.();
    return;
  }
  if (d.fullFeed !== undefined) {
    if (!fullFeeds.has(d.fullFeed)) { el.disabled = true; el.textContent = 'Loading…'; }
    await toggleFullFeed(d.fullFeed);
    return;
  }
  if (d.removeFile !== undefined) { removeFile(d.agent, Number(d.removeFile)); return; }
  if (el.id === 'msg-attach' || el.id === 'convo-msg-attach') {
    pickerFor = d.agent;
    const picker = $(el.id === 'msg-attach' ? 'file-picker' : 'convo-file-picker'); // the dialog's own: a modal dialog makes the page behind it inert
    picker.value = '';
    picker.click?.();
    return;
  }
  if (d.docPath) { await openFile(d.docAgent, d.docPath); return; }
  if (d.closeTab !== undefined) { closeTab(d.closeTab); return; }
  if (d.tab !== undefined) {
    const a = centreAgent();
    if (a) {
      tabsOf(a.id).active = d.tab;
      render();
      renderTree();
      await viewerLoading;
    }
    return;
  }
  if (d.dir !== undefined) { toggleDir(explorer.agentId, d.dir); return; }
  if (d.sdir !== undefined) { toggleDir(`${explorer.agentId}\nscratch`, d.sdir); return; }
  if (d.file !== undefined) {
    if (explorer.data) await openFile(explorer.agentId, `${explorer.data.root}/${d.file}`);
    return;
  }
  if (d.sfile !== undefined) {
    if (explorer.data?.scratch) await openFile(explorer.agentId, `${explorer.data.scratch.root}/${d.sfile}`);
    return;
  }
  if (d.mem !== undefined) { await openFile(explorer.agentId, d.mem); return; }
  if (d.group) { toggleGroup(d.group); return; }
  if (el.id === 'ex-refresh') { await fetchListing(); return; }
  if (el.id === 'reader-reload') { await loadDoc({ keepScroll: true }); return; }
  if (el.id === 'reader-quote') { quoteSelection(); return; }
  if (el.id === 'reader-send') { await sendReaderReply(); return; }
  if (el.id === 'ask-send') {
    el.disabled = true;
    el.textContent = 'Sending…';
    await sendAnswer(d.agent, d.tool);
    return;
  }
  if (el.id === 'ask-allow' || el.id === 'ask-deny') {
    const decision = el.id === 'ask-allow' ? 'allow' : 'deny';
    el.disabled = true;
    el.textContent = decision === 'allow' ? 'Allowing…' : 'Denying…';
    const r = await post('/api/actions/permit', { agentId: d.agent, toolUseId: d.tool, decision });
    notice(r.ok ? (decision === 'allow' ? 'Allowed.' : 'Denied.') : `Could not send: ${r.error}`);
    return;
  }
  if (el.id === 'theme-toggle') { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; saveTheme(theme); applyTheme(theme); }
  else if (el.id === 'open-cleanup') openCleanup();
  else if (el.id === 'act-copy') { await navigator.clipboard.writeText(d.text); notice('Resume command copied.'); }
  else if (el.id === 'act-open') { const r = await post(`/api/actions/open/${encodeURIComponent(selected)}`, {}); notice(r.ok ? 'Opened in Terminal.' : `Could not open: ${r.error}`); }
  else if (d.child) {
    const id = d.child;
    if (openChildren.has(id)) openChildren.delete(id);
    else {
      const r = await fetch(`/api/agent/${encodeURIComponent(selected)}:${encodeURIComponent(id)}/feed?limit=30`);
      openChildren.set(id, r.ok ? await r.json() : []);
    }
    render();
  }
});

// Snapshots arrive every few seconds. Re-rendering replaces the DOM, which would wipe a
// text selection (copying a path or prompt), swallow a click that straddles it, or clobber
// typing, so a snapshot waits while text is selected, the pointer is down, or a box is typed in.
// It waits for an open dropdown too: replaced while its list is open, the pick would go to the old one.
let isPointerDown = false;
let isRenderPending = false;
const isInUse = () => {
  const el = document.activeElement;
  return Boolean(el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type === 'text')));
};
const hasSelection = () => {
  const s = window.getSelection?.();
  return Boolean(s && !s.isCollapsed && s.toString() !== '');
};
function requestRender() {
  if (isPointerDown || hasSelection() || isInUse()) {
    isRenderPending = true;
    if (view === 'farm' && snap) window.TrackerFarm?.update(snap); // the farm keeps moving; only the sidebar waits
    return;
  }
  isRenderPending = false;
  render();
}
document.addEventListener('pointerdown', () => { isPointerDown = true; });
document.addEventListener('pointerup', () => {
  isPointerDown = false;
  setTimeout(() => { if (isRenderPending) requestRender(); }, 0);
});
document.addEventListener('focusout', () => setTimeout(() => { if (isRenderPending) requestRender(); }, 0));
document.addEventListener('selectionchange', () => { if (isRenderPending && !hasSelection()) requestRender(); });
document.addEventListener('selectionchange', captureReaderSelection);

// Answer drafts survive the drawer re-rendering on every snapshot.
/** End session: after you confirm, ends it and closes its window. */
async function endSessionFlow(id) {
  const a = snap?.agents.find(x => x.id === id);
  if (!a) return;
  if (!(await confirmBox(`End ${a.name}? Claude stops now; the conversation is kept, so you can resume it from ＋ Session. Its iTerm or Terminal window closes too.`, 'End session'))) return;
  const r = await post('/api/actions/end', { agentId: id });
  notice(r.ok ? `Ended ${a.name}${r.closedWindow ? ' and closed its window' : ''}.` : `Could not end ${a.name}: ${r.error}`);
}
/** Remove a stale background session: after you confirm, `claude rm` deletes it. */
async function removeFlow(id) {
  const a = snap?.agents.find(x => x.id === id);
  if (!a) return;
  if (!(await confirmBox(`Remove ${a.name}? This deletes the background session and its conversation (claude rm). It can't be undone.`, 'Remove'))) return;
  const r = await post('/api/actions/rm', { ids: [id] });
  const res = r.results?.[0];
  notice(res?.ok ? `Removed ${a.name}.` : `Could not remove ${a.name}: ${res?.error ?? r.error ?? 'unknown error'}`);
}
/** Restart in a mode: after you confirm, ends the session and resumes it in a new window in that mode. */
async function restartFlow(id, mode) {
  const a = snap?.agents.find(x => x.id === id);
  if (!a) return;
  const warn = mode === 'bypassPermissions' ? ' ⚠ Bypass permissions runs every tool without asking (--dangerously-skip-permissions).' : '';
  if (!(await confirmBox(`Restart ${a.name} in ${modeName(mode)}? It ends now and resumes straight away in a new terminal window; the conversation carries on.${warn}`, `Restart in ${modeName(mode)}`))) return;
  const r = await post('/api/actions/restart', { agentId: id, mode });
  notice(r.ok ? `Restarting ${a.name} in ${modeName(mode)}: a new ${r.terminal ?? 'terminal'} window opens.` : `Could not restart ${a.name}: ${r.error}`);
}
/** Compacts a running session (/compact in it) after you confirm, keeping what you say it should. */
async function compactFlow(id) {
  const a = snap?.agents.find(x => x.id === id);
  if (!a) return;
  if (!(await confirmBox(`Compact ${a.name}? It runs /compact in the session after its current turn: the conversation so far becomes a summary, freeing its context. Say what the summary should keep, if anything.`, 'Compact', 'What to keep (optional), e.g. the API decisions'))) return;
  const r = await post('/api/actions/setting', { agentId: id, compact: String($('confirm-note').value ?? '').trim() });
  notice(r.ok ? `${a.name} compacts after its current turn.` : `Could not compact ${a.name}: ${r.error}`);
}
/** Switches a running session's model or effort (/model, /effort in it), after you confirm. */
async function switchFlow(id, what, value) {
  const a = snap?.agents.find(x => x.id === id);
  if (!a) return;
  const label = what === 'model' ? (MODELS.find(([m]) => m === value)?.[1] ?? value) : `${value} effort`;
  const saved = what === 'model' || value !== 'max' ? ' Claude Code also saves it as your default for new sessions (as when you type it).' : '';
  if (!(await confirmBox(`Switch ${a.name} to ${label}? It runs /${what} ${value} in the session after its current turn.${saved}`, `Switch to ${label}`))) return;
  const r = await post('/api/actions/setting', { agentId: id, [what]: value });
  notice(r.ok ? `${a.name} switches to ${label} after its current turn.` : `Could not switch ${a.name}: ${r.error}`);
}
/** Asks a session a side question (/btw); the answer shows under the box when it comes. */
async function askAside(agentId, button) {
  const question = (asideDrafts.get(agentId) ?? '').trim();
  if (!question) return;
  if (button) { button.disabled = true; button.textContent = 'Asking…'; }
  const r = await post('/api/actions/aside', { agentId, question });
  if (r.ok) asideDrafts.delete(agentId);
  else notice(`Could not ask: ${r.error}`);
  document.activeElement?.blur?.();
  render();
}
document.addEventListener('change', e => {
  const t = e.target;
  // A pick lets go of the dropdown, so refreshes go on while you confirm (and after you cancel).
  if (t?.dataset?.restartMode !== undefined) { const mode = t.value; t.value = ''; t.blur?.(); if (mode) void restartFlow(t.dataset.agent, mode); return; }
  if (t?.dataset?.switchModel !== undefined || t?.dataset?.switchEffort !== undefined) {
    const value = t.value, what = t.dataset.switchModel !== undefined ? 'model' : 'effort';
    t.value = '';
    t.blur?.();
    if (value) void switchFlow(t.dataset.agent, what, value);
    return;
  }
  if (t?.id === 'file-picker' || t?.id === 'convo-file-picker') {
    if (pickerFor) addFiles(pickerFor, [...(t.files ?? [])]);
    t.value = '';
    return;
  }
  if (!t?.dataset?.tool || t.dataset.q === undefined || t.type === 'text') return;
  const d = draftFor(t.dataset.tool);
  const qi = Number(t.dataset.q);
  const picks = t.type === 'radio' ? new Set() : new Set(d.picks.get(qi) ?? []);
  if (t.checked) picks.add(t.value);
  else picks.delete(t.value);
  d.picks.set(qi, picks);
});
// Files (screenshots, PDFs, Markdown…): paste them into the message box, or drop them on it.
document.addEventListener('paste', e => {
  const agentId = e.target?.dataset?.msgAgent;
  const files = [...(e.clipboardData?.files ?? [])];
  if (agentId === undefined || !files.length) return; // plain text pastes as usual
  e.preventDefault();
  addFiles(agentId, files);
});
const draggingFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
document.addEventListener('dragover', e => {
  if (!draggingFiles(e)) return;
  e.preventDefault(); // a dropped file must not replace the dashboard
  document.querySelectorAll('.compose.dragging').forEach(c => c.classList.remove('dragging'));
  e.target?.closest?.('.compose[data-agent]')?.classList.add('dragging');
});
document.addEventListener('drop', e => {
  if (!draggingFiles(e)) return;
  e.preventDefault();
  document.querySelectorAll('.compose.dragging').forEach(c => c.classList.remove('dragging'));
  const box = e.target?.closest?.('.compose[data-agent]');
  if (box) addFiles(box.dataset.agent, [...(e.dataTransfer?.files ?? [])]);
});
// Enter sends a message; Shift+Enter starts a new line (and Enter while an input method is composing is left alone).
const sendKey = e => e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229;
document.addEventListener('keydown', e => {
  if (sendKey(e) && (e.target?.id === 'msg-text' || e.target?.id === 'convo-msg-text')) {
    e.preventDefault();
    sendMessage(e.target.dataset.msgAgent, $(e.target.id.replace(/text$/, 'send')));
  }
  if (sendKey(e) && e.target?.id === 'aside-text') {
    e.preventDefault();
    void askAside(e.target.dataset.asideAgent, $('aside-send'));
  }
  if (sendKey(e) && e.target?.id === 'confirm-note') { // the confirm box's line: Enter confirms
    e.preventDefault();
    settleConfirm(true);
  }
  if (sendKey(e) && e.target?.id === 'reader-text') {
    e.preventDefault();
    sendReaderReply();
  }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t?.id === 'ex-filter') {
    filterText = t.value;
    renderTree();
    return;
  }
  if (t?.id === 'reader-text') {
    readerDrafts.set(readerKey(), t.value);
    return;
  }
  if (t?.dataset?.msgAgent !== undefined) {
    msgDrafts.set(t.dataset.msgAgent, t.value);
    return;
  }
  if (t?.dataset?.asideAgent !== undefined) {
    asideDrafts.set(t.dataset.asideAgent, t.value);
    return;
  }
  if (!t?.dataset?.tool || t.dataset.q === undefined || t.type !== 'text') return;
  draftFor(t.dataset.tool).other.set(Number(t.dataset.q), t.value);
});

async function sendAnswer(agentId, toolUseId) {
  const agent = snap?.agents.find(a => a.id === agentId);
  const ask = agent?.ask;
  if (ask?.kind !== 'question' || ask.toolUseId !== toolUseId) {
    notice('That question is no longer waiting.');
    return;
  }
  const d = draftFor(toolUseId);
  const answers = {};
  for (const [qi, q] of ask.questions.entries()) {
    const value = (d.other.get(qi) ?? '').trim() || [...(d.picks.get(qi) ?? [])].join(', ');
    if (!value) {
      notice('Answer every question first.');
      return;
    }
    answers[q.question] = value;
  }
  const r = await post('/api/actions/answer', { agentId, toolUseId, answers });
  if (r.ok) drafts.delete(toolUseId);
  notice(r.ok ? `Answer sent to ${agent.name}.` : `Could not send: ${r.error}`);
}

/* ---------- the bell: a chime and a desktop notice when an agent starts waiting on you ---------- */
// Switched on from the farm's Bell button; it rings in either view.
let bellSeen = null, bellAudio = null;
const bellIsOn = () => { try { return localStorage.getItem('tracker-bell') === 'on'; } catch { return false; } };
function chime() {
  try {
    bellAudio ??= new AudioContext();
    if (bellAudio.state === 'suspended') void bellAudio.resume();
    const t = bellAudio.currentTime;
    for (const [freq, d] of [[880, 0], [1318.5, 0.14]]) { // two soft notes, a farm bell
      const o = bellAudio.createOscillator(), g = bellAudio.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.22, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.1);
      o.connect(g).connect(bellAudio.destination); o.start(t + d); o.stop(t + d + 1.2);
    }
  } catch { /* no sound here */ }
}
function bellSwitched(on) {
  if (!on) return;
  if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  chime(); // what it sounds like (and the click lets the page play sound)
}
function ringBell() {
  const waiting = snap.agents.filter(a => a.state === 'waiting' || a.question);
  const fresh = bellSeen ? waiting.filter(a => !bellSeen.has(a.id)) : [];
  bellSeen = new Set(waiting.map(a => a.id));
  if (!fresh.length || !bellIsOn()) return;
  chime();
  if (!('Notification' in window) || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return;
  for (const a of fresh.slice(0, 3)) {
    const what = a.ask?.kind === 'permission' ? `${a.ask.tool}: ${a.ask.summary}` : a.ask?.questions?.[0]?.question ?? a.question ?? a.stateReason ?? '';
    const n = new Notification(`${a.name} needs you`, { body: String(what).slice(0, 180), tag: `tracker-${a.id}` });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

function connect() {
  const events = new EventSource('/api/events');
  events.addEventListener('snapshot', ev => {
    snap = JSON.parse(ev.data);
    ringBell();
    $('banner').classList.remove('show');
    $('live').classList.remove('off');
    if (selected && !snap.agents.some(a => a.id === selected)) selected = null;
    if (reader) refreshReader();
    requestRender();
  });
  events.onerror = () => {
    $('banner').classList.add('show');
    $('live').classList.add('off');
  };
}

// Dark first: no saved choice means Dark. Auto follows macOS.
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABELS = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
function loadTheme() {
  try {
    const t = localStorage.getItem('tracker-theme');
    return THEMES.includes(t) ? t : 'dark';
  } catch {
    return 'dark';
  }
}
function saveTheme(t) {
  try { localStorage.setItem('tracker-theme', t); } catch { /* private window: the choice lasts this page only */ }
}
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const button = $('theme-toggle');
  button.textContent = THEME_LABELS[t];
  button.title = `Theme: ${t} — click to change`;
}
let theme = loadTheme();
applyTheme(theme);

setInterval(updateTimers, 1000);
// farm.js loads deferred (after this script), so the remembered view is applied once the page has loaded.
const startView = () => setView(view, { remember: false });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startView);
else startView();
connect();
