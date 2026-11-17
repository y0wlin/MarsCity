// Deterministic maths core for the terrain-fn modules (pure, worker-safe, float64, no allocation
// in the hot paths). OWNER: terrain-fn agent.
//
//   makeNoise(channel)       3D simplex noise: n(x,y,z) in ~[-1,1]; d(x,y,z,g) also writes the
//                            analytic gradient to g[0..2]. Kernel radius^2 = 0.5 keeps value AND
//                            gradient continuous everywhere (incl. the cube-face/planet seams).
//   hash3 / rehash / u01     integer lattice hashing (no 256-periodicity)
//   bandW(lambda, mw)        band-limit weight (0 at lambda <= 2 mw, 1 at >= 4 mw, C1, no pops)
//   smin / smax / sabs       smooth min / max / abs for band-limited creases
//   makeRotations(n, ch)     fixed random orthonormal 3x3 matrices (decorrelate octaves)
//
// Everything is a pure function of its inputs and the frozen world seed, so the main thread and
// every worker produce bit-identical results.

import { SEED } from '../../core/constants.js';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
/** C1 ramp on [0,1] */
export function sstep(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
/** quintic (C2) ramp on [0,1] */
export function sstep5(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * t * (t * (t * 6 - 15) + 10); }
/** polynomial smooth minimum, k = blend width (same units). k <= 0 -> hard min */
export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const d = b - a;
  if (d >= k) return a;
  if (d <= -k) return b;
  const h = 0.5 + 0.5 * d / k;
  return b + (a - b) * h - k * h * (1 - h);
}
export function smax(a, b, k) { return -smin(-a, -b, k); }
/** soft |x| with a rounded crease of half-width e */
export function sabs(x, e) { return e > 0 ? Math.sqrt(x * x + e * e) - e : (x < 0 ? -x : x); }

/**
 * Band-limit weight of a feature with wavelength `lambda` (m) when the caller resolves features
 * down to `mw` (minWavelength). 0 for lambda <= 2 mw, 1 for lambda >= 4 mw, C1 in between and
 * continuous in mw, so refining the band limit never pops.
 */
export function bandW(lambda, mw) {
  if (mw <= 0) return 1;
  const t = lambda / (2 * mw) - 1;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// integer hashing
// ---------------------------------------------------------------------------------------------
export function hash3(i, j, k, seed) {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x7feb352d)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function rehash(h, salt) {
  h = (h ^ Math.imul(salt | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
export const u01 = (h) => (h >>> 0) / 4294967296;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// 3D simplex noise
// ---------------------------------------------------------------------------------------------
const F3 = 1 / 3, G3 = 1 / 6;
const NS = 81.0; // normalisation for the r^2 = 0.5 kernel (peak |n| ~ 1)
const GX = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]);
const GY = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]);
const GZ = new Float64Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1]);

