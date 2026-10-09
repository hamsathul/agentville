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
