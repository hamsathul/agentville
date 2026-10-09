// The parts of the page built from a snapshot: number tiles, top-bar stats, agent rows,
// repos, the answer form, the conversation, the message box (with attached files) and sending.
/* ---------- sections ---------- */

function kpisHtml() {
  const c = snap.counts;
  const asking = snap.agents.filter(a => a.question).length;
  const waiting = snap.agents.filter(a => a.state === 'waiting');
  const oldest = waiting.reduce((m, a) => Math.min(m, a.stateSince || Infinity), Infinity);
  const withSubagents = snap.agents.filter(a => a.children?.some(ch => ch.state === 'running')).length;
  const tiles = [
    ['k-waiting', '❓', 'Waiting on you', c.waiting, c.waiting ? `oldest waiting <b data-since="${oldest}"></b>` : 'all clear', c.waiting > 0],
    ['k-working', '▶', 'Working', c.working, withSubagents ? `${withSubagents} running subagents` : `${snap.agents.length} agents tracked`, false],
    ['k-turn', '↩', 'Your turn', c.yourTurn, `${asking ? `${asking} asks you · ` : ''}${c.idle} idle · ${c.stale} stale`, asking > 0],
    ['k-collide', '⚠', 'Collisions', c.collisions, c.collisions ? 'two agents writing one repo' : 'none', c.collisions > 0],
  ];
  return tiles.map(([k, icon, label, val, sub, hot]) => `<div class="kpi ${k}${hot ? ' hot' : ''}"><span>${icon}</span><span class="kpi-label">${label}</span><b class="val">${val}</b><span class="sub">${sub}</span></div>`).join('');
}

