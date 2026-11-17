// Global grids derived from the control maps (pure + deterministic, built lazily, worker-safe).
// OWNER: terrain-fn agent.
//
//  * coast distance: signed distance to the sea shore in km (> 0 land), 2048x1024, from water.png
//    plus the authored sea additions (layout.SEA_PAINT). Near the shore it comes from a Gaussian-
//    smoothed water field (sub-pixel, no staircase); far away from an exact separable Euclidean
//    distance transform with per-row longitude scale. Sampled with a C2 cubic B-spline (value and
//    gradient).
//  * B-spline samplers for density / emission (one shared weight set) and the 4096x2048 zone mask
//    with polar blending so nothing pinches at the poles.
//  * exact per-pixel province / zone lookups (administrative values).

import { getControlMaps } from '../../data/controlMaps.js';
import { SEA_PAINT, KM_PER_DEG } from './layout.js';

const DEG = Math.PI / 180;
export const GW = 2048, GH = 1024;

let builtFor = null;
export let COAST = null;      // Float32Array GW*GH signed km (> 0 land)
export let SEA_RASTER = null; // Uint8Array GW*GH augmented sea mask (1 = sea)
const POLE = { densN: 0, densS: 0, emisN: 0, emisS: 0, zoneN: 0, zoneS: 0 };

export function ensureMaps() {
  const maps = getControlMaps();
  if (builtFor === maps) return;
  builtFor = maps;
  if (!installCoast(maps)) buildCoast(maps);
  buildPoles(maps);
}

// ---------------------------------------------------------------------------------------------
// precomputed coast grid (scripts/prep-data.mjs -> public/data/coast.bin, loaded with the control maps):
// 64-byte header ('MCST', u32 version, u32 key length, key ascii) + Float32 LE GW*GH. The key hashes the
// inputs (water map bytes, SEA_PAINT, algorithm version), so a stale file is ignored (computed instead).
// ---------------------------------------------------------------------------------------------
const COAST_VERSION = 1;
export const COAST_HEADER = 64;
/** identifies the inputs of the coast grid */
export function coastKey(maps) {
  let h = 0x811c9dc5 | 0;
  const d = maps.water.data;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
  const str = JSON.stringify(SEA_PAINT) + `|${GW}x${GH}|v${COAST_VERSION}`;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `mcst${COAST_VERSION}-${maps.water.width}x${maps.water.height}-${(h >>> 0).toString(16)}`;
}
function installCoast(maps) {
  const m = maps.coast;
  if (!m || !m.data || m.data.byteLength !== COAST_HEADER + GW * GH * 4) return false;
  const u8 = m.data instanceof Uint8Array ? m.data : new Uint8Array(m.data.buffer, m.data.byteOffset, m.data.byteLength);
  if (u8[0] !== 77 || u8[1] !== 67 || u8[2] !== 83 || u8[3] !== 84) return false;      // 'MCST'
  const dv = new DataView(u8.buffer, u8.byteOffset, COAST_HEADER);
  const n = dv.getUint32(8, true);
  if (dv.getUint32(4, true) !== COAST_VERSION || n > COAST_HEADER - 12) return false;
  let key = '';
  for (let i = 0; i < n; i++) key += String.fromCharCode(u8[12 + i]);
  if (key !== coastKey(maps)) { if (typeof console !== 'undefined') console.warn('[terrain] stale coast.bin (key mismatch): computing the coast grid'); return false; }
  const off = u8.byteOffset + COAST_HEADER;
  COAST = off % 4 === 0 ? new Float32Array(u8.buffer, off, GW * GH) : new Float32Array(u8.slice(COAST_HEADER).buffer);
  SEA_RASTER = null;                 // (only built by the compute path; not needed by the samplers)
  return true;
}
/** compute the coast grid and serialise it with its header (scripts/prep-data.mjs) */
export function serializeCoast(maps) {
  buildCoast(maps);
  const out = new Uint8Array(COAST_HEADER + GW * GH * 4);
  const key = coastKey(maps);
  out[0] = 77; out[1] = 67; out[2] = 83; out[3] = 84;
  const dv = new DataView(out.buffer);
  dv.setUint32(4, COAST_VERSION, true); dv.setUint32(8, key.length, true);
  for (let i = 0; i < key.length; i++) out[12 + i] = key.charCodeAt(i);
  const f = new Float32Array(out.buffer, COAST_HEADER, GW * GH);
  f.set(COAST);
  return { bytes: out, key };
}
export function mapsBuilt() { return builtFor !== null; }

