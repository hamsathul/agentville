// The conversation dialog (⤢ Read all): a session's whole conversation, from its first message,
// oldest first, read on demand from its transcript, with search. While it is open, new messages
// are added at the bottom. Matches are painted with the CSS Highlight API, so no message is rewritten.
let convo = null; // { id, total, first, activity, loading, hits: [Range] oldest first, at: the current hit }
let convoTimer = 0; // a search waiting for typing to pause

const convoWhen = ms => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** One message as the dialog shows it, for reading: only the files a reply names open (in the file dialog). */
function convoBubble(m) {
  const when = `<time>${esc(convoWhen(m.at))}</time>`;
  if (m.kind === 'prompt') return `<div class="bub you"><div class="cv-text">${esc(m.body || m.text)}</div>${when}</div>`;
  if (m.kind === 'peer') {
    const head = m.dir === 'in' ? `from ${esc(m.other)}` : m.helper ? 'to a helper agent' : `to ${esc(m.other)}`;
    return `<div class="bub peer ${m.dir === 'in' ? 'in' : 'out'}"><div class="peer-head">✉ ${head}${m.summary ? ` · ${esc(m.summary)}` : ''}</div><div class="bub-md cv-text">${renderMarkdown(m.body || m.text)}</div>${when}</div>`;
  }
  return `<div class="bub agent"><div class="bub-md cv-text">${renderMarkdown(m.body || m.text)}</div>${namedSlotHtml(convo.id, m.body || m.text)}${when}</div>`;
}

async function fetchConversation(from) {
  try {
    const r = await fetch(`/api/agent/${encodeURIComponent(convo.id)}/conversation${from ? `?from=${from}` : ''}`, { headers: { 'x-tracker-token': TOKEN } });
    return r.ok ? await r.json() : { error: (await r.json().catch(() => ({}))).error ?? `The tracker said ${r.status}.` };
  } catch (err) {
    return { error: String(err) };
  }
}

const convoSub = () => {
  $('convo-sub').textContent = convo.total ? `${convo.total} message${convo.total === 1 ? '' : 's'} since ${convoWhen(convo.first)}` : '';
};

/** Whose conversation it is (a session's, or a subagent's: session:call), and when it last did something. */
function convoSubject(id) {
  const [sessionId, childId] = id.split(':');
  const a = snap?.agents.find(x => x.id === sessionId);
  if (!childId) return { title: `${a?.name ?? 'Session'} · conversation`, activity: a?.lastActivityAt };
  const c = a?.children?.find(x => x.id === childId);
  return { title: `${c?.agentType ?? 'subagent'} · ${c?.label ?? childId} · ${a?.name ?? 'a session'}'s subagent`, activity: c?.lastAt };
}

async function openConversation(id) {
  const who = convoSubject(id);
  convo = { id, total: 0, first: null, activity: who.activity, loading: true, hits: [], at: -1 };
  const mine = convo;
  $('convo-title').textContent = who.title;
  $('convo-sub').textContent = '';
  $('convo-q').value = '';
  $('convo-count').textContent = '';
  $('convo-body').innerHTML = '<div class="loading"><span class="spinner"></span>Reading the whole conversation…</div>';
  if (!$('convo').open) $('convo').showModal();
  renderConvoCompose();
  $('convo-q').focus?.(); // now, not once it has loaded: by then you may be typing a reply
  const r = await fetchConversation(0);
  if (convo !== mine) return; // closed, or another one opened meanwhile
  convo.loading = false;
  if (r.error) { $('convo-body').innerHTML = `<div class="empty">Could not read it: ${esc(r.error)}</div>`; return; }
  convo.total = r.total;
  convo.first = r.items[0]?.at ?? null;
  $('convo-body').innerHTML = r.items.map(convoBubble).join('') || '<div class="empty">Nothing has been said yet.</div>';
  convoSub();
  $('convo-body').scrollTop = $('convo-body').scrollHeight; // the newest at hand
}

/** While the dialog is open it follows the session: new messages are added at the bottom (called on each render). */
async function followConversation() {
  if (!convo || convo.loading || !$('convo').open) return;
  const activity = convoSubject(convo.id).activity;
  if (activity === undefined || activity === convo.activity) return;
  convo.activity = activity;
  convo.loading = true;
  const mine = convo;
  const r = await fetchConversation(convo.total);
  if (convo !== mine) return;
  convo.loading = false;
  if (r.error || !r.items.length) return;
  const body = $('convo-body');
  const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 40; // reading further up: stay there
  if (!convo.total) body.innerHTML = '';
  body.insertAdjacentHTML('beforeend', r.items.map(convoBubble).join(''));
  convo.total = r.total;
  convo.first ??= r.items[0].at;
  convoSub();
  if (atEnd) body.scrollTop = body.scrollHeight;
  if ($('convo-q').value.trim()) findInConversation(false); // count the new matches too; the view stays
}

