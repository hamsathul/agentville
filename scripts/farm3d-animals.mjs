#!/usr/bin/env node
// The 3D farm's animals: the twelve animated models of Quaternius's Animated Animal Pack on poly.pizza (CC0), and for
// the pond his frog, three of his fish and a lily pad (CC0, single models on poly.pizza). Downloads
// each (a GLB, by its pinned id), keeps every animation once (the pack holds two copies) and fails if one goes unused,
// drops what the farm's flat shading doesn't use (normals, texture coordinates, textures), packs what is left small
// (scripts/lib/glb.mjs), and writes it to web/worlds/farm3d/models/<kind>.js (a world's frame can't fetch a model file:
// the world imports it), with models/index.js (each animal's height, family and clips) and models/LICENSE.md (the
// credit). Needs the network. No dependencies.
//
//   npm run farm3d-animals
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGlb, trimGlb } from './lib/glb.mjs';
import { ROOT } from './lib/worlds-dir.mjs';

const QUATERNIUS = { author: 'Quaternius', authorUrl: 'https://poly.pizza/u/Quaternius', licence: 'CC0 (public domain)', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const PACK = { ...QUATERNIUS, pack: 'Animated Animal Pack', packUrl: 'https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS' };
/**
 * The pack's two rigs and their clips, by what the farm does with each (web/worlds/farm3d/antics.js): the hoofed
 * animals kick and headbutt, the dogs, the fox and the wolf pounce. Every clip in a model is one of these.
 */
const HOOVES = { walk: 'Walk', run: 'Gallop', leap: 'Gallop_Jump', hop: 'Jump_toIdle', idle: 'Idle', look: 'Idle_2', headlow: 'Idle_Headlow', eat: 'Eating', flinchLeft: 'Idle_HitReact_Left', flinchRight: 'Idle_HitReact_Right', kick: 'Attack_Kick', headbutt: 'Attack_Headbutt', dead: 'Death' };
const PAWS = { walk: 'Walk', run: 'Gallop', leap: 'Gallop_Jump', hop: 'Jump_ToIdle', idle: 'Idle', look: 'Idle_2', headlow: 'Idle_2_HeadLow', eat: 'Eating', flinchLeft: 'Idle_HitReact_Left', flinchRight: 'Idle_HitReact_Right', pounce: 'Attack', dead: 'Death' };
/** The pond's frog: it sits, hops (pad to pad, into the water and out), snaps at a fly, and plays dead. A fish swims, at every pace. */
const FROG = { idle: 'Frog_Idle', hop: 'Frog_Jump', snap: 'Frog_Attack', dead: 'Frog_Death' };
const SWIM = clip => ({ idle: clip, walk: clip, run: clip });
/** The pack's animals, each with its height on the farm in metres (before the farm makes them larger than life). */
export const MODELS = [
  { kind: 'cow', title: 'Cow', id: '382b3d4a-a7c9-4c03-9858-3df630d90047', height: 1.5, family: 'hooves' },
  { kind: 'bull', title: 'Bull', id: '5704ef69-2c27-4de8-a942-70a29458af21', height: 1.65, family: 'hooves' },
  { kind: 'alpaca', title: 'Alpaca', id: '444228bb-745d-49b2-89ef-cc12805deaa8', height: 1.75, family: 'hooves' },
  { kind: 'donkey', title: 'Donkey', id: 'ca29f94e-0874-41b6-8334-66642af56a61', height: 1.35, family: 'hooves' },
  { kind: 'horse', title: 'Horse', id: 'd37dbc87-ca61-4b2c-a2da-d2f0c4240bef', height: 1.85, family: 'hooves' },
  { kind: 'whitehorse', title: 'White Horse', id: '3edc2bd9-3378-4b43-a50d-d5e1f858562b', height: 1.85, family: 'hooves' },
  { kind: 'deer', title: 'Deer', id: '4b6c2a41-43c7-404c-ae37-e8c4645ff93b', height: 1.5, family: 'hooves' },
  { kind: 'stag', title: 'Stag', id: 'a9c69fbc-bf7c-4585-9a49-a82e0be1ac6b', height: 1.9, family: 'hooves' },
  { kind: 'husky', title: 'Husky', id: '611d25c7-430f-4bb5-ab2c-d8f5f3cb9712', height: 0.85, family: 'paws' },
  { kind: 'shiba', title: 'Shiba Inu', id: 'ba6d0ee3-bcc0-4ef0-9d3c-a3e245b41c77', height: 0.7, family: 'paws' },
  { kind: 'fox', title: 'Fox', id: 'e18e86df-1692-48d8-ac6e-1e25ab4ad574', height: 0.6, family: 'paws' },
  { kind: 'wolf', title: 'Wolf', id: 'f1d12388-e39b-4157-b32a-646a1d089fc4', height: 0.95, family: 'paws' },
].map(m => ({ ...m, ...PACK, clips: m.family === 'hooves' ? HOOVES : PAWS })).concat([
  // the pond's (their pages are their credit): a frog a hand high (before the farm makes it larger than life), fish by their length, a pad by its width
  { kind: 'frog', title: 'Frog', id: '08416495-b056-4ed7-b23b-5a10e82277a0', page: 'https://poly.pizza/m/9Z2V8fpazF', height: 0.22, family: 'frog', clips: FROG },
  { kind: 'trout', title: 'Fish', id: '311a79f6-ba3e-47aa-80ce-04185fc76b2a', page: 'https://poly.pizza/m/XWl86YFtpF', length: 0.6, family: 'fish', clips: SWIM('Swim') },
  { kind: 'koi', title: 'Fish', id: '6805b99c-5fd7-4aab-bf57-3bb645e1108a', page: 'https://poly.pizza/m/BEcU9rjiAq', length: 0.6, family: 'fish', clips: SWIM('Swim') },
  { kind: 'roach', title: 'Fish', id: '8410757e-6594-4011-817a-633730fbcaf8', page: 'https://poly.pizza/m/Ymu8ftrmuT', length: 0.5, family: 'fish', clips: SWIM('Swim.001') },
  { kind: 'lilypad', title: 'Lilypad', id: 'ae432cca-6422-42ef-a982-b74bd0fc99b2', page: 'https://poly.pizza/m/TI6ukUlsLh', length: 0.8, family: 'still', clips: {} },
].map(m => ({ ...m, ...QUATERNIUS, pack: null, packUrl: null })));
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
  for (const c of have) if (!keep.includes(c)) throw new Error(`${m.kind}: its clip "${c}" isn't used: give it a part in its clips (HOOVES, PAWS, FROG, SWIM)`);
  const glb = trimGlb(g, keep), source = `https://static.poly.pizza/${m.id}.glb`;
  writeFileSync(join(dir, `${m.kind}.js`), `// ${m.title}, by ${m.author}, ${m.pack ? `from ${m.pack} (${m.packUrl})` : `on poly.pizza (${m.page})`}, ${m.licence}: see LICENSE.md beside this file.
// Made by scripts/farm3d-animals.mjs (npm run farm3d-animals) from ${source}: don't edit by hand. A GLB, base64.
export default '${glb.toString('base64')}';
`);
  manifest[m.kind] = { title: m.title, author: m.author, licence: m.licence, pack: m.pack, ...(m.page ? { page: m.page } : {}), source, ...(m.height ? { height: m.height } : { length: m.length }), family: m.family, clips: m.clips };
  const group = m.packUrl ?? m.authorUrl;
  if (!credits.has(group)) credits.set(group, { ...m, models: [] });
  credits.get(group).models.push(`${m.title} (on the farm: the ${m.kind}), ${m.page ? `${m.page}, ` : ''}${source}`);
  console.log(`  ✓ ${m.kind}: ${(original.length / 1024).toFixed(0)} KB → ${(glb.length / 1024).toFixed(0)} KB, ${keep.length} clips`);
}
writeFileSync(join(dir, 'index.js'), `// The 3D farm's animals and the pond's: for each, its model's credit, its size on the farm in metres (an animal's
// height; a fish's or a lily pad's length), its family (hooves, paws, frog, fish, or still) and its clips by what the
// farm does with them, from the models in this folder. Made by scripts/farm3d-animals.mjs: don't edit by hand.
export const MODELS = ${JSON.stringify(manifest, null, 2)};
`);
writeFileSync(join(dir, 'LICENSE.md'), `# The 3D farm's animals

Made into this folder by \`scripts/farm3d-animals.mjs\`: each model with every animation once (the pack holds two
copies), its normals, texture coordinates and textures dropped, its animation keys thinned and its data packed again
(scripts/lib/glb.mjs); nothing else changed. On the farm, \`../coats.js\` repaints them as they load: lighter colours
and the farm's matte finish.

${[...credits.values()].map(c => `## ${c.pack ?? 'Single models'}, by ${c.author}

${c.packUrl ? `${c.packUrl} (${c.author}: ${c.authorUrl})` : `${c.author}: ${c.authorUrl}`}

Licence: **${c.licence}**, ${c.licenceUrl} (no credit is required; it is given with thanks)

${c.models.map(x => `- ${x}`).join('\n')}
`).join('\n')}`);
console.log(`Wrote ${MODELS.length} models, index.js and LICENSE.md to ${dir}`);
