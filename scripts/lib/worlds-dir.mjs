// Where your worlds are, as the collector decides: worldsDir in config.json (else ~/.agentville/worlds), or
// --worlds <dir> on the command line (for trying things in a folder of your own). For the world scripts.
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../collector/config.mjs';
import { worldsDirOf } from '../../collector/worlds.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export function worldsDir(argv = process.argv) {
  const cfg = loadConfig(join(ROOT, 'config.json'));
  const at = argv.indexOf('--worlds');
  return { dir: at > 0 && argv[at + 1] ? resolve(argv[at + 1]) : worldsDirOf(cfg, homedir(), msg => console.warn(msg)), cfg };
}
/** A world's key from what you typed: farm or starter (built in), u/<name>, or <name> (one of yours). */
export const keyOf = (arg, builtIns = ['farm', 'starter']) => (builtIns.includes(arg) || arg.startsWith('u/') ? arg : `u/${arg}`);
