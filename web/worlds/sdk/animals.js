// The animals kit: creatures that live in a world just for fun (docs/worlds.md, "Creatures"). They
// never stand for data. A world gives its cast (animals()), where they may walk (roam()) and what they
// must keep off (avoid(), and its own fields and buildings); the kit keeps where each one is and what it
// does, its lines and its actions; the engine draws them, places their bubbles, and sends a farmer when
// you click one. A plain script in a world's frame, after creatures.js. Only its API is global
// (makeAnimals, chooseDoer, makeErrands, seededRandom), so a world's own names never clash with its helpers.
'use strict';

(() => {
  const LINE_MAX = 40, LINE_S = 4, LINES_AT_ONCE = 2;
  // A farmer that waits on you, or whose turn has ended (it's yours): it stays where you can see it.
  const forYou = state => state === 'waiting' || state === 'turn';

  /** A small seeded random source (xorshift), so a world's animals, and the tests, repeat. */
  function seededRandom(seed = 7) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 1_000_000) / 1_000_000; };
  }

  const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const overlaps = (r, x0, y0, x1, y1) => x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;

  function makeAnimals(cast, { random = seededRandom(7) } = {}) {
    const lib = typeof CREATURES === 'object' ? CREATURES : {};
    const ones = [];
    for (const def of cast ?? []) {
      if (!lib[def.kind]) throw new Error(`Animals: no creature called ${def.kind}.`);
      for (let i = 0; i < (def.count ?? 1); i++) ones.push({ id: `${def.kind}-${i}`, kind: def.kind, def, look: def.looks?.[i] ?? def.look, x: 0, y: 0, face: 1, pose: 'stand', to: null, wait: random() * 3, act: null, fast: false, away: true });
    }
    const byId = id => ones.find(o => o.id === id);
    let roam = [], avoid = [], blocked = () => false, T = 0, says = [], quiet = 8; // the first idle line after 8 s
    /**
     * May it stand at (x, y)? One with a home: inside it. The rest: feet in a roam area, and its whole body
     * clear of what it keeps off (a tall one doesn't reach over the eggs), and of the world's own fields and
     * buildings (blocked: the world's fieldAt and buildingAt).
     */
    function okAt(o, x, y) {
      if (o.def.home) return inRect(o.def.home, x, y);
      const c = lib[o.kind], x0 = x - c.w / 2, x1 = x + c.w / 2, y0 = y - c.h;
      if (!roam.some(r => inRect(r, x, y))) return false;
      if (avoid.some(r => overlaps(r, x0, y0, x1, y))) return false;
      for (const [px, py] of [[x0, y0], [x1, y0], [x0, y], [x1, y], [x, y - c.h / 2]]) if (blocked(px, py)) return false;
      return true;
    }
    /** The whole way from where it is to (x, y) is somewhere it may be: walking never cuts across what it must keep off. */
    const okPath = (o, x, y) => { const n = Math.max(1, Math.ceil(Math.hypot(x - o.x, y - o.y) / 2)); for (let i = 1; i <= n; i++) if (!okAt(o, o.x + ((x - o.x) * i) / n, o.y + ((y - o.y) * i) / n)) return false; return true; };
    /** A spot it may be (near a point, for a gathering), reachable from where it is when `reach`; null when there is none. */
    function somewhere(o, { near = null, reach = false } = {}) {
      const areas = o.def.home ? [o.def.home] : roam;
      for (let k = 0; k < 60 && areas.length; k++) {
        const r = areas[Math.floor(random() * areas.length)];
        const x = Math.round(near ? near[0] + (random() - 0.5) * 24 : r.x + random() * r.w), y = Math.round(near ? near[1] + (random() - 0.5) * 12 : r.y + random() * r.h);
        if (okAt(o, x, y) && (!reach || okPath(o, x, y))) return [x, y];
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
    /** Put somewhere it may be (it finds itself where it may not: the yard shrank), or away when there is nowhere. */
    function rehome(o) {
      const at = somewhere(o);
      o.to = null;
      if (o.act) o.act.to = null;
      if (at) { [o.x, o.y] = at; o.away = false; } else o.away = true;
    }
    const restPose = o => (lib[o.kind].water ? (random() < 0.3 ? 'dabble' : 'swim') : random() < 0.5 ? 'eat' : 'stand');
    const shown = () => ones.filter(o => !o.away);

    return {
      /** Where creatures may be: anything now outside is moved somewhere it may be, and walks toward nothing it may no longer reach. */
      place(world) {
        roam = world?.roam ?? [];
        avoid = world?.avoid ?? [];
        blocked = typeof world?.blocked === 'function' ? world.blocked : () => false;
        for (const o of ones) {
          if (o.away || !okAt(o, o.x, o.y)) { rehome(o); continue; }
          if (o.to && !okPath(o, o.to[0], o.to[1])) o.to = null;
          if (o.act?.to && !okPath(o, o.act.to[0], o.act.to[1])) o.act.to = null;
        }
      },
      /** Time passes: they wander, rest, nap, sleep at night (bar the night owls), doze with motion off; now and then one says something. */
      tick(dt, { night = false, still = false } = {}) {
        T += dt;
        says = says.filter(s => s.until > T);
        if (still) { for (const o of ones) o.pose = 'sleep'; return; }
        for (const o of shown()) {
          if (!okAt(o, o.x, o.y)) { rehome(o); continue; } // somewhere it may not be (the yard changed under it): moved back in
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
          const to = somewhere(o, { reach: true });
          if (to) o.to = to; else o.wait = 1;
        }
        if ((quiet -= dt) <= 0) {
          quiet = 20 + random() * 20;
          const awake = shown().filter(o => o.pose !== 'sleep' && o.def.lines?.idle?.length);
          if (awake.length) say(awake[Math.floor(random() * awake.length)], 'idle');
        }
      },
      /** Each creature as [y, draw], to sort in with the world's farmers and things. */
      items() {
        return shown().map(o => [o.y, () => {
          const hop = o.pose === 'happy' && Math.floor(T * 6) % 2 ? 1 : 0;
          lib[o.kind].draw(creaturePainter(o.x, o.y - hop, o.face), o.pose, T, o.look);
        }]);
      },
      /** The creature drawn at (x, y), the front one first. */
      at(x, y) {
        const hit = shown().sort((p, q) => q.y - p.y).find(o => { const c = lib[o.kind]; return Math.abs(x - o.x) <= c.w / 2 + 1 && y >= o.y - c.h - 1 && y <= o.y + 1; });
        return hit?.id ?? null;
      },
      /** A creature's home at (x, y), as its first creature (the pond: the ducks). */
      homeAt(x, y) { return shown().find(o => o.def.home && inRect(o.def.home, x, y))?.id ?? null; },
      /** Where it is, how tall, and where a farmer stands to do something with it (its bank, for one with a home). */
      where(id) {
        const o = byId(id);
        if (!o || o.away) return null;
        const stand = o.def.bank?.length ? o.def.bank.reduce((best, b) => (Math.hypot(b[0] - o.x, b[1] - o.y) < Math.hypot(best[0] - o.x, best[1] - o.y) ? b : best)) : [Math.round(o.x - 10 * o.face), Math.round(o.y)];
        return { x: o.x, y: o.y, h: lib[o.kind].h, stand };
      },
      menu(id) {
        const o = byId(id);
        return o && !o.away ? { id, kind: o.kind, title: o.def.name ?? o.kind, actions: (o.def.actions ?? []).map(a => a.label) } : null;
      },
      /** Does an action (by a farmer, or by you when by is null): its line, its pose for a moment; Feed bread gathers the family. */
      perform(id, i, by) {
        const o = byId(id), a = o?.def.actions?.[i];
        if (!a || o.away) return null;
        const until = T + (a.ms ?? 2500) / 1000, at = a.gather ? this.where(id).stand : [Math.round(o.x), Math.round(o.y)];
        if (a.gather) {
          for (const d of shown().filter(x => x.kind === o.kind)) {
            const to = somewhere(d, { near: at, reach: true });
            d.act = { pose: lib[d.kind].water ? 'swim' : 'walk', to, until: T + 6 + (d.look === 'duckling' ? 1 : 0) };
          }
        } else {
          const to = a.run ? somewhere(o, { reach: true }) : null; // a run goes only where it may, the whole way
          o.act = { pose: a.run && !to ? 'happy' : a.pose ?? 'happy', to, until };
          o.fast = Boolean(to);
        }
        o.to = null;
        if (a.line) say(o, a.line);
        return { at, fx: a.fx ?? null, by: by ?? null };
      },
      /** The lines being said now, above their creatures. */
      bubbles() { return says.map(s => { const o = byId(s.id); return o && !o.away ? { id: s.id, x: o.x, y: o.y - lib[o.kind].h - 2, text: s.text } : null; }).filter(Boolean); },
      list() { return ones.map(o => ({ id: o.id, kind: o.kind, x: Math.round(o.x), y: Math.round(o.y), pose: o.pose, ...(o.away ? { away: true } : {}) })); },
    };
  }

  /**
   * Who goes to an animal at (x, y): the nearest farmer on the map that isn't waiting on you (or on its
   * turn), isn't already away, and can make it (`ok`: a busy one only if the trip fits its few seconds),
   * idle ones before busy ones; null: no one (you do it).
   */
  function chooseDoer(farmers, posOf, x, y, away = new Set(), ok = () => true) {
    const free = farmers.filter(f => posOf(f.id) && !forYou(f.state) && !away.has(f.id) && ok(f));
    const idle = free.filter(f => f.state !== 'working'), pool = idle.length ? idle : free;
    const far = f => { const p = posOf(f.id); return Math.hypot(p.x - x, p.y - y); };
    return pool.reduce((best, f) => (!best || far(f) < far(best) ? f : best), null);
  }

  /**
   * Farmers borrowed by animals: each goes to a spot, stays a moment and comes back. A busy one is away
   * 5 s at most (counted from when it got busy, if it started idle); one that starts waiting on you, or
   * whose turn ends, drops it at once. When it never got there, missed() runs (you do it yourself).
   */
  function makeErrands() {
    const list = new Map();
    const drop = (id, e) => { list.delete(id); if (!e.arrived) e.missed?.(); };
    return {
      has: id => list.has(id),
      start(id, { x, y, now, busy, stay = 1.5, then, missed }) { list.set(id, { x, y, until: now + (busy ? 5 : 30), busy: Boolean(busy), stay, arrived: 0, then, missed }); },
      /** Where a farmer goes instead of its place, or null; one that waits on you (or is on its turn) is let go. */
      target(f) {
        const e = list.get(f.id);
        if (!e) return null;
        if (forYou(f.state)) { drop(f.id, e); return null; }
        return [e.x, e.y];
      },
      /** Errands move on; true when a farmer was let go (its place changed). */
      tick(now, posOf, stateOf) {
        let changed = false;
        for (const [id, e] of list) {
          const at = posOf(id), state = stateOf(id);
          if (!at || !state || forYou(state)) { drop(id, e); changed = true; continue; }
          if (state === 'working' && !e.busy) { e.busy = true; e.until = Math.min(e.until, now + 5); } // it got busy: its few seconds start now
          if (!e.arrived && Math.hypot(at.x - e.x, at.y - e.y) < 1) { e.arrived = now; e.then?.(); }
          if (e.arrived ? now - e.arrived >= e.stay || now > e.until + e.stay : now > e.until) { drop(id, e); changed = true; }
        }
        return changed;
      },
      /** Every errand ends where it is (motion switched off, or the animals hidden): one not there yet is done by you. */
      finish() { for (const [id, e] of [...list]) drop(id, e); },
      clear() { list.clear(); },
    };
  }

  Object.assign(globalThis, { seededRandom, makeAnimals, chooseDoer, makeErrands });
})();
