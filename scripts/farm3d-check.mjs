#!/usr/bin/env node
// The 3D farm in a real browser (it needs WebGL, so check-world's vm can't run it): every stop of the tour on the
// test page, checked from inside the world's frame (window.__farm3d.stats): it started, drew something, and has a
// name tag for each farmer it shows, with no error strip, panel or script error. Then memory: the busiest stop
// and an empty one swapped 300 times, and the geometry it holds is the same at the end. Then with WebGL forced
// off: the plain panel, and no error. Its own server on made-up data, a frozen clock, Chrome. No dependencies.
//
//   npm run farm3d-check
import { join } from 'node:path';
import { createTrackerServer } from '../collector/server.mjs';
import { makeWorlds } from '../collector/worlds.mjs';
import { openChrome, sleep } from './lib/cdp.mjs';
import { freezeScript } from './lib/freeze.mjs';
import { oneLine } from './lib/plain-text.mjs';
import { ROOT } from './lib/worlds-dir.mjs';

const NOW = Date.UTC(2026, 9, 9, 9, 0); // the tour's moment (web/worlds/test/tour.js)
const none = async () => ({ status: 404, error: 'none' });
const srv = createTrackerServer({
  port: 0, token: 'farm3d-check', webFile: join(ROOT, 'web', 'index.html'), worlds: makeWorlds({ builtinDir: join(ROOT, 'web', 'worlds') }),
  getSnapshot: () => ({ generatedAt: Date.now(), agents: [], repos: [] }), getFeed: () => [], getConversation: async () => null, getPrompts: async () => null, getSubagent: () => null,
  getTranscriptHtml: async () => null, getDoc: () => ({ status: 404, error: 'none' }), listFiles: none, readFile: none, repoTouched: none,
  claudePlugins: async () => ({ plugins: [], skills: [] }), claudeMcp: async () => ({ servers: [], projects: [] }), claudeRules: () => ({ files: [] }),
  fileTicket: none, rawFile: none, officeView: none, listDirs: async () => ({ dir: '/', dirs: [], exists: true }), shellOutput: none, namedFiles: none,
  pastSessions: async () => ({ projects: [], sessions: [] }), actions: {},
});
const port = await srv.listen();
const page = stop => `http://127.0.0.1:${port}/worlds/test?world=farm3d&stop=${encodeURIComponent(stop)}`;
let failed = 0;
const bad = line => { failed++; console.log(`  ✗ ${line}`); };

/** Opens a stop and waits until the test page says it is shown; returns the page's own word if it never is. */
async function open(chrome, stop) {
  await chrome.send('Page.navigate', { url: page(stop) });
  for (const end = Date.now() + 15_000; Date.now() < end; await sleep(150)) {
    try {
      const s = await chrome.js(`document.body.dataset.shown === ${JSON.stringify(stop)} ? 'shown' : document.querySelector('.world-panel')?.textContent ?? null`);
      if (s) return s;
    } catch { /* the page is still loading */ }
  }
  return 'never showed';
}
const statsOf = async chrome => JSON.parse((await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d?.stats?.() ?? null)')) ?? 'null');
const stripOf = chrome => chrome.js("document.querySelector('.world-strip')?.textContent ?? ''");

try {
  // 1. every stop of the tour
  const chrome = await openChrome({ prepare: async (send, session) => { await send('Page.addScriptToEvaluateOnNewDocument', { source: freezeScript(NOW) }, session); } });
  try {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    await open(chrome, 'everyone');
    const stops = JSON.parse(await chrome.js('JSON.stringify(window.AgentvilleTour.stops.map(s => s.name))'));
    console.log(`farm3d-check: ${stops.length} stops of the tour`);
    for (const stop of stops) {
      const before = chrome.errors.length, state = await open(chrome, stop);
      await sleep(700); // a few frames: drawn, tags placed
      const s = await statsOf(chrome), strip = await stripOf(chrome), errors = chrome.errors.slice(before);
      const why = [
        state !== 'shown' && `it never showed (${oneLine(String(state)).slice(0, 160)})`,
        !s && 'no stats from the frame (it did not start)',
        s?.noWebGL && 'this Chrome has no WebGL',
        s && !(s.calls > 0 && s.triangles > 1000) && `it drew too little (${s.calls} calls, ${s.triangles} triangles)`,
        s && s.tags !== s.drawn && `${s.tags} name tags for ${s.drawn} farmers`,
        s && s.farmers !== s.drawn && `${s.farmers} figures for ${s.drawn} farmers`,
        strip && `an error strip: ${oneLine(strip.replace('×', '').trim()).slice(0, 200)}`,
        errors.length && `script errors: ${oneLine(errors[0]).slice(0, 200)}`,
      ].filter(Boolean);
      if (why.length) bad(`${stop}: ${why.join('; ')}`);
      else console.log(`  ✓ ${stop}  (${s.drawn} farmers, ${s.beds} fields, ${s.calls} draw calls)`);
    }

    // 2. memory: the busiest stop and an empty one, swapped 300 times; the geometry held comes back to the same
    await open(chrome, 'everyone');
    const frames = JSON.parse(await chrome.js("JSON.stringify(['everyone', 'nobody'].map(n => window.AgentvilleTour.stops.find(s => s.name === n).frames[0]))"));
    await chrome.js(`window.__f3frames = ${JSON.stringify(frames)}`);
    await sleep(500);
    const g0 = (await statsOf(chrome)).geometries;
    for (let i = 0; i < 300; i++) { await chrome.js(`window.TrackerFarm.update(window.__f3frames[${i % 2 ? 0 : 1}])`); await sleep(40); }
    await chrome.js('window.TrackerFarm.update(window.__f3frames[0])');
    await sleep(800);
    const g1 = (await statsOf(chrome)).geometries;
    if (Math.abs(g1 - g0) > 5) bad(`memory: ${g0} geometries before 300 scene swaps, ${g1} after`);
    else console.log(`  ✓ memory: ${g0} geometries before 300 scene swaps, ${g1} after`);
  } finally { await chrome.close(); }

  // 3. no WebGL: the plain panel, the world started all the same, and no error
  const noGl = await openChrome({ prepare: async (send, session) => { await send('Page.addScriptToEvaluateOnNewDocument', { source: `${freezeScript(NOW)}\nwindow.__farm3dForceNoWebGL = true;` }, session); } });
  try {
    await noGl.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    const state = await open(noGl, 'everyone');
    await sleep(500);
    const s = await statsOf(noGl), text = await noGl.inFrame('/world/farm3d/', "document.querySelector('.f3-nogl')?.textContent ?? ''"), strip = await stripOf(noGl);
    if (state !== 'shown' || !s?.noWebGL || !/needs WebGL/.test(text ?? '') || strip || noGl.errors.length) bad(`without WebGL: ${JSON.stringify({ state, s, text: oneLine(text ?? '').slice(0, 120), strip, errors: noGl.errors.length })}`);
    else console.log('  ✓ without WebGL: the plain panel, started, no error');
  } finally { await noGl.close(); }
} finally {
  await srv.close();
}
console.log(failed ? `${failed} problem${failed === 1 ? '' : 's'}` : 'All good.');
process.exit(failed ? 1 : 0);
