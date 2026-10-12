import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/exec.mjs';

// The mod waits for a dashboard answer with a program of its own (mod/hooks/os.ts): a shell loop on a Mac, PowerShell on
// Windows. The mod's tests cannot start a program, so the scripts are taken from its source and run here, on this system.
const OS_TS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mod', 'hooks', 'os.ts'), 'utf8');
const script = name => OS_TS.match(new RegExp(`^const ${name} = '(.*)'$`, 'm'))?.[1];
const PS = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Runs this system's wait as the mod does, and says how it ended: 0 an answer, 2 withdrawn, else nothing came. */
function wait(answer, pending, ticks) {
  if (process.platform !== 'win32') return run('/bin/sh', ['-c', script('WAIT_SH'), 'sh', answer, pending, String(ticks)], { timeoutMs: 20_000 });
  return run(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script('WAIT_PS')], {
    env: { AGENTVILLE_ANSWER: answer, AGENTVILLE_PENDING: pending, AGENTVILLE_TICKS: String(ticks) }, timeoutMs: 20_000,
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
