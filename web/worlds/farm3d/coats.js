// The 3D farm's animals in the farm's colours. The models (models/, Quaternius's) come darker than the rest of the farm
// and partly metallic, which with nothing round them to reflect makes them darker still. build/animals.js repaints each
// as it loads: every part in the farm's own matte, faceted finish (FINISH, build/materials.js's std()), and each colour
// area of a model (a material, by its name in the model) in the colour here, lighter and warmer than the model's own but
// the same animal: the cow stays brown, the fox orange. An area not named keeps the model's colour: the eyes. sRGB hex.

/** The finish of every part of every animal: build/materials.js's std(), so they look of a piece with the farm. */
export const FINISH = { roughness: 0.85, metalness: 0 };

/** Each kind's colours, by colour area. */
export const COATS = {
  cow: { Main: '#a8703c', Main_Light: '#efe4cf', Muzzle: '#e0a78a', Hooves: '#7a5a3a', Horns: '#ebe0c0' },
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
};