// ---------------------------------------------------------------------------------------------
function insidePoly(P, lon, lat) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function paintSea(maps) {
  const water = maps.water.data;
  const out = new Uint8Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) out[i] = water[i] > 127 ? 1 : 0;
  for (const s of SEA_PAINT) {
    const P = s.poly || s.chain;
    let la0 = 90, la1 = -90, lo0 = 360, lo1 = -360;
    for (const q of P) {
      const hw = s.chain ? q[2] : 0;
      const dl = hw / KM_PER_DEG + 0.3;
      la0 = Math.min(la0, q[1] - dl); la1 = Math.max(la1, q[1] + dl);
      const dlo = dl / Math.max(0.1, Math.cos(q[1] * DEG));
      lo0 = Math.min(lo0, q[0] - dlo); lo1 = Math.max(lo1, q[0] + dlo);
    }
    const y0 = Math.max(0, Math.floor((90 - la1) / 180 * GH)), y1 = Math.min(GH - 1, Math.ceil((90 - la0) / 180 * GH));
    const x0 = Math.floor((lo0 + 180) / 360 * GW), x1 = Math.ceil((lo1 + 180) / 360 * GW);
    for (let y = y0; y <= y1; y++) {
      const lat = 90 - (y + 0.5) * 180 / GH;
      const cl = Math.cos(lat * DEG);
      for (let xx = x0; xx <= x1; xx++) {
        const x = ((xx % GW) + GW) % GW;
        const lon = -180 + (xx + 0.5) * 360 / GW;
        let inside = false;
        if (s.poly) inside = insidePoly(P, lon, lat);
        else {
          for (let k = 0; k < P.length - 1 && !inside; k++) {
            const ax = P[k][0], ay = P[k][1], bx = P[k + 1][0], by = P[k + 1][1];
            const ex = (bx - ax) * cl, ey = by - ay;
            const px = (lon - ax) * cl, py = lat - ay;
            const l2 = ex * ex + ey * ey;
            let t = l2 > 0 ? (px * ex + py * ey) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = px - ex * t, dy = py - ey * t;
            const d = Math.sqrt(dx * dx + dy * dy) * KM_PER_DEG;
            if (d < P[k][2] + (P[k + 1][2] - P[k][2]) * t) inside = true;
          }
        }
        if (inside) out[y * GW + x] = 1;
      }
    }
  }
  return out;
}

const INF = 1e20;
function edt1d(f, d, n, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k]) { k--; if (k < 0) { k = 0; break; } } else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}
/** squared distance (km^2) from every pixel to the nearest pixel with mask == target */
function edt2(mask, target) {
  const out = new Float32Array(GW * GH);
  const dyKm = (180 / GH) * KM_PER_DEG;
  const n3 = GW * 3;
  const N = Math.max(n3, GH);
  const f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  for (let y = 0; y < GH; y++) {
    const lat = 90 - (y + 0.5) * 180 / GH;
    const dx = Math.max(1e-3, (360 / GW) * Math.cos(lat * DEG) * KM_PER_DEG);
    let any = false;
    for (let x = 0; x < GW; x++) if (mask[y * GW + x] === target) { any = true; break; }
    if (!any) { for (let x = 0; x < GW; x++) out[y * GW + x] = INF; continue; }
    for (let i = 0; i < n3; i++) f[i] = mask[y * GW + (i % GW)] === target ? 0 : INF;
    edt1d(f, d, n3, v, z);
    const s2 = dx * dx;
    for (let x = 0; x < GW; x++) out[y * GW + x] = Math.min(INF, d[GW + x] * s2);
  }
  const s2 = dyKm * dyKm;
  for (let x = 0; x < GW; x++) {
    for (let y = 0; y < GH; y++) f[y] = out[y * GW + x] / s2;
    edt1d(f, d, GH, v, z);
    for (let y = 0; y < GH; y++) out[y * GW + x] = d[y] * s2;
  }
  return out;
}
function gaussBlur(src, sigmaPx) {
  const r = Math.ceil(sigmaPx * 3);
  const k = new Float64Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigmaPx * sigmaPx)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(GW * GH), out = new Float32Array(GW * GH);
  const row = new Float64Array(GW + 2 * r);
  for (let y = 0; y < GH; y++) {
    const o = y * GW;
    for (let x = 0; x < GW + 2 * r; x++) row[x] = src[o + (((x - r) % GW) + GW) % GW];
    for (let x = 0; x < GW; x++) { let a = 0; for (let i = 0; i <= 2 * r; i++) a += k[i] * row[x + i]; tmp[o + x] = a; }
  }
  const col = new Float64Array(GH + 2 * r);
  for (let x = 0; x < GW; x++) {
    for (let y = 0; y < GH + 2 * r; y++) { const yy = y - r < 0 ? 0 : y - r >= GH ? GH - 1 : y - r; col[y] = tmp[yy * GW + x]; }
    for (let y = 0; y < GH; y++) { let a = 0; for (let i = 0; i <= 2 * r; i++) a += k[i] * col[y + i]; out[y * GW + x] = a; }
  }
  return out;
}

