// The 3D farm's animals, plants and crops in the farm's colours, and its machines' paint (PAINT, at the end). The
// models (models/, Quaternius's) come darker than the rest of the farm and partly metallic, which with nothing round
// them to reflect makes them darker still. build/animals.js repaints each as it loads: every part in the farm's own matte, faceted finish (FINISH, build/materials.js's std()), and each colour
// area of a model (a material, by its name in the model) in the colour here, lighter and warmer than the model's own but
// the same animal: the fox stays orange. An area not named keeps the model's colour: the eyes. sRGB hex. The cows are
// white with black spots (SPOTS): each her own, painted on her coat's faces, so they move with her.

/** The finish of every part of every animal: build/materials.js's std(), so they look of a piece with the farm. */
export const FINISH = { roughness: 0.85, metalness: 0 };

/** Each kind's colours, by colour area. */
export const COATS = {
  cow: { Main: '#f4f1ea', Main_Light: '#f7f5ef', Muzzle: '#e8a3a0', Hooves: '#6e655c', Horns: '#ebe0c0' },
  bull: { Main: '#5a4334', Main_Light: '#8a7a6c', Muzzle: '#7a5f4e', Hooves: '#7a5a3a', Horns: '#ebe0c0' },
  alpaca: { Main: '#c99a64', Main_Light: '#ecd2a8', Main_Dark: '#6a5c50', Muzzle: '#4f4540', Hooves: '#5e574f' },
  donkey: { Main: '#9b968e', Main_Light: '#ddd7cc', Main_Dark: '#5a514a', Hair: '#4f4741', Muzzle: '#5a4f45', Hooves: '#5e574f' },
  horse: { Main: '#a5683a', Main_Light: '#c38854', Main_Dark: '#80502f', Hair: '#3e3029', Muzzle: '#54443a', Hooves: '#7d766c' },
  whitehorse: { Main: '#ebe7dc', Main_Light: '#d2cdc3', Hair: '#e4d9c2', Muzzle: '#b89c86', Hooves: '#a8986a' },
  deer: { Main: '#b97b4b', Main_Light: '#ecdfc8', Main_Dark: '#8e5d3c', Hooves: '#5e5450', Eye_Lighter: '#d9a37e' },
  stag: { Material: '#a87d52', 'Material.001': '#4a3f33', 'Material.003': '#cdb898', 'Material.010': '#6e5a43' },
  husky: { Material: '#6d6f6b', 'Material.001': '#eceee7', 'Material.006': '#3a3a3a' },
  shiba: { Main: '#cf8c48', Main_Light: '#f3ebd9', Black: '#3a3a3a' },
  fox: { Main: '#dc7a3a', Main_Light: '#f3ede2', Grey: '#6f6a66', Black: '#3a3433' },
  wolf: { Main: '#909189', Main_Light: '#dcdcd3', Nose: '#3a3a3a' },
  // the pond's: a green frog with a yellow belly, pond fish (an olive trout, an orange and white koi, a silver roach), lily pads in flower
  frog: { Green: '#86bd5c', Yellow: '#e6d27a', Red: '#d9504a' },
  trout: { Top: '#c7c49a', Bottom: '#eef0e6', Fins: '#f0c8a8' },
  koi: { Outline: '#d9541e', Body: '#f07a2c', Stripes: '#fbf7ee' },
  roach: { Body: '#c9d0d6', Front: '#dfe5ea', Fins: '#f2c9a0' },
  lilypad: { Green: '#5f9a48', Pink: '#f08cc0' },
  // the farm's plants and stones: the farm's greens and browns, snow white, autumn warm
  tree: { Wood: '#7d5a45', Green: '#4f8a3f' },
  tree2: { Brown: '#a8764e', Green: '#6aab5c' },
  birch: { White: '#eceee8', Black: '#4a4a4a', DarkGreen: '#4a7d42', Green: '#62a04f' },
  birchsnow: { White: '#eceee8', Black: '#4a4a4a', Green: '#62a04f', Snow: '#f2f5f8', DarkGreen: '#4a7d42' },
  birchdead: { White: '#eceee8', Black: '#4a4a4a' },
  autumntree: { Wood: '#7d5a45', Orange: '#e08a3c', LightOrange: '#efb45e' },
  deadtreesnow: { Wood: '#7d5a45', Snow: '#f2f5f8' },
  pine: { Wood: '#8a6448', Green: '#47804a' },
  pinesnow: { Wood: '#8a6448', Snow: '#f2f5f8', Green: '#47804a' },
  pineautumn: { Wood: '#8a6448', Orange: '#d98f42', LightOrange: '#e9b867' },
  bush: { Green: '#4f8a3f' },
  bushsnow: { Snow: '#f2f5f8', Green: '#4f8a3f' },
  bushberries: { Green: '#4f8a3f', Berry: '#d63a44' },
  rockmoss: { Rock: '#a3a6ad', Green: '#6c9a50' },
  rocksnow: { 'Rock.001': '#a3a6ad', 'Snow.001': '#f2f5f8' },
  rocks: { Stone_Dark: '#8e949c' },
  stump: { Wood: '#8a6448', Green: '#6c9a50' },
  log: { Wood: '#8a6448', Green: '#6c9a50', Mushroom_Top: '#b7795c', Mushroom_Bottom: '#e6d6c8', DarkGreen: '#55884a' },
  mushroom: { White: '#f0eee8', LightRed: '#d0503f' },
  flowers: { Green: '#5e9a45', Cyan: '#f2c94c', Yellow: '#f5e08a' },
  // the crops (build/crops.js), ripe: their green a bed's, not their model's olive; before that crops.js's UNRIPE
  wheat: { Yellow: '#e2c56a' },
  corn: { Green: '#6fa64a', Yellow: '#ecc94e' },
  pumpkin: { Brown: '#8a6a40', Orange: '#ee8a2a' },
  carrot: { Orange: '#f08a2e', DarkGreen: '#4f9a3a' },
  tomato: { DarkRed: '#e0473a', DarkGreen: '#4f8a3a' },
  cabbage: { green: '#a6dc8c', _defaultMat: '#ffffff' }, // _defaultMat: a few faces underneath, kept white
};

