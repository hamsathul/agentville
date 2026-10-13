// The 3D farm's camera: it starts square-on, the porch at the back as on the 2D farm, the whole farm filling the
// window. Left-drag pans along the ground; right-drag (or Shift-drag, or a two-finger click-and-drag on a trackpad)
// turns it to any angle and tilts it between 30° and 80°; the wheel and a pinch zoom, from the whole farm in to one
// farmer; ↺ ↻ and Q / E turn 15° at a time; Reset puts it back. The pure helpers are exported for
// collector/test/farm3d.test.mjs; makeCameraRig drives a three.js camera with them.

const DEG = Math.PI / 180;
export const FOV = 30;
export const DEFAULT_VIEW = { yaw: 0, pitch: 55 * DEG };
export const PITCH_MIN = 30 * DEG, PITCH_MAX = 80 * DEG, STEP = 15 * DEG;
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6]; // past the 2D farm's 3: close enough to see one farmer
export const GROUND_HALF = 2000; // how far the ground runs out from the farm, in metres: past every corner of the window
const MIN_ZOOM = ZOOMS[0], MAX_ZOOM = ZOOMS.at(-1);

/** A tilt kept between nearly flat (30°) and nearly top-down (80°). */
export const clampPitch = p => Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));
/** The next 15° mark from a heading, one way or the other (from between two marks: the next one that way). */
export function stepYaw(yaw, dir) {
  const at = yaw / STEP, eps = 1e-6;
  return (dir > 0 ? Math.floor(at + eps) + 1 : Math.ceil(at - eps) - 1) * STEP;
}
/** A target point kept over the farm: within ±half on each axis. */
export const clampTarget = ({ x, z }, half) => ({ x: Math.max(-half.x, Math.min(half.x, x)), z: Math.max(-half.z, Math.min(half.z, z)) });
/** The next zoom step up (dir 1) or down (-1) from a zoom, which may lie between two steps. */
export function nextZoom(zoom, dir) {
  if (dir > 0) return ZOOMS.find(z => z > zoom + 1e-6) ?? MAX_ZOOM;
  return [...ZOOMS].reverse().find(z => z < zoom - 1e-6) ?? MIN_ZOOM;
}

/** The unit vector from the target to the camera, and the camera's right and up, for a heading and a tilt. */
function basis(yaw, pitch) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return { back: { x: cp * sy, y: sp, z: cp * cy }, right: { x: cy, y: 0, z: -sy }, up: { x: -sy * sp, y: cp, z: -cy * sp } };
}
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
/** Where a point lands in the picture (−1…1 each way) for a camera `distance` from `target`. */
export function project(p, { yaw, pitch, fov, aspect, target, distance }) {
  const { back, right, up } = basis(yaw, pitch), r = { x: p.x - target.x, y: p.y - target.y, z: p.z - target.z };
  const depth = distance - dot(r, back), t = Math.tan(fov / 2);
  return { x: dot(r, right) / (depth * t * aspect), y: dot(r, up) / (depth * t), depth };
}
/** The distance at which every point lands inside the picture (with a margin): the whole farm in view. */
export function fitDistance(points, { yaw, pitch, fov, aspect, target, margin = 0.92 }) {
  const { back, right, up } = basis(yaw, pitch), t = Math.tan(fov / 2);
  let d = 1;
  for (const p of points) {
    const r = { x: p.x - target.x, y: p.y - target.y, z: p.z - target.z };
    const need = Math.max(Math.abs(dot(r, right)) / (margin * t * aspect), Math.abs(dot(r, up)) / (margin * t));
    d = Math.max(d, dot(r, back) + need);
  }
  return d;
}
/** Where the ray through a point of the picture (−1…1 each way) meets the ground, or null when it never does. */
export function groundAt(sx, sy, { yaw, pitch, fov, aspect, target, distance }) {
  const { back, right, up } = basis(yaw, pitch), t = Math.tan(fov / 2);
  const eye = { x: target.x + back.x * distance, y: target.y + back.y * distance, z: target.z + back.z * distance };
  const dir = { x: -back.x + right.x * sx * t * aspect + up.x * sy * t, y: -back.y + up.y * sy * t, z: -back.z + right.z * sx * t * aspect + up.z * sy * t };
  if (dir.y >= -1e-9) return null;
  const k = -eye.y / dir.y;
  return { x: eye.x + dir.x * k, y: 0, z: eye.z + dir.z * k };
}

