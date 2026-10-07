// The plan's usage (the 5-hour and weekly limits) as the dashboard shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReadings, planUsage } from '../derive/plan.mjs';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const MIN = 60_000;
const win = (kind, percentUsed, resetsInMin) => ({ kind, percentUsed, resetsAt: resetsInMin == null ? null : NOW + resetsInMin * MIN });

test('the reading comes from the session that talked to the API last', () => {
  const plan = planUsage([
    { id: 'old', lastActivityAt: NOW - 30 * MIN, rateLimits: [win('five_hour', 20, 100), win('seven_day', 50, 3000)] },
    { id: 'new', lastActivityAt: NOW - 1 * MIN, rateLimits: [win('five_hour', 34.5, 100), win('seven_day', 61, 3000)] },
    { id: 'none', lastActivityAt: NOW, rateLimits: [] },
  ], NOW);
  assert.deepEqual(plan, { from: 'new', at: NOW - MIN, windows: [win('five_hour', 34.5, 100), win('seven_day', 61, 3000)] });
});

test('a window whose reset time has passed reads as reset', () => {
  const plan = planUsage([{ id: 'a', lastActivityAt: NOW - 400 * MIN, rateLimits: [win('five_hour', 90, -100), win('seven_day', 61, 3000)] }], NOW);
  assert.deepEqual(plan.windows, [{ kind: 'five_hour', percentUsed: 0, resetsAt: null, reset: true }, win('seven_day', 61, 3000)]);
});

test('no session with a reading: no plan usage', () => {
  assert.equal(planUsage([], NOW), null);
  assert.equal(planUsage([{ id: 'a', lastActivityAt: NOW, rateLimits: [] }], NOW), null);
});

test("readings come from every mod's beacon: an open session's as fresh as its last activity, an ended one's as its last beacon", () => {
  const w = [win('five_hour', 6, 100)];
  const beacons = new Map([
    ['open', { live: true, at: NOW, usage: { rateLimits: w } }],
    ['ended', { live: false, at: NOW - 20 * MIN, usage: { rateLimits: w } }],
    ['old-mod', { live: true }],
    ['empty', { live: true, at: NOW, usage: { rateLimits: [] } }],
  ]);
  const agents = [{ id: 'open', lastActivityAt: NOW - 5 * MIN }];
  assert.deepEqual(planReadings(beacons, agents), [
    { id: 'open', lastActivityAt: NOW - 5 * MIN, rateLimits: w },
    { id: 'ended', lastActivityAt: NOW - 20 * MIN, rateLimits: w },
  ]);
});
