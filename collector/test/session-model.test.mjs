import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionModel } from '../transcript/session-model.mjs';
import { at, modelOf, prompt, reply, title, toolResult, toolUse, turnEnd } from './fixtures.mjs';

test('a finished tool call is marked ok with its duration and is no longer pending', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(1, 't1', 'Bash', { command: 'ls' }), toolResult(3, 't1'));
  assert.equal(m.pending.size, 0);
  assert.equal(m.feed[0].tool, 'Bash');
  assert.equal(m.feed[0].ok, true);
  assert.equal(m.feed[0].durationMs, 2000);
});

test('an errored tool call is marked not ok', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(1, 't1', 'Bash', { command: 'false' }), toolResult(2, 't1', true));
  assert.equal(m.feed[0].ok, false);
});

test('a question to the user stays pending until answered', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'q1', 'AskUserQuestion', { questions: [{ question: 'Ship?' }] }));
  assert.equal(m.latestPending().name, 'AskUserQuestion');
  assert.equal(m.latestPending().at, at(5));
});

test('turn_end clears anything still pending and closes the turn', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(1, 't1', 'Bash'), turnEnd(2));
  assert.equal(m.pending.size, 0);
  assert.equal(m.turnOpen, false);
  assert.equal(m.lastTurnEndAt, at(2));
});

test('a new prompt abandons an interrupted call', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 't1', 'Bash', { command: 'sleep 100' }), prompt(9, 'again'));
  assert.equal(m.pending.size, 0);
  assert.equal(m.lastPrompt, 'again');
  assert.equal(m.turnOpen, true);
});

test('Agent, Workflow and background Bash calls become children', () => {
  const m = modelOf(
    prompt(0, 'go'),
    toolUse(1, 'a1', 'Agent', { description: 'Find routes' }),
    toolUse(2, 'a2', 'Agent', { description: 'Bg agent', run_in_background: true }),
    toolUse(3, 'b1', 'Bash', { command: 'npm run dev', run_in_background: true }),
    toolUse(4, 'a3', 'Agent', { description: 'Broken' }),
  );
  assert.equal(m.children.get('a1').state, 'running');
  m.applyLines([toolResult(30, 'a1'), toolResult(5, 'a2'), toolResult(6, 'b1'), toolResult(7, 'a3', true)]);
  assert.equal(m.children.get('a1').state, 'done');
  assert.equal(m.children.get('a2').state, 'unknown');
  assert.equal(m.children.get('b1').kind, 'bgjob');
  assert.equal(m.children.get('b1').state, 'unknown');
  assert.equal(m.children.get('a3').state, 'failed');
  assert.equal(m.children.get('a1').label, 'Find routes');
});

test('the feed is newest first and capped', () => {
  const m = new SessionModel({ feedCap: 3 });
  m.applyLines([prompt(1, 'p1'), prompt(2, 'p2'), prompt(3, 'p3'), prompt(4, 'p4'), prompt(5, 'p5')]);
  assert.deepEqual(m.feed.map(f => f.text), ['p5', 'p4', 'p3']);
});

test('malformed lines are skipped and activity follows timestamps', () => {
  const m = modelOf('{ not json', prompt(0, 'go'), reply(7, 'Done.\nMore detail'));
  assert.equal(m.lastActivityAt, at(7));
  assert.equal(m.lastReply, 'Done.');
});

test('title, model and context size come from the transcript; synthetic models are ignored', () => {
  const m = modelOf(title('Fix invoices'), prompt(0, 'go'), reply(1, 'ok'));
  m.applyLine(JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'API error' }] } }));
  assert.equal(m.title, 'Fix invoices');
  assert.equal(m.model, 'claude-opus-5-5');
  assert.equal(m.contextTokens, 1100);
});

test('callsSince returns calls at or after a time', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(1, 't1', 'Read', { file_path: '/a' }), toolUse(10, 't2', 'Read', { file_path: '/b' }));
  assert.deepEqual(m.callsSince(at(5)).map(c => c.id), ['t2']);
});

