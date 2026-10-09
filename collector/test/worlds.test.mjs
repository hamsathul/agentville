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

const WORLDS = [
  { key: 'farm', builtIn: true, name: 'Farm', icon: '🌾', description: 'Every agent a farmer', nouns: { diary: 'Farm diary' }, preview: null, error: null },
  { key: 'u/space', builtIn: false, name: 'Space', icon: '🚀', description: '', nouns: {}, preview: null, error: null },
  { key: 'u/broken', builtIn: false, name: 'broken', icon: '🧩', description: '', nouns: {}, preview: null, error: 'world.json is missing.' },
];

async function page({ stored = {}, hold = false, worlds = WORLDS, dialog = false, listFails = false, reveal = { ok: true, path: '/w' } } = {}) {
  const posted = [], calls = [], listeners = {}, fetches = [], held = [], warnings = [], made = [], frames = [], timers = [], signals = [];
  const clock = { now: NOW, perf: 1000 }; // now: the wall clock (it can jump); perf: the page's steady clock
  const element = tag => ({ tag, innerHTML: '', textContent: '', className: '', listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, setAttribute() {}, remove() { this.removed = true; } });
  const host = { held: [], replaceChildren(...els) { this.held = els; }, append(el) { this.held.push(el); } };
  const diary = { innerHTML: '' };
  const dlg = { ...element('dialog'), open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const els = dialog ? { 'worlds-dlg': dlg, 'worlds-list': element('ul'), 'worlds-where': element('span') } : {};
  const window = {
    addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener: t => { delete listeners[t]; },
    open: (url, target) => calls.push(['open', url, target]), matchMedia: () => ({ matches: false }),
  };
  const ctx = {
    window, console: { warn: m => warnings.push(m) },
    document: {
      hidden: false,
      getElementById: id => els[id] ?? null,
      createElement: tag => {
        made.push(tag);
        if (tag !== 'iframe') return element(tag);
        const f = { ...element('iframe'), title: '', src: '', contentWindow: { postMessage: m => posted.push(JSON.parse(JSON.stringify(m))) } };
        frames.push(f);
        return f;
      },
    },
    addEventListener: window.addEventListener, removeEventListener: window.removeEventListener,
    setInterval: () => 1, clearInterval() {},
    setTimeout: (fn, ms = 0) => timers.push({ fn, at: clock.perf + ms }), clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
    performance: { now: () => clock.perf },
    AbortSignal: { timeout: ms => ({ timeoutMs: ms }) },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } },
    localStorage: {
      getItem: k => stored[k] ?? null, setItem: (k, v) => { stored[k] = String(v); }, removeItem: k => { delete stored[k]; },
      get length() { return Object.keys(stored).length; }, key: i => Object.keys(stored)[i] ?? null,
    },
    fetch: (url, init) => {
      if (url === '/api/worlds' && listFails) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'no' }) });
      if (url === '/api/actions/reveal-worlds') { fetches.push([url, init?.headers?.['x-tracker-token']]); return Promise.resolve({ ok: true, status: 200, json: async () => reveal }); }
      if (url === '/api/worlds' && ctx.holdFirstList) { // the first list is slow: its answer comes when released
        ctx.holdFirstList = false;
        return new Promise(resolve => { ctx.releaseList = () => resolve({ ok: true, status: 200, json: async () => ({ worlds, folder: '/Users/sam/.agentville/worlds' }) }); });
      }
      if (url === '/api/worlds') return Promise.resolve({ ok: true, status: 200, json: async () => ({ worlds, folder: '/Users/sam/.agentville/worlds' }) });
      fetches.push([url, init?.headers?.['x-tracker-token']]);
      signals.push(init?.signal);
      const reply = { ok: true, status: 200, json: async () => ({ memory: [{ path: '/Users/sam/.claude/projects/x/memory/a.md' }], files: [] }) };
      return hold ? new Promise(resolve => held.push(() => resolve(reply))) : Promise.resolve(reply);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const farm = window.TrackerFarm;
  const options = {
    token: 'tok', diary, navState: () => ({ theme: 'dark', side: false, live: true }),
    onPickAgent: (id, o) => calls.push(['pick', id, o?.from ?? null]), onOpenDoc: (id, p) => calls.push(['doc', id, p]),
    onShowRepos: () => calls.push(['repos']), onStartSession: () => calls.push(['start']), onNav: w => calls.push(['nav', w]), onBell: on => calls.push(['bell', on]),
    onWorld: w => calls.push(['world', w.key]),
    onNotice: t => calls.push(['notice', t]),
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  farm.mount(host, options);
  await settle();
  /** Time passes: the clock moves on, and the timers that are due run. */
  const wait = ms => { clock.now += ms; clock.perf += ms; for (const t of timers) if (t.fn && t.at <= clock.perf) { const fn = t.fn; t.fn = null; fn(); } };
  /** The held file requests: the first one waiting is answered. */
  const answer = async () => { held.shift()?.(); await settle(); };
  return {
    ctx, jump: ms => { clock.now += ms; }, farm, posted, calls, diary, stored, fetches, settle, wait, answer, timeouts: timers, warnings, made, host, options, worlds: window.AgentvilleWorlds, listeners, frames, dlg, els,
    get frame() { return frames.at(-1); },
    // a message from the newest frame (one the page has let go of is still "the newest" here, and must be ignored)
    from: data => listeners.message?.({ source: frames.at(-1)?.contentWindow, data }),
    signals,
  };
}
const snap = { generatedAt: NOW, collisions: [], agents: [{ id: 'a1', name: 'cart-ui', kind: 'interactive', cwd: '/code/shop/web', state: 'working', feed: [], children: [], touching: [] }], repos: [{ path: '/code/shop/web', name: 'web', branch: 'main' }] };

