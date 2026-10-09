#!/usr/bin/env node
// Reference pictures of the dashboard, to prove a change left the farm looking exactly the same: the
// collector's server on a fixed snapshot (scripts/golden/fixture.mjs), a frozen clock and random numbers,
// motion off, a few views. `--record` saves them; without it each view is compared with its saved
// picture, byte for byte, and any difference fails (the new one is saved beside it as <view>.now.png).
// No dependencies; needs Chrome (CHROME to set its path).
//
//   node scripts/world-golden.mjs [--record] [--only <view>] [--dir .private/golden]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTrackerServer } from '../collector/server.mjs';
import { GOLDEN_NOW, goldenSnapshot, goldenTouched } from './golden/fixture.mjs';
import { openChrome, sleep } from './lib/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const record = process.argv.includes('--record');
const at = process.argv.indexOf('--dir');
const DIR = join(ROOT, at > 0 ? process.argv[at + 1] : '.private/golden');
const onlyAt = process.argv.indexOf('--only'), only = onlyAt > 0 ? process.argv[onlyAt + 1] : null; // one view: to record a new one alone
const DREW = "!!document.querySelector('#farm canvas') && !document.querySelector('.px-loading') && document.querySelectorAll('.px-tag').length > 0";
const VIEWS = [
  { name: 'list', stored: { 'tracker-view': 'list' }, page: "document.querySelectorAll('#list .row').length > 0" },
  { name: 'day', stored: { 'tracker-farm-sky': 'day' } },
  { name: 'night', stored: { 'tracker-farm-sky': 'night' } },
  { name: 'zoomed', stored: { 'tracker-farm-sky': 'day', 'tracker-farm-zoom': '2' } },
  { name: 'sidebar', stored: { 'tracker-farm-sky': 'day', 'tracker-farm-side': 'open' } },
  { name: 'closeup', stored: { 'tracker-farm-sky': 'day' }, then: "document.querySelector('[data-farm-field$=\"/shop/web\"]').click(); true", ready: "document.querySelectorAll('.fv-f').length > 0" },
];
// Before any script of the page or a frame runs: one moment in time, and the same "random" numbers.
const FREEZE = `(() => {
  const NOW = ${GOLDEN_NOW}, Real = Date;
  globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
  let seed = 7;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // The "need you" button and the status dots pulse in CSS whatever the media query says: hold every animation at its start.
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.documentElement.append(s);
  });
})();`;

const snapshot = goldenSnapshot();
const none = async () => ({ status: 404, error: 'Not in the reference pictures.' });
const srv = createTrackerServer({
  port: 0, token: 'golden', webFile: join(ROOT, 'web', 'index.html'),
  getSnapshot: () => snapshot, getFeed: () => [], getConversation: async () => null, getPrompts: async () => null, getSubagent: () => null,
  getTranscriptHtml: async () => null, getDoc: () => ({ status: 404, error: 'none' }), listFiles: none, readFile: none,
  repoTouched: async path => goldenTouched(path), claudePlugins: async () => ({ plugins: [], skills: [] }), claudeMcp: async () => ({ servers: [], projects: [] }),
  claudeRules: () => ({ files: [] }), fileTicket: none, rawFile: none, officeView: none, listDirs: async () => ({ dir: '/', dirs: [], exists: true }),
  shellOutput: none, namedFiles: none, pastSessions: async () => ({ projects: [], sessions: [] }), actions: {},
});
const port = await srv.listen();
const chrome = await openChrome({
  prepare: async (send, session) => {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE }, session);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] }, session);
  },
});
const failures = [];
try {
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(800);
  // The farm draws in the page until it moves into its frame (worlds Task 7); look wherever it is.
  const farm = async expr => ((await chrome.js("!!document.querySelector('#farm iframe')")) ? chrome.inFrame('/world/', expr) : chrome.js(expr));
  const until = async (check, ms = 15_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) { try { if (await check()) return true; } catch { /* not there yet */ } }
    return false;
  };
  mkdirSync(DIR, { recursive: true });
  for (const v of VIEWS.filter(x => !only || x.name === only)) {
    const stored = { 'tracker-view': 'farm', 'tracker-theme': 'dark', ...v.stored };
    await chrome.js(`localStorage.clear(); ${JSON.stringify(Object.entries(stored))}.forEach(([k, x]) => localStorage.setItem(k, x)); true`);
    await chrome.send('Page.reload', { ignoreCache: true });
    await sleep(400);
    const drew = v.page ? await until(() => chrome.js(v.page)) : await until(() => farm(DREW));
    if (!drew) { failures.push(`${v.name}: never drew`); continue; }
    if (v.then) {
      await farm(v.then);
      if (!(await until(() => farm(v.ready)))) { failures.push(`${v.name}: ${v.ready} never came true`); continue; }
    }
    await sleep(1500); // the pixel font's images, the close-up's first frame
    const png = Buffer.from((await chrome.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
    const file = join(DIR, `${v.name}.png`);
    if (record) { writeFileSync(file, png); console.log(`  saved  ${v.name}`); continue; }
    if (!existsSync(file)) { failures.push(`${v.name}: no saved picture (run with --record first)`); continue; }
    if (png.equals(readFileSync(file))) console.log(`  same   ${v.name}`);
    else { writeFileSync(join(DIR, `${v.name}.now.png`), png); failures.push(`${v.name}: differs (see ${join(DIR, `${v.name}.now.png`)})`); }
  }
  if (chrome.errors.length) failures.push(`errors in the page: ${chrome.errors.join(' | ')}`);
} finally {
  await chrome.close();
  await srv.close();
}
for (const f of failures) console.log(`  FAIL   ${f}`);
process.exit(failures.length ? 1 : 0);
