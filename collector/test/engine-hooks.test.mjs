// A world of four hooks, mounted and drawn on a stand-in DOM; the defaults the engine fills in
// (docs/worlds.md, "Hooks"): the fields kept for the labels, overflow of any group, a grid centred on W.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const code = ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js'].map(web).join('\n;\n');
const plain = v => JSON.parse(JSON.stringify(v));
const NOW = Date.now();
const tiny = { W: 200, slots: () => ({ group: 'all', cap: 9, at: i => [20 + i * 10, 40], zone: 'all' }), drawChar() {}, bg() {} };

// Every element and canvas context is a proxy that takes any call and answers with another.
function stubDom() {
  const rects = { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 };
  const numbers = new Set(['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight', 'width', 'height', 'length', 'size']);
  const calls = { fillRect: 0, record: null }; // record: an array to keep each fill in, [its colour, x, y, w, h], while a test wants them
  const make = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (numbers.has(k)) return t[k] ?? (k === 'offsetWidth' || k === 'width' ? 400 : k === 'offsetHeight' || k === 'height' ? 300 : 0);
      if (k === 'getBoundingClientRect') return () => rects;
      if (k === 'style' || k === 'dataset') return (t[k] ??= {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'isConnected') return true;
      if (k === 'hidden' || k === 'open') return t[k] ?? false;
      if (k === 'fillRect') return (x, y, w, h) => { calls.fillRect++; calls.record?.push([t.fillStyle, x, y, w, h]); };
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getContext') return () => ctx;
      if (k === 'measureText') return () => ({ width: 0 });
      return (t[k] ??= make());
    },
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => make(),
  });
  const ctx = make();
  return { make, calls, document: Object.assign(make(), { hidden: false }), globals: { ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} } };
}
function load() {
  const dom = stubDom();
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ...dom.globals });
  vm.runInContext(`${code}\n;window.sdk = { makeGrid, withDefaults, engineScene, makePixelView, makeField, ACTIVE, defaultHud, panelHud, PXG };`, ctx);
  return { window, dom, sdk: window.sdk };
}
const twoAgents = window => window.AgentvilleScene.toScene({ generatedAt: NOW, collisions: [], agents: [
  { id: 'a', name: 'a', kind: 'interactive', cwd: '/c/x', state: 'working', feed: [], children: [], touching: [] },
  { id: 'b', name: 'b', kind: 'interactive', cwd: '/c/y', state: 'waiting', ask: 'ok?', feed: [], children: [], touching: [] }],
repos: [{ path: '/c/x', name: 'x' }, { path: '/c/y', name: 'y' }] });
// working agents stand in their field, the rest on a porch with room for one
const fourHooks = (extra = {}) => ({ W: 200, slots: f => (f.state === 'working' ? { group: 'st:/c/x', at: used => { used.push(0); return [60, 90]; }, zone: 'field' } : { group: 'porch', cap: 1, at: () => [100, 40], zone: 'porch' }), drawChar() {}, bg() {}, ...extra });
const prefs = { get: () => null, set() {} };

test('a world of four hooks mounts and draws agents in a field and on the porch', () => {
  const { window, dom, sdk } = load();
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks()), prefs);
  view.update(sdk.engineScene(twoAgents(window)));
  assert.doesNotThrow(() => view.mount(dom.make(), { still: true }));
  assert.ok(dom.calls.fillRect > 0, 'it drew');
});

test("a world's own setScene still leaves the default labels the field names", () => {
  const { window, sdk } = load();
  const seen = [];
  const th = sdk.withDefaults(fourHooks({ setScene(next) { seen.push(next.fields.length); return []; } }));
  const view = sdk.makePixelView(th, prefs);
  view.update(sdk.engineScene(twoAgents(window)));
  assert.deepEqual(seen, [2], "the world's setScene ran");
  const labels = [];
  th.labels((x, y, html) => labels.push(html));
  assert.equal(labels.length, 2);
  assert.ok(labels.every(Boolean));
});

test('a group over its cap counts a number, whatever the world calls the group', () => {
  const { window, dom, sdk } = load();
  const got = [];
  const th = sdk.withDefaults(fourHooks({ labels(lab, overflow) { got.push(overflow.porch); } }));
  const view = sdk.makePixelView(th, prefs);
  const s = sdk.engineScene(twoAgents(window));
  s.farmers[0].state = 'waiting';
  view.mount(dom.make(), { still: true });
  view.update(s);
  assert.equal(got.at(-1), 1);
});