test('the frame gets its start (prefs, settings), then only the newest scene and the selection, once it has loaded', async () => {
  const p = await page({ stored: { 'tracker-world:farm:zoom': '2' } });
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

test("the farm's old settings carry over once, and are never copied again over newer ones", async () => {
  const stored = { 'tracker-farm-zoom': '2', 'tracker-farm-beds': '{"/code/a":{"i":0}}', 'tracker-farm-sky': 'night' };
  const { worlds } = await page();
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
  const p = await page();
  p.calls.length = 0; // the world announcement is not what is tested here
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
  const p = await page();
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
  const p = await page();
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

test("the diary is the frame's entries as text: a world can't write the page's HTML", async () => {
  const p = await page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: '<img src=x onerror=alert(1)>', text: '<b>hi</b>' }, { at: NOW, state: 'evil" onclick="x', who: '', text: 'x' }] });
  assert.equal(p.diary.innerHTML, '', 'a bad state drops the whole message');
  p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: '<img src=x onerror=alert(1)>', text: '<b>hi</b>' }] });
  assert.ok(p.diary.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!p.diary.innerHTML.includes('<img'));
  assert.ok(p.diary.innerHTML.includes('&lt;b&gt;hi&lt;/b&gt;'));
});

test('a message from anything but the current frame is ignored', async () => {
  const p = await page();
  p.farm.update(snap);
  p.listeners.message({ source: {}, data: { type: 'loaded' } });
  assert.deepEqual(p.posted, []);
});

const two = { ...snap, agents: [...snap.agents, { id: 'a2', name: 'blog', kind: 'interactive', cwd: '/code/blog', state: 'idle', feed: [], children: [], touching: [] }], repos: [...snap.repos, { path: '/code/blog', name: 'blog', branch: 'main' }] };

test('a request answered frees its place: a fifth is taken once one of four is answered', async () => {
  const p = await page({ hold: true });
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  for (let i = 1; i <= 4; i++) p.from({ type: 'request', id: i, kind: 'agentFiles', agentId: 'a1' });
  p.from({ type: 'request', id: 5, kind: 'agentFiles', agentId: 'a1' });
  assert.equal(p.posted.find(m => m.type === 'reply' && m.id === 5)?.ok, false, 'four at a time');
  await p.answer();
  assert.equal(p.posted.find(m => m.type === 'reply' && m.id === 1)?.ok, true);
  p.from({ type: 'request', id: 6, kind: 'agentFiles', agentId: 'a1' });
  assert.equal(p.fetches.length, 5, 'the one after the answer is fetched');
  assert.equal(p.posted.find(m => m.type === 'reply' && m.id === 6), undefined, 'and not refused');
});

test('replies that come after the frame is taken down, or after it loaded again, are not posted', async () => {
  const p = await page({ hold: true });
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'request', id: 1, kind: 'agentFiles', agentId: 'a1' });
  await p.farm.worldsChanged({ key: 'farm' }); // a new frame
  p.from({ type: 'loaded' });
  await p.answer();
  assert.deepEqual(p.posted.filter(m => m.type === 'reply'), [], 'the reloaded frame never asked for it (its ids start again)');
  p.from({ type: 'request', id: 2, kind: 'agentFiles', agentId: 'a1' });
  p.farm.unmount();
  await p.answer();
  assert.deepEqual(p.posted.filter(m => m.type === 'reply'), [], 'nor a frame that is gone');
});

test('the frame starts once per load: a second `loaded` from the same load is ignored', async () => {
  const p = await page({ stored: { 'tracker-world:farm:zoom': '2' } });
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  const n = p.posted.length;
  for (let i = 0; i < 100; i++) p.from({ type: 'loaded' });
  assert.equal(p.posted.length, n, 'no second start, scene or settings read');
  await p.farm.worldsChanged({ key: 'farm' }); // a new frame is a new load
  p.from({ type: 'loaded' });
  assert.deepEqual(p.posted.slice(n).map(m => m.type), ['start', 'scene', 'select'], 'loaded again: started again');
});

test('back from the list, the same frame stays, with what it remembers; after it reloads, only the newest scene', async () => {
  const p = await page();
  p.farm.update({ ...snap, generatedAt: 1 });
  p.from({ type: 'loaded' });
  p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: 'cart-ui', text: 'sends a note' }] });
  const n = p.posted.length;
  p.farm.mount(p.host, { ...p.options });
  assert.deepEqual(p.made, ['iframe'], 'no second frame');
  assert.deepEqual(p.posted.slice(n), [], 'nothing posted until a scene comes');
  assert.match(p.diary.innerHTML, /sends a note/, 'its diary is still there');
  p.farm.update({ ...snap, generatedAt: 2 });
  assert.equal(p.posted.at(-1).scene.generatedAt, 2);
  await p.farm.worldsChanged({ key: 'farm' }); // a new frame
  p.farm.update({ ...snap, generatedAt: 3 });
  p.farm.update({ ...snap, generatedAt: 4 });
  p.from({ type: 'loaded' });
  const fresh = p.posted.slice(p.posted.findLastIndex(m => m.type === 'start'));
  assert.deepEqual(fresh.map(m => (m.type === 'scene' ? m.scene.generatedAt : m.type)), ['start', 4, 'select'], 'the newest only, not every one sent while it loaded');
});

