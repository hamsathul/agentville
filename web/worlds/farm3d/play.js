// Farmers playing with the animals, by the engine's rules (web/worlds/sdk/animals.js and engine.js: play, chooseDoer)
// with the 3D farm's animals: now and then a farmer idle three minutes or more walks over to a dog to throw it a
// stick, to a pasture animal to pet it, or to one resting to nap beside it; and when you pick Pet, Feed or Throw a stick
// from an animal's menu, the nearest free farmer walks over and does it. Each is a little conversation: the two take
// turns, a line at each beat (setting off, there, done). Pure: app.js hands it the farm (ctx) to act on.

/** The plays an idle farmer starts by itself: the kinds it plays with, what the animal then does. */
export const PLAYS = [
  { id: 'fetch', kinds: ['husky', 'shiba'], act: 'fetch' },
  { id: 'pet', kinds: ['cow', 'alpaca', 'donkey', 'horse', 'whitehorse'], act: 'pet' },
  { id: 'nap', kinds: ['cow', 'alpaca', 'donkey', 'horse', 'whitehorse'], resting: true },
];
/** The menu's acts that send a farmer (the rest the animal does itself), and what pops over it there. */
export const SENDS = { pet: '♥', feed: '🌾', fetch: null };
/** How each kind sounds, for lines that start with it. */
export const SOUNDS = { cow: 'Moo', bull: 'Moo', alpaca: 'Hmm', donkey: 'Hee-haw', horse: 'Neigh', whitehorse: 'Neigh', husky: 'Woof', shiba: 'Woof', deer: 'Oh', stag: 'Hrm', fox: 'Yip', wolf: 'Awoo', frog: 'Ribbit', trout: 'Blub', koi: 'Blub', roach: 'Blub' };
/** A kind as said in a line. */
export const kindWord = kind => ({ whitehorse: 'horse', shiba: 'Shiba', koi: 'koi' })[kind] ?? kind;
const IDLE_FOR = 180e3; // a farmer plays once it has been idle this long (ms)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A play to start now, or null: plays in a random order; for each, a free animal of its kinds (a resting one to nap
 * by) and the nearest farmer to it idle three minutes or more, not napping, not on an errand, not busy elsewhere.
 * farmers: [{ id, x, y, state, nap, errand }], animals: [{ i, kind, x, y, free, resting }], idleSince: id → ms, busy: ids and indices.
 */
export function castPlay(plays, { farmers, animals, idleSince, now, busy, rand }) {
  const order = plays.map(p => ({ p, k: rand() })).sort((a, b) => a.k - b.k).map(x => x.p);
  const ready = farmers.filter(f => f.state === 'idle' && !f.nap && !f.errand && !busy.has(f.id) && idleSince.has(f.id) && now - idleSince.get(f.id) >= IDLE_FOR);
  for (const play of order) {
    for (const a of animals.filter(x => play.kinds.includes(x.kind) && x.free && !busy.has(x.i) && (!play.resting || x.resting !== false))) {
      const f = ready.slice().sort((p, q) => dist(p, a) - dist(q, a))[0];
      if (f) return { play, farmer: f.id, animal: a.i };
    }
  }
  return null;
}
/**
 * Who goes when you pick Pet, Feed or Throw a stick: farmers not waiting on you (or stale), not on an errand; the
 * nearest idle one first; a busy one only if there and back (walkSecs of the way, with a moment there) fits 5 s.
 * → { doer: an id or null (you do it), others: the rest who could, nearest first }.
 */
export function chooseDoer(farmers, [x, y], walkSecs = d => d / 40) {
  const at = { x, y };
  const can = farmers.filter(f => !['waiting', 'turn', 'stale'].includes(f.state) && !f.errand && (f.state !== 'working' || walkSecs(2 * dist(f, at)) + 1.5 <= 5));
  const near = can.slice().sort((p, q) => dist(p, at) - dist(q, at));
  const doer = near.find(f => f.state !== 'working') ?? near[0] ?? null;
  return { doer: doer?.id ?? null, others: near.filter(f => f !== doer).map(f => f.id) };
}

