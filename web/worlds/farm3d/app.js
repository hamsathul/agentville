// The 3D farm: the renderer and the frame loop, the model, the builders, the camera and the overlay put together.
// world.js imports this once the world has registered; start() returns what the bridge calls with each scene and
// selection.
import * as THREE from './vendor/three.module.js';
import { makeModel } from './model.js';
import { clearRect, holdBox, makeCameraRig } from './camera.js';
import { makeOverlay } from './overlay.js';
import { clickOrder, makeHud } from './hud.js';
import { makeIconImg } from './icons.js';
import { BOARD_TITLE, boardHtml, boardSessions, buildingTip, dialogFor } from './dialogs.js';
import { createDiary, until } from './diary.js';
import { makeMinimap, toMap } from './minimap.js';
import { makeMaterials } from './build/materials.js';
import { makeSky, skyFor } from './build/sky.js';
import { makeTerrain } from './build/terrain.js';
import { makeShapes } from './build/shapes.js';
import { makeBuildings } from './build/buildings.js';
import { makeCrops } from './build/crops.js';
import { makeModels } from './build/models.js';
import { createSeasons } from './season.js';
import { createMachines, crewActions, inPathOf, isAhead, machinesDialog } from './machines.js';
import { makeMachines } from './build/machines.js';
import { makeShed } from './build/shed.js';
import { makeFence } from './build/fence.js';
import { fenceOf } from './fence.js';
import { makeLife } from './build/life.js';
import { SCARE_PX, beesFor, createCrows } from './life.js';
import { cloudsFor, dimFor, headlightsOn, smokeFarms } from './mood.js';
import { createSnowballs, leafPilesOf } from './seasonplay.js';
import { makeSound, mixOf, shouldPlay } from './sound.js';
import { makeWeather } from './build/weather.js';
import { makeBeds } from './build/beds.js';
import { makeFigures } from './build/figurine.js';
import { makeFarmers } from './build/farmers.js';
import { makeAnimals } from './build/animals.js';
import { makeNature } from './build/nature.js';
import { makeFlock } from './build/flock.js';
import { henhouseView } from './flock.js';
import { makeCarts } from './build/carts.js';
import { cartOf, createCarts } from './carts.js';
import { makePigeons } from './build/pigeons.js';
import { createTalk } from './talk.js';
import { createVisits } from './visits.js';
import { createTour } from './tour.js';
import { HERDS } from './antics.js';
import { roamOf } from './roam.js';
import { guarded } from './guard.js';
import { SENDS, chooseDoer, createPlays } from './play.js';
import { createRomps, partnerFor } from './romps.js';

// what a farmer is doing, as a word, from the tool in its hands (for what it says to the animals)
const STEP_WORDS = { hoe: 'editing', rake: 'editing', sickle: 'editing', hammer: 'fixing', seeds: 'writing', almanac: 'reading', recipe: 'reading', clipboard: 'planning', blueprint: 'planning', spyglass: 'searching', magnifier: 'searching', pigeon: 'browsing', parcel: 'calling tools', mailbag: 'calling tools', crate: 'committing', cart: 'pushing', barrow: 'pushing', lantern: 'thinking', whistle: 'delegating', can: 'working' };
import { BED, HOUSE, NEIGHBOUR_X, PORCH_Y, PX, SHED_DOOR, SILO_Y, STALL, W, crossingsOf, east, farmAt } from './layout.js';

const SKIES = ['live', 'day', 'night'], SEASON_MODES = ['live', 'spring', 'summer', 'autumn', 'winter'];
const FRAME_MS = 1000 / 30; // at most 30 frames a second
const NEAR_ZOOM = 2; // from here in, every farmer's name and bubble shows
const STYLE = `
  #farm.f3 { position: relative; overflow: hidden; background: #cfe6f5; }
  #farm.f3 .f3-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
  #farm.f3 .f3-nogl { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; background: #1c3320; color: #fff3d6; font: 600 15px/1.45 system-ui, sans-serif; }
  #farm.f3 .f3-nogl small { max-width: 520px; font-weight: 400; color: #c9b48a; }
`;
/** Each error once (by its words and where), to the page through the bridge; the farm carries on. */
const told = new Set();
function report(err, where) {
  const message = String(err?.message ?? err).slice(0, 300), key = `${message}@${where}`;
  if (told.has(key) || told.size >= 20) return;
  told.add(key);
  window.Agentville?.send?.({ type: 'error', message, where });
}
/** A renderer, or why there is none (the browser has WebGL switched off, or none at all). */
function makeRenderer(THREE) {
  if (window.__farm3dForceNoWebGL === true) return { error: 'WebGL is switched off for this test.' };
  try {
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) return { error: 'This browser gives this page no WebGL context (hardware acceleration may be off).' };
    return { renderer: new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }) };
  } catch (err) { return { error: String(err?.message ?? err) }; }
}

