// Broadcast: one message to several agents at once (every one that can take it, or the ones you tick),
// each getting it as your own message, as its message box would send it (queued while it is busy).
// Opened from the list view's 📣 Broadcast and the farm's Menu (a world's nav { what: 'broadcast' },
// which arms the click guard, so Send ignores clicks for a moment). Text only: files and folders go to
// one agent at a time, from its own box.

const bcPicked = new Set(); // the agents ticked, kept while the page is open
/** Whether a session can take a message from here: listening for the dashboard (its mod), and not Codex. */
const bcTakes = a => a.kind !== 'codex' && Boolean(a.mod?.live);
const bcWhyNot = a => (a.kind === 'codex' ? 'Codex takes no messages from here' : "Not listening yet: send it anything in its terminal once");
/** The quick picks: who each one ticks, of those that can take a message. */
const BC_PICKS = {
  all: () => true,
  needs: a => needsYou(a),
  working: a => a.state === 'working',
  resting: a => !needsYou(a) && (a.state === 'yourTurn' || a.state === 'idle'),
  none: () => false,
};

function openBroadcast() {
  $('bc-results').innerHTML = '';
  $('bc-status').textContent = '';
  renderBroadcast(true);
  if (!$('broadcast').open) $('broadcast').showModal();
  $('bc-text').focus?.();
}
function closeBroadcast() {
  if ($('broadcast').open) $('broadcast').close();
}

/** The list of agents to tick (what needs you first), and Send saying how many. Redrawn on each snapshot while open. */
function renderBroadcast(force = false) {
  if (!force && !$('broadcast').open) return;
  const agents = fsOrder();
  for (const id of [...bcPicked]) if (!agents.some(a => a.id === id && bcTakes(a))) bcPicked.delete(id); // gone, or no longer listening
  $('bc-list').innerHTML = agents.map(a => {
    const ok = bcTakes(a);
    return `<label class="bc-row${ok ? '' : ' off'}"${ok ? '' : ` data-tip="${esc(bcWhyNot(a))}"`}><input type="checkbox" data-bc-agent="${esc(a.id)}"${bcPicked.has(a.id) ? ' checked' : ''}${ok ? '' : ' disabled'}>`
      + `<span class="swatch" style="background:${fsColor(a)}"></span><span class="bc-main"><b>${esc(a.name)}</b><span>${esc(ok ? fsBrief(a) : bcWhyNot(a))}</span></span>`
      + `<span class="chip c-${a.state}">${STATE_CHIP[a.state] ?? esc(a.state)}</span></label>`;
  }).join('') || '<div class="empty">No agents are running.</div>';
  const n = bcPicked.size;
  $('bc-send').textContent = n ? `Send to ${n}` : 'Send';
  $('bc-count').textContent = `${n} of ${agents.filter(bcTakes).length} picked`;
}

async function sendBroadcast(button) {
  const text = String($('bc-text').value ?? '').trim();
  const to = (snap?.agents ?? []).filter(a => bcPicked.has(a.id) && bcTakes(a));
  if (!to.length) { $('bc-status').textContent = 'Pick at least one agent.'; return; }
  if (!text) { $('bc-status').textContent = 'Write the message first.'; $('bc-text').focus?.(); return; }
  button.disabled = true;
  button.textContent = 'Sending…';
  const sent = await Promise.all(to.map(async a => ({ a, r: await post('/api/actions/message', { agentId: a.id, text }) })));
  const failed = sent.filter(x => !x.r.ok);
  $('bc-results').innerHTML = sent.map(({ a, r }) => `<div class="${r.ok ? 'msg-ok' : 'msg-bad'}">${r.ok ? '✓' : '✗'} ${esc(a.name)}${r.ok
    ? (a.state === 'working' ? ' <span class="faint">queued: it reads it when its current step ends</span>' : '')
    : `: ${esc(r.error ?? 'not sent')}`}</div>`).join('');
  $('bc-status').textContent = failed.length ? `Sent to ${sent.length - failed.length} of ${sent.length}.` : `Sent to ${sent.length} agent${sent.length === 1 ? '' : 's'}.`;
  if (!failed.length) $('bc-text').value = '';
  button.disabled = false;
  renderBroadcast();
}

document.addEventListener('click', e => {
  const el = e.target?.closest?.('button');
  if (!el) return;
  const d = el.dataset ?? {};
  if (el.id === 'broadcast-open') { openBroadcast(); return; }
  if (d.bcClose !== undefined) { closeBroadcast(); return; }
  if (d.bcPick) {
    bcPicked.clear();
    for (const a of snap?.agents ?? []) if (bcTakes(a) && BC_PICKS[d.bcPick]?.(a)) bcPicked.add(a.id);
    renderBroadcast();
    return;
  }
  if (el.id === 'bc-send') void sendBroadcast(el);
});
document.addEventListener('change', e => {
  const id = e.target?.dataset?.bcAgent;
  if (id === undefined) return;
  if (e.target.checked) bcPicked.add(id); else bcPicked.delete(id);
  renderBroadcast();
});
// ⌘↩ (Ctrl+↩) sends: a plain ↩ is a new line, so one key can't send to several agents by accident.
document.addEventListener('keydown', e => {
  if (e.target?.id !== 'bc-text' || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing) return;
  e.preventDefault?.();
  void sendBroadcast($('bc-send'));
});
$('broadcast')?.addEventListener?.('click', e => { if (e.target === $('broadcast')) closeBroadcast(); }); // the backdrop
