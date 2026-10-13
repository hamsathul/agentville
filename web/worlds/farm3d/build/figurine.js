// A farmer as a little figurine, dressed from its look as the people kit dresses it on the 2D farm (people.js:
// lookFor): a shirt in the agent's colour, overalls, skin and hair, one of five hats in its colours with the model's
// pin on it, and a beard, glasses or cheeks. A stale farmer is a scarecrow on a pole, in straw and sacking. Each moving
// part (the body, two legs, two arms) is one baked mesh (shapes.merge), so a farmer is a handful of draw calls; the
// baked geometry is shared by every farmer who looks the same. Badges float over the head; a ring marks the one the
// page's sidebar shows.
import { CART_FLAG, propOf } from './props.js';

const SCARECROW = { shirt: '#8b7a55', bottom: '#6b5a3a', skin: '#d8c48a', hair: '#c9a24a', hat: '#c9a24a', band: '#7a5230' };
const shade = (hex, k) => `#${[1, 3, 5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('')}`;
const HAT_TOP = { straw: 1.82, cap: 1.81, beanie: 1.9, bandana: 1.77, none: 1.7 };
export const FIGURE_SCALE = 1.2; // a little larger than life, as the 2D farm's are: they are seen from above

export function makeFigures(THREE, mats, S) {
  const material = mats.std('#ffffff', { vertexColors: true });
  const cache = new Map();
  const baked = (key, parts) => { if (!cache.has(key)) cache.set(key, S.merge(parts)); return cache.get(key); };
  const piece = (geometry, parent) => { const m = new THREE.Mesh(geometry, material); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };

  /** The body's parts: torso, overalls, head and face, hair or hat, extras, the model's pin. */
  function bodyParts(c, look, pin) {
    const hat = look.hat ?? 'none', P = [
      { geo: 'capsule', color: c.shirt, pos: [0, 0.86, 0], scale: [0.27, 0.3, 0.27] },
      { geo: 'cyl', color: c.bottom, pos: [0, 0.52, 0], scale: [0.29, 0.34, 0.29] },
      { geo: 'box', color: c.bottom, pos: [0, 0.8, 0.24], scale: [0.3, 0.26, 0.06] },
      { geo: 'box', color: c.bottom, pos: [-0.12, 0.98, 0.22], scale: [0.06, 0.3, 0.05] },
      { geo: 'box', color: c.bottom, pos: [0.12, 0.98, 0.22], scale: [0.06, 0.3, 0.05] },
      { geo: 'sphere', color: '#f0b429', pos: [-0.12, 0.88, 0.27], scale: [0.025, 0.025, 0.02] },
      { geo: 'sphere', color: '#f0b429', pos: [0.12, 0.88, 0.27], scale: [0.025, 0.025, 0.02] },
      { geo: 'sphere', color: c.skin, pos: [0, 1.38, 0], scale: [0.3, 0.3, 0.3] },
      { geo: 'sphere', color: '#1b1420', pos: [-0.1, 1.42, 0.27], scale: [0.04, 0.045, 0.03] },
      { geo: 'sphere', color: '#1b1420', pos: [0.1, 1.42, 0.27], scale: [0.04, 0.045, 0.03] },
      { geo: 'sphere', color: shade(c.skin, 0.88), pos: [0, 1.35, 0.3], scale: [0.05, 0.05, 0.05] },
    ];
    // hair: a cap of it without a hat, a fringe at the back under one
    if (hat === 'none') P.push({ geo: 'dome', color: c.hair, pos: [0, 1.42, -0.02], scale: [0.315, 0.3, 0.32] });
    else P.push({ geo: 'sphere', color: c.hair, pos: [0, 1.4, -0.08], scale: [0.29, 0.22, 0.25] });
    if (hat === 'straw') P.push(
      { geo: 'cyl', color: c.hat, pos: [0, 1.58, 0], scale: [0.55, 0.04, 0.55] },
      { geo: 'cyl', color: c.hat, pos: [0, 1.7, 0], scale: [0.27, 0.24, 0.27] },
      { geo: 'cyl', color: c.band, pos: [0, 1.62, 0], scale: [0.285, 0.06, 0.285] },
    );
    if (hat === 'cap') P.push({ geo: 'dome', color: c.hat, pos: [0, 1.5, 0], scale: [0.31, 0.31, 0.31] }, { geo: 'cyl', color: c.band, pos: [0, 1.51, 0.3], scale: [0.22, 0.03, 0.18] });
    if (hat === 'beanie') P.push({ geo: 'dome', color: c.hat, pos: [0, 1.47, 0], scale: [0.32, 0.36, 0.32] }, { geo: 'cyl', color: c.band, pos: [0, 1.48, 0], scale: [0.33, 0.1, 0.33] }, { geo: 'sphere', color: '#f4ecd8', pos: [0, 1.86, 0], scale: [0.08, 0.08, 0.08] });
    if (hat === 'bandana') P.push({ geo: 'dome', color: c.hat, pos: [0, 1.46, 0], scale: [0.315, 0.3, 0.315] }, { geo: 'sphere', color: c.band, pos: [0, 1.5, -0.3], scale: [0.07, 0.07, 0.07] }, { geo: 'box', color: c.hat, pos: [0.04, 1.42, -0.36], rot: [0.5, 0, 0.3], scale: [0.06, 0.14, 0.03] });
    if (look.extra === 'beard') P.push({ geo: 'sphere', color: c.hair, pos: [0, 1.24, 0.13], scale: [0.22, 0.17, 0.16] });
    if (look.extra === 'glasses') P.push({ geo: 'ring', color: '#1b1420', pos: [-0.1, 1.42, 0.29], scale: [0.07, 0.07, 0.07] }, { geo: 'ring', color: '#1b1420', pos: [0.1, 1.42, 0.29], scale: [0.07, 0.07, 0.07] }, { geo: 'box', color: '#1b1420', pos: [0, 1.43, 0.3], scale: [0.06, 0.015, 0.015] });
    if (look.extra === 'cheeks') P.push({ geo: 'sphere', color: '#e8987a', pos: [-0.17, 1.33, 0.24], scale: [0.05, 0.035, 0.02] }, { geo: 'sphere', color: '#e8987a', pos: [0.17, 1.33, 0.24], scale: [0.05, 0.035, 0.02] });
    if (pin) P.push({ geo: 'sphere', color: pin, pos: [0.19, HAT_TOP[hat] - 0.12, 0.2], scale: [0.055, 0.055, 0.055] });
    return P;
  }
  const legParts = c => [{ geo: 'capsule', color: c.bottom, pos: [0, -0.26, 0], scale: [0.1, 0.3, 0.1] }, { geo: 'sphere', color: '#2a1d14', pos: [0, -0.47, 0.04], scale: [0.12, 0.07, 0.15] }];
  const armParts = c => [{ geo: 'capsule', color: c.shirt, pos: [0, -0.22, 0], scale: [0.075, 0.32, 0.075] }, { geo: 'sphere', color: c.skin, pos: [0, -0.44, 0], scale: [0.08, 0.08, 0.08] }];

  // The badges over a farmer's head: waiting (!), a plan to approve (a scroll), a question (?), and thinking (a cloud).
  const BADGES = {
    '!': [{ geo: 'box', color: '#ffffff', scale: [0.48, 0.6, 0.12] }, { geo: 'box', color: '#d03b3b', pos: [0, 0.08, 0.06], scale: [0.1, 0.26, 0.03] }, { geo: 'box', color: '#d03b3b', pos: [0, -0.17, 0.06], scale: [0.1, 0.09, 0.03] }],
    scroll: [{ geo: 'box', color: '#f4ecd8', scale: [0.42, 0.5, 0.03] }, { geo: 'cyl', color: '#e8d8b0', pos: [0, 0.27, 0.02], rot: [0, 0, Math.PI / 2], scale: [0.06, 0.5, 0.06] }, { geo: 'cyl', color: '#e8d8b0', pos: [0, -0.27, 0.02], rot: [0, 0, Math.PI / 2], scale: [0.06, 0.5, 0.06] }, { geo: 'box', color: '#c9a24a', pos: [0, 0.06, 0.02], scale: [0.3, 0.03, 0.01] }, { geo: 'box', color: '#c9a24a', pos: [0, -0.06, 0.02], scale: [0.3, 0.03, 0.01] }],
    '?': [{ geo: 'box', color: '#ffffff', scale: [0.48, 0.6, 0.12] }, { geo: 'ring', color: '#c98500', pos: [0, 0.09, 0.06], scale: [0.1, 0.1, 0.1] }, { geo: 'box', color: '#c98500', pos: [0, -0.06, 0.06], scale: [0.06, 0.1, 0.03] }, { geo: 'box', color: '#c98500', pos: [0, -0.18, 0.06], scale: [0.07, 0.07, 0.03] }],
    think: [{ geo: 'sphere', color: '#ffffff', pos: [0.05, -0.2, 0], scale: [0.06, 0.06, 0.06] }, { geo: 'sphere', color: '#ffffff', pos: [0.15, -0.05, 0], scale: [0.09, 0.09, 0.09] }, { geo: 'sphere', color: '#ffffff', pos: [0.3, 0.2, 0], scale: [0.22, 0.17, 0.17] }, { geo: 'sphere', color: '#ffffff', pos: [0.5, 0.24, 0], scale: [0.17, 0.14, 0.14] }],
    basket: [{ geo: 'cyl', color: '#c9a24a', scale: [0.24, 0.24, 0.2] }, { geo: 'ring', color: '#a8803a', pos: [0, 0.2, 0], rot: [0, 0, 0], scale: [0.2, 0.2, 0.2] }, { geo: 'sphere', color: '#e04a3a', pos: [-0.08, 0.14, 0.02], scale: [0.08, 0.08, 0.08] }, { geo: 'sphere', color: '#e9a23b', pos: [0.08, 0.15, -0.02], scale: [0.08, 0.08, 0.08] }],
  };
  const ringGeo = new THREE.TorusGeometry(0.55, 0.05, 6, 32).rotateX(Math.PI / 2);
  const ringMat = mats.basic('#ffd43b');

  /** A figure for a farmer; `update(f)` re-dresses it when its look changes. */
  function make(f) {
    const root = new THREE.Group(), fig = new THREE.Group();
    root.add(fig);
    root.scale.setScalar(FIGURE_SCALE);
    root.userData.id = f.id;
    const pivots = {};
    let dressed = '', prop = null, propName = '', badge = null, badgeName = '', think = null, pole = null;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.visible = false; ring.position.y = 0.03;
    root.add(ring);
    function dress(f2) {
      const look = f2.look ?? {}, scare = f2.scarecrow;
      const c = scare ? SCARECROW : { shirt: f2.shirt ?? '#d9673a', bottom: look.bottomColor ?? '#3c5a99', skin: look.skin ?? '#f1c7a1', hair: look.hair ?? '#5a3a22', hat: look.hatColor ?? '#e9c46a', band: look.band ?? '#b5562f' };
      const lk = scare ? { ...look, hat: look.hat === 'none' ? 'straw' : look.hat, extra: 'none' } : look;
      const pin = scare ? null : { opus: '#8a5fc0', sonnet: '#3d7be0', haiku: '#2fa57a', fable: '#f08a24' }[f2.family] ?? null;
      const key = JSON.stringify([c, lk.hat, lk.extra, pin]);
      if (key === dressed) return;
      dressed = key;
      for (const k of Object.keys(pivots)) { fig.remove(pivots[k]); delete pivots[k]; }
      piece(baked(`body|${key}`, bodyParts(c, lk, pin)), fig);
      const hip = (x, parts, k) => { const g = new THREE.Group(); g.position.set(x, 0.5, 0); fig.add(g); piece(baked(k, parts), g); return g; };
      pivots.body = fig.children.at(-1);
      pivots.legL = hip(-0.12, legParts(c), `leg|${c.bottom}`);
      pivots.legR = hip(0.12, legParts(c), `leg|${c.bottom}`);
      const shoulder = (x, k) => { const g = new THREE.Group(); g.position.set(x, 1.02, 0); fig.add(g); piece(baked(k, armParts(c)), g); return g; };
      pivots.armL = shoulder(-0.33, `arm|${c.shirt}|${c.skin}`);
      pivots.armR = shoulder(0.33, `arm|${c.shirt}|${c.skin}`);
      if (pole) { root.remove(pole); pole = null; }
      if (scare) { // on a pole, arms out, a little off the ground
        pole = new THREE.Group();
        piece(baked('pole', [{ geo: 'cyl', color: '#6b4320', pos: [0, 1.0, -0.12], scale: [0.05, 2.0, 0.05] }, { geo: 'cyl', color: '#6b4320', pos: [0, 1.22, -0.12], rot: [0, 0, Math.PI / 2], scale: [0.04, 1.5, 0.04] }]), pole);
        root.add(pole);
        fig.position.y = 0.25;
        pivots.armL.rotation.z = -1.45; pivots.armR.rotation.z = 1.45;
      } else fig.position.y = 0;
      propName = ''; // put the prop back on the new arms
    }
    function setProp(name, flag) {
      const k = `${name}|${flag}`;
      if (k === propName) return;
      propName = k;
      if (prop) { prop.removeFromParent(); prop = null; }
      if (!name) return;
      const p = propOf(name), g = baked(`prop|${name}|${flag}`, [...p.parts, ...(name === 'cart' && flag ? CART_FLAG : [])]);
      prop = new THREE.Mesh(g, material);
      prop.castShadow = true;
      if (p.at === 'right') { prop.position.set(0, -0.44, 0); pivots.armR.add(prop); }
      else if (p.at === 'chest') { prop.position.set(0, 0.95, 0.42); fig.add(prop); }
      else if (p.at === 'eye') { prop.position.set(0.1, 1.42, 0.25); fig.add(prop); }
      else { prop.position.set(0, 0, 0.55); fig.add(prop); }
      prop.userData.pose = p.pose;
    }
    function setBadge(name, thinking) {
      if (name !== badgeName) {
        badgeName = name;
        if (badge) { badge.removeFromParent(); badge = null; }
        if (name === 'basket') { badge = new THREE.Mesh(baked('badge|basket', BADGES.basket), material); badge.position.set(0, 0.62, 0.42); fig.add(badge); }
        else if (name) { badge = new THREE.Mesh(baked(`badge|${name}`, BADGES[name]), material); badge.position.set(0.42, 2.25, 0); root.add(badge); }
        if (badge) badge.castShadow = true;
      }
      if (Boolean(thinking) !== Boolean(think)) {
        if (think) { think.removeFromParent(); think = null; }
        else { think = new THREE.Mesh(baked('badge|think', BADGES.think), material); think.position.set(0.2, 2.1, 0); root.add(think); }
      }
    }
    /**
     * The pose for now: `kind` is walk, swing, hold, raise, carry, push, wave, basket, idle, nap or scarecrow; t the
     * clock (0 holds it still).
     */
    function pose(kind, t) {
      const { legL, legR, armL, armR } = pivots, s = Math.sin(t * 9), w = Math.sin(t * 5);
      if (!legL) return;
      fig.rotation.set(0, 0, 0);
      fig.position.y = pole ? 0.25 : 0;
      legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
      if (kind !== 'scarecrow') { armL.rotation.set(0, 0, 0); armR.rotation.set(0, 0, 0); }
      if (kind === 'walk') { legL.rotation.x = s * 0.6; legR.rotation.x = -s * 0.6; armL.rotation.x = -s * 0.5; armR.rotation.x = s * 0.5; fig.position.y = Math.abs(s) * 0.05; }
      else if (kind === 'swing') { armR.rotation.x = -1.3 + w * 0.6; armL.rotation.x = -0.9 + w * 0.35; fig.rotation.x = 0.08 + w * 0.04; }
      else if (kind === 'hold') { armL.rotation.x = -0.95; armR.rotation.x = -0.95 + Math.sin(t * 1.5) * 0.05; armL.rotation.z = 0.25; armR.rotation.z = -0.25; }
      else if (kind === 'raise') { armR.rotation.x = -2.2; armR.rotation.z = 0.35; armL.rotation.x = -0.4; }
      else if (kind === 'carry' || kind === 'basket') { armL.rotation.x = -0.75; armR.rotation.x = -0.75; armL.rotation.z = 0.3; armR.rotation.z = -0.3; }
      else if (kind === 'push') { armL.rotation.x = -0.55; armR.rotation.x = -0.55; fig.rotation.x = 0.1; }
      else if (kind === 'wave') { armR.rotation.z = 2.6 + Math.sin(t * 8) * 0.35; }
      else if (kind === 'nap') { fig.rotation.x = -Math.PI / 2; fig.position.y = 1.05; armL.rotation.z = -0.2; armR.rotation.z = 0.2; }
      else if (kind === 'idle') { armL.rotation.z = -0.08; armR.rotation.z = 0.08; fig.position.y = Math.sin(t * 1.4) * 0.01; }
      if (badge && badgeName !== 'basket') badge.position.y = 2.25 + (t ? Math.abs(Math.sin(t * 3)) * 0.1 : 0);
      if (think) think.position.y = 2.1 + (t ? Math.sin(t * 2) * 0.05 : 0);
    }
    const figure = {
      root, pivots, pose, setProp, setBadge, propPose: () => prop?.userData.pose ?? null,
      setSelected(on) { ring.visible = on; },
      update(f2) { dress(f2); },
      dispose() { root.removeFromParent(); },
    };
    dress(f);
    return figure;
  }
  return { make, dispose() { for (const g of cache.values()) g.dispose(); cache.clear(); ringGeo.dispose(); } };
}
