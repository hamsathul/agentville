// check-world's containment: the world's code runs in a Node of its own under Node's permission model. It may
// read only what a check needs (the files world-vm.mjs lists, and the world's world.js and world.json, never
// its folder: Node follows a link inside a folder it may read); it may not write, start programs or workers;
// and it gets no environment, so nothing secret is in reach of it. It can still reach the network.
// No dependencies.
import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES } from './world-vm.mjs';

export const RUNNER = fileURLToPath(new URL('./check-world-run.mjs', import.meta.url));
/** Can this Node contain a world? (--permission is Node 22.13 and later, and 23.5 and later.) */
export const canContain = () => process.allowedNodeEnvironmentFlags.has('--permission');

/**
 * The world's two files, each as its real path, which must be a regular file inside the real path of the
 * world's own folder (so a link out of the folder is refused): { dir, js, json }. A world.json that isn't
 * there at all is let through, for the check to report. Throws an Error of one line naming the file otherwise.
 */
export function worldFiles(folder) {
  const dir = realpathSync(folder);
  const one = (name, mayBeMissing = false) => {
    const at = join(dir, name);
    let real;
    try { real = realpathSync(at); } catch (err) {
      let there = true;
      try { lstatSync(at); } catch { there = false; }
      if (!there && mayBeMissing) return at; // the check says "world.json is missing."
      throw new Error(there ? `${name} is a link to something that isn't there.` : `${name} is missing.`);
    }
    if (!real.startsWith(dir + sep)) throw new Error(`${name} is a link to a file outside the world's folder: check-world won't run this world.`);
    if (!statSync(real).isFile()) throw new Error(`${name} isn't a file.`);
    return real;
  };
  return { dir, js: one('world.js'), json: one('world.json', true) };
}

/** Node's flags for a contained run that may read the check's own files and the world's two files, and nothing else. */
export const containedFlags = world => ['--permission', ...[RUNNER, ...FILES, world.js, world.json].map(p => `--allow-fs-read=${p}`)];
/** Runs `args` (a script and its arguments) in a contained Node with an empty environment. */
export const runContained = (world, args, { stdio = 'inherit' } = {}) =>
  spawnSync(process.execPath, [...containedFlags(world), ...args], { stdio, env: {}, encoding: 'utf8' });
/** The runner's arguments for a world: its key, its folder, and its two files relative to the folder. */
export const runnerArgs = (key, world) => [RUNNER, key, world.dir, relative(world.dir, world.js), relative(world.dir, world.json)];
