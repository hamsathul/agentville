// Runs the dashboard's inline script in a vm with a minimal DOM, to test its render scheduling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(fileURLToPath(new URL('../../web/index.html', import.meta.url)), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));

function loadPage({ stored = {}, storageThrows = false } = {}) {
  const posts = [];
  let active = null;
  const els = new Map();
  const el = id => ({ id, title: '', innerHTML: '', textContent: '', className: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, showModal() {}, querySelectorAll: () => [] });
  const docListeners = {};
  let sourceListener = null;
  let selectedText = '';
  const ctx = {
    document: {
      getElementById: id => (els.has(id) ? els.get(id) : els.set(id, el(id)).get(id)),
      documentElement: { dataset: {} },
      get activeElement() { return active; },
      querySelectorAll: () => [],
      addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); },
    },
    window: { getSelection: () => ({ isCollapsed: selectedText === '', toString: () => selectedText }) },
    EventSource: class { addEventListener(_type, fn) { sourceListener = fn; } },
    setInterval() {},
    setTimeout: fn => fn(),
    navigator: {},
    localStorage: {
      getItem: key => { if (storageThrows) throw new Error('denied'); return stored[key] ?? null; },
      setItem: (key, value) => { if (storageThrows) throw new Error('denied'); stored[key] = String(value); },
    },
    fetch: async (path, init) => { posts.push({ path, body: init?.body ? JSON.parse(init.body) : undefined }); return { ok: true, json: async () => ({ ok: true }) }; },
    console, Date, Math, JSON, String, Number, Object, Boolean, Map, Set, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return {
    ctx,
    list: () => els.get('list').innerHTML,
    push: snap => sourceListener({ data: JSON.stringify(snap) }),
    select: text => { selectedText = text; },
    fire: type => (docListeners[type] ?? []).forEach(fn => fn({ target: { closest: () => null } })),
    click: id => Promise.all((docListeners.click ?? []).map(fn => fn({ target: { closest: sel => (sel === 'button' ? ctx.document.getElementById(id) : null) } }))),
    el: id => ctx.document.getElementById(id),
    side: () => ctx.document.getElementById('side').innerHTML,
    posts,
    focus: element => { active = element; },
    openAgent: id => Promise.all((docListeners.click ?? []).map(fn => fn({ target: { closest: sel => (sel === '.row[data-id]' ? { dataset: { id } } : null) } }))),
    clickButton: (id, dataset) => { Object.assign(ctx.document.getElementById(id).dataset, dataset); return Promise.all((docListeners.click ?? []).map(fn => fn({ target: { closest: sel => (sel === 'button' ? ctx.document.getElementById(id) : null) } }))); },
    edit: (type, target) => (docListeners[type] ?? []).forEach(fn => fn({ target: { closest: () => null, ...target } })),
    theme: () => ctx.document.documentElement.dataset.theme,
    stored,
  };
}

const snapshot = name => ({
  generatedAt: Date.now(),
  collector: { cpu: 0.5, rssMb: 70 },
  sources: {},
  counts: { waiting: 0, working: 1, yourTurn: 0, stale: 0, idle: 0, collisions: 0 },
  agents: [{ id: 's1', kind: 'interactive', name, cwd: '/w', state: 'working', stateReason: 'busy', stateSince: 0, feed: [], children: [], touching: [] }],
  repos: [],
  collisions: [],
});

test('a new snapshot renders immediately when nothing is selected', () => {
  const page = loadPage();
  page.push(snapshot('first'));
  assert.match(page.list(), /first/);
  page.push(snapshot('second'));
  assert.match(page.list(), /second/);
});

test('a snapshot waits while text is selected, then renders once the selection clears', () => {
  const page = loadPage();
  page.push(snapshot('first'));
  page.select('a path being copied');
  page.push(snapshot('second'));
  assert.match(page.list(), /first/);
  page.select('');
  page.fire('selectionchange');
  assert.match(page.list(), /second/);
});

test('a snapshot waits while the pointer is down, so a click is not lost to a re-render', () => {
  const page = loadPage();
  page.push(snapshot('first'));
  page.fire('pointerdown');
  page.push(snapshot('second'));
  assert.match(page.list(), /first/);
  page.fire('pointerup');
  assert.match(page.list(), /second/);
});

