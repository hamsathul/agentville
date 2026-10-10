#!/usr/bin/env node
// Records a demo video of Agentville, with made-up sessions only. A collector runs on a demo
// ~/.claude and ~/.claude-work (fourteen sessions in six demo repos, on two Claude accounts, with
// stand-ins for their mods, their processes, GitHub and the Helper's Haiku), a director keeps the
// sessions busy, and headless Chrome tours every feature with a cursor, following docs/demo-script.md:
// the farm, its Menu and seasons, the animals, the sidebar, messaging, Broadcast, naming and steering,
// an agent's work and files, its conversation, the list view, sessions, Claude Code's own setup, the
// other worlds, notifications. The video shows no text: what each scene says goes, timed, in a
// captions file beside it. Frames come from Chrome's screencast; ffmpeg makes the MP4 (about 12
// minutes), a copy small enough to upload to GitHub (out-small.mp4, under 10 MB), and a short video
// for each chapter in a folder beside it (out-chapters/01-the-farm.mp4 and so on).
//
//   node scripts/demo-video.mjs [out.mp4]      (needs Chrome and ffmpeg): out.mp4, out-small.mp4,
//                                              out-chapters/, and out-captions.md
//   STILLS=docs node scripts/demo-video.mjs    also saves farm.png and farm-night.png there (no
//                                              cursor), for the README; with STILLS_ONLY=1 it stops after them
//   DEMO_ONLY=3,5 DEMO_SCENES=<folder>         while working on the tour: just those chapters, and a
//                                              picture at the end of each scene
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { startCollector } from '../collector/collector.mjs';
import { captionsMd } from './demo/captions.mjs';
import { CHROME, launchBrowser, log, makeVideos, sleep, stage, timeline } from './demo/recorder.mjs';
import { iso, setUpSessions, transcriptWriter } from './demo/transcript.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? 'agentville-demo.mp4');
if (!CHROME) { console.error('Chrome not found: set CHROME to its path.'); process.exit(1); }
const STILLS = process.env.STILLS ? resolve(process.env.STILLS) : null;
const STILLS_DONE = new Error('the stills are taken');

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
const NOW = Date.now(), MIN = 60_000;
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-4-5-20251001';
const SESSIONS = [
  { key: 'demo-checkout', name: 'checkout-api', cwd: API, model: OPUS, ctx: 150_000, cpu: 31, mb: 760, cost: 6.42, word: 'Simmering', effort: 'xhigh' },
  { key: 'demo-cart', name: 'cart-ui', cwd: WEB, model: SONNET, ctx: 70_000, cpu: 22, mb: 540, cost: 2.18, word: 'Noodling', effort: 'high', mode: 'acceptEdits' },
  { key: 'demo-flow', name: 'checkout-flow', cwd: WORKTREE, model: OPUS, ctx: 40_000, cpu: 12, mb: 480, cost: 1.06, word: 'Tinkering', effort: 'high' },
  { key: 'demo-docs', name: 'docs-site', cwd: DOCS, model: SONNET, ctx: 110_000, cpu: 9, mb: 410, cost: 3.9, word: 'Browsing', effort: 'medium' },
  { key: 'demo-ios', name: 'ios-build', cwd: MOBILE, model: OPUS, ctx: 90_000, cpu: 27, mb: 690, cost: 4.75, word: 'Planning', effort: 'xhigh', command: 'claude --permission-mode plan', mode: 'plan' },
  { key: 'demo-ops', name: 'infra-ops', cwd: INFRA, model: OPUS, ctx: 60_000, cpu: 14, mb: 520, cost: 2.6, word: 'Provisioning', effort: 'high', command: 'claude --dangerously-skip-permissions', fast: true, mode: 'bypassPermissions', work: true },
  { key: 'demo-metrics', name: 'metrics', cwd: ANALYTICS, model: HAIKU, ctx: 180_000, cpu: 6, mb: 330, cost: 0.84, word: 'Crunching', effort: 'low' },
  { key: 'demo-orders', name: 'orders-db', cwd: API, model: OPUS, ctx: 55_000, cpu: 1, mb: 380, cost: 1.47 },
  { key: 'demo-deploy', name: 'deploy-bot', cwd: INFRA, model: SONNET, ctx: 30_000, cpu: 1, mb: 300, cost: 0.62, work: true },
  { key: 'demo-cache', name: 'cache-plan', cwd: WEB, model: OPUS, ctx: 45_000, cpu: 1, mb: 350, cost: 1.12, command: 'claude --permission-mode plan', mode: 'plan' },
  { key: 'demo-notes', name: 'release-notes', cwd: DOCS, model: SONNET, ctx: 85_000, cpu: 0, mb: 290, cost: 1.93 },
  { key: 'demo-ci', name: 'ci-watch', cwd: INFRA, model: HAIKU, ctx: 25_000, cpu: 0, mb: 220, cost: 0.31, work: true },
  { key: 'demo-scratch', name: 'scratch', cwd: ANALYTICS, model: SONNET, ctx: 0, cpu: 0, mb: 200, cost: 0.05 },
  { key: 'demo-spike', name: 'old-spike', cwd: ANALYTICS, model: SONNET, ctx: 20_000, cpu: 0, mb: 180, cost: 0.4 },
];
// Two Claude accounts: ~/.claude (personal), and ~/.claude-work, where the infra sessions run.
const workDir = join(DEMO, '.claude-work');
put(join(DEMO, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'you@example.com' } }));
put(join(workDir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'you@acme.example', organizationName: 'Acme' } }));
const mine = setUpSessions(claudeDir, SESSIONS.filter(s => !s.work), { idBase: '0de30000', now: NOW }); // session ids are UUIDs
const work = setUpSessions(workDir, SESSIONS.filter(s => s.work), { idBase: '0de31111', now: NOW });
for (const s of SESSIONS) s.dir = s.work ? workDir : claudeDir;
const byId = { ...mine.byId, ...work.byId }, sleepers = [...mine.sleepers, ...work.sleepers];
// Where Claude Code keeps each session's scratchpad and background output: <base>/<project>/<session>/.
const SCRATCH = join(DEMO, 'tmp');
const scratchOf = s => join(SCRATCH, s.cwd.replace(/[^A-Za-z0-9]/g, '-'), s.id);
const { write, prompt, use, begin, result, reply, turnEnd, task } = transcriptWriter();

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
const register = s => writeFileSync(join(s.dir, 'sessions', `${s.pid}.json`), JSON.stringify({ pid: s.pid, sessionId: s.id, cwd: s.cwd, name: s.name, nameSource: s.named ? 'user' : 'derived', kind: 'interactive', status: s.open ? 'busy' : 'idle', startedAt: NOW - 30 * MIN }));
for (const s of SESSIONS) register(s);

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
writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: { [ANALYTICS]: 'demo/analytics' }, pollMs: 400, gitPollMs: 3000, deployPollMs: 4000, prPollMs: 4000, permissionGuessSec: 3600, terminal: 'iTerm', accounts: { [claudeDir]: 'personal', [workDir]: 'work' } }));
const state = join(root, 'state');
for (const d of ['pending', 'answers', 'mods', 'helper-replies', 'command-results', 'asides']) mkdirSync(join(state, d), { recursive: true });
// ✨ Helper on, with suggested names and the animals' lines (its Haiku calls are the stand-in mods' below).
writeFileSync(join(state, 'helper.json'), JSON.stringify({ on: true, uses: { names: true, lines: true }, dailyLimit: 200, consentedAt: NOW - 2 * 60 * MIN }));
// Each session's mod: it says it is listening, with its cost, the plan's limits and its working line.
const PLAN = [{ kind: 'five_hour', percentUsed: 38, resetsAt: iso(NOW + 2.2 * 3_600_000) }, { kind: 'seven_day', percentUsed: 76, resetsAt: iso(NOW + 3 * 86_400_000) }]; // the personal silo's tag is amber
const WORK_PLAN = [{ kind: 'five_hour', percentUsed: 61, resetsAt: iso(NOW + 1.4 * 3_600_000) }, { kind: 'seven_day', percentUsed: 42, resetsAt: iso(NOW + 5 * 86_400_000) }];
const offers = { [Q.ask]: { kind: 'question', toolUseId: Q.ask, sessionId: Q.id, createdAt: at(1), questions: [QUESTION] }, [P.ask]: { kind: 'permission', toolUseId: P.ask, sessionId: P.id, tool: 'Bash', summary: 'ssh prod ./deploy.sh --webhooks', createdAt: at(0.8), expiresAt: NOW + 3_600_000 } };
for (const [id, o] of Object.entries(offers)) writeFileSync(join(state, 'pending', `${id}.json`), JSON.stringify(o));
const thinking = new Set(['demo-cart']);
function beacons() {
  for (const s of SESSIONS) {
    if (s.key === 'demo-spike') continue; // long gone
    s.cost += s.open ? 0.004 : 0;
    const working = Boolean(s.open) || thinking.has(s.key);
    writeFileSync(join(state, 'mods', `${s.id}.json`), JSON.stringify({ sessionId: s.id, version: '0.9.1', at: Date.now(), usage: { costUsd: s.cost, contextPercent: Math.round((s.ctx / 200_000) * 100), rateLimits: s.work ? WORK_PLAN : PLAN }, ...(working ? { turn: { startedAt: s.turnAt, word: s.word ?? 'Working', mode: thinking.has(s.key) ? 'thinking' : 'tool-use' } } : {}), ...(s.effort ? { effort: s.effort } : {}) }));
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
// What the stand-in Haiku answers: a name for ✨, and the animals' lines (kind|when|text: nameless, as the real ones are).
const NAMES = { 'demo-metrics': 'Funnel dashboard', 'demo-scratch': 'Data scratchpad', 'demo-flow': 'One-page checkout' };
const LINES = {
  cow: ['idle|Moo. Another deploy, another rainbow.', 'idle|The checkout field looks tasty today.', 'deployOk|Moo ♥ A rainbow! Someone shipped.'],
  goat: ['idle|I could eat that whole task board.', 'idle|Somebody hide the hats.'],
  sheepdog: ['idle|Seven farmers at work. I counted.', 'idle|Woof! The porch needs you.'],
  ostrich: ['idle|I outran the Linear cart again.'],
  lion: ['idle|Rain on the mobile field. I stay dry.'],
  tiger: ['idle|Waiting on the porch is a nap too.'],
  duck: ['idle|Quack. Fine pond for a code review.', 'harvest|Quack! A field just got harvested.'],
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
    for (const c of inbox('commands', s.id)) { // a model or effort switch, as /model would say it; a rename; Esc
      setTimeout(() => {
        const text = { model: 'Set model to `Sonnet 5.5` and saved as your default for new sessions', effort: `Set effort level to ${c.args}`, compact: 'Compacted. The conversation so far is now a summary.', 'reload-plugins': 'Reloaded: 3 plugins · 6 skills · 1 agent · 2 MCP servers', rename: `Session renamed to ${c.args}`, stop: 'Stopped.' }[c.command] ?? 'Done';
        if (c.command === 'rename') { s.name = c.args; s.named = true; register(s); } // Claude Code's own name for it, as /rename leaves it
        if (c.command === 'stop') { // Esc: the turn ends where it was, and the session waits for you
          paused.add(s.key); thinking.delete(s.key);
          if (s.open) result(s, s.open, { error: true, text: 'Interrupted by user' });
          s.open = null; s.openBash = null;
          write(s, prompt(s, '[Request interrupted by user]'));
          turnEnd(s);
        }
        if (c.command === 'model') s.model = SONNET;
        if (c.command === 'effort') s.effort = c.args;
        if (c.command === 'compact') { // a harvest on the farm: the field starts again from seed
          write(s, { type: 'system', subtype: 'compact_boundary', timestamp: iso(Date.now()), compactMetadata: { trigger: 'manual', preTokens: s.ctx } });
          s.ctx = 18_000;
        }
        writeFileSync(join(state, 'command-results', `${s.id}.${c.id}.json`), JSON.stringify({ id: c.id, sessionId: s.id, command: c.command, args: c.args, ok: true, text, at: Date.now() }));
      }, 1200);
    }
    for (const h of inbox('helper', s.id)) { // ✨ Helper: Haiku, through this session's own Claude Code (made up here)
      const text = h.kind === 'name' ? (NAMES[s.key] ?? 'Checkout fixes') : (h.cast ?? []).flatMap(c => (LINES[c.kind] ?? []).map(l => `${c.kind}|${l}`)).join('\n');
      setTimeout(() => writeFileSync(join(state, 'helper-replies', `${s.id}.${h.id}.json`), JSON.stringify({ id: h.id, sessionId: s.id, kind: h.kind, ok: true, text, at: Date.now() })), h.kind === 'name' ? 1400 : 900);
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

/* ---------- the browser, its cursor and what each scene says ---------- */

// This process also records the screen, which the collector's own CPU figure would count: the panel shows the
// collector's usual share instead (all its other numbers are made up too).
const ownCpu = process.cpuUsage.bind(process);
process.cpuUsage = since => { const u = ownCpu(since); return since ? { user: u.user * 0.02, system: u.system * 0.02 } : u; };
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
const browser = launchBrowser(temp);
const { send, js, until, shot } = browser;
const marks = []; // each chapter: [number, title, when it starts (wall seconds)]
// For working on the tour: DEMO_ONLY=3,5 plays just those chapters; DEMO_SCENES=<folder> saves a picture at the end of each scene.
const ONLY = process.env.DEMO_ONLY ? new Set(process.env.DEMO_ONLY.split(',').map(Number)) : null;
const want = n => !ONLY || ONLY.has(n);
const SCENES = process.env.DEMO_SCENES ? resolve(process.env.DEMO_SCENES) : null;
let ui = null;
try {
  await browser.connect(VW, VH);
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
  // The page as someone would have it: the farm by day, its panel open, the sidebar shut until a farmer is picked.
  const prefs = { 'tracker-view': 'farm', 'tracker-world': 'farm', 'tracker-farm-tab': 'agent', 'tracker-closed-groups': '["idle","stale"]', 'tracker-theme': 'dark', 'tracker-farm-side': 'closed', 'tracker-bell': 'off',
    'tracker-world:farm:sky': 'day', 'tracker-world:farm:zoom': '1', 'tracker-world:farm:panel': 'open', 'tracker-world:farm:bubbles': 'on', 'tracker-world:farm:resting': 'shown', 'tracker-world:farm:animals': 'on', 'tracker-world:farm:migrated': '1' };
  await js(`(() => { localStorage.clear(); for (const [k, v] of ${JSON.stringify(Object.entries(prefs))}) localStorage.setItem(k, v); })()`);
  await send('Page.reload');
  await browser.untilIn('/world/', "document.querySelectorAll('.px-tag').length >= 10", 20000);
  await sleep(3000); // the repos, deploys and pull requests come in

  ui = await stage(browser, VW, VH);
  const { w, wjs, wuntil, moveTo, q, byText, point, click, clickAt, type, enter, esc, say, raise, spot } = ui;
  const hold = sleep;
  const row = key => q(`#list .row[data-id="${byId[key].id}"]`);
  // The world's frame on the page, and points in it: a point of the farm (its world pixels), a farmer (its sprite, just under its name tag).
  const frameAt = () => js("(f => f ? (r => [r.left + f.clientLeft, r.top + f.clientTop])(f.getBoundingClientRect()) : null)(document.querySelector('iframe[src*=\"/world/\"]'))");
  const onPage = async p => { const f = await frameAt(); return p && f ? [p[0] + f[0], p[1] + f[1]] : null; };
  const farmAt = async (x, y) => onPage(await wjs(`(() => { const c = document.querySelector('#farm canvas'); if (!c) return null; const [pl, pt] = c.dataset.pad.split(',').map(Number), r = c.getBoundingClientRect(), cs = r.width / Number(c.dataset.ew); return [Math.round(r.left + (${x} + pl) * cs), Math.round(r.top + (${y} + pt) * cs)]; })()`));
  const farmer = async key => onPage(await wjs(`(() => { const t = document.querySelector('[data-farmer="${byId[key].id}"]'), c = document.querySelector('#farm canvas'); if (!t || !c) return null; const r = t.getBoundingClientRect(), cs = c.getBoundingClientRect().width / Number(c.dataset.ew); return [Math.round(r.left + r.width / 2), Math.round(r.bottom + 10 * cs)]; })()`));
  const animal = async kind => JSON.parse((await wjs(`JSON.stringify((window.Agentville.animalsNow?.() ?? []).find(a => a.kind === ${JSON.stringify(kind)} && !a.away) ?? null)`)) ?? 'null');
  // After a world raises part of the page, its action buttons ignore clicks for a moment: wait that out.
  const settle = () => until('!document.documentElement.dataset.guard', 2500);
  const setSelect = (sel, value) => js(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const menuOpen = () => wjs("document.querySelector('[data-farm-menu]')?.getAttribute('aria-expanded') === 'true'");
  /** An item in the world's Menu, opened as a person would. */
  async function menu(sel, ms = 500) {
    if (!(await menuOpen())) { await click(w(q('[data-farm-menu]')), 650); await wuntil("document.querySelector('[data-farm-menu]')?.getAttribute('aria-expanded') === 'true'", 2000); await hold(450); }
    await click(w(q(sel)), ms);
    await hold(350); // the page takes a world's buttons at most every 250 ms
  }
  const shutMenu = async () => { if (await menuOpen()) { await click(w(q('[data-farm-menu]')), 450); await hold(300); } };
  const named = key => `document.querySelector('#fs-head .fs-name')?.textContent === ${JSON.stringify(byId[key].name)}`;
  const sideOpen = async () => {
    if ((await js("document.getElementById('main').dataset.side")) === 'open') return;
    await menu('[data-farm-nav="side"]');
    await until("document.getElementById('main').dataset.side === 'open'", 3000); await hold(500);
  };
  /**
   * A farmer, clicked on the farm: the sidebar opens on it. A speech bubble over it would open its
   * conversation instead: then that closes, and the click goes lower on the sprite. Failing that, the
   * sidebar's own list.
   */
  async function pickFarmer(key) {
    for (const lower of [0, 9]) {
      const p = await farmer(key);
      if (p) { const at = [p[0], p[1] + lower]; await moveTo(at, lower ? 300 : 750); await clickAt(at); }
      if (await until(`${named(key)} || document.getElementById('convo').open`, 2500) && !(await js("document.getElementById('convo').open"))) { await hold(450); return; }
      if (await js("document.getElementById('convo').open")) { await click(q('[data-convo-close]'), 400); await until("!document.getElementById('convo').open", 1500); }
    }
    await pickInSidebar(key);
  }
  // The find box keeps what was last typed in it: empty it first.
  const clearFind = () => js("(e => { if (!e) return; e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); e.focus(); })(document.getElementById('fs-find'))");
  /** An agent, picked from the sidebar's list of every agent. */
  async function pickInSidebar(key) {
    await sideOpen();
    if (await js(named(key))) return;
    await settle(); await click(q('#fs-switch'), 600);
    await until("!!document.querySelector('#fs-find')", 2500); await click(q('#fs-find'), 300);
    await clearFind();
    await type(byId[key].name.slice(0, 5), 70);
    await until(`!!document.querySelector('#fs-find-list .fs-pick[data-pick-agent="${byId[key].id}"]')`, 2500); await hold(300);
    // The list is drawn again as the find box loses focus to the press, so a real click can land between two
    // drawings: the cursor goes there and ripples, and the item is clicked as itself.
    const pick = q(`#fs-find-list .fs-pick[data-pick-agent="${byId[key].id}"]`);
    const at = await point(pick, 500);
    if (at) { await js(`window.__demo.ripple(${at[0]}, ${at[1]})`); await js(`${pick}?.click()`); }
    await until(named(key), 3000); await hold(450);
  }
  /** A button in a pane that is drawn again as things change: the cursor goes there and ripples, and it is pressed as itself. */
  async function press(target, ms = 500) {
    const at = await point(target, ms);
    if (at) { await js(`window.__demo.ripple(${at[0]}, ${at[1]})`); await js(`${target}?.click()`); await hold(250); }
    return Boolean(at);
  }
  /** ⚡ Send now on the held message that says `word` (others may be waiting under the box too). */
  async function heldNow(word) {
    const now = `[...document.querySelectorAll('#fs-compose li.held')].find(li => li.textContent.includes(${JSON.stringify(word)}))?.querySelector('[data-held-now]')`;
    if (await until(`!!${now}`, 2500)) { await settle(); await press(now, 500); }
  }
  const sideTab = async t => { await click(q(`#tab-${t}`), 550); await hold(500); };
  /** A building's dialog: opened from the farm, read, closed. */
  async function building(x, y, ms = 2200) {
    await click(spot(await farmAt(x, y)), 700);
    await wuntil("document.querySelector('dialog.px-dlg')?.open", 3000); await hold(ms);
    await click(w(q('[data-farm-dlg-close]')), 450);
    if (!(await wuntil("!document.querySelector('dialog.px-dlg')?.open", 1500))) await wjs("document.querySelector('dialog.px-dlg')?.close()");
  }
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
  async function selectText(scope, text) { // a passage, selected with the mouse as you would
    const e = byText(`${scope} li, ${scope} p, ${scope} .l`, text);
    const ends = await js(`(() => { const e = ${e}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(e); const b = [...r.getClientRects()]; const a = b[0], z = b.at(-1); return a ? [[Math.round(a.left + 2), Math.round(a.top + a.height / 2)], [Math.round(z.right - 2), Math.round(z.top + z.height / 2)]] : null; })()`);
    if (!ends) return;
    await moveTo(ends[0], 700);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ends[0][0], y: ends[0][1], button: 'left', clickCount: 1 });
    for (let i = 1; i <= 12; i++) { const p = [ends[0][0] + ((ends[1][0] - ends[0][0]) * i) / 12, ends[0][1] + ((ends[1][1] - ends[0][1]) * i) / 12]; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1 }); await js(`window.__demo.move(${p[0]}, ${p[1]}, 50)`); await sleep(55); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ends[1][0], y: ends[1][1], button: 'left', clickCount: 1 });
    ui.cursor = ends[1];
  }
  /** A zoom with ⌘ + the wheel at a point, as a trackpad does; `steps` < 0 zooms out. */
  async function wheel(at, steps) {
    await moveTo(at, 600);
    for (let i = 0; i < Math.abs(steps); i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at[0], y: at[1], deltaX: 0, deltaY: steps > 0 ? -120 : 120, modifiers: 4 }); await sleep(400); }
  }
  /** A drag across the page, as the mouse does it. */
  async function drag(from, by) {
    await moveTo(from, 400);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', clickCount: 1 });
    for (let i = 1; i <= 16; i++) { const p = [from[0] + (by[0] * i) / 16, from[1] + (by[1] * i) / 16]; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1 }); await js(`window.__demo.move(${p[0]}, ${p[1]}, 40)`); await sleep(45); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from[0] + by[0], y: from[1] + by[1], button: 'left', clickCount: 1 });
    ui.cursor = [from[0] + by[0], from[1] + by[1]];
  }
  /** A clean picture of the page, for docs/: no cursor. */
  async function still(name) {
    if (!STILLS) return;
    await js('window.__demo.hide(true)'); await sleep(700);
    writeFileSync(join(STILLS, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    await js('window.__demo.hide(false)');
  }
  // What each scene says goes to the captions file. While working on the tour, a picture at each scene's end.
  let sceneN = 0, lastScene = null;
  async function snapScene() {
    if (!SCENES || !lastScene) return;
    mkdirSync(SCENES, { recursive: true });
    writeFileSync(join(SCENES, `${String(++sceneN).padStart(3, '0')}-${lastScene.replace(/[^a-z0-9]+/gi, '-').slice(0, 48)}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  }
  const scene = async (title, sub) => { await snapScene(); say(title, sub); lastScene = title; };
  const chapter = async (n, title) => { await snapScene(); lastScene = null; say(null); marks.push([n, title, Date.now() / 1000]); await hold(500); };

  await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
  const tick = setInterval(direct, 5200);
  timers.push(tick);

  // ----- the opening, then 1. the farm -----
  if (want(1)) {
    await scene('Agentville', 'A local dashboard for every Claude Code and Codex session on your Mac. Here it is a farm: each agent is a farmer.');
    await moveTo([VW * 0.62, VH * 0.4], 1200); await hold(4400);
    await chapter(1, 'The farm');
    await still('farm');
    await scene('Each agent is a farmer, and each repo is a field', 'Subagents, background jobs and Codex sessions show up here too.');
    await moveTo([VW * 0.55, VH * 0.52], 900); await hold(3200);
    await scene('The panel in the corner', "It counts agents by what they need, shows their memory and CPU, and each Claude account's 5-hour and weekly limits.");
    await point(w(q('[data-farm-state="waiting"]')), 700); await hold(1500);
    await point(w(q('.px-gauges')), 600); await hold(2600);
    await scene('Agents that need you wait on the porch', "A red ! is a question or a permission, a scroll is a plan to approve, and a basket means it has finished: it's your turn.");
    for (const k of ['demo-deploy', 'demo-cache', 'demo-notes']) { await point(spot(await farmer(k)), 700); await hold(1700); }
    await scene("The farmer's tool shows what the agent is doing", 'A hoe means it is editing and a magnifier means it is running tests. The board beside it is its task list.');
    await point(spot(await farmer('demo-cart')), 800); await hold(2100);
    await point(spot(await farmer('demo-checkout')), 700); await hold(2300);
    await scene('Crops grow as the context fills', 'When the session is compacted, its field is harvested and planted again.');
    await point(spot(await farmer('demo-metrics')), 800); await hold(1400);
    write(M, { type: 'system', subtype: 'compact_boundary', timestamp: iso(Date.now()), compactMetadata: { trigger: 'auto', preTokens: 182_000 } });
    M.ctx = 16_000;
    reply(M, 'Picking up from the summary: the funnel chart is next.');
    await hold(3600);
    await scene('The weather shows the last deploy', 'Rain on a field whose deploy failed, a rainbow on one that passed, and a windmill while one runs.');
    for (const f of ['mobile', 'docs', 'analytics']) { await point(w(q(`[data-farm-field$="${f}"]`)), 750); await hold(1700); }
    await scene('A silo for each Claude account', "Its grain is the account's weekly usage. The tag at its foot turns amber at 70% and red at 90%.");
    await point(spot(await farmAt(102, 44)), 800); await hold(2400);
    await point(spot(await farmAt(18, 44)), 700); await hold(2400);
    await scene('A pigeon means one agent wrote to another', 'The message also shows in both conversations.');
    const [ca, cb] = [await farmer('demo-cart'), await farmer('demo-checkout')];
    if (ca && cb) await wheel([Math.round((ca[0] + cb[0]) / 2), Math.round((ca[1] + cb[1]) / 2) - 30], 3);
    await hold(500);
    use(W, 'SendMessage', { to: 'checkout-api', summary: 'Cart calls POST /orders', message: 'The cart drawer now calls POST /orders with an idempotency key. Is the endpoint ready?' });
    await hold(4400);
    await menu('[data-farm-zoom="0"]'); await shutMenu(); await hold(600);
    await scene('Each MCP server has its own cart', 'When an agent calls the server, its cart drives to that farmer and waits there until the call ends.');
    await point(spot(await farmAt(372, 84)), 800); await hold(1400); // the carts, waiting at the lane's end
    result(O, O.open);
    begin(O, 'mcp__claude_ai_Linear__save_issue', { title: 'Rotate the staging TLS certificate', team: 'Infra' });
    if (await wuntil(`!!${byText('.px-mover', 'Linear')}`, 6000)) for (let i = 0; i < 6; i++) await point(w(byText('.px-mover', 'Linear')), 850);
    await hold(1800);
    await scene('Web fetches and searches send a cart to town', 'A pump is a background job. A farmer in a hammock is a session that will wake itself up with /loop.');
    await point(w(byText('.px-mover', 'docs.github.com')), 700); await hold(1900);
    result(O, O.open); begin(O, 'Bash', { command: 'terraform plan -out staging.tfplan', description: 'Plan the staging stack' }); // the Linear call is done: its cart heads back
    await point(spot(await farmer('demo-ops')), 700); await hold(1800);
    await point(spot(await farmAt(97, 198)), 800); await hold(2000);
    await scene('Click a building to see more', 'The stall lists pull requests, the notice board shows CLAUDE.md and memory, and the henhouse the subagents.');
    await building(298, 64, 2300);
    await building(119, 70, 2100);
    await building(53, 116, 2100);
  }

  // ----- 2. day, night and seasons -----
  if (want(2)) {
    await chapter(2, 'Day, night and seasons');
    await scene('Everything else is in the Menu', "The dashboard's buttons, the farm's switches and zoom, in one place at the top right.");
    await click(w(q('[data-farm-menu]')), 800); await hold(2800);
    await scene('The sky follows your clock', 'Or hold it at day or night: windows and lamps light up, and fireflies come out.');
    await menu('[data-farm-sky]'); await hold(2300); // the sky goes live → day → night: held at day, one more is night
    await shutMenu(); await hold(2600);
    await still('farm-night');
    if (STILLS && process.env.STILLS_ONLY) throw STILLS_DONE;
    await scene('The season follows your 5-hour limit', 'Spring while it is fresh, winter when it is nearly used up. Or hold a season with the Season switch.');
    await menu('[data-farm-sky]'); await click(w(q('[data-farm-sky]')), 350); await hold(600); // live, then held at day again
    for (let i = 0; i < 4; i++) { await click(w(q('[data-farm-season]')), 500); await hold(1700); } // spring, summer, autumn, winter
    await click(w(q('[data-farm-season]')), 500); await hold(500); // live again
    await shutMenu(); await hold(600);
    await scene('Zoom in and look around', 'Drag the view, and use the minimap while you are zoomed in. Help explains every symbol on the farm.');
    const mid = [Math.round(VW * 0.5), Math.round(VH * 0.45)];
    await wheel(mid, 2);
    await drag(mid, [192, 112]);
    await point(w(q('.px-mini')), 600); await hold(1500);
    await menu('[data-farm-zoom="0"]'); await hold(400);
    await menu('[data-farm-help]');
    await wuntil("document.querySelector('dialog.px-help:not(.px-dlg)')?.open", 3000); await hold(3000);
    await click(w(q('[data-farm-help-close]')), 500); await hold(400);
  }

  // ----- 3. the animals -----
  if (want(3)) {
    await chapter(3, 'The animals');
    await scene('Animals live on the farm, just for fun', 'Cows, goats, a sheepdog, an ostrich, a lion, a tiger, and a duck family on the pond. They never stand for anything.');
    for (const k of ['cow', 'goat', 'sheepdog', 'ostrich', 'lion']) { const a = await animal(k); if (a) { await point(spot(await farmAt(a.x, a.y - 4)), 650); await hold(1200); } }
    await scene('Click one to pet or feed it', 'A farmer with nothing to do walks over and does it.');
    const cow = await animal('cow');
    if (cow) {
      await click(spot(await farmAt(cow.x, cow.y - 4)), 700);
      await wuntil("!!document.querySelector('.px-animal-menu')", 2500); await hold(1600);
      await click(w(q('.px-animal-menu [data-animal-act="0"]')), 600);
      await wuntil("[...document.querySelectorAll('.px-animal-say')].some(b => !b.hidden)", 15000); await hold(2400);
    }
    await scene('The ducks on the pond', 'Click the pond to feed them bread, or quack back.');
    await click(spot(await farmAt(42, 210)), 700);
    await wuntil("!!document.querySelector('.px-animal-menu')", 2500); await hold(1400);
    await click(w(q('.px-animal-menu [data-animal-act="0"]')), 600); await hold(3600);
    await scene("With ✨ Helper's Animal lines on, Haiku writes what they say", 'Fresh lines about what is happening on the farm, never naming anyone, written through one of your own sessions.');
    await wuntil('(window.Agentville.freshLinesNow?.() ?? []).length > 0', 20000);
    const bubble = "[...document.querySelectorAll('.px-animal-say')].find(b => !b.hidden)";
    for (const end = Date.now() + 15000; Date.now() < end;) { // each animal says its fresh lines first, when its turn to talk comes
      if (await wuntil(`!!${bubble}`, 3000)) { await point(w(bubble), 700); await hold(2600); }
    }
  }

  // ----- 4. the sidebar -----
  if (want(4)) {
    await chapter(4, 'The sidebar');
    await scene('Click a farmer to open its sidebar', 'What it is doing now, its chat with you, and one box to write in.');
    await pickFarmer('demo-checkout');
    await point(q('#fs-now .workline'), 700); await hold(1500);
    await point(q('#farm-agent .fs-latest'), 600); await hold(1600);
    await point(q('#fs-compose'), 600); await hold(1300);
    await scene('Pick any agent from the list', 'Those that need you come first. Type to find one, and ‹ › step through them in that order.');
    await settle(); await click(q('#fs-switch'), 600);
    await until("!!document.querySelector('#fs-find')", 2500); await click(q('#fs-find'), 300); await clearFind(); await hold(1200);
    await type('cart', 90); await hold(1600);
    await esc(); await hold(400);
    await click(q('[data-fs-step="1"]'), 600); await hold(1400);
    await click(q('[data-fs-step="-1"]'), 500); await hold(900);
    await pickInSidebar('demo-checkout');
    await scene('Answer the others without leaving this one', 'A card for each agent waiting on you: allow a command, pick an option or say Yes, right here.');
    if ((await js("document.querySelector('#fs-head .fs-queue-toggle')?.getAttribute('aria-expanded')")) === 'false') await click(q('#fs-head .fs-queue-toggle'), 500);
    await point(q('#fs-head .fs-queue'), 600); await hold(1500);
    await settle(); await click(q('#fs-head .fs-card [data-fs-answer="Postgres"]'), 700); // orders-db's question, answered in place
    await until('!document.querySelector(\'#fs-head [data-fs-answer="Postgres"]\')', 5000); await hold(1800);
    await scene('Its own question sits above the tabs', 'Fold it to one line to read the whole chat first. A new question always comes unfolded.');
    await pickInSidebar('demo-deploy');
    await point(q('#fs-ask-box .fs-ask'), 600); await hold(1600);
    await click(q('#fs-ask-box [data-fs-ask-fold]'), 600); await hold(1900);
    await click(q('#fs-ask-box [data-fs-ask-fold]'), 600); await hold(1200);
    await scene("Always allow uses Claude Code's own choices", 'For example a rule for this project, or access to a folder.');
    await settle(); await click(q('#ask-always'), 600);
    await until("!!document.querySelector('#fs-ask-box [data-always-pick]')", 6000);
    await point(q('#fs-ask-box .always-opts'), 600); await hold(2400);
    await settle(); await click(q('#fs-ask-box [data-always-pick="0"]'), 600);
    await wuntil(`document.querySelector('[data-farmer="${P.id}"]')?.className.includes('st-working')`, 6000); await hold(1500);
  }

  // ----- 5. messaging -----
  if (want(5)) {
    await chapter(5, 'Messaging');
    await pickInSidebar('demo-checkout');
    await scene('Message it like a chat', 'It arrives as your own prompt. Attach pictures and files, or a folder by its path.');
    browser.chooserFiles = [join(DESIGN, 'checkout.png')];
    await settle(); await click(q('#msg-attach'), 600);
    await until("!!document.querySelector('#fs-compose .thumb')", 4000); await hold(700);
    await click(q('#msg-folder'), 600);
    await until("!!document.querySelector('#fs-compose .thumb-folder')", 4000); await hold(700);
    await click(q('#msg-text'), 500);
    await type('Here is the new design. Match the checkout page to it.');
    await hold(300); await enter(); await hold(900);
    await scene('A busy agent gets it when its turn ends', 'Until then it waits under the box, where you can remove it, edit it, or ⚡ send it now.');
    await until("!!document.querySelector('#fs-compose li.held')", 5000);
    await point(q('#fs-compose li.held'), 600); await hold(2600);
    await settle(); await press(q('#fs-compose [data-held-now]'), 600);
    await until("!document.querySelector('#fs-compose li.held')", 6000); await hold(2800); // it goes at once, and its reply follows
    await scene('Ask a side question', "It answers from its conversation without stopping, and nothing is added to it: Claude Code's /btw.");
    await click(q('[data-fs-mode="btw"]'), 600); await hold(500);
    await click(q('#aside-text'), 500);
    await type('Which tests cover the idempotency key?');
    await hold(300); await enter();
    await until("!!document.querySelector('#farm-agent .aside .aside-a.md')", 8000);
    await point(q('#farm-agent .aside'), 600); await hold(2600);
    await scene('Keep notes for later', 'Things you may want to tell it, or not. Put one in the box to edit, or send it as it is.');
    await click(q('[data-fs-mode="note"]'), 600); await hold(400);
    await click(q('#note-text'), 500);
    await type('Ask about the refund flow once checkout ships.'); await hold(300);
    await settle(); await click(q('#note-add'), 600);
    await until("!!document.querySelector('li.note')", 4000); await hold(2200);
    await click(q('[data-fs-mode="message"]'), 500); await hold(500);
  }

  // ----- 6. broadcast -----
  if (want(6)) {
    await chapter(6, 'Broadcast');
    await scene('📣 Broadcast one message to several agents', 'Tick the ones you want, or pick a group: all of them, those that need you, or those at work.');
    await menu('[data-farm-nav="broadcast"]');
    await until("document.getElementById('broadcast').open", 3000); await raise(); await hold(1500);
    await settle(); await click(q('[data-bc-pick="working"]'), 600); await hold(1600);
    await click(q('#bc-text'), 500);
    await type('Pause before you deploy: the release freeze starts at five.', 34); await hold(500);
    await scene('Each gets it as its own box would send it', 'An agent in the middle of a turn gets it when the turn ends, and the list says which.');
    await settle(); await click(q('#bc-send'), 600);
    await until("!!document.querySelector('#bc-results .msg-ok')", 6000);
    await point(q('#bc-results'), 600); await hold(3200);
    await click(q('[data-bc-close]'), 500); await hold(500);
  }

  // ----- 7. naming and steering -----
  if (want(7)) {
    await chapter(7, 'Naming and steering');
    await pickInSidebar('demo-scratch');
    await scene('Rename a session yourself', '✎ opens its name. Rename runs /rename in the session, as if you typed it there.');
    await click(q('#fs-head .name-pen'), 600);
    await until("!!document.getElementById('name-edit')", 2000); await hold(600);
    await js("(e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); e.focus(); })(document.getElementById('name-edit'))");
    await type('funnel-notes', 80); await hold(500);
    await settle(); await click(q('[data-name-save]'), 600);
    await until("document.querySelector('#fs-head .fs-name')?.textContent === 'funnel-notes'", 6000); await hold(1800);
    await scene('Or let Haiku suggest one', "✨ asks a small Claude model, through the session's own Claude Code, for a short name from what it is working on.");
    await pickInSidebar('demo-metrics');
    await settle(); await click(q('#fs-head [data-name-suggest]'), 600);
    await until("!!document.querySelector('#fs-head .name-offer [data-name-rename]')", 8000);
    await point(q('#fs-head .name-offer'), 600); await hold(2200);
    await settle(); await click(q('#fs-head .name-offer [data-name-rename]'), 600);
    await until("/funnel/i.test(document.querySelector('#fs-head .fs-name')?.textContent ?? '')", 6000); await hold(1600);
    await scene('Change its model or effort, or compact it', 'The dashboard runs /model, /effort or /compact inside the session.');
    await pickInSidebar('demo-checkout');
    await click(q('#fs-session'), 600);
    await until("!!document.querySelector('#fs-effort')", 2500); await point(q('#fs-effort'), 600); await hold(900);
    await setSelect('#fs-effort', 'high');
    await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1300);
    await settle(); await click(q('#confirm-yes'), 600);
    await until("!!document.querySelector('#fs-head .set-note')", 6000); await point(q('#fs-head .set-note'), 500); await hold(1400);
    await click(q('#fs-session'), 600);
    await until("!!document.querySelector('#fs-pop [data-compact]')", 2500); await click(q('#fs-pop [data-compact]'), 600);
    await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1200);
    await settle(); await click(q('#confirm-yes'), 600); await hold(2400);
    await scene('Stop it in the middle of a turn', '■ Stop ends the turn as Esc does in its terminal, and the session waits for you.');
    await pickInSidebar('demo-cart');
    await point(q('#fs-now .workline'), 600); await hold(900);
    await settle(); await click(q('#fs-now [data-stop-turn]'), 600);
    await wuntil(`!document.querySelector('[data-farmer="${W.id}"]')?.className.includes('st-working')`, 8000); await hold(2000);
    await scene('Restart it in another mode, or on your other account', 'Restart in resumes it in plan, accept-edits or bypass mode, or moves it to another of your Claude accounts.');
    await pickInSidebar('demo-checkout');
    await click(q('#fs-session'), 600);
    await until("!!document.querySelector('#fs-mode')", 2500); await point(q('#fs-mode'), 600); await hold(1200);
    await setSelect('#fs-mode', 'account:work');
    await until("document.getElementById('confirm').open", 3000); await raise(); await hold(2600);
    await click(q('#confirm-no'), 500); await hold(500);
  }

  // ----- 8. following the work -----
  if (want(8)) {
    await chapter(8, 'Following the work');
    paused.add('demo-checkout'); // it keeps its test run going while the tour looks at it
    if (!C.openBash) { if (C.open) result(C, C.open); begin(C, 'Bash', { command: 'npm test -- checkout', description: 'Run the checkout tests' }); }
    await pickInSidebar('demo-checkout');
    await scene('The Activity tab lists every step', 'How long each one took and whether it worked. Filter it to commands, edits, reads or failures.');
    await sideTab('activity'); await hold(1500);
    await click(q('[data-fs-steps="edit"]'), 500); await hold(1400);
    await click(q('[data-fs-steps="cmd"]'), 500); await hold(1400);
    await click(q('[data-fs-steps="all"]'), 500); await hold(600);
    await scene('Each subagent gets a card', 'Its task, its current step and what it last said. Open it to follow along.');
    await sideTab('subagents'); await hold(1200);
    await click(`${byText('#farm-subagents .sub-card', 'Explore')}?.querySelector('[data-child]')`, 600);
    await until("!!document.querySelector('#farm-subagents .sub-prompt')", 5000); await hold(3000);
    await scene('Its commands, as they run', 'How long each one has run, and the CPU and memory it uses, counting everything it started.');
    await sideTab('agent');
    if ((await js("document.querySelector('#fs-now [data-fs-shells]')?.getAttribute('aria-expanded')")) === 'false') await click(q('#fs-now [data-fs-shells]'), 600);
    await until("!!document.querySelector('#fs-now .shell-row')", 6000);
    await point(q('#fs-now .shell-row'), 600); await hold(2400);
    await scene("Output shows a background command's log", 'It keeps updating while the window is open.');
    await click(q(`#fs-now [data-shell-output="${DEV.pid}"]`), 600);
    await until("document.getElementById('shell-dlg').open", 3000); await raise();
    const fast = setInterval(devLog, 700);
    await hold(5000);
    clearInterval(fast);
    await click(q('[data-shell-close]'), 500); await hold(400);
    await scene('Stop ends a command', 'After you confirm, it stops with everything it started, and the session sees it end.');
    await settle(); await click(q(`#fs-now [data-shell-stop="${DEV.pid}"]`), 600);
    await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1400);
    await settle(); await click(q('#confirm-yes'), 600);
    await until(`!document.querySelector('#fs-now [data-shell-stop="${DEV.pid}"]')`, 6000); await hold(1800);
    await scene('The diary is a log of the farm', 'Answers, messages, harvests and deploys, newest first.');
    await click(q('#fs-diary'), 600); await hold(3000);
    await click(q('#diary-back'), 500); await hold(500);
    paused.delete('demo-checkout');
  }

  // ----- 9. opening files -----
  if (want(9)) {
    await chapter(9, 'Opening files');
    await pickInSidebar('demo-checkout');
    await scene("The Files tab shows the agent's folder", 'Its scratchpad and memory too. Git letters and dots mark the files it changed or read.');
    await sideTab('files'); await hold(3000);
    await scene('Files open in a window over the farm', 'Markdown is rendered and code has line numbers. If the agent changes the file, the window updates.');
    await openTreeFile('docs/plan.md');
    await until("!!document.getElementById('reader-body')?.textContent.includes('idempotent')", 6000); await hold(2400);
    await scene('Quote part of a file in your reply', 'Select a passage and click Quote. The agent gets your reply with the quoted lines.');
    await selectText('#reader-body', 'idempotent');
    await hold(500);
    await click(q('#reader-quote'), 600); await hold(500);
    await type('Use the cart id as the key.');
    await hold(400);
    await click(q('#reader-send'), 600); await hold(2200);
    await closeFile();
    await sideTab('agent'); await heldNow('plan.md'); await hold(1200); // busy: sent now
    await sideTab('files');
    await scene('Pictures, PDFs and videos open as they are', "A picture fits the window, a PDF opens in the browser's viewer, and a video plays.");
    await openTreeFile('design/checkout.png'); await hold(2800); await closeFile();
    await openTreeFile('docs/release-2.4.pdf'); await hold(3200); await closeFile();
    await openTreeFile('design/walkthrough.mp4');
    await until("!!document.querySelector('#reader-body video')", 4000);
    await js("document.querySelector('#reader-body video').play()"); await hold(3600); await closeFile();
    await scene('Preview an HTML page', 'Preview shows the page with its own CSS and scripts, kept apart from the dashboard. Source shows its code.');
    await openTreeFile('design/checkout/index.html'); await hold(2800);
    await click(q('#file-dlg [data-reader-mode="source"]'), 600); await hold(2200);
    await closeFile();
    await scene('Word and Excel files', 'A Word document shows as a page or as text. A workbook shows as tables, with a tab for each sheet.');
    await openTreeFile('docs/brief.docx'); await hold(2800); await closeFile();
    await openTreeFile('docs/forecast.xlsx'); await hold(2000);
    await click(q('#file-dlg [data-sheet="1"]'), 600); await hold(1900); await closeFile();
    await scene('Ask it for a screenshot', 'When its reply names the file, a thumbnail shows under it. Click it to open the picture.');
    await sideTab('agent');
    if ((await js("document.querySelector('#fs-head .fs-queue-toggle')?.getAttribute('aria-expanded')")) === 'true') { await click(q('#fs-head .fs-queue-toggle'), 500); await hold(500); } // the cards folded away: room for its reply
    await click(q('#msg-text'), 600);
    await type('Take a screenshot of the checkout page and save it in your scratchpad.', 32);
    await hold(300); await enter(); await hold(900);
    await heldNow('screenshot'); // busy: sent now
    await until("document.querySelector('#farm-agent .named-pic img')?.naturalWidth > 0", 10000);
    await point(q('#farm-agent .named-pic'), 700); await hold(1500);
    await click(q('#farm-agent .named-pic'), 500);
    await until("document.getElementById('file-dlg').open", 3000); await raise(); await hold(3000);
    await closeFile();
  }

  // ----- 10. the conversation -----
  if (want(10)) {
    await chapter(10, 'The conversation');
    await pickInSidebar('demo-checkout');
    await scene('Read the whole conversation', 'From its first message, with search: Enter jumps to the next match.');
    await click(q('#fs-chat-bar [data-convo]'), 600);
    await until("document.getElementById('convo').open", 4000); await raise(); await hold(1200);
    await click(q('#convo-q'), 500);
    await type('retry', 90);
    await until("/ of /.test(document.getElementById('convo-count').textContent)", 4000); await hold(1600);
    await enter(); await hold(1400); await enter(); await hold(1400);
    await scene('Fork from any reply', 'A new session starts from that point of the conversation, in the mode, model, effort and account you choose.');
    const theirs = "[...document.querySelectorAll('#convo .bub.agent')].find(b => b.textContent.includes('retry stops'))"; // the match it is on
    await point(theirs, 700); await hold(500);
    await click(`${theirs}?.querySelector('.bub-reply[data-fork]')`, 500);
    await until("document.getElementById('fork-dlg').open", 3000); await raise(); await hold(2800);
    await click(q('[data-fork-cancel]'), 500); await hold(400);
    await scene('Or go back to before one of your messages', '↺ Restore rewinds the conversation, the code it changed since, or both, as /rewind does.');
    const yours = "[...document.querySelectorAll('#convo .bub.you')].find(b => b.textContent.includes('behind a flag'))"; // its first prompt
    await point(yours, 700); await hold(500);
    await click(`${yours}?.querySelector('.bub-reply[data-restore]')`, 500);
    await until("document.getElementById('restore-dlg').open", 3000); await raise(); await hold(2800);
    await click(q('[data-restore-cancel]'), 500); await hold(400);
    await click(q('[data-convo-close]'), 500); await hold(500);
    await scene('💬 All chats: every conversation in one timeline', "Your messages, the agents' replies and what they say to each other, oldest first. Each agent's steps fold into one line.");
    await menu('[data-farm-nav="chats"]');
    await until("document.getElementById('chats').open", 4000); await raise(); await hold(1800);
    await point(q('#chats-body'), 600); await js("document.getElementById('chats-body').scrollBy({ top: -360, behavior: 'smooth' })"); await hold(1500); // back a little, to read
    await click(q('#chats-body .ch-run-btn'), 600); await hold(1800);
    await scene('Pick whose messages to show', 'A chip for each agent, with how many of its messages are new. ⚠ Needs you shows the ones waiting on you, to answer them here.');
    await click(q(`#chats-chips [data-chats-chip="${byId['demo-checkout'].id}"]`), 600); await hold(1800);
    await click(q('#chats-chips [data-chats-needs]'), 600); await hold(2400);
    await click(q('#chats-chips [data-chats-chip=""]'), 600); await hold(900);
    await scene('Write to any of them from here', 'The box writes to the agent in To: the one whose message you clicked last. It is that agent\'s own box.');
    await click(`[...document.querySelectorAll('#chats-body .bub[data-chats-agent="${byId['demo-orders'].id}"]')].at(-1)`, 600); await hold(700);
    await point(q('#chats-to'), 600); await hold(2000);
    await click(q('[data-chats-close]'), 500); await hold(500);
  }

  // ----- 11. the list view -----
  if (want(11)) {
    await chapter(11, 'The list view');
    await menu('[data-farm-nav="list"]');
    await until("document.getElementById('main').dataset.view === 'list'", 3000); await hold(700);
    await scene('The list view shows the same agents', 'Sorted by what needs you; idle and stale sessions are folded away. Each carries its account.');
    await point(q('#list .row'), 700); await hold(1000);
    await point(q('#list .row .chip.acct'), 600); await hold(1300);
    await click(q('#list .grp[data-group="idle"]'), 700); await hold(1600);
    await click(q('#list .grp[data-group="idle"]'), 500); await hold(500);
    await scene('The top bar shows your Mac and each account', "How much memory and CPU your agents use, and each Claude account's limits and when they reset.");
    await point(q('#hstats'), 700); await hold(1200);
    await point("[...document.querySelectorAll('#hstats .hstat')].at(-1)", 600); await hold(1600);
    await point(q('#kpis .kpi'), 600); await hold(1200);
    await scene('Collisions', 'Two agents writing to the same repo at the same time.');
    await point(q('#kpis .kpi.k-collide'), 600); await hold(1100);
    await point(q('#rail .card.collide'), 700); await hold(2400);
    await scene('Each agent has a detailed panel', 'Its working line, tasks, model, effort, context and cost, with CPU and memory over time.');
    await click(row('demo-checkout'), 600); await hold(600);
    await point(q('#center-body .workline'), 600); await hold(1400);
    await point(q('#center-body .metrics'), 600); await hold(1700);
    await scene('The newest reply is framed as Latest', 'With your message just before it, when there is one. Reply quotes any message into the box.');
    await point(q('#center-body .latest'), 700); await hold(3000);
    await scene('The repos', 'Each one with its branch, uncommitted files, unpushed commits, last deploy and open pull requests.');
    await point("[...document.querySelectorAll('#rail .card')].filter(c => !c.classList.contains('collide'))[0]", 700); await hold(1700);
    await point("[...document.querySelectorAll('#rail .card')].filter(c => !c.classList.contains('collide'))[1]", 600); await hold(1700);
  }

  // ----- 12. sessions -----
  if (want(12)) {
    await chapter(12, 'Sessions');
    if ((await js("document.getElementById('main').dataset.view")) !== 'list') { await click(q('#view-list'), 600); await until("document.getElementById('main').dataset.view === 'list'", 3000); }
    await scene('Start a session in any folder', "Type a path and the folders in it are suggested. Tab completes the name, and Browse opens Finder's folder window.");
    await click(q('#sessions-open'), 700);
    await until("document.getElementById('sessions').open", 3000); await raise(); await hold(900);
    await click(q('#sess-dir'), 600);
    await type('~/code/sh', 90); await hold(1500);
    await tabKey(); await hold(1900);
    await point(q('#sess-dir-browse'), 600); await hold(1100);
    await scene('The folder does not have to exist yet', 'Create it makes it after asking. New starts the session there, in the mode, model, effort and account you pick.');
    await js("(() => { const f = document.getElementById('sess-dir'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); f.focus(); })()");
    await type('~/code/new-shop', 70); await hold(1200);
    await click(q('#sess-dir-note [data-dir-make]'), 600);
    await until("document.getElementById('confirm').open", 3000); await raise(); await hold(1400);
    await click(q('#confirm-yes'), 600);
    await until("!document.getElementById('sess-dir-new').disabled", 4000); await hold(800);
    await point(q('#sess-account'), 600); await setSelect('#sess-account', 'work'); await hold(1400);
    await click(q('#sess-dir-new'), 600); await hold(2400);
    await scene('Search your past sessions', 'Filter them by folder, model, branch, account or whether they run, sort them, and resume one.');
    await click(q('#sessions-open'), 700);
    await until("document.getElementById('sessions').open && !!document.querySelector('#sessions [data-sess-resume]')", 5000); await raise(); await hold(900);
    await click(q('#sess-filter'), 600);
    await type('checkout', 80); await hold(1600);
    await setSelect('#sess-f-model', 'opus'); await hold(1400);
    await setSelect('#sess-sort', 'length'); await hold(1900);
    await click(q('#sessions [data-sess-close]'), 600); await hold(400);
  }

  // ----- 13. Claude Code itself -----
  if (want(13)) {
    await chapter(13, 'Claude Code itself');
    await scene('Your plugins and skills', 'Each one with the context it adds to every session. Turn it off, update it or remove it.');
    await click(q('#setup-open'), 700);
    await until("document.getElementById('setup').open", 3000); await raise();
    await until("/shop-tools/.test(document.getElementById('setup-body').textContent)", 8000); await hold(3400);
    await scene('Reload applies them to running sessions', 'It runs /reload-plugins in every session that is listening.');
    await click(q('#setup [data-reload-sessions]'), 600); await hold(2800);
    await scene('Check your MCP servers', "Yours, claude.ai's connectors and each plugin's, with Sign in where one needs it.");
    await click(q('[data-setup-tab="mcp"]'), 600);
    await until("/linear/.test(document.getElementById('setup-body').textContent)", 8000); await hold(3400);
    await scene('Permission rules', 'What runs without asking, and the settings file each rule is in. Remove one in a click.');
    await click(q('[data-setup-tab="rules"]'), 600); await hold(3400);
    await click(q('[data-setup-close]'), 500); await hold(400);
  }

  // ----- 14. other worlds -----
  if (want(14)) {
    await chapter(14, 'Other worlds');
    if ((await js("document.getElementById('main').dataset.view")) !== 'farm') { await click(q('#view-farm'), 700); await until("document.getElementById('main').dataset.view === 'farm'", 3000); }
    await browser.untilIn('/world/', "document.querySelectorAll('.px-tag').length >= 8", 10000);
    if ((await js("document.getElementById('main').dataset.side")) === 'open') { await click(q('#fs-hide'), 600); await until("document.getElementById('main').dataset.side !== 'open'", 2000); } // the world, the whole window
    await hold(800);
    await scene('Choose how the dashboard draws your agents', 'The farm is one world. The robot factory shows the same agents, and you can make your own.');
    await menu('[data-farm-nav="worlds"]');
    await until("document.getElementById('worlds-dlg')?.open", 3000); await raise(); await hold(2200);
    await settle(); await click(q('#worlds-dlg .world-pick[data-world="factory"]'), 700);
    await until("/\\/world\\/factory\\/$/.test(document.querySelector('#farm .world-frame')?.src ?? '')", 6000);
    await browser.untilIn('/world/factory/', "document.querySelectorAll('.px-tag').length >= 8", 15000); await hold(1500);
    await scene('The robot factory', 'Every agent a robot, every repo an assembly bay where a robot is built as its context fills. Drones are subagents and web calls.');
    await moveTo([Math.round(VW * 0.5), Math.round(VH * 0.45)], 900); await hold(2600);
    await moveTo([Math.round(VW * 0.7), Math.round(VH * 0.32)], 900); await hold(2400);
    await scene('Carts, tubes and the heat of the floor', 'A cart drives to the robot calling an MCP server, messages shoot through tubes, and the floor warms with your 5-hour limit.');
    result(O, O.open); begin(O, 'mcp__claude_ai_Linear__list_issues', { team: 'Infra' });
    use(byId['demo-flow'], 'SendMessage', { to: 'checkout-api', summary: 'One-page checkout is ready', message: 'The one-page checkout prototype builds. Shall I open a pull request?' });
    if (await wuntil(`!!${byText('.px-mover', 'Linear')}`, 6000)) for (let i = 0; i < 5; i++) await point(w(byText('.px-mover', 'Linear')), 850);
    await hold(2400);
    await scene('A robot dog, a robot vacuum and a cat live here', 'Just for fun, like the animals on the farm.');
    for (const k of ['robodog', 'vacuum', 'cat']) { const a = await animal(k); if (a) { await point(spot(await farmAt(a.x, a.y - 4)), 700); await hold(1500); } }
    await scene('Or make a world of your own', 'npm run new-world starts one, with a guide written for Claude Code. Yours runs sandboxed, and sees no words until you let it.');
    await menu('[data-farm-nav="worlds"]');
    await until("document.getElementById('worlds-dlg')?.open", 3000); await raise(); await hold(800);
    await point(q('#worlds-folder'), 600); await hold(2600);
    await settle(); await click(q('#worlds-dlg .world-pick[data-world="farm"]'), 700);
    await until("/\\/world\\/farm\\/$/.test(document.querySelector('#farm .world-frame')?.src ?? '')", 6000);
    await browser.untilIn('/world/farm/', "document.querySelectorAll('.px-tag').length >= 8", 15000); await hold(1200);
  }

  // ----- 15. notifications, privacy and the theme -----
  if (want(15)) {
    await chapter(15, 'Notifications, privacy and the theme');
    await scene('The bell rings when an agent needs you', 'A chime, a desktop notification, and a count in the tab title.');
    await menu('[data-farm-bell]'); await shutMenu(); await hold(600);
    paused.add('demo-flow'); // it stops to ask: it walks to the porch, and the bell rings
    if (F.open) result(F, F.open);
    F.open = null; F.openBash = null;
    const FQ = { question: 'Keep the old checkout page as a fallback?', header: 'Fallback', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] };
    const fq = use(F, 'AskUserQuestion', { questions: [FQ] });
    offers[fq] = { kind: 'question', toolUseId: fq, sessionId: F.id, createdAt: Date.now(), questions: [FQ] };
    writeFileSync(join(state, 'pending', `${fq}.json`), JSON.stringify(offers[fq]));
    await hold(2600);
    await point(spot(await farmer('demo-flow')), 900); await hold(2600);
    await scene('There is a view inside Claude Code too', '/tracker opens a pane listing every agent, and each session gets a status line and toasts.');
    await moveTo([Math.round(VW * 0.5), Math.round(VH * 0.45)], 900); await hold(4200);
    await scene('It all runs on your Mac', "The dashboard listens only on 127.0.0.1, and reading files or conversations needs the page's key.");
    await moveTo([Math.round(VW * 0.42), Math.round(VH * 0.55)], 1400); await hold(3800);
    await scene('Light, dark, or as macOS is', 'From the Menu. The farm and the list show the same data.');
    await pickFarmer('demo-checkout');
    await menu('[data-farm-nav="theme"]'); await hold(2200);
    await click(w(q('[data-farm-nav="theme"]')), 400); await hold(1700);
    await click(w(q('[data-farm-nav="theme"]')), 400); await hold(900);
    await shutMenu();
    await scene('Agentville', 'github.com/hamsathul/agentville');
    await moveTo([VW - 40, VH - 40], 700); await hold(3800);
  }
  await snapScene();
  await send('Page.stopScreencast');
  await sleep(300);
} catch (err) {
  if (err !== STILLS_DONE) throw err;
} finally {
  for (const t of timers) clearInterval(t);
  browser.close();
  for (const p of sleepers) p.kill();
  await handle.stop();
}

/* ---------- frames to video, and the captions beside it ---------- */

if (process.env.STILLS_ONLY) { // only the stills were asked for
  rmSync(temp, { recursive: true, force: true });
  rmSync(DEMO, { recursive: true, force: true });
  log(`saved farm.png and farm-night.png in ${STILLS}`);
  process.exit(0);
}

if (shot.length < 10) { console.error(`only ${shot.length} frames: nothing to make`); process.exit(1); }
const { small, chapters, start, end } = makeVideos({ shot, marks, out: OUT, temp });
const captionsFile = `${OUT.replace(/\.mp4$/i, '')}-captions.md`;
writeFileSync(captionsFile, captionsMd({
  video: basename(OUT), length: end - start,
  chapters: marks.map(([n, title, wall]) => ({ n, title, at: wall - start })),
  captions: timeline(ui?.said ?? [], marks.map(([, , wall]) => ({ wall })), start, end),
}));
rmSync(temp, { recursive: true, force: true });
rmSync(DEMO, { recursive: true, force: true });
log(`made ${OUT}, ${small}, a video for each chapter in ${chapters}, and the captions in ${captionsFile}`);
