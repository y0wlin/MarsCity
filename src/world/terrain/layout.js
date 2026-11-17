// Hand-authored macro geology of the planet (pure data + fast spatial queries, worker-safe).
// OWNER: terrain-fn agent.
//
// The control maps fix the large-scale layout (two inner seas, provinces, density stars). This
// file adds the named landforms the brief asks for (prompt §1, §2, §5):
//   * sea additions painted into the water raster before the coast distance transform
//     (OX3 赤岸海 tidal inland sea, ZR5 南盆湾 sheltered deep basin bay + side bays);
//   * line features: the red rift crossing the ZR1 city fabric (with passes), the ZR2 西陆峡廊
//     canyon corridor, OX2 gorges, ZR6 sunny glacial valleys, mountain ranges cutting city bands
//     at red-rock passes, OX1 old river beds and drowned estuaries;
//   * landform regions (smooth elliptic blobs) and landmark craters.
// Coordinates: [lon, lat] degrees; widths km; heights m.

import { R } from '../../core/constants.js';

const DEG = Math.PI / 180;
export const KM_PER_DEG = (R * DEG) / 1000; // 59.157 km

// ---------------------------------------------------------------------------------------------
// 1. Sea additions (painted into the water raster). poly: closed polygon [[lon,lat]...];
//    chain: capsule chain [[lon, lat, halfWidthKm]...].
// ---------------------------------------------------------------------------------------------
export const SEA_PAINT = [
  // OX3 赤岸海: a modest, very shallow inland sea at sea level in the OX3 lowland (no mapped sea at
  // 135W). Elongated NW-SE; tidal flats, barrier spits and lagoons come from the coast metric.
  { name: 'ox3-sea', poly: [
    [-136.2, 26.0], [-134.6, 26.9], [-132.6, 26.6], [-130.9, 25.6], [-129.4, 24.7], [-127.6, 23.9], [-125.9, 22.6],
    [-124.9, 21.0], [-125.6, 19.7], [-127.2, 19.3], [-129.0, 19.9], [-130.6, 20.7], [-132.4, 21.5], [-134.2, 22.4],
    [-135.6, 23.5], [-136.6, 24.8]] },
  { name: 'ox3-arm-n', chain: [[-131.5, 25.4, 34], [-131.0, 27.2, 22], [-130.0, 28.6, 12]] },
  { name: 'ox3-arm-s', chain: [[-128.6, 20.2, 30], [-128.1, 18.4, 18], [-127.0, 17.1, 9]] },
  // ZR5 南盆湾: strait from the sea notch into a drowned round basin, side bays (drowned valleys)
  { name: 'zr5-strait', chain: [[100.2, -34.4, 40], [100.6, -35.8, 30], [101.2, -37.2, 27], [101.8, -38.4, 32]] },
  { name: 'zr5-basin', poly: [
    [101.0, -38.4], [102.4, -38.1], [103.9, -38.5], [105.0, -39.4], [105.4, -40.6], [104.9, -41.8], [103.7, -42.5],
    [102.2, -42.6], [100.9, -42.0], [100.2, -40.9], [100.3, -39.5]] },
  { name: 'zr5-bay-se', chain: [[104.6, -41.6, 16], [105.9, -42.9, 12], [107.0, -43.9, 8], [107.7, -44.6, 4]] },
  { name: 'zr5-bay-sw', chain: [[101.0, -41.9, 15], [100.2, -43.3, 11], [99.7, -44.4, 6], [99.4, -45.0, 3]] },
  { name: 'zr5-bay-e', chain: [[105.1, -39.6, 13], [106.6, -39.0, 10], [107.9, -38.8, 6], [108.8, -38.9, 3]] },
  { name: 'zr5-bay-s', chain: [[103.0, -42.4, 12], [103.4, -43.7, 9], [103.3, -44.8, 5], [103.0, -45.4, 2.5]] },
];

