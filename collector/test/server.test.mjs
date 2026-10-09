import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerServer } from '../server.mjs';
import { renderTranscriptPage } from '../transcript-page.mjs';
import { makeWorlds } from '../worlds.mjs';

const RAW_DIR = mkdtempSync(join(tmpdir(), 'tracker-raw-'));
writeFileSync(join(RAW_DIR, 'clip.mp4'), '0123456789');
writeFileSync(join(RAW_DIR, 'page.html'), '<h1>Hi</h1>');
const RAW = { clip: join(RAW_DIR, 'clip.mp4'), page: join(RAW_DIR, 'page.html'), doc: join(RAW_DIR, 'clip.mp4') };
const RAW_TYPE = { clip: 'video/mp4', page: 'text/html; charset=utf-8', doc: 'application/pdf' };

async function start(opts = {}) {
  const calls = [];
  const webFile = join(mkdtempSync(join(tmpdir(), 'tracker-web-')), 'index.html');
  writeFileSync(webFile, '<html>token=__TRACKER_TOKEN__</html>');
  writeFileSync(join(webFile, '..', 'farm.js'), 'window.TrackerFarm = {};');
  writeFileSync(join(webFile, '..', 'app.js'), 'const app = 1;');
  writeFileSync(join(webFile, '..', 'base.css'), ':root { --page: #fff; }');
  const builtinDir = join(webFile, '..', 'worlds');
  mkdirSync(join(builtinDir, 'sdk'), { recursive: true });
  mkdirSync(join(builtinDir, 'farm'));
  writeFileSync(join(builtinDir, 'sdk', 'frame.html'), '<title>__TITLE__</title><script src="__BASE__world.js"></script>');
  writeFileSync(join(builtinDir, 'sdk', 'bridge.js'), '// bridge');
  writeFileSync(join(builtinDir, 'farm', 'world.json'), JSON.stringify({ name: 'Farm', icon: '🌾', api: 1 }));
  writeFileSync(join(builtinDir, 'farm', 'world.js'), '// farm');
  const userDir = mkdtempSync(join(tmpdir(), 'my-worlds-'));
  mkdirSync(join(userDir, 'space'));
  writeFileSync(join(userDir, 'space', 'world.json'), JSON.stringify({ name: 'Space', api: 1 }));
  writeFileSync(join(userDir, 'space', 'world.js'), '// space');
  const srv = createTrackerServer({
    port: 0,
    token: 'tok',
    webFile,
    worlds: makeWorlds({ builtinDir, userDir, home: opts.home }),
    getSnapshot: () => ({ generatedAt: 1, agents: [], collisions: [] }),
    getFeed: id => (id === 's1' ? [{ at: 1, kind: 'prompt', text: 'hi' }] : null),
    getConversation: async (id, from) => (id === 's1' ? { total: 2, from, items: [{ at: 1, kind: 'prompt', body: 'hi' }, { at: 2, kind: 'reply', body: 'hello' }].slice(from) } : null),
    getPrompts: async id => (id === 's1' ? { prompts: ['and then?', 'hi'] } : null),
    getNotes: id => (id === 's1' ? { notes: [{ id: 'n1', text: 'ask about the cache', at: 1 }] } : null),
    getTranscriptHtml: async id => (id === 's1' ? renderTranscriptPage('s1', [{ at: 1, kind: 'prompt', text: '<script>alert(1)</script>' }]) : null),
    listFiles: async id => (id === 's1' ? { root: '/w', git: true, files: ['a.ts'], status: {}, touched: {}, truncated: false } : { status: 404, error: 'That agent was not found.' }),
    readFile: async (id, path) => (id === 's1' && path === '/w/a.ts' ? { doc: { path, text: 'const a = 1;', mtimeMs: 1, size: 12 } } : { status: 403, error: 'That file is outside the agent\'s folder.' }),
    repoTouched: async path => (path === '/code/app' ? { repo: path, name: 'app', branch: 'main', files: [], truncated: false } : { status: 404, error: 'That repo is not on the dashboard.' }),
    getDoc: (id, path) => (id === 's1' && path === '/w/spec.md' ? { doc: { path, text: '# Spec', mtimeMs: 1, size: 6 } } : { status: 404, error: 'That document is not one this agent has opened.' }),
    actions: {
      open: async id => { calls.push(['open', id]); return { ok: true }; },
      rm: async ids => { calls.push(['rm', ids]); return { results: [] }; },
      answer: async body => { calls.push(['answer', body]); return { ok: true }; },
      permit: async body => { calls.push(['permit', body]); return { ok: true }; },
      message: async body => { calls.push(['message', body]); return { ok: true }; },
      start: async body => { calls.push(['start', body]); return { ok: true }; },
      fork: async body => { calls.push(['fork', body]); return { ok: true }; },
      restore: async body => { calls.push(['restore', body]); return { ok: true }; },
      note: async body => { calls.push(['note', body]); return { ok: true, notes: [] }; },
      end: async body => { calls.push(['end', body]); return { ok: true }; },
      restart: async body => { calls.push(['restart', body]); return { ok: true }; },
      plugin: async body => { calls.push(['plugin', body]); return { ok: true }; },
      reveal: async body => { calls.push(['reveal', body]); return { ok: true }; },
      revealWorlds: async () => { calls.push(['revealWorlds']); return { ok: true, path: '/Users/me/.agentville/worlds' }; },
      mkdir: async body => { calls.push(['mkdir', body]); return { ok: true, path: '/Users/me/new' }; },
      chooseFolder: async body => { calls.push(['choose', body]); return { ok: true, path: '/Users/me/picked' }; },
      stopShell: async body => { calls.push(['stop', body]); return { ok: true }; },
      reload: async () => { calls.push(['reload']); return { ok: true, sessions: 2 }; },
      mcp: async body => { calls.push(['mcp', body]); return { ok: true }; },
      rule: async body => { calls.push(['rule', body]); return { ok: true }; },
    },
    getSubagent: id => (id === 's1:tA' ? { prompt: 'Find callers', result: null, feed: [] } : null),
    namedFiles: async (id, paths) => { calls.push(['named', id, paths]); return { items: paths.map(p => ({ asked: p, ok: false })) }; },
    shellOutput: async (id, pid) => { calls.push(['output', id, pid]); return { text: 'ready', size: 5, truncated: false }; },
    listDirs: async typed => { calls.push(['dirs', typed]); return { dir: '/Users/me', dirs: ['code'], exists: true }; },
    fileTicket: async (id, path, opts) => { calls.push(['ticket', id, path, opts]); return { url: '/raw/abc/x.png', type: 'image/png', size: 10 }; },
    officeView: async (id, path) => ({ view: 'sheet', sheets: [{ name: path, rows: [], truncated: false }] }),
    rawFile: async (id, rel) => (RAW[id] ? { real: RAW[id], type: RAW_TYPE[id], size: 10 } : { status: 404, error: 'That link has expired: open the file again.' }),
    claudePlugins: async () => ({ plugins: [{ id: 'alpha@m' }], skills: [] }),
    claudeMcp: async opts => { calls.push(['claudeMcp', opts]); return { servers: [], projects: [] }; },
    claudeRules: () => ({ files: [] }),
    pastSessions: async opts => { calls.push(['pastSessions', opts]); return { terminal: 'iTerm', projects: [{ cwd: '/code/app' }], sessions: [] }; },
  });
  const port = await srv.listen();
  return { srv, port, calls, userDir };
}

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('the dashboard is served with the token filled in', async () => {
  const { srv, port } = await start();
  const r = await request(port);
  assert.equal(r.status, 200);
  assert.equal(r.body, '<html>token=tok</html>');
  await srv.close();
});

