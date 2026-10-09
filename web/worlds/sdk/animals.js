// The animals kit: creatures that live in a world just for fun (docs/worlds.md, "Creatures"). They
// never stand for data. A world gives its cast (animals()), where they may walk (roam()) and what they
// must keep off (avoid()); the kit keeps where each one is and what it does, its lines and its actions;
// the engine draws them, places their bubbles, and sends a farmer when you click one. A plain script
// in a world's frame, after creatures.js.
'use strict';

const LINE_MAX = 40, LINE_S = 4, LINES_AT_ONCE = 2;

/** A small seeded random source (xorshift), so a world's animals, and the tests, repeat. */
function seededRandom(seed = 7) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 1_000_000) / 1_000_000; };
}

const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function makeAnimals(cast, { random = seededRandom(7) } = {}) {
  const lib = typeof CREATURES === 'object' ? CREATURES : {};
  const ones = [];
  for (const def of cast ?? []) {
    if (!lib[def.kind]) throw new Error(`Animals: no creature called ${def.kind}.`);
    for (let i = 0; i < (def.count ?? 1); i++) ones.push({ id: `${def.kind}-${i}`, kind: def.kind, def, look: def.looks?.[i] ?? def.look, x: 0, y: 0, face: 1, pose: 'stand', to: null, wait: random() * 3, act: null, fast: false });
  }
  const byId = id => ones.find(o => o.id === id);
  let roam = [], avoid = [], T = 0, says = [], quiet = 8; // the first idle line after 8 s
  const okAt = (o, x, y) => (o.def.home ? inRect(o.def.home, x, y) : roam.some(r => inRect(r, x, y)) && !avoid.some(r => inRect(r, x, y)));
  /** The whole way from where it is to (x, y) is somewhere it may be: walking never cuts across what it must keep off. */
  const okPath = (o, x, y) => { const n = Math.max(1, Math.ceil(Math.hypot(x - o.x, y - o.y) / 2)); for (let i = 1; i <= n; i++) if (!okAt(o, o.x + ((x - o.x) * i) / n, o.y + ((y - o.y) * i) / n)) return false; return true; };
  function somewhere(o, near = null) {
    const areas = o.def.home ? [o.def.home] : roam;
    for (let k = 0; k < 60 && areas.length; k++) {
      const r = areas[Math.floor(random() * areas.length)];
      const x = near ? near[0] + (random() - 0.5) * 24 : r.x + random() * r.w, y = near ? near[1] + (random() - 0.5) * 12 : r.y + random() * r.h;
      if (okAt(o, x, y)) return [Math.round(x), Math.round(y)];
    }
    return null;
  }
  function say(o, key) {
    const list = o.def.lines?.[key];
    if (!list?.length || says.length >= LINES_AT_ONCE || says.some(s => s.id === o.id)) return;
    says.push({ id: o.id, text: String(list[Math.floor(random() * list.length)]).slice(0, LINE_MAX), until: T + LINE_S });
  }
  /** One step toward (x, y); true once there. */
  function walk(o, [x, y], dt) {
    const d = Math.hypot(x - o.x, y - o.y), sp = lib[o.kind].speed * (o.fast ? 2.5 : 1) * dt;
    if (Math.abs(x - o.x) > 0.1) o.face = x > o.x ? 1 : -1;
    if (d <= sp) { o.x = x; o.y = y; return true; }
    o.x += ((x - o.x) / d) * sp;
    o.y += ((y - o.y) / d) * sp;
    return false;
  }
  const restPose = o => (lib[o.kind].water ? (random() < 0.3 ? 'dabble' : 'swim') : random() < 0.5 ? 'eat' : 'stand');

  return {
    /** Where creatures may be: anything now outside is moved somewhere it may be. */
    place(world) {
      roam = world?.roam ?? [];
      avoid = world?.avoid ?? [];
      for (const o of ones) {
        if (okAt(o, o.x, o.y) && (o.x || o.y)) continue;
        const at = somewhere(o);
        if (at) [o.x, o.y] = at;
        o.to = null;
      }
    },
    /** Time passes: they wander, rest, nap, sleep at night (bar the night owls), doze with motion off; now and then one says something. */
    tick(dt, { night = false, still = false } = {}) {
      T += dt;
      says = says.filter(s => s.until > T);
      if (still) { for (const o of ones) o.pose = 'sleep'; return; }
      for (const o of ones) {
        if (o.act && T >= o.act.until) { o.act = null; o.fast = false; }
        if (o.act) {
          o.pose = o.act.pose;
          if (o.act.to && walk(o, o.act.to, dt)) o.act.to = null;
          continue;
        }
        if (night && lib[o.kind].night === 'sleep') { o.pose = 'sleep'; o.to = null; continue; }
        if (o.to) {
          o.pose = lib[o.kind].water ? 'swim' : 'walk';
          if (walk(o, o.to, dt)) { o.to = null; o.wait = 2 + random() * 5; o.pose = restPose(o); }
          continue;
        }
        if ((o.wait -= dt) > 0) continue;
        if (random() < 0.12) { o.pose = 'sleep'; o.wait = 6 + random() * 10; continue; }
        const to = somewhere(o);
        if (to && okPath(o, to[0], to[1])) o.to = to; else o.wait = 1;
      }
      if ((quiet -= dt) <= 0) {
        quiet = 20 + random() * 20;
        const awake = ones.filter(o => o.pose !== 'sleep' && o.def.lines?.idle?.length);
        if (awake.length) say(awake[Math.floor(random() * awake.length)], 'idle');
      }
    },
    /** Each creature as [y, draw], to sort in with the world's farmers and things. */
    items() {
      return ones.map(o => [o.y, () => {
        const hop = o.pose === 'happy' && Math.floor(T * 6) % 2 ? 1 : 0;
        lib[o.kind].draw(creaturePainter(o.x, o.y - hop, o.face), o.pose, T, o.look);
      }]);
    },
    /** The creature drawn at (x, y), the front one first. */
    at(x, y) {
      const hit = [...ones].sort((p, q) => q.y - p.y).find(o => { const c = lib[o.kind]; return Math.abs(x - o.x) <= c.w / 2 + 1 && y >= o.y - c.h - 1 && y <= o.y + 1; });
      return hit?.id ?? null;
    },
    /** A creature's home at (x, y), as its first creature (the pond: the ducks). */
    homeAt(x, y) { return ones.find(o => o.def.home && inRect(o.def.home, x, y))?.id ?? null; },
    /** Where it is, how tall, and where a farmer stands to do something with it (its bank, for one with a home). */
    where(id) {
      const o = byId(id);
      if (!o) return null;
      const stand = o.def.bank?.length ? o.def.bank.reduce((best, b) => (Math.hypot(b[0] - o.x, b[1] - o.y) < Math.hypot(best[0] - o.x, best[1] - o.y) ? b : best)) : [Math.round(o.x - 10 * o.face), Math.round(o.y)];
      return { x: o.x, y: o.y, h: lib[o.kind].h, stand };
    },
    menu(id) {
      const o = byId(id);
      return o ? { id, kind: o.kind, title: o.def.name ?? o.kind, actions: (o.def.actions ?? []).map(a => a.label) } : null;
    },
    /** Does an action (by a farmer, or by you when by is null): its line, its pose for a moment; Feed bread gathers the family. */
    perform(id, i, by) {
      const o = byId(id), a = o?.def.actions?.[i];
      if (!a) return null;
      const until = T + (a.ms ?? 2500) / 1000, at = a.gather ? this.where(id).stand : [Math.round(o.x), Math.round(o.y)];
      if (a.gather) {
        for (const d of ones.filter(x => x.kind === o.kind)) {
          const to = somewhere(d, at) ?? [d.x, d.y];
          d.act = { pose: lib[d.kind].water ? 'swim' : 'walk', to, until: T + 6 + (d.look === 'duckling' ? 1 : 0) };
        }
      } else {
        o.act = { pose: a.pose ?? 'happy', to: a.run ? somewhere(o) : null, until };
        o.fast = Boolean(a.run);
      }
      o.to = null;
      if (a.line) say(o, a.line);
      return { at, fx: a.fx ?? null, by: by ?? null };
    },
    /** The lines being said now, above their creatures. */
    bubbles() { return says.map(s => { const o = byId(s.id); return o ? { id: s.id, x: o.x, y: o.y - lib[o.kind].h - 2, text: s.text } : null; }).filter(Boolean); },
    list() { return ones.map(o => ({ id: o.id, kind: o.kind, x: Math.round(o.x), y: Math.round(o.y), pose: o.pose })); },
  };
}

