// Test setup for Windows only. Creating a file symlink there needs Developer Mode or admin, which a normal user lacks (EPERM).
// A folder link can be a junction instead, and the product resolves a junction through realpath the same way. A link to
// something that does not exist, or to a file, cannot be a junction: it still throws EPERM, and that test must say so.
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

// No test may open a real terminal window (see openTerminal in platform/win.mjs).
process.env.AGENTVILLE_NO_TERMINAL = '1';

if (process.platform === 'win32') {
  const real = fs.symlinkSync;
  fs.symlinkSync = (target, path, type) => {
    try {
      return real(target, path, type);
    } catch (err) {
      if (err.code !== 'EPERM') throw err;
      let isDir = false;
      try { isDir = fs.statSync(target).isDirectory(); } catch { /* target is missing or unreadable: no junction possible */ }
      if (!isDir) throw err;
      return real(target, path, 'junction');
    }
  };
  syncBuiltinESMExports();
}

// Set when this machine cannot make a file symlink: those tests are skipped with this reason, so a skip is visible in the
// count instead of a failure that looks like a product bug. The refusal they prove is then NOT proven here.
function probe() {
  if (process.platform !== 'win32') return false;
  const dir = fs.mkdtempSync(join(tmpdir(), 'agentville-probe-'));
  try {
    fs.writeFileSync(`${dir}/t`, 'x');
    fs.symlinkSync(`${dir}/t`, `${dir}/l`, 'file');
    return false;
  } catch (err) {
    return err.code === 'EPERM' ? 'needs Windows Developer Mode or admin to create a file symlink (EPERM)' : false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
export const NO_FILE_LINKS = probe();
