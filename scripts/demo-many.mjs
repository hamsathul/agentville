#!/usr/bin/env node
// Records the many-sessions video: sixteen made-up Claude Code sessions at a travel-booking company,
// first as sixteen terminal windows, all busy at once and hard to follow; then each window flies
// into its farmer on the farm, where the ones that need you wait on the porch, you answer two of
// them, and a team of agents writes to each other. A world of its own, apart from the main demo's;
// docs/demo-script.md has the script. About 80 seconds.
//
//   node scripts/demo-many.mjs [out.mp4]      (needs Chrome and ffmpeg)
//
// Makes out.mp4, and out-small.mp4 under 10 MB for GitHub.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCollector } from '../collector/collector.mjs';
import { CHROME, launchBrowser, log, makeVideos, sleep, stage } from './demo/recorder.mjs';
import { iso, setUpSessions, transcriptWriter } from './demo/transcript.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? 'agentville-many.mp4');
if (!CHROME) { console.error('Chrome not found: set CHROME to its path.'); process.exit(1); }

/* ---------- the world: a travel-booking company's repos ---------- */

// Under /Users/Shared, the dashboard shows paths as ~/agentville-many/… and no one's name.
const DEMO = '/Users/Shared/agentville-many';
rmSync(DEMO, { recursive: true, force: true });
const CODE = join(DEMO, 'code');
const API = join(CODE, 'travel', 'booking-api'), WEB = join(CODE, 'travel', 'booking-web'), PAY = join(CODE, 'travel', 'payments'), SEARCH = join(CODE, 'travel', 'search');
const MOBILE = join(CODE, 'travel', 'mobile'), INFRA = join(CODE, 'platform', 'infra'), DS = join(CODE, 'platform', 'design-system'), DATA = join(CODE, 'data', 'pipelines');
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
  'README.md': '# Booking API\n\nFares, bookings and trips.\n',
  'src/fares/rules.ts': 'export function priceTrip(trip) {\n  return fareFor(trip);\n}\n',
  'src/bookings.ts': 'export function book(trip) {\n  return { id: crypto.randomUUID(), trip };\n}\n',
  'tests/fares.test.ts': "test('a one-way trip has one fare', () => {});\n",
  'CLAUDE.md': '# Booking API\n\n- Run `npm test` before every commit.\n- Each leg of a trip has its own fare.\n',
}, { branch: 'release/3.2' });
for (const f of ['src/fares/rules.ts', 'src/fares/currency.ts']) put(join(API, f), '// per-leg fares\n');
repo(WEB, { 'README.md': '# Booking web\n', 'src/SearchForm.tsx': 'export function SearchForm() { return null; }\n', 'src/FarePicker.tsx': '', 'docs/CHANGELOG.md': '# Changelog\n' }, { branch: 'feature/multi-city' });
for (const f of ['src/SearchForm.tsx', 'src/FarePicker.tsx', 'src/LegList.tsx', 'docs/CHANGELOG.md']) put(join(WEB, f), '/* multi-city */\n');
repo(PAY, { 'README.md': '# Payments\n', 'src/price.ts': 'export const price = {};\n', 'src/fx.ts': 'export const rates = { USD: 1.0791 };\n' });
repo(SEARCH, { 'README.md': '# Search\n', 'reindex.py': 'print("reindex")\n', 'src/rank.ts': 'export const rank = () => 0;\n' });
repo(MOBILE, { 'README.md': '# Mobile\n', 'deploy.sh': 'exit 1\n', 'ios/Trips/TripsView.swift': 'struct TripsView {}\n', 'android/app/src/main/TripsScreen.kt': 'fun TripsScreen() {}\n' });
repo(INFRA, { 'README.md': '# Infra\n', 'terraform/main.tf': '# staging\n' });
repo(DS, { 'README.md': '# Design system\n', 'tokens/colors.json': '{}\n' });
put(join(DS, 'tokens/colors.json'), '{ "surface-dark": "#15171c" }\n');
repo(DATA, { 'README.md': '# Data pipelines\n', 'etl/nightly.py': 'print("etl")\n', 'reports/bookings.py': 'print("report")\n' });

/* ---------- the world: sixteen sessions ---------- */

const claudeDir = join(DEMO, '.claude');
const NOW = Date.now(), MIN = 60_000, at = m => NOW - m * MIN;
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-4-5-20251001';
// `topic` is the terminal window's title, as Claude Code sets it.
const SESSIONS = [
  { key: 'lead', name: 'release-lead', topic: 'Release 3.2: multi-city trips', cwd: API, model: OPUS, ctx: 120_000, cpu: 8, mb: 610, cost: 5.1, word: 'Coordinating', effort: 'xhigh' },
  { key: 'api', name: 'api-agent', topic: 'Price each leg of a trip', cwd: API, model: OPUS, ctx: 95_000, cpu: 28, mb: 720, cost: 3.9, word: 'Refactoring', effort: 'high' },
  { key: 'web', name: 'web-agent', topic: 'Multi-city search form', cwd: WEB, model: SONNET, ctx: 80_000, cpu: 24, mb: 560, cost: 2.4, word: 'Crafting', effort: 'high', mode: 'acceptEdits' },
  { key: 'qa', name: 'qa-agent', topic: 'End-to-end tests for multi-city', cwd: WEB, model: SONNET, ctx: 60_000, cpu: 19, mb: 640, cost: 1.8, word: 'Testing', effort: 'medium' },
  { key: 'docs', name: 'docs-agent', topic: 'Changelog for 3.2', cwd: WEB, model: SONNET, ctx: 40_000, cpu: 0, mb: 300, cost: 0.9 },
  { key: 'pricing', name: 'pricing', topic: 'Prices with or without tax', cwd: PAY, model: OPUS, ctx: 50_000, cpu: 1, mb: 380, cost: 1.2 },
  { key: 'migrate', name: 'db-migrate', topic: 'Fares table migration', cwd: API, model: SONNET, ctx: 30_000, cpu: 1, mb: 310, cost: 0.7 },
  { key: 'plan', name: 'search-plan', topic: 'Plan: better search ranking', cwd: SEARCH, model: OPUS, ctx: 45_000, cpu: 1, mb: 350, cost: 1.1, command: 'claude --permission-mode plan', mode: 'plan' },
  { key: 'index', name: 'search-index', topic: 'Rebuild the city index', cwd: SEARCH, model: HAIKU, ctx: 35_000, cpu: 12, mb: 290, cost: 0.4, word: 'Indexing', effort: 'low' },
  { key: 'ios', name: 'ios-app', topic: 'Trips screen on iOS', cwd: MOBILE, model: OPUS, ctx: 110_000, cpu: 33, mb: 780, cost: 4.2, word: 'Building', effort: 'high' },
  { key: 'android', name: 'android-app', topic: 'Trips screen on Android', cwd: MOBILE, model: SONNET, ctx: 70_000, cpu: 26, mb: 690, cost: 2.2, word: 'Compiling', effort: 'medium' },
  { key: 'ops', name: 'infra-ops', topic: 'Staging for release 3.2', cwd: INFRA, model: OPUS, ctx: 55_000, cpu: 14, mb: 500, cost: 2.0, word: 'Provisioning', effort: 'high', command: 'claude --dangerously-skip-permissions', mode: 'bypassPermissions' },
  { key: 'tokens', name: 'ds-tokens', topic: 'Dark mode colour tokens', cwd: DS, model: SONNET, ctx: 65_000, cpu: 9, mb: 420, cost: 1.5, word: 'Theming', effort: 'medium' },
  { key: 'fx', name: 'fx-rates', topic: "Today's exchange rates", cwd: PAY, model: HAIKU, ctx: 25_000, cpu: 5, mb: 260, cost: 0.3, word: 'Fetching', effort: 'low' },
  { key: 'report', name: 'bookings-report', topic: 'Weekly bookings report', cwd: DATA, model: SONNET, ctx: 140_000, cpu: 11, mb: 480, cost: 2.9, word: 'Crunching', effort: 'medium' },
  { key: 'etl', name: 'etl-nightly', topic: 'Watch the nightly ETL', cwd: DATA, model: HAIKU, ctx: 20_000, cpu: 0, mb: 220, cost: 0.2 },
];
const { byId, sleepers } = setUpSessions(claudeDir, SESSIONS, { idBase: '0de31000', now: NOW });
const { write, prompt, use, begin, result, reply, turnEnd, task } = transcriptWriter();
const S = byId;