/** Who goes to an animal at (x, y): the nearest farmer on the map not waiting on you and not already away, idle ones before busy ones; null: no one (you do it). */
function chooseDoer(farmers, posOf, x, y, away = new Set()) {
  const free = farmers.filter(f => posOf(f.id) && f.state !== 'waiting' && !away.has(f.id));
  const idle = free.filter(f => f.state !== 'working'), pool = idle.length ? idle : free;
  const far = f => { const p = posOf(f.id); return Math.hypot(p.x - x, p.y - y); };
  return pool.reduce((best, f) => (!best || far(f) < far(best) ? f : best), null);
}

/**
 * Farmers borrowed by animals: each goes to a spot, stays a moment and comes back. A busy one is away
 * 5 s at most; one that starts waiting on you drops it at once. When it never got there, missed() runs
 * (you do it yourself).
 */
function makeErrands() {
  const list = new Map();
  return {
    has: id => list.has(id),
    start(id, { x, y, now, busy, stay = 1.5, then, missed }) { list.set(id, { x, y, until: now + (busy ? 5 : 30), stay, arrived: 0, then, missed }); },
    /** Where a farmer goes instead of its place, or null; a farmer that waits on you is let go. */
    target(f) {
      const e = list.get(f.id);
      if (!e) return null;
      if (f.state === 'waiting') { list.delete(f.id); e.missed?.(); return null; }
      return [e.x, e.y];
    },
    /** Errands move on; true when a farmer was let go (its place changed). */
    tick(now, posOf, stateOf) {
      let changed = false;
      for (const [id, e] of list) {
        const at = posOf(id), state = stateOf(id);
        if (!at || !state || state === 'waiting') { list.delete(id); if (!e.arrived) e.missed?.(); changed = true; continue; }
        if (!e.arrived && Math.hypot(at.x - e.x, at.y - e.y) < 1) { e.arrived = now; e.then?.(); }
        if (e.arrived ? now - e.arrived >= e.stay || now > e.until + e.stay : now > e.until) { list.delete(id); if (!e.arrived) e.missed?.(); changed = true; }
      }
      return changed;
    },
    clear() { list.clear(); },
  };
}
