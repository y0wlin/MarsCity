// Megastructure landforms (pure, worker-safe). OWNER: terrain-fn agent.
//  G01 东海分段潮堤 (the designed bay shoreline is a coast-metric override in sitezones.js):
//      dredged calm harbour (-12..-15 m), shelf crest under the barrier arc (-9.5 m),
//      outer slope and a -32 m deep-water channel through the 560 m navigation mouth; (fix round 3)
//      quay platforms +2.8..3.6 m along the harbour shore (300-600 m deep, berth pockets at the quay
//      wall, graded ramp to the natural terrace behind) instead of the coastal sea cliff.
//  G02 南台地水阶: re-entrant canyon cut ~15 km back into the OX5 step-2 escarpment: six flat-floored
//      reservoir basins below their levels, layered cliff walls (right bank) and benched slopes (left
//      bank; fix round 3: irregular benches only in the irrigated-terrace belt, natural gullied slope
//      above), pale old-water-line bands, dam gorges with ~60 m step drops, a dry head gully and a
//      natural canyon mouth below dam 6 opening onto the plain with the outflow channel.
import { SITES, unitToLocal, g01ToUV, g01ShoreV, g01ArcV, G01_GEO, g02Project, g02HalfWidth, g02Index, g02Neck, G02_DAMS, G02_LEVELS, G02_GEO, G02_AXIS } from '../sites.js';
import { smoothstep, clamp, makeNoise, bandW } from './noise.js';
import { installSiteCarver } from './waterbodies.js';

const DEG = Math.PI / 180;
const unitOf = (s) => [Math.cos(s.lat * DEG) * Math.sin(s.lon * DEG), Math.sin(s.lat * DEG), Math.cos(s.lat * DEG) * Math.cos(s.lon * DEG)];
const G1 = SITES.tidalBarrier, G2 = SITES.waterStairs;
const C1 = unitOf(G1), C2 = unitOf(G2);
const LIM1 = Math.cos(18000 / 3389500), LIM2 = Math.cos(17000 / 3389500);
const LOC = {}, UV = {}, PJ = {};
const CH = G1.channel.points;
const NG = makeNoise(801);

function distToPolyline(P, x, z) {
  let best = 1e18;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0], az = P[i][1], ex = P[i + 1][0] - ax, ez = P[i + 1][1] - az;
    const l2 = ex * ex + ez * ez;
    let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + ex * t - x, dz = az + ez * t - z, d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

// ---------------------------------------------------------------------------------------------
// G01 harbour quays (fix round 3, T1): along the protected harbour shore the land is a quay platform +2.8..3.6 m
// a.s.l., 300-600 m deep (east cargo flank widest, bay-head ferry / promenade quays, west residential waterfront
// narrowest), with a quay wall at the waterline (berth pocket on the sea side: cargo 13 m, bay head 8 m, west 5 m)
// and a graded ramp up to the natural terrace behind. It replaces the coastal sea-cliff profile (relief.js `cliffy`)
// that stood 25-90 m high within 20-60 m of the water. Fades out toward the barrier ends (the headlands keep their
// natural shore). Distances use the coast metric (c = 0 is the true waterline) over its gradient (~perpendicular m).
// ---------------------------------------------------------------------------------------------
const QY = { k: 0, g: 1, width: 0, level: 0, berth: 0, berthW: 0, ramp: 0 };
function quayAt(u) {
  QY.k = 1 - smoothstep(4600, 5150, Math.abs(u));
  if (QY.k <= 0) return QY;
  // side weights (urban/harbour.js sides: 'cargo' u > 2600, 'west' u < -2600, 'inner' between)
  const kE = smoothstep(1900, 3300, u), kW = smoothstep(-1900, -3300, u), kI = 1 - kE - kW;
  const n = NG.n3(u / 1500, 3.7, 0.4), n2 = NG.n3(u / 520, -1.9, 2.2);
  QY.width = 550 * kE + 385 * kI + 335 * kW + (35 * kE + 35 * kI + 20 * kW) * n + 8 * n2;
  QY.level = 3.4 * kE + 2.9 * kI + 3.0 * kW + 0.15 * n;
  QY.berth = 13 * kE + 8 * kI + 5 * kW;
  QY.berthW = 140 * kE + 90 * kI + 45 * kW;
  QY.ramp = 480 + 90 * NG.n3(u / 2300, 8.1, -3.3);
  // |grad c| of the designed coast metric (sitezones.g01Coast: c ~ 0.95 (shoreV - v)), so c / g ~ perpendicular metres
  const s = (g01ShoreV(u + 20) - g01ShoreV(u - 20)) / 40;
  QY.g = 0.95 * Math.sqrt(1 + s * s);
  return QY;
}

