#!/usr/bin/env node
// Makes a world of your own from the starter world, in your worlds folder (worldsDir in config.json, else
// ~/.agentville/worlds), and says what to do next. No dependencies.
//
//   npm run new-world -- <name> [--worlds <dir>]
import { join } from 'node:path';
import { newWorld, nextSteps } from './lib/new-world.mjs';
import { ROOT, worldsDir } from './lib/worlds-dir.mjs';

const args = process.argv.slice(2);
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--worlds');
if (!name) { console.error('Name your world: npm run new-world -- my-bakery'); process.exit(1); }
const { dir: worlds, cfg } = worldsDir(), at = args.indexOf('--worlds');
try {
  const { dir, title } = newWorld({ name, worldsDir: worlds, starterDir: join(ROOT, 'web', 'worlds', 'starter') });
  console.log(nextSteps({ dir, name, title, port: cfg.port ?? 7777, worlds: at >= 0 && args[at + 1] ? worlds : null }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
