// Loads web/scene.js and web/worlds.js in a vm: the page's side of a world. The world's frame is a stand-in
// that records what the page posts to it; messages "from the frame" are handed to the page's listener.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = ['scene.js', 'worlds.js'].map(f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8')).join('\n;\n');
const NOW = Date.now();
const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the vm have another realm's prototypes

function page({ stored = {} } = {}) {
  const posted = [], calls = [], listeners = {}, fetches = [];
  const frame = { contentWindow: { postMessage: m => posted.push(JSON.parse(JSON.stringify(m))) }, setAttribute() {}, className: '', title: '', src: '' };
  const host = { replaceChildren() {} };
  const diary = { innerHTML: '' };
  const window = {
    addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener: t => { delete listeners[t]; },
    open: (url, target) => calls.push(['open', url, target]), matchMedia: () => ({ matches: false }),
  };
  const ctx = {
    window, console: { warn() {} }, document: { createElement: () => frame, hidden: false },
    addEventListener: window.addEventListener, removeEventListener: window.removeEventListener,
    setInterval: () => 1, clearInterval() {},
    localStorage: { getItem: k => stored[k] ?? null, setItem: (k, v) => { stored[k] = String(v); }, get length() { return Object.keys(stored).length; }, key: i => Object.keys(stored)[i] ?? null },
    fetch: async (url, init) => { fetches.push([url, init?.headers?.['x-tracker-token']]); return { ok: true, status: 200, json: async () => ({ memory: [{ path: '/Users/sam/.claude/projects/x/memory/a.md' }], files: [] }) }; },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const farm = window.TrackerFarm;
  farm.mount(host, {
    token: 'tok', diary, navState: () => ({ theme: 'dark', side: false, live: true }),
    onPickAgent: (id, o) => calls.push(['pick', id, o?.from ?? null]), onOpenDoc: (id, p) => calls.push(['doc', id, p]),
    onShowRepos: () => calls.push(['repos']), onStartSession: () => calls.push(['start']), onNav: w => calls.push(['nav', w]), onBell: on => calls.push(['bell', on]),
  });
  const from = data => listeners.message({ source: frame.contentWindow, data });
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { farm, posted, calls, from, diary, stored, fetches, settle, worlds: window.AgentvilleWorlds, listeners, frame };
}
const snap = { generatedAt: NOW, collisions: [], agents: [{ id: 'a1', name: 'cart-ui', kind: 'interactive', cwd: '/code/shop/web', state: 'working', feed: [], children: [], touching: [] }], repos: [{ path: '/code/shop/web', name: 'web', branch: 'main' }] };

test('the frame gets its start (prefs, settings), then only the newest scene and the selection, once it has loaded', () => {
  const p = page({ stored: { 'tracker-world:farm:zoom': '2' } });
  p.farm.update({ ...snap, generatedAt: 1 });
  p.farm.update({ ...snap, generatedAt: 2 });
  p.farm.select('a1');
  assert.deepEqual(p.posted, [], 'nothing before the frame has loaded');
  p.from({ type: 'loaded' });
  assert.deepEqual(p.posted.map(m => m.type), ['start', 'scene', 'select']);
  assert.equal(p.posted[0].world, 'farm');
  assert.equal(p.posted[0].prefs.zoom, '2');
  assert.deepEqual(p.posted[0].settings, { still: false, theme: 'dark', nav: { theme: 'dark', side: false, live: true }, bell: false });
  assert.equal(p.posted[1].scene.generatedAt, 2, 'the newest scene, not every one');
  assert.equal(p.posted[2].id, 'a1');
  p.farm.update({ ...snap, generatedAt: 3 });
  assert.equal(p.posted.at(-1).scene.generatedAt, 3);
});

test("the farm's old settings carry over once, and are never copied again over newer ones", () => {
  const stored = { 'tracker-farm-zoom': '2', 'tracker-farm-beds': '{"/code/a":{"i":0}}', 'tracker-farm-sky': 'night' };
  const { worlds } = page();
  const store = { get: k => stored[k] ?? null, set: (k, v) => { stored[k] = v; }, keys: () => Object.keys(stored) };
  assert.deepEqual(plain(worlds.loadPrefs('farm', store)), { zoom: '2', beds: '{"/code/a":{"i":0}}', sky: 'night' });
  stored['tracker-world:farm:zoom'] = '3';
  stored['tracker-farm-zoom'] = '1.5';
  assert.equal(worlds.loadPrefs('farm', store).zoom, '3');
  const empty = {};
  const fresh = { get: k => empty[k] ?? null, set: (k, v) => { empty[k] = v; }, keys: () => Object.keys(empty) };
  assert.deepEqual(plain(worlds.loadPrefs('farm', fresh)), {});
  empty['tracker-farm-zoom'] = '2';
  assert.deepEqual(plain(worlds.loadPrefs('farm', fresh)), {}, 'migrated once, even with nothing to copy');
});

test('what the frame may ask for is done; anything else is dropped', async () => {
  const p = page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'pick', agentId: 'a1', from: 'say' });
  p.from({ type: 'pick', agentId: 'nobody' });
  p.from({ type: 'openDoc', agentId: 'a1', path: '/code/shop/web/README.md' });
  p.from({ type: 'openDoc', agentId: 'a1', path: '/etc/passwd' });
  p.from({ type: 'openDoc', agentId: 'a1', path: '/code/shop/web/../../../etc/passwd' });
  p.from({ type: 'openLink', url: 'https://github.com/sam/web/pull/41' });
  p.from({ type: 'openLink', url: 'https://evil.example/' });
  p.from({ type: 'startSession' });
  p.from({ type: 'showRepos' });
  p.from({ type: 'nav', what: 'theme' });
  p.from({ type: 'nav', what: 'delete-everything' });
  p.from({ type: 'bell', on: true });
  p.from({ type: 'bell', on: 'yes' });
  p.from({ type: 'answer', agentId: 'a1', text: 'yes' });
  p.from({ type: 'store', key: 'zoom', value: '2' });
  p.from({ type: 'store', key: 'canSee', value: 'on' });
  p.from({ type: 'store', key: 'zoom', value: 'x'.repeat(16_385) });
  p.from(null);
  p.from('pick');
  assert.deepEqual(p.calls, [
    ['pick', 'a1', 'say'], ['doc', 'a1', '/code/shop/web/README.md'], ['open', 'https://github.com/sam/web/pull/41', '_blank'],
    ['start'], ['repos'], ['nav', 'theme'], ['bell', true],
  ]);
  assert.equal(p.stored['tracker-bell'], 'on');
  assert.equal(p.stored['tracker-world:farm:zoom'], '2');
  assert.ok(!('tracker-world:farm:canSee' in p.stored));
});

