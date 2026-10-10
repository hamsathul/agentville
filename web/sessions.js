// Start a new Claude Code session in a folder you worked in, or in any other of yours (typed, browsed
// or made), or resume a past one, in a terminal window (Terminal or iTerm, as config.json says). The
// collector checks the folder or session again.
// Past sessions can be searched, filtered (folder, model, branch, account, running) and sorted; the sort
// and how far back to look (the last 30 days, or all time) are kept for the next time. With two or more
// Claude accounts, the Account picker starts each session on the account it last ran on, or on one for all.
let sessData = null;
const storedMode = () => { try { return localStorage.getItem('tracker-start-mode') || 'default'; } catch { return 'default'; } };
const sessStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const sessRemember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* this page only */ } };
let sessAllFolders = false; // the folder list shows the 6 most recent until you ask for all
const FOLDERS_SHOWN = 6;
// What the dialog shows: the search and filters start empty each time; the sort and range are remembered.
const sessView = { q: '', folder: '', model: '', branch: '', account: '', live: '', sort: 'active', range: '30', pick: '' }; // pick: the Account picker ('' = as each last ran)
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
  Object.assign(sessView, { q: '', folder: '', model: '', branch: '', account: '', live: '', pick: '' });
  sessView.sort = SESS_ORDER[sessStored('tracker-sess-sort')] ? sessStored('tracker-sess-sort') : 'active';
  sessView.range = sessStored('tracker-sess-range') === 'all' ? 'all' : '30';
  $('sess-status').textContent = '';
  $('sess-mode').value = storedMode();
  $('sess-mode-warn').hidden = $('sess-mode').value !== 'bypassPermissions';
  sessAllFolders = false;
  resetDirPicker();
  fillAccountPicker();
  syncSessControls();
  $('sessions').showModal();
  await loadSessions();
}

