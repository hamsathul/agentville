// The farm's plants and stones drawn (nature.js says which and where): each model loaded once (models/, after the farm
// has drawn), repainted in the farm's colours with no metal (coats.js), and one InstancedMesh per part of each model,
// so the whole forest is a few dozen draw calls; each plant its own turn and a shade lighter or darker. Until the
// models have loaded the old shapes stand in (terrain.js's ball trees, buildings.js's bushes and rocks): `ready()`.
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { COATS, FINISH } from '../coats.js';
import { plantsOf } from '../nature.js';

export function makeNature(THREE, S) {
  const group = new THREE.Group(), loader = new GLTFLoader(), templates = new Map(), loads = new Map();
  let built = null, want = null, drawnKey = '';
  /** A kind's model, loaded once: its parts (geometry, painted material, place in the model) and its size. */
  function template(kind) {
    if (!loads.has(kind)) loads.set(kind, (async () => {
      const b64 = (await import(`../models/${kind}.js`)).default, bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const gltf = await loader.parseAsync(bytes.buffer, '');
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene), parts = [];
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        const material = o.material.clone();
        if (COATS[kind]?.[material.name]) material.color.set(COATS[kind][material.name]);
        Object.assign(material, FINISH);
        parts.push({ geometry: o.geometry, material, matrix: o.matrixWorld.clone() });
      });
      templates.set(kind, { parts, size: box.getSize(new THREE.Vector3()), floor: box.min.y });
    })());
    return loads.get(kind);
  }
  /** Draws the plants for a farm and a season, once their models have loaded (at once if they have). */
  function build(ground, season) {
    want = { ground, season };
    const plants = plantsOf(ground, season), kinds = [...new Set(plants.map(p => p.kind))];
    const key = `${ground.rows}|${ground.H}|${season}`;
    if (kinds.every(k => templates.has(k))) { draw(plants, key); return Promise.resolve(true); }
    return Promise.all(kinds.map(template)).then(() => {
      if (want.ground !== ground || want.season !== season) return false; // a newer farm asked meanwhile
      draw(plants, key);
      return true;
    });
  }
  function draw(plants, key) {
    if (key === drawnKey && built) return;
    if (built) { built.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); built.removeFromParent(); }
    const g = new THREE.Group(), byKind = new Map(), m4 = new THREE.Matrix4(), place = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
    for (const p of plants) { const k = `${p.kind}|${p.shadow !== false}`; if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(p); }
    for (const [key2, list] of byKind) {
      const kind = key2.split('|')[0], t = templates.get(kind), shadow = key2.endsWith('|true'); // the outer ring's shadows fall off the farm: none
      for (const part of t.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((p, i) => {
          const k = Math.min(p.w / (Math.max(t.size.x, t.size.z) || 1), p.h / (t.size.y || 1)), at = S.at(p.x, p.y, want.ground.H);
          place.compose(new THREE.Vector3(at.x, -t.floor * k, at.z), q.setFromAxisAngle(up, p.turn), new THREE.Vector3(k, k, k));
          mesh.setMatrixAt(i, m4.multiplyMatrices(place, part.matrix));
          const shade = 0.9 + ((Math.abs(Math.round(p.x * 7 + p.y * 13)) % 17) / 17) * 0.18; // a shade lighter or darker, each its own
          mesh.setColorAt(i, tint.setScalar(shade));
        });
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        Object.assign(mesh.userData, { kind, first: part === t.parts[0] });
        g.add(mesh);
      }
    }
    group.add(g);
    built = g;
    drawnKey = key;
  }
  return {
    group, build,
    /** Whether the models are drawn (the stand-ins can go). */
    ready: () => Boolean(built),
    /** How many plants are drawn, by kind (for the check). */
    count: () => { const n = {}; built?.children.forEach(m => { const kind = m.userData.kind; n[kind] = (n[kind] ?? 0) + (m.userData.first ? m.count : 0); }); return n; },
    dispose() { if (built) { built.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); built.removeFromParent(); built = null; } drawnKey = ''; },
  };
}
