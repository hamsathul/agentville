// The 3D farm's machines, a field's season, the bigger farm and its real crops (spec 2026-10-14-farm3d-machines):
// the model script's readers (zip, PNG) and the texture baking, the crops instancer, `writes`, the season, and the
// machines' rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';
import { readPng } from '../../scripts/lib/png.mjs';
import { readZip } from '../../scripts/lib/unzip.mjs';
import { bakeTexture } from '../../scripts/lib/glb.mjs';

// A 2 × 1 RGBA PNG made here: red, then blue.
function png2x1() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.from([1, 255, 0, 0, 255, 1, 0, 255, 0]); // filter 1 (Sub): the second pixel is blue minus red, wrapped (0 - 255 = 1)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A 1 × 1 RGBA PNG of one colour (its row unfiltered).
function png1x1(rgba) {
  const good = png2x1(), at = good.indexOf('IDAT') - 4, ihdr = good.subarray(0, at), data = deflateSync(Buffer.from([0, ...rgba]));
  const w = Buffer.from(ihdr); w.writeUInt32BE(1, 16); w.writeUInt32BE(crc32(w.subarray(12, 29)), 29); // width 1, and the header's checksum again
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from('IDAT'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([w, len, td, crc, good.subarray(good.indexOf('IEND') - 4)]);
}
// A zip of [name, data, method (0 stored, 8 deflated)] entries.
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data, method] of entries) {
    const body = method === 8 ? deflateRawSync(data) : data, n = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    locals.push(local, n, body);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
// A glTF of one triangle whose UVs all sit at (u, v), its texture image 0; and its COLOR_0 read back.
function triangleWithUv([u, v]) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), uv = new Float32Array([u, v, u, v, u, v]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(uv.buffer)]);
  const json = {
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ name: 'colormap', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ uri: 'Textures/colormap.png' }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  };
  return { json, bin };
}
function colorsOf({ json, bin }) {
  const a = json.accessors[json.meshes[0].primitives[0].attributes.COLOR_0], bv = json.bufferViews[a.bufferView];
  const n = a.count * (a.type === 'VEC4' ? 4 : 3), at = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const [Kind, norm] = { 5121: [Uint8Array, 255], 5123: [Uint16Array, 65535], 5126: [Float32Array, 1] }[a.componentType];
  return [...new Kind(bin.buffer.slice(at, at + n * Kind.BYTES_PER_ELEMENT))].map(x => (x / norm) * 255);
}

test('png: an RGBA image read back pixel for pixel (its rows unfiltered)', () => {
  const p = readPng(png2x1());
  assert.deepEqual([p.width, p.height, [...p.rgba]], [2, 1, [255, 0, 0, 255, 0, 0, 255, 255]]);
});
test('unzip: a stored and a deflated entry read back by name', () => {
  const files = readZip(makeZip([['a.txt', Buffer.from('hello'), 0], ['dir/b.bin', Buffer.from('world world world'), 8]]));
  assert.equal(files.get('a.txt').toString(), 'hello');
  assert.equal(files.get('dir/b.bin').toString(), 'world world world');
});
test("bake: a face takes the colour its texture coordinates point at; the texture goes", () => {
  const out = bakeTexture(triangleWithUv([0.75, 0.5]), readPng(png2x1()));
  assert.deepEqual(colorsOf(out).slice(0, 3).map(Math.round), [0, 0, 255]);
  assert.equal(out.json.images, undefined);
  assert.equal(out.json.textures, undefined);
  assert.equal(out.json.materials[0].pbrMetallicRoughness.baseColorTexture, undefined);
  assert.deepEqual(colorsOf(bakeTexture(triangleWithUv([0.25, 0.5]), readPng(png2x1()))).slice(0, 3).map(Math.round), [255, 0, 0]);
});
test("bake: the colours are glTF's, linear: a texel's sRGB is undone (so a mid grey isn't drawn pale), finely enough for the darks", () => {
  const out = colorsOf(bakeTexture(triangleWithUv([0.5, 0.5]), readPng(png1x1([128, 54, 13, 255])))).slice(0, 3);
  const linear = v => 255 * ((v / 255 + 0.055) / 1.055) ** 2.4;
  [128, 54, 13].forEach((v, i) => assert.ok(Math.abs(out[i] - (v <= 10 ? v / 12.92 : linear(v))) < 0.05, `${v} → ${out[i]}`));
});

