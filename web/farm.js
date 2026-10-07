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

  /** Share of the context window used: the list view's rule (1M window once past 200k). */
  function contextPct(tokens) {
    if (!tokens) return 0;
    return Math.min(1, tokens / (tokens > 200_000 ? 1_000_000 : 200_000));
  }

  /** Weather over a field, from its last deploy (same rules as the list view's deploy chip). */
  function weatherOf(deploy) {
    if (!deploy) return null;
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
    return {
      fields: repos.map(r => ({
        key: r.path, name: r.name, branch: r.branch ?? null, dirty: r.dirty ?? 0, ahead: r.ahead ?? 0, behind: r.behind ?? 0,
        weather: weatherOf(r.deploy), deploy: r.deploy ?? null,
        crop: CROPS[pick(r.path, 7, CROPS.length)], fence: FENCES[pick(r.path, 8, FENCES.length)], soil: SOILS[pick(r.path, 9, SOILS.length)],
        pennant: Boolean(r.branch) && r.branch !== '(detached)' && !isMain(r.branch),
        collision: (snap.collisions ?? []).find(c => c.repo === r.path)?.severity ?? null,
      })),
      farmers: (snap?.agents ?? []).map(a => {
        const pct = contextPct(a.contextTokens);
        return {
          id: a.id, name: a.name, kind: a.kind, state: a.state === 'yourTurn' ? 'turn' : a.state, field: fieldOf(a, repos),
          tool: a.now?.tool ?? a.feed?.find(f => f.kind === 'tool')?.tool ?? null, summary: a.now?.summary ?? '',
          pct, hearts: Math.round((1 - pct) * 4), hot: (a.proc?.cpu ?? 0) >= cpuAlertPct,
          ask: askText(a), askKind: a.ask?.kind ?? null, question: a.question ?? null, reply: firstLine(a.lastReply),
          said: spoken((a.feed ?? []).find(f => f.kind === 'reply')?.body ?? (a.feed ?? []).find(f => f.kind === 'reply')?.text), color: colorIndex(a.id), shirt: SHIRT[colorIndex(a.id)], look: lookOf(a),
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
  const PXG = { ctx: null, T: 0 }; // the canvas being drawn right now, and the animation clock
  const px = (x, y, w, h, c) => { PXG.ctx.fillStyle = c; PXG.ctx.fillRect(x, y, w, h); };
  const SC = 2; // characters are drawn at 2×: one sprite pixel = two world pixels
  const blink = (hz, n = 2) => Math.floor(PXG.T * hz) % n;
  const rpAt = (ox, oy) => (x, y, w, h, c) => px(ox + x * SC, oy + y * SC, w * SC, h * SC, c);
  const legFrame = b => (b.walk ? (blink(8) ? 'a' : 'b') : 's');
  const pixelOrigin = (b, SH) => [Math.round(b.x) - 7 * SC, Math.round(b.y) - SH * SC + (b.walk && blink(8) ? -SC : 0)];
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
  const farmerRows = look => [
    ...(HEADS[look.hat] ?? HEADS.straw),
    '...krssssrk...',
    look.extra === 'glasses' ? '...kggkkggk...' : '...kssssssk...',
    look.extra === 'beard' ? '...krssssrk...' : look.extra === 'cheeks' ? '...kpsssspk...' : '...kssssssk...',
    look.extra === 'beard' ? '....krrrrk....' : '....kkkkkk....',
    '..kCCCCCCCCk..', '.kCCoCCCCoCCk.', '.kCCooooooCCk.', '.ks.oooooo.sk.', `...k${'o'.repeat(6)}k...`,
  ];
  const LEGS = { s: ['...koo..ook...', '...kkk..kkk...'], a: ['...koo..ook...', '...kkk........'], b: ['...koo..ook...', '........kkk...'], p: ['......PP......', '......PP......'] };
  const sprites = new Map();
  function farmerSprite(look, color, scare, legs, up) {
    const key = `${Object.values(look).join()}|${color}|${scare}|${legs}|${up}`;
    if (sprites.has(key)) return sprites.get(key);
    const pal = scare // a scarecrow keeps its farmer's hat and shape, in straw and sacking
      ? { k: '#3a2a1a', h: '#c9a24a', b: '#7a5230', r: '#c9a24a', s: '#d8c48a', g: '#d8c48a', p: '#d8c48a', C: '#8b7a55', o: '#6b5a3a', P: '#6b4320' }
      : { k: K, h: look.hatColor, b: look.band, r: look.hair, s: look.skin, g: '#e6eef5', p: '#e58a8a', C: color, o: look.overalls, P: '#6b4320' };
    const c = makeSprite(farmerRows(look).concat(LEGS[legs]), pal);
    if (up) { // one arm up, waving
      const g = c.getContext('2d');
      g.clearRect(11, 11, 2, 2); g.fillStyle = color; g.fillRect(12, 5, 1, 6); g.fillStyle = pal.s; g.fillRect(12, 3, 1, 2); g.fillStyle = K; g.fillRect(13, 3, 1, 8);
    }
    sprites.set(key, c);
    return c;
  }

  const ACTIVE = new Set(['waiting', 'working', 'turn']);
  // Where a farmer stands in its field, and what it holds, by its current tool.
  const toolSpot = t => (/^(Read|Grep|Glob|WebSearch|WebFetch)$/.test(t ?? '') ? -26 : /^(Edit|MultiEdit|NotebookEdit|Write)$/.test(t ?? '') ? 26 : 0);
  const toolProp = t => (t === 'Bash' ? 'can' : /^(Edit|MultiEdit|NotebookEdit)$/.test(t ?? '') ? 'hoe' : t === 'Write' ? 'seeds'
    : /^Web(Search|Fetch)$/.test(t ?? '') ? 'pigeon' : /^(Read|Grep|Glob)$/.test(t ?? '') ? 'almanac' : null);
  const VERB = { can: 'watering', hoe: 'hoeing', seeds: 'planting', pigeon: 'sending a pigeon', almanac: 'reading the almanac' };
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
  /** One plant at (x, y), grown to p (0–1); ripe past 0.8. Returns the y of its top, for the sparkle. */
  function drawCrop(crop, x, y, p, sway) {
    const ripe = p > 0.8;
    if (crop === 'pumpkin') {
      const z = 1 + Math.round(p * 3);
      px(x - 2, y - 1, 5, 1, '#3f9b3a'); px(x - 3, y - 3, 2, 2, '#6cc04a');
      px(x - Math.floor(z / 2), y - z - 1, z + 1, z, ripe ? '#ff8c1a' : '#f4a261'); px(x, y - z - 2, 1, 1, '#3f9b3a');
      return y - z - 2;
    }
    if (crop === 'corn') {
      const h = 3 + Math.round(p * 7);
      px(x, y - h, 1, h, '#4f9a35'); px(x - 2, y - h + 3, 2, 1, '#6cc04a'); px(x + 1, y - h + 5, 2, 1, '#6cc04a');
      if (ripe) { px(x + 1, y - h + 1, 2, 3, '#f2d14b'); px(x + 1, y - h + 4, 2, 1, '#8fd16a'); } else if (p > 0.4) px(x + 1, y - h + 2, 1, 2, '#9ed36a');
      px(x + sway, y - h - 1, 1, 1, '#d9b26a');
      return y - h - 1;
    }
    if (crop === 'carrot') {
      const h = 1 + Math.round(p * 3);
      px(x, y - h, 1, h, '#3f9b3a'); px(x - 1, y - h, 1, 1, '#6cc04a'); px(x + 1, y - h + 1, 1, 1, '#6cc04a');
      if (p > 0.5) px(x - 1, y, 3, 1, ripe ? '#ff7a1a' : '#f0a060');
      return y - h;
    }
    if (crop === 'cabbage') {
      const w = 2 + Math.round(p * 3), h = 1 + Math.round(p * 2);
      px(x - (w >> 1) - 1, y - 1, w + 2, 1, '#4f9a35');
      px(x - (w >> 1), y - h - 1, w, h, ripe ? '#7fb24a' : '#8fd16a'); px(x - (w >> 1) + 1, y - h - 1, 1, 1, '#c6e89a');
      return y - h - 1;
    }
    if (crop === 'sunflower') {
      const h = 3 + Math.round(p * 7);
      px(x, y - h, 1, h, '#3f9b3a'); px(x + 1, y - h + 4, 2, 1, '#6cc04a');
      if (ripe) { px(x - 1 + sway, y - h - 2, 3, 3, '#f4c430'); px(x + sway, y - h - 1, 1, 1, '#6b4320'); return y - h - 2; }
      px(x + sway, y - h - 1, 1, 1, p > 0.4 ? '#d9c24a' : '#8fd16a');
      return y - h - 1;
    }
    if (crop === 'tomato') {
      const h = 2 + Math.round(p * 5);
      px(x + 1, y - h - 1, 1, h + 1, '#8b5a2b'); px(x, y - h, 1, h, '#3f9b3a'); px(x - 1, y - h + 1, 1, 1, '#6cc04a');
      if (p > 0.3) px(x - 1, y - h + 2, 2, 2, ripe ? '#e04a3a' : p > 0.6 ? '#f08a3a' : '#9ed36a');
      if (p > 0.6) px(x - 1, y - 3, 2, 2, ripe ? '#e04a3a' : '#9ed36a');
      return y - h - 1;
    }
    // wheat
    const h = 2 + Math.round(p * 6);
    px(x, y - h, 1, h, '#3f9b3a'); px(x - 1, y - h + 1, 1, 1, '#6cc04a'); px(x + 1, y - h + 2, 1, 1, '#6cc04a');
    if (ripe) { px(x - 1 + sway, y - h - 2, 3, 2, '#e9c46a'); px(x + sway, y - h - 3, 1, 1, '#f4d58d'); return y - h - 2; }
    px(x + sway, y - h - 1, 1, 1, '#8fd16a');
    return y - h - 1;
  }

  function makeFarm() {
    const game = { coins: 0, harvests: 0 }; // page memory only: resets on reload
    let L = layoutFor([]);
    let scene = { fields: [], farmers: [] };
    const stOf = k => L.ST.find(s => s.key === k);
    const fieldByKey = k => scene.fields.find(f => f.key === k);

    function plotState(f) {
      const here = scene.farmers.filter(a => a.field === f.key), on = here.filter(a => ACTIVE.has(a.state));
      const crop = f.crop ?? 'wheat';
      if (on.length) return { kind: 'grow', crop, p: Math.max(...on.map(a => a.pct)), busy: on.some(a => a.state === 'working') };
      if (here.length && here.every(a => a.state === 'stale')) return { kind: 'dry', crop };
      return { kind: 'bare', crop };
    }
    function drawPlot(s) {
      const f = fieldByKey(s.key), x0 = s.cx - 42, y0 = s.rowTop + 4, st = plotState(f), T = PXG.T, fence = f.fence ?? '#c98d4f';
      px(x0 - 2, y0 - 2, 88, 48, fence); px(x0 - 1, y0 - 1, 86, 46, shade(fence, 0.68));
      const soil = f.soil ?? '#7a5230', furrow = shade(soil, 0.77), ridge = shade(soil, 1.15);
      px(x0, y0, 84, 44, soil); px(x0, y0, 84, 1, furrow); px(x0, y0 + 43, 84, 1, furrow);
      for (let k = 0; k < 5; k++) { const fy = y0 + 6 + k * 8; px(x0 + 2, fy - 1, 80, 1, ridge); px(x0 + 2, fy, 80, 2, furrow); }
      for (let k = 0; k < 4; k++) for (let i = 0; i < 10; i++) {
        const x = x0 + 6 + i * 8, y = y0 + 5 + k * 8;
        if (st.kind === 'bare') { // fallow: weeds
          if ((i * 5 + k * 3) % 7 === 0) { px(x, y - 2, 1, 2, '#4f7f2f'); px(x - 1, y - 1, 1, 1, '#4f7f2f'); px(x + 1, y - 1, 1, 1, '#4f7f2f'); }
          continue;
        }
        if (st.kind === 'dry') { px(x, y - 2, 1, 2, '#9c7a4a'); px(x + 1, y - 3, 1, 1, '#9c7a4a'); continue; }
        const top = drawCrop(st.crop, x, y, st.p, st.busy && (i + k + Math.floor(T * 2)) % 2 ? 1 : 0);
        // ripe (context nearly full, ready to harvest): a sparkle now and then
        if (st.p > 0.8 && (i * 7 + k * 3 + Math.floor(T * 3)) % 13 === 0) { px(x, top - 5, 1, 3, '#ffffff'); px(x - 1, top - 4, 3, 1, '#ffffff'); }
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
    function drawTree() {
      const { BOT_TOP, LANE_B } = L;
      px(52, BOT_TOP + 12, 9, LANE_B - BOT_TOP - 14, '#6b4320'); px(52, BOT_TOP + 12, 2, LANE_B - BOT_TOP - 14, '#8b5a2b');
      px(18, BOT_TOP - 6, 78, 20, '#2f6b2f'); px(26, BOT_TOP - 11, 62, 6, '#2f6b2f'); px(22, BOT_TOP + 14, 70, 3, '#2a5e2a');
      px(32, BOT_TOP - 9, 20, 4, '#3f8a3a'); px(58, BOT_TOP - 4, 24, 5, '#3f8a3a'); px(24, BOT_TOP + 2, 14, 4, '#3f8a3a');
      for (const [x, y] of [[40, BOT_TOP - 2], [70, BOT_TOP + 6], [30, BOT_TOP + 8]]) px(x, y, 3, 3, '#e63946'); // apples
    }
    function drawPosts() {
      const { LANE_B } = L;
      for (const x of [129, 268]) { px(x, LANE_B - 34, 3, 40, '#8b5a2b'); px(x, LANE_B - 34, 1, 40, '#a8703c'); }
      px(127, LANE_B - 36, 146, 3, '#8a3b2e');
    }

    return {
      key: 'farm', SH: 16, game,
      setScene(next) { scene = next; },
      layout: () => L,
      relayout(fields) { L = layoutFor(fields); return L; },
      // Where each farmer stands. Porch, tree, scarecrows and meadow hold four each; the rest show as a "+N" sign.
      slots(f) {
        const { LANE_B, rows } = L;
        const s = f.state === 'working' ? stOf(f.field) : null;
        if (s) return { group: `st:${s.key}`, at: used => { const off = [toolSpot(f.tool), 0, -26, 26, -13, 13].find(o => !used.includes(o)) ?? 0; used.push(off); return [s.cx + off, s.lane]; }, zone: `st:${s.key}:${toolProp(f.tool) ?? f.tool}` };
        if (f.state === 'working') return { group: 'meadow', cap: Math.min(8, rows * 2), at: i => [i % 2 ? 36 : 16, TOP + 30 + Math.floor(i / 2) * 37 + (i % 2) * 12], zone: 'meadow' };
        if (f.state === 'waiting') return { group: 'desk', cap: 4, at: i => [136 + 18 * i, LANE_B], zone: 'desk' };
        if (f.state === 'turn') return { group: 'turn', cap: 4, at: i => [264 - 18 * i, LANE_B], zone: 'turn' };
        if (f.state === 'stale') return { group: 'storage', cap: 4, at: i => [308 + 26 * i, LANE_B - 2], zone: 'storage' };
        return { group: 'charge', cap: 4, at: i => [20 + 26 * i, LANE_B], zone: 'charge' };
      },
      spawn: () => BARN_DOOR,
      follow: (b, k, T, kid) => (kid?.dog
        ? [b.x + Math.cos(T * 0.9 + k) * 44, b.y + 4 + Math.sin(T * 1.8) * 8] // the Explore dog roams and sniffs
        : [b.x + (k % 2 ? 17 : -17) + Math.sin(T * 1.3 + k) * 3, b.y + 3 - (k > 1 ? 8 : 0)]),
      startText: n => `Morning: <b>${n}</b> farmer${n === 1 ? '' : 's'} on the farm`,
      arriveText: 'walks out of the barn',
      tag: f => (f.kind === 'codex' ? clip(f.name, 16) : `${clip(f.name, 16)} ${'♥'.repeat(f.hearts)}${'♡'.repeat(4 - f.hearts)}`),
      tip: f => {
        const field = fieldByKey(f.field);
        const what = f.state === 'waiting' ? `needs you: ${f.ask}` : f.state === 'turn' ? (f.question ? `asks you: ${f.question}` : `your turn: ${f.reply || 'finished'}`)
          : f.state === 'working' ? `${VERB[toolProp(f.tool)] ?? f.tool ?? 'working'}${field ? ` in ${field.name}` : ''}${f.summary ? ` · ${f.summary}` : ''}`
          : f.state === 'stale' ? 'stale' : 'idle';
        return `${f.name} · ${what}${f.kind === 'codex' ? '' : ` · ${Math.round((1 - f.pct) * 100)}% context left`}`;
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
        return `${VERB[toolProp(f.tool)] ?? 'working'} in the ${fieldByKey(f.field)?.name ?? ''} field`;
      },
      hud(still, zoom = 1, saysOn = true) {
        const on = scene.farmers.filter(a => ACTIVE.has(a.state)), need = scene.farmers.filter(a => a.state === 'waiting' || a.question).length;
        const energy = on.length ? on.reduce((t, a) => t + (1 - a.pct), 0) / on.length : 1;
        return `<span title="One coin for every tool step since you opened this page"><b class="coin"></b>${game.coins}</span>
          <span title="Finished turns delivered to your porch"><b class="basket"></b>${game.harvests} harvested</span>
          <span title="Average context left across active farmers">energy <em class="hbar"><i style="width:${Math.round(energy * 100)}%"></i></em></span>
          ${need ? `<span class="alert">${need} need${need > 1 ? '' : 's'} you</span>` : ''}
          <span class="px-zoom" title="Zoom (or ⌘/Ctrl + scroll over the farm)"><button type="button" data-farm-zoom="-1" aria-label="Zoom out">−</button><button type="button" data-farm-zoom="0" title="Fit the farm to the width">${Math.round(zoom * 100)}%</button><button type="button" data-farm-zoom="1" aria-label="Zoom in">+</button></span>
          <button type="button" data-farm-bubbles title="Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again">Bubbles: ${saysOn ? 'on' : 'off'}</button>
          <button type="button" class="px-motion" data-farm-motion title="Walking and animation on the farm">Motion: ${still ? 'off' : 'on'}</button>
          <button type="button" class="px-info" data-farm-help title="How to read the farm" aria-label="How to read the farm">i</button>`;
      },
      bg(f) {
        const { H, BOT_TOP, LANE_B } = L;
        for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) f(x, y, 4, 4, (x * 7 + y * 13) % 11 === 0 ? '#5d9b46' : ((x + y) / 4) % 2 ? '#6aa84f' : '#66a34b');
        f(0, 0, W, 16, '#a9dcf7'); f(0, 12, W, 4, '#c4e6fa');
        for (const [x, y, w] of [[90, 3, 20], [270, 5, 24], [340, 2, 16]]) { f(x, y + 1, w, 4, '#ffffff'); f(x + 4, y, w - 8, 2, '#ffffff'); }
        for (let x = 0; x < W; x += 10) f(x, 14 + ((x / 10) % 3) * 2, 12, 12, (x / 10) % 2 ? '#3f7d3a' : '#467f3c');
        for (let x = 0; x < W; x += 12) f(x, 23, 2, 8, '#6b4320');
        f(0, 25, W, 1, '#8b5a2b'); f(0, 28, W, 1, '#8b5a2b');
        // barn, top left: new farmers walk out of its door
        f(2, 6, 46, 26, '#b23a2e'); f(-2, 3, 54, 4, '#6b2a22'); f(6, 0, 38, 3, '#6b2a22');
        for (let y = 8; y < 32; y += 4) f(2, y, 46, 1, '#9c3127');
        f(16, 14, 18, 18, '#5a1f19'); for (let i = 0; i < 18; i++) { f(16 + i, 14 + i, 1, 1, '#f4ead5'); f(33 - i, 14 + i, 1, 1, '#f4ead5'); }
        // wild meadow beside the barn: farmers working outside any repo
        for (let y = TOP + 6; y < BOT_TOP - 8; y += 5) for (let x = 4 + (y % 2) * 2; x < 46; x += 6) f(x, y, 1, 2, '#4f8f3a');
        f(150, 4, 100, 14, '#6b4320'); f(151, 5, 98, 12, '#a8703c'); f(166, 18, 2, 10, '#6b4320'); f(232, 18, 2, 10, '#6b4320'); // sign
        for (const c of CORR) { f(c - 7, TOP, 14, BOT_TOP - TOP + 4, '#b08850'); f(c - 7, TOP, 1, BOT_TOP - TOP + 4, '#9a7442'); f(c + 6, TOP, 1, BOT_TOP - TOP + 4, '#9a7442'); }
        f(0, BOT_TOP - 2, W, 7, '#b08850'); f(0, BOT_TOP - 2, W, 1, '#9a7442');
        // farmhouse with your porch
        f(130, BOT_TOP + 8, 140, 6, '#8a3b2e'); f(126, BOT_TOP + 12, 148, 3, '#6b2a22');
        f(136, BOT_TOP + 15, 128, LANE_B - BOT_TOP - 19, '#e8d8b0'); for (let y = BOT_TOP + 18; y < LANE_B - 4; y += 4) f(136, y, 128, 1, '#d4c294');
        for (const wx of [148, 232]) { f(wx, BOT_TOP + 19, 20, 13, '#6b4320'); f(wx + 1, BOT_TOP + 20, 18, 11, '#5fa8e8'); f(wx + 10, BOT_TOP + 20, 1, 11, '#6b4320'); f(wx + 1, BOT_TOP + 25, 18, 1, '#6b4320'); }
        f(190, LANE_B - 28, 20, 24, '#6b4320'); f(191, LANE_B - 27, 18, 23, '#8b5a2b'); f(205, LANE_B - 16, 2, 2, '#f0b429');
        f(124, LANE_B - 4, 152, 10, '#a8703c'); for (let x = 128; x < 276; x += 8) f(x, LANE_B - 4, 1, 10, '#8b5a2b'); f(124, LANE_B + 5, 152, 1, '#6b4320');
        f(186, LANE_B + 6, 28, 4, '#8b5a2b'); f(186, LANE_B + 9, 28, 1, '#6b4320');
        // scarecrow corner: dry stubble
        f(288, BOT_TOP + 10, 110, H - BOT_TOP - 12, '#8a7140');
        for (let y = BOT_TOP + 14; y < H - 2; y += 5) for (let x = 290 + (y % 2) * 2; x < 396; x += 6) f(x, y, 1, 2, '#6d5830');
      },
      ground() { L.ST.forEach(drawPlot); L.ST.forEach(drawPiles); },
      fieldAt(x, y) { return L.ST.find(s => Math.abs(x - s.cx) <= 46 && y >= s.rowTop - 18 && y <= s.rowTop + 50)?.key ?? null; },
      items: () => [[L.BOT_TOP + 30, drawTree], [L.LANE_B + 6, drawPosts]],
      drawChar(f, b) {
        const scare = f.state === 'stale', [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy);
        if (scare) { rp(0, 10, 14, 1, '#6b4320'); rp(-1, 9, 2, 3, '#d8c48a'); rp(13, 9, 2, 3, '#d8c48a'); }
        PXG.ctx.drawImage(farmerSprite(f.look, SHIRT[f.color], scare, scare ? 'p' : legFrame(b), f.state === 'waiting'), ox, oy, 14 * SC, 16 * SC);
        if (scare) { rp(5, 6, 1, 1, '#3a2a1a'); rp(8, 6, 1, 1, '#3a2a1a'); rp(5, 7, 4, 1, '#7a5230'); rp(6, 11, 2, 2, '#c97b4a'); return; }
        const look = b.dir < 0 ? -1 : b.dir > 0 ? 1 : 0, ex = 5 + look;
        if (f.state === 'idle' && !b.walk) { rp(ex, 6, 1, 1, '#8a5a3a'); rp(ex + 3, 6, 1, 1, '#8a5a3a'); return; } // eyes closed
        const ey = f.state === 'working' && !b.walk ? 7 : 6;
        if (f.state === 'turn' && !b.walk) { rp(ex - 1, ey, 2, 1, K); rp(ex + 3, ey, 2, 1, K); rp(ex + 1, 7, 2, 1, '#b5562f'); }
        else { rp(ex, ey, 1, f.state === 'waiting' ? 2 : 1, K); rp(ex + 3, ey, 1, f.state === 'waiting' ? 2 : 1, K); }
      },
      drawFx(f, b) {
        const [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy), T = PXG.T;
        if (f.hot) { rp(11, 3 + Math.floor((T * 6) % 4), 1, 2, '#8fd3ff'); rp(2, 4 + Math.floor((T * 6 + 2) % 4), 1, 2, '#8fd3ff'); rp(4, 7, 1, 1, '#ff6b6b'); rp(9, 7, 1, 1, '#ff6b6b'); }
        if (f.state === 'working' && !b.walk) {
          const prop = toolProp(f.tool);
          if (prop === 'can') {
            const tilt = blink(2); rp(11, 10, 4, 3, '#9aa4ad'); rp(11, 10, 4, 1, '#c3cbd2'); rp(15, 9 + tilt, 2, 1, '#9aa4ad');
            for (let i = 0; i < 3; i++) rp(16 + (i % 2), 11 + ((Math.floor(T * 10) + i * 2) % 5), 1, 1, '#5ab4ff');
          } else if (prop === 'hoe') {
            if (blink(3)) { rp(12, 2, 1, 10, '#8b5a2b'); rp(11, 1, 3, 1, '#9aa4ad'); }
            else { rp(11, 12, 5, 1, '#8b5a2b'); rp(16, 12, 1, 3, '#9aa4ad'); rp(17, 14, 1, 1, '#5e3d22'); rp(15, 15, 1, 1, '#5e3d22'); rp(18, 13, 1, 1, '#7a5230'); }
          } else if (prop === 'seeds') {
            rp(1, 11, 3, 3, '#c9a46a'); rp(1, 11, 3, 1, '#a07e48');
            for (let i = 0; i < 3; i++) { const ph = (T * 1.5 + i / 3) % 1; rp(Math.round(11 + ph * 7), Math.round(11 - Math.sin(ph * Math.PI) * 5 + ph * 4), 1, 1, '#f4d58d'); }
          } else if (prop === 'pigeon') {
            const bx = Math.round(7 + Math.cos(T * 2) * 16), by = Math.round(-8 + Math.sin(T * 4) * 3), up = blink(6);
            rp(bx, by, 2, 1, '#ececec'); rp(bx + 2, by, 1, 1, '#f0b429'); rp(bx - 1, by + (up ? -1 : 1), 2, 1, '#bdbdbd');
          } else if (prop === 'almanac') {
            rp(3, 10, 8, 4, '#7a3e2b'); rp(4, 10, 6, 3, '#fff4d6'); rp(5, 11 + blink(3), 4, 1, '#c9b48a'); rp(7, 10, 1, 3, '#c9b48a');
          }
        }
        if (f.state === 'waiting') bubble(rp, 14, -6 - blink(3), '!');
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
            const dp = rpAt(Math.round(d.x) - 8, Math.round(d.y) - 12), c = (x, y, w, h, col) => dp(m(x, w), y, w, h, col);
            c(1, 2, 5, 2, '#a0662e'); c(5, 1 + sniff, 2, 2, '#a0662e'); c(5, sniff, 1, 1, '#6b4320'); c(7, 2 + sniff, 1, 1, '#222');
            c(1, 4, 1, 1, '#6b4320'); c(4, 4, 1, 1, '#6b4320'); c(0, 1 + blink(6), 1, 1, '#a0662e'); c(2, 2, 2, 1, '#c98d4f');
            if (sniff) c(8, 4, 1, 1, '#b08850');
            return;
          }
          const hop = b.walk ? Math.round(Math.abs(Math.sin(T * 10 + k)) * 3) : (blink(2) && k % 2 ? 1 : 0);
          const cp = rpAt(Math.round(d.x) - 5, Math.round(d.y) - 10 - hop);
          cp(2, 0, 1, 1, '#e63946'); cp(1, 1, 3, 1, '#ffffff'); cp(3, 1, 1, 1, '#222'); cp(0, 2, 4, 1, '#ffffff'); cp(4, 2, 1, 1, '#f0b429'); cp(1, 3, 3, 1, '#ececec'); cp(1, 4, 1, 1, '#f0b429'); cp(3, 4, 1, 1, '#f0b429');
        });
      },
      top() {
        const T = PXG.T, anyHot = scene.farmers.some(a => a.hot);
        const sun = anyHot && blink(2) ? '#ff922b' : '#ffd43b';
        px(124, 2, 10, 10, sun); px(122, 4, 14, 6, sun); px(126, 0, 6, 14, sun);
        if (anyHot) { PXG.ctx.globalAlpha = 0.35; px(119, -1, 20, 16, '#ff6b1a'); PXG.ctx.globalAlpha = 1; }
        for (const s of L.ST) {
          const weather = fieldByKey(s.key).weather;
          if (weather === 'rainbow') { // deploy passed
            PXG.ctx.globalAlpha = 0.55;
            ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7'].forEach((c, j) => { const r = 30 - j * 3; for (let ang = 196; ang <= 344; ang += 5) { const t = ang * Math.PI / 180; px(Math.round(s.cx + Math.cos(t) * r), Math.round(s.rowTop + 22 + Math.sin(t) * r * 0.55), 2, 2, c); } });
            PXG.ctx.globalAlpha = 1;
          } else if (weather === 'windmill') { // deploy running
            const hx = s.cx - 2, hy = s.rowTop - 10;
            px(hx - 2, hy, 5, 13, '#e8d8b0'); px(hx - 3, hy - 2, 7, 2, '#8a3b2e'); px(hx, hy + 8, 1, 4, '#6b4320');
            for (let i = 0; i < 4; i++) { const t = T * 3 + i * Math.PI / 2; for (let r = 2; r <= 8; r++) px(Math.round(hx + Math.cos(t) * r), Math.round(hy + 1 + Math.sin(t) * r), 1, 1, r > 4 ? '#ffffff' : '#c9b48a'); }
          } else if (weather === 'rain') { // deploy failed
            const cx = Math.round(s.cx - 13 + Math.sin(T * 0.6) * 8), cy = s.rowTop + 2;
            px(cx, cy + 2, 26, 6, '#8c96a0'); px(cx + 4, cy, 12, 3, '#9aa4ad'); px(cx + 14, cy + 1, 9, 2, '#9aa4ad'); px(cx, cy + 7, 26, 1, '#6f7881');
            for (let i = 0; i < 6; i++) px(cx + 2 + i * 4, cy + 9 + Math.floor((T * 40 + i * 9) % 26), 1, 2, '#5ab4ff');
          }
        }
      },
      labels(lab, overflow) {
        const { LANE_B, ST, more } = L;
        lab(200, 11, 'AGENT FARM', 'wood');
        for (const s of ST) {
          const f = fieldByKey(s.key);
          const branch = f.branch === '(detached)' ? ' <span style="opacity:.75">?</span>' : f.branch && !isMain(f.branch) ? ` <span style="opacity:.7">${esc(clip(f.branch, 14))}</span>` : '';
          const d = f.deploy, why = d?.reason ? `: ${d.reason}` : '';
          const weather = f.weather === 'rain' ? ' <span class="dep-bad">✗ deploy failed</span>' : f.weather === 'windmill' ? ' <span class="dep-run">◌ deploying</span>' : f.weather === 'rainbow' ? ' <span class="dep-ok">✓ deployed</span>' : '';
          const tip = [f.key, f.branch && `on ${f.branch}`, d && `${d.workflow ?? 'Deploy'} ${d.status === 'completed' ? d.conclusion : d.status} at ${d.sha}${why}`, 'Click to see the files agents touched here'].filter(Boolean).join(' · ');
          lab(s.cx, s.rowTop + 50, `<button type="button" class="px-field" data-farm-field="${esc(f.key)}" title="${esc(tip)}">${esc(clip(f.name, 18))}${branch}${weather}${f.collision ? ' ⚠ crowded' : ''}</button>`, f.collision ? 'bad' : '');
          if (f.behind > 0) lab(s.cx - 40, s.rowTop - 17, `↓${f.behind}`, 'cnt', `${f.behind} commit${f.behind === 1 ? '' : 's'} behind the remote`);
          if (f.ahead > 0) lab(s.cx - 23, s.rowTop - 7 - Math.ceil(Math.min(f.ahead, 16) / 8) * 6, `↑${f.ahead}`, 'cnt', `${f.ahead} unpushed commit${f.ahead === 1 ? '' : 's'}`);
          if (f.dirty > 0) lab(s.cx + 30, s.rowTop - 7 - Math.ceil(Math.min(f.dirty, 12) / 9) * 6, `+${f.dirty}`, 'cnt', `${f.dirty} uncommitted file${f.dirty === 1 ? '' : 's'}`);
        }
        if (!ST.length) lab(220, TOP + 30, 'No fields yet: no agent has touched a repo in the last 30 minutes', 'zone');
        lab(25, TOP + 2, 'MEADOW', 'zone');
        lab(58, LANE_B + 6, 'SHADE TREE', 'zone'); lab(200, LANE_B + 10, 'YOUR PORCH', 'zone'); lab(343, LANE_B + 6, 'SCARECROWS', 'zone');
        const plus = (x, y, n, what) => n > 0 && lab(x, y, `+${n} ${what}`, 'cnt');
        plus(150, LANE_B - 40, overflow.desk, 'waiting');
        plus(250, LANE_B - 40, overflow.turn, 'your turn');
        plus(58, L.BOT_TOP + 22, overflow.charge, 'idle');
        plus(343, L.BOT_TOP + 22, overflow.storage, 'stale');
        plus(25, L.BOT_TOP - 8, overflow.meadow, 'in the meadow');
        if (more > 0) lab(320, 11, `<button type="button" class="px-more" data-farm-more>+${more} more field${more === 1 ? '' : 's'}</button>`, 'wood');
      },
    };
  }

  /** The farm's legend, shown in a dialog from the ⓘ button. */
  function helpHtml() {
    return `<div class="px-key">
      <b>Your porch</b><span>a farmer waving a red “!” needs you; a basket means it's your turn</span>
      <b>Fields</b><span>one per repo, each with its own crop (the seed packet on its fence), soil and fence; a blue pennant = a branch other than main. The tool in hand is the current step (almanac = reading, can = shell, hoe = editing, seeds = new file, pigeon = web)</span>
      <b>Farmers</b><span>one per agent; each has its own hat, hair and clothes, and its shirt is the agent's colour in the list</span>
      <b>Speech bubbles</b><span>what a farmer asked or last said; × hides one to a 💬 (click it to show the bubble again); a new message brings it back by itself. The Bubbles switch hides or shows them all</span>
      <b>Above a field</b><span>hay = uncommitted files, crates = unpushed commits, mailbox = behind the remote</span>
      <b>Weather</b><span>the repo's last deploy: rainbow = deployed, rain = deploy failed (hover its sign for GitHub's reason; the close-up links to the run), windmill = deploying; rope = two agents writing one repo</span>
      <b>Hearts, crops</b><span>context left; ripe crops (golden wheat, red tomatoes, sunflowers in bloom…) with a sparkle = context nearly full; chickens = subagents, the dog = an Explore subagent</span>
      <b>Shade tree, scarecrows</b><span>idle agents nap under the tree; stale ones stand as scarecrows; the meadow is for agents outside any repo</span>
      <b>Click</b><span>a farmer to answer or message it in the sidebar; a field for the files agents touched there</span>
    </div>`;
  }

  /* ---------- the engine: positions, walking, tags, pop-ups, diary, the loop ---------- */

  function makePixelView(th) {
    let host = null, canvas = null, ctx = null, ov = null, logEl = null, hudEl = null, bg = null, ro = null;
    let raf = 0, last = 0, T = 0, cs = 1, first = true, timer = 0, layoutKey = null, labelKey = '';
    let scene = { fields: [], farmers: [] }, overflow = {}, still = false, opts = {}, selectedId = null, got = false; // got: a scene has arrived
    // Zoom on top of "fit to the width", and speech bubbles (each can be closed until its farmer says something new).
    const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
    const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const keep = (key, value) => { try { localStorage.setItem(key, value); } catch { /* this page only */ } };
    let zoom = ZOOMS.includes(Number(stored('tracker-farm-zoom'))) ? Number(stored('tracker-farm-zoom')) : 1;
    let saysOn = stored('tracker-farm-bubbles') !== 'off';
    let wheel = 0;
    const says = new Map(); // farmer id → { el, text }
    const closedSays = new Map(); // farmer id → the text that was closed
    const bots = new Map(), log = [];

    function targets() {
      const out = new Map(), count = {}, used = new Map(), over = { desk: 0, turn: 0, storage: 0, charge: 0, meadow: 0 };
      for (const f of scene.farmers) {
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
      el.textContent = text;
      el.style.left = `${Math.round(x * cs)}px`;
      el.style.top = `${Math.round(y * cs)}px`;
      ov.appendChild(el);
      setTimeout(() => el.remove(), 1700);
    }
    function renderHud() { if (hudEl) hudEl.innerHTML = th.hud(still, zoom, saysOn); }
    function setZoom(step) {
      zoom = step === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + step))];
      keep('tracker-farm-zoom', String(zoom));
      resize();
      renderHud();
    }
    function onWheel(e) { // ⌘/Ctrl + scroll (or a trackpad pinch) zooms
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      wheel += e.deltaY;
      if (Math.abs(wheel) < 40) return;
      setZoom(wheel < 0 ? 1 : -1);
      wheel = 0;
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
        if (d <= sp) { b.x = qx; b.y = qy; b.path.shift(); } else { b.x += (dx / d) * sp; b.y += (dy / d) * sp; }
        b.walk = b.path.length > 0 || d > sp;
      } else { b.walk = false; b.dir = 0; }
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
      ctx.drawImage(bg, 0, 0);
      th.ground();
      const items = th.items();
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) items.push([b.y, () => th.drawChar(f, b)]); }
      items.sort((p, q) => p[0] - q[0]).forEach(it => it[1]());
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) th.drawFx(f, b); }
      const picked = selectedId && bots.get(selectedId);
      if (picked) { // the farmer shown in the sidebar: a ring at its feet
        PXG.ctx.globalAlpha = 0.85;
        px(Math.round(picked.x) - 10, Math.round(picked.y) + 1, 20, 2, '#ffd43b');
        px(Math.round(picked.x) - 12, Math.round(picked.y) - 1, 2, 2, '#ffd43b');
        px(Math.round(picked.x) + 10, Math.round(picked.y) - 1, 2, 2, '#ffd43b');
        PXG.ctx.globalAlpha = 1;
      }
      th.top();
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
          b.tag.textContent = text;
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
      if (now - last < 33) return; // ~30 fps is plenty for pixel art
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      T += dt;
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) step(dt, f, b); }
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
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      th.bg((x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); });
      return c;
    }
    function resize() {
      if (!canvas) return;
      const { H } = th.layout(), dpr = window.devicePixelRatio || 1;
      // Fit the width (at most 4×); the backing store is a whole multiple of the art, and
      // image-rendering: pixelated keeps the pixels square when the browser scales it.
      const fit = Math.max(0.75, Math.min(4, ((host.querySelector('.px-host').clientWidth || W) - 22) / W));
      cs = Math.max(0.5, Math.min(8, fit * zoom));
      const k = Math.max(1, Math.ceil(cs * dpr));
      canvas.width = W * k;
      canvas.height = H * k;
      canvas.style.width = `${W * cs}px`;
      canvas.style.height = `${H * cs}px`;
      ctx.setTransform(k, 0, 0, k, 0, 0);
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
      const tag = e.target.closest?.('[data-farmer]');
      if (tag) { e.stopPropagation(); opts.onPickAgent?.(tag.dataset.farmer); return; }
      if (e.target.closest?.('[data-farm-more]')) { e.stopPropagation(); opts.onShowRepos?.(); return; }
      const sign = e.target.closest?.('[data-farm-field]');
      if (sign) { e.stopPropagation(); opts.onOpenField?.(sign.dataset.farmField); return; }
      if (e.target.closest?.('[data-farm-motion]')) { e.stopPropagation(); setStill(!still); return; }
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
      const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / cs, y = (e.clientY - r.top) / cs;
      for (const [id, b] of bots) if (Math.abs(x - b.x) <= 14 && y >= b.y - th.SH * SC - 1 && y <= b.y + 1) { opts.onPickAgent?.(id); return; }
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
        host.innerHTML = `<div class="px"><div class="px-host"><div class="px-hud"></div><div class="px-stage"><canvas aria-label="Pixel farm: every farmer is an agent, every field a repo"></canvas><div class="px-ov"></div>${got ? '' : '<div class="px-loading"><span class="spinner"></span>Loading the farm…</div>'}</div></div>
          ${under}</div>
          <dialog class="px-help" aria-label="How to read the farm"><header><b>How to read the farm</b><button type="button" class="x" data-farm-help-close aria-label="Close">×</button></header>${helpHtml()}</dialog>`;
        canvas = host.querySelector('canvas');
        ctx = canvas.getContext('2d');
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
        host.querySelector('.px-stage').addEventListener('wheel', onWheel, { passive: false });
        document.addEventListener('visibilitychange', onVisibility);
        renderLog();
        renderHud();
        timer = setInterval(() => { if (!document.hidden) { renderLog(); renderHud(); } }, 1000);
        startLoop();
      },
      update(next) { apply(next); },
      select(id) {
        selectedId = id;
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
        host = canvas = ctx = ov = logEl = hudEl = null;
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
      const deploy = field.deploy ? (field.deploy.status === 'completed' ? field.deploy.conclusion : field.deploy.status) : '';
      const piles = [
        field.dirty ? `<span class="pile"><b class="i-bale"></b>${field.dirty} uncommitted</span>` : '',
        field.ahead ? `<span class="pile"><b class="i-crate"></b>${field.ahead} unpushed</span>` : '',
        field.behind ? `<span class="pile"><b class="i-mail"></b>${field.behind} behind</span>` : '',
        deploy ? (() => {
          const href = typeof field.deploy.url === 'string' && field.deploy.url.startsWith('https://github.com/') ? field.deploy.url : null;
          const tip = `${field.deploy.workflow ?? 'Deploy'} at ${field.deploy.sha}${field.deploy.reason ? `: ${field.deploy.reason}` : ''}`;
          const text = `deploy ${esc(deploy)}${href ? ' ↗' : ''}`;
          return href ? `<a class="pile ${deploy === 'failure' ? 'bad' : ''}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(tip)}">${text}</a>` : `<span class="pile ${deploy === 'failure' ? 'bad' : ''}" title="${esc(tip)}">${text}</span>`;
        })() : '',
        field.deploy?.reason ? `<div class="fv-why">${esc(field.deploy.reason)}</div>` : '',
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
    unmount() {
      if (!view) return;
      field.close();
      view.unmount();
      mounted = false;
    },
    toScene, fieldOf, weatherOf, contextPct, askText, helpHtml,
  };
})();