/** land side of the G01 harbour shore: quay platform + quay wall + graded ramp to the natural terrace */
function quayG01(F, h, mw, M, W, u, v) {
  if (v < g01ShoreV(u) - 2600) return h;
  const Q = quayAt(u);
  if (Q.k <= 0) return h;
  const dq = F.c / Q.g;                                                   // ~ metres inland of the waterline
  if (dq > Q.width + Q.ramp) return h;
  const wallW = Math.max(2.5, 1.5 * mw);
  const plat = (Q.level + 0.35 * smoothstep(0, Q.width, dq)) * smoothstep(0, wallW, dq);
  const kr = smoothstep(Q.width, Q.width + Q.ramp, dq);
  let t = plat + (h - plat) * kr;
  if (W.type > 0) t = Math.min(t, h);                                     // keep carved river / lake channels
  const k = Q.k;
  if (M) {
    const kq = k * (1 - kr);                                              // built quay: no sea cliff / beach / scree
    const keep = 1 - kq;
    M.cliff *= keep; M.strataW *= keep; M.rock *= keep; M.beach *= keep; M.scree *= keep; M.talus *= keep;
  }
  return h + (t - h) * k;
}

function carveG01(F, h, mw, M, W) {
  unitToLocal(G1, F.x, F.y, F.z, LOC);
  const r = Math.hypot(LOC.x, LOC.z);
  if (r > 16500) return h;
  g01ToUV(LOC.x, LOC.z, UV);
  const u = UV.u, v = UV.v;
  if (F.c >= 0) return r < 10500 ? quayG01(F, h, mw, M, W, u, v) : h;
  const shoreV = g01ShoreV(u), arcV = g01ArcV(u);
  const half = G01_GEO.arc.half;
  const off = v - shoreV;
  let depth;
  const inside = Math.abs(u) < half && v < arcV;
  if (inside) {
    depth = Math.min(15, 1.8 + off * 0.0058);                           // dredged harbour basin
    // berth pocket along the quays (T1): deep water right at the quay wall
    const Q = quayAt(u);
    if (Q.k > 0) {
      const dqs = -F.c / Q.g, wallW = Math.max(2.5, 1.5 * mw);
      if (dqs < Q.berthW + 260) {
        const bd = Q.berth * smoothstep(0, wallW, dqs) * (1 - smoothstep(Q.berthW, Q.berthW + 260, dqs)) * Q.k;
        if (bd > depth) depth = bd;
      }
    }
  } else {
    const kEnd = smoothstep(half - 400, half + 1600, Math.abs(u));
    const dA = (v - arcV) * (1 - kEnd) + off * kEnd;
    depth = 9.5 + Math.max(0, dA - 120) * 0.0125;
    depth = Math.min(depth, 9.5 + Math.max(0, off) * 0.02);
  }
  if (Math.abs(u) < half + 300) {                                        // shelf crest under the caissons
    const dArc = v - arcV;
    depth += (9.5 - depth) * Math.exp(-(dArc * dArc) / (2 * 170 * 170));
  }
  const dc = distToPolyline(CH, LOC.x, LOC.z);                           // deep-water channel
  if (dc < 210 + 120) { const chD = dc < 210 ? 32 : 32 - (dc - 210) / 5; if (chD > depth) depth = chD; }
  const w = 1 - smoothstep(9500, 15500, r);
  if (M) M.seafloor = 1;
  if (inside) { W.type = 1; W.level = 0; W.id = 'G01-harbour'; W.kind = 'harbour'; }
  return h + (Math.min(-depth, -0.3) - h) * w;
}

