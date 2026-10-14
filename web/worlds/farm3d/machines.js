// The farmers' machines (spec 2026-10-14 §7), by rule: which machine a farmer's step needs, how long it stays out,
// the passes it drives over a field, its way there and back, and where each is from moment to moment. A farmer whose
// step needs one walks to the machine shed, climbs in, drives the lane and the walkway to its field (or to the stall,
// or off to town), works, and drives home again; with Motion off each stands at its work spot. Pure: no three.js, no
// clock of its own. build/machines.js draws them; app.js sends the farmers to the shed and tells this who has boarded.
import { BED, CORR, CORR_OF, LANE, LANE_HALF, ROAD as TOWN_ROAD, SHED_DOOR, STALL, W, east } from './layout.js';

export const HOLD_S = 20; // a machine stays out this long after its step ends, so it doesn't flicker
export const BIG_EDIT = 5; // distinct files written in the last 5 minutes (scene `writes`) that make an edit a big one
export const VEHICLE = { plough: 'tractor', sprayer: 'tractor', mower: 'tractor', supplies: 'tractor', crates: 'tractor', truck: 'truck', combine: 'combine' };
const TOWN_X = W + 40; // off the map, in town
export const TOWN_END = [W + 16, LANE]; // where a truck stands with Motion off: just past the lane's end, by the road to town (the carts' rank is before it)
export const STALL_SPOT = [STALL.x + 50, LANE]; // where crates are unloaded for the stall: on the lane past it, clear of the walkway at CORR[1]
const PASS_JOBS = new Set(['plough', 'sprayer', 'mower', 'combine']); // the ones that drive over the field
const ROAD = 48, FIELD = 24; // px a second: on the lane and the walkways, and in a field
const ROW0 = 6, ROW = 12, ROWS = 6, TURN = 12; // a bed's first row, the rows' spacing, how many, and the headland's width
const WAIT_S = 3; // loading or unloading
const STOP_S = 5, GHOST_S = 3; // stopped this long, it passes through what is ahead for this long
const AHEAD = 24, ASIDE = 5; // what stops a machine: within 3 m ahead, and this close to its line (the other half of the lane is 6 px aside)

/** The machine a farmer's step needs, or null (by hand): tests spray, builds mow, installs bring supplies, pushes take
 *  crates to the stall, deploys drive to town; an edit or write of 5 files or more ploughs (and sows). Only at work, and
 *  in a field. */
export function machineFor(f) {
  if (f.state !== 'working' || !f.field) return null;
  return { test: 'sprayer', build: 'mower', install: 'supplies', push: 'crates', deploy: 'truck' }[f.step] ?? ((f.step === 'edit' || f.step === 'write') && f.writes >= BIG_EDIT ? 'plough' : null);
}

/** The passes over a bed for farmer k of n working it (each takes every n-th row; more than six share the rows):
 *  points [x, y] on the 2D map, along its rows and U-turning 12 px outside its ends, from the walkway side (column 0's
 *  walkway is on its right, the others' on their left). */
export function passesFor(bed, n = 1, k = 0) {
  const fromRight = bed.cx - (bed.ox ?? 0) < CORR[1], near = fromRight ? bed.x0 + BED.w + TURN : bed.x0 - TURN, far = fromRight ? bed.x0 - TURN : bed.x0 + BED.w + TURN;
  const m = Math.max(1, Math.min(n, ROWS)), pts = [];
  let flip = false;
  for (let row = k % m; row < ROWS; row += m) {
    const y = bed.y0 + ROW0 + row * ROW;
    pts.push([flip ? far : near, y], [flip ? near : far, y]);
    flip = !flip;
  }
  return pts;
}
/** Where a trailer stops in a field (to unload sacks, or to load crates): at the walkway end of a row, from the bottom up,
 *  every other row, so two don't stand on one another (k: which of the field's trailers). */
const dropSpot = (bed, k) => [passesFor(bed)[0][0], bed.y0 + ROW0 + (ROWS - 1 - 2 * (k % 3)) * ROW];

