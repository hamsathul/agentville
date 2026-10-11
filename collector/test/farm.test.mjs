// Loads the farm's world (web/worlds/farm/world.js) in a vm with a stub window and checks the scene
// adapter: the canvas code only ever reads what toScene returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
// The scripts a world's frame runs (the bridge aside), and the styles it loads (it can't see the page's own).
const FRAME_SCRIPTS = ['worlds/sdk/pixel.js', 'worlds/sdk/people.js', 'worlds/sdk/props.js', 'worlds/sdk/creatures.js', 'worlds/sdk/animals.js', 'worlds/sdk/engine.js', 'worlds/farm/world.js'];
const FRAME_CODE = FRAME_SCRIPTS.map(web).join('\n');
const FRAME_CSS = ['base.css', 'worlds/sdk/engine.css'].map(web).join('\n');
// The page's scene and host, and the farm's frame, loaded together.
const code = ['scene.js', 'worlds.js', ...FRAME_SCRIPTS].map(web).join('\n;\n');
function load() {
  const window = { Agentville: { raw: h => { window.registered = h; } } };
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  const farm = window.AgentvilleFarm, scene = window.AgentvilleScene, host = window.TrackerFarm;
  return {
    ...scene, ...farm, spriteRows: window.Agentville.people.rows, mount: host.mount, update: host.update, unmount: host.unmount, select: host.select, colorOf: host.colorOf,
    // toScene, as the farm sees it: the page's plain-facts scene, turned into the farm's own
    toScene: (snap, o) => farm.farmScene(scene.toScene(snap, o)),
  };
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
  for (const l of looks) for (const k of ['hat', 'hatColor', 'hair', 'skin', 'bottomColor', 'extra']) assert.ok(l[k], k);
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
  const look = { hat: 'cap', hatColor: '#4a74c9', band: '#2c4a85', hair: '#5a3a22', skin: '#e0a878', top: 'shirt', bottom: 'overalls', bottomColor: '#3c5a99', extra: 'beard' };
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

test("the farm's buttons are in one Menu, top right: the dashboard's (with Broadcast), the farm's switches, the bell, help and zoom; nothing along the bottom", () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm();
  th.setScene({ plan: planWith(42), chrome: {}, fields: [], farmers: [], carts: [], mail: [], henhouse: { eggs: 0, roosting: 0 } });
  const shut = th.hud({ still: true, seasons: true, animals: true }), open = th.hud({ still: true, seasons: true, animals: true, menuOpen: true });
  const nav = shut.slice(shut.indexOf('<div class="px-nav">'));
  assert.match(nav, /^<div class="px-nav">\s*<button type="button" data-farm-menu aria-expanded="false"/);
  assert.match(nav, /class="px-menu" role="group" aria-label="Menu" hidden>/);
  const menu = nav.slice(nav.indexOf('class="px-menu"'));
  for (const attr of ['list', 'worlds', 'session', 'setup', 'side', 'broadcast', 'theme'].map(n => `data-farm-nav="${n}"`)
    .concat(['data-farm-follow', 'data-farm-resting', 'data-farm-bubbles', 'data-farm-animals', 'data-farm-sky', 'data-farm-season', 'data-farm-motion', 'data-farm-bell', 'data-farm-help', 'data-farm-zoom="-1"', 'data-farm-zoom="0"', 'data-farm-zoom="1"'])) {
    assert.ok(menu.includes(attr), `${attr} is in the menu`);
  }
  assert.doesNotMatch(shut, /px-tools/, 'no row along the bottom');
  assert.match(open, /data-farm-menu aria-expanded="true"/);
  assert.doesNotMatch(open, /class="px-menu"[^>]*hidden/);
});

test('a held season shows in the panel with a 📌 and your real 5-hour use, its tooltip saying it is held; live, as before', () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm();
  th.setScene({ plan: planWith(42), chrome: {}, fields: [], farmers: [], carts: [], mail: [], henhouse: { eggs: 0, roosting: 0 } }); // 42%: summer, live
  const line = mode => {
    const html = th.hud({ still: true, seasonMode: mode, seasons: true });
    const [, title, inner] = /class="px-season" title="([^"]*)">([\s\S]*?)<\/div>/.exec(html);
    return { title: title.replace(/&#39;/g, "'"), text: inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(), button: /data-farm-season[^>]*>[\s\S]*?Season: (\w+)/.exec(html)?.[1] };
  };
  const held = line('winter');
  assert.match(held.text, /^winter 📌 · 5-hour 42%$/);
  assert.match(held.title, /held/i);
  assert.match(held.title, /not live/);
  assert.match(held.title, /summer/, 'and what the live one would be');
  assert.equal(held.button, 'winter');
  const live = line('live');
  assert.equal(live.text, 'summer');
  assert.doesNotMatch(live.title, /held/i);
  assert.match(live.title, /follows your plan's 5-hour limit: 42% used/);
  assert.equal(live.button, 'live');
});

