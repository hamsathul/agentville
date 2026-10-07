import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trailingQuestion } from '../derive/question.mjs';

test('a reply that ends by asking something yields that question', () => {
  assert.equal(trailingQuestion('All done.\n\nShould I push them to main?'), 'Should I push them to main?');
  assert.equal(trailingQuestion('Tests pass.\n\nThere are 5 new commits. Should I push them to `main`? The workflow runs on that push.'), 'Should I push them to main?');
  assert.equal(trailingQuestion('Done.\n\n**Want me to start?**'), 'Want me to start?');
  assert.equal(trailingQuestion('Which one?\n\nI picked A. It is merged.'), null, 'only the last paragraph counts');
});

test('question marks in code, URLs or nowhere are not questions', () => {
  assert.equal(trailingQuestion('Use `a?.b` here. Done.'), null);
  assert.equal(trailingQuestion('See https://example.com/a?b=1 for details.'), null);
  assert.equal(trailingQuestion('```js\nconst x = y ? 1 : 2;\n```'), null);
  assert.equal(trailingQuestion(''), null);
  assert.equal(trailingQuestion(null), null);
});

test('a long question is clipped', () => {
  const q = trailingQuestion(`Should I ${'really '.repeat(80)}do it?`);
  assert.ok(q.length <= 300 && q.endsWith('…'));
});
