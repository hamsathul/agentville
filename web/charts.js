// Small charts drawn as SVG: sparklines, meters, the activity strip, line charts with a
// crosshair, and the tool timeline.
/* ---------- marks ---------- */

function sparkline(values, color, floorMax) {
  const W = 100, H = 22;
  if (!values?.length) return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"></svg>`;
  const top = Math.max(floorMax ?? 0, ...values, 1);
  const n = values.length;
  const pts = values.map((v, i) => [n === 1 ? W : (i / (n - 1)) * W, H - 2 - (Math.min(v, top) / top) * (H - 4)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}L${W},${H}L${pts[0][0].toFixed(1)},${H}Z" fill="${color}" opacity=".12"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function meter(fraction, severity, tip) {
  const pct = Math.max(2, Math.min(100, fraction * 100));
  return `<span class="meter ${severity}" data-tip="${esc(tip)}"><i style="width:${pct.toFixed(1)}%"></i></span>`;
}
const severityOf = (ratio, warnAt, critAt) => (ratio < warnAt ? 'ok' : ratio < critAt ? 'warn' : 'crit');

function heatStrip(activity) {
  const counts = activity?.length === 30 ? activity : new Array(30).fill(0);
  const now = Date.now();
  const cells = counts.map((n, i) => {
    const level = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 7 ? 3 : 4;
    return `<i class="h h${level}" data-tip="${hhmm(now - (29 - i) * 60_000)} · ${n} tool call${n === 1 ? '' : 's'}"></i>`;
  }).join('');
  return `<div class="heat" role="img" aria-label="Tool calls per minute over the last 30 minutes">${cells}</div>
    <div class="heat-label"><span>30 min ago</span><span>tool calls per minute</span><span>now</span></div>`;
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** A 10-minute line chart with hairline grid, end dot, crosshair and tooltip. One measure per chart. */
function lineChart(title, at, values, color, format) {
  if (!values?.length) return `<div class="chartbox"><div class="ptitle">${esc(title)}</div><div class="empty">No samples yet.</div></div>`;
  const W = 380, H = 160, L = 46, R = 10, T = 10, B = 22;
  const now = Date.now(), t0 = now - 10 * 60_000;
  const maxV = niceMax(Math.max(...values));
  const x = t => L + Math.max(0, Math.min(1, (t - t0) / (now - t0))) * (W - L - R);
  const y = v => T + (1 - Math.min(v, maxV) / maxV) * (H - T - B);
  const pts = values.map((v, i) => [x(at[i]), y(v)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = `${d}L${pts.at(-1)[0].toFixed(1)},${H - B}L${pts[0][0].toFixed(1)},${H - B}Z`;
  const grid = [0, maxV / 2, maxV].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${esc(format(v))}</text>`).join('');
  const xl = [[t0, '−10m', 'start'], [now - 5 * 60_000, '−5m', 'middle'], [now, 'now', 'end']]
    .map(([t, s, anchor]) => `<text x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${s}</text>`).join('');
  const last = pts.at(-1);
  const data = { x: pts.map(p => +p[0].toFixed(1)), y: pts.map(p => +p[1].toFixed(1)), t: values.map((v, i) => `${clock(at[i])} · ${format(v)}`) };
  return `<div class="chartbox"><div class="ptitle">${esc(title)}<span class="pv">${esc(format(values.at(-1)))}</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} over the last 10 minutes" data-chart="${esc(JSON.stringify(data))}">
      ${grid}${xl}
      <path class="area" d="${area}" fill="${color}"/>
      <path class="line" d="${d}" stroke="${color}"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="${color}" stroke="var(--panel)" stroke-width="2"/>
      <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}"/>
      <circle class="xd" r="4" fill="${color}"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg></div>`;
}

// Tool calls by kind: three categorical slots (validated all-pairs) plus grey for the rest;
// lanes are labelled, so no separate legend is needed.
const LANES = [['Shell', /^(Bash|BashOutput|KillShell)$/, 'var(--s1)'], ['Edit', /^(Edit|MultiEdit|Write|NotebookEdit)$/, 'var(--s2)'], ['Read', /^(Read|Grep|Glob|LS|WebFetch|WebSearch)$/, 'var(--s3)'], ['Other', /./, 'var(--s-other)']];
function timelineChart(timeline) {
  const W = 760, H = 124, L = 52, R = 12, T = 6, B = 20, lane = (H - T - B) / LANES.length;
  const now = Date.now(), t0 = now - 30 * 60_000;
  const x = t => L + Math.max(0, Math.min(1, (t - t0) / (now - t0))) * (W - L - R);
  const laneY = i => T + lane * i + lane / 2;
  const rows = LANES.map(([name], i) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${laneY(i).toFixed(1)}" y2="${laneY(i).toFixed(1)}"/><text x="${L - 8}" y="${(laneY(i) + 3).toFixed(1)}" text-anchor="end">${name}</text>`).join('');
  const xl = [[t0, '−30m', 'start'], [now - 15 * 60_000, '−15m', 'middle'], [now, 'now', 'end']]
    .map(([t, s, anchor]) => `<text x="${x(t).toFixed(1)}" y="${H - 5}" text-anchor="${anchor}">${s}</text>`).join('');
  const dots = (timeline ?? []).map(c => {
    const li = LANES.findIndex(([, re]) => re.test(c.tool));
    const cx = x(c.at).toFixed(1), cy = laneY(li).toFixed(1);
    return `<g data-tip="${esc(`${clock(c.at)} · ${c.tool}`)}"><circle cx="${cx}" cy="${cy}" r="11" fill="transparent"/><circle cx="${cx}" cy="${cy}" r="4" fill="${LANES[li][2]}" stroke="var(--panel)" stroke-width="2"/></g>`;
  }).join('');
  return `<div class="timeline"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tool calls by kind over the last 30 minutes">${rows}${xl}${dots}</svg></div>`;
}