/** A machine's way between two places, as the carts go: onto the lane (up the walkway nearest), along it, then down
 *  the walkway nearest the place, and over to it; between two places below the lane by the same walkway, along that
 *  walkway only. `lane`: the y it keeps to (its half of the lane). */
export function routeBetween([x, y], [tx, ty], { lane = LANE, corr = CORR } = {}) {
  const near = v => corr.reduce((best, c) => (Math.abs(v - c) < Math.abs(v - best) ? c : best));
  const onLane = v => Math.abs(v - LANE) <= LANE_HALF, below = v => v > LANE + LANE_HALF;
  const pts = [];
  if (below(y) && below(ty) && near(x) === near(tx)) pts.push([near(x), y], [near(x), ty], [tx, ty]); // down or up its walkway
  else {
    if (onLane(y)) pts.push([x, lane]);
    else { const c = y < LANE ? x : near(x); if (y > LANE) pts.push([c, y]); pts.push([c, lane]); }
    if (onLane(ty)) pts.push([tx, lane], [tx, ty]);
    else { const c = ty < LANE ? tx : near(tx); pts.push([c, lane]); if (ty > LANE) pts.push([c, ty]); pts.push([tx, ty]); }
  }
  return pts.filter((p, i) => { const q = i ? pts[i - 1] : [x, y]; return p[0] !== q[0] || p[1] !== q[1]; });
}

/** Whether something at (ox, oy) is ahead of a machine at (x, y) going `heading`: within 3 m along its way and close to
 *  its line (so one on the other half of the lane, coming the other way, passes). */
export function isAhead(x, y, heading, ox, oy) {
  const dx = ox - x, dy = oy - y, along = dx * Math.cos(heading) + dy * Math.sin(heading);
  return along > 2 && along < AHEAD && Math.abs(dy * Math.cos(heading) - dx * Math.sin(heading)) < ASIDE;
}

/** Whether something at (x, y) is in a moving machine's way, to step aside: within 5 m ahead and 1.75 m of its line.
 *  The point on its line beside it (what to step away from), or null. */
export function inPathOf(m, x, y) {
  if (!m.moving) return null;
  const c = Math.cos(m.heading), s = Math.sin(m.heading), along = (x - m.x) * c + (y - m.y) * s;
  if (along < 2 || along > 40 || Math.abs((y - m.y) * c - (x - m.x) * s) > 14) return null;
  return [m.x + c * along, m.y + s * along];
}

/**
 * Who climbs in and who gets out, for tick's items (app.js does it): a farmer sent to the shed boards when it gets
 * there; one not sent yet, or whose walk there was cut short (a play ended its errand), is sent (again), unless it is
 * on another errand; with Motion off every farmer of a machine boards at once; a boarded farmer whose machine has
 * parked, left it (called back), or gone, is let go; one sent for a machine no longer wanted is forgotten.
 * Returns { board, send, release, forget }: ids.
 */
export function crewActions(items, { boarded, sent, onErrand, arrived, still }) {
  const by = new Map(items.map(i => [i.id, i])), out = { board: [], send: [], release: [], forget: [] };
  for (const id of boarded) { const it = by.get(id); if (!it || it.phase === 'parked' || (!it.driver && it.phase !== 'walking')) out.release.push(id); }
  for (const id of sent) if (!by.has(id)) out.forget.push(id);
  for (const it of items) {
    if (boarded.has(it.id)) continue;
    if (still) { if (it.phase !== 'parked' && it.phase !== 'home') out.board.push(it.id); continue; }
    if (it.phase !== 'walking') continue;
    if (sent.has(it.id) && arrived(it.id)) out.board.push(it.id);
    else if (!onErrand(it.id)) out.send.push(it.id);
  }
  return out;
}

/**
 * The machines from moment to moment. `want(model, nowS, compacted)` (each scene) says which farmers want which machine
 * (`compacted`: the ids whose agent compacted since the last scene: the combine); `tick(dt, ctx)` (each frame) moves
 * them and returns what to draw. ctx: { farmers: Map(id → { x, y, state, field }) of the farmers drawn, beds: Map(key →
 * bed), boarded(id): its farmer is in the seat, blocked(x, y, heading, id): something within 3 m ahead, still: Motion
 * off, now: the time in seconds on want's clock (a hold runs out by it), onError(err): one machine's tick threw (it is
 * dropped, the rest go on), land: { w, ox } (with a neighbour farm: its machines from its own shed, town up the road) }.
 */
