// The two megastructure sites (prompt §3 巨构, §5 shots 08/09). OWNER: terrain-fn agent (layout +
// landform), read by megastructures/*, world/terrain (landform carving) and the UI. Pure constants
// computed at module load (no control maps needed), worker-safe.
//
// All geometry is in LOCAL TANGENT METRES around each site anchor (gnomonic tangent plane):
//   x = east, z = south (so north = -z), y = up (metres above sea level).
// Helpers: localToLatLon(site, x, z), latLonToLocal(site, lat, lon), localToUnit, unitToLocal.
//
// SITES.tidalBarrier (G01 东海分段潮堤, ZR1 north shore of the east sea, ~0.47N 129.94E)
//   anchor = centre of the barrier arc (on the shelf crest). heading = compass bearing of the open
//   sea seen from the harbour. arc: centreline polyline of the barrier [[x,z]...], arcLength.
//   segments[]: {id, kind:'caisson'|'abutment', a:[x,z], b:[x,z], length, crest (m), width (m),
//     base (sea-floor depth, m < 0), heading (deg, outward normal), gateHouses:[{x,z,heading,side}],
//     quay:{a, b, width} (harbour-side maintenance quay)}  — 10 caissons + 2 rock abutments
//   locks[]: navigation locks / tide gates between segments {id, a, b, width, sill (m), chamber, heading}
//   mouth: wide deep-water navigation mouth {id, a, b, width (560 m), sill (-32 m), heading}
//   channel: deep channel through the mouth {points:[[x,z]...] harbour -> open sea, width, depth, mouthCentre}
//   harbour: {depth, shore:[[x,z]...] closed polygon of the protected basin}
//   shelf: {crestDepth, outerDepth}; headlands: [{x,z,r}] rocky barrier abutments; radius.
//   The terrain (megasites.js) contains the harbour basin (-12..-15 m), the shelf crest under the
//   arc (-9.5 m), the outer slope and the -32 m channel; the shoreline follows harbour.shore.
//
// SITES.waterStairs (G02 南台地水阶, OX5 step-2 escarpment, ~27.95S 44.93W)
//   anchor = the escarpment lip on the valley axis (dam 6). The valley is a re-entrant canyon cut
//   ~15 km back into the dry upper tableland (~810-920 m), stepping down to the farmland plain
//   (~490 m) WSW of the escarpment, toward the west sea.
//   valley: {axis:[[x,z]...] head -> mouth -> outflow (flow direction), length, lipStation}
//   levels[6]: {id, index, level (water surface m), floor (deepest bed m), drop (m to the next),
//     outline:[[x,z]...] closed polygon of the water surface,
//     dam:{id, a:[x,z], b:[x,z], crest, length, width, base, heading (deg, downstream), type:'gravity',
//          bays (gated spillway bays), spillway:{dir:[dx,dz], bays, sill, width}},
//     waterline:{level, top, paintTop (terrain paint top on that bank, L + 6.5), side:'left'|'right'|'both'} (pale
//     exposed old-water-line band)}
//   roads[]: switchback maintenance roads {id, side, points:[[x,y,z]...], width, grade}; y = ground
//     (the terrain carves a road bench along each polyline)
//   towns[]: work towns on shoulders outside the flood line {id, x, z, y, radius}; the terrain
//     grades a flat platform at y within radius
//   spillChannels[]: {id, points:[[x,z]...], width, level0, level1, sluices}
//   plain: {level}, tableland: {level}.

