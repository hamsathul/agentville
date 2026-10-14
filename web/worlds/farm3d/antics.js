// What the 3D farm's animals get up to, without three.js (build/animals.js draws it; the tests run it): each walks
// about its area and rests, now and then gets up to something of its own (its habits), and does what you pick from its
// menu (a command). A thing to do is a list of steps, each a part to play (a clip, by what the farm does with it:
// models/index.js names the clip) for a while, once, or while it goes somewhere. Positions are in the 2D farm's pixels.
// Where it may go is the env's (roam.js): only where the straight way is clear for its body (r, half its length).
// The pond's are their own: the frog never walks (it sits on a lily pad, hops pad to pad, dives and comes up again),
// and the fish swim about under the water and now and then leap out. A jump is a step in an arc (lift, in metres).

/** Who lives where, and their pace (2D pixels a second: 8 a metre): walking, and running. */
export const HERDS = [
  { kind: 'cow', n: 2, area: 'pasture', walk: 7, run: 40 },
  { kind: 'bull', n: 1, area: 'pasture', walk: 7, run: 40 },
  { kind: 'alpaca', n: 2, area: 'pasture', walk: 8, run: 40 },
  { kind: 'donkey', n: 1, area: 'pasture', walk: 8, run: 40 },
  { kind: 'horse', n: 1, area: 'pasture', walk: 10, run: 52 },
  { kind: 'whitehorse', n: 1, area: 'pasture', walk: 10, run: 52 },
  { kind: 'husky', n: 1, area: 'yard', walk: 12, run: 44, bandana: '#d64545' },
  { kind: 'shiba', n: 1, area: 'yard', walk: 11, run: 40, bandana: '#3b74d6' },
  { kind: 'deer', n: 1, area: 'edge', walk: 9, run: 48 },
  { kind: 'stag', n: 1, area: 'edge', walk: 9, run: 48 },
  { kind: 'fox', n: 1, area: 'edge', walk: 11, run: 40 },
  { kind: 'wolf', n: 1, area: 'edge', walk: 11, run: 44 },
  { kind: 'frog', n: 1, area: 'pond', walk: 0, run: 0 },
  { kind: 'trout', n: 1, area: 'water', walk: 5, run: 26 },
  { kind: 'koi', n: 1, area: 'water', walk: 5, run: 26 },
  { kind: 'roach', n: 1, area: 'water', walk: 6, run: 28 },
];

/** Everything an animal can do, by its menu's words. "fly" (a fly bothers it) is a habit only. */
export const ACTS = {
  pet: { label: 'Pet' },
  talk: { label: 'Talk' },
  play: { label: 'Play' }, // with the nearest it can play with (romps.js); app.js starts it
  feed: { label: 'Feed' },
  run: { label: 'Run' },
  leap: { label: 'Leap' },
  hop: { label: 'Hop' },
  kick: { label: 'Kick' },
  headbutt: { label: 'Headbutt' },
  pounce: { label: 'Pounce' },
  fetch: { label: 'Throw a stick' },
  sniff: { label: 'Sniff' },
  look: { label: 'Look around' },
  dead: { label: 'Play dead' },
  snap: { label: 'Catch a fly' },
  dive: { label: 'Dive' },
  fly: { label: 'A fly' },
};
const DOGS = ['husky', 'shiba'], GRAZERS = ['cow', 'bull', 'alpaca', 'donkey', 'horse', 'whitehorse', 'deer', 'stag'];