// ---------------------------------------------------------------------------------------------
// ZR2 canyon system generator (pure data at load). Profiles are piecewise-linear in the normalised
// vertex index; every tributary starts ON a vertex of its parent with the parent's floor and depth
// at that vertex (same rim), then rises / narrows / shallows toward its head.
// ---------------------------------------------------------------------------------------------
function profAt(P, t) {
  if (t <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) if (t <= P[i][0]) { const a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
  return P[P.length - 1][1];
}
function profArr(n, P, round) { const o = []; for (let i = 0; i < n; i++) { const v = profAt(P, n > 1 ? i / (n - 1) : 0); o.push(round ? Math.round(v) : Math.round(v * 1000) / 1000); } return o; }
function zr2Canyons() {
  const main = { id: 'zr2-main', kind: 'canyon', frac: { amp: 0.15, levels: 3, decay: 0.55, seed: 21 },
    pts: [[-115.0, 45.0], [-113.6, 43.6], [-113.2, 42.0], [-111.6, 41.0], [-110.6, 39.4], [-108.6, 38.6], [-107.9, 37.0], [-106.2, 36.3],
      [-105.4, 34.9], [-104.0, 34.4], [-103.6, 33.0], [-104.2, 31.6], [-103.2, 30.2], [-102.0, 29.4], [-102.4, 27.6], [-101.4, 26.2],
      [-101.9, 24.4], [-100.9, 22.9], [-101.4, 21.0], [-100.6, 19.4], [-101.2, 17.6], [-100.9, 15.2]] };
  const PM = {
    hw: [[0, 1.6], [0.3, 2.9], [0.5, 3.3], [0.75, 2.8], [1, 1.8]], fw: [[0, 0.12], [0.5, 0.34], [1, 0.27]],
    floor: [[0, 1420], [0.45, 880], [0.6, 700], [0.85, 250], [1, -20]], depth: [[0, 520], [0.45, 820], [0.55, 840], [0.8, 600], [1, 220]],
    // river: 80-90 m through the S06 reach (34.9N 105.3W, §5 06 下方河道在两桥之间出现), 120 m at the mouth
    steps: [[0, 3], [0.3, 5], [0.8, 4], [1, 3]], river: [[0, 30], [0.3, 72], [0.45, 92], [1, 120]],
  };
  const n = main.pts.length;
  for (const k of Object.keys(PM)) main[k] = profArr(n, PM[k], k === 'steps');
  const out = [main];
  const trib = (id, parent, k, pts, seed) => {
    const m = pts.length, f0 = parent.floor[k], d0 = parent.depth[k], hw0 = 0.7 * parent.hw[k], fw0 = 0.7 * parent.fw[k], r0 = 0.5 * parent.river[k];
    const L = { id, kind: 'canyon', frac: { amp: 0.14, levels: 3, decay: 0.55, seed }, pts: [parent.pts[k], ...pts] };
    L.hw = []; L.fw = []; L.floor = []; L.depth = []; L.steps = []; L.river = [];
    for (let i = 0; i <= m; i++) {
      const t = i / m;
      L.hw.push(+(hw0 * (1 - 0.58 * t)).toFixed(3)); L.fw.push(+(fw0 * (1 - 0.6 * t)).toFixed(3));
      L.floor.push(Math.round(f0 + 0.5 * d0 * Math.pow(t, 1.1))); L.depth.push(Math.round(d0 * (1 - 0.55 * t)));
      L.steps.push(Math.max(2, Math.round(parent.steps[k] - 2 * t))); L.river.push(+(r0 * (1 - 0.75 * t)).toFixed(1));
    }
    out.push(L);
    return L;
  };
  trib('zr2-nw2', main, 3, [[-112.4, 39.8], [-113.9, 39.4], [-114.6, 38.1], [-116.2, 37.4]], 31);
  trib('zr2-n', main, 5, [[-108.2, 40.1], [-109.0, 41.5], [-108.1, 43.0], [-106.8, 44.6]], 32);
  trib('zr2-w2', main, 7, [[-107.7, 35.5], [-109.3, 36.0], [-110.7, 34.8], [-112.6, 35.1]], 33);
  const ne = trib('zr2-ne', main, 9, [[-102.7, 35.1], [-101.6, 36.5], [-99.9, 36.8], [-98.9, 38.4], [-97.0, 38.8]], 34);
  const wsw = trib('zr2-wsw', main, 11, [[-105.9, 31.0], [-107.5, 31.5], [-109.1, 30.6], [-110.9, 31.0], [-113.0, 30.4]], 35);
  trib('zr2-ese', main, 13, [[-100.5, 30.3], [-99.0, 29.8], [-97.6, 30.9]], 36);
  trib('zr2-e2', main, 15, [[-99.9, 26.9], [-98.5, 26.1], [-97.0, 27.0]], 37);
  trib('zr2-ne-a', ne, 2, [[-101.0, 38.0], [-101.9, 39.5], [-101.2, 41.0]], 38);
  trib('zr2-wsw-a', wsw, 2, [[-107.9, 33.0], [-109.2, 33.4]], 39);
  // side canyons (box tributaries) every ~12-24 km along the meandered stems (Z04: the canyon
  // branches at every scale): short, alternating sides, acute junctions pointing downstream, the
  // rim matching the parent at the junction, the floor rising to a steep amphitheatre head; dry
  // (no river). Generated from the parent's actual (fractally meandered) centreline.
  const stems = [[main, 1, [3, 5, 7, 9, 11, 13, 15]], [out[4], -1, [2]], [out[5], -1, [2]], [out[1], -1, []], [out[2], -1, []], [out[3], -1, []]];
  let nSide = 0;
  for (const [P, down, skip] of stems) {
    const { pts, vpar } = splinePts(P, 2000);
    const nv = P.pts.length;
    const ip = (arr, f) => { const i0 = Math.min(arr.length - 1, Math.floor(f)), i1 = Math.min(arr.length - 1, i0 + 1), t = f - i0, s = t * t * (3 - 2 * t); return arr[i0] * (1 - s) + arr[i1] * s; };
    const seed = 0x51de + nSide * 7 + P.pts.length;
    let acc = 0, next = 5000 + 9000 * lhash(seed, 1, 0x5d), q = 0, lastSide = lhash(seed, 2, 0x5e) < 0.5 ? 1 : -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i];
      acc += Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * R;
      if (acc < next) continue;
      next = acc + 12000 + 12000 * lhash(seed, q, 0x6e);
      q++;
      const f = vpar[i];
      if (f < 0.3 || f > nv - 1.35) continue;                          // not at the stem ends
      if (skip.some((k) => Math.abs(f - k) < 0.14)) continue;           // a big tributary joins here
      const J = pts[i], la = Math.asin(J[1]), lo = Math.atan2(J[0], J[2]);
      const E = [Math.cos(lo), 0, -Math.sin(lo)], Nn = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)];
      const dv = [pts[i + 1][0] - a[0], pts[i + 1][1] - a[1], pts[i + 1][2] - a[2]];
      let te = (dv[0] * E[0] + dv[2] * E[2]) * down, tn = (dv[0] * Nn[0] + dv[1] * Nn[1] + dv[2] * Nn[2]) * down;
      const tl = Math.hypot(te, tn) || 1; te /= tl; tn /= tl;            // downstream unit (east, north)
      const h1 = lhash(seed, q, 0x71), h2 = lhash(seed, q, 0x72), h3 = lhash(seed, q, 0x73), h4 = lhash(seed, q, 0x74);
      const side = h1 < 0.74 ? -lastSide : lastSide; lastSide = side;
      const al = (24 + 26 * h2) * DEG;                                  // tilt toward upstream
      const de = side * -tn * Math.cos(al) - te * Math.sin(al), dn = side * te * Math.cos(al) - tn * Math.sin(al);
      const Lk = 5 + 12 * Math.pow(h3, 0.8);                            // km
      const bend = (h4 - 0.5) * 0.5;
      const cb = Math.cos(bend), sb = Math.sin(bend);
      const de2 = de * cb - dn * sb, dn2 = de * sb + dn * cb;
      const kx = 1 / (KM_PER_DEG * Math.cos(la)), ky = 1 / KM_PER_DEG;
      const lonJ = lo / DEG, latJ = la / DEG;
      const p1 = [lonJ + de * 0.5 * Lk * kx, latJ + dn * 0.5 * Lk * ky], p2 = [p1[0] + de2 * 0.5 * Lk * kx, p1[1] + dn2 * 0.5 * Lk * ky];
      const hp = ip(P.hw, f), fp = ip(P.fw, f), fl = ip(P.floor, f), dp = ip(P.depth, f), sp = ip(P.steps, f);
      const st = Math.max(2, Math.round(sp) - 1);
      out.push({ id: `zr2-s${nSide}`, kind: 'canyon', side: true, frac: { amp: 0.16, levels: 2, decay: 0.5, seed: 200 + nSide },
        pts: [[lonJ, latJ], p1, p2],
        hw: [+(0.44 * hp).toFixed(3), +(0.36 * hp).toFixed(3), +(0.25 * hp).toFixed(3)], fw: [+(0.5 * fp).toFixed(3), +(0.34 * fp).toFixed(3), +(0.2 * fp).toFixed(3)],
        floor: [Math.round(fl + 3), Math.round(fl + 0.22 * dp), Math.round(fl + 0.5 * dp)], depth: [Math.round(dp), Math.round(0.82 * dp), Math.round(0.55 * dp)],
        steps: [st, st, 2] });
      nSide++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 2. Line features (Catmull-Rom on the sphere, params interpolated per vertex).
