// Wave spectrum of the water renderer (pure JS, deterministic, no THREE). OWNER: water agent.
//
// The open-water surface is a sum of NW directional gravity–capillary waves in FACE-PLANE metres
// (x = a·FACE_ARC, y = b·FACE_ARC of the cube face). Every wave vector is an integer multiple of
// 2π / WAVE_PERIOD so that k·(x mod WAVE_PERIOD) ≡ k·x (mod 2π): each tile only needs its origin
// modulo WAVE_PERIOD (float64 on the CPU) and the shader stays precise at any distance from the face
// centre. Phases are advanced on the CPU in float64 every frame (phase_i(t) = φ_i − ω_i·t mod 2π),
// so the animation never loses precision however long the page runs.
//
// Bands (amplitude multipliers per vertex: swell / wind; see tiles.js):
//   0..11  swell        λ 55–230 m   ak ≈ 0.0125 (two swell systems, open sea only, calm inside the G01 harbour)
//   12..35 wind sea     λ 2.6–60 m   ak ≈ 0.037             (fetch-limited on lakes)
//   36..47 chop         λ 0.36–2.6 m ak ≈ 0.055 (spread ±86°)
//   48..57 ripples      λ 0.045–0.36 ak ≈ 0.06 (spread ±103°, capillary dispersion)
// Total slope variance of the open sea ≈ 0.05 (Cox–Munk for ~9 m/s wind): the orbit glint width.
// Mars gravity (3.72 m/s²) sets the dispersion — waves are slower and longer-period than on Earth.
// Fix round 1 (no regular cross-hatch at 5–20 km): 3× more swell / 1.5× more wind-sea components (same
// total slope variance), a second swell system, and per-wave regional jitter coefficients (WAVE_JITTER):
// the shader modulates every wave's amplitude and phase by planet-anchored regional noise (2–13 km, not
// periodic, continuous across tiles and faces) and turns the wind-sea spectrum towards a regional wind
// direction, so neither the 4096 m lattice period nor the interference pattern of the discrete set repeats.
// waveHeight() (CPU) returns the un-jittered set (the regional jitter only moves crests by ≲ 1 rad).
import { hash4 } from '../../core/hash.js';
import { SEED, FACE_ARC } from '../../core/constants.js';

export const WAVE_PERIOD = 4096;          // m (face-plane metres)
export const G_MARS = 3.72;               // m/s²
export const NW = 58;
export const BAND = { swell: [0, 12], wind: [12, 36], chop: [36, 48], ripple: [48, 58] };

const TAU = Math.PI * 2;
const r01 = (i, k) => hash4(i, k, 0x57a7e, 0, SEED) / 4294967296;

// The four equatorial faces (U = east, V = north on all of them) share ONE sea state, so wave directions continue
// across their edges, and their phases are offset so the crests continue too across the edges 0|5 (135°E, the
// east inner sea), 5|1 (135°W) and 1|4 (45°W, G02): the ring 0 → 5 → 1 → 4 closes with a phase jump only at 4|0
// (45°E, no water there). Polar faces keep their own random sea.
const EQ_RING_STEP = { 0: 0, 5: 1, 1: 2, 4: 3 };
const EQ_WIND = 2.89, EQ_SWELL = 1.36, EQ_SWELL2 = 1.36 - 1.25;   // toward WNW; swell from SSW (G01 open sea) + W

/** wind / swell headings in face-plane radians (shared by the equatorial faces, random on the polar faces) */
export function faceWind(face) {
  if (face in EQ_RING_STEP) return { wind: EQ_WIND, swell: EQ_SWELL, swell2: EQ_SWELL2 };
  const w = r01(face, 11) * TAU;
  const sw = w + (r01(face, 12) - 0.5) * 0.9;
  return { wind: w, swell: sw, swell2: sw + (r01(face, 13) < 0.5 ? -1 : 1) * (0.9 + 0.8 * r01(face, 14)) };
}

/** rational approximation (p, q) (small integers) of a face-plane direction: lattice-periodic rotated noise */
export function rationalDir(ang, maxN = 14) {
  const c = Math.cos(ang), s = Math.sin(ang);
  let best = [1, 0], be = Infinity;
  for (let p = -maxN; p <= maxN; p++) for (let q = -maxN; q <= maxN; q++) {
    if (!p && !q) continue;
    const l = Math.hypot(p, q);
    const e = 1 - (p * c + q * s) / l + 0.0004 * l;      // angle error, small integers preferred
    if (e < be) { be = e; best = [p, q]; }
  }
  return best;
}

function makeBand(out, i0, i1, lamMax, lamMin, steep, spread, dirKey, seedK) {
  const n = i1 - i0;
  for (let q = 0; q < n; q++) {
    const i = i0 + q;
    const t = (q + 0.15 + 0.7 * r01(i, seedK)) / n;
    const lam = lamMax * Math.pow(lamMin / lamMax, t);
    const dirOff = (r01(i, seedK + 1) - 0.5) * 2 * spread;
    const amp = (steep * (0.7 + 0.6 * r01(i, seedK + 2))) * lam / TAU;
    out.push({ i, lam, dirOff, amp, phase: r01(i, seedK + 3) * TAU, dirKey });
  }
}