/** Its menu: everything it can be asked to do, in the menu's order. */
export function menuFor(kind, family) {
  if (family === 'frog') return ['talk', 'hop', 'snap', 'dive', 'dead'];
  if (family === 'fish') return ['talk', 'play', 'leap'];
  const own = family === 'hooves' ? ['kick', 'headbutt'] : ['pounce', ...(DOGS.includes(kind) ? ['fetch'] : [])];
  return ['pet', 'talk', 'play', 'feed', 'run', 'leap', 'hop', ...own, 'sniff', 'look', 'dead'];
}
/** Its habits, each with how often it picks it. Never playing dead (only when asked), never fetching (it needs you). */
export function habitsOf(kind, family) {
  if (family === 'frog') return { hop: 3, snap: 2, dive: 1 };
  if (family === 'fish') return { leap: 1 };
  const h = { look: 3, sniff: 2, hop: 1, fly: 1, run: 1 };
  if (GRAZERS.includes(kind)) h.feed = 3;
  if (['horse', 'whitehorse', 'deer', 'stag'].includes(kind)) h.run = 2;
  if (kind === 'donkey') h.kick = 2;
  if (['horse', 'whitehorse', 'cow'].includes(kind)) h.kick = 0.5;
  if (['bull', 'stag'].includes(kind)) h.headbutt = 1;
  if (DOGS.includes(kind)) Object.assign(h, { run: 3, hop: 2, pounce: 1.5 });
  if (kind === 'fox') Object.assign(h, { pounce: 2, sniff: 3 });
  if (kind === 'wolf') Object.assign(h, { look: 2, pounce: 0.5 });
  if (family === 'paws') h.feed = 0.5;
  return h;
}
function pickHabit(a, rand) {
  const h = habitsOf(a.kind, a.family), total = Object.values(h).reduce((n, w) => n + w, 0);
  let r = rand() * total;
  for (const [act, w] of Object.entries(h)) if ((r -= w) < 0) return act;
  return 'look';
}

/**
 * The steps an act is: { part, secs } plays a part that long; { part } once; { part, hold } once, then stays at its
 * end that long; { part, to } while it goes there ('far' in its area, 'home' where it started, 'stick'), at a run for
 * run, leap and the rest at a walk; { part, go } once while it bounds forward; { stick } throws, picks up or drops the stick.
 */
export function stepsFor(act, a, env, { habit = false } = {}) {
  if (a.family === 'frog') return frogSteps(act, env);
  if (a.family === 'fish') return act === 'leap' ? [{ part: 'run', to: 'near', jump: 0.9, secs: 1.1 }] : act === 'talk' ? [{ part: 'idle', secs: 4 }] : [];
  switch (act) {
    case 'pet': return [{ part: env.rand() < 0.5 ? 'flinchLeft' : 'flinchRight' }, { part: 'look' }];
    case 'fly': return [{ part: env.rand() < 0.5 ? 'flinchLeft' : 'flinchRight' }];
    case 'feed': return [{ part: 'headlow', secs: 1 }, { part: 'eat', secs: habit ? 4 + env.rand() * 6 : 5 }, ...(habit ? [] : [{ part: 'look' }])];
    case 'run': return [{ part: 'run', to: 'far' }, { part: 'leap', go: true }, ...(habit ? [] : [{ part: 'run', to: 'home' }]), { part: 'look' }];
    case 'leap': return [{ part: 'leap', go: true }];
    case 'hop': return [{ part: 'hop' }];
    case 'kick': return [{ part: 'kick' }];
    case 'headbutt': return [{ part: 'headbutt' }];
    case 'pounce': return [{ part: 'headlow', secs: 1.2 }, { part: 'pounce' }];
    case 'fetch': return [{ stick: 'throw' }, { part: 'idle', secs: 0.6 }, { part: 'run', to: 'stick' }, { part: 'headlow', secs: 0.5 }, { stick: 'pick' }, { part: 'run', to: 'home' }, { stick: 'drop' }, { part: 'hop' }];
    case 'sniff': return [{ part: 'headlow', secs: 4 }];
    case 'look': return [{ part: 'look' }];
    case 'talk': return [{ part: 'look' }, { part: 'idle', secs: 5 }]; // it stops, looks up and talks (talk.js says what)
    case 'dead': return [{ part: 'dead', hold: 2.5 }, { part: 'idle', secs: 1, fade: 0.9 }, { part: 'look' }];
    default: return [];
  }
}

/**
 * The frog's: a hop to another pad; a snap at a fly; a dive (a hop into the water, a while out of sight, a hop up onto
 * a pad: the wet steps, which a command lets it finish); playing dead on its pad.
 */
function frogSteps(act, env) {
  switch (act) {
    case 'hop': return [{ part: 'hop', to: 'pad', jump: 0.6 }];
    case 'talk': return [{ part: 'idle', secs: 6 }]; // it sits and talks (talk.js says what)
    case 'snap': return [{ part: 'snap' }];
    case 'dive': return [{ part: 'hop', to: 'water', jump: 0.5, wet: true }, { part: 'idle', secs: 3 + env.rand() * 4, under: true, wet: true }, { part: 'hop', to: 'pad', jump: 0.6 }];
    case 'dead': return [{ part: 'dead', hold: 2.5 }, { part: 'idle', secs: 1, fade: 0.9 }];
    default: return [];
  }
}