// The release team: the lead split the work an hour ago and has heard back since (old messages: no pigeons).
write(S.lead, prompt(S.lead, 'Ship release 3.2: multi-city trips. Split the work across the team.', at(40)));
task(S.lead, 'Price each leg of a trip', 'Pricing each leg', 'in_progress', at(39));
task(S.lead, 'The multi-city search form', 'Building the search form', 'in_progress', at(38.9));
task(S.lead, 'End-to-end tests for multi-city', 'Writing the tests', 'in_progress', at(38.8));
task(S.lead, 'The changelog for 3.2', 'Writing the changelog', 'completed', at(38.7));
task(S.lead, 'Release 3.2 to production', 'Releasing', 'pending', at(38.6));
result(S.lead, use(S.lead, 'SendMessage', { to: 'api-agent', summary: 'Per-leg fares', message: 'Price each leg on its own fare, then add them up.' }, at(38)), { ms: at(38) });
result(S.lead, use(S.lead, 'SendMessage', { to: 'web-agent', summary: 'Multi-city form', message: 'Build the multi-city search form: up to five legs.' }, at(37.9)), { ms: at(37.9) });
result(S.lead, use(S.lead, 'SendMessage', { to: 'qa-agent', summary: 'Multi-city tests', message: 'Write end-to-end tests for multi-city trips.' }, at(37.8)), { ms: at(37.8) });
reply(S.lead, 'The work is split: api-agent prices the legs, web-agent builds the form, qa-agent tests it, and docs-agent wrote the changelog.', at(37));
begin(S.lead, 'TaskList', {}, at(0.2));

write(S.api, prompt(S.api, 'Price each leg of a multi-city trip on its own fare.', at(36)));
result(S.api, use(S.api, 'Read', { file_path: join(API, 'src/fares/rules.ts') }, at(35)), { ms: at(34.9) });
result(S.api, use(S.api, 'Edit', { file_path: join(API, 'src/fares/rules.ts'), old_string: 'a', new_string: 'b' }, at(20)), { ms: at(19.9) });
begin(S.api, 'Bash', { command: 'npm test -- fares', description: 'Run the fare tests' }, at(0.2));

write(S.web, prompt(S.web, 'Build the multi-city search form.', at(35)));
write(S.web, { type: 'permission-mode', permissionMode: 'acceptEdits', sessionId: S.web.id });
result(S.web, use(S.web, 'Read', { file_path: join(WEB, 'src/SearchForm.tsx') }, at(34)), { ms: at(33.9) });
S.web.open = use(S.web, 'Edit', { file_path: join(WEB, 'src/SearchForm.tsx'), old_string: 'a', new_string: 'b' }, at(0.1));

write(S.qa, prompt(S.qa, 'Write end-to-end tests for multi-city trips.', at(34)));
result(S.qa, use(S.qa, 'Write', { file_path: join(WEB, 'tests/multi-city.spec.ts'), content: 'test()' }, at(20)), { ms: at(19.9) });
S.qa.open = use(S.qa, 'mcp__playwright__browser_navigate', { url: 'http://localhost:5173/search' }, at(0.2)); // its cart drives over

write(S.docs, prompt(S.docs, 'Write the changelog for 3.2.', at(12)));
result(S.docs, use(S.docs, 'Edit', { file_path: join(WEB, 'docs/CHANGELOG.md'), old_string: 'a', new_string: 'b' }, at(10)), { ms: at(9.9) });
reply(S.docs, 'The changelog for 3.2 is ready: multi-city trips, saved searches and price alerts. Shall I publish it?', at(2));
turnEnd(S.docs, at(2));

const QUESTION = { question: 'Show prices with or without tax?', header: 'Tax', multiSelect: false, options: [{ label: 'With tax', description: 'What travellers pay, all in' }, { label: 'Without tax', description: 'Tax is added at checkout' }] };
write(S.pricing, prompt(S.pricing, "Show fares in the traveller's currency, with each country's tax rules.", at(9)));
result(S.pricing, use(S.pricing, 'Read', { file_path: join(PAY, 'src/price.ts') }, at(8)), { ms: at(7.9) });
S.pricing.ask = use(S.pricing, 'AskUserQuestion', { questions: [QUESTION] }, at(1.2));

const MIGRATE = 'psql prod -f migrations/042_fares.sql';
write(S.migrate, prompt(S.migrate, 'Add the per-leg fares table and run the migration.', at(8)));
result(S.migrate, use(S.migrate, 'Write', { file_path: join(API, 'migrations/042_fares.sql'), content: 'create table leg_fares' }, at(6)), { ms: at(5.9) });
S.migrate.ask = use(S.migrate, 'Bash', { command: MIGRATE, description: 'Run the fares migration on production' }, at(0.9));

