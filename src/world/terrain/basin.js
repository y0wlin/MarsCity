// OX1 东泽汇水盆地 — catchment basin with a multi-branched lake framed by red-rock tablelands (§5 03 富氧水网,
// §2 OX1 "台地泄水进入蓝色多汊湖", R1 / O01). OWNER: terrain-fn agent. Pure, worker-safe, float64.
//
// Local frame: gnomonic metres around the lake centre C; u along the basin axis (bearing AXIS, from the outlet in
// the SW toward the basin head in the NE), v to the left (NW) of it.
//   * inner escarpment: a horseshoe open toward the outlet; red-rock cliffs 300-470 m above the basin floor with a
//     talus apron, cap-rock shoulder, re-entrants, spurs and strata ledges (relief.js strata); tableland top beyond,
//     outer escarpment back down to the natural lowland ~5 km further out;
//   * basin floor rising from L+5 at the centre to ~L+75 at the escarpment foot;
//   * dendritic drowned valleys (trunk + 7 tributaries joining at staggered points + branches, fractally
//     meandered): their lower reaches lie
//     below the lake level L -> a multi-branched lake with natural curving shores, open water and islands at the
//     centre; upstream the valleys continue dry and cut notches into the tableland (tributary inlets 支谷入水口);
//   * buttes (two are islands in the lake); a rock sill at the outlet (trunk floor L-3); a graded apron downstream.
// relief.js applies basinRelief() after the coast ramp (the OX1 coastal flattening would squash the landform);
// waterbodies.js: lake 'OX1-BL1' (type 3, kind 'lake') where the ground is below L inside the basin, outlet channel
// 'OX1-BL1-OUT' (type 2, kind 'canal', order 0) with a sluice staircase from L down to the C0 main canal that
// starts at the forced node at its end (irrigation.js) -> the canal network and farms lie downstream of the lake.
// field.js: basinMask() suppresses farmland / canal nodes / marsh lakes inside the basin and on the tablelands.

import { R } from '../../core/constants.js';
import { makeNoise, smoothstep, bandW, smin } from './noise.js';
import { slopeTerm, ampTerm, slopeScale } from './gully.js';

const DEG = Math.PI / 180;
export const OX1_BASIN = {
  id: 'OX1-B1', name: '东泽汇水盆地', province: 'OX1',
  lat: 7.3742, lon: 104.9724,      // lake centre C (11.5 km NE of the old S03 camera 7.215N 104.86E)
  axis: 35,                        // bearing of +u (outlet -> basin head)
  level: 150,                      // lake surface (m)
  sillU: -5000,                    // outlet sill on the trunk (m along u)
  lakeId: 'OX1-BL1', outletId: 'OX1-BL1-OUT',
};
const L = OX1_BASIN.level;
const U0 = 700, A_FAR = 8900, A_BACK = 13000, B_SIDE = 8100;     // rim ellipse (m)
const RHO_OUT = 2.0;                                            // outer tableland edge (rim units, noisy: mesas)
const SILL = OX1_BASIN.sillU;
const NB = makeNoise(0xb51), NV = makeNoise(0xb52);

// ---- frame
const la0 = OX1_BASIN.lat * DEG, lo0 = OX1_BASIN.lon * DEG;
const C = [Math.cos(la0) * Math.sin(lo0), Math.sin(la0), Math.cos(la0) * Math.cos(lo0)];
const E = [Math.cos(lo0), 0, -Math.sin(lo0)];
const N = [-Math.sin(la0) * Math.sin(lo0), Math.cos(la0), -Math.sin(la0) * Math.cos(lo0)];
const sa = Math.sin(OX1_BASIN.axis * DEG), ca = Math.cos(OX1_BASIN.axis * DEG);
// u = east*sa + north*ca ; v (left, bearing axis-90) = -east*ca + north*sa
const UAX = [E[0] * sa + N[0] * ca, E[1] * sa + N[1] * ca, E[2] * sa + N[2] * ca];
const VAX = [-E[0] * ca + N[0] * sa, -E[1] * ca + N[1] * sa, -E[2] * ca + N[2] * sa];
const DOT_MIN = Math.cos(56000 / R);
const DOT_MIN_LITE = Math.cos(52000 / R);

