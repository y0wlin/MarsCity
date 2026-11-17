// FROZEN copy of the fix-round-1 gully.js (OWNER: terrain-fn). Used ONLY by icefoot.js to trace the OX4 ice-foot system
// (outlet ids MO-n, forebay pools MP-n, lakes ML-n, channel levels) so that layout -- which urban, props and the
// bookmarks reference -- stays stable while the live terrain modules evolve (fix round 2 band-limited the gully
// filter, which shifted the trace). Do not edit; delete together with the icefoot dependency if OX4 is re-planned.
// Gully erosion filter (pure, worker-safe). OWNER: terrain-fn agent.
//
// A stack of "gully noise" octaves carves branching drainage into natural slopes: every octave
// sums oriented waves around jittered 3D lattice points (compact smooth kernels), with the wave
// fronts perpendicular to the local slope so that crests and troughs run DOWNHILL. Each octave is
// steered only by slope terms whose wavelength is at least ~1.2x its cell (otherwise the lever arm
// of the kernels turns small-scale direction changes into contour loops), plus the slopes already
// carved by coarser octaves, so finer gullies run down the walls of coarser ones and join them
// (dendritic networks). The blended wave is folded into a sharpened profile (knife-edge spurs,
// V-shaped gullies) and only ever carves. A low-frequency phase warp breaks up parallel runs.
// Seamless on the sphere (3D lattice, per-octave rotation), band-limited per octave, continuous.
//
// Slope terms are pushed with slopeTerm(lambda, k, gx, gy, gz) (ECEF vectors, m/m) after
// slopeReset(); amplitudes with ampTerm(lambda, a); gullies(x,y,z, X,Y,Z, scale, mw, out) -> height
// delta (m, <= 0), scale multiplies all amplitudes. out.trough 0..1 (gully floor), out.crest 0..1.
// Performance: polynomial sin/cos (max error 1e-3), octaves with negligible amplitude are skipped
// smoothly, kernels outside their support are rejected before any trigonometry.

import { hash3, makeRotations, makeNoise, bandW } from './noise.js';

export const GULLY_CELLS = [20000, 10000, 5000, 2500, 1250, 625];
const NOCT = GULLY_CELLS.length;
const ROT = makeRotations(NOCT, 0x6b1);
const NW = makeNoise(0x6b2);
const STRIPES = 2.0;          // wave cycles per cell across the slope
const BRANCH = [0.55, 0.42, 0.28, 0.14, 0, 0];   // how strongly each octave's carved slope steers finer ones
const BCAP = 0.75;            // max steering relative to the macro slope
const S0 = 0.04;              // slope at which an octave reaches half strength
const SHARP_P = 1.6;          // crest sharpening exponent

// ---- band-tagged slope terms
const MAXT = 24;
const TL = new Float64Array(MAXT), TX = new Float64Array(MAXT), TY = new Float64Array(MAXT), TZ = new Float64Array(MAXT);
let NT = 0;
// band-tagged amplitude terms: amplitude a at cell size min(20 km, lambda / 2.6), applied to octaves
// with cells <= ~lambda / 1.2 (a canyon wall gullies its own wall, not the plateau around it)
const AL = new Float64Array(MAXT), AA = new Float64Array(MAXT);
let NA = 0;
export function slopeReset() { NT = 0; NA = 0; }
export function ampTerm(lambda, a) {
  if (!(a > 0)) return;
  if (NA >= MAXT) { AA[MAXT - 1] += a; return; }
  AL[NA] = lambda; AA[NA] = a; NA++;
}
export function ampTotal() { let s = 0; for (let i = 0; i < NA; i++) s += AA[i]; return s; }
export function slopeTerm(lambda, k, gx, gy, gz) {
  if (k === 0) return;
  if (NT >= MAXT) { TX[MAXT - 1] += k * gx; TY[MAXT - 1] += k * gy; TZ[MAXT - 1] += k * gz; return; }
  TL[NT] = lambda; TX[NT] = k * gx; TY[NT] = k * gy; TZ[NT] = k * gz; NT++;
}
/** scale every slope / amplitude term (e.g. by the coastal ramp) */
export function slopeScale(k) { for (let i = 0; i < NT; i++) { TX[i] *= k; TY[i] *= k; TZ[i] *= k; } for (let i = 0; i < NA; i++) AA[i] *= k; }
/** total slope of all terms (debug / material hints) -> out[0..2] */
export function slopeTotal(out) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < NT; i++) { x += TX[i]; y += TY[i]; z += TZ[i]; }
  out[0] = x; out[1] = y; out[2] = z; return out;
}