test('markdown files written, edited or read are remembered as documents, newest first', () => {
  const m = modelOf(
    prompt(0, 'go'),
    toolUse(1, 'a', 'Read', { file_path: '/w/README.md' }),
    toolUse(2, 'b', 'Write', { file_path: '/w/docs/spec.md', content: '# Spec' }),
    toolUse(3, 'c', 'Edit', { file_path: '/w/src/app.ts' }),
    toolUse(4, 'd', 'Read', { file_path: '/w/docs/spec.md' }),
    toolUse(5, 'e', 'Edit', { file_path: 'notes/plan.markdown' }, '/w'),
  );
  assert.deepEqual(m.documents(), [
    { path: '/w/notes/plan.markdown', wrote: true, at: at(5) },
    { path: '/w/docs/spec.md', wrote: true, at: at(4) },
    { path: '/w/README.md', wrote: false, at: at(1) },
  ]);
});

test('only the 40 most recent documents are kept', () => {
  const lines = [prompt(0, 'go')];
  for (let i = 1; i <= 45; i++) lines.push(toolUse(i, `t${i}`, 'Read', { file_path: `/w/d${i}.md` }));
  const docs = modelOf(...lines).documents();
  assert.equal(docs.length, 40);
  assert.equal(docs[0].path, '/w/d45.md');
  assert.equal(docs.at(-1).path, '/w/d6.md');
});

test('every file the session wrote, edited or read is remembered for the explorer, newest first', () => {
  const m = modelOf(
    prompt(0, 'go'),
    toolUse(1, 'a', 'Read', { file_path: '/w/src/a.ts' }),
    toolUse(2, 'b', 'Edit', { file_path: '/w/src/b.ts' }),
    toolUse(3, 'c', 'NotebookEdit', { notebook_path: '/w/n.ipynb' }),
    toolUse(4, 'd', 'Read', { file_path: '/w/src/b.ts' }),
    toolUse(5, 'e', 'Bash', { command: 'ls' }),
  );
  assert.deepEqual(m.touchedFiles(), [
    { path: '/w/src/b.ts', wrote: true, at: at(4) },
    { path: '/w/n.ipynb', wrote: true, at: at(3) },
    { path: '/w/src/a.ts', wrote: false, at: at(1) },
  ]);
  assert.deepEqual(m.documents(), []);
});

test("a subagent remembers its type, so the farm can draw an Explore subagent as a dog", () => {
  const m = modelOf(
    prompt(0, 'go'),
    toolUse(1, 'e1', 'Agent', { description: 'Find routes', subagent_type: 'Explore' }),
    toolUse(2, 'g1', 'Task', { description: 'Plain' }),
    toolUse(3, 'b1', 'Bash', { command: 'npm run dev', run_in_background: true }),
  );
  assert.equal(m.children.get('e1').agentType, 'Explore');
  assert.equal(m.children.get('g1').agentType, undefined);
  assert.equal(m.children.get('b1').agentType, undefined);
});

test('files found earlier in the transcript are merged in as older, never overriding newer ones', () => {
  const m = modelOf(prompt(10, 'go'), toolUse(11, 'a', 'Read', { file_path: '/w/spec.md' }), toolUse(12, 'b', 'Edit', { file_path: '/w/b.ts' }));
  m.addEarlierFiles([
    { name: 'Write', input: { file_path: '/w/spec.md' }, at: at(1), cwd: '/w' },
    { name: 'Read', input: { file_path: '/w/old.md' }, at: at(2), cwd: '/w' },
    { name: 'Edit', input: { file_path: 'rel.ts' }, at: at(3), cwd: '/w' },
  ]);
  assert.deepEqual(m.touchedFiles(), [
    { path: '/w/b.ts', wrote: true, at: at(12) },
    { path: '/w/spec.md', wrote: true, at: at(11) },
    { path: '/w/rel.ts', wrote: true, at: at(3) },
    { path: '/w/old.md', wrote: false, at: at(2) },
  ]);
  assert.deepEqual(m.documents().map(d => d.path), ['/w/spec.md', '/w/old.md']);
});

