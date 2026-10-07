// The dashboard's shared state and helpers: escaping, times, sizes, agent colours, the
// collapsible groups and the ticking timers.
const GROUPS = [['waiting', 'Waiting on you'], ['working', 'Working'], ['yourTurn', 'Your turn'], ['idle', 'Idle'], ['stale', 'Stale · 24h+ quiet']];
const STATE_CHIP = { waiting: '❓ Waiting on you', working: '▶ Working', yourTurn: '↩ Your turn', stale: '◌ Stale', idle: '◌ Idle' };
let snap = null;
const drafts = new Map(); // toolUseId → { picks: Map<question index, Set<label>>, other: Map<question index, text> }
const msgDrafts = new Map(); // agent id → half-typed chat message
const msgStatus = new Map(); // agent id → { text, bad, at }: the last send's result, shown under the box
const fullFeeds = new Map(); // agent id → { items, at }: the whole history, while Show all is on
const msgImages = new Map(); // agent id → screenshots waiting to go with the next message: [{ file, url, name, size }]
let pickerFor = null; // the agent the file picker is choosing screenshots for
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;
const MAX_SHOTS = 6;
const MAX_SHOT_BYTES = 10 * 1024 * 1024;
let selected = null; // the agent in the centre: the one you clicked, else the first one at work, then kept
const openChildren = new Map();
const tabs = new Map(); // agent id → { files: [absolute paths], active: a path, or '' for the agent itself }
let shownKey = ''; // which agent and tab the centre body holds, so an open file isn't redrawn on every snapshot
let viewerLoading = Promise.resolve();
// Collapsible groups (left column and explorer). Idle and stale start closed; what you close or
// open is remembered. Saving the closed ones means a group added later starts open.
const closedGroups = loadClosed();
const isOpen = key => !closedGroups.has(key);
function loadClosed() {
  try {
    const saved = JSON.parse(localStorage.getItem('tracker-closed-groups'));
    if (Array.isArray(saved)) return new Set(saved);
  } catch { /* nothing saved yet, or storage blocked */ }
  return new Set(['idle', 'stale']);
}
function toggleGroup(key) {
  if (closedGroups.has(key)) closedGroups.delete(key);
  else closedGroups.add(key);
  try { localStorage.setItem('tracker-closed-groups', JSON.stringify([...closedGroups])); } catch { /* lasts this page only */ }
  render();
  if (key.startsWith('ex-')) renderTree();
}
const groupHead = (key, title, count, extra = '') => {
  const open = isOpen(key);
  return `<div class="grp-row"><button class="grp" type="button" data-group="${key}" aria-expanded="${open}"><span class="tw">${open ? '▾' : '▸'}</span>${title}${count === '' ? '' : `<span class="grp-n">${count}</span>`}</button>${extra}</div>`;
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hhmm = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const ago = ms => (!ms ? '' : Date.now() - ms < 86_400_000 ? clock(ms) : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }));
const gb = mb => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
const short = p => String(p ?? '').replace(/^\/Users\/[^/]+/, '~');
const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

function elapsed(from) {
  const s = Math.max(0, Math.floor((Date.now() - from) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Colour follows the agent, never its rank or screen order: each agent's preferred slot comes
// from a hash of its id, new agents are placed in id order, and an agent keeps its slot while it
// is on screen (freed when it goes away). So a reload shows the same colours. Past eight, grey.
const agentSlots = new Map();
const preferredSlot = id => {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
};
function syncSlots(agents) {
  const live = new Set(agents.map(a => a.id));
  for (const id of [...agentSlots.keys()]) if (!live.has(id)) agentSlots.delete(id);
  const fresh = agents.map(a => a.id).filter(id => !agentSlots.has(id)).sort();
  for (const id of fresh) {
    const used = new Set(agentSlots.values());
    let slot = 'other';
    for (let k = 0; k < 8; k++) {
      const candidate = ((preferredSlot(id) - 1 + k) % 8) + 1;
      if (!used.has(candidate)) { slot = candidate; break; }
    }
    agentSlots.set(id, slot);
  }
}
const colorOf = id => (agentSlots.get(id) === 'other' || !agentSlots.has(id) ? 'var(--s-other)' : `var(--s${agentSlots.get(id)})`);

function updateTimers() {
  for (const el of document.querySelectorAll('[data-since]')) el.textContent = elapsed(Number(el.dataset.since));
  for (const el of document.querySelectorAll('[data-until]')) el.textContent = `${Math.max(0, Math.ceil((Number(el.dataset.until) - Date.now()) / 1000))}s`;
  if (snap) {
    const age = Math.max(0, Math.round((Date.now() - snap.generatedAt) / 1000));
    $('meta').textContent = $('meta').title = `tracker ${snap.collector.cpu}% CPU · ${snap.collector.rssMb} MB · updated ${age}s ago`; // the title shows it whole when the header cuts it
  }
}
