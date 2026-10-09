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