// fast sin of 2*pi*t (any real t), max abs error ~1e-3, C1
function sin2pi(t) {
  let u = t - Math.floor(t + 0.5);             // [-0.5, 0.5)
  const x = u * 6.283185307179586;            // [-pi, pi)
  let y = 1.2732395447351628 * x - 0.4052847345693511 * x * (x < 0 ? -x : x);
  y = 0.225 * (y * (y < 0 ? -y : y) - y) + y;
  return y;
}

const EO = new Float64Array(2);
function gullyOctave(o, X, Y, Z, dx, dy, dz, phase) {
  const m = ROT[o], is = 1 / GULLY_CELLS[o];
  const qx = (m[0] * X + m[1] * Y + m[2] * Z) * is, qy = (m[3] * X + m[4] * Y + m[5] * Z) * is, qz = (m[6] * X + m[7] * Y + m[8] * Z) * is;
  // d = wave vector in cycles per cell (magnitude STRIPES), phase in cycles
  const ex = m[0] * dx + m[1] * dy + m[2] * dz, ey = m[3] * dx + m[4] * dy + m[5] * dz, ez = m[6] * dx + m[7] * dy + m[8] * dz;
  const ph0 = phase;
  const ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
  // exact lower bounds of the squared distance to each neighbour cell's jittered point (per axis),
  // so cells that cannot reach the kernel support are skipped before hashing
  const fx = qx - ix, fy = qy - iy, fz = qz - iz;
  const mx0 = (fx + 0.15) * (fx + 0.15), mx2 = (1.15 - fx) * (1.15 - fx), mx1 = fx < 0.15 ? (0.15 - fx) * (0.15 - fx) : fx > 0.85 ? (fx - 0.85) * (fx - 0.85) : 0;
  const my0 = (fy + 0.15) * (fy + 0.15), my2 = (1.15 - fy) * (1.15 - fy), my1 = fy < 0.15 ? (0.15 - fy) * (0.15 - fy) : fy > 0.85 ? (fy - 0.85) * (fy - 0.85) : 0;
  const mz0 = (fz + 0.15) * (fz + 0.15), mz2 = (1.15 - fz) * (1.15 - fz), mz1 = fz < 0.15 ? (0.15 - fz) * (0.15 - fz) : fz > 0.85 ? (fz - 0.85) * (fz - 0.85) : 0;
  let v = 0, g = 0, ws = 0;
  const seed = 0x9c3 + o * 131;
  for (let oz = -1; oz <= 1; oz++) {
    const bz = oz < 0 ? mz0 : oz > 0 ? mz2 : mz1;
    for (let oy = -1; oy <= 1; oy++) {
      const byz = bz + (oy < 0 ? my0 : oy > 0 ? my2 : my1);
      if (byz >= 2.25) continue;
      for (let ox = -1; ox <= 1; ox++) {
    if (byz + (ox < 0 ? mx0 : ox > 0 ? mx2 : mx1) >= 2.25) continue;
    const cx = ix + ox, cy = iy + oy, cz = iz + oz;
    const hh = hash3(cx, cy, cz, seed);
    // jitter in [0.15, 0.85]: every point of space is within 1.47 cells of its own cell's point
    const rx = qx - (cx + 0.15 + 0.7 * (hh & 1023) / 1023);
    const ry = qy - (cy + 0.15 + 0.7 * ((hh >>> 10) & 1023) / 1023);
    const rz = qz - (cz + 0.15 + 0.7 * ((hh >>> 20) & 1023) / 1023);
    const d2 = rx * rx + ry * ry + rz * rz;
    if (d2 >= 2.25) continue;
    let w = 1 - d2 * 0.4444444444444444; w = w * w * w;
    const t = rx * ex + ry * ey + rz * ez + ph0;    // phase in cycles
    v += w * sin2pi(t + 0.25); g -= w * sin2pi(t); ws += w;
      }
    }
  }
  const iw = 1 / ws;
  EO[0] = v * iw; EO[1] = g * iw;
  return EO;
}