/** A new animal at (x, y): walk and run its speeds in pixels a second, r its size (half its length) in pixels. */
export function makeAnimal({ kind, family, area, walk = 8, run = 36, r = 0 }, x, y, rand = Math.random) {
  return { kind, family, area, walk, run, r, romp: null, trail: [], lift: 0, under: false, path: [], pace: 1, looked: false, x, y, tx: x, ty: y, face: rand() * 6.28, rest: rand() * 4, phase: rand() * 6.28, clock: 0, queue: [], cur: null, curT: 0, act: null, home: [x, y], stick: null, part: 'idle', once: false, hold: false, fade: 0.3, timeScale: 1, seq: 0 };
}
/**
 * Asks it to do something (an act from its menu): whatever it was doing stops, and a stick it carried is dropped. In
 * the air or under the water it gets back first: it lands, or comes up onto a pad.
 */
export function command(a, act, env) {
  if (act === 'play') return; // with another: romps.js plays it (app.js), not a step of its own
  if (a.cur && (a.cur.jump !== undefined || a.cur.wet)) {
    const back = a.cur.wet ? a.queue.slice(0, a.queue.findIndex(s => !s.wet) + 1) : [];
    a.queue = [...back, ...stepsFor(act, a, env)];
    a.act = act;
    return;
  }
  a.queue = stepsFor(act, a, env);
  a.cur = null;
  a.act = act;
  a.home = [a.x, a.y];
  a.trail = [];
  a.path = []; // the walk it was on was planned from somewhere else
  a.stick = null;
}

/**
 * Plays these steps now, for something it does with another (a farmer's play, a romp: `tag`): whatever it was doing
 * stops; when they are done it waits where it is, its act still `tag`, till release() lets it go.
 */
export function perform(a, steps, env, tag) {
  const going = a.romp === tag ? { home: a.home, trail: a.trail } : null; // its next beat: home is where it began
  command(a, 'look', env);
  if (going) Object.assign(a, going);
  a.queue = steps.map(s => ({ ...s }));
  a.cur = null;
  a.act = tag;
  a.romp = tag;
}
/** Lets it go after a play or a romp: it rests a moment where it is, then goes about as before. */
export function release(a) {
  Object.assign(a, { romp: null, act: null, queue: [], cur: null, tx: a.x, ty: a.y, path: [], trail: [], stick: null, hurry: false });
  a.rest = 1 + Math.random() * 2;
}

/** Puts it somewhere new (its ground moved): whatever it was doing and the walk it was on are forgotten. */
export function placeAt(a, x, y) {
  Object.assign(a, { x, y, tx: x, ty: y, path: [], looked: false, queue: [], cur: null, act: null, stick: null, home: [x, y], trail: [], lift: 0, under: false, hurry: false });
}
/** Its ground changed under it, though it is still on it: the walk it was on was checked against the old one, so it stops there. */
export function forgetWalk(a) {
  a.path = [];
  a.tx = a.x;
  a.ty = a.y;
  if (a.cur?.to && a.cur.jump === undefined) Object.assign(a, { cur: null, queue: [], act: null, trail: [], stick: null }); // a run there stops too
}

/** How long it rests where it stops: 1 to 30 s, mostly short. */
export const restFor = rand => 1 + 29 * rand() ** 2.2;
/** Its next walk: 1 to 3 points, each reached by a clear straight way from the last, so the walk bends; its own pace. */
function planWalk(a, env) {
  a.pace = 0.7 + env.rand() * 0.6;
  if (env.route && roams(a)) { roamWalk(a, env); return; }
  const points = [];
  let from = [a.x, a.y];
  for (let k = 1 + Math.floor(env.rand() * 3); k > 0; k--) { const p = env.spot(a.area, from, 0, a.r); points.push(p); from = p; }
  [a.tx, a.ty] = points.shift();
  a.path = points;
}

