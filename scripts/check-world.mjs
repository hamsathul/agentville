#!/usr/bin/env node
// Checks a world headless before you look at it: every stop of the tour, a few frames each, in a vm with a
// canvas that records what is drawn. Reports exceptions with file and line, hooks left to their defaults,
// checklist items it draws the same in two states (a pointer, not a verdict), outfit parts the people
// kit lacks, and creatures that break the animals kit's rules. Exits 1 on an exception, a bad world.json
// or a creature problem. No dependencies. A node:vm context is not a sandbox: run it only on worlds you
// trust, as you would any script (the frame is where an untrusted world belongs).
//
//   npm run check-world -- <world> [--worlds <dir>]      <world>: farm, starter, u/<folder> or <folder>
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeWorlds } from '../collector/worlds.mjs';
import { checkWorld } from './lib/world-vm.mjs';
import { ROOT, keyOf, worldsDir } from './lib/worlds-dir.mjs';

const args = process.argv.slice(2);
const arg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--worlds');
if (!arg) { console.error('Which world? npm run check-world -- <farm | starter | your folder>'); process.exit(1); }
const key = keyOf(arg), { dir: userDir } = worldsDir();
const dir = makeWorlds({ builtinDir: join(ROOT, 'web', 'worlds'), userDir, home: homedir() }).dirOf(key);
if (!dir) { console.error(`No world ${key}${key.startsWith('u/') ? ` in ${userDir}` : ''}.`); process.exit(1); }
const r = await checkWorld({ dir });
console.log(`check-world: ${key} (${dir})`);
if (r.json) console.log(`  ✗ world.json: ${r.json}`);
console.log(`  ${r.errors.length ? '✗' : '✓'} ${r.ran} stop${r.ran === 1 ? '' : 's'} of the tour, a few frames each${r.errors.length ? `: ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}` : ''}`);
for (const e of r.errors) console.log(`  ✗ ${e.stop}: ${e.message}${e.where ? ` (${e.where})` : ''}`);
for (const c of r.creatures) console.log(`  ✗ creatures: ${c}`);
for (const n of r.notes) console.log(`  · ${n}`);
if (r.defaults.length) console.log(`  · hooks left to their defaults: ${r.defaults.join(', ')}`);
for (const s of r.same) console.log(`  · may draw the same (a pointer, not a verdict): ${s}`);
if (r.unknown.length) console.log(`  · outfit parts the people kit doesn't have (drawn as the default): ${r.unknown.join(', ')}`);
process.exit(r.errors.length || r.json || r.creatures.length ? 1 : 0);
