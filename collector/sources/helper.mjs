import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The helper: small writing jobs for the dashboard with Haiku, called through the Agentville mod
// inside an open Claude Code session (your sign-in, your plan; never an API key). Off until you
// switch it on and tick what it may do. Kept in state/helper.json (on, uses, the daily limit and
// today's count) and state/names.json (what became of each session's name offer).
export const NAME_RE = /^[\p{L}\p{N} ._-]{1,60}$/u;
const USES = ['names'];
const DEFAULTS = { on: false, uses: { names: false }, dailyLimit: 200, consentedAt: null, today: { day: '', calls: 0 }, lastError: null };

/**
 * What Haiku answered, as a short kebab-case name: the first line with something left once a label
 * ("Name:", "Here's a name:") is dropped; accents kept as their letters; lowercase a-z 0-9 and
 * dashes; cut at a dash to 40 at most. A sentence (more than 6 words) is no name: ''.
 */
export function cleanName(text) {
  if (typeof text !== 'string') return '';
  for (const line of text.split('\n')) {
    const name = line.slice(line.lastIndexOf(':') + 1).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    if (!name) continue;
    if (name.split('-').length > 6) return '';
    if (name.length <= 40) return name;
    const dash = name.slice(0, 41).lastIndexOf('-');
    return dash > 0 ? name.slice(0, dash) : name.slice(0, 40);
  }
  return '';
}

const dayOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function createHelper(dir, { now = () => Date.now() } = {}) {
  const settingsFile = join(dir, 'helper.json'), namesFile = join(dir, 'names.json');
  const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const read = file => { try { const v = JSON.parse(readFileSync(file, 'utf8')); return isObject(v) ? v : {}; } catch { return {}; } }; // missing or damaged: nothing kept
  const write = (file, value) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const stored = read(settingsFile);
  const okLimit = n => Number.isInteger(n) && n >= 1 && n <= 2000;
  let s = { // what was saved, each part checked: a damaged file gives the defaults, never a stopped collector
    on: stored.on === true,
    uses: Object.fromEntries(USES.map(u => [u, stored.uses?.[u] === true])),
    dailyLimit: okLimit(stored.dailyLimit) ? stored.dailyLimit : DEFAULTS.dailyLimit,
    consentedAt: Number.isFinite(stored.consentedAt) ? stored.consentedAt : null,
    today: isObject(stored.today) && typeof stored.today.day === 'string' && Number.isInteger(stored.today.calls) ? { day: stored.today.day, calls: stored.today.calls } : { ...DEFAULTS.today },
    lastError: typeof stored.lastError === 'string' ? stored.lastError : null,
  };
  let names = read(namesFile);
  const today = () => {
    const day = dayOf(now());
    if (s.today.day !== day) s = { ...s, today: { day, calls: 0 } };
    return s.today;
  };
  const save = () => write(settingsFile, s);
  const view = () => ({ on: s.on, uses: { ...s.uses }, dailyLimit: s.dailyLimit, today: today().calls, ...(s.lastError ? { lastError: s.lastError } : {}) });

  return {
    settings: () => ({ ...s, uses: { ...s.uses }, today: { ...today() } }),
    view,
    /** From the ✨ Helper dialog: { on, uses: { names }, dailyLimit }. Switching on records when you agreed. */
    update(body) {
      const uses = { ...s.uses };
      for (const u of USES) if (typeof body?.uses?.[u] === 'boolean') uses[u] = body.uses[u];
      const on = typeof body?.on === 'boolean' ? body.on : s.on;
      const limit = body?.dailyLimit === undefined ? s.dailyLimit : body.dailyLimit;
      if (!okLimit(limit)) return { ok: false, error: 'The daily limit is a whole number from 1 to 2,000.' };
      if (on && !USES.some(u => uses[u])) return { ok: false, error: 'Tick at least one use to switch the helper on.' };
      s = { ...s, on, uses, dailyLimit: limit, consentedAt: on && !s.on ? now() : s.consentedAt, lastError: on ? s.lastError : null };
      save();
      return { ok: true, helper: view() };
    },
    canCall(use) {
      if (!s.on) return { ok: false, error: 'The helper is off: switch it on in ✨ Helper.' };
      if (!s.uses[use]) return { ok: false, error: 'That use is not ticked in ✨ Helper.' };
      if (today().calls >= s.dailyLimit) return { ok: false, error: `Today's daily limit of ${s.dailyLimit} helper calls is reached; it resets at midnight.` };
      return { ok: true };
    },
    count() { today().calls += 1; save(); },
    fail(error) { s = { ...s, lastError: String(error).slice(0, 300) }; save(); },
    /** A good answer: the last error no longer stands. */
    ok() { if (s.lastError) { s = { ...s, lastError: null }; save(); } },
    outcome: id => (isObject(names[id]) ? names[id].outcome : undefined),
    record(id, outcome) { names = { ...names, [id]: { outcome, at: now() } }; write(namesFile, names); },
  };
}