test('the theme starts dark, and the button cycles Dark → Auto → Light → Dark, remembering the choice', async () => {
  const page = loadPage();
  assert.equal(page.theme(), 'dark');
  assert.equal(page.el('theme-toggle').textContent, '☾ Dark');
  await page.click('theme-toggle');
  assert.equal(page.theme(), undefined);
  assert.equal(page.stored['tracker-theme'], 'auto');
  assert.equal(page.el('theme-toggle').textContent, '◐ Auto');
  await page.click('theme-toggle');
  assert.equal(page.theme(), 'light');
  assert.equal(page.el('theme-toggle').textContent, '☀ Light');
  await page.click('theme-toggle');
  assert.equal(page.theme(), 'dark');
});

test('a saved theme is applied when the page loads', () => {
  const page = loadPage({ stored: { 'tracker-theme': 'dark' } });
  assert.equal(page.theme(), 'dark');
  assert.equal(page.el('theme-toggle').textContent, '☾ Dark');
});

test('blocked browser storage keeps the dark default and the button still switches', async () => {
  const page = loadPage({ storageThrows: true });
  assert.equal(page.theme(), 'dark');
  await page.click('theme-toggle');
  assert.equal(page.theme(), undefined);
});

test('the page CSS gives both an explicit dark theme and a system-dark theme that Light overrides', () => {
  assert.match(html, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{/);
});

const askSnapshot = ask => {
  const snap = snapshot('x');
  snap.counts = { ...snap.counts, waiting: 1, working: 0 };
  snap.agents = [{ ...snap.agents[0], id: 'w1', name: 'asker', state: 'waiting', stateReason: 'question pending', ask }];
  return snap;
};
const QUESTION = { kind: 'question', toolUseId: 'toolu_Q1', questions: [
  { question: 'Pick a colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }] },
] };
const pick = (page, value, extra = {}) => page.edit('change', { type: 'radio', value, checked: true, dataset: { tool: 'toolu_Q1', q: '0' }, ...extra });

test("a waiting question shows its options, and Send posts the chosen answer", async () => {
  const page = loadPage();
  page.push(askSnapshot(QUESTION));
  assert.match(page.list(), /answer here/);
  await page.openAgent('w1');
  assert.match(page.side(), /Pick a colour\?/);
  assert.match(page.side(), /value="Red"/);
  assert.match(page.side(), /value="Blue"/);
  pick(page, 'Blue');
  await page.clickButton('ask-send', { agent: 'w1', tool: 'toolu_Q1' });
  assert.deepEqual(page.posts, [{ path: '/api/actions/answer', body: { agentId: 'w1', toolUseId: 'toolu_Q1', answers: { 'Pick a colour?': 'Blue' } } }]);
});

test('Send with a question unanswered posts nothing and says why', async () => {
  const page = loadPage();
  page.push(askSnapshot(QUESTION));
  await page.openAgent('w1');
  await page.clickButton('ask-send', { agent: 'w1', tool: 'toolu_Q1' });
  assert.deepEqual(page.posts, []);
  assert.match(page.el('notice').textContent, /Answer every question/);
});

test('multi-select answers are comma-joined, and text under Other wins', async () => {
  const page = loadPage();
  const multi = { kind: 'question', toolUseId: 'toolu_Q1', questions: [
    { question: 'Which?', header: '', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] },
    { question: 'Why?', header: '', multiSelect: false, options: [{ label: 'X' }] },
  ] };
  page.push(askSnapshot(multi));
  await page.openAgent('w1');
  pick(page, 'A', { type: 'checkbox' });
  pick(page, 'B', { type: 'checkbox' });
  page.edit('input', { type: 'text', value: 'my own reason', dataset: { tool: 'toolu_Q1', q: '1' } });
  await page.clickButton('ask-send', { agent: 'w1', tool: 'toolu_Q1' });
  assert.deepEqual(page.posts[0].body.answers, { 'Which?': 'A, B', 'Why?': 'my own reason' });
});

test('a chosen option survives a refresh of the drawer', async () => {
  const page = loadPage();
  page.push(askSnapshot(QUESTION));
  await page.openAgent('w1');
  pick(page, 'Red');
  page.push(askSnapshot(QUESTION));
  assert.match(page.side(), /value="Red"[^>]*checked/);
});

test('a permission prompt shows what will run, and Allow posts the decision', async () => {
  const page = loadPage();
  page.push(askSnapshot({ kind: 'permission', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'mkdir /tmp/x', expiresAt: Date.now() + 10_000 }));
  await page.openAgent('w1');
  assert.match(page.side(), /mkdir \/tmp\/x/);
  assert.match(page.side(), /id="ask-allow"/);
  assert.match(page.side(), /id="ask-deny"/);
  await page.clickButton('ask-allow', { agent: 'w1', tool: 'toolu_P1' });
  assert.deepEqual(page.posts, [{ path: '/api/actions/permit', body: { agentId: 'w1', toolUseId: 'toolu_P1', decision: 'allow' } }]);
});

test('typing under Other holds refreshes until the box loses focus', () => {
  const page = loadPage();
  page.push(snapshot('first'));
  page.focus({ tagName: 'INPUT', type: 'text' });
  page.push(snapshot('second'));
  assert.match(page.list(), /first/);
  page.focus(null);
  page.fire('focusout');
  assert.match(page.list(), /second/);
});

test('there are no Claude app links any more', async () => {
  const page = loadPage();
  const snap = askSnapshot(QUESTION);
  snap.agents[0].remoteUrl = 'https://claude.ai/code/session_01AbC';
  page.push(snap);
  await page.openAgent('w1');
  assert.doesNotMatch(page.list() + page.side(), /claude\.ai/);
});

const richAgent = (over = {}) => ({
  id: 'r1', kind: 'interactive', name: 'busy-one', cwd: '/w', state: 'working', stateReason: 'busy', stateSince: 0,
  feed: [{ at: Date.now() - 2000, kind: 'tool', tool: 'Bash', text: 'npm test', ok: true, durationMs: 1200 }],
  children: [], touching: [], contextTokens: 120_000,
  now: { tool: 'Bash', summary: 'npm test', startedAt: Date.now() - 5000 },
  proc: { cpu: 12, rssMb: 600, childCount: 1, children: ['node x'], history: { at: [Date.now() - 6000, Date.now() - 3000, Date.now()], cpu: [5, 30, 12], rssMb: [580, 590, 600] } },
  activity: Array.from({ length: 30 }, (_, i) => i % 4),
  timeline: [{ at: Date.now() - 60_000, tool: 'Edit' }, { at: Date.now() - 1000, tool: 'Bash' }],
  ...over,
});
const richSnapshot = agents => ({
  ...snapshot('x'),
  settings: { modToasts: true, permissionDashboardSec: 15, memoryAlertGb: 2 },
  machine: { totalMemMb: 16384, cpuCount: 10 },
  counts: { waiting: 0, working: agents.length, yourTurn: 0, stale: 0, idle: 0, collisions: 0 },
  agents,
});

test('number tiles show each state count with its label', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent()]));
  const kpis = page.el('kpis').innerHTML;
  for (const label of ['Waiting on you', 'Working', 'Your turn', 'Collisions']) assert.match(kpis, new RegExp(label));
  assert.match(kpis, /class="val">1</);
});

