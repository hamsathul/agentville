// A world that leaves a promise failing each time it draws its ground: reported once a stop, with its line.
window.Agentville.world({
  W: 400,
  slots: () => ({ group: 'all', zone: 'all', cap: 16, at: i => [20 + i * 20, 60] }),
  drawChar() {},
  bg() { Promise.reject(new Error('the ground went wrong')); },
});
