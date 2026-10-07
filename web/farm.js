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

  /**
   * Messages between two farmers in the last 3 minutes, oldest first: { from, to, at, text }. Each
   * is seen once, from whichever side wrote it down; messages to a session's own helpers stay out.
   */
  function mailOf(agents, now) {
    const byName = new Map(agents.map(a => [a.name, a.id]));
    const out = [];
    for (const a of agents) for (const f of a.feed ?? []) {
      if (f.kind !== 'peer' || f.helper || now - f.at > 180_000) continue;
      const other = byName.get(f.other);
      if (!other || other === a.id) continue;
      const [from, to] = f.dir === 'out' ? [a.id, other] : [other, a.id];
      if (out.some(m => m.from === from && m.to === to && Math.abs(m.at - f.at) < 10_000)) continue;
      out.push({ from, to, at: f.at, text: f.text });
    }
    return out.sort((x, y) => x.at - y.at);
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

  /** The model's family, for the pin on a farmer's hat. */
  const familyOf = m => { const t = String(m ?? '').toLowerCase(); return ['opus', 'sonnet', 'haiku', 'fable'].find(f => t.includes(f)) ?? null; };

  function toScene(snap, { cpuAlertPct = snap?.settings?.cpuAlertPct ?? 90 } = {}) {
    const repos = snap?.repos ?? [];
    const agents = snap?.agents ?? [];
    const kids = agents.map(a => a.children ?? []);
    const now = snap?.generatedAt ?? Date.now();
    const waiting = agents.filter(a => a.state === 'waiting'), cpuUsed = agents.reduce((t, a) => t + (a.proc?.cpu ?? 0), 0);
    return {
      plan: snap?.plan ?? null,
      // what the dashboard's top bar and count cards say, for the farm's own panel (it fills the window)
      chrome: {
        counts: snap?.counts ?? null, asking: agents.filter(a => a.question).length, agents: agents.length,
        oldestWaiting: waiting.length ? Math.min(...waiting.map(a => a.stateSince || now)) : null,
        subagentsRunning: agents.filter(a => a.children?.some(c => c.kind === 'subagent' && c.state === 'running')).length,
        ram: { usedMb: agents.reduce((t, a) => t + (a.proc?.rssMb ?? 0), 0), totalMb: snap?.machine?.totalMemMb ?? null },
        cpu: { used: cpuUsed, cores: snap?.machine?.cpuCount ?? 1 },
        collector: snap?.collector ?? null,
        errors: Object.entries(snap?.sources ?? {}).filter(([, v]) => v && v.ok === false).map(([k, v]) => `${k}: ${String(v.error ?? 'failing').slice(0, 60)}`),
      },
      // subagents for the henhouse's list: what each was asked, whose it is, how it is going
      subagents: agents.flatMap(a => (a.children ?? []).filter(c => c.kind === 'subagent').map(c => ({ id: c.id, label: c.label ?? '', type: c.agentType ?? null, state: c.state, parent: a.name, startedAt: c.startedAt }))),
      mail: mailOf(agents, snap?.generatedAt ?? Date.now()),
      // The henhouse: eggs for subagents that finished lately; running ones beyond the four a farmer leads roost there.
      henhouse: {
        eggs: Math.min(6, kids.flat().filter(c => c.kind !== 'bgjob' && c.state === 'done').length),
        roosting: kids.reduce((t, k) => t + Math.max(0, k.filter(c => c.kind !== 'bgjob' && c.state === 'running').length - 4), 0),
      },
      fields: repos.map(r => ({
        key: r.path, name: r.name, branch: r.branch ?? null, dirty: r.dirty ?? 0, ahead: r.ahead ?? 0, behind: r.behind ?? 0,
        weather: weatherOf(r.lastDeploy !== undefined ? r.lastDeploy : r.deploy), deploy: r.deploy ?? null, lastDeploy: r.lastDeploy ?? null,
        crop: CROPS[pick(r.path, 7, CROPS.length)], fence: FENCES[pick(r.path, 8, FENCES.length)], soil: SOILS[pick(r.path, 9, SOILS.length)],
        pennant: Boolean(r.branch) && r.branch !== '(detached)' && !isMain(r.branch),
        collision: (snap.collisions ?? []).find(c => c.repo === r.path)?.severity ?? null,
        worktree: r.worktree === true, main: r.main ?? null, // a worktree grows in a greenhouse beside its repo
        prs: r.prs ?? null,
      })),
      farmers: (snap?.agents ?? []).map(a => {
        const pct = contextPct(a.contextTokens);
        return {
          id: a.id, name: a.name, kind: a.kind, cwd: a.cwd ?? null, state: a.state === 'yourTurn' ? 'turn' : a.state, field: fieldOf(a, repos),
          tool: a.now?.tool ?? a.feed?.find(f => f.kind === 'tool')?.tool ?? null, summary: a.now?.summary ?? '',
          step: a.now?.step ?? a.feed?.find(f => f.kind === 'tool')?.step ?? null, // test, push, install… (the collector reads commands)
          pct, hearts: Math.round((1 - pct) * 4), hot: (a.proc?.cpu ?? 0) >= cpuAlertPct,
          ask: askText(a), askKind: a.ask?.kind ?? null, question: a.question ?? null, reply: firstLine(a.lastReply),
          said: spoken((a.feed ?? []).find(f => f.kind === 'reply')?.body ?? (a.feed ?? []).find(f => f.kind === 'reply')?.text), color: colorIndex(a.id), shirt: SHIRT[colorIndex(a.id)], look: lookOf(a), cost: a.usage?.costUsd ?? null, mode: a.mode ?? null,
          kids: (a.children ?? []).filter(c => c.state === 'running' && c.kind !== 'bgjob').slice(0, 4).map(c => ({ id: c.id, dog: c.agentType === 'Explore' })),
          tasks: a.tasks ?? null, compactions: a.compactions ?? 0,
          thinking: a.kind !== 'codex' && a.state === 'working' && (a.turn?.mode ? a.turn.mode === 'thinking' : !a.now), // the working line says thinking (else: between tool calls)
          turn: a.state === 'working' ? a.turn ?? null : null, effort: a.effort ?? null,
          model: a.model ?? null, family: familyOf(a.model), fast: a.fast === true,
          planAsk: a.state === 'waiting' && a.now?.tool === 'ExitPlanMode', // a plan waiting for your approval
          service: a.now?.service ?? null, // where a web or connector call goes
          jobs: (a.children ?? []).filter(c => c.kind === 'bgjob' && c.state === 'running').length, // background commands running
          wakeAt: a.wakeAt ?? null, nap: Boolean(a.wakeAt > now && (a.state === 'yourTurn' || a.state === 'idle') && !a.question), // it comes back by itself (/loop)
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

  // Seasons: the grass, the trees and the flowers (spring blossom, autumn leaves, winter snow).
  // grass: [dark, base, light]; canopy: [outline, shade, leaves, lit leaves].
  const SEASONS = {
    spring: { grass: ['#4f8f3a', '#5d9b46', '#6aa84f'], tuft: '#3f7d3a', blade: '#7fbf5a', shadow: '#3f7d3a', canopy: ['#1c3320', '#2f6b2f', '#3f9b3a', '#6cc04a'], bloom: '#f4b6c2', flowers: ['#ffffff', '#f4b6c2', '#ffd43b', '#e58a8a'] },
    summer: { grass: ['#4f8f3a', '#5d9b46', '#6aa84f'], tuft: '#3f7d3a', blade: '#7fbf5a', shadow: '#3f7d3a', canopy: ['#1c3320', '#264a2a', '#2f6b2f', '#3f9b3a'], flowers: ['#ffffff', '#ffd43b'] },
    autumn: { grass: ['#6b7a35', '#8a8f3a', '#a8a350'], tuft: '#6b7a35', blade: '#c9c45a', shadow: '#6b7a35', canopy: ['#5a1f19', '#9c3b30', '#c8681a', '#e9a23b'], flowers: ['#c8681a'] },
    winter: { grass: ['#c3cbd2', '#dfe9f2', '#f4f8fb'], tuft: '#9aa4ad', blade: '#ffffff', shadow: '#9aa4ad', canopy: ['#1c3320', '#264a2a', '#2f6b2f', '#ffffff'], flowers: [], snow: true },
  };
  /** 0–1023 for a spot, well mixed, the same every build (texture without stripes). */
  const noise = (x, y) => {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x9e37, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) & 1023;
  };
  /** Smooth noise, 0–1, that changes over about s pixels: patches of lighter and darker grass. */
  function vnoise(x, y, s) {
    const gx = Math.floor(x / s), gy = Math.floor(y / s), tx = x / s - gx, ty = y / s - gy;
    const n = (i, j) => noise(gx + i, gy + j + 7919) / 1023, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (n(0, 0) * (1 - sx) + n(1, 0) * sx) * (1 - sy) + (n(0, 1) * (1 - sx) + n(1, 1) * sx) * sy;
  }

  // Shapes for the land. f paints a rectangle; everything is lit from the top left, so shadows fall
  // to the bottom right.
  /** A filled pixel ellipse. */
  function oval(f, cx, cy, rx, ry, c) {
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
      if (half > 0) f(cx - half, cy + dy, half * 2, 1, c);
    }
  }
  /** A round tree seen from above, standing at (x, y): its shadow, a stub of trunk, a leafy crown. */
  function tree(f, x, y, r, S, seed = 0) {
    const [line, dark, mid, lit] = S.canopy, cy = y - 3 - r;
    oval(f, x + Math.round(r * 0.35), y, r, Math.max(2, Math.round(r * 0.4)), S.shadow);
    f(x - 2, y - 5, 4, 5, '#4e3626'); f(x - 2, y - 5, 1, 5, '#6b4320');
    oval(f, x, cy, r + 1, r + 1, line);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + seed; oval(f, Math.round(x + Math.cos(a) * r * 0.7), Math.round(cy + Math.sin(a) * r * 0.7), Math.ceil(r * 0.45) + 1, Math.ceil(r * 0.45) + 1, line); } // a bumpy edge
    oval(f, x, cy, r, r, dark);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + seed; oval(f, Math.round(x + Math.cos(a) * r * 0.7), Math.round(cy + Math.sin(a) * r * 0.7), Math.ceil(r * 0.45), Math.ceil(r * 0.45), dark); }
    oval(f, x - 1, cy - 1, Math.round(r * 0.8), Math.round(r * 0.8), mid);
    oval(f, x - Math.round(r * 0.3), cy - Math.round(r * 0.35), Math.round(r * 0.45), Math.round(r * 0.4), lit);
    for (let i = 0; i < r; i++) { const n = noise(x * 7 + i, y + seed * 99); f(x - r + (n % (2 * r)), cy - r + ((n >> 4) % (2 * r)), 1, 1, n & 1 ? dark : lit); } // leaves
    if (S.snow) { oval(f, x - 1, cy - Math.round(r * 0.45), Math.round(r * 0.7), Math.max(1, Math.round(r * 0.3)), '#ffffff'); }
  }
  /** A bush: a small crown without a trunk; now and then with berries or flowers. */
  function bush(f, x, y, r, S, berry) {
    const [line, dark, mid, lit] = S.canopy;
    oval(f, x + 2, y + 1, r + 1, Math.max(1, r >> 1), S.shadow);
    oval(f, x, y - r, r + 1, r + 1, line); oval(f, x, y - r, r, r, dark); oval(f, x - 1, y - r - 1, Math.max(1, r - 2), Math.max(1, r - 2), mid);
    f(x - Math.round(r / 2), y - r - Math.round(r / 2), 2, 1, lit);
    if (S.snow) f(x - r + 1, y - 2 * r, 2 * r - 2, 2, '#ffffff');
    else if (berry) for (const [dx, dy] of [[-2, -1], [2, 0], [0, 2]]) f(x + dx, y - r + dy, 1, 1, berry);
  }
  /** A stone: grey, lit on top, its shadow under it. */
  function stone(f, x, y, s) {
    oval(f, x + 1, y + 1, s + 1, Math.max(1, s >> 1), '#3f7d3a');
    oval(f, x, y - (s >> 1), s, Math.max(1, Math.round(s * 0.7)), '#5f6b7a');
    oval(f, x - 1, y - (s >> 1) - 1, Math.max(1, s - 1), Math.max(1, Math.round(s * 0.45)), '#8a8f96');
    f(x - Math.round(s / 2), y - s, 1, 1, '#c3cbd2');
  }
  /** A dirt path: packed earth with ragged edges, pebbles and wheel marks. */
  function dirt(f, x, y, w, h, vertical = false) {
    f(x, y, w, h, '#b08850');
    for (let i = 0; i < (vertical ? h : w); i++) { // ragged edges: grass bites into the path here and there
      const n = noise(x + i * 3, y + i * 5);
      if (vertical) { if (n < 300) f(x, y + i, 1, 1, '#9a7442'); if (n > 760) f(x + w - 1, y + i, 1, 1, '#9a7442'); if (n % 7 === 0) f(x - 1, y + i, 1, 1, '#b08850'); }
      else { if (n < 300) f(x + i, y, 1, 1, '#9a7442'); if (n > 760) f(x + i, y + h - 1, 1, 1, '#8a7140'); if (n % 7 === 0) f(x + i, y - 1, 1, 1, '#b08850'); }
    }
    for (let yy = y + 1; yy < y + h - 1; yy += 2) for (let xx = x + 1; xx < x + w - 1; xx += 2) {
      const n = noise(xx * 3, yy * 7);
      if (n < 70) f(xx, yy, 1, 1, '#c9a46a'); else if (n < 100) f(xx, yy, 1, 1, '#9a7442'); else if (n < 108) f(xx, yy, 2, 1, '#8a8f96');
    }
  }
  /** A wooden fence running across at y (its feet), from x0 to x1: posts and two rails. */
  function fenceAcross(f, x0, x1, y, gaps = []) {
    const open = x => gaps.some(([a, b]) => x >= a && x < b);
    for (let x = x0; x < x1; x++) if (!open(x)) { f(x, y - 6, 1, 1, '#c98d4f'); f(x, y - 5, 1, 1, '#6b4320'); f(x, y - 3, 1, 1, '#a8703c'); f(x, y - 2, 1, 1, '#6b4320'); f(x, y, 1, 1, '#3f7d3a'); }
    for (let x = x0; x <= x1 - 2; x += 8) if (!open(x) && !open(x + 1)) { f(x, y - 8, 2, 8, '#8b5a2b'); f(x, y - 8, 2, 1, '#e2b07a'); f(x + 1, y - 7, 1, 7, '#6b4320'); }
  }
  /** A wooden fence running down at x, from y0 to y1 (seen from above: a rail on a row of posts). */
  function fenceDown(f, x, y0, y1, gaps = []) {
    const open = y => gaps.some(([a, b]) => y >= a && y < b);
    for (let y = y0; y < y1; y++) if (!open(y)) { f(x, y - 6, 2, 1, '#a8703c'); f(x + 2, y - 5, 1, 1, '#3f7d3a'); }
    for (let y = y0; y <= y1; y += 8) if (!open(y)) { f(x, y - 8, 2, 8, '#8b5a2b'); f(x, y - 8, 2, 1, '#e2b07a'); f(x + 1, y - 7, 1, 7, '#6b4320'); f(x + 2, y - 2, 1, 2, '#3f7d3a'); }
  }
  /** A pitched roof seen from the front and above: shingle rows, lit near the ridge, dark at the eaves. */
  function shingles(f, x, y, w, h, inset, [line, dark, base, lit]) {
    for (let j = 0; j < h; j++) {
      const d = Math.round(((h - 1 - j) * inset) / Math.max(1, h - 1)), xx = x + d, ww = w - 2 * d;
      f(xx, y + j, ww, 1, j === 0 ? line : j < 3 ? lit : j % 4 === 3 ? dark : base);
      if (j % 4 === 1 && j > 2) for (let k = xx + ((j >> 2) % 2) * 3 + 2; k < xx + ww - 1; k += 6) f(k, y + j, 1, 2, dark); // shingle joints, staggered
    }
    f(x, y + h, w, 1, line); f(x + 1, y + h + 1, w - 2, 1, dark); // the eave and its shadow
  }

  /**
   * The land: everything that does not move, drawn once (and again when the season turns or the
   * frame grows): grass, the forest round the farm, paths, fences, buildings, the pond.
   */
  function drawLand(f, L, season = 'summer', ext = { x0: 0, x1: W, y0: 0, y1: L.H }) {
    const { H, ST, PORCH_Y, LANE, GRID } = L, S = SEASONS[season] ?? SEASONS.summer, { x0, x1, y0, y1 } = ext;
    // grass: soft patches of three greens, tufts, a few flowers, stones and mushrooms
    for (let y = y0 - (y0 & 1); y < y1; y += 2) for (let x = x0 - (x0 & 1); x < x1; x += 2) {
      const v = vnoise(x, y, 22) + (noise(x, y) / 1023 - 0.5) * 0.2;
      f(x, y, 2, 2, v < 0.36 ? S.grass[0] : v < 0.68 ? S.grass[1] : S.grass[2]);
    }
    for (let y = y0 + 2; y < y1 - 2; y += 5) for (let x = x0 + 2; x < x1 - 2; x += 6) {
      const n = noise(x + 7, y + 3), jx = x + (n % 4), jy = y + ((n >> 2) % 3);
      if (n < 150) { f(jx, jy, 1, 2, S.tuft); f(jx + 2, jy, 1, 2, S.tuft); f(jx + 1, jy + 1, 1, 2, S.tuft); }
      else if (n < 200) f(jx, jy, 1, 1, S.blade);
      else if (n < 212 && S.flowers.length) { f(jx, jy + 1, 1, 1, S.tuft); f(jx, jy, 1, 1, S.flowers[n % S.flowers.length]); }
      else if (n < 215 && !S.snow) { f(jx, jy, 3, 1, '#e04a3a'); f(jx + 1, jy, 1, 1, '#ffffff'); f(jx + 1, jy + 1, 1, 1, '#f4ecd8'); } // a mushroom
    }
    // the forest all round: big round trees just past the farm's edges, thicker further out
    const trees = [];
    for (let gy = Math.floor((y0 - 20) / 18); gy * 18 < y1 + 24; gy++) for (let gx = Math.floor((x0 - 24) / 20); gx * 20 < x1 + 24; gx++) {
      const n = noise(gx * 31, gy * 17), x = gx * 20 + (n % 13) - 6 + (gy % 2) * 10, y = gy * 18 + ((n >> 4) % 9);
      if (!(x < -4 || x > W + 4 || y <= 12 || y >= H + 22 || (x < 22 && y < 84))) continue; // never on the farm itself (but in its top left corner)
      if (x < x0 - 30 || x > x1 + 30 || y < y0 - 10 || y > y1 + 34) continue;
      trees.push([x, y, 9 + ((n >> 6) % 5), n]);
    }
    trees.sort((a, b) => a[1] - b[1]).forEach(([x, y, r, n]) => (n % 5 === 0 ? bush(f, x, y, 5, S, null) : tree(f, x, y, r, S, n % 7)));
    // the main lane in front of the buildings, the path down the yard, and the walkways between the fields
    dirt(f, x0, LANE - 5, x1 - x0, 10);
    dirt(f, 111, LANE, 10, GRID.y1 - LANE, true);
    for (const c of CORR.slice(1)) dirt(f, c - 6, GRID.y0 - 2, 12, GRID.y1 - GRID.y0 - 2, true);
    // the fields' fence, with gates onto the lane and the yard
    const lanes = [...new Set(L.slots.map(s => s.lane))];
    fenceAcross(f, GRID.x0, GRID.x1 + 2, GRID.y0, CORR.slice(1).map(c => [c - 7, c + 7]));
    fenceAcross(f, GRID.x0, GRID.x1 + 2, GRID.y1);
    fenceDown(f, GRID.x0, GRID.y0, GRID.y1, lanes.map(y => [y - 4, y + 5]));
    fenceDown(f, GRID.x1, GRID.y0, GRID.y1);
    // empty beds waiting for a repo; each project's beds edged with stones, under its sign
    for (const s of L.empty) bed(f, s, '#6b4320', '#7a5230', S.snow);
    for (const g of L.groups) for (const [r, cols] of rowsOfGroup(g)) {
      const top = 100 + r * ROWH, gx0 = 174 + Math.min(...cols) * COLW - 43, gx1 = 174 + Math.max(...cols) * COLW + 43;
      for (let x = gx0; x <= gx1; x += 3) { f(x, top + 1, 2, 1, '#c3cbd2'); f(x, top + 59, 2, 1, '#c3cbd2'); f(x, top + 2, 2, 1, '#8a8f96'); f(x, top + 60, 2, 1, '#8a8f96'); }
      for (let y = top + 1; y <= top + 60; y += 3) { f(gx0, y, 1, 2, '#c3cbd2'); f(gx1, y, 1, 2, '#c3cbd2'); }
    }
    // the barn, top left: new farmers walk out of its big door; a lamp over the door glows at night
    barn(f, 36, 14, S);
    silo(f, 92, 6, S);
    house(f, 132, 10, S, PORCH_Y);
    // the scarecrow patch, top right: dry stubble behind a low fence; the market stall beside it, the notice board by the porch
    f(316, 30, 80, PORCH_Y - 26, '#8a7140'); f(316, 30, 80, 1, '#6d5830');
    for (let y = 33; y < PORCH_Y + 2; y += 4) for (let x = 319 + (y % 8 ? 2 : 0); x < 394; x += 5) { f(x, y, 1, 2, S.snow ? '#dfe9f2' : '#6d5830'); f(x + 1, y + 1, 1, 1, S.snow ? '#ffffff' : '#c9a46a'); }
    fenceAcross(f, 314, 398, 30);
    hay(f, 386, 44);
    stall(f, STALL.x, STALL.y, S);
    noticeBoard(f, BOARD.x, BOARD.y, S);
    // the yard: the henhouse and its run, the meadow, the pond, bushes and stones
    henhouse(f, 8, 98, S);
    for (let y = 140; y < 190; y += 3) for (let x = 8 + (y % 6); x < 104; x += 5) { const n = noise(x, y); if (n < 260) { f(x, y, 1, 2, S.tuft); if (S.flowers.length && n < 90) f(x, y - 1, 1, 1, S.flowers[n % S.flowers.length]); } } // the meadow's long grass and flowers
    pond(f, 42, 210, S);
    for (const [x, y] of NAPS) hammock(f, x, y, S);
    for (let r = 3; r < L.rows; r++) for (const [x, dy] of [[30, 20], [88, 34]]) tree(f, x, 100 + r * ROWH + dy - 62, 10, S, r + x); // more rows: an orchard in the yard
    shadeTree(f, 66, GRID.y1 - 18, S, season);
    for (const [x, y, r] of [[100, 136, 4], [92, 188, 3]]) bush(f, x, y, r, S, season === 'summer' ? '#e04a3a' : null);
    for (const [x, y, s] of [[96, GRID.y1 - 22, 2], [6, GRID.y1 - 16, 3]]) stone(f, x, y, s);
    // the bottom edge: a strip of meadow, then the forest
    for (let x = 4; x < W - 4; x += 9) { const n = noise(x, 999); if (n < 300) f(x, H - 6 + (n % 3), 1, 2, S.tuft); }
  }
  /** A project's beds, row by row: [[row, [columns]]]. */
  function rowsOfGroup(g) {
    const rows = new Map();
    for (const i of g.slots) rows.set(Math.floor(i / 3), [...(rows.get(Math.floor(i / 3)) ?? []), i % 3]);
    return [...rows];
  }
  /** The market stall by the lane: a striped awning over a counter; crates for open pull requests go on it each frame. */
  function stall(f, X, Y, S) {
    f(X + 28, Y + 8, 3, 28, S.shadow);
    f(X + 1, Y + 6, 2, 28, '#6b4320'); f(X + 25, Y + 6, 2, 28, '#6b4320');
    for (let i = 0; i < 7; i++) { f(X - 1 + i * 4, Y, 4, 6, i % 2 ? '#f4ecd8' : '#e04a3a'); f(X + i * 4, Y + 6, 2, 1, i % 2 ? '#f4ecd8' : '#b23a2e'); }
    f(X - 1, Y - 1, 29, 1, '#9c3b30');
    f(X - 1, Y + 22, 30, 3, '#a8703c'); f(X - 1, Y + 22, 30, 1, '#c98d4f');
    f(X, Y + 25, 28, 9, '#8b5a2b'); for (let x = X + 3; x < X + 28; x += 5) f(x, Y + 25, 1, 9, '#6b4320'); f(X, Y + 33, 28, 1, '#4e3626');
    if (S.snow) f(X - 1, Y - 1, 29, 2, '#ffffff');
  }
  /** The notice board by the porch: pinned notes (what the farm remembers). */
  function noticeBoard(f, X, Y, S) {
    f(X + 14, Y + 4, 2, 18, S.shadow);
    f(X + 1, Y + 9, 2, 13, '#6b4320'); f(X + 10, Y + 9, 2, 13, '#6b4320');
    f(X - 2, Y - 3, 17, 2, '#6b2a22'); f(X - 1, Y - 1, 15, 11, '#4e3626'); f(X, Y, 13, 9, '#a8703c');
    f(X + 1, Y + 1, 5, 4, '#f4ecd8'); f(X + 7, Y + 1, 5, 5, '#fff4d6'); f(X + 2, Y + 5, 4, 3, '#e8d8b0');
    f(X + 2, Y + 3, 3, 1, '#c9b48a'); f(X + 8, Y + 3, 3, 1, '#c9b48a'); f(X + 8, Y + 5, 2, 1, '#c9b48a');
    f(X + 3, Y + 1, 1, 1, '#e04a3a'); f(X + 9, Y + 1, 1, 1, '#3d7be0');
    if (S.snow) f(X - 2, Y - 4, 17, 1, '#ffffff');
  }
  /** A hammock between two posts, for a session napping until its wake-up. */
  function hammock(f, cx, y, S) {
    oval(f, cx, y + 1, 10, 1, S.shadow);
    for (const x of [cx - 13, cx + 12]) { f(x, y - 11, 2, 12, '#6b4320'); f(x, y - 11, 2, 1, '#a8703c'); }
    for (let i = 0; i < 25; i++) {
      const x = cx - 12 + i, sag = Math.round(Math.sin((i / 24) * Math.PI) * 4);
      if (i < 3 || i > 21) f(x, y - 9 + sag, 1, 1, '#c9b48a');
      else { f(x, y - 9 + sag, 1, 1, '#d55181'); f(x, y - 8 + sag, 1, 1, '#8a5fc0'); }
    }
  }
  /** The shade tree, bottom left, where idle farmers nap: blossom in spring, apples in summer, orange in autumn, bare and snowy in winter. */
  function shadeTree(f, x, y, S, season) {
    if (S.snow) {
      oval(f, x + 6, y + 1, 18, 4, S.shadow);
      f(x - 3, y - 28, 6, 28, '#4e3626'); f(x - 3, y - 28, 2, 28, '#6b4320');
      for (const [bx, by, w] of [[-22, -30, 20], [3, -34, 22], [-14, -42, 12], [4, -22, 16]]) { f(x + bx, y + by, w, 2, '#4e3626'); f(x + bx + 1, y + by - 1, w - 2, 1, '#ffffff'); }
      return;
    }
    f(x - 3, y - 8, 6, 8, '#4e3626'); f(x - 3, y - 8, 2, 8, '#6b4320');
    tree(f, x, y, 21, S, 3);
    const fruit = season === 'spring' ? S.bloom : season === 'autumn' ? '#e9a23b' : '#e04a3a';
    for (const [dx, dy] of [[-10, -30], [8, -38], [-4, -16], [12, -24], [-14, -40], [2, -28]]) { f(x + dx, y + dy, 2, 2, fruit); f(x + dx, y + dy, 1, 1, '#fff4d6'); }
  }
  /** A raised bed for a field, at its slot: a wooden frame round the soil, its front face in shade. */
  function bed(f, s, frame, soil, frost) {
    const { x0, y0 } = s, furrow = shade(soil, 0.77), ridge = shade(soil, 1.15);
    f(x0 - 3, y0 - 3, 78, 41, '#2a1d14'); // outline
    f(x0 - 2, y0 - 2, 76, 38, frame); f(x0 - 2, y0 - 2, 76, 1, shade(frame, 1.25)); f(x0 - 2, y0 + 34, 76, 3, shade(frame, 0.72)); f(x0 - 2, y0 + 36, 76, 1, '#2a1d14');
    f(x0 + 74, y0, 2, 37, '#3f7d3a'); f(x0, y0 + 38, 74, 2, '#3f7d3a'); // its shadow
    f(x0, y0, 72, 34, soil); f(x0, y0, 72, 1, furrow);
    for (let k = 0; k < 4; k++) { const fy = y0 + 4 + k * 8; f(x0 + 2, fy - 1, 68, 1, ridge); f(x0 + 2, fy, 68, 2, furrow); f(x0 + 2, fy + 2, 68, 1, shade(soil, 0.9)); } // lit ridge, dark furrow
    for (let n = 0; n < 20; n++) { const sx = x0 + 2 + noise(n, s.cx) % 68, sy = y0 + 2 + noise(s.cx, n) % 30; f(sx, sy, 1, 1, n % 2 ? ridge : furrow); } // clods
    if (frost) for (let k = 0; k < 4; k++) f(x0 + 2, y0 + 3 + k * 8, 68, 1, '#f4f8fb'); // frost on bare soil
  }
  function hay(f, x, y) { f(x - 5, y - 4, 10, 6, '#c9a24a'); f(x - 5, y - 4, 10, 1, '#f4d58d'); f(x - 2, y - 4, 1, 6, '#a8703c'); f(x + 2, y - 4, 1, 6, '#a8703c'); f(x - 4, y + 2, 10, 1, '#3f7d3a'); }
  /** The barn: a red front gable with white trim, its roof behind, a big door with a white X. */
  function barn(f, X, Y, S) {
    const W2 = 52, red = '#b23a2e', plank = '#9c3b30', trim = '#f4ecd8';
    f(X + W2, Y + 18, 4, 50, S.shadow); f(X + 3, Y + 66, W2, 3, S.shadow); // shadow
    shingles(f, X - 1, Y, W2 + 2, 22, 0, ['#2a1d14', '#5a1f19', '#6b2a22', '#9c3b30']); // the roof going back
    f(X + 25, Y, 2, 22, '#5a1f19');
    for (let j = 0; j <= 14; j++) { const half = Math.round((j * 25) / 14), y = Y + 10 + j; f(X + 26 - half, y, half * 2, 1, red); f(X + 25 - half, y, 2, 1, trim); f(X + 25 + half, y, 2, 1, trim); } // the gable
    f(X + 1, Y + 24, W2 - 2, 42, red);
    for (let x = X + 4; x < X + W2 - 2; x += 4) f(x, Y + 26, 1, 40, plank);
    f(X + 1, Y + 24, W2 - 2, 2, trim); f(X + 1, Y + 24, 2, 42, trim); f(X + W2 - 3, Y + 24, 2, 42, trim); f(X + W2 - 1, Y + 24, 1, 42, '#5a1f19');
    f(X + 21, Y + 13, 10, 8, trim); f(X + 22, Y + 14, 8, 6, '#5a1f19'); f(X + 23, Y + 18, 6, 2, '#e9c46a'); // the hay loft
    const dx = X + 14, dy = Y + 38;
    f(dx - 2, dy - 2, 28, 30, trim); f(dx, dy, 24, 28, '#6b2a22');
    for (const lx of [dx, dx + 12]) for (let t = 0; t < 28; t++) { const k = Math.round((t * 11) / 27); f(lx + k, dy + t, 1, 1, trim); f(lx + 11 - k, dy + t, 1, 1, trim); } // the X braces
    f(dx + 11, dy, 2, 28, trim); f(dx, dy, 24, 1, '#5a1f19');
    f(X + 24, Y + 31, 4, 3, '#3a3a40'); f(X + 25, Y + 33, 2, 1, '#ffd43b'); // the lamp
    if (S.snow) { f(X - 1, Y, W2 + 2, 3, '#ffffff'); for (let j = 0; j <= 14; j += 2) f(X + 24 - Math.round((j * 25) / 14), Y + 9 + j, 3, 1, '#ffffff'); }
  }
  /** The silo: a metal cylinder with a red dome; the grain gauge in its front is drawn every frame. */
  function silo(f, X, Y, S) {
    f(X + 20, Y + 16, 4, 58, S.shadow); f(X + 2, Y + 74, 20, 2, S.shadow);
    f(X - 1, Y + 10, 22, 64, '#3a3a40'); f(X, Y + 10, 20, 64, '#9aa4ad'); f(X, Y + 10, 4, 64, '#c3cbd2'); f(X + 1, Y + 10, 1, 64, '#e6eef5'); f(X + 15, Y + 10, 5, 64, '#8a8f96'); f(X + 18, Y + 10, 2, 64, '#5f6b7a');
    for (let y = Y + 16; y < Y + 72; y += 9) f(X, y, 20, 1, '#5f6b7a');
    for (let j = 0; j < 11; j++) { const half = Math.round(10 * Math.sqrt(1 - ((10 - j) / 10.5) ** 2)); f(X + 10 - half - 1, Y + j, half * 2 + 2, 1, '#5a1f19'); f(X + 10 - half, Y + j, half * 2, 1, j < 3 ? '#e04a3a' : '#b23a2e'); f(X + 10 + half - 4, Y + j, Math.min(4, half), 1, '#9c3b30'); }
    if (S.snow) f(X + 3, Y, 14, 3, '#ffffff');
    f(X + 6, Y + 20, 8, 48, '#3a3a40'); f(X + 5, Y + 19, 10, 1, '#5f6b7a'); // the gauge's window
    f(X + 2, Y + 70, 16, 4, '#5f6b7a');
  }
  /** The farmhouse, top middle: a shingled roof, cream walls, lit windows, the porch in front. */
  function house(f, X, Y, S, PORCH_Y) {
    const W2 = 136, wallY = Y + 32;
    f(X + W2, Y + 10, 4, PORCH_Y - Y - 2, S.shadow); f(X + 2, PORCH_Y + 4, W2, 2, S.shadow); // shadow
    shingles(f, X, Y, W2, 30, 9, ['#2a1d14', '#5a1f19', '#9c3b30', '#b23a2e']);
    f(X + 104, Y + 4, 10, 16, '#5a1f19'); f(X + 105, Y + 4, 8, 15, '#9c3b30'); f(X + 105, Y + 4, 2, 15, '#b23a2e'); for (let y = Y + 7; y < Y + 18; y += 3) f(X + 105, y, 8, 1, '#6b2a22'); f(X + 103, Y + 2, 12, 3, '#3a3a40'); f(X + 114, Y + 8, 2, 12, '#6b2a22'); // the chimney
    if (S.snow) for (let j = 0; j < 8; j++) { const d = Math.round(((29 - j) * 9) / 29); f(X + d, Y + j, W2 - 2 * d, 1, j < 6 ? '#ffffff' : '#e6eef5'); }
    f(X + 4, wallY, W2 - 8, PORCH_Y - wallY - 10, '#e8d8b0');
    for (let y = wallY + 3; y < PORCH_Y - 10; y += 3) f(X + 4, y, W2 - 8, 1, '#d4c294');
    f(X + 4, wallY, W2 - 8, 2, '#c9b48a'); f(X + 4, wallY, 2, PORCH_Y - wallY - 10, '#f4ecd8'); f(X + W2 - 6, wallY, 2, PORCH_Y - wallY - 10, '#c9b48a');
    for (const wx of [X + 16, X + 100]) { // windows, shutters, a flower box
      f(wx - 4, wallY + 4, 3, 14, '#2f6b2f'); f(wx + 21, wallY + 4, 3, 14, '#2f6b2f');
      f(wx - 1, wallY + 3, 22, 16, '#6b4320'); f(wx, wallY + 4, 20, 14, '#5ab4ff'); f(wx + 1, wallY + 5, 7, 2, '#a9dcf7'); f(wx + 10, wallY + 4, 1, 14, '#6b4320'); f(wx, wallY + 10, 20, 1, '#6b4320');
      f(wx - 1, wallY + 19, 22, 3, '#8b5a2b'); for (let i = 0; i < 5; i++) f(wx + 1 + i * 4, wallY + 18, 2, 1, S.flowers[i % Math.max(1, S.flowers.length)] ?? '#6b8f4a');
    }
    f(X + 59, wallY + 3, 18, PORCH_Y - wallY - 13, '#6b4320'); f(X + 61, wallY + 5, 14, PORCH_Y - wallY - 15, '#8b5a2b'); f(X + 63, wallY + 7, 4, 6, '#7a5230'); f(X + 69, wallY + 7, 4, 6, '#7a5230'); f(X + 72, wallY + 14, 2, 2, '#f0b429'); // the door
    f(X + 80, wallY + 6, 4, 4, '#3a3a40'); f(X + 81, wallY + 7, 2, 2, '#ffd43b'); // the porch lamp
    // the porch: planks seen from above, its front edge, the steps down to the lane
    f(X - 4, PORCH_Y - 10, W2 + 8, 12, '#a8703c'); f(X - 4, PORCH_Y - 10, W2 + 8, 1, '#6b4320');
    for (let x = X - 1; x < X + W2 + 4; x += 6) f(x, PORCH_Y - 9, 1, 11, '#8b5a2b');
    f(X - 4, PORCH_Y + 1, W2 + 8, 1, '#c98d4f'); f(X - 4, PORCH_Y + 2, W2 + 8, 3, '#6b4320'); f(X - 4, PORCH_Y + 5, W2 + 8, 1, '#2a1d14');
    f(X + 58, PORCH_Y + 5, 20, 3, '#8b5a2b'); f(X + 58, PORCH_Y + 5, 20, 1, '#c98d4f'); f(X + 58, PORCH_Y + 8, 20, 1, '#4e3626');
  }
  /** The henhouse and its run: a little coop, a ramp, a fence; hens and eggs are drawn every frame. */
  function henhouse(f, X, Y, S) {
    f(X + 32, Y + 10, 3, 24, S.shadow);
    shingles(f, X, Y, 32, 12, 3, ['#2a1d14', '#5a1f19', '#9c3b30', '#b23a2e']);
    if (S.snow) f(X + 2, Y, 28, 3, '#ffffff');
    f(X + 2, Y + 13, 28, 18, '#c98d4f'); for (let y = Y + 16; y < Y + 31; y += 3) f(X + 2, y, 28, 1, '#a8703c'); f(X + 2, Y + 13, 2, 18, '#e2b07a');
    f(X + 12, Y + 19, 8, 12, '#2a1d14'); f(X + 5, Y + 17, 5, 4, '#2a1d14'); f(X + 23, Y + 17, 5, 4, '#2a1d14'); // door, windows
    f(X + 13, Y + 31, 6, 4, '#8b5a2b'); f(X + 13, Y + 32, 6, 1, '#6b4320'); f(X + 13, Y + 34, 6, 1, '#6b4320'); // ramp
    f(X + 2, Y + 31, 30, 1, '#4e3626');
    fenceAcross(f, X + 36, X + 92, Y + 6); fenceAcross(f, X + 36, X + 92, Y + 36); fenceDown(f, X + 90, Y + 6, Y + 36);
    for (let i = 0; i < 6; i++) f(X + 40 + noise(i, 5) % 46, Y + 12 + noise(5, i) % 20, 1, 1, '#c9a46a'); // scattered grain
  }
  /** The pond: a sandy bank, deep water at the edge, sky reflected in the middle, lily pads and reeds. */
  function pond(f, cx, cy, S) {
    oval(f, cx + 1, cy + 1, 34, 16, '#9a7442'); oval(f, cx, cy, 34, 15, '#c9a46a');
    const deep = S.snow ? '#9aa4ad' : '#2c4a85', water = S.snow ? '#c3cbd2' : '#3d7be0', lit = S.snow ? '#e6eef5' : '#5ab4ff';
    oval(f, cx, cy, 31, 13, deep); oval(f, cx + 1, cy + 1, 29, 11, water);
    oval(f, cx - 6, cy - 3, 12, 3, lit); f(cx + 8, cy + 4, 9, 1, lit); f(cx - 18, cy + 3, 5, 1, lit);
    if (!S.snow) { oval(f, cx + 16, cy + 5, 3, 2, '#3f9b3a'); f(cx + 16, cy + 4, 1, 1, '#6cc04a'); oval(f, cx - 14, cy + 6, 2, 1, '#3f9b3a'); f(cx - 15, cy + 5, 1, 1, '#ffffff'); } // lily pads, a flower
    for (const [rx, h] of [[cx - 33, 7], [cx - 30, 9], [cx + 31, 8], [cx + 34, 6]]) { f(rx, cy - h + 2, 1, h, '#6b8f4a'); f(rx, cy - h, 1, 2, '#6b4320'); } // reeds
    for (const [sx, sy] of [[cx - 22, cy - 14], [cx + 26, cy - 11], [cx + 12, cy + 15]]) stone(f, sx, sy, 2);
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

  /* ---------- layout: buildings along the top, the yard down the left, the fields in a fenced grid ---------- */

  // Fixed: the grid always has nine beds, and the ones no repo uses lie empty, so the farm keeps its
  // shape (and its size on screen) as repos come and go.
  const W = 400, MAX_FIELDS = 18, COLW = 88, ROWH = 62, MIN_ROWS = 3, MAX_ROWS = 6;
  const PORCH_Y = 78, LANE = 87; // where farmers stand on the porch (and among the scarecrows); the lane in front of the buildings
  const CORR = [116, 218, 306]; // paths running down: the yard's, then the walkways between field columns
  const BARN_DOOR = [62, LANE];
  const MEADOW = [[28, 162], [74, 166], [40, 186], [86, 186]]; // where farmers working outside any repo stand
  const NAPS = [[97, 204], [97, 224]]; // hammocks by the pond: sessions that will wake up by themselves (/loop)
  const STALL = { x: 284, y: 48 }, BOARD = { x: 113, y: 62 }; // the market stall (pull requests), the notice board (memory)
  const slotAt = i => { const cx = 174 + (i % 3) * COLW, rowTop = 100 + Math.floor(i / 3) * ROWH; return { i, cx, rowTop, lane: rowTop + 44, x0: cx - 36, y0: rowTop + 12 }; };
  // A project is the folder holding sibling repos (like pmt/backend and pmt/frontend); a home folder or
  // a catch-all one like ~/code holds unrelated repos, so it is none.
  const CATCH_ALL = new Set(['code', 'projects', 'repos', 'src', 'dev', 'work', 'tools', 'github', 'git', 'documents', 'desktop', 'downloads', 'workspace', 'workspaces', 'sites', 'apps', 'clients', 'tmp']);
  function projectOf(path) {
    const parts = String(path).split('/').filter(Boolean).slice(0, -1);
    return parts.length >= 3 && !CATCH_ALL.has(parts.at(-1).toLowerCase()) ? `/${parts.join('/')}` : null;
  }
  /**
   * Which bed each field gets: the repos of one project side by side under its sign (a worktree
   * right after its repo), kept to one row when they fit; beds left between groups lie empty.
   * Returns { slotOf: key → bed number, groups: [{ name, keys }] }.
   */
  function arrange(fields) {
    const byKey = new Map(fields.map(f => [f.key, f]));
    const home = f => (f.worktree && f.main ? f.main : f.key);
    const units = new Map();
    for (const f of fields) {
      const project = projectOf(home(f)), id = project ?? `repo:${home(f)}`;
      if (!units.has(id)) units.set(id, { project, keys: [] });
      units.get(id).keys.push(f.key);
    }
    for (const u of units.values()) { // each repo, then its worktrees
      const order = [];
      for (const k of u.keys) if (!byKey.get(k).worktree) { order.push(k); for (const w of u.keys) if (byKey.get(w).worktree && byKey.get(w).main === k) order.push(w); }
      for (const k of u.keys) if (!order.includes(k)) order.push(k);
      u.keys = order;
      if (u.project && new Set(u.keys.map(k => home(byKey.get(k)))).size < 2) u.project = null; // one repo is no project
    }
    const slotOf = new Map(), queue = [...units.values()];
    let row = 0, col = 0;
    const place = u => { for (const k of u.keys) { slotOf.set(k, row * 3 + col); if (++col === 3) { col = 0; row++; } } };
    while (queue.length) {
      const n = queue[0].keys.length;
      if (col > 0 && (n > 3 || col + n > 3)) { // it does not fit the rest of this row: a smaller one may, else the next row
        const j = queue.findIndex(u => u.keys.length <= 3 - col);
        if (j > 0) place(queue.splice(j, 1)[0]); else { row++; col = 0; }
        continue;
      }
      place(queue.shift());
    }
    return { slotOf, groups: [...units.values()].filter(u => u.project).map(u => ({ name: u.project.split('/').pop(), keys: u.keys })) };
  }
  function layoutFor(fields) {
    const { slotOf, groups } = arrange(fields);
    const shown = fields.filter(f => slotOf.get(f.key) < MAX_FIELDS);
    const last = Math.max(-1, ...shown.map(f => slotOf.get(f.key)));
    const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor(last / 3) + 1));
    const slots = Array.from({ length: rows * 3 }, (_, i) => slotAt(i));
    const ST = shown.map(f => ({ key: f.key, ...slots[slotOf.get(f.key)] }));
    const used = new Set(ST.map(s => s.i));
    const GRID = { x0: 128, x1: 396, y0: 96, y1: 104 + rows * ROWH }; // the fields' fence
    return {
      key: ST.map(s => `${s.key}@${s.i}`).join('\n'), ST, slots, empty: slots.filter(s => !used.has(s.i)), rows, PORCH_Y, LANE, GRID, H: GRID.y1 + 28,
      groups: groups.map(g => ({ name: g.name, slots: g.keys.filter(k => slotOf.get(k) < rows * 3).map(k => slotOf.get(k)) })).filter(g => g.slots.length),
      more: fields.length - shown.length,
    };
  }

  /* ---------- the farm theme: sprites, ground, weather, labels ---------- */

  const K = '#2a1d14';
  // 14×16 farmer, front view, put together from its look. h hat · b hat band · r hair · s skin ·
  // g glasses · p cheeks · C shirt · o overalls · P pole. The eyes are drawn on top (row 6, or 7 looking down).
  const HEADS = {
    straw: ['.....kkkk.....', '....kwwhhk....', '...khhhhhhk...', '..kbbbbbbbbk..', '.khhhhhhhhhhk.'],
    cap: ['..............', '.....kkkk.....', '....kwwhhk....', '...khhhhhhk...', '...kbbbbbbbbk.'],
    beanie: ['......kk......', '.....kbbk.....', '....kwwhhk....', '...khhhhhhk...', '...kbbbbbbk...'],
    bandana: ['..............', '....kkkkkk....', '...kwwhhhhk...', '...khbhhbhkhk.', '...khhhhhhk.h.'],
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
  const HIPS = `...k${'o'.repeat(5)}Ok...`;
  const FRONT_BODY = ['..kCCCCCCCck..', '.kCCoCCCCocck.', '.kCCooooooCck.', '.ks.oooooO.sk.', HIPS];
  const BACK_BODY = ['..kCCCCCCCck..', '.kCCCoCCoCcck.', '.kCCooooooCck.', '.ks.oooooO.sk.', HIPS]; // straps cross on the back
  const SIDE_BODY = ['...kCCCCCck...', '...kCCoCCck...', '...kCoooock...', '...kooooOok...', HIPS];
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
      ? { k: '#3a2a1a', h: '#c9a24a', w: '#e2c27a', b: '#7a5230', r: '#c9a24a', s: '#d8c48a', g: '#d8c48a', p: '#d8c48a', C: '#8b7a55', c: '#6b5a3a', o: '#6b5a3a', O: '#4e3626', P: '#6b4320' }
      : { k: K, h: look.hatColor, w: shade(look.hatColor, 1.3), b: look.band, r: look.hair, s: look.skin, g: '#e6eef5', p: '#e58a8a', C: color, c: shade(color, 0.78), o: look.overalls, O: shade(look.overalls, 0.75), P: '#6b4320' };
    for (const key of Object.keys(pal)) if (!'Cwc'.includes(key)) pal[key] = ink(pal[key]); // one palette; the shirt is the agent's colour, its light and shade made from it
    const c = makeSprite(spriteRows(look, view, legs), pal);
    if (up && view === 'down') { // one arm up, waving
      const g = c.getContext('2d');
      g.clearRect(11, 11, 2, 2); g.fillStyle = color; g.fillRect(12, 5, 1, 6); g.fillStyle = pal.s; g.fillRect(12, 3, 1, 2); g.fillStyle = K; g.fillRect(13, 3, 1, 8);
    }
    sprites.set(key, c);
    return c;
  }

  const ACTIVE = new Set(['waiting', 'working', 'turn']);
  const FAMILY_PIN = { opus: '#8a5fc0', sonnet: '#3d7be0', haiku: '#2fa57a', fable: '#f08a24' };
  // What a farmer does for each kind of step, what it holds, and where it stands in its field
  // (looking things up on the left, working the soil on the right, the rest in the middle).
  const ACTIONS = {
    edit: { prop: 'hoe', verb: 'hoeing the rows', spot: 26 },
    write: { prop: 'seeds', verb: 'planting seeds', spot: 26 },
    read: { prop: 'almanac', verb: 'reading the almanac', spot: -26 },
    search: { prop: 'spyglass', verb: 'scouting the field', spot: -26 },
    web: { prop: 'pigeon', verb: 'sending a pigeon', spot: -26 },
    mcp: { prop: 'parcel', verb: 'sending a parcel to town', spot: -26 },
    skill: { prop: 'recipe', verb: 'following a recipe', spot: 0 },
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
  const BLUEPRINT = { prop: 'blueprint', verb: 'drawing up plans (plan mode)', spot: 0 };
  /** What a farmer does now: its step's tool; in plan mode, a blueprint. */
  const doing = f => (f.mode === 'plan' && f.state === 'working' ? BLUEPRINT : f.step || f.tool ? actionOf(f.step, f.tool) : null);
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
        PXG.lights?.push([rp.ox + 12.5 * SC, rp.oy + 10 * SC, 12, null]); // it lights its farmer at night
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
      case 'parcel': { // a connector: a parcel off to town (its cart goes along the road)
        const up = blink(2);
        rp(10, 9 - up, 6, 5, '#c9a46a'); rp(10, 9 - up, 6, 1, '#e2b07a'); rp(12, 9 - up, 1, 5, '#9c3b30'); rp(10, 11 - up, 6, 1, '#9c3b30'); rp(13, 8 - up, 2, 1, '#9c3b30');
        rp(9, 11, 1, 2, '#e0a878');
        return;
      }
      case 'recipe': { // a skill: reading its recipe card
        rp(3, 9, 8, 6, '#fff4d6'); rp(3, 9, 8, 1, '#e04a3a'); rp(4, 11, 6, 1, '#c9b48a'); rp(4, 13, 4, 1, '#c9b48a');
        if (blink(1.5)) { rp(12, 6, 1, 3, '#ffd43b'); rp(11, 7, 3, 1, '#ffd43b'); } // the knack of it
        return;
      }
      case 'blueprint': { // plan mode: drawing up plans, a pencil moving over the sheet
        rp(1, 9, 11, 6, '#2c4a85'); rp(1, 9, 11, 1, '#3d7be0'); rp(3, 10, 1, 5, '#a9dcf7'); rp(1, 12, 11, 1, '#a9dcf7'); rp(7, 11, 3, 2, '#a9dcf7');
        rp(8 + blink(3) * 2, 7, 1, 3, '#f0b429'); rp(8 + blink(3) * 2, 10, 1, 1, '#1b1420');
        return;
      }
      case 'clipboard': // planning: a chore list being ticked
        rp(1, 9, 5, 6, '#a8703c'); rp(2, 10, 3, 4, '#fff4d6'); rp(3, 9, 1, 1, '#9aa4ad'); rp(2, 11, 3, 1, '#9aa0a6'); rp(2, 13, 2, 1, '#9aa0a6');
        if (blink(2)) rp(4, 13, 1, 1, '#2fa57a');
        rp(11, 9, 1, 3, '#f0b429'); rp(11, 12, 1, 1, '#2a1d14');
        return;
      default:
    }
  }

  /** Where a farmer's cart is on the road while a web or connector call goes on: out to town past the farm's right edge, and back. */
  function cartOf(f) {
    if (f.state !== 'working' || !f.service || (f.step !== 'web' && f.step !== 'mcp')) return null;
    const ph = (PXG.T / 8 + (hashOf(f.id) % 97) / 97) % 1, out = ph < 0.5, t = out ? ph * 2 : (1 - ph) * 2;
    return { x: Math.round(280 + t * 150), dir: out ? 1 : -1 };
  }
  /** How long until a time, in short: 12m, 2h. */
  const until = at => { const m = Math.max(0, (at - Date.now()) / 60_000); return m < 1 ? 'a moment' : m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`; };

  /** For tests and the legend: paints one tool (held by a farmer when `look` is given) or one plant on a 2D context. */
  function paint(ctx, { prop, flag, crop, stage = 0, T = 0, look, face = 'down', legs = 's', land, rows = 1, season }) {
    Object.assign(PXG, { ctx, T, k: 1 });
    if (land) drawLand(px, layoutFor(Array.from({ length: rows * 3 }, (_, i) => ({ key: `f${i}` }))), season);
    if (look) ctx.drawImage(farmerSprite(look, SHIRT[0], false, legs, false, face), 0, 0, 14 * SC, 16 * SC);
    if (prop) drawProp(prop, rpAt(0, 0), T, flag);
    if (crop) drawCrop(crop, 10, 20, stage, 0);
  }

  // Pixel icons for the farm's buttons (9×9): one letter per pixel, '.' clear.
  const ICONS = {
    follow: ['....k....', '..kkkkk..', '.k.....k.', '.k.....k.', 'kk..r..kk', '.k.....k.', '.k.....k.', '..kkkkk..', '....k....'],
    resting: ['.....kkkk', '.......k.', '......k..', '.....kkkk', 'kkkkk....', '...k.....', '..k......', '.k.......', 'kkkkk....'],
    bubbles: ['.........', '.kkkkkkk.', 'kwwwwwwwk', 'kwkwkwkwk', 'kwwwwwwwk', '.kkwkkkk.', '..kk.....', '..k......', '.........'],
    day: ['....y....', '.y.....y.', '...yyy...', '..yyyyy..', 'y.yyyyy.y', '..yyyyy..', '...yyy...', '.y.....y.', '....y....'],
    night: ['...yyy..s', '..yy.....', '.yy......', '.yy...s..', '.yy......', '.yy......', '..yy.....', '...yyy...', '.........'],
    live: ['.........', '...yyy...', '..yyyyy..', '.yyyyyyy.', 'kkkkkkkkk', '.........', '..kkkkk..', '.........', '...kkk...'],
    play: ['..k......', '..kk.....', '..kgk....', '..kggk...', '..kgggk..', '..kggk...', '..kgk....', '..kk.....', '..k......'],
    pause: ['.........', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.........'],
    help: ['..kkkkk..', '.kk...kk.', '......kk.', '....kkk..', '...kk....', '...kk....', '.........', '...kk....', '.........'],
    spring: ['.........', '.gg...gg.', '.ggg.ggg.', '..gg.gg..', '....g....', '....g....', '....g....', '..kkkkk..', '.........'],
    autumn: ['......oo.', '....oooo.', '..ooooo..', '.ooooo...', '.oooo....', '.ooo.....', '.k.......', 'k........', '.........'],
    list: ['.........', 'kk.kkkkkk', '.........', 'kk.kkkkkk', '.........', 'kk.kkkkkk', '.........', '.........', '.........'],
    plus: ['....k....', '....k....', '....k....', 'kkkkkkkkk', '....k....', '....k....', '....k....', '.........', '.........'],
    side: ['kkkkkkkkk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'kkkkkkkkk', '.........', '.........'],
    bell: ['....k....', '...kyk...', '..kyyyk..', '..kyyyk..', '..kyyyk..', '.kyyyyyk.', 'kkkkkkkkk', '...kyk...', '....k....'],
    winter: ['....b....', '.b..b..b.', '..b.b.b..', '...bbb...', 'bbbbbbbbb', '...bbb...', '..b.b.b..', '.b..b..b.', '....b....'],
  };
  // Agentville's mark (the farmhouse, from brand.js), for the farm's panel.
  const brandSvg = () => (typeof window !== 'undefined' && window.Agentville ? window.Agentville.svg({ size: 18, cls: 'px-logo' }) : '');
  const ICON_PAL = { k: '#4e3626', w: '#ffffff', y: '#f0b429', s: '#f4ecd8', r: '#e04a3a', g: '#3f9b3a', o: '#c8681a', b: '#a9dcf7' };
  const iconUrls = new Map();
  /** HTML for one of the farm's pixel icons (none without a DOM). */
  function iconImg(name) {
    if (typeof document === 'undefined' || !ICONS[name]) return '';
    if (!iconUrls.has(name)) iconUrls.set(name, makeSprite(ICONS[name], ICON_PAL).toDataURL());
    return `<i class="px-ico" aria-hidden="true" style="background-image:url(${iconUrls.get(name)})"></i>`;
  }

  function makeFarm() {
    let L = layoutFor([]);
    let seenCompactions = null, seenMerged = null; // what the last scene had, so news can be told
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
      const f = fieldByKey(s.key), { x0, y0 } = s, st = plotState(f), T = PXG.T;
      bed(px, s, f.worktree ? '#9aa4ad' : f.fence ?? '#c98d4f', f.soil ?? '#7a5230', season === 'winter' && st.kind !== 'grow');
      for (let k = 0; k < 4; k++) for (let i = 0; i < 9; i++) {
        const x = x0 + 4 + i * 8, y = y0 + 3 + k * 8;
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
      if (f.worktree) { // a worktree: a greenhouse beside its repo's bed, glazing bars and glints
        PXG.ctx.globalAlpha = 0.2; px(x0 - 2, y0 - 8, 77, 45, '#a9dcf7'); PXG.ctx.globalAlpha = 1;
        for (let x = x0 - 2; x <= x0 + 74; x += 12) px(x, y0 - 8, 1, 45, '#e6eef5');
        px(x0 - 2, y0 - 8, 77, 1, '#ffffff'); px(x0 - 2, y0 + 7, 77, 1, '#c3cbd2'); px(x0 - 3, y0 - 9, 79, 1, '#9aa4ad');
        PXG.ctx.globalAlpha = 0.55; for (let i = 0; i < 5; i++) px(x0 + 4 + i * 12, y0 - 6 + (i % 2) * 2, 4, 1, '#ffffff'); PXG.ctx.globalAlpha = 1;
      }
      seedSign(f.crop ?? 'wheat', x0 - 8, y0 + 12); // what this field grows, even while it lies fallow
      if (f.pennant) { // a branch other than main: a pennant on the bed's corner
        const fx = x0 + 74, fy = y0 - 8, wave = blink(2);
        px(fx, fy, 1, 15, '#6b4320');
        for (let r = 0; r < 5; r++) px(fx + 1, fy + r, 5 - r - (r === 2 ? wave : 0), 1, r === 0 ? '#a9dcf7' : '#3d7be0');
      }
      if (f.collision) { // two farmers writing one repo: rope with orange flags (faster when a git command is involved)
        PXG.ctx.globalAlpha = 0.7 + 0.3 * Math.sin(T * (f.collision === 'high' ? 14 : 6));
        for (let i = 0; i < 76; i += 4) { const c = (i / 4) % 2 ? '#fff3d6' : '#ff8c42'; px(x0 - 2 + i, y0 - 3, 4, 1, c); px(x0 - 2 + i, y0 + 37, 4, 1, c); }
        for (let i = 0; i < 40; i += 4) { const c = (i / 4) % 2 ? '#fff3d6' : '#ff8c42'; px(x0 - 3, y0 - 3 + i, 1, 4, c); px(x0 + 74, y0 - 3 + i, 1, 4, c); }
        for (const [fx, fy] of [[x0 - 3, y0 - 8], [x0 + 74, y0 - 8]]) { px(fx, fy, 1, 6, '#6b4320'); px(fx + 1, fy, 4, 3, '#ff5a1f'); }
        PXG.ctx.globalAlpha = 1;
      }
    }
    // On each bed's top edge: mailbox = behind the remote, crates = unpushed commits, hay bales = uncommitted files.
    function drawPiles(s) {
      const f = fieldByKey(s.key), y = s.rowTop + 10, cx = s.cx;
      if (f.behind > 0) { px(cx - 40, y - 9, 2, 11, '#6b4320'); px(cx - 44, y - 13, 9, 5, '#5f6b7a'); px(cx - 44, y - 13, 9, 1, '#9aa4ad'); px(cx - 35, y - 17, 1, 6, '#e04a3a'); px(cx - 35, y - 17, 3, 2, '#e04a3a'); }
      for (let i = 0; i < Math.min(4, Math.ceil(f.ahead / 4)); i++) { const x = cx - 30 + (i % 2) * 8, yy = y - 6 - Math.floor(i / 2) * 6; px(x, yy, 7, 6, '#8b5a2b'); px(x, yy, 7, 1, '#c98d4f'); px(x + 3, yy, 1, 6, '#6b4320'); px(x, yy + 6, 7, 1, '#4e3626'); }
      for (let i = 0; i < Math.min(4, Math.ceil(f.dirty / 3)); i++) { const x = cx + 12 + (i % 3) * 9, yy = y - 6 - Math.floor(i / 3) * 6; px(x, yy, 8, 6, '#e9c46a'); px(x, yy, 8, 1, '#f4d58d'); px(x + 2, yy, 1, 6, '#c9a24a'); px(x + 5, yy, 1, 6, '#c9a24a'); px(x, yy + 6, 8, 1, '#8a7140'); }
    }
    function seasonTip() {
      const w = scene.plan?.windows?.find(x => x.kind === 'five_hour');
      return `The season follows your plan's 5-hour limit${w ? `: ${w.reset ? 'just reset' : `${Math.round(w.percentUsed)}% used`}` : ' (no reading yet: summer)'}. Spring while it is fresh, then summer and autumn; winter when it is nearly used up`;
    }
    /** The silo's grain and lamp, the pond's ripples and duck, the henhouse's eggs and hens: each frame. */
    function drawScenery() {
      const T = PXG.T, silo = siloOf(scene.plan);
      if (silo) {
        const h = Math.round(46 * silo.fill);
        if (h) { px(99, 73 - h, 6, h, '#e9c46a'); px(99, 73 - h, 6, 1, '#f4d58d'); }
        for (const t of [0.25, 0.5, 0.75]) px(105, 73 - Math.round(46 * t), 1, 1, '#c3cbd2');
        if (silo.lamp && (silo.lamp === 'amber' || blink(2))) { px(100, 3, 4, 3, silo.lamp === 'red' ? '#e04a3a' : '#f0b429'); PXG.lights?.push([102, 6, 8, [100, 3, 4, 3]]); }
      }
      if (season !== 'winter') { // ripples, and a duck paddling round the pond
        for (let i = 0; i < 2; i++) { const ph = (T * 0.5 + i * 0.5) % 1, r = Math.round(ph * 6); PXG.ctx.globalAlpha = 0.6 * (1 - ph); px(30 - r, 208 + i * 5, r * 2 + 1, 1, '#a9dcf7'); }
        PXG.ctx.globalAlpha = 1;
        const dx = Math.round(42 + Math.sin(T * 0.25) * 16), face = Math.cos(T * 0.25) > 0 ? 1 : -1, dy = 206;
        px(dx - 1, dy + 3, 7, 1, '#2c4a85'); px(dx, dy, 5, 3, '#ffffff'); px(dx + (face > 0 ? 3 : -1), dy - 2, 3, 3, '#ffffff'); px(dx + (face > 0 ? 6 : -2), dy - 1, 2, 1, '#f08a24'); px(dx + (face > 0 ? 4 : 0), dy - 1, 1, 1, '#1b1420');
      } else if (blink(1.5)) px(36, 206, 2, 1, '#ffffff'); // ice glints
      const eggs = scene.henhouse?.eggs ?? 0, roost = Math.min(3, scene.henhouse?.roosting ?? 0);
      px(4, 132, 12, 3, '#c9a24a'); px(4, 132, 12, 1, '#e9c46a'); // the nest
      for (let i = 0; i < eggs; i++) px(5 + i * 2, 131 - (i % 2), 2, 2, i % 3 ? '#f4ecd8' : '#ffffff');
      // the market stall: a crate on the counter for each open pull request, its tag the checks' colour
      const prs = scene.fields.flatMap(fl => fl.prs?.open ?? []);
      prs.slice(0, 8).forEach((pr, i) => {
        const x = STALL.x + 1 + (i % 4) * 7, y = STALL.y + 16 - Math.floor(i / 4) * 5, tag = pr.draft ? '#9aa4ad' : { ok: '#2fa57a', failed: '#e04a3a', running: blink(2) ? '#f0b429' : '#ffd43b' }[pr.checks] ?? '#e8d8b0';
        px(x, y, 6, 5, '#8b5a2b'); px(x, y, 6, 1, '#c98d4f'); px(x + 2, y, 1, 5, '#6b4320'); px(x + 3, y + 1, 2, 2, tag);
      });
      // pumps by the beds: background commands still running there
      for (const s of L.ST) {
        const jobs = scene.farmers.filter(f => f.field === s.key).reduce((t, f) => t + (f.jobs ?? 0), 0);
        for (let j = 0; j < Math.min(2, jobs); j++) {
          const x = s.x0 - 9 + j * 5, y = s.y0 - 2 + j * 2, up = Math.floor(T * 3 + j) % 2;
          px(x - 1, y + 9, 6, 2, '#5f6b7a'); px(x + 1, y + 1, 3, 9, '#3d7be0'); px(x + 1, y + 1, 1, 9, '#5ab4ff'); px(x + 4, y + 3, 2, 1, '#3d7be0');
          px(x - 2, y - 1 + up * 2, 5, 1, '#9aa4ad'); px(x + 2, y - 1, 1, 2, '#5f6b7a');
          if ((Math.floor(T * 6) + j) % 3) px(x + 5, y + 4 + (Math.floor(T * 6) % 3), 1, 1, '#a9dcf7');
        }
      }
      // the porch cat, curled up at the end of the porch, its tail flicking
      const flick = blink(0.7);
      px(264, 74, 7, 3, '#e9a23b'); px(265, 73, 5, 1, '#e9a23b'); px(270, 72, 3, 3, '#e9a23b'); px(270, 71, 1, 1, '#c8681a'); px(272, 71, 1, 1, '#c8681a'); px(271, 73, 1, 1, '#1b1420');
      px(263, 75 - flick, 1, 2, '#c8681a'); px(266, 74, 1, 3, '#c8681a'); px(264, 77, 8, 1, '#6b4320');
      for (let i = 0; i < roost; i++) { // hens in the run: subagents no farmer can lead
        const hx = 56 + i * 12 + Math.round(Math.sin(T * 0.6 + i * 2) * 4), hy = 122 + (i % 2) * 6, peck = blink(2 + i * 0.3);
        px(hx, hy, 4, 3, '#ffffff'); px(hx + 3, hy - 2 + peck, 2, 2, '#ffffff'); px(hx + 4, hy - 3 + peck, 1, 1, '#e04a3a'); px(hx + 5, hy - 1 + peck, 1, 1, '#f0b429'); px(hx, hy + 3, 1, 1, '#f0b429'); px(hx + 2, hy + 3, 1, 1, '#f0b429');
      }
    }
    // A cloud's shadow: rows of one span, so overlapping puffs don't double the shade.
    function cloudShadow(x, y, r) {
      const puffs = [[0, 0, r, Math.round(r * 0.5)], [Math.round(r * 0.55), -Math.round(r * 0.25), Math.round(r * 0.6), Math.round(r * 0.4)], [-Math.round(r * 0.5), Math.round(r * 0.1), Math.round(r * 0.55), Math.round(r * 0.35)]];
      for (let dy = -r; dy <= r; dy++) {
        let lo = Infinity, hi = -Infinity;
        for (const [ox, oy, rx, ry] of puffs) { const t = (dy - oy) / (ry + 0.5); if (Math.abs(t) > 1) continue; const half = rx * Math.sqrt(1 - t * t); lo = Math.min(lo, ox - half); hi = Math.max(hi, ox + half); }
        if (hi > lo) px(Math.round(x + lo), y + dy, Math.round(hi - lo), 1, '#1c3320');
      }
    }
    const FIREFLIES = [[20, 150], [60, 160], [92, 176], [30, 232], [74, 196], [50, 252], [100, 250], [14, 262], [88, 140], [96, 214], [240, 92], [330, 70]];

    return {
      key: 'farm', SH: 16,
      /** A new scene; returns what happened since the last one: harvests (compactions) and sales (merged pull requests). */
      setScene(next) {
        const events = [];
        const comp = new Map(next.farmers.map(f => [f.id, f.compactions ?? 0]));
        if (seenCompactions) for (const f of next.farmers) if (seenCompactions.has(f.id) && comp.get(f.id) > seenCompactions.get(f.id)) events.push({ id: f.id, text: 'Harvest!', cls: 'good', log: 'brings in the harvest: its conversation was compacted, and it sows again' });
        seenCompactions = comp;
        const merged = next.fields.flatMap(fl => (fl.prs?.merged ?? []).map(m => ({ ...m, repo: fl.name, key: `${fl.key}#${m.number}` })));
        if (seenMerged) for (const m of merged) if (!seenMerged.has(m.key) && (m.at ?? 0) > Date.now() - 30 * 60_000) events.push({ at: [STALL.x + 14, STALL.y + 8], text: `Sold! #${m.number}`, cls: 'good', log: `${m.repo}: pull request #${m.number} merged (${clip(m.title ?? '', 50)})` });
        seenMerged = new Set(merged.map(m => m.key));
        scene = next;
        season = seasonOf(next.plan);
        return events;
      },
      layout: () => L,
      relayout(fields) { L = layoutFor(fields); return L; },
      // Where each farmer stands. Porch, scarecrows, the tree and the meadow hold a few each; the rest show as a "+N" sign.
      slots(f) {
        const s = f.state === 'working' ? stOf(f.field) : null;
        if (s) return { group: `st:${s.key}`, at: used => { const off = [doing(f)?.spot ?? 0, 0, -26, 26, -13, 13].find(o => !used.includes(o)) ?? 0; used.push(off); return [s.cx + off, s.lane]; }, zone: `st:${s.key}:${doing(f)?.prop ?? ''}` };
        if (f.state === 'working') return { group: 'meadow', cap: MEADOW.length, at: i => MEADOW[i], zone: 'meadow' };
        if (f.nap) return { group: 'nap', cap: NAPS.length, at: i => NAPS[i], zone: 'nap' }; // it wakes up by itself: a hammock, not your porch
        if (f.state === 'waiting') return { group: 'desk', cap: 3, at: i => [142 + 24 * i, PORCH_Y], zone: 'desk' }; // the porch: 3 waiting on the left,
        if (f.state === 'turn') return { group: 'turn', cap: 3, at: i => [258 - 24 * i, PORCH_Y], zone: 'turn' }; // 3 with their turn on the right, apart
        if (f.state === 'stale') return { group: 'storage', cap: 4, at: i => [328 + 20 * i, PORCH_Y], zone: 'storage' };
        const y = L.GRID.y1 - 6;
        return { group: 'charge', cap: 4, at: i => [[64, y], [40, y + 2], [88, y + 2], [16, y + 4]][i], zone: 'charge' }; // under the shade tree
      },
      spawn: () => BARN_DOOR,
      follow: (b, k, T, kid) => (kid?.dog
        ? [b.x + Math.cos(T * 0.9 + k) * 30, b.y + 3 + Math.sin(T * 1.8) * 6] // the Explore dog roams and sniffs
        : [b.x + (k % 2 ? 1 : -1) * (7 * SC + 4) + Math.sin(T * 1.3 + k) * 3, b.y + 2 - (k > 1 ? 4 * SC : 0)]),
      startText: n => `Morning: <b>${n}</b> farmer${n === 1 ? '' : 's'} on the farm`,
      arriveText: 'walks out of the barn',
      tag: f => (f.kind === 'codex' ? clip(f.name, 16) : `${clip(f.name, 16)} ${'♥'.repeat(f.hearts)}${'♡'.repeat(4 - f.hearts)}${f.tasks ? ` ${f.tasks.done}/${f.tasks.total}` : ''}`),
      tip: f => {
        const field = fieldByKey(f.field);
        const what = f.state === 'waiting' ? `needs you: ${f.ask}` : f.state === 'turn' ? (f.question ? `asks you: ${f.question}` : `your turn: ${f.reply || 'finished'}`)
          : f.state === 'working' ? `${doing(f)?.verb ?? 'working'}${field ? ` in ${field.name}` : ''}${f.summary ? ` · ${f.summary}` : ''}`
          : f.state === 'stale' ? 'stale' : 'idle';
        const mode = { acceptEdits: 'accept edits', plan: 'plan mode', auto: 'auto mode', bypassPermissions: '⚠ bypass permissions', dontAsk: "don't ask" }[f.mode];
        const extra = [
          f.tasks && `tasks ${f.tasks.done}/${f.tasks.total}${f.tasks.current ? `: ${f.tasks.current}` : ''}`,
          f.jobs && `${f.jobs} background command${f.jobs === 1 ? '' : 's'} running`,
          f.nap && f.wakeAt && `wakes up by itself at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          f.compactions && `compacted ${f.compactions}×`,
          f.model && `${f.model}${f.fast ? ' (fast)' : ''}`,
        ].filter(Boolean).map(t => ` · ${t}`).join('');
        const line = f.turn ? `${f.turn.word ?? (f.thinking ? 'Thinking' : 'Working')}… ${ago(f.turn.startedAt)}${f.turn.outTokens ? ` · ↓ ${f.turn.outTokens >= 1000 ? `${(f.turn.outTokens / 1000).toFixed(1)}k` : f.turn.outTokens} tokens` : ''}${f.thinking && f.effort ? ` · thinking with ${f.effort} effort` : ''} · ` : '';
        return `${f.name} · ${line}${f.thinking ? 'thinking' : what}${f.kind === 'codex' ? '' : ` · ${Math.round((1 - f.pct) * 100)}% context left`}${f.cost != null ? ` · $${f.cost.toFixed(2)} so far` : ''}${mode ? ` · ${mode}` : ''}${extra}`;
      },
      onMove(f, zone, prev, pop) {
        if (!prev) return;
        if (zone === 'turn') pop('Done!', 'good');
        else if (zone === 'desk') pop(f.planAsk ? 'A plan for you' : 'Needs you!', 'warn');
        else if (zone === 'storage' || zone === 'nap') pop('…zzz', 'dim');
      },
      speed: f => (f.fast ? 68 : 40), // fast mode walks faster
      zoneText(f, z) {
        if (z === 'desk') return f.askKind === 'permission' ? 'comes up to your porch: needs a permission' : 'comes up to your porch with a question';
        if (z === 'turn') return f.question ? 'comes to your porch with a question' : 'brings a basket of finished work to your porch';
        if (z === 'storage') return 'stands still as a scarecrow (stale)';
        if (z === 'charge') return 'rests under the shade tree (idle)';
        if (z === 'meadow') return 'works in the wild meadow (no repo)';
        if (z === 'nap') return `naps in a hammock until it wakes up by itself${f.wakeAt ? ` at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`;
        return `${doing(f)?.verb ?? 'working'} in the ${fieldByKey(f.field)?.name ?? ''} field`;
      },
      /**
       * The farm's controls, laid over it so it fills the window: top left, the panel with what the
       * dashboard's top bar and count cards say; top right, the dashboard's own buttons; along the
       * bottom, below the fields' fence, a slim row of switches and zoom.
       */
      hud({ still, zoom = 1, saysOn = true, skyMode = 'live', follow = false, canFollow = false, restingHidden = null, bell = false, nav = {}, panelOpen = true }) {
        const need = scene.farmers.filter(a => a.state === 'waiting' || a.question).length;
        const spent = scene.farmers.reduce((t, a) => t + (a.cost ?? 0), 0), harvested = scene.farmers.reduce((t, a) => t + (a.compactions ?? 0), 0);
        const ch = scene.chrome ?? {}, c = ch.counts ?? {};
        const w = t => pxt(t, '#fff3d6', '#2a1d14'), dim = t => pxt(t, '#c9b48a', null), label = t => pxt(t, '#a9c79a', null);
        const gb = mb => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
        const bar = (ratio, tone) => `<span class="px-bar"><i class="${tone}" style="width:${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%"></i></span>`;
        const tone = r => (r >= 0.8 ? 'bad' : r >= 0.5 ? 'warn' : 'ok');
        const kpi = (state, glyph, cls, name, n, sub, hot, title) => `<button type="button" class="px-kpi${hot ? ' hot' : ''}"${state && n ? ` data-farm-state="${state}"` : ' disabled'} title="${esc(title)}"><span class="px-kpi-ico ${cls}">${pxt(glyph, '#ffffff', null)}</span><span class="px-kpi-n">${w(String(n ?? 0))}</span><span class="px-kpi-l">${label(name)}${sub ? `<br>${dim(sub)}` : ''}</span></button>`;
        const ramRatio = ch.ram?.totalMb ? ch.ram.usedMb / ch.ram.totalMb : 0, cpuRatio = (ch.cpu?.used ?? 0) / ((ch.cpu?.cores || 1) * 100);
        const windows = scene.plan?.windows ?? [], win = kind => windows.find(x => x.kind === kind), pctOf = x => (x ? (x.reset ? 0 : Math.round(x.percentUsed)) : null);
        const five = pctOf(win('five_hour')), week = pctOf(win('seven_day'));
        const tool = (attr, icon, name, state, title, disabled = false) => `<button type="button" ${attr}${disabled ? ' disabled' : ''} title="${esc(title)}">${iconImg(icon)}${pxImg(name, '#4e3626', null)}${state ? pxImg(state, '#8b5a2b', null) : ''}<span class="px-sr">${esc(state ? `${name}: ${state}` : name)}</span></button>`;
        const navBtn = (what, icon, name, title, pressed) => `<button type="button" data-farm-nav="${what}" title="${esc(title)}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${iconImg(icon)}${pxImg(name, '#4e3626', null)}<span class="px-sr">${esc(name)}</span></button>`;
        return `<div class="px-stats${panelOpen ? '' : ' folded'}">
            <button type="button" class="px-brand" data-farm-panel title="${panelOpen ? 'Fold this panel away' : 'Show the counts and meters'}" aria-expanded="${panelOpen}">${brandSvg()}${pxt('AGENTVILLE', '#ffe8a3', '#2a1d14')}<i class="px-live${nav.live === false ? ' off' : ''}" title="${nav.live === false ? 'Disconnected from the collector: retrying' : 'Live'}"></i>${pxt(panelOpen ? '-' : '+', '#c9b48a', null)}</button>
            <div class="px-line"><span title="What the sessions on the farm have cost so far (each one's purse; from the mod)"><b class="coin"></b>${w(`$${spent.toFixed(2)}`)}</span><span title="Harvests: each time a session's conversation was compacted"><b class="basket"></b>${w(`${harvested} harvested`)}</span><span class="px-season" title="${esc(seasonTip())}">${iconImg(season === 'summer' ? 'day' : season)}${w(season)}</span></div>
            <div class="px-kpis">
              ${kpi('waiting', '!', 'k-wait', 'waiting on you', c.waiting, c.waiting ? `oldest ${ago(ch.oldestWaiting ?? Date.now())}` : 'all clear', c.waiting > 0, 'Agents waiting on you (a question or a permission): click for the first')}
              ${kpi('working', '>', 'k-work', 'working', c.working, ch.subagentsRunning ? `${ch.subagentsRunning} with subagents` : `${ch.agents ?? 0} agents tracked`, false, 'Agents at work: click for the first')}
              ${kpi('turn', '<', 'k-turn', 'your turn', c.yourTurn, `${ch.asking ? `${ch.asking} ask you · ` : ''}${c.idle ?? 0} idle · ${c.stale ?? 0} stale`, ch.asking > 0, "Agents whose turn ended: it's yours. Click for the first")}
              ${kpi(null, '⚠', 'k-collide', 'collisions', c.collisions, c.collisions ? 'two in one repo' : 'none', c.collisions > 0, 'Two agents writing one repo')}
            </div>
            <div class="px-gauges">
              <span class="px-gauge" title="Memory used by the agents, of this Mac's">${label('RAM')}${bar(ramRatio, tone(ramRatio))}${w(gb(ch.ram?.usedMb ?? 0))}${ch.ram?.totalMb ? dim(`of ${gb(ch.ram.totalMb)}`) : ''}</span>
              <span class="px-gauge" title="${esc(`CPU used by the agents: ${Math.round(ch.cpu?.used ?? 0)}% of one core, ${ch.cpu?.cores ?? 1} cores`)}">${label('CPU')}${bar(cpuRatio, tone(cpuRatio))}${w(`${Math.round(cpuRatio * 100)}%`)}${dim('of this Mac')}</span>
              ${five !== null ? `<span class="px-gauge" title="Your plan's 5-hour limit (from the mod)">${label('5H')}${bar(five / 100, tone(five / 100))}${w(`${five}%`)}${dim('5-hour limit')}</span>` : ''}
              ${week !== null ? `<span class="px-gauge" title="Your plan's weekly limit (from the mod)">${label('WEEK')}${bar(week / 100, tone(week / 100))}${w(`${week}%`)}${dim('this week')}</span>` : ''}
              ${ch.collector ? `<span class="px-gauge" title="The tracker itself">${dim(`tracker ${ch.collector.cpu ?? 0}% CPU · ${ch.collector.rssMb ?? 0} MB`)}</span>` : ''}
            </div>
            ${(ch.errors ?? []).map(e => `<div class="px-err">⚠ ${esc(e)}</div>`).join('')}
            ${need ? `<button type="button" class="px-need" data-farm-need title="Open the first agent that needs you">${pxt(`${need} need${need > 1 ? '' : 's'} you`, '#ffffff', '#5a1f19')}</button>` : ''}
          </div>
          <div class="px-nav">
            ${navBtn('list', 'list', 'LIST', 'Back to the list view')}
            ${navBtn('session', 'plus', 'SESSION', 'Start a new Claude Code session in a folder, or resume a past one')}
            ${navBtn('side', 'side', 'SIDEBAR', "Show the selected farmer's answer box, activity and files beside the farm", Boolean(nav.side))}
            ${navBtn('theme', nav.theme === 'light' ? 'day' : nav.theme === 'auto' ? 'live' : 'night', String(nav.theme ?? 'dark').toUpperCase(), 'Theme: dark, light, or auto (as macOS is): click to change')}
          </div>
          <div class="px-tools">
              ${tool('data-farm-follow', 'follow', 'Follow', follow ? 'on' : 'off', canFollow ? 'Keep the farmer you picked in the middle of the view (zooms in); dragging the view turns it off' : 'Pick a farmer first, then Follow keeps it in view', !canFollow)}
              ${tool('data-farm-resting', 'resting', 'Resting', restingHidden === null ? 'shown' : `hidden (${restingHidden})`, 'Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work')}
              ${tool('data-farm-bubbles', 'bubbles', 'Bubbles', saysOn ? 'on' : 'off', 'Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again')}
              ${tool('data-farm-sky', skyMode, 'Sky', skyMode, 'The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night')}
              ${tool('class="px-motion" data-farm-motion', still ? 'pause' : 'play', 'Motion', still ? 'off' : 'on', 'Walking and animation on the farm')}
              ${tool('data-farm-bell', 'bell', 'Bell', bell ? 'on' : 'off', 'A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you (in the list view too)')}
              ${tool('class="px-info" data-farm-help aria-label="How to read the farm"', 'help', 'Help', '', 'How to read the farm')}
              <span class="px-zoombar" title="Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in"><button type="button" data-farm-zoom="-1" aria-label="Zoom out">${pxt('-', '#4e3626', null)}</button><button type="button" data-farm-zoom="0" title="Show the whole farm">${pxt(`${Math.round(zoom * 100)}%`, '#4e3626', null)}</button><button type="button" data-farm-zoom="1" aria-label="Zoom in">${pxt('+', '#4e3626', null)}</button></span>
          </div>`;
      },
      bg(f, season, ext) { drawLand(f, L, season, ext); },
      ground() { drawScenery(); L.ST.forEach(drawPlot); L.ST.forEach(drawPiles); },
      season: () => season,
      /** Particles a farmer gives off: dust when walking; splashes, clods, sparks, chips from its tool. */
      emit(f, b, dt, add) {
        const ox = b.x - 7 * SC, oy = b.y - 16 * SC, T = PXG.T;
        if (b.walk) {
          if (Math.random() < dt * 9) add({ x: b.x + rand(-3, 3), y: b.y - 0.5, vx: rand(-5, 5) - (b.face === 'right' ? 6 : b.face === 'left' ? -6 : 0), vy: rand(-9, -3), g: 18, life: 0.5, max: 0.5, size: rand(1, 2), color: '#c9a46a', alpha: 0.75 });
          const back = b.face === 'right' ? -1 : b.face === 'left' ? 1 : 0;
          if (f.fast && Math.random() < dt * 16) add({ x: b.x + back * 7, y: b.y - rand(3, 12), vx: back * 30, vy: 0, g: 0, life: 0.22, max: 0.22, size: 1, color: '#ffffff', alpha: 0.8 }); // fast mode: speed lines
          return;
        }
        if (f.state !== 'working') return;
        const prop = doing(f)?.prop;
        if (prop === 'can' && Math.random() < dt * 10) add({ x: ox + 17 * SC + rand(-1, 1), y: b.y - 1, vx: rand(-14, 14), vy: rand(-22, -10), g: 90, life: 0.3, max: 0.3, size: 1, color: '#5ab4ff' });
        if ((prop === 'hoe' || prop === 'rake') && !blink(prop === 'hoe' ? 3 : 2.5) && Math.random() < dt * 8) add({ x: ox + 17 * SC, y: b.y - 1, vx: rand(4, 18), vy: rand(-24, -12), g: 80, life: 0.45, max: 0.45, size: 1, color: '#5e3d22' });
        if (prop === 'hammer' && !blink(3) && Math.random() < dt * 10) add({ x: ox + 18.5 * SC, y: oy + 8 * SC, vx: rand(-20, 20), vy: rand(-26, -8), g: 70, life: 0.3, max: 0.3, size: 1, color: '#ffd43b' });
        if (prop === 'sickle' && !blink(3) && Math.random() < dt * 8) add({ x: ox + 16 * SC, y: b.y - 3, vx: rand(6, 22), vy: rand(-20, -6), g: 50, life: 0.6, max: 0.6, size: 1, color: '#4f8f3a' });
        if ((prop === 'cart' || prop === 'barrow') && Math.random() < dt * 5) add({ x: ox + 17 * SC, y: b.y, vx: rand(-8, 4), vy: rand(-6, -2), g: 10, life: 0.6, max: 0.6, size: 1.5, color: '#c9a46a', alpha: 0.6 });
        if (prop === 'crate' && T % 1.6 < dt) for (let i = 0; i < 3; i++) add({ x: ox + 16 * SC, y: oy + 10 * SC, vx: rand(-10, 10), vy: rand(-18, -8), g: 40, life: 0.4, max: 0.4, size: 1, color: '#f4d58d' });
      },
      /** The farm's own particles: smoke from the chimney while agents work; petals, leaves or snow by the season. */
      ambient(dt, add) {
        if (season === 'spring' && Math.random() < dt * 3) add({ x: rand(46, 88), y: rand(228, 260), vx: rand(3, 9), vy: rand(5, 9), g: 0, life: 3, max: 3, size: 1, color: '#f4b6c2', sway: 3 });
        if (season === 'autumn' && Math.random() < dt * 4) add({ x: rand(44, 90), y: rand(228, 262), vx: rand(2, 8), vy: rand(6, 11), g: 0, life: 3.2, max: 3.2, size: 1, color: ['#c8681a', '#e9a23b', '#b5562f'][Math.floor(rand(0, 3))], sway: 4 });
        const e = PXG.ext ?? { x0: 0, x1: W, y0: 0, y1: L.H };
        if (season === 'winter' && Math.random() < dt * 28 * ((e.x1 - e.x0) / W)) add({ x: rand(e.x0, e.x1), y: e.y0 - 2, vx: rand(-2, 2), vy: rand(9, 16), g: 0, life: (e.y1 - e.y0) / 10, max: (e.y1 - e.y0) / 10, size: rand(1, 1.6), color: '#ffffff', sway: 2, alpha: 0.9 });
        if (scene.farmers.some(a => a.state === 'working') && Math.random() < dt * 2.2) {
          add({ x: 241 + rand(-1, 1), y: 11, vx: rand(2, 6), vy: rand(-8, -5), g: 0, life: 2.6, max: 2.6, size: 2, grow: 1.4, color: '#c3cbd2', alpha: 0.55 });
        }
      },
      /** Soft shadows on the ground under farmers and their animals, so nothing floats. */
      shadows(b) {
        PXG.ctx.globalAlpha = 0.32;
        const x = Math.round(b.x), y = Math.round(b.y);
        px(x - 4, y - 1, 9, 1, '#1c3320'); px(x - 6, y, 13, 1, '#1c3320'); px(x - 4, y + 1, 9, 1, '#1c3320');
        for (const d of b.kids) { const kx = Math.round(d.x), ky = Math.round(d.y); px(kx - 3, ky, 6, 1, '#1c3320'); }
        PXG.ctx.globalAlpha = 1;
      },
      /** Lights that glow at night: [x, y, reach, the lit shape]. */
      lights() {
        return [[62, 54, 11, [61, 47, 2, 1]], [158, 56, 16, [148, 46, 20, 14, true]], [242, 56, 16, [232, 46, 20, 14, true]], [213, 66, 20, [213, 49, 2, 2]]];
      },
      /** By day, butterflies and birds, and cloud shadows drift over the farm; at night, fireflies over the yard. */
      weather(sky) {
        const T = PXG.T, e = PXG.ext ?? { x0: 0, x1: W, y0: 0, y1: L.H }, EW = e.x1 - e.x0 + 160;
        if (sky.light > 0.5 && (season === 'spring' || season === 'summer')) [[40, 160, '#ffffff'], [80, 150, '#ffd43b'], [60, 186, '#f08a24']].forEach(([bx, by, c], i) => {
          const x = Math.round(bx + Math.sin(T * 0.5 + i * 2.1) * 22 + Math.sin(T * 1.7 + i) * 4), y = Math.round(by + Math.sin(T * 0.8 + i * 1.3) * 10 + Math.sin(T * 3 + i) * 2), open = blink(6 + i);
          px(x - (open ? 2 : 1), y, open ? 2 : 1, 2, c); px(x + 1, y, open ? 2 : 1, 2, c); px(x, y, 1, 2, '#1b1420');
        });
        if (sky.light > 0.4 && season !== 'winter') { // birds on the fields' fence, now and then off to another post
          const posts = [[150, 88], [196, 88], [246, 88], [276, 88], [330, 88], [372, 88], [128, 140], [396, 180]];
          for (let i = 0; i < 3; i++) {
            const cycle = (T + i * 7.3) / 14, seg = Math.floor(cycle), ph = cycle - seg, [ax, ay] = posts[(seg * 3 + i * 5) % posts.length], [bx, by] = posts[((seg + 1) * 3 + i * 5) % posts.length];
            let x = ax, y = ay - 1, flying = false;
            if (ph > 0.86) { const t = (ph - 0.86) / 0.14; x = Math.round(ax + (bx - ax) * t); y = Math.round(ay + (by - ay) * t - Math.sin(t * Math.PI) * 18) - 1; flying = true; }
            const hop = !flying && Math.floor(T * 2 + i) % 7 === 0 ? 1 : 0;
            px(x - 2, y - 2 - hop, 4, 2, '#6b4320'); px(x + 1, y - 3 - hop, 2, 2, '#6b4320'); px(x + 3, y - 2 - hop, 1, 1, '#f0b429'); px(x - 1, y - 1 - hop, 2, 1, '#c98d4f');
            if (flying) px(x - 2, y - 4 + blink(10) * 3, 3, 1, '#4e3626');
          }
        }
        if (sky.light > 0.3) {
          PXG.ctx.globalAlpha = 0.09 * sky.light;
          for (const [ox, y, r, sp] of [[60, 70, 28, 2.2], [300, 210, 34, 1.6], [520, 140, 24, 2.8]]) cloudShadow(e.x0 - 80 + ((ox + T * sp) % EW), y, r);
          PXG.ctx.globalAlpha = 1;
        }
        if (sky.light < 0.5) FIREFLIES.forEach(([bx, by], i) => {
          if ((Math.floor(T * 1.4 + i * 0.37) + i) % 3 === 0) return;
          const x = Math.round(bx + Math.sin(T * 0.7 + i * 1.7) * 6), y = Math.round(by + Math.cos(T * 0.9 + i) * 4);
          PXG.lights?.push([x, y, 3, [x, y, 1, 1]]);
        });
      },
      fieldAt(x, y) { return L.ST.find(s => Math.abs(x - s.cx) <= 40 && y >= s.rowTop && y <= s.rowTop + 56)?.key ?? null; },
      /** The building at a farm point, if any: each opens something. */
      buildingAt(x, y) {
        const at = ([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        return [['barn', [36, 12, 88, 80]], ['silo', [92, 4, 112, 80]], ['board', [111, 58, 128, 82]], ['house', [132, 8, 268, 66]], ['stall', [STALL.x - 1, STALL.y - 1, STALL.x + 29, STALL.y + 34]], ['henhouse', [6, 96, 100, 136]]].find(([, box]) => at(box))?.[0] ?? null;
      },
      buildingTip: k => ({ barn: 'The barn: start a new session or resume one (a new farmer walks out of its door)', silo: "The silo: your plan's usage", board: 'The notice board: what your projects remember (CLAUDE.md and memory)', house: 'The farmhouse: who is on your porch', stall: 'The market stall: pull requests', henhouse: 'The henhouse: subagents' })[k] ?? '',
      /** What a building shows when clicked: { title, html }. */
      dialog(k) {
        if (k === 'house') {
          const list = scene.farmers.filter(f => f.state === 'waiting' || f.state === 'turn');
          return { title: 'Your porch', html: list.length ? `<ul class="px-dl">${list.map(f => `<li><button type="button" class="act" data-farm-pick="${esc(f.id)}">Open</button><span><b>${esc(f.name)}</b> ${esc(f.state === 'waiting' ? (f.planAsk ? 'has a plan for you to approve' : `needs you: ${f.ask}`) : f.question ? `asks: ${f.question}` : `finished${f.reply ? `: ${f.reply}` : ''}`)}</span></li>`).join('')}</ul>` : '<p class="muted">Nobody is waiting on you.</p>' };
        }
        if (k === 'silo') {
          const ws = scene.plan?.windows ?? [], name = w => ({ five_hour: '5-hour limit', seven_day: 'Weekly limit' })[w.kind] ?? w.kind;
          return { title: 'The silo: your plan', html: ws.length ? ws.map(w => { const pct = w.reset ? 0 : Math.round(w.percentUsed); return `<div class="px-meter"><b>${esc(name(w))}</b><span class="bar"><i style="width:${Math.min(100, pct)}%"></i></span><span>${w.reset ? 'just reset' : `${pct}% used`}${w.resetsAt ? ` · resets ${esc(new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}` : ''}</span></div>`; }).join('') + '<p class="muted">The grain is the week; the season is the 5-hour limit (winter when it is nearly used up).</p>' : '<p class="muted">No reading of your plan yet: it comes from the mod in a running session.</p>' };
        }
        if (k === 'henhouse') {
          const subs = scene.subagents ?? [];
          return { title: 'The henhouse: subagents', html: subs.length ? `<ul class="px-dl">${subs.slice(0, 40).map(c => `<li><i class="px-dot st-${esc(c.state)}"></i><span><b>${esc(c.parent)}</b> ${esc(c.label || 'a subagent')}${c.type ? ` <em>${esc(c.type)}</em>` : ''} · ${esc(c.state)}</span></li>`).join('')}</ul>` : '<p class="muted">No subagents lately.</p>' };
        }
        if (k === 'stall') {
          const link = pr => (typeof pr.url === 'string' && pr.url.startsWith('https://github.com/') ? `<a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number}</a>` : `#${pr.number}`);
          const checks = pr => (pr.draft ? 'draft' : { ok: '✓ checks pass', failed: '✗ checks failed', running: '◌ checks running' }[pr.checks] ?? 'no checks');
          const repos = scene.fields.filter(fl => fl.prs);
          return { title: 'The market stall: pull requests', html: repos.length ? repos.map(fl => `<h4>${esc(fl.name)}</h4><ul class="px-dl">${(fl.prs.open ?? []).map(pr => `<li><span>${link(pr)} ${esc(pr.title)} <em class="ck-${esc(pr.draft ? 'draft' : pr.checks ?? 'none')}">${checks(pr)}</em></span></li>`).join('') || '<li class="muted">No open pull requests.</li>'}${(fl.prs.merged ?? []).map(m => `<li class="muted"><span>${link(m)} merged${m.at ? ` ${ago(m.at)} ago` : ''}: ${esc(m.title)}</span></li>`).join('')}</ul>`).join('') : '<p class="muted">No pull requests to show: the repos here have no GitHub origin, or gh is not signed in.</p>' };
        }
        return null;
      },
      /** The projects whose memory the notice board shows: one session in each folder. */
      boardSessions: () => [...new Map(scene.farmers.filter(f => f.kind !== 'codex' && f.cwd).map(f => [f.cwd, f])).values()].slice(0, 8),
      items: () => [],
      drawChar(f, b) {
        if (b.zone === 'nap' && !b.walk) { // lying in its hammock, head to the left, the cloth round it
          const ctx = PXG.ctx, cx = Math.round(b.x), y = Math.round(b.y);
          ctx.save(); ctx.translate(cx, y - 10); ctx.rotate(-Math.PI / 2);
          ctx.drawImage(farmerSprite(f.look, SHIRT[f.color], false, 's', false, 'down'), -8, -7, 14 * SC, 16 * SC);
          ctx.restore();
          for (let i = 3; i <= 21; i++) { const sag = Math.round(Math.sin((i / 24) * Math.PI) * 4); px(cx - 12 + i, y - 9 + sag, 1, 2, '#d55181'); px(cx - 12 + i, y - 7 + sag, 1, 1, '#8a5fc0'); }
          return;
        }
        const scare = f.state === 'stale', [ox, oy] = pixelOrigin(b, 16), rp = rpAt(ox, oy);
        if (scare) { rp(0, 10, 14, 1, '#6b4320'); rp(-1, 9, 2, 3, '#d8c48a'); rp(13, 9, 2, 3, '#d8c48a'); }
        const view = b.walk ? b.face ?? 'down' : 'down';
        PXG.ctx.drawImage(farmerSprite(f.look, SHIRT[f.color], scare, scare ? 'p' : legFrame(b), f.state === 'waiting', view), ox, oy, 14 * SC, 16 * SC);
        if (scare) { rp(5, 6, 1, 1, '#3a2a1a'); rp(8, 6, 1, 1, '#3a2a1a'); rp(5, 7, 4, 1, '#7a5230'); rp(6, 11, 2, 2, '#c97b4a'); return; }
        if (f.family) { rp(9, 2, 2, 2, FAMILY_PIN[f.family]); rp(9, 2, 1, 1, '#ffffff'); } // its model's pin on the hat
        if (f.mode === 'bypassPermissions') { for (let i = 0; i < 6; i++) rp(4 + i, 9, 1, 1, i % 2 ? '#ffffff' : '#e04a3a'); rp(9, 10, 1, 2, '#e04a3a'); } // no permission checks: a hazard scarf
        if (view === 'up') return; // from behind: no face
        if (f.cost >= 1) { const big = f.cost >= 10, gold = f.cost >= 50; rp(1, big ? 11 : 12, big ? 3 : 2, big ? 3 : 2, gold ? '#c9a24a' : '#8b5a2b'); rp(2, big ? 11 : 12, 1, 1, '#ffd43b'); } // its purse: what it has cost
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
        if (f.hot) { rp(11, 3 + Math.floor((T * 6) % 4), 1, 2, '#a9dcf7'); rp(2, 4 + Math.floor((T * 6 + 2) % 4), 1, 2, '#a9dcf7'); rp(4, 7, 1, 1, '#ff6b6b'); rp(9, 7, 1, 1, '#ff6b6b'); }
        if (b.zone === 'nap' && !b.walk) { // asleep until its wake-up: zzz, and a little clock
          const x = Math.round(b.x), y = Math.round(b.y), zy = y - 20 - Math.floor((T * 2) % 4);
          PXG.ctx.globalAlpha = 0.85; px(x + 6, zy, 3, 1, '#e6eef5'); px(x + 7, zy + 1, 1, 1, '#e6eef5'); px(x + 6, zy + 2, 3, 1, '#e6eef5'); PXG.ctx.globalAlpha = 1;
          px(x - 15, y - 25, 7, 7, '#4e3626'); px(x - 14, y - 24, 5, 5, '#f4ecd8'); px(x - 12, y - 23, 1, 2, '#1b1420'); px(x - 12, y - 22, 2, 1, '#1b1420');
          return;
        }
        if (f.state === 'working' && !b.walk) { const act = doing(f); if (act) drawProp(act.prop, rp, T, act.flag); }
        if (f.thinking && !b.walk) { // between steps, the model is thinking: a thought cloud, its dots filling in
          const ph = Math.floor(T * 3) % 4;
          rp(10, 0, 1, 1, '#e6eef5'); rp(11, -2, 2, 2, '#e6eef5');
          rp(12, -10, 10, 7, '#9aa4ad'); rp(13, -11, 8, 9, '#9aa4ad'); rp(13, -9, 8, 5, '#ffffff'); rp(14, -10, 6, 7, '#ffffff');
          for (let i = 0; i < 3; i++) rp(14 + i * 2, -7, 1, 1, i < ph ? '#5f6b7a' : '#c3cbd2');
        }
        if (f.tasks?.total && f.state === 'working' && !b.walk) { // its chore board: the task list, ticked as items are done
          const t = f.tasks, rows = Math.min(3, t.total), done = Math.round((t.done / t.total) * rows);
          rp(-6, 9, 1, 6, '#6b4320'); rp(-10, 2, 8, 8, '#4e3626'); rp(-9, 3, 6, 6, '#fff4d6');
          for (let r = 0; r < rows; r++) { rp(-8, 4 + r * 2, 1, 1, r < done ? '#2fa57a' : '#9aa4ad'); rp(-6, 4 + r * 2, 2, 1, '#c9b48a'); }
          rp(-10, 11, 8, 1, '#4e3626'); rp(-10, 11, Math.max(t.done ? 1 : 0, Math.round((8 * t.done) / t.total)), 1, '#6cc04a');
        }
        if (f.state === 'waiting') {
          bubble(rp, 12, -7 - blink(3), f.planAsk ? 'plan' : '!');
          const x = Math.round(b.x), y = Math.round(b.y); // a ring at its feet that pulses: it needs you
          PXG.ctx.globalAlpha = 0.45 + 0.35 * Math.sin(PXG.T * 5);
          px(x - 6, y + 2, 13, 1, '#e04a3a'); px(x - 8, y + 1, 2, 1, '#e04a3a'); px(x + 7, y + 1, 2, 1, '#e04a3a'); px(x - 8, y - 1, 1, 2, '#e04a3a'); px(x + 8, y - 1, 1, 2, '#e04a3a');
          PXG.ctx.globalAlpha = 1;
        }
        if (f.state === 'turn') { // a basket of produce
          if (b.walk) { rp(3, 10, 8, 4, '#a8703c'); rp(3, 10, 8, 1, '#c98d4f'); rp(4, 9, 2, 1, '#e04a3a'); rp(7, 9, 2, 1, '#f08a24'); rp(6, 8, 1, 1, '#3f9b3a'); }
          else {
            const x = Math.round(b.x) + 7, y = Math.round(b.y) - 6;
            px(x, y, 10, 6, '#a8703c'); px(x, y, 10, 1, '#c98d4f'); px(x, y + 5, 10, 1, '#6b4320'); px(x + 1, y - 2, 3, 2, '#e04a3a'); px(x + 4, y - 3, 3, 3, '#f08a24'); px(x + 7, y - 2, 2, 2, '#e9c46a'); px(x + 5, y - 4, 1, 1, '#3f9b3a');
            bubble(rp, 12, -7 - (f.question ? blink(3) : 0), f.question ? '?' : 'v'); // a question waits for your answer
          }
        }
        if (f.state === 'idle' && !b.walk) { const zy = -2 - Math.floor((T * 2) % 4); PXG.ctx.globalAlpha = 0.8; rp(11, zy, 3, 1, '#e6eef5'); rp(12, zy + 1, 1, 1, '#e6eef5'); rp(11, zy + 2, 3, 1, '#e6eef5'); PXG.ctx.globalAlpha = 1; }
        if (f.state === 'stale') { const peck = blink(1.5); rp(5, -2, 4, 2, '#1b1420'); rp(4, -3, 2, 2, '#1b1420'); rp(3, -2 + peck, 1, 1, '#f0b429'); rp(8, -1, 2, 1, '#1b1420'); } // crow on the hat
        b.kids.forEach((d, k) => { // chickens = subagents, the dog = an Explore subagent
          if (f.kids[k]?.dog) {
            const left = Math.sin(T * 0.9 + k) > 0, sniff = blink(3), m = (x, w) => (left ? 8 - x - w : x);
            const dp = rpAt(Math.round(d.x - 4.5 * SC), Math.round(d.y - 6 * SC)), c = (x, y, w, h, col) => dp(m(x, w), y, w, h, col);
            c(1, 2, 5, 2, '#a8703c'); c(5, 1 + sniff, 2, 2, '#a8703c'); c(5, sniff, 1, 1, '#6b4320'); c(7, 2 + sniff, 1, 1, '#1b1420');
            c(1, 4, 1, 1, '#6b4320'); c(4, 4, 1, 1, '#6b4320'); c(0, 1 + blink(6), 1, 1, '#a8703c'); c(2, 2, 2, 1, '#c98d4f');
            if (sniff) c(8, 4, 1, 1, '#b08850');
            return;
          }
          const hop = b.walk ? Math.round(Math.abs(Math.sin(T * 10 + k)) * 2) : (blink(2) && k % 2 ? 1 : 0);
          const cp = rpAt(Math.round(d.x - 2.5 * SC), Math.round(d.y - 5 * SC) - hop);
          cp(2, 0, 1, 1, '#e04a3a'); cp(1, 1, 3, 1, '#ffffff'); cp(3, 1, 1, 1, '#1b1420'); cp(0, 2, 4, 1, '#ffffff'); cp(4, 2, 1, 1, '#f0b429'); cp(1, 3, 3, 1, '#e6eef5'); cp(1, 4, 1, 1, '#f0b429'); cp(3, 4, 1, 1, '#f0b429');
        });
      },
      /** Labels that move with what they name: the carts on the road, the hammocks' wake-up times. */
      movers(posOf) {
        const out = [];
        for (const f of scene.farmers) {
          const c = cartOf(f);
          if (c) out.push({ key: `cart:${f.id}`, x: c.x, y: LANE - 5, html: pxt(clip(f.service, 18), '#5a3a1a', null), title: `${f.name}: ${f.summary || f.service}` });
          const b = posOf(f.id);
          if (f.nap && f.wakeAt && b?.zone === 'nap' && !b.walk) out.push({ key: `nap:${f.id}`, x: b.x - 11, y: b.y - 26, html: pxt(`wakes in ${until(f.wakeAt)}`, '#5a3a1a', null), title: `${f.name} wakes up by itself at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` });
        }
        return out;
      },
      top() {
        const T = PXG.T;
        for (const f of scene.farmers) { // carts to town and back, one for each web or connector call going on
          const c = cartOf(f);
          if (!c) continue;
          const { x, dir } = c, y = LANE + 4, step = blink(6), pony = x + dir * 7;
          px(x - 4, y + 2, 9, 1, '#3f7d3a'); // its shadow on the road
          px(x - 4, y - 4, 8, 4, '#a8703c'); px(x - 4, y - 4, 8, 1, '#c98d4f'); px(x - 2, y - 7, 4, 3, f.step === 'web' ? '#f4ecd8' : '#c9a46a'); px(x - 2, y - 7, 4, 1, f.step === 'web' ? '#ffffff' : '#e2b07a');
          px(x - 3, y, 2, 2, '#4e3626'); px(x + 2, y, 2, 2, '#4e3626');
          px(pony - 3, y - 4, 6, 3, '#8b5a2b'); px(pony + dir * 3 - (dir < 0 ? 1 : 0), y - 6, 2, 3, '#8b5a2b'); px(pony + dir * 4 - (dir < 0 ? 0 : 1), y - 5, 1, 1, '#1b1420');
          px(pony - 3 + step, y - 1, 1, 2, '#6b4320'); px(pony + 1 - step, y - 1, 1, 2, '#6b4320'); px(pony - dir * 4, y - 4, 1, 2, '#4e3626');
        }
        for (const s of L.ST) {
          const weather = fieldByKey(s.key).weather;
          if (weather === 'rainbow') { // deploy passed: a rainbow across the field
            PXG.ctx.globalAlpha = 0.5;
            ['#e04a3a', '#f08a24', '#ffd43b', '#6cc04a', '#3d7be0', '#8a5fc0'].forEach((c, j) => { const r = 40 - j * 2; for (let ang = 182; ang <= 358; ang += 2.5) { const t = ang * Math.PI / 180; px(Math.round(s.cx + Math.cos(t) * r), Math.round(s.rowTop + 36 + Math.sin(t) * r * 0.6), 2, 2, c); } });
            PXG.ctx.globalAlpha = 1;
            if ((Math.floor(T * 3) + s.cx) % 7 === 0) { const sx = s.cx - 30 + ((s.cx * 13 + Math.floor(T * 3) * 17) % 60), sy = s.rowTop + 14; px(sx, sy - 1, 1, 3, '#ffffff'); px(sx - 1, sy, 3, 1, '#ffffff'); }
          } else if (weather === 'windmill') { // deploy running
            const hx = s.cx - 2, hy = s.rowTop - 4;
            px(hx - 2, hy, 5, 13, '#e8d8b0'); px(hx - 3, hy - 2, 7, 2, '#9c3b30'); px(hx, hy + 8, 1, 4, '#6b4320');
            for (let i = 0; i < 4; i++) { const t = T * 3 + i * Math.PI / 2; for (let r = 2; r <= 8; r++) px(Math.round(hx + Math.cos(t) * r), Math.round(hy + 1 + Math.sin(t) * r), 1, 1, r > 4 ? '#ffffff' : '#c9b48a'); }
          } else if (weather === 'rain') { // deploy failed: a dark cloud drifts over the field and rain falls on all of it
            const x0 = s.x0, cx = Math.round(s.cx - 22 + Math.sin(T * 0.5) * 10), cy = s.rowTop + 2;
            PXG.ctx.globalAlpha = 0.18; oval(px, cx + 22, s.rowTop + 30, 22, 5, '#1c3320'); PXG.ctx.globalAlpha = 1;
            for (let i = 0; i < 18; i++) {
              const ph = (T * 1.6 + (i * 0.37) % 1) % 1, x = x0 + 2 + ((i * 47) % 70) - Math.round(ph * 3), y = cy + 10 + ph * 40;
              if (ph < 0.92) { px(x, Math.round(y), 1, 3, '#5ab4ff'); } else { px(x - 1, s.rowTop + 46, 3, 1, '#a9dcf7'); } // a drop, then its splash
            }
            drawCloud(cx, cy + 1, 44, ['#9aa4ad', '#5f6b7a', '#3a3a40']);
          }
        }
      },
      labels(lab, overflow) {
        const { ST, more } = L;
        const cnt = t => pxt(t, '#5a3a1a', null); // a count on a cream tag
        for (const s of ST) {
          const f = fieldByKey(s.key);
          const branch = f.branch === '(detached)' ? ` ${pxt('?', '#c3cbd2')}` : f.branch && !isMain(f.branch) ? ` ${pxt(clip(f.branch, 12), '#c3cbd2')}` : '';
          const d = f.lastDeploy;
          const weather = d ? pxt(d.label, { ok: '#8ef0a0', failed: '#ff8a80', running: '#ffd166' }[d.state] ?? '#c9b48a') : '';
          const tip = [f.key, f.branch && `on ${f.branch}`, d?.detail, 'Click to see the files agents touched here'].filter(Boolean).join(' · ');
          const second = [f.worktree && f.main ? pxt(`worktree of ${f.main.split('/').pop()}`, '#a9dcf7') : '', weather, f.collision ? ` ${pxt('⚠ crowded', '#ffd166')}` : ''].filter(Boolean).join(' ');
          lab(s.cx, s.rowTop + 49, `<button type="button" class="px-field" data-farm-field="${esc(f.key)}" title="${esc(tip)}"><span class="px-fl">${pxt(clip(f.name, 16), f.collision ? '#ffd166' : '#e6eef5')}${branch}</span>${second ? `<span class="px-fl">${second}</span>` : ''}</button>`, f.collision ? 'bad' : '');
          if (f.behind > 0) lab(s.cx - 40, s.rowTop - 8, cnt(`↓${f.behind}`), 'cnt', `${f.behind} commit${f.behind === 1 ? '' : 's'} behind the remote`);
          if (f.ahead > 0) lab(s.cx - 23, s.rowTop + 3 - Math.ceil(Math.min(f.ahead, 16) / 8) * 6, cnt(`↑${f.ahead}`), 'cnt', `${f.ahead} unpushed commit${f.ahead === 1 ? '' : 's'}`);
          if (f.dirty > 0) lab(s.cx + 25, s.rowTop + 3 - Math.ceil(Math.min(f.dirty, 12) / 9) * 6, cnt(`+${f.dirty}`), 'cnt', `${f.dirty} uncommitted file${f.dirty === 1 ? '' : 's'}`);
        }
        if (!ST.length) lab(262, 150, pxt('No fields yet: no agent has touched a repo in the last 30 minutes', '#fff3d6', '#4e3626'), 'zone');
        const silo = siloOf(scene.plan);
        if (silo) lab(102, 80, silo.lamp === 'red' ? pxt(silo.label, '#ffffff', null) : cnt(silo.label), `cnt${silo.lamp ? ` silo-${silo.lamp}` : ''}`, `The silo: your plan's weekly limit, ${silo.label} used${silo.resetsAt ? `, resets ${new Date(silo.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`);
        if (scene.henhouse?.roosting) lab(64, 104, cnt(`+${scene.henhouse.roosting}`), 'cnt', `${scene.henhouse.roosting} more subagent${scene.henhouse.roosting === 1 ? '' : 's'} running than the farmers can lead`);
        if (scene.henhouse?.eggs) lab(14, 142, cnt(`${scene.henhouse.eggs} egg${scene.henhouse.eggs === 1 ? '' : 's'}`), 'cnt', 'Eggs: subagents that finished lately');
        const sign = t => pxt(t, '#fff3d6', '#4e3626');
        lab(56, 140, sign('MEADOW'), 'zone');
        lab(60, L.GRID.y1 + 4, sign('SHADE TREE'), 'zone'); lab(200, 21, sign('YOUR PORCH'), 'zone'); lab(356, 18, sign('SCARECROWS'), 'zone');
        for (const g of L.groups) { const [r, cols] = rowsOfGroup(g)[0]; lab(174 + Math.min(...cols) * COLW + 44, 100 + r * ROWH - 1, sign(clip(g.name, 16)), 'zone proj', `The ${g.name} project: its repos side by side`); }
        const open = scene.fields.flatMap(fl => fl.prs?.open ?? []);
        if (open.length) lab(STALL.x + 14, STALL.y + 32, cnt(`${open.length} PR${open.length === 1 ? '' : 's'}`), 'cnt', `Open pull requests: ${open.slice(0, 6).map(pr => `#${pr.number} ${pr.title}`).join(' · ')}${open.length > 6 ? ' …' : ''}. Click the stall for them all`);
        const plus = (x, y, n, what) => n > 0 && lab(x, y, cnt(`+${n} ${what}`), 'cnt');
        plus(154, PORCH_Y - 34, overflow.desk, 'waiting');
        plus(246, PORCH_Y - 34, overflow.turn, 'your turn');
        plus(60, 262, overflow.charge, 'idle');
        plus(340, PORCH_Y - 34, overflow.storage, 'stale');
        plus(56, 152, overflow.meadow, 'in the meadow');
        if (more > 0) lab(350, L.GRID.y1 + 8, `<button type="button" class="px-more" data-farm-more>${pxt(`+${more} more field${more === 1 ? '' : 's'}`, '#fff3d6', '#4e3626')}</button>`, 'wood');
      },
    };
  }

  /** The farm's legend, shown in a dialog from the ⓘ button. */
  function helpHtml() {
    return `<div class="px-key">
      <b>Your porch</b><span>in front of the farmhouse at the top: a farmer waving a red “!” needs you; a basket means it's your turn. The stats panel's “needs you” button opens the first one</span>
      <b>Fields</b><span>one raised bed per repo in the fenced grid, each with its own crop (the seed packet on its side), soil and frame; empty beds wait for more repos, and the grid grows to 18. A blue pennant = a branch other than main; a greenhouse = a worktree, beside its repo; stones round some beds and a sign = one project's repos</span>
      <b>Tools</b><span>what a working farmer holds is its current step: almanac = reading, spyglass = searching, pigeon = the web, hoe = editing, seeds = a new file, magnifier = running tests, rake = lint or format, hammer = a build, wheelbarrow = installing, crate = a commit, cart = a push or a PR (with a red flag: a deploy), mailbag = a pull, lantern = a server or a long wait, sickle = deleting, whistle = calling subagents, clipboard = planning, parcel = a connector (MCP: Gmail, Linear…), recipe card = a skill, blueprint = plan mode, watering can = any other command</span>
      <b>Above a farmer</b><span>a thought cloud = thinking between steps; a scroll on the porch = a plan for you to approve; a chore board beside it = its task list, ticked as items get done (its name says how many, e.g. 3/7)</span>
      <b>On a farmer</b><span>the pin on its hat = its model (purple Opus, blue Sonnet, green Haiku, orange Fable); speed lines = fast mode; a red and white scarf = bypass permissions (no checks); its purse = what it has cost (gold from $50)</span>
      <b>Road to town</b><span>a cart on the lane for each web or connector call going on, with where it goes</span>
      <b>Pumps, hammocks</b><span>a pump by a bed = a background command still running; a farmer in a hammock = a session that wakes up by itself (/loop, a scheduled wake-up), with when</span>
      <b>Market stall</b><span>a crate for each open pull request, its tag the checks (green pass, red failed, yellow running, grey draft); “Sold!” = one merged</span>
      <b>Buildings</b><span>click the barn to start or resume a session, the farmhouse for who is on your porch, the silo for your plan's usage, the henhouse for subagents, the notice board for CLAUDE.md and memory, the stall for pull requests</span>
      <b>Farmers</b><span>one per agent; each has its own hat, hair and clothes, and its shirt is the agent's colour in the list. Hover one for its name; names always show for the farmer you picked and those on the porch</span>
      <b>Speech bubbles</b><span>what a farmer asked or last said; × hides one to a 💬 (click it to show the bubble again); a new message brings it back by itself. The Bubbles switch hides or shows them all</span>
      <b>Above a field</b><span>hay = uncommitted files, crates = unpushed commits, mailbox = behind the remote</span>
      <b>Weather</b><span>the repo's last deploy, from GitHub Actions or a deploy an agent ran itself (a deploy script over ssh, rsync, vercel…), whichever is newer: rainbow = deployed, rain = deploy failed (hover its sign for why; the close-up links to the run), windmill = deploying. A run GitHub never started (billing, spending limit) brings no weather: ⏸ Actions didn't run. Rope = two agents writing one repo</span>
      <b>Hearts, crops</b><span>hearts = context left. Crops grow as the context fills: seeds, sprouts, young plants, in flower, ripening, then ripe with a sparkle (golden wheat, red tomatoes, sunflowers in bloom…) when it is nearly full. When the conversation is compacted, that's the harvest: the field starts again from seed. Chickens = subagents, the dog = an Explore subagent</span>
      <b>Shade tree, scarecrows</b><span>idle agents nap under the tree (bottom left); stale ones stand as scarecrows (top right); the meadow by the henhouse is for agents outside any repo</span>
      <b>Silo</b><span>its grain is your plan's weekly limit used (the % under it; when it resets on hover); its lamp turns amber from 70% and blinks red from 90%</span>
      <b>Seasons</b><span>follow your plan's 5-hour limit: spring while it is fresh (blossom), then summer, autumn (falling leaves), and winter (snow) when it is nearly used up; a new window brings spring back</span>
      <b>Henhouse</b><span>eggs in the nest = subagents that finished lately; hens in the run and a +N sign = more subagents running than their farmers can lead</span>
      <b>Pigeons</b><span>one agent messaging another (Claude Code's SendMessage between sessions): a pigeon flies the note from one farmer to the other, and the diary says what it said; the agents' conversations show it too</span>
      <b>Day and night</b><span>the light follows your clock: cloud shadows drift over by day; at night the windows, the lamps and lanterns glow and fireflies come out. The Sky switch holds it at day or night</span>
      <b>Click</b><span>a farmer to answer or message it in the sidebar; a field for the files agents touched there</span>
      <b>Zoom</b><span>+ / − on the right (or ⌘/Ctrl + scroll, or pinch) zooms the farm inside its frame; drag or scroll to move around (the map in the corner shows where you are; click it to go somewhere); the % button shows the whole farm again</span>
      <b>Stats, bell</b><span>the stats add up what the sessions have cost and their harvests. Bell: a chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you</span>
    </div>`;
  }

  /* ---------- the engine: positions, walking, tags, pop-ups, diary, the loop ---------- */

  function makePixelView(th) {
    let host = null, canvas = null, ctx = null, ov = null, logEl = null, hudEl = null, bg = null, ro = null;
    let raf = 0, last = 0, T = 0, cs = 1, first = true, timer = 0, layoutKey = null, labelKey = '';
    let viewEl = null, drag = null, dragged = false, backing = 1, hoverId = null; // the frame the farm is seen through; a drag that pans it; the farmer under the pointer
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
    let bellOn = stored('tracker-bell') === 'on';
    let panelOpen = stored('tracker-farm-panel') !== 'folded'; // the farm's panel: counts and meters, or folded to its title // a chime and a desktop notice when an agent starts waiting (the page rings it)
    const moverEls = new Map(); // labels that move: key → element
    let dlg = null, mini = null; // the buildings' dialog; the minimap shown while zoomed in
    const resting = f => f.state === 'idle' || f.state === 'stale';
    let glide = null; // a zoom easing in: { from: scale, start, ox, oy }
    let pad = { l: 0, r: 0, t: 0, b: 0 }; // the frame's spare room, in world pixels: more forest all round
    const extOf = () => ({ x0: -pad.l, x1: W + pad.r, y0: -pad.t, y1: th.layout().H + pad.b });
    const skyNow = () => skyAt(skyMode === 'day' ? new Date(2000, 0, 1, 12) : skyMode === 'night' ? new Date(2000, 0, 1, 23) : new Date());
    let wheel = 0;
    const says = new Map(); // farmer id → { el, text }
    const closedSays = new Map(); // farmer id → the text that was closed
    const bots = new Map(), log = [];
    const parts = []; // particles on the farm now
    const flights = [], seenMail = new Set(); // carrier pigeons between farmers: { from, to, start }
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
    function renderHud() {
      if (hudEl) hudEl.innerHTML = th.hud({ still, zoom, saysOn, skyMode, follow, canFollow: Boolean(selectedId && bots.has(selectedId)), restingHidden: restingShown ? null : scene.farmers.filter(resting).length, bell: bellOn, nav: opts.navState?.() ?? {}, panelOpen });
    }
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
      const tx = (b.x + pad.l) * cs + stage.offsetLeft - viewEl.clientWidth / 2, ty = (b.y - 14 + pad.t) * cs + stage.offsetTop - viewEl.clientHeight / 2;
      const ease = (cur, t) => { const d = t - cur, stepBy = dt ? d * Math.min(1, dt * 3.5) : d; return cur + (Math.abs(stepBy) < 1 ? Math.sign(d) * Math.min(1, Math.abs(d)) : stepBy); };
      viewEl.scrollLeft = ease(viewEl.scrollLeft, tx);
      viewEl.scrollTop = ease(viewEl.scrollTop, ty);
    }
    function setFollow(on) {
      follow = on && Boolean(selectedId && bots.has(selectedId));
      if (follow && zoom < 2) {
        const b = bots.get(selectedId), stage = canvas.parentElement;
        setZoom(0, [(b.x + pad.l) * cs + stage.offsetLeft - viewEl.scrollLeft, (b.y + pad.t) * cs + stage.offsetTop - viewEl.scrollTop], 2);
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
    /** The farmer under a pointer, if any (its sprite, in farm pixels). */
    function botAt(e) {
      if (!canvas || e.target !== canvas) return null;
      const r = canvas.getBoundingClientRect(), on = r.width / (W + pad.l + pad.r) || cs, x = (e.clientX - r.left) / on - pad.l, y = (e.clientY - r.top) / on - pad.t; // the size on screen: right even while a zoom glides
      for (const [id, b] of bots) if (Math.abs(x - b.x) <= 7 * SC + 1 && y >= b.y - th.SH * SC - 1 && y <= b.y + 1) return id;
      return null;
    }
    function setHover(id) {
      if (id === hoverId) return;
      bots.get(hoverId)?.tag?.classList.remove('hover');
      hoverId = id;
      bots.get(id)?.tag?.classList.add('hover');
      if (canvas) canvas.style.cursor = id ? 'pointer' : '';
    }
    /** The farm point under a pointer, or null off the canvas. */
    function farmPoint(e) {
      if (!canvas || e.target !== canvas) return null;
      const r = canvas.getBoundingClientRect(), on = r.width / (W + pad.l + pad.r) || cs;
      return [(e.clientX - r.left) / on - pad.l, (e.clientY - r.top) / on - pad.t];
    }
    function onPointerMove(e) {
      if (!drag) {
        const id = botAt(e);
        setHover(id);
        if (!id && canvas) { const pt = farmPoint(e), k = pt && th.buildingAt?.(...pt); canvas.style.cursor = k ? 'pointer' : ''; canvas.title = k ? th.buildingTip(k) : ''; }
        return;
      }
      if (e.pointerId !== drag.id) return;
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
      const text = saysOn && ACTIVE.has(f.state) && !f.nap ? (f.state === 'waiting' ? f.ask : f.question || f.said) : '';
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
      s.bottom = Math.round((b.y - th.SH * SC - 3 - b.lift) * cs) - (b.shown ? 18 : 2); // just above its farmer's name tag, or its head
      s.seen = true;
    }
    /**
     * Keeps speech bubbles off each other and off name tags: from left to right, a bubble that
     * would land on one already placed is lifted above it, with a line down to its farmer.
     */
    function layoutBubbles() {
      const placed = [];
      for (const b of bots.values()) {
        if (!b.tag || !b.shown) continue; // hidden names leave room
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
    /** Carrier pigeons: from the sender over an arc to the receiver in 2.4 s, then a ✉ pops there. */
    function drawFlights() {
      for (let i = flights.length - 1; i >= 0; i--) {
        const fl = flights[i], a = bots.get(fl.from), z = bots.get(fl.to), t = (T - fl.start) / 2.4;
        if (!a || !z) { flights.splice(i, 1); continue; }
        if (t >= 1) { pop(z.x, z.y - th.SH * SC - 16, '✉', 'good'); flights.splice(i, 1); continue; }
        const ay = a.y - th.SH * SC, zy = z.y - th.SH * SC, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const x = Math.round(a.x + (z.x - a.x) * e), y = Math.round(ay + (zy - ay) * e - Math.sin(Math.PI * t) * 34), m = z.x >= a.x ? 1 : -1, up = Math.floor(T * 12) % 2;
        px(x - 3, y, 6, 3, '#e6eef5'); px(x + (m > 0 ? 2 : -4), y - 2, 2, 2, '#e6eef5'); px(x + (m > 0 ? 4 : -5), y - 1, 1, 1, '#f08a24'); px(x + (m > 0 ? 3 : -4), y - 2, 1, 1, '#1b1420'); // body, head, beak, eye
        px(x - 2, y + (up ? -2 : 1), 4, 1, '#9aa4ad'); // a wing, flapping
        px(x - 1, y + 3, 3, 2, '#fff4d6'); px(x, y + 4, 1, 1, '#e04a3a'); // the letter, sealed
      }
    }
    function step(dt, f, b) {
      if (b.path.length) {
        const [qx, qy] = b.path[0], dx = qx - b.x, dy = qy - b.y, d = Math.hypot(dx, dy), sp = (th.speed?.(f) ?? 40) * dt;
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
      for (const f of scene.farmers) if (f.state === 'waiting' || f.state === 'turn') { const b = bots.get(f.id); if (b) PXG.lights.push([b.x, b.y - 8, 14, null]); } // lit at night: they need you
      ctx.drawImage(bg, -pad.l, -pad.t);
      th.ground();
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) th.shadows(b); }
      const items = th.items();
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) items.push([b.y, () => th.drawChar(f, b)]); }
      items.sort((p, q) => p[0] - q[0]).forEach(it => it[1]());
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) th.drawFx(f, b); }
      if (!still) drawParticles(parts);
      drawFlights();
      th.weather?.(sky);
      th.top();
      drawNight(sky, th.layout().H, PXG.lights);
      const picked = selectedId && bots.get(selectedId);
      if (picked) { // the farmer shown in the sidebar: a ring at its feet
        PXG.ctx.globalAlpha = 0.85;
        px(Math.round(picked.x) - 7, Math.round(picked.y) + 2, 15, 1, '#ffd43b');
        px(Math.round(picked.x) - 9, Math.round(picked.y) - 1, 2, 3, '#ffd43b');
        px(Math.round(picked.x) + 8, Math.round(picked.y) - 1, 2, 3, '#ffd43b');
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
        const text = th.tag(f), tip = th.tip(f), sel = f.id === selectedId, hover = f.id === hoverId;
        b.shown = sel || f.state === 'waiting' || (f.state === 'turn' && !f.nap); // the rest show their names on hover
        if (b.tagText !== f.state + text + tip + sel + hover + f.nap) {
          b.tag.className = `px-tag st-${f.state}${f.nap ? ' nap' : ''}${sel ? ' sel' : ''}${hover ? ' hover' : ''}`;
          b.tag.innerHTML = f.state === 'turn' ? pxt(text, '#1b1420', null) : pxt(text, '#ffffff');
          b.tagW = null;
          b.tag.title = tip;
          b.tagText = f.state + text + tip + sel + hover + f.nap;
        }
        b.tag.style.transform = `translate(${Math.round(b.x * cs)}px, ${Math.round((b.y - th.SH * SC - 3 - b.lift) * cs)}px) translate(-50%, -100%)`;
        placeBubble(f, b);
      }
      for (const [id, s] of says) if (!bots.has(id)) { s.el.remove(); says.delete(id); }
      layoutBubbles();
      const keepMovers = new Set();
      for (const m of th.movers?.(id => bots.get(id)) ?? []) {
        keepMovers.add(m.key);
        let el = moverEls.get(m.key);
        if (!el) { el = document.createElement('div'); el.className = 'px-mover'; ov.appendChild(el); moverEls.set(m.key, el); }
        if (el.dataset.html !== m.html) { el.innerHTML = m.html; el.dataset.html = m.html; el.title = m.title ?? ''; }
        el.style.transform = `translate(${Math.round(m.x * cs)}px, ${Math.round(m.y * cs)}px) translate(-50%, -100%)`;
      }
      for (const [k, el] of moverEls) if (!keepMovers.has(k)) { el.remove(); moverEls.delete(k); }
      drawMini();
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
      c.width = W + pad.l + pad.r;
      c.height = H + pad.t + pad.b;
      const g = c.getContext('2d');
      g.translate(pad.l, pad.t);
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
      // The frame's spare room is more land, not empty frame: the forest round the farm.
      const spareW = Math.max(0, (fw - 2) / fit - W), spareH = fh > 60 ? Math.floor(Math.max(0, (fh - 2) / fit - H)) : 0;
      const was = `${pad.l},${pad.r},${pad.t},${pad.b}`;
      // The panel lies over the frame's left edge: with room to spare, the farm sits beside it rather
      // than in the middle.
      const edge = sel => { const el = hudEl?.querySelector(sel); return el ? (el.offsetWidth + 16) / fit : 0; };
      const left = edge('.px-stats'), right = 0, room = spareW - left - right;
      const padL = spareW <= 0 ? 0 : room >= 0 ? left + room / 2 : (spareW * left) / Math.max(1, left + right);
      pad = { l: Math.floor(padL), r: Math.floor(spareW) - Math.floor(padL), t: Math.floor(spareH / 2), b: spareH - Math.floor(spareH / 2) };
      const EW = W + pad.l + pad.r, EH = H + pad.t + pad.b;
      cs = Math.max(0.25, Math.min(18, fit * zoom));
      const k = Math.max(1, Math.min(Math.ceil(cs * dpr), Math.floor(Math.sqrt(24e6 / (EW * EH)))));
      backing = k;
      canvas.width = EW * k;
      canvas.height = EH * k;
      canvas.style.width = `${EW * cs}px`;
      canvas.style.height = `${EH * cs}px`;
      canvas.dataset.pad = `${pad.l},${pad.t}`; // where the farm sits in the canvas, and how wide the land drawn is (for tests)
      canvas.dataset.ew = String(EW);
      ov.style.left = `${pad.l * cs}px`; // names and labels keep the farm's own coordinates
      ov.style.top = `${pad.t * cs}px`;
      if (was !== `${pad.l},${pad.r},${pad.t},${pad.b}`) bg = buildBg(); // the land grows with the frame
      ctx.setTransform(k, 0, 0, k, pad.l * k, pad.t * k);
      ctx.imageSmoothingEnabled = false;
      labelKey = '';
      layoutLabels();
      if (still) redrawStill(); else { sync(false); draw(); }
    }
    function apply(next) {
      got = true;
      host?.querySelector('.px-loading')?.remove();
      for (const m of next.mail ?? []) { // a new message between two farmers: a pigeon carries it, the diary notes it
        const key = `${m.from}>${m.to}@${m.at}`;
        if (seenMail.has(key)) continue;
        seenMail.add(key);
        const from = next.farmers.find(f => f.id === m.from), to = next.farmers.find(f => f.id === m.to);
        if (from && to) { addLog(from, `sends a note to ${to.name}: ${clip(m.text ?? '', 60)}`); if (!still) flights.push({ from: m.from, to: m.to, start: T }); }
      }
      scene = next;
      const news = th.setScene(next) ?? [];
      const want = layoutFor(next.fields).key;
      if (want !== layoutKey) { // fields came or went: new ground; farmers walk to their new spots
        th.relayout(next.fields);
        layoutKey = want;
        if (canvas) { bg = buildBg(); resize(); }
      }
      if (!canvas) return;
      if (still) redrawStill(); else sync(false);
      for (const ev of news) { // a harvest over its farmer, a sale at the stall
        const b = ev.id ? bots.get(ev.id) : null, at = ev.at ?? (b ? [b.x, b.y - th.SH * SC - 14] : null);
        if (at) pop(at[0], at[1], ev.text, ev.cls);
        if (ev.log) addLog(next.farmers.find(f => f.id === ev.id) ?? { name: 'The market', state: 'turn' }, ev.log);
      }
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
      if (e.target.closest?.('[data-farm-bell]')) {
        e.stopPropagation();
        bellOn = !bellOn;
        keep('tracker-bell', bellOn ? 'on' : 'off');
        opts.onBell?.(bellOn);
        renderHud();
        return;
      }
      const pick = e.target.closest?.('[data-farm-pick]');
      if (pick) { e.stopPropagation(); dlg?.close(); opts.onPickAgent?.(pick.dataset.farmPick); return; }
      const mem = e.target.closest?.('[data-farm-mem]');
      if (mem) { e.stopPropagation(); dlg?.close(); opts.onOpenDoc?.(mem.dataset.farmMem, mem.dataset.path); return; }
      if (e.target.closest?.('[data-farm-dlg-close]') || (dlg && e.target === dlg)) { e.stopPropagation(); dlg.close(); return; }
      if (dlg?.contains(e.target)) return;
      if (e.target.closest?.('[data-farm-panel]')) { e.stopPropagation(); panelOpen = !panelOpen; keep('tracker-farm-panel', panelOpen ? 'open' : 'folded'); renderHud(); resize(); return; }
      const navBtn = e.target.closest?.('[data-farm-nav]');
      if (navBtn) { e.stopPropagation(); opts.onNav?.(navBtn.dataset.farmNav); renderHud(); return; } // the dashboard's own buttons
      const stateBtn = e.target.closest?.('[data-farm-state]');
      if (stateBtn) { // a count: the first farmer in that state
        e.stopPropagation();
        const want = stateBtn.dataset.farmState, f = scene.farmers.find(x => x.state === want);
        if (f) opts.onPickAgent?.(f.id);
        return;
      }
      if (e.target.closest?.('[data-farm-need]')) { // the first farmer that needs you
        e.stopPropagation();
        const f = scene.farmers.find(x => x.state === 'waiting') ?? scene.farmers.find(x => x.question);
        if (f) opts.onPickAgent?.(f.id);
        return;
      }
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
      const hit = botAt(e);
      if (hit) { opts.onPickAgent?.(hit); return; }
      const [x, y] = farmPoint(e);
      const building = th.buildingAt?.(x, y);
      if (building) { openBuilding(building); return; }
      const key = th.fieldAt(x, y);
      if (key) opts.onOpenField?.(key);
    }
    /** A building, clicked: the barn starts a session; the rest open a dialog. */
    function openBuilding(k) {
      if (k === 'barn') { opts.onStartSession?.(); return; }
      if (!dlg) return;
      if (k === 'board') { void openBoard(); return; }
      const d = th.dialog(k);
      if (!d) return;
      dlg.querySelector('.px-dlg-title').textContent = d.title;
      dlg.querySelector('.px-dlg-body').innerHTML = d.html;
      if (!dlg.open) dlg.showModal();
    }
    /** The notice board: each project's CLAUDE.md and memory, read from one of its sessions. */
    async function openBoard() {
      dlg.querySelector('.px-dlg-title').textContent = 'The notice board: what your projects remember';
      const body = dlg.querySelector('.px-dlg-body');
      body.innerHTML = '<div class="loading"><span class="spinner"></span>Reading…</div>';
      if (!dlg.open) dlg.showModal();
      const sessions = th.boardSessions();
      const parts = await Promise.all(sessions.map(async f => {
        try {
          const r = await fetch(`/api/agent/${encodeURIComponent(f.id)}/files`, { headers: { 'x-tracker-token': opts.token } });
          const d = r.ok ? await r.json() : null;
          const files = d?.memory ?? [];
          return `<h4>${esc(f.cwd.split('/').pop() || f.cwd)}</h4>${files.length ? `<ul class="px-dl">${files.map(m => `<li><button type="button" class="act" data-farm-mem="${esc(f.id)}" data-path="${esc(m.path)}">${esc(m.label)}</button><span class="muted">${esc(m.where)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing remembered here yet.</p>'}`;
        } catch {
          return `<h4>${esc(f.cwd)}</h4><p class="muted">Could not read it.</p>`;
        }
      }));
      body.innerHTML = parts.join('') || '<p class="muted">No sessions on the farm.</p>';
    }
    /** The minimap: the whole farm small in a corner while zoomed in, the view a box on it; click it to go there. */
    function drawMini() {
      if (!mini || !viewEl || !bg) return;
      const zoomed = viewEl.scrollWidth > viewEl.clientWidth + 2 || viewEl.scrollHeight > viewEl.clientHeight + 2;
      mini.hidden = !zoomed;
      if (!zoomed) return;
      const EW = W + pad.l + pad.r, EH = th.layout().H + pad.t + pad.b, mw = 150, mh = Math.round((mw * EH) / EW);
      if (mini.width !== mw || mini.height !== mh) { mini.width = mw; mini.height = mh; }
      const g = mini.getContext('2d'), k = mw / EW;
      g.imageSmoothingEnabled = true;
      g.drawImage(bg, 0, 0, mw, mh);
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b) { g.fillStyle = f.state === 'waiting' ? '#e04a3a' : SHIRT[f.color]; g.fillRect(Math.round((b.x + pad.l) * k) - 1, Math.round((b.y + pad.t) * k) - 2, 3, 3); } }
      const stage = canvas.parentElement, vx = (viewEl.scrollLeft - stage.offsetLeft) / cs, vy = (viewEl.scrollTop - stage.offsetTop) / cs;
      g.strokeStyle = '#ffd43b'; g.lineWidth = 1.5;
      g.strokeRect(Math.max(0, vx * k), Math.max(0, vy * k), Math.min(mw, (viewEl.clientWidth / cs) * k), Math.min(mh, (viewEl.clientHeight / cs) * k));
    }
    function onMiniClick(e) {
      const r = mini.getBoundingClientRect(), k = (W + pad.l + pad.r) / r.width, stage = canvas.parentElement;
      viewEl.scrollLeft = (e.clientX - r.left) * k * cs + stage.offsetLeft - viewEl.clientWidth / 2;
      viewEl.scrollTop = (e.clientY - r.top) * k * cs + stage.offsetTop - viewEl.clientHeight / 2;
      if (follow) { follow = false; renderHud(); }
      if (still) drawMini();
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
        host.innerHTML = `<div class="px"><div class="px-host"><div class="px-view"><div class="px-stage"><canvas aria-label="Pixel farm: every farmer is an agent, every field a repo"></canvas><div class="px-ov"></div>${got ? '' : '<div class="px-loading"><span class="spinner"></span>Loading the farm…</div>'}</div></div><div class="px-hud"></div></div>
          ${under}</div>
          <dialog class="px-help" aria-label="How to read the farm"><header><b>How to read the farm</b><button type="button" class="x" data-farm-help-close aria-label="Close">×</button></header>${helpHtml()}</dialog>
          <dialog class="px-help px-dlg" aria-label="The farm"><header><b class="px-dlg-title"></b><button type="button" class="x" data-farm-dlg-close aria-label="Close">×</button></header><div class="px-dlg-body"></div></dialog>`;
        canvas = host.querySelector('canvas');
        ctx = canvas.getContext('2d');
        viewEl = host.querySelector('.px-view');
        ov = host.querySelector('.px-ov');
        logEl = opts.diary ?? host.querySelector('.px-log');
        hudEl = host.querySelector('.px-hud');
        dlg = host.querySelector('.px-dlg');
        mini = document.createElement('canvas');
        mini.className = 'px-mini';
        mini.hidden = true;
        mini.title = 'The whole farm: click to go there';
        host.querySelector('.px-host').appendChild(mini);
        mini.addEventListener('click', onMiniClick);
        moverEls.clear();
        for (const b of bots.values()) { b.tag = null; b.tagText = ''; }
        layoutKey = null;
        labelKey = '';
        th.relayout(scene.fields);
        layoutKey = layoutFor(scene.fields).key;
        renderHud(); // before the first fit: the panel's and switches' size place the farm
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
        viewEl.addEventListener('pointerleave', () => setHover(null));
        viewEl.addEventListener('scroll', () => { if (still) drawMini(); }, { passive: true });
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
        host = canvas = ctx = ov = logEl = hudEl = viewEl = dlg = mini = null;
        moverEls.clear();
        drag = null;
        hoverId = null;
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
    toScene, fieldOf, weatherOf, contextPct, askText, helpHtml, layoutFor,
  };
})();
