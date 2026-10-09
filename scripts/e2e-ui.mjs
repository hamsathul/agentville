#!/usr/bin/env node
// Browser test of the dashboard. Starts a collector on a fixture (two sessions in a small git
// repo, one asking a question, with a stand-in for the mod so the question can be answered),
// drives headless Chrome over the DevTools protocol (scripts/lib/cdp.mjs), and checks the list view,
// the farm (inside its sandboxed frame: fjs/funtil look there), its sidebar, the info dialog and a
// field close-up. No dependencies; needs Chrome (set CHROME to
// its path if it isn't in the usual place). Exits 1 if a check fails.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCollector } from '../collector/collector.mjs';
import { readPs } from '../collector/sources/ps.mjs';
import { openChrome } from './lib/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** A one-page PDF saying `text`. */
function tinyPdf(text) {
  const stream = `BT /F1 18 Tf 20 40 Td (${text}) Tj ET`;
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', `<</Length ${stream.length}>>stream\n${stream}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let out = '%PDF-1.4\n';
  const at = objs.map((o, i) => { const n = out.length; out += `${i + 1} 0 obj${o}endobj\n`; return n; });
  return `${out}xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${out.length}\n%%EOF\n`;
}
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

if (!CHROME) {
  console.error('Chrome not found: set CHROME to its path.');
  process.exit(1);
}

/* ---------- fixture ---------- */

const temp = mkdtempSync(join(tmpdir(), 'tracker-ui-'));
const root = join(temp, 'root');
cpSync(join(ROOT, 'web'), join(root, 'web'), { recursive: true });
// permissionGuessSec: the working session's command never finishes and its process is quiet, so after
// the default 20s it would count as "probably a permission prompt" (waiting) partway through the run.
const worldsDir = join(temp, 'worlds');
writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, pollMs: 300, permissionGuessSec: 3600, worldsDir }));
// One plain world of the user's, built on the engine's defaults.
mkdirSync(join(worldsDir, 'sample'), { recursive: true });
writeFileSync(join(worldsDir, 'sample', 'world.json'), JSON.stringify({ name: 'Sample', icon: '🧪', description: 'A world made for the test', api: 1, nouns: { diary: 'Lab book' } }));
writeFileSync(join(worldsDir, 'sample', 'world.js'), `(() => {
  // Each agent a block of its colour; each repo a bed of the engine's grid; a plain green ground.
  Agentville.world({
    W: 300,
    slots: f => (f.state === 'working' && f.field
      ? { group: 'st:' + f.field, at: used => { const off = [0, -14, 14].find(o => !used.includes(o)) ?? 0; used.push(off); return [150 + off, 170]; }, zone: 'work' }
      : { group: f.state, cap: 8, at: i => [30 + i * 16, 60], zone: f.state }),
    drawChar: (f, b) => px(b.x - 3, b.y - 10, 6, 10, f.shirt),
    bg: (fill, season, ext) => fill(ext.x0, ext.y0, ext.x1 - ext.x0, ext.y1 - ext.y0, '#3f7d3a'),
  });
})();`);

const repo = join(realpathSync(temp), 'farm-repo');
mkdirSync(join(repo, 'src'), { recursive: true });
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
git('init', '-q', '-b', 'main');
writeFileSync(join(repo, 'src', 'app.ts'), 'export const a = 1;\n');
writeFileSync(join(repo, 'README.md'), '# Farm repo\n');
git('add', '.');
git('commit', '-q', '-m', 'init');
writeFileSync(join(repo, 'src', 'app.ts'), 'export const a = 2;\n'); // one uncommitted change
mkdirSync(join(repo, 'docs'));
writeFileSync(join(repo, 'docs', 'plan.md'), '# Plan\n\n- grow pumpkins\n');
// Files that aren't text: a picture, a PDF, a page with its CSS, script and picture beside it, a sheet, a Word document.
writeFileSync(join(repo, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="#4a4"/></svg>');
writeFileSync(join(repo, 'report.pdf'), tinyPdf('Harvest report'));
mkdirSync(join(repo, 'site'));
writeFileSync(join(repo, 'site', 'index.html'), '<!doctype html><link rel="stylesheet" href="style.css"><h1>Harvest</h1><img src="../pic.svg"><script type="module" src="app.js"></script>');
writeFileSync(join(repo, 'site', 'style.css'), 'body { color: rgb(1, 2, 3); }');
writeFileSync(join(repo, 'site', 'app.js'), `addEventListener('load', async () => {
  let sealed = false;
  try { void parent.document.title; } catch { sealed = true; }
  const api = await fetch('/api/state').then(() => 'read', () => 'blocked');
  const beside = await fetch('style.css').then(r => r.text()).then(() => 'read', () => 'blocked');
  parent.postMessage({ ran: true, sealed, api, beside, origin: self.origin, color: getComputedStyle(document.body).color, img: document.querySelector('img').naturalWidth }, '*');
});`);
writeFileSync(join(repo, 'crops.csv'), 'crop,acres\nWheat,12\nPumpkins,3\n');
const hasTextutil = existsSync('/usr/bin/textutil');
if (hasTextutil) {
  writeFileSync(join(temp, 'brief.html'), '<h1>Brief</h1><p><b>Bold</b> words</p>');
  execFileSync('textutil', ['-convert', 'docx', '-output', join(repo, 'brief.docx'), join(temp, 'brief.html')]);
}

const claudeDir = join(temp, 'claude');
mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
mkdirSync(join(claudeDir, 'projects', '-farm-repo'), { recursive: true });
const worker = spawn('sleep', ['600'], { stdio: 'ignore' }); // live pids for the other sessions
const doneA = spawn('sleep', ['600'], { stdio: 'ignore' });
const doneB = spawn('sleep', ['600'], { stdio: 'ignore' });
const resting = spawn('sleep', ['600'], { stdio: 'ignore' }); // an idle session: nothing said yet
const now = Date.now();
const iso = ms => new Date(ms).toISOString();
const line = (ms, message, type = 'assistant') => JSON.stringify({ type, timestamp: iso(ms), cwd: repo, message });
const withId = (json, uuid) => JSON.stringify({ ...JSON.parse(json), uuid }); // a message's row id, where a fork is cut
const use = (ms, id, name, input) => line(ms, { model: 'claude-haiku', content: [{ type: 'tool_use', id, name, input }] });
const QUESTION = { question: 'Which crop next?', header: 'Crop', multiSelect: false, options: [{ label: 'Wheat' }, { label: 'Pumpkins' }] };
const sessions = {
  'ui-asker': { pid: process.pid, lines: [
    withId(line(now - 60_000, { content: 'Plan the next crop' }, 'user'), 'ui-p1'),
    use(now - 50_000, 'toolu_W1', 'Write', { file_path: join(repo, 'docs', 'plan.md'), content: '# Plan' }),
    // a subagent at work: its own transcript is written below
    use(now - 46_000, 'toolu_SUB1', 'Agent', { description: 'Survey the fields', subagent_type: 'Explore', prompt: 'Survey every field and list what grows where.' }),
    // a reply with a code block wider than any panel: it scrolls inside its bubble, the panel stays put
    line(now - 45_000, { model: 'claude-haiku', content: [{ type: 'text', text: `The rotation:\n\n\`\`\`\n${'wheat → barley → clover → pumpkins → '.repeat(6)}fallow\n\`\`\`` }] }),
    use(now - 40_000, 'toolu_E1', 'Edit', { file_path: join(repo, 'src', 'app.ts'), old_string: '1', new_string: '2' }),
    line(now - 35_000, { model: 'claude-haiku', content: [{ type: 'text', text: 'Here is the field as it is now: `pic.svg`' }] }), // a picture named in a reply
    withId(line(now - 30_000, { model: 'claude-haiku', content: [{ type: 'text', text: 'Plan written. One question before I go on.' }] }), 'ui-r1'), // a reply to fork from
    use(now - 20_000, 'toolu_ASK1', 'AskUserQuestion', { questions: [QUESTION] }),
  ] },
  'ui-worker': { pid: worker.pid, lines: [
    line(now - 30_000, { content: 'Run the tests' }, 'user'),
    use(now - 5_000, 'toolu_B1', 'Bash', { command: 'npm test' }),
  ] },
  // Two finished sessions: they stand side by side on the porch, each with a speech bubble.
  'ui-done-a': { pid: doneA.pid, status: 'idle', lines: [
    line(now - 90_000, { content: 'Update the docs' }, 'user'),
    use(now - 85_000, 'toolu_SM1', 'SendMessage', { to: 'ui-done-b', summary: 'Docs are done', message: 'The README is updated; the release notes can link to it.' }),
    line(now - 80_000, { model: 'claude-haiku', content: [{ type: 'text', text: 'I updated the README and the changelog. Everything is committed and the tests pass on every platform.' }] }),
    JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: iso(now - 79_000), durationMs: 1000 }),
  ] },
  'ui-idle': { pid: resting.pid, status: 'idle', lines: [] },
  'ui-done-b': { pid: doneB.pid, status: 'idle', lines: [
    line(now - 70_000, { content: 'Prepare the release' }, 'user'),
    line(now - 60_000, { model: 'claude-haiku', content: [{ type: 'text', text: 'The build is green on all three platforms and the release notes are ready for you to read.' }] }),
    JSON.stringify({ type: 'permission-mode', permissionMode: 'plan', sessionId: 'ui-done-b' }),
    JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: iso(now - 59_000), durationMs: 1000 }),
  ] },
};
for (const [id, s] of Object.entries(sessions)) {
  writeFileSync(join(claudeDir, 'sessions', `${s.pid}.json`), JSON.stringify({ pid: s.pid, sessionId: id, cwd: repo, name: id, status: s.status ?? 'busy' }));
  writeFileSync(join(claudeDir, 'projects', '-farm-repo', `${id}.jsonl`), `${s.lines.join('\n')}\n`);
}
// The subagent's own transcript, where Claude Code keeps it: <session>/subagents/agent-<id>.jsonl, and its .meta.json.
const subDir = join(claudeDir, 'projects', '-farm-repo', 'ui-asker', 'subagents');
mkdirSync(subDir, { recursive: true });
writeFileSync(join(subDir, 'agent-a1.meta.json'), JSON.stringify({ toolUseId: 'toolu_SUB1', agentType: 'Explore' }));
writeFileSync(join(subDir, 'agent-a1.jsonl'), `${[
  line(now - 45_000, { content: 'Survey every field and list what grows where.' }, 'user'),
  use(now - 40_000, 'toolu_G1', 'Grep', { pattern: 'wheat', path: repo }),
  JSON.stringify({ type: 'user', timestamp: iso(now - 39_000), cwd: repo, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_G1', content: 'north.md' }] } }),
  line(now - 30_000, { model: 'claude-haiku', content: [{ type: 'text', text: 'Wheat in the north field so far.' }] }),
  use(now - 3_000, 'toolu_G2', 'Grep', { pattern: 'pumpkins', path: repo }),
].join('\n')}\n`);
// A past session in the repo, finished and closed: the sessions dialog offers to resume it.
const PAST = '5e551011-aaaa-4bbb-8ccc-000000000001';
writeFileSync(join(claudeDir, 'projects', '-farm-repo', `${PAST}.jsonl`), `${[line(now - 86_400_000, { content: 'Plan the harvest' }, 'user'), JSON.stringify({ type: 'ai-title', aiTitle: 'Harvest planning' })].join('\n')}\n`);
const launched = []; // terminal windows the dashboard asked for
const ended = []; // sessions the dashboard ended (a stand-in: no real process is signalled)
const stopped = []; // shell commands the dashboard stopped (a stand-in: nothing real is signalled)
const sessionProcs = { commandOf: async () => 'claude', ttyOf: async () => 'ttys042', kill: pid => ended.push(pid), alive: pid => !ended.includes(pid), killGroup: (pgid, sig) => stopped.push([pgid, sig]), groupAlive: () => false };
// The working session's test run, as the Bash tool runs it: a shell of its own under the session.
const SHELL_PID = 999_001;
const readProcs = async () => {
  const procs = await readPs();
  procs.set(SHELL_PID, { pid: SHELL_PID, ppid: worker.pid, pgid: SHELL_PID, ageSec: 8, cpu: 30, rssKb: 51_200, command: "/bin/zsh -c source /x/.claude/shell-snapshots/snapshot-zsh-1-a.sh 2>/dev/null || true && eval 'npm test' < /dev/null && pwd -P >| /tmp/claude-1-cwd" });
  return procs;
};

