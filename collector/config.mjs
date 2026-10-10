import { readFileSync } from 'node:fs';

export const DEFAULTS = Object.freeze({
  port: 7777,
  pollMs: 3000,
  agentsCliPollMs: 30000,
  gitPollMs: 10000,
  deployPollMs: 60000,
  prPollMs: 120000, // pull requests, for the farm's market stall
  staleAfterHours: 24,
  collisionWindowMin: 30,
  permissionGuessSec: 20,
  permissionDashboardSec: 15,
  memoryAlertGb: 2,
  cpuAlertPct: 90,
  cpuAlertSustainSec: 120,
  notify: Object.freeze({ waiting: true, collision: true, yourTurn: true, memory: true, cpu: true }),
  notifyMaxPerMin: 0, // most pop-ups raised in one minute; the rest become one summary (0: no limit)
  modToasts: true,
  deployRepos: Object.freeze({}),
  worldsDir: null, // your own worlds, a folder each (null: ~/.agentville/worlds)
  terminal: 'Terminal', // where New session / Resume open: 'Terminal' or 'iTerm'
  accounts: Object.freeze({}), // your Claude accounts' names: { "~/.claude": "work", "~/.claude-home": "home" }
});

// Windows pop-ups are PowerShell toasts, and with a dozen sessions the memory and cpu alerts and bursts of
// "needs you" were constant. There memory and cpu start off and one minute raises at most three; config.json wins.
const WINDOWS_QUIET = Object.freeze({ notify: { memory: false, cpu: false }, notifyMaxPerMin: 3 });

export function mergeConfig(user, platform = process.platform) {
  const quiet = platform === 'win32' ? WINDOWS_QUIET : { notify: {}, notifyMaxPerMin: DEFAULTS.notifyMaxPerMin };
  return {
    ...DEFAULTS,
    notifyMaxPerMin: quiet.notifyMaxPerMin,
    ...user,
    notify: { ...DEFAULTS.notify, ...quiet.notify, ...(user.notify ?? {}) },
    deployRepos: { ...(user.deployRepos ?? DEFAULTS.deployRepos) },
    accounts: user.accounts && typeof user.accounts === 'object' && !Array.isArray(user.accounts) ? { ...user.accounts } : {},
  };
}

/** Reads config.json. A missing file gives the defaults; malformed JSON throws. */
export function loadConfig(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return mergeConfig({});
    throw err;
  }
  const user = JSON.parse(text);
  if (user === null || typeof user !== 'object' || Array.isArray(user)) {
    throw new Error('config.json must be a JSON object');
  }
  return mergeConfig(user);
}
