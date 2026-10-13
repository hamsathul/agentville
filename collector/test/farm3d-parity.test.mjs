// The 3D farm at par with the other worlds (spec 2026-10-13-farm3d-parity): its panel and Menu, dialogs, diary,
// hens, carts, pigeons and play. Every rule copied from the 2D farm is pinned here against the farm's own
// (farm3d-vm.mjs runs the SDK and the farm in a vm); the 3D farm's own rules are tested as they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farm, g, engineOf, literalOf, plain, agent, repo, snap, NOW } from './farm3d-vm.mjs';
import { ICONS, ICON_PAL, seasonIcon, seasonTip } from '../../web/worlds/farm3d/icons.js';
import { FARM3D_WORDS, TIPS_3D, hudHtml, firstIn, firstNeed } from '../../web/worlds/farm3d/hud.js';

const FARM_WORDS = literalOf('worlds/farm/world.js', 'FARM_WORDS');

test("the 3D farm's icons and words are the 2D farm's (three tooltips its own)", () => {
  assert.deepEqual(ICONS, literalOf('worlds/farm/world.js', 'ICONS'));
  assert.deepEqual(ICON_PAL, literalOf('worlds/farm/world.js', 'ICON_PAL'));
  assert.deepEqual(FARM3D_WORDS, { ...FARM_WORDS, ...TIPS_3D });
  assert.deepEqual(Object.keys(TIPS_3D).sort(), ['animalsTip', 'bubblesTip', 'zoomTip']);
});

test("the panel and Menu are the 2D farm's for the same scene and switches (icons aside), the turn buttons before the Menu", () => {
  const windows = [{ kind: 'five_hour', percentUsed: 40, resetsAt: NOW + 3600e3 }, { kind: 'seven_day', percentUsed: 72, resetsAt: NOW + 86400e3 }];
  const s = { ...snap([agent('a1'), agent('a2', { state: 'waiting', stateReason: 'permission', ask: 'Run npm test?' })], [repo('shop')]), plan: { from: 'test', at: NOW, windows } };
  const e = engineOf(s), hooks = farm.makeFarm();
  hooks.setScene(e);
  const strip = h => h.replace(/<i class="px-ico"[^>]*><\/i>/g, '').replace(/<span class="f3-turn">[\s\S]*?<\/span>(?=\s*<button type="button" data-farm-menu)/, '');
  for (const seasonMode of ['live', 'autumn']) {
    const p = { still: false, zoom: 1.5, saysOn: true, skyMode: 'live', seasonMode, seasons: true, follow: false, canFollow: true, restingHidden: 2, bell: true, nav: { side: true, theme: 'dark' }, panelOpen: true, animals: true, menuOpen: true };
    const live = farm.seasonOf(e.plan);
    const mine = hudHtml(g('panelHud'), { ...p, scene: e, season: live, iconImg: () => '', seasonIcon, seasonTip: m => seasonTip(e.plan, live, m) }, FARM_WORDS);
    assert.equal(strip(mine), strip(hooks.hud(p)), seasonMode);
    assert.match(mine, /<div class="px-nav"><span class="f3-turn"><button type="button" data-f3-turn="-1"[\s\S]*<\/span>\s*<button type="button" data-farm-menu/);
  }
});

test('the count cards and "need you" open the first farmer in that state, or the first with a question', () => {
  const fs = [{ id: 'a', state: 'working' }, { id: 'b', state: 'turn', question: 'ok?' }, { id: 'c', state: 'waiting' }];
  assert.equal(firstIn(fs, 'turn'), 'b');
  assert.equal(firstIn(fs, 'idle'), null);
  assert.equal(firstNeed(fs), 'c');
  assert.equal(firstNeed(fs.filter(f => f.id !== 'c')), 'b');
  assert.equal(firstNeed([{ id: 'a', state: 'working' }]), null);
});

import { followStep } from '../../web/worlds/farm3d/camera.js';
test('Follow eases the view to its farmer, 3.5× a second; a still farm (dt 0) snaps; never past it', () => {
  const t = followStep({ x: 0, z: 0 }, { x: 10, z: -4 }, 0.1);
  assert.ok(Math.abs(t.x - 3.5) < 1e-9 && Math.abs(t.z + 1.4) < 1e-9);
  assert.deepEqual(followStep({ x: 0, z: 0 }, { x: 10, z: -4 }, 0), { x: 10, z: -4 });
  assert.deepEqual(followStep({ x: 0, z: 0 }, { x: 10, z: -4 }, 1), { x: 10, z: -4 });
});

