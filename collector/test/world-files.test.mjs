import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FRAME_CSP, checkWorldJson, makeWorlds, watchWorlds, worldsDirOf } from '../worlds.mjs';

const plain = v => JSON.parse(JSON.stringify(v));

function builtins() {
  const dir = mkdtempSync(join(tmpdir(), 'worlds-'));
  mkdirSync(join(dir, 'sdk'));
  writeFileSync(join(dir, 'sdk', 'frame.html'), '<title>__TITLE__</title><script src="__BASE__world.js"></script>');
  writeFileSync(join(dir, 'sdk', 'bridge.js'), '1');
  mkdirSync(join(dir, 'farm', 'art'), { recursive: true });
  writeFileSync(join(dir, 'farm', 'world.json'), JSON.stringify({ name: 'The <farm>', icon: '🌾', api: 1 }));
  writeFileSync(join(dir, 'farm', 'world.js'), 'Agentville.world({})');
  writeFileSync(join(dir, 'farm', 'art', 'barn.png'), 'png');
  writeFileSync(join(dir, 'farm', '.secret.js'), 'no');
  writeFileSync(join(dir, 'farm', 'run.sh'), 'no');
  symlinkSync('/etc/hosts', join(dir, 'farm', 'leak.js'));
  mkdirSync(join(dir, 'starter'));
  writeFileSync(join(dir, 'starter', 'world.json'), '{}');
  return dir;
}

test("a world's own files are served, typed; nothing outside its folder, hidden, of an unknown kind, or linked out", () => {
  const w = makeWorlds({ builtinDir: builtins() });
  assert.equal(w.file('farm', 'world.js').type, 'text/javascript; charset=utf-8');
  assert.equal(w.file('farm', 'art/barn.png').type, 'image/png');
  assert.equal(w.file('sdk', 'bridge.js').size, 1);
  for (const [key, rel] of [['farm', '../sdk/bridge.js'], ['farm', 'art/../../sdk/bridge.js'], ['farm', '.secret.js'], ['farm', 'run.sh'], ['farm', 'leak.js'], ['farm', 'nope.js'], ['farm', 'art'], ['sdk', 'frame.html'], ['starter', 'world.json'], ['../farm', 'world.js'], ['FARM', 'world.js'], ['u', 'world.js']]) {
    assert.equal(w.file(key, rel).status, 404, `${key}/${rel}`);
  }
});

test("a world's frame page: the SDK's template with its name (escaped) and its own address; none for an unknown world", () => {
  const w = makeWorlds({ builtinDir: builtins() });
  assert.equal(w.frame('farm'), '<title>The &lt;farm&gt;</title><script src="/world/farm/world.js"></script>');
  assert.equal(w.frame('nope'), null);
  assert.equal(w.frame('sdk'), null);
  assert.equal(w.frame('starter'), null);
});

test("a world.json that is a link to a file outside its folder is not read: no frame, no file", () => {
  const dir = builtins();
  const outside = join(mkdtempSync(join(tmpdir(), 'outside-')), 'x.json');
  writeFileSync(outside, JSON.stringify({ name: 'LEAKED-NAME' }));
  mkdirSync(join(dir, 'linky'));
  symlinkSync(outside, join(dir, 'linky', 'world.json'));
  const w = makeWorlds({ builtinDir: dir });
  assert.equal(w.frame('linky'), null);
  assert.equal(w.info('linky'), null);
  assert.equal(w.file('linky', 'world.json').status, 404);
});