//   'rift'   hw top half-width km, fw floor half-width km, floor m (abs), lift m (shoulder uplift),
//            passes [[t 0..1, halfLenKm]] where the floor rises to a saddle and the trough narrows.
//   'canyon' hw, fw, floor, depth (m below the rim), steps (bench count), river (m)
//   'valley' hw, fw, floor, depth, shape (0 V gorge .. 1 U glacial), river (m)
//   'range'  hw km, height m, passes [[t, halfLenKm, depthFrac]]
//   'oldbed' hw km, height m (raised old river bed / levee ridge)
//   'inlet'  hw km (drowned estuary: sea where |d| < hw), depth m
// ---------------------------------------------------------------------------------------------
export const LINES = [
  // ---- 赤裂谷 (A03 / shot 01): from the east-sea coast NNE across the ZR1 city fabric; two passes
  //      where the SE and NE city arms squeeze across as narrow corridors.
  { id: 'rift', kind: 'rift',
    pts: [[121.6, 2.6], [122.6, 6.6], [123.9, 10.6], [125.3, 14.6], [127.0, 18.8], [129.2, 23.2], [131.8, 27.6], [135.0, 31.6], [138.9, 35.2], [143.4, 38.0]],
    hw: [16, 30, 40, 46, 50, 52, 50, 46, 38, 24], fw: [4, 7.5, 10, 12, 13, 13.5, 13, 11, 8, 4],
    floor: [-60, 60, 180, 300, 420, 540, 680, 840, 1020, 1260], lift: [300, 700, 1000, 1150, 1250, 1300, 1250, 1100, 850, 400],
    passes: [[0.36, 22], [0.69, 18]] },
  { id: 'rift-e', kind: 'rift',
    pts: [[127.0, 18.8], [130.4, 19.6], [134.0, 20.8], [137.6, 22.6]],
    hw: [30, 26, 20, 11], fw: [7.5, 6, 4.5, 2], floor: [420, 520, 660, 860], lift: [700, 650, 500, 250], passes: [] },

  // ---- 西陆峡廊 ZR2 (Z04): a meandering canyon system through the ZR2 star down to the west sea.
  //      Main stem + dendritic tributaries (junctions spread along the stem, acute angles pointing
  //      downstream, matching floors / rims at every confluence); stepped walls (benches for
  //      terraced streets), a river on the floor. Built by zr2Canyons() below: the control points
  //      are fractally meandered at load (frac), width varies along the canyon (relief.js).
  ...zr2Canyons(),

  // ---- OX2 西峡集水地: narrow gorges with steep walls draining E into the west sea
  { id: 'ox2-g1', kind: 'valley', pts: [[-112.6, -13.4], [-110.4, -11.4], [-108.2, -9.6], [-106.2, -8.0], [-104.6, -6.6], [-103.4, -5.4], [-102.4, -4.6]],
    hw: [0.55, 0.7, 0.85, 0.95, 1.05, 1.1, 1.15], fw: [0.05, 0.07, 0.09, 0.11, 0.12, 0.13, 0.14], floor: [760, 590, 430, 280, 150, 50, -15],
    depth: [300, 360, 400, 420, 420, 380, 300], shape: [0, 0, 0, 0, 0, 0, 0], river: [10, 14, 18, 24, 30, 36, 40] },
  { id: 'ox2-g1a', kind: 'valley', pts: [[-111.4, -5.6], [-109.4, -6.6], [-107.6, -7.4], [-106.2, -8.0]],
    hw: [0.4, 0.55, 0.65, 0.75], fw: [0.04, 0.05, 0.07, 0.08], floor: [560, 450, 350, 280], depth: [220, 280, 330, 380], shape: [0, 0, 0, 0], river: [6, 9, 12, 15] },
  { id: 'ox2-g1b', kind: 'valley', pts: [[-105.6, -14.6], [-106.6, -12.6], [-107.6, -10.8], [-108.2, -9.6]],
    hw: [0.4, 0.55, 0.65, 0.75], fw: [0.04, 0.05, 0.07, 0.08], floor: [700, 600, 500, 430], depth: [220, 280, 330, 380], shape: [0, 0, 0, 0], river: [6, 9, 12, 15] },
  { id: 'ox2-g2', kind: 'valley', pts: [[-108.0, -1.6], [-106.4, -0.2], [-104.8, 1.0], [-103.4, 2.0], [-102.3, 2.6]],
    hw: [0.5, 0.65, 0.8, 0.9, 1.0], fw: [0.05, 0.06, 0.08, 0.1, 0.12], floor: [520, 380, 230, 90, -15], depth: [260, 320, 360, 360, 300], shape: [0, 0, 0, 0, 0], river: [8, 12, 18, 24, 30] },
  { id: 'ox2-g3', kind: 'valley', pts: [[-109.6, 5.8], [-107.6, 6.6], [-105.6, 7.2], [-103.8, 7.8]],
    hw: [0.5, 0.65, 0.8, 0.9], fw: [0.05, 0.06, 0.08, 0.1], floor: [460, 300, 140, -15], depth: [240, 300, 330, 300], shape: [0, 0, 0, 0], river: [8, 12, 18, 24] },

  // ---- ZR6 南纬穹谷: E-W glacial troughs so that sunny north-facing slopes exist
  { id: 'zr6-u1', kind: 'valley', pts: [[-128, -60.8], [-118, -61.5], [-108, -61.8], [-98, -61.6], [-88, -60.9]],
    hw: [9, 12, 13, 12, 8], fw: [2.4, 3.6, 4.2, 3.6, 2.0], floor: [900, 820, 780, 800, 880], depth: [800, 1000, 1100, 1000, 760], shape: [1, 1, 1, 1, 1], river: [0, 0, 0, 0, 0] },
  { id: 'zr6-u2', kind: 'valley', pts: [[-126, -64.6], [-116, -65.1], [-106, -65.2], [-96, -64.9], [-86, -64.2]],
    hw: [9, 12, 14, 12, 8], fw: [2.4, 3.6, 4.6, 3.6, 2.0], floor: [980, 900, 860, 880, 960], depth: [820, 1040, 1150, 1040, 780], shape: [1, 1, 1, 1, 1], river: [0, 0, 0, 0, 0] },
  { id: 'zr6-u3', kind: 'valley', pts: [[-122, -68.4], [-112, -68.8], [-102, -68.7], [-92, -68.1]],
    hw: [8, 10, 10, 7], fw: [2.0, 3.0, 3.0, 1.8], floor: [1080, 1000, 990, 1060], depth: [760, 900, 900, 700], shape: [1, 1, 1, 1], river: [0, 0, 0, 0] },

  // ---- ranges that break city bands; red-rock passes carry the corridors (prompt §1)
  { id: 'range-zr3s', kind: 'range', pts: [[-31.0, 6.0], [-23.0, 8.4], [-15.0, 9.4], [-7.0, 8.6], [1.0, 6.4]],
    hw: [42, 56, 60, 56, 42], height: [2300, 3000, 3300, 3000, 2300], passes: [[0.345, 15, 0.86], [0.66, 13, 0.84]] },
  { id: 'range-zr2n', kind: 'range', pts: [[-128.0, 46.6], [-118.0, 47.8], [-108.0, 48.4], [-98.0, 50.2]],
    hw: [50, 62, 62, 48], height: [2400, 3200, 3200, 2400], passes: [[0.43, 14, 0.82], [0.73, 13, 0.82]] },
  { id: 'range-zr5e', kind: 'range', pts: [[112.6, -36.6], [113.6, -40.6], [114.0, -44.6], [114.6, -48.6], [116.0, -52.6]],
    hw: [40, 52, 56, 52, 40], height: [2200, 2900, 3100, 2900, 2200], passes: [[0.49, 14, 0.85]] },
  { id: 'range-zr1w', kind: 'range', pts: [[108.0, 33.0], [110.4, 28.4], [112.0, 23.4], [113.4, 18.6], [115.0, 14.0]],
    hw: [40, 52, 56, 52, 38], height: [2300, 3000, 3400, 3000, 2200], passes: [[0.49, 15, 0.86]] },
  { id: 'range-zr6n', kind: 'range', pts: [[-124.0, -55.0], [-114.0, -56.6], [-104.0, -57.0], [-94.0, -56.2], [-84.0, -54.6]],
    hw: [40, 50, 52, 50, 40], height: [2200, 2900, 3100, 2900, 2200], passes: [[0.375, 13, 0.85], [0.7, 12, 0.85]] },
  { id: 'range-zr4n', kind: 'range', pts: [[150.0, 44.0], [157.0, 46.6], [165.0, 48.0]],
    hw: [48, 60, 46], height: [2600, 3400, 2600], passes: [] },

  // ---- OX1 东泽: higher old river beds splitting the wide waters into branches
  { id: 'ox1-bed1', kind: 'oldbed', pts: [[101.4, 1.6], [102.0, 3.4], [101.6, 5.2], [102.4, 6.8], [101.9, 8.6], [102.6, 10.4]], hw: [2.4, 2.6, 2.6, 2.4, 2.2, 1.8], height: [24, 32, 36, 34, 30, 24] },
  { id: 'ox1-bed2', kind: 'oldbed', pts: [[106.8, 2.0], [106.2, 3.8], [107.0, 5.6], [106.4, 7.4], [107.2, 9.2], [106.8, 11.0]], hw: [2.0, 2.2, 2.4, 2.2, 2.0, 1.6], height: [22, 28, 32, 30, 26, 20] },
  { id: 'ox1-bed3', kind: 'oldbed', pts: [[104.2, 5.4], [104.9, 6.8], [104.3, 8.2], [105.1, 9.8]], hw: [1.8, 1.9, 1.8, 1.5], height: [22, 26, 24, 18] },
  { id: 'ox1-bed4', kind: 'oldbed', pts: [[96.6, 4.0], [98.0, 5.4], [97.6, 7.2], [98.6, 8.8]], hw: [1.6, 1.8, 1.7, 1.4], height: [20, 24, 22, 18] },
  { id: 'ox1-bed5', kind: 'oldbed', pts: [[109.4, 2.4], [109.0, 4.2], [109.8, 6.0], [109.3, 7.8]], hw: [1.5, 1.7, 1.7, 1.4], height: [18, 22, 22, 16] },

  // ---- OX1 东泽: drowned estuaries (multi-branched sea inlets) reaching into the coastal lowland
  { id: 'ox1-in1', kind: 'inlet', pts: [[104.0, -0.2], [104.3, 2.0], [104.2, 4.0], [104.1, 5.6], [103.6, 7.0], [103.9, 8.6]], hw: [11, 9, 7, 5.5, 3.8, 2.0], depth: [18, 14, 10, 8, 6, 3] },
  { id: 'ox1-in1a', kind: 'inlet', pts: [[104.2, 4.6], [105.4, 5.4], [105.8, 6.8], [106.0, 8.2]], hw: [4.5, 3.6, 2.6, 1.4], depth: [9, 7, 5, 3] },
  { id: 'ox1-in1b', kind: 'inlet', pts: [[104.0, 6.0], [102.8, 6.4], [102.9, 7.9], [102.3, 9.2]], hw: [3.6, 3.0, 2.2, 1.2], depth: [8, 6, 4, 2.5] },
  { id: 'ox1-in2', kind: 'inlet', pts: [[99.8, 0.4], [99.7, 1.9], [99.6, 3.2], [99.0, 4.6], [99.5, 6.0], [99.2, 7.4]], hw: [8, 7, 5.5, 4.2, 3.0, 1.6], depth: [14, 12, 9, 7, 5, 3] },
  { id: 'ox1-in2a', kind: 'inlet', pts: [[99.2, 4.2], [100.6, 5.0], [100.7, 6.6]], hw: [3.2, 2.5, 1.4], depth: [7, 5, 3] },
  { id: 'ox1-in3', kind: 'inlet', pts: [[108.2, -0.2], [108.1, 1.4], [108.0, 2.9], [108.5, 4.4], [108.1, 5.8]], hw: [7, 6, 4.6, 3.2, 1.6], depth: [13, 11, 8, 6, 3] },
  { id: 'ox1-in3a', kind: 'inlet', pts: [[108.3, 3.6], [107.4, 4.6], [107.7, 6.0]], hw: [2.8, 2.2, 1.2], depth: [6, 4, 2.5] },
  { id: 'ox1-in4', kind: 'inlet', pts: [[95.6, -1.2], [95.5, 1.0], [95.6, 2.6], [95.2, 4.2], [95.8, 5.6], [95.3, 6.8]], hw: [6, 5.5, 5, 3.8, 2.6, 1.3], depth: [12, 11, 10, 7, 5, 3] },
];