/* ---------- the crops instancer (build/crops.js) ---------- */
const THREE = await import('../../web/worlds/farm3d/vendor/three.module.js');
const { makeCrops } = await import('../../web/worlds/farm3d/build/crops.js');
const { makeMaterials } = await import('../../web/worlds/farm3d/build/materials.js');
/** A bed of 6 × 12 plants of one crop at one stage, as beds.js lists them. */
const bedOf = (crop, stage) => Array.from({ length: 72 }, (_, n) => ({ crop, stage, x: (n % 12) * 1.5, z: Math.floor(n / 12) * 1.5, y: 0.12, busy: false, seed: n * 0.37 }));
const settle = () => new Promise(r => setTimeout(r, 0));

test("crops: once its model loads, a bed of corn is one InstancedMesh per part of the model, 72 plants in it; the code-built corn until then", async () => {
  const geometry = new THREE.BoxGeometry(0.2, 1, 0.2).translate(0, 0.5, 0);
  const load = kind => Promise.resolve({ parts: [{ geometry, color: '#6f9a4a', name: 'Green' }], box: { min: { x: -0.1, y: 0, z: -0.1 }, max: { x: 0.1, y: 1, z: 0.1 } } });
  const crops = makeCrops(THREE, makeMaterials(THREE), { load });
  crops.sync(bedOf('corn', 3));
  assert.deepEqual(crops.stats(), { corn: { code: 72, model: 0 } }, 'the code-built corn stands in');
  await settle();
  const meshes = crops.group.children.filter(m => m.isInstancedMesh && m.count > 0);
  const own = meshes.filter(m => m.geometry === geometry);
  assert.equal(own.length, 1, 'one InstancedMesh for the model part');
  assert.equal(own[0].count, 72);
  assert.deepEqual(crops.stats(), { corn: { code: 0, model: 72 } });
  assert.ok(meshes.every(m => m.geometry === geometry), 'the code-built corn is gone');
  crops.dispose();
});

test("crops: the seeds and sprouts (stages 0 and 1) and the sunflower stay code-built; a model that fails keeps the code-built crop", async () => {
  const asked = [];
  const crops = makeCrops(THREE, makeMaterials(THREE), { load: kind => { asked.push(kind); return Promise.reject(new Error('no model')); } });
  crops.sync([...bedOf('wheat', 0), ...bedOf('carrot', 1), ...bedOf('sunflower', 5), ...bedOf('pumpkin', 5)]);
  await settle(); await settle();
  assert.deepEqual(asked, ['pumpkin']);
  assert.deepEqual(crops.stats(), { wheat: { code: 72, model: 0 }, carrot: { code: 72, model: 0 }, sunflower: { code: 72, model: 0 }, pumpkin: { code: 72, model: 0 } });
  crops.dispose();
});

/* ---------- the machines' paint (coats.js) ---------- */
const { PAINT, paintClass, repaint } = await import('../../web/worlds/farm3d/coats.js');
const hex = rgb => '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');

test("paint: the Car Kit's colours sorted by what they look like: its blue-grey paint, a tyre's dark grey, near white; a lamp or a stripe is none of them", () => {
  for (const c of ['#7d829c', '#65657a', '#888899', '#aabbdd']) assert.equal(paintClass([1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))), 'paint', c);
  for (const c of ['#36363a', '#444444', '#333344']) assert.equal(paintClass([1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))), 'tyre', c);
  for (const c of ['#e0e0eb', '#ffffff', '#ddddee']) assert.equal(paintClass([1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))), 'pale', c);
  for (const c of ['#ff9832', '#ffcf60', '#33aa77', '#dd3333']) assert.equal(paintClass([1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))), null, c);
});

