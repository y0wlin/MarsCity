// Settlement potential from the shared planetary fields (fields.sampleFields contract) plus the
// plan's own mid-scale structure noises. Pure functions of (fields, position).
//
//   envZ(F, p, t)   0..1  city envelope in Z: fields.urban (density stars + coastal belts, already
//                   masked by water / rock / ice / canyon) minus rifts, broken by mid-scale noise into
//                   wide sheets, narrow necks, branches and gaps (宽片、窄颈、分叉).
//   bgZ(F, p)       0..1  background settlement potential in Z (sparse villages / farms along the
//                   low-density stripes of built-density.png; 0 on rock, ice, water).
//   envO(F, p, t)   0..1  settlement tendency in O (faint control-map stars = water-network towns).
//   farmO(F)        0..1  irrigated farmland potential (canal network reach).
import { createNoise } from '../../core/noise.js';
import { R } from '../../core/constants.js';
import { harbourAt, nearHarbour } from './harbour.js';

export const NZ = createNoise(311);     // envelope break-up
export const NG = createNoise(312);     // green belts / wind gaps
export const NI = createNoise(313);     // industrial / port tendency
export const NO = createNoise(314);     // orientation field
export const NT = createNoise(315);     // district tone / era / sub-district grain
export const NF = createNoise(316);     // farm crops / seasons
export const NV = createNoise(317);     // village clustering

