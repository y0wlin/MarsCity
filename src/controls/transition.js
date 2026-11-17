// Camera transitions (flyTo). Two path families, chosen per flight:
//  * 'arc' — Google-Earth-like flight for views that look at the ground and for long hops:
//    both end poses are expressed as (target T, range, view direction, tilt) + a residual rotation,
//    the target travels along the great circle T0→T1, the range follows the van Wijk & Nuij optimal
//    zoom/pan path (rises ∝ distance, smooth in log altitude), heading is interpolated relative to
//    the path tangent (parallel transport: no spin over the poles), tilt flattens towards top-down
//    while the camera is higher than both ends.
//  * 'glide' — short hops near the ground where at least one view is near-horizontal (walking,
//    doors, building viewpoints, focus → entrance): a target-based arc would swing the camera out
//    and back around a far-away (or virtual) look-at point. Instead the camera itself travels along
//    the great circle between its two positions, at a height above the interpolated ground that
//    changes exponentially, while heading (relative to the path tangent), pitch and roll
//    interpolate.
// In both, focal length interpolates in log space (§1 转场时带入焦点距离) and the final frame snaps
// to the exact destination state. OWNER: controls agent.
import * as THREE from 'three';
import { R, DEG } from '../core/constants.js';
import { clamp, easeInOut, wrapPi, signedAngle, tangentBasis, smoothstep, quatAngle } from './math.js';
import { lookAtFromVec, decompose } from './lookat.js';
import { lensToVFov, vFovToLens } from './CameraRig.js';

const RHO = 1.42;
const GLIDE_MAX_ALT = 20000;   // m above ground: higher hops always use the arc

/** van Wijk & Nuij path. w: view width (m), D: ground distance (m). at(s∈[0,1]) -> {u (fraction), w} */
function vwnPath(w0, w1, D, rho = RHO) {
  const rho2 = rho * rho, rho4 = rho2 * rho2;
  if (!(D > 1e-6 * Math.max(w0, w1))) {
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    return { S, at: (s, o) => { o.u = s; o.w = w0 * Math.pow(w1 / w0, s); return o; } };
  }
  const b0 = (w1 * w1 - w0 * w0 + rho4 * D * D) / (2 * w0 * rho2 * D);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * D * D) / (2 * w1 * rho2 * D);
  const r0 = -Math.asinh(b0), r1 = -Math.asinh(b1);   // = log(sqrt(b²+1) − b), stable
  const S = (r1 - r0) / rho;
  const ch0 = Math.cosh(r0), sh0 = Math.sinh(r0);
  return {
    S,
    at: (s, o) => {
      const x = rho * s * S + r0;
      o.u = (w0 / (rho2 * D)) * (ch0 * Math.tanh(x) - sh0);
      o.w = (w0 * ch0) / Math.cosh(x);
      return o;
    },
  };
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Vector3();
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _rt = new THREE.Vector3(), _h = new THREE.Vector3(), _u0 = new THREE.Vector3(), _c = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

/**
 * Orientation q at a point with radial unit `up`, relative to the horizontal reference direction
 * `ref` (unit, ⟂ up): a = angle of the view's horizontal direction from ref (positive towards
 * ref × up, i.e. to the right), p = pitch, r = roll (positive clockwise for the viewer).
 * Straight down / up the heading comes from the screen-up vector, as in CameraRig.getPose.
 */
export function hprRelative(q, up, ref, out = {}) {
  _rt.crossVectors(ref, up);
  _f.set(0, 0, -1).applyQuaternion(q);
  _u.set(0, 1, 0).applyQuaternion(q);
  const fu = clamp(_f.dot(up), -1, 1);
  out.p = Math.asin(fu);
  if (Math.abs(fu) > 0.9995) { const s = -Math.sign(fu); out.a = Math.atan2(_u.dot(_rt) * s, _u.dot(ref) * s); }
  else out.a = Math.atan2(_f.dot(_rt), _f.dot(ref));
  // zero-roll up for (a, p), roll = signed angle from it to the actual up about the view axis
  _h.copy(ref).multiplyScalar(Math.cos(out.a)).addScaledVector(_rt, Math.sin(out.a));
  _u0.copy(_h).multiplyScalar(-Math.sin(out.p)).addScaledVector(up, Math.cos(out.p)).normalize();
  _c.crossVectors(_u0, _u);
  out.r = -Math.atan2(_c.dot(_f), _u0.dot(_u));
  if (Math.abs(out.r) < 1e-12) out.r = 0;
  return out;
}