test('a request for another Host name is refused (DNS rebinding guard)', async () => {
  const { srv, port } = await start();
  const r = await request(port, { path: '/api/state', headers: { host: 'evil.example:80' } });
  assert.equal(r.status, 403);
  await srv.close();
});

test('state, feed and transcript routes answer; unknown agents are 404', async () => {
  const { srv, port } = await start();
  assert.deepEqual(JSON.parse((await request(port, { path: '/api/state' })).body), { generatedAt: 1, agents: [], collisions: [] });
  assert.equal(JSON.parse((await request(port, { path: '/api/agent/s1/feed?limit=5' })).body)[0].text, 'hi');
  assert.equal((await request(port, { path: '/api/agent/nope/feed' })).status, 404);
  const page = await request(port, { path: '/agent/s1/transcript' });
  assert.equal(page.status, 200);
  assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!page.body.includes('<script>alert(1)'));
  assert.equal((await request(port, { path: '/nowhere' })).status, 404);
  await srv.close();
});

test('the event stream sends the snapshot on connect and on every broadcast', async () => {
  const { srv, port } = await start();
  let all = '';
  await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/events', headers: { host: `127.0.0.1:${port}` } }, res => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      res.on('data', chunk => {
        all += chunk;
        if (all.includes('"generatedAt":1') && !all.includes('"generatedAt":2')) srv.broadcast({ generatedAt: 2 });
        if (all.includes('"generatedAt":2')) { req.destroy(); resolve(); }
      });
    });
    req.on('error', err => (err.code === 'ECONNRESET' ? resolve() : reject(err)));
    req.end();
  });
  assert.match(all, /event: snapshot\ndata: \{"generatedAt":1/);
  await srv.close();
});

