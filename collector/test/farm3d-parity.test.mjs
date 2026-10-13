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
