// The world test page (/worlds/test?world=<key>[&stop=<name>]): a world in its own frame, with no token and
// no real data, shown the tour's made-up snapshots (tour.js). Each stop has its own address, for a
// screenshot; with no stop it plays the tour. What the world asks the page to do is listed, not done.
// Its settings are kept in memory: the dashboard's, in this browser, are never touched.
(() => {
  'use strict';
  const q = new URLSearchParams(location.search), $ = id => document.getElementById(id);
  const key = q.get('world') ?? '', KEY = /^(u\/)?[a-z0-9][a-z0-9-]{0,39}$/;
  const { stops } = window.AgentvilleTour, host = $('world');
  const STOP_MS = 4000, SECOND_FRAME_MS = 1500, SHOWN_MS = 1000;
  if (!KEY.test(key)) {
    host.innerHTML = '<p class="note">Name a world in the address: <code>/worlds/test?world=farm</code>, <code>?world=starter</code>, or <code>?world=u/&lt;its folder&gt;</code> for one of yours. Add <code>&amp;stop=&lt;name&gt;</code> for one stop of the tour.</p>';
    return;
  }
  $('world-name').textContent = key;
  document.title = `${key} · World test page`;
  for (const s of stops) $('stops').append(new Option(`${s.name} · ${s.title}`, s.name));
  let at = Math.max(0, stops.findIndex(s => s.name === q.get('stop'))), playing = !q.get('stop'), timers = [];
  $('play').checked = playing;
  const asked = text => {
    const li = document.createElement('li');
    li.textContent = text;
    $('asked').prepend(li);
    while ($('asked').children.length > 30) $('asked').lastElementChild.remove();
  };
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  function show(i) {
    timers.forEach(clearTimeout);
    timers = [];
    at = (i + stops.length) % stops.length;
    const s = stops[at];
    $('stops').value = s.name;
    $('stop-title').textContent = `${s.sky === 'night' ? 'night' : 'day'}${s.private ? ', privacy mode' : ''}`;
    delete document.body.dataset.shown;
    history.replaceState(null, '', `?world=${encodeURIComponent(key)}&stop=${encodeURIComponent(s.name)}`);
    window.TrackerFarm.unmount();
    const [first, second] = s.frames;
    // The callbacks are named and called as app.js's are (web/worlds.js calls them).
    window.TrackerFarm.mount(host, {
      world: { key }, memory: { prefs: { sky: s.sky } }, private: s.private, still: false, diary: $('diary'),
      answer: act => window.AgentvilleTour.answer(act),
      onReady: () => {
        if (second) later(() => window.TrackerFarm.update(second), SECOND_FRAME_MS);
        later(() => { document.body.dataset.shown = s.name; }, (second ? SECOND_FRAME_MS : 0) + SHOWN_MS);
        if (playing) later(() => show(at + 1), (second ? SECOND_FRAME_MS : 0) + STOP_MS);
      },
      onPickAgent: (id, { from } = {}) => asked(`pick ${id}${from ? ` (from its ${from === 'say' ? 'bubble' : from})` : ''}`),
      onOpenDoc: (agentId, path) => asked(`open ${path}`), onShowRepos: () => asked('show the repos'),
      onStartSession: () => asked('start a session'), onNav: what => asked(`go to: ${what}`), onBell: on => asked(`bell ${on ? 'on' : 'off'}`),
      onMotion: still => asked(`motion ${still ? 'off' : 'on'}`), onNotice: text => asked(String(text)),
      // A broken world's panel offers "Back to the farm": the farm's own test page, at this stop.
      onWorld: w => { if (w?.key && w.key !== key) location.search = `?world=${encodeURIComponent(w.key)}&stop=${encodeURIComponent(s.name)}`; },
      navState: () => ({ theme: 'auto', side: false, live: true }),
    });
    window.TrackerFarm.update(first);
  }
  $('prev').addEventListener('click', () => show(at - 1));
  $('next').addEventListener('click', () => show(at + 1));
  $('stops').addEventListener('change', e => show(stops.findIndex(s => s.name === e.target.value)));
  $('play').addEventListener('change', e => { playing = e.target.checked; if (playing) show(at + 1); });
  show(at);
})();
