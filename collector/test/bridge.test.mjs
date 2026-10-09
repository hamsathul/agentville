// Loads web/worlds/sdk/bridge.js in a vm, as a world's frame runs it: what the page sends reaches the world,
// and everything the world does reaches the page as one of the accepted messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = readFileSync(fileURLToPath(new URL('../../web/worlds/sdk/bridge.js', import.meta.url)), 'utf8');

function frame() {
  const sent = [], listeners = {}, docListeners = {}, frames = [], timers = [];
  const parent = { postMessage: m => sent.push(JSON.parse(JSON.stringify(m))) };
  const root = { dataset: {} }, farmEl = { id: 'farm' };
  const window = {};
  const ctx = {
    window, parent, console,
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); },
    document: { documentElement: root, getElementById: id => (id === 'farm' ? farmEl : null), addEventListener: (t, fn) => { (docListeners[t] ??= []).push(fn); } },
    requestAnimationFrame: fn => frames.push(fn), setTimeout: fn => timers.push(fn),
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const fire = (t, e) => (listeners[t] ?? []).forEach(fn => fn(e));
  const fromPage = data => fire('message', { source: parent, data });
  /** The frame draws once: the animation frames waiting now run. */
  const draw = () => frames.splice(0).forEach(fn => fn());
  /** The timers waiting now run (the tab is hidden: no frames). */
  const tick = () => timers.splice(0).forEach(fn => fn());
  return { A: window.Agentville, sent, fire, fromPage, root, farmEl, docListeners, draw, tick };
}

test('a world that registers is announced; one that never does is reported', () => {
  const f = frame();
  f.fire('DOMContentLoaded', {});
  assert.deepEqual(f.sent, [{ type: 'error', message: 'world.js did not register a world (Agentville.world or Agentville.raw).', where: 'world.js' }]);
  const g = frame();
  g.A.raw({ start() {}, scene() {} });
  g.fire('DOMContentLoaded', {});
  assert.deepEqual(g.sent, [{ type: 'loaded' }]);
});

test('start runs the world in #farm with its prefs and settings, then ready; once it has drawn, the newest scene', () => {
  const f = frame(), got = [];
  f.A.raw({ start: ({ el, opts, prefs }) => got.push(['start', el.id, prefs.get('zoom'), prefs.get('bell'), opts.still, opts.navState()]), scene: s => got.push(['scene', s.n]), select: id => got.push(['select', id]) });
  f.fromPage({ type: 'scene', scene: { n: 1 } });
  f.fromPage({ type: 'select', id: 'a1' });
  f.fromPage({ type: 'start', world: 'farm', prefs: { zoom: '2' }, settings: { still: true, theme: 'light', nav: { theme: 'light' }, bell: true } });
  assert.deepEqual(got, [['start', 'farm', '2', 'on', true, { theme: 'light' }]], 'it draws once before its first scene, as the farm did on the page');
  assert.equal(f.root.dataset.theme, 'light');
  assert.deepEqual(f.sent.at(-1), { type: 'ready' });
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
  f.fromPage({ type: 'scene', scene: { n: 1 } });
  f.fromPage({ type: 'start', prefs: {}, settings: {} });
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

test('messages from anything but the page are ignored', () => {
  const f = frame(), got = [];
  f.A.raw({ start: () => got.push('start'), scene() {} });
  f.fire('message', { source: {}, data: { type: 'start', prefs: {}, settings: {} } });
  assert.deepEqual(got, []);
});
