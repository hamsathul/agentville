import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPrompt, parseEntry } from '../transcript/parse.mjs';
import { clip, summarizeTool } from '../transcript/summarize.mjs';

const kinds = obj => parseEntry(obj).events.map(e => e.kind);

test('a typed prompt becomes a prompt event with its timestamp', () => {
  const r = parseEntry({ type: 'user', timestamp: '2026-10-06T12:00:00.000Z', message: { content: 'ship it' } });
  assert.equal(r.at, Date.parse('2026-10-06T12:00:00.000Z'));
  assert.deepEqual(r.events, [{ kind: 'prompt', text: 'ship it' }]);
});

test('meta user entries (skill bodies, reminders) are not prompts', () => {
  assert.deepEqual(kinds({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'Base directory…' }] } }), []);
});

test('slash commands are shown as the command, local command output is dropped', () => {
  assert.equal(cleanPrompt('<command-name>/agents</command-name>\n<command-message>agents</command-message>\n<command-args>x</command-args>'), '/agents x');
  assert.equal(cleanPrompt('<local-command-stdout>done</local-command-stdout>'), '');
});

test('a message from a task notification or peer opens a turn but is not a prompt', () => {
  assert.deepEqual(kinds({ type: 'user', origin: { kind: 'task-notification' }, message: { content: 'job done' } }), ['turn_start']);
});

test('a message sent from the dashboard (a plugin submitting as the user) is the person\'s prompt', () => {
  const r = parseEntry({ type: 'user', origin: { kind: 'plugin', name: 'agent-tracker', asUser: true }, message: { content: 'move the box to the top' } });
  assert.deepEqual(r.events, [{ kind: 'prompt', text: 'move the box to the top' }]);
  assert.deepEqual(kinds({ type: 'user', origin: { kind: 'plugin', name: 'other' }, message: { content: 'automated' } }), ['turn_start']);
  assert.deepEqual(kinds({ type: 'user', origin: { kind: 'peer', name: 'other-session' }, message: { content: 'heads-up' } }), ['turn_start']);
});

