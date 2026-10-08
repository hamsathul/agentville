// Start a new Claude Code session in a folder you worked in, or resume a past one, in a terminal
// window (Terminal or iTerm, as config.json says). The collector checks the folder or session again.
// Past sessions can be searched, filtered (folder, model, branch, running) and sorted; the sort and
// how far back to look (the last 30 days, or all time) are kept for the next time.
let sessData = null;
const storedMode = () => { try { return localStorage.getItem('tracker-start-mode') || 'default'; } catch { return 'default'; } };
const sessStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const sessRemember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* this page only */ } };
let sessAllFolders = false; // the folder list shows the 6 most recent until you ask for all
const FOLDERS_SHOWN = 6;
// What the dialog shows: the search and filters start empty each time; the sort and range are remembered.
const sessView = { q: '', folder: '', model: '', branch: '', live: '', sort: 'active', range: '30' };
let sessLoading = 0; // the newest read asked for: an older one that comes back after it is dropped

const sessName = s => s.title || s.firstPrompt || '';
const sessFolder = cwd => cwd?.split('/').filter(Boolean).pop() ?? '';
const sessFamily = model => ['opus', 'sonnet', 'haiku', 'fable'].find(f => String(model ?? '').includes(f)) ?? '';
const byText = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' });
const SESS_ORDER = {
  active: (x, y) => y.at - x.at,
  started: (x, y) => (y.startedAt ?? y.at) - (x.startedAt ?? x.at),
  name: (x, y) => byText(sessName(x), sessName(y)),
  folder: (x, y) => byText(sessFolder(x.cwd), sessFolder(y.cwd)) || y.at - x.at, // newest first within a folder
  length: (x, y) => (y.size ?? 0) - (x.size ?? 0),
};

async function openSessions() {
  Object.assign(sessView, { q: '', folder: '', model: '', branch: '', live: '' });
  sessView.sort = SESS_ORDER[sessStored('tracker-sess-sort')] ? sessStored('tracker-sess-sort') : 'active';
  sessView.range = sessStored('tracker-sess-range') === 'all' ? 'all' : '30';
  $('sess-status').textContent = '';
  $('sess-mode').value = storedMode();
  $('sess-mode-warn').hidden = $('sess-mode').value !== 'bypassPermissions';
  sessAllFolders = false;
  syncSessControls();
  $('sessions').showModal();
  await loadSessions();
}

/** Reads the past sessions for the range picked, saying so while it reads. */
async function loadSessions() {
  const ask = ++sessLoading;
  sessData = null;
  $('sess-count').innerHTML = '';
  $('sess-body').innerHTML = `<div class="loading"><span class="spinner"></span>${sessView.range === 'all' ? 'Reading every session you have had…' : 'Reading your sessions…'}</div>`;
  let data;
  try {
    const r = await fetch(`/api/sessions${sessView.range === 'all' ? '?days=all' : ''}`, { headers: { 'x-tracker-token': TOKEN } });
    data = r.ok ? await r.json() : { error: `The tracker said ${r.status}.` };
  } catch (err) {
    data = { error: String(err) };
  }
  if (ask !== sessLoading) return; // another range was picked meanwhile
  sessData = data;
  renderSessions();
}

/** The search box, sort and range as sessView has them (the filters' choices come with the sessions). */
function syncSessControls() {
  if ($('sess-filter').value !== sessView.q) $('sess-filter').value = sessView.q;
  $('sess-f-live').value = sessView.live;
  $('sess-sort').value = sessView.sort;
  $('sess-range').value = sessView.range;
}

/** A filter's choices from the sessions there are, most used first: [value, label, count]. */
function countsOf(list, keyOf, labelOf = k => k) {
  const counts = new Map();
  for (const s of list) {
    const k = keyOf(s);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => [k, labelOf(k), n]).sort((x, y) => y[2] - x[2] || byText(x[1], y[1]));
}

