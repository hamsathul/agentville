// The ⚙ Claude Code dialog: your plugins and skills (with what each costs in context), your MCP
// servers and how each is, and your permission rules. Plugins and MCP servers change through the
// claude CLI; a rule is removed from its settings file. A plugin change reaches a running session
// once it reloads its plugins, which the dashboard can have every listening session do.
const SETUP_TABS = [['plugins', 'Plugins & skills'], ['mcp', 'MCP servers'], ['rules', 'Permission rules']];
const setupData = { plugins: null, mcp: null, rules: null };
const setupMore = new Set(); // plugins (and plugins' MCP groups) shown in full
let setupTab = 'plugins';
let setupNote = null; // { html, bad }: what came of the last change

const tok = n => `~${Number(n ?? 0).toLocaleString('en-US')}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function setupGet(path) {
  try {
    const r = await fetch(path, { headers: { 'x-tracker-token': TOKEN } });
    return r.ok ? await r.json() : { error: `The tracker said ${r.status}.` };
  } catch (err) {
    return { error: String(err) };
  }
}

async function openSetup() {
  let tab = 'plugins';
  try { tab = localStorage.getItem('tracker-setup-tab') || 'plugins'; } catch { /* this page only */ }
  setupNote = null;
  if (!$('setup').open) $('setup').showModal();
  await loadSetup(SETUP_TABS.some(([t]) => t === tab) ? tab : 'plugins');
}

/** Shows a tab, reading it afresh (`fresh`: MCP servers checked again, not the collector's last check). */
async function loadSetup(tab, { fresh = false } = {}) {
  setupTab = tab;
  try { localStorage.setItem('tracker-setup-tab', tab); } catch { /* this page only */ }
  setupData[tab] = null;
  renderSetup();
  const path = { plugins: '/api/claude/plugins', mcp: `/api/claude/mcp${fresh ? '?fresh=1' : ''}`, rules: '/api/claude/rules' }[tab];
  const data = await setupGet(path);
  setupData[tab] = data;
  if (setupTab === tab) renderSetup();
}

function renderSetup() {
  $('setup-tabs').innerHTML = SETUP_TABS.map(([t, label]) => `<button type="button" class="act mini${t === setupTab ? ' on' : ''}" data-setup-tab="${t}" aria-pressed="${t === setupTab}">${label}</button>`).join('');
  $('setup-note').innerHTML = setupNote ? `<span class="${setupNote.bad ? 'msg-bad' : 'msg-ok'}">${setupNote.html}</span>` : '';
  const d = setupData[setupTab];
  const reading = { plugins: 'Reading your plugins…', mcp: 'Checking each server (about 15 seconds: each one is started to see)…', rules: 'Reading your settings…' }[setupTab];
  const shaped = { plugins: d => Array.isArray(d?.plugins) && Array.isArray(d.skills), mcp: d => Array.isArray(d?.servers) && Array.isArray(d.projects), rules: d => Array.isArray(d?.files) }[setupTab];
  $('setup-body').innerHTML = !d ? `<div class="loading"><span class="spinner"></span>${reading}</div>`
    : d.error || !shaped(d) ? `<div class="empty">${esc(d.error ?? 'The tracker sent something unexpected: try again.')}</div>`
    : { plugins: pluginsHtml, mcp: mcpHtml, rules: rulesHtml }[setupTab](d);
}

/* ---------- plugins & skills ---------- */

function pluginsHtml(d) {
  const on = d.plugins.filter(p => p.enabled);
  const total = on.reduce((t, p) => t + (p.details?.alwaysOn ?? 0), 0);
  const cost = p => p.details?.alwaysOn ?? 0;
  const rows = [...d.plugins].sort((a, b) => cost(b) - cost(a) || a.name.localeCompare(b.name)).map(pluginRow).join('');
  const skills = d.skills.length ? `<div class="sec">Your own skills <span class="faint">~/.claude/skills</span></div>${d.skills.map(s => `<div class="setup-row"><div class="setup-main"><b>${esc(s.name)}</b><span class="faint">${esc(s.description)}</span></div><span class="setup-cost faint">${tok(s.tokens)} tok when used</span></div>`).join('')}` : '';
  return `<div class="setup-sum"><span><b>${plural(d.plugins.length, 'plugin')}</b>, ${on.length} on: together they add <b>${tok(total)} tokens</b> to every session.</span><span class="grow"></span>
    <button type="button" class="act mini" data-reload-sessions data-tip="Every session listening for the dashboard runs /reload-plugins, so plugin changes take effect in it">Reload running sessions</button></div>
    <div class="sec">Plugins <span class="faint">the costliest first</span></div>${rows}${skills}`;
}

function pluginRow(p) {
  const inv = p.details?.inventory ?? {};
  const parts = [[inv.skills, 'skill'], [inv.agents, 'agent'], [inv.hooks, 'hook'], [inv.mcpServers, 'MCP server'], [inv.lspServers, 'LSP server']]
    .filter(([list]) => list?.length).map(([list, name]) => plural(list.length, name)).join(' · ');
  const actions = p.managed
    ? `<button type="button" class="act mini" data-plugin-op="${p.enabled ? 'disable' : 'enable'}" data-plugin="${esc(p.id)}">${p.enabled ? 'Turn off' : 'Turn on'}</button><button type="button" class="act mini" data-plugin-op="update" data-plugin="${esc(p.id)}">Update</button><button type="button" class="act mini" data-plugin-op="uninstall" data-plugin="${esc(p.id)}">Uninstall…</button>`
    : '<span class="faint" data-tip="Loaded from a folder (CLAUDE_CODE_PLUGIN_DIRS or --plugin-dir): changed where it lives">from a folder</span>';
  const open = setupMore.has(p.id);
  return `<div class="setup-row${p.enabled ? '' : ' off'}" data-plugin-row="${esc(p.id)}"><div class="setup-main"><b>${esc(p.name)}</b><span class="faint">${esc(p.marketplace)} · v${esc(p.version)}${p.enabled ? '' : ' · off'}</span><span class="faint">${parts || '&nbsp;'}</span></div>
    <span class="setup-cost" data-tip="Added to every session while it is on">${p.details ? `${tok(p.details.alwaysOn)} tok` : ''}</span>
    <span class="setup-acts">${actions}<button type="button" class="act mini" data-plugin-more="${esc(p.id)}">${open ? 'Less' : 'More'}</button></span></div>${open ? pluginMoreHtml(p) : ''}`;
}

function pluginMoreHtml(p) {
  const d = p.details;
  if (!d) return '<div class="setup-more faint">Claude Code gave no details for it.</div>';
  const top = [...d.components].sort((a, b) => (b.alwaysOn ?? 0) - (a.alwaysOn ?? 0)).slice(0, 12);
  const table = top.length ? `<table class="setup-table"><tr><th>Part</th><th>Every session</th><th>When used</th></tr>${top.map(c => `<tr><td>${esc(c.name)}</td><td>${c.alwaysOn == null ? '' : `${tok(c.alwaysOn)}`}</td><td>${c.onInvoke == null ? '' : `${tok(c.onInvoke)}`}</td></tr>`).join('')}</table>${d.components.length > top.length ? `<div class="faint">and ${d.components.length - top.length} more</div>` : ''}` : '';
  const list = (label, names) => (names?.length ? `<div><span class="faint">${label}:</span> ${names.map(esc).join(', ')}</div>` : '');
  return `<div class="setup-more">${d.description ? `<div>${esc(d.description)}</div>` : ''}${table}${list('MCP servers', d.inventory.mcpServers)}${list('Hooks', d.inventory.hooks)}${list('Agents', d.inventory.agents)}</div>`;
}

async function pluginOp(id, op, button) {
  const p = setupData.plugins?.plugins?.find(x => x.id === id);
  if (op === 'uninstall' && !(await confirmBox(`Uninstall ${p?.name ?? id}? Claude Code removes it (claude plugin uninstall); running sessions keep it until they reload their plugins.`, 'Uninstall'))) return;
  button.disabled = true;
  button.textContent = { enable: 'Turning on…', disable: 'Turning off…', update: 'Updating…', uninstall: 'Uninstalling…' }[op];
  const r = await post('/api/actions/plugin', { id, op });
  setupNote = r.ok
    ? { html: `${esc(r.text || `${p?.name ?? id}: done`)}. Running sessions keep their plugins as they were until they reload them: <button type="button" class="act mini" data-reload-sessions>Reload running sessions</button>` }
    : { html: `Could not ${op} ${esc(p?.name ?? id)}: ${esc(r.error)}`, bad: true };
  await loadSetup('plugins');
}

async function reloadSessions(button) {
  button.disabled = true;
  const r = await post('/api/actions/reload', {});
  setupNote = r.ok
    ? { html: `Reloading plugins in ${plural(r.sessions, 'session')}${r.older ? `; ${r.older} on an older tracker mod: run /reload-plugins there` : ''}.` }
    : { html: `Could not reload: ${esc(r.error)}`, bad: true };
  renderSetup();
}

/* ---------- MCP servers ---------- */

const MCP_STATUS = { connected: ['c-good', '✓ Connected'], auth: ['c-warn', 'Needs sign-in'], failed: ['c-crit', '✗ Failed'], off: ['c-plain', 'Not configured'] };

function mcpRow(s, { remove = false, label = s.name } = {}) {
  const [chip, text] = MCP_STATUS[s.status] ?? ['c-plain', s.statusText];
  const acts = `${s.status === 'auth' ? `<button type="button" class="act mini" data-mcp-login="${esc(s.name)}" data-tip="Opens a terminal window running claude mcp login, which opens your browser">Sign in</button>` : ''}${remove ? `<button type="button" class="act mini" data-mcp-remove="${esc(s.name)}">Remove…</button>` : ''}`;
  return `<div class="setup-row"><div class="setup-main"><b>${esc(label)}</b><span class="faint mono">${esc(s.where)}</span>${s.detail ? `<span class="msg-bad">${esc(s.detail)}</span>` : ''}</div>
    <span class="chip ${chip}">${text}</span><span class="setup-acts">${acts}</span></div>`;
}

function mcpHtml(d) {
  const count = status => d.servers.filter(s => s.status === status).length;
  const sum = [[count('connected'), 'connected'], [count('auth'), 'need sign-in'], [count('failed'), 'failed'], [count('off'), 'not configured']].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(', ');
  const yours = d.servers.filter(s => s.group === 'yours'), connectors = d.servers.filter(s => s.group === 'connector');
  const byPlugin = new Map();
  for (const s of d.servers.filter(x => x.group === 'plugin')) byPlugin.set(s.plugin, [...(byPlugin.get(s.plugin) ?? []), s]);
  const plugins = [...byPlugin].sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => {
    const open = setupMore.has(`mcp:${name}`), need = list.filter(s => s.status === 'auth').length;
    return `<div class="setup-row"><div class="setup-main"><b>${esc(name)}</b><span class="faint">${plural(list.length, 'server')}${need ? ` · ${need} ${need === 1 ? 'needs' : 'need'} sign-in` : ''}</span></div><span class="setup-acts"><button type="button" class="act mini" data-mcp-plugin="${esc(name)}">${open ? 'Less' : 'Show'}</button></span></div>
      ${open ? list.map(s => mcpRow(s, { label: s.server })).join('') : ''}`;
  }).join('');
  const projects = d.projects.map(p => `<div class="setup-row"><div class="setup-main"><b>${esc(short(p.project))}</b></div></div>${p.names.map(n => `<div class="setup-row sub"><div class="setup-main"><span>${esc(n)}</span></div><span class="setup-acts"><button type="button" class="act mini" data-mcp-remove="${esc(n)}" data-project="${esc(p.project)}">Remove…</button></span></div>`).join('')}`).join('');
  return `<div class="setup-sum"><span>${plural(d.servers.length, 'server')}: ${sum || 'none'}. Checked at ${esc(clock(d.at))}.</span><span class="grow"></span><button type="button" class="act mini" data-mcp-check>Check again</button></div>
    ${yours.length ? `<div class="sec">Yours <span class="faint">every project</span></div>${yours.map(s => mcpRow(s, { remove: true })).join('')}` : ''}
    ${connectors.length ? `<div class="sec">claude.ai connectors</div>${connectors.map(s => mcpRow(s)).join('')}` : ''}
    ${plugins ? `<div class="sec">From plugins <span class="faint">they come and go with the plugin: turn it off to drop them</span></div>${plugins}` : ''}
    ${projects ? `<div class="sec">Per project <span class="faint">configured for one folder; checked when a session starts there</span></div>${projects}` : ''}`;
}

async function mcpAct(body, button) {
  if (body.op === 'remove' && !(await confirmBox(`Remove the MCP server ${body.name}${body.project ? ` from ${short(body.project)}` : ''}? Claude Code forgets it (claude mcp remove); sessions started after this won't have it.`, 'Remove'))) return;
  button.disabled = true;
  const r = await post('/api/actions/mcp', body);
  setupNote = r.ok
    ? { html: body.op === 'login' ? `A ${esc(r.terminal ?? 'terminal')} window is signing in to ${esc(body.name)}: finish in your browser, then Check again.` : `Removed ${esc(body.name)}.` }
    : { html: `Could not ${body.op === 'login' ? 'sign in to' : 'remove'} ${esc(body.name)}: ${esc(r.error)}`, bad: true };
  if (r.ok && body.op === 'remove') await loadSetup('mcp', { fresh: true });
  else renderSetup();
}

