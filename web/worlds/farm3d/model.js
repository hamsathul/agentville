// The 3D farm's model: the page's scene (version 1) turned into what the 3D farm draws (the beds, the farmers and
// where each stands, the season, the silos) by the 2D farm's own rules, so the two farms always agree. Pure: no
// three.js, no DOM. The frame's helpers come in as `kit` (makeGrid, engineScene, tagText, cutMid, lastPart, ago from
// the SDK; lookFor and pick from the people kit), so Node can test it (collector/test/farm3d.test.mjs pins every copy
// below against the farm's original).
import { BED, GRID_CONFIG, SILO_X, SPOT, slotTables } from './layout.js';
import { stallOf } from './dialogs.js';

// The states an agent is out and about in (engine.js, ACTIVE).
const ACTIVE = new Set(['waiting', 'working', 'turn']);
// How each prop is held: swung, carried, or held up (the rest).
const SWING = new Set(['hoe', 'rake', 'sickle', 'hammer']), CARRY = new Set(['crate', 'barrow', 'cart', 'parcel', 'mailbag']);

// copied from web/worlds/farm/world.js (the farm's clothes, crops, fences and soils)
const STRAW = [['#e9c46a', '#b5562f'], ['#e2c27a', '#3c5a99'], ['#f0d58c', '#2f6b2f'], ['#d4ad55', '#8e2b2b']]; // [hat, band]
const DYED = [['#d64545', '#8e2b2b'], ['#4f9d4a', '#2f6b2f'], ['#4a74c9', '#2c4a85'], ['#8a5fc0', '#5a3b85'], ['#ece6d6', '#9a9488'], ['#3a3a40', '#c9a24a'], ['#e58a2e', '#9a5212']];
const CODEX_CAPS = [['#5d7184', '#2a3644'], ['#4a7a8c', '#22404a'], ['#7a8a9c', '#3a4452'], ['#3f4f66', '#cfd8e3']]; // slate caps
const OVERALLS = ['#3c5a99', '#6b4f2a', '#4a4a52', '#2f6b4f', '#7a3b5a'];
const FARMER = { hat: ['straw', 'cap', 'beanie', 'bandana', 'none'], hatColors: { straw: STRAW, '*': DYED }, top: 'shirt', bottom: 'overalls', bottomColors: OVERALLS, extra: ['none', 'beard', 'glasses', 'cheeks'] };
const CODEX = { ...FARMER, hat: 'cap', hatColors: CODEX_CAPS };
export const CROPS = ['wheat', 'corn', 'carrot', 'cabbage', 'sunflower', 'tomato', 'pumpkin'];
const FENCES = ['#c98d4f', '#8a8f96', '#9c3b30', '#5f7f9a', '#6b8f4a', '#4e3626'];
const SOILS = ['#7a5230', '#6b4a35', '#86603a', '#7a4632', '#705a3a'];
const isMain = b => /^(main|master)$/.test(b ?? '');
export const FAMILY_PIN = { opus: '#8a5fc0', sonnet: '#3d7be0', haiku: '#2fa57a', fable: '#f08a24' };

// copied from web/worlds/farm/world.js (seasonOf, siloOf, weatherOf, growthStage)
/** The season by the plan's 5-hour limit: spring while it is fresh, then summer, autumn, and winter when it is nearly used up. No reading: summer. */
function seasonOf(plan) {
  const w = plan?.windows?.find(x => x.kind === 'five_hour');
  if (!w) return 'summer';
  const p = w.reset ? 0 : w.percentUsed;
  return p < 25 ? 'spring' : p < 60 ? 'summer' : p < 85 ? 'autumn' : 'winter';
}
/** The silo: the plan's weekly usage as grain, and a lamp near the limit (amber from 70%, red from 90%). */
function siloOf(plan) {
  const w = plan?.windows?.find(x => x.kind === 'seven_day');
  if (!w) return null;
  const p = w.reset ? 0 : w.percentUsed;
  return { fill: Math.max(0, Math.min(1, p / 100)), lamp: p >= 90 ? 'red' : p >= 70 ? 'amber' : null, label: `${Math.round(p)}%`, resetsAt: w.resetsAt ?? null };
}
/** A silo per Claude account (two at most): [{ x, name, silo }]. With one account, the plan's silo and no name on it. */
function silosOf(scene) {
  const accs = scene.accounts ?? [];
  if (accs.length < 2) return [{ x: SILO_X[0], name: null, silo: siloOf(scene.plan) }];
  return accs.slice(0, 2).map((a, i) => ({ x: SILO_X[i], name: a.name, silo: siloOf(a.plan) }));
}
/** Weather over a field, from its last deploy: windmill while it runs, rainbow when it worked, rain when it failed. */
function weatherOf(deploy) {
  if (!deploy) return null;
  if (deploy.state) return { running: 'windmill', ok: 'rainbow', failed: 'rain' }[deploy.state] ?? null;
  if (deploy.status !== 'completed') return 'windmill';
  return deploy.conclusion === 'success' ? 'rainbow' : deploy.conclusion === 'failure' ? 'rain' : null;
}
const growthStage = p => (p >= 0.85 ? 5 : p >= 0.7 ? 4 : p >= 0.5 ? 3 : p >= 0.3 ? 2 : p >= 0.12 ? 1 : 0);