/** local (u, v) metres of a unit vector; false when far from the basin */
const LOC = { u: 0, v: 0 };
function toLocal(x, y, z, dotMin) {
  const d = x * C[0] + y * C[1] + z * C[2];
  if (d < dotMin) return false;
  const k = R / d;
  LOC.u = (x * UAX[0] + y * UAX[1] + z * UAX[2]) * k;
  LOC.v = (x * VAX[0] + y * VAX[1] + z * VAX[2]) * k;
  return true;
}
/** (u, v) metres -> unit vector */
export function basinToUnit(u, v, out = [0, 0, 0]) {
  const x = C[0] + (UAX[0] * u + VAX[0] * v) / R, y = C[1] + (UAX[1] * u + VAX[1] * v) / R, z = C[2] + (UAX[2] * u + VAX[2] * v) / R;
  const l = Math.hypot(x, y, z); out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}
export function basinToLatLon(u, v) { const p = basinToUnit(u, v); return [Math.asin(p[1]) / DEG, Math.atan2(p[0], p[2]) / DEG]; }

// ---- rim geometry (analytic part, no noise): normalised elliptic radius, direction cosine, ray radius
const RIM = { rho: 0, cos: 0, rdir: 0 };
function rimGeom(u, v) {
  const du = u - U0, A = du > 0 ? A_FAR : A_BACK;
  const rho = Math.sqrt((du / A) * (du / A) + (v / B_SIDE) * (v / B_SIDE)) + 1e-9;
  const dist = Math.hypot(du, v) + 1e-6;
  RIM.rho = rho; RIM.cos = du / dist; RIM.rdir = dist / rho;
  return RIM;
}
/** inner escarpment position (rim units) without the fine noise: recedes out of the region toward the outlet */
function rimOpen(cos) { return 1 + 1.3 * (1 - smoothstep(-0.92, -0.45, cos)); }
/** tableland sector weight (1 = horseshoe tableland, 0 = open toward the outlet) */
function sectorTab(cos) { return smoothstep(-0.95, -0.55, cos); }

/**
 * Cheap mask for the lower layers (field.js: farmland / canal nodes / marsh lakes), no terrain:
 * returns { w: region weight incl. the downstream apron, inner: basin interior + tablelands (no farms / canals),
 * tab: tableland top/escarpment weight }.
 */
export const BMASK = { w: 0, inner: 0, tab: 0 };
export function basinMask(x, y, z) {
  BMASK.w = 0; BMASK.inner = 0; BMASK.tab = 0;
  if (!toLocal(x, y, z, DOT_MIN_LITE)) return BMASK;
  const u = LOC.u, v = LOC.v;
  const g = rimGeom(u, v);
  const st = sectorTab(g.cos);
  const wTab = 1 - smoothstep(RHO_OUT - 0.2, RHO_OUT + 0.45, g.rho);
  const wOpen = 1 - smoothstep(1.15, 1.75, g.rho);
  const down = 1 - smoothstep(SILL + 400, SILL - 1600, u);         // 1 upstream of the sill
  const ap = (1 - smoothstep(3500, 7500, Math.abs(v))) * (1 - smoothstep(5000, 13000, SILL - u)) * (1 - down);
  BMASK.w = Math.max(st * wTab + (1 - st) * wOpen, ap);
  BMASK.inner = Math.max(st * wTab, (1 - st) * wOpen * down);
  const re = rimOpen(g.cos);
  BMASK.tab = st * wTab * smoothstep(re - 0.08, re + 0.02, g.rho);
  return BMASK;
}

