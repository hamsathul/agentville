import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { startCollector } from '../collector.mjs';
import { parsePs } from '../sources/ps.mjs';

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
    writeFileSync(join(root, 'state', 'pending', 'toolu_P2.json'), JSON.stringify({ kind: 'permission', toolUseId: 'toolu_P2', sessionId: 'sess-ask', tool: 'Bash', summary: 'npm test', createdAt: Date.now(), expiresAt: Date.now() + 15_000 }));
    await handle.reloadConfig();
    assert.match((await handle.actions.permit({ agentId: 'sess-ask', toolUseId: 'toolu_P2', decision: 'always' })).error, /older tracker mod/, 'Always allow needs mod 0.6.0');
    writeFileSync(join(root, 'state', 'mods', 'sess-ask.json'), JSON.stringify({ sessionId: 'sess-ask', version: '0.6.0', at: Date.now() }));
    await handle.reloadConfig();
    assert.deepEqual(await handle.actions.permit({ agentId: 'sess-ask', toolUseId: 'toolu_P2', decision: 'always' }), { ok: true });
    assert.deepEqual(delivered.at(-1), ['toolu_P2.json', { decision: 'always' }]);
    const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }, { type: 'setMode', mode: 'acceptEdits', destination: 'session' }];
    writeFileSync(join(root, 'state', 'pending', 'toolu_P2.json'), JSON.stringify({ kind: 'always', toolUseId: 'toolu_P2', sessionId: 'sess-ask', tool: 'Bash', summary: 'npm test', suggestions, createdAt: Date.now(), expiresAt: Date.now() + 8_000 }));
    await handle.reloadConfig();
    assert.equal(handle.getSnapshot().agents.find(a => a.id === 'sess-ask').ask.kind, 'always');
    for (const option of [2, -1, 'a', 0.5]) assert.equal((await handle.actions.always({ agentId: 'sess-ask', toolUseId: 'toolu_P2', option })).ok, false, String(option));
    assert.deepEqual(await handle.actions.always({ agentId: 'sess-ask', toolUseId: 'toolu_P2', option: 1 }), { ok: true });
    assert.deepEqual(delivered.at(-1), ['toolu_P2.json', { option: 1 }]);
    assert.deepEqual(await handle.actions.always({ agentId: 'sess-ask', toolUseId: 'toolu_P2', option: null }), { ok: true }, 'cancel: the terminal asks');
    assert.deepEqual(delivered.at(-1), ['toolu_P2.json', { option: null }]);
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

test('files sent with a message are saved for the agent, and the message tells it where they are', async () => {
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
    assert.match((await handle.actions.message({ agentId: 'sess-shot', text: 'x', files: [{ name: 'gone.md', data: '' }] })).error, /gone\.md is empty/);
    assert.deepEqual(await handle.actions.message({ agentId: 'sess-shot', text: '', files: [{ name: 'shot.png', data: png }, { name: 'notes.md', data: 'IyBOb3Rlcw==' }] }), { ok: true });
    const saved = readdirSync(join(root, 'state', 'uploads', 'sess-shot')).sort();
    assert.equal(saved.length, 2);
    assert.equal(received.length, 1);
    assert.match(received[0], /^Please look at the files I attached\. Open each with the Read tool:\n/);
    for (const name of saved) assert.ok(received[0].includes(join(root, 'state', 'uploads', 'sess-shot', name)));
    assert.deepEqual(await handle.actions.message({ agentId: 'sess-shot', text: '', folders: [root] }), { ok: true }, 'a folder alone is a message');
    assert.equal(received[1], `Please look at the folder I attached. Look in it with your tools:\n${root}`);
    assert.match((await handle.actions.message({ agentId: 'sess-shot', text: 'x', folders: [join(root, 'gone')] })).error, /not a folder/);
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

test("after a restart, files from early in a long transcript come back in the background", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-backfill-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, pollMs: 200 }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-backfill-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-long', cwd: '/w', name: 'long', status: 'idle' }));
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const filler = 'x'.repeat(2000);
  const lines = [
    JSON.stringify({ type: 'user', timestamp: iso(now - 7200_000), cwd: '/w', message: { content: 'write the spec' } }),
    JSON.stringify({ type: 'assistant', timestamp: iso(now - 7100_000), cwd: '/w', message: { model: 'm', content: [{ type: 'tool_use', id: 'tw', name: 'Write', input: { file_path: '/w/docs/early-spec.md', content: '# Early' } }] } }),
  ];
  for (let i = 0; i < 200; i++) lines.push(JSON.stringify({ type: 'assistant', timestamp: iso(now - 7000_000 + i * 1000), cwd: '/w', message: { model: 'm', content: [{ type: 'text', text: filler }] } }));
  lines.push(JSON.stringify({ type: 'assistant', timestamp: iso(now - 5000), cwd: '/w', message: { model: 'm', content: [{ type: 'tool_use', id: 'tr', name: 'Read', input: { file_path: '/w/late.md' } }] } }));
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-long.jsonl'), lines.join('\n') + '\n');
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home: '/nowhere' });
  try {
    let docs = [];
    for (let i = 0; i < 50; i++) {
      docs = handle.getSnapshot().agents.find(a => a.id === 'sess-long')?.docs.map(d => d.path) ?? [];
      if (docs.includes('/w/docs/early-spec.md')) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.deepEqual(docs, ['/w/late.md', '/w/docs/early-spec.md']);
  } finally {
    await handle.stop();
  }
});

