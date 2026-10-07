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
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='15' fill='%231a1a19'/%3E%3Cpath d='M9 38h11l6-15 8 26 6-17 4 6h11' fill='none' stroke='%230ca30c' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='50' cy='15' r='7' fill='%23d03b3b'/%3E%3C/svg%3E">
<script>(() => { let t = 'dark'; try { t = localStorage.getItem('tracker-theme') || 'dark'; } catch {} if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; })();</script>
<style>
:root { --bg:#fff; --text:#1d1d1f; --muted:#6e6e73; --line:#e3e3e8; color-scheme:light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#161618; --text:#f2f2f4; --muted:#a1a1a6; --line:#333338; color-scheme:dark; } }
:root[data-theme="dark"] { --bg:#161618; --text:#f2f2f4; --muted:#a1a1a6; --line:#333338; color-scheme:dark; }
body { margin:0; padding:16px; background:var(--bg); color:var(--text); font:13px/1.45 -apple-system, system-ui, sans-serif; }
table { border-collapse:collapse; width:100%; } td { border-bottom:1px solid var(--line); padding:4px 8px; vertical-align:top; }
.t { color:var(--muted); white-space:nowrap; font-family:ui-monospace, Menlo, monospace; font-size:12px; }
</style></head><body>
<h1 style="font-size:16px">${esc(name)} — last ${items.length} entries (newest first)</h1>
<table>${rows}</table>
</body></html>`;
}
