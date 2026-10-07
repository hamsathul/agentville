import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
    assert.equal(snap.settings.cpuAlertPct, 90);

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

test('a chat message is handed to the session through its mod, with delivery confirmed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-msg-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-msg-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-msg', cwd: '/w', name: 'chatty', status: 'idle' }));
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-msg.jsonl'), `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: 'hi' } })}\n`);
  mkdirSync(join(root, 'state', 'mods'), { recursive: true });
  const beacon = () => writeFileSync(join(root, 'state', 'mods', 'sess-msg.json'), JSON.stringify({ sessionId: 'sess-msg', version: '0.3.0', at: Date.now() }));
  beacon();
  const received = [];
  let modAlive = true;
  const inbox = join(root, 'state', 'messages', 'sess-msg');
  const fakeMod = setInterval(() => {
    if (!modAlive || !existsSync(inbox)) return;
    for (const name of readdirSync(inbox).sort()) {
      if (!name.endsWith('.json')) continue;
      received.push(JSON.parse(readFileSync(join(inbox, name), 'utf8')).text);
      unlinkSync(join(inbox, name));
    }
  }, 50);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, deliveryTimeoutMs: 600 });
  try {
    assert.equal(handle.getSnapshot().agents.find(a => a.id === 'sess-msg').mod.live, true);
    assert.match((await handle.actions.message({ agentId: 'sess-msg', text: '   ' })).error, /Type a message/);
    assert.match((await handle.actions.message({ agentId: 'nope', text: 'hi' })).error, /not found/);
    assert.deepEqual(await handle.actions.message({ agentId: 'sess-msg', text: 'Please also update the README.' }), { ok: true });
    assert.deepEqual(received, ['Please also update the README.']);
    modAlive = false;
    const undelivered = await handle.actions.message({ agentId: 'sess-msg', text: 'second' });
    assert.equal(undelivered.ok, false);
    assert.equal(existsSync(inbox) && readdirSync(inbox).length, 0);
    writeFileSync(join(root, 'state', 'mods', 'sess-msg.json'), JSON.stringify({ sessionId: 'sess-msg', version: '0.3.0', at: Date.now() - 60_000 }));
    await handle.reloadConfig();
    assert.match((await handle.actions.message({ agentId: 'sess-msg', text: 'hi' })).error, /isn't listening/);
  } finally {
    clearInterval(fakeMod);
    await handle.stop();
  }
});

test('a document can be read only if the agent opened it, and only if it is a markdown file of sane size', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-doc-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const work = mkdtempSync(join(tmpdir(), 'tracker-work-doc-'));
  mkdirSync(join(work, 'docs'));
  writeFileSync(join(work, 'docs', 'spec.md'), '# Spec\n\nHello.');
  writeFileSync(join(work, 'secret.txt'), 'not for the dashboard');
  symlinkSync(join(work, 'secret.txt'), join(work, 'link.md'));
  writeFileSync(join(work, 'big.md'), 'x'.repeat(2 * 1024 * 1024 + 1));
  writeFileSync(join(work, 'gone.md'), 'soon deleted');
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-doc-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-doc', cwd: work, name: 'writer', status: 'idle' }));
  const now = Date.now();
  const use = (n, name, file) => JSON.stringify({ type: 'assistant', timestamp: new Date(now - 5000 + n).toISOString(), cwd: work, message: { model: 'm', content: [{ type: 'tool_use', id: `t${n}`, name, input: { file_path: file } }] } });
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-doc.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: new Date(now - 6000).toISOString(), cwd: work, message: { content: 'write the spec' } }),
    use(1, 'Write', join(work, 'docs', 'spec.md')),
    use(2, 'Read', join(work, 'link.md')),
    use(3, 'Read', join(work, 'big.md')),
    use(4, 'Read', join(work, 'gone.md')),
  ].join('\n') + '\n');
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  try {
    const spec = join(work, 'docs', 'spec.md');
    assert.deepEqual(handle.getSnapshot().agents.find(a => a.id === 'sess-doc').docs.map(d => d.path), [join(work, 'gone.md'), join(work, 'big.md'), join(work, 'link.md'), spec]);
    const ok = handle.readDoc('sess-doc', spec);
    assert.equal(ok.doc.text, '# Spec\n\nHello.');
    assert.equal(ok.doc.path, spec);
    assert.match(handle.readDoc('sess-doc', join(work, 'secret.txt')).error, /not one this agent has opened/);
    assert.match(handle.readDoc('nope', spec).error, /not one this agent has opened/);
    assert.match(handle.readDoc('sess-doc', join(work, 'link.md')).error, /Only markdown/);
    assert.match(handle.readDoc('sess-doc', join(work, 'big.md')).error, /too large/);
    unlinkSync(join(work, 'gone.md'));
    assert.match(handle.readDoc('sess-doc', join(work, 'gone.md')).error, /no longer exists/);
  } finally {
    await handle.stop();
  }
});