export function makeNoise(channel) {
  const rnd = mulberry(hash3(channel, 0x51ed, 0x7a3, SEED));
  const p = new Int32Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const P = new Int32Array(1024), PM = new Int32Array(1024);
  for (let i = 0; i < 1024; i++) { P[i] = p[i & 255]; PM[i] = P[i] % 12; }

  function n(xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 0.5, y3 = y0 - 0.5, z3 = z0 - 0.5;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let r = 0, t0, g;
    t0 = 0.5 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { g = PM[ii + P[jj + P[kk]]]; t0 *= t0; r += t0 * t0 * (GX[g] * x0 + GY[g] * y0 + GZ[g] * z0); }
    t0 = 0.5 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t0 > 0) { g = PM[ii + i1 + P[jj + j1 + P[kk + k1]]]; t0 *= t0; r += t0 * t0 * (GX[g] * x1 + GY[g] * y1 + GZ[g] * z1); }
    t0 = 0.5 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t0 > 0) { g = PM[ii + i2 + P[jj + j2 + P[kk + k2]]]; t0 *= t0; r += t0 * t0 * (GX[g] * x2 + GY[g] * y2 + GZ[g] * z2); }
    t0 = 0.5 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t0 > 0) { g = PM[ii + 1 + P[jj + 1 + P[kk + 1]]]; t0 *= t0; r += t0 * t0 * (GX[g] * x3 + GY[g] * y3 + GZ[g] * z3); }
    return NS * r;
  }

  /** value + analytic gradient (d/dx, d/dy, d/dz) written to grad[0..2] */
  function d(xin, yin, zin, grad) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 0.5, y3 = y0 - 0.5, z3 = z0 - 0.5;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let r = 0, dx = 0, dy = 0, dz = 0, t0, t2, t4, g, gd, q;
    t0 = 0.5 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      g = PM[ii + P[jj + P[kk]]]; t2 = t0 * t0; t4 = t2 * t2;
      gd = GX[g] * x0 + GY[g] * y0 + GZ[g] * z0; r += t4 * gd; q = -8 * t2 * t0 * gd;
      dx += q * x0 + t4 * GX[g]; dy += q * y0 + t4 * GY[g]; dz += q * z0 + t4 * GZ[g];
    }
    t0 = 0.5 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t0 > 0) {
      g = PM[ii + i1 + P[jj + j1 + P[kk + k1]]]; t2 = t0 * t0; t4 = t2 * t2;
      gd = GX[g] * x1 + GY[g] * y1 + GZ[g] * z1; r += t4 * gd; q = -8 * t2 * t0 * gd;
      dx += q * x1 + t4 * GX[g]; dy += q * y1 + t4 * GY[g]; dz += q * z1 + t4 * GZ[g];
    }
    t0 = 0.5 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t0 > 0) {
      g = PM[ii + i2 + P[jj + j2 + P[kk + k2]]]; t2 = t0 * t0; t4 = t2 * t2;
      gd = GX[g] * x2 + GY[g] * y2 + GZ[g] * z2; r += t4 * gd; q = -8 * t2 * t0 * gd;
      dx += q * x2 + t4 * GX[g]; dy += q * y2 + t4 * GY[g]; dz += q * z2 + t4 * GZ[g];
    }
    t0 = 0.5 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t0 > 0) {
      g = PM[ii + 1 + P[jj + 1 + P[kk + 1]]]; t2 = t0 * t0; t4 = t2 * t2;
      gd = GX[g] * x3 + GY[g] * y3 + GZ[g] * z3; r += t4 * gd; q = -8 * t2 * t0 * gd;
      dx += q * x3 + t4 * GX[g]; dy += q * y3 + t4 * GY[g]; dz += q * z3 + t4 * GZ[g];
    }
    grad[0] = NS * dx; grad[1] = NS * dy; grad[2] = NS * dz;
    return NS * r;
  }

  return { n, d, n3: n, d3: d };
}

/** fixed random rotations (row-major 3x3 in Float64Array(9)) */
export function makeRotations(count, channel) {
  const rnd = mulberry(hash3(channel, 0x907, 0x13, SEED));
  const out = [];
  for (let k = 0; k < count; k++) {
    let a = rnd() * 2 - 1, b = rnd() * 2 - 1, c = rnd() * 2 - 1, d = rnd() * 2 - 1;
    const l = Math.hypot(a, b, c, d) || 1; a /= l; b /= l; c /= l; d /= l;
    out.push(new Float64Array([
      a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c),
      2 * (b * c + a * d), a * a - b * b + c * c - d * d, 2 * (c * d - a * b),
      2 * (b * d - a * c), 2 * (c * d + a * b), a * a - b * b - c * c + d * d,
    ]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// sphere helpers
// ---------------------------------------------------------------------------------------------
const DEGR = Math.PI / 180;
/** lat/lon (deg) -> unit vector into out[o..o+2] */
export function llUnit(lat, lon, out, o = 0) {
  const la = lat * DEGR, lo = lon * DEGR, c = Math.cos(la);
  out[o] = c * Math.sin(lo); out[o + 1] = Math.sin(la); out[o + 2] = c * Math.cos(lo);
  return out;
}
/** east / north unit tangents at unit vector (x,y,z) into e[3], n[3] (pole safe) */
export function tangents(x, y, z, e, n) {
  let ex = z, ez = -x; let el = Math.hypot(ex, ez);
  if (el < 1e-12) { ex = 1; ez = 0; el = 1; }
  ex /= el; ez /= el;
  e[0] = ex; e[1] = 0; e[2] = ez;
  n[0] = y * ez; n[1] = z * ex - x * ez; n[2] = -y * ex;
}
