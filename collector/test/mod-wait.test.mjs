import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../lib/exec.mjs';

// The mod waits for a dashboard answer with a program of its own (mod/hooks/os.ts): a shell loop on a Mac, PowerShell on
// Windows. The mod's tests cannot start a program, so the scripts are taken from its source and run here, on this system.
const OS_TS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mod', 'hooks', 'os.ts');
const OS_TS = readFileSync(OS_TS_PATH, 'utf8');
const WIN = process.platform === 'win32';
// The mod names its state folder with forward slashes on every system (C:/Users/me/agentville/state): so do these tests.
const modPath = p => (WIN ? p.replaceAll(String.fromCharCode(92), '/') : p);
const script = name => OS_TS.match(new RegExp(`^const ${name} = '(.*)'$`, 'm'))?.[1];
const PS = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Runs this system's wait as the mod does, and says how it ended: 0 an answer, 2 withdrawn, else nothing came. */
function wait(answer, pending, ticks) {
  if (process.platform !== 'win32') return run('/bin/sh', ['-c', script('WAIT_SH'), 'sh', answer, pending, String(ticks)], { timeoutMs: 20_000 });
  return run(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script('WAIT_PS')], {
    env: { AGENTVILLE_ANSWER: modPath(answer), AGENTVILLE_PENDING: modPath(pending), AGENTVILLE_TICKS: String(ticks) }, timeoutMs: 20_000,
  });
}

function offer() {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-wait-'));
  const pending = join(dir, 'pending.json');
  writeFileSync(pending, '{}');
  return { dir, pending, answer: join(dir, 'answer.json') };
}

test('both wait scripts are in the mod source, one line each', () => {
  assert.match(script('WAIT_SH') ?? '', /touch "\$2"/);
  assert.match(script('WAIT_PS') ?? '', /SetLastWriteTime\(\$p/);
});

test("the mod's wait ends with the answer once its file appears", async () => {
  const o = offer();
  try {
    setTimeout(() => writeFileSync(o.answer, '{"decision":"allow"}'), 600);
    const r = await wait(o.answer, o.pending, 40);
    assert.equal(r.code, 0, r.stderr);
    if (process.platform !== 'win32') assert.equal(r.stdout, '{"decision":"allow"}');
  } finally { rmSync(o.dir, { recursive: true, force: true }); }
});

test("the mod's wait ends as withdrawn when the offer goes, and as nothing when the time runs out", async () => {
  const o = offer();
  try {
    setTimeout(() => rmSync(o.pending), 600);
    assert.equal((await wait(o.answer, o.pending, 40)).code, 2);
    writeFileSync(o.pending, '{}');
    assert.equal((await wait(o.answer, o.pending, 2)).code, 1);
  } finally { rmSync(o.dir, { recursive: true, force: true }); }
});

test("the mod's wait touches the offer as a heartbeat, so the dashboard sees it alive", async () => {
  const o = offer();
  try {
    const hourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(o.pending, hourAgo, hourAgo);
    await wait(o.answer, o.pending, 1);
    assert.ok(Date.now() - statSync(o.pending).mtimeMs < 60_000, 'the offer was touched');
  } finally { rmSync(o.dir, { recursive: true, force: true }); }
});

/** The argument lists the mod builds (mod/hooks/os.ts, loaded with its types stripped), for this system. */
function modArgv(call) {
  const code = `const os = await import(${JSON.stringify(pathToFileURL(OS_TS_PATH).href)}); process.stdout.write(JSON.stringify(${call}))`;
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
/** Runs one as the mod does: on Windows cmd.exe by its full path, in a folder of its own. */
function runModArgv(argv, cwd) {
  const [program, ...args] = argv;
  const exe = WIN && program === 'cmd.exe' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'cmd.exe') : program;
  return spawnSync(exe, args, { cwd, encoding: 'utf8' });
}

test("the mod's claim (move) and remove (del) work on this system with the paths it writes", () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-claim-'));
  try {
    const from = join(dir, 'a.json'), to = join(dir, 'a.json.claimed'), other = join(dir, 'b.json');
    writeFileSync(from, '{}');
    writeFileSync(other, '{}');
    const claim = modArgv(`os.claimArgv(${WIN}, ${JSON.stringify(modPath(from))}, ${JSON.stringify(modPath(to))})`);
    const moved = runModArgv(claim, dir);
    assert.equal(moved.status, 0, moved.stdout + moved.stderr);
    assert.deepEqual([existsSync(from), existsSync(to)], [false, true], 'claimed');
    const remove = modArgv(`os.removeArgv(${WIN}, ${JSON.stringify([modPath(to), modPath(other), modPath(join(dir, 'gone.json'))])})`);
    runModArgv(remove, dir);
    assert.deepEqual([existsSync(to), existsSync(other)], [false, false], 'removed, a missing one among them');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

