// A world whose failing promise says it came from a file that is neither world.js nor the SDK's: check-world
// names only those (never another file, its own included), so it names no file for it.
window.Agentville.world({
  W: 400,
  slots: () => ({ group: 'all', zone: 'all', cap: 16, at: i => [20 + i * 20, 60] }),
  drawChar() {},
  bg() { Promise.reject({ message: 'the ground went wrong', stack: 'Error: the ground went wrong\n    at ground (/elsewhere/ground.js:3:4)' }); },
});
