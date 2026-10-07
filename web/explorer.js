/* ---------- explorer: the agent's folder, like an editor's file tree ---------- */

let explorer = { agentId: null, data: null, error: '', loading: false, fetchedAt: 0, seenActivity: 0 };
const expanded = new Map(); // agent id → open folder paths
let filterText = '';
const STATUS_WORD = { M: 'modified', U: 'new, not committed', A: 'added', D: 'deleted', R: 'renamed' };
const treeCache = new WeakMap();
const byName = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true });
const openDirs = id => {
  if (!expanded.has(id)) expanded.set(id, new Set());
  return expanded.get(id);
};
const ancestors = path => {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
};
const browsable = a => Boolean(a?.cwd) && a.kind !== 'codex';

/** Follows the centre agent: a new agent gets its listing; a working one is re-listed every few seconds. */
function syncExplorer() {
  const a = centreAgent();
  const id = a?.id ?? null;
  if (id !== explorer.agentId) {
    explorer = { agentId: id, data: null, error: '', loading: false, fetchedAt: 0, seenActivity: 0 };
    renderTree();
    if (browsable(a)) void fetchListing();
    return;
  }
  if (browsable(a) && !explorer.loading && a.lastActivityAt !== explorer.seenActivity && Date.now() - explorer.fetchedAt > 3000) void fetchListing();
}

async function fetchListing() {
  const id = explorer.agentId;
  if (!id) return;
  explorer.loading = true;
  explorer.seenActivity = snap?.agents.find(x => x.id === id)?.lastActivityAt;
  let data = null;
  let error = '';
  try {
    const r = await fetch(`/api/agent/${encodeURIComponent(id)}/files`, { headers: { 'x-tracker-token': TOKEN } });
    const body = await r.json();
    if (r.ok) data = body;
    else error = body.error ?? `Could not list the folder (HTTP ${r.status}).`;
  } catch (err) {
    error = `Could not list the folder: ${err?.message ?? err}`;
  }
  if (explorer.agentId !== id) return;
  explorer.loading = false;
  explorer.fetchedAt = Date.now();
  if (data && !explorer.data) {
    // First look at this folder: open the folders holding files the agent wrote.
    const dirs = openDirs(id);
    for (const [path, t] of Object.entries(data.touched ?? {})) if (t.wrote) for (const d of ancestors(path)) dirs.add(d);
    const scratchDirs = openDirs(`${id}\nscratch`);
    for (const [path, t] of Object.entries(data.scratch?.touched ?? {})) if (t.wrote) for (const d of ancestors(path)) scratchDirs.add(d);
  }
  if (data) explorer.data = data;
  explorer.error = data ? '' : error;
  renderTree();
  if (reader?.agentId === id) refreshReader();
}

function treeOf(data) {
  if (treeCache.has(data)) return treeCache.get(data);
  const root = { dirs: new Map(), files: [] };
  for (const f of data.files) {
    const parts = f.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(parts.at(-1));
  }
  treeCache.set(data, root);
  return root;
}

function fileRow(path, label, depth, ctx, sub = '') {
  const st = ctx.status[path];
  const t = ctx.touched[path];
  const tip = [t ? `${t.wrote ? 'Edited' : 'Read'} by ${ctx.name} at ${hhmm(t.at)}` : '', st ? `git: ${STATUS_WORD[st] ?? st}` : ''].filter(Boolean).join(' · ') || path;
  const on = reader?.path === `${ctx.root}/${path}`;
  return `<button class="tn file${st ? ` st-${st}` : ''}${on ? ' on' : ''}" type="button" data-${ctx.fileAttr}="${esc(path)}" style="--d:${depth}" data-tip="${esc(tip)}"><span class="tw"></span><span class="tname">${esc(label)}</span>${sub ? `<span class="tsub">${esc(sub)}</span>` : ''}${t ? `<i class="mine${t.wrote ? '' : ' read'}" style="--c:${ctx.color}"></i>` : ''}${st ? `<span class="tst">${esc(st)}</span>` : ''}</button>`;
}

/** A small deploy mark for a repo, from the Repos panel's GitHub Actions status. */
function deployMark(d) {
  if (!d) return '';
  if (d.status !== 'completed') return `<span class="dep run" data-tip="${esc(`${d.workflow ?? 'Deploy'} ${d.status} · ${d.sha}`)}">●</span>`;
  return d.conclusion === 'success' ? '<span class="dep ok" data-tip="Deployed">✓</span>'
    : d.conclusion === 'failure' ? `<span class="dep bad" data-tip="${esc(`${d.workflow ?? 'Deploy'} failed at ${d.sha}`)}">✗</span>` : '';
}
const deployOf = top => snap?.repos?.find(r => r.path === top)?.deploy;

function treeRows(node, prefix, depth, out, ctx) {
  for (const name of [...node.dirs.keys()].sort(byName)) {
    const path = prefix ? `${prefix}/${name}` : name;
    const open = ctx.open.has(path);
    const mine = ctx.mine.has(path) ? `<i class="mine" style="--c:${ctx.color}" data-tip="${esc(`${ctx.name} edited files in here`)}"></i>` : '';
    const repo = ctx.repos.get(path);
    const tag = repo ? `<span class="repo-tag" data-tip="${esc(`Git repo ${repo.name}, on ${repo.branch}`)}">⎇ ${esc(repo.branch)}</span>${deployMark(deployOf(repo.top))}` : '';
    out.push(`<button class="tn dir${repo ? ' repo' : ''}${ctx.changed.has(path) ? ' changed' : ''}" type="button" data-${ctx.dirAttr}="${esc(path)}" aria-expanded="${open}" style="--d:${depth}"><span class="tw">${open ? '▾' : '▸'}</span><span class="tname">${esc(name)}</span>${mine}${tag}</button>`);
    if (open) treeRows(node.dirs.get(name), path, depth + 1, out, ctx);
  }
  for (const name of [...node.files].sort(byName)) out.push(fileRow(prefix ? `${prefix}/${name}` : name, name, depth, ctx));
}

