import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from 'node:path';
import { bashTouches, collectTouches, touchesFromCall } from '../derive/touches.mjs';

// Fixture paths are written POSIX-style; on Windows they get a drive so they are absolute there too.
const P = p => normalize(process.platform === 'win32' ? `C:${p}` : p);

const HOME = P('/h');
const bashTargets = (command, cwd, home) => bashTouches(command, cwd, home).map(t => t.path);
// the most a command does to anything: git over write over read
const bashMode = command => bashTouches(command, P('/p'), HOME).reduce((m, t) => (t.mode === 'git' || (t.mode === 'write' && m === 'read') ? t.mode : m), 'read');
const sorted = touches => [...touches].sort((a, b) => a.path.localeCompare(b.path));

test('bash targets come from cd, git -C, absolute and ~ paths, else the entry cwd', () => {
  assert.deepEqual(bashTargets('cd backend && git status', P('/p'), HOME), [P('/p/backend')]);
  assert.ok(bashTargets('git -C /p/frontend log', P('/p'), HOME).includes(P('/p/frontend')));
  assert.deepEqual(bashTargets('cat ~/notes.txt', P('/p'), HOME), [P('/h/notes.txt')]);
  assert.deepEqual(bashTargets('ls', P('/p'), HOME), [P('/p')]);
  assert.deepEqual(bashTargets('npm test', undefined, HOME), []);
  assert.ok(bashTargets('cd "/Users/a b/c" && ls', P('/p'), HOME).includes(P('/Users/a b/c')));
});

test('bash mode: mutating git commands, writes, and reads', () => {
  assert.equal(bashMode('git commit -m x'), 'git');
  assert.equal(bashMode('cd b && git -C /x push origin main'), 'git');
  assert.equal(bashMode('git status'), 'read');
  assert.equal(bashMode('git log | head'), 'read');
  assert.equal(bashMode('echo x > out.txt'), 'write');
  assert.equal(bashMode('npm test 2>&1 | tail'), 'read');
  assert.equal(bashMode('cmd > /dev/null 2>&1'), 'read');
  assert.equal(bashMode("sed -i '' s/a/b/ f"), 'write');
  assert.equal(bashMode('rm -rf dist && npm run build'), 'write');
  assert.equal(bashMode('node -e "a => a"'), 'read');
});

test('a shell command writes only what it redirects to or changes; any other path it names is a read', () => {
  const at = (command, cwd = P('/p')) => sorted(bashTouches(command, cwd, HOME));
  // a path quoted in what it prints is not where it writes (a log line naming ~/.nvm, appended elsewhere)
  assert.deepEqual(at('echo "looked at ~/.nvm/x" >> /Users/me/log.md'), sorted([{ path: P('/Users/me/log.md'), mode: 'write' }, { path: P('/h/.nvm/x'), mode: 'read' }]));
  assert.deepEqual(at('cp /Users/a/src.txt /Users/b/dst.txt'), [{ path: P('/Users/a/src.txt'), mode: 'read' }, { path: P('/Users/b/dst.txt'), mode: 'write' }]);
  assert.deepEqual(at('mv -f /tmp/a /tmp/b'), [{ path: P('/tmp/a'), mode: 'write' }, { path: P('/tmp/b'), mode: 'write' }]);
  assert.deepEqual(at('rm -rf dist'), [{ path: P('/p/dist'), mode: 'write' }]);
  assert.deepEqual(at('mkdir -p /tmp/x && touch /tmp/x/y'), [{ path: P('/tmp/x'), mode: 'write' }, { path: P('/tmp/x/y'), mode: 'write' }]);
  assert.deepEqual(at("sed -i 's/a/b/' /Users/x/f.txt"), [{ path: P('/Users/x/f.txt'), mode: 'write' }]);
  assert.deepEqual(at('npm test 2>&1 | tee -a /tmp/out.txt'), [{ path: P('/tmp/out.txt'), mode: 'write' }]);
  assert.deepEqual(at('cd /Users/x/app && echo hi > notes.txt'), sorted([{ path: P('/Users/x/app'), mode: 'read' }, { path: P('/Users/x/app/notes.txt'), mode: 'write' }]), 'a relative target is in the folder cd moved to');
  assert.deepEqual(at('jq ".n > 1" /Users/x/data.json'), [{ path: P('/Users/x/data.json'), mode: 'read' }]);
  assert.deepEqual(at('rm -f logs/*.log'), [{ path: P('/p/logs'), mode: 'write' }], 'a glob counts as its folder');
});

