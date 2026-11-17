// Orbit (globe) mode — Google-Earth style navigation at every altitude (60,000 km … 1.7 m).
//  * left drag: true sphere trackball — the grabbed surface point stays under the cursor
//    (rotation of the camera about the planet centre; works over the poles, no flips)
//  * wheel / trackpad / pinch: smooth exponential zoom towards the point under the cursor
//    (camera moves along the cursor ray, so that point stays fixed on screen), with glide
//  * right / ctrl / shift drag, two-finger twist + vertical swipe: heading about the screen-centre
//    ground point and tilt towards the horizon; near the ground the tilt continues as an in-place
//    look-up; middle drag: look around in place
//  * gentle automatic tilt-to-horizon below ~50 km while zooming in (any manual tilt disables it)
//  * keyboard: arrows/WASD pan, Q/E heading, R/F tilt, +/- zoom, N north-up, U top-down
//  * inertia on pan / rotate / zoom; altitude-dependent max tilt; zero roll; ground clearance
// OWNER: controls agent.
import * as THREE from 'three';
import { R, DEG } from '../../core/constants.js';
import { clamp, damp, smoothstep, raySphere, raySilhouette, horizonAngle, VelocityTracker, easeInOut, wrapPi } from '../math.js';
import { decompose } from '../lookat.js';

export const CLEAR = 1.7;
const AUTO_TILT_ALT = 50000;
const ORIGIN = new THREE.Vector3(0, 0, 0);

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _P = new THREE.Vector3(), _C = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _up = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _P0 = new THREE.Vector3(), _S0 = new THREE.Vector3(), _K = new THREE.Vector3();
const _SQ = new THREE.Quaternion();

/** auto-tilt schedule (radians) by height above ground */
export function desiredTilt(h) {
  const lh = Math.log(Math.max(h, 1));
  return (70 * smoothstep(Math.log(AUTO_TILT_ALT), Math.log(300), lh) + 12 * smoothstep(Math.log(300), Math.log(8), lh)) * DEG;
}

const SCHED = [[2.5e4, 89], [3e5, 80], [2e6, 60], [8e6, 34], [3e7, 10], [6e7, 2]];
function maxTiltSched(h) {
  if (h <= SCHED[0][0]) return SCHED[0][1];
  for (let i = 1; i < SCHED.length; i++) {
    if (h <= SCHED[i][0]) {
      const [h0, a0] = SCHED[i - 1], [h1, a1] = SCHED[i];
      const t = (Math.log(h) - Math.log(h0)) / (Math.log(h1) - Math.log(h0));
      return a0 + (a1 - a0) * t;
    }
  }
  return SCHED[SCHED.length - 1][1];
}
/** maximum tilt (radians, w.r.t. the target vertical) at height h above ground, distance L from centre */
export function maxTilt(h, L, groundR = R) {
  const sched = maxTiltSched(h) * DEG;
  const margin = (0.25 + 3.75 * smoothstep(1e4, 3e6, h)) * DEG;
  const a = Math.max(0, horizonAngle(L, groundR) - margin);
  const hit = Math.asin(clamp((L / groundR) * Math.sin(a), 0, 1));
  return Math.min(sched, hit);
}

export class OrbitMode {
  constructor(ctrl) {
    this.ctrl = ctrl;
    this.name = 'orbit';
    this.drag = null;
    this.panVel = new THREE.Vector3();
    this.rotVel = { head: 0, tilt: 0, pivot: null };
    this.lookVel = { yaw: 0, pitch: 0 };
    this.zoomPending = 0;
    this.zoomAnchor = new THREE.Vector3();
    this.zoomAnchorKind = null;
    this.skyDist = 60;
    this.zoomAnchorAt = { x: -1e9, y: -1e9, t: 0, centre: false };
    this.autoTilt = true;
    this.landing = 0;
    this._pushed = 0;
    this.anim = null;
    this.keyVel = { fw: 0, rt: 0, head: 0, tilt: 0, zoom: 0 };
    this.panTracker = new VelocityTracker(90);
    this.headTracker = new VelocityTracker(90);
    this.tiltTracker = new VelocityTracker(90);
    this.gesture = null;
  }

  get rig() { return this.ctrl.app.rig; }

  enter() { this.stop(); }
  exit() { this.stop(); this.drag = null; }

  /** stop every motion (inertia, glide, animation) */
  stop() {
    this.panVel.set(0, 0, 0);
    this.rotVel.head = this.rotVel.tilt = 0;
    this.lookVel.yaw = this.lookVel.pitch = 0;
    this.zoomPending = 0;
    this.landing = 0;
    this.anim = null;
    for (const k in this.keyVel) this.keyVel[k] = 0;
  }