test("the explorer lists the agent's folder with git status and the files the agent touched, and opens files from it", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-files-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const work = mkdtempSync(join(tmpdir(), 'tracker-work-files-'));
  const git = (...args) => execFileSync('git', ['-C', work, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q');
  mkdirSync(join(work, 'src'));
  writeFileSync(join(work, 'src', 'app.ts'), 'one');
  writeFileSync(join(work, 'README.md'), '# R');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(work, 'src', 'app.ts'), 'two');
  const outside = join(mkdtempSync(join(tmpdir(), 'tracker-out-')), 'plan.md');
  writeFileSync(outside, '# Plan');
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-files-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-files', cwd: work, name: 'coder', status: 'idle' }));
  const now = Date.now();
  const use = (n, name, file) => JSON.stringify({ type: 'assistant', timestamp: new Date(now - 5000 + n).toISOString(), cwd: work, message: { model: 'm', content: [{ type: 'tool_use', id: `t${n}`, name, input: { file_path: file } }] } });
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-files.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: new Date(now - 6000).toISOString(), cwd: work, message: { content: 'edit it' } }),
    use(1, 'Read', join(work, 'README.md')),
    use(2, 'Edit', join(work, 'src', 'app.ts')),
    use(3, 'Write', outside),
  ].join('\n') + '\n');
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home: '/nowhere' });
  try {
    const list = await handle.listFiles('sess-files');
    assert.equal(list.root, work);
    assert.equal(list.git, true);
    assert.deepEqual(list.files, ['README.md', 'src/app.ts']);
    assert.deepEqual(list.status, { 'src/app.ts': 'M' });
    assert.deepEqual(Object.keys(list.touched).sort(), ['README.md', 'src/app.ts']);
    assert.equal(list.touched['src/app.ts'].wrote, true);
    assert.equal(list.touched['README.md'].wrote, false);
    assert.match((await handle.listFiles('nope')).error, /not found/);
    assert.equal((await handle.readFile('sess-files', join(work, 'src', 'app.ts'))).doc.text, 'two');
    assert.equal((await handle.readFile('sess-files', outside)).doc.text, '# Plan');
    assert.match((await handle.readFile('sess-files', '/etc/hosts')).error, /outside/);
  } finally {
    await handle.stop();
  }
});