// ---------------------------------------------------------------------------------------------
// 3. Regions: centre [lon, lat], semi-axes [a (along rot), b] km, rot (deg, ccw from east)
// ---------------------------------------------------------------------------------------------
export const REGIONS = {
  zr3Plateau: { c: [-15.0, 22.5], ab: [700, 600], rot: 8 },       // 中陆高原: high tableland + escarpment
  h1Highland: { c: [150.0, 36.5], ab: [820, 460], rot: 22 },      // 右侧中纬度连续裸岩高地 (shot 01)
  ox5Table: { c: [-37.0, -21.0], ab: [1350, 1150], rot: -18 },    // 南台地: stepped tableland east of the west sea
  ox4Low: { c: [45.0, 67.0], ab: [1100, 560], rot: 0 },           // 北冠冰缘 proglacial lowland
  ox6Frost: { c: [-168.0, -66.0], ab: [1450, 680], rot: 0 },      // 南极补给链 frost plains + rock islands
  zr6Valleys: { c: [-106.0, -64.6], ab: [950, 560], rot: 0 },     // 南纬穹谷 domes between the troughs
  ox1Low: { c: [103.0, 6.0], ab: [950, 520], rot: 0 },            // 东泽 coastal lowland
  ox3Low: { c: [-130.5, 22.6], ab: [700, 380], rot: -28 },        // 赤岸 low tidal coast around the inland sea
  ox2Plateau: { c: [-106.5, -5.0], ab: [700, 560], rot: 60 },     // 西峡 dissected plateau
  zr4Arch: { c: [163.0, 2.0], ab: [1750, 820], rot: 42 },         // 晨曦群岛 island sea (crosses the date line)
  lavaW: { c: [-156.0, -26.0], ab: [700, 480], rot: 30 },         // dark basalt plains
  lavaE: { c: [28.0, -21.0], ab: [560, 420], rot: -15 },
  volcano: { c: [-158.0, 32.0], ab: [300, 300], rot: 0 },         // 赤冕 shield volcano (orbital landmark)
  zr2Plateau: { c: [-104.0, 33.0], ab: [1050, 1250], rot: 75 },   // 西陆 canyon plateau
  zr5Basin: { c: [102.8, -40.3], ab: [330, 300], rot: 0 },        // 南盆湾 sheltered deep basin
};