  isMoving() {
    return !!this.drag || this.panVel.lengthSq() > 0 || Math.abs(this.zoomPending) > 1e-4 || this.landing > 0 || this.rotVel.head !== 0 || this.rotVel.tilt !== 0 ||
      this.lookVel.yaw !== 0 || this.lookVel.pitch !== 0 || !!this.anim || !!this.gesture || this.ctrl.anyNavKey() ||
      this.keyVel.fw !== 0 || this.keyVel.rt !== 0 || this.keyVel.head !== 0 || this.keyVel.tilt !== 0 || this.keyVel.zoom !== 0;
  }

  // ------------------------------------------------------------------------------ input
  onDragStart(kind, x, y) {
    this.anim = null;
    this.panVel.set(0, 0, 0);
    this.rotVel.head = this.rotVel.tilt = 0;
    this.lookVel.yaw = this.lookVel.pitch = 0;
    const ctrl = this.ctrl;
    const hAG = ctrl.heightAboveGround();
    if (kind === 'pan') {
      const ray = ctrl.rayAt(x, y);
      const s = ctrl.ground.surfacePoint(ray.o, ray.d);
      if (s.kind === 'silhouette' && hAG < AUTO_TILT_ALT) kind = 'look'; // dragging the sky near the ground looks around
      else {
        this.drag = { kind, x, y, G: s.point.clone(), rG: s.point.length(), gKind: s.kind };
        this.panTracker.reset();
        return;
      }
    }
    if (kind === 'rotate') {
      this.drag = { kind, x, y, dx: 0, dy: 0, pivot: this.pivot(true) };
      this.headTracker.reset(); this.tiltTracker.reset();
      return;
    }
    this.drag = { kind: 'look', x, y, dx: 0, dy: 0 };
    this.headTracker.reset(); this.tiltTracker.reset();
  }

  onDragMove(x, y, dx, dy) {
    const d = this.drag; if (!d) return;
    d.x = x; d.y = y;
    if (d.kind !== 'pan') { d.dx += dx; d.dy += dy; }
  }

  onDragEnd(fling = true) {
    const d = this.drag; this.drag = null;
    if (!d || !fling) return;
    const now = performance.now();
    if (d.kind === 'pan') {
      const v = this.panTracker.rate(now, _zero);
      const w = v.length();
      const maxW = 2.5; // rad/s cap
      if (w > maxW) v.multiplyScalar(maxW / w);
      this.panVel.copy(v);
    } else if (d.kind === 'rotate') {
      this.rotVel.head = clamp(this.headTracker.rate(now, 0), -6, 6);
      this.rotVel.tilt = clamp(this.tiltTracker.rate(now, 0), -3, 3);
      this.rotVel.pivot = d.pivot;
    } else {
      this.lookVel.yaw = clamp(this.headTracker.rate(now, 0), -6, 6);
      this.lookVel.pitch = clamp(this.tiltTracker.rate(now, 0), -3, 3);
    }
  }

  /** wheel / trackpad step. step > 0 zooms in (natural-log units of distance). */
  onWheel(x, y, step) {
    this.anim = null;
    const now = performance.now();
    const za = this.zoomAnchorAt;
    const P = this.rig.position;
    const skyNear = this.zoomAnchorKind === 'sky' && step > 0 &&
      Math.hypot(P.x - this.zoomAnchor.x, P.y - this.zoomAnchor.y, P.z - this.zoomAnchor.z) < 0.4 * this.skyDist;
    if (Math.abs(x - za.x) + Math.abs(y - za.y) > 3 || now - za.t > 260 || za.centre || skyNear ||
      Math.sign(step) !== Math.sign(this.zoomPending || step)) {
      this.pickZoomAnchor(x, y, step);
      za.x = x; za.y = y; za.centre = false;
    }
    za.t = now;
    this.zoomPending = clamp(this.zoomPending + step, -6, 6);
  }

  /**
   * Zoom anchor under client (x, y) (screen centre when undefined): the visible surface point, or
   * the planet silhouette point when the ray misses. Zooming IN with the cursor in the sky near the
   * ground dollies forward horizontally along the cursor's azimuth instead (kind 'sky').
   */
  pickZoomAnchor(x, y, step) {
    const ctrl = this.ctrl, rig = this.rig;
    const ray = x === undefined ? ctrl.rayAt() : ctrl.rayAt(x, y);
    const s = ctrl.ground.surfacePoint(ray.o, ray.d);
    this.zoomAnchorKind = s.kind;
    if (s.kind === 'silhouette' && step > 0) {
      const hAG = ctrl.heightAboveGround();
      if (hAG < AUTO_TILT_ALT) {
        rig.localUp(_up);
        _dir.copy(ray.d).addScaledVector(_up, -ray.d.dot(_up));
        if (_dir.lengthSq() < 1e-8) { rig.forward(_dir); _dir.addScaledVector(_up, -_dir.dot(_up)); }
        if (_dir.lengthSq() > 1e-12) {
          _dir.normalize();
          this.skyDist = clamp(25 * Math.max(hAG, 1), 60, 5e4);
          const P = rig.position;
          this.zoomAnchor.set(P.x + _dir.x * this.skyDist, P.y + _dir.y * this.skyDist, P.z + _dir.z * this.skyDist);
          this.zoomAnchorKind = 'sky';
          return;
        }
      }
    }
    this.zoomAnchor.copy(s.point);
  }

