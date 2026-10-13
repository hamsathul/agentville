// The weather over a field, from its deploy (the 2D farm's weatherOf): rain from a small grey cloud when it failed,
// a rainbow when it worked, a turning windmill while it runs. And the snow that falls on the whole farm in winter.
// Each is { object, tick(t, dt) }; t is 0 while the world stands still.
const BANDS = ['#e04a3a', '#f08a24', '#ffd43b', '#6cc04a', '#3d7be0', '#8a5fc0'];

export function makeWeather(THREE, mats, S) {
  /** Rain over a w × d area, from a cloud 5.5 m up. */
  function rain(w, d) {
    const object = new THREE.Group();
    for (const [x, z, r, c] of [[-1.2, 0, 1.1, '#8a8f96'], [0.4, -0.3, 1.35, '#9aa4ad'], [1.7, 0.2, 0.95, '#8a8f96'], [0.2, 0.5, 0.9, '#7d848c']]) {
      const puff = S.ball(r, c, x, 5.6, z, object, 0);
      puff.scale.set(1.3, 0.7, 1); puff.userData.noShadow = true; puff.castShadow = false;
    }
    const n = 70, drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 0.4, 0.025), mats.basic('#a9dcf7', { opacity: 0.75 }), n);
    const seeds = Array.from({ length: n }, (_, i) => ({ x: (((i * 37) % 100) / 100 - 0.5) * w * 0.7, z: (((i * 61) % 100) / 100 - 0.5) * d * 0.7, o: ((i * 53) % 100) / 100 }));
    drops.frustumCulled = false;
    object.add(drops);
    const m4 = new THREE.Matrix4();
    function tick(t) {
      for (let i = 0; i < n; i++) { const p = seeds[i], y = 5.1 - (((t * 1.6 + p.o) % 1) * 4.8); drops.setMatrixAt(i, m4.makeTranslation(p.x, y, p.z)); }
      drops.instanceMatrix.needsUpdate = true;
    }
    tick(0.37);
    return { object, tick };
  }
  /** A rainbow arcing over a field w wide. */
  function rainbow(w) {
    const object = new THREE.Group(), R = w / 2 + 0.6;
    BANDS.forEach((c, i) => {
      const band = new THREE.Mesh(new THREE.TorusGeometry(R - i * 0.16, 0.08, 5, 36, Math.PI), mats.basic(c, { opacity: 0.72 }));
      band.position.y = 0.3;
      object.add(band);
    });
    return { object, tick() {} };
  }
  /** A little windmill, its sails turning while the deploy runs. */
  function windmill() {
    const object = new THREE.Group();
    S.cyl(0.07, 0.11, 2.6, '#8b5a2b', 0, 0, 0, object, 6);
    const hub = new THREE.Group();
    hub.position.set(0, 2.6, 0.12);
    object.add(hub);
    S.ball(0.1, '#e04a3a', 0, 0, 0, hub, 0);
    for (let i = 0; i < 4; i++) { const sail = S.box(0.16, 0.95, 0.03, i % 2 ? '#f4ecd8' : '#e8d8b0', 0, 0, 0.03, hub); sail.position.set(Math.sin((i * Math.PI) / 2) * 0.5, Math.cos((i * Math.PI) / 2) * 0.5, 0.03); sail.rotation.z = (-i * Math.PI) / 2; }
    return { object, tick(t) { hub.rotation.z = -t * 3; } };
  }
  /** Snow falling over an area x × z (half extents), around a centre. */
  function snowfall(hx, hz) {
    const n = 500, flakes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), mats.basic('#ffffff'), n);
    const seeds = Array.from({ length: n }, (_, i) => ({ x: (((i * 7919) % 1000) / 1000 - 0.5) * 2 * hx, z: (((i * 104729) % 1000) / 1000 - 0.5) * 2 * hz, o: ((i * 31) % 100) / 100, w: (i % 7) * 0.9 }));
    flakes.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    function tick(t) {
      for (let i = 0; i < n; i++) { const p = seeds[i], y = 12 - ((t * 0.09 + p.o) % 1) * 12; flakes.setMatrixAt(i, m4.makeTranslation(p.x + Math.sin(t * 0.8 + p.w) * 0.4, y, p.z)); }
      flakes.instanceMatrix.needsUpdate = true;
    }
    tick(0.5);
    return { object: flakes, tick };
  }
  return { rain, rainbow, windmill, snowfall };
}