// ---------------------------------------------------------------------------------------------
// G02
// ---------------------------------------------------------------------------------------------
// road benches (cut / fill batters) and town platforms: precomputed segment lists in site metres
const ROADS = G2.roads.map((r) => r.points);
const TOWNS = G2.towns;
const DAMS = G2.levels.map((L, j) => {
  const a = L.dam.a, b = L.dam.b, ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1;
  return { mx: (a[0] + b[0]) / 2, mz: (a[1] + b[1]) / 2, ux: ex / l, uz: ez / l, nx: -ez / l, nz: ex / l, hl: l / 2, neck: g02Neck(j), crest: L.dam.crest };
});
const RB = { d: 1e9, y: 0 };
function nearestRoad(x, z) {
  RB.d = 1e9;
  for (let q = 0; q < ROADS.length; q++) {
    const P = ROADS[q];
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i][0], az = P[i][2], ex = P[i + 1][0] - ax, ez = P[i + 1][2] - az;
      const l2 = ex * ex + ez * ez || 1;
      let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ax + ex * t - x, dz = az + ez * t - z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < RB.d) { RB.d = d; RB.y = P[i][1] + (P[i + 1][1] - P[i][1]) * t; }
    }
  }
  return RB;
}

/**
 * Natural G02 wall profiles (fix round 3, T2 / QQ-01). The designed profiles of sites.js g02WallRise (used by the
 * road layout) are kept as the MEAN ramp; the terrain no longer draws them as perfectly regular stairs:
 *  - right bank (layered cliffs): riser height varying along the valley (±30 %), ledges warped across the contours
 *    (terraced noise), talus apron of varying width (the cliff foot wanders in plan: spurs / re-entrants);
 *  - left bank (benched): benches only in the irrigated-terrace belt near the water (`belt`, the fields.farm terrace
 *    zone), with varying bench height / riser share and warped risers; elsewhere (and above the belt) a natural
 *    eroded slope (benches faded to the mean ramp, ±10 m undulation) cut by downslope gullies.
 * Every step term relaxes to its mean ramp where the risers are narrower than ~1.5 mw (no stair aliasing).
 * e = horizontal distance from the shore / canyon floor edge (m), s = axis station, (x, z) site metres.
 */