test('each action a quarter second at most: the first at once, the rest dropped; the bell keeps the newest', async () => {
  const p = await page();
  p.calls.length = 0;
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'nav', what: 'theme' });
  p.from({ type: 'nav', what: 'theme' });
  for (let i = 0; i < 50; i++) p.from({ type: 'nav', what: 'setup' });
  assert.deepEqual(p.calls, [['nav', 'theme']]);
  p.wait(250);
  p.from({ type: 'nav', what: 'setup' });
  assert.deepEqual(p.calls.at(-1), ['nav', 'setup'], 'a quarter second later, another');
  p.from({ type: 'pick', agentId: 'a1' });
  p.from({ type: 'pick', agentId: 'a1' });
  assert.equal(p.calls.filter(c => c[0] === 'pick').length, 1);
  p.from({ type: 'bell', on: true });
  p.from({ type: 'bell', on: false });
  p.from({ type: 'bell', on: true });
  p.from({ type: 'bell', on: false });
  assert.deepEqual(p.calls.filter(c => c[0] === 'bell'), [['bell', true]]);
  p.wait(250);
  assert.deepEqual(p.calls.filter(c => c[0] === 'bell'), [['bell', true], ['bell', false]], 'the newest, when its turn comes: the page and the world agree');
  assert.equal(p.stored['tracker-bell'], 'off');
});

test('the diary is drawn a quarter second apart at most, from the newest entries', async () => {
  const p = await page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  const say = text => p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: 'cart-ui', text }] });
  say('one');
  assert.match(p.diary.innerHTML, /one/);
  for (let i = 0; i < 1000; i++) say(`flood ${i}`);
  assert.match(p.diary.innerHTML, /one/, 'not redrawn at once');
  p.wait(250);
  assert.match(p.diary.innerHTML, /flood 999/);
});

test("a world's settings: at most 64, and 64 KB in all, counting what it saved before; never `migrated`", async () => {
  const big = 'x'.repeat(16_000);
  const p = await page({ stored: { 'tracker-world:farm:migrated': '1', 'tracker-world:farm:a': big, 'tracker-world:farm:b': big } });
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'store', key: 'c', value: big });
  p.from({ type: 'store', key: 'd', value: big });
  assert.equal(p.stored['tracker-world:farm:d'], big, 'four of 16000: under 64 KB');
  p.from({ type: 'store', key: 'e', value: 'x'.repeat(2_000) });
  assert.ok(!('tracker-world:farm:e' in p.stored), 'past 64 KB: refused');
  p.from({ type: 'store', key: 'a', value: 'small' });
  p.from({ type: 'store', key: 'e', value: 'x'.repeat(2_000) });
  assert.equal(p.stored['tracker-world:farm:e'].length, 2_000, 'a smaller value makes room');
  for (let i = 0; i < 70; i++) p.from({ type: 'store', key: `k${i}`, value: '1' });
  const keys = Object.keys(p.stored).filter(k => k.startsWith('tracker-world:farm:') && k !== 'tracker-world:farm:migrated');
  assert.equal(keys.length, 64, 'the 65th name is refused');
  assert.ok(!('tracker-world:farm:k59' in p.stored));
  p.from({ type: 'store', key: 'migrated', value: '0' });
  assert.equal(p.stored['tracker-world:farm:migrated'], '1');
  assert.equal(p.warnings.filter(w => /more settings than the page allows/.test(w)).length, 1, 'said once');
});

test('a file opens only where it belongs: a repo of the scene, or a path a reply named for that same agent', async () => {
  const p = await page();
  p.calls.length = 0;
  p.farm.update(two);
  p.from({ type: 'loaded' });
  p.from({ type: 'openDoc', agentId: 'a1', path: '/code/blog/notes.md' });
  assert.deepEqual(p.calls.at(-1), ['doc', 'a1', '/code/blog/notes.md'], 'in a repo of the scene');
  p.from({ type: 'request', id: 1, kind: 'agentFiles', agentId: 'a1' });
  await p.settle();
  p.wait(250);
  p.from({ type: 'openDoc', agentId: 'a2', path: '/Users/sam/.claude/projects/x/memory/a.md' });
  assert.equal(p.calls.length, 1, "a1's memory is not a2's");
  p.from({ type: 'openDoc', agentId: 'a1', path: '/Users/sam/.claude/projects/x/memory/a.md' });
  assert.deepEqual(p.calls.at(-1), ['doc', 'a1', '/Users/sam/.claude/projects/x/memory/a.md']);
  await p.farm.worldsChanged({ key: 'farm' }); // a new frame
  p.from({ type: 'loaded' });
  p.wait(250);
  p.from({ type: 'openDoc', agentId: 'a1', path: '/Users/sam/.claude/projects/x/memory/a.md' });
  assert.equal(p.calls.length, 2, 'forgotten when the frame loads again');
});

test('what is malformed is dropped, and said once; a request of an unknown kind is refused, and answered', async () => {
  const p = await page();
  p.calls.length = 0;
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'motion', still: 'yes' });
  assert.equal(p.calls.length, 0);
  p.from({ type: 'request', id: 3, kind: 'readEverything', agentId: 'a1' });
  assert.deepEqual(p.posted.find(m => m.type === 'reply' && m.id === 3), { type: 'reply', id: 3, ok: false, status: 403, error: 'That is not on the dashboard.' });
  for (let i = 0; i < 100; i++) p.from({ type: `junk${i}` });
  assert.equal(p.warnings.filter(w => /does not accept/.test(w)).length, 20, 'twenty kinds at most');
  for (let i = 0; i < 10; i++) p.from({ type: 'error', message: 'x is not defined', where: 'world.js:4' });
  p.from({ type: 'error', message: 'x is not defined', where: 'world.js:5' });
  assert.equal(p.warnings.filter(w => /x is not defined/.test(w)).length, 2, 'each error once');
});

