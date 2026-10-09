#!/usr/bin/env node
// A screenshot of a world at every stop of the tour, through the test page (/worlds/test): for looking at a
// world you are making, or at what a change did. A server of its own on made-up data, a frozen clock, Chrome.
// No dependencies; needs Chrome (CHROME to set its path).
//
//   npm run world-shots -- <world> [--stop <name>] [--dir <folder>] [--worlds <dir>]
//   <world>: farm, starter, u/<folder> or <folder> (one of yours); pictures go to .private/shots/<world>/
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTrackerServer } from '../collector/server.mjs';
import { makeWorlds } from '../collector/worlds.mjs';
import { openChrome, sleep } from './lib/cdp.mjs';
import { freezeScript } from './lib/freeze.mjs';
import { oneLine } from './lib/plain-text.mjs';
import { ROOT, keyOf, worldsDir } from './lib/worlds-dir.mjs';

const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const arg = args.find((a, i) => !a.startsWith('--') && !['--stop', '--dir', '--worlds'].includes(args[i - 1]));
if (!arg) { console.error('Which world? npm run world-shots -- <farm | starter | your folder>'); process.exit(1); }
const key = keyOf(arg), { dir: userDir } = worldsDir();
const worlds = makeWorlds({ builtinDir: join(ROOT, 'web', 'worlds'), userDir, home: homedir() });
if (!worlds.dirOf(key)) { console.error(`No world ${key}${key.startsWith('u/') ? ` in ${userDir}` : ''}.`); process.exit(1); }
const OUT = resolve(opt('--dir') ?? join(ROOT, '.private', 'shots', key.replace('/', '-')));
mkdirSync(OUT, { recursive: true });

const none = async () => ({ status: 404, error: 'none' });
const srv = createTrackerServer({
  port: 0, token: 'world-shots', webFile: join(ROOT, 'web', 'index.html'), worlds,
  getSnapshot: () => ({ generatedAt: Date.now(), agents: [], repos: [] }), getFeed: () => [], getConversation: async () => null, getPrompts: async () => null, getSubagent: () => null,
  getTranscriptHtml: async () => null, getDoc: () => ({ status: 404, error: 'none' }), listFiles: none, readFile: none, repoTouched: none,
  claudePlugins: async () => ({ plugins: [], skills: [] }), claudeMcp: async () => ({ servers: [], projects: [] }), claudeRules: () => ({ files: [] }),
  fileTicket: none, rawFile: none, officeView: none, listDirs: async () => ({ dir: '/', dirs: [], exists: true }), shellOutput: none, namedFiles: none,
  pastSessions: async () => ({ projects: [], sessions: [] }), actions: {},
});
const port = await srv.listen();
const NOW = Date.UTC(2026, 9, 9, 9, 0); // the tour's moment (web/worlds/test/tour.js)
const chrome = await openChrome({ prepare: async (send, session) => { await send('Page.addScriptToEvaluateOnNewDocument', { source: freezeScript(NOW) }, session); } });
let failed = 0;
try {
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/worlds/test?world=${encodeURIComponent(key)}&stop=everyone` });
  await sleep(500);
  const names = JSON.parse(await chrome.js('JSON.stringify(window.AgentvilleTour.stops.map(s => s.name))'));
  const stops = opt('--stop') ? names.filter(n => n === opt('--stop')) : names;
  if (!stops.length) throw new Error(`No stop named ${opt('--stop')}; the stops: ${names.join(', ')}`);
  for (const stop of stops) {
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/worlds/test?world=${encodeURIComponent(key)}&stop=${stop}` });
    let state = null;
    for (const end = Date.now() + 15_000; Date.now() < end && !state; await sleep(150)) {
      try { state = await chrome.js(`document.body.dataset.shown === ${JSON.stringify(stop)} ? 'shown' : document.querySelector('.world-panel') ? document.querySelector('.world-panel').textContent : null`); } catch { /* loading */ }
    }
    const png = Buffer.from((await chrome.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
    writeFileSync(join(OUT, `${stop}.png`), png);
    const strip = await chrome.js("document.querySelector('.world-strip')?.textContent ?? ''");
    // The panel's words, the strip's and the errors are the world's: printed plain (scripts/lib/plain-text.mjs).
    if (state !== 'shown') { failed++; console.log(`  ✗ ${stop}: ${state ? oneLine(state.trim()) : 'never showed'}`); }
    else console.log(`  ✓ ${stop}${strip ? `  (error strip: ${oneLine(strip.replace('×', '').trim())})` : ''}`);
  }
  if (chrome.errors.length) console.log(`  errors in the page or the frame: ${chrome.errors.map(e => oneLine(e)).join(' | ')}`);
  console.log(`Pictures in ${OUT}`);
} finally {
  await chrome.close();
  await srv.close();
}
process.exit(failed ? 1 : 0);
