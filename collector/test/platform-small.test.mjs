import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as mac from '../platform/mac.mjs';
import * as win from '../platform/win.mjs';
import { scratchpadOf } from '../sources/memory.mjs';

const B = String.fromCharCode(92);
const fake = calls => (cmd, args, opts) => { calls.push({ cmd, args, opts }); return Promise.resolve({ code: 0, stdout: '', stderr: '' }); };

test('Claude keeps a session\'s scratchpad under <temp>/claude/<slug>/<session>/scratchpad on Windows (read from a live session, 2026-10-10)', () => {
  assert.equal(win.scratchBase(), join(tmpdir(), 'claude'));
  const base = mkdtempSync(join(tmpdir(), 'agentville-scratch-'));
  const cwd = `C:${B}Users${B}me${B}proj`;
  const sid = '5e551011-aaaa-4bbb-8ccc-000000000001';
  mkdirSync(join(base, 'C--Users-me-proj', sid, 'scratchpad'), { recursive: true });
  assert.equal(scratchpadOf(sid, base, cwd), join(base, 'C--Users-me-proj', sid, 'scratchpad'));
});

test('the Mac scratch base is unchanged', () => {
  assert.match(mac.scratchBase(), /^\/private\/tmp\/claude-\d+$/);
});

test('folders may be picked in the home folder and on a drive: every other existing drive root (never the system drive), not /Volumes', () => {
  const roots = win.folderRoots('C:/Users/me', drive => drive === 'C:' || drive === 'D:' || drive === 'E:', 'C:');
  assert.deepEqual(roots, ['C:/Users/me', `D:${B}`, `E:${B}`], 'the system drive is not a place to start a session');
  assert.deepEqual(mac.folderRoots('/Users/me'), ['/Users/me', '/Volumes']);
});

test('opening a folder or revealing a file in Explorer passes the path as one argument, never through a shell', async () => {
  const calls = [];
  const folder = mkdtempSync(join(tmpdir(), 'agentville open '));
  await win.openFolder(folder, fake(calls));
  await win.revealFile(`C:${B}a b${B}c.txt`, fake(calls));
  assert.equal(calls[0].cmd.toLowerCase().endsWith('explorer.exe'), true);
  assert.deepEqual(calls[0].args, [folder]);
  assert.deepEqual(calls[1].args, [`/select,C:${B}a b${B}c.txt`]);
});

test('a path with a quote or line break is refused before Explorer is called', async () => {
  const calls = [];
  for (const bad of ['C:' + B + 'x"y', 'C:' + B + 'x\ny']) {
    const r = await win.revealFile(bad, fake(calls));
    assert.notEqual(r.code, 0, bad);
  }
  assert.equal(calls.length, 0);
});

test('Explorer is never handed a file (it would run an .exe) or a folder that does not exist', async () => {
  const calls = [];
  const dir = mkdtempSync(join(tmpdir(), 'agentville-open-'));
  writeFileSync(join(dir, 'tool.exe'), 'x');
  for (const bad of [join(dir, 'tool.exe'), join(dir, 'missing')]) assert.notEqual((await win.openFolder(bad, fake(calls))).code, 0, bad);
  assert.equal(calls.length, 0);
});

