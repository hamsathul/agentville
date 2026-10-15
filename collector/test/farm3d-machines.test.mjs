// The 3D farm's machines, a field's season, the bigger farm and its real crops (spec 2026-10-14-farm3d-machines):
// the model script's readers (zip, PNG) and the texture baking, the crops instancer, `writes`, the season, and the
// machines' rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';
import { readPng } from '../../scripts/lib/png.mjs';
import { readZip } from '../../scripts/lib/unzip.mjs';
import { bakeTexture, readGlb, trimGlb } from '../../scripts/lib/glb.mjs';
import * as THREE from '../../web/worlds/farm3d/vendor/three.module.js';
import { makeCrops } from '../../web/worlds/farm3d/build/crops.js';
import { makeMaterials } from '../../web/worlds/farm3d/build/materials.js';
import { PAINT, paintClass, repaint } from '../../web/worlds/farm3d/coats.js';
import { MODELS } from '../../web/worlds/farm3d/models/index.js';
import { makeModel } from '../../web/worlds/farm3d/model.js';
import { IDLE_FALLOW_MS, createSeasons, rowsOf } from '../../web/worlds/farm3d/season.js';
import { BIG_EDIT, HOLD_S, TOWN_END, VEHICLE, createMachines, crewActions, isAhead, machineFor, machinesDialog, passesFor, routeBetween, STALL_SPOT } from '../../web/worlds/farm3d/machines.js';
import { BED, CART_RANK, CORR, GRID_CONFIG, LANE, SHED_DOOR, STALL, W } from '../../web/worlds/farm3d/layout.js';
import { HOME, NOW as TOUR_NOW, agent, kit, repo, snap, toScene, touch } from './farm3d-vm.mjs';

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
test('bake: each mesh keeps its own colours (two meshes, one red and one blue, packed one after the other)', async () => {
  const a = triangleWithUv([0.25, 0.5]), b = triangleWithUv([0.75, 0.5]);
  const off = a.bin.length, json = structuredClone(a.json);
  json.bufferViews.push(...b.json.bufferViews.map(v => ({ ...v, byteOffset: v.byteOffset + off })));
  json.accessors.push(...b.json.accessors.map(x => ({ ...x, bufferView: x.bufferView + 2 })));
  json.meshes.push({ primitives: [{ attributes: { POSITION: 2, TEXCOORD_0: 3 }, material: 0 }] });
  json.nodes.push({ mesh: 1 }); json.scenes[0].nodes.push(1);
  const bin = Buffer.concat([a.bin, b.bin]);
  json.buffers = [{ byteLength: bin.length }];
  const back = readGlb(trimGlb(bakeTexture({ json, bin }, readPng(png2x1())), [])); // baked, then packed as the model script does
  const colourOf = m => { const g = { json: back.json, bin: back.bin }, j2 = structuredClone(g.json); j2.meshes = [g.json.meshes[m]]; return colorsOf({ json: j2, bin: g.bin }).slice(0, 3).map(Math.round); };
  assert.deepEqual([colourOf(0), colourOf(1)], [[255, 0, 0], [0, 0, 255]]);
});
test("bake: the colours are glTF's, linear: a texel's sRGB is undone (so a mid grey isn't drawn pale), finely enough for the darks", () => {
  const out = colorsOf(bakeTexture(triangleWithUv([0.5, 0.5]), readPng(png1x1([128, 54, 13, 255])))).slice(0, 3);
  const linear = v => 255 * ((v / 255 + 0.055) / 1.055) ** 2.4;
  [128, 54, 13].forEach((v, i) => assert.ok(Math.abs(out[i] - (v <= 10 ? v / 12.92 : linear(v))) < 0.05, `${v} → ${out[i]}`));
});

/* ---------- the crops instancer (build/crops.js) ---------- */
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

test("writes: a farmer carries how many files its agent wrote in the last 5 minutes, a big edit's size", () => {
  const wrote = n => Array.from({ length: n }, (_, k) => ({ path: `${HOME}/shop/f${k}.ts`, mode: 'write', lastAt: TOUR_NOW - 1000, firstAt: TOUR_NOW - 1000, repo: `${HOME}/shop` }));
  const m = makeModel(kit).farmModel(toScene(snap([agent('a1', { touching: wrote(6) }), agent('a2')], [repo('shop')])));
  assert.deepEqual(m.farmers.map(f => [f.id, f.writes]).sort(), [['a1', 6], ['a2', 0]]);
});

/* ---------- a field's season (season.js) ---------- */
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
  assert.equal(s.lookOf(key).ploughed, 0, 'no plough has passed (the season alone furrows it)');
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
  assert.deepEqual([s.lookOf(shop).stage, s.lookOf(shop).ploughed], ['growing', 0]);
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

