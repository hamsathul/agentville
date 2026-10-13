// The animals with each other: two play together (tag, wrestle, race, greet) or play-fight (a headbutt duel, a
// squabble, a dog chasing the fox off), made of the moves their models have; nobody is hurt, a fight ends with one
// giving way. One at a time, every minute or two (a squabble and a chase-off when they happen to meet), only with the
// animals shown and the farm moving, never with one busy with something else. Each is a little conversation in talk
// bubbles, its lines tied to its beats (a dare, the middle, who won). Pure: app.js hands it the animals (ctx).
import { FARMSTEAD } from './layout.js';
import { SOUNDS, kindWord } from './play.js';

const DOGS = ['husky', 'shiba'], HORSES = ['horse', 'whitehorse'];
const RANGE = 200; // 25 m: a romp's two start this near (a game of tag may run further)
const LINE_S = 2.5; // how long a line shows
const BEAT_MAX_S = 12; // a beat that hasn't finished by then moves on
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (box, x, y, pad) => x > box.x - pad && x < box.x + box.w + pad && y > box.y - pad && y < box.y + box.h + pad;
const rounds = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/** The steps for a few rounds, each its own (k: which round), the first saying the middle's lines. */
const each = (n, make) => Array.from({ length: n }, (_, k) => ({ ...make(k), say: k === 0 ? 'mid' : null }));

/**
 * Who romps with whom: `pairs` [first's kind, second's kind] ('fish' for any two fish, 'family' for two of a family
 * that walks), play or play-fight, how often (weight), how near they start (range: 25 m unless it says), a trigger for those that happen when two
 * meet, and its beats: (A, B, { rand, spot, winner }) → [{ a: steps, b: steps, say: 'start' | 'mid' | 'end' | null,
 * fx?: 'dust' | 'hearts' }], A and B the animals' live records (steps chase, flee, meet and face them as they move).
 */