// A stand-in for the mod in the asker's session: it says it is listening, keeps its offer of the
// question fresh, and takes an answer the dashboard hands it (deleting the file, as the mod does).
const state = join(root, 'state');
for (const d of ['pending', 'answers', 'mods']) mkdirSync(join(state, d), { recursive: true });
const offer = join(state, 'pending', 'toolu_ASK1.json');
writeFileSync(offer, JSON.stringify({ kind: 'question', toolUseId: 'toolu_ASK1', sessionId: 'ui-asker', createdAt: now - 20_000, questions: [QUESTION] }));
let answered = null;
// What the mod reads from $.session.usage(): this session's cost and the plan's limits.
const USAGE = { costUsd: 1.23, rateLimits: [{ kind: 'five_hour', percentUsed: 34, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() }, { kind: 'seven_day', percentUsed: 61, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }] };
const received = []; // messages the fake mod took from the dashboard
const fakeMod = setInterval(() => {
  const inbox = join(state, 'messages', 'ui-asker');
  if (existsSync(inbox)) for (const name of readdirSync(inbox)) {
    if (!name.endsWith('.json')) continue;
    received.push(JSON.parse(readFileSync(join(inbox, name), 'utf8')).text);
    unlinkSync(join(inbox, name));
  }
  writeFileSync(join(state, 'mods', 'ui-asker.json'), JSON.stringify({ sessionId: 'ui-asker', version: 'ui-test', at: Date.now(), usage: USAGE }));
  if (existsSync(offer)) utimesSync(offer, new Date(), new Date());
  for (const name of readdirSync(join(state, 'answers'))) {
    if (!name.endsWith('.json')) continue;
    answered = JSON.parse(readFileSync(join(state, 'answers', name), 'utf8'));
    unlinkSync(join(state, 'answers', name));
    rmSync(offer, { force: true });
  }
}, 100);

/* ---------- browser ---------- */