test('the saved world is shown if it is still there and sound; else the farm, and the choice is reset', async () => {
  const space = await page({ stored: { 'tracker-world': 'u/space' } });
  assert.equal(space.frame.src, '/world/u/space/');
  assert.deepEqual(space.calls.filter(c => c[0] === 'world'), [['world', 'u/space']]);
  const gone = await page({ stored: { 'tracker-world': 'u/deleted' } });
  assert.equal(gone.frame.src, '/world/farm/');
  assert.equal(gone.stored['tracker-world'], undefined);
  const broken = await page({ stored: { 'tracker-world': 'u/broken' } });
  assert.equal(broken.frame.src, '/world/farm/');
  assert.equal(broken.stored['tracker-world'], undefined);
});

test("picking a world in the list shows it, remembers it, and keeps each world's settings apart", async () => {
  const p = await page({ stored: { 'tracker-world:farm:zoom': '2', 'tracker-world:u/space:zoom': '3' } });
  p.from({ type: 'loaded' });
  assert.equal(p.posted.find(m => m.type === 'start').prefs.zoom, '2');
  p.worlds.choose('u/space');
  assert.equal(p.stored['tracker-world'], 'u/space');
  assert.equal(p.frames.length, 2);
  assert.equal(p.frame.src, '/world/u/space/');
  p.posted.length = 0;
  p.from({ type: 'loaded' });
  assert.equal(p.posted.find(m => m.type === 'start').prefs.zoom, '3');
  p.worlds.choose('u/broken');
  assert.equal(p.frames.length, 2, 'a world with something wrong is not shown');
});

test("the world's own name for things: the toggle and the diary title come from it", async () => {
  const p = await page();
  assert.deepEqual(p.calls.filter(c => c[0] === 'world'), [['world', 'farm']]);
  assert.equal((await p.farm.current({ token: 'tok' })).name, 'Farm');
});

test('mounting again with the same host keeps the frame, and the world that was chosen; it is not announced again', async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.farm.mount(p.host, { ...p.options });
  await p.settle();
  assert.equal(p.frames.length, 1);
  assert.equal(p.calls.filter(c => c[0] === 'world').length, 1);
  assert.equal(p.frame.src, '/world/u/space/');
});

test('a hidden world cannot act: its page-changing messages are dropped; store, diary and request still work', async () => {
  const p = await page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.calls.length = 0;
  p.farm.hide();
  for (const m of [{ type: 'pick', agentId: 'a1' }, { type: 'openDoc', agentId: 'a1', path: '/code/shop/web/README.md' }, { type: 'openLink', url: 'https://github.com/sam/web' },
    { type: 'startSession' }, { type: 'showRepos' }, { type: 'nav', what: 'theme' }, { type: 'bell', on: true }, { type: 'motion', still: true }]) p.from(m);
  p.wait(500);
  assert.deepEqual(p.calls, [], 'nothing reaches the page');
  assert.equal(p.stored['tracker-bell'], undefined);
  p.from({ type: 'store', key: 'zoom', value: '4' });
  assert.equal(p.stored['tracker-world:farm:zoom'], '4');
  p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: 'a', text: 'still writing' }] });
  assert.match(p.diary.innerHTML, /still writing/);
  p.from({ type: 'request', id: 1, kind: 'agentFiles', agentId: 'a1' });
  await p.settle();
  assert.equal(p.posted.find(m => m.type === 'reply' && m.id === 1)?.ok, true);
  p.farm.mount(p.host, { ...p.options });
  p.from({ type: 'nav', what: 'theme' });
  assert.deepEqual(p.calls, [['nav', 'theme']], 'mounting shows it again, and it can act');
});

test('a bell held for its turn is dropped if the world is hidden when the turn comes', async () => {
  const p = await page();
  p.from({ type: 'loaded' });
  p.from({ type: 'bell', on: true });
  p.from({ type: 'bell', on: false });
  p.farm.hide();
  p.wait(250);
  assert.deepEqual(p.calls.filter(c => c[0] === 'bell'), [['bell', true]]);
});

test('the list: names, descriptions and errors written by strangers are text, never markup', async () => {
  const evil = '<img src=x onerror=alert(1)>', rlo = '\u202e';
  const worlds = [WORLDS[0], { key: 'u/evil', builtIn: false, name: `${evil}${rlo}txet`, icon: evil, description: `${evil}<script>x</script>`, nouns: {}, preview: null, error: null },
    { key: 'u/bad"onclick="x', builtIn: false, name: 'bad', icon: '!', description: `<b>${evil}</b>`, nouns: {}, preview: null, error: null },
    { key: 'u/oops', builtIn: false, name: 'oops', icon: '!', description: '', nouns: {}, preview: null, error: `<b>${evil}</b>` }];
  const p = await page({ worlds, dialog: true });
  await p.farm.openList();
  const html = p.els['worlds-list'].innerHTML;
  assert.ok(p.dlg.open);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img'), 'no image made of a name');
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;b&gt;') && !html.includes('<b><img'), 'a stranger\'s <b> stays text');
  assert.ok(!html.includes(rlo), 'no right-to-left override');
  assert.ok(!html.includes('onclick="x'), 'a key cannot break out of its attribute');
  assert.match(p.els['worlds-where'].textContent, /\/Users\/sam\/\.agentville\/worlds/);
});

