import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from 'node:path';
import { SessionModel } from '../transcript/session-model.mjs';
import { at, modelOf, prompt, reply, title, toolResult, toolUse, turnEnd } from './fixtures.mjs';

// Fixture paths are written POSIX-style; on Windows they get a drive so they are absolute there too.
const P = p => normalize(process.platform === 'win32' ? `C:${p}` : p);

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
    toolUse(1, 'a', 'Read', { file_path: P('/w/README.md') }),
    toolUse(2, 'b', 'Write', { file_path: P('/w/docs/spec.md'), content: '# Spec' }),
    toolUse(3, 'c', 'Edit', { file_path: P('/w/src/app.ts') }),
    toolUse(4, 'd', 'Read', { file_path: P('/w/docs/spec.md') }),
    toolUse(5, 'e', 'Edit', { file_path: 'notes/plan.markdown' }, P('/w')),
  );
  assert.deepEqual(m.documents(), [
    { path: P('/w/notes/plan.markdown'), wrote: true, at: at(5) },
    { path: P('/w/docs/spec.md'), wrote: true, at: at(4) },
    { path: P('/w/README.md'), wrote: false, at: at(1) },
  ]);
});

test('pictures, videos and PDFs it wrote or read count as documents too (a screenshot it checked, say); code does not', () => {
  const m = modelOf(prompt(0, 'go'),
    toolUse(1, 'a', 'Read', { file_path: P('/w/shots/login.png') }),
    toolUse(2, 'b', 'Write', { file_path: P('/w/report.pdf'), content: 'x' }),
    toolUse(3, 'c', 'Edit', { file_path: P('/w/src/app.ts') }),
    toolUse(4, 'd', 'Read', { file_path: P('/w/demo.mov') }));
  assert.deepEqual(m.documents().map(d => d.path), [P('/w/demo.mov'), P('/w/report.pdf'), P('/w/shots/login.png')]);
});

test('only the 40 most recent documents are kept', () => {
  const lines = [prompt(0, 'go')];
  for (let i = 1; i <= 45; i++) lines.push(toolUse(i, `t${i}`, 'Read', { file_path: P(`/w/d${i}.md`) }));
  const docs = modelOf(...lines).documents();
  assert.equal(docs.length, 40);
  assert.equal(docs[0].path, P('/w/d45.md'));
  assert.equal(docs.at(-1).path, P('/w/d6.md'));
});

