// The 3D farm (a prototype): the farm drawn in 3D with three.js (docs/worlds.md, the catalogue). A world that
// draws itself: it registers with Agentville.raw as it loads, then imports its modules from its own folder
// (./app.js and what that imports). Scenes and the selection that come before the modules are ready are kept
// (the newest of each) and handed over then.
(() => {
  'use strict';
  let app = null, pendingScene = null, pendingSelect, pendingTalk = null, failed = false;
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
        .catch(err => { failed = true; throw err; }); // the bridge reports an unhandled rejection, with its message
    },
    scene(s) { if (app) app.scene(s); else if (!failed) pendingScene = s; },
    select(id) { if (app) app.select(id); else pendingSelect = id; },
    talk(exchanges) { if (app) app.talk(exchanges); else pendingTalk = exchanges; }, // Haiku's, through the ✨ Helper
  });
})();