test('the list: clicking a world shows it and closes the list; Open the worlds folder asks the collector', async () => {
  const p = await page({ dialog: true });
  await p.farm.openList();
  const click = (sel, extra = {}) => p.dlg.listeners.click({ target: { closest: s => (s === sel ? { dataset: extra } : null) } });
  click('[data-world]', { world: 'u/space' });
  assert.ok(!p.dlg.open);
  assert.equal(p.frame.src, '/world/u/space/');
  click('#worlds-folder');
  await p.settle();
  assert.deepEqual(p.fetches.at(-1), ['/api/actions/reveal-worlds', 'tok']);
  assert.equal(p.calls.filter(c => c[0] === 'notice').length, 0, 'nothing to say when it worked');
});

test('Open the worlds folder: when the collector says it could not, the page says so', async () => {
  const p = await page({ dialog: true, reveal: { ok: false, error: 'Finder could not show it.' } });
  await p.farm.openList();
  p.dlg.listeners.click({ target: { closest: s => (s === '#worlds-folder' ? {} : null) } });
  await p.settle();
  assert.deepEqual(p.calls.filter(c => c[0] === 'notice'), [['notice', 'Finder could not show it.']]);
});

test('a list that did not load does not make the saved world look gone: the choice is kept (the farm shows meanwhile)', async () => {
  const down = await page({ stored: { 'tracker-world': 'u/space' }, listFails: true });
  assert.equal(down.frame.src, '/world/farm/');
  assert.equal(down.stored['tracker-world'], 'u/space', 'kept for when the collector answers');
  const there = await page({ stored: { 'tracker-world': 'u/space' } });
  assert.equal(there.frame.src, '/world/u/space/');
});

test('choosing the world already showing just closes the list: its frame, with what it remembers, stays', async () => {
  const p = await page({ dialog: true });
  await p.farm.openList();
  p.dlg.listeners.click({ target: { closest: s => (s === '[data-world]' ? { dataset: { world: 'farm' } } : null) } });
  assert.ok(!p.dlg.open);
  assert.equal(p.frames.length, 1, 'no new frame');
  p.worlds.choose('u/space');
  p.worlds.choose('u/space');
  assert.equal(p.frames.length, 2);
});

test("a second world's first warnings are not muted by the first world's", async () => {
  const p = await page();
  p.from({ type: 'loaded' });
  p.from({ type: 'error', message: 'boom', where: 'a.js:1' });
  p.from({ type: 'bogus' });
  p.worlds.choose('u/space');
  p.from({ type: 'loaded' });
  p.from({ type: 'error', message: 'boom', where: 'a.js:1' });
  p.from({ type: 'bogus' });
  assert.equal(p.warnings.filter(w => /boom/.test(w)).length, 2);
  assert.equal(p.warnings.filter(w => /does not accept/.test(w)).length, 2);
});

test('the timers a page set are there to fire: timeouts is the record, wait(ms) fires the due ones', async () => {
  const p = await page();
  p.from({ type: 'loaded' });
  p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: 'a', text: 'one' }] });
  p.from({ type: 'diary', entries: [{ at: NOW, state: 'working', who: 'a', text: 'two' }] });
  assert.ok(p.timeouts.some(t => t.fn), 'the second drawing waits for its turn');
  p.wait(250);
  assert.match(p.diary.innerHTML, /two/);
});

test("a change to the world showing reloads it, keeping where you were looking (for this page's life only)", async () => {
  const p = await page();
  p.from({ type: 'loaded' });
  p.from({ type: 'store', key: 'view', value: '120,80' });
  assert.equal(p.stored['tracker-world:farm:view'], undefined, 'never saved in the browser');
  await p.farm.worldsChanged({ key: 'u/space' });
  assert.equal(p.frames.length, 1, 'another world changed: nothing to reload');
  await p.farm.worldsChanged({ key: 'farm' });
  assert.equal(p.frames.length, 2);
  p.posted.length = 0;
  p.from({ type: 'loaded' });
  assert.equal(p.posted.find(m => m.type === 'start').prefs.view, '120,80');
  await p.farm.worldsChanged({ key: '*' });
  assert.equal(p.frames.length, 3, 'the SDK changed: every world reloads');
});

test('a worlds event before the first frame exists builds nothing, and the chosen world still loads', async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' }, hold: false });
  p.farm.unmount();
  p.frames.length = 0;
  p.ctx.holdFirstList = true;
  const mounted = p.farm.mount(p.host, p.options); // host is set, the world not yet resolved
  await p.farm.worldsChanged({ key: '*' });
  assert.deepEqual(p.frames, [], 'no frame yet: nothing to reload');
  p.ctx.releaseList();
  await mounted;
  await p.settle();
  assert.deepEqual(p.frames.map(f => f.src), ['/world/u/space/']);
});