const F = (beat, text) => ({ by: 'farmer', beat, text }), A = (beat, text) => ({ by: 'animal', beat, text });
/** The conversations while they play, by what they do: {farmer} its name, {animal} the kind, {sound} the kind's own sound. */
export const PLAY_SCRIPTS = {
  fetch: [
    [F('start', 'Ready? Fetch!'), A('start', '{sound}! Throw it!'), F('mid', 'Go on, get it!'), A('mid', 'Again! Again!'), F('end', 'Last one, I promise.'), A('end', 'You said that last time.')],
    [A('start', '{sound}! Is that a stick?'), F('start', 'It might be. Want it?'), A('mid', 'Got it! Got it!'), F('end', 'Good dog, {animal}.'), A('end', 'Best day ever.')],
    [F('start', 'Watch the stick, {animal}…'), A('start', 'Watching. Watching!'), F('mid', 'And… there it goes!'), A('end', 'Mine! All mine!')],
  ],
  pet: [
    [F('start', "Who's a good {animal}?"), A('start', '{sound}. Me, probably.'), F('mid', 'Right behind the ears?'), A('end', 'Yes. There. Perfect.')],
    [A('start', '{sound}? Oh, hello.'), F('start', 'Hey, {animal}. Pet break.'), A('mid', 'More, please.'), F('end', 'Back to work soon.'), A('end', 'Come back anytime.')],
    [F('start', 'Taking five with you, {animal}.'), A('start', 'Good choice. I am soft.'), F('mid', 'You really are.'), A('mid', '{sound}. Keep going.'), F('end', 'That is enough for now.'), A('end', 'It is never enough.')],
  ],
  nap: [
    [F('start', 'Room for one more?'), A('start', 'Shh. I am grazing in my head.'), F('mid', 'Zzz…'), A('end', '{sound}. Nap over?')],
    [A('start', '{sound}… you look tired.'), F('start', 'Long day. Five minutes.'), A('mid', 'I will keep watch.'), F('end', 'Thanks, {animal}. Back to it.')],
    [F('start', 'Mind if I lean on you?'), A('start', 'Lean away. I am sturdy.'), F('mid', 'So comfy…'), A('mid', 'Snoring. Charming.'), F('end', 'Did I miss anything?'), A('end', 'Just me. Chewing.')],
  ],
  feed: [
    [F('start', 'Snack time, {animal}!'), A('start', '{sound}! Yes please!'), F('mid', 'Slowly, slowly.'), A('end', 'More? No? Fine.')],
    [A('start', 'Is that for me?'), F('start', 'All yours, {animal}.'), A('mid', 'Crunch crunch crunch.'), F('end', 'Good, right?'), A('end', 'Best meal today.')],
    [F('start', 'I brought you something.'), A('start', '{sound}. You are my favourite.'), F('mid', 'You say that to everyone.'), A('end', 'Only the ones with food.')],
  ],
};
/** One of a play's scripts, never the one it had last: { lines, idx }. */
export function scriptFor(id, rand, lastIdx = -1) {
  const list = PLAY_SCRIPTS[id] ?? PLAY_SCRIPTS.pet;
  let idx = Math.floor(rand() * list.length) % list.length;
  if (idx === lastIdx && list.length > 1) idx = (idx + 1) % list.length;
  return { lines: list[idx], idx };
}
/** A script's line with its blanks filled. */
export const fillLine = (text, { farmer, kind }) => text.replace(/\{(\w+)\}/g, (_, k) => ({ farmer: String(farmer ?? '').slice(0, 16), animal: kindWord(kind), sound: SOUNDS[kind] ?? 'Hm' })[k] ?? '').slice(0, 60);

const LINE_S = 3; // how long a line shows
const THERE_S = { fetch: 15, pet: 2.5, feed: 4.5, nap: 8 }; // how long the farmer stays there at most (fetch: till the stick is back)

/**
 * The plays under way. tick(dt, ctx) moves them on and, every 45 s, may start one; send(i, act, farmer, ctx) is the
 * menu's (that farmer walks over and does it); busy() the farmers and animals in a play; bubbles() what is said now
 * ({ key, who: a farmer's id or an animal's index, to, text }); endAll(ctx) stops them all.
 * ctx: now (ms), still, animalsOn, farmers ([{ id, name, x, y, state, nap, errand }]), animals (the animals' world),
 * idleSince, busy (others': talk, romps), animal(i) → { x, y, act } | null, errand(id, to, { face, pose }),
 * endErrand(id), onErrand(id), arrived(id), setPose(id, pose), perform(i, steps, tag), release(i), command(i, act),
 * face(i, [x, y]), pop(i, text).
 */
