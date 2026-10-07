// The file viewer: a file from the agent's folder (or a markdown document it opened elsewhere),
// read-only in a centre tab, with a reply box that messages the agent about it. Markdown is
// rendered; anything else is shown as text with line numbers.
let reader = null; // { agentId, path, at } for the file tab on screen
let readerQuote = '';
let readerLines = null; // [first, last] line numbers of the quoted code selection
const readerDrafts = new Map(); // agent id + path → half-typed reply
const readerKey = () => (reader ? `${reader.agentId}\n${reader.path}` : '');
const docName = path => String(path).split('/').pop();
const isMarkdown = path => path === '@summary' || /\.(md|markdown|mdx)$/i.test(path);
const docEntry = (agentId, path) => snap?.agents.find(a => a.id === agentId)?.docs?.find(d => d.path === path);
/** The path as the agent knows it: relative to its folder when inside it. */
const docLabel = (agent, path) => (path === '@summary' ? 'your conversation summary' : agent?.cwd && path.startsWith(`${agent.cwd}/`) ? path.slice(agent.cwd.length + 1) : path);
/** When the agent last wrote or read a file: from its documents, or from the explorer listing. */
function touchOf(agentId, path) {
  const doc = docEntry(agentId, path);
  const root = explorer.agentId === agentId ? explorer.data?.root : null;
  const listed = root && path.startsWith(`${root}/`) ? explorer.data.touched?.[path.slice(root.length + 1)] : null;
  if (!doc) return listed ?? null;
  if (!listed) return doc;
  return { wrote: doc.wrote || listed.wrote, at: Math.max(doc.at, listed.at) };
}
const docSub = (agent, path) => {
  if (path === '@summary') return 'What this session remembers of its earlier conversation, written when it was compacted';
  const t = agent ? touchOf(agent.id, path) : null;
  return `${docLabel(agent, path)}${t ? ` · ${t.wrote ? 'written' : 'read'} by ${agent.name} at ${hhmm(t.at)}` : ''}`;
};

function docsHtml(a) {
  if (!a.docs?.length) return '';
  return `<div class="sec">Documents</div><div class="docs">${a.docs.map(d => {
    const dir = docLabel(a, d.path).split('/').slice(0, -1).join('/');
    return `<button class="doc" type="button" data-doc-agent="${esc(a.id)}" data-doc-path="${esc(d.path)}" data-tip="${esc(short(d.path))}"><span aria-hidden="true">📄</span><span class="doc-name">${esc(docName(d.path))}</span><span class="doc-dir faint">${esc(short(dir))}</span><span class="chip ${d.wrote ? 'c-warn' : 'c-plain'}">${d.wrote ? 'written' : 'read'}</span><span class="faint">${hhmm(d.at)}</span></button>`;
  }).join('')}</div>`;
}

const tabsOf = id => {
  if (!tabs.has(id)) tabs.set(id, { files: [], active: '' });
  return tabs.get(id);
};

function tabsHtml(a, t) {
  const agentTab = `<div class="tab${t.active ? '' : ' on'}"><button type="button" data-tab=""><span class="swatch" style="background:${colorOf(a.id)}"></span>${esc(a.name)}</button></div>`;
  return agentTab + t.files.map(f => `<div class="tab${t.active === f ? ' on' : ''}"><button type="button" data-tab="${esc(f)}" data-tip="${esc(f === '@summary' ? 'What this session remembers of its earlier conversation' : short(f))}">${f === '@summary' ? '🧠' : isMarkdown(f) ? '📄' : '⌗'} ${esc(fileLabel(f))}</button><button type="button" class="x" data-close-tab="${esc(f)}" aria-label="Close ${esc(fileLabel(f))}">✕</button></div>`).join('');
}

