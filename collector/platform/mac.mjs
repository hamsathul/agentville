import { run } from '../lib/exec.mjs';

/** macOS notification. Title/message travel as argv, never inside the script text. */
export function notifyMac(title, message, runner = run) {
  const script = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'];
  return runner('osascript', [...script.flatMap(line => ['-e', line]), String(title), String(message)], { timeoutMs: 5000 });
}

export const notify = notifyMac;

// macOS's textutil: the document as a page, and as plain text to quote from.
export async function readWordFile(real, runner = run) {
  const [html, text] = await Promise.all(['html', 'txt'].map(as => runner('textutil', ['-convert', as, '-stdout', real], { timeoutMs: 30_000 })));
  if (html.code !== 0) return { status: 415, error: `macOS could not read this document (${html.stderr.trim().split('\n')[0] || `exit ${html.code}`}).` };
  return { view: 'word', html: html.stdout, text: text.code === 0 ? text.stdout : '' };
}
