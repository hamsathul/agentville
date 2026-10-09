// The world engine: it places each agent where its world says, walks it there, and draws the world's
// pieces each frame; it keeps the name tags, speech bubbles, pop-ups, zoom, panning, the minimap, the
// HUD's switches and a field's close-up. A world gives it hooks (docs/worlds.md, "Hooks"). Plain script
// in a world's frame, after pixel.js. No dependencies.
'use strict';

/* ---------- worlds: the states, the repo grid, the defaults, the engine's scene, Agentville.world ---------- */

// The states an agent is out and about in: its bubble shows, its field grows.
const ACTIVE = new Set(['waiting', 'working', 'turn']);

// A project: the folder holding sibling repos. The scene says which (a repo's `project`); a field
// without one falls back to its path, read the same way as web/scene.js reads it.
const CATCH_ALL = new Set(['code', 'projects', 'repos', 'src', 'dev', 'work', 'tools', 'github', 'git', 'documents', 'desktop', 'downloads', 'workspace', 'workspaces', 'sites', 'apps', 'clients', 'tmp']);
function projectOf(path) {
  const parts = String(path).split('/').filter(Boolean).slice(0, -1);
  return parts.length >= 3 && !CATCH_ALL.has(parts.at(-1).toLowerCase()) ? `/${parts.join('/')}` : null;
}
// A field keeps its bed; one that leaves keeps it held for a day, so it comes back to the same place.
const BED_HELD_MS = 86_400_000;

/**
 * The repo grid an engine world lays its fields out on: a bed per repo, in rows of `cols`. While you
 * look a repo keeps its bed (a new one takes a free bed near its project's, a worktree right after its
 * repo), a repo that leaves keeps its bed for a day, and when the page opens the beds are packed. The
 * farm's is 3 across, 88 × 62, from (174, 100).
 */
function makeGrid({ cols = 3, colW, rowH, cx0, top0, minRows = 3, maxRows = 6, max = 18, slot = () => ({}), fence, height }) {
  const slotAt = i => { const cx = cx0 + (i % cols) * colW, rowTop = top0 + Math.floor(i / cols) * rowH; return { i, cx, rowTop, ...slot(cx, rowTop) }; };
  /** The fields as units to place: a project's repos together, else a repo alone; a worktree right after its repo. */
  function unitsOf(fields) {
    const byKey = new Map(fields.map(f => [f.key, f]));
    const home = f => (f.worktree && f.main ? f.main : f.key);
    const units = new Map();
    for (const f of fields) {
      const project = f.project !== undefined ? f.project : projectOf(home(f)), id = project ?? `repo:${home(f)}`;
      if (!units.has(id)) units.set(id, { project, name: f.projectName ?? (project ? project.split('/').pop() : null), keys: [] });
      units.get(id).keys.push(f.key);
    }
    for (const u of units.values()) { // each repo, then its worktrees
      const order = [];
      for (const k of u.keys) if (!byKey.get(k).worktree) { order.push(k); for (const w of u.keys) if (byKey.get(w).worktree && byKey.get(w).main === k) order.push(w); }
      for (const k of u.keys) if (!order.includes(k)) order.push(k);
      u.keys = order;
      if (u.project && new Set(u.keys.map(k => home(byKey.get(k)))).size < 2) u.project = null; // one repo is no project
    }
    return { byKey, units: [...units.values()] };
  }
  const groupsOf = units => units.filter(u => u.project).map(u => ({ name: u.name, keys: u.keys }));
  /** Which bed each field gets, the first time: a project's repos side by side (kept to one row when they fit). */
  function arrange(fields) {
    const { units } = unitsOf(fields);
    const slotOf = new Map(), queue = [...units];
    let row = 0, col = 0;
    const place = u => { for (const k of u.keys) { slotOf.set(k, row * cols + col); if (++col === cols) { col = 0; row++; } } };
    while (queue.length) {
      const n = queue[0].keys.length;
      if (col > 0 && (n > cols || col + n > cols)) { // it does not fit the rest of this row: a smaller one may, else the next row
        const j = queue.findIndex(u => u.keys.length <= cols - col);
        if (j > 0) place(queue.splice(j, 1)[0]); else { row++; col = 0; }
        continue;
      }
      place(queue.shift());
    }
    return { slotOf, groups: groupsOf(units) };
  }
  /** Beds that stay put, from `beds` (key → { i, left? }). Returns { slotOf, groups, beds } (beds: what to remember now). */
  function placeBeds(fields, beds, now) {
    if (!Object.keys(beds).length) {
      const { slotOf, groups } = arrange(fields);
      return { slotOf, groups, beds: Object.fromEntries([...slotOf].map(([k, i]) => [k, { i }])) };
    }
    const { byKey, units } = unitsOf(fields);
    const slotOf = new Map(), kept = {}, taken = new Set(), held = new Set();
    for (const [k, b] of Object.entries(beds)) {
      if (!Number.isInteger(b?.i)) continue;
      if (byKey.has(k)) { if (!taken.has(b.i)) { slotOf.set(k, b.i); taken.add(b.i); kept[k] = { i: b.i }; } }
      else if (now - (b.left ?? now) < BED_HELD_MS) { kept[k] = { i: b.i, left: b.left ?? now }; held.add(b.i); }
    }
    const dist = (i, j) => Math.abs(Math.floor(i / cols) - Math.floor(j / cols)) * 10 + Math.abs((i % cols) - (j % cols));
    const free = () => Array.from({ length: max }, (_, i) => i).filter(i => !taken.has(i) && !held.has(i));
    for (const u of units) {
      for (const k of u.keys) {
        if (slotOf.has(k)) continue;
        const f = byKey.get(k), open = free();
        const near = f.worktree && slotOf.has(f.main) ? [slotOf.get(f.main)] : u.project ? u.keys.filter(x => slotOf.has(x)).map(x => slotOf.get(x)) : [];
        let i;
        if (!open.length) i = max + slotOf.size; // the grid is full: "+N more"
        else if (near.length) {
          const next = near.map(n => n + 1).find(n => n % cols !== 0 && open.includes(n)); // right after it, in the same row
          i = next ?? open.reduce((best, b) => (Math.min(...near.map(n => dist(b, n))) < Math.min(...near.map(n => dist(best, n))) ? b : best));
        } else i = open[0];
        slotOf.set(k, i);
        taken.add(i);
        kept[k] = { i };
      }
    }
    return { slotOf, groups: groupsOf(units), beds: kept };
  }
  /** The ground for these fields: the beds remembered in `beds` stay put (null: laid out afresh). */
  function layoutFor(fields, beds = null, now = Date.now()) {
    const placed = beds ? placeBeds(fields, beds, now) : { ...arrange(fields), beds: null };
    const { slotOf, groups } = placed;
    const shown = fields.filter(f => slotOf.get(f.key) < max);
    const last = Math.max(-1, ...shown.map(f => slotOf.get(f.key)));
    const rows = Math.min(maxRows, Math.max(minRows, Math.floor(last / cols) + 1));
    const slots = Array.from({ length: rows * cols }, (_, i) => slotAt(i));
    const ST = shown.map(f => ({ key: f.key, ...slots[slotOf.get(f.key)] }));
    const used = new Set(ST.map(s => s.i));
    const GRID = fence(rows);
    return {
      // the key goes by bed: the same ground, whatever order the repos are listed in
      key: [...ST].sort((a, b) => a.i - b.i).map(s => `${s.key}@${s.i}`).join('\n'), ST, slots, empty: slots.filter(s => !used.has(s.i)), rows, GRID, H: height(GRID),
      groups: groups.map(g => ({ name: g.name, slots: g.keys.filter(k => slotOf.get(k) < rows * cols).map(k => slotOf.get(k)) })).filter(g => g.slots.length),
      more: fields.length - shown.length,
      beds: placed.beds,
    };
  }
  /** The ground when the page opens: the fields in the order of the beds they had, packed into the first free beds. */
  function packedLayout(fields, beds, now = Date.now()) {
    const at = k => (Number.isInteger(beds?.[k]?.i) ? beds[k].i : Infinity);
    return layoutFor([...fields].sort((x, y) => at(x.key) - at(y.key)), {}, now);
  }
  return { layoutFor, packedLayout, slotAt, cols };
}

