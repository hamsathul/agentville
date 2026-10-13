// A farmer as one of Quaternius's characters (characters.js picks which; models/: family `person`): the agent's colour
// on its shirt (coats.js SHIRTS), the step's tool in its right hand, and a clip for each of the figurine's poses
// (characters.js clipFor). Each model is loaded once and baked into two skinned meshes on its own skeleton: the shirt,
// in the agent's colour, and the rest, a colour per vertex, so a farmer is two draw calls (and two for its shadow).
// build/figurine.js keeps its own figure until a character has loaded, and for a scarecrow.
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/SkeletonUtils.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { MODELS } from '../models/index.js';
import { FINISH, SHIRTS } from '../coats.js';
import { clipFor, makeIdler } from '../characters.js';

export function makeCharacters(THREE) {
  const loader = new GLTFLoader(), templates = new Map(), loads = new Map();
  const restMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, ...FINISH });
  const shirts = new Map(); // a shirt material per colour, shared by every farmer wearing it
  const shirtOf = colour => { if (!shirts.has(colour)) shirts.set(colour, new THREE.MeshStandardMaterial({ color: colour, flatShading: true, ...FINISH })); return shirts.get(colour); };
  const under = (o, names) => { for (let p = o; p; p = p.parent) if (names.includes(p.name)) return true; return false; };

  /** Loads a character's model once: baked into its shirt and the rest, sized to its height with its feet at 0. */
  function load(kind) {
    if (!loads.has(kind)) loads.set(kind, (async () => {
      const b64 = (await import(`../models/${kind}.js`)).default, bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const gltf = await loader.parseAsync(bytes.buffer, ''), scene = gltf.scene, shirt = SHIRTS[kind];
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3()); // as it came, before baking
      const meshes = [];
      scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
      const first = meshes[0], rest = [], top = [];
      for (const m of meshes) {
        const g = m.geometry.clone(), c = m.material.color, n = g.attributes.position.count;
        for (const name of Object.keys(g.attributes)) if (!['position', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
        const isShirt = under(m, shirt.meshes) && m.material.name === shirt.material;
        if (!isShirt) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
        (isShirt ? top : rest).push(g);
      }
      const baked = (geos, material) => {
        const mesh = new THREE.SkinnedMesh(mergeGeometries(geos), material);
        mesh.position.copy(first.position); mesh.quaternion.copy(first.quaternion); mesh.scale.copy(first.scale);
        mesh.bind(first.skeleton, first.bindMatrix);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        first.parent.add(mesh);
        return mesh;
      };
      const restMesh = baked(rest, restMat), shirtMesh = baked(top, shirtOf('#888888'));
      shirtMesh.userData.shirt = true;
      for (const m of meshes) m.removeFromParent();
      restMesh.userData.rest = true;
      const clips = new Map(gltf.animations.map(c => [c.name, c])), scale = MODELS[kind].height / (size.y || 1);
      // a tool in the hand: how the hand is turned and sized while it holds one (Idle_Sword's first frame), so a tool
      // made for the figurine's arm (hanging from the hand, the arm raised 0.95 rad) sits in it the same way
      const mixer = new THREE.AnimationMixer(scene), hold = mixer.clipAction(clips.get(MODELS[kind].clips.hold));
      hold.play();
      mixer.update(0);
      scene.updateMatrixWorld(true);
      const wrist = scene.getObjectByName('WristR'), q = new THREE.Quaternion(), sv = new THREE.Vector3();
      wrist.getWorldQuaternion(q);
      wrist.getWorldScale(sv);
      hold.stop();
      mixer.uncacheRoot(scene);
      const grip = { turn: q.invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.95)), size: 1 / (scale * (sv.x || 1)) };
      templates.set(kind, { scene, clips, scale, lift: -box.min.y, grip });
    })());
    return loads.get(kind);
  }

  /**
   * A character for a farmer, once its model has loaded (else null; the load starts): `root` to add, `pose(kind, t)`,
   * `setShirt(colour)`, `hand` (where a tool goes), and `dispose()`. Its size is the figurine's (1.95 m before the
   * figure's own scale).
   */
  function make(kind) {
    const t = templates.get(kind);
    if (!t) { load(kind); return null; }
    const root = new THREE.Group(), holder = new THREE.Group(), model = cloneSkinned(t.scene);
    holder.scale.setScalar(t.scale);
    holder.position.y = t.lift * t.scale;
    holder.add(model);
    root.add(holder);
    let shirtMesh = null;
    model.traverse(o => {
      if (o.userData.shirt) shirtMesh = o;
      if (o.isSkinnedMesh) o.raycast = () => {}; // a pointer's ray skips it: skinning it on the CPU is slow, and the figurine under it is the click box
    });
    const mixer = new THREE.AnimationMixer(model), actions = new Map();
    for (const [name, clip] of t.clips) actions.set(name, mixer.clipAction(clip));
    const hand = model.getObjectByName('WristR'), idler = makeIdler(); // its own idle moves, on its own rhythm
    let playing = null, playingName = '', lastT = 0;
    function play(name, once, still) {
      const next = actions.get(name);
      if (!next || name === playingName) return;
      next.reset();
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = once;
      if (still) { for (const a of actions.values()) if (a !== next) a.stop(); next.setEffectiveWeight(1); next.play(); } // nothing moves: the new pose at once
      else { next.play(); if (playing) next.crossFadeFrom(playing, 0.25, false); }
      playing = next;
      playingName = name;
    }
    return {
      root, hand,
      /** Puts a tool (made for the figurine's hand) in its right hand. */
      holdInHand(object) {
        const g = new THREE.Group();
        g.userData.grip = true;
        g.quaternion.copy(t.grip.turn);
        g.scale.setScalar(t.grip.size);
        g.add(object);
        hand?.add(g);
        return g;
      },
      /** What it is playing now, and how much (for the check). */
      playing: () => playingName,
      weight: () => playing?.getEffectiveWeight() ?? 0,
      /** The pose for now (the figurine's kinds); t the clock, 0 holding it still. */
      pose(kind2, t2) {
        const clips = MODELS[kind].clips, nap = kind2 === 'nap';
        const move = kind2 === 'idle' ? idler.part(t2) : { part: clipFor(kind2), once: nap }; // idle: its own moves now and then
        play(clips[move.part] ?? clips.idle, move.once, !t2);
        // lying along the hammock (it runs across the farmer's view, sagging to 0.7 m), its middle over the hammock's
        holder.position.set(nap ? 0.8 : 0, nap ? 0.55 : t.lift * t.scale, 0);
        holder.rotation.y = nap ? Math.PI / 2 : 0;
        const dt = t2 ? Math.min(0.1, Math.max(0, t2 - lastT)) : 0;
        lastT = t2;
        if (!t2 && nap && playing) playing.time = playing.getClip().duration; // still: already lying down
        mixer.update(dt);
      },
      setShirt(colour) { if (shirtMesh) shirtMesh.material = shirtOf(colour); },
      dispose() { mixer.stopAllAction(); model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.dispose(); }); root.removeFromParent(); }, // its skeletons' bone textures too
    };
  }
  return { load, make, ready: kind => templates.has(kind) };
}
