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
 * The keys of one animation channel worth keeping (their indices): the first, the last, and each key the straight line
 * between the keys kept either side of it doesn't give, to within eps on every part (size parts a key). Every key
 * dropped is checked against the line that replaces it, so the error never builds up. A channel that never moves keeps
 * one key.
 */
export function thinKeys(times, values, size, eps) {
  const n = times.length;
  if (n < 2) return [0];
  const off = (k, from, to) => {
    const u = (times[k] - times[from]) / (times[to] - times[from] || 1);
    for (let c = 0; c < size; c++) { const v = values[from * size + c] + (values[to * size + c] - values[from * size + c]) * u; if (Math.abs(v - values[k * size + c]) > eps) return true; }
    return false;
  };
  const keep = [0];
  let a = 0;
  for (let b = 2; b < n; b++) {
    for (let k = a + 1; k < b; k++) if (off(k, a, b)) { keep.push(b - 1); a = b - 1; break; }
  }
  keep.push(n - 1);
  const still = keep.length === 2 && Array.from({ length: size }, (_, c) => Math.abs(values[c] - values[(n - 1) * size + c]) <= eps).every(Boolean) && !Array.from({ length: n }, (_, k) => k).some(k => off(k, 0, n - 1));
  return still ? [0] : keep;
}
/** Skin weights (four a vertex) in bytes, 255 for one: each vertex's still add up to 255, its biggest share taking the rounding. */
export function packWeights(w) {
  const out = new Uint8Array(w.length);
  for (let v = 0; v < w.length; v += 4) {
    let sum = 0, big = v;
    for (let c = v; c < v + 4; c++) { out[c] = Math.round(Math.max(0, Math.min(1, w[c])) * 255); sum += out[c]; if (w[c] > w[big]) big = c; }
    out[big] += 255 - sum;
  }
  return out;
}

const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
/** An accessor's values, tightly packed in its own type. */
function readAccessor(j, bin, index) {
  const a = j.accessors[index], v = j.bufferViews[a.bufferView], size = COUNT[a.type], elem = size * SIZES[a.componentType];
  const stride = v.byteStride || elem, from = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (a.sparse) throw new Error('sparse accessors are not handled');
  const bytes = new Uint8Array(a.count * elem);
  for (let k = 0; k < a.count; k++) bytes.set(bin.subarray(from + k * stride, from + k * stride + elem), k * elem);
  return { array: new TYPED[a.componentType](bytes.buffer), size, a };
}
/** An accessor's values as plain numbers (normalized integers scaled back). */
function numbers({ array, a }) {
  const f = Float32Array.from(array);
  if (a.normalized && NORM[a.componentType]) for (let i = 0; i < f.length; i++) f[i] = Math.max(-1, f[i] / NORM[a.componentType]);
  return f;
}
const PARTS = { rotation: 4, translation: 3, scale: 3 };
const top = array => { let m = -Infinity; for (const x of array) if (x > m) m = x; return m; };