/**
 * The engine's scene, from the page's plain-facts one (web/scene.js), under the names the engine draws
 * from: agents as `farmers` (each in its `field`, `pct` of context used, `hearts` left of 4, `shirt` its
 * colour), repos as `fields`, the plan as windows. A world adds its own looks on top (the farm: hats, crops).
 */
function engineScene(s) {
  return {
    plan: s.plan ? { windows: s.plan.windows.map(w => ({ kind: w.kind, percentUsed: w.pct, resetsAt: w.resetsAt, reset: w.reset })) } : null,
    chrome: s.chrome,
    subagents: s.subagents,
    mail: s.mail,
    carts: s.mcp,
    henhouse: { eggs: s.subagentCounts.done, roosting: s.subagentCounts.overflow },
    fields: s.repos.map(r => ({ ...r, weather: null, lastDeploy: r.deploy && !r.deploy.run ? r.deploy : null })),
    farmers: s.agents.map(a => ({ ...a, field: a.repo, pct: a.contextPct, hearts: Math.round((1 - a.contextPct) * 4), color: a.colorIndex, shirt: a.color })),
  };
}

/** The HUD a world gets unless it draws its own: the dashboard's buttons, the sky, help and zoom. */
function defaultHud({ zoom = 1, skyMode = 'live', still = false, nav = {}, animals = null }) {
  const btn = (attr, label, title, pressed) => `<button type="button" ${attr} title="${esc(title)}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${pxImg(label, '#4e3626', null)}<span class="px-sr">${esc(label)}</span></button>`;
  return `<div class="px-nav">${btn('data-farm-nav="list"', 'List', 'The list of agents')}${btn('data-farm-nav="worlds"', 'World', 'Choose a world')}${btn('data-farm-nav="side"', 'Sidebar', 'The selected agent beside the map', Boolean(nav.side))}</div>
    <div class="px-tools">${btn('data-farm-sky', `Sky: ${skyMode}`, 'Live follows your clock; or day, or night')}${btn('data-farm-motion', `Motion: ${still ? 'off' : 'on'}`, 'Walking and animation')}${animals === null ? '' : btn('data-farm-animals', `Animals: ${animals ? 'on' : 'off'}`, 'Animals that live here, just for fun: click one to pet or feed it', animals)}${btn('data-farm-help', 'Help', 'How to read this world')}
      <span class="px-zoombar">${btn('data-farm-zoom="-1"', '-', 'Zoom out')}${btn('data-farm-zoom="0"', `${Math.round(zoom * 100)}%`, 'The whole world')}${btn('data-farm-zoom="1"', '+', 'Zoom in')}</span></div>`;
}