test('the frame runs sandboxed, its scripts from the dashboard only, and can reach nothing', () => {
  for (const part of ['sandbox allow-scripts', "default-src 'none'", "script-src 'self'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "frame-ancestors 'self'"]) assert.ok(FRAME_CSP.includes(part), part);
  assert.ok(!/allow-same-origin|allow-popups|allow-top-navigation|allow-forms/.test(FRAME_CSP));
});

test("the frame page loads the SDK's and the world's scripts in CORS mode, so their errors say what and where", () => {
  const html = readFileSync(fileURLToPath(new URL('../../web/worlds/sdk/frame.html', import.meta.url)), 'utf8');
  for (const src of ['/world/sdk/bridge.js', '/world/sdk/pixel.js', '/world/sdk/people.js', '/world/sdk/engine.js', '__BASE__world.js']) {
    assert.match(html, new RegExp(`<script src="${src.replace(/[.]/g, '\\.')}" crossorigin="anonymous"></script>`), src);
  }
  assert.match(html, /<script src="\/brand\.js"><\/script>/, 'the page-script route is left as it is');
});

function users() {
  const dir = mkdtempSync(join(tmpdir(), 'my-worlds-'));
  const world = (name, json, js = 'Agentville.world({})') => {
    mkdirSync(join(dir, name));
    if (json !== null) writeFileSync(join(dir, name, 'world.json'), typeof json === 'string' ? json : JSON.stringify(json));
    if (js !== null) writeFileSync(join(dir, name, 'world.js'), js);
  };
  world('space', { name: 'Space station', icon: '🚀', description: 'Astronauts', api: 1 });
  writeFileSync(join(dir, 'space', 'preview.png'), 'png');
  world('farm', { name: 'My farm', api: 1 });
  world('broken', '{ nope');
  world('newer', { name: 'Newer', api: 2 });
  world('nojs', { name: 'No script', api: 1 }, null);
  world('Bad_Name', { name: 'Bad', api: 1 });
  world('linked', { name: 'Linked', api: 1 }, null);
  symlinkSync('/etc/hosts', join(dir, 'linked', 'world.js'));
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'secret.png'), 'secret');
  world('escape', { name: 'Escape', api: 1 });
  symlinkSync(outside, join(dir, 'escape', 'art'));
  writeFileSync(join(outside, 'cfg.json'), JSON.stringify({ name: 'LEAKED', api: 1 }));
  world('linkjson', null);
  symlinkSync(join(outside, 'cfg.json'), join(dir, 'linkjson', 'world.json'));
  writeFileSync(join(dir, 'notes.txt'), 'not a world');
  return dir;
}

