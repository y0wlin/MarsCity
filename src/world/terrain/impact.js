// Impact craters at all scales (pure, worker-safe). OWNER: terrain-fn agent.
//
// Crater centres are jittered points of 3D grids restricted to a thin shell around the sphere
// (seamless everywhere, incl. poles and ±180°). One grid per size class (factor 3 apart) gives a
// power-law size-frequency distribution. Influence radius 1.91 r <= 0.458 s (1.8 r of the profile
// plus the 5.5 % rim scallop) keeps every crater inside the 2x2x2 cell neighbourhood. Profiles follow Mars morphometry: simple bowls below ~7 km,
// complex craters (flat floor, central peak, terraced walls) above, peak rings for basins; the
// terraformed age (500 years of air, water and dust) degrades rims and fills floors. Rims are
// scalloped by low-frequency noise so no crater is a perfect ring.
//
// craterField(X,Y,Z, mw, ampBig, ampSmall, ageBias, out) -> height delta (m)
//   ampBig applies to craters r >= 15 km, ampSmall below 4 km (urban / farm smoothing), blended.
//   out.fresh (fresh floor/ejecta), out.wall (crater wall), out.floor (crater floor), out.rim.
// fixedCraters(x,y,z, mw, out) -> landmark craters; out.park = city crater park weight.

import { R } from '../../core/constants.js';
import { hash3, rehash, bandW, smoothstep, makeNoise } from './noise.js';
import { FIXED_CRATER_DATA } from './layout.js';

const NR = makeNoise(501);
const LEVELS = [
  { s: 240000, p: 0.36, age: 0.22 }, { s: 80000, p: 0.4, age: 0.18 }, { s: 27000, p: 0.36, age: 0.16 }, { s: 9000, p: 0.3, age: 0.24 },
  { s: 3000, p: 0.25, age: 0.32 }, { s: 1000, p: 0.2, age: 0.38 }, { s: 333, p: 0.17, age: 0.42 }, { s: 111, p: 0.15, age: 0.42 }, { s: 37, p: 0.13, age: 0.36 },
];
const NL = LEVELS.length;

const PR = { wall: 0, floor: 0, rim: 0 };
/**
 * Radial profile (m) at normalised distance rho = d/r. age 0 fresh .. 1 degraded.
 * soft: crest softening (band limit) in units of rho.
 */
export function craterProfile(rho, r, age, soft, out) {
  if (rho >= 1.8) return 0;
  const D = 2 * r;
  const cx = smoothstep(5000, 12000, D);                         // simple -> complex
  const dkm = D / 1000;
  let depth = (0.19 * D) * (1 - cx) + 1000 * Math.min(0.19 * dkm, 0.36 * Math.pow(dkm, 0.49)) * cx;
  let rim = depth * (0.22 - 0.07 * cx);
  depth *= 1 - 0.62 * age;
  rim *= 1 - 0.78 * age;
  const floorR = (0.14 + 0.36 * cx) + 0.28 * age * (1 - 0.3 * cx);
  const k = 2.4 - 0.9 * age;                                     // wall steepness
  let h;
  if (rho < 1) {
    let s = (rho - floorR) / (1 - floorR);
    s = s < 0 ? 0 : s;
    const b = 1 - Math.pow(s, k);
    h = rim - (depth + rim) * b;
    // infill: degraded floors are flat
    if (age > 0.3 && s < 0.25) h += (depth + rim) * 0.04 * (age - 0.3) * (1 - s / 0.25);
    if (cx > 0 && age < 0.85) {
      const pk = 0.3 * depth * cx * (1 - age);
      if (D < 90000) h += pk * Math.exp(-(rho * rho) / (0.016 + 0.01 * age));           // central peak
      else { const q = (rho - 0.28) / 0.07; h += 0.7 * pk * Math.exp(-q * q); }         // peak ring
      if (s > 0 && s < 1) {
        const steps = 3, f = s * steps, fi = Math.floor(f), ff = f - fi;
        const terr = (fi + smoothstep(0.3, 0.8, ff)) / steps;
        h -= (depth + rim) * 0.11 * cx * (1 - age) * (terr - s);
      }
    }
    if (out) {
      if (rho < floorR + 0.06) out.floor = Math.max(out.floor, 1 - age * 0.25);
      if (s > 0.12) out.wall = Math.max(out.wall, smoothstep(0.12, 0.55, s) * (1 - 0.6 * age));
      out.rim = Math.max(out.rim, smoothstep(0.75, 1, rho));
    }
  } else {
    const e = rho - 1;
    // ejecta blanket, fading to zero at rho = 1.8
    h = rim * Math.pow(rho, -3.0) * (1 - smoothstep(0.25, 0.8, e));
    if (out) { if (e < 0.12) out.wall = Math.max(out.wall, (1 - e / 0.12) * 0.65 * (1 - 0.6 * age)); out.rim = Math.max(out.rim, 1 - smoothstep(0, 0.3, e)); }
  }
  // soften the crest for band limiting
  if (soft > 0 && Math.abs(rho - 1) < soft) {
    const t = (rho - 1) / soft, w = 1 - t * t;
    h -= rim * 0.4 * w * w * (1 - age);
  }
  return h;
}

