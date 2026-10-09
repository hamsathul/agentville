// plain() (scripts/lib/plain-text.mjs): text a world controls, made safe to print to a terminal. Control
// sequences and control characters go, newlines and tabs stay, and long text is cut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oneLine, plain } from '../../scripts/lib/plain-text.mjs';

const ESC = '\x1b', BEL = '\x07';

test('escape sequences are removed whole: a CSI colour, a title-setting OSC (both ends), a clipboard OSC 52, a DCS', () => {
  assert.equal(plain(`${ESC}[31mred${ESC}[0m text`), 'red text');
  assert.equal(plain(`a${ESC}[2Jb${ESC}[1;1Hc`), 'abc', 'clearing the screen, moving the cursor');
  assert.equal(plain(`${ESC}]0;owned${BEL}after`), 'after', 'a title, ended by BEL');
  assert.equal(plain(`${ESC}]2;owned${ESC}\\after`), 'after', 'a title, ended by ESC \\');
  assert.equal(plain(`${ESC}]52;c;aGVsbG8=${BEL}after`), 'after', 'the clipboard');
  assert.equal(plain(`${ESC}Pq#0;2;0;0;0${ESC}\\after`), 'after', 'a DCS');
  assert.equal(plain(`${ESC}X sos ${ESC}\\${ESC}^ pm ${ESC}\\${ESC}_ apc ${ESC}\\after`), 'after', 'SOS, PM and APC');
  assert.equal(plain(`a${ESC}7b${ESC}8c${ESC}(Bd`), 'abcd', 'two-character ones (and a charset)');
});

test('a bare or unfinished escape leaves no ESC behind', () => {
  for (const s of [`end${ESC}`, `${ESC}`, `a${ESC}]0;never ended`, `a${ESC}[12`, `a${ESC}P never ended`]) {
    const out = plain(s);
    assert.ok(!out.includes(ESC) && !out.includes(BEL), JSON.stringify(out));
  }
});

test('C0 controls (but newline and tab), DEL, C1 controls and bidi controls are removed', () => {
  const c0 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
  assert.equal(plain(`[${c0}]`), '[\t\n]');
  assert.equal(plain('a\rforged ✓ clean\bb\x7fc'), 'aforged ✓ cleanbc', 'a carriage return or a backspace overwrites nothing');
  const c1 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(0x80 + i)).join('');
  assert.equal(plain(`[${c1}]`), '[]');
  assert.equal(plain('\x9b2Jx\x9d0;t\x9c'), '2Jx0;t', 'the one-byte CSI, OSC and ST');
  assert.equal(plain('a‪b‫c‬d‭e‮f⁦g⁧h⁨i⁩j'), 'abcdefghij');
});

test('newlines, tabs and ordinary text stay as they are', () => {
  const s = 'line one\n\tline two: ✓ ✗ · é 漢 🐄 "quoted" [brackets] \\ back';
  assert.equal(plain(s), s);
  assert.equal(plain(''), '');
  assert.equal(plain(42), '42', 'anything is made a string');
  assert.equal(plain(null), 'null');
});

test('oneLine: plain, with each line break a space, so the words never start a line of their own', () => {
  assert.equal(oneLine(`Error: no door\n  ✓ 33 stops of the tour\r\n${ESC}[2Jdone`), 'Error: no door ✓ 33 stops of the tour done');
  assert.equal(oneLine('a\tb'), 'a\tb');
  assert.equal(oneLine('x'.repeat(10), 5), 'xxxx…');
});

test('long text is cut to max characters, with an ellipsis', () => {
  assert.equal(plain('x'.repeat(300)), 'x'.repeat(300), '300 by default: kept');
  const cut = plain('x'.repeat(301));
  assert.equal(cut.length, 300);
  assert.ok(cut.endsWith('…'));
  assert.equal(plain('abcdefghij', 5), 'abcd…');
  assert.equal(plain('🐄🐄🐄🐄🐄🐄', 3), '🐄🐄…', 'never half a character');
  assert.equal(plain(`${ESC}[31m${'y'.repeat(10)}`, 10), 'y'.repeat(10), 'measured after the escapes are gone');
});
