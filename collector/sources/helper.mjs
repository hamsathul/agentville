import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The helper: small writing jobs for the dashboard with Haiku, called through the Agentville mod
// inside an open Claude Code session (your sign-in, your plan; never an API key). Off until you
// switch it on and tick what it may do. Kept in state/helper.json (on, uses, the daily limit and
// today's count) and state/names.json (what became of each session's name offer).
export const NAME_RE = /^[\p{L}\p{N} ._-]{1,60}$/u;
const USES = ['names'];
const DEFAULTS = { on: false, uses: { names: false }, dailyLimit: 200, consentedAt: null, today: { day: '', calls: 0 }, lastError: null };

/** What Haiku answered, as a short kebab-case name: its first line, lowercase a-z 0-9 and dashes, 40 at most; '' when nothing is left. */
export function cleanName(text) {
  if (typeof text !== 'string') return '';
  const line = text.trim().split('\n')[0].replace(/^\W*name\s*:\s*/i, '');
  return line.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

const dayOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function createHelper(dir, { now = () => Date.now() } = {}) {
  const settingsFile = join(dir, 'helper.json'), namesFile = join(dir, 'names.json');
  const read = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
  const write = (file, value) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const stored = read(settingsFile, {});
  let s = { ...DEFAULTS, ...stored, uses: { ...DEFAULTS.uses, ...stored.uses }, today: { ...DEFAULTS.today, ...stored.today } };
  let names = read(namesFile, {});
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
      if (!Number.isInteger(limit) || limit < 1 || limit > 2000) return { ok: false, error: 'The daily limit is a whole number from 1 to 2,000.' };
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
    outcome: id => names[id]?.outcome,
    record(id, outcome) { names = { ...names, [id]: { outcome, at: now() } }; write(namesFile, names); },
  };
}