test('a file request is fetched with the token and answered; its memory paths may then be opened', async () => {
  const p = page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'request', id: 7, kind: 'agentFiles', agentId: 'a1' });
  await p.settle();
  assert.deepEqual(p.fetches[0], ['/api/agent/a1/files', 'tok']);
  const reply = p.posted.find(m => m.type === 'reply');
  assert.equal(reply.id, 7);
  assert.equal(reply.ok, true);
  p.from({ type: 'openDoc', agentId: 'a1', path: '/Users/sam/.claude/projects/x/memory/a.md' });
  assert.deepEqual(p.calls.at(-1), ['doc', 'a1', '/Users/sam/.claude/projects/x/memory/a.md']);
  p.from({ type: 'request', id: 8, kind: 'repoTouched', repo: '/somewhere/else' });
  await p.settle();
  assert.equal(p.posted.find(m => m.type === 'reply' && m.id === 8)?.ok, false, 'a repo not on the dashboard: refused, still answered');
});

test('a world that floods the page: big values, long diaries and a fifth request at once are refused', async () => {
  const p = page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  for (let i = 0; i < 4; i++) p.from({ type: 'request', id: i, kind: 'agentFiles', agentId: 'a1' }); // in flight
  p.from({ type: 'request', id: 99, kind: 'agentFiles', agentId: 'a1' });
  assert.equal(p.posted.find(m => m.type === 'reply' && m.id === 99)?.ok, false, 'the fifth is refused at once');
  assert.equal(p.fetches.length, 4);
  const entry = { at: NOW, state: 'working', who: 'a', text: 'b' };
  p.from({ type: 'diary', entries: Array.from({ length: 21 }, () => entry) });
  assert.equal(p.diary.innerHTML, '');
  for (let i = 0; i < 5000; i++) p.from({ type: 'store', key: 'beds', value: String(i) });
  assert.equal(p.stored['tracker-world:farm:beds'], '4999');
});

test("the diary is the frame's entries as text: a world can't write the page's HTML", () => {
  const p = page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: '<img src=x onerror=alert(1)>', text: '<b>hi</b>' }, { at: NOW, state: 'evil" onclick="x', who: '', text: 'x' }] });
  assert.equal(p.diary.innerHTML, '', 'a bad state drops the whole message');
  p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: '<img src=x onerror=alert(1)>', text: '<b>hi</b>' }] });
  assert.ok(p.diary.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!p.diary.innerHTML.includes('<img'));
  assert.ok(p.diary.innerHTML.includes('&lt;b&gt;hi&lt;/b&gt;'));
});

test('a message from anything but the current frame is ignored', () => {
  const p = page();
  p.farm.update(snap);
  p.listeners.message({ source: {}, data: { type: 'loaded' } });
  assert.deepEqual(p.posted, []);
});