  /** re-pick the zoom anchor under the last zoom cursor position (or the screen centre) */
  repickZoomAnchor() {
    const za = this.zoomAnchorAt;
    this.pickZoomAnchor(za.centre ? undefined : za.x, za.centre ? undefined : za.y, Math.sign(this.zoomPending) || 1);
    za.t = performance.now();
  }

  /** two-finger touch: scale ratio, rotation (rad, screen CW positive), midpoint dy (px) since last */
  onGesture(g) {
    this.anim = null;
    if (g.phase === 'start') {
      this.gesture = { x: g.x, y: g.y, pivot: this.pivot(true) };
      const ray = this.ctrl.rayAt(g.x, g.y);
      this.gesture.anchor = this.ctrl.ground.surfacePoint(ray.o, ray.d).point.clone();
      this.panVel.set(0, 0, 0); this.zoomPending = 0;
      return;
    }
    if (g.phase === 'end') { this.gesture = null; return; }
    const ge = this.gesture; if (!ge) return;
    if (Math.abs(g.x - ge.x) + Math.abs(g.y - ge.y) > 40) {
      const ray = this.ctrl.rayAt(g.x, g.y);
      ge.anchor.copy(this.ctrl.ground.surfacePoint(ray.o, ray.d).point);
      ge.x = g.x; ge.y = g.y;
    }
    if (g.scale && Math.abs(Math.log(g.scale)) > 1e-5) { this.ctrl.zoomTowards(ge.anchor, Math.log(g.scale), { minDist: CLEAR, clearance: CLEAR }); this.enforceTilt(ge.anchor); this.ctrl.levelRoll(Infinity, ge.anchor); }
    const vp = this.ctrl.viewport();
    if (g.rotation) this.rotateHT(-g.rotation, 0, ge.pivot, false);
    if (g.dy) this.rotateHT(0, (-g.dy / vp.height) * Math.PI * 0.9, ge.pivot, true);
  }

  onKeyDown(code) {
    if (code === 'KeyN') { this.startNorthUp(); return true; }
    if (code === 'KeyU') { this.startTopDown(); return true; }
    return false;
  }