test('the default grid is centred on W, from the config given over 3 × 88 × 62', () => {
  const { sdk } = load();
  const fields = [{ key: '/a/b/one', name: 'one' }];
  const narrow = plain(sdk.withDefaults({ ...tiny }).grid.layoutFor(fields, {}, NOW));
  assert.ok(narrow.slots.every(s => s.cx >= 0 && s.cx <= 200), 'every bed inside the world');
  assert.ok(narrow.GRID.x0 >= 0 && narrow.GRID.x1 <= 200);
  const two = plain(sdk.withDefaults({ ...tiny, grid: { cols: 2, colW: 50 } }).grid.layoutFor(fields, {}, NOW));
  assert.deepEqual([two.slots[0].cx, two.slots[1].cx], [75, 125], 'beds centred on W / 2');
});

test("a world's corridors are checked: at least one x position", () => {
  const { sdk } = load();
  for (const bad of [[], 'x', [NaN], [1, 'a']]) assert.throws(() => sdk.withDefaults({ ...tiny, corridors: bad }), /corridors/);
  assert.deepEqual(plain(sdk.withDefaults({ ...tiny, corridors: [50, 150] }).corridors), [50, 150]);
});

test('a saved view is restored once the first scene is in, not at mount (the canvas is empty-sized until then)', () => {
  const { window, dom, sdk } = load();
  const els = {}, host = dom.make();
  host.querySelector = sel => (els[sel] ??= dom.make());
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks()), { get: k => (k === 'view' ? '120,80' : null), set() {} });
  view.mount(host, { still: true });
  const v = els['.px-view'];
  assert.equal(v.scrollTop, 0, 'not at mount');
  view.update(sdk.engineScene(twoAgents(window)));
  assert.deepEqual([v.scrollLeft, v.scrollTop], [120, 80], 'after the first scene');
  v.scrollTop = 5;
  view.update(sdk.engineScene(twoAgents(window)));
  assert.equal(v.scrollTop, 5, 'only once');
});

