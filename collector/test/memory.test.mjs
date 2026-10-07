import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compactSummary, memoryFiles, scratchpadOf } from '../sources/memory.mjs';

const write = (path, body = '# x') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
};

test("a session's memory: global and project CLAUDE.md files, then the project's auto memory, MEMORY.md first", () => {
  const home = mkdtempSync(join(tmpdir(), 'tracker-home-'));
  const claudeDir = join(home, '.claude');
  const cwd = join(home, 'code', 'app');
  write(join(claudeDir, 'CLAUDE.md'));
  write(join(home, 'code', 'CLAUDE.md'));
  write(join(cwd, 'CLAUDE.md'));
  write(join(cwd, 'CLAUDE.local.md'));
  write(join(cwd, '.claude', 'CLAUDE.md'));
  const transcript = join(claudeDir, 'projects', '-code-app', 's1.jsonl');
  write(transcript, '');
  write(join(claudeDir, 'projects', '-code-app', 'memory', 'tooling.md'));
  write(join(claudeDir, 'projects', '-code-app', 'memory', 'MEMORY.md'));
  write(join(claudeDir, 'projects', '-code-app', 'memory', 'notes.txt'), 'not markdown');
  assert.deepEqual(memoryFiles({ cwd, home, claudeDir, transcriptPath: transcript }), [
    { path: join(claudeDir, 'CLAUDE.md'), label: 'CLAUDE.md', where: 'all projects' },
    { path: join(home, 'code', 'CLAUDE.md'), label: 'CLAUDE.md', where: '~/code' },
    { path: join(cwd, 'CLAUDE.md'), label: 'CLAUDE.md', where: 'this project' },
    { path: join(cwd, 'CLAUDE.local.md'), label: 'CLAUDE.local.md', where: 'this project' },
    { path: join(cwd, '.claude', 'CLAUDE.md'), label: 'CLAUDE.md', where: 'this project · .claude' },
    { path: join(claudeDir, 'projects', '-code-app', 'memory', 'MEMORY.md'), label: 'MEMORY.md', where: 'auto memory' },
    { path: join(claudeDir, 'projects', '-code-app', 'memory', 'tooling.md'), label: 'tooling.md', where: 'auto memory' },
  ]);
  assert.deepEqual(memoryFiles({ cwd: '', home, claudeDir, transcriptPath: null }), [{ path: join(claudeDir, 'CLAUDE.md'), label: 'CLAUDE.md', where: 'all projects' }]);
});

test('the conversation summary is the newest compaction summary in the transcript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-summary-'));
  const file = join(dir, 's.jsonl');
  const line = obj => JSON.stringify(obj);
  writeFileSync(file, [
    line({ type: 'user', timestamp: '2026-10-07T10:00:00.000Z', isCompactSummary: true, message: { content: 'Old summary.' } }),
    line({ type: 'user', timestamp: '2026-10-07T10:05:00.000Z', message: { content: 'carry on' } }),
    '{ broken',
    line({ type: 'user', timestamp: '2026-10-07T11:00:00.000Z', isCompactSummary: true, message: { content: [{ type: 'text', text: 'New summary:' }, { type: 'text', text: '- did things' }] } }),
    line({ type: 'assistant', timestamp: '2026-10-07T11:01:00.000Z', message: { content: [{ type: 'text', text: 'ok' }] } }),
  ].join('\n'));
  assert.deepEqual(compactSummary(file), { text: 'New summary:\n- did things', at: Date.parse('2026-10-07T11:00:00.000Z') });
  writeFileSync(file, line({ type: 'user', message: { content: 'hi' } }));
  assert.equal(compactSummary(file), null);
  assert.equal(compactSummary(join(dir, 'missing.jsonl')), null);
});

test("a session's scratchpad is found by its session id under Claude Code's temp folder", () => {
  const base = mkdtempSync(join(tmpdir(), 'tracker-claudetmp-'));
  mkdirSync(join(base, '-code-app', 's1', 'scratchpad'), { recursive: true });
  mkdirSync(join(base, '-code-other', 's2'), { recursive: true });
  assert.equal(scratchpadOf('s1', base), join(base, '-code-app', 's1', 'scratchpad'));
  assert.equal(scratchpadOf('s2', base), null);
  assert.equal(scratchpadOf('../x', base), null);
  assert.equal(scratchpadOf('s1', '/nonexistent'), null);
});

test('a session resumed in another folder has two scratchpads: the one for its current folder wins, else the newest', () => {
  const base = mkdtempSync(join(tmpdir(), 'tracker-claudetmp-'));
  const first = join(base, '-Users-me-old', 's1', 'scratchpad');
  const now = join(base, '-Users-me-tools-new-app', 's1', 'scratchpad');
  mkdirSync(first, { recursive: true });
  mkdirSync(now, { recursive: true });
  utimesSync(first, new Date(), new Date());
  utimesSync(now, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  assert.equal(scratchpadOf('s1', base, '/Users/me/tools/new.app'), now);
  assert.equal(scratchpadOf('s1', base, '/Users/me/elsewhere'), first);
});