import { clearRect, holdBox, fitDistance, FOV } from '../../web/worlds/farm3d/camera.js';
test('at 100% the farm fits beside the panel or below it, whichever shows it bigger; folded, the whole window', () => {
  const pts = [-1, 1].flatMap(sx => [-1, 1].map(sz => ({ x: sx * 36, y: 0, z: sz * 30 })));
  const fitFor = aspect => fitDistance(pts, { yaw: 0, pitch: (55 * Math.PI) / 180, fov: (FOV * Math.PI) / 180, aspect, target: { x: 0, y: 0, z: 0 } });
  assert.deepEqual(clearRect(1280, 820, null, fitFor), { x: 0, y: 0, w: 1280, h: 820 });
  assert.deepEqual(clearRect(1600, 700, { w: 330, h: 240 }, fitFor), { x: 330, y: 0, w: 1270, h: 700 }); // a wide window: beside
  assert.deepEqual(clearRect(700, 1200, { w: 330, h: 240 }, fitFor), { x: 0, y: 240, w: 700, h: 960 }); // a tall one: below
});
test("the panel's box only grows while it shows, so the farm doesn't jump as its figures change; folded, none", () => {
  assert.deepEqual(holdBox(null, { w: 300, h: 200 }), { w: 300, h: 200 });
  assert.deepEqual(holdBox({ w: 300, h: 200 }, { w: 290, h: 210 }), { w: 300, h: 210 });
  assert.equal(holdBox({ w: 300, h: 200 }, null), null);
});

import { dialogFor, buildingTip, boardSessions, boardHtml, stallOf, BOARD_TITLE } from '../../web/worlds/farm3d/dialogs.js';
const fx = { esc: g('esc'), ago: g('ago'), lastPart: g('lastPart') };
test("each building's dialog and tooltip is the 2D farm's for the same scene", () => {
  const pr = n => ({ number: n, title: `PR ${n}`, url: `https://github.com/x/y/pull/${n}`, checks: n % 2 ? 'ok' : 'failed', draft: n === 4 });
  const windows = [{ kind: 'five_hour', percentUsed: 40, resetsAt: NOW + 3600e3 }, { kind: 'seven_day', percentUsed: 72, resetsAt: NOW + 86400e3 }];
  const scenes = {
    busy: { ...snap([agent('a1', { state: 'waiting', stateReason: 'permission', ask: 'Run npm test?' }), agent('a2', { state: 'yourTurn', lastReply: 'Done.' }),
      agent('a3', { children: [{ id: 'c1', kind: 'subagent', state: 'running', label: 'Look around', agentType: 'Explore', startedAt: NOW - 5000 }] })],
    [repo('shop', { prs: { open: [pr(1), pr(2), pr(4)], merged: [{ number: 3, title: 'Old', url: 'https://github.com/x/y/pull/3', at: NOW - 60e3 }] } })]), plan: { from: 't', at: NOW, windows } },
    empty: snap([], [repo('blog')]),
  };
  for (const [name, s] of Object.entries(scenes)) {
    const e = engineOf(s), hooks = farm.makeFarm();
    hooks.setScene(e);
    for (const k of ['house', 'silo', 'henhouse', 'stall']) assert.deepEqual(dialogFor(k, e, fx), plain(hooks.dialog(k)), `${name} ${k}`);
    assert.deepEqual(boardSessions(e).map(f => f.id), plain(hooks.boardSessions()).map(f => f.id), name);
  }
  for (const k of ['barn', 'silo', 'board', 'house', 'stall', 'henhouse', 'nothing']) assert.equal(buildingTip(k), farm.makeFarm().buildingTip(k), k);
});
test("the notice board's dialog, as the engine's: each project's memory as buttons; nothing remembered; couldn't read it; no sessions", () => {
  const h = boardHtml([
    { f: { id: 'a1', cwd: '/u/shop' }, r: { ok: true, status: 200, data: { memory: [{ path: '/u/shop/CLAUDE.md', label: 'CLAUDE.md', where: 'project' }] } } },
    { f: { id: 'a2', cwd: '/u/blog' }, r: { ok: false, status: 404, error: 'gone' } },
    { f: { id: 'a3', cwd: '/u/x' }, r: { ok: false, status: 0, error: 'refused' } },
  ], fx);
  assert.equal(h, '<h4>shop</h4><ul class="px-dl"><li><button type="button" class="act" data-farm-mem="a1" data-path="/u/shop/CLAUDE.md">CLAUDE.md</button><span class="muted">project</span></li></ul>'
    + '<h4>blog</h4><p class="muted">Nothing remembered here yet.</p><h4>/u/x</h4><p class="muted">Could not read it.</p>');
  assert.equal(boardHtml([], fx), '<p class="muted">No sessions here.</p>');
  assert.equal(BOARD_TITLE, 'The notice board: what your projects remember');
});
test("the stall: a crate on its counter for each open pull request (8 at most), tagged as the 2D farm's; its label and tooltip", () => {
  const prs = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, title: `t${i + 1}`, checks: ['ok', 'failed', 'running', null][i % 4], draft: i === 9 }));
  const st = stallOf({ fields: [{ name: 'shop', prs: { open: prs, merged: [] } }] });
  assert.equal(st.crates.length, 8);
  assert.deepEqual(st.crates.slice(0, 4).map(c => c.tag), ['ok', 'failed', 'running', 'none']);
  assert.equal(stallOf({ fields: [{ name: 'x', prs: { open: [{ number: 1, title: 'd', draft: true, checks: 'ok' }] } }] }).crates[0].tag, 'draft');
  assert.equal(st.label, '10 PRs');
  assert.equal(st.tip, 'Open pull requests: #1 t1 · #2 t2 · #3 t3 · #4 t4 · #5 t5 · #6 t6 …. Click the stall for them all');
  assert.equal(stallOf({ fields: [{ name: 'x', prs: { open: [{ number: 7, title: '' }] } }] }).label, '1 PR');
  assert.deepEqual(stallOf({ fields: [] }), { crates: [], label: null, tip: null });
});

