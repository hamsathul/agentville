import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/exec.mjs';
import { readWord } from '../sources/word.mjs';
import { randomBytes } from 'node:crypto';
import { existsApp } from './alias.mjs';
import { makePrivate } from './private.mjs';
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

export const LAUNCHER = join(dirname(fileURLToPath(import.meta.url)), 'launch-claude.mjs');
const WT = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe');
// What is allowed in the folder the spec file goes in: wt reads ';' as the next command and cmd reads & | < > ^ % ! " as syntax.
const SPEC_DIR_BAD = /[;&|<>^%!"\u0000-\u001f]/;

/**
 * Opens a terminal window running Claude Code for a job { spec: { cwd, args, prefillFile? } }. The session's folder, arguments
 * and prefill file travel in a spec file (JSON data, owner-only) that launch-claude.mjs reads; only the paths of node, the
 * launcher and that file are on the command line, so nothing a session holds can become a command.
 */
// Under node --test (NODE_TEST_CONTEXT is set by the runner) or with AGENTVILLE_NO_TERMINAL=1 the real opener refuses instead of opening a window on someone's desktop (it did, once).
const openingRun = (...a) => (process.env.AGENTVILLE_NO_TERMINAL === '1' || process.env.NODE_TEST_CONTEXT
  ? Promise.resolve({ code: 1, stdout: '', stderr: 'refused: opening a terminal is switched off (AGENTVILLE_NO_TERMINAL=1)' }) : run(...a));

export async function openTerminal(job, { claude = 'claude', specDir, wt = existsApp(WT) ? WT : null, runner = openingRun } = {}) {
  if (!job?.spec || typeof job.spec !== 'object') return { ok: false, error: 'refused: nothing to open' };
  if (typeof specDir !== 'string' || SPEC_DIR_BAD.test(specDir)) return { ok: false, error: 'refused: the folder for the launch file holds a character a terminal reads as syntax' };
  mkdirSync(specDir, { recursive: true });
  makePrivate(specDir);
  const specFile = join(specDir, `${randomBytes(12).toString('hex')}.json`);
  writeFileSync(specFile, JSON.stringify({ claude, ...job.spec }));
  makePrivate(specFile);
  let res;
  if (wt) res = await runner(wt, ['new-tab', '--title', 'Agentville', process.execPath, LAUNCHER, specFile], { timeoutMs: 15_000 });
  else {
    const q = s => `"${s}"`;
    res = await runner(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'cmd.exe'), ['/d', '/s', '/c', `"start "Agentville" ${[process.execPath, LAUNCHER, specFile].map(q).join(' ')}"`], { timeoutMs: 15_000, windowsVerbatimArguments: true });
  }
  if (res.code === 0) return { ok: true, terminal: wt ? 'Windows Terminal' : 'Console' };
  rmSync(specFile, { force: true });
  return { ok: false, error: res.stderr.trim().slice(0, 200) || 'The terminal did not open.' };
}

// Claude Code is a program called claude (.exe native, .cmd from npm), or node running the claude-code package's cli.js.
export function isClaudeCommand(command) {
  if (typeof command !== 'string') return false;
  const m = command.trim().match(/^(?:"([^"]+)"|(\S+))(?:\s+(.*))?$/);
  if (!m) return false;
  const program = (m[1] ?? m[2]).split(/[\x5c/]/).pop().toLowerCase();
  if (/^claude(\.exe|\.cmd)?$/.test(program)) return true;
  return /^node(\.exe)?$/.test(program) && /[\x5c/]@anthropic-ai[\x5c/]claude-code[\x5c/]cli\.js\b/i.test(m[3] ?? '');
}
export const name = 'win';
export const fileManager = 'File Explorer'; // named in the texts the dashboard shows

// Windows' own folder window (it has New Folder), in front of the browser. Start folder and prompt arrive in the environment.
export const CHOOSE_FOLDER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '[System.Windows.Forms.Application]::EnableVisualStyles()',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$d.Description = $env:AGENTVILLE_PROMPT',
  '$d.ShowNewFolderButton = $true',
  'if ($env:AGENTVILLE_START -and (Test-Path -LiteralPath $env:AGENTVILLE_START -PathType Container)) { $d.SelectedPath = $env:AGENTVILLE_START }',
  '$owner = New-Object System.Windows.Forms.Form',
  '$owner.TopMost = $true',
  '$r = $d.ShowDialog($owner)',
  "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { 'PATH:' + $d.SelectedPath } else { 'CANCELLED' }",
].join('\n');

/** The folder window: { path } picked, { cancelled }, or { error }. 5 minutes to pick. */
export async function chooseFolder({ start, prompt }, runner = run) {
  const exe = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const r = await runner(exe, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', CHOOSE_FOLDER_SCRIPT], {
    timeoutMs: 310_000, env: { AGENTVILLE_START: String(start ?? ''), AGENTVILLE_PROMPT: String(prompt ?? '') },
  });
  if (r.code !== 0) return { error: `The folder window could not open (${r.stderr.trim().slice(0, 160) || `exit ${r.code}`}).` };
  const out = r.stdout.trim();
  if (out === 'CANCELLED') return { cancelled: true };
  if (out.startsWith('PATH:') && win32.isAbsolute(out.slice(5))) return { path: out.slice(5) };
  return { error: 'The folder window gave an answer that was not a folder.' };
}
