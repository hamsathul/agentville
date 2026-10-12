import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, runPreflight } from '../platform/preflight.mjs';

const INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.mjs');
const OK = (stdout = '') => ({ code: 0, stdout, stderr: '' });
// A machine where everything is installed, answering each probe by program name.
const goodProbe = async (cmd, args) => {
  const name = String(cmd).split(/[/\x5c]/).pop().toLowerCase();
  if (/^powershell/.test(name)) return OK('5\r\n');
  if (/^claude/.test(name)) return OK('2.1.295 (Claude Code)');
  if (/^git/.test(name)) return OK('git version 2.50.0');
  if (/^gh/.test(name)) return OK('gh version 2.60.0');
  if (name === 'osascript' || name === 'ps') return OK('1');
  return { code: 1, stdout: '', stderr: 'unexpected probe' };
};
const base = over => ({ platform: 'win32', nodeVersion: '24.11.1', probe: goodProbe, exists: () => true, appExists: () => true, claudeBin: 'claude', claudeDir: 'C:/Users/me/.claude', ...over });

test('a machine with everything is ok on Windows and on Mac', async () => {
  for (const platform of ['win32', 'darwin']) {
    const r = await runPreflight(base({ platform }));
    assert.equal(r.ok, true, JSON.stringify(r.checks.filter(c => !c.ok)));
    assert.ok(r.checks.length >= 4);
  }
});

test('a missing REQUIRED thing stops the start, and says exactly how to fix it (every one has a fix)', async () => {
  const cases = {
    'Node 20': { nodeVersion: '20.11.0' },
    'claude missing': { probe: async (cmd, args) => (/claude/i.test(String(cmd)) ? { code: 1, stdout: '', stderr: 'not found' } : goodProbe(cmd, args)) },
    'powershell missing (Windows)': { probe: async (cmd, args) => (/powershell/i.test(String(cmd)) ? { code: 1, stdout: '', stderr: 'x' } : goodProbe(cmd, args)) },
  };
  for (const [name, over] of Object.entries(cases)) {
    const r = await runPreflight(base(over));
    assert.equal(r.ok, false, name);
    const bad = r.checks.filter(c => !c.ok && c.level === 'required');
    assert.ok(bad.length >= 1, name);
    for (const c of bad) assert.ok(c.fix && c.fix.length > 10, `${name}: ${c.id} has no fix`);
  }
});

test('a missing OPTIONAL thing is a warning with a fix, not a refusal', async () => {
  const r = await runPreflight(base({ probe: async (cmd, args) => (/^(git|gh)/i.test(String(cmd).split(/[/\x5c]/).pop()) ? { code: 1, stdout: '', stderr: 'x' } : goodProbe(cmd, args)), appExists: p => !/wt\.exe/i.test(String(p)) }));
  assert.equal(r.ok, true);
  const warn = r.checks.filter(c => !c.ok);
  assert.ok(warn.length >= 2 && warn.every(c => c.level === 'optional' && c.fix), JSON.stringify(warn));
});

test('a probe that throws counts as missing (not verified is never fine)', async () => {
  const r = await runPreflight(base({ probe: async () => { throw new Error('boom'); } }));
  assert.equal(r.ok, false);
  assert.ok(r.checks.filter(c => !c.ok).every(c => /boom|could not/i.test(c.message)));
});

test('an unsupported operating system is refused by name', async () => {
  const r = await runPreflight(base({ platform: 'linux' }));
  assert.equal(r.ok, false);
  assert.match(r.checks[0].message, /linux/);
});

test('the report names what is missing, marks required against optional, and ends with the verdict', async () => {
  const r = await runPreflight(base({ nodeVersion: '20.0.0', appExists: p => !/wt\.exe/i.test(String(p)) }));
  const text = formatReport(r);
  assert.match(text, /MISSING \(required\).*Node/);
  assert.match(text, /optional.*Windows Terminal/i);
  assert.match(text, /Not starting/);
  assert.match(formatReport(await runPreflight(base())), /All required checks passed/);
});

test('node index.mjs --check prints the report and exits with its verdict, starting no server', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentville-pre-'));
  const good = spawnSync(process.execPath, [INDEX, '--check'], { encoding: 'utf8', env: { ...process.env, TRACKER_ROOT: root, TRACKER_CLAUDE_BIN: process.execPath }, timeout: 60_000 });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /All required checks passed/);
  const bad = spawnSync(process.execPath, [INDEX, '--check'], { encoding: 'utf8', env: { ...process.env, TRACKER_ROOT: root, TRACKER_CLAUDE_BIN: join(root, 'no-such-claude') }, timeout: 60_000 });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /MISSING \(required\).*Claude Code/);
});

test('a normal start with a required thing missing refuses before it listens, and says what to do', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentville-pre-'));
  const r = spawnSync(process.execPath, [INDEX], { encoding: 'utf8', env: { ...process.env, TRACKER_ROOT: root, TRACKER_CLAUDE_BIN: join(root, 'no-such-claude') }, timeout: 60_000 });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /Not starting/);
  assert.match(r.stdout + r.stderr, /Claude Code/);
});

