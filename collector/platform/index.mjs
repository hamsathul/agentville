import * as mac from './mac.mjs';
import * as win from './win.mjs';

/** 'mac' for darwin, 'win' for win32; anything else is refused by name rather than half-run. */
export function detectPlatform(platform = process.platform) {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'win';
  throw new Error(`unsupported platform: ${String(platform)} (Agentville runs on macOS and Windows)`);
}

/** The functions for this machine. Callers never test the platform themselves. */
export function platformFor(platform = process.platform) {
  return detectPlatform(platform) === 'mac' ? mac : win;
}
