// Boat routes and schedules (pure, worker-safe, no THREE). OWNER: props agent.
// * route helpers: polylines of ECEF points on the sea-level sphere (metres), arc length s in metres
// * shuttle timetable (dwell / trapezoid trip / dwell / trip back; the period divides the sol)
// * buildG01Layout(): the G01 navigation-mouth lanes, the harbour ferry line from SITES.tidalBarrier and the
//   cross-harbour line in front of the S05 camera (fix round 3) (+ terrain depth checks). Runs in the props
//   worker (heightAt near the megastructure landform is slow) and returns plain data; boats.js turns it into routes.
// Shot sync (prompt §5): the lane / ferry-line phases are chosen so that the bookmark times show the
// brief's moments (05: a ferry crossing the foreground of the harbour view with its widening wake; 09b: the
// next inbound ferry just ahead in the mouth). Still deterministic: constants, not clocks.
import { R } from '../core/constants.js';
import { heightAt } from '../world/terrain.js';
import * as SITESM from '../world/sites.js';
import { enuBasisFromUnit } from '../core/geo.js';
import * as DCHUNKS from '../world/urban/dchunks.js';
import * as DISTRICTS from '../world/urban/districts.js';

const DAY = 86400;
const DIVISORS = (() => { const d = []; for (let i = 1; i <= DAY; i++) if (DAY % i === 0) d.push(i); return d; })();
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const BOAT_TYPES = {
  ferry: { speed: 7.5, beam: 13, len: 64 },
  cargo: { speed: 5.0, beam: 21, len: 128 },
  tug: { speed: 6.0, beam: 9, len: 24 },
  launch: { speed: 9.0, beam: 3.4, len: 11 },
};
// G01 lanes: [lane, offset right of the channel axis (m), headway (s), speed (m/s), type cycle]
export const G01_LANES = [
  ['big', 90, 300, 6.2, ['ferry', 'cargo', 'ferry', 'tug', 'ferry', 'cargo', 'tug']],
  ['small', 190, 540, 8.5, ['launch']],
];
const solOf = (lon, h) => ((h - lon / 15) % 24 + 24) % 24;
// 09b: an inbound ferry ~300 m ahead of the camera in the mouth (bookmark S09b = mega view 'g01-ship':
// 650 m offshore of the mouth centre, 7 m up, looking in through the mouth)
const SYNC_S09B = { sol: solOf(129.94, 18.08), offshore: 650, ahead: 300 };
// 05: see S05X / s05Crossing / s05Phases below (fix round 3: the harbour ferry crosses the S05 foreground)
export const HARBOUR = { offshore: 450, speed: 7.0, dwell: 240, keep: 32 };

/** route: polyline of points projected onto the sea-level sphere (ECEF metres) + cumulative lengths */
export function makeRoute(id, pts, level, opts = {}) {
  const P = pts.map((p) => { const l = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / l * R, y: p.y / l * R, z: p.z / l * R }; });
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y, P[i].z - P[i - 1].z));
  return { id, P, L, len: L[L.length - 1], level, loop: !!opts.loop, ...opts };
}
export function routePoint(rt, s, out) {
  const L = rt.L, n = L.length;
  if (rt.loop) { s = ((s % rt.len) + rt.len) % rt.len; } else s = clamp(s, 0, rt.len);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
  const a = rt.P[lo], b = rt.P[hi], f = (s - L[lo]) / (L[hi] - L[lo] || 1);
  const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
  const l = Math.hypot(x, y, z), r = R + rt.level;
  out.x = x / l * r; out.y = y / l * r; out.z = z / l * r;
  return out;
}
/** nearest arc length of a route to an ECEF point (per segment) */
export function routeNearest(rt, X, Y, Z) {
  let best = 1e30, bs = 0;
  for (let i = 1; i < rt.P.length; i++) {
    const a = rt.P[i - 1], b = rt.P[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz || 1;
    const t = clamp(((X - a.x) * dx + (Y - a.y) * dy + (Z - a.z) * dz) / l2, 0, 1);
    const qx = a.x + dx * t - X, qy = a.y + dy * t - Y, qz = a.z + dz * t - Z;
    const d = qx * qx + qy * qy + qz * qz;
    if (d < best) { best = d; bs = rt.L[i - 1] + t * (rt.L[i] - rt.L[i - 1]); }
  }
  return { s: bs, d: Math.sqrt(best) };
}

/** trapezoid ease over a normalised trip (accelerate / cruise / brake over fraction a each) */
export function easeTrip(u, a) {
  if (u <= 0) return 0; if (u >= 1) return 1;
  let e;
  if (u < a) e = (u * u) / (2 * a);
  else if (u > 1 - a) e = 1 - a - ((1 - u) * (1 - u)) / (2 * a);
  else e = u - a / 2;
  return e / (1 - a);
}
export function shuttlePeriod(len, speed, dwell) {
  const travel = len / speed + 40;                                        // + manoeuvring
  const P = DIVISORS.find((d) => d >= 2 * (travel + dwell)) || DAY;
  return { travel, P, dw: P / 2 - travel };
}
/** shuttle along a non-loop route: dwell at A, travel A->B, dwell at B, travel B->A; period divides the sol */
export function shuttleState(len, T, speed, dwell, phase) {
  const { travel, P, dw } = shuttlePeriod(len, speed, dwell);
  const a = Math.min(0.45, 45 / travel);
  let t = ((T - phase) % P + P) % P;
  const v = (tt) => speed * clamp(Math.min(tt, travel - tt) / (a * travel), 0.15, 1);
  if (t < dw) return { s: 0, dir: 1, moving: false, speed: 0, age: 0 };
  t -= dw;
  if (t < travel) return { s: easeTrip(t / travel, a) * len, dir: 1, moving: true, speed: v(t), age: t };
  t -= travel;
  if (t < dw) return { s: len, dir: -1, moving: false, speed: 0, age: 0 };
  t -= dw;
  return { s: len - easeTrip(t / travel, a) * len, dir: -1, moving: true, speed: v(t), age: t };
}
/** phase so that a shuttle is at arc s (moving A->B) at sol second T */
export function shuttlePhaseFor(len, speed, dwell, T, s) {
  const { travel, dw } = shuttlePeriod(len, speed, dwell);
  const a = Math.min(0.45, 45 / travel);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (easeTrip(m, a) * len < s) lo = m; else hi = m; }
  return T - (dw + lo * travel);
}


