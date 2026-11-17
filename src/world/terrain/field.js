// Base planetary fields at a point (lowest world layer after the control maps). OWNER: terrain-fn.
// Pure, worker-safe, float64; never reads terrain height (no cycles).
//
// computeFields(x, y, z, mw, F) fills a reusable struct (newFields()):
//   lat, lon, province (exact), isO (exact zone), zoneO (warped smooth), density, emission,
//   coastKm (macro signed distance to the sea, km) + gradient (cge, cgn), c (signed coast metric in
//   metres with fractal detail band-limited by mw, > 0 land), region weights (w*), nearby line
//   features (hits), masks: mount (mountain belts), rangeH, rift, canyon, pass, rough (natural
//   ruggedness), ridge (public bare-rock mask), ice / iceQ / frost, urban, farmBase.

import { R } from '../../core/constants.js';
import { ensureMaps, coastKmGrad, densEmisAt, zoneSmoothAt, provinceExact, zoneExactO } from './maps.js';
import { queryLines, HIT, LINE_DATA, lineParam, REGION_DATA, regionDist, MAXHITS } from './layout.js';
import { makeNoise, makeRotations, smoothstep, clamp, bandW, smin, smax, hash3, rehash, u01 } from './noise.js';
import { g01Coast, g02Farm } from './sitezones.js';
import { canyonOffset } from './lineshape.js';
import { basinMask } from './basin.js';

const RAD = 180 / Math.PI;
const NW = makeNoise(301);   // field warps
const NC = makeNoise(302);   // coast fractal
const NM = makeNoise(303);   // mountain belts / terrain types
const NI = makeNoise(304);   // ice margin
const NU = makeNoise(305);   // urban belt modulation
const NA = makeNoise(306);   // archipelago islands
const ROT = makeRotations(26, 307);

const RG = REGION_DATA;
const G = new Float64Array(3);
const CG = { c: 0, ge: 0, gn: 0 };

export function newFields() {
  return {
    x: 0, y: 0, z: 0, X: 0, Y: 0, Z: 0, lat: 0, lon: 0, mw: 0,
    province: 0, isO: false, zoneO: 0, density: 0, emission: 0,
    coastKm: 0, cge: 0, cgn: 0, c: 0, coastRough: 1, tidal: 0, arch: 0,
    wZR3: 0, dZR3: 9, wH1: 0, wOX5: 0, wOX4: 0, wOX6: 0, wZR6: 0, wOX1: 0, wOX3: 0, wOX2: 0, wArch: 0,
    wLava: 0, wVolc: 0, volcR: 9, wZR2: 0, wZR5: 0, wSouth: 0, wNorth: 0,
    nh: 0, hLine: new Int32Array(MAXHITS), hD: new Float64Array(MAXHITS), hT: new Float64Array(MAXHITS), hV: new Float64Array(MAXHITS),
    mount: 0, mountProc: 0, oBasin: 0, rangeH: 0, rangeM: 0, rift: 0, canyon: 0, pass: 0, oldbed: 0, rough: 0, plain: 0,
    ridge: 0, ice: 0, iceQ: -1e9, frost: 0, urban: 0, farmBase: 0, uDens: 0,
    basinW: 0, basinIn: 0, basinTab: 0, farmOK: 0, g02Terrace: 0,
  };
}

function wOf(d, r0, r1) {
  if (d >= r1) return 0;
  if (d <= r0) return 1;
  const t = (r1 - d) / (r1 - r0);
  return t * t * (3 - 2 * t);
}

// OX4 (45E, 73.5N) bulge of the north ice margin: gaussian of the chord distance (seam / pole safe)
const OX4C = (() => { const la = 73.5 / RAD, lo = 45 / RAD; return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)]; })();
export function ox4Weight(x, y, z) {
  const dx = x - OX4C[0], dy = y - OX4C[1], dz = z - OX4C[2];
  return Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * 0.12 * 0.12));
}

/**
 * Cheap pre-check fields without fractal noise (for lazily evaluated network nodes / lake
 * candidates): smooth zone, macro coast distance (km), density, region distances.
 */
