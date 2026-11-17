// Inland water bodies carved into the natural relief, and point water classification.
// OWNER: terrain-fn agent. Installed into core.js as the water carver.
//
//   rivers   on canyon / gorge floors (layout lines with a 'river' width): flat-bottomed channel,
//            cut banks, gravel bars; level = floor - 0.6 m (flows toward the line's end)
//   canals   O-zone irrigation network (irrigation.js)
//   lakes    explicit lake objects on jittered 3D shell grids (seamless), each with ONE level:
//            'marsh' OX1 东泽 multi-lobed lakes between the old river beds, 'melt' OX4 meltwater
//            pools at the foot of the ice cliffs, 'pond' O-zone storage ponds (调蓄池), 'tarn'
//            ZR3 plateau / ZR6 valley lakes. Sites are flat (the rim is checked); shores get a
//            shallow shelf and raised old-shoreline terraces (湖岸台阶).
//   sites    megastructure landforms (megasites.js): G01 harbour, G02 water stairs.
// Order: rivers -> canals -> lakes -> sites (later bodies win where they overlap).

import { R } from '../../core/constants.js';
import { LINE_DATA, lineParam, lineTangent } from './layout.js';
import { canyonOffset } from './relief.js';
// lake candidates (flatness / level) use the frozen fix-round-1 relief: stable lake layout (ids, levels)
import { relief } from './relief_v1.js';
import { computeFields, newFields, liteFields } from './field.js';
import { carveCanals, canalQuery, canalLevel, canalId, canalFlowSign, CQ } from './irrigation.js';
import { makeNoise, hash3, rehash, u01, smoothstep, clamp } from './noise.js';
import { installWaterCarver } from './core.js';
import { meltNear, carveMelt } from './icefoot.js';
import { BR, OX1_BASIN } from './basin.js';

const TG = new Float64Array(3);
let siteCarver = null;
export function installSiteCarver(fn) { siteCarver = fn; }

