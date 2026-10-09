// A world run headless, for check-world and its tests: the SDK and a world's world.js in a node:vm context,
// with a stand-in DOM and canvases that record what they draw. Each stop of the tour (web/worlds/test/tour.js)
// is given to the world as the page would give it, frames are stepped by hand, and every exception is caught
// with its file and line; a hook that never returns is cut off. The world's creatures (its animals() hook)
// are checked against the animals kit's rules. No dependencies. Not a sandbox: a vm context keeps the world's
// names apart from ours, not its reach (docs/worlds.md, "check-world").
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';
import { checkWorldJson } from '../../collector/worlds.mjs';
import { ROOT } from './worlds-dir.mjs';

const WEB = join(ROOT, 'web');
// The frame's scripts before world.js, in frame.html's order (the animals kit's when it is there); scene.js
// too, for toScene and privateScene, as the page has them.
const SDK = ['scene.js', 'brand.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js'].filter(f => existsSync(join(WEB, f)));
const REQUIRED = ['W', 'slots', 'drawChar', 'bg', 'grid'];
const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const NUMBERS = new Set(['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight', 'width', 'height', 'length', 'size']);

// The animals kit's rules (docs/worlds.md, "Creatures"). The effects the engine draws for an action
// (engine.js, showFx); the poses every creature is drawn in, and the duck's and the ostrich's own
// (creatures.js); the looks a kind has (the duck's, creatures.js); 40 characters a line (animals.js, LINE_MAX).
const FX = ['hearts', 'crumbs', 'dust'];
const POSES = ['stand', 'walk', 'run', 'eat', 'sleep', 'happy'];
const POSES_OF = { duck: [...POSES, 'swim', 'dabble'], ostrich: [...POSES, 'hide'] };
const LOOKS_OF = { duck: ['drake', 'hen', 'duckling'] };
const LINE_MAX = 40, COUNT_MAX = 12, ACTIONS = [2, 4];

/**
 * What breaks the animals kit's rules in what a world's animals() returns (a list of creatures, or
 * `{ cast }` with the list in it), one problem a line, each starting with the creature's kind. `kinds`:
 * the library's (CREATURES); `taken`: world.json's. Plain data in (functions and undefined are gone).
 */
export function creatureProblems(value, { kinds, taken = [] }) {
  if (value == null) return [];
  const cast = Array.isArray(value) ? value : Array.isArray(value?.cast) ? value.cast : null;
  if (!cast) return ['animals(): it returns a list of creatures, or { cast: [...] }'];
  const out = [], num = v => typeof v === 'number' && Number.isFinite(v), isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  cast.forEach((c, i) => {
    if (!isObj(c)) { out.push(`creature ${i + 1}: not an object { kind, actions, lines, … }`); return; }
    const known = kinds.includes(c.kind), who = typeof c.kind === 'string' && c.kind ? c.kind : `creature ${i + 1}`;
    const say = m => out.push(`${who}: ${m}`);
    if (!known) say(`${c.kind === undefined ? 'no kind' : `no creature called ${JSON.stringify(c.kind)}`}: the library has ${kinds.join(', ')}`);
    else if (taken.includes(c.kind)) say(`world.json's "taken" lists it: this world draws data in that shape, so its animals can't be one`);
    if (c.count != null && !(Number.isInteger(c.count) && c.count >= 1 && c.count <= COUNT_MAX)) say(`count is ${JSON.stringify(c.count)}: a whole number from 1 to ${COUNT_MAX}`);
    if (c.looks != null && known) {
      const own = LOOKS_OF[c.kind] ?? [];
      if (!Array.isArray(c.looks)) say('looks is a list, one look per creature');
      else for (const l of new Set(c.looks)) if (!own.includes(l)) say(own.length ? `look ${JSON.stringify(l)} isn't one of the ${c.kind}'s (${own.join(', ')})` : `look ${JSON.stringify(l)}: the ${c.kind} has no looks`);
    }
    const lines = isObj(c.lines) ? c.lines : {};
    if (c.lines != null && !isObj(c.lines)) say('lines is { idle: [...], <key>: [...] }');
    const actions = Array.isArray(c.actions) ? c.actions : [];
    if (actions.length < ACTIONS[0] || actions.length > ACTIONS[1]) say(`${actions.length} action${actions.length === 1 ? '' : 's'} in its menu; a creature has ${ACTIONS[0]} to ${ACTIONS[1]}`);
    const poses = POSES_OF[c.kind] ?? POSES;
    actions.forEach((a, k) => {
      if (!isObj(a)) { say(`action ${k + 1}: not an object { label, fx?, pose?, line? }`); return; }
      const labelled = typeof a.label === 'string' && a.label.trim() !== '', name = labelled ? `action ${JSON.stringify(a.label)}` : `action ${k + 1}`;
      if (!labelled) say(`${name} has no label`);
      if (a.fx != null && !FX.includes(a.fx)) say(`${name}: fx ${JSON.stringify(a.fx)} isn't one of ${FX.join(', ')}`);
      if (a.pose != null && known && !poses.includes(a.pose)) say(`${name}: pose ${JSON.stringify(a.pose)} isn't one the ${c.kind} has (${poses.join(', ')})`);
      if (a.line != null && !Object.hasOwn(lines, a.line)) say(`${name}: line ${JSON.stringify(a.line)} isn't a key of lines`);
    });
    for (const [key, list] of Object.entries(lines)) {
      if (!Array.isArray(list)) { say(`lines.${key} is a list of lines`); continue; }
      for (const t of list) if (String(t).length > LINE_MAX) say(`lines.${key} has a line of ${String(t).length} characters (${LINE_MAX} at most): ${JSON.stringify(String(t))}`);
    }
    if (c.home != null && !(isObj(c.home) && ['x', 'y', 'w', 'h'].every(k => num(c.home[k])))) say('home is { x, y, w, h }, in numbers');
    if (c.bank != null && !(Array.isArray(c.bank) && c.bank.every(b => Array.isArray(b) && b.length === 2 && b.every(num)))) say('bank is a list of [x, y]');
  });
  return out;
}