export const LITE = { lat: 0, lon: 0, zoneO: 0, coastKm: 0, density: 0, dOX1: 9, dOX4: 9, dOX6: 9, dZR3: 9, dZR6: 9, dOX5: 9, dArch: 9 };
const LDE = { density: 0, emission: 0 };
export function liteFields(x, y, z) {
  ensureMaps();
  const lat = Math.asin(y < -1 ? -1 : y > 1 ? 1 : y) * RAD, lon = Math.atan2(x, z) * RAD;
  LITE.lat = lat; LITE.lon = lon;
  LITE.zoneO = zoneSmoothAt(lat, lon);
  LITE.coastKm = coastKmGrad(lat, lon, CG).c;
  densEmisAt(lat, lon, LDE); LITE.density = LDE.density;
  LITE.dOX1 = regionDist(RG.ox1Low, x, y, z); LITE.dOX4 = regionDist(RG.ox4Low, x, y, z); LITE.dOX6 = regionDist(RG.ox6Frost, x, y, z);
  LITE.dZR3 = regionDist(RG.zr3Plateau, x, y, z); LITE.dZR6 = regionDist(RG.zr6Valleys, x, y, z); LITE.dOX5 = regionDist(RG.ox5Table, x, y, z);
  LITE.dArch = regionDist(RG.zr4Arch, x, y, z);
  return LITE;
}

// ---------------------------------------------------------------------------------------------
// ZR4 archipelago: islands carry the city star (density arms) and a scatter of natural islets;
// wide deep-water lanes stay open. Returns a coast-like metric in metres (> 0 island).
// The navigable straits that cut the arms into islands are added AFTER the fractal coast detail
// (archStraits) so that no fractal octave can ever close them.
// ---------------------------------------------------------------------------------------------
const AQ = new Float64Array(3);
function archWarp(X, Y, Z) {
  // proper domain warp (three independent samples; a gradient-field warp draws concentric swirls)
  const iw = 1 / 170000;
  AQ[0] = X + 16000 * NA.n3(X * iw + 3.1, Y * iw, Z * iw);
  AQ[1] = Y + 16000 * NA.n3(X * iw - 7.7, Y * iw + 5.3, Z * iw);
  AQ[2] = Z + 16000 * NA.n3(X * iw + 1.9, Y * iw - 2.6, Z * iw + 8.8);
  return AQ;
}
function archipelago(F) {
  const dens = F.density;
  archWarp(F.X, F.Y, F.Z);
  const qx = AQ[0], qy = AQ[1], qz = AQ[2];
  // island potential: density arms (cities) + natural islet noise
  const n1 = NA.n3(qx / 90000, qy / 90000 + 7.7, qz / 90000);
  const n2 = NA.n3(qx / 36000 - 2.2, qy / 36000, qz / 36000);
  const n3 = NA.n3(qx / 14000, qy / 14000, qz / 14000 + 4.4);
  const city = smoothstep(0.17, 0.42, dens);
  let pot = 1.15 * city + 0.62 * n1 + 0.32 * n2 + 0.16 * n3 - 0.48;
  // deep-water lanes (航道): two broad open lanes across the island sea
  const lane = 1 - Math.abs(NA.n3(qx / 420000 - 5.5, qy / 420000, qz / 420000 + 1.3));
  pot -= 0.9 * smoothstep(0.93, 0.985, lane);
  // metres: ~ distance scale of the potential gradient
  return pot * 52000;
}

/**
 * Navigable straits of the archipelago (signed metric, m, < 0 in the water): the nodal lines of two
 * independent noises. Each family draws a maze of closed curves ~35-45 km apart and the two families
 * cross everywhere, so every island chain is cut into islands (dock + school + clinic each) and all
 * inter-island waters join ONE network that opens into the east sea (sea = connected). Distance-like
 * metric |n| / |grad_t n|; widths 0.5..3 km (narrow straits for bridges, wide ones for ferries) with
 * band-limited bank irregularity that never closes a strait.
 */