export const ROMPS = [
  {
    id: 'tag', play: true, weight: 3, pairs: [['husky', 'shiba'], ['fox', 'wolf'], ['fish', 'fish']],
    beats: (A, B, { rand }) => [
      { a: [{ face: B }], b: [{ face: A }], say: 'start' },
      ...each(rounds(rand, 3, 4), k => { const [it, them] = k % 2 ? [B, A] : [A, B], run = [{ part: 'run', chase: them, within: 10, secs: 6 }], flee = [{ part: 'run', flee: it, far: 50 }]; return k % 2 ? { a: flee, b: run } : { a: run, b: flee }; }),
      { a: [{ face: B }, { part: 'idle', secs: 2 }], b: [{ face: A }, { part: 'idle', secs: 2 }], say: 'end' },
      { a: [{ part: 'walk', to: 'home' }], b: [{ part: 'walk', to: 'home' }] },
    ],
  },
  {
    id: 'wrestle', play: true, weight: 2, pairs: [['husky', 'shiba']],
    beats: (A, B, { rand }) => [
      { a: [{ part: 'walk', meet: B, gap: 14 }, { face: B }], b: [{ face: A }], say: 'start' },
      ...each(rounds(rand, 3, 5), k => (k % 2 ? { a: [{ part: 'flinchLeft' }], b: [{ part: 'headlow', secs: 0.6 }, { part: 'pounce' }] } : { a: [{ part: 'headlow', secs: 0.6 }, { part: 'pounce' }], b: [{ part: 'flinchLeft' }] })),
      { a: [{ part: 'run', to: 'far' }], b: [{ part: 'run', to: 'far' }], say: 'end' },
    ],
  },
  {
    id: 'race', play: true, weight: 2, pairs: [['horse', 'whitehorse'], ['horse', 'donkey'], ['whitehorse', 'donkey']],
    beats: (A, B, { spot }) => {
      const t = spot('pasture', [A.x, A.y], 150) ?? [A.x + 150, A.y], t2 = [t[0], t[1] + 12];
      return [
        { a: [{ part: 'walk', meet: B, gap: 12 }, { face: t }], b: [{ face: t }], say: 'start' },
        { a: [{ part: 'run', to: t }, { part: 'leap', go: true }], b: [{ part: 'run', to: t2 }, { part: 'leap', go: true }], say: 'mid' },
        { a: [{ part: 'look' }], b: [{ part: 'look' }], say: 'end' },
        { a: [{ part: 'walk', to: 'home' }], b: [{ part: 'walk', to: 'home' }] },
      ];
    },
  },
  {
    // nose to nose, a sniff (dogs hop too), and hearts between two horses or two alpacas
    id: 'greet', play: true, weight: 3, range: 32, pairs: 'family',
    beats: (A, B) => [
      { a: [{ part: 'walk', meet: B, gap: 16 }, { face: B }], b: [{ face: A }], say: 'start' },
      { a: [{ part: 'headlow', secs: 3 }, ...(DOGS.includes(A.kind) ? [{ part: 'hop' }] : [])], b: [{ part: 'headlow', secs: 3 }], say: 'mid', fx: [...HORSES, 'alpaca'].includes(A.kind) && [...HORSES, 'alpaca'].includes(B.kind) ? 'hearts' : null },
      { a: [{ part: 'look' }], b: [{ part: 'look' }], say: 'end' },
    ],
  },
  {
    id: 'duel', play: false, weight: 2, pairs: [['bull', 'cow'], ['alpaca', 'alpaca'], ['stag', 'deer']],
    beats: (A, B, { rand, winner }) => {
      const [W, L] = winner === 'b' ? ['b', 'a'] : ['a', 'b'], who = { a: A, b: B };
      return [
        { a: [{ part: 'walk', meet: B, gap: 14 }, { face: B }], b: [{ face: A }], say: 'start' },
        ...each(rounds(rand, 2, 4), () => ({ a: [{ part: 'headbutt' }], b: [{ part: 'headbutt' }], fx: 'dust' })),
        { [L]: [{ part: 'flinchLeft' }, { part: 'walk', flee: who[W], far: 40 }], [W]: [{ part: 'look' }], say: 'end' },
      ];
    },
  },
  {
    id: 'squabble', play: false, pairs: [['donkey', 'horse'], ['donkey', 'whitehorse']],
    trigger: (A, B) => dist(A, B) <= 24,
    beats: (A, B) => [
      { a: [{ face: B }], b: [{ face: A }], say: 'start' },
      { a: [{ part: 'kick' }], b: [{ part: 'flinchRight' }, { part: 'run', flee: A, far: 40 }], say: 'mid', fx: 'dust' },
      { a: [{ part: 'look' }], b: [{ face: A }, { part: 'look' }], say: 'end' },
    ],
  },
  {
    id: 'chaseoff', play: false, pairs: [['husky', 'fox'], ['shiba', 'fox']],
    trigger: (A, B) => FARMSTEAD.some(box => near(box, B.x, B.y, 80)),
    beats: (A, B, { spot }) => [
      { a: [{ face: B }], b: [{ face: A }], say: 'start' },
      { a: [{ part: 'run', chase: B, within: 20, secs: 6 }], b: [{ part: 'run', to: spot('edge', [B.x, B.y], 0) ?? 'far' }], say: 'mid' },
      { a: [{ part: 'look' }], b: [{ part: 'look' }], say: 'end' },
      { a: [{ part: 'walk', to: 'home' }], b: [] },
    ],
  },
];
const L = (by, beat, text) => ({ by, beat, text });
/** What they say, by romp: a and b take turns; {sound} is the speaker's own sound, {other} the other's kind. */
export const ROMP_SCRIPTS = {
  tag: [
    [L('a', 'start', "Bet you can't catch me!"), L('b', 'start', 'Watch me!'), L('a', 'mid', 'Too slow!'), L('b', 'mid', "Tag, you're it!"), L('a', 'end', 'No fair, I slipped!')],
    [L('b', 'start', '{sound}! Tag?'), L('a', 'start', "You're on!"), L('b', 'mid', 'Gotcha!'), L('a', 'mid', 'Missed me!'), L('b', 'end', 'Okay. Truce.'), L('a', 'end', 'Until tomorrow.')],
    [L('a', 'start', 'Last one to the tree is it!'), L('b', 'start', "That's me. Wait—"), L('a', 'mid', "Tag, you're it!"), L('b', 'end', '{sound}… I need a lie-down.')],
  ],
  wrestle: [
    [L('a', 'start', '{sound}! Wrestle?'), L('b', 'start', 'Bring it.'), L('a', 'mid', 'Pounce!'), L('b', 'mid', 'Ha! Missed!'), L('a', 'end', 'Okay, you win this one.')],
    [L('b', 'start', 'I am the strongest dog.'), L('a', 'start', 'Prove it.'), L('b', 'mid', 'Grr! (friendly)'), L('a', 'end', 'Rematch later.')],
    [L('a', 'start', 'Paws up!'), L('b', 'start', 'Paws up!'), L('a', 'mid', 'Gotcha!'), L('b', 'mid', 'Gotcha back!'), L('a', 'end', 'Snack break?'), L('b', 'end', 'Snack break.')],
  ],
  race: [
    [L('a', 'start', 'Race you to the fence!'), L('b', 'start', '{sound}! Go!'), L('a', 'mid', 'Ha, eat my dust!'), L('b', 'end', 'First!')],
    [L('b', 'start', 'Fancy a gallop?'), L('a', 'start', 'Always.'), L('b', 'mid', 'Wheee!'), L('a', 'end', 'Photo finish.'), L('b', 'end', 'I won. Obviously.')],
    [L('a', 'start', 'On three. One, two…'), L('b', 'start', 'Three!'), L('a', 'mid', '{sound}! Cheater!'), L('b', 'end', 'First!'), L('a', 'end', 'Again tomorrow.')],
  ],
  greet: [
    [L('a', 'start', '{sound}! Hello!'), L('b', 'start', 'Oh, hi! You smell nice.'), L('a', 'end', 'You too. See you.'), L('b', 'end', 'Bye!')],
    [L('b', 'start', 'Is that you, {other}?'), L('a', 'start', 'It is me!'), L('b', 'mid', '*sniff sniff*'), L('a', 'end', 'Good catch-up.')],
    [L('a', 'start', 'Hey, neighbour.'), L('b', 'start', 'Hey. Nice day.'), L('a', 'mid', '{sound}.'), L('b', 'end', 'Very nice.')],
  ],
  duel: [
    [L('a', 'start', 'This patch is mine.'), L('b', 'start', 'Says who?'), L('a', 'mid', 'Oof!'), L('b', 'mid', 'Had enough?'), L('a', 'end', 'Fine, keep it.'), L('b', 'end', 'Mine!')],
    [L('b', 'start', '{sound}! Move over.'), L('a', 'start', 'You move over.'), L('b', 'mid', 'Hmph!'), L('a', 'mid', 'Hmph yourself!'), L('b', 'end', 'Okay, okay. Yours.'), L('a', 'end', 'Mine!')],
    [L('a', 'start', 'Best grass is here.'), L('b', 'start', 'Not for long.'), L('a', 'mid', '{sound}!'), L('b', 'end', 'Mine now.')],
  ],
  squabble: [
    [L('a', 'start', 'Too close!'), L('b', 'start', 'Sorry, sorry!'), L('a', 'mid', '{sound}! Personal space!'), L('b', 'end', 'Touchy today.')],
    [L('b', 'start', 'Nice tail.'), L('a', 'start', 'Hooves off.'), L('b', 'mid', 'Eek!'), L('a', 'end', 'And stay there.')],
    [L('a', 'start', '{sound}! Back up.'), L('b', 'start', 'Just passing!'), L('a', 'mid', 'Pass faster.'), L('b', 'end', 'Grumpy {other}.')],
  ],
  chaseoff: [
    [L('a', 'start', '{sound}! Not on my farm!'), L('b', 'start', 'Just looking!'), L('a', 'mid', 'And stay out!'), L('b', 'end', 'Fine. Spoilsport.')],
    [L('b', 'start', 'Any chickens about?'), L('a', 'start', 'Not for you!'), L('b', 'mid', 'Eek!'), L('a', 'end', 'And stay out!')],
    [L('a', 'start', 'Who goes there?'), L('b', 'start', 'Nobody. A shadow.'), L('a', 'mid', '{sound}! {sound}!'), L('b', 'end', 'I was leaving anyway.')],
  ],
};
/** Who won a duel by its script: whoever says the last line. */
const winnerOf = lines => lines.at(-1).by;

