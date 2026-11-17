// Focus mode — orbit around one building (§4 点击建筑聚焦并环看): drag orbits, wheel zooms,
// keys 1 front · 2 back · 3 left · 4 right · 5 roof (animated), arrows orbit, +/- zoom,
// Enter walks in through the main entrance, Esc returns to orbit mode. Never below ground
// (1.7 m clearance) and never inside the building's bounding radius.
// OWNER: controls agent.
//
// Building focus data (requested from render/city, see index.js normalizeFocusInfo):
//   city.focusInfo(id) -> { centerEcef:{x,y,z}, radius, heading?, spec?, entrances:[{kind,
//       positionEcef:{x,y,z}, dirEcef?:{x,y,z} | heading?, width?}] }   (may return a Promise)
import * as THREE from 'three';
import { R, DEG } from '../../core/constants.js';
import { latLonHToEcef, buildingAxes } from '../../core/geo.js';
import { clamp, damp, wrapPi, tangentBasis, quatLook } from '../math.js';

const CLEAR = 1.7;
const _up = new THREE.Vector3(), _e = new THREE.Vector3(), _n = new THREE.Vector3(), _off = new THREE.Vector3();
const _h = new THREE.Vector3(), _f = new THREE.Vector3(), _P = new THREE.Vector3(), _d = new THREE.Vector3(), _C = new THREE.Vector3();

/** bearing (rad) of a horizontal direction at a point with radial unit `up` */
function bearingOf(v, up) { tangentBasis(up, _e, _n); return Math.atan2(v.dot(_e), v.dot(_n)); }

/** horizontal unit vector for compass bearing b (rad) at `up` */
function dirOfBearing(b, up, out) { tangentBasis(up, _e, _n); return out.copy(_n).multiplyScalar(Math.cos(b)).addScaledVector(_e, Math.sin(b)).normalize(); }

/**
 * Building local frame (ARCHITECTURE §2: origin = footprint centre at ground.entrance, +Y up,
 * +Z = front facade normal) of a focus info: from info.frame {originEcef|origin, quaternion}
 * when the city provides it, else from the BuildingSpec (lat, lon, heading, ground.entrance).
 * Returns {toWorld(l:[x,y,z]|{x,y,z}, out:Vector3, isDir)} or null.
 */
export function buildingFrame(info) {
  if (!info) return null;
  const fr = info.frame || null;
  const fo = fr && (fr.originEcef || fr.origin || fr.anchor);
  if (fo && fr.quaternion && Number.isFinite(fo.x)) {
    const q = new THREE.Quaternion(fr.quaternion.x, fr.quaternion.y, fr.quaternion.z, fr.quaternion.w).normalize();
    const o = new THREE.Vector3(fo.x, fo.y, fo.z);
    return {
      toWorld(l, out, isDir) {
        out.set(Array.isArray(l) ? l[0] : l.x, Array.isArray(l) ? l[1] : l.y, Array.isArray(l) ? l[2] : l.z).applyQuaternion(q);
        return isDir ? out : out.add(o);
      },
    };
  }
  const spec = info.spec || null;
  if (!spec || !Number.isFinite(spec.lat) || !Number.isFinite(spec.lon)) return null;
  const ax = buildingAxes(spec.lat, spec.lon, spec.heading || 0);
  const o = latLonHToEcef(spec.lat, spec.lon, (spec.ground && spec.ground.entrance) || 0);
  return {
    toWorld(l, out, isDir) {
      const x = Array.isArray(l) ? l[0] : l.x, y = Array.isArray(l) ? l[1] : l.y, z = Array.isArray(l) ? l[2] : l.z;
      out.set(ax.x[0] * x + ax.y[0] * y + ax.z[0] * z, ax.x[1] * x + ax.y[1] * y + ax.z[1] * z, ax.x[2] * x + ax.y[2] * y + ax.z[2] * z);
      return isDir ? out : out.add(_P.set(o.x, o.y, o.z));
    },
  };
}

/** an ECEF {x,y,z} (|p| > 1e5 m) rather than a building-local offset */
const isEcef = (p) => !!p && !Array.isArray(p) && Number.isFinite(p.x) && Math.hypot(p.x, p.y || 0, p.z || 0) > 1e5;

/**
 * World pose of an entrance: {pos: Vector3 (ECEF, threshold centre at floor level),
 * out: Vector3 (unit horizontal outward normal), width, kind} or null.
 * Accepts ECEF entrances from focusInfo, building-local anchors {pos:[x,y,z], dir:[x,y,z]}, or
 * BuildingSpec entrances {side, offset, width} (urban specs.entrancePos convention: front x=offset,
 * back x=−offset, left z=−offset, right z=+offset).
 */
