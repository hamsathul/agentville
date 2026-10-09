// Loads web/worlds/sdk/bridge.js in a vm, as a world's frame runs it: what the page sends reaches the world,
// and everything the world does reaches the page as one of the accepted messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = readFileSync(fileURLToPath(new URL('../../web/worlds/sdk/bridge.js', import.meta.url)), 'utf8');

// A pair of linked ports, as a MessageChannel makes: posting on one reaches the other's `onmessage`
// (buffered until it has one, as a real MessagePort is until it is started). The page makes the channel
// and hands one port to the bridge in `start`; everything after that rides it, both ways.
function portPair() {
  const make = () => ({ _fn: null, peer: null, _buf: [], start() {}, close() {},
    set onmessage(fn) { this._fn = fn; if (fn) for (const m of this._buf.splice(0)) fn({ data: m }); },
    get onmessage() { return this._fn; },
    postMessage(data) { const d = JSON.parse(JSON.stringify(data)); if (this.peer._fn) this.peer._fn({ data: d }); else this.peer._buf.push(d); } });
  const a = make(), b = make();
  a.peer = b; b.peer = a;
  return [a, b];
}

/** A frame running the bridge; `globals` are the browser's own, on its window, as it loads. */
function frame(globals = {}) {
  const sent = [], listeners = {}, docListeners = {}, frames = [], timers = [];
  const parent = { postMessage: m => sent.push(JSON.parse(JSON.stringify(m))) };
  const root = { dataset: {} }, farmEl = { id: 'farm' };
  const window = { parent, ...globals };
  const ctx = {
    window, parent, console,
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); },
    document: { documentElement: root, getElementById: id => (id === 'farm' ? farmEl : null), addEventListener: (t, fn) => { (docListeners[t] ??= []).push(fn); } },
    requestAnimationFrame: fn => frames.push(fn), setTimeout: fn => timers.push(fn),
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const fire = (t, e) => (listeners[t] ?? []).forEach(fn => fn(e));
  // `start` goes over the window carrying a port; the bridge keeps the port and talks over it from then
  // on, so a later page→frame message (scene, select, reply) is delivered over the port, and what the
  // bridge sends after `start` (ready, errors, pick…) comes back over the port into `sent`.
  let pageToFrame = null;
  const fromPage = data => {
    if (data && data.type === 'start') {
      const [p1, p2] = portPair();
      pageToFrame = p1;
      p1.onmessage = e => sent.push(JSON.parse(JSON.stringify(e.data))); // bridge → page, over the port
      fire('message', { source: parent, data, ports: [p2] });
    } else if (pageToFrame) {
      pageToFrame.postMessage(data); // page → frame, over the port
    } else {
      fire('message', { source: parent, data });
    }
  };
  /** The frame draws once: the animation frames waiting now run. */
  const draw = () => frames.splice(0).forEach(fn => fn());
  /** The timers waiting now run (the tab is hidden: no frames). */
  const tick = () => timers.splice(0).forEach(fn => fn());
  return { A: window.Agentville, window, ctx, sent, fire, fromPage, root, farmEl, docListeners, draw, tick };
}

test('a world has no WebRTC: gone before it runs, and it cannot put it back', () => {
  function RTCPeerConnection() {}
  const f = frame({ RTCPeerConnection, RTCIceTransport: function RTCIceTransport() {} });
  for (const name of ['RTCPeerConnection', 'RTCIceTransport']) {
    assert.ok(name in f.window, `${name} is still a name, so nothing can define it afresh`);
    assert.equal(f.window[name], undefined, `${name} is undefined`);
    assert.throws(() => { f.window[name] = RTCPeerConnection; }, TypeError, `${name} can't be reassigned`);
    assert.throws(() => Object.defineProperty(f.window, name, { value: RTCPeerConnection }), TypeError, `${name} can't be redefined`);
    assert.throws(() => delete f.window[name], TypeError, `${name} can't be deleted (to define it again)`);
    assert.equal(f.window[name], undefined);
  }
  vm.runInContext('window.RTCPeerConnection = function () {};', f.ctx); // a world's own script (not strict): quietly, nothing
  assert.equal(f.window.RTCPeerConnection, undefined);
  assert.ok(!('webkitRTCPeerConnection' in f.window), "a name the browser doesn't have is left alone");
  const g = frame();
  g.A.raw({ start() {}, scene() {} });
  g.fire('DOMContentLoaded', {});
  assert.equal(g.sent[0].type, 'loaded', 'and a world still registers as before');
});

