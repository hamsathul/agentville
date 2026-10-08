#!/usr/bin/env node
// Browser test of the dashboard. Starts a collector on a fixture (two sessions in a small git
// repo, one asking a question, with a stand-in for the mod so the question can be answered),
// drives headless Chrome over the DevTools protocol, and checks the list view, the farm, its
// sidebar, the info dialog and a field close-up. No dependencies; needs Chrome (set CHROME to
// its path if it isn't in the usual place). Exits 1 if a check fails.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCollector } from '../collector/collector.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, pollMs: 300, permissionGuessSec: 3600 }));

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
const use = (ms, id, name, input) => line(ms, { model: 'claude-haiku', content: [{ type: 'tool_use', id, name, input }] });
const QUESTION = { question: 'Which crop next?', header: 'Crop', multiSelect: false, options: [{ label: 'Wheat' }, { label: 'Pumpkins' }] };
const sessions = {
  'ui-asker': { pid: process.pid, lines: [
    line(now - 60_000, { content: 'Plan the next crop' }, 'user'),
    use(now - 50_000, 'toolu_W1', 'Write', { file_path: join(repo, 'docs', 'plan.md'), content: '# Plan' }),
    // a subagent at work: its own transcript is written below
    use(now - 46_000, 'toolu_SUB1', 'Agent', { description: 'Survey the fields', subagent_type: 'Explore', prompt: 'Survey every field and list what grows where.' }),
    // a reply with a code block wider than any panel: it scrolls inside its bubble, the panel stays put
    line(now - 45_000, { model: 'claude-haiku', content: [{ type: 'text', text: `The rotation:\n\n\`\`\`\n${'wheat → barley → clover → pumpkins → '.repeat(6)}fallow\n\`\`\`` }] }),
    use(now - 40_000, 'toolu_E1', 'Edit', { file_path: join(repo, 'src', 'app.ts'), old_string: '1', new_string: '2' }),
    line(now - 30_000, { model: 'claude-haiku', content: [{ type: 'text', text: 'Plan written. One question before I go on.' }] }),
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
const sessionProcs = { commandOf: async () => 'claude', ttyOf: async () => 'ttys042', kill: pid => ended.push(pid), alive: pid => !ended.includes(pid) };

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
const handle = await startCollector({ root, claudeDir, claudeBin: fakeClaude, notify: () => {}, log: () => {}, home: '/nowhere', scratchBase: '/nonexistent', sessionProcs, launch: async args => { launched.push(args.at(-1)); return { code: 0, stdout: '', stderr: '' }; } });
const profile = join(temp, 'chrome');
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  let port;
  for (let i = 0; i < 80 && !port; i++) {
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(250); }
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
  const until = async (expr, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await js(expr)) return true;
    return false;
  };
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
  const theme = await js('document.documentElement.dataset.theme ?? "auto"');
  await js("document.getElementById('theme-toggle').click()");
  check((await js('document.documentElement.dataset.theme ?? "auto"')) !== theme, 'the theme button switches the theme');

  console.log('Farm');
  await js("document.getElementById('view-farm').click()");
  check(await until("document.getElementById('main').dataset.view === 'farm' && document.querySelectorAll('.px-tag').length >= 2"), 'the farm shows both farmers');
  check(await until("[...document.querySelectorAll('.px-tag')].some(t => t.textContent.startsWith('ui-asker') && t.classList.contains('st-waiting'))"), 'the waiting agent is on the porch');
  check(/1 needs you/.test(await js("document.querySelector('.px-hud')?.textContent ?? ''")), 'the farm says one needs you');
  const porch = JSON.parse(await js("JSON.stringify(['ui-done-a', 'ui-done-b', 'ui-asker'].map(id => (r => r.left + r.width / 2)(document.querySelector(`.px-tag[data-farmer='${id}']`).getBoundingClientRect())))"));
  const cs0 = await js("(c => c.getBoundingClientRect().width / Number(c.dataset.ew))(document.querySelector('#farm canvas'))");
  check(Math.abs(porch[0] - porch[1]) >= 22 * cs0 - 1, `farmers on the porch stand apart, none hidden behind another (${Math.round(Math.abs(porch[0] - porch[1]) / cs0)} apart)`);
  check(await until("!!document.querySelector('.px-tag[data-farmer=\"ui-idle\"]')"), 'an idle farmer rests under the tree');
  await js("document.querySelector('[data-farm-resting]').click()");
  check(await until("!document.querySelector('.px-tag[data-farmer=\"ui-idle\"]') && /Resting: hidden \\([1-9]\\d*\\)/.test(document.querySelector('[data-farm-resting]').textContent)"), 'the Resting switch hides idle and stale farmers, and says how many');
  await js("document.querySelector('[data-farm-resting]').click()");
  check(await until("!!document.querySelector('.px-tag[data-farmer=\"ui-idle\"]')"), 'and shows them again');
  check(await until("/ui-done-a\\s*sends a note to ui-done-b/.test(document.getElementById('farm-diary').textContent)"), "a message from one agent to another goes in the farm diary (and flies as a pigeon)");
  for (let i = 0; i < 3 && !/Sky: night/.test(await js("document.querySelector('[data-farm-sky]').textContent")); i++) await js("document.querySelector('[data-farm-sky]').click()");
  await sleep(600);
  check(/Sky: night/.test(await js("document.querySelector('[data-farm-sky]').textContent")) && errors.length === 0, 'the farm draws its night, lights and all, without errors');
  for (let i = 0; i < 3 && !/Sky: live/.test(await js("document.querySelector('[data-farm-sky]').textContent")); i++) await js("document.querySelector('[data-farm-sky]').click()");
  check(!/energy/i.test(await js("document.querySelector('.px-hud')?.textContent ?? ''")) && /34%[\s\S]*5-hour limit/.test(await js("document.querySelector('.px-stats').textContent")), "the farm has no vague energy bar; the plan's usage is in its panel");
  check(await js("getComputedStyle(document.querySelector('header.top')).display === 'none' && getComputedStyle(document.getElementById('kpis')).display === 'none'"), 'the farm fills the window: no top bar or count cards above it');
  check(/waiting on you[\s\S]*working[\s\S]*your turn[\s\S]*collisions/.test(await js("document.querySelector('.px-stats').textContent")) && /RAM[\s\S]*CPU/.test(await js("document.querySelector('.px-stats').textContent")), "the count cards and the top bar's meters are in the farm's panel");
  check(await until("[...document.querySelectorAll('.px-lab')].some(l => l.textContent.startsWith('farm-repo'))"), 'the repo is a field');
  check(await js(`Number.isInteger(JSON.parse(localStorage.getItem('tracker-farm-beds') || '{}')[${JSON.stringify(repo)}]?.i)`), 'the farm remembers which bed the field has, so it stays put as repos come and go');
  await js("document.querySelector('[data-farm-help]').click()");
  check(await js("document.querySelector('.px-help').open"), 'the info button opens how to read the farm');
  await js("document.querySelector('[data-farm-help-close]').click()");
  check(await js("!document.querySelector('.px-help').open"), 'the info dialog closes');
  // the buildings open things: a farm point to the screen (the canvas holds the forest round the farm too)
  const clickFarm = (x, y) => `(() => { const c = document.querySelector('#farm canvas'); const [px, pt] = c.dataset.pad.split(',').map(Number), r = c.getBoundingClientRect(), cs = r.width / Number(c.dataset.ew); c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + (${x} + px) * cs, clientY: r.top + (${y} + pt) * cs })); })()`;
  await js(clickFarm(200, 30));
  check(await until("document.querySelector('.px-dlg')?.open && /ui-asker/.test(document.querySelector('.px-dlg').textContent)"), 'clicking the farmhouse lists who is on your porch');
  await js("document.querySelector('[data-farm-dlg-close]').click()");
  await js(clickFarm(96, 40));
  check(await until("document.querySelector('.px-dlg')?.open && /plan/i.test(document.querySelector('.px-dlg-title').textContent)"), "clicking the silo shows the plan's usage");
  await js("document.querySelector('[data-farm-dlg-close]').click()");
  await js(clickFarm(62, 40));
  check(await until("document.getElementById('sessions').open"), 'clicking the barn opens Start or resume a session');
  await js("document.getElementById('sessions').close()");
  await js("document.querySelector('[data-farm-bell]').click()");
  check(/Bell: on/.test(await js("document.querySelector('[data-farm-bell]').textContent")) && await js("localStorage.getItem('tracker-bell')") === 'on', 'the Bell switch turns on the chime for agents that start waiting');
  await js("document.querySelector('[data-farm-bell]').click()");

  check(await until("[...document.querySelectorAll('.px-say')].some(b => b.textContent.includes('Which crop next?'))"), "the waiting farmer's question is in a speech bubble over its head");
  check(await until("document.querySelectorAll('.px-say').length >= 3"), 'the two finished farmers have bubbles too');
  await sleep(4000); // let everyone reach the porch
  const overlaps = await js(`(() => {
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
  check(overlaps === '', `speech bubbles overlap neither each other nor the names shown${overlaps ? `: ${overlaps}` : ''}`);
  check(await js("getComputedStyle(document.querySelector('.px-tag[data-farmer=\"ui-worker\"]')).opacity === '0' && getComputedStyle(document.querySelector('.px-tag.st-waiting')).opacity === '1'"), "a working farmer's name waits for a hover; a waiting one's always shows");
  const hovered = await js(`(() => { const c = document.querySelector('#farm canvas'), t = document.querySelector('.px-tag[data-farmer="ui-worker"]').getBoundingClientRect(), cs = c.getBoundingClientRect().width / Number(c.dataset.ew);
    c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: t.left + t.width / 2, clientY: t.bottom + 10 * cs })); // on its sprite, just under its hidden name
    const on = document.querySelector('.px-tag[data-farmer="ui-worker"]').classList.contains('hover');
    c.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 })); document.querySelector('#farm .px-view').dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }));
    return on && !document.querySelector('.px-tag.hover'); })()`);
  check(hovered, 'hovering a farmer shows its name, and leaving hides it again');
  const corners = JSON.parse(await js(`(() => { const r = s => document.querySelector(s).getBoundingClientRect(), v = r('#farm .px-host'), st = r('.px-stats'), z = r('.px-zoombar'), t = r('.px-tools'), n = r('.px-nav');
    return JSON.stringify({ stats: st.left - v.left < 20 && st.top - v.top < 20, nav: v.right - n.right < 20 && n.top - v.top < 20, zoom: v.bottom - z.bottom < 20 && z.height < 40, tools: (b => v.bottom - b.bottom < 20 && b.height < 40 && Math.abs((b.left + b.right) / 2 - (v.left + v.right) / 2) < 40)((r => ({ left: Math.min(...r.map(x => x.left)), right: Math.max(...r.map(x => x.right)), bottom: Math.max(...r.map(x => x.bottom)), height: Math.max(...r.map(x => x.bottom)) - Math.min(...r.map(x => x.top)) }))([...document.querySelectorAll('.px-tools > button, .px-tools > .px-zoombar')].map(x => x.getBoundingClientRect()))) }); })()`));
  check(corners.stats && corners.nav && corners.zoom && corners.tools, `the controls lie over the farm: the panel top left, the dashboard's buttons top right, a slim row of switches and zoom along the bottom (${JSON.stringify(corners)})`);
  await js("document.querySelector('[data-farm-nav=\"theme\"]').click()");
  check(await until("document.documentElement.dataset.theme !== 'dark'"), "the farm's own buttons work the dashboard: the theme changes");
  for (let i = 0; i < 2 && (await js("document.documentElement.dataset.theme")) !== 'dark'; i++) await js("document.querySelector('[data-farm-nav=\"theme\"]').click()");
  if (process.env.SHOTS) { // optional: SHOTS=<folder> saves a picture of the farm at this point
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.SHOTS, 'farm-bubbles.png'), Buffer.from(shot.result.data, 'base64'));
  }
  check(await js("[...document.querySelectorAll('.px-say')].some(b => b.textContent.includes('One question before I go on'))") === false, 'a waiting farmer shows its question, not its older reply');
  await js(`document.querySelector('.px-say[data-say="ui-asker"] [data-say-close]').click()`);
  check(await until(`!document.querySelector('.px-say[data-say="ui-asker"]') && !!document.querySelector('.px-say-min[data-say="ui-asker"]')`), 'the bubble hides with its ×, leaving a 💬 to show it again');
  await sleep(1000);
  const bubbles = await js(`[...document.querySelectorAll('.px-say')].map(b => b.dataset.say + ': ' + b.textContent.replace('×', '').trim()).join(' | ')`);
  check(!/ui-asker/.test(bubbles) && (bubbles.match(/ui-done/g) ?? []).length === 2, `it stays closed while the agent says nothing new; the others stay (now: ${bubbles})`);
  await js(`document.querySelector('.px-say-min[data-say="ui-asker"] [data-say-open]').click()`);
  check(await until(`!!document.querySelector('.px-say[data-say="ui-asker"]') && !document.querySelector('.px-say-min')`), 'the 💬 shows the bubble again');
  const width = () => js("parseFloat(document.querySelector('#farm canvas').style.width)");
  const frameBox = () => js("JSON.stringify((({ left, top, width, height }) => [left, top, width, height].map(Math.round))(document.querySelector('#farm .px-view').getBoundingClientRect()))");
  const view = expr => js(`(v => ${expr})(document.querySelector('#farm .px-view'))`);
  check(await js("(() => { const v = document.querySelector('#farm .px-view').getBoundingClientRect(), c = document.querySelector('#farm canvas').getBoundingClientRect(); return c.width <= v.width + 1 && c.height <= v.height + 1 && v.bottom <= innerHeight && document.documentElement.scrollHeight <= innerHeight; })()"), 'at 100% the whole farm fits in a frame that fits the screen');
  const fill = JSON.parse(await js("(() => { const v = document.querySelector('#farm .px-view'), c = v.querySelector('canvas').getBoundingClientRect(), r = v.getBoundingClientRect(); return JSON.stringify({ frame: [r.width, r.height].map(Math.round), farm: [c.width, c.height].map(Math.round), pad: v.querySelector('canvas').dataset.pad }); })()"));
  check(fill.frame[0] - fill.farm[0] < 12 && fill.frame[1] - fill.farm[1] < 12, `and the farm fills the frame: its spare room is more sky and meadow, not empty frame (${JSON.stringify(fill)})`);
  const fit = await width(), frame = await frameBox();
  await js("document.querySelector('[data-farm-zoom=\"1\"]').click()");
  await js("document.querySelector('[data-farm-zoom=\"1\"]').click()");
  check(await width() > fit && (await frameBox()) === frame, `zooming in makes the farm bigger inside the same frame (${frame} → ${await frameBox()})`);
  check(await view('v.scrollLeft > 0 && v.scrollTop > 0 && v.scrollWidth > v.clientWidth'), 'it zooms around the middle of the view, which now scrolls');
  check(await until("(m => !!m && !m.hidden && (a => [...document.querySelectorAll('.px-tools > button, .px-tools > .px-zoombar')].every(b => (r => r.right <= a.left || r.left >= a.right || r.bottom <= a.top || r.top >= a.bottom)(b.getBoundingClientRect())))(m.getBoundingClientRect()))(document.querySelector('.px-mini'))"), 'zoomed in, the minimap shows, above the toolbar rather than over its buttons');
  const picked = () => js("document.querySelector('.px-tag.sel')?.dataset.farmer ?? ''");
  const pickedBefore = await picked(), left0 = await view('v.scrollLeft');
  const [mx, my] = JSON.parse(await view('JSON.stringify((r => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])(v.getBoundingClientRect()))'));
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
  await mouse('mousePressed', mx, my, { buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', mx - i * 20, my, { buttons: 1 });
  await mouse('mouseReleased', mx - 120, my, { buttons: 0, clickCount: 1 });
  const left1 = await view('v.scrollLeft');
  check(Math.abs(left1 - left0 - 120) <= 2 && (await picked()) === pickedBefore, `dragging moves around the farm and picks nobody (scrolled ${left0} → ${left1})`);
  await js("document.querySelector('[data-farm-zoom=\"0\"]').click()");
  check(await width() === fit && (await frameBox()) === frame && await until("(v => v.scrollWidth <= v.clientWidth && !document.querySelector('#farm .px-stage').style.transform)(document.querySelector('#farm .px-view'))"), 'the zoom reading fits the whole farm back in the frame (once its glide ends)');
  check(await js("(() => { const v = document.querySelector('#farm .px-view'), e = document.createElement('div'); e.style.cssText = 'position:absolute;left:100%;top:0;width:300px;height:10px'; document.querySelector('#farm .px-ov').appendChild(e); const still = v.scrollWidth <= v.clientWidth && document.querySelector('.px-mini')?.hidden !== false; e.remove(); return still; })()"), "at 100%, a label past the farm's edge (a cart off to town) doesn't make the frame scroll");
  check(await js("!!document.querySelector('.px-tag .pxt') && !!document.querySelector('.px-lab .pxt') && [...document.querySelectorAll('.px-tag')].some(t => t.textContent.startsWith('ui-asker'))"), 'names and signs are in the pixel font, with their text still in the page');
  await js("document.querySelector('.px-tag[data-farmer=\"ui-worker\"]').click()");
  await until("document.querySelector('.px-tag.sel')?.dataset.farmer === 'ui-worker'");
  await js("document.querySelector('[data-farm-follow]').click()");
  const followed = await until(`(() => { const v = document.querySelector('#farm .px-view').getBoundingClientRect(), t = document.querySelector('.px-tag[data-farmer="ui-worker"]').getBoundingClientRect(), cx = t.left + t.width / 2, cy = t.bottom;
    return v.width > 0 && Math.abs(cx - (v.left + v.width / 2)) < v.width / 5 && Math.abs(cy - (v.top + v.height / 2)) < v.height / 3 && parseFloat(document.querySelector('#farm canvas').style.width) > v.width; })()`, 4000);
  check(followed && /Follow: on/.test(await js("document.querySelector('[data-farm-follow]').textContent")), 'Follow zooms in and keeps the picked farmer in the middle of the view');
  check(await until("(m => !!m && !m.hidden && (a => [...document.querySelectorAll('.px-tools > button, .px-tools > .px-zoombar')].every(b => (r => r.right <= a.left || r.left >= a.right || r.bottom <= a.top || r.top >= a.bottom)(b.getBoundingClientRect())))(m.getBoundingClientRect()))(document.querySelector('.px-mini'))"), 'with the sidebar open too, the minimap stays clear of the toolbar (Follow can be clicked)');
  {
    const [fx, fy] = JSON.parse(await view('JSON.stringify((r => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])(v.getBoundingClientRect()))'));
    await mouse('mousePressed', fx, fy, { buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 4; i++) await mouse('mouseMoved', fx + i * 25, fy, { buttons: 1 });
    await mouse('mouseReleased', fx + 100, fy, { buttons: 0, clickCount: 1 });
  }
  check(await until("/Follow: off/.test(document.querySelector('[data-farm-follow]').textContent)"), 'dragging the view hands it back to you (Follow turns off)');
  await js("document.querySelector('[data-farm-zoom=\"0\"]').click()");
  await js(`document.querySelector('.px-say[data-say="ui-done-a"] [data-say-close]').click()`);
  await js("document.querySelector('[data-farm-bubbles]').click()");
  check(/Bubbles: off/.test(await js("document.querySelector('[data-farm-bubbles]').textContent")) && await until("!document.querySelector('.px-say, .px-say-min')"), 'the bubbles switch hides them all');
  await js("document.querySelector('[data-farm-bubbles]').click()");
  const allBack = await until("document.querySelectorAll('.px-say').length === 3 && !document.querySelector('.px-say-min')");
  const sayState = allBack ? '' : await js(`JSON.stringify({
    hud: document.querySelector('[data-farm-bubbles]')?.textContent, huds: document.querySelectorAll('[data-farm-bubbles]').length,
    says: [...document.querySelectorAll('.px-say')].map(b => b.dataset.say), mins: [...document.querySelectorAll('.px-say-min')].map(b => b.dataset.say),
    farmers: TrackerFarm.toScene(snap).farmers.map(f => [f.id, f.state, Boolean(f.ask), Boolean(f.question), Boolean(f.said)]),
    visibility: document.visibilityState, still: matchMedia('(prefers-reduced-motion: reduce)').matches, stored: localStorage.getItem('tracker-farm-bubbles'),
  })`);
  check(allBack, `switching them back on shows them all, hidden ones too${sayState ? ` (now: ${sayState})` : ''}`);

  // a farm point to the screen: the canvas also holds the forest round the farm (data-pad); the first field's bed is at (174, 118)
  const closeUp = "(() => { const c = document.querySelector('#farm canvas'); const [px, pt] = c.dataset.pad.split(',').map(Number), r = c.getBoundingClientRect(), cs = r.width / Number(c.dataset.ew); c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + (174 + px) * cs, clientY: r.top + (118 + pt) * cs })); })()";
  await js(closeUp);
  const closeUpOpen = await until("[...document.querySelectorAll('.fv-f')].map(b => b.textContent).join(' ').includes('app.ts')");
  const closeUpState = closeUpOpen ? '' : await js(`JSON.stringify({ fv: !!document.querySelector('.fv-back'), files: [...document.querySelectorAll('.fv-f')].length, canvas: (r => [r.left, r.top, r.width, r.height].map(Math.round))(document.querySelector('#farm canvas').getBoundingClientRect()), stage: document.querySelector('#farm .px-stage').style.transform, side: document.getElementById('main').dataset.side, sel: document.querySelector('.px-tag.sel')?.dataset.farmer, tags: [...document.querySelectorAll('.px-tag')].map(t => t.dataset.farmer + '@' + Math.round(t.getBoundingClientRect().left)) })`);
  check(closeUpOpen, `a field close-up lists the files agents touched${closeUpState ? ` (now: ${closeUpState})` : ''}`);
  check(await js("[...document.querySelectorAll('.fv-f')].some(b => b.textContent.includes('plan.md') && b.querySelector('.k-doc'))"), 'a document in the close-up is a noticeboard');
  await js("document.querySelector('[data-fv-close]').click()");
  check(await js("!document.querySelector('.fv-back')"), 'the close-up closes');

  await js("document.querySelector('[data-farm-need]').click()");
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
  ws?.close();
  const chromeGone = chrome.exitCode !== null ? Promise.resolve() : new Promise(r => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([chromeGone, sleep(5000)]); // Chrome writes its profile on the way out
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