import { clickOrder } from '../../web/worlds/farm3d/hud.js';
test('a click finds a farmer first, then an animal, then a building, then a field', () => {
  assert.deepEqual(clickOrder([{ field: 'k' }, { building: 'barn' }, { animal: 2 }, { id: 'a' }]), { id: 'a' });
  assert.deepEqual(clickOrder([{ field: 'k' }, { building: 'barn' }, { animal: 0 }]), { animal: 0 });
  assert.deepEqual(clickOrder([{ field: 'k' }, { building: 'barn' }]), { building: 'barn' });
  assert.deepEqual(clickOrder([{ field: 'k' }]), { field: 'k' });
  assert.equal(clickOrder([]), null);
});

import { createDiary, zoneText } from '../../web/worlds/farm3d/diary.js';
import { makeModel } from '../../web/worlds/farm3d/model.js';
import { kit, toScene } from './farm3d-vm.mjs';
const M3 = makeModel(kit);
const ids = m => new Set(m.farmers.map(f => f.id));
test("a place's words in the diary are the 2D farm's, and so is the place (its zone)", () => {
  const s = snap([agent('a1'), agent('a2', { state: 'waiting', stateReason: 'permission', ask: 'Run it?' }), agent('a3', { state: 'yourTurn', lastReply: 'Done.' }),
    agent('a4', { state: 'stale', stateReason: 'stale' }), agent('a5', { state: 'idle', stateReason: 'idle', now: null }), agent('a6', { cwd: '/elsewhere', touching: [] })], [repo('shop')]);
  const e = engineOf(s), hooks = farm.makeFarm();
  hooks.setScene(e);
  hooks.relayout(hooks.grid.layoutFor(e.fields, {})); // the farm's beds, so its slots find the fields
  const m = M3.farmModel(toScene(s));
  assert.ok(m.farmers.length >= 5);
  for (const f of m.farmers) {
    const ef = e.farmers.find(x => x.id === f.id);
    assert.equal(f.zone, plain(hooks.slots(ef)).zone ?? hooks.slots(ef).zone, `${f.id} zone`);
    assert.equal(zoneText(ef, f.zone, e.fields.find(x => x.key === ef.field)?.name), hooks.zoneText(ef, f.zone), f.id);
  }
});
test('the diary: morning, arrivals and where they go, moves, harvests, newest first, eight at most; pops for the porch and the harvest', () => {
  const d = createDiary();
  const m1 = M3.farmModel(toScene(snap([agent('a1'), agent('a2')], [repo('shop')])));
  const r1 = d.update(m1, ids(m1), NOW);
  assert.deepEqual(r1.entries.map(x => x.text), ['Morning: 2 farmers on the farm']);
  assert.deepEqual(r1.pops, []);
  const m2 = M3.farmModel(toScene(snap([agent('a1', { state: 'waiting', stateReason: 'permission', ask: { kind: 'permission', tool: 'Bash', summary: 'npm test' } }), agent('a2', { compactions: 1 }), agent('a3')], [repo('shop')])));
  const r2 = d.update(m2, ids(m2), NOW + 1000);
  assert.deepEqual(r2.entries.slice(0, 4).map(x => `${x.who} ${x.text}`).sort(), [
    'a1 comes up to your porch: needs a permission', 'a2 brings in the harvest: its conversation was compacted, and it sows again', 'a3 hoeing the rows in the shop field', 'a3 walks out of the barn',
  ]);
  assert.equal(r2.entries.at(-1).text, 'Morning: 2 farmers on the farm');
  assert.deepEqual(r2.pops.map(p => `${p.id}:${p.text}`).sort(), ['a1:Needs you!', 'a2:Harvest!']);
  assert.equal(d.update(m2, ids(m2), NOW + 2000).entries, null); // nothing new
  for (let i = 0; i < 12; i++) { const mi = M3.farmModel(toScene(snap([agent('a1', { now: { tool: i % 2 ? 'Edit' : 'Read', summary: 'x', step: i % 2 ? 'edit' : 'read', startedAt: NOW } })], [repo('shop')]))); d.update(mi, ids(mi), NOW + 3000 + i); }
  assert.equal(d.update(m2, ids(m2), NOW + 9e3).entries.length, 8);
});
test('a note between two farmers is told once, its first 60 characters; a merged pull request once, under the market', () => {
  const d = createDiary(), feed = text => [{ at: NOW - 5000, kind: 'peer', dir: 'out', other: 'a2', text }];
  const m0 = M3.farmModel(toScene(snap([agent('a1'), agent('a2')], [repo('shop')])));
  d.update(m0, ids(m0), NOW);
  const m1 = M3.farmModel(toScene(snap([agent('a1', { feed: feed('x'.repeat(80)) }), agent('a2')], [repo('shop')])));
  const r = d.update(m1, ids(m1), NOW + 1000);
  assert.ok(r.entries[0].text.startsWith('sends a note to a2: '), r.entries[0].text);
  assert.ok(r.entries[0].text.endsWith('…') && r.entries[0].text.length === 'sends a note to a2: '.length + 60, r.entries[0].text);
  assert.equal(d.update(m1, ids(m1), NOW + 2000).entries, null);
  const pr = { open: [], merged: [{ number: 9, title: 'Hens', at: NOW + 2500 }] };
  const m2 = M3.farmModel(toScene(snap([agent('a1'), agent('a2')], [repo('shop', { prs: pr })])));
  const r2 = d.update(m2, ids(m2), NOW + 3000);
  assert.deepEqual([r2.entries[0].who, r2.entries[0].text], ['The market', 'shop: pull request #9 merged (Hens)']);
  assert.deepEqual(r2.pops, [{ at: 'stall', text: 'Sold! #9', cls: 'good' }]);
});