export function createMachines() {
  const jobs = new Map(); // id → { job, field, lastNeeded (s), needed, combine: the combine's one round of its field }
  const rigs = new Map(); // id → the machine out for that farmer
  let wanted = new Map(), groups = new Map(); // who shares a rest spot: a field's passes, a field's trailers, the stall, town
  // the land (spec 2026-10-14 neighbour): with a neighbour farm, both farms' walkways, and town up the road between them
  let land = { w: W, ox: 0 }, corr = CORR;
  /** A field's farm's shed door: yours, or the neighbour's (each farm's machines live in its own shed). */
  const doorOf = bed => (bed?.ox ? east(SHED_DOOR, bed.ox) : SHED_DOOR);

  function want(model, nowS, compacted = new Set()) {
    const seen = new Set();
    for (const f of model.farmers ?? []) {
      seen.add(f.id);
      let j = jobs.get(f.id);
      if (f.state !== 'working') { jobs.delete(f.id); continue; } // waiting on you, your turn, idle: called straight back
      if (compacted.has(f.id) && f.field) { j = { job: 'combine', field: f.field, lastNeeded: nowS, combine: true }; jobs.set(f.id, j); continue; }
      if (j?.combine) continue; // the combine works its field once, whatever the steps do
      const need = machineFor(f);
      if (need) jobs.set(f.id, { job: need, field: f.field, lastNeeded: nowS, combine: false, needed: true });
      else if (j && nowS - j.lastNeeded >= HOLD_S) jobs.delete(f.id);
      else if (j) j.needed = false; // held: tick lets it go when the hold is over
    }
    for (const id of [...jobs.keys()]) if (!seen.has(id)) jobs.delete(id);
    wanted = new Map([...jobs].map(([id, j]) => [id, { job: j.job, field: j.field }]));
    return wanted;
  }

  /** Where in its group of `key` a machine is: [how many share it, its place among them]. */
  const place = (key, id) => { const l = groups.get(key) ?? [id]; return [l.length, Math.max(0, l.indexOf(id))]; };
  const groupOf = j => (PASS_JOBS.has(j.job) ? `pass|${j.field}` : j.job === 'truck' ? 'town' : `drop|${j.field}`);
  const stallSpot = id => [STALL_SPOT[0] + place('stall', id)[1] * 64, LANE];
  /** Where a job first goes: its first pass, the bed's end for a trailer, or town. */
  function firstStop(j, bed, id) {
    if (j.job === 'truck') return land.ox ? [TOWN_ROAD.mid, -40 - place('town', id)[1] * 50] : [TOWN_X + place('town', id)[1] * 50, LANE]; // with a neighbour, town is up the road
    if (PASS_JOBS.has(j.job)) { const [n, k] = place(`pass|${j.field}`, id); return passesFor(bed, n, k)[0]; }
    return dropSpot(bed, place(`drop|${j.field}`, id)[1]);
  }
  /** Where a machine stands with Motion off: its first pass (every other one at the far end), the bed's end for sacks,
   *  the stall for crates, town's end for the truck; none on another. */
  function restSpot(j, bed, id) {
    if (j.job === 'truck') return land.ox ? [TOWN_ROAD.mid, LANE - 40 - place('town', id)[1] * 48] : [TOWN_END[0] + place('town', id)[1] * 48, LANE];
    if (j.job === 'crates') return stallSpot(id);
    if (j.job === 'supplies') return dropSpot(bed, place(`drop|${j.field}`, id)[1]);
    const [n, k] = place(`pass|${j.field}`, id), p = passesFor(bed, n, k);
    return p[k % 2 && p.length > 1 ? 1 : 0];
  }
  const rowOf = (bed, y) => Math.max(0, Math.min(ROWS - 1, Math.round((y - bed.y0 - ROW0) / ROW)));

  /** Moves a machine along its path by up to `d` px; true if it moved. */
  function drive(r, d) {
    let moved = false;
    while (d > 1e-6 && r.path.length) {
      const [tx, ty] = r.path[0], dx = tx - r.x, dy = ty - r.y, len = Math.hypot(dx, dy);
      if (len < 1e-6) { r.path.shift(); continue; }
      const step = Math.min(d, len);
      r.heading = Math.atan2(dy, dx);
      r.x += (dx / len) * step; r.y += (dy / len) * step;
      d -= step; moved = true;
      if (step === len) { r.x = tx; r.y = ty; r.path.shift(); }
    }
    return moved;
  }
  /** Sends a machine home along its half of the lane; `empty`: its farmer got out (called back, or gone). */
  function goHome(r, empty = false) {
    r.phase = 'home';
    r.empty = empty;
    r.path = routeBetween([r.x, r.y], r.door ?? SHED_DOOR, { lane: LANE - 3, corr });
    r.wait = 0;
  }
  /** A new job for a machine: what it carries and what it has done reset. */
  function take(r, j) {
    Object.assign(r, { job: j.job, field: j.field, vehicle: VEHICLE[j.job], rowsDone: 0, rowsPassed: new Set(), wait: 0, load: j.job === 'supplies', toStall: false, passes: null });
  }
  /** Sets a machine off from where it is to its job's place. */
  function setOff(r, ctx, j) {
    take(r, j);
    Object.assign(r, { phase: 'out', empty: false, done: false });
    r.path = routeBetween([r.x, r.y], firstStop(j, ctx.beds.get(j.field), r.id), { lane: LANE + 3, corr });
  }

  /** One machine's moment; false when it is done with (parked last frame, or no longer wanted before it set off). */
  function step(id, r, dt, ctx, items) {
    const j = wanted.get(id), farmer = ctx.farmers.get(id), bed = ctx.beds.get(r.field);
    const keep = j && farmer && ctx.beds.has(j.field);
    r.moving = false;
    // its farm gone (the second account's), it goes with it; a job on the other farm (a session moved to the other
    // account) takes that farm's machine: this one goes home to its own shed first, then is put away
    const door = r.door ?? SHED_DOOR, theirs = keep ? doorOf(ctx.beds.get(j.field)) : door;
    if ((!land.ox && door[0] > W) || (keep && theirs[0] !== door[0] && (ctx.still || r.phase === 'walking' || r.phase === 'parked'))) return false;

    if (ctx.still) { // Motion off: at its work spot, its farmer in the seat; nothing moves
      if (!keep) return false;
      if (r.job !== j.job || r.field !== j.field || !r.rowsPassed) take(r, j);
      [r.x, r.y] = restSpot(j, ctx.beds.get(j.field), id);
      Object.assign(r, { phase: 'work', path: [], passes: null, passRow: null, empty: false, load: j.job === 'supplies' || j.job === 'crates' });
      if (j.job === 'combine') { r.rowsDone = ROWS; jobs.delete(id); wanted.delete(id); } // its harvest at once: nothing moves to cut it row by row
      items.push(itemOf(r, true));
      return true;
    }

    if (r.phase === 'walking') { // in the shed, its farmer on the way
      if (!keep) return false;
      if (ctx.boarded(id)) setOff(r, ctx, j);
      else { items.push(itemOf(r, false)); return true; }
    } else if (r.phase === 'parked') return false; // parked last frame: its farmer let go
    else if (r.phase !== 'home') {
      if (!keep) goHome(r, !farmer || farmer.state !== 'working'); // called back or gone: its farmer gets out; its hold over, or its field gone: it drives home
      else if (j.field !== r.field || VEHICLE[j.job] !== r.vehicle) goHome(r); // another field, or another vehicle: home first
      else if (j.job !== r.job) { // another tractor job: the implement swaps where it is
        const inField = r.phase === 'work' && PASS_JOBS.has(r.job) && PASS_JOBS.has(j.job);
        take(r, j);
        if (!inField) { r.phase = 'out'; r.path = routeBetween([r.x, r.y], firstStop(j, bed, id), { lane: LANE + 3, corr }); } // to the bed's end, or along it to its passes
      }
    } else if (keep && !r.empty && r.vehicle === VEHICLE[j.job] && r.field === j.field && !r.done) { // wanted again on the way home: back out
      setOff(r, ctx, j);
    }

    const driver = Boolean(farmer && ctx.boarded(id) && !r.empty);
    // stopping for something ahead (a farmer, an animal, another machine), and passing through after 5 s stopped
    const moveBy = speed => {
      if (r.ghost > 0) r.ghost -= dt;
      else if (ctx.blocked(r.x, r.y, r.heading, id)) {
        r.stopped += dt;
        if (r.stopped >= STOP_S) { r.ghost = GHOST_S; r.stopped = 0; }
        return false;
      }
      r.stopped = 0;
      return drive(r, speed * dt);
    };

    if (r.phase === 'out') {
      r.moving = moveBy(ROAD);
      if (!r.path.length) { r.phase = 'work'; r.wait = 0; }
    } else if (r.phase === 'work') {
      if (PASS_JOBS.has(r.job)) {
        const [n, k] = place(`pass|${r.field}`, id);
        if (!r.passes || r.crew !== `${n}|${k}`) { // its passes, from whichever end of them it is nearer
          const p = passesFor(bed, n, k), back = [...p].reverse(), d = q => Math.hypot(q[0] - r.x, q[1] - r.y);
          Object.assign(r, { crew: `${n}|${k}`, passes: d(back[0]) < d(p[0]) ? back : p });
          r.path = [...r.passes];
        }
        r.moving = moveBy(FIELD);
        const done = Math.floor((r.passes.length - r.path.length) / 2); // a row is done at the far end of its pass
        for (let i = 0; i < done; i++) r.rowsPassed.add(rowOf(bed, r.passes[2 * i][1]));
        r.rowsDone = Math.min(r.passes.length / 2, done);
        r.passRow = rowOf(bed, (r.path[0] ?? r.passes.at(-1))[1]); // the row it is on, or turning to
        if (!r.path.length) {
          if (r.job === 'combine') { r.done = true; jobs.delete(id); wanted.delete(id); goHome(r); } // once over its field
          else { r.passes = [...r.passes].reverse(); r.path = [...r.passes]; } // round again while it is wanted
        }
      } else if (r.job === 'supplies') { // unloads at the bed's end, then waits there while wanted
        r.wait += dt;
        if (r.wait >= WAIT_S) r.load = false;
      } else if (r.job === 'crates') { // loads at the field, takes them to the stall, unloads, waits there
        if (!r.toStall) {
          r.wait += dt;
          if (r.wait >= WAIT_S) { r.load = true; r.toStall = true; r.path = routeBetween([r.x, r.y], stallSpot(id), { lane: LANE + 3, corr }); }
        } else if (r.path.length) r.moving = moveBy(ROAD);
        else { r.wait += dt; if (r.wait >= 2 * WAIT_S) r.load = false; }
      } // the truck waits in town while the deploy runs
    } else if (r.phase === 'home') {
      r.passRow = null;
      r.moving = moveBy(ROAD);
      if (!r.path.length) { r.phase = 'parked'; r.toStall = false; }
    }
    // parked with its farmer still in the seat and a job wanted (another vehicle, another field): off again at once
    if (r.phase === 'parked' && keep && !r.empty) {
      if (doorOf(ctx.beds.get(j.field))[0] !== (r.door ?? SHED_DOOR)[0]) return false; // its job is on the other farm now: that farm's machine goes
      setOff(r, ctx, j);
    }
    items.push(itemOf(r, driver));
    return true;
  }

  function tick(dt, ctx) {
    const items = [];
    land = ctx.land ?? { w: W, ox: 0 };
    corr = land.ox ? [...CORR, ...CORR_OF(land.ox)] : CORR;
    if (Number.isFinite(ctx.now)) for (const [id, j] of jobs) if (!j.needed && !j.combine && ctx.now - j.lastNeeded >= HOLD_S) { jobs.delete(id); wanted.delete(id); } // the hold over, whether or not a scene came
    groups = new Map();
    const join = (key, id) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(id); };
    for (const [id, j] of wanted) { join(groupOf(j), id); if (j.job === 'crates') join('stall', id); }
    for (const l of groups.values()) l.sort();

    for (const [id, j] of wanted) if (!rigs.has(id)) {
      const bed = ctx.beds.get(j.field), farmer = ctx.farmers.get(id);
      if (!bed || !farmer) continue; // no field to work, or its farmer not drawn: no machine
      const door = doorOf(bed); // its own farm's shed
      rigs.set(id, { id, job: j.job, field: j.field, vehicle: VEHICLE[j.job], phase: 'walking', x: door[0], y: door[1], door, heading: 0, path: [], passes: null, rowsDone: 0, rowsPassed: new Set(), wait: 0, stopped: 0, ghost: 0, load: j.job === 'supplies', moving: false });
    }
    for (const [id, r] of [...rigs]) {
      try { if (!step(id, r, dt, ctx, items)) rigs.delete(id); }
      catch (err) { rigs.delete(id); ctx.onError?.(err); } // that one machine goes; the rest drive on
    }
    return items;
  }
  const itemOf = (r, driver) => ({ id: r.id, job: r.job, vehicle: r.vehicle, implement: VEHICLE[r.job] === 'tractor' ? r.job : null, load: Boolean(r.load), x: r.x, y: r.y, heading: r.heading, moving: r.moving, driver, phase: r.phase, field: r.field, passRow: r.phase === 'work' ? r.passRow ?? null : null, rowsDone: r.rowsDone ?? 0, rowsPassed: [...(r.rowsPassed ?? [])] });
  return { want, tick, jobs: () => new Map(wanted) };
}

