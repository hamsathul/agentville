// The 3D farm's conversations (web/worlds/farm3d/talk.js): who talks to whom (animals near each other, a farmer and an
// animal near it, never a farmer who needs you), what they say (each in its own voice, about what is happening), the
// Talk button, and Haiku's exchanges (the ✨ Helper's) used when they fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, talkers, exchange, createTalk } from '../../web/worlds/farm3d/talk.js';
import { menuFor } from '../../web/worlds/farm3d/antics.js';

const seeded = s => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const animal = (i, kind, x, y) => ({ i, kind, x, y });
const farmer = (id, name, state, x, y, extra = {}) => ({ id, name, state, x, y, ...extra });

test('who talks: animals near each other, a farmer and an animal near it; never a farmer who needs you or whose turn ended', () => {
  const scene = { animals: [animal(0, 'cow', 100, 100), animal(1, 'horse', 130, 110), animal(2, 'fox', 400, 400)], farmers: [farmer('a', 'shop-bot', 'idle', 110, 130), farmer('b', 'api', 'waiting', 135, 105), farmer('c', 'web', 'yourTurn', 98, 98)] };
  const pairs = talkers(scene).map(p => p.map(t => t.kind ?? t.name).sort().join('+'));
  assert.ok(pairs.includes('cow+horse'));
  assert.ok(pairs.some(p => p.includes('shop-bot')));
  assert.ok(!pairs.some(p => p.includes('api') || p.includes('web')), 'not the one waiting on you, nor the one whose turn ended');
  assert.ok(!pairs.some(p => p.includes('fox')), 'too far');
});

test("an exchange: 2 to 4 lines in turn, in each one's voice, about what is happening, every blank filled", () => {
  const rand = seeded(3), facts = { night: false, weather: null, events: [{ kind: 'deployFailed', repo: 'shop' }] };
  for (let i = 0; i < 50; i++) {
    const ex = exchange([{ kind: 'cow' }, { id: 'a', name: 'shop-bot', state: 'working', step: 'editing', repo: 'shop' }], facts, rand);
    assert.ok(ex.length >= 2 && ex.length <= 4);
    assert.ok(ex.every((l, k) => l.who === (k % 2 ? ex[1].who : ex[0].who)), 'they take turns');
    assert.ok(ex.every(l => l.text.length >= 1 && l.text.length <= 60), JSON.stringify(ex));
    assert.ok(ex.every(l => !/[{}]/.test(l.text)), 'every blank filled');
  }
  const night = exchange([{ kind: 'wolf' }, { kind: 'fox' }], { night: true, weather: null, events: [] }, seeded(9));
  assert.ok(night.some(l => VOICES.wolf.night.includes(l.text) || VOICES.fox.night?.includes(l.text) || VOICES.wolf.reply?.includes(l.text) || VOICES.fox.reply?.includes(l.text)), 'at night, night talk');
  for (const kind of ['cow', 'bull', 'alpaca', 'donkey', 'horse', 'whitehorse', 'deer', 'stag', 'fox', 'wolf', 'husky', 'shiba', 'frog', 'trout', 'koi', 'roach', 'farmer']) {
    assert.ok(VOICES[kind]?.idle?.length >= 4, `${kind} has a voice`);
    for (const [when, lines] of Object.entries(VOICES[kind])) for (const l of lines) assert.ok(l.replace(/\{\w+\}/g, 'xxxxxxxxxxxxxxxx').length <= 60, `${kind} ${when}: "${l}" too long with names in it`);
  }
});

test("Talk is on every animal's menu, and starts a conversation at once: with the nearest in range, else to you", () => {
  for (const [kind, family] of [['cow', 'hooves'], ['fox', 'paws'], ['frog', 'frog'], ['koi', 'fish']]) assert.ok(menuFor(kind, family).includes('talk'), kind);
  const talk = createTalk({ rand: seeded(5) });
  const scene = { animals: [animal(0, 'cow', 100, 100), animal(1, 'horse', 120, 100), animal(2, 'fox', 400, 400)], farmers: [] };
  talk.tick(scene, 0.1);
  talk.start(0, scene);
  assert.equal(talk.bubbles()[0].who, 0, 'the cow speaks first');
  talk.start(2, scene);
  assert.ok(talk.bubbles().some(b => b.who === 2 && b.toYou), 'the fox, alone, talks to you');
  for (let k = 0; k < 200; k++) talk.tick(scene, 0.1); // 20 s on: both have finished
  assert.equal(talk.bubbles().filter(b => b.who === 2).length, 0);
});

test("left alone they chat now and then, two conversations at most, each line a few seconds; nothing while there's no one near", () => {
  const talk = createTalk({ rand: seeded(11) });
  const scene = { animals: [animal(0, 'cow', 100, 100), animal(1, 'horse', 120, 100), animal(2, 'husky', 300, 300), animal(3, 'shiba', 320, 300), animal(4, 'deer', 600, 600), animal(5, 'stag', 620, 600)], farmers: [] };
  let most = 0, said = 0, last = '';
  for (let k = 0; k < 3000; k++) { talk.tick(scene, 0.1); const b = talk.bubbles(); most = Math.max(most, new Set(b.map(x => x.conversation)).size); const key = b.map(x => x.text).join('|'); if (key && key !== last) said++; last = key; }
  assert.ok(most >= 1 && most <= 2, `${most} at once`);
  assert.ok(said >= 5, `${said} lines in 5 minutes`);
  const alone = createTalk({ rand: seeded(11) }), far = { animals: [animal(0, 'cow', 0, 0), animal(1, 'fox', 500, 500)], farmers: [] };
  for (let k = 0; k < 1000; k++) alone.tick(far, 0.1);
  assert.equal(alone.bubbles().length, 0);
});

test("Haiku's exchanges are used when they fit who is talking, and only once", () => {
  const talk = createTalk({ rand: seeded(7) });
  talk.take([{ lines: [{ who: 'cow', text: 'Grass is grass.' }, { who: 'horse', text: 'Speak for yourself.' }] }]);
  assert.equal(talk.stock(), 1);
  const scene = { animals: [animal(0, 'cow', 100, 100), animal(1, 'horse', 120, 100)], farmers: [] };
  talk.start(0, scene);
  assert.equal(talk.bubbles()[0].text, 'Grass is grass.');
  assert.equal(talk.stock(), 0);
  talk.start(0, scene);
  assert.notEqual(talk.bubbles()[0].text, 'Grass is grass.', 'used once');
});

test('never a path: a repo or a name that looks like one is said by its last part', () => {
  const rand = seeded(13);
  for (let i = 0; i < 40; i++) {
    const ex = exchange([{ kind: 'cow' }, { id: 'a', name: '/Users/me/agents/bot', state: 'working', step: 'editing', repo: '/Users/me/code/shop/' }], { night: false, weather: null, events: [{ kind: 'deployOk', repo: 'C:\\code\\shop' }] }, rand);
    assert.ok(ex.every(l => !/[\\/]/.test(l.text)), JSON.stringify(ex));
  }
});
