// The ground: the farm's grass (the season's greens in soft patches, gently uneven where nothing stands), the dirt
// lane in front of the buildings, the yard's path and the walkways between the fields, the pond, and the forest all
// round, as on the 2D farm (web/worlds/farm/world.js, drawLand); and past it a wide meadow with more forest, out
// past every edge of the window (camera.js, GROUND_HALF), fading into the haze, so the farm fills the window as the
// 2D farm does.
import { CORR, LANE, LANE_HALF, POND, PX, W, pastureOf, toWorld } from '../layout.js';
import { GROUND_HALF } from '../camera.js';
import { disposeTree, noise, seasonPalette, vnoise } from './util.js';

const MARGIN_X = 48, MARGIN_TOP = 40, MARGIN_BOTTOM = 40; // the forest's ring past the farm's edges, in 2D px

export function makeTerrain(THREE, mats) {
  const group = new THREE.Group();
  let built = null;
  /** The ground's 2D rectangle (the farm and its forest ring) and its size in metres. */
  const extentOf = H => ({ x0: -MARGIN_X, x1: W + MARGIN_X, y0: -MARGIN_TOP, y1: H + MARGIN_BOTTOM });

  function build(ground, season) {
    if (built) { disposeTree(built); built = null; }
    const g = new THREE.Group(), { H, GRID } = ground, S = seasonPalette(season), ext = extentOf(H);
    const w = (ext.x1 - ext.x0) / PX, d = (ext.y1 - ext.y0) / PX, c0 = toWorld((ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2, H);
    // the meadow past the farm, out past every edge of the window: one vertex every 40 m, the season's greens
    {
      const n = Math.round((GROUND_HALF * 2) / 40), far = new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, n, n);
      far.rotateX(-Math.PI / 2);
      const fp = far.attributes.position, fc = new Float32Array(fp.count * 3), shades = S.grass.map(h => new THREE.Color(h)), fcol = new THREE.Color();
      for (let i = 0; i < fp.count; i++) { fcol.copy(shades[noise(Math.round(fp.getX(i)), Math.round(fp.getZ(i))) % 2 ? 1 : 0]); fc.set([fcol.r, fcol.g, fcol.b], i * 3); }
      far.setAttribute('color', new THREE.BufferAttribute(fc, 3));
      const meadow = new THREE.Mesh(far, mats.std('#ffffff', { vertexColors: true, roughness: 1 }));
      meadow.position.y = -0.04; // under the farm's own grass
      meadow.receiveShadow = true;
      g.add(meadow);
    }

    // the grass: one vertex every half metre, coloured and raised by where it is
    const pasture = pastureOf(ground);
    const lane = (x, y) => (Math.abs(y - LANE) <= LANE_HALF)
      || (Math.abs(x - CORR[0]) <= 6 && y >= LANE && y <= pasture.y0) // the yard's path, down to the pasture's gate
      || CORR.slice(1).some(c => Math.abs(x - c) <= 6 && y >= GRID.y0 - 2 && y <= GRID.y1 - 4);
    const flat = (x, y) => (x >= GRID.x0 - 4 && x <= GRID.x1 + 4 && y >= GRID.y0 - 6 && y <= GRID.y1 + 6) // the fields
      || (y < LANE + LANE_HALF + 4 && x > 0 && x < W) // the farmstead
      || (((x - POND.cx) / (POND.rx + 8)) ** 2 + ((y - POND.cy) / (POND.ry + 8)) ** 2 <= 1); // the pond
    const segX = Math.round(w * 2), segZ = Math.round(d * 2);
    const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), col = new THREE.Color();
    const dirt = [new THREE.Color('#b08850'), new THREE.Color('#c9a46a'), new THREE.Color('#dcc08a')];
    const greens = S.grass.map(h => new THREE.Color(h));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * PX + (ext.x0 + ext.x1) / 2, y = pos.getZ(i) * PX + (ext.y0 + ext.y1) / 2;
      const v = vnoise(x, y, 22) + (noise(x, y) / 1023 - 0.5) * 0.25;
      if (lane(x, y)) col.copy(dirt[v < 0.4 ? 0 : v < 0.75 ? 1 : 2]);
      else col.copy(greens[v < 0.36 ? 0 : v < 0.68 ? 1 : 2]);
      colors.set([col.r, col.g, col.b], i * 3);
      pos.setY(i, lane(x, y) ? 0 : flat(x, y) ? 0.03 : 0.03 + (noise(x + 5, y + 9) / 1023) * 0.12);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.translate(c0.x, 0, c0.z);
    geo.computeVertexNormals();
    const grass = new THREE.Mesh(geo, mats.std('#ffffff', { vertexColors: true, roughness: 1 }));
    grass.receiveShadow = true;
    g.add(grass);

    // the pond: a sandy bank, deep water at the edge, lighter in the middle; ice in winter
    const p = toWorld(POND.cx, POND.cy, H), rx = POND.rx / PX, rz = POND.ry / PX;
    const disc = (r, y, color, k = 1) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.08, 40), color); m.scale.set(rx * k + r, 1, rz * k + r); m.position.set(p.x, y, p.z); m.receiveShadow = true; g.add(m); return m; };
    disc(0.5, 0.03, mats.std('#c9a46a'));
    disc(0, 0.07, S.snow ? mats.std('#cfe6f2', { roughness: 0.3 }) : mats.std('#3d7be0', { roughness: 0.25 }));
    disc(0, 0.075, S.snow ? mats.std('#e6f3fa', { roughness: 0.2 }) : mats.std('#5ab4ff', { roughness: 0.2 }), 0.6);
    if (!S.snow) for (const [dx, dz] of [[-2.4, 0.5], [1.8, -0.6], [2.9, 0.7]]) { const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.03, 9), mats.std('#3f9b3a')); pad.position.set(p.x + dx, 0.12, p.z + dz); g.add(pad); }

    // the forest: round trees just past the farm's edges, thicker further out (and in its top left corner)
    const trees = [];
    for (let gy = Math.floor((ext.y0 - 20) / 18); gy * 18 < ext.y1 + 10; gy++) for (let gx = Math.floor((ext.x0 - 24) / 20); gx * 20 < ext.x1 + 10; gx++) {
      const n = noise(gx * 31, gy * 17), x = gx * 20 + (n % 13) - 6 + (gy % 2) * 10, y = gy * 18 + ((n >> 4) % 9);
      if (!(x < -4 || x > W + 4 || y <= 12 || y >= H + 22)) continue;
      if (x < ext.x0 + 6 || x > ext.x1 - 6 || y < ext.y0 + 6 || y > ext.y1 - 4) continue;
      trees.push([x, y, 9 + ((n >> 6) % 5), n]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6), crownGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, mats.std('#6b4320'), trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, mats.std('#ffffff'), trees.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), canopy = S.canopy.slice(1).map(h => new THREE.Color(h));
    trees.forEach(([x, y, r, n], i) => {
      const t = toWorld(x, y, H), s = (r / PX) * 1.25, h = 1.2 + (n % 5) * 0.15;
      trunks.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, h / 2, t.z), q.identity(), new THREE.Vector3(1, h, 1)));
      e.set((n % 7) * 0.3, (n % 11) * 0.5, 0);
      crowns.setMatrixAt(i * 2, m4.compose(new THREE.Vector3(t.x, h + s * 0.7, t.z), q.setFromEuler(e), new THREE.Vector3(s, s * 0.95, s)));
      crowns.setColorAt(i * 2, canopy[n % 2]);
      crowns.setMatrixAt(i * 2 + 1, m4.compose(new THREE.Vector3(t.x - s * 0.25, h + s * 1.3, t.z + s * 0.2), q.setFromEuler(e.set(0.4, (n % 13) * 0.4, 0.2)), new THREE.Vector3(s * 0.6, s * 0.6, s * 0.6)));
      crowns.setColorAt(i * 2 + 1, S.bloom && n % 3 === 0 ? new THREE.Color(S.bloom) : canopy[S.snow ? 2 : 1 + (n % 2)]); // blossom in spring, snow in winter
    });
    trunks.castShadow = crowns.castShadow = true;
    trunks.receiveShadow = crowns.receiveShadow = true;
    g.add(trunks, crowns);

    // more forest past the farm's own, out to 160 m, thinning, with clearings; too far for shadows
    {
      const spots = [], half = 160, inner = { x: w / 2 + 2, z: d / 2 + 2 };
      for (let gz = -half; gz <= half; gz += 6) for (let gx = -half; gx <= half; gx += 6) {
        const n = noise(gx + 1000, gz + 2000), x = c0.x + gx + (n % 7) - 3, z = c0.z + gz + ((n >> 3) % 7) - 3;
        if (Math.abs(x - c0.x) < inner.x && Math.abs(z - c0.z) < inner.z) continue;
        const out = Math.max(Math.abs(x - c0.x) - inner.x, Math.abs(z - c0.z) - inner.z); // metres past the farm's edge
        if (n % 100 < (out < 30 ? 8 : out < 80 ? 30 : 55)) continue; // thinner further out
        if (vnoise(x, z, 40) < 0.22) continue; // a clearing
        spots.push([x, z, n]);
      }
      const ot = new THREE.InstancedMesh(trunkGeo, mats.std('#6b4320'), spots.length), oc = new THREE.InstancedMesh(crownGeo, mats.std('#ffffff'), spots.length * 2);
      spots.forEach(([x, z, n], i) => {
        const s2 = 1.3 + (n % 9) * 0.12, h = 1.3 + (n % 5) * 0.2;
        ot.setMatrixAt(i, m4.compose(new THREE.Vector3(x, h / 2, z), q.identity(), new THREE.Vector3(1.1, h, 1.1)));
        e.set((n % 7) * 0.3, (n % 11) * 0.5, 0);
        oc.setMatrixAt(i * 2, m4.compose(new THREE.Vector3(x, h + s2 * 0.7, z), q.setFromEuler(e), new THREE.Vector3(s2, s2 * 0.95, s2)));
        oc.setColorAt(i * 2, canopy[n % 2]);
        oc.setMatrixAt(i * 2 + 1, m4.compose(new THREE.Vector3(x - s2 * 0.25, h + s2 * 1.3, z + s2 * 0.2), q.setFromEuler(e.set(0.4, (n % 13) * 0.4, 0.2)), new THREE.Vector3(s2 * 0.6, s2 * 0.6, s2 * 0.6)));
        oc.setColorAt(i * 2 + 1, S.bloom && n % 3 === 0 ? new THREE.Color(S.bloom) : canopy[S.snow ? 2 : 1 + (n % 2)]);
      });
      ot.receiveShadow = oc.receiveShadow = true;
      g.add(ot, oc);
    }

    // flowers in the grass, by the season (none in winter)
    if (S.flowers.length) {
      const spots = [];
      for (let y = ext.y0 + 8; y < ext.y1 - 8; y += 5) for (let x = ext.x0 + 8; x < ext.x1 - 8; x += 6) {
        const n = noise(x + 7, y + 3);
        if (n < 212 && n >= 200 && !lane(x, y) && !flat(x, y)) spots.push([x + (n % 4), y, n]);
      }
      const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 0), mats.std('#ffffff'), spots.length);
      spots.forEach(([x, y, n], i) => { const t = toWorld(x, y, H); flowers.setMatrixAt(i, m4.makeTranslation(t.x, 0.14, t.z)); flowers.setColorAt(i, new THREE.Color(S.flowers[n % S.flowers.length])); });
      g.add(flowers);
    }
    group.add(g);
    built = g;
    return { x: w / 2, z: d / 2, center: c0 };
  }
  return { group, build, dispose: () => { if (built) disposeTree(built); built = null; } };
}