test('a world that registers is announced; one that never does is reported', () => {
  const f = frame();
  f.fire('DOMContentLoaded', {});
  assert.deepEqual(f.sent, [{ type: 'error', message: 'world.js did not register a world (Agentville.world or Agentville.raw).', where: 'world.js' }]);
  const g = frame();
  g.A.raw({ start() {}, scene() {} });
  g.fire('DOMContentLoaded', {});
  assert.deepEqual(g.sent, [{ type: 'loaded', raw: true }], 'a world that draws itself says so: the page gives it a way back');
  const e = frame();
  e.A.raw({ start() {}, scene() {} }, { engine: true });
  e.fire('DOMContentLoaded', {});
  assert.deepEqual(e.sent, [{ type: 'loaded' }], 'the engine has the buttons already');
  const n = frame();
  n.A.raw({ start() {}, scene() {} }, null);
  n.fire('DOMContentLoaded', {});
  assert.deepEqual(n.sent, [{ type: 'loaded', raw: true }], 'anything but { engine: true } is a world that draws itself');
});

test('start runs the world in #farm with its prefs and settings, then ready; once it has drawn, the newest scene', () => {
  const f = frame(), got = [];
  f.A.raw({ start: ({ el, opts, prefs }) => got.push(['start', el.id, prefs.get('zoom'), prefs.get('bell'), opts.still, opts.navState()]), scene: s => got.push(['scene', s.n]), select: id => got.push(['select', id]) });
  // start carries the port; the page then sends the scene and the selection over it, as worlds.js does.
  f.fromPage({ type: 'start', world: 'farm', prefs: { zoom: '2' }, settings: { still: true, theme: 'light', nav: { theme: 'light' }, bell: true } });
  f.fromPage({ type: 'scene', scene: { n: 1 } });
  f.fromPage({ type: 'select', id: 'a1' });
  assert.deepEqual(got, [['start', 'farm', '2', 'on', true, { theme: 'light' }]], 'it draws once before its first scene, as the farm did on the page');
  assert.equal(f.root.dataset.theme, 'light');
  assert.deepEqual(f.sent.at(-1), { type: 'ready' }, 'ready comes back over the port');
  f.fromPage({ type: 'scene', scene: { n: 2 } });
  f.draw();
  assert.equal(got.length, 1, 'one frame is not enough: it must have been drawn');
  f.draw();
  assert.deepEqual(got.slice(1), [['scene', 2], ['select', 'a1']], 'the newest scene only, then the selection');
  f.tick();
  f.fromPage({ type: 'scene', scene: { n: 3 } });
  assert.deepEqual(got.slice(3), [['scene', 3]], 'then each one as it comes, once');
  f.fromPage({ type: 'settings', settings: { theme: 'auto' } });
  assert.equal(f.root.dataset.theme, undefined);
});

test('in a hidden tab (no frames drawn), the scene comes half a second after start', () => {
  const f = frame(), got = [];
  f.A.raw({ start: () => got.push('start'), scene: s => got.push(s.n) });
  f.fromPage({ type: 'start', prefs: {}, settings: {} });
  f.fromPage({ type: 'scene', scene: { n: 1 } });
  f.tick();
  f.draw();
  f.draw();
  assert.deepEqual(got, ['start', 1]);
});

test("what an engine world does becomes the page's messages", async () => {
  const f = frame();
  let opts, prefs;
  f.A.raw({ start: x => { ({ opts, prefs } = x); }, scene() {} });
  f.fromPage({ type: 'start', prefs: {}, settings: {} });
  opts.onPickAgent('a1', { from: 'say' });
  opts.onPickAgent('a2');
  opts.onOpenDoc('a1', '/code/x.md');
  opts.onShowRepos();
  opts.onStartSession();
  opts.onNav('list');
  opts.onBell(true);
  opts.onMotion(true);
  prefs.set('zoom', 2);
  prefs.set('bell', 'on');
  opts.onDiary([{ at: 1, state: 'working', who: 'a', text: 'b', extra: 1 }]);
  opts.onDiary([{ at: 1, state: 'working', who: 'a', text: 'b' }]);
  const asked = opts.request('repoTouched', { repo: '/code/x' });
  assert.deepEqual(f.sent.slice(1), [
    { type: 'pick', agentId: 'a1', from: 'say' }, { type: 'pick', agentId: 'a2' }, { type: 'openDoc', agentId: 'a1', path: '/code/x.md' },
    { type: 'showRepos' }, { type: 'startSession' }, { type: 'nav', what: 'list' }, { type: 'bell', on: true }, { type: 'motion', still: true },
    { type: 'store', key: 'zoom', value: '2' }, { type: 'diary', entries: [{ at: 1, state: 'working', who: 'a', text: 'b' }] },
    { type: 'request', id: 1, kind: 'repoTouched', repo: '/code/x' },
  ], 'the same diary twice is sent once; bell is the page\'s own setting');
  f.fromPage({ type: 'reply', id: 1, ok: true, status: 200, data: { files: [] } });
  assert.deepEqual(JSON.parse(JSON.stringify(await asked)), { ok: true, status: 200, data: { files: [] } });
});