test('what runs after a $(…), a shell keyword or in xargs or bash -c still counts', () => {
  const at = (command, cwd = P('/p')) => sorted(bashTouches(command, cwd, HOME));
  assert.deepEqual(at('t=$(date +%H:%M) && echo "- $t a note" >> /tmp/log.md'), [{ path: P('/tmp/log.md'), mode: 'write' }]);
  assert.deepEqual(at('for w in a b; do rm -rf /tmp/w/$w; done'), [{ path: P('/tmp/w'), mode: 'write' }]);
  assert.deepEqual(at('if [ -f /tmp/x ]; then rm /tmp/x; fi'), [{ path: P('/tmp/x'), mode: 'write' }]);
  // xargs hands rm the paths from its input: unknown, so the folder it runs in
  assert.deepEqual(at('ls /tmp/old | xargs rm -f'), sorted([{ path: P('/tmp/old'), mode: 'read' }, { path: P('/p'), mode: 'write' }]));
  assert.deepEqual(at('bash -c "echo hi > /tmp/b.txt"'), [{ path: P('/tmp/b.txt'), mode: 'write' }]);
});

test('an inline script that writes files writes the paths it names, or the folder it runs in if it names none', () => {
  const at = (command, cwd = P('/p')) => sorted(bashTouches(command, cwd, HOME));
  assert.deepEqual(at("python3 - <<'EOF'\np='/Users/x/notes.md'\ns=open(p).read()\nopen(p,'w').write(s)\nEOF"), [{ path: P('/Users/x/notes.md'), mode: 'write' }]);
  assert.deepEqual(at("python3 - <<'EOF'\nprint(open('/Users/x/notes.md').read())\nEOF"), [{ path: P('/Users/x/notes.md'), mode: 'read' }]);
  assert.deepEqual(at(`node -e "require('fs').writeFileSync('out.json', '{}')"`), [{ path: P('/p'), mode: 'write' }]);
  assert.deepEqual(at(`node -e "process.stdout.write(require('/Users/x/f.json').name)"`), [{ path: P('/Users/x/f.json'), mode: 'read' }], 'printing is not writing a file');
  assert.deepEqual(at("perl -pi -e 's/a/b/' /Users/x/f.txt"), [{ path: P('/Users/x/f.txt'), mode: 'write' }]);
  // - is the code on its input, the words after it the script's own arguments
  assert.deepEqual(at(`python3 - "$S" <<'EOF'\nimport sys\nopen(sys.argv[1] + '/x', 'w').write('')\nEOF`), [{ path: P('/p'), mode: 'write' }]);
});

test('find that deletes, and git that moves or removes files, change what they are given', () => {
  const at = (command, cwd = P('/p')) => sorted(bashTouches(command, cwd, HOME));
  assert.deepEqual(at("find /tmp/probe -name 'shot-*' -mmin -10 -exec rm -rf {} +"), [{ path: P('/tmp/probe'), mode: 'write' }]);
  assert.deepEqual(at("find . -name '*.log' -delete"), [{ path: P('/p'), mode: 'write' }]);
  assert.deepEqual(at("find /tmp/probe -name '*.log'"), [{ path: P('/tmp/probe'), mode: 'read' }]);
  assert.deepEqual(at("find -name '*.tmp' -delete"), [{ path: P('/p'), mode: 'write' }], 'no folder given: where it runs');
  assert.deepEqual(at('git mv web/farm.js web/worlds/farm/world.js'), [{ path: P('/p'), mode: 'git' }]);
  assert.deepEqual(at('git rm -q old.txt && git restore README.md'), [{ path: P('/p'), mode: 'git' }]);
});

test("git counts only for the repo a git command that changes it acts on, not for git words in what it says", () => {
  const at = (command, cwd = P('/p')) => sorted(bashTouches(command, cwd, HOME));
  assert.deepEqual(at('git -C /Users/x/site push'), [{ path: P('/Users/x/site'), mode: 'git' }]);
  assert.deepEqual(at('echo "git commit -m x" >> /tmp/notes.md'), [{ path: P('/tmp/notes.md'), mode: 'write' }]);
  // a commit message written through a heredoc: its words (a path, "git commit") are data, not commands
  const command = "cat > /tmp/msg.txt <<'EOF'\nfixed ~/.nvm, then git commit\nEOF\ngit commit -F /tmp/msg.txt";
  assert.deepEqual(at(command), sorted([{ path: P('/tmp/msg.txt'), mode: 'write' }, { path: P('/h/.nvm'), mode: 'read' }, { path: P('/p'), mode: 'git' }]));
});