/** The agents' share of this Mac, in the top bar: memory by agent, and CPU as a share of all cores. */
// The plan's rate-limit windows, as Claude Code names them, in plain words.
const WINDOW_NAMES = { five_hour: '5-hour', seven_day: 'week', seven_day_opus: 'week · Opus', seven_day_sonnet: 'week · Sonnet', spend_limit: 'spend' };
const windowName = kind => WINDOW_NAMES[kind] ?? String(kind).replace(/_/g, ' ');
const resetText = ms => (!ms ? '' : ms - Date.now() < 86_400_000 ? `at ${hhmm(ms)}` : `${new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${hhmm(ms)}`);
const agoText = ms => { const m = Math.round((Date.now() - ms) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** The plan's usage (the 5-hour and weekly limits), from Claude Code's last API response in any session. */
function planHtml() {
  const plan = snap.plan;
  if (!plan?.windows?.length) return '';
  const said = w => `${windowName(w.kind)} limit: ${w.reset ? 'reset since the last reading' : `${Math.round(w.percentUsed)}% used${w.resetsAt ? `, resets ${resetText(w.resetsAt)}` : ''}`}`;
  const read = ` (Claude Code's reading, ${agoText(plan.at)})`;
  const meters = plan.windows.map(w => { const r = w.percentUsed / 100; return `${meter(r, severityOf(r, 0.7, 0.9), said(w) + read)}<b>${esc(windowName(w.kind))} ${Math.round(w.percentUsed)}%</b>`; }).join(' ');
  return `<span class="hstat" data-tip="${esc(`Your Claude plan: ${plan.windows.map(said).join(' · ')}${read}`)}"><span class="ml">Plan</span>${meters}</span>`;
}

function hstatsHtml() {
  const totalMb = snap.machine?.totalMemMb || 1;
  const withMem = snap.agents.filter(a => a.proc?.rssMb).sort((x, y) => y.proc.rssMb - x.proc.rssMb);
  const usedMb = withMem.reduce((t, a) => t + a.proc.rssMb, 0);
  const memBar = `<span class="hbar">${withMem.map(a => `<i style="width:${Math.max(1.5, (a.proc.rssMb / totalMb) * 100).toFixed(2)}%;background:${colorOf(a.id)}" data-tip="${esc(`${a.name} · ${gb(a.proc.rssMb)}`)}"></i>`).join('')}</span>`;
  const cores = snap.machine?.cpuCount || 1;
  const cpuUsed = snap.agents.reduce((t, a) => t + (a.proc?.cpu ?? 0), 0);
  const cpuRatio = cpuUsed / (cores * 100);
  return `<span class="hstat" data-tip="${esc(`Memory used by agents · ${withMem.map(a => `${a.name} ${gb(a.proc.rssMb)}`).join(' · ') || 'none'}`)}"><span class="ml">Agents RAM</span>${memBar}<b>${gb(usedMb)}</b><span class="faint">of ${gb(totalMb)}</span></span>
    <span class="hstat"><span class="ml">Agents CPU</span>${meter(cpuRatio, severityOf(cpuRatio, 0.5, 0.8), `${Math.round(cpuUsed)}% of one core · ${cores} cores`)}<b>${Math.round(cpuRatio * 100)}% of this Mac</b></span>
    ${planHtml()}`;
}

function askLine(a) {
  if (a.ask?.kind === 'question') return `❓ ${esc(a.ask.questions[0]?.question ?? a.stateReason)}`;
  if (a.ask?.kind === 'permission' || a.ask?.kind === 'always') return `🔐 <b>${esc(a.ask.tool)}</b> <span class="mono">${esc(a.ask.summary)}</span>`;
  return `❓ ${esc(a.stateReason)}`;
}

function metricsHtml(a) {
  const parts = [];
  if (a.proc) {
    const cpuHist = a.proc.history?.cpu ?? [];
    parts.push(`<div class="m" data-tip="CPU now ${Math.round(a.proc.cpu)}% · peak ${Math.round(Math.max(0, ...cpuHist))}% in 10 min"><span class="ml">CPU</span>${sparkline(cpuHist, colorOf(a.id), 100)}<span class="mv">${Math.round(a.proc.cpu)}%</span></div>`);
    const limitMb = (snap.settings?.memoryAlertGb ?? 2) * 1024;
    const sev = severityOf(a.proc.rssMb / limitMb, 0.6, 0.85);
    parts.push(`<div class="m"><span class="ml">RAM</span>${meter(a.proc.rssMb / limitMb, sev, `${gb(a.proc.rssMb)} of the ${gb(limitMb)} alert line`)}<span class="mv">${gb(a.proc.rssMb)}${sev === 'ok' ? '' : ' ⚠'}</span></div>`);
  }
  if (a.contextTokens) {
    const limit = a.contextTokens > 200_000 ? 1_000_000 : 200_000;
    const r = a.contextTokens / limit;
    parts.push(`<div class="m"><span class="ml">Context</span>${meter(r, severityOf(r, 0.7, 0.9), `${Math.round(a.contextTokens / 1000)}k of ${limit / 1000}k tokens`)}<span class="mv">${Math.round(r * 100)}%</span></div>`);
  }
  if (a.usage?.costUsd != null) parts.push(`<div class="m" data-tip="What this session has cost so far at API prices, as /cost shows it (on a subscription it comes out of your plan's limits, not a bill)"><span class="ml">Cost</span><span class="mv">$${a.usage.costUsd.toFixed(2)}</span></div>`);
  const heat = a.kind === 'codex' ? '' : heatStrip(a.activity);
  return `${parts.length ? `<div class="metrics">${parts.join('')}</div>` : ''}${heat}`;
}

/** One compact agent row: name and numbers, then one line of what it is doing. */
function rowHtml(a) {
  const sub = a.state === 'waiting' ? `${askLine(a)} · <span data-since="${a.stateSince}"></span>`
    : a.now ? `<span class="pulse"></span><span class="mono">${esc(a.now.tool)} ${esc(a.now.summary)} · <span data-since="${a.now.startedAt}"></span></span>`
    : a.question ? `❓ ${esc(a.question)}`
    : a.state === 'yourTurn' ? esc(a.lastReply ?? 'finished')
    : '';
  const nums = a.state === 'stale' ? `<span class="rn">${ago(a.lastActivityAt)}</span>`
    : a.proc ? `<span class="rn">${Math.round(a.proc.cpu)}%</span><span class="rn">${gb(a.proc.rssMb)}</span>` : '';
  return `<button class="row ${a.state}${a.id === selected ? ' sel' : ''}" data-id="${esc(a.id)}" data-tip="${esc(`${short(a.cwd)}${a.kind === 'background' ? ' · background' : ''}`)}">
    <span class="rtop"><span class="swatch" style="background:${colorOf(a.id)}"></span><span class="name">${esc(a.name)}</span>${a.ask ? '<span class="chip c-waiting live-dot">answer here</span>' : a.question ? '<span class="chip c-yourTurn">asks you</span>' : ''}<span class="grow"></span>${nums}</span>${sub ? `<span class="rsub">${sub}</span>` : ''}</button>`;
}

function listHtml() {
  let html = '';
  for (const [state, title] of GROUPS) {
    const agents = snap.agents.filter(a => a.state === state);
    if (!agents.length) continue;
    const open = isOpen(state);
    html += groupHead(state, title, agents.length, state === 'stale' && open ? '<button class="act mini" id="open-cleanup" type="button">Clean up…</button>' : '');
    if (open) html += agents.map(rowHtml).join('');
  }
  return html || '<div class="empty">No agents are running.</div>';
}

const runLink = url => (typeof url === 'string' && url.startsWith('https://github.com/') ? url : null);
// Permission modes a session can run in, as the dashboard names them.
const MODES = [['default', 'Ask first'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan mode'], ['auto', 'Auto'], ['bypassPermissions', 'Bypass permissions']];
const modeName = mode => (MODES.find(([m]) => m === mode)?.[1] ?? { manual: 'Ask first', dontAsk: "Don't ask" }[mode] ?? mode);

/** Whether a session's mod can switch its model and answer side questions (it is listening, and 0.5.0 or newer). */
function modCan(a, needs = '0.5.0') {
  const v = String(a.mod?.version ?? '0').split('.').map(n => Number.parseInt(n, 10) || 0), w = needs.split('.').map(Number);
  const atLeast = v[0] !== w[0] ? v[0] > w[0] : (v[1] ?? 0) !== w[1] ? (v[1] ?? 0) > w[1] : (v[2] ?? 0) >= w[2];
  return Boolean(a.mod?.live) && atLeast;
}
const modWhy = a => (!a.mod?.live ? "The session isn't listening for the dashboard yet (send it anything in its terminal once)"
  : `Its tracker mod is older (${a.mod.version}): run /reload-plugins in the session (or resume it) to do this from here`);

// Models to switch to (aliases: the newest of each), and effort levels.
const MODELS = [['opus', 'Opus'], ['opus[1m]', 'Opus, 1M context'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable'], ['default', 'Your default']];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** A model id in short: claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5. */
function modelName(id) {
  const m = String(id ?? '').match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : String(id ?? '');
}
/** The model a session is on: what /model last set (shown before a reply from it), else the model of its last reply. */
const modelOf = a => a.modelLabel ?? a.model;

/** A terminal session's bar: its permission mode, Restart in… another mode, and End session. */
function sessionBarHtml(a) {
  if (a.kind === 'background' && a.state === 'stale' && a.cliId) { // an old background session: it can only be removed
    return `<div class="sessbar"><span class="chip c-plain" data-tip="A background session with no activity for a day or more">background · stale</span>
      <button type="button" class="act mini" data-remove-session="${esc(a.id)}" data-tip="Delete this background session and its conversation (claude rm)">Remove</button></div>`;
  }
  if (a.kind !== 'interactive' || !a.pid) return '';
  const mode = a.mode, bypass = mode === 'bypassPermissions';
  const options = MODES.map(([m, label]) => `<option value="${m}"${m === mode ? ' disabled' : ''}>${esc(label)}${m === mode ? ' (now)' : ''}</option>`).join('');
  const chip = mode
    ? `<span class="chip ${bypass ? 'c-crit' : mode === 'plan' ? 'c-warn' : 'c-plain'}" data-tip="Its permission mode (Shift+Tab in its terminal changes it). Restart in… resumes it in another mode.">${bypass ? '⚠ ' : ''}${esc(modeName(mode))}</span>`
    : '<span class="chip c-plain" data-tip="The session has not written its mode down yet; it shows after its next step">mode not known yet</span>';
  // Model and effort: switched in the session itself (/model, /effort), through its mod, after its current turn.
  const live = modCan(a), off = live ? '' : ' disabled';
  const why = live ? 'Runs /model in the session after its current turn, as if you typed it. Claude Code also saves it as your default for new sessions.' : modWhy(a);
  const models = MODELS.map(([m, label]) => `<option value="${esc(m)}">${esc(label)}</option>`).join('');
  const efforts = EFFORTS.map(e => `<option value="${e}"${e === a.effort ? ' disabled' : ''}>${e}${e === a.effort ? ' (now)' : ''}</option>`).join('');
  const note = a.setting && Date.now() - a.setting.at < 120_000
    ? `<span class="${a.setting.ok ? 'msg-ok' : 'msg-bad'} set-note" data-tip="${esc(a.setting.text)}">${a.setting.ok ? '✓' : '✗'} ${esc(a.setting.text ? a.setting.text.replace(/`/g, '').slice(0, 80) : `/${a.setting.command} ${a.setting.args}`)}</span>`
    : '';
  return `<div class="sessbar">${chip}
    <select class="act mini" data-switch-model data-agent="${esc(a.id)}" aria-label="Switch this session's model" data-tip="${esc(why)}"${off}><option value="">${esc(modelOf(a) ? modelName(modelOf(a)) : 'Model…')}</option>${models}</select>
    <select class="act mini" data-switch-effort data-agent="${esc(a.id)}" aria-label="Set this session's effort" data-tip="${esc(live ? 'Runs /effort in the session after its current turn. Claude Code saves low to xhigh as your default for new sessions; max is for this session only.' : why)}"${off}><option value="">effort: ${esc(a.effort ?? 'default')}</option>${efforts}</select>
    <select class="act mini" data-restart-mode data-agent="${esc(a.id)}" aria-label="Restart this session in another permission mode"><option value="">Restart in…</option>${options}</select>
    <button type="button" class="act mini" data-compact="${esc(a.id)}" data-tip="${esc(modCan(a, '0.6.0') ? 'Runs /compact in the session after its current turn: the conversation so far becomes a summary, freeing its context' : !a.mod?.live ? modWhy(a) : `Compacting from here needs tracker mod 0.6.0 (this session runs ${a.mod.version}): run /reload-plugins in it`)}"${modCan(a, '0.6.0') ? '' : ' disabled'}>Compact…</button>
    <button type="button" class="act mini" data-end-session="${esc(a.id)}" data-tip="End this session and close its terminal window (resume it later from ＋ Session)">End session</button>${note}</div>`;
}

/**
 * An in-page yes/no question: resolves true for the OK button, false for Cancel or Escape. With a
 * `note` (its placeholder), it has a line to fill in too, read from #confirm-note once confirmed.
 */
let confirmResolve = null;
function confirmBox(text, okLabel = 'OK', note = '') {
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = okLabel;
  $('confirm-note').hidden = !note;
  $('confirm-note').value = '';
  $('confirm-note').placeholder = note;
  if (!$('confirm').open) $('confirm').showModal();
  return new Promise(resolve => { confirmResolve?.(false); confirmResolve = resolve; });
}
function settleConfirm(yes) {
  const resolve = confirmResolve;
  confirmResolve = null;
  if ($('confirm').open) $('confirm').close();
  resolve?.(yes);
}

/** A repo's last deploy (the collector's lastDeploy: the newer of its Actions run and a deploy an agent ran itself). */
function deployChip(d) {
  if (!d) return '';
  const href = d.url ? runLink(d.url) : null;
  const cls = { ok: 'c-good', failed: 'c-crit', running: 'c-warn live-dot' }[d.state] ?? 'c-plain';
  return href
    ? `<a class="chip ${cls}" href="${esc(href)}" target="_blank" rel="noopener" data-tip="${esc(d.detail ?? '')}">${esc(d.label)}</a>`
    : `<span class="chip ${cls}" data-tip="${esc(d.detail ?? '')}">${esc(d.label)}</span>`;
}

function railHtml() {
  const colliding = new Set(snap.collisions.map(c => c.repo));
  const who = ids => ids.map(id => {
    const a = snap.agents.find(x => x.id === id);
    return `<span class="chip c-plain"><i class="key" style="background:${colorOf(id)}"></i>${esc(a?.name ?? id)}</span>`;
  }).join(' ');
  let html = snap.collisions.length
    ? `<div class="sec">⚠ Collisions · ${snap.collisions.length}</div>${snap.collisions.map(c => `<div class="card collide"><div class="top"><span class="chip c-serious">⚠ ${esc(c.severity)}</span><b>${esc(c.repo.split('/').pop())}</b></div><div class="muted" style="margin-top:4px">${esc(c.reason)} · since ${clock(c.since)}</div><div class="badges">${who(c.agentIds)}</div></div>`).join('')}`
    : '';
  html += groupHead('repos', 'Repos', snap.repos.length);
  if (!isOpen('repos')) return html;
  html += snap.repos.map(r => {
    const dirty = r.dirty ?? 0;
    const dirtyMeter = r.dirty === undefined ? '' : `<div class="m" style="margin-top:8px"><span class="ml">Changes</span>${meter(Math.min(dirty, 20) / 20, severityOf(dirty / 20, 0.5, 0.9), `${dirty} uncommitted file${dirty === 1 ? '' : 's'}`)}<span class="mv">${dirty ? `${dirty} uncommitted` : 'clean ✓'}</span></div>`;
    const sync = r.ahead === undefined ? '' : `<span class="chip c-plain" data-tip="against origin, as of the last fetch">↑${r.ahead} ↓${r.behind}</span>`;
    const agents = r.agentIds.length ? `<span class="chip ${colliding.has(r.path) ? 'c-serious' : 'c-plain'}">${r.agentIds.length} agent${r.agentIds.length > 1 ? 's' : ''}</span>` : '';
    return `<div class="card${colliding.has(r.path) ? ' collide' : ''}" title="${esc(r.path)}"><div class="top"><b>${esc(r.name)}</b><span class="chip c-plain">⎇ ${esc(r.branch ?? '?')}</span>${deployChip(r.lastDeploy)}</div>${dirtyMeter}<div class="badges">${sync}${agents}${who(r.agentIds)}</div></div>`;
  }).join('') || '<div class="empty">No repos touched in the last 30 minutes.</div>';
  return html;
}

function feedRow(f) {
  const what = f.kind === 'tool' ? `🔧 <b>${esc(f.tool)}</b> ${esc(f.text)}` : f.kind === 'prompt' ? `👤 ${esc(f.text)}` : `💬 ${esc(f.text)}`;
  let result = '';
  if (f.kind === 'tool') {
    if (f.ok === undefined) result = '<span class="faint">running…</span>';
    else {
      const ms = f.durationMs ?? 0;
      const width = Math.max(4, Math.min(64, (Math.log10(ms + 1) / Math.log10(600_001)) * 64));
      result = `<span class="dur${f.ok ? '' : ' bad'}" data-tip="${f.ok ? 'Succeeded' : 'Failed'} after ${(ms / 1000).toFixed(1)}s"><i style="width:${width.toFixed(0)}px"></i>${f.ok ? '✓' : '✗'} ${(ms / 1000).toFixed(1)}s</span>`;
    }
  }
  return `<div><span class="t mono">${hhmm(f.at)}</span><span class="what">${what}</span><span>${result}</span></div>`;
}

function draftFor(toolUseId) {
  if (!drafts.has(toolUseId)) drafts.set(toolUseId, { picks: new Map(), other: new Map() });
  return drafts.get(toolUseId);
}

/** The answer form at the top of a waiting agent's drawer. */
function askHtml(a) {
  const ask = a.ask;
  if (!ask) {
    return a.state === 'waiting'
      ? `<div class="ask"><div class="sec" style="margin-top:0">${a.stateReason === 'question pending' ? '❓' : '🔐'} Waiting on you</div><div>${askLine(a)}</div>
          <div class="muted" style="margin-top:6px">The dashboard can't answer this one, so answer it in its terminal. (Its session isn't listening for dashboard answers: it may have started before the Agentville mod was installed.)</div></div>`
      : '';
  }
  const ids = `data-agent="${esc(a.id)}" data-tool="${esc(ask.toolUseId)}"`;
  if (ask.kind === 'permission') {
    return `<div class="ask"><div class="sec" style="margin-top:0">🔐 Permission needed</div>
      <div><b>${esc(ask.tool)}</b> wants to run:</div><div class="now mono" style="margin:5px 0 7px">${esc(ask.summary)}</div>
      <div class="muted" style="margin-bottom:8px">Moves to the terminal prompt in <b data-until="${ask.expiresAt}"></b></div>
      <button class="act primary" id="ask-allow" ${ids}>Allow</button>${modCan(a, '0.6.0') ? `<button class="act" id="ask-always" ${ids} data-tip="Allow it, then pick one of Claude Code's own options to keep, as its terminal offers them: a rule, a folder, or a mode">Always allow…</button>` : ''}<button class="act" id="ask-deny" ${ids}>Deny</button></div>`;
  }
  if (ask.kind === 'always') { // after Always allow…: Claude Code's own options for the call, each by its place
    return `<div class="ask"><div class="sec" style="margin-top:0">🔐 Always allow</div>
      <div><b>${esc(ask.tool)}</b> <span class="mono">${esc(ask.summary)}</span></div>
      <div class="muted" style="margin:6px 0 8px">Claude Code's options for it: pick one, and it runs with that kept. Moves to the terminal prompt in <b data-until="${ask.expiresAt}"></b></div>
      <div class="always-opts">${ask.options.map(o => `<button type="button" class="act" data-always-pick="${o.option}" ${ids}>${esc(o.label)}</button>`).join('')}</div>
      <button type="button" class="act" id="always-cancel" data-always-pick="cancel" ${ids}>Cancel</button></div>`;
  }
  const d = draftFor(ask.toolUseId);
  const questions = ask.questions.map((q, qi) => {
    const picks = d.picks.get(qi) ?? new Set();
    const type = q.multiSelect ? 'checkbox' : 'radio';
    const field = `data-tool="${esc(ask.toolUseId)}" data-q="${qi}"`;
    const options = q.options.map(o => `<label class="opt"><input type="${type}" name="${esc(ask.toolUseId)}-${qi}" value="${esc(o.label)}" ${field}${picks.has(o.label) ? ' checked' : ''}> <span>${esc(o.label)}${o.description ? ` <span class="muted">— ${esc(o.description)}</span>` : ''}</span></label>`).join('');
    return `<fieldset><legend>${q.header ? `<span class="pill">${esc(q.header)}</span> ` : ''}${esc(q.question)}</legend>${options}
      <input type="text" class="other" placeholder="Other…" ${field} value="${esc(d.other.get(qi) ?? '')}"></fieldset>`;
  }).join('');
  return `<div class="ask"><div class="sec" style="margin-top:0">❓ Needs your answer</div>${questions}<button class="act primary" id="ask-send" ${ids}>Send answer</button></div>`;
}

/** Your prompts (typed or sent from here) and the agent's replies, oldest first, like a chat. */
/** The feed to show: the whole history once Show all has loaded it, else the snapshot's latest. */
const feedOf = a => fullFeeds.get(a.id)?.items ?? a.feed;

/** A message the snapshot only previews: the button loads the whole history, where it is complete. */
const moreHtml = (a, f) =>
  f.more ? `<button type="button" class="act mini bub-more" data-full-feed="${esc(a.id)}">Show the whole message</button>` : '';

function conversationHtml(a) {
  const all = fullFeeds.has(a.id);
  const said = feedOf(a).filter(f => f.kind === 'prompt' || f.kind === 'reply' || f.kind === 'peer').slice(0, all ? Infinity : 10); // newest first, under the box
  if (!said.length) return '';
  // Replies are markdown (rendered by the escape-everything renderer); your prompts stay as typed.
  // Reply on an agent message quotes it into the message box.
  const peer = f => `<div class="bub peer ${f.dir === 'in' ? 'in' : 'out'}"><div class="peer-head">✉ ${f.dir === 'in' ? `from ${esc(f.other)}` : f.helper ? 'to a helper agent' : `to ${esc(f.other)}`}${f.summary ? ` · ${esc(f.summary)}` : ''}</div><div class="bub-md">${renderMarkdown(f.body || f.text)}</div>${moreHtml(a, f)}<time>${hhmm(f.at)}</time></div>`;
  const bubble = f => (f.kind === 'peer' ? peer(f) : f.kind === 'prompt'
    ? `<div class="bub you">${esc(f.body || f.text)}${moreHtml(a, f)}<time>${hhmm(f.at)}</time></div>`
    : `<div class="bub agent"><div class="bub-md">${renderMarkdown(f.body || f.text)}</div>${namedSlotHtml(a.id, f.body || f.text)}${moreHtml(a, f)}<time>${hhmm(f.at)}<button type="button" class="bub-reply" data-quote="${esc(f.body || f.text)}" data-agent="${esc(a.id)}" title="Quote this in your reply">↩ Reply</button></time></div>`);
  // The newest message is framed as the latest, with your message when it is right below it: a quick
  // exchange frames the pair, a long working turn only its newest note.
  const cut = said[0].kind !== 'prompt' && said[1]?.kind === 'prompt' ? 2 : 1;
  const readAll = a.kind === 'codex' ? '' : `<span class="grow"></span><button type="button" class="act mini" data-convo="${esc(a.id)}" data-tip="The whole conversation, from its first message, with search">⤢ Read all</button>`;
  return `<div class="sec">Conversation${readAll}</div><div class="chat"><div class="latest" role="group" aria-label="The latest message"><span class="latest-tag">Latest</span>${said.slice(0, cut).map(bubble).join('')}</div>${said.slice(cut).map(bubble).join('')}</div>`;
}

/** The tool steps, newest first (the conversation is shown on its own); Show all loads the whole history. */
function activityHtml(a) {
  const all = fullFeeds.has(a.id);
  const steps = feedOf(a).filter(f => f.kind === 'tool');
  const links = a.kind === 'codex' ? '' : `<span class="grow"></span><button type="button" class="act mini" data-full-feed="${esc(a.id)}">${all ? 'Show less' : 'Show all'}</button><a class="act mini" href="/agent/${encodeURIComponent(a.id)}/transcript" target="_blank" rel="noopener">Full transcript ↗</a>`;
  return `<div class="sec">Activity${all ? ` · ${steps.length} steps` : ''}${links}</div><div class="feed">${steps.slice(0, all ? Infinity : 25).map(feedRow).join('') || '<div class="empty">No tool steps yet.</div>'}</div>`;
}

/** A question the agent ended its turn with: yes/no ones get one-click answers. */
const YES_NO = /^(should|shall|do|does|did|can|could|would|will|is|are|am|want|may|have|has|ok|okay)\b/i;
function questionHtml(a) {
  if (!a.question) return '';
  const live = Boolean(a.mod?.live);
  const off = live ? '' : ' disabled';
  const buttons = YES_NO.test(a.question)
    ? `<div class="qbtns"><button type="button" class="act primary" data-quick-reply="Yes." data-agent="${esc(a.id)}"${off}>Yes</button><button type="button" class="act" data-quick-draft="No, " data-agent="${esc(a.id)}"${off}>No…</button></div>`
    : '';
  return `<div class="qcard"><div class="sec" style="margin-top:0">↩ ${esc(a.name)} asks you</div><div class="qtext">${esc(a.question)}</div>${buttons}
    <div class="muted" style="font-size:12px">${live ? 'Or answer in your own words in the message box below.' : "This session isn't listening for dashboard messages yet: answer it in its terminal."}</div></div>`;
}

/**
 * Chat box: sends a message, with any attached files, into the session as the person's own words (queued if it is busy).
 * `ids` names its parts: msg-text, msg-send… in the side panel; convo-msg-… in the conversation dialog, which shares its draft and files.
 */
function composeHtml(a, ids = 'msg') {
  if (a.kind === 'codex') return '';
  const live = Boolean(a.mod?.live);
  const hint = !live ? "This session isn't listening for dashboard messages yet. Send it anything in its terminal once, or start a new session."
    : a.state === 'working' ? `${esc(a.name)} is busy: your message waits until its current step ends. ↩ sends, ⇧↩ new line.`
    : 'Sent as your own message. Paste or drop files on the box. ↩ sends, ⇧↩ new line.';
  const sent = msgStatus.get(a.id);
  const status = sent && Date.now() - sent.at < 20_000
    ? `<span id="${ids}-status" class="${sent.bad ? 'msg-bad' : 'msg-ok'}">${esc(sent.text)}</span>`
    : `<span id="${ids}-status" class="faint">${hint}</span>`;
  const files = msgFiles.get(a.id) ?? [];
  const thumbs = files.length ? `<div class="thumbs">${files.map((f, i) => `<span class="${f.url ? 'thumb' : f.folder ? 'thumb thumb-file thumb-folder' : 'thumb thumb-file'}" data-tip="${esc(f.folder ?? `${f.name} · ${sizeText(f.size)}`)}">${f.url
    ? `<img src="${esc(f.url)}" alt="${esc(f.name)}">`
    : `<span class="thumb-ext">${f.folder ? 'folder' : esc(extOf(f.name))}</span><span class="thumb-name">${esc(f.name)}</span>`}<button type="button" class="thumb-x" data-remove-file="${i}" data-agent="${esc(a.id)}" aria-label="Remove ${esc(f.name)}">✕</button></span>`).join('')}</div>` : '';
  return `<div class="compose" data-agent="${esc(a.id)}" style="margin-top:10px"><textarea id="${ids}-text" data-msg-agent="${esc(a.id)}" rows="2" placeholder="Message ${esc(a.name)}…"${live ? '' : ' disabled'}>${esc(msgDrafts.get(a.id) ?? '')}</textarea>${thumbs}
    <div class="compose-row">${status}<span class="grow"></span><button class="act" id="${ids}-attach" type="button" data-agent="${esc(a.id)}" data-tip="Attach files: screenshots, PDFs, Markdown, text… (you can also paste or drop them on the box)"${live ? '' : ' disabled'}>📎 Attach</button><button class="act" id="${ids}-folder" type="button" data-agent="${esc(a.id)}" data-tip="Attach a folder, picked in Finder: its path goes with the message, for the agent to look in"${live ? '' : ' disabled'}>📁 Folder</button><button class="act primary" id="${ids}-send" data-agent="${esc(a.id)}"${live ? '' : ' disabled'}>Send</button></div></div>`;
}

const subagentsOf = a => (a?.children ?? []).filter(c => c.kind === 'subagent');
/** The Subagents tab's label: how many, and a pulse while one is at work. */
const subTabLabel = subs => `Subagents${subs.length ? ` <span class="tab-n">${subs.length}</span>` : ''}${subs.some(c => c.state === 'running') ? '<span class="pulse"></span>' : ''}`;

/** A session's subagents (their own tab), a card each: its task, how long and how many steps, its step now, what it last said or its result. */
function subagentsHtml(a) {
  const subs = subagentsOf(a);
  if (!subs.length) return '<div class="empty">No subagents at work, or finished in the last hour.</div>';
  const running = subs.filter(c => c.state === 'running').length;
  const counts = [running && `${running} running`, subs.length - running && `${subs.length - running} finished lately`].filter(Boolean).join(' · ');
  return `<div class="sec">Subagents <span class="faint" style="text-transform:none;letter-spacing:0">${counts}</span></div>${subs.map(c => subCardHtml(a, c)).join('')}`;
}

function subCardHtml(a, c) {
  const open = openChildren.get(c.id), running = c.state === 'running';
  const steps = c.steps ? ` · ${c.steps} step${c.steps === 1 ? '' : 's'}` : '';
  const how = running ? `running · <span data-lasted="${c.startedAt}">${lasted(c.startedAt)}</span>${steps}`
    : c.endedAt ? `${c.state === 'failed' ? 'failed after' : 'done in'} ${took(c.endedAt - c.startedAt)}${steps}`
    : `${esc(c.state)}${steps}`;
  const now = running && c.now ? `<div class="sub-now mono">🔧 <b>${esc(c.now.tool)}</b> ${esc(c.now.summary)} · <span data-lasted="${c.now.startedAt}">${lasted(c.now.startedAt)}</span></div>` : '';
  const said = !running && c.result ? `<div class="sub-said">Result: “${esc(c.result)}”</div>` : c.lastSaid ? `<div class="sub-said">“${esc(c.lastSaid)}”</div>` : '';
  return `<div class="sub-card ${running ? 'running' : esc(c.state)}"><div class="sub-head"><button type="button" class="act mini" data-child="${esc(c.id)}" data-agent="${esc(a.id)}" aria-expanded="${Boolean(open)}" data-tip="${open ? 'Close' : 'What it was asked, its steps and words (followed while it works), and its result'}">${open ? '▾' : '▸'}</button><b>${esc(c.agentType ?? 'subagent')}</b><span class="sub-task">${esc(c.label)}</span><span class="grow"></span><button type="button" class="act mini" data-convo="${esc(`${a.id}:${c.id}`)}" data-tip="Its whole transcript, with search: the prompt, everything it said, its result">⤢ Read</button></div>
    <div class="sub-how faint">${how}</div>${now}${said}${open ? subDetailHtml(open) : ''}</div>`;
}

/** An open card: what it was asked, its latest steps and words (newest first), and its result once it has one. */
function subDetailHtml(open) {
  const d = open.data;
  if (!d) return '<div class="loading"><span class="spinner"></span>Reading it…</div>';
  if (d.error) return `<div class="empty">${esc(d.error)}</div>`;
  const steps = (d.feed ?? []).filter(f => f.kind !== 'prompt'); // its prompt is shown whole above
  return `<div class="sub-detail">${d.prompt ? `<div class="sub-label">What it was asked</div><div class="sub-prompt">${esc(d.prompt)}</div>` : ''}
    <div class="sub-label">Its steps and words, newest first</div><div class="feed">${steps.map(feedRow).join('') || '<div class="empty">Nothing yet.</div>'}</div>
    ${d.result ? `<div class="sub-label">Its result</div><div class="bub-md sub-result">${renderMarkdown(d.result)}</div>` : ''}</div>`;
}

/** A session's background jobs and workflows, a line each. */
/** Now, when nothing is running: since when it has been your turn and what it last said, or since when it has been idle or quiet. */
function restHtml(a) {
  const when = ms => (Date.now() - ms < 86_400_000 ? hhmm(ms) : new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
  const said = String(a.lastReply ?? '').split('\n').find(l => l.trim())?.trim().slice(0, 160);
  const text = a.state === 'yourTurn' ? `Your turn${a.stateSince ? ` since ${when(a.stateSince)}` : ''}${said ? ` · ${said}` : ''}`
    : a.state === 'idle' ? `Idle${a.stateSince ? ` since ${when(a.stateSince)}` : ''}`
    : a.state === 'stale' && a.lastActivityAt ? `Quiet since ${when(a.lastActivityAt)}`
    : a.stateReason;
  return `<div class="muted rest">${esc(text)}</div>`;
}

/** Its shell commands running now (from ps): how long, CPU and memory; Output for a background one; ■ Stop for any. */
function shellsHtml(a) {
  const shells = a.shells ?? [];
  if (!shells.length) return '';
  return `<div class="sec">Commands running <span class="tab-n">${shells.length}</span></div>${shells.map(s => `<div class="shell-row">
    <div class="shell-main"><code class="shell-cmd"${s.about ? ` data-tip="${esc(s.about)}"` : ''}>$ ${esc(s.command)}</code>
      <span class="faint shell-meta">${s.background ? 'background · ' : ''}<span data-lasted="${s.startedAt}">${lasted(s.startedAt)}</span> · ${Math.round(s.cpu)}% CPU · ${gb(s.rssMb)}</span></div>
    ${s.output ? `<button type="button" class="act mini" data-shell-output="${s.pid}" data-agent="${esc(a.id)}" data-tip="Its output so far, followed as it grows">Output</button>` : ''}<button type="button" class="act mini" data-shell-stop="${s.pid}" data-agent="${esc(a.id)}" data-tip="Stop it, with everything it started">■ Stop</button></div>`).join('')}`;
}

/** A background command's output, in a dialog, followed every 2 seconds while it is open. */
let shellView = null; // { agentId, pid, timer }
async function openShellOutput(agentId, pid) {
  const s = snap?.agents.find(a => a.id === agentId)?.shells?.find(x => x.pid === pid);
  if (!s) return;
  if (shellView?.timer) clearInterval(shellView.timer);
  shellView = { agentId, pid };
  $('shell-title').textContent = `$ ${s.command}`;
  $('shell-out').textContent = 'Loading…';
  if (!$('shell-dlg').open) $('shell-dlg').showModal();
  await refreshShellOutput();
  shellView.timer = setInterval(refreshShellOutput, 2000);
}
async function refreshShellOutput() {
  if (!shellView) return;
  const { agentId, pid } = shellView;
  let body;
  try {
    const r = await fetch(`/api/agent/${encodeURIComponent(agentId)}/shell-output?pid=${pid}`, { headers: { 'x-tracker-token': TOKEN } });
    body = await r.json();
  } catch (err) {
    body = { error: String(err) };
  }
  if (shellView?.pid !== pid) return;
  const box = $('shell-out');
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8; // keep following the end, unless you scrolled up
  box.textContent = body.error ? body.error : body.text || '(no output yet)';
  $('shell-sub').textContent = body.error ? '' : `${sizeText(body.size)}${body.truncated ? ' · its last 64 KB' : ''} · followed while open`;
  if (atEnd) box.scrollTop = box.scrollHeight;
}
function closeShellOutput() {
  if (shellView?.timer) clearInterval(shellView.timer);
  shellView = null;
  if ($('shell-dlg').open) $('shell-dlg').close();
}

/** ■ Stop: asks first, then ends the command and everything it started. */
async function stopShellFlow(agentId, pid) {
  const a = snap?.agents.find(x => x.id === agentId);
  const s = a?.shells?.find(x => x.pid === pid);
  if (!s) return;
  if (!(await confirmBox(`Stop “${s.command}”? It ends now, with everything it started, and ${a.name} sees the command end.`, 'Stop it'))) return;
  const r = await post('/api/actions/stop-shell', { agentId, pid });
  notice(r.ok ? `Stopped “${s.command}”.` : `Not stopped: ${r.error}`);
}

function jobsHtml(a) {
  const shown = new Set((a.shells ?? []).map(s => s.toolUseId).filter(Boolean)); // running: listed with its command, and Stop
  const jobs = (a.children ?? []).filter(c => c.kind !== 'subagent' && !shown.has(c.id));
  if (!jobs.length) return '';
  return `<div class="sec">Background jobs${jobs.some(c => c.kind === 'workflow') ? ' and workflows' : ''}</div>${jobs.map(c => `<div class="child"><b>${esc(c.kind === 'bgjob' ? 'job' : c.kind)}</b> ${esc(c.label)} <span class="chip ${c.state === 'running' ? 'c-working live-dot' : 'c-plain'}">${esc(c.state)}${c.now ? ` · ${esc(c.now.tool)}` : ''}</span></div>`).join('')}`;
}

/** Tokens in short, as the working line has them: 860, 28.5k, 1.2M. */
const tokensShort = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
/**
 * A working session's line, as its terminal shows it: Slithering… (5m 31s · ↓ 28.5k tokens · thinking
 * with xhigh effort). The word and what it is doing come from its mod; without one, from its steps.
 */
function workingLineHtml(a) {
  const t = a.turn;
  if (!t || a.state !== 'working') return '';
  const thinking = t.mode ? t.mode === 'thinking' : !a.now;
  const doing = thinking ? `thinking${a.effort ? ` with ${a.effort} effort` : ''}` : t.mode === 'responding' ? 'responding' : t.mode === 'requesting' ? 'waiting for the model' : '';
  return `<div class="workline"><span class="spin" aria-hidden="true"></span><b>${esc(t.word ?? (thinking ? 'Thinking' : 'Working'))}…</b> <span class="muted">(<span data-lasted="${t.startedAt}">${lasted(t.startedAt)}</span>${t.outTokens ? ` · ↓ ${tokensShort(t.outTokens)} tokens` : ''}${doing ? ` · ${doing}` : ''})</span>${stopHtml(a)}</div>`;
}
/** ■ Stop: cancels the running turn at once, as Esc in its terminal does (mod 0.7.0). */
function stopHtml(a) {
  if (a.kind === 'codex') return '';
  const can = modCan(a, '0.7.0');
  const tip = can ? 'Stop this turn now, as Esc does in its terminal: what it was doing stops and it waits for you. The conversation stays.'
    : !a.mod?.live ? modWhy(a) : `Stopping from here needs tracker mod 0.7.0 (this session runs ${a.mod.version}): run /reload-plugins in it, or press Esc in its terminal`;
  return ` <button type="button" class="act mini stop-turn" data-stop-turn="${esc(a.id)}" data-tip="${esc(tip)}"${can ? '' : ' disabled'}>■ Stop</button>`;
}

/** Side questions (/btw): asked of the session from its conversation so far, answered without adding to it, even while it works. */
function asideHtml(a) {
  if (a.kind === 'codex') return '';
  const live = modCan(a);
  const list = (a.asides ?? []).map(x => `<div class="aside"><div class="aside-q"><b>btw</b> ${esc(x.question)}</div>${x.pending
    ? '<div class="aside-a muted"><span class="spinner"></span> thinking…</div>'
    : x.answer ? `<div class="aside-a md">${renderMarkdown(x.answer)}</div>` : `<div class="aside-a msg-bad">No answer: ${esc(x.reason ?? 'unknown')}</div>`}</div>`).join('');
  // Its heading folds the whole section away (remembered, for every session); folded, it says how many it holds.
  const open = isOpen('btw'), count = (a.asides ?? []).length;
  const head = `<button class="sec sec-fold" type="button" data-group="btw" aria-expanded="${open}" data-tip="${open ? 'Hide' : 'Show'} side questions (/btw): answered from its conversation, not added to it; they work while it is busy"><span class="tw">${open ? '▾' : '▸'}</span>Side question${!open && count ? `<span class="grp-n">${count}</span>` : ''}</button>`;
  if (!open) return `<div class="asides-box">${head}</div>`;
  return `<div class="asides-box">${head}
    <div class="aside-row"><input type="text" id="aside-text" data-aside-agent="${esc(a.id)}" placeholder="${live ? `Ask ${esc(a.name)} something on the side…` : esc(modWhy(a))}" value="${esc(asideDrafts.get(a.id) ?? '')}"${live ? '' : ' disabled'}><button type="button" class="act" id="aside-send" data-agent="${esc(a.id)}"${live ? '' : ' disabled'}>Ask</button></div>${list}</div>`;
}

const sizeText = bytes => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A file name's extension, as its tile shows it: notes.md → md. */
const extOf = name => (/\.([^.]{1,8})$/.exec(name)?.[1] ?? 'file');

/** Files pasted, dropped or picked for an agent's next message: any kind, pictures shown as thumbnails. */
function addFiles(agentId, files) {
  const list = msgFiles.get(agentId) ?? [];
  let refused = '';
  for (const file of files) {
    const name = file?.name || 'file';
    if (!file?.size) { refused = `${name} is empty.`; continue; }
    if (file.size > MAX_FILE_BYTES) { refused = `${name} is too large (10 MB at most).`; continue; }
    if (list.length >= MAX_FILES) { refused = `At most ${MAX_FILES} files per message.`; break; }
    list.push({ file, url: IMAGE_TYPES.test(file.type ?? '') ? URL.createObjectURL(file) : null, name, size: file.size });
  }
  msgFiles.set(agentId, list);
  if (refused) msgStatus.set(agentId, { at: Date.now(), bad: true, text: refused });
  render();
}

/** 📁 Folder: Finder's folder window; the folder goes with the next message by its path (nothing is uploaded). */
async function attachFolder(agentId, button) {
  const agent = snap?.agents.find(a => a.id === agentId);
  button.disabled = true;
  const r = await post('/api/actions/choose-folder', { start: agent?.cwd || undefined, prompt: `Attach a folder to your message to ${agent?.name ?? 'the agent'}:` });
  button.disabled = false;
  const list = msgFiles.get(agentId) ?? [];
  if (r.ok && list.length >= MAX_FILES) msgStatus.set(agentId, { at: Date.now(), bad: true, text: `At most ${MAX_FILES} attachments per message.` });
  else if (r.ok && !list.some(f => f.folder === r.path)) msgFiles.set(agentId, [...list, { folder: r.path, name: r.path.split('/').pop() || r.path }]);
  else if (!r.ok && !r.cancelled) msgStatus.set(agentId, { at: Date.now(), bad: true, text: r.error ?? 'The folder window could not open.' });
  render();
}

function removeFile(agentId, index) {
  const list = msgFiles.get(agentId) ?? [];
  const [gone] = list.splice(index, 1);
  if (gone?.url) URL.revokeObjectURL(gone.url);
  render();
}

/** Sends the message box (with its files), or `quick` text (a one-click answer) leaving the box as it is. */
async function sendMessage(agentId, button, quick = null) {
  const text = (quick ?? msgDrafts.get(agentId) ?? '').trim();
  const attached = quick === null ? msgFiles.get(agentId) ?? [] : [];
  if (!text && !attached.length) {
    msgStatus.set(agentId, { at: Date.now(), bad: true, text: 'Type a message or attach a file first.' });
    render();
    return;
  }
  const agent = snap?.agents.find(a => a.id === agentId);
  if (button) {
    button.disabled = true;
    button.textContent = 'Sending…';
  }
  let files = [];
  const folders = attached.filter(f => f.folder).map(f => f.folder); // sent by their paths
  try {
    files = await Promise.all(attached.filter(f => f.file).map(async f => ({ name: f.name, data: toBase64(new Uint8Array(await f.file.arrayBuffer())) })));
  } catch (err) {
    msgStatus.set(agentId, { at: Date.now(), bad: true, text: `Could not read a file: ${err?.message ?? err}` });
    render();
    return;
  }
  const r = await post('/api/actions/message', { agentId, text, ...(files.length ? { files } : {}), ...(folders.length ? { folders } : {}) });
  if (r.ok && quick === null) {
    msgDrafts.delete(agentId);
    for (const f of attached) if (f.url) URL.revokeObjectURL(f.url);
    msgFiles.delete(agentId);
  }
  const counted = [[files.length, 'file'], [folders.length, 'folder']].filter(([n]) => n).map(([n, what]) => `${n} ${what}${n > 1 ? 's' : ''}`);
  const extra = counted.length ? ` with ${counted.join(' and ')}` : '';
  msgStatus.set(agentId, {
    at: Date.now(),
    bad: !r.ok,
    text: r.ok ? (agent?.state === 'working' ? `Queued for ${agent.name}${extra}: it reads it when its current step ends.` : `✓ Sent to ${agent?.name ?? 'the session'}${extra}.`) : `Not sent: ${r.error}`,
  });
  render();
}