// ---------------------------------------------------------------------------------------------
// valleys: authored control polylines (km in u, v) -> fractal meander -> dense polylines with floor / width
// ---------------------------------------------------------------------------------------------
const VALLEYS = [
  // trunk: from the outlet sill through the lake to the head notch in the NE escarpment
  { id: 'T', pts: [[-5.0, 0.25], [-3.6, -0.3], [-1.8, 0.4], [0.2, -0.2], [2.2, 0.6], [4.2, 0.0], [6.2, 0.6], [8.4, 1.2], [10.4, 1.6], [12.6, 2.5]],
    floor: [-3, -20, -34, -38, -35, -27, -15, 2, 30, 150], b: [170, 450, 650, 700, 650, 560, 450, 320, 200, 110], seed: 11 },
  // Tributaries join the trunk at STAGGERED points (right bank k1, k4, k6, k9; left bank k2, k5, k7) with different
  // lengths, angles and side branches (final-capture review: mirrored pairs leaving the trunk at the same points read
  // as a symmetric fishbone from S03). The outlet end is unchanged (trunk, R1, R1a: sill, town and sluices).
  { id: 'R1', parent: 'T', k: 1, pts: [[-3.2, -2.2], [-3.0, -4.2], [-2.2, -6.2], [-1.6, -8.4], [-1.2, -10.5]], seed: 14 },
  { id: 'R1a', parent: 'R1', k: 2, pts: [[-4.6, -5.0], [-5.8, -6.6], [-6.6, -8.3]], seed: 15 },
  { id: 'L1', parent: 'T', k: 2, pts: [[-2.4, 2.2], [-2.2, 4.0], [-2.8, 5.8], [-2.4, 7.8], [-1.8, 9.6]], seed: 12 },
  { id: 'L1a', parent: 'L1', k: 3, pts: [[-4.4, 6.6], [-5.4, 8.2]], seed: 13 },
  { id: 'R2', parent: 'T', k: 4, pts: [[2.8, -1.8], [3.2, -3.8], [3.6, -5.6], [3.4, -7.6], [3.8, -9.6]], seed: 18 },
  { id: 'R2a', parent: 'R2', k: 2, pts: [[1.8, -5.0], [1.0, -6.8], [0.6, -8.6]], seed: 19 },
  { id: 'L2', parent: 'T', k: 5, pts: [[4.0, 1.8], [4.4, 3.8], [4.0, 5.8], [4.6, 7.6], [5.4, 9.4]], seed: 16 },
  { id: 'L2a', parent: 'L2', k: 2, pts: [[2.6, 5.2], [1.6, 6.8], [1.2, 8.6]], seed: 17 },
  { id: 'R3', parent: 'T', k: 6, pts: [[6.6, -1.2], [6.4, -3.0], [7.0, -4.6], [8.2, -6.0], [9.2, -7.2]], seed: 21 },
  { id: 'R3a', parent: 'R3', k: 3, pts: [[9.0, -3.6], [10.6, -3.4], [12.0, -2.6]], seed: 22 },
  { id: 'L3', parent: 'T', k: 7, pts: [[8.6, 3.0], [9.6, 4.6], [10.8, 5.8], [12.0, 6.8]], seed: 20 },
  { id: 'R4', parent: 'T', k: 9, pts: [[13.0, 1.0], [13.6, -0.2]], seed: 23 },
];
function lh(a, b, c) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 2D fractal meander (midpoint displacement, mostly alternating sides) + Catmull-Rom densification */
function meander(P, f, seed) {
  let pts = P.map((p) => [p[0], p[1]]), par = f.slice();
  let amp = 0.16;
  for (let lvl = 0; lvl < 3; lvl++) {
    const p2 = [pts[0]], f2 = [par[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const h1 = lh(seed, lvl * 997 + i, 0x51), h2 = lh(seed, lvl * 997 + i, 0x7a);
      const sg = (h2 < 0.78 ? ((i + lvl + seed) & 1) : (h2 < 0.89 ? 0 : 1)) ? 1 : -1;
      const disp = amp * len * sg * (0.5 + 0.5 * h1);
      p2.push([(a[0] + b[0]) / 2 - (dy / len) * disp, (a[1] + b[1]) / 2 + (dx / len) * disp], b);
      f2.push((par[i] + par[i + 1]) / 2, par[i + 1]);
    }
    pts = p2; par = f2; amp *= 0.55;
  }
  const out = [], fo = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.12));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const c = (q) => 0.5 * (2 * p1[q] + (-p0[q] + p2[q]) * t + (2 * p0[q] - 5 * p1[q] + 4 * p2[q] - p3[q]) * t2 + (-p0[q] + 3 * p1[q] - 3 * p2[q] + p3[q]) * t3);
      out.push([c(0) * 1000, c(1) * 1000]); fo.push(par[i] + (par[i + 1] - par[i]) * t);
    }
  }
  out.push([pts[pts.length - 1][0] * 1000, pts[pts.length - 1][1] * 1000]); fo.push(par[par.length - 1]);
  return { pts: out, f: fo };
}
const SEGS = [];        // [ax, ay, bx, by, floorA, floorB, bA, bB] (m, absolute floor m)
const VBY = {};
(function buildValleys() {
  for (const V of VALLEYS) {
    let ctrl = V.pts, floors, widths;
    if (V.parent) {
      const P = VBY[V.parent];
      const j = P.ctrl[V.k];
      ctrl = [j, ...V.pts];
      const f0 = P.floor[V.k] + 1, b0 = Math.min(500, 0.78 * P.b[V.k]);
      // floor rises toward the rim foot (rho ~ 0.95: +28 m) and then climbs the tableland notch (+60 m/km)
      floors = [f0]; widths = [b0];
      let s = 0, crossed = -1;
      for (let i = 1; i < ctrl.length; i++) {
        s += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
        const g = rimGeom(ctrl[i][0] * 1000, ctrl[i][1] * 1000);
        if (crossed < 0 && g.rho > 0.93 * rimOpen(g.cos)) crossed = s;
        widths.push(Math.max(80, b0 * (1 - 0.12 * i)));
        floors.push(0);
      }
      const sRim = crossed > 0 ? crossed : s;
      let acc = 0;
      for (let i = 1; i < ctrl.length; i++) {
        acc += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
        floors[i] = acc <= sRim ? f0 + (24 - f0) * Math.pow(acc / sRim, 2.6) : 24 + 55 * (acc - sRim);
      }
    } else { floors = V.floor; widths = V.b; }
    VBY[V.id] = { ctrl, floor: floors, b: widths };
    const idx = ctrl.map((_, i) => i);
    const M = meander(ctrl, idx, V.seed);
    for (let i = 0; i < M.pts.length - 1; i++) {
      const fa = M.f[i], fb = M.f[i + 1];
      const ip = (arr, t) => { const i0 = Math.min(arr.length - 1, Math.floor(t)), i1 = Math.min(arr.length - 1, i0 + 1), q = t - i0; return arr[i0] + (arr[i1] - arr[i0]) * q; };
      SEGS.push([M.pts[i][0], M.pts[i][1], M.pts[i + 1][0], M.pts[i + 1][1], L + ip(floors, fa), L + ip(floors, fb), ip(widths, fa), ip(widths, fb)]);
    }
  }
})();
// 1 km grid index of the segments that can carve each cell
const GC = 1000, G0 = -24000, GN = 48;
const GRID = new Array(GN * GN);
(function buildGrid() {
  const reach = 1900;
  for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
    const cx = G0 + (gx + 0.5) * GC, cy = G0 + (gy + 0.5) * GC;
    const list = [];
    for (let s = 0; s < SEGS.length; s++) {
      const q = SEGS[s];
      const ex = q[2] - q[0], ey = q[3] - q[1], l2 = ex * ex + ey * ey || 1;
      let t = ((cx - q[0]) * ex + (cy - q[1]) * ey) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(q[0] + ex * t - cx, q[1] + ey * t - cy);
      if (d < reach + 0.71 * GC) list.push(s);
    }
    GRID[gy * GN + gx] = list;
  }
})();
/** valley side rise (m) at e metres beyond the flat floor: gentle in the basin floor, canyon walls higher up */
function sideRise(e) { return e <= 0 ? 0 : 0.12 * e + (e > 260 ? 1.25 * (e - 260) : 0); }
/** lowest valley bed (m) at (u, v); VB.d = distance to that valley's centreline, VB.floor */
const VB = { bed: 1e9, d: 1e9, floor: 0, b: 0 };
function valleyBed(u, v) {
  VB.bed = 1e9; VB.d = 1e9;
  const gx = Math.floor((u - G0) / GC), gy = Math.floor((v - G0) / GC);
  if (gx < 0 || gy < 0 || gx >= GN || gy >= GN) return VB;
  const list = GRID[gy * GN + gx];
  for (let k = 0; k < list.length; k++) {
    const q = SEGS[list[k]];
    const ex = q[2] - q[0], ey = q[3] - q[1], l2 = ex * ex + ey * ey || 1;
    let t = ((u - q[0]) * ex + (v - q[1]) * ey) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(q[0] + ex * t - u, q[1] + ey * t - v);
    const fl = q[4] + (q[5] - q[4]) * t, b = q[6] + (q[7] - q[6]) * t;
    const bed = fl + sideRise(d - b);
    if (bed < VB.bed) { VB.bed = bed; VB.d = d; VB.floor = fl; VB.b = b; }
  }
  return VB;
}