test('each agent row has a CPU sparkline, memory and context meters, and a 30-minute activity strip', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent()]));
  const list = page.list();
  assert.match(list, /<svg class="spark"/);
  assert.equal((list.match(/class="meter /g) ?? []).length, 2);
  assert.equal((list.match(/class="h h\d"/g) ?? []).length, 30);
});

test('memory near the alert threshold turns its meter critical, with a warning sign', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ proc: { ...richAgent().proc, rssMb: 1900 } })]));
  assert.match(page.list(), /class="meter crit"/);
  assert.match(page.list(), /⚠/);
});

test('the drawer charts CPU and memory over 10 minutes and plots the tool timeline', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent()]));
  await page.openAgent('r1');
  assert.equal((page.side().match(/data-chart=/g) ?? []).length, 2);
  assert.match(page.side(), /class="timeline"/);
});

test('an agent keeps its colour when another agent appears before it', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent()]));
  const colourOf = id => page.list().match(new RegExp(`data-id="${id}"[\\s\\S]*?class="swatch" style="background:var\\((--s\\d)\\)`))?.[1];
  const first = colourOf('r1');
  page.push(richSnapshot([richAgent({ id: 'r0', name: 'newcomer' }), richAgent()]));
  assert.equal(colourOf('r1'), first);
  assert.notEqual(colourOf('r0'), first);
});

test('the page has an SVG favicon', () => {
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
});
