// The diary (the sidebar's Farm diary) and the pops over the farm, by the engine's rules (engine.js: sync's arrivals
// and moves, apply's notes between agents, the world's news) in the 2D farm's words (web/worlds/farm/world.js:
// startText, arriveText, zoneText, onMove, setScene's harvests and sales); farm3d-parity.test.mjs pins the words.
import { doing } from './model.js';

/** How long until a time, in short (the 2D farm's): 12m, 2h; a moment. */
export const until = (at, now = Date.now()) => { const m = Math.max(0, (at - now) / 60_000); return m < 1 ? 'a moment' : m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`; };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s); // pixel.js's

/** The words for a farmer reaching a place (its zone), as the 2D farm's zoneText; `fieldName` is its bed's field's. */
export function zoneText(f, z, fieldName) {
  if (z === 'desk') return f.askKind === 'permission' || f.askKind === 'always' ? 'comes up to your porch: needs a permission' : 'comes up to your porch with a question';
  if (z === 'turn') return f.question ? 'comes to your porch with a question' : 'brings a basket of finished work to your porch';
  if (z === 'storage') return 'stands still as a scarecrow (stale)';
  if (z === 'charge') return 'rests under the shade tree (idle)';
  if (z === 'meadow') return 'works in the wild meadow (no repo)';
  if (z === 'nap') return `naps in a hammock until it wakes up by itself${f.wakeAt ? ` at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`;
  return `${doing(f)?.verb ?? 'working'} in the ${fieldName ?? ''} field`;
}

/**
 * The diary as scenes come: update(model, shown, now) → { entries (newest first, eight at most; null when nothing new),
 * pops ([{ id, text, cls }] over a farmer, [{ at: 'stall', text, cls }] at the stall), flights ([{ from, to }]: new
 * notes between two farmers both drawn) }. `shown` is the drawn farmers' ids: the diary tells of what is on the farm.
 */
export function createDiary() {
  let log = [], first = true, zones = new Map(), comps = null, merged = null;
  const seenMail = new Set();
  return {
    update(model, shown, now) {
      const top = log[0], pops = [], flights = [];
      const add = (who, state, text) => { log.unshift({ at: now, state, who, text }); log.length = Math.min(log.length, 8); };
      const all = model.scene.farmers, byId = new Map(all.map(f => [f.id, f])), fieldName = key => model.scene.fields.find(x => x.key === key)?.name;
      for (const m of model.mail ?? []) { // a new note between two farmers: told once (a pigeon carries it when both are drawn)
        const k = `${m.from}>${m.to}@${m.at}`;
        if (seenMail.has(k)) continue;
        seenMail.add(k);
        const from = byId.get(m.from), to = byId.get(m.to);
        if (!from || !to) continue;
        add(from.name, from.state, `sends a note to ${to.name}: ${clip(m.text ?? '', 60)}`);
        if (shown.has(m.from) && shown.has(m.to)) flights.push({ from: m.from, to: m.to });
      }
      const drawn = model.farmers.filter(f => shown.has(f.id));
      if (first && drawn.length) add('', 'working', `Morning: ${drawn.length} farmer${drawn.length === 1 ? '' : 's'} on the farm`);
      const next = new Map();
      for (const f of drawn) {
        const ef = byId.get(f.id) ?? f;
        let prev = zones.get(f.id);
        if (prev === undefined) { if (first) prev = f.zone; else { add(ef.name, ef.state, 'walks out of the barn'); prev = ''; } } // the first ones stand in place
        if (f.zone !== prev) {
          add(ef.name, ef.state, zoneText(ef, f.zone, fieldName(ef.field)));
          if (prev) { // the 2D farm's onMove
            if (f.zone === 'turn') pops.push({ id: f.id, text: 'Done!', cls: 'good' });
            else if (f.zone === 'desk') pops.push({ id: f.id, text: ef.planAsk ? 'A plan for you' : 'Needs you!', cls: 'warn' });
            else if (f.zone === 'storage' || f.zone === 'nap') pops.push({ id: f.id, text: '…zzz', cls: 'dim' });
          }
        }
        next.set(f.id, f.zone);
      }
      zones = next;
      if (first && drawn.length) first = false;
      // the world's news: a harvest (a conversation compacted), a sale (a pull request merged in the last 30 minutes)
      const c = new Map(all.map(f => [f.id, f.compactions ?? 0]));
      if (comps) for (const f of all) if (comps.has(f.id) && c.get(f.id) > comps.get(f.id)) { if (shown.has(f.id)) pops.push({ id: f.id, text: 'Harvest!', cls: 'good' }); add(f.name, f.state, 'brings in the harvest: its conversation was compacted, and it sows again'); }
      comps = c;
      const sold = model.scene.fields.flatMap(fl => (fl.prs?.merged ?? []).map(m => ({ ...m, repo: fl.name, key: `${fl.key}#${m.number}` })));
      if (merged) for (const m of sold) if (!merged.has(m.key) && (m.at ?? 0) > now - 30 * 60_000) { pops.push({ at: 'stall', text: `Sold! #${m.number}`, cls: 'good' }); add('The market', 'turn', `${m.repo}: pull request #${m.number} merged (${clip(m.title ?? '', 50)})`); }
      merged = new Set(sold.map(m => m.key));
      return { entries: log[0] !== top ? log.map(l => ({ ...l })) : null, pops, flights };
    },
  };
}
