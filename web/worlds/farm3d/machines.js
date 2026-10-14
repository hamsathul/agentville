// The farmers' machines (spec 2026-10-14 §7), by rule: which machine a farmer's step needs, how long it stays out,
// the passes it drives over a field, its way there and back, and where each is from moment to moment. A farmer whose
// step needs one walks to the machine shed, climbs in, drives the lane and the walkway to its field (or to the stall,
// or off to town), works, and drives home again; with Motion off each stands at its work spot. Pure: no three.js, no
// clock of its own. build/machines.js draws them; app.js sends the farmers to the shed and tells this who has boarded.
import { BED, CORR, LANE, LANE_HALF, SHED_DOOR, STALL, W } from './layout.js';

export const HOLD_S = 20; // a machine stays out this long after its step ends, so it doesn't flicker
export const BIG_EDIT = 5; // distinct files written in the last 5 minutes (scene `writes`) that make an edit a big one
export const VEHICLE = { plough: 'tractor', sprayer: 'tractor', mower: 'tractor', supplies: 'tractor', crates: 'tractor', truck: 'truck', combine: 'combine' };
export const TOWN_END = [W - 24, LANE]; // where the truck stands with Motion off: the lane's end, by the road to town
const TOWN = [W + 40, LANE]; // off the map, in town
const PASS_JOBS = new Set(['plough', 'sprayer', 'mower', 'combine']); // the ones that drive over the field
const ROAD = 48, FIELD = 24; // px a second: on the lane and the walkways, and in a field
const ROW0 = 6, ROW = 12, ROWS = 6, TURN = 12; // a bed's first row, the rows' spacing, how many, and the headland's width
const WAIT_S = 3; // loading or unloading
const STOP_S = 5, GHOST_S = 3; // stopped this long, it passes through what is ahead for this long

/** The machine a farmer's step needs, or null (by hand): tests spray, builds mow, installs bring supplies, pushes take
 *  crates to the stall, deploys drive to town; an edit or write of 5 files or more ploughs (and sows). Only at work, and
 *  in a field. */
export function machineFor(f) {
  if (f.state !== 'working' || !f.field) return null;
  return { test: 'sprayer', build: 'mower', install: 'supplies', push: 'crates', deploy: 'truck' }[f.step] ?? ((f.step === 'edit' || f.step === 'write') && f.writes >= BIG_EDIT ? 'plough' : null);
}

/** The passes over a bed for farmer k of n working it (each takes every n-th row): points [x, y] on the 2D map, along
 *  its rows and U-turning 12 px outside its ends, from the walkway side (column 0's walkway is on its right, the
 *  others' on their left). */
export function passesFor(bed, n = 1, k = 0) {
  const fromRight = bed.cx < CORR[1], near = fromRight ? bed.x0 + BED.w + TURN : bed.x0 - TURN, far = fromRight ? bed.x0 - TURN : bed.x0 + BED.w + TURN;
  const pts = [];
  let flip = false;
  for (let row = k; row < ROWS; row += Math.max(1, n)) {
    const y = bed.y0 + ROW0 + row * ROW;
    pts.push([flip ? far : near, y], [flip ? near : far, y]);
    flip = !flip;
  }
  return pts;
}

/** A machine's way between two places, as the carts go: onto the lane (up the walkway nearest), along it, then down
 *  the walkway nearest the place, and over to it. `lane`: the y it keeps to (its half of the lane). */
export function routeBetween([x, y], [tx, ty], { lane = LANE, corr = CORR } = {}) {
  const near = v => corr.reduce((best, c) => (Math.abs(v - c) < Math.abs(v - best) ? c : best));
  const onLane = v => Math.abs(v - LANE) <= LANE_HALF;
  const pts = [];
  if (onLane(y)) pts.push([x, lane]);
  else { const c = y < LANE ? x : near(x); if (y > LANE) pts.push([c, y]); pts.push([c, lane]); }
  if (onLane(ty)) pts.push([tx, lane], [tx, ty]);
  else { const c = ty < LANE ? tx : near(tx); pts.push([c, lane]); if (ty > LANE) pts.push([c, ty]); pts.push([tx, ty]); }
  return pts.filter((p, i) => { const q = i ? pts[i - 1] : [x, y]; return p[0] !== q[0] || p[1] !== q[1]; });
}

