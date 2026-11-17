// G01 protected port city (fix round 2, QS-02 / §5 05, 09): the harbour basin enclosed by the segmented
// tidal barrier (SITES.tidalBarrier) is ringed by a port city instead of the bare plateau the control maps
// give (density ~0.19, rock mask ~0.7). Pure functions of the position (+ the site layout), worker-safe.
//
//   harbourAt(x, y, z, out)  overlay at unit vector p:
//     w     0..1 overlay weight (1 = inside the harbour city, fades 7–11 km inland / beyond the barrier ends)
//     ds    distance (m) to the harbour shoreline (designed bay shore, = the terrain's coast), > 0 inland
//     U, V  G01 frame coords (U along the shore ESE, V offshore SSW; land where V < g01ShoreV(U))
//     env   city envelope (replaces fields.urban there), T settlement influence of the centres + the
//           dense waterfront band, peak (tallest storeys allowed at p), centre (nearest centre id)
//     side  'cargo' (east flank: deep-water quays + port sheds) | 'inner' (bay head: ferry terminal,
//           passenger quay, shaded promenade, low public buildings) | 'west' (residential waterfront)
//   HARBOUR_CENTRES        tower centres 1.5–5 km inland, different peaks (storeys) and spacing
//   harbourCityAnchor()    unit vector of the main centre (the 'city' settlement → main station, metro
//                          links into the ZR1 network)
//   harbourBridge          the inner-bay cable-stayed bridge (U2): landings, pylons (G01 frame)
import { R } from '../../core/constants.js';
import { SITES, unitToLocal, localToUnit, latLonToLocal, g01ToUV, g01FromUV, g01ShoreV } from '../sites.js';
import { vecToFace } from '../../core/geo.js';
import { S0, N0, cell0Key } from './cells.js';

const G1 = SITES.tidalBarrier;
const DEG = Math.PI / 180;
const CX = Math.cos(G1.lat * DEG) * Math.sin(G1.lon * DEG), CY = Math.sin(G1.lat * DEG), CZ = Math.cos(G1.lat * DEG) * Math.cos(G1.lon * DEG);
const LIM = Math.cos(26000 / R);
const LOC = {}, UV = {};

