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
writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, pollMs: 300 }));

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
const now = Date.now();
const iso = ms => new Date(ms).toISOString();
const line = (ms, message, type = 'assistant') => JSON.stringify({ type, timestamp: iso(ms), cwd: repo, message });
const use = (ms, id, name, input) => line(ms, { model: 'claude-haiku', content: [{ type: 'tool_use', id, name, input }] });
const QUESTION = { question: 'Which crop next?', header: 'Crop', multiSelect: false, options: [{ label: 'Wheat' }, { label: 'Pumpkins' }] };
const sessions = {
  'ui-asker': { pid: process.pid, lines: [
    line(now - 60_000, { content: 'Plan the next crop' }, 'user'),
    use(now - 50_000, 'toolu_W1', 'Write', { file_path: join(repo, 'docs', 'plan.md'), content: '# Plan' }),
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
    line(now - 80_000, { model: 'claude-haiku', content: [{ type: 'text', text: 'I updated the README and the changelog. Everything is committed and the tests pass on every platform.' }] }),
    JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: iso(now - 79_000), durationMs: 1000 }),
  ] },
  'ui-done-b': { pid: doneB.pid, status: 'idle', lines: [
    line(now - 70_000, { content: 'Prepare the release' }, 'user'),
    line(now - 60_000, { model: 'claude-haiku', content: [{ type: 'text', text: 'The build is green on all three platforms and the release notes are ready for you to read.' }] }),
    JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: iso(now - 59_000), durationMs: 1000 }),
  ] },
};
for (const [id, s] of Object.entries(sessions)) {
  writeFileSync(join(claudeDir, 'sessions', `${s.pid}.json`), JSON.stringify({ pid: s.pid, sessionId: id, cwd: repo, name: id, status: s.status ?? 'busy' }));
  writeFileSync(join(claudeDir, 'projects', '-farm-repo', `${id}.jsonl`), `${s.lines.join('\n')}\n`);
}

// A stand-in for the mod in the asker's session: it says it is listening, keeps its offer of the
// question fresh, and takes an answer the dashboard hands it (deleting the file, as the mod does).
const state = join(root, 'state');
for (const d of ['pending', 'answers', 'mods']) mkdirSync(join(state, d), { recursive: true });
const offer = join(state, 'pending', 'toolu_ASK1.json');
writeFileSync(offer, JSON.stringify({ kind: 'question', toolUseId: 'toolu_ASK1', sessionId: 'ui-asker', createdAt: now - 20_000, questions: [QUESTION] }));
let answered = null;
const received = []; // messages the fake mod took from the dashboard
const fakeMod = setInterval(() => {
  const inbox = join(state, 'messages', 'ui-asker');
  if (existsSync(inbox)) for (const name of readdirSync(inbox)) {
    if (!name.endsWith('.json')) continue;
    received.push(JSON.parse(readFileSync(join(inbox, name), 'utf8')).text);
    unlinkSync(join(inbox, name));
  }
  writeFileSync(join(state, 'mods', 'ui-asker.json'), JSON.stringify({ sessionId: 'ui-asker', version: 'ui-test', at: Date.now() }));
  if (existsSync(offer)) utimesSync(offer, new Date(), new Date());
  for (const name of readdirSync(join(state, 'answers'))) {
    if (!name.endsWith('.json')) continue;
    answered = JSON.parse(readFileSync(join(state, 'answers', name), 'utf8'));
    unlinkSync(join(state, 'answers', name));
    rmSync(offer, { force: true });
  }
}, 100);

/* ---------- browser ---------- */

