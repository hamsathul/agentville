// Visits between the two farms (spec 2026-10-14 neighbour §9): with a second Claude account's farm next door, now and
// then an idle farmer on one farm walks over the bridge to an idle farmer on the other, they talk, and it walks home.
// The first no sooner than 2 minutes after the farm opens, then at least 4 minutes apart (and a random 0–4 more), one
// at a time; it ends at once when either stops being idle, goes, is followed or napping, the neighbour farm goes, or
// Motion goes off. Pure: no three.js, no clock of its own (app.js gives it the time, walks the guest and starts the talk).
export const VISIT_FIRST_MS = 120_000, VISIT_GAP_MS = 240_000, VISIT_JITTER_MS = 240_000, VISIT_TALK_MS = 8000, VISIT_NEAR = 12;
/** Free for a visit: idle (not napping, not stale), on no errand, not followed. */
const free = f => f.state === 'idle' && !f.nap && !f.errand && !f.followed;

export function createVisits({ rand = Math.random } = {}) {
  let next = null, visit = null; // visit: { guest, host, talkUntil (null till the guest is there) }
  const end = () => { const guest = visit.guest; visit = null; return { end: guest }; };
  return {
    /**
     * The visit now, or a new one. ctx: { now (ms, a steady clock), still, neighbour (a neighbour farm or not), farmers:
     * [{ id, farm, state, nap, at: [x, y], errand, followed }] }. Returns {} or { start: { guest, host, to, face } }
     * (the guest walks to `to`, 1.5 m from its host, and faces it) or { end: guest } (the guest goes home).
     */
    tick({ now, still, neighbour, farmers }) {
      next ??= now + VISIT_FIRST_MS;
      if (visit) {
        const by = id => farmers.find(f => f.id === id), g = by(visit.guest), h = by(visit.host);
        if (still || !neighbour || !g || !h || g.state !== 'idle' || g.nap || g.followed || !free(h)) return end();
        if (visit.talkUntil !== null && now >= visit.talkUntil) return end();
        return {};
      }
      if (still || !neighbour || now < next) return {};
      const pool = farmers.filter(free), mine = pool.filter(f => !f.farm), theirs = pool.filter(f => f.farm);
      if (!mine.length || !theirs.length) { next = now + 30_000; return {}; } // no pair: look again in a while
      const fromYours = rand() < 0.5, guests = fromYours ? mine : theirs, hosts = fromYours ? theirs : mine;
      const guest = guests[Math.floor(rand() * guests.length) % guests.length], host = hosts[Math.floor(rand() * hosts.length) % hosts.length];
      const side = guest.farm ? 1 : -1; // it stands on the side it came from
      visit = { guest: guest.id, host: host.id, talkUntil: null };
      next = now + VISIT_GAP_MS + rand() * VISIT_JITTER_MS;
      return { start: { guest: guest.id, host: host.id, to: [host.at[0] + side * VISIT_NEAR, host.at[1]], face: host.at } };
    },
    /** The guest is there: they talk for `ms` (VISIT_TALK_MS at least), then it goes home. */
    arrived(now, ms) { if (visit && visit.talkUntil === null) visit.talkUntil = now + Math.max(VISIT_TALK_MS, ms); },
    /** The visit under way: { guest, host, talkUntil }, or null. */
    now: () => (visit ? { ...visit } : null),
    /** The visit is dropped: its guest's walk was cut short (it couldn't get there in time, or isn't drawn). */
    cancel() { visit = null; },
    /** The next visit as soon as there is a pair (the check). */
    force() { next = -Infinity; },
  };
}