/** Whether it roams the farm (all but the pond's frog and fish). */
const roams = a => a.family !== 'frog' && a.family !== 'fish';
/**
 * How wide it is for getting about the farm: about its width (it walks lengthways), not its length; where it stops
 * and turns, a.r keeps its body clear.
 */
export const reachOf = a => Math.max(5, a.r * 0.6);
/** The ground it gets about on: the whole farm for one that roams, its own for the frog and the fish. */
const groundFor = a => (roams(a) ? 'farm' : a.area);
/**
 * A walk about the farm: mostly a wander near where it is, now and then somewhere else on the farm, and, the longer it
 * has been away from its own ground, the likelier back there. The way there goes round whatever is in it (env.route).
 */
function roamWalk(a, env) {
  const atHome = env.inside(a.area, a.x, a.y, 0);
  if (atHome) a.awaySince = null;
  else a.awaySince ??= a.clock;
  const away = atHome ? 0 : a.clock - a.awaySince, rw = reachOf(a);
  for (let k = 0; k < 4; k++) {
    const roll = env.rand(), goHome = !atHome && roll < Math.min(0.9, 0.2 + away / 120);
    const to = goHome ? env.spot(a.area, null, 0, a.r)
      : roll < 0.15 ? env.spot('farm', null, 0, a.r) // somewhere else on the farm
        : roll < 0.27 ? env.spot('fields', null, 0, a.r) // among the fields: down a walkway, along a headland
          : env.spot('farm', [a.x, a.y], 24, a.r, { near: 110, straight: false }); // a wander near where it is
    const way = to && env.route([a.x, a.y], to, rw);
    if (!way?.length) continue;
    [a.tx, a.ty] = way.shift();
    a.path = way;
    return;
  }
  a.tx = a.x; a.ty = a.y; a.path = []; // nowhere it can get to just now: it stays
}

function show(a, part, { once = false, hold = false, fade = 0.3, timeScale = 1, restart = false } = {}) {
  if (restart || a.part !== part || a.timeScale !== timeScale || a.once !== once) a.seq++;
  Object.assign(a, { part, once, hold, fade, timeScale });
}
/** Goes toward (x, y) at speed; true once there. */
function go(a, [x, y], speed, dt) {
  const dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const step = Math.min(d, speed * dt);
  a.x += (dx / d) * step;
  a.y += (dy / d) * step;
  a.face = Math.atan2(dx, dy);
  return d - step < 1;
}
/**
 * The way home: back along the places it set off from (its trail), straight to the furthest back it can reach in a
 * straight line, so a run and a leap come back the way they went and never through what they went round.
 */
function homeward(a, env) {
  if (!env.clear || !a.trail.length) { a.trail = []; return a.home; }
  const k = a.trail.findIndex(p => env.clear(groundFor(a), [a.x, a.y], p, roams(a) ? reachOf(a) : a.r)), to = a.trail[k < 0 ? a.trail.length - 1 : k];
  a.trail = a.trail.slice(0, k < 0 ? a.trail.length - 1 : k);
  return to;
}
/** A place `far` from `other`, the way most directly away that is clear for its body (else where it is). */
function awayFrom(a, other, far, env) {
  const base = Math.atan2(a.x - other.x, a.y - other.y), ground = groundFor(a), r = roams(a) ? reachOf(a) : a.r;
  const d0 = Math.hypot(a.x - other.x, a.y - other.y), go = Math.max(8, far - d0 + 4);
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
    const ang = base + turn, to = [a.x + Math.sin(ang) * go, a.y + Math.cos(ang) * go];
    if (env.inside(ground, to[0], to[1], r) && (!env.clear || env.clear(ground, [a.x, a.y], to, r))) return to;
  }
  return [a.x, a.y];
}
/**
 * A machine coming its way (m: { x, y, heading }, as machines.js inPathOf found it): it walks to the nearest free place
 * clear of the machine's way ahead (a headland, or back out of a walkway too narrow to pass in), giving up the walk it
 * was on. Only one getting about by itself (not doing what it was asked, at play or with another, nor the frog or a
 * fish); true if it set off.
 */
