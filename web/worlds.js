// Worlds, the page's side. The farm (and, later, any world) runs in a sandboxed frame with no token:
// this file builds the scene from each snapshot (web/scene.js), carries messages both ways, checks every
// one that comes back and drops the rest, keeps each world's settings, and answers the frame's two file
// requests. To app.js it is window.TrackerFarm, as the farm always was. Classic script, no dependencies.
(() => {
  'use strict';

  const NAV = new Set(['list', 'session', 'setup', 'side', 'theme', 'worlds']);
  const STATES = new Set(['waiting', 'working', 'turn', 'idle', 'stale']);
  const PREF_NAME = /^[a-z][a-z0-9-]{0,31}$/;
  const PREF_MAX = 16_384, DIARY_MAX = 20, IN_FLIGHT_MAX = 4, ID_MAX = 200, PATH_MAX = 4096;
  // A world keeps at most 64 settings, 64 KB in all (names and values, what is saved already included):
  // it can't fill the page's storage, after which the page's own settings would stop saving.
  const STORE_KEYS_MAX = 64, STORE_TOTAL_MAX = 65_536;
  // What a world can make the page do, each at most once a quarter second: the first at once, the rest
  // dropped (a flood of setup dialogs, chimes or file reads costs a click's worth). The bell and motion
  // are settings, so the newest of those waits its turn instead, and the page and the world agree.
  const ACTIONS = new Set(['pick', 'openDoc', 'openLink', 'startSession', 'showRepos', 'nav', 'bell', 'motion']);
  const NEWEST_WINS = new Set(['bell', 'motion']);
  const GAP_MS = 250;
  const DROPPED_MAX = 20, ERRORS_MAX = 50; // kinds of dropped message, and world errors, written to the console
  // The farm's settings from before worlds: copied once into its own (tracker-world:farm:…).
  const OLD_FARM_PREFS = { beds: 'tracker-farm-beds', zoom: 'tracker-farm-zoom', bubbles: 'tracker-farm-bubbles', sky: 'tracker-farm-sky', resting: 'tracker-farm-resting', panel: 'tracker-farm-panel' };
  const browserStore = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* a private window: this page only */ } },
    keys: () => { try { return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)); } catch { return []; } },
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = ms => {
    const m = Math.max(0, (Date.now() - ms) / 60_000);
    return m < 1 ? 'now' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  const prefKey = (world, name) => `tracker-world:${world}:${name}`;
  const short = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  /** Inside a folder (or the folder itself), with no `..` on the way. */
  const inside = (path, dir) => short(dir, PATH_MAX) && !path.split('/').includes('..') && (path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`));

  /** A world's saved settings, { name: value }. The farm's first time: its old keys, copied once. */
  function loadPrefs(world, store = browserStore) {
    const prefix = prefKey(world, '');
    if (world === 'farm' && !store.keys().some(k => k.startsWith(prefix))) {
      for (const [name, old] of Object.entries(OLD_FARM_PREFS)) {
        const v = store.get(old);
        if (v != null) store.set(prefKey(world, name), v);
      }
      store.set(prefKey(world, 'migrated'), '1'); // copied once, even when there was nothing to copy
    }
    const out = {};
    for (const k of store.keys()) {
      if (!k.startsWith(prefix)) continue;
      const name = k.slice(prefix.length);
      if (PREF_NAME.test(name) && name !== 'migrated') out[name] = store.get(k);
    }
    return out;
  }

  /**
   * A message from the world's frame, checked against the scene the page last sent it: what to do, as
   * { kind, … }, or null to drop it. A request that can't be done is still answered ('refuse'), so the
   * world isn't left waiting. ctx: { scene, private, sentPaths: Map(agent id → Set of paths its replies
   * named), inFlight }.
   */
  function checkMessage(m, ctx) {
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
    const agents = ctx.scene?.agents ?? [], repos = ctx.scene?.repos ?? [];
    const agent = id => (short(id, ID_MAX) ? agents.find(a => a.id === id) ?? null : null);
    switch (m.type) {
      case 'loaded': case 'ready': case 'startSession': case 'showRepos': return { kind: m.type };
      case 'error': return { kind: 'error', message: String(m.message ?? '').slice(0, 300), where: String(m.where ?? '').slice(0, 120) };
      case 'pick': return agent(m.agentId) ? { kind: 'pick', agentId: m.agentId, from: m.from === 'say' ? 'say' : null } : null;
      case 'openDoc': {
        const a = agent(m.agentId);
        if (!a || ctx.private || !short(m.path, PATH_MAX)) return null;
        const ok = ctx.sentPaths.get(m.agentId)?.has(m.path) || inside(m.path, a.cwd) || repos.some(r => inside(m.path, r.key)); // a reply's path, for the agent it was about only
        return ok ? { kind: 'openDoc', agentId: m.agentId, path: m.path } : null;
      }
      case 'openLink': return short(m.url, 2048) && m.url.startsWith('https://github.com/') ? { kind: 'openLink', url: m.url } : null;
      case 'nav': return NAV.has(m.what) ? { kind: 'nav', what: m.what } : null;
      case 'bell': return typeof m.on === 'boolean' ? { kind: 'bell', on: m.on } : null;
      case 'motion': return typeof m.still === 'boolean' ? { kind: 'motion', still: m.still } : null;
      case 'store':
        return typeof m.key === 'string' && PREF_NAME.test(m.key) && m.key !== 'migrated' && typeof m.value === 'string' && m.value.length <= PREF_MAX
          ? { kind: 'store', key: m.key, value: m.value } : null;
      case 'diary': {
        if (!Array.isArray(m.entries) || m.entries.length > DIARY_MAX) return null;
        const entries = m.entries.map(l => (l && typeof l === 'object' && STATES.has(l.state) && Number.isFinite(l.at)
          ? { at: l.at, state: l.state, who: String(l.who ?? '').slice(0, 80), text: String(l.text ?? '').slice(0, 300) } : null));
        return entries.every(Boolean) ? { kind: 'diary', entries } : null;
      }
      case 'request': {
        if (!Number.isInteger(m.id)) return null;
        const refuse = error => ({ kind: 'refuse', id: m.id, error });
        if (ctx.private) return refuse("This world can't see files: switch on “Can see what agents say” for it in the list of worlds.");
        if (ctx.inFlight >= IN_FLIGHT_MAX) return refuse('Too many requests at once.');
        if (m.kind === 'agentFiles' && agent(m.agentId)) return { kind: 'request', id: m.id, what: 'agentFiles', agentId: m.agentId };
        if (m.kind === 'repoTouched' && repos.some(r => r.key === m.repo)) return { kind: 'request', id: m.id, what: 'repoTouched', repo: m.repo };
        return refuse('That is not on the dashboard.');
      }
      default: return null;
    }
  }

  /** The diary in the page's sidebar: newest first, as text (a world never writes the page's HTML). */
  function renderDiary(el, entries) {
    if (!el) return;
    el.innerHTML = entries.map(l => `<li class="st-${l.state}"><i></i><span>${l.who ? `<b>${esc(l.who)}</b> ` : ''}${esc(l.text)}</span><time>${ago(l.at)}</time></li>`).join('') || '<li class="faint">Quiet so far.</li>';
  }

  /** One of the two things a world may ask for, fetched with the token. */
  async function fetchFor(token, act) {
    const url = act.what === 'agentFiles' ? `/api/agent/${encodeURIComponent(act.agentId)}/files` : `/api/repo/touched?path=${encodeURIComponent(act.repo)}`;
    try {
      const r = await fetch(url, { headers: { 'x-tracker-token': token } });
      const body = await r.json();
      return r.ok ? { ok: true, status: r.status, data: body } : { ok: false, status: r.status, error: body?.error }; // no words of its own: the world says it (status 0 = the request itself failed)
    } catch (err) {
      return { ok: false, status: 0, error: String(err?.message ?? err) };
    }
  }

  let host = null, frame = null, opts = {}, world = 'farm', scene = null, selectedId = null, loaded = false;
  let diary = [], timer = 0, lastSettings = '', inFlight = 0, generation = 0;
  let heardLoaded = false; // the frame's `loaded`, heard since it last loaded: once per load of the frame
  let diaryAt = -Infinity, diaryTimer = 0; // when the diary was last drawn from the world's entries; the next drawing
  let savedTotal = 0; // the world's saved settings, in characters (names and values)
  const sentPaths = new Map(); // agent id → the paths its replies named, which may then be opened for it
  const saved = new Map(); // the world's saved settings: name → value's length
  const actedAt = new Map(), waitingAct = new Map(); // action → when it last went through; a bell or motion waiting its turn
  const dropped = new Set(), errorsSeen = new Set();
  let storeRefused = false;
  const settingsNow = () => {
    const nav = opts.navState?.() ?? {};
    return { still: Boolean(opts.still), theme: nav.theme ?? 'auto', nav, bell: browserStore.get('tracker-bell') === 'on' };
  };
  const post = message => frame?.contentWindow?.postMessage(message, '*');
  function pushSettings() {
    const s = settingsNow(), key = JSON.stringify(s);
    if (key === lastSettings) return;
    lastSettings = key;
    if (loaded) post({ type: 'settings', settings: s });
  }
  /** What the world has saved already (names and values), for the caps on `store`. */
  function measureSaved() {
    const prefix = prefKey(world, '');
    saved.clear();
    savedTotal = 0;
    for (const k of browserStore.keys()) {
      if (!k?.startsWith(prefix) || k === prefKey(world, 'migrated')) continue;
      const name = k.slice(prefix.length), length = String(browserStore.get(k) ?? '').length;
      saved.set(name, length);
      savedTotal += name.length + length;
    }
  }
  /** Whether an action goes through now: one of each a quarter second (a bell or motion: the newest, when its turn comes). */
  function paced(act) {
    const now = Date.now(), wait = (actedAt.get(act.kind) ?? -Infinity) + GAP_MS - now;
    if (wait <= 0 && !waitingAct.has(act.kind)) { actedAt.set(act.kind, now); return true; }
    if (NEWEST_WINS.has(act.kind)) {
      const mine = generation, held = waitingAct.get(act.kind);
      waitingAct.set(act.kind, { act, timer: held?.timer ?? setTimeout(() => {
        const next = waitingAct.get(act.kind);
        waitingAct.delete(act.kind);
        if (mine !== generation || !next) return; // the frame was replaced meanwhile
        actedAt.set(act.kind, Date.now());
        handle(next.act);
      }, Math.max(0, wait)) });
    }
    return false;
  }
  /** The world's diary in the page's sidebar, drawn at most once a quarter second (the newest entries). */
  function showDiary(entries) {
    diary = entries;
    const wait = diaryAt + GAP_MS - Date.now();
    if (wait <= 0) { diaryAt = Date.now(); renderDiary(opts.diary, diary); return; }
    diaryTimer ||= setTimeout(() => { diaryTimer = 0; diaryAt = Date.now(); renderDiary(opts.diary, diary); }, wait);
  }
  function onMessage(e) {
    if (!frame || e.source !== frame.contentWindow) return;
    const act = checkMessage(e.data, { scene, private: false, sentPaths, inFlight });
    if (!act) {
      const type = String(e.data?.type ?? typeof e.data).slice(0, 40);
      if (!dropped.has(type) && dropped.size < DROPPED_MAX) { dropped.add(type); console.warn(`The ${world} world sent a message the page does not accept (${type}); it was dropped.`); }
      return;
    }
    if (act.kind === 'loaded') {
      if (heardLoaded) return; // once per load of the frame: the world can't make the page start it again and again
      heardLoaded = true;
    }
    if (ACTIONS.has(act.kind) && !paced(act)) return;
    handle(act);
  }
  function handle(act) {
    switch (act.kind) {
      case 'loaded':
        loaded = true;
        generation++; // replies to the frame's last load are not posted to this one
        inFlight = 0;
        sentPaths.clear();
        lastSettings = JSON.stringify(settingsNow());
        post({ type: 'start', world, prefs: loadPrefs(world), settings: settingsNow() });
        measureSaved();
        if (scene) post({ type: 'scene', scene });
        post({ type: 'select', id: selectedId });
        break;
      case 'ready': break;
      case 'error': {
        const key = `${act.message}@${act.where}`;
        if (errorsSeen.has(key) || errorsSeen.size >= ERRORS_MAX) break; // each once
        errorsSeen.add(key);
        console.warn(`The ${world} world: ${act.message}${act.where ? ` (${act.where})` : ''}`);
        break;
      }
      case 'pick': opts.onPickAgent?.(act.agentId, act.from ? { from: act.from } : undefined); break;
      case 'openDoc': opts.onOpenDoc?.(act.agentId, act.path); break;
      case 'openLink': window.open(act.url, '_blank', 'noopener'); break;
      case 'startSession': opts.onStartSession?.(); break;
      case 'showRepos': opts.onShowRepos?.(); break;
      case 'nav': opts.onNav?.(act.what); pushSettings(); break;
      case 'bell': browserStore.set('tracker-bell', act.on ? 'on' : 'off'); opts.onBell?.(act.on); pushSettings(); break;
      case 'motion': opts.still = act.still; opts.onMotion?.(act.still); pushSettings(); break;
      case 'store': {
        const before = saved.get(act.key), total = savedTotal - (before === undefined ? 0 : act.key.length + before) + act.key.length + act.value.length;
        if ((before === undefined && saved.size >= STORE_KEYS_MAX) || total > STORE_TOTAL_MAX) {
          if (!storeRefused) { storeRefused = true; console.warn(`The ${world} world keeps more settings than the page allows (${STORE_KEYS_MAX}, ${STORE_TOTAL_MAX / 1024} KB in all); the rest are not saved.`); }
          break;
        }
        browserStore.set(prefKey(world, act.key), act.value);
        saved.set(act.key, act.value.length);
        savedTotal = total;
        break;
      }
      case 'diary': showDiary(act.entries); break;
      case 'refuse': post({ type: 'reply', id: act.id, ok: false, status: 403, error: act.error }); break;
      case 'request': {
        const mine = generation;
        inFlight++;
        void fetchFor(opts.token, act).then(r => {
          if (mine !== generation) return; // the world was replaced, or its frame loaded again, meanwhile
          inFlight--;
          if (r.ok && act.what === 'agentFiles') {
            const paths = sentPaths.get(act.agentId) ?? new Set();
            for (const f of r.data?.memory ?? []) if (typeof f?.path === 'string') paths.add(f.path);
            sentPaths.set(act.agentId, paths);
          }
          post({ type: 'reply', id: act.id, ...r });
        });
        break;
      }
    }
  }

  /**
   * Shows the farm in el. The same host again (back from the list view) keeps the frame it has, with
   * everything the farm remembers (its diary, where everyone stands, Follow, closed bubbles): only what
   * it is handed is refreshed. app.js hides #farm meanwhile; the frame stays loaded.
   */
  function mount(el, options = {}) {
    const again = Boolean(frame) && host === el && world === 'farm';
    const still = options.still ?? (again ? opts.still : Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
    if (again) {
      opts = { ...options, still };
      pushSettings();
      renderDiary(opts.diary, diary);
      return;
    }
    unmount();
    host = el;
    opts = { ...options, still };
    world = 'farm';
    heardLoaded = false;
    frame = document.createElement('iframe');
    frame.className = 'world-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.title = 'The farm';
    frame.src = `/world/${world}/`;
    frame.addEventListener('load', () => { heardLoaded = false; }); // a new load of the frame says `loaded` again
    host.replaceChildren(frame);
    measureSaved();
    addEventListener('message', onMessage);
    // the page's own settings (theme, sidebar, live) reach the frame's buttons; the diary's times stay fresh
    timer = setInterval(() => { pushSettings(); if (!document.hidden) renderDiary(opts.diary, diary); }, 1000);
  }
  function update(snap) {
    scene = window.AgentvilleScene.toScene(snap);
    if (loaded) post({ type: 'scene', scene });
  }
  function select(id) {
    selectedId = id ?? null;
    if (loaded) post({ type: 'select', id: selectedId });
  }
  /** Takes the frame down: its replies, waiting actions and diary drawing go with it. */
  function unmount() {
    removeEventListener('message', onMessage);
    clearInterval(timer);
    clearTimeout(diaryTimer);
    diaryTimer = 0;
    for (const { timer: t } of waitingAct.values()) clearTimeout(t);
    waitingAct.clear();
    host?.replaceChildren();
    host = frame = null;
    loaded = false;
    heardLoaded = false;
    inFlight = 0;
    sentPaths.clear();
    generation++;
  }

  window.TrackerFarm = { mount, update, select, unmount, colorOf: id => window.AgentvilleScene.colorOf(id), toScene: snap => window.AgentvilleScene.toScene(snap) };
  window.AgentvilleWorlds = { checkMessage, loadPrefs, renderDiary, prefKey };
})();