import { R } from '../core/constants.js';
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// local frame helpers (gnomonic: straight lines in (x,z) are great-circle arcs)
// ---------------------------------------------------------------------------------------------
function frame(site) {
  if (site._f) return site._f;
  const la = site.lat * DEG, lo = site.lon * DEG;
  const f = {
    c: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)],
    e: [Math.cos(lo), 0, -Math.sin(lo)],
    n: [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)],
  };
  Object.defineProperty(site, '_f', { value: f, enumerable: false, writable: true });
  return f;
}
export function localToUnit(site, x, z, out = {}) {
  const f = frame(site), n = -z;
  const px = f.c[0] + (f.e[0] * x + f.n[0] * n) / R, py = f.c[1] + (f.n[1] * n) / R, pz = f.c[2] + (f.e[2] * x + f.n[2] * n) / R;
  const l = Math.hypot(px, py, pz);
  out.x = px / l; out.y = py / l; out.z = pz / l;
  return out;
}
export function localToLatLon(site, x, z, out = {}) {
  const u = localToUnit(site, x, z, {});
  out.lat = Math.asin(u.y) / DEG; out.lon = Math.atan2(u.x, u.z) / DEG;
  return out;
}
/** unit vector -> local (x,z) metres; returns false behind the tangent plane */
export function unitToLocal(site, ux, uy, uz, out = {}) {
  const f = frame(site);
  const d = ux * f.c[0] + uy * f.c[1] + uz * f.c[2];
  if (d <= 0.5) { out.x = 1e9; out.z = 1e9; return false; }
  out.x = (ux * f.e[0] + uz * f.e[2]) * R / d;
  out.z = -(ux * f.n[0] + uy * f.n[1] + uz * f.n[2]) * R / d;
  return true;
}
export function latLonToLocal(site, lat, lon, out = {}) {
  const la = lat * DEG, lo = lon * DEG, c = Math.cos(la);
  unitToLocal(site, c * Math.sin(lo), Math.sin(la), c * Math.cos(lo), out);
  return out;
}

const r1 = (v) => Math.round(v * 10) / 10;
const pt = (x, z) => [r1(x), r1(z)];
const headingOf = (dx, dz) => ((Math.atan2(dx, -dz) / DEG) + 360) % 360; // compass bearing of (dx,dz)
function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

// =============================================================================================
// G01 东海分段潮堤 — harbour bay on the ZR1 north shore (natural coast ~0.50N at 129.94E, open sea
// to the SSW). Frame: U along the shore (ESE), V offshore (SSW). Anchor = barrier arc centre (V = 0).
// =============================================================================================
const G01_OFF = 192;                                   // bearing of the open sea
const g01v = [Math.sin(G01_OFF * DEG), -Math.cos(G01_OFF * DEG)];   // offshore unit (x,z)
const g01u = [g01v[1], -g01v[0]];                      // along-shore unit (x,z): ESE
export const G01_GEO = {
  uv: { u: g01u, v: g01v },
  coastV: -2300,            // designed coast line (V) away from the bay
  bayDepth: 4200, bayHalf: 5600,
  head: { u: 5300, w: 900, amp: 870 },
  arc: { r: 9937, cv: -9937, half: 5250 },
};
export function g01ToUV(x, z, out) { out.u = x * g01u[0] + z * g01u[1]; out.v = x * g01v[0] + z * g01v[1]; return out; }
export function g01FromUV(u, v) { return [u * g01u[0] + v * g01v[0], u * g01u[1] + v * g01v[1]]; }
/** designed shoreline V(U) of the harbour bay (land where V < shoreV) */
export function g01ShoreV(u) {
  const G = G01_GEO;
  let v = G.coastV;
  const au = Math.abs(u);
  if (au < G.bayHalf) { const c = Math.cos((Math.PI * u) / (2 * G.bayHalf)); v -= G.bayDepth * Math.pow(c, 0.7); }
  const hq = (au - G.head.u) / G.head.w;
  v += G.head.amp * Math.exp(-hq * hq);
  return v;
}
export function g01ArcV(u) {
  const A = G01_GEO.arc; const q = A.r * A.r - u * u;
  return q > 0 ? A.cv + Math.sqrt(q) : -1e9;
}