/** Fills a filter's choices and keeps what was picked (or nothing, if it is no longer there). */
function fillFilter(id, field, all, choices) {
  if (sessView[field] && !choices.some(([v]) => v === sessView[field])) sessView[field] = '';
  $(id).innerHTML = `<option value="">${esc(all)}</option>${choices.map(([v, label, n]) => `<option value="${esc(v)}">${esc(label)} (${n})</option>`).join('')}`;
  $(id).value = sessView[field];
}

function clearSessionFilters() {
  Object.assign(sessView, { q: '', folder: '', model: '', branch: '', live: '' });
  renderSessions();
}

function renderSessions() {
  syncSessControls();
  if (!sessData) return;
  if (sessData.error) { $('sess-body').innerHTML = `<div class="empty">Could not read your sessions: ${esc(sessData.error)}</div>`; return; }
  const all = sessData.sessions;
  // Two folders of the same name are told apart by their paths.
  const twins = countsOf([...new Set(all.map(s => s.cwd))].map(cwd => ({ cwd })), x => sessFolder(x.cwd)).filter(([, , n]) => n > 1).map(([name]) => name);
  const folderLabel = cwd => (twins.includes(sessFolder(cwd)) ? short(cwd) : sessFolder(cwd));
  fillFilter('sess-f-folder', 'folder', `All folders (${all.length})`, countsOf(all, s => s.cwd, folderLabel));
  fillFilter('sess-f-model', 'model', `Any model (${all.length})`, countsOf(all, s => sessFamily(s.model), f => f[0].toUpperCase() + f.slice(1)));
  fillFilter('sess-f-branch', 'branch', `Any branch (${all.length})`, countsOf(all, s => s.branch));

  const q = sessView.q.trim().toLowerCase();
  const hit = (...texts) => !q || texts.some(t => String(t ?? '').toLowerCase().includes(q));
  const sessions = all.filter(s => hit(s.title, s.firstPrompt, s.lastPrompt, s.cwd, s.branch)
    && (!sessView.folder || s.cwd === sessView.folder)
    && (!sessView.model || sessFamily(s.model) === sessView.model)
    && (!sessView.branch || s.branch === sessView.branch)
    && (!sessView.live || (sessView.live === 'live') === Boolean(s.live)))
    .sort(SESS_ORDER[sessView.sort] ?? SESS_ORDER.active);
  // Folders to start in: the search and the folder filter narrow them; they go A–Z when sessions do.
  const matching = sessData.projects.filter(p => hit(p.name, p.cwd) && (!sessView.folder || p.cwd === sessView.folder));
  if (sessView.sort === 'name' || sessView.sort === 'folder') matching.sort((x, y) => byText(x.name, y.name));
  const narrowed = Boolean(q || sessView.folder);
  const projects = narrowed || sessAllFolders ? matching : matching.slice(0, FOLDERS_SHOWN);
  const more = matching.length > FOLDERS_SHOWN && !narrowed
    ? `<div class="sess-more"><button type="button" class="act mini" data-sess-more>${sessAllFolders ? 'Show fewer' : `Show all ${matching.length} folders`}</button></div>`
    : '';

  const filtered = Boolean(q || sessView.folder || sessView.model || sessView.branch || sessView.live);
  $('sess-count').innerHTML = `<span>Showing ${sessions.length} of ${all.length} session${all.length === 1 ? '' : 's'} · ${sessView.range === 'all' ? 'all time' : 'the last 30 days'}</span>${filtered ? '<button type="button" class="act mini" data-sess-clear>Clear filters</button>' : ''}`;
  const projectRow = p => `<div class="sess-row"><div class="sess-main"><b>${esc(p.name)}</b><span class="faint mono">${esc(short(p.cwd))}</span></div>
    <span class="faint sess-when">${p.sessions} session${p.sessions === 1 ? '' : 's'} · ${esc(ago(p.at))}</span>
    <button type="button" class="act mini primary" data-sess-new="${esc(p.cwd)}">＋ New</button></div>`;
  const sessionRow = s => {
    const about = [sessFolder(s.cwd), s.branch && `⎇ ${s.branch}`, s.model && modelName(s.model), s.size && sizeText(s.size)].filter(Boolean).join(' · ');
    const when = `active ${ago(s.at)}${s.startedAt ? ` · started ${ago(s.startedAt)}` : ''}`;
    return `<div class="sess-row" data-sess-id="${esc(s.id)}"><div class="sess-main"><b>${esc(sessName(s))}</b>
      <span class="faint">${esc(about)}</span>
      <span class="faint">${esc(when)}${s.lastPrompt ? ` · “${esc(s.lastPrompt)}”` : ''}</span></div>
      ${s.live ? '<span class="chip c-working live-dot" data-tip="Already open: find it in the list">running</span>' : `<button type="button" class="act mini" data-sess-resume="${esc(s.id)}">Resume</button>`}</div>`;
  };
  $('sess-body').innerHTML = `<div class="sec" style="margin-top:4px">New session in</div>${projects.map(projectRow).join('') || '<div class="empty">No folders match.</div>'}${more}
    <div class="sec">Resume</div>${sessions.map(sessionRow).join('') || '<div class="empty">No sessions match.</div>'}`;
}

