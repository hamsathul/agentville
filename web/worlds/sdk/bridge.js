// The frame's side of a world: the only way a world reaches the page. The page sends `start`,
// `settings`, `scene` and `select`; this runs the world and passes back the few messages the page
// accepts (docs/worlds.md, "Messages"), every one of which the page checks. It loads before the SDK
// and the world, so it hears their errors. Classic script, no dependencies.
(() => {
  'use strict';

  // WebRTC can reach another machine, and no CSP stops it (Chrome ignores a `webrtc` directive). So in
  // this page, before the world's script runs, these are made undefined, not writable, not configurable:
  // the straightforward way is gone, and a world can't put them back. This does NOT fully close WebRTC:
  // a world could reach a fresh realm the bridge never touched (a child browsing context it makes), where
  // these are intact. It is a gap, documented like the connection-hint one (docs/worlds.md, "The gaps").
  // Checked (Chrome 154): of the WebRTC entry points, RTCPeerConnection and webkitRTCPeerConnection are
  // the constructible ones; RTCDataChannel, RTCRtpTransceiver and RTCIceTransport are not constructible
  // (locked anyway, if present, in case that changes).
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCIceTransport']) {
    if (name in window) Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false });
  }

  // The page, captured before the world's script runs: a world can replace window.parent, but not this.
  const toPage = window.parent;
  const send = message => toPage.postMessage(message, '*');
  // The moment this document starts to go away (the world set location, say), the page is told, before
  // any page it goes to can run: the page then stops hearing from this frame. Capture and registered
  // first, so a world's own listener can't get in ahead of it. beforeunload fires as the navigation
  // starts, even when the new page never answers; pagehide when this document is let go.
  let leaving = false;
  const leave = () => { if (!leaving) { leaving = true; send({ type: 'leaving' }); } };
  addEventListener('beforeunload', leave, true);
  addEventListener('pagehide', leave, true);
  const reported = new Set();
  function report(message, where = '') {
    const key = `${message}@${where}`;
    if (reported.has(key) || reported.size >= 20) return;
    reported.add(key);
    send({ type: 'error', message: String(message).slice(0, 300), where: String(where).slice(0, 120) });
  }
  // Script errors, and files that fail to load (capture: those don't bubble).
  addEventListener('error', e => {
    const file = String(e.target?.src ?? e.target?.href ?? '').split('/').pop();
    report(e.message || `A file did not load (${file})`, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : file);
  }, true);
  addEventListener('unhandledrejection', e => report(e.reason?.message ?? String(e.reason)));
  // A link opens through the page, which allows only GitHub's (pull requests, Actions runs); others do nothing.
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    e.preventDefault();
    if (String(a.href).startsWith('https://github.com/')) send({ type: 'openLink', url: String(a.href) });
  }, true);

  let world = null, started = false, live = false, prefs = {}, latest = null, selected = null, nextId = 1, lastDiary = '';
  let settings = { still: false, theme: 'auto', nav: {}, bell: false };
  const waiting = new Map(); // request id → its resolve
  // A world's settings, kept by the page (a frame has no storage). The bell is the page's own.
  const prefsApi = {
    get: name => (name === 'bell' ? (settings.bell ? 'on' : 'off') : prefs[name] ?? null),
    set: (name, value) => {
      if (name === 'bell') return;
      prefs[name] = String(value);
      send({ type: 'store', key: name, value: String(value) });
    },
  };
  // At most four requests go to the page at once (it refuses a fifth); the rest wait their turn, in order,
  // so a notice board of eight sessions reads all eight.
  const IN_FLIGHT_MAX = 4, queued = [];
  function request(kind, args) {
    return new Promise(resolve => { queued.push({ kind, args, resolve }); sendQueued(); });
  }
  function sendQueued() {
    while (waiting.size < IN_FLIGHT_MAX && queued.length) {
      const { kind, args, resolve } = queued.shift(), id = nextId++;
      waiting.set(id, resolve);
      send({ type: 'request', id, kind, ...args });
    }
  }
  // What an engine world is handed: every call becomes a message the page checks.
  const opts = {
    get still() { return settings.still; },
    navState: () => settings.nav,
    request,
    onPickAgent: (agentId, o) => send({ type: 'pick', agentId, ...(o?.from === 'say' ? { from: 'say' } : {}) }),
    onOpenDoc: (agentId, path) => send({ type: 'openDoc', agentId, path }),
    onShowRepos: () => send({ type: 'showRepos' }),
    onStartSession: () => send({ type: 'startSession' }),
    onNav: what => send({ type: 'nav', what }),
    onBell: on => { settings.bell = on; send({ type: 'bell', on }); },
    onMotion: still => { settings.still = still; send({ type: 'motion', still }); },
    onDiary: entries => {
      const list = entries.slice(0, 20).map(l => ({ at: l.at, state: l.state, who: String(l.who ?? ''), text: String(l.text ?? '') }));
      const key = JSON.stringify(list);
      if (key !== lastDiary) { lastDiary = key; send({ type: 'diary', entries: list }); }
    },
  };
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }
  function run(fn, where) {
    try { fn(); } catch (err) { report(err?.message ?? String(err), where); }
  }
  /**
   * Once the world has drawn a frame after its start (two animation frames on; half a second in a hidden
   * tab, which draws none), it gets the newest scene and the selection, then every one as it comes. So a
   * world draws once before its first scene, as the farm always did on the page: Chrome keeps where a
   * layer first lay to the fraction of a pixel, and this keeps the farm's every pixel as it was.
   */
  function goLive() {
    let done = false;
    const go = () => {
      if (done) return;
      done = live = true;
      if (latest) run(() => world.scene(latest), 'scene');
      if (selected !== null) run(() => world.select?.(selected), 'select');
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 500);
  }
  addEventListener('message', e => {
    if (e.source !== toPage) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'start' && !started && world) {
      prefs = m.prefs && typeof m.prefs === 'object' ? { ...m.prefs } : {};
      settings = { ...settings, ...m.settings };
      applyTheme(settings.theme);
      started = true;
      run(() => world.start({ el: document.getElementById('farm'), opts, prefs: prefsApi }), 'start');
      send({ type: 'ready' });
      goLive();
    } else if (m.type === 'settings') {
      settings = { ...settings, ...m.settings };
      applyTheme(settings.theme);
    } else if (m.type === 'scene') {
      latest = m.scene;
      if (live) run(() => world.scene(m.scene), 'scene');
    } else if (m.type === 'select') {
      selected = m.id ?? null;
      if (live) run(() => world.select?.(selected), 'select');
    } else if (m.type === 'reply' && waiting.has(m.id)) {
      const resolve = waiting.get(m.id);
      waiting.delete(m.id);
      sendQueued(); // the next one in line
      resolve({ ok: m.ok === true, status: m.status ?? 0, ...(m.data !== undefined ? { data: m.data } : {}), ...(m.error !== undefined ? { error: m.error } : {}) });
    }
  });

  const A = (window.Agentville = window.Agentville ?? {});
  let raw = false; // the world draws itself: the page then gives it a way back (World ▾, List) in a corner
  /**
   * A world that draws itself: { start({ el, opts, prefs }), scene(scene), select?(id) }. The engine
   * registers through here too, with { engine: true }: its buttons have List and World already.
   */
  A.raw = (handlers, how) => {
    if (world) { report('A world registered twice.', 'world.js'); return; }
    world = handlers;
    raw = how?.engine !== true;
  };
  /** Sends the page one of the messages it accepts (docs/worlds.md, "Messages"); it checks each one. */
  A.send = send;
  addEventListener('DOMContentLoaded', () => {
    if (world) send({ type: 'loaded', ...(raw ? { raw: true } : {}) });
    else report('world.js did not register a world (Agentville.world or Agentville.raw).', 'world.js');
  });
})();