function buildG01() {
  const site = { id: 'G01', name: '东海分段潮堤', province: 'ZR1', lat: 0.47, lon: 129.94, heading: G01_OFF };
  const A = G01_GEO.arc;
  const alpha = Math.asin(A.half / A.r);
  const arcLen = 2 * alpha * A.r;
  const posAt = (s) => { const th = -alpha + (s / arcLen) * 2 * alpha; return { u: A.r * Math.sin(th), v: A.cv + A.r * Math.cos(th), th }; };
  const toXZ = (u, v) => g01FromUV(u, v);
  const SEG = [820, 880, 760, 900, 840, 860, 780, 900, 820, 900];
  const LOCK = 120, MOUTH = 560;
  const used = SEG.reduce((a, b) => a + b, 0) + 8 * LOCK + MOUTH;
  const abut = (arcLen - used) / 2;
  const arcPts = [];
  for (let k = 0; k <= 64; k++) { const p = posAt((k / 64) * arcLen); arcPts.push(pt(...toXZ(p.u, p.v))); }
  const segments = [], locks = [];
  let mouth = null;
  let s = 0;
  const outward = (th) => { const [dx, dz] = toXZ(Math.sin(th), Math.cos(th)); return headingOf(dx, dz); };
  const piece = (len, kind, id, extra = {}) => {
    const a = posAt(s), b = posAt(s + len), m = posAt(s + len / 2);
    const [ax, az] = toXZ(a.u, a.v), [bx, bz] = toXZ(b.u, b.v);
    const o = { id, kind, a: pt(ax, az), b: pt(bx, bz), length: r1(len), heading: r1(outward(m.th)), ...extra };
    s += len;
    return o;
  };
  segments.push(piece(abut, 'abutment', 'G01-A1', { crest: 12, width: 60, base: -6 }));
  for (let i = 0; i < SEG.length; i++) {
    const crest = 9.5 + (i % 3) * 0.9;
    const width = 38 + ((i * 7) % 5) * 4;
    const seg = piece(SEG[i], 'caisson', `G01-S${i + 1}`, { crest: r1(crest), width, base: -9 - (i % 2) * 2 });
    const a = posAt(s - SEG[i]), b = posAt(s);
    const inset = 40;
    const gh = [];
    const innerAt = (q, side) => { const u = (A.r - width) * Math.sin(q.th), v = A.cv + (A.r - width) * Math.cos(q.th); const [x, z] = toXZ(u, v); return { x: r1(x), z: r1(z), heading: r1(outward(q.th)), side }; };
    if (i > 0) gh.push(innerAt(posAt(s - SEG[i] + inset), 'west'));
    if (i < SEG.length - 1) gh.push(innerAt(posAt(s - inset), 'east'));
    seg.gateHouses = gh;
    const qr = A.r - width * 0.5 - 18;
    seg.quay = { a: pt(...toXZ(qr * Math.sin(a.th), A.cv + qr * Math.cos(a.th))), b: pt(...toXZ(qr * Math.sin(b.th), A.cv + qr * Math.cos(b.th))), width: 14 };
    segments.push(seg);
    if (i === 4) mouth = piece(MOUTH, 'navigation', 'G01-M', { width: MOUTH, sill: -32 });
    else if (i < SEG.length - 1) locks.push(piece(LOCK, 'lock', `G01-L${locks.length + 1}`, { width: LOCK, sill: -10, chamber: 260 }));
  }
  segments.push(piece(abut, 'abutment', 'G01-A2', { crest: 12, width: 60, base: -6 }));
  const mc = posAt(abut + SEG.slice(0, 5).reduce((a, b) => a + b, 0) + 4 * LOCK + MOUTH / 2);
  const nu = Math.sin(mc.th), nv = Math.cos(mc.th);
  const chPts = [];
  for (const t of [-2600, -1400, -500, 0, 600, 1800, 3200, 4800]) chPts.push(pt(...toXZ(mc.u + nu * t, mc.v + nv * t)));
  const shore = [];
  for (let k = 0; k <= 40; k++) { const u = -A.half + (2 * A.half * k) / 40; shore.push(pt(...toXZ(u, Math.min(g01ShoreV(u), g01ArcV(u) - 30)))); }
  for (let k = 40; k >= 0; k--) { const u = -A.half + (2 * A.half * k) / 40; shore.push(pt(...toXZ(u, g01ArcV(u) - 30))); }
  Object.assign(site, {
    arc: arcPts, arcLength: r1(arcLen), segments, locks, mouth,
    channel: { points: chPts, width: 420, depth: 32, mouthCentre: pt(...toXZ(mc.u, mc.v)) },
    harbour: { depth: 15, shore },
    shelf: { crestDepth: -9.5, outerDepth: -40 },
    headlands: [-1, 1].map((sg) => { const u = sg * G01_GEO.head.u; const [x, z] = toXZ(u, g01ShoreV(u) - 300); return { x: r1(x), z: r1(z), r: 1100 }; }),
    radius: 16000,
  });
  return site;
}

