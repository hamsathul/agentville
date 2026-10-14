// A field's season (spec §6), kept from scene to scene from its agents' work: fallow; ploughed when an agent starts
// work there; sown on its first write; growing as context fills (the 2D farm's growth stages); ripe at stage 5;
// sprayed while one of its agents runs tests; cut at a compaction (row by row as the combine passes, `cut`) and sown
// again; weeds after 30 idle minutes; dry when its agents are all stale. A field already growing when the page opens
// grows on: the ploughing isn't replayed. A plough passing (`plough`) turns its rows one by one and its drill sows it.
// Pure: no three.js, no clock of its own (the times it is given need only be steady, not the wall clock's).
export const IDLE_FALLOW_MS = 30 * 60_000, ROWS = 6;
export const CUT_WAIT_MS = 30_000, CUT_IDLE_MS = 10_000, CUT_SHOW_MS = 1000; // a harvest waits this long for its combine, which reports at least this often; the last row's stubble shows a moment
const WRITES = new Set(['hoe', 'seeds']); // the edit and write steps' tools (model.js ACTIONS)

export function createSeasons() {
  const fields = new Map();
  let first = true, clock = 0; // the last time it was told
  const lookOf = key => {
    const r = fields.get(key);
    return r ? { stage: r.stage, growth: r.stage === 'cut' ? r.cutGrowth : r.growth, sprayed: r.sprayed, cutRows: r.cutRows, ploughed: r.ploughed } : null; // being cut: the rows not yet cut as they stood
  };
  /** Whether a field is being harvested: its combine on the way or cutting (heard from in the last 10 s), waited for (30 s
   *  after the compaction), or its last row just cut (a moment of stubble). */
  const harvesting = (r, now) => r.cutAt !== null && (r.cutRows >= ROWS ? now - r.cutDoneAt < CUT_SHOW_MS : now - r.cutAt < CUT_WAIT_MS || now - r.cutLast < CUT_IDLE_MS);
  /** Its stage at a time: cut while harvested, else the season its work gives. True if that changed. */
  function settle(r, now) {
    if (r.cutAt !== null && !harvesting(r, now)) Object.assign(r, { cutAt: null, cutRows: 0 }); // cut, or the combine never came: sown again
    const stage = r.cutAt !== null ? 'cut' : r.base, changed = stage !== r.stage;
    r.stage = stage;
    return changed;
  }
  /** The fields' looks for a model (model.js farmModel) at a time: Map(key → look). */
  function update(model, now) {
    clock = now;
    const comps = new Map((model.scene?.farmers ?? []).map(f => [f.id, f.compactions ?? 0]));
    for (const b of model.beds) {
      const here = model.farmers.filter(f => f.field === b.key), working = here.filter(f => f.state === 'working'), grow = b.plot.kind === 'grow';
      let r = fields.get(b.key);
      if (!r) {
        const growing = first && grow; // the page opens on it already at work
        r = { stage: 'fallow', base: 'fallow', worked: growing, sown: growing, lastActive: now, cutAt: null, cutRows: 0, ploughed: 0, comps: new Map(), growth: 0, sprayed: false };
        fields.set(b.key, r);
      }
      if (working.length) r.lastActive = now;
      for (const f of here) { // a compaction: the harvest
        const c = comps.get(f.id) ?? 0, was = r.comps.get(f.id);
        if (was !== undefined && c > was) Object.assign(r, { cutAt: now, cutRows: 0, cutLast: -Infinity, cutDoneAt: Infinity, cutGrowth: r.growth, ploughed: 0 }); // the crop as it stood; a new season's soil
        r.comps.set(f.id, c);
      }
      if (!r.worked && working.length) r.worked = true;
      if (r.worked && !r.sown && working.some(f => WRITES.has(f.prop))) r.sown = true;
      r.growth = grow ? b.plot.stage : 0;
      r.sprayed = working.some(f => f.prop === 'magnifier'); // test: checking the crops
      if (b.plot.kind === 'dry') { Object.assign(r, { base: 'dry', cutAt: null, cutRows: 0 }); settle(r, now); continue; }
      if (!working.length && now - r.lastActive >= IDLE_FALLOW_MS) { Object.assign(r, { worked: false, sown: false, base: 'fallow', cutAt: null, cutRows: 0, ploughed: 0 }); settle(r, now); continue; }
      r.base = !r.worked ? 'fallow' : !r.sown ? 'ploughed' : grow && b.plot.stage >= 5 ? 'ripe' : grow && b.plot.stage > 0 ? 'growing' : 'sown';
      settle(r, now);
    }
    for (const k of [...fields.keys()]) if (!model.beds.some(b => b.key === k)) fields.delete(k);
    first = false;
    return new Map([...fields.keys()].map(k => [k, lookOf(k)]));
  }
  return {
    update,
    lookOf,
    /** Every field's look, by its key. */
    looks: () => new Map([...fields.keys()].map(k => [k, lookOf(k)])),
    /** The combine has cut this many of the field's rows (0 on its way), heard at a time (the last one it was told). True
     *  if that changed its look. Nothing to cut without a harvest under way. */
    cut(key, rows, now = clock) {
      const r = fields.get(key);
      if (!r || r.cutAt === null) return false;
      const was = r.cutRows;
      r.cutRows = Math.max(r.cutRows, Math.min(ROWS, rows));
      r.cutLast = now;
      if (r.cutRows >= ROWS && r.cutDoneAt === Infinity) r.cutDoneAt = now;
      return r.cutRows !== was;
    },
    /** Between scenes: a harvest over (its combine done, gone quiet, or never come) leaves its field sown. True if any
     *  field's look changed. */
    tick(now) {
      clock = now;
      let changed = false;
      for (const r of fields.values()) changed = settle(r, now) || changed;
      return changed;
    },
    /** A plough has passed these rows (their numbers, 0 to 5, any order); they stay turned till a harvest or the field
     *  lies fallow. Once all six are turned its drill has sown the field. True if that changed its look. */
    plough(key, rows) {
      const r = fields.get(key);
      if (!r) return false;
      const was = r.ploughed;
      for (const k of rows) if (k >= 0 && k < ROWS) r.ploughed |= 1 << k;
      if (r.ploughed === (1 << ROWS) - 1 && r.worked && !r.sown) { r.sown = true; r.base = r.base === 'ploughed' ? 'sown' : r.base; settle(r, clock); }
      return r.ploughed !== was;
    },
  };
}

