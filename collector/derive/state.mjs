export const STATE_ORDER = ['waiting', 'working', 'yourTurn', 'stale', 'idle'];

const WAIT_TOOLS = { AskUserQuestion: 'question pending', ExitPlanMode: 'plan approval' };
const RECENT_MS = 60_000;

function isQuiet(history, from, to) {
  const inWindow = history.filter(s => s.at >= from && s.at <= to);
  return inWindow.length >= 2 && inWindow.every(s => s.cpu < 1);
}

/** Spec §6. First match wins. */
export function deriveState({ model, registry, cpuHistory = [], now, cfg }) {
  if (!model) return { state: 'idle', reason: 'no transcript' };
  const isBusy = registry?.status === 'busy';

  if (!isBusy && model.lastActivityAt && now - model.lastActivityAt >= cfg.staleAfterHours * 3_600_000) {
    return { state: 'stale', reason: `no activity for ${cfg.staleAfterHours}h+`, since: model.lastActivityAt };
  }

  const pending = model.latestPending();
  if (pending && WAIT_TOOLS[pending.name]) {
    return { state: 'waiting', reason: WAIT_TOOLS[pending.name], since: pending.at };
  }

  const guessMs = cfg.permissionGuessSec * 1000;
  if (pending && now - pending.at >= guessMs && isQuiet(cpuHistory, now - guessMs, now)) {
    return { state: 'waiting', reason: 'probably a permission prompt', since: pending.at };
  }

  if (isBusy || pending || (model.turnOpen && now - model.lastActivityAt < RECENT_MS)) {
    return { state: 'working', reason: pending ? `running ${pending.name}` : 'busy' };
  }

  // Any activity counts, not only a seen prompt: long autonomous turns push the last
  // prompt out of the transcript tail the collector reads.
  if (model.lastActivityAt) {
    return { state: 'yourTurn', reason: 'turn finished', since: model.lastTurnEndAt || model.lastActivityAt };
  }
  return { state: 'idle', reason: 'no activity yet' };
}

export function deriveCodexState(cpuHistory, now) {
  const recent = cpuHistory.filter(s => now - s.at <= 15_000);
  const avg = recent.length ? recent.reduce((t, s) => t + s.cpu, 0) / recent.length : 0;
  return avg > 5 ? { state: 'working', reason: 'busy (CPU)' } : { state: 'idle', reason: 'idle' };
}