// =============================================================================================
// G02 南台地水阶 — six staggered reservoirs in a re-entrant canyon cut back into the OX5 step-2
// escarpment. Local frame anchored on the escarpment lip; the valley runs WSW (bearing ~255°).
// =============================================================================================
const G02_BEAR = 255;                                   // downstream bearing (toward the west sea)
const g2d = [Math.sin(G02_BEAR * DEG), -Math.cos(G02_BEAR * DEG)];   // downstream unit (x,z)
const g2l = [g2d[1], -g2d[0]];                          // left-of-flow unit (x,z)
// axis stations (km) along the flow from the head; lateral meander (km, + = left of flow)
const G02_AXIS_KM = [[0, 0.0], [1.6, 0.35], [3.4, 0.1], [5.2, -0.45], [7.0, -0.2], [8.8, 0.4], [10.6, 0.55], [12.4, 0.05], [14.2, -0.35], [15.4, -0.2], [17.0, 0.25], [19.0, 0.9], [21.0, 1.6]];
export const G02_LIP = 15.2;                             // km from the head: escarpment lip at the anchor
const G02_DAMS = [2.45, 4.95, 7.45, 9.95, 12.45, 15.05];  // km from the head (dam 6 just inside the lip)
const G02_LEVELS = [852, 792, 732, 672, 612, 552];        // water surfaces (m)
export const G02_GEO = { plain: 492, top: 835, head: 0.3 };

function smoothAxis(ptsKm, step) {
  const P = ptsKm.map(([s, l]) => {
    const ds = (s - G02_LIP) * 1000, dl = l * 1000;
    return [g2d[0] * ds + g2l[0] * dl, g2d[1] * ds + g2l[1] * dl];
  });
  const dense = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(P[P.length - 1]);
  const out = [dense[0]]; const cum = [0]; let acc = 0, last = dense[0], carry = 0;
  for (let i = 1; i < dense.length; i++) {
    acc += Math.hypot(dense[i][0] - last[0], dense[i][1] - last[1]); last = dense[i];
    if (acc - carry >= step || i === dense.length - 1) { out.push(dense[i]); cum.push(acc); carry = acc; }
  }
  return { pts: out, cum, len: acc };
}
export const G02_AXIS = smoothAxis(G02_AXIS_KM, 50);

/** nearest point on the G02 axis: {s (m from head), d (signed lateral, + = right of flow), tx, tz, dist} */
export function g02Project(x, z, out) {
  const P = G02_AXIS.pts, C = G02_AXIS.cum, n = P.length;
  const STEP = 8;
  let b1 = 0, b2 = 0, d1 = 1e18, d2 = 1e18;
  for (let i = 0; i < n - 1; i += STEP) {
    const j = Math.min(n - 1, i + STEP);
    const ax = P[i][0], az = P[i][1], ex = P[j][0] - ax, ez = P[j][1] - az, l2 = ex * ex + ez * ez || 1;
    let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + ex * t - x, dz = az + ez * t - z, dd = dx * dx + dz * dz;
    if (dd < d1) { d2 = d1; b2 = b1; d1 = dd; b1 = i; } else if (dd < d2) { d2 = dd; b2 = i; }
  }
  let best = 1e18, bs = 0, bd = 0, btx = 1, btz = 0;
  for (let q = 0; q < 2; q++) {
    const b = q === 0 ? b1 : b2;
    if (q === 1 && b2 === b1) break;
    const i0 = Math.max(0, b - STEP), i1 = Math.min(n - 1, b + 2 * STEP);
    for (let i = i0; i < i1; i++) {
      const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
      let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ex * t - x, pz = az + ez * t - z, dd = px * px + pz * pz;
      if (dd < best) {
        best = dd; const l = Math.sqrt(l2); bs = C[i] + t * l; btx = ex / l; btz = ez / l;
        bd = -((x - ax) * (-ez) + (z - az) * ex) / l;
      }
    }
  }
  out.s = bs; out.d = bd; out.tx = btx; out.tz = btz; out.dist = Math.sqrt(best);
  return out;
}

/**
 * water-surface half width (m) at axis station s (m) for reservoir i on one side (side -1 left /
 * +1 right of the flow): lens-shaped basins widening into side coves, narrowing to the dam gorge.
 */
export function g02HalfWidth(i, s, side = 1) {
  const s0 = i === 0 ? G02_GEO.head * 1000 : G02_DAMS[i - 1] * 1000, s1 = G02_DAMS[i] * 1000;
  const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0)));
  const W = 330 + 120 * Math.sin(i * 1.7 + 0.4 + side * 0.9) + 60 * i;           // downstream basins are wider
  const lens = Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.96)), 0.55);
  // side coves: smooth bumps at fixed fractions, different per side / level
  const ph = i * 2.17 + (side > 0 ? 0.6 : 3.3);
  const cove = 0.28 * Math.exp(-Math.pow((t - (0.35 + 0.25 * Math.sin(ph))) / 0.12, 2)) + 0.16 * Math.exp(-Math.pow((t - (0.68 + 0.12 * Math.cos(ph * 1.3))) / 0.09, 2));
  const neck = 150 + 25 * (i % 2);
  const w = W * (0.35 + 0.65 * lens) * (1 + cove);
  const nk = smooth01((t - 0.9) / 0.1);
  // every basin below the first starts in the narrow dam gorge of the dam above it
  const nk0 = i > 0 ? 1 - smooth01(t / 0.12) : 0;
  const nn = Math.max(nk, nk0), neckHere = nk >= nk0 ? neck : 150 + 25 * ((i - 1) % 2);
  return w * (1 - nn) + neckHere * nn;
}
/** neck half width (m) of reservoir i at its dam */
export function g02Neck(i) { return 150 + 25 * (i % 2); }

