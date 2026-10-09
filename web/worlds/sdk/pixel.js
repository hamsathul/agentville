// The pixel kit every world can draw with: the drawing helpers, one palette with a sky by the clock and
// light at night, the pixel font for crisp names and signs, and particles. Plain script in a world's
// frame: its names are shared with the engine and the world (a world of your own should keep its own
// names inside a function, so they don't collide with these). No dependencies.
'use strict';

/* ---------- drawing helpers ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A name shortened in the middle, so both ends stay readable: inventory_management → inventor…agement. */
const cutMid = (s, n) => {
  const t = String(s ?? '');
  if (t.length <= n) return t;
  const head = Math.ceil((n - 1) / 2);
  return `${t.slice(0, head)}…${t.slice(t.length - (n - 1 - head))}`;
};
/** A farmer's name tag: on the porch just its name, short enough to sit beside its neighbours; in the field its hearts and chores too. */
function tagText(f) {
  const onPorch = (f.state === 'waiting' || f.state === 'turn') && !f.nap;
  if (onPorch) return cutMid(f.name, 10);
  if (f.kind === 'codex') return cutMid(f.name, 16);
  return `${cutMid(f.name, 16)} ${'♥'.repeat(f.hearts)}${'♡'.repeat(4 - f.hearts)}${f.tasks ? ` ${f.tasks.done}/${f.tasks.total}` : ''}`;
}
const ago = ms => {
  const m = Math.max(0, (Date.now() - ms) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const PXG = { ctx: null, T: 0, k: 1, lights: null, ext: null }; // ext: the world drawn, past the farm's own edges when the frame has room // the canvas being drawn now, the animation clock, device pixels per world pixel, lights to glow at night
const px = (x, y, w, h, c) => { PXG.ctx.fillStyle = ink(c); PXG.ctx.fillRect(x, y, w, h); };
const SC = 1; // one sprite pixel = one world pixel, the same pixels as the land
const blink = (hz, n = 2) => Math.floor(PXG.T * hz) % n;
// A sprite pixel lands on whole device pixels, so a scale like 1.5× stays crisp (no soft edges).
const snap = v => Math.round(v * PXG.k) / PXG.k;
const rpAt = (ox, oy) => Object.assign((x, y, w, h, c) => {
  const x0 = snap(ox + x * SC), y0 = snap(oy + y * SC);
  px(x0, y0, snap(ox + (x + w) * SC) - x0, snap(oy + (y + h) * SC) - y0, c);
}, { ox, oy });
const legFrame = b => (b.walk ? walkFrame(PXG.T).legs : 's');
const pixelOrigin = (b, SH) => [snap(Math.round(b.x) - 7 * SC), snap(Math.round(b.y) - SH * SC + (b.walk && walkFrame(PXG.T).bob ? -SC : 0))];
function makeSprite(rows, pal) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') { g.fillStyle = pal[r[x]]; g.fillRect(x, y, 1, 1); } });
  return c;
}
function bubble(rp, x, y, glyph) {
  rp(x, y, 9, 8, '#15191e'); rp(x + 1, y + 1, 7, 6, '#ffffff'); rp(x + 1, y + 8, 1, 2, '#15191e');
  if (glyph === '!') { rp(x + 4, y + 2, 1, 3, '#d03b3b'); rp(x + 4, y + 6, 1, 1, '#d03b3b'); }
  else if (glyph === 'plan') { rp(x + 2, y + 2, 5, 4, '#f4ecd8'); rp(x + 2, y + 2, 5, 1, '#c9a24a'); rp(x + 2, y + 5, 5, 1, '#c9a24a'); rp(x + 3, y + 3, 3, 1, '#9aa4ad'); }
  else if (glyph === '?') { rp(x + 3, y + 2, 3, 1, '#c98500'); rp(x + 5, y + 3, 1, 1, '#c98500'); rp(x + 4, y + 4, 1, 1, '#c98500'); rp(x + 4, y + 6, 1, 1, '#c98500'); }
  else for (const [dx, dy] of [[2, 4], [3, 5], [4, 4], [5, 3], [6, 2]]) rp(x + dx, y + dy, 1, 1, '#0ca30c');
}

/* ---------- one palette, the sky by the clock, light at night ---------- */

// The farm's colours, in ramps from dark to light. Everything painted is snapped to the nearest
// one, so the whole farm keeps one look. Each repo's fence and soil, and the skin tones, are in it
// exactly so they stay apart.
const RAMPS = {
  ink: ['#1b1420', '#2a1d14'],
  wood: ['#4e3626', '#6b4320', '#8b5a2b', '#a8703c', '#c98d4f', '#e2b07a'],
  soil: ['#5e3d22', '#6b4a35', '#705a3a', '#7a4632', '#7a5230', '#86603a'],
  path: ['#8a7140', '#9a7442', '#b08850', '#c9a46a', '#dcc08a'],
  grass: ['#1f3d1a', '#2f5a2a', '#3f7d3a', '#4f8f3a', '#5d9b46', '#6aa84f', '#7fbf5a'],
  leaf: ['#1c3320', '#264a2a', '#2f6b2f', '#3f9b3a', '#6cc04a', '#9ed36a', '#c6e89a', '#6b8f4a'],
  autumn: ['#6b7a35', '#8a8f3a', '#b5562f', '#c8681a', '#e9a23b'],
  stone: ['#3a3a40', '#5f6b7a', '#5f7f9a', '#8a8f96', '#9aa4ad', '#c3cbd2', '#e6eef5'],
  water: ['#2c4a85', '#3d7be0', '#5ab4ff', '#a9dcf7'],
  dusk: ['#5a3b85', '#8a5fc0', '#d55181', '#f4b6c2'],
  red: ['#5a1f19', '#6b2a22', '#9c3b30', '#b23a2e', '#e04a3a', '#ff6b6b'],
  sun: ['#f08a24', '#f0b429', '#ffd43b', '#e9c46a', '#f4d58d', '#ffe8a3'],
  cream: ['#c9a24a', '#c9b48a', '#d4c294', '#e8d8b0', '#f4ecd8', '#ffffff'],
  skin: ['#f1c7a1', '#e0a878', '#c68a5a', '#9c6644', '#7d5236'],
  bright: ['#2fa57a', '#ff5a1f'],
};
const PALETTE = [...new Set(Object.values(RAMPS).flat())]; // shirts stay exact: they are the agents' colours in the list
const inked = new Map(PALETTE.map(c => [c, c]));
const rgbOf = hex => {
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, d => d + d) : hex;
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
};
/** The palette colour nearest to a colour (weighted RGB distance), remembered. */
function ink(c) {
  const hit = inked.get(c);
  if (hit) return hit;
  if (typeof c !== 'string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c)) return c;
  const [r, g, b] = rgbOf(c.toLowerCase());
  let best = PALETTE[0], bestD = Infinity;
  for (const p of PALETTE) {
    const [pr, pg, pb] = rgbOf(p), rm = (r + pr) / 2;
    const d = (2 + rm / 256) * (r - pr) ** 2 + 4 * (g - pg) ** 2 + (2 + (255 - rm) / 256) * (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  inked.set(c, best);
  return best;
}

/** The light of the hour, by your clock: { phase, light (0 at night … 1 by day), sun, moon }. */
function skyAt(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  const phase = h >= 7 && h < 18 ? 'day' : h >= 5 && h < 7 ? 'dawn' : h >= 18 && h < 20 ? 'dusk' : 'night';
  const light = phase === 'day' ? 1 : phase === 'dawn' ? (h - 5) / 2 : phase === 'dusk' ? 1 - (h - 18) / 2 : 0;
  const arc = (t, lo, hi) => ({ x: Math.round(14 + t * (W - 28)), y: Math.round(12 - Math.sin(t * Math.PI) * 10), lo, hi }); // left to right, high at midday
  const sun = h >= 5.5 && h < 20 ? arc((h - 5.5) / 14.5) : null;
  const nh = (h + 24 - 19.5) % 24; // the moon: from 19:30 to 6:00
  const moon = !sun || phase === 'dusk' || phase === 'dawn' ? (nh < 10.5 ? arc(nh / 10.5) : null) : null;
  return { phase, light, sun, moon: sun && phase === 'day' ? null : moon, hour: h };
}
/** A puffy cloud, w wide: three bumps on a flat base, lit on top, shaded underneath. */
function drawCloud(x, y, w, [light, mid, dark]) {
  const b = Math.round(w / 3);
  px(x + 1, y + 4, w - 2, 4, mid); px(x, y + 5, w, 2, mid);
  px(x + Math.round(w * 0.1), y + 1, b, 4, mid); px(x + Math.round(w * 0.36), y - 1, b + 2, 6, mid); px(x + Math.round(w * 0.66), y + 1, b - 2, 4, mid);
  px(x + Math.round(w * 0.14), y + 1, b - 4, 1, light); px(x + Math.round(w * 0.4), y - 1, b - 2, 1, light); px(x + Math.round(w * 0.7), y + 1, b - 5, 1, light);
  px(x + 2, y + 7, w - 4, 1, dark);
}
/** Two colours mixed: t = 0 gives a, 1 gives b. */
function blend(a, b, t) {
  const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b);
  return `#${[ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
/**
 * Night falls over everything drawn so far (a tint, warm at dawn and dusk), then the lights glow:
 * the farmhouse windows, the barn lamp, lanterns in farmers' hands.
 */
let lightMap = null; // the night's darkness, one pixel per world pixel, with the lit places cut out
function drawNight(sky, H, lights) {
  const ctx = PXG.ctx, dark = 1 - sky.light;
  if (dark < 0.02 || typeof document === 'undefined') return;
  const e = PXG.ext ?? { x0: 0, x1: W, y0: 0, y1: H }, w = e.x1 - e.x0, h = e.y1 - e.y0;
  // Laid over the farm with multiply: white leaves a pixel as it is, the shade darkens it. So
  // the darkness is the shade mixed toward white by its strength, and a light is a round hole in
  // it, in five soft steps to warm white in the middle: lit places keep their colours, no fog.
  const darkness = blend('#ffffff', sky.phase === 'night' ? '#3c4a8c' : '#c26a7a', Math.min(0.7, dark * 0.7));
  lightMap ??= document.createElement('canvas');
  if (lightMap.width !== w || lightMap.height !== h) { lightMap.width = w; lightMap.height = h; }
  const g = lightMap.getContext('2d');
  g.fillStyle = darkness;
  g.fillRect(0, 0, w, h);
  for (const [x, y, r] of lights) {
    for (let k = 5; k >= 1; k--) { // five steps from the edge in: a soft pixel glow
      const rr = Math.round((r * k) / 5);
      g.fillStyle = blend(darkness, '#fff4d6', [0.95, 0.75, 0.55, 0.35, 0.17][k - 1]);
      for (let dy = -rr; dy <= rr; dy++) { const half = Math.round(Math.sqrt(rr * rr - dy * dy)); g.fillRect(Math.round(x - e.x0 - half), Math.round(y - e.y0 + dy), half * 2, 1); }
    }
  }
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lightMap, e.x0, e.y0);
  ctx.globalCompositeOperation = 'source-over';
  for (const [, , , core] of lights) { // lit windows and lamps: they are the lights
    if (!core) continue;
    const [cx, cy, cw, ch, panes] = core;
    px(cx, cy, cw, ch, dark > 0.5 ? '#ffd43b' : '#f4d58d');
    if (panes) { px(cx + (cw >> 1), cy, 1, ch, '#6b4320'); px(cx, cy + (ch >> 1), cw, 1, '#6b4320'); } // the window frame
  }
}

/* ---------- the pixel font: names, field names, counts and signs ---------- */

// A hand-drawn 5×9 font (rows 0–6 above the line, 7–8 below): each glyph is its width, then
// nine rows as base-32 bit patterns. Text in it is an image; the words stay in the page too.
const FONT = {'A': '5ehhvhhh00', 'B': '5uhhuhhu00', 'C': '5ehggghe00', 'D': '5uhhhhhu00', 'E': '5vgguggv00', 'F': '5vgguggg00', 'G': '5ehgnhhf00', 'H': '5hhhvhhh00', 'I': '3722222700', 'J': '57222iic00', 'K': '5hikokih00', 'L': '5ggggggv00', 'M': '5hrllhhh00', 'N': '5hpljhhh00', 'O': '5ehhhhhe00', 'P': '5uhhuggg00', 'Q': '5ehhhlid00', 'R': '5uhhukih00', 'S': '5ehge1he00', 'T': '5v44444400', 'U': '5hhhhhhe00', 'V': '5hhhhha400', 'W': '5hhhllrh00', 'X': '5hha4ahh00', 'Y': '5hha444400', 'Z': '5v1248gv00', 'a': '500e1fhf00', 'b': '5gguhhhu00', 'c': '4007888700', 'd': '511fhhhf00', 'e': '500ehvge00', 'f': '3347444400', 'g': '500fhhhf1e', 'h': '5gguhhhh00', 'i': '1101111100', 'j': '3101111152', 'k': '4889aca900', 'l': '2222222100', 'm': '500qllll00', 'n': '500uhhhh00', 'o': '500ehhhe00', 'p': '500uhhhugg', 'q': '500fhhhf11', 'r': '400bc88800', 's': '500fge1u00', 't': '444e444300', 'u': '500hhhhf00', 'v': '500hhha400', 'w': '500hhlla00', 'x': '500ha4ah00', 'y': '500hhhhf1e', 'z': '500v248v00', '0': '5ehjlphe00', '1': '3262222700', '2': '5eh1248v00', '3': '5v2421he00', '4': '526aiv2200', '5': '5vgu11he00', '6': '568guhhe00', '7': '5v12488800', '8': '5ehhehhe00', '9': '5ehhf12c00', ' ': '3000000000', '!': '1111110100', '"': '3550000000', '#': '5aavavaa00', '$': '54fke5u400', '%': '5pp248jj00', '&': '5cik8lid00', '\'': '1110000000', '(': '2122222100', ')': '2211111200', '*': '504lel4000', '+': '5044v44000', ',': '2000001120', '-': '4000f00000', '.': '1000000100', '/': '5122488g00', ':': '1001001000', ';': '2001001120', '<': '4124842100', '=': '400f0f0000', '>': '4842124800', '?': '5eh1240400', '@': '5ehnlnge00', '[': '2322222300', '\\': '5g88422100', ']': '2311111300', '^': '54ah000000', '_': '5000000v00', '`': '2210000000', '{': '4344844300', '|': '1111111100', '}': '4c22122c00', '~': '5008l20000', '♥': '50avve4000', '♡': '50alha4000', '✓': '5012ic8000', '✗': '50ha4ah000', '◌': '50ah0ha000', '⏸': '50rrrrr000', '↑': '54el444400', '↓': '54444le400', '…': '5000000l00', '⚠': '54aalhlv00', '·': '1000100000', '—': '5000v00000', '–': '4000f00000', '’': '2120000000', '‘': '2210000000', '“': '3550000000', '”': '3550000000'};
/** A glyph: { w, rows } with each row a bit pattern (leftmost pixel = highest bit), or null. */
const glyphOf = ch => { const g = FONT[ch]; return g ? { w: Number(g[0]), rows: [...g.slice(1)].map(c => parseInt(c, 32)) } : null; };
/** A text's width in font pixels (a pixel between letters), or null when a character has no glyph. */
function textWidth(text) {
  let w = 0, n = 0;
  for (const ch of text) { const g = glyphOf(ch); if (!g) return null; w += g.w; n++; }
  return n ? w + n - 1 : 0;
}
const textImages = new Map();
/** A text drawn in the pixel font with a one-pixel shadow, as { url, w, h } (font pixels), or null. */
function textImage(text, color, shadow) {
  const key = `${text}\n${color}\n${shadow}`;
  if (textImages.has(key)) return textImages.get(key);
  const w = textWidth(text);
  if (w === null || !text || typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w + 1;
  c.height = 10;
  const g = c.getContext('2d');
  for (const [dx, col] of [...(shadow ? [[1, shadow]] : []), [0, color]]) {
    g.fillStyle = col;
    let x = 0;
    for (const ch of text) {
      const gl = glyphOf(ch);
      gl.rows.forEach((bits, y) => { for (let i = 0; i < gl.w; i++) if (bits & (1 << (gl.w - 1 - i))) g.fillRect(x + i + dx, y + dx, 1, 1); });
      x += gl.w + 1;
    }
  }
  const img = { url: c.toDataURL(), w: w + 1, h: 10 };
  if (textImages.size > 600) textImages.clear();
  textImages.set(key, img);
  return img;
}
/** Pixels per font pixel on screen: 1.5 on a Retina screen (3 device pixels), 2 on a plain one, so it stays sharp. */
const fontPx = () => { const dpr = window.devicePixelRatio || 1; return Math.max(1, Math.round(1.5 * dpr)) / dpr; };
/** A text in the pixel font as an image only (hidden from screen readers), or the plain text if it has a letter the font lacks. */
function pxImg(text, color = '#f4ecd8', shadow = '#1b1420') {
  const t = String(text ?? '');
  const img = textImage(t, color, shadow);
  if (!img) return `<span aria-hidden="true">${esc(t)}</span>`;
  const s = fontPx();
  return `<i class="pxt" aria-hidden="true" style="width:${(img.w * s).toFixed(1)}px;height:${(img.h * s).toFixed(1)}px;background-image:url(${img.url})"></i>`;
}
/** HTML for a text in the pixel font (its words stay for screen readers, copying and search), or plain text if it has a letter the font lacks. */
function pxt(text, color = '#f4ecd8', shadow = '#1b1420') {
  const t = String(text ?? '');
  return textImage(t, color, shadow) ? `${pxImg(t, color, shadow)}<span class="px-sr">${esc(t)}</span>` : esc(t);
}

/* ---------- particles: dust, splashes, chips, smoke, leaves, snow ---------- */

/** Moves particles (speed, then gravity), fades them, and drops the ones whose life ran out. */
function stepParticles(parts, dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += (p.g ?? 0) * dt;
    if (p.grow) p.size += p.grow * dt;
    if (p.sway) p.x += Math.sin((p.max - p.life) * p.sway) * 0.3; // leaves and snow drift as they fall
  }
  return parts;
}
function drawParticles(parts) {
  for (const p of parts) {
    PXG.ctx.globalAlpha = (p.alpha ?? 1) * Math.min(1, (p.life / p.max) * 2);
    const s = Math.max(1, Math.round(p.size ?? 1));
    px(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s, p.color);
  }
  PXG.ctx.globalAlpha = 1;
}
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
