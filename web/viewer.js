// The file viewer: a file from the agent's folder (or a markdown document it opened elsewhere),
// read-only in a centre tab, with a reply box that messages the agent about it. Markdown is
// rendered, code shown with line numbers; pictures, PDFs, players and a page's preview come through
// short-lived links (an <img> can't send the token), Word documents and sheets as the collector reads them.
let reader = null; // { agentId, path, at, dialog?, mode, sheets? } for the file on screen
let loadSeq = 0; // the latest load: an earlier one that ends after it is dropped
const readerModes = new Map(); // agent id + path → Preview or Source, Page or Text, or the sheet shown
let readerQuote = '';
let readerLines = null; // [first, last] line numbers of the quoted code selection
const readerDrafts = new Map(); // agent id + path → half-typed reply
const readerKey = () => (reader ? `${reader.agentId}\n${reader.path}` : '');
const docName = path => String(path).split('/').pop();
const isMarkdown = path => path === '@summary' || /\.(md|markdown|mdx)$/i.test(path);

// How each file is shown, by its extension: the collector serves them the same way (collector/sources/previews.mjs).
const VIEW_EXTS = {
  image: 'png jpg jpeg gif webp avif svg ico bmp', pdf: 'pdf', video: 'mp4 m4v webm mov', audio: 'mp3 m4a wav ogg oga flac aac',
  html: 'html htm', word: 'docx doc rtf odt', sheet: 'xlsx csv', office: 'pptx ppt xls key pages numbers odp ods',
  binary: 'zip gz tgz tar 7z rar dmg exe bin so dylib class jar wasm sqlite db woff woff2 ttf otf',
};
const VIEW_OF_EXT = new Map(Object.entries(VIEW_EXTS).flatMap(([kind, exts]) => exts.split(' ').map(e => [e, kind])));
/** How the reader shows a file: text (markdown rendered, code with line numbers), or one of VIEW_EXTS's kinds. */
function viewKind(path) {
  if (path === '@summary') return 'text';
  return VIEW_OF_EXT.get(String(path).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '') ?? 'text';
}
const KIND_ICON = { text: '⌗', image: '🖼', pdf: '📕', video: '🎬', audio: '🎵', html: '🌐', word: '📝', sheet: '📊', office: '📽', binary: '📦' };
const fileIcon = path => (path === '@summary' ? '🧠' : isMarkdown(path) ? '📄' : KIND_ICON[viewKind(path)]);
// A page shows as itself or as its code; a Word document as a page or as its words; a sheet, one at a time.
const SHOW_AS = { html: [['preview', 'Preview'], ['source', 'Source']], word: [['page', 'Page'], ['text', 'Text']] };
const modeOf = (agentId, path) => readerModes.get(`${agentId}\n${path}`) ?? SHOW_AS[viewKind(path)]?.[0][0] ?? '';
/** Whether what's on screen is text to select and quote: code, markdown, a page's source, a document's words, a sheet's cells. */
function readerHasText() {
  const kind = viewKind(reader.path);
  return kind === 'text' || kind === 'sheet' || (kind === 'html' && reader.mode === 'source') || (kind === 'word' && reader.mode === 'text');
}
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
    return `<button class="doc" type="button" data-doc-agent="${esc(a.id)}" data-doc-path="${esc(d.path)}" data-tip="${esc(short(d.path))}"><span aria-hidden="true">${fileIcon(d.path)}</span><span class="doc-name">${esc(docName(d.path))}</span><span class="doc-dir faint">${esc(short(dir))}</span><span class="chip ${d.wrote ? 'c-warn' : 'c-plain'}">${d.wrote ? 'written' : 'read'}</span><span class="faint">${hhmm(d.at)}</span></button>`;
  }).join('')}</div>`;
}

const tabsOf = id => {
  if (!tabs.has(id)) tabs.set(id, { files: [], active: '' });
  return tabs.get(id);
};

function tabsHtml(a, t) {
  const agentTab = `<div class="tab${t.active ? '' : ' on'}"><button type="button" data-tab=""><span class="swatch" style="background:${colorOf(a.id)}"></span>${esc(a.name)}</button></div>`;
  const subs = subagentsOf(a); // their own tab, while it has any: the agent's own view keeps to the conversation
  const subTab = subs.length ? `<div class="tab${t.active === '@subagents' ? ' on' : ''}"><button type="button" data-tab="@subagents" data-tip="Its subagents: what each is doing, opened live">${subTabLabel(subs)}</button></div>` : '';
  return agentTab + subTab + t.files.map(f => `<div class="tab${t.active === f ? ' on' : ''}"><button type="button" data-tab="${esc(f)}" data-tip="${esc(f === '@summary' ? 'What this session remembers of its earlier conversation' : short(f))}">${fileIcon(f)} ${esc(fileLabel(f))}</button><button type="button" class="x" data-close-tab="${esc(f)}" aria-label="Close ${esc(fileLabel(f))}">✕</button></div>`).join('');
}

/** The reader body's look: markdown, code, a table, a document's words, or something shown whole (a picture, a player, a page). */
function bodyClass() {
  const kind = viewKind(reader.path);
  if (kind === 'text') return isMarkdown(reader.path) ? 'md' : 'codeview';
  if (kind === 'sheet') return 'sheetview';
  if (kind === 'html' && reader.mode === 'source') return 'codeview';
  if (kind === 'word' && reader.mode === 'text') return 'md';
  return 'mediaview';
}

function readerHtml() {
  const agent = snap?.agents.find(a => a.id === reader.agentId);
  const live = Boolean(agent?.mod?.live);
  const quotes = readerHasText();
  const hint = !live ? "This session isn't listening for dashboard messages yet. Send it anything in its terminal once, or start a new session."
    : quotes ? 'Select text above, then Quote to reply about that part. ↩ sends, ⇧↩ new line.' : `Tell ${agent?.name ?? 'the agent'} about this file. ↩ sends, ⇧↩ new line.`;
  const kind = viewKind(reader.path);
  const modes = SHOW_AS[kind] ? `<span class="seg" role="group" aria-label="Show it as">${SHOW_AS[kind].map(([m, label]) => `<button type="button" data-reader-mode="${m}" aria-pressed="${reader.mode === m}">${label}</button>`).join('')}</span>` : '';
  const reveal = kind !== 'text' ? '<button class="act" type="button" data-reader-reveal data-tip="Show it in ' + fileManager() + ', to open it in its own app">Show in ' + fileManager() + '</button>' : '';
  return `<div class="reader-head">
      <div class="reader-title"><b>${fileIcon(reader.path)} ${esc(fileLabel(reader.path))}</b><div class="faint mono" id="reader-sub">${esc(docSub(agent, reader.path))}</div></div>
      <span class="grow"></span>
      ${modes}${reveal}<button class="act" id="reader-reload" type="button">↻ Reload</button>${reader.dialog ? `<button class="act" id="reader-tab" type="button" data-tip="Open it in a tab of the list view">Open in a tab</button><button class="act" type="button" data-file-close aria-label="Close">×</button>` : ''}
    </div>
    <article id="reader-body" class="${bodyClass()}"></article>
    <div class="reader-foot compose">
      <textarea id="reader-text" rows="2" placeholder="Reply to ${esc(agent?.name ?? 'the agent')} about this file…"${live ? '' : ' disabled'}>${esc(readerDrafts.get(readerKey()) ?? '')}</textarea>
      <div class="compose-row"><span class="faint" id="reader-status">${hint}</span><span class="grow"></span>${quotes ? `<button class="act" id="reader-quote" type="button"${live ? '' : ' disabled'}>❝ Quote selection</button>` : ''}<button class="act primary" id="reader-send" type="button"${live ? '' : ' disabled'}>Send</button></div>
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