test('a change to a world is sent on the event stream, by its key', async () => {
  const { srv, port } = await start();
  let all = '', sent = false;
  await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/events', headers: { host: `127.0.0.1:${port}` } }, res => {
      res.on('data', chunk => {
        all += chunk;
        if (!sent && all.includes('"generatedAt":1')) { sent = true; srv.broadcastWorlds({ key: 'u/space' }); }
        if (all.includes('event: worlds')) { req.destroy(); resolve(); }
      });
    });
    req.on('error', err => (err.code === 'ECONNRESET' ? resolve() : reject(err)));
    req.end();
  });
  assert.ok(all.includes('event: worlds\ndata: {"key":"u/space"}'));
  await srv.close();
});

test('Open the worlds folder takes the token and the dashboard as origin, like every action', async () => {
  const { srv, port, calls } = await start();
  const origin = `http://127.0.0.1:${port}`, path = '/api/actions/reveal-worlds', type = { 'content-type': 'application/json' };
  assert.equal((await request(port, { method: 'POST', path, headers: { ...type, origin }, body: '{}' })).status, 403);
  assert.equal((await request(port, { method: 'POST', path, headers: { ...type, 'x-tracker-token': 'tok', origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const r = await request(port, { method: 'POST', path, headers: { ...type, 'x-tracker-token': 'tok', origin }, body: '{}' });
  assert.deepEqual(JSON.parse(r.body), { ok: true, path: '/Users/me/.agentville/worlds' });
  assert.deepEqual(calls.at(-1), ['revealWorlds']);
  await srv.close();
});

test('actions need both the token and a same-origin Origin header', async () => {
  const { srv, port, calls } = await start();
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await request(port, { method: 'POST', path: '/api/actions/open/abc', headers: { origin } })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/api/actions/open/abc', headers: { 'x-tracker-token': 'tok', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/api/actions/open/abc', headers: { 'x-tracker-token': 'wrong', origin } })).status, 403);
  assert.deepEqual(calls, []);
  const ok = await request(port, { method: 'POST', path: '/api/actions/open/abc', headers: { 'x-tracker-token': 'tok', origin } });
  assert.equal(ok.status, 200);
  await request(port, { method: 'POST', path: '/api/actions/rm', headers: { 'x-tracker-token': 'tok', origin, 'content-type': 'application/json' }, body: JSON.stringify({ ids: ['x1'] }) });
  assert.deepEqual(calls, [['open', 'abc'], ['rm', ['x1']]]);
  await srv.close();
});

test('ids with shell or AppleScript characters never reach an action', async () => {
  const { srv, port, calls } = await start();
  const r = await request(port, { method: 'POST', path: '/api/actions/open/a;b', headers: { 'x-tracker-token': 'tok', origin: `http://127.0.0.1:${port}` } });
  assert.equal(r.status, 404);
  assert.deepEqual(calls, []);
  await srv.close();
});

test('the transcript page follows the theme saved on the dashboard', () => {
  const page = renderTranscriptPage('s1', []);
  assert.match(page, /localStorage\.getItem\('tracker-theme'\)/);
  assert.match(page, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(page, /:root:not\(\[data-theme="light"\]\)/);
  assert.match(page, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.match(page, /\|\| 'dark'/);
});

test('answers and permission decisions are posted to their actions, guarded like the others', async () => {
  const { srv, port, calls } = await start();
  const origin = `http://127.0.0.1:${port}`;
  const post = (path, body, headers = { 'x-tracker-token': 'tok', origin }) =>
    request(port, { method: 'POST', path, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/actions/answer', { agentId: 's1' }, { origin })).status, 403);
  assert.deepEqual(calls, []);
  const answer = { agentId: 's1', toolUseId: 'toolu_A', answers: { 'Pick a colour?': 'Blue' } };
  assert.equal((await post('/api/actions/answer', answer)).status, 200);
  assert.equal((await post('/api/actions/permit', { agentId: 's1', toolUseId: 'toolu_B', decision: 'allow' })).status, 200);
  assert.deepEqual(calls, [['answer', answer], ['permit', { agentId: 's1', toolUseId: 'toolu_B', decision: 'allow' }]]);
  await srv.close();
});

test('chat messages are posted to their action, guarded like the others', async () => {
  const { srv, port, calls } = await start();
  const origin = `http://127.0.0.1:${port}`;
  const body = JSON.stringify({ agentId: 's1', text: 'hello' });
  assert.equal((await request(port, { method: 'POST', path: '/api/actions/message', headers: { origin, 'content-type': 'application/json' }, body })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/api/actions/message', headers: { 'x-tracker-token': 'tok', origin, 'content-type': 'application/json' }, body })).status, 200);
  assert.deepEqual(calls, [['message', { agentId: 's1', text: 'hello' }]]);
  await srv.close();
});

test('a document is served only with the token, and only one the agent has opened', async () => {
  const { srv, port } = await start();
  try {
    const path = `/api/agent/s1/doc?path=${encodeURIComponent('/w/spec.md')}`;
    assert.equal((await request(port, { path })).status, 403);
    const ok = await request(port, { path, headers: { 'x-tracker-token': 'tok' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { path: '/w/spec.md', text: '# Spec', mtimeMs: 1, size: 6 });
    const other = await request(port, { path: '/api/agent/s1/doc?path=%2Fetc%2Fpasswd', headers: { 'x-tracker-token': 'tok' } });
    assert.equal(other.status, 404);
    assert.match(JSON.parse(other.body).error, /not one this agent has opened/);
  } finally {
    await srv.close();
  }
});

test('the explorer listing and file contents are served only with the token', async () => {
  const { srv, port } = await start();
  try {
    const tok = { 'x-tracker-token': 'tok' };
    assert.equal((await request(port, { path: '/api/agent/s1/files' })).status, 403);
    const list = await request(port, { path: '/api/agent/s1/files', headers: tok });
    assert.equal(list.status, 200);
    assert.deepEqual(JSON.parse(list.body).files, ['a.ts']);
    assert.equal((await request(port, { path: '/api/agent/zz/files', headers: tok })).status, 404);
    const file = `/api/agent/s1/file?path=${encodeURIComponent('/w/a.ts')}`;
    assert.equal((await request(port, { path: file })).status, 403);
    const ok = await request(port, { path: file, headers: tok });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).text, 'const a = 1;');
    const out = await request(port, { path: '/api/agent/s1/file?path=%2Fetc%2Fhosts', headers: tok });
    assert.equal(out.status, 403);
    assert.match(JSON.parse(out.body).error, /outside/);
  } finally {
    await srv.close();
  }
});

test('a message may carry files, so its body may be large; other actions stay small', async () => {
  const { srv, port, calls } = await start();
  try {
    const headers = { 'content-type': 'application/json', 'x-tracker-token': 'tok', origin: `http://127.0.0.1:${port}` };
    const big = JSON.stringify({ agentId: 's1', text: 'see', files: [{ name: 'a.pdf', data: 'A'.repeat(200_000) }] });
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/message', headers, body: big })).status, 200);
    assert.equal(calls.at(-1)[1].files[0].data.length, 200_000);
    const r = await request(port, { method: 'POST', path: '/api/actions/answer', headers, body: big });
    assert.equal(r.status, 413);
  } finally {
    await srv.close();
  }
});

test("a repo's touched files are served only with the token, and only for a repo on the dashboard", async () => {
  const { srv, port } = await start();
  try {
    const path = `/api/repo/touched?path=${encodeURIComponent('/code/app')}`;
    assert.equal((await request(port, { path })).status, 403);
    const ok = await request(port, { path, headers: { 'x-tracker-token': 'tok' } });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).name, 'app');
    const other = await request(port, { path: '/api/repo/touched?path=%2Fetc', headers: { 'x-tracker-token': 'tok' } });
    assert.equal(other.status, 404);
  } finally {
    await srv.close();
  }
});

test('the farm script is served as JavaScript without a token, but never to another Host', async () => {
  const { srv, port } = await start();
  try {
    const r = await request(port, { path: '/farm.js' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.body, 'window.TrackerFarm = {};');
    assert.equal((await request(port, { path: '/farm.js', headers: { host: 'evil.example:80' } })).status, 403);
  } finally {
    await srv.close();
  }
});

test("the page's scripts are served from web/ by name, and nothing else is", async () => {
  const { srv, port } = await start();
  try {
    const app = await request(port, { path: '/app.js' });
    assert.equal(app.status, 200);
    assert.equal(app.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(app.body, 'const app = 1;');
    assert.equal((await request(port, { path: '/missing.js' })).status, 404);
    assert.equal((await request(port, { path: '/..%2Fpackage.js' })).status, 404);
    assert.equal((await request(port, { path: '/index.html' })).status, 404);
  } finally {
    await srv.close();
  }
});

test("Claude Code's setup is read only with the token, and changed only with the token from the page itself", async () => {
  const { srv, port, calls } = await start();
  try {
    for (const path of ['/api/claude/plugins', '/api/claude/mcp', '/api/claude/rules']) assert.equal((await request(port, { path })).status, 403, path);
    const headers = { 'x-tracker-token': 'tok' };
    assert.deepEqual(JSON.parse((await request(port, { path: '/api/claude/plugins', headers })).body).plugins, [{ id: 'alpha@m' }]);
    await request(port, { path: '/api/claude/mcp?fresh=1', headers });
    await request(port, { path: '/api/claude/rules', headers });
    assert.deepEqual(calls.splice(0), [['claudeMcp', { fresh: true }]]);
    const origin = `http://127.0.0.1:${port}`;
    const body = JSON.stringify({ id: 'alpha@m', op: 'disable' });
    for (const path of ['/api/actions/plugin', '/api/actions/reload', '/api/actions/mcp', '/api/actions/rule']) {
      assert.equal((await request(port, { method: 'POST', path, headers: { ...headers, origin: 'https://evil.example', 'content-type': 'application/json' }, body })).status, 403, path);
    }
    assert.deepEqual(calls, []);
    for (const path of ['/api/actions/plugin', '/api/actions/reload', '/api/actions/mcp', '/api/actions/rule']) {
      assert.equal((await request(port, { method: 'POST', path, headers: { ...headers, origin, 'content-type': 'application/json' }, body })).status, 200, path);
    }
    assert.deepEqual(calls.map(c => c[0]), ['plugin', 'reload', 'mcp', 'rule']);
  } finally {
    await srv.close();
  }
});

test("a file's link and a document's reading need the token; its bytes need only the link, served so they never run as the dashboard", async () => {
  const { srv, port, calls } = await start();
  try {
    const headers = { 'x-tracker-token': 'tok' };
    for (const path of ['/api/agent/s1/ticket?path=%2Fw%2Fx.png', '/api/agent/s1/office?path=%2Fw%2Fb.xlsx']) assert.equal((await request(port, { path })).status, 403, path);
    assert.deepEqual(JSON.parse((await request(port, { path: '/api/agent/s1/ticket?path=%2Fw%2Fx.png&folder=1', headers })).body).url, '/raw/abc/x.png');
    assert.deepEqual(calls.at(-1), ['ticket', 's1', '/w/x.png', { folder: true }]);
    assert.equal(JSON.parse((await request(port, { path: '/api/agent/s1/office?path=%2Fw%2Fb.xlsx', headers })).body).view, 'sheet');

    const clip = await request(port, { path: '/raw/clip/clip.mp4' });
    assert.equal(clip.status, 200);
    assert.equal(clip.body, '0123456789');
    assert.deepEqual([clip.headers['content-type'], clip.headers['x-content-type-options'], clip.headers['content-security-policy'], clip.headers['accept-ranges'], clip.headers['cache-control']],
      ['video/mp4', 'nosniff', 'sandbox', 'bytes', 'private, max-age=600'], 'kept by this browser for as long as its link lasts: a thumbnail drawn again is not fetched again');
    const part = await request(port, { path: '/raw/clip/clip.mp4', headers: { range: 'bytes=2-5' } });
    assert.deepEqual([part.status, part.body, part.headers['content-range']], [206, '2345', 'bytes 2-5/10'], 'a player seeks with ranges');
    assert.equal((await request(port, { path: '/raw/clip/clip.mp4', headers: { range: 'bytes=20-30' } })).status, 416);
    const page = await request(port, { path: '/raw/page/page.html' });
    assert.equal(page.headers['content-security-policy'], 'sandbox allow-scripts', 'a page runs its scripts, in a sandbox of its own');
    const from = dest => request(port, { path: '/raw/page/page.html', headers: { origin: 'null', 'sec-fetch-dest': dest } });
    assert.equal((await from('script')).headers['access-control-allow-origin'], 'null', 'its own module scripts load from its sandbox');
    assert.equal((await from('font')).headers['access-control-allow-origin'], 'null', 'and its fonts');
    assert.equal((await from('empty')).headers['access-control-allow-origin'], undefined, "but its scripts can't fetch() and read the files beside it");
    assert.equal((await request(port, { path: '/raw/doc/a.pdf' })).headers['content-security-policy'], undefined, "the PDF viewer won't open in a sandbox");
    assert.equal((await request(port, { path: '/raw/nope/x' })).status, 404);

    const origin = `http://127.0.0.1:${port}`;
    const body = JSON.stringify({ agentId: 's1', path: '/w/x.png' });
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/reveal', headers: { ...headers, origin: 'https://evil.example', 'content-type': 'application/json' }, body })).status, 403);
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/reveal', headers: { ...headers, origin, 'content-type': 'application/json' }, body })).status, 200);
    assert.deepEqual(calls.at(-1), ['reveal', { agentId: 's1', path: '/w/x.png' }]);
  } finally {
    await srv.close();
  }
});

test('the list of worlds needs the token, and says where your folder is', async () => {
  const { srv, port } = await start();
  assert.equal((await request(port, { path: '/api/worlds' })).status, 403);
  const r = JSON.parse((await request(port, { path: '/api/worlds', headers: { 'x-tracker-token': 'tok' } })).body);
  assert.deepEqual(r.worlds.map(w => w.key), ['farm', 'u/space']);
  assert.match(r.folder, /my-worlds-/);
  assert.equal((await request(port, { path: '/world/u/space/' })).status, 200);
  assert.equal((await request(port, { path: '/world/u/space/world.js' })).body, '// space');
  const fromFrame = dest => request(port, { path: '/world/u/space/world.js', headers: { origin: 'null', 'sec-fetch-dest': dest } });
  assert.equal((await fromFrame('script')).headers['access-control-allow-origin'], 'null', "a world's script loads in CORS mode, so its errors are reported in full");
  assert.equal((await fromFrame('empty')).headers['access-control-allow-origin'], undefined, "but a world's fetch() can't read its files");
  const acao = (path, headers) => request(port, { path, headers }).then(r => r.headers['access-control-allow-origin']);
  assert.equal(await acao('/world/u/space/world.js', { origin: 'null' }), 'null', 'a browser that sends no fetch destination (older Safari): a script by its name');
  assert.equal(await acao('/world/u/space/world.json', { origin: 'null' }), undefined, 'but not a data file');
  assert.equal(await acao('/world/u/space/world.js', { origin: 'https://evil.example', 'sec-fetch-dest': 'script' }), undefined, 'and only to the frame (origin null)');
  await srv.close();
});

test("a world folder linked to your home or above is never served, however the link is spelled", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'home-')));
  writeFileSync(join(home, 'world.json'), JSON.stringify({ name: 'Home', api: 1 }));
  writeFileSync(join(home, 'world.js'), '// the whole home folder');
  const { srv, port, userDir } = await start({ home });
  try {
    const spell = p => [p, p.toUpperCase(), join('/System/Volumes/Data', p)].filter(s => existsSync(s));
    const targets = [...spell(home), ...spell(join(userDir, '..')), '/System/Volumes/Data', '/'].filter(t => existsSync(t));
    targets.forEach((t, i) => symlinkSync(t, join(userDir, `l${i}`)));
    for (const i of targets.keys()) {
      for (const f of ['world.js', 'world.json']) assert.equal((await request(port, { path: `/world/u/l${i}/${f}` })).status, 404, `${targets[i]} ${f}`);
      assert.equal((await request(port, { path: `/world/u/l${i}/` })).status, 404, targets[i]);
    }
  } finally { await srv.close(); }
});

test('folders to start in are listed only with the token, and made only from the dashboard', async () => {
  const { srv, port, calls } = await start();
  try {
    assert.equal((await request(port, { path: '/api/dirs?path=~%2F' })).status, 403);
    const r = await request(port, { path: '/api/dirs?path=~%2Fco', headers: { 'x-tracker-token': 'tok' } });
    assert.deepEqual(JSON.parse(r.body).dirs, ['code']);
    assert.deepEqual(calls.at(-1), ['dirs', '~/co']);
    const body = JSON.stringify({ path: '~/new' });
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/mkdir', headers: { 'x-tracker-token': 'tok', origin: 'https://evil.example', 'content-type': 'application/json' }, body })).status, 403);
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/mkdir', headers: { 'x-tracker-token': 'tok', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, body })).status, 200);
    assert.deepEqual(calls.at(-1), ['mkdir', { path: '~/new' }]);
    const pick = JSON.stringify({ start: '/Users/me' });
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/choose-folder', headers: { 'x-tracker-token': 'tok', origin: 'https://evil.example', 'content-type': 'application/json' }, body: pick })).status, 403, "only the dashboard opens Finder's window");
    assert.equal(JSON.parse((await request(port, { method: 'POST', path: '/api/actions/choose-folder', headers: { 'x-tracker-token': 'tok', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, body: pick })).body).path, '/Users/me/picked');
  } finally {
    await srv.close();
  }
});

test('files named in replies are checked only with the token', async () => {
  const { srv, port, calls } = await start();
  try {
    assert.equal((await request(port, { path: '/api/agent/s1/named?path=a.png' })).status, 403);
    const r = await request(port, { path: '/api/agent/s1/named?path=a.png&path=%2Fw%2Fb.mov', headers: { 'x-tracker-token': 'tok' } });
    assert.equal(JSON.parse(r.body).items.length, 2);
    assert.deepEqual(calls.at(-1), ['named', 's1', ['a.png', '/w/b.mov']]);
  } finally {
    await srv.close();
  }
});

test("a shell command's output needs the token; stopping one needs the dashboard", async () => {
  const { srv, port, calls } = await start();
  try {
    assert.equal((await request(port, { path: '/api/agent/s1/shell-output?pid=5001' })).status, 403);
    assert.equal(JSON.parse((await request(port, { path: '/api/agent/s1/shell-output?pid=5001', headers: { 'x-tracker-token': 'tok' } })).body).text, 'ready');
    assert.deepEqual(calls.at(-1), ['output', 's1', 5001]);
    const body = JSON.stringify({ agentId: 's1', pid: 5001 });
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/stop-shell', headers: { 'x-tracker-token': 'tok', origin: 'https://evil.example', 'content-type': 'application/json' }, body })).status, 403);
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/stop-shell', headers: { 'x-tracker-token': 'tok', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, body })).status, 200);
    assert.deepEqual(calls.at(-1), ['stop', { agentId: 's1', pid: 5001 }]);
  } finally {
    await srv.close();
  }
});

test("a subagent's prompt, steps and result need the token", async () => {
  const { srv, port } = await start();
  try {
    assert.equal((await request(port, { path: '/api/agent/s1:tA/subagent' })).status, 403);
    const r = await request(port, { path: '/api/agent/s1:tA/subagent', headers: { 'x-tracker-token': 'tok' } });
    assert.deepEqual(JSON.parse(r.body), { prompt: 'Find callers', result: null, feed: [] });
    assert.equal((await request(port, { path: '/api/agent/s1%3AtA/subagent', headers: { 'x-tracker-token': 'tok' } })).status, 200, 'its id encoded, as the page sends it');
    assert.equal((await request(port, { path: '/api/agent/s1:nope/subagent', headers: { 'x-tracker-token': 'tok' } })).status, 404);
    assert.equal((await request(port, { path: '/api/agent/s1%2F..%2Fx/subagent', headers: { 'x-tracker-token': 'tok' } })).status, 404, 'nothing but an id');
  } finally {
    await srv.close();
  }
});

test("a session's own messages, for ↑ in its message box, need the token too", async () => {
  const { srv, port } = await start();
  try {
    assert.equal((await request(port, { path: '/api/agent/s1/prompts' })).status, 403);
    const headers = { 'x-tracker-token': 'tok' };
    assert.deepEqual(JSON.parse((await request(port, { path: '/api/agent/s1/prompts', headers })).body), { prompts: ['and then?', 'hi'] });
    assert.equal((await request(port, { path: '/api/agent/nobody/prompts', headers })).status, 404);
    assert.equal((await request(port, { path: '/api/agent/s1%3Atoolu_1/prompts', headers })).status, 404, "a subagent's are not yours");
  } finally {
    await srv.close();
  }
});

test("your notes on a session need the token to read, and the token and the page's own Origin to change", async () => {
  const { srv, port, calls } = await start();
  try {
    const headers = { 'x-tracker-token': 'tok' };
    assert.equal((await request(port, { path: '/api/agent/s1/notes' })).status, 403);
    assert.deepEqual(JSON.parse((await request(port, { path: '/api/agent/s1/notes', headers })).body), { notes: [{ id: 'n1', text: 'ask about the cache', at: 1 }] });
    assert.equal((await request(port, { path: '/api/agent/nobody/notes', headers })).status, 404);
    assert.equal((await request(port, { path: '/api/agent/s1%3Atoolu_1/notes', headers })).status, 404, 'a subagent has none');
    const origin = `http://127.0.0.1:${port}`;
    const json = { 'content-type': 'application/json' };
    const body = '{"agentId":"s1","op":"add","text":"later"}';
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/note', headers: { ...json, origin }, body })).status, 403);
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/note', headers: { ...json, ...headers, origin: 'https://evil.example' }, body })).status, 403);
    assert.deepEqual(calls, []);
    assert.deepEqual(JSON.parse((await request(port, { method: 'POST', path: '/api/actions/note', headers: { ...json, ...headers, origin }, body })).body), { ok: true, notes: [] });
    assert.deepEqual(calls, [['note', { agentId: 's1', op: 'add', text: 'later' }]]);
  } finally {
    await srv.close();
  }
});

test("a session's whole conversation needs the token, like files", async () => {
  const { srv, port } = await start();
  try {
    assert.equal((await request(port, { path: '/api/agent/s1/conversation' })).status, 403);
    const headers = { 'x-tracker-token': 'tok' };
    const all = await request(port, { path: '/api/agent/s1/conversation', headers });
    assert.equal(all.status, 200);
    assert.deepEqual(JSON.parse(all.body).items.map(m => m.body), ['hi', 'hello']);
    assert.deepEqual(JSON.parse((await request(port, { path: '/api/agent/s1/conversation?from=1', headers })).body), { total: 2, from: 1, items: [{ at: 2, kind: 'reply', body: 'hello' }] });
    assert.equal((await request(port, { path: '/api/agent/nobody/conversation', headers })).status, 404);
  } finally {
    await srv.close();
  }
});

test('past sessions need the token; starting one needs the token and a same-origin Origin header', async () => {
  const { srv, port, calls } = await start();
  try {
    assert.equal((await request(port, { path: '/api/sessions' })).status, 403);
    const list = await request(port, { path: '/api/sessions', headers: { 'x-tracker-token': 'tok' } });
    assert.equal(list.status, 200);
    assert.equal(JSON.parse(list.body).terminal, 'iTerm');
    await request(port, { path: '/api/sessions?days=all', headers: { 'x-tracker-token': 'tok' } });
    await request(port, { path: '/api/sessions?days=9999', headers: { 'x-tracker-token': 'tok' } });
    assert.deepEqual(calls.splice(0), [['pastSessions', { all: false }], ['pastSessions', { all: true }], ['pastSessions', { all: false }]], 'the last 30 days, unless all are asked for');
    const origin = `http://127.0.0.1:${port}`;
    const body = JSON.stringify({ cwd: '/code/app' });
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/start', headers: { 'x-tracker-token': 'tok', origin: 'https://evil.example', 'content-type': 'application/json' }, body })).status, 403);
    assert.deepEqual(calls, []);
    assert.equal((await request(port, { method: 'POST', path: '/api/actions/start', headers: { 'x-tracker-token': 'tok', origin, 'content-type': 'application/json' }, body })).status, 200);
    assert.deepEqual(calls, [['start', { cwd: '/code/app' }]]);
  } finally {
    await srv.close();
  }
});

test('ending, restarting, forking or restoring a session needs the token and a same-origin Origin header', async () => {
  const { srv, port, calls } = await start();
  try {
    const origin = `http://127.0.0.1:${port}`;
    const json = { 'content-type': 'application/json' };
    for (const path of ['/api/actions/end', '/api/actions/restart', '/api/actions/fork', '/api/actions/restore']) {
      assert.equal((await request(port, { method: 'POST', path, headers: { ...json, origin }, body: '{"agentId":"s1"}' })).status, 403);
      assert.equal((await request(port, { method: 'POST', path, headers: { ...json, 'x-tracker-token': 'tok', origin: 'https://evil.example' }, body: '{"agentId":"s1"}' })).status, 403);
    }
    assert.deepEqual(calls, []);
    await request(port, { method: 'POST', path: '/api/actions/end', headers: { ...json, 'x-tracker-token': 'tok', origin }, body: '{"agentId":"s1"}' });
    await request(port, { method: 'POST', path: '/api/actions/restart', headers: { ...json, 'x-tracker-token': 'tok', origin }, body: '{"agentId":"s1","mode":"plan"}' });
    await request(port, { method: 'POST', path: '/api/actions/fork', headers: { ...json, 'x-tracker-token': 'tok', origin }, body: '{"agentId":"s1","at":"r-1"}' });
    await request(port, { method: 'POST', path: '/api/actions/restore', headers: { ...json, 'x-tracker-token': 'tok', origin }, body: '{"agentId":"s1","at":"p-2","what":"both"}' });
    assert.deepEqual(calls, [['end', { agentId: 's1' }], ['restart', { agentId: 's1', mode: 'plan' }], ['fork', { agentId: 's1', at: 'r-1' }], ['restore', { agentId: 's1', at: 'p-2', what: 'both' }]]);
  } finally {
    await srv.close();
  }
});

test("a world's frame page is served sandboxed with its own CSP; an unknown world is 404", async () => {
  const { srv, port } = await start();
  const r = await request(port, { path: '/world/farm/' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(r.headers['content-security-policy'], /^sandbox allow-scripts; default-src 'none'; script-src 'self'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.body, '<title>Farm</title><script src="/world/farm/world.js"></script>');
  assert.equal((await request(port, { path: '/world/nope/' })).status, 404);
  assert.equal((await request(port, { path: '/world/Farm/' })).status, 404);
  await srv.close();
});

test("a world's files: typed, sandboxed, never cached (they change while you write them); nothing outside", async () => {
  const { srv, port } = await start();
  const js = await request(port, { path: '/world/farm/world.js' });
  assert.equal(js.status, 200);
  assert.equal(js.body, '// farm');
  assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(js.headers['content-security-policy'], 'sandbox');
  assert.equal(js.headers['cache-control'], 'no-store');
  assert.equal((await request(port, { path: '/world/sdk/bridge.js' })).body, '// bridge');
  // (A literal /world/farm/%2e%2e/ is folded to /world/ by the URL parser before routing, so it can't escape either.)
  for (const path of ['/world/farm/art%2f..%2f..%2fsdk%2fbridge.js', '/world/farm/..%2fsdk%2fbridge.js', '/world/sdk/frame.html', '/world/farm/world.json%00.js']) {
    assert.equal((await request(port, { path })).status, 404, path);
  }
  await srv.close();
});

test('the dashboard and its API refuse to be shown in a frame; every reply says not to sniff its type', async () => {
  const { srv, port } = await start();
  for (const path of ['/', '/api/state']) {
    const r = await request(port, { path });
    assert.equal(r.headers['content-security-policy'], "frame-ancestors 'none'", path);
    assert.equal(r.headers['x-frame-options'], 'DENY', path);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', path);
  }
  const css = await request(port, { path: '/base.css' });
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(css.body, ':root { --page: #fff; }');
  await srv.close();
});