export function start({ el, opts, prefs }) {
  el.innerHTML = '';
  el.classList.add('f3');
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  // The frame's own helpers (pixel.js, engine.js, people.js), handed to the model.
  const kit = { makeGrid, engineScene, tagText, cutMid, lastPart, ago, lookFor: window.Agentville.people.lookFor, pick: window.Agentville.people.pick };
  const M = makeModel(kit);

  const made = makeRenderer(THREE);
  const iconImg = makeIconImg(makeSprite); // the farm's pixel icons, drawn with pixel.js
  if (!made.renderer) { // no WebGL: say so plainly, and start all the same: the panel and the Menu (List, World…) still work
    el.innerHTML = `<div class="f3-nogl" role="status">The 3D farm needs WebGL, which this browser has switched off or doesn't have.<small>${made.error.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])} Choose another world with World in the Menu; the farm draws without it.</small></div>`;
    const plainHud = makeHud(el, { opts, prefs, iconImg, hooks: { turn() {}, reset() {}, zoom() {}, cycle() {}, pick: id => opts.onPickAgent(id), setFollow() {}, setResting() {}, help() {}, refresh() {} } });
    const draw = e => plainHud.render({ zoom: 1, skyMode: 'live', seasonMode: 'live', still: opts.still, animals: null, bubbles: true, follow: false, canFollow: false, restingHidden: null, scene: e, season: 'summer' });
    let last = { farmers: [] };
    draw(last);
    setInterval(() => draw(last), 1000); // the page's buttons' state (the sidebar, the theme) can change from outside
    window.__farm3d = { stats: () => ({ noWebGL: true }) };
    return { scene(s) { try { last = engineScene(s); draw(last); } catch (err) { report(err, 'scene'); } }, select() {} };
  }
  const { renderer } = made;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.className = 'f3-canvas';
  canvas.setAttribute('aria-label', 'The 3D farm: every farmer is an agent, every field a repo');
  el.append(canvas);
  const scene3 = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  const mats = makeMaterials(THREE), sky = makeSky(THREE, scene3, mats), terrain = makeTerrain(THREE, mats);
  const shapes = makeShapes(THREE, mats), buildings = makeBuildings(THREE, mats, shapes);
  const models = makeModels(THREE), crops = makeCrops(THREE, mats, { load: kind => models.parts(kind), onLoad: (kind, err) => { if (err) report(err, `crops (${kind})`); dirty = true; } }), beds = makeBeds(THREE, mats, shapes, makeWeather(THREE, mats, shapes), crops);
  let farmRoam = null, farmRoamKey = ''; // the walkable farm (roam.js), for a farmer's errand to an animal and the animals' ways
  const farmers = makeFarmers(THREE, makeFigures(THREE, mats, shapes), shapes, { route: (a, b) => farmRoam?.route(a, b, 4) ?? null }), animals = makeAnimals(THREE, mats, shapes, { onFx: (kind, x, y) => { if (kind === 'leaves') life.leaves(x, y); } }), weather = makeWeather(THREE, mats, shapes);
  const nature = makeNature(THREE, shapes), talk = createTalk(), visits = createVisits(); // visits: between the farms, with a neighbour's
  animals.setPeople(() => (shownModel()?.farmers ?? []).map(f => farmers.posOf(f.id)).filter(Boolean).map(p => [p.x, p.y, 6])); // the places they pick keep clear of the farmers
  const flock = makeFlock(THREE, mats, shapes, { copy: animals.copy }); // subagents: hens, the Explore dog, the henhouse's eggs
  const cartMeshes = makeCarts(THREE, mats, shapes, { copy: animals.copy }), carts = createCarts(); // the MCP servers' carts, the web calls' carts to town
  let cartItems = [];
  const pigeons = makePigeons(THREE, mats); // notes between agents
  // the machines (machines.js): a farmer whose step needs one walks to the shed, boards it, drives out and back
  const machineMeshes = makeMachines(THREE, mats, shapes, { gltf: kind => models.gltf(kind), onError: (err, kind) => report(err, `machines (${kind})`) }), shed = makeShed(THREE, mats, shapes, machineMeshes), machines = createMachines();
  const boarded = new Set(), sentToShed = new Set(), compactionsSeen = new Map(); // in a seat; walking to the shed; each agent's compactions so far
  let machineItems = [], machinesSig = '', busySig = '';
  /** Who is where and what is happening, for talk.js: refreshed twice a second. */
  let talkScene = null, talkSceneAt = -1e9, castSaid = null;
  function sceneForTalk(now) {
    if (talkScene && now - talkSceneAt < 500) return talkScene;
    const list = [];
    for (let i = 0; i < animals.count(); i++) { const a = animals.info(i); if (a?.shown && a.act !== 'play' && a.act !== 'romp') list.push({ i, kind: a.kind, x: a.spot[0], y: a.spot[1] }); } // one at play is busy
    const beds = model?.beds ?? [], season = shownSeason();
    const repoName = key => beds.find(b => b.key === key)?.name ?? null; // a field's name, never its path
    const guest = visits.now()?.guest; // a farmer on a visit talks there
    const people = (shownModel()?.farmers ?? []).filter(f => !f.scarecrow && (!farmers.onErrand(f.id) || f.id === guest)).map(f => ({ id: f.id, name: f.name, state: f.state, x: f.at[0], y: f.at[1], step: STEP_WORDS[f.prop] ?? null, repo: repoName(f.field) }));
    const events = beds.filter(b => b.weather === 'rain' || b.weather === 'rainbow').map(b => ({ kind: b.weather === 'rain' ? 'deployFailed' : 'deployOk', repo: b.name }));
    talkScene = { animals: list, farmers: people, facts: { night: night > 0.5, weather: season === 'winter' ? 'snow' : beds.some(b => b.weather === 'rain') ? 'rain' : null, events } };
    talkSceneAt = now;
    return talkScene;
  }
  const fence = makeFence(THREE, mats, shapes); // agents' task lists, along their fields
  const life = makeLife(THREE, mats, shapes), crows = createCrows(); // fireflies, bees, crows (life.js)
  const snowballs = createSnowballs(); // winter's snowball fights (seasonplay.js)
  let leafPiles = [], fightIds = new Set(), thrown = new Set(), landed = new Set(), balls = []; // autumn's piles; the fight under way: who, which throws are off and down, the balls in the air
  scene3.add(fence.group, life.group);
  scene3.add(terrain.group, buildings.group, beds.group, crops.group, farmers.group, animals.group, nature.group, flock.group, cartMeshes.group, pigeons.group, machineMeshes.group, shed.group);
  /** The ball trees, bushes and rocks stand in until the plants' models are drawn. */
  const standIns = () => { const on = !nature.ready(); terrain.setForest(on); buildings.setPlants(on); };
  const diary = createDiary();
  const piece = guarded(report); // each piece of a frame on its own: one that throws is told once and skipped
  let minimapAt = -1e9, roadItems = []; // roadItems: the web calls' carts to town now (for the check)
  // Farmers at play with the animals (play.js): how long each has been idle, and the farm as a play sees it
  const plays = createPlays(), idleSince = new Map();
  const playCtx = {
    get now() { return performance.now(); }, get still() { return opts.still; }, get animalsOn() { return animalsOn; }, idleSince,
    get farmers() { return (shownModel()?.farmers ?? []).filter(f => !f.scarecrow).map(f => { const p = farmers.posOf(f.id); return p && { id: f.id, name: f.name, x: p.x, y: p.y, state: f.state, nap: f.nap, errand: farmers.onErrand(f.id) }; }).filter(Boolean); },
    get animals() { return animals.world(); },
    get busy() { return new Set([...talk.busyIds(), ...romps.busy()]); },
    animal: i => { const a = animals.info(i); return a && { x: a.spot[0], y: a.spot[1], act: a.act }; },
    errand: (id, to, o) => farmers.errand(id, to, o), endErrand: id => farmers.endErrand(id), onErrand: id => farmers.onErrand(id), arrived: id => farmers.arrived(id), setPose: (id, p) => farmers.setPose(id, p),
    perform: (i, steps, tag) => animals.perform(i, steps, tag), release: i => animals.release(i), command: (i, act) => animals.command(i, act), face: (i, at) => animals.face(i, at),
    pop: (i, text) => overlay.pop(() => animals.info(i)?.top ?? null, text, 'good'),
  };
  // The animals with each other (romps.js): play and play-fights, one at a time; the farm as a romp sees it
  const romps = createRomps();
  const clearBetween = (A, B) => !farmRoam || farmRoam.clear('farm', [A.x, A.y], [B.x, B.y], 5);
  /** The animals, as free for a romp as they are: not talking, not at play with a farmer. */
  const rompWorld = () => { const busy = new Set([...talk.busyIds(), ...plays.busy()]); return animals.world().map(w => (busy.has(w.i) ? { ...w, free: false } : w)); };
  const rompCtx = {
    get still() { return opts.still; }, get animalsOn() { return animalsOn; },
    perform: (i, steps, tag) => animals.perform(i, steps, tag), release: i => animals.release(i), settled: i => animals.settled(i),
    fx: (i, kind) => { if (kind === 'hearts') overlay.pop(() => animals.info(i)?.top ?? null, '♥', 'good'); else animals.fx(i, kind); },
    spot: (area, from, far) => farmRoam?.spot(farmRoam.localArea(area, from?.[0] ?? 0), Math.random, { from, far, r: 6 }) ?? null, clear: clearBetween, // the pasture on the farm it is on
  };
  let snow = null, night = 0, blinkTags = [], gateTop = null, flues = [], waitingN = 0; // flues: each farmhouse's chimney top; waitingN: farmers waiting on you (the mood) // blinkTags: the stall's tags for pull requests whose checks run; gateTop: over the neighbour's gate sign

  // The world's own settings, kept by the page.
  const pref = (name, allowed, fallback) => (allowed.includes(prefs.get(name)) ? prefs.get(name) : fallback);
  let skyMode = pref('sky', SKIES, 'live'), seasonMode = pref('season', SEASON_MODES, 'live');
  let animalsOn = prefs.get('animals') !== 'off', bubblesOn = prefs.get('bubbles') !== 'off', tourOn = prefs.get('tour') !== 'off';
  const tour = createTour(); // left alone for 3 minutes, the camera goes round the farm (tour.js)
  const sound = makeSound(window.AudioContext ?? window.webkitAudioContext); // the soundscape (sound.js): off by default
  let soundOn = prefs.get('sound') === 'on', soundAt = -1e9, soundMade = false; // made: a click has started it once
  let tourFrom = null; // the view before the tour: put back when it stops
  animals.setOn(animalsOn);
  const savedBeds = name => { try { const b = JSON.parse(prefs.get(name) ?? '{}'); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; } };
  let keep = { beds: savedBeds('beds'), packed: false, nbeds: savedBeds('nbeds'), npacked: false }; // yours, and the neighbour's (a second account's)
  const seasons = createSeasons();
  let looks = new Map(); // each field's season (season.js), as of the last scene
  let model = null, groundKey = '', plantsKey = '', lampsKey = '', dirty = true, saveTimer = 0, firstScene = true, selected = null;

  // The view (its heading and tilt in degrees, and the zoom) is kept, a moment after it stops changing, so a drag
  // sends one message, not fifty. The haze follows the camera's distance: the far meadow fades, the farm never does.
  const deg = name => { const v = Number(prefs.get(name)); return prefs.get(name) !== null && Number.isFinite(v) ? (v * Math.PI) / 180 : undefined; };
  const rig = makeCameraRig(THREE, camera, canvas, {
    yaw: deg('yaw'), pitch: deg('pitch'), zoom: Number(prefs.get('zoom')) || 1,
    onChange: ({ yaw, pitch, zoom, distance }) => {
      dirty = true;
      scene3.fog.near = Math.max(70, distance * 1.2);
      scene3.fog.far = Math.max(260, distance * 3.2);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        prefs.set('yaw', String(Math.round(((yaw * 180) / Math.PI) % 360)));
        prefs.set('pitch', String(Math.round((pitch * 180) / Math.PI)));
        prefs.set('zoom', String(+zoom.toFixed(2)));
        refreshHud();
      }, 300);
    },
  });

  const shownSeason = () => (seasonMode === 'live' ? model?.season ?? 'summer' : seasonMode);
  const near = () => rig.state().zoom >= NEAR_ZOOM;
  const overlayHooks = {
    refresh: () => refreshHud(),
    turn: d => rig.turn(d),
    reset: () => rig.reset(),
    zoom: d => rig.zoomBy(d),
    pick: id => pickFarmer(id),
    openField: key => field.open(repoOf(key)),
    hover: id => overlay.setHover(id),
    animal: i => { // its menu: Play greyed out (and why) when it can't start a game; nothing to pick while it is in one
      const info = animals.info(i);
      if (!info) return info;
      const play = romps.playButton(i, rompWorld(), clearBetween), busyWith = plays.busy().has(i) || romps.busy().has(i) ? 'playing' : null;
      return { ...info, busyWith, menu: info.menu.map(m => (m.id === 'play' && play.disabled ? { ...m, disabled: true, title: play.title } : m)) };
    },
    /** The point over animal i's head, in the world (its menu stands there). */
    animalTop: i => animals.info(i)?.top ?? null,
    /** Who would go for animal i's Pet, Feed or Throw a stick: { doer, others: [{ id, name, shirt }] } (none while still). */
    doers(i) {
      const a = animals.info(i);
      if (!a || opts.still) return { doer: null, others: [] };
      const fs = playCtx.farmers, who = chooseDoer(fs, a.spot, d => d / 40), of = id => { const f = shownModel().farmers.find(x => x.id === id); return f && { id, name: f.name, shirt: f.shirt }; };
      return { doer: who.doer && of(who.doer), others: who.others.map(of).filter(Boolean).slice(0, 4) };
    },
    act(i, act, doer) {
      if (plays.busy().has(i) || romps.busy().has(i)) return; // in a game: its menu waits till it is over
      if (act === 'play') { // with the nearest it can play with: a romp, never a fight
        const w = rompWorld(), j = partnerFor(i, w, { playOnly: true }, clearBetween), id = j !== null && romps.playFor(i, j, w);
        if (id) romps.start(id, i, j, w, rompCtx);
        dirty = true;
        return;
      }
      if (SENDS[act] !== undefined && doer && !opts.still && plays.send(i, act, doer, playCtx)) { dirty = true; return; } // a farmer walks over and does it
      animals.command(i, act);
      if (act === 'talk') { // it talks at once: to the nearest animal or farmer, facing it, or to you
        if (!talk.stock()) opts.onTalkMore?.(); // Haiku's are used up: more, if the ✨ Helper may ask (its own lines meanwhile)
        talk.start(i, sceneForTalk(performance.now()));
        const to = talk.bubbles().find(b => b.who === i)?.to;
        if (to) animals.face(i, [to.x, to.y]);
      }
      dirty = true;
    },
    cycle(what) {
      if (what === 'sky') { skyMode = SKIES[(SKIES.indexOf(skyMode) + 1) % SKIES.length]; prefs.set('sky', skyMode); lastSky = -Infinity; }
      if (what === 'season') { seasonMode = SEASON_MODES[(SEASON_MODES.indexOf(seasonMode) + 1) % SEASON_MODES.length]; prefs.set('season', seasonMode); rebuildAll(); }
      if (what === 'animals') { animalsOn = !animalsOn; prefs.set('animals', animalsOn ? 'on' : 'off'); if (!animalsOn) { plays.endAll(playCtx); romps.releaseAll(rompCtx); } animals.setOn(animalsOn); if (!animalsOn) overlay.closePet(); }
      if (what === 'tour') { tourOn = !tourOn; prefs.set('tour', tourOn ? 'on' : 'off'); }
      if (what === 'sound' && sound.available) { soundOn = !soundOn; prefs.set('sound', soundOn ? 'on' : 'off'); if (soundOn) { sound.enable(); soundMade = true; } else sound.disable(); } // the click is the gesture a browser wants
      if (what === 'bubbles') { bubblesOn = !bubblesOn; prefs.set('bubbles', bubblesOn ? 'on' : 'off'); if (model) overlay.sync(shownModel(), { bubblesOn, near: near() }); }
      dirty = true;
    },
  };
  const overlay = makeOverlay(el, { opts, hooks: overlayHooks });
  // The panel and the Menu (hud.js): the farm's, the other worlds' too. Follow keeps the picked farmer in the middle;
  // Resting hides the idle and stale farmers (with their hens, and what goes to them).
  let restingShown = prefs.get('resting') !== 'hidden', following = null;
  const resting = f => f.state === 'idle' || f.state === 'stale';
  /** The model as drawn: without the resting farmers while Resting hides them. */
  const shownModel = () => (restingShown || !model ? model : { ...model, farmers: model.farmers.filter(f => !resting(f)) });
  const hud = makeHud(el, {
    opts, prefs, iconImg,
    hooks: {
      turn: d => rig.turn(d), reset: () => rig.reset(), zoom: d => rig.zoomBy(d), cycle: what => overlayHooks.cycle(what),
      pick: id => pickFarmer(id), setFollow, setResting, help: () => overlay.help(),
      refresh: o => { if (o?.panel) { kept = null; fitClear(); } refreshHud(); }, // folded or unfolded: the farm fits the room it now has
    },
  });
  // the minimap while zoomed in: the whole farm small, the view outlined; a click goes there
  const minimap = makeMinimap(el, { onGo: ([x, y]) => { if (!model) return; setFollow(false); rig.glideTo(shapes.at(x, y, model.ground.H)); dirty = true; } });
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), corner = new THREE.Vector3(), cornerRay = new THREE.Raycaster();
  /** The view's corners on the ground, as 2D map points (the part clear of the panel): the minimap's outline. */
  function viewCorners() {
    const W2 = el.clientWidth || 1, H2 = el.clientHeight || 1, r = kept ? clearRect(W2, H2, kept, a => rig.fitFor(a)) : { x: 0, y: 0, w: W2, h: H2 };
    const out = [];
    for (const [px, py] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) {
      cornerRay.setFromCamera({ x: (px / W2) * 2 - 1, y: -((py / H2) * 2 - 1) }, camera);
      if (!cornerRay.ray.intersectPlane(groundPlane, corner)) return null; // over the horizon
      out.push(toMap({ x: corner.x, z: corner.z }, model.ground.H));
    }
    return out;
  }
  function setFollow(on) {
    following = on && selected && farmers.headOf(selected) ? selected : null;
    rig.follow(following ? () => (following ? farmers.headOf(following) : null) : null, () => { following = null; refreshHud(); });
    refreshHud();
    dirty = true;
  }
  function setResting(shown) {
    restingShown = shown;
    prefs.set('resting', shown ? 'shown' : 'hidden');
    if (model) { const m = shownModel(); farmers.sync(m, { instant: opts.still }); farmers.select(selected); overlay.sync(m, { bubblesOn, near: near() }); overlay.setSelected(selected); }
    refreshHud();
    dirty = true;
  }
  // At 100% the farm is fitted clear of the panel, beside it or below it (camera.js clearRect); the panel's box is
  // held while it shows (it only grows: holdBox), so the farm doesn't jump as its figures change.
  let kept = null;
  function fitClear() {
    kept = holdBox(kept, hud.panelBox());
    rig.setClear(kept ? clearRect(el.clientWidth || 1, el.clientHeight || 1, kept, a => rig.fitFor(a)) : null);
    dirty = true;
  }
  function refreshHud() {
    const sc = model?.scene ?? { farmers: [] };
    hud.render({
      zoom: rig.state().zoom, skyMode, seasonMode, still: opts.still, animals: animalsOn, bubbles: bubblesOn, tour: tourOn ? 'on' : 'off', sound: sound.available ? (soundOn ? 'on' : 'off') : 'unavailable',
      follow: Boolean(following), canFollow: Boolean(selected && farmers.headOf(selected)),
      restingHidden: restingShown ? null : sc.farmers.filter(resting).length, scene: sc, season: model?.season ?? 'summer',
    });
    const box = hud.panelBox();
    if (box ? !kept || box.w > kept.w || box.h > kept.h : kept) fitClear(); // the panel came, grew, or went
  }
  refreshHud();
  setInterval(refreshHud, 1000); // the page's buttons' state (the sidebar) and Motion can change from outside

  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    rig.setFrame(w, h);
    kept = null; // a new window: the panel's box is measured afresh
    fitClear();
    dirty = true;
  };
  new ResizeObserver(resize).observe(el);
  // someone is here: any pointer (moving too), wheel or key in the frame (or a new pick from the page, in select) stops
  // the tour and puts the view back; the press that stops it on the farm picks nothing (pointerup below)
  const touched = () => tour.touch(performance.now());
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) document.addEventListener(type, touched, { capture: true, passive: true });
  let swallow = false;
  canvas.addEventListener('pointerdown', () => { swallow = tour.press(performance.now()); }, { capture: true, passive: true });
  // the sound left on: it starts at the first click in the farm (browsers play nothing before one); quiet while the tab
  // is hidden or the page shows its list (no event reaches the frame then: a look each second)
  el.addEventListener('pointerdown', () => { if (soundOn && sound.state() !== 'running') { sound.enable(); soundMade = true; } }, { capture: true, passive: true });
  const syncSound = () => {
    const want = shouldPlay({ on: soundOn, hidden: document.hidden, shown: el.clientWidth > 0 });
    if (!want && sound.state() !== 'off') sound.disable();
    else if (want && soundMade && sound.state() === 'off') sound.enable();
  };
  document.addEventListener('visibilitychange', syncSound);
  setInterval(syncSound, 1000);
  resize();

  /** The ground is rebuilt when the bed rows or the season shown change. */
  function rebuildGround() {
    const season = shownSeason(), key = `${model.ground.rows}|${season}|${model.land.w}`; // the land: a neighbour's farm too
    if (key === groundKey) return;
    groundKey = key;
    const ext = terrain.build(model.ground, season);
    plays.endAll(playCtx); // a new ground: whoever was at play goes back
    romps.releaseAll(rompCtx);
    plantsKey = ''; // the plants and the roam afresh (rebuildPlants)
    life.setGround(model.ground);
    sky.setExtent(ext.x, ext.z, ext.center);
    cartMeshes.setGround(model.ground.H, farmers.groundAt);
    machineMeshes.setGround(model.ground.H, farmers.groundAt);
    shed.build(model.ground.H);
    if (model.neighbour) shed.build(model.ground.H, model.neighbour.ox); else shed.drop(NEIGHBOUR_X); // the neighbour's own shed
    animals.setWinter(season === 'winter'); // the pond is ice: its frog, fish and lily pads out of sight
    // snow falling over the whole farm in winter
    if (snow) { snow.object.removeFromParent(); snow.object.geometry.dispose(); snow = null; }
    if (season === 'winter') { snow = weather.snowfall(ext.x, ext.z); snow.object.position.set(ext.center.x, 0, ext.center.z); scene3.add(snow.object); }
    // pan over the land, and fit it to the window (the forest and the meadow run past its edges), its buildings' height
    // at the back: your farm, or both farms and the road between (its middle east of yours)
    const land = model.land, hx = land.w / 2 / PX, hz = model.ground.H / 2 / PX, edge = 1.5, centre = { x: (land.w / 2 - W / 2) / PX, z: 0 };
    rig.setFarm({ centre, half: { x: hx, z: hz }, points: [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [0, sz < 0 ? 8 : 2].map(y => ({ x: centre.x + sx * (hx + edge), y, z: sz * (hz + edge) })))) });
  }
  /**
   * The plants (the forest, the yard's, the merge orchard's: build/nature.js) and where the animals may go (roam.js):
   * rebuilt with the ground, and when the orchard's trees change (a merge, a tree grown a size).
   */
  function rebuildPlants() {
    const trees = model.orchard?.trees ?? [], treesKey = trees.map(t => `${t.x},${t.y},${t.size}`).join(';'), key = `${groundKey}|${treesKey}`;
    if (key === plantsKey) return;
    plantsKey = key;
    nature.build(model.ground, shownSeason(), trees).then(done => { if (done) { standIns(); dirty = true; } }).catch(err => report(err, 'plants')); // the farm draws first
    leafPiles = shownSeason() === 'autumn' ? leafPilesOf(model.ground) : []; // the dogs dive into them
    animals.setPiles(leafPiles);
    const roamKey = `${model.ground.rows}|${model.ground.H}|${model.land.w}|${treesKey}|${leafPiles.length}`; // where things stand: not the season (but autumn's piles)
    if (roamKey !== farmRoamKey) { farmRoamKey = roamKey; farmRoam = roamOf(model.ground, { orchard: trees, piles: leafPiles }); }
    animals.setGround(model.ground, farmRoam); // one roam for both: its route grids built once
  }
  /** The farmstead and the yard: rebuilt when the rows, the season or the silos change. */
  function rebuildBuildings() {
    const info = buildings.build(model.ground, shownSeason(), model.silos.map(({ x, name, silo }) => ({ x, name, silo: silo && { fill: silo.fill, lamp: silo.lamp } })), { crates: model.stall.crates }, model.neighbour && { ox: model.neighbour.ox, name: model.neighbour.name });
    gateTop = info.gate ?? null; // the neighbour's gate sign: its name over it (overlay.js)
    flues = info.flues ?? [];
    blinkTags = info.blink ?? [];
    standIns();
    const lk = JSON.stringify(info.lamps);
    if (lk !== lampsKey) { lampsKey = lk; sky.setLamps(info.lamps); }
  }
  function rebuildAll() {
    if (!model) return;
    rebuildGround();
    rebuildPlants();
    rebuildBuildings();
    beds.sync(model.beds, groundWithPlots(), shownSeason(), looks);
  }
  /** What the tour can show now (tour.js): farmers waiting on you, a machine at work, the busiest field, the neighbour's farmhouse, an animal at something. */
  function tourWorld() {
    const fs = shownModel()?.farmers ?? [], counts = new Map();
    for (const f of fs) if (f.state === 'working' && f.field) counts.set(f.field, (counts.get(f.field) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0], bed = top && model.beds.find(b => b.key === top[0]);
    const m = machineItems.find(i => i.phase === 'work'), a = animals.world().find(w => w.a?.act || w.a?.romp);
    return {
      waiting: fs.filter(f => f.state === 'waiting').map(f => f.at), machine: m ? [m.x, m.y] : null, busiest: bed ? [bed.cx, bed.lane] : null,
      neighbour: model.neighbour ? [HOUSE.x + HOUSE.w / 2 + model.neighbour.ox, PORCH_Y] : null, animal: a ? [a.x, a.y] : null,
    };
  }
  /** The ground for the beds: with a neighbour, its empty plots too (moved east, keyed apart from yours). */
  const groundWithPlots = () => (model.neighbour ? { ...model.ground, empty: [...model.ground.empty, ...model.neighbour.ground.empty.map(sl => ({ ...east(sl, model.neighbour.ox), i: `n${sl.i}` }))] } : model.ground);

  function onScene(s) {
    try { applyScene(s); } catch (err) { report(err, 'scene'); }
  }
  function applyScene(s) {
    model = M.farmModel(s, keep);
    const bedMap = JSON.stringify(model.keep.beds), nbedMap = JSON.stringify(model.keep.nbeds ?? {});
    if (bedMap !== JSON.stringify(keep.beds)) prefs.set('beds', bedMap);
    if (nbedMap !== JSON.stringify(keep.nbeds ?? {})) prefs.set('nbeds', nbedMap);
    keep = model.keep;
    looks = piece('seasons', () => seasons.update(model, performance.now())) ?? looks; // a duration: the page clock may stand still
    piece('machines', () => { // which farmers want which machine; a compaction (the harvest) brings the combine
      const compacted = new Set();
      for (const f of model.scene.farmers) { const c = f.compactions ?? 0, was = compactionsSeen.get(f.id); if (was !== undefined && c > was) compacted.add(f.id); compactionsSeen.set(f.id, c); }
      machines.want(shownModel(), performance.now() / 1000, compacted); // a duration: the page clock may stand still
    });
    rebuildAll();
    waitingN = model.scene.farmers.filter(f => f.state === 'waiting').length;
    sky.setMood(dimFor(waitingN)); // the sky dims while three or more wait on you
    piece('fence', () => fence.sync(fenceOf(model.beds, shownModel().farmers, model.scene.farmers), model.ground.H));
    farmers.sync(shownModel(), { instant: firstScene || opts.still });
    piece('hens', () => {
      flock.sync(new Map(shownModel().farmers.map(f => [f.id, f.kids])), id => farmers.posOf(id));
      flock.setHenhouse(henhouseView(model.henhouse), model.ground.H);
    });
    farmers.select(selected);
    overlay.sync(shownModel(), { bubblesOn, near: near() });
    overlay.setSelected(selected);
    if (following && !farmers.headOf(following)) setFollow(false); // its farmer went, or Resting hid it
    field.refresh(); // an open close-up reads its field again (at most every 5 s)
    for (const f of model.farmers) if (f.state === 'idle') { if (!idleSince.has(f.id)) idleSince.set(f.id, performance.now()); } else idleSince.delete(f.id); // how long each has been idle, for play
    // the diary (the sidebar's Farm diary) and the pops: who came, went where, harvested, sold, sent a note
    const told = piece('diary', () => diary.update(model, new Set(shownModel().farmers.map(f => f.id)), Date.now())) ?? { entries: null, pops: [], flights: [] };
    if (told.entries) opts.onDiary?.(told.entries);
    if (!opts.still) for (const f of told.flights) pigeons.launch(f.from, f.to);
    if (!opts.still) for (const p of told.pops) overlay.pop(p.id ? () => (h => h && { x: h.x, y: h.y + 0.5, z: h.z })(farmers.headOf(p.id)) : () => at3(STALL.x + 14, STALL.y + 20, 3), p.text, p.cls);
    refreshHud();
    firstScene = false;
    dirty = true;
  }

  /* ---------- clicks: a farmer opens it in the sidebar (and the camera glides to it); an animal, its menu; the barn starts a session ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hitAt(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // the nearest of each kind under the pointer, then the engine's order: a farmer, an animal, a building, a field
    const first = (list, deep, of) => { let o = ray.intersectObjects(list, deep)[0]?.object; while (o && of(o) === undefined) o = o.parent; return o ? of(o) : undefined; };
    return clickOrder([
      { id: first([...farmers.hits(), ...machineMeshes.hits()], true, o => o.userData.id) }, { animal: first(animals.hits(), false, o => o.userData.animal) },
      { building: first([...buildings.hits(), ...shed.hits()], true, o => o.userData.hit) }, { field: first(beds.hits(), false, o => o.userData.field) },
    ]);
  }
  // A field's close-up: the engine's (makeField, a global in the frame), with what it needs to know of the 3D farm.
  const field = makeField({
    nouns: { repo: 'field', agent: 'farmer', agents: 'farmers' },
    field: key => model?.scene.fields.find(f => f.key === key),
    farmerColor: id => model?.scene.farmers.find(f => f.id === id)?.shirt ?? '#9aa0a6',
    farmerName: id => model?.scene.farmers.find(f => f.id === id)?.name,
    isStill: () => opts.still,
  });
  field.setOptions(opts);
  /** The repo a field is: a neighbour's field (key + '@n') opens its repo's close-up. */
  const repoOf = key => model?.beds.find(b => b.key === key)?.repo ?? key;
  const fieldTip = key => { const b = model?.beds.find(x => x.key === key); return b ? `${b.tip} · Click to see the files agents touched here` : ''; };
  /** A building, clicked: the barn starts a session; the board reads each project's memory; the rest open their dialog. */
  function openBuilding(k) {
    if (k === 'barn') { opts.onStartSession(); return; }
    if (!model) return;
    if (k === 'barn2') { if (model.neighbour) opts.onStartSession(model.neighbour.key); return; } // a session on the neighbour's account
    if (k === 'board') { void openBoard(); return; }
    if (k === 'shed' || k === 'shed2') { // each shed: the machines out on its own farm
      const theirs = i => model.beds.find(b => b.key === i.field)?.farm === 1;
      overlay.openDialog(machinesDialog(machineItems.filter(i => (k === 'shed2') === theirs(i)), model.scene, k === 'shed2' ? { esc, title: `${model.neighbour?.name ?? 'The neighbour'}'s machine shed`, stock: false } : { esc }));
      return;
    }
    overlay.openDialog(dialogFor(k, model.scene, { esc, ago }));
  }
  /** The notice board: each project's CLAUDE.md and memory, read from one of its sessions (the engine's openBoard). */
  async function openBoard() {
    overlay.openDialog({ title: BOARD_TITLE, html: '<div class="loading"><span class="spinner"></span>Reading…</div>' });
    const rows = await Promise.all(boardSessions(model.scene).map(async f => ({ f, r: await opts.request('agentFiles', { agentId: f.id }).catch(() => null) })));
    overlay.setDialogBody(boardHtml(rows, { esc, lastPart }));
  }
  function pickFarmer(id) {
    opts.onPickAgent(id);
    const h = farmers.headOf(id);
    if (h) rig.glideTo({ x: h.x, z: h.z });
  }
  canvas.addEventListener('pointerup', e => {
    if (swallow) { swallow = false; return; } // the press stopped the tour: nothing more
    if (rig.wasDrag() || e.button !== 0) return;
    const hit = hitAt(e);
    if (hit?.id) pickFarmer(hit.id);
    else if (hit?.animal !== undefined) { overlay.openPet(hit.animal); dirty = true; }
    else if (hit?.building) openBuilding(hit.building);
    else if (hit?.field) field.open(repoOf(hit.field));
  });
  let hoverPending = false;
  canvas.addEventListener('pointermove', e => {
    if (hoverPending || e.buttons) return;
    hoverPending = true;
    requestAnimationFrame(() => {
      hoverPending = false;
      const hit = hitAt(e);
      overlay.setHover(hit?.id ?? null);
      canvas.style.cursor = hit ? 'pointer' : '';
      // a farmer's tooltip, as its name tag has it (what it is doing, its context, its cost…); the barn's
      canvas.title = hit?.id ? model?.farmers.find(f => f.id === hit.id)?.tip ?? '' : hit?.animal !== undefined ? `The ${animals.info(hit.animal)?.title.toLowerCase() ?? 'animal'}: click for what you can ask it to do` : hit?.building ? buildingTip(hit.building, { neighbour: model?.neighbour?.name }) : hit?.field ? fieldTip(hit.field) : '';
    });
  });

  /**
   * The machines, each frame (machines.js): who boards (a farmer at the shed door; at once with Motion off), who gets
   * out (parked, or called back), where each is; the combine's and the plough's rows to the fields' seasons. A machine
   * on the lane or a walkway stops for a farmer, an animal or another machine within 3 m ahead (not in its field).
   */
  function tickMachines(dt, shown) {
    const pos = new Map(), shirt = new Map(shown.map(f => [f.id, f.shirt]));
    for (const f of shown) { const p = farmers.posOf(f.id); if (p) pos.set(f.id, { x: p.x, y: p.y, state: f.state, field: f.field }); }
    const inField = (x, y) => model.beds.some(b => x >= b.x0 - 14 && x <= b.x0 + BED.w + 14 && y >= b.y0 - 2 && y <= b.y0 + BED.d + 2);
    const blocked = (x, y, h, id) => !inField(x, y) && (shown.some(f => f.id !== id && !boarded.has(f.id) && pos.has(f.id) && isAhead(x, y, h, pos.get(f.id).x, pos.get(f.id).y))
      || animals.world().some(a => isAhead(x, y, h, a.x, a.y)) || machineItems.some(o => o.id !== id && o.phase !== 'walking' && isAhead(x, y, h, o.x, o.y))); // one waiting for its farmer is in the shed
    machineItems = machines.tick(dt, { farmers: pos, beds: new Map(model.beds.map(b => [b.key, b])), boarded: id => boarded.has(id), blocked, still: opts.still, now: performance.now() / 1000, land: model.land, onError: err => report(err, 'a machine') });
    const act = crewActions(machineItems, { boarded, sent: sentToShed, onErrand: id => farmers.onErrand(id), arrived: id => farmers.arrived(id), still: opts.still });
    for (const id of act.release) { boarded.delete(id); sentToShed.delete(id); farmers.setDriving(id, null); farmers.endErrand(id); } // out of the seat: parked, called back, or no machine any more
    for (const id of act.forget) { sentToShed.delete(id); if (!boarded.has(id)) farmers.endErrand(id); } // not wanted before it got there
    for (const id of act.board) { boarded.add(id); sentToShed.delete(id); }
    const doorFor = id => (shown.find(f => f.id === id)?.farm ? east(SHED_DOOR, model.land.ox) : SHED_DOOR); // its own farm's shed
    for (const id of act.send) if (farmers.errand(id, doorFor(id), { timeout: 45 })) sentToShed.add(id); // to the shed (again, if its walk was cut short)
    for (const it of machineItems) if (boarded.has(it.id) && !farmers.driving(it.id)) farmers.setDriving(it.id, () => machineMeshes.seatOf(it.id));
    // the animals keep off a field a machine is working, and trot out of a moving machine's way
    const busy = [...new Set(machineItems.filter(i => i.phase === 'work' && ['plough', 'sprayer', 'mower', 'combine'].includes(i.job)).map(i => i.field))].sort();
    if (busy.join() !== busySig) { busySig = busy.join(); animals.setBusy(model.beds.filter(b => busy.includes(b.key)).map(b => ({ x0: b.x0, y0: b.y0 }))); }
    if (!opts.still) for (const it of machineItems) if (it.moving) for (const a of animals.world()) if (a.free && inPathOf(it, a.x, a.y)) animals.aside(a.i, it);
    machineMeshes.tick(machineItems, dt, opts.still, id => shirt.get(id) ?? '#9aa0a6');
    shed.tick(machineItems);
    // the combine's cut (it reports from the moment it is wanted, so its harvest waits for it) and the rows each plough
    // has turned, to the fields' seasons
    const cut = new Map(), now = performance.now();
    let changed = seasons.tick(now);
    for (const it of machineItems) {
      if (it.job === 'combine' && it.phase !== 'parked') cut.set(it.field, (cut.get(it.field) ?? 0) + it.rowsDone);
      if (it.job === 'plough' && it.phase === 'work') changed = seasons.plough(it.field, it.rowsPassed) || changed;
    }
    for (const [k, n] of cut) changed = seasons.cut(k, n, now) || changed;
    if (changed) { looks = seasons.looks(); beds.sync(model.beds, groundWithPlots(), shownSeason(), looks); dirty = true; }
    const sig = machineItems.map(i => `${i.id}|${i.vehicle}|${i.implement}|${Math.round(i.x)}|${Math.round(i.y)}|${i.driver}|${i.load}`).join();
    if (sig !== machinesSig || (!opts.still && machineItems.some(i => i.phase === 'work'))) { machinesSig = sig; dirty = true; } // a reel turns, mist drifts
  }

  /* ---------- the frame loop: at most 30 a second; none while hidden; while still, only when something changed ---------- */
  const v = new THREE.Vector3();
  const project = p => {
    v.set(p.x, p.y, p.z).project(camera);
    const w = el.clientWidth, h = el.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.3 };
  };
  const at3 = (x, y, h = 0) => { const p = shapes.at(x, y, model.ground.H); return { x: p.x, y: h, z: p.z }; };
  const silo3 = x => at3(x + 10, SILO_Y + 18, 0.6);
  let lastFrame = 0, lastTick = performance.now(), lastSky = -Infinity, wasNear = false;
  renderer.setAnimationLoop(now => {
    // nothing while the tab is hidden or the page shows its list (the frame has no size then), at most 30 a second
    if (document.hidden || !el.clientWidth || now - lastFrame < FRAME_MS - 2) return;
    lastFrame = now;
    try { frame(now); } catch (err) { report(err, 'frame'); }
  });
  function frame(now) {
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    if (now - lastSky > 2000) { lastSky = now; const n = sky.set(skyFor(new Date(), skyMode, skyAt)); if (n !== night) { night = n; dirty = true; } }
    const moving = rig.update(dt, opts.still), t = opts.still ? 0 : now / 1000;
    const walking = farmers.tick(t, dt, opts.still);
    if (model) {
      const shown = shownModel().farmers, shownIds = new Set(shown.map(f => f.id)), byId = new Map(model.scene.farmers.map(f => [f.id, f]));
      piece('hens', () => {
        flock.tick(t, dt, id => farmers.posOf(id), opts.still, farmers.groundAt);
        flock.whistle(t, shown.filter(f => f.prop === 'whistle').map(f => farmers.headOf(f.id)).filter(Boolean), opts.still);
      });
      // the carts: an MCP server's drives to the farmer calling it (one not drawn: it stays home); a web call's goes to
      // town and back, on the farm's clock (still with Motion off)
      const road = piece('carts', () => {
        cartItems = carts.tick(model.carts, dt, id => (shownIds.has(id) ? farmers.posOf(id) : null), opts.still, performance.now(), model.land); // a duration: the page clock may stand still
        const r = shown.map(f => { const c = cartOf(f, t, model.land); return c && { id: f.id, ...c }; }).filter(Boolean);
        roadItems = r;
        cartMeshes.tick(cartItems, r, dt, opts.still);
        return r;
      }) ?? [];
      piece('machines', () => tickMachines(dt, shown));
      piece('minimap', () => {
        const zoomed = rig.state().zoom > 1.01;
        minimap.show(zoomed);
        if (zoomed && now - minimapAt > 250) { minimapAt = now; minimap.draw(shownModel(), fid => farmers.posOf(fid), viewCorners(), now); }
      });
      piece('labels', () => overlay.setMovers([
        ...shown.filter(f => f.nap && f.wakeAt).map(f => { const p = farmers.posOf(f.id); return p && !p.moving && { key: `nap:${f.id}`, x: p.x, y: p.y, h: 2, text: `wakes in ${until(f.wakeAt)}`, title: `${f.name} wakes up by itself at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` }; }).filter(Boolean),
        ...cartItems.filter(c => c.away).map(c => ({ key: `mcp:${c.server}`, x: c.x, y: c.y, h: 2.4, text: cutMid(c.server, 16), title: `${c.server}, an MCP server${c.who && byId.get(c.who) ? `: ${byId.get(c.who).name} is calling it` : ''}` })),
        ...road.map(r => { const f = shown.find(x => x.id === r.id); return { key: `cart:${r.id}`, x: r.x, y: r.y ?? 114, h: 2.4, text: clip(f.service, 18), title: `${f.name}: ${f.summary || f.service}` }; }),
      ]));
      if (!opts.still && (cartItems.some(c => c.moving) || road.length)) dirty = true; // still: nothing moves, nothing to draw
      piece('pigeons', () => {
        for (const id of pigeons.tick(dt, fid => farmers.headOf(fid), opts.still)) overlay.pop(() => farmers.headOf(id) && { ...farmers.headOf(id), y: farmers.headOf(id).y + 0.5 }, '✉', 'good');
        if (pigeons.count()) dirty = true;
      });
    }
    if (animals.tick(t, dt, night)) dirty = true;
    nature.blow(t, model?.beds.some(b => b.weather === 'rain') ? 2.2 : 1); // the wind in the trees, harder while a field rains
    if (!opts.still && model) for (const pair of talk.tick(sceneForTalk(now), dt, new Set([...plays.busy(), ...romps.busy()]))) { // none with one at play // conversations now and then; held still with Motion off
      // one that starts by itself: each animal in it stops and turns to the other (unless it is doing what you asked)
      for (const [me, other] of [pair, [pair[1], pair[0]]]) if (typeof me.i === 'number' && !animals.info(me.i)?.act) { animals.command(me.i, 'talk'); animals.face(me.i, [other.x, other.y]); }
    }
    // the animals, by kind, for Haiku's talk, once all have loaded (none while the Animals switch hides them): said when it changes
    const kinds = animalsOn && animals.count() === animals.total ? [...new Set(HERDS.map(h => h.kind))].sort() : [];
    if (kinds.join() !== castSaid) { castSaid = kinds.join(); opts.onTalkCast?.(kinds.map(kind => ({ kind }))); }
    // farmers at play with the animals: now and then one starts; their lines join the conversations' bubbles
    piece('plays', () => {
      if (model && !opts.still) plays.tick(dt, playCtx);
      else if (opts.still && plays.busy().size) plays.endAll(playCtx);
    });
    if (model) piece('romps', () => romps.tick(rompWorld(), dt, rompCtx)); // and the animals with each other (none while still or hidden)
    if (model) piece('life', () => { // fireflies at night, bees over the grown fields, crows on a harvested one
      crows.update(looks, model.beds, performance.now());
      const near = ([x, y]) => (shownModel().farmers.some(f => { const p = farmers.posOf(f.id); return p && Math.hypot(p.x - x, p.y - y) < SCARE_PX; }) || machineItems.some(i => Math.hypot(i.x - x, i.y - y) < SCARE_PX));
      const smoke = smokeFarms(shownModel().farmers).map(farm => flues[farm]).filter(Boolean);
      if (life.tick(t, dt, { night, season: shownSeason(), bees: beesFor(model.beds, looks, night, shownSeason()), flocks: crows.flocks(near), clouds: cloudsFor(waitingN), dim: dimFor(waitingN), smoke, machines: machineItems, headlights: headlightsOn(night), piles: leafPiles, balls }) && !opts.still) dirty = true;
    });
    if (model) piece('snowballs', () => { // winter: now and then two idle farmers throw snowballs at each other
      const nowMs = performance.now(), fs = shownModel().farmers.filter(f => !f.scarecrow).map(f => ({ id: f.id, farm: f.farm ?? 0, state: f.state, nap: f.nap, errand: farmers.onErrand(f.id) && !fightIds.has(f.id), followed: f.id === following, at: f.at }));
      const r = snowballs.tick({ now: nowMs, still: opts.still, winter: shownSeason() === 'winter', farmers: fs });
      if (r.start) { // the two turn to each other where they stand
        fightIds = new Set([r.start.a, r.start.b]); thrown = new Set(); landed = new Set();
        for (const [me, other] of [[r.start.a, r.start.b], [r.start.b, r.start.a]]) { const p = farmers.posOf(me), o = farmers.posOf(other); if (p && o) farmers.errand(me, [p.x, p.y], { face: [o.x, o.y], pose: 'idle', timeout: 60 }); }
      }
      if (r.end) { for (const id of fightIds) farmers.endErrand(id); fightIds = new Set(); }
      const fight = snowballs.fight();
      balls = [];
      if (fight) fight.throws.forEach((th, k) => {
        const u = (nowMs - th.at) / 800;
        if (u < 0) return;
        if (!thrown.has(k)) { thrown.add(k); farmers.setPose(th.from, 'wave'); if (k === 1 || k === 4) overlay.pop(() => (h => h && { ...h, y: h.y + 0.5 })(farmers.headOf(th.from)), ['Got you!', 'Missed me!', 'Ha!', 'Cold!'][(k + fight.throws.length) % 4], 'good'); }
        if (u <= 1) { const a = farmers.headOf(th.from), b = farmers.headOf(th.to); if (a && b) balls.push({ a, b, u }); }
        else if (!landed.has(k)) { landed.add(k); const b = farmers.headOf(th.to); if (b) life.puff(b); farmers.setPose(th.from, 'idle'); }
      });
    });
    if (model && soundOn && now - soundAt > 1000) piece('sound', () => { // each layer's volume, once a second
      soundAt = now;
      sound.setMix(mixOf({ night, wind: nature.wind().strength, raining: model.beds.some(b => b.weather === 'rain'), moving: machineItems.filter(i => i.moving).length, still: opts.still }));
    });
    if (model) piece('tour', () => { // left alone, the camera goes round the farm; any input puts the view back
      const r = tour.tick(performance.now(), { on: tourOn, still: opts.still, shown: !document.hidden && el.clientWidth > 0, dialog: overlay.dialogOpen() || overlay.helpOpen() || field.isOpen(), follow: Boolean(following), world: tourWorld() });
      if (r.start) tourFrom = rig.view();
      if (r.shot) { if (r.shot.at) { rig.glideTo(shapes.at(r.shot.at[0], r.shot.at[1], model.ground.H)); rig.setZoom(r.shot.zoom); } else rig.reset(); }
      if (r.stop && tourFrom) { rig.restore(tourFrom); tourFrom = null; }
      if (tour.touring()) { rig.hold({ yaw: rig.state().yaw + 0.05 * dt }); dirty = true; }
    });
    if (model) piece('visits', () => { // a farmer over to the other farm now and then (visits.js), with a neighbour's
      const at = performance.now(), cur = visits.now();
      const v = visits.tick({ now: at, still: opts.still, neighbour: Boolean(model.neighbour), farmers: shownModel().farmers.filter(f => !f.scarecrow).map(f => ({ id: f.id, farm: f.farm ?? 0, state: f.state, nap: f.nap, at: f.at, errand: farmers.onErrand(f.id) && f.id !== cur?.guest, followed: f.id === following })) });
      if (v.start && !farmers.errand(v.start.guest, v.start.to, { face: v.start.face, pose: 'idle', timeout: 120, lanes: true })) visits.cancel(); // along the lanes, over the lane's bridge
      if (v.end) farmers.endErrand(v.end);
      const now2 = visits.now();
      if (now2 && !farmers.onErrand(now2.guest)) visits.cancel(); // its walk was cut short
      else if (now2 && now2.talkUntil === null && farmers.arrived(now2.guest)) { // there: they talk
        const ppl = sceneForTalk(at).farmers, g = ppl.find(f => f.id === now2.guest), h = ppl.find(f => f.id === now2.host);
        visits.arrived(at, g && h ? talk.meet(g, h) * 1000 : 0);
        dirty = true;
      }
    });
    overlay.setTalk(bubblesOn ? [...talk.bubbles().map(b => ({ ...b, key: `${b.conversation}|${b.who}` })), ...plays.bubbles(), ...romps.bubbles()].map(b => {
      const top = typeof b.who === 'number' ? animals.info(b.who)?.top : (h => h && { x: h.x, y: h.y + 0.55, z: h.z })(farmers.headOf(b.who));
      return { key: b.key, text: b.text, toYou: b.toYou, top };
    }) : []);
    if (!opts.still && blinkTags.length) { const k = Math.floor(now / 500) % 2; for (const b of blinkTags) if (b.mesh.material !== b.mats[k]) { b.mesh.material = b.mats[k]; dirty = true; } }
    if (!opts.still) { // the world moves: the wind in the crops, the weather, the snow
      crops.tick(t);
      beds.tick(t, dt);
      snow?.tick(t);
    }
    if (model && near() !== wasNear) { wasNear = near(); overlay.sync(shownModel(), { bubblesOn, near: wasNear }); }
    if (!dirty && !moving && !walking && opts.still) return;
    dirty = false;
    renderer.render(scene3, camera);
    if (model) overlay.place(project, id => farmers.headOf(id), at3, silo3);
  }

  // For the browser check (scripts/farm3d-check.mjs) and close-up pictures: what is drawn, and a view to hold.
  window.__farm3d = {
    stats: () => ({ frame: renderer.info.render.frame, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, farmers: farmers.count(), drawn: shownModel()?.farmers.length ?? 0, ...flock.count(), ...cartMeshes.count(), tags: overlay.count(), beds: model?.beds.length ?? 0, animals: animals.count() }),
    screenOf: id => { const h = farmers.headOf(id); return h ? project(h) : null; }, // where a farmer's head is in the picture, in pixels
    /** What a click at a point in the picture (pixels) would hit: { id } | { animal } | { building } | { field } | null. */
    hitAt: (x, y) => { const r = canvas.getBoundingClientRect(); return hitAt({ clientX: r.left + x, clientY: r.top + y }) ?? null; },
    /** Where a building's click box is in the picture (its upper part, clear of who stands in front), in pixels. */
    buildingAt(k) { const b = [...buildings.hits(), ...shed.hits()].find(o => o.userData.hit === k && o.isMesh); if (!b) return null; const p = new THREE.Vector3(); b.getWorldPosition(p); return project({ x: p.x, y: p.y * 1.6, z: p.z }); },
    /** Where a field's bed is in the picture (its middle), in pixels. */
    bedAt(key) { const b = beds.hits().find(o => o.userData.field === key); if (!b) return null; const p = new THREE.Vector3(); b.getWorldPosition(p); return project({ x: p.x, y: 0.5, z: p.z }); },
    /** A visit now, as soon as there is an idle pair across the farms; and the visit under way ({ guest, host, talkUntil } or null). */
    visitNow: () => visits.force(),
    visit: () => visits.now(),
    /** Which farm a farmer lives on: 1 the neighbour's, 0 yours. */
    farmerFarm: id => model?.farmers.find(f => f.id === id)?.farm ?? 0,
    /** The tour now (as if left alone long enough); whether it runs; the camera's view (yaw, pitch, zoom, target). */
    tourNow: () => tour.force(),
    touring: () => tour.touring(),
    viewNow: () => rig.view(),
    /** The sound: 'off', 'waiting' (on, before a click) or 'running'. */
    sound: () => sound.state(),
    /** Holds the season shown (live, spring, summer, autumn, winter), as the Season switch does. */
    holdSeason: m => { if (!SEASON_MODES.includes(m)) return false; seasonMode = m; prefs.set('season', m); rebuildAll(); dirty = true; return true; },
    /** A snowball fight as soon as there is a pair (winter); a dog diving into a leaf pile now (autumn): true if one set off. */
    snowballNow: () => snowballs.force(),
    pileNow: () => { const w = animals.world().find(x => (x.kind === 'husky' || x.kind === 'shiba') && x.free); return w ? animals.habitNow(w.i, 'pile') : false; },
    /** The small life out now: fireflies, bees, crows (and, as they come, clouds, smoke, headlights, piles, leaves, snowballs). */
    life: () => life.count(),
    /** The task fence: how many stakes, flags and lanterns. */
    fence: () => fence.count(),
    /** The merge orchard: its trees and its signs' words. */
    orchard: () => (model ? { trees: model.orchard.trees.length, signs: model.orchard.signs.map(s => `${s.name} ${s.count}`) } : null),
    /** The land drawn: its width and the neighbour's offset on the 2D map (0: none), and whether there is a neighbour. */
    land: () => (model ? { ...model.land, neighbour: Boolean(model.neighbour) } : null),
    /** The fields drawn, by key. */
    bedKeys: () => (model?.beds ?? []).map(b => b.key),
    /** A play starts now (for the check): every idle farmer counts as idle long enough. */
    playNow() { for (const k of idleSince.keys()) idleSince.set(k, -1e9); plays.soon(); },
    /** A romp now, between animals i and j (for the check), whatever their distance. */
    rompNow: (id, i, j) => romps.start(id, i, j, rompWorld(), rompCtx),
    /** A romp soon, by the usual rules (two free, near, a clear way between them). */
    rompSoon: () => romps.soon(),
    /** Who romps now (animals' indices). */
    romping: () => [...romps.busy()],
    /** An animal's menu as shown (Play greyed out with no one near). */
    menuOf: i => overlayHooks.animal(i)?.menu ?? null,
    /** Who is at play now (farmers' ids, animals' indices). */
    playing: () => [...plays.busy()],
    /** The web calls' carts to town now: where each is. */
    roadCarts: () => roadItems.map(r => ({ ...r })),
    /** How many pigeons are in the air. */
    pigeons: () => pigeons.count(),
    /** The MCP carts now: where each is, whether it is out of its place, who calls it. */
    carts: () => cartItems.map(c => ({ ...c })),
    /** Where a farmer is on the 2D map (and how high it stands, whether it walks). */
    posOf: id => farmers.posOf(id),
    /** The pops showing now (their words). */
    pops: () => overlay.popsShown(),
    /** The buildings' dialog: open or not, and its title. */
    dialog: () => ({ open: overlay.dialogOpen(), title: document.querySelector('.px-dlg-title')?.textContent ?? '' }),
    /** The plants drawn, by kind (none until their models have loaded). */
    plants: () => nature.count(),
    /** The crops shown, by crop and what draws them: { corn: { model: 72, code: 0 } }. */
    crops: () => crops.stats(),
    /** The machines out (machines.js's items): { id, job, vehicle, implement, load, x, y, heading, moving, driver, phase, field, passRow, rowsDone }. */
    machines: () => machineItems.map(i => ({ ...i })),
    /** Each field's season (season.js), by its key: { stage, growth, sprayed, cutRows, ploughed (the rows a plough has turned, a bit each) }. */
    seasons: () => Object.fromEntries(looks),
    /** A farmer as drawn: its character, the clip it plays, its shirt's colour (null while the figurine stands in). */
    farmer: id => farmers.info(id),
    /** The farmers drawn, by id (stale ones are scarecrows). */
    farmerIds: () => (shownModel()?.farmers ?? []).filter(f => !f.scarecrow).map(f => f.id),
    /** The wind in the trees: its clock and strength. */
    wind: () => nature.wind(),
    /** The talk bubbles shown now (their words). */
    talk: () => overlay.talkShown(),
    /** How many of Haiku's exchanges are waiting to be used. */
    talkStock: () => talk.stock(),
    /** Animal i: its kind, what it is doing, where it is on the 2D map, and where its middle is in the picture, in pixels. */
    animal: i => { const a = animals.info(i); return a && { kind: a.kind, act: a.act, part: a.part, spot: a.spot, farm: farmAt(a.spot[0]), at: project({ x: a.top.x, y: a.top.y * 0.5, z: a.top.z }), coat: animals.coat(i) }; },
    /** Animal i walks over to the other farm now (a neighbour's), over a bridge or the stones: true if it set off. */
    sendAcross: i => animals.sendAcross(i),
    /** The creek's crossings ({ lane, cattle, stones }: [from, to] in y), with a neighbour farm. */
    crossings: () => (model?.neighbour ? crossingsOf(model.ground) : null),
    /** A view to hold: yaw and pitch in degrees, zoom, and a 2D farm point to glide to. */
    view({ yaw, pitch, zoom, at } = {}) {
      rig.hold({ yaw: Number.isFinite(yaw) ? (yaw * Math.PI) / 180 : undefined, pitch: Number.isFinite(pitch) ? (pitch * Math.PI) / 180 : undefined, zoom });
      if (at && model) { const p = shapes.at(at[0], at[1], model.ground.H); rig.glideTo(p); }
      dirty = true;
    },
  };

  return {
    scene: onScene,
    select(id) {
      tour.pick(id, performance.now()); // a new pick from the page: someone is here (it sends the same with each snapshot)
      selected = id ?? null;
      if (following && following !== selected) setFollow(false); // picking nobody, or another, ends Follow
      farmers.select(selected); overlay.setSelected(selected); refreshHud(); dirty = true;
    },
    /** Haiku's exchanges (the ✨ Helper's talk), kept for when they fit who is talking. */
    talk(exchanges) { talk.take(exchanges); },
  };
}
