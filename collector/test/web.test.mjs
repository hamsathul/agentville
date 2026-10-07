// Runs the dashboard's inline script in a vm with a minimal DOM, to test its render scheduling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(fileURLToPath(new URL('../../web/index.html', import.meta.url)), 'utf8');
const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));

function loadPage() {
  const els = new Map();
  const el = () => ({ innerHTML: '', textContent: '', className: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, showModal() {}, querySelectorAll: () => [] });
  const docListeners = {};
  let sourceListener = null;
  let selectedText = '';
  const ctx = {
    document: {
      getElementById: id => (els.has(id) ? els.get(id) : els.set(id, el()).get(id)),
      querySelectorAll: () => [],
      addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); },
    },
    window: { getSelection: () => ({ isCollapsed: selectedText === '', toString: () => selectedText }) },
    EventSource: class { addEventListener(_type, fn) { sourceListener = fn; } },
    setInterval() {},
    setTimeout: fn => fn(),
    navigator: {},
    fetch: async () => ({}),
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

test('a waiting agent with a Remote Control link gets an Answer link in its row and drawer', () => {
  const page = loadPage();
  const snap = snapshot('x');
  snap.counts = { ...snap.counts, waiting: 2, working: 0 };
  snap.agents = [
    { ...snap.agents[0], id: 'w1', name: 'linked', state: 'waiting', stateReason: 'question pending', remoteUrl: 'https://claude.ai/code/session_01AbC' },
    { ...snap.agents[0], id: 'w2', name: 'unlinked', state: 'waiting', stateReason: 'question pending' },
  ];
  page.push(snap);
  const links = page.list().match(/href="https:\/\/claude\.ai\/code\/[^"]+"/g) ?? [];
  assert.deepEqual(links, ['href="https://claude.ai/code/session_01AbC"']);
  assert.match(page.ctx.drawerHtml(snap.agents[0]), /Answer in Claude app/);
  assert.doesNotMatch(page.ctx.drawerHtml(snap.agents[1]), /Answer in Claude app/);
});
