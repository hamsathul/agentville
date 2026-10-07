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
