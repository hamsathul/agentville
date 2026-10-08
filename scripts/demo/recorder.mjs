// The demo videos' camera: headless Chrome, whose screencast frames become the video, with a cursor,
// captions and title cards drawn over the page; and ffmpeg, which makes the MP4s.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const log = (...a) => console.log('·', ...a);
export const CHROME = process.env.CHROME ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => existsSync(p));

/**
 * Starts Chrome, headless, with its profile and frames in `temp`. Its screencast frames land in
 * `shot` as [file, timestamp] once `connect` has run; `close` stops it.
 */
export function launchBrowser(temp) {
  const profile = join(temp, 'chrome');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  const frames = join(temp, 'frames');
  mkdirSync(frames);
  const pending = new Map();
  let ws = null, id = 0;
  const b = {
    shot: [], // [file, timestamp]
    chooserFiles: [], // what a file chooser on the page picks
    send: (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); }),
    js: async expr => (await b.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value,
    until: async (expr, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(120)) if (await b.js(expr)) return true; return false; },
    /** Connects to the page, sized `width` × `height` at twice the pixels. */
    async connect(width, height) {
      let port;
      for (let i = 0; i < 80 && !port; i++) { try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(250); } }
      ws = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page').webSocketDebuggerUrl);
      await new Promise(r => ws.addEventListener('open', r, { once: true }));
      ws.addEventListener('message', ev => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Page.screencastFrame') {
          const f = join(frames, `${String(b.shot.length).padStart(6, '0')}.jpg`);
          writeFileSync(f, Buffer.from(m.params.data, 'base64'));
          b.shot.push([f, m.params.metadata.timestamp]);
          void b.send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
        }
        if (m.method === 'Page.fileChooserOpened') void b.send('DOM.setFileInputFiles', { files: b.chooserFiles, backendNodeId: m.params.backendNodeId });
        if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      });
      await b.send('Page.enable');
      await b.send('Runtime.enable');
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      await b.send('Page.setInterceptFileChooserDialog', { enabled: true });
    },
    close() {
      try { ws?.close(); } catch { /* gone */ }
      chrome.kill();
    },
  };
  return b;
}

/**
 * Puts the cursor, the captions and the title cards on the page, and returns the tour's moves:
 * the cursor moving, pointing and clicking as a person would, typing, and the captions.
 */
export async function stage(b, width, height) {
  // The cursor, the captions and the title cards: popovers, so they stay above any dialog.
  await b.js(`(() => {
    const st = document.createElement('style');
    st.textContent = \`
      .demo-pop { position: fixed; inset: auto; margin: 0; border: 0; padding: 0; background: none; overflow: visible; }
      #demo-cursor { left: 0; top: 0; width: 30px; height: 30px; transform: translate(${width / 2}px, ${height / 2}px); pointer-events: none; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
      #demo-caption { left: 50%; bottom: 58px; transform: translate(-50%, 12px); opacity: 0; transition: opacity .35s, transform .35s; pointer-events: none; display: grid; gap: 4px; justify-items: center; max-width: 900px; padding: 14px 26px 15px; border-radius: 14px; background: rgba(16, 22, 13, .92); border: 1px solid rgba(255, 232, 163, .22); box-shadow: 0 10px 30px rgba(0,0,0,.45); text-align: center; color: #f4ecd8; font: 600 25px/1.25 system-ui, -apple-system, sans-serif; }
      #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
      #demo-caption.top { bottom: auto; top: 92px; }
      #demo-caption span { font: 400 17px/1.4 system-ui, -apple-system, sans-serif; color: #cfd9c4; }
      #demo-card { left: 0; top: 0; width: 100vw; height: 100vh; display: grid; place-content: center; justify-items: center; gap: 18px; background: radial-gradient(circle at 50% 40%, #2f6b2f, #142313 70%); color: #f4ecd8; font: 700 64px/1 system-ui, -apple-system, sans-serif; opacity: 0; transition: opacity .6s; pointer-events: none; }
      #demo-card.on { opacity: 1; }
      #demo-card p { margin: 0; font: 400 24px/1.4 system-ui, sans-serif; color: #d6e3c8; max-width: 760px; text-align: center; }
      #demo-card small { font: 500 18px/1 ui-monospace, Menlo, monospace; color: #ffe8a3; }
      .demo-ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #ffd43b; pointer-events: none; z-index: 2147483647; animation: demo-ripple .55s ease-out forwards; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }\`;
    document.head.appendChild(st);
    const pop = (id, html) => { const el = document.createElement('div'); el.id = id; el.className = 'demo-pop'; el.popover = 'manual'; el.innerHTML = html; document.body.appendChild(el); el.showPopover(); return el; };
    const card = pop('demo-card', '');
    const cap = pop('demo-caption', '<b></b><span></span>');
    const cur = pop('demo-cursor', '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2 L4 20 L9 15.5 L12.5 22.5 L15.5 21 L12 14.2 L18.5 14 Z" fill="#ffffff" stroke="#1b1420" stroke-width="1.6" stroke-linejoin="round"/></svg>');
    window.__demo = {
      move(x, y, ms) { cur.style.transition = 'transform ' + ms + 'ms cubic-bezier(.35,.75,.25,1)'; cur.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)'; },
      ripple(x, y) { const r = document.createElement('i'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); },
      caption(title, sub) { clearTimeout(this.swap); if (!title) { cap.classList.remove('on'); return; } cap.querySelector('b').textContent = title; cap.querySelector('span').textContent = sub || ''; cap.classList.add('on'); },
      // The caption keeps out of the way: at the top while the cursor works low on the screen, at the bottom while it works high.
      avoid(y) {
        const top = y > innerHeight * 0.62 ? true : y < innerHeight * 0.4 ? false : null;
        if (top === null || top === cap.classList.contains('top')) return;
        if (!cap.classList.contains('on')) { cap.classList.toggle('top', top); return; }
        cap.classList.remove('on');
        clearTimeout(this.swap);
        this.swap = setTimeout(() => { cap.classList.toggle('top', top); cap.classList.add('on'); }, 220);
      },
      card(html) { if (html) card.innerHTML = html; card.classList.toggle('on', Boolean(html)); cur.style.opacity = html ? '0' : '1'; },
      raise() { for (const el of [card, cap, cur]) { el.hidePopover(); el.showPopover(); } },
    };
  })()`);

  const ui = { cursor: [width / 2, height / 2] };
  ui.moveTo = async ([x, y], ms = 650) => {
    await b.js(`window.__demo.move(${x}, ${y}, ${ms}); window.__demo.avoid(${y})`);
    const [x0, y0] = ui.cursor, steps = 8;
    for (let i = 1; i <= steps; i++) { await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x - x0) * i) / steps, y: y0 + ((y - y0) * i) / steps }); await sleep(ms / steps); }
    ui.cursor = [x, y];
    await sleep(80);
  };
  ui.where = async expr => b.js(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return r.width ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null; })()`);
  ui.q = sel => `document.querySelector(${JSON.stringify(sel)})`;
  ui.byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.includes(${JSON.stringify(text)}))`;
  ui.point = async (expr, ms) => { const p = await ui.where(expr); if (p) await ui.moveTo(p, ms); else log('not found:', expr); return p; };
  ui.click = async (expr, ms) => {
    let p = await ui.point(expr, ms);
    if (!p) return false;
    const now = await ui.where(expr); // a pane may have re-rendered while the cursor moved: aim again
    if (now && Math.hypot(now[0] - p[0], now[1] - p[1]) > 3) { p = now; await ui.moveTo(p, 180); }
    await b.js(`window.__demo.ripple(${p[0]}, ${p[1]})`);
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await sleep(250);
    return true;
  };
  ui.type = async (text, perChar = 38) => { for (const ch of text) { await b.send('Input.insertText', { text: ch }); await sleep(perChar); } };
  ui.enter = async () => { for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) }); };
  ui.say = (title, sub) => b.js(`window.__demo.caption(${JSON.stringify(title)}, ${JSON.stringify(sub ?? '')})`);
  ui.raise = () => b.js('window.__demo.raise()');
  // A screen point as something to point at.
  ui.spot = p => p && `({ getBoundingClientRect: () => ({ left: ${p[0]}, top: ${p[1]}, width: 2, height: 2 }), scrollIntoView() {} })`;
  return ui;
}

