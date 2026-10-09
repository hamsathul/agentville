// Worlds, the page's side. The farm (and, later, any world) runs in a sandboxed frame with no token:
// this file builds the scene from each snapshot (web/scene.js), carries messages both ways, checks every
// one that comes back and drops the rest, keeps each world's settings, and answers the frame's two file
// requests. To app.js it is window.TrackerFarm, as the farm always was. The world test page
// (web/worlds/test/) mounts it too: one world, made-up answers, settings in memory. Classic script, no dependencies.
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
    remove: key => { try { localStorage.removeItem(key); } catch { /* this page only */ } },
    keys: () => { try { return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)); } catch { return []; } },
  };
  /** Settings kept in memory only (the test page): the dashboard's own, in this browser, are never read or written. */
  const memoryStore = (initial = {}) => {
    const m = new Map(Object.entries(initial).map(([k, v]) => [k, String(v)]));
    return { get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, String(v)); }, remove: k => { m.delete(k); }, keys: () => [...m.keys()] };
  };
  let store = browserStore; // the dashboard's browser storage; the test page's own in memory
  const tick = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()); // a steady clock: a wall-clock jump can't block actions
  const FETCH_MS = 30_000, STRIP_QUIET_MS = 5000; // a world's file request is cut off then; a closed strip stays closed this long
  const START_MS = 5000; // a world that has not said `ready` by then is replaced by a panel
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = ms => {
    const m = Math.max(0, (Date.now() - ms) / 60_000);
    return m < 1 ? 'now' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  // Text from a world's folder is written by whoever wrote the world: escaped, and without the characters that turn text around.
  const noBidi = s => String(s ?? '').replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
  const words = s => esc(noBidi(s));
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
      case 'loaded': return { kind: 'loaded', raw: m.raw === true }; // raw: the world draws itself, and gets the page's corner control
      case 'ready': case 'leaving': case 'startSession': case 'showRepos': return { kind: m.type };
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
    el.innerHTML = entries.map(l => `<li class="st-${l.state}"><i></i><span>${l.who ? `<b>${esc(noBidi(l.who))}</b> ` : ''}${esc(noBidi(l.text))}</span><time>${ago(l.at)}</time></li>`).join('') || '<li class="faint">Quiet so far.</li>';
  }

  /** One of the two things a world may ask for, fetched with the token. */
  async function fetchFor(token, act) {
    const url = act.what === 'agentFiles' ? `/api/agent/${encodeURIComponent(act.agentId)}/files` : `/api/repo/touched?path=${encodeURIComponent(act.repo)}`;
    try {
      // cut off after 30 s: a fetch that never settles would hold one of the four places for the page's life
      const r = await fetch(url, { headers: { 'x-tracker-token': token }, ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(FETCH_MS) } : {}) });
      const body = await r.json();
      return r.ok ? { ok: true, status: r.status, data: body } : { ok: false, status: r.status, error: body?.error }; // no words of its own: the world says it (status 0 = the request itself failed)
    } catch (err) {
      return { ok: false, status: 0, error: String(err?.message ?? err) };
    }
  }

  // A world from your folder sees no words or paths until you allow it, per browser (a setting no world can reach: its names can't hold ':').
  const CAN_SEE = key => `tracker-world-cansee:${key}`;
  // The test page says, per stop, whether the world is private (opts.private), whatever the switch says.
  const isPrivate = key => opts.private ?? (key.startsWith('u/') && store.get(CAN_SEE(key)) !== 'on');
  const SESSION_PREFS = new Set(['view']);
  const sessionPrefs = new Map(); // world → { name: value }: kept for this page's life only, never in the browser
  let host = null, frame = null, opts = {}, world = 'farm', scene = null, selectedId = null, loaded = false;
  let diary = [], timer = 0, lastSettings = '', inFlight = 0, generation = 0;
  let sent = null; // the scene the world was last given (private, or not)
  let port = null; // the MessageChannel port to this frame: made on `loaded`, one end handed to the bridge in `start`
  let heardLoaded = false; // the frame's `loaded`, heard: once per frame (every load builds a new one)
  let ready = false, loadsLeft = 0, startTimer = 0, lastError = null, strip = null, failed = false;
  let stripHtml = '', stripPending = null, stripAt = -Infinity, stripClosedAt = -Infinity, stripTimer = 0;
  let diaryAt = -Infinity, diaryTimer = 0; // when the diary was last drawn from the world's entries; the next drawing
  let savedTotal = 0; // the world's saved settings, in characters (names and values)
  const sentPaths = new Map(); // agent id → the paths its replies named, which may then be opened for it
  const saved = new Map(); // the world's saved settings: name → value's length
  const actedAt = new Map(), waitingAct = new Map(); // action → when it last went through; a bell or motion waiting its turn
  const dropped = new Set(), errorsSeen = new Set();
  let storeRefused = false;
  let hidden = false; // the world is out of sight (the list view is showing): it can't make the page do anything
  const settingsNow = () => {
    const nav = opts.navState?.() ?? {};
    return { still: Boolean(opts.still), theme: nav.theme ?? 'auto', nav, bell: store.get('tracker-bell') === 'on' };
  };
  // Every message after `start` goes over the port (scene, settings, select, reply). `start` itself is
  // posted to the frame with the port transferred alongside it (see handle('loaded')); nothing else uses
  // the window. A world that navigates its frame away takes the port's realm with it, so the page posts
  // scenes into a dead port and the page they went to hears nothing.
  const post = message => { if (port) port.postMessage(message); };
  /** Lets go of the port to a frame that is going away, so the next frame gets a fresh one. */
  function closePort() { if (port) { try { port.close(); } catch { /* already gone */ } port = null; } }
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
    for (const k of store.keys()) {
      if (!k?.startsWith(prefix) || k === prefKey(world, 'migrated')) continue;
      const name = k.slice(prefix.length), length = String(store.get(k) ?? '').length;
      saved.set(name, length);
      savedTotal += name.length + length;
    }
  }
  /** Whether an action goes through now: one of each a quarter second (a bell or motion: the newest, when its turn comes). */
  function paced(act) {
    const now = tick(), wait = (actedAt.get(act.kind) ?? -Infinity) + GAP_MS - now;
    if (wait <= 0 && !waitingAct.has(act.kind)) { actedAt.set(act.kind, now); return true; }
    if (NEWEST_WINS.has(act.kind)) {
      const mine = generation, held = waitingAct.get(act.kind);
      waitingAct.set(act.kind, { act, timer: held?.timer ?? setTimeout(() => {
        const next = waitingAct.get(act.kind);
        waitingAct.delete(act.kind);
        if (mine !== generation || !next || hidden) return; // the frame was replaced, or put out of sight, meanwhile
        actedAt.set(act.kind, tick());
        handle(next.act);
      }, Math.max(0, wait)) });
    }
    return false;
  }
  /** The world's diary in the page's sidebar, drawn at most once a quarter second (the newest entries). */
  function showDiary(entries) {
    diary = entries;
    const wait = diaryAt + GAP_MS - tick();
    if (wait <= 0) { diaryAt = tick(); renderDiary(opts.diary, diary); return; }
    diaryTimer ||= setTimeout(() => { diaryTimer = 0; diaryAt = tick(); renderDiary(opts.diary, diary); }, wait);
  }
  // A window `message` from the frame: only the handshake up to `loaded`. After that the frame talks only
  // over the port (set up in handle('loaded')); a window message from it — the world's own, or one from a
  // page it navigated to — is ignored.
  function onMessage(e) {
    if (!frame || e.source !== frame.contentWindow || loaded) return;
    receive(e.data);
  }
  // A message from the frame, over the window before `loaded` or the port after it.
  function receive(data) {
    const act = checkMessage(data, { scene: sent, private: isPrivate(world), sentPaths, inFlight });
    if (!act) {
      const type = String(data?.type ?? typeof data).slice(0, 40);
      if (!dropped.has(type) && dropped.size < DROPPED_MAX) { dropped.add(type); console.warn(`The ${world} world sent a message the page does not accept (${type}); it was dropped.`); }
      return;
    }
    if (act.kind === 'loaded') {
      if (heardLoaded) return; // once per load of the frame: the world can't make the page start it again and again
      heardLoaded = true;
    }
    if (ACTIONS.has(act.kind) && (hidden || !paced(act))) return; // out of sight, a world acts on nothing
    handle(act);
  }
  function handle(act) {
    switch (act.kind) {
      case 'loaded': {
        loaded = true;
        generation++; // replies to an earlier frame's requests are not posted to this one
        sentPaths.clear();
        lastSettings = JSON.stringify(settingsNow());
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = ev => receive(ev.data); // a listener on the port: it, not the window, carries the frame's messages from here
        // `start` is the one message sent over the window, to hand the frame the other end of the port.
        frame?.contentWindow?.postMessage({ type: 'start', world, prefs: { ...loadPrefs(world, store), ...sessionPrefs.get(world) }, settings: settingsNow() }, '*', [channel.port2]);
        measureSaved();
        sendScene();
        post({ type: 'select', id: selectedId });
        // The page decides who gets the way back, not the frame: every world of yours (its HUD, if any, is
        // its own doing), and a built-in one only when it draws itself (the farm's buttons are already there).
        if (world.startsWith('u/') || act.raw) showCorner();
        break;
      }
      case 'leaving': fail('left'); break; // its document is going away: stopped before any page it goes to can speak
      case 'ready': {
        const first = !ready; // a world that says `ready` again: the test page hears it once
        ready = true;
        clearTimeout(startTimer);
        if (lastError) showStrip(lastError); // an error it threw while starting
        if (first) opts.onReady?.();
        break;
      }
      case 'error': {
        if (ready) showStrip(act); else lastError ??= act; // before it started: the first error is the cause (the bridge's own "did not register" follows it)
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
      case 'bell': store.set('tracker-bell', act.on ? 'on' : 'off'); opts.onBell?.(act.on); pushSettings(); break;
      case 'motion': opts.still = act.still; opts.onMotion?.(act.still); pushSettings(); break;
      case 'store': {
        if (SESSION_PREFS.has(act.key)) { sessionPrefs.set(world, { ...sessionPrefs.get(world), [act.key]: act.value }); break; } // memory only, outside the caps
        const before = saved.get(act.key), total = savedTotal - (before === undefined ? 0 : act.key.length + before) + act.key.length + act.value.length;
        if ((before === undefined && saved.size >= STORE_KEYS_MAX) || total > STORE_TOTAL_MAX) {
          if (!storeRefused) { storeRefused = true; console.warn(`The ${world} world keeps more settings than the page allows (${STORE_KEYS_MAX}, ${STORE_TOTAL_MAX / 1024} KB in all); the rest are not saved.`); }
          break;
        }
        store.set(prefKey(world, act.key), act.value);
        saved.set(act.key, act.value.length);
        savedTotal = total;
        break;
      }
      case 'diary': showDiary(act.entries); break;
      case 'refuse': post({ type: 'reply', id: act.id, ok: false, status: 403, error: act.error }); break;
      case 'request': {
        const mine = generation;
        inFlight++; // counts every fetch still running, whichever frame asked
        // the test page answers with made-up data (opts.answer); the dashboard fetches it with the token
        void (opts.answer ? Promise.resolve(opts.answer(act)) : fetchFor(opts.token, act)).then(r => {
          inFlight--;
          if (mine !== generation) return; // the world was replaced, or its frame loaded again, meanwhile
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

  // The world you chose, per browser; the farm when that one has gone or has something wrong.
  const CHOICE = 'tracker-world';
  const FARM = { key: 'farm', builtIn: true, name: 'Farm', icon: '🌾', description: '', nouns: { diary: 'Farm diary' }, preview: null, error: null };
  let token = null, worldsInfo = [FARM], folder = null, info = FARM, resolvedOnce = false, worldShown = null;
  /** The worlds there are (the collector's list), and the one to show. */
  async function resolveWorld() {
    if (opts.world) return { builtIn: !opts.world.key.startsWith('u/'), icon: '🧩', description: '', nouns: {}, preview: null, error: null, name: opts.world.key, ...opts.world }; // the test page: this world, no list, no saved choice
    let listed = false;
    try {
      const r = await fetch('/api/worlds', { headers: { 'x-tracker-token': token } });
      const body = r.ok ? await r.json() : null;
      if (Array.isArray(body?.worlds) && body.worlds.length) { worldsInfo = body.worlds; folder = body.folder ?? null; listed = true; }
    } catch { /* the collector is away: the farm */ }
    const saved = store.get(CHOICE);
    const pick = worldsInfo.find(w => w.key === saved && !w.error) ?? worldsInfo.find(w => w.key === 'farm') ?? FARM;
    // Forget the saved choice only at the first resolve (startup: the world was gone or broken while the
    // dashboard was closed), and only when the list really loaded. A later `worlds` event or opening of
    // the list resolves again, but a world that is briefly invalid mid-save must not lose the choice.
    if (!resolvedOnce && listed && saved && pick.key !== saved) store.remove(CHOICE);
    resolvedOnce = true;
    return pick;
  }
  /** The world to show, for the view toggle before the world is ever opened. */
  async function current(o = {}) {
    token = o.token ?? token;
    worldShown = o.onWorld ?? worldShown; // so a pick from the list view tells the toggle before any world was shown
    info = await resolveWorld();
    return info;
  }
  /** Shows a world in place of the one showing (its settings are its own). */
  function choose(key) {
    const w = worldsInfo.find(x => x.key === key && !x.error);
    if (!w) return;
    store.set(CHOICE, key);
    info = w;
    (opts.onWorld ?? worldShown)?.(w);
    if (key === world && frame) return; // the one already showing: its frame, and all it remembers, stay
    if (host) createFrame(w.key);
  }
  function createFrame(key) {
    world = key;
    loaded = false;
    heardLoaded = false;
    generation++;
    closePort();
    sent = null; // nothing is given to the new frame until it says `loaded`
    sentPaths.clear();
    for (const { timer: t } of waitingAct.values()) clearTimeout(t);
    waitingAct.clear();
    if (diary.length) { diary = []; renderDiary(opts.diary, diary); } // the last world's diary goes with it
    dropped.clear(); // the next world's first warnings are said too
    errorsSeen.clear();
    storeRefused = false;
    frame = document.createElement('iframe');
    frame.className = 'world-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.title = info.name;
    frame.src = `/world/${key}/`;
    ready = false; lastError = null; loadsLeft = 1; failed = false;
    resetStrip();
    clearTimeout(startTimer);
    startTimer = setTimeout(() => { if (!ready) fail('start'); }, START_MS);
    frame.addEventListener('load', onFrameLoad);
    host.replaceChildren(frame);
    measureSaved();
  }
  // A frame is built for every load, so it loads once; a second load the page didn't ask for is the world going to another page.
  function onFrameLoad() {
    if (loadsLeft > 0) { loadsLeft--; return; }
    fail('left');
  }
  /** The world is gone: a panel in its place says why, with ways back. */
  function fail(why) {
    clearTimeout(startTimer);
    resetStrip();
    generation++; // its replies and messages are not heard any more
    loaded = false;
    closePort();
    frame = null;
    failed = true; // the panel is showing for this world: saving its files rebuilds it
    const name = words(info.name);
    const what = why === 'left'
      ? `<b>${name} tried to leave the page and was stopped.</b> A world may only draw here; this one loaded another page in its place.`
      : `<b>${name} didn't start${lastError ? `: ${words(lastError.message)}${lastError.where ? ` (${words(lastError.where)})` : ''}` : ': it did not answer.'}</b>`;
    const back = world === 'farm'
      ? '<button type="button" class="act" data-world-tolist>List</button>'
      : '<button type="button" class="act primary" data-world-back>Back to the farm</button>';
    const panel = document.createElement('div');
    panel.className = 'world-panel';
    panel.setAttribute('role', 'alert');
    panel.innerHTML = `<p>${what}</p><p>${back}<button type="button" class="act" data-world-list>Show the list</button>${why === 'start' ? '<button type="button" class="act" data-world-retry>Try again</button>' : ''}</p>`;
    panel.addEventListener('click', e => {
      if (e.target.closest?.('[data-world-back]')) choose('farm');
      else if (e.target.closest?.('[data-world-tolist]')) opts.onNav?.('list');
      else if (e.target.closest?.('[data-world-list]')) void openList();
      else if (e.target.closest?.('[data-world-retry]')) createFrame(world);
    });
    host?.replaceChildren(panel);
  }
  /**
   * A way back, in a corner over the frame, for a world that might draw none of its own (every world of
   * yours, and a built-in one that draws itself). The page's, so no world can cover it, and it goes with
   * the frame (another world, a reload, a panel). Top left, clear of the engine HUD (its buttons are top
   * right), so an engine world of yours shows both and neither covers the other.
   */
  function showCorner() {
    if (!host || !frame) return;
    const corner = document.createElement('div');
    corner.className = 'world-corner';
    corner.innerHTML = '<button type="button" class="act mini" data-corner-worlds title="Choose another world">World ▾</button><button type="button" class="act mini" data-corner-list title="The list of agents">☰ List</button>';
    corner.addEventListener('click', e => {
      if (e.target.closest?.('[data-corner-worlds]')) opts.onNav?.('worlds');
      else if (e.target.closest?.('[data-corner-list]')) opts.onNav?.('list');
    });
    host.append(corner);
  }
  /** An error after the world started: a strip over it (the latest one), which it keeps drawing under. */
  function resetStrip() {
    strip = null; stripHtml = ''; stripPending = null; stripAt = stripClosedAt = -Infinity;
    clearTimeout(stripTimer);
    stripTimer = 0;
  }
  /** Written again only when its text changes, a quarter second apart, and not for a few seconds after ×: a world can't flood the live region. */
  function showStrip(act) {
    if (!host || !frame) return;
    const html = `<span><b>${words(info.name)}:</b> ${words(act.message)}${act.where ? ` (${words(act.where)})` : ''}</span><button type="button" class="x" data-strip-close aria-label="Hide">×</button>`;
    if (html === stripHtml) return;
    stripPending = html;
    const wait = Math.max(stripAt + GAP_MS, stripClosedAt + STRIP_QUIET_MS) - tick();
    if (wait <= 0) drawStrip();
    else stripTimer ||= setTimeout(() => { stripTimer = 0; drawStrip(); }, wait);
  }
  function drawStrip() {
    const html = stripPending;
    stripPending = null;
    if (!host || !frame || html === null || html === stripHtml) return;
    stripHtml = html;
    stripAt = tick();
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'world-strip';
      strip.setAttribute('role', 'status');
      strip.addEventListener('click', e => { if (e.target.closest?.('[data-strip-close]')) { strip?.remove?.(); strip = null; stripClosedAt = tick(); } });
      host.append(strip);
    }
    strip.innerHTML = html;
  }

  /**
   * Shows the chosen world in el. The same host again (back from the list view) keeps the frame it has,
   * with everything the world remembers (its diary, where everyone stands, Follow, closed bubbles): only
   * what it is handed is refreshed. app.js hides #farm meanwhile (hide()); the frame stays loaded.
   */
  function mount(el, options = {}) {
    hidden = false;
    const again = Boolean(frame) && host === el;
    const still = options.still ?? (again ? opts.still : Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
    if (again) {
      opts = { ...options, still };
      pushSettings();
      renderDiary(opts.diary, diary);
      return Promise.resolve();
    }
    unmount();
    host = el;
    opts = { ...options, still };
    token = options.token ?? token;
    // The test page keeps the world's settings in memory, starting from the stop's; the dashboard, in the browser.
    store = options.memory ? memoryStore(Object.fromEntries(Object.entries(options.memory.prefs ?? {}).map(([n, v]) => [prefKey(options.world?.key ?? 'farm', n), v]))) : browserStore;
    addEventListener('message', onMessage);
    // the page's own settings (theme, sidebar, live) reach the frame's buttons; the diary's times stay fresh
    timer = setInterval(() => { pushSettings(); if (!document.hidden) renderDiary(opts.diary, diary); }, 1000);
    const mine = generation;
    return resolveWorld().then(w => {
      if (host !== el || mine !== generation) return; // taken down meanwhile
      info = w;
      opts.onWorld?.(w);
      createFrame(w.key);
    });
  }
  /** Puts the world out of sight (the list view): its frame stays, but it can't act on the page. */
  function hide() { hidden = true; }

  const $ = id => document.getElementById(id);
  let listWired = false;
  // The switch for what a world sees is off while the list has just opened, and until a second without input: a world can open
  // the list (`nav: worlds`) when it likes, so it must not catch a click. A flag, not a clock reading: timers and clocks are coarse.
  const SEE_LOCK_MS = 1000;
  // The box's tooltip: what is at stake (docs/worlds.md, "The gaps").
  const SEE_TIP = 'A world can send what it sees to other sites, so allow this only for a world you trust.';
  let seeLocked = false, seeTimer = 0, seeLockId = 0;
  function lockSee() {
    seeLocked = true;
    clearTimeout(seeTimer);
    const mine = ++seeLockId;
    seeTimer = setTimeout(() => {
      if (mine !== seeLockId) return; // an older opening or an older tap
      seeLocked = false;
      for (const box of $('worlds-list')?.querySelectorAll?.('[data-see]') ?? []) box.disabled = false; // the boxes themselves: focus and clicks aren't lost
    }, SEE_LOCK_MS);
  }
  /** The list of worlds: pick one, see what is wrong with one, open your folder. */
  async function openList() {
    const dlg = $('worlds-dlg');
    if (!dlg) return;
    if (!listWired) {
      dlg.addEventListener('click', onListClick);
      for (const type of ['pointerdown', 'keydown']) dlg.addEventListener(type, () => { if (seeLocked) lockSee(); }); // a second without input
      dlg.addEventListener('change', e => {
        const box = e.target.closest?.('[data-see]');
        if (!box) return;
        if (seeLocked) { box.checked = !box.checked; return; }
        setCanSee(box.dataset.see, box.checked);
      });
      listWired = true;
    }
    await resolveWorld(); // a fresh list: worlds come and go in your folder
    if (!dlg.open) lockSee();
    renderList();
    if (!dlg.open) dlg.showModal();
  }
  function renderList() {
    const list = $('worlds-list');
    if (!list) return;
    list.innerHTML = worldsInfo.map(w => `<li><button type="button" class="world-pick" ${w.key && !w.error ? `data-world="${esc(w.key)}"` : 'disabled'} aria-pressed="${w.key === world}">
        ${typeof w.preview === 'string' && w.preview.startsWith('/world/') ? `<img class="world-preview" src="${esc(w.preview)}" alt="">` : `<span class="world-icon">${words(w.icon)}</span>`}
        <span class="world-text"><span><b>${words(w.name)}</b> <span class="chip">${w.builtIn ? 'Built in' : 'Your folder'}</span></span>${w.description ? `<span class="muted">${words(w.description)}</span>` : ''}${w.error ? `<span class="warnline">${words(w.error)}</span>` : ''}</span>
      </button>${!w.builtIn && w.key ? `<label class="world-see" title="${SEE_TIP}"><input type="checkbox" data-see="${esc(w.key)}"${isPrivate(w.key) ? '' : ' checked'}${seeLocked ? ' disabled' : ''}> Can see what agents say</label>` : ''}</li>`).join('');
    const where = $('worlds-where');
    if (where) where.textContent = folder ? `Your worlds go in ${noBidi(folder)}` : '';
  }
  function onListClick(e) {
    const pick = e.target.closest?.('[data-world]');
    if (pick) { $('worlds-dlg').close(); choose(pick.dataset.world); return; }
    if (e.target.closest?.('[data-worlds-close]')) { $('worlds-dlg').close(); return; }
    if (e.target.closest?.('#worlds-folder')) void revealFolder();
  }
  /** Open the worlds folder: the collector makes it and shows it in Finder; if it can't, the page says why. */
  async function revealFolder() {
    const say = text => (opts.onNotice ? opts.onNotice(text) : console.warn(text));
    try {
      const r = await fetch('/api/actions/reveal-worlds', { method: 'POST', headers: { 'x-tracker-token': token, 'content-type': 'application/json' }, body: '{}' });
      const body = await r.json().catch(() => null);
      if (!r.ok || !body?.ok) say(noBidi(body?.error ?? 'The worlds folder could not be opened.'));
    } catch {
      say('The worlds folder could not be opened: the collector did not answer.');
    }
  }
  function update(snap) {
    scene = window.AgentvilleScene.toScene(snap);
    if (loaded) sendScene();
  }
  /** The newest scene to the world: the whole of it, or (one of your worlds, not allowed) without words and paths. */
  function sendScene() {
    if (!scene) return;
    sent = isPrivate(world) ? window.AgentvilleScene.privateScene(scene) : scene;
    post({ type: 'scene', scene: sent });
  }
  /** Whether one of your worlds may see what agents say; the world starts again with the scene it may now see. */
  function setCanSee(key, on) {
    if (on) store.set(CAN_SEE(key), 'on'); else store.remove(CAN_SEE(key));
    if (host && frame && key === world) createFrame(world); // a world showing its failure panel restarts on Try again, or on a save
    if ($('worlds-dlg')?.open) {
      renderList();
      $('worlds-list')?.querySelector?.(`[data-see="${key}"]`)?.focus?.(); // the keyboard stays where it was
    }
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
    closePort();
    loaded = false;
    heardLoaded = false;
    clearTimeout(startTimer);
    resetStrip();
    failed = false;
    sentPaths.clear();
    generation++;
  }

  /** A world's files changed: reload it if it is the one showing (or the SDK changed); refresh the list if it is open. */
  async function worldsChanged({ key } = {}) {
    await resolveWorld();
    if ($('worlds-dlg')?.open) renderList();
    if (!host || !(frame || failed) || (key !== world && key !== '*')) return; // a panel showing for this world is rebuilt too
    const w = worldsInfo.find(x => x.key === world);
    // Listed with an error now (a save left world.json invalid, say): say what is wrong at once, rather
    // than build a frame that can't start and wait 5 s to say "it did not answer". Saving it fixed rebuilds it.
    if (w?.error) { info = w; lastError = { message: w.error, where: '' }; fail('start'); return; }
    info = w ?? info;
    createFrame(world);
  }

  // The click guard against UI redress, modelled on the can-see lock above. When a world message changes
  // the sidebar's agent, opens the sidebar or raises a dialog, the page's action controls ignore clicks
  // for about a second — long enough that a world can't swap another agent (or a dialog) under a click
  // you meant for the one you were reading. A flag a timer clears, re-armed by input, as the can-see lock
  // is; app.js arms it from the world's callbacks, forwards pointerdown and keydown, and asks it from a
  // capture-phase click listener that stops a held click before any handler sees it. A click whose
  // pointerdown came before the change is ignored too. The page's own clicks (a row, a sidebar tab)
  // never arm it, so they lose nothing.
  const GUARD_MS = 1000;
  let clickGuarded = false, guardTimer = 0, guardLockId = 0, guardChangedAt = -Infinity, guardPointerAt = Infinity; // no press yet counts as never-before-a-change
  function showGuard(on) { const root = document.documentElement; if (root?.dataset) { if (on) root.dataset.guard = 'on'; else delete root.dataset.guard; } } // the quiet disabled styling, no text
  function startGuardTimer() { // the window that a quiet second clears; input restarts it, so holding on keeps it locked
    clearTimeout(guardTimer);
    const mine = ++guardLockId;
    guardTimer = setTimeout(() => { if (mine !== guardLockId) return; clickGuarded = false; guardTimer = 0; showGuard(false); }, GUARD_MS);
  }
  function armClickGuard() { clickGuarded = true; guardChangedAt = tick(); showGuard(true); startGuardTimer(); } // a world raised or swapped UI
  function clickGuardPointerDown() { guardPointerAt = tick(); if (clickGuarded) startGuardTimer(); } // input only restarts the timer, it is not a change
  function clickGuardKeyDown() { if (clickGuarded) startGuardTimer(); }
  /** Whether an action control's click is ignored now: in the window, or begun (pointerdown) before the last world change. */
  function clickGuardBlocks(detail) { return clickGuarded || (detail > 0 && guardPointerAt < guardChangedAt); }

  window.TrackerFarm = { mount, update, select, unmount, hide, current, openList, worldsChanged, armClickGuard, clickGuardPointerDown, clickGuardKeyDown, clickGuardBlocks, colorOf: id => window.AgentvilleScene.colorOf(id), toScene: snap => window.AgentvilleScene.toScene(snap) };
  window.AgentvilleWorlds = { checkMessage, loadPrefs, renderDiary, prefKey, choose, setCanSee };
})();
