// The 3D farm (a prototype): the farm drawn in 3D with three.js (docs/worlds.md, the catalogue). A world that
// draws itself: it registers with Agentville.raw as it loads, then imports its modules from its own folder
// (./app.js and what that imports). Scenes and the selection that come before the modules are ready are kept
// (the newest of each) and handed over then. Its own panel and Menu have List and World ({ menu: true }: the page
// adds no corner); if its modules fail to load, it says so and draws the engine's plain Menu, whose List and World
// still work, so there is always a way back.
(() => {
  'use strict';
  let app = null, pendingScene = null, pendingSelect, pendingTalk = null, failed = false;
  function fallback(el, opts, err) {
    const said = String(err?.message ?? err).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    let open = false;
    const draw = () => {
      el.innerHTML = `<div class="f3-nogl" role="status">The 3D farm could not load.<small>${said}</small></div><div class="px-hud">${defaultHud({ nav: opts.navState?.() ?? {}, menuOpen: open, seasons: true })}</div>`;
      for (const b of el.querySelectorAll('.px-hud button:not([data-farm-nav]):not([data-farm-menu])')) b.disabled = true;
    };
    el.addEventListener('click', e => {
      const nav = e.target.closest?.('[data-farm-nav]');
      if (nav) { opts.onNav(nav.dataset.farmNav); return; }
      if (e.target.closest?.('[data-farm-menu]')) { open = !open; draw(); }
    });
    draw();
  }
  Agentville.raw({
    start({ el, opts, prefs }) {
      el.innerHTML = '<p class="f3-loading">Loading the 3D farm…</p>';
      import('./app.js')
        .then(m => {
          app = m.start({ el, opts, prefs });
          if (pendingScene) app.scene(pendingScene);
          if (pendingSelect !== undefined) app.select(pendingSelect);
          if (pendingTalk) app.talk(pendingTalk);
        })
        .catch(err => { failed = true; fallback(el, opts, err); throw err; }); // the bridge reports the rejection, with its message
    },
    scene(s) { if (app) app.scene(s); else if (!failed) pendingScene = s; },
    select(id) { if (app) app.select(id); else pendingSelect = id; },
    talk(exchanges) { if (app) app.talk(exchanges); else pendingTalk = exchanges; }, // Haiku's, through the ✨ Helper
  }, { menu: true });
})();