test("a field's season: a plough marks the rows it has passed, whichever they are and in whatever order; its drill sows the field once all six are turned; a harvest or 30 idle minutes clears them", () => {
  const s = createSeasons();
  s.update(fm({}, 'idle'), TOUR_NOW);
  s.update(fm({ ...READ, contextTokens: 10_000 }), TOUR_NOW + 1e3);
  assert.equal(s.plough(shop, [5, 4]), true, 'changed');
  assert.equal(s.plough(shop, [4]), false, 'the same again: no change');
  assert.deepEqual([s.lookOf(shop).stage, s.lookOf(shop).ploughed], ['ploughed', 0b110000]);
  s.plough(shop, [0, 1, 2, 3]);
  s.update(fm({ ...READ, contextTokens: 10_000 }), TOUR_NOW + 2e3);
  assert.equal(s.lookOf(shop).stage, 'sown');
  s.update(fm({ ...EDIT, contextTokens: 195_000 }), TOUR_NOW + 3e3);
  s.update(fm({ ...EDIT, contextTokens: 10_000, compactions: 1 }), TOUR_NOW + 4e3);
  assert.equal(s.lookOf(shop).ploughed, 0, 'a harvest: a new season');
  s.plough(shop, [2]);
  s.update(fm({}, 'idle'), TOUR_NOW + 5e3 + IDLE_FALLOW_MS);
  assert.equal(s.lookOf(shop).ploughed, 0, 'fallow');
});

test("a field's season: a field gone from the farm is forgotten; an unknown field has no look", () => {
  const s = createSeasons();
  s.update(fm({ ...EDIT }), TOUR_NOW);
  s.update(M3.farmModel(toScene(snap([], []))), TOUR_NOW + 1e3);
  assert.equal(s.lookOf(shop), null);
  s.cut(shop, 6); s.plough(shop, [0, 1]); // nothing to do: no throw
});