const emptyRow = text => `<div class="empty" style="padding:2px 10px 4px">${text}</div>`;
const sectionHead = (key, title, sub = '') => `<button class="ex-sec" type="button" data-group="${key}" aria-expanded="${isOpen(key)}"><span class="tw">${isOpen(key) ? '▾' : '▸'}</span>${title}${sub ? `<span class="tsub">${esc(sub)}</span>` : ''}</button>`;
const fileLabel = path => (path === '@summary' ? 'Conversation summary' : docName(path));

// The explorer's sections: Memory and Scratchpad first (short), then the agent's folder (long).
/** One listed folder (the agent's, or its scratchpad) as a tree, or as flat matches while filtering. */
function folderRows(list, ctx, out) {
  const q = filterText.trim().toLowerCase();
  if (q) {
    const hits = list.files.filter(f => f.toLowerCase().includes(q));
    for (const f of hits.slice(0, 300)) out.push(fileRow(f, docName(f), 0, ctx, f.split('/').slice(0, -1).join('/')));
    if (!hits.length) out.push(emptyRow('No file names match.'));
    else if (hits.length > 300) out.push(emptyRow(`Showing 300 of ${hits.length} matches.`));
  } else {
    treeRows(treeOf(list), '', 0, out, ctx);
    if (!list.files.length) out.push(emptyRow('This folder is empty.'));
  }
  if (list.truncated) out.push(emptyRow(`Only the first ${list.files.length.toLocaleString()} files are listed.`));
}

function treeContext(agent, list, { fileAttr, dirAttr, openKey }) {
  const changed = new Set();
  const mine = new Set();
  for (const path of Object.keys(list.status ?? {})) for (const a of ancestors(path)) changed.add(a);
  for (const [path, t] of Object.entries(list.touched ?? {})) if (t.wrote) for (const a of ancestors(path)) mine.add(a);
  const repos = list.repos ?? [];
  return { root: list.root, status: list.status ?? {}, touched: list.touched ?? {}, open: openDirs(openKey), changed, mine, color: colorOf(agent.id), name: agent.name, repos: new Map(repos.filter(r => r.path).map(r => [r.path, r])), fileAttr, dirAttr };
}

function renderTree() {
  const box = $('tree');
  const agent = snap?.agents.find(x => x.id === explorer.agentId);
  if (!agent) { box.innerHTML = emptyRow('No agent selected.'); return; }
  if (!browsable(agent)) { box.innerHTML = emptyRow('This agent has no folder to show.'); return; }
  if (explorer.error) { box.innerHTML = emptyRow(esc(explorer.error)); return; }
  const d = explorer.data;
  if (!d) { box.innerHTML = emptyRow('Loading…'); return; }
  const out = [];

  out.push(sectionHead('ex-memory', 'Memory'));
  if (isOpen('ex-memory')) {
    const memRow = (path, label, where, icon, tip) => `<button class="tn file mem${reader?.path === path ? ' on' : ''}" type="button" data-mem="${esc(path)}" style="--d:0" data-tip="${esc(tip)}"><span class="tw">${icon}</span><span class="tname">${esc(label)}</span><span class="tsub">${esc(where)}</span></button>`;
    out.push(memRow('@summary', 'Conversation summary', 'after compaction', '🧠', 'What this session carries of its earlier conversation, once it has been compacted'));
    for (const m of d.memory ?? []) out.push(memRow(m.path, m.label, m.where, '📄', short(m.path)));
  }
  if (d.scratch) {
    out.push(sectionHead('ex-scratch', 'Scratchpad', `${d.scratch.files.length} file${d.scratch.files.length === 1 ? '' : 's'}`));
    if (isOpen('ex-scratch')) folderRows(d.scratch, treeContext(agent, d.scratch, { fileAttr: 'sfile', dirAttr: 'sdir', openKey: `${agent.id}\nscratch` }), out);
  }

  out.push(sectionHead('ex-folder', 'Folder', short(d.root ?? agent.cwd)));
  if (isOpen('ex-folder')) {
    if (d.folderError) out.push(emptyRow(esc(d.folderError)));
    else {
      const own = (d.repos ?? []).find(r => r.path === '');
      if (own) {
        const n = Object.keys(d.status ?? {}).length;
        out.push(`<div class="ex-repo" data-tip="${esc(`Git repo at ${short(own.top)}`)}">⎇ <b>${esc(own.name)}</b><span>${esc(own.branch)}</span><span class="faint">· ${n ? `${n} changed` : 'clean'}</span>${deployMark(deployOf(own.top))}</div>`);
      }
      folderRows(d, treeContext(agent, d, { fileAttr: 'file', dirAttr: 'dir', openKey: agent.id }), out);
    }
  }

  box.innerHTML = out.join('');
}

function toggleDir(key, path) {
  const dirs = openDirs(key);
  if (dirs.has(path)) dirs.delete(path);
  else dirs.add(path);
  renderTree();
}
