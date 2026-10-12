// Windows refuses to rename a file over one that another program has open without sharing it for deleting (a reader, a virus
// scanner, a backup): EPERM or EBUSY at that moment, fine a moment later. The dashboard showed that as a red "rename ... state.json"
// banner. replaceFile waits and retries on Windows; on a Mac it is a plain rename.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replaceFile } from '../platform/replace.mjs';

const winOnly = { skip: process.platform !== 'win32' ? 'Windows only' : false };

test('a file is replaced by another, whichever way round the two exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-replace-'));
  writeFileSync(join(dir, 'a.tmp'), 'new');
  replaceFile(join(dir, 'a.tmp'), join(dir, 'a'));
  assert.equal(readFileSync(join(dir, 'a'), 'utf8'), 'new');
  assert.equal(existsSync(join(dir, 'a.tmp')), false);
  writeFileSync(join(dir, 'a.tmp'), 'newer');
  replaceFile(join(dir, 'a.tmp'), join(dir, 'a'));
  assert.equal(readFileSync(join(dir, 'a'), 'utf8'), 'newer', 'over an existing file');
});

test('a failure that is not "in use" is thrown at once, not retried', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-replace-'));
  const t0 = Date.now();
  assert.throws(() => replaceFile(join(dir, 'missing.tmp'), join(dir, 'a')), /ENOENT/);
  assert.ok(Date.now() - t0 < 500, 'no waiting for a file that is not there');
});

test('the target held open by another program for a moment: a plain rename fails, replaceFile waits and succeeds', winOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-replace-'));
  const target = join(dir, 'state.json');
  writeFileSync(target, 'old');
  // PowerShell opens it for reading and refuses to share it for deleting or renaming, for about a second and a half
  const hold = spawn(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', "$f = [IO.File]::Open($env:AV_FILE, 'Open', 'Read', 'Read'); [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); Start-Sleep -Milliseconds 1500; $f.Close()"],
    { env: { ...process.env, AV_FILE: target }, stdio: ['ignore', 'pipe', 'ignore'] });
  const done = new Promise(res => hold.on('exit', res));
  await new Promise((res, rej) => { hold.stdout.once('data', res); hold.once('error', rej); });
  try {
    writeFileSync(`${target}.tmp`, 'first');
    assert.throws(() => renameSync(`${target}.tmp`, target), /EPERM|EBUSY|EACCES/, 'the control: a plain rename is refused while it is held');
    replaceFile(`${target}.tmp`, target); // waits for the hold to end
    assert.equal(readFileSync(target, 'utf8'), 'first');
  } finally {
    await done;
  }
});

test('a target held for longer than the wait is an error that says so, after the wait', winOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-replace-'));
  const target = join(dir, 'state.json');
  writeFileSync(target, 'old');
  const hold = spawn(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', "$f = [IO.File]::Open($env:AV_FILE, 'Open', 'Read', 'Read'); [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); Start-Sleep -Milliseconds 3500; $f.Close()"],
    { env: { ...process.env, AV_FILE: target }, stdio: ['ignore', 'pipe', 'ignore'] });
  const done = new Promise(res => hold.on('exit', res));
  await new Promise((res, rej) => { hold.stdout.once('data', res); hold.once('error', rej); });
  try {
    writeFileSync(`${target}.tmp`, 'x');
    const t0 = Date.now();
    assert.throws(() => replaceFile(`${target}.tmp`, target, { waitMs: 600 }), /EPERM|EBUSY|EACCES/);
    assert.ok(Date.now() - t0 >= 500 && Date.now() - t0 < 3000, `waited about the limit (${Date.now() - t0} ms)`);
    assert.equal(readFileSync(target, 'utf8'), 'old', 'the old content is untouched');
  } finally {
    await done;
  }
});
