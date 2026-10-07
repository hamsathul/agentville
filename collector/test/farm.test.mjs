// Loads web/farm.js in a vm with a stub window and checks the scene adapter: the canvas code
// only ever reads what toScene returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = readFileSync(fileURLToPath(new URL('../../web/farm.js', import.meta.url)), 'utf8');
function load() {
  const window = {};
  vm.runInNewContext(code, { window, console, Math, Date, JSON, Map, Set });
  return window.TrackerFarm;
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

const STEP_KINDS = ['edit', 'write', 'read', 'search', 'web', 'test', 'lint', 'build', 'install', 'commit', 'push', 'deploy', 'pull', 'serve', 'delete', 'agent', 'plan', 'shell', 'other'];

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