/** Opens a file in a tab of the agent's centre view (or switches to it); in the farm, in a dialog over it. */
async function openFile(agentId, path) {
  if (view === 'farm') return openFileDialog(agentId, path);
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

/** In the farm, a file opens in a dialog over it, which stays: the list view's reader, quoting and replying as there. */
async function openFileDialog(agentId, path) {
  reader = { agentId, path, at: touchOf(agentId, path)?.at ?? 0, dialog: true, mode: modeOf(agentId, path) };
  if (!$('file-dlg').open) $('file-dlg').showModal();
  await showReader();
}
/** Draws the reader (in its tab, or in the farm's dialog) and loads the file into it. */
async function showReader() {
  readerQuote = '';
  readerLines = null;
  $(reader.dialog ? 'file-dlg-body' : 'center-body').innerHTML = readerHtml();
  $('reader-body').innerHTML = emptyBox('Loading…');
  viewerLoading = loadDoc();
  await viewerLoading;
}
/** Preview or Source, Page or Text: remembered for that file, and drawn again. */
async function setReaderMode(mode) {
  if (!reader || !SHOW_AS[viewKind(reader.path)]?.some(([m]) => m === mode) || reader.mode === mode) return;
  readerModes.set(readerKey(), mode);
  reader.mode = mode;
  await showReader();
}
function closeFileDialog() {
  if (reader?.dialog) reader = null;
  $('file-dlg-body').innerHTML = '';
  if ($('file-dlg').open) $('file-dlg').close();
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

const emptyBox = html => `<div class="empty" style="padding:12px 16px">${html}</div>`;
const revealButton = () => `<button class="act" type="button" data-reader-reveal>Show in ${fileManager()}</button>`;

/** A token-only read: its JSON, or { error, status }. */
async function getJson(url) {
  const r = await fetch(url, { headers: { 'x-tracker-token': TOKEN } });
  const body = await r.json();
  return !r.ok || body.error ? { error: body.error ?? `Could not load it (HTTP ${r.status}).`, status: r.status } : body;
}

/** A sheet as a table, with its column letters and row numbers, and tabs for the workbook's other sheets. */
function sheetHtml(sheets, at) {
  const i = Math.min(Number(at) || 0, sheets.length - 1);
  const s = sheets[i];
  const tabs = sheets.length > 1 ? `<div class="seg sheet-tabs" role="group" aria-label="Sheets">${sheets.map((x, n) => `<button type="button" data-sheet="${n}" aria-pressed="${n === i}">${esc(x.name || `Sheet ${n + 1}`)}</button>`).join('')}</div>` : '';
  if (!s.rows.length) return tabs + emptyBox('This sheet is empty.');
  const cols = Math.max(1, ...s.rows.map(r => r.length));
  const letter = n => (n >= 26 ? letter(Math.floor(n / 26) - 1) : '') + String.fromCharCode(65 + (n % 26));
  const head = `<tr><th></th>${Array.from({ length: cols }, (_, c) => `<th>${letter(c)}</th>`).join('')}</tr>`;
  const cell = v => `<td${/^-?[\d,]*\.?\d+%?$/.test(v) ? ' class="num"' : ''}>${esc(v)}</td>`;
  const rows = s.rows.map((r, n) => `<tr><th>${n + 1}</th>${Array.from({ length: cols }, (_, c) => cell(r[c] ?? '')).join('')}</tr>`).join('');
  const cut = s.truncated ? '<div class="empty" style="padding:8px 12px">Showing the first 2,000 rows and 100 columns. Show in ' + fileManager() + ' to open it whole.</div>' : '';
  return `${tabs}<div class="sheet-wrap"><table class="sheet"><thead>${head}</thead><tbody>${rows}</tbody></table>${cut}</div>`;
}

/** What the reader shows of a file, as HTML: by its kind, and the mode chosen for it. */
async function docHtml({ agentId, path, mode }) {
  const kind = viewKind(path);
  const api = `/api/agent/${encodeURIComponent(agentId)}`, q = `path=${encodeURIComponent(path)}`;
  if (kind === 'text' || (kind === 'html' && mode === 'source')) {
    const body = await getJson(`${api}/file?${q}`);
    if (body.error) return emptyBox(`${esc(body.error)}${body.status === 413 || body.status === 415 ? ` ${revealButton()}` : ''}`);
    return body.text === '' ? emptyBox('This file is empty.') : isMarkdown(path) ? renderMarkdown(body.text) : codeHtml(body.text);
  }
  const name = esc(docName(path));
  if (kind === 'binary') return emptyBox(`A .${esc(path.split('.').pop().toLowerCase())} file can't be shown here. ${revealButton()} to open it in its own app.`);
  if (kind === 'word' || kind === 'sheet' || kind === 'office') {
    const body = await getJson(`${api}/office?${q}`);
    if (body.error) return emptyBox(`${esc(body.error)} ${revealButton()}`);
    if (body.view === 'sheet') {
      reader.sheets = body.sheets;
      return sheetHtml(body.sheets, mode);
    }
    if (body.view === 'word') {
      return mode === 'text' ? `<div class="doc-text">${esc(body.text)}</div>` // its words, to select and quote
        : `<iframe class="media-frame page" sandbox="" srcdoc="${esc(body.html.replace(/<head[^>]*>/i, h => `${h}<style>body { margin: 24px 32px; max-width: 820px; }</style>`))}" title="${name}"></iframe>`; // its look, with no scripts
    }
    return `<div class="media"><img class="page-pic" src="${esc(body.picture)}" alt="The first page of ${name}"></div><div class="media-meta faint">The first page, as Quick Look pictures it. Show in ${fileManager()} to open it in its own app.</div>`;
  }
  const link = await getJson(`${api}/ticket?${q}${kind === 'html' ? '&folder=1' : ''}`);
  if (link.error) return emptyBox(esc(link.error));
  const src = esc(link.url);
  if (kind === 'image') return `<div class="media"><img class="checker" id="reader-img" src="${src}" alt="${name}"></div><div class="media-meta faint" id="reader-media-meta">${sizeText(link.size)}</div>`;
  if (kind === 'pdf') return `<iframe class="media-frame" src="${src}" title="${name}"></iframe>`;
  if (kind === 'video') return `<div class="media"><video controls preload="metadata" src="${src}"></video></div>`;
  if (kind === 'audio') return `<div class="media"><audio controls preload="metadata" src="${src}"></audio></div>`;
  // A page, as itself: its scripts run, but in an origin of their own (no allow-same-origin), never the dashboard's.
  return `<iframe class="media-frame page" sandbox="allow-scripts" src="${src}" title="${name}"></iframe>`;
}

async function loadDoc({ keepScroll = false } = {}) {
  if (!reader) return;
  const seq = ++loadSeq;
  let html;
  try {
    html = await docHtml(reader);
  } catch (err) {
    html = emptyBox(`Could not load it: ${esc(err?.message ?? err)}`);
  }
  if (seq !== loadSeq || !reader) return;
  const box = $('reader-body');
  const top = box.scrollTop;
  box.innerHTML = html;
  if (keepScroll) box.scrollTop = top;
}

/** Another sheet of the workbook on screen, from what was read already. */
function showSheet(at) {
  if (!reader?.sheets) return;
  readerModes.set(readerKey(), String(at));
  reader.mode = String(at);
  $('reader-body').innerHTML = sheetHtml(reader.sheets, at);
}

/** A picture's own size, once it has loaded, beside its size on disk. */
function noteImageSize(img) {
  const meta = $('reader-media-meta');
  if (!meta || !img.naturalWidth || meta.dataset.sized) return;
  meta.dataset.sized = '1';
  meta.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${meta.textContent}`;
}

/** Shows the file in Finder: only reveals it, never opens or runs it. */
async function revealReaderFile() {
  if (!reader) return;
  const r = await post('/api/actions/reveal', { agentId: reader.agentId, path: reader.path });
  $('reader-status').textContent = r.ok ? `Shown in ${fileManager()}.` : `${fileManager()} could not show it: ${r.error}`;
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
    ? (r.held ? `Waiting for ${agent?.name ?? 'the session'} to finish: it goes out when this turn ends (remove or edit it under its message box).` : `✓ Sent to ${agent?.name ?? 'the session'}.`)
    : `Not sent: ${r.error}`;
}

/* ---------- files an agent names in its replies ---------- */
// A screenshot it took, a video it recorded, a plan it wrote: each path in a reply is checked once with
// the collector (only what the dashboard may show: inside its folder, scratchpad or memory, never ignored
// or secret files), then shows under the reply as a thumbnail or a chip that opens the file dialog.
const NAMED_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|pdf|mp4|m4v|webm|mov|mp3|m4a|wav|ogg|flac|aac|html?|docx?|rtf|odt|xlsx|csv|pptx?|key|pages|numbers|md|markdown|mdx)$/i;
const NAMED_FRESH_MS = 8 * 60_000; // a thumbnail's link lasts 10 minutes: asked again before then
const namedChecks = new Map(); // agent id + path as written → { ok, kind, path, url, at }
const namedWanted = new Map(); // agent id → paths to check
const namedAsking = new Set(); // agent id + path, being checked now
let namedTimer = 0;

/** The file paths a reply names, in the order they come: in backticks (spaces allowed there) or bare. */
function namedPaths(text) {
  const s = String(text ?? ''), found = [];
  for (const m of s.matchAll(/`([^`\n<>|]{1,300})`/g)) {
    const p = m[1].trim();
    if (NAMED_EXT.test(p) && (/^(?:~\/|\.{0,2}\/)/.test(p) || !/\s/.test(p))) found.push([m.index, p]);
  }
  for (const m of s.matchAll(/(?:^|[\s(\[<"'*])((?:~\/|\.{1,2}\/|\/)?[\w@%+~.-]+(?:\/[\w@%+~.-]+)*\.[A-Za-z0-9]{2,8})(?=$|[\s)\]>"'`*,;:!?]|\.(?:\s|$))/g)) {
    if (NAMED_EXT.test(m[1])) found.push([m.index, m[1]]);
  }
  return [...new Set(found.sort((x, y) => x[0] - y[0]).map(([, p]) => p))].slice(0, 12);
}

/** Under a reply: the files it names that can be shown, as a slot filled in again once they are checked. */
function namedSlotHtml(agentId, text) {
  const paths = namedPaths(text);
  if (!paths.length) return '';
  return `<div class="named-slot" data-named-agent="${esc(agentId)}" data-named-paths="${esc(JSON.stringify(paths))}">${namedInner(agentId, paths)}</div>`;
}
function namedInner(agentId, paths) {
  const now = Date.now(), shown = new Set(), out = [], ask = [];
  for (const p of paths) {
    const key = `${agentId}\n${p}`, k = namedChecks.get(key);
    if ((!k || now - k.at > NAMED_FRESH_MS) && !namedAsking.has(key)) ask.push(p);
    if (!k?.ok || shown.has(k.path)) continue;
    shown.add(k.path);
    const tip = esc(short(k.path));
    out.push(k.kind === 'image' && k.url
      ? `<button type="button" class="named-pic" data-open-named="${esc(k.path)}" data-agent="${esc(agentId)}" data-tip="${tip}"><img src="${esc(k.url)}" alt="${esc(docName(k.path))}" loading="lazy"></button>`
      : `<button type="button" class="named-file" data-open-named="${esc(k.path)}" data-agent="${esc(agentId)}" data-tip="${tip}">${fileIcon(k.path)} ${esc(docName(k.path))}</button>`);
  }
  if (ask.length) wantNamed(agentId, ask);
  return out.length ? `<div class="named">${out.join('')}</div>` : '';
}
function wantNamed(agentId, paths) {
  if (!namedWanted.has(agentId)) namedWanted.set(agentId, new Set());
  for (const p of paths) namedWanted.get(agentId).add(p);
  if (namedTimer) return;
  namedTimer = 1;
  setTimeout(() => void checkNamed(), 50); // one request for all the replies drawn together
}
async function checkNamed() {
  namedTimer = 0;
  const batch = [...namedWanted];
  namedWanted.clear();
  for (const [agentId, set] of batch) {
    const paths = [...set].slice(0, 20), keys = paths.map(p => `${agentId}\n${p}`);
    keys.forEach(k => namedAsking.add(k));
    let items = [];
    try {
      const r = await fetch(`/api/agent/${encodeURIComponent(agentId)}/named?${paths.map(p => `path=${encodeURIComponent(p)}`).join('&')}`, { headers: { 'x-tracker-token': TOKEN } });
      items = r.ok ? (await r.json()).items ?? [] : [];
    } catch { /* asked again later */ }
    const at = Date.now();
    keys.forEach(k => namedAsking.delete(k));
    for (const p of paths) namedChecks.set(`${agentId}\n${p}`, { ...(items.find(i => i.asked === p) ?? { ok: false }), at });
  }
  requestRender(); // not while you select text or type
  for (const el of document.querySelectorAll('#convo-body .named-slot')) el.innerHTML = namedInner(el.dataset.namedAgent, JSON.parse(el.dataset.namedPaths));
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
    if (!reader?.dialog) reader = null; // a file in the dialog stays open
    return;
  }
  const t = tabsOf(a.id);
  if (t.active && !t.files.includes(t.active) && !(t.active === '@subagents' && subagentsOf(a).length)) t.active = '';
  $('center-tabs').innerHTML = tabsHtml(a, t);
  const key = `${a.id}\n${t.active}`;
  if (!t.active || t.active === '@subagents') {
    if (!reader?.dialog) reader = null;
    shownKey = key;
    body.className = 'center-body';
    body.innerHTML = t.active ? subagentsHtml(a) : overviewHtml(a);
  } else if (key !== shownKey) {
    shownKey = key;
    reader = { agentId: a.id, path: t.active, at: touchOf(a.id, t.active)?.at ?? 0, mode: modeOf(a.id, t.active) };
    body.className = 'center-body viewing';
    void showReader();
  }
}
