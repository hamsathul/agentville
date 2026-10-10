import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountEnv, createSessionAccounts, findAccounts, keyOfDir } from '../sources/accounts.mjs';
import { mergeConfig } from '../config.mjs';

const login = (file, email) => writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: email, organizationName: `${email}'s Organization` } }));
function home() {
  const h = mkdtempSync(join(tmpdir(), 'acct-home-'));
  const main = join(h, '.claude');
  mkdirSync(join(main, 'projects'), { recursive: true });
  login(`${main}.json`, 'me@work.example');
  return { h, main };
}

test('the first account is claudeDir, then its siblings with a login, by name', () => {
  const { h, main } = home();
  mkdirSync(join(h, '.claude-zeta'));
  login(join(h, '.claude-zeta', '.claude.json'), 'me@zeta.example');
  mkdirSync(join(h, '.claude-empty')); // no login: not an account
  mkdirSync(join(h, '.claude-old'));
  writeFileSync(join(h, '.claude-old', '.claude.json'), '{"oauthAccount":null}');
  writeFileSync(join(h, '.claude-file'), 'x'); // not a folder
  const got = findAccounts({ claudeDir: main, home: h });
  assert.deepEqual(got.map(a => [a.key, a.name, a.dir, a.first, a.email]), [
    ['main', 'main', main, true, 'me@work.example'],
    ['zeta', 'zeta', join(h, '.claude-zeta'), false, 'me@zeta.example'],
  ]);
  assert.equal(got[1].org, "me@zeta.example's Organization");
});

test('config names them; ~ and a trailing slash name the same folder; a missing folder is skipped', () => {
  const { h, main } = home();
  mkdirSync(join(h, '.claude-zeta'));
  login(join(h, '.claude-zeta', '.claude.json'), 'z@x');
  const other = mkdtempSync(join(tmpdir(), 'acct-other-'));
  const logged = [];
  const got = findAccounts({ claudeDir: main, home: h, log: m => logged.push(m), names: { '~/.claude': 'nco', '~/.claude-zeta/': 'zeta work', [other]: 'other', '/nope/.claude-x': 'gone', [join(h, 'bad')]: 7 } });
  assert.deepEqual(got.map(a => [a.key, a.name, a.dir]), [['main', 'nco', main], ['zeta', 'zeta work', join(h, '.claude-zeta')], [keyOfDir(other, main), 'other', other]]);
  assert.ok(logged.some(m => m.includes('/nope/.claude-x')));
});

test('names: a broken accounts entry falls back to keys; keys stay when a name changes', () => {
  const { h, main } = home();
  assert.equal(findAccounts({ claudeDir: main, home: h, names: ['x'] })[0].name, 'main');
  assert.equal(findAccounts({ claudeDir: main, home: h, names: null })[0].name, 'main');
  assert.equal(findAccounts({ claudeDir: main, home: h, names: { '~/.claude': 'renamed' } })[0].key, 'main');
  assert.deepEqual(mergeConfig({}).accounts, {});
  assert.deepEqual(mergeConfig({ accounts: ['x'] }).accounts, {});
  assert.deepEqual(mergeConfig({ accounts: { '~/.claude': 'nco' } }).accounts, { '~/.claude': 'nco' });
});

test('a shared projects folder: both accounts have the same real path', () => {
  const { h, main } = home();
  mkdirSync(join(h, '.claude-zeta'));
  login(join(h, '.claude-zeta', '.claude.json'), 'z@x');
  symlinkSync(join(main, 'projects'), join(h, '.claude-zeta', 'projects'));
  const [a, b] = findAccounts({ claudeDir: main, home: h });
  assert.ok(a.projectsReal);
  assert.equal(a.projectsReal, b.projectsReal);
  assert.equal(b.dir, join(h, '.claude-zeta'), 'the folder itself is never resolved');
});

test('the environment for an account: none with one account, unset for the first, its folder otherwise', () => {
  const first = { dir: '/h/.claude', first: true }, zeta = { dir: '/h/.claude-zeta', first: false };
  assert.equal(accountEnv(first, false), undefined);
  assert.deepEqual(accountEnv(first, true), { CLAUDE_CONFIG_DIR: undefined });
  assert.ok(Object.hasOwn(accountEnv(first, true), 'CLAUDE_CONFIG_DIR'));
  assert.deepEqual(accountEnv(zeta, true), { CLAUDE_CONFIG_DIR: '/h/.claude-zeta' });
});

test('keyOfDir: the key a remembered folder had', () => {
  assert.equal(keyOfDir('/h/.claude', '/h/.claude'), 'main');
  assert.equal(keyOfDir('/h/.claude-zeta', '/h/.claude'), 'zeta');
  assert.equal(keyOfDir('/x/Work Claude', '/h/.claude'), 'workclaude');
});

test('session accounts: remembered, the newest kept, a broken file read as empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acct-mem-'));
  const file = join(dir, 'session-accounts.json');
  writeFileSync(file, '{broken');
  const m = createSessionAccounts(file, { cap: 3 });
  assert.equal(m.get('a'), null);
  for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) m.see(id, '/h/.claude', 1000 + i);
  m.see('a', '/h/.claude-zeta', 2000); // moved: now the newest
  m.save();
  const again = createSessionAccounts(file, { cap: 3 });
  assert.equal(again.get('a'), '/h/.claude-zeta');
  assert.equal(again.get('b'), null, 'the oldest went');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8'))), ['c', 'd', 'a']);
});

test('session accounts: seeing the same account again does not rewrite the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acct-mem-'));
  const file = join(dir, 'session-accounts.json');
  const m = createSessionAccounts(file);
  m.see('a', '/h/.claude', 1000);
  m.save();
  writeFileSync(file, '{"a":{"dir":"/h/.claude","at":1000},"marker":{"dir":"/x","at":1}}');
  m.see('a', '/h/.claude', 1500); // same folder, within the hour: nothing to save
  m.save();
  assert.match(readFileSync(file, 'utf8'), /marker/);
});
