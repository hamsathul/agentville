import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogger, startCollector } from './collector.mjs';

const root = process.env.TRACKER_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const log = makeLogger(join(root, 'logs'));

try {
  const handle = await startCollector({ root, claudeBin: process.env.TRACKER_CLAUDE_BIN ?? 'claude', log });
  const shutdown = async () => {
    await handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  log(`failed to start: ${err?.stack ?? err}`);
  console.error(err);
  process.exit(1);
}
