// The contained half of npm run check-world (scripts/check-world.mjs starts it): checks one world and prints
// the report. It runs only under Node's permission model with no writes, programs or workers allowed
// (scripts/lib/contained.mjs), and refuses to run otherwise. No dependencies.
//
//   node --permission --allow-fs-read=… scripts/lib/check-world-run.mjs <key> <world folder>
import { checkWorld } from './world-vm.mjs';

const p = process.permission;
if (!p || p.has('fs.write') || p.has('child') || p.has('worker')) {
  console.error('check-world runs a world only contained: use npm run check-world -- <world>.');
  process.exit(1);
}
const [key, dir] = process.argv.slice(2);
const r = await checkWorld({ dir });
console.log(`check-world: ${key} (${dir})`);
console.log("  · contained: it can read only the SDK and this world's folder, and can't write or start programs (it can still reach the network)");
if (r.json) console.log(`  ✗ world.json: ${r.json}`);
console.log(`  ${r.errors.length ? '✗' : '✓'} ${r.ran} stop${r.ran === 1 ? '' : 's'} of the tour, a few frames each${r.errors.length ? `: ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}` : ''}`);
for (const e of r.errors) console.log(`  ✗ ${e.stop}: ${e.message}${e.where ? ` (${e.where})` : ''}`);
for (const c of r.creatures) console.log(`  ✗ creatures: ${c}`);
for (const n of r.notes) console.log(`  · ${n}`);
if (r.defaults.length) console.log(`  · hooks left to their defaults: ${r.defaults.join(', ')}`);
for (const s of r.same) console.log(`  · may draw the same (a pointer, not a verdict): ${s}`);
if (r.unknown.length) console.log(`  · outfit parts the people kit doesn't have (drawn as the default): ${r.unknown.join(', ')}`);
process.exit(r.errors.length || r.json || r.creatures.length ? 1 : 0);