/**
 * G01 layout (pure): {lanes: [{id, lane, pts:[{x,y,z}] ECEF m, H, v, types, ph, kOff}],
 *   harbour: {id, pts, speed, dwell, keep, phases:[p0, p1]} | null, landings: [{ecef, toward, gangway}]}
 */
export function buildG01Layout() {
  const site = SITESM.SITES && SITESM.SITES.tidalBarrier;
  const out = { lanes: [], harbour: null, landings: [] };
  if (!site || !site.channel || !site.channel.points || typeof SITESM.localToUnit !== 'function') return out;
  const U = (x, z) => SITESM.localToUnit(site, x, z, {});
  const ch = site.channel.points;                       // harbour -> open sea
  const n = ch.length;
  const last = ch[n - 1], prev = ch[n - 2];
  const ex = last[0] - prev[0], ez = last[1] - prev[1]; const el = Math.hypot(ex, ez) || 1;
  const first = ch[0], second = ch[1];
  const ix = first[0] - second[0], iz = first[1] - second[1]; const il = Math.hypot(ix, iz) || 1;
  // axis: turning basin in the harbour (2.2 km inside the inner channel end) -> 7 km beyond the outer end
  const axis = [[first[0] + ix / il * 2200, first[1] + iz / il * 2200], ...ch, [last[0] + ex / el * 7000, last[1] + ez / el * 7000]];
  const offsetLine = (pts, off) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    return [p[0] - tz * off, p[1] + tx * off];          // right of travel (x east, z south)
  });
  for (const [lane, off, H, v, types] of G01_LANES) {
    const inL = offsetLine(axis.slice().reverse(), off);  // sea -> basin
    const outL = offsetLine(axis, off);                   // basin -> sea (right of outbound travel)
    // U-turn around the basin end of the axis (turning to port)
    const c = axis[0];
    const fx = -ix / il, fz = -iz / il;                   // inbound travel direction at the basin end
    const rx = -fz, rz = fx;                              // right of inbound travel
    const turn = [];
    for (let k = 1; k < 12; k++) {
      const th = (k / 12) * Math.PI;
      turn.push([c[0] + rx * off * Math.cos(th) + fx * off * Math.sin(th), c[1] + rz * off * Math.cos(th) + fz * off * Math.sin(th)]);
    }
    const pts = [...inL, ...turn, ...outL].map(([x, z]) => { const u = U(x, z); return { x: u.x * R, y: u.y * R, z: u.z * R }; });
    const rt = makeRoute(`G01-${lane}`, pts, 0);
    let ph = lane === 'small' ? 77 : 0, kOff = 0;
    if (lane === 'big') {
      const m = site.mouth, ob = (site.heading || 192) * Math.PI / 180;
      const mx = m ? (m.a[0] + m.b[0]) / 2 : site.channel.mouthCentre[0], mz = m ? (m.a[1] + m.b[1]) / 2 : site.channel.mouthCentre[1];
      const cu = U(mx + Math.sin(ob) * SYNC_S09B.offshore, mz - Math.cos(ob) * SYNC_S09B.offshore);
      const near = routeNearest(rt, cu.x * R, cu.y * R, cu.z * R);
      if (near.d < 400 && near.s < rt.len / 2) {
        const T = SYNC_S09B.sol * 3600, sT = near.s + SYNC_S09B.ahead;
        const t0 = T - sT / v;                            // departure of that ship from the sea end
        ph = ((t0 % H) + H) % H;
        const K = Math.round((t0 - ph) / H);
        const fi = types.indexOf('ferry');
        kOff = ((fi - K) % types.length + types.length) % types.length;
      }
    }
    out.lanes.push({ id: rt.id, lane, pts: rt.P, H, v, types, ph, kOff });
  }
  // ---- harbour ferry line between the two floating landings of the basin (west bay head <-> east shore); since
  // fix round 3 it crosses the harbour through the S05 foreground (s05Crossing) instead of following the north shore;
  // a failure here keeps the lanes (out.harbourError)
  try { (() => {
    const shore = site.harbour && site.harbour.shore;
    if (!shore || shore.length < 20) return;
    const north = shore.slice(0, Math.floor(shore.length / 2));   // west -> east along the bay head
    const V = SITESM.G01_GEO ? SITESM.G01_GEO.uv.v : [-0.2079, 0.9781];   // offshore unit (x,z)
    const G01U = SITESM.G01_GEO ? SITESM.G01_GEO.uv.u : [V[1], -V[0]];     // along-shore unit (x,z)
    const depthAt = (x, z) => { const u = U(x, z); return heightAt(u.x, u.y, u.z, 20); };
    const line = [];
    for (let i = 0; i + 1 < north.length; i++) {
      for (let k = 0; k < 4; k++) {
        const f = k / 4, p = [north[i][0] + (north[i + 1][0] - north[i][0]) * f, north[i][1] + (north[i + 1][1] - north[i][1]) * f];
        line.push([p[0] + V[0] * HARBOUR.offshore, p[1] + V[1] * HARBOUR.offshore]);
      }
    }
    let best = null, run = [];
    const flush = () => { if (run.length > 6 && (!best || run.length > best.length)) best = run; run = []; };
    for (const p of line) { if (depthAt(p[0], p[1]) < -2.5) run.push(p); else flush(); }
    flush();
    if (!best) return;
    const cut = Math.floor(best.length / 8);              // stay clear of the headlands
    const mid = best.slice(cut, best.length - cut);
    if (mid.length < 4) return;
    // ---- landings on the ACTUAL shore (2 m band-limited terrain, local shore normal) ----
    const LF = landingFinder(U);
    const hFine = LF.hFine;
    // the port city's piers / ferry terminals around both line ends (fix round 3: the harbour shore became quays
    // with cargo piers, a landing must not sit on or beside one)
    const piers = sitePiers(site, U, [mid[0], mid[mid.length - 1]], 1800);
    const landingNear = (p) => LF.near(p, V, G01U, HARBOUR.offshore + 500, piers);
    const A = landingNear(mid[0]), B = landingNear(mid[mid.length - 1]);
    if (!A || !B) return;
    // every leg sampled for depth (no shoal / island crossings): push dry samples offshore
    const Xs = s05Crossing(site, U);
    const legPts = Xs ? [A.berth, A.appr, ...Xs.pts, B.appr, B.berth] : [A.berth, A.appr, ...mid.slice(1, -1), B.appr, B.berth];
    const wetLeg = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = 0; s <= L; s += 15) { const f = L ? s / L : 0; if (hFine(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) > -1.0) return f; } return -1; };
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let i = 0; i + 1 < legPts.length; i++) {
        const f = wetLeg(legPts[i], legPts[i + 1]);
        if (f < 0) continue;
        const a = legPts[i], b = legPts[i + 1];
        legPts.splice(i + 1, 0, [a[0] + (b[0] - a[0]) * f + V[0] * 120, a[1] + (b[1] - a[1]) * f + V[1] * 120]);
        changed = true; i++;
      }
      if (!changed) break;
    }
    out.harbourCheck = { dryLegs: legPts.slice(0, -1).filter((a, i) => wetLeg(a, legPts[i + 1]) >= 0).length, piers: piers.length, depths: [A.depth, B.depth].map((d) => Math.round(d * 10) / 10) };
    const pts2 = legPts.map(([x, z]) => { const u = U(x, z); return { x: u.x * R, y: u.y * R, z: u.z * R }; });
    const rt = makeRoute('G01-harbour', pts2, 0);
    const { P } = shuttlePeriod(rt.len, HARBOUR.speed, HARBOUR.dwell);
    let phases = [1234, 1234 + P / 2];
    if (Xs) {
      // the crossing waypoints keep their array identity through the depth passes: their arc lengths bound the
      // straight section in front of the S05 camera
      const i0 = legPts.indexOf(Xs.pts[0]), i1 = legPts.indexOf(Xs.pts[1]);
      if (i0 >= 0 && i1 > i0) {
        const S = s05Phases(rt, rt.L[i0], rt.L[i1], out.lanes, HARBOUR.speed, HARBOUR.dwell, HARBOUR.keep);
        phases = S.phases; out.s05 = S.check;
      }
    }
    out.harbour = { id: rt.id, pts: rt.P, speed: HARBOUR.speed, dwell: HARBOUR.dwell, keep: HARBOUR.keep, phases };
    for (const L of [A, B]) out.landings.push(landingRecord(U, L));
  })(); } catch (e) { out.harbour = null; out.landings = []; out.harbourError = String((e && e.stack) || e).slice(0, 600); }
  return out;
}

