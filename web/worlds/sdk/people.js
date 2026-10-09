// The people kit: a person in pixels, from a body and an outfit (docs/worlds.md, "The people kit").
// 14 × 16 pixels, seen from the front, from behind and from the side (the other side is its mirror),
// standing or in a walking frame. The farm's farmers are this kit in farm clothes. A classic script in a
// world's frame, after pixel.js (makeSprite, ink, shade); it adds only window.Agentville.people.
(() => {
  'use strict';

  const hashOf = id => {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  };
  /** One of n choices for an id; each salt mixes the hash differently, so the choices don't move together. */
  const pick = (id, salt, n) => {
    let h = hashOf(id) ^ Math.imul(salt, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) % n;
  };

  // One letter per pixel, '.' clear: k outline · h hat · w its light · b its band (or brim) · r hair · s skin ·
  // g glass · p cheeks · C shirt (the agent's colour) · c its shade · o the bottom's colour · O its shade · P a pole.
  // Headwear: five rows above the face. `frame`, when given, is laid over the four face rows (a helmet's sides).
  const HEADS = {
    straw: { rows: ['.....kkkk.....', '....kwwhhk....', '...khhhhhhk...', '..kbbbbbbbbk..', '.khhhhhhhhhhk.'] },
    cap: { rows: ['..............', '.....kkkk.....', '....kwwhhk....', '...khhhhhhk...', '...kbbbbbbbbk.'] },
    beanie: { rows: ['......kk......', '.....kbbk.....', '....kwwhhk....', '...khhhhhhk...', '...kbbbbbbk...'] },
    bandana: { rows: ['..............', '....kkkkkk....', '...kwwhhhhk...', '...khbhhbhkhk.', '...khhhhhhk.h.'] },
    none: { rows: ['..............', '....kkkkkk....', '...krrrrrrk...', '...krrrrrrk...', '...krrrrrrk...'] },
  };
  // The face from the front, the back of the head, and the face from the side (facing right: hair at the
  // back, a nose). The world draws the eyes on top (row 6, or 7 looking down at its work).
  const FRONT_FACE = look => [
    '...krssssrk...',
    look.extra === 'glasses' ? '...kggkkggk...' : '...kssssssk...',
    look.extra === 'beard' ? '...krssssrk...' : look.extra === 'cheeks' ? '...kpsssspk...' : '...kssssssk...',
    look.extra === 'beard' ? '....krrrrk....' : '....kkkkkk....',
  ];
  const BACK_HEAD = ['...krrrrrrk...', '...krrrrrrk...', '...krrrrrrk...', '....kkkkkk....'];
  const SIDE_FACE = look => [
    '...krrsssssk..',
    look.extra === 'glasses' ? '...krssggggk..' : '...krssssssk..',
    look.extra === 'beard' ? '...krssrrrrrk.' : look.extra === 'cheeks' ? '...krsspssssk.' : '...krsssssssk.',
    look.extra === 'beard' ? '....krrrrrk...' : '....kkkkkkk...',
  ];
  // Tops: four torso rows for each view (down: the front, up: the back, right: the side); the hands are
  // the s at each side of the last row.
  const TOPS = {
    shirt: {
      down: ['..kCCCCCCCck..', '.kCCCCCCCCcck.', '.kCCCCCCCCCck.', '.ks.CCCCCC.sk.'],
      up: ['..kCCCCCCCck..', '.kCCCCCCCCcck.', '.kCCCCCCCCCck.', '.ks.CCCCCC.sk.'],
      right: ['...kCCCCCck...', '...kCCCCCck...', '...kCCCCCck...', '...kCCCCCck...'],
    },
  };
  // Bottoms: a bib laid over the top (overalls), the hips, and the legs in each walking frame: s standing,
  // a and b a step with each foot, p a pole (a scarecrow's); from the front, and from the side.
  const LEGS = { s: ['...koo..ook...', '...kkk..kkk...'], a: ['...koo..ook...', '...kkk........'], b: ['...koo..ook...', '........kkk...'], p: ['......PP......', '......PP......'] };
  const SIDE_LEGS = { s: ['.....kook.....', '.....kkkk.....'], a: ['....ko..ok....', '...kk....kk...'], b: ['.....koko.....', '....kk..kk....'] };
  const BOTTOMS = {
    overalls: {
      bib: {
        down: ['..............', '....o....o....', '....oooooo....', '....oooooO....'],
        up: ['..............', '.....o..o.....', '....oooooo....', '....oooooO....'],
        right: ['..............', '......o.......', '.....oooo.....', '....ooooOo....'],
      },
      hips: '...koooooOk...', legs: LEGS, sideLegs: SIDE_LEGS,
    },
  };
  // Extras: beard, glasses and cheeks are drawn into the face (FRONT_FACE, SIDE_FACE); `torso`, when
  // given, is laid over the torso rows in the views it names.
  const EXTRAS = { none: {}, beard: {}, glasses: {}, cheeks: {} };
  // What a look without a part, or with one the kit lacks, wears.
  const DEFAULT = { hat: 'none', top: 'shirt', bottom: 'overalls', extra: 'none' };

  /** Row b with row t laid over it: t's letters win, its dots let b show. */
  const over = (b, t) => (t ? [...b].map((ch, i) => (t[i] && t[i] !== '.' ? t[i] : ch)).join('') : b);
  const unknown = new Set(); // parts asked for that the kit doesn't have ('hat:hardhatt'): drawn as the default; check-world lists them
  const part = (table, kind, name) => {
    if (name != null && Object.hasOwn(table, name)) return table[name];
    if (name != null) unknown.add(`${kind}:${name}`);
    return table[DEFAULT[kind]];
  };
  /** A person's rows: 16 strings of 14 letters, for a view (down, up, right, left) and a leg frame (s, a, b, p). */
  function rows(look, view = 'down', legs = 's') {
    if (view === 'left') return rows(look, 'right', legs).map(r => [...r].reverse().join(''));
    const v = view === 'up' || view === 'right' ? view : 'down';
    const head = part(HEADS, 'hat', look.hat), top = part(TOPS, 'top', look.top);
    const bottom = part(BOTTOMS, 'bottom', look.bottom), extra = part(EXTRAS, 'extra', look.extra);
    const face = (v === 'up' ? BACK_HEAD : v === 'right' ? SIDE_FACE(look) : FRONT_FACE(look)).map((r, i) => over(r, head.frame?.[i]));
    const torso = top[v].map((r, i) => over(over(r, bottom.bib?.[v]?.[i]), extra.torso?.[v]?.[i]));
    const feet = v === 'right' ? bottom.sideLegs[legs] ?? bottom.sideLegs.s : bottom.legs[legs] ?? bottom.legs.s;
    return [...head.rows, ...face, ...torso, bottom.hips, ...feet];
  }

  const K = '#2a1d14';
  // The colours that come with the clothes; the rest come from the look and the agent's colour.
  const FIXED = { k: K, g: '#e6eef5', p: '#e58a8a', P: '#6b4320' };
  const HAIR = ['#2b1d14', '#5a3a22', '#a0522d', '#d9b26a', '#9a9a9a'];
  const SKIN = ['#f1c7a1', '#e0a878', '#c68a5a', '#9c6644', '#7d5236'];
  const BOTTOM_COLORS = ['#3c5a99', '#6b4f2a', '#4a4a52', '#2f6b4f', '#7a3b5a'];
  const HAT_COLORS = [['#d64545', '#8e2b2b'], ['#4f9d4a', '#2f6b2f'], ['#4a74c9', '#2c4a85'], ['#8a5fc0', '#5a3b85'], ['#ece6d6', '#9a9488'], ['#3a3a40', '#c9a24a'], ['#e58a2e', '#9a5212']];
  /**
   * Each letter's colour for a look and its agent's colour, with `overrides` on top. All are snapped to the
   * pixel kit's palette but the shirt (exact: the agent's colour in the list) and the hat's light.
   */
  function palette(look, shirt, overrides = null) {
    const hat = look.hatColor ?? HAT_COLORS[0][0], bottom = look.bottomColor === 'shirt' ? shirt : look.bottomColor ?? BOTTOM_COLORS[0];
    const pal = { ...FIXED, h: hat, w: shade(hat, 1.3), b: look.band ?? HAT_COLORS[0][1], r: look.hair ?? HAIR[0], s: look.skin ?? SKIN[0], C: shirt, c: shade(shirt, 0.78), o: bottom, O: shade(bottom, 0.75), ...overrides };
    for (const k of Object.keys(pal)) if (!'Cwc'.includes(k)) pal[k] = ink(pal[k]);
    return pal;
  }
  const sprites = new Map();
  /**
   * A person's sprite, a 14 × 16 canvas, made once: `view` down, up, right or left; `legs` a walking frame
   * (s, a, b, or p for a pole); `wave` one arm up (from the front); `palette` letters' colours over the look's.
   */
  function sprite(look, shirt, { view = 'down', legs = 's', wave = false, palette: overrides = null } = {}) {
    const key = `${JSON.stringify(look)}|${shirt}|${overrides ? JSON.stringify(overrides) : ''}|${legs}|${wave}|${view}`;
    if (sprites.has(key)) return sprites.get(key);
    const pal = palette(look, shirt, overrides);
    const c = makeSprite(rows(look, view, legs), pal);
    if (wave && view === 'down') { // one arm up, waving
      const g = c.getContext('2d');
      g.clearRect(11, 11, 2, 2); g.fillStyle = shirt; g.fillRect(12, 5, 1, 6); g.fillStyle = pal.s; g.fillRect(12, 3, 1, 2); g.fillStyle = K; g.fillRect(13, 3, 1, 8);
    }
    sprites.set(key, c);
    return c;
  }
  /**
   * A look for an agent from an outfit: each field one value or a list to pick from by the agent's id (the
   * same agent always looks the same); hatColors pairs [hat, band], or { <hat>: pairs, '*': pairs }.
   */
  function lookFor(agent, outfit = {}) {
    const id = agent?.id ?? '';
    const choose = (v, salt) => (Array.isArray(v) ? v[pick(id, salt, v.length)] : v);
    const hat = choose(outfit.hat ?? DEFAULT.hat, 1);
    const hc = outfit.hatColors, pairs = Array.isArray(hc) ? hc : hc?.[hat] ?? hc?.['*'] ?? HAT_COLORS;
    const [hatColor, band] = pairs[pick(id, 2, pairs.length)];
    return {
      hat, hatColor, band, hair: choose(outfit.hair ?? HAIR, 3), skin: choose(outfit.skin ?? SKIN, 4),
      top: choose(outfit.top ?? DEFAULT.top, 7), bottom: choose(outfit.bottom ?? DEFAULT.bottom, 8),
      bottomColor: choose(outfit.bottomColors ?? BOTTOM_COLORS, 5), extra: choose(outfit.extra ?? DEFAULT.extra, 6),
    };
  }

  window.Agentville.people = {
    HATS: Object.keys(HEADS), TOPS: Object.keys(TOPS), BOTTOMS: Object.keys(BOTTOMS), EXTRAS: Object.keys(EXTRAS),
    HAIR, SKIN, BOTTOM_COLORS, HAT_COLORS, hashOf, pick, lookFor, rows, palette, sprite, unknown,
  };
})();