export function sstep(e0, e1, x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
export function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

const K21 = R / 21000, K7 = R / 7300, K55 = R / 55000;

/** band-limit factor of a noise octave of wavelength wl for a footprint t (0 = filtered out) */
export function bandK(wl, t) { if (!(t > 0)) return 1; const q = t / wl; return q < 0.15 ? 1 : q > 0.8 ? 0 : 1 - sstep(0.15, 0.8, q); }

/** mid-scale break-up noise in [-1,1] (≈ 21 km + 7.3 km octaves), band-limited by footprint t */
export function breakup(x, y, z, t = 0) {
  const k1 = bandK(21000, t), k2 = bandK(7300, t);
  let a = k1 > 0 ? 0.68 * k1 * NZ.noise3(x * K21, y * K21, z * K21) : 0;
  if (k2 > 0) a += 0.32 * k2 * NZ.noise3(x * K7 + 31.7, y * K7 - 11.2, z * K7 + 5.3);
  return a;
}

/** land fraction of a footprint t (box-filtered signed shore distance) */
export function landFrac(F, t) {
  const h = Math.max(20, t * 0.5);
  return sstep(-h, h, F.coastM);
}

/** city envelope (Z) 0..1 — the G01 protected port city (harbour.js) overrides the control maps there */
const HBE = {};
export function envZ(F, x, y, z, t = 0) {
  const e = envZ0(F, x, y, z, t);
  if (!nearHarbour(x, y, z)) return e;
  harbourAt(x, y, z, HBE);
  return HBE.w > 0 && HBE.env > e ? HBE.env : e;
}
function envZ0(F, x, y, z, t) {
  const u = F.urban;
  if (!(u > 0)) return 0;
  const m = (1 - (F.rift || 0)) * (1 - sstep(0.42, 0.78, F.ridge));
  if (m <= 0) return 0;
  const n = breakup(x, y, z, t);
  // metro centres stay solid; arm edges and thin branches break into towns and necks
  const v = u + (0.17 + 0.13 * (1 - u)) * n;
  return sstep(0.15, 0.55, v) * m;
}

/** background (rural) settlement potential in Z, 0..1 */
export function bgZ(F, x, y, z) {
  const d = F.density;
  if (d < 0.012) return 0;
  const m = sstep(0, 400, F.coastM) * (1 - sstep(0.22, 0.5, F.ridge)) * (1 - sstep(0.2, 0.55, F.ice)) * (1 - (F.rift || 0)) * (1 - 0.6 * (F.canyon || 0));
  if (m <= 0) return 0;
  const k = R / 90000;
  const cl = 0.5 + 0.5 * NV.noise3(x * k, y * k, z * k);       // regional clustering of farming country
  return sstep(0.012, 0.10, d) * m * (0.45 + 0.55 * cl);
}

/** settlement tendency in O (0..1): faint control-map stars + canal farmland */
export function envO(F, x, y, z, t = 0) {
  const s = sstep(0.02, 0.21, F.density);
  const m = sstep(0, 300, F.coastM) * (1 - sstep(0.3, 0.66, F.ridge));
  if (m <= 0) return 0;
  const n = breakup(x, y, z, t);
  return sstep(0.12, 0.62, s + 0.18 * n) * m;
}

/** irrigated farmland potential in O (0..1) */
export function farmO(F) {
  const m = sstep(-10, 120, F.coastM) * (1 - sstep(0.3, 0.66, F.ridge)) * (1 - sstep(0.45, 0.8, F.ice));
  if (m <= 0) return 0;
  return clamp01(F.farm) * m;
}

/** green-belt mask (dark-green gaps between towns), 0..1, band-limited by footprint t.
 *  Broad, gently curving swaths (≈ 1.2–2.5 km wide, ~40 km apart), not river-like squiggles.
 *  capM > 0 (U6): half-width capped to capM metres (dense metro fabric: belts of ~600–900 m), measured with the
 *  local noise gradient; with a footprint t the edge softness is ~t/2 in metres so district-level texels put the
 *  belt edge where the block decisions (threshold 0.5 at t = 0) put it (U10). */
const BK = R / 42000;
function beltNoise(x, y, z, k2) { return NG.noise3(x * BK, y * BK, z * BK) + 0.08 * k2 * NG.noise3(x * BK * 3.1 + 9.1, y * BK * 3.1, z * BK * 3.1 - 4.4); }
export function greenBelt(x, y, z, t = 0, capM = 0) {
  const k = BK;
  const k2 = bandK(14000, t);
  const n = beltNoise(x, y, z, k2);
  const sel = NG.noise3(x * k * 0.45 - 3.3, y * k * 0.45, z * k * 0.45 + 7.7);   // only parts of the network are belts
  if (sel < -0.15) return 0;
  let w = (0.022 + 0.04 * sstep(-0.15, 0.45, sel)), soft = 0.012 + Math.min(0.2, t / 42000 * 1.2);
  if ((capM > 0 || t > 0) && Math.abs(n) < w + soft + 0.01) {
    const e = 40 / R;
    const gx = (beltNoise(x + e, y, z, k2) - n) / 40, gy = (beltNoise(x, y + e, z, k2) - n) / 40, gz = (beltNoise(x, y, z + e, k2) - n) / 40;
    const dot = gx * x + gy * y + gz * z;
    const g = Math.hypot(gx - dot * x, gy - dot * y, gz - dot * z) || 1e-9;   // noise units per metre (tangential)
    if (capM > 0 && capM * g < w) w = capM * g;
    if (t > 0) soft = Math.min(soft, g * (40 + 0.5 * t));
  }
  return (1 - sstep(w - soft, w + soft, Math.abs(n))) * sstep(-0.15, 0.05, sel);
}

/** belts only between settlements: town cores and station areas stay continuous; dense (0..1, the district
 *  envelope) caps the belt width in dense metro fabric (U6) */
export function beltCap(dense) { return dense > 0 ? 320 + 4200 * (1 - dense) : 0; }
export function beltMask(x, y, z, T, t = 0, dense = 0) {
  if (T > 0.6) return 0;
  return greenBelt(x, y, z, t, beltCap(dense)) * (1 - sstep(0.25, 0.6, T));
}

/** industrial tendency [-1,1] (clusters of 15–40 km) */
export function industrialTendency(x, y, z) {
  const k = R / 33000;
  return NI.noise3(x * k, y * k, z * k);
}

/** smooth regional orientation (radians) — neighbouring districts share a dominant grain */
export function regionalAngle(x, y, z) {
  return Math.PI * (NO.noise3(x * K55, y * K55, z * K55) + 0.35 * NO.noise3(x * K21 + 3.3, y * K21, z * K21 - 7.7));
}

/**
 * ZR3 wind gaps (风口): long grass corridors between plateau towns, stretched along the prevailing
 * easterly wind (anisotropic: ~140 km along the wind, ~30 km across). 0..1 (1 = in a gap).
 */
export function windGap(x, y, z, lat, lon) {
  const k1 = R / 140000, k2 = R / 30000;
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const e = lo * Math.cos(la), n = la;
  const wob = 0.35 * NG.noise2(e * k1 * 3 + 1.3, n * k2 * 0.5 - 2.2);
  const v = NG.noise2(e * k1 + 3.7, n * k2 + wob) * 0.8 + NG.noise2(e * k1 * 2.3, n * k2 * 1.7 + 8.1) * 0.2;
  return 1 - sstep(0.10, 0.19, Math.abs(v));
}

/** district tone / sub-district grain noise in [-1,1] at wavelength wl (m) */
export function grain(x, y, z, wl, ch = 0) {
  const k = R / wl;
  return NT.noise3(x * k + ch * 17.3, y * k - ch * 5.1, z * k + ch * 2.9);
}
