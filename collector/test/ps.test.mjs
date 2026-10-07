import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCodexRoots, findPidByArg, label, parsePs, treeStats } from '../sources/ps.mjs';

const PS = [
  '  100     1   1.5  20480 /usr/bin/claude --dangerously-skip-permissions',
  '  101   100   0.5  10240 bun run --cwd /plugins/discord start',
  '  102   101  12.0  51200 node /x/mcp-server.js',
  '  200     1   0.0   2048 /Users/h/.vscode/extensions/openai.chatgpt-1/bin/macos-aarch64/codex -c x app-server',
  '  201   200   0.0   1024 /Users/h/.vscode/extensions/openai.chatgpt-1/bin/macos-aarch64/codex helper',
  '  300     1   0.0   1024 claude attach aaaa1111-2222-3333',
  'garbage line',
].join('\n');

test('parsePs reads pid, ppid, cpu, rss and command', () => {
  const procs = parsePs(PS);
  assert.equal(procs.size, 6);
  assert.deepEqual(procs.get(102), { pid: 102, ppid: 101, cpu: 12, rssKb: 51200, command: 'node /x/mcp-server.js' });
});

test('treeStats sums a process and all its descendants', () => {
  const s = treeStats(parsePs(PS), 100);
  assert.equal(s.cpu, 14);
  assert.equal(s.rssMb, 80);
  assert.equal(s.childCount, 2);
  assert.equal(s.children[0], 'node mcp-server.js');
});

test('treeStats of an unknown pid is null and a ppid loop terminates', () => {
  assert.equal(treeStats(parsePs(PS), 999), null);
  const loop = parsePs('  1   2   1.0  1024 a\n  2   1   1.0  1024 b');
  assert.equal(treeStats(loop, 1).childCount, 1);
});

test('label keeps the executable name and first non-flag argument', () => {
  assert.equal(label('bun run --cwd /plugins/discord start'), 'bun run');
  assert.equal(label('/usr/bin/claude --dangerously-skip-permissions'), 'claude');
});

test('findCodexRoots returns top-level Codex processes only', () => {
  assert.deepEqual(findCodexRoots(parsePs(PS)).map(p => p.pid), [200]);
});

test('findPidByArg finds a process by a string in its command line', () => {
  assert.equal(findPidByArg(parsePs(PS), 'aaaa1111-2222-3333'), 300);
  assert.equal(findPidByArg(parsePs(PS), 'nope'), undefined);
});