test("the engine's own words come from the world's nouns; place defaults to world", () => {
  const { sdk } = load();
  assert.equal(sdk.withDefaults(fourHooks()).nouns.place, 'world');
  const th = sdk.withDefaults(fourHooks({ nouns: { agents: 'bakers', place: 'bakery' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(th.nouns)), { agent: 'agent', agents: 'bakers', repo: 'repo', repos: 'repos', place: 'bakery' });
});

test('a world with animals gets the Animals switch in its HUD; one without gets none', () => {
  const { sdk } = load();
  assert.match(sdk.defaultHud({ animals: true }), /data-farm-animals[^>]*>[\s\S]*Animals: on/);
  assert.match(sdk.defaultHud({ animals: false }), /Animals: off/);
  assert.doesNotMatch(sdk.defaultHud({}), /data-farm-animals/);
  assert.doesNotMatch(sdk.defaultHud({ animals: null }), /data-farm-animals/);
});

/** A world mounted on a stand-in page whose HUD, dialog and click handler the test can reach. */
function mounted(world, prefsOf = {}, saved = []) {
  const { window, dom, sdk } = load();
  const els = {}, host = dom.make();
  let click = null;
  els['.px-dlg'] = Object.assign(dom.make(), { contains: () => false }); // a closed dialog: clicks go on past it
  host.querySelector = sel => (els[sel] ??= dom.make());
  host.addEventListener = (type, fn) => { if (type === 'click') click = fn; };
  const view = sdk.makePixelView(sdk.withDefaults(world), { get: k => prefsOf[k] ?? null, set: (k, v) => saved.push([k, v]) });
  view.mount(host, { still: true });
  view.update(sdk.engineScene(twoAgents(window)));
  return { sdk, hud: () => String(els['.px-hud'].innerHTML), click: attr => click({ target: { closest: sel => (sel === `[${attr}]` ? {} : null) }, stopPropagation() {} }) };
}

test('a world with its own season hook gets the Season switch in the default HUD, after Sky; one without gets none', () => {
  const hud = mounted(fourHooks({ season: () => 'autumn' })).hud();
  assert.match(hud, /data-farm-sky[\s\S]*data-farm-season[^>]*>[\s\S]*Season: live/);
  assert.doesNotMatch(mounted(fourHooks()).hud(), /data-farm-season/, 'the default season() is no seasons');
});

test("a held season is what the world's bg gets and PXG.season says, whatever its season() returns; live follows season()", () => {
  const run = held => {
    const got = [];
    const { sdk } = mounted(fourHooks({ season: () => 'spring', bg(fill, season) { got.push(season); } }), { season: held });
    return [got.at(-1), sdk.PXG.season];
  };
  assert.deepEqual(run('winter'), ['winter', 'winter']);
  assert.deepEqual(run('live'), ['spring', 'spring']);
  assert.deepEqual(run(null), ['spring', 'spring'], 'nothing saved: live');
  assert.deepEqual(run('monsoon'), ['spring', 'spring'], 'not a season: live');
});

test('the Season switch goes live, spring, summer, autumn, winter and back to live: saved, shown, the ground redrawn in it', () => {
  const got = [], saved = [];
  const w = mounted(fourHooks({ season: () => 'summer', bg(fill, season) { got.push(season); } }), {}, saved);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    w.click('data-farm-season');
    seen.push([saved.filter(([k]) => k === 'season').at(-1)?.[1], /Season: (\w+)/.exec(w.hud())?.[1], got.at(-1), w.sdk.PXG.season]);
  }
  assert.deepEqual(seen, [['spring', 'spring', 'spring', 'spring'], ['summer', 'summer', 'summer', 'summer'], ['autumn', 'autumn', 'autumn', 'autumn'], ['winter', 'winter', 'winter', 'winter'], ['live', 'live', 'summer', 'summer']]);
});

test('a world with animals draws them, and draws nothing more with them switched off', () => {
  const cast = [{ kind: 'cow', count: 3 }];
  const roam = () => [{ x: 10, y: 50, w: 150, h: 40 }];
  const run = animalsPref => {
    const { window, dom, sdk } = load();
    const view = sdk.makePixelView(sdk.withDefaults(fourHooks({ animals: () => cast, roam, avoid: () => [] })), { get: k => (k === 'animals' ? animalsPref : null), set() {} });
    view.mount(dom.make(), { still: true });
    dom.calls.fillRect = 0;
    view.update(sdk.engineScene(twoAgents(window)));
    return dom.calls.fillRect;
  };
  assert.ok(run(null) > run('off'), 'on by default: more drawn');
});

test('a world event with a kind reaches the animals; one without text pops nothing', () => {
  const { window, dom, sdk } = load();
  const reacted = [];
  const world = fourHooks({ animals: () => [{ kind: 'cow' }], roam: () => [{ x: 10, y: 50, w: 150, h: 40 }], setScene: () => [{ kind: 'deployFailed', at: [60, 60], text: '' }] });
  const view = sdk.makePixelView(sdk.withDefaults(world), prefs);
  view.mount(dom.make(), { still: true });
  view.animalsKit().react = (kind, at) => { reacted.push([kind, at]); return true; };
  view.update(sdk.engineScene(twoAgents(window)));
  assert.deepEqual(plain(reacted), [['deployFailed', [60, 60]]]);
});

test('a world event with no text pops nothing; one with text still pops', () => {
  const { window, dom, sdk } = load();
  const made = [];
  dom.document.createElement = () => { const el = dom.make(); made.push(el); return el; };
  const world = fourHooks({ setScene: () => [{ kind: 'deployFailed', at: [60, 60], text: '' }, { at: [70, 70], text: 'sold!' }] });
  const view = sdk.makePixelView(sdk.withDefaults(world), prefs);
  view.mount(dom.make(), { still: false });
  view.update(sdk.engineScene(twoAgents(window)));
  assert.equal(made.filter(el => String(el.className).startsWith('px-pop')).length, 1);
});

test("a world event's log line is its agent's; one with no agent is its `who`'s, else the market's (the farm's)", () => {
  const { window, dom, sdk } = load();
  let diary = [];
  const world = fourHooks({ setScene: () => [{ at: [70, 70], text: 'x', log: 'a pull request merged', who: 'The loading dock' }, { at: [70, 70], text: 'y', log: 'another merged' }, { id: 'a', text: 'z', log: 'its own news', who: 'not this' }, { at: [70, 70], text: 'w', log: 'odd', who: 42 }] });
  const view = sdk.makePixelView(sdk.withDefaults(world), prefs);
  view.mount(dom.make(), { still: true, onDiary: entries => { diary = entries; } });
  view.update(sdk.engineScene(twoAgents(window)));
  const who = text => diary.find(e => e.text === text)?.who;
  assert.equal(who('a pull request merged'), 'The loading dock');
  assert.equal(who('another merged'), 'The market', "no who: today's name");
  assert.equal(who('its own news'), 'a', "an agent's news is its own");
  assert.equal(who('odd'), 'The market', 'a who that is not text: today\'s name');
});

test('a world whose animals() gives { cast, gags, play } gets its creatures and its gags', () => {
  const { dom, sdk } = load();
  const gag = { id: 'baa', needs: { cow: 1 }, steps: [{ wait: 100 }] };
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks({ animals: () => ({ cast: [{ kind: 'cow', count: 2 }], gags: [gag], play: [] }), roam: () => [{ x: 10, y: 50, w: 150, h: 40 }] })), prefs);
  view.mount(dom.make(), { still: true });
  assert.equal(view.animalsKit().list().length, 2);
});