/** Spotted coats: the colour area the spots are on, their colour, and how much of it they cover. */
/** The Explore dog (a farmer's Explore subagent): the Shiba's model, tan and cream, so it is never the yard's Shiba. */
export const EXPLORE_DOG = { Main: '#c98d4f', Main_Light: '#f4ecd8', Black: '#3a3a3a' };

export const SPOTS = { cow: { area: 'Main', colour: '#262422', share: 0.36 } };

/**
 * Which of a coat's faces are spots, given each face's middle (x, y, z, one after another, in the model's own space):
 * a few round patches of different sizes about the coat, grown together until they cover `share` of its faces. The
 * same seed gives the same spots, so a cow keeps hers.
 */
export function spotsOf(middles, seed, { share = SPOTS.cow.share, patches = 7 } = {}) {
  const n = middles.length / 3;
  if (!n) return [];
  let s = (seed * 7919 + 17) % 2147483647 || 1;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], middles[i * 3 + k]); hi[k] = Math.max(hi[k], middles[i * 3 + k]); }
  const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const centres = Array.from({ length: patches }, () => ({ at: Math.floor(rand() * n), r: size * (0.08 + rand() * 0.1) }));
  // how far each face is into its nearest patch, as a share of that patch's size: the nearest share of them are spots
  const depth = Array.from({ length: n }, (_, i) => Math.min(...centres.map(({ at, r }) => Math.hypot(middles[i * 3] - middles[at * 3], middles[i * 3 + 1] - middles[at * 3 + 1], middles[i * 3 + 2] - middles[at * 3 + 2]) / r)));
  const cut = [...depth].sort((a, b) => a - b)[Math.min(n - 1, Math.round(share * n))];
  return depth.map(d => d < cut);
}

/**
 * Each farmer character's shirt: the colour area (a material) the agent's colour goes on, and the meshes it is
 * recoloured on (a material shared with the shoes keeps its colour there). The rest keep the character's own colours,
 * in the farm's finish (FINISH).
 */
export const SHIRTS = {
  farmer: { material: 'Brown', meshes: ['Farmer_Body'] },
  worker: { material: 'Worker_Vest', meshes: ['Worker_Body'] },
  casual: { material: 'LightBrown', meshes: ['Casual2_Body'] },
  hoodie: { material: 'Purple', meshes: ['Casual_Body'] },
  business: { material: 'Suit', meshes: ['Suit_Body'] },
  beach: { material: 'LightBrown', meshes: ['Beach_Body'] },
  woman: { material: 'LimeGreen', meshes: ['Formal_Body', 'Formal_Legs'] }, // her dress
  womancasual: { material: 'White', meshes: ['Casual_Body'] },
  womanadventurer: { material: 'LightGreen', meshes: ['Adventurer_Body'] },
};

/**
 * The machines' paint (build/machines.js). Kenney's Car Kit comes blue-grey, each face's colour baked from its palette
 * (scripts/lib/glb.mjs bakeTexture): each colour is repainted by the part it is on (the start of its node's name:
 * body, wheel, shovel) and what it looks like (paintClass: the kit's blue-grey paint, a tyre's dark grey, near white),
 * keeping its shade; a lamp, a stripe and a part not named keep their own. A red tractor with cream wheels, a yellow
 * loader, a green flatbed. sRGB hex.
 */
export const PAINT = {
  tractor: { body: { paint: '#c8432f', pale: '#f4ecd8' }, wheel: { paint: '#f4ecd8', tyre: '#2a2a2e' } },
  tractorloader: { body: { paint: '#e2a83a', pale: '#f4ecd8' }, shovel: { paint: '#9a9da3' }, wheel: { tyre: '#2a2a2e' } },
  truckflat: { body: { paint: '#3f7d3a' }, wheel: { paint: '#d8d2c4', tyre: '#2a2a2e' } },
};
const SHADE_OF = { paint: 0x80, tyre: 0x3a, pale: 0xee }; // each look's middling grey: a colour's shade is its own over this

/** What a colour of the Car Kit's (sRGB, 0 to 255) looks like: 'paint', 'tyre', 'pale', or null (a lamp, a stripe). */
export function paintClass([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 0x50) return 'tyre';
  if (min >= 0xd0) return 'pale';
  if (b >= r && b >= g && g >= r && max - min <= 0x48) return 'paint'; // the kit's blue-grey, light or dark
  return null;
}

/** A Car Kit colour (sRGB, 0 to 255) on a machine's part (its node's name), repainted in the farm's: PAINT. */
export function repaint(kind, node, rgb) {
  const part = Object.keys(PAINT[kind] ?? {}).find(p => node?.startsWith(p)), look = part && paintClass(rgb), to = look && PAINT[kind][part][look];
  if (!to) return rgb;
  const shade = Math.min(1.25, Math.max(0.7, (rgb[0] + rgb[1] + rgb[2]) / 3 / SHADE_OF[look]));
  return [1, 3, 5].map(i => Math.min(255, Math.round(parseInt(to.slice(i, i + 2), 16) * shade)));
}
