// The mod's version is written twice: MOD_VERSION in its hooks module (what it reports to the collector) and
// "version" in its plugin manifest (what Claude Code installs). Each behaviour change bumps both; they must agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { modAtLeast } from '../sources/pending.mjs';

const read = f => readFileSync(fileURLToPath(new URL(`../../mod/${f}`, import.meta.url)), 'utf8');
const versionInCode = () => /^const MOD_VERSION = '([^']+)'/m.exec(read('hooks/register.tsx'))?.[1];

test("the mod's MOD_VERSION (hooks/register.tsx) is the plugin manifest's version", () => {
  const inCode = versionInCode();
  const inManifest = JSON.parse(read('.claude-plugin/plugin.json')).version;
  assert.match(inCode ?? '', /^\d+\.\d+\.\d+$/, 'MOD_VERSION is found, as x.y.z');
  assert.equal(inCode, inManifest);
});

test("the field exercise's animal lines (its own words in the mod's table) came with mod 0.9.3", () => {
  assert.ok(modAtLeast(versionInCode(), '0.9.3'), `MOD_VERSION ${versionInCode()}: 0.9.3 or newer`);
});

test("a model switch from the dashboard answers Claude Code's own question (PreModelSwitch) from mod 0.9.4, which the page names", () => {
  assert.ok(modAtLeast(versionInCode(), '0.9.4'), `MOD_VERSION ${versionInCode()}: 0.9.4 or newer`);
  assert.match(read('hooks/register.tsx'), /on\('classic\.PreModelSwitch'/);
  assert.match(readFileSync(fileURLToPath(new URL('../../web/app.js', import.meta.url)), 'utf8'), /modCan\(a, '0\.9\.4'\)/);
});
