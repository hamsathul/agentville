// One cache of materials for the whole farm, by colour and options, so a thousand fence posts share one. Glowing
// materials (windows, lamps, string lights) are kept apart: setNight(k) turns their glow up at night (k 0 by day … 1).
export function makeMaterials(THREE) {
  const cache = new Map(), glowing = [];
  /** A flat-shaded standard material: the diorama's look. depthWrite false: drawn under everything (the far meadow). */
  function std(color, { roughness = 0.85, metalness = 0, flat = true, opacity = 1, side = THREE.FrontSide, vertexColors = false, depthWrite = opacity >= 1 } = {}) {
    const key = `std|${color}|${roughness}|${metalness}|${flat}|${opacity}|${side}|${vertexColors}|${depthWrite}`;
    if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: flat, transparent: opacity < 1, opacity, side, vertexColors, depthWrite }));
    return cache.get(key);
  }
  /** A material that glows at night: `day` is its glow by day (0 for none), `night` at night. */
  function glow(color, emissive, { day = 0, night = 1, roughness = 0.4, opacity = 1 } = {}) {
    const key = `glow|${color}|${emissive}|${day}|${night}|${roughness}|${opacity}`;
    if (!cache.has(key)) {
      const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: day, roughness, flatShading: true, transparent: opacity < 1, opacity });
      m.userData.glow = { day, night };
      glowing.push(m);
      cache.set(key, m);
    }
    return cache.get(key);
  }
  /** An unlit material (sky things, rain, the rainbow). */
  function basic(color, { opacity = 1, side = THREE.FrontSide, vertexColors = false } = {}) {
    const key = `basic|${color}|${opacity}|${side}|${vertexColors}`;
    if (!cache.has(key)) cache.set(key, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side, vertexColors, depthWrite: opacity >= 1 }));
    return cache.get(key);
  }
  function setNight(k) {
    for (const m of glowing) m.emissiveIntensity = m.userData.glow.day + (m.userData.glow.night - m.userData.glow.day) * k;
  }
  function disposeAll() { for (const m of cache.values()) m.dispose(); cache.clear(); glowing.length = 0; }
  return { std, glow, basic, setNight, disposeAll };
}