const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The rig: `farm` is { half: { x, z }, points } (the farm's half extent, to pan over, and the corners to fit), set
 * with setFarm when the ground changes. `onChange({ yaw, pitch, zoom, distance })` runs after the view moves (to
 * draw, to place the haze and to save the view).
 */
export function makeCameraRig(THREE, camera, dom, { yaw = DEFAULT_VIEW.yaw, pitch = DEFAULT_VIEW.pitch, zoom = 1, onChange = () => {} } = {}) {
  const state = { yaw: Number.isFinite(yaw) ? yaw : DEFAULT_VIEW.yaw, pitch: clampPitch(Number.isFinite(pitch) ? pitch : DEFAULT_VIEW.pitch), zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom || 1)), target: { x: 0, z: 0 }, fit: 60 };
  let farm = { half: { x: 25, z: 20 }, points: [] }, anim = null, glide = null, aspect = 1;
  camera.fov = FOV;
  const distance = () => state.fit / state.zoom;
  function refit() { // 100% is the whole farm, from wherever it is seen
    state.fit = farm.points.length ? fitDistance(farm.points, { yaw: state.yaw, pitch: state.pitch, fov: FOV * DEG, aspect, target: { x: 0, y: 0, z: 0 } }) : 60;
  }
  function place() {
    const d = distance(), sp = Math.sin(state.pitch), cp = Math.cos(state.pitch);
    camera.position.set(state.target.x + d * cp * Math.sin(state.yaw), d * sp, state.target.z + d * cp * Math.cos(state.yaw));
    camera.lookAt(state.target.x, 0, state.target.z);
    camera.near = Math.max(0.5, d * 0.05); camera.far = d * 4 + GROUND_HALF;
    camera.updateProjectionMatrix();
  }
  const keep = () => { state.target = clampTarget(state.target, farm.half); if (state.zoom <= 1) state.target = { x: 0, z: 0 }; };
  const view = () => ({ yaw: state.yaw, pitch: state.pitch, zoom: state.zoom, distance: distance() });
  function changed() { refit(); keep(); place(); onChange(view()); }
  const rig = {
    setAspect(a) { aspect = a; camera.aspect = a; changed(); },
    setFarm(f) { farm = f; changed(); },
    /** Turns 15° one way (dir 1 or -1), easing over a moment. */
    turn(dir) { const from = state.yaw; anim = { from, to: stepYaw(anim ? anim.to : from, dir), t: 0 }; },
    /** Back to square-on, the whole farm in view. */
    reset() { anim = { from: state.yaw, to: Math.round(state.yaw / (2 * Math.PI)) * 2 * Math.PI, t: 0, pitchFrom: state.pitch }; state.zoom = 1; glide = null; changed(); },
    setZoom(z) { state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)); changed(); },
    zoomBy(dir) { if (dir === 0) rig.reset(); else rig.setZoom(nextZoom(state.zoom, dir)); },
    /** Glides to a point; from the whole farm, in to 150% too (at 100% the view can't move off the middle). */
    glideTo({ x, z }) { if (state.zoom < 1.5) { state.zoom = 1.5; changed(); } glide = { from: { ...state.target }, to: clampTarget({ x, z }, farm.half), t: 0 }; },
    /** Moves the view on; true while it is still moving (a turn, a reset or a glide). */
    update(dt) {
      let moving = false;
      if (anim) {
        anim.t = Math.min(1, anim.t + dt / 0.35);
        const k = ease(anim.t);
        state.yaw = anim.from + (anim.to - anim.from) * k;
        if (anim.pitchFrom !== undefined) state.pitch = anim.pitchFrom + (DEFAULT_VIEW.pitch - anim.pitchFrom) * k;
        if (anim.t >= 1) anim = null;
        changed();
        moving = true;
      }
      if (glide) {
        glide.t = Math.min(1, glide.t + dt / 0.6);
        const k = ease(glide.t);
        state.target = clampTarget({ x: glide.from.x + (glide.to.x - glide.from.x) * k, z: glide.from.z + (glide.to.z - glide.from.z) * k }, farm.half);
        if (glide.t >= 1) glide = null;
        place();
        moving = true;
      }
      return moving;
    },
    state: () => ({ ...view(), target: { ...state.target } }),
    /** Holds a view (for the browser check's pictures). */
    hold({ yaw: y, pitch: p, zoom: z } = {}) { anim = null; if (Number.isFinite(y)) state.yaw = y; if (Number.isFinite(p)) state.pitch = clampPitch(p); if (Number.isFinite(z)) state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)); changed(); },
  };

  // Left-drag pans along the ground; right-drag, or Shift-drag, turns and tilts; two pointers pinch to zoom.
  // A press that moves under 5 px is a click. The canvas keeps the pointer while it drags (over a tag or the Menu too).
  const pointers = new Map();
  let pinch = null, dragged = false, turning = false;
  dom.addEventListener('contextmenu', e => e.preventDefault()); // right-drag turns the farm: no menu
  dom.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { dom.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    dragged = false;
    turning = e.button === 2 || e.shiftKey;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom }; }
  });
  dom.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pinch && pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      rig.setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d)));
      dragged = true;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    dragged = true;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    anim = null; glide = null;
    if (turning) { // sideways turns it, up and down tilts it
      state.yaw -= dx * 0.006;
      state.pitch = clampPitch(state.pitch + dy * 0.005);
      changed();
      return;
    }
    if (state.zoom <= 1) return; // the whole farm is in view: nothing to pan to
    const perPx = (2 * distance() * Math.tan((FOV * DEG) / 2)) / Math.max(1, dom.clientHeight);
    const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw), sp = Math.sin(state.pitch);
    // right on the screen is the camera's right; up on the screen is away from the camera, along the ground
    state.target = clampTarget({ x: state.target.x - dx * perPx * cy - (dy * perPx * sy) / sp, z: state.target.z + dx * perPx * sy - (dy * perPx * cy) / sp }, farm.half);
    place();
    onChange(view());
  });
  const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', e => { e.preventDefault(); rig.setZoom(state.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  document.addEventListener('keydown', e => {
    if (e.target?.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'q' || e.key === 'Q') rig.turn(-1);
    else if (e.key === 'e' || e.key === 'E') rig.turn(1);
  });
  rig.wasDrag = () => dragged;
  place();
  return rig;
}