const sst = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function rightRise(e, i, s, x, z, mw) {
  if (e <= 0) return 0;
  const beach = 3.2 * sst(e / 22);
  const sh = 26 * NG.n3(x / 420, z / 420, 31.3) * bandW(420, mw) + 9 * NG.n3(x / 150, z / 150, 32.9) * bandW(150, mw);
  const talus = 18 * sst((e - 15 - 0.4 * sh) / 55);
  const tau = (26 + 6 * (i % 2)) * (1 + 0.32 * NG.n3(s / 900, i * 2.3, 33.7));
  const c = Math.max(0, e - 60 - sh) * 1.25;
  const warp = (11 * NG.n3(x / 520, z / 520, 34.1) * bandW(520, mw) + 4 * NG.n3(x / 180, z / 180, 35.9) * bandW(180, mw)) * sst(c / 30);
  // irregular ledge heights up the face: monotonic warp of the ledge index (d k / d q >= ~0.4), none at the cliff foot
  const q = (c + warp) / tau, k = q + 0.22 * NG.n3(q * 0.5, s / 800, 54.3) * sst(q);
  const mean = (k - 0.1) * tau;
  // band limit with the narrowest riser of the warped ledge index (d k / d q up to ~1.6)
  const relax = clamp((2.4 * mw) / (0.5 * tau / 1.25) - 0.5, 0, 1);
  let r = beach + talus + mean;
  if (relax < 1 && c > 0) {
    const ki = Math.floor(k), kf = k - ki;
    r += ((ki + sst((kf - 0.35) / 0.5)) * tau - mean) * (1 - relax);
  }
  return r;
}
function leftRise(e, i, s, x, z, mw, belt) {
  if (e <= 0) return 0;
  const beach = 3.2 * sst(e / 30);
  const g = Math.max(0, e - 40) * 0.24;
  const warp = (8 * NG.n3(x / 430, z / 430, 36.7) * bandW(430, mw) + 3.5 * NG.n3(x / 160, z / 160, 37.3) * bandW(160, mw)) * sst((e - 20) / 110);
  const tau = 9 * (1 + 0.42 * NG.n3(s / 700, i * 1.7, 38.1));
  const rf = 0.46 + 0.14 * NG.n3(x / 520, z / 520, 39.5);
  // terrace benches of irregular height (monotonic warp of the bench index) whose risers cross the contours (warp)
  const q = (g + warp) / tau, k = q + 0.25 * NG.n3(q * 0.42, s / 700, 53.1) * sst(q);
  const mean = (k + rf / 2 + 0.05 - 0.5) * tau;
  let r = beach + mean;
  if (belt > 0 && g > 0) {
    const relax = clamp((2.3 * mw) / ((rf * tau) / 0.24) - 0.5, 0, 1);
    if (relax < 1) {
      const ki = Math.floor(k), kf = k - ki;
      r += ((ki + sst((kf - (0.95 - rf)) / rf)) * tau - mean) * belt * (1 - relax);
    }
  }
  // gullies on the natural slope (fewer across the terraces): two octaves of meandering, branching grooves running down
  // the slope, deepening downslope, in patches (smooth stretches between gullied ones)
  const gb = bandW(110, mw);
  if (gb > 0 && e > 50) {
    const mask = smoothstep(-0.35, 0.45, NG.n3(x / 1300, z / 1300, 50.3));
    if (mask > 0) {
      // strong lateral meander of the grooves (they are not lines of constant s: canyon-mouth walls are straight)
      const sw = s + 150 * NG.n3(x / 430, z / 430, 51.7) * bandW(430, mw) + 55 * NG.n3(x / 160, z / 160, 52.3) * bandW(160, mw);
      const q1 = 1 - Math.abs(NG.n3(sw / 260, e / 620, 41.1 + i)) * 1.9;
      let cut = q1 > 0 ? 7 * q1 * q1 * q1 : 0;
      const gb2 = bandW(50, mw);
      if (gb2 > 0) { const q2 = 1 - Math.abs(NG.n3(sw / 105, e / 260, 47.9 + i)) * 2.2; if (q2 > 0) cut += 2.2 * q2 * q2 * q2 * gb2; }
      r -= cut * mask * smoothstep(50, 240, e) * (0.5 + 0.0025 * Math.min(e, 600)) * (1 - 0.75 * belt) * gb;
    }
  }
  return r;
}
/** bench belt of the left bank: the irrigated-terrace zone (sitezones.g02Farm terrace) with a wandering upper edge */
function benchBelt(i, s, e, x, z) {
  if (i < 1 || i > 5) return 0;
  const s0 = G02_DAMS[i - 1] * 1000, s1 = G02_DAMS[i] * 1000;
  const ends = smoothstep(s0 + 150, s0 + 600, s) * (1 - smoothstep(s1 - 500, s1 - 120, s));
  if (ends <= 0) return 0;
  return ends * (1 - smoothstep(400, 600, e + 110 * NG.n3(x / 900, z / 900, 42.7)));
}
function wallRiseNat(e, right, i, s, x, z, mw) {
  return right ? rightRise(e, i, s, x, z, mw) : leftRise(e, i, s, x, z, mw, benchBelt(i, s, e, x, z));
}

/**
 * Continuous axis station for the T2 terms. g02Project's nearest-segment station jumps by ~d x (turn angle) across the
 * vertex bisectors on the inner side of the axis bends (5-15 m at 0.5-1 km from the axis); anything that varies quickly
 * with s drew straight lines across the canyon-mouth wall there. Here the station comes from the interpolated vertex
 * normals (the point lies on the normal line through the axis point at s): continuous. Returns s (m from the head).
 */
