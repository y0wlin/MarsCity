// Controls system: orbit / fly / walk / focus modes, transitions, back stack, picking.
// OWNER: controls agent. CONTRACT (used by UI, bookmarks, automation):
//   app.controls.flyTo(target, {duration?, pushBack=true, mode?, modeOpts?, bookmark?, ease?})
//                                       -> Promise<{arrived:boolean, interrupted?}>
//       target: pose {lat, lon, alt | agl, heading?, pitch?, roll?, lens?, fov?}   (agl: metres above
//                 the local ground / water surface, prompt §5 机位高度以当地地面或水面为基准)
//             | {lookAt: {lat, lon, h? | agl?} | ecef{x,y,z}, range?, heading?, tilt?, lens?}
//             | {position: ecef{x,y,z}, quaternion, lens?, fov?}   | {pose, mode} (bookmark shape)
//   app.controls.flyPath([target, ...], {duration?, mode?}) -> Promise   interruptible camera move
//   app.controls.back()                 animate to the previous camera pose + mode (stack)
//   app.controls.canGoBack()            -> boolean
//   app.controls.setMode('orbit'|'fly'|'walk'|'focus', opts)   opts: {id|buildingId, bookmark, instant}
//   app.controls.focusBuilding(id, {spec?, pushBack?, keepPose?}) orbit a building -> Promise (false: unknown id)
//   app.controls.enterBuilding(id, {spec?, entrance?})  walk in at the main entrance -> Promise (false: unknown)
//   app.controls.pick(clientX, clientY) -> {type:'building'|'location'|'mega', ...} | null
//   app.controls.screenRay(clientX, clientY) -> {origin:THREE.Vector3, dir:THREE.Vector3} (render space)
// Extras: home(), flyToPoint(x, y, dir), cancelTransition(), cycleMode(), lookAt(), zoomBy(),
//   rotateBy(), northUp(), topDown(), groundHeightAt(lat, lon), cameraInfo(), isIdle(),
//   buildingView(id, 'street'|'entrance'|'lobby'|'stair'|'living'|'back'|'roof', opts) -> Promise,
//   buildingViews(id) -> names | null, getFocusInfo(id, spec?) -> Promise<info|null>, pickRay(o, d),
//   walkFloorBelow(ecef, {maxDown, probeUp, analytic}) -> {h, kind, deep} (storey floor / roof / ground a
//   walker would stand on), CONTROLS_HELP / CONTROLS_HELP_SECTIONS (Chinese help for the UI).
// Programmatic poses (D6): any pose written from outside (URL pose, bookmark, __MARS__.goto, UI) and
//   every flight arrival (bookmarks, building / megastructure views) is HELD at its requested position
//   until user input (or a new flight): it is kept against the final ground (analytic terrain + hydro
//   water + walk colliders / picking hulls below), so coarse terrain tiles never lift it, and returns
//   from any temporary lift as soon as the refined floor allows. holdInfo() / cameraInfo().hold →
//   {src, walk, lifted, requested:{lat,lon,alt}}; releaseHold(). Fly mode may dive below the water.
//   A pose written just BEFORE a request (flyTo / setMode / focusBuilding / enterBuilding / buildingView)
//   is that request's start (_absorbExternal); one written after it began ends it. Lost requests resolve
//   {arrived:false, interrupted: 'pointer'|'wheel'|'key'|'gesture'|'api'|'cancelled'|'flight'|'superseded'|'external'}.
// Walkers stand on the final ground (analytic full-detail terrain, Ground.walkTerrainAt, + colliders / hulls),
//   never on the loaded tiles. buildingViews(id) also answers for the last buildingView / enterBuilding /
//   getFocusInfo buildings and refreshes itself in the background (city 'full' / kit anchors).
// Building-view bookmarks (fix round 3): the kit anchors come from a worker at VIEW_JOB_PRIORITY; a view the asset's
//   anchors do not provide (not generated within anchorWaitMs, or missing) lands on the bookmark's stored pose
//   (result source 'bookmark'). Eye-level outdoor views also avoid street trees (props.treesNear).
// Debug layer: settings.debugLayer 'wireframe' draws the walk colliders near the camera (never in clean mode).
// Walk colliders (city / mega getColliders(nearEcef, radius)): [{mesh (geometry.boundsTree = MeshBVH),
//   anchorEcef|anchor + quaternion | matrixWorld, id}] — see collide.js. Buildings that are visible but
//   have no collider yet (their 'full' LOD still loading) stay solid via the picking geometry.
// Events emitted: 'camera:transition' {phase:'start'|'end', duration?, from?, to?, mode?, arrived?},
//   'camera:arrive' {bookmark?, pose, mode}, 'controls:hint' {kind:'building-loading', id} (the walker
//   is held at a facade whose interior / walk colliders are still streaming in; at most every 4 s);
//   mode changes go through app.state.setMode ('mode').
//   While a flight carries a mode change (walk drop, focus, bookmark), state.mode already shows the
//   requested mode; an interrupted flight restores the actual mode.
// Systems used (all optional): terrain.raycast/heightAtLatLon/groundHeightAt/drawnTiles,
//   city.raycast/focusInfo/getBuilding/getColliders, mega.raycast/getColliders, workers 'buildingSpec'.
import * as THREE from 'three';
import { R, DEG, RAD } from '../core/constants.js';
import { origin } from '../core/origin.js';
import { ecefToLatLonH, latLonHToEcef, buildingAxes, enuBasis } from '../core/geo.js';
import { provinceAt, zoneAt } from '../data/controlMaps.js';
import { CameraRig } from './CameraRig.js';
import { Ground, MAX_ALT } from './ground.js';
import { Transition } from './transition.js';
import { OrbitMode, maxTilt, CLEAR } from './modes/orbit.js';
import { FlyMode } from './modes/fly.js';
import { WalkMode, WALK } from './modes/walk.js';
import { FocusMode, entrancePose, buildingCameras, specHeight, BUILDING_VIEWS, GROUND_VIEWS } from './modes/focus.js';
import { lookAtState, decompose, toEcefVec } from './lookat.js';
import { clamp, raySphere, signedAngle, quatLook, wrapPi, tangentBasis, easeInOut, quatAngle } from './math.js';
import { resolveSphere, raycastColliders, colliderMatrix } from './collide.js';

export { CONTROLS_HELP, CONTROLS_HELP_SECTIONS } from './help.js';
export { WALK } from './modes/walk.js';
export { BUILDING_VIEWS } from './modes/focus.js';