import { kidSpot, henhouseView } from '../../web/worlds/farm3d/flock.js';
test("hens keep to their farmer's sides, two a step behind; the Explore dog circles it, 30 px out", () => {
  const h = k => kidSpot([100, 100], k, 0, false);
  assert.ok(h(0)[0] < 100 && h(1)[0] > 100 && h(2)[0] < 100 && h(3)[0] > 100);
  assert.ok(h(2)[1] < h(0)[1] && h(3)[1] < h(1)[1]);
  const d = [0, 1, 2, 3].map(t => kidSpot([100, 100], 0, t, true));
  for (const [x] of d) assert.ok(Math.abs(x - 100) <= 30.0001);
  assert.ok(new Set(d.map(p => p[0].toFixed(2))).size > 1); // it moves
});
test("the henhouse: six eggs and three roosting hens at most; its labels as the 2D farm's", () => {
  const v = henhouseView({ eggs: 9, roosting: 5 });
  assert.equal(v.eggs, 6); assert.equal(v.roosting, 3);
  assert.deepEqual(v.plus, { text: '+5', tip: '5 more subagents running than the farmers can lead' });
  assert.deepEqual(henhouseView({ eggs: 1, roosting: 1 }).eggsLabel, { text: '1 egg', tip: 'Eggs: subagents that finished lately' });
  assert.equal(henhouseView({ eggs: 1, roosting: 1 }).plus.tip, '1 more subagent running than the farmers can lead');
  assert.deepEqual(henhouseView({ eggs: 0, roosting: 0 }), { eggs: 0, roosting: 0, plus: null, eggsLabel: null });
  assert.deepEqual(henhouseView(undefined), { eggs: 0, roosting: 0, plus: null, eggsLabel: null });
});

