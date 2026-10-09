// A world whose ground queues promise callbacks without end: check-world cuts them off as it does a loop.
window.Agentville.world({
  W: 400,
  slots: () => ({ group: 'all', zone: 'all', cap: 16, at: i => [20 + i * 20, 60] }),
  drawChar() {},
  bg() { const again = () => Promise.resolve().then(again); again(); },
});