/** The dialog's message box: the side panel's, with its own ids (redrawn on each render, held while you type in it). */
function renderConvoCompose() {
  if (!convo || !$('convo').open) return;
  const a = snap?.agents.find(x => x.id === convo.id);
  $('convo-compose').innerHTML = a ? composeHtml(a, 'convo-msg') : '';
}

function closeConversation() {
  convo = null;
  $('convo-compose').innerHTML = '';
  if ($('convo').open) $('convo').close();
  window.CSS?.highlights?.delete('convo-hit');
  window.CSS?.highlights?.delete('convo-now');
}

/** Every match of `q` in the messages' text (not their times), oldest first, as ranges. */
function matchRanges(q) {
  const hits = [];
  const find = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  for (const el of $('convo-body').querySelectorAll('.cv-text')) {
    const nodes = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let n = walk.nextNode(); n; n = walk.nextNode()) { nodes.push([n, text.length]); text += n.data; }
    const at = pos => { let k = nodes.length - 1; while (k > 0 && nodes[k][1] > pos) k--; return [nodes[k][0], pos - nodes[k][1]]; };
    for (const m of text.matchAll(find)) {
      const range = document.createRange();
      range.setStart(...at(m.index));
      range.setEnd(...at(m.index + m[0].length));
      hits.push(range);
    }
  }
  return hits;
}

/** Searches again: `jump` goes to the newest match; otherwise the current one stays. */
function findInConversation(jump = true) {
  if (!convo) return;
  const q = $('convo-q').value.trim();
  convo.hits = q ? matchRanges(q) : [];
  if (jump || convo.at < 0 || convo.at >= convo.hits.length) convo.at = convo.hits.length - 1;
  paintMatches(jump);
}

/** Older (-1, Enter) or newer (+1, Shift+Enter), round and round. */
function stepMatch(dir) {
  const n = convo?.hits.length;
  if (!n) return;
  convo.at = (convo.at + dir + n) % n;
  paintMatches(true);
}

function paintMatches(scroll) {
  const { hits, at } = convo;
  $('convo-count').textContent = !$('convo-q').value.trim() ? '' : hits.length ? `${hits.length - at} of ${hits.length}` : 'No matches';
  const marks = window.CSS?.highlights;
  if (marks && typeof Highlight === 'function') {
    marks.set('convo-hit', new Highlight(...hits));
    if (hits[at]) marks.set('convo-now', new Highlight(hits[at])); else marks.delete('convo-now');
  } else { // no Highlight API: the messages holding a match are outlined instead
    for (const b of $('convo-body').querySelectorAll('.cv-match, .cv-now')) b.classList.remove('cv-match', 'cv-now');
    hits.forEach((r, i) => r.startContainer.parentElement?.closest('.bub')?.classList.add(i === at ? 'cv-now' : 'cv-match'));
  }
  if (scroll && hits[at]) {
    const body = $('convo-body'), r = hits[at].getBoundingClientRect(), box = body.getBoundingClientRect();
    body.scrollTop += r.top - box.top - body.clientHeight / 2;
  }
}

document.addEventListener('click', e => {
  const b = e.target?.closest?.('button');
  if (b?.dataset?.convo !== undefined) void openConversation(b.dataset.convo);
  else if (b?.dataset?.convoClose !== undefined) closeConversation();
  else if (b?.id === 'convo-prev') stepMatch(-1);
  else if (b?.id === 'convo-next') stepMatch(1);
});
document.addEventListener('input', e => {
  if (e.target?.id !== 'convo-q') return;
  clearTimeout(convoTimer);
  convoTimer = setTimeout(() => { convoTimer = 0; findInConversation(true); }, 150);
});
document.addEventListener('keydown', e => {
  if (e.target?.id !== 'convo-q' || e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  if (convoTimer) { clearTimeout(convoTimer); convoTimer = 0; findInConversation(true); } // the words just typed first
  else stepMatch(e.shiftKey ? 1 : -1);
});
// Escape. The close event comes a moment after: by then the dialog may be open again, on another conversation.
$('convo').addEventListener('close', () => { if (convo && !$('convo').open) closeConversation(); });
$('convo').addEventListener('click', e => { if (e.target === $('convo')) closeConversation(); }); // the backdrop
