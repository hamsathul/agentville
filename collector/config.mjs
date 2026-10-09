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
  modToasts: true,
  deployRepos: Object.freeze({}),
  worldsDir: null, // your own worlds, a folder each (null: ~/.agentville/worlds)
  terminal: 'Terminal', // where New session / Resume open: 'Terminal' or 'iTerm'
});

export function mergeConfig(user) {
  return {
    ...DEFAULTS,
    ...user,
    notify: { ...DEFAULTS.notify, ...(user.notify ?? {}) },
    deployRepos: { ...(user.deployRepos ?? DEFAULTS.deployRepos) },
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