write(S.plan, prompt(S.plan, 'Plan better ranking for search results.', at(10)));
write(S.plan, { type: 'permission-mode', permissionMode: 'plan', sessionId: S.plan.id });
result(S.plan, use(S.plan, 'Read', { file_path: join(SEARCH, 'src/rank.ts') }, at(9)), { ms: at(8.9) });
use(S.plan, 'ExitPlanMode', { plan: '1. Rank results by total price, then rating\n2. Boost cities the traveller searched before\n3. Cache the city list for an hour' }, at(0.7));

write(S.index, prompt(S.index, 'Rebuild the city index for all regions.', at(15)));
const REINDEX = { id: use(S.index, 'Bash', { command: 'python reindex.py --city all', description: 'Rebuild the city index', run_in_background: true }, at(14)), pid: 4_000_010, startedAt: at(14) };
result(S.index, REINDEX.id, { ms: at(13.9), text: 'Command running in background with ID: r4x9' }); // a pump: a job in the background
begin(S.index, 'Bash', { command: 'python reindex.py --check europe', description: 'Check the European cities' }, at(0.3));

write(S.ios, prompt(S.ios, 'Build the Trips screen on iOS.', at(25)));
result(S.ios, use(S.ios, 'Bash', { command: './deploy.sh testflight', description: 'Upload to TestFlight' }, at(20)), { error: true, ms: at(19), text: 'error: signing certificate expired' }); // rain on the mobile field
begin(S.ios, 'Bash', { command: 'xcodebuild -scheme Trips build', description: 'Build the app' }, at(0.4));

write(S.android, prompt(S.android, 'Build the Trips screen on Android.', at(24)));
result(S.android, use(S.android, 'Read', { file_path: join(MOBILE, 'android/app/src/main/TripsScreen.kt') }, at(23)), { ms: at(22.9) });
begin(S.android, 'Bash', { command: './gradlew assembleDebug', description: 'Build the debug app' }, at(0.5));

write(S.ops, prompt(S.ops, 'Set up staging for release 3.2 and file the follow-ups.', at(30)));
write(S.ops, { type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: S.ops.id });
result(S.ops, use(S.ops, 'mcp__claude_ai_Linear__list_issues', { team: 'Platform' }, at(8)), { ms: at(7.9) }); // its Linear cart waits in the row
begin(S.ops, 'Bash', { command: 'terraform plan -out staging.tfplan', description: 'Plan staging' }, at(0.3));

write(S.tokens, prompt(S.tokens, 'Add dark mode colour tokens.', at(18)));
result(S.tokens, use(S.tokens, 'Read', { file_path: join(DS, 'tokens/colors.json') }, at(17)), { ms: at(16.9) });
S.tokens.open = use(S.tokens, 'Edit', { file_path: join(DS, 'tokens/colors.json'), old_string: 'a', new_string: 'b' }, at(0.2));

