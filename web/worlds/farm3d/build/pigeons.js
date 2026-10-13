// Pigeons between agents (the engine's flights, in 3D): each new note from one farmer to another (scene.mail, the
// diary tells which) flies as a grey pigeon from the sender's head to the receiver's in 2.4 s, on an arc, wings
// flapping, a sealed letter under it; when it lands a "✉" pops over the receiver. One whose sender or receiver has
// gone (or is hidden) is dropped; none fly while the farm stands still.

const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const FLIGHT_S = 2.4, ARC = 4; // seconds a flight takes; metres it rises over the middle

/** Where a pigeon is, t (0 to 1) of the way from a to b (points in the world): eased along, on an arc ARC m high. */
export function flightAt(t, a, b) {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const k = ease(t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k + Math.sin(Math.PI * t) * ARC, z: a.z + (b.z - a.z) * k };
}

export function makePigeons(THREE, mats) {
  const group = new THREE.Group(), flights = [];
  const geo = { body: new THREE.SphereGeometry(0.18, 10, 8), head: new THREE.SphereGeometry(0.09, 8, 6), beak: new THREE.ConeGeometry(0.03, 0.08, 5), wing: new THREE.BoxGeometry(0.3, 0.02, 0.13), letter: new THREE.BoxGeometry(0.16, 0.02, 0.11), seal: new THREE.SphereGeometry(0.025, 6, 4) };
  const mat = { grey: mats.std('#9aa4ad'), head: mats.std('#7a8794'), neck: mats.std('#5f8f7a'), beak: mats.std('#e58a2e'), paper: mats.std('#fbf6ea'), seal: mats.std('#d64545') };
  /** One pigeon, flying along +z, its wings on pivots so they flap. */
  function makePigeon() {
    const g = new THREE.Group(), add = (gm, m, x, y, z, parent = g) => { const o = new THREE.Mesh(gm, m); o.position.set(x, y, z); parent.add(o); return o; };
    add(geo.body, mat.grey, 0, 0, 0).scale.set(0.9, 0.8, 1.3);
    add(geo.head, mat.head, 0, 0.13, 0.2);
    add(geo.head, mat.neck, 0, 0.06, 0.15).scale.setScalar(0.8);
    add(geo.beak, mat.beak, 0, 0.12, 0.3).rotation.x = Math.PI / 2;
    const wings = [-1, 1].map(side => { const pivot = new THREE.Group(); pivot.position.set(side * 0.1, 0.05, 0); add(geo.wing, mat.grey, side * 0.15, 0, 0, pivot); g.add(pivot); return { pivot, side }; });
    add(geo.letter, mat.paper, 0, -0.17, 0.02);
    add(geo.seal, mat.seal, 0, -0.155, 0.02);
    g.userData.wings = wings;
    g.scale.setScalar(1.4);
    return g;
  }
  return {
    group,
    /** A note from one farmer to another: a pigeon sets off. */
    launch(from, to) { const obj = makePigeon(); group.add(obj); flights.push({ from, to, t: 0, obj }); },
    /**
     * Moves the pigeons on (headOf: a farmer's head in the world, or null); returns the farmers that just got their
     * note (a ✉ pops over each). Still, they are put away.
     */
    tick(dt, headOf, still) {
      const landed = [];
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i], a = headOf(f.from), b = headOf(f.to);
        f.t += dt / FLIGHT_S;
        if (still || !a || !b || f.t >= 1) { // there, or no one to fly between
          if (f.t >= 1 && a && b && !still) landed.push(f.to);
          f.obj.removeFromParent();
          flights.splice(i, 1);
          continue;
        }
        const p = flightAt(f.t, a, b), q = flightAt(Math.min(1, f.t + 0.02), a, b);
        f.obj.position.set(p.x, p.y + 0.3, p.z);
        f.obj.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
        const flap = Math.sin(f.t * FLIGHT_S * 24) * 0.8;
        for (const w of f.obj.userData.wings) w.pivot.rotation.z = w.side * flap;
      }
      return landed;
    },
    /** How many are in the air (for the check). */
    count: () => flights.length,
  };
}
