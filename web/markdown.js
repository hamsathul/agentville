// Markdown for the document reader. Every character of the file is escaped; the only HTML that
// comes out is what these functions build. Links go out only to http(s) and mailto, images show
// their alt text (nothing is fetched), and raw HTML in the file shows as text.
const MD_LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const MD_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const MD_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const MD_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const MD_QUOTE = /^\s{0,3}>/;
const mdSlug = text => String(text).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
const mdCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

function mdTableAt(lines, i) {
  if (!lines[i].includes('|') || i + 1 >= lines.length) return null;
  const head = mdCells(lines[i]);
  const sep = mdCells(lines[i + 1]);
  if (sep.length !== head.length || !sep.every(c => /^:?-+:?$/.test(c))) return null;
  return { head, align: sep.map(c => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : '')) };
}

const mdStartsBlock = (lines, i) => MD_FENCE.test(lines[i]) || MD_HEADING.test(lines[i]) || MD_HR.test(lines[i])
  || MD_QUOTE.test(lines[i]) || MD_LIST_ITEM.test(lines[i]) || Boolean(mdTableAt(lines, i));

function mdEmphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w_])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}

function mdInline(text) {
  const held = [];
  const hold = html => `\u0000${held.push(html) - 1}\u0000`;
  let s = String(text).replace(/\u0000/g, '');
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code) => hold(`<code>${esc(code.trim())}</code>`));
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => hold(`<span class="md-link" title="Images aren't loaded here">🖼 ${alt || 'image'}</span>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[\s\S]*?&quot;)?\)/g, (_, label, url) => {
    const raw = url.replace(/&amp;/g, '&');
    if (/^(https?:|mailto:)/i.test(raw)) return hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${mdEmphasis(label)}</a>`);
    if (raw.startsWith('#')) return hold(`<a href="#md-${mdSlug(raw.slice(1))}">${mdEmphasis(label)}</a>`);
    return hold(`<span class="md-link" title="${url}">${mdEmphasis(label)}</span>`);
  });
  s = s.replace(/&lt;((?:https?:|mailto:)[^\s&]+)&gt;/g, (_, url) => hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = mdEmphasis(s);
  for (let n = 0; n < 4 && s.includes('\u0000'); n++) s = s.replace(/\u0000(\d+)\u0000/g, (_, k) => held[k]);
  return s;
}

function mdList(lines, start) {
  const first = lines[start].match(MD_LIST_ITEM);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(MD_LIST_ITEM);
    if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) {
      items.push({ text: [m[3]], inner: [] });
      i++;
    } else if (m && m[1].length > indent) {
      const [html, next] = mdList(lines, i);
      items.at(-1).inner.push(html);
      i = next;
    } else if (!m && line.trim() && !mdStartsBlock(lines, i)) {
      items.at(-1).text.push(line.trim());
      i++;
    } else if (!line.trim()) {
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      const n = lines[j]?.match(MD_LIST_ITEM);
      if (!n || n[1].length < indent || (n[1].length === indent && /\d/.test(n[2]) !== ordered)) break;
      i = j;
    } else {
      break;
    }
  }
  const li = it => {
    const text = it.text.join(' ');
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    const body = task ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${mdInline(task[2])}` : mdInline(text);
    return `<li${task ? ' class="task"' : ''}>${body}${it.inner.join('')}</li>`;
  };
  const tag = ordered ? 'ol' : 'ul';
  const from = ordered ? Number.parseInt(first[2], 10) : 1;
  return [`<${tag}${from !== 1 ? ` start="${from}"` : ''}>${items.map(li).join('')}</${tag}>`, i];
}

function renderMarkdown(src, nested = false) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = [];
  let i = 0;
  if (!nested && lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    if (end > 0) {
      out.push(`<pre class="md-front">${esc(lines.slice(1, end).join('\n'))}</pre>`);
      i = end + 1;
    }
  }
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      i++;
    } else if ((m = line.match(MD_FENCE))) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(m[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="md-code"${m[2] ? ` data-lang="${esc(m[2])}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
    } else if ((m = line.match(MD_HEADING))) {
      const level = m[1].length;
      out.push(`<h${level} id="md-${mdSlug(m[2])}">${mdInline(m[2])}</h${level}>`);
      i++;
    } else if (MD_HR.test(line)) {
      out.push('<hr>');
      i++;
    } else if (MD_QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && MD_QUOTE.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), true)}</blockquote>`);
    } else if ((m = mdTableAt(lines, i))) {
      const { head, align } = m;
      const cell = (tag, text, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${mdInline(text)}</${tag}>`;
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(mdCells(lines[i++]));
      out.push(`<div class="md-scroll"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (MD_LIST_ITEM.test(line)) {
      const [html, next] = mdList(lines, i);
      out.push(html);
      i = next;
    } else {
      const para = [];
      do para.push(lines[i++].trim());
      while (i < lines.length && lines[i].trim() && !mdStartsBlock(lines, i));
      out.push(`<p>${mdInline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}
