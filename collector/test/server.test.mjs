import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerServer } from '../server.mjs';
import { renderTranscriptPage } from '../transcript-page.mjs';

async function start() {
  const calls = [];
  const webFile = join(mkdtempSync(join(tmpdir(), 'tracker-web-')), 'index.html');
  writeFileSync(webFile, '<html>token=__TRACKER_TOKEN__</html>');
  const srv = createTrackerServer({
    port: 0,
    token: 'tok',
    webFile,
    getSnapshot: () => ({ generatedAt: 1, agents: [], collisions: [] }),
    getFeed: id => (id === 's1' ? [{ at: 1, kind: 'prompt', text: 'hi' }] : null),
    getTranscriptHtml: async id => (id === 's1' ? renderTranscriptPage('s1', [{ at: 1, kind: 'prompt', text: '<script>alert(1)</script>' }]) : null),
    getDoc: (id, path) => (id === 's1' && path === '/w/spec.md' ? { doc: { path, text: '# Spec', mtimeMs: 1, size: 6 } } : { status: 404, error: 'That document is not one this agent has opened.' }),
    actions: {
      open: async id => { calls.push(['open', id]); return { ok: true }; },
      rm: async ids => { calls.push(['rm', ids]); return { results: [] }; },
      answer: async body => { calls.push(['answer', body]); return { ok: true }; },
      permit: async body => { calls.push(['permit', body]); return { ok: true }; },
      message: async body => { calls.push(['message', body]); return { ok: true }; },
    },
  });
  const port = await srv.listen();
  return { srv, port, calls };
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
