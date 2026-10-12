import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromGit, isInside, toPosix } from '../platform/paths.mjs';

// Backslash paths are written with | and converted, so no layer between this file and node can eat an escape.
const w = s => s.replaceAll('|', String.fromCharCode(92));
const W = { win: true };
const P = { win: false };

test('inside means strictly below the base, with either separator, on Windows', () => {
  assert.equal(isInside(w('C:|scratch'), w('C:|scratch|a|x.output'), W), true);
  assert.equal(isInside(w('C:|scratch'), 'C:/scratch/a/x.output', W), true);
  assert.equal(isInside(w('C:|scratch|'), w('C:|scratch|x'), W), true);
});

test('refused: the base itself, a sibling sharing a prefix, a .. escape, another drive, a UNC path', () => {
  assert.equal(isInside(w('C:|scratch'), w('C:|scratch'), W), false);
  assert.equal(isInside(w('C:|scratch'), w('C:|scratch-other|x'), W), false);
  assert.equal(isInside(w('C:|scratch'), w('C:|scratch|..|secret|x'), W), false);
  assert.equal(isInside(w('C:|scratch'), w('D:|scratch|x'), W), false);
  assert.equal(isInside(w('C:|scratch'), w('||server|share|scratch|x'), W), false);
});

test('Windows paths compare without regard to case; POSIX paths do not', () => {
  assert.equal(isInside(w('C:|Users|Me'), w('c:|users|me|f'), W), true);
  assert.equal(isInside('/Users/me', '/users/me/f', P), false);
  assert.equal(isInside('/Users/me', '/Users/me/f', P), true);
});

test('a refusal says nothing: non-strings and empty input are false, never an exception', () => {
  for (const bad of [undefined, null, 5, '', {}]) {
    assert.equal(isInside(w('C:|scratch'), bad, W), false);
    assert.equal(isInside(bad, w('C:|scratch|x'), W), false);
  }
});

test('toPosix shows a Windows path with forward slashes and leaves a POSIX path alone', () => {
  assert.equal(toPosix(w('~|.claude|skills|x|SKILL.md')), '~/.claude/skills/x/SKILL.md');
  assert.equal(toPosix('/Users/me/f'), '/Users/me/f');
});

test('git prints C:/x/y; the rest of the code uses the native form, so fromGit converts on Windows and leaves POSIX alone', () => {
  assert.equal(fromGit('C:/Users/me/repo', W), w('C:|Users|me|repo'));
  assert.equal(fromGit('/Users/me/repo', P), '/Users/me/repo');
  assert.equal(fromGit('', W), '');
  assert.equal(fromGit(null, W), null);
});
