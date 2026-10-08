// Runs the dashboard's inline script in a vm with a minimal DOM, to test its render scheduling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = name => readFileSync(fileURLToPath(new URL(`../../web/${name}`, import.meta.url)), 'utf8');
const html = web('index.html');
// The page: its inline script (the token), then its scripts in the order it loads them. The farm
// script loads deferred and is tested on its own.
const pageScripts = [...html.matchAll(/<script src="\/([a-z]+)\.js"><\/script>/g)].map(m => `${m[1]}.js`);
const inlineStart = html.lastIndexOf('<script>') + '<script>'.length;
const script = html.slice(inlineStart, html.indexOf('</script>', inlineStart)) + pageScripts.map(web).join('\n');

function loadPage({ stored = {}, storageThrows = false, files = {}, replies = {}, listing = null, farm = null, feeds = {} } = {}) {
  const posts = [];
  const gets = [];
  const revoked = [];
  let active = null;
  const els = new Map();
  const el = id => ({ id, title: '', innerHTML: '', textContent: '', value: '', className: '', dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, scrollIntoView() {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, querySelectorAll: () => [], insertAdjacentHTML(_where, html) { this.innerHTML += html; } });
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
    window: { getSelection: () => ({ isCollapsed: selectedText === '', toString: () => selectedText }), ...(farm ? { TrackerFarm: farm } : {}) },
    EventSource: class { addEventListener(_type, fn) { sourceListener = fn; } },
    setInterval() {},
    setTimeout: fn => fn(),
    navigator: {},
    localStorage: {
      getItem: key => { if (storageThrows) throw new Error('denied'); return stored[key] ?? null; },
      setItem: (key, value) => { if (storageThrows) throw new Error('denied'); stored[key] = String(value); },
    },
    fetch: async (path, init) => {
      if (init?.method === 'POST') posts.push({ path, body: JSON.parse(init.body) });
      else gets.push({ path, token: init?.headers?.['x-tracker-token'] });
      const feed = String(path).match(/^\/api\/agent\/([^/]+)\/feed\?limit=200$/);
      if (feed) return { ok: true, status: 200, json: async () => feeds[decodeURIComponent(feed[1])] ?? [] };
      if (/^\/api\/agent\/[^/]+\/files$/.test(path)) {
        return listing ? { ok: true, status: 200, json: async () => listing } : { ok: false, status: 404, json: async () => ({ error: 'That agent was not found, or has no folder.' }) };
      }
      const doc = String(path).match(/^\/api\/agent\/[^/]+\/(?:doc|file)\?path=(.*)$/);
      if (doc) {
        const file = decodeURIComponent(doc[1]);
        return file in files
          ? { ok: true, status: 200, json: async () => ({ path: file, text: files[file], mtimeMs: 1, size: files[file].length }) }
          : { ok: false, status: 404, json: async () => ({ error: 'That file no longer exists.' }) };
      }
      return { ok: true, json: async () => replies[path] ?? { ok: true } };
    },
    console, Date, Math, JSON, String, Number, Object, Boolean, Map, Set, encodeURIComponent, decodeURIComponent, btoa,
    URL: { createObjectURL: f => `blob:${f.name}`, revokeObjectURL: url => { revoked.push(url); } },
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return {
    ctx,
    list: () => els.get('list').innerHTML,
    push: snap => sourceListener({ data: JSON.stringify(snap) }),
    select: text => { selectedText = text; },
    fire: type => (docListeners[type] ?? []).forEach(fn => fn({ target: { closest: () => null } })),
    change: target => Promise.all((docListeners.change ?? []).map(fn => fn({ target: { closest: () => null, ...target } }))),
    click: id => Promise.all((docListeners.click ?? []).map(fn => fn({ target: { closest: sel => (sel === 'button' ? ctx.document.getElementById(id) : null) } }))),
    el: id => ctx.document.getElementById(id),
    side: () => ctx.document.getElementById('center-body').innerHTML,
    tabs: () => ctx.document.getElementById('center-tabs').innerHTML,
    tree: () => ctx.document.getElementById('tree').innerHTML,
    settle: async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); },
    posts,
    gets,
    revoked,
    paste: (target, files) => (docListeners.paste ?? []).forEach(fn => fn({ target: { closest: () => null, ...target }, clipboardData: { files }, preventDefault() {} })),
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

test('an open dropdown holds refreshes until it loses focus, and a pick lets go of it', async () => {
  const page = loadPage();
  page.push(snapshot('first'));
  page.focus({ tagName: 'SELECT' }); // a dropdown keeps focus while its list is open
  page.push(snapshot('second'));
  assert.match(page.list(), /first/, 'a refresh would replace the dropdown and lose the pick');
  page.focus(null);
  page.fire('focusout');
  assert.match(page.list(), /second/);
  page.push(richSnapshot([richAgent({ pid: 4242, mod: { live: true, version: '0.5.0' } })]));
  const blurred = [];
  for (const dataset of [{ switchModel: '' }, { switchEffort: '' }, { restartMode: '' }]) {
    await page.change({ dataset: { ...dataset, agent: 'r1' }, value: 'max', blur() { blurred.push(Object.keys(dataset)[0]); } });
  }
  assert.deepEqual(blurred, ['switchModel', 'switchEffort', 'restartMode'], 'so refreshes go on while you confirm, and after you cancel');
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

test('agent rows are compact: name and CPU and memory numbers, no charts; the centre has the sparkline, meters and activity strip', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent()]));
  const list = page.list();
  assert.doesNotMatch(list, /<svg class="spark"|class="meter |class="h h\d"/);
  assert.match(list, /busy-one[\s\S]*12%[\s\S]*600 MB/);
  const side = page.side();
  assert.match(side, /<svg class="spark"/);
  assert.equal((side.match(/class="meter /g) ?? []).length, 2);
  assert.equal((side.match(/class="h h\d"/g) ?? []).length, 30);
});

test('memory near the alert threshold turns its meter critical, with a warning sign', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ proc: { ...richAgent().proc, rssMb: 1900 } })]));
  assert.match(page.side(), /class="meter crit"/);
  assert.match(page.side(), /⚠/);
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

test("the page has an SVG favicon, Agentville's farmhouse, which brand.js redraws with a red light while an agent waits", () => {
  assert.match(html, /<link rel="icon" id="favicon" href="data:image\/svg\+xml,/);
  assert.match(html, /<title>Agentville<\/title>/);
  const window = {};
  vm.runInNewContext(readFileSync(fileURLToPath(new URL('../../web/brand.js', import.meta.url)), 'utf8'), { window });
  const quiet = window.Agentville.svg({ size: 32 }), waiting = window.Agentville.svg({ size: 32, badge: true });
  assert.match(quiet, /^<svg[^>]*width="32"[^>]*shape-rendering="crispEdges"/);
  assert.ok(waiting.includes('#e5322d') && !quiet.includes('#e5322d'), 'the red light only while an agent waits');
  assert.ok(window.Agentville.ROWS.every(r => r.length === 16) && window.Agentville.ROWS.length === 16, 'a 16×16 pixel grid');
});

test('agent colours come from the agent, so a reload with agents in another order keeps them', () => {
  const colours = order => {
    const page = loadPage();
    page.push(richSnapshot(order.map(id => richAgent({ id, name: id }))));
    return Object.fromEntries(order.map(id => [id, page.list().match(new RegExp(`data-id="${id}"[\\s\\S]*?class="swatch" style="background:var\\((--s\\d)\\)`))?.[1]]));
  };
  const first = colours(['alpha', 'beta', 'gamma']);
  const second = colours(['gamma', 'alpha', 'beta']);
  assert.deepEqual(second, first);
  assert.equal(new Set(Object.values(first)).size, 3);
});

test("the top bar shows the agents' memory and CPU, CPU as a share of the whole Mac", () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ proc: { ...richAgent().proc, cpu: 200 } })]));
  const stats = page.el('hstats').innerHTML;
  assert.match(stats, /20% of this Mac/);
  assert.match(stats, /200% of one core · 10 cores/);
  assert.match(stats, /600 MB[\s\S]*of 16\.0 GB/);
  assert.doesNotMatch(page.list(), /Memory used by agents|This Mac/);
});

test('a waiting question the dashboard cannot answer says to answer it in the terminal', async () => {
  const page = loadPage();
  page.push(askSnapshot(undefined));
  await page.openAgent('w1');
  assert.match(page.side(), /answer it in its terminal/);
  assert.doesNotMatch(page.side(), /id="ask-send"/);
});

test("the drawer says whether the session's mod is listening for dashboard answers", async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ mod: { version: '0.2.0', live: true } }), richAgent({ id: 'r2', name: 'old', mod: undefined })]));
  await page.openAgent('r1');
  assert.match(page.side(), /dashboard answers on/);
  await page.openAgent('r1');
  await page.openAgent('r2');
  assert.match(page.side(), /dashboard answers off/);
});

test('the drawer has a message box under Now that sends a chat message to the session', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.0', live: true } })]));
  await page.openAgent('r1');
  const side = page.side();
  assert.match(side, /id="msg-text"/);
  assert.ok(side.indexOf('id="msg-text"') > side.indexOf('>Now<'));
  page.edit('input', { tagName: 'TEXTAREA', value: 'Also update the README', dataset: { msgAgent: 'r1' } });
  await page.clickButton('msg-send', { agent: 'r1' });
  assert.deepEqual(page.posts, [{ path: '/api/actions/message', body: { agentId: 'r1', text: 'Also update the README' } }]);
});

test('a half-typed message survives the drawer refreshing', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.0', live: true } })]));
  await page.openAgent('r1');
  page.edit('input', { tagName: 'TEXTAREA', value: 'draft text', dataset: { msgAgent: 'r1' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.0', live: true } })]));
  assert.match(page.side(), />draft text<\/textarea>/);
});

test('the message box is disabled, with the reason, when the session is not listening', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ mod: undefined })]));
  await page.openAgent('r1');
  assert.match(page.side(), /<textarea[^>]*disabled/);
  assert.match(page.side(), /isn't listening/);
});

test('Activity comes right after Now in the drawer, before the charts', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.0', live: true } })]));
  await page.openAgent('r1');
  const side = page.side();
  const now = side.indexOf('>Now<'), activity = side.indexOf('>Activity<'), charts = side.indexOf('>Last 10 minutes<');
  assert.ok(now > 0 && now < activity && activity < charts, `${now} ${activity} ${charts}`);
});

test('the number tiles are a compact single row', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent()]));
  const kpis = page.el('kpis').innerHTML;
  assert.doesNotMatch(kpis, /kpi-top/);
  assert.match(kpis, /<b class="val">1<\/b>/);
});

const SPEC = '# Spec\n\nSome **bold** text.\n\n- one\n- two\n\n<script>alert(1)</script>';
const docAgent = (over = {}) => richAgent({
  mod: { version: '0.3.0', live: true },
  docs: [{ path: '/w/docs/spec.md', wrote: true, at: Date.now() - 60_000 }, { path: '/w/README.md', wrote: false, at: Date.now() - 120_000 }],
  ...over,
});
async function openSpec(page) {
  await page.openAgent('r1');
  await page.clickButton('doc-open', { docAgent: 'r1', docPath: '/w/docs/spec.md' });
}

test('Documents lists the markdown files the agent wrote or read, and one opens in a reader', async () => {
  const page = loadPage({ files: { '/w/docs/spec.md': SPEC } });
  page.push(richSnapshot([docAgent()]));
  await page.openAgent('r1');
  const side = page.side();
  assert.match(side, />Documents</);
  assert.match(side, /spec\.md[\s\S]*written[\s\S]*README\.md[\s\S]*read/);
  await openSpec(page);
  assert.ok(page.gets.some(p => p.path === '/api/agent/r1/file?path=%2Fw%2Fdocs%2Fspec.md' && p.token));
  assert.match(page.tabs(), /class="tab on"[^]*?spec\.md/);
  assert.match(page.side(), /docs\/spec\.md/);
  const body = page.el('reader-body').innerHTML;
  assert.match(body, /<h1[^>]*>Spec<\/h1>/);
  assert.match(body, /<strong>bold<\/strong>/);
  assert.match(body, /<li>one<\/li><li>two<\/li>/);
  assert.doesNotMatch(body, /<script>/);
  assert.match(body, /&lt;script&gt;/);
});

test('a reply from the reader goes to the agent as a message about that document, quoting the selection', async () => {
  const page = loadPage({ files: { '/w/docs/spec.md': SPEC } });
  page.push(richSnapshot([docAgent()]));
  await openSpec(page);
  page.select('Some bold text.');
  page.fire('selectionchange');
  await page.clickButton('reader-quote', {});
  assert.equal(page.el('reader-text').value, '> Some bold text.\n\n');
  page.edit('input', { id: 'reader-text', value: '> Some bold text.\n\nMake this italic instead.', dataset: {} });
  await page.clickButton('reader-send', {});
  const sent = page.posts.find(p => p.path === '/api/actions/message');
  assert.deepEqual(sent.body, { agentId: 'r1', text: 'About docs/spec.md:\n\n> Some bold text.\n\nMake this italic instead.' });
  assert.equal(page.el('reader-text').value, '');
});

test('the reader says why a document could not be shown', async () => {
  const page = loadPage();
  page.push(richSnapshot([docAgent()]));
  await openSpec(page);
  assert.match(page.el('reader-body').innerHTML, /no longer exists/);
});

test('the reader reply box is disabled when the session is not listening', async () => {
  const page = loadPage({ files: { '/w/docs/spec.md': SPEC } });
  page.push(richSnapshot([docAgent({ mod: undefined })]));
  await openSpec(page);
  assert.match(page.side(), /<textarea[^>]*id="reader-text"[^>]*disabled/);
  assert.match(page.side(), /isn't listening/);
});

test('markdown renders headings, lists, code, tables and quotes, and never passes HTML or unsafe links through', () => {
  const md = loadPage().ctx.renderMarkdown;
  assert.match(md('## Two words'), /<h2 id="md-two-words">Two words<\/h2>/);
  assert.equal(md('one\ntwo'), '<p>one two</p>');
  assert.match(md('a *b* _c_ ~~d~~ `**e**`'), /a <em>b<\/em> <em>c<\/em> <del>d<\/del> <code>\*\*e\*\*<\/code>/);
  assert.match(md('- a\n- b\n  - c\n- d'), /<ul><li>a<\/li><li>b<ul><li>c<\/li><\/ul><\/li><li>d<\/li><\/ul>/);
  assert.match(md('3. x\n4. y'), /<ol start="3"><li>x<\/li><li>y<\/li><\/ol>/);
  assert.match(md('- [x] done\n- [ ] todo'), /<input type="checkbox" disabled checked> done[\s\S]*<input type="checkbox" disabled> todo/);
  assert.match(md('```js\nif (a < b) {}\n```'), /<pre class="md-code" data-lang="js"><code>if \(a &lt; b\) \{\}<\/code><\/pre>/);
  assert.match(md('| A | B |\n|---|--:|\n| 1 | 2 |'), /<table><thead><tr><th>A<\/th><th style="text-align:right">B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td style="text-align:right">2<\/td><\/tr><\/tbody><\/table>/);
  assert.match(md('> quoted\n> more'), /<blockquote><p>quoted more<\/p><\/blockquote>/);
  assert.match(md('---'), /<hr>/);
  assert.match(md('---\ntitle: x\n---\n# T'), /<pre class="md-front">title: x<\/pre>/);
  assert.match(md('[site](https://example.com/a?b=1&c=2)'), /<a href="https:\/\/example.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site<\/a>/);
  const unsafe = md('[x](javascript:alert(1)) <img src=x onerror=alert(1)> ![pic](https://e.com/p.png) [q](https://e.com/"onmouseover="alert(1))');
  assert.doesNotMatch(unsafe, /<img|href="javascript|onmouseover="/);
  assert.match(unsafe, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('after Send the box empties and says it was sent, right under the box', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true }, state: 'working' })]));
  await page.openAgent('r1');
  page.edit('input', { tagName: 'TEXTAREA', value: 'Also update the README', dataset: { msgAgent: 'r1' } });
  await page.clickButton('msg-send', { agent: 'r1' });
  assert.match(page.side(), /<textarea id="msg-text"[^>]*><\/textarea>/);
  assert.match(page.side(), /id="msg-status"[^>]*>Queued for busy-one/);
});