test('every file the session wrote, edited or read is remembered for the explorer, newest first', () => {
  const m = modelOf(
    prompt(0, 'go'),
    toolUse(1, 'a', 'Read', { file_path: P('/w/src/a.ts') }),
    toolUse(2, 'b', 'Edit', { file_path: P('/w/src/b.ts') }),
    toolUse(3, 'c', 'NotebookEdit', { notebook_path: P('/w/n.ipynb') }),
    toolUse(4, 'd', 'Read', { file_path: P('/w/src/b.ts') }),
    toolUse(5, 'e', 'Bash', { command: 'ls' }),
  );
  assert.deepEqual(m.touchedFiles(), [
    { path: P('/w/src/b.ts'), wrote: true, at: at(4) },
    { path: P('/w/n.ipynb'), wrote: true, at: at(3) },
    { path: P('/w/src/a.ts'), wrote: false, at: at(1) },
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
  const m = modelOf(prompt(10, 'go'), toolUse(11, 'a', 'Read', { file_path: P('/w/spec.md') }), toolUse(12, 'b', 'Edit', { file_path: P('/w/b.ts') }));
  m.addEarlierFiles([
    { name: 'Write', input: { file_path: P('/w/spec.md') }, at: at(1), cwd: P('/w') },
    { name: 'Read', input: { file_path: P('/w/old.md') }, at: at(2), cwd: P('/w') },
    { name: 'Edit', input: { file_path: 'rel.ts' }, at: at(3), cwd: P('/w') },
  ]);
  assert.deepEqual(m.touchedFiles(), [
    { path: P('/w/b.ts'), wrote: true, at: at(12) },
    { path: P('/w/spec.md'), wrote: true, at: at(11) },
    { path: P('/w/rel.ts'), wrote: true, at: at(3) },
    { path: P('/w/old.md'), wrote: false, at: at(2) },
  ]);
  assert.deepEqual(m.documents().map(d => d.path), [P('/w/spec.md'), P('/w/old.md')]);
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

test('a finished call remembers whether it worked and when it ended', () => {
  const m = modelOf(prompt(1, 'go'), toolUse(2, 'a', 'Bash', { command: './deploy.sh' }), toolResult(9, 'a'), toolUse(10, 'b', 'Bash', { command: 'false' }), toolResult(11, 'b', true), toolUse(12, 'c', 'Bash', { command: 'sleep 9' }));
  assert.deepEqual(m.calls.map(c => [c.id, c.ok, c.endedAt]), [['a', true, at(9)], ['b', false, at(11)], ['c', undefined, undefined]]);
});

test("a background command has not worked or failed when it starts, only when its notice says so; its job says the same", () => {
  const notice = (sec, id, status) => JSON.stringify({ type: 'user', timestamp: new Date(at(sec)).toISOString(), origin: { kind: 'task-notification' }, message: { content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n</task-notification>` } });
  const m = modelOf(prompt(1, 'go'), toolUse(2, 'bg', 'Bash', { command: './deploy.sh', run_in_background: true }), toolResult(2, 'bg'), toolUse(3, 'bg2', 'Bash', { command: './other.sh', run_in_background: true }), toolResult(3, 'bg2'));
  assert.equal(m.calls[0].ok, undefined, 'started, not finished');
  m.applyLines([notice(40, 'bg', 'completed'), notice(41, 'bg2', 'failed')]);
  assert.deepEqual(m.calls.map(c => [c.id, c.ok, c.endedAt]), [['bg', true, at(40)], ['bg2', false, at(41)]]);
  assert.deepEqual([...m.children.values()].map(c => c.state), ['done', 'failed']);
});

test('the session remembers its latest permission mode', () => {
  const m = modelOf(prompt(1, 'go', { permissionMode: 'default' }), prompt(5, 'again', { permissionMode: 'acceptEdits' }));
  assert.equal(m.permissionMode, 'acceptEdits');
});

test('messages between sessions go into the conversation: from another session, to another session, to a helper; each once', () => {
  const peer = (sec, id, text) => JSON.stringify({ type: 'user', timestamp: new Date(at(sec)).toISOString(), origin: { kind: 'peer', verifiedPeerPid: 42, msg_id: id, name: 'shop-api-3' }, message: { content: `<cross-session-message from-name="shop-api-3">\n${text}\n</cross-session-message>` } });
  const m = modelOf(prompt(1, 'go'), peer(2, 'm1', 'Hold the deploy.'), peer(3, 'm1', 'Hold the deploy.'),
    toolUse(4, 's1', 'SendMessage', { to: 'shop-api-3', summary: 'Holding', message: 'Holding until you say so.' }),
    toolUse(5, 's2', 'SendMessage', { to: 'aed8a9f3e491b8ac1', message: 'Fix round 1' }));
  const mail = m.history(50).filter(f => f.kind === 'peer').map(f => [f.dir, f.other, f.text, f.helper ?? false]);
  assert.deepEqual(mail, [['out', 'aed8a9f3e491b8ac1', 'Fix round 1', true], ['out', 'shop-api-3', 'Holding until you say so.', false], ['in', 'shop-api-3', 'Hold the deploy.', false]]);
  assert.equal(m.history(50).find(f => f.kind === 'peer' && f.dir === 'out' && !f.helper).summary, 'Holding');
});

// The task list: TaskCreate's result names the item, TaskUpdate moves it on; TodoWrite sends the whole list.
const taskResult = (sec, id, taskId) => JSON.stringify({ type: 'user', timestamp: new Date(at(sec)).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `Task #${taskId} created successfully: x` }] }, toolUseResult: { task: { id: taskId, subject: 'x' } } });

test('the task list follows TaskCreate and TaskUpdate: items are made, started, finished and deleted', () => {
  const m = modelOf(
    prompt(0, 'go'),
    toolUse(1, 'c1', 'TaskCreate', { subject: 'Write the parser', activeForm: 'Writing the parser' }), taskResult(2, 'c1', '1'),
    toolUse(3, 'c2', 'TaskCreate', { subject: 'Test it', activeForm: 'Testing it' }), taskResult(4, 'c2', '2'),
    toolUse(5, 'c3', 'TaskCreate', { subject: 'Scratch' }), taskResult(6, 'c3', '3'),
    toolUse(7, 'u1', 'TaskUpdate', { taskId: '1', status: 'completed' }), toolResult(8, 'u1'),
    toolUse(9, 'u2', 'TaskUpdate', { taskId: '2', status: 'in_progress' }), toolResult(10, 'u2'),
    toolUse(11, 'u3', 'TaskUpdate', { taskId: '3', status: 'deleted' }), toolResult(12, 'u3'),
    toolUse(13, 'u4', 'TaskUpdate', { taskId: '99', status: 'completed' }), toolResult(14, 'u4'), // one from before what was read: no subject to show
  );
  assert.deepEqual(m.tasks().map(t => [t.id, t.subject, t.status]), [['1', 'Write the parser', 'completed'], ['2', 'Test it', 'in_progress']]);
});

test('a TodoWrite list replaces the whole task list', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(1, 'w1', 'TodoWrite', { todos: [{ content: 'Plan', status: 'completed', activeForm: 'Planning' }, { content: 'Build', status: 'in_progress', activeForm: 'Building' }, { content: 'Ship', status: 'weird' }] }));
  assert.deepEqual(m.tasks().map(t => [t.subject, t.status, t.activeForm]), [['Plan', 'completed', 'Planning'], ['Build', 'in_progress', 'Building'], ['Ship', 'pending', '']]);
});

test('compactions are counted, the latest remembered', () => {
  const compact = sec => JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: new Date(at(sec)).toISOString(), compactMetadata: { trigger: 'auto', preTokens: 180000 } });
  const m = modelOf(prompt(0, 'go'), compact(10), reply(11, 'on'), compact(40));
  assert.equal(m.compactions, 2);
  assert.equal(m.lastCompactAt, at(40));
});

test('a subagent keeps the prompt it was given, and its result and when it finished; every model counts its tool steps', () => {
  const done = JSON.stringify({ type: 'user', timestamp: new Date(at(9)).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'tA', content: [{ type: 'text', text: 'No blocking issues.\nTwo nits in order.ts.' }] }] } });
  const m = modelOf(prompt(0, 'go'), toolUse(1, 'tA', 'Agent', { description: 'Review it', subagent_type: 'code-reviewer', prompt: `Review the change.\n${'details '.repeat(800)}` }), toolUse(2, 'tB', 'Bash', { command: 'ls' }), done);
  const c = m.children.get('tA');
  assert.equal(c.agentType, 'code-reviewer');
  assert.match(c.prompt, /^Review the change\.\n/);
  assert.equal(c.prompt.length, 4000, 'its prompt, up to 4,000 characters');
  assert.equal(c.state, 'done');
  assert.equal(c.endedAt, at(9));
  assert.equal(c.result, 'No blocking issues.\nTwo nits in order.ts.');
  assert.equal(m.toolCount, 2);
});

test('a subagent launched in the background keeps running past its launch, until its notice says it finished, with its result', () => {
  const launched = JSON.stringify({ type: 'user', timestamp: new Date(at(2)).toISOString(), toolUseResult: { isAsync: true, status: 'async_launched' }, message: { content: [{ type: 'tool_result', tool_use_id: 'tA', content: 'Async agent launched successfully.' }] } });
  const notice = (sec, status) => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(at(sec)).toISOString(), content: `<task-notification>\n<tool-use-id>tA</tool-use-id>\n<status>${status}</status>\n<result>Found 3 callers.</result>\n</task-notification>` });
  const m = modelOf(prompt(0, 'go'), toolUse(1, 'tA', 'Agent', { description: 'Find callers', prompt: 'Find them' }), launched);
  const c = m.children.get('tA');
  assert.deepEqual([c.state, c.endedAt, c.result], ['running', undefined, undefined], 'its launch is not its end');
  m.applyLine(notice(30, 'completed'));
  assert.deepEqual([c.state, c.endedAt, c.result], ['done', at(30), 'Found 3 callers.']);
  m.applyLine(notice(45, 'completed'));
  assert.equal(c.endedAt, at(30), 'the same notice again (queued, then handed over) is not a later end');
  m.applyLine(notice(60, 'failed'));
  assert.deepEqual([c.state, c.endedAt], ['failed', at(60)], 'resumed and stopped again: the latest notice says');
});

