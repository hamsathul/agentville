import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/exec.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin');
const winOnly = { skip: process.platform !== 'win32' ? 'Windows only' : false };
const PS = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const ps = (file, args = []) => run(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(BIN, file), ...args], { timeoutMs: 60_000 });

test('both PowerShell scripts and the .cmd front door exist', winOnly, () => {
  for (const f of ['agent-tracker.ps1', 'run-collector.ps1', 'agent-tracker.cmd']) assert.ok(existsSync(join(BIN, f)), f);
});

test('both scripts parse with the real PowerShell parser', winOnly, async () => {
  const check = '$bad = 0; foreach ($f in $env:AGENTVILLE_FILES.Split(";")) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$t, [ref]$e); if ($e.Count) { $bad++; $e | ForEach-Object { "$f : $($_.Message)" } } }; if ($bad) { exit 1 }; "parsed ok"';
  const r = await run(PS, ['-NoProfile', '-NonInteractive', '-Command', check], { env: { AGENTVILLE_FILES: ['agent-tracker.ps1', 'run-collector.ps1'].map(f => join(BIN, f)).join(';') }, timeoutMs: 30_000 });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /parsed ok/);
});

test('install -DryRun prints what it WOULD register (a per-user logon task, no elevation) and registers nothing', winOnly, async () => {
  const r = await ps('agent-tracker.ps1', ['install', '-DryRun']);
  assert.equal(r.code, 0, r.stderr);
  const plan = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(l => l.startsWith('{')).join(''));
  assert.equal(plan.taskName, 'Agentville');
  assert.equal(plan.trigger, 'AtLogOn');
  assert.equal(plan.runLevel, 'Limited');
  assert.match(plan.execute, /powershell\.exe$/i);
  assert.match(plan.argument, /run-collector\.ps1/);
  assert.equal(plan.registered, false);
  const check = await run(PS, ['-NoProfile', '-NonInteractive', '-Command', "if (Get-ScheduledTask -TaskName Agentville -ErrorAction SilentlyContinue) { 'REGISTERED' } else { 'NOT REGISTERED' }"], { timeoutMs: 30_000 });
  assert.match(check.stdout, /NOT REGISTERED/, 'a dry run must leave no task behind');
});

test('status with no task registered says so and still reports whether the dashboard answers', winOnly, async () => {
  const r = await ps('agent-tracker.ps1', ['status']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /service not registered/i);
  assert.match(r.stdout, /http (ok|not answering) on :\d+/);
});

test('an unknown command is refused with usage and a non-zero exit', winOnly, async () => {
  const r = await ps('agent-tracker.ps1', ['rm-rf']);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout + r.stderr, /usage: agent-tracker install\|uninstall\|start\|stop\|restart\|status\|open\|logs/);
});

test('run-collector -DryRun finds node and says what it would run, without starting the collector', winOnly, async () => {
  const r = await ps('run-collector.ps1', ['-DryRun']);
  assert.equal(r.code, 0, r.stderr);
  const plan = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(l => l.startsWith('{')).join(''));
  assert.match(plan.node, /node\.exe$/i);
  assert.ok(existsSync(plan.node), 'the node it found exists');
  assert.match(plan.script, /collector[\x5c/]index\.mjs$/);
  assert.ok(existsSync(plan.script));
  assert.ok(plan.path.toLowerCase().includes(dirname(plan.node).toLowerCase()), 'node is on the PATH it would use');
});