test('if the session did not take the message, the text stays in the box and the reason shows under it', async () => {
  const page = loadPage({ replies: { '/api/actions/message': { ok: false, error: "The session didn't pick up the message." } } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  await page.openAgent('r1');
  page.edit('input', { tagName: 'TEXTAREA', value: 'keep me', dataset: { msgAgent: 'r1' } });
  await page.clickButton('msg-send', { agent: 'r1' });
  assert.match(page.side(), />keep me<\/textarea>/);
  assert.match(page.side(), /id="msg-status"[^>]*>Not sent: The session didn(&#39;|')t pick up the message\./);
});

const crew = () => richSnapshot([
  richAgent(),
  richAgent({ id: 'i1', name: 'idler', state: 'idle', now: undefined }),
  richAgent({ id: 's9', name: 'sleeper', state: 'stale', now: undefined, lastActivityAt: Date.now() - 3 * 86_400_000 }),
]);

test('idle and stale agents sit in collapsed groups; a click opens one, and the choice is remembered', async () => {
  const page = loadPage();
  page.push(crew());
  assert.match(page.list(), /data-group="idle" aria-expanded="false"/);
  assert.match(page.list(), /data-group="stale" aria-expanded="false"/);
  assert.doesNotMatch(page.list(), /data-id="i1"|data-id="s9"/);
  assert.match(page.list(), /data-id="r1"/);
  await page.clickButton('grp', { group: 'idle' });
  assert.match(page.list(), /data-group="idle" aria-expanded="true"/);
  assert.match(page.list(), /data-id="i1"/);
  const again = loadPage({ stored: { ...page.stored } });
  again.push(crew());
  assert.match(again.list(), /data-id="i1"/);
  assert.doesNotMatch(again.list(), /data-id="s9"/);
});

test('the agent that is working fills the centre without a click, and stays there when another needs you', () => {
  const page = loadPage();
  page.push(crew());
  assert.match(page.side(), /data-msg-agent="r1"/);
  const later = crew();
  later.agents.unshift({ ...richAgent({ id: 'w2', name: 'asker' }), state: 'waiting', stateReason: 'question pending' });
  page.push(later);
  assert.match(page.side(), /data-msg-agent="r1"/);
});

const LISTING = {
  root: '/w', git: true, truncated: false,
  files: ['README.md', 'docs/spec.md', 'src/app.ts', 'src/util/x.ts', 'z.txt'],
  status: { 'src/app.ts': 'M', 'z.txt': 'U' },
  touched: { 'src/app.ts': { wrote: true, at: Date.now() - 1000 }, 'README.md': { wrote: false, at: Date.now() - 2000 } },
};

test("the explorer shows the centre agent's folder: folders first, the agent's edits revealed and marked, git status letters", async () => {
  const page = loadPage({ listing: LISTING });
  page.push(richSnapshot([richAgent()]));
  await page.settle();
  assert.ok(page.gets.some(p => p.path === '/api/agent/r1/files' && p.token));
  const tree = page.tree();
  const at = name => tree.indexOf(`>${name}<`);
  assert.ok(at('docs') >= 0 && at('docs') < at('src') && at('src') < at('README.md') && at('README.md') < at('z.txt'), tree);
  assert.match(tree, /data-file="src\/app\.ts"[^>]*>[\s\S]*?class="mine"[\s\S]*?>M</);
  assert.match(tree, /data-file="README\.md"[^>]*>[\s\S]*?class="mine read"/);
  assert.match(tree, /data-file="z\.txt"[^>]*>[\s\S]*?>U</);
  assert.doesNotMatch(tree, /data-file="docs\/spec\.md"|data-file="src\/util\/x\.ts"/);
});

test('folders open and close on click, and the filter lists matching files from anywhere', async () => {
  const page = loadPage({ listing: LISTING });
  page.push(richSnapshot([richAgent()]));
  await page.settle();
  await page.clickButton('tn', { dir: 'docs' });
  assert.match(page.tree(), /data-file="docs\/spec\.md"/);
  await page.clickButton('tn', { dir: 'docs' });
  assert.doesNotMatch(page.tree(), /data-file="docs\/spec\.md"/);
  page.edit('input', { id: 'ex-filter', value: 'x.ts', dataset: {} });
  assert.match(page.tree(), /data-file="src\/util\/x\.ts"/);
  assert.doesNotMatch(page.tree(), /data-file="README\.md"/);
});

test('a file opens read-only in a centre tab with line numbers and its HTML kept as text; the agent tab goes back; ✕ closes it', async () => {
  const page = loadPage({ listing: LISTING, files: { '/w/src/app.ts': 'const a = 1;\n<b>x</b>\n' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  await page.settle();
  await page.clickButton('tn', { file: 'src/app.ts' });
  assert.ok(page.gets.some(p => p.path === '/api/agent/r1/file?path=%2Fw%2Fsrc%2Fapp.ts' && p.token));
  assert.match(page.tabs(), /class="tab on"[^]*?app\.ts/);
  const body = page.el('reader-body').innerHTML;
  assert.match(body, /<span class="l" data-n="1">const a = 1;<\/span>/);
  assert.match(body, /<span class="l" data-n="2">&lt;b&gt;x&lt;\/b&gt;<\/span>/);
  assert.match(page.side(), /id="reader-text"/);
  await page.clickButton('tab', { tab: '' });
  assert.match(page.side(), /data-msg-agent="r1"/);
  await page.clickButton('x', { closeTab: '/w/src/app.ts' });
  assert.doesNotMatch(page.tabs(), /app\.ts/);
});

const shot = (name, bytes = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]) => ({ name, type: 'image/png', size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer });

test('pasted files go with the message: pictures as thumbnails, other files as their name', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true }, state: 'yourTurn' })]));
  await page.openAgent('r1');
  assert.match(page.side(), /id="msg-attach"[^>]*>📎 Attach</);
  const notes = { name: 'notes.md', type: 'text/markdown', size: 7, arrayBuffer: async () => new TextEncoder().encode('# Notes').buffer };
  page.paste({ id: 'msg-text', dataset: { msgAgent: 'r1' } }, [shot('one.png'), shot('two.png'), notes]);
  assert.equal((page.side().match(/class="thumb"/g) ?? []).length, 2);
  assert.match(page.side(), /<img src="blob:one\.png"/);
  assert.match(page.side(), /class="thumb thumb-file"[^>]*>[\s\S]*?<span class="thumb-ext">md<\/span><span class="thumb-name">notes\.md<\/span>/);
  page.edit('input', { tagName: 'TEXTAREA', value: 'The button is cut off', dataset: { msgAgent: 'r1' } });
  await page.clickButton('msg-send', { agent: 'r1' });
  const sent = page.posts.find(p => p.path === '/api/actions/message').body;
  assert.equal(sent.text, 'The button is cut off');
  assert.deepEqual(sent.files, [{ name: 'one.png', data: 'iVBORwECAwQFBg==' }, { name: 'two.png', data: 'iVBORwECAwQFBg==' }, { name: 'notes.md', data: 'IyBOb3Rlcw==' }]);
  assert.doesNotMatch(page.side(), /class="thumb/);
  assert.deepEqual(page.revoked, ['blob:one.png', 'blob:two.png']);
  assert.match(page.side(), /id="msg-status"[^>]*>✓ Sent to busy-one with 3 files/);
});

test('a file alone can be sent, one can be removed, and files can be picked; an empty or too big one is refused', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  await page.openAgent('r1');
  await page.clickButton('msg-attach', { agent: 'r1' });
  page.edit('change', { id: 'file-picker', files: [shot('a.png'), { name: 'plan.pdf', type: 'application/pdf', size: 5, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70, 45]).buffer }], value: 'x' });
  assert.equal((page.side().match(/class="thumb[ "]/g) ?? []).length, 2);
  await page.clickButton('thumb-x', { removeFile: '0', agent: 'r1' });
  assert.equal((page.side().match(/class="thumb[ "]/g) ?? []).length, 1);
  assert.match(page.side(), /plan\.pdf/);
  page.edit('change', { id: 'file-picker', files: [{ name: 'blank.txt', type: 'text/plain', size: 0 }, { name: 'huge.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 }], value: 'x' });
  assert.equal((page.side().match(/class="thumb[ "]/g) ?? []).length, 1, 'neither was added');
  assert.match(page.side(), /huge\.pdf is too large/);
  await page.clickButton('msg-send', { agent: 'r1' });
  const sent = page.posts.find(p => p.path === '/api/actions/message').body;
  assert.equal(sent.text, '');
  assert.deepEqual(sent.files, [{ name: 'plan.pdf', data: 'JVBERi0=' }]);
});

test('the explorer names the repo the folder belongs to, with its branch', async () => {
  const page = loadPage({ listing: { ...LISTING, repos: [{ path: '', top: '/w', name: 'w', branch: 'main' }] } });
  page.push(richSnapshot([richAgent()]));
  await page.settle();
  assert.match(page.tree(), /class="ex-repo"[\s\S]*?⎇[\s\S]*?\bw\b[\s\S]*?main[\s\S]*?2 changed/);
});

test('in a folder holding several repos, each repo folder shows its branch and deploy state', async () => {
  const listing = {
    root: '/w', git: false, truncated: false,
    files: ['api/a.ts', 'notes.md', 'web/b.ts'],
    status: { 'api/a.ts': 'M' }, touched: {},
    repos: [{ path: 'api', top: '/w/api', name: 'api', branch: 'main' }, { path: 'web', top: '/w/web', name: 'web', branch: 'dev' }],
  };
  const page = loadPage({ listing });
  const snap = richSnapshot([richAgent()]);
  snap.repos = [{ path: '/w/api', name: 'api', branch: 'main', agentIds: [], deploy: { status: 'completed', conclusion: 'failure', workflow: 'Deploy', sha: 'abc' } }];
  page.push(snap);
  await page.settle();
  const tree = page.tree();
  assert.match(tree, /data-dir="api"[^>]*>[\s\S]*?class="repo-tag"[^>]*>⎇ main[\s\S]*?✗/);
  assert.match(tree, /data-dir="web"[^>]*>[\s\S]*?class="repo-tag"[^>]*>⎇ dev/);
  assert.doesNotMatch(tree, /class="ex-repo"/);
});

const MORE = {
  ...LISTING,
  scratch: { root: '/tmp/s', git: false, files: ['plan.md', 'shots/a.png'], status: {}, repos: [], truncated: false, touched: { 'plan.md': { wrote: true, at: Date.now() } } },
  memory: [
    { path: '/h/.claude/CLAUDE.md', label: 'CLAUDE.md', where: 'all projects' },
    { path: '/h/.claude/projects/-w/memory/MEMORY.md', label: 'MEMORY.md', where: 'auto memory' },
  ],
};

test("the explorer has the session's scratchpad, and its files open in a tab", async () => {
  const page = loadPage({ listing: MORE, files: { '/tmp/s/plan.md': '# The plan' } });
  page.push(richSnapshot([richAgent()]));
  await page.settle();
  const tree = page.tree();
  assert.match(tree, /data-group="ex-memory"[\s\S]*data-group="ex-scratch"[\s\S]*data-group="ex-folder"/);
  assert.match(tree, /data-sfile="plan\.md"[^>]*>[\s\S]*?class="mine"/);
  assert.match(tree, /data-sdir="shots"/);
  await page.clickButton('tn', { sfile: 'plan.md' });
  assert.ok(page.gets.some(g => g.path === '/api/agent/r1/file?path=%2Ftmp%2Fs%2Fplan.md'));
  assert.match(page.tabs(), /class="tab on"[^]*?plan\.md/);
  assert.match(page.el('reader-body').innerHTML, /<h1[^>]*>The plan<\/h1>/);
  await page.clickButton('grp', { group: 'ex-scratch' });
  assert.doesNotMatch(page.tree(), /data-sfile=/);
});

test("the explorer's Memory lists the conversation summary and the memory files, and the summary opens as a document", async () => {
  const page = loadPage({ listing: MORE, files: { '@summary': '# Summary\n\n- built the tracker' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  await page.settle();
  const tree = page.tree();
  assert.match(tree, /data-mem="@summary"[^>]*>[\s\S]*?Conversation summary[\s\S]*?data-mem="\/h\/\.claude\/CLAUDE\.md"[^>]*>[\s\S]*?all projects[\s\S]*?MEMORY\.md[\s\S]*?auto memory/);
  await page.clickButton('tn', { mem: '@summary' });
  assert.ok(page.gets.some(g => g.path === '/api/agent/r1/file?path=%40summary'));
  assert.match(page.tabs(), /class="tab on"[^]*?Conversation summary/);
  assert.match(page.el('reader-body').innerHTML, /<li>built the tracker<\/li>/);
});

test('when the folder itself is off, the explorer says why and still shows memory', async () => {
  const page = loadPage({ listing: { ...MORE, files: [], status: {}, repos: [], touched: {}, folderError: 'This agent works in your home folder (or the disk root), so the explorer stays off here.', scratch: null } });
  page.push(richSnapshot([richAgent()]));
  await page.settle();
  assert.match(page.tree(), /data-mem="@summary"[\s\S]*home folder/);
  assert.doesNotMatch(page.tree(), /data-group="ex-scratch"/);
});

function fakeFarm() {
  const calls = [];
  let options = null;
  return {
    calls,
    pick: id => options.onPickAgent(id),
    pickSay: id => options.onPickAgent(id, { from: 'say' }),
    openDoc: (id, path) => options.onOpenDoc(id, path),
    showRepos: () => options.onShowRepos(),
    nav: what => options.onNav(what),
    farm: {
      mount(host, opts) { options = opts; calls.push(['mount', host.id, opts.token]); },
      diaryId: () => options?.diary?.id,
      select(id) { calls.push(['select', id]); },
      colorOf: () => '#d9673a',
      update(snap) { calls.push(['update', snap.agents.length]); },
      unmount() { calls.push(['unmount']); },
    },
  };
}

test('the view toggle switches to the farm and remembers it', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm });
  page.push(richSnapshot([richAgent()]));
  assert.equal(page.el('main').dataset.view, 'list');
  await page.click('view-farm');
  assert.equal(page.el('main').dataset.view, 'farm');
  assert.equal(page.stored['tracker-view'], 'farm');
  assert.equal(page.el('view-farm').attrs['aria-pressed'], 'true');
  assert.deepEqual(f.calls.slice(0, 2), [['mount', 'farm', '__TRACKER_TOKEN__'], ['update', 1]]);
  const again = fakeFarm();
  const reload = loadPage({ farm: again.farm, stored: { ...page.stored } });
  assert.equal(reload.el('main').dataset.view, 'farm');
  assert.deepEqual(again.calls[0], ['mount', 'farm', '__TRACKER_TOKEN__']);
  await reload.click('view-list');
  assert.equal(reload.el('main').dataset.view, 'list');
  assert.deepEqual(again.calls.at(-1), ['unmount']);
  assert.equal(reload.stored['tracker-view'], 'list');
});

test('in farm mode a snapshot goes to the farm; the list and the centre are not drawn', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm' } });
  page.push(richSnapshot([richAgent(), richAgent({ id: 'r2', name: 'second' })]));
  assert.deepEqual(f.calls.filter(c => c[0] === 'update').at(-1), ['update', 2]);
  assert.equal(page.side(), '');
  assert.equal(page.el('list').innerHTML, '');
  assert.match(page.el('kpis').innerHTML, /Working/);
});