test('is this process Claude Code? by the program it runs, not by the word claude appearing anywhere in its command line', () => {
  const ok = [
    `"C:${B}Users${B}me${B}.local${B}bin${B}claude.exe" --channels plugin:x --resume abc`,
    `C:${B}Users${B}me${B}.local${B}bin${B}claude.exe`,
    `"C:${B}Program Files${B}nodejs${B}node.exe" C:${B}Users${B}me${B}AppData${B}Roaming${B}npm${B}node_modules${B}@anthropic-ai${B}claude-code${B}cli.js --resume abc`,
    `C:${B}Users${B}me${B}AppData${B}Roaming${B}npm${B}claude.cmd --resume abc`,
  ];
  const no = [
    `"C:${B}Program Files${B}Git${B}usr${B}bin${B}bash.exe" -c "echo claude"`,
    `C:${B}tools${B}claude-helper.exe --x`,
    `C:${B}tools${B}notclaude.exe`,
    `"C:${B}Windows${B}System32${B}cmd.exe" /c start claude`,
    '', null, undefined,
  ];
  for (const c of ok) assert.equal(win.isClaudeCommand(c), true, c);
  for (const c of no) assert.equal(win.isClaudeCommand(c), false, String(c));
  assert.equal(mac.isClaudeCommand('/Users/me/.local/bin/claude --resume x'), true);
  assert.equal(mac.isClaudeCommand('claude'), true);
  assert.equal(mac.isClaudeCommand('/bin/zsh -c echo'), false);
});

test('the folder picker is a Windows folder dialog: start folder and prompt travel in the environment, and every answer is classified', async () => {
  const calls = [];
  const answer = stdout => (cmd, args, opts) => { calls.push({ cmd, args, opts }); return Promise.resolve({ code: 0, stdout, stderr: '' }); };
  const hostile = `C:${B}x"; calc; "`;
  assert.deepEqual(await win.chooseFolder({ start: hostile, prompt: 'Pick $(whoami)' }, answer(`PATH:C:${B}work${B}app\r\n`)), { path: `C:${B}work${B}app` });
  assert.equal(calls[0].opts.env.AGENTVILLE_START, hostile);
  assert.equal(calls[0].opts.env.AGENTVILLE_PROMPT, 'Pick $(whoami)');
  assert.ok(calls[0].args.includes('-STA'), 'a folder dialog needs a single-threaded apartment');
  assert.ok(!calls[0].args.join('\n').includes('calc') && !calls[0].args.join('\n').includes('whoami'), 'user text is not in argv');
  assert.deepEqual(await win.chooseFolder({ start: 'C:', prompt: 'x' }, answer('CANCELLED\r\n')), { cancelled: true });
  const bad = await win.chooseFolder({ start: 'C:', prompt: 'x' }, answer('something else'));
  assert.ok(bad.error, 'unrecognised output is an error, never a path');
  const failed = await win.chooseFolder({ start: 'C:', prompt: 'x' }, () => Promise.resolve({ code: 1, stdout: '', stderr: 'boom' }));
  assert.match(failed.error, /boom/);
  const relative = await win.chooseFolder({ start: 'C:', prompt: 'x' }, answer('PATH:relative' + B + 'dir'));
  assert.ok(relative.error, 'a picked path must be absolute');
});

test('the folder dialog script is valid PowerShell (parsed by the real parser, not run)', { skip: process.platform !== 'win32' ? 'Windows only' : false }, async () => {
  const { run } = await import('../lib/exec.mjs');
  const check = '$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseInput($env:AGENTVILLE_SCRIPT,[ref]$t,[ref]$e);if($e.Count){$e|ForEach-Object{$_.Message};exit 1};"parsed ok"';
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { env: { AGENTVILLE_SCRIPT: win.CHOOSE_FOLDER_SCRIPT }, timeoutMs: 30_000 });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /parsed ok/);
});

test('an app-execution alias (wt.exe) counts as present when lstat sees it, even though existsSync and stat cannot', async () => {
  const { existsApp } = await import('../platform/alias.mjs');
  const seen = () => ({ isFile: () => false });
  const gone = () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); };
  assert.equal(existsApp('C:/x/wt.exe', seen), true);
  assert.equal(existsApp('C:/x/wt.exe', gone), false);
  assert.equal(existsApp(undefined, seen), false);
  assert.equal(existsApp('', seen), false);
  // and on this machine, for real: the Windows Terminal alias is found if it is installed (PowerShell says it is, 2026-10-10)
  if (process.platform === 'win32') {
    const { join: j } = await import('node:path');
    assert.equal(existsApp(j(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe')), true);
  }
});
