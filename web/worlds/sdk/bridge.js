// The frame's side of a world: the only way a world reaches the page. The page sends `start`,
// `settings`, `scene` and `select`; this runs the world and passes back the few messages the page
// accepts (docs/worlds.md, "Messages"), every one of which the page checks. It loads before the SDK
// and the world, so it hears their errors. Classic script, no dependencies.
(() => {
  'use strict';

  const send = message => parent.postMessage(message, '*');
  const reported = new Set();
  function report(message, where = '') {
    const key = `${message}@${where}`;
    if (reported.has(key) || reported.size >= 20) return;
    reported.add(key);
    send({ type: 'error', message: String(message).slice(0, 300), where: String(where).slice(0, 120) });
  }
  // Script errors, and scripts that fail to load (capture: those don't bubble).
  addEventListener('error', e => report(e.message || 'A script did not load', e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : e.target?.src?.split('/').pop() ?? ''), true);
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
  function request(kind, args) {
    const id = nextId++;
    send({ type: 'request', id, kind, ...args });
    return new Promise(resolve => waiting.set(id, resolve));
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
    if (e.source !== parent) return;
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
      waiting.get(m.id)({ ok: m.ok === true, status: m.status ?? 0, ...(m.data !== undefined ? { data: m.data } : {}), ...(m.error !== undefined ? { error: m.error } : {}) });
      waiting.delete(m.id);
    }
  });

  const A = (window.Agentville = window.Agentville ?? {});
  /** A world that draws itself: { start({ el, opts, prefs }), scene(scene), select?(id) }. */
  A.raw = handlers => {
    if (world) { report('A world registered twice.', 'world.js'); return; }
    world = handlers;
  };
  /** Sends the page one of the messages it accepts (docs/worlds.md, "Messages"); it checks each one. */
  A.send = send;
  addEventListener('DOMContentLoaded', () => {
    if (world) send({ type: 'loaded' });
    else report('world.js did not register a world (Agentville.world or Agentville.raw).', 'world.js');
  });
})();
