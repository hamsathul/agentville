// check-world's containment: the world's code runs in a Node of its own under Node's permission model. It may
// read only what a check needs (the files world-vm.mjs lists, and the world's own folder); it may not write,
// start programs or workers; and it gets no environment, so nothing secret is in reach of it. It can still
// reach the network. No dependencies.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FILES } from './world-vm.mjs';

export const RUNNER = fileURLToPath(new URL('./check-world-run.mjs', import.meta.url));
/** Can this Node contain a world? (--permission is Node 22.13 and later, and 23.5 and later.) */
export const canContain = () => process.allowedNodeEnvironmentFlags.has('--permission');
/** Node's flags for a contained run that may read the check's own files and `worldDir`, and nothing else. */
export const containedFlags = (worldDir, reads = []) => ['--permission', ...[RUNNER, ...FILES, realpathSync(worldDir), ...reads].map(p => `--allow-fs-read=${p}`)];
/** Runs `args` (a script and its arguments) in a contained Node with an empty environment. */
export const runContained = (worldDir, args, { stdio = 'inherit', reads = [] } = {}) =>
  spawnSync(process.execPath, [...containedFlags(worldDir, reads), ...args], { stdio, env: {}, encoding: 'utf8' });