test('fast mode is read from the latest reply', () => {
  const fast = speed => JSON.stringify({ type: 'assistant', timestamp: new Date(at(3)).toISOString(), message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, speed } } });
  assert.equal(modelOf(prompt(0, 'go'), fast('fast')).fast, true);
  assert.equal(modelOf(prompt(0, 'go'), fast('fast'), fast('standard')).fast, false);
});

test('a model set with /model shows at once, and stays until a reply comes from another model', () => {
  const set = name => JSON.stringify({ type: 'user', timestamp: new Date(at(2)).toISOString(), origin: { kind: 'plugin' }, message: { content: `<local-command-stdout>Set model to \`${name}\` and saved as your default for new sessions</local-command-stdout>` } });
  const from = (sec, model) => JSON.stringify({ type: 'assistant', timestamp: new Date(at(sec)).toISOString(), message: { model, role: 'assistant', content: [{ type: 'text', text: 'hi' }] } });
  const m = modelOf(prompt(0, 'go'), from(1, 'claude-opus-4-8'), set('Opus 5.5 (1M context)'));
  assert.equal(m.model, 'claude-opus-4-8');
  assert.equal(m.modelSet, 'Opus 5.5 (1M context)', 'before its next reply');
  m.applyLine(from(3, 'claude-opus-5-5'));
  assert.equal(m.modelSet, 'Opus 5.5 (1M context)', 'its reply came from that model: the 1M context is still worth saying');
  m.applyLine(from(4, 'claude-sonnet-5-5-20260901'));
  assert.equal(m.modelSet, null, 'another model answered');
  assert.equal(modelOf(set('Haiku 4.5'), from(3, 'claude-haiku-4-5-20251001')).modelSet, 'Haiku 4.5');
});