test('clicking a farmer opens the farm sidebar on that agent, with its answer form, and the farm marks it', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm' } });
  page.push(askSnapshot(QUESTION));
  f.pick('w1');
  assert.equal(page.el('main').dataset.view, 'farm');
  assert.equal(page.el('main').dataset.side, 'open');
  assert.deepEqual(f.calls.filter(c => c[0] === 'select').at(-1), ['select', 'w1']);
  const side = page.el('farm-agent').innerHTML;
  assert.match(side, /Pick a colour\?/);
  assert.match(side, /id="ask-send"/);
  pick(page, 'Blue');
  await page.clickButton('ask-send', { agent: 'w1', tool: 'toolu_Q1' });
  assert.deepEqual(page.posts, [{ path: '/api/actions/answer', body: { agentId: 'w1', toolUseId: 'toolu_Q1', answers: { 'Pick a colour?': 'Blue' } } }]);
});

test('a document picked in the field close-up opens in the reader, in a dialog over the farm', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm' }, files: { '/w/docs/spec.md': '# Spec' } });
  page.push(richSnapshot([richAgent()]));
  await f.openDoc('r1', '/w/docs/spec.md');
  assert.equal(page.el('main').dataset.view, 'farm');
  assert.equal(page.el('file-dlg').open, true);
  assert.match(page.el('reader-body').innerHTML, /<h1[^>]*>Spec<\/h1>/);
});

test('the "+N more fields" signpost opens the list view with the repos shown', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-closed-groups': '["repos","idle","stale"]' } });
  page.push(richSnapshot([richAgent()]));
  f.showRepos();
  assert.equal(page.el('main').dataset.view, 'list');
  assert.match(page.el('rail').innerHTML, /data-group="repos" aria-expanded="true"/);
});

test('without the farm script, the toggle stays on the list and says why', async () => {
  const page = loadPage({ stored: { 'tracker-view': 'farm' } });
  assert.equal(page.el('main').dataset.view, 'list');
  assert.match(page.el('notice').textContent, /farm view could not load/);
  page.push(richSnapshot([richAgent()]));
  assert.match(page.list(), /busy-one/);
  await page.click('view-farm');
  assert.equal(page.el('main').dataset.view, 'list');
});

test('the page loads its mark, the farm (deferred), then its token, then its own scripts in order', () => {
  const tags = [...html.matchAll(/<script(?: src="\/([a-z]+)\.js"( defer)?)?>/g)].map(m => (m[1] ? `${m[1]}${m[2] ? ' defer' : ''}` : 'inline'));
  assert.deepEqual(tags, ['inline', 'brand', 'farm defer', 'inline', 'core', 'charts', 'panels', 'markdown', 'viewer', 'explorer', 'conversation', 'app', 'sessions', 'setup']);
  assert.match(html, /<script>const TOKEN = '__TRACKER_TOKEN__';<\/script>/);
});

test('the sidebar toggle shows activity and the explorer beside the farm, and is remembered', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm' }, listing: LISTING });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  assert.equal(page.el('side-toggle').hidden, false);
  assert.notEqual(page.el('main').dataset.side, 'open');
  await page.click('side-toggle');
  assert.equal(page.el('main').dataset.side, 'open');
  assert.equal(page.stored['tracker-farm-side'], 'open');
  assert.equal(page.el('side-toggle').attrs['aria-pressed'], 'true');
  const side = page.el('farm-agent').innerHTML;
  assert.match(side, /busy-one/);
  assert.match(side, /id="msg-text"/);
  await page.clickButton('tab-activity', { farmTab: 'activity' });
  assert.match(page.el('farm-activity').innerHTML, /npm test/);
  await page.clickButton('tab-files', { farmTab: 'files' });
  await page.settle();
  assert.ok(page.gets.some(g => g.path === '/api/agent/r1/files'));
  assert.match(page.tree(), /data-file="src\/app\.ts"/);
  await page.click('side-toggle');
  assert.equal(page.el('main').dataset.side, 'closed');
  assert.equal(page.stored['tracker-farm-side'], 'closed');
  await page.click('view-list');
  assert.equal(page.el('side-toggle').hidden, true);
});

test('a message can be sent from the farm sidebar', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  page.edit('input', { tagName: 'TEXTAREA', value: 'Water the pumpkins', dataset: { msgAgent: 'r1' } });
  await page.clickButton('msg-send', { agent: 'r1' });
  assert.deepEqual(page.posts, [{ path: '/api/actions/message', body: { agentId: 'r1', text: 'Water the pumpkins' } }]);
  assert.match(page.el('farm-agent').innerHTML, /id="msg-status"[^>]*>Queued for busy-one/);
});

test("entering the farm clears the list's centre and leaving clears the sidebar, so each id exists once", async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-farm-side': 'open' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  assert.match(page.side(), /id="msg-text"/);
  await page.click('view-farm');
  assert.equal(page.side(), '');
  assert.equal(page.tabs(), '');
  assert.match(page.el('farm-agent').innerHTML, /id="msg-text"/);
  await page.click('view-list');
  assert.equal(page.el('farm-agent').innerHTML, '');
  assert.match(page.side(), /id="msg-text"/);
});

test('a file picked in the sidebar explorer opens in a dialog over the farm', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open', 'tracker-farm-tab': 'files' }, listing: LISTING, files: { '/w/src/app.ts': 'const a = 1;\n' } });
  page.push(richSnapshot([richAgent()]));
  await page.settle();
  await page.clickButton('tn', { file: 'src/app.ts' });
  await page.settle();
  assert.equal(page.el('main').dataset.view, 'farm');
  assert.equal(page.el('file-dlg').open, true);
  assert.match(page.el('reader-body').innerHTML, /data-n="1">const a = 1;/);
});

test('while you type in the sidebar, new snapshots still reach the farm but the sidebar waits', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  page.focus({ tagName: 'TEXTAREA' });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } }), richAgent({ id: 'r2', name: 'newcomer' })]));
  assert.deepEqual(f.calls.filter(c => c[0] === 'update').at(-1), ['update', 2]);
  assert.doesNotMatch(page.el('farm-agent').innerHTML, /newcomer/);
});

test('the tab title counts the agents waiting on you', () => {
  const page = loadPage();
  page.push(askSnapshot(QUESTION));
  assert.equal(page.ctx.document.title, '(1) Agentville');
  page.push(richSnapshot([richAgent()]));
  assert.equal(page.ctx.document.title, 'Agentville');
});

const chatty = () => richAgent({
  mod: { version: '0.3.1', live: true },
  feed: [
    { at: Date.now() - 1000, kind: 'tool', tool: 'Bash', text: 'npm test', ok: true, durationMs: 900 },
    { at: Date.now() - 2000, kind: 'reply', text: 'Done.', body: 'Done.\nAll <b>tests</b> pass.' },
    { at: Date.now() - 2500, kind: 'reply', text: 'Plan:', body: 'Plan:\n\n- **fix** it' },
    { at: Date.now() - 3000, kind: 'tool', tool: 'Edit', text: 'web/index.html', ok: true, durationMs: 100 },
    { at: Date.now() - 4000, kind: 'prompt', text: 'Fix the build', body: 'Fix the build\nplease' },
  ],
});

test('the conversation shows your prompts and the replies as a thread, newest first; Activity shows the tool steps', async () => {
  const page = loadPage();
  page.push(richSnapshot([chatty()]));
  const side = page.side();
  assert.match(side, /class="chat"><div class="latest"[^>]*><span class="latest-tag">Latest<\/span><div class="bub agent"[^>]*>[\s\S]*?<p>Done\. All &lt;b&gt;tests&lt;\/b&gt; pass\.<\/p>[\s\S]*?class="bub agent"[\s\S]*?Plan:[\s\S]*?class="bub you"[^>]*>Fix the build\nplease/, 'newest first');
  const now = side.indexOf('>Now<'), chat = side.indexOf('>Conversation<'), box = side.indexOf('id="msg-text"'), activity = side.indexOf('>Activity<');
  assert.ok(now < box && box < chat && chat < activity, `${now} ${box} ${chat} ${activity}`);
  const feed = side.slice(activity);
  assert.match(feed, /npm test/);
  assert.match(feed, /web\/index\.html/);
  assert.match(side, /<li><strong>fix<\/strong> it<\/li>/);
  assert.doesNotMatch(feed.slice(0, feed.indexOf('</div></div>') + 1), /Fix the build|Done\./);
});

test('the newest message is framed as the latest, with your message when it is right below it', async () => {
  const exchange = feed => richSnapshot([richAgent({ mod: { version: '0.3.1', live: true }, feed })]);
  const page = loadPage();
  page.push(exchange([
    { at: Date.now() - 1000, kind: 'reply', text: 'Shipped.' },
    { at: Date.now() - 1500, kind: 'tool', tool: 'Bash', text: 'git push', ok: true, durationMs: 900 },
    { at: Date.now() - 2000, kind: 'prompt', text: 'Ship it' },
    { at: Date.now() - 3000, kind: 'reply', text: 'Done.' },
    { at: Date.now() - 4000, kind: 'prompt', text: 'Fix the build' },
  ]));
  const latest = page.side().match(/<div class="latest"[^>]*><span class="latest-tag">Latest<\/span>([\s\S]*?)<\/div><\/div><div class="bub agent"><div class="bub-md"><p>Done\./);
  assert.ok(latest, 'a reply and your message right below it: the frame closes before the older reply');
  assert.match(latest[1], /Shipped\.[\s\S]*class="bub you">Ship it/);
  assert.doesNotMatch(latest[1], /Fix the build/);
  assert.equal((page.side().match(/class="latest"/g) ?? []).length, 1);
  page.push(exchange([{ at: Date.now() - 1000, kind: 'prompt', text: 'Anyone there?' }, { at: Date.now() - 2000, kind: 'reply', text: 'Done.' }]));
  assert.match(page.side(), /<div class="latest"[^>]*><span class="latest-tag">Latest<\/span><div class="bub you">Anyone there\?<time>[^<]*<\/time><\/div><\/div><div class="bub agent">/, 'just sent, no reply yet');
  // A long working turn: progress notes one after another since your message. Only the newest is the latest.
  page.push(exchange([
    { at: Date.now() - 1000, kind: 'reply', text: 'Build is running.' },
    { at: Date.now() - 2000, kind: 'reply', text: 'All green.' },
    { at: Date.now() - 3000, kind: 'reply', text: 'Writing the files.' },
    { at: Date.now() - 4000, kind: 'prompt', text: 'Deploy it' },
  ]));
  assert.match(page.side(), /<div class="latest"[^>]*><span class="latest-tag">Latest<\/span><div class="bub agent"><div class="bub-md"><p>Build is running\.<\/p><\/div>[\s\S]*?<\/time><\/div><\/div><div class="bub agent"><div class="bub-md"><p>All green\./, 'only the newest note');
  assert.doesNotMatch(page.side().match(/<div class="latest"[\s\S]*?<\/div><\/div><div class="bub/)[0], /Deploy it|Writing the files/);
});

test('the farm sidebar has the conversation too', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' } });
  page.push(richSnapshot([chatty()]));
  assert.match(page.el('farm-agent').innerHTML, />Conversation<[\s\S]*class="bub you"/);
});

const asking = (over = {}) => richAgent({ state: 'yourTurn', stateReason: 'turn finished', now: undefined, lastReply: 'Done.', question: 'Should I push them to main?', mod: { version: '0.3.1', live: true }, ...over });
const turnSnapshot = agents => ({ ...richSnapshot(agents), counts: { waiting: 0, working: 0, yourTurn: agents.length, stale: 0, idle: 0, collisions: 0 } });

test('an agent whose turn ended with a question is marked as asking you, in its row, the tiles and the tab title', () => {
  const page = loadPage();
  page.push(turnSnapshot([asking()]));
  assert.match(page.list(), /asks you[\s\S]*Should I push them to main\?/);
  assert.match(page.el('kpis').innerHTML, /1 asks you/);
  assert.equal(page.ctx.document.title, '(1) Agentville');
});

test('the question card answers a yes/no question in one click, or starts a "No, …" reply', async () => {
  const page = loadPage();
  page.push(turnSnapshot([asking()]));
  assert.match(page.side(), /class="qcard"[\s\S]*Should I push them to main\?/);
  await page.clickButton('quick-yes', { quickReply: 'Yes.', agent: 'r1' });
  assert.deepEqual(page.posts, [{ path: '/api/actions/message', body: { agentId: 'r1', text: 'Yes.' } }]);
  await page.clickButton('quick-no', { quickDraft: 'No, ', agent: 'r1' });
  assert.match(page.side(), /<textarea id="msg-text"[^>]*>No, <\/textarea>/);
});

test('an open question gets no yes/no buttons, only the reply box', () => {
  const page = loadPage();
  page.push(turnSnapshot([asking({ question: 'Which colour do you want?' })]));
  assert.match(page.side(), /class="qcard"[\s\S]*Which colour do you want\?/);
  assert.doesNotMatch(page.side(), /data-quick-reply/);
});

test("Reply on one of the agent's messages quotes it into the message box", async () => {
  const page = loadPage();
  page.push(richSnapshot([chatty()]));
  assert.match(page.side(), /class="bub agent"[\s\S]*?data-quote="Done\.\nAll &lt;b&gt;tests&lt;\/b&gt; pass\."/);
  await page.clickButton('quote', { quote: 'Done.\nAll <b>tests</b> pass.', agent: 'r1' });
  assert.match(page.side(), /<textarea id="msg-text"[^>]*>&gt; Done\.\n&gt; All &lt;b&gt;tests&lt;\/b&gt; pass\.\n\n<\/textarea>/);
});

test('Show all loads the whole history for the conversation and activity, with a link to the full transcript', async () => {
  const older = [
    { at: Date.now() - 900_000, kind: 'tool', tool: 'Grep', text: 'an old search', ok: true, durationMs: 10 },
    { at: Date.now() - 950_000, kind: 'prompt', text: 'An early request', body: 'An early request' },
  ];
  const page = loadPage({ feeds: { r1: [...chatty().feed, ...older] } });
  page.push(richSnapshot([chatty()]));
  assert.match(page.side(), /href="\/agent\/r1\/transcript"[^>]*>Full transcript ↗/);
  assert.doesNotMatch(page.side(), /an old search/);
  await page.clickButton('more', { fullFeed: 'r1' });
  assert.ok(page.gets.some(g => g.path === '/api/agent/r1/feed?limit=200'));
  assert.match(page.side(), /an old search/);
  assert.match(page.side(), /An early request/);
  assert.match(page.side(), /Show less/);
  await page.clickButton('more', { fullFeed: 'r1' });
  assert.doesNotMatch(page.side(), /an old search/);
});

test('a long message shows its preview and "Show the whole message", which loads it in full', async () => {
  const full = `Start\n\n${'w'.repeat(700)} THE END`;
  const preview = { at: Date.now() - 2000, kind: 'reply', text: 'Start', body: `${full.slice(0, 600)}…`, more: true };
  const page = loadPage({ feeds: { r1: [{ ...preview, body: full, more: undefined }] } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true }, feed: [preview] })]));
  assert.match(page.side(), /data-full-feed="r1"[^>]*>Show the whole message</);
  assert.doesNotMatch(page.side(), /THE END/);
  await page.clickButton('more', { fullFeed: 'r1' });
  assert.match(page.side(), /THE END/);
  assert.doesNotMatch(page.side(), /Show the whole message/);
});

