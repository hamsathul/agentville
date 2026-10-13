// The farm's pixel icons for the panel and Menu, copied from web/worlds/farm/world.js (ICONS, ICON_PAL, iconImg,
// seasonTip, seasonIcon); collector/test/farm3d-parity.test.mjs pins them to the farm's own.

/** Each icon, 9 × 9: k ink, w white, y yellow, s cream, r red, g green, o orange, b blue. */
export const ICONS = {
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
  world: ['..kkkkk..', '.kbbgbbk.', 'kbgggbbbk', 'kbbggbgbk', 'kbbbbbggk', 'kgbbbbbbk', 'kggbbgbbk', '.kbbgbbk.', '..kkkkk..'],
  plus: ['....k....', '....k....', '....k....', 'kkkkkkkkk', '....k....', '....k....', '....k....', '.........', '.........'],
  gear: ['....k....', '.k.kkk.k.', '..kkkkk..', '.kkk.kkk.', 'kkk...kkk', '.kkk.kkk.', '..kkkkk..', '.k.kkk.k.', '....k....'],
  side: ['kkkkkkkkk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'kkkkkkkkk', '.........', '.........'],
  bell: ['....k....', '...kyk...', '..kyyyk..', '..kyyyk..', '..kyyyk..', '.kyyyyyk.', 'kkkkkkkkk', '...kyk...', '....k....'],
  winter: ['....b....', '.b..b..b.', '..b.b.b..', '...bbb...', 'bbbbbbbbb', '...bbb...', '..b.b.b..', '.b..b..b.', '....b....'],
  animals: ['.k.k.k...', '.k.k.k...', '.........', 'k.kkk.k..', '.kkkkk...', '.kkkkk...', '..kkk....', '.........', '.........'],
  menu: ['.........', 'kkkkkkkkk', 'kkkkkkkkk', '.........', 'kkkkkkkkk', 'kkkkkkkkk', '.........', 'kkkkkkkkk', 'kkkkkkkkk'],
  broadcast: ['.......k.', '.....kkk.', 'k..kkyyk.', 'kkkyyyyk.', 'kkyyyyyk.', 'kkkyyyyk.', 'k..kkyyk.', '....k.kk.', '....kk...'],
  chats: ['kkkkkk...', 'kwwwwk...', 'kwwwwkkkk', 'kkwkkyyyk', '.kk.kyyyk', '....kyyyk', '....kkykk', '......kk.', '.........'],
};
export const ICON_PAL = { k: '#4e3626', w: '#ffffff', y: '#f0b429', s: '#f4ecd8', r: '#e04a3a', g: '#3f9b3a', o: '#c8681a', b: '#a9dcf7' };

/** HTML for one of the icons, drawn with the frame's makeSprite (pixel.js); none without a DOM. */
export function makeIconImg(makeSprite) {
  const urls = new Map();
  return name => {
    if (typeof document === 'undefined' || !ICONS[name]) return '';
    if (!urls.has(name)) urls.set(name, makeSprite(ICONS[name], ICON_PAL).toDataURL());
    return `<i class="px-ico" aria-hidden="true" style="background-image:url(${urls.get(name)})"></i>`;
  };
}
/** The season's icon: summer is the day's sun. */
export const seasonIcon = s => (s === 'summer' ? 'day' : s);
/** The panel's season tooltip (the farm's seasonTip, with the scene's plan and the live season passed in). */
export function seasonTip(plan, live, mode = 'live') {
  const w = plan?.windows?.find(x => x.kind === 'five_hour');
  if (mode !== 'live') return `Held at ${mode} by the Season switch, not live. The live season would be ${live} (your plan's 5-hour limit: ${w ? (w.reset ? 'just reset' : `${Math.round(w.percentUsed)}% used`) : 'no reading yet'}). The switch goes back to live after winter`;
  return `The season follows your plan's 5-hour limit${w ? `: ${w.reset ? 'just reset' : `${Math.round(w.percentUsed)}% used`}` : ' (no reading yet: summer)'}. Spring while it is fresh, then summer and autumn; winter when it is nearly used up`;
}