/** The two in the order a romp has them (its first kind first), or null when it isn't theirs. */
export function cast(romp, A, B) {
  const fits = ([ka, kb], x, y) => (ka === 'fish' ? x.family === 'fish' && y.family === 'fish' : x.kind === ka && y.kind === kb);
  // two of a family: two dogs, the fox and the wolf, two with hooves (never a dog and the fox it chases off)
  if (romp.pairs === 'family') return (A.family === 'hooves' && B.family === 'hooves') || (DOGS.includes(A.kind) && DOGS.includes(B.kind)) || (['fox', 'wolf'].includes(A.kind) && ['fox', 'wolf'].includes(B.kind)) ? [A, B] : null;
  for (const p of romp.pairs) { if (fits(p, A, B)) return [A, B]; if (fits(p, B, A)) return [B, A]; }
  return null;
}
const inRange = (romp, A, B) => dist(A, B) <= (romp.range ?? RANGE);
/** Animal i's nearest partner for a romp (a play only, from the menu), free and near enough; null when there is none. */
export function partnerFor(i, world, { playOnly = false } = {}, clear = () => true) {
  const A = world.find(w => w.i === i);
  if (!A) return null;
  const ok = world.filter(B => B.i !== i && B.free && ROMPS.some(r => (!playOnly || r.play) && !r.trigger && cast(r, A, B) && inRange(r, A, B)) && clear(A, B));
  return ok.sort((p, q) => dist(A, p) - dist(A, q))[0]?.i ?? null;
}

