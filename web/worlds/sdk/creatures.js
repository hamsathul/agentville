// The creature library: plain pixel creatures any world can use (docs/worlds.md, "Creatures"). Each
// draws itself standing on (x, y), facing right (face 1) or left (-1), in a pose: stand, walk, run,
// eat, sleep, happy (and the duck's swim and dabble, the ostrich's hide). Sizes and speeds are in world
// pixels. A plain script in a world's frame, after pixel.js. Only CREATURES and creaturePainter are
// global, so a world's own names never clash with its helpers.
'use strict';

(() => {
  /** A painter for one creature: (dx, dy, w, h, colour) from its feet, mirrored when it faces left. */
  const creaturePainter = (x, y, face) => (dx, dy, w, h, c) => px(Math.round(face > 0 ? x + dx : x - dx - w), Math.round(y + dy), w, h, c);
  const legStep = (pose, T) => (pose === 'walk' || pose === 'run' ? Math.floor(T * (pose === 'run' ? 12 : 6)) % 2 : 0);
  const INK = '#2b2b30';

  const CREATURES = {
    cow: { w: 15, h: 11, speed: 8, night: 'sleep', draw(p, pose, T) {
      const W = '#f4f1ea', P = '#e8a3a3';
      if (pose === 'sleep') { p(-7, -4, 12, 4, W); p(-4, -4, 3, 2, INK); p(1, -3, 2, 2, INK); p(5, -6, 3, 3, W); p(7, -4, 1, 1, P); return; }
      const s = legStep(pose, T), down = pose === 'eat' ? 2 : 0;
      p(-6, -3, 1, 3 - s, INK); p(-4, -3, 1, 2 + s, INK); p(2, -3, 1, 3 - s, INK); p(4, -3, 1, 2 + s, INK);
      p(-7, -8, 12, 5, W); p(-5, -8, 4, 2, INK); p(0, -6, 3, 3, INK); p(-7, -6, 2, 2, INK); p(-8, -8, 1, 3, INK); p(-2, -3, 2, 1, P);
      p(4, -11 + down, 3, 4, W); p(6, -9 + down, 1, 2, P); p(5, -10 + down, 1, 1, INK); p(4, -11 + down, 1, 1, INK);
    } },
    goat: { w: 11, h: 11, speed: 10, night: 'sleep', draw(p, pose, T) {
      const B = '#cbbfa8', D = '#8c7b62', H = '#e8dcc4';
      if (pose === 'sleep') { p(-4, -3, 8, 3, B); p(2, -5, 3, 3, B); p(3, -6, 1, 1, H); return; }
      const s = legStep(pose, T), down = pose === 'eat' ? 2 : 0;
      p(-4, -3, 1, 3 - s, D); p(-2, -3, 1, 2 + s, D); p(1, -3, 1, 3 - s, D); p(3, -3, 1, 2 + s, D);
      p(-5, -7, 9, 4, B); p(-5, -8, 1, 2, D);
      p(3, -10 + down, 2, 4, B); p(3, -11 + down, 1, 1, H); p(4, -11 + down, 1, 1, H); p(4, -7 + down, 1, 2, D); p(4, -9 + down, 1, 1, INK);
    } },
    sheepdog: { w: 12, h: 9, speed: 18, night: 'sleep', draw(p, pose, T) {
      const G = '#c9ced6', D = '#8a93a0', R = '#e04a3a';
      if (pose === 'sleep') { p(-5, -3, 9, 3, G); p(2, -4, 3, 3, G); p(2, -2, 2, 1, R); return; }
      const s = legStep(pose, T), wag = Math.floor(T * 8) % 2;
      p(-4, -3, 2, 3 - s, D); p(2, -3, 2, 2 + s, D);
      p(-5, -7, 9, 4, G); p(-5, -7, 9, 1, '#e6eef5'); p(-6, -8 + wag, 1, 2, G);
      p(3, -9, 3, 4, G); p(5, -7, 1, 1, INK); p(4, -8, 1, 1, INK); p(3, -5, 3, 1, R);
    } },
    ostrich: { w: 9, h: 15, speed: 20, night: 'sleep', draw(p, pose, T) {
      const N = '#e8b8a0', L = '#d99a7a';
      if (pose === 'sleep' || pose === 'hide') { p(-4, -5, 7, 4, INK); p(-4, -4, 1, 1, '#f4f1ea'); if (pose === 'hide') p(3, -1, 1, 1, N); else { p(3, -3, 2, 1, N); p(2, -4, 1, 1, '#ffffff'); } return; } // asleep, one eye open
      const s = legStep(pose, T);
      p(-1, -5, 1, 5 - s, L); p(1, -5, 1, 4 + s, L);
      p(-3, -9, 6, 4, INK); p(-4, -9, 1, 2, '#f4f1ea');
      p(2, -14, 1, 5, N); p(2, -15, 2, 2, N); p(4, -14, 1, 1, '#f0b429'); p(3, -15, 1, 1, INK);
    } },
    lion: { w: 15, h: 10, speed: 9, night: 'awake', draw(p, pose, T) {
      const Y = '#d9a441', M = '#a5622a', D = '#8a5a2b';
      if (pose === 'sleep') { p(-6, -3, 10, 3, Y); p(3, -5, 4, 4, M); p(4, -4, 2, 2, Y); p(-7, -3, 1, 2, M); return; }
      const s = legStep(pose, T);
      p(-5, -3, 1, 3 - s, D); p(-3, -3, 1, 2 + s, D); p(1, -3, 1, 3 - s, D); p(3, -3, 1, 2 + s, D);
      p(-6, -7, 10, 4, Y); p(-7, -8, 1, 1, Y); p(-7, -9, 1, 1, M);
      p(3, -10, 4, 5, M); p(4, -9, 3, 3, Y); p(6, -8, 1, 1, INK); p(5, -9, 1, 1, INK);
    } },
    tiger: { w: 15, h: 10, speed: 12, night: 'sleep', draw(p, pose, T) {
      const O = '#e8792b', Wt = '#f4f1ea';
      if (pose === 'sleep') { p(-6, -3, 10, 3, O); p(-3, -3, 1, 3, INK); p(0, -3, 1, 3, INK); p(3, -4, 4, 3, O); p(5, -3, 2, 1, Wt); return; }
      const s = legStep(pose, T);
      p(-5, -3, 1, 3 - s, O); p(-3, -3, 1, 2 + s, O); p(1, -3, 1, 3 - s, O); p(3, -3, 1, 2 + s, O);
      p(-6, -7, 10, 4, O); for (const sx of [-4, -1, 2]) p(sx, -7, 1, 3, INK); p(-7, -8 + (Math.floor(T * 3) % 2), 1, 2, O);
      p(3, -9, 4, 4, O); p(5, -7, 2, 1, Wt); p(5, -8, 1, 1, INK); p(4, -10, 1, 1, O);
    } },
    duck: { w: 9, h: 8, speed: 7, night: 'sleep', water: true, draw(p, pose, T, look = 'drake', wear = {}) {
      if ((pose === 'swim' || pose === 'dabble' || pose === 'sleep') && !wear.ice) p(-4, -1, 8, 1, '#2c4a85'); // the water round it (none on ice)
      if (look === 'duckling') { const Y = '#ffd43b'; p(-2, -3, 3, 2, Y); p(0, -4, 2, 2, Y); p(2, -3, 1, 1, '#f08a24'); p(1, -4, 1, 1, INK); return; }
      const body = look === 'hen' ? '#a8805a' : '#b9a68a', head = look === 'hen' ? '#8c6a46' : '#2f8a4a';
      if (pose === 'dabble') { p(-3, -3, 5, 2, body); p(-4, -5, 2, 2, body); return; } // bottom up, head under water
      p(-3, -4, 6, 3, body); p(-4, -4, 1, 1, body);
      if (pose === 'sleep') { p(1, -6, 2, 2, body); return; } // its head under a wing
      if (look !== 'hen') p(1, -5, 1, 1, '#ffffff');
      p(1, -7, 2, 3, head); p(3, -6, 2, 1, '#f0b429'); p(2, -6, 1, 1, INK);
    } },
    cat: { w: 11, h: 9, speed: 12, night: 'awake', draw(p, pose, T) {
      const G = '#9aa4ad', D = '#5f6b7a';
      if (pose === 'sleep') { p(-3, -3, 6, 3, G); p(2, -4, 2, 2, G); p(-4, -2, 1, 2, D); return; }
      const s = legStep(pose, T);
      p(-3, -2, 1, 2 - s, D); p(2, -2, 1, 1 + s, D); p(-3, -5, 6, 3, G); p(-5, -7, 1, 3, D);
      p(2, -7, 3, 3, G); p(2, -8, 1, 1, G); p(4, -8, 1, 1, G); p(4, -6, 1, 1, INK);
    } },
    dog: { w: 11, h: 8, speed: 16, night: 'sleep', draw(p, pose, T) {
      const B = '#a8703c', D = '#6b4320';
      if (pose === 'sleep') { p(-4, -3, 8, 3, B); p(3, -4, 2, 2, B); return; }
      const s = legStep(pose, T);
      p(-3, -3, 1, 3 - s, D); p(2, -3, 1, 2 + s, D); p(-4, -6, 8, 3, B); p(-5, -7 + (Math.floor(T * 8) % 2), 1, 2, B);
      p(3, -8, 3, 3, B); p(3, -8, 1, 2, D); p(5, -7, 1, 1, INK);
    } },
    pigeon: { w: 7, h: 5, speed: 6, night: 'sleep', draw(p, pose) {
      const G = '#9aa4ad', D = '#5f6b7a';
      p(-2, -3, 4, 3, G); p(-3, -3, 1, 1, D);
      if (pose !== 'sleep') { p(1, -5, 2, 2, G); p(3, -4, 1, 1, '#f08a24'); }
    } },
    mouse: { w: 7, h: 3, speed: 14, night: 'awake', draw(p) {
      const G = '#9aa4ad';
      p(-2, -2, 3, 2, G); p(1, -2, 1, 1, '#e8a3a3'); p(-3, -1, 1, 1, '#e8a3a3');
    } },
    fish: { w: 7, h: 4, speed: 6, night: 'sleep', water: true, draw(p) {
      const O = '#f08a24';
      p(-2, -3, 4, 2, O); p(-3, -4, 1, 1, O); p(-3, -2, 1, 1, O); p(1, -3, 1, 1, INK);
    } },
    robodog: { w: 10, h: 8, speed: 16, night: 'sleep', draw(p, pose, T) { // a little chrome terrier, its tail an antenna with a red tip that blinks
      const B = '#c3cbd2', D = '#5f6b7a', H = '#e6eef5', S = '#9aa4ad';
      if (pose === 'sleep') { // curled up, its standby light blinking green
        p(-4, -3, 7, 3, B); p(-4, -3, 7, 1, S); p(-3, -2, 2, 1, H); p(-4, -1, 7, 1, D); p(2, -4, 3, 3, B); p(2, -4, 3, 1, S); p(2, -5, 1, 1, D); p(3, -3, 1, 1, S);
        p(-5, -2, 1, 1, D); p(-1, -2, 1, 1, Math.floor(T * 1.5) % 2 ? '#6cc04a' : '#2f6b2f');
        return;
      }
      const s = legStep(pose, T), moving = pose === 'walk' || pose === 'run', down = pose === 'eat' ? 1 : 0, wag = pose === 'happy' ? Math.floor(T * 8) % 2 : 0;
      p(-4, -2, 1, 2 - s, D); p(1, -2, 1, 2 - s, D); p(-2, -2, 1, moving ? 1 + s : 2, D); p(3, -2, 1, moving ? 1 + s : 2, D); // legs, trotting in diagonal pairs
      p(-4, -5, 7, 3, B); p(-4, -5, 7, 1, S); p(-4, -3, 7, 1, D); p(-3, -4, 2, 1, H); p(0, -4, 1, 1, S); // its body: slate edges (it reads on the pale belt), a shine, a seam
      p(-5, -7, 1, 3, D); p(-5 + wag, -8, 1, 1, Math.floor(T * 2) % 2 ? '#ff6b6b' : '#9c3b30'); // the antenna tail
      p(2, -7 + down, 3, 3, B); p(2, -7 + down, 3, 1, S); p(2, -6 + down, 1, 1, H); p(2, -8 + down, 1, 1, D); p(4, -8 + down, 1, 1, D); // its head and ears
      p(3, -6 + down, 1, 1, '#2c4a85'); p(4, -5 + down, 1, 1, INK); p(3, -4 + down, 2, 1, S); // an eye, its nose, its beard
    } },
    vacuum: { w: 9, h: 4, speed: 6, night: 'sleep', draw(p, pose, T) { // a round robot vacuum: a ring light on top, a dark skirt, a brush that turns as it goes
      const TOP = '#e6eef5', RIM = '#9aa4ad', SIDE = '#c3cbd2', SKIRT = '#3a3a40';
      const ring = pose === 'sleep' ? '#2c4a85' : pose === 'happy' ? '#5ab4ff' : '#3d7be0'; // off asleep, bright when pleased
      p(-2, -4, 5, 1, RIM); p(-1, -4, 3, 1, ring); // its top's far rim, the ring's far side
      p(-4, -3, 9, 1, TOP); p(-4, -3, 1, 1, RIM); p(4, -3, 1, 1, RIM); p(-2, -3, 1, 1, ring); p(2, -3, 1, 1, ring); p(0, -3, 1, 1, '#ffffff'); // its top: the ring's near sides round its button
      p(-4, -2, 9, 1, SIDE); p(-3, -1, 7, 1, SKIRT);
      if (pose === 'walk' || pose === 'run' || pose === 'eat') p(Math.floor(T * (pose === 'run' ? 16 : 8)) % 2 ? 4 : 3, -1, 1, 1, '#ffd43b'); // its side brush, turning
    } },
  };

  // The poses every creature knows beyond its own: a yawn and a start stand (a start one pixel up), a
  // stretch and a roll lie down; the duck slides on ice as it stands. Then each creature's touches for
  // them, and what it wears (a scarf, a hat in its mouth, a bucket).
  const POSE_AS = { yawn: 'stand', startled: 'stand', stretch: 'sleep', roll: 'sleep', slide: 'stand' };
  const LEGS = { cow: INK, goat: '#8c7b62', sheepdog: '#8a93a0', lion: '#8a5a2b', tiger: '#e8792b', cat: '#5f6b7a', dog: '#6b4320', robodog: '#5f6b7a' };
  const belly = (colour, legs) => p => { p(-4, -4, 8, 2, colour); for (const x of [-4, -2, 1, 3]) p(x, -6, 1, 2, legs); }; // on its back, legs in the air
  const TOUCH = {
    lion: { yawn: p => p(6, -7, 1, 2, '#5a1f19') },
    tiger: { yawn: p => p(6, -6, 1, 1, '#5a1f19') },
    cat: { yawn: p => p(4, -5, 1, 1, '#5a1f19') },
    sheepdog: { roll: belly('#e6eef5', '#8a93a0') },
    dog: { roll: belly('#c98d4f', '#6b4320') },
    robodog: { roll: belly('#e6eef5', '#5f6b7a') },
  };
  for (const [kind, c] of Object.entries(CREATURES)) {
    const own = c.draw, touch = TOUCH[kind] ?? {};
    c.draw = (p0, pose0, T, look, wear = {}) => {
      if (touch[pose0] && pose0 === 'roll') { touch.roll(p0); return; }
      const p = pose0 === 'startled' ? (dx, dy, w, h, colour) => p0(dx, dy - 1, w, h, colour) : p0;
      own(p, POSE_AS[pose0] ?? pose0, T, look, wear);
      if (pose0 !== 'roll') touch[pose0]?.(p);
      if (pose0 === 'stretch' && LEGS[kind]) p(Math.floor(c.w / 2) - 3, -2, 2, 1, LEGS[kind]); // front legs forward
      if (kind === 'goat' && wear.scarf) { p(2, -7, 3, 1, '#e04a3a'); p(1, -6, 1, 2, '#e04a3a'); }
      if (kind === 'goat' && wear.hat) p(5, -9, 2, 2, wear.hat);
      if (kind === 'ostrich' && wear.bucket) { p(4, -13, 2, 3, '#8a93a0'); p(4, -13, 2, 1, '#c3cbd2'); }
    };
  }

  Object.assign(globalThis, { CREATURES, creaturePainter });
})();