/** the wave set (face-independent part) */
export const WAVES = (() => {
  const list = [];
  makeBand(list, 0, 12, 230, 55, 0.0125, 0.50, 'swell', 100);
  // the second swell system: every third swell component
  for (const w of list) if (w.i % 3 === 2) w.dirKey = 'swell2';
  makeBand(list, 12, 36, 60, 2.6, 0.037, 0.85, 'wind', 200);
  makeBand(list, 36, 48, 2.6, 0.36, 0.055, 1.5, 'wind', 300);
  makeBand(list, 48, 58, 0.36, 0.045, 0.060, 1.8, 'wind', 400);
  return list;
})();

/**
 * Per-wave regional jitter coefficients (Float32Array(NW*4)): (amplitude c1, c2, phase c1, c2). The shader
 * forms amp *= 1 + Σ c·n and phase += π·Σ c·m from planet-anchored regional noise channels n, m.
 */
export const WAVE_JITTER = (() => {
  const out = new Float32Array(NW * 4);
  for (let i = 0; i < NW; i++) {
    const a = r01(i, 501) * TAU, b = r01(i, 503) * TAU;
    const ra = 0.75 + 0.5 * r01(i, 502), rb = 0.6 + 0.8 * r01(i, 504);
    out[i * 4] = Math.cos(a) * ra; out[i * 4 + 1] = Math.sin(a) * ra;
    out[i * 4 + 2] = Math.cos(b) * rb; out[i * 4 + 3] = Math.sin(b) * rb;
  }
  return out;
})();

/**
 * Per-face uniform data: kx, ky (rad/m, quantised to the WAVE_PERIOD lattice), amp (m), omega (rad/s).
 * Returns Float32Array(NW*4).
 */
export function faceWaveData(face) {
  const fw = faceWind(face);
  const out = new Float32Array(NW * 4);
  const omega = new Float64Array(NW);
  const phase0 = new Float64Array(NW);
  const k0 = TAU / WAVE_PERIOD;
  const step = EQ_RING_STEP[face] || 0;
  for (const w of WAVES) {
    const dir = (w.dirKey === 'swell' ? fw.swell : w.dirKey === 'swell2' ? fw.swell2 : fw.wind) + w.dirOff;
    const k = TAU / w.lam;
    const nx = Math.round((Math.cos(dir) * k) / k0), ny = Math.round((Math.sin(dir) * k) / k0);
    const kx = nx * k0, ky = ny * k0, kk = Math.hypot(kx, ky) || k0;
    // gravity–capillary dispersion (surface tension 0.072 N/m, density 1000 kg/m³)
    const om = Math.sqrt(G_MARS * kk + 7.2e-5 * kk * kk * kk);
    out[w.i * 4] = kx; out[w.i * 4 + 1] = ky; out[w.i * 4 + 2] = w.amp; out[w.i * 4 + 3] = om;
    omega[w.i] = om;
    // crossing an equatorial edge east → west face: x jumps from +FACE_ARC to −FACE_ARC (y unchanged), so the next
    // face's phase = this face's + kx·2·FACE_ARC (exact fraction in float64: nx·2·FACE_ARC / 4096 cycles)
    const cyc = (nx * 2 * FACE_ARC / WAVE_PERIOD) % 1;
    phase0[w.i] = (w.phase + step * cyc * TAU) % TAU;
  }
  return { data: out, omega, phase0, wind: fw.wind, pq: rationalDir(fw.wind) };
}

/** phases at time t (seconds, float64) into out (Float32Array(NW)) */
export function wavePhases(t, omega, out, phase0 = null) {
  for (const w of WAVES) {
    let p = ((phase0 ? phase0[w.i] : w.phase) - omega[w.i] * t) % TAU;
    if (p < 0) p += TAU;
    out[w.i] = p;
  }
  return out;
}

/** phases at time t written into the .w slot of a per-face (kx, ky, amp, phase) uniform array */
export function wavePhases4(t, omega, data4, phase0 = null) {
  for (const w of WAVES) {
    let p = ((phase0 ? phase0[w.i] : w.phase) - omega[w.i] * t) % TAU;
    if (p < 0) p += TAU;
    data4[w.i * 4 + 3] = p;
  }
  return data4;
}

/** total slope variance of a band range for amplitude multiplier 1 */
export function bandVariance(i0, i1) {
  let v = 0;
  for (const w of WAVES) if (w.i >= i0 && w.i < i1) { const k = TAU / w.lam; v += 0.5 * (w.amp * k) * (w.amp * k); }
  return v;
}

/**
 * CPU wave height (m) at face-plane metres (x, y) for props / cameras (boats bobbing, eye level).
 * swell / wind: amplitude multipliers (see tiles.js); t seconds.
 */
export function waveHeight(face, x, y, t, swell = 1, wind = 1) {
  const fd = faceData(face);
  let h = 0;
  const xm = ((x % WAVE_PERIOD) + WAVE_PERIOD) % WAVE_PERIOD, ym = ((y % WAVE_PERIOD) + WAVE_PERIOD) % WAVE_PERIOD;
  for (const w of WAVES) {
    if (w.i >= BAND.chop[0]) break;
    const o = w.i * 4;
    const a = fd.data[o + 2] * (w.i < BAND.wind[0] ? swell : wind);
    h += a * Math.sin(fd.data[o] * xm + fd.data[o + 1] * ym + fd.phase0[w.i] - fd.omega[w.i] * t);   // = shader sin(th)
  }
  return h;
}
const FACE_CACHE = new Map();
export function faceData(face) {
  let d = FACE_CACHE.get(face);
  if (!d) { d = faceWaveData(face); FACE_CACHE.set(face, d); }
  return d;
}