test("a bed's rows for its season: furrows, seeds, the crop, stubble behind the combine, the plough's furrows and seeds behind it, weeds, dry; wet while sprayed", () => {
  const bed = (kind, stage = 0) => ({ crop: 'corn', plot: { kind, stage } });
  const look = (stage, over = {}) => ({ stage, growth: 3, sprayed: false, cutRows: 0, ploughed: 0, ...over });
  const kinds = rows => rows.map(r => `${r.furrow ? 'F' : '-'}${r.plants ?? '.'}${r.plants === 'crop' ? r.stage : ''}${r.wet ? 'w' : ''}`).join(' ');
  assert.equal(kinds(rowsOf(bed('grow', 2), null)), '-crop2 -crop2 -crop2 -crop2 -crop2 -crop2', 'no look: the plot, as before');
  assert.equal(kinds(rowsOf(bed('bare'), null)), '-weeds -weeds -weeds -weeds -weeds -weeds');
  assert.equal(kinds(rowsOf(bed('bare'), look('fallow'))), '-weeds -weeds -weeds -weeds -weeds -weeds');
  assert.equal(kinds(rowsOf(bed('grow'), look('ploughed'))), 'F. F. F. F. F. F.');
  assert.equal(kinds(rowsOf(bed('grow'), look('sown'))), 'Fseeds Fseeds Fseeds Fseeds Fseeds Fseeds');
  assert.equal(kinds(rowsOf(bed('grow', 3), look('growing'))), '-crop3 -crop3 -crop3 -crop3 -crop3 -crop3');
  assert.equal(kinds(rowsOf(bed('grow', 3), look('growing', { sprayed: true }))), '-crop3w -crop3w -crop3w -crop3w -crop3w -crop3w');
  assert.equal(kinds(rowsOf(bed('grow', 3), look('growing', { ploughed: 0b100100 }))), '-crop3 -crop3 Fcrop3 -crop3 -crop3 Fcrop3', 'the plough passing: turned soil under the crop on the rows it passed, no crop lost'); 
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

/* ---------- the machines' rules (machines.js) ---------- */

test('which machine: tests, builds, installs, pushes, deploys and big edits; the rest by hand', () => {
  const f = (step, writes = 0, state = 'working') => machineFor({ state, step, writes, field: '/r' });
  assert.deepEqual(['test', 'build', 'install', 'push', 'deploy'].map(s => f(s)), ['sprayer', 'mower', 'supplies', 'crates', 'truck']);
  assert.equal(f('edit', BIG_EDIT), 'plough');
  assert.equal(f('write', 9), 'plough');
  assert.equal(f('edit', BIG_EDIT - 1), null);
  for (const s of ['read', 'search', 'web', 'mcp', 'plan', 'commit', 'lint', 'delete', 'shell', null]) assert.equal(f(s, 99), null, String(s));
  assert.equal(f('test', 0, 'waiting'), null);
  assert.equal(machineFor({ state: 'working', step: 'test', writes: 0, field: null }), null, 'no field (the meadow): by hand');
  assert.deepEqual(VEHICLE, { plough: 'tractor', sprayer: 'tractor', mower: 'tractor', supplies: 'tractor', crates: 'tractor', truck: 'truck', combine: 'combine' });
});

const bedAt = (c, r = 0) => { const cx = GRID_CONFIG.cx0 + c * GRID_CONFIG.colW, rowTop = GRID_CONFIG.top0 + r * GRID_CONFIG.rowH, s = GRID_CONFIG.slot(cx, rowTop); return { key: `/r/c${c}r${r}`, ...s, cx, rowTop, w: BED.w, d: BED.d }; };
const inside = (b, y) => y > b.y0 && y < b.y0 + BED.d;
test("a bed's passes cover it row by row, U-turning outside its ends, entering from the walkway side; two farmers take alternate passes, three share none", () => {
  const b1 = bedAt(1), p = passesFor(b1, 1, 0), ys = [...new Set(p.map(q => q[1]))].filter(y => inside(b1, y));
  assert.equal(ys.length, 6);
  assert.ok(p[0][0] < b1.x0, 'column 1 enters from the left');
  assert.ok(passesFor(bedAt(0), 1, 0)[0][0] > bedAt(0).x0 + BED.w, 'column 0 from the right');
  assert.ok(passesFor(bedAt(2), 1, 0)[0][0] < bedAt(2).x0, 'column 2 from the left');
  for (const [x] of p) assert.ok(x === b1.x0 - 12 || x === b1.x0 + BED.w + 12, `${x}: U-turns 12 px outside the ends`);
  const rowsIn = q => new Set(q.map(([, y]) => y).filter(y => inside(b1, y)));
  const a = passesFor(b1, 2, 0), b = passesFor(b1, 2, 1);
  assert.equal([...rowsIn(a)].filter(y => rowsIn(b).has(y)).length, 0, 'no pass shared');
  assert.equal(rowsIn(a).size + rowsIn(b).size, 6, 'every row');
  const three = [0, 1, 2].map(k => passesFor(b1, 3, k));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.equal([...rowsIn(three[i])].filter(y => rowsIn(three[j]).has(y)).length, 0, `three: ${i} and ${j}`);
  assert.equal(new Set(three.map(q => q[0].join())).size, 3, 'three at-rest spots, none the same');
});

test('the way between the shed and a bed keeps to the lane and the walkways, never across a field', () => {
  const s = bedAt(0, 1), entry = passesFor(s, 1, 0)[0];
  const way = routeBetween(SHED_DOOR, entry);
  for (const [x, y] of way) assert.ok(y === LANE || CORR.includes(x) || y === entry[1], `${x},${y} on the lane, a walkway, or the bed's row`);
  assert.deepEqual(way.at(-1), entry);
  const back = routeBetween(entry, SHED_DOOR);
  for (const [x, y] of back) assert.ok(y === LANE || CORR.includes(x) || y === entry[1], `back: ${x},${y}`);
  assert.deepEqual(back.at(-1), SHED_DOOR);
  for (const [x, y] of routeBetween(SHED_DOOR, entry, { lane: LANE + 3 })) assert.ok(y === LANE + 3 || CORR.includes(x) || y === entry[1], `its half of the lane: ${x},${y}`);
});

/** A farm for the machines' tick: one bed, its farmer where the test puts it. */
function rig({ beds = [bedAt(1)], still = false } = {}) {
  const m = createMachines(), farmers = new Map(), boarded = new Set(), bedMap = new Map(beds.map(b => [b.key, b]));
  let blocked = () => false, t = 0;
  const ctx = () => ({ farmers, beds: bedMap, boarded: id => boarded.has(id), blocked: (...a) => blocked(...a), still, now: t });
  return {
    m, farmers, boarded, beds: bedMap,
    setBlocked: f => { blocked = f; },
    want: (list, comp = new Set()) => { // the farmers drawn are the ones in the scene
      for (const id of [...farmers.keys()]) if (!list.some(f => f.id === id)) farmers.delete(id);
      for (const f of list) farmers.set(f.id, { x: 0, y: 0, state: f.state, field: f.field });
      return m.want({ farmers: list }, t, comp);
    },
    run: (s, dt = 0.1) => { let items = []; for (let n = 0; n < Math.round(s / dt); n++) { t += dt; items = m.tick(dt, ctx()); } return items; },
    now: () => t,
  };
}
const worker = (id, step, field, over = {}) => ({ id, state: 'working', step, writes: 0, field, ...over });

test("the hold: a machine stays 20 s after its step; another tractor job swaps the implement; a compaction brings the combine, which works its field once", () => {
  const m = createMachines(), key = '/r/shop';
  const want = (nowS, step, writes = 0, comp = new Set()) => m.want({ farmers: [worker('a', step, key, { writes })] }, nowS, comp).get('a') ?? null;
  assert.equal(want(0, 'test').job, 'sprayer');
  assert.equal(want(5, 'read').job, 'sprayer', 'held');
  assert.equal(want(5 + HOLD_S + 1, 'read'), null, 'home after the hold');
  assert.equal(want(40, 'build').job, 'mower');
  assert.equal(want(41, 'install').job, 'supplies', 'a swap');
  assert.equal(want(42, 'edit', 1, new Set(['a'])).job, 'combine', 'a compaction: the combine');
  assert.equal(want(43, 'test').job, 'combine', 'the combine works its field once, whatever the steps');
  assert.equal(want(44, 'test').field, key);
});

test('a machine goes out when its farmer has boarded, works its passes in the field, and comes home and parks after the hold', () => {
  const r = rig(), b = [...r.beds.values()][0], id = 'a';
  r.want([worker(id, 'test', b.key)]);
  let [it] = r.run(0.5);
  assert.deepEqual([it.phase, it.driver, it.moving, it.x, it.y], ['walking', false, false, ...SHED_DOOR], 'it waits in the shed for its farmer');
  r.boarded.add(id);
  [it] = r.run(0.2);
  assert.deepEqual([it.phase, it.driver, it.vehicle, it.implement], ['out', true, 'tractor', 'sprayer']);
  for (let n = 0; n < 200 && it.phase === 'out'; n++) { r.want([worker(id, 'test', b.key)]); [it] = r.run(0.5); }
  assert.equal(it.phase, 'work');
  assert.ok(inside(b, it.y) || Math.abs(it.x - b.cx) > BED.w / 2, 'in its field or at its headland');
  r.want([worker(id, 'read', b.key)]);
  [it] = r.run(HOLD_S - 2);
  r.want([worker(id, 'read', b.key)]);
  [it] = r.run(1);
  assert.equal(it.phase, 'work', 'still within the hold');
  r.run(2);
  r.want([worker(id, 'read', b.key)]);
  [it] = r.run(0.2);
  assert.equal(it.phase, 'home');
  let items = [];
  for (let n = 0; n < 200; n++) { r.want([worker(id, 'read', b.key)]); items = r.run(0.5); if (!items.length || items[0].phase === 'parked') break; }
  assert.ok(!items.length || items[0].phase === 'parked', 'parked');
  assert.equal(r.run(0.2).length, 0, 'and gone: its farmer released');
});

test('called back mid-trip: its farmer is wanted (waiting on you), so it gets out and the machine goes home empty', () => {
  const r = rig(), b = [...r.beds.values()][0];
  r.want([worker('a', 'test', b.key)]);
  r.boarded.add('a');
  let [it] = r.run(1);
  assert.equal(it.phase, 'out');
  r.want([worker('a', 'test', b.key, { state: 'waiting' })]);
  [it] = r.run(0.2);
  assert.deepEqual([it.phase, it.driver], ['home', false]);
});

test("its field gone: the machine goes home", () => {
  const r = rig(), b = [...r.beds.values()][0];
  r.want([worker('a', 'test', b.key)]);
  r.boarded.add('a');
  r.run(1);
  r.beds.delete(b.key);
  const [it] = r.run(0.2);
  assert.equal(it.phase, 'home');
});

test('a truck job sends the tractor home first; then the truck goes out with its farmer, to town past the lane\'s end', () => {
  const r = rig(), b = [...r.beds.values()][0];
  r.want([worker('a', 'test', b.key)]);
  r.boarded.add('a');
  r.run(2);
  r.want([worker('a', 'deploy', b.key)]);
  let [it] = r.run(0.2);
  assert.deepEqual([it.phase, it.vehicle], ['home', 'tractor']);
  for (let n = 0; n < 200 && it.vehicle === 'tractor'; n++) { r.want([worker('a', 'deploy', b.key)]); [it] = r.run(0.5); }
  assert.deepEqual([it.vehicle, it.phase], ['truck', 'out']);
  for (let n = 0; n < 200 && it.phase === 'out'; n++) { r.want([worker('a', 'deploy', b.key)]); [it] = r.run(0.5); }
  assert.ok(it.x > W, `off the map to town: ${it.x}`);
});

test('the combine cuts its field row by row, once, then goes home', () => {
  const r = rig(), b = [...r.beds.values()][0];
  r.want([worker('a', 'edit', b.key)], new Set(['a']));
  r.boarded.add('a');
  let it, rows = [];
  for (let n = 0; n < 600; n++) { r.want([worker('a', 'edit', b.key)]); [it] = r.run(0.5); if (it?.phase === 'work' || it?.phase === 'home') rows.push(it.rowsDone); if (!it || it.phase === 'home') break; }
  assert.equal(it.vehicle, 'combine');
  assert.equal(it.phase, 'home');
  assert.equal(Math.max(...rows), 6, 'six rows cut');
  assert.deepEqual(rows, [...rows].sort((x, y) => x - y), 'row by row');
});

test('it stops for something ahead, and after 5 s stopped passes through', () => {
  const r = rig(), b = [...r.beds.values()][0];
  r.want([worker('a', 'test', b.key)]);
  r.boarded.add('a');
  let [it] = r.run(1);
  r.setBlocked(() => true);
  const at = [it.x, it.y];
  [it] = r.run(1);
  assert.deepEqual([it.x, it.y, it.moving], [...at, false], 'stopped');
  [it] = r.run(3);
  assert.deepEqual([it.x, it.y], at, 'still stopped at 4 s');
  [it] = r.run(1.5);
  assert.ok(it.x !== at[0] || it.y !== at[1], 'through after 5 s');
});

test('Motion off: each machine stands at its work spot with its farmer in the seat; nothing moves', () => {
  const beds = [bedAt(0), bedAt(1), bedAt(2)], r = rig({ beds, still: true });
  r.want([worker('a', 'test', beds[0].key), worker('b', 'push', beds[1].key), worker('c', 'deploy', beds[2].key)]);
  const items = r.run(0.2), by = new Map(items.map(i => [i.id, i]));
  assert.deepEqual([by.get('a').x, by.get('a').y], passesFor(beds[0], 1, 0)[0]);
  assert.deepEqual([by.get('b').x, by.get('b').y], STALL_SPOT);
  assert.deepEqual([by.get('c').x, by.get('c').y], TOWN_END);
  assert.ok(items.every(i => i.driver && !i.moving && i.phase === 'work'));
  const again = r.run(2);
  assert.deepEqual(again.map(i => [i.x, i.y]), items.map(i => [i.x, i.y]), 'nothing moves');
});

test('a farmer gone from the farm: its machine goes home empty', () => {
  const r = rig(), b = [...r.beds.values()][0];
  r.want([worker('a', 'test', b.key)]);
  r.boarded.add('a');
  r.run(1);
  r.want([]);
  const [it] = r.run(0.2);
  assert.deepEqual([it.phase, it.driver], ['home', false]);
});

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
test("the shed's dialog: who is out on which machine, doing what, in which field; the stock in the shed; none out", () => {
  const scene = { farmers: [{ id: 'a', name: 'Ada <3' }, { id: 'b', name: 'Bo' }], fields: [{ key: '/r/shop', name: 'shop' }, { key: '/r/blog', name: 'blog' }] };
  const d = machinesDialog([{ id: 'a', job: 'sprayer', vehicle: 'tractor', phase: 'work', field: '/r/shop', driver: true }, { id: 'b', job: 'combine', vehicle: 'combine', phase: 'out', field: '/r/blog', driver: true }], scene, { esc });
  assert.equal(d.title, 'The machine shed: who is out on a machine');
  assert.match(d.html, /Ada &lt;3/);
  assert.match(d.html, /tractor.{0,80}sprayer.{0,120}running tests.{0,80}shop/s);
  assert.match(d.html, /combine.{0,120}harvest.{0,120}blog/is);
  assert.match(d.html, /data-farm-pick="a"/, 'a click opens the farmer');
  const none = machinesDialog([], scene, { esc });
  assert.match(none.html, /No machines out just now/);
  assert.match(none.html, /tractor.{0,40}combine/s, 'the stock in the shed');
  const empty = machinesDialog([{ id: 'a', job: 'sprayer', vehicle: 'tractor', phase: 'home', field: '/r/shop', driver: false }], scene, { esc });
  assert.match(empty.html, /driving itself home|on its way home/, 'a machine its farmer left');
});

test("a field's season: looks() gives every field's look; a plough that stops partway leaves its rows turned, the field not sown", () => {
  const s = createSeasons();
  s.update(fm({}, 'idle'), TOUR_NOW);
  s.update(fm({ ...READ, contextTokens: 10_000 }), TOUR_NOW + 1e3);
  assert.deepEqual([...s.looks().keys()], [shop]);
  s.plough(shop, [0, 1, 2]);
  s.update(fm({ ...READ, contextTokens: 10_000 }), TOUR_NOW + 2e3);
  assert.deepEqual([s.lookOf(shop).stage, s.lookOf(shop).ploughed], ['ploughed', 0b111], 'not sown');
  assert.equal(s.cut(shop, 2), false, 'no harvest under way: nothing to cut');
});

test("a field's season: a combine still cutting after 30 s keeps its field cut; one that stops reporting for 10 s leaves it sown; tick() says so between scenes", () => {
  const s = createSeasons(), at = ms => TOUR_NOW + ms;
  s.update(fm({ ...EDIT, contextTokens: 195_000 }), at(0));
  s.update(fm({ ...EDIT, contextTokens: 10_000, compactions: 1 }), at(1e3));
  s.cut(shop, 1, at(25e3));
  s.cut(shop, 3, at(35e3));
  assert.equal(s.tick(at(36e3)), false, 'nothing changed');
  assert.equal(s.lookOf(shop).stage, 'cut', 'still being cut at 36 s');
  assert.equal(s.tick(at(46e3)), true, 'the combine went quiet: changed');
  assert.equal(s.lookOf(shop).stage, 'sown');
  // six rows cut: stubble a moment, then sown, without a new scene
  s.update(fm({ ...EDIT, contextTokens: 10_000, compactions: 2 }), at(50e3));
  s.cut(shop, 6, at(60e3));
  assert.equal(s.tick(at(60.5e3)), false);
  assert.equal(s.lookOf(shop).stage, 'cut');
  assert.equal(s.tick(at(61.2e3)), true);
  assert.deepEqual([s.lookOf(shop).stage, s.lookOf(shop).cutRows], ['sown', 0]);
});

test('Motion off: the combine cuts its field at once (all six rows) and is done; its farmer gets out', () => {
  const r = rig({ still: true }), b = [...r.beds.values()][0];
  r.want([worker('a', 'edit', b.key)], new Set(['a']));
  const [it] = r.run(0.1);
  assert.deepEqual([it.vehicle, it.phase, it.rowsDone], ['combine', 'work', 6]);
  r.want([worker('a', 'edit', b.key)]);
  assert.equal(r.run(0.1).length, 0, 'done: nothing out');
});

test('the hold runs out with time, not only when a scene comes: no new scene after the read, and the machine still goes home', () => {
  const r = rig(), b = [...r.beds.values()][0];
  r.want([worker('a', 'test', b.key)]);
  r.boarded.add('a');
  r.run(5);
  r.want([worker('a', 'read', b.key)]); // the last scene for a while
  let [it] = r.run(HOLD_S - 6);
  assert.notEqual(it.phase, 'home', 'held');
  [it] = r.run(3);
  assert.equal(it.phase, 'home', 'the hold over');
});

/* ---------- the final review's fixes ---------- */
const runUntil = (r, list, done, s = 120, comp) => { let items = []; for (let n = 0; n < s * 2; n++) { r.want(list, comp); items = r.run(0.5); if (done(items)) break; } return items; };

test("a tractor job swapped for another in the same field stays in its field: the implement changes where it is, no trip to the lane and back", () => {
  const b = bedAt(1, 2), r = rig({ beds: [b] });
  r.boarded.add('a');
  let [it] = runUntil(r, [worker('a', 'test', b.key)], i => i[0]?.phase === 'work');
  assert.equal(it.phase, 'work');
  let lowest = Infinity;
  for (let n = 0; n < 40; n++) { // 20 s of edit and test, swapping every 4 s
    r.want([worker('a', n % 16 < 8 ? 'edit' : 'test', b.key, { writes: 9 })]);
    [it] = r.run(0.5);
    lowest = Math.min(lowest, it.y);
  }
  assert.ok(lowest > b.y0 - 14, `it stayed by its field (up to y ${lowest.toFixed(0)}; the lane is ${LANE}, the field from ${b.y0})`);
  assert.equal(it.phase, 'work');
  // a way between two places below the lane by the same walkway never climbs to the lane
  const way = routeBetween([b.x0 - 12, b.y0 + 6], [b.x0 - 12, b.y0 - 60]);
  assert.ok(way.every(([, y]) => y > LANE + 20), JSON.stringify(way));
});

test("the plough reports the rows it has passed, the ones it is on left out till it reaches their end; two ploughs in a field each their own rows", () => {
  const b = bedAt(1), r = rig({ beds: [b] });
  r.boarded.add('a');
  const rowY = k => b.y0 + 6 + k * 12;
  let it, first = [];
  for (let n = 0; n < 400; n++) {
    r.want([worker('a', 'edit', b.key, { writes: 9 })]);
    [it] = r.run(0.25);
    if (it.phase !== 'work') continue;
    if (it.rowsPassed.length === 6) break;
    first = it.rowsPassed;
    assert.ok(!it.rowsPassed.includes(it.passRow) || Math.abs(it.x - b.cx) > BED.w / 2, `row ${it.passRow} reported before its end`);
  }
  assert.deepEqual([...first].sort(), [0, 1, 2, 3, 4].slice(0, first.length), 'in the order it ploughs them');
  assert.equal(it.rowsPassed.length, 6);
  const two = rig({ beds: [b] });
  two.boarded.add('a'); two.boarded.add('b');
  let items = [];
  for (let n = 0; n < 600; n++) { two.want([worker('a', 'edit', b.key, { writes: 9 }), worker('b', 'edit', b.key, { writes: 9 })]); items = two.run(0.25); if (items.length === 2 && items.every(i => i.rowsPassed.length === 3)) break; }
  const [ra, rb] = ['a', 'b'].map(id => items.find(i => i.id === id).rowsPassed.sort());
  assert.deepEqual([ra, rb], [[0, 2, 4], [1, 3, 5]]);
  assert.ok(rowY(5) < b.y0 + BED.d);
});

test("machines at rest never stand on one another: two at the stall, two unloading in one field, a sprayer and an install in one field, two trucks in town; the stall's spot clear of the walkways", () => {
  const beds = [bedAt(0), bedAt(1)];
  const apart = (p, q, d = 30) => Math.hypot(p.x - q.x, p.y - q.y) >= d;
  // Motion on: two pushes from two fields wait at the stall; two installs in one field unload
  const r = rig({ beds });
  for (const id of ['a', 'b', 'c', 'd']) r.boarded.add(id);
  const crew = [worker('a', 'push', beds[0].key), worker('b', 'push', beds[1].key), worker('c', 'install', beds[1].key), worker('d', 'install', beds[1].key)];
  let items = runUntil(r, crew, i => i.length === 4 && i.every(x => x.phase === 'work' && !x.moving) && i.filter(x => x.job === 'crates').every(x => !x.load && Math.abs(x.y - LANE) < 4), 200);
  const by = id => items.find(i => i.id === id);
  assert.ok(apart(by('a'), by('b')), `the stall: ${JSON.stringify([by('a'), by('b')].map(i => [i.x, i.y]))}`);
  assert.ok(apart(by('c'), by('d'), 10), `unloading: ${JSON.stringify([by('c'), by('d')].map(i => [i.x, i.y]))}`);
  for (const c of CORR) assert.ok(Math.abs(by('a').x - c) > 30 && Math.abs(by('b').x - c) > 30, `the stall's spot off the walkway at ${c}`);
  // Motion off
  const s = rig({ beds, still: true });
  s.want([worker('e', 'test', beds[1].key), worker('f', 'install', beds[1].key), worker('g', 'deploy', beds[0].key), worker('h', 'deploy', beds[1].key)]);
  items = s.run(0.2);
  const at = id => items.find(i => i.id === id);
  assert.ok(apart(at('e'), at('f'), 10), 'a sprayer and an install in one field');
  assert.ok(apart(at('g'), at('h')), 'two trucks in town');
  for (const id of ['g', 'h']) assert.ok(CART_RANK.every(([x, y]) => Math.hypot(at(id).x - x, at(id).y - y) > 20), 'not on the carts\' rank');
});

test("what is ahead: within 3 m along a machine's way and close to its line; one on the other half of the lane is not", () => {
  assert.equal(isAhead(100, 107, 0, 120, 107), true);
  assert.equal(isAhead(100, 107, 0, 120, 113), false, 'the other half of the lane (6 px aside)');
  assert.equal(isAhead(100, 107, 0, 90, 107), false, 'behind');
  assert.equal(isAhead(100, 107, 0, 130, 107), false, 'beyond 3 m');
  assert.equal(isAhead(100, 107, Math.PI / 2, 100, 120), true, 'down a walkway');
});

test('seven farmers at work in one field with machines: none throws, each has a row to work (they share when there are more than six)', () => {
  const b = bedAt(1), crew = Array.from({ length: 8 }, (_, k) => worker(`w${k}`, 'test', b.key));
  for (const still of [false, true]) {
    const r = rig({ beds: [b], still });
    for (const f of crew) r.boarded.add(f.id);
    const items = runUntil(r, crew, i => i.length === 8 && i.every(x => x.phase === 'work'), 120);
    assert.equal(items.length, 8, `still ${still}`);
    for (const it of items) assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y), `${it.id} at ${it.x},${it.y}`);
  }
});

