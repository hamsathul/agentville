// What the reader shows of files that aren't text: content types, spreadsheets (xlsx, csv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { contentTypeOf, parseCsv, readXlsx, viewOf } from '../sources/previews.mjs';

/** A zip archive of { name: text }, deflated, as Excel writes them (CRCs left out: the reader doesn't check them). */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const WORKBOOK = {
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Budget &amp; Plan" sheetId="1" r:id="rId1"/><sheet r:id="rId2" sheetId="2" name="Notes"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><r><t>Due </t></r><r><t>date</t></r></si><si><t>Rent &lt;office&gt;</t></si></sst>',
  'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="10"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Paid</t></is></c><c r="D1"><v>0.25</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="2"><v>46284</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" s="3"><v>0.125</v></c></row>
    <row r="4"><c r="A4"><f>SUM(D1:D2)</f><v>0.30000000000000004</v></c><c r="C4" t="e"><v>#DIV/0!</v></c><c r="E4" s="1"/></row>
  </sheetData></worksheet>`,
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="B1" t="str"><v>only B</v></c></row></sheetData></worksheet>',
};

test('a spreadsheet: each sheet by its name, values as Excel shows them (text, dates, percents, booleans, errors, formula results)', () => {
  const book = readXlsx(zip(WORKBOOK));
  assert.deepEqual(book.sheets.map(s => s.name), ['Budget & Plan', 'Notes']);
  assert.deepEqual(book.sheets[0].rows, [
    ['Item', 'Due date', 'Paid', '0.25'],
    ['Rent <office>', '2026-09-19', 'TRUE', '12.5%'],
    [],
    ['0.3', '', '#DIV/0!'], // its last cell (E4) is styled but empty: nothing to show
  ]);
  assert.equal(book.sheets[0].truncated, false);
  assert.deepEqual(book.sheets[1].rows, [['', 'only B']]);
});

test('a big sheet shows its first rows and columns and says so; what is not a spreadsheet says so', () => {
  const col = n => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }; // 0 → A, 26 → AA
  const cells = Array.from({ length: 120 }, (_, c) => `<c r="${col(c)}1"><v>${c}</v></c>`).join('');
  const rows = Array.from({ length: 2100 }, (_, r) => `<row r="${r + 2}"><c r="A${r + 2}"><v>${r}</v></c></row>`).join('');
  const big = readXlsx(zip({ ...WORKBOOK, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1">${cells}</row>${rows}</sheetData></worksheet>` }));
  assert.equal(big.sheets[0].rows.length, 2000);
  assert.equal(big.sheets[0].rows[0].length, 100);
  assert.equal(big.sheets[0].truncated, true);
  assert.match(readXlsx(Buffer.from('not a zip')).error, /could not be read/i);
});

test('a CSV: quoted fields, quotes inside them, commas or semicolons or tabs', () => {
  assert.deepEqual(parseCsv('name,note\r\n"Smith, J","said ""hi"""\nLee,\n'), [['name', 'note'], ['Smith, J', 'said "hi"'], ['Lee', '']]);
  assert.deepEqual(parseCsv('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test("how each file is shown, and the type it is served with: a picture, a PDF, a player, a page, a document, a table, or a first-page picture", () => {
  assert.deepEqual(['a.PNG', 'x.svg', 'r.pdf', 'v.mp4', 's.mp3', 'i.html', 'w.docx', 'w.rtf', 'b.xlsx', 'c.csv', 'p.pptx', 'k.key', 'app.tsx', 'n.md', 'z.zip'].map(viewOf),
    ['image', 'image', 'pdf', 'video', 'audio', 'html', 'word', 'word', 'sheet', 'sheet', 'office', 'office', 'text', 'text', 'binary']);
  assert.deepEqual(['a.png', 'x.svg', 'r.pdf', 'v.mov', 'i.html', 's.css', 'm.js', 'f.woff2', 'z.bin'].map(contentTypeOf),
    ['image/png', 'image/svg+xml', 'application/pdf', 'video/quicktime', 'text/html; charset=utf-8', 'text/css; charset=utf-8', 'text/javascript; charset=utf-8', 'font/woff2', 'application/octet-stream']);
});
