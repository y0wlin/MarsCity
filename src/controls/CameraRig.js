// Float64 camera state. The THREE camera always sits at render-space origin; App copies
// rig.quaternion onto it and sets the floating origin to rig.position every frame.
// OWNER: controls agent (keep this API stable — bookmarks, UI and automation depend on it).
//
// Pose convention (local tangent frame at the camera's lat/lon):
//   heading: degrees clockwise from north (0 = look north, 90 = look east)
//   pitch:   degrees above the horizon (0 = level, -90 = straight down)
//   roll:    degrees, positive = clockwise as seen by the viewer
//   alt:     metres above sea level (R)
//   lens:    full-frame-equivalent focal length in mm (horizontal 36 mm sensor) OR fov (vertical deg)
//
// Stable API: position, quaternion, fov, lens, version, geo, forward(), up(), right(),
//   setPosition(), setOrientation(), setPose(), getPose(), lookAtEcef(), snapshot(), restore(), vfov().
// Extensions (controls agent): radius, localUp(), ndcRay(), projectNdc(), rotateAbout(),
//   rotateInPlace(), touch(), isValid(), equals(), setLensFov(), lensMM(), setStateIfChanged().

import * as THREE from 'three';
import { R, DEG, RAD } from '../core/constants.js';
import { latLonHToEcef, ecefToLatLonH, enuBasis } from '../core/geo.js';

const _m = new THREE.Matrix4();
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export function lensToVFov(mm, aspect) {
  const hfov = 2 * Math.atan(18 / mm);
  return 2 * Math.atan(Math.tan(hfov / 2) / Math.max(aspect, 1e-3)) * RAD;
}
export function vFovToLens(vfovDeg, aspect) {
  const hfov = 2 * Math.atan(Math.tan((vfovDeg * DEG) / 2) * aspect);
  return 18 / Math.tan(hfov / 2);
}

export class CameraRig {
  constructor() {
    this.position = { x: 0, y: 0, z: R * 4 };  // ECEF metres (float64)
    this.quaternion = new THREE.Quaternion();
    this.fov = 35;                                // vertical degrees used by the THREE camera
    this.lens = null;                             // if set (mm), fov follows the viewport aspect
    this.version = 0;                             // bumps on every change (accumulation reset)
    this.setPose({ lat: 15, lon: 100, alt: 9.5e6, heading: 0, pitch: -90 });
  }

  /** {lat, lon, h} of the camera */
  get geo() { const p = this.position; return ecefToLatLonH(p.x, p.y, p.z); }

