// The 3D farm's panel and Menu: the engine's panelHud (as the farm, the factory and the field exercise have it) in
// the 2D farm's words, with the turn buttons beside the Menu; makeHud wires its clicks the engine's way
// (web/worlds/sdk/engine.js). The words are copied from web/worlds/farm/world.js (FARM_WORDS), but for three
// tooltips that describe the 3D farm; collector/test/farm3d-parity.test.mjs pins them.
import { seasonIcon, seasonTip } from './icons.js';

/** The tooltips the 3D farm says its own way: its bubbles, its animals' menus, its zoom and turning. */
export const TIPS_3D = {
  bubblesTip: 'Speech bubbles: always for the farmers who need you; every farmer’s from 200% in. × hides one; its 💬 shows it again',
  animalsTip: 'Animals on the farm, just for fun: click one for what you can ask it to do. They never stand for anything',
  zoomTip: 'Zoom the farm (or scroll, or pinch); drag to move around, right-drag or Shift-drag to turn it',
};
// The farm's words and colours in the engine's panel and buttons (panelHud), with the 3D farm's three tooltips.
export const FARM3D_WORDS = {
  place: 'farm', agent: 'farmer', agents: 'farmers',
  costTip: "What the sessions on the farm have cost so far (each one's purse; from the mod)", costIcon: 'coin',
  compactedWord: 'harvested', compactedTip: "Harvests: each time a session's conversation was compacted", compactedIcon: 'basket',
  textColor: '#fff3d6', shadowColor: '#2a1d14', dimColor: '#c9b48a', labelColor: '#a9c79a', brandColor: '#ffe8a3', toolColor: '#4e3626', toolStateColor: '#8b5a2b',
  sideTip: "Show the selected farmer's answer box, activity and files beside the farm",
  followTip: 'Keep the farmer you picked in the middle of the view (zooms in); dragging the view turns it off',
  followFirstTip: 'Pick a farmer first, then Follow keeps it in view',
  restingTip: 'Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work',
  bubblesTip: 'Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again',
  animalsTip: 'Animals on the farm, just for fun: click one to pet or feed it (or the pond, for the ducks). They never stand for anything',
  skyTip: 'The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night',
  seasonSwitchTip: "The season: live follows your plan's 5-hour limit (spring while it is fresh, winter when it is nearly used up); or hold one: spring, summer, autumn or winter. The panel's 📌 shows your real 5-hour use meanwhile",
  motionTip: 'Walking and animation on the farm',
  helpTip: 'How to read the farm',
  zoomTip: 'Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in',
  zoomAllTip: 'Show the whole farm',
  menuTip: "The dashboard's buttons, the farm's switches, the bell, help and zoom", menuHead: 'ON THE FARM',
  ...TIPS_3D,
};

const TURN = '<span class="f3-turn"><button type="button" data-f3-turn="-1" title="Turn the farm 15° (Q). Or right-drag (or Shift-drag) to turn and tilt it as you like" aria-label="Turn left">↺</button><button type="button" data-f3-turn="1" title="Turn the farm 15° the other way (E)" aria-label="Turn right">↻</button><button type="button" data-f3-reset title="Back to square-on, the whole farm in view" aria-label="Reset the view">⌂</button></span>';
export const TOUR_TIP = 'The tour: left alone for 3 minutes, the camera goes round the farm (who waits on you, the machines, the busiest field, the animals); any key or click stops it and puts the view back';
export const SOUND_TIP = "The farm's sounds: wind, birds or crickets, rain and tractors (made in the page, no files). Starts on a click";
export const SOUND_NONE = "Sound needs Web Audio, which this browser doesn't have here";
/** The 3D farm's own switches (Tour, Sound: p.tour 'on'|'off', p.sound 'on'|'off'|'unavailable'), in the engine's switch markup. */
function ownSwitches(p, words) {
  const px = globalThis.pxImg, q = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const sw = (attr, icon, name, state, title, disabled = false) => `<button type="button" ${attr}${disabled ? ' disabled' : ''} title="${q(title)}">${p.iconImg(icon)}${px(name, words.toolColor, null)}<span class="px-mi-s">${px(state, words.toolStateColor, null)}</span><span class="px-sr">${name}: ${state}</span></button>`;
  let out = '';
  if (p.tour !== undefined) out += sw('data-farm-tour', 'tour', 'Tour', p.tour, TOUR_TIP);
  if (p.sound !== undefined) out += sw('data-farm-sound', 'sound', 'Sound', p.sound === 'unavailable' ? 'off' : p.sound, p.sound === 'unavailable' ? SOUND_NONE : SOUND_TIP, p.sound === 'unavailable');
  return out;
}
/**
 * The panel and Menu (panelHud, the engine's: a global in the frame, passed in), the turn buttons before the Menu, and
 * the 3D farm's own switches (Tour, Sound) after Animals (or before Sky) when given.
 */
export function hudHtml(panelHud, p, words = FARM3D_WORDS) {
  let h = panelHud(p, words).replace('<div class="px-nav">', `<div class="px-nav">${TURN}`);
  const own = ownSwitches(p, words);
  if (!own) return h;
  const animals = h.indexOf('data-farm-animals'), at = animals >= 0 ? h.indexOf('</button>', animals) + '</button>'.length : h.indexOf('<button type="button" data-farm-sky');
  return at > 0 ? h.slice(0, at) + own + h.slice(at) : h;
}
/** A count card: the first farmer in that state (the engine's rule), or null. */
export const firstIn = (farmers, state) => farmers.find(f => f.state === state)?.id ?? null;
/** "N need you": the first farmer waiting on you, else the first with a question, or null. */
export const firstNeed = farmers => (farmers.find(f => f.state === 'waiting') ?? farmers.find(f => f.question))?.id ?? null;

