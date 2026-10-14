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