// ---------------------------------------------------------------------------------------------
// 4. Landmark craters [lon, lat, radiusKm, age 0 fresh..1 degraded, kind 0 natural / 1 city park]
// ---------------------------------------------------------------------------------------------
export const FIXED_CRATERS = [
  // green crater parks inside the cities (A03)
  [112.6, 28.6, 11, 0.55, 1], [121.4, 19.2, 7, 0.45, 1], [116.4, 24.6, 5, 0.5, 1],
  [-19.6, 17.6, 9, 0.5, 1], [-9.6, 27.2, 6, 0.45, 1], [-109.8, 30.2, 6, 0.5, 1],
  [98.2, -45.6, 7, 0.5, 1], [-100.6, -61.2, 6, 0.55, 1], [167.6, 10.6, 4, 0.5, 1],
  // large natural basins / landmark craters
  [60.0, -56.0, 190, 0.9, 0], [-62.0, -60.5, 150, 0.86, 0], [168.0, 50.0, 110, 0.82, 0], [-40.0, 46.0, 105, 0.8, 0],
  [-150.0, -45.0, 120, 0.88, 0], [10.0, -60.0, 95, 0.78, 0], [80.0, 40.0, 85, 0.72, 0], [-176.0, 36.0, 70, 0.6, 0],
  [20.5, -36.0, 34, 0.06, 0], [-138.0, -38.5, 29, 0.1, 0], [140.0, 47.5, 22, 0.05, 0], [-62.0, 30.0, 26, 0.18, 0],
  [36.0, 8.0, 40, 0.32, 0], [-30.0, -50.0, 60, 0.66, 0], [150.0, -60.0, 80, 0.78, 0], [-80.0, 62.0, 55, 0.6, 0],
  [-70.0, 12.0, 48, 0.4, 0], [70.0, 20.0, 36, 0.25, 0],
];