test('4 requests in flight, the frame reloads: a fifth from the new frame waits until an old fetch finishes', async () => {
  const p = await page({ hold: true });
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  for (let i = 1; i <= 4; i++) p.from({ type: 'request', id: i, kind: 'agentFiles', agentId: 'a1' });
  await p.farm.worldsChanged({ key: 'farm' });
  p.from({ type: 'loaded' });
  p.from({ type: 'request', id: 1, kind: 'agentFiles', agentId: 'a1' });
  assert.equal(p.posted.find(m => m.type === 'reply' && m.id === 1)?.ok, false, 'the old fetches still count');
  await p.answer();
  assert.deepEqual(p.posted.filter(m => m.type === 'reply' && m.ok), [], 'the old frame is not answered');
  p.from({ type: 'request', id: 2, kind: 'agentFiles', agentId: 'a1' });
  assert.equal(p.posted.find(m => m.type === 'reply' && m.id === 2), undefined, 'one finished: taken');
});

test("a wall-clock jump does not block a world's actions", async () => {
  const p = await page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'pick', agentId: 'a1' });
  p.jump(-3_600_000);
  p.wait(250);
  p.from({ type: 'pick', agentId: 'a1' });
  assert.equal(p.calls.filter(c => c[0] === 'pick').length, 2);
});

test('a second `load` of a frame is the world leaving; an extra `loaded` is dropped', async () => {
  const p = await page();
  p.frame.listeners.load();
  p.from({ type: 'loaded' });
  const n = p.posted.length;
  p.frame.listeners.load();
  assert.match(p.host.held[0].innerHTML, /tried to leave the page/);
  p.from({ type: 'loaded' });
  assert.equal(p.posted.length, n);
});

test("a world that doesn't start in 5 s is replaced by a panel that says why, with ways back", async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.from({ type: 'loaded' });
  p.from({ type: 'error', message: 'barn is not defined', where: 'world.js:12' });
  p.wait(5000);
  const [panel] = p.host.held;
  assert.equal(panel.className, 'world-panel');
  assert.match(panel.innerHTML, /Space didn.t start: barn is not defined \(world\.js:12\)/);
  assert.match(panel.innerHTML, /data-world-back/);
  assert.match(panel.innerHTML, /data-world-list/);
  assert.match(panel.innerHTML, /data-world-retry/);
});

test('the farm itself failing offers the list view instead of "back to the farm"', async () => {
  const p = await page();
  p.wait(5000);
  assert.match(p.host.held[0].innerHTML, /did not answer/);
  assert.match(p.host.held[0].innerHTML, /data-world-tolist/);
  assert.doesNotMatch(p.host.held[0].innerHTML, /data-world-back/);
});

test('a world that started in time is not replaced when the 5 s pass', async () => {
  const p = await page();
  p.from({ type: 'loaded' });
  p.from({ type: 'ready' });
  p.wait(5000);
  assert.equal(p.host.held[0], p.frame);
});

test('the panel buttons: try again, back to the farm', async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.wait(5000);
  const click = attr => p.host.held[0].listeners.click({ target: { closest: s => (s === `[${attr}]` ? {} : null) } });
  click('data-world-retry');
  assert.equal(p.frames.length, 2);
  assert.equal(p.frame.src, '/world/u/space/');
  p.wait(5000);
  click('data-world-back');
  assert.equal(p.frames.length, 3);
  assert.equal(p.frame.src, '/world/farm/');
  assert.equal(p.host.held[0], p.frame);
});

test("a world that draws itself gets the page's way back in a corner; an engine world none; it goes with its frame", async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  const corners = () => p.host.held.filter(el => el.className === 'world-corner');
  p.from({ type: 'loaded', raw: true });
  assert.equal(corners().length, 1, 'shown for a world that registered with Agentville.raw');
  assert.equal(p.host.held[0], p.frame, 'over the frame, which stays');
  const [corner] = corners();
  assert.match(corner.innerHTML, /data-corner-worlds[^>]*>World ▾</);
  assert.match(corner.innerHTML, /data-corner-list[^>]*>☰ List</);
  const click = attr => corner.listeners.click({ target: { closest: s => (s === `[${attr}]` ? {} : null) } });
  p.calls.length = 0;
  click('data-corner-worlds');
  click('data-corner-list');
  click('data-corner-list');
  assert.deepEqual(p.calls, [['nav', 'worlds'], ['nav', 'list'], ['nav', 'list']], "as nav 'worlds' and nav 'list', and never paced: they are your clicks");
  p.from({ type: 'loaded', raw: true });
  assert.equal(corners().length, 1, 'once per frame: an extra loaded adds none');
  p.worlds.choose('farm');
  assert.equal(corners().length, 0, 'gone with the frame when another world shows');
  p.from({ type: 'loaded' });
  assert.equal(corners().length, 0, 'an engine world (the farm) gets none');
  p.from({ type: 'loaded', raw: true });
  assert.equal(corners().length, 0, "the frame's first loaded stands: a later raw isn't heard");
  assert.equal(p.worlds.checkMessage({ type: 'loaded', raw: 'yes' }, { sentPaths: new Map() }).raw, false, 'raw is true or nothing');
  const q = await page({ stored: { 'tracker-world': 'u/space' } });
  q.from({ type: 'loaded', raw: true });
  q.from({ type: 'leaving' });
  assert.deepEqual(q.host.held.map(el => el.className), ['world-panel'], 'a panel in its place takes the corner away too (the panel has its own ways back)');
});

test('a world that loads another page in its frame is stopped at once', async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.frame.listeners.load(); // its own page
  p.from({ type: 'loaded' });
  p.from({ type: 'ready' });
  p.frame.listeners.load(); // a page it went to
  assert.match(p.host.held[0].innerHTML, /Space tried to leave the page and was stopped/);
  p.posted.length = 0;
  p.from({ type: 'pick', agentId: 'a1' });
  assert.deepEqual(p.calls.filter(c => c[0] === 'pick'), [], 'its messages are not heard any more');
});