test("boarding: a farmer sent to the shed climbs in when it gets there; one whose walk was cut short (a play ended it) is sent again; with Motion off all climb in at once; one out of its machine is let go", () => {
  const items = [{ id: 'a', phase: 'walking', driver: false }, { id: 'b', phase: 'walking', driver: false }, { id: 'c', phase: 'walking', driver: false }, { id: 'd', phase: 'parked', driver: true }, { id: 'e', phase: 'home', driver: false }];
  const act = crewActions(items, { boarded: new Set(['d', 'e']), sent: new Set(['a', 'b']), onErrand: id => id === 'a', arrived: id => id === 'a', still: false });
  assert.deepEqual(act.board, ['a']);
  assert.deepEqual(act.send.sort(), ['b', 'c'], 'b lost its errand: sent again');
  assert.deepEqual(act.release.sort(), ['d', 'e']);
  const still = crewActions([{ id: 'x', phase: 'work', driver: true }], { boarded: new Set(), sent: new Set(), onErrand: () => false, arrived: () => false, still: true });
  assert.deepEqual([still.board, still.send], [['x'], []]);
  const gone = crewActions([], { boarded: new Set(), sent: new Set(['z']), onErrand: () => true, arrived: () => false, still: false });
  assert.deepEqual(gone.forget, ['z'], 'not wanted before it got there');
});

