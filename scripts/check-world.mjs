#!/usr/bin/env node
// Checks a world headless before you look at it: every stop of the tour, a few frames each, in a vm with a
// canvas that records what is drawn. Reports exceptions with file and line, hooks left to their defaults,
// checklist items it draws the same in two states (a pointer, not a verdict), outfit parts the people
// kit lacks, and creatures that break the animals kit's rules. Exits 1 on an exception, a bad world.json
// or a creature problem. No dependencies.
//
// The world's code runs contained, in a Node of its own (scripts/lib/contained.mjs): it can read only the
// SDK and the world's world.js and world.json, and can't write or start programs. It can still reach the
// network. It doesn't get your terminal: what it prints is printed here, without control sequences. A world
// whose world.js or world.json leads out of its folder isn't run, nor is any world with a Node that can't
// contain it.
//
//   npm run check-world -- <world> [--worlds <dir>]
//   <world>: a built-in world's name (a folder of web/worlds: farm, factory, starter…), u/<folder> or <folder>
//   (one of yours). A built-in name wins over one of yours, with a line saying so: u/<folder> reaches yours.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeWorlds } from '../collector/worlds.mjs';
import { canContain, plainLines, runContained, runnerArgs, worldFiles } from './lib/contained.mjs';
import { ROOT, keyOf, whichWorld, worldsDir } from './lib/worlds-dir.mjs';

const args = process.argv.slice(2);
const arg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--worlds');
if (!arg) { console.error(whichWorld('check-world')); process.exit(1); }
const { dir: userDir } = worldsDir(), key = keyOf(arg, { userDir });
const dir = makeWorlds({ builtinDir: join(ROOT, 'web', 'worlds'), userDir, home: homedir() }).dirOf(key);
if (!dir) { console.error(`No world ${key}${key.startsWith('u/') ? ` in ${userDir}` : ''}.`); process.exit(1); }
if (!canContain()) { console.error(`check-world needs a Node that can contain a world (--permission: Node 22.13 or later, or 23.5 or later); this is ${process.version}.`); process.exit(1); }
let world;
try { world = worldFiles(dir); } catch (err) { console.error(`${key}: ${err.message}`); process.exit(1); }
const r = runContained(world, runnerArgs(key, world));
// The check's report, and anything else it printed, a line at a time with no control sequence in it: a world's
// words are its own to choose, and your terminal would act on them (scripts/lib/plain-text.mjs).
process.stdout.write(plainLines(r.stdout));
process.stderr.write(plainLines(r.stderr));
if (r.error || r.status === null) { console.error(`check-world couldn't run the contained check: ${r.error?.message ?? `it stopped (${r.signal})`}.`); process.exitCode = 1; }
else process.exitCode = r.status;
