// The 3D farm's camera: a fixed 3/4 view that turns in quarter steps (⟲ ⟳, Q / E), pans by dragging along the ground
// and zooms (the wheel, a pinch, the Menu's − / +) from the whole farm down to one farmer. The pure helpers are
// exported for collector/test/farm3d.test.mjs; makeCameraRig drives a three.js camera with them.

export const PITCH = (50 * Math.PI) / 180, FOV = 30;
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const MIN_ZOOM = ZOOMS[0], MAX_ZOOM = ZOOMS.at(-1);

/** The camera's heading for a turn (0–3): the first looks across the farm's corner with the porch at the back. */
export const yawOf = turn => Math.PI / 4 + (((turn % 4) + 4) % 4) * (Math.PI / 2);
/** The smallest signed angle from one heading to another. */
export const shortestTurn = (from, to) => { const d = (((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; return d; };
/** A target point kept over the farm: within ±half on each axis. */
export const clampTarget = ({ x, z }, half) => ({ x: Math.max(-half.x, Math.min(half.x, x)), z: Math.max(-half.z, Math.min(half.z, z)) });
/** The next zoom step up (dir 1) or down (-1) from a zoom, which may lie between two steps. */
export function nextZoom(zoom, dir) {
  if (dir > 0) return ZOOMS.find(z => z > zoom + 1e-6) ?? MAX_ZOOM;
  return [...ZOOMS].reverse().find(z => z < zoom - 1e-6) ?? MIN_ZOOM;
}

/** The unit vector from the target to the camera, and the camera's right and up, for a heading and a pitch. */
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

const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The rig: `farm` is { half: { x, z }, points } (the ground's half extent and the corners to fit), set with
 * setFarm when the ground changes. `onChange` runs after the view moves (to draw and to save turn and zoom).
 */
export function makeCameraRig(THREE, camera, dom, { turn = 0, zoom = 1, onChange = () => {} } = {}) {
  const state = { turn: ((Math.round(turn) % 4) + 4) % 4, yaw: yawOf(turn), zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom || 1)), target: { x: 0, z: 0 }, fit: 60 };
  let farm = { half: { x: 25, z: 20 }, points: [] }, anim = null, glide = null, aspect = 1;
  camera.fov = FOV;
  function place() {
    const d = state.fit / state.zoom, sp = Math.sin(PITCH), cp = Math.cos(PITCH);
    camera.position.set(state.target.x + d * cp * Math.sin(state.yaw), d * sp, state.target.z + d * cp * Math.cos(state.yaw));
    camera.lookAt(state.target.x, 0, state.target.z);
    camera.near = Math.max(0.5, d * 0.2); camera.far = d * 4 + 120;
    camera.updateProjectionMatrix();
  }
  function refit() {
    // The fit is for the whole farm from the turn's heading, about its middle.
    state.fit = farm.points.length ? fitDistance(farm.points, { yaw: yawOf(state.turn), pitch: PITCH, fov: (FOV * Math.PI) / 180, aspect, target: { x: 0, y: 0, z: 0 } }) : 60;
  }
  const keep = () => { state.target = clampTarget(state.target, farm.half); };
  function changed() { place(); onChange({ turn: state.turn, zoom: state.zoom }); }
  const rig = {
    setAspect(a) { aspect = a; camera.aspect = a; refit(); place(); },
    setFarm(f) { farm = f; refit(); keep(); place(); },
    turn(dir) { state.turn = (state.turn + dir + 4) % 4; refit(); anim = { from: state.yaw, by: shortestTurn(state.yaw, yawOf(state.turn)), t: 0 }; onChange({ turn: state.turn, zoom: state.zoom }); },
    setZoom(z) {
      state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
      if (state.zoom <= 1) state.target = { x: 0, z: 0 }; // the whole farm: back to its middle
      changed();
    },
    zoomBy(dir) { rig.setZoom(dir === 0 ? 1 : nextZoom(state.zoom, dir)); },
    glideTo({ x, z }) { glide = { from: { ...state.target }, to: clampTarget({ x, z }, farm.half), t: 0 }; if (state.zoom < 1.5) state.zoom = 1.5; },
    /** Moves the view on; true while it is still moving (a turn or a glide). */
    update(dt) {
      let moving = false;
      if (anim) { anim.t = Math.min(1, anim.t + dt / 0.4); state.yaw = anim.from + anim.by * ease(anim.t); if (anim.t >= 1) { state.yaw = yawOf(state.turn); anim = null; } moving = true; }
      if (glide) { glide.t = Math.min(1, glide.t + dt / 0.6); const k = ease(glide.t); state.target = { x: glide.from.x + (glide.to.x - glide.from.x) * k, z: glide.from.z + (glide.to.z - glide.from.z) * k }; if (glide.t >= 1) glide = null; moving = true; }
      if (moving) place();
      return moving;
    },
    state: () => ({ turn: state.turn, zoom: state.zoom, yaw: state.yaw, target: { ...state.target } }),
  };

  // Dragging pans along the ground; the wheel and a pinch zoom; Q and E turn. A press that moves under 5 px is a click.
  const pointers = new Map();
  let pinch = null, dragged = false;
  dom.addEventListener('pointerdown', e => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragged = false; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom }; } });
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
    if (state.zoom <= 1) return; // the whole farm is in view: nothing to pan to
    glide = null;
    const d = state.fit / state.zoom, perPx = (2 * d * Math.tan((FOV * Math.PI) / 360)) / Math.max(1, dom.clientHeight);
    const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
    // Right on the screen is the camera's right; up on the screen is away from the camera, on the ground.
    state.target = clampTarget({ x: state.target.x - dx * perPx * cy - (dy * perPx * sy) / Math.sin(PITCH), z: state.target.z + dx * perPx * sy - (dy * perPx * cy) / Math.sin(PITCH) }, farm.half);
    changed();
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
