// Animal lines (✨ Helper): what the collector sends Haiku, when, through which session, and what it keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CREATURE_KINDS, SITUATIONS, checkCast, chooseSession, createLinesWatch, dueLines, factsOf, parseLines, stepOf } from '../sources/lines.mjs';

const agent = (id, over = {}) => ({ id, name: id, kind: 'interactive', state: 'idle', compactions: 0, mod: { live: true, version: '0.9.0' }, ...over });
const repo = (path, over = {}) => ({ path, name: path.split('/').pop(), branch: 'main', agentIds: [], lastDeploy: null, prs: { open: [], merged: [] }, ...over });

test('checkCast: library kinds and short plain names, 12 at most, a kind once', () => {
  assert.deepEqual(checkCast([{ kind: 'cow', name: 'Cow' }, { kind: 'cow', name: 'Other' }, { kind: 'duck', name: 'Ducks' }]), [{ kind: 'cow', name: 'Cow' }, { kind: 'duck', name: 'Ducks' }]);
  assert.deepEqual(checkCast([{ kind: 'dragon', name: 'D' }, { kind: 'cat', name: 'x'.repeat(31) }, { kind: 'goat', name: 7 }, null, { kind: 'lion', name: 'Lion\u001b[31m' }]), [{ kind: 'lion', name: 'Lion[31m' }]);
  assert.equal(checkCast(Array.from({ length: 13 }, () => ({ kind: 'cat', name: 'Cat' }))), null);
  assert.equal(checkCast('cow'), null);
  assert.deepEqual(checkCast([]), []);
});

test('stepOf: a word from the tool’s name only, never its arguments', () => {
  assert.equal(stepOf(agent('a', { state: 'working', now: { tool: 'Edit', summary: '/Users/x/secret.js' } })), 'editing');
  assert.equal(stepOf(agent('a', { state: 'working', now: { tool: 'Bash', summary: 'rm -rf /' } })), 'running');
  assert.equal(stepOf(agent('a', { state: 'working', now: { tool: 'Grep' } })), 'searching');
  assert.equal(stepOf(agent('a', { state: 'working', now: { tool: 'mcp__x__y' } })), 'working');
  assert.equal(stepOf(agent('a', { state: 'working' })), 'thinking');
  assert.equal(stepOf(agent('a', { state: 'waiting' })), 'asking');
  assert.equal(stepOf(agent('a', { state: 'idle' })), null);
});

test('createLinesWatch: deploys that turn, compactions, new merges and new agents; nothing on the first look', () => {
  let t = 1_000_000;
  const w = createLinesWatch({ now: () => t });
  const snap = (agents, repos) => ({ agents, repos });
  w.observe(snap([agent('a', { compactions: 1 })], [repo('/r/api', { agentIds: ['a'], lastDeploy: { state: 'running' } })]));
  assert.deepEqual(w.recent(), [], 'the first look sees no news');
  t += 60_000;
  w.observe(snap([agent('a', { compactions: 2 }), agent('b')], [repo('/r/api', { agentIds: ['a'], lastDeploy: { state: 'failed' }, prs: { open: [], merged: [{ number: 7, at: t - 1000 }] } }), repo('/r/new', { lastDeploy: { state: 'failed' } })]));
  assert.deepEqual(w.recent().map(e => [e.kind, e.agent, e.repo]).sort(), [['arrive', 'b', null], ['deployFailed', null, 'api'], ['harvest', 'a', 'api'], ['merged', null, 'api']].sort(), 'a repo first seen failed is no news');
  assert.equal(w.since(t - 1), true);
  t += 60_000;
  w.observe(snap([agent('a', { compactions: 2 }), agent('b')], [repo('/r/api', { agentIds: ['a'], lastDeploy: { state: 'failed' } })]));
  assert.equal(w.since(t - 1), false, 'still failed: no new event');
  t += 31 * 60_000;
  w.observe(snap([agent('a', { compactions: 2 }), agent('b')], [repo('/r/api', { agentIds: ['a'], lastDeploy: { state: 'ok' } })]));
  assert.deepEqual(w.recent().map(e => e.kind), ['deployOk'], 'events older than 30 minutes are gone');
  for (let i = 0; i < 8; i++) { t += 1000; w.observe(snap([agent('a', { compactions: 3 + i }), agent('b')], [repo('/r/api', { agentIds: ['a'], lastDeploy: { state: 'ok' } })])); }
  assert.equal(w.recent().length, 5, 'the five newest');
});