/** A stand-in DOM: every element a Proxy that takes any call; a canvas's 2D context records its fills and images. */
function stubDom(log) {
  // A canvas's own ops identify it when drawn onto another (a sprite, the ground): hashed once per change, and
  // kept only up to a cap (the main canvas, drawn every frame, would grow without end; nothing draws it elsewhere).
  const OPS_MAX = 50_000;
  const sigOf = img => {
    if (!img?.__ops) return '?';
    if (img.__hashedLen !== img.__ops.length) { img.__hash = hash(JSON.stringify(img.__ops)); img.__hashedLen = img.__ops.length; }
    return img.__hash;
  };
  const context = owner => new Proxy({ fillStyle: '#000000', globalAlpha: 1 }, {
    get: (t, k) => {
      const put = op => { if (owner.__ops.length < OPS_MAX) owner.__ops.push(op); log.push(op); };
      if (k === 'fillRect') return (x, y, w, h) => put(['r', String(t.fillStyle), t.globalAlpha, x, y, w, h]);
      if (k === 'clearRect') return (x, y, w, h) => put(['c', x, y, w, h]);
      if (k === 'drawImage') return (img, ...a) => put(['i', sigOf(img), ...a.map(Number)]);
      if (k === 'measureText') return () => ({ width: 0 });
      if (k in t) return t[k];
      return () => make(); // anything else (a gradient, a pattern, getImageData): a stand-in that takes any call
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const make = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === '__ops') return (t.__ops ??= []);
      if (k === '__hash' || k === '__hashedLen') return t[k];
      if (NUMBERS.has(k)) return t[k] ?? (k === 'offsetWidth' || k === 'width' ? 400 : k === 'offsetHeight' || k === 'height' ? 300 : 0);
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0 });
      if (k === 'style') return (t[k] ??= { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }); // the engine sets a bubble's custom properties
      if (k === 'dataset') return (t[k] ??= {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'isConnected') return true;
      if (k === 'hidden' || k === 'open') return t[k] ?? false;
      if (k === 'getContext') return () => { t.__ops ??= []; return (t.__ctx ??= context(t)); };
      if (k === 'querySelectorAll') return () => [];
      return (t[k] ??= make());
    },
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => make(),
  });
  return { make, document: Object.assign(make(), { hidden: false }) };
}

function tour() {
  const g = {};
  g.window = g;
  vm.runInContext(readFileSync(join(WEB, 'worlds', 'test', 'tour.js'), 'utf8'), vm.createContext(g));
  return JSON.parse(JSON.stringify({ NOW: g.AgentvilleTour.NOW, stops: g.AgentvilleTour.stops, checks: g.AgentvilleTour.checks }));
}