export function entrancePose(info, kind = 'main') {
  if (!info) return null;
  const spec = info.spec || null;
  const anchors = info.anchors && info.anchors.entrances;
  const list = (info.entrances && info.entrances.length ? info.entrances : anchors && anchors.length ? anchors : (spec && spec.entrances) || []);
  const ent = list.find((e) => e && e.kind === kind) || list.find((e) => e && /main|front|entry/.test(e.kind || '')) || list[0] || null;
  const frame = buildingFrame(info);
  const toWorld = (l, outV, isDir) => frame.toWorld(l, outV, isDir);
  const pos = new THREE.Vector3(), out = new THREE.Vector3();
  let ok = false;
  if (ent) {
    const pe = ent.positionEcef || ent.ecef || ent.worldPos || (isEcef(ent.position) ? ent.position : null);
    if (pe && Number.isFinite(pe.x)) { pos.set(pe.x, pe.y, pe.z); ok = true; }
    else if (Array.isArray(ent.pos) && frame) { toWorld(ent.pos, pos, false); ok = true; }
    else if (ent.side && frame && spec && spec.footprint) {
      const w = spec.footprint.w || 10, d = spec.footprint.d || 10;
      const side = ent.side, along = side === 'left' || side === 'right' ? d : w;
      const off = clamp(ent.offset || 0, -along / 2 + 0.6, along / 2 - 0.6);
      const l = side === 'back' ? [-off, 0, -d / 2] : side === 'left' ? [-w / 2, 0, -off] : side === 'right' ? [w / 2, 0, off] : [off, 0, d / 2];
      toWorld(l, pos, false); ok = true;
      const dl = side === 'back' ? [0, 0, -1] : side === 'left' ? [-1, 0, 0] : side === 'right' ? [1, 0, 0] : [0, 0, 1];
      toWorld(dl, out, true);
    }
    const de = ent.dirEcef || ent.normalEcef || ent.outward;
    if (de && Number.isFinite(de.x)) out.set(de.x, de.y, de.z);
    else if (Array.isArray(ent.dir) && frame) toWorld(ent.dir, out, true);
    else if (Number.isFinite(ent.heading) && ok) dirOfBearing(ent.heading * DEG, _up.copy(pos).normalize(), out);
  }
  if (!ok) {
    // fall back to the front facade centre
    if (!info.center) return null;
    const up = _up.copy(info.center).normalize();
    const hd = Number.isFinite(info.heading) ? info.heading * DEG : 0;
    dirOfBearing(hd, up, out);
    const halfD = spec && spec.footprint ? (spec.footprint.d || 10) / 2 : info.radius * 0.5;
    const groundH = spec && spec.ground ? spec.ground.entrance : info.center.length() - R - info.radius * 0.5;
    pos.copy(info.center).addScaledVector(out, halfD);
    pos.multiplyScalar((R + groundH) / pos.length());
    ok = true;
  }
  const up = _up.copy(pos).normalize();
  out.addScaledVector(up, -out.dot(up));
  if (out.lengthSq() < 1e-12) {
    // derive from the building centre
    out.copy(pos).sub(info.center || pos); out.addScaledVector(up, -out.dot(up));
    if (out.lengthSq() < 1e-12) tangentBasis(up, out, _n);
  }
  out.normalize();
  return { pos, out, width: (ent && ent.width) || 1.6, kind: (ent && ent.kind) || 'main' };
}

/** §5 shot 07 viewpoints, in visiting order (exterior → interior → back → roof) */
export const BUILDING_VIEWS = ['street', 'entrance', 'lobby', 'stair', 'living', 'back', 'roof'];
/** street-level views: their eye stands on the real (final) ground, 1.65 m above it */
export const GROUND_VIEWS = new Set(['street', 'entrance', 'back']);

/** building height (m above ground.entrance) estimated from the spec */
export function specHeight(spec) {
  if (!spec) return 0;
  const fl = spec.floors || 1, fh = spec.floorHeight || 3.1;
  return (fl - 1) * fh + (spec.groundFloorHeight || fh);
}

