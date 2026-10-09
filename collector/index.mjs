import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogger, startCollector } from './collector.mjs';
import { formatReport, runPreflight } from './platform/preflight.mjs';

const root = process.env.TRACKER_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const log = makeLogger(join(root, 'logs'));
const claudeBin = process.env.TRACKER_CLAUDE_BIN ?? 'claude';

// --exit-after <seconds>: a throwaway run that ends itself, so nobody has to stop a server from outside.
let exitAfterSec = null;
const flagAt = process.argv.indexOf('--exit-after');
if (flagAt !== -1) {
  const raw = process.argv[flagAt + 1];
  exitAfterSec = /^[0-9]+$/.test(raw ?? '') ? Number(raw) : NaN;
  if (!(exitAfterSec >= 1 && exitAfterSec <= 3600)) {
    console.error('--exit-after needs a whole number of seconds from 1 to 3600');
    process.exit(2);
  }
}

// Is this machine ready? --check only says so; a normal start refuses to go on when a required dependency is missing.
const pre = await runPreflight({ claudeBin, claudeDir: join(homedir(), '.claude') });
if (process.argv.includes('--check')) {
  console.log(formatReport(pre));
  process.exit(pre.ok ? 0 : 1);
}
if (!pre.ok) {
  const report = formatReport(pre);
  log(report);
  console.error(report);
  process.exit(1);
}

try {
  const handle = await startCollector({ root, claudeBin, log });
  const shutdown = async () => {
    await handle.stop();
    process.exit(0);
  };
  if (exitAfterSec !== null) setTimeout(shutdown, exitAfterSec * 1000);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  log(`failed to start: ${err?.stack ?? err}`);
  console.error(err);
  process.exit(1);
}
