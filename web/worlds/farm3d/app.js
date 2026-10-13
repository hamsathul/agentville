// The 3D farm: the renderer and the frame loop, the model, the builders, the camera and the overlay put together.
// world.js imports this once the world has registered; start() returns what the bridge calls with each scene and
// selection.
import * as THREE from './vendor/three.module.js';
import { makeModel } from './model.js';
import { makeCameraRig } from './camera.js';
import { makeOverlay } from './overlay.js';
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
import { PX, SILO_Y, W } from './layout.js';

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
  if (!made.renderer) { // no WebGL: say so plainly, and start all the same (the page's corner still has World ▾ and List)
    el.innerHTML = `<div class="f3-nogl" role="status">The 3D farm needs WebGL, which this browser has switched off or doesn't have.<small>${made.error.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])} Choose another world with World ▾ at the top left; the farm draws without it.</small></div>`;
    window.__farm3d = { stats: () => ({ noWebGL: true }) };
    return { scene() {}, select() {} };
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
  scene3.add(terrain.group, buildings.group, beds.group, crops.group, farmers.group, animals.group);
  let snow = null, night = 0;

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
  const overlay = makeOverlay(el, {
    opts,
    hooks: {
      refresh: () => refreshHud(),
      turn: d => rig.turn(d),
      reset: () => rig.reset(),
      zoom: d => rig.zoomBy(d),
      pick: id => pickFarmer(id),
      hover: id => overlay.setHover(id),
      cycle(what) {
        if (what === 'sky') { skyMode = SKIES[(SKIES.indexOf(skyMode) + 1) % SKIES.length]; prefs.set('sky', skyMode); lastSky = -Infinity; }
        if (what === 'season') { seasonMode = SEASON_MODES[(SEASON_MODES.indexOf(seasonMode) + 1) % SEASON_MODES.length]; prefs.set('season', seasonMode); rebuildAll(); }
        if (what === 'animals') { animalsOn = !animalsOn; prefs.set('animals', animalsOn ? 'on' : 'off'); animals.setOn(animalsOn); }
        if (what === 'bubbles') { bubblesOn = !bubblesOn; prefs.set('bubbles', bubblesOn ? 'on' : 'off'); if (model) overlay.sync(model, { bubblesOn, near: near() }); }
        dirty = true;
      },
    },
  });
  function refreshHud() {
    overlay.renderHud({ zoom: rig.state().zoom, skyMode, seasonMode, still: opts.still, nav: opts.navState?.() ?? {}, animals: animalsOn, bubbles: bubblesOn });
  }
  refreshHud();
  setInterval(refreshHud, 1000); // the page's buttons' state (the sidebar) and Motion can change from outside

  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    rig.setAspect(w / h);
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
    sky.setExtent(ext.x, ext.z);
    animals.setGround(model.ground);
    animals.setIce(season === 'winter');
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
    const info = buildings.build(model.ground, shownSeason(), model.silos.map(({ x, name, silo }) => ({ x, name, silo: silo && { fill: silo.fill, lamp: silo.lamp } })));
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
    farmers.sync(model, { instant: firstScene || opts.still });
    farmers.select(selected);
    overlay.sync(model, { bubblesOn, near: near() });
    overlay.setSelected(selected);
    firstScene = false;
    dirty = true;
  }

  /* ---------- clicks: a farmer opens it in the sidebar (and the camera glides to it); the barn starts a session ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hitAt(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const f = ray.intersectObjects(farmers.hits(), true)[0];
    if (f) { let o = f.object; while (o && !o.userData.id) o = o.parent; if (o) return { id: o.userData.id }; }
    const b = ray.intersectObjects(buildings.hits(), true)[0];
    if (b) { let o = b.object; while (o && !o.userData.hit) o = o.parent; if (o) return { building: o.userData.hit }; }
    return null;
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
    else if (hit?.building === 'barn') opts.onStartSession();
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
      canvas.title = hit?.id ? model?.farmers.find(f => f.id === hit.id)?.tip ?? '' : hit?.building === 'barn' ? 'The barn: start or resume a session' : '';
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
    const moving = rig.update(dt), t = opts.still ? 0 : now / 1000;
    const walking = farmers.tick(t, dt, opts.still);
    animals.tick(t, dt, night);
    if (!opts.still) { // the world moves: the wind in the crops, the weather, the snow
      crops.tick(t);
      beds.tick(t, dt);
      snow?.tick(t);
    }
    if (model && near() !== wasNear) { wasNear = near(); overlay.sync(model, { bubblesOn, near: wasNear }); }
    if (!dirty && !moving && !walking && opts.still) return;
    dirty = false;
    renderer.render(scene3, camera);
    if (model) overlay.place(project, id => farmers.headOf(id), at3, silo3);
  }

  // For the browser check (scripts/farm3d-check.mjs) and close-up pictures: what is drawn, and a view to hold.
  window.__farm3d = {
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, farmers: farmers.count(), drawn: model?.farmers.length ?? 0, tags: overlay.count(), beds: model?.beds.length ?? 0 }),
    screenOf: id => { const h = farmers.headOf(id); return h ? project(h) : null; }, // where a farmer's head is in the picture, in pixels
    /** A view to hold: yaw and pitch in degrees, zoom, and a 2D farm point to glide to. */
    view({ yaw, pitch, zoom, at } = {}) {
      rig.hold({ yaw: Number.isFinite(yaw) ? (yaw * Math.PI) / 180 : undefined, pitch: Number.isFinite(pitch) ? (pitch * Math.PI) / 180 : undefined, zoom });
      if (at && model) { const p = shapes.at(at[0], at[1], model.ground.H); rig.glideTo(p); }
      dirty = true;
    },
  };

  return {
    scene: onScene,
    select(id) { selected = id ?? null; farmers.select(selected); overlay.setSelected(selected); dirty = true; },
  };
}
