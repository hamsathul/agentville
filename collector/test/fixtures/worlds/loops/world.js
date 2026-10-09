// A world whose ground never finishes drawing: check-world cuts the hook off and goes on.
window.Agentville.world({
  W: 400,
  slots: () => ({ group: 'all', zone: 'all', cap: 16, at: i => [20 + i * 20, 60] }),
  drawChar() {},
  bg() { for (;;) {} },
});
