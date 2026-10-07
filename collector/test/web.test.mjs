// Runs the dashboard's inline script in a vm with a minimal DOM, to test its render scheduling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(fileURLToPath(new URL('../../web/index.html', import.meta.url)), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));

function loadPage({ stored = {}, storageThrows = false, files = {}, replies = {} } = {}) {
  const posts = [];
  let active = null;
  const els = new Map();
  const el = id => ({ id, title: '', innerHTML: '', textContent: '', value: '', className: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, querySelectorAll: () => [] });
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
    fetch: async (path, init) => {
      posts.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
      const doc = String(path).match(/^\/api\/agent\/[^/]+\/doc\?path=(.*)$/);
      if (doc) {
        const file = decodeURIComponent(doc[1]);
        return file in files
          ? { ok: true, status: 200, json: async () => ({ path: file, text: files[file], mtimeMs: 1, size: files[file].length }) }
          : { ok: false, status: 404, json: async () => ({ error: 'That file no longer exists.' }) };
      }
      return { ok: true, json: async () => replies[path] ?? { ok: true } };
    },
    console, Date, Math, JSON, String, Number, Object, Boolean, Map, Set, encodeURIComponent, decodeURIComponent,
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

test('the CPU panel states its headline as a share of the whole Mac', () => {
  const page = loadPage();
  page.push(richSnapshot([richAgent({ proc: { ...richAgent().proc, cpu: 200 } })]));
  const fleet = page.el('fleet').innerHTML;
  assert.match(fleet, /CPU used by agents<span class="pv">20% of this Mac</);
  assert.match(fleet, /200% of one core · 10 cores/);
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
  assert.ok(page.posts.some(p => p.path === '/api/agent/r1/doc?path=%2Fw%2Fdocs%2Fspec.md'));
  assert.equal(page.el('reader').open, true);
  assert.match(page.el('reader').innerHTML, /docs\/spec\.md/);
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
  assert.match(page.el('reader').innerHTML, /<textarea[^>]*id="reader-text"[^>]*disabled/);
  assert.match(page.el('reader').innerHTML, /isn't listening/);
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
