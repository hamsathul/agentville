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

test("a private scene: an agent is named 'agent N' (a session's name can be its title); subagents' parents follow", () => {
  const { toScene, privateScene } = load();
  const kid = { id: 's', kind: 'subagent', state: 'running', label: 'x', agentType: 'Explore' };
  const s = toScene(snapOf([
    agent('a', { name: 'Fix invoices', cwd: '/Users/sam/code/shop/', children: [kid] }),
    agent('b', { name: 'Refund the Acme order', cwd: '/Users/sam/code/shop' }),
    agent('c', { name: 'Plan the launch', kind: 'codex', cwd: null }),
    agent('d', { name: 'Another secret title', cwd: null }),
  ], []));
  const p = JSON.parse(JSON.stringify(privateScene(s)));
  assert.deepEqual(p.agents.map(a => a.name), ['agent 1', 'agent 2', 'agent 3', 'agent 4']);
  assert.deepEqual(p.subagents.map(x => [x.parent, x.type]), [['agent 1', 'Explore']]);
  const text = JSON.stringify(p);
  for (const title of ['Fix invoices', 'Refund', 'Acme', 'Plan the launch', 'secret title', 'shop']) assert.ok(!text.includes(title), title);
});

test('a private scene: an agent keeps its number while the page is open, and a new one gets the next', () => {
  const { toScene, privateScene } = load();
  const names = ids => privateScene(toScene(snapOf(ids.map(i => agent(i, { name: 'Title ' + i })), []))).agents.map(a => a.name);
  assert.deepEqual(names(['a', 'b']), ['agent 1', 'agent 2']);
  assert.deepEqual(names(['b']), ['agent 2']);
  assert.deepEqual(names(['a', 'c', 'b']), ['agent 1', 'agent 3', 'agent 2']);
});

test("a private scene: a repo's and a project's names match the numbers of their stand-ins", () => {
  const { toScene, privateScene } = load();
  const s = toScene(snapOf([], [repo('/Users/sam/code/shop/api'), repo('/Users/sam/code/shop/web'), repo('/Users/sam/code/other/app'), repo('/Users/sam/code/solo')]));
  const p = JSON.parse(JSON.stringify(privateScene(s)));
  for (const r of p.repos) assert.equal(r.name, 'repo ' + r.key.slice(1));
  assert.deepEqual(p.repos.map(r => r.name), ['repo 1', 'repo 2', 'repo 3', 'repo 4']);
  for (const r of p.repos.filter(r => r.project)) assert.equal(r.projectName, 'project ' + r.project.slice(1));
  assert.deepEqual(p.repos.map(r => r.projectName), ['project 1', 'project 1', 'project 2', null]);
  assert.equal(p.repos[3].project, null);
});

test("a private scene: a subagent's parent is its parent agent's stand-in name", () => {
  const { toScene, privateScene } = load();
  const kid = { id: 's', kind: 'subagent', state: 'running', label: 'x', agentType: 'Explore' };
  const p = JSON.parse(JSON.stringify(privateScene(toScene(snapOf([agent('a', { name: 'One' }), agent('b', { name: 'Two', children: [kid] })], [])))));
  assert.equal(p.subagents[0].parent, p.agents[1].name);
  assert.equal(p.subagents[0].parent, 'agent 2');
});

test('a private scene holds nothing that names the work: the sweep', () => {
  const { toScene, privateScene } = load();
  const kid = { id: 's', kind: 'subagent', state: 'running', label: 'acme-secret subagent', agentType: 'Explore' };
  const wt = repo('/Users/x/clients/acme-secret/api-wt', { name: 'acme-secret', worktree: true, main: '/Users/x/clients/acme-secret/api', branch: 'acme-secret' });
  const s = toScene(snapOf([
    agent('a', { name: 'Fix acme-secret login', cwd: '/Users/x/clients/acme-secret/api', children: [kid], now: { tool: 'Bash', summary: 'acme-secret', service: 'acme-secret.example' }, lastReply: 'acme-secret reply', question: 'acme-secret?', ask: { kind: 'question', questions: [{ question: 'acme-secret?' }] }, state: 'waiting', tasks: { done: 0, total: 1, current: 'acme-secret' },
      feed: [{ at: NOW, kind: 'peer', dir: 'out', other: 'Home work', text: 'acme-secret mail' }, { at: NOW, kind: 'reply', text: 'acme-secret said' }], touching: [{ path: '/Users/x/clients/acme-secret/api/f', mode: 'write', lastAt: 1, repo: '/Users/x/clients/acme-secret/api' }] }),
    agent('h', { name: 'Home work', cwd: '/Users/jdoe' }),
  ], [repo('/Users/x/clients/acme-secret/api', { name: 'acme-secret', branch: 'acme-secret', main: 'acme-secret', prs: { open: [{ number: 1, title: 'acme-secret', url: 'https://x/acme-secret', checks: 'ok', draft: false }], merged: [] }, lastDeploy: { state: 'ok', label: 'acme-secret', detail: 'acme-secret', url: 'https://acme-secret', source: 'actions' } }), wt, repo('/Users/jdoe/proj/x', { name: 'jdoe' })]));
  assert.ok(JSON.stringify(s).includes('acme-secret') && JSON.stringify(s).includes('jdoe'), 'the full scene has them');
  const text = JSON.stringify(privateScene(s));
  assert.ok(!text.includes('acme-secret'), 'acme-secret');
  assert.ok(!text.includes('jdoe'), 'jdoe');
});

