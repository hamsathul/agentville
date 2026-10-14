// The farmers on the ground: each walks from where it is to where the model puts it, along the lanes the 2D engine
// uses (route.js), at the farm's pace (40 px a second, 68 in fast mode); a newcomer walks out of the barn door. On the
// porch they stand on the deck, in a field on the soil, by the pond in a hammock. Still (Motion off, or reduced
// motion), or on the first scene, every farmer is simply at its place.
import { BARN_DOOR, BED, CORR, CORR_OF, DECK, W, east } from '../layout.js';
import { landRoute } from '../route.js';
import { DECK_H } from './buildings.js';
import { FIGURE_SCALE } from './figurine.js';
import { SOIL_Y } from './beds.js';

const onDeckAt = (x, y, ox) => x - ox >= DECK.x0 && x - ox <= DECK.x1 && y >= DECK.y0 - 2 && y <= DECK.y1;

/**
 * route(from, to): a way over the farm round what stands on it (roam.js's), for an errand; null when there is none
 * (the lanes then, as walkRoute goes).
 */
export function makeFarmers(THREE, figures, S, { route = () => null } = {}) {
  const group = new THREE.Group();
  const bodies = new Map(); // id → { fig, x, y, path, farmer, face, h, errand }
  let H = 400, beds = [], land = { w: W, ox: 0 }; // land: yours alone, or a neighbour's farm too (its offset)
  /** The lanes and paths of the land, for walkRoute and landRoute: both farms' paths, and the gap between them. */
  const ways = () => ({ corridors: land.ox ? [...CORR, ...CORR_OF(land.ox)] : CORR, gap: land.ox ? [W, land.ox] : null });
  const walk = (from, to, door = null) => landRoute(from, to, ways(), door);
  const wayTo = (b, to) => route([b.x, b.y], to) ?? walk([b.x, b.y], to);
  const onDeck = (x, y) => onDeckAt(x, y, 0) || (land.ox > 0 && onDeckAt(x, y, land.ox));
  const inBed = (x, y) => beds.some(b => x >= b.x0 - 2 && x <= b.x0 + BED.w + 2 && y >= b.y0 - 2 && y <= b.y0 + BED.d + 2);
  const groundAt = (x, y) => (onDeck(x, y) ? DECK_H : inBed(x, y) ? SOIL_Y : 0);

  /** The farmers of a new model. `instant`: no walking (the first scene, or still). */
  function sync(model, { instant }) {
    H = model.ground.H; beds = model.beds; land = model.land ?? { w: W, ox: 0 };
    const seen = new Set();
    let newcomers = 0; // newcomers leave the barn one after another, not in a heap
    for (const f of model.farmers) {
      seen.add(f.id);
      let b = bodies.get(f.id);
      if (!b) {
        const fig = figures.make(f);
        group.add(fig.root);
        const [sx, sy] = instant ? f.at : f.farm ? east(BARN_DOOR, land.ox) : BARN_DOOR; // out of its own farm's barn
        b = { fig, x: sx, y: sy, path: [], face: 0, h: groundAt(sx, sy), target: null, wait: instant ? 0 : 0.45 * newcomers++ };
        bodies.set(f.id, b);
      }
      b.fig.update(f);
      b.farmer = f;
      if (b.errand && f.state !== b.errand.state) endErrand(f.id); // called back: work, or you
      const [tx, ty] = f.at;
      if (!b.target || b.target[0] !== tx || b.target[1] !== ty) {
        b.target = [tx, ty];
        if (instant) { b.x = tx; b.y = ty; b.path = []; b.h = groundAt(tx, ty); b.errand = null; }
        else if (!b.errand) b.path = walk([b.x, b.y], [tx, ty]); // on an errand: it goes there afterwards; over the bridge to the other farm
      }
    }
    for (const [id, b] of bodies) if (!seen.has(id)) { b.fig.dispose(); bodies.delete(id); }
  }
  /** Moves and poses everyone; t is the clock (0 while still), dt the seconds since the last frame. True while someone walks. */
  function tick(t, dt, still) {
    let walking = false;
    for (const b of bodies.values()) {
      const f = b.farmer;
      const seat = b.seat?.();
      b.fig.root.visible = !seat;
      if (seat) { // in a machine's seat (build/machines.js draws it seated): where the machine is, not walking
        [b.x, b.y] = seat.at;
        b.path = [];
        b.fig.root.position.set(seat.x, seat.y - 1.4, seat.z);
        continue;
      }
      if (still && b.path.length) { [b.x, b.y] = b.target; b.path = []; }
      let moving = false;
      if (b.wait > 0) b.wait -= dt;
      else if (b.path.length) {
        moving = true;
        let step = (f.fast ? 68 : 40) * dt;
        while (step > 0 && b.path.length) {
          const [nx, ny] = b.path[0], dx = nx - b.x, dy = ny - b.y, d = Math.hypot(dx, dy);
          if (d <= step) { b.x = nx; b.y = ny; b.path.shift(); step -= d; }
          else { b.x += (dx / d) * step; b.y += (dy / d) * step; b.face = Math.atan2(dx, dy); step = 0; }
        }
      }
      walking ||= moving;
      const e = b.errand;
      if (e && !e.arrived && !b.path.length) { e.arrived = true; if (e.face) b.face = Math.atan2(e.face[0] - b.x, e.face[1] - b.y); }
      if (e && !e.arrived && performance.now() > e.until) endErrand(f.id); // it couldn't get there in time
      // step up onto the deck or into a bed, and down again, smoothly
      const want = groundAt(b.x, b.y);
      b.h += Math.sign(want - b.h) * Math.min(Math.abs(want - b.h), dt * 3 || Math.abs(want - b.h));
      const p = S.at(b.x, b.y, H), fig = b.fig;
      fig.root.position.set(p.x, b.h, p.z);
      // at its place: working farmers turn a little towards their bed's middle; everyone else faces out, towards the lane
      if (!moving && b.errand) { /* there: it faces what it came for */ } else if (!moving) b.face = f.group.startsWith('st:') ? (f.at[0] < (beds.find(x => `st:${x.key}` === f.group)?.cx ?? f.at[0]) ? 0.45 : f.at[0] > (beds.find(x => `st:${x.key}` === f.group)?.cx ?? f.at[0]) ? -0.45 : 0) : 0;
      fig.root.rotation.y = b.face;
      fig.setProp(moving || b.errand ? null : f.prop, f.flag);
      fig.setBadge(f.badge === 'basket' && moving ? null : f.badge, f.thinking);
      const kind = moving ? (f.fast ? 'run' : 'walk') : b.errand ? b.errand.pose : f.scarecrow ? 'scarecrow' : f.nap ? 'nap' : f.state === 'waiting' ? 'wave' : f.badge === 'basket' ? 'basket' : f.state === 'working' ? fig.propPose() ?? 'hold' : 'idle';
      if (fig.pose(kind, still ? 0 : t)) walking = true; // a character just arrived: draw it, still or not
    }
    return walking;
  }
  /** Where a farmer's head is now (for its tag), in metres; null for one not drawn. In a machine: over its seat. */
  function headOf(id) {
    const b = bodies.get(id);
    if (!b) return null;
    const seat = b.seat?.();
    if (seat) return { x: seat.x, y: seat.y + 0.45, z: seat.z };
    const p = b.fig.root.position, top = (b.farmer.nap ? 1.4 : b.farmer.scarecrow ? 2.15 : 1.95) * FIGURE_SCALE;
    return { x: p.x, y: p.y + top, z: p.z };
  }
  /**
   * An errand: the farmer walks to `to` (a 2D point) round what stands in the way, and stays there facing `face`, in
   * `pose`, till endErrand; it gives up if it isn't there in `timeout` s. Its state changing calls it back. `lanes`: by
   * the lanes and paths there and back (a visit to the other farm: over the lane's bridge), not the shortest way round.
   */
  function errand(id, to, { face = null, pose = 'idle', timeout = 20, lanes = false } = {}) {
    const b = bodies.get(id);
    if (!b) return false;
    b.errand = { to, face, pose, lanes, state: b.farmer.state, until: performance.now() + timeout * 1000, arrived: false };
    b.path = lanes ? walk([b.x, b.y], to) : wayTo(b, to);
    return true;
  }
  /** The errand is over: back to its place. */
  function endErrand(id) {
    const b = bodies.get(id);
    if (!b?.errand) return;
    const lanes = b.errand.lanes;
    b.errand = null;
    if (b.target) b.path = lanes ? walk([b.x, b.y], b.target) : wayTo(b, b.target);
  }
  /** Where a farmer is on the 2D map, how high it stands, and whether it is walking; null for one not drawn. */
  function posOf(id) {
    const b = bodies.get(id);
    return b ? { x: b.x, y: b.y, tx: b.target?.[0], ty: b.target?.[1], h: b.h, moving: b.path.length > 0 && !(b.wait > 0) } : null; // tx, ty: where it is going
  }
  return {
    group, sync, tick, headOf, posOf, errand, endErrand,
    /** A farmer drives: `seat()` says where its seat is ({ x, y, z } its head in metres, `at` the machine on the 2D map),
     *  or null; its body hides while it sits in the machine. null gets it out, where the machine is. */
    setDriving(id, seat) {
      const b = bodies.get(id);
      if (!b) return;
      if (b.seat && !seat && !b.errand && b.target) b.path = wayTo(b, b.target); // out of the machine, its errand over: back to its place
      b.seat = seat ?? null;
    },
    driving: id => Boolean(bodies.get(id)?.seat),
    onErrand: id => Boolean(bodies.get(id)?.errand),
    arrived: id => Boolean(bodies.get(id)?.errand?.arrived),
    /** What it does where its errand took it (idle; nap beside an animal). */
    setPose(id, pose) { const e = bodies.get(id)?.errand; if (e) e.pose = pose; },
    /** How high the ground is at a 2D point: the deck, a bed's soil, or the ground (for what walks with a farmer). */
    groundAt: (x, y) => groundAt(x, y),
    hits: () => [...bodies.values()].filter(b => !b.seat).map(b => b.fig.root), // one driving: its machine is hit instead
    select(id) { for (const [k, b] of bodies) b.fig.setSelected(k === id); },
    count: () => bodies.size,
    /** A farmer's character, what it plays and its shirt (for the check); null while its figurine stands in. */
    info: id => bodies.get(id)?.fig.info() ?? null,
  };
}
