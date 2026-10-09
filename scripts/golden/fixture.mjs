// A fixed snapshot for the reference pictures of the farm (scripts/world-golden.mjs): a busy morning on a
// made-up Mac, the same on every run. It has something for most of what the farm draws: the porch, every
// state, tools, a project's repos side by side, a worktree, deploys, pull requests, an MCP cart, a pigeon.
export const GOLDEN_NOW = Date.UTC(2026, 9, 9, 7, 30);
const NOW = GOLDEN_NOW, MIN = 60_000;
const HOME = '/Users/sam/code';
const API = `${HOME}/shop/api`, WEB = `${HOME}/shop/web`, BLOG = `${HOME}/blog`, WT = `${HOME}/shop/api-cart`;

const agent = (id, name, over = {}) => ({
  id, kind: 'interactive', name, cwd: API, state: 'working', stateReason: 'busy', stateSince: NOW - 4 * MIN,
  feed: [], children: [], touching: [], contextTokens: 60_000, proc: { cpu: 12, rssMb: 420, pid: 1000 + id.length, childCount: 0, children: [] },
  usage: { costUsd: 1.25 }, mode: 'default', effort: 'high', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', fast: false,
  tasks: null, compactions: 0, mcp: [], ...over,
});
const wrote = (repo, file, ago = 2) => ({ path: `${repo}/${file}`, mode: 'write', lastAt: NOW - ago * MIN, repo });

