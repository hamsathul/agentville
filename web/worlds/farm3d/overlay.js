// What lies over the 3D farm in HTML, so text stays sharp at any angle: the farmers' name tags (the 2D farm's tag
// text, in its pixel font), their speech bubbles, the fields' labels and counts, the silos' figures, and the farm's
// Menu (the engine's defaultHud, wired here) with the turn buttons, plus a short Help. Everything is placed each
// frame from the camera (place(project)).
const CSS = `
  .f3-ov { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 3; }
  .f3-ov > * { position: absolute; left: 0; top: 0; will-change: transform; }
  .f3-tag { pointer-events: auto; cursor: pointer; border: 0; white-space: nowrap; padding: 2px 4px; border-radius: 3px; background: rgba(10, 12, 15, .72); color: #e8edf2; line-height: 0; font: 600 10px system-ui, sans-serif; opacity: 0; transition: opacity .12s; }
  .f3-tag.st-waiting { background: var(--crit, #b3261e); } .f3-tag.st-turn { background: var(--warn, #d9a21b); }
  .f3-tag.st-waiting, .f3-tag.st-turn, .f3-tag.sel, .f3-tag.hover, .f3-tag:hover, .f3-ov.near .f3-tag { opacity: 1; }
  .f3-tag.nap:not(.sel):not(.hover):not(:hover) { opacity: 0; }
  .f3-tag.sel { outline: 2px solid #ffd43b; outline-offset: 1px; z-index: 5; } .f3-tag.hover, .f3-tag:hover { z-index: 6; }
  .f3-say { pointer-events: auto; cursor: pointer; width: max-content; max-width: 190px; padding: 4px 19px 5px 8px; background: #fffdf4; color: #2b2116; border: 2px solid #2a1d14; border-radius: 9px; font: 600 11px/1.3 system-ui, sans-serif; box-shadow: 0 2px 0 rgba(0, 0, 0, .25); z-index: 2; }
  .f3-say span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .f3-say:hover { z-index: 7; } .f3-say:hover span { -webkit-line-clamp: 8; }
  .f3-say .x { position: absolute; top: 0; right: 2px; border: 0; background: none; color: #7a6a55; font-size: 14px; line-height: 1; padding: 2px 3px; cursor: pointer; }
  .f3-say.st-waiting { background: #ffe9e6; border-color: #b3261e; } .f3-say.q { background: #fff4cc; }
  .f3-say::after { content: ''; position: absolute; left: 50%; top: 100%; width: 2px; height: var(--lead, 6px); margin-left: -1px; background: #2a1d14; }
  .f3-say.st-waiting::after { background: #b3261e; }
  .f3-field { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 3px 6px; border-radius: 4px; background: rgba(28, 20, 12, .62); line-height: 0; white-space: nowrap; }
  .f3-cnt { padding: 2px 4px; border-radius: 3px; background: #f4e6c4; line-height: 0; box-shadow: 0 1px 0 rgba(0,0,0,.3); }
  .f3-cnt.silo-amber { background: #f0b429; } .f3-cnt.silo-red { background: #e04a3a; }
  .f3-empty { padding: 6px 10px; border-radius: 5px; background: rgba(28, 20, 12, .7); line-height: 0; }
  .f3-turn { display: flex; gap: 4px; }
  .f3-turn button { display: flex; align-items: center; justify-content: center; min-width: 34px; height: 32px; padding: 0 8px; background: linear-gradient(#fbf3dc, #eadbb4); border: 2px solid #6b4320; border-radius: 5px; box-shadow: inset 0 -2px 0 rgba(107, 67, 32, .22), 0 3px 0 #4e3626; font: 700 17px/1 system-ui, sans-serif !important; color: #4e3626; }
  .f3-turn button:hover { background: linear-gradient(#fffaf0, #f4e6c4); }
  .f3-help { position: absolute; z-index: 90; top: 56px; right: 10px; width: min(420px, calc(100% - 20px)); max-height: calc(100% - 76px); overflow: auto; padding: 12px 14px; background: linear-gradient(#fbf3dc, #f1e3bd); color: #2b2116; border: 2px solid #6b4320; border-radius: 6px; box-shadow: 0 3px 0 #4e3626; font: 13px/1.45 system-ui, sans-serif; }
  .f3-help h2 { margin: 0 0 6px; font-size: 15px; } .f3-help dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 6px 0; } .f3-help dt { font-weight: 700; }
  .f3-help .close { position: absolute; top: 6px; right: 8px; border: 0; background: none; font-size: 18px; cursor: pointer; color: #6b4320; }
`;
const HELP = `<h2>The 3D farm <small>(a prototype)</small></h2>
  <p>The same live farm as the 2D one, in 3D. Every farmer is an agent, every field a repo.</p>
  <dl>
    <dt>Your porch</dt><dd>On the deck: waiting on you (left, waving, a red <b>!</b>; a scroll for a plan to approve), its turn ended (right, a basket; <b>?</b> when it asked you something)</dd>
    <dt>A field</dt><dd>A farmer at work in a repo, holding the tool for its step (hoe = editing, almanac = reading, spyglass = searching, crate = commit, cart = push, with a flag to deploy…)</dd>
    <dt>Crops</dt><dd>Grow from seed to ripe as its context fills</dd>
    <dt>Above a field</dt><dd>Hay: uncommitted files · crates: unpushed commits · a mailbox: behind · a pennant: a branch · a rope with flags: two agents writing at once</dd>
    <dt>Weather</dt><dd>Rain: its deploy failed · a rainbow: it worked · a windmill: it runs</dd>
    <dt>Elsewhere</dt><dd>The shade tree: idle · scarecrows: stale · hammocks: it wakes up by itself · the meadow: working outside any repo · a cloud: thinking</dd>
    <dt>Silo</dt><dd>Your plan's weekly use as grain; a lamp near the limit. The season follows the 5-hour limit</dd>
    <dt>Moving</dt><dd>Drag to pan, scroll or pinch to zoom. Right-drag (or Shift-drag) to turn and tilt the farm; ↺ ↻ (or Q / E) turn it 15°, ⌂ puts it back square-on. Click a farmer to open it; its bubble for its whole conversation; the barn to start a session</dd>
  </dl>
  <p>Not here yet: the stats panel, a field's close-up, the diary, subagents, carts, and the animals' games.</p>`;