test('an error in the world is reported to the page once, with where it happened', () => {
  const f = frame();
  f.A.raw({ start() { throw new Error('no barn'); }, scene() {} });
  f.fromPage({ type: 'start', prefs: {}, settings: {} });
  f.fire('error', { message: 'x is not defined', filename: 'http://127.0.0.1:7777/world/farm/world.js', lineno: 40 });
  f.fire('error', { message: 'x is not defined', filename: 'http://127.0.0.1:7777/world/farm/world.js', lineno: 40 });
  assert.deepEqual(f.sent.filter(m => m.type === 'error'), [{ type: 'error', message: 'no barn', where: 'start' }, { type: 'error', message: 'x is not defined', where: 'world.js:40' }]);
});

test('a link in a world goes through the page, and only to GitHub', () => {
  const f = frame();
  const click = href => { let prevented = false; f.docListeners.click[0]({ target: { closest: () => ({ href }) }, preventDefault: () => { prevented = true; } }); return prevented; };
  assert.equal(click('https://github.com/sam/web/pull/41'), true);
  assert.equal(click('https://evil.example/?data=1'), true);
  assert.deepEqual(f.sent, [{ type: 'openLink', url: 'https://github.com/sam/web/pull/41' }]);
});

test('the page is told the moment the document starts to go away, through the parent captured at load', () => {
  const f = frame(), evil = [];
  f.window.parent = { postMessage: m => evil.push(m) }; // a world can replace window.parent
  f.fire('beforeunload', {});
  f.fire('pagehide', {});
  assert.deepEqual(f.sent, [{ type: 'leaving' }], 'once, to the page');
  assert.deepEqual(evil, []);
  const g = frame();
  g.fire('pagehide', {});
  assert.deepEqual(g.sent, [{ type: 'leaving' }], 'pagehide alone does it too');
});

test('a file that fails to load is named', () => {
  const f = frame();
  f.fire('error', { message: '', target: { src: 'http://127.0.0.1:7777/world/u/x/art.js' } });
  assert.deepEqual(f.sent, [{ type: 'error', message: 'A file did not load (art.js)', where: 'art.js' }]);
});

test('messages from anything but the page are ignored', () => {
  const f = frame(), got = [];
  f.A.raw({ start: () => got.push('start'), scene() {} });
  f.fire('message', { source: {}, data: { type: 'start', prefs: {}, settings: {} } });
  assert.deepEqual(got, []);
});

test('`loaded` goes over the window; once `start` brings the port, the bridge listens only on it', () => {
  const f = frame(), got = [];
  f.A.raw({ start: () => got.push('start'), scene: s => got.push(['scene', s.n]) });
  f.fire('DOMContentLoaded', {});
  assert.deepEqual(f.sent, [{ type: 'loaded', raw: true }], 'loaded is sent over the window, before any port');
  f.fromPage({ type: 'start', prefs: {}, settings: {} }); // carries the port; the bridge keeps it
  // A `start` over the window now (what a page the world navigated to might post to window.parent) is not taken.
  f.fire('message', { source: f.window.parent, data: { type: 'scene', scene: { n: 9 } } });
  assert.deepEqual(got, ['start'], 'a window message after the port is live is ignored');
  f.fromPage({ type: 'scene', scene: { n: 1 } });
  f.draw(); f.draw();
  assert.deepEqual(got, ['start', ['scene', 1]], 'the scene over the port is run');
});

test('a world asks at most four things at once; the rest wait their turn, and every one is answered', async () => {
  const f = frame();
  let opts;
  f.A.raw({ start: x => { ({ opts } = x); }, scene() {} });
  f.fromPage({ type: 'start', prefs: {}, settings: {} });
  const got = [];
  const asked = Array.from({ length: 8 }, (_, i) => opts.request('agentFiles', { agentId: `a${i}` }).then(r => got.push([i, r.data.n])));
  const requests = () => f.sent.filter(m => m.type === 'request');
  assert.deepEqual(requests().map(m => [m.id, m.agentId]), [[1, 'a0'], [2, 'a1'], [3, 'a2'], [4, 'a3']], 'four go to the page');
  const order = [2, 1, 5, 3, 4, 6, 8, 7];
  for (const [k, id] of order.entries()) {
    f.fromPage({ type: 'reply', id, ok: true, status: 200, data: { n: id } });
    assert.equal(requests().length, Math.min(8, 5 + k), `answer ${k + 1}: the next in line goes`);
  }
  await Promise.all(asked);
  assert.deepEqual(got.map(([i]) => i), order.map(id => id - 1), 'each resolves when its answer comes');
  assert.ok(got.every(([i, n]) => n === i + 1), 'with its own answer');
});