const NAV_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'KeyR', 'KeyF',
  'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'PageUp', 'PageDown', 'Space', 'KeyC', 'KeyN', 'KeyU',
]);
// digits are camera keys only in focus mode (1–5 orbit presets, 6–9 building viewpoints); in the other
// modes they belong to the UI (shot bookmarks 1–9), so they are neither consumed nor prevented here
const FOCUS_KEYS = new Set(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9']);
const HELD_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'KeyR', 'KeyF',
  'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'PageUp', 'PageDown', 'Space', 'KeyC'];
const MODE_CYCLE = ['orbit', 'fly', 'walk'];
/** clearance (m) a held programmatic pose keeps above the final floor (an eye-level pose is never lifted) */
const HOLD_CLEAR = 1.0;
/**
 * Worker-pool priority (lower runs first) of the single, cheap jobs a viewpoint request waits on (the kit's
 * camera anchors of one building ≈ 5–60 ms, a spec by id): ahead of the terrain camera chain (−2e6) and every
 * near terrain tile (−SSE ratio), behind the six roots (−3e6). At −100 they starved behind 300–400 terrain jobs
 * under load and cold bookmark landings fell back to spec stand-ins (fix round 3, CT1).
 */
const VIEW_JOB_PRIORITY = -2.5e6;
/** how long a bookmark landing waits for the kit's camera anchors before it lands on its stored pose (ms) */
const BOOKMARK_ANCHOR_WAIT = 60000;
const INTERACTIVE_ROLES = /^(button|link|tab|slider|menuitem|option|switch|radio|checkbox|listbox|combobox|spinbutton|textbox|searchbox)$/;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function isTyping(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** element inside the UI root (#mars-ui): the UI owns the keyboard while focus is there */
function inUi(t) {
  if (!t || t.nodeType !== 1 || typeof document === 'undefined') return false;
  const root = document.getElementById('mars-ui');
  return !!(root && root !== t && root.contains(t)) || (root === t);
}

/** a focused UI control that owns keyboard input (buttons, links, sliders, tabs, …) */
function isInteractive(t) {
  if (!t || !t.tagName || t === document.body || t === document.documentElement || t.tagName === 'CANVAS') return false;
  if (isTyping(t)) return true;
  const tag = t.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
  const role = t.getAttribute && t.getAttribute('role');
  return !!(role && INTERACTIVE_ROLES.test(role));
}

/** resolve a value / promise, or null after ms */
function withTimeout(v, ms) {
  if (!v || typeof v.then !== 'function') return Promise.resolve(v);
  let timer = 0;
  return Promise.race([v, new Promise((res) => { timer = setTimeout(() => res(null), ms); })]).finally(() => clearTimeout(timer));
}

/** ease in with unit end velocity (path segments) and ease out with unit start velocity */
const easeInV = (t) => { t = clamp(t, 0, 1); return t * t * (2 - t); };
const easeOutV = (t) => { t = clamp(t, 0, 1); return t + t * t - t * t * t; };
const linear = (t) => clamp(t, 0, 1);

/** Normalise city focus data (any of the tolerated shapes) into {center, radius, heading, spec, entrances}. */
export function normalizeFocusInfo(raw, spec) {
  let center = raw ? toEcefVec(raw.centerEcef || raw.center || raw.centre || null) : null;
  let radius = raw && Number.isFinite(raw.radius) ? raw.radius : null;
  spec = spec || (raw && raw.spec) || null;
  const heading = raw && Number.isFinite(raw.heading) ? raw.heading : spec && Number.isFinite(spec.heading) ? spec.heading : null;
  if ((!center || !(radius > 0)) && spec && Number.isFinite(spec.lat)) {
    const fl = spec.floors || 1, fh = spec.floorHeight || 3.1;
    const H = (fl - 1) * fh + (spec.groundFloorHeight || fh);
    const w = (spec.footprint && spec.footprint.w) || 20, d = (spec.footprint && spec.footprint.d) || 15;
    const g = (spec.ground && spec.ground.entrance) || 0;
    if (!center) { const p = latLonHToEcef(spec.lat, spec.lon, g + H / 2); center = new THREE.Vector3(p.x, p.y, p.z); }
    if (!(radius > 0)) radius = 0.5 * Math.hypot(w, d, H);
  }
  if (!center || !(radius > 0)) return null;
  return {
    center, radius, heading: heading ?? 0, spec, entrances: (raw && raw.entrances) || [],
    // optional extras: viewpoints (ECEF or building-local), BuildingMeshData anchors, explicit building frame
    cameras: (raw && raw.cameras) || null, anchors: (raw && raw.anchors) || null, frame: (raw && raw.frame) || null,
    raw: raw || null,
  };
}

/** the focus data carries the kit's own camera anchors (city 'full' / worker-generated), not only spec stand-ins */
function hasKitCameras(info) {
  if (!info) return false;
  const has = (o) => !!(o && typeof o === 'object' && Object.keys(o).length);
  return has(info.cameras) || has(info.anchors && info.anchors.cameras) || has(info.raw && info.raw.cameras);
}

/** the stored pose of a bookmark {lat, lon, alt, heading, pitch, lens?} when it is complete, else null */
function bookmarkPose(bm) {
  const p = bm && bm.pose;
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.alt) ? p : null;
}

/**
 * Viewpoint {pos, target, ground, source:'bookmark'} (ECEF Vector3s, like buildingCameras) of a bookmark's
 * stored pose: eye at its lat / lon / alt, looking along its heading / pitch (target 20 m ahead).
 */
function storedCamera(pose, name) {
  const e = latLonHToEcef(pose.lat, pose.lon, pose.alt);
  const pos = new THREE.Vector3(e.x, e.y, e.z);
  const B = enuBasis(pose.lat, pose.lon);
  const h = (Number.isFinite(pose.heading) ? pose.heading : 0) * DEG, p = (Number.isFinite(pose.pitch) ? pose.pitch : 0) * DEG;
  const f = new THREE.Vector3(...B.north).multiplyScalar(Math.cos(h)).addScaledVector(new THREE.Vector3(...B.east), Math.sin(h));
  f.multiplyScalar(Math.cos(p)).addScaledVector(new THREE.Vector3(...B.up), Math.sin(p)).normalize();
  return { pos, target: pos.clone().addScaledVector(f, 20), ground: GROUND_VIEWS.has(name), source: 'bookmark' };
}

/**
 * Trees near an eye-level viewpoint as obstacles in the eye's tangent plane (x east, y north, metres from
 * `pos`): props.treesNear (trees of the loaded prop tiles, fix round 3 CT2) → [{x, y, base, crownBase, top,
 * crownR, trunkR}] (heights above sea level; trunk radius as props/models.js: max(0.09, 0.026·H) plus the
 * root flare). [] when the props system has no tree data there.
 */
function treeObstacles(props, pos, e, n, r) {
  let list = [];
  try { list = (props && typeof props.treesNear === 'function' && props.treesNear({ x: pos.x, y: pos.y, z: pos.z }, r)) || []; } catch { list = []; }
  const out = [];
  for (const t of list) {
    const p = t && t.ecef;
    if (!p || !Number.isFinite(p.x) || !(t.height > 0)) continue;
    const dx = p.x - pos.x, dy = p.y - pos.y, dz = p.z - pos.z;
    const base = Math.hypot(p.x, p.y, p.z) - R;
    out.push({
      x: dx * e.x + dy * e.y + dz * e.z, y: dx * n.x + dy * n.y + dz * n.z,
      base, crownBase: base + (t.crownBase > 0 ? t.crownBase : t.height * 0.3), top: base + t.height,
      crownR: t.crownR > 0 ? t.crownR : 2, trunkR: Math.max(0.09, 0.026 * t.height) * 1.25,
    });
  }
  return out;
}

export class ControlsSystem {
  constructor(app) {
    this.app = app;
    this.ground = new Ground(app);
    this.backStack = [];
    this.maxBack = 64;
    this.transition = null;
    this.pendingMode = null;
    this.path = null;
    this.keys = new Set();
    this.pointers = new Map();
    this.drag = null;
    this.gesture = null;
    this.lockOnClick = true;
    this.enabled = true;
    this.modes = { orbit: new OrbitMode(this), fly: new FlyMode(this), walk: new WalkMode(this), focus: new FocusMode(this) };
    this.active = this.modes.orbit;
    this.focusDistance = 1e7;
    this.target = new THREE.Vector3();
    this._ray = { o: new THREE.Vector3(), d: new THREE.Vector3() };
    this._hag = { x: NaN, y: NaN, z: NaN, floor: 0 };
    this._ct = { vp: -1, vf: -1, precise: null, fast: null, fastV: new THREE.Vector3() };
    this._vp = null;
    this._lastClick = null;
    this._hoverReq = null; this._hoverT = 0; this._hoverKey = '';
    this._lastGood = null;
    this._lastRigVersion = -1;
    this._tmpRig = new CameraRig();
    this._warned = {};
    this._focusReq = null;            // pending focus / enter request {token, id, kind}
    this._focusToken = 0;
    this._specCache = new Map();
    this._viewActive = false;         // the 3D view (not the UI) is the keyboard surface: Tab cycles modes
    this._hold = null;                // programmatic pose being held (see _setHold)
    this.perf = { ms: 0, max: 0 };   // controls update cost (EMA / max), diagnostics only
  }

  get modeName() { return this.active.name; }
  /** live pointer-lock state (the change event is not delivered reliably everywhere) */
  get pointerLocked() { return !!this.el && typeof document !== 'undefined' && document.pointerLockElement === this.el; }
  get focusId() { return this.active.name === 'focus' ? this.modes.focus.id : null; }

  // ============================================================================== lifecycle
  async init() {
    const el = this.app.renderer.domElement;
    this.el = el;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    el.addEventListener('pointermove', (e) => this._onPointerMove(e));
    el.addEventListener('pointerup', (e) => this._onPointerUp(e, false));
    el.addEventListener('pointercancel', (e) => this._onPointerUp(e, true));
    el.addEventListener('pointerleave', (e) => { if (!this.pointers.has(e.pointerId)) this._clearHover(); });
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    el.addEventListener('dblclick', (e) => e.preventDefault());
    el.addEventListener('gesturestart', (e) => this._onSafariGesture(e, 'start'));
    el.addEventListener('gesturechange', (e) => this._onSafariGesture(e, 'move'));
    el.addEventListener('gestureend', (e) => this._onSafariGesture(e, 'end'));
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
    window.addEventListener('blur', () => this._releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._releaseAll(); });
    document.addEventListener('pointerlockchange', () => this._onLockChange());
    // keyboard focus moving into a UI control: held camera keys are released (their keyup may be
    // swallowed by the UI, e.g. while typing in the search box) and Tab goes back to focus navigation
    document.addEventListener('focusin', (e) => {
      const t = e.target;
      if (t && t !== el && t !== document.body && t !== document.documentElement) { this.keys.clear(); this._viewActive = false; }
    });
    // Tab cycles camera modes only while the 3D view is the active surface (after a pointer press or
    // wheel on it, or under pointer lock); any press elsewhere returns Tab to keyboard navigation
    window.addEventListener('pointerdown', (e) => { if (e.target !== el) this._viewActive = false; }, true);
    this._makeOverlay();
    this._lastGood = this.app.rig.snapshot();
    this.active.enter({});
    this._markInternal();
  }

  isIdle() { return !this.transition && !this.path && !this._focusReq && !(this.active.isMoving && this.active.isMoving()); }

  update(frame) {
    if (!frame || !frame.pre) { this._post(frame); return; }
    const t0 = performance.now();
    this._inUpdate = true;
    try { this._update(frame); } finally { this._inUpdate = false; }
    const ms = performance.now() - t0;
    this.perf.ms = this.perf.ms * 0.95 + ms * 0.05;
    if (ms > this.perf.max) this.perf.max = ms;
  }

  _update(frame) {
    const rig = this.app.rig;
    const dt = clamp(frame.dt || 0, 0, 0.1);
    this._vp = null;
    this._absorbExternal(true);
    this._processHover();
    if (this.gesture && this.gesture.dirty) { this.gesture.dirty = false; this._gestureMove(); }
    if (this.transition) {
      let done = false;
      try { done = this.transition.update(dt, rig); } catch (e) { console.error('[controls] transition', e); this.transition.applyFinal(rig); done = true; }
      if (done) this._arrive();
    } else if (this.enabled) {
      try { this.active.update(dt); } catch (e) { if (!this._warned.upd) { console.error('[controls] update', e); this._warned.upd = true; } }
    }
    this._safety();
    this._updateFocus();
    this._refreshFocusViews();
    this._lastRigVersion = rig.version;
    this._inputSeen = false;
  }

  /**
   * Process a camera pose written from outside (URL pose, bookmark, __MARS__.goto, UI) since the last
   * controls update: hold it, sync the active mode, end flights / requests it overrides. Called by
   * update() and — so a pose written just before a request is that request's start, not an interruption
   * of it (QS-03: a bookmark's provisional pose written in the same task as its building-view flight
   * used to end that flight on the next frame) — by the entry points flyTo / setMode / focus requests.
   * Writes made by the controls themselves during update() are internal (update marks them at its end).
   */
  _absorbExternal(fromUpdate = false) {
    const v = this.app.rig.version;
    if (this._lastRigVersion < 0 || v === this._lastRigVersion || this._inExternal) return false;
    if (this._inUpdate && !fromUpdate) return false;
    this._lastRigVersion = v;
    this._inExternal = true;
    try { this._externalChange(); } finally { this._inExternal = false; }
    this._lastRigVersion = this.app.rig.version;
    return true;
  }

  // ============================================================================== geometry helpers
  viewport() {
    if (this._vp) return this._vp;
    const r = this.el ? this.el.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    this._vp = { left: r.left, top: r.top, width: r.width || 1, height: r.height || 1 };
    return this._vp;
  }
  aspect() { const v = this.viewport(); return v.width / v.height; }

  /** camera ray through client (x, y) (screen centre when omitted). Shared result object. */
  rayAt(x, y, out = this._ray) {
    const vp = this.viewport();
    const nx = x === undefined ? 0 : ((x - vp.left) / vp.width) * 2 - 1;
    const ny = y === undefined ? 0 : -(((y - vp.top) / vp.height) * 2 - 1);
    const rig = this.app.rig;
    out.o.set(rig.position.x, rig.position.y, rig.position.z);
    rig.ndcRay(nx, ny, vp.width / vp.height, out.d);
    return out;
  }

  /** CONTRACT: render-space ray through client coordinates */
  screenRay(cx, cy) {
    const r = this.rayAt(cx, cy);
    return { origin: new THREE.Vector3(r.o.x - origin.x, r.o.y - origin.y, r.o.z - origin.z), dir: r.d.clone() };
  }

  groundRefHeight() { return this.ground.refHeight(this.app.rig.position); }

  /** height of the camera above terrain / water / roofs (floor cached within a small tolerance) */
  heightAboveGround(refresh = false) {
    const p = this.app.rig.position, c = this._hag;
    const L = Math.hypot(p.x, p.y, p.z);
    const tol = Math.max(0.01, (L - R - c.floor) * 0.002);
    if (!refresh && Math.abs(p.x - c.x) <= tol && Math.abs(p.y - c.y) <= tol && Math.abs(p.z - c.z) <= tol) return L - R - c.floor;
    const floor = this.ground.floorHeightAt(p);
    c.x = p.x; c.y = p.y; c.z = p.z; c.floor = floor;
    return L - R - floor;
  }

  /** visible surface at the screen centre (precise: raycast; else sphere), null when looking past the planet */
  centerTarget(precise = true) {
    const rig = this.app.rig;
    if (!precise) return this.centerTargetFast();
    if (this._ct.vp === rig.version) return this._ct.precise;
    const ray = this.rayAt();
    const hit = this.ground.raycast(ray.o, ray.d);
    let T = hit ? hit.point : null;
    if (!T) { const f = this.centerTargetFast(); T = f ? f.clone() : null; }
    this._ct.vp = rig.version; this._ct.precise = T;
    return T;
  }

  centerTargetFast() {
    const rig = this.app.rig;
    if (this._ct.vf === rig.version) return this._ct.fast;
    const ray = this.rayAt();
    const t = raySphere(ray.o, ray.d, R + this.groundRefHeight());
    this._ct.vf = rig.version;
    this._ct.fast = t >= 0 ? this._ct.fastV.copy(ray.d).multiplyScalar(t).add(ray.o) : null;
    return this._ct.fast;
  }

  /** target point used to parameterise a pose for transitions (ground hit near the view axis, else virtual) */
  poseTarget(P, Q, info = null) {
    _f.set(0, 0, -1).applyQuaternion(Q);
    const L = P.length();
    const hRef = L - R < 60000 ? this.ground.terrainHeightAt(P, Math.max(0.05, (L - R) * 0.01)) : 0;
    const hAG = Math.max(0.5, L - R - Math.max(hRef, 0));
    // info: {virtual (no ground hit near the view axis), hAG (above terrain / water / floors below P)}
    if (info) {
      let floor = 0;
      try { floor = L - R < 45000 ? this.ground.floorHeightAt(P, { roofProbe: 0.3 }) : 0; } catch { floor = Math.max(hRef, 0); }
      info.hAG = Math.max(0.3, L - R - floor);
      info.virtual = false;
    }
    const t = raySphere(P, _f, R + Math.max(hRef, 0));
    if (t > 0 && t < Math.max(30 * hAG, 60)) {
      const T = new THREE.Vector3().copy(_f).multiplyScalar(t).add(P);
      // (the path parameterisation needs metre accuracy only for near targets: far ones use the tiles)
      const hT = this.ground.terrainHeightAt(T, Math.max(0.1, t * 0.001), t < 3000 ? 'auto' : false);
      const t2 = raySphere(P, _f, R + Math.max(hT, 0));
      if (t2 > 0 && t2 < Math.max(30 * hAG, 60) * 1.5) T.copy(_f).multiplyScalar(t2).add(P);
      return T;
    }
    if (info) info.virtual = true;
    const Dv = clamp(8 * hAG, 12, 2e7);
    return new THREE.Vector3().copy(_f).multiplyScalar(Dv).add(P);
  }

  anyNavKey() { for (const k of HELD_KEYS) if (this.keys.has(k)) return true; return false; }
  collidersNear(p, radius) { return this.ground.collidersNear(p, radius); }

  /**
   * Move the camera along the line to anchor A so that its distance scales by e^(−s) (s > 0 = in),
   * keeping A at the same screen position. Stops minDist from A, `clearance` above the floor and
   * below MAX_ALT. Returns {applied, clamped}.
   */
  zoomTowards(A, s, { minDist = CLEAR, clearance = CLEAR, water = true } = {}) {
    const rig = this.app.rig, p = rig.position;
    const Vx = p.x - A.x, Vy = p.y - A.y, Vz = p.z - A.z;
    const D = Math.hypot(Vx, Vy, Vz);
    if (!(D > 1e-9) || !Number.isFinite(s)) return { applied: 0, clamped: true, clampedBy: 'dist' };
    let k = Math.exp(-s), clamped = false, clampedBy = null;
    if (s > 0) { const kmin = minDist / D; if (k < kmin) { k = kmin; clamped = true; clampedBy = 'dist'; if (k >= 1) return { applied: 0, clamped: true, clampedBy }; } }
    const VV = D * D, AV = A.x * Vx + A.y * Vy + A.z * Vz, AA = A.x * A.x + A.y * A.y + A.z * A.z;
    const largerRoot = (rr) => { const disc = AV * AV - VV * (AA - rr * rr); if (disc < 0) return null; return (-AV + Math.sqrt(disc)) / VV; };
    // ceiling
    let nx = A.x + Vx * k, ny = A.y + Vy * k, nz = A.z + Vz * k;
    let L = Math.hypot(nx, ny, nz);
    if (L > R + MAX_ALT) { const kr = largerRoot(R + MAX_ALT); if (kr != null && kr < k) { k = Math.max(kr, 0); clamped = true; clampedBy = 'ceiling'; } }
    // floor (zooming in)
    if (s > 0) {
      for (let it = 0; it < 2; it++) {
        nx = A.x + Vx * k; ny = A.y + Vy * k; nz = A.z + Vz * k;
        L = Math.hypot(nx, ny, nz);
        _v.set(nx, ny, nz);
        const floor = this.ground.floorHeightAt(_v, water ? undefined : { water: false });
        const rmin = R + floor + clearance;
        if (L >= rmin - 1e-6) break;
        clamped = true; clampedBy = 'floor';
        const Lp = Math.hypot(p.x, p.y, p.z);
        if (Lp <= rmin) { k = 1; break; }
        const kr = largerRoot(rmin);
        k = kr == null ? 1 : clamp(kr, k, 1);
      }
    }
    rig.setPosition(A.x + Vx * k, A.y + Vy * k, A.z + Vz * k);
    return { applied: -Math.log(k), clamped, clampedBy };
  }

  /**
   * Keep the camera's move since P0 clear of buildings / megastructures: swept ray along the move
   * (stops `clearance` before a surface) and, near the ground, a sphere push-out against colliders.
   * Returns true when the move was shortened.
   */
  sweepFrom(P0, clearance = 1.0) {
    const rig = this.app.rig, p = rig.position;
    const dx = p.x - P0.x, dy = p.y - P0.y, dz = p.z - P0.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    const hAG = this.heightAboveGround();
    if (hAG > 2500 && len < hAG * 0.5) return false;
    _v2.set(p.x, p.y, p.z);
    const f = this.ground.sweep(P0, _v2, clearance, { terrain: len > 50 });
    let blocked = false;
    if (f < 1) { rig.setPosition(P0.x + dx * f, P0.y + dy * f, P0.z + dz * f); blocked = true; }
    if (hAG < 300) {
      const cols = this.collidersNear(p, 25);
      if (cols.length) {
        _v.set(p.x - origin.x, p.y - origin.y, p.z - origin.z);
        rig.localUp(_up);
        const info = this._sphereInfo || (this._sphereInfo = {});
        resolveSphere(cols, _v, clearance * 0.9, _up, info, 3);
        if (info.hits) { rig.setPosition(_v.x + origin.x, _v.y + origin.y, _v.z + origin.z); blocked = true; }
      }
    }
    return blocked;
  }

  /**
   * Surface a walker would stand on below ECEF point p (an eye or feet position), searched within
   * [p − maxDown, p + probeUp]: the highest of the terrain, the water surface, the walkable surfaces
   * of the walk colliders around p (city / mega getColliders: floors, stairs, roofs, decks — what walk
   * mode stands on) and, for buildings whose colliders have not streamed in yet, their picking hull.
   * Unlike floorHeightAt (camera clearance, roofs seen from above) this finds the floor of the storey
   * the point is in. Returns {h (m above sea level), kind: 'terrain'|'water'|'collider'|'building'|'mega', deep}.
   */
  walkFloorBelow(p, { maxDown = 8, probeUp = 0.3, analytic = false } = {}) {
    const G = this.ground;
    const P = new THREE.Vector3(p.x, p.y, p.z);
    const L = P.length(), up = P.clone().multiplyScalar(1 / L), pH = L - R;
    // terrain: always the final full-detail world height (a walker never stands on a coarse tile, Z-02);
    // analytic: also the hydro water surface instead of the displayed tiles' water — for programmatic poses
    const A = analytic ? G.analyticAt(P) : null;
    const tH = A ? A.terrain : G.walkTerrainAt(P, 0.01);
    const out = { h: tH, kind: 'terrain', deep: false };
    const wl = A ? A.water : G.waterLevelAt(P, 0.25);
    if (wl > tH) { out.deep = wl - tH > 0.6; out.h = wl; out.kind = 'water'; }
    if (!(pH - out.h > 0.05) || pH - out.h > 400) return out;
    const lo = pH - maxDown;
    let best = -Infinity, bestKind = null;
    const cols = this.collidersNear(P, 4);
    if (cols.length) {
      const o = new THREE.Vector3(P.x - origin.x, P.y - origin.y, P.z - origin.z).addScaledVector(up, probeUp);
      const dn = up.clone().negate();
      const cos = this.modes.walk.cosSlope;
      // the first walkable surface below (steep faces — railings, sloped sills — are stepped through)
      let start = 0;
      for (let k = 0; k < 4; k++) {
        const hit = raycastColliders(cols, o, dn, probeUp + maxDown - start, {});
        if (!hit) break;
        if (hit.normal.dot(up) >= cos) { best = pH + probeUp - start - hit.distance; bestKind = 'collider'; break; }
        start += hit.distance + 0.02;
        o.addScaledVector(dn, hit.distance + 0.02);
      }
    }
    if (bestKind == null) {
      // no walk colliders below yet: the picking hull of the building / megastructure stands in
      const ids = new Set(cols.filter((c) => c._src === 'city' && c.id != null).map((c) => String(c.id)));
      const megaCols = cols.some((c) => c._src === 'mega');
      const hb = G.hullBelow(P, probeUp, maxDown, (kind, id) => (kind === 'building' && id != null && ids.has(String(id))) || (kind === 'mega' && megaCols));
      if (hb) { best = hb.h; bestKind = hb.kind; }
    }
    if (bestKind && best >= lo && best > out.h) { out.h = best; out.kind = bestKind; out.deep = false; }
    return out;
  }

  /** eye height above the surface a walker would stand on below the camera (walkFloorBelow) */
  eyeAboveWalkFloor(maxDown = 12) {
    const p = this.app.rig.position;
    return Math.hypot(p.x, p.y, p.z) - R - this.walkFloorBelow(p, { maxDown }).h;
  }

  /**
   * push the camera up to `clearance` above the floor; returns the push distance. opts.water false:
   * the water surface is no floor (fly mode dives). A held programmatic pose (see _setHold) is kept at
   * its requested position against the final ground instead (lifted only while something is below it).
   */
  clampAbove(clearance = CLEAR, opts = {}) {
    const rig = this.app.rig, p = rig.position;
    if (this._hold && this._holdOn(p)) return this._clampHeld(Math.min(clearance, HOLD_CLEAR), opts.water !== false);
    const L = Math.hypot(p.x, p.y, p.z);
    if (L - R > 45000 + clearance) return 0;
    const floor = this.ground.floorHeightAt(p, opts.water === false ? { water: false } : undefined);
    const c = this._hag; c.x = p.x; c.y = p.y; c.z = p.z; c.floor = floor;
    const minL = R + floor + clearance;
    if (L < minL) { const k = minL / L; rig.setPosition(p.x * k, p.y * k, p.z * k); c.x = p.x; c.y = p.y; c.z = p.z; return minL - L; }
    return 0;
  }

  // ============================================================================== programmatic pose hold
  /**
   * Remember the camera's current position as a REQUESTED (programmatic) pose — URL pose, bookmark,
   * __MARS__.goto, building / megastructure view, any flyTo arrival (D6). Until user input releases
   * it (interrupt(), a new flight) the camera is kept there against the FINAL ground: the analytic
   * terrain + water surface (world functions, never the coarse tiles that are loaded at the moment)
   * and the buildings / megastructures below it (walk colliders where streamed, else picking hulls).
   * A coarse structure LOD below the pose may lift it temporarily; it returns to the requested
   * position as soon as the refined floor allows (re-measured every 60 ms while lifted, 250 ms
   * otherwise). walk: a walking pose computed from final geometry (building-view anchors / analytic
   * ground, flyTo opts.holdWalk; or an eye-level external pose while walking) — the walker stands
   * exactly there, untouched by streaming colliders, until user input (WalkMode._freeze).
   */
  _setHold(src, walk = false) {
    const p = this.app.rig.position;
    const L = Math.hypot(p.x, p.y, p.z);
    if (!(L > 1) || L - R > 45000) { this._hold = null; return null; }
    this._hold = { src, walk: !!walk, pos: new THREE.Vector3(p.x, p.y, p.z), L, t0: performance.now(), lifted: 0, floor: [null, null], floorT: [-1e9, -1e9] };
    return this._hold;
  }

  /** forget the held pose (user input took over) */
  releaseHold() { this._hold = null; }

  /** the camera is still on the vertical line of the held pose (anything else moved it: hold dropped) */
  _holdOn(p) {
    const H = this._hold;
    if (!H) return false;
    const L = Math.hypot(p.x, p.y, p.z) || 1;
    const k = (p.x * H.pos.x + p.y * H.pos.y + p.z * H.pos.z) / (L * H.L);
    // horizontal offset ≈ R·angle (atan2 form: resolves millimetres at the planet scale)
    const cx = p.y * H.pos.z - p.z * H.pos.y, cy = p.z * H.pos.x - p.x * H.pos.z, cz = p.x * H.pos.y - p.y * H.pos.x;
    const off = Math.atan2(Math.hypot(cx, cy, cz) / (L * H.L), k) * R;
    if (off > 0.02) { this._hold = null; return false; }
    return true;
  }

  /** floor (m above sea level) under the held pose: final ground (+ water unless water=false) and structures below */
  _holdFloor(H, water = true) {
    const i = water ? 0 : 1, now = performance.now();
    if (H.floor[i] != null && now - H.floorT[i] < (H.lifted > 0 ? 60 : 250)) return H.floor[i];
    const a = this.ground.analyticAt(H.pos);
    let h = water ? a.h : a.terrain;
    const pH = H.L - R;
    if (pH - h < 1500) {
      let s = -Infinity;
      try { s = this.ground.structureBelow(H.pos, Math.min(pH - h + 0.5, 1500), 0.3); } catch { s = -Infinity; }
      if (s > h) h = s;
    }
    H.floor[i] = h; H.floorT[i] = now;
    return h;
  }

  /** place the camera at the held pose, or `clear` above the floor under it when that is higher */
  _clampHeld(clear, water = true) {
    const H = this._hold, rig = this.app.rig, p = rig.position;
    const floor = this._holdFloor(H, water);
    const minL = R + floor + clear;
    const k = H.L >= minL ? 1 : minL / H.L;
    H.lifted = k > 1 ? minL - H.L : 0;
    const x = H.pos.x * k, y = H.pos.y * k, z = H.pos.z * k;
    const L = Math.hypot(p.x, p.y, p.z);
    if (Math.abs(x - p.x) + Math.abs(y - p.y) + Math.abs(z - p.z) > 1e-7) rig.setPosition(x, y, z);
    return Math.max(0, k * H.L - L);
  }

  /**
   * ECEF eye position p stands at eye level over the final floor below it (analytic terrain / water,
   * colliders, hulls): at least ~1 m and at most 8 m above it. A pose BELOW the final ground (e.g. made on
   * an older terrain) is no walking pose to hold: the walker stands on the ground there instead.
   */
  _eyeLevelPose(p) {
    const above = Math.hypot(p.x, p.y, p.z) - R - this.walkFloorBelow(p, { maxDown: 12, analytic: true }).h;
    return above > WALK.eye - 0.6 && above < 8;
  }

  /** feet height (m above sea level) of a held walking pose while walking, else null */
  walkHoldFeet() {
    const H = this._hold;
    if (!H || !H.walk || this.active !== this.modes.walk) return null;
    if (!this._holdOn(this.app.rig.position)) return null;
    return H.L - R - WALK.eye;
  }

  /** the held pose, for diagnostics: {src, walk, lifted (m), requested: {lat, lon, alt}} | null */
  holdInfo() {
    const H = this._hold;
    if (!H) return null;
    const g = ecefToLatLonH(H.pos.x, H.pos.y, H.pos.z);
    return { src: H.src, walk: H.walk, lifted: H.lifted, ageMs: performance.now() - H.t0, requested: { lat: g.lat, lon: g.lon, alt: g.h } };
  }

  /**
   * Keep the horizon level: bring the camera's right vector into the local horizontal plane.
   * kind 'minimal' (orbit/focus): the smallest rotation doing so — a camera-space yaw when looking
   * down (removes sideways tilt, keeps screen-up), a roll when looking at the horizon; continuous
   * everywhere (no nadir threshold). kind 'roll' (fly horizon lock): pure roll about the view axis.
   * With `pivot` the rotation is rigid about that point, which keeps its screen position.
   */
  levelRoll(maxStep = Infinity, pivot = null, kind = 'minimal') {
    const rig = this.app.rig;
    for (let it = 0; it < (pivot ? 6 : 1); it++) {
      rig.localUp(_up); rig.right(_v);
      const ru = _v.dot(_up);
      if (Math.abs(ru) < 1e-10) return;
      if (kind === 'roll') {
        rig.forward(_f);
        if (Math.abs(_f.dot(_up)) > 0.99939) return; // within 2° of the vertical: roll == heading
        _r.crossVectors(_f, _up).normalize();
        let ang = signedAngle(_v, _r, _f);
        if (Math.abs(ang) < 1e-10) return;
        if (Math.abs(ang) > maxStep) ang = Math.sign(ang) * maxStep;
        _q.setFromAxisAngle(_f, ang);
      } else {
        _r.copy(_v).addScaledVector(_up, -ru);
        if (_r.lengthSq() < 1e-12) return;
        _r.normalize();
        _q.setFromUnitVectors(_v, _r);
        const ang = Math.asin(clamp(Math.abs(ru), 0, 1));
        if (ang > maxStep) { _q2.identity().slerp(_q, maxStep / ang); _q.copy(_q2); }
      }
      if (pivot) rig.rotateAbout(pivot, _q); else rig.rotateInPlace(_q);
    }
  }

  // ============================================================================== modes
  /** CONTRACT: switch camera mode. Returns false when the mode cannot be entered (e.g. focus without a building). */
  setMode(name, opts = {}) {
    if (!this.modes[name]) { console.warn(`[controls] unknown mode ${name}`); return false; }
    // (a pose written just before — URL pose + &mode=walk — is held before the mode is entered)
    this._absorbExternal();
    if (this.transition && !opts.immediate) {
      if (name === 'focus' && this._focusIdFrom(opts) == null) return false;
      this.pendingMode = { name, opts };
      if (opts.bookmark) this.transition.bookmark = opts.bookmark;
      this._showMode(name);
      return true;
    }
    return this._switchMode(name, opts);
  }

  cycleMode(dir = 1) {
    const cur = this.active.name === 'focus' ? 'orbit' : this.active.name;
    const i = MODE_CYCLE.indexOf(cur);
    const next = MODE_CYCLE[(i + (dir > 0 ? 1 : MODE_CYCLE.length - 1)) % MODE_CYCLE.length];
    return this.setMode(next);
  }

  /** the mode shown to the UI (state.mode): the requested mode while a flight carries it */
  _showMode(name) { if (this.app.state.mode !== name) this.app.state.setMode(name); }

  /** building to focus: explicit id, bookmark building, the selected building, or (already in focus) the current one */
  _focusIdFrom(opts = {}) {
    const sel = this.app.state.selection;
    return opts.id ?? opts.buildingId ?? (opts.bookmark && opts.bookmark.buildingId) ??
      (sel && sel.type === 'building' ? (sel.id ?? (sel.spec && sel.spec.id)) : null) ??
      (this.active.name === 'focus' ? this.modes.focus.id : null) ?? null;
  }

  _switchMode(name, opts = {}) {
    const cur = this.active.name;
    if (name === 'focus') {
      const id = this._focusIdFrom(opts);
      if (id == null) { this._showMode(cur); return false; } // nothing to orbit (the UI explains it)
      if (opts.bookmark || opts.keepPose) this.focusBuilding(id, { keepPose: true, spec: opts.spec, pushBack: false });
      else this.focusBuilding(id, { pushBack: opts.pushBack, spec: opts.spec });
      return true;
    }
    if (name === cur && !opts.force) { this._showMode(cur); return true; }
    if (opts.pushBack !== false) this.pushBack();
    // (the floor of the storey the camera is in counts: walking starts upstairs inside a building)
    if (name === 'walk' && !opts.instant && this.eyeAboveWalkFloor() > 4) { this._dropToWalk(cur === 'fly' ? 'below' : 'centre'); return true; }
    this._enterMode(name, opts);
    return true;
  }

  _enterMode(name, opts = {}) {
    if (this.drag) { this.active.onDragEnd?.(false); this.drag = null; }
    this.active.exit?.();
    let m = this.modes[name];
    this.active = m;
    // an eye-level pose written from outside and then switched to walking (URL pose + &mode=walk, a
    // bookmark pose with mode 'walk'): the walker stands exactly there until user input, like an
    // eye-level pose written while walking (see _externalChange)
    const H = this._hold;
    if (name === 'walk' && H && !H.walk && H.src === 'external' && this._holdOn(this.app.rig.position) && this._eyeLevelPose(this.app.rig.position)) H.walk = true;
    const ok = m.enter?.(opts);
    if (ok === false) { m = this.active = this.modes.orbit; m.enter({}); name = 'orbit'; }
    if (name !== 'walk' && name !== 'fly') this._exitLock();
    this.app.state.setMode(name);
    this._updateOverlay();
    this._markInternal();
  }

  /**
   * → walk: fly down to a standing spot. where 'centre': the visible surface at the screen centre
   * (when it is reasonably near), 'below': under the camera. Wall hits stand in front of the wall,
   * roof / deck hits stand on them.
   */
  _dropToWalk(where = 'centre') {
    const rig = this.app.rig;
    const P = new THREE.Vector3(rig.position.x, rig.position.y, rig.position.z);
    const hAG = this.heightAboveGround(true);
    let T = null;
    if (where === 'centre') {
      const ray = this.rayAt();
      const hit = this.ground.raycast(ray.o, ray.d);
      if (hit && hit.distance < Math.max(25 * hAG, 600)) {
        T = hit.point.clone();
        if (hit.kind === 'building' || hit.kind === 'mega') T = this._standPointNear(T, ray.d);
        else T = this._walkGroundPoint(T);   // the drawn tile may still be coarse: stand on the final ground
      }
    }
    if (!T) {
      // straight down: the floor / roof / deck below the camera (the storey floor inside a building)
      const L = P.length();
      const wf = this.walkFloorBelow(P, { maxDown: clamp(hAG + 5, 12, 3000) });
      T = P.clone().multiplyScalar((R + wf.h) / L);
    }
    // never stand in deep water: walk to the nearest dry ground (towards the camera first)
    if (this._dryHeight(T) == null) {
      rig.localUp(_up); rig.forward(_f);
      const back = _f.clone().addScaledVector(_up, -_f.dot(_up));
      const dry = this._dryPointNear(T, back.lengthSq() > 1e-10 ? back.normalize().negate() : null);
      if (!dry) { console.warn('[controls] no dry ground near the drop point'); this._showMode(this.active.name); return Promise.resolve({ arrived: false }); }
      T = dry;
    }
    const st = this._standState(T, null, -2);
    // keep the current compass direction
    rig.forward(_f); rig.localUp(_up);
    _v.copy(_f).addScaledVector(_up, -_f.dot(_up));
    if (_v.lengthSq() < 1e-8) { rig.up(_v); _v.addScaledVector(_up, -_v.dot(_up)); }
    const upT = T.clone().normalize();
    st.quaternion.copy(this._eyeQuat(upT, _v.lengthSq() > 1e-12 ? _v.normalize() : null, -2 * DEG));
    return this.flyTo({ position: st.position, quaternion: st.quaternion, ...this._eyeLens() }, { pushBack: false, mode: 'walk' });
  }

  /** terrain height at p when it is walkable (water there, if any, at most 0.5 m deep), else null */
  _dryHeight(p) {
    const G = this.ground;
    const tH = G.walkTerrainAt(p, 0.05);
    const wl = G.waterLevelAt(p, 0.5);
    return wl - tH > 0.5 ? null : tH;
  }

  /** nearest walkable ground around T: along `dir` first (≤ 3 km), then a ring search (≤ 2 km). ECEF or null. */
  _dryPointNear(T, dir) {
    const up = new THREE.Vector3().copy(T).normalize();
    const e = new THREE.Vector3(), n = new THREE.Vector3(); tangentBasis(up, e, n);
    const p = new THREE.Vector3();
    const march = (d, maxD, step) => {
      for (let s = step; s <= maxD; s += step) {
        p.copy(T).addScaledVector(d, s);
        const h = this._dryHeight(p);
        if (h != null) { p.addScaledVector(d, 2); const h2 = this._dryHeight(p); return p.clone().multiplyScalar((R + (h2 ?? h)) / p.length()); }
      }
      return null;
    };
    if (dir) { const r = march(dir, 3000, 15); if (r) return r; }
    const d = new THREE.Vector3();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      d.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(e, Math.sin(a));
      const r = march(d, 2000, 40);
      if (r) return r;
    }
    return null;
  }

  /** standing point for a building / megastructure hit: on it when it is a roof or deck, else in front of it */
  _standPointNear(T, dir) {
    const up = _up.copy(T).normalize();
    _v.copy(dir).addScaledVector(up, -dir.dot(up));
    if (_v.lengthSq() < 1e-10) return T;
    _v.normalize();
    // roof / deck: the floor 0.3 m above the hit point is the hit itself
    _v2.copy(T).addScaledVector(up, 0.05);
    const onTop = this.ground.floorHeightAt(_v2, { water: true });
    if (Math.abs(onTop - (T.length() - R)) < 0.25) return T;
    const back = T.clone().addScaledVector(_v, -1.2);
    // in front of the wall: the walk floor below (final terrain / water, kerbs, decks, lower roofs)
    const top = back.clone().multiplyScalar((T.length() + 0.3) / back.length());
    const gH = this.ground.walkTerrainAt(top, 0.05);
    const h = this.walkFloorBelow(top, { maxDown: Math.max(4, top.length() - R - gH + 2), probeUp: 0 }).h;
    return back.multiplyScalar((R + h) / back.length());
  }

  /**
   * T (a hit on the drawn terrain / water / a street collider) moved onto the surface a walker stands
   * on there: the final terrain or water surface, or a walkable collider within ±1.2 m (the drawn tile
   * may still be coarse, metres off the real ground: Z-02)
   */
  _walkGroundPoint(T) {
    const L = T.length(), up = T.clone().multiplyScalar(1 / L);
    // probe around the FINAL ground there (a collider seated on a coarse tile far above it is ignored)
    const hA = this.ground.walkTerrainAt(T, 0.05);
    const wf = this.walkFloorBelow(up.clone().multiplyScalar(R + hA + 1.2), { maxDown: 2.6, probeUp: 0 });
    return up.multiplyScalar(R + wf.h);
  }

  /** eye state standing at surface point T (feet on T's height), looking along hv (or north) */
  _standState(T, hv, pitchDeg = 0) {
    const up = new THREE.Vector3().copy(T).normalize();
    const feet = T.clone();
    const eye = feet.addScaledVector(up, WALK.eye);
    let dir = hv;
    if (!dir) { const e = new THREE.Vector3(), n = new THREE.Vector3(); tangentBasis(up, e, n); dir = n; }
    return { position: eye, quaternion: this._eyeQuat(up, dir, pitchDeg * DEG) };
  }

  _eyeQuat(up, hv, pitch) {
    const h = new THREE.Vector3();
    if (hv) h.copy(hv).addScaledVector(up, -hv.dot(up));
    if (h.lengthSq() < 1e-12) tangentBasis(up, _v2, h);
    h.normalize();
    const f = h.multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize();
    return quatLook(f, up, new THREE.Quaternion());
  }

  // ============================================================================== transitions
  /** CONTRACT: animated camera flight. Resolves {arrived:true} on arrival, {arrived:false} when interrupted. */
  flyTo(target, opts = {}) {
    // a pose written from outside just before this call (a bookmark's provisional pose) is where this
    // flight starts, not an external change that would end it on the next frame (QS-03)
    this._absorbExternal();
    const dest = this.resolveTarget(target);
    if (!dest) return Promise.resolve({ arrived: false });
    const { pushBack = true } = opts;
    let duration = opts.duration;
    if (!opts._path) this._cancelPath();
    // a flight that supersedes another one keeps the back entry of the first (its start pose), not
    // the mid-air pose it was interrupted at
    if (pushBack && !this.transition) this.pushBack();
    this._endTransition(false, 'superseded', true);
    this._hold = null;   // the flight takes over; its arrival is held again (_arrive)
    this._cancelFocusReq(false, 'flight');
    this.active.stop?.();
    this._endDrags();
    const rig = this.app.rig;
    const from = { position: new THREE.Vector3(rig.position.x, rig.position.y, rig.position.z), quaternion: rig.quaternion.clone(), lens: rig.lens, fov: rig.fov };
    // already there (e.g. back() to the pose a mode switch started from): arrive on the next frame
    if (from.position.distanceTo(dest.position) < 1e-3 && quatAngle(from.quaternion, dest.quaternion) < 1e-6 &&
      (from.lens || null) === (dest.lens || null) && (dest.lens || Math.abs((from.fov || 35) - (dest.fov || from.fov || 35)) < 1e-9)) duration = 0;
    // orbit about a fixed point (a building centre): both ends parameterised around it
    const orbitC = toEcefVec(opts.orbit || target.orbit || null);
    let tr;
    try { tr = new Transition(this, from, dest, { duration: duration ?? undefined, ease: opts.ease, ...(orbitC ? { targetFrom: orbitC, targetTo: orbitC.clone(), kind: 'arc' } : {}) }); }
    catch (e) {
      console.error('[controls] flyTo failed, jumping', e);
      rig.setPosition(dest.position.x, dest.position.y, dest.position.z); rig.quaternion.copy(dest.quaternion);
      if (dest.lens) rig.lens = dest.lens; else if (dest.fov) { rig.lens = null; rig.fov = dest.fov; }
      rig.touch(); this._markInternal();
      return Promise.resolve({ arrived: true });
    }
    tr.mode = opts.mode ?? dest.mode ?? null;
    tr.modeOpts = opts.modeOpts ?? {};
    tr.bookmark = opts.bookmark ?? null;
    // a walking destination computed from final geometry (building-view anchors, analytic ground): the
    // arrival keeps the walker exactly there until user input (see _setHold / WalkMode._freeze)
    tr.holdWalk = !!opts.holdWalk;
    tr.waypoint = !!opts._waypoint;   // intermediate flyPath target: no mode switch, no camera:arrive
    this.pendingMode = null;
    this.transition = tr;
    this._showMode(tr.mode || opts._shown || this.active.name);
    const g0 = ecefToLatLonH(from.position.x, from.position.y, from.position.z);
    const g1 = ecefToLatLonH(dest.position.x, dest.position.y, dest.position.z);
    this.app.events.emit('camera:transition', { phase: 'start', duration: tr.duration, from: { lat: g0.lat, lon: g0.lon, alt: g0.h }, to: { lat: g1.lat, lon: g1.lon, alt: g1.h }, mode: tr.mode });
    return new Promise((resolve) => { tr.resolve = resolve; });
  }

  /**
   * CONTRACT: interruptible camera move through several targets (shot-card motions, routes):
   * flies segment by segment without stopping at the waypoints (ease in → linear → ease out).
   * opts: {duration (total s, split by segment length), mode + modeOpts (applied at the end), bookmark}.
   * Waypoints may carry {duration, orbit (ECEF point the segment orbits about)}. Resolves {arrived} like flyTo.
   */
  async flyPath(points, opts = {}) {
    const list = (points || []).filter(Boolean);
    if (!list.length) return { arrived: false };
    this._cancelPath();
    const token = { cancelled: false };
    this.path = token;
    // segment weights ~ log zoom + ground distance (rough VWN length) for splitting a total duration
    let weights = null;
    if (opts.duration > 0 && list.length > 1) {
      weights = [];
      let prev = this.app.rig.position;
      for (const p of list) {
        const d = this.resolveTarget(p);
        if (!d) { weights.push(1); continue; }
        const a0 = Math.max(1, Math.hypot(prev.x, prev.y, prev.z) - R), a1 = Math.max(1, d.position.length() - R);
        const dd = Math.hypot(d.position.x - prev.x, d.position.y - prev.y, d.position.z - prev.z);
        weights.push(1 + Math.abs(Math.log(a1 / a0)) + Math.log1p(dd / Math.max(Math.min(a0, a1), 10)));
        prev = d.position;
      }
    }
    const wsum = weights ? weights.reduce((a, b) => a + b, 0) : 1;
    let res = { arrived: false };
    for (let i = 0; i < list.length; i++) {
      if (token.cancelled) return { arrived: false, interrupted: 'path' };
      const n = list.length, last = i === n - 1;
      const ease = n === 1 ? easeInOut : i === 0 ? easeInV : last ? easeOutV : linear;
      const wp = list[i];
      const dur = wp.duration ?? (weights ? (opts.duration * weights[i]) / wsum : undefined);
      res = await this.flyTo(wp, { _path: true, _waypoint: !last, _shown: opts.mode, pushBack: i === 0 && opts.pushBack !== false, duration: dur, ease, mode: last ? opts.mode : undefined, modeOpts: last ? opts.modeOpts : undefined, bookmark: last ? opts.bookmark : undefined, holdWalk: last && !!opts.holdWalk });
      if (!res.arrived) { if (this.path === token) this.path = null; return res; }
    }
    if (this.path === token) this.path = null;
    return res;
  }

  _cancelPath() { if (this.path) { this.path.cancelled = true; this.path = null; } }

  /** normalise any accepted target form into {position, quaternion, lens, fov, mode?} */
  resolveTarget(t) {
    if (!t) return null;
    const rig = this.app.rig;
    if (t.pose && !t.position) t = { ...t.pose, mode: t.mode };
    if (t.position && t.quaternion) {
      const q = new THREE.Quaternion(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w).normalize();
      return { position: new THREE.Vector3(t.position.x, t.position.y, t.position.z), quaternion: q, lens: t.lens ?? null, fov: t.fov ?? rig.fov, mode: t.mode };
    }
    const look = t.lookAt || t.target;
    if (look) {
      let T;
      if (Number.isFinite(look.lat) && Number.isFinite(look.lon) && !Number.isFinite(look.h) && !Number.isFinite(look.alt)) {
        const p = latLonHToEcef(look.lat, look.lon, this.groundHeightAt(look.lat, look.lon) + (look.agl || 0));
        T = new THREE.Vector3(p.x, p.y, p.z);
      } else T = toEcefVec(look);
      if (!T) return null;
      const P = new THREE.Vector3(rig.position.x, rig.position.y, rig.position.z);
      const cur = decompose(P, rig.quaternion, T, {});
      const range = t.range ?? t.distance ?? Math.max(cur.range, 10);
      const st = lookAtState(T, range, t.heading ?? cur.heading, t.tilt ?? cur.tilt * RAD);
      return { position: st.position, quaternion: st.quaternion, lens: t.lens ?? (t.fov ? null : rig.lens), fov: t.fov ?? rig.fov, mode: t.mode };
    }
    if (Number.isFinite(t.lat) && Number.isFinite(t.lon)) {
      const tmp = this._tmpRig;
      let alt;
      if (Number.isFinite(t.agl)) alt = this.groundHeightAt(t.lat, t.lon) + t.agl;
      else if (t.altRef === 'ground' && Number.isFinite(t.alt)) alt = this.groundHeightAt(t.lat, t.lon) + t.alt;
      else alt = Number.isFinite(t.alt) ? t.alt : Number.isFinite(t.h) ? t.h : rig.geo.h;
      tmp.lens = null; tmp.fov = rig.fov;
      tmp.setPose({ lat: t.lat, lon: t.lon, alt, heading: t.heading ?? 0, pitch: t.pitch ?? -90, roll: t.roll ?? 0 });
      let lens = t.lens ?? null, fov = t.fov ?? null;
      if (!lens && !fov) { lens = rig.lens; fov = rig.fov; }
      return { position: new THREE.Vector3(tmp.position.x, tmp.position.y, tmp.position.z), quaternion: tmp.quaternion.clone(), lens, fov: fov ?? rig.fov, mode: t.mode };
    }
    return null;
  }

  cancelTransition() { this._cancelPath(); this._endTransition(false, 'cancelled'); }

  _arrive() {
    const tr = this.transition;
    this.transition = null;
    if (tr.waypoint) {
      // flyPath continues with the next segment in this frame's microtasks (before the next update)
      this._markInternal();
      if (tr.resolve) tr.resolve({ arrived: true, waypoint: true });
      return;
    }
    const pm = this.pendingMode || (tr.mode ? { name: tr.mode, opts: tr.modeOpts || {} } : null);
    this.pendingMode = null;
    let deferEvent = false;
    // the flight's destination is a requested pose: hold it while the scene refines (D6). A walking
    // arrival also keeps the walker at the requested height until the floor carrying it streams in.
    // (set before the mode is entered: WalkMode.syncFromRig reads it)
    this._setHold(tr.bookmark ? 'bookmark' : 'flight', !!pm && pm.name === 'walk' && !!tr.holdWalk);
    if (pm) {
      if (pm.name === 'focus' && !(pm.opts && pm.opts.info)) {
        // bookmark / setMode('focus') during the flight: orbit the building from where we arrived
        const id = this._focusIdFrom(pm.opts);
        if (id != null) { this.focusBuilding(id, { keepPose: true, spec: pm.opts.spec, pushBack: false, bookmark: tr.bookmark, resolveArrive: tr.resolve }); deferEvent = true; }
        else this._enterMode(this.active.name === 'focus' ? 'orbit' : this.active.name);
      } else if (pm.name === 'walk' && !(pm.opts && pm.opts.trustFloor) && this.eyeAboveWalkFloor() > 4) {
        // arrived too high to stand: drop straight down, the drop flight reports camera:arrive
        this._enterMode('orbit');
        this._dropToWalk('below');
        if (this.transition) this.transition.bookmark = tr.bookmark;
        this.app.events.emit('camera:transition', { phase: 'end', arrived: true });
        if (tr.resolve) tr.resolve({ arrived: true });
        return;
      } else this._enterMode(pm.name, pm.opts || {});
    } else {
      const cur = this.active.name;
      if (cur === 'walk' && this.eyeAboveWalkFloor() > 3) this._enterMode('orbit');
      else if (cur === 'focus') this._enterMode('orbit');
      else { this.active.enter?.({}); this._markInternal(); this._showMode(cur); }
    }
    this.app.events.emit('camera:transition', { phase: 'end', arrived: true });
    if (deferEvent) return; // focusBuilding emits camera:arrive and resolves once focus mode is entered
    this.app.events.emit('camera:arrive', { bookmark: tr.bookmark || undefined, pose: this.app.rig.getPose(), mode: this.active.name });
    if (tr.resolve) tr.resolve({ arrived: true });
  }

  _endTransition(arrived, reason, quiet) {
    const tr = this.transition;
    if (!tr) return;
    this.transition = null;
    this.pendingMode = null;
    const cur = this.active.name;
    if (!quiet) {
      if (cur === 'walk' || cur === 'focus') this._enterMode('orbit');
      else { this.active.enter?.({}); this._markInternal(); }
    }
    this._showMode(this.active.name);
    this.app.events.emit('camera:transition', { phase: 'end', arrived: false, reason });
    if (tr.resolve) tr.resolve({ arrived: false, interrupted: reason });
  }

  /** stop transitions / animations because the user took over */
  interrupt(source) {
    this._hold = null;   // user input takes over the camera: the programmatic pose is no longer held
    this._inputSeen = true;   // (an external pose write in the same frame must not start a new hold)
    this._cancelPath();
    if (this.transition) this._endTransition(false, source);
    if (this._focusReq) this._cancelFocusReq(true, source || 'input');
    if (this.active.anim) this.active.anim = null;
  }

  // ============================================================================== back stack
  pushBack() {
    const rig = this.app.rig;
    const top = this.backStack[this.backStack.length - 1];
    const mode = this.active.name;
    if (top && top.mode === mode && rig.equals(top.state, 0.01, 1e-6)) return;
    const fm = this.modes.focus;
    this.backStack.push({ state: rig.snapshot(), mode, focusId: mode === 'focus' ? fm.id : null, focusInfo: mode === 'focus' ? fm.info : null });
    if (this.backStack.length > this.maxBack) this.backStack.shift();
  }

  /** CONTRACT: animate back to the previous pose (and mode) */
  back(opts = {}) {
    // entries equal to where the camera already is (same pose and mode) would be a no-op: skip them
    let e = this.backStack.pop();
    while (e && this.backStack.length && e.mode === this.active.name && this.app.rig.equals(e.state, 0.01, 1e-6)) e = this.backStack.pop();
    if (!e) return Promise.resolve({ arrived: false, empty: true });
    const s = e.state;
    const dest = { position: new THREE.Vector3(s.position.x, s.position.y, s.position.z), quaternion: s.quaternion.clone(), lens: s.lens, fov: s.fov };
    const modeOpts = e.mode === 'focus' ? { id: e.focusId, info: e.focusInfo } : {};
    // back to another side of a building (focus orbit, viewpoint): orbit round it instead of cutting through
    const info = e.focusInfo || this.modes.focus.info;
    const wp = info && opts.viaOrbit !== false && !(opts.duration > 0) ? this._orbitWaypoint(info, dest.position, { lens: dest.lens, fov: dest.fov }) : null;
    if (wp) return this.flyPath([wp, dest], { pushBack: false, mode: e.mode, modeOpts });
    return this.flyTo(dest, { pushBack: false, mode: e.mode, modeOpts, duration: opts.duration });
  }

  canGoBack() { return this.backStack.length > 0; }
  clearBack() { this.backStack.length = 0; }

  // ============================================================================== high-level moves
  /**
   * fly to an orbit view straight above the current lat/lon (§1 返回同一经纬度的轨道视角): the
   * opening framing (9,500 km, 35° vertical field of view: the whole disc) unless opts say otherwise
   */
  home(opts = {}) {
    const g = this.app.rig.geo;
    const optics = opts.lens ? { lens: opts.lens } : { fov: opts.fov ?? 35 };
    return this.flyTo({ lat: g.lat, lon: g.lon, alt: opts.alt ?? 9.5e6, heading: 0, pitch: -90, ...optics }, { mode: 'orbit', duration: opts.duration });
  }

  /** look at a location: lookAt(lat, lon, {range, heading, tilt, h, duration}) */
  lookAt(lat, lon, opts = {}) {
    const h = opts.h ?? this.groundHeightAt(lat, lon);
    return this.flyTo({ lookAt: { lat, lon, h }, range: opts.range ?? 2000, heading: opts.heading ?? 0, tilt: opts.tilt ?? 45 }, { duration: opts.duration, mode: opts.mode ?? 'orbit' });
  }

  /** double-click flight: centre the clicked surface point and move closer (dir > 0) or away */
  flyToPoint(x, y, dir = 1, opts = {}) {
    const ray = this.rayAt(x, y);
    const o = ray.o.clone(), d = ray.d.clone();
    const s = this.ground.surfacePoint(o, d);
    if (s.kind === 'silhouette') return Promise.resolve({ arrived: false });
    const A = s.point;
    const rig = this.app.rig;
    const dec = decompose(o, rig.quaternion, A, {});
    const range = dir > 0 ? Math.max(dec.range * 0.3, 14) : Math.min(dec.range * 3.2, 3.5e7);
    const hNew = Math.max(1, range * Math.cos(dec.tilt));
    const tilt = Math.min(dec.tilt, maxTilt(hNew, A.length() + hNew, A.length())) * RAD;
    const st = lookAtState(A, range, dec.heading, tilt);
    return this.flyTo({ position: st.position, quaternion: st.quaternion, lens: rig.lens, fov: rig.fov }, { duration: opts.duration, mode: opts.mode });
  }

  /** walk-mode double click: walk (short flight) to a visible ground point within 80 m */
  _walkTo(x, y) {
    const ray = this.rayAt(x, y);
    const o = ray.o.clone(), d = ray.d.clone();
    const w = this.modes.walk;
    const hit = this.ground.raycast(o, d, { colliders: w.colliders, maxDist: 80 });
    if (!hit) return Promise.resolve({ arrived: false });
    const up = hit.point.clone().normalize();
    if (hit.raw && hit.raw.normal && hit.raw.normal.dot(up) < w.cosSlope) return Promise.resolve({ arrived: false }); // wall
    if (hit.kind === 'water' && this._dryHeight(hit.point) == null) return Promise.resolve({ arrived: false }); // deep water
    const rig = this.app.rig;
    rig.forward(_f);
    // terrain / water hits: the drawn tile may still be coarse — stand on the final ground there
    const T = hit.kind === 'terrain' || hit.kind === 'water' ? this._walkGroundPoint(hit.point) : hit.point;
    const st = this._standState(T, _f, 0);
    st.quaternion.copy(this._eyeQuat(up, _f, w.pitch));
    return this.flyTo({ position: st.position, quaternion: st.quaternion, lens: rig.lens, fov: rig.fov }, { mode: 'walk', duration: clamp(0.35 + hit.distance / 30, 0.5, 2.2) });
  }

  // ============================================================================== buildings
  /**
   * Focus data for building `id`: city.focusInfo (preferred), else the spec (hint passed by the UI,
   * city.getBuilding, or regenerated by id in a pool worker — never on the main thread).
   */
  async getFocusInfo(id, specHint = null) {
    const city = this.app.systems && this.app.systems.city;
    let raw = null;
    let spec = specHint && (specHint.id == null || String(specHint.id) === String(id)) ? specHint : null;
    try {
      if (city && city.focusInfo) raw = await withTimeout(city.focusInfo(id), 20000);
      else if (city && city.focusData) raw = await withTimeout(city.focusData(id), 20000);
    } catch (e) { console.warn('[controls] focusInfo failed', e); }
    if (!spec) spec = (raw && raw.spec) || null;
    if (!spec && city && city.getBuilding) { try { const b = await withTimeout(city.getBuilding(id), 10000); spec = (b && (b.spec || (b.lat != null ? b : null))) || null; } catch { /* */ } }
    if (!raw && !spec) spec = await this._specById(id);
    return this._rememberInfo(id, normalizeFocusInfo(raw, spec));
  }

  /**
   * Remember the normalised focus data of building `id` (buildingViews answers for it, later requests
   * reuse it); kit camera anchors already known for it are kept when the new data has none.
   * Returns the (merged) info.
   */
  _rememberInfo(id, info) {
    if (id == null || !info) return info;
    const key = String(id), m = this._infoCache || (this._infoCache = new Map());
    const old = m.get(key);
    if (old && old !== info && !hasKitCameras(info) && hasKitCameras(old)) info = { ...info, anchors: old.anchors, cameras: old.cameras };
    m.delete(key); m.set(key, info);
    if (m.size > 24) m.delete(m.keys().next().value);
    return info;
  }

  /** focus data known for building `id` without waiting: the focused building's, else the remembered one */
  _knownInfo(id) {
    if (id == null) return null;
    const fm = this.modes.focus;
    if (fm.info && String(fm.id) === String(id)) return fm.info;
    return (this._infoCache && this._infoCache.get(String(id))) || null;
  }

  /**
   * Background refresh of building `id`'s viewpoints (CT3): once the city has its 'full' LOD, the focus
   * data is fetched again with the city's anchors (rooms, stairs, doors); while it is not streamed, the
   * kit anchors are generated in a pool worker. Throttled (one refresh in flight per building, ≥ 2 s apart).
   */
  _wantViews(id, info) {
    if (id == null || !info) return;
    if (info.raw && info.raw.lod === 'full') return;
    const key = String(id), now = performance.now();
    const st = this._viewsReq || (this._viewsReq = new Map());
    const r = st.get(key);
    if (r && r.busy) return;
    const city = this.app.systems && this.app.systems.city;
    let lod = null;
    try { const b = city && city.getBuilding ? city.getBuilding(id) : null; lod = b && b.tile ? (b.lod || 'mass') : null; } catch { lod = null; }
    // (at once when the building's LOD changed — e.g. it just reached 'full' — else ≥ 2 s apart)
    if (r && now - r.t < 2000 && r.lod === lod) return;
    const needAnchors = !hasKitCameras(info) && info.spec;
    if (lod !== 'full' && !needAnchors) return;
    const rec = { busy: true, t: now, lod };
    st.set(key, rec);
    if (st.size > 32) st.delete(st.keys().next().value);
    const done = (fresh) => {
      rec.busy = false; rec.t = performance.now();
      if (!fresh) return;
      fresh = this._rememberInfo(id, fresh);
      const fm = this.modes.focus;
      if (String(fm.id) === key && fm.info) fm.info = fresh;
    };
    if (lod === 'full') { this.getFocusInfo(id, info.spec).then(done, () => done(null)); return; }
    this._anchorsById(info.spec).then((anchors) => {
      if (!anchors || !anchors.cameras) return done(null);
      const cur = this._knownInfo(id) || info;
      if (hasKitCameras(cur)) return done(null);
      done({ ...cur, anchors: cur.anchors && cur.anchors.cameras ? cur.anchors : anchors, cameras: cur.cameras || anchors.cameras });
    }, () => done(null));
  }

  /** the focused building reached 'full' (or lacks kit anchors): refresh its viewpoints (every 0.5 s at most) */
  _refreshFocusViews() {
    const fm = this.modes.focus;
    if (this.active !== fm || !fm.info || fm.id == null) return;
    const now = performance.now();
    if (now - (this._fvT || 0) < 500) return;
    this._fvT = now;
    this._wantViews(fm.id, fm.info);
  }

  /** BuildingSpec regenerated by id in a pool worker (cold urban caches can take seconds: never on the main thread) */
  async _specById(id) {
    const key = String(id);
    if (this._specCache.has(key)) return this._specCache.get(key);
    const w = this.app.workers;
    if (!w || !w.submit) return null;
    let spec = null, job = null;
    try { job = w.submit('buildingSpec', { id: key }, { priority: VIEW_JOB_PRIORITY }); spec = await withTimeout(job.promise, 45000); } catch { spec = null; }
    if (!spec && job) { try { job.cancel(); } catch { /* finished */ } }
    if (spec) { this._specCache.set(key, spec); if (this._specCache.size > 64) this._specCache.delete(this._specCache.keys().next().value); }
    return spec || null;
  }

  _beginFocusReq(id, kind) {
    // a pose written just before this request (a bookmark's provisional pose) belongs to it (QS-03)
    this._absorbExternal();
    if (this._focusReq) this._cancelFocusReq(false, 'superseded');
    const req = { token: ++this._focusToken, id, kind, prevMode: this.active.name, v: this.app.rig.version, cancelled: null };
    this._focusReq = req;
    return req;
  }
  /** end the pending focus / enter / view request; `reason` is what its promise reports as `interrupted` */
  _cancelFocusReq(restoreMode = false, reason = 'cancelled') {
    const req = this._focusReq;
    if (!req) return;
    req.cancelled = reason || 'cancelled';
    this._focusReq = null;
    if (restoreMode && !this.transition) this._showMode(this.active.name);
  }
  /** {arrived:false, interrupted} for a request that is no longer the pending one */
  _reqLost(req) { return { arrived: false, interrupted: (req && req.cancelled) || 'superseded' }; }

  /**
   * CONTRACT: fly to an orbit around building `id`, then focus mode. opts: {spec, pushBack,
   * keepPose (enter focus from the current camera without a flight), elevation (deg), duration}.
   * Resolves {arrived} (or false when the building is unknown).
   */
  async focusBuilding(id, opts = {}) {
    if (id == null) return false;
    const req = this._beginFocusReq(id, 'focus');
    this._showMode('focus');
    const info = await this.getFocusInfo(id, opts.spec || null);
    if (this._focusReq !== req) { const lost = this._reqLost(req); if (opts.resolveArrive) opts.resolveArrive(lost); return lost; }
    this._focusReq = null;
    if (!info) {
      console.warn(`[controls] focusBuilding: no data for building ${id}`);
      this._showMode(this.active.name);
      if (opts.resolveArrive) {
        // the flight that carried this focus request did arrive
        this.app.events.emit('camera:arrive', { bookmark: opts.bookmark || undefined, pose: this.app.rig.getPose(), mode: this.active.name });
        opts.resolveArrive({ arrived: true, focus: false });
      }
      return false;
    }
    const rig = this.app.rig, fm = this.modes.focus;
    const sel = this.app.state.selection;
    if (!sel || sel.type !== 'building' || String(sel.id) !== String(id)) this.app.state.select({ type: 'building', id, spec: info.spec || null, distance: info.center.distanceTo(_v.set(rig.position.x, rig.position.y, rig.position.z)) });
    if (opts.keepPose) {
      if (this.active.name !== 'focus' && opts.pushBack) this.pushBack();
      fm.setInfo(id, info);
      this._enterMode('focus', { id, info, keepPose: true });
      this.app.events.emit('camera:arrive', { bookmark: opts.bookmark || undefined, pose: rig.getPose(), mode: this.active.name });
      const r = { arrived: true };
      if (opts.resolveArrive) opts.resolveArrive(r);
      return r;
    }
    const P = new THREE.Vector3(rig.position.x, rig.position.y, rig.position.z);
    const up = new THREE.Vector3().copy(info.center).normalize();
    const off = P.clone().sub(info.center);
    const hz = off.clone().addScaledVector(up, -off.dot(up));
    const e = new THREE.Vector3(), n = new THREE.Vector3(); tangentBasis(up, e, n);
    const az = hz.lengthSq() > 1 ? Math.atan2(hz.dot(e), hz.dot(n)) : ((info.heading || 0) + 35) * DEG;
    fm.setInfo(id, info);
    const dist = clamp(fm.fitDistance(), fm.minDist, fm.maxDist);
    // 26° above the horizon, higher when neighbours would hide the building from there
    const el = opts.elevation != null ? opts.elevation * DEG : fm.clearElevation(az, 26 * DEG, dist);
    // in front of any neighbour that would hide the building (focus mode's spring arm)
    const st = fm.stateFor(az, el, fm.armLimit(az, el, dist), { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
    // keep the destination above the ground
    const L = st.position.length(), minL = R + this.ground.floorHeightAt(st.position, { buildings: false }) + CLEAR;
    if (L < minL) st.position.multiplyScalar(minL / L);
    return this.flyTo({ position: st.position, quaternion: st.quaternion, lens: rig.lens, fov: rig.fov }, { pushBack: opts.pushBack ?? true, mode: 'focus', modeOpts: { id, info, wantDist: dist }, duration: opts.duration });
  }

  /** CONTRACT: fly to the main entrance and switch to walk mode facing the door. Resolves {arrived} | false. */
  async enterBuilding(id, opts = {}) {
    id = id ?? this.modes.focus.id;
    if (id == null) return false;
    const req = this._beginFocusReq(id, 'enter');
    this._showMode('walk');
    const info = (this.modes.focus.info && String(this.modes.focus.id) === String(id) && !opts.spec) ? this.modes.focus.info : await this.getFocusInfo(id, opts.spec || null);
    if (this._focusReq !== req) return this._reqLost(req);
    this._focusReq = null;
    const ent = info ? entrancePose(info, opts.entrance || 'main') : null;
    if (!ent) {
      console.warn(`[controls] enterBuilding: no data for building ${id}`);
      this._showMode(this.active.name);
      return false;
    }
    // ~4 m before the door: the door leaves, steps / ramp and the lobby behind the glass in one frame
    const feet = ent.pos.clone().addScaledVector(ent.out, opts.standoff ?? 3.4);
    const tH = this.ground.walkTerrainAt(feet, 0.01);
    const eH = ent.pos.length() - R;
    feet.multiplyScalar((R + Math.max(tH, eH - 0.35)) / feet.length());
    const up2 = feet.clone().normalize();
    const eye = feet.clone().addScaledVector(up2, WALK.eye);
    const q = this._eyeQuat(up2, ent.out.clone().negate(), -4 * DEG);
    const lens = this._eyeLens(opts);
    const dest = { position: eye, quaternion: q, ...lens };
    // seen from another side of the building: orbit round to the entrance side first
    const wp = opts.viaOrbit === false ? null : this._orbitWaypoint(info, eye, lens);
    if (wp) {
      if (opts.duration > 0) { wp.duration = opts.duration * 0.45; dest.duration = opts.duration * 0.55; }
      return this.flyPath([wp, dest], { mode: 'walk', pushBack: opts.pushBack ?? true });
    }
    return this.flyTo(dest, { pushBack: opts.pushBack ?? true, mode: 'walk', duration: opts.duration });
  }

  /**
   * Waypoint on an orbit around building `info` at the azimuth of `destPos` (ECEF), so that a move
   * there never cuts through (or hops over) the building: returned when the camera is near the
   * building on another side of it (azimuth difference about the centre > 65°), else null.
   * The segment to it orbits the building centre at the current distance and elevation (16–60°).
   */
  _orbitWaypoint(info, destPos, lens = null) {
    if (!info || !info.center || !destPos) return null;
    const rig = this.app.rig;
    const C = info.center, up = C.clone().normalize(), rad = info.radius || 10;
    const P = new THREE.Vector3(rig.position.x, rig.position.y, rig.position.z);
    const hp = P.clone().sub(C); const vp = hp.dot(up); hp.addScaledVector(up, -vp);
    const hd = destPos.clone().sub(C); hd.addScaledVector(up, -hd.dot(up));
    const rp = hp.length(), rd = hd.length();
    if (rp < 0.45 * rad || rd < 0.45 * rad || rp > 10 * rad + 200) return null;   // inside / on top / far away
    const ang = Math.atan2(hp.clone().cross(hd).length(), hp.dot(hd));
    if (ang < 65 * DEG) return null;
    const vf = rig.vfov(this.aspect()) * DEG, hf = 2 * Math.atan(Math.tan(vf / 2) * this.aspect());
    const fit = (rad / Math.sin(Math.min(vf, hf) / 2)) * 1.08;
    const dist = clamp(P.distanceTo(C), Math.max(rad * 1.6, rad * 0.62 + 4), Math.max(fit * 1.5, rad * 3));
    const el = clamp(Math.atan2(vp, rp), 16 * DEG, 60 * DEG);
    hd.multiplyScalar(1 / rd);
    const pos = C.clone().addScaledVector(hd, Math.cos(el) * dist).addScaledVector(up, Math.sin(el) * dist);
    const L = pos.length(), minL = R + this.ground.floorHeightAt(pos, { buildings: false }) + 3;
    if (L < minL) pos.multiplyScalar(minL / L);
    const q = quatLook(C.clone().sub(pos).normalize(), up, new THREE.Quaternion());
    const optics = lens || { lens: rig.lens, fov: rig.fov };
    return { position: pos, quaternion: q, lens: optics.lens ?? null, fov: optics.fov ?? rig.fov, orbit: C.clone(), duration: 0.8 + (1.1 * ang) / Math.PI };
  }

  /** lens for eye-level arrivals (§5 07: 28–35 mm): the current one unless it is longer than 36 mm */
  _eyeLens(opts = {}) {
    const rig = this.app.rig;
    if (opts.lens) return { lens: opts.lens, fov: rig.fov };
    if (opts.keepLens || !(rig.lensMM(this.aspect()) > 36)) return { lens: rig.lens, fov: rig.fov };
    return { lens: 32, fov: rig.fov };
  }

  /**
   * CONTRACT (extension): fly to a viewpoint of building `id` (§5 shot 07 / §5 template: 全景、背面、
   * 屋顶、室内) — 'street' | 'entrance' | 'lobby' | 'stair' | 'living' | 'back' | 'roof', or any camera
   * name the city's focusInfo provides — and continue on foot (walk mode) where there is a floor to
   * stand on, else hover there in orbit mode. Street-level views stand on the real (final) ground;
   * room / roof views come from the building's own camera anchors (BuildingMeshData.anchors.cameras:
   * from the city when the building is streamed, else generated in a pool worker) and stand on the
   * storey floor (walk colliders; until they stream in the anchor's floor height is trusted and the
   * held walker waits there). The arrival is held as a requested pose (D6).
   * opts: {spec, mode, lens, keepLens, pitch (deg, overrides the anchor's look pitch), duration,
   * instant (jump: no flight, no door / orbit detour), pushBack, bookmark, fallback=true (lobby→entrance,
   * living→interior→stair→lobby; not for bookmarks, see below), waitMs (how long to wait for the 'full' LOD
   * when the building is streamed; default 8 s), anchorWaitMs (how long to wait for the kit's camera anchors
   * generated in a worker; default 45 s, bookmark landings 60 s), clear=true (outdoor eye-level views slide
   * off neighbours and street trees, QP-03 / CT2)}.
   * Bookmark landings (opts.bookmark with a stored pose, fix round 3 CT1): when the asset's own anchors do not
   * provide the view — not generated within anchorWaitMs (cold landing under load), or a view this building
   * lacks — the camera lands on the bookmark's stored pose (walk / hold as for an anchor), never on the spec
   * stand-ins (they frame the spec's 'main' door) nor on another view of the fallback chain.
   * Resolves {arrived, view, mode, source ('city' | 'anchors' | 'spec' | 'bookmark'), requested:{lat,lon,alt},
   * adjusted?:{moved, reason}} | false (unknown building or view) | {arrived:false, interrupted: reason}
   * (see _cancelFocusReq / ARCHITECTURE §8).
   */
  async buildingView(id, name = 'street', opts = {}) {
    id = id ?? this.modes.focus.id;
    if (id == null) return false;
    const req = this._beginFocusReq(id, 'view');
    const fm = this.modes.focus;
    const stored = bookmarkPose(opts.bookmark);
    let info = (fm.info && String(fm.id) === String(id) && !opts.spec) ? fm.info : await this.getFocusInfo(id, opts.spec || null);
    if (this._focusReq !== req) return this._reqLost(req);
    // interior / roof viewpoints: when the building is streamed, wait briefly for the city's 'full' LOD
    // (interiors, door anchors for the walk-in path, the city's own camera anchors)
    let cam0 = info ? buildingCameras(info)[name] : null;
    if (info && (!cam0 || !cam0.ground)) {
      info = await this._fullInfo(id, info, opts.waitMs ?? 8000, req);
      if (this._focusReq !== req) return this._reqLost(req);
      if (info && String(fm.id) === String(id)) fm.info = info;
      cam0 = info ? buildingCameras(info)[name] : null;
    }
    // the building is not streamed (yet) or its anchors lack the view: generate its anchors in a worker
    // (same generator as the city's, so the viewpoint is the asset's own) — urgent, see VIEW_JOB_PRIORITY
    let anchorWait = 0;
    if (info && info.spec && (!cam0 || cam0.source === 'spec')) {
      const ms = opts.anchorWaitMs ?? (stored ? BOOKMARK_ANCHOR_WAIT : 45000);
      const ta = performance.now();
      const anchors = await this._anchorsById(info.spec, { priority: VIEW_JOB_PRIORITY, timeoutMs: ms });
      anchorWait = anchors ? 0 : performance.now() - ta;
      if (this._focusReq !== req) return this._reqLost(req);
      if (anchors && anchors.cameras) info = { ...info, anchors: info.anchors && info.anchors.cameras ? info.anchors : anchors, cameras: info.cameras || anchors.cameras };
    }
    // CT1: a bookmark whose view the asset's anchors do not provide lands on its stored pose
    let cam = info ? buildingCameras(info)[name] : null, used = name;
    if (stored && info && (!cam || cam.source === 'spec')) {
      const why = !hasKitCameras(info) ? `the building's camera anchors were not generated within ${(anchorWait / 1000).toFixed(1)} s`
        : `the asset has no '${name}' view`;
      console.info(`[controls] buildingView ${id} '${name}': ${why} — using the bookmark's stored pose${opts.bookmark.id ? ` (${opts.bookmark.id})` : ''}`);
      cam = storedCamera(stored, name);
    }
    // eye-level views outside are checked against the neighbours' plan footprints and the street trees
    // (QP-03 / CT2): wait until the building's tile (bookmark landings ≤ 20 s, other calls ≤ 3 s) and the
    // prop tiles round the eye (≤ 12 s / ≤ 1.5 s) have streamed so they are known
    if (cam && cam.ground && cam.source !== 'bookmark' && opts.clear !== false) {
      await this._waitStreamed(id, opts.bookmark ? 20000 : 3000, req);
      if (this._focusReq !== req) return this._reqLost(req);
      await this._waitTrees(cam.pos, opts.bookmark ? 12000 : 1500, req);
      if (this._focusReq !== req) return this._reqLost(req);
    }
    this._focusReq = null;
    if (!info) { console.warn(`[controls] buildingView: no data for building ${id}`); return false; }
    info = this._rememberInfo(id, info);
    if (String(fm.id) === String(id) && fm.info) fm.info = info;
    if (!cam && opts.fallback !== false) {
      // (non-residential types name their upper room view 'interior')
      const cams = buildingCameras(info);
      for (const alt of ({ lobby: ['entrance'], living: ['interior', 'stair', 'lobby', 'entrance'], interior: ['living', 'lobby', 'entrance'], stair: ['lobby', 'entrance'] })[name] || []) {
        if (cams[alt]) { cam = cams[alt]; used = alt; break; }
      }
    }
    if (!cam) { console.warn(`[controls] buildingView: building ${id} has no '${name}' view`); return false; }
    const pos = cam.pos.clone();
    const up = pos.clone().normalize();
    let adjusted = null;
    // Requested poses come from FINAL geometry: the kit's camera anchors (building frame) and the
    // analytic terrain. Streaming walk colliders are not final — the city seats buildings onto the
    // displayed terrain, so their floors sit metres off until the terrain under them has refined.
    let standable = cam.ground, trusted = false;
    if (cam.ground) {
      // not inside the building across the street / behind, nor facing its wall or a tree trunk (QP-03 /
      // CT2) — a bookmark's stored pose is the author's frame and stays where it is
      adjusted = opts.clear === false || cam.source === 'bookmark' ? null : this._clearGroundView(id, pos, cam.target);
      if (adjusted) { pos.copy(adjusted.pos); up.copy(pos).normalize(); }
      // street-level views stand on the real ground: the final terrain / water surface, or a kerb /
      // plinth / step collider just above it (within 1.2 m: seated colliders far off are ignored)
      const A = this.ground.analyticAt(pos);
      let gh = A.h;
      const wf = this.walkFloorBelow(pos.clone().multiplyScalar((R + A.terrain + WALK.eye) / pos.length()), { maxDown: WALK.eye + 0.2, probeUp: 0, analytic: true });
      if (wf.kind === 'collider' && wf.h > gh && wf.h < A.terrain + 1.2) gh = wf.h;
      // (a stored eye keeps its height while it stands at eye level over that ground — a step / pad up to
      // 1.5 m — else it is re-seated: the terrain changed since the pose was stored)
      const eyeH = pos.length() - R - gh;
      if (!(cam.source === 'bookmark' && eyeH > WALK.eye - 0.3 && eyeH < WALK.eye + 1.5)) pos.copy(up).multiplyScalar(R + gh + WALK.eye);
    } else if (cam.source === 'bookmark') {
      // a stored room / roof / deck pose: the author's eye, walked like a kit anchor when the bookmark walks
      standable = (opts.bookmark.mode || 'walk') === 'walk'; trusted = standable;
    } else if (cam.source !== 'spec') {
      // room / roof viewpoints of the kit stand on their storey floor by construction (eye 1.65 m
      // above it): walk there; the held walker stays exactly there until the visitor moves
      standable = true; trusted = true;
    } else {
      // the roof view synthesised from the spec estimates the roof height: walk only when a roof is
      // found near the eye (walk colliders, else the picking hull)
      const wf = this.walkFloorBelow(pos, { maxDown: WALK.eye + 2.5, probeUp: 0.2, analytic: true });
      const h = pos.length() - R - wf.h;
      standable = !wf.deep && h > WALK.eye - 0.5 && h < WALK.eye + 2.0;
      if (standable) pos.copy(up).multiplyScalar(R + wf.h + WALK.eye);
    }
    let f = cam.target.clone().sub(pos);
    if (Number.isFinite(opts.pitch) && cam.source !== 'bookmark') {
      // keep the anchor's compass direction, look at the requested pitch (a stored pose keeps its own)
      f.addScaledVector(up, -f.dot(up));
      if (f.lengthSq() < 1e-10) tangentBasis(up, _v, f);
      f.normalize().multiplyScalar(Math.cos(opts.pitch * DEG)).addScaledVector(up, Math.sin(opts.pitch * DEG));
    }
    f.normalize();
    const q = quatLook(f, up, new THREE.Quaternion());
    const mode = opts.mode ?? (standable ? 'walk' : 'orbit');
    const lens = this._eyeLens(opts);
    const dest = { position: pos, quaternion: q, ...lens };
    // buildingView decided where the walker stands: the arrival does not re-test the floor below
    const modeOpts = mode === 'walk' ? { trustFloor: true } : undefined;
    const pushBack = opts.pushBack ?? !opts.instant;
    const instant = !!opts.instant;
    // from outdoors to a room: walk in through the main entrance instead of cutting through walls
    const door = !instant && !cam.ground && opts.viaDoor !== false && this._isIndoor(pos) && !this._isIndoor(this.app.rig.position) ? this._doorPath(info, lens) : null;
    let r;
    if (door) {
      const inner = door[1].position;
      door.push({ ...dest, duration: clamp(0.8 + inner.distanceTo(pos) / 2.2, 1.0, 4.5) });
      // from another side of the building: orbit round to the entrance side first
      const wp = opts.viaOrbit === false ? null : this._orbitWaypoint(info, door[0].position, lens);
      if (wp) door.unshift(wp);
      r = await this.flyPath(door, { mode, modeOpts, pushBack, bookmark: opts.bookmark, holdWalk: true });
    } else {
      const wp = instant || opts.viaOrbit === false ? null : this._orbitWaypoint(info, pos, lens);
      if (wp) {
        if (opts.duration > 0) { wp.duration = opts.duration * 0.45; dest.duration = opts.duration * 0.55; }
        r = await this.flyPath([wp, dest], { mode, modeOpts, pushBack, bookmark: opts.bookmark, holdWalk: true });
      } else r = await this.flyTo(dest, { pushBack, mode, modeOpts, duration: instant ? 0 : opts.duration, bookmark: opts.bookmark, holdWalk: true });
    }
    const g = ecefToLatLonH(pos.x, pos.y, pos.z);
    return r && typeof r === 'object' ? { ...r, view: used, mode: this.active.name, trusted, source: cam.source, requested: { lat: g.lat, lon: g.lon, alt: g.h }, ...(adjusted ? { adjusted: { moved: adjusted.moved, reason: adjusted.reason } } : {}) } : r;
  }

  /**
   * wait (≤ ms) until the props system knows the trees round ECEF point `p` (CT2): a tree within 150 m is
   * reported, or the prop tiles are idle (none there); stops when request `req` is superseded
   */
  async _waitTrees(p, ms, req) {
    const props = this.app.systems && this.app.systems.props;
    if (!props || typeof props.treesNear !== 'function') return false;
    const known = () => {
      try { if ((props.treesNear({ x: p.x, y: p.y, z: p.z }, 150) || []).length) return true; } catch { return true; }
      try { return typeof props.isIdle === 'function' ? !!props.isIdle() : true; } catch { return true; }
    };
    const t0 = performance.now();
    while (!known() && performance.now() - t0 < ms) {
      if (req && this._focusReq !== req) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return known();
  }

  /** wait (≤ ms) until building `id` is part of a streamed city tile; stops when request `req` is superseded */
  async _waitStreamed(id, ms, req) {
    const city = this.app.systems && this.app.systems.city;
    if (!city || !city.getBuilding || !city.findBuildings) return false;   // (no neighbour data to wait for)
    const streamed = () => { try { const b = city.getBuilding(id); return !!(b && b.tile); } catch { return false; } };
    const t0 = performance.now();
    while (!streamed() && performance.now() - t0 < ms) {
      if (req && this._focusReq !== req) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return streamed();
  }

  /**
   * Focus data including the city's interior anchors (viewpoints, door positions): wait up to `ms` for
   * building `id` to reach its 'full' LOD — first to stream in at all when `ms` is long (a bookmark
   * landing cold: its tile loads around the provisional pose) — and fetch the focus data again.
   * Returns the fresher info (or the given one). Stops early when request `req` is superseded.
   */
  async _fullInfo(id, info, ms = 8000, req = null) {
    const city = this.app.systems && this.app.systems.city;
    if (!city || !city.getBuilding || !(city.focusInfo || city.focusData)) return info;
    if (info && info.raw && info.raw.lod === 'full') return info;
    const lodOf = () => { try { const b = city.getBuilding(id); return b && b.tile ? (b.lod || 'mass') : null; } catch { return null; } };
    // not streamed: interiors arrive only when the caller can wait for the tile (bookmark landings)
    if (lodOf() == null && ms < 15000) return info;
    const t0 = performance.now();
    let asked = 0;
    while (lodOf() !== 'full' && performance.now() - t0 < ms) {
      if (req && this._focusReq !== req) return info;
      // keep the 'full' request alive while the tile streams in (focusInfo asks the city for it)
      if (lodOf() != null && performance.now() - asked > 5000) { asked = performance.now(); try { city.focusInfo ? city.focusInfo(id) : city.focusData(id); } catch { /* */ } }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (lodOf() !== 'full') return info;
    return (await this.getFocusInfo(id, info && info.spec)) || info;
  }

  /**
   * BuildingMeshData anchors (cameras, entrances, floors) of a spec, generated in a pool worker ('building',
   * lod 'exterior': the same kit generator as the city's, ≈ 5–60 ms); null when unavailable within
   * `timeoutMs`. One job per building: a later caller with a more urgent `priority` raises the queued job's
   * priority (viewpoint requests use VIEW_JOB_PRIORITY, background refreshes the default −100). A timed-out
   * job is not cancelled: it still fills the cache for the next request.
   */
  _anchorsById(spec, { priority = -100, timeoutMs = 45000 } = {}) {
    const key = `anchors:${spec.id}`;
    if (this._specCache.has(key)) return Promise.resolve(this._specCache.get(key));
    const w = this.app.workers;
    if (!w || !w.submit) return Promise.resolve(null);
    const jobs = this._anchorJobs || (this._anchorJobs = new Map());
    let ent = jobs.get(key);
    if (!ent) {
      let job = null;
      try { job = w.submit('building', { spec, lod: 'exterior' }, { priority }); } catch { return Promise.resolve(null); }
      const promise = job.promise.then((data) => {
        const anchors = data && data.anchors ? data.anchors : null;
        if (anchors) { this._specCache.set(key, anchors); if (this._specCache.size > 64) this._specCache.delete(this._specCache.keys().next().value); }
        return anchors;
      }, () => null).finally(() => { if (jobs.get(key) === ent) jobs.delete(key); });
      ent = { job, promise };
      jobs.set(key, ent);
    } else if (ent.job && !ent.job.started && priority < ent.job.priority) ent.job.priority = priority;   // (the pool re-sorts on its next pump)
    return withTimeout(ent.promise, timeoutMs);
  }

  /**
   * QP-03: an eye-level viewpoint placed at the kit's fixed offset (street ≈ 28 m in front, back ≈ 18 m
   * behind) can stand inside the building across the street / behind, or look straight into its wall.
   * Tests the eye against the footprints of the streamed neighbours (city.findBuildings: the plan's
   * specs, independent of the drawn LOD) — inside one (1.2 m margin), or the sight line to `target`
   * passing through one below its roof — and otherwise slides the eye towards the building and round
   * it (±8…35°) until it stands free with a clear view. Street trees (props.treesNear, fix round 3 CT2) count
   * too: the eye against a trunk / inside a crown, a trunk on the sight line that covers the frame centre, or a
   * crown on it within 12 m of the lens; when no candidate clears the trees as well, the building test alone
   * decides (a tree never undoes a neighbour fix). Returns {pos (ECEF on the same eye-height
   * convention: caller re-seats it on the final ground), moved (m), reason} or null when nothing needs
   * to change / no neighbour or tree data is streamed.
   */
  _clearGroundView(id, pos, target) {
    const city = this.app.systems && this.app.systems.city;
    const props = this.app.systems && this.app.systems.props;
    const up = pos.clone().normalize();
    const e = new THREE.Vector3(), n = new THREE.Vector3(); tangentBasis(up, e, n);
    const Th = target.clone().sub(pos);
    const tx = Th.dot(e), ty = Th.dot(n);
    const D0 = Math.hypot(tx, ty);
    if (!(D0 > 3)) return null;
    let near = [];
    try { near = city && city.findBuildings ? city.findBuildings({ near: { x: pos.x, y: pos.y, z: pos.z }, radius: D0 + 60, limit: 120 }) || [] : []; } catch { near = []; }
    const hE = pos.length() - R, hT = target.length() - R;
    const polys = [];
    let own = null;   // the building itself: the eye never stands inside it either
    const P = new THREE.Vector3();
    for (const it of near) {
      const s = it && it.spec;
      if (!s || !s.footprint || !Number.isFinite(s.lat)) continue;
      const self = String(s.id) === String(id);
      const ax = buildingAxes(s.lat, s.lon, s.heading || 0);
      const g = (s.ground && s.ground.entrance) || 0;
      const o = latLonHToEcef(s.lat, s.lon, g);
      const w = s.footprint.w || 10, d = s.footprint.d || 10;
      const loc = Array.isArray(s.footprint.points) && s.footprint.points.length >= 3 ? s.footprint.points : [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
      const pts = loc.map(([x, z]) => {
        P.set(o.x + ax.x[0] * x + ax.z[0] * z - pos.x, o.y + ax.x[1] * x + ax.z[1] * z - pos.y, o.z + ax.x[2] * x + ax.z[2] * z - pos.z);
        return [P.dot(e), P.dot(n)];
      });
      // (bounding circle pre-test data) and the roof height above sea level
      let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
      let rr = 0; for (const p of pts) rr = Math.max(rr, Math.hypot(p[0] - cx, p[1] - cy));
      const q = { id: s.id, pts, cx, cy, rr, top: g + specHeight(s) + (s.roof && /pitch|gable|hip/.test(String(s.roof.kind || s.roof)) ? 2.5 : 0.8) };
      if (self) own = q; else polys.push(q);
    }
    // street trees between the eye and the subject (CT2); heights are taken from the eye's ground when the
    // displayed tree base (seated on a coarse tile) is more than 3 m off it
    const g0 = hE - WALK.eye;
    const trees = treeObstacles(props, pos, e, n, D0 + 15).map((t) => {
      if (Math.abs(t.base - g0) <= 3) return t;
      const dz = g0 - t.base;
      return { ...t, base: g0, crownBase: t.crownBase + dz, top: t.top + dz };
    });
    if (!polys.length && !trees.length) return null;
    // signed distance-ish tests in the eye's tangent plane (x east, y north, metres)
    const inside = (pts, x, y) => {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const segDist = (x, y, ax0, ay0, bx, by) => { const vx = bx - ax0, vy = by - ay0; const t = clamp(((x - ax0) * vx + (y - ay0) * vy) / (vx * vx + vy * vy || 1), 0, 1); return Math.hypot(x - ax0 - vx * t, y - ay0 - vy * t); };
    const distTo = (pts, x, y) => { let m = Infinity; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) m = Math.min(m, segDist(x, y, pts[j][0], pts[j][1], pts[i][0], pts[i][1])); return m; };
    // first crossing (segment parameter) of segment a→b with polygon edges, or null
    const cross = (pts, ax0, ay0, bx, by) => {
      let best = null;
      const rx = bx - ax0, ry = by - ay0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [x1, y1] = pts[j], [x2, y2] = pts[i];
        const sx = x2 - x1, sy = y2 - y1;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((x1 - ax0) * sy - (y1 - ay0) * sx) / den, u = ((x1 - ax0) * ry - (y1 - ay0) * rx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best == null || t < best)) best = t;
      }
      return best;
    };
    const MARGIN = 1.2;
    const test = (x, y) => {
      if (own && (inside(own.pts, x, y) || distTo(own.pts, x, y) < 1.0)) return { ok: false, reason: 'inside the building' };
      for (const q of polys) {
        const dc = Math.hypot(x - q.cx, y - q.cy);
        if (dc > q.rr + MARGIN + D0 + 5) continue;
        if (dc <= q.rr + MARGIN && (inside(q.pts, x, y) || distTo(q.pts, x, y) < MARGIN)) return { ok: false, reason: `inside ${q.id}` };
        // sight line eye → target: a neighbour crossing it below its roof hides the building
        const s = cross(q.pts, x, y, tx, ty);
        if (s != null && s < 0.97) {
          const hLine = hE + (hT - hE) * s;
          if (q.top > hLine + 0.3) return { ok: false, reason: `view blocked by ${q.id}` };
        }
      }
      return { ok: true };
    };
    // trees (CT2): an eye against a trunk, inside or under a low crown (it would hang into the top of the frame),
    // a trunk beside the lens (< 3 m, within ±45° of the view); on the sight line to the target (between eye
    // and target) a trunk that covers the frame centre (±3° plus its own width and 0.3 m), or a crown within
    // 12 m of the lens (it fills the frame) — trees further off are part of the street scene (§5 07 行道树)
    const TAN3 = Math.tan(3 * DEG), COS45 = Math.cos(45 * DEG);
    const testTrees = (x, y) => {
      const vx = tx - x, vy = ty - y, L = Math.hypot(vx, vy);
      for (const t of trees) {
        const dx = t.x - x, dy = t.y - y, dEye = Math.hypot(dx, dy);
        if (dEye < t.trunkR + 0.6) return { ok: false, reason: 'against a tree trunk' };
        if (dEye < t.crownR + 0.5 && t.crownBase < hE + 1.5 && t.top > hE) return { ok: false, reason: 'under a tree crown' };
        if (!(L > 1)) continue;
        if (dEye < 3 && (dx * vx + dy * vy) > COS45 * dEye * L) return { ok: false, reason: 'tree trunk beside the lens' };
        const s = (dx * vx + dy * vy) / (L * L);
        if (s <= 0.02 || s >= 0.92) continue;
        const a = s * L, perp = Math.abs(dx * vy - dy * vx) / L, hL = hE + (hT - hE) * s;
        if (hL < t.crownBase) { if (perp < t.trunkR + 0.3 + a * TAN3) return { ok: false, reason: 'view blocked by a tree trunk' }; }
        else if (hL < t.top && a < 12 && perp < t.crownR * 0.8) return { ok: false, reason: 'view blocked by a tree crown' };
      }
      return { ok: true };
    };
    const testAll = (x, y) => { const b = test(x, y); return b.ok && trees.length ? testTrees(x, y) : b; };
    const first = testAll(0, 0);
    if (first.ok) return null;
    // candidates: closer to the building and / or round it about the target point
    const b0 = Math.atan2(-tx, -ty);   // bearing target → eye
    const cands = [];
    for (const dd of [0, 4, -4, 8, -8, 16, -16, 24, -24, 35, -35]) for (const k of [1.25, 1.12, 1, 0.92, 0.85, 0.7, 0.56, 0.44, 0.34]) {
      if (!dd && k === 1) continue;
      const D = D0 * k;
      if (D < 5) continue;
      // (stepping back keeps the subject framed, wider: cheaper than stepping in by the same factor)
      cands.push({ dd, k, cost: Math.abs(dd) / 8 + (k < 1 ? (1 - k) * 3 : (k - 1) * 2.5) });
    }
    cands.sort((a, b) => a.cost - b.cost);
    // buildings + trees first; when no candidate clears both, buildings alone (only if they were the problem)
    for (const check of test(0, 0).ok ? [testAll] : [testAll, test]) {
      for (const c of cands) {
        const b = b0 + c.dd * DEG, D = D0 * c.k;
        const x = tx + Math.sin(b) * D, y = ty + Math.cos(b) * D;
        const res = check(x, y);
        if (this._clearTrace) this._clearTrace.push({ dd: c.dd, k: c.k, ok: res.ok, reason: res.reason });   // (verification hook)
        if (!res.ok) continue;
        const p = pos.clone().addScaledVector(e, x).addScaledVector(n, y);
        // walkable there: not in deep water
        if (this._dryHeight(p) == null) continue;
        return { pos: p, moved: +Math.hypot(x, y).toFixed(2), reason: first.reason };
      }
    }
    return null;
  }

  /** something (building / megastructure) overhead within 60 m of ECEF p */
  _isIndoor(p) {
    const up = new THREE.Vector3(p.x, p.y, p.z).normalize();
    try { return !!this.ground.raycast(p, up, { terrain: false, water: false, maxDist: 60 }); } catch { return false; }
  }

  /**
   * Two eye-level waypoints through the main entrance of a building (outside the door facing it,
   * then just inside), or null when the entrance is unknown.
   */
  _doorPath(info, lens) {
    const ent = entrancePose(info, 'main');
    if (!ent) return null;
    const eH = ent.pos.length() - R;
    const outside = ent.pos.clone().addScaledVector(ent.out, 2.6);
    const tH = this.ground.walkTerrainAt(outside, 0.01);
    outside.multiplyScalar((R + Math.max(tH, eH - 0.35) + WALK.eye) / outside.length());
    const inside = ent.pos.clone().addScaledVector(ent.out, -1.3);
    inside.multiplyScalar((R + eH + WALK.eye) / inside.length());
    const inward = ent.out.clone().negate();
    return [
      { position: outside, quaternion: this._eyeQuat(outside.clone().normalize(), inward, -3 * DEG), ...lens },
      { position: inside, quaternion: this._eyeQuat(inside.clone().normalize(), inward, -2 * DEG), ...lens, duration: 1.3 },
    ];
  }

  /** view names available for building `id` (synchronous: only once its focus data is known), or null */
  buildingViews(id = this.modes.focus.id) {
    // the focused building, or the building of the last buildingView / enterBuilding / getFocusInfo (CT3);
    // refreshed in the background with the city's 'full' anchors (or the kit's, generated in a worker)
    const info = this._knownInfo(id);
    if (!info) return null;
    this._wantViews(id, info);
    const cams = buildingCameras(info);
    return BUILDING_VIEWS.filter((n) => cams[n]).concat(Object.keys(cams).filter((n) => !BUILDING_VIEWS.includes(n)));
  }

  // ============================================================================== picking
  /** CONTRACT: selection-shaped hit under client (x, y) (screen centre when omitted) */
  pick(cx, cy) {
    const r = this.rayAt(cx, cy);
    return this.pickRay(r.o.clone(), r.d.clone());
  }

  pickRay(o, d) {
    const s = this.app.systems || {};
    const oR = new THREE.Vector3(o.x - origin.x, o.y - origin.y, o.z - origin.z);
    const valid = (h) => (h && Number.isFinite(h.distance) && h.distance >= 0 ? h : null);
    let city = null, mega = null, terr = null;
    try { city = valid(s.city?.raycast?.(oR, d)); } catch { /* */ }
    try { mega = valid(s.mega?.raycast?.(oR, d)); } catch { /* */ }
    try { terr = valid(s.terrain?.raycast?.(oR, d)); } catch { /* */ }
    if (terr && 'tile' in terr && terr.tile == null) terr = null; // sea-level guess, use our own fallback
    const tDist = terr ? terr.distance : Infinity;
    const slack = Number.isFinite(tDist) ? tDist * 0.002 + 2 : Infinity;
    const at = (dist) => { const p = new THREE.Vector3().copy(d).multiplyScalar(dist).add(o); return { x: p.x, y: p.y, z: p.z }; };
    let best = null;
    if (city && city.distance <= tDist + slack) {
      let spec = city.spec || null;
      const id = city.buildingId ?? city.id;
      if (!spec && s.city?.getBuilding) { try { const b = s.city.getBuilding(id); spec = (b && b.spec) || null; } catch { /* */ } }
      best = { type: 'building', id, spec, distance: city.distance, part: city.part ?? null, point: at(city.distance) };
    }
    if (mega && mega.distance <= tDist + slack && (!best || mega.distance + 1 < best.distance)) {
      best = { type: 'mega', id: mega.id ?? mega.megaId ?? null, part: mega.part ?? null, partId: mega.partId ?? null, chunk: mega.chunk ?? null, distance: mega.distance, point: at(mega.distance) };
    }
    if (best) return best;
    let dist = tDist, waterLevel = null;
    if (!terr) {
      const t = raySphere(o, d, R + this.ground.refHeight(o));
      if (t < 0) return null;
      dist = t;
    } else {
      // a click on water selects the point of the water surface (the sea floor below is seen through it)
      const hw = { distance: tDist, kind: 'terrain', point: new THREE.Vector3().copy(d).multiplyScalar(tDist).add(o) };
      this.ground._waterEntry(o, d, hw);
      if (hw.kind === 'water') { dist = hw.distance; waterLevel = hw.waterLevel; }
    }
    const p = at(dist);
    const ll = ecefToLatLonH(p.x, p.y, p.z);
    const h = terr && Number.isFinite(terr.h) && waterLevel == null ? terr.h : this.ground.terrainHeightLL(ll.lat, ll.lon);
    let province = 0, zone = 'Z';
    try { province = provinceAt(ll.lat, ll.lon); zone = zoneAt(ll.lat, ll.lon); } catch { /* maps not loaded */ }
    const sel = { type: 'location', lat: ll.lat, lon: ll.lon, h, province, zone, distance: dist, ecef: p };
    if (waterLevel != null) { sel.waterLevel = waterLevel; sel.depth = waterLevel - h; }
    return sel;
  }

  _processHover() {
    const r = this._hoverReq;
    if (!r) return;
    const now = performance.now();
    if (now - this._hoverT < 110 || this.drag || this.gesture || this.transition || this.pointerLocked) return;
    if (this.active.isMoving && this.active.isMoving() && now - this._hoverT < 450) return;
    this._hoverReq = null; this._hoverT = now;
    let hit = null;
    try { hit = this.pick(r.x, r.y); } catch { hit = null; }
    const key = !hit ? '' : hit.type === 'building' ? `b:${hit.id}` : hit.type === 'mega' ? `m:${hit.id}:${hit.part}` : `l:${hit.lat.toFixed(5)},${hit.lon.toFixed(5)}`;
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    this.app.state.setHover(hit);
  }

  _clearHover() {
    this._hoverReq = null;
    if (this._hoverKey) { this._hoverKey = ''; this.app.state.setHover(null); }
  }

  // ============================================================================== programmatic nav
  /** zoom by factor (>1 = closer) towards client (x, y) or the screen centre, with glide */
  zoomBy(factor, x, y) {
    if (!(factor > 0)) return;
    const vp = this.viewport();
    const cx = x ?? vp.left + vp.width / 2, cy = y ?? vp.top + vp.height / 2;
    this.interrupt('api');
    this.active.onWheel?.(cx, cy, Math.log(factor));
  }

  /** rotate heading / tilt (degrees) about the screen-centre ground point (orbit) */
  rotateBy(dHeadingDeg = 0, dTiltDeg = 0) {
    this.interrupt('api');
    const o = this.modes.orbit;
    if (this.active !== o) return;
    o.rotateHT(dHeadingDeg * DEG, dTiltDeg * DEG, o.pivot(true), dTiltDeg !== 0);
    o.constrain();
  }

  northUp() { if (this.active === this.modes.orbit) this.modes.orbit.startNorthUp(); }
  topDown() { if (this.active === this.modes.orbit) this.modes.orbit.startTopDown(); }

  /** ground height (m above sea level) at lat/lon: terrain or water surface, whichever is higher */
  groundHeightAt(lat, lon) {
    const p = latLonHToEcef(lat, lon, 0);
    _v.set(p.x, p.y, p.z);
    const t = this.ground.terrainHeightAt(_v, 0, true);
    _v.set(p.x, p.y, p.z);
    return Math.max(t, this.ground.waterLevelAt(_v, 0));
  }

  cameraInfo() {
    const rig = this.app.rig;
    const w = this.modes.walk;
    return {
      mode: this.active.name, shownMode: this.app.state.mode, pose: rig.getPose(), heightAboveGround: this.heightAboveGround(), focusDistance: this.focusDistance,
      transition: this.transition ? { progress: this.transition.progress, duration: this.transition.duration, mode: this.transition.mode } : null,
      autoTilt: this.modes.orbit.autoTilt, backDepth: this.backStack.length, pointerLocked: this.pointerLocked,
      walk: this.active === w ? { ...w.info } : null, focusId: this.focusId, perfMs: this.perf.ms,
      ground: { ...this.ground.stats }, hold: this.holdInfo(),
    };
  }

  // ============================================================================== input
  _dragKind(e) {
    if (this.active.name !== 'orbit') return 'look';
    if (e.pointerType === 'touch') return 'pan';
    if (e.button === 2 || (e.button === 0 && (e.ctrlKey || e.shiftKey || e.metaKey))) return 'rotate';
    if (e.button === 1 || (e.button === 0 && e.altKey)) return 'look';
    return 'pan';
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    this._vp = null;
    this._viewActive = true;
    this.interrupt('pointer');
    if (this.pointerLocked) {
      if (e.button === 0) { const c = this.viewport(); this._click(c.left + c.width / 2, c.top + c.height / 2, 0, 'mouse'); }
      e.preventDefault();
      return;
    }
    // pointerdown's default (focus change) is prevented below: leave UI controls / inputs explicitly so
    // camera keys work right after clicking into the view
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae !== this.el && typeof ae.blur === 'function') ae.blur();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button, type: e.pointerType || 'mouse', moved: false, ignore: false };
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      const kind = this._dragKind(e);
      this.drag = { id: e.pointerId, kind };
      this.active.onDragStart?.(kind, p.x, p.y);
      this._setCursor(kind === 'pan' ? 'grabbing' : kind === 'rotate' ? 'move' : 'default');
      if (kind === 'rotate') this._showPivot(true);
    } else if (this.pointers.size === 2) {
      if (this.drag) { this.active.onDragEnd?.(false); this.drag = null; this._showPivot(false); }
      const [a, b] = [...this.pointers.values()];
      this.gesture = { dist: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ids: [a.id, b.id], pa: { x: a.x, y: a.y }, pb: { x: b.x, y: b.y } };
      this.active.onGesture?.({ phase: 'start', x: this.gesture.mx, y: this.gesture.my });
    } else p.ignore = true;
    e.preventDefault();
  }

  _onPointerMove(e) {
    if (this.pointerLocked) {
      if (e.movementX || e.movementY) this.active.onLookDelta?.(e.movementX, e.movementY);
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if ((e.pointerType === 'mouse' || !e.pointerType) && !e.buttons) this._hoverReq = { x: e.clientX, y: e.clientY };
      return;
    }
    const x = e.clientX, y = e.clientY;
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    const thr = p.type === 'touch' ? 10 : 4;
    if (!p.moved && Math.abs(x - p.x0) + Math.abs(y - p.y0) > thr) p.moved = true;
    if (this.gesture) { if (this.gesture.ids.includes(e.pointerId)) this.gesture.dirty = true; return; }
    if (p.ignore) return;
    if (this.drag && this.drag.id === e.pointerId) this.active.onDragMove?.(x, y, dx, dy);
  }

  _gestureMove() {
    const g = this.gesture;
    const a = this.pointers.get(g.ids[0]), b = this.pointers.get(g.ids[1]);
    if (!a || !b) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dax = a.x - g.pa.x, day = a.y - g.pa.y, dbx = b.x - g.pb.x, dby = b.y - g.pb.y;
    // both fingers moving the same way, mostly vertically → tilt; otherwise pinch + twist
    const together = dax * dbx + day * dby > 0 && Math.abs(day) > Math.abs(dax) * 1.2 && Math.abs(dby) > Math.abs(dbx) * 1.2 &&
      Math.abs(dist - g.dist) < 0.35 * (Math.abs(day) + Math.abs(dby));
    const ev = { phase: 'move', x: mx, y: my, scale: 1, rotation: 0, dy: 0 };
    if (together) ev.dy = (day + dby) / 2;
    else { ev.scale = g.dist > 1 ? dist / g.dist : 1; ev.rotation = wrapPi(ang - g.ang); }
    g.dist = dist; g.ang = ang; g.mx = mx; g.my = my; g.pa.x = a.x; g.pa.y = a.y; g.pb.x = b.x; g.pb.y = b.y;
    this.active.onGesture?.(ev);
  }

  _onPointerUp(e, cancelled) {
    if (this.pointerLocked) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* */ }
    if (this.gesture) {
      if (this.pointers.size < 2) {
        if (this.gesture.dirty) { this.pointers.set(e.pointerId, p); this.gesture.dirty = false; this._gestureMove(); this.pointers.delete(e.pointerId); }
        this.active.onGesture?.({ phase: 'end' });
        this.gesture = null;
        for (const q of this.pointers.values()) q.ignore = true;
      }
      return;
    }
    if (p.ignore) return;
    if (this.drag && this.drag.id === e.pointerId) {
      this.active.onDragEnd?.(!cancelled);
      this.drag = null;
      this._setCursor('');
      this._showPivot(false);
    }
    if (!cancelled && !p.moved && performance.now() - p.t0 < 650) this._click(e.clientX, e.clientY, p.button, p.type);
  }

  _click(x, y, button, type) {
    const now = performance.now();
    const lc = this._lastClick;
    const tol = type === 'touch' ? 26 : 8;
    if (lc && now - lc.t < 380 && Math.abs(x - lc.x) + Math.abs(y - lc.y) < tol && lc.button === button) {
      this._lastClick = null;
      this._doubleClick(x, y, button);
      return;
    }
    this._lastClick = { t: now, x, y, button };
    if (button !== 0) return;
    const m = this.active.name;
    let sel = null;
    try { sel = this.pick(x, y); } catch (err) { console.warn('[controls] pick failed', err); }
    this.app.state.select(sel);
    // lock the pointer for mouse-look after the double-click window (a double-click walks instead);
    // transient user activation is still valid then
    if ((m === 'walk' || m === 'fly') && !this.pointerLocked && type === 'mouse' && this.lockOnClick) {
      clearTimeout(this._lockTimer);
      this._lockTimer = setTimeout(() => {
        this._lockTimer = null;
        const mm = this.active.name;
        if ((mm === 'walk' || mm === 'fly') && !this.pointerLocked && !this.transition) this._requestLock();
      }, 400);
    }
  }

  _doubleClick(x, y, button) {
    clearTimeout(this._lockTimer); this._lockTimer = null;
    const m = this.active.name;
    const px = this.pointerLocked ? undefined : x, py = this.pointerLocked ? undefined : y;
    if (m === 'walk') { this._walkTo(px, py); return; }
    if (button === 2) { this.flyToPoint(px, py, -1, { mode: m === 'focus' ? 'orbit' : undefined }); return; }
    let sel = null;
    try { sel = this.pick(px, py); } catch { /* */ }
    if (sel && sel.type === 'building' && m !== 'fly') { this.focusBuilding(sel.id, { spec: sel.spec || null }); return; }
    this.flyToPoint(px, py, 1, { mode: m === 'focus' ? 'orbit' : undefined });
  }

  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this._vp = null;
    this._viewActive = true;
    this.interrupt('wheel');
    let dy = e.deltaY;
    // normalise to pixels: a line-mode notch (Firefox: 3 lines) ≈ a pixel-mode notch (Chrome: 100 px)
    if (e.deltaMode === 1) dy *= 33; else if (e.deltaMode === 2) dy *= 600;
    const step = clamp(e.ctrlKey ? -dy * 0.012 : -dy * 0.0023, -1.2, 1.2);
    if (!step) return;
    let x = e.clientX, y = e.clientY;
    if (this.pointerLocked) { const c = this.viewport(); x = c.left + c.width / 2; y = c.top + c.height / 2; }
    this.active.onWheel?.(x, y, step);
  }

  _onSafariGesture(e, phase) {
    e.preventDefault();
    if (!this.enabled) return;
    if (phase === 'start') { this._sg = { scale: 1, rot: 0 }; this.interrupt('gesture'); this.active.onGesture?.({ phase: 'start', x: e.clientX, y: e.clientY }); return; }
    if (phase === 'end') { this._sg = null; this.active.onGesture?.({ phase: 'end' }); return; }
    const s = this._sg; if (!s) return;
    const scale = e.scale / s.scale, rot = ((e.rotation - s.rot) * DEG);
    s.scale = e.scale; s.rot = e.rotation;
    this.active.onGesture?.({ phase: 'move', x: e.clientX, y: e.clientY, scale, rotation: rot, dy: 0 });
  }

  _onKeyDown(e) {
    if (!this.enabled || e.defaultPrevented || e.isComposing || isTyping(e.target)) return;
    if (e.metaKey || e.ctrlKey) return;
    // the UI owns the keyboard while focus is inside it (#mars-ui); any other focused control
    // (button, tab, slider…) owns Tab / Enter / Space / arrows / Esc
    if (inUi(e.target) || inUi(document.activeElement) || isInteractive(e.target)) return;
    const code = e.code;
    const m = this.active.name;
    const nav = NAV_KEYS.has(code) || (FOCUS_KEYS.has(code) && m === 'focus');
    // Tab cycles modes only while the 3D view is the keyboard surface (else it is focus navigation)
    const tab = code === 'Tab' && (this._viewActive || this.pointerLocked);
    let consumed = nav || tab || code === 'KeyM' || code === 'Backspace' || code === 'Home' || code === 'AltLeft' || code === 'AltRight';
    // Esc / Enter are consumed only when they act here (the UI uses them otherwise: close, activate)
    if (code === 'Escape') consumed = !!(this.transition || this.path || this._focusReq) || m === 'focus' || m === 'walk' || m === 'fly';
    else if (code === 'Enter' || code === 'NumpadEnter') { const sel = this.app.state.selection; consumed = m === 'focus' || !!(sel && sel.type === 'building'); }
    if (consumed) e.preventDefault();
    if (e.repeat) return;
    if (nav) this.interrupt('key');
    this.keys.add(code);
    switch (code) {
      case 'Tab': if (tab) this.cycleMode(e.shiftKey ? -1 : 1); return;
      case 'KeyM': this.cycleMode(e.shiftKey ? -1 : 1); return;
      case 'Backspace': this.back(); return;
      case 'Home': this.home(); return;
      case 'Escape':
        if (this.transition || this.path) { this.cancelTransition(); return; }
        if (this._focusReq) { this._cancelFocusReq(true, 'cancelled'); return; }
        if (m === 'focus') this.setMode('orbit');
        else if (this.pointerLocked) this._exitLock();
        return;
      case 'Enter': case 'NumpadEnter': {
        if (m === 'focus') { this.enterBuilding(this.modes.focus.id); return; }
        const sel = this.app.state.selection;
        if (sel && sel.type === 'building') this.focusBuilding(sel.id, { spec: sel.spec || null });
        return;
      }
      default: break;
    }
    this.active.onKeyDown?.(code, e);
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') this.keys.clear(); // macOS swallows keyups while ⌘ is held
  }

  _releaseAll() {
    this.keys.clear();
    this._endDrags();
  }

  _endDrags() {
    if (this.drag) { this.active.onDragEnd?.(false); this.drag = null; }
    if (this.gesture) { this.active.onGesture?.({ phase: 'end' }); this.gesture = null; }
    for (const id of this.pointers.keys()) { try { this.el.releasePointerCapture(id); } catch { /* */ } }
    this.pointers.clear();
    this._setCursor('');
    this._showPivot(false);
  }

  _requestLock() {
    const el = this.el;
    if (!el || !el.requestPointerLock) return;
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => { try { const r2 = el.requestPointerLock(); if (r2 && r2.catch) r2.catch(() => {}); } catch { /* */ } });
    } catch { try { el.requestPointerLock(); } catch { /* */ } }
  }
  _exitLock() { if (document.pointerLockElement === this.el && document.exitPointerLock) document.exitPointerLock(); }
  _onLockChange() {
    if (this.pointerLocked) this._endDrags();
    this._updateOverlay();
  }

  // ============================================================================== overlay (crosshair / pivot)
  _makeOverlay() {
    const mk = (css) => { const d = document.createElement('div'); d.style.cssText = css; return d; };
    this._cross = mk('position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;pointer-events:none;z-index:20;display:none;' +
      'background:linear-gradient(rgba(255,255,255,.85),rgba(255,255,255,.85)) center/2px 10px no-repeat,linear-gradient(rgba(255,255,255,.85),rgba(255,255,255,.85)) center/10px 2px no-repeat;filter:drop-shadow(0 0 1px rgba(0,0,0,.8))');
    this._pivot = mk('position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid rgba(255,255,255,.8);border-radius:50%;pointer-events:none;z-index:20;display:none;box-shadow:0 0 0 1px rgba(0,0,0,.35),inset 0 0 0 1px rgba(0,0,0,.25)');
    this._cross.id = 'controls-crosshair'; this._pivot.id = 'controls-pivot';
    document.body.appendChild(this._cross); document.body.appendChild(this._pivot);
  }
  _updateOverlay() {
    if (!this._cross) return;
    const clean = !!(this.app.state.settings && this.app.state.settings.clean);
    const show = this.pointerLocked && !clean;
    this._cross.style.display = show ? 'block' : 'none';
    if (show) { const vp = this.viewport(); this._cross.style.left = `${vp.left + vp.width / 2}px`; this._cross.style.top = `${vp.top + vp.height / 2}px`; }
  }
  _showPivot(on) {
    if (!this._pivot) return;
    const clean = !!(this.app.state.settings && this.app.state.settings.clean);
    if (!on || clean) { this._pivot.style.display = 'none'; return; }
    const vp = this.viewport();
    this._pivot.style.left = `${vp.left + vp.width / 2}px`; this._pivot.style.top = `${vp.top + vp.height / 2}px`;
    this._pivot.style.display = 'block';
  }
  _setCursor(c) { if (this.el) this.el.style.cursor = c; }

  // ============================================================================== safety
  _markInternal() { this._lastRigVersion = this.app.rig.version; }

  _externalChange() {
    if (this.transition) this._endTransition(false, 'external', true);
    this._cancelPath();
    // a pose written after a focus / view request began overrides it (a request's own provisional pose,
    // written before it, was absorbed when it began)
    if (this._focusReq) this._cancelFocusReq(false, 'external');
    this.ground.invalidate();
    // a pose written from outside (URL pose, bookmark, __MARS__.goto, UI) is a programmatic pose: hold
    // it until the scene has refined (an orientation / lens-only change keeps the current hold)
    const p = this.app.rig.position, g = this._lastGood;
    const moved = !g || Math.abs(p.x - g.position.x) + Math.abs(p.y - g.position.y) + Math.abs(p.z - g.position.z) > 1e-4;
    const input = this._inputSeen || !!this.drag || !!this.gesture || this.anyNavKey();
    // (an eye-level pose written while walking keeps the walker at that height until its floor loads;
    // a pose high above any floor falls as before)
    if (input) this._hold = null;
    else if (moved || !this._hold) this._setHold('external', this.active === this.modes.walk && this._eyeLevelPose(p));
    const m = this.active;
    if (m === this.modes.focus) {
      const P = this.app.rig.position;
      const d = Math.hypot(P.x - m.C.x, P.y - m.C.y, P.z - m.C.z);
      if (d > m.maxDist * 1.5) { this._enterMode('orbit'); return; }
    }
    if (m.syncFromRig) m.syncFromRig(); else if (m.stop) m.stop();
  }

  _safety() {
    const rig = this.app.rig;
    if (!rig.isValid() || !(rig.lens == null || rig.lens > 0) || !(rig.fov > 0)) {
      if (!this._warned.nan) { console.warn('[controls] invalid camera state restored'); this._warned.nan = true; }
      if (this._lastGood) rig.restore(this._lastGood); else rig.setPose({ lat: 15, lon: 100, alt: 9.5e6 });
      if (!(rig.fov > 0)) rig.fov = 35;
      if (!(rig.lens == null || rig.lens > 0)) rig.lens = null;
      this.active.stop?.();
      if (this.active.syncFromRig) this.active.syncFromRig();
      return;
    }
    const p = rig.position;
    const L = Math.hypot(p.x, p.y, p.z);
    if (L > R + MAX_ALT) { const k = (R + MAX_ALT) / L; rig.setPosition(p.x * k, p.y * k, p.z * k); }
    else if (L - R < 30000 && this.active.name !== 'walk' && !this.transition) {
      // hard floor for every non-walking mode (the modes keep 1.7 m themselves; this is the net). A held
      // programmatic pose is checked against the final ground only (coarse tiles never lift it); fly
      // mode may dive below the water surface.
      const fly = this.active.name === 'fly';
      if (this._hold && this._holdOn(p)) {
        const a = this.ground.analyticAt(p);
        const floor = fly ? a.terrain : a.h;
        if (L < R + floor + 0.3) { const k = (R + floor + HOLD_CLEAR) / L; rig.setPosition(p.x * k, p.y * k, p.z * k); }
      } else {
        const floor = this.ground.floorHeightAt(p, { buildings: false, water: !fly });
        if (L < R + floor + 0.5) { const k = (R + floor + CLEAR) / L; rig.setPosition(p.x * k, p.y * k, p.z * k); }
      }
    }
    const g = this._lastGood || (this._lastGood = rig.snapshot());
    g.position.x = p.x; g.position.y = p.y; g.position.z = p.z;
    g.quaternion.copy(rig.quaternion); g.fov = rig.fov; g.lens = rig.lens;
  }

  _updateFocus() {
    if (this.transition) { if (Number.isFinite(this.transition.focusDistance)) this.focusDistance = this.transition.focusDistance; return; }
    const T = this.centerTargetFast();
    const p = this.app.rig.position;
    if (T) { this.target.copy(T); this.focusDistance = Math.hypot(T.x - p.x, T.y - p.y, T.z - p.z); }
    else this.focusDistance = Math.max(1, this.heightAboveGround());
  }

  _post() {
    this._updateDebug();
    if (!this._cross) return;
    const locked = this.pointerLocked;
    if (locked || this._cross.style.display !== 'none') this._updateOverlay();
  }

  // ============================================================================== debug layer
  /**
   * settings.debugLayer 'wireframe' (never in clean mode): the walk colliders around the camera
   * (city interiors / streets: cyan, megastructures: magenta) as a wireframe overlay below 400 m, so
   * collision geometry can be checked against what is drawn. Runs after App moved the origin.
   */
  _updateDebug() {
    const s = this.app.state.settings || {};
    const P = this.app.rig.position;
    const on = !s.clean && s.debugLayer === 'wireframe' && Math.hypot(P.x, P.y, P.z) - R < 30000 && this.heightAboveGround() < 400;
    const dbg = this._dbg || (this._dbg = { group: null, meshes: new Map(), t: -1e9, list: [] });
    if (!on) {
      if (dbg.group && dbg.group.visible) dbg.group.visible = false;
      return;
    }
    if (!dbg.group) {
      dbg.group = new THREE.Group(); dbg.group.name = 'controls:colliders'; dbg.group.matrixAutoUpdate = false;
      dbg.mats = {
        city: new THREE.MeshBasicMaterial({ color: 0x40e8ff, wireframe: true, transparent: true, opacity: 0.6, depthWrite: false, fog: false }),
        mega: new THREE.MeshBasicMaterial({ color: 0xff50e0, wireframe: true, transparent: true, opacity: 0.6, depthWrite: false, fog: false }),
      };
      this.app.scene.add(dbg.group);
    }
    dbg.group.visible = true;
    const now = performance.now();
    if (now - dbg.t > 400) {
      dbg.t = now;
      const w = this.modes.walk;
      dbg.list = this.active === w && w.colliders.length ? w.colliders : this.collidersNear(P, 40);
      // keyed by the collider mesh (the systems hand out fresh wrapper objects on every query)
      const keep = new Map();
      for (const c of dbg.list) keep.set(c.mesh, c);
      for (const [mesh, e] of dbg.meshes) if (!keep.has(mesh)) { dbg.group.remove(e.m); dbg.meshes.delete(mesh); }
      for (const [mesh, c] of keep) {
        const e = dbg.meshes.get(mesh);
        if (e) { e.c = c; continue; }
        const m = new THREE.Mesh(mesh.geometry, dbg.mats[c._src === 'mega' ? 'mega' : 'city']);
        m.matrixAutoUpdate = false; m.frustumCulled = false; m.renderOrder = 10; m.name = `controls:collider:${c.id ?? ''}`;
        dbg.group.add(m); dbg.meshes.set(mesh, { m, c });
      }
    }
    for (const e of dbg.meshes.values()) { e.m.matrix.copy(colliderMatrix(e.c)); e.m.matrixWorld.copy(e.m.matrix); }
    // unlit lines in the HDR scene: divide by the pipeline's current exposure so they read at about
    // their nominal colour after the output transform (daylight exposure is far below 1)
    const pe = this.app.pipeline && this.app.pipeline.exposure && this.app.pipeline.exposure.value > 0 ? this.app.pipeline.exposure.value : 1;
    const k = 0.8 / Math.max(pe * (s.exposure > 0 ? s.exposure : 1), 1e-5);
    dbg.mats.city.color.setRGB(0.25 * k, 0.9 * k, 1.0 * k);
    dbg.mats.mega.color.setRGB(1.0 * k, 0.3 * k, 0.88 * k);
  }
}