/** inverse of hprRelative: quaternion for (a, p, r) at `up` with reference `ref` */
export function quatFromHpr(up, ref, a, p, r, out) {
  _rt.crossVectors(ref, up);
  _h.copy(ref).multiplyScalar(Math.cos(a)).addScaledVector(_rt, Math.sin(a)).normalize();
  _f.copy(_h).multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p)).normalize();
  _u.copy(_h).multiplyScalar(-Math.sin(p)).addScaledVector(up, Math.cos(p)).normalize();
  if (r) _u.applyAxisAngle(_f, -r);
  _rt.crossVectors(_f, _u).normalize();
  _e.copy(_f).negate();
  _m4.makeBasis(_rt, _u, _e);
  return out.setFromRotationMatrix(_m4);
}

export class Transition {
  /**
   * ctrl: ControlsSystem. from/to: {position:Vector3, quaternion, lens, fov}.
   * opts: {duration?, targetFrom?, targetTo?, minClear=1.2, ease?, kind?: 'arc'|'glide'}
   */
  constructor(ctrl, from, to, opts = {}) {
    this.ctrl = ctrl;
    this.from = from; this.to = to;
    this.t = 0;
    this.done = false;
    const aspect = ctrl.aspect();

    // targets (path parameterisation only — the end states are reproduced exactly)
    const i0 = {}, i1 = {};
    const T0 = opts.targetFrom || ctrl.poseTarget(from.position, from.quaternion, i0);
    const T1 = opts.targetTo || ctrl.poseTarget(to.position, to.quaternion, i1);
    this.T0 = T0.clone(); this.T1 = T1.clone();
    const d0 = decompose(from.position, from.quaternion, T0, {});
    const d1 = decompose(to.position, to.quaternion, T1, {});
    this.r0 = Math.max(d0.range, 0.05); this.r1 = Math.max(d1.range, 0.05);
    this.tilt0 = d0.tilt; this.tilt1 = d1.tilt;
    this.hv0 = d0.hv.clone(); this.hv1 = d1.hv.clone();

    // focal length (log interpolation, carried smoothly — §1 转场时带入焦点距离)
    this.lens0 = from.lens || vFovToLens(from.fov || 35, aspect);
    this.lens1 = to.lens || vFovToLens(to.fov || 35, aspect);
    const vf = Math.min(lensToVFov(this.lens0, aspect), lensToVFov(this.lens1, aspect)) * DEG;
    this.kw = 2 * Math.tan(vf / 2);

    // which path family
    const hA = Number.isFinite(i0.hAG) ? i0.hAG : Math.max(1, from.position.length() - R);
    const hB = Number.isFinite(i1.hAG) ? i1.hAG : Math.max(1, to.position.length() - R);
    const hMax = Math.max(hA, hB);
    const Dcam = from.position.distanceTo(to.position);
    const grazing = !!i0.virtual || !!i1.virtual || d0.tilt > 70 * DEG || d1.tilt > 70 * DEG;
    this.kind = opts.kind || (hMax < GLIDE_MAX_ALT && Dcam < Math.max(150, 8 * hMax) && grazing ? 'glide' : 'arc');

    if (this.kind === 'glide') this._setupGlide(from, to, Dcam);
    else this._setupArc(from, to, T0, T1, d0, d1);

    if (opts.duration != null) this.duration = opts.duration;
    if (!(this.duration > 0)) this.duration = 0;
    this.ease = opts.ease || easeInOut;
    this.minClear = opts.minClear ?? 1.2;
    // destination under a roof / deck (inside a building, under a bridge): roofs must not hold the
    // camera above the destination, so the flight keeps clear of terrain and water only
    this.indoor = false;
    try {
      const up = to.position.clone().normalize();
      this.indoor = !!ctrl.ground.raycast(to.position, up, { terrain: false, water: false, maxDist: 300 });
    } catch { this.indoor = false; }
    this._st = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.progress = 0;
  }