function strait1(qx, qy, qz, x, y, z, il, ox, oy, oz) {
  const v = NA.d3(qx * il + ox, qy * il + oy, qz * il + oz, G);
  const gr = G[0] * x + G[1] * y + G[2] * z;
  let gt = Math.sqrt(Math.max(0, G[0] * G[0] + G[1] * G[1] + G[2] * G[2] - gr * gr));
  if (gt < 0.3) gt = 0.3;
  const e = 0.004;                                   // soft abs: rounded (not V) channel floor
  return (Math.sqrt(v * v + e * e) - e) / (gt * il);
}
function archStraits(F, mw) {
  const x = F.x, y = F.y, z = F.z;
  archWarp(F.X, F.Y, F.Z);
  const qx = AQ[0], qy = AQ[1], qz = AQ[2];
  const dA = strait1(qx, qy, qz, x, y, z, 1 / 66000, 9.3, 0, 0);
  const dB = strait1(qx, qy, qz, x, y, z, 1 / 92000, -4.1, 2.7, 0);
  // half widths: family A mostly narrow (bridged straits), family B wider (ferry channels)
  const wn = 0.5 + 0.5 * NA.n3(qx / 30000, qy / 30000 + 3.3, qz / 30000);
  const hwA = 260 + 700 * wn, hwB = 520 + 980 * (1 - wn);
  let s = Math.min(dA - hwA, dB - hwB);
  if (s < 2500) {
    // natural bank irregularity (coves, small spits), scaled to the strait so it never closes
    const hw = dA - hwA < dB - hwB ? hwA : hwB;
    const b1 = bandW(1800, mw), b2 = bandW(520, mw);
    if (b1 > 0) s += 0.2 * hw * b1 * NA.n3(qx / 1800 + 1.1, qy / 1800, qz / 1800);
    if (b2 > 0) s += 0.09 * hw * b2 * NA.n3(qx / 520, qy / 520 - 2.4, qz / 520);
  }
  return s;
}

/** ZR4 straits applied to a coast metric c (continuous in the archipelago weight F.arch) */
function archPost(F, c, mw) {
  const k = smoothstep(0.5, 0.92, F.arch);
  if (k <= 0) return c;
  const s = archStraits(F, mw);
  return s < c + 600 ? c + (smin(c, s, 450) - c) * k : c;
}

/** signed coast metric (m, > 0 land) with fractal detail, band-limited by mw */
function coastMetric(F, mw) {
  const X = F.X, Y = F.Y, Z = F.Z;
  let c0 = F.coastKm * 1000;
  // archipelago replaces the mapped land inside the ZR4 island sea (keeps the mapped sea as sea)
  F.arch = 0;
  if (F.wArch > 0) {
    const a = archipelago(F);
    const w = F.wArch;
    // islands replace the mapped land and the shallow near-shore band of the mapped sea; the deep
    // open sea far offshore stays sea
    const k = smoothstep(-50000, -190000, c0);
    const target = a + (Math.min(c0, a) - a) * k;
    c0 = c0 + (target - c0) * w;
    F.arch = w;
  }
  // OX1 drowned estuaries (sea arms) from the inlet lines
  for (let i = 0; i < F.nh; i++) {
    const ld = LINE_DATA[F.hLine[i]];
    if (ld.kind !== 'inlet') continue;
    const hw = lineParam(ld, 'hw', F.hV[i]) * 1000;
    const e = Math.abs(F.hD[i] + 0.3 * hw * NC.n3(X / 9000, Y / 9000, Z / 9000 + 2.2)) - hw;
    c0 = smin(c0, e, 900);
  }
  const rough = F.coastRough;
  // reach of the fractal detail: the largest octave amplitude bounds everything
  const lim0 = 2.6 * 46000 * rough;
  if (c0 > lim0 || c0 < -lim0) return F.arch > 0.5 && c0 > 0 ? archPost(F, c0, mw) : c0;
  // domain warp: natural bays, spits and hooked headlands
  const iw = 1 / 240000, iw2 = 1 / 38000;
  NC.d3(X * iw + 11.3, Y * iw, Z * iw, G);
  let qx = X + 36000 * G[0], qy = Y + 36000 * G[1], qz = Z + 36000 * G[2];
  NC.d3(X * iw2 - 3.3, Y * iw2, Z * iw2, G);
  qx += 5200 * G[0]; qy += 5200 * G[1]; qz += 5200 * G[2];
  let c = c0;
  let lam = 300000;
  for (let k = 0; k < 24; k++) {
    const bw = bandW(lam, mw);
    if (bw <= 0) break;
    // fractal amplitude ~ lambda^0.85 with extra irregularity at bay scale
    let a = 0.055 * lam * Math.pow(lam / 300000, -0.12) * (1 + 0.6 * smoothstep(120000, 15000, lam) * (1 - smoothstep(2000, 300, lam)));
    a *= rough;
    const dist = c < 0 ? -c : c;
    if (dist > 4.2 * a) break; // later octaves are smaller still
    const fade = dist > 2.1 * a ? 1 - (dist - 2.1 * a) / (2.1 * a) : 1;
    const m = ROT[k], il = 1 / lam;
    const px = (m[0] * qx + m[1] * qy + m[2] * qz) * il, py = (m[3] * qx + m[4] * qy + m[5] * qz) * il, pz = (m[6] * qx + m[7] * qy + m[8] * qz) * il;
    c += a * bw * fade * NC.n3(px, py, pz);
    lam *= 0.5;
    if (lam < 0.6) break;
  }
  // ZR4 straits (after the fractal detail: guaranteed open, connected channel network)
  if (F.arch > 0.5 && c > -40000) c = archPost(F, c, mw);
  // OX3 赤岸: barrier spits parallel to the low tidal shore, cut by tidal inlets
  if (F.wOX3 > 0.05 && c < 0 && c > -12000) {
    const u = -c;
    const band = Math.exp(-((u - 4200) * (u - 4200)) / (2 * 700 * 700));
    const gaps = NC.n3(X / 26000 + 3.1, Y / 26000, Z / 26000) * 0.7 + NC.n3(X / 6500, Y / 6500 - 1.7, Z / 6500) * 0.3;
    c += F.wOX3 * band * 5000 * smoothstep(-0.2, 0.2, gaps);
  }
  return c;
}

