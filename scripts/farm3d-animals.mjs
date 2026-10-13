#!/usr/bin/env node
// The 3D farm's animals: animated models from Quaternius's Farm Animal Pack and Animated Animal Pack on poly.pizza
// (CC0), and two still ducks for the pond (CC BY 3.0). Downloads each model below (a GLB, by its pinned id), keeps only
// the animations the farm plays (and one copy of each: the packs hold two), drops what the farm's flat shading doesn't
// use (normals, texture coordinates, textures), packs what is left tightly, and writes it to
// web/worlds/farm3d/models/<kind>.js (a world's frame can't fetch a model file: the world imports it), with
// models/index.js (each animal's height, clips and credit) and models/LICENSE.md (the credits). Needs the network.
// No dependencies.
//
//   npm run farm3d-animals
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGlb, trimGlb } from './lib/glb.mjs';
import { ROOT } from './lib/worlds-dir.mjs';

const CC0 = { licence: 'CC0 (public domain)', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const CCBY = { licence: 'CC BY 3.0', licenceUrl: 'https://creativecommons.org/licenses/by/3.0/' };
const FARM_PACK = { pack: 'Farm Animal Pack', packUrl: 'https://poly.pizza/bundle/Farm-Animal-Pack-1kUvRTPLzT', author: 'Quaternius', authorUrl: 'https://poly.pizza/u/Quaternius', ...CC0 };
const ANIMATED_PACK = { pack: 'Animated Animal Pack', packUrl: 'https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS', author: 'Quaternius', authorUrl: 'https://poly.pizza/u/Quaternius', ...CC0 };
/**
 * The animals the farm uses, and the clips each plays: walking, standing, grazing (a clip name each; a sheep has no
 * walk, so it hops with its jump). None of them stands for something on the farm: no chickens (subagents), no birds
 * but the pond's ducks, and the husky is the one dog (the sheepdog).
 */
export const MODELS = [
  { kind: 'cow', title: 'Cow', id: '48c5f4af-07d6-4493-a261-0919967afe85', ...FARM_PACK, height: 1.45, clips: { walk: 'Walk', idle: 'Idle', graze: 'Idle' } },
  { kind: 'sheep', title: 'Sheep', id: 'a4bd2c4e-fe71-4dbd-9881-cf3ac8a00bbf', ...FARM_PACK, height: 1.0, clips: { walk: 'Jump', idle: 'Idle', graze: 'Idle' }, hop: true },
  { kind: 'horse', title: 'Horse', id: 'd37dbc87-ca61-4b2c-a2da-d2f0c4240bef', ...ANIMATED_PACK, height: 1.8, clips: { walk: 'Walk', idle: 'Idle', graze: 'Eating' } },
  { kind: 'whitehorse', title: 'White Horse', id: '3edc2bd9-3378-4b43-a50d-d5e1f858562b', ...ANIMATED_PACK, height: 1.8, clips: { walk: 'Walk', idle: 'Idle', graze: 'Eating' } },
  { kind: 'sheepdog', title: 'Husky', id: '611d25c7-430f-4bb5-ab2c-d8f5f3cb9712', ...ANIMATED_PACK, height: 0.85, clips: { walk: 'Walk', idle: 'Idle', graze: 'Idle_2_HeadLow', run: 'Gallop' } },
  { kind: 'deer', title: 'Deer', id: '4b6c2a41-43c7-404c-ae37-e8c4645ff93b', ...ANIMATED_PACK, height: 1.5, clips: { walk: 'Walk', idle: 'Idle', graze: 'Eating' } },
  { kind: 'stag', title: 'Stag', id: 'a9c69fbc-bf7c-4585-9a49-a82e0be1ac6b', ...ANIMATED_PACK, height: 1.8, clips: { walk: 'Walk', idle: 'Idle', graze: 'Eating' } },
  { kind: 'fox', title: 'Fox', id: 'e18e86df-1692-48d8-ac6e-1e25ab4ad574', ...ANIMATED_PACK, height: 0.65, clips: { walk: 'Walk', idle: 'Idle', graze: 'Eating' } },
  { kind: 'duck', title: 'Duck', id: 'ea819ee1-f814-4d70-8997-04a33a54c11c', pack: 'Duck', packUrl: 'https://poly.pizza/m/2KHEgw1ztVI', author: 'jeremy', authorUrl: 'https://poly.pizza/u/jeremy', ...CCBY, height: 0.5, clips: {} },
  { kind: 'duckling', title: 'Duck 🦆', id: 'ae89a98c-fa10-4c4e-bfa3-48f33095c136', pack: 'Duck 🦆', packUrl: 'https://poly.pizza/m/77BpUN4DEMT', author: 'Ashley Alicea', authorUrl: 'https://poly.pizza/u/Ashley%20Alicea', ...CCBY, height: 0.32, clips: {} },
];
const dir = join(ROOT, 'web', 'worlds', 'farm3d', 'models');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.js')) rmSync(join(dir, f)); // what the last run wrote, so a dropped animal goes too
const manifest = {}, credits = new Map();
for (const m of MODELS) {
  const res = await fetch(`https://static.poly.pizza/${m.id}.glb`);
  if (!res.ok) throw new Error(`${m.kind}: ${res.status} from poly.pizza`);
  const original = Buffer.from(await res.arrayBuffer()), g = readGlb(original);
  const keep = [...new Set(Object.values(m.clips))];
  const have = new Set((g.json.animations ?? []).map(a => a.name.replace(/^.*\|/, '')));
  for (const c of keep) if (!have.has(c)) throw new Error(`${m.kind}: no clip "${c}" (it has ${[...have].join(', ')})`);
  const glb = trimGlb(g, keep), source = `https://static.poly.pizza/${m.id}.glb`;
  writeFileSync(join(dir, `${m.kind}.js`), `// ${m.title}, by ${m.author}, from ${m.pack} (${m.packUrl}), ${m.licence}: see LICENSE.md beside this file.
// Made by scripts/farm3d-animals.mjs (npm run farm3d-animals) from ${source}: don't edit by hand. A GLB, base64.
export default '${glb.toString('base64')}';
`);
  manifest[m.kind] = { title: m.title, author: m.author, licence: m.licence, source, height: m.height, clips: m.clips, hop: Boolean(m.hop) };
  if (!credits.has(m.packUrl)) credits.set(m.packUrl, { ...m, models: [] });
  credits.get(m.packUrl).models.push(`${m.title} (on the farm: the ${m.kind}), ${source}`);
  console.log(`  ✓ ${m.kind}: ${(original.length / 1024).toFixed(0)} KB → ${(glb.length / 1024).toFixed(0)} KB, clips ${keep.join(', ') || 'none (it floats)'}`);
}
writeFileSync(join(dir, 'index.js'), `// The 3D farm's animals: for each, its model's credit, its height on the farm in metres, and the clips it plays
// (walk, idle, graze; run for the sheepdog), from the models in this folder. Made by scripts/farm3d-animals.mjs: don't edit by hand.
export const MODELS = ${JSON.stringify(manifest, null, 2)};
`);
writeFileSync(join(dir, 'LICENSE.md'), `# The 3D farm's animals

Made into this folder by \`scripts/farm3d-animals.mjs\`: each model trimmed to the animations the farm plays (one copy
of each), its normals, texture coordinates and textures dropped, and its data packed again; nothing else changed.

${[...credits.values()].map(c => `## ${c.pack}, by ${c.author}

${c.packUrl} (${c.author}: ${c.authorUrl})

Licence: **${c.licence}**, ${c.licenceUrl}${c.licence.startsWith('CC0') ? ' (no credit is required; it is given with thanks)' : ' (credit required, given here)'}

${c.models.map(x => `- ${x}`).join('\n')}
`).join('\n')}`);
console.log(`Wrote ${MODELS.length} models, index.js and LICENSE.md to ${dir}`);
