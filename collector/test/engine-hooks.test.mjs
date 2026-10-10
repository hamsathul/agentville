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
  const calls = { fillRect: 0 };
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
      if (k === 'fillRect') return () => { calls.fillRect++; };
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
  vm.runInContext(`${code}\n;window.sdk = { makeGrid, withDefaults, engineScene, makePixelView, ACTIVE, defaultHud, PXG, fitClear };`, ctx);
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

test("the default HUD is one Menu at the top right: its button opens and shuts it, and it holds the dashboard's buttons (Broadcast too), the switches and zoom", () => {
  const w = mounted(fourHooks());
  const at = s => w.hud().indexOf(s);
  assert.match(w.hud(), /^<div class="px-nav"><button type="button" data-farm-menu aria-expanded="false"/);
  assert.match(w.hud(), /class="px-menu" role="group" aria-label="Menu" hidden>/);
  for (const attr of ['data-farm-nav="list"', 'data-farm-nav="worlds"', 'data-farm-nav="side"', 'data-farm-nav="broadcast"', 'data-farm-sky', 'data-farm-motion', 'data-farm-help', 'data-farm-zoom="1"']) assert.ok(at(attr) > at('class="px-menu"'), `${attr} is in the menu`);
  assert.doesNotMatch(w.hud(), /px-tools/, 'no row of switches along the bottom: the world has its foot back');
  w.click('data-farm-menu');
  assert.match(w.hud(), /data-farm-menu aria-expanded="true"/);
  assert.doesNotMatch(w.hud(), /class="px-menu"[^>]*hidden/);
  w.click('data-farm-menu');
  assert.match(w.hud(), /class="px-menu"[^>]*hidden/);
  w.click('data-farm-menu');
  w.click('data-farm-sky'); // in the harness a click is never inside the menu: one elsewhere shuts it
  assert.match(w.hud(), /class="px-menu"[^>]*hidden/);
});

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

test("labels are drawn again when the plan or the accounts change, not only the fields (the farm's silo tags show them)", () => {
  const { window, dom, sdk } = load();
  let drawn = 0;
  const view = sdk.makePixelView(sdk.withDefaults(fourHooks({ labels() { drawn++; } })), prefs);
  const withAccounts = week => sdk.engineScene(window.AgentvilleScene.toScene({ generatedAt: NOW, collisions: [], agents: [], repos: [{ path: '/c/x', name: 'x' }],
    plan: { windows: [{ kind: 'seven_day', percentUsed: 10, resetsAt: 1 }] },
    accounts: [{ key: 'main', name: 'work', plan: { windows: [{ kind: 'seven_day', percentUsed: 10, resetsAt: 1 }] } }, { key: 'home', name: 'home', plan: { windows: [{ kind: 'seven_day', percentUsed: week, resetsAt: 1 }] } }] }));
  view.mount(dom.make(), { still: true });
  view.update(withAccounts(40));
  const before = drawn;
  view.update(withAccounts(40));
  assert.equal(drawn, before, 'nothing changed: not drawn again');
  view.update(withAccounts(92));
  assert.ok(drawn > before, "home's week changed: drawn again");
});

// The farm's panel (358 × 415 on a laptop, plus its 10px margin and a 6px gap) lay over the barn and the
// silos whenever the frame had no room beside it: at 100% the world now sits clear of it.
test('at 100% the world sits clear of the panel over its top left: beside it or below it, whichever leaves it bigger', () => {
  const { sdk } = load();
  const W = 400, H = 318, open = { w: 374, h: 431 }, folded = { w: 216, h: 51 };
  const plain = (fw, fh) => Math.min((fw - 2) / W, (fh - 2) / H);
  const clearOf = (p, { fit, pad }, fw, fh) => pad.l * fit >= p.w - 6 || pad.t * fit >= p.h - 6;
  for (const [fw, fh, p, why] of [[1437, 898, open, 'a 16:10 window'], [1507, 980, open, "a 14″ MacBook's"], [1107, 966, open, 'the sidebar open'], [1107, 966, folded, 'the sidebar open, the panel folded'], [1915, 1078, open, 'a wide screen']]) {
    const got = sdk.fitClear(fw, fh, W, H, p);
    assert.ok(clearOf(p, got, fw, fh), `${why}: nothing of the world under the panel (${JSON.stringify(got)})`);
    assert.ok(got.fit <= plain(fw, fh) + 1e-9, `${why}: never bigger than the frame`);
    const beside = Math.min((fw - 2 - p.w) / W, (fh - 2) / H), below = Math.min((fw - 2) / W, (fh - 2 - p.h) / H);
    assert.ok(got.fit >= Math.max(beside, below) * 0.99, `${why}: no smaller than it needs to be (${got.fit} for ${Math.max(beside, below)})`);
    assert.ok(got.pad.l + got.pad.r >= 0 && got.pad.t + got.pad.b >= 0 && Number.isInteger(got.pad.l) && Number.isInteger(got.pad.t), `${why}: the spare room is whole world pixels`);
  }
  assert.equal(sdk.fitClear(1915, 1078, W, H, open).fit, plain(1915, 1078), 'with room beside the panel, the world keeps the size it had');
  assert.equal(sdk.fitClear(1107, 966, W, H, folded).fit, plain(1107, 966), 'below a folded panel, too');
  assert.deepEqual(sdk.fitClear(1437, 898, W, H, null), sdk.fitClear(1437, 898, W, H, { w: 0, h: 0 }), 'no panel: the plain fit');
  assert.equal(sdk.fitClear(1437, 898, W, H, null).fit, plain(1437, 898));
});

test('below the panel, the world keeps clear of the switches along the bottom too (two rows of them in a narrow frame)', () => {
  const { sdk } = load();
  const W = 400, H = 318, panel = { w: 374, h: 356 }, tools = 77, fw = 998, fh = 948;
  const { fit, pad } = sdk.fitClear(fw, fh, W, H, panel, tools);
  assert.ok(pad.t * fit >= panel.h - 6, `below the panel (${pad.t * fit})`);
  assert.ok((pad.t + H) * fit <= fh - tools + 6, `and its foot above the switches (${(pad.t + H) * fit} of ${fh - tools})`);
  const beside = Math.min((fw - 2 - panel.w) / W, (fh - 2) / H), below = Math.min((fw - 2) / W, (fh - 2 - panel.h - tools) / H);
  assert.ok(fit >= Math.max(beside, below) * 0.99, `no smaller than it needs to be (${fit})`);
  assert.deepEqual(sdk.fitClear(1437, 898, W, H, { w: 374, h: 431 }, tools), sdk.fitClear(1437, 898, W, H, { w: 374, h: 431 }), 'beside the panel, the switches lie over the forest at its foot, as they always have');
});
