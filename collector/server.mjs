import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BODY_LIMIT = 64 * 1024;
const MESSAGE_LIMIT = 90 * 1024 * 1024; // up to six 10 MB attached files, base64-encoded

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
const sendJson = (res, status, value) => send(res, status, 'application/json', JSON.stringify(value));

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// A file's bytes through a link (pictures, players, PDFs, a page's preview): the real type, never sniffed
// into something else; a sandbox around anything opened as a page (a page's own scripts may run, in an
// origin of their own, never the dashboard's); ranges, so players can seek. The PDF viewer won't run in
// a sandbox, and a PDF's scripts run in the viewer's own, so PDFs alone go without.
function sendRaw(req, res, { real, type, size }) {
  const headers = { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  if (!type.startsWith('application/pdf')) headers['content-security-policy'] = type.startsWith('text/html') ? 'sandbox allow-scripts' : 'sandbox';
  // A sandboxed page's module scripts and fonts load only with CORS; nothing else gets it, so its
  // scripts can't fetch() the files beside it and read them.
  if (req.headers.origin === 'null' && ['script', 'font'].includes(req.headers['sec-fetch-dest'])) headers['access-control-allow-origin'] = 'null';
  const range = String(req.headers.range ?? '').match(/^bytes=(\d*)-(\d*)$/);
  let start = 0, end = size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1; }
    else { start = Math.max(0, size - Number(range[2])); }
    if (start >= size || start > end) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  } else res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD' || size === 0) return res.end();
  createReadStream(real, { start, end }).on('error', () => res.destroy()).pipe(res);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function createTrackerServer({ port, token, webFile, getSnapshot, getFeed, getConversation, getSubagent, claudePlugins, claudeMcp, claudeRules, fileTicket, rawFile, officeView, getTranscriptHtml, getDoc, listFiles, readFile, repoTouched, actions, pastSessions, log = () => {} }) {
  const clients = new Set();
  let server;
  const actualPort = () => server.address()?.port ?? port;

  const isAllowedHost = host => host === `localhost:${actualPort()}` || host === `127.0.0.1:${actualPort()}`;
  const isAllowedOrigin = origin => origin === `http://localhost:${actualPort()}` || origin === `http://127.0.0.1:${actualPort()}`;

  function openStream(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: snapshot\ndata: ${JSON.stringify(getSnapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  server = createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host ?? '')) return send(res, 403, 'text/plain', 'forbidden host');
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${actualPort()}`);
      const path = url.pathname;
      let m;

      if ((req.method === 'GET' || req.method === 'HEAD') && (m = path.match(/^\/raw\/([\w-]+)\/(.+)$/))) {
        // A link's bytes: the random id is all it takes (an <img> or a player can't send the token).
        let rel;
        try { rel = m[2].split('/').map(decodeURIComponent).join('/'); } catch { return send(res, 404, 'text/plain', 'not found'); }
        const found = await rawFile(m[1], rel);
        return found.real ? sendRaw(req, res, found) : send(res, found.status ?? 404, 'text/plain; charset=utf-8', found.error ?? 'not found');
      }

      if (req.method === 'GET') {
        if (path === '/') return send(res, 200, 'text/html; charset=utf-8', readFileSync(webFile, 'utf8').replace('__TRACKER_TOKEN__', token));
        if ((m = path.match(/^\/([a-z]+)\.js$/))) { // the page's scripts, from web/ by plain name only
          let code;
          try { code = readFileSync(join(dirname(webFile), `${m[1]}.js`), 'utf8'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          return send(res, 200, 'text/javascript; charset=utf-8', code);
        }
        if (path === '/api/state') return sendJson(res, 200, getSnapshot());
        if (path === '/api/events') return openStream(req, res);
        if ((m = path.match(/^\/api\/agent\/([\w:-]+)\/feed$/))) {
          const feed = getFeed(m[1], clampInt(url.searchParams.get('limit'), 1, 200, 200));
          return feed ? sendJson(res, 200, feed) : sendJson(res, 404, { error: 'unknown agent' });
        }
        // A session's whole conversation, or a subagent's prompt, steps and result: token only, like files.
        // The id comes encoded from the page (a subagent's is session:call), so it is decoded, then checked.
        if ((m = path.match(/^\/api\/agent\/([^/]+)\/(conversation|subagent)$/))) {
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          let id = '';
          try { id = decodeURIComponent(m[1]); } catch { /* not an id */ }
          if (!/^[\w-]+(?::[\w-]+)?$/.test(id)) return sendJson(res, 404, { error: 'unknown agent' });
          if (m[2] === 'subagent') {
            const sub = id.includes(':') ? getSubagent(id) : null;
            return sub ? sendJson(res, 200, sub) : sendJson(res, 404, { error: 'That subagent is not known.' });
          }
          const convo = await getConversation(id, clampInt(url.searchParams.get('from'), 0, 1_000_000, 0));
          return convo ? sendJson(res, 200, convo) : sendJson(res, 404, { error: 'That session has no transcript to read.' });
        }
        if ((m = path.match(/^\/api\/agent\/([\w:-]+)\/(doc|file|files|ticket|office)$/))) {
          // Folder listings and file contents: the page sends its token, which other sites can't
          // do without a CORS preflight.
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          if (m[2] === 'files') {
            const listing = await listFiles(m[1]);
            return listing.error ? sendJson(res, listing.status ?? 404, { error: listing.error }) : sendJson(res, 200, listing);
          }
          const file = url.searchParams.get('path') ?? '';
          if (m[2] === 'ticket' || m[2] === 'office') { // a link to a file's bytes, or a document read into tables or a page
            const got = m[2] === 'ticket' ? await fileTicket(m[1], file, { folder: url.searchParams.get('folder') === '1' }) : await officeView(m[1], file);
            return got.error ? sendJson(res, got.status ?? 404, { error: got.error }) : sendJson(res, 200, got);
          }
          const found = m[2] === 'doc' ? getDoc(m[1], file) : await readFile(m[1], file);
          return found.doc ? sendJson(res, 200, found.doc) : sendJson(res, found.status ?? 404, { error: found.error });
        }
        if (path === '/api/claude/plugins' || path === '/api/claude/mcp' || path === '/api/claude/rules') { // your Claude Code setup: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          if (path === '/api/claude/plugins') return sendJson(res, 200, await claudePlugins());
          if (path === '/api/claude/mcp') return sendJson(res, 200, await claudeMcp({ fresh: url.searchParams.get('fresh') === '1' }));
          return sendJson(res, 200, claudeRules());
        }
        if (path === '/api/sessions') { // past sessions' titles and messages: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          return sendJson(res, 200, await pastSessions({ all: url.searchParams.get('days') === 'all' }));
        }
        if (path === '/api/repo/touched') {
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          const touched = await repoTouched(url.searchParams.get('path') ?? '');
          return touched.error ? sendJson(res, touched.status ?? 404, { error: touched.error }) : sendJson(res, 200, touched);
        }
        if ((m = path.match(/^\/agent\/([\w:-]+)\/transcript$/))) {
          const html = await getTranscriptHtml(m[1]);
          return html ? send(res, 200, 'text/html; charset=utf-8', html) : send(res, 404, 'text/plain', 'unknown agent');
        }
      }

      const isBodyAction = ['/api/actions/rm', '/api/actions/answer', '/api/actions/permit', '/api/actions/always', '/api/actions/plugin', '/api/actions/reload', '/api/actions/mcp', '/api/actions/rule', '/api/actions/message', '/api/actions/start', '/api/actions/end', '/api/actions/restart', '/api/actions/setting', '/api/actions/aside', '/api/actions/reveal'].includes(path);
      if (req.method === 'POST' && (isBodyAction || /^\/api\/actions\/open\/[\w-]+$/.test(path))) {
        if (req.headers['x-tracker-token'] !== token || !isAllowedOrigin(req.headers.origin ?? '')) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        let body;
        try {
          body = await readBody(req, path === '/api/actions/message' ? MESSAGE_LIMIT : BODY_LIMIT);
        } catch (err) {
          if (err.status === 413) return sendJson(res, 413, { error: 'That is too large to send.' });
          throw err;
        }
        if (path === '/api/actions/rm') return sendJson(res, 200, await actions.rm(Array.isArray(body.ids) ? body.ids : []));
        if (path === '/api/actions/answer') return sendJson(res, 200, await actions.answer(body));
        if (path === '/api/actions/permit') return sendJson(res, 200, await actions.permit(body));
        if (path === '/api/actions/always') return sendJson(res, 200, await actions.always(body));
        if (path === '/api/actions/plugin') return sendJson(res, 200, await actions.plugin(body));
        if (path === '/api/actions/reload') return sendJson(res, 200, await actions.reload(body));
        if (path === '/api/actions/mcp') return sendJson(res, 200, await actions.mcp(body));
        if (path === '/api/actions/rule') return sendJson(res, 200, await actions.rule(body));
        if (path === '/api/actions/message') return sendJson(res, 200, await actions.message(body));
        if (path === '/api/actions/start') return sendJson(res, 200, await actions.start(body));
        if (path === '/api/actions/setting') return sendJson(res, 200, await actions.setting(body));
        if (path === '/api/actions/aside') return sendJson(res, 200, await actions.aside(body));
        if (path === '/api/actions/reveal') return sendJson(res, 200, await actions.reveal(body));
        if (path === '/api/actions/end') return sendJson(res, 200, await actions.end(body));
        if (path === '/api/actions/restart') return sendJson(res, 200, await actions.restart(body));
        return sendJson(res, 200, await actions.open(path.split('/').pop()));
      }

      return send(res, 404, 'text/plain', 'not found');
    } catch (err) {
      log(`http error: ${err?.stack ?? err}`);
      if (!res.headersSent) send(res, 500, 'text/plain', 'internal error');
      else res.end();
    }
  });

  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, 15_000);
  heartbeat.unref();

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server.address().port));
    }),
    broadcast(snapshot) {
      const data = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
      for (const c of clients) c.write(data);
    },
    close: () => new Promise(resolve => {
      clearInterval(heartbeat);
      for (const c of clients) c.end();
      clients.clear();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
