/**
 * The plan's usage (the 5-hour and weekly limits, as Claude Code's status line has them), from the
 * session that talked to the API last: every API response brings the account's current windows,
 * so the most recent session has the freshest reading. A window past its reset time reads as reset.
 * Readings: [{ id, lastActivityAt, rateLimits: [{ kind, percentUsed, resetsAt }] }].
 */
export function planUsage(readings, now = Date.now()) {
  const best = readings.filter(r => r.rateLimits?.length).sort((x, y) => (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0))[0];
  if (!best) return null;
  return {
    from: best.id,
    at: best.lastActivityAt ?? null,
    windows: best.rateLimits.map(w => (w.resetsAt != null && w.resetsAt <= now ? { kind: w.kind, percentUsed: 0, resetsAt: null, reset: true } : w)),
  };
}

/**
 * Every mod's last usage reading, open sessions and ended ones (a beacon file stays after its
 * session): an open session's reading is as fresh as its last activity, an ended one's as its
 * last beacon.
 */
export function planReadings(beacons, agents) {
  return [...beacons].flatMap(([id, b]) => {
    if (!b.usage?.rateLimits?.length) return [];
    const a = agents.find(x => x.id === id);
    return [{ id, lastActivityAt: b.live && a?.lastActivityAt ? a.lastActivityAt : b.at, rateLimits: b.usage.rateLimits }];
  });
}