/** A world's hooks, with the engine's default for each one it leaves out (docs/worlds.md, "Hooks"). */
function withDefaults(h) {
  if (!(h.W > 0)) throw new Error('A world needs its width, W (in world pixels).');
  for (const need of ['slots', 'drawChar', 'bg']) if (typeof h[need] !== 'function') throw new Error(`A world needs a ${need}() hook.`);
  const nouns = { agent: 'agent', agents: 'agents', repo: 'repo', repos: 'repos', ...h.nouns };
  // The default grid is centred on W, from the config merged over 3 × 88 × 62: columns centred, a
  // fence half a column wider each side (kept inside 0..W) unless the world gives cx0 or a fence itself.
  const g = h.grid ?? {};
  const grid = g.layoutFor ? g : (() => {
    const cols = g.cols ?? 3, colW = g.colW ?? 88, rowH = g.rowH ?? 62;
    const cx0 = g.cx0 ?? Math.round(h.W / 2 - ((cols - 1) * colW) / 2);
    return makeGrid({
      cols, colW, rowH, cx0, top0: 100, slot: (cx, rowTop) => ({ lane: rowTop + 44 }),
      fence: rows => ({ x0: Math.max(0, cx0 - Math.round(colW / 2)), x1: Math.min(h.W, cx0 + (cols - 1) * colW + Math.round(colW / 2)), y0: 96, y1: 104 + rows * rowH }),
      height: f => f.y1 + 28, ...g,
    });
  })();
  let L = grid.layoutFor([]), fields = [];
  const ownSetScene = h.setScene;
  const out = {
    drawFx() {},
    key: 'world', SH: 16, corridors: [Math.round(h.W / 2)], fromScene: engineScene,
    layout: () => L, relayout(g) { L = g; return L; },
    setScene(next) { fields = next.fields; return []; }, spawn: () => [Math.round(h.W / 2), 0], follow: (b, k) => [b.x - 8 - k * 7, b.y + 2],
    startText: n => `${n} ${n === 1 ? nouns.agent : nouns.agents} here`, arriveText: 'arrives',
    tag: f => cutMid(f.name, 16), tip: f => f.name, onMove() {}, speed: () => 40, zoneText: () => 'moves',
    hud: defaultHud, ground() {}, season: () => 'summer', shadows() {}, lights: () => [], items: () => [], top() {}, movers: () => [],
    // each field's name under its bed (a world that gives its own layout() gets these under its own beds)
    labels: lab => { for (const s of out.layout().ST) lab(s.cx, s.rowTop + 50, pxt(cutMid(fields.find(f => f.key === s.key)?.name ?? '', 16)), 'zone'); },
    fieldAt: () => null, buildingAt: () => null, buildingTip: () => '', dialog: () => null, boardSessions: () => [],
    help: () => `<div class="px-key"><b>${esc(nouns.agents)}</b><span>one for each agent working on this Mac</span><b>${esc(nouns.repos)}</b><span>one for each repo an agent works in</span></div>`,
    ...h, grid,
    // the fields are always recorded here (the default labels read them), whoever's setScene runs
    setScene(next) { fields = next.fields; return ownSetScene ? ownSetScene.call(h, next) : []; },
  };
  if (!Array.isArray(out.corridors) || !out.corridors.length || !out.corridors.every(Number.isFinite)) throw new Error("A world's corridors are the x positions of its paths (at least one).");
  return out;
}

/** A world drawn by the engine, from its hooks; the bridge (bridge.js) runs it. */
window.Agentville.world = hooks => {
  const th = withDefaults(hooks);
  let view = null, field = null;
  window.Agentville.raw({
    start({ el, opts, prefs }) {
      view = makePixelView(th, prefs);
      field = makeField(view);
      field.setOptions(opts);
      view.mount(el, { ...opts, onOpenField: key => field.open(key) });
    },
    scene(s) { view.update(th.fromScene(s)); field.refresh(); },
    select(id) { view.select(id ?? null); },
  }, { engine: true }); // its HUD has the dashboard's buttons: the page adds no corner control
};

/* ---------- the engine: positions, walking, tags, pop-ups, diary, the loop ---------- */