/**
 * Viewpoints of a building as ECEF {pos, target, ground, source} (Vector3s): from
 * focusInfo.cameras (ECEF {x,y,z} or building-local [x,y,z]), focusInfo.anchors.cameras
 * (BuildingMeshData anchors, building-local) or — exterior views only — synthesised from the spec
 * footprint, height and main entrance like the building kit's anchors. `ground` marks street-level
 * views whose eye height is re-measured on the real ground. Interior views (lobby, stair, living)
 * exist only when the city provides them.
 */
export function buildingCameras(info) {
  const out = {};
  if (!info) return out;
  const frame = buildingFrame(info);
  const add = (name, c, source) => {
    if (!c || out[name]) return;
    const p = c.pos || c.position, t = c.target || c.lookAt;
    if (!p || !t) return;
    const pos = new THREE.Vector3(), target = new THREE.Vector3();
    if (isEcef(p)) pos.set(p.x, p.y, p.z); else if (frame) frame.toWorld(p, pos, false); else return;
    if (isEcef(t)) target.set(t.x, t.y, t.z); else if (frame) frame.toWorld(t, target, false); else return;
    if (!(pos.distanceToSquared(target) > 1e-6)) return;
    out[name] = { pos, target, ground: GROUND_VIEWS.has(name), source };
  };
  for (const [src, list] of [['city', info.cameras], ['anchors', info.anchors && info.anchors.cameras], ['city', info.raw && info.raw.cameras]]) {
    if (list && typeof list === 'object') for (const k of Object.keys(list)) add(k, list[k], src);
  }
  const spec = info.spec;
  if (!frame || !spec || !spec.footprint) return out;
  // synthesised exterior views around the main entrance facade (same layout as kit/assemble.js)
  const w = spec.footprint.w || 12, d = spec.footprint.d || 10, H = specHeight(spec), eye = 1.65;
  const ents = (spec.entrances || []);
  const main = ents.find((e) => e && e.kind === 'main') || ents[0] || { side: 'front', offset: 0 };
  const side = main.side || 'front';
  // facade frame of the entrance side: n outward normal, u along the facade (viewer's right), door at (dx, dz)
  const n = side === 'back' ? [0, -1] : side === 'left' ? [-1, 0] : side === 'right' ? [1, 0] : [0, 1];
  const u = [n[1], -n[0]];
  const along = side === 'left' || side === 'right' ? d : w;
  const off = clamp(main.offset || 0, -along / 2 + 0.6, along / 2 - 0.6);
  const door = side === 'back' ? [-off, -d / 2] : side === 'left' ? [-w / 2, -off] : side === 'right' ? [w / 2, off] : [off, d / 2];
  const hn = side === 'left' || side === 'right' ? w / 2 : d / 2;    // half depth along n
  const at = (a, b, y) => [door[0] + n[0] * a + u[0] * b, y, door[1] + n[1] * a + u[1] * b];
  const mid = (a, b, y) => [n[0] * a + u[0] * b, y, n[1] * a + u[1] * b];  // from the footprint centre
  add('street', { pos: at(22, -4, eye), target: mid(hn, 0, Math.min(H * 0.45, 12)) }, 'spec');
  add('entrance', { pos: at(5.5, 2.2, eye), target: at(-2, 0, 1.3) }, 'spec');
  add('back', { pos: mid(-hn - 12, -0.2 * along, eye), target: mid(-hn, 0, 4) }, 'spec');
  add('roof', { pos: mid(0.25 * hn, 0.15 * along, H + eye), target: mid(-0.5 * hn, 0, H + 0.5) }, 'spec');
  return out;
}

export class FocusMode {
  constructor(ctrl) {
    this.ctrl = ctrl;
    this.name = 'focus';
    this.id = null;
    this.info = null;
    this.C = new THREE.Vector3();      // orbit centre (on the building, see syncFromRig)
    this.C0 = new THREE.Vector3();     // building centre
    this.tC = null;                    // centre being eased back to C0 (preset views)
    this.az = 0; this.el = 0.45; this.dist = 100;
    this.arm = 100; this._armWant = 100;   // camera distance actually used (spring arm, ≤ dist)
    this.tAz = 0; this.tEl = 0.45; this.tDist = 100;
    this.drag = null;
    this.minDist = 5; this.maxDist = 5000;
    this.minEl = -8 * DEG; this.maxEl = 88 * DEG;
    this._st = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  }
  get rig() { return this.ctrl.app.rig; }