test('prompts and replies keep their whole text, line breaks and all, for the conversation view', () => {
  const long = `First line\n\n${'y'.repeat(700)}\n\nThe end.`;
  const m = modelOf(prompt(0, 'Fix the build\nthen run the tests'), reply(1, long));
  const [r, p] = m.feed;
  assert.equal(p.text, 'Fix the build');
  assert.equal(p.body, 'Fix the build\nthen run the tests');
  assert.equal(r.text, 'First line');
  assert.equal(r.body, long);
});

test('a message past 20,000 characters is cut there, and says so', () => {
  const [r] = modelOf(reply(1, 'x'.repeat(25_000))).feed;
  assert.equal(r.body.length, 20_001);
  assert.ok(r.body.endsWith('…'));
});

test("the turn's final reply is kept whole; a later tool call or prompt clears it", () => {
  const long = `Done.\n\n${'z'.repeat(1000)}\n\nShould I push?`;
  const m = modelOf(prompt(0, 'go'), reply(1, 'Checking.'), toolUse(2, 't1', 'Bash'), toolResult(3, 't1'), reply(4, long), turnEnd(5));
  assert.equal(m.finalReply, long);
  m.applyLines([prompt(6, 'yes')]);
  assert.equal(m.finalReply, null);
  m.applyLines([reply(7, 'Pushing.'), toolUse(8, 't2', 'Bash')]);
  assert.equal(m.finalReply, null);
});

test('the conversation is kept apart from tool steps, so a busy session does not push your messages out', () => {
  const m = new SessionModel({ feedCap: 5 });
  m.applyLines([prompt(1, 'first ask'), reply(2, 'on it'), ...Array.from({ length: 12 }, (_, i) => toolUse(3 + i, `t${i}`, 'Bash', { command: `step ${i}` }))]);
  assert.ok(!m.feed.some(f => f.kind === 'prompt'), 'the tool steps filled the feed');
  const all = m.history(200);
  assert.deepEqual(all.filter(f => f.kind !== 'tool').map(f => f.text), ['on it', 'first ask']);
  assert.deepEqual(all.map(f => f.at), [...all.map(f => f.at)].sort((x, y) => y - x), 'newest first');
  const recent = m.recent(4, 10);
  assert.deepEqual(recent.filter(f => f.kind !== 'tool').map(f => f.text), ['on it', 'first ask'], 'the snapshot carries the latest messages too');
  assert.equal(recent.filter(f => f.kind === 'tool').length, 4);
});

test('messages found earlier in the transcript are added as older ones, without repeating any', () => {
  const m = modelOf(prompt(20, 'latest ask'), reply(21, 'latest reply'));
  m.addEarlierSaid([
    { kind: 'prompt', text: 'old ask', at: at(1) },
    { kind: 'reply', text: 'old reply\nwith detail', at: at(2) },
    { kind: 'prompt', text: 'latest ask', at: at(20) },
  ]);
  assert.deepEqual(m.history(50).map(f => [f.kind, f.text, f.body]), [
    ['reply', 'latest reply', 'latest reply'],
    ['prompt', 'latest ask', 'latest ask'],
    ['reply', 'old reply', 'old reply\nwith detail'],
    ['prompt', 'old ask', 'old ask'],
  ]);
});

test('tool steps carry the kind of work, and so does the pending one', () => {
  const m = modelOf(prompt(1, 'go'), toolUse(2, 'a', 'Bash', { command: 'npm test' }), toolResult(3, 'a'), toolUse(4, 'b', 'Bash', { command: 'git push' }));
  assert.deepEqual(m.feed.filter(f => f.kind === 'tool').map(f => f.step), ['push', 'test']);
});
