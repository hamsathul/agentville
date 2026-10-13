// The sky over the 3D farm, by your clock as the 2D farm has it (pixel.js, skyAt: dawn 5–7, day 7–18, dusk 18–20,
// night), or held at day or night by the Sky switch. One light casts shadows: the sun by day, the moon by night;
// the sky and the fog blend between the phases; at night the glowing materials and up to four lamps come on.
const DAY = { sky: '#cfe6f5', hemiSky: '#e2f2ff', hemiGround: '#6a8f4a', hemi: 1.15, sun: '#fff0d6', sunI: 2.8 };
const DUSK = { sky: '#f2b8a0', hemiSky: '#ffd9c2', hemiGround: '#6a5a4a', hemi: 0.8, sun: '#ffb070', sunI: 1.7 };
const NIGHT = { sky: '#17203a', hemiSky: '#6c7fb0', hemiGround: '#1c2a1c', hemi: 0.45, sun: '#9fb4ff', sunI: 0.55 };

/** A held sky as an hour: noon for day, eleven at night for night. */
export function skyFor(date, hold, skyAt) {
  if (hold === 'day') { const d = new Date(date); d.setHours(12, 0, 0, 0); return skyAt(d); }
  if (hold === 'night') { const d = new Date(date); d.setHours(23, 0, 0, 0); return skyAt(d); }
  return skyAt(date);
}

export function makeSky(THREE, scene, mats) {
  const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
  const sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
  scene.add(hemi, sun, sun.target);
  scene.background = new THREE.Color(DAY.sky);
  scene.fog = new THREE.Fog(DAY.sky, 120, 260);
  const lamps = [];
  let extent = { x: 30, z: 30 }, last = '';
  const c = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
  /** The farm's size, so the shadow covers it all. */
  function setExtent(x, z) {
    extent = { x, z };
    const r = Math.hypot(x, z) + 4;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 4 });
    sun.shadow.camera.updateProjectionMatrix();
    last = '';
  }
  /** Up to four lamps that light at night: [{ x, y, z, color, distance }]. */
  function setLamps(list) {
    for (const l of lamps) scene.remove(l);
    lamps.length = 0;
    for (const p of list.slice(0, 4)) {
      const l = new THREE.PointLight(p.color ?? '#ffd58a', 0, p.distance ?? 9, 1.6);
      l.position.set(p.x, p.y, p.z);
      lamps.push(l);
      scene.add(l);
    }
    last = '';
  }
  /** The light for this hour ({ phase, light, hour } from skyAt). Returns the night factor, 0 by day … 1 at night. */
  function set({ phase, light, hour }) {
    const key = `${phase}|${light.toFixed(2)}|${Math.round(hour * 4)}`;
    const night = 1 - light;
    if (key === last) return night;
    last = key;
    // between day and night the light passes through dusk's warm colours
    const warm = phase === 'dusk' || phase === 'dawn' ? 1 - Math.abs(light - 0.5) * 2 : 0;
    const pick = k => c(c(NIGHT[k], DAY[k], light), DUSK[k], warm * 0.8);
    const skyC = pick('sky');
    scene.background.copy(skyC);
    scene.fog.color.copy(skyC);
    hemi.color.copy(pick('hemiSky')); hemi.groundColor.copy(pick('hemiGround'));
    hemi.intensity = NIGHT.hemi + (DAY.hemi - NIGHT.hemi) * light;
    sun.color.copy(pick('sun'));
    sun.intensity = NIGHT.sunI + (DAY.sunI - NIGHT.sunI) * light - warm * 0.6;
    // the sun crosses from the left to the right, high at midday, a little in front of the farm; the moon the same way by night
    const t = light > 0.02 ? Math.min(1, Math.max(0, (hour - 5.5) / 14.5)) : ((hour + 24 - 19.5) % 24) / 10.5;
    const tt = Math.min(1, Math.max(0, t)), r = Math.hypot(extent.x, extent.z) * 1.6 + 20;
    const elev = Math.max(0.35, Math.sin(tt * Math.PI) * 1.05);
    sun.position.set(Math.cos(Math.PI * (1 - tt)) * r * 0.8, Math.sin(elev) * r, r * 0.45);
    sun.target.position.set(0, 0, 0);
    for (const l of lamps) l.intensity = 9 * Math.max(0, night - 0.25);
    mats.setNight(Math.min(1, Math.max(0, (night - 0.2) / 0.6)));
    return night;
  }
  return { set, setExtent, setLamps };
}