test("a session whose transcript moves (it went into a worktree) is followed to its new place, each message once", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-moved-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-moved-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  mkdirSync(join(claudeDir, 'projects', '-w--claude-worktrees-next'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-moved', cwd: '/w', name: 'mover', status: 'busy' }));
  const line = (ms, type, message) => `${JSON.stringify({ type, timestamp: new Date(ms).toISOString(), ...(type === 'user' ? { origin: { kind: 'human' } } : {}), message })}\n`;
  const t = Date.now() - 60_000;
  const before = join(claudeDir, 'projects', '-w', 'sess-moved.jsonl');
  const after = join(claudeDir, 'projects', '-w--claude-worktrees-next', 'sess-moved.jsonl');
  writeFileSync(before, line(t, 'user', { content: 'Plan the worlds' }) + line(t + 1000, 'assistant', { model: 'm', content: [{ type: 'text', text: 'Planned.' }] }));
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  const said = () => handle.getSnapshot().agents.find(a => a.id === 'sess-moved')?.feed.filter(f => f.kind !== 'tool').map(f => f.text) ?? [];
  const until = async ok => { for (let i = 0; i < 80; i++) { await handle.reloadConfig(); if (ok()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
  try {
    assert.deepEqual(said(), ['Planned.', 'Plan the worlds']);
    renameSync(before, after); // Claude Code moves it when the session enters a worktree, and goes on writing there
    appendFileSync(after, line(t + 2000, 'user', { content: 'Build task 2' }));
    assert.ok(await until(() => said()[0] === 'Build task 2'), `what it does after the move shows (got ${JSON.stringify(said())})`);
    assert.deepEqual(said(), ['Build task 2', 'Planned.', 'Plan the worlds'], 'and nothing twice');
  } finally {
    await handle.stop();
  }
});

test("a session's whole conversation is read from its transcript, then only what was added; an unknown session has none", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-convo-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-convo-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-convo', cwd: '/w', name: 'talker', status: 'idle' }));
  const transcript = join(claudeDir, 'projects', '-w', 'sess-convo.jsonl');
  const line = (ms, type, message) => `${JSON.stringify({ type, timestamp: new Date(ms).toISOString(), ...(type === 'user' ? { origin: { kind: 'human' } } : {}), message })}\n`;
  const t = Date.now() - 60_000;
  writeFileSync(transcript, line(t, 'user', { content: 'first question' }) + line(t + 1000, 'assistant', { model: 'm', content: [{ type: 'text', text: 'first answer' }] }));
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  try {
    const all = await handle.getConversation('sess-convo', 0);
    assert.deepEqual(all.items.map(m => [m.kind, m.body]), [['prompt', 'first question'], ['reply', 'first answer']]);
    appendFileSync(transcript, line(t + 2000, 'user', { content: 'and then?' }));
    assert.deepEqual((await handle.getConversation('sess-convo', 2)).items.map(m => m.body), ['and then?']);
    assert.equal(await handle.getConversation('nobody', 0), null);
    // ↑ in the message box: your own messages, newest first, as typed (no attachment notes, no slash
    // commands, a repeat in a row once, nothing for a message that was only files)
    for (const [i, content] of ['and then?', 'Fix the header\n\nI attached a file. Open it with the Read tool:\n/u/1.png', '<command-name>/model</command-name>\n<command-args>sonnet</command-args>', 'Please look at the file I attached. Open it with the Read tool:\n/u/2.png', 'ship it', 'ship it'].entries()) {
      appendFileSync(transcript, line(t + 3000 + i * 1000, 'user', { content }));
    }
    assert.deepEqual(await handle.getPrompts('sess-convo'), { prompts: ['ship it', 'Fix the header', 'and then?', 'first question'] });
    assert.equal(await handle.getPrompts('nobody'), null);
  } finally {
    await handle.stop();
  }
});

test("a session's conversation is forked at one of its messages into a new session, in a new terminal window", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-fork-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html>__TRACKER_TOKEN__</html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, terminal: 'iTerm' }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-work-fork-')));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-fork-'));
  const dir = join(claudeDir, 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(dir, { recursive: true });
  const SID = '22222222-aaaa-4bbb-8ccc-000000000001';
  const t = Date.now() - 60_000;
  const row = (ms, type, uuid, content) => JSON.stringify({ type, uuid, timestamp: new Date(ms).toISOString(), cwd: work, ...(type === 'user' ? { origin: { kind: 'human' } } : {}), message: { role: type, ...(type === 'assistant' ? { model: 'claude-opus-5-5' } : {}), content } });
  const lines = [row(t, 'user', 'p-1', 'Plan the release'), row(t + 1000, 'assistant', 'r-1', [{ type: 'text', text: 'Here is the plan.' }]), row(t + 2000, 'user', 'p-2', 'Ship it'), row(t + 3000, 'assistant', 'r-2', [{ type: 'text', text: 'Shipped.' }])];
  writeFileSync(join(dir, `${SID}.jsonl`), `${lines.join('\n')}\n`);
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID, cwd: work, name: 'releaser', kind: 'interactive', status: 'idle' }));
  const launched = [];
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, launch: async args => { launched.push(args); return { code: 0, stdout: '', stderr: '' }; } });
  try {
    const feed = handle.getSnapshot().agents.find(a => a.id === SID).feed;
    assert.deepEqual(feed.filter(f => f.kind === 'prompt' || f.kind === 'reply').map(f => f.uuid), ['r-2', 'p-2', 'r-1', 'p-1'], 'each message says where it is in the transcript');
    assert.equal((await handle.actions.note({ agentId: SID, op: 'add', text: 'ask about the changelog' })).ok, true);
    assert.deepEqual(await handle.actions.fork({ agentId: SID, at: 'r-1', mode: 'plan', model: 'sonnet' }), { ok: true, terminal: 'iTerm' });
    const command = launched[0].at(-1);
    const copy = command.match(/--resume '([^']+)'/)[1];
    const forkId = command.match(/--session-id ([0-9a-f-]{36}) /)?.[1];
    assert.equal(command, `cd '${work}' && exec claude --resume '${copy}' --fork-session --session-id ${forkId} --name 'releaser (fork)' --permission-mode plan --model 'sonnet'`);
    assert.notEqual(forkId, SID);
    assert.deepEqual(handle.getNotes(forkId).notes.map(n => n.text), ['ask about the changelog'], 'the fork has a copy of its notes');
    assert.ok(copy.startsWith(join(root, 'state', 'forks')), 'the copy is kept in the tracker\'s own state');
    assert.equal(readFileSync(copy, 'utf8'), `${lines.slice(0, 2).join('\n')}\n`, 'up to and including that reply');
    assert.equal(readFileSync(join(dir, `${SID}.jsonl`), 'utf8'), `${lines.join('\n')}\n`, 'the original is untouched');
    assert.deepEqual(await handle.actions.fork({ agentId: SID, at: 'p-2' }), { ok: true, terminal: 'iTerm' });
    const prefill = launched[1].at(-1).match(/--prefill "\$\(cat '([^']+)'\)"$/)[1];
    assert.equal(readFileSync(prefill, 'utf8'), 'Ship it', 'forked from your message: it goes in the new prompt box');
    for (const body of [{ agentId: SID, at: 'nope' }, { agentId: SID, at: 'p-1' }, { agentId: SID }, { agentId: 'nobody', at: 'r-1' }, { agentId: SID, at: 'r-1', mode: 'yolo' }, { agentId: SID, at: 'r-1', model: 'gpt-5' }, null]) {
      assert.equal((await handle.actions.fork(body)).ok, false, JSON.stringify(body));
    }
    assert.equal(launched.length, 2);
  } finally {
    await handle.stop();
  }
});

test("your notes on a session: added, edited, used, deleted; counted in its snapshot and the resume list; refused for what isn't a session", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-notes-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html>__TRACKER_TOKEN__</html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-work-notes-')));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-notes-'));
  const dir = join(claudeDir, 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(dir, { recursive: true });
  const SID = '33333333-aaaa-4bbb-8ccc-000000000001';
  writeFileSync(join(dir, `${SID}.jsonl`), `${JSON.stringify({ type: 'user', uuid: 'p-1', timestamp: new Date().toISOString(), cwd: work, origin: { kind: 'human' }, message: { role: 'user', content: 'Hello' } })}\n`);
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID, cwd: work, name: 'noted', kind: 'interactive', status: 'idle' }));
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  const agent = () => handle.getSnapshot().agents.find(a => a.id === SID);
  const until = async ok => { for (let i = 0; i < 80; i++) { await handle.reloadConfig(); if (ok()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
  try {
    assert.equal(agent().notes, undefined, 'no notes, nothing in the snapshot');
    const added = await handle.actions.note({ agentId: SID, op: 'add', text: 'ask about the cache' });
    assert.equal(added.ok, true);
    const id = added.notes[0].id;
    await handle.actions.note({ agentId: SID, op: 'add', text: 'and the tests' });
    assert.equal((await handle.actions.note({ agentId: SID, op: 'edit', id, text: 'ask about the cache, again' })).notes[0].text, 'ask about the cache, again');
    assert.equal((await handle.actions.note({ agentId: SID, op: 'used', ids: [id] })).notes[0].usedAt > 0, true);
    assert.ok(await until(() => agent().notes?.count === 2), 'the snapshot carries how many');
    assert.deepEqual({ count: agent().notes.count, unused: agent().notes.unused }, { count: 2, unused: 1 });
    assert.ok(agent().notes.rev > 0);
    assert.equal(JSON.stringify(agent()).includes('and the tests'), false, 'the snapshot carries counts, never the text');
    assert.deepEqual(handle.getNotes(SID).notes.map(n => n.text), ['ask about the cache, again', 'and the tests']);
    assert.equal((await handle.pastSessions()).sessions.find(s => s.id === SID).notes, 1, 'the resume list counts the unused ones');
    assert.equal(statSync(join(root, 'state', 'notes', `${SID}.json`)).mode & 0o777, 0o600);
    assert.deepEqual((await handle.actions.note({ agentId: SID, op: 'clear-used' })).notes.map(n => n.text), ['and the tests']);
    assert.equal((await handle.actions.note({ agentId: SID, op: 'delete', id: handle.getNotes(SID).notes[0].id })).notes.length, 0);
    for (const body of [{ agentId: 'nobody', op: 'add', text: 'x' }, { agentId: SID, op: 'shout', text: 'x' }, { agentId: SID, op: 'add', text: '' }, { agentId: SID, op: 'add' }, null]) {
      assert.equal((await handle.actions.note(body)).ok, false, JSON.stringify(body));
    }
    assert.equal(handle.getNotes('nobody'), null);
  } finally {
    await handle.stop();
  }
});

test('a session is restored to before one of your messages: ended, its files and conversation put back, and resumed with your message', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-restore-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html>__TRACKER_TOKEN__</html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, terminal: 'iTerm' }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-work-restore-')));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-restore-'));
  const dir = join(claudeDir, 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(dir, { recursive: true });
  const SID = '33333333-aaaa-4bbb-8ccc-000000000001';
  const t = Date.now() - 60_000;
  const row = (ms, type, uuid, parentUuid, content) => JSON.stringify({ type, uuid, parentUuid, timestamp: new Date(ms).toISOString(), cwd: work, ...(type === 'user' ? { origin: { kind: 'human' } } : {}), message: { role: type, content } });
  const lines = [row(t, 'user', 'p-1', null, 'Plan the release'), row(t + 1000, 'assistant', 'r-1', 'p-1', [{ type: 'text', text: 'Here is the plan.' }]), row(t + 2000, 'user', 'p-2', 'r-1', 'Ship it'), row(t + 3000, 'assistant', 'r-2', 'p-2', [{ type: 'text', text: 'Shipped.' }])];
  const transcript = join(dir, `${SID}.jsonl`);
  writeFileSync(transcript, `${lines.join('\n')}\n`);
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID, cwd: work, name: 'releaser', kind: 'interactive', status: 'idle' }));
  // A stand-in for claude --rewind-files: what it was asked goes to a log, how it ends to a file.
  const bin = join(root, 'claude'), log = join(root, 'claude.log'), outcome = join(root, 'outcome');
  writeFileSync(bin, `#!/bin/sh\ncase "$*" in *--rewind-files*) ;; *) echo '[]'; exit 0 ;; esac\necho "$CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING $*" >> '${log}'\nif [ -f '${outcome}' ]; then cat '${outcome}'; exit 1; fi\necho "Files rewound to state at message $4"\n`, { mode: 0o755 });
  const launched = [], signals = [];
  let alive = true;
  const procs = { commandOf: async () => 'claude', ttyOf: async () => 'ttys012', kill: (pid, sig) => { signals.push([pid, sig]); alive = false; }, alive: () => alive };
  const handle = await startCollector({ root, claudeDir, claudeBin: bin, notify: () => {}, log: () => {}, sessionProcs: procs, endWaitMs: 300,
    launch: async args => { launched.push(args.at(-1)); return { code: 0, stdout: args.join(' ').includes('tty of') ? 'closed\n' : '', stderr: '' }; } });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  const marker = JSON.stringify({ type: 'last-prompt', leafUuid: 'r-1', sessionId: SID, explicit: true, rewound: true });
  try {
    for (const body of [{ agentId: SID, at: 'r-2' }, { agentId: SID, at: 'p-1' }, { agentId: SID, at: 'p-2', what: 'all' }, { agentId: SID, at: 'p-2', mode: 'yolo' }, { agentId: 'nobody', at: 'p-2' }, null]) {
      assert.equal((await handle.actions.restore(body)).ok, false, JSON.stringify(body));
    }
    assert.deepEqual([signals, calls(), launched], [[], [], []], 'refused before anything was done');
    assert.deepEqual(await handle.actions.restore({ agentId: SID, at: 'p-2', mode: 'plan' }), { ok: true, terminal: 'iTerm', files: true });
    assert.deepEqual(signals, [[process.pid, 'SIGTERM']], 'the session ended first');
    assert.deepEqual(calls(), [`1 --resume ${SID} --rewind-files p-2`], 'its files put back from Claude Code\'s own snapshots');
    assert.equal(readFileSync(transcript, 'utf8'), `${lines.join('\n')}\n${marker}\n`, "the conversation: /rewind's row added, nothing removed");
    const command = launched.at(-1);
    const prefill = command.match(/--prefill "\$\(cat '([^']+)'\)"$/)[1];
    assert.equal(command, `cd '${work}' && exec claude --resume ${SID} --permission-mode plan --prefill "$(cat '${prefill}')"`, 'resumed as itself');
    assert.equal(readFileSync(prefill, 'utf8'), 'Ship it', 'with your message back in the prompt box');
    // Conversation only: no files touched. Code only: no row added, nothing in the prompt box.
    alive = true;
    writeFileSync(transcript, `${lines.join('\n')}\n`);
    await handle.actions.restore({ agentId: SID, at: 'p-2', what: 'conversation' });
    assert.equal(calls().length, 1);
    assert.ok(readFileSync(transcript, 'utf8').endsWith(`${marker}\n`));
    alive = true;
    writeFileSync(transcript, `${lines.join('\n')}\n`);
    assert.deepEqual(await handle.actions.restore({ agentId: SID, at: 'p-2', what: 'code' }), { ok: true, terminal: 'iTerm', files: true });
    assert.equal(calls().length, 2);
    assert.equal(readFileSync(transcript, 'utf8'), `${lines.join('\n')}\n`);
    assert.equal(launched.at(-1), `cd '${work}' && exec claude --resume ${SID}`);
    // No snapshots for that message: with both, the conversation is still restored; code alone fails, and it is resumed as it was.
    writeFileSync(outcome, 'No file checkpoint found for this message.');
    alive = true;
    assert.deepEqual(await handle.actions.restore({ agentId: SID, at: 'p-2' }), { ok: true, terminal: 'iTerm', files: false });
    assert.ok(readFileSync(transcript, 'utf8').endsWith(`${marker}\n`));
    alive = true;
    writeFileSync(transcript, `${lines.join('\n')}\n`);
    const failed = await handle.actions.restore({ agentId: SID, at: 'p-2', what: 'code' });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /files could not be restored \(No file checkpoint found for this message\.\)\. It was resumed as it was/);
    assert.equal(launched.at(-1), `cd '${work}' && exec claude --resume ${SID}`);
    // A session that won't end is left as it is.
    unlinkSync(outcome);
    alive = true;
    procs.kill = (pid, sig) => signals.push([pid, sig]);
    const before = [calls().length, launched.length];
    assert.match((await handle.actions.restore({ agentId: SID, at: 'p-2' })).error, /didn't stop/);
    assert.deepEqual([calls().length, launched.length], before);
    assert.equal(readFileSync(transcript, 'utf8'), `${lines.join('\n')}\n`);
  } finally {
    await handle.stop();
  }
});

