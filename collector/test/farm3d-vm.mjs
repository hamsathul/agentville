// The SDK, the 2D farm and the tour in a vm, as the frame has them, for the 3D farm's tests (farm3d.test.mjs,
// farm3d-parity.test.mjs): the 2D farm's own functions (window.AgentvilleFarm, makeFarm's hooks) and the engine's
// globals (g('panelHud')…), to pin the 3D farm's copies of its rules against; the fixtures the tests share.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
export const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the vm have another realm's prototypes
function stubDom() { // enough of a DOM for the SDK and the farm to load (they draw nothing here)
  const make = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (['width', 'height', 'offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'length'].includes(k)) return t[k] ?? 0;
      if (k === 'style') return (t[k] ??= { setProperty() {}, removeProperty() {} });
      if (k === 'dataset') return (t[k] ??= {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'querySelectorAll') return () => [];
      if (k === 'measureText') return () => ({ width: 0 });
      return (t[k] ??= make());
    },
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => make(),
  });
  return Object.assign(make(), { hidden: false });
}
function load() {
  const window = { Agentville: { raw: () => {} } };
  const ctx = vm.createContext({ window, document: stubDom(), console, Math, Date, JSON, Map, Set, Intl, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} });
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js', 'worlds/farm/world.js', 'worlds/test/tour.js']) vm.runInContext(web(f), ctx, { filename: f });
  const g = name => vm.runInContext(name, ctx);
  const kit = { makeGrid: g('makeGrid'), engineScene: g('engineScene'), tagText: g('tagText'), cutMid: g('cutMid'), lastPart: g('lastPart'), ago: g('ago'), lookFor: window.Agentville.people.lookFor, pick: window.Agentville.people.pick };
  return { kit, g, src: web, farm: window.AgentvilleFarm, toScene: window.AgentvilleScene.toScene, stops: window.AgentvilleTour.stops };
}
export const { kit, g, src, farm, toScene, stops } = load();
/** The engine scene of a snapshot, as the 2D farm's hooks get it. */
export const engineOf = s => g('engineScene')(toScene(s));
/** A literal (object or array) from a web file's source, by its const name (`const NAME = {…};`), evaluated in a vm. */
export function literalOf(file, name) {
  const s = src(file), head = `const ${name} = `, start = s.indexOf(head) + head.length;
  if (start < head.length) throw new Error(`no const ${name} in ${file}`);
  let depth = 0, i = start, quote = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && !--depth) break;
  }
  return vm.runInNewContext(`(${s.slice(start, i + 1)})`);
}
export const NOW = Date.UTC(2026, 9, 9, 9, 0), HOME = '/Users/you/code';
export const touch = (repo, mode = 'write', lastAt = NOW) => ({ path: `${repo}/f.ts`, mode, lastAt, repo });
export const agent = (id, over = {}) => ({
  id, kind: 'interactive', name: id, cwd: `${HOME}/shop`, state: 'working', stateReason: 'busy', stateSince: NOW, feed: [], children: [], touching: [], contextTokens: 40_000,
  proc: { cpu: 5, rssMb: 300, pid: 1, childCount: 0, children: [] }, usage: { costUsd: 0.4 }, mode: 'default', model: 'claude-sonnet-5-5', fast: false, tasks: null, compactions: 0, mcp: [],
  now: { tool: 'Edit', summary: 'src/app.ts', step: 'edit', startedAt: NOW }, ...over,
});
export const repo = (name, over = {}) => ({ path: `${HOME}/${name}`, name, branch: 'main', dirty: 0, ahead: 0, behind: 0, lastDeploy: null, ...over });
export const snap = (agents, repos = []) => ({ generatedAt: NOW, agents, repos, collisions: [], settings: { cpuAlertPct: 90 } });
