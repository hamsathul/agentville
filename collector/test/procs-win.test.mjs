import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { winSessionProcs } from '../platform/win-procs.mjs';

const winOnly = { skip: process.platform !== 'win32' ? 'Windows only' : false };
const gone = async pid => { for (let i = 0; i < 40; i++) { if (!winSessionProcs.alive(pid)) return true; await new Promise(r => setTimeout(r, 100)); } return false; };

test('a shell command and everything it started are stopped together, and the pid is then gone', winOnly, async () => {
  // child -> grandchild, both sleeping: the shape of "bash -c 'npm run dev'" on Windows
  const child = spawn(process.execPath, ['-e', "const {spawn}=require('node:child_process');const g=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{detached:true,stdio:'ignore'});g.unref();console.log(g.pid);setTimeout(()=>{},60000)"], { stdio: ['ignore', 'pipe', 'inherit'] });
  const grandchild = Number(await new Promise(res => child.stdout.once('data', d => res(String(d).trim()))));
  assert.ok(Number.isInteger(grandchild) && grandchild > 0, 'the grandchild must exist before the test means anything');
  assert.equal(winSessionProcs.alive(child.pid), true);
  assert.equal(winSessionProcs.alive(grandchild), true);
  winSessionProcs.killGroup(child.pid, 'SIGTERM');
  assert.equal(await gone(child.pid), true, 'child still alive');
  assert.equal(await gone(grandchild), true, 'grandchild survived: only the root was stopped');
  assert.equal(winSessionProcs.groupAlive(child.pid), false);
});

test('a pid that is not a plain number, or is a system pid, is refused and nothing is run', winOnly, () => {
  for (const bad of ['1; calc', -1, 0, 4, 1.5, NaN, null, undefined, '12']) {
    assert.throws(() => winSessionProcs.killGroup(bad, 'SIGTERM'), /refused|pid/i, String(bad));
  }
});

test('a session has no tty on Windows, and the command line of a live process can be read', winOnly, async () => {
  assert.equal(await winSessionProcs.ttyOf(process.pid), null);
  assert.match(await winSessionProcs.commandOf(process.pid), /node/i);
  assert.equal(await winSessionProcs.commandOf(2147483000), null);
});
