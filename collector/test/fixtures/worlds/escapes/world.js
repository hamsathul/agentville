// A world whose words hold terminal control sequences (written as escapes, so this file holds none itself):
// its exception's name and message, a key of its cat's lines and a hat's name. check-world prints none of them.
const ESC = '\x1b', BEL = '\x07', C1 = '\x9b', OWN = `${ESC}]0;owned${BEL}${ESC}[2J${C1}2J`;
window.Agentville.world({
  W: 400,
  slots: () => ({ group: 'all', zone: 'all', cap: 16, at: i => [20 + i * 20, 60] }),
  animals: () => [{ kind: 'cat', home: { x: 0, y: 0, w: 40, h: 40 }, actions: [{ label: 'Pet' }, { label: 'Feed' }], lines: { idle: ['mrrp.'], [`purr${OWN}`]: 'not a list' } }],
  drawChar() {
    window.Agentville.people.rows({ hat: `cap${OWN}` });
    throw { name: `Error${OWN}`, message: `${OWN}\r\n  ✓ clean` }; // a thrown thing names itself
  },
  bg() {},
});