/** urban piers / ferry terminals (district2(key).piers, the records generateCityTile turns into CityTileData docks)
 *  within `radius` of the site-local points -> [{cx, cz, ux, uz, hl, hw}] rectangles in the site frame */
function sitePiers(site, U, pts, radius) {
  const nearestDistrict = DCHUNKS.nearestDistrict, district1 = DISTRICTS.district1, district2 = DISTRICTS.district2, fromPlane = DISTRICTS.fromPlane;
  const out = [];
  if (typeof nearestDistrict !== 'function' || typeof district2 !== 'function' || typeof fromPlane !== 'function') return out;
  const keys = new Set(), ND = {};
  for (const p of pts) for (let i = -radius; i <= radius; i += 400) for (let j = -radius; j <= radius; j += 400) {
    const u = U(p[0] + i, p[1] + j);
    try { nearestDistrict(u.x, u.y, u.z, ND); keys.add(ND.key); } catch (e) { /* */ }
  }
  const Q = {}, L = {};
  const loc = (D, a, b) => { fromPlane(D, a, b, Q); SITESM.unitToLocal(site, Q.x, Q.y, Q.z, L); return [L.x, L.z]; };
  for (const dk of keys) {
    let G;
    try { const D1 = district1(dk); if (!D1 || D1.cls === 0) continue; G = district2(dk); } catch (e) { continue; }
    if (!G || !G.D || !Array.isArray(G.piers)) continue;
    for (const pr of G.piers) {
      if (!pr || !Number.isFinite(pr.cu) || !Number.isFinite(pr.len)) continue;
      try {
        const c = loc(G.D, pr.cu, pr.cv), e = loc(G.D, pr.cu + pr.du * 10, pr.cv + pr.dv * 10);
        let ux = e[0] - c[0], uz = e[1] - c[1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        if (!pts.some((p) => Math.hypot(c[0] - p[0], c[1] - p[1]) < radius + pr.len)) continue;
        if ([c[0], c[1], ux, uz].every(Number.isFinite)) out.push({ cx: c[0], cz: c[1], ux, uz, hl: pr.len / 2, hw: (pr.wid || 20) / 2 });
      } catch (err) { /* skip this pier */ }
    }
  }
  return out;
}

/** landing record for boats.js (pontoon centre, +z towards the shore, cliff lift): see landingFinder().near */
function landingRecord(U, L) {
  const c = U(L.C[0], L.C[1]), t = U(L.C[0] - L.n[0] * 10, L.C[1] - L.n[1] * 10);
  // tower: shaft from `base` (ground at the foot, m above the water) to `top` (cliff plateau) at
  // landing-frame z = zt (+z towards the shore); bridge from the shaft (zt + 3.6) to the cliff edge ze
  const tower = L.top > 6 ? { zt: L.zt, base: Math.min(L.base, 2.6) - 0.6, top: L.top + 0.25, bridge: Math.max(2, L.ze + 1.5 - (L.zt + 3.6)) } : null;
  return { ecef: { x: c.x * R, y: c.y * R, z: c.z * R }, toward: { x: (t.x - c.x) * R, y: (t.y - c.y) * R, z: (t.z - c.z) * R }, gangway: 16, tower, depth: Math.round(L.depth * 10) / 10 };
}

/**
 * Floating-landing finder on the 2 m band-limited terrain of a site frame (U(x, z) -> unit; x east, z south).
 * near(p, V, Ua, reach): landing near the point p in the water, V = offshore unit (shore -> water), Ua = unit
 * along the shore; searches ±700 m along the shore: pontoon parallel to the local waterline, gangway onto the
 * cliff foot, lift tower + bridge up to the cliff top where the bank is steep (G01 bay: 40-110 m banks).
 * -> {C (pontoon centre), n (seaward normal), t, berth, appr (200 m out), din, top, base, zt, ze, depth} | null
 */
function landingFinder(U) {
  const hFine = (x, z) => { const u = U(x, z); return heightAt(u.x, u.y, u.z, 2); };
  /** waterline crossing marching from (x, z) along (dx, dz) (unit) up to `max` m; null if none */
  const waterline = (x, z, dx, dz, max) => {
    if (hFine(x, z) >= 0) return null;
    let d = 0;
    for (; d < max; d += 6) if (hFine(x + dx * d, z + dz * d) >= 0) break;
    if (d >= max) return null;
    let a = Math.max(0, d - 6), b = d;
    for (let i = 0; i < 10; i++) { const m = (a + b) / 2; if (hFine(x + dx * m, z + dz * m) >= 0) b = m; else a = m; }
    return [x + dx * b, z + dz * b];
  };
  /** pontoon (36 × 9 m), gangway, berthed ferry (bow-in, 64 m) and the 200 m approach lane clear of every pier
   *  rectangle {cx, cz, ux, uz, hl, hw} (site-local) by `m` metres */
  const clearOf = (piers, C, n, t, m = 5, apprB = 240) => {
    if (!piers || !piers.length) return true;
    const pts = [];
    for (const a of [-18, -9, 0, 9, 18]) for (const b of [-4.5, 0, 4.5]) pts.push([a, b]);
    for (const b of [-8, -12, -16, -20]) pts.push([0, b]);
    for (let b = 6; b <= 70; b += 8) for (const a of [-6.5, 0, 6.5]) pts.push([a, b]);
    for (let b = 78; b <= apprB; b += 18) for (const a of [-12, 0, 12]) pts.push([a, b]);
    for (const [a, b] of pts) {
      const x = C[0] + t[0] * a + n[0] * b, z = C[1] + t[1] * a + n[1] * b;
      for (const P of piers) {
        const dx = x - P.cx, dz = z - P.cz;
        if (Math.abs(dx * P.ux + dz * P.uz) < P.hl + m && Math.abs(-dx * P.uz + dz * P.ux) < P.hw + m) return false;
      }
    }
    return true;
  };
  const near = (p, V, Ua, reach, piers = null) => {
    let bestL = null;
    for (let k = -14; k <= 14; k++) {
      const q = [p[0] + Ua[0] * k * 50, p[1] + Ua[1] * k * 50];
      const w0 = waterline(q[0], q[1], -V[0], -V[1], reach);
      if (!w0) continue;
      // local shore normal from two neighbouring waterline points (seaward n)
      const qa = [q[0] - Ua[0] * 20, q[1] - Ua[1] * 20], qb = [q[0] + Ua[0] * 20, q[1] + Ua[1] * 20];
      const wa = waterline(qa[0], qa[1], -V[0], -V[1], reach), wb = waterline(qb[0], qb[1], -V[0], -V[1], reach);
      if (!wa || !wb) continue;
      let tx = wb[0] - wa[0], tz = wb[1] - wa[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let nx = -tz, nz = tx; if (nx * V[0] + nz * V[1] < 0) { nx = -nx; nz = -nz; }
      // re-find the waterline along the true normal, then the cliff foot (ground 1.4 m) inland
      const w = waterline(w0[0] + nx * 60, w0[1] + nz * 60, -nx, -nz, 120) || w0;
      let din = 0.5;
      for (; din < 14; din += 0.5) if (hFine(w[0] - nx * din, w[1] - nz * din) >= 1.0) break;
      if (din >= 14) din = 6;
      const gEnd = hFine(w[0] - nx * din, w[1] - nz * din);          // ground under the gangway end
      const C = [w[0] - nx * din + nx * 20.5, w[1] - nz * din + nz * 20.5];          // pontoon centre
      // straight final approach along the normal: out beyond the heads of the piers beside the berth (a slip
      // between two cargo piers is entered along its axis), clear of every pier on the way
      let apprB = 200;
      if (piers) for (const P of piers) {
        let bmax = -1e9, lat = 1e9;
        for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const x = P.cx + P.ux * P.hl * sa - P.uz * P.hw * sb, z = P.cz + P.uz * P.hl * sa + P.ux * P.hw * sb;
          const dx = x - C[0], dz = z - C[1];
          bmax = Math.max(bmax, dx * nx + dz * nz); lat = Math.min(lat, Math.abs(dx * tx + dz * tz));
        }
        if (lat < 220 && bmax > 0) apprB = Math.max(apprB, Math.min(700, bmax + 70));
      }
      if (!clearOf(piers, C, [nx, nz], [tx, tz], 5, apprB + 40)) continue;           // city piers / ferry terminals
      // depth under the pontoon (corners + water side) and at the ferry berth
      let dmin = 1e9;
      for (const [a, b] of [[-18, -4.5], [18, -4.5], [-18, 4.5], [18, 4.5], [0, -4.5]]) dmin = Math.min(dmin, -hFine(C[0] + tx * a - nx * b, C[1] + tz * a - nz * b));
      const berth = [C[0] + nx * (4.5 + 1.5 + BOAT_TYPES.ferry.len / 2), C[1] + nz * (4.5 + 1.5 + BOAT_TYPES.ferry.len / 2)];
      dmin = Math.min(dmin, -hFine(berth[0], berth[1]));
      if (dmin < 0.9) continue;
      // cliff edge behind the landing: first point inland where the bank flattens out (lift tower 3 m
      // inland of the gangway end, bridge from the shaft to that edge)
      const zt = 20.5 + 3.0;
      const hz = (z) => hFine(C[0] - nx * z, C[1] - nz * z);
      let ze = -1, top = 0;
      for (let z = zt + 4; z <= zt + 80; z += 2) {
        const h0 = hz(z);
        if (h0 > 6 && (hz(z + 8) - h0) / 8 < 0.3) { ze = z; top = h0; break; }
      }
      if (ze < 0) { ze = zt + 3.6; top = 0; }
      const base = hz(zt + 1.8);
      // wide cliff-foot strip, gangway end near quay height, close to the line end, short bridge
      const score = din + Math.max(0, gEnd - 2.4) * 4 + Math.abs(k) * 0.15 + (ze - zt) * 0.05;
      if (!bestL || score < bestL.score) bestL = { score, C, n: [nx, nz], t: [tx, tz], berth, din, top, base, zt, ze, depth: dmin, apprB };
    }
    if (!bestL) return null;
    const L0 = bestL;
    const ab = L0.apprB || 200;
    L0.appr = [L0.berth[0] + L0.n[0] * ab, L0.berth[1] + L0.n[1] * ab];
    return L0;
  };
  return { hFine, waterline, near };
}

/** boat point at arc s incl. the keep-right offset of a two-way line (ECEF; full offset beyond 160 m from the ends) */
export function routePointKeep(rt, s, dir, keep, out) {
  routePoint(rt, s, out);
  if (!keep) return out;
  const w = smoothstep(0, 160, Math.min(s, rt.len - s));
  if (w <= 0) return out;
  const A = {}, B = {};
  routePoint(rt, s - 4, A); routePoint(rt, s + 4, B);
  const tx = (B.x - A.x) * dir, ty = (B.y - A.y) * dir, tz = (B.z - A.z) * dir;
  const l = Math.hypot(out.x, out.y, out.z), ux = out.x / l, uy = out.y / l, uz = out.z / l;
  // right = t × up
  const rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const k = keep * w / rl;
  out.x += rx * k; out.y += ry * k; out.z += rz * k;
  return out;
}

// ---------------------------------------------------------------------------------------------
// 05 foreground ferry (fix round 3, ★P1). Bookmark S05 looks NNE across the G01 inner harbour from 20 m above the
// water (0.53127N 129.95260E, heading 12.7, 45 mm, local 15:30 at 129.94351E) at the BG01 cable bridge ~2 km out.
// The harbour ferry line between the two floating landings (west bay head <-> east shore) crosses that view on a
// straight 1.4 km section 360 m ahead, nearly square to the view axis (tilted 15° so that the eastbound ferry draws
// away and its widening wake trails back towards the camera across the left of the frame). The phase puts the
// eastbound ferry just right of the frame centre, mid-crossing, at the bookmark time; the second ferry runs half a
// period later unless that brings it near the first one then (constants only: positions stay a pure function of
// sol time); the hero position steps aside (±2..7°) from G01 lane vessels at that time.
// ---------------------------------------------------------------------------------------------
export const S05X = { lat: 0.53127, lon: 129.95260, alt: 20, heading: 12.7, lens: 45, sol: solOf(129.94351, 15.5), dist: 360, tilt: -15, rel: 8.5, gap: 700 };
const DEG = Math.PI / 180;
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

/** the S05 crossing section: two waypoints (site-local [x, z], west then east) 2·gap apart on a line through the
 *  point `dist` ahead of the S05 camera, `tilt` off square to the view axis; null unless it is open water */
function s05Crossing(site, U) {
  const cam = SITESM.latLonToLocal(site, S05X.lat, S05X.lon, {});
  const hd = S05X.heading * DEG;
  const X0 = [cam.x + Math.sin(hd) * S05X.dist, cam.z - Math.cos(hd) * S05X.dist];
  const bw = (S05X.heading - 90 + S05X.tilt) * DEG;
  const dW = [Math.sin(bw), -Math.cos(bw)];                       // westward along the section (x east, z south)
  const at = (d) => [X0[0] + dW[0] * d, X0[1] + dW[1] * d];
  for (let d = -S05X.gap - 300; d <= S05X.gap + 300; d += 25) { const p = at(d), u = U(p[0], p[1]); if (heightAt(u.x, u.y, u.z, 20) > -4) return null; }
  return { pts: [at(S05X.gap), at(-S05X.gap)], X0 };
}

/** phases of a two-ferry shuttle line (A -> B = eastbound) for the S05 frame (see above) */
function s05Phases(rt, sA, sB, lanes, speed, dwell, keep) {
  const la = S05X.lat * DEG, lo = S05X.lon * DEG;
  const cu = { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) };
  const E = enuBasisFromUnit(cu.x, cu.y, cu.z, {});
  const Q = {};
  const view = (p) => {
    const dx = p.x - cu.x * R, dy = p.y - cu.y * R, dz = p.z - cu.z * R;
    const e = dx * E.east[0] + dy * E.east[1] + dz * E.east[2], n = dx * E.north[0] + dy * E.north[1] + dz * E.north[2];
    let rel = Math.atan2(e, n) / DEG - S05X.heading; rel = ((rel + 540) % 360) - 180;
    return { rel, d: Math.hypot(e, n) };
  };
  const sAtRel = (rel) => {                                        // eastbound: rel grows with s
    let a = sA, b = sB;
    for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (view(routePointKeep(rt, m, 1, keep, Q)).rel < rel) a = m; else b = m; }
    return (a + b) / 2;
  };
  const T = S05X.sol * 3600;
  const { P, dw } = shuttlePeriod(rt.len, speed, dwell);
  const mod = (x) => ((x % P) + P) % P;
  // G01 lane vessels at the bookmark time (boats.js boatsAt: ship k leaves the sea end at ph + k·H)
  const laneShips = [];
  for (const Ln of lanes || []) {
    const lr = makeRoute(Ln.id, Ln.pts, 0), n = Ln.types.length;
    const kMax = Math.floor((T - Ln.ph) / Ln.H);
    for (let k = kMax; k > kMax - 400; k--) {
      const s = (T - (Ln.ph + k * Ln.H)) * Ln.v; if (s > lr.len) break;
      const type = Ln.types[(((k + (Ln.kOff || 0)) % n) + n) % n];
      laneShips.push({ p: routePoint(lr, s, {}), clear: (BOAT_TYPES[type] ? BOAT_TYPES[type].len : 64) / 2 + 32 + 70 });
    }
  }
  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  let sHero = sAtRel(S05X.rel), relUsed = S05X.rel;
  for (const dr of [0, 2, -2, 4, -4, 7, -7]) {
    const s = sAtRel(S05X.rel + dr), p = routePointKeep(rt, s, 1, keep, {});
    if (laneShips.every((q) => dist3(p, q.p) > q.clear)) { sHero = s; relUsed = S05X.rel + dr; break; }
  }
  const ph0 = mod(shuttlePhaseFor(rt.len, speed, dwell, T, sHero));
  const hero = routePointKeep(rt, sHero, 1, keep, {});
  // second ferry: half a period later unless that brings it within 1.2 km of the hero at the bookmark time (the
  // offset keeps the two ferries out of each other's dwell at the landings)
  let ph1 = mod(ph0 + P / 2);
  for (const off of [P / 2, P / 2 + 420, P / 2 - 420, P / 2 + 800, P / 2 - 800]) {
    if (off < dw + 30 || off > P - dw - 30) continue;
    const st = shuttleState(rt.len, T, speed, dwell, ph0 + off);
    if (dist3(routePointKeep(rt, st.s, st.dir, keep, {}), hero) > 1200) { ph1 = mod(ph0 + off); break; }
  }
  const hv = view(hero);
  return { phases: [ph0, ph1], check: { len: Math.round(rt.len), period: P, hero: { s: Math.round(sHero), rel: Math.round(hv.rel * 10) / 10, dist: Math.round(hv.d), relWanted: relUsed }, second: Math.round(mod(ph1 - ph0)) } };
}


