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
      if (pose === 'sleep' || pose === 'hide') { p(-4, -5, 7, 4, INK); p(-4, -4, 1, 1, '#f4f1ea'); if (pose === 'hide') p(3, -1, 1, 1, N); else p(3, -3, 2, 1, N); return; }
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
    duck: { w: 9, h: 8, speed: 7, night: 'sleep', water: true, draw(p, pose, T, look = 'drake') {
      if (pose === 'swim' || pose === 'dabble' || pose === 'sleep') p(-4, -1, 8, 1, '#2c4a85'); // the water round it
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
  };

  Object.assign(globalThis, { CREATURES, creaturePainter });
})();
