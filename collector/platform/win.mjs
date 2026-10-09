import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { run } from '../lib/exec.mjs';
import { readWord } from '../sources/word.mjs';

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
