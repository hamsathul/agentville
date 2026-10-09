// Agentville's mark: the farmhouse from the farm, as 16×16 pixel art on a green tile, drawn as
// crisp SVG at any size. While an agent waits on you, the favicon carries a red light.
(() => {
  'use strict';
  const PAL = { k: '#2a1d14', r: '#b23a2e', R: '#e04a3a', s: '#3a3a40', c: '#f4ecd8', C: '#d4c294', y: '#ffd43b', d: '#6b4320', g: '#6cc04a' };
  const ROWS = [
    '................',
    '.......kk...ss..',
    '......kRrk..ss..',
    '.....kRrrrk.ss..',
    '....kRrrrrrkss..',
    '...kRrrrrrrrk...',
    '..kRrrrrrrrrrk..',
    '.kRrrrrrrrrrrrk.',
    'kkkkkkkkkkkkkkkk',
    '.kcccccccccccCk.',
    '.kcyyccddccyyCk.',
    '.kcyyccddccyyCk.',
    '.kcccccddccccCk.',
    '.kcccccddccccCk.',
    '.kkkkkkkkkkkkkk.',
    'gggggggggggggggg',
  ];
  const TILE = '#2f6b2f', PAD = 2, VIEW = 16 + PAD * 2;
  let pixels = '';
  ROWS.forEach((row, y) => { for (let x = 0; x < 16; x++) { const c = PAL[row[x]]; if (c) pixels += `<rect x="${x + PAD}" y="${y + PAD}" width="1" height="1" fill="${c}"/>`; } });

  /** The mark as SVG markup: { size } in CSS pixels, { badge } adds the red waiting light, { cls } a class. */
  function svg({ size = 18, badge = false, cls = '' } = {}) {
    const light = badge ? `<rect x="${VIEW - 7}" y="0" width="7" height="7" rx="1.5" fill="#e5322d" stroke="#ffffff" stroke-width=".8"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg"${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 ${VIEW} ${VIEW}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${VIEW}" height="${VIEW}" rx="4" fill="${TILE}"/>${pixels}${light}</svg>`;
  }
  const dataUri = markup => `data:image/svg+xml,${encodeURIComponent(markup)}`;
  let shownBadge = null;
  /** The tab's icon: the farmhouse, with the red light while an agent needs you. */
  function favicon(badge) {
    if (badge === shownBadge || typeof document === 'undefined') return;
    shownBadge = badge;
    const link = document.getElementById('favicon');
    if (link) link.href = dataUri(svg({ size: 32, badge }));
  }

  window.Agentville = Object.assign(window.Agentville ?? {}, { svg, favicon, ROWS }); // in a world's frame, bridge.js got here first
  if (typeof document !== 'undefined') {
    for (const el of document.querySelectorAll('[data-brand]')) el.innerHTML = svg({ size: Number(el.dataset.brand) || 18 });
    favicon(false);
  }
})();
