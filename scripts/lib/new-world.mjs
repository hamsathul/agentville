// A world of your own from the starter (web/worlds/starter/): its files copied into your worlds folder under
// the name you give, with that name (as a title) in world.json. A taken or bad name is refused, and a copy
// that fails half-way is removed, so nothing is left half-made. For scripts/new-world.mjs and its tests.
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORLD_NAME } from '../../collector/worlds.mjs';

const exists = p => { try { lstatSync(p); return true; } catch { return false; } };
/** 'my-bakery' → 'My bakery'. */
export const titleOf = name => name.replace(/-+/g, ' ').trim().replace(/^./, c => c.toUpperCase());

export function newWorld({ name, worldsDir, starterDir }) {
  if (typeof name !== 'string' || !WORLD_NAME.test(name)) throw new Error("A world's name is lowercase letters, digits and dashes, up to 40, like my-bakery.");
  if (exists(worldsDir) && !statSync(worldsDir).isDirectory()) throw new Error(`${worldsDir} is not a folder: set worldsDir in config.json to a folder.`);
  const dir = join(worldsDir, name);
  if (exists(dir)) throw new Error(`${dir} already exists: pick another name, or move that folder away first.`);
  mkdirSync(worldsDir, { recursive: true });
  mkdirSync(dir); // not recursive: if something made it meanwhile, this fails and nothing is touched
  const title = titleOf(name);
  try {
    for (const f of readdirSync(starterDir)) {
      if (f.startsWith('.') || !statSync(join(starterDir, f)).isFile()) continue;
      if (f === 'world.json') {
        const j = JSON.parse(readFileSync(join(starterDir, f), 'utf8'));
        writeFileSync(join(dir, f), `${JSON.stringify({ ...j, name: title }, null, 2)}\n`);
      } else copyFileSync(join(starterDir, f), join(dir, f));
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Couldn't copy the starter world: ${err.message}`);
  }
  return { dir, title };
}

/**
 * A folder as one word on a command line: as it is when it is plain, else quoted. On Windows a backslash and a drive colon
 * are plain, and a folder that needs quoting goes in double quotes (single quotes mean nothing to cmd.exe).
 */
const shellArg = (s, windows) => {
  if (windows) return /^[\w@%+=:,./~\\-]+$/.test(s) ? s : `"${s}"`;
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
};

/**
 * What to do next, for the new world's message. Its commands name it u/<name> (a world of yours called farm is
 * not the farm), and repeat `--worlds <dir>` when `worlds` (that folder) was given; the dashboard and its test
 * page show only your worlds folder, so that case says so.
 */
export function nextSteps({ dir, name, title, port = 7777, worlds = null, windows = process.platform === 'win32' }) {
  const key = `u/${name}`, w = worlds ? ` --worlds ${shellArg(worlds, windows)}` : '';
  return `Made ${title} in ${dir}.

Next:
  1. Edit ${join(dir, 'world.js')} (docs/worlds.md is the guide).
  2. With the dashboard running, see it on the test page: http://localhost:${port}/worlds/test?world=${key}
  3. npm run check-world -- ${key}${w}
  4. npm run world-shots -- ${key}${w}
  5. In the dashboard, World ▾ → ${title}, among your worlds (after the built-in ones).${worlds ? `
The dashboard and its test page show only your worlds folder (worldsDir in config.json, else
~/.agentville/worlds): for steps 2 and 5, the world has to be in it.` : ''}`;
}