test('a session starts or resumes in a terminal only in a listed folder, or from a past session that is not running', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html>__TRACKER_TOKEN__</html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, terminal: 'iTerm' }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-work-')));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-'));
  const dir = join(claudeDir, 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(dir, { recursive: true });
  const PAST = '11111111-aaaa-4bbb-8ccc-000000000001', LIVE = '11111111-aaaa-4bbb-8ccc-000000000002', GONE = '11111111-aaaa-4bbb-8ccc-000000000003';
  const now = Date.now();
  const prompt = (ms, text, cwd = work) => JSON.stringify({ type: 'user', timestamp: new Date(ms).toISOString(), cwd, origin: { kind: 'human' }, message: { role: 'user', content: text } });
  writeFileSync(join(dir, `${PAST}.jsonl`), `${prompt(now - 60_000, 'old work')}\n`);
  writeFileSync(join(dir, `${LIVE}.jsonl`), `${prompt(now - 5000, 'current work')}\n`);
  writeFileSync(join(dir, `${GONE}.jsonl`), `${prompt(now - 9000, 'gone', join(work, 'deleted'))}\n`);
  for (const [id, age] of [[PAST, 60_000], [LIVE, 5000], [GONE, 9000]]) utimesSync(join(dir, `${id}.jsonl`), new Date(now - age), new Date(now - age));
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: LIVE, cwd: work, name: 'live', kind: 'interactive', status: 'idle', version: '2.1.291' }));
  const launched = [];
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, launch: async args => { launched.push(args); return { code: 0, stdout: '', stderr: '' }; } });
  try {
    const past = await handle.pastSessions();
    assert.equal(past.terminal, 'iTerm');
    assert.deepEqual(past.projects.map(p => p.cwd), [work], 'a folder that is gone is not offered');
    assert.deepEqual(past.sessions.map(s => [s.id, s.live]), [[LIVE, true], [GONE, false], [PAST, false]]);
    for (const body of [{ cwd: '/etc' }, { cwd: join(work, 'deleted') }, { resume: LIVE }, { resume: GONE }, { resume: 'x; rm -rf ~' }, {}, null]) {
      const r = await handle.actions.start(body);
      assert.equal(r.ok, false, JSON.stringify(body));
      assert.ok(r.error);
    }
    assert.equal(launched.length, 0);
    assert.deepEqual(await handle.actions.start({ resume: PAST }), { ok: true, terminal: 'iTerm' });
    assert.equal(launched[0].at(-1), `cd '${work}' && exec claude --resume ${PAST}`);
    assert.deepEqual(await handle.actions.start({ cwd: work }), { ok: true, terminal: 'iTerm' });
    assert.equal(launched[1].at(-1), `cd '${work}' && exec claude`);
    assert.match(launched[1].join('\n'), /tell application "iTerm"/);
    assert.deepEqual(await handle.actions.start({ cwd: work, model: 'opus[1m]', effort: 'high' }), { ok: true, terminal: 'iTerm' });
    assert.equal(launched[2].at(-1), `cd '${work}' && exec claude --model 'opus[1m]' --effort high`, 'a model and effort for this session only, quoted for the shell');
    for (const body of [{ cwd: work, model: 'gpt-5' }, { cwd: work, effort: 'turbo' }, { cwd: work, model: "sonnet'; rm -rf ~; '" }]) assert.equal((await handle.actions.start(body)).ok, false, JSON.stringify(body));
  } finally {
    await handle.stop();
  }
});