test('clicking a cut-off speech bubble opens the sidebar with the whole message loaded; a farmer click does not', async () => {
  const full = `Start\n\n${'w'.repeat(700)} THE END`;
  const preview = { at: Date.now() - 2000, kind: 'reply', text: 'Start', body: `${full.slice(0, 600)}…`, more: true };
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm' }, feeds: { r1: [{ ...preview, body: full, more: undefined }] } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true }, feed: [preview] })]));
  f.pick('r1');
  await page.settle();
  assert.ok(!page.gets.some(g => g.path.startsWith('/api/agent/r1/feed')), 'a farmer click shows the preview only');
  assert.doesNotMatch(page.el('farm-agent').innerHTML, /THE END/);
  f.pickSay('r1');
  await page.settle();
  assert.match(page.el('farm-agent').innerHTML, /THE END/);
  assert.doesNotMatch(page.el('farm-agent').innerHTML, /Show the whole message/);
});

test('the farm sidebar shows the question card too', () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' } });
  page.push(turnSnapshot([asking()]));
  assert.match(page.el('farm-agent').innerHTML, /class="qcard"[\s\S]*Should I push them to main\?/);
});

test('in the farm sidebar too: Now, the question, the message box, then the conversation (activity has its own tab)', () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' } });
  page.push(turnSnapshot([asking({ feed: chatty().feed })]));
  const side = page.el('farm-agent').innerHTML;
  const at = [side.indexOf('>Now<'), side.indexOf('class="qcard"'), side.indexOf('id="msg-text"'), side.indexOf('>Conversation<')];
  assert.ok(at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])), at.join(' '));
});

test('the farm sidebar has Agent, Files and Diary tabs; the choice is remembered, and picking a farmer shows Agent', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' }, listing: LISTING });
  page.push(richSnapshot([richAgent({ mod: { version: '0.3.1', live: true } })]));
  assert.equal(page.el('main').dataset.sideTab, 'agent');
  assert.match(page.el('farm-agent').innerHTML, /id="msg-text"/);
  assert.equal(page.el('tab-agent').attrs['aria-selected'], 'true');
  await page.clickButton('tab-files', { farmTab: 'files' });
  assert.equal(page.el('main').dataset.sideTab, 'files');
  assert.equal(page.stored['tracker-farm-tab'], 'files');
  assert.equal(page.el('tab-files').attrs['aria-selected'], 'true');
  await page.settle();
  assert.match(page.tree(), /data-file="README\.md"/);
  await page.clickButton('tab-diary', { farmTab: 'diary' });
  assert.equal(page.el('main').dataset.sideTab, 'diary');
  assert.equal(f.farm.diaryId(), 'farm-diary', 'the farm writes its diary into the Diary tab');
  f.pick('r1');
  assert.equal(page.el('main').dataset.sideTab, 'agent');
});

test('a failed deploy chip links to the run on GitHub and says why on hover', () => {
  const page = loadPage();
  const snap = richSnapshot([richAgent()]);
  snap.repos = [{ path: '/w', name: 'w', branch: 'main', agentIds: ['r1'], lastDeploy: { source: 'actions', state: 'failed', label: '✗ deploy failed', detail: 'Deploy Backend failure at 6131f98: Process completed with exit code 1.', url: 'https://github.com/o/r/actions/runs/99' } }];
  page.push(snap);
  assert.match(page.el('rail').innerHTML, /<a class="chip c-crit" href="https:\/\/github\.com\/o\/r\/actions\/runs\/99" target="_blank" rel="noopener"[^>]*data-tip="Deploy Backend failure at 6131f98: Process completed with exit code 1\."[^>]*>✗ deploy failed/);
  snap.repos[0].lastDeploy.url = 'javascript:alert(1)';
  page.push(snap);
  assert.doesNotMatch(page.el('rail').innerHTML, /href="javascript/);
});

test('before the first update the page says it is loading', () => {
  assert.match(html, /<section id="list"><div class="loading"><span class="spinner"><\/span>[^<]*Loading/);
  assert.match(html, /<div id="center-body" class="center-body"><div class="loading">/);
});

test('Show all says it is loading while it fetches', async () => {
  const page = loadPage({ feeds: { r1: chatty().feed } });
  page.push(richSnapshot([chatty()]));
  await page.clickButton('more', { fullFeed: 'r1' });
  assert.equal(page.el('more').textContent, 'Loading…');
  assert.match(page.side(), /Show less/);
});

test('hidden controls stay hidden even when their own style sets a display', () => {
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test("Activity is its own tab in the farm sidebar, and the Agent tab no longer repeats it", async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' } });
  page.push(richSnapshot([chatty()]));
  assert.doesNotMatch(page.el('farm-agent').innerHTML, />Activity/);
  assert.match(page.el('farm-agent').innerHTML, />Conversation</);
  await page.clickButton('tab-activity', { farmTab: 'activity' });
  assert.equal(page.el('main').dataset.sideTab, 'activity');
  assert.equal(page.stored['tracker-farm-tab'], 'activity');
  const act = page.el('farm-activity').innerHTML;
  assert.match(act, />Activity/);
  assert.match(act, /npm test/);
  assert.match(act, /Show all/);
});

test("the top bar shows the plan's limits (5-hour, weekly) and when they reset; nothing without a reading", () => {
  const page = loadPage();
  const snap = richSnapshot([richAgent()]);
  snap.plan = { from: 'x', at: Date.now() - 60_000, windows: [
    { kind: 'five_hour', percentUsed: 6, resetsAt: Date.now() + 3_600_000 },
    { kind: 'seven_day', percentUsed: 47, resetsAt: Date.now() + 4 * 86_400_000 },
    { kind: 'seven_day_opus', percentUsed: 92, resetsAt: null },
  ] };
  page.push(snap);
  const stats = page.el('hstats').innerHTML;
  assert.match(stats, />Plan</);
  assert.match(stats, /5-hour 6%/);
  assert.match(stats, /week 47%/);
  assert.match(stats, /week · Opus 92%/);
  assert.match(stats, /5-hour limit: 6% used, resets at/);
  assert.match(stats, /class="[^"]*\bbad\b[^"]*"[\s\S]*92%|92%/);
  page.push(richSnapshot([richAgent()]));
  assert.doesNotMatch(page.el('hstats').innerHTML, />Plan</);
});

test("an agent's panel shows what its session has cost so far", async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ usage: { costUsd: 2.5, contextPercent: 41.5 } })]));
  assert.match(page.side(), /Cost[\s\S]*\$2\.50/);
  page.push(richSnapshot([richAgent()]));
  assert.doesNotMatch(page.side(), />Cost</);
});

test("a repo card shows its last deploy as the collector words it: direct, blocked, failed", () => {
  const page = loadPage();
  const snap = richSnapshot([richAgent()]);
  snap.repos = [
    { path: '/code/a', name: 'a', branch: 'main', dirty: 0, ahead: 0, behind: 0, agentIds: ['r1'], lastDeploy: { source: 'direct', state: 'ok', label: '✓ deployed directly', detail: 'busy-one deployed it directly: Run the deploy' } },
    { path: '/code/b', name: 'b', branch: 'main', dirty: 0, ahead: 0, behind: 0, agentIds: ['r1'], lastDeploy: { source: 'actions', state: 'blocked', label: "⏸ Actions didn't run", detail: 'Deploy never started: spending limit', url: 'https://github.com/o/b/actions/runs/1' } },
  ];
  page.push(snap);
  const rail = page.el('rail').innerHTML;
  assert.match(rail, /✓ deployed directly/);
  assert.match(rail, /busy-one deployed it directly/);
  assert.match(rail, /⏸ Actions didn&#39;t run|⏸ Actions didn't run/);
  assert.match(rail, /href="https:\/\/github.com\/o\/b\/actions\/runs\/1"/);
  assert.doesNotMatch(rail, /deploy failed/);
});

test("a terminal session's panel shows its permission mode, and ends or restarts it only after you confirm", async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ pid: 4242, mode: 'plan' })]));
  const side = page.side();
  assert.match(side, /Plan mode/);
  assert.match(side, /data-end-session="r1"/);
  assert.match(side, /data-restart-mode/);
  await page.clickButton('end-btn', { endSession: 'r1' });
  assert.equal(page.el('confirm').open, true);
  assert.match(page.el('confirm-text').textContent, /End busy-one\?/);
  assert.deepEqual(page.posts, [], 'nothing until you confirm');
  await page.clickButton('confirm-yes', { confirm: 'yes' });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(page.posts, [{ path: '/api/actions/end', body: { agentId: 'r1' } }]);
  await page.change({ dataset: { restartMode: '', agent: 'r1' }, value: 'bypassPermissions' });
  assert.match(page.el('confirm-text').textContent, /Restart busy-one in Bypass permissions/);
  assert.match(page.el('confirm-text').textContent, /without asking/);
  await page.clickButton('confirm-no', { confirm: 'no' });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(page.posts.length, 1, 'cancelled: nothing posted');
  await page.change({ dataset: { restartMode: '', agent: 'r1' }, value: 'acceptEdits' });
  await page.clickButton('confirm-yes', { confirm: 'yes' });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(page.posts[1], { path: '/api/actions/restart', body: { agentId: 'r1', mode: 'acceptEdits' } });
  page.push(richSnapshot([richAgent({ kind: 'codex', id: 'codex:1' })]));
  assert.doesNotMatch(page.side(), /data-end-session/);
});

test("a session whose mode is not known yet says so, rather than guessing", () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ pid: 4242 })]));
  assert.match(page.side(), /mode not known yet/);
  assert.doesNotMatch(page.side(), /Ask first<\/span>/);
});

test("a stale background session's panel offers Remove, and removes it only after you confirm", async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ id: 'b1', kind: 'background', state: 'stale', cliId: 'abc123', pid: undefined, now: undefined })]));
  await page.openAgent('b1');
  assert.match(page.side(), /data-remove-session="b1"/);
  assert.doesNotMatch(page.side(), /data-end-session/);
  await page.clickButton('rm-btn', { removeSession: 'b1' });
  assert.match(page.el('confirm-text').textContent, /Remove busy-one\?/);
  assert.deepEqual(page.posts, []);
  await page.clickButton('confirm-yes', { confirm: 'yes' });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(page.posts, [{ path: '/api/actions/rm', body: { ids: ['b1'] } }]);
});

test('the conversation shows messages from and to other sessions as their own bubbles', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ feed: [
    { at: Date.now() - 1000, kind: 'peer', dir: 'in', other: 'shop-api-3', text: 'Hold the deploy.', body: 'Hold the deploy.' },
    { at: Date.now() - 500, kind: 'peer', dir: 'out', other: 'shop-api-3', summary: 'Holding', text: 'Holding until you say so.', body: 'Holding until you say so.' },
  ] })]));
  const side = page.side();
  assert.match(side, /class="bub peer in"[\s\S]*from shop-api-3[\s\S]*Hold the deploy\./);
  assert.match(side, /class="bub peer out"[\s\S]*to shop-api-3 · Holding[\s\S]*Holding until you say so\./);
});

test("a session's bar switches its model and effort (in the session, after you confirm), and side questions show with their answers", async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ pid: 4242, model: 'claude-opus-5-5', effort: 'xhigh', mod: { live: true, version: '0.5.0' },
    asides: [{ id: '2', question: 'Still running?', pending: true, at: 2 }, { id: '1', question: 'Where is the parser?', answer: 'In **parse.mjs**.', at: 1, answeredAt: 1 }],
    setting: { command: 'model', args: 'sonnet', ok: true, text: 'Set model to `Sonnet 5.5` and saved as your default for new sessions', at: Date.now() } })]));
  const side = page.side();
  assert.match(side, /data-switch-model[^>]*><option value="">Opus 5\.5<\/option>/, 'the model it is on, in short');
  assert.match(side, /effort: xhigh/);
  assert.match(side, /✓ Set model to Sonnet 5\.5/, 'what Claude Code said of the last switch');
  assert.match(side, /Where is the parser\?[\s\S]*<strong>parse\.mjs<\/strong>/, 'an answer, as markdown');
  assert.match(side, /Still running\?[\s\S]*thinking…/, 'a question still being answered');
  await page.change({ dataset: { switchModel: '', agent: 'r1' }, value: 'haiku' });
  assert.match(page.el('confirm-text').textContent, /Switch busy-one to Haiku\? It runs \/model haiku in the session after its current turn\. Claude Code also saves it as your default/);
  assert.deepEqual(page.posts, [], 'nothing until you confirm');
  await page.clickButton('confirm-yes', { confirm: 'yes' });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(page.posts, [{ path: '/api/actions/setting', body: { agentId: 'r1', model: 'haiku' } }]);
  await page.change({ dataset: { switchEffort: '', agent: 'r1' }, value: 'max' });
  assert.doesNotMatch(page.el('confirm-text').textContent, /default for new sessions/, 'max is for this session only');
});