/**
 * What each of a bed's six rows shows for its look (build/beds.js draws it): furrowed soil or not, and its plants:
 * 'crop' (the bed's crop at `stage`), 'seeds', 'stubble', 'weeds', 'dry' or none; `wet` while it is sprayed. A row a
 * plough has passed (a bit of `ploughed`) shows turned soil, under its crop if it has one; behind the combine (below
 * `cutRows`), stubble; the rest as they were. Without a look (the season not kept yet), the plot's, as the 2D farm
 * draws it.
 */
export function rowsOf(bed, look) {
  const row = (furrow, plants, stage = 0, wet = false) => ({ furrow, plants, stage, wet });
  const plot = bed.plot, all = f => Array.from({ length: ROWS }, (_, k) => f(k));
  if (!look) return all(() => (plot.kind === 'grow' ? row(false, 'crop', plot.stage) : plot.kind === 'dry' ? row(false, 'dry') : row(false, 'weeds')));
  const wet = look.sprayed, crop = () => row(false, 'crop', look.growth, wet);
  switch (look.stage) {
    case 'dry': return all(() => row(false, 'dry'));
    case 'fallow': return all(() => row(false, 'weeds'));
    case 'ploughed': return all(() => row(true, null));
    case 'sown': return all(() => row(true, 'seeds', 0, wet));
    case 'cut': return all(k => (k < look.cutRows ? row(false, 'stubble') : crop()));
    default: return all(k => ({ ...crop(), furrow: Boolean(look.ploughed & (1 << k)) })); // growing, ripe: turned soil under the crop where a plough has passed
  }
}