function readerHtml() {
  const agent = snap?.agents.find(a => a.id === reader.agentId);
  const live = Boolean(agent?.mod?.live);
  const hint = live ? 'Select text above, then Quote to reply about that part. ↩ sends, ⇧↩ new line.'
    : "This session isn't listening for dashboard messages yet. Send it anything in its terminal once, or start a new session.";
  return `<div class="reader-head">
      <div class="reader-title"><b>${reader.path === '@summary' ? '🧠' : isMarkdown(reader.path) ? '📄' : '⌗'} ${esc(fileLabel(reader.path))}</b><div class="faint mono" id="reader-sub">${esc(docSub(agent, reader.path))}</div></div>
      <span class="grow"></span>
      <button class="act" id="reader-reload" type="button">↻ Reload</button>
    </div>
    <article id="reader-body" class="${isMarkdown(reader.path) ? 'md' : 'codeview'}"></article>
    <div class="reader-foot compose">
      <textarea id="reader-text" rows="2" placeholder="Reply to ${esc(agent?.name ?? 'the agent')} about this file…"${live ? '' : ' disabled'}>${esc(readerDrafts.get(readerKey()) ?? '')}</textarea>
      <div class="compose-row"><span class="faint" id="reader-status">${hint}</span><span class="grow"></span><button class="act" id="reader-quote" type="button"${live ? '' : ' disabled'}>❝ Quote selection</button><button class="act primary" id="reader-send" type="button"${live ? '' : ' disabled'}>Send</button></div>
    </div>`;
}

const CODE_LINES = 20_000;
function codeHtml(text) {
  const lines = String(text).split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  // Each line is its own block, so no newline characters between them (they would add blank lines).
  const shown = lines.slice(0, CODE_LINES).map((l, i) => `<span class="l" data-n="${i + 1}">${esc(l)}</span>`).join('');
  const more = lines.length > CODE_LINES ? `<div class="empty">Showing the first ${CODE_LINES.toLocaleString()} of ${lines.length.toLocaleString()} lines.</div>` : '';
  return `<pre class="code"><code>${shown}</code></pre>${more}`;
}

/** Opens a file in a tab of the agent's centre view (or switches to it). */
async function openFile(agentId, path) {
  if (view === 'farm') setView('list'); // files open in the list view's tabs
  const t = tabsOf(agentId);
  if (!t.files.includes(path)) t.files.push(path);
  t.active = path;
  if (selected !== agentId) {
    selected = agentId;
    openChildren.clear();
  }
  render();
  renderTree();
  await viewerLoading;
}

function closeTab(path) {
  const a = centreAgent();
  if (!a) return;
  const t = tabsOf(a.id);
  const i = t.files.indexOf(path);
  if (i < 0) return;
  t.files.splice(i, 1);
  if (t.active === path) t.active = t.files[i] ?? t.files[i - 1] ?? '';
  render();
  renderTree();
}

async function loadDoc({ keepScroll = false } = {}) {
  if (!reader) return;
  const { agentId, path } = reader;
  let html;
  try {
    const r = await fetch(`/api/agent/${encodeURIComponent(agentId)}/file?path=${encodeURIComponent(path)}`, { headers: { 'x-tracker-token': TOKEN } });
    const body = await r.json();
    html = !r.ok ? `<div class="empty" style="padding:12px 16px">${esc(body.error ?? `Could not load it (HTTP ${r.status}).`)}</div>`
      : body.text === '' ? '<div class="empty" style="padding:12px 16px">This file is empty.</div>'
      : isMarkdown(path) ? renderMarkdown(body.text) : codeHtml(body.text);
  } catch (err) {
    html = `<div class="empty" style="padding:12px 16px">Could not load it: ${esc(err?.message ?? err)}</div>`;
  }
  if (reader?.agentId !== agentId || reader.path !== path) return;
  const box = $('reader-body');
  const top = box.scrollTop;
  box.innerHTML = html;
  if (keepScroll) box.scrollTop = top;
}

/** When the agent changes the open file, show the new text in place. */
function refreshReader() {
  if (!reader) return;
  const t = touchOf(reader.agentId, reader.path);
  if (!t || t.at <= reader.at) return;
  reader.at = t.at;
  const agent = snap.agents.find(a => a.id === reader.agentId);
  $('reader-sub').textContent = docSub(agent, reader.path);
  if (hasSelection()) $('reader-status').textContent = `${agent?.name ?? 'The agent'} changed this file. ↻ Reload to see it.`;
  else void loadDoc({ keepScroll: true });
}