test("Finder's own folder window picks a folder: one at a time, starting where asked or at home, and a cancel says so", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-home-')));
  mkdirSync(join(home, 'code'));
  const asked = [];
  let answer = { path: `${join(home, 'code')}/` }, release;
  const chooseFolder = async opts => { asked.push(opts); if (answer === 'hold') await new Promise(r => { release = r; }); return answer === 'hold' ? { path: home } : answer; };
  const handle = await startCollector({ root, claudeDir: mkdtempSync(join(tmpdir(), 'tracker-claude-')), home, chooseFolder, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  try {
    assert.deepEqual(await handle.actions.chooseFolder({ start: join(home, 'code'), prompt: 'Start a new session in:' }), { ok: true, path: join(home, 'code'), home });
    assert.deepEqual(asked.at(-1), { start: join(home, 'code'), prompt: 'Start a new session in:' });
    await handle.actions.chooseFolder({ start: '/no/such/folder' });
    assert.deepEqual(asked.at(-1), { start: home, prompt: 'Choose a folder' }, 'a start that is not a folder: your home folder');
    answer = { cancelled: true };
    assert.deepEqual(await handle.actions.chooseFolder({}), { ok: false, cancelled: true });
    answer = 'hold';
    const first = handle.actions.chooseFolder({});
    assert.match((await handle.actions.chooseFolder({})).error, /already open/);
    release();
    assert.equal((await first).ok, true);
  } finally {
    await handle.stop();
  }
});

test('a new session starts in any folder of yours, made first if it is new, and nowhere else', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html>__TRACKER_TOKEN__</html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, terminal: 'Terminal' }));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-home-')));
  mkdirSync(join(home, 'code'));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-'));
  mkdirSync(join(claudeDir, 'sessions'));
  const launched = [];
  const handle = await startCollector({ root, claudeDir, home, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, launch: async args => { launched.push(args.at(-1)); return { code: 0, stdout: '', stderr: '' }; } });
  try {
    assert.deepEqual((await handle.listDirs('~/')).dirs, ['code'], 'suggestions from your home folder');
    assert.match((await handle.actions.start({ cwd: '~/code/new app' })).error, /doesn't exist/);
    assert.deepEqual(await handle.actions.mkdir({ path: '~/code/new app' }), { ok: true, path: join(home, 'code', 'new app') });
    assert.deepEqual(await handle.actions.start({ cwd: '~/code/new app', mode: 'plan', model: 'sonnet' }), { ok: true, terminal: 'Terminal' });
    assert.equal(launched.at(-1), `cd '${join(home, 'code', 'new app')}' && exec claude --permission-mode plan --model 'sonnet'`);
    for (const body of [{ path: '/etc/x' }, { path: '~/../x' }, {}, null]) assert.equal((await handle.actions.mkdir(body)).ok, false, JSON.stringify(body));
    for (const cwd of ['/etc', '/', '~/..', 'code']) assert.equal((await handle.actions.start({ cwd })).ok, false, cwd);
    assert.equal(launched.length, 1);
  } finally {
    await handle.stop();
  }
});

test('a session is ended (SIGTERM, then its window closed by its tty) or restarted in another mode; only a claude process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html>__TRACKER_TOKEN__</html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, terminal: 'iTerm' }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-work-')));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  const LIVE = '22222222-aaaa-4bbb-8ccc-000000000001';
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: LIVE, cwd: work, name: 'live', kind: 'interactive', status: 'idle', version: '2.1.291' }));
  writeFileSync(join(claudeDir, 'projects', '-w', `${LIVE}.jsonl`), `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), cwd: work, permissionMode: 'default', message: { role: 'user', content: 'hi' } })}\n`);
  const launched = [], signals = [];
  let alive = true, command = 'claude --resume x';
  const procs = { commandOf: async () => command, ttyOf: async () => 'ttys012', kill: (pid, sig) => { signals.push([pid, sig]); alive = false; }, alive: () => alive };
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, sessionProcs: procs, endWaitMs: 300,
    launch: async args => { launched.push(args); return { code: 0, stdout: args.join(' ').includes('tty of') ? 'closed\n' : '', stderr: '' }; } });
  try {
    assert.equal(handle.getSnapshot().agents.find(a => a.id === LIVE).mode, 'default');
    assert.equal((await handle.actions.end({ agentId: 'nope' })).ok, false);
    assert.equal((await handle.actions.restart({ agentId: LIVE, mode: 'yolo' })).ok, false);
    command = 'node something-else';
    assert.equal((await handle.actions.end({ agentId: LIVE })).ok, false, 'not a claude process: left alone');
    assert.deepEqual(signals, []);
    command = 'claude';
    assert.deepEqual(await handle.actions.end({ agentId: LIVE }), { ok: true, closedWindow: true });
    assert.deepEqual(signals, [[process.pid, 'SIGTERM']]);
    assert.equal(launched[0].at(-1), '/dev/ttys012');
    alive = true;
    assert.deepEqual(await handle.actions.restart({ agentId: LIVE, mode: 'bypassPermissions' }), { ok: true, terminal: 'iTerm' });
    assert.equal(launched.at(-1).at(-1), `cd '${work}' && exec claude --resume ${LIVE} --dangerously-skip-permissions`);
    alive = true;
    procs.kill = (pid, sig) => signals.push([pid, sig]); // this one will not stop
    const before = launched.length;
    const stuck = await handle.actions.end({ agentId: LIVE });
    assert.equal(stuck.ok, false);
    assert.match(stuck.error, /didn't stop/);
    assert.equal(launched.length, before, 'its window is left alone');
  } finally {
    await handle.stop();
  }
});

