#!/usr/bin/env node
// The 3D farm in a real browser (it needs WebGL, so check-world's vm can't run it): every stop of the tour on the
// test page, checked from inside the world's frame (window.__farm3d.stats): it started, drew something, and has a
// name tag for each farmer it shows, with no error strip, panel or script error. Then a crowd with no repos (the
// "+N" signs for farmers beyond a place's room) and a fresh farm with nothing at all; a farmer's tooltip when
// you point at it on the canvas. Then memory: the busiest stop
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

    // 2. a crowd with no repos (more farmers than places: the 2D farm's "+N" signs), and a fresh farm with nothing at all
    const person = (id, state, over = {}) => ({ id, kind: 'interactive', name: id, cwd: '/Users/you/elsewhere', state, stateReason: 'busy', stateSince: NOW, feed: [], children: [], touching: [], contextTokens: 40_000,
      proc: { cpu: 1, rssMb: 100, pid: 1, childCount: 0, children: [] }, usage: { costUsd: 0.1 }, mode: 'default', model: 'claude-sonnet-5-5', fast: false, tasks: null, compactions: 0, mcp: [],
      now: state === 'working' ? { tool: 'Edit', step: 'edit', summary: 'x', startedAt: NOW } : null, ...over });
    const many = (n, state, tag) => Array.from({ length: n }, (_, i) => person(`${tag}${i}`, state));
    const crowd = { generatedAt: NOW, collisions: [], repos: [], settings: { cpuAlertPct: 90 }, agents: [...many(7, 'waiting', 'w'), ...many(3, 'yourTurn', 't'), ...many(6, 'stale', 's'), ...many(9, 'idle', 'i'), ...many(6, 'working', 'm')] };
    // two Claude accounts with no reading of their limits yet (a copy of the dashboard the mod doesn't talk to): a silo each, with a dash
    const account = (key, name) => ({ key, name, email: null, signedIn: true, open: 0, costUsd: 0, plan: null });
    const unread = { generatedAt: NOW, collisions: [], repos: [], agents: [person('a', 'idle')], accounts: [account('main', 'work'), account('zeta', 'home')] };
    for (const [name, snap, want, signs] of [['a crowd with no repos', crowd, 18, ['+4 waiting', '+2 stale', '+5 idle', '+2 in the meadow']], ['a fresh farm with nothing at all', { generatedAt: NOW, collisions: [], repos: [], agents: [] }, 0, ['No fields yet']], ['two accounts with no reading of their limits yet', unread, 1, ['work –', 'home –']]]) {
      await open(chrome, 'everyone');
      const before = chrome.errors.length;
      await chrome.js(`window.TrackerFarm.update(${JSON.stringify(snap)})`);
      await sleep(900);
      const s = await statsOf(chrome), text = await chrome.inFrame('/world/farm3d/', "[...document.querySelectorAll('.f3-ov > *')].filter(e => e.style.display !== 'none').map(e => e.textContent).join(' | ')"), strip = await stripOf(chrome);
      const why = [
        !(s?.calls > 0) && 'it drew nothing',
        s && s.drawn !== want && `${s.drawn} farmers drawn, not ${want}`,
        s && s.tags !== s.drawn && `${s.tags} name tags for ${s.drawn} farmers`,
        ...signs.filter(t => !(text ?? '').includes(t)).map(t => `no "${t}" sign`),
        strip && `an error strip: ${oneLine(strip).slice(0, 160)}`,
        chrome.errors.length > before && `script errors: ${oneLine(chrome.errors[before]).slice(0, 160)}`,
      ].filter(Boolean);
      if (why.length) bad(`${name}: ${why.join('; ')}`);
      else console.log(`  ✓ ${name}: ${want} farmers drawn${signs.length ? `, ${signs.join(', ')}` : ''}`);
    }

    // 3. hovering a farmer on the canvas shows its tooltip (the same words as its name tag's)
    {
      await open(chrome, 'everyone');
      await sleep(600);
      const r = JSON.parse(await chrome.inFrame('/world/farm3d/', `(() => {
        const tag = document.querySelector('.f3-tag:not(.st-waiting):not(.st-turn)'), id = tag?.dataset.id, at = id && window.__farm3d.screenOf(id);
        if (!at) return JSON.stringify({ none: true });
        const c = document.querySelector('.f3-canvas'), box = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + at.x, clientY: box.top + at.y + 18, pointerId: 1 }));
        return JSON.stringify({ id, tip: tag.title });
      })()`));
      let title = '';
      for (const end = Date.now() + 3000; Date.now() < end && !title; await sleep(100)) title = await chrome.inFrame('/world/farm3d/', "document.querySelector('.f3-canvas').title"); // the hover is read on the next frame, which waits while models load
      if (r.none || !r.tip || title !== r.tip) bad(`hover: pointing at ${r.id ?? 'a farmer'} gave the tooltip "${oneLine(title ?? '').slice(0, 80)}", not "${oneLine(r.tip ?? '').slice(0, 80)}"`);
      else console.log(`  ✓ hover: pointing at ${r.id} shows its tooltip`);
    }

    // 4. the animals: the twelve of Quaternius's Animated Animal Pack, 14 in all once their models have loaded (they
    // load after the farm has drawn); clicking one opens its menu, a pick from it sets it going and shuts the menu,
    // Esc shuts it too; and the Animals switch hides them all
    {
      await open(chrome, 'everyone');
      let on = 0;
      for (const end = Date.now() + 30_000; Date.now() < end && on !== 14; await sleep(250)) on = (await statsOf(chrome))?.animals;
      const before = chrome.errors.length;
      const clickAnimal = i => chrome.inFrame('/world/farm3d/', `(() => {
        const m = window.__farm3d; m.view({ zoom: 3, at: m.animal(${i}).spot });
        return new Promise(done => setTimeout(() => {
          const at = m.animal(${i}).at, c = document.querySelector('.f3-canvas'), b = c.getBoundingClientRect(), o = { bubbles: true, clientX: b.left + at.x, clientY: b.top + at.y, pointerId: 9, button: 0 };
          for (const type of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(type, o));
          done(JSON.stringify({ kind: m.animal(${i}).kind, menu: [...document.querySelectorAll('.f3-pet [data-act]')].map(b => b.dataset.act) }));
        }, 1200));
      })()`);
      const cow = JSON.parse(await clickAnimal(0));
      await chrome.inFrame('/world/farm3d/', "document.querySelector('.f3-pet [data-act=\"hop\"]')?.click()");
      await sleep(150);
      const doing = JSON.parse(await chrome.inFrame('/world/farm3d/', "JSON.stringify({ act: window.__farm3d.animal(0).act, open: Boolean(document.querySelector('.f3-pet')) })"));
      const dog = JSON.parse(await clickAnimal(8));
      await chrome.inFrame('/world/farm3d/', "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      const shut = await chrome.inFrame('/world/farm3d/', "Boolean(document.querySelector('.f3-pet'))");
      const menuOk = cow.kind === 'cow' && cow.menu.includes('headbutt') && cow.menu.includes('dead') && doing.act === 'hop' && !doing.open && dog.kind === 'husky' && dog.menu.includes('fetch') && shut === false;
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-menu]').click()");
      await sleep(200);
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-animals]').click()");
      await sleep(400);
      const off = (await statsOf(chrome))?.animals, strip = await stripOf(chrome);
      if (on !== 14 || off !== 0 || !menuOk || strip || chrome.errors.length > before) bad(`animals: ${on} out (14 wanted), ${off} after the Animals switch (0 wanted); the cow's menu ${cow.menu.join(' ') || 'never opened'}, after Hop ${JSON.stringify(doing)}; the husky's menu ${dog.menu.join(' ') || 'never opened'}, after Esc ${shut ? 'still open' : 'shut'}${strip ? `; an error strip: ${oneLine(strip).slice(0, 160)}` : ''}`);
      else console.log('  ✓ animals: 14 out once loaded; a click opens one\'s menu (the husky\'s has Throw a stick), Hop sets the cow hopping, Esc shuts it; none after the Animals switch');
    }

    // 5. memory: the busiest stop and an empty one, swapped 300 times; the geometry held comes back to the same
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

  // 6. no WebGL: the plain panel, the world started all the same, and no error
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