test('factsOf: the facts only, capped, waiting first; no path, command or branch even when the agents have them', () => {
  const agents = [
    agent('deploy-bot', { state: 'working', now: { tool: 'Bash', summary: 'ssh prod ./deploy.sh --key /Users/me/.ssh/id' }, cwd: '/Users/me/code/api', lastPrompt: 'secret plan', lastReply: 'secret reply' }),
    agent('asker', { state: 'waiting', now: { tool: 'AskUserQuestion', summary: 'Which DB?' } }),
    ...Array.from({ length: 14 }, (_, i) => agent(`idle-${i}`)),
  ];
  const snap = { agents, repos: [repo('/Users/me/code/api', { branch: 'feature/secret-branch', agentIds: ['deploy-bot'] })] };
  const f = factsOf(snap, [{ kind: 'cow', name: 'Cow' }], [{ kind: 'deployFailed', agent: null, repo: 'api', at: 1_000_000 - 120_000 }], 1_000_000);
  assert.equal(f.agents.length, 12);
  assert.deepEqual(f.agents[0], { name: 'asker', state: 'waiting', step: 'asking' });
  assert.deepEqual(f.agents[1], { name: 'deploy-bot', state: 'working', step: 'running', repo: 'api' });
  assert.deepEqual(f.counts, { waiting: 1, working: 1, idle: 14 });
  assert.deepEqual(f.events, [{ kind: 'deployFailed', repo: 'api', ago: 2 }]);
  assert.deepEqual(f.cast, [{ kind: 'cow', name: 'Cow' }]);
  const text = JSON.stringify(f);
  for (const s of ['/Users', 'ssh', 'deploy.sh', 'secret', 'feature/', 'Which DB']) assert.equal(text.includes(s), false, s);
});

test('parseLines keeps only well-formed rows: a cast kind, a known situation, plain text of 1 to 40; 40 rows at most; 8,000 characters read', () => {
  const text = [
    'Here are your lines:',
    'cow|idle|MOO. the deploy is fine',
    'cow | deployFailed | "not my fault"',
    'goat|idle|' + 'x'.repeat(41),
    'dragon|idle|rawr',
    'cow|dancing|hi',
    'cow|idle|a | b',
    'cow|idle|',
    'cow|idle|bell\u0007 ring',
  ].join('\n');
  assert.deepEqual(parseLines(text, ['cow', 'goat']), [
    { kind: 'cow', when: 'idle', text: 'MOO. the deploy is fine' },
    { kind: 'cow', when: 'deployFailed', text: 'not my fault' },
    { kind: 'cow', when: 'idle', text: 'bell ring' },
  ]);
  assert.equal(parseLines(Array.from({ length: 60 }, (_, i) => `cow|idle|line ${i}`).join('\n'), ['cow']).length, 40);
  assert.deepEqual(parseLines('x'.repeat(8000) + '\ncow|idle|too late', ['cow']), [], 'past 8,000 characters is not read');
  assert.deepEqual(parseLines(undefined, ['cow']), []);
});

test('chooseSession: mod 0.9.0, listening, not codex; idle first, then turn, then working; never waiting or stale; least recently used first', () => {
  const agents = [
    agent('w', { state: 'working' }), agent('t', { state: 'yourTurn' }), agent('i1'), agent('i2'),
    agent('wait', { state: 'waiting' }), agent('stale', { state: 'stale' }), agent('old', { mod: { live: true, version: '0.8.0' } }),
    agent('deaf', { mod: { live: false, version: '0.9.0' } }), agent('cx', { kind: 'codex' }),
  ];
  assert.equal(chooseSession(agents, new Map())?.id, 'i1');
  assert.equal(chooseSession(agents, new Map([['i1', 5]]))?.id, 'i2', 'taking turns');
  assert.equal(chooseSession(agents.filter(a => !a.id.startsWith('i')), new Map())?.id, 't');
  assert.equal(chooseSession([agents[0]], new Map())?.id, 'w');
  assert.equal(chooseSession(agents.slice(4), new Map()), null);
});

test('dueLines: the first at once; an event once 5 minutes have passed; else every 30', () => {
  const g = { gapMs: 300_000, idleMs: 1_800_000 };
  assert.equal(dueLines({ now: 0, lastAskedAt: null, eventSince: false, ...g }), true);
  assert.equal(dueLines({ now: 299_000, lastAskedAt: 0, eventSince: true, ...g }), false);
  assert.equal(dueLines({ now: 300_000, lastAskedAt: 0, eventSince: true, ...g }), true);
  assert.equal(dueLines({ now: 1_799_000, lastAskedAt: 0, eventSince: false, ...g }), false);
  assert.equal(dueLines({ now: 1_800_000, lastAskedAt: 0, eventSince: false, ...g }), true);
});

test('the kinds and situations match the creature library and the kit (drift fails here)', () => {
  const src = f => readFileSync(fileURLToPath(new URL(`../../web/worlds/sdk/${f}`, import.meta.url)), 'utf8');
  const lib = vm.runInContext(`${src('creatures.js')}; Object.keys(CREATURES)`, vm.createContext({ px() {} }));
  assert.deepEqual([...lib].sort(), [...CREATURE_KINDS].sort());
  assert.deepEqual(SITUATIONS, ['idle', 'deployFailed', 'deployOk', 'harvest', 'merged', 'arrive']);
});