/**
 * The machines from moment to moment. `want(model, nowS, compacted)` (each scene) says which farmers want which machine
 * (`compacted`: the ids whose agent compacted since the last scene: the combine); `tick(dt, ctx)` (each frame) moves
 * them and returns what to draw. ctx: { farmers: Map(id → { x, y, state, field }) of the farmers drawn, beds: Map(key →
 * bed), boarded(id): its farmer is in the seat, blocked(x, y, heading, id): something within 3 m ahead, still: Motion off }.
 */
export function createMachines() {
  const jobs = new Map(); // id → { job, field, lastNeeded (s), combine: the combine's one round of its field }
  const rigs = new Map(); // id → the machine out for that farmer
  let wanted = new Map();

  function want(model, nowS, compacted = new Set()) {
    const seen = new Set();
    for (const f of model.farmers ?? []) {
      seen.add(f.id);
      let j = jobs.get(f.id);
      if (f.state !== 'working') { jobs.delete(f.id); continue; } // waiting on you, your turn, idle: called straight back
      if (compacted.has(f.id) && f.field) { j = { job: 'combine', field: f.field, lastNeeded: nowS, combine: true }; jobs.set(f.id, j); continue; }
      if (j?.combine) continue; // the combine works its field once, whatever the steps do
      const need = machineFor(f);
      if (need) jobs.set(f.id, { job: need, field: f.field, lastNeeded: nowS, combine: false });
      else if (j && nowS - j.lastNeeded >= HOLD_S) jobs.delete(f.id);
    }
    for (const id of [...jobs.keys()]) if (!seen.has(id)) jobs.delete(id);
    wanted = new Map([...jobs].map(([id, j]) => [id, { job: j.job, field: j.field }]));
    return wanted;
  }

  const spotOf = (job, bed, n, k) => (job === 'crates' ? [STALL.x + 14, LANE] : job === 'truck' ? TOWN : passesFor(bed, n, k)[0]);
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
    r.path = routeBetween([r.x, r.y], SHED_DOOR, { lane: LANE - 3 });
    r.wait = 0;
  }
  /** Sets a machine off from where it is to its job's place. */
  function setOff(r, ctx, j) {
    const bed = ctx.beds.get(j.field);
    r.job = j.job; r.field = j.field; r.vehicle = VEHICLE[j.job]; r.phase = 'out'; r.rowsDone = 0; r.wait = 0; r.load = j.job === 'supplies'; r.empty = false; r.toStall = false; r.done = false;
    const firstStop = j.job === 'truck' ? TOWN : passesFor(bed, 1, 0)[0]; // crates are loaded at the field first
    r.path = routeBetween([r.x, r.y], firstStop, { lane: LANE + 3 });
    r.passes = null;
  }

  function tick(dt, ctx) {
    const items = [];
    // farmers working passes in the same field share its rows
    const crews = new Map();
    for (const [id, j] of wanted) if (PASS_JOBS.has(j.job)) { if (!crews.has(j.field)) crews.set(j.field, []); crews.get(j.field).push(id); }
    for (const list of crews.values()) list.sort();
    const crewOf = (id, field) => { const list = crews.get(field) ?? [id]; return [list.length, Math.max(0, list.indexOf(id))]; };

    for (const [id, j] of wanted) if (!rigs.has(id)) {
      const bed = ctx.beds.get(j.field), farmer = ctx.farmers.get(id);
      if (!bed || !farmer) continue; // no field to work, or its farmer not drawn: no machine
      rigs.set(id, { id, job: j.job, field: j.field, vehicle: VEHICLE[j.job], phase: 'walking', x: SHED_DOOR[0], y: SHED_DOOR[1], heading: 0, path: [], passes: null, rowsDone: 0, wait: 0, stopped: 0, ghost: 0, load: j.job === 'supplies', moving: false });
    }

    for (const [id, r] of [...rigs]) {
      const j = wanted.get(id), farmer = ctx.farmers.get(id), bed = ctx.beds.get(r.field);
      const keep = j && farmer && ctx.beds.has(j.field);
      r.moving = false;

      if (ctx.still) { // Motion off: at its work spot, its farmer in the seat; nothing moves
        if (!keep) { rigs.delete(id); continue; }
        const [n, k] = crewOf(id, j.field);
        [r.x, r.y] = j.job === 'truck' ? TOWN_END : spotOf(j.job, ctx.beds.get(j.field), n, k);
        Object.assign(r, { job: j.job, field: j.field, vehicle: VEHICLE[j.job], phase: 'work', path: [], passes: null, passRow: null, load: j.job === 'supplies' || j.job === 'crates' });
        items.push(itemOf(r, true));
        continue;
      }

      if (r.phase === 'walking') { // in the shed, its farmer on the way
        if (!keep) { rigs.delete(id); continue; }
        if (ctx.boarded(id)) setOff(r, ctx, j);
        else { items.push(itemOf(r, false)); continue; }
      } else if (r.phase === 'parked') { rigs.delete(id); continue; } // parked last frame: its farmer released
      else if (r.phase !== 'home') {
        if (!keep) goHome(r, !farmer || farmer.state !== 'working'); // called back or gone: its farmer gets out; its hold over, or its field gone: it drives home
        else if (j.field !== r.field || VEHICLE[j.job] !== r.vehicle) goHome(r); // another field, or another vehicle: home first
        else if (j.job !== r.job) { // another tractor job: the implement swaps in place, and it goes where that job goes
          r.job = j.job; r.load = j.job === 'supplies'; r.rowsDone = 0; r.wait = 0; r.passes = null; r.toStall = false;
          r.phase = 'out'; r.path = routeBetween([r.x, r.y], passesFor(bed, 1, 0)[0], { lane: LANE + 3 });
        }
      } else if (keep && !r.empty && r.vehicle === VEHICLE[j.job] && r.field === j.field && !r.done) { // wanted again on the way home: back out
        r.job = j.job; setOff(r, ctx, j);
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
        if (!r.path.length) {
          r.phase = 'work'; r.wait = 0;
        }
      } else if (r.phase === 'work') {
        if (PASS_JOBS.has(r.job)) {
          const [n, k] = crewOf(id, r.field);
          if (!r.passes || r.crew !== `${n}|${k}`) { r.crew = `${n}|${k}`; r.passes = passesFor(bed, n, k); r.path = [...r.passes]; r.rowsDone = 0; r.passRows = r.passes.length / 2; }
          r.moving = moveBy(FIELD);
          r.rowsDone = Math.min(r.passRows, Math.floor((r.passes.length - r.path.length) / 2)); // a row is done at the far end of its pass
          r.passRow = Math.max(0, Math.min(ROWS - 1, Math.round(((r.path[0] ?? r.passes.at(-1))[1] - bed.y0 - ROW0) / ROW))); // the row it is on, or turning to
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
            if (r.wait >= WAIT_S) { r.load = true; r.toStall = true; r.path = routeBetween([r.x, r.y], [STALL.x + 14, LANE], { lane: LANE + 3 }); }
          } else if (r.path.length) r.moving = moveBy(ROAD);
          else { r.wait += dt; if (r.wait >= 2 * WAIT_S) r.load = false; }
        } // the truck waits in town while the deploy runs
      } else if (r.phase === 'home') {
        r.passRow = null;
        r.moving = moveBy(ROAD);
        if (!r.path.length) { r.phase = 'parked'; r.toStall = false; }
      }
      // parked with its farmer still in the seat and a job wanted (another vehicle, another field): off again at once
      if (r.phase === 'parked' && keep && !r.empty) setOff(r, ctx, j);
      items.push(itemOf(r, driver));
    }
    return items;
  }
  const itemOf = (r, driver) => ({ id: r.id, job: r.job, vehicle: r.vehicle, implement: VEHICLE[r.job] === 'tractor' ? r.job : null, load: Boolean(r.load), x: r.x, y: r.y, heading: r.heading, moving: r.moving, driver, phase: r.phase, field: r.field, passRow: r.phase === 'work' ? r.passRow ?? null : null, rowsDone: r.rowsDone ?? 0 });
  return { want, tick, jobs: () => new Map(wanted) };
}
