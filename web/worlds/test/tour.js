// The test page's tour (/worlds/test, and npm run check-world): made-up snapshots, the shape the collector
// sends, one stop for each thing a world may show (docs/worlds.md, "The tour"). No real names, paths or
// words. A classic script: the test page loads it, and check-world runs it in a vm.
(() => {
  'use strict';
  const NOW = Date.UTC(2026, 9, 9, 9, 0), MIN = 60_000, HOME = '/Users/you/code';
  const path = name => `${HOME}/${name}`;
  const agent = (id, over = {}) => ({
    id, kind: 'interactive', name: id, cwd: path('shop'), state: 'working', stateReason: 'busy', stateSince: NOW - 3 * MIN,
    feed: [], children: [], touching: [], contextTokens: 40_000, proc: { cpu: 5, rssMb: 300, pid: 100, childCount: 0, children: [] },
    usage: { costUsd: 0.4 }, mode: 'default', effort: 'high', model: 'claude-sonnet-5-5', modelLabel: 'Sonnet 5.5', fast: false, tasks: null, compactions: 0, mcp: [],
    now: { tool: 'Edit', summary: 'src/app.ts', step: 'edit', startedAt: NOW - 20_000 }, ...over,
  });
  const repo = (name, over = {}) => ({ path: path(name), name, branch: 'main', dirty: 0, ahead: 0, behind: 0, lastDeploy: null, ...over });
  const windows = (five, week) => [{ kind: 'five_hour', percentUsed: five, resetsAt: NOW + 3 * 3_600_000 }, { kind: 'seven_day', percentUsed: week, resetsAt: NOW + 4 * 86_400_000 }];
  // The panel's counts, as the collector counts them (by state; collisions from the list).
  const countsOf = (agents, collisions) => {
    const n = state => agents.filter(a => a.state === state).length;
    return { waiting: n('waiting'), working: n('working'), yourTurn: n('yourTurn'), stale: n('stale'), idle: n('idle'), collisions: collisions.length };
  };
  const snap = (agents, repos, over = {}) => {
    const { counts, ...rest } = over, collisions = rest.collisions ?? [];
    return {
      generatedAt: NOW, collector: { cpu: 0.3, rssMb: 70 }, machine: { totalMemMb: 16384, cpuCount: 8 }, sources: {}, settings: { cpuAlertPct: 90 },
      counts: counts ?? countsOf(agents, collisions), plan: { from: 'tour', at: NOW, windows: windows(30, 40) }, collisions, agents,
      repos: repos.map(r => ({ agentIds: agents.filter(a => a.cwd === r.path).map(a => a.id), ...r })), ...rest,
    };
  };
  const SHOP = [repo('shop')], one = over => snap([agent('a1', over)], SHOP);
  const STEP_TOOLS = { edit: 'Edit', write: 'Write', read: 'Read', search: 'Grep', web: 'WebFetch', mcp: 'mcp__tickets__search', skill: 'Skill', test: 'Bash', lint: 'Bash', build: 'Bash', install: 'Bash', commit: 'Bash', push: 'Bash', deploy: 'Bash', pull: 'Bash', serve: 'Bash', delete: 'Bash', agent: 'Agent', plan: 'TodoWrite', ask: 'AskUserQuestion', shell: 'Bash' };
  const STEP_REPOS = ['shop', 'blog', 'api', 'docs', 'site', 'tools'].map(n => repo(n));
  const everyone = () => snap([
    agent('a1', { now: { tool: 'Edit', summary: 'src/cart.ts', step: 'edit', startedAt: NOW - 20_000 } }),
    agent('a2', { state: 'waiting', stateReason: 'permission', ask: { kind: 'permission', toolUseId: 't1', tool: 'Bash', summary: 'npm publish' }, now: null }),
    agent('a3', { state: 'yourTurn', cwd: path('blog'), lastReply: 'Done: the draft is up.', now: null }),
    agent('a4', { cwd: path('blog'), now: { tool: 'Bash', summary: 'npm test', step: 'test', startedAt: NOW - 30_000 }, children: [{ id: 's1', kind: 'subagent', state: 'running', label: 'Find the slow test', agentType: 'Explore', startedAt: NOW - MIN }] }),
    agent('a5', { state: 'idle', stateReason: 'idle', stateSince: NOW - 40 * MIN, cwd: path('api'), now: null }),
    agent('a6', { state: 'stale', stateReason: 'stale', stateSince: NOW - 3 * 86_400_000, cwd: path('api'), now: null }),
    agent('a7', { cwd: path('api'), now: { tool: 'Read', summary: 'src/db.ts', step: 'read', startedAt: NOW - 5_000 } }),
  ], [repo('shop', { lastDeploy: { state: 'ok', source: 'actions', label: '✓ deployed', at: NOW - 30 * MIN } }), repo('blog', { lastDeploy: { state: 'running', source: 'direct', label: '◌ deploying', at: NOW - MIN } }), repo('api')]);
  const pair = (over = {}) => snap([agent('a1'), agent('a2', { now: { tool: 'Edit', summary: 'src/ui.ts', step: 'edit', startedAt: NOW - 10_000 } })], SHOP, over);
  const deployed = (state, label = state) => snap([agent('a1')], [repo('shop', { lastDeploy: { state, source: 'actions', label, at: NOW - 5 * MIN } })]);
  const stop = (name, title, frames, over = {}) => ({ name, title, sky: 'day', private: false, frames, ...over });

  const stops = [
    stop('everyone', 'A busy morning: every state at once', [everyone()]),
    stop('one', 'One agent', [one()]),
    stop('sixteen', 'Sixteen agents', [snap(Array.from({ length: 16 }, (_, i) => agent(`a${i + 1}`, { cwd: STEP_REPOS[i % 6].path })), STEP_REPOS)]),
    stop('nobody', 'No agents at all', [snap([], [repo('shop'), repo('blog')])]),
    stop('working', 'Working: editing a file', [one()]),
    stop('waiting', 'Waiting on you: a permission', [one({ state: 'waiting', stateReason: 'permission', ask: { kind: 'permission', toolUseId: 't1', tool: 'Bash', summary: 'npm publish' }, now: null })]),
    stop('question', 'Waiting on you: a question', [one({ state: 'waiting', stateReason: 'question pending', ask: { kind: 'question', toolUseId: 't2', questions: [{ question: 'Ship it?', header: 'Ship', multiSelect: false, options: [{ label: 'Yes' }, { label: 'Not yet' }] }] }, now: null })]),
    stop('plan-ask', 'Waiting on you: a plan to approve', [one({ state: 'waiting', stateReason: 'plan', now: { tool: 'ExitPlanMode', summary: 'The plan', step: 'plan', startedAt: NOW - 5_000 } })]),
    stop('turn', 'Your turn: it finished', [one({ state: 'yourTurn', lastReply: 'Done: the tests pass.', now: null })]),
    stop('idle', 'Idle', [one({ state: 'idle', stateReason: 'idle', stateSince: NOW - 40 * MIN, now: null })]),
    stop('stale', 'Stale: untouched for days', [one({ state: 'stale', stateReason: 'stale', stateSince: NOW - 3 * 86_400_000, now: null })]),
    stop('nap', 'Napping: it wakes up by itself', [one({ state: 'yourTurn', now: null, wakeAt: NOW + 20 * MIN })]),
    stop('thinking', 'Thinking between steps', [one({ now: null, turn: { mode: 'thinking', startedAt: NOW - 8_000 } })]),
    stop('steps', 'Every step, and plan mode', [snap([
      ...Object.entries(STEP_TOOLS).map(([step, tool], i) => agent(`s-${step}`, { cwd: STEP_REPOS[i % 6].path, now: { tool, summary: step, step, startedAt: NOW - 5_000 } })),
      agent('s-planmode', { cwd: path('tools'), mode: 'plan' }),
    ], STEP_REPOS)]),
    stop('context-low', 'A repo with little context used', [one({ contextTokens: 20_000 })]),
    stop('context-high', 'A repo nearly full of context', [one({ contextTokens: 180_000 })]),
    stop('compaction', 'A compaction: the context starts again', [one({ contextTokens: 190_000, compactions: 1 }), one({ contextTokens: 15_000, compactions: 2 })]),
    stop('compacted-plain', 'After a compaction, without seeing it happen', [one({ contextTokens: 15_000, compactions: 2 })]),
    stop('deploy-ok', 'Deploy: ok', [deployed('ok')]),
    stop('deploy-failed', 'Deploy: failed', [deployed('failed')]),
    stop('deploy-running', 'Deploy: running', [deployed('running')]),
    // A run GitHub never started (billing, a spending limit): the collector's blocked (collector/derive/deploys.mjs).
    stop('deploy-skipped', "Deploy: skipped (Actions didn't run)", [deployed('blocked', "⏸ Actions didn't run")]),
    stop('two-working', 'Two agents in one repo', [pair()]),
    stop('collision', 'A collision: two agents writing one repo', [pair({ collisions: [{ repo: path('shop'), severity: 'high', reason: 'two agents edit the same files', since: NOW - 5 * MIN, agentIds: ['a1', 'a2'] }] })]),
    stop('pigeon', 'A message from one agent to another', [snap([agent('a1', { feed: [{ at: NOW - 20_000, kind: 'peer', dir: 'out', other: 'a2', text: 'The API is ready' }] }), agent('a2', { now: { tool: 'Edit', summary: 'src/ui.ts', step: 'edit', startedAt: NOW - 10_000 } })], SHOP)]),
    stop('merged', 'A pull request merged', [
      snap([agent('a1')], [repo('shop', { prs: { open: [{ number: 12, title: 'New cart', url: 'https://example.com/pr/12', checks: 'ok', draft: false }], merged: [] } })]),
      snap([agent('a1')], [repo('shop', { prs: { open: [], merged: [{ number: 12, title: 'New cart', url: 'https://example.com/pr/12', at: NOW }] } })]),
    ]),
    stop('mcp', 'An MCP call: a connector cart', [one({ now: { tool: 'mcp__tickets__search', summary: 'open tickets', step: 'mcp', service: 'tickets', startedAt: NOW - 4_000 }, mcp: [{ server: 'tickets', at: NOW - 4_000 }] })]),
    stop('subagents', 'Subagents running and done', [one({ children: [{ id: 'c1', kind: 'subagent', state: 'running', label: 'Look around', agentType: 'Explore', startedAt: NOW - MIN }, { id: 'c2', kind: 'subagent', state: 'running', label: 'Write tests', startedAt: NOW - MIN }, { id: 'c3', kind: 'subagent', state: 'done', label: 'Read the docs', startedAt: NOW - 5 * MIN }] })]),
    stop('limits-low', 'The 5-hour and weekly limits: barely used', [snap([agent('a1')], SHOP, { plan: { from: 'tour', at: NOW, windows: windows(10, 15) } })]),
    stop('limits-high', 'The 5-hour and weekly limits: nearly used up', [snap([agent('a1')], SHOP, { plan: { from: 'tour', at: NOW, windows: windows(95, 92) } })]),
    stop('accounts', 'Two Claude accounts: one fresh, one nearly used up', [snap([agent('a1', { account: 'home' })], SHOP, { plan: { from: 'tour', at: NOW, windows: windows(30, 40) }, accounts: [
      { key: 'work', name: 'work', email: null, signedIn: true, open: 0, costUsd: 0, plan: { from: 'tour', at: NOW, windows: windows(30, 40) } },
      { key: 'home', name: 'home', email: null, signedIn: true, open: 1, costUsd: 0, plan: { from: 'tour', at: NOW, windows: windows(95, 92) } },
    ] })]),
    stop('day', 'By day', [everyone()]),
    stop('night', 'By night', [everyone()], { sky: 'night' }),
    stop('private', 'Privacy mode: no words, paths or names', [everyone()], { private: true }),
  ];
  // The checklist (docs/worlds.md): each item, and two stops that differ only in it. check-world points out
  // the ones a world draws the same.
  const checks = [
    ['waiting on you', 'working', 'waiting'], ['a question for you', 'working', 'question'], ['your turn', 'working', 'turn'],
    ['a repo filling with context', 'context-low', 'context-high'], ['a compaction', 'compacted-plain', 'compaction'],
    ['deploy failed', 'deploy-ok', 'deploy-failed'], ['deploying', 'deploy-ok', 'deploy-running'], ['deploy skipped', 'deploy-ok', 'deploy-skipped'],
    ['subagents', 'working', 'subagents'], ['the limits', 'limits-low', 'limits-high'], ['several accounts', 'working', 'accounts'], ['an MCP call', 'working', 'mcp'],
    ['messages between agents', 'two-working', 'pigeon'], ['a collision', 'two-working', 'collision'], ['a merged pull request', 'working', 'merged'],
    ['idle', 'working', 'idle'], ['stale', 'idle', 'stale'], ['night', 'day', 'night'],
  ];
  /** A made-up answer to a world's request, in the collector's shapes: { ok, status, data }. */
  function answer(act) {
    if (act.what === 'repoTouched') return { ok: true, status: 200, data: { repo: act.repo, name: act.repo.split('/').pop(), branch: 'main', truncated: false, files: [
      { path: 'src/app.ts', at: NOW - MIN, git: 'M', agents: [{ id: 'a1', wrote: true }] },
      { path: 'README.md', at: NOW - 20 * MIN, doc: true, agents: [{ id: 'a1', wrote: false }] },
    ] } };
    // agentFiles, as the collector's listFiles answers (collector/collector.mjs; listFolder in collector/sources/files.mjs)
    return { ok: true, status: 200, data: {
      root: path('shop'), git: true, files: ['README.md', 'package.json', 'src/app.ts', 'src/cart.ts'], status: { 'src/app.ts': 'M' },
      repos: [{ path: '', top: path('shop'), name: 'shop', branch: 'main' }], truncated: false,
      touched: { 'src/app.ts': { wrote: true, at: NOW - MIN }, 'README.md': { wrote: false, at: NOW - 20 * MIN } }, scratch: null, memory: [],
    } };
  }
  window.AgentvilleTour = { NOW, stops, checks, stop: name => stops.find(s => s.name === name) ?? null, answer };
})();