export function craterField(X, Y, Z, mw, ampBig, ampSmall, ageBias, out) {
  out.fresh = 0; out.wall = 0; out.floor = 0; out.rim = 0;
  let h = 0;
  for (let L = 0; L < NL; L++) {
    const lv = LEVELS[L];
    const s = lv.s;
    const rMax = 0.24 * s;
    if (bandW(2 * rMax, mw) <= 0) break;
    const amp = rMax >= 15000 ? ampBig : rMax >= 4000 ? ampSmall + (ampBig - ampSmall) * ((rMax - 4000) / 11000) : ampSmall;
    if (amp <= 0.001) continue;
    const inv = 1 / s;
    const gx = X * inv - 0.5, gy = Y * inv - 0.5, gz = Z * inv - 0.5;
    const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const hh = hash3(cx, cy, cz, 0x6a09 + L * 977);
      const acc = (hh >>> 22) / 1024;
      if (acc > lv.p * 1.5) continue;
      const px = (cx + ((hh & 127) + 0.5) / 128) * s, py = (cy + (((hh >>> 7) & 127) + 0.5) / 128) * s, pz = (cz + (((hh >>> 14) & 127) + 0.5) / 128) * s;
      const pl = Math.sqrt(px * px + py * py + pz * pz);
      if (Math.abs(pl - R) > 0.25 * s) continue;
      // older, more cratered south; fewer in the north lowlands
      const sl = py / pl;
      const latF = sl < -0.45 ? 1.5 : sl < -0.15 ? 1.0 + 0.5 * (-0.15 - sl) / 0.3 : sl > 0.55 ? 0.7 : 1.0;
      if (acc > lv.p * latF) continue;
      const kk = R / pl;
      const qx = px * kk - X, qy = py * kk - Y, qz = pz * kk - Z;
      const d2 = qx * qx + qy * qy + qz * qz;
      const h5 = rehash(hh, 4);
      const rr = (0.1 + 0.14 * Math.pow((h5 & 65535) / 65536, 1.7)) * s;
      // the scalloped rho below can shrink by 5.5 %: the cut-off must lie beyond rho = 1.8 / 0.945
      // (a cut at 1.8 rr left a cm-scale step ring in the ejecta of every shrunken crater)
      const lim = 1.91 * rr;
      if (d2 >= lim * lim) continue;
      const fw = bandW(2 * rr, mw);
      if (fw <= 0) continue;
      let rho = Math.sqrt(d2) / rr;
      // scalloped, slightly polygonal rims
      if (rr > 300) rho *= 1 + 0.055 * NR.n3(X / (0.45 * rr), Y / (0.45 * rr), Z / (0.45 * rr) + L * 3.7);
      let age = Math.pow((h5 >>> 16) / 65536, 0.6) + ageBias + lv.age;
      age = age > 1 ? 1 : age;
      PR.wall = 0; PR.floor = 0; PR.rim = 0;
      const soft = Math.max(0.04, Math.min(0.5, (mw * 2) / rr));
      const dh = craterProfile(rho, rr, age, soft, PR);
      h += dh * amp * fw;
      const fr = (1 - age) * (1 - age) * fw * Math.min(1, amp);
      if (rho < 1.6) out.fresh = Math.max(out.fresh, fr * (rho < 1 ? 1 : 1 - (rho - 1) / 0.6));
      const wa = fw * Math.min(1, amp * 1.5);
      out.wall = Math.max(out.wall, PR.wall * wa);
      out.floor = Math.max(out.floor, PR.floor * wa * (rr > 1500 ? 1 : 0.5));
      out.rim = Math.max(out.rim, PR.rim * wa);
    }
  }
  return h;
}

/** landmark craters (layout.FIXED_CRATERS); out.park = city crater park weight */
export function fixedCraters(x, y, z, mw, out) {
  let h = 0;
  out.park = 0;
  for (let i = 0; i < FIXED_CRATER_DATA.length; i++) {
    const c = FIXED_CRATER_DATA[i];
    const dot = x * c.x + y * c.y + z * c.z;
    const lim = (1.9 * c.r) / R;
    if (dot < 1 - 0.5 * lim * lim) continue;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    let rho = Math.sqrt(dx * dx + dy * dy + dz * dz) * R / c.r;
    if (rho >= 1.89) continue;                       // scalloped rho below shrinks by up to 4.5 %
    const fw = bandW(2 * c.r, mw);
    if (fw <= 0) continue;
    rho *= 1 + 0.045 * NR.n3(x * R / (0.45 * c.r), y * R / (0.45 * c.r), z * R / (0.45 * c.r) + i);
    PR.wall = 0; PR.floor = 0; PR.rim = 0;
    const soft = Math.max(0.03, Math.min(0.5, (mw * 2) / c.r));
    // city crater parks: shallow, terraced green bowls (A03) rather than raw pits
    const age = c.kind === 1 ? Math.max(c.age, 0.6) : c.age;
    h += craterProfile(rho, c.r, age, soft, PR) * fw * (c.kind === 1 ? 0.55 : 1);
    out.wall = Math.max(out.wall, PR.wall * fw);
    out.floor = Math.max(out.floor, PR.floor * fw);
    out.rim = Math.max(out.rim, PR.rim * fw);
    if (c.age < 0.3 && rho < 1.8) out.fresh = Math.max(out.fresh, (1 - c.age) * (rho < 1 ? 1 : 1 - (rho - 1) / 0.8) * fw);
    if (c.kind === 1 && rho < 1.08) out.park = Math.max(out.park, smoothstep(1.08, 0.86, rho) * fw);
  }
  return h;
}