const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home: '/nowhere', scratchBase: '/nonexistent' });
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${handle.port}/` });

  console.log('List view');
  check(await until("document.querySelectorAll('.row').length >= 2 && !!document.querySelector('.ask legend')"), 'both agents are listed and the waiting one fills the centre');
  check((await js('document.title')) === '(1) Agent Tracker', 'the tab title counts one agent waiting');
  check(await js("[...document.querySelectorAll('.row')].some(r => r.textContent.includes('ui-asker') && r.textContent.includes('answer here'))"), 'the waiting row says it can be answered here');
  check(/Which crop next\?/.test(await js("document.querySelector('.ask legend')?.textContent ?? ''")), 'the centre shows the question');
  check(await until("[...document.querySelectorAll('#tree .tn')].some(b => b.textContent.includes('README.md'))"), "the explorer lists the agent's folder");
  check(await js("[...document.querySelectorAll('#center-body .bub.you')].some(b => b.textContent.includes('Plan the next crop'))"), 'the conversation shows the prompt');
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
  const theme = await js('document.documentElement.dataset.theme ?? "auto"');
  await js("document.getElementById('theme-toggle').click()");
  check((await js('document.documentElement.dataset.theme ?? "auto"')) !== theme, 'the theme button switches the theme');

  console.log('Farm');
  await js("document.getElementById('view-farm').click()");
  check(await until("document.getElementById('main').dataset.view === 'farm' && document.querySelectorAll('.px-tag').length >= 2"), 'the farm shows both farmers');
  check(await until("[...document.querySelectorAll('.px-tag')].some(t => t.textContent.startsWith('ui-asker') && t.classList.contains('st-waiting'))"), 'the waiting agent is on the porch');
  check(/1 needs you/.test(await js("document.querySelector('.px-hud')?.textContent ?? ''")), 'the farm says one needs you');
  check(await until("[...document.querySelectorAll('.px-lab')].some(l => l.textContent.startsWith('farm-repo'))"), 'the repo is a field');
  await js("document.querySelector('[data-farm-help]').click()");
  check(await js("document.querySelector('.px-help').open"), 'the info button opens how to read the farm');
  await js("document.querySelector('[data-farm-help-close]').click()");
  check(await js("!document.querySelector('.px-help').open"), 'the info dialog closes');

  check(await until("[...document.querySelectorAll('.px-say')].some(b => b.textContent.includes('Which crop next?'))"), "the waiting farmer's question is in a speech bubble over its head");
  check(await until("document.querySelectorAll('.px-say').length >= 3"), 'the two finished farmers have bubbles too');
  await sleep(4000); // let everyone reach the porch
  const overlaps = await js(`(() => {
    const boxes = [...document.querySelectorAll('.px-say, .px-tag:not(.st-idle):not(.st-stale)')].map(el => ({ el, r: el.getBoundingClientRect() }));
    const out = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!a.el.classList.contains('px-say') && !b.el.classList.contains('px-say')) continue; // tags among themselves are lifted already
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ix > 1 && iy > 1) out.push((a.el.dataset.say || a.el.textContent).slice(0, 12) + ' × ' + (b.el.dataset.say || b.el.textContent).slice(0, 12));
    }
    return out.join(', ');
  })()`);
  check(overlaps === '', `speech bubbles overlap neither each other nor name tags${overlaps ? `: ${overlaps}` : ''}`);
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
  const fit = await width();
  await js("document.querySelector('[data-farm-zoom=\"1\"]').click()");
  check(await width() > fit, 'zooming in makes the farm bigger');
  await js("document.querySelector('[data-farm-zoom=\"0\"]').click()");
  check(await width() === fit, 'the zoom reading fits the farm back to the width');
  await js(`document.querySelector('.px-say[data-say="ui-done-a"] [data-say-close]').click()`);
  await js("document.querySelector('[data-farm-bubbles]').click()");
  check(/Bubbles: off/.test(await js("document.querySelector('[data-farm-bubbles]').textContent")) && await until("!document.querySelector('.px-say, .px-say-min')"), 'the bubbles switch hides them all');
  await js("document.querySelector('[data-farm-bubbles]').click()");
  check(await until("document.querySelectorAll('.px-say').length === 3 && !document.querySelector('.px-say-min')"), 'switching them back on shows them all, hidden ones too');

  const closeUp = "(() => { const c = document.querySelector('#farm canvas'); const r = c.getBoundingClientRect(), cs = r.width / 400; c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 70 * cs, clientY: r.top + 48 * cs })); })()";
  await js(closeUp);
  check(await until("[...document.querySelectorAll('.fv-f')].map(b => b.textContent).join(' ').includes('app.ts')"), 'a field close-up lists the files agents touched');
  check(await js("[...document.querySelectorAll('.fv-f')].some(b => b.textContent.includes('plan.md') && b.querySelector('.k-doc'))"), 'a document in the close-up is a noticeboard');
  await js("document.querySelector('[data-fv-close]').click()");
  check(await js("!document.querySelector('.fv-back')"), 'the close-up closes');

  await js("[...document.querySelectorAll('.px-tag')].find(t => t.textContent.startsWith('ui-asker')).click()");
  check(await until("document.getElementById('main').dataset.side === 'open' && /Which crop next/.test(document.getElementById('farm-agent').textContent)"), 'clicking a farmer opens the sidebar with its question');
  check(await js("document.getElementById('center-body').innerHTML === ''"), 'the hidden centre holds no second answer form');
  await js("(() => { const r = document.querySelector('#farm-agent input[value=\"Pumpkins\"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('ask-send').click(); })()");
  check(await until("/Answer sent to ui-asker/.test(document.getElementById('notice').textContent)"), 'the answer is sent from the farm sidebar');
  check(answered?.answers?.['Which crop next?'] === 'Pumpkins', 'the session received the answer');

  console.log('Back to the list');
  await js("document.getElementById('view-list').click()");
  check(await until("document.getElementById('main').dataset.view === 'list' && document.getElementById('farm-agent').innerHTML === '' && !!document.querySelector('#center-body .ov')"), 'the list view comes back with the agent in the centre');
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  ws?.close();
  chrome.kill();
  worker.kill();
  doneA.kill();
  doneB.kill();
  clearInterval(fakeMod);
  await handle.stop();
  rmSync(temp, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nPASS');
process.exit(failures.length ? 1 : 0);