// =============================================================================================
// Precomputation: subdivided great-circle polylines + 1° bin index
// =============================================================================================
function unit(lon, lat) {
  const la = lat * DEG, lo = lon * DEG, c = Math.cos(la);
  return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)];
}
function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
// deterministic integer hash -> [0,1) (local: layout.js has no other dependencies)
function lhash(a, b, c) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/**
 * Control polygon of a line: authored vertices (kept exactly: junctions stay put) plus, for lines
 * with `frac`, fractal meander midpoints (each level displaces every segment midpoint sideways by
 * amp x segment length, mostly alternating sides, amp decaying per level). Returns unit vectors and
 * the fractional authored-vertex parameter of every control point.
 */
function controlPolygon(L) {
  let P = L.pts.map((p) => unit(p[0], p[1]));
  let f = L.pts.map((_, i) => i);
  const fr = L.frac;
  if (!fr) return { P, f };
  let amp = fr.amp;
  for (let lvl = 0; lvl < fr.levels; lvl++) {
    const P2 = [P[0]], f2 = [f[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const m = normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
      const len = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const nrm = normalize([m[1] * t[2] - m[2] * t[1], m[2] * t[0] - m[0] * t[2], m[0] * t[1] - m[1] * t[0]]);
      const h1 = lhash(fr.seed, lvl * 4096 + i, 0x51), h2 = lhash(fr.seed, lvl * 4096 + i, 0x7a);
      const sgn = (h2 < 0.78 ? ((i + lvl + fr.seed) & 1) : (h2 < 0.89 ? 0 : 1)) ? 1 : -1;
      const disp = amp * len * sgn * (0.5 + 0.5 * h1);
      P2.push(normalize([m[0] + nrm[0] * disp, m[1] + nrm[1] * disp, m[2] + nrm[2] * disp]), b);
      f2.push((f[i] + f[i + 1]) * 0.5, f[i + 1]);
    }
    P = P2; f = f2; amp *= fr.decay || 0.55;
  }
  return { P, f };
}
function splinePts(L, stepM) {
  const { P, f } = controlPolygon(L);
  const out = [], tPar = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const ang = Math.acos(Math.min(1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]));
    const n = Math.max(1, Math.ceil((ang * R) / stepM));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const v = [0, 0, 0];
      for (let c = 0; c < 3; c++) v[c] = 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      out.push(normalize(v)); tPar.push(f[i] + (f[i + 1] - f[i]) * t);
    }
  }
  out.push(P[P.length - 1]); tPar.push(f[f.length - 1]);
  return { pts: out, vpar: tPar };
}

const PARAM_KEYS = ['hw', 'fw', 'floor', 'lift', 'depth', 'steps', 'river', 'shape', 'height'];
export const LINE_DATA = [];
let SEG = null;
const SEG_STRIDE = 16; // ax ay az bx by bz nx ny nz tx ty tz len cum lineIdx vertexIdx
let BIN = null, BIN_OFF = null;
export const LINE_BY_ID = {};

