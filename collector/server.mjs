import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FRAME_CSP } from './worlds.mjs';

const BODY_LIMIT = 64 * 1024;
const MESSAGE_LIMIT = 90 * 1024 * 1024; // up to six 10 MB attached files, base64-encoded

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
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
  // Kept in this browser only, and only for as long as the link lasts (each link is new): a thumbnail drawn again is not fetched again.
  const headers = { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=600', 'accept-ranges': 'bytes' };
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

export function createTrackerServer({ port, token, webFile, getSnapshot, getFeed, getConversation, getPrompts, getNotes, getHeld = () => null, getSubagent, claudePlugins, claudeMcp, claudeRules, fileTicket, rawFile, officeView, listDirs, shellOutput, namedFiles, getTranscriptHtml, getDoc, listFiles, readFile, repoTouched, actions, pastSessions, worlds, log = () => {} }) {
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
      // The dashboard holds the token: it is never shown inside a frame, not even a world's own.
      if (path === '/' || path.startsWith('/api/')) {
        res.setHeader('content-security-policy', "frame-ancestors 'none'");
        res.setHeader('x-frame-options', 'DENY');
      }

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
        if ((m = path.match(/^\/([a-z]+)\.css$/))) { // the page's and the worlds' shared styles, from web/ by plain name only
          let css;
          try { css = readFileSync(join(dirname(webFile), `${m[1]}.css`), 'utf8'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          return send(res, 200, 'text/css; charset=utf-8', css);
        }
        if ((m = path.match(/^\/world\/((?:u\/)?[a-z0-9-]+)\/$/))) { // a world's frame: sandboxed, its own CSP
          const html = worlds?.frame(m[1]);
          if (!html) return send(res, 404, 'text/plain', 'not found');
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': FRAME_CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
          return res.end(html);
        }
        if ((m = path.match(/^\/world\/((?:u\/)?[a-z0-9-]+)\/(.+)$/))) { // one of a world's files, from inside its folder only
          let rel;
          try { rel = m[2].split('/').map(decodeURIComponent).join('/'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          if (rel.includes('\0')) return send(res, 404, 'text/plain', 'not found');
          const found = worlds ? worlds.file(m[1], rel) : { status: 404 };
          if (!found.real) return send(res, 404, 'text/plain', 'not found');
          const headers = { 'content-type': found.type, 'content-length': found.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' };
          // The frame's origin is opaque: fonts load only with CORS, and scripts are loaded with it so their errors are reported in full.
          // Nothing else gets it, so a world can't read files with fetch().
          // A browser without Sec-Fetch-Dest (Safari before 16.4) sends none: then a script or font is known by its name.
          const dest = req.headers['sec-fetch-dest'];
          if (req.headers.origin === 'null' && (['script', 'font'].includes(dest) || (dest === undefined && /\.(js|woff2?|ttf|otf)$/i.test(rel)))) headers['access-control-allow-origin'] = 'null';
          res.writeHead(200, headers);
          return createReadStream(found.real).on('error', () => res.destroy()).pipe(res);
        }
        if (path === '/worlds/test') { // a world's test page: no token and no real data (web/worlds/test/)
          let html;
          try { html = readFileSync(join(dirname(webFile), 'worlds', 'test', 'index.html'), 'utf8'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          // connect-src 'none': it fetches nothing (no list of worlds, made-up answers), so /api/state, which needs no token, is out of its reach by policy.
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
          return res.end(html);
        }
        if ((m = path.match(/^\/worlds\/test\/([a-z]+)\.js$/))) { // its scripts, by plain name only
          let code;
          try { code = readFileSync(join(dirname(webFile), 'worlds', 'test', `${m[1]}.js`), 'utf8'); } catch { return send(res, 404, 'text/plain', 'not found'); }
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
        if ((m = path.match(/^\/api\/agent\/([^/]+)\/(conversation|subagent|prompts|notes|held)$/))) {
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          let id = '';
          try { id = decodeURIComponent(m[1]); } catch { /* not an id */ }
          if (!/^[\w-]+(?::[\w-]+)?$/.test(id)) return sendJson(res, 404, { error: 'unknown agent' });
          if (m[2] === 'subagent') {
            const sub = id.includes(':') ? getSubagent(id) : null;
            return sub ? sendJson(res, 200, sub) : sendJson(res, 404, { error: 'That subagent is not known.' });
          }
          if (m[2] === 'held') { // what you sent it while it worked, waiting for its turn to end
            const got = id.includes(':') ? null : getHeld(id);
            return got ? sendJson(res, 200, got) : sendJson(res, 404, { error: 'That session is not on the dashboard.' });
          }
          if (m[2] === 'notes') { // your notes on it, for later
            const got = id.includes(':') ? null : getNotes(id);
            return got ? sendJson(res, 200, got) : sendJson(res, 404, { error: 'That session is not on the dashboard.' });
          }
          if (m[2] === 'prompts') { // your own messages to it, newest first, for ↑ in its message box
            const got = id.includes(':') ? null : await getPrompts(id);
            return got ? sendJson(res, 200, got) : sendJson(res, 404, { error: 'That session has no transcript to read.' });
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
        if ((m = path.match(/^\/api\/agent\/([\w:-]+)\/named$/))) { // files named in its replies, checked: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          const got = await namedFiles(m[1], url.searchParams.getAll('path'));
          return got.error ? sendJson(res, got.status ?? 404, { error: got.error }) : sendJson(res, 200, got);
        }
        if ((m = path.match(/^\/api\/agent\/([\w:-]+)\/shell-output$/))) { // the end of a background command's output: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          const got = await shellOutput(m[1], clampInt(url.searchParams.get('pid'), 1, 99_999_999, 0));
          return got.error ? sendJson(res, got.status ?? 404, { error: got.error }) : sendJson(res, 200, got);
        }
        if (path === '/api/dirs') { // folders to start a session in, as you type one: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          return sendJson(res, 200, await listDirs(url.searchParams.get('path') ?? '~/'));
        }
        if (path === '/api/worlds') { // the worlds to choose from: token only (your folder's names are yours)
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          return sendJson(res, 200, { worlds: worlds?.list() ?? [], folder: worlds?.userDir ?? null });
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

      const isBodyAction = ['/api/actions/rm', '/api/actions/answer', '/api/actions/permit', '/api/actions/always', '/api/actions/plugin', '/api/actions/reload', '/api/actions/mcp', '/api/actions/rule', '/api/actions/message', '/api/actions/start', '/api/actions/fork', '/api/actions/restore', '/api/actions/note', '/api/actions/held', '/api/actions/helper', '/api/actions/name', '/api/actions/animals', '/api/actions/end', '/api/actions/restart', '/api/actions/setting', '/api/actions/aside', '/api/actions/reveal', '/api/actions/reveal-worlds', '/api/actions/mkdir', '/api/actions/choose-folder', '/api/actions/stop-shell'].includes(path);
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
        if (path === '/api/actions/fork') return sendJson(res, 200, await actions.fork(body));
        if (path === '/api/actions/restore') return sendJson(res, 200, await actions.restore(body));
        if (path === '/api/actions/note') return sendJson(res, 200, await actions.note(body));
        if (path === '/api/actions/held') return sendJson(res, 200, await actions.held(body));
        if (path === '/api/actions/helper') return sendJson(res, 200, await actions.helper(body));
        if (path === '/api/actions/name') return sendJson(res, 200, await actions.name(body));
        if (path === '/api/actions/animals') return sendJson(res, 200, await actions.animals(body));
        if (path === '/api/actions/setting') return sendJson(res, 200, await actions.setting(body));
        if (path === '/api/actions/aside') return sendJson(res, 200, await actions.aside(body));
        if (path === '/api/actions/reveal') return sendJson(res, 200, await actions.reveal(body));
        if (path === '/api/actions/reveal-worlds') return sendJson(res, 200, await actions.revealWorlds());
        if (path === '/api/actions/mkdir') return sendJson(res, 200, await actions.mkdir(body));
        if (path === '/api/actions/stop-shell') return sendJson(res, 200, await actions.stopShell(body));
        if (path === '/api/actions/choose-folder') return sendJson(res, 200, await actions.chooseFolder(body)); // waits while you pick
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
    /** A world's files changed (or '*': the SDK, or the list): the page reloads it, or its list. */
    broadcastWorlds(change) {
      const data = `event: worlds\ndata: ${JSON.stringify(change)}\n\n`;
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