/* ---------- permission rules ---------- */

const RULE_LISTS = [['allow', 'Allowed'], ['ask', 'Ask first'], ['deny', 'Denied'], ['additionalDirectories', 'Extra folders']];

function rulesHtml(d) {
  const files = d.files.filter(f => RULE_LISTS.some(([k]) => f[k].length));
  if (!files.length) return '<div class="empty">No permission rules in your settings files yet.</div>';
  return `${files.map(f => `<div class="sec">${esc(f.label)} <span class="faint mono">${esc(short(f.path))}</span></div>${RULE_LISTS.filter(([k]) => f[k].length).map(([k, label]) => `<div class="setup-list">${label}</div>${f[k].map(rule => `<div class="setup-row sub"><div class="setup-main"><code>${esc(rule)}</code></div><span class="setup-acts"><button type="button" class="act mini" data-rule-remove data-path="${esc(f.path)}" data-list="${k}" data-value="${esc(rule)}">Remove…</button></span></div>`).join('')}`).join('')}`).join('')}
    <div class="faint" style="margin-top:10px">New rules come from Always allow… on a permission prompt, or from the terminal.</div>`;
}

async function removeRuleFlow({ path, list, value }, button) {
  const label = RULE_LISTS.find(([k]) => k === list)?.[1] ?? list;
  if (!(await confirmBox(`Remove ${value} from ${label} in ${short(path)}? Sessions read the change when they next start.`, 'Remove'))) return;
  button.disabled = true;
  const r = await post('/api/actions/rule', { path, list, value });
  setupNote = r.ok ? { html: `Removed ${esc(value)}.` } : { html: `Could not remove it: ${esc(r.error)}`, bad: true };
  await loadSetup('rules');
}