test("Motion off: a machine its farmer had left, wanted again, is its farmer's again (no driverless machine at work when Motion comes back)", () => {
  const b = bedAt(1), r = rig({ beds: [b] });
  r.boarded.add('a');
  r.want([worker('a', 'test', b.key)]);
  r.run(2);
  r.want([worker('a', 'test', b.key, { state: 'waiting' })]); // called back: it gets out
  let [it] = r.run(0.2);
  assert.deepEqual([it.phase, it.driver], ['home', false]);
  r.boarded.delete('a');
  // the same machines, now with Motion off
  const ctx = { farmers: new Map([['a', { x: 0, y: 0, state: 'working', field: b.key }]]), beds: new Map([[b.key, b]]), boarded: () => false, blocked: () => false, still: true, now: 100 };
  r.m.want({ farmers: [worker('a', 'test', b.key)] }, 100, new Set());
  [it] = r.m.tick(0.1, ctx);
  assert.equal(it.driver, true, 'with Motion off its farmer is in the seat');
  [it] = r.m.tick(0.1, { ...ctx, still: false, boarded: () => true });
  assert.equal(it.driver, true, 'Motion back on: still its farmer driving');
});

test("a vehicle's model that fails to load is told once, and a stand-in tractor drives instead; the shed's stock is the loader and the combine", async () => {
  const { makeMachines, MODEL_OF } = await import('../../web/worlds/farm3d/build/machines.js');
  const { makeShed } = await import('../../web/worlds/farm3d/build/shed.js');
  const { makeShapes } = await import('../../web/worlds/farm3d/build/shapes.js');
  const mats = makeMaterials(THREE), S = makeShapes(THREE, mats), told = [];
  const mm = makeMachines(THREE, mats, S, { gltf: () => Promise.reject(new Error('no model')), onError: (err, kind) => told.push(kind) });
  mm.setGround(400, () => 0);
  const item = { id: 'a', vehicle: 'tractor', implement: 'sprayer', job: 'sprayer', x: 100, y: 200, heading: 0, moving: true, phase: 'work', driver: true, load: false };
  mm.tick([item], 0.1, false);
  await new Promise(res => setTimeout(res, 0));
  mm.tick([item, { ...item, id: 'b' }], 0.1, false);
  assert.deepEqual(told, ['tractor'], 'told once');
  assert.equal(mm.count(), 2, 'they drive on');
  assert.equal(MODEL_OF.loader, 'tractorloader');
  const asked = [];
  const shed = makeShed(THREE, mats, S, { stock: v => { asked.push(v); return { root: new THREE.Group() }; }, restock: () => false });
  shed.build(400); shed.build(400, 952); shed.build(400); // yours, the neighbour's, yours again (a rebuild)
  assert.deepEqual(asked.sort(), ['combine', 'combine', 'loader', 'loader'], 'each shed its own loader and combine, made once');
  assert.deepEqual(Object.keys(shed.parked()).sort(), ['0', '952']);
  shed.drop(952);
  assert.deepEqual(shed.parked(), { 0: { loader: true, combine: true } }, "the neighbour's shed and its stock go with it");
});

test('the camera zooms one step closer than before, for the bigger farm', async () => {
  const { ZOOMS, nextZoom } = await import('../../web/worlds/farm3d/camera.js');
  assert.equal(ZOOMS.at(-1), 8);
  assert.equal(nextZoom(6, 1), 8);
});
