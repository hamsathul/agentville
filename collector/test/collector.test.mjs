import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
    assert.ok(snap.machine.totalMemMb > 0 && snap.machine.cpuCount > 0);
    assert.equal(snap.settings.memoryAlertGb, 2);

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

test('questions and permission prompts offered by the mod can be answered through the collector', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-ask-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-ask-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-ask', cwd: '/w', name: 'asker', status: 'busy' }));
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const questions = [{ question: 'Pick a colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }];
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-ask.jsonl'), `${[
    JSON.stringify({ type: 'user', timestamp: iso(now - 5000), message: { content: 'go' } }),
    JSON.stringify({ type: 'assistant', timestamp: iso(now - 4000), message: { model: 'm', content: [{ type: 'tool_use', id: 'toolu_Q1', name: 'AskUserQuestion', input: { questions } }] } }),
  ].join('\n')}\n`);
  mkdirSync(join(root, 'state', 'pending'), { recursive: true });
  writeFileSync(join(root, 'state', 'pending', 'toolu_Q1.json'), JSON.stringify({ kind: 'question', toolUseId: 'toolu_Q1', sessionId: 'sess-ask', createdAt: now - 4000, questions }));

  // Stands in for the mod inside the session: takes each answer file as it appears.
  const delivered = [];
  let modAlive = true;
  const answersDir = join(root, 'state', 'answers');
  const fakeMod = setInterval(() => {
    if (!modAlive || !existsSync(answersDir)) return;
    for (const name of readdirSync(answersDir)) {
      if (!name.endsWith('.json')) continue;
      delivered.push([name, JSON.parse(readFileSync(join(answersDir, name), 'utf8'))]);
      unlinkSync(join(answersDir, name));
    }
  }, 50);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, deliveryTimeoutMs: 600 });
  try {
    const snap = handle.getSnapshot();
    assert.equal(snap.settings.permissionDashboardSec, 15);
    const agent = snap.agents.find(a => a.id === 'sess-ask');
    assert.equal(agent.ask.toolUseId, 'toolu_Q1');

    assert.equal((await handle.actions.answer({ agentId: 'sess-ask', toolUseId: 'toolu_Other', answers: { 'Pick a colour?': 'Blue' } })).ok, false);
    assert.match((await handle.actions.answer({ agentId: 'sess-ask', toolUseId: 'toolu_Q1', answers: {} })).error, /every question/);
    modAlive = false;
    const undelivered = await handle.actions.answer({ agentId: 'sess-ask', toolUseId: 'toolu_Q1', answers: { 'Pick a colour?': 'Blue' } });
    assert.equal(undelivered.ok, false);
    assert.match(undelivered.error, /terminal/);
    assert.equal(existsSync(join(answersDir, 'toolu_Q1.json')), false);
    modAlive = true;
    assert.deepEqual(await handle.actions.answer({ agentId: 'sess-ask', toolUseId: 'toolu_Q1', answers: { 'Pick a colour?': 'Blue' } }), { ok: true });
    assert.deepEqual(delivered.at(-1), ['toolu_Q1.json', { answers: { 'Pick a colour?': 'Blue' } }]);

    writeFileSync(join(root, 'state', 'pending', 'toolu_P1.json'), JSON.stringify({ kind: 'permission', toolUseId: 'toolu_P1', sessionId: 'sess-ask', tool: 'Bash', summary: 'mkdir /tmp/x', createdAt: Date.now(), expiresAt: Date.now() + 15_000 }));
    await handle.reloadConfig();
    const waiting = handle.getSnapshot().agents.find(a => a.id === 'sess-ask');
    assert.equal(waiting.stateReason, 'permission needed: Bash');
    assert.equal((await handle.actions.permit({ agentId: 'sess-ask', toolUseId: 'toolu_P1', decision: 'maybe' })).ok, false);
    assert.deepEqual(await handle.actions.permit({ agentId: 'sess-ask', toolUseId: 'toolu_P1', decision: 'allow' }), { ok: true });
    assert.deepEqual(delivered.at(-1), ['toolu_P1.json', { decision: 'allow' }]);
  } finally {
    clearInterval(fakeMod);
    await handle.stop();
  }
});

test('a session resumed in another folder is read from its newest transcript copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-dup-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-dup-'));
  mkdirSync(join(claudeDir, 'sessions'));
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-dup', cwd: '/new', name: 'moved', status: 'idle' }));
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  for (const [dir, lines, mtime] of [
    ['-a-old', [{ type: 'user', timestamp: iso(now - 90_000), message: { content: 'old copy' } }], (now - 3_600_000) / 1000],
    ['-b-new', [
      { type: 'user', timestamp: iso(now - 5000), message: { content: 'new copy' } },
      { type: 'assistant', timestamp: iso(now - 4000), message: { model: 'm', content: [{ type: 'tool_use', id: 'toolu_N1', name: 'AskUserQuestion', input: {} }] } },
    ], now / 1000],
  ]) {
    mkdirSync(join(claudeDir, 'projects', dir), { recursive: true });
    const file = join(claudeDir, 'projects', dir, 'sess-dup.jsonl');
    writeFileSync(file, `${lines.map(l => JSON.stringify(l)).join('\n')}\n`);
    utimesSync(file, mtime, mtime);
  }
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  try {
    const agent = handle.getSnapshot().agents.find(a => a.id === 'sess-dup');
    assert.equal(agent.lastPrompt, 'new copy');
    assert.equal(agent.state, 'waiting');
  } finally {
    await handle.stop();
  }
});
