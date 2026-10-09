import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../lib/exec.mjs';
import { detectPlatform } from '../platform/index.mjs';
import { notifyWin, NOTIFY_SCRIPT } from '../platform/win.mjs';

test('the platform is picked from process.platform: darwin is mac, win32 is win, anything else is refused by name', () => {
  assert.equal(detectPlatform('darwin'), 'mac');
  assert.equal(detectPlatform('win32'), 'win');
  assert.throws(() => detectPlatform('linux'), /linux/);
  assert.throws(() => detectPlatform(null), /unsupported/i);
});

test('a Windows notification passes title and message in the environment, never inside the script text', async () => {
  const hostile = `x'; Start-Process calc; '`;
  const calls = [];
  await notifyWin(hostile, 'msg "q" $(whoami)', (cmd, args, opts) => { calls.push({ cmd, args, opts }); return Promise.resolve({ code: 0, stdout: '', stderr: '' }); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'powershell.exe');
  const argvText = calls[0].args.join('\n');
  assert.ok(!argvText.includes('calc') && !argvText.includes('whoami'), 'user text must not be in argv');
  assert.ok(calls[0].args.includes('-NoProfile') && calls[0].args.includes('-NonInteractive'));
  assert.equal(calls[0].opts.env.AGENTVILLE_TITLE, hostile);
  assert.equal(calls[0].opts.env.AGENTVILLE_MESSAGE, 'msg "q" $(whoami)');
});

test('the Windows notification script is valid PowerShell (parsed by the real parser, not run)', { skip: process.platform !== 'win32' }, async () => {
  const check = '$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseInput($env:AGENTVILLE_SCRIPT,[ref]$t,[ref]$e);if($e.Count){$e|ForEach-Object{$_.Message};exit 1};"parsed ok"';
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { env: { AGENTVILLE_SCRIPT: NOTIFY_SCRIPT }, timeoutMs: 30_000 });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /parsed ok/);
});