test('a model just set with /model shows at once, before a reply from it', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ pid: 4242, model: 'claude-opus-4-8', modelLabel: 'Opus 5.5 (1M context)', mod: { live: true, version: '0.5.0' } })]));
  const side = page.side();
  assert.match(side, /data-switch-model[^>]*><option value="">Opus 5\.5 \(1M context\)<\/option>/);
  assert.match(side, /· Opus 5\.5 \(1M context\)/);
  assert.doesNotMatch(side, /claude-opus-4-8|Opus 4\.8/, 'not the model of its last reply');
});

test('the side question section folds to its heading, with how many it holds, and stays folded after a reload', async () => {
  const live = () => richSnapshot([richAgent({ mod: { live: true, version: '0.5.0' }, asides: [{ id: '1', question: 'Where is the parser?', answer: 'In parse.mjs.', at: 1, answeredAt: 1 }] })]);
  const page = loadPage();
  page.push(live());
  assert.match(page.side(), /data-group="btw" aria-expanded="true"/);
  assert.match(page.side(), /id="aside-text"/);
  await page.clickButton('grp', { group: 'btw' });
  assert.match(page.side(), /data-group="btw" aria-expanded="false"/);
  assert.doesNotMatch(page.side(), /id="aside-text"|Where is the parser/, 'the box and the answers are hidden');
  assert.match(page.side(), /data-group="btw"[^>]*>[\s\S]*?<span class="grp-n">1<\/span>/, 'the folded heading says how many');
  const again = loadPage({ stored: { ...page.stored } });
  again.push(live());
  assert.match(again.side(), /data-group="btw" aria-expanded="false"/);
  await again.clickButton('grp', { group: 'btw' });
  assert.match(again.side(), /id="aside-text"/, 'a click shows it again');
});

test("a working session shows its terminal's working line: its word, how long, the tokens, and thinking with its effort", () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ now: undefined, effort: 'xhigh', turn: { startedAt: Date.now() - 331_000, outTokens: 28_500, word: 'Slithering', mode: 'thinking' } })]));
  const side = page.side();
  assert.match(side, /<b>Slithering…<\/b> <span class="muted">\(<span data-lasted="\d+">5m 3\ds<\/span> · ↓ 28\.5k tokens · thinking with xhigh effort\)/);
  page.push(richSnapshot([richAgent({ turn: { startedAt: Date.now() - 12_000, outTokens: 860 } })]));
  assert.match(page.side(), /<b>Working…<\/b> <span class="muted">\(<span data-lasted="\d+">1\ds<\/span> · ↓ 860 tokens\)/, 'without its mod: from its steps, a tool running');
});

// The sessions dialog: past sessions to resume, with search, filters and sorting.
const H = 3_600_000;
const pastSessions = () => {
  const now = Date.now();
  const sessions = [
    { id: 'a', cwd: '/code/app', title: 'Release planning', firstPrompt: 'Plan the release', lastPrompt: 'Ship it', at: now - 1 * H, startedAt: now - 72 * H, size: 3 * 1_048_576, model: 'claude-opus-5-5', branch: 'main', live: false },
    { id: 'b', cwd: '/code/api', title: 'Login bug fix', firstPrompt: 'Fix login', lastPrompt: 'Try again', at: now - 2 * H, startedAt: now - 2.2 * H, size: 200 * 1024, model: 'claude-sonnet-5-5', branch: 'fix/login', live: true },
    { id: 'c', cwd: '/code/app', title: null, firstPrompt: 'Add charts', lastPrompt: 'Add charts', at: now - 5 * H, startedAt: now - 24 * H, size: 1_048_576, model: 'claude-opus-4-8', branch: 'feature/charts', live: false },
  ];
  return { terminal: 'Terminal', sessions, projects: [{ cwd: '/code/app', name: 'app', at: now - H, sessions: 2 }, { cwd: '/code/api', name: 'api', at: now - 2 * H, sessions: 1 }] };
};
const allSessions = () => {
  const d = pastSessions();
  d.sessions.push({ id: 'd', cwd: '/code/old', title: 'Ancient work', firstPrompt: 'Old', lastPrompt: 'Old', at: Date.now() - 60 * 24 * H, startedAt: Date.now() - 61 * 24 * H, size: 4096, model: 'claude-haiku-4-5-20251001', branch: 'main', live: false });
  d.projects.push({ cwd: '/code/old', name: 'old', at: Date.now() - 60 * 24 * H, sessions: 1 });
  return d;
};
const sessPage = async (opts = {}) => {
  const page = loadPage({ ...opts, replies: { '/api/sessions': pastSessions(), '/api/sessions?days=all': allSessions() } });
  await page.ctx.openSessions();
  await page.settle();
  return page;
};
const shownSessions = page => [...page.el('sess-body').innerHTML.matchAll(/class="sess-row" data-sess-id="([^"]+)"/g)].map(m => m[1]);
const shownFolders = page => [...page.el('sess-body').innerHTML.matchAll(/data-sess-new="([^"]+)"/g)].map(m => m[1]);
const pickIn = async (page, id, value) => { await page.change({ id, value }); await page.settle(); };

test('past sessions show their folder, branch, model, length and when they started, newest first, with a count', async () => {
  const page = await sessPage();
  assert.deepEqual(page.gets.map(g => g.path).filter(p => p.startsWith('/api/sessions')), ['/api/sessions'], 'the last 30 days');
  assert.deepEqual(shownSessions(page), ['a', 'b', 'c']);
  const body = page.el('sess-body').innerHTML;
  assert.match(body, /data-sess-id="a"[\s\S]*?Release planning[\s\S]*?app · ⎇ main · Opus 5\.5 · 3\.0 MB[\s\S]*?started /);
  assert.match(body, /data-sess-id="b"[\s\S]*?running/);
  assert.match(page.el('sess-count').innerHTML, /Showing 3 of 3 sessions/);
  assert.doesNotMatch(page.el('sess-count').innerHTML, /data-sess-clear/, 'nothing to clear');
  assert.match(page.el('sess-f-folder').innerHTML, /<option value="">All folders \(3\)<\/option><option value="\/code\/app">app \(2\)<\/option><option value="\/code\/api">api \(1\)<\/option>/);
  assert.match(page.el('sess-f-model').innerHTML, /<option value="opus">Opus \(2\)<\/option><option value="sonnet">Sonnet \(1\)<\/option>/);
  assert.match(page.el('sess-f-branch').innerHTML, /<option value="main">main \(1\)<\/option>/);
});

test('past sessions filter by folder (both lists), model, branch, running and search, and the filters clear', async () => {
  const page = await sessPage();
  await pickIn(page, 'sess-f-folder', '/code/app');
  assert.deepEqual(shownSessions(page), ['a', 'c']);
  assert.deepEqual(shownFolders(page), ['/code/app'], 'the folders to start in narrow too');
  assert.match(page.el('sess-count').innerHTML, /Showing 2 of 3 sessions[\s\S]*data-sess-clear/);
  await pickIn(page, 'sess-f-folder', '');
  await pickIn(page, 'sess-f-model', 'opus');
  assert.deepEqual(shownSessions(page), ['a', 'c']);
  await pickIn(page, 'sess-f-model', 'sonnet');
  assert.deepEqual(shownSessions(page), ['b']);
  await pickIn(page, 'sess-f-model', '');
  await pickIn(page, 'sess-f-branch', 'feature/charts');
  assert.deepEqual(shownSessions(page), ['c']);
  await pickIn(page, 'sess-f-branch', '');
  await pickIn(page, 'sess-f-live', 'live');
  assert.deepEqual(shownSessions(page), ['b']);
  await pickIn(page, 'sess-f-live', 'idle');
  assert.deepEqual(shownSessions(page), ['a', 'c']);
  page.edit('input', { id: 'sess-filter', value: 'fix/' });
  assert.deepEqual(shownSessions(page), [], 'search and filters combine');
  await pickIn(page, 'sess-f-live', '');
  assert.deepEqual(shownSessions(page), ['b'], 'search finds a branch');
  page.edit('input', { id: 'sess-filter', value: 'CHARTS' });
  assert.deepEqual(shownSessions(page), ['c'], 'and a message, in any case');
  await pickIn(page, 'sess-f-folder', '/code/api');
  assert.match(page.el('sess-body').innerHTML, /No sessions match/);
  page.ctx.clearSessionFilters();
  assert.deepEqual(shownSessions(page), ['a', 'b', 'c']);
  assert.equal(page.el('sess-filter').value, '');
  assert.equal(page.el('sess-f-folder').value, '');
});

test('past sessions sort by last active, started, name, folder or length, and the sort is remembered', async () => {
  const page = await sessPage();
  await pickIn(page, 'sess-sort', 'started');
  assert.deepEqual(shownSessions(page), ['b', 'c', 'a']);
  await pickIn(page, 'sess-sort', 'name');
  assert.deepEqual(shownSessions(page), ['c', 'b', 'a'], 'Add charts, Login bug fix, Release planning');
  assert.deepEqual(shownFolders(page), ['/code/api', '/code/app'], 'folders A–Z too');
  await pickIn(page, 'sess-sort', 'folder');
  assert.deepEqual(shownSessions(page), ['b', 'a', 'c'], 'api, then app (newest first within it)');
  await pickIn(page, 'sess-sort', 'length');
  assert.deepEqual(shownSessions(page), ['a', 'c', 'b']);
  assert.deepEqual(shownFolders(page), ['/code/app', '/code/api'], 'folders by last active otherwise');
  assert.equal(page.stored['tracker-sess-sort'], 'length');
  const again = await sessPage({ stored: { ...page.stored } });
  assert.equal(again.el('sess-sort').value, 'length');
  assert.deepEqual(shownSessions(again), ['a', 'c', 'b']);
});

test('All time reads every past session, showing that it is reading, and is remembered', async () => {
  const page = await sessPage();
  const switching = pickIn(page, 'sess-range', 'all');
  assert.match(page.el('sess-body').innerHTML, /class="spinner"[\s\S]*Reading every session/, 'while it reads');
  await switching;
  assert.equal(page.gets.at(-1).path, '/api/sessions?days=all');
  assert.ok(page.gets.at(-1).token, 'with the token');
  assert.deepEqual(shownSessions(page), ['a', 'b', 'c', 'd']);
  assert.match(page.el('sess-count').innerHTML, /Showing 4 of 4 sessions · all time/);
  assert.equal(page.stored['tracker-sess-range'], 'all');
  const again = await sessPage({ stored: { ...page.stored } });
  assert.equal(again.gets.find(g => g.path.startsWith('/api/sessions')).path, '/api/sessions?days=all');
  assert.equal(again.el('sess-range').value, 'all');
});

// The conversation dialog (⤢ Read all): the whole conversation, oldest first, on demand.
const talk = (from, list) => ({ total: from + list.length, from, items: list });
const convoPage = async () => {
  const t = Date.now() - 3_600_000;
  const page = loadPage({ replies: {
    '/api/agent/r1/conversation': talk(0, [
      { at: t, kind: 'prompt', text: 'First question', body: 'First question' },
      { at: t + 60_000, kind: 'reply', text: 'The answer', body: 'The **answer**' },
      { at: t + 120_000, kind: 'peer', dir: 'in', other: 'docs-bot', text: 'Docs are done', body: 'Docs are done' },
    ]),
    '/api/agent/r1/conversation?from=3': talk(3, [{ at: t + 180_000, kind: 'reply', text: 'Later', body: 'Later news' }]),
  } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.5.0', live: true }, lastActivityAt: t + 120_000, feed: [{ at: Date.now() - 1000, kind: 'reply', text: 'Hi' }] })]));
  await page.openAgent('r1');
  return page;
};

test('⤢ Read all on the conversation opens the whole of it in a dialog, oldest first', async () => {
  const page = await convoPage();
  assert.match(page.side(), />Conversation<span class="grow"><\/span><button type="button" class="act mini" data-convo="r1"[^>]*>⤢ Read all<\/button>/);
  await page.clickButton('read-all', { convo: 'r1' });
  await page.settle();
  assert.equal(page.el('convo').open, true);
  const get = page.gets.find(g => g.path === '/api/agent/r1/conversation');
  assert.ok(get?.token, 'with the token');
  assert.match(page.el('convo-title').textContent, /busy-one/);
  assert.match(page.el('convo-sub').textContent, /3 messages since /);
  const body = page.el('convo-body').innerHTML;
  assert.match(body, /class="bub you"><div class="cv-text">First question<\/div>[\s\S]*class="bub agent"><div class="bub-md cv-text"><p>The <strong>answer<\/strong><\/p>[\s\S]*class="bub peer in"[\s\S]*from docs-bot[\s\S]*Docs are done/, 'oldest first; replies as markdown');
  assert.doesNotMatch(body, /data-quote/, 'no reply buttons: it is for reading');
});

test('while the dialog is open, new messages are added at the bottom; closing it stops that', async () => {
  const page = await convoPage();
  await page.clickButton('read-all', { convo: 'r1' });
  await page.settle();
  page.push(richSnapshot([richAgent({ mod: { version: '0.5.0', live: true }, lastActivityAt: Date.now(), feed: [{ at: Date.now() - 1000, kind: 'reply', text: 'Hi' }] })]));
  await page.settle();
  assert.ok(page.gets.some(g => g.path === '/api/agent/r1/conversation?from=3'));
  assert.match(page.el('convo-body').innerHTML, /Docs are done[\s\S]*Later news/, 'appended after the rest');
  assert.match(page.el('convo-sub').textContent, /4 messages/);
  page.ctx.closeConversation();
  assert.equal(page.el('convo').open, false);
  const asked = page.gets.length;
  page.push(richSnapshot([richAgent({ mod: { version: '0.5.0', live: true }, lastActivityAt: Date.now() + 5000, feed: [] })]));
  await page.settle();
  assert.equal(page.gets.filter(g => g.path.includes('/conversation')).length, page.gets.slice(0, asked).filter(g => g.path.includes('/conversation')).length, 'closed: nothing more is fetched');
});

test('the conversation dialog has the message box too, sharing the draft and files with the side panel', async () => {
  const page = await convoPage();
  await page.clickButton('read-all', { convo: 'r1' });
  await page.settle();
  const box = () => page.el('convo-compose').innerHTML;
  assert.match(box(), /<textarea id="convo-msg-text" data-msg-agent="r1"/);
  assert.match(box(), /id="convo-msg-attach"[^>]*>📎 Attach</);
  assert.match(box(), /id="convo-msg-send"/);
  assert.doesNotMatch(box(), /id="msg-text"/, 'its own ids: the side panel keeps its box');
  page.edit('input', { tagName: 'TEXTAREA', value: 'Seen the whole thing', dataset: { msgAgent: 'r1' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.5.0', live: true }, feed: [{ at: Date.now() - 1000, kind: 'reply', text: 'Hi' }] })]));
  assert.match(page.side(), /id="msg-text"[^>]*>Seen the whole thing</, 'the same draft in the side panel');
  await page.clickButton('convo-msg-attach', { agent: 'r1' });
  page.edit('change', { id: 'convo-file-picker', files: [{ name: 'notes.md', type: 'text/markdown', size: 7, arrayBuffer: async () => new TextEncoder().encode('# Notes').buffer }], value: 'x' });
  assert.match(box(), /<span class="thumb-name">notes\.md<\/span>/, "the dialog's own picker adds the file");
  assert.match(page.side(), /<span class="thumb-name">notes\.md<\/span>/, 'and the side panel shows it too');
  await page.clickButton('convo-msg-send', { agent: 'r1' });
  const sent = page.posts.find(p => p.path === '/api/actions/message').body;
  assert.deepEqual(sent, { agentId: 'r1', text: 'Seen the whole thing', files: [{ name: 'notes.md', data: 'IyBOb3Rlcw==' }] });
  assert.match(box(), /Queued for busy-one with 1 file/, 'what came of it shows in the dialog too');
});

test('Compact… in the session bar asks what to keep, then has the session run /compact', async () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ pid: 4242, mod: { live: true, version: '0.6.0' } })]));
  assert.match(page.side(), /<button type="button" class="act mini" data-compact="r1"[^>]*>Compact…<\/button>/);
  const asking = page.clickButton('compact', { compact: 'r1' });
  await page.settle();
  assert.match(page.el('confirm-text').textContent, /Compact busy-one\? It runs \/compact in the session after its current turn/);
  assert.equal(page.el('confirm-note').hidden, false, 'with a box for what to keep');
  page.el('confirm-note').value = 'keep the API decisions';
  await page.clickButton('confirm-yes', { confirm: 'yes' });
  await asking;
  await page.settle();
  assert.deepEqual(page.posts, [{ path: '/api/actions/setting', body: { agentId: 'r1', compact: 'keep the API decisions' } }]);
  const older = loadPage();
  older.push(richSnapshot([richAgent({ pid: 4242, mod: { live: true, version: '0.5.1' } })]));
  assert.match(older.side(), /data-compact="r1"[^>]*disabled/, 'an older mod cannot');
});