// The engine running frame by frame, with its real crew lending farmers to the animals.
function live(world, agents, { warn = () => {} } = {}) {
  const dom = stubDom();
  let pending = null;
  dom.globals.requestAnimationFrame = cb => { pending = cb; return 1; };
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console: { ...console, warn }, Math, Date, JSON, Map, Set, Intl, ...dom.globals });
  vm.runInContext(`${code}\n;window.sdk = { withDefaults, engineScene, makePixelView };`, ctx);
  const sdk = window.sdk, view = sdk.makePixelView(sdk.withDefaults(world), { get: k => (k === 'sky' ? 'day' : null), set() {} }); // day: the animals awake whatever the clock says
  view.mount(dom.make(), { still: false });
  const sceneOf = list => sdk.engineScene(window.AgentvilleScene.toScene({ generatedAt: Date.now(), collisions: [], agents: list, repos: [{ path: '/c/x', name: 'x' }] }));
  view.update(sceneOf(agents));
  let now = 1000, errors = 0;
  const run = n => { for (let i = 0; i < n && pending; i++) { const cb = pending; pending = null; try { cb(now += 100); } catch { errors++; } } };
  return { view, dom, run, errors: () => errors, update: list => view.update(sceneOf(list)) };
}
const someone = (id, over = {}) => ({ id, name: id, kind: 'interactive', cwd: '/c/x', state: 'idle', feed: [], children: [], touching: [], ...over });
const PEN = () => [{ x: 10, y: 20, w: 180, h: 80 }];

test('a world with a gag written wrong keeps running, frame after frame', () => {
  const warns = [];
  const w = live(fourHooks({ animals: () => ({ cast: [{ kind: 'goat' }], gags: [{ id: 'bad', steps: [{ wait: 1 }] }] }), roam: PEN, avoid: () => [] }), [someone('p')], { warn: m => warns.push(m) });
  w.run(1500);
  const drawn = w.dom.calls.fillRect;
  w.run(100);
  assert.equal(w.errors(), 0);
  assert.ok(w.dom.calls.fillRect > drawn, 'still drawing');
  assert.equal(warns.filter(m => /gag bad was dropped/.test(m)).length, 1);
});

test('the real crew: a goat takes an idle farmer’s hat; the farmer gets work and has it back at once', () => {
  const seen = [];
  const hat = { id: 'hat', needs: { goat: 1, farmer: 'idle' }, steps: [{ go: 'goat', to: 'farmer' }, { wear: 'goat', what: 'hat', on: true }, { go: 'goat', to: 'away', run: true, ms: 3000 }, { chase: 'farmer', after: 'goat', ms: 3000 }, { wear: 'goat', what: 'hat', on: false }] };
  const w = live(fourHooks({ animals: () => ({ cast: [{ kind: 'goat' }], gags: [hat] }), roam: PEN, avoid: () => [], drawChar: (f, b) => { if (f.id === 'p') seen.push(Boolean(b.hatless)); } }), [someone('p')]);
  for (let i = 0; i < 1500 && !seen.at(-1); i++) w.run(1);
  assert.equal(seen.at(-1), true, 'the goat has its hat');
  w.update([someone('p', { state: 'working' })]);
  w.run(2);
  assert.equal(seen.at(-1), false, 'work came: its hat back');
  assert.equal(w.view.animalsKit().gagNow(), null);
});

test('the real crew: play borrows a farmer idle three minutes, but never one napping in its hammock', () => {
  const run = nap => {
    const at = [];
    const pet = { id: 'pet', needs: { farmer: 'idle', goat: 1 }, steps: [{ go: 'farmer', to: 'goat' }, { wait: 5000 }] };
    const w = live(fourHooks({ animals: () => ({ cast: [{ kind: 'goat' }], play: [pet] }), roam: PEN, avoid: () => [], drawChar: (f, b) => { if (f.id === 'p') at.push(`${Math.round(b.x)},${Math.round(b.y)}`); } }),
      [someone('p', nap ? { wakeAt: Date.now() + 3600_000 } : {})]);
    w.run(3000);
    return new Set(at);
  };
  assert.ok(run(false).size > 1, 'an idle farmer goes to play');
  assert.deepEqual([...run(true)], ['100,40'], 'a napping one stays put');
});