const lineOf = node => Number((node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.l')?.dataset.n) || 0;
function captureReaderSelection() {
  if (!reader) return;
  const s = window.getSelection?.();
  if (!s || s.isCollapsed || !s.toString().trim()) return;
  const node = s.anchorNode;
  if (node && !$('reader-body').contains?.(node)) return;
  readerQuote = s.toString();
  const ends = [lineOf(s.anchorNode), lineOf(s.focusNode)].filter(Boolean);
  readerLines = ends.length ? [Math.min(...ends), Math.max(...ends)] : null;
}

function quoteSelection() {
  captureReaderSelection();
  const text = readerQuote.trim();
  if (!text) {
    $('reader-status').textContent = 'Select some text in the file first.';
    return;
  }
  const prev = readerDrafts.get(readerKey()) ?? '';
  const where = readerLines ? (readerLines[0] === readerLines[1] ? `Line ${readerLines[0]}:\n` : `Lines ${readerLines[0]}–${readerLines[1]}:\n`) : '';
  const quoted = where + text.split('\n').map(l => `> ${l}`.trimEnd()).join('\n');
  const next = `${prev}${prev && !prev.endsWith('\n\n') ? (prev.endsWith('\n') ? '\n' : '\n\n') : ''}${quoted}\n\n`;
  readerDrafts.set(readerKey(), next);
  const box = $('reader-text');
  box.value = next;
  box.focus?.();
  readerQuote = '';
  readerLines = null;
}

async function sendReaderReply() {
  if (!reader) return;
  const { agentId, path } = reader;
  const key = readerKey();
  const reply = (readerDrafts.get(key) ?? '').trim();
  if (!reply) {
    $('reader-status').textContent = 'Type a reply first.';
    return;
  }
  const agent = snap?.agents.find(a => a.id === agentId);
  const button = $('reader-send');
  button.disabled = true;
  button.textContent = 'Sending…';
  const r = await post('/api/actions/message', { agentId, text: `About ${docLabel(agent, path)}:\n\n${reply}` });
  button.disabled = false;
  button.textContent = 'Send';
  if (r.ok) {
    readerDrafts.delete(key);
    $('reader-text').value = '';
  }
  $('reader-status').textContent = r.ok
    ? (agent?.state === 'working' ? `Queued for ${agent.name}: it reads it when its current step ends.` : `✓ Sent to ${agent?.name ?? 'the session'}.`)
    : `Not sent: ${r.error}`;
}

/* ---------- the centre: the agent you're looking at, and the files you opened from it ---------- */

function centreAgent() {
  if (!snap) return null;
  let a = selected ? snap.agents.find(x => x.id === selected) : null;
  if (!a) {
    a = snap.agents.find(x => x.state === 'waiting' || x.state === 'working' || x.state === 'yourTurn') ?? snap.agents[0] ?? null;
    selected = a?.id ?? null;
  }
  return a;
}

function renderCentre() {
  const a = centreAgent();
  const body = $('center-body');
  if (!a) {
    $('center-tabs').innerHTML = '';
    body.className = 'center-body';
    body.innerHTML = '<div class="empty">No agents are running.</div>';
    shownKey = '';
    reader = null;
    return;
  }
  const t = tabsOf(a.id);
  if (t.active && !t.files.includes(t.active)) t.active = '';
  $('center-tabs').innerHTML = tabsHtml(a, t);
  const key = `${a.id}\n${t.active}`;
  if (!t.active) {
    reader = null;
    shownKey = key;
    body.className = 'center-body';
    body.innerHTML = overviewHtml(a);
  } else if (key !== shownKey) {
    shownKey = key;
    reader = { agentId: a.id, path: t.active, at: touchOf(a.id, t.active)?.at ?? 0 };
    readerQuote = '';
    readerLines = null;
    body.className = 'center-body viewing';
    body.innerHTML = readerHtml();
    $('reader-body').innerHTML = '<div class="empty" style="padding:12px 16px">Loading…</div>';
    viewerLoading = loadDoc();
  }
}
