// Loads web/farm.js in a vm with a stub window and checks the scene adapter: the canvas code
// only ever reads what toScene returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// The page's scene (web/scene.js) and the farm (web/farm.js), loaded together as the page loads them.
const code = ['scene.js', 'farm.js'].map(f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8')).join('\n;\n');
function load() {
  const window = {};
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  const farm = window.TrackerFarm, scene = window.AgentvilleScene;
  // toScene, as the farm sees it: the page's plain-facts scene, turned into the farm's own.
  return { ...scene, ...farm, toScene: (snap, o) => farm.farmScene(scene.toScene(snap, o)) };
}
const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the vm have another realm's prototypes

const NOW = Date.now();
const repo = (path, over = {}) => ({ path, name: path.split('/').pop(), branch: 'main', dirty: 0, ahead: 0, behind: 0, agentIds: [], ...over });
const agent = (id, over = {}) => ({ id, kind: 'interactive', name: id, cwd: '/x', state: 'working', stateReason: 'busy', feed: [], children: [], touching: [], ...over });
const snapOf = (agents, repos, collisions = []) => ({ generatedAt: NOW, agents, repos, collisions, settings: { cpuAlertPct: 90 } });

test('the farm script loads without a DOM and exposes the adapter', () => {
  const farm = load();
  for (const name of ['mount', 'update', 'unmount', 'toScene', 'fieldOf', 'weatherOf', 'contextPct', 'askText']) assert.equal(typeof farm[name], 'function', name);
});

test('weather follows the deploy: rainbow on success, rain on failure, windmill while running, nothing otherwise', () => {
  const { weatherOf } = load();
  assert.equal(weatherOf({ status: 'completed', conclusion: 'success' }), 'rainbow');
  assert.equal(weatherOf({ status: 'completed', conclusion: 'failure' }), 'rain');
  assert.equal(weatherOf({ status: 'completed', conclusion: 'cancelled' }), null);
  assert.equal(weatherOf({ status: 'in_progress' }), 'windmill');
  assert.equal(weatherOf({ status: 'queued' }), 'windmill');
  assert.equal(weatherOf(undefined), null);
});

test("a farmer's field: its newest write, else its newest touch, else the repo holding its folder, else none", () => {
  const { fieldOf } = load();
  const repos = [repo('/code/app'), repo('/code/api'), repo('/code/app/packages/ui')];
  const t = (path, mode, lastAt, r) => ({ path, mode, lastAt, repo: r });
  assert.equal(fieldOf(agent('a', { touching: [t('/code/app/x', 'read', 9, '/code/app'), t('/code/api/y', 'write', 5, '/code/api')] }), repos), '/code/api');
  assert.equal(fieldOf(agent('a', { touching: [t('/code/app/x', 'read', 9, '/code/app'), t('/code/api/y', 'git', 7, '/code/api'), t('/code/app/z', 'write', 3, '/code/app')] }), repos), '/code/api');
  assert.equal(fieldOf(agent('a', { touching: [t('/code/app/x', 'read', 4, '/code/app'), t('/code/api/y', 'read', 8, '/code/api')] }), repos), '/code/api');
  assert.equal(fieldOf(agent('a', { cwd: '/code/app/packages/ui/src' }), repos), '/code/app/packages/ui');
  assert.equal(fieldOf(agent('a', { cwd: '/code/app' }), repos), '/code/app');
  assert.equal(fieldOf(agent('a', { cwd: '/code/apple' }), repos), null);
  assert.equal(fieldOf(agent('a', { kind: 'codex', cwd: '' }), repos), null);
});

test('context left: same limit rule as the list view', () => {
  const { contextPct } = load();
  assert.equal(contextPct(undefined), 0);
  assert.equal(contextPct(100_000), 0.5);
  assert.equal(contextPct(500_000), 0.5);
  assert.equal(contextPct(5_000_000), 1);
});

test('the porch bubble says what the agent is asking, or why it waits', () => {
  const { askText } = load();
  assert.equal(askText(agent('a', { ask: { kind: 'question', questions: [{ question: 'Ship it?' }] } })), 'Ship it?');
  assert.equal(askText(agent('a', { ask: { kind: 'permission', tool: 'Bash', summary: 'rm -rf build' } })), 'Bash: rm -rf build');
  assert.equal(askText(agent('a', { stateReason: 'question pending' })), 'question pending');
});

test('toScene maps repos to fields and agents to farmers', () => {
  const { toScene } = load();
  const repos = [
    repo('/code/app', { dirty: 7, ahead: 3, behind: 2, agentIds: ['w1'], deploy: { status: 'completed', conclusion: 'failure' } }),
    repo('/code/api', { branch: 'feature/x', ahead: undefined, behind: undefined }),
  ];
  const agents = [
    agent('w1', { touching: [{ path: '/code/app/a.ts', mode: 'write', lastAt: 5, repo: '/code/app' }], now: { tool: 'Edit' }, contextTokens: 180_000, proc: { cpu: 95 }, children: [{ id: 'c1', state: 'running', agentType: 'Explore' }, { id: 'c2', state: 'running' }, { id: 'c3', state: 'done' }] }),
    agent('t1', { state: 'yourTurn', lastReply: 'All done.\nSecond line', feed: [{ kind: 'reply', text: 'x' }, { kind: 'tool', tool: 'Bash' }] }),
    agent('q1', { state: 'waiting', ask: { kind: 'question', questions: [{ question: 'Which colour?' }] } }),
    agent('x1', { kind: 'codex', cwd: '', state: 'idle' }),
  ];
  const scene = toScene(snapOf(agents, repos, [{ repo: '/code/app', severity: 'high' }]), { cpuAlertPct: 90 });
  assert.deepEqual(plain(scene.fields.map(f => [f.key, f.name, f.branch, f.dirty, f.ahead, f.behind, f.weather, f.collision])), [
    ['/code/app', 'app', 'main', 7, 3, 2, 'rain', 'high'],
    ['/code/api', 'api', 'feature/x', 0, 0, 0, null, null],
  ]);
  const [w, t, q, x] = plain(scene.farmers);
  assert.deepEqual([w.state, w.field, w.tool, w.hot, w.hearts, w.kids], ['working', '/code/app', 'Edit', true, 0, [{ id: 'c1', dog: true }, { id: 'c2', dog: false }]]);
  assert.equal(Math.round(w.pct * 100), 90);
  assert.deepEqual([t.state, t.tool, t.reply, t.hearts], ['turn', 'Bash', 'All done.', 4]);
  assert.deepEqual([q.state, q.ask], ['waiting', 'Which colour?']);
  assert.deepEqual([x.kind, x.field, x.state], ['codex', null, 'idle']);
  assert.equal(w.color, toScene(snapOf([agents[0]], repos), { cpuAlertPct: 90 }).farmers[0].color, 'colour follows the id, not the list position');
});

test("a farmer's colour comes from its id, so the sidebar can match the shirt", () => {
  const farm = load();
  assert.equal(typeof farm.select, 'function');
  assert.match(farm.colorOf('abc'), /^#[0-9a-f]{6}$/);
  assert.equal(farm.colorOf('abc'), farm.colorOf('abc'));
  assert.equal(farm.colorOf('abc'), SHIRT_OF(farm, 'abc'));
});
const SHIRT_OF = (farm, id) => farm.toScene({ agents: [{ id, name: id, state: 'idle', touching: [] }], repos: [], collisions: [] }).farmers[0].shirt;

test('how to read the farm is one block of help, for the info dialog', () => {
  const html = load().helpHtml();
  for (const item of ['Your porch', 'Fields', 'Above a field', 'Weather', 'Hearts, crops', 'Click']) assert.match(html, new RegExp(`<b>${item}</b>`));
  assert.match(html, /^<div class="px-key">/);
});

test('a farmer whose turn ended with a question carries it, for the porch bubble', () => {
  const { toScene } = load();
  const [f] = plain(toScene(snapOf([agent('t', { state: 'yourTurn', question: 'Should I deploy?' })], []), { cpuAlertPct: 90 }).farmers);
  assert.equal(f.question, 'Should I deploy?');
});

test('a farmer carries what it last said, as plain text, for its speech bubble', () => {
  const { toScene } = load();
  const feed = [
    { kind: 'tool', tool: 'Bash', text: 'npm test' },
    { kind: 'reply', text: 'Done.', body: '**Done.** All `tests` pass.\n\n## Next\nShip it?' },
    { kind: 'reply', text: 'Older', body: 'Older reply' },
  ];
  const [f] = plain(toScene(snapOf([agent('a', { feed })], []), { cpuAlertPct: 90 }).farmers);
  assert.equal(f.said, 'Done. All tests pass. Next Ship it?');
  const [quiet] = plain(toScene(snapOf([agent('b', { feed: [{ kind: 'tool', tool: 'Read', text: 'x' }] })], []), { cpuAlertPct: 90 }).farmers);
  assert.equal(quiet.said, '');
  const [long] = plain(toScene(snapOf([agent('c', { feed: [{ kind: 'reply', text: 'x', body: 'word '.repeat(80) }] })], []), { cpuAlertPct: 90 }).farmers);
  assert.ok(long.said.length <= 160 && long.said.endsWith('…'));
});

test("a waiting farmer without the mod's offer still shows its question, from the pending call", () => {
  const { askText } = load();
  assert.equal(askText(agent('a', { state: 'waiting', stateReason: 'question pending', now: { tool: 'AskUserQuestion', summary: 'Which crop next?' } })), 'Which crop next?');
  assert.equal(askText(agent('a', { state: 'waiting', stateReason: 'probably a permission prompt', now: { tool: 'Bash', summary: 'rm -rf x' } })), 'probably a permission prompt');
});

test('every farmer gets its own look from its id: hat, colours, skin, extras; the same agent always looks the same', () => {
  const { toScene } = load();
  const ids = ['agent-alpha', 'agent-bravo', 'agent-charlie', 'agent-delta', 'agent-echo', 'agent-foxtrot', 'agent-golf', 'agent-hotel'];
  const looks = plain(toScene(snapOf(ids.map(id => agent(id)), []), { cpuAlertPct: 90 }).farmers.map(f => f.look));
  for (const l of looks) for (const k of ['hat', 'hatColor', 'hair', 'skin', 'overalls', 'extra']) assert.ok(l[k], k);
  assert.ok(new Set(looks.map(l => JSON.stringify(l))).size === ids.length, 'eight agents, eight looks');
  assert.ok(new Set(looks.map(l => l.hat)).size >= 3, 'several hat styles');
  const again = plain(toScene(snapOf([agent(ids[3])], []), { cpuAlertPct: 90 }).farmers[0].look);
  assert.deepEqual(again, looks[3]);
  const codex = plain(toScene(snapOf([agent('codex:1', { kind: 'codex' })], []), { cpuAlertPct: 90 }).farmers[0].look);
  assert.equal(codex.hat, 'cap');
});

test('every field gets its own crop and fence from its repo; a branch other than main gets a pennant', () => {
  const { toScene } = load();
  const paths = ['/code/a', '/code/b', '/code/c', '/code/d', '/code/e', '/code/f', '/code/g'].map(p => repo(p));
  paths[1].branch = 'feature/x';
  paths[2].branch = '(detached)';
  const fields = plain(toScene(snapOf([], paths), { cpuAlertPct: 90 }).fields);
  assert.ok(new Set(fields.map(f => f.crop)).size >= 4, 'several crops');
  assert.ok(fields.every(f => /^#[0-9a-f]{6}$/.test(f.fence) && /^#[0-9a-f]{6}$/.test(f.soil)));
  assert.deepEqual(fields.map(f => f.pennant), [false, true, false, false, false, false, false]);
  assert.equal(plain(toScene(snapOf([], [repo('/code/c')]), { cpuAlertPct: 90 }).fields[0]).crop, fields[2].crop);
});

test("a farmer's step is the kind of work it is doing now, else the last tool step it took", () => {
  const { toScene } = load();
  const now = agent('a', { now: { tool: 'Bash', summary: 'Run tests', step: 'test', startedAt: NOW } });
  const after = agent('b', { feed: [{ at: NOW, kind: 'reply', text: 'done' }, { at: NOW - 1, kind: 'tool', tool: 'Bash', step: 'push', text: 'git push' }] });
  const old = agent('c', { feed: [{ at: NOW, kind: 'tool', tool: 'Edit', text: 'a.ts' }] }); // from before steps were sent
  assert.deepEqual(plain(toScene(snapOf([now, after, old], []), { cpuAlertPct: 90 }).farmers.map(f => f.step)), ['test', 'push', null]);
});

const STEP_KINDS = ['edit', 'write', 'read', 'search', 'web', 'mcp', 'skill', 'test', 'lint', 'build', 'install', 'commit', 'push', 'deploy', 'pull', 'serve', 'delete', 'agent', 'plan', 'shell', 'other'];

test('every kind of step has its own tool and words; only a plain shell command or an unknown tool waters', () => {
  const { actionOf } = load();
  const actions = STEP_KINDS.map(s => plain(actionOf(s, 'Bash')));
  for (const [i, a] of actions.entries()) assert.ok(a?.prop && a.verb, STEP_KINDS[i]);
  const watering = STEP_KINDS.filter((s, i) => actions[i].prop === 'can');
  assert.deepEqual(watering, ['shell', 'other']);
  assert.equal(new Set(actions.map(a => a.verb)).size, actions.length, 'each says what it does in its own words');
  assert.equal(plain(actionOf(null, 'Edit')).prop, 'hoe', 'a step from an older snapshot goes by its tool');
});

// A stand-in 2D context that records what is painted.
const recorder = () => {
  const rects = [];
  return { rects, ctx: { fillStyle: '', globalAlpha: 1, fillRect(x, y, w, h) { rects.push([x, y, w, h, this.fillStyle]); }, drawImage() {} } };
};

test('every tool a farmer can hold is drawn, and no two look alike', () => {
  const { actionOf, paint } = load();
  const drawn = new Map();
  for (const step of STEP_KINDS) {
    const { prop, flag } = plain(actionOf(step, 'Bash'));
    const r = recorder();
    for (const T of [0.1, 0.4, 0.7]) paint(r.ctx, { prop, flag, T });
    assert.ok(r.rects.length >= 6, `${step}: ${prop}`);
    drawn.set(`${prop}${flag ? '+flag' : ''}`, JSON.stringify(r.rects));
  }
  assert.equal(new Set(drawn.values()).size, drawn.size, [...drawn.keys()].join(' '));
});

test('crops grow through six stages, from seeds to ripe, and each crop looks different at each one', () => {
  const { growthStage, paint, STAGES } = load();
  assert.deepEqual(plain(STAGES), ['seeds', 'sprouts', 'young plants', 'in flower', 'ripening', 'ripe']);
  assert.deepEqual([0, 0.1, 0.12, 0.29, 0.3, 0.5, 0.69, 0.7, 0.84, 0.85, 1].map(growthStage), [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5]);
  const crops = ['wheat', 'corn', 'carrot', 'cabbage', 'sunflower', 'tomato', 'pumpkin'];
  const looks = new Set();
  for (const crop of crops) {
    const stages = [0, 1, 2, 3, 4, 5].map(stage => { const r = recorder(); paint(r.ctx, { crop, stage }); return JSON.stringify(r.rects); });
    assert.equal(new Set(stages).size, 6, `${crop}: six different stages`);
    stages.slice(2).forEach(s => looks.add(s));
  }
  assert.equal(looks.size, crops.length * 4, 'from young plants on, no two crops look the same');
});

test("a farmer's tooltip says what its session has cost so far", () => {
  const { toScene } = load();
  const scene = plain(toScene(snapOf([agent('a', { usage: { costUsd: 3.456 } }), agent('b')], []), { cpuAlertPct: 90 }));
  assert.deepEqual(scene.farmers.map(f => f.cost), [3.456, null]);
});

test("a field's weather follows its last deploy, direct or Actions; a run GitHub never started brings none", () => {
  const { toScene } = load();
  const r = (name, lastDeploy) => repo(`/code/${name}`, { lastDeploy });
  const scene = plain(toScene(snapOf([], [r('a', { state: 'ok', source: 'direct', label: '✓ deployed directly' }), r('b', { state: 'blocked', label: "⏸ Actions didn't run" }), r('c', { state: 'failed' }), r('d', { state: 'running' }), r('e', null)]), { cpuAlertPct: 90 }));
  assert.deepEqual(scene.fields.map(f => f.weather), ['rainbow', null, 'rain', 'windmill', null]);
  assert.equal(scene.fields[1].lastDeploy.label, "⏸ Actions didn't run");
});

test('the sky follows your clock: night, dawn, day, dusk, brightening and darkening between', () => {
  const { skyAt } = load();
  const at = (h, m = 0) => plain(skyAt(new Date(2026, 9, 7, h, m)));
  assert.deepEqual([3, 6, 12, 19, 22].map(h => at(h).phase), ['night', 'dawn', 'day', 'dusk', 'night']);
  assert.equal(at(3).light, 0);
  assert.equal(at(12).light, 1);
  assert.ok(at(6, 30).light > at(5, 30).light, 'dawn brightens');
  assert.ok(at(19, 30).light < at(18, 30).light, 'dusk darkens');
  assert.ok(at(12).sun.x < at(16).sun.x, 'the sun crosses the sky');
  assert.equal(at(12).moon, null);
  assert.ok(at(23).moon && !at(23).sun);
});

test('every colour the farm paints comes from one palette of ramps', () => {
  const { PALETTE, paint, actionOf } = load();
  const palette = new Set(plain(PALETTE));
  assert.ok(palette.size >= 40 && palette.size <= 90, `${palette.size} colours`);
  const painted = new Set();
  const ctx = { globalAlpha: 1, globalCompositeOperation: 'source-over', set fillStyle(c) { painted.add(c); }, get fillStyle() { return ''; }, fillRect() {}, drawImage() {} };
  for (const step of STEP_KINDS) { const a = plain(actionOf(step, 'Bash')); paint(ctx, { prop: a.prop, flag: a.flag, T: 0.3 }); }
  for (const crop of ['wheat', 'corn', 'carrot', 'cabbage', 'sunflower', 'tomato', 'pumpkin']) for (let stage = 0; stage < 6; stage++) paint(ctx, { crop, stage });
  paint(ctx, { land: true, rows: 2 });
  const strays = [...painted].filter(c => !palette.has(c));
  assert.deepEqual(strays, []);
  assert.ok(painted.size > 30);
});

test('a farmer has four views: front, back, and a side each way (one the mirror of the other)', () => {
  const { spriteRows } = load();
  const look = { hat: 'cap', hatColor: '#4a74c9', band: '#2c4a85', hair: '#5a3a22', skin: '#e0a878', overalls: '#3c5a99', extra: 'beard' };
  const views = Object.fromEntries(['down', 'up', 'right', 'left'].map(v => [v, plain(spriteRows(look, v, 's'))]));
  for (const rows of Object.values(views)) { assert.equal(rows.length, 16); assert.ok(rows.every(r => r.length === 14)); }
  assert.equal(new Set(Object.values(views).map(r => r.join('|'))).size, 4);
  assert.deepEqual(views.left, views.right.map(r => [...r].reverse().join('')));
  assert.ok(views.up.slice(5, 8).every(r => !r.includes('s')), 'from behind: hair, no face');
  assert.ok(views.down.slice(5, 8).some(r => r.includes('s')));
});

test('walking takes four steps (foot, pass, other foot, pass), and the body rises on the passes', () => {
  const { walkFrame } = load();
  assert.deepEqual([0, 1, 2, 3, 4].map(i => plain(walkFrame(i / 8 + 0.01))), [
    { legs: 'a', bob: 0 }, { legs: 's', bob: 1 }, { legs: 'b', bob: 0 }, { legs: 's', bob: 1 }, { legs: 'a', bob: 0 },
  ]);
});

test('particles move with their speed and gravity, fade, and are gone when their life runs out', () => {
  const { stepParticles } = load();
  const parts = [{ x: 0, y: 0, vx: 10, vy: -20, g: 40, life: 1, max: 1 }, { x: 5, y: 5, vx: 0, vy: 0, g: 0, life: 0.05, max: 1 }];
  stepParticles(parts, 0.1);
  assert.equal(parts.length, 1);
  assert.ok(Math.abs(parts[0].x - 1) < 1e-9 && Math.abs(parts[0].y - -2) < 1e-9);
  assert.ok(Math.abs(parts[0].vy - -16) < 1e-9);
  assert.ok(Math.abs(parts[0].life - 0.9) < 1e-9);
});

const planWith = (five, week) => ({ from: 'a', at: NOW, windows: [
  ...(five == null ? [] : [five === 'reset' ? { kind: 'five_hour', percentUsed: 0, resetsAt: null, reset: true } : { kind: 'five_hour', percentUsed: five, resetsAt: NOW + 3_600_000 }]),
  ...(week == null ? [] : [{ kind: 'seven_day', percentUsed: week, resetsAt: NOW + 3 * 86_400_000 }]),
] });

test('the season follows the 5-hour limit: spring when it is fresh, winter when it is nearly used up', () => {
  const { seasonOf } = load();
  assert.equal(seasonOf(null), 'summer', 'no reading: summer');
  assert.deepEqual([0, 24, 25, 59, 60, 84, 85, 100].map(p => seasonOf(planWith(p))), ['spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter']);
  assert.equal(seasonOf(planWith('reset')), 'spring');
  assert.equal(seasonOf(planWith(null, 50)), 'summer', 'no 5-hour window: summer');
});

test("the farm's scene keeps a plan window's reset flag, so a window that has just reset still says so", () => {
  const { toScene } = load();
  const w = toScene({ ...snapOf([], []), plan: planWith('reset', 50) }).plan.windows;
  assert.equal(w[0].reset, true);
  assert.equal(w[1].reset, false);
});

test("the silo's grain is the week's usage, with a lamp that warns near the limit", () => {
  const { siloOf } = load();
  assert.equal(siloOf(null), null);
  assert.equal(siloOf(planWith(10, null)), null, 'no weekly window: no silo reading');
  assert.deepEqual(plain(siloOf(planWith(10, 47))), { fill: 0.47, lamp: null, label: '47%', resetsAt: NOW + 3 * 86_400_000 });
  assert.equal(siloOf(planWith(10, 75)).lamp, 'amber');
  assert.equal(siloOf(planWith(10, 93)).lamp, 'red');
  assert.equal(siloOf(planWith(10, 140)).fill, 1);
});

test('the henhouse: eggs for subagents that finished lately, a sign for running ones no farmer can lead', () => {
  const { toScene } = load();
  const kids = (running, done) => [...Array.from({ length: running }, (_, i) => ({ id: `r${i}`, state: 'running' })), ...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, state: 'done' }))];
  const scene = plain(toScene(snapOf([agent('a', { children: kids(6, 2) }), agent('b', { children: kids(1, 9) })], []), { cpuAlertPct: 90 }));
  assert.deepEqual(scene.henhouse, { eggs: 6, roosting: 2 });
  assert.equal(plain(toScene(snapOf([agent('a')], []), { cpuAlertPct: 90 })).henhouse.eggs, 0);
  assert.deepEqual(plain(toScene({ ...snapOf([], []), plan: planWith(90, 50) }, { cpuAlertPct: 90 })).plan.windows.length, 2);
});

test('the pixel font has every printable character and the farm symbols; widths add up with a pixel between letters', () => {
  const { textWidth, glyphOf } = load();
  for (let c = 32; c < 127; c++) assert.ok(glyphOf(String.fromCharCode(c)), `glyph for ${String.fromCharCode(c)}`);
  for (const ch of '♥♡✓✗◌⏸↑↓…⚠·—’') assert.ok(glyphOf(ch), `glyph for ${ch}`);
  assert.equal(textWidth('AB'), 11);
  assert.equal(textWidth('a b'), 5 + 1 + 3 + 1 + 5);
  assert.equal(textWidth(''), 0);
  assert.equal(textWidth('façade'), null, 'a letter it lacks: the label falls back to plain text');
  for (const ch of 'gjpqy') assert.ok(plain(glyphOf(ch)).rows.slice(7).some(r => r > 0), `${ch} reaches below the line`);
  assert.ok(plain(glyphOf('A')).rows.slice(7).every(r => r === 0));
});

test('a recent message between two farmers is a pigeon from one to the other, seen from either side once', () => {
  const { toScene } = load();
  const note = (dir, other, ago, text = 'hi') => ({ at: NOW - ago, kind: 'peer', dir, other, text });
  const a = agent('a1', { name: 'shop-api-3', feed: [note('out', 'docs-2', 20_000, 'Hold the deploy'), note('out', 'aed8a9f3e491b8ac1', 5_000)] });
  const b = agent('b1', { name: 'docs-2', feed: [note('in', 'shop-api-3', 19_000, 'Hold the deploy'), note('in', 'shop-api-3', 400_000, 'old')] });
  assert.deepEqual(plain(toScene(snapOf([a, b], []), { cpuAlertPct: 90 }).mail), [{ from: 'a1', to: 'b1', at: NOW - 20_000, text: 'Hold the deploy' }]);
});

test('a farmer carries its task list, thinking, model, a plan to approve, its errand, its background jobs and its nap', () => {
  const { toScene } = load();
  const agents = [
    agent('a', { model: 'claude-opus-5-5', fast: true, tasks: { done: 2, total: 5, current: 'Testing', items: [] }, compactions: 3, children: [{ id: 'j', kind: 'bgjob', state: 'running' }, { id: 's', kind: 'subagent', state: 'running', label: 'Look around', agentType: 'Explore' }] }),
    agent('b', { model: 'claude-haiku-4-5', now: { tool: 'mcp__claude_ai_Gmail__search_threads', step: 'mcp', service: 'Gmail' } }),
    agent('c', { state: 'waiting', now: { tool: 'ExitPlanMode', step: 'plan' } }),
    agent('d', { state: 'yourTurn', wakeAt: NOW + 600_000 }),
    agent('e', { state: 'yourTurn', wakeAt: NOW - 1 }),
  ];
  const [a, b, c, d, e] = plain(toScene(snapOf(agents, [])).farmers);
  assert.deepEqual([a.family, a.fast, a.tasks.done, a.compactions, a.jobs, a.thinking, a.kids.map(k => k.id)], ['opus', true, 2, 3, 1, true, ['s']], 'working with no call open: thinking; a background job is a pump, not a chicken');
  assert.deepEqual([b.family, b.service, b.thinking], ['haiku', 'Gmail', false]);
  assert.equal(c.planAsk, true);
  assert.deepEqual([d.nap, e.nap], [true, false], 'a wake-up still to come: a hammock, not the porch');
  assert.deepEqual(plain(toScene(snapOf(agents, [])).subagents).map(s => [s.parent, s.label, s.type]), [['a', 'Look around', 'Explore']]);
});

test('fields keep their beds: a new repo or worktree takes a free bed and moves no one', () => {
  const { layoutFor } = load();
  const f = (key, over = {}) => ({ key, ...over });
  const bedsOf = L => Object.fromEntries(L.ST.map(s => [s.key, s.i]));
  const A = '/Users/me/code/a', B = '/Users/me/code/b', C = '/Users/me/code/c', N = '/Users/me/code/new';
  let L = plain(layoutFor([f(A), f(B), f(C)], {}, NOW));
  assert.deepEqual(bedsOf(L), { [A]: 0, [B]: 1, [C]: 2 }, 'nothing remembered: laid out as before');
  L = plain(layoutFor([f(N), f(C), f(A), f(B)], L.beds, NOW + 1)); // the new one comes first in the list (more agents)
  assert.deepEqual(bedsOf(L), { [A]: 0, [B]: 1, [C]: 2, [N]: 3 }, 'it takes the first free bed; the order of the list moves no one');
  assert.equal(plain(layoutFor([f(C), f(B), f(A), f(N)], L.beds, NOW + 2)).key, L.key, 'agents moving between repos move nothing');
  // a worktree goes right after its repo when that bed is free, else to the free bed nearest it
  const W = `${A}/.claude/worktrees/x`, wt = { worktree: true, main: A };
  assert.equal(plain(layoutFor([f(A), f(C), f(W, wt)], { [A]: { i: 0 }, [C]: { i: 2 } }, NOW)).ST.find(s => s.key === W).i, 1);
  assert.equal(plain(layoutFor([f(A), f(B), f(C), f(N), f(W, wt)], L.beds, NOW)).ST.find(s => s.key === W).i, 4, 'row 0 is full: the nearest free bed');
  // a repo of a project goes beside its project's fields
  const API = '/Users/me/work/shop/api', WEB = '/Users/me/work/shop/web';
  const P = plain(layoutFor([f(A), f(API), f(WEB)], { [A]: { i: 0 }, [API]: { i: 3 } }, NOW));
  assert.equal(P.ST.find(s => s.key === WEB).i, 4);
  assert.deepEqual(P.groups, [{ name: 'shop', slots: [3, 4] }]);
});

test("a field that leaves leaves its bed empty and held for a day: it comes back to it; then the bed is free", () => {
  const { layoutFor } = load();
  const f = key => ({ key });
  const bedsOf = L => Object.fromEntries(L.ST.map(s => [s.key, s.i]));
  const A = '/Users/me/code/a', B = '/Users/me/code/b', C = '/Users/me/code/c', N = '/Users/me/code/new';
  let L = plain(layoutFor([f(A), f(B), f(C)], {}, NOW));
  L = plain(layoutFor([f(A), f(C)], L.beds, NOW + 1));
  assert.deepEqual(bedsOf(L), { [A]: 0, [C]: 2 }, 'C stays put: nothing slides into the gap');
  assert.ok(L.empty.some(s => s.i === 1));
  L = plain(layoutFor([f(A), f(C), f(N)], L.beds, NOW + 2));
  assert.equal(bedsOf(L)[N], 3, "a new field leaves B's bed alone while it is held");
  const back = plain(layoutFor([f(A), f(B), f(C), f(N)], L.beds, NOW + 3));
  assert.equal(bedsOf(back)[B], 1, 'B comes back to its bed');
  const later = plain(layoutFor([f(A), f(C), f(N), f('/Users/me/code/next')], L.beds, NOW + 1 + 86_400_000 + 1));
  assert.equal(bedsOf(later)['/Users/me/code/next'], 1, 'a day on, the bed is free for a new field');
});

test("a project's outline goes round each run of its beds side by side, never round another repo's bed", () => {
  const { rowsOfGroup } = load();
  assert.deepEqual(plain(rowsOfGroup({ slots: [3, 4] })), [[1, [0, 1]]]);
  assert.deepEqual(plain(rowsOfGroup({ slots: [2, 0, 5] })), [[0, [0]], [0, [2]], [1, [2]]], 'beds 0 and 2 with another repo between them: two outlines');
});

test("a project's repos sit side by side under its sign, a worktree right after its repo; the grid grows with the repos", () => {
  const { layoutFor } = load();
  const f = (key, over = {}) => ({ key, ...over });
  const L = plain(layoutFor([f('/Users/me/code/solo'), f('/Users/me/code/shop/api'), f('/Users/me/code/other'), f('/Users/me/code/shop/web'), f('/Users/me/code/shop/api/.claude/worktrees/x', { worktree: true, main: '/Users/me/code/shop/api' })]));
  const slot = k => L.ST.find(s => s.key === k).i;
  assert.deepEqual([slot('/Users/me/code/solo'), slot('/Users/me/code/shop/api'), slot('/Users/me/code/shop/api/.claude/worktrees/x'), slot('/Users/me/code/shop/web')], [0, 3, 4, 5], 'the shop project does not fit after solo: it gets a row of its own, worktree after its repo');
  assert.equal(slot('/Users/me/code/other'), 1, 'a single repo fills the gap');
  assert.deepEqual(L.groups, [{ name: 'shop', slots: [3, 4, 5] }]);
  assert.equal(L.rows, 3);
  assert.equal(plain(layoutFor([f('/Users/me/code/a'), f('/Users/me/code/b')])).groups.length, 0, '~/code holds unrelated repos: no project');
  const many = plain(layoutFor(Array.from({ length: 13 }, (_, i) => f(`/Users/me/code/r${i}`))));
  assert.equal(many.rows, 5);
  assert.equal(many.H, many.GRID.y1 + 28);
  assert.equal(many.more, 0);
  assert.equal(plain(layoutFor(Array.from({ length: 20 }, (_, i) => f(`/Users/me/code/r${i}`)))).more, 2, 'six rows at most; the rest are "+N more"');
});

test("MCP servers' carts: one for each server called in the last hour (six at most, the latest), each going to the farmer calling it now (a browser's too)", () => {
  const { toScene } = load();
  const t = NOW - 60_000;
  const agents = [
    agent('a1', { mcp: [{ server: 'playwright', at: t }, { server: 'Gmail', at: t - 5000 }], now: { tool: 'mcp__playwright__browser_click', step: 'web', service: 'playwright', startedAt: NOW - 2000 } }), // a browser's: a web step, still a connector's cart
    agent('a2', { mcp: [{ server: 'playwright', at: t - 1000 }], now: { tool: 'mcp__playwright__browser_navigate', step: 'web', service: 'playwright', startedAt: NOW - 500 } }), // called it last
    agent('a3', { state: 'yourTurn', mcp: [{ server: 'Linear', at: t - 9000 }], now: { tool: 'mcp__linear__x', step: 'mcp', service: 'Linear', startedAt: NOW - 100 } }), // not working: no call going on
    agent('a4', { mcp: ['s1', 's2', 's3', 's4'].map((server, i) => ({ server, at: t - 20_000 - i })) }),
  ];
  const carts = plain(toScene(snapOf(agents, [])).carts);
  assert.deepEqual(carts, [
    { server: 'Gmail', busy: null },
    { server: 'Linear', busy: null },
    { server: 'playwright', busy: 'a2' },
    { server: 's1', busy: null },
    { server: 's2', busy: null },
    { server: 's3', busy: null },
  ], "by name, so each keeps its place in the row; the oldest (s4) has none");
  assert.deepEqual(plain(toScene(snapOf([agent('w', { now: { tool: 'WebFetch', step: 'web', service: 'docs.github.com' } })], [])).carts), [], 'a web call keeps its cart to town');
});

test("a cart's way: down onto the lane, along it, down the path nearest the farmer, and over to it; back the same way", () => {
  const { cartRoute } = load();
  const LANE = 87;
  assert.deepEqual(plain(cartRoute([10, 79], [270, 144])), [[10, LANE], [306, LANE], [306, 144], [270, 144]], 'from the shed to a field in the right-hand column');
  assert.deepEqual(plain(cartRoute([270, 144], [10, 79])), [[306, 144], [306, LANE], [10, LANE], [10, 79]], 'and home again');
  assert.deepEqual(plain(cartRoute([10, 79], [40, 166])), [[10, LANE], [116, LANE], [116, 166], [40, 166]], 'to the meadow: down the yard path');
  assert.deepEqual(plain(cartRoute([10, LANE], [150, LANE])), [[150, LANE]], 'along the lane');
  assert.deepEqual(plain(cartRoute([388, LANE], [187, 144])), [[218, LANE], [218, 144], [187, 144]], 'from its place by the road to town, to a farmer in the left-hand column');
});

test('a cart stays with its farmer while the call goes on, and a few seconds after it has got there, then heads home', () => {
  const { cartGoal } = load();
  const home = [10, 79], farmer = [200, 144];
  const c = {};
  assert.deepEqual(plain(cartGoal(c, farmer, home, 0)), farmer, 'called: it goes');
  assert.deepEqual(plain(cartGoal(c, null, home, 1000)), farmer, 'a short call ended on the way: it still gets there');
  c.arrivedAt = 4000;
  assert.deepEqual(plain(cartGoal(c, null, home, 6000)), farmer, 'there: it waits a moment');
  assert.deepEqual(plain(cartGoal(c, null, home, 9000)), home, 'then home');
  assert.deepEqual(plain(cartGoal(c, null, home, 9500)), home);
  const busy = { arrivedAt: 0 };
  cartGoal(busy, farmer, home, 0);
  assert.deepEqual(plain(cartGoal(busy, farmer, home, 60_000)), farmer, 'a long call: it stays');
  assert.deepEqual(plain(cartGoal(busy, [120, 206], home, 61_000)), [120, 206], 'another farmer calls it: it goes there');
});

test('a long name is shortened in the middle, so both ends stay readable', () => {
  const { cutMid } = load();
  assert.equal(cutMid('inventory_management', 16), 'inventor…agement');
  assert.equal(cutMid('agent-tracker-a5', 10), 'agent…r-a5');
  assert.equal(cutMid('ctd', 10), 'ctd');
});

test('on the porch a name tag is just the name, 10 characters at most; in the field it has its hearts and chores', () => {
  const { tagText } = load();
  const f = over => ({ name: 'inventory-management', kind: 'interactive', state: 'working', hearts: 3, tasks: { done: 2, total: 5 }, ...over });
  assert.equal(tagText(f({ state: 'waiting' })), 'inven…ment');
  assert.equal(tagText(f({ state: 'turn' })), 'inven…ment');
  assert.equal(tagText(f({})), 'inventor…agement ♥♥♥♡ 2/5');
  assert.equal(tagText(f({ state: 'turn', nap: true })), 'inventor…agement ♥♥♥♡ 2/5', 'napping in its hammock, not on the porch');
});

test('when the page opens, fields move up into free beds in the order they had: empty rows at the bottom close up', () => {
  const { packedLayout } = load();
  const fields = ['/c/api', '/c/web', '/c/ctd'].map(key => ({ key, name: key.split('/').pop() }));
  const ground = packedLayout(fields, { '/c/ctd': { i: 13 }, '/c/api': { i: 0 }, '/c/web': { i: 4 }, '/c/gone': { i: 7, left: 1 } });
  assert.deepEqual(plain(ground.ST.map(s => [s.key, s.i])), [['/c/api', 0], ['/c/web', 1], ['/c/ctd', 2]]);
  assert.equal(ground.rows, 3, 'the fewest rows the farm has');
  assert.deepEqual(plain(ground.beds), { '/c/api': { i: 0 }, '/c/web': { i: 1 }, '/c/ctd': { i: 2 } }, 'remembered from now on');
});

// The scripts a world's frame runs, and the styles it loads (it can't see the page's own).
const FRAME_CODE = ['farm.js'].map(f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8')).join('\n');
const FRAME_CSS = ['base.css', 'worlds/sdk/engine.css'].map(f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8')).join('\n');
// Styled by the page, not the frame: none.
const PAGE_STYLED = new Set([]);
// Hooks the farm's own code finds its elements by (querySelector, data attributes); they carry no style, and never did.
const HOOKS = new Set(['px-kpi-n', 'px-motion', 'px-info', 'px-dlg-title']);

test('every class the farm writes is styled by the stylesheets its frame loads', () => {
  const used = new Set([...FRAME_CODE.matchAll(/class="([^"$]*)"/g)].flatMap(m => m[1].split(/\s+/)).filter(c => c && !c.endsWith('-')));
  const unstyled = [...used].filter(c => !PAGE_STYLED.has(c) && !HOOKS.has(c) && !new RegExp(`\\.${c.replace(/-/g, '\\-')}(?![\\w-])`).test(FRAME_CSS));
  assert.deepEqual(unstyled, []);
});

test('the farm reaches the page only through what it is handed: no storage, network or token of its own', () => {
  const engine = FRAME_CODE.slice(0, FRAME_CODE.indexOf('/* ---------- public API ---------- */'));
  for (const banned of ['localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'document.cookie', 'x-tracker-token', 'opts.token', 'TOKEN', 'opts.diary']) assert.ok(!engine.includes(banned), banned);
});
