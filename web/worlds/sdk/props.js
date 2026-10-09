// The props kit: what a person holds for each kind of step (docs/worlds.md, "The props kit"). Every step
// Claude Code takes has a plain prop here; a world draws its own for the ones it likes and keeps the rest.
// A prop is drawn around a 14 × 16 person: rp paints in its pixels (the person spans x 1–12, y 0–15; the
// right hand is at x 11–12, y 11–12). A classic script in a world's frame, after pixel.js (blink, PXG, SC);
// it adds only window.Agentville.props.
(() => {
  'use strict';

  // Each step: the prop, what the person is doing (for its tip), and where it stands in its plot (left
  // for looking things up, right for working, the middle for the rest).
  const STEPS = {
    edit: { prop: 'pencil', verb: 'editing', spot: 26 },
    write: { prop: 'page', verb: 'writing a new file', spot: 26 },
    read: { prop: 'book', verb: 'reading', spot: -26 },
    search: { prop: 'magnifier', verb: 'searching', spot: -26 },
    web: { prop: 'globe', verb: 'on the web', spot: -26 },
    mcp: { prop: 'plug', verb: 'using a connector', spot: -26 },
    skill: { prop: 'scroll', verb: 'following a skill', spot: 0 },
    test: { prop: 'checklist', verb: 'running the tests', spot: 0 },
    lint: { prop: 'broom', verb: 'tidying up', spot: 26 },
    build: { prop: 'hammer', verb: 'building', spot: 0 },
    install: { prop: 'box', verb: 'installing', spot: 0 },
    commit: { prop: 'stamp', verb: 'committing', spot: 0 },
    push: { prop: 'dolly', verb: 'pushing', spot: 0 },
    deploy: { prop: 'rocket', verb: 'deploying', spot: 0 },
    pull: { prop: 'envelope', verb: 'pulling', spot: 0 },
    serve: { prop: 'server', verb: 'keeping a server running', spot: 0 },
    delete: { prop: 'bin', verb: 'deleting', spot: 26 },
    agent: { prop: 'megaphone', verb: 'calling helpers', spot: 0 },
    plan: { prop: 'clipboard', verb: 'planning', spot: 0 },
    ask: { prop: 'card', verb: 'asking you something', spot: 0 },
    shell: { prop: 'terminal', verb: 'running a command', spot: 0 },
    other: { prop: 'wrench', verb: 'working', spot: 0 },
  };
  const PLAN_MODE = { prop: 'blueprint', verb: 'drawing up plans (plan mode)', spot: 0 };
  const OLD_TOOLS = { Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', Read: 'read', Grep: 'search', Glob: 'search', WebSearch: 'web', WebFetch: 'web', Bash: 'shell' };
  const HAND = '#e0a878';
  const PROPS = {
    pencil(rp, T) { // editing: a pencil writing across a sheet
      const n = Math.floor(T * 4) % 5;
      rp(13, 9, 7, 6, '#f4ecd8'); rp(13, 9, 7, 1, '#c3cbd2'); rp(14, 11, n, 1, '#5f6b7a'); rp(14, 13, Math.max(0, n - 2), 1, '#5f6b7a');
      rp(14 + n, 6, 1, 5, '#f0b429'); rp(14 + n, 11, 1, 1, '#2a1d14'); rp(11, 11, 2, 1, HAND);
    },
    page(rp) { // a new file: a fresh page, a plus on it
      rp(13, 8, 6, 7, '#ffffff'); rp(13, 8, 6, 1, '#c3cbd2'); rp(17, 8, 2, 2, '#c3cbd2'); rp(15, 11, 3, 1, '#2fa57a'); rp(16, 10, 1, 3, '#2fa57a');
      if (blink(2)) rp(19, 7, 1, 1, '#ffd43b');
      rp(11, 11, 2, 1, HAND);
    },
    book(rp) { // reading: an open book, a page turning
      rp(3, 10, 8, 4, '#2c4a85'); rp(4, 10, 6, 3, '#f4ecd8'); rp(7, 10, 1, 3, '#c3cbd2'); rp(5, 11 + blink(3), 2, 1, '#9aa4ad'); rp(8, 11, 1, 1, '#9aa4ad');
    },
    magnifier(rp, T) { // searching: a glass sweeping to and fro
      const lx = 14 + Math.round(Math.sin(T * 2.5) * 2);
      rp(11, 12, lx - 11, 1, '#6b4320');
      rp(lx, 7, 4, 1, '#5f6b7a'); rp(lx, 12, 4, 1, '#5f6b7a'); rp(lx - 1, 8, 1, 4, '#5f6b7a'); rp(lx + 4, 8, 1, 4, '#5f6b7a');
      rp(lx, 8, 4, 4, '#a9dcf7'); rp(lx + 1, 8, 1, 1, '#ffffff');
    },
    globe(rp, T) { // the web: a globe turning
      const lx = 13 + (Math.floor(T * 3) % 5);
      rp(14, 6, 4, 1, '#2c4a85'); rp(13, 7, 6, 5, '#3d7be0'); rp(14, 12, 4, 1, '#2c4a85');
      rp(lx, 8, 2, 2, '#3f9b3a'); rp(13 + ((lx - 13 + 3) % 5), 10, 2, 1, '#3f9b3a'); rp(15, 13, 2, 2, '#5f6b7a'); rp(11, 11, 2, 1, HAND);
    },
    plug(rp) { // a connector: a plug going into its socket
      const home = blink(1.5);
      rp(11, 11, 3, 1, '#2a1d14'); rp(14 + home, 10, 3, 3, '#5f6b7a'); rp(17 + home, 10, 2, 1, '#c3cbd2'); rp(17 + home, 12, 2, 1, '#c3cbd2');
      rp(20, 9, 2, 5, '#e6eef5'); rp(20, 10, 1, 1, '#3a3a40'); rp(20, 12, 1, 1, '#3a3a40');
      if (home) rp(22, 8, 1, 1, '#ffd43b');
    },
    scroll(rp) { // a skill: a scroll of instructions
      rp(3, 9, 8, 6, '#f4ecd8'); rp(2, 9, 1, 6, '#c9a46a'); rp(11, 9, 1, 6, '#c9a46a'); rp(4, 11, 6, 1, '#c9b48a'); rp(4, 13, 4, 1, '#c9b48a');
      if (blink(1.5)) rp(12, 6, 1, 1, '#ffd43b');
    },
    checklist(rp, T) { // tests: a card of checks, ticked one by one
      const n = Math.floor(T * 2) % 4;
      rp(13, 7, 6, 8, '#f4ecd8'); rp(13, 7, 6, 1, '#9aa4ad');
      for (let i = 0; i < 3; i++) { rp(14, 9 + i * 2, 1, 1, i < n ? '#2fa57a' : '#c3cbd2'); rp(16, 9 + i * 2, 2, 1, '#c9b48a'); }
      rp(11, 11, 2, 1, HAND);
    },
    broom(rp) { // tidying up: sweeping
      if (blink(2.5)) { rp(12, 3, 1, 10, '#a8703c'); rp(10, 13, 5, 2, '#e9c46a'); }
      else { rp(12, 6, 1, 7, '#a8703c'); rp(13, 13, 5, 2, '#e9c46a'); rp(19, 14, 1, 1, '#c9b48a'); rp(20, 13, 1, 1, '#c9b48a'); }
    },
    hammer(rp) { // building: a hammer on a block
      rp(15, 12, 5, 3, '#c98d4f'); rp(15, 12, 5, 1, '#e2b07a');
      if (blink(3)) { rp(12, 4, 1, 7, '#8b5a2b'); rp(11, 3, 3, 2, '#5f6b7a'); }
      else { rp(12, 10, 4, 1, '#8b5a2b'); rp(15, 9, 2, 3, '#5f6b7a'); rp(18, 10, 1, 1, '#ffd43b'); }
    },
    box(rp, T) { // installing: a box, things going in
      const ay = 3 + (Math.floor(T * 4) % 3);
      rp(13, 9, 6, 6, '#c9a46a'); rp(13, 9, 6, 1, '#e2b07a'); rp(15, 9, 2, 6, '#a8703c');
      rp(15, ay, 2, 3, '#2fa57a'); rp(14, ay + 3, 4, 1, '#2fa57a'); rp(11, 11, 2, 1, HAND);
    },
    stamp(rp) { // committing: a stamp on a sheet
      const up = blink(2);
      rp(13, 13, 7, 2, '#f4ecd8'); rp(15, 8 - up * 2, 3, 2, '#9c3b30'); rp(16, 5 - up * 2, 1, 3, '#6b4320');
      if (!up) rp(15, 12, 3, 1, '#e04a3a');
      rp(11, 10, 2, 1, HAND);
    },
    dolly(rp) { // pushing: a box on a hand truck, an arrow up
      const roll = blink(6);
      rp(11, 6, 1, 8, '#5f6b7a'); rp(11, 14, 5, 1, '#5f6b7a'); rp(12, 9, 4, 5, '#c9a46a'); rp(12, 9, 4, 1, '#e2b07a'); rp(13 - roll, 15, 2, 1, '#2a1d14');
      rp(18, 5, 1, 5, '#2fa57a'); rp(17, 6, 3, 1, '#2fa57a');
    },
    rocket(rp, T) { // deploying: a little rocket lifting off
      const lift = Math.floor(T * 3) % 3;
      rp(15, 4 - lift, 3, 7, '#e6eef5'); rp(16, 3 - lift, 1, 1, '#e04a3a'); rp(15, 6 - lift, 3, 1, '#3d7be0');
      rp(14, 9 - lift, 1, 2, '#e04a3a'); rp(18, 9 - lift, 1, 2, '#e04a3a'); rp(16, 11 - lift, 1, 1 + blink(6), '#f08a24'); rp(11, 11, 2, 1, HAND);
    },
    envelope(rp, T) { // pulling: a letter coming in
      const dy = Math.floor(T * 3) % 4;
      rp(14, 5 + dy, 6, 4, '#f4ecd8'); rp(14, 5 + dy, 6, 1, '#c9b48a'); rp(16, 6 + dy, 2, 1, '#c9b48a'); rp(11, 11, 2, 1, HAND);
    },
    server(rp) { // a server running: a box of blinking lights
      rp(14, 6, 5, 9, '#3a3a40'); rp(14, 6, 5, 1, '#5f6b7a');
      rp(15, 8, 3, 1, blink(4) ? '#2fa57a' : '#1b1420'); rp(15, 10, 3, 1, '#5f6b7a'); rp(15, 12, 3, 1, blink(3) ? '#ffd43b' : '#5f6b7a');
      rp(11, 11, 3, 1, HAND);
    },
    bin(rp, T) { // deleting: something dropped in a bin
      const ph = (T * 1.5) % 1;
      rp(14, 10, 5, 5, '#5f6b7a'); rp(13, 9, 7, 1, '#3a3a40'); rp(15, 11, 1, 3, '#3a3a40'); rp(17, 11, 1, 3, '#3a3a40');
      if (ph < 0.7) rp(16, 2 + Math.round(ph * 8), 2, 2, '#f4ecd8');
    },
    megaphone(rp) { // calling helpers: a megaphone, sound coming out
      rp(12, 9, 2, 3, '#e04a3a'); rp(14, 8, 2, 5, '#e04a3a'); rp(16, 7, 1, 7, '#ff6b6b');
      if (blink(2)) { rp(18, 7, 1, 1, '#ffffff'); rp(18, 13, 1, 1, '#ffffff'); rp(19, 10, 1, 1, '#ffffff'); }
    },
    clipboard(rp, T) { // planning: a list being written
      const n = Math.floor(T * 1.5) % 3;
      rp(1, 9, 5, 6, '#6b4320'); rp(2, 10, 3, 4, '#f4ecd8'); rp(2, 9, 3, 1, '#9aa4ad');
      for (let i = 0; i < 2; i++) rp(2, 11 + i * 2, i < n ? 3 : 1, 1, '#3d7be0');
      rp(11, 9, 1, 3, '#3d7be0'); rp(11, 12, 1, 1, '#2a1d14');
    },
    card(rp) { // asking: a card with a question mark
      rp(13, 7, 6, 7, '#f4ecd8'); rp(13, 7, 6, 1, '#c3cbd2');
      rp(15, 8, 2, 1, '#3d7be0'); rp(17, 9, 1, 1, '#3d7be0'); rp(16, 10, 1, 1, '#3d7be0'); rp(16, 12, 1, 1, blink(2) ? '#3d7be0' : '#a9dcf7');
      rp(11, 11, 2, 1, HAND);
    },
    terminal(rp) { // a command: a terminal, its cursor blinking
      rp(13, 7, 7, 7, '#1b1420'); rp(13, 7, 7, 1, '#5f6b7a'); rp(14, 9, 1, 1, '#2fa57a'); rp(15, 10, 1, 1, '#2fa57a'); rp(14, 11, 1, 1, '#2fa57a');
      if (blink(2)) rp(16, 11, 2, 1, '#e6eef5');
      rp(11, 11, 2, 1, HAND);
    },
    wrench(rp) { // any other step: a wrench turning
      if (blink(2)) { rp(13, 8, 1, 5, '#9aa4ad'); rp(12, 6, 3, 2, '#9aa4ad'); rp(13, 6, 1, 1, '#1b1420'); }
      else { rp(12, 11, 5, 1, '#9aa4ad'); rp(17, 10, 2, 3, '#9aa4ad'); rp(18, 11, 1, 1, '#1b1420'); }
    },
    blueprint(rp) { // plan mode: drawing up plans, a pencil moving over the sheet
      rp(1, 9, 11, 6, '#2c4a85'); rp(1, 9, 11, 1, '#3d7be0'); rp(3, 10, 1, 5, '#a9dcf7'); rp(1, 12, 11, 1, '#a9dcf7'); rp(7, 11, 3, 2, '#a9dcf7');
      rp(8 + blink(3) * 2, 7, 1, 3, '#f0b429'); rp(8 + blink(3) * 2, 10, 1, 1, '#1b1420');
    },
  };

  /** Draws one of the kit's props around a person (rp: its pixel painter); false when the kit has no such prop. */
  function draw(prop, rp, T, flag) {
    if (!Object.hasOwn(PROPS, prop)) return false;
    PROPS[prop](rp, T, flag);
    return true;
  }
  /**
   * A world's own set: `steps` changes or adds steps ({ test: { prop: 'beaker', verb: 'testing samples' } },
   * or planMode), `props` draws its own props ({ beaker(rp, T, flag) {…} }); the kit's for everything else.
   */
  function kit({ steps = {}, props = {} } = {}) {
    const S = { ...STEPS, planMode: PLAN_MODE };
    for (const [k, v] of Object.entries(steps)) S[k] = { ...S[k], ...v };
    const P = { ...PROPS, ...props };
    const actionOf = (step, tool) => S[step] ?? S[OLD_TOOLS[tool]] ?? S.other;
    return {
      steps: S,
      actionOf,
      /** What an agent does now: its step's action; in plan mode, the blueprint; between steps, nothing. */
      doing: f => (f.mode === 'plan' && f.state === 'working' ? S.planMode : f.step || f.tool ? actionOf(f.step, f.tool) : null),
      draw(prop, rp, T, flag) { if (!Object.hasOwn(P, prop)) return false; P[prop](rp, T, flag); return true; },
    };
  }

  window.Agentville.props = { STEPS, PLAN_MODE, PROPS: Object.keys(PROPS), draw, kit };
})();
