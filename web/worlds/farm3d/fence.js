// The task fence (spec 2026-10-15 alive §3): an agent's task list as stakes along the front of its field, one per task
// (20 at most: past that a stake stands for several), a flag on each done one in the agent's colour, a lantern on the
// first not done while it works. A row per agent in the field, three at most. Pure: build/fence.js draws it.
export const FENCE_MAX = 20, FENCE_STEP = 6, FENCE_ROWS = 3;

/**
 * The stakes for the drawn farmers (the model's: field, state, shirt, scarecrow) on the beds, their task lists from the
 * scene's farmers (tasks: { done, total }): [{ key (the bed's), x, y, done, lantern, colour }].
 */
export function fenceOf(beds, farmers, sceneFarmers) {
  const byKey = new Map(beds.map(b => [b.key, b])), tasksOf = new Map(sceneFarmers.map(f => [f.id, f.tasks])), rowsUsed = new Map(), out = [];
  for (const f of [...farmers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const bed = byKey.get(f.field), t = tasksOf.get(f.id);
    if (!bed || f.scarecrow || !t || !(t.total >= 1)) continue;
    const row = rowsUsed.get(bed.key) ?? 0;
    if (row >= FENCE_ROWS) continue;
    rowsUsed.set(bed.key, row + 1);
    const per = t.total > FENCE_MAX ? Math.ceil(t.total / FENCE_MAX) : 1, n = Math.ceil(t.total / per), done = Math.max(0, Math.min(t.done ?? 0, t.total));
    let reached = false; // the first stake not done: its lantern, while the agent works
    for (let j = 0; j < n; j++) {
      const isDone = done >= Math.min(t.total, (j + 1) * per), lantern = !isDone && !reached && f.state === 'working';
      if (!isDone) reached = true;
      out.push({ key: bed.key, x: bed.x0 + 4 + j * FENCE_STEP, y: bed.y0 + bed.d + 3 + row * 4, done: isDone, lantern, colour: f.shirt });
    }
  }
  return out;
}
