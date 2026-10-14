// The ground: the farm's grass (the season's greens in soft patches, gently uneven where nothing stands), the dirt
// lane in front of the buildings, the yard's path and the walkways between the fields, the pond, and the forest all
// round, as on the 2D farm (web/worlds/farm/world.js, drawLand); and past it a wide meadow with more forest, out
// past every edge of the window (camera.js, GROUND_HALF), fading into the haze, so the farm fills the window as the
// 2D farm does.
import { CORR, CREEK, LANE, LANE_HALF, POND, PX, ROAD, W, WATER, crossingsOf, extentOf, forestOf, pastureOf, toWorld } from '../layout.js';
import { GROUND_HALF } from '../camera.js';
import { disposeTree, noise, seasonPalette, vnoise } from './util.js';


export function makeTerrain(THREE, mats) {
  const group = new THREE.Group();
  let built = null;

  function build(ground, season) {
    if (built) { disposeTree(built); built = null; }
    const g = new THREE.Group(), { H, GRID } = ground, S = seasonPalette(season), land = ground.land ?? { w: W, ox: 0 }, ext = extentOf(H, land.w);
    const farms = land.ox ? [0, land.ox] : [0]; // each farm's offset on the map: yours, and the neighbour's
    const w = (ext.x1 - ext.x0) / PX, d = (ext.y1 - ext.y0) / PX, c0 = toWorld((ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2, H);
    // the meadow past the farm, out past every edge of the window: one vertex every 40 m, the season's greens
    {
      const n = Math.round((GROUND_HALF * 2) / 40), far = new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, n, n);
      far.rotateX(-Math.PI / 2);
      const fp = far.attributes.position, fc = new Float32Array(fp.count * 3), shades = S.grass.map(h => new THREE.Color(h)), fcol = new THREE.Color();
      for (let i = 0; i < fp.count; i++) { fcol.copy(shades[noise(Math.round(fp.getX(i)), Math.round(fp.getZ(i))) % 2 ? 1 : 0]); fc.set([fcol.r, fcol.g, fcol.b], i * 3); }
      far.setAttribute('color', new THREE.BufferAttribute(fc, 3));
      const meadow = new THREE.Mesh(far, mats.std('#ffffff', { vertexColors: true, roughness: 1, depthWrite: false }));
      meadow.position.y = -0.04; // under the farm's own grass
      meadow.renderOrder = -1; // drawn first, hiding nothing: the pond's hollow and its fish lie below it
      meadow.receiveShadow = true;
      g.add(meadow);
    }

    // the grass: one vertex every half metre, coloured and raised by where it is
    const pasture = pastureOf(ground);
    const creek = x => land.ox && x >= CREEK.x0 && x <= CREEK.x1; // between the farms, beside the road to town
    const lane = (x, y) => (Math.abs(y - LANE) <= LANE_HALF)
      || (land.ox && x >= ROAD.x0 && x <= ROAD.x1) // the road to town, north to south between the farms
      || farms.some(ox => (Math.abs(x - ox - CORR[0]) <= 6 && y >= LANE && y <= pasture.y0) // the yard's path, down to the pasture's gate
        || CORR.slice(1).some(c => Math.abs(x - ox - c) <= 6 && y >= GRID.y0 - 2 && y <= GRID.y1 - 4));
    const flat = (x, y) => farms.some(ox => (x - ox >= GRID.x0 - 4 && x - ox <= GRID.x1 + 4 && y >= GRID.y0 - 6 && y <= GRID.y1 + 6) // the fields
      || (y < LANE + LANE_HALF + 4 && x - ox > 0 && x - ox < W)) // the farmstead
      || (((x - POND.cx) / (POND.rx + 8)) ** 2 + ((y - POND.cy) / (POND.ry + 8)) ** 2 <= 1); // the pond
    const segX = Math.round(w * 2), segZ = Math.round(d * 2);
    const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), col = new THREE.Color();
    const dirt = [new THREE.Color('#b08850'), new THREE.Color('#c9a46a'), new THREE.Color('#dcc08a')];
    const greens = S.grass.map(h => new THREE.Color(h)), mud = [new THREE.Color('#8fae8a'), new THREE.Color('#35666e')];
    // the pond's hollow: 0 in its middle, 1 at the water's edge; steep at the edge, so the fish swim clear of its bottom
    const hollow = (x, y) => ((x - POND.cx) / POND.rx) ** 2 + ((y - POND.cy) / POND.ry) ** 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * PX + (ext.x0 + ext.x1) / 2, y = pos.getZ(i) * PX + (ext.y0 + ext.y1) / 2;
      const v = vnoise(x, y, 22) + (noise(x, y) / 1023 - 0.5) * 0.25, e = hollow(x, y);
      const wet = creek(x);
      if (e < 1) col.lerpColors(mud[0], mud[1], 1 - e);
      else if (wet) col.copy(mud[1]);
      else if (lane(x, y)) col.copy(dirt[v < 0.4 ? 0 : v < 0.75 ? 1 : 2]);
      else col.copy(greens[v < 0.36 ? 0 : v < 0.68 ? 1 : 2]);
      colors.set([col.r, col.g, col.b], i * 3);
      pos.setY(i, e < 1 ? WATER.y - 0.02 - WATER.deep * (1 - e ** 3) : wet ? WATER.y - 0.25 : lane(x, y) ? 0 : flat(x, y) ? 0.03 : 0.03 + (noise(x + 5, y + 9) / 1023) * 0.12);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.translate(c0.x, 0, c0.z);
    geo.computeVertexNormals();
    const grass = new THREE.Mesh(geo, mats.std('#ffffff', { vertexColors: true, roughness: 1 }));
    grass.receiveShadow = true;
    g.add(grass);

    // the pond: clear water over its hollow (deeper blue at the edge, lighter in the middle), a sandy bank round it; ice
    // in winter. Its lily pads, frog and fish are build/animals.js's.
    const p = toWorld(POND.cx, POND.cy, H), rx = POND.rx / PX, rz = POND.ry / PX;
    {
      const bank = [], idx = [], n = 48;
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        bank.push(c * rx * 0.96, 0, sn * rz * 0.92, c * (rx + 0.5), 0, sn * (rz + 0.5));
        if (k < n) idx.push(2 * k, 2 * k + 2, 2 * k + 1, 2 * k + 1, 2 * k + 2, 2 * k + 3);
      }
      const ring = new THREE.BufferGeometry();
      ring.setAttribute('position', new THREE.Float32BufferAttribute(bank, 3));
      ring.setIndex(idx);
      ring.computeVertexNormals();
      const sand = new THREE.Mesh(ring, mats.std('#c9a46a', { side: THREE.DoubleSide }));
      sand.position.set(p.x, WATER.y + 0.004, p.z);
      sand.receiveShadow = true;
      g.add(sand);
    }
    if (S.snow) {
      const disc = (y, color, k) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.08, 40), color); m.scale.set(rx * k, 1, rz * k); m.position.set(p.x, y, p.z); m.receiveShadow = true; g.add(m); };
      disc(WATER.y + 0.01, mats.std('#cfe6f2', { roughness: 0.3 }), 1);
      disc(WATER.y + 0.015, mats.std('#e6f3fa', { roughness: 0.2 }), 0.6);
    } else {
      const surface = new THREE.CircleGeometry(1, 48), deep = new THREE.Color('#3d7be0'), light = new THREE.Color('#7cc4ff');
      surface.rotateX(-Math.PI / 2);
      const sc = new Float32Array(surface.attributes.position.count * 3);
      for (let k = 0; k < surface.attributes.position.count; k++) (k === 0 ? light : deep).toArray(sc, k * 3); // the middle vertex first
      surface.setAttribute('color', new THREE.BufferAttribute(sc, 3));
      const water = new THREE.Mesh(surface, mats.std('#ffffff', { vertexColors: true, opacity: 0.42, roughness: 0.2, flat: false }));
      water.scale.set(rx, 1, rz);
      water.position.set(p.x, WATER.y, p.z);
      water.receiveShadow = true;
      g.add(water);
    }

    // the creek between the farms (a neighbour's only): its water, running on north and south past the farm into the
    // forest; the road to town past the farm the same way; stepping stones across the creek at the forest's edge
    if (land.ox) {
      const a = toWorld(CREEK.x0, 0, H), b = toWorld(CREEK.x1, 0, H), long = d + 400;
      const strip = new THREE.PlaneGeometry(b.x - a.x, long);
      strip.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(strip, S.snow ? mats.std('#cfe6f2', { roughness: 0.3 }) : mats.std('#3d7be0', { opacity: 0.55, roughness: 0.2 })); // ice in winter
      water.position.set((a.x + b.x) / 2, S.snow ? WATER.y + 0.01 : WATER.y, c0.z);
      water.receiveShadow = true;
      g.add(water);
      const r0 = toWorld(ROAD.x0, ext.y0, H), r1 = toWorld(ROAD.x1, ext.y1, H), rw = r1.x - r0.x, out = 200;
      const road = new THREE.BufferGeometry(), quads = [[r0.z - out, r0.z], [r1.z, r1.z + out]], vs = [], idx = [];
      quads.forEach(([z0, z1], k) => { vs.push(r0.x, 0, z0, r0.x + rw, 0, z0, r0.x, 0, z1, r0.x + rw, 0, z1); idx.push(k * 4, k * 4 + 2, k * 4 + 1, k * 4 + 1, k * 4 + 2, k * 4 + 3); });
      road.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
      road.setIndex(idx);
      road.computeVertexNormals();
      const roadMesh = new THREE.Mesh(road, mats.std('#c9a46a', { roughness: 1 }));
      roadMesh.position.y = 0.005;
      roadMesh.receiveShadow = true;
      g.add(roadMesh);
      const [s0, s1] = crossingsOf(ground).stones, sy = (s0 + s1) / 2, n = 5;
      const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.35, 0), mats.std(S.snow ? '#dfe9f2' : '#8c96a0'), n);
      const m4s = new THREE.Matrix4(), qs = new THREE.Quaternion(), ups = new THREE.Vector3(0, 1, 0);
      for (let k = 0; k < n; k++) {
        const t = toWorld(CREEK.x0 + ((k + 0.5) * (CREEK.x1 - CREEK.x0)) / n, sy + (k % 2 ? 3 : -3), H);
        stones.setMatrixAt(k, m4s.compose(new THREE.Vector3(t.x, WATER.y + 0.05, t.z), qs.setFromAxisAngle(ups, k * 1.3), new THREE.Vector3(1, 0.45, 1)));
      }
      stones.castShadow = stones.receiveShadow = true;
      g.add(stones);
    }

    // the forest: round trees just past the land's edges (layout.js's forestOf)
    const trees = forestOf(H, land.w);
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
    g.userData.forest = [trunks, crowns]; // stand-ins until build/nature.js has drawn the forest

    // more forest past the farm's own, out to 160 m, thinning, with clearings; too far for shadows
    {
      const spots = [], half = 160, inner = { x: w / 2 + 2, z: d / 2 + 2 };
      const lo = toWorld(ROAD.x0 - 12, 0, H).x, hi = toWorld(CREEK.x1 + 12, 0, H).x; // the road and the creek run on through it
      for (let gz = -half; gz <= half; gz += 6) for (let gx = -half; gx <= half; gx += 6) {
        const n = noise(gx + 1000, gz + 2000), x = c0.x + gx + (n % 7) - 3, z = c0.z + gz + ((n >> 3) % 7) - 3;
        if (Math.abs(x - c0.x) < inner.x && Math.abs(z - c0.z) < inner.z) continue;
        const out = Math.max(Math.abs(x - c0.x) - inner.x, Math.abs(z - c0.z) - inner.z); // metres past the farm's edge
        if (n % 100 < (out < 30 ? 8 : out < 80 ? 30 : 55)) continue; // thinner further out
        if (vnoise(x, z, 40) < 0.22) continue; // a clearing
        if (land.ox && x > lo - 1.5 && x < hi + 1.5) continue;
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
        if (n < 212 && n >= 200 && !lane(x, y) && !flat(x, y) && !creek(x)) spots.push([x + (n % 4), y, n]);
      }
      const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 0), mats.std('#ffffff'), spots.length);
      spots.forEach(([x, y, n], i) => { const t = toWorld(x, y, H); flowers.setMatrixAt(i, m4.makeTranslation(t.x, 0.14, t.z)); flowers.setColorAt(i, new THREE.Color(S.flowers[n % S.flowers.length])); });
      g.add(flowers);
    }
    group.add(g);
    built = g;
    return { x: w / 2, z: d / 2, center: c0 };
  }
  return {
    group, build,
    /** Shows or hides the ball trees (they stand in until the forest's models are drawn). */
    setForest(on) { for (const m of built?.userData.forest ?? []) m.visible = on; },
    dispose: () => { if (built) disposeTree(built); built = null; },
  };
}
