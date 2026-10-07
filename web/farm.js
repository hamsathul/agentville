// The Pixel farm: a second way to look at the dashboard. Every agent is a farmer, every repo a
// field. Classic script, no dependencies. The canvas code reads only the scene toScene() builds
// from the snapshot; text (names, signs, counts) is HTML laid over the canvas so it stays crisp.
(() => {
  'use strict';

  /* ---------- the scene: what the farm draws, from the snapshot (pure, tested) ---------- */

  const SHIRT = ['#d9673a', '#4a7bd0', '#2fa57a', '#8a6fd8', '#d55181', '#c99a16', '#e05555', '#3c9c3c'];
  const hashOf = id => {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  };
  // Shirt colour follows the agent's id, never its place in the list, so colours don't jump.
  const colorIndex = id => hashOf(id) % SHIRT.length;
  /** One of n choices for an id; each salt mixes the hash differently, so the choices don't move together. */
  const pick = (id, salt, n) => {
    let h = hashOf(id) ^ Math.imul(salt, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) % n;
  };

  // What makes each farmer look like itself, besides its shirt: hat, hair, skin, overalls, an extra.
  const HATS = ['straw', 'cap', 'beanie', 'bandana', 'none'];
  const STRAW = [['#e9c46a', '#b5562f'], ['#e2c27a', '#3c5a99'], ['#f0d58c', '#2f6b2f'], ['#d4ad55', '#8e2b2b']]; // [hat, band]
  const DYED = [['#d64545', '#8e2b2b'], ['#4f9d4a', '#2f6b2f'], ['#4a74c9', '#2c4a85'], ['#8a5fc0', '#5a3b85'], ['#ece6d6', '#9a9488'], ['#3a3a40', '#c9a24a'], ['#e58a2e', '#9a5212']];
  const CODEX_CAPS = [['#5d7184', '#2a3644'], ['#4a7a8c', '#22404a'], ['#7a8a9c', '#3a4452'], ['#3f4f66', '#cfd8e3']]; // slate caps
  const HAIR = ['#2b1d14', '#5a3a22', '#a0522d', '#d9b26a', '#9a9a9a'];
  const SKIN = ['#f1c7a1', '#e0a878', '#c68a5a', '#9c6644', '#7d5236'];
  const OVERALLS = ['#3c5a99', '#6b4f2a', '#4a4a52', '#2f6b4f', '#7a3b5a'];
  const EXTRAS = ['none', 'beard', 'glasses', 'cheeks'];
  function lookOf(a) {
    const hat = a.kind === 'codex' ? 'cap' : HATS[pick(a.id, 1, HATS.length)];
    const colors = a.kind === 'codex' ? CODEX_CAPS[pick(a.id, 2, CODEX_CAPS.length)] : hat === 'straw' ? STRAW[pick(a.id, 2, STRAW.length)] : DYED[pick(a.id, 2, DYED.length)];
    return {
      hat, hatColor: colors[0], band: colors[1], hair: HAIR[pick(a.id, 3, HAIR.length)], skin: SKIN[pick(a.id, 4, SKIN.length)],
      overalls: OVERALLS[pick(a.id, 5, OVERALLS.length)], extra: EXTRAS[pick(a.id, 6, EXTRAS.length)],
    };
  }
  // And each field, by its repo: what grows there and the colour of its fence. The branch is a pennant.
  const CROPS = ['wheat', 'corn', 'carrot', 'cabbage', 'sunflower', 'tomato', 'pumpkin'];
  const FENCES = ['#c98d4f', '#8a8f96', '#9c3b30', '#5f7f9a', '#6b8f4a', '#4e3626'];
  const SOILS = ['#7a5230', '#6b4a35', '#86603a', '#7a4632', '#705a3a'];
  const isMain = b => /^(main|master)$/.test(b ?? '');

  /** The season by the plan's 5-hour limit: spring while it is fresh, then summer, autumn, and winter when it is nearly used up. No reading: summer. */
  function seasonOf(plan) {
    const w = plan?.windows?.find(x => x.kind === 'five_hour');
    if (!w) return 'summer';
    const p = w.reset ? 0 : w.percentUsed;
    return p < 25 ? 'spring' : p < 60 ? 'summer' : p < 85 ? 'autumn' : 'winter';
  }
  /** The silo: the plan's weekly usage as grain, and a lamp near the limit (amber from 70%, red from 90%). */
  function siloOf(plan) {
    const w = plan?.windows?.find(x => x.kind === 'seven_day');
    if (!w) return null;
    const p = w.reset ? 0 : w.percentUsed;
    return { fill: Math.max(0, Math.min(1, p / 100)), lamp: p >= 90 ? 'red' : p >= 70 ? 'amber' : null, label: `${Math.round(p)}%`, resetsAt: w.resetsAt ?? null };
  }

  /** Share of the context window used: the list view's rule (1M window once past 200k). */
  function contextPct(tokens) {
    if (!tokens) return 0;
    return Math.min(1, tokens / (tokens > 200_000 ? 1_000_000 : 200_000));
  }

  /**
   * Weather over a field, from its last deploy (same rules as the list view's deploy chip): the
   * collector's lastDeploy (the newer of the Actions run and a direct deploy), or a bare Actions run.
   * A run GitHub never started (billing) brings no weather.
   */
  function weatherOf(deploy) {
    if (!deploy) return null;
    if (deploy.state) return { running: 'windmill', ok: 'rainbow', failed: 'rain' }[deploy.state] ?? null;
    if (deploy.status !== 'completed') return 'windmill';
    return deploy.conclusion === 'success' ? 'rainbow' : deploy.conclusion === 'failure' ? 'rain' : null;
  }

  /** The repo a farmer works in: its newest write, else its newest touch, else the repo holding its folder. */
  function fieldOf(agent, repos) {
    const known = new Set(repos.map(r => r.path));
    const newest = list => list.reduce((best, t) => (!best || t.lastAt > best.lastAt ? t : best), null);
    const touches = (agent.touching ?? []).filter(t => t.repo && known.has(t.repo));
    const pick = newest(touches.filter(t => t.mode === 'write' || t.mode === 'git')) ?? newest(touches);
    if (pick) return pick.repo;
    const cwd = agent.cwd || '';
    if (!cwd) return null;
    const holder = repos.filter(r => cwd === r.path || cwd.startsWith(`${r.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
    return holder?.path ?? null;
  }

  /** What a waiting farmer is asking, for its bubble and tooltip. */
  function askText(a) {
    if (a.ask?.kind === 'question') return a.ask.questions?.[0]?.question ?? a.stateReason ?? '';
    if (a.ask?.kind === 'permission') return `${a.ask.tool}: ${a.ask.summary}`;
    if (a.now?.tool === 'AskUserQuestion' && a.now.summary) return a.now.summary; // no offer from the mod: the transcript's question
    return a.stateReason ?? '';
  }

  /** A reply as plain text for a speech bubble: markdown markers and code blocks out, one line, clipped. */
  const spoken = (s, max = 160) => {
    const text = String(s ?? '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/\*\*|__|`/g, '').replace(/^\s*#{1,6}\s*/gm, '').replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const firstLine = (s, max = 90) => {
    const line = String(s ?? '').split('\n')[0].trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  };

  function toScene(snap, { cpuAlertPct = snap?.settings?.cpuAlertPct ?? 90 } = {}) {
    const repos = snap?.repos ?? [];
    const agents = snap?.agents ?? [];
    const kids = agents.map(a => a.children ?? []);
    return {
      plan: snap?.plan ?? null,
      // The henhouse: eggs for subagents that finished lately; running ones beyond the four a farmer leads roost there.
      henhouse: {
        eggs: Math.min(6, kids.flat().filter(c => c.state === 'done').length),
        roosting: kids.reduce((t, k) => t + Math.max(0, k.filter(c => c.state === 'running').length - 4), 0),
      },
      fields: repos.map(r => ({
        key: r.path, name: r.name, branch: r.branch ?? null, dirty: r.dirty ?? 0, ahead: r.ahead ?? 0, behind: r.behind ?? 0,
        weather: weatherOf(r.lastDeploy !== undefined ? r.lastDeploy : r.deploy), deploy: r.deploy ?? null, lastDeploy: r.lastDeploy ?? null,
        crop: CROPS[pick(r.path, 7, CROPS.length)], fence: FENCES[pick(r.path, 8, FENCES.length)], soil: SOILS[pick(r.path, 9, SOILS.length)],
        pennant: Boolean(r.branch) && r.branch !== '(detached)' && !isMain(r.branch),
        collision: (snap.collisions ?? []).find(c => c.repo === r.path)?.severity ?? null,
      })),
      farmers: (snap?.agents ?? []).map(a => {
        const pct = contextPct(a.contextTokens);
        return {
          id: a.id, name: a.name, kind: a.kind, state: a.state === 'yourTurn' ? 'turn' : a.state, field: fieldOf(a, repos),
          tool: a.now?.tool ?? a.feed?.find(f => f.kind === 'tool')?.tool ?? null, summary: a.now?.summary ?? '',
          step: a.now?.step ?? a.feed?.find(f => f.kind === 'tool')?.step ?? null, // test, push, install… (the collector reads commands)
          pct, hearts: Math.round((1 - pct) * 4), hot: (a.proc?.cpu ?? 0) >= cpuAlertPct,
          ask: askText(a), askKind: a.ask?.kind ?? null, question: a.question ?? null, reply: firstLine(a.lastReply),
          said: spoken((a.feed ?? []).find(f => f.kind === 'reply')?.body ?? (a.feed ?? []).find(f => f.kind === 'reply')?.text), color: colorIndex(a.id), shirt: SHIRT[colorIndex(a.id)], look: lookOf(a), cost: a.usage?.costUsd ?? null, mode: a.mode ?? null,
          kids: (a.children ?? []).filter(c => c.state === 'running').slice(0, 4).map(c => ({ id: c.id, dog: c.agentType === 'Explore' })),
        };
      }),
    };
  }

  /* ---------- drawing helpers ---------- */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const ago = ms => {
    const m = Math.max(0, (Date.now() - ms) / 60_000);
    return m < 1 ? 'now' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  const PXG = { ctx: null, T: 0, k: 1, lights: null, ext: null }; // ext: the world drawn, past the farm's own edges when the frame has room // the canvas being drawn now, the animation clock, device pixels per world pixel, lights to glow at night
  const px = (x, y, w, h, c) => { PXG.ctx.fillStyle = ink(c); PXG.ctx.fillRect(x, y, w, h); };
  const SC = 1.5; // characters are drawn at 1.5×: one sprite pixel = 1.5 world pixels
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
    path: ['#8a7140', '#9a7442', '#b08850', '#c9a46a'],
    grass: ['#1f3d1a', '#2f5a2a', '#3f7d3a', '#4f8f3a', '#5d9b46', '#6aa84f', '#7fbf5a'],
    leaf: ['#2f6b2f', '#3f9b3a', '#6cc04a', '#9ed36a', '#c6e89a', '#6b8f4a'],
    autumn: ['#8a8f3a', '#b5562f', '#c8681a', '#e9a23b'],
    stone: ['#3a3a40', '#5f6b7a', '#5f7f9a', '#8a8f96', '#9aa4ad', '#c3cbd2', '#e6eef5'],
    sky: ['#141a33', '#2c3a5a', '#2c4a85', '#3d7be0', '#5ab4ff', '#a9dcf7', '#d8f0ff'],
    dusk: ['#5a3b85', '#8a5fc0', '#d55181', '#f4b6c2', '#ffb48a'],
    red: ['#5a1f19', '#6b2a22', '#9c3b30', '#b23a2e', '#e04a3a', '#ff6b6b'],
    sun: ['#f08a24', '#f4a261', '#f0b429', '#ffd43b', '#e9c46a', '#f4d58d', '#ffe8a3'],
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
  const SKY = { // [top, middle, low] of the sky band by phase
    day: ['#5ab4ff', '#a9dcf7', '#d8f0ff'], dawn: ['#8a5fc0', '#f4b6c2', '#ffb48a'], dusk: ['#5a3b85', '#d55181', '#ffb48a'], night: ['#141a33', '#2c3a5a', '#2c4a85'],
  };
  /** A puffy cloud, w wide: three bumps on a flat base, lit on top, shaded underneath. */
  function drawCloud(x, y, w, [light, mid, dark]) {
    const b = Math.round(w / 3);
    px(x + 1, y + 4, w - 2, 4, mid); px(x, y + 5, w, 2, mid);
    px(x + Math.round(w * 0.1), y + 1, b, 4, mid); px(x + Math.round(w * 0.36), y - 1, b + 2, 6, mid); px(x + Math.round(w * 0.66), y + 1, b - 2, 4, mid);
    px(x + Math.round(w * 0.14), y + 1, b - 4, 1, light); px(x + Math.round(w * 0.4), y - 1, b - 2, 1, light); px(x + Math.round(w * 0.7), y + 1, b - 5, 1, light);
    px(x + 2, y + 7, w - 4, 1, dark);
  }
  /** The sky band, every frame: its colours by the hour, stars, the sun or moon on its arc, drifting clouds. */
  function drawSky(sky, T, hot) {
    const [top, mid, low] = SKY[sky.phase], { x0, x1, y0 } = PXG.ext ?? { x0: 0, x1: W, y0: 0 }, EW = x1 - x0;
    px(x0, y0, EW, 6 - y0, top); px(x0, 6, EW, 5, mid); px(x0, 11, EW, 6, low);
    if (sky.light < 0.6) for (let i = 0, n = Math.round(22 * (EW / W) * (1 - y0 / 17)); i < n; i++) { // stars
      const x = x0 + ((i * 97 + 13) % EW), y = y0 + ((i * 37) % (12 - y0));
      if ((i + Math.floor(T * 1.3 + i * 0.7)) % 5) px(x, y, 1, 1, i % 3 ? '#e6eef5' : '#ffe8a3');
    }
    if (sky.sun) {
      const { x, y } = sky.sun, c = hot && blink(2) ? '#ff922b' : sky.phase === 'day' ? '#ffd43b' : '#ff922b';
      px(x - 3, y - 5, 6, 10, c); px(x - 5, y - 3, 10, 6, c); px(x - 4, y - 4, 8, 8, c); px(x - 2, y - 3, 2, 2, '#ffe8a3');
      if (hot) { PXG.ctx.globalAlpha = 0.35; px(x - 8, y - 8, 16, 16, '#ff5a1f'); PXG.ctx.globalAlpha = 1; } // a machine running hot
    }
    if (sky.moon) {
      const { x, y } = sky.moon;
      px(x - 3, y - 4, 6, 8, '#f4ecd8'); px(x - 4, y - 3, 8, 6, '#f4ecd8'); px(x, y - 2, 2, 2, '#d4c294'); px(x - 2, y + 1, 1, 1, '#d4c294');
      if (hot) { PXG.ctx.globalAlpha = 0.35; px(x - 7, y - 7, 14, 14, '#ff5a1f'); PXG.ctx.globalAlpha = 1; }
    }
    const tones = sky.light > 0.5 ? ['#ffffff', '#f4ecd8', '#c3cbd2'] : sky.light > 0.1 ? ['#ffd8a8', '#f4b6c2', '#d55181'] : ['#5f6b7a', '#3a3a40', '#2c3a5a'];
    const clouds = [[60, 3, 24, 2.2], [210, 5, 28, 1.6], [330, 2, 18, 2.8], [140, -14, 30, 1.2], [290, -26, 22, 1.9], [20, -38, 26, 1.4], [370, -50, 20, 2.4]];
    for (const [cx, y, w, sp] of clouds) if (y >= y0 - 4) drawCloud(Math.round(x0 + ((cx - x0 + T * sp) % (EW + 60)) - 30), y, w, tones);
  }
  /**
   * Night falls over everything drawn so far (a tint, warm at dawn and dusk), then the lights glow:
   * the farmhouse windows, the barn lamp, lanterns in farmers' hands.
   */
  function drawNight(sky, H, lights) {
    const ctx = PXG.ctx, dark = 1 - sky.light;
    if (dark < 0.02) return;
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(0.7, dark * 0.7);
    ctx.fillStyle = sky.phase === 'night' ? '#3c4a8c' : '#c26a7a';
    const e = PXG.ext ?? { x0: 0, x1: W, y0: 0, y1: H };
    ctx.fillRect(e.x0, e.y0, e.x1 - e.x0, e.y1 - e.y0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffe8a3';
    for (const [x, y, r, core] of lights) {
      for (let k = 3; k >= 1; k--) { // a round glow in three steps, brighter inside
        ctx.globalAlpha = 0.1 * dark * (4 - k);
        const rr = Math.round((r * k) / 3);
        for (let dy = -rr; dy <= rr; dy++) { const w = Math.round(Math.sqrt(rr * rr - dy * dy)); ctx.fillRect(Math.round(x - w), Math.round(y + dy), w * 2, 1); }
      }
      ctx.globalAlpha = 1;
      if (core) {
        const [cx, cy, cw, ch, panes] = core;
        px(cx, cy, cw, ch, dark > 0.5 ? '#ffd43b' : '#f4d58d');
        if (panes) { px(cx + (cw >> 1), cy, 1, ch, '#6b4320'); px(cx, cy + (ch >> 1), cw, 1, '#6b4320'); } // the window frame
      }
    }
    ctx.globalAlpha = 1;
  }

  // Seasons: the grass, the trees and the flowers (spring blossom, autumn leaves, winter snow).
  const SEASONS = {
    spring: { grass: ['#4f8f3a', '#5d9b46', '#66a34b', '#7fbf5a'], tuft: '#3f7d3a', canopy: ['#2f6b2f', '#3f8a3a', '#6cc04a'], bloom: '#f4b6c2', flowers: ['#ffffff', '#f4b6c2', '#ffd43b', '#e58a8a'] },
    summer: { grass: ['#4f8f3a', '#5d9b46', '#66a34b', '#6aa84f'], tuft: '#3f7d3a', canopy: ['#2a5e2a', '#2f6b2f', '#3f8a3a'], flowers: ['#ffffff', '#ffd43b'] },
    autumn: { grass: ['#6b7a35', '#8a8f3a', '#a8a350', '#8a8f3a'], tuft: '#6b7a35', canopy: ['#8a3b2e', '#c8681a', '#e9a23b'], flowers: ['#c8681a'] },
    winter: { grass: ['#c3cbd2', '#dfe9f2', '#f4f8fb', '#e6eef5'], tuft: '#9aa4ad', canopy: ['#3a3a40', '#4a4a52', '#dfe9f2'], flowers: [], snow: true },
  };
  /** 0–1023 for a spot, well mixed, the same every build (texture without stripes). */
  const noise = (x, y) => {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x9e37, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) & 1023;
  };

  /** The land: everything that does not move, drawn once (and again when the season turns). The sky shows through above. */
  function drawLand(f, L, season = 'summer', ext = { x0: 0, x1: W, y1: L.H }) {
    const { H, BOT_TOP, LANE_B } = L, S = SEASONS[season] ?? SEASONS.summer, { x0, x1, y1 } = ext, EW = x1 - x0;
    // grass in three tones, with tufts and a few flowers (out to the frame's edges)
    for (let y = 16; y < y1; y += 2) for (let x = x0 - (x0 & 1); x < x1; x += 2) { const n = noise(x, y); f(x, y, 2, 2, n < 170 ? S.grass[0] : n < 820 ? S.grass[1] : n < 1000 ? S.grass[2] : S.grass[3]); }
    for (let y = 18; y < y1 - 2; y += 5) for (let x = x0 + 2; x < x1 - 2; x += 7) {
      const n = noise(x + 7, y + 3);
      if (n < 120) { f(x, y, 1, 2, S.tuft); f(x + 2, y, 1, 2, S.tuft); f(x + 1, y + 1, 1, 2, S.tuft); }
      else if (n < 135 && S.flowers.length) { f(x, y + 1, 1, 1, S.tuft); f(x, y, 1, 1, S.flowers[n % S.flowers.length]); }
    }
    // beyond the farm (when the frame has room): its boundary fence below, and bushes
    if (y1 > H + 8) { for (let x = x0; x < x1; x += 12) { f(x, H + 3, 2, 8, '#6b4320'); f(x, H + 3, 1, 8, '#8b5a2b'); } f(x0, H + 5, EW, 1, '#8b5a2b'); f(x0, H + 8, EW, 1, '#8b5a2b'); f(x0, H + 6, EW, 1, '#4e3626'); }
    for (let i = 0; i < 60; i++) {
      const bx = x0 + (noise(i, 77) % Math.max(1, EW)), by = 18 + (noise(77, i) % Math.max(1, y1 - 24));
      if ((bx >= -2 && bx < W + 2 && by < H + 12) || by > y1 - 8) continue; // only out past the farm
      f(bx - 1, by + 4, 11, 1, '#1f3d1a'); f(bx, by, 9, 5, S.canopy[0]); f(bx + 1, by - 1, 6, 2, S.canopy[1]); f(bx + 2, by - 1, 3, 1, S.canopy[2]);
      if (S.snow) f(bx + 1, by - 1, 7, 1, '#ffffff'); else if (i % 3 === 0) f(bx + 3, by + 1, 1, 1, S.flowers[0] ?? '#e04a3a');
    }
    // a row of trees along the top, behind the fence
    for (let x = x0 - (((x0 % 10) + 10) % 10); x < x1; x += 10) {
      const j = Math.round(x / 10), y = 14 + (((j % 3) + 3) % 3) * 2, c = S.canopy[Math.abs(j) % 2 ? 1 : 0];
      f(x, y, 12, 12, c); f(x + 2, y, 6, 1, S.canopy[2]); f(x, y + 11, 12, 1, '#24361f');
      if (S.snow) f(x + 1, y, 9, 2, '#f4f8fb');
    }
    for (let x = x0 - (((x0 % 12) + 12) % 12); x < x1; x += 12) { f(x, 23, 2, 8, '#6b4320'); f(x, 23, 1, 8, '#8b5a2b'); f(x + 2, 24, 1, 7, '#2f5a2a'); }
    f(x0, 25, EW, 1, '#8b5a2b'); f(x0, 28, EW, 1, '#8b5a2b'); f(x0, 26, EW, 1, '#4e3626'); f(x0, 29, EW, 1, '#4e3626');
    // barn, top left: new farmers walk out of its door; a lamp over it glows at night
    f(1, 5, 48, 28, '#2a1d14'); f(2, 6, 46, 26, '#b23a2e'); f(-2, 3, 54, 4, '#6b2a22'); f(6, 0, 38, 3, '#6b2a22'); f(-2, 6, 54, 1, '#4e3626');
    for (let y = 8; y < 32; y += 4) f(2, y, 46, 1, '#9c3127');
    f(2, 6, 2, 26, '#e04a3a');
    if (S.snow) { f(-2, 2, 54, 2, '#f4f8fb'); f(6, 0, 38, 1, '#f4f8fb'); }
    f(16, 14, 18, 18, '#5a1f19'); for (let i = 0; i < 18; i++) { f(16 + i, 14 + i, 1, 1, '#f4ecd8'); f(33 - i, 14 + i, 1, 1, '#f4ecd8'); }
    f(23, 10, 4, 3, '#3a3a40'); f(24, 11, 2, 1, '#ffd43b'); f(48, 30, 4, 3, '#24361f'); // lamp; the barn's shadow
    // the wild meadow beside the barn: farmers working outside any repo
    for (let y = TOP + 6; y < BOT_TOP - 8; y += 5) for (let x = 4 + (y % 2) * 2; x < 46; x += 6) f(x, y, 1, 2, '#4f8f3a');
    // the farm's sign
    f(149, 3, 102, 16, '#2a1d14'); f(150, 4, 100, 14, '#6b4320'); f(151, 5, 98, 12, '#a8703c'); f(151, 10, 98, 1, '#8b5a2b'); f(151, 5, 98, 1, '#c98d4f');
    for (const nx of [153, 245]) { f(nx, 6, 1, 1, '#3a3a40'); f(nx, 15, 1, 1, '#3a3a40'); }
    f(166, 18, 2, 10, '#6b4320'); f(232, 18, 2, 10, '#6b4320'); f(168, 19, 1, 9, '#4e3626'); f(234, 19, 1, 9, '#4e3626');
    // the walkways between field columns, and the lane in front of the house
    const dirt = (x, y, w, h) => {
      f(x, y, w, h, '#b08850');
      for (let yy = y; yy < y + h; yy += 3) for (let xx = x + 1; xx < x + w - 1; xx += 3) { const n = noise(xx, yy); if (n < 90) f(xx, yy, 1, 1, '#c9a46a'); else if (n < 140) f(xx, yy, 1, 1, '#9a7442'); else if (n < 150) f(xx, yy, 2, 1, '#8a8f96'); }
    };
    for (const c of CORR) { dirt(c - 7, TOP, 14, BOT_TOP - TOP + 4); f(c - 7, TOP, 1, BOT_TOP - TOP + 4, '#9a7442'); f(c + 6, TOP, 1, BOT_TOP - TOP + 4, '#9a7442'); f(c + 7, TOP, 1, BOT_TOP - TOP + 4, '#3f7d3a'); }
    dirt(x0, BOT_TOP - 2, EW, 7); f(x0, BOT_TOP - 2, EW, 1, '#9a7442'); f(x0, BOT_TOP + 5, EW, 1, '#8a7140');
    // the farmhouse with your porch; its windows light up at night, its chimney smokes while agents work
    f(124, BOT_TOP + 7, 152, 9, '#2a1d14');
    f(130, BOT_TOP + 8, 140, 6, '#8a3b2e'); f(130, BOT_TOP + 8, 140, 1, '#b23a2e'); f(126, BOT_TOP + 12, 148, 3, '#6b2a22');
    if (S.snow) f(128, BOT_TOP + 7, 144, 2, '#f4f8fb');
    f(240, BOT_TOP - 2, 8, 10, '#5a1f19'); f(239, BOT_TOP - 3, 10, 2, '#3a3a40'); // chimney
    f(135, BOT_TOP + 15, 130, LANE_B - BOT_TOP - 18, '#2a1d14');
    f(136, BOT_TOP + 15, 128, LANE_B - BOT_TOP - 19, '#e8d8b0'); for (let y = BOT_TOP + 18; y < LANE_B - 4; y += 4) f(136, y, 128, 1, '#d4c294');
    f(136, BOT_TOP + 15, 128, 2, '#c9b48a');
    for (const wx of [148, 232]) { f(wx - 1, BOT_TOP + 18, 22, 15, '#2a1d14'); f(wx, BOT_TOP + 19, 20, 13, '#6b4320'); f(wx + 1, BOT_TOP + 20, 18, 11, '#5fa8e8'); f(wx + 2, BOT_TOP + 21, 6, 2, '#d8f0ff'); f(wx + 10, BOT_TOP + 20, 1, 11, '#6b4320'); f(wx + 1, BOT_TOP + 25, 18, 1, '#6b4320'); f(wx - 2, BOT_TOP + 32, 24, 2, '#8b5a2b'); }
    f(198, LANE_B - 34, 4, 3, '#3a3a40'); f(199, LANE_B - 33, 2, 1, '#ffd43b'); // the porch lamp
    f(189, LANE_B - 29, 22, 25, '#2a1d14'); f(190, LANE_B - 28, 20, 24, '#6b4320'); f(191, LANE_B - 27, 18, 23, '#8b5a2b'); f(193, LANE_B - 25, 6, 9, '#7a5230'); f(201, LANE_B - 25, 6, 9, '#7a5230'); f(205, LANE_B - 16, 2, 2, '#f0b429');
    f(124, LANE_B - 4, 152, 10, '#a8703c'); for (let x = 128; x < 276; x += 8) f(x, LANE_B - 4, 1, 10, '#8b5a2b'); f(124, LANE_B - 4, 152, 1, '#c98d4f'); f(124, LANE_B + 5, 152, 1, '#6b4320');
    f(186, LANE_B + 6, 28, 4, '#8b5a2b'); f(186, LANE_B + 9, 28, 1, '#6b4320');
    f(276, BOT_TOP + 14, 4, LANE_B - BOT_TOP - 8, '#24361f'); f(124, LANE_B + 6, 62, 2, '#2f5a2a'); f(214, LANE_B + 6, 62, 2, '#2f5a2a'); // the house's shadow
    // the shade tree's shadow (the tree itself is drawn with the farmers, so they can stand in front of it)
    for (const [dx, w] of [[0, 52], [-6, 64], [-2, 56]]) f(31 + dx, LANE_B - 2 + (w === 64 ? 1 : w === 56 ? 2 : 0), w, 1, '#2f5a2a');
    // the silo, top right: its grain gauge (the plan's weekly usage) is drawn every frame
    f(371, 4, 22, 28, '#2a1d14'); f(372, 5, 20, 26, '#9aa4ad'); for (let x = 375; x < 391; x += 3) f(x, 5, 1, 26, '#8a8f96'); f(373, 5, 2, 26, '#c3cbd2');
    f(372, 1, 20, 4, '#2a1d14'); f(373, 1, 18, 4, '#b23a2e'); f(375, 0, 14, 1, '#b23a2e'); f(374, 1, 6, 1, '#e04a3a');
    if (S.snow) { f(373, 0, 18, 2, '#ffffff'); }
    f(378, 7, 8, 22, '#2a1d14'); f(369, 30, 26, 2, '#5f6b7a'); f(393, 6, 2, 26, '#24361f');
    // the pond and the henhouse, at the foot of the meadow
    const py = BOT_TOP - 22;
    f(4, py, 28, 15, '#2f5a2a'); f(3, py + 2, 30, 11, '#2f5a2a');
    f(5, py + 1, 26, 13, S.snow ? '#c3cbd2' : '#3d7be0'); f(4, py + 3, 28, 9, S.snow ? '#c3cbd2' : '#3d7be0');
    f(6, py + 2, 10, 1, S.snow ? '#e6eef5' : '#5ab4ff'); f(5, py + 4, 2, 6, S.snow ? '#e6eef5' : '#5ab4ff');
    if (!S.snow) { f(22, py + 9, 4, 2, '#6cc04a'); f(23, py + 9, 1, 1, '#9ed36a'); f(9, py + 10, 3, 2, '#6cc04a'); } // lily pads
    for (const [rx, h] of [[2, 7], [31, 9], [33, 6]]) { f(rx, py + 12 - h, 1, h, '#6b8f4a'); f(rx, py + 10 - h, 1, 2, '#6b4320'); } // reeds
    const hx = 36, hy = BOT_TOP - 27;
    f(hx - 1, hy + 4, 24, 18, '#2a1d14'); f(hx, hy + 5, 22, 16, '#c98d4f'); for (let y = hy + 8; y < hy + 21; y += 3) f(hx, y, 22, 1, '#a8703c');
    f(hx - 2, hy + 2, 26, 4, '#2a1d14'); f(hx - 1, hy + 2, 24, 3, '#b23a2e'); f(hx + 2, hy, 18, 3, '#b23a2e'); f(hx + 2, hy, 18, 1, '#e04a3a');
    if (S.snow) f(hx - 1, hy, 24, 2, '#ffffff');
    f(hx + 8, hy + 12, 7, 9, '#2a1d14'); f(hx + 15, hy + 18, 6, 2, '#8b5a2b'); f(hx + 3, hy + 8, 4, 3, '#2a1d14'); // door, ramp, window
    f(hx + 22, hy + 6, 2, 16, '#24361f');
    // the scarecrow corner: dry stubble
    f(287, BOT_TOP + 9, 112, H - BOT_TOP - 10, '#6d5830'); f(288, BOT_TOP + 10, 110, H - BOT_TOP - 12, '#8a7140');
    for (let y = BOT_TOP + 14; y < H - 2; y += 5) for (let x = 290 + (y % 2) * 2; x < 396; x += 6) f(x, y, 1, 2, S.snow ? '#dfe9f2' : '#6d5830');
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
  /** HTML for a text in the pixel font (its words stay for screen readers, copying and search), or plain text if it has a letter the font lacks. */
  function pxt(text, color = '#f4ecd8', shadow = '#1b1420') {
    const t = String(text ?? '');
    const img = textImage(t, color, shadow);
    if (!img) return esc(t);
    const s = fontPx();
    return `<i class="pxt" aria-hidden="true" style="width:${(img.w * s).toFixed(1)}px;height:${(img.h * s).toFixed(1)}px;background-image:url(${img.url})"></i><span class="px-sr">${esc(t)}</span>`;
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

  /* ---------- layout: three columns of fields, then the farmyard ---------- */

  const W = 400, X0 = 48, COLW = 117, TOP = 32, ROWH = 74, MAX_FIELDS = 9;
  const CORR = [X0 + COLW, X0 + 2 * COLW]; // walkways between the field columns
  const BARN_DOOR = [25, 32];
  function layoutFor(fields) {
    const shown = fields.slice(0, MAX_FIELDS);
    const rows = Math.max(1, Math.ceil(shown.length / 3));
    const ST = shown.map((f, i) => {
      const rowTop = TOP + Math.floor(i / 3) * ROWH;
      return { key: f.key, cx: Math.round(X0 + (i % 3) * COLW + COLW / 2), rowTop, lane: rowTop + 44 };
    });
    const BOT_TOP = TOP + rows * ROWH;
    return { key: shown.map(f => f.key).join('\n'), ST, rows, BOT_TOP, LANE_B: BOT_TOP + 50, H: BOT_TOP + 66, more: fields.length - shown.length };
  }

  /* ---------- the farm theme: sprites, ground, weather, labels ---------- */

  const K = '#2a1d14';
  // 14×16 farmer, front view, put together from its look. h hat · b hat band · r hair · s skin ·
  // g glasses · p cheeks · C shirt · o overalls · P pole. The eyes are drawn on top (row 6, or 7 looking down).
  const HEADS = {
    straw: ['.....kkkk.....', '....khhhhk....', '...khhhhhhk...', '..kbbbbbbbbk..', '.khhhhhhhhhhk.'],
    cap: ['..............', '.....kkkk.....', '....khhhhk....', '...khhhhhhk...', '...kbbbbbbbbk.'],
    beanie: ['......kk......', '.....kbbk.....', '....khhhhk....', '...khhhhhhk...', '...kbbbbbbk...'],
    bandana: ['..............', '....kkkkkk....', '...khhhhhhk...', '...khbhhbhkhk.', '...khhhhhhk.h.'],
    none: ['..............', '....kkkkkk....', '...krrrrrrk...', '...krrrrrrk...', '...krrrrrrk...'],
  };
  // Four views: from the front (walking down or standing), from behind (walking up), and from the
  // side (walking right; walking left is its mirror). The hat is the same from every side.
  const FRONT_FACE = look => [
    '...krssssrk...',
    look.extra === 'glasses' ? '...kggkkggk...' : '...kssssssk...',
    look.extra === 'beard' ? '...krssssrk...' : look.extra === 'cheeks' ? '...kpsssspk...' : '...kssssssk...',
    look.extra === 'beard' ? '....krrrrk....' : '....kkkkkk....',
  ];
  const BACK_HEAD = ['...krrrrrrk...', '...krrrrrrk...', '...krrrrrrk...', '....kkkkkk....'];
  const SIDE_FACE = look => [ // facing right: hair at the back, one eye (drawn later), a nose
    '...krrsssssk..',
    look.extra === 'glasses' ? '...krssggggk..' : '...krssssssk..',
    look.extra === 'beard' ? '...krssrrrrrk.' : look.extra === 'cheeks' ? '...krsspssssk.' : '...krsssssssk.',
    look.extra === 'beard' ? '....krrrrrk...' : '....kkkkkkk...',
  ];
  const HIPS = `...k${'o'.repeat(6)}k...`;
  const FRONT_BODY = ['..kCCCCCCCCk..', '.kCCoCCCCoCCk.', '.kCCooooooCCk.', '.ks.oooooo.sk.', HIPS];
  const BACK_BODY = ['..kCCCCCCCCk..', '.kCCCoCCoCCCk.', '.kCCooooooCCk.', '.ks.oooooo.sk.', HIPS]; // straps cross on the back
  const SIDE_BODY = ['...kCCCCCCk...', '...kCCoCCCk...', '...kCooooCk...', '...koooosok...', HIPS];
  const LEGS = { s: ['...koo..ook...', '...kkk..kkk...'], a: ['...koo..ook...', '...kkk........'], b: ['...koo..ook...', '........kkk...'], p: ['......PP......', '......PP......'] };
  const SIDE_LEGS = { s: ['.....kook.....', '.....kkkk.....'], a: ['....ko..ok....', '...kk....kk...'], b: ['.....koko.....', '....kk..kk....'] };
  /** A farmer's sprite rows: 14 wide, 16 tall, for a view (down, up, right, left) and a leg frame. */
  function spriteRows(look, view = 'down', legs = 's') {
    const head = HEADS[look.hat] ?? HEADS.straw;
    if (view === 'left') return spriteRows(look, 'right', legs).map(r => [...r].reverse().join(''));
    if (view === 'right') return [...head, ...SIDE_FACE(look), ...SIDE_BODY, ...(SIDE_LEGS[legs] ?? SIDE_LEGS.s)];
    if (view === 'up') return [...head, ...BACK_HEAD, ...BACK_BODY, ...(LEGS[legs] ?? LEGS.s)];
    return [...head, ...FRONT_FACE(look), ...FRONT_BODY, ...(LEGS[legs] ?? LEGS.s)];
  }
  /** The walk: foot, pass, other foot, pass (8 steps a second); the body rises on the passes. */
  const walkFrame = T => { const i = Math.floor(T * 8) % 4; return { legs: ['a', 's', 'b', 's'][i], bob: i % 2 }; };
  const sprites = new Map();
  function farmerSprite(look, color, scare, legs, up, view = 'down') {
    if (scare) view = 'down';
    const key = `${Object.values(look).join()}|${color}|${scare}|${legs}|${up}|${view}`;
    if (sprites.has(key)) return sprites.get(key);
    const pal = scare // a scarecrow keeps its farmer's hat and shape, in straw and sacking
      ? { k: '#3a2a1a', h: '#c9a24a', b: '#7a5230', r: '#c9a24a', s: '#d8c48a', g: '#d8c48a', p: '#d8c48a', C: '#8b7a55', o: '#6b5a3a', P: '#6b4320' }
      : { k: K, h: look.hatColor, b: look.band, r: look.hair, s: look.skin, g: '#e6eef5', p: '#e58a8a', C: color, o: look.overalls, P: '#6b4320' };
    for (const key of Object.keys(pal)) if (key !== 'C') pal[key] = ink(pal[key]); // one palette; the shirt is the agent's colour
    const c = makeSprite(spriteRows(look, view, legs), pal);
    if (up && view === 'down') { // one arm up, waving
      const g = c.getContext('2d');
      g.clearRect(11, 11, 2, 2); g.fillStyle = color; g.fillRect(12, 5, 1, 6); g.fillStyle = pal.s; g.fillRect(12, 3, 1, 2); g.fillStyle = K; g.fillRect(13, 3, 1, 8);
    }
    sprites.set(key, c);
    return c;
  }

  const ACTIVE = new Set(['waiting', 'working', 'turn']);
  // What a farmer does for each kind of step, what it holds, and where it stands in its field
  // (looking things up on the left, working the soil on the right, the rest in the middle).
  const ACTIONS = {
    edit: { prop: 'hoe', verb: 'hoeing the rows', spot: 26 },
    write: { prop: 'seeds', verb: 'planting seeds', spot: 26 },
    read: { prop: 'almanac', verb: 'reading the almanac', spot: -26 },
    search: { prop: 'spyglass', verb: 'scouting the field', spot: -26 },
    web: { prop: 'pigeon', verb: 'sending a pigeon', spot: -26 },
    test: { prop: 'magnifier', verb: 'checking the crops', spot: 0 },
    lint: { prop: 'rake', verb: 'raking the rows tidy', spot: 26 },
    build: { prop: 'hammer', verb: 'mending the fence', spot: 0 },
    install: { prop: 'barrow', verb: 'hauling in supplies', spot: 0 },
    commit: { prop: 'crate', verb: 'packing a crate', spot: 0 },
    push: { prop: 'cart', verb: 'taking crates to market', spot: 0 },
    deploy: { prop: 'cart', verb: 'delivering to town', spot: 0, flag: true },
    pull: { prop: 'mailbag', verb: 'fetching the mail', spot: 0 },
    serve: { prop: 'lantern', verb: 'keeping watch', spot: 0 },
    delete: { prop: 'sickle', verb: 'clearing weeds', spot: 26 },
    agent: { prop: 'whistle', verb: 'whistling for helpers', spot: 0 },
    plan: { prop: 'clipboard', verb: 'writing the chore list', spot: 0 },
    ask: { prop: 'clipboard', verb: 'writing down a question', spot: 0 },
    shell: { prop: 'can', verb: 'watering', spot: 0 },
    other: { prop: 'can', verb: 'tending the field', spot: 0 },
  };
  const OLD_TOOLS = { Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', Read: 'read', Grep: 'search', Glob: 'search', WebSearch: 'web', WebFetch: 'web', Bash: 'shell' };
  /** What a farmer does for a step; a step from an older snapshot goes by its tool. */
  const actionOf = (step, tool) => ACTIONS[step] ?? ACTIONS[OLD_TOOLS[tool]] ?? ACTIONS.other;
  const doing = f => (f.step || f.tool ? actionOf(f.step, f.tool) : null);
  const shades = new Map();
  /** A colour made darker (k < 1) or lighter (k > 1). */
  function shade(hex, k) {
    const key = hex + k;
    if (!shades.has(key)) shades.set(key, `#${[1, 3, 5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('')}`);
    return shades.get(key);
  }
  // The seed packet on each field's fence: a 5×6 picture of its crop.
  const SEED_ICONS = {
    wheat: ['..y..', '.yyy.', '..y..', '.yyy.', '..g..', '..g..'],
    corn: ['.g.g.', '.yyy.', '.yyy.', '.yyy.', 'gyyyg', '.ggg.'],
    carrot: ['.g.g.', '..g..', 'ooooo', '.ooo.', '.oo..', '..o..'],
    cabbage: ['.....', '.lgl.', 'lgggl', 'lglgl', '.lll.', '.....'],
    sunflower: ['.yyy.', 'yybyy', '.yyy.', '..g..', '.gg..', '..g..'],
    tomato: ['.g.g.', '..g..', '.rrr.', 'rrrrr', 'rrrrr', '.rrr.'],
    pumpkin: ['..g..', '.oOo.', 'oOoOo', 'oOoOo', '.oOo.', '.....'],
  };
  const SEED_PAL = { y: '#e9b949', g: '#3f9b3a', l: '#4f9a35', o: '#f08a24', O: '#c8681a', r: '#e04a3a', b: '#6b4320' };
  function seedSign(crop, x, y) {
    px(x + 4, y + 9, 1, 8, '#6b4320'); // stake
    px(x, y, 9, 10, '#6b4320'); px(x + 1, y + 1, 7, 8, '#f4ecd8');
    (SEED_ICONS[crop] ?? SEED_ICONS.wheat).forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] !== '.') px(x + 2 + i, y + 2 + j, 1, 1, SEED_PAL[row[i]]); });
  }
  /** Growth stages, as a session's context fills: seeds, sprouts, young plants, in flower, ripening, ripe. */
  const STAGES = ['seeds', 'sprouts', 'young plants', 'in flower', 'ripening', 'ripe'];
  const growthStage = p => (p >= 0.85 ? 5 : p >= 0.7 ? 4 : p >= 0.5 ? 3 : p >= 0.3 ? 2 : p >= 0.12 ? 1 : 0);
  const SEED_COLOR = { wheat: '#d9b26a', corn: '#f2d14b', carrot: '#c98d4f', cabbage: '#6b4320', sunflower: '#3a3a40', tomato: '#f4d58d', pumpkin: '#f1e4c3' };
  const G = '#3f9b3a', GL = '#6cc04a', GP = '#8fd16a'; // stem, leaf, pale leaf
  /** One plant at (x, y) at a growth stage (0–5). Returns the y of its top, for the ripe sparkle. */
  function drawCrop(crop, x, y, stage, sway) {
    if (stage <= 0) { px(x - 1, y, 3, 1, '#5e3d22'); px(x, y - 1, 1, 1, SEED_COLOR[crop] ?? '#d9b26a'); return y - 1; } // a seed in its mound
    if (stage === 1) { // sprouts: blades for grasses, a pair of seed leaves for the rest
      if (crop === 'wheat' || crop === 'corn') { px(x, y - 3, 1, 3, GL); px(x + 1, y - 2, 1, 1, GP); return y - 3; }
      if (crop === 'carrot') { px(x, y - 2, 1, 2, GL); px(x - 1, y - 3, 1, 1, GP); px(x + 1, y - 3, 1, 1, GP); return y - 3; }
      px(x, y - 2, 1, 2, G); px(x - (crop === 'pumpkin' ? 2 : 1), y - 3, crop === 'pumpkin' ? 2 : 1, 1, GP); px(x + 1, y - 3, crop === 'pumpkin' ? 2 : 1, 1, GP);
      return y - 3;
    }
    switch (crop) {
      case 'corn': {
        const h = [0, 0, 5, 8, 9, 10][stage];
        px(x, y - h, 1, h, '#4f9a35'); px(x - 2, y - h + 3, 2, 1, GL); px(x + 1, y - h + 5, 2, 1, GL);
        if (stage >= 3) px(x - 1 + sway, y - h - 1, 3, 1, '#d9b26a'); // the tassel
        if (stage === 4) { px(x + 1, y - h + 2, 2, 3, '#9ed36a'); px(x + 2, y - h + 1, 1, 1, '#c97b4a'); } // a green cob, silk on top
        if (stage === 5) { px(x + 1, y - h + 1, 2, 3, '#f2d14b'); px(x + 1, y - h + 4, 2, 1, GP); }
        return y - h - 1;
      }
      case 'carrot': {
        const h = [0, 0, 3, 4, 4, 5][stage];
        px(x, y - h, 1, h, G); px(x - 1, y - h, 1, 1, GL); px(x + 1, y - h + 1, 1, 1, GL);
        if (stage >= 3) { px(x - 2, y - h + 1, 1, 1, GP); px(x + 2, y - h, 1, 1, GP); }
        if (stage === 3) px(x, y - h - 1, 1, 1, '#f4f1e1'); // a little white flower head
        if (stage >= 4) px(x - 1, y, 3, 1, stage === 5 ? '#ff7a1a' : '#f0a060'); // the root's shoulder
        if (stage === 5) px(x, y + 1, 1, 1, '#e8691a');
        return y - h - 1;
      }
      case 'cabbage': {
        const w = [0, 0, 3, 4, 5, 5][stage], h = [0, 0, 1, 2, 3, 3][stage];
        px(x - (w >> 1) - (stage >= 4 ? 1 : 0), y - 1, w + (stage >= 4 ? 2 : 0), 1, '#4f9a35'); // outer leaves
        px(x - (w >> 1), y - h - 1, w, h, stage >= 4 ? '#7fb24a' : GP);
        if (stage === 3) px(x - (w >> 1) + 1, y - h - 1, 1, h, '#4f9a35'); // veins in the open leaves
        if (stage >= 4) px(x - (w >> 1) + 1, y - h - 1, w - 2, 1, stage === 5 ? '#c6e89a' : '#a8d070'); // the head
        if (stage === 5) px(x - (w >> 1) + 2, y - h, 1, 1, '#b8e08a');
        return y - h - 1;
      }
      case 'sunflower': {
        const h = [0, 0, 4, 7, 9, 10][stage];
        px(x, y - h, 1, h, G); px(x + 1, y - h + 3, 2, 1, GL); if (stage >= 3) px(x - 2, y - h + 5, 2, 1, GL);
        if (stage === 2) px(x - 1, y - h, 1, 1, GP);
        if (stage === 3) px(x + sway, y - h - 1, 1, 1, '#9ed36a'); // a green bud
        if (stage === 4) { px(x - 1 + sway, y - h - 2, 2, 2, '#f4c430'); px(x + sway, y - h - 1, 1, 1, '#6b8f3a'); } // opening
        if (stage === 5) { px(x - 1 + sway, y - h - 2, 3, 3, '#f4c430'); px(x + sway, y - h - 1, 1, 1, '#6b4320'); } // in bloom
        return y - h - 2;
      }
      case 'tomato': {
        const h = [0, 0, 3, 5, 6, 7][stage];
        px(x + 1, y - h - 1, 1, h + 1, '#8b5a2b'); px(x, y - h, 1, h, G); px(x - 1, y - h + 1, 1, 1, GL);
        if (stage >= 3) px(x - 1, y - h + 3, 1, 1, GL);
        if (stage === 3) { px(x - 1, y - h + 2, 1, 1, '#f4d03f'); px(x, y - h - 1, 1, 1, '#f4d03f'); } // yellow flowers
        if (stage === 4) { px(x - 1, y - h + 2, 2, 2, '#9ed36a'); px(x - 1, y - 3, 2, 2, '#f08a3a'); } // green, then turning
        if (stage === 5) { px(x - 1, y - h + 2, 2, 2, '#e04a3a'); px(x - 1, y - 3, 2, 2, '#e04a3a'); px(x, y - h + 2, 1, 1, '#ff7a6a'); }
        return y - h - 1;
      }
      case 'pumpkin': {
        px(x - 2, y - 1, 5, 1, G); px(x - 3, y - 3, 2, 2, GL);
        if (stage >= 3) px(x + 2, y - 3, 2, 2, GL);
        if (stage === 3) px(x, y - 3, 1, 2, '#f4d03f'); // a big yellow flower
        if (stage === 4) { px(x - 1, y - 3, 2, 2, '#6b8f3a'); px(x, y - 4, 1, 1, G); } // a small green pumpkin
        if (stage === 5) { px(x - 2, y - 4, 4, 3, '#ff8c1a'); px(x - 1, y - 4, 1, 3, '#e07a10'); px(x, y - 5, 1, 1, G); }
        return y - (stage === 5 ? 5 : 4);
      }
      default: { // wheat
        const h = [0, 0, 4, 6, 7, 8][stage];
        px(x, y - h, 1, h, stage === 5 ? '#b8a040' : G); px(x - 1, y - h + 1, 1, 1, GL); px(x + 1, y - h + 2, 1, 1, GL);
        if (stage === 2) px(x + 1, y - h, 1, 1, GP);
        if (stage === 3) px(x + sway, y - h - 2, 1, 2, '#9ed36a'); // a green ear
        if (stage === 4) px(x - 1 + sway, y - h - 2, 3, 2, '#c9c45a');
        if (stage === 5) { px(x - 1 + sway, y - h - 2, 3, 2, '#e9c46a'); px(x + sway, y - h - 3, 1, 1, '#f4d58d'); return y - h - 3; }
        return y - h - 2;
      }
    }
  }

  /** What a working farmer holds, around its sprite (rp draws in sprite pixels; the farmer spans x 1–12, y 0–15). */
  function drawProp(prop, rp, T, flag) {
    switch (prop) {
      case 'can': { // watering
        const tilt = blink(2); rp(11, 10, 4, 3, '#9aa4ad'); rp(11, 10, 4, 1, '#c3cbd2'); rp(15, 9 + tilt, 2, 1, '#9aa4ad');
        for (let i = 0; i < 3; i++) rp(16 + (i % 2), 11 + ((Math.floor(T * 10) + i * 2) % 5), 1, 1, '#5ab4ff');
        return;
      }
      case 'hoe': // editing: up, then into the soil
        if (blink(3)) { rp(12, 2, 1, 10, '#8b5a2b'); rp(11, 1, 3, 1, '#9aa4ad'); }
        else { rp(11, 12, 5, 1, '#8b5a2b'); rp(16, 12, 1, 3, '#9aa4ad'); rp(17, 14, 1, 1, '#5e3d22'); rp(15, 15, 1, 1, '#5e3d22'); rp(18, 13, 1, 1, '#7a5230'); }
        return;
      case 'seeds': // a new file: a seed bag, seeds flying
        rp(1, 11, 3, 3, '#c9a46a'); rp(1, 11, 3, 1, '#a07e48');
        for (let i = 0; i < 3; i++) { const ph = (T * 1.5 + i / 3) % 1; rp(Math.round(11 + ph * 7), Math.round(11 - Math.sin(ph * Math.PI) * 5 + ph * 4), 1, 1, '#f4d58d'); }
        return;
      case 'almanac': // reading: an open book, pages turning
        rp(3, 10, 8, 4, '#7a3e2b'); rp(4, 10, 6, 3, '#fff4d6'); rp(5, 11 + blink(3), 4, 1, '#c9b48a'); rp(7, 10, 1, 3, '#c9b48a');
        return;
      case 'spyglass': { // searching: a brass spyglass to the eye, sweeping
        const dy = blink(1.2); rp(10, 6 + dy, 6, 2, '#c9a24a'); rp(10, 6 + dy, 6, 1, '#e2c27a'); rp(16, 5 + dy, 2, 4, '#8b6a2a');
        if (blink(2)) rp(17, 6 + dy, 1, 1, '#e6f4ff');
        rp(11, 9, 1, 3, '#e0a878');
        return;
      }
      case 'pigeon': { // the web: a pigeon flies out and back
        const bx = Math.round(7 + Math.cos(T * 2) * 16), by = Math.round(-8 + Math.sin(T * 4) * 3), up = blink(6);
        rp(bx, by, 2, 1, '#ececec'); rp(bx + 2, by, 1, 1, '#f0b429'); rp(bx - 1, by + (up ? -1 : 1), 2, 1, '#bdbdbd'); rp(bx, by + 1, 1, 1, '#9aa0a6');
        return;
      }
      case 'magnifier': { // tests: a magnifying glass over the crops
        const lx = 13 + Math.round(Math.sin(T * 2.5) * 2);
        rp(11, 11, lx - 11, 1, '#6b4320');
        rp(lx, 9, 4, 1, '#c9a24a'); rp(lx, 14, 4, 1, '#c9a24a'); rp(lx - 1, 10, 1, 4, '#c9a24a'); rp(lx + 4, 10, 1, 4, '#c9a24a');
        rp(lx, 10, 4, 4, '#d8f0ff'); rp(lx + 1, 10, 1, 1, '#ffffff');
        return;
      }
      case 'rake': // lint and format: raking the rows tidy
        if (blink(2.5)) { rp(12, 1, 1, 11, '#8b5a2b'); rp(10, 0, 5, 1, '#9aa4ad'); rp(10, 1, 1, 1, '#9aa4ad'); rp(12, 1, 1, 1, '#9aa4ad'); rp(14, 1, 1, 1, '#9aa4ad'); }
        else { rp(11, 13, 6, 1, '#8b5a2b'); rp(17, 11, 1, 5, '#9aa4ad'); rp(18, 11, 1, 1, '#9aa4ad'); rp(18, 13, 1, 1, '#9aa4ad'); rp(18, 15, 1, 1, '#9aa4ad'); rp(19, 14, 3, 1, '#5e3d22'); }
        return;
      case 'hammer': { // build: mending a fence post
        rp(18, 8, 2, 8, '#a8703c'); rp(18, 8, 2, 1, '#c98d4f'); rp(17, 11, 4, 1, '#8b5a2b');
        if (blink(3)) { rp(12, 4, 1, 7, '#8b5a2b'); rp(11, 3, 3, 2, '#5f6b7a'); }
        else { rp(12, 10, 5, 1, '#8b5a2b'); rp(16, 9, 2, 3, '#5f6b7a'); rp(18, 7, 1, 1, '#ffd43b'); rp(20, 8, 1, 1, '#ffd43b'); }
        return;
      }
      case 'barrow': { // installing: a wheelbarrow of sacks
        const bump = blink(4);
        rp(11, 11, 2, 1, '#8b5a2b'); rp(13, 10 - bump, 6, 3, '#9aa4ad'); rp(13, 10 - bump, 6, 1, '#c3cbd2');
        rp(14, 8 - bump, 2, 2, '#d8c48a'); rp(16, 7 - bump, 2, 3, '#c9a46a'); rp(14, 13, 1, 2, '#6b4320');
        rp(18, 13, 2, 2, '#2a1d14'); rp(18 + blink(6), 13, 1, 1, '#9aa4ad');
        return;
      }
      case 'crate': { // commit: produce goes into a crate
        rp(13, 10, 6, 5, '#8b5a2b'); rp(13, 10, 6, 1, '#b07a46'); rp(13, 12, 6, 1, '#6b4320'); rp(15, 10, 1, 5, '#6b4320');
        const ph = (T * 1.2) % 1;
        if (ph < 0.8) rp(15, 5 + Math.round(ph * 5), 2, 2, ['#e76f51', '#f4a261', '#e9c46a'][Math.floor(T * 1.2) % 3]);
        rp(11, 11, 2, 1, '#e0a878');
        return;
      }
      case 'cart': { // push: a cart of crates off to market (with a flag: deploying)
        const roll = blink(6);
        rp(11, 10, 2, 1, '#6b4320'); rp(13, 9, 8, 3, '#a8703c'); rp(13, 9, 8, 1, '#c98d4f');
        rp(14, 6, 3, 3, '#8b5a2b'); rp(14, 6, 3, 1, '#b07a46'); rp(17, 7, 3, 2, '#8b5a2b'); rp(17, 7, 3, 1, '#b07a46');
        rp(15, 12, 3, 3, '#2a1d14'); rp(16 - roll, 13, 1, 1, '#9aa4ad'); rp(22, 14, 1, 1, '#b08850');
        if (flag) { rp(20, 2, 1, 7, '#6b4320'); rp(21, 2, 3 + blink(3), 2, '#e63946'); rp(21, 4, 2, 1, '#e63946'); }
        return;
      }
      case 'mailbag': { // pull: a satchel of letters
        rp(4, 9, 1, 1, '#5e3d22'); rp(5, 10, 5, 1, '#5e3d22'); rp(10, 11, 5, 4, '#7a5230'); rp(10, 11, 5, 1, '#5e3d22');
        const up = blink(2); rp(11, 9 - up, 3, 2, '#fff4d6'); rp(13, 9 - up, 1, 1, '#e63946');
        return;
      }
      case 'lantern': { // a server or a long wait: keeping watch with a lantern
        const flick = blink(5);
        PXG.lights?.push([rp.ox + 12.5 * SC, rp.oy + 10 * SC, 9, null]);
        PXG.ctx.globalAlpha = 0.22 + 0.08 * flick; rp(8, 6, 9, 10, '#ffe8a3'); PXG.ctx.globalAlpha = 1;
        rp(12, 5, 1, 2, '#2a1d14'); rp(11, 7, 3, 1, '#2a1d14'); rp(11, 8, 3, 4, '#5f6b7a'); rp(12, 9, 1, 2, flick ? '#ffd43b' : '#ff922b'); rp(11, 12, 3, 1, '#2a1d14');
        return;
      }
      case 'sickle': // deleting: clearing weeds
        if (blink(3)) { rp(12, 7, 1, 4, '#8b5a2b'); rp(12, 4, 3, 1, '#c3cbd2'); rp(15, 5, 1, 2, '#c3cbd2'); }
        else { rp(12, 12, 3, 1, '#8b5a2b'); rp(15, 12, 1, 3, '#c3cbd2'); rp(13, 15, 2, 1, '#c3cbd2'); rp(17, 10, 1, 1, '#4f7f2f'); rp(18, 12, 1, 1, '#4f7f2f'); rp(19, 9, 1, 1, '#6d8f3a'); }
        return;
      case 'whistle': // subagents: whistling, notes floating up
        rp(9, 7, 2, 1, '#c3cbd2'); rp(11, 8, 1, 2, '#e0a878');
        for (let i = 0; i < 2; i++) { const ph = (T * 1.1 + i / 2) % 1, nx = 13 + i * 3, ny = Math.round(5 - ph * 7); rp(nx, ny, 1, 3, '#ffffff'); rp(nx + 1, ny, 1, 1, '#ffffff'); rp(nx - 1, ny + 2, 1, 1, '#ffffff'); }
        return;
      case 'clipboard': // planning: a chore list being ticked
        rp(1, 9, 5, 6, '#a8703c'); rp(2, 10, 3, 4, '#fff4d6'); rp(3, 9, 1, 1, '#9aa4ad'); rp(2, 11, 3, 1, '#9aa0a6'); rp(2, 13, 2, 1, '#9aa0a6');
        if (blink(2)) rp(4, 13, 1, 1, '#2fa57a');
        rp(11, 9, 1, 3, '#f0b429'); rp(11, 12, 1, 1, '#2a1d14');
        return;
      default:
    }
  }

  /** For tests and the legend: paints one tool (held by a farmer when `look` is given) or one plant on a 2D context. */
  function paint(ctx, { prop, flag, crop, stage = 0, T = 0, look, face = 'down', legs = 's', land, rows = 1, season }) {
    Object.assign(PXG, { ctx, T, k: 1 });
    if (land) drawLand(px, layoutFor(Array.from({ length: rows * 3 }, (_, i) => ({ key: `f${i}` }))), season);
    if (look) ctx.drawImage(farmerSprite(look, SHIRT[0], false, legs, false, face), 0, 0, 14 * SC, 16 * SC);
    if (prop) drawProp(prop, rpAt(0, 0), T, flag);
    if (crop) drawCrop(crop, 10, 20, stage, 0);
  }

  function makeFarm() {
    const game = { coins: 0, harvests: 0 }; // page memory only: resets on reload
    let L = layoutFor([]);
    let scene = { fields: [], farmers: [] };
    let season = 'summer';
    const stOf = k => L.ST.find(s => s.key === k);
    const fieldByKey = k => scene.fields.find(f => f.key === k);

    function plotState(f) {
      const here = scene.farmers.filter(a => a.field === f.key), on = here.filter(a => ACTIVE.has(a.state));
      const crop = f.crop ?? 'wheat';
      if (on.length) { const p = Math.max(...on.map(a => a.pct)); return { kind: 'grow', crop, p, stage: growthStage(p), busy: on.some(a => a.state === 'working') }; }
      if (here.length && here.every(a => a.state === 'stale')) return { kind: 'dry', crop };
      return { kind: 'bare', crop };
    }
    function drawPlot(s) {
      const f = fieldByKey(s.key), x0 = s.cx - 42, y0 = s.rowTop + 4, st = plotState(f), T = PXG.T, fence = f.fence ?? '#c98d4f';
      px(x0 - 3, y0 - 3, 90, 50, '#2a1d14'); px(x0 + 87, y0 - 1, 2, 50, '#24361f'); px(x0 - 1, y0 + 47, 90, 2, '#24361f'); // outline, shadow
      px(x0 - 2, y0 - 2, 88, 48, fence); px(x0 - 2, y0 - 2, 88, 1, shade(fence, 1.18)); px(x0 - 1, y0 - 1, 86, 46, shade(fence, 0.68));
      const soil = f.soil ?? '#7a5230', furrow = shade(soil, 0.77), ridge = shade(soil, 1.15);
      px(x0, y0, 84, 44, soil); px(x0, y0, 84, 1, furrow); px(x0, y0 + 43, 84, 1, furrow);
      for (let k = 0; k < 5; k++) { const fy = y0 + 6 + k * 8; px(x0 + 2, fy - 1, 80, 1, ridge); px(x0 + 2, fy, 80, 2, furrow); px(x0 + 2, fy + 2, 80, 1, shade(soil, 0.9)); } // lit ridge, dark furrow
      for (let n = 0; n < 26; n++) { const sx = x0 + 3 + noise(n, s.cx) % 78, sy = y0 + 2 + noise(s.cx, n) % 40; px(sx, sy, 1, 1, n % 2 ? ridge : furrow); } // clods
      if (season === 'winter' && st.kind !== 'grow') for (let k = 0; k < 5; k++) px(x0 + 2, y0 + 5 + k * 8, 80, 1, '#f4f8fb'); // frost on fallow rows
      for (let k = 0; k < 4; k++) for (let i = 0; i < 10; i++) {
        const x = x0 + 6 + i * 8, y = y0 + 5 + k * 8;
        if (st.kind === 'bare') { // fallow: weeds
          if ((i * 5 + k * 3) % 7 === 0) { px(x, y - 2, 1, 2, '#4f7f2f'); px(x - 1, y - 1, 1, 1, '#4f7f2f'); px(x + 1, y - 1, 1, 1, '#4f7f2f'); }
          continue;
        }
        if (st.kind === 'dry') { px(x, y - 2, 1, 2, '#9c7a4a'); px(x + 1, y - 3, 1, 1, '#9c7a4a'); continue; }
        // a few plants run a stage behind, as in a real field
        const stage = Math.max(0, st.stage - (st.stage > 0 && (i * 7 + k * 3) % 5 === 0 ? 1 : 0));
        const sway = Math.round(Math.sin(T * 1.7 - x * 0.09 + k * 0.6) * (st.busy ? 1 : 0.8)); // the wind goes over the field in waves
        const top = drawCrop(st.crop, x, y, stage, sway);
        // ripe (context nearly full, ready to harvest): a sparkle now and then
        if (stage === 5 && (i * 7 + k * 3 + Math.floor(T * 3)) % 13 === 0) { px(x, top - 5, 1, 3, '#ffffff'); px(x - 1, top - 4, 3, 1, '#ffffff'); }
      }
      seedSign(f.crop ?? 'wheat', x0 - 6, y0 + 26); // what this field grows, even while it lies fallow
      if (f.pennant) { // a branch other than main: a pennant by the fence
        const fx = x0 + 86, fy = y0 + 2, wave = blink(2);
        px(fx, fy, 1, 15, '#6b4320');
        for (let r = 0; r < 5; r++) px(fx + 1, fy + r, 5 - r - (r === 2 ? wave : 0), 1, r === 0 ? '#7fb0ff' : '#3d7be0');
      }
      if (f.collision) { // two farmers writing one repo: rope with orange flags (faster when a git command is involved)
        PXG.ctx.globalAlpha = 0.7 + 0.3 * Math.sin(T * (f.collision === 'high' ? 14 : 6));
        for (let i = 0; i < 88; i += 4) { const c = (i / 4) % 2 ? '#fff3d6' : '#ff8c42'; px(x0 - 2 + i, y0 - 2, 4, 1, c); px(x0 - 2 + i, y0 + 45, 4, 1, c); }
        for (let i = 0; i < 48; i += 4) { const c = (i / 4) % 2 ? '#fff3d6' : '#ff8c42'; px(x0 - 2, y0 - 2 + i, 1, 4, c); px(x0 + 85, y0 - 2 + i, 1, 4, c); }
        for (const [fx, fy] of [[x0 - 3, y0 - 6], [x0 + 84, y0 - 6]]) { px(fx, fy, 1, 6, '#6b4320'); px(fx + 1, fy, 4, 3, '#ff5a1f'); }
        PXG.ctx.globalAlpha = 1;
      }
    }
    // Above each field: mailbox = behind the remote, crates = unpushed commits, hay bales = uncommitted files.
    function drawPiles(s) {
      const f = fieldByKey(s.key), y = s.rowTop, cx = s.cx;
      if (f.behind > 0) { px(cx - 40, y - 9, 2, 11, '#6b4320'); px(cx - 44, y - 13, 9, 5, '#5f6b7a'); px(cx - 44, y - 13, 9, 1, '#7d8a99'); px(cx - 35, y - 17, 1, 6, '#e63946'); px(cx - 35, y - 17, 3, 2, '#e63946'); }
      for (let i = 0; i < Math.min(4, Math.ceil(f.ahead / 4)); i++) { const x = cx - 30 + (i % 2) * 8, yy = y - 6 - Math.floor(i / 2) * 6; px(x, yy, 7, 6, '#8b5a2b'); px(x, yy, 7, 1, '#b07a46'); px(x + 3, yy, 1, 6, '#6b4320'); }
      for (let i = 0; i < Math.min(4, Math.ceil(f.dirty / 3)); i++) { const x = cx + 16 + (i % 3) * 10, yy = y - 6 - Math.floor(i / 3) * 6; px(x, yy, 9, 6, '#e2c26b'); px(x, yy, 9, 1, '#f1d98a'); px(x + 2, yy, 1, 6, '#c9a24a'); px(x + 6, yy, 1, 6, '#c9a24a'); }
    }
    /** The silo's grain and lamp, the pond's ripples and duck, the henhouse's eggs: each frame. */
    function seasonTip() {
      const w = scene.plan?.windows?.find(x => x.kind === 'five_hour');
      return `The season follows your plan's 5-hour limit${w ? `: ${w.reset ? 'just reset' : `${Math.round(w.percentUsed)}% used`}` : ' (no reading yet: summer)'}. Spring while it is fresh, then summer and autumn; winter when it is nearly used up`;
    }
    function drawScenery() {
      const T = PXG.T, silo = siloOf(scene.plan);
      px(379, 8, 6, 20, '#3a3a40');
      if (silo) {
        const h = Math.round(20 * silo.fill);
        if (h) { px(379, 28 - h, 6, h, '#e9c46a'); px(379, 28 - h, 6, 1, '#f4d58d'); }
        for (const t of [0.25, 0.5, 0.75]) px(385, 28 - Math.round(20 * t), 1, 1, '#c3cbd2');
        if (silo.lamp && (silo.lamp === 'amber' || blink(2))) { px(380, 0, 4, 2, silo.lamp === 'red' ? '#e04a3a' : '#f0b429'); PXG.lights?.push([382, 1, 6, [380, 0, 4, 2]]); }
      }
      const py = L.BOT_TOP - 22;
      if (season !== 'winter') {
        for (let i = 0; i < 2; i++) { const ph = (T * 0.5 + i * 0.5) % 1, r = Math.round(ph * 5); PXG.ctx.globalAlpha = 0.6 * (1 - ph); px(16 - r, py + 6 + i * 3, r * 2 + 1, 1, '#a9dcf7'); }
        PXG.ctx.globalAlpha = 1;
        const dx = Math.round(10 + Math.sin(T * 0.25) * 8), face = Math.cos(T * 0.25) > 0 ? 1 : -1; // a duck paddles
        px(dx, py + 5, 5, 3, '#ffffff'); px(dx + (face > 0 ? 3 : -1), py + 3, 3, 3, '#ffffff'); px(dx + (face > 0 ? 6 : -2), py + 4, 2, 1, '#f08a24'); px(dx + (face > 0 ? 4 : 0), py + 4, 1, 1, '#1b1420');
      } else if (blink(1.5)) px(14, py + 4, 2, 1, '#ffffff'); // ice glints
      const hx = 36, hy = L.BOT_TOP - 27, eggs = scene.henhouse?.eggs ?? 0;
      px(hx + 1, hy + 21, 12, 3, '#c9a24a'); px(hx + 1, hy + 21, 12, 1, '#e9c46a'); // the nest
      for (let i = 0; i < eggs; i++) { px(hx + 2 + i * 2, hy + 20 - (i % 2), 2, 2, i % 3 ? '#f4ecd8' : '#ffffff'); }
      if (scene.henhouse?.roosting) { px(hx + 10, hy + 14, 3, 3, '#ffffff'); px(hx + 11, hy + 13, 1, 1, '#e04a3a'); px(hx + 13, hy + 15, 1, 1, '#f0b429'); } // a hen looks out
    }
    function drawTree() { // the shade tree, by season: blossom in spring, apples in summer, orange in autumn, bare and snowy in winter
      const { BOT_TOP, LANE_B } = L, S = SEASONS[season], [dark, mid, light] = S.canopy;
      px(51, BOT_TOP + 12, 11, LANE_B - BOT_TOP - 14, '#2a1d14'); px(52, BOT_TOP + 12, 9, LANE_B - BOT_TOP - 14, '#6b4320'); px(52, BOT_TOP + 12, 2, LANE_B - BOT_TOP - 14, '#8b5a2b');
      px(48, LANE_B - 4, 4, 2, '#6b4320'); px(61, LANE_B - 4, 4, 2, '#6b4320'); // roots
      if (S.snow) { // bare branches with snow on them
        for (const [x, y, w] of [[30, BOT_TOP + 2, 24], [58, BOT_TOP - 2, 26], [40, BOT_TOP - 8, 16], [24, BOT_TOP + 8, 10], [62, BOT_TOP + 6, 18]]) { px(x, y, w, 2, '#4e3626'); px(x + 1, y - 1, w - 2, 1, '#f4f8fb'); }
        px(53, BOT_TOP - 8, 3, 22, '#4e3626');
        return;
      }
      px(17, BOT_TOP - 7, 80, 22, '#1f3d1a'); px(25, BOT_TOP - 12, 64, 6, '#1f3d1a'); // outline
      px(18, BOT_TOP - 6, 78, 20, dark); px(26, BOT_TOP - 11, 62, 6, dark); px(22, BOT_TOP + 14, 70, 3, '#24361f');
      px(32, BOT_TOP - 9, 20, 4, mid); px(58, BOT_TOP - 4, 24, 5, mid); px(24, BOT_TOP + 2, 14, 4, mid); px(70, BOT_TOP + 4, 16, 4, mid);
      px(34, BOT_TOP - 10, 10, 1, light); px(60, BOT_TOP - 5, 12, 1, light); px(26, BOT_TOP + 1, 6, 1, light);
      const fruit = season === 'spring' ? S.bloom : season === 'autumn' ? '#e9a23b' : '#e63946';
      for (const [x, y] of [[40, BOT_TOP - 2], [70, BOT_TOP + 6], [30, BOT_TOP + 8], [80, BOT_TOP - 3], [50, BOT_TOP + 9]]) { px(x, y, 3, 3, fruit); px(x, y, 1, 1, '#fff4d6'); } // apples, blossom
    }
    function drawPosts() {
      const { LANE_B } = L;
      for (const x of [129, 268]) { px(x - 1, LANE_B - 34, 5, 40, '#2a1d14'); px(x, LANE_B - 34, 3, 40, '#8b5a2b'); px(x, LANE_B - 34, 1, 40, '#a8703c'); }
      px(126, LANE_B - 37, 148, 5, '#2a1d14'); px(127, LANE_B - 36, 146, 3, '#8a3b2e'); px(127, LANE_B - 36, 146, 1, '#b23a2e');
      if (season === 'winter') px(127, LANE_B - 37, 146, 1, '#f4f8fb');
    }

    return {
      key: 'farm', SH: 16, game,
      setScene(next) { scene = next; season = seasonOf(next.plan); },
      layout: () => L,
      relayout(fields) { L = layoutFor(fields); return L; },
      // Where each farmer stands. Porch, tree, scarecrows and meadow hold four each; the rest show as a "+N" sign.
      slots(f) {
        const { LANE_B, rows } = L;
        const s = f.state === 'working' ? stOf(f.field) : null;
        if (s) return { group: `st:${s.key}`, at: used => { const off = [doing(f)?.spot ?? 0, 0, -26, 26, -13, 13].find(o => !used.includes(o)) ?? 0; used.push(off); return [s.cx + off, s.lane]; }, zone: `st:${s.key}:${doing(f)?.prop ?? ''}` };
        if (f.state === 'working') return { group: 'meadow', cap: Math.min(8, rows * 2), at: i => [i % 2 ? 36 : 16, TOP + 30 + Math.floor(i / 2) * 37 + (i % 2) * 12], zone: 'meadow' };
        if (f.state === 'waiting') return { group: 'desk', cap: 3, at: i => [142 + 24 * i, LANE_B], zone: 'desk' }; // the porch: 3 waiting on the left,
        if (f.state === 'turn') return { group: 'turn', cap: 3, at: i => [258 - 24 * i, LANE_B], zone: 'turn' }; // 3 with their turn on the right, apart
        if (f.state === 'stale') return { group: 'storage', cap: 4, at: i => [308 + 26 * i, LANE_B - 2], zone: 'storage' };
        return { group: 'charge', cap: 4, at: i => [20 + 26 * i, LANE_B], zone: 'charge' };
      },
      spawn: () => BARN_DOOR,
      follow: (b, k, T, kid) => (kid?.dog
        ? [b.x + Math.cos(T * 0.9 + k) * 44, b.y + 4 + Math.sin(T * 1.8) * 8] // the Explore dog roams and sniffs
        : [b.x + (k % 2 ? 1 : -1) * (7 * SC + 4) + Math.sin(T * 1.3 + k) * 3, b.y + 3 - (k > 1 ? 4 * SC : 0)]),
      startText: n => `Morning: <b>${n}</b> farmer${n === 1 ? '' : 's'} on the farm`,
      arriveText: 'walks out of the barn',
      tag: f => (f.kind === 'codex' ? clip(f.name, 16) : `${clip(f.name, 16)} ${'♥'.repeat(f.hearts)}${'♡'.repeat(4 - f.hearts)}`),
      tip: f => {
        const field = fieldByKey(f.field);
        const what = f.state === 'waiting' ? `needs you: ${f.ask}` : f.state === 'turn' ? (f.question ? `asks you: ${f.question}` : `your turn: ${f.reply || 'finished'}`)
          : f.state === 'working' ? `${doing(f)?.verb ?? 'working'}${field ? ` in ${field.name}` : ''}${f.summary ? ` · ${f.summary}` : ''}`
          : f.state === 'stale' ? 'stale' : 'idle';
        const mode = { acceptEdits: 'accept edits', plan: 'plan mode', auto: 'auto mode', bypassPermissions: '⚠ bypass permissions', dontAsk: "don't ask" }[f.mode];
        return `${f.name} · ${what}${f.kind === 'codex' ? '' : ` · ${Math.round((1 - f.pct) * 100)}% context left`}${f.cost != null ? ` · $${f.cost.toFixed(2)} so far` : ''}${mode ? ` · ${mode}` : ''}`;
      },
      onMove(f, zone, prev, pop) {
        if (!prev) return;
        if (zone.startsWith('st:') && prev.startsWith('st:')) { game.coins++; pop('+1', 'coin'); }
        else if (zone === 'turn') { game.harvests++; game.coins += 5; pop('Harvest! +5', 'good'); }
        else if (zone === 'desk') pop('Needs you!', 'warn');
        else if (zone === 'storage') pop('…zzz', 'dim');
      },
      zoneText(f, z) {
        if (z === 'desk') return f.askKind === 'permission' ? 'comes up to your porch: needs a permission' : 'comes up to your porch with a question';
        if (z === 'turn') return f.question ? 'comes to your porch with a question' : 'brings a basket of finished work to your porch';
        if (z === 'storage') return 'stands still as a scarecrow (stale)';
        if (z === 'charge') return 'rests under the shade tree (idle)';
        if (z === 'meadow') return 'works in the wild meadow (no repo)';
        return `${doing(f)?.verb ?? 'working'} in the ${fieldByKey(f.field)?.name ?? ''} field`;
      },
      hud(still, zoom = 1, saysOn = true, skyMode = 'live', follow = false, canFollow = false, restingHidden = null) {
        const need = scene.farmers.filter(a => a.state === 'waiting' || a.question).length;
        const w = t => pxt(t, '#fff3d6', '#2a1d14');
        return `<span title="One coin for every tool step since you opened this page"><b class="coin"></b>${w(String(game.coins))}</span>
          <span title="Finished turns delivered to your porch"><b class="basket"></b>${w(`${game.harvests} harvested`)}</span>
          ${need ? `<span class="alert">${pxt(`${need} need${need > 1 ? '' : 's'} you`, '#ffffff', '#5a1f19')}</span>` : ''}
          <span title="${esc(seasonTip())}">${{ spring: '🌱', summer: '☀️', autumn: '🍂', winter: '❄️' }[season]} ${w(season)}</span>
          <span class="px-zoom" title="Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in"><button type="button" data-farm-zoom="-1" aria-label="Zoom out">${w('-')}</button><button type="button" data-farm-zoom="0" title="Show the whole farm">${w(`${Math.round(zoom * 100)}%`)}</button><button type="button" data-farm-zoom="1" aria-label="Zoom in">${w('+')}</button></span>
          <button type="button" data-farm-follow${canFollow ? '' : ' disabled'} title="${canFollow ? 'Keep the farmer you picked in the middle of the view (zooms in); dragging the view turns it off' : 'Pick a farmer first, then Follow keeps it in view'}">${w(`Follow: ${follow ? 'on' : 'off'}`)}</button>
          <button type="button" data-farm-resting title="Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work">${w(restingHidden === null ? 'Resting: shown' : `Resting: hidden (${restingHidden})`)}</button>
          <button type="button" data-farm-bubbles title="Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again">${w(`Bubbles: ${saysOn ? 'on' : 'off'}`)}</button>
          <button type="button" data-farm-sky title="The sky: live follows your clock (dawn, day, dusk, night); or hold it at day or night">${w(`Sky: ${skyMode}`)}</button>
          <button type="button" class="px-motion" data-farm-motion title="Walking and animation on the farm">${w(`Motion: ${still ? 'off' : 'on'}`)}</button>
          <button type="button" class="px-info" data-farm-help title="How to read the farm" aria-label="How to read the farm">i</button>`;
      },
      bg(f, season, ext) { drawLand(f, L, season, ext); },
      ground() { drawScenery(); L.ST.forEach(drawPlot); L.ST.forEach(drawPiles); },
      season: () => season,
      /** Particles a farmer gives off: dust when walking; splashes, clods, sparks, chips from its tool. */
      emit(f, b, dt, add) {
        const ox = b.x - 7 * SC, oy = b.y - 16 * SC, T = PXG.T;
        if (b.walk) {
          if (Math.random() < dt * 9) add({ x: b.x + rand(-3, 3), y: b.y - 0.5, vx: rand(-5, 5) - (b.face === 'right' ? 6 : b.face === 'left' ? -6 : 0), vy: rand(-9, -3), g: 18, life: 0.5, max: 0.5, size: rand(1, 2.2), color: '#c9a46a', alpha: 0.75 });
          return;
        }
        if (f.state !== 'working') return;
        const prop = doing(f)?.prop;
        if (prop === 'can' && Math.random() < dt * 10) add({ x: ox + 17 * SC + rand(-1, 1), y: b.y - 1, vx: rand(-14, 14), vy: rand(-22, -10), g: 90, life: 0.3, max: 0.3, size: 1, color: '#5ab4ff' });
        if ((prop === 'hoe' || prop === 'rake') && !blink(prop === 'hoe' ? 3 : 2.5) && Math.random() < dt * 8) add({ x: ox + 17 * SC, y: b.y - 1, vx: rand(4, 18), vy: rand(-24, -12), g: 80, life: 0.45, max: 0.45, size: 1.5, color: '#5e3d22' });
        if (prop === 'hammer' && !blink(3) && Math.random() < dt * 10) add({ x: ox + 18.5 * SC, y: oy + 8 * SC, vx: rand(-20, 20), vy: rand(-26, -8), g: 70, life: 0.3, max: 0.3, size: 1, color: '#ffd43b' });
        if (prop === 'sickle' && !blink(3) && Math.random() < dt * 8) add({ x: ox + 16 * SC, y: b.y - 3, vx: rand(6, 22), vy: rand(-20, -6), g: 50, life: 0.6, max: 0.6, size: 1.5, color: '#4f8f3a' });
        if ((prop === 'cart' || prop === 'barrow') && Math.random() < dt * 5) add({ x: ox + 17 * SC, y: b.y, vx: rand(-8, 4), vy: rand(-6, -2), g: 10, life: 0.6, max: 0.6, size: 2, color: '#c9a46a', alpha: 0.6 });
        if (prop === 'crate' && T % 1.6 < dt) for (let i = 0; i < 3; i++) add({ x: ox + 16 * SC, y: oy + 10 * SC, vx: rand(-10, 10), vy: rand(-18, -8), g: 40, life: 0.4, max: 0.4, size: 1, color: '#f4d58d' });
      },
      /** The farm's own particles: smoke from the chimney while agents work; petals, leaves or snow by the season. */
      ambient(dt, add) {
        const { BOT_TOP, H } = L;
        if (season === 'spring' && Math.random() < dt * 3) add({ x: rand(22, 92), y: BOT_TOP + rand(-8, 10), vx: rand(3, 9), vy: rand(5, 9), g: 0, life: 3, max: 3, size: 1, color: '#f4b6c2', sway: 3 });
        if (season === 'autumn' && Math.random() < dt * 4) add({ x: rand(20, 94), y: BOT_TOP + rand(-8, 12), vx: rand(2, 8), vy: rand(6, 11), g: 0, life: 3.2, max: 3.2, size: 1.5, color: ['#c8681a', '#e9a23b', '#b5562f'][Math.floor(rand(0, 3))], sway: 4 });
        const e = PXG.ext ?? { x0: 0, x1: W, y0: 0, y1: H };
        if (season === 'winter' && Math.random() < dt * 28 * ((e.x1 - e.x0) / W)) add({ x: rand(e.x0, e.x1), y: e.y0 - 2, vx: rand(-2, 2), vy: rand(9, 16), g: 0, life: (e.y1 - e.y0) / 10, max: (e.y1 - e.y0) / 10, size: rand(1, 1.6), color: '#ffffff', sway: 2, alpha: 0.9 });
        if (scene.farmers.some(a => a.state === 'working') && Math.random() < dt * 2.2) {
          add({ x: 244 + rand(-1, 1), y: L.BOT_TOP - 5, vx: rand(2, 6), vy: rand(-9, -6), g: 0, life: 2.6, max: 2.6, size: 2, grow: 1.4, color: '#c3cbd2', alpha: 0.55 });
        }
      },
      /** Soft shadows on the ground under farmers and their animals, so nothing floats. */
      shadows(b) {
        PXG.ctx.globalAlpha = 0.3;
        const x = Math.round(b.x), y = Math.round(b.y);
        px(x - 6, y - 1, 12, 1, '#1f3d1a'); px(x - 8, y, 16, 2, '#1f3d1a'); px(x - 5, y + 2, 10, 1, '#1f3d1a');
        for (const d of b.kids) { const kx = Math.round(d.x), ky = Math.round(d.y); px(kx - 4, ky, 8, 1, '#1f3d1a'); px(kx - 3, ky + 1, 6, 1, '#1f3d1a'); }
        PXG.ctx.globalAlpha = 1;
      },
      /** Lights that glow at night: [x, y, reach, the lit shape]. */
      lights() {
        const { BOT_TOP } = L;
        const { LANE_B } = L;
        return [[25, 12, 7, [24, 11, 2, 1]], [158, BOT_TOP + 25, 16, [149, BOT_TOP + 20, 18, 11, true]], [242, BOT_TOP + 25, 16, [233, BOT_TOP + 20, 18, 11, true]], [200, LANE_B - 26, 30, [199, LANE_B - 33, 2, 1]]];
      },
      fieldAt(x, y) { return L.ST.find(s => Math.abs(x - s.cx) <= 46 && y >= s.rowTop - 18 && y <= s.rowTop + 50)?.key ?? null; },
      items: () => [[L.BOT_TOP + 30, drawTree], [L.LANE_B + 6, drawPosts]],
      drawChar(f, b) {
        const scare = f.state === 'stale', [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy);
        if (scare) { rp(0, 10, 14, 1, '#6b4320'); rp(-1, 9, 2, 3, '#d8c48a'); rp(13, 9, 2, 3, '#d8c48a'); }
        const view = b.walk ? b.face ?? 'down' : 'down';
        PXG.ctx.drawImage(farmerSprite(f.look, SHIRT[f.color], scare, scare ? 'p' : legFrame(b), f.state === 'waiting', view), ox, oy, 14 * SC, 16 * SC);
        if (scare) { rp(5, 6, 1, 1, '#3a2a1a'); rp(8, 6, 1, 1, '#3a2a1a'); rp(5, 7, 4, 1, '#7a5230'); rp(6, 11, 2, 2, '#c97b4a'); return; }
        if (view === 'up') return; // from behind: no face
        if (view === 'left' || view === 'right') { rp(view === 'right' ? 9 : 4, 6, 1, 1, K); return; }
        const ex = 5;
        const blinking = ((PXG.T + (f.color ?? 0) * 0.37) % 3.7) < 0.12; // now and then, each farmer on its own beat
        if ((f.state === 'idle' && !b.walk) || blinking) { rp(ex, 6, 1, 1, '#8a5a3a'); rp(ex + 3, 6, 1, 1, '#8a5a3a'); if (f.state === 'idle') return; } // eyes closed
        if (blinking) return;
        const ey = f.state === 'working' && !b.walk ? 7 : 6;
        if (f.state === 'turn' && !b.walk) { rp(ex - 1, ey, 2, 1, K); rp(ex + 3, ey, 2, 1, K); rp(ex + 1, 7, 2, 1, '#b5562f'); }
        else { rp(ex, ey, 1, f.state === 'waiting' ? 2 : 1, K); rp(ex + 3, ey, 1, f.state === 'waiting' ? 2 : 1, K); }
      },
      drawFx(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), T = PXG.T;
        if (f.hot) { rp(11, 3 + Math.floor((T * 6) % 4), 1, 2, '#8fd3ff'); rp(2, 4 + Math.floor((T * 6 + 2) % 4), 1, 2, '#8fd3ff'); rp(4, 7, 1, 1, '#ff6b6b'); rp(9, 7, 1, 1, '#ff6b6b'); }
        if (f.state === 'working' && !b.walk) { const act = doing(f); if (act) drawProp(act.prop, rp, T, act.flag); }
        if (f.state === 'waiting') {
          bubble(rp, 14, -6 - blink(3), '!');
          const x = Math.round(b.x), y = Math.round(b.y); // a ring at its feet that pulses: it needs you
          PXG.ctx.globalAlpha = 0.45 + 0.35 * Math.sin(PXG.T * 5);
          px(x - 9, y + 1, 18, 1, '#e04a3a'); px(x - 11, y, 2, 1, '#e04a3a'); px(x + 9, y, 2, 1, '#e04a3a'); px(x - 9, y - 1, 1, 1, '#e04a3a'); px(x + 8, y - 1, 1, 1, '#e04a3a');
          PXG.ctx.globalAlpha = 1;
        }
        if (f.state === 'turn') { // a basket of produce
          if (b.walk) { rp(3, 10, 8, 4, '#a8703c'); rp(3, 10, 8, 1, '#c98d4f'); rp(4, 9, 2, 1, '#e76f51'); rp(7, 9, 2, 1, '#f4a261'); rp(6, 8, 1, 1, '#3f9b3a'); }
          else {
            const x = Math.round(b.x) + 8, y = L.LANE_B - 10;
            px(x, y, 16, 9, '#a8703c'); px(x, y, 16, 2, '#c98d4f'); px(x + 2, y - 3, 4, 3, '#e76f51'); px(x + 7, y - 4, 4, 4, '#f4a261'); px(x + 11, y - 3, 3, 3, '#e9c46a'); px(x + 8, y - 6, 1, 2, '#3f9b3a');
            bubble(rp, 14, -6 - (f.question ? blink(3) : 0), f.question ? '?' : 'v'); // a question waits for your answer
          }
        }
        if (f.state === 'idle' && !b.walk) { const zy = -1 - Math.floor((T * 2) % 4); PXG.ctx.globalAlpha = 0.8; rp(12, zy, 3, 1, '#e6f4ff'); rp(13, zy + 1, 1, 1, '#e6f4ff'); rp(12, zy + 2, 3, 1, '#e6f4ff'); PXG.ctx.globalAlpha = 1; }
        if (f.state === 'stale') { const peck = blink(1.5); rp(5, -2, 4, 2, '#1d1d1d'); rp(4, -3, 2, 2, '#1d1d1d'); rp(3, -2 + peck, 1, 1, '#f0b429'); rp(8, -1, 2, 1, '#1d1d1d'); } // crow on the hat
        b.kids.forEach((d, k) => { // chickens = subagents, the dog = an Explore subagent
          if (f.kids[k]?.dog) {
            const left = Math.sin(T * 0.9 + k) > 0, sniff = blink(3), m = (x, w) => (left ? 8 - x - w : x);
            const dp = rpAt(Math.round(d.x - 4.5 * SC), Math.round(d.y - 6 * SC)), c = (x, y, w, h, col) => dp(m(x, w), y, w, h, col);
            c(1, 2, 5, 2, '#a0662e'); c(5, 1 + sniff, 2, 2, '#a0662e'); c(5, sniff, 1, 1, '#6b4320'); c(7, 2 + sniff, 1, 1, '#222');
            c(1, 4, 1, 1, '#6b4320'); c(4, 4, 1, 1, '#6b4320'); c(0, 1 + blink(6), 1, 1, '#a0662e'); c(2, 2, 2, 1, '#c98d4f');
            if (sniff) c(8, 4, 1, 1, '#b08850');
            return;
          }
          const hop = b.walk ? Math.round(Math.abs(Math.sin(T * 10 + k)) * 3) : (blink(2) && k % 2 ? 1 : 0);
          const cp = rpAt(Math.round(d.x - 2.5 * SC), Math.round(d.y - 5 * SC) - hop);
          cp(2, 0, 1, 1, '#e63946'); cp(1, 1, 3, 1, '#ffffff'); cp(3, 1, 1, 1, '#222'); cp(0, 2, 4, 1, '#ffffff'); cp(4, 2, 1, 1, '#f0b429'); cp(1, 3, 3, 1, '#ececec'); cp(1, 4, 1, 1, '#f0b429'); cp(3, 4, 1, 1, '#f0b429');
        });
      },
      hot: () => scene.farmers.some(a => a.hot),
      top() {
        const T = PXG.T;
        for (const s of L.ST) {
          const weather = fieldByKey(s.key).weather;
          if (weather === 'rainbow') { // deploy passed: a rainbow across the field
            PXG.ctx.globalAlpha = 0.5;
            ['#e04a3a', '#f08a24', '#ffd43b', '#6cc04a', '#3d7be0', '#8a5fc0'].forEach((c, j) => { const r = 44 - j * 2; for (let ang = 182; ang <= 358; ang += 2.5) { const t = ang * Math.PI / 180; px(Math.round(s.cx + Math.cos(t) * r), Math.round(s.rowTop + 30 + Math.sin(t) * r * 0.62), 2, 2, c); } });
            PXG.ctx.globalAlpha = 1;
            if ((Math.floor(T * 3) + s.cx) % 7 === 0) { const sx = s.cx - 30 + ((s.cx * 13 + Math.floor(T * 3) * 17) % 60), sy = s.rowTop + 8; px(sx, sy - 1, 1, 3, '#ffffff'); px(sx - 1, sy, 3, 1, '#ffffff'); }
          } else if (weather === 'windmill') { // deploy running
            const hx = s.cx - 2, hy = s.rowTop - 10;
            px(hx - 2, hy, 5, 13, '#e8d8b0'); px(hx - 3, hy - 2, 7, 2, '#8a3b2e'); px(hx, hy + 8, 1, 4, '#6b4320');
            for (let i = 0; i < 4; i++) { const t = T * 3 + i * Math.PI / 2; for (let r = 2; r <= 8; r++) px(Math.round(hx + Math.cos(t) * r), Math.round(hy + 1 + Math.sin(t) * r), 1, 1, r > 4 ? '#ffffff' : '#c9b48a'); }
          } else if (weather === 'rain') { // deploy failed: a dark cloud drifts over the field and rain falls on all of it
            const x0 = s.cx - 42, cx = Math.round(s.cx - 20 + Math.sin(T * 0.5) * 10), cy = s.rowTop - 6;
            for (let i = 0; i < 18; i++) {
              const ph = (T * 1.6 + (i * 0.37) % 1) % 1, x = x0 + 3 + ((i * 47) % 80) - Math.round(ph * 3), y = cy + 10 + ph * 44;
              if (ph < 0.92) { px(x, Math.round(y), 1, 3, '#5ab4ff'); } else { px(x - 1, s.rowTop + 46, 3, 1, '#a9dcf7'); } // a drop, then its splash
            }
            drawCloud(cx, cy + 1, 42, ['#c3cbd2', '#8a8f96', '#5f6b7a']);
          }
        }
      },
      labels(lab, overflow) {
        const { LANE_B, ST, more } = L;
        const cnt = t => pxt(t, '#5a3a1a', null); // a count on a cream tag
        lab(200, 11, pxt('AGENT FARM', '#fff3d6', '#4e3626'), 'wood');
        for (const s of ST) {
          const f = fieldByKey(s.key);
          const branch = f.branch === '(detached)' ? ` ${pxt('?', '#c3cbd2')}` : f.branch && !isMain(f.branch) ? ` ${pxt(clip(f.branch, 14), '#c3cbd2')}` : '';
          const d = f.lastDeploy;
          const weather = d ? ` ${pxt(d.label, { ok: '#8ef0a0', failed: '#ff8a80', running: '#ffd166' }[d.state] ?? '#c9b48a')}` : '';
          const tip = [f.key, f.branch && `on ${f.branch}`, d?.detail, 'Click to see the files agents touched here'].filter(Boolean).join(' · ');
          lab(s.cx, s.rowTop + 50, `<button type="button" class="px-field" data-farm-field="${esc(f.key)}" title="${esc(tip)}">${pxt(clip(f.name, 18), f.collision ? '#ffd166' : '#e6eef5')}${branch}${weather}${f.collision ? ` ${pxt('⚠ crowded', '#ffd166')}` : ''}</button>`, f.collision ? 'bad' : '');
          if (f.behind > 0) lab(s.cx - 53, s.rowTop - 7, cnt(`↓${f.behind}`), 'cnt', `${f.behind} commit${f.behind === 1 ? '' : 's'} behind the remote`);
          if (f.ahead > 0) lab(s.cx - 23, s.rowTop - 7 - Math.ceil(Math.min(f.ahead, 16) / 8) * 6, cnt(`↑${f.ahead}`), 'cnt', `${f.ahead} unpushed commit${f.ahead === 1 ? '' : 's'}`);
          if (f.dirty > 0) lab(s.cx + 30, s.rowTop - 7 - Math.ceil(Math.min(f.dirty, 12) / 9) * 6, cnt(`+${f.dirty}`), 'cnt', `${f.dirty} uncommitted file${f.dirty === 1 ? '' : 's'}`);
        }
        if (!ST.length) lab(220, TOP + 30, pxt('No fields yet: no agent has touched a repo in the last 30 minutes', '#fff3d6', '#4e3626'), 'zone');
        const silo = siloOf(scene.plan);
        if (silo) lab(382, 33, silo.lamp === 'red' ? pxt(silo.label, '#ffffff', null) : cnt(silo.label), `cnt${silo.lamp ? ` silo-${silo.lamp}` : ''}`, `The silo: your plan's weekly limit, ${silo.label} used${silo.resetsAt ? `, resets ${new Date(silo.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`);
        if (scene.henhouse?.roosting) lab(47, L.BOT_TOP - 32, cnt(`+${scene.henhouse.roosting}`), 'cnt', `${scene.henhouse.roosting} more subagent${scene.henhouse.roosting === 1 ? '' : 's'} running than the farmers can lead`);
        if (scene.henhouse?.eggs) lab(43, L.BOT_TOP - 2, cnt(`${scene.henhouse.eggs} egg${scene.henhouse.eggs === 1 ? '' : 's'}`), 'cnt', 'Eggs: subagents that finished lately');
        const sign = t => pxt(t, '#fff3d6', '#4e3626');
        lab(25, TOP + 2, sign('MEADOW'), 'zone');
        lab(58, LANE_B + 6, sign('SHADE TREE'), 'zone'); lab(200, LANE_B + 10, sign('YOUR PORCH'), 'zone'); lab(343, LANE_B + 6, sign('SCARECROWS'), 'zone');
        const plus = (x, y, n, what) => n > 0 && lab(x, y, cnt(`+${n} ${what}`), 'cnt');
        plus(150, LANE_B - 40, overflow.desk, 'waiting');
        plus(250, LANE_B - 40, overflow.turn, 'your turn');
        plus(58, L.BOT_TOP + 22, overflow.charge, 'idle');
        plus(343, L.BOT_TOP + 22, overflow.storage, 'stale');
        plus(25, L.BOT_TOP - 8, overflow.meadow, 'in the meadow');
        if (more > 0) lab(320, 11, `<button type="button" class="px-more" data-farm-more>${pxt(`+${more} more field${more === 1 ? '' : 's'}`, '#fff3d6', '#4e3626')}</button>`, 'wood');
      },
    };
  }

  /** The farm's legend, shown in a dialog from the ⓘ button. */
  function helpHtml() {
    return `<div class="px-key">
      <b>Your porch</b><span>a farmer waving a red “!” needs you; a basket means it's your turn</span>
      <b>Fields</b><span>one per repo, each with its own crop (the seed packet on its fence), soil and fence; a blue pennant = a branch other than main</span>
      <b>Tools</b><span>what a working farmer holds is its current step: almanac = reading, spyglass = searching, pigeon = the web, hoe = editing, seeds = a new file, magnifier = running tests, rake = lint or format, hammer = a build, wheelbarrow = installing, crate = a commit, cart = a push or a PR (with a red flag: a deploy), mailbag = a pull, lantern = a server or a long wait, sickle = deleting, whistle = calling subagents, clipboard = planning, watering can = any other command</span>
      <b>Farmers</b><span>one per agent; each has its own hat, hair and clothes, and its shirt is the agent's colour in the list</span>
      <b>Speech bubbles</b><span>what a farmer asked or last said; × hides one to a 💬 (click it to show the bubble again); a new message brings it back by itself. The Bubbles switch hides or shows them all</span>
      <b>Above a field</b><span>hay = uncommitted files, crates = unpushed commits, mailbox = behind the remote</span>
      <b>Weather</b><span>the repo's last deploy, from GitHub Actions or a deploy an agent ran itself (a deploy script over ssh, rsync, vercel…), whichever is newer: rainbow = deployed, rain = deploy failed (hover its sign for why; the close-up links to the run), windmill = deploying. A run GitHub never started (billing, spending limit) brings no weather: ⏸ Actions didn't run. Rope = two agents writing one repo</span>
      <b>Hearts, crops</b><span>hearts = context left. Crops grow as the context fills: seeds, sprouts, young plants, in flower, ripening, then ripe with a sparkle (golden wheat, red tomatoes, sunflowers in bloom…) when it is nearly full. Chickens = subagents, the dog = an Explore subagent</span>
      <b>Shade tree, scarecrows</b><span>idle agents nap under the tree; stale ones stand as scarecrows; the meadow is for agents outside any repo</span>
      <b>Silo</b><span>its grain is your plan's weekly limit used (the % under it; when it resets on hover); its lamp turns amber from 70% and blinks red from 90%</span>
      <b>Seasons</b><span>follow your plan's 5-hour limit: spring while it is fresh (blossom), then summer, autumn (falling leaves), and winter (snow) when it is nearly used up; a new window brings spring back</span>
      <b>Henhouse, pond</b><span>eggs in the nest = subagents that finished lately; a hen at the door and a +N sign = more subagents running than their farmers can lead</span>
      <b>Day and night</b><span>the sky follows your clock: at night the windows, the barn lamp and lanterns glow. The Sky switch holds it at day or night</span>
      <b>Click</b><span>a farmer to answer or message it in the sidebar; a field for the files agents touched there</span>
      <b>Zoom</b><span>− / + (or ⌘/Ctrl + scroll, or pinch) zooms the farm inside its frame; drag or scroll to move around; the % button shows the whole farm again</span>
    </div>`;
  }

  /* ---------- the engine: positions, walking, tags, pop-ups, diary, the loop ---------- */

  function makePixelView(th) {
    let host = null, canvas = null, ctx = null, ov = null, logEl = null, hudEl = null, bg = null, ro = null;
    let raf = 0, last = 0, T = 0, cs = 1, first = true, timer = 0, layoutKey = null, labelKey = '';
    let viewEl = null, drag = null, dragged = false, backing = 1; // the frame the farm is seen through; a drag that pans it
    let scene = { fields: [], farmers: [] }, overflow = {}, still = false, opts = {}, selectedId = null, got = false; // got: a scene has arrived
    // Zoom on top of "the whole farm in the frame", and speech bubbles (each can be closed until its farmer says something new).
    const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
    const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const keep = (key, value) => { try { localStorage.setItem(key, value); } catch { /* this page only */ } };
    let zoom = ZOOMS.includes(Number(stored('tracker-farm-zoom'))) ? Number(stored('tracker-farm-zoom')) : 1;
    let saysOn = stored('tracker-farm-bubbles') !== 'off';
    // The sky: live (your clock), or held at day or night.
    const SKIES = ['live', 'day', 'night'];
    let skyMode = SKIES.includes(stored('tracker-farm-sky')) ? stored('tracker-farm-sky') : 'live';
    let bgSeason = null;
    let follow = false; // keep the picked farmer in the middle of the view
    let restingShown = stored('tracker-farm-resting') !== 'hidden'; // idle and stale farmers on the farm, or not
    const resting = f => f.state === 'idle' || f.state === 'stale';
    let glide = null; // a zoom easing in: { from: scale, start, ox, oy }
    let pad = { x: 0, t: 0, b: 0 }; // the frame's spare room, in world pixels: more sky above, more meadow below and beside
    const extOf = () => ({ x0: -pad.x, x1: W + pad.x, y0: -pad.t, y1: th.layout().H + pad.b });
    const skyNow = () => skyAt(skyMode === 'day' ? new Date(2000, 0, 1, 12) : skyMode === 'night' ? new Date(2000, 0, 1, 23) : new Date());
    let wheel = 0;
    const says = new Map(); // farmer id → { el, text }
    const closedSays = new Map(); // farmer id → the text that was closed
    const bots = new Map(), log = [];
    const parts = []; // particles on the farm now
    const addPart = p => { if (parts.length < 400) parts.push(p); };

    function targets() {
      const out = new Map(), count = {}, used = new Map(), over = { desk: 0, turn: 0, storage: 0, charge: 0, meadow: 0 };
      for (const f of scene.farmers) {
        if (!restingShown && resting(f)) continue;
        const s = th.slots(f);
        let at;
        if (s.group.startsWith('st:')) {
          if (!used.has(s.group)) used.set(s.group, []);
          at = s.at(used.get(s.group));
        } else {
          const i = count[s.group] ?? 0;
          count[s.group] = i + 1;
          if (i >= s.cap) { over[s.group] += 1; continue; }
          at = s.at(i);
        }
        out.set(f.id, { x: at[0], y: at[1], zone: s.zone });
      }
      overflow = over;
      return out;
    }
    // Walk along the corridors between field columns, so farmers never cross a field.
    function plan(b, tx, ty) {
      if (Math.abs(b.y - ty) < 0.5) return [[tx, ty]];
      const c = CORR.reduce((best, x) => (Math.abs(b.x - x) + Math.abs(tx - x) < Math.abs(b.x - best) + Math.abs(tx - best) ? x : best));
      return [[c, b.y], [c, ty], [tx, ty]];
    }
    function pop(x, y, text, cls = '') {
      if (!ov || still) return;
      const el = document.createElement('div');
      el.className = `px-pop ${cls}`;
      el.innerHTML = pxt(text, cls === 'good' ? '#c6e89a' : cls === 'warn' ? '#ffffff' : cls === 'dim' ? '#e6eef5' : '#ffd43b', '#4e3626');
      if (cls === 'coin' || cls === 'good') for (let i = 0; i < (cls === 'good' ? 14 : 7); i++) addPart({ x, y: y + 8, vx: rand(-30, 30), vy: rand(-40, -15), g: 60, life: 0.7, max: 0.7, size: rand(1, 2), color: i % 3 ? '#ffd43b' : '#ffffff' }); // a little burst
      el.style.left = `${Math.round(x * cs)}px`;
      el.style.top = `${Math.round(y * cs)}px`;
      ov.appendChild(el);
      setTimeout(() => el.remove(), 1700);
    }
    function renderHud() { if (hudEl) hudEl.innerHTML = th.hud(still, zoom, saysOn, skyMode, follow, Boolean(selectedId && bots.has(selectedId)), restingShown ? null : scene.farmers.filter(resting).length); }
    /**
     * Zoom changes the farm inside the frame, never the frame. The farm point under `at` (a point of
     * the frame: its middle, or the pointer) stays where it is.
     */
    function setZoom(step, at, to) {
      const next = to ?? (step === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + step))]);
      const stage = canvas?.parentElement, was = cs;
      const ax = at?.[0] ?? (viewEl?.clientWidth ?? 0) / 2, ay = at?.[1] ?? (viewEl?.clientHeight ?? 0) / 2;
      const wx = viewEl ? (viewEl.scrollLeft + ax - stage.offsetLeft) / cs : 0, wy = viewEl ? (viewEl.scrollTop + ay - stage.offsetTop) / cs : 0;
      zoom = next;
      keep('tracker-farm-zoom', String(zoom));
      resize();
      renderHud();
      if (!viewEl) return;
      viewEl.scrollLeft = step === 0 && to == null ? 0 : wx * cs + stage.offsetLeft - ax;
      viewEl.scrollTop = step === 0 && to == null ? 0 : wy * cs + stage.offsetTop - ay;
      if (!still && was !== cs) { glide = { from: was / cs, start: performance.now(), ox: wx * cs, oy: wy * cs }; applyGlide(glide.start); }
    }
    /**
     * The zoom glide, driven by the frame loop (so it always ends): the farm starts at its old size
     * around the point that stays put and eases to the new one in 0.2 s.
     */
    function applyGlide(now) {
      if (!glide || !canvas) return;
      const stage = canvas.parentElement, t = Math.min(1, (now - glide.start) / 200);
      if (t >= 1) { stage.style.transform = ''; glide = null; return; }
      const e = 1 - (1 - t) ** 3;
      stage.style.transformOrigin = `${glide.ox}px ${glide.oy}px`;
      stage.style.transform = `scale(${glide.from + (1 - glide.from) * e})`;
    }
    /** Follow: ease the view toward the picked farmer (all at once when the farm stands still). */
    function followTick(dt) {
      const b = follow && selectedId ? bots.get(selectedId) : null;
      if (!b || !viewEl || drag?.moving) return;
      const stage = canvas.parentElement;
      const tx = (b.x + pad.x) * cs + stage.offsetLeft - viewEl.clientWidth / 2, ty = (b.y - 14 + pad.t) * cs + stage.offsetTop - viewEl.clientHeight / 2;
      const ease = (cur, t) => { const d = t - cur, stepBy = dt ? d * Math.min(1, dt * 3.5) : d; return cur + (Math.abs(stepBy) < 1 ? Math.sign(d) * Math.min(1, Math.abs(d)) : stepBy); };
      viewEl.scrollLeft = ease(viewEl.scrollLeft, tx);
      viewEl.scrollTop = ease(viewEl.scrollTop, ty);
    }
    function setFollow(on) {
      follow = on && Boolean(selectedId && bots.has(selectedId));
      if (follow && zoom < 2) {
        const b = bots.get(selectedId), stage = canvas.parentElement;
        setZoom(0, [(b.x + pad.x) * cs + stage.offsetLeft - viewEl.scrollLeft, (b.y + pad.t) * cs + stage.offsetTop - viewEl.scrollTop], 2);
      }
      renderHud();
      if (follow && still) followTick(0);
    }
    function onWheel(e) { // ⌘/Ctrl + scroll (or a trackpad pinch) zooms around the pointer; plain scrolling moves around
      if (!e.ctrlKey && !e.metaKey) { if (follow) { follow = false; renderHud(); } return; } // you took the view back
      e.preventDefault();
      wheel += e.deltaY;
      if (Math.abs(wheel) < 40) return;
      const r = viewEl.getBoundingClientRect();
      setZoom(wheel < 0 ? 1 : -1, [e.clientX - r.left, e.clientY - r.top]);
      wheel = 0;
    }
    // Dragging the farm moves around it when it is bigger than the frame; a drag is never a click.
    function onPointerDown(e) {
      if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest?.('input, textarea, select')) return;
      dragged = false;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: viewEl.scrollLeft, top: viewEl.scrollTop, moving: false };
    }
    function onPointerMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moving) {
        if (Math.hypot(dx, dy) < 5 || (viewEl.scrollWidth <= viewEl.clientWidth && viewEl.scrollHeight <= viewEl.clientHeight)) return;
        drag.moving = true;
        if (follow) { follow = false; renderHud(); } // you took the view back
        viewEl.setPointerCapture?.(e.pointerId);
        viewEl.classList.add('panning');
      }
      viewEl.scrollLeft = drag.left - dx;
      viewEl.scrollTop = drag.top - dy;
    }
    function onPointerUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moving) {
        dragged = true; // the click that follows this release is not a pick
        setTimeout(() => { dragged = false; }, 0);
        viewEl.classList.remove('panning');
      }
      drag = null;
    }
    // A hidden bubble stays hidden (as a 💬 to show it again) while its farmer is in the same situation:
    // still waiting, or no new question or reply. (A waiting farmer's text can change without it saying anything new.)
    const sayKey = f => (f.state === 'waiting' ? 'waiting' : f.question ? `q:${f.question}` : `said:${f.said}`);
    /** A farmer's speech bubble: its question when waiting or asking, else what it last said. Hidden, a 💬. */
    function placeBubble(f, b) {
      const text = saysOn && ACTIVE.has(f.state) ? (f.state === 'waiting' ? f.ask : f.question || f.said) : '';
      let s = says.get(f.id);
      const min = closedSays.get(f.id) === sayKey(f);
      if (s && (!text || s.min !== min)) { s.el.remove(); says.delete(f.id); s = null; }
      if (!text) return;
      if (!s) {
        const el = document.createElement('div');
        el.dataset.say = f.id;
        el.innerHTML = min
          ? `<button type="button" data-say-open aria-label="Show ${esc(f.name)}'s bubble">💬</button>`
          : `<span></span><button type="button" class="x" data-say-close aria-label="Hide this bubble" title="Hide (a 💬 stays to show it again)">×</button>`;
        ov.appendChild(el);
        s = { el, text: null, min, w: null };
        says.set(f.id, s);
      }
      if (min) {
        const cls = `px-say-min st-${f.state}`;
        if (s.el.className !== cls) { s.el.className = cls; s.el.title = `${f.name} ${f.state === 'waiting' ? 'is waiting for you' : 'said something'}: click the 💬 to show it`; }
      } else if (s.text !== text) {
        s.el.querySelector('span').textContent = text;
        s.el.className = `px-say st-${f.state}${f.question ? ' q' : ''}`;
        s.el.title = `${f.name}: ${text} (click to open it in the sidebar)`;
        s.text = text;
        s.w = null; // measured again
      }
      s.x = Math.round(b.x * cs);
      s.bottom = Math.round((b.y - th.SH * SC - 3 - b.lift) * cs) - 18; // just above its farmer's name tag
      s.seen = true;
    }
    /**
     * Keeps speech bubbles off each other and off name tags: from left to right, a bubble that
     * would land on one already placed is lifted above it, with a line down to its farmer.
     */
    function layoutBubbles() {
      const placed = [];
      for (const b of bots.values()) {
        if (!b.tag || b.tag.classList.contains('st-idle') || b.tag.classList.contains('st-stale')) continue;
        if (b.tagW == null) { b.tagW = b.tag.offsetWidth; b.tagH = b.tag.offsetHeight; }
        const x = Math.round(b.x * cs), bottom = Math.round((b.y - th.SH * SC - 3 - b.lift) * cs);
        placed.push({ left: x - b.tagW / 2, right: x + b.tagW / 2, top: bottom - b.tagH, bottom });
      }
      const list = [...says.values()].filter(s => s.seen);
      for (const s of list) if (s.w == null) { s.w = s.el.offsetWidth; s.h = s.el.offsetHeight; }
      list.sort((p, q) => p.x - q.x || q.bottom - p.bottom);
      list.forEach((s, i) => {
        const left = s.x - s.w / 2;
        let bottom = s.bottom;
        for (let guard = 0; guard < 30; guard++) {
          const hit = placed.find(r => left < r.right + 3 && left + s.w > r.left - 3 && bottom - s.h < r.bottom + 3 && bottom > r.top - 3);
          if (!hit) break;
          bottom = hit.top - 6;
        }
        placed.push({ left, right: left + s.w, top: bottom - s.h, bottom });
        s.el.style.setProperty('--lead', `${s.bottom - bottom}px`);
        s.el.style.zIndex = String(40 - Math.min(i, 30) + (s.bottom - bottom > 0 ? 0 : 10)); // lifted ones sit behind
        s.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(bottom - s.h)}px)`;
      });
    }
    function addLog(f, text) {
      log.unshift({ at: Date.now(), state: f.state, html: `<b>${esc(f.name)}</b> ${esc(text)}` });
      log.length = Math.min(log.length, 8);
      renderLog();
    }
    function renderLog() {
      if (!logEl) return;
      logEl.innerHTML = log.map(l => `<li class="st-${l.state}"><i></i><span>${l.html}</span><time>${ago(l.at)}</time></li>`).join('') || '<li class="faint">Quiet so far.</li>';
    }
    function sync(snapTo) {
      const tg = targets();
      if (first && tg.size) log.unshift({ at: Date.now(), state: 'working', html: th.startText(tg.size) });
      for (const [id, t] of tg) {
        const f = scene.farmers.find(x => x.id === id);
        let b = bots.get(id);
        if (!b) {
          const [sx, sy] = first ? [t.x, t.y] : th.spawn();
          b = { id, x: sx, y: sy, path: [], tx: NaN, ty: NaN, zone: first ? t.zone : '', kids: [], dir: 0, walk: false, tag: null, tagText: '', lift: 0 };
          bots.set(id, b);
          if (!first) addLog(f, th.arriveText);
        }
        if (t.x !== b.tx || t.y !== b.ty) { b.tx = t.x; b.ty = t.y; b.path = plan(b, t.x, t.y); }
        if (snapTo) { b.x = b.tx; b.y = b.ty; b.path = []; }
        if (t.zone !== b.zone) {
          addLog(f, th.zoneText(f, t.zone));
          th.onMove(f, t.zone, b.zone, (txt, cls) => pop(t.x, t.y - th.SH * SC - 14, txt, cls));
          b.zone = t.zone;
          renderHud();
        }
      }
      for (const [id, b] of bots) if (!tg.has(id)) { b.tag?.remove(); bots.delete(id); }
      if (first && tg.size) { // farmers already out when the page opens stand in place; later ones walk out of the barn
        renderLog();
        first = false;
      }
    }
    function step(dt, f, b) {
      if (b.path.length) {
        const [qx, qy] = b.path[0], dx = qx - b.x, dy = qy - b.y, d = Math.hypot(dx, dy), sp = 40 * dt;
        b.dir = Math.abs(dx) > 0.1 ? Math.sign(dx) : 0;
        if (d > 0.1) b.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy < 0 ? 'up' : 'down';
        if (d <= sp) { b.x = qx; b.y = qy; b.path.shift(); } else { b.x += (dx / d) * sp; b.y += (dy / d) * sp; }
        b.walk = b.path.length > 0 || d > sp;
      } else { b.walk = false; b.dir = 0; b.face = 'down'; }
      while (b.kids.length < f.kids.length) b.kids.push({ x: b.x, y: b.y });
      b.kids.length = f.kids.length;
      b.kids.forEach((d, k) => {
        const [tx, ty] = th.follow(b, k, T, f.kids[k]);
        const e = dt ? Math.min(1, dt * 4) : 1;
        d.x += (tx - d.x) * e;
        d.y += (ty - d.y) * e;
      });
    }
    function draw() {
      if (!ctx) return;
      PXG.ctx = ctx;
      PXG.T = T;
      PXG.k = backing;
      if (th.season() !== bgSeason) bg = buildBg(); // the season turned: new grass and trees
      PXG.ext = extOf();
      const sky = skyNow();
      PXG.lights = [...th.lights()];
      for (const f of scene.farmers) if (f.state === 'waiting' || f.state === 'turn') { const b = bots.get(f.id); if (b) PXG.lights.push([b.x, b.y - 14, 18, null]); } // lit at night: they need you
      drawSky(sky, T, th.hot());
      ctx.drawImage(bg, -pad.x, 0);
      th.ground();
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) th.shadows(b); }
      const items = th.items();
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) items.push([b.y, () => th.drawChar(f, b)]); }
      items.sort((p, q) => p[0] - q[0]).forEach(it => it[1]());
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) th.drawFx(f, b); }
      if (!still) drawParticles(parts);
      th.top();
      drawNight(sky, th.layout().H, PXG.lights);
      const picked = selectedId && bots.get(selectedId);
      if (picked) { // the farmer shown in the sidebar: a ring at its feet
        PXG.ctx.globalAlpha = 0.85;
        px(Math.round(picked.x) - 10, Math.round(picked.y) + 1, 20, 2, '#ffd43b');
        px(Math.round(picked.x) - 12, Math.round(picked.y) - 1, 2, 2, '#ffd43b');
        px(Math.round(picked.x) + 10, Math.round(picked.y) - 1, 2, 2, '#ffd43b');
        PXG.ctx.globalAlpha = 1;
      }
      // Name tags, lifted when two would overlap.
      const placed = [];
      for (const f of scene.farmers) {
        const b = bots.get(f.id);
        if (!b) continue;
        let lift = 0;
        while (placed.some(q => Math.abs(q.y - b.y) < 4 && Math.abs(q.x - b.x) < 40 && q.lift === lift)) lift += 11;
        placed.push({ x: b.x, y: b.y, lift: (b.lift = lift) });
        if (!b.tag) {
          b.tag = document.createElement('button');
          b.tag.type = 'button';
          b.tag.dataset.farmer = f.id;
          ov.appendChild(b.tag);
        }
        const text = th.tag(f), tip = th.tip(f), sel = f.id === selectedId;
        if (b.tagText !== f.state + text + tip + sel) {
          b.tag.className = `px-tag st-${f.state}${sel ? ' sel' : ''}`;
          b.tag.innerHTML = f.state === 'turn' ? pxt(text, '#1b1420', null) : pxt(text, '#ffffff');
          b.tagW = null;
          b.tag.title = tip;
          b.tagText = f.state + text + tip + sel;
        }
        b.tag.style.transform = `translate(${Math.round(b.x * cs)}px, ${Math.round((b.y - th.SH * SC - 3 - b.lift) * cs)}px) translate(-50%, -100%)`;
        placeBubble(f, b);
      }
      for (const [id, s] of says) if (!bots.has(id)) { s.el.remove(); says.delete(id); }
      layoutBubbles();
      for (const s of says.values()) s.seen = false;
    }
    const visible = () => Boolean(host?.isConnected) && host.offsetParent !== null && !document.hidden;
    function frame(now) {
      raf = 0;
      if (!canvas || still || !visible()) return;
      raf = requestAnimationFrame(frame);
      applyGlide(now);
      if (now - last < 33) return; // ~30 fps is plenty for pixel art
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      T += dt;
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) { step(dt, f, b); th.emit?.(f, b, dt, addPart); } }
      th.ambient?.(dt, addPart);
      stepParticles(parts, dt);
      followTick(dt);
      draw();
    }
    function startLoop() { if (!raf && canvas && !still && visible()) { last = 0; raf = requestAnimationFrame(frame); } }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    function redrawStill() {
      sync(true);
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) step(0, f, b); }
      draw();
    }
    function layoutLabels() {
      const key = JSON.stringify([th.layout().key, scene.fields, overflow]);
      if (key === labelKey) return;
      labelKey = key;
      ov.querySelectorAll('.px-lab').forEach(n => n.remove());
      th.labels((x, y, html, cls = '', title = '') => ov.insertAdjacentHTML('afterbegin', `<div class="px-lab ${cls}" style="left:${Math.round(x * cs)}px;top:${Math.round(y * cs)}px"${title ? ` title="${esc(title)}"` : ''}>${html}</div>`), overflow);
    }
    function buildBg() {
      const { H } = th.layout();
      const c = document.createElement('canvas');
      c.width = W + 2 * pad.x;
      c.height = H + pad.b;
      const g = c.getContext('2d');
      g.translate(pad.x, 0);
      bgSeason = th.season();
      th.bg((x, y, w, h, col) => { g.fillStyle = ink(col); g.fillRect(x, y, w, h); }, bgSeason, extOf());
      return c;
    }
    function resize() {
      if (!canvas) return;
      const { H } = th.layout(), dpr = window.devicePixelRatio || 1;
      // 100% fits the whole farm in the frame (its outer size, so scrollbars coming and going don't
      // change it); zoom scales the farm inside. The backing store is a whole multiple of the art,
      // at most ~24M pixels, and image-rendering: pixelated keeps the pixels square when scaled.
      const fw = viewEl?.offsetWidth || W, fh = viewEl?.offsetHeight || 0;
      const fit = Math.max(0.5, Math.min(6, (fw - 2) / W, fh > 60 ? (fh - 2) / H : Infinity));
      // The frame's spare room is more farm, not empty frame: sky above and meadow below, or meadow beside.
      const spareW = Math.max(0, (fw - 2) / fit - W), spareH = fh > 60 ? Math.floor(Math.max(0, (fh - 2) / fit - H)) : 0;
      const was = `${pad.x},${pad.t},${pad.b}`;
      pad = { x: Math.floor(spareW / 2), t: Math.floor(spareH * 0.4), b: spareH - Math.floor(spareH * 0.4) };
      const EW = W + 2 * pad.x, EH = H + pad.t + pad.b;
      cs = Math.max(0.25, Math.min(18, fit * zoom));
      const k = Math.max(1, Math.min(Math.ceil(cs * dpr), Math.floor(Math.sqrt(24e6 / (EW * EH)))));
      backing = k;
      canvas.width = EW * k;
      canvas.height = EH * k;
      canvas.style.width = `${EW * cs}px`;
      canvas.style.height = `${EH * cs}px`;
      canvas.dataset.pad = `${pad.x},${pad.t}`; // where the farm sits in the canvas (for tests)
      ov.style.left = `${pad.x * cs}px`; // names and labels keep the farm's own coordinates
      ov.style.top = `${pad.t * cs}px`;
      if (was !== `${pad.x},${pad.t},${pad.b}`) bg = buildBg(); // the land grows with the frame
      ctx.setTransform(k, 0, 0, k, pad.x * k, pad.t * k);
      ctx.imageSmoothingEnabled = false;
      labelKey = '';
      layoutLabels();
      if (still) redrawStill(); else { sync(false); draw(); }
    }
    function apply(next) {
      got = true;
      host?.querySelector('.px-loading')?.remove();
      scene = next;
      th.setScene(next);
      const want = layoutFor(next.fields).key;
      if (want !== layoutKey) { // fields came or went: new ground; farmers walk to their new spots
        th.relayout(next.fields);
        layoutKey = want;
        if (canvas) { bg = buildBg(); resize(); }
      }
      if (!canvas) return;
      if (still) redrawStill(); else sync(false);
      layoutLabels();
      renderHud();
      startLoop();
    }
    function onClick(e) {
      if (dragged) { dragged = false; e.stopPropagation(); return; }
      const tag = e.target.closest?.('[data-farmer]');
      if (tag) { e.stopPropagation(); opts.onPickAgent?.(tag.dataset.farmer); return; }
      if (e.target.closest?.('[data-farm-more]')) { e.stopPropagation(); opts.onShowRepos?.(); return; }
      const sign = e.target.closest?.('[data-farm-field]');
      if (sign) { e.stopPropagation(); opts.onOpenField?.(sign.dataset.farmField); return; }
      if (e.target.closest?.('[data-farm-motion]')) { e.stopPropagation(); setStill(!still); return; }
      if (e.target.closest?.('[data-farm-follow]')) { e.stopPropagation(); setFollow(!follow); return; }
      if (e.target.closest?.('[data-farm-resting]')) {
        e.stopPropagation();
        restingShown = !restingShown;
        keep('tracker-farm-resting', restingShown ? 'shown' : 'hidden');
        if (still) redrawStill(); else { sync(false); draw(); }
        renderHud();
        return;
      }
      if (e.target.closest?.('[data-farm-sky]')) {
        e.stopPropagation();
        skyMode = SKIES[(SKIES.indexOf(skyMode) + 1) % SKIES.length];
        keep('tracker-farm-sky', skyMode);
        renderHud();
        draw();
        return;
      }
      const zoomBtn = e.target.closest?.('[data-farm-zoom]');
      if (zoomBtn) { e.stopPropagation(); setZoom(Number(zoomBtn.dataset.farmZoom)); return; }
      if (e.target.closest?.('[data-farm-bubbles]')) {
        e.stopPropagation();
        saysOn = !saysOn;
        if (saysOn) closedSays.clear(); // on again: every bubble, hidden ones too
        keep('tracker-farm-bubbles', saysOn ? 'on' : 'off');
        renderHud();
        draw();
        return;
      }
      const closeSay = e.target.closest?.('[data-say-close]');
      if (closeSay) {
        e.stopPropagation();
        const id = closeSay.closest('[data-say]').dataset.say;
        const f = scene.farmers.find(x => x.id === id);
        if (f) closedSays.set(id, sayKey(f));
        draw();
        return;
      }
      const openSay = e.target.closest?.('[data-say-open]');
      if (openSay) {
        e.stopPropagation();
        closedSays.delete(openSay.closest('[data-say]').dataset.say);
        draw();
        return;
      }
      const say = e.target.closest?.('[data-say]');
      if (say) { e.stopPropagation(); opts.onPickAgent?.(say.dataset.say, { from: 'say' }); return; }
      const help = host.querySelector('.px-help');
      if (e.target.closest?.('[data-farm-help]')) { e.stopPropagation(); help.showModal(); return; }
      if (e.target.closest?.('[data-farm-help-close]') || e.target === help) { e.stopPropagation(); help.close(); return; } // × or a click on the backdrop
      if (help?.contains(e.target)) return;
      if (e.target !== canvas) return;
      const r = canvas.getBoundingClientRect(), on = r.width / (W + 2 * pad.x) || cs, x = (e.clientX - r.left) / on - pad.x, y = (e.clientY - r.top) / on - pad.t; // the size on screen: right even while a zoom glides
      for (const [id, b] of bots) if (Math.abs(x - b.x) <= 7 * SC + 1 && y >= b.y - th.SH * SC - 1 && y <= b.y + 1) { opts.onPickAgent?.(id); return; }
      const key = th.fieldAt(x, y);
      if (key) opts.onOpenField?.(key);
    }
    function onVisibility() { if (document.hidden) stopLoop(); else startLoop(); }
    function setStill(next) {
      still = next;
      stopLoop();
      renderHud();
      if (still) redrawStill(); else startLoop();
      opts.onMotion?.(still);
    }
    return {
      mount(el, options) {
        this.unmount();
        opts = options ?? {};
        host = el;
        still = opts.still ?? false;
        // The diary goes where the page asks (its sidebar), else under the farm.
        const under = opts.diary ? '' : '<div class="px-under"><div><h4>Farm diary</h4><ol class="px-log"></ol></div></div>';
        host.innerHTML = `<div class="px"><div class="px-host"><div class="px-hud"></div><div class="px-view"><div class="px-stage"><canvas aria-label="Pixel farm: every farmer is an agent, every field a repo"></canvas><div class="px-ov"></div>${got ? '' : '<div class="px-loading"><span class="spinner"></span>Loading the farm…</div>'}</div></div></div>
          ${under}</div>
          <dialog class="px-help" aria-label="How to read the farm"><header><b>How to read the farm</b><button type="button" class="x" data-farm-help-close aria-label="Close">×</button></header>${helpHtml()}</dialog>`;
        canvas = host.querySelector('canvas');
        ctx = canvas.getContext('2d');
        viewEl = host.querySelector('.px-view');
        ov = host.querySelector('.px-ov');
        logEl = opts.diary ?? host.querySelector('.px-log');
        hudEl = host.querySelector('.px-hud');
        for (const b of bots.values()) { b.tag = null; b.tagText = ''; }
        layoutKey = null;
        labelKey = '';
        th.relayout(scene.fields);
        layoutKey = layoutFor(scene.fields).key;
        bg = buildBg();
        resize();
        ro = new ResizeObserver(() => resize());
        ro.observe(host);
        host.addEventListener('click', onClick);
        viewEl.addEventListener('wheel', onWheel, { passive: false });
        viewEl.addEventListener('pointerdown', onPointerDown);
        viewEl.addEventListener('pointermove', onPointerMove);
        viewEl.addEventListener('pointerup', onPointerUp);
        viewEl.addEventListener('pointercancel', onPointerUp);
        document.addEventListener('visibilitychange', onVisibility);
        renderLog();
        renderHud();
        timer = setInterval(() => { if (!document.hidden) { renderLog(); renderHud(); } }, 1000);
        startLoop();
      },
      update(next) { apply(next); },
      select(id) {
        selectedId = id;
        if (!id && follow) follow = false;
        renderHud();
        if (follow && still) followTick(0);
        if (canvas && still) draw();
      },
      unmount() {
        stopLoop();
        ro?.disconnect();
        ro = null;
        clearInterval(timer);
        host?.removeEventListener('click', onClick);
        document.removeEventListener('visibilitychange', onVisibility);
        if (host) host.innerHTML = '';
        for (const b of bots.values()) { b.tag = null; b.tagText = ''; }
        says.clear();
        host = canvas = ctx = ov = logEl = hudEl = viewEl = null;
        drag = null;
      },
      resume: () => { if (still) redrawStill(); else startLoop(); },
      isStill: () => still,
      farmerName: id => scene.farmers.find(f => f.id === id)?.name,
      farmerColor: id => { const f = scene.farmers.find(x => x.id === id); return f ? SHIRT[f.color] : '#9aa0a6'; },
      field: key => scene.fields.find(f => f.key === key),
    };
  }

  /* ---------- the field close-up: the files agents touched in one repo ---------- */
  // Row = top-level folder, plant = a file. Watered soil + glow = written (glow fades over 30 min);
  // white flag = read only; trampled + orange ring = written by two agents; noticeboard = a document
  // (click to read it); hay tuft = uncommitted; ribbons = which farmers.

  function makeField(view) {
    const FW = 360, ROW = 50, HEAD = 40, X1 = 104, STEP = 31, BASE = 34, PER_ROW = 8;
    let back = null, canvas = null, ctx = null, timer = 0, key = null, sel = null, T = 0, data = null, error = '', fetchedAt = 0, loading = false;
    let opts = {};
    const p = (a, b, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(a, b, w, h); };
    const writers = f => f.agents.filter(a => a.wrote).length;
    const kind = f => (f.doc ? 'doc' : f.wrote && writers(f) > 1 ? 'shared' : f.wrote ? 'write' : 'read');
    const label = f => ({ write: 'written', read: 'read only', shared: 'written by two or more farmers', doc: 'document' })[kind(f)];
    const GIT_WORD = { M: 'modified', U: 'new, not committed', A: 'added', D: 'deleted', R: 'renamed' };
    const dirOf = path => (path.includes('/') ? `${path.split('/')[0]}/` : './');
    function groups() {
      const m = new Map();
      for (const f of data?.files ?? []) {
        const dir = dirOf(f.path);
        if (!m.has(dir)) m.set(dir, []);
        m.get(dir).push(f);
      }
      return [...m].sort((a, b) => (a[0] === './' ? 1 : b[0] === './' ? -1 : a[0].localeCompare(b[0])));
    }
    const nameIn = (dir, path) => (dir === './' ? path : path.slice(dir.length));
    function drawPlant(f, x, y) {
      const k = kind(f);
      if (k === 'write') {
        p(x - 11, y - 2, 22, 5, '#3e2614'); p(x - 9, y - 1, 6, 1, '#5ab4ff');
        const g = Math.max(0, 1 - (Date.now() - f.at) / 1_800_000);
        if (g > 0) { ctx.globalAlpha = g * (0.25 + 0.15 * Math.sin(T * 4)); p(x - 11, y - 26, 22, 24, '#fff3a0'); ctx.globalAlpha = 1; }
        p(x, y - 18, 2, 18, '#3f9b3a'); p(x - 7, y - 13, 7, 3, '#6cc04a'); p(x + 2, y - 10, 7, 3, '#6cc04a'); p(x - 5, y - 19, 5, 3, '#6cc04a'); p(x - 1, y - 22, 4, 4, '#8fd16a');
      } else if (k === 'read') {
        p(x, y - 8, 2, 8, '#3f9b3a'); p(x - 4, y - 7, 4, 2, '#6cc04a'); p(x + 2, y - 5, 4, 2, '#6cc04a');
        p(x + 7, y - 20, 1, 20, '#e8e8e8'); p(x + 8, y - 20, 7, 5, '#ffffff'); p(x + 8, y - 16, 7, 1, '#d0d0d0');
      } else if (k === 'shared') {
        p(x - 10, y - 4, 20, 3, '#7f9b3a'); p(x - 7, y - 7, 6, 3, '#6c8a34'); p(x + 3, y - 6, 5, 2, '#6c8a34'); p(x - 2, y - 2, 4, 2, '#5e3d22');
        if (Math.floor(T * 3) % 3) { ctx.strokeStyle = '#ff8c42'; ctx.lineWidth = 1.5; ctx.strokeRect(x - 13, y - 26, 26, 30); }
      } else {
        p(x - 9, y - 14, 2, 14, '#6b4320'); p(x + 7, y - 14, 2, 14, '#6b4320');
        p(x - 12, y - 26, 24, 14, '#a8703c'); p(x - 10, y - 24, 20, 10, '#fff4d6');
        for (let i = 0; i < 4; i++) p(x - 8, y - 22 + i * 2, i === 3 ? 9 : 16, 1, '#c9b48a');
      }
      if (f.git) { p(x + 9, y - 4, 5, 4, '#e2c26b'); p(x + 10, y - 5, 3, 1, '#f1d98a'); } // hay tuft: not committed yet
      f.agents.slice(0, 4).forEach((a, j) => p(x - 7 + j * 6, y + 4, 5, 3, view.farmerColor(a.id)));
      if (sel === f.path) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.strokeRect(x - 15, y - 29, 30, 39); ctx.setLineDash([]); }
    }
    function drawMore(x, y) { // a little signpost: "+N more" is written on it in HTML
      p(x - 1, y - 16, 2, 16, '#6b4320'); p(x - 10, y - 22, 20, 9, '#a8703c'); p(x - 9, y - 21, 18, 7, '#fff4d6');
    }
    function draw() {
      if (!canvas) return;
      const g = groups(), H = HEAD + Math.max(1, g.length) * ROW + 8, field = view.field(key) ?? {};
      for (let y = 0; y < H; y += 4) for (let x = 0; x < FW; x += 4) p(x, y, 4, 4, (x * 7 + y * 13) % 11 === 0 ? '#5d9b46' : ((x + y) / 4) % 2 ? '#6aa84f' : '#66a34b');
      p(0, 0, FW, HEAD - 6, '#7fb45a'); p(0, HEAD - 6, FW, 2, '#8b5a2b');
      for (let i = 0; i < Math.min(4, Math.ceil((field.dirty ?? 0) / 3)); i++) { const x = 196 + i * 11; p(x, 22, 10, 8, '#e2c26b'); p(x + 3, 22, 1, 8, '#c9a24a'); p(x + 7, 22, 1, 8, '#c9a24a'); }
      for (let i = 0; i < Math.min(4, Math.ceil((field.ahead ?? 0) / 4)); i++) { const x = 246 + (i % 2) * 9, y = 22 - Math.floor(i / 2) * 7; p(x, y, 8, 7, '#8b5a2b'); p(x, y, 8, 1, '#b07a46'); p(x + 3, y, 1, 7, '#6b4320'); }
      if (field.behind > 0) { p(282, 18, 2, 14, '#6b4320'); p(277, 13, 11, 6, '#5f6b7a'); p(288, 8, 1, 7, '#e63946'); p(288, 8, 4, 2, '#e63946'); }
      if (field.weather === 'rain') { p(306, 6, 30, 7, '#8c96a0'); p(311, 3, 14, 4, '#9aa4ad'); for (let i = 0; i < 6; i++) p(308 + i * 5, 15 + Math.floor((T * 30 + i * 7) % 14), 1, 2, '#5ab4ff'); }
      if (field.weather === 'rainbow') ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7'].forEach((c, j) => { for (let a = 196; a <= 344; a += 6) { const t = a * Math.PI / 180, rr = 16 - j * 2; p(Math.round(322 + Math.cos(t) * rr), Math.round(30 + Math.sin(t) * rr * 0.9), 2, 2, c); } });
      if (field.weather === 'windmill') { p(318, 12, 6, 20, '#e8d8b0'); p(317, 10, 8, 2, '#8a3b2e'); for (let i = 0; i < 4; i++) { const t = T * 3 + i * Math.PI / 2; for (let k = 2; k <= 10; k++) p(Math.round(321 + Math.cos(t) * k), Math.round(13 + Math.sin(t) * k), 1, 1, '#ffffff'); } }
      g.forEach(([, list], r) => {
        const y0 = HEAD + r * ROW;
        p(X1 - 18, y0 + 4, FW - X1 + 12, BASE + 2, '#7a5230'); p(X1 - 18, y0 + 4, FW - X1 + 12, 1, '#5e3d22');
        for (let i = 0; i < 3; i++) p(X1 - 16, y0 + 10 + i * 9, FW - X1 + 8, 1, '#5e3d22');
        const shown = list.length > PER_ROW ? list.slice(0, PER_ROW - 1) : list;
        shown.forEach((f, i) => drawPlant(f, X1 + i * STEP, y0 + BASE));
        if (list.length > PER_ROW) drawMore(X1 + shown.length * STEP, y0 + BASE);
      });
      if (!g.length) p(X1 - 18, HEAD + 4, FW - X1 + 12, ROW - 6, '#7a5230');
    }
    function layout() {
      if (!canvas) return;
      const g = groups(), H = HEAD + Math.max(1, g.length) * ROW + 8, scene = canvas.parentElement, dpr = window.devicePixelRatio || 1;
      const cs = Math.max(0.8, Math.min(3, ((scene.clientWidth || FW) - 16) / FW)), k = Math.ceil(cs * dpr);
      canvas.width = FW * k; canvas.height = H * k; canvas.style.width = `${FW * cs}px`; canvas.style.height = `${H * cs}px`;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const ov = scene.querySelector('.fv-ov'), field = view.field(key) ?? { name: key };
      const branch = data?.branch ?? field.branch;
      ov.innerHTML = `<div class="fv-sign" style="left:${8 * cs}px;top:${6 * cs}px">${esc(clip(field.name ?? '', 22))}${branch ? ` <span>${esc(clip(branch, 18))}</span>` : ''}</div>`;
      g.forEach(([dir, list], i) => {
        const y0 = HEAD + i * ROW;
        ov.insertAdjacentHTML('beforeend', `<div class="fv-dir" style="left:${6 * cs}px;top:${(y0 + ROW / 2 - 2) * cs}px">${esc(dir)}</div>`);
        const shown = list.length > PER_ROW ? list.slice(0, PER_ROW - 1) : list;
        shown.forEach((f, j) => ov.insertAdjacentHTML('beforeend', `<button type="button" class="fv-hit" data-fv-file="${esc(f.path)}" title="${esc(f.path)} · ${esc(label(f))} · ${ago(f.at)} ago" style="left:${(X1 + j * STEP - 15) * cs}px;top:${(y0 + 2) * cs}px;width:${30 * cs}px;height:${(ROW - 2) * cs}px"><span class="fv-pl" style="top:${(BASE + 7) * cs}px">${esc(nameIn(dir, f.path).split('/').pop())}</span></button>`));
        if (list.length > PER_ROW) ov.insertAdjacentHTML('beforeend', `<div class="fv-more" style="left:${(X1 + shown.length * STEP - 15) * cs}px;top:${(y0 + BASE - 22) * cs}px;width:${30 * cs}px">+${list.length - shown.length}</div>`);
      });
      const empty = loading && !data ? 'Loading the field…' : error ? error : !g.length ? 'Fallow: no agent read or wrote files here in the last 24 hours' : '';
      if (empty) ov.insertAdjacentHTML('beforeend', `<div class="fv-dir fv-empty" style="left:${(X1 - 10) * cs}px;top:${(HEAD + 22) * cs}px">${esc(empty)}</div>`);
      draw();
    }
    function sideList() {
      const field = view.field(key) ?? {};
      const ld = field.lastDeploy; // the newer of the Actions run and a deploy an agent ran itself
      const piles = [
        field.dirty ? `<span class="pile"><b class="i-bale"></b>${field.dirty} uncommitted</span>` : '',
        field.ahead ? `<span class="pile"><b class="i-crate"></b>${field.ahead} unpushed</span>` : '',
        field.behind ? `<span class="pile"><b class="i-mail"></b>${field.behind} behind</span>` : '',
        ld ? (() => {
          const href = typeof ld.url === 'string' && ld.url.startsWith('https://github.com/') ? ld.url : null;
          const cls = `pile ${ld.state === 'failed' ? 'bad' : ''}`, text = `${esc(ld.label)}${href ? ' ↗' : ''}`;
          return href ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(ld.detail)}">${text}</a>` : `<span class="${cls}" title="${esc(ld.detail)}">${text}</span>`;
        })() : '',
        ld && ld.state !== 'ok' && ld.detail ? `<div class="fv-why">${esc(ld.detail)}</div>` : '',
      ].join('');
      const who = f => f.agents.map(a => `<i style="background:${view.farmerColor(a.id)}" title="${esc(view.farmerName(a.id) ?? a.id)}"></i>`).join('');
      const rows = groups().map(([dir, list]) => `<li class="fv-d">${esc(dir)}</li>` + list.map(f => `<li><button type="button" class="fv-f ${sel === f.path ? 'on' : ''}" data-fv-file="${esc(f.path)}"><span class="k k-${kind(f)}"></span><span class="ell">${esc(nameIn(dir, f.path))}</span><span class="who">${who(f)}</span><time>${ago(f.at)}</time></button></li>`).join('')).join('');
      const f = data?.files.find(x => x.path === sel);
      const names = f ? f.agents.map(a => esc(view.farmerName(a.id) ?? a.id)).join(' and ') : '';
      const detail = f ? `<div class="fv-detail"><b>${esc(f.path)}</b>
        <div class="muted">${esc(label(f))} · by ${names} · ${ago(f.at)} ago · git: ${f.git ? esc(GIT_WORD[f.git] ?? f.git) : 'committed'}</div>
        ${f.doc ? '<div><button type="button" class="act" data-fv-read>Open in the reader</button></div>' : ''}${kind(f) === 'shared' ? '<div class="warnline">Two or more farmers wrote this file: this is where a collision would bite.</div>' : ''}</div>` : '';
      const status = loading && !data ? '<li class="muted">Loading…</li>' : error ? `<li class="muted">${esc(error)}</li>` : '<li class="muted">Nothing touched in the last 24 hours.</li>';
      back.querySelector('.fv-tree').innerHTML = `<div class="piles">${piles}</div><ul class="fv-list">${rows || status}</ul>${detail}
        <p class="faint fv-note">Only files agents read or wrote in the last 24 h are shown, not the whole folder.${data?.truncated ? ' Showing the newest 300.' : ''}</p>`;
    }
    async function load() {
      if (!key) return;
      const asked = key;
      loading = true;
      fetchedAt = Date.now();
      try {
        const r = await fetch(`/api/repo/touched?path=${encodeURIComponent(asked)}`, { headers: { 'x-tracker-token': opts.token } });
        const body = await r.json();
        if (asked !== key) return;
        if (r.ok) { data = body; error = ''; } else error = body.error ?? `Could not load the field (HTTP ${r.status}).`;
      } catch (err) {
        if (asked === key) error = `Could not load the field: ${err?.message ?? err}`;
      } finally {
        if (asked === key) loading = false;
      }
      if (back && asked === key) { sideList(); layout(); }
    }
    function openDoc(path) {
      const f = data?.files.find(x => x.path === path);
      if (!f || !f.agents.length || !data) return;
      const repo = data.repo;
      close();
      opts.onOpenDoc?.(f.agents[0].id, `${repo}/${f.path}`);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
      clearInterval(timer);
      timer = 0;
      document.removeEventListener('keydown', onKey);
      back?.remove();
      back = canvas = ctx = null;
      key = null;
    }
    return {
      setOptions(o) { opts = o ?? {}; },
      open(k) {
        close();
        key = k; sel = null; data = null; error = '';
        const field = view.field(k) ?? { name: k };
        back = document.createElement('div');
        back.className = 'fv-back';
        back.innerHTML = `<div class="fv" role="dialog" aria-label="Field close-up"><header><b>${esc(field.name)} field</b><span class="muted">the files agents read or wrote here</span><span class="grow"></span><button type="button" class="x" data-fv-close aria-label="Close">×</button></header>
          <div class="fv-body"><div class="fv-scene"><canvas></canvas><div class="fv-ov"></div></div><div class="fv-tree"></div></div>
          <div class="fv-legend"><span><b class="k k-write"></b>watered = written (glows while recent)</span><span><b class="k k-read"></b>white flag = read only</span><span><b class="k k-shared"></b>trampled = written by two farmers</span><span><b class="k k-doc"></b>noticeboard = document (click to read)</span><span><b class="k k-hay"></b>hay = not committed</span><span>ribbons = which farmer</span></div></div>`;
        document.body.appendChild(back);
        canvas = back.querySelector('canvas');
        ctx = canvas.getContext('2d');
        back.addEventListener('click', e => {
          e.stopPropagation();
          if (e.target === back || e.target.closest('[data-fv-close]')) { close(); return; }
          if (e.target.closest('[data-fv-read]')) { openDoc(sel); return; }
          const hit = e.target.closest('[data-fv-file]');
          if (!hit) return;
          const f = data?.files.find(x => x.path === hit.dataset.fvFile);
          if (f?.doc && hit.classList.contains('fv-hit')) { openDoc(f.path); return; } // a noticeboard opens the document
          sel = hit.dataset.fvFile;
          sideList();
          draw();
        });
        document.addEventListener('keydown', onKey);
        sideList();
        layout();
        void load();
        timer = setInterval(() => { if (!view.isStill() && !document.hidden) { T += 0.12; draw(); } }, 120);
      },
      // A new snapshot: refresh the open close-up, at most every 5 s.
      refresh() { if (back && !loading && Date.now() - fetchedAt >= 5000) void load(); },
      close,
      isOpen: () => Boolean(back),
    };
  }

  /* ---------- public API ---------- */

  let theme = null, view = null, field = null, lastSnap = null, mounted = false;
  function ensure() {
    if (view) return;
    theme = makeFarm();
    view = makePixelView(theme);
    field = makeField(view);
  }
  window.TrackerFarm = {
    /** Builds the farm inside hostEl. options: { token, onPickAgent(id, { from: 'say' }?), onOpenDoc(agentId, path), onShowRepos(), still } */
    mount(hostEl, options = {}) {
      ensure();
      const still = options.still ?? Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      field.setOptions(options);
      view.mount(hostEl, { ...options, still, onOpenField: key => field.open(key) });
      mounted = true;
      if (lastSnap) view.update(toScene(lastSnap));
    },
    /** Every snapshot: updates the scene; never rebuilds the page around it. */
    update(snap) {
      lastSnap = snap;
      if (!mounted) return;
      view.update(toScene(snap));
      field.refresh();
    },
    /** Marks the farmer shown in the page's sidebar (null for none). */
    select(id) {
      ensure();
      view.select(id ?? null);
    },
    /** A farmer's shirt colour, so the page can match it. */
    colorOf: id => SHIRT[colorIndex(id)],
    actionOf, paint, growthStage, STAGES, skyAt, PALETTE, ink, spriteRows, walkFrame, stepParticles, seasonOf, siloOf, glyphOf, textWidth,
    unmount() {
      if (!view) return;
      field.close();
      view.unmount();
      mounted = false;
    },
    toScene, fieldOf, weatherOf, contextPct, askText, helpHtml,
  };
})();
