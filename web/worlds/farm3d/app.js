import * as THREE from './vendor/three.module.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

export function start({ el }) {
  el.innerHTML = '';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  el.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  camera.position.set(6, 6, 9); camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x446644, 2), new THREE.Mesh(new RoundedBoxGeometry(2, 2, 2, 2, 0.2), new THREE.MeshStandardMaterial({ color: '#d9673a' })));
  const draw = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.render(scene, camera); };
  new ResizeObserver(draw).observe(el);
  return { scene: draw, select() {} };
}
