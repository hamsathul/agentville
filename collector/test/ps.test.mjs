import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCodexRoots, findPidByArg, label, parsePs, shellsOf, treeStats } from '../sources/ps.mjs';

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

// How the Bash tool runs a command: a shell of its own (its own process group), the command eval'd as typed.
const SNAPSHOT = "/bin/zsh -c source /Users/h/.claude/shell-snapshots/snapshot-zsh-1791-x.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true && { \\builtin unalias -- 'unsetenv'; \\builtin unset -f -- 'unsetenv'; } >/dev/null 2>&1 || true && eval ";
const shellLine = typed => `${SNAPSHOT}'${typed}' < /dev/null && pwd -P >| /tmp/claude-7cc9-cwd`;

test("the shell commands a session runs now: its Bash tool's, each in its own process group, as typed, with its time, CPU and memory", () => {
  const procs = parsePs([
    '  100     1   100 01:00:00   1.5  20480 claude --dangerously-skip-permissions',
    `  110   100   110    12:05   0.0   2048 ${shellLine('npm run dev -- --port 3000')}`,
    '  111   110   110    12:05  20.0 102400 node next dev',
    `  120   100   120    00:07   0.5   1024 ${shellLine(`grep -r '"'"'TODO'"'"' src\\012echo done`)}`,
    '  130   100   100 01:00:00   0.5   4096 npm exec @playwright/mcp@latest',
    '  140   100   100    00:30   0.0   1024 /bin/sh -c n=0; while [ "$n" -lt "$3" ]; do sleep 0.25; done',
    `  150   999   150    00:30   0.0   1024 ${shellLine('sleep 5')}`,
    `  160   100   160    00:09   0.0   1024 ${SNAPSHOT}'npx expo start > /tmp/metro.log 2>&1 < /dev/null' && pwd -P >| /tmp/claude-5cb6-cwd`,
  ].join('\n'));
  assert.deepEqual(procs.get(111), { pid: 111, ppid: 110, pgid: 110, ageSec: 725, cpu: 20, rssKb: 102400, command: 'node next dev' });
  assert.deepEqual(shellsOf(procs, 100, 1_000_000), [
    { pid: 110, command: 'npm run dev -- --port 3000', startedAt: 1_000_000 - 725_000, cpu: 20, rssMb: 102 },
    { pid: 160, command: 'npx expo start > /tmp/metro.log 2>&1 < /dev/null', startedAt: 1_000_000 - 9_000, cpu: 0, rssMb: 1 }, // it reads /dev/null itself: nothing added after
    { pid: 120, command: "grep -r 'TODO' src\necho done", startedAt: 1_000_000 - 7_000, cpu: 0.5, rssMb: 1 },
  ], "not its MCP servers, the mod's own wait, or another session's commands");
  assert.deepEqual(shellsOf(procs, 999_999, 1), []);
  assert.equal(parsePs('  1 0 1 1-02:03:04 0.0 1 launchd').get(1).ageSec, 93_784, 'days too');
});