// buttes: [u, v, radius (m), height above the floor (m)] — the last two stand in the lake
const BUTTES = [[6400, 4300, 850, 270], [5000, -6000, 650, 230], [7600, -1700, 520, 190], [-600, 1600, 420, 120], [-1300, -3100, 330, 70]];

/** escarpment / butte cross-section (fraction of the height) at signed distance dm (m, > 0 = into the rock) */
function scarpProfile(dm, wc) {
  return 0.16 * smoothstep(-700, 0, dm) + 0.74 * smoothstep(0, wc, dm) + 0.1 * smoothstep(wc, wc + 500, dm);
}
function scarpSlope(dm, wc) {
  const d1 = (a, b, x) => { if (x <= a || x >= b) return 0; const t = (x - a) / (b - a); return 6 * t * (1 - t) / (b - a); };
  return 0.16 * d1(-700, 0, dm) + 0.74 * d1(0, wc, dm) + 0.1 * d1(wc, wc + 500, dm);
}

/** material / strata hints of the last basinRelief() call */
export const BR = { w: 0, rock: 0, cliff: 0, strata: 0, strataSl: 0, talus: 0, mesa: 0, floor: 0, lakeZone: false, u: 0, v: 0 };

/**
 * Designed basin landform blended into the natural relief h (m) at fields F (unit vector F.x/y/z, metres F.X/Y/Z).
 * Fades the natural gully steering inside the basin and pushes the escarpment slope / amplitude terms.
 */