/**
 * Carved wall rise (m) above the water-line terrace of a reservoir, e = horizontal distance from the
 * shore (m). Right bank (d > 0, right of the flow) = layered cliffs with ledges; left bank = benched
 * gentle slopes (old farm terraces). Shared by the terrain carving and the road design.
 */
export function g02WallRise(e, right, i) {
  if (e <= 0) return 0;
  if (right) {
    const beach = 3.2 * smooth01(e / 22);
    const talus = 18 * smooth01((e - 15) / 55);
    const tau = 26 + 6 * (i % 2);
    const c = Math.max(0, e - 60) * 1.25;
    const k = c / tau, ki = Math.floor(k), kf = k - ki;
    return beach + talus + (ki + smooth01((kf - 0.35) / 0.5)) * tau;
  }
  const beach = 3.2 * smooth01(e / 30);
  const g = Math.max(0, e - 40) * 0.24;
  const tau = 9;
  const k = g / tau, ki = Math.floor(k), kf = k - ki;
  return beach + (ki + smooth01((kf - 0.55) / 0.4)) * tau;
}
/** reservoir index at axis station s (m): 0..5, 6 = below the last dam, -1 above the head */
export function g02Index(s) {
  if (s < G02_GEO.head * 1000) return -1;
  for (let i = 0; i < 6; i++) if (s <= G02_DAMS[i] * 1000) return i;
  return 6;
}
export { G02_DAMS, G02_LEVELS };

