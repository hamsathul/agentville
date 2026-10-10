// The tour (web/worlds/test/tour.js): made-up snapshots for every stop the spec names, each a valid scene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { lastDeployOf } from '../derive/deploys.mjs';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function load() {
  const window = { Agentville: {} };
  const ctx = vm.createContext({ window, console, Math, Date, JSON, Map, Set });
  for (const f of ['scene.js', 'worlds/sdk/pixel.js', 'worlds/sdk/props.js', 'worlds/test/tour.js']) vm.runInContext(web(f), ctx, { filename: f });
  return { tour: window.AgentvilleTour, toScene: window.AgentvilleScene.toScene, STEPS: window.Agentville.props.STEPS };
}

test('every stop makes valid scenes, and the names are unique', () => {
  const { tour, toScene } = load();
  const names = tour.stops.map(s => s.name);
  assert.equal(new Set(names).size, names.length);
  for (const s of tour.stops) {
    assert.ok(s.title && ['day', 'night'].includes(s.sky) && typeof s.private === 'boolean', s.name);
    assert.ok(s.frames.length >= 1 && s.frames.length <= 2, s.name);
    for (const f of s.frames) assert.doesNotThrow(() => toScene(f), s.name);
  }
});

test("the tour covers the spec's list", () => {
  const { tour, toScene, STEPS } = load();
  const has = n => assert.ok(tour.stop(n), `a stop named ${n}`);
  ['working', 'waiting', 'question', 'plan-ask', 'turn', 'idle', 'stale', 'nap', 'thinking', 'steps', 'deploy-ok', 'deploy-failed', 'deploy-running', 'deploy-skipped', 'compaction', 'collision', 'merged', 'mcp', 'pigeon', 'limits-low', 'limits-high', 'accounts', 'day', 'night', 'one', 'sixteen', 'private', 'subagents', 'context-low', 'context-high', 'nobody'].forEach(has);
  const scene = n => toScene(tour.stop(n).frames.at(-1));
  assert.equal(scene('one').agents.length, 1);
  assert.equal(scene('sixteen').agents.length, 16);
  assert.equal(scene('nobody').agents.length, 0);
  assert.deepEqual(plain(['deploy-ok', 'deploy-failed', 'deploy-running', 'deploy-skipped'].map(n => scene(n).repos[0].deploy.state)), ['ok', 'failed', 'running', 'blocked']);
  const steps = new Set(scene('steps').agents.map(a => a.step));
  for (const step of Object.keys(STEPS).filter(k => k !== 'other')) assert.ok(steps.has(step), `the steps stop shows ${step}`);
  assert.ok(scene('steps').agents.some(a => a.mode === 'plan'), 'and plan mode');
  assert.equal(tour.stop('night').sky, 'night');
  assert.equal(tour.stop('private').private, true);
  assert.ok(scene('limits-high').plan.windows.every(w => w.pct >= 90));
  assert.ok(scene('limits-low').plan.windows.every(w => w.pct <= 20));
  assert.deepEqual(plain(scene('accounts').accounts.map(a => a.name)), ['work', 'home']);
  assert.ok(scene('accounts').accounts[1].plan.weekly.pct >= 90);
  assert.equal(scene('accounts').agents[0].account, 'home');
  assert.ok(tour.checks.some(([item, a, b]) => item === 'several accounts' && a === 'working' && b === 'accounts'), 'and its checklist item');
  assert.equal(tour.stop('compaction').frames.length, 2);
  assert.equal(tour.stop('merged').frames.length, 2);
  assert.ok(scene('collision').repos[0].collision);
  assert.ok(scene('pigeon').mail.length > 0);
  assert.ok(scene('mcp').mcp.length > 0);
});

test("every deploy in the tour has a state the collector sends; deploy-skipped is a run GitHub never started, in the collector's words", () => {
  const { tour } = load();
  // Every kind of run lastDeployOf takes (running, success, failure, never started, anything else), and a direct deploy each way.
  const runs = [{ status: 'in_progress' }, { status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }, { status: 'completed', conclusion: 'failure', blocked: true }, { status: 'completed', conclusion: 'cancelled' }];
  const sent = new Set([...runs.map(run => lastDeployOf(run, null).state), ...[true, false].map(ok => lastDeployOf(null, { ok, at: 1, by: 'a1', summary: 'deploy' }).state)]);
  const deploys = tour.stops.flatMap(s => s.frames.flatMap(f => f.repos.map(r => [s.name, r.lastDeploy]))).filter(([, d]) => d);
  assert.ok(deploys.length >= 4);
  for (const [name, d] of deploys) assert.ok(sent.has(d.state), `${name}: ${d.state} is one of ${[...sent].join(', ')}`);
  const skipped = tour.stop('deploy-skipped').frames[0].repos[0].lastDeploy, never = lastDeployOf({ status: 'completed', conclusion: 'failure', blocked: true }, null);
  assert.deepEqual([skipped.state, skipped.label, skipped.source], [never.state, never.label, never.source]);
});

test("a stop's counts match its agents, as the collector counts them", () => {
  const { tour } = load();
  const last = n => tour.stop(n).frames.at(-1);
  const all = last('everyone'), n = s => all.agents.filter(a => a.state === s).length;
  assert.deepEqual(plain(all.counts), { waiting: n('waiting'), working: n('working'), yourTurn: n('yourTurn'), stale: n('stale'), idle: n('idle'), collisions: 0 });
  assert.equal(all.counts.waiting, 1);
  assert.equal(all.counts.yourTurn, 1);
  assert.equal(all.counts.working, 3);
  assert.equal(all.counts.stale, 1);
  assert.equal(all.counts.idle, 1);
  assert.equal(last('collision').counts.collisions, 1);
  assert.equal(last('nobody').counts.working, 0);
});

test('every check compares two stops that exist; answers have the collector\'s shapes', () => {
  const { tour } = load();
  for (const [item, a, b] of tour.checks) assert.ok(tour.stop(a) && tour.stop(b) && item, `${item}: ${a} vs ${b}`);
  const touched = tour.answer({ what: 'repoTouched', repo: '/Users/you/code/shop' });
  assert.ok(touched.ok && Array.isArray(touched.data.files));
  const files = tour.answer({ what: 'agentFiles', agentId: 'a1' });
  assert.ok(files.ok && Array.isArray(files.data.files));
});