export function makeOverlay(el, { opts, hooks }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const ov = document.createElement('div');
  ov.className = 'f3-ov';
  const hud = document.createElement('div');
  hud.className = 'px-hud';
  el.append(ov, hud);
  const tags = new Map(), says = new Map(), fields = new Map(), cnts = new Map(), silos = new Map(), signs = new Map();
  // Farmers beyond a place's room aren't drawn: a sign says how many, where and in what words the 2D farm puts it
  // (web/worlds/farm/world.js, labels); and fields beyond the grid's 18 beds.
  const SIGNS = { desk: [154, -34, 'waiting'], turn: [246, -34, 'your turn'], storage: [340, -34, 'stale'], charge: [60, 262, 'idle'], meadow: [56, 152, 'in the meadow'], nap: [97, 190, 'napping'] };
  const closed = new Map(); // id → the words its bubble had when × closed it
  let farmers = [], model = null, hover = null, selected = null, empty = null;

  function keyed(map, key, make) { let e = map.get(key); if (!e) { e = make(); ov.append(e); map.set(key, e); } return e; }
  function prune(map, keep) { for (const [k, e] of map) if (!keep.has(k)) { e.remove(); map.delete(k); } }

  /** The farmers and fields of a new model. */
  function sync(m, { bubblesOn, near }) {
    model = m; farmers = m.farmers;
    ov.classList.toggle('near', near);
    const keepT = new Set(), keepS = new Set();
    // the porch: neighbours' tags at two heights, so none covers another
    const porch = farmers.filter(f => f.group === 'desk' || f.group === 'turn').sort((a, b) => a.at[0] - b.at[0]);
    for (const f of farmers) {
      keepT.add(f.id);
      const t = keyed(tags, f.id, () => { const b = document.createElement('button'); b.type = 'button'; b.className = 'f3-tag'; b.dataset.id = f.id; return b; });
      const html = pxt(f.tag, f.state === 'turn' ? '#1d1d1d' : '#ffffff', null);
      if (t.dataset.html !== html) { t.innerHTML = html; t.dataset.html = html; }
      t.title = f.tip;
      t.className = `f3-tag st-${f.state}${f.nap ? ' nap' : ''}${f.id === selected ? ' sel' : ''}${f.id === hover ? ' hover' : ''}`;
      t.dataset.raise = porch.indexOf(f) % 2 === 1 ? '1' : '';
      const words = (f.say ?? '').trim();
      if (closed.has(f.id) && closed.get(f.id) !== words) closed.delete(f.id);
      // bubbles: always for a farmer who needs you or whose turn ended; the rest when you are near enough to read them
      if (bubblesOn && words && !closed.has(f.id) && (f.state === 'waiting' || f.state === 'turn' || near)) {
        keepS.add(f.id);
        const s = keyed(says, f.id, () => { const d = document.createElement('div'); d.className = 'f3-say'; d.dataset.id = f.id; d.innerHTML = '<span></span><button type="button" class="x" aria-label="Hide this bubble">×</button>'; return d; });
        s.className = `f3-say st-${f.state}${f.state === 'turn' && /\?\s*$/.test(words) ? ' q' : ''}`;
        const span = s.querySelector('span');
        if (span.textContent !== words) span.textContent = words.length > 160 ? `${words.slice(0, 159)}…` : words;
      }
    }
    prune(tags, keepT); prune(says, keepS);
    const keepF = new Set(), keepC = new Set();
    for (const b of m.beds) {
      keepF.add(b.key);
      const f = keyed(fields, b.key, () => { const d = document.createElement('div'); d.className = 'f3-field'; return d; });
      const html = b.label.map((line, i) => `<span>${pxt(line, i === 0 ? (b.collision ? '#ffd166' : '#e6eef5') : b.deploy?.state === 'failed' ? '#ff8a80' : b.deploy?.state === 'ok' ? '#8ef0a0' : b.deploy?.state === 'running' ? '#ffd166' : '#a9dcf7', '#1b1420')}</span>`).join('');
      if (f.dataset.html !== html) { f.innerHTML = html; f.dataset.html = html; }
      f.title = b.tip;
      for (const [k, n, text, tip] of [['behind', b.piles.behind, `↓${b.piles.behind}`, 'behind the remote'], ['ahead', b.piles.ahead, `↑${b.piles.ahead}`, 'unpushed'], ['dirty', b.piles.dirty, `+${b.piles.dirty}`, 'uncommitted']]) {
        if (!(n > 0)) continue;
        const key = `${b.key}|${k}`;
        keepC.add(key);
        const c = keyed(cnts, key, () => { const d = document.createElement('div'); d.className = 'f3-cnt'; return d; });
        const h = pxt(text, '#5a3a1a', null);
        if (c.dataset.html !== h) { c.innerHTML = h; c.dataset.html = h; }
        c.title = `${n} ${k === 'dirty' ? `${tip} file${n === 1 ? '' : 's'}` : `${tip} commit${n === 1 ? '' : 's'}`}`;
      }
    }
    prune(fields, keepF); prune(cnts, keepC);
    const keepSilo = new Set();
    for (const s of m.silos) {
      const text = s.name ? `${s.name} ${s.silo?.label ?? '–'}` : s.silo?.label;
      if (!text) continue;
      keepSilo.add(String(s.x));
      const d = keyed(silos, String(s.x), () => { const e = document.createElement('div'); return e; });
      d.className = `f3-cnt${s.silo?.lamp ? ` silo-${s.silo.lamp}` : ''}`;
      const h = pxt(text, s.silo?.lamp === 'red' ? '#ffffff' : '#5a3a1a', null);
      if (d.dataset.html !== h) { d.innerHTML = h; d.dataset.html = h; }
      d.title = `The silo${s.name ? ` of ${s.name}` : ''}: ${s.silo ? `${s.name ? 'its' : 'your'} plan's weekly limit, ${s.silo.label} used` : `no reading of ${s.name ? 'its' : 'your'} plan's limits yet`}`; // an account with no reading yet has no silo figures
    }
    prune(silos, keepSilo);
    const keepSign = new Set(), more = m.ground.more ?? 0;
    for (const [group, n] of [...Object.entries(m.over ?? {}), ['more', more]]) {
      if (!(n > 0) || (group !== 'more' && !SIGNS[group])) continue;
      keepSign.add(group);
      const d = keyed(signs, group, () => { const e = document.createElement('div'); e.className = 'f3-cnt'; return e; });
      const text = group === 'more' ? `+${n} more field${n === 1 ? '' : 's'}` : `+${n} ${SIGNS[group][2]}`;
      const h = pxt(text, '#5a3a1a', null);
      if (d.dataset.html !== h) { d.innerHTML = h; d.dataset.html = h; }
      d.title = group === 'more' ? `${n} more repo${n === 1 ? '' : 's'} than the grid's 18 beds: see them all in the list view` : `${n} more ${n === 1 ? 'farmer' : 'farmers'} ${SIGNS[group][2]} than there is room to draw here`;
    }
    prune(signs, keepSign);
    if (!m.beds.length && !empty) { empty = document.createElement('div'); empty.className = 'f3-empty'; empty.innerHTML = pxt('No fields yet: no agent has touched a repo in the last 30 minutes', '#fff3d6', '#4e3626'); ov.append(empty); }
    else if (m.beds.length && empty) { empty.remove(); empty = null; }
  }

  /** Places everything from the camera: project({ x, y, z }) → { x, y, visible } in pixels. */
  function place(project, headOf, at3, silo3) {
    // over its point (a tag, a count), or hanging under it (a field's label, under its bed as on the 2D farm)
    const put = (e, p, dy = 0, under = false) => { if (!p?.visible) { e.style.display = 'none'; return null; } e.style.display = ''; e.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y + dy)}px) translate(-50%, ${under ? '0' : '-100%'})`; return p; };
    const boxes = [];
    for (const [id, t] of tags) {
      const h = headOf(id), p = h && put(t, project(h), t.dataset.raise ? -16 : -2);
      const s = says.get(id);
      if (!s) continue;
      if (!p) { s.style.display = 'none'; continue; }
      // a bubble over its tag; moved up while it would cover one already placed
      const w = s.offsetWidth || 120, hh = s.offsetHeight || 30;
      let y = p.y - (t.dataset.raise ? 34 : 20), tries = 0;
      const hits = yy => boxes.some(b => p.x - w / 2 < b.x1 && p.x + w / 2 > b.x0 && yy - hh < b.y1 && yy > b.y0);
      while (hits(y) && tries++ < 6) y -= hh * 0.6;
      boxes.push({ x0: p.x - w / 2, x1: p.x + w / 2, y0: y - hh, y1: y });
      s.style.display = '';
      s.style.setProperty('--lead', `${Math.max(6, Math.round(p.y - (t.dataset.raise ? 34 : 20) - y + 6))}px`);
      s.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    }
    for (const b of model?.beds ?? []) {
      const f = fields.get(b.key);
      if (f) put(f, project(at3(b.x0 + 36, b.y0 + 38, 0)), 2, true);
      for (const [k, dx] of [['behind', -40], ['ahead', -24], ['dirty', 24]]) { const c = cnts.get(`${b.key}|${k}`); if (c) put(c, project(at3(b.cx + dx, b.rowTop + 4, 1.4))); }
    }
    for (const [x, d] of silos) put(d, project(silo3(Number(x))));
    for (const [group, d] of signs) {
      const [x, y] = group === 'more' ? [350, (model?.ground.GRID.y1 ?? 300) + 8] : SIGNS[group];
      put(d, project(at3(x, y < 0 ? 78 + y : y, y < 0 ? 2.8 : 0.4)));
    }
    if (empty) put(empty, project(at3(262, 170, 0)));
  }

  // The Menu: the engine's markup, with the turn buttons beside it and a Bubbles switch in it.
  let hudHtml = '', menuOpen = false, help = null;
  function renderHud(state) {
    let html = defaultHud({ ...state, seasons: true, menuOpen });
    html = html.replace('<div class="px-nav">', `<div class="px-nav"><span class="f3-turn"><button type="button" data-f3-turn="-1" title="Turn the farm 15° (Q). Or right-drag (or Shift-drag) to turn and tilt it as you like" aria-label="Turn left">↺</button><button type="button" data-f3-turn="1" title="Turn the farm 15° the other way (E)" aria-label="Turn right">↻</button><button type="button" data-f3-reset title="Back to square-on, the whole farm in view" aria-label="Reset the view">⌂</button></span>`);
    const bubbles = `<button type="button" data-f3-bubbles title="Speech bubbles: always for farmers who need you; the rest when you zoom in" aria-pressed="${state.bubbles}">${pxImg(`Bubbles: ${state.bubbles ? 'on' : 'off'}`, '#4e3626', null)}<span class="px-sr">Bubbles</span></button>`;
    html = html.replace('<button type="button" data-farm-help', `${bubbles}<button type="button" data-farm-help`);
    if (html !== hudHtml) { hudHtml = html; hud.innerHTML = html; }
  }
  function openHelp(on) {
    if (!on) { help?.remove(); help = null; return; }
    if (help) return;
    help = document.createElement('div');
    help.className = 'f3-help';
    help.setAttribute('role', 'dialog');
    help.innerHTML = `<button type="button" class="close" aria-label="Close">×</button>${HELP}`;
    el.append(help);
    help.querySelector('.close').addEventListener('click', () => openHelp(false));
  }
  hud.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-farm-menu]')) { menuOpen = !menuOpen; hooks.refresh(); return; }
    if (b.dataset.f3Turn) { hooks.turn(Number(b.dataset.f3Turn)); return; }
    if (b.matches('[data-f3-reset]')) { hooks.reset(); return; }
    if (b.dataset.farmNav) { menuOpen = false; opts.onNav(b.dataset.farmNav); hooks.refresh(); return; }
    if (b.matches('[data-farm-sky]')) hooks.cycle('sky');
    else if (b.matches('[data-farm-season]')) hooks.cycle('season');
    else if (b.matches('[data-farm-motion]')) opts.onMotion(!opts.still);
    else if (b.matches('[data-farm-animals]')) hooks.cycle('animals');
    else if (b.matches('[data-f3-bubbles]')) hooks.cycle('bubbles');
    else if (b.matches('[data-farm-help]')) { menuOpen = false; openHelp(!help); }
    else if (b.dataset.farmZoom !== undefined) hooks.zoom(Number(b.dataset.farmZoom));
    hooks.refresh();
  });
  // a click anywhere else, or Esc, shuts the Menu (and Help)
  el.addEventListener('pointerdown', e => { if (menuOpen && !hud.contains(e.target)) { menuOpen = false; hooks.refresh(); } if (help && !help.contains(e.target) && !hud.contains(e.target)) openHelp(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (help) openHelp(false); else if (menuOpen) { menuOpen = false; hooks.refresh(); hud.querySelector('[data-farm-menu]')?.focus(); } } });
  // a farmer's tag opens it; its bubble opens its whole conversation; × hides the bubble until it says something new
  ov.addEventListener('click', e => {
    const x = e.target.closest('.x'), say = e.target.closest('.f3-say'), tag = e.target.closest('.f3-tag');
    if (x && say) { closed.set(say.dataset.id, (farmers.find(f => f.id === say.dataset.id)?.say ?? '').trim()); say.remove(); says.delete(say.dataset.id); return; }
    if (say) opts.onPickAgent(say.dataset.id, { from: 'say' });
    else if (tag) hooks.pick(tag.dataset.id);
  });
  ov.addEventListener('pointerover', e => { const t = e.target.closest('.f3-tag'); if (t) hooks.hover(t.dataset.id); });

  return {
    sync, place, renderHud,
    setSelected(id) { selected = id; for (const [k, t] of tags) t.classList.toggle('sel', k === id); },
    setHover(id) { if (id === hover) return; hover = id; for (const [k, t] of tags) t.classList.toggle('hover', k === id); },
    count: () => tags.size,
  };
}