/**
 * The panel (top left) and the Menu (top right) over the farm in `host`, wired the engine's way (engine.js, the
 * click handler): the Menu's button opens and shuts it (a click elsewhere or Esc shuts it); in it the switches and
 * zoom leave it open, the dashboard's buttons (but Theme) and Help shut it. AGENTVILLE folds the panel; a count
 * card or "N need you" opens that farmer; the Bell is kept with the world's prefs and told to the page.
 * hooks: { turn(d), reset(), zoom(d), cycle(what), pick(id), setFollow(on), setResting(shown), help(), refresh(o) }.
 * render(state): state is { zoom, skyMode, seasonMode, still, animals, bubbles, follow, canFollow, restingHidden,
 * scene (the engine scene), season (the live one) }.
 */
export function makeHud(host, { opts, prefs, hooks, iconImg }) {
  let menu = false, panelOpen = prefs.get('panel') !== 'folded', bell = prefs.get('bell') === 'on', html = '', last = null;
  const el = document.createElement('div');
  el.className = 'px-hud';
  host.append(el);
  function render(state = last) {
    if (!state) return;
    last = state;
    const p = { ...state, saysOn: state.bubbles, seasons: true, bell, nav: opts.navState?.() ?? {}, panelOpen, menuOpen: menu, iconImg, seasonIcon, seasonTip: m => seasonTip(state.scene?.plan, state.season, m) };
    const h = hudHtml(panelHud, p); // the engine's panelHud: a global in the frame
    if (h !== html) { html = h; el.innerHTML = h; }
  }
  const shut = () => { if (menu) { menu = false; render(); } };
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.matches('[data-farm-menu]')) { menu = !menu; render(); if (menu) el.querySelector('.px-menu button:not(:disabled)')?.focus(); return; }
    if (b.dataset.f3Turn) { hooks.turn(Number(b.dataset.f3Turn)); return; }
    if (b.matches('[data-f3-reset]')) { hooks.reset(); return; }
    if (b.matches('[data-farm-panel]')) { panelOpen = !panelOpen; prefs.set('panel', panelOpen ? 'open' : 'folded'); render(); hooks.refresh({ panel: true }); return; }
    if (b.dataset.farmNav) { if (b.dataset.farmNav !== 'theme') menu = false; opts.onNav(b.dataset.farmNav); render(); return; }
    if (b.dataset.farmState) { const id = firstIn(last?.scene?.farmers ?? [], b.dataset.farmState); if (id) hooks.pick(id); return; }
    if (b.matches('[data-farm-need]')) { const id = firstNeed(last?.scene?.farmers ?? []); if (id) hooks.pick(id); return; }
    if (b.matches('[data-farm-bell]')) { bell = !bell; prefs.set('bell', bell ? 'on' : 'off'); opts.onBell?.(bell); render(); return; }
    if (b.matches('[data-farm-follow]')) { hooks.setFollow(!last?.follow); return; }
    if (b.matches('[data-farm-resting]')) { hooks.setResting(last?.restingHidden !== null); return; }
    if (b.matches('[data-farm-help]')) { menu = false; render(); hooks.help(); return; }
    if (b.matches('[data-farm-sky]')) hooks.cycle('sky');
    else if (b.matches('[data-farm-season]')) hooks.cycle('season');
    else if (b.matches('[data-farm-motion]')) opts.onMotion(!opts.still);
    else if (b.matches('[data-farm-animals]')) hooks.cycle('animals');
    else if (b.matches('[data-farm-bubbles]')) hooks.cycle('bubbles');
    else if (b.matches('[data-farm-tour]')) hooks.cycle('tour');
    else if (b.matches('[data-farm-sound]')) hooks.cycle('sound');
    else if (b.dataset.farmZoom !== undefined) hooks.zoom(Number(b.dataset.farmZoom));
    hooks.refresh();
  });
  // a click anywhere else shuts the Menu (and does what it does); Esc shuts it, back on its button
  host.addEventListener('pointerdown', e => { if (menu && !e.target.closest?.('.px-menu, [data-farm-menu]')) shut(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu) { shut(); el.querySelector('[data-farm-menu]')?.focus(); } });
  return {
    render, close: shut,
    menuOpen: () => menu,
    /** The panel's box, its 10 px margin in, from the frame's top left (CSS pixels); null while folded or not drawn. */
    panelBox() {
      const s = el.querySelector('.px-stats');
      if (!s || !panelOpen) return null;
      const r = s.getBoundingClientRect(), h = host.getBoundingClientRect();
      return r.width ? { w: Math.ceil(r.right - h.left + 10), h: Math.ceil(r.bottom - h.top + 10) } : null;
    },
  };
}

/** What a click is on, of what is under the pointer: a farmer first, then an animal, then a building, then a field (the engine's order). */
export const clickOrder = hits => ['id', 'animal', 'building', 'field'].map(k => hits.find(h => h?.[k] !== undefined)).find(Boolean) ?? null;