test('file tools map to read/write touches', () => {
  assert.deepEqual(touchesFromCall({ name: 'Edit', input: { file_path: P('/p/a.ts') } }, HOME), [{ path: P('/p/a.ts'), mode: 'write' }]);
  assert.deepEqual(touchesFromCall({ name: 'Read', input: { file_path: '~/x' } }, HOME), [{ path: P('/h/x'), mode: 'read' }]);
  assert.deepEqual(touchesFromCall({ name: 'Grep', input: { pattern: 'x' }, cwd: P('/p') }, HOME), [{ path: P('/p'), mode: 'read' }]);
  assert.deepEqual(touchesFromCall({ name: 'Bash', input: { command: 'cd backend && git commit -m x' }, cwd: P('/p') }, HOME), [{ path: P('/p/backend'), mode: 'git' }]);
  assert.deepEqual(touchesFromCall({ name: 'WebSearch', input: { query: 'x' } }, HOME), []);
});

test('collectTouches keeps the latest touch per path and mode inside the window', () => {
  const calls = [
    { name: 'Edit', input: { file_path: P('/p/a.ts') }, at: 5 },
    { name: 'Edit', input: { file_path: P('/p/a.ts') }, at: 10 },
    { name: 'Edit', input: { file_path: P('/p/a.ts') }, at: 20 },
    { name: 'Read', input: { file_path: P('/p/b.ts') }, at: 15 },
  ];
  const got = collectTouches(calls, 8, HOME);
  assert.deepEqual(got, [
    { path: P('/p/a.ts'), mode: 'write', firstAt: 10, lastAt: 20 },
    { path: P('/p/b.ts'), mode: 'read', firstAt: 15, lastAt: 15 },
  ]);
});

test('a > inside quotes is not a redirect, so read-only commands are not writes', () => {
  assert.equal(bashMode(`node -e 'if (a > 1) console.log(a)'`), 'read');
  assert.equal(bashMode(`jq 'select(.n > 1)' data.json`), 'read');
  assert.equal(bashMode('grep -c "a > b" notes.txt'), 'read');
  assert.equal(bashMode('echo "a > b" > out.txt'), 'write');
  assert.equal(bashMode(`printf '%s' x >> log.txt`), 'write');
});

// The drive forms are turned into one native path only on Windows (touches.mjs); on a Mac a C: path is not absolute there.
test('a rooted path with no drive is on the drive of the command\'s own folder, not of this process', { skip: process.platform !== 'win32' ? 'Windows only' : false }, () => {
  const b = String.fromCharCode(92);
  const got = bashTargets('git -C /p/frontend log', `Z:${b}p`, `Z:${b}h`);
  assert.ok(got.includes(`Z:${b}p${b}frontend`), got.join(' | '));
});

test('a Windows drive path in a shell command counts as a target, with either separator', { skip: process.platform !== 'win32' ? 'Windows only' : false }, () => {
  const b = String.fromCharCode(92);
  const want = normalize('C:/work/app/a.txt');
  assert.ok(bashTargets(`type C:${b}work${b}app${b}a.txt`, undefined, 'C:/h').includes(want), 'backslash form');
  assert.ok(bashTargets('cat C:/work/app/a.txt', undefined, 'C:/h').includes(want), 'forward-slash form');
  assert.deepEqual(bashTargets('echo hi', undefined, 'C:/h'), []);
});

test('~ expands to the home folder in one native form, with either separator after it', () => {
  const b = String.fromCharCode(92);
  assert.deepEqual(bashTargets('cat ~/notes.txt', undefined, P('/h')), [P('/h/notes.txt')]);
  assert.equal(touchesFromCall({ name: 'Read', input: { file_path: `~${b}x` } }, P('/h'))[0].path, P('/h/x'));
});

test("on a Mac a sed pattern written with colons is not a drive path: s:/old:/new: is not a file it touched, the file it edits is", () => {
  if (process.platform === 'win32') return;
  assert.deepEqual(bashTouches("sed -i '' 's:/old:/new:' notes.txt", '/p'), [{ path: '/p/notes.txt', mode: 'write' }]);
});