// ---------------------------------------------------------------------------------------------
// ferry network between the urban ferry terminals (fix round 2, P4): terminals = the 'ferry' / 'landing'
// piers of the urban districts around a point (district2(...).piers / .ferry / .ferries, the same records
// generateCityTile turns into CityTileData docks), linked to the nearest terminal across open water
// (straight crossing or one detour waypoint, every leg sampled every 45 m). Runs in the props worker.
// ---------------------------------------------------------------------------------------------
/** ferryNetwork(ux, uy, uz, radius) -> {terminals:[{id, kind, end:{x,y,z} unit}], routes:[{id, kind, pts:[unit], len}]} */
export function ferryNetwork(ux, uy, uz, radius = 7000) {
  const nearestDistrict = DCHUNKS.nearestDistrict, district1 = DISTRICTS.district1, district2 = DISTRICTS.district2, fromPlane = DISTRICTS.fromPlane;
  const out = { terminals: [], routes: [] };
  if (typeof nearestDistrict !== 'function' || typeof district2 !== 'function' || typeof fromPlane !== 'function') return out;
  const B = enuBasisFromUnit(ux, uy, uz, {});
  const keys = new Set(), ND = {};
  const st = 1000, m = Math.ceil(radius / st);
  for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) {
    const de = i * st, dn = j * st;
    if (Math.hypot(de, dn) > radius + st) continue;
    const x = ux + (B.east[0] * de + B.north[0] * dn) / R, y = uy + (B.east[1] * de + B.north[1] * dn) / R, z = uz + (B.east[2] * de + B.north[2] * dn) / R;
    const l = Math.hypot(x, y, z);
    try { nearestDistrict(x / l, y / l, z / l, ND); keys.add(ND.key); } catch (e) { /* */ }
  }
  const T = [];
  const seenP = new Set();
  for (const dk of keys) {
    let G;
    try { const D1 = district1(dk); if (!D1 || D1.cls === 0) continue; G = district2(dk); } catch (e) { continue; }
    if (!G || !G.D) continue;
    const list = [...(G.piers || [])];
    if (G.ferry) list.push(G.ferry);
    if (Array.isArray(G.ferries)) list.push(...G.ferries);
    list.forEach((p, pi) => {
      if (!p || (p.kind !== 'ferry' && p.kind !== 'landing')) return;
      const key = `${dk}:${Math.round(p.cu)}:${Math.round(p.cv)}`;
      if (seenP.has(key)) return; seenP.add(key);
      const half = (p.len || 60) / 2;
      const e = fromPlane(G.D, p.cu + p.du * (half + 20), p.cv + p.dv * (half + 20), {});
      const d = Math.acos(clamp(e.x * ux + e.y * uy + e.z * uz, -1, 1)) * R;
      if (d > radius) return;
      T.push({ id: `${dk}/f${pi}`, kind: p.kind, end: { x: e.x, y: e.y, z: e.z } });
    });
  }
  out.terminals = T;
  // crossings
  const wet = (x, y, z) => { const l = Math.hypot(x, y, z); return heightAt(x / l, y / l, z / l, 30) < -2.0; };
  const legOk = (a, b) => {
    const L = Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1)) * R;
    const n = Math.max(2, Math.ceil(L / 45));
    for (let k = 1; k < n; k++) {
      const f = k / n, sm = f * L;
      if (sm < 70 || L - sm < 70) continue;                 // berths: shallow approach next to the pier
      if (!wet(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f)) return false;
    }
    return true;
  };
  const dist = (a, b) => Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1)) * R;
  const linked = new Set();
  for (let i = 0; i < T.length; i++) {
    const A = T[i];
    const cand = T.map((Bt, j) => ({ j, d: dist(A.end, Bt.end) })).filter((c) => c.j !== i && c.d > 800 && c.d < 7500).sort((a, b) => a.d - b.d);
    let done = 0;
    for (const c of cand) {
      if (done >= 1) break;
      const Bt = T[c.j];
      const pk = A.id < Bt.id ? `${A.id}|${Bt.id}` : `${Bt.id}|${A.id}`;
      if (linked.has(pk)) { done++; continue; }
      let pts = null;
      if (legOk(A.end, Bt.end)) pts = [A.end, Bt.end];
      else {
        // one detour waypoint either side of the straight line
        const mx = (A.end.x + Bt.end.x) / 2, my = (A.end.y + Bt.end.y) / 2, mz = (A.end.z + Bt.end.z) / 2;
        const dx = Bt.end.x - A.end.x, dy = Bt.end.y - A.end.y, dz = Bt.end.z - A.end.z;
        // perpendicular in the tangent plane: cross(mid, d)
        let px = my * dz - mz * dy, py = mz * dx - mx * dz, pz = mx * dy - my * dx; const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
        for (const off of [0.22, -0.22, 0.4, -0.4]) {
          const k = off * c.d / R;
          const W = { x: mx + px * k, y: my + py * k, z: mz + pz * k };
          if (legOk(A.end, W) && legOk(W, Bt.end)) { pts = [A.end, W, Bt.end]; break; }
        }
      }
      if (!pts) continue;
      linked.add(pk); done++;
      out.routes.push({ id: `T-${pk}`, kind: A.kind === 'landing' && Bt.kind === 'landing' ? 'launch' : 'ferry', pts, len: Math.round(c.d) });
    }
  }
  return out;
}