test('Always allow… on a permission prompt, then a pick among Claude Code\'s own options', async () => {
  const page = loadPage();
  const prompt = { kind: 'permission', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'npm test', expiresAt: Date.now() + 10_000 };
  const snapWith = (ask, version = '0.6.0') => { const s = askSnapshot(ask); s.agents[0].mod = { live: true, version }; return s; };
  page.push(snapWith(prompt, '0.5.1'));
  await page.openAgent('w1');
  assert.doesNotMatch(page.side(), /id="ask-always"/, 'an older mod: Allow and Deny only');
  page.push(snapWith(prompt));
  assert.match(page.side(), /id="ask-allow"[\s\S]*id="ask-always"[^>]*>Always allow…<\/button>[\s\S]*id="ask-deny"/);
  await page.clickButton('ask-always', { agent: 'w1', tool: 'toolu_P1' });
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/permit', body: { agentId: 'w1', toolUseId: 'toolu_P1', decision: 'always' } });
  page.push(snapWith({ kind: 'always', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'npm test', expiresAt: Date.now() + 8_000,
    options: [{ option: 0, label: 'Always allow Bash(npm test:*) in this project (just you)' }, { option: 3, label: 'Accept edits for this session' }] }));
  const card = page.side();
  assert.match(card, /Always allow[\s\S]*npm test[\s\S]*Claude Code's options/);
  assert.match(card, /data-always-pick="0"[^>]*>Always allow Bash\(npm test:\*\) in this project \(just you\)<\/button>[\s\S]*data-always-pick="3"[^>]*>Accept edits for this session<\/button>/);
  assert.match(card, /data-until=/, 'with its countdown');
  await page.clickButton('always-pick', { agent: 'w1', tool: 'toolu_P1', alwaysPick: '3' });
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/always', body: { agentId: 'w1', toolUseId: 'toolu_P1', option: 3 } });
  await page.clickButton('always-cancel', { agent: 'w1', tool: 'toolu_P1', alwaysPick: 'cancel' });
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/always', body: { agentId: 'w1', toolUseId: 'toolu_P1', option: null } });
});

// The ⚙ Claude Code dialog: plugins and skills, MCP servers, permission rules.
const SETUP = {
  '/api/claude/plugins': { skills: [{ name: 'mine', description: 'My skill', tokens: 800 }], plugins: [
    { id: 'beta@m', name: 'beta', marketplace: 'm', version: '2.0.0', enabled: false, managed: true, details: { description: 'Beta.', alwaysOn: 300, inventory: { skills: ['b1'], agents: [], hooks: [], mcpServers: [], lspServers: [] }, components: [] } },
    { id: 'alpha@m', name: 'alpha', marketplace: 'm', version: '1.0.0', enabled: true, managed: true, details: { description: 'Alpha things.', alwaysOn: 1200, inventory: { skills: ['one', 'two'], agents: [], hooks: ['SessionStart'], mcpServers: ['extra'], lspServers: [] }, components: [{ name: 'one', alwaysOn: 70, onInvoke: 6300 }, { name: 'two', alwaysOn: 50, onInvoke: 900 }] } },
    { id: 'agent-tracker@inline', name: 'agent-tracker', marketplace: 'inline', version: '0.6.1', enabled: true, managed: false, details: null },
  ] },
  '/api/claude/mcp': { at: Date.now(), projects: [{ project: '/Users/me/proj', names: ['local1'] }], servers: [
    { name: 'magic', where: 'npx @21st-dev/magic', status: 'failed', statusText: 'Failed to connect', detail: 'Not authenticated', group: 'yours' },
    { name: 'plan', where: 'plan.example.com', status: 'auth', statusText: 'Needs authentication', detail: '', group: 'yours' },
    { name: 'claude.ai Gmail', where: 'gmail.example.com', status: 'connected', statusText: 'Connected', detail: '', group: 'connector' },
    { name: 'plugin:alpha:extra', where: 'extra.example.com', status: 'auth', statusText: 'Needs authentication', detail: '', group: 'plugin', plugin: 'alpha', server: 'extra' },
  ] },
  '/api/claude/mcp?fresh=1': { at: Date.now(), projects: [], servers: [] },
  '/api/claude/rules': { files: [{ path: '/Users/me/.claude/settings.json', label: 'You, everywhere', allow: ['Bash(npm test:*)'], ask: [], deny: ['Bash(rm:*)'], additionalDirectories: ['/Users/me/data'] }] },
  '/api/actions/plugin': { ok: true, text: 'Disabled alpha@m' },
  '/api/actions/reload': { ok: true, sessions: 2, older: 1 },
};

test('⚙ Claude Code opens on Plugins & skills: each plugin with what it costs, the total for those on, and your own skills', async () => {
  const page = loadPage({ replies: SETUP });
  await page.clickButton('setup-open', {});
  await page.settle();
  assert.equal(page.el('setup').open, true);
  assert.ok(page.gets.find(g => g.path === '/api/claude/plugins')?.token, 'with the token');
  const body = page.el('setup-body').innerHTML;
  assert.match(body, /<b>3 plugins<\/b>, 2 on: together they add <b>~1,200 tokens<\/b> to every session/);
  assert.match(body, /data-plugin-row="alpha@m"[\s\S]*?2 skills · 1 hook · 1 MCP server[\s\S]*?~1,200 tok[\s\S]*?data-plugin-row="beta@m"/, 'the costliest first');
  assert.match(body, /class="setup-row off" data-plugin-row="beta@m"/, 'one that is off looks it');
  assert.match(body, /data-plugin-op="disable" data-plugin="alpha@m"[^>]*>Turn off<\/button>[\s\S]*data-plugin-op="enable" data-plugin="beta@m"[^>]*>Turn on</);
  assert.doesNotMatch(body, /data-plugin="agent-tracker@inline"/, 'one loaded from a folder is managed there');
  assert.match(body, /Your own skills[\s\S]*mine[\s\S]*My skill[\s\S]*~800 tok when used/);
  await page.clickButton('more', { pluginMore: 'alpha@m' });
  assert.match(page.el('setup-body').innerHTML, /Alpha things\.[\s\S]*one[\s\S]*~70[\s\S]*~6,300[\s\S]*MCP servers:<\/span> extra[\s\S]*Hooks:<\/span> SessionStart/);
});

test('turning a plugin off, uninstalling one (after asking), and reloading running sessions', async () => {
  const page = loadPage({ replies: SETUP });
  await page.clickButton('setup-open', {});
  await page.settle();
  await page.clickButton('off', { pluginOp: 'disable', plugin: 'alpha@m' });
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/plugin', body: { id: 'alpha@m', op: 'disable' } });
  assert.match(page.el('setup-note').innerHTML, /Disabled alpha@m[\s\S]*Running sessions[\s\S]*data-reload-sessions/);
  const uninstalling = page.clickButton('uninstall', { pluginOp: 'uninstall', plugin: 'beta@m' });
  await page.settle();
  assert.match(page.el('confirm-text').textContent, /Uninstall beta\?/);
  assert.equal(page.posts.filter(p => p.body.op === 'uninstall').length, 0, 'nothing until you confirm');
  await page.clickButton('confirm-yes', { confirm: 'yes' });
  await uninstalling;
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/plugin', body: { id: 'beta@m', op: 'uninstall' } });
  await page.clickButton('reload', { reloadSessions: '' });
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/reload', body: {} });
  assert.match(page.el('setup-note').innerHTML, /Reloading plugins in 2 sessions; 1 on an older tracker mod/);
});

test('the MCP servers tab: yours, claude.ai connectors, per plugin and per project, each with how it is', async () => {
  const page = loadPage({ replies: SETUP });
  await page.clickButton('setup-open', {});
  await page.settle();
  const loading = page.clickButton('mcp-tab', { setupTab: 'mcp' });
  assert.match(page.el('setup-body').innerHTML, /class="spinner"[\s\S]*Checking each server/);
  await loading;
  await page.settle();
  const body = page.el('setup-body').innerHTML;
  assert.match(body, /4 servers: 1 connected, 2 need sign-in, 1 failed/);
  assert.match(body, /Yours[\s\S]*magic[\s\S]*Not authenticated[\s\S]*✗ Failed[\s\S]*plan[\s\S]*Needs sign-in[\s\S]*data-mcp-login="plan"/);
  assert.match(body, /claude\.ai connectors[\s\S]*claude\.ai Gmail[\s\S]*Connected/);
  assert.match(body, /From plugins[\s\S]*alpha[\s\S]*1 server · 1 needs sign-in/);
  assert.match(body, /Per project[\s\S]*~\/proj[\s\S]*local1[\s\S]*data-mcp-remove="local1" data-project="\/Users\/me\/proj"/);
  assert.doesNotMatch(body, /data-mcp-remove="plugin:alpha:extra"/, "a plugin's server is not removed here");
  await page.clickButton('login', { mcpLogin: 'plan' });
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/mcp', body: { name: 'plan', op: 'login' } });
  const removing = page.clickButton('remove', { mcpRemove: 'local1', project: '/Users/me/proj' });
  await page.settle();
  await page.clickButton('confirm-yes', { confirm: 'yes' });
  await removing;
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/mcp', body: { name: 'local1', op: 'remove', project: '/Users/me/proj' } });
  const odd = loadPage({ replies: { ...SETUP, '/api/claude/mcp': { ok: true } } });
  await odd.clickButton('setup-open', {});
  await odd.settle();
  await odd.clickButton('mcp-tab', { setupTab: 'mcp' });
  await odd.settle();
  assert.match(odd.el('setup-body').innerHTML, /sent something unexpected/, 'an odd answer is said, not a crash');
  await page.clickButton('check', { mcpCheck: '' });
  assert.ok(page.gets.some(g => g.path === '/api/claude/mcp?fresh=1'), 'Check again asks for a fresh check');
});

test('the permission rules tab lists each file\'s rules, and removes one after asking', async () => {
  const page = loadPage({ replies: SETUP });
  await page.clickButton('setup-open', {});
  await page.settle();
  await page.clickButton('rules-tab', { setupTab: 'rules' });
  await page.settle();
  const body = page.el('setup-body').innerHTML;
  assert.match(body, /You, everywhere[\s\S]*Allowed[\s\S]*Bash\(npm test:\*\)[\s\S]*Denied[\s\S]*Bash\(rm:\*\)[\s\S]*Extra folders[\s\S]*\/Users\/me\/data/);
  const removing = page.clickButton('rm', { ruleRemove: '', path: '/Users/me/.claude/settings.json', list: 'deny', value: 'Bash(rm:*)' });
  await page.settle();
  assert.match(page.el('confirm-text').textContent, /Remove Bash\(rm:\*\) from Denied/);
  await page.clickButton('confirm-yes', { confirm: 'yes' });
  await removing;
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/rule', body: { path: '/Users/me/.claude/settings.json', list: 'deny', value: 'Bash(rm:*)' } });
});

// Subagents: a card each, what it is doing now, expanded live; ⤢ Read for its whole transcript.
const withHelpers = (over = {}) => richAgent({ mod: { version: '0.6.1', live: true }, ...over, children: [
  { id: 'toolu_S1', kind: 'subagent', agentType: 'Explore', label: 'Find every caller', state: 'running', startedAt: Date.now() - 151_000, steps: 14, lastSaid: 'Two callers so far.', lastAt: Date.now() - 2000,
    now: { tool: 'Grep', summary: 'createOrder in src/', startedAt: Date.now() - 12_000 } },
  { id: 'toolu_S2', kind: 'subagent', agentType: 'code-reviewer', label: 'Review the change', state: 'done', startedAt: Date.now() - 600_000, endedAt: Date.now() - 358_000, steps: 31, lastSaid: 'No blocking issues.', result: 'No blocking issues.', lastAt: Date.now() - 358_000 },
  { id: 'toolu_J1', kind: 'bgjob', label: 'npm run dev', state: 'running', startedAt: Date.now() - 60_000 },
] });

test('subagents have a tab of their own, saying how many and whether one is at work; the main view keeps to the conversation', async () => {
  const page = loadPage();
  page.push(richSnapshot([withHelpers()]));
  assert.doesNotMatch(page.side(), /sub-card/, 'not in the main view');
  assert.match(page.tabs(), /data-tab="@subagents"[^>]*>Subagents <span class="tab-n">2<\/span><span class="pulse"><\/span><\/button>/, 'how many, and a pulse while one runs');
  await page.clickButton('subs-tab', { tab: '@subagents' });
  const tab = page.side();
  assert.match(page.tabs(), /class="tab on"><button type="button" data-tab="@subagents"/);
  assert.match(tab, /class="sub-card running"[\s\S]*?<b>Explore<\/b>[\s\S]*?Find every caller[\s\S]*?running · <span data-lasted="\d+">[^<]*<\/span> · 14 steps[\s\S]*?🔧 <b>Grep<\/b> createOrder in src\/[\s\S]*?“Two callers so far\.”/);
  assert.match(tab, /class="sub-card done"[\s\S]*?<b>code-reviewer<\/b>[\s\S]*?Review the change[\s\S]*?done in 4m 2s · 31 steps[\s\S]*?Result: “No blocking issues\.”/);
  assert.match(tab, /data-convo="r1:toolu_S1"[^>]*>⤢ Read<\/button>/, 'its whole transcript, in the conversation dialog');
  assert.doesNotMatch(tab, /npm run dev/, 'background jobs stay with the activity');
  assert.doesNotMatch(tab, /id="msg-text"|>Conversation</, 'the tab is the subagents alone');
  const none = loadPage();
  none.push(richSnapshot([richAgent()]));
  assert.doesNotMatch(none.tabs(), /@subagents/, 'no subagents, no tab');
});

test("a subagent's card opens to its prompt, its steps (followed while it works) and its result", async () => {
  const S1 = '/api/agent/r1%3Atoolu_S1/subagent';
  const page = loadPage({ replies: { [S1]: { prompt: 'Find every caller of createOrder.\nList them by file.', result: null, feed: [{ at: Date.now() - 3000, kind: 'tool', tool: 'Grep', text: 'createOrder', ok: true }] } } });
  page.push(richSnapshot([withHelpers()]));
  await page.clickButton('subs-tab', { tab: '@subagents' });
  await page.clickButton('open-sub', { child: 'toolu_S1' });
  await page.settle();
  const get = page.gets.filter(g => g.path === S1);
  assert.equal(get.length, 1);
  assert.ok(get[0].token, 'with the token');
  assert.match(page.side(), /class="sub-prompt"[\s\S]*Find every caller of createOrder\.\nList them by file\.[\s\S]*Grep[\s\S]*createOrder/);
  page.push(richSnapshot([withHelpers()])); // nothing new from it
  await page.settle();
  assert.equal(page.gets.filter(g => g.path === S1).length, 1);
  const later = withHelpers();
  later.children[0].lastAt = Date.now() + 10_000; // it did something
  const realNow = Date.now;
  page.ctx.Date.now = () => realNow() + 5000; // and the last read is more than 3 s old
  page.push(richSnapshot([later]));
  await page.settle();
  page.ctx.Date.now = realNow;
  assert.equal(page.gets.filter(g => g.path === S1).length, 2, 'it is read again: followed while it works');
});

test('⤢ Read on a subagent opens its own transcript in the conversation dialog, named for it, with no message box', async () => {
  const page = loadPage({ replies: { '/api/agent/r1%3Atoolu_S1/conversation': { total: 1, from: 0, items: [{ at: Date.now() - 9000, kind: 'prompt', text: 'Find every caller', body: 'Find every caller' }] } } });
  page.push(richSnapshot([withHelpers()]));
  await page.clickButton('read-sub', { convo: 'r1:toolu_S1' });
  await page.settle();
  assert.equal(page.el('convo').open, true);
  assert.match(page.el('convo-title').textContent, /^Explore · Find every caller · busy-one's subagent$/);
  assert.match(page.el('convo-body').innerHTML, /Find every caller/);
  assert.equal(page.el('convo-compose').innerHTML, '', 'a subagent takes no messages');
});

test('the farm sidebar has a Subagents tab, with how many on it; its Agent tab keeps to the conversation', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' } });
  page.push(richSnapshot([withHelpers()]));
  assert.doesNotMatch(page.el('farm-agent').innerHTML, /sub-card/);
  assert.match(page.el('tab-subagents').innerHTML, /^Subagents <span class="tab-n">2<\/span><span class="pulse"><\/span>$/);
  await page.clickButton('tab-subagents', { farmTab: 'subagents' });
  assert.equal(page.stored['tracker-farm-tab'], 'subagents');
  assert.match(page.el('farm-subagents').innerHTML, /class="sub-card running"[\s\S]*Find every caller/);
});

test("the farm's own buttons include ⚙ Claude Code, opening the same dialog", async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm' }, replies: SETUP });
  page.push(richSnapshot([richAgent()]));
  await f.nav('setup');
  await page.settle();
  assert.equal(page.el('setup').open, true);
  assert.match(page.el('setup-body').innerHTML, /together they add/);
});