/**
 * The romps under way (one at a time). tick(world, dt, ctx) → { starts }: moves the one running on, a beat at a time;
 * starts a squabble or a chase-off when its two meet (once a minute each), else every 60 to 120 s one by weight.
 * start(id, i, j, world, ctx) starts one now (the Play button). world: the animals ([{ i, kind, family, x, y, free,
 * a (its live record) }]); ctx: perform(i, steps, tag), release(i), settled(i), say(i, text, to), fx(i, kind),
 * spot(area, from, far), clear(A, B), still, animalsOn.
 */
export function createRomps({ rand = Math.random } = {}) {
  let running = null, wait = 60 + rand() * 60, seq = 0, talk = [];
  const lastTrigger = {}, lastScript = {};
  let clock = 0;
  function begin(romp, A, B, ctx) {
    const list = ROMP_SCRIPTS[romp.id];
    let idx = Math.floor(rand() * list.length) % list.length;
    if (idx === lastScript[romp.id] && list.length > 1) idx = (idx + 1) % list.length;
    lastScript[romp.id] = idx;
    const lines = list[idx];
    const beats = romp.beats(A.a ?? A, B.a ?? B, { rand, spot: ctx.spot, winner: winnerOf(lines) });
    running = { n: ++seq, romp, i: A.i, j: B.i, A, B, beats, k: -1, t: 0, lines, queue: [], line: null, lineT: 0, said: null };
    next(ctx);
    return true;
  }
  function next(ctx) {
    const r = running;
    r.k++;
    r.t = 0;
    if (r.k >= r.beats.length) { ctx.release(r.i); ctx.release(r.j); talk.push(r); running = null; return; }
    const beat = r.beats[r.k];
    ctx.perform(r.i, beat.a ?? [], 'romp');
    ctx.perform(r.j, beat.b ?? [], 'romp');
    if (beat.fx) ctx.fx(r.i, beat.fx);
    if (beat.say) { r.queue = r.lines.filter(l => l.beat === beat.say); r.lineT = 0; r.said = beat.say; } // a beat's lines: what was left of the last beat's goes
  }
  const fill = (r, l) => {
    const me = l.by === 'a' ? r.A : r.B, other = l.by === 'a' ? r.B : r.A;
    return l.text.replace(/\{(\w+)\}/g, (_, k) => ({ sound: SOUNDS[me.kind] ?? 'Hm', other: kindWord(other.kind) })[k] ?? '').slice(0, 60);
  };
  function speak(r, dt, ctx) {
    r.lineT -= dt;
    if (r.lineT > 0) return;
    r.line = r.queue.shift() ?? null;
    r.lineT = r.line ? LINE_S : 0;
    if (r.line) ctx.say?.(r.line.by === 'a' ? r.i : r.j, fill(r, r.line), r.line.by === 'a' ? r.j : r.i);
  }
  function abort(ctx) { if (!running) return; ctx.release(running.i); ctx.release(running.j); running = null; }
  return {
    tick(world, dt, ctx) {
      clock += dt;
      for (const r of talk) speak(r, dt, ctx);
      talk = talk.filter(r => r.line || r.queue.length);
      if (ctx.still || !ctx.animalsOn) { abort(ctx); return { starts: [] }; }
      if (running) {
        const r = running;
        if (!world.some(w => w.i === r.i) || !world.some(w => w.i === r.j)) { abort(ctx); return { starts: [] }; } // one went
        speak(r, dt, ctx);
        r.t += dt;
        const say = r.beats[r.k]?.say, lines = (say === 'start' || say === 'end') && r.said === say ? r.queue.length + (r.line ? 1 : 0) : 0; // the dare and the result are said first; the middle's while they go
        if ((ctx.settled(r.i) && ctx.settled(r.j) && !lines) || r.t > BEAT_MAX_S) next(ctx);
        return { starts: [] };
      }
      const free = world.filter(w => w.free);
      // a squabble or a chase-off when two meet
      for (const romp of ROMPS.filter(x => x.trigger && clock - (lastTrigger[x.id] ?? -Infinity) >= 60)) {
        for (const A of free) for (const B of free) {
          if (A.i >= B.i) continue;
          const two = cast(romp, A, B);
          if (two && inRange(romp, ...two) && romp.trigger(...two) && ctx.clear(...two)) { lastTrigger[romp.id] = clock; begin(romp, ...two, ctx); return { starts: [{ romp: romp.id, a: two[0].i, b: two[1].i }] }; }
        }
      }
      wait -= dt;
      if (wait > 0) return { starts: [] };
      const options = [];
      for (const romp of ROMPS.filter(x => !x.trigger)) for (const A of free) for (const B of free) {
        if (A.i >= B.i) continue;
        const two = cast(romp, A, B);
        if (two && inRange(romp, ...two) && ctx.clear(...two)) options.push({ romp, two });
      }
      if (!options.length) { wait = 15; return { starts: [] }; } // no one near enough: look again soon
      wait = 60 + rand() * 60;
      const total = options.reduce((t, o) => t + o.romp.weight, 0);
      let roll = rand() * total, pick = options[0];
      for (const o of options) { roll -= o.romp.weight; if (roll < 0) { pick = o; break; } }
      begin(pick.romp, ...pick.two, ctx);
      return { starts: [{ romp: pick.romp.id, a: pick.two[0].i, b: pick.two[1].i }] };
    },
    /** A romp now, between i and j (Play on a menu: a play, never a fight); false when they can't. */
    start(id, i, j, world, ctx) {
      if (running) return false;
      const A = world.find(w => w.i === i), B = world.find(w => w.i === j), romp = ROMPS.find(r => r.id === id);
      const two = romp && A && B && cast(romp, A, B);
      return two ? begin(romp, ...two, ctx) : false;
    },
    /** A play romp for i and j, by weight (for the Play button), or null. */
    playFor(i, j, world) {
      const A = world.find(w => w.i === i), B = world.find(w => w.i === j);
      const fit = A && B ? ROMPS.filter(r => r.play && cast(r, A, B) && inRange(r, A, B)) : [];
      if (!fit.length) return null;
      let roll = rand() * fit.reduce((t, r) => t + r.weight, 0);
      return (fit.find(r => (roll -= r.weight) < 0) ?? fit[0]).id;
    },
    /** The next tick looks for a romp (for the check). */
    soon() { wait = 0; },
    running: () => (running ? [running] : []),
    busy: () => new Set(running ? [running.i, running.j] : []),
    bubbles: () => [running, ...talk].filter(r => r?.line).map(r => ({ key: `romp|${r.n}`, who: r.line.by === 'a' ? r.i : r.j, to: r.line.by === 'a' ? r.j : r.i, text: fill(r, r.line) })),
    releaseAll(ctx) { abort(ctx); talk = []; },
  };
}
