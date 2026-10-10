// The mod's version is written twice: MOD_VERSION in its hooks module (what it reports to the collector) and
// "version" in its plugin manifest (what Claude Code installs). Each behaviour change bumps both; they must agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = f => readFileSync(fileURLToPath(new URL(`../../mod/${f}`, import.meta.url)), 'utf8');

test("the mod's MOD_VERSION (hooks/register.tsx) is the plugin manifest's version", () => {
  const inCode = /^const MOD_VERSION = '([^']+)'/m.exec(read('hooks/register.tsx'))?.[1];
  const inManifest = JSON.parse(read('.claude-plugin/plugin.json')).version;
  assert.match(inCode ?? '', /^\d+\.\d+\.\d+$/, 'MOD_VERSION is found, as x.y.z');
  assert.equal(inCode, inManifest);
});