test('an error after a world started shows in a strip over it; the world keeps going', async () => {
  const p = await page();
  p.from({ type: 'loaded' });
  p.from({ type: 'ready' });
  p.from({ type: 'error', message: 'drawChar failed', where: 'world.js:120' });
  const strip = p.host.held.find(el => el.className === 'world-strip');
  assert.match(strip.innerHTML, /<b>Farm:<\/b> drawChar failed \(world\.js:120\)/);
  assert.equal(p.host.held[0], p.frame, 'the frame stays');
});

test('`leaving` from the frame stops the world at once: a panel, the frame gone, nothing it sends heard', async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.farm.update(snap);
  const frame = p.frame;
  p.from({ type: 'loaded' });
  p.from({ type: 'leaving' });
  assert.match(p.host.held[0].innerHTML, /Space tried to leave the page and was stopped/);
  assert.ok(!p.host.held.includes(frame), 'the frame is removed');
  p.posted.length = 0;
  p.farm.update({ ...snap, generatedAt: 9 });
  p.farm.select('a1');
  assert.deepEqual(p.posted, [], 'nothing is posted to it any more');
  p.from({ type: 'pick', agentId: 'a1' });
  p.from({ type: 'loaded' });
  assert.deepEqual(p.calls.filter(c => c[0] === 'pick'), [], 'and nothing it says is heard');
  assert.deepEqual(p.posted, []);
});

test("the 'left' panel: Back to the farm, the list; no Try again; the farm's own gets List", async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' }, dialog: true });
  p.from({ type: 'leaving' });
  const html = p.host.held[0].innerHTML;
  assert.match(html, /data-world-back/);
  assert.match(html, /data-world-list/);
  assert.doesNotMatch(html, /data-world-retry/);
  const click = attr => p.host.held[0].listeners.click({ target: { closest: s => (s === `[${attr}]` ? {} : null) } });
  click('data-world-list');
  await p.settle();
  assert.ok(p.dlg.open, 'Show the list opens the list');
  const q = await page({ dialog: true });
  q.from({ type: 'leaving' });
  assert.doesNotMatch(q.host.held[0].innerHTML, /data-world-back/);
  q.host.held[0].listeners.click({ target: { closest: s => (s === '[data-world-tolist]' ? {} : null) } });
  assert.deepEqual(q.calls.filter(c => c[0] === 'nav'), [['nav', 'list']], 'List goes to the list view');
});

test('saving a world whose panel is showing reloads it; another world, nothing', async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.wait(5000);
  assert.equal(p.host.held[0].className, 'world-panel');
  await p.farm.worldsChanged({ key: 'farm' });
  assert.equal(p.frames.length, 1, "another world's files: nothing to reload");
  await p.farm.worldsChanged({ key: 'u/space' });
  assert.equal(p.frames.length, 2);
  assert.equal(p.host.held[0], p.frame, 'the panel gives way to a new frame');
  p.wait(5000);
  await p.farm.worldsChanged({ key: '*' });
  assert.equal(p.frames.length, 3, 'the SDK changed: reloaded too');
});

test('an error a world threw in its start (before it said ready) still shows, in a strip', async () => {
  const p = await page();
  p.from({ type: 'loaded' });
  p.from({ type: 'error', message: 'no barn', where: 'start' });
  p.from({ type: 'ready' });
  const strip = p.host.held.find(el => el.className === 'world-strip');
  assert.match(strip.innerHTML, /no barn \(start\)/);
});

test('the strip redraws only when its text changes, a quarter second apart, and does not come back right after ×', async () => {
  const p = await page();
  p.from({ type: 'loaded' });
  p.from({ type: 'ready' });
  const live = () => p.host.held.filter(el => el.className === 'world-strip' && !el.removed);
  const err = message => p.from({ type: 'error', message, where: 'w.js:1' });
  err('one');
  const strip = live()[0];
  let writes = 0, html = strip.innerHTML;
  Object.defineProperty(strip, 'innerHTML', { get: () => html, set: v => { writes++; html = v; } });
  err('one');
  err('two');
  assert.equal(writes, 0, 'the same text: nothing; a new one waits its turn');
  p.wait(250);
  assert.equal(writes, 1);
  assert.match(strip.innerHTML, /two/);
  strip.listeners.click({ target: { closest: s => (s === '[data-strip-close]' ? {} : null) } });
  assert.deepEqual(live(), []);
  err('two');
  err('three');
  p.wait(1000);
  assert.deepEqual(live(), [], 'not back right after ×');
  p.wait(5000);
  err('four');
  assert.equal(live().length, 1, 'a fresh error much later shows again');
});

test('a fetch for a world is cut off after 30 s, so it cannot hold a place for good', async () => {
  const p = await page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'request', id: 1, kind: 'agentFiles', agentId: 'a1' });
  assert.equal(p.signals.at(-1)?.timeoutMs, 30000);
});

test("one of your worlds sees no words or paths, and can't ask for files, until you let it", async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  const first = p.posted.find(m => m.type === 'scene').scene;
  assert.equal(first.private, true);
  assert.match(first.repos[0].key, /^r\d+$/);
  p.from({ type: 'request', id: 1, kind: 'agentFiles', agentId: 'a1' });
  assert.match(p.posted.find(m => m.type === 'reply').error, /Can see what agents say/);
  p.from({ type: 'pick', agentId: 'a1' });
  assert.deepEqual(p.calls.filter(c => c[0] === 'pick'), [['pick', 'a1', null]], 'it can still open an agent');
  p.worlds.setCanSee('u/space', true);
  assert.equal(p.stored['tracker-world-cansee:u/space'], 'on');
  assert.equal(p.frames.length, 2, 'it starts again, with the full scene');
  p.posted.length = 0;
  p.from({ type: 'loaded' });
  assert.equal(p.posted.find(m => m.type === 'scene').scene.private, false);
});