/** What each job is, in the shed's dialog. */
const DOING = { plough: 'ploughing and sowing (a big edit)', sprayer: 'spraying (running tests)', mower: 'mowing (a build)', supplies: 'bringing supplies (an install)', crates: 'taking crates to the stall (a push)', truck: 'driving to town (a deploy)', combine: 'harvesting (a compaction)' };
const WHERE = { walking: 'walking to the shed', out: 'on the way', work: 'at work', home: 'driving home', parked: 'parked' };
/** The machine shed's dialog: the machines out (tick's items), who drives each, doing what, where; a click opens the
 *  farmer. The stock (the loader tractor and the combine) is in the shed. */
export function machinesDialog(items, scene, { esc, title = 'The machine shed', stock = true } = globalThis) {
  const name = id => scene.farmers.find(f => f.id === id)?.name ?? 'a farmer', field = key => scene.fields?.find(f => f.key === key)?.name ?? '';
  const VEH = { tractor: 'the tractor', truck: 'the flatbed truck', combine: 'the combine' };
  const rows = items.filter(i => i.phase !== 'parked').map(i => {
    const what = `${VEH[i.vehicle] ?? i.vehicle}${i.vehicle === 'tractor' ? ` with the ${i.job === 'supplies' || i.job === 'crates' ? 'trailer' : i.job}` : ''}`;
    const how = i.driver || i.phase === 'walking' ? `${esc(DOING[i.job] ?? i.job)}${field(i.field) ? ` in ${esc(field(i.field))}` : ''} · ${esc(WHERE[i.phase] ?? i.phase)}` : 'driving itself home (its farmer was called back)';
    return `<li><button type="button" class="act" data-farm-pick="${esc(i.id)}">Open</button><span><b>${esc(name(i.id))}</b> on ${esc(what)}: ${how}</span></li>`;
  });
  return { title: `${title}: who is out on a machine`, html: `${rows.length ? `<ul class="px-dl">${rows.join('')}</ul>` : '<p class="muted">No machines out just now.</p>'}<p class="muted">${stock ? 'In the shed: the loader tractor and the combine. ' : ''}A farmer takes a machine for a heavy step (tests spray, a build mows, an install brings supplies, a push takes crates to the stall, a deploy drives to town), a big edit ploughs, and a compaction brings in the harvest.</p>` };
}