function sstep(e0, e1, x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

/** tower centres (G01 frame, m): peaks in storeys, r = gaussian radius of the centre's influence (m) */
export const HARBOUR_CENTRES = [
  { id: 'west', U: -6300, V: -5200, peak: 32, r: 2000, amp: 0.95 },
  { id: 'headW', U: -2500, V: -8200, peak: 46, r: 2300, amp: 1.0 },
  { id: 'head', U: 350, V: -9600, peak: 60, r: 2700, amp: 1.0 },
  { id: 'headE', U: 3000, V: -7900, peak: 38, r: 2100, amp: 0.97 },
  // the old plateau town (round-1 settlement of this cell, 0.745N 129.999E) stays a low-rise northern centre
  { id: 'north', lat: 0.745, lon: 129.999, peak: 24, r: 2900, amp: 0.74 },
];
for (const c of HARBOUR_CENTRES) {
  if (c.lat !== undefined) { const l = latLonToLocal(G1, c.lat, c.lon, {}); g01ToUV(l.x, l.z, UV); c.U = Math.round(UV.u); c.V = Math.round(UV.v); }
  const [x, z] = g01FromUV(c.U, c.V); const p = localToUnit(G1, x, z, {}); c.x = p.x; c.y = p.y; c.z = p.z;
}

// harbour shoreline samples (designed bay shore = terrain coast metric, sitezones.js g01Coast)
const SH_U0 = -7000, SH_DU = 100, SH_N = 141;
const SHV = new Float64Array(SH_N);
for (let k = 0; k < SH_N; k++) SHV[k] = g01ShoreV(SH_U0 + k * SH_DU);

/** quick test: can p be inside the overlay at all? */
export function nearHarbour(x, y, z) { return x * CX + y * CY + z * CZ > LIM; }

/** distance (m) from G01-frame point (u, v) to the shoreline polyline; > 0 on the land side */
export function shoreDist(u, v) {
  const k0 = Math.max(0, Math.min(SH_N - 1, Math.round((u - SH_U0) / SH_DU)));
  const span = 40;   // ±4 km of shore around the foot point is plenty for the overlay band
  let best = 1e18;
  for (let k = Math.max(0, k0 - span); k < Math.min(SH_N - 1, k0 + span); k++) {
    const ax = SH_U0 + k * SH_DU, ay = SHV[k], ex = SH_DU, ey = SHV[k + 1] - ay;
    const l2 = ex * ex + ey * ey;
    let t = ((u - ax) * ex + (v - ay) * ey) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + ex * t - u, dy = ay + ey * t - v, d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  const d = Math.sqrt(best);
  return v < g01ShoreV(u) ? d : -d;
}

/** overlay at unit vector (x,y,z) → out (see header); out.w = 0 far from the harbour */
export function harbourAt(x, y, z, out) {
  out.w = 0; out.env = 0; out.T = 0; out.peak = 0; out.ds = 1e9; out.U = 0; out.V = 0; out.side = ''; out.centre = '';
  out.tower = 0; out.cluster = ''; out.crown = 0; out.peak0 = 0;
  if (!nearHarbour(x, y, z)) return out;
  if (!unitToLocal(G1, x, y, z, LOC)) return out;
  g01ToUV(LOC.x, LOC.z, UV);
  const u = UV.u, v = UV.v;
  out.U = u; out.V = v;
  const ds = shoreDist(u, v);
  out.ds = ds;
  // the city rings the protected basin: full weight within ~7 km of its shore, none beyond the barrier ends
  let w = (1 - sstep(7000, 11000, ds)) * (1 - sstep(6600, 9200, Math.abs(u))) * (v < 600 ? 1 : 0);
  if (ds > 2000) for (const c of HARBOUR_CENTRES) { const q = Math.hypot(u - c.U, v - c.V) / c.r; if (q < 2.4) { const wc = 1 - sstep(1.4, 2.4, q); if (wc > w) w = wc; } }
  if (w <= 0) return out;
  out.w = w;
  out.side = u > 2600 && v > -6000 ? 'cargo' : u < -2600 && v > -6200 ? 'west' : 'inner';
  // centres + the dense waterfront band
  let T = 0.48 * Math.exp(-(ds * ds) / (1400 * 1400)), best = 1e18, peak = 0;
  for (const c of HARBOUR_CENTRES) {
    const du = u - c.U, dv = v - c.V, d2 = du * du + dv * dv;
    const t = c.amp * Math.exp(-d2 / (c.r * c.r));
    if (t > T) T = t;
    const q = d2 / (c.r * c.r);
    if (q < best) { best = q; out.centre = c.id; peak = c.peak; }
  }
  // round-2 storey cap (kept for the district record D.peakFloors: blocks of harbour districts outside the overlay)
  out.peak0 = Math.max(6, Math.round(peak * (1 - 0.76 * sstep(0.55, 1.35, Math.sqrt(best))) * (0.55 + 0.45 * sstep(300, 1500, ds))));
  // tallest storeys allowed (fix round 3, U2): separate tower clusters of clearly different heights over a mid-rise
  // city, low by the water (skylineAt; the weight / envelope / T above keep the round-2 centres, so the district plan,
  // settlements and corridors do not move)
  skylineAt(u, v, ds, SKY);
  out.peak = SKY.cap; out.tower = SKY.tower; out.cluster = SKY.cluster; out.crown = SKY.crown;
  out.T = T * w;
  out.env = w * (0.94 - 0.30 * sstep(3500, 10000, ds));
  return out;
}

// ---------------------------------------------------------------------------------------------
// U2 (fix round 3): skyline of the harbour city. Tower clusters with clearly different peaks and spacing — a landmark
// CBD by the main station (crown ~78 storeys), a 35–45 storey cluster west of the bay head, a 20–28 storey cluster to
// the east (all three in the S05 frame across the inner bay, bridge in front), the west-shore residential centre and the
// old plateau town north as low centres — over a 8–12 storey mid-rise city with real gaps between the clusters, and a
// low (3–5 storey) public front row along the water rising inland. Storey caps only (builders.js Builder.peak, block
// uses in parcels.js harbourUse); positions in the G01 frame (m), r = gaussian radius of the cluster profile.
// ---------------------------------------------------------------------------------------------
export const HARBOUR_SKYLINE = [
  // landmark CBD by the main station: one supertall spike (spike radius, m) over a 35–55 storey cluster
  { id: 'crown', U: 150, V: -9600, peak: 78, r: 720, spike: 170, use: 'podium' },
  { id: 'eastTowers', U: 1500, V: -8900, peak: 44, r: 520, use: 'mixed' },    // 35–45 storeys, 1.5 km east of the crown
  { id: 'westTowers', U: -1040, V: -7400, peak: 28, r: 500, use: 'park' },    // 20–28 storeys, 2.5 km west, nearer the bay
  { id: 'west', U: -6300, V: -5200, peak: 22, r: 700, use: 'park' },          // west-shore residential centre
  { id: 'north', U: 31, V: -16639, peak: 14, r: 1300, use: 'park' },          // the old plateau town
];
const SKY = {};
/** storey cap at G01-frame point (u, v) with shore distance ds → out {cap, tower (0..1 tower-block share), cluster, crown} */
export function skylineAt(u, v, ds, out) {
  // mid-rise base 6–12 storeys: lower toward the bay (the clusters rise clear of it), smooth undulation, no towers
  let base = 6.5 + 5 * sstep(600, 3200, ds) + Math.sin(u / 1650 + 0.7) * Math.cos(v / 2100 - 0.4);
  base = base < 6 ? 6 : base > 12 ? 12 : base;
  let cap = base, cl = '', crown = 0, kb = 0;
  for (const c of HARBOUR_SKYLINE) {
    const du = u - c.U, dv = v - c.V, q2 = (du * du + dv * dv) / (c.r * c.r);
    if (q2 > 9) continue;
    const k = c.spike ? c.peak * (0.66 * Math.exp(-q2) + 0.34 * Math.exp(-(du * du + dv * dv) / (c.spike * c.spike))) : c.peak * Math.exp(-q2);
    if (k > kb) { kb = k; cl = c.id; crown = q2 < 0.07 ? 1 : 0; }
    if (k > cap) cap = k;
  }
  // low public front row by the water (3–5 storeys), rising inland
  cap = Math.min(cap, 4 + 8 * sstep(110, 500, ds) + 90 * sstep(700, 1500, ds));
  out.cap = Math.max(3, Math.round(cap));
  out.tower = sstep(14, 22, cap);
  out.cluster = cap > base + 1 ? cl : '';
  out.crown = out.cluster ? crown : 0;
  return out;
}
export function skylineCentre(id) { return HARBOUR_SKYLINE.find((c) => c.id === id) || null; }

const HC0 = HARBOUR_CENTRES.find((c) => c.id === 'head');
/** main centre of the harbour city (the settlement that carries the main station / metro links) */
export function harbourCityAnchor() { return HC0; }
/** level-0 cell key holding the main centre: that cell's settlement candidate IS the harbour city */
export const HARBOUR_CELL = (() => {
  const f = vecToFace(HC0.x, HC0.y, HC0.z, {});
  const cx = Math.min(N0 - 1, Math.floor((f.a + 1) / S0)), cy = Math.min(N0 - 1, Math.floor((f.b + 1) / S0));
  return cell0Key(f.face, cx, cy);
})();

// ---------------------------------------------------------------------------------------------
// U2: the inner-bay harbour bridge (cable-stayed main span over the ferry channel to the bay head,
// pylons on pylon islands, girder approaches on piers; bridgehead communities on both shores)
// ---------------------------------------------------------------------------------------------
const BR_V = -5700;                          // chord across the inner bay (G01 frame), 800 m off the bay head
export const harbourBridge = (() => {
  // landings: where the chord meets the shore (+ 180 m inland: the bridgehead approach starts there)
  let ua = 0, ub = 0;
  for (let uu = 0; uu < 6000; uu += 5) if (g01ShoreV(uu) > BR_V) { ub = uu; break; }
  for (let uu = 0; uu > -6000; uu -= 5) if (g01ShoreV(uu) > BR_V) { ua = uu; break; }
  const ext = 420;                           // bridgehead approach on land (m) beyond each shore point
  const A = [ua - ext, BR_V - 40], B = [ub + ext, BR_V + 40];   // slightly skewed: crosses the channel square-ish
  const toLL = (U, V) => { const [x, z] = g01FromUV(U, V); const p = localToUnit(G1, x, z, {}); return { x: p.x, y: p.y, z: p.z, lat: Math.asin(p.y) / DEG, lon: Math.atan2(p.x, p.z) / DEG }; };
  const pylonsUV = [[-330, BR_V - 3], [330, BR_V + 3]];
  return {
    id: 'BG01', A, B, shoreA: ua, shoreB: ub, ext, V: BR_V,
    a: toLL(A[0], A[1]), b: toLL(B[0], B[1]),
    pylons: pylonsUV.map(([U, V]) => ({ U, V, ...toLL(U, V), h: 128, shape: 'A', base: 'island', baseR: 70 })),
    mainSpan: 660, clearance: 46, width: 34, toLL,
  };
})();