export function basinRelief(F, h, mw) {
  BR.w = 0; BR.rock = 0; BR.cliff = 0; BR.strata = 0; BR.strataSl = 0; BR.talus = 0; BR.mesa = 0; BR.floor = 0; BR.lakeZone = false;
  if (!toLocal(F.x, F.y, F.z, DOT_MIN)) return h;
  const u = LOC.u, v = LOC.v;
  BR.u = u; BR.v = v;
  const X = F.X, Y = F.Y, Z = F.Z;
  const g = rimGeom(u, v);
  const rho = g.rho, cosT = g.cos, rdir = g.rdir;
  const st = sectorTab(cosT);
  // ---- inner escarpment position with re-entrants and spurs (rim units)
  const b2 = bandW(1600, mw);
  const b7 = bandW(7000, mw), b26 = bandW(2600, mw), b36 = bandW(3600, mw);
  let re = rimOpen(cosT) + 0.1 * b7 * NB.n3(X / 7000, Y / 7000, Z / 7000) + 0.045 * b26 * NB.n3(X / 2600 - 1.3, Y / 2600, Z / 2600) + 0.02 * b2 * NB.n3(X / 1100 + 3.1, Y / 1100, Z / 1100);
  const rc = 1 - Math.abs(NB.n3(X / 3600 - 5.3, Y / 3600, Z / 3600 + 1.7));
  re += 0.16 * b36 * smoothstep(0.8, 0.97, rc) * smoothstep(0.55, 1.0, rho);
  // outer edge: a noise threshold rather than a ring -> lobate plateau edge with detached mesas / buttes
  const reO = RHO_OUT + 0.32 * bandW(9000, mw) * NB.n3(X / 9000 + 7.7, Y / 9000, Z / 9000) + 0.16 * bandW(3300, mw) * NB.n3(X / 3300, Y / 3300 - 2.2, Z / 3300) + 0.05 * b2 * NB.n3(X / 1300, Y / 1300, Z / 1300 + 5.5);
  // ---- region weight (tableland sector: outer escarpment; open sector: smooth; downstream apron)
  const wc = Math.max(240, 1.5 * mw);
  const dO = (rho - reO) * rdir;                       // metres beyond the outer escarpment
  const pO = 0.1 * smoothstep(-500 - wc, -wc, dO) + 0.74 * smoothstep(-wc, 0, dO) + 0.16 * smoothstep(0, 700, dO);
  const wTab = 1 - pO;
  const wOpen = 1 - smoothstep(1.15, 1.75, rho);
  const down = 1 - smoothstep(SILL + 400, SILL - 1600, u);
  const ap = (1 - smoothstep(3500, 7500, Math.abs(v))) * (1 - smoothstep(5000, 13000, SILL - u)) * (1 - down);
  const W = Math.max(st * wTab + (1 - st) * wOpen, ap);
  if (W <= 0) return h;
  BR.w = W;
  // ---- basin floor / downstream apron
  // islands / peninsulas between the drowned arms near the centre (two noise octaves around the lake level)
  const fl = L - 2.5 + 72 * Math.pow(Math.min(rho, 1.3), 2.3)
    + (7.5 + 5 * Math.min(1, rho)) * b26 * NV.n3(X / 2600, Y / 2600, Z / 2600) + (3 + 2 * (1 - Math.min(1, rho))) * bandW(1100, mw) * NV.n3(X / 1100 + 2.2, Y / 1100, Z / 1100);
  const apron = L - 24 - 0.0018 * Math.max(0, SILL - 1500 - u) + 3 * bandW(3000, mw) * NV.n3(X / 3000 - 4.1, Y / 3000, Z / 3000);
  const ka = smoothstep(SILL + 600, SILL - 1500, u);
  let D = fl + (apron - fl) * ka;
  // ---- inner escarpment + tableland
  const HT = 385 + 70 * bandW(22000, mw) * NB.n3(X / 22000, Y / 22000 + 4, Z / 22000) + 22 * bandW(6000, mw) * NB.n3(X / 6000, Y / 6000, Z / 6000 - 3);
  const dm = (rho - re) * rdir;                        // metres into the tableland
  const pr = scarpProfile(dm, wc) * st;
  D += HT * pr;
  // ---- buttes (two stand in the lake)
  let butte = 0, bSteep = 0;
  for (let i = 0; i < BUTTES.length; i++) {
    const q = BUTTES[i];
    const du = u - q[0], dv = v - q[1];
    const dd = Math.hypot(du, dv);
    if (dd > q[2] + 1400) continue;
    const r = q[2] * (1 + 0.1 * bandW(700, mw) * NB.n3(X / 700 + i * 5, Y / 700, Z / 700));
    const p = scarpProfile(r - dd, Math.max(140, 1.5 * mw));
    if (p * q[3] > butte) { butte = p * q[3]; bSteep = Math.max(bSteep, smoothstep(0.12, 0.3, p) * (1 - smoothstep(0.85, 0.95, p))); }
  }
  D += butte;
  // ---- drowned dendritic valleys
  // (band-limited by the valley width: unresolved arms fade into the basin floor, never a smooth-min pit)
  valleyBed(u, v);
  const wv = VB.bed < D + 30 ? bandW(2 * (VB.b + 250), mw) : 0;
  if (wv > 0) D += (smin(D, VB.bed, 18) - D) * wv;
  // ---- blend into the natural relief
  const hOut = h + (D - h) * W;
  // fade the natural gully steering, push the escarpment terms (spur-and-gully cliffs)
  slopeScale(1 - W);
  const sl = HT * scarpSlope(dm, wc) * st * W;
  if (sl > 1e-4) {
    // outward direction of the rim metric (ECEF): gradient of rho (u, v) mapped on the frame axes
    const du = u - U0, A = du > 0 ? A_FAR : A_BACK;
    let gu = du / (A * A * rho), gv = v / (B_SIDE * B_SIDE * rho);
    const gl = Math.hypot(gu, gv) || 1; gu /= gl; gv /= gl;
    slopeTerm(3000, sl, UAX[0] * gu + VAX[0] * gv, UAX[1] * gu + VAX[1] * gv, UAX[2] * gu + VAX[2] * gv);
    const face = 1 - Math.abs(2 * scarpProfile(dm, wc) - 1);
    ampTerm(3000, 0.085 * HT * face * st * W);
  }
  // ---- material hints
  const cliff = smoothstep(0.1, 0.35, wc * scarpSlope(dm, wc)) * st;
  BR.cliff = Math.max(cliff, bSteep) * W;
  BR.strata = Math.max(cliff, bSteep * 0.9, 0.45 * smoothstep(-700, -150, dm) * (1 - smoothstep(0, wc, dm)) * st) * W;
  BR.strataSl = BR.strata > 0.02 ? 1.7 * HT * 0.74 / wc * 1.5 : 0;
  BR.talus = smoothstep(-650, -100, dm) * (1 - smoothstep(-80, 60, dm)) * st * W;
  BR.mesa = Math.max(smoothstep(-200, wc, dm) * st, butte > 20 ? smoothstep(20, 80, butte) : 0) * W;
  BR.rock = Math.max(BR.mesa * 0.9, BR.cliff, BR.talus * 0.6, smoothstep(0.75, 0.95, rho) * 0.3 * st * W);
  BR.floor = (1 - smoothstep(-300, 0, dm)) * W * (1 - ka);
  BR.lakeZone = u > SILL - 250 && dm < -150;
  return hOut;
}

