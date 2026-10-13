// What the 3D farm's animals get up to, without three.js (build/animals.js draws it; the tests run it): each walks
// about its area and rests, now and then gets up to something of its own (its habits), and does what you pick from its
// menu (a command). A thing to do is a list of steps, each a part to play (a clip, by what the farm does with it:
// models/index.js names the clip) for a while, once, or while it goes somewhere. Positions are in the 2D farm's pixels.
// Where it may go is the env's (roam.js): only where the straight way is clear for its body (r, half its length).

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
];

/** Everything an animal can do, by its menu's words. "fly" (a fly bothers it) is a habit only. */
export const ACTS = {
  pet: { label: 'Pet' },
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
  fly: { label: 'A fly' },
};
const DOGS = ['husky', 'shiba'], GRAZERS = ['cow', 'bull', 'alpaca', 'donkey', 'horse', 'whitehorse', 'deer', 'stag'];

/** Its menu: everything it can be asked to do, in the menu's order. */
export function menuFor(kind, family) {
  const own = family === 'hooves' ? ['kick', 'headbutt'] : ['pounce', ...(DOGS.includes(kind) ? ['fetch'] : [])];
  return ['pet', 'feed', 'run', 'leap', 'hop', ...own, 'sniff', 'look', 'dead'];
}
/** Its habits, each with how often it picks it. Never playing dead (only when asked), never fetching (it needs you). */
export function habitsOf(kind, family) {
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
    case 'dead': return [{ part: 'dead', hold: 2.5 }, { part: 'idle', secs: 1, fade: 0.9 }, { part: 'look' }];
    default: return [];
  }
}

/** A new animal at (x, y): walk and run its speeds in pixels a second, r its size (half its length) in pixels. */
export function makeAnimal({ kind, family, area, walk = 8, run = 36, r = 0 }, x, y, rand = Math.random) {
  return { kind, family, area, walk, run, r, trail: [], x, y, tx: x, ty: y, face: rand() * 6.28, rest: rand() * 4, phase: rand() * 6.28, clock: 0, queue: [], cur: null, curT: 0, act: null, home: [x, y], stick: null, part: 'idle', once: false, hold: false, fade: 0.3, timeScale: 1, seq: 0 };
}
/** Asks it to do something (an act from its menu): whatever it was doing stops, and a stick it carried is dropped. */
export function command(a, act, env) {
  a.queue = stepsFor(act, a, env);
  a.cur = null;
  a.act = act;
  a.home = [a.x, a.y];
  a.trail = [];
  a.stick = null;
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
  const k = a.trail.findIndex(p => env.clear(a.area, [a.x, a.y], p, a.r)), to = a.trail[k < 0 ? a.trail.length - 1 : k];
  a.trail = a.trail.slice(0, k < 0 ? a.trail.length - 1 : k);
  return to;
}
/** Starts the next step: where it goes is settled now; a stick step happens at once. */
function begin(a, env) {
  while (a.queue.length) {
    const s = { ...a.queue.shift() };
    if (s.stick === 'throw') { a.stick = { at: env.spot(a.area, [a.x, a.y], 60, a.r), from: [a.x, a.y], held: false, t: 0 }; continue; }
    if (s.stick === 'pick') { if (a.stick) a.stick.held = true; continue; }
    if (s.stick === 'drop') { a.stick = null; continue; }
    if (s.to === 'home') {
      s.to = homeward(a, env);
      if (a.trail.length) a.queue.unshift({ part: s.part, to: 'home' }); // then further back still
    } else if (s.to || s.go) a.trail.push([a.x, a.y]);
    if (s.to === 'far') s.to = env.spot(a.area, [a.x, a.y], 80, a.r);
    else if (s.to === 'stick') s.to = a.stick?.at ?? [a.x, a.y];
    s.len = s.secs ?? (s.to ? 20 : env.duration(a.kind, s.part) + (s.hold ?? 0));
    a.cur = s;
    a.curT = 0;
    show(a, s.part, { once: !s.secs && !s.to, hold: s.hold !== undefined, fade: s.fade ?? 0.25, restart: true });
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
  if (a.cur) {
    const s = a.cur;
    a.curT += dt;
    let done = a.curT >= s.len;
    if (s.to) done = go(a, s.to, s.part === 'walk' ? a.walk : a.run, dt) || done;
    else if (s.go) { // a leap carries it forward, inside its area
      const nx = a.x + Math.sin(a.face) * a.run * 0.8 * dt, ny = a.y + Math.cos(a.face) * a.run * 0.8 * dt;
      if (env.inside(a.area, nx, ny, a.r)) { a.x = nx; a.y = ny; }
    }
    if (!done) return;
    a.cur = null;
    if (a.queue.length) { begin(a, env); return; }
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
  if (go(a, [a.tx, a.ty], a.walk, dt)) {
    a.rest = 3 + env.rand() * 8;
    [a.tx, a.ty] = env.spot(a.area, [a.x, a.y], 0, a.r);
    if (env.rand() < env.habitChance) { const act = pickHabit(a, env.rand); a.queue = stepsFor(act, a, env, { habit: true }); a.act = act; a.home = [a.x, a.y]; a.trail = []; begin(a, env); return; }
    show(a, 'idle');
    return;
  }
  show(a, 'walk');
}