/**
 * Makes the videos from the frames: `out` itself; a copy under 10 MB, GitHub's limit for a video
 * (out-small.mp4, 1280 wide at 15 frames a second, two passes at the bit rate that fills 9.5 MB);
 * and, when there are chapter marks ([number, title, the first frame after its card was asked
 * for]), a video for each chapter in out-chapters/. Returns where the copy and the chapters went.
 */
export function makeVideos({ shot, marks = [], out, temp }) {
  /** The video of the frames shown from `from` to `to` (screencast seconds), each for as long as it stayed. */
  function encode(file, from, to, fades = '') {
    const list = [];
    for (let i = 0; i < shot.length; i++) {
      const [frame, t] = shot[i], next = shot[i + 1]?.[1] ?? t + 0.5, a = Math.max(t, from), b = Math.min(next, to);
      if (b > a) list.push(`file '${frame}'`, `duration ${Math.max(0.001, b - a).toFixed(4)}`);
    }
    list.push(list.at(-2)); // the concat list ends with its last frame again
    writeFileSync(join(temp, 'frames.txt'), `${list.join('\n')}\n`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(temp, 'frames.txt'), '-vf', `fps=30,scale=1920:-2:flags=lanczos${fades},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-movflags', '+faststart', file], { stdio: 'inherit' });
  }
  const start = shot[0][1], end = shot.at(-1)[1] + 0.5;
  log(`${shot.length} frames over ${(end - start - 0.5).toFixed(1)} s; encoding…`);
  encode(out, start, end);
  const small = out.replace(/\.mp4$/i, '') + '-small.mp4', kbps = Math.floor((9.5e6 * 8) / (end - start) / 1000) - 2;
  for (const pass of [1, 2]) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-vf', 'fps=15,scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-pass', String(pass), '-passlogfile', join(temp, 'small'), '-an', ...(pass === 1 ? ['-f', 'mp4', '/dev/null'] : ['-movflags', '+faststart', small])], { stdio: 'inherit' });
  }
  if (!marks.length) return { small, chapters: null };
  // A video for each chapter: from its title card, once faded in, to the next one's. What comes before the
  // first card is at the start of the first, and what comes after the last at the end of the last.
  const chapters = out.replace(/\.mp4$/i, '') + '-chapters';
  rmSync(chapters, { recursive: true, force: true });
  mkdirSync(chapters, { recursive: true });
  const cardAt = i => shot[Math.min(marks[i][2], shot.length - 1)][1];
  for (let i = 0; i < marks.length; i++) {
    const [n, title] = marks[i], from = i === 0 ? start : cardAt(i) + 0.6, to = i + 1 < marks.length ? cardAt(i + 1) : end;
    const name = `${String(n).padStart(2, '0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.mp4`;
    log(`chapter ${n}, ${(to - from).toFixed(0)} s: ${name}`);
    encode(join(chapters, name), from, to, `,fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, to - from - 0.5).toFixed(2)}:d=0.5`);
  }
  return { small, chapters };
}
