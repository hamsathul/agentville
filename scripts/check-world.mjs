#!/usr/bin/env node
// Checks a world headless before you look at it: every stop of the tour, a few frames each, in a vm with a
// canvas that records what is drawn. Reports exceptions with file and line, hooks left to their defaults,
// checklist items it draws the same in two states (a pointer, not a verdict), outfit parts the people
// kit lacks, and creatures that break the animals kit's rules. Exits 1 on an exception, a bad world.json
// or a creature problem. No dependencies.
//
// The world's code runs contained, in a Node of its own (scripts/lib/contained.mjs): it can read only the
// SDK and its own folder, and can't write or start programs. It can still reach the network. With a Node
// that can't contain it, the check doesn't run.
//
//   npm run check-world -- <world> [--worlds <dir>]      <world>: farm, starter, u/<folder> or <folder>
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeWorlds } from '../collector/worlds.mjs';
import { RUNNER, canContain, runContained } from './lib/contained.mjs';
import { ROOT, keyOf, worldsDir } from './lib/worlds-dir.mjs';

const args = process.argv.slice(2);
const arg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--worlds');
if (!arg) { console.error('Which world? npm run check-world -- <farm | starter | your folder>'); process.exit(1); }
const key = keyOf(arg), { dir: userDir } = worldsDir();
const dir = makeWorlds({ builtinDir: join(ROOT, 'web', 'worlds'), userDir, home: homedir() }).dirOf(key);
if (!dir) { console.error(`No world ${key}${key.startsWith('u/') ? ` in ${userDir}` : ''}.`); process.exit(1); }
if (!canContain()) { console.error(`check-world needs a Node that can contain a world (--permission: Node 22.13 or later); this is ${process.version}.`); process.exit(1); }
const real = realpathSync(dir); // a world folder that is a link: the folder it leads to is what may be read
const r = runContained(real, [RUNNER, key, real]);
if (r.error || r.status === null) { console.error(`check-world couldn't run the contained check: ${r.error?.message ?? `it stopped (${r.signal})`}.`); process.exit(1); }
process.exit(r.status);
