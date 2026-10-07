import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, loadConfig } from '../config.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'tracker-config-'));

test('missing config.json gives the defaults', () => {
  const cfg = loadConfig(join(tmp(), 'config.json'));
  assert.equal(cfg.port, 7777);
  assert.deepEqual(cfg.notify, DEFAULTS.notify);
});

test('user values override defaults and notify merges key by key', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ port: 9999, notify: { cpu: false } }));
  const cfg = loadConfig(join(dir, 'config.json'));
  assert.equal(cfg.port, 9999);
  assert.equal(cfg.notify.cpu, false);
  assert.equal(cfg.notify.waiting, true);
  assert.equal(cfg.pollMs, 3000);
});

test('malformed JSON throws so the caller can keep the previous config', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'config.json'), '{ "port": ');
  assert.throws(() => loadConfig(join(dir, 'config.json')));
});

test('a JSON array is rejected', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'config.json'), '[]');
  assert.throws(() => loadConfig(join(dir, 'config.json')), /JSON object/);
});

test('the shipped config.example.json is valid, complete and names no private repos', () => {
  const path = fileURLToPath(new URL('../../config.example.json', import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(raw).sort(), Object.keys(DEFAULTS).sort());
  assert.deepEqual(loadConfig(path).deployRepos, {});
});