/** The Account picker (two or more accounts): as each session last ran, or one account for all. */
function fillAccountPicker() {
  $('sess-account-row').hidden = !accountsOn();
  if (!accountsOn()) return;
  $('sess-account').innerHTML = `<option value="">As each last ran</option>${snap.accounts.map(a => `<option value="${esc(a.key)}"${acctFull(a) ? ' class="msg-bad"' : ''}>${esc(acctChoice(a))}</option>`).join('')}`;
  $('sess-account').value = sessView.pick;
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
  Object.assign(sessView, { q: '', folder: '', model: '', branch: '', account: '', live: '' });
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
  $('sess-f-account').hidden = !accountsOn();
  if (accountsOn()) fillFilter('sess-f-account', 'account', `Any account (${all.length})`, countsOf(all, s => s.account ?? s.accountGone, accountName));
  else sessView.account = '';

  const q = sessView.q.trim().toLowerCase();
  const hit = (...texts) => !q || texts.some(t => String(t ?? '').toLowerCase().includes(q));
  const sessions = all.filter(s => hit(s.title, s.firstPrompt, s.lastPrompt, s.cwd, s.branch)
    && (!sessView.folder || s.cwd === sessView.folder)
    && (!sessView.model || sessFamily(s.model) === sessView.model)
    && (!sessView.branch || s.branch === sessView.branch)
    && (!sessView.account || (s.account ?? s.accountGone) === sessView.account)
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

  const filtered = Boolean(q || sessView.folder || sessView.model || sessView.branch || sessView.account || sessView.live);
  $('sess-count').innerHTML = `<span>Showing ${sessions.length} of ${all.length} session${all.length === 1 ? '' : 's'} · ${sessView.range === 'all' ? 'all time' : 'the last 30 days'}</span>${filtered ? '<button type="button" class="act mini" data-sess-clear>Clear filters</button>' : ''}`;
  const projectRow = p => `<div class="sess-row"><div class="sess-main"><b>${esc(p.name)}</b><span class="faint mono">${esc(short(p.cwd))}</span></div>
    ${accountsOn() && p.account ? `<span class="chip acct" data-tip="${esc(`Its last session ran on ${accountName(p.account)}: ＋ New starts there, unless you pick another account above`)}">${esc(accountName(p.account))}</span>` : ''}<span class="faint sess-when">${p.sessions} session${p.sessions === 1 ? '' : 's'} · ${esc(ago(p.at))}</span>
    <button type="button" class="act mini primary" data-sess-new="${esc(p.cwd)}">＋ New</button></div>`;
  const sessionRow = s => {
    const about = [sessFolder(s.cwd), s.branch && `⎇ ${s.branch}`, s.model && modelName(s.model), s.size && sizeText(s.size)].filter(Boolean).join(' · ');
    const when = `active ${ago(s.at)}${s.startedAt ? ` · started ${ago(s.startedAt)}` : ''}`;
    // its account (two or more): the one it last ran on, greyed when that folder is no account now
    const acct = !accountsOn() ? '' : s.account
      ? `<span class="chip acct" data-tip="${esc(`Last ran on ${accountName(s.account)}`)}">${esc(accountName(s.account))}</span>`
      : s.accountGone ? `<span class="chip acct faint" data-tip="${esc(`Last ran on ${s.accountGone}, which is no longer one of your accounts`)}">${esc(s.accountGone)}</span>` : '';
    const blocked = accountsOn() && sessView.pick && s.canRunOn && !s.canRunOn.includes(sessView.pick);
    const running = accountsOn() && s.account ? `Already open on ${accountName(s.account)}: find it in the list (Restart in… moves it to another account)` : 'Already open: find it in the list';
    return `<div class="sess-row" data-sess-id="${esc(s.id)}"><div class="sess-main"><b>${esc(sessName(s))}</b>
      <span class="faint">${esc(about)}</span>
      <span class="faint">${esc(when)}${s.lastPrompt ? ` · “${esc(s.lastPrompt)}”` : ''}</span></div>
      ${acct}${s.notes ? `<span class="chip c-plain" data-tip="${s.notes} note${s.notes === 1 ? '' : 's'} you haven’t used yet: they show under its message box once you resume it">📝 ${s.notes}</span>` : ''}${s.live ? `<span class="chip c-working live-dot" data-tip="${esc(running)}">running</span>` : `<button type="button" class="act mini" data-sess-resume="${esc(s.id)}"${blocked ? ` disabled data-tip="${esc(`Its history isn't shared with ${accountName(sessView.pick)} (see Several Claude accounts in the README)`)}"` : ''}>Resume</button>`}</div>`;
  };
  $('sess-body').innerHTML = `<div class="sec" style="margin-top:4px">Or a folder you worked in</div>${projects.map(projectRow).join('') || '<div class="empty">No folders match.</div>'}${more}
    <div class="sec">Resume</div>${sessions.map(sessionRow).join('') || '<div class="empty">No sessions match.</div>'}`;
}

/* ---------- a new session in any folder: typed, browsed or made ---------- */

const sessDir = { typed: '', data: null, shown: false, asked: 0, waiting: 0 };
const tildeOf = (path, home) => (home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);

function resetDirPicker() {
  Object.assign(sessDir, { typed: '', data: null, shown: false });
  $('sess-dir').value = '';
  renderDirs();
}

/** Asks for the folders under what is typed (the collector keeps to your home folder and drives). */
async function loadDirs() {
  const ask = ++sessDir.asked;
  let data;
  try {
    const r = await fetch(`/api/dirs?path=${encodeURIComponent(sessDir.typed.trim() || '~/')}`, { headers: { 'x-tracker-token': TOKEN } });
    data = await r.json();
  } catch (err) {
    data = { error: String(err) };
  }
  if (ask !== sessDir.asked) return; // something else was typed meanwhile
  sessDir.data = data;
  renderDirs();
}

/** The folder typed, as the field shows it: a slash at the end lists what is in it. */
function setDir(value) {
  sessDir.typed = value;
  sessDir.shown = true;
  const field = $('sess-dir');
  field.value = value;
  field.focus?.();
  field.scrollLeft = field.scrollWidth; // the end of a long path, where you type
  return loadDirs();
}

function renderDirs() {
  const d = sessDir.data, list = $('sess-dir-list'), note = $('sess-dir-note');
  $('sess-dir-new').disabled = !(d && !d.error && d.exists);
  note.className = 'faint dir-note';
  if (!d) {
    list.hidden = true;
    note.textContent = 'A folder you have not worked in yet: type or paste it, or Browse from your home folder.';
    return;
  }
  if (d.error) {
    list.hidden = true;
    note.className = 'msg-bad dir-note';
    note.textContent = d.error;
    return;
  }
  const at = path => tildeOf(path, d.home);
  const inDir = name => `${at(d.dir).replace(/\/$/, '')}/${name}/`;
  const rows = (d.up ? [`<button type="button" class="dir-row" data-dir-go="${esc(`${at(d.up).replace(/\/$/, '')}/`)}">↰ ..</button>`] : [])
    .concat(d.dirs.map(name => `<button type="button" class="dir-row" data-dir-go="${esc(inDir(name))}"><span aria-hidden="true">📁</span> ${esc(name)}</button>`));
  list.innerHTML = rows.join('') + (d.truncated ? '<div class="empty" style="padding:4px 10px">More folders: type the start of a name.</div>' : '');
  list.hidden = !sessDir.shown || !rows.length;
  if (d.isFile) note.textContent = `${at(d.path)} is a file, not a folder.`;
  else if (d.exists) note.textContent = `＋ New starts Claude Code in ${at(d.path)}.${d.unreadable ? ' (Its folders could not be listed: macOS may ask to allow access.)' : ''}`;
  else note.innerHTML = `${esc(at(d.path))} doesn't exist yet${d.dirs.length ? ': pick a folder above, or' : '.'} <button type="button" class="act mini" data-dir-make>Create it</button>`;
}

/** Tab, as in a terminal: the one folder that matches (and a slash), or as far as the matches agree. False if nothing changed. */
async function completeDir() {
  const d = sessDir.data;
  if (!d || d.error || !d.dirs.length) return false;
  const typed = sessDir.typed.trim();
  const part = typed.endsWith('/') ? '' : typed.split('/').pop();
  let common = d.dirs[0];
  for (const name of d.dirs) while (!name.startsWith(common)) common = common.slice(0, -1);
  const base = `${tildeOf(d.dir, d.home).replace(/\/$/, '')}/`;
  const next = d.dirs.length === 1 ? `${base}${d.dirs[0]}/` : common.length > part.length ? `${base}${common}` : null;
  if (!next || next === typed) return false;
  await setDir(next);
  return true;
}

/** Browse: Finder's own folder window (it has New Folder), opened where the field is; the folder picked fills the field. */
async function browseForFolder(button) {
  const d = sessDir.data;
  button.disabled = true;
  $('sess-dir-note').className = 'faint dir-note';
  $('sess-dir-note').textContent = `Pick a folder in the ${fileManager()} window…`;
  const r = await post('/api/actions/choose-folder', { start: d?.exists ? d.path : d?.dir, prompt: 'Start a new Claude Code session in:' });
  button.disabled = false;
  if (r.ok) return setDir(`${tildeOf(r.path, r.home).replace(/\/$/, '')}/`);
  if (r.cancelled) return renderDirs();
  $('sess-dir-note').className = 'msg-bad dir-note';
  $('sess-dir-note').textContent = r.error ?? 'The folder window could not open.';
}

/** Makes the folder typed (and any missing above it), after asking. */
async function makeDir() {
  const d = sessDir.data;
  if (!d?.path || d.exists || d.error) return;
  if (!(await confirmBox(`Create the folder ${tildeOf(d.path, d.home)}?`, 'Create it', ''))) return;
  const r = await post('/api/actions/mkdir', { path: d.path });
  if (!r.ok) {
    $('sess-dir-note').className = 'msg-bad dir-note';
    $('sess-dir-note').textContent = r.error ?? 'The folder could not be made.';
    return;
  }
  await loadDirs();
  $('sess-dir-new').focus?.();
}

async function startSession(body, button) {
  const app = sessData?.terminal ?? 'Terminal';
  button.disabled = true;
  $('sess-status').className = 'faint';
  $('sess-status').textContent = `Opening ${app}…`;
  const model = $('sess-model').value || 'default', effort = $('sess-effort').value || undefined;
  const r = await post('/api/actions/start', { ...body, mode: $('sess-mode').value || 'default', ...(model !== 'default' ? { model } : {}), ...(effort ? { effort } : {}), ...(accountsOn() && sessView.pick ? { account: sessView.pick } : {}) });
  button.disabled = false;
  if (!r.ok) {
    $('sess-status').className = 'msg-bad';
    $('sess-status').textContent = r.error ?? 'Something went wrong.';
    return;
  }
  $('sessions').close();
  notice(`Opened a new ${r.terminal ?? app} window. The session shows up here once it starts.${body.cwd && !sessData?.projects?.some(p => p.cwd === body.cwd) ? ' If Claude Code asks whether to trust the folder, answer in that window.' : ''}`);
}

$('sessions-open').addEventListener('click', openSessions);
// The folder field: suggestions as you type (a moment after), Tab to complete, Enter to start there.
document.addEventListener('input', e => {
  if (e.target?.id !== 'sess-dir') return;
  sessDir.typed = e.target.value;
  sessDir.shown = true;
  const wait = ++sessDir.waiting;
  setTimeout(() => { if (wait === sessDir.waiting) void loadDirs(); }, 120);
});
$('sess-dir').addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey && sessDir.data?.dirs?.length) {
    e.preventDefault();
    void completeDir();
  } else if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    if (!$('sess-dir-new').disabled) $('sess-dir-new').click();
  }
});
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'sess-dir-browse') return browseForFolder(b);
  else if (b.dataset.dirGo !== undefined) void setDir(b.dataset.dirGo);
  else if (b.dataset.dirMake !== undefined) return makeDir();
  else if (b.id === 'sess-dir-new' && sessDir.data?.exists) return startSession({ cwd: sessDir.data.path }, b);
});
// The search box, filters, sort and range.
const SESS_FILTERS = { 'sess-f-folder': 'folder', 'sess-f-model': 'model', 'sess-f-branch': 'branch', 'sess-f-account': 'account', 'sess-f-live': 'live' };
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
  } else if (id === 'sess-account') {
    sessView.pick = e.target.value;
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