export function goldenSnapshot() {
  const agents = [
    agent('g-ask', 'checkout-fix', { state: 'waiting', stateReason: 'question pending', ask: { kind: 'question', toolUseId: 'tu-1', questions: [{ question: 'Ship the new cart to staging?', header: 'Ship', multiSelect: false, options: [{ label: 'Yes', description: 'to staging' }, { label: 'Not yet' }] }] }, touching: [wrote(API, 'src/cart.ts', 6)] }),
    agent('g-perm', 'api-tests', { state: 'waiting', stateReason: 'permission', ask: { kind: 'permission', toolUseId: 'tu-2', tool: 'Bash', summary: 'npm publish' }, touching: [wrote(API, 'package.json', 3)] }),
    agent('g-done', 'blog-draft', { state: 'yourTurn', cwd: BLOG, lastReply: 'The post is drafted.\nTwo images left.', feed: [{ at: NOW - MIN, kind: 'reply', text: 'Drafted', body: 'The post is **drafted**. Two images left.' }], touching: [wrote(BLOG, 'posts/autumn.md', 5)] }),
    agent('g-q', 'web-copy', { state: 'yourTurn', cwd: WEB, question: 'Keep the old footer?', touching: [wrote(WEB, 'src/footer.tsx', 8)] }),
    agent('g-edit', 'cart-ui', { cwd: WEB, now: { tool: 'Edit', summary: 'src/cart/Basket.tsx', step: 'edit', startedAt: NOW - 20_000 }, contextTokens: 150_000, tasks: { done: 3, total: 7, current: 'Basket totals', items: [] }, touching: [wrote(WEB, 'src/cart/Basket.tsx', 1)] }),
    agent('g-test', 'api-tests-2', { now: { tool: 'Bash', summary: 'npm test', step: 'test', startedAt: NOW - 40_000 }, contextTokens: 190_000, children: [{ id: 'g-sub1', kind: 'subagent', state: 'running', label: 'Find the slow test', agentType: 'Explore', startedAt: NOW - MIN }, { id: 'g-sub2', kind: 'subagent', state: 'running', label: 'Read the logs', startedAt: NOW - MIN }], touching: [wrote(API, 'test/cart.test.ts', 2)] }),
    agent('g-mcp', 'inbox', { cwd: WT, now: { tool: 'mcp__claude_ai_Gmail__search_threads', summary: 'harvest', step: 'mcp', service: 'Gmail', startedAt: NOW - 5_000 }, mcp: [{ server: 'Gmail', at: NOW - 5_000 }], model: 'claude-sonnet-5-5', modelLabel: 'Sonnet 5.5', touching: [wrote(WT, 'src/cart.ts', 4)], feed: [{ at: NOW - 30_000, kind: 'peer', dir: 'out', other: 'cart-ui', text: 'Basket API is ready' }] }),
    agent('g-web', 'research', { cwd: BLOG, now: { tool: 'WebFetch', summary: 'example.com/docs', step: 'web', service: 'example.com', startedAt: NOW - 8_000 }, model: 'claude-haiku-5-5', modelLabel: 'Haiku 5.5', fast: true, touching: [wrote(BLOG, 'notes.md', 9)] }),
    agent('g-idle', 'old-spike', { state: 'idle', stateReason: 'idle', stateSince: NOW - 40 * MIN, cwd: HOME }),
    agent('g-stale', 'last-week', { state: 'stale', stateReason: 'stale', stateSince: NOW - 3 * 86_400_000, cwd: HOME }),
    agent('codex:g1', 'codex', { kind: 'codex', cwd: API, model: null, modelLabel: null, now: { tool: 'Read', summary: 'src/db.ts', step: 'read', startedAt: NOW - 3_000 }, touching: [{ path: `${API}/src/db.ts`, mode: 'read', lastAt: NOW - MIN, repo: API }] }),
  ];
  const repos = [
    { path: API, name: 'api', agentIds: ['g-ask', 'g-perm', 'g-test', 'codex:g1'], branch: 'main', dirty: 3, ahead: 2, behind: 0, lastDeploy: { state: 'ok', source: 'actions', label: '✓ deployed', detail: 'Deploy #212 passed', url: 'https://github.com/sam/api/actions/runs/1', at: NOW - 30 * MIN } },
    { path: WT, name: 'api-cart', agentIds: ['g-mcp'], branch: 'cart', worktree: true, main: API, dirty: 1, ahead: 0, behind: 0, lastDeploy: null },
    { path: WEB, name: 'web', agentIds: ['g-edit', 'g-q'], branch: 'feature/cart', dirty: 5, ahead: 0, behind: 1, lastDeploy: { state: 'failed', source: 'actions', label: '✗ deploy failed', detail: 'Build step failed', url: 'https://github.com/sam/web/actions/runs/2', at: NOW - 12 * MIN },
      prs: { open: [{ number: 41, title: 'New basket', url: 'https://github.com/sam/web/pull/41', checks: 'running', draft: false }, { number: 38, title: 'Footer copy', url: 'https://github.com/sam/web/pull/38', checks: 'ok', draft: true }], merged: [] } },
    { path: BLOG, name: 'blog', agentIds: ['g-done', 'g-web'], branch: 'main', dirty: 0, ahead: 0, behind: 2, lastDeploy: { state: 'running', source: 'direct', label: '◌ deploying', detail: 'rsync to the server', at: NOW - MIN } },
  ];
  return {
    generatedAt: NOW,
    collector: { cpu: 0.4, rssMb: 80 },
    machine: { totalMemMb: 32768, cpuCount: 10 },
    sources: {},
    settings: { cpuAlertPct: 90 },
    counts: { waiting: 2, working: 5, yourTurn: 2, stale: 1, idle: 1, collisions: 1 },
    plan: { from: 'golden', at: NOW, windows: [{ kind: 'five_hour', percentUsed: 34, resetsAt: NOW + 2 * 3_600_000 }, { kind: 'seven_day', percentUsed: 72, resetsAt: NOW + 3 * 86_400_000 }] },
    collisions: [{ repo: API, severity: 'high', reason: 'two agents edit the same files', since: NOW - 5 * MIN, agentIds: ['g-test', 'g-perm'] }],
    agents, repos,
  };
}

/** The files agents touched in a repo, for a field's close-up. */
export function goldenTouched(path) {
  if (path !== WEB) return { status: 404, error: 'That repo is not on the dashboard.' };
  return {
    repo: WEB, name: 'web', branch: 'feature/cart', truncated: false,
    files: [
      { path: 'src/cart/Basket.tsx', at: NOW - MIN, git: 'M', agents: [{ id: 'g-edit', wrote: true }] },
      { path: 'src/footer.tsx', at: NOW - 8 * MIN, git: 'M', agents: [{ id: 'g-q', wrote: true }, { id: 'g-edit', wrote: true }] },
      { path: 'README.md', at: NOW - 20 * MIN, doc: true, agents: [{ id: 'g-q', wrote: false }] },
      { path: 'package.json', at: NOW - 30 * MIN, agents: [{ id: 'g-edit', wrote: false }] },
    ],
  };
}