test('in the farm, a file opens in a dialog over it, and the farm stays: the same reader, or a tab if you ask', async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm' }, files: { '/w/docs/spec.md': '# Spec\n\nThe plan.', '/w/src/app.ts': 'const a = 1;' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.6.1', live: true } })]));
  await f.openDoc('r1', '/w/docs/spec.md'); // a noticeboard in a field close-up
  await page.settle();
  assert.equal(page.el('main').dataset.view, 'farm', 'still the farm');
  assert.equal(page.el('file-dlg').open, true);
  assert.match(page.el('file-dlg-body').innerHTML, /📄 spec\.md[\s\S]*id="reader-tab"[^>]*>Open in a tab<[\s\S]*id="reader-text"/, 'the reader, with Quote and the reply box');
  assert.match(page.el('reader-body').innerHTML, /<h1[^>]*>Spec<\/h1>[\s\S]*The plan\./);
  assert.ok(page.gets.find(g => g.path === '/api/agent/r1/file?path=%2Fw%2Fdocs%2Fspec.md')?.token, 'read with the token');
  page.ctx.closeFileDialog();
  assert.equal(page.el('file-dlg').open, false);
  await page.ctx.openFile('r1', '/w/src/app.ts'); // from the Files or Activity tab
  await page.settle();
  assert.equal(page.el('file-dlg').open, true);
  assert.match(page.el('reader-body').innerHTML, /data-n="1">const a = 1;/);
  await page.clickButton('reader-tab', {});
  await page.settle();
  assert.equal(page.el('file-dlg').open, false);
  assert.equal(page.el('main').dataset.view, 'list', 'Open in a tab: the list view');
  assert.match(page.tabs(), /class="tab on"><button type="button" data-tab="\/w\/src\/app\.ts"/);
});

/* ---------- files that are not text: pictures, players, PDFs, pages, documents, sheets ---------- */

const linkOf = (path, folder = false) => `/api/agent/r1/ticket?path=${encodeURIComponent(path)}${folder ? '&folder=1' : ''}`;
const officeOf = path => `/api/agent/r1/office?path=${encodeURIComponent(path)}`;

test('each kind of file is shown as itself, matching what the collector serves', async () => {
  const { VIEWS } = await import('../sources/previews.mjs');
  const page = loadPage();
  for (const [view, exts] of Object.entries(VIEWS)) for (const ext of exts) assert.equal(page.ctx.viewKind(`/w/x.${ext.toUpperCase()}`), view, ext);
  assert.deepEqual(['/w/app.tsx', '/w/notes.md', '@summary', '/w/Makefile'].map(p => page.ctx.viewKind(p)), ['text', 'text', 'text', 'text']);
});

test('a picture, a PDF, a video and a song open through a short-lived link: the picture on a checkerboard with its size, the rest in players', async () => {
  const replies = {
    [linkOf('/w/shot.png')]: { url: '/raw/t1/shot.png', type: 'image/png', size: 2048 },
    [linkOf('/w/r.pdf')]: { url: '/raw/t2/r.pdf', type: 'application/pdf', size: 90_000 },
    [linkOf('/w/demo.mp4')]: { url: '/raw/t3/demo.mp4', type: 'video/mp4', size: 5_000_000 },
    [linkOf('/w/song.mp3')]: { url: '/raw/t4/song.mp3', type: 'audio/mpeg', size: 3_000_000 },
  };
  const page = loadPage({ replies });
  page.push(richSnapshot([richAgent({ mod: { version: '0.6.1', live: true } })]));
  await page.ctx.openFile('r1', '/w/shot.png');
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /<img[^>]*class="checker"[^>]*src="\/raw\/t1\/shot\.png"/);
  assert.match(page.el('reader-body').innerHTML, /id="reader-media-meta"[^>]*>2 KB</);
  assert.match(page.tabs(), /🖼 shot\.png/);
  assert.ok(page.gets.find(g => g.path === linkOf('/w/shot.png'))?.token, 'the link is asked for with the token');
  assert.match(page.side(), /id="reader-text"/, 'the reply box stays');
  assert.doesNotMatch(page.side(), /id="reader-quote"/, 'nothing to quote in a picture');
  assert.match(page.side(), /data-reader-reveal[^>]*>Show in Finder/);

  await page.ctx.openFile('r1', '/w/r.pdf');
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /<iframe class="media-frame" src="\/raw\/t2\/r\.pdf" title="r\.pdf"><\/iframe>/, "the browser's PDF viewer");
  await page.ctx.openFile('r1', '/w/demo.mp4');
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /<video[^>]*controls[^>]*src="\/raw\/t3\/demo\.mp4"/);
  await page.ctx.openFile('r1', '/w/song.mp3');
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /<audio[^>]*controls[^>]*src="\/raw\/t4\/song\.mp3"/);
});

test('a page shows as itself in a sandbox, loading what sits beside it; Source shows its code, to quote', async () => {
  const replies = { [linkOf('/w/site/index.html', true)]: { url: '/raw/t5/site/index.html', type: 'text/html; charset=utf-8', size: 300 } };
  const page = loadPage({ replies, files: { '/w/site/index.html': '<h1>Hi</h1>\n<script src="app.js"></script>' } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.6.1', live: true } })]));
  await page.ctx.openFile('r1', '/w/site/index.html');
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /<iframe class="media-frame page" sandbox="allow-scripts" src="\/raw\/t5\/site\/index\.html"/, 'its scripts run, never as the dashboard');
  assert.match(page.side(), /data-reader-mode="preview" aria-pressed="true"/);
  assert.doesNotMatch(page.side(), /id="reader-quote"/);
  await page.clickButton('mode-btn', { readerMode: 'source' });
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /data-n="1">&lt;h1&gt;Hi&lt;\/h1&gt;/);
  assert.match(page.side(), /data-reader-mode="source" aria-pressed="true"[\s\S]*id="reader-quote"/);
  await page.ctx.openFile('r1', '/w/site/index.html'); // the same file again: still its source
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /data-n="1">/);
});

test('a Word document shows as a page, sealed off, or as its words to quote', async () => {
  const replies = { [officeOf('/w/brief.docx')]: { view: 'word', html: '<p><b>Bold</b> "quoted"</p><script>alert(1)</script>', text: 'Bold "quoted"\nSecond <para>' } };
  const page = loadPage({ replies });
  page.push(richSnapshot([richAgent({ mod: { version: '0.6.1', live: true } })]));
  await page.ctx.openFile('r1', '/w/brief.docx');
  await page.settle();
  const body = page.el('reader-body').innerHTML;
  assert.match(body, /<iframe class="media-frame page" sandbox="" srcdoc="&lt;p&gt;&lt;b&gt;Bold&lt;\/b&gt; &quot;quoted&quot;/, 'no scripts in the page');
  assert.match(page.tabs(), /📝 brief\.docx/);
  await page.clickButton('mode-btn', { readerMode: 'text' });
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /<div class="doc-text">Bold &quot;quoted&quot;\nSecond &lt;para&gt;<\/div>/);
  assert.match(page.side(), /id="reader-quote"/);
});

test('a spreadsheet shows as tables with column letters and row numbers, a tab for each sheet, and says when it is cut short', async () => {
  const replies = { [officeOf('/w/budget.xlsx')]: { view: 'sheet', sheets: [
    { name: 'Budget & Plan', rows: [['Item', 'Cost'], ['Rent <office>', '1200']], truncated: false },
    { name: 'Notes', rows: [['', 'only B']], truncated: true },
  ] } };
  const page = loadPage({ replies });
  page.push(richSnapshot([richAgent({ mod: { version: '0.6.1', live: true } })]));
  await page.ctx.openFile('r1', '/w/budget.xlsx');
  await page.settle();
  let body = page.el('reader-body').innerHTML;
  assert.match(body, /data-sheet="0" aria-pressed="true">Budget &amp; Plan<[\s\S]*data-sheet="1" aria-pressed="false">Notes</);
  assert.match(body, /<th><\/th><th>A<\/th><th>B<\/th>/);
  assert.match(body, /<th>2<\/th><td>Rent &lt;office&gt;<\/td><td class="num">1200<\/td>/);
  assert.match(page.side(), /id="reader-quote"/, 'cells are text to quote');
  await page.clickButton('sheet-btn', { sheet: '1' });
  body = page.el('reader-body').innerHTML;
  assert.match(body, /<th>1<\/th><td><\/td><td>only B<\/td>/);
  assert.match(body, /first 2,000 rows and 100 columns/);
  assert.equal(page.gets.filter(g => g.path === officeOf('/w/budget.xlsx')).length, 1, 'another sheet without asking again');
});

test('slides and other documents show a picture of the first page; what cannot be shown says so; Show in Finder reveals it', async () => {
  const replies = {
    [officeOf('/w/deck.pptx')]: { view: 'picture', picture: 'data:image/png;base64,AAAA' },
    '/api/actions/reveal': { ok: true },
  };
  const page = loadPage({ replies });
  page.push(richSnapshot([richAgent({ mod: { version: '0.6.1', live: true } })]));
  await page.ctx.openFile('r1', '/w/deck.pptx');
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /<img class="page-pic" src="data:image\/png;base64,AAAA" alt="The first page of deck\.pptx">[\s\S]*Quick Look/);
  await page.ctx.openFile('r1', '/w/build.zip');
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /\.zip file can't be shown here[\s\S]*data-reader-reveal/);
  assert.equal(page.gets.filter(g => /build\.zip/.test(g.path)).length, 0, 'nothing is fetched for it');
  await page.clickButton('reveal-btn', { readerReveal: '' });
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/reveal', body: { agentId: 'r1', path: '/w/build.zip' } });
  assert.match(page.el('reader-status').textContent, /Finder/);
});

test("a picture's link that could not be made says why", async () => {
  const page = loadPage({ replies: { [linkOf('/w/.env.png')]: { error: 'That file looks like it holds secrets, so it is not shown.' } } });
  page.push(richSnapshot([richAgent({ mod: { version: '0.6.1', live: true } })]));
  await page.ctx.openFile('r1', '/w/.env.png');
  await page.settle();
  assert.match(page.el('reader-body').innerHTML, /holds secrets/);
});

/* ---------- a new session in any folder ---------- */

const dirsReply = (over = {}) => ({ home: '/Users/me', path: '/Users/me/co', exists: false, isFile: false, dir: '/Users/me', up: null, dirs: ['code'], truncated: false, ...over });
const dirsOf = typed => `/api/dirs?path=${encodeURIComponent(typed)}`;

