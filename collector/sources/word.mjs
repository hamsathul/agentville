import { unxml, unzip } from './previews.mjs';

// Word documents (.docx, .odt, .rtf) read in plain JavaScript, for platforms with no textutil (Windows). The page it returns is
// built from a fixed set of tags around ESCAPED text: nothing in the document becomes a tag, an attribute or a link.
// Only the formatting that matters when reading is kept: headings, bold, italic, lists, tables.

const MAX_TEXT = 1_000_000;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A text budget shared by a whole document, so a huge one is cut (and says so) however it is laid out. */
function budget() {
  let left = MAX_TEXT;
  const b = { truncated: false, take(s) { if (s.length <= left) { left -= s.length; return s; } b.truncated = true; const cut = s.slice(0, left); left = 0; return cut; } };
  return b;
}

/** Paragraphs [{ tag, runs: [{ text, bold, italic }] }] and tables [{ table: rows[][] }] to the { html, text } the reader shows. */
function render(blocks, b) {
  const html = [], text = [];
  let list = false;
  const closeList = () => { if (list) { html.push('</ul>'); list = false; } };
  const runsHtml = runs => runs.map(r => { let h = esc(r.text); if (r.italic) h = `<i>${h}</i>`; if (r.bold) h = `<b>${h}</b>`; return h; }).join('');
  for (const blk of blocks) {
    if (blk.table) {
      closeList();
      html.push(`<table>${blk.table.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`);
      for (const row of blk.table) text.push(row.join('\t'));
      continue;
    }
    if (blk.tag === 'li') {
      if (!list) { html.push('<ul>'); list = true; }
      html.push(`<li>${runsHtml(blk.runs)}</li>`);
    } else {
      closeList();
      html.push(`<${blk.tag}>${runsHtml(blk.runs)}</${blk.tag}>`);
    }
    text.push(blk.runs.map(r => r.text).join(''));
  }
  closeList();
  return { html: html.join(''), text: `${text.join('\n')}\n`, ...(b.truncated ? { truncated: true } : {}) };
}

/* ---------- docx ---------- */

const isOn = (xml, tag) => { const m = xml.match(new RegExp(`<w:${tag}(\\s[^>]*)?/?>`)); return Boolean(m) && !/w:val="(0|false|none)"/.test(m[1] ?? ''); };

function docxRuns(paragraphXml, b) {
  const runs = [];
  for (const run of paragraphXml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)) {
    const xml = run[0];
    const props = xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
    let text = '';
    for (const t of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) text += t[1] !== undefined ? unxml(t[1]) : t[0].startsWith('<w:tab') ? '\t' : '\n';
    text = b.take(text);
    if (text) runs.push({ text, bold: isOn(props, 'b'), italic: isOn(props, 'i') });
  }
  return runs;
}

function docxBlocks(xml, b) {
  const blocks = [];
  for (const m of xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith('<w:tbl')) {
      const rows = [...m[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(r => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(c => [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(p => docxRuns(p[0], b).map(r => r.text).join('')).join(' ')));
      blocks.push({ table: rows });
      continue;
    }
    const style = m[0].match(/<w:pStyle w:val="([^"]*)"/)?.[1] ?? '';
    const heading = /^heading([1-6])$/i.exec(style);
    const tag = /^title$/i.test(style) ? 'h1' : heading ? `h${heading[1]}` : /<w:numPr>/.test(m[0]) ? 'li' : 'p';
    blocks.push({ tag, runs: docxRuns(m[0], b) });
  }
  return blocks;
}

/* ---------- odt ---------- */

function odtBlocks(xml, b) {
  const blocks = [];
  for (const m of xml.matchAll(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/g)) {
    const inner = m[3]
      .replace(/<text:s(?:\s[^>]*?text:c="(\d+)")?[^>]*\/>/g, (_, n) => ' '.repeat(Math.min(Number(n ?? 1), 200)))
      .replace(/<text:tab\s*\/>/g, '\t').replace(/<text:line-break\s*\/>/g, '\n').replace(/<[^>]*>/g, '');
    const level = m[1] === 'h' ? Math.min(6, Math.max(1, Number(/text:outline-level="(\d+)"/.exec(m[2])?.[1] ?? 1))) : 0;
    blocks.push({ tag: level ? `h${level}` : 'p', runs: [{ text: b.take(unxml(inner)), bold: false, italic: false }] });
  }
  return blocks;
}

/* ---------- rtf ---------- */

// Groups that hold no text of the document.
const SKIP_DESTINATIONS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'footnote', 'object', 'fldinst', 'themedata', 'datastore', 'latentstyles']);
const cp1252 = new TextDecoder('windows-1252');

