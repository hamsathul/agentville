// Start a new Claude Code session in a folder you worked in, or resume a past one, in a terminal
// window (Terminal or iTerm, as config.json says). The collector checks the folder or session again.
let sessData = null;
let sessAllFolders = false; // the folder list shows the 6 most recent until you ask for all
const FOLDERS_SHOWN = 6;

async function openSessions() {
  $('sess-filter').value = '';
  $('sess-status').textContent = '';
  sessAllFolders = false;
  $('sess-body').innerHTML = '<div class="loading"><span class="spinner"></span>Reading your sessions…</div>';
  $('sessions').showModal();
  try {
    const r = await fetch('/api/sessions', { headers: { 'x-tracker-token': TOKEN } });
    sessData = r.ok ? await r.json() : { error: `The tracker said ${r.status}.` };
  } catch (err) {
    sessData = { error: String(err) };
  }
  renderSessions();
}

function renderSessions() {
  if (!sessData) return;
  if (sessData.error) { $('sess-body').innerHTML = `<div class="empty">Could not read your sessions: ${esc(sessData.error)}</div>`; return; }
  const q = $('sess-filter').value.trim().toLowerCase();
  const hit = (...texts) => !q || texts.some(t => String(t ?? '').toLowerCase().includes(q));
  const matching = sessData.projects.filter(p => hit(p.name, p.cwd));
  const projects = q || sessAllFolders ? matching : matching.slice(0, FOLDERS_SHOWN);
  const more = matching.length > FOLDERS_SHOWN && !q
    ? `<div class="sess-more"><button type="button" class="act mini" data-sess-more>${sessAllFolders ? 'Show fewer' : `Show all ${matching.length} folders`}</button></div>`
    : '';
  const sessions = sessData.sessions.filter(s => hit(s.title, s.firstPrompt, s.lastPrompt, s.cwd));
  const folder = cwd => esc(cwd?.split('/').filter(Boolean).pop() ?? '');
  const projectRow = p => `<div class="sess-row"><div class="sess-main"><b>${esc(p.name)}</b><span class="faint mono">${esc(short(p.cwd))}</span></div>
    <span class="faint sess-when">${p.sessions} session${p.sessions === 1 ? '' : 's'} · ${esc(ago(p.at))}</span>
    <button type="button" class="act mini primary" data-sess-new="${esc(p.cwd)}">＋ New</button></div>`;
  const sessionRow = s => `<div class="sess-row"><div class="sess-main"><b>${esc(s.title || s.firstPrompt)}</b>
    <span class="faint">${folder(s.cwd)} · ${esc(ago(s.at))}${s.lastPrompt ? ` · “${esc(s.lastPrompt)}”` : ''}</span></div>
    ${s.live ? '<span class="chip c-working live-dot" data-tip="Already open: find it in the list">running</span>' : `<button type="button" class="act mini" data-sess-resume="${esc(s.id)}">Resume</button>`}</div>`;
  $('sess-body').innerHTML = `<div class="sec" style="margin-top:4px">New session in</div>${projects.map(projectRow).join('') || '<div class="empty">No folders match.</div>'}${more}
    <div class="sec">Resume <span class="faint" style="text-transform:none;letter-spacing:0;font-weight:500">· the last 30 days</span></div>${sessions.map(sessionRow).join('') || '<div class="empty">No sessions match.</div>'}`;
}

async function startSession(body, button) {
  const app = sessData?.terminal ?? 'Terminal';
  button.disabled = true;
  $('sess-status').className = 'faint';
  $('sess-status').textContent = `Opening ${app}…`;
  const r = await post('/api/actions/start', body);
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
$('sess-filter').addEventListener('input', renderSessions);
$('sessions').addEventListener('click', e => {
  if (e.target === $('sessions') || e.target.closest('[data-sess-close]')) { $('sessions').close(); return; } // × or the backdrop
  if (e.target.closest('[data-sess-more]')) { sessAllFolders = !sessAllFolders; renderSessions(); return; }
  const b = e.target.closest('button[data-sess-new], button[data-sess-resume]');
  if (!b) return;
  startSession(b.dataset.sessResume ? { resume: b.dataset.sessResume } : { cwd: b.dataset.sessNew }, b);
});