test("paint: a red tractor with cream wheels and dark tyres, a green flatbed; each shade kept (a darker grey paints a darker red); its lamps its own", () => {
  const body = repaint('tractor', 'body', [0x7d, 0x82, 0x9c]), darker = repaint('tractor', 'body', [0x65, 0x65, 0x7a]);
  assert.ok(body[0] > 150 && body[1] < 100 && body[2] < 90, `the tractor is red: ${hex(body)}`);
  assert.ok(darker[0] < body[0], `a darker shade: ${hex(darker)} < ${hex(body)}`);
  const rim = repaint('tractor', 'wheel-front-left', [0x77, 0x88, 0x99]);
  assert.ok(rim.every(x => x > 200), `cream rims: ${hex(rim)}`);
  assert.ok(repaint('tractor', 'wheel-back-right', [0x36, 0x36, 0x3a]).every(x => x < 0x40), 'dark tyres');
  assert.deepEqual(repaint('tractor', 'body', [0xff, 0x98, 0x32]), [0xff, 0x98, 0x32], 'a lamp is its own');
  const truck = repaint('truckflat', 'body', [0x7d, 0x82, 0x9c]);
  assert.ok(truck[1] > truck[0] && truck[1] > truck[2], `the flatbed is green: ${hex(truck)}`);
  assert.deepEqual(repaint('cow', 'body', [0x7d, 0x82, 0x9c]), [0x7d, 0x82, 0x9c], 'only the machines');
});