  enter(opts = {}) {
    if (opts.info) this.setInfo(opts.id ?? this.id, opts.info);
    if (!this.info) return false;
    this.syncFromRig();
    // arrived in front of an occluder (spring arm shortened): keep the intended orbit distance
    if (opts.wantDist > this.dist) this.dist = this.tDist = clamp(opts.wantDist, this.minDist, this.maxDist);
    // neighbours that stream in after a long flight may block the view: rise over them for a while
    this._riseUntil = opts.keepPose ? 0 : performance.now() + 5000;
    return true;
  }
  exit() { this.drag = null; }
  stop() { this.tAz = this.az; this.tEl = this.el; this.tDist = this.dist; this.tC = null; }
  isMoving() {
    return !!this.drag || !!this.tC || Math.abs(this.arm - this._armWant) > 1e-3 || Math.abs(wrapPi(this.tAz - this.az)) > 1e-4 || Math.abs(this.tEl - this.el) > 1e-4 || Math.abs(Math.log(this.tDist / this.dist)) > 1e-4 || this.ctrl.anyNavKey();
  }

  setInfo(id, info) {
    this.id = id; this.info = info;
    this.C0.copy(info.center); this.C.copy(info.center); this.tC = null;
    this.minDist = Math.max(info.radius * 0.62 + 2.5, 4);
    this.maxDist = Math.max(info.radius * 30, 800);
  }

  /**
   * Adopt the current camera. The orbit centre is the point of the view axis closest to the
   * building centre when the view is on the building (a bookmark framing is kept exactly, no snap);
   * otherwise the building centre.
   */
  syncFromRig() {
    const P = this.rig.position;
    this.rig.forward(_f);
    const t = (this.C0.x - P.x) * _f.x + (this.C0.y - P.y) * _f.y + (this.C0.z - P.z) * _f.z;
    this.C.copy(this.C0); this.tC = null;
    if (t > 1e-3) {
      _d.set(P.x + _f.x * t, P.y + _f.y * t, P.z + _f.z * t);
      if (_d.distanceTo(this.C0) < (this.info ? this.info.radius : 20) * 1.1) this.C.copy(_d);
    }
    _off.set(P.x - this.C.x, P.y - this.C.y, P.z - this.C.z);
    const dist = Math.max(_off.length(), 1e-3);
    _up.copy(this.C).normalize();
    const v = _off.dot(_up);
    _h.copy(_off).addScaledVector(_up, -v);
    this.el = Math.atan2(v, _h.length());
    this.az = _h.lengthSq() > 1e-12 ? bearingOf(_h, _up) : (this.info.heading || 0) * DEG;
    this.dist = dist; this.arm = this._armWant = dist;
    this.tAz = this.az; this.tEl = clamp(this.el, this.minEl, this.maxEl); this.tDist = clamp(dist, this.minDist, this.maxDist);
  }

  /** camera state for (az, el, dist) around the focus centre */
  stateFor(az, el, dist, out = this._st) {
    _up.copy(this.C).normalize();
    dirOfBearing(az, _up, _d);
    out.position.copy(this.C).addScaledVector(_d, Math.cos(el) * dist).addScaledVector(_up, Math.sin(el) * dist);
    _f.copy(this.C).sub(out.position).normalize();
    quatLook(_f, _up, out.quaternion);
    return out;
  }

  /** preset view: 'front' | 'back' | 'left' | 'right' | 'roof' */
  view(name) {
    const hd = (this.info && Number.isFinite(this.info.heading) ? this.info.heading : 0) * DEG;
    const fit = this.fitDistance();
    if (this.C.distanceToSquared(this.C0) > 1e-8) this.tC = this.C0.clone(); // presets frame the whole building
    if (name === 'roof') { this.tEl = 72 * DEG; this.tDist = clamp(Math.max(this.tDist, fit * 0.9), this.minDist, this.maxDist); return; }
    const off = name === 'back' ? Math.PI : name === 'left' ? Math.PI / 2 : name === 'right' ? -Math.PI / 2 : 0;
    this.tAz = this.az + wrapPi(hd + off - this.az);
    this.tDist = clamp(fit, this.minDist, this.maxDist);
    // low and level when the street in front is open; in a dense block rise until the facade is seen
    // over the neighbours instead of pressing the camera against it (spring arm)
    this.tEl = this.clearElevation(this.tAz, 12 * DEG, this.tDist, this.C0);
  }

