// A field's season (spec §6), kept from scene to scene from its agents' work: fallow; ploughed when an agent starts
// work there; sown on its first write; growing as context fills (the 2D farm's growth stages); ripe at stage 5;
// sprayed while one of its agents runs tests; cut at a compaction (row by row as the combine passes, `cut`) and sown
// again; weeds after 30 idle minutes; dry when its agents are all stale. A field already growing when the page opens
// grows on: the ploughing isn't replayed. A plough passing (`plough`) furrows it row by row and its drill sows it.
// Pure: no three.js, no clock of its own.
export const IDLE_FALLOW_MS = 30 * 60_000, CUT_HOLD_MS = 30_000, ROWS = 6;
const WRITES = new Set(['hoe', 'seeds']); // the edit and write steps' tools (model.js ACTIONS)

export function createSeasons() {
  const fields = new Map();
  let first = true;
  const lookOf = key => {
    const r = fields.get(key);
    return r ? { stage: r.stage, growth: r.growth, sprayed: r.sprayed, cutRows: r.cutRows, ploughedRows: r.ploughedRows } : null;
  };
  /** The fields' looks for a model (model.js farmModel) at a time: Map(key → look). */
  function update(model, now) {
    const comps = new Map((model.scene?.farmers ?? []).map(f => [f.id, f.compactions ?? 0]));
    for (const b of model.beds) {
      const here = model.farmers.filter(f => f.field === b.key), working = here.filter(f => f.state === 'working'), grow = b.plot.kind === 'grow';
      let r = fields.get(b.key);
      if (!r) {
        const growing = first && grow; // the page opens on it already at work
        r = { stage: 'fallow', worked: growing, sown: growing, lastActive: now, cutAt: null, cutRows: 0, ploughedRows: ROWS, comps: new Map(), growth: 0, sprayed: false };
        fields.set(b.key, r);
      }
      if (working.length) r.lastActive = now;
      for (const f of here) { // a compaction: the harvest
        const c = comps.get(f.id) ?? 0, was = r.comps.get(f.id);
        if (was !== undefined && c > was) Object.assign(r, { cutAt: now, cutRows: 0, cutGrowth: r.growth }); // the crop as it stood
        r.comps.set(f.id, c);
      }
      if (!r.worked && working.length) r.worked = true;
      if (r.worked && !r.sown && working.some(f => WRITES.has(f.prop))) r.sown = true;
      r.growth = grow ? b.plot.stage : 0;
      r.sprayed = working.some(f => f.prop === 'magnifier'); // test: checking the crops
      if (b.plot.kind === 'dry') { r.stage = 'dry'; continue; }
      if (!working.length && now - r.lastActive >= IDLE_FALLOW_MS) { Object.assign(r, { worked: false, sown: false, stage: 'fallow', cutAt: null, cutRows: 0 }); continue; }
      if (r.cutAt !== null && now - r.cutAt < CUT_HOLD_MS && (r.cutRows < ROWS || now - r.cutAt < 1000)) { Object.assign(r, { stage: 'cut', growth: r.cutGrowth }); continue; } // the rows not yet cut as they stood
      if (r.cutAt !== null) Object.assign(r, { cutAt: null, cutRows: 0 }); // cut, or the combine never came: sown again
      r.stage = !r.worked ? 'fallow' : !r.sown ? 'ploughed' : grow && b.plot.stage >= 5 ? 'ripe' : grow && b.plot.stage > 0 ? 'growing' : 'sown';
    }
    for (const k of [...fields.keys()]) if (!model.beds.some(b => b.key === k)) fields.delete(k);
    first = false;
    return new Map([...fields.keys()].map(k => [k, lookOf(k)]));
  }
  return {
    update,
    lookOf,
    /** The combine has cut this many of the field's rows. */
    cut(key, rows) { const r = fields.get(key); if (r && r.cutAt !== null) r.cutRows = Math.max(r.cutRows, Math.min(ROWS, rows)); },
    /** A plough has furrowed this many of the field's rows (0 as it starts); at six its drill has sown the field. */
    plough(key, rows) {
      const r = fields.get(key);
      if (!r) return;
      r.ploughedRows = Math.max(0, Math.min(ROWS, rows));
      if (r.ploughedRows >= ROWS && r.worked) r.sown = true;
    },
  };
}

/**
 * What each of a bed's six rows shows for its look (build/beds.js draws it): furrowed soil or not, and its plants:
 * 'crop' (the bed's crop at `stage`), 'seeds', 'stubble', 'weeds', 'dry' or none; `wet` while it is sprayed. Behind a
 * plough passing (rows below `ploughedRows`), furrows and the drill's seeds; behind the combine (below `cutRows`),
 * stubble; the rest as they were. Without a look (the season not kept yet), the plot's, as the 2D farm draws it.
 */
export function rowsOf(bed, look) {
  const row = (furrow, plants, stage = 0, wet = false) => ({ furrow, plants, stage, wet });
  const plot = bed.plot, all = f => Array.from({ length: ROWS }, (_, k) => f(k));
  if (!look) return all(() => (plot.kind === 'grow' ? row(false, 'crop', plot.stage) : plot.kind === 'dry' ? row(false, 'dry') : row(false, 'weeds')));
  const wet = look.sprayed, crop = () => row(false, 'crop', look.growth, wet);
  switch (look.stage) {
    case 'dry': return all(() => row(false, 'dry'));
    case 'fallow': return all(() => row(false, 'weeds'));
    case 'ploughed': return all(k => (k < look.ploughedRows ? row(true, null) : row(false, 'weeds')));
    case 'sown': return all(() => row(true, 'seeds', 0, wet));
    case 'cut': return all(k => (k < look.cutRows ? row(false, 'stubble') : crop()));
    default: return all(k => (k < look.ploughedRows && look.ploughedRows < ROWS ? row(true, 'seeds', 0, wet) : crop())); // growing, ripe
  }
}