const AXP = G02_AXIS.pts, AXC = G02_AXIS.cum, AXN = AXP.length;
const AXV = (() => {
  const seg = [];
  for (let i = 0; i < AXN - 1; i++) { const ex = AXP[i + 1][0] - AXP[i][0], ez = AXP[i + 1][1] - AXP[i][1], l = Math.hypot(ex, ez) || 1; seg.push([ez / l, -ex / l]); }
  const v = [];
  for (let i = 0; i < AXN; i++) {
    const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i)];
    const nx = a[0] + b[0], nz = a[1] + b[1], l = Math.hypot(nx, nz) || 1;
    v.push([nx / l, nz / l]);
  }
  return v;
})();
function g02SmoothS(x, z, s0) {
  let i = 0, lo = 0, hi = AXN - 2;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (AXC[m] <= s0) { i = m; lo = m + 1; } else hi = m - 1; }
  for (const j of [i, i - 1, i + 1, i - 2, i + 2]) {
    if (j < 0 || j > AXN - 2) continue;
    const ax = AXP[j][0], az = AXP[j][1], ex = AXP[j + 1][0] - ax, ez = AXP[j + 1][1] - az;
    const nA = AXV[j], nB = AXV[j + 1], dx = nB[0] - nA[0], dz = nB[1] - nA[1];
    const qx = x - ax, qz = z - az;
    const cr = (ux, uz, vx, vz) => ux * vz - uz * vx;
    const a = -cr(ex, ez, dx, dz), b = cr(qx, qz, dx, dz) - cr(ex, ez, nA[0], nA[1]), c = cr(qx, qz, nA[0], nA[1]);
    let t = -1;
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) t = -c / b; }
    else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const r = Math.sqrt(disc), t1 = (-b + r) / (2 * a), t2 = (-b - r) / (2 * a);
        t = t1 >= -1e-9 && t1 <= 1 + 1e-9 ? t1 : t2;
      }
    }
    if (t >= -1e-9 && t <= 1 + 1e-9) return AXC[j] + Math.min(1, Math.max(0, t)) * (AXC[j + 1] - AXC[j]);
  }
  return s0;
}
const D6 = DAMS[5];