  /**
   * Lowest elevation ≥ el0 (radians) from which the building is seen over its neighbours at `dist`
   * (clear line of sight from the centre for ≥ 85 % of it); else the candidate with the longest clear
   * arm (lower ones preferred). Candidates up to el0 + 50°.
   */
  clearElevation(az, el0, dist, centre = this.C) {
    let best = el0, bestScore = -1, near = null;
    for (const add of [0, 6, 12, 18, 26, 34, 42, 50]) {
      const el = Math.min(el0 + add * DEG, this.maxEl);
      // the view axis and two rays 12° to either side (a neighbour right beside the camera would fill
      // the frame even when the axis itself is clear)
      let score = this.armLimit(az, el, dist, centre) / dist;
      if (score >= 0.55) score = Math.min(score, this.armLimit(az - 12 * DEG, el, 0.75 * dist, centre) / (0.75 * dist), this.armLimit(az + 12 * DEG, el, 0.75 * dist, centre) / (0.75 * dist));
      if (score >= 0.85) return el;
      // a low view from the street a little closer than the full framing (≥ 55 % of it) beats a
      // steep view from high above: taken unless a full framing appears within +18°
      if (score >= 0.55 && near == null && add <= 18) near = el;
      if (add === 18 && near != null) return near;
      if (score > bestScore * 1.2 + 0.02) { bestScore = score; best = el; }
    }
    return near ?? best;
  }

