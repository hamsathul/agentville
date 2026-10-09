// Loads web/scene.js in a vm: the scene every world draws, built on the page from a snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = readFileSync(fileURLToPath(new URL('../../web/scene.js', import.meta.url)), 'utf8');
function load() {
  const window = {};
  vm.runInNewContext(code, { window, console });
  return window.AgentvilleScene;
}
const plain = v => JSON.parse(JSON.stringify(v));
const NOW = Date.now();
const repo = (path, over = {}) => ({ path, name: path.split('/').pop(), branch: 'main', dirty: 0, ahead: 0, behind: 0, agentIds: [], ...over });
const agent = (id, over = {}) => ({ id, kind: 'interactive', name: id, cwd: '/x', state: 'working', stateReason: 'busy', feed: [], children: [], touching: [], ...over });
const snapOf = (agents, repos, extra = {}) => ({ generatedAt: NOW, agents, repos, collisions: [], settings: { cpuAlertPct: 90 }, ...extra });

test('the scene says its version, and holds plain facts: no hats, crops or weather', () => {
  const { toScene, VERSION } = load();
  const s = plain(toScene(snapOf([agent('a', { contextTokens: 100_000, touching: [{ path: '/code/app/x.ts', mode: 'write', lastAt: 1, repo: '/code/app' }] })], [repo('/code/app')])));
  assert.equal(VERSION, 1);
  assert.equal(s.version, 1);
  assert.equal(s.private, false);
  const [a] = s.agents, [r] = s.repos;
  assert.equal(a.repo, '/code/app');
  assert.equal(a.contextPct, 0.5);
  assert.match(a.color, /^#[0-9a-f]{6}$/);
  assert.equal(typeof a.colorIndex, 'number');
  for (const farmOnly of ['look', 'hearts', 'shirt', 'field', 'pct']) assert.ok(!(farmOnly in a), farmOnly);
  for (const farmOnly of ['crop', 'fence', 'soil', 'weather', 'pennant', 'lastDeploy']) assert.ok(!(farmOnly in r), farmOnly);
  assert.equal(r.onMain, true);
  assert.ok(!('farmers' in s) && !('fields' in s) && !('henhouse' in s) && !('carts' in s));
});

test("a repo's deploy: the collector's newest kept as it is, else its bare Actions run, else none", () => {
  const { deployOf } = load();
  assert.deepEqual(plain(deployOf(repo('/a', { lastDeploy: { state: 'blocked', label: "⏸ Actions didn't run", detail: 'billing', url: 'https://github.com/x/y/actions/runs/1', source: 'actions', extra: 'dropped' } }))),
    { state: 'blocked', label: "⏸ Actions didn't run", detail: 'billing', url: 'https://github.com/x/y/actions/runs/1', source: 'actions' });
  assert.equal(deployOf(repo('/a', { lastDeploy: null, deploy: { status: 'completed', conclusion: 'failure' } })), null, 'a lastDeploy of null wins over the bare run');
  assert.deepEqual(plain(deployOf(repo('/a', { deploy: { status: 'in_progress', url: 'https://github.com/r' } }))), { state: 'running', label: null, detail: null, url: 'https://github.com/r', source: 'actions', run: true });
  assert.equal(deployOf(repo('/a', { deploy: { status: 'completed', conclusion: 'success' } })).state, 'ok');
  assert.equal(deployOf(repo('/a', { deploy: { status: 'completed', conclusion: 'failure' } })).state, 'failed');
  assert.equal(deployOf(repo('/a', { deploy: { status: 'completed', conclusion: 'cancelled' } })).state, 'other');
  assert.equal(deployOf(repo('/a')), null);
});

test("a repo's project: the folder holding sibling repos, never a catch-all like ~/code; a worktree goes with its repo", () => {
  const { toScene } = load();
  const s = plain(toScene(snapOf([], [repo('/Users/sam/code/shop/api'), repo('/Users/sam/code/shop/web'), repo('/Users/sam/code/blog'), repo('/Users/sam/code/shop/api-cart', { worktree: true, main: '/Users/sam/code/shop/api' })])));
  assert.deepEqual(s.repos.map(r => [r.project, r.projectName]), [['/Users/sam/code/shop', 'shop'], ['/Users/sam/code/shop', 'shop'], [null, null], ['/Users/sam/code/shop', 'shop']]);
});

test("the plan's limits as windows, each with the share used (0 once it has reset), and the two the worlds draw by name", () => {
  const { toScene } = load();
  const plan = { windows: [{ kind: 'five_hour', percentUsed: 80, resetsAt: NOW + 1, reset: true }, { kind: 'seven_day', percentUsed: 47, resetsAt: NOW + 2 }, { kind: 'seven_day_opus', percentUsed: 5, resetsAt: null }] };
  const s = plain(toScene(snapOf([], [], { plan })));
  assert.deepEqual(s.plan.windows, [{ kind: 'five_hour', pct: 0, resetsAt: NOW + 1, reset: true }, { kind: 'seven_day', pct: 47, resetsAt: NOW + 2, reset: false }, { kind: 'seven_day_opus', pct: 5, resetsAt: null, reset: false }]);
  assert.deepEqual(s.plan.fiveHour, s.plan.windows[0]);
  assert.deepEqual(s.plan.weekly, s.plan.windows[1]);
  assert.equal(toScene(snapOf([], [])).plan, null);
});

test('subagents counted for the worlds: done lately, and running beyond the four an agent leads', () => {
  const { toScene } = load();
  const kids = (running, done) => [...Array.from({ length: running }, (_, i) => ({ id: `r${i}`, state: 'running' })), ...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, state: 'done' }))];
  assert.deepEqual(plain(toScene(snapOf([agent('a', { children: kids(6, 2) }), agent('b', { children: kids(1, 9) })], [])).subagentCounts), { done: 6, overflow: 2 });
});

test("an agent's colour follows its id, and the page gets the same one", () => {
  const { toScene, colorOf } = load();
  const [a] = toScene(snapOf([agent('abc')], [])).agents;
  assert.equal(a.color, colorOf('abc'));
  assert.equal(colorOf('abc'), colorOf('abc'));
});
