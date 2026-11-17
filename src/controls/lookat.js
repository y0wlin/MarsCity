// Look-at parameterisation of a camera around a target point: (T, range, view direction, tilt)
// with zero roll w.r.t. the target's vertical. Used by transitions, double-click flights,
// focus mode and orbit helpers. OWNER: controls agent.
import * as THREE from 'three';
import { DEG, RAD, R } from '../core/constants.js';
import { latLonHToEcef } from '../core/geo.js';
import { tangentBasis, quatFromBasis, clamp } from './math.js';

const _up = new THREE.Vector3(), _e = new THREE.Vector3(), _n = new THREE.Vector3();
const _off = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _b = new THREE.Vector3();
const _hv = new THREE.Vector3(), _cu = new THREE.Vector3();

/** ECEF Vector3 from {x,y,z} or {lat, lon, h|alt} */
export function toEcefVec(t, out = new THREE.Vector3()) {
  if (t == null) return null;
  if (t.isVector3 || (Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z))) return out.set(t.x, t.y, t.z);
  if (Number.isFinite(t.lat) && Number.isFinite(t.lon)) {
    const p = latLonHToEcef(t.lat, t.lon, t.h ?? t.alt ?? 0);
    return out.set(p.x, p.y, p.z);
  }
  return null;
}

/**
 * Camera state at `range` metres from T looking at it. hv: unit horizontal view direction at T
 * (tangent), tilt: radians (0 = straight down, PI/2 = horizontal, > PI/2 looking up).
 */
export function lookAtFromVec(T, range, hv, tilt, out) {
  _up.copy(T).normalize();
  const st = Math.sin(tilt), ct = Math.cos(tilt);
  _off.copy(hv).multiplyScalar(-st).addScaledVector(_up, ct);
  out.position.copy(T).addScaledVector(_off, range);
  _f.copy(_off).negate();
  _u.copy(hv).multiplyScalar(ct).addScaledVector(_up, st);
  _r.crossVectors(_f, _u).normalize();
  _b.copy(_off);
  quatFromBasis(_r, _u, _b, out.quaternion);
  return out;
}

/** heading (deg, compass bearing of the view at T) + tilt (deg) form */
export function lookAtState(T, range, headingDeg, tiltDeg, out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }) {
  _up.copy(T).normalize();
  tangentBasis(_up, _e, _n);
  const h = headingDeg * DEG;
  _hv.copy(_n).multiplyScalar(Math.cos(h)).addScaledVector(_e, Math.sin(h)).normalize();
  return lookAtFromVec(T, range, _hv, tiltDeg * DEG, out);
}

/**
 * Decompose a camera (P, Q) around target T (which should lie on, or near, the view axis).
 * Returns {range, tilt (rad), hv (unit tangent at T), heading (deg)}.
 */
export function decompose(P, Q, T, out = {}) {
  _up.copy(T).normalize();
  _off.set(P.x - T.x, P.y - T.y, P.z - T.z);
  const range = _off.length();
  out.range = range;
  if (range < 1e-9) { out.tilt = 0; out.hv = (out.hv || new THREE.Vector3()); tangentBasis(_up, _e, out.hv); out.heading = 0; return out; }
  _off.multiplyScalar(1 / range);
  const c = clamp(_off.dot(_up), -1, 1);
  out.tilt = Math.atan2(_hv.crossVectors(_off, _up).length(), c); // accurate near 0 (top-down)
  const hv = out.hv || (out.hv = new THREE.Vector3());
  hv.copy(_off).negate().addScaledVector(_up, c); // -ô minus its vertical part
  if (hv.lengthSq() < 1e-14) {
    // looking straight down/up the vertical: the screen-up vector defines the heading
    _cu.set(0, 1, 0).applyQuaternion(Q);
    hv.copy(_cu).addScaledVector(_up, -_cu.dot(_up));
    if (c < 0) hv.negate();
    if (hv.lengthSq() < 1e-14) tangentBasis(_up, hv, _n);
  }
  hv.normalize();
  tangentBasis(_up, _e, _n);
  out.heading = ((Math.atan2(hv.dot(_e), hv.dot(_n)) * RAD) + 360) % 360;
  return out;
}

/** heading (deg) of a horizontal direction hv at the point with radial unit up */
export function headingOf(hv, up) {
  tangentBasis(up, _e, _n);
  return ((Math.atan2(hv.dot(_e), hv.dot(_n)) * RAD) + 360) % 360;
}

/** Height above the sea-level sphere of an ECEF point. */
export function altOf(p) { return Math.hypot(p.x, p.y, p.z) - R; }
