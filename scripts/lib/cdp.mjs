// A small client for headless Chrome's DevTools protocol, for the scripts that look at the dashboard
// in a real browser: it starts Chrome, attaches to its one page, and runs code in that page or in one
// of its frames, including a sandboxed world's frame that Chrome runs in a process of its own.
// No dependencies.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => existsSync(p));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Starts headless Chrome on about:blank and attaches to its page. `prepare(send, sessionId)` runs for the
 * page, and again for each frame Chrome gives a process of its own, before any of that frame's scripts
 * run (a fixed clock, reduced motion…).
 */
export async function openChrome({ prepare = async () => {} } = {}) {
  if (!CHROME) throw new Error('Chrome not found: set CHROME to its path.');
  const profile = mkdtempSync(join(tmpdir(), 'agentville-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 80 && !port; i++) {
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(250); }
  }
  if (!port) { chrome.kill(); throw new Error('Chrome did not start.'); }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0, page = null;
  const pending = new Map(), errors = [];
  const frames = new Map(); // sessionId → { targetId, url }: frames in a process of their own
  const contexts = new Map(); // frameId → its main world's context id, for frames in the page's process
  // A request to a frame that went away (a world's frame leaves when the view changes) is never answered, and a reader waiting for
  // that answer waits for ever: on a CI runner that was ten minutes of silence in the middle of a run. So a request is answered with
  // an error when its session detaches, and after REPLY_MS at the latest, saying which one it was.
  const REPLY_MS = 20_000;
  const raw = (method, params = {}, sessionId) => new Promise(r => {
    const n = ++id;
    const timer = setTimeout(() => {
      if (!pending.delete(n)) return;
      console.error(`(no reply to ${method} in ${REPLY_MS / 1000} s)`);
      r({ id: n, error: { message: `no reply to ${method}` } });
    }, REPLY_MS);
    pending.set(n, Object.assign(m => { clearTimeout(timer); r(m); }, { sessionId }));
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const send = (method, params = {}, sessionId = page) => raw(method, params, sessionId);
  async function adopt(sessionId) { // the page or a frame: set it up, then let its scripts run
    await raw('Runtime.enable', {}, sessionId);
    await raw('Page.enable', {}, sessionId);
    await prepare(send, sessionId);
    await raw('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    await raw('Runtime.runIfWaitingForDebugger', {}, sessionId);
  }
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    const p = m.params ?? {};
    if (m.method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text);
    if (m.method === 'Runtime.executionContextCreated' && p.context?.auxData?.isDefault) contexts.set(p.context.auxData.frameId, p.context.id);
    if (m.method === 'Target.attachedToTarget' && p.targetInfo?.type === 'iframe') {
      frames.set(p.sessionId, { targetId: p.targetInfo.targetId, url: p.targetInfo.url });
      void adopt(p.sessionId);
    }
    if (m.method === 'Target.targetInfoChanged') for (const f of frames.values()) if (f.targetId === p.targetInfo?.targetId) f.url = p.targetInfo.url;
    if (m.method === 'Target.detachedFromTarget') {
      frames.delete(p.sessionId);
      for (const [n, answer] of pending) if (answer.sessionId === p.sessionId) { pending.delete(n); answer({ id: n, error: { message: 'the frame went away' } }); }
    }
  });
  const targets = (await raw('Target.getTargets')).result.targetInfos;
  page = (await raw('Target.attachToTarget', { targetId: targets.find(t => t.type === 'page').targetId, flatten: true })).result.sessionId;
  await adopt(page);
  async function evaluate(expression, sessionId, contextId) {
    const r = await raw('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  }
  /** Runs `expression` in the first frame whose address contains `part`; undefined while there is none. */
  async function inFrame(part, expression) {
    for (const [s, f] of frames) if (f.url.includes(part)) return evaluate(expression, s);
    const all = [], walk = t => { all.push(t.frame); (t.childFrames ?? []).forEach(walk); };
    walk((await send('Page.getFrameTree')).result.frameTree);
    const frame = all.find(f => f.url.includes(part)), contextId = frame && contexts.get(frame.id);
    return contextId ? evaluate(expression, page, contextId) : undefined;
  }
  return {
    send, errors, inFrame,
    js: expression => evaluate(expression, page),
    /** Whether the frame whose address contains `part` runs in a process of its own. */
    ownProcess: part => [...frames.values()].some(f => f.url.includes(part)),
    close: async () => { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); },
  };
}
