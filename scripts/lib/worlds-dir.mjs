// Where your worlds are, as the collector decides: worldsDir in config.json (else ~/.agentville/worlds), or
// --worlds <dir> on the command line (for trying things in a folder of your own). For the world scripts.
// A malformed config.json is not fatal here, as in the collector: one warning, and the defaults.
import { existsSync, readdirSync, statSync } from 'node:fs';
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
/** The built-in worlds' names: the folders of web/worlds with a world.json, the farm first (farm, factory, starter). */
export const builtInKeys = (dir = join(ROOT, 'web', 'worlds')) => readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(dir, d.name, 'world.json'))).map(d => d.name)
  .sort((a, b) => (a === 'farm' ? -1 : b === 'farm' ? 1 : a.localeCompare(b)));
const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
/**
 * A world's key from what you typed: a built-in world's name (farm, factory, starter…), u/<name>, or <name>
 * (one of yours). A built-in name wins; when one of yours in `userDir` has it too, `warn` says how to reach yours.
 */
export function keyOf(arg, { builtIns = builtInKeys(), userDir = null, warn = m => console.error(m) } = {}) {
  if (arg.startsWith('u/')) return arg;
  if (!builtIns.includes(arg)) return `u/${arg}`;
  if (userDir && isDir(join(userDir, arg))) warn(`There is a built-in world and one of yours named ${arg}: checking the built-in. For yours, use u/${arg}.`);
  return arg;
}
/** What the world scripts ask for when you name none: the built-in worlds' names, or one of yours. */
export const whichWorld = script => `Which world? npm run ${script} -- <${[...builtInKeys(), 'your folder'].join(' | ')}>`;
