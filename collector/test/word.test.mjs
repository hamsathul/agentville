import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipOf } from './support.mjs';
import { readWord } from '../sources/word.mjs';

const B = String.fromCharCode(92);
const docx = body => zipOf({ 'word/document.xml': `<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>` });
const p = (text, { style, bold, italic, list } = {}) => `<w:p>${style || list ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>` : ''}<w:r>${bold || italic ? `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

test('a .docx becomes a page and plain text: headings, bold and italic runs, a list, a table', () => {
  const r = readWord(docx(
    p('Quarterly plan', { style: 'Heading1' }) + p('Bold', { bold: true }).replace('</w:p>', '<w:r><w:t xml:space="preserve"> plain </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>slanted</w:t></w:r></w:p>') +
    p('first item', { list: true }) + p('second item', { list: true }) +
    '<w:tbl><w:tr><w:tc>' + p('Item') + '</w:tc><w:tc>' + p('Qty') + '</w:tc></w:tr><w:tr><w:tc>' + p('bolts') + '</w:tc><w:tc>' + p('4') + '</w:tc></w:tr></w:tbl>'), 'docx');
  assert.equal(r.error, undefined);
  assert.match(r.html, /<h1>Quarterly plan<\/h1>/);
  assert.match(r.html, /<p><b>Bold<\/b> plain <i>slanted<\/i><\/p>/);
  assert.match(r.html, /<ul><li>first item<\/li><li>second item<\/li><\/ul>/);
  assert.match(r.html, /<table><tr><td>Item<\/td><td>Qty<\/td><\/tr><tr><td>bolts<\/td><td>4<\/td><\/tr><\/table>/);
  assert.match(r.text, /Quarterly plan\nBold plain slanted\n/);
  assert.match(r.text, /bolts\t4/);
});

test('whatever the document holds is text: markup in it is escaped and nothing from it becomes a tag or attribute', () => {
  const r = readWord(docx(p('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &lt;img src=x onerror=y&gt;', { style: 'Heading2" onclick="x' })), 'docx');
  assert.ok(!/<script|<img|onerror=|onclick/i.test(r.html.replace(/&lt;[^]*?&gt;/g, '')), r.html);
  assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;q&quot;/);
  assert.match(r.text, /<script>alert\(1\)<\/script> & "q"/);
});

test('an .rtf: bold, paragraphs, accents, unicode, and groups that are not text (fonts, colours, generator) are skipped', () => {
  const rtf = `{${B}rtf1${B}ansi{${B}fonttbl{${B}f0 Arial;}}{${B}colortbl;${B}red255${B}green0${B}blue0;}{${B}*${B}generator Word;}{${B}b Bold} plain${B}par caf${B}'e9 ${B}u8364? tax${B}par}`;
  const r = readWord(Buffer.from(rtf), 'rtf');
  assert.equal(r.error, undefined);
  assert.match(r.html, /<p><b>Bold<\/b> plain<\/p><p>café € tax<\/p>/);
  assert.equal(r.text.trim(), 'Bold plain\ncafé € tax');
  assert.ok(!/Arial|generator|red255/.test(r.text + r.html));
});

test('an .odt: headings and paragraphs, with its spaces and tabs', () => {
  const r = readWord(zipOf({ 'content.xml': '<office:document-content><office:body><office:text><text:h text:outline-level="1">Minutes</text:h><text:p>one<text:s text:c="2"/>two<text:tab/>three &amp; four</text:p></office:text></office:body></office:document-content>' }), 'odt');
  assert.match(r.html, /<h1>Minutes<\/h1><p>one {2}two\tthree &amp; four<\/p>/);
  assert.match(r.text, /Minutes\none {2}two\tthree & four/);
});

test('an old binary .doc is said plainly to be unreadable here, not shown as garbage', () => {
  const r = readWord(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]), 'doc');
  assert.match(r.error, /\.doc/);
  assert.equal(r.html, undefined);
});

test('a broken file, a wrong type and an empty one are errors with a reason, never an exception', () => {
  for (const [buf, ext] of [[Buffer.from('not a zip'), 'docx'], [Buffer.alloc(0), 'docx'], [zipOf({ 'other.xml': 'x' }), 'docx'], [Buffer.from('plain text'), 'rtf'], [Buffer.from('x'), 'odt'], [Buffer.from('x'), 'weird']]) {
    const r = readWord(buf, ext);
    assert.ok(r.error, `${ext}: ${JSON.stringify(r).slice(0, 80)}`);
  }
});

test('a huge document is cut, and says so', () => {
  const r = readWord(docx(p('x'.repeat(1_500_000))), 'docx');
  assert.ok(r.text.length <= 1_000_100);
  assert.equal(r.truncated, true);
});