  /** world-space forward / up / right (render axes == ECEF axes) */
  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quaternion); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quaternion); }
  right(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quaternion); }

  /** radial (local vertical) unit vector at the camera */
  localUp(out = new THREE.Vector3()) {
    const p = this.position; const l = Math.hypot(p.x, p.y, p.z) || 1;
    return out.set(p.x / l, p.y / l, p.z / l);
  }

  /** distance from the planet centre */
  get radius() { const p = this.position; return Math.hypot(p.x, p.y, p.z); }

  setPosition(x, y, z) { this.position.x = x; this.position.y = y; this.position.z = z; this.version++; }

  /** mark the orientation/position as changed after direct edits */
  touch() { this.version++; }

  /** Set orientation from heading/pitch/roll in the local frame at the current position. */
  setOrientation(heading, pitch, roll = 0) {
    const g = this.geo;
    const B = enuBasis(g.lat, g.lon);
    const E = new THREE.Vector3(...B.east), N = new THREE.Vector3(...B.north), U = new THREE.Vector3(...B.up);
    const h = heading * DEG, p = pitch * DEG;
    const horiz = N.clone().multiplyScalar(Math.cos(h)).add(E.clone().multiplyScalar(Math.sin(h)));
    _f.copy(horiz).multiplyScalar(Math.cos(p)).addScaledVector(U, Math.sin(p)).normalize();
    _u.copy(horiz).multiplyScalar(-Math.sin(p)).addScaledVector(U, Math.cos(p)).normalize();
    if (roll) _u.applyAxisAngle(_f, -roll * DEG);
    _r.crossVectors(_f, _u).normalize();
    _m.makeBasis(_r, _u, _f.clone().negate());
    this.quaternion.setFromRotationMatrix(_m);
    this.version++;
  }

  /** Full pose setter. alt in metres above sea level. Optional lens (mm) or fov (deg). */
  setPose({ lat, lon, alt, heading = 0, pitch = -90, roll = 0, lens, fov }) {
    const p = latLonHToEcef(lat, lon, alt);
    this.position.x = p.x; this.position.y = p.y; this.position.z = p.z;
    this.setOrientation(heading, pitch, roll);
    if (lens) { this.lens = lens; } else if (fov) { this.lens = null; this.fov = fov; }
    this.version++;
  }

  getPose() {
    const g = this.geo;
    const B = enuBasis(g.lat, g.lon);
    const E = new THREE.Vector3(...B.east), N = new THREE.Vector3(...B.north), U = new THREE.Vector3(...B.up);
    const f = this.forward(new THREE.Vector3()), up = this.up(new THREE.Vector3());
    const fu = f.dot(U);
    const pitch = Math.asin(Math.max(-1, Math.min(1, fu))) * RAD;
    let heading;
    if (Math.abs(fu) > 0.9995) heading = Math.atan2(up.dot(E) * -Math.sign(fu), up.dot(N) * -Math.sign(fu)) * RAD;
    else heading = Math.atan2(f.dot(E), f.dot(N)) * RAD;
    // roll: angle between actual up and the zero-roll up
    const h = heading * DEG, p = pitch * DEG;
    const horiz = N.clone().multiplyScalar(Math.cos(h)).add(E.clone().multiplyScalar(Math.sin(h)));
    const up0 = horiz.multiplyScalar(-Math.sin(p)).addScaledVector(U, Math.cos(p)).normalize();
    const cr = new THREE.Vector3().crossVectors(up0, up).dot(f);
    const roll = -Math.atan2(cr, up0.dot(up)) * RAD;
    return { lat: g.lat, lon: g.lon, alt: g.h, heading: (heading + 360) % 360, pitch, roll: Math.abs(roll) < 1e-6 ? 0 : roll, fov: this.fov, lens: this.lens };
  }

  /** Orient towards an ECEF target, keeping local up. */
  lookAtEcef(t, upHint) {
    const p = this.position;
    _f.set(t.x - p.x, t.y - p.y, t.z - p.z).normalize();
    const U = upHint ? upHint.clone() : new THREE.Vector3(p.x, p.y, p.z).normalize();
    if (Math.abs(_f.dot(U)) > 0.9999) { const g = this.geo; U.set(...enuBasis(g.lat, g.lon).north); }
    _r.crossVectors(_f, U).normalize();
    _u.crossVectors(_r, _f).normalize();
    _m.makeBasis(_r, _u, _f.clone().negate());
    this.quaternion.setFromRotationMatrix(_m);
    this.version++;
  }

  /** Copy state (for back stack / transitions) */
  snapshot() { return { position: { ...this.position }, quaternion: this.quaternion.clone(), fov: this.fov, lens: this.lens }; }
  /** restore a snapshot (the position object keeps its identity: holders of rig.position stay valid) */
  restore(s) {
    const p = this.position;
    p.x = s.position.x; p.y = s.position.y; p.z = s.position.z;
    this.quaternion.copy(s.quaternion); this.fov = s.fov; this.lens = s.lens; this.version++;
  }

  /** vertical fov for a viewport aspect */
  vfov(aspect) { return this.lens ? lensToVFov(this.lens, aspect) : this.fov; }

  /** current focal length in mm (converting the fov when no lens is set) */
  lensMM(aspect) { return this.lens || vFovToLens(this.fov, aspect); }

  /** set lens (mm) or vertical fov (deg); exactly one representation is kept */
  setLensFov({ lens, fov }) {
    if (lens) this.lens = lens; else if (fov) { this.lens = null; this.fov = fov; }
    this.version++;
  }

  /**
   * World-space (ECEF axes) unit direction of the ray through normalised device coordinates
   * (ndcX, ndcY ∈ [-1,1], +Y up) for a viewport aspect. Matches THREE.PerspectiveCamera.
   */
  ndcRay(ndcX, ndcY, aspect, out = new THREE.Vector3()) {
    const ty = Math.tan((this.vfov(aspect) * DEG) / 2), tx = ty * aspect;
    return out.set(ndcX * tx, ndcY * ty, -1).normalize().applyQuaternion(this.quaternion);
  }

  /** Project an ECEF point to NDC (x,y in [-1,1] when visible; z<0 behind). */
  projectNdc(p, aspect, out = new THREE.Vector3()) {
    const c = this.position;
    _v.set(p.x - c.x, p.y - c.y, p.z - c.z);
    _q.copy(this.quaternion).invert();
    _v.applyQuaternion(_q); // camera space (−Z forward)
    const ty = Math.tan((this.vfov(aspect) * DEG) / 2), tx = ty * aspect;
    const depth = -_v.z;
    return out.set(_v.x / (depth * tx), _v.y / (depth * ty), depth);
  }

  /** Rigidly rotate the camera (position about `pivot`, and orientation) by quaternion q. */
  rotateAbout(pivot, q) {
    const p = this.position;
    _v.set(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z).applyQuaternion(q);
    p.x = pivot.x + _v.x; p.y = pivot.y + _v.y; p.z = pivot.z + _v.z;
    this.quaternion.premultiply(q).normalize();
    this.version++;
  }

  /** Rotate the orientation only (world-space rotation q). */
  rotateInPlace(q) { this.quaternion.premultiply(q).normalize(); this.version++; }

  /** true when position and orientation are finite and the camera is not at the centre */
  isValid() {
    const p = this.position, q = this.quaternion;
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) &&
      Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w) &&
      Math.hypot(p.x, p.y, p.z) > 1 && Math.abs(q.lengthSq() - 1) < 1e-3;
  }

  /**
   * Write position (ECEF) + orientation only when they differ from the current state by more than
   * posEps metres / angEps radians, bumping `version` once. Modes that recompute the camera every
   * frame (walk, focus) use it so a resting camera keeps its version — the pipeline then sees a
   * static view and its temporal accumulation converges. Returns true when written.
   */
  setStateIfChanged(x, y, z, q, posEps = 1e-7, angEps = 1e-10) {
    const p = this.position, a = this.quaternion;
    const d = Math.hypot(x - p.x, y - p.y, z - p.z);
    const w = a.w * q.w + a.x * q.x + a.y * q.y + a.z * q.z;
    const vx = a.w * q.x - a.x * q.w - a.y * q.z + a.z * q.y;
    const vy = a.w * q.y + a.x * q.z - a.y * q.w - a.z * q.x;
    const vz = a.w * q.z - a.x * q.y + a.y * q.x - a.z * q.w;
    if (d <= posEps && 2 * Math.atan2(Math.hypot(vx, vy, vz), Math.abs(w)) <= angEps) return false;
    p.x = x; p.y = y; p.z = z;
    a.copy(q);
    this.version++;
    return true;
  }

  /** compare with a snapshot (metres, radians) */
  equals(s, posEps = 1e-6, angEps = 1e-9) {
    const p = this.position;
    const d = Math.hypot(p.x - s.position.x, p.y - s.position.y, p.z - s.position.z);
    const a = this.quaternion, b = s.quaternion;
    // relative rotation angle via atan2 (acos(dot) cannot resolve angles below ~1e-8 rad)
    const w = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
    const x = a.w * b.x - a.x * b.w - a.y * b.z + a.z * b.y;
    const y = a.w * b.y + a.x * b.z - a.y * b.w - a.z * b.x;
    const z = a.w * b.z - a.x * b.y + a.y * b.x - a.z * b.w;
    return d <= posEps && 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)) <= angEps;
  }
}
