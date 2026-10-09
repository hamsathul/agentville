// The contained half of npm run check-world (scripts/check-world.mjs starts it): checks one world and prints
// the report. It runs only under Node's permission model with no writes, programs or workers allowed
// (scripts/lib/contained.mjs), and refuses to run otherwise. Every word of the world's in the report goes
// through oneLine() (scripts/lib/plain-text.mjs: no control characters, no line of its own), and the command
// prints it all through plain() again. No dependencies.
//
//   node --permission --allow-fs-read=… scripts/lib/check-world-run.mjs <key> <folder> <world.js> <world.json>
import { oneLine } from './plain-text.mjs';
import { checkWorld } from './world-vm.mjs';

const p = process.permission;
if (!p || p.has('fs.write') || p.has('child') || p.has('worker')) {
  console.error('check-world runs a world only contained: use npm run check-world -- <world>.');
  process.exit(1);
}
const [key, dir, file = 'world.js', json = 'world.json'] = process.argv.slice(2);
const r = await checkWorld({ dir, file, json });
const out = [], say = line => out.push(line), list = xs => xs.map(x => oneLine(x)).join(', ');
say(`check-world: ${oneLine(key)} (${oneLine(dir, 1000)})`);
say("  · contained: it can read only the SDK and this world's world.js and world.json, and can't write or start programs (it can still reach the network)");
if (r.json) say(`  ✗ world.json: ${oneLine(r.json)}`);
say(`  ${r.errors.length ? '✗' : '✓'} ${r.ran} stop${r.ran === 1 ? '' : 's'} of the tour, a few frames each${r.errors.length ? `: ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}` : ''}`);
for (const e of r.errors) say(`  ✗ ${oneLine(e.stop)}: ${oneLine(e.message)}${e.where ? ` (${oneLine(e.where)})` : ''}`);
for (const c of r.creatures) say(`  ✗ creatures: ${oneLine(c)}`);
for (const n of r.notes) say(`  · ${oneLine(n)}`);
if (r.defaults.length) say(`  · hooks left to their defaults: ${list(r.defaults)}`);
for (const s of r.same) say(`  · may draw the same (a pointer, not a verdict): ${oneLine(s)}`);
if (r.unknown.length) say(`  · outfit parts the people kit doesn't have (drawn as the default): ${list(r.unknown)}`);
// Written at once, and the exit waits for it: what is printed goes down a pipe to the command.
process.stdout.write(`${out.join('\n')}\n`, () => process.exit(r.errors.length || r.json || r.creatures.length ? 1 : 0));