export function createPlays({ rand = Math.random } = {}) {
  let running = [], wait = 45, seq = 0;
  const last = {};
  // a beat's lines, now: what was left unsaid of the one before is dropped, so what they say keeps up with what they do
  const say = (p, beat) => { p.queue = p.lines.filter(l => l.beat === beat); p.lineT = 0; };
  function start(kind, farmerId, i, ctx) {
    const a = ctx.animal(i), f = ctx.farmers.find(x => x.id === farmerId);
    if (!a || !f) return false;
    const d = Math.hypot(f.x - a.x, f.y - a.y) || 1, gap = 10, spot = [a.x + ((f.x - a.x) / d) * gap, a.y + ((f.y - a.y) / d) * gap];
    const { lines, idx } = scriptFor(kind, rand, last[kind]);
    last[kind] = idx;
    const p = { n: ++seq, kind, farmer: farmerId, name: f.name, i, animalKind: ctx.animals.find(x => x.i === i)?.kind ?? a.kind, stage: 'going', t: 0, there: 0, lines, queue: [], line: null, lineT: 0 };
    ctx.errand(farmerId, spot, { face: [a.x, a.y] });
    ctx.face(i, [f.x, f.y]);
    ctx.perform(i, [{ part: 'idle', secs: 30 }], 'play'); // it waits for the farmer
    say(p, 'start');
    running.push(p);
    return true;
  }
  function stop(p, ctx, { told }) {
    if (told) say(p, 'end'); else p.queue = [];
    if (ctx.onErrand(p.farmer)) ctx.endErrand(p.farmer);
    if (ctx.animal(p.i)?.act === 'play') ctx.release(p.i);
    p.stage = 'done';
  }
  function arrive(p, ctx) {
    if (p.kind === 'nap') { ctx.setPose(p.farmer, 'nap'); ctx.perform(p.i, [{ part: 'idle', secs: THERE_S.nap, timeScale: 0.35 }], 'play'); return; }
    ctx.release(p.i);
    ctx.command(p.i, p.kind === 'fetch' ? 'fetch' : p.kind);
    if (SENDS[p.kind]) ctx.pop(p.i, SENDS[p.kind]);
  }
  const busySet = () => new Set(running.filter(p => p.stage !== 'done').flatMap(p => [p.farmer, p.i]));
  return {
    tick(dt, ctx) {
      for (const p of running) {
        p.lineT -= dt;
        if (p.lineT <= 0) { p.line = p.queue.shift() ?? null; p.lineT = p.line ? LINE_S : 0; }
        if (p.stage === 'done') continue;
        p.t += dt;
        const a = ctx.animal(p.i);
        if (!a || (p.stage === 'going' && !ctx.onErrand(p.farmer))) { stop(p, ctx, { told: false }); continue; } // the animal went, or the farmer was called back
        if (p.stage === 'going' && ctx.arrived(p.farmer)) { p.stage = 'there'; arrive(p, ctx); say(p, 'mid'); continue; }
        if (p.stage === 'there') {
          p.there += dt;
          const talked = p.there >= p.lines.filter(l => l.beat === 'mid').length * LINE_S; // it stays while they talk
          const done = talked && (p.kind === 'fetch' ? (p.there > 1 && !a.act) || p.there > THERE_S.fetch : p.there > THERE_S[p.kind]);
          if (!ctx.onErrand(p.farmer)) stop(p, ctx, { told: false });
          else if (done) stop(p, ctx, { told: true });
        }
      }
      running = running.filter(p => p.stage !== 'done' || p.line || p.queue.length);
      if (ctx.still || !ctx.animalsOn) return null;
      wait -= dt;
      if (wait > 0 || busySet().size >= 4) return null; // two plays at most
      wait = 45;
      const cast = castPlay(PLAYS, { farmers: ctx.farmers, animals: ctx.animals, idleSince: ctx.idleSince, now: ctx.now, busy: new Set([...busySet(), ...ctx.busy]), rand });
      if (cast) start(cast.play.id, cast.farmer, cast.animal, ctx);
      return cast;
    },
    send(i, act, farmerId, ctx) { return start(act, farmerId, i, ctx); },
    /** Starts a play now, whatever the clock says (for the check): the next tick casts one. */
    soon() { wait = 0; },
    busy: busySet,
    bubbles: () => running.filter(p => p.line).map(p => ({ key: `play|${p.n}`, who: p.line.by === 'farmer' ? p.farmer : p.i, to: p.line.by === 'farmer' ? p.i : p.farmer, text: fillLine(p.line.text, { farmer: p.name, kind: p.animalKind }) })),
    endAll(ctx) { for (const p of running) if (p.stage !== 'done') stop(p, ctx, { told: false }); running = []; },
  };
}
