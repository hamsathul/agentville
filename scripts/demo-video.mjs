#!/usr/bin/env node
// Records a demo video of Agentville, with made-up sessions only. A collector runs on a demo
// ~/.claude (fourteen sessions in six demo repos, with stand-ins for their mods, their processes
// and GitHub), a director keeps the sessions busy, and headless Chrome tours the features with a
// cursor and captions: the farm, then the farm's sidebar, then the list view. Frames come from
// Chrome's screencast; ffmpeg makes the MP4 (about 4 minutes).
//
//   node scripts/demo-video.mjs [out.mp4]      (needs Chrome and ffmpeg)
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCollector } from '../collector/collector.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? 'agentville-demo.mp4');
const CHROME = process.env.CHROME ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => existsSync(p));
if (!CHROME) { console.error('Chrome not found: set CHROME to its path.'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('·', ...a);

/* ---------- the demo world: repos ---------- */

// Under /Users/Shared, the dashboard shows paths as ~/agentville-demo/… and no one's name.
const DEMO = '/Users/Shared/agentville-demo';
rmSync(DEMO, { recursive: true, force: true });
const CODE = join(DEMO, 'code');
const API = join(CODE, 'shop', 'api'), WEB = join(CODE, 'shop', 'web'), DOCS = join(CODE, 'docs'), MOBILE = join(CODE, 'mobile'), INFRA = join(CODE, 'infra'), ANALYTICS = join(CODE, 'analytics');
const WORKTREE = join(API, '.claude', 'worktrees', 'checkout');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=demo@example.com', '-c', 'user.name=Demo', ...args], { stdio: 'pipe' });
const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function repo(dir, files, { branch = 'main' } = {}) {
  for (const [f, text] of Object.entries(files)) put(join(dir, f), text);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'Start');
  if (branch !== 'main') git(dir, 'checkout', '-q', '-b', branch);
}
repo(API, {
  'README.md': '# Shop API\n\nOrders, payments and checkout.\n',
  'src/checkout.ts': 'export async function checkout(cart) {\n  return createOrder(cart);\n}\n',
  'src/orders.ts': 'export function createOrder(cart) {\n  return { id: crypto.randomUUID(), items: cart.items };\n}\n',
  'tests/checkout.test.ts': "test('checkout creates one order', () => {});\n",
  'CLAUDE.md': '# Shop API\n\n- Run `npm test` before every commit.\n- Orders are idempotent: one cart, one order.\n',
});
put(join(API, '.git', 'info', 'exclude'), '.claude/\n');
const ORIGIN = join(DEMO, 'origins', 'api.git');
mkdirSync(ORIGIN, { recursive: true });
execFileSync('git', ['init', '-q', '--bare', ORIGIN]);
git(API, 'remote', 'add', 'origin', ORIGIN);
git(API, 'push', '-q', 'origin', 'main');
for (const [i, msg] of ['Checkout: validate the cart', 'Orders: one order per cart'].entries()) { put(join(API, `src/step${i}.ts`), `// ${msg}\n`); git(API, 'add', '.'); git(API, 'commit', '-q', '-m', msg); } // 2 unpushed
put(join(API, 'src/checkout.ts'), 'export async function checkout(cart) {\n  validate(cart);\n  return createOrder(cart);\n}\n');
put(join(API, 'src/payments.ts'), 'export const payments = {};\n');
put(join(API, 'docs/plan.md'), '# Checkout plan\n\n1. **Validate** the cart before anything is charged.\n2. Make order creation **idempotent**: one cart, one order.\n3. Retry the payment webhook with backoff.\n\n| Step | Owner | Status |\n|---|---|---|\n| Validation | checkout-api | done |\n| Idempotency | checkout-api | in progress |\n| Webhook | deploy-bot | next |\n');
git(API, 'worktree', 'add', '-q', '-b', 'checkout-flow', WORKTREE);
repo(WEB, { 'README.md': '# Shop web\n', 'src/cart.tsx': 'export function Cart() { return null; }\n', 'src/drawer.tsx': '' }, { branch: 'feature/cart' });
for (const f of ['src/cart.tsx', 'src/drawer.tsx', 'src/theme.css']) put(join(WEB, f), '/* changed */\n');
repo(DOCS, { 'README.md': '# Docs\n', 'deploy.sh': 'echo deployed\n', 'guide/start.md': '# Start\n' });
repo(MOBILE, { 'README.md': '# Mobile\n', 'deploy.sh': 'exit 1\n', 'App/Cart.swift': 'struct Cart {}\n' });
repo(INFRA, { 'README.md': '# Infra\n', 'terraform/main.tf': '# infra\n' });
repo(ANALYTICS, { 'README.md': '# Analytics\n', 'notebooks/funnel.py': 'print("funnel")\n' });
put(join(DEMO, '.claude', 'CLAUDE.md'), '# Everywhere\n\n- Prefer small commits.\n');

/* ---------- the demo world: sessions ---------- */

const claudeDir = join(DEMO, '.claude');
mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
const NOW = Date.now(), MIN = 60_000;
const iso = ms => new Date(ms).toISOString();
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-4-5-20251001';
const SESSIONS = [
  { key: 'demo-checkout', name: 'checkout-api', cwd: API, model: OPUS, ctx: 150_000, cpu: 31, mb: 760, cost: 6.42, word: 'Simmering', effort: 'xhigh' },
  { key: 'demo-cart', name: 'cart-ui', cwd: WEB, model: SONNET, ctx: 70_000, cpu: 22, mb: 540, cost: 2.18, word: 'Noodling', effort: 'high', mode: 'acceptEdits' },
  { key: 'demo-flow', name: 'checkout-flow', cwd: WORKTREE, model: OPUS, ctx: 40_000, cpu: 12, mb: 480, cost: 1.06, word: 'Tinkering', effort: 'high' },
  { key: 'demo-docs', name: 'docs-site', cwd: DOCS, model: SONNET, ctx: 110_000, cpu: 9, mb: 410, cost: 3.9, word: 'Browsing', effort: 'medium' },
  { key: 'demo-ios', name: 'ios-build', cwd: MOBILE, model: OPUS, ctx: 90_000, cpu: 27, mb: 690, cost: 4.75, word: 'Planning', effort: 'xhigh', command: 'claude --permission-mode plan', mode: 'plan' },
  { key: 'demo-ops', name: 'infra-ops', cwd: INFRA, model: OPUS, ctx: 60_000, cpu: 14, mb: 520, cost: 2.6, word: 'Provisioning', effort: 'high', command: 'claude --dangerously-skip-permissions', fast: true, mode: 'bypassPermissions' },
  { key: 'demo-metrics', name: 'metrics', cwd: ANALYTICS, model: HAIKU, ctx: 180_000, cpu: 6, mb: 330, cost: 0.84, word: 'Crunching', effort: 'low' },
  { key: 'demo-orders', name: 'orders-db', cwd: API, model: OPUS, ctx: 55_000, cpu: 1, mb: 380, cost: 1.47 },
  { key: 'demo-deploy', name: 'deploy-bot', cwd: INFRA, model: SONNET, ctx: 30_000, cpu: 1, mb: 300, cost: 0.62 },
  { key: 'demo-cache', name: 'cache-plan', cwd: WEB, model: OPUS, ctx: 45_000, cpu: 1, mb: 350, cost: 1.12, command: 'claude --permission-mode plan', mode: 'plan' },
  { key: 'demo-notes', name: 'release-notes', cwd: DOCS, model: SONNET, ctx: 85_000, cpu: 0, mb: 290, cost: 1.93 },
  { key: 'demo-ci', name: 'ci-watch', cwd: INFRA, model: HAIKU, ctx: 25_000, cpu: 0, mb: 220, cost: 0.31 },
  { key: 'demo-scratch', name: 'scratch', cwd: ANALYTICS, model: SONNET, ctx: 0, cpu: 0, mb: 200, cost: 0.05 },
  { key: 'demo-spike', name: 'old-spike', cwd: ANALYTICS, model: SONNET, ctx: 20_000, cpu: 0, mb: 180, cost: 0.4 },
];
SESSIONS.forEach((s, i) => { s.id = `0de30000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`; }); // session ids are UUIDs
const byId = Object.fromEntries(SESSIONS.map(s => [s.key, s]));
const sleepers = [];
let msgN = 0, taskN = 0, callN = 0;
for (const s of SESSIONS) {
  const p = spawn('sleep', ['900'], { stdio: 'ignore' });
  sleepers.push(p);
  s.pid = p.pid;
  s.file = join(claudeDir, 'projects', s.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${s.id}.jsonl`);
  mkdirSync(dirname(s.file), { recursive: true });
  writeFileSync(s.file, '');
  s.open = null; // the tool call still running
  s.turnAt = NOW - 4 * MIN;
}
// Transcript lines, as Claude Code writes them.
const write = (s, ...entries) => appendFileSync(s.file, `${entries.map(e => JSON.stringify(e)).join('\n')}\n`);
const prompt = (s, text, ms = Date.now(), extra = {}) => ({ type: 'user', timestamp: iso(ms), cwd: s.cwd, permissionMode: s.mode ?? 'default', message: { role: 'user', content: text }, ...extra });
const assistant = (s, content, ms = Date.now(), out = 400) => ({ type: 'assistant', timestamp: iso(ms), cwd: s.cwd, message: { id: `msg_${++msgN}`, model: s.model, role: 'assistant', content, usage: { input_tokens: 1200, cache_read_input_tokens: s.ctx, cache_creation_input_tokens: 800, output_tokens: out, ...(s.fast ? { speed: 'fast' } : {}) } } });
function use(s, name, input, ms = Date.now()) {
  const id = `toolu_${++callN}`;
  write(s, assistant(s, [{ type: 'tool_use', id, name, input }], ms, 200 + (callN % 7) * 180));
  return id;
}
const result = (s, id, { error = false, ms = Date.now(), text = 'ok', extra = {} } = {}) => write(s, { type: 'user', timestamp: iso(ms), cwd: s.cwd, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: error }] }, ...extra });
const reply = (s, text, ms = Date.now()) => write(s, assistant(s, [{ type: 'text', text }], ms, 900));
const turnEnd = (s, ms = Date.now()) => write(s, { type: 'system', subtype: 'turn_duration', timestamp: iso(ms), durationMs: 60_000 });
function task(s, subject, activeForm, status, ms) {
  const id = use(s, 'TaskCreate', { subject, activeForm, description: subject }, ms);
  const n = String(++taskN);
  result(s, id, { ms, text: `Task #${n} created successfully: ${subject}`, extra: { toolUseResult: { task: { id: n, subject } } } });
  if (status !== 'pending') { const u = use(s, 'TaskUpdate', { taskId: n, status }, ms + 1); result(s, u, { ms: ms + 2 }); }
}

const at = m => NOW - m * MIN;
const C = byId['demo-checkout'];
write(C, prompt(C, 'Make checkout idempotent, then ship it behind a flag.', at(9)));
task(C, 'Validate the cart', 'Validating the cart', 'completed', at(8.6));
task(C, 'Make order creation idempotent', 'Making order creation idempotent', 'completed', at(8.4));
task(C, 'Add the idempotency key to the API', 'Adding the idempotency key', 'in_progress', at(8.2));
task(C, 'Retry the payment webhook', 'Retrying the payment webhook', 'pending', at(8));
task(C, 'Ship it behind a flag', 'Shipping it', 'pending', at(7.9));
result(C, use(C, 'Read', { file_path: join(API, 'docs/plan.md') }, at(7.5)), { ms: at(7.4) });
result(C, use(C, 'Write', { file_path: join(API, 'docs/plan.md'), content: '# Checkout plan' }, at(7)), { ms: at(6.9) });
result(C, use(C, 'Edit', { file_path: join(API, 'src/checkout.ts'), old_string: 'a', new_string: 'b' }, at(6)), { ms: at(5.9) });
use(C, 'Agent', { subagent_type: 'Explore', description: 'Find every caller of createOrder', prompt: 'Find callers' }, at(3));
use(C, 'Agent', { subagent_type: 'general-purpose', description: 'Review the idempotency change', prompt: 'Review' }, at(2.5));
result(C, use(C, 'Agent', { subagent_type: 'general-purpose', description: 'Write the migration', prompt: 'x' }, at(5)), { ms: at(4) });
result(C, use(C, 'Agent', { subagent_type: 'general-purpose', description: 'Check the webhook retries', prompt: 'x' }, at(4.5)), { ms: at(3.8) });
C.open = use(C, 'Bash', { command: 'npm test -- checkout', description: 'Run the checkout tests' }, at(0.2));

const W = byId['demo-cart'];
write(W, prompt(W, 'Build the new cart drawer.', at(12)));
result(W, use(W, 'Read', { file_path: join(WEB, 'src/cart.tsx') }, at(11)), { ms: at(10.9) });
W.open = use(W, 'Edit', { file_path: join(WEB, 'src/drawer.tsx'), old_string: '', new_string: 'x' }, at(0.1));

const F = byId['demo-flow'];
write(F, prompt(F, 'Prototype the one-page checkout in this worktree.', at(6)));
F.open = use(F, 'Write', { file_path: join(WORKTREE, 'src/onepage.ts'), content: 'x' }, at(0.3));

const D = byId['demo-docs'];
write(D, prompt(D, 'Publish the new getting-started guide.', at(20)));
result(D, use(D, 'Bash', { command: './deploy.sh --prod', description: 'Deploy the docs site' }, at(15)), { ms: at(14) });
reply(D, 'The guide is live. Now checking the Actions docs for the cache step.', at(13));
D.open = use(D, 'WebFetch', { url: 'https://docs.github.com/en/actions/using-workflows/caching-dependencies', prompt: 'How do I cache?' }, at(0.2));

const I = byId['demo-ios'];
write(I, prompt(I, 'Why did the TestFlight deploy fail? Plan a fix.', at(18)));
result(I, use(I, 'Bash', { command: './deploy.sh testflight', description: 'Deploy to TestFlight' }, at(16)), { error: true, ms: at(15), text: 'error: signing certificate expired' });
write(I, { type: 'permission-mode', permissionMode: 'plan', sessionId: I.id });
I.open = use(I, 'Bash', { command: 'xcodebuild -scheme Shop build', description: 'Build the app' }, at(0.4));

const O = byId['demo-ops'];
write(O, prompt(O, 'Spin up the staging stack and file the follow-ups.', at(14)));
result(O, use(O, 'Bash', { command: 'npm run dev', run_in_background: true, description: 'Start the staging server' }, at(10)), { ms: at(9.9), text: 'Command running in background' });
write(O, { type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: O.id });
O.open = use(O, 'mcp__claude_ai_Linear__list_issues', { team: 'Infra' }, at(0.2));

const M = byId['demo-metrics'];
write(M, prompt(M, 'Chart the checkout funnel for last week.', at(25)));
result(M, use(M, 'Read', { file_path: join(ANALYTICS, 'notebooks/funnel.py') }, at(20)), { ms: at(19.9) });
M.open = use(M, 'Skill', { skill: 'data:create-viz' }, at(0.3));

const QUESTION = { question: 'Which database should the checkout write orders to?', header: 'Database', multiSelect: false, options: [{ label: 'Postgres', description: 'The main cluster' }, { label: 'SQLite', description: 'A local file, for now' }] };
const Q = byId['demo-orders'];
write(Q, prompt(Q, 'Add an orders table for the checkout.', at(7)));
result(Q, use(Q, 'Read', { file_path: join(API, 'src/orders.ts') }, at(6)), { ms: at(5.9) });
Q.ask = use(Q, 'AskUserQuestion', { questions: [QUESTION] }, at(1));

const P = byId['demo-deploy'];
write(P, prompt(P, 'Roll the webhook fix out to production.', at(5)));
P.ask = use(P, 'Bash', { command: 'ssh prod ./deploy.sh --webhooks', description: 'Deploy the webhook fix to production' }, at(0.8));

const K = byId['demo-cache'];
write(K, prompt(K, 'Plan a cache for the product pages.', at(6)));
write(K, { type: 'permission-mode', permissionMode: 'plan', sessionId: K.id });
use(K, 'ExitPlanMode', { plan: '1. Cache product pages for 60 s\n2. Purge on price change' }, at(0.6));

const N = byId['demo-notes'];
write(N, prompt(N, 'Draft the release notes for 2.4.', at(9)));
result(N, use(N, 'Write', { file_path: join(DOCS, 'releases/2.4.md'), content: '# 2.4' }, at(8)), { ms: at(7.9) });
reply(N, 'The 2.4 release notes are drafted: one-page checkout, the new cart drawer and faster search. Shall I publish them?', at(2));
turnEnd(N, at(2));

const L = byId['demo-ci'];
write(L, prompt(L, '/loop watch the nightly build', at(3)));
result(L, use(L, 'Bash', { command: 'gh run list --limit 1' }, at(2.8)), { ms: at(2.7) });
result(L, use(L, 'ScheduleWakeup', { delaySeconds: 1080, reason: 'the nightly build', prompt: '/loop watch the nightly build' }, at(2.5)), { ms: at(2.5) });
reply(L, 'Still running; I will look again in 18 minutes.', at(2.4));
turnEnd(L, at(2.4));

const X = byId['demo-spike'];
write(X, prompt(X, 'Try a recommendations model.', NOW - 52 * 60 * MIN));
reply(X, 'A first model is in notebooks/recs.py.', NOW - 51.9 * 60 * MIN);
turnEnd(X, NOW - 51.9 * 60 * MIN);
utimesSync(X.file, new Date(NOW - 51 * 3_600_000), new Date(NOW - 51 * 3_600_000));
mkdirSync(join(dirname(C.file), 'memory'), { recursive: true });
writeFileSync(join(dirname(C.file), 'memory', 'MEMORY.md'), '- [Checkout](checkout.md): idempotent orders, behind the checkout_v2 flag\n');
for (const s of SESSIONS) writeFileSync(join(claudeDir, 'sessions', `${s.pid}.json`), JSON.stringify({ pid: s.pid, sessionId: s.id, cwd: s.cwd, name: s.name, kind: 'interactive', status: s.open ? 'busy' : 'idle', startedAt: NOW - 30 * MIN }));

/* ---------- the stand-ins: processes, GitHub, and each session's mod ---------- */

const CODEX_PID = 4_000_001;
function readProcs() {
  const procs = new Map();
  for (const s of SESSIONS) {
    const jitter = s.cpu ? Math.round((Math.random() - 0.5) * s.cpu * 0.4) : 0;
    procs.set(s.pid, { pid: s.pid, ppid: 1, cpu: Math.max(0, s.cpu + jitter), rssKb: s.mb * 1024, command: s.command ?? 'claude' });
  }
  procs.set(4_000_002, { pid: 4_000_002, ppid: C.pid, cpu: 18, rssKb: 210 * 1024, command: 'node --test tests/checkout.test.ts' });
  procs.set(CODEX_PID, { pid: CODEX_PID, ppid: 1, cpu: 3, rssKb: 260 * 1024, command: '/Applications/Visual Studio Code.app/extensions/openai.chatgpt/bin/codex app-server' });
  return Promise.resolve(procs);
}
const PRS = {
  'demo/shop-api': { open: [{ number: 41, title: 'Checkout: idempotent order creation', checks: 'ok', branch: 'idempotency' }, { number: 43, title: 'Rate-limit the payment webhook', checks: 'running' }], merged: [] },
  'demo/shop-web': { open: [{ number: 17, title: 'The new cart drawer', checks: 'failed' }, { number: 18, title: 'Dark mode for checkout', draft: true, checks: null }], merged: [] },
};
const SLUGS = { [API]: 'demo/shop-api', [WEB]: 'demo/shop-web' };

const temp = mkdtempSync(join(tmpdir(), 'agentville-demo-'));
const root = join(temp, 'root');
cpSync(join(ROOT, 'web'), join(root, 'web'), { recursive: true });
const fakeClaude = join(temp, 'claude');
writeFileSync(fakeClaude, "#!/bin/sh\necho '[]'\n", { mode: 0o755 });
writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: { [ANALYTICS]: 'demo/analytics' }, pollMs: 400, gitPollMs: 3000, deployPollMs: 4000, prPollMs: 4000, permissionGuessSec: 3600, terminal: 'iTerm' }));
const state = join(root, 'state');
for (const d of ['pending', 'answers', 'mods']) mkdirSync(join(state, d), { recursive: true });
// Each session's mod: it says it is listening, with its cost, the plan's limits and its working line.
const PLAN = [{ kind: 'five_hour', percentUsed: 38, resetsAt: iso(NOW + 2.2 * 3_600_000) }, { kind: 'seven_day', percentUsed: 57, resetsAt: iso(NOW + 3 * 86_400_000) }];
const offers = { [Q.ask]: { kind: 'question', toolUseId: Q.ask, sessionId: Q.id, createdAt: at(1), questions: [QUESTION] }, [P.ask]: { kind: 'permission', toolUseId: P.ask, sessionId: P.id, tool: 'Bash', summary: 'ssh prod ./deploy.sh --webhooks', createdAt: at(0.8), expiresAt: NOW + 3_600_000 } };
for (const [id, o] of Object.entries(offers)) writeFileSync(join(state, 'pending', `${id}.json`), JSON.stringify(o));
const thinking = new Set(['demo-cart']);
function beacons() {
  for (const s of SESSIONS) {
    if (s.key === 'demo-spike') continue; // long gone
    s.cost += s.open ? 0.004 : 0;
    const working = Boolean(s.open) || thinking.has(s.key);
    writeFileSync(join(state, 'mods', `${s.id}.json`), JSON.stringify({ sessionId: s.id, version: '0.5.1', at: Date.now(), usage: { costUsd: s.cost, contextPercent: Math.round((s.ctx / 200_000) * 100), rateLimits: PLAN }, ...(working ? { turn: { startedAt: s.turnAt, word: s.word ?? 'Working', mode: thinking.has(s.key) ? 'thinking' : 'tool-use' } } : {}), ...(s.effort ? { effort: s.effort } : {}) }));
  }
  for (const id of Object.keys(offers)) { const f = join(state, 'pending', `${id}.json`); if (existsSync(f)) utimesSync(f, new Date(), new Date()); }
}
const REPLIES = {
  'demo-deploy': 'Will do: I will post in #releases once the deploy is live.',
  'demo-checkout': 'Good call: the cart id is the idempotency key now, and plan.md says so.',
  'demo-orders': 'Will do: I will add the migration once the orders table is in.',
};
const ASIDES = {
  'demo-deploy': '**Two commits** go out: the webhook retry with backoff, and a limit of *10 requests a second* per shop.',
  default: '**tests/checkout.test.ts** covers it: one order per cart, a retried request returns the *same* order, and an empty cart is refused.',
};
const inbox = (kind, id) => { const dir = join(state, kind, id); if (!existsSync(dir)) return []; return readdirSync(dir).filter(n => n.endsWith('.json')).map(n => { const f = join(dir, n), v = JSON.parse(readFileSync(f, 'utf8')); unlinkSync(f); return v; }); };
function mods() {
  for (const name of readdirSync(join(state, 'answers'))) { // an answer: the question's result, and the session carries on
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5), a = JSON.parse(readFileSync(join(state, 'answers', name), 'utf8'));
    unlinkSync(join(state, 'answers', name));
    rmSync(join(state, 'pending', name), { force: true });
    delete offers[id];
    if (id === Q.ask) {
      result(Q, Q.ask, { text: `User answered: ${JSON.stringify(a.answers ?? a)}` });
      Q.ask = null; Q.cpu = 24; Q.word = 'Migrating'; Q.effort = 'high'; Q.turnAt = Date.now();
      setTimeout(() => { reply(Q, 'Postgres it is. Writing the migration for the orders table now.'); Q.open = use(Q, 'Write', { file_path: join(API, 'migrations/001_orders.sql'), content: 'create table orders' }); }, 700);
      STEPS['demo-orders'] = [['Bash', { command: 'npm run migrate' }], ['Edit', { file_path: join(API, 'src/orders.ts'), old_string: 'a', new_string: 'b' }]];
    }
    if (id === P.ask && a.decision === 'allow') {
      P.ask = null; P.cpu = 21; P.word = 'Deploying'; P.effort = 'medium'; P.turnAt = Date.now();
      setTimeout(() => { result(P, id, { text: 'Deployed webhooks v2 to production.' }); P.open = use(P, 'Bash', { command: 'curl -fsS https://shop.example.com/health', description: 'Check production health' }); }, 900);
      STEPS['demo-deploy'] = [['Bash', { command: 'gh run watch' }], ['Bash', { command: 'curl -fsS https://shop.example.com/health' }]];
    }
  }
  for (const s of SESSIONS) {
    for (const m of inbox('messages', s.id)) { // a message: your own prompt, then a reply
      write(s, prompt(s, m.text, Date.now(), { origin: { kind: 'plugin', name: 'agent-tracker', asUser: true } }));
      setTimeout(() => { reply(s, REPLIES[s.key] ?? 'Will do.'); }, 1600);
    }
    for (const c of inbox('commands', s.id)) { // a model or effort switch, as /model would say it
      setTimeout(() => {
        const text = c.command === 'model' ? 'Set model to `Sonnet 5.5` and saved as your default for new sessions' : `Set effort level to ${c.args}`;
        if (c.command === 'model') s.model = SONNET; else s.effort = c.args;
        writeFileSync(join(state, 'command-results', `${s.id}.${c.id}.json`), JSON.stringify({ id: c.id, sessionId: s.id, command: c.command, args: c.args, ok: true, text, at: Date.now() }));
      }, 1200);
    }
    for (const q of inbox('btw', s.id)) { // a side question (/btw), answered from the conversation
      setTimeout(() => writeFileSync(join(state, 'asides', `${s.id}.${q.id}.json`), JSON.stringify({ id: q.id, sessionId: s.id, question: q.question, text: ASIDES[s.key] ?? ASIDES.default, at: q.at, answeredAt: Date.now() })), 2600);
    }
  }
}
// The director: working sessions move on to their next step every few seconds.
const STEPS = {
  'demo-checkout': [['Read', { file_path: join(API, 'src/orders.ts') }], ['Edit', { file_path: join(API, 'src/orders.ts'), old_string: 'a', new_string: 'b' }], ['Bash', { command: 'npm test -- checkout' }], ['Grep', { pattern: 'createOrder' }]],
  'demo-cart': [null, ['Edit', { file_path: join(WEB, 'src/cart.tsx'), old_string: 'a', new_string: 'b' }], ['Bash', { command: 'npx eslint src' }]],
  'demo-flow': [['Edit', { file_path: join(WORKTREE, 'src/onepage.ts'), old_string: 'a', new_string: 'b' }], ['Bash', { command: 'npm run build' }]],
  'demo-metrics': [['Bash', { command: 'python notebooks/funnel.py' }], ['Skill', { skill: 'data:create-viz' }]],
};
const stepAt = {};
function direct() {
  for (const [id, steps] of Object.entries(STEPS)) {
    const s = byId[id], i = stepAt[id] = ((stepAt[id] ?? -1) + 1) % steps.length;
    if (s.open) result(s, s.open);
    s.open = null;
    const next = steps[i];
    if (next) { thinking.delete(id); s.open = use(s, ...next); } else thinking.add(id); // between steps: thinking
  }
}

