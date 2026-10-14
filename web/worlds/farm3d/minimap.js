// The minimap, while zoomed in (the engine's, for the 3D farm): the whole farm small in the bottom left corner, seen
// from above (the beds, the farmstead, the pond, every farmer a dot, red when it waits on you), the part of it in view
// a yellow outline; a click goes there. At most four drawings a second.
import { BED, FARMSTEAD, POND, PX, W } from './layout.js';

/** A point on the ground (metres) as a point on the 2D map (layout.js's toWorld, the other way). */
export const toMap = ({ x, z }, H) => [x * PX + W / 2, z * PX + H / 2];

const WIDE = 150; // CSS pixels across

export function makeMinimap(host, { onGo }) {
  const c = document.createElement('canvas');
  c.className = 'f3-mini';
  c.title = 'The whole farm: click to go there';
  Object.assign(c.style, { position: 'absolute', left: '10px', bottom: '10px', width: `${WIDE}px`, zIndex: 5, border: '2px solid #4e3626', borderRadius: '4px', boxShadow: '0 3px 0 rgba(0, 0, 0, .35)', cursor: 'pointer', display: 'none', background: '#5f9a4a' });
  host.append(c);
  let H = 400, last = 0;
  const ctx = c.getContext('2d');
  c.addEventListener('click', e => {
    const r = c.getBoundingClientRect(), k = W / r.width;
    onGo([(e.clientX - r.left) * k, (e.clientY - r.top) * k]); // a point on the 2D map
  });
  return {
    /** Shows it (zoomed in) or not. */
    show(on) { c.style.display = on ? '' : 'none'; },
    /**
     * Draws the farm (the model as drawn), the farmers where they are (posOf), and the view's outline (`view`: its
     * corners on the ground, 2D map points, or null), at most four times a second.
     */
    draw(model, posOf, view, now) {
      if (now - last < 250 || !model) return;
      last = now;
      H = model.ground.H;
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1), s = (WIDE / W) * dpr;
      c.width = Math.round(WIDE * dpr); c.height = Math.round((WIDE * H) / W * dpr);
      c.style.height = `${Math.round((WIDE * H) / W)}px`;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.fillStyle = '#5f9a4a'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#8b5a2b'; for (const b of FARMSTEAD) ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#7a5230'; for (const b of model.beds) ctx.fillRect(b.x0, b.y0, BED.w, BED.d);
      ctx.fillStyle = '#5ab4ff'; ctx.beginPath(); ctx.ellipse(POND.cx, POND.cy, POND.rx, POND.ry, 0, 0, Math.PI * 2); ctx.fill();
      for (const f of model.farmers) {
        const p = posOf(f.id);
        if (!p) continue;
        ctx.fillStyle = f.state === 'waiting' ? '#e04a3a' : f.shirt ?? '#ffffff';
        ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
      }
      if (view?.length === 4) {
        ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 4 / (s / dpr);
        ctx.beginPath(); view.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
      }
    },
  };
}
