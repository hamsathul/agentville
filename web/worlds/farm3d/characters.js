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

/**
 * An idle farmer's moves, now and then (its idle the rest of the time): a look round, a wave, a fly swatted, a pebble
 * kicked, a point at something, a fiddle with something; each lasts `secs` (a once-through clip, its length).
 */
export const FIDGETS = [
  { part: 'idle2', secs: 4 },
  { part: 'wave', secs: 2.5 },
  { part: 'flinch', secs: 0.6, once: true },
  { part: 'kick', secs: 1, once: true },
  { part: 'point', secs: 2.5 },
  { part: 'raise', secs: 3 },
];
/**
 * One idle farmer's routine, on its own rhythm (its own rand): `part(t)` is what it plays at clock t (seconds; 0 while
 * still, its idle): its idle, and every 4 to 12 s one of its moves, never the same twice running.
 */
export function makeIdler(rand = Math.random) {
  let next = null, until = 0, cur = null, last = null;
  return {
    part(t) {
      if (!t) return { part: 'idle' };
      if (next === null) next = t + 1 + rand() * 7; // when it first moves: each farmer its own moment
      if (cur && t < until) return cur;
      if (cur) { cur = null; next = t + 4 + rand() * 8; }
      if (t < next) return { part: 'idle' };
      const pool = FIDGETS.filter(f => f.part !== last), f = pool[Math.floor(rand() * pool.length) % pool.length];
      last = f.part;
      cur = { part: f.part, once: Boolean(f.once) };
      until = t + f.secs;
      return cur;
    },
  };
}