export function stepAside(a, m, env) {
  if (a.act || a.romp || a.cur || a.queue.length || !roams(a)) return false;
  const c = Math.cos(m.heading), s = Math.sin(m.heading), way = [];
  for (let d = -8; d <= 72; d += 8) way.push([m.x + c * d, m.y + s * d, 14]); // its way ahead, a tractor's width round it
  const r = reachOf(a), to = env.spot('farm', [a.x, a.y], 0, r, { near: 64, straight: false, avoid: way, strict: true }), there = to && env.route([a.x, a.y], to, r);
  if (!there?.length) return false;
  [a.tx, a.ty] = there.shift();
  Object.assign(a, { path: there, rest: 0, looked: false, hurry: true });
  return true;
}
/** Its place turned busy (a machine working the field it stands by): it walks to a free place near (roam.js free),
 *  round what is in the way. Only one getting about by itself, as stepAside; true if it set off. */
export function moveOff(a, env) {
  if (a.act || a.romp || a.cur || a.queue.length || !roams(a)) return false;
  const to = env.spot('farm', [a.x, a.y], 30, a.r, { near: 120, straight: false }), way = to && env.route([a.x, a.y], to, reachOf(a));
  if (!way?.length) return false;
  [a.tx, a.ty] = way.shift();
  Object.assign(a, { path: way, rest: 0, looked: false });
  return true;
}
/** Starts the next step: where it goes is settled now; a stick step happens at once. */
function begin(a, env) {
  while (a.queue.length) {
    const s = { ...a.queue.shift() };
    if (s.stick === 'throw') { a.stick = { at: env.spot(groundFor(a), [a.x, a.y], 60, reachOf(a)), from: [a.x, a.y], held: false, t: 0 }; continue; }
    if (s.stick === 'pick') { if (a.stick) a.stick.held = true; continue; }
    if (s.stick === 'drop') { a.stick = null; continue; }
    if (s.face) { const [fx, fy] = Array.isArray(s.face) ? s.face : [s.face.x, s.face.y]; if (Math.hypot(fx - a.x, fy - a.y) > 0.5) a.face = Math.atan2(fx - a.x, fy - a.y); continue; } // turns to it at once
    if (s.flee) s.to = awayFrom(a, s.flee, s.far ?? 60, env); // away from the other, the clearest way
    if (s.meet) { const dx = a.x - s.meet.x, dy = a.y - s.meet.y, d = Math.hypot(dx, dy) || 1, gap = s.gap ?? 16; s.to = [s.meet.x + (dx / d) * gap, s.meet.y + (dy / d) * gap]; } // a gap short of the other
    if (s.to === 'home') {
      s.to = homeward(a, env);
      if (a.trail.length) a.queue.unshift({ part: s.part, to: 'home' }); // then further back still
    } else if (s.to || s.go) a.trail.push([a.x, a.y]);
    if (s.to === 'far') s.to = env.spot(groundFor(a), [a.x, a.y], 80, roams(a) ? reachOf(a) : a.r);
    else if (s.to === 'stick') s.to = a.stick?.at ?? [a.x, a.y];
    else if (s.to === 'pad') s.to = env.spot('pond', [a.x, a.y], 8, a.r);
    else if (s.to === 'water') s.to = env.spot('water', [a.x, a.y], 8, a.r);
    else if (s.to === 'near') s.to = env.spot(a.area, [a.x, a.y], 16, a.r);
    s.len = s.secs ?? (s.chase ? 6 : s.to && s.jump === undefined ? 20 : env.duration(a.kind, s.part) + (s.hold ?? 0));
    if (s.jump !== undefined) { // in an arc, from here to there, in its time: facing there
      s.from = [a.x, a.y];
      if (Math.hypot(s.to[0] - a.x, s.to[1] - a.y) > 0.01) a.face = Math.atan2(s.to[0] - a.x, s.to[1] - a.y);
    }
    a.cur = s;
    a.curT = 0;
    a.lift = 0;
    a.under = Boolean(s.under);
    show(a, s.part, { once: s.jump !== undefined ? !s.secs : !s.secs && !s.to && !s.chase, hold: s.hold !== undefined, fade: s.fade ?? 0.25, restart: true });
    return;
  }
}

/**
 * One animal's next moment, dt seconds on. env: resting (night: it stands and rests, and starts nothing by itself),
 * rand, duration(kind, part) in seconds, spot(area, from, far) a free place in its area (at least far from from),
 * inside(area, x, y), habitChance (how often it gets up to something when it stops). It sets a.part (what to play),
 * a.once, a.hold, a.fade, a.timeScale and a.seq (which goes up each time a part starts afresh).
 */
