// Float64 helpers shared by every camera mode. THREE.Vector3 / Quaternion store plain JS
// numbers (float64), so they are safe for planet-scale ECEF maths on the CPU.
// OWNER: controls agent.
import * as THREE from 'three';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/** frame-rate independent exponential approach factor (1 - e^(-dt/tau)) */
export const damp = (dt, tau) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
/** wrap radians to (-PI, PI] */
export function wrapPi(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }
/** cubic ease in/out */
export function easeInOut(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
/** quintic smootherstep (C2) */
export function smoother(t) { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); }

export function finite3(v) { return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z); }
export function finiteQ(q) { return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w); }

/**
 * Ray / origin-centred sphere. o: ray origin (ECEF), d: unit direction, r: radius.
 * Returns the nearest t >= 0 (the far root when the origin is inside), or -1.
 */
export function raySphere(o, d, r) {
  const L = Math.hypot(o.x, o.y, o.z);
  const b = o.x * d.x + o.y * d.y + o.z * d.z;
  const c = (L - r) * (L + r);
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t >= 0) return t;
  t = -b + s;
  return t >= 0 ? t : -1;
}

/**
 * Point on the sphere of radius r that best matches a ray that may miss it: the ray's closest
 * approach to the centre, pushed out to the sphere (the "silhouette" point). Writes into out.
 */
export function raySilhouette(o, d, r, out) {
  const b = o.x * d.x + o.y * d.y + o.z * d.z;
  const t = Math.max(0, -b);
  out.set(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
  const l = out.length();
  if (l < 1e-6) out.set(o.x, o.y, o.z).normalize().multiplyScalar(r);
  else out.multiplyScalar(r / l);
  return out;
}

/** Horizon angle from nadir (radians) for a viewer at distance L from the centre of a sphere r. */
export function horizonAngle(L, r) { return Math.asin(clamp(r / Math.max(L, r), 0, 1)); }

/** Local east/north for a radial unit vector (handles poles). Writes into e, n (THREE.Vector3). */
export function tangentBasis(up, e, n) {
  e.set(up.z, 0, -up.x);
  let l = e.length();
  if (l < 1e-12) { e.set(1, 0, 0); l = 1; }
  e.multiplyScalar(1 / l);
  n.crossVectors(up, e).normalize();
  return e;
}

/** Signed angle (radians) from a to b about axis (all unit-ish). */
export function signedAngle(a, b, axis) {
  const cx = a.y * b.z - a.z * b.y, cy = a.z * b.x - a.x * b.z, cz = a.x * b.y - a.y * b.x;
  return Math.atan2(cx * axis.x + cy * axis.y + cz * axis.z, a.x * b.x + a.y * b.y + a.z * b.z);
}

/** Rotate v about unit axis by angle (Rodrigues), in place. */
export function rotateVec(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = (axis.x * v.x + axis.y * v.y + axis.z * v.z) * (1 - c);
  const x = v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * d;
  const y = v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * d;
  const z = v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * d;
  return v.set(x, y, z);
}

/** Quaternion from basis (right, up, back) — columns of a rotation matrix. */
const _m4 = new THREE.Matrix4();
export function quatFromBasis(right, up, back, out) {
  _m4.makeBasis(right, up, back);
  return out.setFromRotationMatrix(_m4);
}

/** Look-at orientation: forward f (unit), preferred up hint (unit). Zero roll w.r.t. the hint. */
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _b = new THREE.Vector3();
export function quatLook(f, upHint, out) {
  _r.crossVectors(f, upHint);
  if (_r.lengthSq() < 1e-20) {
    // forward parallel to hint: pick any perpendicular
    _r.set(1, 0, 0); if (Math.abs(f.x) > 0.9) _r.set(0, 1, 0);
    _r.cross(f);
  }
  _r.normalize();
  _u.crossVectors(_r, f).normalize();
  _b.copy(f).negate();
  return quatFromBasis(_r, _u, _b, out);
}

/** Angle (radians) between two quaternions (accurate for tiny angles: atan2 of the relative rotation). */
export function quatAngle(a, b) {
  // relative rotation r = conj(a) * b
  const w = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  const x = a.w * b.x - a.x * b.w - a.y * b.z + a.z * b.y;
  const y = a.w * b.y + a.x * b.z - a.y * b.w - a.z * b.x;
  const z = a.w * b.z - a.x * b.y + a.y * b.x - a.z * b.w;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w));
}

/** Ring buffer of timed samples for release velocities. */
export class VelocityTracker {
  constructor(windowMs = 90) { this.windowMs = windowMs; this.samples = []; }
  reset() { this.samples.length = 0; }
  /** push a sample value (number or THREE.Vector3 increment) at time t (ms) */
  push(t, value) {
    this.samples.push({ t, v: value && value.isVector3 ? value.clone() : value });
    while (this.samples.length > 2 && t - this.samples[0].t > this.windowMs * 2) this.samples.shift();
  }
  /** rate per second over the last window, or 0 / zero-vector when the pointer rested */
  rate(now, zero) {
    const s = this.samples;
    if (!s.length) return zero;
    const last = s[s.length - 1].t;
    if (now - last > 60) return zero; // rested before release → no fling
    let acc = zero && zero.isVector3 ? zero.clone().set(0, 0, 0) : 0, t0 = last, n = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      if (last - s[i].t > this.windowMs) break;
      if (acc && acc.isVector3) acc.add(s[i].v); else acc += s[i].v;
      t0 = s[i].t; n++;
    }
    // span covers n increments: from the sample before the oldest used to the last
    const prev = s[s.length - 1 - n];
    const span = Math.max(16, last - (prev ? prev.t : t0 - 16));
    if (acc && acc.isVector3) return acc.multiplyScalar(1000 / span);
    return (acc * 1000) / span;
  }
}