  // ------------------------------------------------------------------------------ helpers
  /** pivot for heading/tilt: the screen-centre ground point when reasonably near, else null (in place) */
  pivot(precise) {
    const ctrl = this.ctrl;
    const T = ctrl.centerTarget(precise);
    if (!T) return null;
    const hAG = ctrl.heightAboveGround();
    const P = this.rig.position;
    const dist = Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z);
    if (dist > Math.max(hAG * 60, 600)) return null;
    return T.clone();
  }

  /**
   * Heading / tilt change. dHead > 0 turns the view to the right (heading increases), dTilt > 0
   * tilts towards the horizon. pivot: ECEF point (orbit about it) or null (rotate in place).
   */
  rotateHT(dHead, dTilt, pivot, userTilt) {
    const rig = this.rig;
    if (userTilt && dTilt) this.autoTilt = false;
    if (!pivot) { this.lookInPlace(dHead, dTilt); return; }
    _up.copy(pivot).normalize();
    if (dHead) { _q.setFromAxisAngle(_up, -dHead); rig.rotateAbout(pivot, _q); }
    if (dTilt) {
      const P = rig.position;
      _a.set(P.x - pivot.x, P.y - pivot.y, P.z - pivot.z);
      const dist = _a.length();
      if (dist < 1e-6) return;
      const tau = Math.acos(clamp(_a.dot(_up) / dist, -1, 1));
      const hAG = this.ctrl.heightAboveGround();
      const tmax = Math.min(maxTilt(hAG, Math.hypot(P.x, P.y, P.z), pivot.length()), this.floorTiltLimit(pivot, dist, hAG));
      let apply = dTilt, excess = 0;
      if (dTilt > 0) { apply = Math.min(dTilt, Math.max(0, tmax - tau)); excess = dTilt - apply; }
      else apply = Math.max(dTilt, -tau);
      if (apply) {
        this.horizRight(_r, _up);
        _q.setFromAxisAngle(_r, apply);
        rig.rotateAbout(pivot, _q);
      }
      if (excess > 1e-9 && hAG < 3000) this.lookInPlace(0, excess);
    }
  }

  /**
   * Largest tilt (radians from the pivot vertical) that keeps the camera CLEAR above the floor under
   * it while rotating about `pivot` at distance `dist` (tilting towards the horizon lowers the camera).
   */
  floorTiltLimit(pivot, dist, hAG = this.ctrl.heightAboveGround()) {
    if (hAG > 3000) return Math.PI;
    const floorH = this.rig.radius - R - hAG;
    const rhs = (floorH + CLEAR - (pivot.length() - R)) / Math.max(dist, 1e-6);
    return rhs >= 1 ? 0 : rhs <= -1 ? Math.PI : Math.acos(rhs);
  }

  /** camera right vector made horizontal w.r.t. up (falls back to the raw right) */
  horizRight(out, up) {
    this.rig.right(out);
    out.addScaledVector(up, -out.dot(up));
    if (out.lengthSq() < 1e-12) this.rig.right(out);
    return out.normalize();
  }

  /** in-place yaw (about the local vertical) and pitch (about the camera right) */
  lookInPlace(dYaw, dPitch) {
    const rig = this.rig;
    rig.localUp(_up);
    if (dYaw) { _q.setFromAxisAngle(_up, -dYaw); rig.rotateInPlace(_q); }
    if (dPitch) {
      rig.forward(_f);
      const p = Math.asin(clamp(_f.dot(_up), -1, 1));
      const np = clamp(p + dPitch, -89.95 * DEG, this.maxPitchUp());
      if (np !== p) { this.horizRight(_r, _up); _q.setFromAxisAngle(_r, np - p); rig.rotateInPlace(_q); }
    }
  }

  /** highest allowed pitch for in-place look: +30° near the ground, the planet must stay in view above */
  maxPitchUp() {
    const hAG = this.ctrl.heightAboveGround();
    if (hAG < 3000) return 30 * DEG;
    const L = this.rig.radius;
    const margin = (0.25 + 3.75 * smoothstep(1e4, 3e6, hAG)) * DEG;
    return -(Math.PI / 2 - horizonAngle(L, R + this.ctrl.groundRefHeight())) - margin;
  }

  /** apply the camera rotation that keeps grab point G under the cursor */
  panToCursor(now) {
    const d = this.drag, rig = this.rig, ctrl = this.ctrl;
    const ray = ctrl.rayAt(d.x, d.y);
    const t = raySphere(ray.o, ray.d, d.rG);
    if (t >= 0) _C.copy(ray.d).multiplyScalar(t).add(ray.o);
    else raySilhouette(ray.o, ray.d, d.rG, _C);
    _a.copy(_C).normalize(); _b.copy(d.G).normalize();
    // camera rotation taking C to G. Angle via atan2(|a×b|, a·b): at street level the angle is
    // ~1e-8 rad, far below what acos(q.w) can resolve in float64.
    _t.crossVectors(_a, _b);
    const sn = _t.length();
    let ang = Math.atan2(sn, _a.dot(_b));
    if (!(ang > 0) || !(sn > 0)) return;
    _t.multiplyScalar(1 / sn);
    const hAG = ctrl.heightAboveGround();
    const gDist = d.G.distanceTo(ray.o);
    const maxAng = Math.max(6 * hAG, 0.3 * gDist, 50) / d.rG;
    if (ang > maxAng) ang = maxAng;
    _q.setFromAxisAngle(_t, ang);
    rig.rotateAbout(ORIGIN, _q);
    this.panTracker.push(now, _t.multiplyScalar(ang));
  }

  // ------------------------------------------------------------------------------ animations
  startNorthUp() {
    for (const k in this.keyVel) this.keyVel[k] = 0;
    this.rotVel.head = this.rotVel.tilt = 0;
    const T = this.ctrl.centerTarget(true);
    if (!T) { this.anim = { kind: 'yaw', total: -this.currentHeadingInPlace(), applied: 0, t: 0, dur: 0.7 }; return; }
    const dec = decompose(this.rig.position, this.rig.quaternion, T, {});
    let h = dec.heading * DEG; h = wrapPi(h);
    this.anim = { kind: 'head', pivot: T.clone(), total: -h, applied: 0, t: 0, dur: 0.75 };
  }

  startTopDown() {
    for (const k in this.keyVel) this.keyVel[k] = 0;
    this.rotVel.head = this.rotVel.tilt = 0;
    const T = this.ctrl.centerTarget(true);
    this.autoTilt = false;
    if (!T) { // looking above the horizon: pitch down in place
      this.rig.forward(_f); this.rig.localUp(_up);
      const p = Math.asin(clamp(_f.dot(_up), -1, 1));
      this.anim = { kind: 'pitch', total: -Math.PI / 2 - p, applied: 0, t: 0, dur: 0.8 };
      return;
    }
    const dec = decompose(this.rig.position, this.rig.quaternion, T, {});
    this.anim = { kind: 'tilt', pivot: T.clone(), total: -dec.tilt, applied: 0, t: 0, dur: 0.8 };
  }

  currentHeadingInPlace() {
    const p = this.rig.getPose();
    return wrapPi(p.heading * DEG);
  }

  animate(dt) {
    const a = this.anim; if (!a) return;
    a.t += dt;
    const e = easeInOut(a.t / a.dur);
    const target = a.total * e, delta = target - a.applied;
    a.applied = target;
    // 'head'/'yaw': total = heading change (rad, + = turn right); 'tilt'/'pitch': tilt/pitch change
    if (a.kind === 'head') { _up.copy(a.pivot).normalize(); _q.setFromAxisAngle(_up, -delta); this.rig.rotateAbout(a.pivot, _q); }
    else if (a.kind === 'tilt') { _up.copy(a.pivot).normalize(); this.horizRight(_r, _up); _q.setFromAxisAngle(_r, delta); this.rig.rotateAbout(a.pivot, _q); }
    else if (a.kind === 'yaw') this.lookInPlace(delta, 0);
    else if (a.kind === 'pitch') this.lookInPlace(0, delta);
    if (a.t >= a.dur) this.anim = null;
  }

  // ------------------------------------------------------------------------------ frame update
  update(dt) {
    const ctrl = this.ctrl, rig = this.rig;
    const now = performance.now();
    _P0.set(rig.position.x, rig.position.y, rig.position.z);
    this.animate(dt);
    this.updateZoom(dt);

    const d = this.drag;
    if (d && d.kind === 'pan') this.panToCursor(now);
    else if (this.panVel.lengthSq() > 0) {
      const w = this.panVel.length();
      _a.copy(this.panVel).multiplyScalar(1 / w);
      _q.setFromAxisAngle(_a, w * dt);
      rig.rotateAbout(ORIGIN, _q);
      this.panVel.multiplyScalar(Math.exp(-dt / 0.42));
      const hAG = ctrl.heightAboveGround();
      if (w * rig.radius < 0.03 * Math.max(hAG, 2)) this.panVel.set(0, 0, 0);
    }

    const vp = ctrl.viewport();
    if (d && d.kind === 'rotate') {
      const dHead = (d.dx / vp.width) * Math.PI * 1.25;
      const dTilt = (-d.dy / vp.height) * Math.PI * 0.85;
      d.dx = d.dy = 0;
      this.rotateHT(dHead, dTilt, d.pivot, dTilt !== 0);
      this.headTracker.push(now, dHead); this.tiltTracker.push(now, dTilt);
    } else if (this.rotVel.head || this.rotVel.tilt) {
      this.rotateHT(this.rotVel.head * dt, this.rotVel.tilt * dt, this.rotVel.pivot, false);
      const k = Math.exp(-dt / 0.26);
      this.rotVel.head *= k; this.rotVel.tilt *= k;
      if (Math.abs(this.rotVel.head) < 0.004 && Math.abs(this.rotVel.tilt) < 0.004) this.rotVel.head = this.rotVel.tilt = 0;
    }
    if (d && d.kind === 'look') {
      const s = (this.rig.vfov(ctrl.aspect()) * DEG) / vp.height;
      const dYaw = -d.dx * s, dPitch = d.dy * s;
      d.dx = d.dy = 0;
      this.lookInPlace(dYaw, dPitch);
      this.headTracker.push(now, dYaw); this.tiltTracker.push(now, dPitch);
    } else if (this.lookVel.yaw || this.lookVel.pitch) {
      this.lookInPlace(this.lookVel.yaw * dt, this.lookVel.pitch * dt);
      const k = Math.exp(-dt / 0.2);
      this.lookVel.yaw *= k; this.lookVel.pitch *= k;
      if (Math.abs(this.lookVel.yaw) < 0.003 && Math.abs(this.lookVel.pitch) < 0.003) this.lookVel.yaw = this.lookVel.pitch = 0;
    }

    this.updateKeys(dt);
    // never move through buildings / megastructures (swept ray + collider push-out near the ground)
    const blocked = ctrl.sweepFrom(_P0, 1.0);
    if (blocked) {
      this.panVel.set(0, 0, 0);
      // the line to the zoom anchor is now obstructed: zoom towards what is visible under the cursor
      if (this.zoomPending > 0) this.repickZoomAnchor();
    }
    this.constrain();
    // the terrain lifted the camera while grabbing: solve the grab again at the new height
    if (d && d.kind === 'pan' && !blocked && this._pushed > 0) {
      for (let i = 0; i < 4 && this._pushed > 1e-3; i++) { this.panToCursor(now); this._pushed = ctrl.clampAbove(CLEAR); }
    }
  }

  updateZoom(dt) {
    this.updateLanding(dt);
    if (Math.abs(this.zoomPending) < 1e-5) { this.zoomPending = 0; return; }
    const ctrl = this.ctrl;
    const s = this.zoomPending * damp(dt, 0.12);
    this.zoomPending -= s;
    if (this.zoomAnchorKind === 'sky' && s > 0) { this.skyDolly(s); return; }
    const h0 = ctrl.heightAboveGround();
    const res = ctrl.zoomTowards(this.zoomAnchor, s, { minDist: CLEAR, clearance: CLEAR });
    if (res.clamped) {
      const rest = Math.max(0, s - res.applied);
      const extra = this.zoomPending + rest;
      if (res.clampedBy === 'floor' && extra > 0 && s > 0) {
        // at the floor (GE-style landing): first lift the view towards the horizon, then keep
        // pushing in by gliding along the ground towards the anchor
        if (this.autoTilt && this.landingRoom() > 0.01) { this.landing = Math.min(1.5, (this.landing || 0) + extra * 0.5); this.zoomPending = 0; }
        else if (!this.groundGlide(rest)) this.zoomPending = 0;
      } else this.zoomPending = 0;
    }
    const h1 = ctrl.heightAboveGround(true);
    if (h1 > AUTO_TILT_ALT * 1.05) this.autoTilt = true;
    if (this.autoTilt && Math.min(h0, h1) < AUTO_TILT_ALT) {
      let dT = desiredTilt(h1) - desiredTilt(h0);
      const P = this.rig.position;
      const dist = this.zoomAnchor.distanceTo(_P.set(P.x, P.y, P.z));
      dT *= clamp((6 * Math.max(h1, 1)) / Math.max(dist, 1e-3), 0, 1);
      if (Math.abs(dT) > 1e-7) this.tiltAbout(this.zoomAnchor, dT);
    }
    this.enforceTilt(this.zoomAnchor);
    this.levelAbout(this.zoomAnchor);
  }

  /** pitch-up still owed by the landing schedule at this height (radians, ≤ 0 when done) */
  landingRoom() {
    const rig = this.rig;
    rig.forward(_f); rig.localUp(_up);
    return desiredTilt(this.ctrl.heightAboveGround()) - Math.PI / 2 - Math.asin(clamp(_f.dot(_up), -1, 1));
  }

  /**
   * Zoom-in clamped by the floor: glide along the ground towards the zoom anchor so that its
   * horizontal distance scales by e^(−s), stopping 1.5 m short. Returns false once there.
   */
  groundGlide(s) {
    const rig = this.rig, P = rig.position, A = this.zoomAnchor;
    rig.localUp(_up);
    _a.set(A.x - P.x, A.y - P.y, A.z - P.z);
    _a.addScaledVector(_up, -_a.dot(_up));
    const dh = _a.length(), stop = 1.5;
    if (!(dh > stop + 1e-3)) return false;
    const step = dh - Math.max(stop, dh * Math.exp(-s));
    _a.multiplyScalar(1 / dh);
    _t.crossVectors(_up, _a).normalize();
    _q.setFromAxisAngle(_t, step / rig.radius);
    rig.rotateAbout(ORIGIN, _q);
    return true;
  }

  /**
   * Zoom-in towards a 'sky' anchor: glide forward along the ground (rotation about the planet centre,
   * constant altitude; the floor clamp lifts the camera over rising ground, sweeps stop at walls).
   */
  skyDolly(s) {
    const rig = this.rig, P = rig.position, A = this.zoomAnchor;
    _a.set(A.x - P.x, A.y - P.y, A.z - P.z);
    const d = _a.length();
    if (!(d > 1e-6)) return;
    rig.localUp(_up);
    _a.addScaledVector(_up, -_a.dot(_up));
    const lh = _a.length();
    if (lh < 1e-9) return;
    _a.multiplyScalar(1 / lh);
    const step = d * (1 - Math.exp(-s));
    _t.crossVectors(_up, _a).normalize();
    _q.setFromAxisAngle(_t, step / rig.radius);
    rig.rotateAbout(ORIGIN, _q);
  }

  /**
   * Find phi such that fn() == 0 after rigidly rotating the camera by phi about the axis k through
   * pivot A (secant method from the saved state). Leaves the camera at the best solution found.
   */
  solveAbout(A, k, fn, guess) {
    const rig = this.rig;
    _S0.set(rig.position.x, rig.position.y, rig.position.z); _SQ.copy(rig.quaternion);
    const apply = (phi) => {
      _q.setFromAxisAngle(k, phi);
      _a.copy(_S0).sub(A).applyQuaternion(_q).add(A);
      rig.position.x = _a.x; rig.position.y = _a.y; rig.position.z = _a.z;
      rig.quaternion.copy(_SQ).premultiply(_q).normalize();
      rig.touch();
    };
    let x0 = 0, g0 = fn();
    const gStart = Math.abs(g0);
    if (gStart < 1e-11) return;
    let x1 = guess, bestX = 0, bestG = gStart;
    apply(x1); let g1 = fn();
    if (Math.abs(g1) < bestG) { bestG = Math.abs(g1); bestX = x1; }
    for (let i = 0; i < 12 && Math.abs(g1) > 1e-11; i++) {
      const d = g1 - g0;
      if (Math.abs(d) < 1e-18) break;
      const x2 = x1 - (g1 * (x1 - x0)) / d;
      if (!Number.isFinite(x2) || Math.abs(x2) > 1.2) break;
      x0 = x1; g0 = g1; x1 = x2;
      apply(x1); g1 = fn();
      if (Math.abs(g1) < bestG) { bestG = Math.abs(g1); bestX = x1; }
    }
    if (x1 !== bestX) apply(bestX);
  }

  /** zero roll by a rigid rotation about pivot A (exact; A keeps its screen position) */
  levelAbout(A) {
    const rig = this.rig;
    rig.localUp(_up); rig.right(_r);
    const ru = _r.dot(_up);
    if (Math.abs(ru) < 1e-11) return;
    _K.crossVectors(_r, _up);
    if (_K.lengthSq() < 1e-16) return;
    _K.normalize();
    this.solveAbout(A, _K, () => { rig.localUp(_up); rig.right(_r); return _r.dot(_up); }, -Math.asin(clamp(ru, -1, 1)));
  }

  /** consume the landing tilt: pitch up in place towards the auto-tilt target for this height */
  updateLanding(dt) {
    if (!this.landing) return;
    const rig = this.rig;
    rig.forward(_f); rig.localUp(_up);
    const pitch = Math.asin(clamp(_f.dot(_up), -1, 1));
    const target = desiredTilt(this.ctrl.heightAboveGround()) - Math.PI / 2;
    const room = target - pitch;
    if (room <= 1e-4) { this.landing = 0; return; }
    const step = Math.min(room, this.landing * damp(dt, 0.12));
    this.landing -= step;
    if (this.landing < 1e-4) this.landing = 0;
    this.lookInPlace(0, step);
  }

  /** tilt by dT about an anchor point (keeps it fixed on screen), clamped to [0, maxTilt] */
  tiltAbout(A, dT) {
    const rig = this.rig, P = rig.position;
    _up.copy(A).normalize();
    _a.set(P.x - A.x, P.y - A.y, P.z - A.z);
    const dist = _a.length(); if (dist < 1e-6) return;
    const tau = Math.acos(clamp(_a.dot(_up) / dist, -1, 1));
    const hAG = this.ctrl.heightAboveGround();
    const tmax = Math.min(maxTilt(hAG, rig.radius, A.length()), this.floorTiltLimit(A, dist, hAG));
    const want = clamp(tau + dT, 0, Math.max(tau, tmax));
    const apply = want - tau;
    if (Math.abs(apply) < 1e-9) return;
    this.horizRight(_r, _up);
    _q.setFromAxisAngle(_r, apply);
    rig.rotateAbout(A, _q);
  }

  updateKeys(dt) {
    const ctrl = this.ctrl, k = ctrl.keys, rig = this.rig;
    const has = (c) => k.has(c);
    const fast = has('ShiftLeft') || has('ShiftRight') ? 3.5 : 1;
    const fw = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0);
    const rt = (has('KeyD') || has('ArrowRight') ? 1 : 0) - (has('KeyA') || has('ArrowLeft') ? 1 : 0);
    const hd = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
    const tl = (has('KeyR') ? 1 : 0) - (has('KeyF') ? 1 : 0);
    const zm = (has('Equal') || has('NumpadAdd') || has('PageUp') ? 1 : 0) - (has('Minus') || has('NumpadSubtract') || has('PageDown') ? 1 : 0);
    const kv = this.keyVel, a = damp(dt, 0.12);
    const step = (key, target) => { let v = kv[key] + (target - kv[key]) * a; if (!target && Math.abs(v) < 2e-3) v = 0; kv[key] = v; };
    step('fw', fw * fast); step('rt', rt * fast); step('head', hd * fast); step('tilt', tl * fast); step('zoom', zm * fast);
    if (kv.fw || kv.rt) {
      // ground speed ∝ height above ground near the planet; saturates at orbit altitudes so the
      // globe turns at ≈ 15–20°/s from 2,000–20,000 km instead of racing past (the disc stops growing)
      const h = Math.max(ctrl.heightAboveGround(), 3);
      const speed = (0.85 * h) / (1 + h / (3.5 * R));
      rig.localUp(_up); rig.forward(_f);
      _dir.copy(_f).addScaledVector(_up, -_f.dot(_up));
      if (_dir.lengthSq() < 1e-6) { rig.up(_dir); _dir.addScaledVector(_up, -_dir.dot(_up)); }
      _dir.normalize();
      this.horizRight(_r, _up);
      _t.copy(_dir).multiplyScalar(kv.fw).addScaledVector(_r, kv.rt);
      const v = _t.length() * speed;
      if (v > 0) {
        _t.normalize();
        _a.crossVectors(_up, _t).normalize();
        _q.setFromAxisAngle(_a, (v * dt) / rig.radius);
        rig.rotateAbout(ORIGIN, _q);
      }
    }
    if (kv.head || kv.tilt) {
      const piv = this.pivot(false);
      this.rotateHT(kv.head * 75 * DEG * dt, kv.tilt * 45 * DEG * dt, piv, kv.tilt !== 0 && tl !== 0);
    }
    if (kv.zoom) {
      const now = performance.now();
      const za = this.zoomAnchorAt;
      if (!za.centre || now - za.t > 200) {
        const T = ctrl.centerTarget(false);
        if (T) { this.zoomAnchor.copy(T); this.zoomAnchorKind = 'sphere'; }
        else this.pickZoomAnchor(undefined, undefined, Math.sign(kv.zoom)); // looking past the planet / at the sky
        za.centre = true; za.t = now;
      }
      this.zoomPending = clamp(this.zoomPending + kv.zoom * 2.2 * dt, -6, 6);
    }
  }

  /** altitude-dependent tilt limit, planet kept in view, zero roll */
  constrain() {
    this.enforceTilt(null);
    this.ctrl.levelRoll();
    this._pushed = this.ctrl.clampAbove(CLEAR);
  }

  /**
   * Altitude-dependent tilt limit (the planet stays in view, the view straightens as you rise).
   * The correction rotates the camera rigidly about `pivot` — the zoom anchor while zooming, so the
   * point under the cursor stays exactly under it — or about the screen-centre target otherwise.
   */
  enforceTilt(pivot) {
    const ctrl = this.ctrl, rig = this.rig;
    for (let it = 0; it < 5; it++) {
      const hAG = ctrl.heightAboveGround(true);
      if (hAG <= 20000) return;
      const T = ctrl.centerTargetFast();
      if (!T) {
        if (hAG <= 3000) return;
        if (pivot) { _up.copy(pivot).normalize(); this.horizRight(_r, _up); _q.setFromAxisAngle(_r, -3 * DEG); rig.rotateAbout(pivot, _q); continue; }
        // centre ray misses the planet: pitch down in place until it hits
        rig.forward(_f); rig.localUp(_up);
        const p = Math.asin(clamp(_f.dot(_up), -1, 1));
        const pmax = this.maxPitchUp();
        if (p > pmax) { this.horizRight(_r, _up); _q.setFromAxisAngle(_r, pmax - p); rig.rotateInPlace(_q); }
        return;
      }
      const P = rig.position;
      _up.copy(T).normalize();
      _a.set(P.x - T.x, P.y - T.y, P.z - T.z);
      const tau = Math.acos(clamp(_a.dot(_up) / _a.length(), -1, 1));
      const tmax = maxTilt(hAG, rig.radius, T.length());
      if (tau <= tmax + 1e-5) return;
      if (pivot) {
        // exact: rotate about the pivot (zoom anchor) until the centre tilt meets the limit
        _up.copy(pivot).normalize();
        this.horizRight(_K, _up);
        const excess = () => {
          const T2 = ctrl.centerTargetFast();
          if (!T2) return 1;
          const Q = rig.position;
          _up.copy(T2).normalize(); _a.set(Q.x - T2.x, Q.y - T2.y, Q.z - T2.z);
          return Math.acos(clamp(_a.dot(_up) / _a.length(), -1, 1)) - maxTilt(ctrl.heightAboveGround(true), rig.radius, T2.length()) + 2e-6;
        };
        this.solveAbout(pivot, _K, excess, tmax - tau);
        return;
      }
      _up.copy(T).normalize();
      this.horizRight(_r, _up);
      _q.setFromAxisAngle(_r, tmax - tau);
      rig.rotateAbout(T, _q);
    }
  }
}
