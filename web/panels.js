// The parts of the page built from a snapshot: number tiles, top-bar stats, agent rows,
// repos, the answer form, the conversation, the message box (with screenshots) and sending.
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
  if (a.ask?.kind === 'permission') return `🔐 <b>${esc(a.ask.tool)}</b> <span class="mono">${esc(a.ask.summary)}</span>`;
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
function modCan(a) {
  const v = String(a.mod?.version ?? '0').split('.').map(n => Number.parseInt(n, 10) || 0);
  return Boolean(a.mod?.live) && (v[0] > 0 || v[1] >= 5);
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
    <select class="act mini" data-switch-model data-agent="${esc(a.id)}" aria-label="Switch this session's model" data-tip="${esc(why)}"${off}><option value="">${esc(a.model ? modelName(a.model) : 'Model…')}</option>${models}</select>
    <select class="act mini" data-switch-effort data-agent="${esc(a.id)}" aria-label="Set this session's effort" data-tip="${esc(live ? 'Runs /effort in the session after its current turn. Claude Code saves low to xhigh as your default for new sessions; max is for this session only.' : why)}"${off}><option value="">effort: ${esc(a.effort ?? 'default')}</option>${efforts}</select>
    <select class="act mini" data-restart-mode data-agent="${esc(a.id)}" aria-label="Restart this session in another permission mode"><option value="">Restart in…</option>${options}</select>
    <button type="button" class="act mini" data-end-session="${esc(a.id)}" data-tip="End this session and close its terminal window (resume it later from ＋ Session)">End session</button>${note}</div>`;
}

/** An in-page yes/no question: resolves true for the OK button, false for Cancel or Escape. */
let confirmResolve = null;
function confirmBox(text, okLabel = 'OK') {
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = okLabel;
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
      <button class="act primary" id="ask-allow" ${ids}>Allow</button><button class="act" id="ask-deny" ${ids}>Deny</button></div>`;
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
    : `<div class="bub agent"><div class="bub-md">${renderMarkdown(f.body || f.text)}</div>${moreHtml(a, f)}<time>${hhmm(f.at)}<button type="button" class="bub-reply" data-quote="${esc(f.body || f.text)}" data-agent="${esc(a.id)}" title="Quote this in your reply">↩ Reply</button></time></div>`);
  return `<div class="sec">Conversation</div><div class="chat">${said.map(bubble).join('')}</div>`;
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