export function advance(a, dt, env) {
  a.clock += dt;
  if (a.stick && !a.stick.held) a.stick.t += dt;
  if (!a.cur && a.queue.length) begin(a, env);
  if (a.romp && !a.cur && !a.queue.length) { show(a, 'idle'); return; } // with another, between its steps: it waits
  if (a.cur) {
    const s = a.cur;
    a.curT += dt;
    let done = a.curT >= s.len;
    if (s.jump !== undefined) {
      const p = Math.min(1, a.curT / s.len);
      a.x = s.from[0] + (s.to[0] - s.from[0]) * p;
      a.y = s.from[1] + (s.to[1] - s.from[1]) * p;
      a.lift = done ? 0 : s.jump * Math.sin(Math.PI * p);
    } else if (s.chase) { // after the other, where it is now, till within reach (or its time is up); never off its ground
      const tx = s.chase.x, ty = s.chase.y, d = Math.hypot(tx - a.x, ty - a.y);
      if (d <= (s.within ?? 8)) done = true;
      else {
        const step = Math.min(d, a.run * dt), nx = a.x + ((tx - a.x) / d) * step, ny = a.y + ((ty - a.y) / d) * step;
        if (env.inside(groundFor(a), nx, ny, roams(a) ? reachOf(a) : a.r)) { a.x = nx; a.y = ny; a.face = Math.atan2(tx - a.x, ty - a.y); } else done = true;
      }
    } else if (s.to) done = go(a, s.to, s.part === 'walk' ? a.walk : a.run, dt) || done;
    else if (s.go) { // a leap carries it forward, inside its area
      const nx = a.x + Math.sin(a.face) * a.run * 0.8 * dt, ny = a.y + Math.cos(a.face) * a.run * 0.8 * dt;
      if (env.inside(groundFor(a), nx, ny, roams(a) ? reachOf(a) : a.r)) { a.x = nx; a.y = ny; }
    }
    if (!done) return;
    a.cur = null;
    a.under = false;
    if (a.queue.length) { begin(a, env); return; }
    if (a.romp) { a.act = a.romp; show(a, 'idle'); return; } // with another: it waits for what comes next
    a.act = null;
    a.tx = a.x; a.ty = a.y;
    a.rest = 2 + env.rand() * 4;
  }
  if (env.resting) { show(a, 'idle', { timeScale: 0.35 }); return; }
  if (a.rest > 0) { // resting where it stopped: a grazer grazes now and then
    a.rest -= dt;
    show(a, GRAZERS.includes(a.kind) && Math.sin(a.clock * 0.35 + a.phase) > 0.2 ? 'eat' : 'idle');
    return;
  }
  if (a.family === 'frog') { a.rest = 3 + env.rand() * 6; habit(a, env); return; } // it never walks: it sits, then gets up to something
  if (go(a, [a.tx, a.ty], a.hurry ? a.run * 0.6 : a.walk * a.pace, dt)) { // out of a machine's way: a trot
    if (a.path.length) { // a bend: now and then a look round first, then on to the next point
      if (!a.looked && !a.hurry && env.rand() < 0.25) { a.looked = true; a.queue = [{ part: 'look' }]; begin(a, env); return; }
      a.looked = false;
      [a.tx, a.ty] = a.path.shift();
      show(a, a.hurry ? 'run' : 'walk');
      return;
    }
    a.hurry = false;
    planWalk(a, env);
    a.rest = env.rand() < 0.2 ? 0 : restFor(env.rand); // now and then it strolls straight on
    if (a.rest > 0 && env.rand() < env.habitChance) { habit(a, env); return; }
    show(a, a.rest > 0 ? 'idle' : 'walk');
    return;
  }
  show(a, a.hurry ? 'run' : 'walk');
}
/** Gets up to something of its own. */
function habit(a, env) {
  const act = pickHabit(a, env.rand);
  a.queue = stepsFor(act, a, env, { habit: true });
  a.act = act;
  a.home = [a.x, a.y];
  a.trail = [];
  a.path = [];
  begin(a, env);
}