test('your worlds are listed after the built-in ones, each with what is wrong with it, if anything', () => {
  const w = makeWorlds({ builtinDir: builtins(), userDir: users() });
  const all = w.list(), byKey = Object.fromEntries(all.map(x => [x.key ?? x.name, x]));
  assert.deepEqual(all.map(x => x.key ?? x.name), ['farm', 'Bad_Name', 'u/broken', 'u/escape', 'u/farm', 'u/linked', 'u/linkjson', 'u/newer', 'u/nojs', 'u/space']);
  assert.deepEqual(plain(byKey['u/space']), { key: 'u/space', builtIn: false, error: null, name: 'Space station', icon: '🚀', description: 'Astronauts', nouns: {}, preview: '/world/u/space/preview.png' });
  assert.equal(byKey.farm.builtIn, true);
  assert.equal(byKey['u/farm'].name, 'My farm', 'yours may share a name; it never replaces the built-in one');
  assert.match(byKey['u/broken'].error, /can't be read/);
  assert.match(byKey['u/newer'].error, /newer Agentville/);
  assert.match(byKey['u/nojs'].error, /world\.js is missing/);
  assert.match(byKey['u/linked'].error, /world\.js is missing/);
  assert.match(byKey['u/linkjson'].error, /world\.json is missing/, 'a world.json linked out of the folder is not read');
  assert.equal(byKey['u/linkjson'].name, 'linkjson', 'and its name is not taken from it');
  assert.match(byKey.Bad_Name.error, /lowercase/);
  assert.equal(byKey['u/escape'].error, null);
});

test("your world's files come from inside its folder only: a link out of it is refused", () => {
  const w = makeWorlds({ builtinDir: builtins(), userDir: users() });
  assert.equal(w.file('u/space', 'world.js').type, 'text/javascript; charset=utf-8');
  assert.equal(w.file('u/escape', 'art/secret.png').status, 404);
  assert.equal(w.file('u/linked', 'world.js').status, 404);
  assert.equal(w.file('u/Bad_Name', 'world.js').status, 404);
  assert.ok(w.frame('u/space').includes('/world/u/space/world.js'));
  assert.equal(w.frame('u/newer'), null, 'a world with something wrong has no frame');
  assert.deepEqual(makeWorlds({ builtinDir: builtins(), userDir: '/nowhere/at/all' }).list().map(x => x.key), ['farm'], 'no folder yet: just the farm');
});

test('a broken link in your folder is listed with its error and hides nothing', () => {
  const dir = users();
  symlinkSync('/nowhere/at/all/gone', join(dir, 'old-dev-world'));
  symlinkSync(join(dir, 'loop-b'), join(dir, 'loop-a'));
  symlinkSync(join(dir, 'loop-a'), join(dir, 'loop-b'));
  const w = makeWorlds({ builtinDir: builtins(), userDir: dir });
  const all = w.list(), by = Object.fromEntries(all.map(x => [x.key ?? x.name, x]));
  assert.match(by['old-dev-world'].error, /link to something that isn't there/);
  assert.equal(by['old-dev-world'].key, null);
  assert.match(by['loop-a'].error, /isn't there/);
  assert.equal(by['u/space'].error, null);
  assert.ok(w.frame('u/space'));
});

test("a linked world folder is followed, unless it is the worlds folder, above it, or your home", () => {
  const base = mkdtempSync(join(tmpdir(), 'wt-')), dir = join(base, 'worlds'), home = join(base, 'home');
  mkdirSync(dir); mkdirSync(home);
  const elsewhere = mkdtempSync(join(tmpdir(), 'dev-world-'));
  writeFileSync(join(elsewhere, 'world.json'), JSON.stringify({ name: 'Dev', api: 1 }));
  writeFileSync(join(elsewhere, 'world.js'), 'x');
  symlinkSync(elsewhere, join(dir, 'dev'));
  symlinkSync('..', join(dir, 'up'));
  symlinkSync(dir, join(dir, 'self'));
  symlinkSync(home, join(dir, 'home'));
  writeFileSync(join(base, 'private.json'), '{}');
  const w = makeWorlds({ builtinDir: builtins(), userDir: dir, home });
  const by = Object.fromEntries(w.list().map(x => [x.key ?? x.name, x]));
  assert.equal(by['u/dev'].error, null, 'a world developed elsewhere is fine');
  assert.ok(w.file('u/dev', 'world.js').real);
  for (const n of ['up', 'self', 'home']) {
    assert.match(by[`u/${n}`]?.error ?? by[n].error, /holds other things/, n);
    assert.equal(w.file(`u/${n}`, 'world.json').status, 404, n);
  }
  assert.equal(w.file('u/up', 'private.json').status, 404);
  assert.equal(w.frame('u/up'), null);
});

// Other spellings of a folder that exist on this machine: capitals (on a disk that ignores them) and macOS's data volume.
const spellings = p => [p.toUpperCase(), join('/System/Volumes/Data', p)].filter(s => s !== p && existsSync(s));

test("a world folder linked to your home, the worlds folder or above them is refused however the link is spelled", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wt-'))), dir = join(base, 'worlds'), home = join(base, 'home');
  mkdirSync(dir); mkdirSync(home);
  const targets = [home, dir, base, '/', '/System/Volumes/Data', join(dir, '..'), ...spellings(home), ...spellings(dir), ...spellings(base)].filter(t => existsSync(t));
  targets.forEach((t, i) => symlinkSync(t, join(dir, `l${i}`)));
  const w = makeWorlds({ builtinDir: builtins(), userDir: dir, home });
  const by = Object.fromEntries(w.list().map(x => [x.key, x]));
  targets.forEach((t, i) => {
    assert.equal(w.dirOf(`u/l${i}`), null, `${t} refused`);
    assert.equal(w.file(`u/l${i}`, 'world.json').status, 404, t);
    assert.match(by[`u/l${i}`].error, /holds other things/, t);
  });
});

test('a world folder with no world.json inside it serves nothing', () => {
  const base = mkdtempSync(join(tmpdir(), 'wt-')), dir = join(base, 'worlds');
  mkdirSync(dir); mkdirSync(join(dir, 'empty'));
  writeFileSync(join(dir, 'empty', 'world.js'), 'x');
  const w = makeWorlds({ builtinDir: builtins(), userDir: dir });
  assert.equal(w.file('u/empty', 'world.js').status, 404);
  assert.equal(w.frame('u/empty'), null);
  assert.match(w.list()[1].error, /world\.json is missing/);
});

test('only the exact folder name is your world, whatever the disk thinks of capitals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-worlds-'));
  mkdirSync(join(dir, 'Space'));
  writeFileSync(join(dir, 'Space', 'world.json'), JSON.stringify({ name: 'S', api: 1 }));
  writeFileSync(join(dir, 'Space', 'world.js'), 'x');
  const w = makeWorlds({ builtinDir: builtins(), userDir: dir });
  assert.equal(w.file('u/space', 'world.js').status, 404);
  assert.equal(w.dirOf('u/space'), null);
  assert.equal(w.frame('u/space'), null);
});