/** Chat box: sends a message, with any screenshots, into the session as the person's own words (queued if it is busy). */
function composeHtml(a) {
  if (a.kind === 'codex') return '';
  const live = Boolean(a.mod?.live);
  const hint = !live ? "This session isn't listening for dashboard messages yet. Send it anything in its terminal once, or start a new session."
    : a.state === 'working' ? `${esc(a.name)} is busy: your message waits until its current step ends. ↩ sends, ⇧↩ new line.`
    : 'Sent as your own message. Paste or drop screenshots on the box. ↩ sends, ⇧↩ new line.';
  const sent = msgStatus.get(a.id);
  const status = sent && Date.now() - sent.at < 20_000
    ? `<span id="msg-status" class="${sent.bad ? 'msg-bad' : 'msg-ok'}">${esc(sent.text)}</span>`
    : `<span id="msg-status" class="faint">${hint}</span>`;
  const imgs = msgImages.get(a.id) ?? [];
  const thumbs = imgs.length ? `<div class="thumbs">${imgs.map((im, i) => `<span class="thumb" data-tip="${esc(`${im.name} · ${sizeText(im.size)}`)}"><img src="${esc(im.url)}" alt="Screenshot ${i + 1}"><button type="button" class="thumb-x" data-remove-img="${i}" data-agent="${esc(a.id)}" aria-label="Remove screenshot ${i + 1}">✕</button></span>`).join('')}</div>` : '';
  return `<div class="compose" data-agent="${esc(a.id)}" style="margin-top:10px"><textarea id="msg-text" data-msg-agent="${esc(a.id)}" rows="2" placeholder="Message ${esc(a.name)}…"${live ? '' : ' disabled'}>${esc(msgDrafts.get(a.id) ?? '')}</textarea>${thumbs}
    <div class="compose-row">${status}<span class="grow"></span><button class="act" id="msg-attach" type="button" data-agent="${esc(a.id)}" data-tip="Attach screenshots (you can also paste or drop them on the box)"${live ? '' : ' disabled'}>📎 Screenshot</button><button class="act primary" id="msg-send" data-agent="${esc(a.id)}"${live ? '' : ' disabled'}>Send</button></div></div>`;
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
  return `<div class="workline"><span class="spin" aria-hidden="true"></span><b>${esc(t.word ?? (thinking ? 'Thinking' : 'Working'))}…</b> <span class="muted">(<span data-lasted="${t.startedAt}">${lasted(t.startedAt)}</span>${t.outTokens ? ` · ↓ ${tokensShort(t.outTokens)} tokens` : ''}${doing ? ` · ${doing}` : ''})</span></div>`;
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
  const head = `<button class="sec sec-fold" type="button" data-group="btw" aria-expanded="${open}" data-tip="${open ? 'Hide side questions' : 'Show side questions'}"><span class="tw">${open ? '▾' : '▸'}</span>Side question <span class="faint" style="text-transform:none;letter-spacing:0">(/btw: answered from its conversation, not added to it; works while it's busy)</span>${!open && count ? `<span class="grp-n">${count}</span>` : ''}</button>`;
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

/** Screenshots pasted, dropped or picked for an agent's next message. */
function addImages(agentId, files) {
  const list = msgImages.get(agentId) ?? [];
  let refused = '';
  for (const file of files) {
    if (!IMAGE_TYPES.test(file?.type ?? '')) { refused = 'Only PNG, JPEG, GIF and WebP images can be attached.'; continue; }
    if (file.size > MAX_SHOT_BYTES) { refused = `${file.name} is too large (10 MB at most).`; continue; }
    if (list.length >= MAX_SHOTS) { refused = `At most ${MAX_SHOTS} screenshots per message.`; break; }
    list.push({ file, url: URL.createObjectURL(file), name: file.name || 'screenshot.png', size: file.size });
  }
  msgImages.set(agentId, list);
  if (refused) msgStatus.set(agentId, { at: Date.now(), bad: true, text: refused });
  render();
}

function removeImage(agentId, index) {
  const list = msgImages.get(agentId) ?? [];
  const [gone] = list.splice(index, 1);
  if (gone) URL.revokeObjectURL(gone.url);
  render();
}

/** Sends the message box (with its screenshots), or `quick` text (a one-click answer) leaving the box as it is. */
async function sendMessage(agentId, button, quick = null) {
  const text = (quick ?? msgDrafts.get(agentId) ?? '').trim();
  const imgs = quick === null ? msgImages.get(agentId) ?? [] : [];
  if (!text && !imgs.length) {
    msgStatus.set(agentId, { at: Date.now(), bad: true, text: 'Type a message or add a screenshot first.' });
    render();
    return;
  }
  const agent = snap?.agents.find(a => a.id === agentId);
  if (button) {
    button.disabled = true;
    button.textContent = 'Sending…';
  }
  let images = [];
  try {
    images = await Promise.all(imgs.map(async im => ({ name: im.name, data: toBase64(new Uint8Array(await im.file.arrayBuffer())) })));
  } catch (err) {
    msgStatus.set(agentId, { at: Date.now(), bad: true, text: `Could not read a screenshot: ${err?.message ?? err}` });
    render();
    return;
  }
  const r = await post('/api/actions/message', images.length ? { agentId, text, images } : { agentId, text });
  if (r.ok && quick === null) {
    msgDrafts.delete(agentId);
    for (const im of imgs) URL.revokeObjectURL(im.url);
    msgImages.delete(agentId);
  }
  const extra = images.length ? ` with ${images.length} screenshot${images.length > 1 ? 's' : ''}` : '';
  msgStatus.set(agentId, {
    at: Date.now(),
    bad: !r.ok,
    text: r.ok ? (agent?.state === 'working' ? `Queued for ${agent.name}${extra}: it reads it when its current step ends.` : `✓ Sent to ${agent?.name ?? 'the session'}${extra}.`) : `Not sent: ${r.error}`,
  });
  render();
}
