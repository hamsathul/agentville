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

  // What a creature does when something happens, unless its cast entry says otherwise (reacts).
  const REACTS = { deployFailed: 'scatter', deployOk: 'hop', harvest: 'gather', merged: null, arrive: null };
  const HABITS = new Set(['climb', 'circles', 'hide', 'yawn', 'stretch', 'chaseTail', 'pounce', 'fetch', 'roll', 'laps']);

  const STEPS = ['go', 'chase', 'say', 'pose', 'wear', 'wait', 'fx', 'stay'];
  const HAT = '#e9c46a'; // a farmer's hat, as a goat holds it

  /**
   * The kit. `world` is the cast (a list), or { cast, gags, play }: gags are short scripts of steps the
   * creatures (and farmers lent by the engine's crew) play out now and then; play is a farmer idle a while
   * playing with one (docs/worlds.md, "Creatures").
   */
  function makeAnimals(world, { random = seededRandom(7), warn = m => console.warn(m) } = {}) {
    const cast = Array.isArray(world) ? world : world?.cast ?? [];
    const gags = Array.isArray(world) ? [] : (world?.gags ?? []).filter(g => g && typeof g.id === 'string');
    const plays = Array.isArray(world) ? [] : (world?.play ?? []).filter(g => g && typeof g.id === 'string');
    const lib = typeof CREATURES === 'object' ? CREATURES : {};
    const ones = [];
    for (const def of cast ?? []) {
      if (!lib[def.kind]) throw new Error(`Animals: no creature called ${def.kind}.`);
      for (let i = 0; i < (def.count ?? 1); i++) ones.push({ id: `${def.kind}-${i}`, kind: def.kind, def, look: def.looks?.[i] ?? def.look, x: 0, y: 0, face: 1, pose: 'stand', to: null, wait: random() * 3, act: null, fast: false, away: true, lift: 0, wear: {} });
    }
    const byId = id => ones.find(o => o.id === id);
    let roam = [], avoid = [], blocked = () => false, perches = [], spots = {}, T = 0, says = [], quiet = 8, winter = false; // the first idle line after 8 s
    const reactedAt = new Map();
    let running = [], nextGag = 60 + random() * 60; // the gags (and play) under way; when the next gag may start
    const dropped = new Set(), taken = new Set();
    for (const g of gags) if (g.needs?.farmer === 'busy' && !busyOk(g)) { dropped.add(g.id); warn(`Animals: the gag ${g.id} was dropped: a busy farmer is only nibbled where it stands, 3 s at most`); }
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
    /** The whole way from (ax, ay) to (bx, by) is somewhere it may be: walking never cuts across what it must keep off. */
    const okSeg = (o, ax, ay, bx, by) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2)); for (let i = 1; i <= n; i++) if (!okAt(o, ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false; return true; };
    const okPath = (o, x, y) => okSeg(o, o.x, o.y, x, y);
    /** A route through these points from where it is, every leg allowed; null when any isn't. */
    function routeOf(o, points) {
      let [ax, ay] = [o.x, o.y];
      for (const [bx, by] of points) { if (!okSeg(o, ax, ay, bx, by)) return null; [ax, ay] = [bx, by]; }
      return points.map(([x, y]) => [Math.round(x), Math.round(y)]);
    }
    /** A spot it may be (near a point, for a gathering), reachable from where it is when `reach`; null when there is none. */
    function somewhere(o, { near = null, reach = false, spread = 1 } = {}) {
      const areas = o.def.home ? [o.def.home] : roam;
      for (let k = 0; k < 60 && areas.length; k++) {
        const r = areas[Math.floor(random() * areas.length)];
        const x = Math.round(near ? near[0] + (random() - 0.5) * 24 * spread : r.x + random() * r.w), y = Math.round(near ? near[1] + (random() - 0.5) * 12 * spread : r.y + random() * r.h);
        if (okAt(o, x, y) && (!reach || okPath(o, x, y))) return [x, y];
      }
      return null;
    }
    /** The allowed point nearest (x, y) for this creature: the event's place, as near as it may go. */
    function nearestAllowed(o, [x, y]) {
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const areas = o.def.home ? [o.def.home] : roam;
      for (const [cx, cy] of areas.map(r => [clamp(x, r.x + 2, r.x + r.w - 2), clamp(y, r.y + 2, r.y + r.h - 2)]).sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))) {
        for (let d = 0; d <= 120; d += 4) for (let k = 0; k < (d ? 12 : 1); k++) { // outward from there, ring by ring, until it may stand
          const px = Math.round(cx + Math.cos((k / 12) * 2 * Math.PI) * d), py = Math.round(cy + Math.sin((k / 12) * 2 * Math.PI) * d);
          if (okAt(o, px, py)) return [px, py];
        }
      }
      return null;
    }
    function say(o, key) {
      const list = o.def.lines?.[key];
      if (!list?.length || says.length >= LINES_AT_ONCE || says.some(s => s.id === o.id)) return false;
      says.push({ id: o.id, text: String(list[Math.floor(random() * list.length)]).slice(0, LINE_MAX), until: T + LINE_S });
      return true;
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
    /** Something it does for a while: a pose, a route to follow (checked), fast or not; then back to its own life. */
    function doing(o, { pose, route = [], s, fast = false, perch = null, spin = false, then = null }) {
      o.act = { pose, route: route ?? [], until: T + s, perch, spin, then };
      o.fast = fast;
      o.to = null;
    }
    function endAct(o) { o.act = null; o.fast = false; o.lift = 0; }
    /** Put somewhere it may be (it finds itself where it may not: the yard shrank), or away when there is nowhere. */
    function rehome(o) {
      const at = somewhere(o);
      o.to = null;
      endAct(o);
      if (at) { [o.x, o.y] = at; o.away = false; } else o.away = true;
    }
    const water = o => Boolean(lib[o.kind].water);
    const movingPose = o => (water(o) ? (winter ? 'slide' : 'swim') : 'walk');
    const restPose = o => (water(o) ? (winter ? 'stand' : random() < 0.3 ? 'dabble' : 'swim') : random() < 0.5 ? 'eat' : 'stand');
    const shown = () => ones.filter(o => !o.away);
    /** A habit, now and then, when it rests: what its kind is known for (docs/worlds.md, "Creatures"). */
    function habit(o) {
      const list = (o.def.habits ?? []).filter(h => HABITS.has(h));
      if (!list.length || random() >= 0.35) return false;
      const h = list[Math.floor(random() * list.length)], { x, y } = o;
      switch (h) {
        case 'climb': {
          const p = perches.filter(q => okAt(o, q[0], q[1]) && okPath(o, q[0], q[1])).sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))[0];
          if (!p) return false;
          doing(o, { pose: 'walk', route: [[p[0], p[1]]], s: 30, perch: p });
          return true;
        }
        case 'circles': { const r = routeOf(o, [[x + 10, y], [x, y + 5], [x - 10, y], [x, y - 5], [x, y]]); if (!r) return false; doing(o, { pose: 'run', route: r, s: 5, fast: true }); return true; }
        case 'hide': doing(o, { pose: 'hide', s: 4 }); return true;
        case 'yawn': case 'stretch': doing(o, { pose: h, s: 2 }); return true;
        case 'roll': doing(o, { pose: 'roll', s: 3 }); return true;
        case 'chaseTail': doing(o, { pose: 'run', s: 3, spin: true }); return true;
        case 'pounce': { const to = somewhere(o, { near: [x, y], reach: true, spread: 0.8 }); if (!to) return false; doing(o, { pose: 'run', route: [to], s: 3, fast: true, then: 'happy' }); return true; }
        case 'fetch': { const to = somewhere(o, { near: [x, y], reach: true, spread: 2.5 }), r = to && routeOf(o, [to, [x, y]]); if (!r) return false; doing(o, { pose: 'run', route: r, s: 8, fast: true }); return true; }
        case 'laps': { const r = routeOf(o, [[x + 20, y], [x - 20, y], [x + 20, y], [x - 20, y], [x, y]]); if (!r) return false; doing(o, { pose: 'run', route: r, s: 10, fast: true }); return true; }
        default: return false;
      }
    }
    /** A duckling follows the one ahead of it (the hen, then each duckling the one before): 8 px behind, in its home. */
    function leaderOf(o) {
      if (o.look !== 'duckling') return null;
      const family = ones.filter(d => d.kind === o.kind && !d.away && (d.look === 'hen' || d.look === 'duckling'));
      const i = family.indexOf(o);
      return i > 0 ? family[i - 1] : null;
    }

    /* ---------- the gag runner ---------- */

    const kindsOf = g => Object.keys(g.needs ?? {}).filter(k => !['farmer', 'chicken', 'spot'].includes(k));
    const free = o => !o.away && !o.act && !o.inGag && o.pose !== 'sleep';
    /** Can this gag start now, and with whom? Its roles bound ({ <kind>: creature id, farmer, chicken }), or null. */
    function cast4(g, crew, { longIdle = false } = {}) {
      const roles = {}, used = new Set();
      const kinds = kindsOf(g);
      for (const k of kinds) if (ones.filter(o => o.kind === k && free(o)).length < (Number(g.needs[k]) || 1)) return null;
      const first = kinds[0] && ones.filter(o => o.kind === kinds[0] && free(o));
      const lead = first?.length ? first[Math.floor(random() * first.length)] : null;
      if (lead) { roles[lead.kind] = lead.id; used.add(lead.id); }
      if (g.needs.spot && !(Array.isArray(spots[g.needs.spot]) && crew.spotFree(g.needs.spot))) return null;
      if (g.needs.farmer) {
        const pool = g.needs.farmer === 'busy' ? crew.busy() : longIdle ? crew.longIdle() : crew.idle();
        const near = f => (lead ? Math.hypot(f.x - lead.x, f.y - lead.y) : 0);
        const f = [...pool].filter(z => !running.some(r => r.roles.farmer === z.id)).sort((a, b) => near(a) - near(b))[0];
        if (!f) return null;
        roles.farmer = f.id;
      }
      if (g.needs.chicken) {
        const c = lead && crew.chickens().find(ch => Math.hypot(ch.x - lead.x, ch.y - lead.y) < 40);
        if (!c) return null;
        roles.chicken = c;
      }
      for (const k of kinds.slice(1)) { // the rest of its creatures: the nearest to the first
        const o = ones.filter(z => z.kind === k && free(z) && !used.has(z.id)).sort((a, b) => (lead ? Math.hypot(a.x - lead.x, a.y - lead.y) - Math.hypot(b.x - lead.x, b.y - lead.y) : 0))[0];
        if (!o) return null;
        roles[k] = o.id;
        used.add(o.id);
      }
      return roles;
    }
    /** A busy farmer is only nibbled where it stands: never moved, its hat off 3 s at most. */
    function busyOk(g) {
      let off = null, held = 0;
      for (const st of g.steps ?? []) {
        if ((st.go === 'farmer') || st.chase) return false;
        if (st.wear && st.what === 'hat') { if (st.on) { off = 0; held = 0; } else off = null; }
        if (off !== null) held += Number(st.wait ?? st.ms ?? 0) || 0;
      }
      return held <= 3000;
    }
    function fail(g, why, crew) {
      if (!dropped.has(g.def.id)) { dropped.add(g.def.id); warn(`Animals: the gag ${g.def.id} was dropped: ${why}`); }
      endGag(g, crew);
    }
    /** Starts one of these gags whose roles can be found now; true when one did. */
    function startGag(list, crew, opts = {}) {
      const order = list.filter(g => !dropped.has(g.id)).map(g => [random(), g]).sort((a, b) => a[0] - b[0]).map(([, g]) => g);
      for (const def of order) {
        const roles = cast4(def, crew, opts);
        if (!roles) continue;
        const g = { def, roles, i: 0, started: false, at: T, borrowed: new Set(), home: {}, wore: [], play: Boolean(opts.longIdle) };
        for (const [k, id] of Object.entries(roles)) if (k !== 'farmer' && k !== 'chicken') { const o = byId(id); o.inGag = true; endAct(o); o.to = null; g.home[k] = [Math.round(o.x), Math.round(o.y)]; }
        running.push(g);
        return true;
      }
      return false;
    }
    /** Ends a gag, done or not: what was worn comes back (the hat, the bucket), its farmers are let go, its creatures go back to their own lives. */
    function endGag(g, crew) {
      running = running.filter(r => r !== g);
      for (const w of g.wore) {
        const o = byId(w.id);
        if (w.what === 'hat') { if (o) o.wear.hat = undefined; if (g.roles.farmer) crew.flag(g.roles.farmer, 'hatless', false); }
        if (w.what === 'bucket') { if (o) o.wear.bucket = undefined; taken.delete('bucket'); }
      }
      for (const id of new Set([...g.borrowed, g.roles.farmer].filter(Boolean))) crew.release(id); // its farmer is let go, sent or not
      for (const [k, id] of Object.entries(g.roles)) {
        if (k === 'farmer' || k === 'chicken') continue;
        const o = byId(id);
        if (!o) continue;
        o.inGag = false;
        if (o.gagSpot) doing(o, { pose: movingPose(o), route: [g.home[k]], s: 10 }); // out of the spot it was let into
      }
    }
    /** Where a role is: a creature, the farmer (from the crew), the chicken; null for a role the gag doesn't have. */
    function whereOf(g, role, crew) {
      if (role === 'farmer') return g.roles.farmer ? crew.at(g.roles.farmer) : null;
      if (role === 'chicken') return g.roles.chicken ?? null;
      const o = byId(g.roles[role]);
      return o ? { x: o.x, y: o.y } : null;
    }
    /** A step's target as a point: a role (beside it), spot:<name>, away (far from where it is), back (where it started). */
    function targetOf(g, step, crew, o) {
      const to = step.to;
      if (typeof to === 'string' && to.startsWith('spot:')) return Array.isArray(spots[to.slice(5)]) ? { pt: spots[to.slice(5)], spot: true } : null;
      if (to === 'back') return { pt: g.home[step.go] ?? (o ? [o.x, o.y] : null) };
      if (to === 'away') {
        const from = whereOf(g, step.go, crew), cand = o ? [0, 1, 2, 3, 4, 5].map(() => somewhere(o, { reach: true })).filter(Boolean) : [];
        const best = cand.sort((a, b) => Math.hypot(b[0] - from.x, b[1] - from.y) - Math.hypot(a[0] - from.x, a[1] - from.y))[0];
        return best ? { pt: best } : null;
      }
      const w = whereOf(g, to, crew);
      return w ? { pt: [Math.round(w.x + 10), Math.round(w.y)] } : null;
    }
    /** One gag, one tick: the current step starts, or is checked; done, the next; past the last, it ends. */
    function runGag(g, crew) {
      const f = g.roles.farmer;
      if (f && (!crew.at(f) || forYou(crew.state(f)) || (g.play && crew.state(f) !== 'idle'))) { endGag(g, crew); return; } // it needs you (or work came): it all stops
      const step = g.def.steps?.[g.i];
      if (!step) { endGag(g, crew); return; }
      const key = STEPS.find(k => k in step);
      if (!key) { fail(g, `it has a step it doesn't know (${Object.keys(step).join(', ') || 'empty'})`, crew); return; }
      const role = step[key] === undefined ? null : key === 'wait' ? null : key === 'fx' ? step.at : step[key];
      if (role && typeof role === 'string' && key !== 'wait' && !(role in g.roles)) { fail(g, `it has a role it wasn't cast (${role})`, crew); return; }
      const o = role && role !== 'farmer' && role !== 'chicken' ? byId(g.roles[role]) : null;
      const ms = Number(step.ms ?? (key === 'wait' ? step.wait : 8000)) || 0, over = () => T - g.at >= ms / 1000;
      try {
        if (!g.started) {
          g.started = true;
          g.at = T;
          if (key === 'go') {
            const t = targetOf(g, step, crew, o);
            if (!t?.pt) { next(g); return; }
            if (role === 'farmer') { crew.send(f, t.pt, { stay: ms / 1000 }); g.borrowed.add(f); g.target = t.pt; }
            else {
              const pts = [t.pt], allowedInto = t.spot ? avoid.find(r => inRect(r, t.pt[0], t.pt[1])) : null;
              const ok = allowedInto || o.gagSpot ? true : routeOf(o, pts);
              doing(o, { pose: step.run ? 'run' : movingPose(o), route: ok ? pts : [], s: ms / 1000, fast: Boolean(step.run) });
              if (allowedInto) o.gagSpot = true;
            }
          } else if (key === 'say') {
            const by = o ?? byId(Object.entries(g.roles).find(([k]) => k !== 'farmer' && k !== 'chicken')?.[1]);
            if (by && (role === 'farmer' || !say(by, step.line)) && g.def.lines?.[step.line]) { const save = by.def.lines; by.def = { ...by.def, lines: { ...save, [step.line]: g.def.lines[step.line] } }; say(by, step.line); by.def = { ...by.def, lines: save }; }
            next(g); return;
          } else if (key === 'pose') doing(o, { pose: step.is, s: ms / 1000 });
          else if (key === 'stay') { doing(o, { pose: step.is ?? 'sleep', s: ms / 1000 }); }
          else if (key === 'wear') {
            if (step.what === 'hat') { o.wear.hat = step.on ? HAT : undefined; if (f) crew.flag(f, 'hatless', Boolean(step.on)); }
            else if (step.what === 'bucket') { o.wear.bucket = step.on || undefined; if (step.on) taken.add('bucket'); else taken.delete('bucket'); }
            else throw new Error(`it wears something it can't (${step.what})`);
            if (step.on) g.wore.push({ id: o.id, what: step.what }); else g.wore = g.wore.filter(w => !(w.id === o.id && w.what === step.what));
            next(g); return;
          } else if (key === 'fx') { const w = whereOf(g, step.at, crew); if (w) crew.fx(step.fx, [w.x, w.y]); next(g); return; }
        }
        // checked each tick until done
        if (key === 'go') {
          if (role === 'farmer') { const at = crew.at(f); if (over() || (at && g.target && Math.hypot(at.x - g.target[0], at.y - g.target[1]) < 2)) next(g); }
          else if (over() || !o.act || !o.act.route.length) next(g);
        } else if (key === 'chase') {
          const w = whereOf(g, step.after, crew);
          if (w) { crew.send(f, [Math.round(w.x - 8), Math.round(w.y)], { stay: 0 }); g.borrowed.add(f); }
          if (over()) next(g);
        } else if (key === 'stay') {
          const spot = typeof step.while === 'string' && step.while.startsWith('spot:') ? step.while.slice(5) : null;
          if (over() || (spot && !crew.spotFree(spot))) { if (o) endAct(o); next(g); }
        } else if (over()) next(g); // pose, wait
      } catch (err) {
        fail(g, String(err?.message ?? err), crew);
      }
    }
    function next(g) { g.i++; g.started = false; g.at = T; }

    return {
      /** Where creatures may be (and the perches and spots there): anything now outside is moved somewhere it may be, and walks toward nothing it may no longer reach. */
      place(world) {
        roam = world?.roam ?? [];
        avoid = world?.avoid ?? [];
        blocked = typeof world?.blocked === 'function' ? world.blocked : () => false;
        perches = Array.isArray(world?.perches) ? world.perches : [];
        spots = world?.spots && typeof world.spots === 'object' ? world.spots : {};
        for (const o of ones) {
          if (o.act?.perch && !perches.some(q => q[0] === o.act.perch[0] && q[1] === o.act.perch[1])) endAct(o); // its perch is gone
          if (o.away || (!o.gagSpot && !okAt(o, o.x, o.y))) { rehome(o); continue; }
          if (o.to && !okPath(o, o.to[0], o.to[1])) o.to = null;
          if (o.act?.route?.length && !routeOf(o, o.act.route)) o.act.route = [];
        }
      },
      /** Time passes: they wander, keep their habits, rest, sleep at night (bar the night owls), huddle in winter, doze with motion off; now and then one says something. */
      tick(dt, { night = false, still = false, winter: cold = false, crew = null } = {}) {
        T += dt;
        winter = cold;
        says = says.filter(s => s.until > T);
        for (const o of ones) {
          if (o.kind === 'goat') o.wear.scarf = winter || undefined;
          if (water(o)) o.wear.ice = winter || undefined;
        }
        if (still) { for (const o of ones) o.pose = 'sleep'; return; }
        for (const o of shown()) {
          if (!o.gagSpot && !okAt(o, o.x, o.y)) { rehome(o); continue; } // somewhere it may not be (the yard changed under it): moved back in
          if (o.act && T >= o.act.until) endAct(o);
          if (o.act) {
            const a = o.act;
            if (a.route.length) {
              o.pose = a.pose;
              if (walk(o, a.route[0], dt)) a.route.shift();
              if (!a.route.length && a.perch) { o.lift = a.perch[2]; a.until = T + 5 + random() * 3; o.pose = 'stand'; } // up on its perch
              if (!a.route.length && a.then) o.pose = a.then;
            } else if (!a.perch || o.lift) o.pose = a.then && !a.route.length && a.pose === 'run' && a.then ? a.then : a.pose;
            if (a.perch && o.lift) o.pose = 'stand';
            if (a.spin) o.face = Math.floor(T * 4) % 2 ? 1 : -1;
            continue;
          }
          if (o.inGag) { o.pose = o.pose === 'sleep' ? 'stand' : o.pose; continue; } // in a gag, between its steps: it waits for its cue
          if (o.gagSpot) o.gagSpot = false; // back out of the gag's spot
          if (night && lib[o.kind].night === 'sleep') { o.pose = 'sleep'; o.to = null; continue; }
          const lead = leaderOf(o);
          if (lead) { // in line behind its mother
            const tx = lead.x - 8 * lead.face, ty = lead.y;
            if (Math.hypot(tx - o.x, ty - o.y) > 3 && okAt(o, tx, ty)) { o.pose = movingPose(o); walk(o, [tx, ty], dt); } else o.pose = restPose(o) === 'dabble' ? 'swim' : restPose(o);
            continue;
          }
          if (o.to) {
            o.pose = movingPose(o);
            if (walk(o, o.to, dt)) { o.to = null; o.wait = (2 + random() * 5) * (winter ? 2 : 1); o.pose = restPose(o); }
            continue;
          }
          if ((o.wait -= dt) > 0) continue;
          if (!winter && (!night || lib[o.kind].night === 'awake') && habit(o)) continue;
          if (random() < 0.12) { o.pose = 'sleep'; o.wait = 6 + random() * 10; continue; }
          const huddle = winter && !water(o) && Array.isArray(spots.huddle) ? spots.huddle : null; // winter: they huddle together
          const to = somewhere(o, huddle ? { near: huddle, reach: true } : { reach: true });
          if (to) o.to = to; else o.wait = 1;
        }
        if (crew) {
          for (const g of [...running]) runGag(g, crew);
          if (!running.some(g => !g.play) && (nextGag -= dt) <= 0) nextGag = startGag(gags, crew) ? 60 + random() * 60 : 5; // none could start: look again soon
        }
        if ((quiet -= dt) <= 0) {
          quiet = 20 + random() * 20;
          const awake = shown().filter(o => o.pose !== 'sleep' && o.def.lines?.idle?.length);
          if (awake.length) say(awake[Math.floor(random() * awake.length)], 'idle');
        }
      },
      /**
       * Something happened (a deploy failed or went out, a harvest, a merge, a new farmer): those it concerns
       * react, and one says so. One reaction per kind every 30 s.
       */
      react(kind, at) {
        if (!(kind in REACTS) || !Array.isArray(at) || T - (reactedAt.get(kind) ?? -Infinity) < 30) return false;
        const what = o => o.def.reacts?.[kind] ?? (kind === 'deployFailed' && o.def.habits?.includes('hide') ? 'hide' : REACTS[kind]);
        const live = shown().filter(o => what(o));
        if (!live.length) return false;
        const far = o => Math.hypot(o.x - at[0], o.y - at[1]);
        const near = (list, n = 3) => { const close = list.filter(o => far(o) < 120); return close.length ? close : [...list].sort((a, b) => far(a) - far(b)).slice(0, n); };
        const acted = [];
        const byWhat = w => live.filter(o => what(o) === w);
        for (const o of byWhat('hide')) { doing(o, { pose: 'hide', s: 3 }); acted.push(o); }
        for (const o of near(byWhat('hop'))) { doing(o, { pose: 'happy', s: 1.5 }); acted.push(o); }
        for (const o of near(byWhat('scatter'))) { // run from it: of a few places it may reach, the farthest
          const best = [0, 1, 2, 3, 4, 5].map(() => somewhere(o, { reach: true })).filter(Boolean).sort((a, b) => Math.hypot(b[0] - at[0], b[1] - at[1]) - Math.hypot(a[0] - at[0], a[1] - at[1]))[0];
          doing(o, { pose: best ? 'run' : 'startled', route: best ? [best] : [], s: 3, fast: Boolean(best) });
          acted.push(o);
        }
        for (const o of [...byWhat('gather')].sort((a, b) => far(a) - far(b)).slice(0, 4)) { // to the yard's edge nearest it
          const edge = nearestAllowed(o, at), to = edge && somewhere(o, { near: edge, reach: true });
          if (to) { doing(o, { pose: movingPose(o), route: [to], s: 8, then: 'stand' }); acted.push(o); }
        }
        for (const o of byWhat('run')) { // the sheepdog: as near as it may go, fast
          const edge = nearestAllowed(o, at), to = edge && (okPath(o, edge[0], edge[1]) ? edge : somewhere(o, { near: edge, reach: true }));
          if (to) { doing(o, { pose: 'run', route: [to], s: 6, fast: true, then: 'happy' }); acted.push(o); }
        }
        if (!acted.length) return false;
        reactedAt.set(kind, T);
        acted.some(o => say(o, kind));
        return true;
      },
      /** Each creature as [y, draw], to sort in with the world's farmers and things. */
      items() {
        return shown().map(o => [o.y, () => {
          const hop = o.pose === 'happy' && Math.floor(T * 6) % 2 ? 1 : 0;
          lib[o.kind].draw(creaturePainter(o.x, o.y - hop - (o.lift || 0), o.face), o.pose, T, o.look, o.wear);
        }]);
      },
      /** The creature drawn at (x, y), the front one first. */
      at(x, y) {
        const hit = shown().sort((p, q) => q.y - p.y).find(o => { const c = lib[o.kind], top = o.y - (o.lift || 0); return Math.abs(x - o.x) <= c.w / 2 + 1 && y >= top - c.h - 1 && y <= top + 1; });
        return hit?.id ?? null;
      },
      /** A creature's home at (x, y), as its first creature (the pond: the ducks). */
      homeAt(x, y) { return shown().find(o => o.def.home && inRect(o.def.home, x, y))?.id ?? null; },
      /** Where it is, how tall, and where a farmer stands to do something with it (its bank, for one with a home). */
      where(id) {
        const o = byId(id);
        if (!o || o.away) return null;
        const stand = o.def.bank?.length ? o.def.bank.reduce((best, b) => (Math.hypot(b[0] - o.x, b[1] - o.y) < Math.hypot(best[0] - o.x, best[1] - o.y) ? b : best)) : [Math.round(o.x - 10 * o.face), Math.round(o.y)];
        return { x: o.x, y: o.y - (o.lift || 0), h: lib[o.kind].h, stand };
      },
      menu(id) {
        const o = byId(id);
        return o && !o.away ? { id, kind: o.kind, title: o.def.name ?? o.kind, actions: (o.def.actions ?? []).map(a => a.label) } : null;
      },
      /** Does an action (by a farmer, or by you when by is null): its line, its pose for a moment; Feed bread gathers the family. */
      perform(id, i, by) {
        const o = byId(id), a = o?.def.actions?.[i];
        if (!a || o.away) return null;
        const at = a.gather ? this.where(id).stand : [Math.round(o.x), Math.round(o.y)];
        if (a.gather) {
          for (const d of shown().filter(x => x.kind === o.kind)) {
            const to = somewhere(d, { near: at, reach: true });
            doing(d, { pose: movingPose(d), route: to ? [to] : [], s: 6 + (d.look === 'duckling' ? 1 : 0) });
          }
        } else {
          const to = a.run ? somewhere(o, { reach: true }) : null; // a run goes only where it may, the whole way
          doing(o, { pose: a.run && !to ? 'happy' : a.pose ?? 'happy', route: to ? [to] : [], s: (a.ms ?? 2500) / 1000, fast: Boolean(to) });
        }
        if (a.line) say(o, a.line);
        return { at, fx: a.fx ?? null, by: by ?? null };
      },
      /** The lines being said now, above their creatures. */
      bubbles() { return says.map(s => { const o = byId(s.id); return o && !o.away ? { id: s.id, x: o.x, y: o.y - (o.lift || 0) - lib[o.kind].h - 2, text: s.text } : null; }).filter(Boolean); },
      /** The gag under way (not play), for tests and the browser check. */
      gagNow() { const g = running.find(r => !r.play); return g ? { id: g.def.id } : null; },
      /** What the animals have taken just now ('bucket'): the world doesn't draw it where it was. */
      taken() { return new Set(taken); },
      list() { return ones.map(o => ({ id: o.id, kind: o.kind, x: Math.round(o.x), y: Math.round(o.y), pose: o.pose, lift: o.lift || 0, wear: { ...o.wear }, ...(o.away ? { away: true } : {}) })); },
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
