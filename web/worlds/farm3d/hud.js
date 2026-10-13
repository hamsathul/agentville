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
/** The panel and Menu (panelHud, the engine's: a global in the frame, passed in), the turn buttons before the Menu. */
export function hudHtml(panelHud, p, words = FARM3D_WORDS) {
  return panelHud(p, words).replace('<div class="px-nav">', `<div class="px-nav">${TURN}`);
}
/** A count card: the first farmer in that state (the engine's rule), or null. */
export const firstIn = (farmers, state) => farmers.find(f => f.state === state)?.id ?? null;
/** "N need you": the first farmer waiting on you, else the first with a question, or null. */
export const firstNeed = farmers => (farmers.find(f => f.state === 'waiting') ?? farmers.find(f => f.question))?.id ?? null;