function makePixelView(th, prefs) {
  let host = null, canvas = null, ctx = null, ov = null, hudEl = null, bg = null, ro = null;
  let raf = 0, last = 0, T = 0, cs = 1, first = true, timer = 0, layoutKey = null, labelKey = '';
  let placeTimer = 0, placed = false;
  let viewEl = null, drag = null, dragged = false, backing = 1, hoverId = null; // the frame the farm is seen through; a drag that pans it; the farmer under the pointer
  let scene = { fields: [], farmers: [] }, overflow = {}, still = false, opts = {}, selectedId = null, got = false; // got: a scene has arrived
  // Zoom on top of "the whole farm in the frame", and speech bubbles (each can be closed until its farmer says something new).
  const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  // The bed each field has had, kept across reloads, so fields stay put as repos and worktrees come and go.
  let beds = (() => { try { const b = JSON.parse(prefs.get('beds') ?? '{}'); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; } })();
  // While you look, a field keeps its bed; when the page opens, fields move up into free beds, so empty rows close up.
  let packed = false;
  const groundFor = fields => {
    if (packed || !fields.length) return th.grid.layoutFor(fields, beds);
    packed = true;
    return th.grid.packedLayout(fields, beds);
  };
  const settle = ground => { beds = ground.beds; prefs.set('beds', JSON.stringify(beds)); th.relayout(ground); layoutKey = ground.key; placeAnimals(); };
  let zoom = ZOOMS.includes(Number(prefs.get('zoom'))) ? Number(prefs.get('zoom')) : 1;
  let saysOn = prefs.get('bubbles') !== 'off';
  // The sky: live (your clock), or held at day or night.
  const SKIES = ['live', 'day', 'night'];
  let skyMode = SKIES.includes(prefs.get('sky')) ? prefs.get('sky') : 'live';
  let bgSeason = null;
  let follow = false; // keep the picked farmer in the middle of the view
  let restingShown = prefs.get('resting') !== 'hidden'; // idle and stale farmers on the farm, or not
  let bellOn = prefs.get('bell') === 'on';
  let panelOpen = prefs.get('panel') !== 'folded'; // the farm's panel: counts and meters, or folded to its title // a chime and a desktop notice when an agent starts waiting (the page rings it)
  const moverEls = new Map(); // labels that move: key → element
  let dlg = null, mini = null; // the buildings' dialog; the minimap shown while zoomed in
  let hudBoxes = []; // the panel and buttons lying over the farm, in the frame's coordinates: bubbles keep clear of them
  const resting = f => f.state === 'idle' || f.state === 'stale';
  let glide = null; // a zoom easing in: { from: scale, start, ox, oy }
  let pad = { l: 0, r: 0, t: 0, b: 0 }; // the frame's spare room, in world pixels: more forest all round
  const extOf = () => ({ x0: -pad.l, x1: th.W + pad.r, y0: -pad.t, y1: th.layout().H + pad.b });
  const skyNow = () => skyAt(skyMode === 'day' ? new Date(2000, 0, 1, 12) : skyMode === 'night' ? new Date(2000, 0, 1, 23) : new Date());
  let wheel = 0;
  const says = new Map(); // farmer id → { el, text }
  const closedSays = new Map(); // farmer id → the text that was closed
  const bots = new Map(), log = [];
  const parts = []; // particles on the farm now
  const flights = [], seenMail = new Set(); // carrier pigeons between farmers: { from, to, start }
  const addPart = p => { if (parts.length < 400) parts.push(p); };
  // The world's animals (sdk/animals.js), when it has any: on unless switched off (docs/worlds.md, "Creatures").
  const cast = typeof th.animals === 'function' ? th.animals() ?? [] : [];
  const kit = cast.length && typeof makeAnimals === 'function' ? makeAnimals(cast, { random: seededRandom(cast.length * 7919) }) : null;
  let animalsOn = prefs.get('animals') !== 'off';
  const animalsShown = () => Boolean(kit && animalsOn);
  const placeAnimals = () => kit?.place({ roam: th.roam?.() ?? [], avoid: th.avoid?.() ?? [], blocked: (x, y) => Boolean(th.fieldAt(x, y) || th.buildingAt?.(x, y)) }); // never on a field or a building, whatever roam says
  const animalSays = new Map(); // creature id → its bubble element
  let stillAt = 0; // when the animals were last drawn still: their lines keep time with motion off
  if (typeof window !== 'undefined' && window.Agentville) window.Agentville.animalsNow = () => (kit ? kit.list() : []); // read-only: where they are (the browser test)
  const errands = typeof makeErrands === 'function' ? makeErrands() : null; // farmers borrowed by animals (sdk/animals.js)
  let menuEl = null, menuFor = null; // the open animal menu: its element and { id, doer }
  const awayIds = () => new Set(scene.farmers.filter(f => errands?.has(f.id)).map(f => f.id));
  const forYou = f => f.state === 'waiting' || f.state === 'turn'; // waiting on you, or its turn ended: it stays where you can see it
  /** How long a farmer takes to an animal's spot and back, with its moment there (s): a busy one goes only if it fits its few seconds. */
  function tripS(f, to) { const b = bots.get(f.id); if (!b) return Infinity; let d = 0, at = [b.x, b.y]; for (const q of plan(b, to[0], to[1])) { d += Math.hypot(q[0] - at[0], q[1] - at[1]); at = q; } return (2 * d) / (th.speed?.(f) ?? 40) + 1.5; }
  const canGo = to => f => f.state !== 'working' || tripS(f, to) <= 5;
  function freeFarmers(to) { return scene.farmers.filter(f => bots.has(f.id) && !forYou(f) && !errands?.has(f.id) && canGo(to)(f)); }
  function closeMenu() { menuFor = null; menuEl?.remove(); menuEl = null; }
  function openMenu(id) {
    const o = kit.where(id);
    if (!o) return;
    const doer = still ? null : chooseDoer(scene.farmers, fid => bots.get(fid) ?? null, o.x, o.y, awayIds(), canGo(o.stand)); // motion off: no one walks, you do it
    menuFor = { id, doer: doer?.id ?? null };
    renderMenu();
  }
  function renderMenu() {
    const m = menuFor && kit.menu(menuFor.id), o = menuFor && kit.where(menuFor.id);
    if (!m || !o || !ov) { closeMenu(); return; }
    if (!menuEl) { menuEl = document.createElement('div'); menuEl.className = 'px-animal-menu'; menuEl.setAttribute('role', 'menu'); ov.appendChild(menuEl); }
    const free = freeFarmers(o.stand), doer = scene.farmers.find(f => f.id === menuFor.doer);
    menuEl.innerHTML = `<b>${esc(m.title)}</b>${m.actions.map((a, i) => `<button type="button" role="menuitem" data-animal-act="${i}">${esc(a)}</button>`).join('')}
      <span class="px-animal-who">${doer ? `${esc(doer.name)} will go` : 'You do it'}${still ? '' : free.filter(f => f.id !== menuFor.doer).map(f => `<button type="button" data-animal-who="${esc(f.id)}" title="Send ${esc(f.name)} instead" aria-label="Send ${esc(f.name)} instead" style="background:${esc(f.shirt ?? '#9aa0a6')}"></button>`).join('')}</span>`;
    menuEl.style.transform = `translate(${Math.round(o.x * cs)}px, ${Math.round((o.y - o.h - 4) * cs)}px) translate(-50%, -100%)`;
  }
  /** An action from the menu: the farmer chosen walks over and does it; with no one (or motion off), you do it in place. */
  function doAct(i) {
    const { id, doer } = menuFor;
    closeMenu();
    const o = kit.where(id), f = doer && scene.farmers.find(x => x.id === doer);
    const done = by => { const r = kit.perform(id, i, by); if (r) showFx(r); if (still) redrawStill(); }; // still: shown at once (no frame loop to draw it)
    if (!o || !f || !bots.has(f.id) || still || !errands) { done(null); return; }
    errands.start(f.id, { x: o.stand[0], y: o.stand[1], now: T, busy: f.state === 'working', then: () => done(f.name), missed: () => done(null) });
    sync(false);
  }
  function showFx(r) {
    const [x, y] = r.at;
    if (r.fx === 'hearts') pop(x, y - 12, '♥', 'good');
    if (r.fx === 'crumbs') for (let k = 0; k < 12; k++) addPart({ x: x + rand(-8, 8), y: y - 2, vx: rand(-14, 14), vy: rand(-22, -8), g: 70, life: 0.8, max: 0.8, size: 1, color: '#e9c46a' });
    if (r.fx === 'dust') for (let k = 0; k < 8; k++) addPart({ x: x + rand(-4, 4), y: y - 1, vx: rand(-18, 18), vy: rand(-12, -4), g: 30, life: 0.5, max: 0.5, size: rand(1, 2), color: '#c9a46a', alpha: 0.7 });
  }
  function onMenuKey(e) { if (e.key === 'Escape' && menuFor) closeMenu(); }

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
        if (i >= s.cap) { over[s.group] = (over[s.group] ?? 0) + 1; continue; }
        at = s.at(i);
      }
      const away = errands?.target(f); // borrowed by an animal: there instead, same zone (no diary line); waiting drops it
      out.set(f.id, away ? { x: away[0], y: away[1], zone: s.zone } : { x: at[0], y: at[1], zone: s.zone });
    }
    overflow = over;
    return out;
  }
  // Walk along the corridors between field columns, so farmers never cross a field.
  function plan(b, tx, ty) {
    if (Math.abs(b.y - ty) < 0.5) return [[tx, ty]];
    const c = th.corridors.reduce((best, x) => (Math.abs(b.x - x) + Math.abs(tx - x) < Math.abs(b.x - best) + Math.abs(tx - best) ? x : best));
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
    if (hudEl) hudEl.innerHTML = th.hud({ still, zoom, saysOn, skyMode, follow, canFollow: Boolean(selectedId && bots.has(selectedId)), restingHidden: restingShown ? null : scene.farmers.filter(resting).length, bell: bellOn, nav: opts.navState?.() ?? {}, panelOpen, animals: kit ? animalsOn : null });
    placeMini();
  }
  /** The minimap sits just above the switches, which take more rows in a narrow frame (the sidebar open). */
  function placeMini() {
    const tools = hudEl?.querySelector('.px-tools');
    if (mini && tools) mini.style.bottom = `${tools.offsetHeight + 16}px`;
    if (!hudEl || !viewEl) return;
    const v = viewEl.getBoundingClientRect(); // and where the panel and buttons lie, for the bubbles
    hudBoxes = [...hudEl.children].map(el => el.getBoundingClientRect()).filter(r => r.width && r.height)
      .map(r => ({ left: r.left - v.left, right: r.right - v.left, top: r.top - v.top, bottom: r.bottom - v.top }));
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
    prefs.set('zoom', String(zoom));
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
    // A frame's time is when it began, which can be before the zoom: never run backwards (the farm would
    // shrink past where it was, then pop, a flicker on a slow frame).
    const stage = canvas.parentElement, t = Math.min(1, Math.max(0, (now - glide.start) / 200));
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
    const r = canvas.getBoundingClientRect(), on = r.width / (th.W + pad.l + pad.r) || cs, x = (e.clientX - r.left) / on - pad.l, y = (e.clientY - r.top) / on - pad.t; // the size on screen: right even while a zoom glides
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
    const r = canvas.getBoundingClientRect(), on = r.width / (th.W + pad.l + pad.r) || cs;
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
    // what a click does mirrors the page's pickFromFarm: what the farmer said opens its whole conversation; waiting, a button question and codex open the sidebar
    const toSidebar = f.state === 'waiting' || !!f.question || f.kind === 'codex';
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
    } else if (s.text !== text || s.toSidebar !== toSidebar) {
      s.el.querySelector('span').textContent = text;
      s.el.className = `px-say st-${f.state}${f.question ? ' q' : ''}`;
      s.el.title = `${f.name}: ${text} (click to ${toSidebar ? 'open it in the sidebar' : 'read the whole conversation'})`;
      s.text = text;
      s.toSidebar = toSidebar;
      s.w = null; // measured again
    }
    s.x = Math.round(b.x * cs);
    s.bottom = Math.round((b.y - th.SH * SC - 3 - b.lift) * cs) - (b.shown ? (b.tagH || 15) + 3 : 2); // just above its farmer's name tag, or its head
    s.reach = b.shown ? Math.max(0, (b.tagW || 0) / 2 - 4) : 0; // how far along the tag a line from the side may end
    s.foot = Math.round(b.y * cs);
    s.seen = true;
  }
  /**
   * Keeps speech bubbles off each other and off name tags: from left to right, a bubble that
   * would land on one already placed is lifted above it, with a line down to its farmer. Where
   * that would lift it past the farm's top edge, it moves sideways instead, to the nearest free
   * spot at its own height, and its line slants across to its farmer.
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
    // The farm's edges in the overlay's coordinates: the stage cuts off anything past them.
    const edge = { top: -pad.t * cs + 2, left: -pad.l * cs + 2, right: (th.W + pad.r) * cs - 2 };
    if (zoom <= 1 && viewEl) { // the whole farm in view: keep clear of the panel and the buttons lying over it
      const stage = canvas.parentElement, dx = viewEl.scrollLeft - stage.offsetLeft - pad.l * cs, dy = viewEl.scrollTop - stage.offsetTop - pad.t * cs;
      for (const r of hudBoxes) placed.push({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy });
    }
    const hitAt = (left, bottom, s) => placed.find(r => left < r.right + 3 && left + s.w > r.left - 3 && bottom - s.h < r.bottom + 3 && bottom > r.top - 3);
    list.forEach((s, i) => {
      const home = Math.max(edge.left, Math.min(s.x - s.w / 2, edge.right - s.w));
      let left = home, bottom = s.bottom;
      for (let guard = 0; guard < 30; guard++) {
        const hit = hitAt(left, bottom, s);
        if (!hit) break;
        bottom = hit.top - 6;
      }
      if (bottom - s.h < edge.top) { // no room above: the nearest free spot to one side, at its height or lower, down to its farmer's feet
        const slide = (dir, row) => {
          let l = home;
          for (let guard = 0; guard < 30; guard++) {
            const hit = hitAt(l, row, s);
            if (!hit) return l;
            l = dir > 0 ? hit.right + 4 : hit.left - 4 - s.w;
            if (l < edge.left || l + s.w > edge.right) return null;
          }
          return null;
        };
        let best = null;
        for (let row = Math.max(s.bottom, edge.top + s.h); row <= Math.max(s.bottom, s.foot); row += 6) {
          for (const dir of [1, -1]) {
            const l = slide(dir, row), cost = l == null ? Infinity : Math.abs(l - home) + 2 * (row - s.bottom);
            if (cost < (best?.cost ?? Infinity)) best = { l, row, cost };
          }
        }
        if (best) { left = best.l; bottom = best.row; } else bottom = edge.top + s.h; // nowhere free: kept in, over the others
      }
      placed.push({ left, right: left + s.w, top: bottom - s.h, bottom });
      // Its line leaves from its bottom edge when it is over its farmer, else from the side nearer it
      // to the nearest end of the farmer's name, and the arrow's tip touches just over it.
      const top = bottom - s.h, ty = s.bottom + 4, under = s.x >= left + 10 && s.x <= left + s.w - 10;
      const px = under ? s.x : s.x < left ? left + 1 : left + s.w - 1, py = under ? bottom - 2 : Math.max(top + 8, Math.min(ty, bottom - 8));
      const tx = under ? s.x : Math.max(s.x - s.reach, Math.min(px, s.x + s.reach));
      const lead = Math.max(0, Math.hypot(tx - px, ty - py) - 6), turn = under ? 0 : Math.atan2(px - tx, ty - py);
      s.el.style.setProperty('--lx', `${Math.round(px - left - 2)}px`);
      s.el.style.setProperty('--ly', under ? '100%' : `${Math.round(py - top - 2)}px`);
      s.el.style.setProperty('--lead', `${Math.round(lead)}px`);
      s.el.style.setProperty('--turn', `${turn.toFixed(3)}rad`);
      s.el.style.zIndex = String(40 - Math.min(i, 30) + (lead > 0 ? 0 : 10)); // moved ones sit behind
      s.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    });
    return placed;
  }

  function addLog(f, text) {
    log.unshift({ at: Date.now(), state: f.state, who: f.name, text });
    log.length = Math.min(log.length, 8);
    renderLog();
  }
  /** The diary goes to the page (its sidebar), as entries: text only, never HTML. */
  function renderLog() { opts.onDiary?.(log.map(l => ({ ...l }))); }
  function sync(snapTo) {
    const tg = targets();
    if (first && tg.size) log.unshift({ at: Date.now(), state: 'working', who: '', text: th.startText(tg.size).replace(/<[^>]*>/g, '') });
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
  /**
   * The animals' bubbles, after the farmers': each over its creature, lifted off a farmer's bubble or
   * name; still in the way after that, it waits (hidden). Text only.
   */
  function placeAnimalSays(placed) {
    const want = animalsShown() ? kit.bubbles() : [];
    for (const [id, el] of animalSays) if (!want.some(s => s.id === id)) { el.remove(); animalSays.delete(id); }
    if (want.length) { // also clear of the signs and counters, the moving labels, the HUD (at any zoom) and every farmer that needs you
      const o = ov.getBoundingClientRect(), box = r => ({ left: r.left - o.left, right: r.right - o.left, top: r.top - o.top, bottom: r.bottom - o.top });
      for (const el of ov.querySelectorAll('.px-lab, .px-mover')) placed.push(box(el.getBoundingClientRect()));
      for (const el of hudEl ? [...hudEl.children] : []) { const r = el.getBoundingClientRect(); if (r.width && r.height) placed.push(box(r)); }
      for (const f of scene.farmers) { const b = bots.get(f.id); if (b && forYou(f)) placed.push({ left: (b.x - 8) * cs, right: (b.x + 8) * cs, top: (b.y - th.SH * SC - 2) * cs, bottom: (b.y + 2) * cs }); }
    }
    for (const s of want) {
      let el = animalSays.get(s.id);
      if (!el) { el = document.createElement('div'); el.className = 'px-animal-say'; el.dataset.animalSay = s.id; ov.appendChild(el); animalSays.set(s.id, el); }
      if (el.textContent !== s.text) el.textContent = s.text;
      const w = el.offsetWidth || 60, h = el.offsetHeight || 14;
      const left = Math.round(s.x * cs - w / 2);
      let bottom = Math.round(s.y * cs);
      const hitAt = b => placed.find(r => left < r.right + 3 && left + w > r.left - 3 && b - h < r.bottom + 3 && b > r.top - 3);
      for (let k = 0; k < 4; k++) { const hit = hitAt(bottom); if (!hit) break; bottom = hit.top - 4; }
      el.hidden = Boolean(hitAt(bottom));
      el.style.transform = `translate(${left}px, ${bottom - h}px)`;
      if (!el.hidden) placed.push({ left, right: left + w, top: bottom - h, bottom });
    }
  }
  function draw() {
    if (!ctx) return;
    PXG.ctx = ctx;
    PXG.T = T;
    PXG.k = backing;
    PXG.W = th.W;
    if (th.season() !== bgSeason) bg = buildBg(); // the season turned: new grass and trees
    PXG.ext = extOf();
    const sky = skyNow();
    PXG.lights = [...th.lights()];
    for (const f of scene.farmers) if (f.state === 'waiting' || f.state === 'turn') { const b = bots.get(f.id); if (b) PXG.lights.push([b.x, b.y - 8, 14, null]); } // lit at night: they need you
    ctx.drawImage(bg, -pad.l, -pad.t);
    PXG.animals = animalsShown(); // a world hides what its animals replace (the farm's pond duck)
    th.ground();
    for (const f of scene.farmers) { const b = bots.get(f.id); if (b) th.shadows(b); }
    const items = th.items();
    if (animalsShown()) items.push(...kit.items());
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
    // Name tags, lifted when two would overlap (by their widths, once drawn): neighbours on the porch alternate.
    const placed = [];
    for (const f of scene.farmers) {
      const b = bots.get(f.id);
      if (!b) continue;
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
      if (b.tagW == null) { b.tagW = b.tag.offsetWidth; b.tagH = b.tag.offsetHeight; } // measured again only when its text changes
      const w = (b.tagW || 120) / cs;
      let lift = 0;
      while (placed.some(q => Math.abs(q.y - b.y) < 4 && Math.abs(q.x - b.x) < (q.w + w) / 2 + 2 && q.lift === lift)) lift += 11;
      placed.push({ x: b.x, y: b.y, w, lift: (b.lift = lift) });
      b.tag.style.transform = `translate(${Math.round(b.x * cs)}px, ${Math.round((b.y - th.SH * SC - 3 - b.lift) * cs)}px) translate(-50%, -100%)`;
      placeBubble(f, b);
    }
    for (const [id, s] of says) if (!bots.has(id)) { s.el.remove(); says.delete(id); }
    placeAnimalSays(layoutBubbles());
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
    if (errands?.tick(T, id => bots.get(id) ?? null, id => scene.farmers.find(f => f.id === id)?.state)) sync(false);
    th.tick?.(dt, id => bots.get(id)); // what else moves, where the farmers are: the MCP carts
    th.ambient?.(dt, addPart);
    if (animalsShown()) kit.tick(dt, { night: skyNow().phase === 'night', still: false });
    stepParticles(parts, dt);
    followTick(dt);
    draw();
  }
  function startLoop() { if (!raf && canvas && !still && visible()) { last = 0; raf = requestAnimationFrame(frame); } }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function redrawStill() {
    sync(true);
    for (const f of scene.farmers) { const b = bots.get(f.id); if (b) step(0, f, b); }
    th.tick?.(0, id => bots.get(id), true); // the MCP carts too: each where it is going
    if (animalsShown()) { const now = Date.now(); kit.tick(stillAt ? (now - stillAt) / 1000 : 0, { night: false, still: true }); stillAt = now; } // the lines still go after their few seconds
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
    c.width = th.W + pad.l + pad.r;
    c.height = H + pad.t + pad.b;
    const g = c.getContext('2d');
    g.translate(pad.l, pad.t);
    bgSeason = th.season();
    PXG.W = th.W;
    th.bg((x, y, w, h, col) => { g.fillStyle = ink(col); g.fillRect(x, y, w, h); }, bgSeason, extOf());
    return c;
  }
  function resize() {
    if (!canvas) return;
    const { H } = th.layout(), dpr = window.devicePixelRatio || 1;
    // 100% fits the whole farm in the frame (its outer size, so scrollbars coming and going don't
    // change it); zoom scales the farm inside. The backing store is a whole multiple of the art,
    // at most ~24M pixels, and image-rendering: pixelated keeps the pixels square when scaled.
    const fw = viewEl?.offsetWidth || th.W, fh = viewEl?.offsetHeight || 0;
    const fit = Math.max(0.5, Math.min(6, (fw - 2) / th.W, fh > 60 ? (fh - 2) / H : Infinity));
    // The frame's spare room is more land, not empty frame: the forest round the farm.
    const spareW = Math.max(0, (fw - 2) / fit - th.W), spareH = fh > 60 ? Math.floor(Math.max(0, (fh - 2) / fit - H)) : 0;
    const was = `${pad.l},${pad.r},${pad.t},${pad.b}`;
    // The panel lies over the frame's left edge: with room to spare, the farm sits beside it rather
    // than in the middle.
    const edge = sel => { const el = hudEl?.querySelector(sel); return el ? (el.offsetWidth + 16) / fit : 0; };
    const left = edge('.px-stats'), right = 0, room = spareW - left - right;
    const padL = spareW <= 0 ? 0 : room >= 0 ? left + room / 2 : (spareW * left) / Math.max(1, left + right);
    pad = { l: Math.floor(padL), r: Math.floor(spareW) - Math.floor(padL), t: Math.floor(spareH / 2), b: spareH - Math.floor(spareH / 2) };
    const EW = th.W + pad.l + pad.r, EH = H + pad.t + pad.b;
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
    placeMini();
    if (still) redrawStill(); else { sync(false); draw(); }
  }
  /** Where you were looking before this world reloaded: once, after a scene has given the canvas its size (before that, the browser would clamp it). */
  function restorePlace() {
    if (placed || !viewEl) return;
    placed = true;
    const place = String(prefs.get('view') ?? '').split(',').map(Number);
    if (place.length === 2 && place.every(Number.isFinite)) { viewEl.scrollLeft = place[0]; viewEl.scrollTop = place[1]; }
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
    const want = groundFor(next.fields);
    if (want.key !== layoutKey) { // fields came or went: new ground; farmers walk to their new spots
      settle(want);
      if (canvas) { bg = buildBg(); resize(); }
    }
    if (!canvas) return;
    restorePlace();
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
    const actBtn = e.target.closest?.('[data-animal-act]');
    if (actBtn && menuFor) { e.stopPropagation(); doAct(Number(actBtn.dataset.animalAct)); return; }
    const whoBtn = e.target.closest?.('[data-animal-who]');
    if (whoBtn && menuFor) { e.stopPropagation(); menuFor.doer = whoBtn.dataset.animalWho; renderMenu(); return; }
    if (menuEl && !menuEl.contains(e.target)) closeMenu(); // a click anywhere else closes it (and does what it does)
    const tag = e.target.closest?.('[data-farmer]');
    if (tag) { e.stopPropagation(); opts.onPickAgent?.(tag.dataset.farmer); return; }
    if (e.target.closest?.('[data-farm-more]')) { e.stopPropagation(); opts.onShowRepos?.(); return; }
    const sign = e.target.closest?.('[data-farm-field]');
    if (sign) { e.stopPropagation(); opts.onOpenField?.(sign.dataset.farmField); return; }
    if (e.target.closest?.('[data-farm-motion]')) { e.stopPropagation(); setStill(!still); return; }
    if (e.target.closest?.('[data-farm-bell]')) {
      e.stopPropagation();
      bellOn = !bellOn;
      prefs.set('bell', bellOn ? 'on' : 'off');
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
    if (e.target.closest?.('[data-farm-panel]')) { e.stopPropagation(); panelOpen = !panelOpen; prefs.set('panel', panelOpen ? 'open' : 'folded'); renderHud(); resize(); return; }
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
      prefs.set('resting', restingShown ? 'shown' : 'hidden');
      if (still) redrawStill(); else { sync(false); draw(); }
      renderHud();
      return;
    }
    if (e.target.closest?.('[data-farm-sky]')) {
      e.stopPropagation();
      skyMode = SKIES[(SKIES.indexOf(skyMode) + 1) % SKIES.length];
      prefs.set('sky', skyMode);
      renderHud();
      draw();
      return;
    }
    const zoomBtn = e.target.closest?.('[data-farm-zoom]');
    if (zoomBtn) { e.stopPropagation(); setZoom(Number(zoomBtn.dataset.farmZoom)); return; }
    if (e.target.closest?.('[data-farm-animals]')) {
      e.stopPropagation();
      animalsOn = !animalsOn;
      prefs.set('animals', animalsOn ? 'on' : 'off');
      closeMenu();
      if (!animalsOn && errands) { errands.clear(); sync(false); } // hidden: no farmer walks to an animal you can't see
      renderHud();
      draw();
      return;
    }
    if (e.target.closest?.('[data-farm-bubbles]')) {
      e.stopPropagation();
      saysOn = !saysOn;
      if (saysOn) closedSays.clear(); // on again: every bubble, hidden ones too
      prefs.set('bubbles', saysOn ? 'on' : 'off');
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
    const animal = animalsShown() ? kit.at(x, y) ?? kit.homeAt(x, y) : null; // farmers first, then animals, then an animal's home
    if (animal) { openMenu(animal); return; }
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
        const r = await opts.request('agentFiles', { agentId: f.id });
        if (!r.ok && r.status === 0) throw new Error(r.error); // the request itself failed: "Could not read it."
        const files = (r.ok ? r.data : null)?.memory ?? [];
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
    const EW = th.W + pad.l + pad.r, EH = th.layout().H + pad.t + pad.b, mw = 150, mh = Math.round((mw * EH) / EW);
    if (mini.width !== mw || mini.height !== mh) { mini.width = mw; mini.height = mh; }
    const g = mini.getContext('2d'), k = mw / EW;
    g.imageSmoothingEnabled = true;
    g.drawImage(bg, 0, 0, mw, mh);
    for (const f of scene.farmers) { const b = bots.get(f.id); if (b) { g.fillStyle = f.state === 'waiting' ? '#e04a3a' : f.shirt; g.fillRect(Math.round((b.x + pad.l) * k) - 1, Math.round((b.y + pad.t) * k) - 2, 3, 3); } }
    const stage = canvas.parentElement, vx = (viewEl.scrollLeft - stage.offsetLeft) / cs, vy = (viewEl.scrollTop - stage.offsetTop) / cs;
    g.strokeStyle = '#ffd43b'; g.lineWidth = 1.5;
    g.strokeRect(Math.max(0, vx * k), Math.max(0, vy * k), Math.min(mw, (viewEl.clientWidth / cs) * k), Math.min(mh, (viewEl.clientHeight / cs) * k));
  }
  function onMiniClick(e) {
    const r = mini.getBoundingClientRect(), k = (th.W + pad.l + pad.r) / r.width, stage = canvas.parentElement;
    viewEl.scrollLeft = (e.clientX - r.left) * k * cs + stage.offsetLeft - viewEl.clientWidth / 2;
    viewEl.scrollTop = (e.clientY - r.top) * k * cs + stage.offsetTop - viewEl.clientHeight / 2;
    if (follow) { follow = false; renderHud(); }
    if (still) drawMini();
  }
  function onVisibility() { if (document.hidden) stopLoop(); else startLoop(); }
  function setStill(next) {
    still = next;
    if (still && errands) { errands.finish(); closeMenu(); } // no one walks now: what was on its way is done where it is
    stillAt = 0;
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
      host.innerHTML = `<div class="px"><div class="px-host"><div class="px-view"><div class="px-stage"><canvas aria-label="Pixel farm: every farmer is an agent, every field a repo"></canvas><div class="px-ov"></div>${got ? '' : '<div class="px-loading"><span class="spinner"></span>Loading the farm…</div>'}</div></div><div class="px-hud"></div></div></div>
        <dialog class="px-help" aria-label="How to read the farm"><header><b>How to read the farm</b><button type="button" class="x" data-farm-help-close aria-label="Close">×</button></header>${th.help()}</dialog>
        <dialog class="px-help px-dlg" aria-label="The farm"><header><b class="px-dlg-title"></b><button type="button" class="x" data-farm-dlg-close aria-label="Close">×</button></header><div class="px-dlg-body"></div></dialog>`;
      canvas = host.querySelector('canvas');
      ctx = canvas.getContext('2d');
      viewEl = host.querySelector('.px-view');
      ov = host.querySelector('.px-ov');
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
      settle(groundFor(scene.fields));
      renderHud(); // before the first fit: the panel's and switches' size place the farm
      bg = buildBg();
      resize();
      placed = false;
      if (got) restorePlace(); // else when the first scene has been applied and the canvas has its size
      ro = new ResizeObserver(() => resize());
      ro.observe(host);
      host.addEventListener('click', onClick);
      viewEl.addEventListener('wheel', onWheel, { passive: false });
      viewEl.addEventListener('pointerdown', onPointerDown);
      viewEl.addEventListener('pointermove', onPointerMove);
      viewEl.addEventListener('pointerup', onPointerUp);
      viewEl.addEventListener('pointercancel', onPointerUp);
      viewEl.addEventListener('pointerleave', () => setHover(null));
      viewEl.addEventListener('scroll', () => {
        if (still) drawMini();
        clearTimeout(placeTimer); // where you were looking, so a reload of this world (you editing it) comes back here
        placeTimer = setTimeout(() => prefs.set('view', `${Math.round(viewEl.scrollLeft)},${Math.round(viewEl.scrollTop)}`), 400);
      }, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('keydown', onMenuKey);
      renderLog();
      renderHud();
      timer = setInterval(() => { if (!document.hidden) { renderLog(); renderHud(); if (still && animalsShown() && kit.bubbles().length) redrawStill(); } }, 1000); // still: an animal's line goes after its few seconds
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
      clearTimeout(placeTimer);
      ro?.disconnect();
      ro = null;
      clearInterval(timer);
      host?.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', onMenuKey);
      closeMenu();
      errands?.clear();
      if (host) host.innerHTML = '';
      for (const b of bots.values()) { b.tag = null; b.tagText = ''; }
      says.clear();
      animalSays.clear();
      host = canvas = ctx = ov = hudEl = viewEl = dlg = mini = null;
      moverEls.clear();
      drag = null;
      hoverId = null;
    },
    resume: () => { if (still) redrawStill(); else startLoop(); },
    isStill: () => still,
    farmerName: id => scene.farmers.find(f => f.id === id)?.name,
    farmerColor: id => { const f = scene.farmers.find(x => x.id === id); return f ? f.shirt : '#9aa0a6'; },
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
      const r = await opts.request('repoTouched', { repo: asked });
      if (asked !== key) return;
      if (r.ok) { data = r.data; error = ''; } else error = r.status === 0 ? `Could not load the field: ${r.error}` : r.error ?? `Could not load the field (HTTP ${r.status}).`;
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