test('private mode: a file path is not opened, a scene sent later is private too, and unticking makes it private again', async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  p.from({ type: 'openDoc', agentId: 'a1', path: '/code/shop/web/README.md' });
  assert.deepEqual(p.calls.filter(c => c[0] === 'doc'), [], 'a file is never opened for a private world');
  p.posted.length = 0;
  p.farm.update(snap);
  assert.equal(p.posted.find(m => m.type === 'scene').scene.private, true);
  assert.equal(p.posted.find(m => m.type === 'scene').scene.agents[0].name, 'web', 'named by its folder');
  p.worlds.setCanSee('u/space', true);
  p.from({ type: 'loaded' });
  p.from({ type: 'openDoc', agentId: 'a1', path: '/code/shop/web/README.md' });
  assert.equal(p.calls.filter(c => c[0] === 'doc').length, 1, 'allowed: it opens');
  p.worlds.setCanSee('u/space', false);
  assert.equal(p.frames.length, 3);
  assert.ok(!('tracker-world-cansee:u/space' in p.stored));
  p.posted.length = 0;
  p.from({ type: 'loaded' });
  assert.equal(p.posted.find(m => m.type === 'scene').scene.private, true);
});

test('a world that failed is not restarted by the switch', async () => {
  const p = await page({ stored: { 'tracker-world': 'u/space' } });
  p.from({ type: 'leaving' });
  const n = p.frames.length;
  p.worlds.setCanSee('u/space', true);
  assert.equal(p.frames.length, n);
});

test('the list: the switch is only for your worlds, and it ignores a change in the list\'s first second', async () => {
  const p = await page({ dialog: true, stored: { 'tracker-world': 'u/space' } });
  await p.farm.openList();
  const html = () => p.els['worlds-list'].innerHTML;
  assert.equal((html().match(/data-see=/g) ?? []).length, 2, 'u/space and u/broken, not the farm');
  assert.ok(!html().includes('data-see="farm"'));
  assert.ok(/data-see="u\/space"[^>]* disabled/.test(html()), 'disabled at first');
  assert.match(html(), /<label class="world-see" title="A world can send what it sees to other sites, so allow this only for a world you trust\.">/, 'its tooltip says what is at stake');
  const box = { checked: true, dataset: { see: 'u/space' }, closest: s => (s === '[data-see]' ? box : null) };
  p.dlg.listeners.change({ target: box });
  assert.ok(!('tracker-world-cansee:u/space' in p.stored), 'a change at once does nothing');
  assert.equal(box.checked, false, 'and is undone');
  const live = [{ disabled: true }, { disabled: true }];
  p.els['worlds-list'].querySelectorAll = () => live;
  p.wait(1000);
  assert.ok(live.every(b => !b.disabled), 'enabled after a second, the boxes themselves (no new list)');
  box.checked = true;
  p.dlg.listeners.change({ target: box });
  assert.equal(p.stored['tracker-world-cansee:u/space'], 'on');
  assert.ok(/data-see="u\/space"[^>]* checked/.test(html()));
});

test('the switch unlocks by state, not by measuring: a timer a little early still unlocks, an old one cannot unlock a new opening', async () => {
  const p = await page({ dialog: true });
  const live = [{ disabled: true }];
  p.els['worlds-list'].querySelectorAll = () => live;
  await p.farm.openList();
  p.wait(999.5); // the clock reads a hair short of a second
  const old = p.timeouts.at(-1).fn;
  old();
  assert.ok(!live[0].disabled, 'unlocked all the same');
  const box = { checked: true, dataset: { see: 'u/space' }, closest: s => (s === '[data-see]' ? box : null) };
  p.dlg.listeners.change({ target: box });
  assert.equal(p.stored['tracker-world-cansee:u/space'], 'on');
  p.dlg.close();
  await p.farm.openList();
  live[0].disabled = true;
  box.checked = false;
  old();
  assert.ok(live[0].disabled, 'an older timer does not unlock the new opening');
  p.dlg.listeners.change({ target: box });
  assert.equal(p.stored['tracker-world-cansee:u/space'], 'on', 'a change is ignored while locked');
});

test('input in the list during the lock keeps it locked until a second without any', async () => {
  const p = await page({ dialog: true });
  const live = [{ disabled: true }];
  p.els['worlds-list'].querySelectorAll = () => live;
  await p.farm.openList();
  p.wait(600);
  p.dlg.listeners.pointerdown({});
  p.wait(600); // 1.2 s after opening, 0.6 s after the tap
  assert.ok(live[0].disabled, 'still locked');
  p.dlg.listeners.keydown({});
  p.wait(999);
  assert.ok(live[0].disabled, 'a key re-armed it too');
  p.wait(1);
  assert.ok(!live[0].disabled, 'a second without input: unlocked');
  p.dlg.listeners.pointerdown({});
  assert.ok(!live[0].disabled, 'input after the unlock does not lock it again');
});

test('the farm always sees everything', async () => {
  const p = await page();
  p.farm.update(snap);
  p.from({ type: 'loaded' });
  assert.equal(p.posted.find(m => m.type === 'scene').scene.private, false);
});
