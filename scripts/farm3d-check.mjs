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
import { COATS, SPOTS } from '../web/worlds/farm3d/coats.js';
import { HERDS } from '../web/worlds/farm3d/antics.js';

// how many animals there are, and which is the frog (the farm numbers them herd by herd)
const ANIMALS = HERDS.reduce((n, h) => n + h.n, 0), FROG = HERDS.slice(0, HERDS.findIndex(h => h.kind === 'frog')).reduce((n, h) => n + h.n, 0);

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
        return JSON.stringify({ id, tip: tag.title, at });
      })()`));
      let title = '';
      // down its body from over its head (how far depends on how big the farm is drawn): the first point that is the farmer
      for (const dy of [8, 12, 16, 20, 26]) {
        if (r.none || title === r.tip) break;
        await chrome.inFrame('/world/farm3d/', `(() => { const c = document.querySelector('.f3-canvas'), box = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + ${r.at?.x ?? 0}, clientY: box.top + ${r.at?.y ?? 0} + ${dy}, pointerId: 1 })); return true; })()`);
        title = '';
        for (const end = Date.now() + 1000; Date.now() < end && !title; await sleep(100)) title = await chrome.inFrame('/world/farm3d/', "document.querySelector('.f3-canvas').title");
      }
      if (r.none || !r.tip || title !== r.tip) bad(`hover: pointing at ${r.id ?? 'a farmer'} gave the tooltip "${oneLine(title ?? '').slice(0, 80)}", not "${oneLine(r.tip ?? '').slice(0, 80)}"`);
      else console.log(`  ✓ hover: pointing at ${r.id} shows its tooltip`);
    }

    // 3b. the panel and the Menu: the 2D farm's (panelHud), every button there; no page corner over it; a count card
    // opens its first farmer (the page picks it, and the world shows it picked); Resting hides the idle and stale
    {
      await open(chrome, 'everyone');
      await sleep(600);
      const before = chrome.errors.length;
      const WANT = ['[data-farm-nav="list"]', '[data-farm-nav="worlds"]', '[data-farm-nav="session"]', '[data-farm-nav="setup"]', '[data-farm-nav="side"]', '[data-farm-nav="broadcast"]', '[data-farm-nav="chats"]', '[data-farm-nav="theme"]',
        '[data-farm-follow]', '[data-farm-resting]', '[data-farm-bubbles]', '[data-farm-animals]', '[data-farm-sky]', '[data-farm-season]', '[data-farm-motion]', '[data-farm-bell]', '[data-farm-help]', '[data-farm-zoom="1"]', '[data-f3-turn="-1"]', '[data-f3-reset]'];
      const hud = JSON.parse(await chrome.inFrame('/world/farm3d/', `JSON.stringify({ stats: Boolean(document.querySelector('.px-stats .px-brand[data-farm-panel]')), kpis: document.querySelectorAll('.px-kpi').length, gauges: document.querySelectorAll('.px-gauge').length, missing: ${JSON.stringify(WANT)}.filter(q => !document.querySelector(q)) })`));
      const corner = await chrome.js("Boolean(document.querySelector('.world-corner'))");
      // at 100% no farmer is under the panel: the farm is fitted beside it or below it
      const under = JSON.parse(await chrome.inFrame('/world/farm3d/', `(() => {
        const r = document.querySelector('.px-stats').getBoundingClientRect(), m = window.__farm3d;
        return JSON.stringify(m.farmerIds().filter(id => { const p = m.screenOf(id); return p && p.x < r.right && p.y < r.bottom; }));
      })()`));
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-state=\"waiting\"]')?.click()");
      let picked = null; // the test page lists what the world asked of it: "pick <id>"
      for (const end = Date.now() + 3000; Date.now() < end && !picked; await sleep(100)) picked = await chrome.js("/^pick (\\S+)$/.exec(document.querySelector('#asked li')?.textContent ?? '')?.[1] ?? null");
      const waitingIds = JSON.parse(await chrome.inFrame('/world/farm3d/', "JSON.stringify([...document.querySelectorAll('.f3-tag.st-waiting')].map(t => t.dataset.id))"));
      const shown = (await statsOf(chrome))?.drawn;
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-menu]').click(); document.querySelector('[data-farm-resting]').click()");
      await sleep(500);
      const hidden = (await statsOf(chrome))?.drawn, label = await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-resting]').textContent");
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-resting]').click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      await sleep(300);
      const back = (await statsOf(chrome))?.drawn;
      const why = [
        !hud.stats && 'no panel', hud.kpis !== 4 && `${hud.kpis} count cards`, hud.gauges < 2 && `${hud.gauges} meters`, hud.missing.length && `missing ${hud.missing.join(' ')}`,
        corner && "the page's corner is over it", under.length && `farmers under the panel at 100%: ${under.join(', ')}`, !waitingIds.includes(picked) && `the waiting card picked ${picked}, not one of ${waitingIds.join(', ')}`,
        !(hidden < shown) && `Resting hid nothing (${shown} → ${hidden})`, !/hidden/.test(label ?? '') && `Resting says "${oneLine(label ?? '')}"`, back !== shown && `Resting back: ${back}, not ${shown}`,
        chrome.errors.length > before && `script errors: ${oneLine(chrome.errors[before]).slice(0, 160)}`,
      ].filter(Boolean);
      if (why.length) bad(`the panel and the Menu: ${why.join('; ')}`);
      else console.log(`  ✓ the panel and the Menu: the farm's, every button; no corner; the waiting card picks ${picked}; Resting hides ${shown - hidden}`);
    }

    // 3c. the buildings: each opens the 2D farm's dialog (the barn starts a session); Open in the porch's picks its farmer
    {
      await open(chrome, 'everyone');
      await sleep(600);
      const before = chrome.errors.length, got = {};
      const clickAt = js => chrome.inFrame('/world/farm3d/', `(() => { const at = ${js}; if (!at) return false; const c = document.querySelector('.f3-canvas'), b = c.getBoundingClientRect(), o = { bubbles: true, clientX: b.left + at.x, clientY: b.top + at.y, pointerId: 7, button: 0 }; for (const type of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(type, o)); return true; })()`);
      const TITLES = { house: 'Your porch', silo: 'The silo: your plan', henhouse: 'The henhouse: subagents', stall: 'The market stall: pull requests', board: 'The notice board: what your projects remember' };
      for (const k of Object.keys(TITLES)) {
        await clickAt(`window.__farm3d.buildingAt('${k}')`);
        await sleep(400);
        got[k] = JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.dialog())'));
        if (k !== 'house') await chrome.inFrame('/world/farm3d/', "document.querySelector('dialog.px-dlg')?.close(); true");
        else {
          await chrome.inFrame('/world/farm3d/', "document.querySelector('dialog.px-dlg [data-farm-pick]')?.click(); true");
          await sleep(300);
          got.pick = /^pick /.test(await chrome.js("document.querySelector('#asked li')?.textContent ?? ''")) && !JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.dialog())')).open;
        }
      }
      // open pull requests: a crate each on the stall's counter, and its "N PRs" label
      const tour = JSON.parse(await chrome.js("JSON.stringify(window.AgentvilleTour.stops.find(s => s.name === 'everyone').frames[0])"));
      tour.repos = tour.repos.map((r, i) => (i ? r : { ...r, prs: { open: [{ number: 7, title: 'Faster carts', checks: 'running' }, { number: 8, title: 'Hens', checks: 'ok' }], merged: [] } }));
      await chrome.js(`window.TrackerFarm.update(${JSON.stringify(tour)})`);
      await sleep(700);
      got.prs = await chrome.inFrame('/world/farm3d/', "[...document.querySelectorAll('.f3-ov .f3-cnt')].some(e => e.title.startsWith('Open pull requests: #7 Faster carts · #8 Hens'))");
      // a field: its label opens its close-up (the engine's), Esc shuts it; on the canvas too
      await chrome.inFrame('/world/farm3d/', "document.querySelector('.f3-field')?.click(); true");
      let fv = '';
      for (const end = Date.now() + 3000; Date.now() < end && !/Could not load/.test(fv); await sleep(100)) fv = await chrome.inFrame('/world/farm3d/', "document.querySelector('.fv-back')?.textContent ?? ''");
      got.field = /the files agents read or wrote here|Could not load/.test(fv);
      await chrome.inFrame('/world/farm3d/', "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
      await sleep(200);
      got.fieldShut = !(await chrome.inFrame('/world/farm3d/', "Boolean(document.querySelector('.fv-back'))"));
      await clickAt("window.__farm3d.bedAt(window.__farm3d.bedKeys()[0])");
      await sleep(400);
      got.bed = await chrome.inFrame('/world/farm3d/', "Boolean(document.querySelector('.fv-back'))");
      await chrome.inFrame('/world/farm3d/', "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
      await sleep(200);
      await clickAt("window.__farm3d.buildingAt('barn')");
      await sleep(300);
      const barn = await chrome.js("document.querySelector('#asked li')?.textContent ?? ''");
      const why = [
        ...Object.entries(TITLES).filter(([k, t]) => !got[k]?.open || got[k].title !== t).map(([k, t]) => `${k}: ${JSON.stringify(got[k])}, not "${t}"`),
        !got.pick && "Open in the porch's dialog didn't pick its farmer", !got.field && `a field's label opened no close-up ("${oneLine(fv).slice(0, 80)}")`, !got.fieldShut && 'Esc left the close-up open', !got.bed && 'a click on a bed opened no close-up', !got.prs && 'no "2 PRs" label at the stall', barn !== 'start a session' && `the barn asked "${barn}"`,
        chrome.errors.length > before && `script errors: ${oneLine(chrome.errors[before]).slice(0, 160)}`,
      ].filter(Boolean);
      if (why.length) bad(`the buildings: ${why.join('; ')}`);
      else console.log("  ✓ the buildings: the porch, the silo, the henhouse, the stall and the notice board open their dialogs; Open picks; the barn starts a session; a field's label opens its close-up");
    }

    // 3d. the diary: the page's Farm diary fills from the 3D farm; a harvest pops "Harvest!" over its farmer
    {
      await open(chrome, 'everyone');
      await sleep(600);
      const before = chrome.errors.length;
      const lines = Number(await chrome.js("document.querySelectorAll('#diary li').length"));
      const tour = JSON.parse(await chrome.js("JSON.stringify(window.AgentvilleTour.stops.find(s => s.name === 'everyone').frames[0])"));
      const who = tour.agents.find(a => a.state === 'working');
      who.compactions = (who.compactions ?? 0) + 1;
      await chrome.js(`window.TrackerFarm.update(${JSON.stringify(tour)})`);
      let pops = [];
      for (const end = Date.now() + 2000; Date.now() < end && !pops.some(p => /Harvest!/.test(p)); await sleep(100)) pops = JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.pops())'));
      const harvest = await chrome.js("[...document.querySelectorAll('#diary li')].some(li => /brings in the harvest/.test(li.textContent))");
      const why = [!(lines > 0) && 'the Farm diary is empty', !pops.some(p => /Harvest!/.test(p)) && `no "Harvest!" pop (${pops.join(', ')})`, !harvest && 'no harvest line in the diary', chrome.errors.length > before && `script errors: ${oneLine(chrome.errors[before]).slice(0, 160)}`].filter(Boolean);
      if (why.length) bad(`the diary: ${why.join('; ')}`);
      else console.log(`  ✓ the diary: ${lines} lines in the Farm diary; a harvest pops "Harvest!" and is told`);
    }

    // 3e. subagents: a hen and the Explore dog at their farmer's heels, an egg in the henhouse for the one done
    {
      await open(chrome, 'subagents');
      const before = chrome.errors.length;
      let s = null;
      for (const end = Date.now() + 15_000; Date.now() < end && !(s?.dogs === 1); await sleep(250)) s = await statsOf(chrome); // the dog's model loads after the farm draws
      const labels = await chrome.inFrame('/world/farm3d/', "[...document.querySelectorAll('.f3-ov .f3-cnt')].map(e => e.title).join(' | ')");
      const why = [s?.hens !== 1 && `${s?.hens} hens, not 1`, s?.dogs !== 1 && `${s?.dogs} Explore dogs, not 1`, s?.eggs !== 1 && `${s?.eggs} eggs, not 1`, !/subagents that finished lately/.test(labels ?? '') && 'no eggs label',
        chrome.errors.length > before && `script errors: ${oneLine(chrome.errors[before]).slice(0, 160)}`].filter(Boolean);
      if (why.length) bad(`subagents: ${why.join('; ')}`);
      else console.log('  ✓ subagents: a hen and the Explore dog follow their farmer; an egg in the henhouse, its label');
    }

    // 3f. an MCP call: its server's cart drives beside the farmer calling it, labelled; when the call is over it goes home
    {
      await open(chrome, 'mcp');
      const before = chrome.errors.length;
      const near = async () => JSON.parse(await chrome.inFrame('/world/farm3d/', `(() => { const m = window.__farm3d, c = m.carts()[0], id = m.farmerIds()[0], p = id && m.posOf(id); return JSON.stringify(c && p ? { away: c.away, d: Math.hypot(c.x - p.x, c.y - p.y), server: c.server } : null); })()`));
      let c = null;
      for (const end = Date.now() + 15_000; Date.now() < end && !(c?.away && c.d < 20); await sleep(250)) c = await near();
      const label = await chrome.inFrame('/world/farm3d/', "[...document.querySelectorAll('.f3-ov .f3-cnt')].map(e => e.title).find(t => /an MCP server/.test(t)) ?? ''");
      const tour = JSON.parse(await chrome.js("JSON.stringify(window.AgentvilleTour.stops.find(s => s.name === 'mcp').frames[0])"));
      for (const a of tour.agents) { a.now = { tool: 'Edit', summary: 'x', step: 'edit', startedAt: Date.now() }; }
      await chrome.js(`window.TrackerFarm.update(${JSON.stringify(tour)})`);
      let home = null;
      for (const end = Date.now() + 20_000; Date.now() < end && !(home && !home.away); await sleep(400)) home = await near();
      const s = await statsOf(chrome);
      const why = [!(c?.away && c.d < 20) && `the cart never came beside its farmer (${JSON.stringify(c)})`, !label && 'no label on the cart', !(home && !home.away) && `the cart never went home (${JSON.stringify(home)})`, !(s?.carts >= 1) && `${s?.carts} carts drawn`,
        chrome.errors.length > before && `script errors: ${oneLine(chrome.errors[before]).slice(0, 160)}`].filter(Boolean);
      if (why.length) bad(`the carts: ${why.join('; ')}`);
      else console.log(`  ✓ the carts: ${c.server}'s drives beside the farmer calling it ("${oneLine(label)}"), then home`);
    }

    // 4. the animals: the twelve of Quaternius's Animated Animal Pack and the pond's frog and fish, all out once their
    // models have loaded (they load after the farm has drawn), in the farm's colours (coats.js) with no metal, the cows
    // spotted; clicking one opens its menu (the frog's its own), a pick from it sets it going and shuts the menu, Esc
    // shuts it too; and the Animals switch hides them all
    {
      await open(chrome, 'everyone');
      let on = 0;
      for (const end = Date.now() + 30_000; Date.now() < end && on !== ANIMALS; await sleep(250)) on = (await statsOf(chrome))?.animals;
      const before = chrome.errors.length;
      const coat = JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.animal(0)?.coat ?? null)'));
      const coatOk = Boolean(coat) && coat.metal === 0 && Object.entries(COATS.cow).every(([name, hex]) => coat.colours[name] === hex) && Math.abs((coat.spots ?? 0) - SPOTS.cow.share) < 0.05;
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
      let frog = { menu: [] }; // it may be under water or mid-hop (out of reach): a few tries
      for (let k = 0; k < 6 && !frog.menu.length; k++) { frog = JSON.parse(await clickAnimal(FROG)); if (!frog.menu.length) await sleep(1500); }
      await chrome.inFrame('/world/farm3d/', "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      const dog = JSON.parse(await clickAnimal(8));
      await chrome.inFrame('/world/farm3d/', "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      // Talk: the cow says something at once; with Bubbles off nothing shows
      await clickAnimal(0);
      await chrome.inFrame('/world/farm3d/', "document.querySelector('.f3-pet [data-act=\"talk\"]')?.click()");
      await sleep(400);
      const said = JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.talk())'));
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-menu]').click()");
      await sleep(150);
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-bubbles]').click()");
      await sleep(400);
      const hushed = JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.talk())'));
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-bubbles]').click()"); // back on
      await chrome.inFrame('/world/farm3d/', "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      // Haiku's talk: a snapshot carrying a batch reaches the world through the page (its talk cast said first)
      const stockBefore = Number(await chrome.inFrame('/world/farm3d/', 'window.__farm3d.talkStock()'));
      await chrome.js(`window.TrackerFarm.update({ generatedAt: Date.now(), agents: [], repos: [], talk: { at: Date.now(), exchanges: [{ lines: [{ who: 'cow', text: 'Grass is grass.' }, { who: 'horse', text: 'Speak for yourself.' }] }, { lines: [{ who: 'dragon', text: 'Rawr.' }, { who: 'cow', text: 'Eek.' }] }] } })`);
      await sleep(500);
      const stocked = Number(await chrome.inFrame('/world/farm3d/', 'window.__farm3d.talkStock()')) - stockBefore;
      const shut = await chrome.inFrame('/world/farm3d/', "Boolean(document.querySelector('.f3-pet'))");
      const menuOk = cow.kind === 'cow' && cow.menu.includes('headbutt') && cow.menu.includes('dead') && doing.act === 'hop' && !doing.open && dog.kind === 'husky' && dog.menu.includes('fetch') && shut === false && frog.kind === 'frog' && frog.menu.join(' ') === 'talk hop snap dive dead' && cow.menu.includes('talk') && said.length >= 1 && said.every(t => t.length) && hushed.length === 0 && stocked === 1;
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-menu]').click()");
      await sleep(200);
      await chrome.inFrame('/world/farm3d/', "document.querySelector('[data-farm-animals]').click()");
      await sleep(400);
      const off = (await statsOf(chrome))?.animals, strip = await stripOf(chrome);
      if (on !== ANIMALS || off !== 0 || !coatOk || !menuOk || strip || chrome.errors.length > before) bad(`animals: ${on} out (${ANIMALS} wanted), ${off} after the Animals switch (0 wanted); the cow's colours ${JSON.stringify(coat)} (coats.js's, no metal, spots on about ${SPOTS.cow.share} of her coat, wanted); the cow's menu ${cow.menu.join(' ') || 'never opened'}, after Hop ${JSON.stringify(doing)}; the frog's menu ${frog.menu.join(' ') || 'never opened'}; Talk said ${JSON.stringify(said)}, with Bubbles off ${JSON.stringify(hushed)}; Haiku's talk kept ${stocked} (1 wanted: the dragon's isn't this farm's); the husky's menu ${dog.menu.join(' ') || 'never opened'}, after Esc ${shut ? 'still open' : 'shut'}${strip ? `; an error strip: ${oneLine(strip).slice(0, 160)}` : ''}`);
      else console.log(`  ✓ animals: ${ANIMALS} out once loaded (the frog and the fish too), in coats.js's colours with no metal, the cow spotted; a click opens one's menu (the frog's its own, the husky's has Throw a stick), Hop sets the cow hopping, Talk makes it say something (none shown with Bubbles off), Haiku's talk reaches it, Esc shuts it; none after the Animals switch`);
    }

    // 5. the plants: Quaternius's trees, bushes and rocks drawn once their models load (the ball trees stand in till
    // then), the season's: snow on the pines in winter
    {
      const plantsAt = async stop => {
        await open(chrome, stop);
        let p = {};
        for (const end = Date.now() + 20_000; Date.now() < end && !Object.keys(p).length; await sleep(250)) p = JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.plants())'));
        return p;
      };
      const summer = await plantsAt('everyone'), winter = await plantsAt('limits-high'), total = o => Object.values(o).reduce((n, k) => n + k, 0);
      if (total(summer) < 100 || !summer.pine || summer.pinesnow || !winter.pinesnow || winter.pine) bad(`plants: ${JSON.stringify(summer)} by day in summer, ${JSON.stringify(winter)} in winter (100 or more, pines; snowy pines in winter)`);
      else console.log(`  ✓ plants: ${total(summer)} trees, bushes, rocks and things on the forest floor; snowy pines in winter`);
      // the wind in them: it blows (its clock runs), harder while a field rains (a failed deploy)
      const windAt = async stop => { await open(chrome, stop); const a = JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.wind?.() ?? null)')); await sleep(600); return [a, JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.wind?.() ?? null)'))]; };
      const [calm0, calm1] = await windAt('everyone'), [storm] = await windAt('deploy-failed');
      const ran = calm0 && calm1 ? (calm1.time - calm0.time + 20 * Math.PI) % (20 * Math.PI) : 0; // its clock wraps every 20π s (nature.js WIND_PERIOD)
      if (!calm0 || !(ran > 0.2) || !(storm?.strength > calm1.strength * 1.5)) bad(`wind: ${JSON.stringify([calm0, calm1])} on a calm day, ${JSON.stringify(storm)} while a field rains (its clock running; twice as strong in rain)`);
      else console.log(`  ✓ wind: the trees sway, ${storm.strength / calm1.strength}× harder while a field rains`);
    }

    // 6. the farmers as characters (build/character.js): once loaded, every farmer but a scarecrow is one, in its
    // agent's colour; one waiting on you waves
    {
      await open(chrome, 'everyone');
      const ids = JSON.parse(await chrome.inFrame('/world/farm3d/', 'JSON.stringify(window.__farm3d.farmerIds())'));
      let seen = [];
      for (const end = Date.now() + 20_000; Date.now() < end; await sleep(300)) {
        seen = JSON.parse(await chrome.inFrame('/world/farm3d/', `JSON.stringify(${JSON.stringify(ids)}.map(id => ({ id, ...(window.__farm3d.farmer(id) ?? {}) })))`));
        if (seen.length && seen.every(f => f.character)) break;
      }
      const stats = await statsOf(chrome), waving = seen.filter(f => f.clip === 'Wave');
      if (!seen.length || !seen.every(f => f.character && /^#[0-9a-f]{6}$/i.test(f.shirt ?? '')) || !waving.length) bad(`characters: ${JSON.stringify(seen)} (each a character in its colour, one waving)`);
      else console.log(`  ✓ characters: ${seen.length} farmers as ${[...new Set(seen.map(f => f.character))].join(', ')}, ${waving.length} waving; ${stats.calls} draw calls`);
    }

    // 7. memory: the busiest stop and an empty one, swapped 300 times; the geometry held comes back to the same
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
    const menu = await noGl.inFrame('/world/farm3d/', "Boolean(document.querySelector('.px-stats') && document.querySelector('[data-farm-nav=\"worlds\"]') && document.querySelector('[data-farm-nav=\"list\"]'))");
    if (state !== 'shown' || !s?.noWebGL || !/needs WebGL/.test(text ?? '') || !menu || strip || noGl.errors.length) bad(`without WebGL: ${JSON.stringify({ state, s, text: oneLine(text ?? '').slice(0, 120), menu, strip, errors: noGl.errors.length })}`);
    else console.log('  ✓ without WebGL: the plain panel, the farm\'s panel and Menu (World, List), started, no error');
  } finally { await noGl.close(); }
} finally {
  await srv.close();
}
console.log(failed ? `${failed} problem${failed === 1 ? '' : 's'}` : 'All good.');
process.exit(failed ? 1 : 0);