/* ---------- the browser, its cursor and its captions ---------- */

const handle = await startCollector({
  root, claudeDir, claudeBin: fakeClaude, notify: () => {}, log: () => {}, home: DEMO, scratchBase: '/nonexistent',
  readProcs, deployStatusOf: async r => (r === 'demo/analytics' ? { status: 'in_progress', at: Date.now(), workflow: 'Deploy', sha: 'a1b2c3d' } : null),
  githubSlugOf: async top => SLUGS[top] ?? null, pullRequestsOf: async slug => PRS[slug] ?? { open: [], merged: [] },
  sessionProcs: { commandOf: async () => 'claude', ttyOf: async () => 'ttys001', kill: () => {}, alive: () => true },
  launch: async () => ({ code: 0, stdout: '', stderr: '' }),
});
beacons();
const timers = [setInterval(beacons, 900), setInterval(mods, 200)];
const VW = 1440, VH = 900;
const profile = join(temp, 'chrome');
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const frames = join(temp, 'frames');
mkdirSync(frames);
const shot = []; // [file, timestamp]
let ws;
try {
  let port;
  for (let i = 0; i < 80 && !port; i++) { try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(250); } }
  ws = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.screencastFrame') {
      const f = join(frames, `${String(shot.length).padStart(6, '0')}.jpg`);
      writeFileSync(f, Buffer.from(m.params.data, 'base64'));
      shot.push([f, m.params.metadata.timestamp]);
      void send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
    }
    if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const js = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
  const until = async (expr, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(120)) if (await js(expr)) return true; return false; };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${handle.port}/` });
  await sleep(800);
  await js(`(() => { const s = { 'tracker-view': 'farm', 'tracker-farm-tab': 'agent', 'tracker-closed-groups': '["idle","stale"]', 'tracker-theme': 'dark', 'tracker-farm-sky': 'day', 'tracker-farm-zoom': '1', 'tracker-farm-side': 'closed', 'tracker-farm-panel': 'open', 'tracker-farm-bubbles': 'on', 'tracker-bell': 'off', 'tracker-farm-resting': 'shown' }; for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); })()`);
  await send('Page.reload');
  await until("document.querySelectorAll('.px-tag').length >= 10", 15000);
  await sleep(2500); // the repos, deploys and pull requests come in

  // The cursor, the captions and the title cards: popovers, so they stay above any dialog.
  await js(`(() => {
    const st = document.createElement('style');
    st.textContent = \`
      .demo-pop { position: fixed; inset: auto; margin: 0; border: 0; padding: 0; background: none; overflow: visible; }
      #demo-cursor { left: 0; top: 0; width: 30px; height: 30px; transform: translate(${VW / 2}px, ${VH / 2}px); pointer-events: none; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
      #demo-caption { left: 50%; bottom: 58px; transform: translate(-50%, 12px); opacity: 0; transition: opacity .35s, transform .35s; pointer-events: none; display: grid; gap: 4px; justify-items: center; max-width: 900px; padding: 14px 26px 15px; border-radius: 14px; background: rgba(16, 22, 13, .92); border: 1px solid rgba(255, 232, 163, .22); box-shadow: 0 10px 30px rgba(0,0,0,.45); text-align: center; color: #f4ecd8; font: 600 25px/1.25 system-ui, -apple-system, sans-serif; }
      #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
      #demo-caption.top { bottom: auto; top: 92px; }
      #demo-caption span { font: 400 17px/1.4 system-ui, -apple-system, sans-serif; color: #cfd9c4; }
      #demo-card { left: 0; top: 0; width: 100vw; height: 100vh; display: grid; place-content: center; justify-items: center; gap: 18px; background: radial-gradient(circle at 50% 40%, #2f6b2f, #142313 70%); color: #f4ecd8; font: 700 64px/1 system-ui, -apple-system, sans-serif; opacity: 0; transition: opacity .6s; pointer-events: none; }
      #demo-card.on { opacity: 1; }
      #demo-card p { margin: 0; font: 400 24px/1.4 system-ui, sans-serif; color: #d6e3c8; max-width: 760px; text-align: center; }
      #demo-card small { font: 500 18px/1 ui-monospace, Menlo, monospace; color: #ffe8a3; }
      .demo-ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #ffd43b; pointer-events: none; z-index: 2147483647; animation: demo-ripple .55s ease-out forwards; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }\`;
    document.head.appendChild(st);
    const pop = (id, html) => { const el = document.createElement('div'); el.id = id; el.className = 'demo-pop'; el.popover = 'manual'; el.innerHTML = html; document.body.appendChild(el); el.showPopover(); return el; };
    const card = pop('demo-card', '');
    const cap = pop('demo-caption', '<b></b><span></span>');
    const cur = pop('demo-cursor', '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2 L4 20 L9 15.5 L12.5 22.5 L15.5 21 L12 14.2 L18.5 14 Z" fill="#ffffff" stroke="#1b1420" stroke-width="1.6" stroke-linejoin="round"/></svg>');
    window.__demo = {
      move(x, y, ms) { cur.style.transition = 'transform ' + ms + 'ms cubic-bezier(.35,.75,.25,1)'; cur.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)'; },
      ripple(x, y) { const r = document.createElement('i'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); },
      caption(title, sub) { clearTimeout(this.swap); if (!title) { cap.classList.remove('on'); return; } cap.querySelector('b').textContent = title; cap.querySelector('span').textContent = sub || ''; cap.classList.add('on'); },
      // The caption keeps out of the way: at the top while the cursor works low on the screen, at the bottom while it works high.
      avoid(y) {
        const top = y > innerHeight * 0.62 ? true : y < innerHeight * 0.4 ? false : null;
        if (top === null || top === cap.classList.contains('top')) return;
        if (!cap.classList.contains('on')) { cap.classList.toggle('top', top); return; }
        cap.classList.remove('on');
        clearTimeout(this.swap);
        this.swap = setTimeout(() => { cap.classList.toggle('top', top); cap.classList.add('on'); }, 220);
      },
      card(html) { if (html) card.innerHTML = html; card.classList.toggle('on', Boolean(html)); cur.style.opacity = html ? '0' : '1'; },
      raise() { for (const el of [card, cap, cur]) { el.hidePopover(); el.showPopover(); } },
    };
  })()`);

  let cursor = [VW / 2, VH / 2];
  async function moveTo([x, y], ms = 650) {
    await js(`window.__demo.move(${x}, ${y}, ${ms}); window.__demo.avoid(${y})`);
    const [x0, y0] = cursor, steps = 8;
    for (let i = 1; i <= steps; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x - x0) * i) / steps, y: y0 + ((y - y0) * i) / steps }); await sleep(ms / steps); }
    cursor = [x, y];
    await sleep(80);
  }
  const where = async expr => js(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return r.width ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null; })()`);
  const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
  const row = key => q(`#list .row[data-id="${byId[key].id}"]`);
  const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.includes(${JSON.stringify(text)}))`;
  async function point(expr, ms) { const p = await where(expr); if (p) await moveTo(p, ms); else log('not found:', expr); return p; }
  async function click(expr, ms) {
    let p = await point(expr, ms);
    if (!p) return false;
    const now = await where(expr); // a pane may have re-rendered while the cursor moved: aim again
    if (now && Math.hypot(now[0] - p[0], now[1] - p[1]) > 3) { p = now; await moveTo(p, 180); }
    await js(`window.__demo.ripple(${p[0]}, ${p[1]})`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await sleep(250);
    return true;
  }
  async function type(text, perChar = 38) { for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(perChar); } }
  const enter = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) }); };
  const say = (title, sub) => js(`window.__demo.caption(${JSON.stringify(title)}, ${JSON.stringify(sub ?? '')})`);
  const raise = () => js('window.__demo.raise()');
  // A point on the farm (in its world pixels) and a farmer's sprite (just under its name tag), as screen points.
  const farmAt = (x, y) => js(`(() => { const c = document.querySelector('#farm canvas'); const [pl, pt] = c.dataset.pad.split(',').map(Number), r = c.getBoundingClientRect(), cs = r.width / Number(c.dataset.ew); return [Math.round(r.left + (${x} + pl) * cs), Math.round(r.top + (${y} + pt) * cs)]; })()`);
  // A farmer, by its name tag: hovering shows the name, and a click picks exactly that farmer (they stand close on the porch).
  const tag = key => `document.querySelector('[data-farmer="${byId[key].id}"]')`;
  const farmer = key => where(tag(key));
  const spot = p => p && `({ getBoundingClientRect: () => ({ left: ${p[0]}, top: ${p[1]}, width: 2, height: 2 }), scrollIntoView() {} })`;
  const hold = sleep;

  await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
  const tick = setInterval(direct, 5200);
  timers.push(tick);
  const logo = await js("window.Agentville.svg({ size: 132 })");

  // ----- title -----
  await js(`window.__demo.card(${JSON.stringify(`${logo}<div>Agentville</div><p>A live dashboard for every AI coding agent on your Mac</p>`)})`);
  await hold(3400);
  await js('window.__demo.card(null)');
  await hold(700);
  const dlgOpen = "document.querySelector('.px-dlg')?.open";
  async function building(x, y, title, sub, ms = 2600) {
    await say(title, sub);
    await click(spot(await farmAt(x, y)), 750);
    await until(dlgOpen, 3000); await raise(); await hold(ms);
    await click(q('[data-farm-dlg-close]'), 500);
    if (!(await until(`!${dlgOpen}`, 1500))) await js("document.querySelector('.px-dlg').close()");
  }
  const pickFarmer = async key => { await click(tag(key), 750); await until(`document.querySelector('#farm-agent .fs-head .name')?.textContent === ${JSON.stringify(byId[key].name)}`, 3000); await hold(400); };

  // ----- 1. the farm -----
  await say('Every agent on your Mac, as a farm', 'Claude Code sessions with their subagents and background jobs, and Codex: every agent is a farmer, every repo a field');
  await moveTo([VW * 0.55, VH * 0.45], 900); await hold(3200);
  await say('The panel: what needs you', 'Counts by state, your agents’ memory and CPU, and your plan’s limits. Click a count to find its farmer');
  await point(q('[data-farm-state="waiting"]'), 700); await hold(1200);
  await point(q('.px-gauges'), 600); await hold(1800);
  await say('Agents that need you come to your porch', 'A red ! for a question or a permission, a scroll for a plan to approve, a basket when it’s your turn');
  await point(spot(await farmer('demo-deploy')), 800); await hold(1500);
  await point(spot(await farmer('demo-cache')), 600); await hold(1300);
  await point(spot(await farmer('demo-notes')), 600); await hold(1500);
  await say('Every repo is a field', 'The tool in hand is its current step, the board its task list; crops grow as its context fills');
  await point(spot(await farmer('demo-checkout')), 800); await hold(2800);
  await say('The weather is the last deploy', 'A rainbow when it passed, rain when it failed, a windmill while it runs');
  await point(q('[data-farm-field$="docs"]'), 800); await hold(1500);
  await point(q('[data-farm-field$="mobile"]'), 700); await hold(1500);
  await point(q('[data-farm-field$="analytics"]'), 700); await hold(1500);
  await say('Click a field: who touched what', 'Every file agents read or wrote in that repo, and the ones two of them wrote');
  await click(q('[data-farm-field$="shop/api"]'), 700);
  await until("!!document.querySelector('[data-fv-close]')?.offsetParent", 3000); await raise(); await hold(3000);
  await click(q('[data-fv-close]'), 500); await hold(500);
  await say('A compaction is a harvest', 'The field starts again from seed');
  write(C, { type: 'system', subtype: 'compact_boundary', timestamp: iso(Date.now()), compactMetadata: { trigger: 'auto', preTokens: 168_000 } });
  C.ctx = 18_000;
  reply(C, 'Picking up from the summary: the idempotency key is next.');
  await point(spot(await farmer('demo-checkout')), 600); await hold(3000);
  await say('Agents talking to each other', 'A pigeon carries the note, and both conversations show it (⌘ + scroll zooms in)');
  const [ca, cb] = [await farmer('demo-cart'), await farmer('demo-checkout')];
  if (ca && cb) { // zoom in between the two, so the pigeon shows
    const at = [Math.round((ca[0] + cb[0]) / 2), Math.round((ca[1] + cb[1]) / 2) - 30];
    await moveTo(at, 700);
    for (let i = 0; i < 3; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at[0], y: at[1], deltaX: 0, deltaY: -120, modifiers: 4 }); await sleep(420); }
    await hold(700);
  }
  use(W, 'SendMessage', { to: 'checkout-api', summary: 'Cart calls POST /orders', message: 'The cart drawer now calls POST /orders with an idempotency key. Is the endpoint ready?' });
  await hold(4200);
  await say('Drag to look around', 'Zoomed in, the minimap shows where you are');
  const mid = [VW * 0.5, VH * 0.45];
  await moveTo(mid, 500);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mid[0], y: mid[1], button: 'left', clickCount: 1 });
  for (let i = 1; i <= 16; i++) { const p = [mid[0] + i * 12, mid[1] + i * 7]; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1 }); await js(`window.__demo.move(${p[0]}, ${p[1]}, 40)`); await sleep(45); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mid[0] + 192, y: mid[1] + 112, button: 'left', clickCount: 1 });
  cursor = [mid[0] + 192, mid[1] + 112];
  await point(q('.px-mini'), 600); await hold(1500);
  await click(q('[data-farm-zoom="0"]'), 700); await hold(900);
  await say('Web and MCP calls drive carts to town', 'A pump is a background job; a hammock, a session that wakes itself up (/loop)');
  await point(q('.px-mover'), 700); await hold(1500);
  await point(spot(await farmAt(97, 198)), 800); await hold(1800);
  await building(102, 40, 'The silo: your plan', 'How much of each limit is used, and when it resets');
  await building(298, 70, 'The market stall: pull requests', 'Each repo’s open pull requests, with their checks');
  await building(24, 112, 'The henhouse: subagents', 'Every subagent, whose it is and how it is going');
  await building(119, 70, 'The notice board: what your projects remember', 'CLAUDE.md and each project’s memory, a click away');
  await say('The barn starts a new session', 'Or resumes one: in the folder, mode, model and effort you pick');
  await click(spot(await farmAt(60, 50)), 750);
  if (!(await until("document.getElementById('sessions').open", 2000))) await click(spot(await farmAt(60, 50)), 200);
  await until("document.getElementById('sessions').open", 3000); await raise(); await hold(2600);
  await click(q('#sessions [data-sess-close]'), 600); await hold(400);
  await say('Day and night follow your clock', 'Lit windows, lanterns and fireflies after dark');
  await click(q('[data-farm-sky]'), 700); await hold(3400);
  await click(q('[data-farm-sky]'), 400); await hold(250); await click(q('[data-farm-sky]'), 300); await hold(600);
  await say('Ring the bell', 'A chime, and a desktop notice, when an agent starts waiting on you');
  await click(q('[data-farm-bell]'), 700); await hold(2000);
  await say('Every symbol, explained', 'Help is a legend for the whole farm');
  await click(q('[data-farm-help]'), 600);
  await until("document.querySelector('.px-help')?.open", 3000); await raise(); await hold(2800);
  await click(q('[data-farm-help-close]'), 500); await hold(400);

  // ----- 2. the farm's sidebar -----
  await say('Click a farmer: its sidebar opens', 'What it is doing, its working line, model and effort, a message box and its conversation');
  await pickFarmer('demo-checkout');
  await point(q('#farm-agent .workline'), 700); await hold(1400);
  await point(q('#farm-agent .sessbar'), 600); await hold(1400);
  await say('Follow it', 'The view zooms in and keeps it in the middle as it walks');
  await click(q('[data-farm-follow]'), 700); await hold(3200);
  await click(q('[data-farm-follow]'), 500); await click(q('[data-farm-zoom="0"]'), 500); await hold(600);
  await say('Answer its question', 'With the same options as in its terminal');
  await pickFarmer('demo-orders');
  await click(`${q('#farm-agent input[value="Postgres"]')}?.closest('label')`, 700); await hold(400);
  await click(q('#ask-send'), 600);
  await until(`document.querySelector('[data-farmer="${Q.id}"]')?.className.includes('st-working')`, 6000);
  await say('Answered: off it goes', 'The session carries on, as if you had answered in its terminal'); await hold(2200);
  await say('Allow or deny a command', 'A permission it asks for, answered from the farm');
  await pickFarmer('demo-deploy');
  await point(q('#farm-agent .ask'), 600); await hold(1200);
  await click(q('#ask-allow'), 600);
  await until(`document.querySelector('[data-farmer="${P.id}"]')?.className.includes('st-working')`, 6000); await hold(1600);
  await say('Message it', 'It arrives as your own prompt, even mid-task. Paste or drop screenshots, PDFs or notes too');
  await click(q('#msg-text'), 600);
  await type('Post in #releases when it is live.');
  await hold(300); await enter(); await hold(2800);
  await say('Ask a side question (/btw)', 'Answered from its conversation, without interrupting it or adding to it');
  await click(q('#aside-text'), 600);
  await type('What goes out in this deploy?');
  await hold(300); await enter();
  await until("!!document.querySelector('#farm-agent .aside .aside-a.md')", 8000);
  await point(q('#farm-agent .aside'), 600); await hold(2400);
  await say('Fold the side questions away', 'Their heading shows or hides them, for every session');
  await click(q('#farm-agent [data-group="btw"]'), 600); await hold(1600);
  await click(q('#farm-agent [data-group="btw"]'), 600); await hold(1200);
  await say('Switch its effort or model', 'It runs /effort or /model in the session itself, after its current turn');
  await point(q('#farm-agent [data-switch-effort]'), 600);
  await js(`(() => { const s = document.querySelector('#farm-agent [data-switch-effort]'); s.value = 'high'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1500);
  await click(q('#confirm-yes'), 600);
  await until("!!document.querySelector('#farm-agent .set-note')", 6000); await point(q('#farm-agent .set-note'), 500); await hold(1800);
  await say('Its activity', 'Every step, how long it took, and whether it worked');
  await click(q('#tab-activity'), 600); await hold(2600);
  await say('The diary', 'What happened on the farm: answers, messages, harvests and deploys');
  await click(q('#tab-diary'), 600); await hold(2800);
  await say('Its files', 'Its folder, with what it read and wrote; open one to read it');
  await pickFarmer('demo-checkout');
  await click(q('#tab-files'), 600); await hold(1400);
  await click(byText('#tree button.tn.file', 'plan.md'), 700);

  // ----- 3. the list view -----
  await until("!!document.getElementById('reader-body')?.textContent.includes('idempotent')", 6000);
  await say('The list view: read what it wrote', 'Select a passage, quote it, and reply: it goes to the agent about that document');
  const line = await where(byText('#reader-body li, #reader-body p, #reader-body .l', 'idempotent'));
  const ends = await js(`(() => { const e = ${byText('#reader-body li, #reader-body p, #reader-body .l', 'idempotent')}; const r = document.createRange(); r.selectNodeContents(e); const b = [...r.getClientRects()]; const a = b[0], z = b.at(-1); return a ? [[Math.round(a.left + 2), Math.round(a.top + a.height / 2)], [Math.round(z.right - 2), Math.round(z.top + z.height / 2)]] : null; })()`);
  if (line && ends) { // select it with the mouse, as you would
    await moveTo(ends[0], 700);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ends[0][0], y: ends[0][1], button: 'left', clickCount: 1 });
    for (let i = 1; i <= 12; i++) { const p = [ends[0][0] + ((ends[1][0] - ends[0][0]) * i) / 12, ends[0][1] + ((ends[1][1] - ends[0][1]) * i) / 12]; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1 }); await js(`window.__demo.move(${p[0]}, ${p[1]}, 50)`); await sleep(55); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ends[1][0], y: ends[1][1], button: 'left', clickCount: 1 });
    cursor = ends[1];
  }
  await hold(500);
  await click(q('#reader-quote'), 600); await hold(500);
  await type('Use the cart id as the key.');
  await hold(400);
  await click(q('#reader-send'), 600); await hold(2200);
  await click(q('#center-tabs [data-tab=""]'), 600); await hold(600);
  await say('Every agent, sorted by what needs you', 'Waiting on you, working, your turn; idle and stale fold away');
  await point(q('#list .row'), 700); await hold(900);
  await click(q('#list [data-group="idle"]'), 700); await hold(1600);
  await click(q('#list [data-group="idle"]'), 500); await hold(500);
  await say('The counts, and your Mac', 'Your agents’ memory and CPU, and your plan, up top');
  await point(q('#kpis .kpi'), 600); await hold(1000);
  await point(q('#hstats'), 700); await hold(1800);
  await say('Collisions', 'Two agents writing to one repo, flagged before they trip over each other');
  await point(q('#kpis .kpi.k-collide'), 600); await hold(1000);
  await point(q('#rail .card.collide'), 700); await hold(2000);
  await say('Everything about one session', 'Its working line, tasks, model, effort, context and cost, with CPU and memory over time');
  await click(row('demo-checkout'), 600); await hold(600);
  await point(q('#center-body .workline'), 600); await hold(1200);
  await point(q('#center-body .metrics'), 600); await hold(1200);
  await point(byText('#center-body .sec', 'Last 10 minutes'), 700); await hold(1600);
  await point(byText('#center-body .sec', 'Subagents'), 700); await hold(1600);
  await say('Its whole history', 'Show all loads every step; Full transcript opens the conversation');
  await click(q('#center-body [data-full-feed]'), 700); await hold(2200);
  await say('Switch its model', 'Or its effort, from the session bar');
  await point(q('#center-body .sessbar'), 600);
  await js(`(() => { const s = document.querySelector('#center-body [data-switch-model]'); s.value = 'sonnet'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1500);
  await click(q('#confirm-yes'), 600);
  await until("!!document.querySelector('#center-body .set-note')", 6000); await point(q('#center-body .set-note'), 500); await hold(1600);
  await say('Restart it in another mode, or end it', 'Restart in… resumes it in plan, accept-edits or bypass mode; End session asks first');
  await point(q('#center-body [data-restart-mode]'), 600); await hold(900);
  await click(q('#center-body [data-end-session]'), 600);
  await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1800);
  await click(q('#confirm-no'), 500); await hold(400);
  await say('Its folder and memory', 'Filter its files, see which ones it touched, open its CLAUDE.md and memory');
  await click(q('#ex-filter'), 600);
  await type('orders', 70); await hold(1400);
  await js(`(() => { const f = document.getElementById('ex-filter'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(byText('#tree [data-mem]', 'MEMORY.md'), 700); await hold(2400);
  await click(q('#center-tabs [data-tab=""]'), 500); await hold(400);
  await say('Start or resume a session', 'In a folder, with the permission mode, model and effort you pick, in a new terminal window');
  await click(q('#sessions-open'), 700);
  await until("document.getElementById('sessions').open", 3000); await raise(); await hold(2600);
  await click(q('#sessions [data-sess-close]'), 600); await hold(400);
  await say('Dark, light, or as macOS is', null);
  await click(q('#theme-toggle'), 600); await hold(300); await click(q('#theme-toggle'), 300); await hold(2200);
  await click(q('#theme-toggle'), 500); await hold(900);
  await say('Or back to the farm', 'The same live data, either way');
  await click(q('#view-farm'), 700); await hold(2600);
  await say(null);
  await moveTo([VW - 40, VH - 40], 600);

  // ----- the end -----
  await js(`window.__demo.card(${JSON.stringify(`${logo}<div>Agentville</div><p>Free and open source. Everything stays on your Mac.</p><small>github.com/hamsathul/agentville</small>`)})`);
  await hold(4200);
  await send('Page.stopScreencast');
  await sleep(300);
} finally {
  for (const t of timers) clearInterval(t);
  try { ws?.close(); } catch { /* gone */ }
  chrome.kill();
  for (const p of sleepers) p.kill();
  await handle.stop();
}

/* ---------- frames to video ---------- */

if (shot.length < 10) { console.error(`only ${shot.length} frames: nothing to make`); process.exit(1); }
const list = [];
for (let i = 0; i < shot.length; i++) {
  const [file, t] = shot[i], next = shot[i + 1]?.[1] ?? t + 0.5;
  list.push(`file '${file}'`, `duration ${Math.max(0.001, next - t).toFixed(4)}`);
}
list.push(`file '${shot.at(-1)[0]}'`);
writeFileSync(join(temp, 'frames.txt'), `${list.join('\n')}\n`);
log(`${shot.length} frames over ${(shot.at(-1)[1] - shot[0][1]).toFixed(1)} s; encoding…`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(temp, 'frames.txt'), '-vf', 'fps=30,scale=1920:-2:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
rmSync(temp, { recursive: true, force: true });
rmSync(DEMO, { recursive: true, force: true });
log(`made ${OUT}`);