export function gullies(x, y, z, X, Y, Z, scale, mw, out) {
  let h = 0, egx = 0, egy = 0, egz = 0, trough = 0, crest = 1;
  out.trough = 0; out.crest = 0;
  if (scale <= 0 || NT === 0 || NA === 0) return 0;
  for (let o = 0; o < NOCT; o++) {
    const s = GULLY_CELLS[o];
    const bw = bandW(s / STRIPES, mw);
    if (bw <= 0) break;
    // amplitude of this octave from the band-tagged amplitude terms
    const lo = 1.2 * s, hi = 2.6 * s;
    let a = 0;
    for (let i = 0; i < NA; i++) {
      const l = AL[i];
      if (l <= lo) continue;
      let w = 1;
      if (l < hi) { const t = (l - lo) / (hi - lo); w = t * t * (3 - 2 * t); }
      const sref = l / 2.6 < 20000 ? l / 2.6 : 20000;
      a += AA[i] * w * (s < sref ? s / sref : 1);
    }
    const A0 = a * scale * bw;
    if (A0 < 0.05) continue;
    // macro slope seen by this octave: terms with wavelength >= ~1.2 cells
    let gx = 0, gy = 0, gz = 0;
    for (let i = 0; i < NT; i++) {
      const l = TL[i];
      if (l <= lo) continue;
      let w = 1;
      if (l < hi) { const t = (l - lo) / (hi - lo); w = t * t * (3 - 2 * t); }
      gx += w * TX[i]; gy += w * TY[i]; gz += w * TZ[i];
    }
    const gn = gx * x + gy * y + gz * z;
    gx -= gn * x; gy -= gn * y; gz -= gn * z;
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
    // carved slopes steer the finer octaves, but never by more than BCAP of the macro slope
    const el = Math.sqrt(egx * egx + egy * egy + egz * egz);
    const lim = el > BCAP * gl ? (BCAP * gl) / el : 1;
    const tx = gx + egx * lim, ty = gy + egy * lim, tz = gz + egz * lim;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) + 1e-12;
    const fade = tl / (tl + S0);
    const A = A0 * fade * (A0 < 0.15 ? (A0 - 0.05) / 0.1 : 1);
    if (A <= 0) continue;
    const k = STRIPES / tl;
    const dx = (y * tz - z * ty) * k, dy = (z * tx - x * tz) * k, dz = (x * ty - y * tx) * k;
    const iw = 1 / (1.3 * s);
    const phase = 0.3183 * NW.n(X * iw + o * 7.3, Y * iw, Z * iw);
    const r = gullyOctave(o, X, Y, Z, dx, dy, dz, phase);
    // sharpen: narrow crests, broad V-ish troughs (smooth, no creases from clamping)
    let u0 = (r[0] + 1) * 0.5; u0 = u0 < 0 ? 0 : u0 > 1 ? 1 : u0;
    const u = Math.pow(u0, SHARP_P);
    h += (u - 1) * 2 * A;
    if (o < 3) { trough = Math.max(trough, (1 - u) * (1 - u) * fade * bw); crest *= 0.55 + 0.45 * u; }
    const br = BRANCH[o];
    if (br > 0) {
      const du = 0.5 * SHARP_P * Math.pow(u0 > 1e-4 ? u0 : 1e-4, SHARP_P - 1) * r[1];
      const kk = 2 * A * du * 2 * Math.PI / s * br;
      egx += kk * dx; egy += kk * dy; egz += kk * dz;
    }
  }
  out.trough = trough; out.crest = crest;
  return h;
}
