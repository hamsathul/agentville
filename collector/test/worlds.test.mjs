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

async function page({ stored = {}, hold = false, worlds = WORLDS, dialog = false } = {}) {
  const posted = [], calls = [], listeners = {}, fetches = [], held = [], warnings = [], made = [], frames = [], timers = [];
  const clock = { now: NOW };
  const element = tag => ({ tag, innerHTML: '', textContent: '', className: '', listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, setAttribute() {}, remove() {} });
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
    setTimeout: (fn, ms = 0) => timers.push({ fn, at: clock.now + ms }), clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } },
    localStorage: {
      getItem: k => stored[k] ?? null, setItem: (k, v) => { stored[k] = String(v); }, removeItem: k => { delete stored[k]; },
      get length() { return Object.keys(stored).length; }, key: i => Object.keys(stored)[i] ?? null,
    },
    fetch: (url, init) => {
      if (url === '/api/worlds') return Promise.resolve({ ok: true, status: 200, json: async () => ({ worlds, folder: '/Users/sam/.agentville/worlds' }) });
      fetches.push([url, init?.headers?.['x-tracker-token']]);
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
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  farm.mount(host, options);
  await settle();
  /** Time passes: the clock moves on, and the timers that are due run. */
  const wait = ms => { clock.now += ms; for (const t of timers) if (t.fn && t.at <= clock.now) { const fn = t.fn; t.fn = null; fn(); } };
  /** The held file requests: the first one waiting is answered. */
  const answer = async () => { held.shift()?.(); await settle(); };
  return {
    farm, posted, calls, diary, stored, fetches, settle, wait, answer, warnings, made, host, options, worlds: window.AgentvilleWorlds, listeners, frames, dlg, els,
    get frame() { return frames.at(-1); },
    // a message from the newest frame (one the page has let go of is still "the newest" here, and must be ignored)
    from: data => listeners.message?.({ source: frames.at(-1)?.contentWindow, data }),
    /** The newest frame loads again (a reload, or it navigated); its bridge then says `loaded`. */
    reload: () => frames.at(-1)?.listeners.load?.(),
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
  p.reload();
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
  p.reload();
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
  p.reload();
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
  p.reload();
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
  const evil = '<img src=x onerror=alert(1)>', rlo = '‮';
  const worlds = [WORLDS[0], { key: 'u/evil', builtIn: false, name: `${evil}${rlo}txet`, icon: evil, description: `${evil}<script>x</script>`, nouns: {}, preview: null, error: null },
    { key: 'u/bad"onclick="x', builtIn: false, name: 'bad', icon: '!', description: '', nouns: {}, preview: null, error: `<b>${evil}</b>` }];
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
});