/**
 * The model with only what the farm uses, packed small: the clips it plays (one copy each, named without the
 * armature's prefix), each channel's keys thinned (thinKeys) and its rotations in 16-bit integers; no normals, texture
 * coordinates or textures; skin weights and joints in bytes, indices in 16 bits where they fit; every accessor in a
 * tight view of one buffer. Everything it writes is core glTF 2.0, which three.js's loader reads.
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

  const views = [], accessors = [], chunks = [], made = new Map();
  let offset = 0;
  /** A new accessor over these values (a typed array), in a view of its own; the same values twice share one. */
  const put = (array, props, target, share) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength), key = share && `${props.componentType}|${props.type}|${bytes.toString('base64')}`;
    if (key && made.has(key)) return made.get(key);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    offset += bytes.length;
    accessors.push({ ...props, bufferView: views.length - 1, byteOffset: 0 });
    if (key) made.set(key, accessors.length - 1);
    return accessors.length - 1;
  };
  const strip = ({ bufferView, byteOffset, sparse, ...rest }) => rest;
  const copied = new Map();
  /** A mesh's or a skin's accessor, as it was or in fewer bytes (weights and joints in bytes, indices in 16 bits). */
  const copy = (index, as) => {
    const memo = `${index}|${as}`;
    if (copied.has(memo)) return copied.get(memo);
    const r = readAccessor(j, bin, index), base = strip(r.a);
    let out;
    if (as === 'weights' && r.a.componentType === 5126) out = put(packWeights(r.array), { ...base, componentType: 5121, normalized: true, min: undefined, max: undefined }, 34962);
    else if (as === 'joints' && top(r.array) < 256 && r.a.componentType !== 5121) out = put(Uint8Array.from(r.array), { ...base, componentType: 5121, min: undefined, max: undefined }, 34962);
    else if (as === 'indices' && r.a.componentType === 5125 && top(r.array) < 65536) out = put(Uint16Array.from(r.array), { ...base, componentType: 5123 }, 34963);
    else out = put(r.array, base, as === 'indices' ? 34963 : as === 'raw' ? undefined : 34962);
    copied.set(memo, out);
    return out;
  };
  for (const m of j.meshes) for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = copy(p.attributes[k], k.startsWith('WEIGHTS_') ? 'weights' : k.startsWith('JOINTS_') ? 'joints' : 'attribute');
    if (p.indices !== undefined) p.indices = copy(p.indices, 'indices');
    for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = copy(t[k], 'attribute');
  }
  for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = copy(s.inverseBindMatrices, 'raw');
  // The clips' keys, all in one view after the mesh's (an accessor and a view each would make the JSON bigger than
  // the data). A channel that holds its bone still at its rest pose goes: the mixer puts a bone no clip moves back there.
  const anim = [], animAt = [], shared = new Map();
  let animOffset = 0;
  const putAnim = (array, props, share) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength), key = share && bytes.toString('base64');
    if (key && shared.has(key)) return shared.get(key);
    const pad = (4 - (animOffset % 4)) % 4;
    if (pad) { anim.push(Buffer.alloc(pad)); animOffset += pad; }
    accessors.push({ ...props, bufferView: -1, byteOffset: animOffset });
    animAt.push(accessors.length - 1);
    anim.push(bytes);
    animOffset += bytes.length;
    if (key) shared.set(key, accessors.length - 1);
    return accessors.length - 1;
  };
  const REST = { rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: [1, 1, 1] };
  for (const a of j.animations ?? []) {
    const samplers = a.samplers.map((s, i) => {
      const ch = a.channels.find(c => c.sampler === i), path = ch?.target.path, input = readAccessor(j, bin, s.input), output = readAccessor(j, bin, s.output);
      const times = numbers(input), values = numbers(output), size = PARTS[path] ?? values.length / times.length;
      if ((s.interpolation ?? 'LINEAR') !== 'LINEAR') return { ...s, input: putAnim(input.array, strip(input.a), true), output: putAnim(output.array, strip(output.a)) };
      if (path === 'rotation') for (let k = 1; k < times.length; k++) { // each key the short way round from the one before
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += values[k * 4 + c] * values[(k - 1) * 4 + c];
        if (dot < 0) for (let c = 0; c < 4; c++) values[k * 4 + c] *= -1;
      }
      let extent = 0;
      for (let c = 0; c < size; c++) { let lo = Infinity, hi = -Infinity; for (let k = 0; k < times.length; k++) { lo = Math.min(lo, values[k * size + c]); hi = Math.max(hi, values[k * size + c]); } extent = Math.max(extent, hi - lo); }
      const eps = path === 'rotation' || path === 'scale' ? 0.001 : Math.max(1e-6, extent * 0.002);
      const kept = thinKeys(times, values, size, eps);
      const node = j.nodes[ch?.target.node] ?? {}, rest = node[path] ?? REST[path];
      if (kept.length === 1 && rest && rest.every((r, c) => Math.abs(r - values[c]) <= eps || (path === 'rotation' && Math.abs(r + values[c]) <= eps && rest.every((q, d) => Math.abs(q + values[d]) <= eps)))) return null;
      const t = Float32Array.from(kept, k => times[k]), v = kept.flatMap(k => Array.from(values.subarray(k * size, k * size + size)));
      const inputAt = putAnim(t, { componentType: 5126, type: 'SCALAR', count: t.length, min: [t[0]], max: [t.at(-1)] }, true);
      const outputAt = path === 'rotation'
        ? putAnim(Int16Array.from(v, x => Math.round(Math.max(-1, Math.min(1, x)) * 32767)), { componentType: 5122, normalized: true, type: 'VEC4', count: t.length })
        : putAnim(Float32Array.from(v), { componentType: 5126, type: path === 'weights' ? 'SCALAR' : 'VEC3', count: path === 'weights' ? v.length : t.length });
      return { ...s, input: inputAt, output: outputAt };
    });
    const index = new Map();
    a.samplers = samplers.filter((s, i) => { if (s) index.set(i, index.size); return s; });
    a.channels = a.channels.filter(c => index.has(c.sampler)).map(c => ({ ...c, sampler: index.get(c.sampler) }));
  }
  if (anim.length) {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    views.push({ buffer: 0, byteOffset: offset, byteLength: animOffset });
    chunks.push(...anim);
    offset += animOffset;
    for (const i of animAt) accessors[i].bufferView = views.length - 1;
  }
  for (const a of accessors) for (const k of ['min', 'max', 'normalized']) if (a[k] === undefined) delete a[k];
  j.accessors = accessors; j.bufferViews = views; j.buffers = [{ byteLength: offset }];
  return writeGlb(j, Buffer.concat(chunks));
}