test('a world can name its season switch and its levels; any left out keep today\'s words', () => {
  const { sdk } = load();
  const named = sdk.withDefaults(fourHooks({ season: () => 'summer', seasonNames: { switch: 'Heat', spring: 'cool', summer: 'warm', autumn: 'hot', winter: 'steaming' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(named.seasonNames)), { switch: 'Heat', spring: 'cool', summer: 'warm', autumn: 'hot', winter: 'steaming' });
  const partial = sdk.withDefaults(fourHooks({ season: () => 'summer', seasonNames: { switch: 'Weather' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(partial.seasonNames)), { switch: 'Weather', spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' });
  assert.equal(sdk.withDefaults(fourHooks()).seasonNames.switch, 'Season');
});

test("the default HUD's switch shows the world's names", () => {
  const { sdk } = load();
  const names = { switch: 'Heat', spring: 'cool', summer: 'warm', autumn: 'hot', winter: 'steaming' };
  assert.match(sdk.defaultHud({ seasons: true, seasonMode: 'winter', seasonNames: names }), /Heat: steaming/);
  assert.match(sdk.defaultHud({ seasons: true, seasonMode: 'live', seasonNames: names }), /Heat: live/);
  assert.match(sdk.defaultHud({ seasons: true, seasonMode: 'autumn' }), /Season: autumn/);
});

test('season names that are not usable fall back to today\'s words', () => {
  const { sdk } = load();
  const defaults = { switch: 'Season', spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' };
  for (const bad of ['Heat', ['Heat'], null, 5, undefined]) {
    assert.deepEqual(JSON.parse(JSON.stringify(sdk.withDefaults(fourHooks({ seasonNames: bad })).seasonNames)), defaults);
  }
  const odd = sdk.withDefaults(fourHooks({ seasonNames: { switch: 5, spring: undefined, summer: null, autumn: '   ', winter: 'x'.repeat(40) } })).seasonNames;
  assert.deepEqual(JSON.parse(JSON.stringify(odd)), { ...defaults, winter: 'x'.repeat(24) });
});

/** The title the board's dialog gets when a world's 'board' building is clicked (a mounted world, its canvas clicked). */
function boardTitleShown(world) {
  const { window, dom, sdk } = load();
  const els = {}, dlgEls = {}, host = dom.make();
  let click = null;
  els['.px-dlg'] = { querySelector: sel => (dlgEls[sel] ??= {}), open: false, showModal() {}, close() {}, contains: () => false };
  els['.px-help'] = Object.assign(dom.make(), { contains: () => false });
  host.querySelector = sel => (els[sel] ??= dom.make());
  host.addEventListener = (type, fn) => { if (type === 'click') click = fn; };
  const view = sdk.makePixelView(sdk.withDefaults({ ...world, buildingAt: () => 'board' }), prefs);
  view.mount(host, { still: true });
  view.update(sdk.engineScene(twoAgents(window)));
  const canvas = els.canvas;
  canvas.closest = () => null; // nothing of the HUD's under the pointer: the canvas itself
  click({ target: canvas, clientX: 399, clientY: 1, button: 0, stopPropagation() {} });
  return dlgEls['.px-dlg-title']?.textContent;
}

test("a world can title its notice board (boardTitle): today's title by default; anything but a string with words in it falls back; set as text", () => {
  const { sdk } = load();
  const TODAY = 'The notice board: what your projects remember';
  assert.equal(sdk.withDefaults(fourHooks()).boardTitle, TODAY);
  assert.equal(sdk.withDefaults(fourHooks({ boardTitle: '  The manuals shelf: what your projects remember ' })).boardTitle, 'The manuals shelf: what your projects remember', 'trimmed');
  for (const bad of [5, null, undefined, [], {}, '   ', () => 'x']) assert.equal(sdk.withDefaults(fourHooks({ boardTitle: bad })).boardTitle, TODAY, `${String(bad)}: today's`);
  const long = sdk.withDefaults(fourHooks({ boardTitle: 'x'.repeat(200) })).boardTitle;
  assert.ok(long.length <= 80 && long.startsWith('xxx'), `cut to 80 at most (${long.length})`);
  assert.equal(boardTitleShown(fourHooks()), TODAY, "the board's dialog, by default");
  assert.equal(boardTitleShown(fourHooks({ boardTitle: 'The manuals shelf: what your projects remember' })), 'The manuals shelf: what your projects remember', "the world's own");
  assert.equal(boardTitleShown(fourHooks({ boardTitle: '<b>x</b>' })), '<b>x</b>', 'HTML in it is text: the title is set as textContent');
});

/** An element of a stand-in page that keeps what is set on it and finds the same child for a selector again. */
function keepingEl(make) {
  const kids = new Map();
  return new Proxy({}, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      if (k === 'querySelector') return sel => { if (!kids.has(sel)) kids.set(sel, keepingEl(make)); return kids.get(sel); };
      if (k === 'insertAdjacentHTML') return (where, html) => { t.innerHTML = `${t.innerHTML ?? ''}${html}`; };
      if (k === 'parentElement') return (t.parentElement = keepingEl(make));
      if (k === 'style') return (t.style = {});
      if (k === 'getContext') return () => make();
      if (k === 'clientWidth') return 360;
      return (t[k] = make());
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

test("the field close-up names the world's repo: its header, its label and its errors (the farm's word is field)", async () => {
  for (const [repo, Repo] of [['bay', 'Bay'], ['field', 'Field'], ['<i>pod</i>', '&lt;i&gt;pod&lt;/i&gt;']]) {
    const { dom, sdk } = load();
    let back = null;
    dom.document.createElement = () => (back = keepingEl(dom.make));
    const view = { nouns: { agent: 'robot', agents: 'robots', repo, repos: `${repo}s`, place: 'factory' }, field: () => ({ name: 'shop' }), isStill: () => true, farmerName: () => null, farmerColor: () => '#000000' };
    const field = sdk.makeField(view);
    field.setOptions({ request: async () => ({ ok: false, status: 0, error: 'it is down' }) });
    field.open('/c/shop');
    const html = String(back.innerHTML);
    const word = repo.startsWith('<') ? '&lt;i&gt;pod&lt;/i&gt;' : repo;
    assert.match(html, new RegExp(`<b>shop ${word}</b>`), `the header: shop ${repo}`);
    assert.match(html, new RegExp(`aria-label="${repo.startsWith('<') ? Repo : `${Repo} close-up`}`), `its label (${repo})`);
    if (repo.startsWith('<')) { assert.ok(!html.includes('<i>pod'), 'the noun is escaped'); continue; }
    await new Promise(r => setTimeout(r, 0));
    const shown = String(back.querySelector('canvas').parentElement.querySelector('.fv-ov').innerHTML);
    assert.match(shown, new RegExp(`Could not load the ${repo}: it is down`), `its error (${repo})`);
  }
});

test('a season name holding HTML is escaped in the default HUD', () => {
  const { sdk } = load();
  const names = sdk.withDefaults(fourHooks({ seasonNames: { switch: '<b>x</b>' } })).seasonNames;
  const html = sdk.defaultHud({ seasons: true, seasonMode: 'live', seasonNames: names });
  assert.ok(!html.includes('<b>x'));
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;: live/);
});

// panelHud: the farm's panel and buttons, for any world, in its words. The engine's clicks find the buttons by these.
const PANEL_ATTRS = ['data-farm-panel', 'data-farm-state="waiting"', 'data-farm-state="working"', 'data-farm-need', 'data-farm-nav="list"', 'data-farm-nav="worlds"', 'data-farm-nav="session"', 'data-farm-nav="setup"', 'data-farm-nav="side"', 'data-farm-nav="theme"',
  'data-farm-follow', 'data-farm-resting', 'data-farm-bubbles', 'data-farm-animals', 'data-farm-sky', 'data-farm-season', 'data-farm-motion', 'data-farm-bell', 'data-farm-help', 'data-farm-zoom="-1"', 'data-farm-zoom="0"', 'data-farm-zoom="1"'];
const panelOf = (sdk, seasonMode, words) => sdk.panelHud({
  seasonMode, seasons: true, animals: true, seasonNames: { switch: 'Heat', spring: 'cool', summer: 'warm', autumn: 'hot', winter: 'steaming' },
  scene: { plan: { windows: [{ kind: 'five_hour', percentUsed: 30 }] }, chrome: { counts: { waiting: 1, working: 1 } }, farmers: [{ id: 'a', state: 'waiting', cost: 2, compactions: 3 }, { id: 'b', state: 'working' }] },
  season: 'summer', iconImg: name => `<i data-icon="${name}"></i>`, seasonIcon: s => `heat-${s}`, seasonTip: mode => `the heat, ${mode}`,
}, words);

test("panelHud in a factory's words: no farm word anywhere a person reads, and every data-farm-* button kept", () => {
  const { sdk } = load();
  for (const mode of ['live', 'winter']) {
    const html = panelOf(sdk, mode, { place: 'factory', agents: 'robots', compactedWord: 'built' });
    assert.match(html, /3 built/);
    const read = html.replace(/data-farm-[\w-]+/g, ''); // what a person reads: the attributes the engine clicks by aside
    assert.doesNotMatch(read, /farm/i, mode);
    assert.doesNotMatch(read, /harvest/i, mode);
    for (const attr of PANEL_ATTRS) assert.ok(html.includes(attr), `${mode}: ${attr}`);
  }
  // the world's names for its switch and levels, on the switch and the panel's line (its words as a screen reader reads them)
  const season = html => { const [, title, inner] = /class="px-season" title="([^"]*)">([\s\S]*?)<\/span><\/div>/.exec(html); return { title, icon: /data-icon="([^"]*)"/.exec(inner)[1], text: [...inner.matchAll(/class="px-sr">([^<]*)</g)].map(m => m[1]).join(' ') }; };
  const live = panelOf(sdk, 'live', {}), held = panelOf(sdk, 'winter', {});
  assert.match(live, /class="px-sr">Heat: live</);
  assert.deepEqual({ ...season(live) }, { title: 'the heat, live', icon: 'heat-summer', text: 'warm' });
  assert.match(held, /class="px-sr">Heat: steaming</);
  assert.deepEqual({ ...season(held) }, { title: 'the heat, winter', icon: 'heat-winter', text: 'steaming · 5-hour 30%' });
  assert.match(held, /📌/);
});

test('panelHud in a world without seasons: no season on the panel, no Season switch; given only its scene, it still draws', () => {
  const { sdk } = load();
  const html = sdk.panelHud({ seasons: false, scene: { farmers: [] } });
  assert.ok(!html.includes('px-season') && !html.includes('data-farm-season'));
  for (const attr of PANEL_ATTRS.filter(a => !['data-farm-season', 'data-farm-animals', 'data-farm-need', 'data-farm-state="waiting"', 'data-farm-state="working"'].includes(a))) assert.ok(html.includes(attr), attr);
});

test("panelHud: a world's words holding HTML or quotes stay text", () => {
  const { sdk } = load();
  const html = panelOf(sdk, 'live', { costTip: 'a "quoted" <b>tip</b>', helpTip: 'help" onclick="x', compactedWord: '<i>made</i>', costIcon: 'coin" onclick="x' });
  assert.ok(!html.includes('<b>tip') && !html.includes('<i>made') && !html.includes('" onclick'), 'escaped');
  assert.match(html, /title="a &quot;quoted&quot; &lt;b&gt;tip&lt;\/b&gt;"/);
});

test('mounting a world with animals reports its cast through opts.onCast; the view hands chatter to the kit', () => {
  const { dom, sdk } = load();
  const casts = [];
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks({ animals: () => [{ kind: 'cow', name: 'Cow' }], roam: () => [{ x: 10, y: 50, w: 150, h: 40 }] })), prefs);
  view.mount(dom.make(), { still: true, onCast: list => casts.push(list) });
  assert.deepEqual(plain(casts), [[{ kind: 'cow', name: 'Cow' }]]);
  view.chatter([{ kind: 'cow', when: 'idle', text: 'hi from the helper' }]);
  assert.deepEqual(plain(view.animalsKit().freshLines()), ['hi from the helper']);
  const none = sdk.makePixelView(sdk.withDefaults(fourHooks()), prefs);
  const noCasts = [];
  none.mount(dom.make(), { still: true, onCast: list => noCasts.push(list) });
  assert.deepEqual(noCasts, [], 'no animals: no cast');
  none.chatter([{ kind: 'cow', when: 'idle', text: 'x' }]); // no kit: nothing happens, nothing throws
});

test('with the Animals switch off, the world reports no animals (so no lines are written for them)', () => {
  const { dom, sdk } = load();
  const casts = [];
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks({ animals: () => [{ kind: 'cow', name: 'Cow' }], roam: () => [{ x: 10, y: 50, w: 150, h: 40 }] })), { get: k => (k === 'animals' ? 'off' : null), set() {} });
  view.mount(dom.make(), { still: true, onCast: list => casts.push(list) });
  assert.deepEqual(plain(casts), [[]]);
});

/* ---------- messages between agents: how one travels ---------- */

/**
 * The engine running frame by frame (100 ms each) with a message from a (working, at 60,90) to b (on the
 * porch, at 100,40), and what each frame draws while it travels: the fills between the last agent's
 * drawFx and the world's weather, which the engine calls just before and just after drawing it (nothing
 * else is drawn between them here: no particles). `extra` goes in the world's hooks.
 */
function flying(extra = {}) {
  const dom = stubDom();
  let pending = null;
  dom.globals.requestAnimationFrame = cb => { pending = cb; return 1; };
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  const ctx = vm.createContext({ window, document: dom.document, console, Math, Date, JSON, Map, Set, Intl, ...dom.globals });
  vm.runInContext(`${code}\n;window.sdk = { withDefaults, engineScene, makePixelView, PXG };`, ctx);
  const sdk = window.sdk, frames = [];
  const world = fourHooks({ drawFx() { dom.calls.record = []; }, weather() { frames.push({ T: sdk.PXG.T, fills: dom.calls.record ?? [] }); dom.calls.record = null; }, ...extra });
  const view = sdk.makePixelView(sdk.withDefaults(world), { get: k => (k === 'sky' ? 'day' : null), set() {} });
  view.mount(dom.make(), { still: false });
  const at = Date.now();
  view.update(sdk.engineScene(window.AgentvilleScene.toScene({ generatedAt: at, collisions: [], repos: [{ path: '/c/x', name: 'x' }], agents: [
    { id: 'a', name: 'a', kind: 'interactive', cwd: '/c/x', state: 'working', feed: [{ kind: 'peer', dir: 'out', other: 'b', at: at - 1000, text: 'The API is ready' }], children: [], touching: [] },
    { id: 'b', name: 'b', kind: 'interactive', cwd: '/c/x', state: 'waiting', ask: 'ok?', feed: [], children: [], touching: [] }] })));
  let now = 1000;
  /** Runs n frames; what the last one drew while the message travelled: { T, fills }. */
  const run = n => { for (let i = 0; i < n && pending; i++) { const cb = pending; pending = null; cb(now += 100); } return plain(frames.at(-1)); };
  return { run };
}

// The pigeon as the engine drew it before a world could draw its own way (recorded on that code, 2026-10-10):
// at T 0, 0.3, 1.2, 2.0 and 2.3 of its 2.4 s (its wing down, up, down, down, up), each fill's colour and rectangle.
const PIGEON = [
  { T: 0, fills: [['#e6eef5', 57, 74, 6, 3], ['#e6eef5', 62, 72, 2, 2], ['#f08a24', 64, 73, 1, 1], ['#1b1420', 63, 72, 1, 1], ['#9aa4ad', 58, 75, 4, 1], ['#f4ecd8', 59, 77, 3, 2], ['#e04a3a', 60, 78, 1, 1]] },
  { T: 0.3, fills: [['#e6eef5', 58, 59, 6, 3], ['#e6eef5', 63, 57, 2, 2], ['#f08a24', 65, 58, 1, 1], ['#1b1420', 64, 57, 1, 1], ['#9aa4ad', 59, 57, 4, 1], ['#f4ecd8', 60, 62, 3, 2], ['#e04a3a', 61, 63, 1, 1]] },
  { T: 1.2, fills: [['#e6eef5', 77, 15, 6, 3], ['#e6eef5', 82, 13, 2, 2], ['#f08a24', 84, 14, 1, 1], ['#1b1420', 83, 13, 1, 1], ['#9aa4ad', 78, 16, 4, 1], ['#f4ecd8', 79, 18, 3, 2], ['#e04a3a', 80, 19, 1, 1]] },
  { T: 2, fills: [['#e6eef5', 95, 10, 6, 3], ['#e6eef5', 100, 8, 2, 2], ['#f08a24', 102, 9, 1, 1], ['#1b1420', 101, 8, 1, 1], ['#9aa4ad', 96, 11, 4, 1], ['#f4ecd8', 97, 13, 3, 2], ['#e04a3a', 98, 14, 1, 1]] },
  { T: 2.3, fills: [['#e6eef5', 97, 20, 6, 3], ['#e6eef5', 102, 18, 2, 2], ['#f08a24', 104, 19, 1, 1], ['#1b1420', 103, 18, 1, 1], ['#9aa4ad', 98, 18, 4, 1], ['#f4ecd8', 99, 23, 3, 2], ['#e04a3a', 100, 24, 1, 1]] },
];
const PIGEON_COLOURS = new Set(PIGEON.flatMap(f => f.fills.map(r => r[0])));

test("the engine's carrier pigeon, call for call: a world with no flight hook draws today's", () => {
  const { run } = flying();
  const seen = [run(1), run(3), run(9), run(8), run(3)].map(f => ({ T: Math.round(f.T * 10) / 10, fills: f.fills }));
  assert.deepEqual(seen, PIGEON);
  const after = run(2); // 2.5 s: it has landed (a ✉ pops, with a few sparks of its own)
  assert.equal(after.fills.filter(r => PIGEON_COLOURS.has(r[0])).length, 0, 'gone once it lands');
});
