import { inflateRawSync } from 'node:zlib';

// What the reader shows of a file that isn't plain text: how each is viewed (by its extension), the
// type it is served with, and spreadsheets read into tables (xlsx: a zip of XML, read here with no
// dependency; csv). Word documents and first-page pictures come from macOS's own textutil and
// Quick Look (see the collector).

/** The extensions shown each way; the page keeps the same table (web/viewer.js), held to it by a test. */
export const VIEWS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'],
  pdf: ['pdf'],
  video: ['mp4', 'm4v', 'webm', 'mov'],
  audio: ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac'],
  html: ['html', 'htm'],
  word: ['docx', 'doc', 'rtf', 'odt'],
  sheet: ['xlsx', 'csv'],
  office: ['pptx', 'ppt', 'xls', 'key', 'pages', 'numbers', 'odp', 'ods'],
  binary: ['zip', 'gz', 'tgz', 'tar', '7z', 'rar', 'dmg', 'exe', 'bin', 'so', 'dylib', 'class', 'jar', 'wasm', 'sqlite', 'db', 'woff', 'woff2', 'ttf', 'otf'],
};
const VIEW_OF = new Map(Object.entries(VIEWS).flatMap(([view, exts]) => exts.map(e => [e, view])));
const extOf = path => String(path).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/** How the reader shows a file: image, pdf, video, audio, html, word, sheet, office (a first-page picture), binary, or text. */
export const viewOf = path => VIEW_OF.get(extOf(path)) ?? 'text';

const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json', map: 'application/json', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', xml: 'application/xml',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};
/** The type a file is served with by its extension; anything else as bytes (served with nosniff, never run). */
export const contentTypeOf = path => TYPES[extOf(path)] ?? 'application/octet-stream';

/* ---------- csv ---------- */

/** Rows of a CSV (quoted fields, "" inside them), split on commas, semicolons or tabs, whichever the first line uses most. */
export function parseCsv(text) {
  const first = String(text).split(/\r?\n/)[0] ?? '';
  const sep = [',', ';', '\t'].reduce((best, c) => (first.split(c).length > first.split(best).length ? c : best), ',');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------- xlsx ---------- */

const MAX_ROWS = 2000, MAX_COLS = 100, MAX_ENTRY_BYTES = 64 * 1024 * 1024;

/** The entries of a zip archive (stored or deflated), each inflated only when asked for, none past 64 MB. */
function unzip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end === -1) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('a broken zip archive');
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), length = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (length > MAX_ENTRY_BYTES) throw new Error('too large to read');
      return method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    });
    at += 46 + nameLen + extra + comment;
  }
  return { text: name => entries.get(name)?.().toString('utf8') ?? null };
}

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()]));
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const texts = xml => [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('');

/** A column's index from a cell reference: A1 → 0, AA7 → 26. */
const columnOf = ref => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
// Number formats that show dates: Excel's own (14-22, 45-47), or a custom one with day, month or year in it.
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateFormat = code => /[dmyhs]/i.test(String(code).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^general$/i.test(code);
const PERCENT_IDS = new Set([9, 10]);

function cellText(raw, type, style, styles) {
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (type === 'e' || type === 'str') return raw;
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n)) return raw;
  const fmt = styles[style];
  if (fmt?.date) { // days since 1899-12-30 (Excel's 1900 date system), a fraction for the time of day
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86_400_000));
    const day = d.toISOString().slice(0, 10), time = d.toISOString().slice(11, 16);
    return n % 1 ? (Math.floor(n) ? `${day} ${time}` : time) : day;
  }
  if (fmt?.percent) return `${Number((n * 100).toPrecision(12))}%`;
  return String(Number(n.toPrecision(15))); // 0.30000000000000004 → 0.3, as Excel shows it
}

/** A workbook's sheets as tables of what each cell shows: { sheets: [{ name, rows, truncated }] } or { error }. */
export function readXlsx(buf) {
  try {
    const z = unzip(buf);
    const shared = [...String(z.text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
    const stylesXml = z.text('xl/styles.xml') ?? '';
    const custom = new Map([...stylesXml.matchAll(/<numFmt\s[^>]*>/g)].map(m => [Number(attr(m[0], 'numFmtId')), unxml(attr(m[0], 'formatCode') ?? '')]));
    const xfs = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
    const styles = [...xfs.matchAll(/<xf\s[^>]*>/g)].map(m => {
      const id = Number(attr(m[0], 'numFmtId') ?? 0);
      return { date: DATE_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id))), percent: PERCENT_IDS.has(id) };
    });
    const rels = new Map([...String(z.text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\s[^>]*>/g)].map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
    const sheets = [...String(z.text('xl/workbook.xml') ?? '').matchAll(/<sheet\s[^>]*>/g)].map(m => {
      const target = rels.get(attr(m[0], 'r:id')) ?? '';
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      const rows = [];
      let truncated = false;
      for (const row of String(z.text(path) ?? '').matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const r = Number(attr(row[1], 'r') ?? rows.length + 1) - 1;
        if (r >= MAX_ROWS) { truncated = true; break; }
        while (rows.length < r) rows.push([]);
        const cells = [];
        for (const c of String(row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = attr(c[1], 'r'), col = ref ? columnOf(ref) : cells.length;
          if (col >= MAX_COLS) { truncated = true; continue; }
          const type = attr(c[1], 't'), body = c[2] ?? '';
          const raw = type === 'inlineStr' ? texts(body) : unxml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
          while (cells.length < col) cells.push('');
          cells[col] = type === 's' ? shared[Number(raw)] ?? '' : cellText(raw, type === 'inlineStr' ? 'str' : type, Number(attr(c[1], 's') ?? 0), styles);
        }
        while (cells.length && !cells.at(-1)) cells.pop(); // a styled but empty cell at the end shows nothing
        rows.push(cells.map(v => v ?? ''));
      }
      return { name: unxml(attr(m[0], 'name') ?? ''), rows, truncated };
    });
    return { sheets };
  } catch (err) {
    return { error: `This spreadsheet could not be read (${err.message}).` };
  }
}