test("paint: every machine has its paint, each part by the start of a node the model has", async () => {
  const { MODELS } = await import('../../web/worlds/farm3d/models/index.js');
  const { readGlb } = await import('../../scripts/lib/glb.mjs');
  const vehicles = Object.entries(MODELS).filter(([, m]) => m.family === 'vehicle').map(([k]) => k);
  assert.deepEqual(Object.keys(PAINT).sort(), vehicles.sort());
  for (const kind of vehicles) {
    const { json } = readGlb(Buffer.from((await import(`../../web/worlds/farm3d/models/${kind}.js`)).default, 'base64'));
    for (const part of Object.keys(PAINT[kind])) assert.ok(json.nodes.some(n => n.name?.startsWith(part)), `${kind}: a node for "${part}"`);
    for (const [part, to] of Object.entries(PAINT[kind])) for (const [cls, c] of Object.entries(to)) {
      assert.ok(['paint', 'tyre', 'pale'].includes(cls), `${kind} ${part}: ${cls}`);
      assert.match(c, /^#[0-9a-f]{6}$/, `${kind} ${part} ${cls}`);
    }
  }
});

/* ---------- writes, from the scene to the 3D farm's farmers (web/scene.js, model.js) ---------- */
const { kit, toScene, snap, agent, repo, NOW: TOUR_NOW, HOME } = await import('./farm3d-vm.mjs');
const { makeModel } = await import('../../web/worlds/farm3d/model.js');

test("writes: a farmer carries how many files its agent wrote in the last 5 minutes, a big edit's size", () => {
  const wrote = n => Array.from({ length: n }, (_, k) => ({ path: `${HOME}/shop/f${k}.ts`, mode: 'write', lastAt: TOUR_NOW - 1000, firstAt: TOUR_NOW - 1000, repo: `${HOME}/shop` }));
  const m = makeModel(kit).farmModel(toScene(snap([agent('a1', { touching: wrote(6) }), agent('a2')], [repo('shop')])));
  assert.deepEqual(m.farmers.map(f => [f.id, f.writes]).sort(), [['a1', 6], ['a2', 0]]);
});

/* ---------- a field's season (season.js) ---------- */
const { createSeasons, IDLE_FALLOW_MS } = await import('../../web/worlds/farm3d/season.js');
const { touch } = await import('./farm3d-vm.mjs');
const M3 = makeModel(kit), shop = `${HOME}/shop`;
const fm = (over, state = 'working') => M3.farmModel(toScene(snap([agent('a1', { state, touching: [touch(shop)], ...over })], [repo('shop')])));
const step = (tool, s) => ({ now: { tool, step: s, summary: 'x', startedAt: TOUR_NOW } });
const READ = step('Read', 'read'), EDIT = step('Edit', 'edit'), TEST = step('Bash', 'test');

test("a field's season: ploughed when an agent starts, sown on its first write, growing, sprayed in tests, ripe, cut at a compaction and sown again, weeds after 30 idle minutes, dry when stale", () => {
  const s = createSeasons(), key = shop, at = ms => TOUR_NOW + ms;
  s.update(fm({}, 'idle'), at(0));
  assert.equal(s.lookOf(key).stage, 'fallow');
  s.update(fm({ ...READ, contextTokens: 10_000 }), at(1e3));
  assert.equal(s.lookOf(key).stage, 'ploughed');
  assert.equal(s.lookOf(key).ploughedRows, 6, 'ploughed (no plough passing: all its rows furrowed)');
  s.update(fm({ ...EDIT, contextTokens: 10_000 }), at(2e3));
  assert.equal(s.lookOf(key).stage, 'sown');
  s.update(fm({ ...EDIT, contextTokens: 120_000 }), at(3e3));
  assert.deepEqual([s.lookOf(key).stage, s.lookOf(key).growth, s.lookOf(key).sprayed], ['growing', 3, false]);
  s.update(fm({ ...TEST, contextTokens: 120_000 }), at(4e3));
  assert.equal(s.lookOf(key).sprayed, true);
  s.update(fm({ ...EDIT, contextTokens: 195_000 }), at(5e3));
  assert.deepEqual([s.lookOf(key).stage, s.lookOf(key).sprayed], ['ripe', false]);
  s.update(fm({ ...EDIT, contextTokens: 10_000, compactions: 1 }), at(6e3));
  assert.deepEqual([s.lookOf(key).stage, s.lookOf(key).cutRows, s.lookOf(key).growth], ['cut', 0, 5], 'the rows not yet cut stay ripe');
  s.cut(key, 3);
  assert.equal(s.lookOf(key).cutRows, 3, 'row by row as the combine passes');
  s.update(fm({ ...EDIT, contextTokens: 10_000, compactions: 1 }), at(10e3));
  assert.equal(s.lookOf(key).stage, 'cut', 'still being cut');
  s.cut(key, 6);
  s.update(fm({ ...EDIT, contextTokens: 10_000, compactions: 1 }), at(12e3));
  assert.equal(s.lookOf(key).stage, 'sown', 'sown again once cut');
  s.update(fm({}, 'idle'), at(13e3));
  assert.equal(s.lookOf(key).stage, 'sown', 'a moment idle changes nothing');
  s.update(fm({}, 'idle'), at(13e3 + IDLE_FALLOW_MS));
  assert.equal(s.lookOf(key).stage, 'fallow', 'weeds after 30 idle minutes');
  s.update(fm({}, 'stale'), at(14e3 + IDLE_FALLOW_MS));
  assert.equal(s.lookOf(key).stage, 'dry');
});

test("a field's season: a field already growing when the page opens grows on (no ploughing replayed); a field a new agent opens later is ploughed first", () => {
  const s = createSeasons();
  s.update(fm({ ...EDIT, contextTokens: 120_000 }), TOUR_NOW);
  assert.deepEqual([s.lookOf(shop).stage, s.lookOf(shop).ploughedRows], ['growing', 6]);
  const two = (blogOver) => M3.farmModel(toScene(snap([agent('a1', { ...EDIT, contextTokens: 120_000, touching: [touch(shop)] }), agent('a2', { cwd: `${HOME}/blog`, touching: [touch(`${HOME}/blog`)], ...blogOver })], [repo('shop'), repo('blog')])));
  s.update(two({ ...READ, contextTokens: 120_000 }), TOUR_NOW + 1e3);
  assert.equal(s.lookOf(`${HOME}/blog`).stage, 'ploughed');
});

test("a field's season: a compaction cuts it even if no combine comes (Motion off, no machine): after 30 s it is sown again", () => {
  const s = createSeasons();
  s.update(fm({ ...EDIT, contextTokens: 195_000 }), TOUR_NOW);
  s.update(fm({ ...EDIT, contextTokens: 10_000, compactions: 1 }), TOUR_NOW + 1e3);
  assert.equal(s.lookOf(shop).stage, 'cut');
  s.update(fm({ ...EDIT, contextTokens: 10_000, compactions: 1 }), TOUR_NOW + 32e3);
  assert.equal(s.lookOf(shop).stage, 'sown');
});

test("a field's season: a plough passing furrows it row by row (the rest as it was), and its drill sows: six rows sow the field", () => {
  const s = createSeasons();
  s.update(fm({}, 'idle'), TOUR_NOW);
  s.update(fm({ ...READ, contextTokens: 10_000 }), TOUR_NOW + 1e3);
  s.plough(shop, 4);
  assert.deepEqual([s.lookOf(shop).stage, s.lookOf(shop).ploughedRows], ['ploughed', 4]);
  s.plough(shop, 6);
  s.update(fm({ ...READ, contextTokens: 10_000 }), TOUR_NOW + 2e3);
  assert.equal(s.lookOf(shop).stage, 'sown');
});

test("a field's season: a field gone from the farm is forgotten; an unknown field has no look", () => {
  const s = createSeasons();
  s.update(fm({ ...EDIT }), TOUR_NOW);
  s.update(M3.farmModel(toScene(snap([], []))), TOUR_NOW + 1e3);
  assert.equal(s.lookOf(shop), null);
  s.cut(shop, 6); s.plough(shop, 6); // nothing to do: no throw
});

const { rowsOf } = await import('../../web/worlds/farm3d/season.js');
test("a bed's rows for its season: furrows, seeds, the crop, stubble behind the combine, the plough's furrows and seeds behind it, weeds, dry; wet while sprayed", () => {
  const bed = (kind, stage = 0) => ({ crop: 'corn', plot: { kind, stage } });
  const look = (stage, over = {}) => ({ stage, growth: 3, sprayed: false, cutRows: 0, ploughedRows: 6, ...over });
  const kinds = rows => rows.map(r => `${r.furrow ? 'F' : '-'}${r.plants ?? '.'}${r.plants === 'crop' ? r.stage : ''}${r.wet ? 'w' : ''}`).join(' ');
  assert.equal(kinds(rowsOf(bed('grow', 2), null)), '-crop2 -crop2 -crop2 -crop2 -crop2 -crop2', 'no look: the plot, as before');
  assert.equal(kinds(rowsOf(bed('bare'), null)), '-weeds -weeds -weeds -weeds -weeds -weeds');
  assert.equal(kinds(rowsOf(bed('bare'), look('fallow'))), '-weeds -weeds -weeds -weeds -weeds -weeds');
  assert.equal(kinds(rowsOf(bed('grow'), look('ploughed'))), 'F. F. F. F. F. F.');
  assert.equal(kinds(rowsOf(bed('grow'), look('sown'))), 'Fseeds Fseeds Fseeds Fseeds Fseeds Fseeds');
  assert.equal(kinds(rowsOf(bed('grow', 3), look('growing'))), '-crop3 -crop3 -crop3 -crop3 -crop3 -crop3');
  assert.equal(kinds(rowsOf(bed('grow', 3), look('growing', { sprayed: true }))), '-crop3w -crop3w -crop3w -crop3w -crop3w -crop3w');
  assert.equal(kinds(rowsOf(bed('grow', 3), look('growing', { ploughedRows: 2 }))), 'Fseeds Fseeds -crop3 -crop3 -crop3 -crop3', 'the plough passing');
  assert.equal(kinds(rowsOf(bed('grow', 0), look('cut', { growth: 5, cutRows: 4 }))), '-stubble -stubble -stubble -stubble -crop5 -crop5', 'the combine passing');
  assert.equal(kinds(rowsOf(bed('dry'), look('dry'))), '-dry -dry -dry -dry -dry -dry');
});

test("crops: sprayed plants are wet, darker and glossier, in their own InstancedMeshes; stubble is short pale stalks", () => {
  const crops = makeCrops(THREE, makeMaterials(THREE));
  const half = bedOf('corn', 3).map((p, n) => ({ ...p, wet: n < 36 }));
  crops.sync(half);
  const live = crops.group.children.filter(m => m.isInstancedMesh && m.count > 0);
  const wet = live.filter(m => m.material.roughness < 0.5), dry = live.filter(m => m.material.roughness >= 0.5);
  assert.ok(wet.length && wet.length === dry.length, `${wet.length} wet parts, ${dry.length} dry`);
  assert.ok(wet.every(m => m.count === 36) && dry.every(m => m.count === 36));
  const lum = c => c.r + c.g + c.b;
  for (const w of wet) {
    const d = dry.find(m => m.geometry === w.geometry && m.userData.part === w.userData.part);
    assert.ok(d && lum(w.material.color) < lum(d.material.color), 'darker');
  }
  crops.sync(bedOf('stubble', 0));
  const stubble = crops.group.children.filter(m => m.isInstancedMesh && m.count > 0);
  assert.ok(stubble.length >= 1 && stubble.every(m => m.count === 72));
  const box = new THREE.Box3();
  for (const m of stubble) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.userData.part.m)); }
  assert.ok(box.max.y < 0.3, `short: ${box.max.y.toFixed(2)} m`);
  crops.dispose();
});
