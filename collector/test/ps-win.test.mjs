import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WinProcReader, parseWinProcs } from '../platform/win-procs.mjs';
import { isShellCommand, treeStats, childrenIndex } from '../sources/ps.mjs';

const NOW = Date.UTC(2026, 9, 10, 1, 0, 0);
const sample = [
  { pid: 100, ppid: 1, created: '2026-10-10T00:00:00.0000000Z', cpuSec: 3, ws: 512 * 1024 * 1024, cmd: 'claude.exe --resume x' },
  { pid: 200, ppid: 100, created: '2026-10-10T00:59:30.0000000Z', cpuSec: 5, ws: 10 * 1024 * 1024, cmd: 'bash.exe -c "source /c/Users/me/.claude/shell-snapshots/snapshot-bash-1-abc.sh && eval \'sleep 5\' < /dev/null && pwd -P >| /tmp/x"' },
  { pid: 300, ppid: 200, created: '2026-10-10T00:59:31.0000000Z', cpuSec: 8, ws: 2 * 1024 * 1024, cmd: 'sleep.exe 5' },
  { pid: 400, ppid: 100, created: null, cpuSec: 0, ws: 1024, cmd: null },
];

test('the PowerShell rows become the same process map the Mac ps parser produces', () => {
  const m = parseWinProcs(JSON.stringify(sample), NOW);
  assert.equal(m.size, 4);
  assert.deepEqual(m.get(200), { pid: 200, ppid: 100, pgid: 200, ageSec: 30, cpu: 0, rssKb: 10240, command: sample[1].cmd });
  assert.equal(m.get(100).rssKb, 524288);
  assert.equal(m.get(400).command, '', 'a process whose command line is hidden still counts');
  assert.equal(m.get(400).ageSec, 0);
});

test('cpu is the share of one core between two reads: 5 cpu-seconds in 10 wall-seconds is 50, and a restarted pid is not mixed up with the old one', () => {
  const first = parseWinProcs(JSON.stringify(sample), NOW);
  const later = sample.map(r => ({ ...r, cpuSec: r.cpuSec + (r.pid === 200 ? 5 : 0) }));
  const second = parseWinProcs(JSON.stringify(later), NOW + 10_000, first.samples);
  assert.equal(second.get(200).cpu, 50);
  assert.equal(second.get(100).cpu, 0);
  const reborn = sample.map(r => (r.pid === 200 ? { ...r, created: '2026-10-10T01:00:05.0000000Z', cpuSec: 1 } : r));
  assert.equal(parseWinProcs(JSON.stringify(reborn), NOW + 10_000, first.samples).get(200).cpu, 0, 'same pid, different start time: a new process');
});

test('one row (a single object, not an array) and garbage are both handled without throwing', () => {
  assert.equal(parseWinProcs(JSON.stringify(sample[0]), NOW).size, 1);
  assert.throws(() => parseWinProcs('not json', NOW), /process list/i);
  assert.throws(() => parseWinProcs('', NOW), /process list/i);
});

test("a Bash-tool command is recognised under its session on Windows (no process groups there), the session's other children are not", () => {
  const m = parseWinProcs(JSON.stringify(sample), NOW);
  assert.equal(isShellCommand(m.get(200), 100), true);
  assert.equal(isShellCommand(m.get(300), 100), false, 'a grandchild is not a command of the session');
  assert.equal(isShellCommand(m.get(400), 100), false);
  assert.equal(isShellCommand(m.get(200), 999), false, 'another session\'s command');
  const t = treeStats(m, 200, childrenIndex(m));
  assert.equal(t.childCount, 1);
});

test('the real process list on this machine contains this very process under its real parent (the subject ran)', { skip: process.platform !== 'win32' ? 'Windows only' : false }, async () => {
  const m = await new WinProcReader().read();
  assert.ok(m.size > 20, `only ${m.size} processes read`);
  const me = m.get(process.pid);
  assert.ok(me, 'own pid missing');
  assert.equal(me.ppid, process.ppid);
  assert.match(me.command, /node/i);
  assert.ok(me.rssKb > 1000, 'working set should be real');
});
