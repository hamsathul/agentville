#!/usr/bin/env node
// Makes a world of your own from the starter world, in your worlds folder (worldsDir in config.json, else
// ~/.agentville/worlds), and says what to do next. No dependencies.
//
//   npm run new-world -- <name> [--worlds <dir>]
import { join } from 'node:path';
import { newWorld } from './lib/new-world.mjs';
import { ROOT, worldsDir } from './lib/worlds-dir.mjs';

const args = process.argv.slice(2);
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--worlds');
if (!name) { console.error('Name your world: npm run new-world -- my-bakery'); process.exit(1); }
const { dir: worlds, cfg } = worldsDir();
try {
  const { dir, title } = newWorld({ name, worldsDir: worlds, starterDir: join(ROOT, 'web', 'worlds', 'starter') });
  const port = cfg.port ?? 7777;
  console.log(`Made ${title} in ${dir}.

Next:
  1. Edit ${join(dir, 'world.js')} (docs/worlds.md is the guide).
  2. With the dashboard running, see it on the test page: http://localhost:${port}/worlds/test?world=u/${name}
  3. npm run check-world -- ${name}
  4. npm run world-shots -- ${name}
  5. In the dashboard, World ▾ → ${title}.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