/**
 * North-cap ice margin metric q (km, > 0 on the ice, ~ signed distance to the margin) at unit vector
 * (x, y, z) and latitude lat (deg), band-limited by mw. Margin ~77.5N, lobate, pushed south to ~73.6N at
 * OX4 (45E) where the ice cliffs face the lowland. -1e9 south of 66N. (icefoot.js traces its iso-lines.)
 */
export function northIceQ(x, y, z, lat, mw) {
  if (!(lat > 66)) return -1e9;
  const X = x * R, Y = y * R, Z = z * R;
  const ox4 = ox4Weight(x, y, z);
  let q = (lat - 77.5 + 3.95 * ox4) * 59.16;
  q += NI.n3(X / 520000, Y / 520000, Z / 520000) * 90 * (1 - 0.7 * ox4) + NI.n3(X / 140000 + 2, Y / 140000, Z / 140000) * 30;
  if (q < 50 && q > -50) {
    let lam = 32000, a = 7.5;
    for (let k = 0; k < 12; k++) {
      const bw = bandW(lam, mw); if (bw <= 0) break;
      q += a * bw * NI.n3(X / lam + k * 3.1, Y / lam - k * 1.7, Z / lam);
      lam *= 0.5; a *= 0.5;
    }
  }
  return q;
}

/** polar ice margin metric (km, > 0 on the ice) + frost */
function iceFields(F, mw) {
  const lat = F.lat, X = F.X, Y = F.Y, Z = F.Z;
  F.ice = 0; F.iceQ = -1e9;
  const al = Math.abs(lat);
  F.frost = Math.max(smoothstep(60, 80, al) * 0.6, F.wOX6 * 0.85, F.wZR6 * 0.35 * smoothstep(55, 66, al));
  if (lat > 66) {
    const q = northIceQ(F.x, F.y, F.z, lat, mw);
    F.iceQ = q;
    F.ice = smoothstep(-0.03, 0.2, q);
  } else if (lat < -76) {
    let q = (-lat - 84.0) * 59.16;
    q += NI.n3(X / 380000 + 5, Y / 380000, Z / 380000) * 64 + NI.n3(X / 110000, Y / 110000 - 3, Z / 110000) * 20;
    if (q < 50 && q > -50) {
      let lam = 28000, a = 6.5;
      for (let k = 0; k < 12; k++) {
        const bw = bandW(lam, mw); if (bw <= 0) break;
        q += a * bw * NI.n3(X / lam - k * 2.3, Y / lam + k * 1.1, Z / lam);
        lam *= 0.5; a *= 0.5;
      }
    }
    F.iceQ = q;
    F.ice = smoothstep(-0.03, 0.2, q);
  }
}

