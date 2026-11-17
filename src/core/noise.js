// Seeded float64 noise library (simplex 2D/3D, fbm, ridged, Worley). Worker-safe, no deps.
// Inputs are plain numbers in "noise space" (usually metres / wavelength). Float64 keeps
// sub-millimetre precision even at planetary coordinates (|x| ~ 1e7).

import { mulberry32, hash4 } from './hash.js';
import { SEED } from './constants.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

function buildPerm(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
  return { perm, permMod12 };
}

/**
 * Create an independent simplex noise generator. Different `channel` values give
 * uncorrelated fields from the same world seed.
 */
export function createNoise(channel = 0, seed = SEED) {
  const { perm, permMod12 } = buildPerm(hash4(channel, 7919, 0, 0, seed));

  /** 3D simplex in [-1,1] */
  function noise3(xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, t0, g;
    t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { g = permMod12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
    t0 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t0 > 0) { g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
    t0 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t0 > 0) { g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
    t0 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t0 > 0) { g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
    return 32 * n;
  }

  /** 2D simplex in [-1,1] */
  function noise2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, t0, g;
    t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { g = permMod12[ii + perm[jj]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0); }
    t0 = 0.5 - x1 * x1 - y1 * y1;
    if (t0 > 0) { g = permMod12[ii + i1 + perm[jj + j1]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1); }
    t0 = 0.5 - x2 * x2 - y2 * y2;
    if (t0 > 0) { g = permMod12[ii + 1 + perm[jj + 1]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2); }
    return 70 * n;
  }

  /** fractal Brownian motion, returns roughly [-1,1] */
  function fbm3(x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise3(x * f + o * 17.13, y * f - o * 9.71, z * f + o * 3.37);
      norm += amp; amp *= gain; f *= lacunarity;
    }
    return sum / norm;
  }

  /** ridged multifractal in [0,1] */
  function ridged3(x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5, offset = 1.0) {
    let sum = 0, amp = 0.5, f = 1, prev = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = offset - Math.abs(noise3(x * f + o * 11.7, y * f + o * 5.3, z * f - o * 7.1));
      n *= n;
      sum += n * amp * prev;
      norm += amp;
      prev = n; amp *= gain; f *= lacunarity;
    }
    return sum / norm;
  }

  function fbm2(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise2(x * f + o * 17.13, y * f - o * 9.71);
      norm += amp; amp *= gain; f *= lacunarity;
    }
    return sum / norm;
  }

  return { noise3, noise2, fbm3, ridged3, fbm2 };
}

/**
 * 3D Worley / cellular noise. Returns {f1, f2, id, cx, cy, cz} where (cx,cy,cz) is the
 * nearest feature point. `out` is reused to avoid allocation.
 */
export function worley3(x, y, z, channel = 0, jitter = 1.0, out = {}) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let f1 = 1e30, f2 = 1e30, id = 0, cx = 0, cy = 0, cz = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = xi + dx, Y = yi + dy, Z = zi + dz;
    const h = hash4(X, Y, Z, channel);
    const px = X + 0.5 + jitter * (((h & 1023) / 1023) - 0.5);
    const py = Y + 0.5 + jitter * ((((h >>> 10) & 1023) / 1023) - 0.5);
    const pz = Z + 0.5 + jitter * ((((h >>> 20) & 1023) / 1023) - 0.5);
    const ddx = px - x, ddy = py - y, ddz = pz - z;
    const d = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d < f1) { f2 = f1; f1 = d; id = h; cx = px; cy = py; cz = pz; }
    else if (d < f2) { f2 = d; }
  }
  out.f1 = Math.sqrt(f1); out.f2 = Math.sqrt(f2); out.id = id; out.cx = cx; out.cy = cy; out.cz = cz;
  return out;
}

/** 2D Worley with nearest/second nearest and edge distance (distance to Voronoi border). */
export function worley2(x, y, channel = 0, jitter = 1.0, out = {}) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e30, f2 = 1e30, id = 0, id2 = 0, px1 = 0, py1 = 0, px2 = 0, py2 = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = xi + dx, Y = yi + dy;
    const h = hash4(X, Y, channel, 1);
    const px = X + 0.5 + jitter * (((h & 65535) / 65535) - 0.5);
    const py = Y + 0.5 + jitter * ((((h >>> 16) & 65535) / 65535) - 0.5);
    const d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < f1) { f2 = f1; id2 = id; px2 = px1; py2 = py1; f1 = d; id = h; px1 = px; py1 = py; }
    else if (d < f2) { f2 = d; id2 = h; px2 = px; py2 = py; }
  }
  // distance to the bisector between nearest and second-nearest = edge distance
  const mx = (px1 + px2) * 0.5, my = (py1 + py2) * 0.5;
  let nx = px2 - px1, ny = py2 - py1; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
  out.edge = Math.abs((x - mx) * nx + (y - my) * ny);
  out.f1 = Math.sqrt(f1); out.f2 = Math.sqrt(f2); out.id = id; out.id2 = id2; out.cx = px1; out.cy = py1;
  return out;
}

// Shared default generators (channel numbers are part of the world definition — do not reuse
// a channel for a different purpose). Modules may create their own via createNoise(channel).
export const N0 = createNoise(0);

// --- small helpers -----------------------------------------------------------
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const fract = (x) => x - Math.floor(x);
