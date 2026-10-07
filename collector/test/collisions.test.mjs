import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCollisions } from '../derive/collisions.mjs';

const W = 30 * 60_000;
const NOW = 10 * W;
const touch = (repo, mode, t = NOW - 1000) => ({ repo, mode, firstAt: t, lastAt: t });
const agent = (id, state, ...touching) => ({ id, state, touching });

test('two agents writing one repo, one of them working, collide', () => {
  const got = findCollisions([agent('b', 'working', touch('/r', 'write', NOW - 5000)), agent('a', 'yourTurn', touch('/r', 'write', NOW - 9000))], NOW, W);
  assert.deepEqual(got, [{ repo: '/r', agentIds: ['a', 'b'], severity: 'normal', since: NOW - 5000, reason: '2 agents writing' }]);
});

test('a state-changing git command makes the collision high severity', () => {
  const got = findCollisions([agent('a', 'working', touch('/r', 'git')), agent('b', 'waiting', touch('/r', 'write'))], NOW, W);
  assert.equal(got[0].severity, 'high');
  assert.match(got[0].reason, /git command/);
});

test('no collision when neither agent is working or waiting', () => {
  assert.deepEqual(findCollisions([agent('a', 'yourTurn', touch('/r', 'write')), agent('b', 'stale', touch('/r', 'write'))], NOW, W), []);
});

test('reads, old touches, a single writer and paths outside repos never collide', () => {
  assert.deepEqual(findCollisions([agent('a', 'working', touch('/r', 'read')), agent('b', 'working', touch('/r', 'write'))], NOW, W), []);
  assert.deepEqual(findCollisions([agent('a', 'working', touch('/r', 'write', NOW - W - 1)), agent('b', 'working', touch('/r', 'write'))], NOW, W), []);
  assert.deepEqual(findCollisions([agent('a', 'working', touch('/r', 'write'), touch('/r', 'git'))], NOW, W), []);
  assert.deepEqual(findCollisions([agent('a', 'working', touch(undefined, 'write')), agent('b', 'working', touch(undefined, 'write'))], NOW, W), []);
});

test('high severity collisions sort first', () => {
  const got = findCollisions([
    agent('a', 'working', touch('/a', 'write'), touch('/z', 'git')),
    agent('b', 'working', touch('/a', 'write'), touch('/z', 'write')),
  ], NOW, W);
  assert.deepEqual(got.map(c => c.repo), ['/z', '/a']);
});
