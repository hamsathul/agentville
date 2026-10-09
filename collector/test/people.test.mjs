// The people kit (web/worlds/sdk/people.js): every part in every view is a 14 × 16 person; the farm's
// farmer is the kit in farm clothes, row for row; a part the kit lacks is drawn as the default and noted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function load() {
  const drawn = [];
  const canvas = () => { const g = { fillStyle: '', fillRect: (x, y, w, h) => drawn.push([g.fillStyle, x, y, w, h]), clearRect() {} }; return { width: 0, height: 0, getContext: () => g }; };
  const window = { Agentville: {} };
  const ctx = vm.createContext({ window, document: { createElement: () => canvas() }, console, Math, JSON, Map, Set });
  vm.runInContext(`${web('worlds/sdk/pixel.js')}\n;${web('worlds/sdk/people.js')}\n;window.ink = ink;`, ctx);
  return { people: window.Agentville.people, ink: window.ink, drawn };
}
const farmLook = over => ({ hat: 'straw', hatColor: '#e9c46a', band: '#b5562f', hair: '#5a3a22', skin: '#e0a878', top: 'shirt', bottom: 'overalls', bottomColor: '#3c5a99', extra: 'none', ...over });

test('every part, in every view and walking frame, is 16 rows of 14 known letters', () => {
  const { people } = load();
  const letters = /^[.khwbrsgpCcoOPLlVvUuXxJjNeE]{14}$/;
  for (const hat of people.HATS) for (const top of people.TOPS) for (const bottom of people.BOTTOMS) for (const extra of people.EXTRAS)
    for (const view of ['down', 'up', 'right', 'left']) for (const legs of ['s', 'a', 'b', 'p']) {
      const r = plain(people.rows(farmLook({ hat, top, bottom, extra }), view, legs));
      assert.equal(r.length, 16, `${hat}/${top}/${bottom}/${extra} ${view} ${legs}`);
      for (const row of r) assert.match(row, letters, `${hat}/${top}/${bottom}/${extra} ${view} ${legs}: ${row}`);
    }
});

test("the farm's farmer is the kit in farm clothes, row for row", () => {
  const { people } = load();
  assert.deepEqual(plain(people.rows(farmLook({ hat: 'straw', extra: 'beard' }), 'down', 's')), [
    '.....kkkk.....', '....kwwhhk....', '...khhhhhhk...', '..kbbbbbbbbk..', '.khhhhhhhhhhk.',
    '...krssssrk...', '...kssssssk...', '...krssssrk...', '....krrrrk....',
    '..kCCCCCCCck..', '.kCCoCCCCocck.', '.kCCooooooCck.', '.ks.oooooO.sk.', '...koooooOk...',
    '...koo..ook...', '...kkk..kkk...',
  ]);
  assert.deepEqual(plain(people.rows(farmLook({ hat: 'cap', extra: 'glasses' }), 'right', 'a')), [
    '..............', '.....kkkk.....', '....kwwhhk....', '...khhhhhhk...', '...kbbbbbbbbk.',
    '...krrsssssk..', '...krssggggk..', '...krsssssssk.', '....kkkkkkk...',
    '...kCCCCCck...', '...kCCoCCck...', '...kCoooock...', '...kooooOok...', '...koooooOk...',
    '....ko..ok....', '...kk....kk...',
  ]);
  assert.deepEqual(plain(people.rows(farmLook({ hat: 'none', extra: 'cheeks' }), 'up', 'b')), [
    '..............', '....kkkkkk....', '...krrrrrrk...', '...krrrrrrk...', '...krrrrrrk...',
    '...krrrrrrk...', '...krrrrrrk...', '...krrrrrrk...', '....kkkkkk....',
    '..kCCCCCCCck..', '.kCCCoCCoCcck.', '.kCCooooooCck.', '.ks.oooooO.sk.', '...koooooOk...',
    '...koo..ook...', '........kkk...',
  ]);
  const right = plain(people.rows(farmLook(), 'right', 'b')), left = plain(people.rows(farmLook(), 'left', 'b'));
  assert.deepEqual(left, right.map(r => [...r].reverse().join('')), 'facing left is the mirror of facing right');
  assert.deepEqual(plain(people.rows(farmLook(), 'down', 'p')).slice(14), ['......PP......', '......PP......'], "a scarecrow's pole");
});

test('a look comes from the outfit by the id: the same agent always looks the same, others differ', () => {
  const { people } = load();
  const outfit = { hat: ['straw', 'cap', 'beanie', 'bandana', 'none'], hatColors: { straw: [['#e9c46a', '#b5562f']], '*': [['#d64545', '#8e2b2b'], ['#4a74c9', '#2c4a85']] }, bottomColors: ['#3c5a99', '#6b4f2a'], extra: ['none', 'beard'] };
  const looks = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => plain(people.lookFor({ id }, outfit)));
  assert.deepEqual(plain(people.lookFor({ id: 'c' }, outfit)), looks[2]);
  assert.ok(new Set(looks.map(l => l.hat)).size >= 3, 'several hats');
  for (const l of looks) assert.deepEqual(Object.keys(l), ['hat', 'hatColor', 'band', 'hair', 'skin', 'top', 'bottom', 'bottomColor', 'extra']);
  for (const l of looks.filter(x => x.hat === 'straw')) assert.equal(l.hatColor, '#e9c46a', "a straw hat takes the straw hat's colours");
  assert.equal(people.lookFor({ id: 'x' }, { hat: 'cap' }).hat, 'cap', 'one value: no choice');
  assert.equal(people.lookFor({ id: 'x' }, {}).top, 'shirt');
});

test('a part the kit lacks is drawn as the default and noted, never thrown', () => {
  const { people } = load();
  const asked = farmLook({ hat: 'hardhatt', top: 'cape', bottom: 'kilt', extra: 'monocle' });
  assert.deepEqual(plain(people.rows(asked)), plain(people.rows(farmLook({ hat: 'none', top: 'shirt', bottom: 'overalls', extra: 'none' }))));
  assert.deepEqual(plain([...people.unknown]).sort(), ['bottom:kilt', 'extra:monocle', 'hat:hardhatt', 'top:cape']);
});

test("the palette: the shirt is exact, the rest snapped to the kit's colours; 'shirt' bottoms take the shirt", () => {
  const { people, ink } = load();
  const pal = plain(people.palette(farmLook({ bottomColor: 'shirt' }), '#4a7bd0'));
  assert.equal(pal.C, '#4a7bd0');
  assert.equal(pal.o, ink('#4a7bd0'));
  assert.equal(plain(people.palette(farmLook(), '#4a7bd0', { o: '#6b5a3a' })).o, ink('#6b5a3a'), 'overrides win');
});

test('a sprite is made once per look, colour and pose, and waves from the front', () => {
  const { people, drawn } = load();
  const a = people.sprite(farmLook(), '#4a7bd0'), b = people.sprite(farmLook(), '#4a7bd0');
  assert.equal(a, b, 'kept');
  const before = drawn.length;
  people.sprite(farmLook(), '#4a7bd0', { wave: true });
  assert.ok(drawn.slice(before).some(([c, x, y, w, h]) => c === '#4a7bd0' && x === 12 && y === 5 && w === 1 && h === 6), 'the arm up, in the shirt colour');
});