async function startSession(body, button) {
  const app = sessData?.terminal ?? 'Terminal';
  button.disabled = true;
  $('sess-status').className = 'faint';
  $('sess-status').textContent = `Opening ${app}…`;
  const model = $('sess-model').value || 'default', effort = $('sess-effort').value || undefined;
  const r = await post('/api/actions/start', { ...body, mode: $('sess-mode').value || 'default', ...(model !== 'default' ? { model } : {}), ...(effort ? { effort } : {}) });
  button.disabled = false;
  if (!r.ok) {
    $('sess-status').className = 'msg-bad';
    $('sess-status').textContent = r.error ?? 'Something went wrong.';
    return;
  }
  $('sessions').close();
  notice(`Opened a new ${r.terminal ?? app} window. The session shows up here once it starts.`);
}

$('sessions-open').addEventListener('click', openSessions);
// The search box, filters, sort and range.
const SESS_FILTERS = { 'sess-f-folder': 'folder', 'sess-f-model': 'model', 'sess-f-branch': 'branch', 'sess-f-live': 'live' };
document.addEventListener('input', e => {
  if (e.target?.id !== 'sess-filter') return;
  sessView.q = e.target.value;
  renderSessions();
});
document.addEventListener('change', e => {
  const id = e.target?.id;
  if (SESS_FILTERS[id]) {
    sessView[SESS_FILTERS[id]] = e.target.value;
    renderSessions();
  } else if (id === 'sess-sort') {
    sessView.sort = SESS_ORDER[e.target.value] ? e.target.value : 'active';
    sessRemember('tracker-sess-sort', sessView.sort);
    renderSessions();
  } else if (id === 'sess-range') {
    sessView.range = e.target.value === 'all' ? 'all' : '30';
    sessRemember('tracker-sess-range', sessView.range);
    return loadSessions();
  }
});
$('sess-mode').addEventListener('change', () => {
  try { localStorage.setItem('tracker-start-mode', $('sess-mode').value); } catch { /* this page only */ }
  $('sess-mode-warn').hidden = $('sess-mode').value !== 'bypassPermissions';
});
$('sessions').addEventListener('click', e => {
  if (e.target === $('sessions') || e.target.closest('[data-sess-close]')) { $('sessions').close(); return; } // × or the backdrop
  if (e.target.closest('[data-sess-more]')) { sessAllFolders = !sessAllFolders; renderSessions(); return; }
  if (e.target.closest('[data-sess-clear]')) { clearSessionFilters(); return; }
  const b = e.target.closest('button[data-sess-new], button[data-sess-resume]');
  if (!b) return;
  startSession(b.dataset.sessResume ? { resume: b.dataset.sessResume } : { cwd: b.dataset.sessNew }, b);
});