import { cartRoute, cartGoal, createCarts, cartOf, CART_STAY_MS } from '../../web/worlds/farm3d/carts.js';
import { CART_RANK } from '../../web/worlds/farm3d/layout.js';
test("a cart's way and when it heads home are the 2D farm's rules", () => {
  for (const [a, b] of [[[388, 87], [120, 200]], [[300, 200], [388, 87]], [[200, 87], [250, 87]], [[100, 40], [306, 150]], [[50, 150], [60, 150]]]) assert.deepEqual(cartRoute(a, b, { lane: 87, corr: [116, 218, 306] }), plain(farm.cartRoute(a, b)), JSON.stringify([a, b]));
  const c1 = {}, c2 = {};
  for (const [busy, now] of [[[10, 10], 0], [[10, 10], 500], [null, 1000], [null, 2500], [null, 6000], [[20, 20], 7000]]) assert.deepEqual(cartGoal(c1, busy, [0, 0], now), plain(farm.cartGoal(c2, busy, [0, 0], now)), String(now));
  assert.equal(CART_STAY_MS, 3000);
});
test('carts: a new server takes the first free place in the row; a busy one drives beside its farmer and stays; motion off puts it there', () => {
  const carts = createCarts(), pos = () => ({ x: 300, y: 200 });
  let out = carts.tick([{ server: 'a', busy: null }, { server: 'b', busy: null }], 0.1, pos, false, 0);
  assert.deepEqual(out.map(c => [c.server, c.x, c.y, c.away]), [['a', ...CART_RANK[0], false], ['b', ...CART_RANK[1], false]]);
  out = carts.tick([{ server: 'b', busy: 'f1' }], 0.1, pos, true, 1000); // a left: b keeps its place; it is busy, still: there at once
  assert.deepEqual([out[0].x, out[0].y, out[0].away], [313, 200, true]);
  out = carts.tick([{ server: 'c', busy: null }, { server: 'b', busy: 'f1' }], 0.1, pos, true, 1100);
  assert.deepEqual(out.find(c => c.server === 'c') && [out.find(c => c.server === 'c').x, out.find(c => c.server === 'c').y], CART_RANK[0]); // the first free place
  out = carts.tick([{ server: 'b', busy: 'f1' }], 0.5, () => null, false, 1200); // its farmer not drawn: it goes home
  assert.equal(out[0].away, true); // on its way
  const moving = createCarts();
  moving.tick([{ server: 'x', busy: null }], 0.1, pos, false, 0);
  const o2 = moving.tick([{ server: 'x', busy: 'f1' }], 0.5, pos, false, 100);
  assert.ok(o2[0].moving && o2[0].x < CART_RANK[0][0]); // driving off, at 55 px a second
});
test("a web call's cart goes out to town and back every 8 s; only for a web step that isn't an MCP tool", () => {
  const f = { id: 'a', state: 'working', service: 'example.com', step: 'web', tool: 'WebFetch' };
  assert.ok(cartOf(f, 0));
  assert.equal(cartOf({ ...f, tool: 'mcp__x__y' }, 0), null);
  assert.equal(cartOf({ ...f, state: 'idle' }, 0), null);
  assert.equal(cartOf({ ...f, service: null }, 0), null);
  assert.notEqual(cartOf(f, 1).x, cartOf(f, 3).x);
  assert.equal(cartOf(f, 1).x, cartOf(f, 9).x); // every 8 s
});

import { flightAt } from '../../web/worlds/farm3d/build/pigeons.js';
test('a pigeon flies from head to head on an arc about 4 m high, easing in and out', () => {
  const a = { x: 0, y: 2, z: 0 }, b = { x: 10, y: 2, z: 0 };
  assert.deepEqual(flightAt(0, a, b), a);
  assert.deepEqual(flightAt(1, a, b), b);
  const mid = flightAt(0.5, a, b);
  assert.ok(Math.abs(mid.y - 6) < 1e-9 && Math.abs(mid.x - 5) < 1e-9);
  assert.ok(flightAt(0.1, a, b).x < 1); // slow to start
});
test('a note flies only between two farmers both drawn; its diary line is told all the same', () => {
  const d = createDiary(), feed = [{ at: NOW - 5000, kind: 'peer', dir: 'out', other: 'a2', text: 'hi' }];
  const m0 = M3.farmModel(toScene(snap([agent('a1'), agent('a2')], [repo('shop')])));
  d.update(m0, ids(m0), NOW);
  const m1 = M3.farmModel(toScene(snap([agent('a1', { feed }), agent('a2')], [repo('shop')])));
  const r = d.update(m1, new Set(['a1']), NOW + 1); // a2 hidden
  assert.deepEqual(r.flights, []);
  assert.match(r.entries[0].text, /^sends a note to a2: hi$/);
  const d2 = createDiary();
  d2.update(m0, ids(m0), NOW);
  assert.deepEqual(d2.update(m1, ids(m1), NOW + 1).flights, [{ from: 'a1', to: 'a2' }]);
});