test('a new session in any folder: type or browse, and the subfolders are suggested; one picked lists its own', async () => {
  const replies = {
    [dirsOf('~/')]: dirsReply({ path: '/Users/me', exists: true, dirs: ['code', 'Docs'] }),
    [dirsOf('~/co')]: dirsReply(),
    [dirsOf('~/code/')]: dirsReply({ path: '/Users/me/code', exists: true, dir: '/Users/me/code', up: '/Users/me', dirs: ['api', 'app'] }),
  };
  const page = loadPage({ replies: { ...replies, '/api/sessions': { terminal: 'Terminal', projects: [], sessions: [] } } });
  await page.ctx.openSessions();
  await page.settle();
  assert.equal(page.el('sess-dir').value, '');
  assert.equal(page.el('sess-dir-new').disabled, true, 'nothing to start in yet');
  page.edit('input', { id: 'sess-dir', value: '~/' });
  await page.settle();
  assert.ok(page.gets.find(g => g.path === dirsOf('~/'))?.token, 'listed with the token');
  assert.match(page.el('sess-dir-list').innerHTML, /data-dir-go="~\/code\/"[^>]*>[\s\S]*code[\s\S]*data-dir-go="~\/Docs\/"/);
  assert.equal(page.el('sess-dir-list').hidden, false);
  page.edit('input', { id: 'sess-dir', value: '~/co' });
  await page.settle();
  assert.match(page.el('sess-dir-list').innerHTML, /data-dir-go="~\/code\/"/);
  assert.match(page.el('sess-dir-note').innerHTML, /~\/co doesn't exist yet[\s\S]*data-dir-make/);
  await page.clickButton('row', { dirGo: '~/code/' });
  await page.settle();
  assert.equal(page.el('sess-dir').value, '~/code/');
  assert.match(page.el('sess-dir-list').innerHTML, /data-dir-go="~\/"[^>]*>[\s\S]*\.\.[\s\S]*data-dir-go="~\/code\/api\/"/, '.. goes up');
  assert.equal(page.el('sess-dir-new').disabled, false);
  assert.match(page.el('sess-dir-note').textContent, /＋ New starts Claude Code in ~\/code/);
});

test("Browse opens Finder's own folder window, and the folder picked fills the field; a cancel changes nothing", async () => {
  const replies = {
    '/api/actions/choose-folder': { ok: true, path: '/Users/me/code', home: '/Users/me' },
    [dirsOf('~/code/')]: dirsReply({ path: '/Users/me/code', exists: true, dir: '/Users/me/code', up: '/Users/me', dirs: ['api'] }),
    '/api/sessions': { terminal: 'Terminal', projects: [], sessions: [] },
  };
  const page = loadPage({ replies });
  await page.ctx.openSessions();
  await page.clickButton('sess-dir-browse', {});
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/choose-folder', body: { prompt: 'Start a new Claude Code session in:' } });
  assert.equal(page.el('sess-dir').value, '~/code/');
  assert.equal(page.el('sess-dir-new').disabled, false);
  replies['/api/actions/choose-folder'] = { ok: false, cancelled: true };
  await page.clickButton('sess-dir-browse', {});
  await page.settle();
  assert.deepEqual(page.posts.at(-1).body, { start: '/Users/me/code', prompt: 'Start a new Claude Code session in:' }, 'it opens where the field is');
  assert.equal(page.el('sess-dir').value, '~/code/');
  replies['/api/actions/choose-folder'] = { ok: false, error: 'macOS did not let the tracker open the folder window.' };
  await page.clickButton('sess-dir-browse', {});
  await page.settle();
  assert.match(page.el('sess-dir-note').textContent, /did not let the tracker/);
});

test('Tab completes a folder name as a terminal does', async () => {
  const replies = {
    [dirsOf('~/co')]: dirsReply(),
    [dirsOf('~/code/')]: dirsReply({ path: '/Users/me/code', exists: true, dir: '/Users/me/code', up: '/Users/me', dirs: ['api', 'app'] }),
    [dirsOf('~/code/a')]: dirsReply({ path: '/Users/me/code/a', dir: '/Users/me/code', up: '/Users/me', dirs: ['api', 'app'] }),
    [dirsOf('~/code/ap')]: dirsReply({ path: '/Users/me/code/ap', dir: '/Users/me/code', up: '/Users/me', dirs: ['api', 'app'] }),
  };
  const page = loadPage({ replies: { ...replies, '/api/sessions': { terminal: 'Terminal', projects: [], sessions: [] } } });
  await page.ctx.openSessions();
  page.edit('input', { id: 'sess-dir', value: '~/co' });
  await page.settle();
  assert.equal(await page.ctx.completeDir(), true);
  await page.settle();
  assert.equal(page.el('sess-dir').value, '~/code/', 'one match: the whole name and a slash');
  page.edit('input', { id: 'sess-dir', value: '~/code/a' });
  await page.settle();
  assert.equal(await page.ctx.completeDir(), true);
  assert.equal(page.el('sess-dir').value, '~/code/ap', 'several: as far as they agree');
  await page.settle();
  assert.equal(await page.ctx.completeDir(), false, 'nothing more to complete: Tab moves on');
});

test('＋ New starts a session in the folder typed, in the mode, model and effort picked; a missing one is made first, after asking', async () => {
  const replies = {
    [dirsOf('~/code/new app')]: dirsReply({ path: '/Users/me/code/new app', dir: '/Users/me/code', up: '/Users/me', dirs: [] }),
    '/api/actions/mkdir': { ok: true, path: '/Users/me/code/new app' },
    '/api/actions/start': { ok: true, terminal: 'Terminal' },
    '/api/sessions': { terminal: 'Terminal', projects: [], sessions: [] },
  };
  const page = loadPage({ replies });
  await page.ctx.openSessions();
  page.el('sess-mode').value = 'plan';
  page.el('sess-model').value = 'sonnet';
  page.edit('input', { id: 'sess-dir', value: '~/code/new app' });
  await page.settle();
  assert.equal(page.el('sess-dir-new').disabled, true);
  const asked = page.clickButton('make', { dirMake: '' });
  await page.settle();
  assert.match(page.el('confirm-text').textContent, /Create the folder ~\/code\/new app\?/);
  replies[dirsOf('~/code/new app')] = dirsReply({ path: '/Users/me/code/new app', exists: true, dir: '/Users/me/code', up: '/Users/me', dirs: [] });
  page.ctx.settleConfirm(true);
  await asked;
  await page.settle();
  assert.deepEqual(page.posts.find(p => p.path === '/api/actions/mkdir')?.body, { path: '/Users/me/code/new app' });
  assert.equal(page.el('sess-dir-new').disabled, false, 'made: it can start there now');
  await page.clickButton('sess-dir-new', {});
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/start', body: { cwd: '/Users/me/code/new app', mode: 'plan', model: 'sonnet' } });
  assert.equal(page.el('sessions').open, false);
  assert.match(page.el('notice').textContent, /trust/, 'Claude Code asks there whether to trust a new folder');
});

test('a folder outside your home folder and drives says so', async () => {
  const page = loadPage({ replies: { [dirsOf('/etc')]: { error: 'Only a folder in your home folder or a drive (/Volumes) can be used.' }, '/api/sessions': { terminal: 'Terminal', projects: [], sessions: [] } } });
  await page.ctx.openSessions();
  page.edit('input', { id: 'sess-dir', value: '/etc' });
  await page.settle();
  assert.match(page.el('sess-dir-note').textContent, /home folder or a drive/);
  assert.equal(page.el('sess-dir-list').hidden, true);
  assert.equal(page.el('sess-dir-new').disabled, true);
});

test('📁 Folder attaches a folder picked in Finder: its path goes with the message, nothing is uploaded', async () => {
  const replies = { '/api/actions/choose-folder': { ok: true, path: '/w/site', home: '/Users/me' }, '/api/actions/message': { ok: true } };
  const page = loadPage({ replies });
  page.push(richSnapshot([richAgent({ mod: { version: '0.6.2', live: true }, state: 'yourTurn' })]));
  assert.match(page.side(), /id="msg-folder"[^>]*>📁 Folder</);
  await page.clickButton('msg-folder', { agent: 'r1' });
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/choose-folder', body: { start: '/w', prompt: 'Attach a folder to your message to busy-one:' } });
  assert.match(page.side(), /class="thumb thumb-file thumb-folder" data-tip="\/w\/site"><span class="thumb-ext">folder<\/span><span class="thumb-name">site<\/span>/);
  page.edit('input', { dataset: { msgAgent: 'r1' }, value: 'Look here' });
  await page.clickButton('msg-send', { agent: 'r1' });
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/message', body: { agentId: 'r1', text: 'Look here', folders: ['/w/site'] } });
  assert.match(page.side(), /Sent to busy-one with 1 folder/);
  assert.doesNotMatch(page.side(), /thumb-folder/, 'sent: the box is empty again');
});

test('the commands it runs now: each with its time, CPU and memory; Output follows a background one; ■ Stop asks first, then stops it', async () => {
  const shells = [
    { pid: 5001, command: 'npm run dev', about: 'Start the dev server', startedAt: Date.now() - 60_000, cpu: 25, rssMb: 101, background: true, toolUseId: 'bg1', output: true },
    { pid: 5003, command: 'npm test', startedAt: Date.now() - 5000, cpu: 0, rssMb: 1, background: false, toolUseId: 'fg1', output: false },
  ];
  const children = [{ id: 'bg1', kind: 'bgjob', label: 'Start the dev server', state: 'running', startedAt: Date.now() - 60_000 }, { id: 'bg0', kind: 'bgjob', label: 'old build', state: 'done', startedAt: 1 }];
  const replies = { '/api/agent/r1/shell-output?pid=5001': { text: 'ready on :3000\n', size: 15, truncated: false }, '/api/actions/stop-shell': { ok: true } };
  const page = loadPage({ replies });
  page.push(richSnapshot([richAgent({ shells, children })]));
  const side = page.side();
  assert.match(side, /Commands running[\s\S]*\$ npm run dev[\s\S]*background · [\s\S]*25% CPU · 101 MB[\s\S]*data-shell-output="5001"[\s\S]*data-shell-stop="5001"[\s\S]*\$ npm test[\s\S]*data-shell-stop="5003"/);
  assert.doesNotMatch(side, /data-shell-output="5003"/, 'a foreground command hands its output to the session when it ends');
  assert.match(side.slice(side.indexOf('Background jobs')), /old build/);
  assert.doesNotMatch(side.slice(side.indexOf('Background jobs')), /Start the dev server/, 'running, it is listed once: above, with Stop');
  await page.clickButton('out', { shellOutput: '5001', agent: 'r1' });
  await page.settle();
  assert.equal(page.el('shell-dlg').open, true);
  assert.match(page.el('shell-title').textContent, /npm run dev/);
  assert.equal(page.el('shell-out').textContent, 'ready on :3000\n');
  assert.ok(page.gets.find(g => g.path === '/api/agent/r1/shell-output?pid=5001')?.token, 'read with the token');
  const asked = page.clickButton('stop', { shellStop: '5003', agent: 'r1' });
  await page.settle();
  assert.match(page.el('confirm-text').textContent, /Stop “npm test”\?/);
  page.ctx.settleConfirm(true);
  await asked;
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/stop-shell', body: { agentId: 'r1', pid: 5003 } });
  assert.match(page.el('notice').textContent, /Stopped “npm test”/);
});

test("the farm's sidebar shows the commands running too", async () => {
  const f = fakeFarm();
  const page = loadPage({ farm: f.farm, stored: { 'tracker-view': 'farm', 'tracker-farm-side': 'open' } });
  page.push(richSnapshot([richAgent({ shells: [{ pid: 5003, command: 'npm test', startedAt: Date.now() - 5000, cpu: 0, rssMb: 1, background: false, output: false }] })]));
  await page.settle();
  assert.match(page.el('farm-agent').innerHTML, /Commands running[\s\S]*data-shell-stop="5003"/);
});

/* ---------- files an agent names in its replies ---------- */

test('a picture, a video or a document an agent names in its reply shows under it: a thumbnail or a chip, opening in the file dialog', async () => {
  const text = 'Saved the screenshot to `/w/shots/login.png` and a video at /w/demo.mov. The plan is in docs/plan.md, the code in src/app.ts; I also looked at /etc/secret.png.';
  const named = `/api/agent/r1/named?${['/w/shots/login.png', '/w/demo.mov', 'docs/plan.md', '/etc/secret.png'].map(p => `path=${encodeURIComponent(p)}`).join('&')}`;
  const replies = {
    [named]: { items: [
      { asked: '/w/shots/login.png', ok: true, kind: 'image', path: '/w/shots/login.png', url: '/raw/t1/login.png' },
      { asked: '/w/demo.mov', ok: true, kind: 'video', path: '/w/demo.mov' },
      { asked: 'docs/plan.md', ok: true, kind: 'markdown', path: '/w/docs/plan.md' },
      { asked: '/etc/secret.png', ok: false },
    ] },
    [linkOf('/w/shots/login.png')]: { url: '/raw/t2/login.png', type: 'image/png', size: 4096 },
    '/api/actions/message': { ok: true },
  };
  const page = loadPage({ replies });
  const snap = () => richSnapshot([richAgent({ state: 'yourTurn', mod: { version: '0.6.2', live: true }, feed: [{ at: Date.now() - 1000, kind: 'reply', text }] })]);
  page.push(snap());
  await page.settle();
  assert.ok(page.gets.find(g => g.path === named)?.token, 'checked with the collector, with the token: only what it may show');
  assert.doesNotMatch(page.gets.map(g => g.path).join(' '), /app\.ts/, 'code is not a file to show this way');
  page.push(snap());
  await page.settle();
  const strip = page.side();
  assert.match(strip, /<button type="button" class="named-pic" data-open-named="\/w\/shots\/login\.png" data-agent="r1"[^>]*><img src="\/raw\/t1\/login\.png" alt="login\.png" loading="lazy"><\/button>/);
  assert.match(strip, /data-open-named="\/w\/demo\.mov"[^>]*>🎬 demo\.mov</);
  assert.match(strip, /data-open-named="\/w\/docs\/plan\.md"[^>]*>📄 plan\.md</);
  assert.doesNotMatch(strip, /data-open-named="\/etc/, 'one it may not show stays plain text');
  assert.equal(page.gets.filter(g => g.path === named).length, 1, 'checked once');
  await page.clickButton('named', { openNamed: '/w/shots/login.png', agent: 'r1' });
  await page.settle();
  assert.equal(page.el('main').dataset.view, 'list');
  assert.equal(page.el('file-dlg').open, true, 'in a dialog, in the list view too');
  assert.match(page.el('reader-body').innerHTML, /<img[^>]*src="\/raw\/t2\/login\.png"/);
  page.push(snap()); // a snapshot while it is open keeps the dialog's reader
  await page.settle();
  page.edit('input', { id: 'reader-text', value: 'Crop the header off.' });
  await page.clickButton('reader-send', {});
  await page.settle();
  assert.deepEqual(page.posts.at(-1), { path: '/api/actions/message', body: { agentId: 'r1', text: 'About shots/login.png:\n\nCrop the header off.' } });
});

test('Documents lists the pictures, videos and PDFs it wrote or read too, each with its own icon', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ docs: [{ path: '/w/shots/login.png', wrote: false, at: Date.now() }, { path: '/w/report.pdf', wrote: true, at: Date.now() }, { path: '/w/spec.md', wrote: true, at: Date.now() }] })]));
  assert.match(page.side(), /🖼<\/span><span class="doc-name">login\.png[\s\S]*📕<\/span><span class="doc-name">report\.pdf[\s\S]*📄<\/span><span class="doc-name">spec\.md/);
});