  // ------------------------------------------------------------------------------ arc
  _setupArc(from, to, T0, T1, d0, d1) {
    // residual rotations (exactness at both ends)
    const s0 = lookAtFromVec(T0, d0.range, d0.hv, d0.tilt, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
    const s1 = lookAtFromVec(T1, d1.range, d1.hv, d1.tilt, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
    this.res0 = s0.quaternion.clone().invert().multiply(from.quaternion).normalize();
    this.res1 = s1.quaternion.clone().invert().multiply(to.quaternion).normalize();

    // great circle between target directions
    this.u0 = T0.clone().normalize(); this.u1 = T1.clone().normalize();
    this.L0 = T0.length(); this.L1 = T1.length();
    this.axis = new THREE.Vector3().crossVectors(this.u0, this.u1);
    this.theta = Math.atan2(this.axis.length(), this.u0.dot(this.u1)); // accurate for tiny separations
    if (this.axis.lengthSq() < 1e-24) {
      // identical or antipodal targets: any axis ⟂ u0 (prefer one aligned with the view)
      this.axis.crossVectors(this.u0, this.hv0);
      if (this.axis.lengthSq() < 1e-24) this.axis.set(0, 1, 0).cross(this.u0);
      if (this.theta < 1e-12) this.theta = 0;
    }
    this.axis.normalize();
    const D = this.theta * 0.5 * (this.L0 + this.L1);
    this.D = D;

    // heading relative to a reference tangent (path tangent or north for in-place moves)
    this.useTangent = this.theta > 1e-10;
    const ref0 = this._refTangent(this.u0, new THREE.Vector3());
    const ref1 = this._refTangent(this.u1, new THREE.Vector3());
    this.a0 = signedAngle(ref0, this.hv0, this.u0);
    this.a1 = signedAngle(ref1, this.hv1, this.u1);
    this.da = wrapPi(this.a1 - this.a0);

    this.path = vwnPath(this.r0 * this.kw, this.r1 * this.kw, Math.max(D, 0), RHO);
    this.duration = clamp(0.75 + 0.42 * this.path.S, 0.9, 6.5);
    this.zr = Math.log(this.r1 / this.r0);
    this._o = { u: 0, w: 0 };
    this._ref = new THREE.Vector3(); this._T = new THREE.Vector3(); this._hv = new THREE.Vector3(); this._side = new THREE.Vector3();
  }

  _refTangent(up, out) {
    if (this.useTangent) return out.crossVectors(this.axis, up).normalize();
    tangentBasis(up, _e, out); // north
    return out;
  }

  _sampleArc(e) {
    const o = this.path.at(e, this._o);
    const uf = clamp(o.u, 0, 1);
    const range = Math.max(0.05, o.w / this.kw);
    // target on the great circle
    const T = this._T.copy(this.u0);
    if (this.theta > 0) T.applyAxisAngle(this.axis, this.theta * uf);
    const up = _v.copy(T);
    T.multiplyScalar(this.L0 + (this.L1 - this.L0) * uf);
    // heading: parallel-transported reference + interpolated offset
    const ref = this._refTangent(up, this._ref);
    const a = this.a0 + this.da * e;
    const hv = this._hv.copy(ref).multiplyScalar(Math.cos(a)).addScaledVector(this._side.crossVectors(up, ref), Math.sin(a)).normalize();
    // tilt: follow zoom progress for large zooms, flatten while above both ends
    let mix = e;
    if (Math.abs(this.zr) > 1.0) mix = smoothstep(0, 1, clamp(Math.log(range / this.r0) / this.zr, 0, 1)) * 0.85 + e * 0.15;
    const flatten = Math.pow(clamp(Math.max(this.r0, this.r1) / range, 0, 1), 0.7);
    const tilt = (this.tilt0 + (this.tilt1 - this.tilt0) * mix) * flatten;
    const st = lookAtFromVec(T, range, hv, tilt, this._st);
    _q.slerpQuaternions(this.res0, this.res1, e);
    st.quaternion.multiply(_q).normalize();
    this.focusDistance = range;
    this.target = T;
    return st;
  }

  // ------------------------------------------------------------------------------ glide
  _setupGlide(from, to, Dcam) {
    const G = this.ctrl.ground;
    const P0 = from.position, P1 = to.position;
    this.gu0 = P0.clone().normalize(); this.gu1 = P1.clone().normalize();
    this.gaxis = new THREE.Vector3().crossVectors(this.gu0, this.gu1);
    this.gtheta = Math.atan2(this.gaxis.length(), this.gu0.dot(this.gu1));
    // heading reference: the path tangent when the camera travels, else north (vertical / in-place moves)
    this.gUseTan = this.gtheta * R > 0.25;
    if (this.gUseTan) this.gaxis.normalize(); else this.gtheta = 0;
    // heights above what is under each end (terrain, water, floors / roofs), interpolated in log space
    const floorAt = (P) => { try { return G.floorHeightAt(P, { roofProbe: 0.3 }); } catch { return 0; } };
    this.gG0 = floorAt(P0); this.gG1 = floorAt(P1);
    this.gh0 = Math.max(0.3, P0.length() - R - this.gG0); this.gh1 = Math.max(0.3, P1.length() - R - this.gG1);
    // the floors were measured where the ends are: re-derive them so both ends are reproduced exactly
    this.gG0 = P0.length() - R - this.gh0; this.gG1 = P1.length() - R - this.gh1;
    const ref0 = this._glideRef(this.gu0, new THREE.Vector3()), ref1 = this._glideRef(this.gu1, new THREE.Vector3());
    const o0 = hprRelative(from.quaternion, this.gu0, ref0, {}), o1 = hprRelative(to.quaternion, this.gu1, ref1, {});
    this.ga0 = o0.a; this.gda = wrapPi(o1.a - o0.a);
    this.gp0 = o0.p; this.gp1 = o1.p; this.gr0 = o0.r; this.gr1 = o1.r;
    this._gref = new THREE.Vector3(); this._gup = new THREE.Vector3();
    // pace: ground distance relative to height, height ratio, turn angle
    const hMin = Math.max(1.5, Math.min(this.gh0, this.gh1));
    const turn = quatAngle(from.quaternion, to.quaternion);
    this.duration = clamp(0.55 + 0.3 * Math.log1p(Dcam / hMin) + 0.22 * Math.abs(Math.log(this.gh1 / this.gh0)) + 0.35 * turn, 0.6, 3.4);
  }

  _glideRef(up, out) {
    if (this.gUseTan) return out.crossVectors(this.gaxis, up).normalize();
    tangentBasis(up, _e, out);
    return out;
  }

  _sampleGlide(e) {
    const up = this._gup.copy(this.gu0);
    if (this.gtheta > 0) up.applyAxisAngle(this.gaxis, this.gtheta * e);
    up.normalize();
    const ground = this.gG0 + (this.gG1 - this.gG0) * e;
    const h = this.gh0 * Math.pow(this.gh1 / this.gh0, e);
    const st = this._st;
    st.position.copy(up).multiplyScalar(R + ground + h);
    const ref = this._glideRef(up, this._gref);
    quatFromHpr(up, ref, this.ga0 + this.gda * e, this.gp0 + (this.gp1 - this.gp0) * e, this.gr0 + (this.gr1 - this.gr0) * e, st.quaternion);
    this.focusDistance = this.r0 * Math.pow(this.r1 / this.r0, e);
    this.target = null;
    return st;
  }

  // ------------------------------------------------------------------------------ common
  /** state at eased parameter e ∈ [0,1] → writes into rig */
  sample(e, rig) {
    const st = this.kind === 'glide' ? this._sampleGlide(e) : this._sampleArc(e);
    // lens
    const lens = Math.exp(Math.log(this.lens0) + (Math.log(this.lens1) - Math.log(this.lens0)) * e);
    // keep clear of the ground (only matters for low, short hops)
    const P = st.position;
    const Lp = P.length();
    if (Lp - R < 45000) {
      const floor = this.ctrl.ground.floorHeightAt(P, { buildings: !this.indoor && Lp - R < 1500 });
      const minL = R + floor + this.minClear;
      if (Lp < minL) P.multiplyScalar(minL / Lp);
    }
    rig.position.x = P.x; rig.position.y = P.y; rig.position.z = P.z;
    rig.quaternion.copy(st.quaternion);
    if (this.from.lens || this.to.lens) { rig.lens = lens; }
    else { rig.lens = null; rig.fov = (this.from.fov || 35) + ((this.to.fov || 35) - (this.from.fov || 35)) * e; }
    rig.touch();
  }

  /** advance; returns true when finished (rig then holds the exact destination) */
  update(dt, rig) {
    if (this.done) return true;
    this.t += dt;
    const phi = this.duration > 0 ? clamp(this.t / this.duration, 0, 1) : 1;
    this.progress = phi;
    if (phi >= 1) {
      this.applyFinal(rig);
      return true;
    }
    this.sample(this.ease(phi), rig);
    return false;
  }

  applyFinal(rig) {
    const to = this.to;
    rig.position.x = to.position.x; rig.position.y = to.position.y; rig.position.z = to.position.z;
    rig.quaternion.copy(to.quaternion);
    if (to.lens) rig.lens = to.lens; else { rig.lens = null; if (to.fov) rig.fov = to.fov; }
    rig.touch();
    this.done = true;
    this.progress = 1;
  }
}