import { PLAYS, SENDS, castPlay, chooseDoer, PLAY_SCRIPTS, scriptFor, createPlays } from '../../web/worlds/farm3d/play.js';
const seq = (...v) => { let k = 0; return () => v[k++ % v.length]; };
test('a play needs a farmer idle 3 minutes or more (not napping, not busy) and a free animal of its kind', () => {
  const farmers = [{ id: 'a', x: 0, y: 0, state: 'idle' }, { id: 'b', x: 50, y: 0, state: 'idle' }, { id: 'c', x: 5, y: 0, state: 'working' }];
  const animals = [{ i: 0, kind: 'husky', x: 10, y: 0, free: true }, { i: 1, kind: 'cow', x: 60, y: 0, free: false }];
  const idleSince = new Map([['a', 0], ['b', 0]]);
  assert.equal(castPlay(PLAYS, { farmers, animals, idleSince, now: 100e3, busy: new Set(), rand: seq(0) }), null); // idle under 3 minutes
  const p = castPlay(PLAYS, { farmers, animals, idleSince, now: 200e3, busy: new Set(), rand: seq(0) });
  assert.deepEqual([p.play.id, p.farmer, p.animal], ['fetch', 'a', 0]);
  assert.equal(castPlay(PLAYS, { farmers, animals, idleSince, now: 200e3, busy: new Set(['a', 'b']), rand: seq(0) }), null);
  assert.equal(castPlay(PLAYS, { farmers, animals, idleSince, now: 200e3, busy: new Set([0]), rand: seq(0) }), null); // the dog is busy, the cow isn't free
  assert.equal(castPlay(PLAYS, { farmers: farmers.map(f => ({ ...f, nap: true })), animals, idleSince, now: 200e3, busy: new Set(), rand: seq(0) }), null);
  assert.equal(castPlay(PLAYS, { farmers: farmers.map(f => ({ ...f, errand: true })), animals, idleSince, now: 200e3, busy: new Set(), rand: seq(0) }), null);
  assert.deepEqual(Object.keys(SENDS).sort(), ['feed', 'fetch', 'pet']);
});
test("who goes for Pet, Feed or Throw a stick: the nearest free farmer, idle first; a busy one only for a short trip; none waiting on you", () => {
  const fs = [{ id: 'w', x: 1, y: 0, state: 'working' }, { id: 'i', x: 100, y: 0, state: 'idle' }, { id: 'q', x: 0, y: 0, state: 'waiting' }, { id: 't', x: 0, y: 1, state: 'turn' }, { id: 'e', x: 2, y: 0, state: 'idle', errand: true }];
  assert.deepEqual(chooseDoer(fs, [0, 0], d => d / 40), { doer: 'i', others: ['w'] });
  assert.deepEqual(chooseDoer(fs.filter(f => f.id !== 'i'), [0, 0], d => d / 40), { doer: 'w', others: [] });
  assert.deepEqual(chooseDoer([{ id: 'w', x: 400, y: 0, state: 'working' }], [0, 0], d => d / 40), { doer: null, others: [] });
});
test("the farmers' play conversations: three or more scripts each, 4-6 lines in turn with a start and an end, never the same twice running", () => {
  for (const [id, list] of Object.entries(PLAY_SCRIPTS)) {
    assert.ok(list.length >= 3, id);
    for (const s of list) {
      assert.ok(s.length >= 4 && s.length <= 6, id);
      s.forEach((l, k) => { assert.ok(l.text.length <= 60, l.text); if (k) assert.notEqual(l.by, s[k - 1].by, id); });
      for (const b of ['start', 'end']) assert.ok(s.some(l => l.beat === b), `${id} ${b}`);
    }
  }
  let last = -1;
  for (let k = 0; k < 20; k++) { const r = scriptFor('pet', seq([0.1, 0.5, 0.9][k % 3]), last); assert.notEqual(r.idx, last); last = r.idx; }
});
test('a play from start to end: the farmer goes over, they talk at each beat, the animal does its part, both are free after', () => {
  const plays = createPlays({ rand: seq(0) }), log = [];
  let arrived = false, onErrand = false, act = null;
  const ctx = {
    now: 0, still: false, animalsOn: true, busy: new Set(), idleSince: new Map(), farmers: [{ id: 'f', name: 'Ada', x: 0, y: 0, state: 'idle' }], animals: [{ i: 3, kind: 'husky', x: 40, y: 0, free: true }],
    animal: i => (i === 3 ? { x: 40, y: 0, act } : null), errand: (id, to) => { onErrand = true; log.push(`errand ${id} ${to.map(Math.round)}`); }, endErrand: id => { onErrand = false; log.push(`home ${id}`); },
    onErrand: () => onErrand, arrived: () => arrived, setPose() {}, perform: (i, steps, tag) => { act = tag; log.push(`wait ${i}`); }, release: i => { act = null; log.push(`free ${i}`); },
    command: (i, a) => { act = a; log.push(`${a} ${i}`); }, face() {}, pop: (i, t) => log.push(`pop ${t}`),
  };
  plays.send(3, 'fetch', 'f', ctx);
  assert.deepEqual([...plays.busy()].sort(), [3, 'f'].sort());
  assert.match(log[0], /^errand f 3\d,0$/); // beside the dog, on the farmer's side
  const said = new Set();
  const step = s => { for (let k = 0; k < s * 10; k++) { plays.tick(0.1, ctx); for (const b of plays.bubbles()) said.add(`${b.who === 'f' ? 'F' : 'A'}:${b.text}`); } };
  step(2);
  arrived = true;
  step(0.2);
  assert.equal(plays.bubbles()[0]?.text, 'Go on, get it!', "there: the middle's first line at once, not what was left of the start's");
  step(0.8);
  assert.ok(log.includes('fetch 3'));
  act = null; // the dog is back at once: the farmer still stays for the middle's lines
  step(3);
  assert.ok(!log.includes('home f'), 'it stays while they talk');
  act = null; // the dog brought the stick back
  step(25);
  assert.ok(log.includes('home f'));
  assert.equal(plays.busy().size, 0);
  assert.ok(said.size >= 4, [...said].join(' | '));
  assert.ok([...said].some(t => t.startsWith('F:')) && [...said].some(t => t.startsWith('A:')));
  assert.ok(![...said].some(t => /\{/.test(t)), 'blanks filled');
});

import { perform, release, makeAnimal, advance } from '../../web/worlds/farm3d/antics.js';
test("an animal in a play does its steps, then waits where it is (its act the play's) till it is let go", () => {
  const env = { resting: false, rand: seq(0.5), habitChance: 0, duration: () => 1, spot: () => [0, 0], inside: () => true, clear: () => true };
  const a = makeAnimal({ kind: 'cow', family: 'hooves', area: 'pasture', walk: 7, run: 40 }, 100, 100, seq(0.5));
  perform(a, [{ part: 'look' }], env, 'play');
  assert.equal(a.act, 'play');
  for (let k = 0; k < 50; k++) advance(a, 0.1, env);
  assert.deepEqual([a.act, a.part, a.x, a.y], ['play', 'idle', 100, 100]); // waiting, not wandering off
  release(a);
  assert.equal(a.act, null);
  assert.equal(a.romp, null);
});

import { ROMPS, partnerFor, createRomps, ROMP_SCRIPTS } from '../../web/worlds/farm3d/romps.js';
import { menuFor } from '../../web/worlds/farm3d/antics.js';
const W = list => list.map((a, i) => ({ i, family: 'paws', free: true, resting: false, area: 'yard', run: 40, ...a, a: { x: a.x, y: a.y } }));
const rompCtx = over => ({ perform() {}, release() {}, settled: () => true, say() {}, fx() {}, spot: (area, from, far) => [from[0] + far, from[1]], clear: () => true, still: false, animalsOn: true, ...over });
test('which pairs romp: dogs tag and wrestle, horses race, two of a family greet; Play never starts a fight; 25 m at most', () => {
  const w = W([{ kind: 'husky', x: 0, y: 0 }, { kind: 'shiba', x: 30, y: 0 }, { kind: 'bull', family: 'hooves', x: 400, y: 400 }, { kind: 'cow', family: 'hooves', x: 420, y: 400 }]);
  assert.equal(partnerFor(0, w, { playOnly: true }), 1);
  assert.equal(partnerFor(2, w, { playOnly: true }), 3); // the bull and the cow may only greet from the menu (a duel is a fight)
  assert.deepEqual(ROMPS.filter(r => !r.play).map(r => r.id).sort(), ['chaseoff', 'duel', 'squabble']);
  assert.deepEqual(ROMPS.filter(r => r.play).map(r => r.id).sort(), ['greet', 'race', 'tag', 'wrestle']);
  assert.equal(partnerFor(0, W([{ kind: 'husky', x: 0, y: 0 }, { kind: 'shiba', x: 300, y: 0 }]), { playOnly: true }), null); // over 25 m
  assert.equal(partnerFor(0, W([{ kind: 'husky', x: 0, y: 0 }, { kind: 'shiba', x: 30, y: 0, free: false }]), { playOnly: true }), null);
  assert.equal(partnerFor(0, W([{ kind: 'husky', x: 0, y: 0 }, { kind: 'fox', x: 30, y: 0 }]), { playOnly: true }), null); // only a chase-off: a fight
});
test('one romp at a time, every 60 to 120 s; none with Motion or the animals off; a squabble when a horse crowds the donkey', () => {
  const w = W([{ kind: 'husky', x: 0, y: 0 }, { kind: 'shiba', x: 30, y: 0 }]);
  const r = createRomps({ rand: () => 0.5 });
  assert.equal(r.tick(w, 30, rompCtx()).starts.length, 0);
  assert.equal(r.tick(w, 100, rompCtx()).starts.length, 1);
  assert.equal(r.tick(w, 200, rompCtx()).starts.length, 0); // one is running
  r.releaseAll(rompCtx());
  const off = createRomps({ rand: () => 0.5 });
  assert.equal(off.tick(w, 200, rompCtx({ still: true })).starts.length, 0);
  assert.equal(off.tick(w, 200, rompCtx({ animalsOn: false })).starts.length, 0);
  const sq = createRomps({ rand: () => 0.5 });
  assert.deepEqual(sq.tick(W([{ kind: 'donkey', family: 'hooves', x: 0, y: 0 }, { kind: 'horse', family: 'hooves', x: 20, y: 0 }]), 1, rompCtx()).starts.map(x => x.romp), ['squabble']);
  const far = createRomps({ rand: () => 0.5 });
  assert.equal(far.tick(W([{ kind: 'donkey', family: 'hooves', x: 0, y: 0 }, { kind: 'horse', family: 'hooves', x: 60, y: 0 }]), 1, rompCtx()).starts.length, 0);
});
test('a romp plays its beats in turn when both are settled, says its lines tied to them, and frees both at the end', () => {
  const r = createRomps({ rand: () => 0 }), said = [], done = [], did = [];
  const ctx = rompCtx({ perform: (i, steps) => did.push([i, steps.map(s => s.part ?? Object.keys(s)[0])]), release: i => done.push(i), say: (i, text) => said.push([i, text]) });
  const w = W([{ kind: 'husky', x: 0, y: 0 }, { kind: 'shiba', x: 30, y: 0 }]);
  assert.ok(r.start('tag', 0, 1, w, ctx));
  assert.deepEqual([...r.busy()].sort(), [0, 1]);
  for (let k = 0; k < 60; k++) r.tick(w, 0.5, ctx);
  assert.deepEqual(done.sort(), [0, 1]);
  assert.ok(said.length >= 4, JSON.stringify(said));
  assert.ok(said.some(([i]) => i === 0) && said.some(([i]) => i === 1));
  assert.ok(did.some(([, parts]) => parts.includes('run')), 'they ran');
  assert.equal(r.running().length, 0);
  assert.equal(r.busy().size, 0);
});
test("every romp has three scripts or more, 4-6 lines in turn with a start and an end, its blanks filled; the menus gain Play (the frog's doesn't)", () => {
  for (const romp of ROMPS) {
    const list = ROMP_SCRIPTS[romp.id];
    assert.ok(list.length >= 3, romp.id);
    for (const s of list) {
      assert.ok(s.length >= 4 && s.length <= 6, romp.id);
      s.forEach((l, k) => { assert.ok(l.text.length <= 48, l.text); if (k) assert.notEqual(l.by, s[k - 1].by, romp.id); });
      for (const b of ['start', 'end']) assert.ok(s.some(l => l.beat === b), `${romp.id} ${b}`);
    }
  }
  assert.ok(menuFor('cow', 'hooves').includes('play'));
  assert.ok(menuFor('koi', 'fish').includes('play'));
  assert.ok(!menuFor('frog', 'frog').includes('play'));
});

test('romp steps: face turns at once, chase catches a moving one, flee runs away from it, meet stops a gap short; a romp keeps its home', () => {
  const env = { resting: false, rand: seq(0.5), habitChance: 0, duration: () => 1, spot: () => [0, 0], inside: () => true, clear: () => true };
  const mk = (x, y) => makeAnimal({ kind: 'husky', family: 'paws', area: 'yard', walk: 12, run: 44 }, x, y, seq(0.5));
  const a = mk(0, 0), b = mk(60, 0);
  perform(a, [{ face: b }], env, 'romp');
  advance(a, 0.01, env);
  assert.ok(Math.abs(a.face - Math.atan2(60, 0)) < 1e-9, 'facing b');
  perform(b, [{ part: 'walk', to: [200, 0] }], env, 'romp');
  perform(a, [{ part: 'run', chase: b, within: 8, secs: 10 }], env, 'romp');
  let k = 0;
  for (; k < 100 && (a.cur || a.queue.length); k++) { advance(b, 0.1, env); advance(a, 0.1, env); }
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= 9, `caught: ${a.x.toFixed(1)} vs ${b.x.toFixed(1)}`);
  const c = mk(100, 100), d = mk(110, 100);
  perform(c, [{ part: 'run', flee: d, far: 50 }], env, 'romp');
  for (let n = 0; n < 60; n++) advance(c, 0.1, env);
  assert.ok(Math.hypot(c.x - d.x, c.y - d.y) >= 49, `fled: ${Math.hypot(c.x - d.x, c.y - d.y).toFixed(1)}`);
  const e = mk(0, 0), f = mk(100, 0);
  perform(e, [{ part: 'walk', meet: f, gap: 16 }], env, 'romp');
  for (let n = 0; n < 200; n++) advance(e, 0.1, env);
  assert.ok(Math.abs(Math.hypot(e.x - f.x, e.y - f.y) - 16) < 1.5, `met: ${Math.hypot(e.x - f.x, e.y - f.y).toFixed(1)}`);
  const h = mk(10, 10);
  perform(h, [{ part: 'walk', to: [50, 10] }], env, 'romp');
  for (let n = 0; n < 60; n++) advance(h, 0.1, env);
  perform(h, [{ part: 'walk', to: 'home' }], env, 'romp'); // the next beat: home is where the romp began
  for (let n = 0; n < 80; n++) advance(h, 0.1, env);
  assert.ok(Math.hypot(h.x - 10, h.y - 10) < 2, `home: ${h.x.toFixed(1)},${h.y.toFixed(1)}`);
});
