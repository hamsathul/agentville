// The farm's packed models (models/), each loaded once and shared: a still model's parts for an InstancedMesh (the
// crops, build/crops.js), in the farm's colours (coats.js), or a model's scene to copy (the machines). A model that
// doesn't load rejects, and whatever stands in for it stays.
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { COATS } from '../coats.js';

export function makeModels(THREE) {
  const loader = new GLTFLoader(), scenes = new Map(), stills = new Map();
  /** A model's glTF, parsed once. */
  function gltf(kind) {
    if (!scenes.has(kind)) scenes.set(kind, (async () => {
      const b64 = (await import(`../models/${kind}.js`)).default, bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const g = await loader.parseAsync(bytes.buffer, '');
      g.scene.updateMatrixWorld(true);
      return g;
    })());
    return scenes.get(kind);
  }
  /** A still model's parts, each its geometry where it sits in the model, its colour area's name and its colour; and the
   *  model's box. */
  function parts(kind) {
    if (!stills.has(kind)) stills.set(kind, gltf(kind).then(g => {
      const out = [], box = new THREE.Box3();
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
        geometry.computeBoundingBox();
        box.union(geometry.boundingBox);
        out.push({ geometry, name: o.material.name, color: COATS[kind]?.[o.material.name] ?? `#${o.material.color.getHexString()}` });
      });
      return { parts: out, box };
    }));
    return stills.get(kind);
  }
  return { gltf, parts };
}