export function computeFields(x, y, z, mw, F) {
  ensureMaps();
  F.x = x; F.y = y; F.z = z; F.mw = mw;
  const X = x * R, Y = y * R, Z = z * R;
  F.X = X; F.Y = Y; F.Z = Z;
  const lat = Math.asin(y < -1 ? -1 : y > 1 ? 1 : y) * RAD;
  const lon = Math.atan2(x, z) * RAD;
  F.lat = lat; F.lon = lon;
  F.province = provinceExact(lat, lon);
  F.isO = zoneExactO(lat, lon);

  // ---- warped smooth control fields (no pixel staircase at any scale)
  const i1 = 1 / 210000, i2 = 1 / 38000;
  NW.d3(X * i1, Y * i1, Z * i1, G);
  let we = G[0] * 7000, wn = G[1] * 7000;
  NW.d3(X * i2 + 5.2, Y * i2, Z * i2, G);
  we += G[2] * 1700; wn += G[0] * 1700;
  const cl = Math.max(0.06, Math.cos(lat / RAD));
  const latW = clamp(lat + (wn / R) * RAD, -90, 90), lonW = lon + (we / (R * cl)) * RAD;
  densEmisAt(latW, lonW, F);
  const zs = zoneSmoothAt(latW, lonW);
  if (zs < 0.12) F.zoneO = 0;
  else if (zs > 0.88) F.zoneO = 1;
  else {
    const zn = NW.n3(X / 9000 + 1.1, Y / 9000, Z / 9000) * 0.11 + NW.n3(X / 2400, Y / 2400 + 3.3, Z / 2400) * 0.045;
    F.zoneO = smoothstep(0.33, 0.67, zs + zn);
  }

  // ---- region weights (analytic blobs with noisy borders)
  const rw = NW.n3(X / 420000 + 9.9, Y / 420000, Z / 420000) * 0.12 + NW.n3(X / 120000, Y / 120000 - 4.4, Z / 120000) * 0.04;
  const dZR3 = regionDist(RG.zr3Plateau, x, y, z);
  F.dZR3 = dZR3 + rw;
  F.wZR3 = wOf(dZR3 + rw, 0.86, 1.1);
  F.wH1 = wOf(regionDist(RG.h1Highland, x, y, z) + rw, 0.62, 1.08);
  F.wOX5 = wOf(regionDist(RG.ox5Table, x, y, z) + rw, 0.72, 1.06);
  F.wOX4 = wOf(regionDist(RG.ox4Low, x, y, z) + rw, 0.68, 1.06);
  F.wOX6 = wOf(regionDist(RG.ox6Frost, x, y, z) + rw, 0.62, 1.06);
  F.wZR6 = wOf(regionDist(RG.zr6Valleys, x, y, z) + rw, 0.7, 1.08);
  F.wOX1 = wOf(regionDist(RG.ox1Low, x, y, z) + rw, 0.62, 1.06);
  F.wOX3 = wOf(regionDist(RG.ox3Low, x, y, z) + rw, 0.62, 1.08);
  F.wOX2 = wOf(regionDist(RG.ox2Plateau, x, y, z) + rw, 0.6, 1.05);
  F.wArch = wOf(regionDist(RG.zr4Arch, x, y, z) + rw * 1.4, 0.7, 1.0);
  F.wZR2 = wOf(regionDist(RG.zr2Plateau, x, y, z) + rw, 0.55, 1.05);
  F.wZR5 = wOf(regionDist(RG.zr5Basin, x, y, z) + rw * 0.5, 0.75, 1.1);
  const dL = Math.min(regionDist(RG.lavaW, x, y, z), regionDist(RG.lavaE, x, y, z));
  if (dL < 1.5) {
    const lm = (1.0 - dL) + 0.24 * NW.n3(X / 150000 + 4.4, Y / 150000, Z / 150000) + 0.11 * NW.n3(X / 38000, Y / 38000 - 2.2, Z / 38000) + 0.045 * NW.n3(X / 9000 + 1, Y / 9000, Z / 9000);
    F.wLava = smoothstep(0.06, 0.16, lm);
  } else F.wLava = 0;
  const vd = regionDist(RG.volcano, x, y, z);
  F.volcR = vd; F.wVolc = vd < 1.9 ? 1 : 0;
  F.wSouth = smoothstep(-30, -50, lat + rw * 40);
  F.wNorth = smoothstep(36, 54, lat + rw * 30) * (1 - smoothstep(70, 78, lat));

  // ---- line features near p
  const nh = queryLines(x, y, z, lat, lon);
  F.nh = nh;
  for (let i = 0; i < nh; i++) { F.hLine[i] = HIT.line[i]; F.hD[i] = HIT.d[i]; F.hT[i] = HIT.t[i]; F.hV[i] = HIT.v[i]; }

  // ---- macro coast (needed by the masks)
  coastKmGrad(lat, lon, CG);
  F.coastKm = CG.c; F.cge = CG.ge; F.cgn = CG.gn;

  // ---- natural terrain character: ruggedness (highland vs plain) and mountain belts
  const cityness = smoothstep(0.2, 0.42, F.density);   // stars only (ignores the faint diagonal stripes)
  F.uDens = cityness;
  const ib = 1 / 1800000;
  NM.d3(X * ib * 0.7, Y * ib * 0.7, Z * ib * 0.7, G);
  const bx = X * ib + G[0] * 0.09, by = Y * ib + G[1] * 0.09, bz = Z * ib + G[2] * 0.09;
  const tA = NM.n3(bx, by, bz), tB = NM.n3(bx * 2.3 + 3.1, by * 2.3, bz * 2.3 - 1.7), tC = NM.n3(bx * 5.1 - 2.2, by * 5.1, bz * 5.1 + 0.7);
  // ruggedness: southern highlands + patches; plains in the north lowlands and in basins
  let rough = 0.42 + 0.42 * tA + 0.2 * tB + 0.08 * tC + 0.34 * F.wSouth - 0.32 * F.wNorth;
  rough = smoothstep(0.12, 0.88, rough);
  // mountain provinces: broad belts along the zero set of a warped low-frequency noise plus massifs;
  // the massif shape and gullies (relief.js) make the internal ridge / valley structure
  const lb = NM.n3(bx * 0.8 - 4.4, by * 0.8, bz * 0.8 + 2.2);
  const lin = 1 - Math.abs(lb);
  const seg = smoothstep(-0.25, 0.25, NM.n3(bx * 0.6 + 8.1, by * 0.6, bz * 0.6) + 0.35 * tB);
  const belt = smoothstep(0.5, 0.82, lin) * seg;
  const massif = smoothstep(0.18, 0.55, tA * 0.62 + tB * 0.42 + tC * 0.12 + 0.12 * F.wSouth - 0.12 * F.wNorth);
  let mp = Math.max(belt * 0.95, massif);
  mp = Math.max(mp, F.wH1 * (0.82 + 0.18 * smoothstep(-0.3, 0.3, tB)));
  const notCity = 1 - cityness;
  // O-zone landscape: lowland basins (farmland, water) vs red tablelands and mesas (R1)
  const coastLow = smoothstep(320, 25, F.coastKm);
  let ob = 0.12 + 0.62 * NM.n3(X / 420000 + 1.3, Y / 420000, Z / 420000) + 0.3 * NM.n3(X / 150000, Y / 150000 - 6.1, Z / 150000)
    + 0.5 * coastLow - 0.35 * rough + 0.6 * Math.max(F.wOX1, F.wOX3, F.wOX4 * 0.8);
  F.oBasin = smoothstep(-0.2, 0.25, ob);
  const notFarm = 1 - 0.88 * F.zoneO;
  const suppress = notCity * notFarm * (1 - 0.92 * F.wArch) * (1 - 0.85 * Math.max(F.wOX1, F.wOX3, F.wOX4 * 0.7, F.wOX6 * 0.6)) * (1 - 0.65 * F.wZR3) * (1 - 0.7 * F.wOX5);
  mp *= suppress;
  F.mountProc = mp;
  F.rough = Math.max(rough * notCity * (1 - 0.45 * F.zoneO), mp);
  F.plain = (1 - rough) * notCity;

  // explicit lines: ranges (with passes), rift, canyons, old beds
  let riftM = 0, rangeM = 0, rangeH = 0, canyonM = 0, passM = 0, bedM = 0;
  for (let i = 0; i < nh; i++) {
    const ld = LINE_DATA[F.hLine[i]];
    const v = F.hV[i];
    let ad = Math.abs(F.hD[i]);
    const kind = ld.kind;
    if (kind === 'rift' || kind === 'range') {
      const hw = lineParam(ld, 'hw', v) * 1000;
      let m;
      if (kind === 'rift') {
        // ragged rock edge (fractal width): the city fabric abuts irregular rift shoulders (A03)
        const wv = 1 + 0.17 * NM.n3(X / 60000 + 1.3, Y / 60000, Z / 60000) + 0.08 * NM.n3(X / 17000, Y / 17000 - 2.2, Z / 17000) + 0.035 * NM.n3(X / 5200 - 3.1, Y / 5200, Z / 5200 + 0.9);
        m = smoothstep(hw * 1.35, hw * 0.9, ad / wv);
      } else {
        // irregular width + spurs so a range never reads as a uniform band
        const wv = 1 + 0.32 * NM.n3(X / 140000 + 2.7, Y / 140000, Z / 140000) + 0.14 * NM.n3(X / 45000, Y / 45000 + 1.1, Z / 45000);
        const sp = 1 - Math.abs(NM.n3(X / 60000 - 3.9, Y / 60000, Z / 60000));
        ad = ad / wv - 0.35 * hw * Math.pow(sp, 4);
        m = smoothstep(hw * 1.25, hw * 0.2, ad);
      }
      let p = 0;
      const ps = ld.passes;
      if (ps.length) {
        // irregular pass outline (the corridor narrows and wanders instead of a straight band)
        const pn = 0.32 * NM.n3(X / 26000 - 5.1, Y / 26000, Z / 26000 + 2.4) + 0.12 * NM.n3(X / 7000, Y / 7000 + 4.2, Z / 7000);
        for (let j = 0; j < ps.length; j++) {
          const dt = (F.hT[i] - ps[j][0] * ld.totalLen) / (ps[j][1] * 1000) + pn;
          const e = Math.exp(-dt * dt);
          if (e > p) p = e;
        }
      }
      passM = Math.max(passM, p * m);
      if (kind === 'rift') riftM = Math.max(riftM, m * (1 - 0.85 * smoothstep(0.3, 0.8, p)));
      else {
        const mm = m * (1 - 0.9 * smoothstep(0.2, 0.8, p));
        if (mm > rangeM) { rangeM = mm; rangeH = lineParam(ld, 'height', v); }
      }
    } else if (kind === 'canyon' || kind === 'valley') {
      const hw = lineParam(ld, 'hw', v) * 1000;
      // same meandered centreline as the carving (relief.js) and the rivers (hydro.js)
      if (ad < 1.5 * hw) canyonM = Math.max(canyonM, smoothstep(hw * 1.2, hw * 0.7, Math.abs(F.hD[i] + canyonOffset(hw, X, Y, Z))));
    } else if (kind === 'oldbed') {
      const hw = lineParam(ld, 'hw', v) * 1000;
      bedM = Math.max(bedM, smoothstep(hw * 1.3, hw * 0.3, ad));
    }
  }
  F.rift = riftM; F.rangeM = rangeM; F.rangeH = rangeH; F.canyon = canyonM; F.pass = passM; F.oldbed = bedM;
  F.mount = Math.max(mp * (1 - passM), rangeM);
  const mount = F.mount;

  // ---- coast (macro + archipelago + estuaries + fractal + site override)
  F.tidal = Math.max(F.wOX3, F.wOX1 * 0.85, F.wArch * 0.3);
  F.coastRough = (1 + 0.45 * mount + 0.25 * F.rough - 0.45 * F.wOX3 - 0.25 * F.wOX1 - 0.15 * cityness) * (1 - 0.35 * F.wArch);
  F.c = coastMetric(F, mw);
  F.c = g01Coast(F, F.c);
  // old river beds raise the land (OX1): the higher beds split the wide waters into branches
  if (bedM > 0 && F.wOX1 > 0 && F.c < 2500) {
    for (let i = 0; i < nh; i++) {
      const ld = LINE_DATA[F.hLine[i]];
      if (ld.kind !== 'oldbed') continue;
      const hw = lineParam(ld, 'hw', F.hV[i]) * 1000;
      const ad = Math.abs(F.hD[i] + 700 * NC.n3(X / 7000, Y / 7000, Z / 7000));
      const prof = smoothstep(1.2 * hw, 0.35 * hw, ad);
      if (prof > 0) F.c = F.c + prof * (Math.max(0, -F.c) + 2500 - Math.max(0, F.c)) * (F.c < 2500 ? 1 : 0);
    }
  }
  const sea = F.c < 0;

  // ---- ice & frost
  iceFields(F, mw);

  // ---- public bare-rock / mountain mask
  let ridge = Math.max(mount, riftM * 0.95, canyonM * 0.6 * (F.province === 8 ? 0.55 : 1));
  if (F.wVolc) ridge = Math.max(ridge, 0.6 * smoothstep(1.15, 0.6, vd));
  F.ridge = sea ? ridge * 0.25 : ridge;

  // ---- urban potential (Z look): density stars + coastal belts, broken by rock, water, ice
  let uC = 0;
  if (F.coastKm < 60 && F.coastKm > -5) {
    const belt = smoothstep(60, 6, F.coastKm);
    const mod = 0.4 + 0.6 * smoothstep(-0.35, 0.35, NU.n3(X / 160000, Y / 160000, Z / 160000) + 0.4 * NU.n3(X / 40000, Y / 40000 + 3, Z / 40000));
    uC = 0.8 * belt * mod;
  }
  const land = smoothstep(-25, 40, F.c);
  let u = Math.max(smoothstep(0.18, 0.5, F.density), uC) * (1 - F.zoneO) * land;
  u *= 1 - 0.96 * smoothstep(0.2, 0.62, Math.max(mount, riftM));
  u *= 1 - F.ice;
  u *= 1 - 0.65 * canyonM * (F.province === 8 ? 0 : 1);
  F.urban = clamp(u, 0, 1);
  // farmland base (O look) before irrigation proximity
  let fb = F.zoneO * land * (1 - smoothstep(0.15, 0.55, mount)) * (1 - F.ice) * (0.15 + 0.85 * F.oBasin);
  fb *= 1 - 0.7 * F.wOX6;
  fb *= 1 - 0.8 * canyonM;
  // G02 irrigation district (QS-08): the farmland plain below the water stairs, fed by the G02-OUT spill channel
  F.g02Terrace = 0;
  if (F.wOX5 > 0.3) {
    const gf = g02Farm(x, y, z);
    if (gf.plain > 0) fb = Math.max(fb, 0.95 * gf.plain * land * (1 - F.ice));
    F.g02Terrace = gf.terrace;
  }
  // OX1 catchment basin (basin.js): no farmland / canals in the basin and on its tablelands (downstream only)
  const bm = basinMask(x, y, z);
  F.basinW = bm.w; F.basinIn = bm.inner; F.basinTab = bm.tab;
  if (bm.inner > 0) fb *= 1 - bm.inner;
  F.farmBase = clamp(fb, 0, 1);
  // farmland actually allowed (irrigation canals, fields): DECISION (fix round 2, DD) no open farmland / irrigation
  // canals north of 70N (OX4: meltwater channels + greenhouse feeds only, 耕地移进温室). farmBase keeps grading
  // the ground (relief) so the OX4 terrain and its ice-foot system do not move.
  F.farmOK = lat > 69.4 ? F.farmBase * (1 - smoothstep(69.4, 70.0, lat)) : F.farmBase;
  return F;
}

