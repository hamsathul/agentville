#!/usr/bin/env node
// Records a demo video of Agentville, with made-up sessions only. A collector runs on a demo
// ~/.claude (fourteen sessions in six demo repos, with stand-ins for their mods, their processes
// and GitHub), a director keeps the sessions busy, and headless Chrome tours the features with a
// cursor and captions, following docs/demo-script.md: the farm, answering and messaging from it, an
// agent's work, its files, the list view, sessions, Claude Code's own setup, notifications. Frames
// come from Chrome's screencast; ffmpeg makes the MP4 (about 8 minutes), a copy small enough to upload
// to GitHub (out-small.mp4, under 10 MB), and a short video for each chapter in a folder beside it
// (out-chapters/01-the-farm.mp4 and so on).
//
//   node scripts/demo-video.mjs [out.mp4]      (needs Chrome and ffmpeg)
//   STILLS=docs node scripts/demo-video.mjs    also saves farm.png and farm-night.png there (no caption or
//                                              cursor), for the README; with STILLS_ONLY=1 it stops after them
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { startCollector } from '../collector/collector.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? 'agentville-demo.mp4');
const CHROME = process.env.CHROME ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => existsSync(p));
if (!CHROME) { console.error('Chrome not found: set CHROME to its path.'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STILLS = process.env.STILLS ? resolve(process.env.STILLS) : null;
const STILLS_DONE = new Error('the stills are taken');
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

// Files of every kind the reader shows, in the shop API: the checkout page (with its CSS and script),
// a walkthrough video, the brief (Word) and the forecast (Excel). The release notes (PDF) and the
// screenshots are made by Chrome once it is up.
const DESIGN = join(API, 'design');
put(join(DESIGN, 'checkout', 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>Checkout</title><link rel="stylesheet" href="style.css"></head>
<body><main class="card"><h1>Checkout</h1>
<ul class="items"><li><span>Trail runner, size 42</span><b>$129.00</b></li><li><span>Merino socks, two pairs</span><b>$24.00</b></li></ul>
<label class="opt"><input type="checkbox" id="gift"> Gift wrap (+$5.00)</label>
<div class="total"><span>Total</span><b id="total">$153.00</b></div>
<button id="pay">Pay $153.00</button>
<p class="note">One cart, one order: paying twice charges once.</p></main>
<script src="app.js"></script></body></html>
`);
put(join(DESIGN, 'checkout', 'style.css'), `body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(160deg, #eef4ff, #f8efe6); font: 16px/1.5 system-ui, sans-serif; color: #1d2433; }
.card { width: 380px; padding: 28px 30px; border-radius: 18px; background: #fff; box-shadow: 0 18px 40px rgba(29, 36, 51, .12); }
h1 { margin: 0 0 14px; font-size: 26px; }
.items { list-style: none; margin: 0; padding: 0; }
.items li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #edf0f5; }
.opt { display: flex; gap: 8px; align-items: center; margin: 14px 0 6px; color: #4b5568; }
.total { display: flex; justify-content: space-between; margin: 10px 0 18px; font-size: 20px; }
#pay { width: 100%; padding: 13px; border: 0; border-radius: 12px; background: #2a78d6; color: #fff; font: 600 17px system-ui, sans-serif; }
.note { margin: 12px 0 0; color: #7a8394; font-size: 13px; text-align: center; }
`);
put(join(DESIGN, 'checkout', 'app.js'), `const gift = document.getElementById('gift');
gift.addEventListener('change', () => {
  const total = (153 + (gift.checked ? 5 : 0)).toFixed(2);
  document.getElementById('total').textContent = '$' + total;
  document.getElementById('pay').textContent = 'Pay $' + total;
});
`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '8', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', join(DESIGN, 'walkthrough.mp4')]);
put(join(DEMO, 'brief.html'), '<h1>Checkout v2</h1><p><b>Goal:</b> one cart makes one order, however often the customer presses Pay.</p><h2>What changes</h2><ul><li>The cart id becomes the idempotency key.</li><li>The payment webhook retries with backoff.</li><li>Everything ships behind the <i>checkout_v2</i> flag.</li></ul><h2>Owners</h2><p>checkout-api owns the API, cart-ui owns the cart drawer, and deploy-bot owns the deploy.</p>');
execFileSync('textutil', ['-convert', 'docx', '-output', join(API, 'docs', 'brief.docx'), join(DEMO, 'brief.html')]);
rmSync(join(DEMO, 'brief.html'));
/** A zip of stored entries: enough for the reader's own xlsx reader. */
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), n = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const cellOf = (v, r, c) => (typeof v === 'number' ? `<c r="${String.fromCharCode(65 + c)}${r}"><v>${v}</v></c>` : `<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"><is><t>${v}</t></is></c>`);
const sheetXml = rows => `<worksheet><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((v, c) => cellOf(v, i + 1, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
writeFileSync(join(API, 'docs', 'forecast.xlsx'), zip({
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Orders by day" sheetId="1" r:id="rId1"/><sheet name="Refunds" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': sheetXml([['Day', 'Orders', 'Revenue', 'Double charges'], ['Monday', 412, 18_240, 3], ['Tuesday', 455, 20_115, 2], ['Wednesday', 498, 22_310, 4], ['Thursday', 521, 23_480, 0], ['Friday', 610, 27_900, 0], ['Saturday', 702, 31_655, 0], ['Sunday', 588, 26_020, 0]]),
  'xl/worksheets/sheet2.xml': sheetXml([['Reason', 'Count'], ['Charged twice', 9], ['Wrong size', 31], ['Arrived late', 12]]),
}));

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
// Where Claude Code keeps each session's scratchpad and background output: <base>/<project>/<session>/.
const SCRATCH = join(DEMO, 'tmp');
const scratchOf = s => join(SCRATCH, s.cwd.replace(/[^A-Za-z0-9]/g, '-'), s.id);
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
/** A call the session is in the middle of: a shell command runs as a process of its own (see readProcs). */
function begin(s, name, input, ms = Date.now()) {
  s.open = use(s, name, input, ms);
  s.openBash = name === 'Bash' && !input.run_in_background ? { pid: 4_000_100 + 2 * callN, command: input.command, startedAt: ms } : null;
  return s.open;
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
mkdirSync(join(scratchOf(C), 'scratchpad'), { recursive: true });
mkdirSync(join(scratchOf(C), 'tasks'), { recursive: true });
const DEV_OUT = join(scratchOf(C), 'tasks', 'b7k2dev.output');
writeFileSync(DEV_OUT, '> shop-api@2.4.0 dev\n> next dev --port 3000\n\n  ▲ Next.js 15.2.0\n  - Local:   http://localhost:3000\n\n ✓ Ready in 1.8s\n ○ Compiling /checkout ...\n ✓ Compiled /checkout in 912ms\n GET /checkout 200 in 1043ms\n POST /api/orders 201 in 88ms\n');
const SHOT = join(scratchOf(C), 'scratchpad', 'checkout-page.png'); // the screenshot it is asked for
write(C, prompt(C, 'Make checkout idempotent, then ship it behind a flag.', at(9)));
const DEV = { id: use(C, 'Bash', { command: 'npm run dev', description: 'Start the dev server', run_in_background: true }, at(8.8)), pid: 4_000_010, startedAt: at(8.8), stopped: false };
result(C, DEV.id, { ms: at(8.79), text: `Command running in background with ID: b7k2dev. Output is being written to: ${DEV_OUT}` });
task(C, 'Validate the cart', 'Validating the cart', 'completed', at(8.6));
task(C, 'Make order creation idempotent', 'Making order creation idempotent', 'completed', at(8.4));
task(C, 'Add the idempotency key to the API', 'Adding the idempotency key', 'in_progress', at(8.2));
task(C, 'Retry the payment webhook', 'Retrying the payment webhook', 'pending', at(8));
task(C, 'Ship it behind a flag', 'Shipping it', 'pending', at(7.9));
result(C, use(C, 'Read', { file_path: join(API, 'docs/plan.md') }, at(7.5)), { ms: at(7.4) });
result(C, use(C, 'Write', { file_path: join(API, 'docs/plan.md'), content: '# Checkout plan' }, at(7)), { ms: at(6.9) });
reply(C, 'The payment webhook has no retry yet. I will add one with backoff once the idempotency key is in.', at(6.6));
result(C, use(C, 'Edit', { file_path: join(API, 'src/checkout.ts'), old_string: 'a', new_string: 'b' }, at(6)), { ms: at(5.9) });
reply(C, 'Each retry sends the same idempotency key, so a retry can never make a second order.', at(5.6));
reply(C, 'The retry stops after 5 attempts. After that the order is flagged for a person to look at.', at(4.3));
const EXPLORE = use(C, 'Agent', { subagent_type: 'Explore', description: 'Find every caller of createOrder', prompt: 'Find every caller of createOrder in src/ and tests/, and say which ones retry.' }, at(3));
// The subagent's own transcript, where Claude Code keeps it: <session>/subagents/agent-<id>.jsonl, and its .meta.json.
const subDir = join(dirname(C.file), C.id, 'subagents');
mkdirSync(subDir, { recursive: true });
writeFileSync(join(subDir, 'agent-a1.meta.json'), JSON.stringify({ toolUseId: EXPLORE, agentType: 'Explore' }));
writeFileSync(join(subDir, 'agent-a1.jsonl'), `${[
  { type: 'user', timestamp: iso(at(3)), cwd: API, message: { role: 'user', content: 'Find every caller of createOrder in src/ and tests/, and say which ones retry.' } },
  { type: 'assistant', timestamp: iso(at(2.9)), cwd: API, message: { model: HAIKU, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_s1', name: 'Grep', input: { pattern: 'createOrder', path: join(API, 'src') } }] } },
  { type: 'user', timestamp: iso(at(2.8)), cwd: API, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_s1', content: 'src/checkout.ts\nsrc/orders.ts\nsrc/webhooks.ts' }] } },
  { type: 'assistant', timestamp: iso(at(2)), cwd: API, message: { model: HAIKU, role: 'assistant', content: [{ type: 'text', text: 'Three callers so far: checkout.ts, orders.ts and the payment webhook. Only the webhook retries.' }] } },
  { type: 'assistant', timestamp: iso(at(0.3)), cwd: API, message: { model: HAIKU, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_s2', name: 'Read', input: { file_path: join(API, 'tests/checkout.test.ts') } }] } },
].map(e => JSON.stringify(e)).join('\n')}\n`);
use(C, 'Agent', { subagent_type: 'general-purpose', description: 'Review the idempotency change', prompt: 'Review' }, at(2.5));
result(C, use(C, 'Agent', { subagent_type: 'general-purpose', description: 'Write the migration', prompt: 'x' }, at(5)), { ms: at(4) });
result(C, use(C, 'Agent', { subagent_type: 'general-purpose', description: 'Check the webhook retries', prompt: 'x' }, at(4.5)), { ms: at(3.8) });
begin(C, 'Bash', { command: 'npm test -- checkout', description: 'Run the checkout tests' }, at(0.2));

const W = byId['demo-cart'];
write(W, prompt(W, 'Build the new cart drawer.', at(12)));
result(W, use(W, 'Read', { file_path: join(WEB, 'src/cart.tsx') }, at(11)), { ms: at(10.9) });
result(W, use(W, 'mcp__playwright__browser_take_screenshot', { filename: 'drawer.png' }, at(10)), { ms: at(9.9) }); // a playwright cart waits in the row
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
begin(I, 'Bash', { command: 'xcodebuild -scheme Shop build', description: 'Build the app' }, at(0.4));

const O = byId['demo-ops'];
write(O, prompt(O, 'Spin up the staging stack and file the follow-ups.', at(14)));
result(O, use(O, 'Bash', { command: 'npm run dev', run_in_background: true, description: 'Start the staging server' }, at(10)), { ms: at(9.9), text: 'Command running in background' });
write(O, { type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: O.id });
result(O, use(O, 'mcp__claude_ai_Linear__list_issues', { team: 'Infra' }, at(6)), { ms: at(5.9) }); // its Linear cart waits in the row, until the next call
begin(O, 'Bash', { command: 'terraform plan -out staging.tfplan', description: 'Plan the staging stack' }, at(0.3));

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
// How the Bash tool runs a command: a shell of its own process group under the session.
const shellLine = typed => `/bin/zsh -c source ${join(claudeDir, 'shell-snapshots', 'snapshot-zsh-1-demo.sh')} 2>/dev/null || true && eval '${typed}' < /dev/null && pwd -P >| /tmp/claude-demo-cwd`;
const WORKERS = { 'npm test -- checkout': 'node --test tests/checkout.test.ts', 'npm run dev': 'node node_modules/.bin/next dev', 'xcodebuild -scheme Shop build': 'xcodebuild -scheme Shop build', 'terraform plan -out staging.tfplan': 'terraform plan', 'python notebooks/funnel.py': 'python3 notebooks/funnel.py', 'npm run build': 'node node_modules/.bin/next build' };
function readProcs() {
  const procs = new Map();
  for (const s of SESSIONS) {
    const jitter = s.cpu ? Math.round((Math.random() - 0.5) * s.cpu * 0.4) : 0;
    procs.set(s.pid, { pid: s.pid, ppid: 1, cpu: Math.max(0, s.cpu + jitter), rssKb: s.mb * 1024, command: s.command ?? 'claude' });
  }
  const shell = (s, pid, command, startedAt, cpu, kb) => { // the shell, and the program it runs
    const ageSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    procs.set(pid, { pid, ppid: s.pid, pgid: pid, ageSec, cpu: 0.1, rssKb: 3 * 1024, command: shellLine(command) });
    procs.set(pid + 1, { pid: pid + 1, ppid: pid, pgid: pid, ageSec, cpu: Math.max(0, cpu + Math.round((Math.random() - 0.5) * cpu * 0.3)), rssKb: kb, command: WORKERS[command] ?? command });
  };
  if (!DEV.stopped) shell(C, DEV.pid, 'npm run dev', DEV.startedAt, 4, 420 * 1024);
  for (const s of SESSIONS) if (s.openBash) shell(s, s.openBash.pid, s.openBash.command, s.openBash.startedAt, 18, 210 * 1024);
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
// Claude Code's own CLI, for the Claude Code dialog: made-up plugins and MCP servers.
const fakeClaude = join(temp, 'claude');
writeFileSync(fakeClaude, `#!/bin/sh
case "$1 $2" in
  "plugin list") echo '[{"id":"shop-tools@acme-plugins","version":"2.1.0","enabled":true,"scope":"user"},{"id":"design-review@acme-plugins","version":"1.4.2","enabled":true,"scope":"user"},{"id":"release-notes@acme-plugins","version":"0.9.0","enabled":false,"scope":"project"}]' ;;
  "plugin details")
    case "$3" in
      shop-tools*) printf 'shop-tools 2.1.0\\n  Description: Orders, carts and payments helpers.\\n\\nComponent inventory\\n  Skills (3)  create-order, refund, cart-audit\\n  Agents (1)  order-reviewer\\n  Hooks (0)\\n  MCP servers (1)  orders-db\\n  LSP servers (0)\\n\\nProjected token cost\\n  Always-on:   ~2,100 tok   added to every session\\n' ;;
      design-review*) printf 'design-review 1.4.2\\n  Description: Reviews screens against the design system.\\n\\nComponent inventory\\n  Skills (2)  review-screen, contrast-check\\n  Agents (0)\\n  Hooks (1)\\n  MCP servers (0)\\n  LSP servers (0)\\n\\nProjected token cost\\n  Always-on:   ~900 tok   added to every session\\n' ;;
      *) printf 'release-notes 0.9.0\\n  Description: Drafts release notes from merged pull requests.\\n\\nComponent inventory\\n  Skills (1)  draft-notes\\n  Agents (0)\\n  Hooks (0)\\n  MCP servers (0)\\n  LSP servers (0)\\n\\nProjected token cost\\n  Always-on:   ~400 tok   added to every session\\n' ;;
    esac ;;
  "mcp list") printf 'Checking MCP server health...\\n\\nlinear: https://mcp.linear.app/mcp (HTTP) - \\342\\234\\224 Connected\\nplaywright: npx @playwright/mcp@latest - \\342\\234\\224 Connected\\nfigma: https://mcp.figma.example/mcp (HTTP) - ! Needs authentication\\nplugin:shop-tools:orders-db: node ./servers/orders.js - \\342\\234\\224 Connected\\n' ;;
  *) echo '[]' ;;
esac
`, { mode: 0o755 });
put(join(claudeDir, 'settings.json'), `${JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', 'Bash(git status)', 'mcp__claude_ai_Linear__list_issues'], deny: ['Bash(rm -rf:*)'] } }, null, 2)}\n`);
writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: { [ANALYTICS]: 'demo/analytics' }, pollMs: 400, gitPollMs: 3000, deployPollMs: 4000, prPollMs: 4000, permissionGuessSec: 3600, terminal: 'iTerm' }));
const state = join(root, 'state');
for (const d of ['pending', 'answers', 'mods']) mkdirSync(join(state, d), { recursive: true });
// Each session's mod: it says it is listening, with its cost, the plan's limits and its working line.
const PLAN = [{ kind: 'five_hour', percentUsed: 38, resetsAt: iso(NOW + 2.2 * 3_600_000) }, { kind: 'seven_day', percentUsed: 76, resetsAt: iso(NOW + 3 * 86_400_000) }]; // the silo's tag is amber
const offers = { [Q.ask]: { kind: 'question', toolUseId: Q.ask, sessionId: Q.id, createdAt: at(1), questions: [QUESTION] }, [P.ask]: { kind: 'permission', toolUseId: P.ask, sessionId: P.id, tool: 'Bash', summary: 'ssh prod ./deploy.sh --webhooks', createdAt: at(0.8), expiresAt: NOW + 3_600_000 } };
for (const [id, o] of Object.entries(offers)) writeFileSync(join(state, 'pending', `${id}.json`), JSON.stringify(o));
const thinking = new Set(['demo-cart']);
function beacons() {
  for (const s of SESSIONS) {
    if (s.key === 'demo-spike') continue; // long gone
    s.cost += s.open ? 0.004 : 0;
    const working = Boolean(s.open) || thinking.has(s.key);
    writeFileSync(join(state, 'mods', `${s.id}.json`), JSON.stringify({ sessionId: s.id, version: '0.6.2', at: Date.now(), usage: { costUsd: s.cost, contextPercent: Math.round((s.ctx / 200_000) * 100), rateLimits: PLAN }, ...(working ? { turn: { startedAt: s.turnAt, word: s.word ?? 'Working', mode: thinking.has(s.key) ? 'thinking' : 'tool-use' } } : {}), ...(s.effort ? { effort: s.effort } : {}) }));
  }
  for (const id of Object.keys(offers)) { const f = join(state, 'pending', `${id}.json`); if (existsSync(f)) utimesSync(f, new Date(), new Date()); }
}
const REPLIES = {
  'demo-deploy': 'Will do: I will post in #releases once the deploy is live.',
  'demo-checkout': 'Thanks. I will match the page to the design, and keep the cart id as the idempotency key.',
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
    if (id === P.ask && a.decision === 'always') { // its mod hands the call to Claude Code, whose own options come back to the dashboard
      offers[id] = { kind: 'always', toolUseId: id, sessionId: P.id, tool: 'Bash', summary: 'ssh prod ./deploy.sh --webhooks', createdAt: Date.now(), expiresAt: Date.now() + 120_000,
        suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ssh prod ./deploy.sh:*' }], behavior: 'allow', destination: 'localSettings' }, { type: 'addDirectories', directories: [INFRA], destination: 'session' }] };
      writeFileSync(join(state, 'pending', name), JSON.stringify(offers[id]));
      continue;
    }
    rmSync(join(state, 'pending', name), { force: true });
    delete offers[id];
    if (id === Q.ask) {
      result(Q, Q.ask, { text: `User answered: ${JSON.stringify(a.answers ?? a)}` });
      Q.ask = null; Q.cpu = 24; Q.word = 'Migrating'; Q.effort = 'high'; Q.turnAt = Date.now();
      setTimeout(() => { reply(Q, 'Postgres it is. Writing the migration for the orders table now.'); begin(Q, 'Write', { file_path: join(API, 'migrations/001_orders.sql'), content: 'create table orders' }); }, 700);
      STEPS['demo-orders'] = [['Bash', { command: 'npm run migrate' }], ['Edit', { file_path: join(API, 'src/orders.ts'), old_string: 'a', new_string: 'b' }]];
    }
    if (id === P.ask && (a.decision === 'allow' || Number.isInteger(a.option))) { // allowed, or allowed with one of Claude Code's options kept
      P.ask = null; P.cpu = 21; P.word = 'Deploying'; P.effort = 'medium'; P.turnAt = Date.now();
      setTimeout(() => { result(P, id, { text: 'Deployed webhooks v2 to production.' }); begin(P, 'Bash', { command: 'curl -fsS https://shop.example.com/health', description: 'Check production health' }); }, 900);
      STEPS['demo-deploy'] = [['Bash', { command: 'gh run watch' }], ['Bash', { command: 'curl -fsS https://shop.example.com/health' }]];
    }
  }
  for (const s of SESSIONS) {
    for (const m of inbox('messages', s.id)) { // a message: your own prompt, then a reply
      write(s, prompt(s, m.text, Date.now(), { origin: { kind: 'plugin', name: 'agent-tracker', asUser: true } }));
      const shot = /screenshot/i.test(m.text) && s === C; // asked for a screenshot: it says where it saved it (under ~, the demo's home)
      setTimeout(() => { reply(s, shot ? `Here is the checkout page as it looks now: \`~/${SHOT.slice(DEMO.length + 1)}\`` : REPLIES[s.key] ?? 'Will do.'); }, shot ? 2400 : 1600);
    }
    for (const c of inbox('commands', s.id)) { // a model or effort switch, as /model would say it
      setTimeout(() => {
        const text = { model: 'Set model to `Sonnet 5.5` and saved as your default for new sessions', effort: `Set effort level to ${c.args}`, compact: 'Compacted. The conversation so far is now a summary.', 'reload-plugins': 'Reloaded: 3 plugins · 6 skills · 1 agent · 2 MCP servers' }[c.command] ?? 'Done';
        if (c.command === 'model') s.model = SONNET;
        if (c.command === 'effort') s.effort = c.args;
        if (c.command === 'compact') { // a harvest on the farm: the field starts again from seed
          write(s, { type: 'system', subtype: 'compact_boundary', timestamp: iso(Date.now()), compactMetadata: { trigger: 'manual', preTokens: s.ctx } });
          s.ctx = 18_000;
        }
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
const paused = new Set(); // sessions the tour is showing: they keep their step
const DEV_LINES = [' GET /checkout 200 in 41ms', ' POST /api/orders 201 in 63ms', ' POST /api/orders 200 in 9ms (same idempotency key: the same order)', ' POST /api/webhooks/payment 200 in 12ms', ' GET /api/orders/7f3a 200 in 7ms'];
let devLine = 0;
const devLog = () => { if (!DEV.stopped) appendFileSync(DEV_OUT, `${DEV_LINES[devLine++ % DEV_LINES.length]}\n`); };
function direct() {
  devLog();
  for (const [id, steps] of Object.entries(STEPS)) {
    if (paused.has(id)) continue;
    const s = byId[id], i = stepAt[id] = ((stepAt[id] ?? -1) + 1) % steps.length;
    if (s.open) result(s, s.open);
    s.open = null;
    s.openBash = null;
    const next = steps[i];
    if (next) { thinking.delete(id); begin(s, ...next); } else thinking.add(id); // between steps: thinking
  }
}

/* ---------- the browser, its cursor and its captions ---------- */

const handle = await startCollector({
  root, claudeDir, claudeBin: fakeClaude, notify: () => {}, log: () => {}, home: DEMO,
  readProcs, deployStatusOf: async r => (r === 'demo/analytics' ? { status: 'in_progress', at: Date.now(), workflow: 'Deploy', sha: 'a1b2c3d' } : null),
  githubSlugOf: async top => SLUGS[top] ?? null, pullRequestsOf: async slug => PRS[slug] ?? { open: [], merged: [] },
  sessionProcs: { commandOf: async () => 'claude', ttyOf: async () => 'ttys001', kill: () => {}, alive: () => true, groupAlive: () => false,
    killGroup: pgid => { // Stop: the dev server ends, and Claude Code's notice says so
      if (pgid !== DEV.pid || DEV.stopped) return;
      DEV.stopped = true;
      write(C, { type: 'user', timestamp: iso(Date.now()), cwd: API, origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n<tool-use-id>${DEV.id}</tool-use-id>\n<status>killed</status>\n</task-notification>` } });
    } },
  scratchBase: SCRATCH, folderRoots: [DEMO], chooseFolder: async () => ({ path: DESIGN }), // Finder's folder window, stood in for
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
const marks = []; // where each chapter's title card comes up: [number, title, the first frame after it was asked for]
let ws, chooserFiles = []; // what Attach's file chooser picks
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
    if (m.method === 'Page.fileChooserOpened') void send('DOM.setFileInputFiles', { files: chooserFiles, backendNodeId: m.params.backendNodeId });
    if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const js = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
  const until = async (expr, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(120)) if (await js(expr)) return true; return false; };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: false });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  // Before the tour, this Chrome makes the rest of the files: the release notes as a PDF, and the
  // checkout page as a picture in the design folder and (with gift wrap ticked) in the agent's scratchpad.
  put(join(DEMO, 'notes.html'), '<title>Shop 2.4 release notes</title><style>body { font: 15px/1.6 system-ui, sans-serif; margin: 56px 64px; color: #1d2433; } h1 { font-size: 30px; margin: 0 0 4px; } h2 { margin-top: 28px; font-size: 19px; } .sub { color: #6b7385; }</style><h1>Shop 2.4</h1><p class="sub">Release notes</p><h2>New</h2><ul><li><b>One-page checkout.</b> Address, delivery and payment on one page.</li><li><b>The cart drawer.</b> Change sizes and quantities without leaving the page.</li><li><b>Faster search.</b> Results as you type.</li></ul><h2>Fixed</h2><ul><li>Pressing Pay twice no longer charges twice: one cart makes one order.</li><li>The payment webhook retries with backoff when the bank is slow.</li></ul>');
  await send('Page.navigate', { url: pathToFileURL(join(DEMO, 'notes.html')).href }); await sleep(700);
  writeFileSync(join(API, 'docs', 'release-2.4.pdf'), Buffer.from((await send('Page.printToPDF', { printBackground: true })).result.data, 'base64'));
  rmSync(join(DEMO, 'notes.html'));
  await send('Page.navigate', { url: pathToFileURL(join(DESIGN, 'checkout', 'index.html')).href }); await sleep(800);
  writeFileSync(join(DESIGN, 'checkout.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await js("document.getElementById('gift').click()"); await sleep(200);
  writeFileSync(SHOT, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
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
  /** A clean picture of the page, for docs/: no caption and no cursor. */
  async function still(name) {
    if (!STILLS) return;
    await js("window.__demo.caption(null); document.getElementById('demo-cursor').style.opacity = '0'");
    await sleep(700);
    writeFileSync(join(STILLS, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    await js("document.getElementById('demo-cursor').style.opacity = '1'");
  }

  await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
  const tick = setInterval(direct, 5200);
  timers.push(tick);
  const logo = await js("window.Agentville.svg({ size: 132 })");

  const F = byId['demo-flow'];
  const dlgOpen = "document.querySelector('.px-dlg')?.open";
  /** A building's dialog: opened from the farm, read, closed. */
  async function building(x, y, ms = 2200) {
    await click(spot(await farmAt(x, y)), 700);
    await until(dlgOpen, 3000); await raise(); await hold(ms);
    await click(q('[data-farm-dlg-close]'), 450);
    if (!(await until(`!${dlgOpen}`, 1500))) await js("document.querySelector('.px-dlg').close()");
  }
  const pickFarmer = async key => { await click(tag(key), 750); await until(`document.querySelector('#farm-agent .fs-head .name')?.textContent === ${JSON.stringify(byId[key].name)}`, 3000); await hold(400); };
  const chapter = async (n, title) => {
    await say(null);
    marks.push([n, title, shot.length]);
    await js(`window.__demo.card(${JSON.stringify(`<small>${n}</small><div style="font-size:52px">${title}</div>`)})`);
    await hold(2000);
    await js('window.__demo.card(null)');
    await hold(600);
  };
  const sideTab = async t => { await click(q(`#tab-${t}`), 550); await hold(500); };
  /** A file in the Files tab, its folders opened on the way; it opens in a window over the farm. */
  async function openTreeFile(path) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = `#tree button.tn.dir[data-dir="${parts.slice(0, i).join('/')}"]`;
      if ((await js(`document.querySelector(${JSON.stringify(dir)})?.getAttribute('aria-expanded')`)) === 'false') { await click(q(dir), 450); await hold(250); }
    }
    await click(q(`#tree button.tn.file[data-file="${path}"]`), 600);
    await until("document.getElementById('file-dlg').open", 3000); await raise();
  }
  const closeFile = async () => { await click(q('#file-dlg [data-file-close]'), 450); await until("!document.getElementById('file-dlg').open", 2000); await hold(300); };
  const tabKey = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); };
  const setSelect = (sel, value) => js(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  async function selectText(scope, text) { // a passage, selected with the mouse as you would
    const e = byText(`${scope} li, ${scope} p, ${scope} .l`, text);
    const ends = await js(`(() => { const e = ${e}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(e); const b = [...r.getClientRects()]; const a = b[0], z = b.at(-1); return a ? [[Math.round(a.left + 2), Math.round(a.top + a.height / 2)], [Math.round(z.right - 2), Math.round(z.top + z.height / 2)]] : null; })()`);
    if (!ends) return;
    await moveTo(ends[0], 700);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ends[0][0], y: ends[0][1], button: 'left', clickCount: 1 });
    for (let i = 1; i <= 12; i++) { const p = [ends[0][0] + ((ends[1][0] - ends[0][0]) * i) / 12, ends[0][1] + ((ends[1][1] - ends[0][1]) * i) / 12]; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1 }); await js(`window.__demo.move(${p[0]}, ${p[1]}, 50)`); await sleep(55); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ends[1][0], y: ends[1][1], button: 'left', clickCount: 1 });
    cursor = ends[1];
  }

  // ----- 0. opening -----
  await js(`window.__demo.card(${JSON.stringify(`${logo}<div>Agentville</div><p>A local dashboard for the Claude Code and Codex sessions running on your Mac.</p>`)})`);
  await hold(4200);
  await js('window.__demo.card(null)');
  await hold(700);

  // ----- 1. the farm -----
  await chapter(1, 'The farm');
  await still('farm');
  await say('Each agent is a farmer, and each repo is a field', 'Subagents, background jobs and Codex sessions show up here too.');
  await moveTo([VW * 0.55, VH * 0.45], 900); await hold(3600);
  await say('The panel in the corner', "It counts agents by state and shows their memory and CPU, along with your plan's 5-hour and weekly limits.");
  await point(q('[data-farm-state="waiting"]'), 700); await hold(1600);
  await point(q('.px-gauges'), 600); await hold(2600);
  await say('Agents that need you wait on the porch', "A red ! is a question or a permission. A scroll is a plan to approve, and a basket means the agent finished and it's your turn.");
  await point(spot(await farmer('demo-deploy')), 800); await hold(1900);
  await point(spot(await farmer('demo-cache')), 600); await hold(1700);
  await point(spot(await farmer('demo-notes')), 600); await hold(1900);
  await say("The farmer's tool shows what the agent is doing", 'A hoe means it is editing and a magnifier means it is running tests. The board next to it is the task list.');
  await point(spot(await farmer('demo-cart')), 800); await hold(2200);
  await point(spot(await farmer('demo-checkout')), 700); await hold(2400);
  await say('Crops grow as the context fills up', 'When the session is compacted, the field is harvested and planted again.');
  await point(spot(await farmer('demo-metrics')), 800); await hold(1600);
  write(M, { type: 'system', subtype: 'compact_boundary', timestamp: iso(Date.now()), compactMetadata: { trigger: 'auto', preTokens: 182_000 } });
  M.ctx = 16_000;
  reply(M, 'Picking up from the summary: the funnel chart is next.');
  await hold(3600);
  await say('The weather shows the last deploy', 'It rains on a field whose last deploy failed. A passed deploy gets a rainbow, and a windmill turns while one is running.');
  await point(q('[data-farm-field$="mobile"]'), 800); await hold(1800);
  await point(q('[data-farm-field$="docs"]'), 700); await hold(1800);
  await point(q('[data-farm-field$="analytics"]'), 700); await hold(1800);
  await say('The silo shows your weekly usage', "The grain rises as you use up the plan's weekly limit. Its tag turns amber at 70% and red at 90%.");
  await point(spot(await farmAt(102, 44)), 800); await hold(4000);
  await say('A pigeon means one agent wrote to another', 'The message also appears in both conversations.');
  const [ca, cb] = [await farmer('demo-cart'), await farmer('demo-checkout')];
  if (ca && cb) { // zoom in between the two, so the pigeon shows
    const mid2 = [Math.round((ca[0] + cb[0]) / 2), Math.round((ca[1] + cb[1]) / 2) - 30];
    await moveTo(mid2, 700);
    for (let i = 0; i < 3; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mid2[0], y: mid2[1], deltaX: 0, deltaY: -120, modifiers: 4 }); await sleep(420); }
    await hold(600);
  }
  use(W, 'SendMessage', { to: 'checkout-api', summary: 'Cart calls POST /orders', message: 'The cart drawer now calls POST /orders with an idempotency key. Is the endpoint ready?' });
  await hold(4400);
  await click(q('[data-farm-zoom="0"]'), 600); await hold(700);
  await say('Each MCP server has its own cart', 'When an agent calls the server, its cart drives to that farmer and waits there until the call ends.');
  await point(spot(await farmAt(372, 84)), 800); await hold(1500); // the carts, waiting at the lane's end
  result(O, O.open);
  begin(O, 'mcp__claude_ai_Linear__save_issue', { title: 'Rotate the staging TLS certificate', team: 'Infra' });
  if (await until(`!!${byText('.px-mover', 'Linear')}`, 6000)) for (let i = 0; i < 7; i++) await point(byText('.px-mover', 'Linear'), 850);
  await hold(2200);
  await say('Web fetches and searches send a cart to town', 'A pump stands for a background job. A farmer in a hammock is a session that will wake itself up with /loop.');
  await point(byText('.px-mover', 'docs.github.com'), 700); await hold(1900);
  result(O, O.open); begin(O, 'Bash', { command: 'terraform plan -out staging.tfplan', description: 'Plan the staging stack' }); // the Linear call is done: its cart heads back
  await point(spot(await farmer('demo-ops')), 700); await hold(1800);
  await point(spot(await farmAt(97, 198)), 800); await hold(2200);
  await say('Click a building to see more', 'The stall lists pull requests and the notice board shows CLAUDE.md and memory. Subagents are in the henhouse.');
  await building(298, 70, 2400);
  await building(119, 70, 2200);
  await building(24, 112, 2200);
  await say('The sky follows your clock', 'You can zoom, drag the view around and use the minimap. Help explains every symbol.');
  await click(q('[data-farm-sky]'), 700); await hold(2800);
  if (STILLS) { await still('farm-night'); if (process.env.STILLS_ONLY) throw STILLS_DONE; }
  await click(q('[data-farm-sky]'), 400); await hold(250); await click(q('[data-farm-sky]'), 300); await hold(500);
  const mid = [VW * 0.5, VH * 0.45];
  await moveTo(mid, 500);
  for (let i = 0; i < 2; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mid[0], y: mid[1], deltaX: 0, deltaY: -120, modifiers: 4 }); await sleep(380); }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mid[0], y: mid[1], button: 'left', clickCount: 1 });
  for (let i = 1; i <= 16; i++) { const p = [mid[0] + i * 12, mid[1] + i * 7]; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1 }); await js(`window.__demo.move(${p[0]}, ${p[1]}, 40)`); await sleep(45); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mid[0] + 192, y: mid[1] + 112, button: 'left', clickCount: 1 });
  cursor = [mid[0] + 192, mid[1] + 112];
  await point(q('.px-mini'), 600); await hold(1400);
  await click(q('[data-farm-zoom="0"]'), 600); await hold(600);
  await click(q('[data-farm-help]'), 600);
  await until("document.querySelector('.px-help')?.open", 3000); await raise(); await hold(2600);
  await click(q('[data-farm-help-close]'), 500); await hold(400);

  // ----- 2. answering and messaging from the farm -----
  await chapter(2, 'Answering and messaging from the farm');
  await say('Clicking a farmer opens its sidebar', 'It has the current step, the working line, the model and effort, a message box and the conversation.');
  await pickFarmer('demo-checkout');
  await point(q('#farm-agent .workline'), 700); await hold(1600);
  await point(q('#farm-agent .sessbar'), 600); await hold(1700);
  await say('Follow keeps the farmer in view', 'The view zooms in and moves along as it walks.');
  await click(q('[data-farm-follow]'), 700); await hold(3400);
  await click(q('[data-farm-follow]'), 500); await click(q('[data-farm-zoom="0"]'), 500); await hold(600);
  await say('Answer its question here', 'The options are the same as in the terminal, and the session carries on as if you had answered there.');
  await pickFarmer('demo-orders');
  await click(`${q('#farm-agent input[value="Postgres"]')}?.closest('label')`, 700); await hold(500);
  await click(q('#ask-send'), 600);
  await until(`document.querySelector('[data-farmer="${Q.id}"]')?.className.includes('st-working')`, 6000); await hold(2000);
  await say('Allow or deny a command', 'This only comes up in modes that ask you. In bypass or auto mode the call goes ahead without waiting.');
  await pickFarmer('demo-deploy');
  await point(q('#farm-agent .ask'), 600); await hold(2600);
  await say("Always allow uses Claude Code's own choices", 'For example, a rule for this project or access to a folder.');
  await click(q('#ask-always'), 600);
  await until("!!document.querySelector('#farm-agent [data-always-pick]')", 6000);
  await point(q('#farm-agent .always-opts'), 600); await hold(2400);
  await click(q('#farm-agent [data-always-pick="0"]'), 600);
  await until(`document.querySelector('[data-farmer="${P.id}"]')?.className.includes('st-working')`, 6000); await hold(1600);
  await say('Send it a message', 'It arrives as your own prompt, even in the middle of a task. Attach files, or attach a folder by its path.');
  await pickFarmer('demo-checkout');
  chooserFiles = [join(DESIGN, 'checkout.png')];
  await click(q('#msg-attach'), 600);
  await until("!!document.querySelector('#farm-agent .thumbs img')", 4000); await hold(700);
  await click(q('#msg-folder'), 600);
  await until("!!document.querySelector('#farm-agent .thumb-folder')", 4000); await hold(700);
  await click(q('#msg-text'), 500);
  await type('Here is the new design. Match the checkout page to it.');
  await hold(300); await enter(); await hold(3200);
  await say('Side questions use /btw', 'The session answers from its conversation without stopping, and the question is not added to the conversation.');
  await click(q('#aside-text'), 600);
  await type('Which tests cover the idempotency key?');
  await hold(300); await enter();
  await until("!!document.querySelector('#farm-agent .aside .aside-a.md')", 8000);
  await point(q('#farm-agent .aside'), 600); await hold(2800);
  await say('Change its model or effort, or compact it', 'The dashboard runs /model, /effort or /compact inside the session.');
  await point(q('#farm-agent [data-switch-effort]'), 600);
  await setSelect('#farm-agent [data-switch-effort]', 'high');
  await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1400);
  await click(q('#confirm-yes'), 600);
  await until("!!document.querySelector('#farm-agent .set-note')", 6000); await point(q('#farm-agent .set-note'), 500); await hold(1400);
  await click(q('#farm-agent [data-compact]'), 600);
  await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1400);
  await click(q('#confirm-yes'), 600); await hold(2800);

  // ----- 3. following the work -----
  await chapter(3, 'Following the work');
  paused.add('demo-checkout'); // it keeps its test run going while the tour looks at it
  if (!C.openBash) { if (C.open) result(C, C.open); begin(C, 'Bash', { command: 'npm test -- checkout', description: 'Run the checkout tests' }); }
  await say('The Activity tab lists every step', 'Each step shows how long it took and whether it worked.');
  await sideTab('activity'); await hold(2600);
  await say('Each subagent gets a card', 'The card shows its task, its current step and what it last said. Open it to follow along, or read its transcript.');
  await sideTab('subagents'); await hold(1400);
  await click(`${byText('#farm-subagents .sub-card', 'Explore')}?.querySelector('[data-child]')`, 600); // the farm's Subagents tab has its own pane
  await until("!!document.querySelector('#farm-subagents .sub-prompt')", 5000); await hold(3200);
  await say('Commands running lists its shell commands', 'For each one you see how long it has run and the CPU and memory it uses, counting anything it started.');
  await sideTab('agent');
  await until("!!document.querySelector('#farm-agent .shell-row')", 6000);
  await point(byText('#farm-agent .sec', 'Commands running'), 700); await hold(900);
  await point(q('#farm-agent .shell-row'), 600); await hold(2600);
  await say("Output shows a background command's log", 'It keeps updating while the window is open.');
  await click(q(`#farm-agent [data-shell-output="${DEV.pid}"]`), 600);
  await until("document.getElementById('shell-dlg').open", 3000); await raise();
  const fast = setInterval(devLog, 700);
  await hold(5400);
  clearInterval(fast);
  await click(q('[data-shell-close]'), 500); await hold(400);
  await say('Stop ends a command', 'After you confirm, the command stops along with anything it started, and the session sees it end.');
  await click(q(`#farm-agent [data-shell-stop="${DEV.pid}"]`), 600);
  await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1500);
  await click(q('#confirm-yes'), 600);
  await until(`!document.querySelector('#farm-agent [data-shell-stop="${DEV.pid}"]')`, 6000); await hold(2000);
  await say('The Diary tab is a log of the farm', 'Answers, messages, harvests and deploys are all recorded there.');
  await sideTab('diary'); await hold(3000);
  paused.delete('demo-checkout');

  // ----- 4. opening files -----
  await chapter(4, 'Opening files');
  await say("The Files tab shows the agent's folder", 'The scratchpad and memory are there too. Git status letters and dots mark the files the agent changed or read.');
  await sideTab('files'); await hold(3000);
  await say('Files open in a window over the farm', 'Markdown is rendered and code has line numbers. If the agent changes the file, the window updates.');
  await openTreeFile('docs/plan.md');
  await until("!!document.getElementById('reader-body')?.textContent.includes('idempotent')", 6000); await hold(2400);
  await say('Quote part of a file in your reply', 'Select a passage and click Quote. The agent gets your reply along with the quoted lines.');
  await selectText('#reader-body', 'idempotent');
  await hold(500);
  await click(q('#reader-quote'), 600); await hold(500);
  await type('Use the cart id as the key.');
  await hold(400);
  await click(q('#reader-send'), 600); await hold(2200);
  await closeFile();
  await say('Pictures, PDFs and videos open as they are', "A picture is fitted to the window and a PDF opens in the browser's viewer. Videos play with seeking.");
  await openTreeFile('design/checkout.png'); await hold(2800); await closeFile();
  await openTreeFile('docs/release-2.4.pdf'); await hold(3400); await closeFile();
  await openTreeFile('design/walkthrough.mp4');
  await until("!!document.querySelector('#reader-body video')", 4000);
  await js("document.querySelector('#reader-body video').play()"); await hold(3800); await closeFile();
  await say('Preview an HTML page', 'Preview shows the page with its own CSS and scripts, kept apart from the dashboard. Source shows the code.');
  await openTreeFile('design/checkout/index.html'); await hold(2800);
  await click(q('#file-dlg [data-reader-mode="source"]'), 600); await hold(2400);
  await closeFile();
  await say('Word and Excel files', 'A Word document shows as a page or as plain text. A workbook shows as tables with a tab for each sheet.');
  await openTreeFile('docs/brief.docx'); await hold(3000); await closeFile();
  await openTreeFile('docs/forecast.xlsx'); await hold(2200);
  await click(q('#file-dlg [data-sheet="1"]'), 600); await hold(2000); await closeFile();
  await say('Ask it for a screenshot', 'When the reply names the file, a thumbnail appears under it. Click the thumbnail to open the picture.');
  await sideTab('agent');
  await click(q('#msg-text'), 600);
  await type('Take a screenshot of the checkout page and save it in your scratchpad.', 32);
  await hold(300); await enter();
  await until("document.querySelector('#farm-agent .named-pic img')?.naturalWidth > 0", 10000);
  await point(q('#farm-agent .named-pic'), 700); await hold(1500);
  await click(q('#farm-agent .named-pic'), 500);
  await until("document.getElementById('file-dlg').open", 3000); await raise(); await hold(3000);
  await closeFile();

  // ----- 5. the list view -----
  await chapter(5, 'The list view');
  await click(q('[data-farm-nav="list"]'), 700);
  await until("document.getElementById('main').dataset.view === 'list'", 3000); await hold(600);
  await say('The list view shows the same agents', 'They are sorted by what needs you, and idle and stale sessions are folded away.');
  await point(q('#list .row'), 700); await hold(1000);
  await click(q('#list [data-group="idle"]'), 700); await hold(1700);
  await click(q('#list [data-group="idle"]'), 500); await hold(500);
  await say('The top bar shows your Mac and your plan', "How much memory and CPU your agents use, your plan's limits, and when each limit resets.");
  await point(q('#hstats'), 700); await hold(2400);
  await point(q('#kpis .kpi'), 600); await hold(1300);
  await say('Collisions', 'A collision means two agents are writing to the same repo at the same time.');
  await point(q('#kpis .kpi.k-collide'), 600); await hold(1100);
  await point(q('#rail .card.collide'), 700); await hold(2400);
  await say('Each agent has a detailed panel', 'It has the working line, tasks, model, effort, context and cost, with CPU and memory over time.');
  await click(row('demo-checkout'), 600); await hold(600);
  await point(q('#center-body .workline'), 600); await hold(1400);
  await point(q('#center-body .metrics'), 600); await hold(1700);
  await say('The newest reply is framed as Latest', 'If your message is just below it, that is framed too. Reply quotes any message into the box.');
  await point(q('#center-body .latest'), 700); await hold(3000);
  await say('Read all opens the whole conversation', 'Search highlights every match, and Enter jumps to the next one.');
  await click(q(`#center-body [data-convo="${C.id}"]`), 600);
  await until("document.getElementById('convo').open", 4000); await raise(); await hold(1200);
  await click(q('#convo-q'), 500);
  await type('retry', 90);
  await until("/ of /.test(document.getElementById('convo-count').textContent)", 4000); await hold(1700);
  await enter(); await hold(1500); await enter(); await hold(1500);
  await click(q('[data-convo-close]'), 500); await hold(500);
  await say('The Repos panel lists every repo', 'You see its branch, uncommitted files, unpushed commits, last deploy and open pull requests.');
  await point(`[...document.querySelectorAll('#rail .card')].filter(c => !c.classList.contains('collide'))[0]`, 700); await hold(1700);
  await point(`[...document.querySelectorAll('#rail .card')].filter(c => !c.classList.contains('collide'))[1]`, 600); await hold(1700);

  // ----- 6. starting, restarting and ending sessions -----
  await chapter(6, 'Starting, restarting and ending sessions');
  await click(row('demo-checkout'), 600); await hold(400);
  await say('Restart it in another mode, or end it', 'Restart in resumes it in plan, accept-edits or bypass mode. End session asks before it stops anything.');
  await point(q('#center-body [data-restart-mode]'), 600); await hold(1400);
  await click(q('#center-body [data-end-session]'), 600);
  await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1900);
  await click(q('#confirm-no'), 500); await hold(400);
  await say('A new session can start in any folder', "Type a path and the folders in it are suggested. Tab completes the name, and Browse opens Finder's folder window.");
  await click(q('#sessions-open'), 700);
  await until("document.getElementById('sessions').open", 3000); await raise(); await hold(900);
  await click(q('#sess-dir'), 600);
  await type('~/code/sh', 90); await hold(1500);
  await tabKey(); await hold(2000);
  await point(q('#sess-dir-browse'), 600); await hold(1200);
  await say('The folder does not have to exist yet', 'Create it makes the folder after asking. New then starts the session there with the mode, model and effort you picked.');
  await js("(() => { const f = document.getElementById('sess-dir'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); f.focus(); })()");
  await type('~/code/new-shop', 70); await hold(1300);
  await click(q('#sess-dir-note [data-dir-make]'), 600);
  await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1500);
  await click(q('#confirm-yes'), 600);
  await until("!document.getElementById('sess-dir-new').disabled", 4000); await hold(1100);
  await click(q('#sess-dir-new'), 600); await hold(2500);
  await say('Search your past sessions', 'Filter them by folder, model, branch or whether they are running, sort them, and resume one.');
  await click(q('#sessions-open'), 700);
  await until("document.getElementById('sessions').open && !!document.querySelector('#sessions [data-sess-resume]')", 5000); await raise(); await hold(900);
  await click(q('#sess-filter'), 600);
  await type('checkout', 80); await hold(1700);
  await setSelect('#sess-f-model', 'opus'); await hold(1500);
  await setSelect('#sess-sort', 'length'); await hold(2000);
  await click(q('#sessions [data-sess-close]'), 600); await hold(400);

  // ----- 7. plugins, MCP servers and permission rules -----
  await chapter(7, 'Plugins, MCP servers and permission rules');
  await say('The Claude Code dialog lists your plugins and skills', 'Each one shows how much context it uses in every session. You can turn it off, update it or remove it.');
  await click(q('#setup-open'), 700);
  await until("document.getElementById('setup').open", 3000); await raise();
  await until("/shop-tools/.test(document.getElementById('setup-body').textContent)", 8000); await hold(3400);
  await say('Reload applies plugin changes to running sessions', 'It runs /reload-plugins in every session that is listening.');
  await click(q('#setup [data-reload-sessions]'), 600); await hold(2800);
  await say('Check your MCP servers', "The list covers your own servers, claude.ai connectors and each plugin's servers. Sign in to one that needs it.");
  await click(q('[data-setup-tab="mcp"]'), 600);
  await until("/linear/.test(document.getElementById('setup-body').textContent)", 8000); await hold(3400);
  await say('Permission rules', 'See what runs without asking and which settings file each rule is in. You can remove a rule.');
  await click(q('[data-setup-tab="rules"]'), 600); await hold(3400);
  await click(q('[data-setup-close]'), 500); await hold(400);

  // ----- 8. notifications -----
  await chapter(8, 'Notifications');
  await click(q('#view-farm'), 700);
  await until("document.getElementById('main').dataset.view === 'farm'", 3000); await hold(800);
  await say('The bell plays a sound when an agent needs you', 'You also get a desktop notification, and the tab title shows how many agents are waiting.');
  await click(q('[data-farm-bell]'), 700); await hold(700);
  paused.add('demo-flow'); // it stops to ask: it walks to the porch, and the bell rings
  if (F.open) result(F, F.open);
  F.open = null; F.openBash = null;
  const FQ = { question: 'Keep the old checkout page as a fallback?', header: 'Fallback', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] };
  const fq = use(F, 'AskUserQuestion', { questions: [FQ] });
  offers[fq] = { kind: 'question', toolUseId: fq, sessionId: F.id, createdAt: Date.now(), questions: [FQ] };
  writeFileSync(join(state, 'pending', `${fq}.json`), JSON.stringify(offers[fq]));
  await hold(2600);
  await point(spot(await farmer('demo-flow')), 900); await hold(2600);
  await say(null);
  await js(`window.__demo.card(${JSON.stringify('<div style="font-size:44px">There is a view inside Claude Code too</div><p>/tracker opens a pane that lists every agent. Each session also gets a status line and toasts.</p>')})`);
  await hold(4600);
  await js('window.__demo.card(null)');
  await hold(600);

  // ----- 9. privacy -----
  await chapter(9, 'Privacy');
  await say('It all runs on your Mac', "The dashboard only listens on 127.0.0.1, and reading files or conversations needs the page's key.");
  await moveTo([VW * 0.5, VH * 0.42], 900); await hold(4400);

  // ----- 10. closing -----
  await say('Light, dark, or following macOS', 'The farm and the list show the same data.');
  await pickFarmer('demo-checkout');
  await click(q('[data-farm-nav="theme"]'), 600); await hold(300); await click(q('[data-farm-nav="theme"]'), 400); await hold(2800);
  await click(q('[data-farm-nav="theme"]'), 500); await hold(1200);
  await say(null);
  await moveTo([VW - 40, VH - 40], 600);
  await js(`window.__demo.card(${JSON.stringify(`${logo}<div>Agentville</div><small>github.com/hamsathul/agentville</small>`)})`);
  await hold(4400);
  await send('Page.stopScreencast');
  await sleep(300);
} catch (err) {
  if (err !== STILLS_DONE) throw err;
} finally {
  for (const t of timers) clearInterval(t);
  try { ws?.close(); } catch { /* gone */ }
  chrome.kill();
  for (const p of sleepers) p.kill();
  await handle.stop();
}