function build() {
  const segs = [];
  for (let li = 0; li < LINES.length; li++) {
    const L = LINES[li];
    const { pts, vpar } = splinePts(L, L.frac ? 2000 : 6000);
    const params = {};
    for (const k of PARAM_KEYS) {
      if (!L[k]) continue;
      const arr = new Float64Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const f = vpar[i], i0 = Math.min(L[k].length - 1, Math.floor(f)), i1 = Math.min(L[k].length - 1, i0 + 1), t = f - i0;
        // smooth (C1) interpolation of the authored per-vertex parameters
        const s = t * t * (3 - 2 * t);
        arr[i] = L[k][i0] * (1 - s) + L[k][i1] * s;
      }
      params[k] = arr;
    }
    let cum = 0; const segStart = segs.length;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = normalize([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
      const tng = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
      const len = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * R;
      segs.push([a[0], a[1], a[2], b[0], b[1], b[2], n[0], n[1], n[2], tng[0], tng[1], tng[2], len, cum, li, i]);
      cum += len;
    }
    const maxHw = Math.max(...(L.hw || [10]));
    // reach covers every effect of the feature (compact supports in field.js / relief.js)
    const reach = L.kind === 'rift' ? maxHw * 3.2 + 30 : L.kind === 'range' ? maxHw * 1.6 + 30
      : L.kind === 'oldbed' ? maxHw * 2.5 + 3 : L.kind === 'inlet' ? maxHw * 1.6 + 8 : L.kind === 'canyon' ? maxHw * 6 + 8 : maxHw * 4 + 6;
    const ld = { id: L.id, kind: L.kind, line: L, pts, params, segStart, nSeg: pts.length - 1, totalLen: cum, reachKm: reach, passes: L.passes || [] };
    LINE_DATA.push(ld);
    LINE_BY_ID[L.id] = ld;
  }
  SEG = new Float64Array(segs.length * SEG_STRIDE);
  segs.forEach((s, i) => SEG.set(s, i * SEG_STRIDE));
  const lists = new Array(360 * 180);
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si]; const ld = LINE_DATA[s[14]];
    const la1 = Math.asin(s[1]) / DEG, lo1 = Math.atan2(s[0], s[2]) / DEG;
    const la2 = Math.asin(s[4]) / DEG, lo2 = Math.atan2(s[3], s[5]) / DEG;
    const rDeg = ld.reachKm / KM_PER_DEG + 0.05;
    const latMin = Math.max(-90, Math.min(la1, la2) - rDeg), latMax = Math.min(90, Math.max(la1, la2) + rDeg);
    const cmin = Math.max(0.05, Math.cos(Math.max(Math.abs(latMin), Math.abs(latMax)) * DEG));
    let dl = lo2 - lo1; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    const loA = Math.min(lo1, lo1 + dl) - rDeg / cmin, loB = Math.max(lo1, lo1 + dl) + rDeg / cmin;
    for (let la = Math.floor(latMin); la <= Math.floor(latMax); la++) {
      const y = Math.min(179, Math.max(0, la + 90));
      for (let lo = Math.floor(loA); lo <= Math.floor(loB); lo++) {
        const x = ((lo + 180) % 360 + 360) % 360;
        const k = y * 360 + x;
        (lists[k] || (lists[k] = [])).push(si);
      }
    }
  }
  BIN_OFF = new Int32Array(360 * 180 + 1);
  let tot = 0;
  for (let k = 0; k < lists.length; k++) { BIN_OFF[k] = tot; tot += lists[k] ? lists[k].length : 0; }
  BIN_OFF[lists.length] = tot;
  BIN = new Int32Array(tot);
  for (let k = 0; k < lists.length; k++) if (lists[k]) BIN.set(lists[k], BIN_OFF[k]);
}
build();

// ---------------------------------------------------------------------------------------------
// Query: nearest segment per line within reach (typed arrays, no allocation)
// ---------------------------------------------------------------------------------------------
export const MAXHITS = 16;
export const HIT = {
  n: 0,
  line: new Int32Array(MAXHITS),   // index into LINE_DATA
  d: new Float64Array(MAXHITS),    // signed cross-track distance (m), + = left of travel
  t: new Float64Array(MAXHITS),    // along-line distance from the start (m)
  v: new Float64Array(MAXHITS),    // fractional subdivided-vertex parameter
};

export function queryLines(px, py, pz, lat, lon) {
  let y = Math.floor(lat + 90); if (y > 179) y = 179; else if (y < 0) y = 0;
  let x = Math.floor(lon + 180); if (x > 359) x = 0; else if (x < 0) x = 359;
  const k = y * 360 + x;
  const o0 = BIN_OFF[k], o1 = BIN_OFF[k + 1];
  let n = 0;
  for (let o = o0; o < o1; o++) {
    const si = BIN[o], b = si * SEG_STRIDE;
    const li = SEG[b + 14];
    const ld = LINE_DATA[li];
    const s = px * SEG[b + 6] + py * SEG[b + 7] + pz * SEG[b + 8];
    const ca = px * SEG[b] + py * SEG[b + 1] + pz * SEG[b + 2];
    const ta = px * SEG[b + 9] + py * SEG[b + 10] + pz * SEG[b + 11];
    const len = SEG[b + 12];
    let along = Math.atan2(ta, ca) * R;
    let dist;
    if (along < 0) {
      const dx = px - SEG[b], dy = py - SEG[b + 1], dz = pz - SEG[b + 2];
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz) * R; along = 0;
    } else if (along > len) {
      const dx = px - SEG[b + 3], dy = py - SEG[b + 4], dz = pz - SEG[b + 5];
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz) * R; along = len;
    } else {
      dist = Math.abs(Math.asin(s < -1 ? -1 : s > 1 ? 1 : s)) * R;
    }
    if (dist > ld.reachKm * 1000) continue;
    const dsign = s >= 0 ? dist : -dist;
    let j = 0;
    for (; j < n; j++) if (HIT.line[j] === li) break;
    if (j < n) { if (Math.abs(HIT.d[j]) <= dist) continue; }
    else { if (n >= MAXHITS) continue; n++; }
    HIT.line[j] = li; HIT.d[j] = dsign; HIT.t[j] = SEG[b + 13] + along;
    HIT.v[j] = SEG[b + 15] + (len > 0 ? along / len : 0);
  }
  HIT.n = n;
  return n;
}