export async function checkWorld({ dir, file = 'world.js', frames = 8, timeoutMs = 2000 } = {}) {
  const out = { errors: [], defaults: [], same: [], unknown: [], creatures: [], notes: [], json: null, ran: 0 };
  let taken = [];
  try {
    const j = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
    out.json = checkWorldJson(j);
    if (Array.isArray(j?.taken)) taken = j.taken;
  } catch (err) { out.json = err.code === 'ENOENT' ? 'world.json is missing.' : `world.json can't be read: ${err.message}`; }
  const worldPath = join(dir, file);
  const at = (path, line, col) => `${path === worldPath ? file : relative(WEB, path)}:${line}${col ? `:${col}` : ''}`;
  // Where an exception came from: world.js's line if it is in the stack, else the SDK's (never this harness's own).
  const whereOf = err => {
    const stack = String(err?.stack ?? '');
    const top = stack.match(/^(\/[^\n]*?):(\d+)\n/); // a script that doesn't parse: its file and line come first
    if (top) return at(top[1], top[2]);
    const found = [...stack.matchAll(/\(?(\/[^\s()]+):(\d+):(\d+)\)?/g)].filter(m => m[1] === worldPath || m[1].startsWith(WEB + sep));
    const f = found.find(m => m[1] === worldPath) ?? found[0];
    return f ? at(f[1], f[2], f[3]) : '';
  };
  let doing = 'running world.js'; // what the world was doing, for a hook cut off (its stack names no line)
  const timedOut = err => err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
  const problem = err => ({ message: timedOut(err) ? `a hook didn't return within ${timeoutMs / 1000} s (a loop?), while ${doing}` : `${err?.name ?? 'Error'}: ${err?.message ?? err}`, where: whereOf(err) });

  let worldCode;
  try { worldCode = readFileSync(worldPath, 'utf8'); } catch { out.errors.push({ stop: '(loading)', message: `${file} is missing.`, where: '' }); return out; }
  let worldScript;
  try { worldScript = new vm.Script(worldCode, { filename: worldPath }); } catch (err) { out.errors.push({ stop: '(loading)', ...problem(err) }); return out; }
  const sdk = SDK.map(f => new vm.Script(readFileSync(join(WEB, f), 'utf8'), { filename: join(WEB, f) }));
  const { NOW, stops, checks } = tour(), sigs = new Map(), unknown = new Set();
  let current = '(loading)', timeouts = 0, creaturesChecked = false;
  const onRejection = err => { // once per stop: a promise that fails every frame is one problem
    const e = { stop: current, message: `a promise failed: ${err?.message ?? err}`, where: whereOf(err) };
    if (!out.errors.some(x => x.stop === e.stop && x.message === e.message && x.where === e.where)) out.errors.push(e);
  };
  process.on('unhandledRejection', onRejection);
  try {
    for (const stop of stops) {
      current = stop.name;
      // Each stop a task of its own, never inside a promise callback: a hook cut off there would leave Node's
      // bookkeeping of async callbacks half done.
      const r = await new Promise((resolve, reject) => setImmediate(() => { try { resolve(runStop(stop)); } catch (err) { reject(err); } }));
      out.ran++;
      for (const u of r.unknown ?? []) unknown.add(u);
      if (r.defaults && !out.defaults.length) out.defaults = r.defaults;
      if (r.error) {
        out.errors.push({ stop: stop.name, ...r.error });
        if (r.fatal) break;
        if (r.timeout && ++timeouts >= 3) { out.errors.push({ stop: '(stopped)', message: "three stops had a hook that didn't return: the rest of the tour was skipped", where: '' }); break; }
      } else sigs.set(stop.name, r.sig);
      await new Promise(resolve => setImmediate(resolve)); // a promise the world left failing is reported against this stop
    }
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  for (const [item, a, b] of checks) if (sigs.has(a) && sigs.has(b) && sigs.get(a) === sigs.get(b)) out.same.push(`${item}: "${b}" draws the same as "${a}"`);
  out.unknown = [...unknown].sort();
  return out;

  /**
   * The world's creatures, once (the first stop that registers): what its animals() returns, read inside the
   * vm under the timeout and as plain data, so neither a loop nor a getter can hang this. A hook that throws
   * or never returns is left to the stops, which report it (the engine calls animals() as the world starts).
   */
  function checkCreatures(hooks, call, g) {
    if (creaturesChecked || !hooks || typeof hooks.animals !== 'function') return;
    creaturesChecked = true;
    let value;
    try { value = JSON.parse(call(() => JSON.stringify(hooks.animals() ?? null), 'giving its animals') ?? 'null'); } catch { return; }
    out.creatures = creatureProblems(value, { kinds: Object.keys(g.CREATURES ?? {}), taken });
    const cast = Array.isArray(value) ? value : Array.isArray(value?.cast) ? value.cast : [];
    if (typeof hooks.roam !== 'function' && cast.some(c => !c?.home)) out.notes.push("no roam(): its creatures aren't shown");
  }

  /** One stop in a fresh context: the SDK, the world, its start, the stop's snapshots, a few frames each; the last frame's drawing as a signature. */
  function runStop(stop) {
    const log = [], dom = stubDom(log), queued = [];
    let seed = 7, now = 0;
    const handlers = {};
    const g = {
      document: dom.document, console: { log() {}, info() {}, warn() {}, error() {} },
      Math: Object.assign(Object.create(Math), { random: () => (seed = (seed * 16807) % 2147483647) / 2147483647 }),
      Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
      requestAnimationFrame: fn => queued.push(fn), cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
      ResizeObserver: class { observe() {} disconnect() {} }, Image: class {}, Path2D: class {}, performance: { now: () => now },
      addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), devicePixelRatio: 1,
      getComputedStyle: () => ({ getPropertyValue: () => '' }), location: { origin: 'null', search: '' },
      Agentville: { raw: (h, o) => { Object.assign(handlers, h); handlers.raw = !o?.engine; }, send() {} },
    };
    g.window = g;
    // The world's promise callbacks run in each call, under its timeout: a chain of them that never ends is cut off too.
    const ctx = vm.createContext(g, { microtaskMode: 'afterEvaluate' });
    const call = (fn, what) => { doing = what; g.__job = fn; return vm.runInContext('__job()', ctx, { timeout: timeoutMs, filename: 'check-world' }); };
    const unknownOf = () => [...(g.Agentville.people?.unknown ?? [])];
    const fail = (err, fatal = false) => ({ error: problem(err), fatal, timeout: timedOut(err), unknown: unknownOf() });
    try { for (const s of sdk) s.runInContext(ctx, { timeout: timeoutMs }); }
    catch (err) { return { error: { message: `check-world couldn't load the SDK: ${err?.message ?? err}`, where: whereOf(err) }, fatal: true }; }
    vm.runInContext('(() => { const real = window.Agentville.world; if (real) window.Agentville.world = hooks => { window.__hooks = hooks; return real(hooks); }; })();', ctx);
    doing = 'running world.js';
    try { worldScript.runInContext(ctx, { timeout: timeoutMs }); } catch (err) { return fail(err, true); }
    if (!handlers.start) return { error: { message: 'world.js never registered: it must call Agentville.world(hooks) or Agentville.raw(handlers).', where: file }, fatal: true };
    const defaults = g.__hooks ? JSON.parse(JSON.stringify(vm.runInContext('Object.keys(withDefaults({ W: 1, slots() {}, drawChar() {}, bg() {} }))', ctx))).filter(k => !REQUIRED.includes(k) && !(k in g.__hooks)) : [];
    checkCreatures(g.__hooks, call, g);
    const prefs = { sky: stop.sky };
    const opts = {
      still: false, navState: () => ({}), request: () => new Promise(() => {}), // made-up answers are the test page's; here a request waits
      onPickAgent() {}, onOpenDoc() {}, onShowRepos() {}, onStartSession() {}, onNav() {}, onBell() {}, onMotion() {}, onDiary() {},
    };
    const step = n => { for (let i = 0; i < n; i++) { now += 40; for (const fn of queued.splice(0)) call(() => fn(now), 'drawing a frame'); } };
    try {
      call(() => handlers.start({ el: dom.make(), opts, prefs: { get: k => prefs[k] ?? null, set: (k, v) => { prefs[k] = String(v); } } }), 'starting');
      for (let i = 0; i < 2; i++) { // every stop runs the same number of frames, so two stops differ only by what they show
        const snap = stop.frames[i];
        if (snap) call(() => { const s = g.AgentvilleScene.toScene(snap); handlers.scene(stop.private ? g.AgentvilleScene.privateScene(s) : s); }, 'taking a scene');
        step(frames);
      }
      log.length = 0;
      step(1);
    } catch (err) { return { ...fail(err), defaults }; }
    return { sig: hash(JSON.stringify(log)), defaults, unknown: unknownOf() };
  }
}