test('a private scene: no words and no paths; names, states, tools and numbers stay; stand-ins are stable', () => {
  const { toScene, privateScene } = load();
  const s = toScene(snapOf([agent('a', { cwd: '/Users/sam/code/shop/api', now: { tool: 'Bash', summary: 'deploy --prod secret', step: 'deploy', service: 'internal.example' }, lastReply: 'Shipped the key rotation', question: 'Rotate the prod key?', state: 'waiting', ask: { kind: 'question', questions: [{ question: 'Rotate the prod key?' }] }, tasks: { done: 1, total: 3, current: 'Rotate', items: [{ text: 'secret' }] }, touching: [{ path: '/Users/sam/code/shop/api/x', mode: 'write', lastAt: 1, repo: '/Users/sam/code/shop/api' }], children: [{ id: 's', kind: 'subagent', state: 'running', label: 'read the secrets' }], feed: [{ at: NOW, kind: 'peer', dir: 'out', other: 'b', text: 'the password is x' }] }), agent('b')],
    [repo('/Users/sam/code/shop/api', { branch: 'fix/client-acme', lastDeploy: { state: 'failed', label: '✗', detail: 'acme-prod', url: 'https://github.com/x', source: 'actions' }, prs: { open: [{ number: 4, title: 'Acme hotfix', url: 'https://github.com/x/4', checks: 'ok', draft: false }], merged: [] } }), repo('/Users/sam/code/shop/web'), repo('/Users/sam/code/shop/api-wt', { worktree: true, main: '/Users/sam/code/shop/api' })]));
  const p = JSON.parse(JSON.stringify(privateScene(s)));
  assert.equal(p.private, true);
  const text = JSON.stringify(p);
  for (const secret of ['deploy --prod', 'internal.example', 'Shipped', 'Rotate', 'secret', 'password', 'acme', 'Acme', '/Users/sam', 'shop', 'api']) assert.ok(!text.includes(secret), secret);
  const [a] = p.agents, [api, web, wt] = p.repos;
  assert.deepEqual([a.name, a.state, a.tool, a.step, a.tasks], ['agent 1', 'waiting', 'Bash', 'deploy', { done: 1, total: 3 }]);
  assert.equal(a.repo, api.key);
  assert.match(api.key, /^r\d+$/);
  assert.notEqual(api.key, web.key);
  assert.equal(wt.main, api.key);
  assert.equal(api.name, 'repo ' + api.key.slice(1));
  assert.equal(api.projectName, 'project ' + api.project.slice(1));
  assert.match(api.project, /^p\d+$/);
  assert.equal(api.project, web.project);
  assert.deepEqual(api.deploy, { state: 'failed', label: null, detail: null, url: null, source: null });
  assert.deepEqual(api.prs, { open: [{ number: 4, checks: 'ok', draft: false }], merged: [] });
  assert.equal(api.onMain, false);
  assert.equal(JSON.parse(JSON.stringify(privateScene(s))).repos[0].key, api.key, 'the same stand-in next time');
});

test('accounts in the scene: names and plans, never emails; a private scene has numbers', () => {
  const { toScene, privateScene } = load();
  const snap = snapOf([agent('a', { account: 'zeta' }), agent('b', { kind: 'codex', account: undefined })], [], { accounts: [
    { key: 'main', name: 'nco', email: 'me@nco.example', org: 'NCO Org', plan: { windows: [{ kind: 'seven_day', percentUsed: 22, resetsAt: 5 }] } },
    { key: 'zeta', name: 'zeta', email: 'z@x.example', plan: null },
  ] });
  const s = plain(toScene(snap));
  assert.deepEqual(s.accounts.map(a => [a.key, a.name, a.plan?.weekly?.pct ?? null]), [['main', 'nco', 22], ['zeta', 'zeta', null]]);
  assert.deepEqual(s.agents.map(a => a.account), ['zeta', null]);
  assert.doesNotMatch(JSON.stringify(s), /me@nco|NCO Org|z@x/);
  const p = plain(privateScene(toScene(snap)));
  assert.deepEqual(p.accounts.map(a => [a.key, a.name, a.plan?.weekly?.pct ?? null]), [['a1', 'account 1', 22], ['a2', 'account 2', null]]);
  assert.deepEqual(p.agents.map(a => a.account), ['a2', null]);
  assert.doesNotMatch(JSON.stringify(p), /nco|zeta/);
  assert.deepEqual(plain(toScene(snapOf([], []))).accounts, [], 'no accounts in the snapshot: none in the scene');
});
