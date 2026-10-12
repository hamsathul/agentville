import { existsSync } from 'node:fs';
import { release, version } from 'node:os';
import { join } from 'node:path';
import { run } from '../lib/exec.mjs';
import { existsApp } from './alias.mjs';

// Is this machine ready to run Agentville? Run before the server starts (and by `node collector/index.mjs --check`).
// Each check is { id, level: 'required' | 'optional', ok, message, fix }. A required check that fails stops the start;
// an optional one is a warning that says which feature is lost. A check that cannot run counts as missing: not verified
// is never reported as fine.

const MIN_NODE = 22;
const sys32 = () => join(process.env.SystemRoot ?? 'C:/Windows', 'System32');

async function probeOk(probe, cmd, args, accept = () => true) {
  try {
    const r = await probe(cmd, args);
    return r.code === 0 && accept(String(r.stdout)) ? { ok: true, out: String(r.stdout).trim() } : { ok: false, why: String(r.stderr || `exit ${r.code}`).trim().split('\n')[0].slice(0, 100) };
  } catch (err) {
    return { ok: false, why: `could not be run (${String(err.message).slice(0, 80)})` };
  }
}

const check = (id, level, ok, message, fix) => ({ id, level, ok, message, ...(ok ? {} : { fix }) });

export async function runPreflight({ platform = process.platform, nodeVersion = process.versions.node, probe = run, exists = existsSync, appExists = existsApp, claudeBin = 'claude', claudeDir, osName = version(), osRelease = release() } = {}) {
  const isWin = platform === 'win32', isMac = platform === 'darwin';
  if (!isWin && !isMac) {
    return { ok: false, checks: [check('platform', 'required', false, `This operating system (${platform}) is not supported: Agentville runs on macOS and Windows.`, 'Run it on a Mac or a Windows PC.')] };
  }
  const checks = [];
  const major = Number(String(nodeVersion).split('.')[0]);
  checks.push(check('node', 'required', major >= MIN_NODE, `Node.js ${nodeVersion} (needs ${MIN_NODE} or newer)`,
    `Install Node.js ${MIN_NODE} or newer from https://nodejs.org${isWin ? ' (or: winget install OpenJS.NodeJS.LTS)' : ' (or: brew install node)'}, then start again.`));

  const claude = await probeOk(probe, claudeBin, ['--version']);
  checks.push(check('claude', 'required', claude.ok, claude.ok ? `Claude Code ${claude.out.split('\n')[0]}` : `Claude Code was not found or did not run (${claudeBin}: ${claude.why})`,
    `Install Claude Code (https://claude.com/product/claude-code), open a new terminal so "claude" is on PATH, or set TRACKER_CLAUDE_BIN to its full path.`));

  if (isWin) {
    const psExe = join(sys32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const ps = await probeOk(probe, psExe, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], out => Number(out.trim()) >= 5);
    checks.push(check('powershell', 'required', ps.ok, ps.ok ? `Windows PowerShell ${ps.out}` : `Windows PowerShell 5.1 or newer was not found at ${psExe} (${ps.why})`,
      'Windows PowerShell ships with Windows. Repair Windows ("sfc /scannow") or restore powershell.exe, then start again.'));
    const wt = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe');
    checks.push(check('windows-terminal', 'optional', Boolean(appExists(wt)), 'Windows Terminal', 'Install Windows Terminal from the Microsoft Store. Without it, sessions open in a plain console window.'));
  } else {
    const osa = await probeOk(probe, 'osascript', ['-e', 'return 1']);
    checks.push(check('osascript', 'required', osa.ok, osa.ok ? 'osascript' : `osascript did not run (${osa.why})`, 'osascript is part of macOS. Check that /usr/bin/osascript exists.'));
    const ps = await probeOk(probe, 'ps', ['-o', 'pid=', '-p', String(process.pid)]);
    checks.push(check('ps', 'required', ps.ok, ps.ok ? 'ps' : `ps did not run (${ps.why})`, 'ps is part of macOS. Check that /bin/ps exists.'));
  }

  const git = await probeOk(probe, 'git', ['--version']);
  checks.push(check('git', 'optional', git.ok, git.ok ? git.out : `git was not found (${git.why})`,
    `Install git${isWin ? ' for Windows from https://git-scm.com/download/win' : ' (xcode-select --install)'}. Without it the file explorer shows no repository status.`));
  const gh = await probeOk(probe, 'gh', ['--version']);
  checks.push(check('gh', 'optional', gh.ok, gh.ok ? gh.out.split('\n')[0] : `gh was not found (${gh.why})`,
    'Install the GitHub CLI from https://cli.github.com and run "gh auth login". Without it there are no pull-request or deploy badges.'));

  if (claudeDir !== undefined) {
    checks.push(check('claude-folder', 'optional', Boolean(exists(claudeDir)), `Claude's folder ${claudeDir}`, 'Start Claude Code once so it creates its folder; there are no sessions to show until then.'));
  }
  // What the dashboard header shows. Nothing here is guessed: a value that could not be read is null or left out.
  const mac = isMac ? await probeOk(probe, 'sw_vers', ['-productVersion']) : null;
  const system = {
    platform: isWin ? 'win' : 'mac',
    os: isWin ? `${osName} ${osRelease}` : mac.ok ? `macOS ${mac.out}` : 'macOS',
    node: nodeVersion,
    claude: claude.ok ? (claude.out.split('\n')[0].match(/^[\w.+-]+/)?.[0] ?? null) : null,
  };
  return { ok: checks.every(c => c.ok || c.level !== 'required'), checks, system };
}

export function formatReport(result) {
  const lines = ['Agentville dependency check'];
  for (const c of result.checks) {
    if (c.ok) lines.push(`  ok        ${c.message}`);
    else lines.push(`  ${c.level === 'required' ? 'MISSING (required)' : 'missing (optional)'}  ${c.message}`, `            fix: ${c.fix}`);
  }
  lines.push(result.ok ? 'All required checks passed.' : 'Not starting: a required dependency is missing (see above).');
  return lines.join('\n');
}