test('files an agent names in its replies: only those the dashboard may show, each with how it shows, a picture with a link for its thumbnail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-named-')));
  mkdirSync(join(work, 'docs'));
  writeFileSync(join(work, 'shot.png'), Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  writeFileSync(join(work, 'demo.mov'), 'not really a video');
  writeFileSync(join(work, 'docs', 'plan.md'), '# Plan');
  writeFileSync(join(work, '.env.png'), 'x');
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-named', cwd: work, name: 'named', status: 'idle' }));
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-named.jsonl'), `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), cwd: work, message: { content: 'hi' } })}\n`);
  const handle = await startCollector({ root, claudeDir, home: dirname(work), claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  try {
    const asked = ['shot.png', `${work}/demo.mov`, `~/${basename(work)}/docs/plan.md`, '/etc/hosts.png', '.env.png', 'missing.png', '../outside.png'];
    const { items } = await handle.namedFiles('sess-named', asked);
    assert.deepEqual(items.map(i => [i.asked, i.ok, i.kind, i.path]), [
      ['shot.png', true, 'image', join(work, 'shot.png')], // relative: to its folder
      [`${work}/demo.mov`, true, 'video', join(work, 'demo.mov')],
      [`~/${basename(work)}/docs/plan.md`, true, 'markdown', join(work, 'docs', 'plan.md')],
      ['/etc/hosts.png', false, undefined, undefined], // outside its folder
      ['.env.png', false, undefined, undefined], // looks like it holds secrets
      ['missing.png', false, undefined, undefined],
      ['../outside.png', false, undefined, undefined],
    ]);
    assert.match(items[0].url, /^\/raw\/[0-9a-f]{32}\/shot\.png$/, 'a picture comes with a link for its thumbnail');
    assert.equal(items[1].url, undefined);
    assert.equal((await handle.namedFiles('nope', ['x.png'])).status, 404);
    assert.equal((await handle.namedFiles('sess-named', Array.from({ length: 30 }, (_, i) => `s${i}.png`))).items.length, 20, 'at most 20 at a time');
  } finally {
    await handle.stop();
  }
});

test("a session's shell commands: one is stopped with everything it started (its process group), a background one's output read; nothing else", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-work-')));
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-scratch-')));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  const LIVE = '33333333-aaaa-4bbb-8ccc-000000000001', P = process.pid;
  const output = join(scratch, '-w', LIVE, 'tasks', 'bgx.output');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, 'ready on :3000\n');
  const line = (type, content) => JSON.stringify({ type, timestamp: new Date().toISOString(), cwd: work, message: { role: type, content } });
  writeFileSync(join(claudeDir, 'sessions', `${P}.json`), JSON.stringify({ pid: P, sessionId: LIVE, cwd: work, name: 'live', kind: 'interactive', status: 'busy', version: '2.1.293' }));
  writeFileSync(join(claudeDir, 'projects', '-w', `${LIVE}.jsonl`), [
    line('user', 'start it'),
    line('assistant', [{ type: 'tool_use', id: 'bg1', name: 'Bash', input: { command: 'npm run dev', run_in_background: true } }]),
    line('user', [{ type: 'tool_result', tool_use_id: 'bg1', content: `Command running in background with ID: bgx. Output is being written to: ${output}` }]),
    line('assistant', [{ type: 'tool_use', id: 'fg1', name: 'Bash', input: { command: 'npm test' } }]),
  ].join('\n') + '\n');
  const shell = typed => `/bin/zsh -c source /Users/h/.claude/shell-snapshots/snapshot-zsh-1-x.sh 2>/dev/null || true && eval '${typed}' < /dev/null && pwd -P >| /tmp/claude-1-cwd`;
  const ps = [`${P} 1 ${P} 01:00 1.0 20480 claude`, `5001 ${P} 5001 00:30 0.0 1024 ${shell('npm run dev')}`, '5002 5001 5001 00:30 25.0 102400 node next dev',
    `5003 ${P} 5003 00:05 0.0 1024 ${shell('npm test')}`, `5004 ${P} ${P} 01:00 0.5 4096 npm exec @playwright/mcp@latest`].join('\n');
  const signals = [];
  let groupUp = true;
  const sessionProcs = { commandOf: async () => 'claude', ttyOf: async () => null, kill: () => {}, alive: () => true, killGroup: (pgid, sig) => { signals.push([pgid, sig]); if (sig === 'SIGKILL') groupUp = false; }, groupAlive: () => groupUp };
  const handle = await startCollector({ root, claudeDir, scratchBase: scratch, readProcs: async () => parsePs(ps), sessionProcs, stopWaitMs: 100, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  try {
    const shells = handle.getSnapshot().agents.find(a => a.id === LIVE).shells;
    assert.deepEqual(shells.map(s => [s.pid, s.command, s.background, s.output, s.cpu, s.rssMb]), [[5001, 'npm run dev', true, true, 25, 101], [5003, 'npm test', false, false, 0, 1]]);
    assert.deepEqual(await handle.shellOutput(LIVE, 5001), { text: 'ready on :3000\n', size: 15, truncated: false });
    assert.match((await handle.shellOutput(LIVE, 5003)).error, /only a background command/i);
    for (const pid of [5004, P, 9999, 'x']) assert.equal((await handle.actions.stopShell({ agentId: LIVE, pid })).ok, false, `not a shell command of that session: ${pid}`);
    assert.equal((await handle.actions.stopShell({ agentId: 'nope', pid: 5001 })).ok, false);
    assert.deepEqual(signals, []);
    assert.deepEqual(await handle.actions.stopShell({ agentId: LIVE, pid: 5001 }), { ok: true });
    assert.deepEqual(signals, [[5001, 'SIGTERM']]);
    for (let i = 0; i < 40 && signals.length < 2; i++) await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(signals, [[5001, 'SIGTERM'], [5001, 'SIGKILL']], 'still there after a moment: killed');
  } finally {
    await handle.stop();
  }
});

test("a session's model and effort are switched by its mod (/model, /effort), and side questions answered by it", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-set-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-set-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-set', cwd: '/w', name: 'switchy', status: 'idle' }));
  const t = new Date().toISOString();
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-set.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: t, message: { content: 'hi' } }),
    JSON.stringify({ type: 'system', subtype: 'local_command', timestamp: t, content: '<local-command-stdout>Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning</local-command-stdout>' }),
  ].join('\n') + '\n');
  mkdirSync(join(root, 'state', 'mods'), { recursive: true });
  writeFileSync(join(root, 'state', 'mods', 'sess-set.json'), JSON.stringify({ sessionId: 'sess-set', version: '0.5.0', at: Date.now() }));
  // A stand-in mod: takes requests and writes back as the real one does.
  const taken = [];
  const fakeMod = setInterval(() => {
    for (const [kind, out] of [['commands', 'command-results'], ['btw', 'asides']]) {
      const inbox = join(root, 'state', kind, 'sess-set');
      if (!existsSync(inbox)) continue;
      for (const name of readdirSync(inbox).filter(n => n.endsWith('.json'))) {
        const req = JSON.parse(readFileSync(join(inbox, name), 'utf8'));
        unlinkSync(join(inbox, name));
        taken.push([kind, req.command ?? req.question, req.args]);
        const reply = kind === 'commands' ? { id: req.id, sessionId: 'sess-set', command: req.command, args: req.args, ok: true, text: 'Set model to `Sonnet 5.5` and saved as your default for new sessions', at: Date.now() }
          : { id: req.id, sessionId: 'sess-set', question: req.question, text: 'The parser lives in parse.mjs.', at: req.at, answeredAt: Date.now() };
        setTimeout(() => writeFileSync(join(root, 'state', out, `sess-set.${req.id}.json`), JSON.stringify(reply)), 150);
      }
    }
  }, 40);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, deliveryTimeoutMs: 800 });
  const agent = () => handle.getSnapshot().agents.find(a => a.id === 'sess-set');
  const until = async (ok, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { await handle.reloadConfig(); if (ok()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
  try {
    assert.equal(agent().effort, 'xhigh', 'what /effort last set');
    for (const body of [{ agentId: 'sess-set' }, { agentId: 'sess-set', model: 'gpt-5' }, { agentId: 'sess-set', effort: 'turbo' }, { agentId: 'nope', model: 'sonnet' }]) assert.equal((await handle.actions.setting(body)).ok, false, JSON.stringify(body));
    assert.deepEqual(await handle.actions.setting({ agentId: 'sess-set', model: 'sonnet' }), { ok: true });
    assert.ok(await until(() => agent().setting?.args === 'sonnet'), 'what Claude Code said comes back');
    assert.match(agent().setting.text, /Set model to/);
    assert.equal((await handle.actions.aside({ agentId: 'sess-set', question: '  ' })).ok, false);
    const asked = await handle.actions.aside({ agentId: 'sess-set', question: 'Where does the parser live?' });
    assert.equal(asked.ok, true);
    assert.equal(agent().asides?.[0]?.pending, true, 'asked: an answer to come');
    assert.ok(await until(() => agent().asides?.[0]?.answer), 'then the answer');
    assert.deepEqual([agent().asides[0].question, agent().asides[0].answer, agent().asides[0].pending], ['Where does the parser live?', 'The parser lives in parse.mjs.', undefined]);
    assert.deepEqual(taken, [['commands', 'model', 'sonnet'], ['btw', 'Where does the parser live?', undefined]]);
    assert.match((await handle.actions.setting({ agentId: 'sess-set', compact: '' })).error, /older tracker mod \(0\.5\.0\)/, 'compacting needs mod 0.6.0');
    writeFileSync(join(root, 'state', 'mods', 'sess-set.json'), JSON.stringify({ sessionId: 'sess-set', version: '0.6.0', at: Date.now() }));
    await handle.reloadConfig();
    for (const compact of [42, 'x'.repeat(501)]) assert.equal((await handle.actions.setting({ agentId: 'sess-set', compact })).ok, false, String(compact).slice(0, 20));
    assert.deepEqual(await handle.actions.setting({ agentId: 'sess-set', compact: '  keep the API decisions\nand the test plan  ' }), { ok: true });
    assert.ok(await until(() => taken.length === 3));
    assert.deepEqual(taken[2], ['commands', 'compact', 'keep the API decisions and the test plan'], 'one line, as /compact takes it');
    assert.deepEqual(await handle.actions.setting({ agentId: 'sess-set', compact: '' }), { ok: true }, 'a note is optional');
    assert.match((await handle.actions.setting({ agentId: 'sess-set', stop: true })).error, /older tracker mod \(0\.6\.0\)/, 'stopping needs mod 0.7.0');
    writeFileSync(join(root, 'state', 'mods', 'sess-set.json'), JSON.stringify({ sessionId: 'sess-set', version: '0.7.0', at: Date.now() }));
    await handle.reloadConfig();
    assert.deepEqual(await handle.actions.setting({ agentId: 'sess-set', stop: true }), { ok: true });
    assert.ok(await until(() => taken.length === 5));
    assert.deepEqual(taken[4], ['commands', 'stop', ''], 'a stop, as Esc in its terminal');
    writeFileSync(join(root, 'state', 'mods', 'sess-set.json'), JSON.stringify({ sessionId: 'sess-set', version: '0.4.0', at: Date.now() }));
    await handle.reloadConfig();
    assert.match((await handle.actions.setting({ agentId: 'sess-set', effort: 'high' })).error, /older tracker mod \(0\.4\.0\)\. Run \/reload-plugins/, 'a mod from before switching tells you how to get the new one');
  } finally {
    clearInterval(fakeMod);
    await handle.stop();
  }
});

// A stand-in for the claude CLI: plugins, their details, MCP servers; what it was asked to change goes to a log.
function fakeClaude(dir) {
  const log = join(dir, 'claude.log'), bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh
case "$1 $2" in
  "agents --json") echo '[]' ;;
  "plugin list") echo '[{"id":"alpha@market","version":"1.0.0","enabled":true,"scope":"user","lastUpdated":"2026-10-01T00:00:00Z"},{"id":"agent-tracker@inline","version":"0.6.1","enabled":true,"scope":"user"}]' ;;
  "plugin details") printf 'alpha 1.0.0\\n  Description: Alpha things.\\n\\nComponent inventory\\n  Skills (2)  one, two\\n  Agents (0)\\n  Hooks (0)\\n  MCP servers (1)  mine\\n  LSP servers (0)\\n\\nProjected token cost\\n  Always-on:   ~1,200 tok   added to every session\\n' ;;
  "plugin enable"|"plugin disable"|"plugin update"|"plugin uninstall") echo "$*" >> "${log}"; echo "Done: $2 $3" ;;
  "mcp list") printf 'Checking MCP server health…\\n\\nmine: https://mine.example/mcp (HTTP) - ! Needs authentication\\nplugin:alpha:extra: https://extra.example/mcp (HTTP) - ✔ Connected\\n' ;;
  "mcp remove") echo "$* in $(pwd -P)" >> "${log}" ;;
