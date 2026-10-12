import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOnPath, shimTarget } from '../lib/winbin.mjs';

const B = String.fromCharCode(92);
const w = (...parts) => parts.join(B);
const winOnly = { skip: process.platform !== 'win32' ? 'Windows only' : false };
const files = (...present) => p => present.some(f => f.toLowerCase() === p.toLowerCase());
const PATHEXT = '.COM;.EXE;.BAT;.CMD';

test('a program is found on PATH with its extension, in PATH order, and never in the working folder', () => {
  const path = ['C:/Windows/System32', w('C:', 'Users', 'me', '.local', 'bin'), w('C:', 'Users', 'me', 'AppData', 'Roaming', 'npm')].join(';');
  const isFile = files(w('C:', 'Users', 'me', '.local', 'bin', 'claude.exe'), w('C:', 'Users', 'me', 'AppData', 'Roaming', 'npm', 'claude.cmd'), w('C:', 'repo', 'git.exe'));
  assert.equal(findOnPath('claude', { path, pathext: PATHEXT, isFile }), w('C:', 'Users', 'me', '.local', 'bin', 'claude.exe'));
  assert.equal(findOnPath('git', { path, pathext: PATHEXT, isFile }), null, 'a git.exe in some folder that is not on PATH is not found');
  // an empty entry or "." in PATH means the working folder to Windows: skipped, as is any relative entry
  assert.equal(findOnPath('git', { path: `;.;repo;${path}`, pathext: PATHEXT, isFile: files('git.exe', w('.', 'git.exe'), w('repo', 'git.exe')) }), null);
  assert.equal(findOnPath('claude.cmd', { path, pathext: PATHEXT, isFile }), w('C:', 'Users', 'me', 'AppData', 'Roaming', 'npm', 'claude.cmd'), 'with an extension, as named');
});

test('a full path is checked as it is (an extension added when it has none); a relative or driveless path is refused', () => {
  const isFile = files(w('C:', 'tools', 'claude.exe'));
  assert.equal(findOnPath(w('C:', 'tools', 'claude.exe'), { isFile }), w('C:', 'tools', 'claude.exe'));
  assert.equal(findOnPath(w('C:', 'tools', 'claude'), { pathext: PATHEXT, isFile }), w('C:', 'tools', 'claude.exe'));
  assert.equal(findOnPath(w('C:', 'tools', 'missing.exe'), { isFile }), null);
  for (const bad of [w('.', 'claude.exe'), w('bin', 'claude.exe'), 'C:claude.exe', w('', 'tools', 'claude.exe'), '/usr/bin/false', '', null]) {
    assert.equal(findOnPath(bad, { path: 'C:/tools', isFile: () => true }), null, String(bad));
  }
});

const NPM_SHIM = ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*', ''].join('\r\n');

test("npm's claude.cmd runs node and Claude Code's script; a shim to an .exe runs it; any other .cmd is not a shim", () => {
  const npm = w('C:', 'Users', 'me', 'AppData', 'Roaming', 'npm');
  const cli = w(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  assert.deepEqual(shimTarget(w(npm, 'claude.cmd'), { read: () => NPM_SHIM, isFile: files(cli), node: 'C:/node/node.exe' }), { program: 'C:/node/node.exe', args: [cli] });
  const exe = w(npm, 'node_modules', 'x', 'bin', 'x.exe');
  assert.deepEqual(shimTarget(w(npm, 'x.cmd'), { read: () => '@"%dp0%\\node_modules\\x\\bin\\x.exe"   %*\r\n', isFile: files(exe) }), { program: exe, args: [] });
  assert.equal(shimTarget(w(npm, 'claude.cmd'), { read: () => NPM_SHIM, isFile: () => false }), null, 'its target is not there');
  assert.equal(shimTarget(w('C:', 't', 'tool.cmd'), { read: () => '@"C:\\Program Files\\Git\\bin\\bash.exe" "x.sh" %*\r\n', isFile: () => true }), null);
  assert.equal(shimTarget(w('C:', 't', 'tool.exe'), { read: () => NPM_SHIM, isFile: () => true }), null, 'only a .cmd or .bat');
  assert.equal(shimTarget(w('C:', 't', 'gone.cmd'), { read: () => { throw new Error('ENOENT'); } }), null);
});

test("on Windows the launcher starts npm's claude.cmd through node and Claude Code's script, with every argument intact", winOnly, () => {
  const npm = mkdtempSync(join(tmpdir(), 'agentville-npm-'));
  const pkg = join(npm, 'node_modules', '@anthropic-ai', 'claude-code');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'cli.js'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  writeFileSync(join(npm, 'claude.cmd'), NPM_SHIM);
  const spec = join(npm, 'spec.json');
  const args = ['--name', 'say "hi"', `C:${B}My Dir${B}`, '%PATH%'];
  writeFileSync(spec, JSON.stringify({ claude: join(npm, 'claude.cmd'), cwd: npm, args }));
  const launcher = join(dirname(fileURLToPath(import.meta.url)), '..', 'platform', 'launch-claude.mjs');
  const r = spawnSync(process.execPath, [launcher, spec], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), args);
});