function carveG02(F, h, mw, M, W) {
  unitToLocal(G2, F.x, F.y, F.z, LOC);
  const x = LOC.x, z = LOC.z;
  if (Math.abs(x) > 22000 || Math.abs(z) > 22000) return h;
  g02Project(x, z, PJ);
  const s = PJ.s, d = PJ.d, ad = Math.abs(d);
  if (PJ.dist > 3800) return h;
  const headS = G02_GEO.head * 1000;
  const i = g02Index(s);
  const right = d > 0;
  // lateral fade at the edge of the site footprint, and band limit
  const lat = 1 - smoothstep(2800, 3800, PJ.dist);
  const ends = smoothstep(-2200, -400, s) * (1 - smoothstep(G02_AXIS.len - 2600, G02_AXIS.len - 400, s));
  const fade = lat * ends * clamp((1200 - mw) / 500, 0, 1);
  if (fade <= 0) return h;
  let t = h;
  if (i >= 0 && i <= 5) {
    const L = G02_LEVELS[i];
    const s0 = i === 0 ? headS : G02_DAMS[i - 1] * 1000, s1 = G02_DAMS[i] * 1000;
    const tr = clamp((s - s0) / (s1 - s0), 0, 1);
    const w = g02HalfWidth(i, s, right ? 1 : -1) * (1 + 0.035 * NG.n3(x / 260, z / 260, i));
    if (ad < w) {
      // basin bed: shallow shelf at the shore, deeper toward the dam
      const D = 8 + 26 * tr * tr + 3 * i;
      const q = ad / w;
      const bed = L - 0.4 - 1.2 * smoothstep(1, 0.86, q) - D * Math.pow(Math.max(0, 1 - q * q), 0.75);
      t = Math.min(h, bed);
      W.type = 3; W.level = L; W.id = `G02-R${i + 1}`; W.kind = 'reservoir';
      W.fx = PJ.tx; W.fy = -PJ.tz; W.width = 2 * w; W.dist = ad; W.order = -1;
    } else {
      const e = ad - w;
      const wall = L + 0.6 + wallRiseNat(e, right, i, g02SmoothS(x, z, s), x, z, mw);
      // the natural tableland above, the carved wall below; never below the water (contained)
      t = Math.max(Math.min(h, wall), L + 0.6 + Math.min(3, e * 0.05));
      if (h < L + 0.6 + 2) t = Math.max(t, L + 0.6 + Math.min(4, e * 0.06));
      if (M) {
        const wl = G2.levels[i].waterline;
        const sideOk = wl.side === 'both' || (wl.side === 'left' ? !right : right);
        // pale old-water-line band up to L + 6.5 m on the waterline.side bank (R1-R4 read like the R5 / R6 deposit
        // bands of megastructures), a faint one up to L + 3.6 m on the other bank
        const wTop = sideOk ? G2.levels[i].waterline.paintTop : L + 3.6;
        if (t < wTop && e < 110) M.waterline = Math.max(M.waterline, (sideOk ? 1 : 0.35) * (1 - smoothstep(wTop - 1, wTop, t)));
        const steepness = right ? smoothstep(55, 70, e) * (1 - smoothstep(wall - 2, wall + 2, h)) : 0;
        // (the benched left bank below dams D1-D5 carries irrigated terraces: little bare rock there)
        if (e < 900) { M.rock = Math.max(M.rock, 0.85 * smoothstep(20, 80, e) * (right ? 1 : 0.55 * (1 - 0.85 * F.g02Terrace))); M.cliff = Math.max(M.cliff, steepness); M.strataW = Math.max(M.strataW, steepness); }
        // irrigated bench terraces: farmland instead of the escarpment's bare rock
        if (!right && F.g02Terrace > 0) { const k = 1 - 0.85 * F.g02Terrace; M.rock *= k; M.cliff *= k; }
      }
    }
    // dam gorge: below the dam axis the next basin (or the outflow) starts at its own level; the
    // gorge stays inside the dam neck so both dam ends key into solid wall above the crest
    if (s > s1 - 40) {
      const nextL = i < 5 ? G02_LEVELS[i + 1] : G02_GEO.plain;
      const k = smoothstep(s1 - 40, s1 + 25, s);
      const wn = Math.min(g02Neck(i), i < 5 ? g02HalfWidth(i + 1, s1 + 30, right ? 1 : -1) : 160);
      if (ad < wn) t = t + (Math.min(t, nextL - 6) - t) * k * (1 - smoothstep(wn - 35, wn, ad));
    }

  } else if (i === -1) {
    // dry head gully climbing onto the tableland
    const floor = G02_LEVELS[0] + 3 + (headS - s) * 0.02;
    t = Math.min(h, floor + Math.max(0, ad - 70) * 0.5);
  } else {
    // outflow: canyon mouth opening onto the plain, spill channel toward the farmland. Fix round 3 (T2 / QQ-01): a
    // natural canyon mouth instead of the straight flat-floored trench with 0.35 planar walls — the R6 bank profiles
    // continue below dam 6 (south: layered cliffs, north: natural gullied slope) from a floor whose half width starts at
    // the dam neck and widens / wanders per side; the wall foot steps down from the R6 shore level to the floor within
    // ~380 m (gorge below the dam, continuous with the R6 walls across the dam line); alluvial floor relief (bars,
    // swales, gentle cross-slope) away from the spill channel. From 1.8-2.8 km below the dam the round-2 plain profile
    // takes over unchanged (G02 irrigation district).
    const sE = G02_DAMS[5] * 1000, ds = s - sE;
    const floor = G02_GEO.plain - 1 - ds * 0.0012;
    // smooth along-valley fields (no s jumps across the vertex bisectors): downstream distance from the dam-6 axis line,
    // continuous station for the noises
    const dl = (x - D6.mx) * D6.nx + (z - D6.mz) * D6.nz, sS = g02SmoothS(x, z, s);
    const kOld = smoothstep(1800, 2800, dl);
    let gOld = 0, gNew = 0;
    if (kOld > 0) { const open = 260 + ds * 0.18; gOld = floor + Math.max(0, ad - open) * 0.35; }
    if (kOld < 1) {
      const sd = right ? 1 : -1;
      const w0 = g02Neck(5) * (1 + 0.035 * NG.n3(x / 260, z / 260, 5));
      const wob = 1 + 0.28 * NG.n3(sS / 950, sd * 2.3, 43.7) * bandW(950, mw) + 0.1 * NG.n3(sS / 330, sd * 1.9, 44.3) * bandW(330, mw);
      const dlp = Math.max(0, dl);
      const open = w0 + (dlp * 0.17 + 85 * smoothstep(0, 900, dlp)) * wob
        + (62 * NG.n3(x / 450, z / 450, 56.3) * bandW(450, mw) + 20 * NG.n3(x / 160, z / 160, 57.1) * bandW(160, mw)) * smoothstep(40, 300, dl);
      const fr = (1.2 * NG.n3(x / 280, z / 280, 44.9) * bandW(280, mw) + 0.5 * NG.n3(x / 95, z / 95, 45.3) * bandW(95, mw) + 0.012 * Math.max(0, ad - 40))
        * smoothstep(30, 90, ad) * smoothstep(0, 300, dl);
      // low river terrace: the outer floor stands ~3 m above the active channel belt (wandering scarp, in patches)
      const tq = ad / open + 0.16 * NG.n3(x / 520, z / 520, 55.9) * bandW(520, mw), tW = Math.max(0.035, (1.5 * mw) / open);
      const terr = 3 * smoothstep(0.55 - tW, 0.55 + tW, tq) * smoothstep(0, 300, dl) * smoothstep(-0.45, 0.25, NG.n3(x / 1100, z / 1100, 58.7));
      const e = ad - open;
      if (e <= 0) gNew = floor + fr + terr;
      else {
        const base = floor + (G02_LEVELS[5] + 0.6 - floor) * (1 - smoothstep(0, 380, dl));
        const stepW = Math.max(6, 1.5 * mw);
        gNew = floor + fr + terr + (base - floor) * smoothstep(0, stepW, e) + wallRiseNat(e, right, 5, sS, x, z, mw);
        if (M) {
          const kn = 1 - kOld;
          const steep = Math.max(right ? smoothstep(55, 70, e) : 0, smoothstep(4, 20, base - floor) * (1 - smoothstep(stepW, 2 * stepW + 8, e))) * (1 - smoothstep(gNew - 2, gNew + 2, h));
          M.rock = Math.max(M.rock, 0.85 * smoothstep(20, 80, e) * (right ? 1 : 0.55) * kn);
          M.cliff = Math.max(M.cliff, steep * kn); M.strataW = Math.max(M.strataW, steep * kn);
        }
      }
    }
    let g = kOld >= 1 ? gOld : kOld <= 0 ? gNew : gNew + (gOld - gNew) * kOld;
    if (ad < 23) g = Math.min(g, floor - 2.4 * (1 - (ad / 23) * (ad / 23)));
    t = Math.min(h, g);
    if (ad < 23) { W.type = 2; W.level = floor + 0.3; W.id = 'G02-OUT'; W.kind = 'spillway'; W.fx = PJ.tx; W.fy = -PJ.tz; W.width = 46; W.dist = ad; W.order = 0; }
  }
  // dam shoulders: solid ground >= 1.5 m above the crest around both ends of every dam axis
  for (let j = 0; j < 6; j++) {
    const D = DAMS[j];
    const qx = x - D.mx, qz = z - D.mz;
    const dl = Math.abs(qx * D.nx + qz * D.nz);
    if (dl >= 110) continue;
    const q = Math.abs(qx * D.ux + qz * D.uz);
    if (q < D.neck - 5 || q > D.hl + 160) continue;
    const kS = (1 - smoothstep(55, 110, dl)) * smoothstep(D.neck - 5, D.neck + 25, q) * (1 - smoothstep(D.hl + 60, D.hl + 160, q));
    if (kS > 0 && t < D.crest + 1.5) t = t + (D.crest + 1.5 - t) * kS;
  }
  // work-town platforms (graded flat at the town level, smooth batters around)
  for (let q = 0; q < TOWNS.length; q++) {
    const T = TOWNS[q];
    const dt = Math.hypot(x - T.x, z - T.z);
    if (dt < T.radius + 260) { const k = 1 - smoothstep(T.radius, T.radius + 260, dt); t = t + (T.y - t) * k; }
  }
  // maintenance road benches: road surface at the polyline height, cut 1:0.7 / fill 1:1.3 batters
  const rb = nearestRoad(x, z);
  if (rb.d < 60) {
    const e = Math.max(0, rb.d - 4.5);
    const lo = rb.y - e * 1.3, hi = rb.y + e * 0.7 * 1.43;
    t = t < lo ? lo : t > hi ? hi : t;
    if (rb.d < 4.5) t = rb.y;
  }
  return h + (t - h) * fade;
}

function carveSites(F, h, mw, M, W) {
  const x = F.x, y = F.y, z = F.z;
  if (x * C1[0] + y * C1[1] + z * C1[2] > LIM1) return carveG01(F, h, mw, M, W);
  if (x * C2[0] + y * C2[1] + z * C2[2] > LIM2) return carveG02(F, h, mw, M, W);
  return h;
}
installSiteCarver(carveSites);