esac
`, { mode: 0o755 });
  return { bin, log: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}

test("Claude Code's setup for the ⚙ dialog: plugins with their costs, MCP servers, rules; changes only to what is listed", async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-setup-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-home-setup-')));
  const claudeDir = join(home, '.claude');
  mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
  mkdirSync(join(claudeDir, 'skills', 'mine'), { recursive: true });
  writeFileSync(join(claudeDir, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\ndescription: My skill\n---\nbody');
  writeFileSync(join(claudeDir, 'settings.json'), `${JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', 'Read'] } }, null, 2)}\n`);
  const project = join(home, 'proj');
  mkdirSync(project);
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [project]: { mcpServers: { local1: {} } } } }));
  const claude = fakeClaude(home);
  const launched = [];
  const handle = await startCollector({ root, claudeDir, home, claudeBin: claude.bin, notify: () => {}, log: () => {}, launch: async args => { launched.push(args.at(-1)); return { code: 0, stdout: '', stderr: '' }; } });
  try {
    const p = await handle.claudePlugins();
    assert.deepEqual(p.plugins.map(x => [x.id, x.name, x.marketplace, x.enabled, x.details?.alwaysOn ?? null, x.managed]), [['alpha@market', 'alpha', 'market', true, 1200, true], ['agent-tracker@inline', 'agent-tracker', 'inline', true, 1200, false]]);
    assert.deepEqual(p.plugins[0].details.inventory.skills, ['one', 'two']);
    assert.deepEqual(p.skills.map(s => [s.name, s.description]), [['mine', 'My skill']]);
    for (const body of [{ id: 'alpha@market', op: 'explode' }, { id: 'nobody@x', op: 'disable' }, { id: 'agent-tracker@inline', op: 'disable' }]) assert.equal((await handle.actions.plugin(body)).ok, false, JSON.stringify(body));
    assert.deepEqual(await handle.actions.plugin({ id: 'alpha@market', op: 'disable' }), { ok: true, text: 'Done: disable alpha@market' });
    assert.match(claude.log(), /^plugin disable alpha@market$/m);

    const m = await handle.claudeMcp();
    assert.deepEqual(m.servers.map(s => [s.name, s.group, s.status, s.where]), [['mine', 'yours', 'auth', 'mine.example'], ['plugin:alpha:extra', 'plugin', 'connected', 'extra.example']]);
    assert.deepEqual(m.projects, [{ project, names: ['local1'] }]);
    assert.equal((await handle.actions.mcp({ name: 'plugin:alpha:extra', op: 'remove' })).ok, false, "a plugin's server is the plugin's");
    assert.equal((await handle.actions.mcp({ name: 'ghost', op: 'login' })).ok, false);
    assert.deepEqual(await handle.actions.mcp({ name: 'mine', op: 'login' }), { ok: true, terminal: 'Terminal' });
    assert.equal(launched.at(-1), "cd ~ && exec claude mcp login 'mine'");
    assert.deepEqual(await handle.actions.mcp({ name: 'mine', op: 'remove' }), { ok: true });
    assert.deepEqual(await handle.actions.mcp({ name: 'local1', op: 'remove', project }), { ok: true });
    assert.match(claude.log(), new RegExp(`^mcp remove mine -s user in .*\\n^mcp remove local1 -s local in ${project}$`, 'm'));

    mkdirSync(join(project, '.claude'));
    writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { deny: ['Bash(rm:*)'] } }));
    writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-proj', cwd: project, name: 'proj', status: 'idle' }));
    await handle.reloadConfig();
    const r = await handle.claudeRules();
    assert.deepEqual(r.files.map(f => [f.label, f.allow, f.deny]), [['You, everywhere', ['Bash(npm test:*)', 'Read'], []], ['proj, just you', [], ['Bash(rm:*)']]], "a project on the dashboard has its own");
    assert.equal((await handle.actions.rule({ path: '/etc/passwd', list: 'allow', value: 'Read' })).ok, false, 'only the settings files listed');
    assert.deepEqual(await handle.actions.rule({ path: join(claudeDir, 'settings.json'), list: 'allow', value: 'Read' }), { ok: true });
    assert.deepEqual(JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8')).permissions.allow, ['Bash(npm test:*)']);
  } finally {
    await handle.stop();
  }
});

test('files that are not text: a short-lived link to the bytes, for one file or a page and its folder; Word, sheets and other documents read for the reader', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-view-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-view-work-')));
  mkdirSync(join(work, 'css'));
  writeFileSync(join(work, 'picture.png'), Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  writeFileSync(join(work, 'page.html'), '<link rel="stylesheet" href="css/site.css"><h1>Hi</h1>');
  writeFileSync(join(work, 'css', 'site.css'), 'h1 { color: red }');
  writeFileSync(join(work, '.env'), 'SECRET=1');
  writeFileSync(join(work, 'notes.rtf'), '{\\rtf1\\ansi {\\b Bold} plain\\par}');
  writeFileSync(join(work, 'data.csv'), 'name,qty\nbolts,4\n');
  writeFileSync(join(work, 'deck.pptx'), 'PK fake');
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-view-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'sess-view', cwd: work, name: 'viewer', status: 'idle' }));
  writeFileSync(join(claudeDir, 'projects', '-w', 'sess-view.jsonl'), `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), cwd: work, message: { content: 'hi' } })}\n`);
  const revealed = [];
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home: '/nowhere', ticketMs: 300,
    quickLook: async real => Buffer.from(`picture of ${basename(real)}`), revealFile: async real => { revealed.push(real); return { code: 0 }; } });
  const idOf = url => url.split('/')[2];
  try {
    const pic = await handle.fileTicket('sess-view', join(work, 'picture.png'));
    assert.match(pic.url, /^\/raw\/[0-9a-f]{32}\/picture\.png$/);
    assert.deepEqual([pic.type, pic.size], ['image/png', 16]);
    assert.equal((await handle.rawFile(idOf(pic.url), 'picture.png')).real, join(work, 'picture.png'));
    assert.match((await handle.fileTicket('sess-view', join(work, '.env'))).error, /secrets/);
    assert.match((await handle.fileTicket('sess-view', '/etc/hosts')).error, /outside/);

    const page = await handle.fileTicket('sess-view', join(work, 'page.html'), { folder: true });
    assert.match(page.url, /^\/raw\/[0-9a-f]{32}\/page\.html$/);
    const id = idOf(page.url);
    assert.equal((await handle.rawFile(id, 'css/site.css')).real, join(work, 'css', 'site.css'), 'the page loads what sits beside it');
    assert.match((await handle.rawFile(id, '.env')).error, /secrets/);
    assert.match((await handle.rawFile(id, '../../etc/hosts')).error, /outside/);
    assert.equal((await handle.rawFile('0'.repeat(32), 'x')).status, 404);
    await new Promise(r => setTimeout(r, 400));
    assert.equal((await handle.rawFile(id, 'page.html')).status, 404, 'a link lasts only so long');

    assert.deepEqual(await handle.officeView('sess-view', join(work, 'data.csv')), { view: 'sheet', sheets: [{ name: 'data.csv', rows: [['name', 'qty'], ['bolts', '4']], truncated: false }] });
    const word = await handle.officeView('sess-view', join(work, 'notes.rtf')); // macOS's textutil
    assert.equal(word.view, 'word');
    assert.match(word.html, /<b>Bold<\/b>|font-weight: bold[\s\S]*Bold/);
    assert.match(word.text, /Bold plain/);
    assert.deepEqual(await handle.officeView('sess-view', join(work, 'deck.pptx')), { view: 'picture', picture: `data:image/png;base64,${Buffer.from('picture of deck.pptx').toString('base64')}` });
    assert.match((await handle.officeView('sess-view', join(work, '.env'))).error, /secrets/);

    assert.deepEqual(await handle.actions.reveal({ agentId: 'sess-view', path: join(work, 'deck.pptx') }), { ok: true });
    assert.deepEqual(revealed, [join(work, 'deck.pptx')]);
    assert.equal((await handle.actions.reveal({ agentId: 'sess-view', path: join(work, '.env') })).ok, false);
  } finally {
    await handle.stop();
  }
});

test('Open the worlds folder makes the folder, opens it in Finder only, and says when that fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-worlds-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  const worldsDir = join(realpathSync(mkdtempSync(join(tmpdir(), 'tracker-worlds-'))), 'mine');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {}, worldsDir }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-worlds-'));
  const opened = [];
  let code = 0;
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, home: '/nowhere',
    openFolder: async dir => { opened.push(dir); return { code }; } });
  try {
    assert.deepEqual(await handle.actions.revealWorlds(), { ok: true, path: worldsDir });
    assert.ok(existsSync(worldsDir), 'the folder is made');
    assert.deepEqual(opened, [worldsDir]);
    code = 1;
    const failed = await handle.actions.revealWorlds();
    assert.equal(failed.ok, false);
    assert.match(failed.error, /Finder/);
  } finally {
    await handle.stop();
  }
});