test('screenshots sent with a message are saved for the agent, and the message tells it where they are', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-shot-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-shot-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-shot', cwd: '/w', name: 'viewer', status: 'idle' }));
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-shot.jsonl'), `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: 'hi' } })}\n`);
  mkdirSync(join(root, 'state', 'mods'), { recursive: true });
  writeFileSync(join(root, 'state', 'mods', 'sess-shot.json'), JSON.stringify({ sessionId: 'sess-shot', version: '0.3.1', at: Date.now() }));
  const received = [];
  const inbox = join(root, 'state', 'messages', 'sess-shot');
  const fakeMod = setInterval(() => {
    if (!existsSync(inbox)) return;
    for (const name of readdirSync(inbox).sort()) {
      if (!name.endsWith('.json')) continue;
      received.push(JSON.parse(readFileSync(join(inbox, name), 'utf8')).text);
      unlinkSync(join(inbox, name));
    }
  }, 50);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, deliveryTimeoutMs: 1000 });
  try {
    assert.match((await handle.actions.message({ agentId: 'sess-shot', text: 'x', images: [{ data: 'bm9wZQ==' }] })).error, /PNG, JPEG/);
    assert.deepEqual(await handle.actions.message({ agentId: 'sess-shot', text: '', images: [{ data: png }, { data: png }] }), { ok: true });
    const saved = readdirSync(join(root, 'state', 'uploads', 'sess-shot')).sort();
    assert.equal(saved.length, 2);
    assert.equal(received.length, 1);
    assert.match(received[0], /^Please look at the screenshots I attached\. Open each with the Read tool to see it:\n/);
    for (const name of saved) assert.ok(received[0].includes(join(root, 'state', 'uploads', 'sess-shot', name)));
  } finally {
    clearInterval(fakeMod);
    await handle.stop();
  }
});

test("the explorer also lists the session's scratchpad and memory, and opens them, including the conversation summary", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-mem-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const home = mkdtempSync(join(tmpdir(), 'tracker-home-mem-'));
  const work = join(home, 'app');
  mkdirSync(work);
  writeFileSync(join(work, 'CLAUDE.md'), '# Project rules');
  const claudeDir = join(home, '.claude');
  mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
  mkdirSync(join(claudeDir, 'projects', '-app', 'memory'), { recursive: true });
  writeFileSync(join(claudeDir, 'CLAUDE.md'), '# Global rules');
  writeFileSync(join(claudeDir, 'settings.json'), '{"secret":true}');
  writeFileSync(join(claudeDir, 'projects', '-app', 'memory', 'MEMORY.md'), '- [Note](note.md)');
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-mem', cwd: work, name: 'rememberer', status: 'idle' }));
  writeFileSync(join(claudeDir, 'projects', '-app', 'sess-mem.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: new Date(Date.now() - 9000).toISOString(), isCompactSummary: true, message: { content: 'Summary: we built the tracker.' } }),
    JSON.stringify({ type: 'user', timestamp: new Date(Date.now() - 5000).toISOString(), message: { content: 'carry on' } }),
  ].join('\n') + '\n');
  const scratchBase = mkdtempSync(join(tmpdir(), 'tracker-claudetmp-'));
  const scratch = join(scratchBase, '-app', 'sess-mem', 'scratchpad');
  mkdirSync(join(scratch, 'shots'), { recursive: true });
  writeFileSync(join(scratch, 'plan.md'), '# Plan');
  writeFileSync(join(scratch, 'shots', 'a.txt'), 'note');
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home, scratchBase });
  try {
    const list = await handle.listFiles('sess-mem');
    assert.deepEqual(list.files, ['CLAUDE.md']);
    assert.equal(list.scratch.root, scratch);
    assert.deepEqual(list.scratch.files, ['plan.md', 'shots/a.txt']);
    assert.deepEqual(list.memory.map(m => [m.label, m.where]), [['CLAUDE.md', 'all projects'], ['CLAUDE.md', 'this project'], ['MEMORY.md', 'auto memory']]);
    assert.equal((await handle.readFile('sess-mem', '@summary')).doc.text, 'Summary: we built the tracker.');
    assert.equal((await handle.readFile('sess-mem', join(claudeDir, 'CLAUDE.md'))).doc.text, '# Global rules');
    assert.equal((await handle.readFile('sess-mem', join(claudeDir, 'projects', '-app', 'memory', 'MEMORY.md'))).doc.text, '- [Note](note.md)');
    assert.equal((await handle.readFile('sess-mem', join(scratch, 'plan.md'))).doc.text, '# Plan');
    assert.match((await handle.readFile('sess-mem', join(claudeDir, 'settings.json'))).error, /outside/);
  } finally {
    await handle.stop();
  }
});