test('assistant entries give tool_use, reply and model events', () => {
  const r = parseEntry({ type: 'assistant', cwd: '/w', message: { model: 'claude-opus-5-5', content: [
    { type: 'thinking', thinking: '' },
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
    { type: 'text', text: 'Done.' },
  ] } });
  assert.deepEqual(r.events.map(e => e.kind), ['tool_use', 'reply', 'model']);
  assert.deepEqual(r.events[0], { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' }, cwd: '/w' });
});

test('tool results carry the error flag', () => {
  const r = parseEntry({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } });
  assert.deepEqual(r.events, [{ kind: 'tool_result', toolUseId: 't1', ok: false }]);
});

test('turn_duration ends a turn and ai-title names the session', () => {
  assert.deepEqual(kinds({ type: 'system', subtype: 'turn_duration' }), ['turn_end']);
  assert.deepEqual(parseEntry({ type: 'ai-title', aiTitle: 'Claude mods' }).events, [{ kind: 'title', text: 'Claude mods' }]);
});

test('bad timestamps and non-objects are harmless', () => {
  assert.equal(parseEntry({ type: 'user', timestamp: 'nope', message: { content: 'x' } }).at, null);
  assert.deepEqual(parseEntry(null), { at: null, events: [] });
  assert.deepEqual(parseEntry('text'), { at: null, events: [] });
});

test('summaries prefer the Bash description and shorten paths', () => {
  assert.equal(summarizeTool('Bash', { command: 'npm test', description: 'Run tests' }), 'Run tests');
  assert.equal(summarizeTool('Bash', { command: 'npm test' }), 'npm test');
  assert.equal(summarizeTool('Edit', { file_path: '/Users/h/app/backend/src/a.ts' }), 'src/a.ts');
  assert.equal(summarizeTool('AskUserQuestion', { questions: [{ question: 'Ship?' }] }), 'Ship?');
  assert.equal(summarizeTool('mcp__x__do', { query: 'find it', n: 3 }), 'find it');
});

test('clip collapses whitespace and adds an ellipsis', () => {
  assert.equal(clip('a\n  b'), 'a b');
  assert.equal(clip('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
});

test('a compaction summary opens a turn but is not the last prompt', () => {
  assert.deepEqual(kinds({ type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { content: 'This session is being continued from a previous conversation that ran out of context.' } }), ['turn_start']);
});

test("a background command's notice says how it ended", () => {
  const notice = id => `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<output-file>/tmp/b1.output</output-file>\n<status>completed</status>\n<summary>Background command "Deploy" completed (exit code 0)</summary>\n</task-notification>`;
  const r = parseEntry({ type: 'user', origin: { kind: 'task-notification' }, message: { content: notice('toolu_A') } });
  assert.deepEqual(r.events, [{ kind: 'task_done', toolUseId: 'toolu_A', status: 'completed' }, { kind: 'turn_start' }]);
  const failed = notice('toolu_B').replace('<status>completed', '<status>failed');
  assert.deepEqual(parseEntry({ type: 'user', origin: { kind: 'task-notification' }, message: { content: [{ type: 'text', text: failed }] } }).events[0], { kind: 'task_done', toolUseId: 'toolu_B', status: 'failed' });
});

test('a notice queued while the session was busy counts too, from when it was queued', () => {
  const content = '<task-notification>\n<tool-use-id>toolu_Q</tool-use-id>\n<status>completed</status>\n</task-notification>';
  const r = parseEntry({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-07T13:26:00.000Z', content });
  assert.deepEqual(r.events, [{ kind: 'task_done', toolUseId: 'toolu_Q', status: 'completed' }]);
  assert.equal(r.at, Date.parse('2026-10-07T13:26:00.000Z'));
  assert.deepEqual(parseEntry({ type: 'queue-operation', operation: 'remove', content }).events, []);
});

test("a user entry says the session's permission mode", () => {
  const r = parseEntry({ type: 'user', permissionMode: 'plan', origin: { kind: 'human' }, message: { content: 'go' } });
  assert.deepEqual(r.events, [{ kind: 'mode', mode: 'plan' }, { kind: 'prompt', text: 'go' }]);
  assert.deepEqual(parseEntry({ type: 'user', permissionMode: 'bypassPermissions', origin: { kind: 'task-notification' }, message: { content: 'done' } }).events[0], { kind: 'mode', mode: 'bypassPermissions' });
  assert.deepEqual(parseEntry({ type: 'user', message: { content: 'no mode' } }).events, [{ kind: 'prompt', text: 'no mode' }]);
});

test("the transcript's own permission-mode entries say the session's mode as it is now", () => {
  assert.deepEqual(parseEntry({ type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: 's' }).events, [{ kind: 'mode', mode: 'bypassPermissions' }]);
  assert.deepEqual(parseEntry({ type: 'permission-mode' }).events, []);
});

const crossMessage = (name, text) => `<cross-session-message from="uds:/tmp/cc-socks/42.sock" from-name="${name}" from-mode="bypass">\n${text}\n</cross-session-message>`;
const peerOrigin = { kind: 'peer', from: 'uds:/tmp/cc-socks/42.sock', verifiedPeerPid: 42, msg_id: 'm1', name: 'shop-api-3', fromMode: 'bypass' };

test('a message from another session is read as from that session, whether it came to an idle or a busy session', () => {
  const idle = parseEntry({ type: 'user', origin: peerOrigin, message: { content: `Another Claude session sent a message:\n${crossMessage('shop-api-3', 'Hold the deploy, please.')}` } });
  assert.deepEqual(idle.events, [{ kind: 'peer_in', from: 'shop-api-3', pid: 42, id: 'm1', text: 'Hold the deploy, please.' }, { kind: 'turn_start' }]);
  const busy = parseEntry({ type: 'attachment', origin: peerOrigin, attachment: { type: 'queued_command', prompt: crossMessage('shop-api-3', 'Done, go ahead.') } });
  assert.deepEqual(busy.events, [{ kind: 'peer_in', from: 'shop-api-3', pid: 42, id: 'm1', text: 'Done, go ahead.' }]);
  assert.deepEqual(parseEntry({ type: 'queue-operation', operation: 'enqueue', content: crossMessage('shop-api-3', 'x') }).events, [], 'the queue copy is not a second message');
});
