import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../lib/exec.mjs';
import { readWord } from '../sources/word.mjs';
import { WinProcReader, winSessionProcs } from './win-procs.mjs';
// A toast through the WinRT API Windows PowerShell 5.1 ships with: nothing to install. The text goes in with
// InnerText (so markup in a title is text), and arrives in the environment, never in this script.
export const NOTIFY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
  '[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]',
  '$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  '$nodes = $xml.GetElementsByTagName("text")',
  '$nodes.Item(0).InnerText = $env:AGENTVILLE_TITLE',
  '$nodes.Item(1).InnerText = $env:AGENTVILLE_MESSAGE',
  '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
  '$app = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)',
].join('\n');

/** Windows notification; the same result shape as notifyMac. */
export function notifyWin(title, message, runner = run) {
  return runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', NOTIFY_SCRIPT], {
    timeoutMs: 10_000,
    env: { AGENTVILLE_TITLE: String(title), AGENTVILLE_MESSAGE: String(message) },
  });
}

export const notify = notifyWin;

// No textutil on Windows: the document is read in JavaScript (docx, odt, rtf). The old binary .doc is said to be unreadable.
export async function readWordFile(real) {
  let buf;
  try { buf = readFileSync(real); } catch (err) { return { status: 404, error: `That document could not be read (${err.code ?? err.message}).` }; }
  const r = readWord(buf, extname(real).slice(1).toLowerCase());
  return r.error ? { status: 415, error: r.error } : { view: 'word', html: r.html, text: r.text, ...(r.truncated ? { truncated: true } : {}) };
}

// Quick Look is macOS's. Windows has no way to draw a presentation's first page without Office, and a generic icon would pass for one.
export const quickLookPicture = async () => { throw new Error('first-page pictures are not available on Windows'); };

export const sessionProcs = winSessionProcs;
const procReader = new WinProcReader();
export const readProcs = () => procReader.read();

export const scratchBase = () => join(tmpdir(), 'claude');

// Home, plus every OTHER drive that exists (Mac offers /Volumes: external disks, never the system disk). The system drive is left
// out on purpose: all of C:\Windows and C:\Program Files would otherwise be a place to start a session in.
export function folderRoots(home, exists = drive => existsSync(`${drive}${String.fromCharCode(92)}`), systemDrive = process.env.SystemDrive ?? 'C:') {
  const drives = [...'CDEFGHIJKLMNOPQRSTUVWXYZ'].map(l => `${l}:`).filter(d => d.toLowerCase() !== systemDrive.toLowerCase() && exists(d));
  return [home, ...drives.map(d => `${d}${String.fromCharCode(92)}`)];
}

const EXPLORER = join(process.env.SystemRoot ?? 'C:/Windows', 'explorer.exe');
// A quote or a line break in a path could change what Explorer is asked to do; refuse it (an & in a folder name is fine, no shell is involved).
const BAD_PATH = /["\u0000-\u001f]/;
const refuse = () => Promise.resolve({ code: 1, stdout: '', stderr: 'refused: the path holds a quote or control character' });
// Explorer would RUN an .exe it is given, so only an existing folder is passed to it.
const isFolder = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
export const openFolder = (dir, runner = run) => (BAD_PATH.test(dir) || !isFolder(dir) ? refuse() : runner(EXPLORER, [dir], { timeoutMs: 10_000 }));
export const revealFile = (real, runner = run) => (BAD_PATH.test(real) ? refuse() : runner(EXPLORER, [`/select,${real}`], { timeoutMs: 10_000 }));
