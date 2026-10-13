// What lies over the 3D farm in HTML, so text stays sharp at any angle: the farmers' name tags (the 2D farm's tag
// text, in its pixel font), their speech bubbles, the fields' labels and counts, the silos' figures, an animal's menu
// (what you can ask it to do), and a short Help (the panel and the Menu are hud.js's). Everything is placed each
// frame from the camera (place(project)).
import { HENHOUSE, STALL, signsOf } from './layout.js';
import { henhouseView } from './flock.js';

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
  .f3-field { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 3px 6px; border: 0; border-radius: 4px; background: rgba(28, 20, 12, .62); line-height: 0; white-space: nowrap; pointer-events: auto; cursor: pointer; font: inherit; }
  .f3-field:hover { background: rgba(28, 20, 12, .82); }
  .f3-more { pointer-events: auto; cursor: pointer; border: 0; font: inherit; }
  .f3-cnt { padding: 2px 4px; border-radius: 3px; background: #f4e6c4; line-height: 0; box-shadow: 0 1px 0 rgba(0,0,0,.3); }
  .f3-cnt.silo-amber { background: #f0b429; } .f3-cnt.silo-red { background: #e04a3a; }
  .f3-empty { padding: 6px 10px; border-radius: 5px; background: rgba(28, 20, 12, .7); line-height: 0; }
  .f3-turn { display: flex; gap: 4px; }
  .f3-turn button { display: flex; align-items: center; justify-content: center; min-width: 34px; height: 32px; padding: 0 8px; background: linear-gradient(#fbf3dc, #eadbb4); border: 2px solid #6b4320; border-radius: 5px; box-shadow: inset 0 -2px 0 rgba(107, 67, 32, .22), 0 3px 0 #4e3626; font: 700 17px/1 system-ui, sans-serif !important; color: #4e3626; }
  .f3-turn button:hover { background: linear-gradient(#fffaf0, #f4e6c4); }
  .f3-help { position: absolute; z-index: 90; top: 56px; right: 10px; width: min(420px, calc(100% - 20px)); max-height: calc(100% - 76px); overflow: auto; padding: 12px 14px; background: linear-gradient(#fbf3dc, #f1e3bd); color: #2b2116; border: 2px solid #6b4320; border-radius: 6px; box-shadow: 0 3px 0 #4e3626; font: 13px/1.45 system-ui, sans-serif; }
  .f3-help h2 { margin: 0 0 6px; font-size: 15px; } .f3-help dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 6px 0; } .f3-help dt { font-weight: 700; }
  .f3-help .close { position: absolute; top: 6px; right: 8px; border: 0; background: none; font-size: 18px; cursor: pointer; color: #6b4320; }
  .f3-talk { position: absolute; left: 0; top: 0; width: max-content; max-width: 170px; padding: 3px 8px 4px; background: #ffffff; color: #2b2116; border: 1.5px solid #8a7a66; border-radius: 12px; font: italic 600 11px/1.3 system-ui, sans-serif; box-shadow: 0 2px 0 rgba(0, 0, 0, .18); z-index: 1; pointer-events: none; }
  .f3-talk::after { content: ''; position: absolute; left: 50%; top: 100%; margin-left: -5px; border: 5px solid transparent; border-top-color: #8a7a66; }
  .f3-talk.you { background: #fff8d6; border-color: #c9a24a; } .f3-talk.you::after { border-top-color: #c9a24a; }
  .f3-pet { pointer-events: auto; z-index: 8; width: 212px; padding: 7px 8px 8px; background: linear-gradient(#fbf3dc, #f1e3bd); color: #2b2116; border: 2px solid #6b4320; border-radius: 6px; box-shadow: 0 3px 0 #4e3626; font: 12px/1.35 system-ui, sans-serif; }
  .f3-pet b { display: block; margin: 0 18px 5px 2px; font-size: 13px; }
  .f3-pet .close { position: absolute; top: 2px; right: 4px; border: 0; background: none; font-size: 17px; line-height: 1; cursor: pointer; color: #6b4320; padding: 2px 4px; }
  .f3-pet .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .f3-pet .acts button { padding: 4px 6px; background: linear-gradient(#fffaf0, #f4e6c4); border: 1.5px solid #6b4320; border-radius: 4px; box-shadow: 0 2px 0 #4e3626; font: 600 12px system-ui, sans-serif; color: #4e3626; cursor: pointer; text-align: left; }
  .f3-pet .acts button:hover { background: #fffdf6; } .f3-pet .acts button:disabled { opacity: .5; cursor: default; }
  .f3-pet p { margin: 6px 2px 0; color: #6b4320; font-size: 11px; }
  .f3-pop { pointer-events: none; z-index: 4; line-height: 0; }
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
    <dt>Animals</dt><dd>Just for fun, never for data. They walk, graze and rest, round the pond and the trees and inside their fences, and now and then get up to something; a frog and three fish live in the pond. They talk to each other and to the farmers near them now and then (Bubbles hides it). Click one for what you can ask it to do: talk, pet it, feed it, send it running, throw the dogs a stick, send the frog diving…</dd>
    <dt>Moving</dt><dd>Drag to pan, scroll or pinch to zoom. Right-drag (or Shift-drag) to turn and tilt the farm; ↺ ↻ (or Q / E) turn it 15°, ⌂ puts it back square-on. Click a farmer to open it; its bubble for its whole conversation; the barn to start a session</dd>
  </dl>
  <p>Not here yet: the stats panel, a field's close-up, the diary, subagents, carts, and the farmers playing with the animals.</p>`;

export function makeOverlay(el, { opts, hooks }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const ov = document.createElement('div');
  ov.className = 'f3-ov';
  // The buildings' dialog (the engine's markup and styles): the porch, the silo, the henhouse, the stall, the board
  const dlg = document.createElement('dialog');
  dlg.className = 'px-help px-dlg';
  dlg.setAttribute('aria-label', 'The farm');
  dlg.innerHTML = '<header><b class="px-dlg-title"></b><button type="button" class="x" data-farm-dlg-close aria-label="Close">×</button></header><div class="px-dlg-body"></div>';
  el.append(ov, dlg);
  dlg.addEventListener('click', e => {
    const pick = e.target.closest?.('[data-farm-pick]'), mem = e.target.closest?.('[data-farm-mem]');
    if (pick) { dlg.close(); hooks.pick(pick.dataset.farmPick); return; }
    if (mem) { dlg.close(); opts.onOpenDoc?.(mem.dataset.farmMem, mem.dataset.path); return; }
    if (e.target.closest?.('[data-farm-dlg-close]') || e.target === dlg) dlg.close(); // × or the backdrop
  });
  let stallTag = null; // the stall's "N PRs" label
  const coopTags = new Map(); // the henhouse's "+N" (hens no farmer can lead) and "N eggs"
  const movers = new Map(); let moverItems = []; // labels on things that move: a cart out of its place, a cart to town, a hammock's countdown
  let pops = []; // words that rise and fade over something: { el, at() (its point in the world, or null), born }
  const POP_COLOURS = { good: '#8ef0a0', warn: '#ffd166', dim: '#c9b48a' };
  const tags = new Map(), says = new Map(), fields = new Map(), cnts = new Map(), silos = new Map(), signs = new Map(), talks = new Map();
  let talkItems = []; // what the animals and farmers are saying to each other now (talk.js), each over its speaker
  // Farmers beyond a place's room aren't drawn: a sign says how many, in the 2D farm's words (web/worlds/farm/world.js,
  // labels), by the place (layout.js, signsOf); and fields beyond the grid's 18 beds.
  const closed = new Map(); // id → the words its bubble had when × closed it
  let farmers = [], model = null, hover = null, selected = null, empty = null, pet = null; // pet: the open animal menu

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
      const f = keyed(fields, b.key, () => { const d = document.createElement('button'); d.type = 'button'; d.className = 'f3-field'; d.dataset.farmField = b.key; return d; }); // a click: its close-up
      const html = b.label.map((line, i) => `<span>${pxt(line, i === 0 ? (b.collision ? '#ffd166' : '#e6eef5') : b.deploy?.state === 'failed' ? '#ff8a80' : b.deploy?.state === 'ok' ? '#8ef0a0' : b.deploy?.state === 'running' ? '#ffd166' : '#a9dcf7', '#1b1420')}</span>`).join('');
      if (f.dataset.html !== html) { f.innerHTML = html; f.dataset.html = html; }
      f.title = `${b.tip} · Click to see the files agents touched here`;
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
    const st = m.stall;
    if (st?.label) {
      if (!stallTag) { stallTag = document.createElement('div'); stallTag.className = 'f3-cnt'; ov.append(stallTag); }
      const h = pxt(st.label, '#5a3a1a', null);
      if (stallTag.dataset.html !== h) { stallTag.innerHTML = h; stallTag.dataset.html = h; }
      stallTag.title = st.tip;
    } else if (stallTag) { stallTag.remove(); stallTag = null; }
    const hv = henhouseView(m.henhouse), keepCoop = new Set();
    for (const [k, lab] of [['plus', hv.plus], ['eggs', hv.eggsLabel]]) {
      if (!lab) continue;
      keepCoop.add(k);
      const d = keyed(coopTags, k, () => { const e = document.createElement('div'); e.className = 'f3-cnt'; return e; });
      const h = pxt(lab.text, '#5a3a1a', null);
      if (d.dataset.html !== h) { d.innerHTML = h; d.dataset.html = h; }
      d.title = lab.tip;
    }
    prune(coopTags, keepCoop);
    const keepSign = new Set(), more = m.ground.more ?? 0;
    const SIGNS = signsOf(m.ground);
    for (const [group, n] of [...Object.entries(m.over ?? {}), ['more', more]]) {
      if (!(n > 0) || !SIGNS[group]) continue;
      keepSign.add(group);
      const d = keyed(signs, group, () => { const e = document.createElement(group === 'more' ? 'button' : 'div'); e.className = group === 'more' ? 'f3-cnt f3-more' : 'f3-cnt'; if (group === 'more') { e.type = 'button'; e.dataset.farmMore = ''; } return e; }); // "+N more fields": the list view
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
    const boxes = [], tagBoxes = []; // what is placed so far: bubbles (and, for talk only, the farmers' tags)
    for (const [id, t] of tags) {
      const h = headOf(id), p = h && put(t, project(h), t.dataset.raise ? -16 : -2);
      if (p) { const tw = t.offsetWidth || 40, th = t.offsetHeight || 16, ty = p.y + (t.dataset.raise ? -16 : -2); tagBoxes.push({ x0: p.x - tw / 2, x1: p.x + tw / 2, y0: ty - th, y1: ty }); } // talk keeps off the tags
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
    if (stallTag) put(stallTag, project(at3(STALL.x + 14, STALL.y + 36, 0.2)), 0, true);
    const keepM = new Set();
    for (const it of moverItems) {
      keepM.add(it.key);
      const d = keyed(movers, it.key, () => { const e = document.createElement('div'); e.className = 'f3-cnt'; return e; });
      const h = pxt(it.text, '#5a3a1a', null);
      if (d.dataset.html !== h) { d.innerHTML = h; d.dataset.html = h; }
      d.title = it.title;
      put(d, project(at3(it.x, it.y, it.h ?? 2.2)));
    }
    prune(movers, keepM);
    for (const [k, d] of coopTags) put(d, project(k === 'plus' ? at3(HENHOUSE.x + 62, HENHOUSE.y + 4, 1.6) : at3(HENHOUSE.x + 12, HENHOUSE.y + 38, 0.2)), 0, k !== 'plus');
    const at = model ? signsOf(model.ground) : {};
    for (const [group, d] of signs) if (at[group]) put(d, project(at3(at[group][0], at[group][1], at[group][1] < 90 ? 2.8 : 0.4)));
    if (empty && model) { const G = model.ground.GRID; put(empty, project(at3((G.x0 + G.x1) / 2, (G.y0 + G.y1) / 2, 0))); }
    // a conversation's bubbles: over the speaker, moved up while they would cover a farmer's own bubble or another
    const keepTalk = new Set();
    for (const it of talkItems) {
      const e = keyed(talks, it.key, () => { const d = document.createElement('div'); d.className = 'f3-talk'; return d; });
      keepTalk.add(it.key);
      if (e.textContent !== it.text) e.textContent = it.text;
      e.classList.toggle('you', Boolean(it.toYou));
      const p = it.top && project(it.top);
      if (!p?.visible) { e.style.display = 'none'; continue; }
      const w = e.offsetWidth || 120, hh = e.offsetHeight || 22;
      let y = p.y - 8, tries = 0;
      const hits = yy => [...boxes, ...tagBoxes].some(b => p.x - w / 2 < b.x1 && p.x + w / 2 > b.x0 && yy - hh < b.y1 && yy > b.y0);
      while (hits(y) && tries++ < 6) y -= hh * 0.8;
      if (hits(y)) { e.style.display = 'none'; continue; } // still in the way of a farmer's bubble or tag: it waits
      boxes.push({ x0: p.x - w / 2, x1: p.x + w / 2, y0: y - hh, y1: y });
      e.style.display = '';
      e.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    }
    prune(talks, keepTalk);
    if (pet) { const top = hooks.animal(pet.i)?.top; if (top) put(pet.el, project(top), -4); else closePet(); }
    // the pops: up 30 px and gone in 2 s; one whose point has gone goes with it
    const now = performance.now();
    pops = pops.filter(p => {
      const k = (now - p.born) / 2000, at = p.at();
      if (k >= 1 || !at) { p.el.remove(); return false; }
      if (put(p.el, project(at), -k * 30)) p.el.style.opacity = String(1 - k * k);
      return true;
    });
  }

  /** An animal's menu, over it: its name, and what you can ask it to do (nothing while the farm stands still). */
  function openPet(i) {
    const info = hooks.animal(i);
    closePet();
    if (!info) return;
    const el2 = document.createElement('div');
    el2.className = 'f3-pet';
    el2.setAttribute('role', 'dialog');
    el2.setAttribute('aria-label', `The ${info.title.toLowerCase()}: what to ask it`);
    const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    el2.innerHTML = `<b>${esc(info.title)}</b><button type="button" class="close" aria-label="Close">×</button><div class="acts">${info.menu.map(m => `<button type="button" data-act="${m.id}"${opts.still ? ' disabled' : ''}>${esc(m.label)}</button>`).join('')}</div>${opts.still ? '<p>Motion is off, so the animals stand still. Turn it on in the Menu to play with them.</p>' : ''}`;
    el2.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act) hooks.act(i, b.dataset.act);
      closePet();
    });
    ov.append(el2);
    pet = { i, el: el2 };
    el2.querySelector('button[data-act]:not(:disabled)')?.focus({ preventScroll: true });
  }
  function closePet() { pet?.el.remove(); pet = null; }

  let help = null; // Help, open or not
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
  // a click anywhere else, or Esc, shuts Help and an animal's menu (the panel's Help button toggles Help itself)
  el.addEventListener('pointerdown', e => { if (help && !help.contains(e.target) && !e.target.closest?.('.px-hud')) openHelp(false); if (pet && !pet.el.contains(e.target)) closePet(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (pet) closePet(); else if (help) openHelp(false); } });
  // a farmer's tag opens it; its bubble opens its whole conversation; × hides the bubble until it says something new
  ov.addEventListener('click', e => {
    const fieldBtn = e.target.closest('[data-farm-field]');
    if (fieldBtn) { hooks.openField(fieldBtn.dataset.farmField); return; }
    if (e.target.closest('[data-farm-more]')) { opts.onShowRepos?.(); return; }
    const x = e.target.closest('.x'), say = e.target.closest('.f3-say'), tag = e.target.closest('.f3-tag');
    if (x && say) { closed.set(say.dataset.id, (farmers.find(f => f.id === say.dataset.id)?.say ?? '').trim()); say.remove(); says.delete(say.dataset.id); return; }
    if (say) opts.onPickAgent(say.dataset.id, { from: 'say' });
    else if (tag) hooks.pick(tag.dataset.id);
  });
  ov.addEventListener('pointerover', e => { const t = e.target.closest('.f3-tag'); if (t) hooks.hover(t.dataset.id); });

  return {
    sync, place, openPet, closePet,
    /** Labels on things that move ([{ key, x, y (the 2D map), h (metres up), text, title }]), placed each frame. */
    setMovers(items) { moverItems = items; },
    /** Words that rise and fade over a point (`at()`: where, in the world, now; null once it has gone): good, warn or dim. */
    pop(at, text, cls = 'good') { const el2 = document.createElement('div'); el2.className = 'f3-pop'; el2.innerHTML = pxt(text, POP_COLOURS[cls] ?? POP_COLOURS.good, '#2a1d14'); ov.append(el2); pops.push({ el: el2, at, born: performance.now() }); if (pops.length > 12) pops.shift().el.remove(); },
    /** The pops showing now (their words; for the check). */
    popsShown: () => pops.map(p => p.el.textContent || p.el.querySelector('[aria-label]')?.getAttribute('aria-label') || ''),
    /** A building's dialog ({ title, html }), opened (or its body replaced, when it is open). */
    openDialog(d) { if (!d) return; dlg.querySelector('.px-dlg-title').textContent = d.title; dlg.querySelector('.px-dlg-body').innerHTML = d.html; if (!dlg.open) dlg.showModal(); },
    /** The open dialog's body, replaced (the notice board's, once read). */
    setDialogBody(html) { if (dlg.open) dlg.querySelector('.px-dlg-body').innerHTML = html; },
    dialogOpen: () => dlg.open,
    /** Help: opened, shut, or (no argument) the other way round. */
    help(on = !help) { openHelp(on); },
    /** The animal whose menu is open, or null. */
    petOpen: () => pet?.i ?? null,
    /** What is being said now: [{ key, text, top (the point over the speaker, in the world), toYou }] (none with Bubbles off). */
    setTalk(items) { talkItems = items; },
    /** The talk bubbles on the page (for the check). */
    talkShown: () => [...talks.values()].filter(e => e.style.display !== 'none').map(e => e.textContent),
    setSelected(id) { selected = id; for (const [k, t] of tags) t.classList.toggle('sel', k === id); },
    setHover(id) { if (id === hover) return; hover = id; for (const [k, t] of tags) t.classList.toggle('hover', k === id); },
    count: () => tags.size,
  };
}