test('a scheduled wake-up is remembered until the next turn begins', () => {
  const wake = toolUse(5, 'w1', 'ScheduleWakeup', { delaySeconds: 1200, reason: 'watching CI', prompt: '/loop check' });
  const waiting = modelOf(prompt(0, '/loop check'), wake, toolResult(6, 'w1'), turnEnd(7));
  assert.equal(waiting.wakeAt, at(5) + 1_200_000);
  const woken = modelOf(prompt(0, '/loop check'), wake, toolResult(6, 'w1'), turnEnd(7), JSON.stringify({ type: 'user', timestamp: new Date(at(1300)).toISOString(), origin: { kind: 'scheduled' }, message: { content: '/loop check' } }));
  assert.equal(woken.wakeAt, 0);
  assert.equal(modelOf(prompt(0, '/loop check'), wake, toolResult(6, 'w1'), turnEnd(7), prompt(30, 'actually stop')).wakeAt, 0, 'you spoke first');
});

test('task changes and compactions from earlier in the transcript come before the ones read', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'u1', 'TaskUpdate', { taskId: '1', status: 'completed' }));
  m.addEarlierTasks({ ops: [{ op: 'create', id: '1', subject: 'Early task', activeForm: '', at: at(-50) }], compactions: 3, lastCompactAt: at(-20) });
  assert.deepEqual(m.tasks().map(t => [t.subject, t.status]), [['Early task', 'completed']]);
  assert.equal(m.compactions, 3);
});

test("the turn's tokens: each reply counted once (its entries repeat the count), from the turn's start", () => {
  const block = (sec, id, out, type = 'thinking') => JSON.stringify({ type: 'assistant', timestamp: new Date(at(sec)).toISOString(), message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [{ type, text: 'x', thinking: 'x' }], usage: { input_tokens: 1, output_tokens: out } } });
  const m = modelOf(prompt(0, 'old'), block(1, 'msg_0', 999), turnEnd(2), prompt(10, 'go'), block(11, 'msg_1', 856), block(11, 'msg_1', 856, 'text'), block(14, 'msg_2', 2000));
  assert.equal(m.turnStartedAt, at(10));
  assert.equal(m.turnTokens(), 2856);
});

const rewound = leafUuid => JSON.stringify({ type: 'last-prompt', leafUuid, sessionId: 's', explicit: true, rewound: true });

test('a restore drops the messages and steps from the restored message on, and says where it went back', () => {
  const m = modelOf(
    prompt(0, 'Plan it', { uuid: 'p-1' }), reply(1, 'Planned.'),
    prompt(2, 'Ship it', { uuid: 'p-2', parentUuid: 'r-1' }), toolUse(3, 't1', 'Bash', { command: 'deploy' }), toolResult(4, 't1'), reply(5, 'Shipped.'),
    rewound('r-1'),
  );
  assert.deepEqual(m.said.map(s => (s.kind === 'restored' ? `↺ ${s.text}` : s.text)), ['↺ Ship it', 'Planned.', 'Plan it']);
  assert.ok(!m.feed.some(f => f.kind === 'tool'), 'its steps go too');
  assert.equal(m.lastReply, 'Planned.');
  m.applyLines([prompt(9, 'Ship it to staging', { uuid: 'p-3', parentUuid: 'r-1' }), reply(10, 'On staging.')]);
  assert.deepEqual(m.said.map(s => s.text), ['On staging.', 'Ship it to staging', 'Ship it', 'Planned.', 'Plan it'], 'and it goes on from there');
});

test('a restore to a message it never saw changes nothing', () => {
  const m = modelOf(prompt(0, 'Plan it', { uuid: 'p-1' }), rewound('zzz'));
  assert.deepEqual(m.said.map(s => s.text), ['Plan it']);
});