document.addEventListener('click', e => {
  const b = e.target?.closest?.('button');
  if (!b) return undefined;
  const d = b.dataset;
  if (b.id === 'setup-open') return openSetup();
  if (d.setupClose !== undefined) { $('setup').close(); return undefined; }
  if (d.setupTab) return loadSetup(d.setupTab);
  if (d.pluginMore) { setupMore.has(d.pluginMore) ? setupMore.delete(d.pluginMore) : setupMore.add(d.pluginMore); renderSetup(); return undefined; }
  if (d.mcpPlugin) { const k = `mcp:${d.mcpPlugin}`; setupMore.has(k) ? setupMore.delete(k) : setupMore.add(k); renderSetup(); return undefined; }
  if (d.pluginOp) return pluginOp(d.plugin, d.pluginOp, b);
  if (d.reloadSessions !== undefined) return reloadSessions(b);
  if (d.mcpCheck !== undefined) return loadSetup('mcp', { fresh: true });
  if (d.mcpLogin) return mcpAct({ name: d.mcpLogin, op: 'login' }, b);
  if (d.mcpRemove) return mcpAct({ name: d.mcpRemove, op: 'remove', ...(d.project ? { project: d.project } : {}) }, b);
  if (d.ruleRemove !== undefined) return removeRuleFlow({ path: d.path, list: d.list, value: d.value }, b);
  return undefined;
});
$('setup').addEventListener('click', e => { if (e.target === $('setup')) $('setup').close(); }); // the backdrop