test('the helper: off by default; on, it asks a new default-named session’s mod for a name once, offers it, renames or dismisses; never a burst, never after switching off', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-helper-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-helper-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  const t = new Date().toISOString();
  const transcript = id => writeFileSync(join(claudeDir, 'projects', '-w', `${id}.jsonl`), [
    JSON.stringify({ type: 'user', timestamp: t, message: { content: 'Fix the login bug' } }),
    JSON.stringify({ type: 'assistant', timestamp: t, message: { model: 'claude-haiku', content: [{ type: 'text', text: 'The cookie expired too early.' }] } }),
    JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: t, durationMs: 1000 }),
  ].join('\n') + '\n');
  // Two sessions with default names: one started long ago (before consent), one started after.
  const reg = (pid, id, startedAt, nameSource = 'derived', name = `w-${id}`) => writeFileSync(join(claudeDir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: id, cwd: '/w', name, nameSource, status: 'idle', startedAt }));
  const old = spawn('sleep', ['60']);
  reg(old.pid, 'old-one', Date.now() - 3_600_000);
  transcript('old-one');
  mkdirSync(join(root, 'state', 'mods'), { recursive: true });
  const beacon = id => writeFileSync(join(root, 'state', 'mods', `${id}.json`), JSON.stringify({ sessionId: id, version: '0.8.0', at: Date.now() }));
  beacon('old-one');
  const taken = [];
  let answer = { ok: true, text: '"Name: Fix-Login Bug."' };
  const fakeMod = setInterval(() => {
    for (const id of ['old-one', 'new-one', 'third-one']) {
      beacon(id);
      for (const [kind, out] of [['helper', 'helper-replies'], ['commands', 'command-results']]) {
        const inbox = join(root, 'state', kind, id);
        if (!existsSync(inbox)) continue;
        for (const name of readdirSync(inbox).filter(n => n.endsWith('.json'))) {
          const req = JSON.parse(readFileSync(join(inbox, name), 'utf8'));
          unlinkSync(join(inbox, name));
          taken.push([kind, id, req.kind ?? req.command, req.args]);
          const reply = kind === 'helper' ? { id: req.id, sessionId: id, kind: 'name', ...answer, at: Date.now() } : { id: req.id, sessionId: id, command: req.command, args: req.args, ok: true, text: `Session renamed to: ${req.args}`, at: Date.now() };
          if (answer !== 'silent' || kind !== 'helper') setTimeout(() => writeFileSync(join(root, 'state', out, `${id}.${req.id}.json`), JSON.stringify(reply)), 100);
        }
      }
    }
  }, 40);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, deliveryTimeoutMs: 800 });
  const agent = id => handle.getSnapshot().agents.find(a => a.id === id);
  const until = async (ok, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { await handle.reloadConfig(); if (ok()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
  let fresh, third;
  try {
    assert.deepEqual(handle.getSnapshot().helper, { on: false, uses: { names: false, lines: false }, dailyLimit: 200, today: 0 });
    assert.equal(agent('old-one').defaultName, true);
    assert.match((await handle.actions.name({ agentId: 'old-one', op: 'suggest' })).error, /off/);
    assert.deepEqual(await handle.actions.helper({ on: true, uses: { names: true }, dailyLimit: 10 }), { ok: true, helper: { on: true, uses: { names: true, lines: false }, dailyLimit: 10, today: 0 } });
    await new Promise(r => setTimeout(r, 400));
    await handle.reloadConfig();
    assert.deepEqual(taken, [], 'no burst: a session started before you switched on is not asked by itself');
    // A new session, started after: asked once, by itself.
    fresh = spawn('sleep', ['60']);
    reg(fresh.pid, 'new-one', Date.now() + 1000);
    transcript('new-one');
    beacon('new-one');
    assert.ok(await until(() => agent('new-one')?.naming?.offer?.name === 'fix-login-bug'), 'the offer, cleaned');
    assert.deepEqual(taken, [['helper', 'new-one', 'name', undefined]]);
    assert.equal(handle.getSnapshot().helper.today, 1);
    assert.equal(JSON.stringify(handle.getSnapshot()).includes('Fix the login bug'), true, 'the transcript itself is in the feed as always…');
    assert.equal(JSON.stringify(handle.getSnapshot().helper).includes('login'), false, '…but the helper carries no text');
    await handle.reloadConfig();
    assert.equal(taken.length, 1, 'once only');
    // ✓ Rename: /rename through the commands inbox; recorded, the offer gone.
    for (const name of ['', 'x'.repeat(61), 'a;rm -rf ~']) assert.equal((await handle.actions.name({ agentId: 'new-one', op: 'rename', name })).ok, false, name);
    assert.deepEqual(await handle.actions.name({ agentId: 'new-one', op: 'rename', name: 'fix-login-bug' }), { ok: true });
    assert.deepEqual(taken.at(-1), ['commands', 'new-one', 'rename', 'fix-login-bug']);
    assert.equal(agent('new-one').naming?.offer, undefined);
    assert.equal(JSON.parse(readFileSync(join(root, 'state', 'names.json'), 'utf8'))['new-one'].outcome, 'renamed');
    // ✨ on the old one: asked though it started before; then ✕.
    assert.deepEqual(await handle.actions.name({ agentId: 'old-one', op: 'suggest' }), { ok: true });
    assert.equal(agent('old-one').naming?.asking, true);
    assert.ok(await until(() => agent('old-one')?.naming?.offer));
    assert.deepEqual(await handle.actions.name({ agentId: 'old-one', op: 'dismiss' }), { ok: true });
    assert.equal(agent('old-one').naming, undefined);
    // An answer that cleans to nothing: no offer, says why.
    answer = { ok: true, text: '🚀🚀' };
    await handle.actions.name({ agentId: 'old-one', op: 'suggest' });
    assert.ok(await until(() => agent('old-one')?.naming?.error));
    assert.match(agent('old-one').naming.error, /no usable name/);
    // A refused model: the error, and the dialog's last error.
    answer = { ok: false, error: 'model_not_found' };
    await handle.actions.name({ agentId: 'old-one', op: 'suggest' });
    assert.ok(await until(() => /model_not_found/.test(agent('old-one')?.naming?.error ?? '')));
    assert.equal(handle.getSnapshot().helper.lastError, 'model_not_found');
    // A good answer after it: the dialog's last error clears.
    answer = { ok: true, text: 'back-again' };
    await handle.actions.name({ agentId: 'old-one', op: 'suggest' });
    assert.ok(await until(() => agent('old-one')?.naming?.offer?.name === 'back-again'));
    assert.equal(handle.getSnapshot().helper.lastError, undefined, 'cleared by a good answer');
    // Switched off mid-request: withdrawn, a late answer dropped.
    answer = 'silent';
    await handle.actions.name({ agentId: 'old-one', op: 'suggest' });
    assert.equal(agent('old-one').naming?.asking, true);
    assert.equal((await handle.actions.helper({ on: false })).ok, true);
    assert.equal(agent('old-one').naming?.asking, undefined, 'withdrawn');
    writeFileSync(join(root, 'state', 'helper-replies', 'old-one.late.json'), JSON.stringify({ id: 'late', sessionId: 'old-one', kind: 'name', ok: true, text: 'too-late', at: Date.now() }));
    await handle.reloadConfig();
    assert.equal(agent('old-one').naming?.offer, undefined, 'a late answer is dropped');
    // The daily limit holds.
    await handle.actions.helper({ on: true, uses: { names: true }, dailyLimit: 5 });
    answer = { ok: true, text: 'again' };
    let r;
    for (let i = 0; i < 6; i++) { r = await handle.actions.name({ agentId: 'old-one', op: 'suggest' }); await until(() => !agent('old-one')?.naming?.asking); }
    assert.match(r.error, /daily limit of 5/);
    // Renamed in its own terminal while an automatic offer showed: the offer goes. (A third session,
    // started well after consent: switching off and on again counts as agreeing anew.)
    await handle.actions.helper({ dailyLimit: 50 });
    answer = { ok: true, text: 'third-name' };
    third = spawn('sleep', ['60']);
    reg(third.pid, 'third-one', Date.now() + 60_000);
    transcript('third-one');
    beacon('third-one');
    assert.ok(await until(() => agent('third-one')?.naming?.offer?.name === 'third-name'), 'asked by itself, once');
    reg(third.pid, 'third-one', Date.now() + 60_000, 'user', 'my-name');
    assert.ok(await until(() => agent('third-one')?.naming?.offer === undefined), 'renamed elsewhere: the stale offer goes');
    // Codex and unknown sessions; a bad op.
    for (const body of [{ agentId: 'nope', op: 'suggest' }, { agentId: 'old-one', op: 'shout' }, null]) assert.equal((await handle.actions.name(body)).ok, false, JSON.stringify(body));
  } finally {
    clearInterval(fakeMod);
    old.kill();
    fresh?.kill();
    third?.kill();
    await handle.stop();
  }
});

test('a request with no answer in 30 seconds is withdrawn, and says so', async () => {
  // Uses the helperTimeoutMs injection, so the test needs no 30-second wait.
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-helper-to-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-helper-to-'));
  mkdirSync(join(claudeDir, 'sessions'));
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'quiet', cwd: '/w', name: 'w-q', nameSource: 'derived', status: 'idle', startedAt: 1 }));
  mkdirSync(join(root, 'state', 'mods'), { recursive: true });
  writeFileSync(join(root, 'state', 'mods', 'quiet.json'), JSON.stringify({ sessionId: 'quiet', version: '0.8.0', at: Date.now() }));
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, helperTimeoutMs: 300 });
  const agent = () => handle.getSnapshot().agents.find(a => a.id === 'quiet');
  try {
    await handle.actions.helper({ on: true, uses: { names: true } });
    assert.deepEqual(await handle.actions.name({ agentId: 'quiet', op: 'suggest' }), { ok: true });
    const file = readdirSync(join(root, 'state', 'helper', 'quiet'))[0];
    await new Promise(r => setTimeout(r, 400));
    await handle.reloadConfig();
    assert.match(agent().naming.error, /no answer in 30 seconds/);
    assert.equal(existsSync(join(root, 'state', 'helper', 'quiet', file)), false, 'the request is withdrawn');
  } finally {
    await handle.stop();
  }
});

