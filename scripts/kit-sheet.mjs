#!/usr/bin/env node
// A picture of the people and props kits for docs/worlds.md (docs/kits.png): every hat, top, bottom and
// extra, from the front, behind and the side and in the walking frames, and every prop in a person's hands,
// drawn by the kits themselves. Run it when a kit changes. No dependencies; needs Chrome (CHROME to set its path).
//
//   node scripts/kit-sheet.mjs [--out docs/kits.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openChrome, sleep } from './lib/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--out');
const OUT = join(ROOT, at > 0 ? process.argv[at + 1] : 'docs/kits.png');
const sdk = f => readFileSync(join(ROOT, 'web', 'worlds', 'sdk', f), 'utf8').replaceAll('</script', '<\\/script');
// Drawn in the page: sections of labelled cells, 12 to a line, 4× scale.
const SHEET = `(() => {
  const P = window.Agentville.people, K = window.Agentville.props, S = 4, CELL = 26, PER = 12, LABEL = 16, TITLE = 26, PAD = 16;
  const base = { hat: 'none', hatColor: '#d64545', band: '#8e2b2b', hair: '#5a3a22', skin: '#e0a878', top: 'shirt', bottom: 'trousers', bottomColor: '#3c5a99', extra: 'none' };
  const sections = [
    ['Hats', P.HATS.map(h => ({ label: h, look: { ...base, hat: h } }))],
    ['Tops (front, back, side)', P.TOPS.flatMap(t => ['down', 'up', 'right'].map(view => ({ label: view === 'down' ? t : '', look: { ...base, top: t }, view })))],
    ['Bottoms (standing, walking)', P.BOTTOMS.flatMap(b => ['s', 'a', 'b'].map(legs => ({ label: legs === 's' ? b : '', look: { ...base, bottom: b }, legs })))],
    ['Extras (front, side)', P.EXTRAS.flatMap(x => ['down', 'right'].map(view => ({ label: view === 'down' ? x : '', look: { ...base, extra: x }, view })))],
    ['Props', K.PROPS.map(p => ({ label: p, look: base, prop: p }))],
  ];
  const lines = sections.map(([, cells]) => Math.ceil(cells.length / PER));
  const W = PAD * 2 + PER * CELL * S, H = PAD * 2 + sections.length * TITLE + lines.reduce((t, n) => t + n * (CELL * S + LABEL), 0);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  document.body.append(c);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#1a1a19'; g.fillRect(0, 0, W, H);
  let y = PAD;
  sections.forEach(([title, cells], si) => {
    g.fillStyle = '#ffffff'; g.font = 'bold 15px system-ui'; g.fillText(title, PAD, y + 17); y += TITLE;
    cells.forEach((cell, i) => {
      const x = PAD + (i % PER) * CELL * S, top = y + Math.floor(i / PER) * (CELL * S + LABEL);
      g.fillStyle = '#5d9b46'; g.fillRect(x + 2, top, CELL * S - 4, CELL * S);
      g.setTransform(S, 0, 0, S, x + 5 * S, top + 5 * S);
      PXG.ctx = g; PXG.T = 0.3; PXG.k = S; PXG.lights = [];
      g.drawImage(P.sprite(cell.look, '#4a7bd0', { view: cell.view ?? 'down', legs: cell.legs ?? 's' }), 0, 0);
      if (cell.prop) K.draw(cell.prop, rpAt(0, 0), 0.3, false);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#c3c2b7'; g.font = '12px system-ui'; g.fillText(cell.label, x + 4, top + CELL * S + 12);
    });
    y += lines[si] * (CELL * S + LABEL);
  });
  document.title = JSON.stringify({ W, H });
})();`;
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1a1a19"><script>window.Agentville = {};</script><script>${sdk('pixel.js')}</script><script>${sdk('people.js')}</script><script>${sdk('props.js')}</script><script>${SHEET}</script></body>`;

const chrome = await openChrome();
try {
  await chrome.send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
  let size = null;
  for (let i = 0; i < 40 && !size; i++) { await sleep(150); try { size = JSON.parse(await chrome.js('document.title')); } catch { /* not drawn yet */ } }
  if (!size) throw new Error(`The sheet never drew${chrome.errors.length ? `: ${chrome.errors.join(' | ')}` : '.'}`);
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: size.W, height: size.H, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  const png = Buffer.from((await chrome.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  writeFileSync(OUT, png);
  console.log(`Saved ${OUT} (${size.W} × ${size.H}).`);
} finally {
  await chrome.close();
}