test('the farm draws the season shown (PXG.season), not the live one: frost, ice and snow for a held winter', () => {
  const window = { Agentville: { raw: () => {} } };
  const fills = [];
  const ctx = { fillRect: (x, y, w, h) => fills.push({ x, y, w, h, c: ctx._c }), set fillStyle(c) { ctx._c = c; }, _c: null, globalAlpha: 1 };
  vm.runInNewContext(`${code}\n;window.__PXG = PXG;`, { window, console, Math: Object.assign(Object.create(Math), { random: () => 0 }), Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm(), PXG = window.__PXG, { ink } = window.AgentvilleFarm;
  const trough = () => fills.find(f => f.x === 87 && f.y === 155 && f.w === 10 && f.h === 1)?.c; // the water in the animals' trough, at (92, 158)
  th.relayout(window.AgentvilleFarm.layoutFor([]));
  th.setScene({ plan: planWith(10), chrome: {}, fields: [], farmers: [], carts: [], mail: [], henhouse: { eggs: 0, roosting: 0 } }); // 10%: spring, live
  Object.assign(PXG, { ctx, T: 0, animals: true, taken: new Set() });
  const look = shown => {
    PXG.season = shown;
    fills.length = 0;
    th.ground();
    const parts = [];
    th.ambient(1, p => parts.push(p));
    return { ice: trough() === ink('#d8eef8'), water: trough() === ink('#5ab4ff'), snow: parts.some(p => p.color === '#ffffff'), petals: parts.some(p => p.color === '#f4b6c2') };
  };
  assert.deepEqual(look('winter'), { ice: true, water: false, snow: true, petals: false }, 'held winter: an icy trough, and snow');
  assert.deepEqual(look(null), { ice: false, water: true, snow: false, petals: true }, 'nothing from the engine yet: the live season (spring)');
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

test('the farm is a modern farmstead: a black barn with a glass door, a timber house with glass walls and a deck, a black tower silo; the door, the gauge, the porch spots and the lights stay where they work', () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm();
  th.setScene({ plan: planWith(42), chrome: {}, fields: [], farmers: [], carts: [], mail: [], henhouse: { eggs: 0, roosting: 0 } });
  const rects = [];
  th.bg((x, y, w, h, c) => rects.push([x, y, w, h, c]), 'summer', { x0: 0, x1: 400, y0: 0, y1: 300 });
  const drew = (x, y, w, h, c) => rects.some(r => r.join() === [x, y, w, h, c].join());
  // the barn: a six-pane glass door, where new farmers still walk out
  const panes = [48, 59, 70].flatMap(x => [47, 64].map(y => [x, y, 9, 16]));
  for (const p of panes) assert.ok(drew(...p, '#a9cde6'), `a glass pane in the barn door at ${p}`);
  const [doorX] = th.spawn();
  assert.ok(doorX > 48 && doorX < 79, `new farmers walk out of the glass door (${doorX})`);
  // the silo: a black tower, its gauge window where the week's grain is drawn each frame
  assert.ok(drew(92, 16, 20, 64, '#26262b'), 'black steel');
  assert.ok(drew(98, 26, 8, 48, '#3a3f45'), "the gauge window, where the week's grain shows");
  // the house: glass walls either side of a glass door, string lights, planters clear of the six porch spots
  assert.ok(drew(142, 36, 42, 20, '#a9cde6') && drew(216, 36, 42, 20, '#a9cde6') && drew(191, 36, 18, 32, '#a9cde6'), 'glass walls over a timber skirt, and a glass door');
  assert.ok(rects.filter(r => r[4] === '#ffe08a').length >= 15, 'string lights along the eave');
  const planters = rects.filter(r => r[4] === '#3f3f45' && r[1] >= 60), spots = [142, 166, 190, 210, 234, 258];
  assert.equal(planters.length, 2, 'a planter at each end of the deck');
  for (const r of planters) assert.ok(spots.every(x => r[0] + r[2] <= x - 4 || r[0] >= x + 5), `the planter at ${r} keeps clear of the porch spots`);
  // at night: every light is on a building; panes light up one by one (their frames stay dark), and only above the heads of
  // the farmers on the porch and at the barn door (the engine paints lit panes over whatever stands in front)
  const lights = th.lights(), boxes = [[36, 12, 92, 82], [88, 0, 118, 82], [122, 0, 278, 92]];
  for (const [, , , core] of lights) if (core) assert.ok(boxes.some(([x0, y0, x1, y1]) => core[0] >= x0 && core[1] >= y0 && core[0] + core[2] <= x1 && core[1] + core[3] <= y1), `a light on a building (${core})`);
  const lit = p => lights.some(([, , , c]) => c && [0, 1, 2, 3].every(i => c[i] === p[i]));
  for (const p of panes.filter(([, y]) => y === 47)) assert.ok(lit(p), `the barn door's upper pane ${p} lights at night`);
  for (const p of [[142, 36, 10, 20], [153, 36, 10, 20], [164, 36, 10, 20], [175, 36, 9, 20], [216, 36, 10, 20], [227, 36, 10, 20], [238, 36, 10, 20], [249, 36, 9, 20], [191, 36, 9, 18], [201, 36, 8, 18]]) assert.ok(lit(p), `the house's glass ${p} lights at night`);
  for (const [, , , c] of lights) if (c) assert.ok(c[1] + c[3] <= (c[0] >= 122 ? 58 : 63), `the light at ${c} stays above the heads of farmers on the porch (from y 62) and at the barn door (from y 71)`);
  assert.ok(!lights.some(([x, y]) => x === 213 && y === 66), "today's porch lamp is gone with the porch");
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

test('Windows paths: a folder inside a repo is that repo, and a project and its repos group, whichever separator the path has', () => {
  const { fieldOf, projectOf, layoutFor } = load();
  const b = String.fromCharCode(92);
  const w = (...parts) => `C:${b}${parts.join(b)}`;
  const repos = [repo(w('code', 'app')), repo(w('code', 'app', 'packages', 'ui')), repo(w('code', 'apple'))];
  assert.equal(fieldOf(agent('a', { cwd: w('code', 'app', 'src') }), repos), w('code', 'app'));
  assert.equal(fieldOf(agent('a', { cwd: w('code', 'app', 'packages', 'ui', 'src') }), repos), w('code', 'app', 'packages', 'ui'), 'the deepest repo holding it');
  assert.equal(fieldOf(agent('a', { cwd: w('code', 'appendix') }), repos), null, 'a longer name is not inside');
  assert.equal(fieldOf(agent('a', { cwd: 'C:/code/app/src' }), [repo('C:/code/app')]), 'C:/code/app', 'a path with forward slashes, as Git prints one');
  assert.equal(projectOf(w('Users', 'me', 'shop', 'api')), 'C:/Users/me/shop');
  assert.equal(projectOf(w('Users', 'me', 'code', 'a')), null, 'a catch-all folder holds unrelated repos');
  assert.equal(projectOf(w('work', 'proj', 'api')), null, 'the drive letter is not a folder: this is as deep as /work/proj/api');
  assert.equal(projectOf('/Users/me/shop/api'), '/Users/me/shop', 'a Mac path is read as before');
  const f = (key, over = {}) => ({ key, ...over });
  const api = w('Users', 'me', 'shop', 'api'), web = w('Users', 'me', 'shop', 'web');
  const L = plain(layoutFor([f(w('Users', 'me', 'solo')), f(api), f(w('Users', 'me', 'other')), f(web)]));
  assert.deepEqual(L.groups, [{ name: 'shop', slots: [L.ST.find(x => x.key === api).i, L.ST.find(x => x.key === web).i] }], 'shop is one project, named by its folder');
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
  // every script its frame runs: the farm, the bridge, the brand mark
  for (const [file, code] of [['world.js', FRAME_CODE], ['bridge.js', web('worlds/sdk/bridge.js')], ['brand.js', web('brand.js')]]) {
    for (const banned of ['localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'document.cookie', 'x-tracker-token', 'opts.token', 'TOKEN', 'opts.diary', 'window.TrackerFarm']) assert.ok(!code.includes(banned), `${file}: ${banned}`);
  }
});

test('the farm’s animals: seven kinds, thirteen animals; never a chicken, the Explore dog or a pigeon; lines of 40 at most; 2 to 4 actions each', () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(`${code}\n;window.CREATURES = CREATURES;`, { window, console, Math, Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm();
  const cast = plain(th.animals().cast); // animals() is { cast, gags, play }
  assert.deepEqual(cast.map(c => [c.kind, c.count ?? 1]), [['cow', 2], ['goat', 2], ['sheepdog', 1], ['ostrich', 1], ['lion', 1], ['tiger', 1], ['duck', 5]]);
  for (const c of cast) {
    assert.ok(window.CREATURES[c.kind], c.kind);
    assert.ok(!['chicken', 'dog', 'pigeon'].includes(c.kind), `${c.kind} is taken on the farm`);
    assert.ok(c.actions.length >= 2 && c.actions.length <= 4, `${c.kind} actions`);
    for (const lines of Object.values(c.lines)) for (const l of lines) assert.ok(l.length <= 40, `${c.kind}: ${l}`);
  }
  const ducks = cast.find(c => c.kind === 'duck');
  assert.deepEqual(ducks.looks, ['drake', 'hen', 'duckling', 'duckling', 'duckling']);
  assert.deepEqual(ducks.actions.map(a => a.label), ['Feed bread', 'Quack back']);
});

test('where the farm’s animals may walk: the whole farm, but never a crop bed, a building, the carts’ row, the pond, the hammocks or the henhouse', () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm();
  th.relayout(window.AgentvilleFarm.layoutFor([{ key: '/a', name: 'a' }, { key: '/b', name: 'b' }, { key: '/c', name: 'c' }, { key: '/d', name: 'd' }]));
  const roam = plain(th.roam()), avoid = plain(th.avoid());
  const inRoam = (x, y) => roam.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  for (const [x, y, where] of [[20, 160, 'the yard'], [60, 86, 'the lane'], [200, 80, 'the porch'], [300, 300, 'the meadow below the fields'], [394, 60, 'by the scarecrows'], [120, 200, 'the path beside the fields']]) assert.ok(inRoam(x, y), where);
  const covers = (x, y) => avoid.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  assert.ok(covers(42, 210), 'the pond');
  assert.ok(covers(97, 204) && covers(97, 224), 'the hammocks');
  assert.ok(covers(20, 115), 'the henhouse');
  assert.ok(covers(70, 120), 'and its run, where the hens are subagents');
  assert.ok(covers(388, 87) && covers(313, 87), 'the row where the tool carts park');
  assert.ok(th.fieldAt(174, 120) && th.buildingAt(60, 40), 'beds and buildings are the engine’s to keep them off (fieldAt, buildingAt)');
});

test('the farm’s animals wander the whole farm, out of the yard, and never onto a bed, a building or a place kept off', () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(`${code}\n;window.__kit = { makeAnimals, seededRandom };`, { window, console, Math, Date, JSON, Map, Set });
  const farm = window.AgentvilleFarm, th = farm.makeFarm();
  th.relayout(farm.layoutFor([{ key: '/a', name: 'a' }, { key: '/b', name: 'b' }, { key: '/c', name: 'c' }, { key: '/d', name: 'd' }]));
  th.setScene({ plan: null, chrome: {}, fields: [], farmers: [], carts: [], mail: [], henhouse: { eggs: 0, roosting: 0 } });
  const avoid = plain(th.avoid()), inAvoid = (x, y) => avoid.some(r => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
  const a = window.__kit.makeAnimals(th.animals(), { random: window.__kit.seededRandom(3) });
  a.place({ roam: th.roam(), avoid: th.avoid(), perches: th.perches(), spots: th.spots(), blocked: (x, y) => Boolean(th.fieldAt(x, y) || th.buildingAt?.(x, y)) });
  let out = 0;
  for (let i = 0; i < 12000; i++) {
    a.tick(0.1);
    for (const o of a.list()) {
      if (o.kind === 'duck') continue;
      if (o.x > 112 || o.y < 94) out++; // out of the old yard
      assert.ok(!th.fieldAt(o.x, o.y) && !th.buildingAt(o.x, o.y) && !inAvoid(o.x, o.y), `${o.id} at (${o.x},${o.y})`);
    }
  }
  assert.ok(out > 1000, `they leave the yard (${out} animal-ticks out of it)`);
});

test('with animals on, the scenery duck is gone (the ducks are the animals’ now); off, it is back as it was', () => {
  // The scenery duck is drawn in white at (dx, 206): count white fills around the pond with PXG.animals on and off.
  const window = { Agentville: { raw: () => {} } };
  const fills = [];
  const ctx = { fillRect: (x, y, w, h) => fills.push({ x, y, w, h, c: ctx._c }), set fillStyle(c) { ctx._c = c; }, _c: null, globalAlpha: 1 };
  vm.runInNewContext(`${code}\n;window.__PXG = PXG;`, { window, console, Math, Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm();
  th.relayout(window.AgentvilleFarm.layoutFor([]));
  window.__PXG.ctx = ctx;
  const whiteOnPond = () => fills.filter(f => f.y >= 203 && f.y <= 210 && f.x >= 20 && f.x <= 64 && /#fff(fff)?$/i.test(String(f.c))).length;
  window.__PXG.animals = false;
  th.ground();
  const off = whiteOnPond();
  fills.length = 0;
  window.__PXG.animals = true;
  th.ground();
  assert.ok(off > 0 && whiteOnPond() === 0, `white fills on the pond: ${off} off, ${whiteOnPond()} on`);
});

test('the farm’s gags, play and habits are written right: known steps, roles in its cast, lines of 40 at most', () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(`${code}\n;window.CREATURES = CREATURES;`, { window, console, Math, Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm();
  const { cast, gags, play } = plain(th.animals());
  const kinds = new Set(cast.map(c => c.kind));
  const STEPS = new Set(['go', 'chase', 'say', 'pose', 'wear', 'wait', 'fx', 'stay']);
  assert.deepEqual(gags.map(g => g.id).sort(), ['bucket', 'hammock', 'hat', 'nibble', 'startled', 'tag'].sort());
  for (const g of [...gags, ...play]) {
    for (const k of Object.keys(g.needs)) assert.ok(kinds.has(k) || ['farmer', 'chicken', 'spot'].includes(k), `${g.id}: ${k}`);
    for (const s of g.steps) assert.ok(Object.keys(s).some(k => STEPS.has(k)), `${g.id}: ${JSON.stringify(s)}`);
  }
  for (const c of cast) for (const lines of Object.values(c.lines)) for (const l of lines) assert.ok(l.length <= 40, l);
  for (const g of [...gags, ...play]) for (const lines of Object.values(g.lines ?? {})) for (const l of lines) assert.ok(l.length <= 40, l);
  assert.ok(cast.find(c => c.kind === 'goat').habits.includes('climb'));
  assert.ok(play.length >= 3, 'play: a stick for the dog, a goat to pet, a nap by the lion');
});

test('the farm says when the hammock is free, and turns a field’s weather into events for the animals', () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  const farm = window.AgentvilleFarm, th = farm.makeFarm();
  const sceneOf = (weather, nap) => ({ plan: null, chrome: {}, fields: [{ key: '/r', name: 'r', weather, prs: { open: [], merged: [] } }], farmers: nap ? [{ id: 'n', nap: true, state: 'idle', field: null }] : [], carts: [], mail: [], henhouse: { eggs: 0, roosting: 0 } });
  th.relayout(farm.layoutFor([{ key: '/r', name: 'r' }]));
  th.setScene(sceneOf(null, false));
  assert.equal(th.spotFree('hammock'), true);
  const ev = plain(th.setScene(sceneOf('rain', true)));
  assert.equal(th.spotFree('hammock'), false, 'a farmer napping: taken');
  assert.deepEqual(ev.filter(e => e.kind === 'deployFailed').length, 1);
  assert.equal(ev.find(e => e.kind === 'deployFailed').text, '');
  assert.equal(plain(th.setScene(sceneOf('rain', true))).filter(e => e.kind).length, 0, 'not again while it rains');
  assert.equal(plain(th.setScene(sceneOf('rainbow', true))).filter(e => e.kind === 'deployOk').length, 1);
});

test('a farmer whose hat a goat has is drawn without it (and without its model pin)', () => {
  const draw = hatless => {
    const sprite = new Set(), main = new Set();
    const g = { set fillStyle(c) { g._c = c; }, get fillStyle() { return g._c; }, fillRect() { sprite.add(g._c); }, clearRect() {}, _c: '' };
    const document = { createElement: () => ({ getContext: () => g }) };
    const window = { Agentville: { raw: () => {} } };
    vm.runInNewContext(`${code}\n;window.__PXG = PXG;`, { window, document, console, Math, Date, JSON, Map, Set });
    const farm = window.AgentvilleFarm, scene = window.AgentvilleScene;
    let f = null;
    for (let i = 0; !f; i++) { // a farmer with a hat whose colour it wears nowhere else
      const c = farm.farmScene(scene.toScene(snapOf([agent(`a${i}`, { state: 'idle', model: 'claude-opus-4-1' })], [repo('/x')]))).farmers[0], l = c.look;
      if (l.hat !== 'none' && ![l.hair, l.skin, l.overalls, l.band].map(farm.ink).includes(farm.ink(l.hatColor))) f = c;
    }
    const ctx = { set fillStyle(c) { ctx._c = c; }, get fillStyle() { return ctx._c; }, fillRect() { main.add(ctx._c); }, drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {}, globalAlpha: 1, _c: '' };
    window.__PXG.ctx = ctx; window.__PXG.T = 0;
    farm.makeFarm().drawChar({ ...f, family: 'opus' }, { x: 100, y: 100, walk: false, zone: 'charge', hatless });
    return { sprite, main, hat: farm.ink(f.look.hatColor) };
  };
  const on = draw(false), off = draw(true);
  assert.ok(on.sprite.has(on.hat), 'its hat');
  assert.ok(!off.sprite.has(off.hat), 'no hat');
  assert.ok(on.main.has('#8a5fc0') && !off.main.has('#8a5fc0'), 'the pin goes with the hat');
});

test('the goats get up on both the woodpile and the rock, and neither is on the shade tree', () => {
  const window = { Agentville: { raw: () => {} } };
  vm.runInNewContext(`${code}\n;window.__kit = { makeAnimals, seededRandom };`, { window, console, Math, Date, JSON, Map, Set });
  const farm = window.AgentvilleFarm, th = farm.makeFarm(), L = th.relayout(farm.layoutFor([{ key: '/a', name: 'a' }, { key: '/b', name: 'b' }]));
  th.setScene({ plan: null, chrome: {}, fields: [], farmers: [], carts: [], mail: [], henhouse: { eggs: 0, roosting: 0 } });
  const perches = plain(th.perches()), crown = [66, L.GRID.y1 - 38]; // the shade tree's crown, r 21
  for (const [x, y] of perches) assert.ok(Math.hypot(x - crown[0], y - crown[1]) > 27, `a perch on the shade tree (${x},${y})`);
  const used = new Set();
  for (const seed of [1, 2]) {
    const a = window.__kit.makeAnimals(th.animals(), { random: window.__kit.seededRandom(seed) });
    a.place({ roam: th.roam(), avoid: th.avoid(), perches: th.perches(), spots: th.spots(), blocked: (x, y) => Boolean(th.fieldAt(x, y) || th.buildingAt?.(x, y)) });
    for (let i = 0; i < 24000 && used.size < perches.length; i++) { a.tick(0.1); for (const o of a.list()) if (o.kind === 'goat' && o.lift) used.add(`${o.x},${o.y}`); }
  }
  assert.equal(used.size, perches.length, `goats stood on ${[...used].join(' ')} of ${perches.map(p => `${p[0]},${p[1]}`).join(' ')}`);
});

// The farm's panel and buttons (its hud), pinned byte for byte as they were before they moved into the
// engine's shared panelHud. A stand-in canvas turns each pixel image (a text, an icon) into a token of its
// size, its colours in order and a hash of its pixels, so the colours and the icons are pinned too; the
// brand mark is a stand-in that says what it was asked for.
function farmHud({ scene, params }) {
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const document = {
    createElement: () => {
      const calls = [], colors = [];
      const g = { set fillStyle(c) { if (!colors.includes(c)) colors.push(c); calls.push(c); }, fillRect: (x, y, w, h) => { calls.push(`${x},${y},${w},${h}`); } };
      return { width: 0, height: 0, getContext: () => g, toDataURL() { return `px:${this.width}x${this.height}:${colors.join('/')}:${fnv(calls.join(';'))}`; } };
    },
  };
  const window = { Agentville: { raw: () => {}, svg: o => `<svg data-brand="${o.size} ${o.cls}"></svg>` } };
  vm.runInNewContext(FRAME_CODE, { window, document, console, Math, Date, JSON, Map, Set });
  const th = window.AgentvilleFarm.makeFarm();
  th.setScene(scene());
  return th.hud(params);
}
const hudScene = (plan, chrome, farmers) => ({ plan, chrome, fields: [], farmers, carts: [], mail: [], henhouse: { eggs: 0, roosting: 0 } });
const SEASON_WORDS = { switch: 'Season', spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' }; // what the engine hands the farm: its own words
const HUD_CASES = {
  // live, a busy day: every count, gauge and button, two waiting on you, an error to escape
  live: {
    scene: () => hudScene(planWith(30, 55), {
      counts: { waiting: 2, working: 3, yourTurn: 1, idle: 2, stale: 1, collisions: 1 }, oldestWaiting: Date.now() - 5 * 60_000, subagentsRunning: 2, agents: 9, asking: 1,
      ram: { usedMb: 2300, totalMb: 16384 }, cpu: { used: 140, cores: 8 }, collector: { cpu: 1.5, rssMb: 80 }, errors: ['GitHub: rate limited <b>'],
    }, [{ id: 'a', state: 'waiting', cost: 1.25, compactions: 2 }, { id: 'b', state: 'working', cost: 3.5, compactions: 1 }, { id: 'c', state: 'turn', question: 'Which one?' }]),
    params: { still: false, zoom: 1, saysOn: true, skyMode: 'live', seasonMode: 'live', seasons: true, seasonNames: SEASON_WORDS, follow: false, canFollow: true, restingHidden: null, bell: false, nav: { live: true, side: false, theme: 'dark' }, panelOpen: true, animals: null },
  },
  // the Season switch holding winter at 42% (live: summer); following, resting hidden, motion off, offline, the sidebar open
  heldWinter: {
    scene: () => hudScene(planWith(42), { counts: { waiting: 0, working: 1, yourTurn: 0, idle: 0, stale: 0, collisions: 0 }, agents: 1, ram: { usedMb: 512 } }, [{ id: 'a', state: 'working' }]),
    params: { still: true, zoom: 2, saysOn: false, skyMode: 'night', seasonMode: 'winter', seasons: true, seasonNames: SEASON_WORDS, follow: true, canFollow: true, restingHidden: 3, bell: true, nav: { live: false, side: true, theme: 'light' }, panelOpen: true, animals: false },
  },
  // the panel folded, the animals on; spring held with no 5-hour reading, nobody picked; the rest left to their defaults
  foldedAnimals: {
    scene: () => hudScene(null, {}, []),
    params: { still: false, zoom: 0.75, skyMode: 'day', seasonMode: 'spring', seasons: true, canFollow: false, nav: { theme: 'auto' }, panelOpen: false, animals: true },
  },
};
// What hud() gave for each case, recorded on the farm's own hud() before the move; recorded again on main's
// own farm hud() (2c3d7f7) when its Menu replaced the two button rows. Never re-record these to make a change pass.
// A line of only spaces is written as ${pad(n)}, so no editor trims it.
const pad = n => ' '.repeat(n);
const FROZEN_HUD = {
  live: `<div class="px-stats">
            <button type="button" class="px-brand" data-farm-panel title="Fold this panel away" aria-expanded="true"><svg data-brand="18 px-logo"></svg><i class="pxt" aria-hidden="true" style="width:116.0px;height:20.0px;background-image:url(px:58x10:#2a1d14/#ffe8a3:71586e5b)"></i><span class="px-sr">AGENTVILLE</span><i class="px-live" title="Live"></i><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#c9b48a:9cd4bbc7)"></i><span class="px-sr">-</span></button>
            <div class="px-line"><span title="What the sessions on the farm have cost so far (each one's purse; from the mod)"><b class="coin"></b><i class="pxt" aria-hidden="true" style="width:52.0px;height:20.0px;background-image:url(px:26x10:#2a1d14/#fff3d6:145977db)"></i><span class="px-sr">$4.75</span></span><span title="Harvests: each time a session's conversation was compacted"><b class="basket"></b><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#2a1d14/#fff3d6:69754028)"></i><span class="px-sr">3 harvested</span></span><span class="px-season" title="The season follows your plan&#39;s 5-hour limit: 30% used. Spring while it is fresh, then summer and autumn; winter when it is nearly used up"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429:d67156b4)"></i><i class="pxt" aria-hidden="true" style="width:70.0px;height:20.0px;background-image:url(px:35x10:#2a1d14/#fff3d6:b0686e96)"></i><span class="px-sr">summer</span></span></div>
            <div class="px-kpis">
              <button type="button" class="px-kpi hot" data-farm-state="waiting" title="Agents waiting on you (a question or a permission): click for the first"><span class="px-kpi-ico k-wait"><i class="pxt" aria-hidden="true" style="width:4.0px;height:20.0px;background-image:url(px:2x10:#ffffff:9e741914)"></i><span class="px-sr">!</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:f8702c9c)"></i><span class="px-sr">2</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:142.0px;height:20.0px;background-image:url(px:71x10:#a9c79a:d548d197)"></i><span class="px-sr">waiting on you</span><br><i class="pxt" aria-hidden="true" style="width:96.0px;height:20.0px;background-image:url(px:48x10:#c9b48a:d5c8634d)"></i><span class="px-sr">oldest 5m</span></span></button>
              <button type="button" class="px-kpi" data-farm-state="working" title="Agents at work: click for the first"><span class="px-kpi-ico k-work"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:e3235385)"></i><span class="px-sr">&gt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:7d4c66e4)"></i><span class="px-sr">3</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#a9c79a:4ab18612)"></i><span class="px-sr">working</span><br><i class="pxt" aria-hidden="true" style="width:172.0px;height:20.0px;background-image:url(px:86x10:#c9b48a:6e0531e2)"></i><span class="px-sr">2 with subagents</span></span></button>
              <button type="button" class="px-kpi hot" data-farm-state="turn" title="Agents whose turn ended: it&#39;s yours. Click for the first"><span class="px-kpi-ico k-turn"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:323269c0)"></i><span class="px-sr">&lt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:8.0px;height:20.0px;background-image:url(px:4x10:#2a1d14/#fff3d6:83763ee2)"></i><span class="px-sr">1</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:98.0px;height:20.0px;background-image:url(px:49x10:#a9c79a:e49dcf43)"></i><span class="px-sr">your turn</span><br><i class="pxt" aria-hidden="true" style="width:256.0px;height:20.0px;background-image:url(px:128x10:#c9b48a:12c6592b)"></i><span class="px-sr">1 ask you · 2 idle · 1 stale</span></span></button>
              <button type="button" class="px-kpi hot" disabled title="Two agents writing one repo"><span class="px-kpi-ico k-collide"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#ffffff:83c8e004)"></i><span class="px-sr">⚠</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:8.0px;height:20.0px;background-image:url(px:4x10:#2a1d14/#fff3d6:83763ee2)"></i><span class="px-sr">1</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:90.0px;height:20.0px;background-image:url(px:45x10:#a9c79a:2a874721)"></i><span class="px-sr">collisions</span><br><i class="pxt" aria-hidden="true" style="width:156.0px;height:20.0px;background-image:url(px:78x10:#c9b48a:46831424)"></i><span class="px-sr">two in one repo</span></span></button>
            </div>
            <div class="px-gauges">
              <span class="px-gauge" title="Memory used by the agents, of this computer's"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:4d724c39)"></i><span class="px-sr">RAM</span><span class="px-bar"><i class="ok" style="width:14%"></i></span><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#2a1d14/#fff3d6:21697233)"></i><span class="px-sr">2.2 GB</span><i class="pxt" aria-hidden="true" style="width:96.0px;height:20.0px;background-image:url(px:48x10:#c9b48a:235e5bd0)"></i><span class="px-sr">of 16.0 GB</span></span>
              <span class="px-gauge" title="CPU used by the agents: 140% of one core, 8 cores"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:d77b3be4)"></i><span class="px-sr">CPU</span><span class="px-bar"><i class="ok" style="width:18%"></i></span><i class="pxt" aria-hidden="true" style="width:32.0px;height:20.0px;background-image:url(px:16x10:#2a1d14/#fff3d6:acf1cb9c)"></i><span class="px-sr">18%</span><i class="pxt" aria-hidden="true" style="width:164.0px;height:20.0px;background-image:url(px:82x10:#c9b48a:b1f1621c)"></i><span class="px-sr">of this computer</span></span>
              <span class="px-gauge" title="Your plan's 5-hour limit (from the mod)"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#a9c79a:77a45452)"></i><span class="px-sr">5H</span><span class="px-bar"><i class="ok" style="width:30%"></i></span><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#2a1d14/#fff3d6:7df674fb)"></i><span class="px-sr">30%</span><i class="pxt" aria-hidden="true" style="width:112.0px;height:20.0px;background-image:url(px:56x10:#c9b48a:3961ca8e)"></i><span class="px-sr">5-hour limit</span></span>
              <span class="px-gauge" title="Your plan's weekly limit (from the mod)"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#a9c79a:7d693448)"></i><span class="px-sr">WEEK</span><span class="px-bar"><i class="warn" style="width:55%"></i></span><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#2a1d14/#fff3d6:71287b6d)"></i><span class="px-sr">55%</span><i class="pxt" aria-hidden="true" style="width:92.0px;height:20.0px;background-image:url(px:46x10:#c9b48a:170a2ba1)"></i><span class="px-sr">this week</span></span>
              <span class="px-gauge" title="The tracker itself"><i class="pxt" aria-hidden="true" style="width:238.0px;height:20.0px;background-image:url(px:119x10:#c9b48a:b6098418)"></i><span class="px-sr">tracker 1.5% CPU · 80 MB</span></span>
            </div>
            <div class="px-err">⚠ GitHub: rate limited &lt;b&gt;</div>
            <button type="button" class="px-need" data-farm-need title="Open the first agent that needs you"><i class="pxt" aria-hidden="true" style="width:112.0px;height:20.0px;background-image:url(px:56x10:#5a1f19/#ffffff:0a524b9c)"></i><span class="px-sr">2 need you</span></button>
          </div>
          <div class="px-nav">
            <button type="button" data-farm-menu aria-expanded="false" title="The dashboard's buttons, the farm's switches, the bell, help and zoom"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:b982a223)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:b8e00e2f)"></i><span class="px-sr">Menu</span></button>
            <div class="px-menu" role="group" aria-label="Menu" hidden>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#8b5a2b:715e2c47)"></i><span class="px-sr">DASHBOARD</span></div>
              <div class="px-menu-grid">
                <button type="button" data-farm-nav="list" title="Back to the list view"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:5f5651a6)"></i><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#4e3626:65708540)"></i><span class="px-sr">LIST</span></button>
                <button type="button" data-farm-nav="worlds" title="Choose a world"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#a9dcf7/#3f9b3a:081855c5)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:a2881fd5)"></i><span class="px-sr">WORLD</span></button>
                <button type="button" data-farm-nav="session" title="Start a new Claude Code session in a folder, or resume a past one"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:2d04caf6)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:a4edc5ff)"></i><span class="px-sr">SESSION</span></button>
                <button type="button" data-farm-nav="setup" title="Your Claude Code setup: plugins and skills (and what each costs in context), MCP servers, permission rules"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:af1418b8)"></i><i class="pxt" aria-hidden="true" style="width:128.0px;height:20.0px;background-image:url(px:64x10:#4e3626:bb190415)"></i><span class="px-sr">CLAUDE CODE</span></button>
                <button type="button" data-farm-nav="side" title="Show the selected farmer&#39;s answer box, activity and files beside the farm" aria-pressed="false"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:4ee7c8c5)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:51a95a73)"></i><span class="px-sr">SIDEBAR</span></button>
                <button type="button" data-farm-nav="broadcast" title="Message several agents at once: all of them, or the ones you pick"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:cbfe0223)"></i><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#4e3626:e91e76da)"></i><span class="px-sr">BROADCAST</span></button>
                <button type="button" data-farm-nav="theme" title="Theme: dark, light, or auto (as macOS is): click to change"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429/#f4ecd8:dd5e712e)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:5dd07217)"></i><span class="px-sr">DARK</span></button>
              </div>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#8b5a2b:d8532a2d)"></i><span class="px-sr">ON THE FARM</span></div>
              <button type="button" data-farm-follow title="Keep the farmer you picked in the middle of the view (zooms in); dragging the view turns it off"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#e04a3a:cc792b8f)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:6be19e76)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Follow: off</span></button>
              <button type="button" data-farm-resting title="Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:6a01f51d)"></i><i class="pxt" aria-hidden="true" style="width:74.0px;height:20.0px;background-image:url(px:37x10:#4e3626:902464b2)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#8b5a2b:12db36ba)"></i></span><span class="px-sr">Resting: shown</span></button>
              <button type="button" data-farm-bubbles title="Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#ffffff:d27c2259)"></i><i class="pxt" aria-hidden="true" style="width:78.0px;height:20.0px;background-image:url(px:39x10:#4e3626:acf04316)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Bubbles: on</span></button>
${pad(14)}
              <button type="button" data-farm-sky title="The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429/#4e3626:380cd1fd)"></i><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#4e3626:04764f1d)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#8b5a2b:02ff8622)"></i></span><span class="px-sr">Sky: live</span></button>
              <button type="button" data-farm-season title="The season: live follows your plan&#39;s 5-hour limit (spring while it is fresh, winter when it is nearly used up); or hold one: spring, summer, autumn or winter. The panel&#39;s 📌 shows your real 5-hour use meanwhile"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429:d67156b4)"></i><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#4e3626:dccd7184)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#8b5a2b:02ff8622)"></i></span><span class="px-sr">Season: live</span></button>
              <button type="button" class="px-motion" data-farm-motion title="Walking and animation on the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#3f9b3a:ff6f425d)"></i><i class="pxt" aria-hidden="true" style="width:62.0px;height:20.0px;background-image:url(px:31x10:#4e3626:01d5614b)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Motion: on</span></button>
              <div class="px-menu-sep"></div>
              <button type="button" data-farm-bell title="A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you (in the list view too)"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:a9646b11)"></i><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#4e3626:46160bc0)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Bell: off</span></button>
              <button type="button" class="px-info" data-farm-help aria-label="How to read the farm" title="How to read the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:afe15026)"></i><i class="pxt" aria-hidden="true" style="width:42.0px;height:20.0px;background-image:url(px:21x10:#4e3626:afcb62cc)"></i><span class="px-sr">Help</span></button>
              <div class="px-menu-zoom"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#8b5a2b:65bf7a88)"></i><span class="px-sr">ZOOM</span><span class="px-zoombar" title="Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in"><button type="button" data-farm-zoom="-1" aria-label="Zoom out"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#4e3626:dcfc19a0)"></i><span class="px-sr">-</span></button><button type="button" data-farm-zoom="0" title="Show the whole farm"><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#4e3626:7305c299)"></i><span class="px-sr">100%</span></button><button type="button" data-farm-zoom="1" aria-label="Zoom in"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#4e3626:9e3f96e4)"></i><span class="px-sr">+</span></button></span></div>
            </div>
          </div>`,
  heldWinter: `<div class="px-stats">
            <button type="button" class="px-brand" data-farm-panel title="Fold this panel away" aria-expanded="true"><svg data-brand="18 px-logo"></svg><i class="pxt" aria-hidden="true" style="width:116.0px;height:20.0px;background-image:url(px:58x10:#2a1d14/#ffe8a3:71586e5b)"></i><span class="px-sr">AGENTVILLE</span><i class="px-live off" title="Disconnected from the collector: retrying"></i><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#c9b48a:9cd4bbc7)"></i><span class="px-sr">-</span></button>
            <div class="px-line"><span title="What the sessions on the farm have cost so far (each one's purse; from the mod)"><b class="coin"></b><i class="pxt" aria-hidden="true" style="width:52.0px;height:20.0px;background-image:url(px:26x10:#2a1d14/#fff3d6:71740e0b)"></i><span class="px-sr">$0.00</span></span><span title="Harvests: each time a session's conversation was compacted"><b class="basket"></b><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#2a1d14/#fff3d6:afd0b32e)"></i><span class="px-sr">0 harvested</span></span><span class="px-season" title="Held at winter by the Season switch, not live. The live season would be summer (your plan&#39;s 5-hour limit: 42% used). The switch goes back to live after winter"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#a9dcf7:4c780485)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#2a1d14/#fff3d6:b54f1892)"></i><span class="px-sr">winter</span> 📌 <i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#c9b48a:ff3bb612)"></i><span class="px-sr">· 5-hour 42%</span></span></div>
            <div class="px-kpis">
              <button type="button" class="px-kpi" disabled title="Agents waiting on you (a question or a permission): click for the first"><span class="px-kpi-ico k-wait"><i class="pxt" aria-hidden="true" style="width:4.0px;height:20.0px;background-image:url(px:2x10:#ffffff:9e741914)"></i><span class="px-sr">!</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:75d8935e)"></i><span class="px-sr">0</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:142.0px;height:20.0px;background-image:url(px:71x10:#a9c79a:d548d197)"></i><span class="px-sr">waiting on you</span><br><i class="pxt" aria-hidden="true" style="width:82.0px;height:20.0px;background-image:url(px:41x10:#c9b48a:a479816f)"></i><span class="px-sr">all clear</span></span></button>
              <button type="button" class="px-kpi" data-farm-state="working" title="Agents at work: click for the first"><span class="px-kpi-ico k-work"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:e3235385)"></i><span class="px-sr">&gt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:8.0px;height:20.0px;background-image:url(px:4x10:#2a1d14/#fff3d6:83763ee2)"></i><span class="px-sr">1</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#a9c79a:4ab18612)"></i><span class="px-sr">working</span><br><i class="pxt" aria-hidden="true" style="width:170.0px;height:20.0px;background-image:url(px:85x10:#c9b48a:92b3d876)"></i><span class="px-sr">1 agents tracked</span></span></button>
              <button type="button" class="px-kpi" disabled title="Agents whose turn ended: it&#39;s yours. Click for the first"><span class="px-kpi-ico k-turn"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:323269c0)"></i><span class="px-sr">&lt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:75d8935e)"></i><span class="px-sr">0</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:98.0px;height:20.0px;background-image:url(px:49x10:#a9c79a:e49dcf43)"></i><span class="px-sr">your turn</span><br><i class="pxt" aria-hidden="true" style="width:146.0px;height:20.0px;background-image:url(px:73x10:#c9b48a:215bb570)"></i><span class="px-sr">0 idle · 0 stale</span></span></button>
              <button type="button" class="px-kpi" disabled title="Two agents writing one repo"><span class="px-kpi-ico k-collide"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#ffffff:83c8e004)"></i><span class="px-sr">⚠</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:75d8935e)"></i><span class="px-sr">0</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:90.0px;height:20.0px;background-image:url(px:45x10:#a9c79a:2a874721)"></i><span class="px-sr">collisions</span><br><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#c9b48a:eb6a233d)"></i><span class="px-sr">none</span></span></button>
            </div>
            <div class="px-gauges">
              <span class="px-gauge" title="Memory used by the agents, of this computer's"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:4d724c39)"></i><span class="px-sr">RAM</span><span class="px-bar"><i class="ok" style="width:0%"></i></span><i class="pxt" aria-hidden="true" style="width:64.0px;height:20.0px;background-image:url(px:32x10:#2a1d14/#fff3d6:70dee863)"></i><span class="px-sr">512 MB</span></span>
              <span class="px-gauge" title="CPU used by the agents: 0% of one core, 1 cores"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:d77b3be4)"></i><span class="px-sr">CPU</span><span class="px-bar"><i class="ok" style="width:0%"></i></span><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#2a1d14/#fff3d6:65853a4f)"></i><span class="px-sr">0%</span><i class="pxt" aria-hidden="true" style="width:164.0px;height:20.0px;background-image:url(px:82x10:#c9b48a:b1f1621c)"></i><span class="px-sr">of this computer</span></span>
              <span class="px-gauge" title="Your plan's 5-hour limit (from the mod)"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#a9c79a:77a45452)"></i><span class="px-sr">5H</span><span class="px-bar"><i class="ok" style="width:42%"></i></span><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#2a1d14/#fff3d6:6b284487)"></i><span class="px-sr">42%</span><i class="pxt" aria-hidden="true" style="width:112.0px;height:20.0px;background-image:url(px:56x10:#c9b48a:3961ca8e)"></i><span class="px-sr">5-hour limit</span></span>
${pad(14)}
${pad(14)}
            </div>
${pad(12)}
${pad(12)}
          </div>
          <div class="px-nav">
            <button type="button" data-farm-menu aria-expanded="false" title="The dashboard's buttons, the farm's switches, the bell, help and zoom"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:b982a223)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:b8e00e2f)"></i><span class="px-sr">Menu</span></button>
            <div class="px-menu" role="group" aria-label="Menu" hidden>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#8b5a2b:715e2c47)"></i><span class="px-sr">DASHBOARD</span></div>
              <div class="px-menu-grid">
                <button type="button" data-farm-nav="list" title="Back to the list view"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:5f5651a6)"></i><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#4e3626:65708540)"></i><span class="px-sr">LIST</span></button>
                <button type="button" data-farm-nav="worlds" title="Choose a world"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#a9dcf7/#3f9b3a:081855c5)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:a2881fd5)"></i><span class="px-sr">WORLD</span></button>
                <button type="button" data-farm-nav="session" title="Start a new Claude Code session in a folder, or resume a past one"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:2d04caf6)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:a4edc5ff)"></i><span class="px-sr">SESSION</span></button>
                <button type="button" data-farm-nav="setup" title="Your Claude Code setup: plugins and skills (and what each costs in context), MCP servers, permission rules"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:af1418b8)"></i><i class="pxt" aria-hidden="true" style="width:128.0px;height:20.0px;background-image:url(px:64x10:#4e3626:bb190415)"></i><span class="px-sr">CLAUDE CODE</span></button>
                <button type="button" data-farm-nav="side" title="Show the selected farmer&#39;s answer box, activity and files beside the farm" aria-pressed="true"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:4ee7c8c5)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:51a95a73)"></i><span class="px-sr">SIDEBAR</span></button>
                <button type="button" data-farm-nav="broadcast" title="Message several agents at once: all of them, or the ones you pick"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:cbfe0223)"></i><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#4e3626:e91e76da)"></i><span class="px-sr">BROADCAST</span></button>
                <button type="button" data-farm-nav="theme" title="Theme: dark, light, or auto (as macOS is): click to change"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429:d67156b4)"></i><i class="pxt" aria-hidden="true" style="width:56.0px;height:20.0px;background-image:url(px:28x10:#4e3626:0180d636)"></i><span class="px-sr">LIGHT</span></button>
              </div>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#8b5a2b:d8532a2d)"></i><span class="px-sr">ON THE FARM</span></div>
              <button type="button" data-farm-follow title="Keep the farmer you picked in the middle of the view (zooms in); dragging the view turns it off"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#e04a3a:cc792b8f)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:6be19e76)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Follow: on</span></button>
              <button type="button" data-farm-resting title="Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:6a01f51d)"></i><i class="pxt" aria-hidden="true" style="width:74.0px;height:20.0px;background-image:url(px:37x10:#4e3626:902464b2)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:96.0px;height:20.0px;background-image:url(px:48x10:#8b5a2b:c27ef1a6)"></i></span><span class="px-sr">Resting: hidden (3)</span></button>
              <button type="button" data-farm-bubbles title="Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#ffffff:d27c2259)"></i><i class="pxt" aria-hidden="true" style="width:78.0px;height:20.0px;background-image:url(px:39x10:#4e3626:acf04316)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Bubbles: off</span></button>
              <button type="button" data-farm-animals title="Animals on the farm, just for fun: click one to pet or feed it (or the pond, for the ducks). They never stand for anything"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:c4c82909)"></i><i class="pxt" aria-hidden="true" style="width:70.0px;height:20.0px;background-image:url(px:35x10:#4e3626:a1ae18e2)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Animals: off</span></button>
              <button type="button" data-farm-sky title="The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429/#f4ecd8:dd5e712e)"></i><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#4e3626:04764f1d)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:50.0px;height:20.0px;background-image:url(px:25x10:#8b5a2b:7f122d2a)"></i></span><span class="px-sr">Sky: night</span></button>
              <button type="button" data-farm-season title="The season: live follows your plan&#39;s 5-hour limit (spring while it is fresh, winter when it is nearly used up); or hold one: spring, summer, autumn or winter. The panel&#39;s 📌 shows your real 5-hour use meanwhile"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#a9dcf7:4c780485)"></i><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#4e3626:dccd7184)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#8b5a2b:f3e700bc)"></i></span><span class="px-sr">Season: winter</span></button>
              <button type="button" class="px-motion" data-farm-motion title="Walking and animation on the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:d6b1f9fa)"></i><i class="pxt" aria-hidden="true" style="width:62.0px;height:20.0px;background-image:url(px:31x10:#4e3626:01d5614b)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Motion: off</span></button>
              <div class="px-menu-sep"></div>
              <button type="button" data-farm-bell title="A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you (in the list view too)"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:a9646b11)"></i><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#4e3626:46160bc0)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Bell: on</span></button>
              <button type="button" class="px-info" data-farm-help aria-label="How to read the farm" title="How to read the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:afe15026)"></i><i class="pxt" aria-hidden="true" style="width:42.0px;height:20.0px;background-image:url(px:21x10:#4e3626:afcb62cc)"></i><span class="px-sr">Help</span></button>
              <div class="px-menu-zoom"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#8b5a2b:65bf7a88)"></i><span class="px-sr">ZOOM</span><span class="px-zoombar" title="Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in"><button type="button" data-farm-zoom="-1" aria-label="Zoom out"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#4e3626:dcfc19a0)"></i><span class="px-sr">-</span></button><button type="button" data-farm-zoom="0" title="Show the whole farm"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:dc8025dd)"></i><span class="px-sr">200%</span></button><button type="button" data-farm-zoom="1" aria-label="Zoom in"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#4e3626:9e3f96e4)"></i><span class="px-sr">+</span></button></span></div>
            </div>
          </div>`,
  foldedAnimals: `<div class="px-stats folded">
            <button type="button" class="px-brand" data-farm-panel title="Show the counts and meters" aria-expanded="false"><svg data-brand="18 px-logo"></svg><i class="pxt" aria-hidden="true" style="width:116.0px;height:20.0px;background-image:url(px:58x10:#2a1d14/#ffe8a3:71586e5b)"></i><span class="px-sr">AGENTVILLE</span><i class="px-live" title="Live"></i><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#c9b48a:43ad99cb)"></i><span class="px-sr">+</span></button>
            <div class="px-line"><span title="What the sessions on the farm have cost so far (each one's purse; from the mod)"><b class="coin"></b><i class="pxt" aria-hidden="true" style="width:52.0px;height:20.0px;background-image:url(px:26x10:#2a1d14/#fff3d6:71740e0b)"></i><span class="px-sr">$0.00</span></span><span title="Harvests: each time a session's conversation was compacted"><b class="basket"></b><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#2a1d14/#fff3d6:afd0b32e)"></i><span class="px-sr">0 harvested</span></span><span class="px-season" title="Held at spring by the Season switch, not live. The live season would be summer (your plan&#39;s 5-hour limit: no reading yet). The switch goes back to live after winter"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#3f9b3a/#4e3626:1dececba)"></i><i class="pxt" aria-hidden="true" style="width:62.0px;height:20.0px;background-image:url(px:31x10:#2a1d14/#fff3d6:21eb05f5)"></i><span class="px-sr">spring</span> 📌 <i class="pxt" aria-hidden="true" style="width:194.0px;height:20.0px;background-image:url(px:97x10:#c9b48a:7a330ce3)"></i><span class="px-sr">· no 5-hour reading</span></span></div>
            <div class="px-kpis">
              <button type="button" class="px-kpi" disabled title="Agents waiting on you (a question or a permission): click for the first"><span class="px-kpi-ico k-wait"><i class="pxt" aria-hidden="true" style="width:4.0px;height:20.0px;background-image:url(px:2x10:#ffffff:9e741914)"></i><span class="px-sr">!</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:75d8935e)"></i><span class="px-sr">0</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:142.0px;height:20.0px;background-image:url(px:71x10:#a9c79a:d548d197)"></i><span class="px-sr">waiting on you</span><br><i class="pxt" aria-hidden="true" style="width:82.0px;height:20.0px;background-image:url(px:41x10:#c9b48a:a479816f)"></i><span class="px-sr">all clear</span></span></button>
              <button type="button" class="px-kpi" disabled title="Agents at work: click for the first"><span class="px-kpi-ico k-work"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:e3235385)"></i><span class="px-sr">&gt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:75d8935e)"></i><span class="px-sr">0</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#a9c79a:4ab18612)"></i><span class="px-sr">working</span><br><i class="pxt" aria-hidden="true" style="width:174.0px;height:20.0px;background-image:url(px:87x10:#c9b48a:4e2aa57a)"></i><span class="px-sr">0 agents tracked</span></span></button>
              <button type="button" class="px-kpi" disabled title="Agents whose turn ended: it&#39;s yours. Click for the first"><span class="px-kpi-ico k-turn"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:323269c0)"></i><span class="px-sr">&lt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:75d8935e)"></i><span class="px-sr">0</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:98.0px;height:20.0px;background-image:url(px:49x10:#a9c79a:e49dcf43)"></i><span class="px-sr">your turn</span><br><i class="pxt" aria-hidden="true" style="width:146.0px;height:20.0px;background-image:url(px:73x10:#c9b48a:215bb570)"></i><span class="px-sr">0 idle · 0 stale</span></span></button>
              <button type="button" class="px-kpi" disabled title="Two agents writing one repo"><span class="px-kpi-ico k-collide"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#ffffff:83c8e004)"></i><span class="px-sr">⚠</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:75d8935e)"></i><span class="px-sr">0</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:90.0px;height:20.0px;background-image:url(px:45x10:#a9c79a:2a874721)"></i><span class="px-sr">collisions</span><br><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#c9b48a:eb6a233d)"></i><span class="px-sr">none</span></span></button>
            </div>
            <div class="px-gauges">
              <span class="px-gauge" title="Memory used by the agents, of this computer's"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:4d724c39)"></i><span class="px-sr">RAM</span><span class="px-bar"><i class="ok" style="width:0%"></i></span><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#2a1d14/#fff3d6:aa7ff1cd)"></i><span class="px-sr">0 MB</span></span>
              <span class="px-gauge" title="CPU used by the agents: 0% of one core, 1 cores"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:d77b3be4)"></i><span class="px-sr">CPU</span><span class="px-bar"><i class="ok" style="width:0%"></i></span><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#2a1d14/#fff3d6:65853a4f)"></i><span class="px-sr">0%</span><i class="pxt" aria-hidden="true" style="width:164.0px;height:20.0px;background-image:url(px:82x10:#c9b48a:b1f1621c)"></i><span class="px-sr">of this computer</span></span>
${pad(14)}
${pad(14)}
${pad(14)}
            </div>
${pad(12)}
${pad(12)}
          </div>
          <div class="px-nav">
            <button type="button" data-farm-menu aria-expanded="false" title="The dashboard's buttons, the farm's switches, the bell, help and zoom"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:b982a223)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:b8e00e2f)"></i><span class="px-sr">Menu</span></button>
            <div class="px-menu" role="group" aria-label="Menu" hidden>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#8b5a2b:715e2c47)"></i><span class="px-sr">DASHBOARD</span></div>
              <div class="px-menu-grid">
                <button type="button" data-farm-nav="list" title="Back to the list view"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:5f5651a6)"></i><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#4e3626:65708540)"></i><span class="px-sr">LIST</span></button>
                <button type="button" data-farm-nav="worlds" title="Choose a world"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#a9dcf7/#3f9b3a:081855c5)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:a2881fd5)"></i><span class="px-sr">WORLD</span></button>
                <button type="button" data-farm-nav="session" title="Start a new Claude Code session in a folder, or resume a past one"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:2d04caf6)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:a4edc5ff)"></i><span class="px-sr">SESSION</span></button>
                <button type="button" data-farm-nav="setup" title="Your Claude Code setup: plugins and skills (and what each costs in context), MCP servers, permission rules"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:af1418b8)"></i><i class="pxt" aria-hidden="true" style="width:128.0px;height:20.0px;background-image:url(px:64x10:#4e3626:bb190415)"></i><span class="px-sr">CLAUDE CODE</span></button>
                <button type="button" data-farm-nav="side" title="Show the selected farmer&#39;s answer box, activity and files beside the farm" aria-pressed="false"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:4ee7c8c5)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:51a95a73)"></i><span class="px-sr">SIDEBAR</span></button>
                <button type="button" data-farm-nav="broadcast" title="Message several agents at once: all of them, or the ones you pick"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:cbfe0223)"></i><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#4e3626:e91e76da)"></i><span class="px-sr">BROADCAST</span></button>
                <button type="button" data-farm-nav="theme" title="Theme: dark, light, or auto (as macOS is): click to change"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429/#4e3626:380cd1fd)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:8d09ad78)"></i><span class="px-sr">AUTO</span></button>
              </div>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#8b5a2b:d8532a2d)"></i><span class="px-sr">ON THE FARM</span></div>
              <button type="button" data-farm-follow disabled title="Pick a farmer first, then Follow keeps it in view"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#e04a3a:cc792b8f)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:6be19e76)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Follow: off</span></button>
              <button type="button" data-farm-resting title="Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:6a01f51d)"></i><i class="pxt" aria-hidden="true" style="width:74.0px;height:20.0px;background-image:url(px:37x10:#4e3626:902464b2)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#8b5a2b:12db36ba)"></i></span><span class="px-sr">Resting: shown</span></button>
              <button type="button" data-farm-bubbles title="Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#ffffff:d27c2259)"></i><i class="pxt" aria-hidden="true" style="width:78.0px;height:20.0px;background-image:url(px:39x10:#4e3626:acf04316)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Bubbles: on</span></button>
              <button type="button" data-farm-animals title="Animals on the farm, just for fun: click one to pet or feed it (or the pond, for the ducks). They never stand for anything"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:c4c82909)"></i><i class="pxt" aria-hidden="true" style="width:70.0px;height:20.0px;background-image:url(px:35x10:#4e3626:a1ae18e2)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Animals: on</span></button>
              <button type="button" data-farm-sky title="The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429:d67156b4)"></i><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#4e3626:04764f1d)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#8b5a2b:ac999c55)"></i></span><span class="px-sr">Sky: day</span></button>
              <button type="button" data-farm-season title="The season: live follows your plan&#39;s 5-hour limit (spring while it is fresh, winter when it is nearly used up); or hold one: spring, summer, autumn or winter. The panel&#39;s 📌 shows your real 5-hour use meanwhile"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#3f9b3a/#4e3626:1dececba)"></i><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#4e3626:dccd7184)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:62.0px;height:20.0px;background-image:url(px:31x10:#8b5a2b:5f9378ee)"></i></span><span class="px-sr">Season: spring</span></button>
              <button type="button" class="px-motion" data-farm-motion title="Walking and animation on the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#3f9b3a:ff6f425d)"></i><i class="pxt" aria-hidden="true" style="width:62.0px;height:20.0px;background-image:url(px:31x10:#4e3626:01d5614b)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Motion: on</span></button>
              <div class="px-menu-sep"></div>
              <button type="button" data-farm-bell title="A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you (in the list view too)"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:a9646b11)"></i><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#4e3626:46160bc0)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Bell: off</span></button>
              <button type="button" class="px-info" data-farm-help aria-label="How to read the farm" title="How to read the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:afe15026)"></i><i class="pxt" aria-hidden="true" style="width:42.0px;height:20.0px;background-image:url(px:21x10:#4e3626:afcb62cc)"></i><span class="px-sr">Help</span></button>
              <div class="px-menu-zoom"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#8b5a2b:65bf7a88)"></i><span class="px-sr">ZOOM</span><span class="px-zoombar" title="Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in"><button type="button" data-farm-zoom="-1" aria-label="Zoom out"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#4e3626:dcfc19a0)"></i><span class="px-sr">-</span></button><button type="button" data-farm-zoom="0" title="Show the whole farm"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#4e3626:daea42d0)"></i><span class="px-sr">75%</span></button><button type="button" data-farm-zoom="1" aria-label="Zoom in"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#4e3626:9e3f96e4)"></i><span class="px-sr">+</span></button></span></div>
            </div>
          </div>`,
};

test("the farm's panel and buttons are byte for byte as they were: live; winter held at 42%; folded, with the animals on", () => {
  for (const [name, c] of Object.entries(HUD_CASES)) assert.equal(farmHud(c), FROZEN_HUD[name], name);
});

// With two Claude accounts the panel shows a gauge for each (its name, its week, its 5 hours beside it) in
// place of the plan's 5H and WEEK. Recorded on main's own farm hud (a6c2617), before the merge moved its
// accounts into the engine's panelHud; recorded again on main's (2c3d7f7) when its Menu replaced the two
// button rows. Never re-record this to make a change pass.
const TWO_ACCOUNTS = {
  scene: () => ({ ...HUD_CASES.live.scene(), accounts: [{ key: 'main', name: 'work', plan: planWith(30, 55) }, { key: 'home', name: 'home', plan: planWith(95, 92) }] }),
  params: HUD_CASES.live.params,
};
const FROZEN_TWO_ACCOUNTS = `<div class="px-stats">
            <button type="button" class="px-brand" data-farm-panel title="Fold this panel away" aria-expanded="true"><svg data-brand="18 px-logo"></svg><i class="pxt" aria-hidden="true" style="width:116.0px;height:20.0px;background-image:url(px:58x10:#2a1d14/#ffe8a3:71586e5b)"></i><span class="px-sr">AGENTVILLE</span><i class="px-live" title="Live"></i><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#c9b48a:9cd4bbc7)"></i><span class="px-sr">-</span></button>
            <div class="px-line"><span title="What the sessions on the farm have cost so far (each one's purse; from the mod)"><b class="coin"></b><i class="pxt" aria-hidden="true" style="width:52.0px;height:20.0px;background-image:url(px:26x10:#2a1d14/#fff3d6:145977db)"></i><span class="px-sr">$4.75</span></span><span title="Harvests: each time a session's conversation was compacted"><b class="basket"></b><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#2a1d14/#fff3d6:69754028)"></i><span class="px-sr">3 harvested</span></span><span class="px-season" title="The season follows your plan&#39;s 5-hour limit: 30% used. Spring while it is fresh, then summer and autumn; winter when it is nearly used up"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429:d67156b4)"></i><i class="pxt" aria-hidden="true" style="width:70.0px;height:20.0px;background-image:url(px:35x10:#2a1d14/#fff3d6:b0686e96)"></i><span class="px-sr">summer</span></span></div>
            <div class="px-kpis">
              <button type="button" class="px-kpi hot" data-farm-state="waiting" title="Agents waiting on you (a question or a permission): click for the first"><span class="px-kpi-ico k-wait"><i class="pxt" aria-hidden="true" style="width:4.0px;height:20.0px;background-image:url(px:2x10:#ffffff:9e741914)"></i><span class="px-sr">!</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:f8702c9c)"></i><span class="px-sr">2</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:142.0px;height:20.0px;background-image:url(px:71x10:#a9c79a:d548d197)"></i><span class="px-sr">waiting on you</span><br><i class="pxt" aria-hidden="true" style="width:96.0px;height:20.0px;background-image:url(px:48x10:#c9b48a:d5c8634d)"></i><span class="px-sr">oldest 5m</span></span></button>
              <button type="button" class="px-kpi" data-farm-state="working" title="Agents at work: click for the first"><span class="px-kpi-ico k-work"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:e3235385)"></i><span class="px-sr">&gt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:7d4c66e4)"></i><span class="px-sr">3</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#a9c79a:4ab18612)"></i><span class="px-sr">working</span><br><i class="pxt" aria-hidden="true" style="width:172.0px;height:20.0px;background-image:url(px:86x10:#c9b48a:6e0531e2)"></i><span class="px-sr">2 with subagents</span></span></button>
              <button type="button" class="px-kpi hot" data-farm-state="turn" title="Agents whose turn ended: it&#39;s yours. Click for the first"><span class="px-kpi-ico k-turn"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:323269c0)"></i><span class="px-sr">&lt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:8.0px;height:20.0px;background-image:url(px:4x10:#2a1d14/#fff3d6:83763ee2)"></i><span class="px-sr">1</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:98.0px;height:20.0px;background-image:url(px:49x10:#a9c79a:e49dcf43)"></i><span class="px-sr">your turn</span><br><i class="pxt" aria-hidden="true" style="width:256.0px;height:20.0px;background-image:url(px:128x10:#c9b48a:12c6592b)"></i><span class="px-sr">1 ask you · 2 idle · 1 stale</span></span></button>
              <button type="button" class="px-kpi hot" disabled title="Two agents writing one repo"><span class="px-kpi-ico k-collide"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#ffffff:83c8e004)"></i><span class="px-sr">⚠</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:8.0px;height:20.0px;background-image:url(px:4x10:#2a1d14/#fff3d6:83763ee2)"></i><span class="px-sr">1</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:90.0px;height:20.0px;background-image:url(px:45x10:#a9c79a:2a874721)"></i><span class="px-sr">collisions</span><br><i class="pxt" aria-hidden="true" style="width:156.0px;height:20.0px;background-image:url(px:78x10:#c9b48a:46831424)"></i><span class="px-sr">two in one repo</span></span></button>
            </div>
            <div class="px-gauges">
              <span class="px-gauge" title="Memory used by the agents, of this computer's"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:4d724c39)"></i><span class="px-sr">RAM</span><span class="px-bar"><i class="ok" style="width:14%"></i></span><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#2a1d14/#fff3d6:21697233)"></i><span class="px-sr">2.2 GB</span><i class="pxt" aria-hidden="true" style="width:96.0px;height:20.0px;background-image:url(px:48x10:#c9b48a:235e5bd0)"></i><span class="px-sr">of 16.0 GB</span></span>
              <span class="px-gauge" title="CPU used by the agents: 140% of one core, 8 cores"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:d77b3be4)"></i><span class="px-sr">CPU</span><span class="px-bar"><i class="ok" style="width:18%"></i></span><i class="pxt" aria-hidden="true" style="width:32.0px;height:20.0px;background-image:url(px:16x10:#2a1d14/#fff3d6:acf1cb9c)"></i><span class="px-sr">18%</span><i class="pxt" aria-hidden="true" style="width:164.0px;height:20.0px;background-image:url(px:82x10:#c9b48a:b1f1621c)"></i><span class="px-sr">of this computer</span></span>
              <span class="px-gauge" title="Your work account: 55% of its week, 30% of its 5 hours (from the mod)"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#a9c79a:e652820e)"></i><span class="px-sr">WORK</span><span class="px-bar"><i class="warn" style="width:55%"></i></span><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#2a1d14/#fff3d6:71287b6d)"></i><span class="px-sr">55%</span><i class="pxt" aria-hidden="true" style="width:134.0px;height:20.0px;background-image:url(px:67x10:#c9b48a:ed2a9603)"></i><span class="px-sr">week · 5h 30%</span></span><span class="px-gauge" title="Your home account: 92% of its week, 95% of its 5 hours (from the mod)"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#a9c79a:e310d20e)"></i><span class="px-sr">HOME</span><span class="px-bar"><i class="bad" style="width:92%"></i></span><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#2a1d14/#fff3d6:1d47f549)"></i><span class="px-sr">92%</span><i class="pxt" aria-hidden="true" style="width:134.0px;height:20.0px;background-image:url(px:67x10:#c9b48a:2ffb0ba6)"></i><span class="px-sr">week · 5h 95%</span></span>
              <span class="px-gauge" title="The tracker itself"><i class="pxt" aria-hidden="true" style="width:238.0px;height:20.0px;background-image:url(px:119x10:#c9b48a:b6098418)"></i><span class="px-sr">tracker 1.5% CPU · 80 MB</span></span>
            </div>
            <div class="px-err">⚠ GitHub: rate limited &lt;b&gt;</div>
            <button type="button" class="px-need" data-farm-need title="Open the first agent that needs you"><i class="pxt" aria-hidden="true" style="width:112.0px;height:20.0px;background-image:url(px:56x10:#5a1f19/#ffffff:0a524b9c)"></i><span class="px-sr">2 need you</span></button>
          </div>
          <div class="px-nav">
            <button type="button" data-farm-menu aria-expanded="false" title="The dashboard's buttons, the farm's switches, the bell, help and zoom"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:b982a223)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:b8e00e2f)"></i><span class="px-sr">Menu</span></button>
            <div class="px-menu" role="group" aria-label="Menu" hidden>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#8b5a2b:715e2c47)"></i><span class="px-sr">DASHBOARD</span></div>
              <div class="px-menu-grid">
                <button type="button" data-farm-nav="list" title="Back to the list view"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:5f5651a6)"></i><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#4e3626:65708540)"></i><span class="px-sr">LIST</span></button>
                <button type="button" data-farm-nav="worlds" title="Choose a world"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#a9dcf7/#3f9b3a:081855c5)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:a2881fd5)"></i><span class="px-sr">WORLD</span></button>
                <button type="button" data-farm-nav="session" title="Start a new Claude Code session in a folder, or resume a past one"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:2d04caf6)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:a4edc5ff)"></i><span class="px-sr">SESSION</span></button>
                <button type="button" data-farm-nav="setup" title="Your Claude Code setup: plugins and skills (and what each costs in context), MCP servers, permission rules"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:af1418b8)"></i><i class="pxt" aria-hidden="true" style="width:128.0px;height:20.0px;background-image:url(px:64x10:#4e3626:bb190415)"></i><span class="px-sr">CLAUDE CODE</span></button>
                <button type="button" data-farm-nav="side" title="Show the selected farmer&#39;s answer box, activity and files beside the farm" aria-pressed="false"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:4ee7c8c5)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:51a95a73)"></i><span class="px-sr">SIDEBAR</span></button>
                <button type="button" data-farm-nav="broadcast" title="Message several agents at once: all of them, or the ones you pick"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:cbfe0223)"></i><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#4e3626:e91e76da)"></i><span class="px-sr">BROADCAST</span></button>
                <button type="button" data-farm-nav="theme" title="Theme: dark, light, or auto (as macOS is): click to change"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429/#f4ecd8:dd5e712e)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:5dd07217)"></i><span class="px-sr">DARK</span></button>
              </div>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#8b5a2b:d8532a2d)"></i><span class="px-sr">ON THE FARM</span></div>
              <button type="button" data-farm-follow title="Keep the farmer you picked in the middle of the view (zooms in); dragging the view turns it off"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#e04a3a:cc792b8f)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:6be19e76)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Follow: off</span></button>
              <button type="button" data-farm-resting title="Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:6a01f51d)"></i><i class="pxt" aria-hidden="true" style="width:74.0px;height:20.0px;background-image:url(px:37x10:#4e3626:902464b2)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#8b5a2b:12db36ba)"></i></span><span class="px-sr">Resting: shown</span></button>
              <button type="button" data-farm-bubbles title="Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#ffffff:d27c2259)"></i><i class="pxt" aria-hidden="true" style="width:78.0px;height:20.0px;background-image:url(px:39x10:#4e3626:acf04316)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Bubbles: on</span></button>
${pad(14)}
              <button type="button" data-farm-sky title="The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429/#4e3626:380cd1fd)"></i><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#4e3626:04764f1d)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#8b5a2b:02ff8622)"></i></span><span class="px-sr">Sky: live</span></button>
              <button type="button" data-farm-season title="The season: live follows your plan&#39;s 5-hour limit (spring while it is fresh, winter when it is nearly used up); or hold one: spring, summer, autumn or winter. The panel&#39;s 📌 shows your real 5-hour use meanwhile"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429:d67156b4)"></i><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#4e3626:dccd7184)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#8b5a2b:02ff8622)"></i></span><span class="px-sr">Season: live</span></button>
              <button type="button" class="px-motion" data-farm-motion title="Walking and animation on the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#3f9b3a:ff6f425d)"></i><i class="pxt" aria-hidden="true" style="width:62.0px;height:20.0px;background-image:url(px:31x10:#4e3626:01d5614b)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Motion: on</span></button>
              <div class="px-menu-sep"></div>
              <button type="button" data-farm-bell title="A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you (in the list view too)"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:a9646b11)"></i><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#4e3626:46160bc0)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Bell: off</span></button>
              <button type="button" class="px-info" data-farm-help aria-label="How to read the farm" title="How to read the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:afe15026)"></i><i class="pxt" aria-hidden="true" style="width:42.0px;height:20.0px;background-image:url(px:21x10:#4e3626:afcb62cc)"></i><span class="px-sr">Help</span></button>
              <div class="px-menu-zoom"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#8b5a2b:65bf7a88)"></i><span class="px-sr">ZOOM</span><span class="px-zoombar" title="Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in"><button type="button" data-farm-zoom="-1" aria-label="Zoom out"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#4e3626:dcfc19a0)"></i><span class="px-sr">-</span></button><button type="button" data-farm-zoom="0" title="Show the whole farm"><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#4e3626:7305c299)"></i><span class="px-sr">100%</span></button><button type="button" data-farm-zoom="1" aria-label="Zoom in"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#4e3626:9e3f96e4)"></i><span class="px-sr">+</span></button></span></div>
            </div>
          </div>`;

test("with two Claude accounts, the farm's panel has a gauge for each, byte for byte as main's farm drew it", () => {
  assert.equal(farmHud(TWO_ACCOUNTS), FROZEN_TWO_ACCOUNTS);
});

// The Menu open (the engine's menuOpen): its button pressed, the menu shown. Recorded on main's own farm hud
// (2c3d7f7), where the Menu was made. Never re-record this to make a change pass.
const MENU_OPEN = { scene: HUD_CASES.live.scene, params: { ...HUD_CASES.live.params, menuOpen: true } };
const FROZEN_MENU_OPEN = `<div class="px-stats">
            <button type="button" class="px-brand" data-farm-panel title="Fold this panel away" aria-expanded="true"><svg data-brand="18 px-logo"></svg><i class="pxt" aria-hidden="true" style="width:116.0px;height:20.0px;background-image:url(px:58x10:#2a1d14/#ffe8a3:71586e5b)"></i><span class="px-sr">AGENTVILLE</span><i class="px-live" title="Live"></i><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#c9b48a:9cd4bbc7)"></i><span class="px-sr">-</span></button>
            <div class="px-line"><span title="What the sessions on the farm have cost so far (each one's purse; from the mod)"><b class="coin"></b><i class="pxt" aria-hidden="true" style="width:52.0px;height:20.0px;background-image:url(px:26x10:#2a1d14/#fff3d6:145977db)"></i><span class="px-sr">$4.75</span></span><span title="Harvests: each time a session's conversation was compacted"><b class="basket"></b><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#2a1d14/#fff3d6:69754028)"></i><span class="px-sr">3 harvested</span></span><span class="px-season" title="The season follows your plan&#39;s 5-hour limit: 30% used. Spring while it is fresh, then summer and autumn; winter when it is nearly used up"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429:d67156b4)"></i><i class="pxt" aria-hidden="true" style="width:70.0px;height:20.0px;background-image:url(px:35x10:#2a1d14/#fff3d6:b0686e96)"></i><span class="px-sr">summer</span></span></div>
            <div class="px-kpis">
              <button type="button" class="px-kpi hot" data-farm-state="waiting" title="Agents waiting on you (a question or a permission): click for the first"><span class="px-kpi-ico k-wait"><i class="pxt" aria-hidden="true" style="width:4.0px;height:20.0px;background-image:url(px:2x10:#ffffff:9e741914)"></i><span class="px-sr">!</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:f8702c9c)"></i><span class="px-sr">2</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:142.0px;height:20.0px;background-image:url(px:71x10:#a9c79a:d548d197)"></i><span class="px-sr">waiting on you</span><br><i class="pxt" aria-hidden="true" style="width:96.0px;height:20.0px;background-image:url(px:48x10:#c9b48a:d5c8634d)"></i><span class="px-sr">oldest 5m</span></span></button>
              <button type="button" class="px-kpi" data-farm-state="working" title="Agents at work: click for the first"><span class="px-kpi-ico k-work"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:e3235385)"></i><span class="px-sr">&gt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#2a1d14/#fff3d6:7d4c66e4)"></i><span class="px-sr">3</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#a9c79a:4ab18612)"></i><span class="px-sr">working</span><br><i class="pxt" aria-hidden="true" style="width:172.0px;height:20.0px;background-image:url(px:86x10:#c9b48a:6e0531e2)"></i><span class="px-sr">2 with subagents</span></span></button>
              <button type="button" class="px-kpi hot" data-farm-state="turn" title="Agents whose turn ended: it&#39;s yours. Click for the first"><span class="px-kpi-ico k-turn"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#ffffff:323269c0)"></i><span class="px-sr">&lt;</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:8.0px;height:20.0px;background-image:url(px:4x10:#2a1d14/#fff3d6:83763ee2)"></i><span class="px-sr">1</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:98.0px;height:20.0px;background-image:url(px:49x10:#a9c79a:e49dcf43)"></i><span class="px-sr">your turn</span><br><i class="pxt" aria-hidden="true" style="width:256.0px;height:20.0px;background-image:url(px:128x10:#c9b48a:12c6592b)"></i><span class="px-sr">1 ask you · 2 idle · 1 stale</span></span></button>
              <button type="button" class="px-kpi hot" disabled title="Two agents writing one repo"><span class="px-kpi-ico k-collide"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#ffffff:83c8e004)"></i><span class="px-sr">⚠</span></span><span class="px-kpi-n"><i class="pxt" aria-hidden="true" style="width:8.0px;height:20.0px;background-image:url(px:4x10:#2a1d14/#fff3d6:83763ee2)"></i><span class="px-sr">1</span></span><span class="px-kpi-l"><i class="pxt" aria-hidden="true" style="width:90.0px;height:20.0px;background-image:url(px:45x10:#a9c79a:2a874721)"></i><span class="px-sr">collisions</span><br><i class="pxt" aria-hidden="true" style="width:156.0px;height:20.0px;background-image:url(px:78x10:#c9b48a:46831424)"></i><span class="px-sr">two in one repo</span></span></button>
            </div>
            <div class="px-gauges">
              <span class="px-gauge" title="Memory used by the agents, of this computer's"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:4d724c39)"></i><span class="px-sr">RAM</span><span class="px-bar"><i class="ok" style="width:14%"></i></span><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#2a1d14/#fff3d6:21697233)"></i><span class="px-sr">2.2 GB</span><i class="pxt" aria-hidden="true" style="width:96.0px;height:20.0px;background-image:url(px:48x10:#c9b48a:235e5bd0)"></i><span class="px-sr">of 16.0 GB</span></span>
              <span class="px-gauge" title="CPU used by the agents: 140% of one core, 8 cores"><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#a9c79a:d77b3be4)"></i><span class="px-sr">CPU</span><span class="px-bar"><i class="ok" style="width:18%"></i></span><i class="pxt" aria-hidden="true" style="width:32.0px;height:20.0px;background-image:url(px:16x10:#2a1d14/#fff3d6:acf1cb9c)"></i><span class="px-sr">18%</span><i class="pxt" aria-hidden="true" style="width:164.0px;height:20.0px;background-image:url(px:82x10:#c9b48a:b1f1621c)"></i><span class="px-sr">of this computer</span></span>
              <span class="px-gauge" title="Your plan's 5-hour limit (from the mod)"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#a9c79a:77a45452)"></i><span class="px-sr">5H</span><span class="px-bar"><i class="ok" style="width:30%"></i></span><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#2a1d14/#fff3d6:7df674fb)"></i><span class="px-sr">30%</span><i class="pxt" aria-hidden="true" style="width:112.0px;height:20.0px;background-image:url(px:56x10:#c9b48a:3961ca8e)"></i><span class="px-sr">5-hour limit</span></span>
              <span class="px-gauge" title="Your plan's weekly limit (from the mod)"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#a9c79a:7d693448)"></i><span class="px-sr">WEEK</span><span class="px-bar"><i class="warn" style="width:55%"></i></span><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#2a1d14/#fff3d6:71287b6d)"></i><span class="px-sr">55%</span><i class="pxt" aria-hidden="true" style="width:92.0px;height:20.0px;background-image:url(px:46x10:#c9b48a:170a2ba1)"></i><span class="px-sr">this week</span></span>
              <span class="px-gauge" title="The tracker itself"><i class="pxt" aria-hidden="true" style="width:238.0px;height:20.0px;background-image:url(px:119x10:#c9b48a:b6098418)"></i><span class="px-sr">tracker 1.5% CPU · 80 MB</span></span>
            </div>
            <div class="px-err">⚠ GitHub: rate limited &lt;b&gt;</div>
            <button type="button" class="px-need" data-farm-need title="Open the first agent that needs you"><i class="pxt" aria-hidden="true" style="width:112.0px;height:20.0px;background-image:url(px:56x10:#5a1f19/#ffffff:0a524b9c)"></i><span class="px-sr">2 need you</span></button>
          </div>
          <div class="px-nav">
            <button type="button" data-farm-menu aria-expanded="true" title="The dashboard's buttons, the farm's switches, the bell, help and zoom"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:b982a223)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:b8e00e2f)"></i><span class="px-sr">Menu</span></button>
            <div class="px-menu" role="group" aria-label="Menu">
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#8b5a2b:715e2c47)"></i><span class="px-sr">DASHBOARD</span></div>
              <div class="px-menu-grid">
                <button type="button" data-farm-nav="list" title="Back to the list view"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:5f5651a6)"></i><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#4e3626:65708540)"></i><span class="px-sr">LIST</span></button>
                <button type="button" data-farm-nav="worlds" title="Choose a world"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#a9dcf7/#3f9b3a:081855c5)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:a2881fd5)"></i><span class="px-sr">WORLD</span></button>
                <button type="button" data-farm-nav="session" title="Start a new Claude Code session in a folder, or resume a past one"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:2d04caf6)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:a4edc5ff)"></i><span class="px-sr">SESSION</span></button>
                <button type="button" data-farm-nav="setup" title="Your Claude Code setup: plugins and skills (and what each costs in context), MCP servers, permission rules"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:af1418b8)"></i><i class="pxt" aria-hidden="true" style="width:128.0px;height:20.0px;background-image:url(px:64x10:#4e3626:bb190415)"></i><span class="px-sr">CLAUDE CODE</span></button>
                <button type="button" data-farm-nav="side" title="Show the selected farmer&#39;s answer box, activity and files beside the farm" aria-pressed="false"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:4ee7c8c5)"></i><i class="pxt" aria-hidden="true" style="width:80.0px;height:20.0px;background-image:url(px:40x10:#4e3626:51a95a73)"></i><span class="px-sr">SIDEBAR</span></button>
                <button type="button" data-farm-nav="broadcast" title="Message several agents at once: all of them, or the ones you pick"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:cbfe0223)"></i><i class="pxt" aria-hidden="true" style="width:108.0px;height:20.0px;background-image:url(px:54x10:#4e3626:e91e76da)"></i><span class="px-sr">BROADCAST</span></button>
                <button type="button" data-farm-nav="theme" title="Theme: dark, light, or auto (as macOS is): click to change"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429/#f4ecd8:dd5e712e)"></i><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#4e3626:5dd07217)"></i><span class="px-sr">DARK</span></button>
              </div>
              <div class="px-menu-h"><i class="pxt" aria-hidden="true" style="width:124.0px;height:20.0px;background-image:url(px:62x10:#8b5a2b:d8532a2d)"></i><span class="px-sr">ON THE FARM</span></div>
              <button type="button" data-farm-follow title="Keep the farmer you picked in the middle of the view (zooms in); dragging the view turns it off"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#e04a3a:cc792b8f)"></i><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#4e3626:6be19e76)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Follow: off</span></button>
              <button type="button" data-farm-resting title="Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:6a01f51d)"></i><i class="pxt" aria-hidden="true" style="width:74.0px;height:20.0px;background-image:url(px:37x10:#4e3626:902464b2)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:60.0px;height:20.0px;background-image:url(px:30x10:#8b5a2b:12db36ba)"></i></span><span class="px-sr">Resting: shown</span></button>
              <button type="button" data-farm-bubbles title="Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#ffffff:d27c2259)"></i><i class="pxt" aria-hidden="true" style="width:78.0px;height:20.0px;background-image:url(px:39x10:#4e3626:acf04316)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Bubbles: on</span></button>
${pad(14)}
              <button type="button" data-farm-sky title="The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429/#4e3626:380cd1fd)"></i><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#4e3626:04764f1d)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#8b5a2b:02ff8622)"></i></span><span class="px-sr">Sky: live</span></button>
              <button type="button" data-farm-season title="The season: live follows your plan&#39;s 5-hour limit (spring while it is fresh, winter when it is nearly used up); or hold one: spring, summer, autumn or winter. The panel&#39;s 📌 shows your real 5-hour use meanwhile"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#f0b429:d67156b4)"></i><i class="pxt" aria-hidden="true" style="width:72.0px;height:20.0px;background-image:url(px:36x10:#4e3626:dccd7184)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:34.0px;height:20.0px;background-image:url(px:17x10:#8b5a2b:02ff8622)"></i></span><span class="px-sr">Season: live</span></button>
              <button type="button" class="px-motion" data-farm-motion title="Walking and animation on the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#3f9b3a:ff6f425d)"></i><i class="pxt" aria-hidden="true" style="width:62.0px;height:20.0px;background-image:url(px:31x10:#4e3626:01d5614b)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:24.0px;height:20.0px;background-image:url(px:12x10:#8b5a2b:707b331e)"></i></span><span class="px-sr">Motion: on</span></button>
              <div class="px-menu-sep"></div>
              <button type="button" data-farm-bell title="A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you (in the list view too)"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626/#f0b429:a9646b11)"></i><i class="pxt" aria-hidden="true" style="width:36.0px;height:20.0px;background-image:url(px:18x10:#4e3626:46160bc0)"></i><span class="px-mi-s"><i class="pxt" aria-hidden="true" style="width:28.0px;height:20.0px;background-image:url(px:14x10:#8b5a2b:eaab783c)"></i></span><span class="px-sr">Bell: off</span></button>
              <button type="button" class="px-info" data-farm-help aria-label="How to read the farm" title="How to read the farm"><i class="px-ico" aria-hidden="true" style="background-image:url(px:9x9:#4e3626:afe15026)"></i><i class="pxt" aria-hidden="true" style="width:42.0px;height:20.0px;background-image:url(px:21x10:#4e3626:afcb62cc)"></i><span class="px-sr">Help</span></button>
              <div class="px-menu-zoom"><i class="pxt" aria-hidden="true" style="width:48.0px;height:20.0px;background-image:url(px:24x10:#8b5a2b:65bf7a88)"></i><span class="px-sr">ZOOM</span><span class="px-zoombar" title="Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in"><button type="button" data-farm-zoom="-1" aria-label="Zoom out"><i class="pxt" aria-hidden="true" style="width:10.0px;height:20.0px;background-image:url(px:5x10:#4e3626:dcfc19a0)"></i><span class="px-sr">-</span></button><button type="button" data-farm-zoom="0" title="Show the whole farm"><i class="pxt" aria-hidden="true" style="width:44.0px;height:20.0px;background-image:url(px:22x10:#4e3626:7305c299)"></i><span class="px-sr">100%</span></button><button type="button" data-farm-zoom="1" aria-label="Zoom in"><i class="pxt" aria-hidden="true" style="width:12.0px;height:20.0px;background-image:url(px:6x10:#4e3626:9e3f96e4)"></i><span class="px-sr">+</span></button></span></div>
            </div>
          </div>`;

test("with its Menu open, the farm's panel and buttons are byte for byte as main's farm drew them", () => {
  assert.equal(farmHud(MENU_OPEN), FROZEN_MENU_OPEN);
});

test('silos: one per account, two at most, the first where it always stood', () => {
  const { silosOf } = load();
  const acc = (key, week) => ({ key, name: key, plan: planWith(10, week) });
  const row = s => [s.x, s.name, s.silo?.label ?? null, s.silo?.lamp ?? null];
  assert.deepEqual(plain(silosOf({ plan: planWith(10, 40), accounts: [] }).map(row)), [[92, null, '40%', null]]);
  assert.deepEqual(plain(silosOf({ plan: planWith(10, 40), accounts: [acc('main', 40)] }).map(row)), [[92, null, '40%', null]], 'one account: no name on it');
  assert.deepEqual(plain(silosOf({ plan: planWith(10, 40), accounts: [acc('nco', 40), acc('zeta', 93), acc('third', 5)] }).map(row)), [[92, 'nco', '40%', null], [8, 'zeta', '93%', 'red']]);
  assert.deepEqual(plain(silosOf({ plan: null, accounts: [acc('nco', 40), { key: 'zeta', name: 'zeta', plan: null }] }).map(row)), [[92, 'nco', '40%', null], [8, 'zeta', null, null]]);
  assert.deepEqual(plain(silosOf({ plan: null }).map(row)), [[92, null, null, null]], 'an older scene without accounts');
});

test("the farm's scene keeps the accounts and each farmer's", () => {
  const { toScene } = load();
  const s = plain(toScene({ generatedAt: NOW, collisions: [], repos: [], agents: [agent('a', { account: 'zeta' })], accounts: [{ key: 'main', name: 'nco', plan: planWith(10, 40) }, { key: 'zeta', name: 'zeta', plan: null }] }));
  assert.deepEqual(s.accounts.map(a => [a.key, a.name, a.plan?.windows.length ?? null]), [['main', 'nco', 2], ['zeta', 'zeta', null]]);
  assert.equal(s.farmers[0].account, 'zeta');
});