// 05 background (bookmark S05, fix round 3: the S05X camera; the foreground crossing is the G01 harbour line, see
// s05Phases): a terminal ferry line that crosses the view axis BEYOND the foreground (1.5–6.5 km, within ±12° of the
// heading) gets the phase that puts its first ferry just before that crossing (moving) at the bookmark time
// (constants only: still a pure function of sol time). No line qualifies for the current S05 pose (null).
const SYNC_S05N = { lat: S05X.lat, lon: S05X.lon, heading: S05X.heading, sol: S05X.sol, minDist: 1500, maxDist: 6500, maxRel: 12, lead: 90 };
/** adjust the phase of the best line for the S05 camera (lines: [{rt, type, phases}], in place) */
export function syncFerryLines(lines, types) {
  if (!lines || !lines.length) return null;
  const la = SYNC_S05N.lat * Math.PI / 180, lo = SYNC_S05N.lon * Math.PI / 180;
  const ux = Math.cos(la) * Math.sin(lo), uy = Math.sin(la), uz = Math.cos(la) * Math.cos(lo);
  const B = enuBasisFromUnit(ux, uy, uz, {});
  const cx = ux * R, cy = uy * R, cz = uz * R;
  let best = null;
  const P = {};
  for (const F of lines) {
    const rt = F.rt;
    for (let s = rt.len * 0.15; s <= rt.len * 0.85; s += 20) {          // mid-crossing only
      routePoint(rt, s, P);
      const dx = P.x - cx, dy = P.y - cy, dz = P.z - cz;
      const e = dx * B.east[0] + dy * B.east[1] + dz * B.east[2], n = dx * B.north[0] + dy * B.north[1] + dz * B.north[2];
      const d = Math.hypot(e, n);
      if (d > SYNC_S05N.maxDist || d < SYNC_S05N.minDist) continue;
      let rel = Math.atan2(e, n) * 180 / Math.PI - SYNC_S05N.heading; rel = ((rel + 540) % 360) - 180;
      if (Math.abs(rel) > SYNC_S05N.maxRel) continue;
      const score = d * (1 + Math.abs(rel) / 30);
      if (!best || score < best.score) best = { score, d, rel, s, F };
    }
  }
  if (!best) return null;
  const T = SYNC_S05N.sol * 3600;
  const F = best.F, sp = types[F.type].speed;
  const per = shuttlePeriod(F.rt.len, sp, 240).P;
  const s0 = Math.max(1, best.s - SYNC_S05N.lead);
  F.phases[0] = ((shuttlePhaseFor(F.rt.len, sp, 240, T, s0) % per) + per) % per;
  if (F.phases.length > 1) F.phases[1] = F.phases[0] + per / 2;
  return { id: F.rt.id, dist: Math.round(best.d), rel: Math.round(best.rel * 10) / 10, s: Math.round(best.s) };
}