/** interpolate a per-vertex parameter of line ld at fractional vertex v */
export function lineParam(ld, key, v) {
  const a = ld.params[key];
  if (!a) return 0;
  const i0 = Math.floor(v), t = v - i0;
  if (i0 >= a.length - 1) return a[a.length - 1];
  if (i0 < 0) return a[0];
  return a[i0] + (a[i0 + 1] - a[i0]) * t;
}

/** direction of travel (unit, ECEF) of line ld near vertex v -> out[0..2] */
export function lineTangent(ld, v, out) {
  const i = Math.max(0, Math.min(ld.nSeg - 1, Math.floor(v)));
  const b = (ld.segStart + i) * SEG_STRIDE;
  out[0] = SEG[b + 9]; out[1] = SEG[b + 10]; out[2] = SEG[b + 11];
  return out;
}
/** left normal (unit, ECEF) of line ld near vertex v -> out[0..2] (direction of +d) */
export function lineNormal(ld, v, out) {
  const i = Math.max(0, Math.min(ld.nSeg - 1, Math.floor(v)));
  const b = (ld.segStart + i) * SEG_STRIDE;
  out[0] = SEG[b + 6]; out[1] = SEG[b + 7]; out[2] = SEG[b + 8];
  return out;
}
/**
 * left normal blended across segment joints (continuous in v; lineNormal is piecewise constant and made the
 * gully steering of canyon / rift walls jump at every subdivided vertex)
 */
export function lineNormalSmooth(ld, v, out) {
  const i = Math.max(0, Math.min(ld.nSeg - 1, Math.floor(v)));
  const t = v - i;
  const j = t < 0.5 ? i - 1 : i + 1;
  const w = t < 0.5 ? 0.5 - t : t - 0.5;
  const b = (ld.segStart + i) * SEG_STRIDE;
  let x = SEG[b + 6], y = SEG[b + 7], z = SEG[b + 8];
  if (j >= 0 && j < ld.nSeg && w > 0) {
    const c = (ld.segStart + j) * SEG_STRIDE;
    x = x * (1 - w) + SEG[c + 6] * w; y = y * (1 - w) + SEG[c + 7] * w; z = z * (1 - w) + SEG[c + 8] * w;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
  }
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}
/** point on line ld at fractional vertex v (unit vector) -> out */
export function linePoint(ld, v, out) {
  const P = ld.pts;
  const i = Math.max(0, Math.min(P.length - 2, Math.floor(v))), t = Math.min(1, Math.max(0, v - i));
  const a = P[i], b = P[i + 1];
  let x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
  const l = Math.hypot(x, y, z); out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Region blobs: precomputed centre + tangent axes; normalised elliptic (gnomonic) distance
// ---------------------------------------------------------------------------------------------
export const REGION_DATA = {};
for (const [name, r] of Object.entries(REGIONS)) {
  const c = unit(r.c[0], r.c[1]);
  const la = r.c[1] * DEG, lo = r.c[0] * DEG;
  const e = [Math.cos(lo), 0, -Math.sin(lo)];
  const nn = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)];
  const rr = (r.rot || 0) * DEG, cr = Math.cos(rr), sr = Math.sin(rr);
  const ax = [e[0] * cr + nn[0] * sr, e[1] * cr + nn[1] * sr, e[2] * cr + nn[2] * sr];
  const ay = [-e[0] * sr + nn[0] * cr, -e[1] * sr + nn[1] * cr, -e[2] * sr + nn[2] * cr];
  REGION_DATA[name] = { name, c, ax, ay, a: r.ab[0] * 1000, b: r.ab[1] * 1000 };
}
/** normalised elliptic distance of p from the region centre (1 = on the ellipse); 99 far away */
export function regionDist(rd, px, py, pz) {
  const dot = px * rd.c[0] + py * rd.c[1] + pz * rd.c[2];
  if (dot < 0.25) return 99;
  const u = (px * rd.ax[0] + py * rd.ax[1] + pz * rd.ax[2]) * R / dot;
  const v = (px * rd.ay[0] + py * rd.ay[1] + pz * rd.ay[2]) * R / dot;
  return Math.sqrt((u / rd.a) * (u / rd.a) + (v / rd.b) * (v / rd.b));
}
/** gnomonic local coordinates (m) of p in the region frame: out[0] along a, out[1] along b */
export function regionUV(rd, px, py, pz, out) {
  const dot = px * rd.c[0] + py * rd.c[1] + pz * rd.c[2];
  const inv = dot > 1e-6 ? R / dot : 0;
  out[0] = (px * rd.ax[0] + py * rd.ax[1] + pz * rd.ax[2]) * inv;
  out[1] = (px * rd.ay[0] + py * rd.ay[1] + pz * rd.ay[2]) * inv;
  return out;
}

export const FIXED_CRATER_DATA = FIXED_CRATERS.map(([lon, lat, rk, age, kind], i) => {
  const u = unit(lon, lat);
  return { i, x: u[0], y: u[1], z: u[2], r: rk * 1000, age, kind, lon, lat };
});
