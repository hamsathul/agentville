// Which of Quaternius's characters (models/, family `person`) a farmer is, and which of its clips plays each of the
// figurine's poses (build/figurine.js names them). No three.js: build/character.js draws them, the tests run it.

/** The characters, in the order an agent's id picks from. */
export const CHARACTERS = ['farmer', 'worker', 'casual', 'hoodie', 'business', 'beach', 'woman', 'womancasual', 'womanadventurer'];

/** An agent's character: from its id, the same every time, spread over them all. */
export function characterFor(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; // stir, so ids that differ by a letter spread
  return CHARACTERS[((h ^ (h >>> 12)) >>> 0) % CHARACTERS.length];
}

/** The figurine's poses, every one a character plays. */
export const POSES = ['walk', 'run', 'swing', 'hold', 'raise', 'carry', 'push', 'wave', 'basket', 'idle', 'nap'];
/** The part (models/index.js names its clip) a pose plays: a basket and a cart are carried as a crate is. */
export const clipFor = pose => ({ push: 'carry', basket: 'carry' })[pose] ?? pose;