write(S.fx, prompt(S.fx, "Fetch today's exchange rates and update the table.", at(6)));
S.fx.open = use(S.fx, 'WebFetch', { url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', prompt: "Today's rates" }, at(0.2)); // a cart to town

write(S.report, prompt(S.report, 'Make the weekly bookings report.', at(28)));
use(S.report, 'Agent', { subagent_type: 'Explore', description: 'Find every source of bookings data', prompt: 'Find every table and file that holds bookings.' }, at(3)); // in the henhouse
begin(S.report, 'Bash', { command: 'python reports/bookings.py --week 41', description: 'Make the report' }, at(0.3));

write(S.etl, prompt(S.etl, '/loop watch the nightly ETL', at(3)));
result(S.etl, use(S.etl, 'Bash', { command: 'airflow dags state nightly_etl' }, at(2.8)), { ms: at(2.7), text: 'running' });
result(S.etl, use(S.etl, 'ScheduleWakeup', { delaySeconds: 1080, reason: 'the nightly ETL', prompt: '/loop watch the nightly ETL' }, at(2.5)), { ms: at(2.5) });
reply(S.etl, 'Still running; I will look again in 18 minutes.', at(2.4));
turnEnd(S.etl, at(2.4));

for (const s of SESSIONS) writeFileSync(join(claudeDir, 'sessions', `${s.pid}.json`), JSON.stringify({ pid: s.pid, sessionId: s.id, cwd: s.cwd, name: s.name, kind: 'interactive', status: s.open ? 'busy' : 'idle', startedAt: NOW - 50 * MIN }));

/* ---------- the stand-ins: processes, GitHub, and each session's mod ---------- */

// How the Bash tool runs a command: a shell of its own process group under the session.
const shellLine = typed => `/bin/zsh -c source ${join(claudeDir, 'shell-snapshots', 'snapshot-zsh-1-demo.sh')} 2>/dev/null || true && eval '${typed}' < /dev/null && pwd -P >| /tmp/claude-demo-cwd`;
function readProcs() {
  const procs = new Map();
  for (const s of SESSIONS) {
    const jitter = s.cpu ? Math.round((Math.random() - 0.5) * s.cpu * 0.4) : 0;
    procs.set(s.pid, { pid: s.pid, ppid: 1, cpu: Math.max(0, s.cpu + jitter), rssKb: s.mb * 1024, command: s.command ?? 'claude' });
  }
  const shell = (s, pid, command, startedAt, cpu, kb) => { // the shell, and the program it runs
    const ageSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    procs.set(pid, { pid, ppid: s.pid, pgid: pid, ageSec, cpu: 0.1, rssKb: 3 * 1024, command: shellLine(command) });
    procs.set(pid + 1, { pid: pid + 1, ppid: pid, pgid: pid, ageSec, cpu: Math.max(0, cpu + Math.round((Math.random() - 0.5) * cpu * 0.3)), rssKb: kb, command });
  };
  shell(S.index, REINDEX.pid, 'python reindex.py --city all', REINDEX.startedAt, 22, 380 * 1024);
  for (const s of SESSIONS) if (s.openBash) shell(s, s.openBash.pid, s.openBash.command, s.openBash.startedAt, 18, 210 * 1024);
  return Promise.resolve(procs);
}
const PRS = {
  'travel/booking-api': { open: [{ number: 312, title: 'Fares: price each leg of a trip', checks: 'running', branch: 'release/3.2' }, { number: 309, title: 'Bookings: refund a single leg', checks: 'ok' }], merged: [] },
  'travel/booking-web': { open: [{ number: 518, title: 'Multi-city search form', checks: 'failed', branch: 'feature/multi-city' }, { number: 521, title: 'Price alerts', draft: true, checks: null }], merged: [] },
};
const SLUGS = { [API]: 'travel/booking-api', [WEB]: 'travel/booking-web' };
const DEPLOYS = { 'travel/booking-web': { status: 'completed', conclusion: 'success' }, 'data/pipelines': { status: 'in_progress' } }; // a rainbow and a windmill

const temp = mkdtempSync(join(tmpdir(), 'agentville-many-'));
const root = join(temp, 'root');
cpSync(join(ROOT, 'web'), join(root, 'web'), { recursive: true });
const fakeClaude = join(temp, 'claude'); // never the real CLI
writeFileSync(fakeClaude, "#!/bin/sh\necho '[]'\n", { mode: 0o755 });
writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: { [WEB]: 'travel/booking-web', [DATA]: 'data/pipelines' }, pollMs: 400, gitPollMs: 3000, deployPollMs: 4000, prPollMs: 4000, permissionGuessSec: 3600, terminal: 'iTerm' }));
const state = join(root, 'state');
for (const d of ['pending', 'answers', 'mods']) mkdirSync(join(state, d), { recursive: true });
// Each session's mod: it says it is listening, with its cost, the plan's limits and its working line.
const PLAN = [{ kind: 'five_hour', percentUsed: 54, resetsAt: iso(NOW + 1.6 * 3_600_000) }, { kind: 'seven_day', percentUsed: 61, resetsAt: iso(NOW + 4 * 86_400_000) }];
const offers = {
  [S.pricing.ask]: { kind: 'question', toolUseId: S.pricing.ask, sessionId: S.pricing.id, createdAt: at(1.2), questions: [QUESTION] },
  [S.migrate.ask]: { kind: 'permission', toolUseId: S.migrate.ask, sessionId: S.migrate.id, tool: 'Bash', summary: MIGRATE, createdAt: at(0.9), expiresAt: NOW + 3_600_000 },
};
for (const [id, o] of Object.entries(offers)) writeFileSync(join(state, 'pending', `${id}.json`), JSON.stringify(o));
const thinking = new Set(['lead']);
function beacons() {
  for (const s of SESSIONS) {
    s.cost += s.open ? 0.004 : 0;
    const working = Boolean(s.open) || thinking.has(s.key);
    writeFileSync(join(state, 'mods', `${s.id}.json`), JSON.stringify({ sessionId: s.id, version: '0.6.2', at: Date.now(), usage: { costUsd: s.cost, contextPercent: Math.round((s.ctx / 200_000) * 100), rateLimits: PLAN }, ...(working ? { turn: { startedAt: s.turnAt, word: s.word ?? 'Working', mode: thinking.has(s.key) ? 'thinking' : 'tool-use' } } : {}), ...(s.effort ? { effort: s.effort } : {}) }));
  }
  for (const id of Object.keys(offers)) { const f = join(state, 'pending', `${id}.json`); if (existsSync(f)) utimesSync(f, new Date(), new Date()); }
}
function mods() {
  for (const name of readdirSync(join(state, 'answers'))) { // an answer: the question's result, and the session carries on
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5), a = JSON.parse(readFileSync(join(state, 'answers', name), 'utf8'));
    unlinkSync(join(state, 'answers', name));
    rmSync(join(state, 'pending', name), { force: true });
    delete offers[id];
    if (id === S.pricing.ask) {
      result(S.pricing, id, { text: `User answered: ${JSON.stringify(a.answers ?? a)}` });
      Object.assign(S.pricing, { ask: null, cpu: 22, word: 'Pricing', effort: 'high', turnAt: Date.now() });
      setTimeout(() => { reply(S.pricing, 'With tax it is: every price shows what the traveller pays.'); begin(S.pricing, 'Edit', { file_path: join(PAY, 'src/price.ts'), old_string: 'a', new_string: 'b' }); }, 700);
      STEPS.pricing = [['Bash', { command: 'npm test -- price' }], ['Edit', { file_path: join(PAY, 'src/price.ts'), old_string: 'a', new_string: 'b' }]];
    }
    if (id === S.migrate.ask && (a.decision === 'allow' || Number.isInteger(a.option))) {
      Object.assign(S.migrate, { ask: null, cpu: 18, word: 'Migrating', effort: 'medium', turnAt: Date.now() });
      setTimeout(() => { result(S.migrate, id, { text: 'CREATE TABLE\nALTER TABLE' }); begin(S.migrate, 'Bash', { command: 'psql prod -c "select count(*) from leg_fares"', description: 'Check the new table' }); }, 900);
      STEPS.migrate = [['Bash', { command: 'npm run db:verify' }], ['Edit', { file_path: join(API, 'src/fares/store.ts'), old_string: 'a', new_string: 'b' }]];
    }
  }
}
// The director: working sessions move on to their next step every few seconds.
const STEPS = {
  lead: [null, ['TaskList', {}], ['Read', { file_path: join(API, 'docs/release-3.2.md') }]],
  api: [['Read', { file_path: join(API, 'src/fares/currency.ts') }], ['Edit', { file_path: join(API, 'src/fares/rules.ts'), old_string: 'a', new_string: 'b' }], ['Bash', { command: 'npm test -- fares' }]],
  web: [['Bash', { command: 'npx eslint src' }], ['Edit', { file_path: join(WEB, 'src/FarePicker.tsx'), old_string: 'a', new_string: 'b' }], ['Bash', { command: 'npm run build' }]],
  qa: [['Bash', { command: 'npx playwright test multi-city' }], ['mcp__playwright__browser_take_screenshot', { filename: 'fare-picker.png' }]],
  index: [['Read', { file_path: join(SEARCH, 'reindex.py') }], ['Bash', { command: 'python reindex.py --check asia' }]],
  ios: [['Edit', { file_path: join(MOBILE, 'ios/Trips/TripsView.swift'), old_string: 'a', new_string: 'b' }], ['Bash', { command: 'xcodebuild test -scheme Trips' }]],
  android: [['Edit', { file_path: join(MOBILE, 'android/app/src/main/TripsScreen.kt'), old_string: 'a', new_string: 'b' }], ['Bash', { command: './gradlew test' }]],
  ops: [['mcp__claude_ai_Linear__save_issue', { title: 'Rotate the staging certificate', team: 'Platform' }], ['Bash', { command: 'terraform plan -out staging.tfplan' }]],
  tokens: [['Skill', { skill: 'design:contrast-check' }], ['Edit', { file_path: join(DS, 'tokens/colors.json'), old_string: 'a', new_string: 'b' }]],
  fx: [['Edit', { file_path: join(PAY, 'src/fx.ts'), old_string: 'a', new_string: 'b' }], ['WebFetch', { url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', prompt: "Today's rates" }]],
  report: [['Read', { file_path: join(DATA, 'reports/week-41.csv') }], ['Bash', { command: 'python reports/bookings.py --week 41' }]],
};
const stepAt = {};
function direct() {
  for (const [key, steps] of Object.entries(STEPS)) {
    const s = S[key], i = stepAt[key] = ((stepAt[key] ?? -1) + 1) % steps.length;
    if (s.open) result(s, s.open);
    s.open = null;
    s.openBash = null;
    const next = steps[i];
    if (next) { thinking.delete(key); begin(s, ...next); } else thinking.add(key); // between steps: thinking
  }
}

/* ---------- the terminal windows ---------- */

// What each session's window shows: its history, the steps it streams while you watch, and the box
// it waits in when it needs you. Lines are [kind, text] as Claude Code draws them.
const U = t => ['user', t], T = (tool, arg) => ['tool', tool, arg], O = t => ['out', t], SAY = t => ['say', t], ADD = t => ['add', t], DEL = t => ['del', t], ERR = t => ['err', t], DIM = t => ['dim', t], MSG = t => ['msg', t];
const ASK = lines => `<div class="dw-ask">${lines.map(([cls, text]) => `<div class="${cls && `x-${cls}`}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}</div>`;
const WINDOWS = {
  lead: { log: [U('Ship release 3.2: multi-city trips. Split the work across the team.'), T('TaskCreate', '5 tasks'), O('Created tasks #1 to #5'), T('SendMessage', 'to: api-agent'), O('Sent: Per-leg fares'), T('SendMessage', 'to: web-agent'), O('Sent: Multi-city form'), T('SendMessage', 'to: qa-agent'), O('Sent: Multi-city tests'), SAY('The work is split. Waiting on api-agent before web-agent can use /fares.')],
    stream: [[T('TaskList', ''), O('5 tasks: 1 done, 3 in progress, 1 open')], [MSG('Message from api-agent: /fares returns a price for each leg')], [T('SendMessage', 'to: web-agent'), O('Sent: /fares is ready')], [SAY('qa-agent runs the end-to-end tests once the form is in.')]] },
  api: { log: [U('Price each leg of a multi-city trip on its own fare.'), T('Read', 'src/fares/rules.ts'), O('Read 214 lines'), T('Update', 'src/fares/rules.ts'), O('Updated src/fares/rules.ts with 12 additions and 3 removals'), DEL('-  return fareFor(trip)'), ADD('+  return trip.legs.map(leg => fareFor(leg))')],
    stream: [[T('Bash', 'npm test -- fares'), O('PASS tests/fares.test.ts (14 tests)')], [T('Read', 'src/fares/currency.ts'), O('Read 88 lines')], [T('Update', 'src/fares/rules.ts'), O('Updated with 6 additions and 1 removal'), ADD('+    currency: leg.currency,')], [SAY('Each leg now carries its own currency. Telling web-agent.')], [T('SendMessage', 'to: web-agent'), O('Sent: /fares returns legs')]] },
  web: { log: [U('Build the multi-city search form.'), T('Read', 'src/SearchForm.tsx'), O('Read 162 lines'), T('Update', 'src/SearchForm.tsx'), O('Updated src/SearchForm.tsx with 31 additions'), ADD('+  <LegList legs={legs} onAdd={addLeg} />')],
    stream: [[T('Bash', 'npx eslint src'), O('No problems found')], [T('Update', 'src/FarePicker.tsx'), DEL('-  const date = legs[0].date'), ADD('+  const date = leg.date')], [T('Bash', 'npm run build'), O('Built in 4.1s')], [SAY('The form takes up to five legs. Wiring the fare picker next.')]] },
  qa: { log: [U('Write end-to-end tests for multi-city trips.'), T('Write', 'tests/multi-city.spec.ts'), O('Wrote 64 lines'), T('playwright - Navigate (MCP)', 'url: "localhost:5173/search"'), O('Page loaded: Search · Booking')],
    stream: [[T('Bash', 'npx playwright test multi-city'), O('2 failed, 9 passed')], [SAY("The second leg shows the first leg's date. Telling release-lead.")], [T('SendMessage', 'to: release-lead'), O('Sent: Two tests fail')], [T('playwright - Screenshot (MCP)', 'filename: "fare-picker.png"'), O('Saved fare-picker.png')]] },
  docs: { log: [U('Write the changelog for 3.2.'), T('Read', 'docs/CHANGELOG.md'), O('Read 210 lines'), T('Update', 'docs/CHANGELOG.md'), O('Updated docs/CHANGELOG.md with 18 additions'), SAY('The changelog for 3.2 is ready: multi-city trips, saved searches and price alerts. Shall I publish it?'), DIM('✻ Worked for 2m 10s')] },
  pricing: { log: [U("Show fares in the traveller's currency, with each country's tax rules."), T('Read', 'src/price.ts'), O('Read 120 lines'), T('Grep', '"vat|tax" in src/'), O('Found 9 files')],
    box: ASK([['h', '☐ Tax'], ['b', 'Show prices with or without tax?'], ['sel', '❯ 1. With tax'], ['d', '     What travellers pay, all in'], ['', '  2. Without tax'], ['d', '     Tax is added at checkout'], ['', '  3. Type something.'], ['d', 'Enter to select · ↑/↓ to navigate · Esc to cancel']]) },
  migrate: { log: [U('Add the per-leg fares table and run the migration.'), T('Write', 'migrations/042_fares.sql'), O('Wrote 22 lines'), T('Bash', 'psql staging -f migrations/042_fares.sql'), O('CREATE TABLE')],
    box: ASK([['h', 'Bash command'], ['', `  ${MIGRATE}`], ['d', '  Run the fares migration on production'], ['b', 'Do you want to proceed?'], ['sel', '❯ 1. Yes'], ['', "  2. Yes, and don't ask again for psql commands in …/booking-api"], ['', '  3. No, and tell Claude what to do differently (esc)']]) },
  plan: { log: [U('Plan better ranking for search results.'), T('Read', 'src/rank.ts'), O('Read 96 lines'), T('Grep', '"score" in src/'), O('Found 4 files')],
    box: ASK([['h', 'Ready to code?'], ['b', "Here is Claude's plan:"], ['', '  1. Rank results by total price, then rating'], ['', '  2. Boost cities the traveller searched before'], ['', '  3. Cache the city list for an hour'], ['b', 'Would you like to proceed?'], ['sel', '❯ 1. Yes, and auto-accept edits'], ['', '  2. Yes, and manually approve edits'], ['', '  3. No, keep planning']]) },
  index: { log: [U('Rebuild the city index for all regions.'), T('Bash', 'python reindex.py --city all'), O('Running in the background (r4x9)'), SAY('The index rebuilds in the background. Checking the counts meanwhile.')],
    stream: [[T('Bash', 'python reindex.py --check europe'), O('41,203 cities · 0 missing')], [T('Read', 'reindex.log'), O('Read 1,840 lines')], [SAY('Europe and Asia are done. The Americas are next.')]] },
  ios: { log: [U('Build the Trips screen on iOS.'), T('Bash', './deploy.sh testflight'), ERR('error: signing certificate expired'), SAY('The TestFlight upload failed: the certificate expired. Building locally meanwhile.')],
    stream: [[T('Bash', 'xcodebuild -scheme Trips build'), O('** BUILD SUCCEEDED ** (38.2s)')], [T('Update', 'ios/Trips/TripsView.swift'), ADD('+    ForEach(trip.legs) { LegRow(leg: $0) }')], [T('Bash', 'xcodebuild test -scheme Trips'), O('Executed 48 tests, with 0 failures')]] },
  android: { log: [U('Build the Trips screen on Android.'), T('Read', 'TripsScreen.kt'), O('Read 140 lines')],
    stream: [[T('Bash', './gradlew assembleDebug'), O('BUILD SUCCESSFUL in 52s')], [T('Update', 'TripsScreen.kt'), ADD('+    LazyColumn { items(trip.legs) { LegRow(it) } }')], [T('Bash', './gradlew test'), O('62 tests completed')]] },
  ops: { log: [U('Set up staging for release 3.2 and file the follow-ups.'), T('Bash', 'terraform apply staging.tfplan'), O('Apply complete! 7 added'), T('linear - List issues (MCP)', 'team: "Platform"'), O('12 issues')],
    stream: [[T('Bash', 'terraform plan -out staging.tfplan'), O('Plan: 2 to add, 1 to change')], [T('linear - Save issue (MCP)', 'title: "Rotate the staging certificate"'), O('Created PLT-212')], [SAY('Staging is up at staging.travel.example.com.')]] },
  tokens: { log: [U('Add dark mode colour tokens.'), T('Read', 'tokens/colors.json'), O('Read 88 lines')],
    stream: [[T('Update', 'tokens/colors.json'), ADD('+  "surface-dark": "#15171c",')], [T('Skill', 'design:contrast-check'), O('All 24 pairs pass AA')], [SAY('Dark mode has its own surface and text tokens now.')]] },
  fx: { log: [U("Fetch today's exchange rates and update the table.")],
    stream: [[T('Fetch', 'https://www.ecb.europa.eu/…/eurofxref-daily.xml'), O('Received 3.1KB (200 OK)')], [T('Update', 'src/fx.ts'), DEL('-  USD: 1.0791,'), ADD('+  USD: 1.0842,')], [SAY('The rates are from today, 16:00 CET.')]] },
  report: { log: [U('Make the weekly bookings report.'), T('Task', 'Explore: find every source of bookings data'), O('Running…')],
    stream: [[T('Bash', 'python reports/bookings.py --week 41'), O('Wrote reports/week-41.csv (1,204 rows)')], [T('Read', 'reports/week-41.csv'), O('Read 1,204 lines')], [SAY('Bookings are up 12% on last week, and 9% of them are multi-city.')]] },
  etl: { log: [U('/loop watch the nightly ETL'), T('Bash', 'airflow dags state nightly_etl'), O('running'), SAY('Still running. I will look again in 18 minutes.'), DIM('✻ Worked for 14s')] },
};
// In the page: sixteen windows on a desktop, streaming; `fly` sends each into its farmer.
const WALL = `(windows) => {
  const st = document.createElement('style');
  st.textContent = \`
    #demo-wall { left: 0; top: 0; width: 100vw; height: 100vh; }
    .dw-desk { position: absolute; inset: 0; background: radial-gradient(at 18% 12%, #7a46d8 0, transparent 52%), radial-gradient(at 88% 85%, #d8458f 0, transparent 50%), radial-gradient(at 70% 20%, #2f5fd0 0, transparent 45%), linear-gradient(140deg, #1b2266, #4a2a91 50%, #9b3a8e); transition: opacity 1.6s ease .3s; }
    .dw-grid { position: absolute; left: 14px; right: 14px; top: 12px; bottom: 116px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .dw { display: flex; flex-direction: column; min-height: 0; border-radius: 9px; overflow: hidden; background: #1b1b1d; box-shadow: 0 10px 28px rgba(0, 0, 0, .45), 0 0 0 1px rgba(255, 255, 255, .09); will-change: transform, opacity; }
    .dw-bar { flex: none; height: 17px; display: flex; align-items: center; gap: 5px; padding: 0 8px; background: #2c2c2f; border-bottom: 1px solid #111; font: 600 8.5px/1 system-ui, -apple-system, sans-serif; color: #a9a9ae; }
    .dw-bar i { flex: none; width: 7px; height: 7px; border-radius: 50%; background: #ff5f57; }
    .dw-bar i:nth-child(2) { background: #febc2e; } .dw-bar i:nth-child(3) { background: #28c840; }
    .dw-bar span { flex: 1; min-width: 0; margin-right: 26px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dw-body { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 3px 7px 4px; font: 8.6px/1.32 Menlo, ui-monospace, monospace; color: #d9d9d9; overflow: hidden; }
    .dw-log { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; }
    .dw-log > div, .dw-ask > div { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
    .dw-log .x-u { margin: 3px 0 2px; padding: 0 3px; background: #313134; color: #ececec; }
    .dw-log .x-ok { color: #4eba65; } .dw-log .x-o, .dw-log .x-d, .dw-ask .x-d { color: #8b8b90; }
    .dw-log .x-add { background: #1d3a22; color: #b8e6bd; } .dw-log .x-del { background: #3e1f23; color: #ebb7bc; }
    .dw-log .x-err { color: #ff7b72; } .dw-log .x-m { color: #6cc7e8; }
    .dw-spin { flex: none; margin: 3px 0 1px; color: #d77757; white-space: nowrap; overflow: hidden; }
    .dw-in { flex: none; margin-top: 2px; padding: 2px 0; border-top: 1px solid #47474c; border-bottom: 1px solid #47474c; color: #8b8b90; }
    .dw-in i { display: inline-block; width: 5px; height: 9px; margin-left: 5px; vertical-align: -1px; background: #cfcfcf; }
    .dw-ask { flex: none; margin-top: 3px; padding-top: 3px; border-top: 1px solid #7b84ff; }
    .dw-ask .x-h { color: #a3aaff; font-weight: 700; } .dw-ask .x-b { margin-top: 2px; color: #f2f2f2; } .dw-ask .x-sel { color: #8fb4ff; }
    .dw-mode { flex: none; margin-top: 2px; font-size: 8px; color: #7d7d82; white-space: nowrap; overflow: hidden; }
    .dw-mode.m-acc { color: #af87ff; } .dw-mode.m-plan { color: #48a89c; } .dw-mode.m-byp { color: #ff6b80; }\`;
  document.head.appendChild(st);
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const line = ([k, a, b]) => k === 'user' ? '<div class="x-u">&gt; ' + esc(a) + '</div>'
    : k === 'tool' ? '<div><b class="x-ok">●</b> <b>' + esc(a) + '</b>(' + esc(b) + ')</div>'
    : k === 'out' ? '<div class="x-o">  ⎿  ' + esc(a) + '</div>'
    : k === 'say' ? '<div><b>●</b> ' + esc(a) + '</div>'
    : '<div class="' + ({ add: 'x-add', del: 'x-del', err: 'x-err', dim: 'x-d', msg: 'x-m' }[k] ?? '') + '">' + (k === 'err' ? '  ⎿  ' : k === 'msg' ? '✉ ' : '') + esc(a) + '</div>';
  const MODES = { acceptEdits: ['m-acc', '⏵⏵ accept edits on (shift+tab to cycle)'], plan: ['m-plan', '⏸ plan mode on (shift+tab to cycle)'], bypassPermissions: ['m-byp', '⏵⏵ bypass permissions on (shift+tab to cycle)'] };
  const wall = document.createElement('div');
  wall.id = 'demo-wall'; wall.className = 'demo-pop'; wall.popover = 'manual';
  wall.innerHTML = '<div class="dw-desk"></div><div class="dw-grid">' + windows.map(w => {
    const [mc, mt] = MODES[w.mode] ?? ['', '? for shortcuts'];
    return '<div class="dw" data-key="' + w.key + '"><div class="dw-bar"><i></i><i></i><i></i><span>✳ ' + esc(w.title) + '</span></div><div class="dw-body"><div class="dw-log">' + w.log.map(line).join('') + '</div>'
      + (w.spin ? '<div class="dw-spin"></div>' : '') + (w.box ?? '<div class="dw-in">&gt;<i></i></div>') + (w.box && !mc ? '' : '<div class="dw-mode ' + mc + '">' + esc(mt) + '</div>') + '</div></div>';
  }).join('') + '</div>';
  document.body.appendChild(wall);
  wall.showPopover();
  const SPIN = '·✢✳✶✻✽✻✶✳✢', t0 = performance.now();
  const els = [...wall.querySelectorAll('.dw')].map((el, i) => ({ el, w: windows[i], log: el.querySelector('.dw-log'), spin: el.querySelector('.dw-spin'), n: 0, due: 700 + ((i * 613) % 2900) }));
  let frame = 0;
  const tick = () => {
    const now = performance.now() - t0;
    frame++;
    for (const e of els) {
      if (e.spin) {
        const s = e.w.spin, sec = s.sec + Math.floor(now / 1000), tok = (s.tok + (now / 1000) * 0.23).toFixed(1);
        e.spin.textContent = SPIN[(frame + e.w.key.length) % SPIN.length] + ' ' + s.word + '… (' + Math.floor(sec / 60) + 'm ' + (sec % 60) + 's · ↓ ' + tok + 'k tokens · esc to interrupt)';
      }
      if (e.w.stream && now >= e.due) {
        e.log.insertAdjacentHTML('beforeend', e.w.stream[e.n++ % e.w.stream.length].map(line).join(''));
        while (e.log.children.length > 40) e.log.firstElementChild.remove();
        e.due = now + 1400 + ((e.n * 977 + e.w.key.length * 331) % 1900);
      }
    }
  };
  tick();
  const timer = setInterval(tick, 110);
  window.__wall = {
    // Each window shrinks into its farmer, one after another, while the desktop behind fades away.
    fly(targets) {
      els.forEach((e, i) => {
        const r = e.el.getBoundingClientRect(), to = targets[e.w.key] ?? [innerWidth / 2, innerHeight / 2];
        e.el.style.transition = 'transform 1.6s cubic-bezier(.55, 0, .3, 1) ' + (i * 70) + 'ms, opacity .6s ease ' + (i * 70 + 1000) + 'ms';
        e.el.style.transformOrigin = '50% 50%';
        e.el.style.transform = 'translate(' + (to[0] - (r.left + r.width / 2)) + 'px, ' + (to[1] - (r.top + r.height / 2)) + 'px) scale(.04)';
        e.el.style.opacity = '0';
      });
      wall.querySelector('.dw-desk').style.opacity = '0';
    },
    done() { clearInterval(timer); wall.remove(); st.remove(); },
  };
}`;

/* ---------- the tour ---------- */

const handle = await startCollector({
  root, claudeDir, claudeBin: fakeClaude, notify: () => {}, log: () => {}, home: DEMO,
  readProcs, deployStatusOf: async r => (DEPLOYS[r] ? { ...DEPLOYS[r], at: Date.now() - 6 * MIN, workflow: 'Deploy', sha: 'c0ffee1' } : null),
  githubSlugOf: async top => SLUGS[top] ?? null, pullRequestsOf: async slug => PRS[slug] ?? { open: [], merged: [] },
  sessionProcs: { commandOf: async () => 'claude', ttyOf: async () => 'ttys001', kill: () => {}, alive: () => true, groupAlive: () => false, killGroup: () => {} },
  scratchBase: join(DEMO, 'tmp'), folderRoots: [DEMO], chooseFolder: async () => null,
  launch: async () => ({ code: 0, stdout: '', stderr: '' }),
});
beacons();
const timers = [setInterval(beacons, 900), setInterval(mods, 200)];
const VW = 1440, VH = 900;
const browser = launchBrowser(temp);
const { send, js, until, shot } = browser;
try {
  await browser.connect(VW, VH);
  await send('Page.navigate', { url: `http://127.0.0.1:${handle.port}/` });
  await sleep(800);
  await js(`(() => { const s = { 'tracker-view': 'farm', 'tracker-farm-tab': 'agent', 'tracker-closed-groups': '["idle","stale"]', 'tracker-theme': 'dark', 'tracker-farm-sky': 'day', 'tracker-farm-zoom': '1', 'tracker-farm-side': 'closed', 'tracker-farm-panel': 'open', 'tracker-farm-bubbles': 'on', 'tracker-bell': 'off', 'tracker-farm-resting': 'shown' }; for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); })()`);
  await send('Page.reload');
  await until(`document.querySelectorAll('.px-tag').length >= ${SESSIONS.length}`, 20000);
  await sleep(3000); // the repos, deploys and pull requests come in; everyone reaches their spot

  const ui = await stage(browser, VW, VH);
  const { moveTo, where, q, byText, point, click, say, raise, spot } = ui;
  const hold = sleep;
  const tag = key => `document.querySelector('[data-farmer="${S[key].id}"]')`;
  const farmer = async key => { const p = await where(tag(key)); return p && [p[0], p[1] + 18]; }; // its sprite, under its name: pointing at the name opens its bubble full length
  const pickFarmer = async key => { await click(tag(key), 750); await until(`document.querySelector('#farm-agent .fs-head .name')?.textContent === ${JSON.stringify(S[key].name)}`, 3000); await hold(400); };
  const logo = await js('window.Agentville.svg({ size: 132 })');

  // The windows, in an order that mixes the busy ones with the ones waiting on you.
  const ORDER = ['lead', 'ios', 'fx', 'tokens', 'api', 'pricing', 'android', 'report', 'web', 'ops', 'migrate', 'etl', 'qa', 'index', 'docs', 'plan'];
  const windows = ORDER.map(key => {
    const s = S[key], w = WINDOWS[key];
    return { key, title: s.topic, mode: s.mode, log: w.log, stream: w.stream ?? null, box: w.box ?? null, spin: w.stream ? { word: s.word, sec: Math.round((NOW - s.turnAt) / 1000) + 30 * (key.length % 5), tok: 4 + key.length * 1.7 } : null };
  });
  await js(`(${WALL})(${JSON.stringify(windows)})`);
  await raise(); // the cursor and the captions stay above the windows
  await js("document.getElementById('demo-caption').style.bottom = '14px'"); // in the strip of desktop below them
  await hold(600);

  await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
  const tick = setInterval(direct, 5200);
  timers.push(tick);

  // 1. Sixteen windows
  await hold(800);
  await say('Sixteen Claude Code sessions, sixteen windows', 'Each one is working on something, and some of them are waiting for you.');
  await moveTo([VW * 0.2, VH * 0.2], 1100); await hold(1300);
  await moveTo([VW * 0.62, VH * 0.36], 1100); await hold(1200);
  await moveTo([VW * 0.4, VH * 0.6], 1000); await hold(1500);
  // 2. Which ones?
  await say('Which ones need you?', 'A question, a permission and a plan are in there somewhere, and one session has finished.');
  for (const p of [[0.85, 0.58], [0.15, 0.4], [0.62, 0.78], [0.9, 0.2], [0.35, 0.3]]) { await moveTo([VW * p[0], VH * p[1]], 700); await hold(450); }
  await hold(1600);
  // 3. Into the farm
  await say('Agentville shows them all in one place', 'Each session is a farmer, and each repo is a field.');
  await hold(900);
  const targets = await js(`(() => { const out = {}; for (const [key, id] of ${JSON.stringify(Object.entries(S).map(([k, s]) => [k, s.id]))}) { const t = document.querySelector('[data-farmer="' + id + '"]'); if (!t) continue; const r = t.getBoundingClientRect(); out[key] = [r.left + r.width / 2, r.bottom + 12]; } return out; })()`);
  await js(`window.__wall.fly(${JSON.stringify(targets)})`);
  await moveTo([VW * 0.55, VH * 0.5], 900);
  await hold(2900);
  await js("window.__wall.done(); document.getElementById('demo-caption').style.bottom = ''");
  await hold(2000);
  // 4. The porch
  await say('The ones that need you wait on the porch', 'A red ! is a question or a permission, a scroll is a plan to approve, and a basket means it has finished.');
  for (const key of ['pricing', 'migrate', 'plan', 'docs']) { await point(spot(await farmer(key)), 700); await hold(1100); }
  await hold(600);
  // 5. Answering
  await say('Answer without hunting for the window', 'The options are the same as in its terminal, and the session carries on.');
  await pickFarmer('pricing');
  await click(`${q('#farm-agent input[value="With tax"]')}?.closest('label')`, 700); await hold(500);
  await click(q('#ask-send'), 600);
  await until(`document.querySelector('[data-farmer="${S.pricing.id}"]')?.className.includes('st-working')`, 6000); await hold(1400);
  await pickFarmer('migrate');
  await point(q('#farm-agent .ask'), 600); await hold(1500);
  await click(q('#ask-allow'), 600);
  await until(`document.querySelector('[data-farmer="${S.migrate.id}"]')?.className.includes('st-working')`, 6000); await hold(1400);
  await click(q('[data-farm-nav="side"]'), 600); await hold(700); // the sidebar away: the whole farm again
  // 6. Working together
  await say('See how they work together', 'A pigeon is one agent writing to another. Here the release lead hands out work and hears back.');
  const message = async (from, to, summary, text) => {
    use(S[from], 'SendMessage', { to: S[to].name, summary, message: text });
    await point(spot(await farmer(from)), 600); await hold(700);
    await point(spot(await farmer(to)), 1100); await hold(900);
  };
  await message('api', 'lead', '/fares returns legs', '/fares now returns a price for each leg, with its currency.');
  await message('lead', 'web', '/fares is ready', '/fares returns each leg with its currency. The fare picker can use it now.');
  await message('qa', 'lead', 'Two tests fail', "Two end-to-end tests fail: the second leg shows the first leg's date.");
  await message('lead', 'web', 'Fix the fare picker', "qa-agent found the second leg shows the first leg's date. Please fix it before the release.");
  await hold(1200);
  await say('Subagents, MCP calls and jobs show up too', 'Subagents wait in the henhouse, each MCP server drives its own cart, and a pump is a job running in the background.');
  await point(spot(await js(`(() => { const c = document.querySelector('#farm canvas'); const [pl, pt] = c.dataset.pad.split(',').map(Number), r = c.getBoundingClientRect(), cs = r.width / Number(c.dataset.ew); return [Math.round(r.left + (24 + pl) * cs), Math.round(r.top + (112 + pt) * cs)]; })()`)), 800); await hold(1500);
  await point(byText('.px-mover', 'playwright'), 800); await hold(1500);
  await point(spot(await farmer('index')), 700); await hold(1500);
  // 7. The list
  await say('Or read them as a list', 'Sorted by who needs you, with a warning when two agents write to the same repo.');
  await click(q('[data-farm-nav="list"]'), 700);
  await until("document.getElementById('main').dataset.view === 'list'", 3000); await hold(900);
  await point(q('#list .row'), 700); await hold(1300);
  await point(q('#kpis .kpi.k-collide'), 600); await hold(900);
  await point(q('#rail .card.collide'), 700); await hold(2200);
  // The end
  await say(null);
  await moveTo([VW - 40, VH - 40], 600);
  await js(`window.__demo.card(${JSON.stringify(`${logo}<div>Agentville</div><small>github.com/hamsathul/agentville</small>`)})`);
  await hold(4000);
  await send('Page.stopScreencast');
  await sleep(300);
} finally {
  for (const t of timers) clearInterval(t);
  browser.close();
  for (const p of sleepers) p.kill();
  await handle.stop();
}

/* ---------- frames to video ---------- */

if (shot.length < 10) { console.error(`only ${shot.length} frames: nothing to make`); process.exit(1); }
const { small } = makeVideos({ shot, out: OUT, temp });
rmSync(temp, { recursive: true, force: true });
rmSync(DEMO, { recursive: true, force: true });
log(`made ${OUT} and ${small}`);