// ---------------------------------------------------------------------------------------------
// outlet channel (sill -> forced C0 node): polyline (m), sluices from L down to the main canal level
// ---------------------------------------------------------------------------------------------
// a straight engineered main canal (irrigation.js outletSeg(): sluice staircase, laterals, ditches like any main)
const OUT_CTRL = [[-5.0, 0.25], [-9.2, 0.1]];
export const OUTLET = (() => {
  const pts = OUT_CTRL.map(([a, b]) => [a * 1000, b * 1000]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { id: OX1_BASIN.outletId, level: OX1_BASIN.level, pts, cum, len: cum[cum.length - 1], width: 44, end: pts[pts.length - 1] };
})();
/** distance (m) and along-station (m) of (u, v) to the outlet polyline */
const OD = { d: 1e9, s: 0, tx: 1, ty: 0 };
export function outletDist(u, v) {
  OD.d = 1e9;
  const P = OUTLET.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const ex = P[i + 1][0] - P[i][0], ey = P[i + 1][1] - P[i][1], l = Math.hypot(ex, ey) || 1;
    let t = ((u - P[i][0]) * ex + (v - P[i][1]) * ey) / (l * l); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(P[i][0] + ex * t - u, P[i][1] + ey * t - v);
    if (d < OD.d) { OD.d = d; OD.s = OUTLET.cum[i] + t * l; OD.tx = ex / l; OD.ty = ey / l; }
  }
  return OD;
}
/** local coordinates of a unit vector (null when far) */
export function basinLocal(x, y, z) { return toLocal(x, y, z, DOT_MIN) ? LOC : null; }
/** frame axes (ECEF unit vectors) for flow directions */
export const BASIN_AXES = { u: UAX, v: VAX, e: E, n: N };
