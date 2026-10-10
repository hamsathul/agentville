// Where your worlds are, as the collector decides: worldsDir in config.json (else ~/.agentville/worlds), or
// --worlds <dir> on the command line (for trying things in a folder of your own). For the world scripts.
// A malformed config.json is not fatal here, as in the collector: one warning, and the defaults.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, mergeConfig } from '../../collector/config.mjs';
import { worldsDirOf } from '../../collector/worlds.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export function worldsDir(argv = process.argv, configPath = join(ROOT, 'config.json')) {
  let cfg;
  try { cfg = loadConfig(configPath); } catch (err) {
    console.warn(`config.json is unusable (${err.message}): using the defaults.`);
    cfg = mergeConfig({});
  }
  const at = argv.indexOf('--worlds');
  return { dir: at > 0 && argv[at + 1] ? resolve(argv[at + 1]) : worldsDirOf(cfg, homedir(), msg => console.warn(msg)), cfg };
}
/** The built-in worlds' names: the folders of web/worlds with a world.json (the farm, the factory, the starter). */
export const builtInKeys = (dir = join(ROOT, 'web', 'worlds')) => readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(dir, d.name, 'world.json'))).map(d => d.name);
/** A world's key from what you typed: a built-in world's name (farm, starter…), u/<name>, or <name> (one of yours). */
export const keyOf = (arg, builtIns = builtInKeys()) => (builtIns.includes(arg) || arg.startsWith('u/') ? arg : `u/${arg}`);