function buildG02() {
  const site = { id: 'G02', name: '南台地水阶', province: 'OX5', lat: -27.9488, lon: -44.9251, heading: G02_BEAR };
  const P = G02_AXIS.pts, C = G02_AXIS.cum;
  const at = (s) => {
    let i = 0; while (i < C.length - 2 && C[i + 1] < s) i++;
    const t = (s - C[i]) / Math.max(1e-6, C[i + 1] - C[i]);
    const x = P[i][0] + (P[i + 1][0] - P[i][0]) * t, z = P[i][1] + (P[i + 1][1] - P[i][1]) * t;
    const ex = P[i + 1][0] - P[i][0], ez = P[i + 1][1] - P[i][1], l = Math.hypot(ex, ez) || 1;
    return { x, z, tx: ex / l, tz: ez / l };
  };
  const levels = [];
  for (let i = 0; i < 6; i++) {
    const s0 = i === 0 ? G02_GEO.head * 1000 : G02_DAMS[i - 1] * 1000 + 40, s1 = G02_DAMS[i] * 1000;
    const left = [], right = [];
    const N = 48;
    for (let k = 0; k <= N; k++) {
      const s = s0 + (s1 - s0) * (k / N);
      const p = at(s), wl = g02HalfWidth(i, s, -1), wr = g02HalfWidth(i, s, 1);
      left.push(pt(p.x - p.tz * wl, p.z + p.tx * wl));
      right.push(pt(p.x + p.tz * wr, p.z - p.tx * wr));
    }
    const outline = left.concat(right.reverse());
    const pd = at(s1), wd = Math.max(g02HalfWidth(i, s1, -1), g02HalfWidth(i, s1, 1)) + 70;
    const L = G02_LEVELS[i], next = i < 5 ? G02_LEVELS[i + 1] : G02_GEO.plain + 6;
    const bays = 5 + (i % 3);
    levels.push({
      id: `G02-R${i + 1}`, index: i, level: L, floor: L - (22 + 5 * (i % 3) + 3 * i), drop: r1(L - next), outline,
      dam: {
        id: `G02-D${i + 1}`, a: pt(pd.x - pd.tz * wd, pd.z + pd.tx * wd), b: pt(pd.x + pd.tz * wd, pd.z - pd.tx * wd),
        crest: L + 4.5, length: r1(2 * wd), width: 14 + 2 * (i % 2), base: r1(next - 6), heading: r1(headingOf(pd.tx, pd.tz)),
        type: 'gravity', bays,
        spillway: { dir: [Math.round(pd.tx * 1000) / 1000, Math.round(pd.tz * 1000) / 1000], bays, sill: L - 5.5, width: 12 * bays + 6 * (bays - 1) },
      },
      waterline: { level: L, top: L + 3.2, paintTop: L + 6.5, side: i % 2 ? 'left' : 'right' },
    });
  }
  // switchback maintenance roads: from each dam abutment up the reservoir wall to the rim. Every
  // vertex sits on the carved wall profile (g02WallRise above the shore of its station); legs run
  // along the valley at ~8 % between hairpins. The terrain carves a road bench along each polyline
  // (megasites.js), so the road surface and the ground agree exactly.
  const roads = [];
  const invRise = (y, right, i) => { let lo = 0, hi = 3000; for (let k = 0; k < 40; k++) { const m = 0.5 * (lo + hi); if (g02WallRise(m, right, i) < y) lo = m; else hi = m; } return 0.5 * (lo + hi); };
  for (let i = 0; i < 6; i++) {
    const s1 = G02_DAMS[i] * 1000;
    const side = i % 2 ? 1 : -1;                      // +1 right bank (cliffs), -1 left bank (benches)
    const right = side > 0;
    const L = G02_LEVELS[i], crest = L + 4.5;
    const yCap = G02_GEO.top + 18 + (5 - i) * 10;      // tableland rim (approx.)
    const leg = 470, grade = 0.075;
    const place = (sSt, dAbs) => { const p = at(sSt); return [p.x + side * p.tz * dAbs, p.z - side * p.tx * dAbs]; };
    const pts = [];
    // vertex 0: the dam abutment (end of the dam axis), at the ground of the wall there
    const wd = g02Neck(i) + 70;
    const y0 = Math.max(crest, L + 0.6 + g02WallRise(wd - g02Neck(i), right, i));
    let [px, pz] = place(s1, wd);
    pts.push([r1(px), r1(y0), r1(pz)]);
    let y = y0, k = 0;
    while (y < yCap - 1 && k < 14) {
      k++;
      y = Math.min(yCap, y + grade * leg);
      const sSt = s1 - 70 - (k % 2 ? leg : 0) - 20 * k;   // alternate ends of the leg (hairpins)
      const e = invRise(y - L - 0.6, right, i);
      const dAbs = g02HalfWidth(i, sSt, side) + e;
      [px, pz] = place(sSt, dAbs);
      pts.push([r1(px), r1(y), r1(pz)]);
    }
    roads.push({ id: `G02-RD${i + 1}`, side: right ? 'right' : 'left', points: pts, width: 7, grade });
  }
  // work towns on the canyon shoulders (outside the flood line) and one on the plain; the terrain
  // grades a flat town platform at y (megasites.js)
  const towns = [];
  for (const [k, sKm, side, y] of [[1, 3.7, 1, 878], [2, 8.7, -1, 870], [3, 13.6, 1, 822], [4, 18.2, -1, 520]]) {
    const p = at(sKm * 1000);
    const off = (sKm > 16 ? 1300 : 1500) * side;
    towns.push({ id: `G02-T${k}`, x: r1(p.x + p.tz * off), z: r1(p.z - p.tx * off), y, radius: 420 + 60 * k });
  }
  // outflow channel from the last dam across the plain toward the farmland
  const sE = G02_DAMS[5] * 1000;
  const spPts = [];
  for (const ds of [30, 900, 1900, 3200, 4600, 5800]) { const p = at(Math.min(G02_AXIS.len - 1, sE + ds)); spPts.push(pt(p.x, p.z)); }
  const spillChannels = [{ id: 'G02-OUT', points: spPts, width: 46, level0: G02_GEO.plain + 2, level1: G02_GEO.plain - 6, sluices: [] }];
  Object.assign(site, {
    valley: { axis: G02_AXIS.pts.filter((_, k) => k % 4 === 0).map(([x, z]) => pt(x, z)), length: r1(G02_AXIS.len), lipStation: G02_LIP * 1000 },
    levels, roads, towns, spillChannels,
    plain: { level: G02_GEO.plain }, tableland: { level: G02_GEO.top }, radius: 16000,
  });
  return site;
}

export const SITES = { tidalBarrier: buildG01(), waterStairs: buildG02() };
