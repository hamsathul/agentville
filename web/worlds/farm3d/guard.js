// Each piece of the 3D farm's frame (the hens, the carts, the pigeons, the plays, the romps, the minimap…) runs on its
// own: one that throws is reported once (to the page, through the bridge) and skipped, and the farm carries on.

/** g(where, fn) runs fn and returns what it returns; if it throws, `report(err, where)` once for that place, and undefined. */
export function guarded(report) {
  const told = new Set();
  return (where, fn) => {
    try { return fn(); } catch (err) {
      if (!told.has(where)) { told.add(where); report(err, where); }
      return undefined;
    }
  };
}