  fitDistance() {
    const vf = this.rig.vfov(this.ctrl.aspect()) * DEG;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.ctrl.aspect());
    return (this.info ? this.info.radius : 20) / Math.sin(Math.min(vf, hf) / 2) * 1.08;
  }

  onDragStart(kind, x, y) { this.drag = { x, y }; this._riseUntil = 0; }
  onDragMove(x, y, dx, dy) {
    if (!this.drag) return;
    const vp = this.ctrl.viewport();
    this.tAz += (dx / vp.width) * Math.PI * 1.3;
    this.tEl = clamp(this.tEl + (dy / vp.height) * Math.PI * 0.8, this.minEl, this.maxEl);
  }
  onDragEnd() { this.drag = null; }
  onWheel(x, y, step) { this._riseUntil = 0; this.tDist = clamp(this.tDist * Math.exp(-step), this.minDist, this.maxDist); }
  onGesture(g) {
    this._riseUntil = 0;
    if (g.phase !== 'move') return;
    if (g.scale) this.tDist = clamp(this.tDist / g.scale, this.minDist, this.maxDist);
    if (g.rotation) this.tAz -= g.rotation;
    if (g.dy) this.tEl = clamp(this.tEl - (g.dy / this.ctrl.viewport().height) * Math.PI * 0.8, this.minEl, this.maxEl);
  }
  onKeyDown(code) {
    const map = { Digit1: 'front', Digit2: 'back', Digit3: 'left', Digit4: 'right', Digit5: 'roof', Numpad1: 'front', Numpad2: 'back', Numpad3: 'left', Numpad4: 'right', Numpad5: 'roof' };
    if (map[code]) { this.view(map[code]); return true; }
    // eye-level viewpoints (§5 shot 07): 6 street, 7 lobby (else the entrance), 8 upper-floor room, 9 back
    const eye = { Digit6: 'street', Digit7: 'lobby', Digit8: 'living', Digit9: 'back', Numpad6: 'street', Numpad7: 'lobby', Numpad8: 'living', Numpad9: 'back' };
    if (eye[code] && this.id != null) { this.ctrl.buildingView(this.id, eye[code]); return true; }
    return false;
  }

  update(dt) {
    const ctrl = this.ctrl, k = ctrl.keys, rig = this.rig;
    if (!this.info) return;
    const has = (c) => k.has(c);
    const fast = has('ShiftLeft') || has('ShiftRight') ? 2.5 : 1;
    const ra = (has('ArrowRight') || has('KeyD') ? 1 : 0) - (has('ArrowLeft') || has('KeyA') ? 1 : 0);
    const re = (has('ArrowUp') || has('KeyW') ? 1 : 0) - (has('ArrowDown') || has('KeyS') ? 1 : 0);
    const zm = (has('Equal') || has('NumpadAdd') || has('PageUp') ? 1 : 0) - (has('Minus') || has('NumpadSubtract') || has('PageDown') ? 1 : 0);
    if (ra) this.tAz += ra * 70 * DEG * dt * fast;
    if (re) this.tEl = clamp(this.tEl + re * 45 * DEG * dt * fast, this.minEl, this.maxEl);
    if (zm) this.tDist = clamp(this.tDist * Math.exp(-zm * 1.6 * dt * fast), this.minDist, this.maxDist);
    if (ra || re || zm) this._riseUntil = 0;

    const a = damp(dt, this.drag ? 0.06 : 0.14);
    if (this.tC) {
      this.C.lerp(this.tC, a);
      if (this.C.distanceTo(this.tC) < 1e-4) { this.C.copy(this.tC); this.tC = null; }
    }
    this.az += wrapPi(this.tAz - this.az) * a;
    this.el += (this.tEl - this.el) * a;
    this.dist *= Math.exp(Math.log(this.tDist / this.dist) * a);
    // settle exactly (a resting orbit must stop changing the camera: rig.setStateIfChanged below)
    if (Math.abs(wrapPi(this.tAz - this.az)) < 1e-6) this.az = this.tAz;
    if (Math.abs(this.tEl - this.el) < 1e-6) this.el = this.tEl;
    if (Math.abs(Math.log(this.tDist / this.dist)) < 1e-6) this.dist = this.tDist;

    // neighbouring buildings: a spring arm — the orbit (azimuth / elevation) is never blocked, the
    // camera slides in front of whatever stands between it and the building (instantly when an
    // occluder appears, easing back out when it is gone), so presets always arrive and the camera
    // never enters a neighbour
    const want = this.armLimit(this.az, this.el, this.dist);
    // just arrived and the neighbours (streamed in meanwhile) press the camera against the building:
    // rise until it is seen over them (cancelled by any orbit input)
    if (this._riseUntil && !this.drag && want < 0.6 * this.dist) {
      const now = performance.now();
      if (now > this._riseUntil) this._riseUntil = 0;
      else if (!(now - (this._riseT || 0) < 300)) {
        this._riseT = now;
        const el = this.clearElevation(this.az, Math.max(this.tEl, this.el), this.dist);
        if (el > this.tEl + 1e-3) this.tEl = el;
      }
    }
    if (want < this.arm) this.arm = want;
    else this.arm += (want - this.arm) * damp(dt, 0.3);
    if (Math.abs(this.arm - want) < 1e-3) this.arm = want;
    this._armWant = want;
    const st = this.stateFor(this.az, this.el, this.arm);
    // ground clearance: raise the orbit elevation instead of pushing through
    const P = st.position;
    const L = P.length();
    // (a held programmatic pose is checked against the final ground: coarse tiles never lift it)
    const held = ctrl._hold && ctrl._holdOn(rig.position);
    const floor = held ? ctrl.ground.analyticAt(P, 0.05).h : ctrl.ground.floorHeightAt(P, { buildings: false });
    const minL = R + floor + (held ? 1.0 : CLEAR);
    if (L < minL) {
      P.multiplyScalar(minL / L);
      _off.copy(P).sub(this.C);
      _up.copy(this.C).normalize();
      const v = _off.dot(_up);
      _h.copy(_off).addScaledVector(_up, -v);
      const el = Math.atan2(v, _h.length());
      this.el = el; if (this.tEl < el) this.tEl = el;
      if (this.arm >= this.dist - 1e-6) this.dist = this.arm = _off.length();
      _f.copy(this.C).sub(P).normalize();
      quatLook(_f, _up, st.quaternion);
    }
    // only a real change bumps the rig version (a resting orbit lets the pipeline accumulate)
    rig.setStateIfChanged(P.x, P.y, P.z, st.quaternion);
  }

  /**
   * Largest camera distance ≤ dist at (az, el) with a clear line of sight from the focused
   * building: a ray from the orbit centre towards the camera (the building's own walls are skipped),
   * stopping 1.5 m in front of the first other building / megastructure surface.
   */
  armLimit(az, el, dist, centre = this.C) {
    const G = this.ctrl.ground;
    const C = _C.copy(centre);
    _up.copy(C).normalize();
    dirOfBearing(az, _up, _d);
    _f.copy(_d).multiplyScalar(Math.cos(el)).addScaledVector(_up, Math.sin(el)).normalize();
    _P.copy(C);
    let start = 0;
    for (let k = 0; k < 4; k++) {
      let hit = null;
      try { hit = G.raycast(_P, _f, { terrain: false, water: false, maxDist: dist - start + 1.5 }); } catch { hit = null; }
      if (!hit) return dist;
      const id = hit.raw ? (hit.raw.buildingId ?? hit.raw.id) : null;
      const t = start + hit.distance;
      if (id != null && this.id != null && String(id) === String(this.id)) { start = t + 0.05; _P.copy(C).addScaledVector(_f, start); continue; }
      // an occluder closer than the building's own clearance (shared walls): nothing to slide in front of
      return t - 1.5 < this.minDist ? dist : Math.min(t - 1.5, dist);
    }
    return dist;
  }
}