/* ---------- frames to video ---------- */

if (process.env.STILLS_ONLY) { // only the stills were asked for
  rmSync(temp, { recursive: true, force: true });
  rmSync(DEMO, { recursive: true, force: true });
  log(`saved farm.png and farm-night.png in ${STILLS}`);
  process.exit(0);
}

if (shot.length < 10) { console.error(`only ${shot.length} frames: nothing to make`); process.exit(1); }
/** The video of the frames shown from `from` to `to` (screencast seconds), each for as long as it stayed. */
function encode(out, from, to, fades = '') {
  const list = [];
  for (let i = 0; i < shot.length; i++) {
    const [file, t] = shot[i], next = shot[i + 1]?.[1] ?? t + 0.5, a = Math.max(t, from), b = Math.min(next, to);
    if (b > a) list.push(`file '${file}'`, `duration ${Math.max(0.001, b - a).toFixed(4)}`);
  }
  list.push(list.at(-2)); // the concat list ends with its last frame again
  writeFileSync(join(temp, 'frames.txt'), `${list.join('\n')}\n`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(temp, 'frames.txt'), '-vf', `fps=30,scale=1920:-2:flags=lanczos${fades},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-movflags', '+faststart', out], { stdio: 'inherit' });
}
const start = shot[0][1], end = shot.at(-1)[1] + 0.5;
log(`${shot.length} frames over ${(end - start - 0.5).toFixed(1)} s; encoding…`);
encode(OUT, start, end);
// The same video in under 10 MB, GitHub's limit for a video: 1280 wide at 15 frames a second, two passes
// at the bit rate that fills 9.5 MB.
const SMALL = OUT.replace(/\.mp4$/i, '') + '-small.mp4', kbps = Math.floor((9.5e6 * 8) / (end - start) / 1000) - 2;
for (const pass of [1, 2]) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT, '-vf', 'fps=15,scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-pass', String(pass), '-passlogfile', join(temp, 'small'), '-an', ...(pass === 1 ? ['-f', 'mp4', '/dev/null'] : ['-movflags', '+faststart', SMALL])], { stdio: 'inherit' });
}
// A video for each chapter: from its title card, once faded in, to the next one's. The opening is at the
// start of the first and the closing at the end of the last.
const CHAPTERS = OUT.replace(/\.mp4$/i, '') + '-chapters';
rmSync(CHAPTERS, { recursive: true, force: true });
mkdirSync(CHAPTERS, { recursive: true });
const cardAt = i => shot[Math.min(marks[i][2], shot.length - 1)][1];
for (let i = 0; i < marks.length; i++) {
  const [n, title] = marks[i], from = i === 0 ? start : cardAt(i) + 0.6, to = i + 1 < marks.length ? cardAt(i + 1) : end;
  const name = `${String(n).padStart(2, '0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.mp4`;
  log(`chapter ${n}, ${(to - from).toFixed(0)} s: ${name}`);
  encode(join(CHAPTERS, name), from, to, `,fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, to - from - 0.5).toFixed(2)}:d=0.5`);
}
rmSync(temp, { recursive: true, force: true });
rmSync(DEMO, { recursive: true, force: true });
log(`made ${OUT}, ${SMALL}, and a video for each chapter in ${CHAPTERS}`);