// --- throwaway servers end themselves (nothing is allowed to kill a node process by its port) ---
import { createConnection, createServer } from 'node:net';
import { mkdirSync, writeFileSync, cpSync } from 'node:fs';

const REPO = join(dirname(INDEX), '..');
const listening = port => new Promise(res => { const s = createConnection({ port, host: '127.0.0.1' }, () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });

/** A port nothing listens on now: bound on 0 for the number, then released. */
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

function throwawayRoot(port) {
  const root = mkdtempSync(join(tmpdir(), 'agentville-exit-'));
  cpSync(join(REPO, 'web'), join(root, 'web'), { recursive: true });
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port, notify: { waiting: false, collision: false, yourTurn: false, memory: false, cpu: false }, modToasts: false }));
  mkdirSync(join(root, 'logs'), { recursive: true });
  return root;
}

test('--exit-after N starts the collector, serves, and ends the process by itself (exit 0) after N seconds', async () => {
  const port = await freePort(); // not a fixed one: two test runs at once (two checkouts, two CI jobs on one host) would meet on it
  const root = throwawayRoot(port);
  const { spawn } = await import('node:child_process');
  // An empty home folder: the collector reads the sessions under ~/.claude at start, and on a machine with gigabytes of
  // real transcripts that took longer than this test waits (measured: over 40 s against 4 GB; 2.6 s with an empty home).
  const home = mkdtempSync(join(tmpdir(), 'agentville-exit-home-'));
  const child = spawn(process.execPath, [INDEX, '--exit-after', '4'], { env: { ...process.env, USERPROFILE: home, HOME: home, TRACKER_ROOT: root, TRACKER_CLAUDE_BIN: process.execPath }, stdio: 'ignore' });
  const exited = new Promise(res => child.on('exit', (code, signal) => res({ code, signal })));
  try {
    let served = false;
    for (let i = 0; i < 40 && !served; i++) { served = await listening(port); if (!served) await new Promise(r => setTimeout(r, 250)); }
    assert.equal(served, true, 'it must actually have been serving, or the exit proves nothing');
    const r = await Promise.race([exited, new Promise(res => setTimeout(() => res('TIMEOUT'), 20_000))]);
    assert.notEqual(r, 'TIMEOUT', 'it did not end by itself');
    assert.deepEqual(r, { code: 0, signal: null });
    assert.equal(await listening(port), false, 'nothing listens afterwards');
  } finally {
    // The test owns this child: if the feature is broken it must not outlive the test (the handle is mine, nothing is looked up by port).
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

test('--exit-after refuses anything that is not a whole number of seconds from 1 to 3600, before starting', () => {
  const root = throwawayRoot(47921);
  for (const bad of ['0', '-5', 'abc', '3601', '1.5', '']) {
    const r = spawnSync(process.execPath, [INDEX, '--exit-after', bad], { encoding: 'utf8', env: { ...process.env, TRACKER_ROOT: root, TRACKER_CLAUDE_BIN: process.execPath }, timeout: 30_000 });
    assert.equal(r.status, 2, `${JSON.stringify(bad)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /--exit-after/);
  }
  const missing = spawnSync(process.execPath, [INDEX, '--exit-after'], { encoding: 'utf8', env: { ...process.env, TRACKER_ROOT: root, TRACKER_CLAUDE_BIN: process.execPath }, timeout: 30_000 });
  assert.equal(missing.status, 2);
});

// The dashboard header names the system: the OS and version, Node, and the session command's version.
test('the check also describes the system: platform, OS and version, Node, session command version', async () => {
  const winOs = { osName: 'Windows 11 Pro', osRelease: '10.0.26200' };
  const w = await runPreflight(base({ platform: 'win32', ...winOs }));
  assert.deepEqual(w.system, { platform: 'win', os: 'Windows 11 Pro 10.0.26200', node: '24.11.1', claude: '2.1.295' });
  const macProbe = async (cmd, args) => (String(cmd).endsWith('sw_vers') ? OK('14.5\n') : goodProbe(cmd, args));
  const m = await runPreflight(base({ platform: 'darwin', probe: macProbe }));
  assert.deepEqual(m.system, { platform: 'mac', os: 'macOS 14.5', node: '24.11.1', claude: '2.1.295' });
});

test('a session command that did not run leaves its version out of the system line, not made up', async () => {
  const noClaude = async (cmd, args) => (/^claude/.test(String(cmd)) ? { code: 1, stdout: '', stderr: 'nope' } : goodProbe(cmd, args));
  const r = await runPreflight(base({ probe: noClaude, osName: 'Windows 10 Pro', osRelease: '10.0.19045' }));
  assert.equal(r.system.claude, null);
  assert.equal(r.system.os, 'Windows 10 Pro 10.0.19045');
});