test('an agent working in the home folder still shows its scratchpad and memory, with the folder itself left out', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-homecwd-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const home = mkdtempSync(join(tmpdir(), 'tracker-home-only-'));
  const claudeDir = join(home, '.claude');
  mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
  mkdirSync(join(claudeDir, 'projects', '-h'), { recursive: true });
  writeFileSync(join(claudeDir, 'CLAUDE.md'), '# Global');
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-home', cwd: home, name: 'homebody', status: 'idle' }));
  writeFileSync(join(claudeDir, 'projects', '-h', 'sess-home.jsonl'), `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: 'hi' } })}\n`);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home, scratchBase: '/nonexistent' });
  try {
    const list = await handle.listFiles('sess-home');
    assert.match(list.folderError, /home folder/);
    assert.deepEqual(list.files, []);
    assert.equal(list.scratch, null);
    assert.deepEqual(list.memory.map(m => m.where), ['all projects']);
    assert.match((await handle.readFile('sess-home', '@summary')).error, /hasn't been compacted/);
  } finally {
    await handle.stop();
  }
});

test("a repo's close-up lists the files its sessions touched, with git status, once the repo is on the dashboard", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-touched-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, pollMs: 200 }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-work-touched-')));
  const git = (...args) => execFileSync('git', ['-C', work, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q', '-b', 'main');
  mkdirSync(join(work, 'src'));
  writeFileSync(join(work, 'src', 'app.ts'), 'one');
  writeFileSync(join(work, 'README.md'), '# R');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(work, 'src', 'app.ts'), 'two');
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-touched-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-farm', cwd: work, name: 'farmer', status: 'idle' }));
  const now = Date.now();
  const use = (n, name, file) => JSON.stringify({ type: 'assistant', timestamp: new Date(now - 5000 + n).toISOString(), cwd: work, message: { model: 'm', content: [{ type: 'tool_use', id: `t${n}`, name, input: { file_path: file } }] } });
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-farm.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: new Date(now - 6000).toISOString(), cwd: work, message: { content: 'edit it' } }),
    use(1, 'Read', join(work, 'README.md')),
    use(2, 'Edit', join(work, 'src', 'app.ts')),
  ].join('\n') + '\n');
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home: '/nowhere' });
  try {
    for (let i = 0; i < 50 && !handle.getSnapshot().repos.some(r => r.path === work); i++) await new Promise(r => setTimeout(r, 100));
    const r = await handle.repoTouched(work);
    assert.equal(r.repo, work);
    assert.equal(r.branch, 'main');
    assert.deepEqual(r.files.map(f => [f.path, f.wrote, f.doc, f.git, f.agents.map(a => a.id)]), [
      ['src/app.ts', true, false, 'M', ['sess-farm']],
      ['README.md', false, true, null, ['sess-farm']],
    ]);
    assert.match((await handle.repoTouched('/etc')).error, /not on the dashboard/);
  } finally {
    await handle.stop();
  }
});

test("an agent's own repo stays on the dashboard even when it touched no files lately", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-cwdrepo-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, pollMs: 200 }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-work-cwdrepo-')));
  execFileSync('git', ['-C', work, 'init', '-q', '-b', 'main']);
  mkdirSync(join(work, 'src'));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-cwdrepo-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-quiet', cwd: join(work, 'src'), name: 'quiet', status: 'idle' }));
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-quiet.jsonl'), `${JSON.stringify({ type: 'user', timestamp: new Date(Date.now() - 3 * 3_600_000).toISOString(), message: { content: 'hi' } })}\n`);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home: '/nowhere' });
  try {
    let repo;
    for (let i = 0; i < 50 && !repo; i++) {
      repo = handle.getSnapshot().repos.find(r => r.path === work);
      if (!repo) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(repo, 'the repo holding the agent folder is listed');
    assert.deepEqual(repo.agentIds, ['sess-quiet']);
    assert.deepEqual(handle.getSnapshot().collisions, []);
  } finally {
    await handle.stop();
  }
});