// A stand-in for the claude CLI, for the ⚙ Claude Code dialog: two plugins, their details, MCP servers.
const fakeClaude = join(temp, 'claude-cli');
const cliLog = join(temp, 'claude-cli.log');
writeFileSync(fakeClaude, `#!/bin/sh
case "$1 $2" in
  "agents --json") echo '[]' ;;
  "plugin list") echo '[{"id":"crops@farm-market","version":"1.2.0","enabled":true,"scope":"user"},{"id":"weather@farm-market","version":"0.3.0","enabled":false,"scope":"user"}]' ;;
  "plugin details") printf '$2 1.0\\n  Description: For the farm.\\n\\nComponent inventory\\n  Skills (2)  sow, reap\\n  Agents (0)\\n  Hooks (0)\\n  MCP servers (1)  barn\\n  LSP servers (0)\\n\\nProjected token cost\\n  Always-on:   ~1,500 tok   added to every session\\n' ;;
  "plugin enable"|"plugin disable"|"plugin update"|"plugin uninstall") echo "$*" >> '${cliLog}'; echo "Done" ;;
  "mcp list") printf 'Checking MCP server health…\\n\\nsilo: https://silo.example/mcp (HTTP) - ! Needs authentication\\nplugin:crops:barn: https://barn.example/mcp (HTTP) - ✔ Connected\\n' ;;
esac
`, { mode: 0o755 });
writeFileSync(join(claudeDir, 'settings.json'), `${JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }, null, 2)}\n`);
// Finder's folder window is stood in for: it always picks the farm repo.
const handle = await startCollector({ root, claudeDir, claudeBin: fakeClaude, notify: () => {}, log: () => {}, home: '/nowhere', readProcs, folderRoots: [realpathSync(temp)], chooseFolder: async () => ({ path: `${join(realpathSync(temp), 'farm-repo')}/` }), scratchBase: '/nonexistent', sessionProcs, launch: async args => { launched.push(args.at(-1)); return { code: 0, stdout: '', stderr: '' }; } });
let chrome;
try {
  chrome = await openChrome();
  const { send, errors } = chrome;
  const js = expr => chrome.js(expr).catch(() => undefined);
  // The farm draws inside its world's frame (sandboxed: it may run in a process of its own).
  const fjs = expr => chrome.inFrame('/world/', expr).catch(() => undefined);
  const shot = async name => { // optional: SHOTS=<folder> saves pictures of the page along the way
    if (!process.env.SHOTS) return;
    await sleep(400);
    writeFileSync(join(process.env.SHOTS, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  };
  const until = async (expr, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await js(expr)) return true;
    return false;
  };
  const funtil = async (expr, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await fjs(expr)) return true;
    return false;
  };
  /** Where the world's frame sits in the page, for real mouse events (which take the page's coordinates). */
  const frameAt = async () => JSON.parse(await js("JSON.stringify((r => [r.left, r.top])(document.querySelector('#farm .world-frame').getBoundingClientRect()))"));
  await send('Page.enable');
  await send('Runtime.enable');
  if (process.env.THROTTLE) await send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) }); // e.g. THROTTLE=6 to act like a slow CI runner
  if (process.env.REDUCED_MOTION) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); // the farm stands still
  console.log(`reduced motion: ${await js("matchMedia('(prefers-reduced-motion: reduce)').matches")}`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${handle.port}/` });

  console.log('List view');
  check(await until("document.querySelectorAll('.row').length >= 2 && !!document.querySelector('.ask legend')"), 'both agents are listed and the waiting one fills the centre');
  check((await js('document.title')) === '(1) Agentville', 'the tab title counts one agent waiting');
  check(await js("[...document.querySelectorAll('.row')].some(r => r.textContent.includes('ui-asker') && r.textContent.includes('answer here'))"), 'the waiting row says it can be answered here');
  check(/Which crop next\?/.test(await js("document.querySelector('.ask legend')?.textContent ?? ''")), 'the centre shows the question');
  check(await until("[...document.querySelectorAll('#tree .tn')].some(b => b.textContent.includes('README.md'))"), "the explorer lists the agent's folder");
  check(await js("[...document.querySelectorAll('#center-body .bub.you')].some(b => b.textContent.includes('Plan the next crop'))"), 'the conversation shows the prompt');
  check(await until("document.querySelector('#center-body .named-pic img')?.naturalWidth === 30"), 'a picture a reply names shows under it, as a thumbnail');
  await shot('named-thumb');
  await js("document.querySelector('#center-body .named-pic').click()");
  check(await until("document.getElementById('file-dlg').open && document.getElementById('reader-img')?.naturalWidth === 30 && document.getElementById('main').dataset.view === 'list'"), 'one click opens it in the file dialog, in the list view too');
  await js("document.querySelector('#file-dlg [data-file-close]').click()");
  check(await until("!document.getElementById('file-dlg').open && !!document.querySelector('#center-body .ov')"), 'closed, the agent is still there behind it');
  await js("document.querySelector('.row[data-id=\"ui-done-a\"]').click()");
  check(await until("[...document.querySelectorAll('#center-body .bub.peer.out')].some(b => /to ui-done-b · Docs are done/.test(b.textContent))"), "an agent's conversation shows the message it sent another agent");
  await js("document.querySelector('.row[data-id=\"ui-asker\"]').click()");
  await until("!!document.querySelector('.ask legend')");
  check(await until("/Plan.*5-hour 34%.*week 61%/.test(document.getElementById('hstats').textContent)"), "the top bar shows the plan's 5-hour and weekly limits");
  check(await js("/Cost\\s*\\$1\\.23/.test(document.getElementById('center-body').textContent)"), 'the agent panel shows what the session has cost so far');
  // What sticks out past a panel's right edge, innermost first: names the culprit when a check fails.
  const sideways = sel => js(`(() => {
    const p = document.querySelector('${sel}'), pre = p.querySelector('.bub pre'), edge = p.getBoundingClientRect().right;
    const clipped = e => { for (let a = e.parentElement; a && a !== p; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true; return false; };
    const reach = e => e.getBoundingClientRect().left + (getComputedStyle(e).overflowX === 'visible' ? Math.max(e.scrollWidth, e.getBoundingClientRect().width) : e.getBoundingClientRect().width); // its box, or its text spilling out
    const sticks = e => reach(e) > edge + 1 && !clipped(e);
    const out = [...p.querySelectorAll('*')].filter(e => sticks(e) && ![...e.children].some(sticks));
    const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].map(c => '.' + c).join('') + ' ' + Math.round(reach(e) - e.getBoundingClientRect().left) + 'px "' + e.textContent.trim().slice(0, 40) + '"';
    return \`panel \${p.clientWidth}, content \${p.scrollWidth}, code block \${pre ? pre.clientWidth + ' of ' + pre.scrollWidth : 'none'}\${out.length ? ', sticking out: ' + out.slice(0, 4).map(name).join(', ') : ''}\`;
  })()`);
  const fits = sel => js(`(() => { const p = document.querySelector('${sel}'), pre = p.querySelector('.bub pre'); return !!pre && p.scrollWidth <= p.clientWidth + 1 && pre.scrollWidth > pre.clientWidth; })()`);
  check(await fits('#center-body'), `a reply with a wide code block scrolls inside its bubble; the agent panel doesn't scroll sideways (${await sideways('#center-body')})`);
  // Its subagent, on a tab of its own: a card saying what it is doing, opened to its prompt; ⤢ Read for its own transcript.
  check(await js("!document.querySelector('#center-body .sub-card') && /Subagents\\s*1/.test(document.querySelector('#center-tabs [data-tab=\"@subagents\"]')?.textContent ?? '')"), 'subagents are not in the main view: they have a tab, saying how many');
  await js("document.querySelector('#center-tabs [data-tab=\"@subagents\"]').click()");
  check(await until("[...document.querySelectorAll('#center-body .sub-card.running')].some(c => /Explore/.test(c.textContent) && /Survey the fields/.test(c.textContent) && /Grep/.test(c.textContent) && /Wheat in the north field/.test(c.textContent))"), "a subagent's card says what it is doing: its task, its step now, what it last said");
  await js("document.querySelector('#center-body .sub-card [data-child]').click()");
  check(await until("/Survey every field and list what grows where/.test(document.querySelector('#center-body .sub-prompt')?.textContent ?? '')"), 'opened, it shows the prompt it was given and its steps');
  await js("document.querySelector('#center-body .sub-card [data-convo]').click()");
  check(await until("document.getElementById('convo').open && /^Explore · Survey the fields · ui-asker's subagent$/.test(document.getElementById('convo-title').textContent) && /Wheat in the north field/.test(document.getElementById('convo-body').textContent)"), "⤢ Read opens the subagent's own transcript");
  check(await js("document.getElementById('convo-compose').innerHTML === ''"), 'a subagent takes no messages: no box');
  await js("document.getElementById('convo').close()");
  await js("document.querySelector('#center-tabs [data-tab=\"\"]').click()"); // back to the agent's own view
  await until("!!document.querySelector('#center-body [data-convo=\"ui-asker\"]')");
  // The conversation dialog: the whole conversation, oldest first, with search.
  await js("document.querySelector('#center-body [data-convo=\"ui-asker\"]').click()");
  check(await until("document.getElementById('convo').open && document.querySelectorAll('#convo-body .bub').length >= 3"), '⤢ Read all opens the whole conversation in a dialog');
  check(await until("document.querySelector('#convo-body .named-pic img')?.naturalWidth === 30"), 'the picture a reply names shows there too');
  check(await js("document.querySelector('#convo-body .bub').textContent.includes('Plan the next crop')"), 'oldest first');
  const search = q => js(`(() => { const i = document.getElementById('convo-q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const enter = (shift = false) => js(`document.getElementById('convo-q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: ${shift}, bubbles: true }))`);
  await search('BARLEY');
  check(await until("document.getElementById('convo-count').textContent === '1 of 6'"), `a search counts its matches, any case, starting at the newest (${await js("document.getElementById('convo-count').textContent")})`);
  check(await js("CSS.highlights.get('convo-hit')?.size === 6 && CSS.highlights.get('convo-now')?.size === 1"), 'every match is highlighted in place, the current one apart');
  await enter();
  check(await until("document.getElementById('convo-count').textContent === '2 of 6'"), 'Enter goes to the next older match');
  await enter(true);
  check(await until("document.getElementById('convo-count').textContent === '1 of 6'"), 'Shift+Enter comes back');
  await search('no such words');
  check(await until("document.getElementById('convo-count').textContent === 'No matches'"), 'no match says so');
  await js("document.getElementById('convo').close()");
  check(await until("!document.getElementById('convo').open && !CSS.highlights.has('convo-hit')"), 'closing it clears the highlights');
  const key = (type, mods = 0) => send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: mods, ...(type === 'keyDown' ? { text: '\r' } : {}) }); // a real key press carries its text
  await js("document.getElementById('msg-text').focus()");
  await send('Input.insertText', { text: 'First line' });
  await key('keyDown', 8); await key('keyUp', 8); // Shift+Enter
  await send('Input.insertText', { text: 'second line' });
  check(/First line\nsecond line/.test(await js("document.getElementById('msg-text').value")) && received.length === 0, 'Shift+Enter in the message box starts a new line');
  await key('keyDown'); await key('keyUp');
  for (let i = 0; i < 40 && !received.length; i++) await sleep(150);
  check(received[0] === 'First line\nsecond line', `Enter sends the message (got ${JSON.stringify(received)})`);
  check(await until("document.getElementById('msg-text')?.value === ''"), 'the message box clears once it is sent');
  const arrow = async (name, code) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code }); };
  await js("document.getElementById('msg-text').focus()"); // sending leaves the box (so the page can update): back in it
  await arrow('ArrowUp', 38);
  check(await until("document.getElementById('msg-text')?.value === 'Plan the next crop'"), `↑ in the message box brings back what you said to the session (got ${JSON.stringify(await js("document.getElementById('msg-text')?.value"))})`);
  await arrow('ArrowDown', 40);
  check(await until("document.getElementById('msg-text')?.value === ''"), '↓ goes back to what you were typing');
  await js("document.querySelector('#center-body [data-fork=\"ui-r1\"]').click()");
  check(await until("document.getElementById('fork-dlg').open && document.getElementById('fork-mode').options.length === 5 && document.getElementById('fork-model').value === 'haiku'"), "⑂ Fork on a reply asks in what mode, model and effort, the session's own to start with");
  await js("document.getElementById('fork-go').click()");
  const forked = await until("!document.getElementById('fork-dlg').open && /Forking ui-asker/.test(document.getElementById('notice').textContent)") ? launched.at(-1) : '';
  const copy = /--resume '([^']+)'/.exec(forked)?.[1] ?? '';
  check(forked === `cd '${repo}' && exec claude --resume '${copy}' --fork-session --name 'ui-asker (fork)' --model 'haiku'` && readFileSync(copy, 'utf8').trim().split('\n').at(-1).includes('"ui-r1"'),
    `confirmed, a terminal resumes a copy of the conversation cut at that reply as a new session (got ${forked})`);
  check(await js("!document.querySelector('#center-body [data-restore=\"ui-r1\"]') && !!document.querySelector('#center-body [data-restore=\"ui-p1\"]')"), '↺ Restore is on your messages only');
  await js("document.querySelector('#center-body [data-restore=\"ui-p1\"]').click()");
  check(await until("document.getElementById('restore-dlg').open && document.getElementById('restore-what').value === 'both' && document.getElementById('restore-mode').options.length === 5 && !document.getElementById('restore-code-note').hidden"), '↺ Restore asks what to put back (the conversation and code to start with) and says what restoring code can undo');
  await js("(() => { const w = document.getElementById('restore-what'); w.value = 'conversation'; w.dispatchEvent(new Event('change', { bubbles: true })); })()");
  check(await js("document.getElementById('restore-code-note').hidden"), 'the note on code goes away for the conversation only');
  await js("document.querySelector('#restore-dlg [data-restore-cancel]').click()");
  check(await until("!document.getElementById('restore-dlg').open"), 'Cancel leaves it as it is');
  await js("document.querySelector('#center-body [data-convo=\"ui-asker\"]').click()");
  await until("!!document.getElementById('convo-msg-text')");
  await js("document.getElementById('convo-msg-text').focus()"); // before the conversation has loaded
  await until("/messages since/.test(document.getElementById('convo-sub').textContent)");
  check(await js("document.activeElement?.id === 'convo-msg-text'"), 'the reply box keeps the focus once the conversation has loaded');
  await send('Input.insertText', { text: 'Sent from the conversation dialog' });
  await key('keyDown'); await key('keyUp');
  for (let i = 0; i < 40 && received.length < 2; i++) await sleep(150);
  check(received[1] === 'Sent from the conversation dialog', `the conversation dialog has the message box too: Enter sends from it (got ${JSON.stringify(received)})`);
  await js("document.getElementById('convo').close()");
  await js("document.getElementById('msg-folder').click()");
  check(await until("/farm-repo/.test(document.querySelector('#center-body .thumb-folder')?.textContent ?? '')"), "📁 Folder attaches the folder picked in Finder's window");
  await js("document.getElementById('msg-send').click()");
  for (let i = 0; i < 40 && received.length < 3; i++) await sleep(150);
  check(received[2] === `Please look at the folder I attached. Look in it with your tools:\n${repo}`, `sent, the message carries its path (got ${JSON.stringify(received[2])})`);
  const theme = await js('document.documentElement.dataset.theme ?? "auto"');
  await js("document.getElementById('theme-toggle').click()");
  check((await js('document.documentElement.dataset.theme ?? "auto"')) !== theme, 'the theme button switches the theme');

  console.log('Files that are not text');
  const openIn = path => js(`openFile('ui-asker', ${JSON.stringify(join(repo, path))})`);
  await openIn('pic.svg');
  check(await until("document.getElementById('reader-img')?.naturalWidth === 30"), 'a picture shows, through its short-lived link');
  check(await until("/^30 × 20 · 1 KB$/.test(document.getElementById('reader-media-meta')?.textContent ?? '')"), `with its size (${await js("document.getElementById('reader-media-meta')?.textContent")})`);
  await shot('file-picture');
  await openIn('report.pdf');
  const frames = async () => {
    const all = [], walk = f => { all.push(f.frame); (f.childFrames ?? []).forEach(walk); };
    walk((await send('Page.getFrameTree')).result.frameTree);
    return all;
  };
  let pdf;
  for (let i = 0; i < 40 && !pdf; i++, await sleep(150)) pdf = (await frames()).find(f => /\/raw\/\w+\/report\.pdf$/.test(f.url) && f.mimeType === 'application/pdf');
  check(Boolean(pdf), `a PDF opens in the browser's PDF viewer (${JSON.stringify((await frames()).slice(1).map(f => [f.url, f.mimeType]))})`);
  await shot('file-pdf');
  await js("window.fromPage = []; addEventListener('message', e => fromPage.push(e.data)); true");
  await openIn('site/index.html');
  check(await until('fromPage.some(m => m?.ran)'), 'a page previews as itself: its script runs (a module, from beside it)');
  const got = JSON.parse(await js('JSON.stringify(fromPage.find(m => m?.ran) ?? {})'));
  check(got.sealed === true && got.origin === 'null' && got.api === 'blocked' && got.beside === 'blocked', `sealed off: an origin of its own, reaching neither the dashboard nor its data, nor reading the files beside it (${JSON.stringify(got)})`);
  check(got.color === 'rgb(1, 2, 3)' && got.img === 30, 'with the CSS and the picture beside it');
  await shot('file-page');
  await js("document.querySelector('[data-reader-mode=\"source\"]').click()");
  check(await until("/<h1>Harvest<\\/h1>/.test(document.querySelector('#reader-body .l')?.textContent ?? '') && !!document.getElementById('reader-quote')"), 'Source shows its code, to quote');
  await openIn('crops.csv');
  check(await until("/Wheat/.test(document.querySelector('#reader-body table.sheet')?.textContent ?? '') && document.querySelector('#reader-body td.num')?.textContent === '12'"), 'a CSV shows as a table');
  await shot('file-sheet');
  if (hasTextutil) {
    await openIn('brief.docx');
    check(await until("/<b>Bold<\\/b>|font-weight: bold/.test(document.querySelector('#reader-body iframe.page')?.srcdoc ?? '')"), 'a Word document shows as a page');
    await shot('file-word');
    await js("document.querySelector('[data-reader-mode=\"text\"]').click()");
    check(await until("/Bold words/.test(document.querySelector('#reader-body .doc-text')?.textContent ?? '')"), 'and as its words');
  }
  check(errors.length === 0, `no errors on the page (${errors.join(' | ')})`);
  await js("document.querySelector('#center-tabs [data-tab=\"\"]').click()");

  console.log('Commands running');
  await js("document.querySelector('.row[data-id=\"ui-worker\"]').click()");
  check(await until("/Commands running[\\s\\S]*\\$ npm test[\\s\\S]*30% CPU · 50 MB/.test(document.getElementById('center-body').textContent)"), "the working agent's panel lists the command it runs, with its time, CPU and memory");
  await js("document.querySelector('#center-body [data-shell-stop]').click()");
  check(await until("document.getElementById('confirm').open && /Stop “npm test”/.test(document.getElementById('confirm-text').textContent)") && stopped.length === 0, '■ Stop asks first');
  await js("document.getElementById('confirm-yes').click()");
  check(await until("/Stopped “npm test”/.test(document.getElementById('notice').textContent)") && JSON.stringify(stopped[0]) === JSON.stringify([SHELL_PID, 'SIGTERM']), `confirmed, it stops the command's whole process group (${JSON.stringify(stopped)})`);
  await js("document.querySelector('.row[data-id=\"ui-asker\"]').click()");

  console.log('Farm');
  await js("document.getElementById('view-farm').click()");
  check(await until("document.getElementById('main').dataset.view === 'farm'") && await funtil("document.querySelectorAll('.px-tag').length >= 2"), 'the farm shows both farmers');
  check(await js("(f => !!f && f.getAttribute('sandbox') === 'allow-scripts' && f.src.endsWith('/world/farm/'))(document.querySelector('#farm .world-frame'))"), 'the farm runs in a sandboxed frame of its own');
  // No token, and no cookies: the sandbox refuses even to read them (a SecurityError), as it does storage.
  check(await fjs('typeof TOKEN === "undefined" && (() => { try { return !document.cookie; } catch (e) { return e.name === "SecurityError"; } })()'), 'the farm has no token');
  check(await funtil("[...document.querySelectorAll('.px-tag')].some(t => t.textContent.startsWith('ui-asker') && t.classList.contains('st-waiting'))"), 'the waiting agent is on the porch');
  check(/1 needs you/.test(await fjs("document.querySelector('.px-hud')?.textContent ?? ''")), 'the farm says one needs you');
  const porch = JSON.parse(await fjs("JSON.stringify(['ui-done-a', 'ui-done-b', 'ui-asker'].map(id => (r => r.left + r.width / 2)(document.querySelector(`.px-tag[data-farmer='${id}']`).getBoundingClientRect())))"));
  const cs0 = await fjs("(c => c.getBoundingClientRect().width / Number(c.dataset.ew))(document.querySelector('#farm canvas'))");
  check(Math.abs(porch[0] - porch[1]) >= 22 * cs0 - 1, `farmers on the porch stand apart, none hidden behind another (${Math.round(Math.abs(porch[0] - porch[1]) / cs0)} apart)`);
  check(await funtil("!!document.querySelector('.px-tag[data-farmer=\"ui-idle\"]')"), 'an idle farmer rests under the tree');
  await fjs("document.querySelector('[data-farm-resting]').click()");
  check(await funtil("!document.querySelector('.px-tag[data-farmer=\"ui-idle\"]') && /Resting: hidden \\([1-9]\\d*\\)/.test(document.querySelector('[data-farm-resting]').textContent)"), 'the Resting switch hides idle and stale farmers, and says how many');
  await fjs("document.querySelector('[data-farm-resting]').click()");
  check(await funtil("!!document.querySelector('.px-tag[data-farmer=\"ui-idle\"]')"), 'and shows them again');
  check(await until("/ui-done-a\\s*sends a note to ui-done-b/.test(document.getElementById('farm-diary').textContent)"), "a message from one agent to another goes in the farm diary (and flies as a pigeon)");
  // To the list and back: the farm's frame stays (hidden meanwhile), with its diary and all it remembers.
  await js("window.__farmFrame = document.querySelector('#farm .world-frame'); document.getElementById('view-list').click()");
  await until("document.getElementById('main').dataset.view === 'list'");
  await sleep(1000);
  await js("document.getElementById('view-farm').click()");
  await until("document.getElementById('main').dataset.view === 'farm'");
  await sleep(1500); // a new frame's farm would have said its (empty) diary by now
  check(await js("document.querySelector('#farm .world-frame') === window.__farmFrame && /ui-done-a\\s*sends a note to ui-done-b/.test(document.getElementById('farm-diary').textContent)") && await funtil("document.querySelectorAll('.px-tag').length >= 2"),
    'back from the list, the farm is the same frame, its diary as it was');
  for (let i = 0; i < 3 && !/Sky: night/.test(await fjs("document.querySelector('[data-farm-sky]').textContent")); i++) await fjs("document.querySelector('[data-farm-sky]').click()");
  await sleep(600);
  check(/Sky: night/.test(await fjs("document.querySelector('[data-farm-sky]').textContent")) && errors.length === 0, 'the farm draws its night, lights and all, without errors');
  if (!(await js("matchMedia('(prefers-reduced-motion: reduce)').matches"))) { // a zoom glides from the view as it was: no jump, no dark edges
    const zoomStep = async (step, label, grows) => { // the farm's width on every frame of the glide: it only ever moves toward the new size
      const g = JSON.parse(await fjs(`(async () => { const st = document.querySelector('#farm canvas').parentElement, a = st.getBoundingClientRect().width; document.querySelector('[data-farm-zoom="${step}"]').click(); const w = []; const end = performance.now() + 400; await new Promise(done => { const tick = () => { w.push(st.getBoundingClientRect().width); if (performance.now() < end) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); }); return JSON.stringify([a, Math.min(...w), Math.max(...w), w.length].map(Math.round)); })()`));
      const [was, low, high] = g;
      check(grows ? low >= was - 1 : high <= was + 1, `${label} glides from the farm as it was, never past it (${grows ? 'smallest' : 'largest'} ${grows ? low : high}px against ${was}px, over ${g[3]} frames)`);
    };
    await zoomStep('1', 'zooming in from the whole farm', true);
    await zoomStep('1', 'zooming in further', true);
    await zoomStep('0', 'zooming back out', false);
  }
  for (let i = 0; i < 3 && !/Sky: live/.test(await fjs("document.querySelector('[data-farm-sky]').textContent")); i++) await fjs("document.querySelector('[data-farm-sky]').click()");
  check(!/energy/i.test(await fjs("document.querySelector('.px-hud')?.textContent ?? ''")) && /34%[\s\S]*5-hour limit/.test(await fjs("document.querySelector('.px-stats').textContent")), "the farm has no vague energy bar; the plan's usage is in its panel");
  check(await js("getComputedStyle(document.querySelector('header.top')).display === 'none' && getComputedStyle(document.getElementById('kpis')).display === 'none'"), 'the farm fills the window: no top bar or count cards above it');
  check(/waiting on you[\s\S]*working[\s\S]*your turn[\s\S]*collisions/.test(await fjs("document.querySelector('.px-stats').textContent")) && /RAM[\s\S]*CPU/.test(await fjs("document.querySelector('.px-stats').textContent")), "the count cards and the top bar's meters are in the farm's panel");
  // The working farmer calls two MCP servers: Gmail (done), then playwright (going on). Each has a cart waiting by the road to town.
  const done = id => JSON.stringify({ type: 'user', timestamp: iso(Date.now()), cwd: repo, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  appendFileSync(join(claudeDir, 'projects', '-farm-repo', 'ui-worker.jsonl'), `${[done('toolu_B1'), use(Date.now(), 'toolu_GM1', 'mcp__claude_ai_Gmail__search_threads', { query: 'harvest' }), done('toolu_GM1'),
    use(Date.now(), 'toolu_PW1', 'mcp__playwright__browser_navigate', { url: 'http://localhost:3000' })].join('\n')}\n`);
  const moverOf = name => `(() => { const m = [...document.querySelectorAll('.px-mover')].find(e => e.textContent.includes(${JSON.stringify(name)})); if (!m) return null; const r = m.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.bottom]); })()`;
  check(await funtil(`!!${moverOf('playwright')}`, 12_000), "an MCP call: its server's cart leaves its place by the road to town, with the server's name");
  const cartStart = JSON.parse(await fjs(moverOf('playwright')));
  const nearFarmer = `(() => { const c = JSON.parse(${moverOf('playwright')} ?? 'null'), t = document.querySelector('.px-tag[data-farmer="ui-worker"]').getBoundingClientRect(); return c && Math.abs(c[0] - (t.left + t.width / 2)) < 120 && Math.abs(c[1] - t.bottom) < 80; })()`;
  check(await funtil(nearFarmer, 20_000), `it goes to the farmer making the call, driving unless the farm stands still (from ${JSON.stringify(cartStart)} to ${await fjs(moverOf('playwright'))})`);
  await shot('farm-mcp-cart');
  check(!(await fjs(`!!${moverOf('Gmail')}`)), "a server no one is calling now waits in its place: no name out on the farm");
  check(await funtil("[...document.querySelectorAll('.px-lab')].some(l => l.textContent.startsWith('farm-repo'))"), 'the repo is a field');
  // The silo's tag near the plan's weekly limit: amber from 70%, red with white figures from 90%, never cream.
  const siloTag = cls => fjs(`(() => { const l = document.createElement('div'); l.className = 'px-lab cnt ${cls}'; document.querySelector('#farm').appendChild(l); const c = getComputedStyle(l); const out = [c.backgroundColor, c.color]; l.remove(); return JSON.stringify(out); })()`);
  const [red, amber] = [JSON.parse(await siloTag('silo-red')), JSON.parse(await siloTag('silo-amber'))];
  check(red[0] === 'rgb(224, 74, 58)' && amber[0] === 'rgb(240, 180, 41)', `the silo's tag turns amber near the weekly limit and red at it, so its white figures show (red ${red}, amber ${amber})`);
  check(await js(`Number.isInteger(JSON.parse(localStorage.getItem('tracker-world:farm:beds') || '{}')[${JSON.stringify(repo)}]?.i)`), 'the farm remembers which bed the field has, so it stays put as repos come and go');
  await fjs("document.querySelector('[data-farm-help]').click()");
  check(await fjs("document.querySelector('.px-help').open"), 'the info button opens how to read the farm');
  await fjs("document.querySelector('[data-farm-help-close]').click()");
  check(await fjs("!document.querySelector('.px-help').open"), 'the info dialog closes');
  // the buildings open things: a farm point to the screen (the canvas holds the forest round the farm too)
  const clickFarm = (x, y) => `(() => { const c = document.querySelector('#farm canvas'); const [px, pt] = c.dataset.pad.split(',').map(Number), r = c.getBoundingClientRect(), cs = r.width / Number(c.dataset.ew); c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + (${x} + px) * cs, clientY: r.top + (${y} + pt) * cs })); })()`;
  await fjs(clickFarm(200, 30));
  check(await funtil("document.querySelector('.px-dlg')?.open && /ui-asker/.test(document.querySelector('.px-dlg').textContent)"), 'clicking the farmhouse lists who is on your porch');
  await fjs("document.querySelector('[data-farm-dlg-close]').click()");
  await fjs(clickFarm(96, 40));
  check(await funtil("document.querySelector('.px-dlg')?.open && /plan/i.test(document.querySelector('.px-dlg-title').textContent)"), "clicking the silo shows the plan's usage");
  await fjs("document.querySelector('[data-farm-dlg-close]').click()");
  await fjs(clickFarm(62, 40));
  check(await until("document.getElementById('sessions').open"), 'clicking the barn opens Start or resume a session');
  await js("document.getElementById('sessions').close()");
  await fjs("document.querySelector('[data-farm-bell]').click()");
  check(/Bell: on/.test(await fjs("document.querySelector('[data-farm-bell]').textContent")) && await until("localStorage.getItem('tracker-bell') === 'on'"), 'the Bell switch turns on the chime for agents that start waiting');
  await fjs("document.querySelector('[data-farm-bell]').click()");

  check(await funtil("[...document.querySelectorAll('.px-say')].some(b => b.textContent.includes('Which crop next?'))"), "the waiting farmer's question is in a speech bubble over its head");
  check(await funtil("document.querySelectorAll('.px-say').length >= 3"), 'the two finished farmers have bubbles too');
  await sleep(4000); // let everyone reach the porch
  const overlapping = () => fjs(`(() => {
    const boxes = [...document.querySelectorAll('.px-say, .px-tag.st-waiting, .px-tag.st-turn, .px-tag.sel')].map(el => ({ el, r: el.getBoundingClientRect() }));
    const out = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!a.el.classList.contains('px-say') && !b.el.classList.contains('px-say')) continue; // tags among themselves are lifted already
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ix > 1 && iy > 1) out.push((a.el.dataset.say || a.el.textContent).slice(0, 12) + ' × ' + (b.el.dataset.say || b.el.textContent).slice(0, 12));
    }
    return out.join(', ');
  })()`);
  const overlaps = await overlapping();
  check(overlaps === '', `speech bubbles overlap neither each other nor the names shown${overlaps ? `: ${overlaps}` : ''}`);
  // Every bubble lies inside the farm's frame, however many farmers stand on the porch, in a big window or a small one.
  const outside = () => fjs(`(() => { const v = document.querySelector('#farm .px-view').getBoundingClientRect(); return [...document.querySelectorAll('.px-say')].filter(e => { const r = e.getBoundingClientRect(); return r.top < v.top - 1 || r.left < v.left - 1 || r.right > v.right + 1; }).map(e => e.dataset.say).join(', '); })()`);
  check(await outside() === '', `every speech bubble lies inside the farm's frame (${await outside()})`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 640, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  check(await outside() === '', `and in a small window, where the porch's bubbles run out of room above (${await outside()})`);
  check(await overlapping() === '', `there they move aside rather than onto each other (${await overlapping()})`);
  const underHud = () => fjs(`(() => { const hud = [...document.querySelectorAll('#farm .px-hud > div')].map(e => e.getBoundingClientRect()).filter(r => r.width); return [...document.querySelectorAll('.px-say')].filter(e => { const r = e.getBoundingClientRect(); return hud.some(h => Math.min(r.right, h.right) - Math.max(r.left, h.left) > 1 && Math.min(r.bottom, h.bottom) - Math.max(r.top, h.top) > 1); }).map(e => e.dataset.say).join(', '); })()`);
  check(await underHud() === '', `and clear of the panel and the buttons lying over the farm (${await underHud()})`);
  await shot('farm-bubbles-small');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  check(await fjs("getComputedStyle(document.querySelector('.px-tag[data-farmer=\"ui-worker\"]')).opacity === '0' && getComputedStyle(document.querySelector('.px-tag.st-waiting')).opacity === '1'"), "a working farmer's name waits for a hover; a waiting one's always shows");
  const hovered = await fjs(`(() => { const c = document.querySelector('#farm canvas'), t = document.querySelector('.px-tag[data-farmer="ui-worker"]').getBoundingClientRect(), cs = c.getBoundingClientRect().width / Number(c.dataset.ew);
    c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: t.left + t.width / 2, clientY: t.bottom + 10 * cs })); // on its sprite, just under its hidden name
    const on = document.querySelector('.px-tag[data-farmer="ui-worker"]').classList.contains('hover');
    c.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 })); document.querySelector('#farm .px-view').dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }));
    return on && !document.querySelector('.px-tag.hover'); })()`);
  check(hovered, 'hovering a farmer shows its name, and leaving hides it again');
  const corners = JSON.parse(await fjs(`(() => { const r = s => document.querySelector(s).getBoundingClientRect(), v = r('#farm .px-host'), st = r('.px-stats'), z = r('.px-zoombar'), t = r('.px-tools'), n = r('.px-nav');
    return JSON.stringify({ stats: st.left - v.left < 20 && st.top - v.top < 20, nav: v.right - n.right < 20 && n.top - v.top < 20, zoom: v.bottom - z.bottom < 20 && z.height < 40, tools: (b => v.bottom - b.bottom < 20 && b.height < 40 && Math.abs((b.left + b.right) / 2 - (v.left + v.right) / 2) < 40)((r => ({ left: Math.min(...r.map(x => x.left)), right: Math.max(...r.map(x => x.right)), bottom: Math.max(...r.map(x => x.bottom)), height: Math.max(...r.map(x => x.bottom)) - Math.min(...r.map(x => x.top)) }))([...document.querySelectorAll('.px-tools > button, .px-tools > .px-zoombar')].map(x => x.getBoundingClientRect()))) }); })()`));
  check(corners.stats && corners.nav && corners.zoom && corners.tools, `the controls lie over the farm: the panel top left, the dashboard's buttons top right, a slim row of switches and zoom along the bottom (${JSON.stringify(corners)})`);
  await fjs("document.querySelector('[data-farm-nav=\"theme\"]').click()");
  check(await until("document.documentElement.dataset.theme !== 'dark'"), "the farm's own buttons work the dashboard: the theme changes");
  // Each click reaches the page as a message (wait for it before looking again), and the page takes one
  // press of the top bar's buttons a quarter second.
  for (let i = 0; i < 2 && (await js("document.documentElement.dataset.theme")) !== 'dark'; i++) {
    const was = await js("document.documentElement.dataset.theme ?? 'auto'");
    await sleep(300);
    await fjs("document.querySelector('[data-farm-nav=\"theme\"]').click()");
    await until(`(document.documentElement.dataset.theme ?? 'auto') !== ${JSON.stringify(was)}`, 2000);
  }
  await sleep(300);
  await fjs("document.querySelector('[data-farm-nav=\"setup\"]')?.click()");
  check(await until("document.getElementById('setup').open"), "the farm's buttons have ⚙ Claude Code too, opening its dialog");
  await js("document.getElementById('setup').close()");
  await shot('farm-bubbles');
  check(await fjs("[...document.querySelectorAll('.px-say')].some(b => b.textContent.includes('One question before I go on'))") === false, 'a waiting farmer shows its question, not its older reply');
  await fjs(`document.querySelector('.px-say[data-say="ui-asker"] [data-say-close]').click()`);
  check(await funtil(`!document.querySelector('.px-say[data-say="ui-asker"]') && !!document.querySelector('.px-say-min[data-say="ui-asker"]')`), 'the bubble hides with its ×, leaving a 💬 to show it again');
  await sleep(1000);
  const bubbles = await fjs(`[...document.querySelectorAll('.px-say')].map(b => b.dataset.say + ': ' + b.textContent.replace('×', '').trim()).join(' | ')`);
  check(!/ui-asker/.test(bubbles) && (bubbles.match(/ui-done/g) ?? []).length === 2, `it stays closed while the agent says nothing new; the others stay (now: ${bubbles})`);
  await fjs(`document.querySelector('.px-say-min[data-say="ui-asker"] [data-say-open]').click()`);
  check(await funtil(`!!document.querySelector('.px-say[data-say="ui-asker"]') && !document.querySelector('.px-say-min')`), 'the 💬 shows the bubble again');
  const width = () => fjs("parseFloat(document.querySelector('#farm canvas').style.width)");
  const frameBox = () => fjs("JSON.stringify((({ left, top, width, height }) => [left, top, width, height].map(Math.round))(document.querySelector('#farm .px-view').getBoundingClientRect()))");
  const view = expr => fjs(`(v => ${expr})(document.querySelector('#farm .px-view'))`);
  check(await fjs("(() => { const v = document.querySelector('#farm .px-view').getBoundingClientRect(), c = document.querySelector('#farm canvas').getBoundingClientRect(); return c.width <= v.width + 1 && c.height <= v.height + 1 && v.bottom <= innerHeight && document.documentElement.scrollHeight <= innerHeight; })()")
    && await js("(f => f.bottom <= innerHeight && document.documentElement.scrollHeight <= innerHeight)(document.querySelector('#farm .world-frame').getBoundingClientRect())"), 'at 100% the whole farm fits in a frame that fits the screen');
  const fill = JSON.parse(await fjs("(() => { const v = document.querySelector('#farm .px-view'), c = v.querySelector('canvas').getBoundingClientRect(), r = v.getBoundingClientRect(); return JSON.stringify({ frame: [r.width, r.height].map(Math.round), farm: [c.width, c.height].map(Math.round), pad: v.querySelector('canvas').dataset.pad }); })()"));
  check(fill.frame[0] - fill.farm[0] < 12 && fill.frame[1] - fill.farm[1] < 12, `and the farm fills the frame: its spare room is more sky and meadow, not empty frame (${JSON.stringify(fill)})`);
  const fit = await width(), frame = await frameBox();
  await fjs("document.querySelector('[data-farm-zoom=\"1\"]').click()");
  await fjs("document.querySelector('[data-farm-zoom=\"1\"]').click()");
  check(await width() > fit && (await frameBox()) === frame, `zooming in makes the farm bigger inside the same frame (${frame} → ${await frameBox()})`);
  check(await view('v.scrollLeft > 0 && v.scrollTop > 0 && v.scrollWidth > v.clientWidth'), 'it zooms around the middle of the view, which now scrolls');
  check(await funtil("(m => !!m && !m.hidden && (a => [...document.querySelectorAll('.px-tools > button, .px-tools > .px-zoombar')].every(b => (r => r.right <= a.left || r.left >= a.right || r.bottom <= a.top || r.top >= a.bottom)(b.getBoundingClientRect())))(m.getBoundingClientRect()))(document.querySelector('.px-mini'))"), 'zoomed in, the minimap shows, above the toolbar rather than over its buttons');
  const picked = () => fjs("document.querySelector('.px-tag.sel')?.dataset.farmer ?? ''");
  const pickedBefore = await picked(), left0 = await view('v.scrollLeft');
  const [mx, my] = JSON.parse(await view('JSON.stringify((r => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])(v.getBoundingClientRect()))'));
  const [ox, oy] = await frameAt(); // the view's middle is in the frame's coordinates; real mouse events take the page's
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
  await mouse('mousePressed', mx + ox, my + oy, { buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', mx + ox - i * 20, my + oy, { buttons: 1 });
  await mouse('mouseReleased', mx + ox - 120, my + oy, { buttons: 0, clickCount: 1 });
  const left1 = await view('v.scrollLeft');
  check(Math.abs(left1 - left0 - 120) <= 2 && (await picked()) === pickedBefore, `dragging moves around the farm and picks nobody (scrolled ${left0} → ${left1})`);
  await fjs("document.querySelector('[data-farm-zoom=\"0\"]').click()");
  check(await width() === fit && (await frameBox()) === frame && await funtil("(v => v.scrollWidth <= v.clientWidth && !document.querySelector('#farm .px-stage').style.transform)(document.querySelector('#farm .px-view'))"), 'the zoom reading fits the whole farm back in the frame (once its glide ends)');
  check(await fjs("(() => { const v = document.querySelector('#farm .px-view'), e = document.createElement('div'); e.style.cssText = 'position:absolute;left:100%;top:0;width:300px;height:10px'; document.querySelector('#farm .px-ov').appendChild(e); const still = v.scrollWidth <= v.clientWidth && document.querySelector('.px-mini')?.hidden !== false; e.remove(); return still; })()"), "at 100%, a label past the farm's edge (a cart off to town) doesn't make the frame scroll");
  check(await fjs("!!document.querySelector('.px-tag .pxt') && !!document.querySelector('.px-lab .pxt') && [...document.querySelectorAll('.px-tag')].some(t => t.textContent.startsWith('ui-asker'))"), 'names and signs are in the pixel font, with their text still in the page');
  await fjs("document.querySelector('.px-tag[data-farmer=\"ui-worker\"]').click()");
  await funtil("document.querySelector('.px-tag.sel')?.dataset.farmer === 'ui-worker'");
  await fjs("document.querySelector('[data-farm-follow]').click()");
  const followed = await funtil(`(() => { const v = document.querySelector('#farm .px-view').getBoundingClientRect(), t = document.querySelector('.px-tag[data-farmer="ui-worker"]').getBoundingClientRect(), cx = t.left + t.width / 2, cy = t.bottom;
    return v.width > 0 && Math.abs(cx - (v.left + v.width / 2)) < v.width / 5 && Math.abs(cy - (v.top + v.height / 2)) < v.height / 3 && parseFloat(document.querySelector('#farm canvas').style.width) > v.width; })()`, 4000);
  check(followed && /Follow: on/.test(await fjs("document.querySelector('[data-farm-follow]').textContent")), 'Follow zooms in and keeps the picked farmer in the middle of the view');
  check(await funtil("(m => !!m && !m.hidden && (a => [...document.querySelectorAll('.px-tools > button, .px-tools > .px-zoombar')].every(b => (r => r.right <= a.left || r.left >= a.right || r.bottom <= a.top || r.top >= a.bottom)(b.getBoundingClientRect())))(m.getBoundingClientRect()))(document.querySelector('.px-mini'))"), 'with the sidebar open too, the minimap stays clear of the toolbar (Follow can be clicked)');
  {
    const [fx, fy] = JSON.parse(await view('JSON.stringify((r => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])(v.getBoundingClientRect()))'));
    const [ox, oy] = await frameAt();
    await mouse('mousePressed', fx + ox, fy + oy, { buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 4; i++) await mouse('mouseMoved', fx + ox + i * 25, fy + oy, { buttons: 1 });
    await mouse('mouseReleased', fx + ox + 100, fy + oy, { buttons: 0, clickCount: 1 });
  }
  check(await funtil("/Follow: off/.test(document.querySelector('[data-farm-follow]').textContent)"), 'dragging the view hands it back to you (Follow turns off)');
  await fjs("document.querySelector('[data-farm-zoom=\"0\"]').click()");
  await fjs(`document.querySelector('.px-say[data-say="ui-done-a"] [data-say-close]').click()`);
  await fjs("document.querySelector('[data-farm-bubbles]').click()");
  check(/Bubbles: off/.test(await fjs("document.querySelector('[data-farm-bubbles]').textContent")) && await funtil("!document.querySelector('.px-say, .px-say-min')"), 'the bubbles switch hides them all');
  await fjs("document.querySelector('[data-farm-bubbles]').click()");
  const allBack = await funtil("document.querySelectorAll('.px-say').length === 3 && !document.querySelector('.px-say-min')");
  const sayState = allBack ? '' : `${await fjs(`JSON.stringify({
    hud: document.querySelector('[data-farm-bubbles]')?.textContent, huds: document.querySelectorAll('[data-farm-bubbles]').length,
    says: [...document.querySelectorAll('.px-say')].map(b => b.dataset.say), mins: [...document.querySelectorAll('.px-say-min')].map(b => b.dataset.say),
    visibility: document.visibilityState,
  })`)} ${await js(`JSON.stringify({
    agents: AgentvilleScene.toScene(snap).agents.map(f => [f.id, f.state, Boolean(f.ask), Boolean(f.question), Boolean(f.said)]),
    visibility: document.visibilityState, still: matchMedia('(prefers-reduced-motion: reduce)').matches, stored: localStorage.getItem('tracker-world:farm:bubbles'),
  })`)}`;
  check(allBack, `switching them back on shows them all, hidden ones too${sayState ? ` (now: ${sayState})` : ''}`);

  // a farm point to the screen: the canvas also holds the forest round the farm (data-pad); the first field's bed is at (174, 118)
  const closeUp = "(() => { const c = document.querySelector('#farm canvas'); const [px, pt] = c.dataset.pad.split(',').map(Number), r = c.getBoundingClientRect(), cs = r.width / Number(c.dataset.ew); c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + (174 + px) * cs, clientY: r.top + (118 + pt) * cs })); })()";
  await fjs(closeUp);
  const closeUpOpen = await funtil("[...document.querySelectorAll('.fv-f')].map(b => b.textContent).join(' ').includes('app.ts')");
  const closeUpState = closeUpOpen ? '' : `${await fjs(`JSON.stringify({ fv: !!document.querySelector('.fv-back'), files: [...document.querySelectorAll('.fv-f')].length, canvas: (r => [r.left, r.top, r.width, r.height].map(Math.round))(document.querySelector('#farm canvas').getBoundingClientRect()), stage: document.querySelector('#farm .px-stage').style.transform, sel: document.querySelector('.px-tag.sel')?.dataset.farmer, tags: [...document.querySelectorAll('.px-tag')].map(t => t.dataset.farmer + '@' + Math.round(t.getBoundingClientRect().left)) })`)} ${await js("JSON.stringify({ side: document.getElementById('main').dataset.side })")}`;
  check(closeUpOpen, `a field close-up lists the files agents touched${closeUpState ? ` (now: ${closeUpState})` : ''}`);
  check(await fjs("[...document.querySelectorAll('.fv-f')].some(b => b.textContent.includes('plan.md') && b.querySelector('.k-doc'))"), 'a document in the close-up is a noticeboard');
  // Reading a document from the close-up: a dialog over the farm, which stays.
  await fjs("[...document.querySelectorAll('.fv-f')].find(b => b.textContent.includes('plan.md'))?.click()");
  await funtil("!!document.querySelector('[data-fv-read]')");
  await fjs("document.querySelector('[data-fv-read]').click()");
  check(await until("document.getElementById('file-dlg').open && /Plan/.test(document.getElementById('reader-body').textContent)"), 'a document from the close-up opens in a dialog over the farm');
  check(await js("document.getElementById('main').dataset.view === 'farm' && !!document.querySelector('#file-dlg #reader-text')"), 'the farm stays, and the dialog has the reply box');
  await js("document.querySelector('#file-dlg [data-file-close]').click()");
  check(await until("!document.getElementById('file-dlg').open"), 'the file dialog closes');
  await fjs("document.querySelector('[data-fv-close]')?.click()");
  check(await fjs("!document.querySelector('.fv-back')"), 'the close-up closes');

  await fjs("document.querySelector('[data-farm-need]').click()");
  check(await until("document.getElementById('main').dataset.side === 'open' && /Which crop next/.test(document.getElementById('farm-agent').textContent)"), "the farm's “needs you” button opens the waiting farmer in the sidebar, with its question");
  check(await fits('#farm-side'), `in the narrower farm sidebar too, the wide code block scrolls inside its bubble (${await sideways('#farm-side')})`);
  check(await js("/^Subagents\\s*1/.test(document.getElementById('tab-subagents').textContent) && !document.querySelector('#farm-agent .sub-card')"), "the farm sidebar's Subagents tab says how many; its Agent tab has no cards");
  await js("document.getElementById('tab-subagents').click()");
  check(await until("/Survey the fields/.test(document.querySelector('#farm-subagents .sub-card')?.textContent ?? '')"), 'the Subagents tab shows its card');
  await js("document.getElementById('tab-agent').click()");
  await until("/Which crop next/.test(document.getElementById('farm-agent').textContent)");
  check(await js("document.getElementById('center-body').innerHTML === ''"), 'the hidden centre holds no second answer form');
  await js("(() => { const r = document.querySelector('#farm-agent input[value=\"Pumpkins\"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('ask-send').click(); })()");
  check(await until("/Answer sent to ui-asker/.test(document.getElementById('notice').textContent)"), 'the answer is sent from the farm sidebar');
  check(answered?.answers?.['Which crop next?'] === 'Pumpkins', 'the session received the answer');

  console.log('Worlds');
  check(await funtil("!!document.querySelector('[data-farm-nav=\"worlds\"]')"), "the farm's buttons include World");
  await fjs("document.querySelector('[data-farm-nav=\"worlds\"]').click()");
  check(await until("document.getElementById('worlds-dlg').open && /Farm[\\s\\S]*Built in[\\s\\S]*Sample[\\s\\S]*Your folder/.test(document.getElementById('worlds-list').textContent)"), 'World, in the farm buttons, lists the worlds: the farm, built in, and one of yours');
  await js("document.querySelector('[data-world=\"u/sample\"]').click()");
  check(await until("document.querySelector('#farm .world-frame')?.src.endsWith('/world/u/sample/')"), 'picking one shows it');
  check(await funtil("!!document.querySelector('#farm canvas') && document.querySelectorAll('.px-tag').length > 0"), 'a world made of three hooks draws, with the engine doing the rest');
  check(await until("/Sample/.test(document.getElementById('view-farm').textContent) && localStorage.getItem('tracker-world') === 'u/sample'"), 'the toggle says its name, and the choice is kept');
  check(await js("document.querySelector('#farm-diary-pane .sec').textContent === 'Lab book'"), "the diary takes the world's own word for it");
  await js("window.__sampleFrame = document.querySelector('#farm .world-frame'); true");
  appendFileSync(join(worldsDir, 'sample', 'world.js'), '\n// edited\n');
  check(await until("document.querySelector('#farm .world-frame') !== window.__sampleFrame", 5000) && await funtil("!!document.querySelector('#farm canvas')"), 'saving a world while it shows reloads it');
  await funtil("!!document.querySelector('[data-farm-nav=\"worlds\"]')");
  await fjs("document.querySelector('[data-farm-nav=\"worlds\"]').click()"); // the sample world's buttons are the engine's: World is there too
  await until("document.getElementById('worlds-dlg').open");
  await js("document.querySelector('[data-world=\"farm\"]').click()");
  check(await until("document.querySelector('#farm .world-frame')?.src.endsWith('/world/farm/') && /Farm/.test(document.getElementById('view-farm').textContent)"), 'and back to the farm');
  await funtil("document.querySelectorAll('.px-tag').length >= 2");

  console.log('Claude Code setup');
  await js("document.getElementById('setup-open').click()");
  check(await until("document.getElementById('setup').open && /2 plugins<\\/b>, 1 on: together they add <b>~1,500 tokens/.test(document.getElementById('setup-body').innerHTML)"), '⚙ Claude Code lists the plugins, with what the ones on cost every session');
  await js("document.querySelector('[data-plugin-op=\"disable\"][data-plugin=\"crops@farm-market\"]').click()");
  for (let i = 0; i < 40 && !(existsSync(cliLog) && /plugin disable crops@farm-market/.test(readFileSync(cliLog, 'utf8'))); i++) await sleep(100);
  check(existsSync(cliLog) && /plugin disable crops@farm-market/.test(readFileSync(cliLog, 'utf8')), 'Turn off runs claude plugin disable for that plugin');
  check(await until("/Running sessions keep their plugins/.test(document.getElementById('setup-note').textContent)"), 'and says running sessions need a reload, with the button for it');
  await js("document.querySelector('[data-setup-tab=\"mcp\"]').click()");
  check(await until("/2 servers: 1 connected, 1 need sign-in/.test(document.getElementById('setup-body').textContent) && !!document.querySelector('[data-mcp-login=\"silo\"]')"), 'the MCP tab shows each server and how it is, with Sign in where it is needed');
  await js("document.querySelector('[data-setup-tab=\"rules\"]').click()");
  check(await until("/Bash\\(npm test:\\*\\)/.test(document.getElementById('setup-body').textContent)"), 'the rules tab lists your permission rules');
  check(await js("(() => { const b = document.getElementById('setup-body'); return b.scrollWidth <= b.clientWidth + 1; })()"), "the dialog doesn't scroll sideways");
  await js("document.getElementById('setup').close()");
  console.log('Sessions');
  await js("document.getElementById('sessions-open').click()");
  check(await until("document.getElementById('sessions').open && [...document.querySelectorAll('#sessions [data-sess-resume]')].some(b => b.closest('.sess-row').textContent.includes('Harvest planning'))"), 'the sessions dialog offers to resume a past session by its title');
  check(await js("[...document.querySelectorAll('#sessions [data-sess-new]')].some(b => b.dataset.sessNew.endsWith('/farm-repo'))"), 'and to start a new session in a folder you worked in');
  await js("(() => { const f = document.getElementById('sess-filter'); f.value = 'harvest'; f.dispatchEvent(new Event('input', { bubbles: true })); })()");
  check(await until("document.querySelectorAll('#sessions [data-sess-resume]').length === 1"), 'the filter narrows the list');
  await js("document.querySelector('#sessions [data-sess-resume]').click()");
  check(await until('!document.getElementById(\'sessions\').open') && launched.at(-1) === `cd '${repo}' && exec claude --resume ${PAST}`, `Resume opens a terminal running claude --resume in the session's folder (got ${JSON.stringify(launched)})`);
  check(await until("/Opened a new Terminal window/.test(document.getElementById('notice').textContent)"), 'the page says the terminal opened');
  await js("document.getElementById('sessions-open').click()");
  await until("!!document.querySelector('#sessions [data-sess-new]')");
  await js("(() => { const m = document.getElementById('sess-mode'); m.value = 'plan'; m.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('sess-model').value = 'sonnet'; document.getElementById('sess-effort').value = 'high'; })()");
  await js("document.querySelector('#sessions [data-sess-new]').click()");
  check(await until('!document.getElementById(\'sessions\').open') && launched.at(-1) === `cd '${repo}' && exec claude --permission-mode plan --model 'sonnet' --effort high`, `New session opens a terminal running claude in the folder, in the mode, model and effort you picked (got ${launched.at(-1)})`);
  // A folder you haven't worked in: typed, with suggestions and Tab, or made, then started in.
  const places = realpathSync(temp); // the place this run allows (your home folder and drives, really)
  await js("document.getElementById('sessions-open').click()");
  await until("document.getElementById('sessions').open");
  const typeDir = text => js(`(() => { const f = document.getElementById('sess-dir'); f.focus(); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await js("document.getElementById('sess-dir-browse').click()");
  check(await until(`document.getElementById('sess-dir').value === ${JSON.stringify(`${places}/farm-repo/`)} && !document.getElementById('sess-dir-new').disabled`), "Browse… fills the field with the folder picked in Finder's window");
  await typeDir('/etc/');
  check(await until("/home folder or a drive/.test(document.getElementById('sess-dir-note').textContent) && document.getElementById('sess-dir-new').disabled"), 'a folder outside your home folder and drives is refused');
  await typeDir(`${places}/fa`);
  check(await until("[...document.querySelectorAll('#sess-dir-list [data-dir-go]')].some(b => b.textContent.includes('farm-repo'))"), 'typing a folder suggests the folders in it');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  check(await until(`document.getElementById('sess-dir').value === ${JSON.stringify(`${places}/farm-repo/`)} && document.activeElement?.id === 'sess-dir'`), 'Tab completes the name, as in a terminal');
  check(await until("[...document.querySelectorAll('#sess-dir-list [data-dir-go]')].some(b => b.textContent.includes('src')) && !document.getElementById('sess-dir-new').disabled"), 'and lists what is in it');
  await shot('session-folder');
  await typeDir(`${places}/new crop/field`);
  check(await until("!!document.querySelector('#sess-dir-note [data-dir-make]') && document.getElementById('sess-dir-new').disabled"), 'a folder that does not exist yet offers Create it');
  await js("document.querySelector('#sess-dir-note [data-dir-make]').click()");
  check(await until("document.getElementById('confirm').open && /Create the folder/.test(document.getElementById('confirm-text').textContent)") && !existsSync(join(places, 'new crop')), 'Create it asks first');
  await js("document.getElementById('confirm-yes').click()");
  check(await until("!document.getElementById('sess-dir-new').disabled") && existsSync(join(places, 'new crop', 'field')), 'confirmed, it makes the folder and the one above it');
  await js("document.getElementById('sess-dir-new').click()");
  check(await until("!document.getElementById('sessions').open") && launched.at(-1) === `cd '${join(places, 'new crop', 'field')}' && exec claude --permission-mode plan --model 'sonnet' --effort high`, `＋ New starts there, in the mode, model and effort picked (got ${launched.at(-1)})`);
  check(await until("/trust the folder/.test(document.getElementById('notice').textContent)"), 'and says Claude Code may ask there whether to trust it');

  console.log('Back to the list');
  await js("document.getElementById('view-list').click()");
  check(await until("document.getElementById('main').dataset.view === 'list' && document.getElementById('farm-agent').innerHTML === '' && !!document.querySelector('#center-body .ov')"), 'the list view comes back with the agent in the centre');
  await js("document.querySelector('.row[data-id=\"ui-done-b\"]').click()");
  check(await until("!!document.querySelector('#center-body [data-end-session=\"ui-done-b\"]') && document.querySelector('#center-body .sessbar .chip')?.textContent === 'Plan mode'"), "a terminal session's panel shows its permission mode (from its transcript) and End session");
  await js("document.querySelector('#center-body [data-end-session=\"ui-done-b\"]').click()");
  check(await until("document.getElementById('confirm').open && /End ui-done-b\\?/.test(document.getElementById('confirm-text').textContent)") && ended.length === 0, 'End session asks first, and does nothing until you confirm');
  await js("document.getElementById('confirm-yes').click()");
  check(await until("/Ended ui-done-b/.test(document.getElementById('notice').textContent)") && ended[0] === doneB.pid && launched.at(-1) === '/dev/ttys042', `confirmed, it ends that session and closes its window by its tty (ended ${JSON.stringify(ended)}, last ${launched.at(-1)})`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await chrome?.close();
  worker.kill();
  doneA.kill();
  doneB.kill();
  resting.kill();
  clearInterval(fakeMod);
  await handle.stop();
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nPASS');
process.exit(failures.length ? 1 : 0);
