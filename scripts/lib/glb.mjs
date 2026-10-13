// A GLB's two chunks read and written, and a model trimmed to what the 3D farm uses (scripts/farm3d-animals.mjs; the
// tests read the models it made with readGlb). No dependencies.
const SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** A GLB's JSON and binary chunk. */
export function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binLen = buf.readUInt32LE(20 + jsonLen), bin = buf.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  return { json, bin };
}
/** A GLB of a JSON and a binary chunk, each padded to 4 bytes. */
export function writeGlb(json, bin) {
  let j = Buffer.from(JSON.stringify(json), 'utf8');
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, j, bh, b]);
}
/**
 * The model with only what the farm uses: the clips it plays (one copy each, named without the armature's prefix), no
 * normals, texture coordinates or textures, every accessor packed into a tight view of one buffer.
 */
export function trimGlb({ json, bin }, keep) {
  const j = structuredClone(json);
  const anims = [];
  for (const a of j.animations ?? []) { const name = a.name.replace(/^.*\|/, ''); if (keep.includes(name) && !anims.some(x => x.name === name)) anims.push({ ...a, name }); }
  j.animations = anims;
  if (!anims.length) delete j.animations;
  for (const m of j.meshes) for (const p of m.primitives) for (const k of Object.keys(p.attributes)) if (k === 'NORMAL' || k === 'TANGENT' || k.startsWith('TEXCOORD')) delete p.attributes[k];
  for (const mat of j.materials ?? []) {
    if (mat.pbrMetallicRoughness) { delete mat.pbrMetallicRoughness.baseColorTexture; delete mat.pbrMetallicRoughness.metallicRoughnessTexture; }
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture', 'extensions']) delete mat[k];
  }
  for (const k of ['textures', 'images', 'samplers', 'extensionsUsed', 'extensionsRequired']) delete j[k];
  const used = new Set(), refs = [];
  const ref = (obj, key) => { if (obj[key] !== undefined) { used.add(obj[key]); refs.push([obj, key]); } };
  for (const m of j.meshes) for (const p of m.primitives) { for (const k of Object.keys(p.attributes)) ref(p.attributes, k); ref(p, 'indices'); for (const t of p.targets ?? []) for (const k of Object.keys(t)) ref(t, k); }
  for (const s of j.skins ?? []) ref(s, 'inverseBindMatrices');
  for (const a of j.animations ?? []) for (const s of a.samplers) { ref(s, 'input'); ref(s, 'output'); }
  const remap = new Map(), views = [], accessors = [], chunks = [];
  let offset = 0;
  for (const old of [...used].sort((a, b) => a - b)) {
    const a = j.accessors[old], v = j.bufferViews[a.bufferView], elem = COUNT[a.type] * SIZES[a.componentType], stride = v.byteStride || elem, from = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (a.sparse) throw new Error('sparse accessors are not handled');
    const bytes = Buffer.alloc(a.count * elem);
    for (let k = 0; k < a.count; k++) bin.copy(bytes, k * elem, from + k * stride, from + k * stride + elem);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(v.target ? { target: v.target } : {}) });
    chunks.push(bytes);
    offset += bytes.length;
    remap.set(old, accessors.length);
    accessors.push({ ...a, bufferView: views.length - 1, byteOffset: 0 });
  }
  for (const [obj, key] of refs) obj[key] = remap.get(obj[key]);
  j.accessors = accessors; j.bufferViews = views; j.buffers = [{ byteLength: offset }];
  return writeGlb(j, Buffer.concat(chunks));
}