function buildCoast(maps) {
  const sea = paintSea(maps);
  SEA_RASTER = sea;
  const dyKm = (180 / GH) * KM_PER_DEG;
  const dWater = edt2(sea, 1), dLand = edt2(sea, 0);
  const sea01 = new Float32Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) sea01[i] = sea[i];
  const g = gaussBlur(sea01, 1.6);
  const coast = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    const lat = 90 - (y + 0.5) * 180 / GH;
    const dxKm = Math.max(1e-3, (360 / GW) * Math.cos(lat * DEG) * KM_PER_DEG);
    const ym = y > 0 ? y - 1 : 0, yp = y < GH - 1 ? y + 1 : GH - 1;
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const land = sea[i] === 0;
      const dEdt = land ? Math.sqrt(dWater[i]) - 0.5 * dyKm : -(Math.sqrt(dLand[i]) - 0.5 * dyKm);
      let d = dEdt;
      const ad = Math.abs(dEdt);
      if (ad < 4.5 * dyKm) {
        const xm = (x + GW - 1) % GW, xp = (x + 1) % GW;
        const gx = (g[y * GW + xp] - g[y * GW + xm]) / (2 * dxKm);
        const gy = (g[ym * GW + x] - g[yp * GW + x]) / ((yp - ym) * dyKm);
        const gl = Math.hypot(gx, gy);
        if (gl > 1e-4) {
          const dn = (0.5 - g[i]) / gl;
          const t = Math.min(1, Math.max(0, (ad / dyKm - 1.8) / 2.2));
          const w = t * t * (3 - 2 * t);
          d = dn * (1 - w) + dEdt * w;
        }
      }
      coast[i] = Math.max(-4000, Math.min(4000, d));
    }
  }
  COAST = gaussBlur(coast, 0.8);
}

function buildPoles(maps) {
  const avg = (m, top) => {
    let s = 0, n = 0; const W = m.width, H = m.height, rows = Math.max(1, Math.round(6 * H / 1024));
    for (let r = 0; r < rows; r++) { const y = top ? r : H - 1 - r; for (let x = 0; x < W; x++) { s += m.data[y * W + x]; n++; } }
    return s / n / 255;
  };
  POLE.densN = avg(maps.density, true); POLE.densS = avg(maps.density, false);
  POLE.emisN = avg(maps.emission, true); POLE.emisS = avg(maps.emission, false);
  POLE.zoneN = avg(maps.zone, true); POLE.zoneS = avg(maps.zone, false);
}

