const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderTranscriptPage(name, items) {
  const rows = items.map(i => `<tr>
  <td class="t">${esc(new Date(i.at).toLocaleString())}</td>
  <td>${esc(i.kind === 'tool' ? i.tool : i.kind)}</td>
  <td>${esc(i.text)}</td>
  <td>${i.ok === false ? '✗' : i.ok ? '✓' : ''}</td>
</tr>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} · transcript</title>
<style>
:root { --bg:#fff; --text:#1d1d1f; --muted:#6e6e73; --line:#e3e3e8; }
@media (prefers-color-scheme: dark) { :root { --bg:#161618; --text:#f2f2f4; --muted:#a1a1a6; --line:#333338; } }
body { margin:0; padding:16px; background:var(--bg); color:var(--text); font:13px/1.45 -apple-system, system-ui, sans-serif; }
table { border-collapse:collapse; width:100%; } td { border-bottom:1px solid var(--line); padding:4px 8px; vertical-align:top; }
.t { color:var(--muted); white-space:nowrap; font-family:ui-monospace, Menlo, monospace; font-size:12px; }
</style></head><body>
<h1 style="font-size:16px">${esc(name)} — last ${items.length} entries (newest first)</h1>
<table>${rows}</table>
</body></html>`;
}