test('the collector starts and runs with a damaged helper.json or names.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-helper-bad-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, 'state', 'helper.json'), 'null');
  writeFileSync(join(root, 'state', 'names.json'), 'null');
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-helper-bad-'));
  mkdirSync(join(claudeDir, 'sessions'));
  writeFileSync(join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'odd', cwd: '/w', name: 'w-o', nameSource: 'derived', status: 'idle', startedAt: Date.now() }));
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {} });
  try {
    assert.equal(handle.getSnapshot().helper.on, false);
    assert.ok(handle.getSnapshot().agents.some(a => a.id === 'odd'), 'the dashboard still shows its sessions');
  } finally {
    await handle.stop();
  }
});

test('Animal lines: a live cast and a 0.9.0 session get a batch; the reply’s good rows become chatter; unticking withdraws and clears; no session is said', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-lines-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-lines-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  const proc = spawn('sleep', ['60']);
  writeFileSync(join(claudeDir, 'sessions', `${proc.pid}.json`), JSON.stringify({ pid: proc.pid, sessionId: 'helper-one', cwd: '/w', name: 'helper-one', nameSource: 'user', status: 'idle', startedAt: Date.now() }));
  writeFileSync(join(claudeDir, 'projects', '-w', 'helper-one.jsonl'), JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: 'hello' } }) + '\n');
  mkdirSync(join(root, 'state', 'mods'), { recursive: true });
  let version = '0.8.0', reply = { ok: true, text: 'Lines:\ncow|idle|MOO. all good here\ncow|idle|' + 'x'.repeat(41) + '\ndragon|idle|rawr' };
  const asked = [];
  const fakeMod = setInterval(() => {
    writeFileSync(join(root, 'state', 'mods', 'helper-one.json'), JSON.stringify({ sessionId: 'helper-one', version, at: Date.now() }));
    const inbox = join(root, 'state', 'helper', 'helper-one');
    if (!existsSync(inbox)) return;
    for (const name of readdirSync(inbox).filter(n => n.endsWith('.json'))) {
      const req = JSON.parse(readFileSync(join(inbox, name), 'utf8'));
      unlinkSync(join(inbox, name));
      asked.push(req);
      if (reply === 'silent') continue;
      mkdirSync(join(root, 'state', 'helper-replies'), { recursive: true });
      setTimeout(() => writeFileSync(join(root, 'state', 'helper-replies', `helper-one.${req.id}.json`), JSON.stringify({ id: req.id, sessionId: 'helper-one', kind: req.kind, ...reply, at: Date.now() })), 50);
    }
  }, 40);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, helperTimeoutMs: 600, linesGapMs: 200, linesIdleMs: 400 });
  const snap = () => handle.getSnapshot();
  const until = async (ok, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { await handle.reloadConfig(); if (ok()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
  try {
    assert.equal(snap().chatter, null);
    assert.deepEqual(snap().helper.uses, { names: false, lines: false });
    assert.deepEqual(await handle.actions.animals({ cast: 'cow' }), { ok: false, error: 'That is not a cast of animals.' });
    assert.deepEqual(await handle.actions.animals({ cast: [{ kind: 'cow', name: 'Cow' }] }), { ok: true });
    await new Promise(r => setTimeout(r, 300));
    await handle.reloadConfig();
    assert.deepEqual(asked, [], 'off: nothing asked');
    await handle.actions.helper({ on: true, uses: { lines: true } });
    assert.ok(await until(() => snap().helper.linesBlocked === 'no-session'), 'mod 0.8.0: no session can run it, and the snapshot says so');
    assert.deepEqual(asked, []);
    version = '0.9.0';
    assert.ok(await until(() => snap().chatter?.lines?.length === 1), 'a batch, its good rows kept');
    assert.deepEqual(snap().chatter.lines, [{ kind: 'cow', when: 'idle', text: 'MOO. all good here' }]);
    assert.equal(snap().helper.linesBlocked, undefined);
    assert.equal(asked[0].kind, 'lines');
    assert.deepEqual(asked[0].cast, [{ kind: 'cow' }], 'kinds only: the world’s own names for its animals stay on the page');
    assert.deepEqual(Object.keys(asked[0]).sort(), ['agents', 'at', 'cast', 'counts', 'events', 'id', 'kind']);
    assert.equal(JSON.stringify(asked[0]).includes('/w'), false, 'no path in a request');
    assert.equal(snap().helper.today >= 1, true, 'counted');
    assert.deepEqual(await handle.actions.animals({ cast: [{ kind: 'robodog', name: 'Robot dog' }] }), { ok: true });
    assert.ok(await until(() => snap().helper.linesBlocked === 'no-session'), 'a robot dog on screen: mod 0.9.0 would drop it, so no session runs the batch');
    const beforeNewer = asked.length;
    version = '0.9.1';
    assert.ok(await until(() => asked.length > beforeNewer), 'mod 0.9.1 runs it');
    assert.deepEqual(asked.at(-1).cast, [{ kind: 'cow' }, { kind: 'robodog' }]);
    reply = { ok: false, error: 'model_not_found' };
    assert.ok(await until(() => snap().helper.lastError === 'model_not_found'), 'a failed batch: the error is said');
    assert.equal(snap().chatter.lines.length, 1, '…and the last good batch stays');
    reply = 'silent';
    const before = asked.length;
    assert.ok(await until(() => asked.length > before));
    assert.equal((await handle.actions.helper({ uses: { names: true, lines: false } })).ok, true); // names kept ticked: the helper stays on
    await handle.reloadConfig();
    assert.equal(snap().chatter, null, 'unticked: chatter cleared');
    assert.equal(existsSync(join(root, 'state', 'helper', 'helper-one')) && readdirSync(join(root, 'state', 'helper', 'helper-one')).some(n => n.endsWith('.json')), false, 'nothing waiting');
  } finally {
    clearInterval(fakeMod);
    proc.kill();
    await handle.stop();
  }
});

test('Animal lines ticked again: a batch goes out at once, not after the 30-minute wait', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-root-relines-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ port: 0, deployRepos: {} }));
  const claudeDir = mkdtempSync(join(tmpdir(), 'tracker-claude-relines-'));
  mkdirSync(join(claudeDir, 'sessions'));
  mkdirSync(join(claudeDir, 'projects', '-w'), { recursive: true });
  const proc = spawn('sleep', ['60']);
  writeFileSync(join(claudeDir, 'sessions', `${proc.pid}.json`), JSON.stringify({ pid: proc.pid, sessionId: 'helper-two', cwd: '/w', name: 'helper-two', nameSource: 'user', status: 'idle', startedAt: Date.now() }));
  writeFileSync(join(claudeDir, 'projects', '-w', 'helper-two.jsonl'), JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: 'hello' } }) + '\n');
  mkdirSync(join(root, 'state', 'mods'), { recursive: true });
  let n = 0;
  const fakeMod = setInterval(() => {
    writeFileSync(join(root, 'state', 'mods', 'helper-two.json'), JSON.stringify({ sessionId: 'helper-two', version: '0.9.0', at: Date.now() }));
    const inbox = join(root, 'state', 'helper', 'helper-two');
    if (!existsSync(inbox)) return;
    for (const name of readdirSync(inbox).filter(x => x.endsWith('.json'))) {
      const req = JSON.parse(readFileSync(join(inbox, name), 'utf8'));
      unlinkSync(join(inbox, name));
      n += 1;
      mkdirSync(join(root, 'state', 'helper-replies'), { recursive: true });
      writeFileSync(join(root, 'state', 'helper-replies', `helper-two.${req.id}.json`), JSON.stringify({ id: req.id, sessionId: 'helper-two', kind: req.kind, ok: true, text: `cow|idle|batch ${n}`, at: Date.now() }));
    }
  }, 40);
  const handle = await startCollector({ root, claudeDir, claudeBin: '/usr/bin/false', notify: () => {}, log: () => {}, linesGapMs: 300_000, linesIdleMs: 1_800_000 });
  const snap = () => handle.getSnapshot();
  const until = async (ok, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { await handle.reloadConfig(); if (ok()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
  try {
    await handle.actions.animals({ cast: [{ kind: 'cow', name: 'Cow' }] });
    await handle.actions.helper({ on: true, uses: { names: true, lines: true } });
    assert.ok(await until(() => snap().chatter?.lines?.[0]?.text === 'batch 1'), 'the first batch');
    await handle.actions.helper({ uses: { names: true, lines: false } });
    await handle.reloadConfig();
    assert.equal(snap().chatter, null);
    await handle.actions.helper({ uses: { names: true, lines: true } });
    assert.ok(await until(() => snap().chatter?.lines?.[0]?.text === 'batch 2', 3000), 'ticked again: a batch at once');
  } finally {
    clearInterval(fakeMod);
    proc.kill();
    await handle.stop();
  }
});
