// The 3D farm: the renderer and the frame loop, the model, and the builders put together. world.js imports this
// once the world has registered; start() returns what the bridge calls with each scene and selection.
import * as THREE from './vendor/three.module.js';
import { makeModel } from './model.js';
import { makeCameraRig } from './camera.js';
import { makeMaterials } from './build/materials.js';
import { makeSky, skyFor } from './build/sky.js';
import { makeTerrain } from './build/terrain.js';
import { makeShapes } from './build/shapes.js';
import { makeBuildings } from './build/buildings.js';
import { PX, W } from './layout.js';

const SKIES = ['live', 'day', 'night'], SEASON_MODES = ['live', 'spring', 'summer', 'autumn', 'winter'];
const FRAME_MS = 1000 / 30; // at most 30 frames a second
const STYLE = `
  #farm.f3 { position: relative; overflow: hidden; background: #cfe6f5; }
  #farm.f3 .f3-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
`;

export function start({ el, opts, prefs }) {
  el.innerHTML = '';
  el.classList.add('f3');
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  // The frame's own helpers (pixel.js, engine.js, people.js), handed to the model.
  const kit = { makeGrid, engineScene, tagText, cutMid, lastPart, ago, lookFor: window.Agentville.people.lookFor, pick: window.Agentville.people.pick };
  const M = makeModel(kit);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.className = 'f3-canvas';
  el.append(canvas);
  const scene3 = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  const mats = makeMaterials(THREE), sky = makeSky(THREE, scene3, mats), terrain = makeTerrain(THREE, mats);
  const shapes = makeShapes(THREE, mats), buildings = makeBuildings(THREE, mats, shapes);
  scene3.add(terrain.group, buildings.group);
  let lampsKey = '';

  const pref = (name, allowed, fallback) => (allowed.includes(prefs.get(name)) ? prefs.get(name) : fallback);
  let skyMode = pref('sky', SKIES, 'live'), seasonMode = pref('season', SEASON_MODES, 'live');
  let keep = { beds: (() => { try { const b = JSON.parse(prefs.get('beds') ?? '{}'); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; } })(), packed: false };
  let model = null, groundKey = '', dirty = true, saveTimer = 0;

  // The view's turn and zoom are kept (a moment after they stop changing, so a drag sends one message, not fifty).
  const rig = makeCameraRig(THREE, camera, canvas, {
    turn: Number(prefs.get('turn')) || 0, zoom: Number(prefs.get('zoom')) || 1,
    onChange: ({ turn, zoom }) => {
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { prefs.set('turn', String(turn)); prefs.set('zoom', String(+zoom.toFixed(2))); }, 500);
    },
  });
  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    rig.setAspect(w / h);
    dirty = true;
  };
  new ResizeObserver(resize).observe(el);
  resize();

  const shownSeason = () => (seasonMode === 'live' ? model?.season ?? 'summer' : seasonMode);
  /** The ground is rebuilt when the bed rows or the season shown change. */
  function rebuildGround() {
    if (!model) return;
    const season = shownSeason(), key = `${model.ground.rows}|${season}`;
    if (key === groundKey) return;
    groundKey = key;
    const ext = terrain.build(model.ground, season);
    sky.setExtent(ext.x, ext.z);
    // pan and fit over the farm itself (the forest round it may run off the edges), its buildings' height at the back
    const hx = W / 2 / PX, hz = model.ground.H / 2 / PX, edge = 1.5;
    rig.setFarm({ half: { x: hx, z: hz }, points: [-1, 1].flatMap(sx => [-1, 1].map(sz => ({ x: sx * (hx + edge), y: sz < 0 ? 8 : 0, z: sz * (hz + edge) }))) });
  }

  /** The farmstead and the yard: rebuilt when the rows, the season or the silos change. */
  function rebuildBuildings() {
    const info = buildings.build(model.ground, shownSeason(), model.silos.map(({ x, name, silo }) => ({ x, name, silo: silo && { fill: silo.fill, lamp: silo.lamp } })));
    const lk = JSON.stringify(info.lamps);
    if (lk !== lampsKey) { lampsKey = lk; sky.setLamps(info.lamps); }
  }

  function onScene(s) {
    model = M.farmModel(s, keep);
    const beds = JSON.stringify(model.keep.beds);
    if (beds !== JSON.stringify(keep.beds)) prefs.set('beds', beds);
    keep = model.keep;
    rebuildGround();
    rebuildBuildings();
    dirty = true;
  }

  let lastFrame = 0, lastTick = performance.now(), lastSky = -Infinity;
  renderer.setAnimationLoop(now => {
    if (document.hidden || now - lastFrame < FRAME_MS - 2) return;
    lastFrame = now;
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    if (now - lastSky > 2000) { lastSky = now; sky.set(skyFor(new Date(), skyMode, skyAt)); dirty = true; }
    const moving = rig.update(dt);
    if (!dirty && !moving && opts.still) return;
    dirty = false;
    renderer.render(scene3, camera);
  });

  return {
    scene: onScene,
    select() { dirty = true; },
  };
}
