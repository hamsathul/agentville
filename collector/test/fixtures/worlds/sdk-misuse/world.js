// A world that hands the SDK something it can't use: the error is thrown in pixel.js, the line is this one's.
window.Agentville.world({
  W: 400,
  slots: () => ({ group: 'all', zone: 'all', cap: 16, at: i => [20 + i * 20, 60] }),
  drawChar() { pixelOrigin(null, 16); },
  bg() {},
});
