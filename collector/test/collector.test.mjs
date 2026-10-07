import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCollector } from '../collector.mjs';

test('collector serves a waiting agent from a fixture ~/.claude and survives a bad config edit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html>__TRACKER_TOKEN__</html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, pollMs: 200, deployRepos: {} }));

  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-1', cwd: '/w', name: 'fixture', kind: 'interactive', status: 'busy', version: '2.1.291' }));
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-1.jsonl'), `${[
    JSON.stringify({ type: 'user', timestamp: iso(now - 5000), cwd: '/w', message: { role: 'user', content: 'ship it?' } }),
    JSON.stringify({ type: 'assistant', timestamp: iso(now - 4000), cwd: '/w', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: 'Ship backend first?' }] } }] } }),
  ].join('\n')}\n`);

  const sent = [];
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: title => sent.push(title), log: () => {} });
  try {
    const snap = await (await fetch(`http://127.0.0.1:${handle.port}/api/state`)).json();
    const a = snap.agents.find(x => x.id === 'sess-1');
    assert.equal(a.state, 'waiting');
    assert.equal(a.stateReason, 'question pending');
    assert.equal(a.name, 'fixture');
    assert.equal(snap.counts.waiting >= 1, true);
    assert.equal(snap.sources.agents.ok, false);
    assert.equal(snap.settings.modToasts, true);

    const onDisk = JSON.parse(readFileSync(join(root, 'state', 'state.json'), 'utf8'));
    assert.equal(onDisk.agents.find(x => x.id === 'sess-1').state, 'waiting');

    writeFileSync(join(root, 'config.json'), '{ broken');
    await handle.reloadConfig();
    assert.equal(handle.getSnapshot().sources.config.ok, false);
    assert.equal((await fetch(`http://127.0.0.1:${handle.port}/api/state`)).status, 200);

    assert.equal((await handle.actions.open('e647;rm -rf ~')).ok, false);
    assert.equal((await handle.actions.open('sess-1')).ok, false);
    assert.equal((await handle.actions.rm(['sess-1'])).results[0].ok, false);
    assert.deepEqual(sent, []);
  } finally {
    await handle.stop();
  }
});

test('an invalid config.json at startup falls back to defaults instead of crash-looping', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-bad-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), '{ "pollMs": ');
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-bad-'));
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', port: 0, notify: () => {}, log: () => {} });
  try {
    assert.equal(handle.getSnapshot().sources.config.ok, false);
    assert.equal((await fetch(`http://127.0.0.1:${handle.port}/api/state`)).status, 200);
  } finally {
    await handle.stop();
  }
});
