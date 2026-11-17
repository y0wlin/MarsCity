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
// Band limit (fix round 2, Z-03): the wave direction follows the local slope field, and the kernel lever arm
// (|r| <= 1.5 cells, STRIPES cycles per cell) turns fast rotations of that field (ridged-octave creases, the
// carved-slope feedback of coarser octaves) into phase sweeps far finer than the nominal wavelength cell/STRIPES:
// 80-90 m scarps 10-15 m wide that aliased into combs / needles at every LOD. Each octave is therefore faded by its
// EFFECTIVE local frequency f = STRIPES (1/cell + C_LEVER * omega), omega = |d(steering)/dx| / |steering| from
// per-term curvature bounds (slopeTerm kappa) and the carved-slope derivative of the coarser octaves, and it fades
// toward its mean carve (UMEAN), not to 0, so coarse and fine LODs keep the same mean ground. Full detail
// (mw = 0) is unchanged.

import { hash3, makeRotations, makeNoise, bandW, smax } from './noise.js';

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
const TK = new Float64Array(MAXT);   // curvature bound |d T / dx| (1/m) of each slope term
const UMEAN = 0.347;                 // mean of the sharpened profile u = u0^SHARP_P (measured)
const C_LEVER = 1.0;                 // effective lever arm (cells) of the kernel blend
const S_MAX = 1.6;                   // steepest slope one octave may draw (m/m)
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
/**
 * Slope term of wavelength lambda: k * (gx, gy, gz) (m/m, ECEF). kap = bound of its spatial derivative magnitude
 * (1/m); default: a smooth term, 1.5 |k g| 2 pi / lambda.
 */
export function slopeTerm(lambda, k, gx, gy, gz, kap) {
  if (k === 0) return;
  const kk = kap !== undefined ? Math.abs(kap) : 1.5 * Math.abs(k) * Math.sqrt(gx * gx + gy * gy + gz * gz) * 6.283185307179586 / lambda;
  if (NT >= MAXT) { TX[MAXT - 1] += k * gx; TY[MAXT - 1] += k * gy; TZ[MAXT - 1] += k * gz; TK[MAXT - 1] += kk; return; }
  TL[NT] = lambda; TX[NT] = k * gx; TY[NT] = k * gy; TZ[NT] = k * gz; TK[NT] = kk; NT++;
}
/** scale every slope / amplitude term (e.g. by the coastal ramp) */
export function slopeScale(k) { for (let i = 0; i < NT; i++) { TX[i] *= k; TY[i] *= k; TZ[i] *= k; TK[i] *= k; } for (let i = 0; i < NA; i++) AA[i] *= k; }
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
  let deg = 0;          // bound of |d(carved steering)/dx| (1/m) accumulated over the coarser octaves
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
    let gx = 0, gy = 0, gz = 0, dk = 0;
    for (let i = 0; i < NT; i++) {
      const l = TL[i];
      if (l <= lo) continue;
      let w = 1;
      if (l < hi) { const t = (l - lo) / (hi - lo); w = t * t * (3 - 2 * t); }
      gx += w * TX[i]; gy += w * TY[i]; gz += w * TZ[i]; dk += w * TK[i];
    }
    const gn = gx * x + gy * y + gz * z;
    gx -= gn * x; gy -= gn * y; gz -= gn * z;
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
    // carved slopes steer the finer octaves, but never by more than BCAP of the macro slope
    const el = Math.sqrt(egx * egx + egy * egy + egz * egz);
    const lim = el > BCAP * gl ? (BCAP * gl) / el : 1;
    let ex2 = egx * lim, ey2 = egy * lim, ez2 = egz * lim;
    // the carved steering may bend and weaken the macro slope but never nearly cancel it: its component against
    // the macro slope is soft-clamped at -0.5 |g| (near cancellation made the direction hypersensitive: tiny changes
    // rotated it fast -> cliffs a few metres wide, Z-03)
    if (gl > 1e-9) {
      const ig = 1 / gl, ga = (ex2 * gx + ey2 * gy + ez2 * gz) * ig;
      const lo2 = -0.5 * gl;
      if (ga < lo2 + 0.2 * gl) {
        const gc = smax(ga, lo2, 0.2 * gl);
        const dd = (gc - ga) * ig;
        ex2 += gx * dd; ey2 += gy * dd; ez2 += gz * dd;
      }
    }
    const tx = gx + ex2, ty = gy + ey2, tz = gz + ez2;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) + 1e-12;
    // amplitude from the (smooth) macro slope only: a steering-dependent amplitude jumped where the carved
    // slopes changed fast
    const fade = gl / (gl + S0);
    const A = A0 * fade * (A0 < 0.15 ? (A0 - 0.05) / 0.1 : 1);
    if (A <= 0) continue;
    const k = STRIPES / tl;
    const dx = (y * tz - z * ty) * k, dy = (z * tx - x * tz) * k, dz = (x * ty - y * tx) * k;
    // effective local frequency (cycles/m): nominal + lever-arm phase rate of the rotating steering direction
    const omega = (dk + lim * deg) / (tl > 1e-4 ? tl : 1e-4);
    const fEff = STRIPES * (1 / s + C_LEVER * omega);
    // extra fade relative to the nominal band limit (1 at full detail)
    let rE = 1;
    if (mw > 0) { const bn = bw; rE = bn > 0 ? bandW(1 / fEff, mw) / bn : 0; rE = rE > 1 ? 1 : rE; }
    // also at full detail: near singular points of the steering field (summits, saddles) the direction rotates
    // within metres; an octave may not draw features steeper than ~S_MAX there (it relaxes to its mean carve)
    const lamMin = 6.283185307179586 * A / S_MAX;
    const lamE = 1 / fEff;
    if (lamE < lamMin) { const t = (lamE - 0.5 * lamMin) / (0.5 * lamMin); const q = t <= 0 ? 0 : t * t * (3 - 2 * t); if (q < rE) rE = q; }
    const iw = 1 / (1.3 * s);
    const phase = 0.3183 * NW.n(X * iw + o * 7.3, Y * iw, Z * iw);
    const r = gullyOctave(o, X, Y, Z, dx, dy, dz, phase);
    // sharpen: narrow crests, broad V-ish troughs (smooth, no creases from clamping)
    let u0 = (r[0] + 1) * 0.5; u0 = u0 < 0 ? 0 : u0 > 1 ? 1 : u0;
    const u = Math.pow(u0, SHARP_P);
    // unresolved octaves fade toward their mean carve (coarse and fine LODs keep the same mean ground)
    h += ((u - 1) * rE + (UMEAN - 1) * (1 - rE)) * 2 * A;
    if (o < 3) { trough = Math.max(trough, (1 - u) * (1 - u) * fade * bw); crest *= 0.55 + 0.45 * u; }
    const br = BRANCH[o];
    if (br > 0) {
      const du = 0.5 * SHARP_P * Math.pow(u0 > 1e-4 ? u0 : 1e-4, SHARP_P - 1) * r[1];
      const kk = 2 * A * du * 2 * Math.PI / s * br;
      egx += kk * dx; egy += kk * dy; egz += kk * dz;
      // derivative bound of this carved slope: the wave phase (2 pi fEff) and the rotation of d (omega)
      // (the carved slope varies with this octave's nominal wavelength; a bound with the effective rate cascades)
      deg += STRIPES * Math.abs(kk) * 2 * Math.PI * STRIPES / s;
    }
  }
  out.trough = trough; out.crest = crest;
  return h;
}
