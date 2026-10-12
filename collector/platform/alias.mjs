import { lstatSync } from 'node:fs';

// An app-execution alias (wt.exe, python.exe in WindowsApps) is a reparse point: existsSync and statSync report it missing
// (EACCES), lstat sees it. `lstat` is passed so a test can say what the file system answers.
export function existsApp(path, lstat = lstatSync) {
  if (typeof path !== 'string' || !path) return false;
  try {
    lstat(path);
    return true;
  } catch {
    return false;
  }
}
