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
import { createDiary } from './diary.js';
import { makeMaterials } from './build/materials.js';
import { makeSky, skyFor } from './build/sky.js';
import { makeTerrain } from './build/terrain.js';
import { makeShapes } from './build/shapes.js';
import { makeBuildings } from './build/buildings.js';
import { makeCrops } from './build/crops.js';
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
import { HERDS } from './antics.js';

// what a farmer is doing, as a word, from the tool in its hands (for what it says to the animals)
const STEP_WORDS = { hoe: 'editing', rake: 'editing', sickle: 'editing', hammer: 'fixing', seeds: 'writing', almanac: 'reading', recipe: 'reading', clipboard: 'planning', blueprint: 'planning', spyglass: 'searching', magnifier: 'searching', pigeon: 'browsing', parcel: 'calling tools', mailbag: 'calling tools', crate: 'committing', cart: 'pushing', barrow: 'pushing', lantern: 'thinking', whistle: 'delegating', can: 'working' };
import { PX, SILO_Y, STALL, W } from './layout.js';

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
  const crops = makeCrops(THREE, mats), beds = makeBeds(THREE, mats, shapes, makeWeather(THREE, mats, shapes), crops);
  const farmers = makeFarmers(THREE, makeFigures(THREE, mats, shapes), shapes), animals = makeAnimals(THREE, mats, shapes), weather = makeWeather(THREE, mats, shapes);
  const nature = makeNature(THREE, shapes), talk = createTalk();
  const flock = makeFlock(THREE, mats, shapes, { copy: animals.copy }); // subagents: hens, the Explore dog, the henhouse's eggs
  const cartMeshes = makeCarts(THREE, mats, shapes, { copy: animals.copy }), carts = createCarts(); // the MCP servers' carts, the web calls' carts to town
  let cartItems = [];
  const pigeons = makePigeons(THREE, mats); // notes between agents
  /** Who is where and what is happening, for talk.js: refreshed twice a second. */
  let talkScene = null, talkSceneAt = -1e9, castSaid = null;
  function sceneForTalk(now) {
    if (talkScene && now - talkSceneAt < 500) return talkScene;
    const list = [];
    for (let i = 0; i < animals.count(); i++) { const a = animals.info(i); if (a?.shown) list.push({ i, kind: a.kind, x: a.spot[0], y: a.spot[1] }); }
    const beds = model?.beds ?? [], season = shownSeason();
    const repoName = key => beds.find(b => b.key === key)?.name ?? null; // a field's name, never its path
    const people = (shownModel()?.farmers ?? []).filter(f => !f.scarecrow).map(f => ({ id: f.id, name: f.name, state: f.state, x: f.at[0], y: f.at[1], step: STEP_WORDS[f.prop] ?? null, repo: repoName(f.field) }));
    const events = beds.filter(b => b.weather === 'rain' || b.weather === 'rainbow').map(b => ({ kind: b.weather === 'rain' ? 'deployFailed' : 'deployOk', repo: b.name }));
    talkScene = { animals: list, farmers: people, facts: { night: night > 0.5, weather: season === 'winter' ? 'snow' : beds.some(b => b.weather === 'rain') ? 'rain' : null, events } };
    talkSceneAt = now;
    return talkScene;
  }
  scene3.add(terrain.group, buildings.group, beds.group, crops.group, farmers.group, animals.group, nature.group, flock.group, cartMeshes.group, pigeons.group);
  /** The ball trees, bushes and rocks stand in until the plants' models are drawn. */
  const standIns = () => { const on = !nature.ready(); terrain.setForest(on); buildings.setPlants(on); };
  const diary = createDiary();
  let snow = null, night = 0, blinkTags = []; // blinkTags: the stall's tags for pull requests whose checks run

  // The world's own settings, kept by the page.
  const pref = (name, allowed, fallback) => (allowed.includes(prefs.get(name)) ? prefs.get(name) : fallback);
  let skyMode = pref('sky', SKIES, 'live'), seasonMode = pref('season', SEASON_MODES, 'live');
  let animalsOn = prefs.get('animals') !== 'off', bubblesOn = prefs.get('bubbles') !== 'off';
  animals.setOn(animalsOn);
  let keep = { beds: (() => { try { const b = JSON.parse(prefs.get('beds') ?? '{}'); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; } })(), packed: false };
  let model = null, groundKey = '', lampsKey = '', dirty = true, saveTimer = 0, firstScene = true, selected = null;

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
    openField: key => field.open(key),
    hover: id => overlay.setHover(id),
    animal: i => animals.info(i),
    act(i, act) {
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
      if (what === 'animals') { animalsOn = !animalsOn; prefs.set('animals', animalsOn ? 'on' : 'off'); animals.setOn(animalsOn); if (!animalsOn) overlay.closePet(); }
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
      zoom: rig.state().zoom, skyMode, seasonMode, still: opts.still, animals: animalsOn, bubbles: bubblesOn,
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
  resize();

  /** The ground is rebuilt when the bed rows or the season shown change. */
  function rebuildGround() {
    const season = shownSeason(), key = `${model.ground.rows}|${season}`;
    if (key === groundKey) return;
    groundKey = key;
    const ext = terrain.build(model.ground, season);
    nature.build(model.ground, season).then(done => { if (done) { standIns(); dirty = true; } }).catch(err => report(err, 'plants')); // the farm draws first
    sky.setExtent(ext.x, ext.z);
    animals.setGround(model.ground);
    cartMeshes.setGround(model.ground.H, farmers.groundAt);
    animals.setWinter(season === 'winter'); // the pond is ice: its frog, fish and lily pads out of sight
    // snow falling over the whole farm in winter
    if (snow) { snow.object.removeFromParent(); snow.object.geometry.dispose(); snow = null; }
    if (season === 'winter') { snow = weather.snowfall(ext.x, ext.z); snow.object.position.set(ext.center.x, 0, ext.center.z); scene3.add(snow.object); }
    // pan over the farm, and fit the farm itself to the window (the forest and the meadow run past its edges), its
    // buildings' height at the back
    const hx = W / 2 / PX, hz = model.ground.H / 2 / PX, edge = 1.5;
    rig.setFarm({ half: { x: hx, z: hz }, points: [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [0, sz < 0 ? 8 : 2].map(y => ({ x: sx * (hx + edge), y, z: sz * (hz + edge) })))) });
  }
  /** The farmstead and the yard: rebuilt when the rows, the season or the silos change. */
  function rebuildBuildings() {
    const info = buildings.build(model.ground, shownSeason(), model.silos.map(({ x, name, silo }) => ({ x, name, silo: silo && { fill: silo.fill, lamp: silo.lamp } })), { crates: model.stall.crates });
    blinkTags = info.blink ?? [];
    standIns();
    const lk = JSON.stringify(info.lamps);
    if (lk !== lampsKey) { lampsKey = lk; sky.setLamps(info.lamps); }
  }
  function rebuildAll() {
    if (!model) return;
    rebuildGround();
    rebuildBuildings();
    beds.sync(model.beds, model.ground, shownSeason());
  }

  function onScene(s) {
    try { applyScene(s); } catch (err) { report(err, 'scene'); }
  }
  function applyScene(s) {
    model = M.farmModel(s, keep);
    const bedMap = JSON.stringify(model.keep.beds);
    if (bedMap !== JSON.stringify(keep.beds)) prefs.set('beds', bedMap);
    keep = model.keep;
    rebuildAll();
    farmers.sync(shownModel(), { instant: firstScene || opts.still });
    flock.sync(new Map(shownModel().farmers.map(f => [f.id, f.kids])), id => farmers.posOf(id));
    flock.setHenhouse(henhouseView(model.henhouse), model.ground.H);
    farmers.select(selected);
    overlay.sync(shownModel(), { bubblesOn, near: near() });
    overlay.setSelected(selected);
    if (following && !farmers.headOf(following)) setFollow(false); // its farmer went, or Resting hid it
    field.refresh(); // an open close-up reads its field again (at most every 5 s)
    // the diary (the sidebar's Farm diary) and the pops: who came, went where, harvested, sold, sent a note
    const told = diary.update(model, new Set(shownModel().farmers.map(f => f.id)), Date.now());
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
      { id: first(farmers.hits(), true, o => o.userData.id) }, { animal: first(animals.hits(), false, o => o.userData.animal) },
      { building: first(buildings.hits(), true, o => o.userData.hit) }, { field: first(beds.hits(), false, o => o.userData.field) },
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
  const fieldTip = key => { const b = model?.beds.find(x => x.key === key); return b ? `${b.tip} · Click to see the files agents touched here` : ''; };
  /** A building, clicked: the barn starts a session; the board reads each project's memory; the rest open their dialog. */
  function openBuilding(k) {
    if (k === 'barn') { opts.onStartSession(); return; }
    if (!model) return;
    if (k === 'board') { void openBoard(); return; }
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
    if (rig.wasDrag() || e.button !== 0) return;
    const hit = hitAt(e);
    if (hit?.id) pickFarmer(hit.id);
    else if (hit?.animal !== undefined) { overlay.openPet(hit.animal); dirty = true; }
    else if (hit?.building) openBuilding(hit.building);
    else if (hit?.field) field.open(hit.field);
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
      canvas.title = hit?.id ? model?.farmers.find(f => f.id === hit.id)?.tip ?? '' : hit?.animal !== undefined ? `The ${animals.info(hit.animal)?.title.toLowerCase() ?? 'animal'}: click for what you can ask it to do` : hit?.building ? buildingTip(hit.building) : hit?.field ? fieldTip(hit.field) : '';
    });
  });

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
      flock.tick(t, dt, id => farmers.posOf(id), opts.still, farmers.groundAt);
      const shown = shownModel().farmers, shownIds = new Set(shown.map(f => f.id)), byId = new Map(model.scene.farmers.map(f => [f.id, f]));
      flock.whistle(t, shown.filter(f => f.prop === 'whistle').map(f => farmers.headOf(f.id)).filter(Boolean), opts.still);
      // the carts: an MCP server's drives to the farmer calling it (one not drawn: it stays home); a web call's goes to town
      cartItems = carts.tick(model.carts, dt, id => (shownIds.has(id) ? farmers.posOf(id) : null), opts.still, performance.now()); // a duration: the page clock may stand still
      const road = shown.map(f => { const c = cartOf(f, now / 1000); return c && { id: f.id, ...c }; }).filter(Boolean);
      cartMeshes.tick(cartItems, road, dt, opts.still);
      overlay.setMovers([
        ...cartItems.filter(c => c.away).map(c => ({ key: `mcp:${c.server}`, x: c.x, y: c.y, h: 2.4, text: cutMid(c.server, 16), title: `${c.server}, an MCP server${c.who && byId.get(c.who) ? `: ${byId.get(c.who).name} is calling it` : ''}` })),
        ...road.map(r => { const f = shown.find(x => x.id === r.id); return { key: `cart:${r.id}`, x: r.x, y: 114, h: 2.4, text: clip(f.service, 18), title: `${f.name}: ${f.summary || f.service}` }; }),
      ]);
      if (cartItems.some(c => c.moving) || road.length) dirty = true;
      for (const id of pigeons.tick(dt, fid => farmers.headOf(fid), opts.still)) overlay.pop(() => farmers.headOf(id) && { ...farmers.headOf(id), y: farmers.headOf(id).y + 0.5 }, '✉', 'good');
      if (pigeons.count()) dirty = true;
    }
    if (animals.tick(t, dt, night)) dirty = true;
    nature.blow(t, model?.beds.some(b => b.weather === 'rain') ? 2.2 : 1); // the wind in the trees, harder while a field rains
    if (!opts.still && model) for (const pair of talk.tick(sceneForTalk(now), dt)) { // conversations now and then; held still with Motion off
      // one that starts by itself: each animal in it stops and turns to the other (unless it is doing what you asked)
      for (const [me, other] of [pair, [pair[1], pair[0]]]) if (typeof me.i === 'number' && !animals.info(me.i)?.act) { animals.command(me.i, 'talk'); animals.face(me.i, [other.x, other.y]); }
    }
    // the animals, by kind, for Haiku's talk, once all have loaded (none while the Animals switch hides them): said when it changes
    const kinds = animalsOn && animals.count() === animals.total ? [...new Set(HERDS.map(h => h.kind))].sort() : [];
    if (kinds.join() !== castSaid) { castSaid = kinds.join(); opts.onTalkCast?.(kinds.map(kind => ({ kind }))); }
    overlay.setTalk(bubblesOn ? talk.bubbles().map(b => {
      const top = typeof b.who === 'number' ? animals.info(b.who)?.top : (h => h && { x: h.x, y: h.y + 0.55, z: h.z })(farmers.headOf(b.who));
      return { key: `${b.conversation}|${b.who}`, text: b.text, toYou: b.toYou, top };
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
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, farmers: farmers.count(), drawn: shownModel()?.farmers.length ?? 0, ...flock.count(), ...cartMeshes.count(), tags: overlay.count(), beds: model?.beds.length ?? 0, animals: animals.count() }),
    screenOf: id => { const h = farmers.headOf(id); return h ? project(h) : null; }, // where a farmer's head is in the picture, in pixels
    /** Where a building's click box is in the picture (its upper part, clear of who stands in front), in pixels. */
    buildingAt(k) { const b = buildings.hits().find(o => o.userData.hit === k && o.isMesh); if (!b) return null; const p = new THREE.Vector3(); b.getWorldPosition(p); return project({ x: p.x, y: p.y * 1.6, z: p.z }); },
    /** Where a field's bed is in the picture (its middle), in pixels. */
    bedAt(key) { const b = beds.hits().find(o => o.userData.field === key); if (!b) return null; const p = new THREE.Vector3(); b.getWorldPosition(p); return project({ x: p.x, y: 0.5, z: p.z }); },
    /** The fields drawn, by key. */
    bedKeys: () => (model?.beds ?? []).map(b => b.key),
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
    animal: i => { const a = animals.info(i); return a && { kind: a.kind, act: a.act, part: a.part, spot: a.spot, at: project({ x: a.top.x, y: a.top.y * 0.5, z: a.top.z }), coat: animals.coat(i) }; },
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
      selected = id ?? null;
      if (following && following !== selected) setFollow(false); // picking nobody, or another, ends Follow
      farmers.select(selected); overlay.setSelected(selected); refreshHud(); dirty = true;
    },
    /** Haiku's exchanges (the ✨ Helper's talk), kept for when they fit who is talking. */
    talk(exchanges) { talk.take(exchanges); },
  };
}