// ---------------------------------------------------------------------------------------------
// rivers on canyon / gorge floors
// ---------------------------------------------------------------------------------------------
function carveRivers(F, h, mw, M, W) {
  const nh = F.nh;
  if (!nh || mw > 300) return h;
  const X = F.X, Y = F.Y, Z = F.Z;
  for (let i = 0; i < nh; i++) {
    const ld = LINE_DATA[F.hLine[i]];
    if (ld.kind !== 'canyon' && ld.kind !== 'valley') continue;
    const v = F.hV[i];
    const Wd = lineParam(ld, 'river', v);
    if (Wd <= 0) continue;
    const hw = lineParam(ld, 'hw', v) * 1000;
    const d = Math.abs(F.hD[i] + canyonOffset(hw, X, Y, Z));
    const bank = Wd * 0.5 + Math.max(3, Wd * 0.15);
    if (d > bank + 60) continue;
    const fade = clamp((300 - mw) / 120, 0, 1) * clamp((Wd * 1.5 - mw) / (Wd * 0.75), 0, 1);
    if (fade <= 0) continue;
    const floor = lineParam(ld, 'floor', v);
    const lev = Math.max(0.3, floor - 0.6);
    const depth = 1.2 + Wd * 0.025;
    let t;
    if (d < Wd * 0.5) { const u = d / (Wd * 0.5); t = lev - depth * (1 - u * u * u) - 0.1; }
    else if (d < bank) { const u = (d - Wd * 0.5) / (bank - Wd * 0.5); t = lev - 0.1 + (floor + 0.8 - lev + 0.1) * smoothstep(0, 1, u); }
    else { const e = d - bank; t = clamp(h, floor + 0.8 - e * 0.3, floor + 0.8 + e * 0.8); }
    h = h + (t - h) * fade;
    if (d < Wd * 0.5 && fade > 0.5) {
      W.type = 2; W.level = lev; W.width = Wd; W.dist = d; W.kind = 'river'; W.id = ld.riverId || (ld.riverId = `R-${ld.id}`); W.order = 0;
      lineTangent(ld, v, TG);
      const lat = F.lat * Math.PI / 180, lon = F.lon * Math.PI / 180;
      const ex = Math.cos(lon), ez = -Math.sin(lon);
      const nx = -Math.sin(lat) * Math.sin(lon), ny = Math.cos(lat), nz = -Math.sin(lat) * Math.cos(lon);
      const fe = TG[0] * ex + TG[2] * ez, fn = TG[0] * nx + TG[1] * ny + TG[2] * nz;
      // tributaries are authored from the confluence upstream (floor rising): flow runs backwards
      const fp = ld.params.floor, fs = fp && fp[fp.length - 1] > fp[0] ? -1 : 1;
      const fl = (Math.hypot(fe, fn) || 1) * fs;
      W.fx = fe / fl; W.fy = fn / fl;
    }
    if (M && d < bank + 10) M.wet = Math.max(M.wet, 1 - smoothstep(bank, bank + 10, d));
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// lakes
// ---------------------------------------------------------------------------------------------
const NL = makeNoise(701);
const FN = newFields();
// influence radius r * elong * 1.9 <= 0.75 s (3x3x3 search), small classes 2x2x2
const CLASSES = [
  { name: 'marsh', s: 14000, p: 0.85, rMin: 1400, rMax: 3000, eMax: 2.0, depth: 8, seed: 0x1a1 },
  { name: 'melt', s: 2600, p: 0.85, rMin: 260, rMax: 650, eMax: 1.5, depth: 5, seed: 0x2b2 },
  { name: 'pond', s: 8000, p: 0.3, rMin: 220, rMax: 650, eMax: 1.4, depth: 6, seed: 0x3c3, small: true },
  { name: 'tarn', s: 12000, p: 0.25, rMin: 600, rMax: 2000, eMax: 1.5, depth: 14, seed: 0x4d4 },
];
const CACHE = new Map();
const MAXC = 100000;

function litePass(name, x, y, z) {
  const L = liteFields(x, y, z);
  if (L.coastKm < 2) return false;
  if (name === 'marsh') return L.dOX1 < 1.15 && L.zoneO > 0.3;
  if (name === 'melt') return L.dOX4 < 1.15 && L.lat > 60;
  if (name === 'pond') return L.zoneO > 0.4 && L.density < 0.5;
  if (name === 'tarn') return L.dZR3 < 1.2 || L.dZR6 < 1.2;
  return true;
}
function terrainAt(x, y, z, mw) { computeFields(x, y, z, mw, FN); return relief(FN, mw, null); }

function lakeAt(ci, cx, cy, cz) {
  const C = CLASSES[ci];
  const k = ((ci * 1048576 + (cx & 1048575)) * 1048576 + (cy & 1048575)) * 4096 + (cz & 4095);
  let L = CACHE.get(k);
  if (L !== undefined) return L;
  if (CACHE.size > MAXC) CACHE.clear();
  L = null;
  const h = hash3(cx, cy, cz, C.seed);
  if (u01(h) < C.p) {
    const s = C.s;
    const px = (cx + 0.2 + 0.6 * u01(rehash(h, 1))) * s, py = (cy + 0.2 + 0.6 * u01(rehash(h, 2))) * s, pz = (cz + 0.2 + 0.6 * u01(rehash(h, 3))) * s;
    const pl = Math.sqrt(px * px + py * py + pz * pz);
    if (Math.abs(pl - R) < 0.25 * s && litePass(C.name, px / pl, py / pl, pz / pl)) {
      const ux = px / pl, uy = py / pl, uz = pz / pl;
      computeFields(ux, uy, uz, 150, FN);
      const F = FN;
      let ok = false, w = 0;
      if (C.name === 'marsh') { w = F.wOX1 * F.zoneO; ok = w > 0.35 && F.c > 5000 && F.mount < 0.25 && F.oldbed < 0.2 && F.basinW < 0.05 && u01(rehash(h, 9)) < w; }
      else if (C.name === 'melt') { w = F.wOX4; ok = w > 0.25 && F.iceQ < -0.25 && F.iceQ > -4.5 && F.c > 2000; }
      else if (C.name === 'pond') { w = F.zoneO * F.farmOK; ok = w > 0.45 && F.c > 3000 && F.mount < 0.2 && F.wOX1 < 0.3 && F.basinW < 0.05; }
      else if (C.name === 'tarn') { w = Math.max(F.wZR3 * 0.6, F.wZR6) * (1 - F.urban * 0.8); ok = w > 0.4 && F.c > 5000 && F.canyon < 0.1 && u01(rehash(h, 9)) < w; }
      if (ok) {
        const H0 = relief(F, 150, null);
        const r = C.rMin + (C.rMax - C.rMin) * Math.pow(u01(rehash(h, 4)), 1.4);
        const elong = 1 + (C.eMax - 1) * u01(rehash(h, 5));
        let ex = uz, ez = -ux; let el = Math.hypot(ex, ez); if (el < 1e-9) { ex = 1; ez = 0; el = 1; } ex /= el; ez /= el;
        const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
        const ang = u01(rehash(h, 6)) * Math.PI;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const ax = [ex * ca + nx * sa, ny * sa, ez * ca + nz * sa], ay = [-ex * sa + nx * ca, ny * ca, -ez * sa + nz * ca];
        // flat site? the shore ring must not differ much from the centre (no lakes on slopes)
        let lo = H0, hi = H0;
        for (let q = 0; q < 6; q++) {
          const th = q * Math.PI / 3;
          const du = Math.cos(th) * r * elong * 1.15, dv = Math.sin(th) * r * 1.15;
          let qx = ux + (ax[0] * du + ay[0] * dv) / R, qy = uy + (ax[1] * du + ay[1] * dv) / R, qz = uz + (ax[2] * du + ay[2] * dv) / R;
          const ql = Math.hypot(qx, qy, qz); qx /= ql; qy /= ql; qz /= ql;
          const hq = terrainAt(qx, qy, qz, 150);
          if (hq < lo) lo = hq; if (hq > hi) hi = hq;
        }
        const tol = C.name === 'melt' ? 18 : C.name === 'pond' ? 10 : 30;
        if (hi - lo < tol) {
          const level = Math.max(0.8, Math.min(H0, lo) - (C.name === 'melt' ? 0.4 : 0.9));
          L = { ci, id: `L${ci}-${cx}-${cy}-${cz}`, x: ux, y: uy, z: uz, r, elong, ax, ay, level, depth: C.depth * (0.6 + 0.8 * u01(rehash(h, 7))), cls: C.name };
        }
      }
    }
  }
  CACHE.set(k, L);
  return L;
}

export const LQ = { lake: null, rho: 9, level: 0, depth: 0 };
export function lakeQuery(F) {
  LQ.lake = null; LQ.rho = 9;
  if (F.c < 1500 || F.ice > 0.5) return LQ;
  const x = F.x, y = F.y, z = F.z, X = F.X, Y = F.Y, Z = F.Z;
  for (let ci = 0; ci < CLASSES.length; ci++) {
    const C = CLASSES[ci];
    if (ci === 0 && F.wOX1 < 0.2) continue;
    if (ci === 1 && (F.wOX4 < 0.15 || F.iceQ < -7 || F.iceQ > 0.5)) continue;
    if (ci === 2 && (F.zoneO < 0.4 || F.farmOK < 0.3)) continue;
    if (ci === 3 && F.wZR3 < 0.2 && F.wZR6 < 0.2) continue;
    const s = C.s, inv = 1 / s;
    const o = C.small ? -0.5 : 0, lo = C.small ? 0 : -1, hi = 1;
    const ix = Math.floor(X * inv + o), iy = Math.floor(Y * inv + o), iz = Math.floor(Z * inv + o);
    for (let dz = lo; dz <= hi; dz++) for (let dy = lo; dy <= hi; dy++) for (let dx = lo; dx <= hi; dx++) {
      const L = lakeAt(ci, ix + dx, iy + dy, iz + dz);
      if (!L) continue;
      const qx = x - L.x, qy = y - L.y, qz = z - L.z;
      const u = (qx * L.ax[0] + qy * L.ax[1] + qz * L.ax[2]) * R, v = (qx * L.ay[0] + qy * L.ay[1] + qz * L.ay[2]) * R;
      const rr = L.r;
      const e = Math.sqrt((u / (rr * L.elong)) * (u / (rr * L.elong)) + (v / rr) * (v / rr));
      if (e > 1.9) continue;
      const il = 1 / (rr * 0.7);
      // lobes, coves and (for the marsh class) branching arms
      let rho = e + 0.2 * NL.n3(X * il, Y * il, Z * il) + 0.08 * NL.n3(X * il * 3.1 + 5, Y * il * 3.1, Z * il * 3.1);
      if (L.cls === 'marsh') rho -= 0.28 * Math.pow(1 - Math.abs(NL.n3(X * il * 0.8 - 7, Y * il * 0.8, Z * il * 0.8)), 6);
      if (rho < LQ.rho) { LQ.rho = rho; LQ.lake = L; LQ.level = L.level; LQ.depth = L.depth; }
    }
  }
  return LQ;
}

function carveLakes(F, h, mw, M) {
  if (mw > 1500) return h;
  lakeQuery(F);
  const L = LQ.lake;
  if (!L || LQ.rho > 1.6) return h;
  const fade = clamp((1500 - mw) / 700, 0, 1) * clamp((L.r * 1.2 - mw) / (L.r * 0.6), 0, 1);
  if (fade <= 0) return h;
  const rho = LQ.rho, lev = L.level;
  let t = h;
  if (rho < 1) {
    // shallow shelf near the shore, deeper bowl inside
    const shelf = 0.9 * smoothstep(1, 0.82, rho);
    t = Math.min(h, lev - 0.3 - shelf - L.depth * Math.pow(Math.max(0, 1 - rho * rho * 1.15), 0.8));
  } else {
    const e = (rho - 1) * L.r;
    // rim above the water + raised old-shoreline terraces (湖岸台阶)
    const terr = 1.6 * smoothstep(0, 4, e) + 2.4 * smoothstep(L.r * 0.12, L.r * 0.12 + 6, e);
    const rimMin = lev + 0.35 + Math.min(terr, e * 0.08 + 0.5);
    t = h < rimMin ? rimMin + (h - rimMin) * smoothstep(0, 1, (rho - 1) / 0.6) : h;
    if (M && e < 40) M.wet = Math.max(M.wet, 1 - e / 40);
  }
  return h + (t - h) * fade;
}

// ---------------------------------------------------------------------------------------------
// OX1 catchment basin (basin.js): the lake (ground below L inside the basin) and the outlet channel with its
// sluice staircase from the lake level down to the main canal leaving the forced outlet node (irrigation.js)
// ---------------------------------------------------------------------------------------------
function carveBasin(F, h, mw, M, W, bz) {
  // the lake (ground below L inside the basin); the outlet main canal is part of the canal network (irrigation.js)
  const Lk = OX1_BASIN.level;
  if (bz && h < Lk && W.type === 0) {
    W.type = 3; W.level = Lk; W.width = 0; W.dist = 0; W.id = OX1_BASIN.lakeId; W.kind = 'lake'; W.fx = 0; W.fy = 0; W.order = -1;
  }
  if (M && bz && h < Lk + 2.5 && h >= Lk) M.wet = Math.max(M.wet, 1 - (h - Lk) / 2.5);
  return h;
}

// ---------------------------------------------------------------------------------------------
// the carver installed into core.js
// ---------------------------------------------------------------------------------------------
function carveWater(F, h, mw, M, W) {
  if (F.c < 0) return siteCarver ? siteCarver(F, h, mw, M, W) : h;
  // basin state of THIS point (lazy canal levels below evaluate the relief at other points and overwrite BR)
  const bIn = F.basinW > 0 && BR.w > 0, bz = bIn && BR.lakeZone;
  h = carveRivers(F, h, mw, M, W);
  if (F.zoneO > 0.35) {
    h = carveCanals(F, h, mw, M);
    if (CQ.order >= 0 && CQ.dist < CQ.width * 0.5 && W.type === 0) {
      const lev = canalLevel();
      if (h < lev) {
        W.type = 2; W.level = lev; W.width = CQ.width; W.dist = CQ.dist;
        const fs = canalFlowSign();
        W.fx = CQ.fx * fs; W.fy = CQ.fy * fs; W.id = canalId(); W.order = CQ.order; W.kind = CQ.order === 2 ? 'ditch' : 'canal';
      }
    }
  }
  h = carveLakes(F, h, mw, M);
  if (LQ.lake && LQ.rho < 1 && h < LQ.level) {
    W.type = 3; W.level = LQ.level; W.width = 0; W.dist = 0; W.id = LQ.lake.id; W.kind = LQ.lake.cls; W.fx = 0; W.fy = 0; W.order = -1;
  }
  if (bIn) h = carveBasin(F, h, mw, M, W, bz);
  // OX4: ice-marginal meltwater channel, outflows, forebay pools and meltwater lakes (icefoot.js)
  if (meltNear(F.lat, F.wOX4, F.iceQ)) h = carveMelt(F, h, mw, M, W);
  if (siteCarver) h = siteCarver(F, h, mw, M, W);
  return h;
}
installWaterCarver(carveWater);

export { canalQuery };