// ---------------------------------------------------------------------------------------------
// cubic B-spline sampling (C2), shared weights
// ---------------------------------------------------------------------------------------------
const WX = new Float64Array(4), WY = new Float64Array(4), DX = new Float64Array(4), DY = new Float64Array(4);
const IX = new Int32Array(4), IY = new Int32Array(4);
function weights(t, w) {
  const it = 1 - t, t2 = t * t, t3 = t2 * t;
  w[0] = (it * it * it) / 6; w[1] = (3 * t3 - 6 * t2 + 4) / 6; w[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; w[3] = t3 / 6;
}
function dweights(t, w) {
  const it = 1 - t;
  w[0] = -0.5 * it * it; w[1] = 0.5 * (3 * t * t - 4 * t); w[2] = 0.5 * (-3 * t * t + 2 * t + 1); w[3] = 0.5 * t * t;
}
function setup(lat, lon, W, H, deriv) {
  const fx = ((lon + 180) / 360) * W - 0.5;
  const fy = ((90 - lat) / 180) * H - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  weights(fx - x0, WX); weights(fy - y0, WY);
  if (deriv) { dweights(fx - x0, DX); dweights(fy - y0, DY); }
  for (let i = 0; i < 4; i++) {
    let x = x0 - 1 + i; x %= W; if (x < 0) x += W; IX[i] = x;
    const y = y0 - 1 + i; IY[i] = (y < 0 ? 0 : y >= H ? H - 1 : y) * W;
  }
}
function conv(data) {
  let s = 0;
  for (let j = 0; j < 4; j++) {
    const r = IY[j];
    s += WY[j] * (WX[0] * data[r + IX[0]] + WX[1] * data[r + IX[1]] + WX[2] * data[r + IX[2]] + WX[3] * data[r + IX[3]]);
  }
  return s;
}

/** coast distance (km, > 0 land), C2 */
export function coastKmAt(lat, lon) { if (!COAST) ensureMaps(); setup(lat, lon, GW, GH, false); return conv(COAST); }

/**
 * coast distance (km) and its gradient (dimensionless: km per km, i.e. m per m) toward east and
 * north into out.c, out.ge, out.gn
 */
export function coastKmGrad(lat, lon, out) {
  if (!COAST) ensureMaps();
  setup(lat, lon, GW, GH, true);
  let s = 0, sx = 0, sy = 0;
  for (let j = 0; j < 4; j++) {
    const r = IY[j];
    const a0 = COAST[r + IX[0]], a1 = COAST[r + IX[1]], a2 = COAST[r + IX[2]], a3 = COAST[r + IX[3]];
    const rw = WX[0] * a0 + WX[1] * a1 + WX[2] * a2 + WX[3] * a3;
    const rd = DX[0] * a0 + DX[1] * a1 + DX[2] * a2 + DX[3] * a3;
    s += WY[j] * rw; sx += WY[j] * rd; sy += DY[j] * rw;
  }
  out.c = s;
  // per pixel -> per km: x pixel = 360/GW deg of lon, y pixel = 180/GH deg of lat (y grows south)
  const kx = 1 / ((360 / GW) * KM_PER_DEG * Math.max(0.02, Math.cos(lat * DEG)));
  const ky = 1 / ((180 / GH) * KM_PER_DEG);
  out.ge = sx * kx; out.gn = -sy * ky;
  return out;
}

/** density & emission (0..1) smooth -> out.density / out.emission */
export function densEmisAt(lat, lon, out) {
  const m = builtFor;
  setup(lat, lon, GW, GH, false);
  let d = conv(m.density.data) / 255, e = conv(m.emission.data) / 255;
  const al = Math.abs(lat);
  if (al > 86) {
    const w = Math.min(1, (al - 86) / 3.5), ww = w * w * (3 - 2 * w);
    d += ((lat > 0 ? POLE.densN : POLE.densS) - d) * ww;
    e += ((lat > 0 ? POLE.emisN : POLE.emisS) - e) * ww;
  }
  out.density = d < 0 ? 0 : d > 1 ? 1 : d;
  out.emission = e < 0 ? 0 : e > 1 ? 1 : e;
}
/** smooth density only */
export function densityAt(lat, lon) {
  const m = builtFor;
  setup(lat, lon, GW, GH, false);
  let d = conv(m.density.data) / 255;
  const al = Math.abs(lat);
  if (al > 86) { const w = Math.min(1, (al - 86) / 3.5), ww = w * w * (3 - 2 * w); d += ((lat > 0 ? POLE.densN : POLE.densS) - d) * ww; }
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/** zone mask smooth (0 = Z, 1 = O) */
export function zoneSmoothAt(lat, lon) {
  const m = builtFor.zone;
  setup(lat, lon, m.width, m.height, false);
  let z = conv(m.data) / 255;
  const al = Math.abs(lat);
  if (al > 86) { const w = Math.min(1, (al - 86) / 3.5), ww = w * w * (3 - 2 * w); z += ((lat > 0 ? POLE.zoneN : POLE.zoneS) - z) * ww; }
  return z;
}

/** exact per-pixel lookups (administrative) */
export function provinceExact(lat, lon) {
  const m = builtFor.province, W = m.width, H = m.height;
  let x = Math.floor(((lon + 180) / 360) * W); x %= W; if (x < 0) x += W;
  let y = Math.floor(((90 - lat) / 180) * H); if (y < 0) y = 0; else if (y >= H) y = H - 1;
  return m.data[y * W + x];
}
export function zoneExactO(lat, lon) {
  const m = builtFor.zone, W = m.width, H = m.height;
  let x = Math.floor(((lon + 180) / 360) * W); x %= W; if (x < 0) x += W;
  let y = Math.floor(((90 - lat) / 180) * H); if (y < 0) y = 0; else if (y >= H) y = H - 1;
  return m.data[y * W + x] > 127;
}