test('a huge world.json is refused, only the known nouns are kept, and an empty icon falls back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-worlds-'));
  const make = (n, json) => { mkdirSync(join(dir, n)); writeFileSync(join(dir, n, 'world.json'), json); writeFileSync(join(dir, n, 'world.js'), 'x'); };
  make('big', JSON.stringify({ name: 'Big', api: 1, description: 'x'.repeat(70000) }));
  const nouns = { agent: 'bee', zzz: 'no' };
  for (let i = 0; i < 5000; i++) nouns[`k${i}`] = 'v';
  make('nouny', JSON.stringify({ name: 'Nouny', api: 1, icon: '', nouns }));
  make('blank', JSON.stringify({ name: 'Blank', api: 1, icon: '  ' }));
  const by = Object.fromEntries(makeWorlds({ builtinDir: builtins(), userDir: dir }).list().map(x => [x.key, x]));
  assert.equal(by['u/blank'].icon, '🧩');
  assert.match(by['u/big'].error, /too large/);
  assert.deepEqual(plain(by['u/nouny'].nouns), { agent: 'bee' });
  assert.equal(by['u/nouny'].icon, '🧩');
});

test('worldsDir: default, ~, relative to home, absolute', () => {
  const d = join('/h', '.agentville', 'worlds');
  assert.equal(worldsDirOf({}, '/h'), d);
  for (const bad of [null, '', '  ', 7, {}]) assert.equal(worldsDirOf({ worldsDir: bad }, '/h'), d);
  assert.equal(worldsDirOf({ worldsDir: '~/x' }, '/h'), '/h/x');
  assert.equal(worldsDirOf({ worldsDir: 'x' }, '/h'), '/h/x');
  assert.equal(worldsDirOf({ worldsDir: '/x' }, '/h'), '/x');
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'wt-'))), notes = [];
  mkdirSync(join(home, 'sub'));
  for (const bad of [home, '/', dirname(home), '../x', '~', ...spellings(home)]) {
    assert.equal(worldsDirOf({ worldsDir: bad }, home, n => notes.push(n)), join(home, '.agentville', 'worlds'), String(bad));
  }
  assert.equal(notes.length, 5 + spellings(home).length, 'says why, once each');
  assert.equal(worldsDirOf({ worldsDir: join(home, 'sub') }, home), join(home, 'sub'));
  assert.equal(worldsDirOf({ worldsDir: ' ' }, home, n => notes.push(n)), join(home, '.agentville', 'worlds'));
});

test("world.json's rules", () => {
  assert.equal(checkWorldJson({ name: 'A', api: 1 }), null);
  assert.equal(checkWorldJson({ name: 'A', api: 1, icon: '👩‍🚀', description: 'x', nouns: { agent: 'astronaut' } }), null);
  for (const bad of [null, [], 'x', { api: 1 }, { name: '', api: 1 }, { name: 'x'.repeat(41), api: 1 }, { name: 'A' }, { name: 'A', api: 0 }, { name: 'A', api: 1.5 }, { name: 'A', api: 1, icon: 3 }, { name: 'A', api: 1, description: 'x'.repeat(141) }, { name: 'A', api: 1, nouns: { agent: 7 } }, { name: 'A', api: 1, nouns: [] }]) {
    assert.ok(checkWorldJson(bad), JSON.stringify(bad));
  }
});

test('a change to a world is told once per burst, by its key; the SDK as "*"', async () => {
  const builtinDir = builtins(), userDir = users(), seen = [];
  const stop = watchWorlds({ builtinDir, userDir }, key => seen.push(key), { quietMs: 100 });
  await new Promise(r => setTimeout(r, 500)); // macOS replays what the setup just wrote: let it be told, then start counting
  seen.length = 0;
  for (let i = 0; i < 5; i++) writeFileSync(join(userDir, 'space', 'world.js'), `// ${i}`);
  writeFileSync(join(builtinDir, 'sdk', 'bridge.js'), '// 2');
  await new Promise(r => setTimeout(r, 600));
  stop();
  assert.deepEqual(seen.sort(), ['*', 'u/space']);
});