// copied from web/worlds/farm/world.js (ACTIONS, OLD_TOOLS, actionOf, BLUEPRINT, doing)
const ACTIONS = {
  edit: { prop: 'hoe', verb: 'hoeing the rows', spot: 26 },
  write: { prop: 'seeds', verb: 'planting seeds', spot: 26 },
  read: { prop: 'almanac', verb: 'reading the almanac', spot: -26 },
  search: { prop: 'spyglass', verb: 'scouting the field', spot: -26 },
  web: { prop: 'pigeon', verb: 'sending a pigeon', spot: -26 },
  mcp: { prop: 'parcel', verb: 'sending a parcel to town', spot: -26 },
  skill: { prop: 'recipe', verb: 'following a recipe', spot: 0 },
  test: { prop: 'magnifier', verb: 'checking the crops', spot: 0 },
  lint: { prop: 'rake', verb: 'raking the rows tidy', spot: 26 },
  build: { prop: 'hammer', verb: 'mending the fence', spot: 0 },
  install: { prop: 'barrow', verb: 'hauling in supplies', spot: 0 },
  commit: { prop: 'crate', verb: 'packing a crate', spot: 0 },
  push: { prop: 'cart', verb: 'taking crates to market', spot: 0 },
  deploy: { prop: 'cart', verb: 'delivering to town', spot: 0, flag: true },
  pull: { prop: 'mailbag', verb: 'fetching the mail', spot: 0 },
  serve: { prop: 'lantern', verb: 'keeping watch', spot: 0 },
  delete: { prop: 'sickle', verb: 'clearing weeds', spot: 26 },
  agent: { prop: 'whistle', verb: 'whistling for helpers', spot: 0 },
  plan: { prop: 'clipboard', verb: 'writing the chore list', spot: 0 },
  ask: { prop: 'clipboard', verb: 'writing down a question', spot: 0 },
  shell: { prop: 'can', verb: 'watering', spot: 0 },
  other: { prop: 'can', verb: 'tending the field', spot: 0 },
};
const OLD_TOOLS = { Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', Read: 'read', Grep: 'search', Glob: 'search', WebSearch: 'web', WebFetch: 'web', Bash: 'shell' };
/** What a farmer does for a step; a step from an older snapshot goes by its tool. */
const actionOf = (step, tool) => ACTIONS[step] ?? ACTIONS[OLD_TOOLS[tool]] ?? ACTIONS.other;
const BLUEPRINT = { prop: 'blueprint', verb: 'drawing up plans (plan mode)', spot: 0 };
/** What a farmer does now: its step's tool; in plan mode, a blueprint. */
const doing = f => (f.mode === 'plan' && f.state === 'working' ? BLUEPRINT : f.step || f.tool ? actionOf(f.step, f.tool) : null);

export function makeModel({ makeGrid, engineScene, tagText, cutMid, lastPart, ago, lookFor, pick }) {
  const grid = makeGrid(GRID_CONFIG);
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  // copied from web/worlds/farm/world.js (farmScene): the engine's scene, with each farmer's look, and each field's crop, fence, soil, pennant and weather
  function farmScene(s) {
    const e = engineScene(s);
    e.fields = e.fields.map(f => ({
      ...f, weather: weatherOf(f.deploy),
      crop: CROPS[pick(f.key, 7, CROPS.length)], fence: FENCES[pick(f.key, 8, FENCES.length)], soil: SOILS[pick(f.key, 9, SOILS.length)],
      pennant: Boolean(f.branch) && f.branch !== '(detached)' && !f.onMain,
    }));
    e.farmers = e.farmers.map(f => ({ ...f, look: lookFor(f, f.kind === 'codex' ? CODEX : FARMER) }));
    return e;
  }
  // copied from web/worlds/farm/world.js (makeFarm's plotState): a field grows while an agent there is out and about
  function plotState(f, farmers) {
    const here = farmers.filter(a => a.field === f.key), on = here.filter(a => ACTIVE.has(a.state));
    const crop = f.crop ?? 'wheat';
    if (on.length) { const p = Math.max(...on.map(a => a.pct)); return { kind: 'grow', crop, p, stage: growthStage(p), busy: on.some(a => a.state === 'working') }; }
    if (here.length && here.every(a => a.state === 'stale')) return { kind: 'dry', crop, stage: 0, busy: false };
    return { kind: 'bare', crop, stage: 0, busy: false };
  }
  // The field's label, as the farm's labels hook writes it: its name and a branch other than main; then a worktree's repo, its deploy, a collision.
  function labelOf(f) {
    const branch = f.branch === '(detached)' ? ' ?' : f.branch && !isMain(f.branch) ? ` ${clip(f.branch, 12)}` : '';
    const d = f.lastDeploy;
    const second = [f.worktree && f.main ? `worktree of ${cutMid(lastPart(f.main), 16)}` : '', d?.label ?? '', f.collision ? '⚠ crowded' : ''].filter(Boolean).join(' ');
    return [`${cutMid(f.name ?? lastPart(f.key), 16)}${branch}`, ...(second ? [second] : [])];
  }
  // copied from web/worlds/farm/world.js (the tip hook): the farmer's tooltip
  function tipOf(f, fieldByKey) {
    const field = fieldByKey.get(f.field);
    const what = f.state === 'waiting' ? `needs you: ${f.ask}` : f.state === 'turn' ? (f.question ? `asks you: ${f.question}` : `your turn: ${f.reply || 'finished'}`)
      : f.state === 'working' ? `${doing(f)?.verb ?? 'working'}${field ? ` in ${field.name}` : ''}${f.summary ? ` · ${f.summary}` : ''}`
      : f.state === 'stale' ? 'stale' : 'idle';
    const mode = { acceptEdits: 'accept edits', plan: 'plan mode', auto: 'auto mode', bypassPermissions: '⚠ bypass permissions', dontAsk: "don't ask" }[f.mode];
    const extra = [
      f.tasks && `tasks ${f.tasks.done}/${f.tasks.total}${f.tasks.current ? `: ${f.tasks.current}` : ''}`,
      f.jobs && `${f.jobs} background command${f.jobs === 1 ? '' : 's'} running`,
      f.nap && f.wakeAt && `wakes up by itself at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      f.compactions && `compacted ${f.compactions}×`,
      f.model && `${f.model}${f.fast ? ' (fast)' : ''}`,
    ].filter(Boolean).map(t => ` · ${t}`).join('');
    const line = f.turn ? `${f.turn.word ?? (f.thinking ? 'Thinking' : 'Working')}… ${ago(f.turn.startedAt)}${f.turn.outTokens ? ` · ↓ ${f.turn.outTokens >= 1000 ? `${(f.turn.outTokens / 1000).toFixed(1)}k` : f.turn.outTokens} tokens` : ''}${f.thinking && f.effort ? ` · thinking with ${f.effort} effort` : ''} · ` : '';
    return `${f.name} · ${line}${f.thinking ? 'thinking' : what}${f.kind === 'codex' ? '' : ` · ${Math.round((1 - f.pct) * 100)}% context left`}${f.cost != null ? ` · $${f.cost.toFixed(2)} so far` : ''}${mode ? ` · ${mode}` : ''}${extra}`;
  }

  /**
   * The farm for a scene. `state` is what the last call returned as `keep` ({ beds, packed }): while you look a
   * field keeps its bed; the first scene with fields packs them into the first free beds (the engine's way).
   */
  function farmModel(sceneV1, { beds = {}, packed = false } = {}) {
    const e = farmScene(sceneV1);
    const ground = packed || !e.fields.length ? grid.layoutFor(e.fields, beds) : grid.packedLayout(e.fields, beds);
    const fieldByKey = new Map(e.fields.map(f => [f.key, f]));
    const bedsOut = ground.ST.map(s => {
      const f = fieldByKey.get(s.key), d = f.lastDeploy;
      return {
        key: s.key, name: f.name, i: s.i, cx: s.cx, rowTop: s.rowTop, lane: s.lane, x0: s.x0, y0: s.y0, w: BED.w, d: BED.d,
        crop: f.crop, fence: f.fence, soil: f.soil, worktree: Boolean(f.worktree), pennant: f.pennant, collision: f.collision ?? null,
        plot: plotState(f, e.farmers),
        pumps: Math.min(2, e.farmers.filter(a => a.field === s.key).reduce((t, a) => t + (a.jobs ?? 0), 0)), // background commands running here
        piles: { hay: Math.min(4, Math.ceil(f.dirty / 3)), crates: Math.min(4, Math.ceil(f.ahead / 4)), mailbox: f.behind > 0, dirty: f.dirty, ahead: f.ahead, behind: f.behind },
        weather: f.weather, deploy: d ? { state: d.state ?? null, label: d.label ?? '' } : null, label: labelOf(f),
        tip: [f.key, f.branch && `on ${f.branch}`, d?.detail].filter(Boolean).join(' · '),
      };
    });
    const T = slotTables(ground), count = {}, used = new Map(), over = { desk: 0, turn: 0, storage: 0, charge: 0, meadow: 0, nap: 0 }, farmers = [];
    const stOf = new Map(ground.ST.map(s => [s.key, s]));
    for (const f of e.farmers) {
      const d = doing(f), s = f.state === 'working' ? stOf.get(f.field) : null;
      let group, at;
      if (s) { // in its bed, at its step's place; the next free one when that is taken
        group = `st:${s.key}`;
        if (!used.has(group)) used.set(group, []);
        const u = used.get(group), off = [d?.spot ?? 0, 0, -26, 26, -13, 13].find(o => !u.includes(o)) ?? 0;
        u.push(off);
        at = [s.cx + off * SPOT, s.lane]; // the 2D farm's offset, stretched to the bigger bed
      } else {
        group = f.state === 'working' ? 'meadow' : f.nap ? 'nap' : f.state === 'waiting' ? 'desk' : f.state === 'turn' ? 'turn' : f.state === 'stale' ? 'storage' : 'charge';
        const i = count[group] ?? 0;
        count[group] = i + 1;
        if (i >= T[group].cap) { over[group] = (over[group] ?? 0) + 1; continue; }
        at = T[group].at(i);
      }
      const prop = f.state === 'working' ? d?.prop ?? 'can' : null;
      // its place for the diary, as the farm's slots name it: a bed and the tool in hand there, or the group
      const zone = s ? `st:${s.key}:${d?.prop ?? ''}` : group;
      farmers.push({
        id: f.id, name: f.name, state: f.state, kind: f.kind, tag: tagText(f), tip: tipOf(f, fieldByKey), shirt: f.shirt, look: f.look,
        family: f.family ?? null, fast: Boolean(f.fast), thinking: Boolean(f.thinking), nap: Boolean(f.nap), field: f.field ?? null,
        prop, flag: f.state === 'working' && Boolean(d?.flag), action: SWING.has(prop) ? 'swing' : CARRY.has(prop) ? 'carry' : 'hold',
        badge: f.state === 'waiting' ? (f.planAsk ? 'scroll' : '!') : f.state === 'turn' ? (f.question ? '?' : 'basket') : null,
        say: (f.state === 'waiting' ? f.ask : f.said) || '', group, at, scarecrow: f.state === 'stale', zone,
        kids: f.kids ?? [], jobs: f.jobs ?? 0, wakeAt: f.wakeAt ?? null, service: f.service ?? null, step: f.step ?? null, tool: f.tool ?? null, summary: f.summary ?? '',
      });
    }
    return {
      scene: e, // the engine scene (engine.js engineScene, with the farm's looks): the panel, the dialogs and the diary read it
      mail: e.mail ?? [], henhouse: e.henhouse ?? { eggs: 0, roosting: 0 }, carts: e.carts ?? [], subagents: e.subagents ?? [],
      ground, beds: bedsOut, farmers, over, season: seasonOf(e.plan), silos: silosOf(e), stall: stallOf(e),
      keep: { beds: ground.beds ?? beds, packed: packed || e.fields.length > 0 },
    };
  }
  return { grid, farmModel, actionOf, growthStage, weatherOf, seasonOf, siloOf };
}
/** What a farmer does now (its step's prop and verb), for the diary's words. */
export { doing };