function rtfBlocks(src, b) {
  const blocks = [];
  let runs = [];
  const stack = [];
  let st = { skip: false, bold: false, italic: false };
  const push = text => {
    if (!text || st.skip) return;
    text = b.take(text);
    if (!text) return;
    const last = runs.at(-1);
    if (last && last.bold === st.bold && last.italic === st.italic) last.text += text; // one run per stretch of the same formatting
    else runs.push({ text, bold: st.bold, italic: st.italic });
  };
  const endPara = () => { blocks.push({ tag: 'p', runs }); runs = []; };
  let i = 0;
  let pendingStar = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { stack.push(st); if (stack.length > 200) throw new Error('nested too deeply'); st = { ...st }; i++; pendingStar = false; continue; }
    if (c === '}') { st = stack.pop() ?? st; i++; continue; }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') { push(c); i++; continue; }
    const next = src[i + 1];
    if (next === '\\' || next === '{' || next === '}') { push(next); i += 2; continue; }
    if (next === '*') { pendingStar = true; st.skip = true; i += 2; continue; }
    if (next === "'") { push(cp1252.decode(Buffer.from([parseInt(src.slice(i + 2, i + 4), 16) || 63]))); i += 4; continue; }
    if (next === '~') { push(' '); i += 2; continue; }
    const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(src.slice(i, i + 40));
    if (!m) { i += 2; continue; }
    i += m[0].length;
    const word = m[1].toLowerCase(), arg = m[2] === undefined ? undefined : Number(m[2]);
    if (SKIP_DESTINATIONS.has(word) || pendingStar) st.skip = true;
    else if (word === 'par' || word === 'sect') { if (!st.skip) endPara(); }
    else if (word === 'line') push('\n');
    else if (word === 'tab') push('\t');
    else if (word === 'b') st.bold = arg !== 0;
    else if (word === 'i') st.italic = arg !== 0;
    else if (word === 'u' && arg !== undefined) { push(String.fromCodePoint(arg < 0 ? arg + 65536 : arg)); if (src[i] === '?') i++; }
  }
  if (runs.length) endPara();
  while (blocks.length && blocks.at(-1).runs.every(r => !r.text.trim())) blocks.pop();
  return blocks;
}

/** A Word document's bytes as { html, text } (and truncated), or { error }. Never throws. */
export function readWord(buf, ext) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length === 0) return { error: 'The document is empty.' };
    const b = budget();
    if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return { error: `The old binary Word format (.${ext || 'doc'}) cannot be read here. Open it in Word, or save it as .docx.` };
    if (buf.subarray(0, 2).toString('latin1') === 'PK') {
      const zip = unzip(buf);
      const docx = zip.text('word/document.xml');
      if (docx !== null) return render(docxBlocks(docx, b), b);
      const odt = zip.text('content.xml');
      if (odt !== null) return render(odtBlocks(odt, b), b);
      return { error: 'This archive is not a Word or OpenDocument text file.' };
    }
    if (buf.subarray(0, 5).toString('latin1') === '{\\rtf') return render(rtfBlocks(buf.toString('latin1'), b), b);
    return { error: `This is not a document this reader understands (.${ext || '?'}).` };
  } catch (err) {
    return { error: `The document could not be read (${String(err.message).slice(0, 120)}).` };
  }
}
