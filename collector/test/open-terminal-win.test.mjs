import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { openTerminal, LAUNCHER } from '../platform/win.mjs';
import { isPrivate } from '../platform/private.mjs';

const fake = calls => (cmd, args, opts) => { calls.push({ cmd, args, opts }); return Promise.resolve({ code: 0, stdout: '', stderr: '' }); };
const job = { spec: { cwd: 'C:/work/app', args: ['--resume', 'abc', '--name', 'x; new-tab calc & "q"'], prefillFile: 'C:/t/p.txt' }, line: 'unused on Windows' };

test('Windows Terminal is asked to run the launcher with the spec file; no session text is on its command line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-spec-'));
  const calls = [];
  const r = await openTerminal(job, { claude: 'C:/Users/me/.local/bin/claude.exe', specDir: dir, wt: 'C:/wt/wt.exe', runner: fake(calls) });
  assert.deepEqual(r, { ok: true, terminal: 'Windows Terminal' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'C:/wt/wt.exe');
  const [verb, , , node, launcher, specFile] = calls[0].args;
  assert.equal(verb, 'new-tab');
  assert.equal(node, process.execPath);
  assert.equal(launcher, LAUNCHER);
  assert.equal(basename(launcher), 'launch-claude.mjs');
  const cmdline = calls[0].args.join(' ');
  for (const frag of ['calc', 'resume', 'abc', 'C:/work/app', 'p.txt']) assert.ok(!cmdline.includes(frag), `${frag} must not be on the command line`);
  // the spec file holds it all, as data, and is owner-only
  const written = JSON.parse(readFileSync(specFile, 'utf8'));
  assert.deepEqual(written, { claude: 'C:/Users/me/.local/bin/claude.exe', ...job.spec });
  assert.equal(isPrivate(specFile), true);
  assert.equal(readdirSync(dir).length, 1);
});

test('without Windows Terminal the console is opened with start, from fixed text and checked paths only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-spec-'));
  const calls = [];
  const r = await openTerminal(job, { claude: 'claude', specDir: dir, wt: null, runner: fake(calls) });
  assert.deepEqual(r, { ok: true, terminal: 'Console' });
  assert.match(calls[0].cmd, /cmd\.exe$/i);
  assert.equal(calls[0].opts.windowsVerbatimArguments, true);
  const line = calls[0].args.join(' ');
  assert.match(line, /start "Agentville"/);
  for (const frag of ['calc', 'resume', 'C:/work/app']) assert.ok(!line.includes(frag), frag);
});

test('a spec folder that holds characters the terminal or cmd would read as syntax is refused, and no file is written', async () => {
  const base = mkdtempSync(join(tmpdir(), 'agentville-spec-'));
  for (const bad of ['semi;colon', 'amp&ersand', 'pct%x', 'quo"te']) {
    const calls = [];
    const r = await openTerminal(job, { claude: 'claude', specDir: join(base, bad), wt: 'C:/wt/wt.exe', runner: fake(calls) });
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /refused/i);
    assert.equal(calls.length, 0);
    assert.equal(existsSync(join(base, bad)), false);
  }
});

test('a launcher that fails to start is reported with its reason, and the unused spec is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-spec-'));
  const run = () => Promise.resolve({ code: 1, stdout: '', stderr: 'The system cannot find the file specified.' });
  const r = await openTerminal(job, { claude: 'claude', specDir: dir, wt: 'C:/wt/wt.exe', runner: run });
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot find the file/);
  assert.equal(readdirSync(dir).length, 0);
});

test('with AGENTVILLE_NO_TERMINAL=1 (set for every test run) the real opener refuses, so a test that forgot a stand-in cannot open a window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-spec-'));
  const before = process.env.AGENTVILLE_NO_TERMINAL;
  process.env.AGENTVILLE_NO_TERMINAL = '1';
  try {
    const r = await openTerminal(job, { claude: 'claude', specDir: dir, wt: 'C:/definitely/not/wt.exe' });
    assert.equal(r.ok, false);
    assert.match(r.error, /switched off/);
    assert.equal(readdirSync(dir).length, 0, 'the unused spec is removed');
  } finally {
    if (before === undefined) delete process.env.AGENTVILLE_NO_TERMINAL; else process.env.AGENTVILLE_NO_TERMINAL = before;
  }
});

test('inside node --test the real opener refuses even with no environment variable set (a test run directly, without the preload)', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this test must be running under the node test runner');
  const dir = mkdtempSync(join(tmpdir(), 'agentville-spec-'));
  const before = process.env.AGENTVILLE_NO_TERMINAL;
  delete process.env.AGENTVILLE_NO_TERMINAL;
  try {
    const r = await openTerminal(job, { claude: 'claude', specDir: dir, wt: 'C:/definitely/not/wt.exe' });
    assert.equal(r.ok, false);
    assert.match(r.error, /switched off/);
  } finally {
    if (before !== undefined) process.env.AGENTVILLE_NO_TERMINAL = before;
  }
});
