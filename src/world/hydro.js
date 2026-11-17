// Water bodies (pure, worker-safe). OWNER: terrain-fn agent. CONTRACT (ARCHITECTURE.md §5):
//   waterAt(x, y, z, out) -> out = { type, level, depth, dist, width, flow:[e,n] }
//     type: 0 none | 1 sea (level 0) | 2 canal / river / spillway | 3 lake / reservoir
//     level: water surface height (m); depth: level - ground height (m, > 0 when submerged)
//     dist: distance to the channel centreline (m, type 2; 1e9 otherwise); width: channel width (m)
//     flow: unit flow direction in local east / north (canals, rivers, spillways)
//     Extra (additive): id (stable water-body id), kind ('sea'|'harbour'|'canal'|'ditch'|'river'|
//     'spillway'|'marsh'|'melt'|'pond'|'tarn'|'reservoir'), order (canal order 0..2), ground (m).
//   canalsInTile(face, level, x, y) -> [{id, order, width, level0, level1, points:[[lat,lon]...],
//     sluices:[{lat, lon, upLevel, downLevel, heading}], kind}]  (kind: 'canal'|'ditch'|'river'|'spillway')
//     Channels that intersect the tile are returned whole (not cut) with stable ids so neighbouring
//     tiles can de-duplicate; branch canals from tile level >= 9, field ditches from level >= 13.
//     Main canals carry their sluices (pump houses / sluice stations); levels are flat between
//     sluices. Rivers are the canyon / gorge floor rivers; 'spillway' is the G02 outflow channel.
//     Sluices (D2): upLevel = upstream (higher) >= downLevel, heading = downstream flow, steps <= 12 m
//     (staircases). Additive: flow (+1 = water flows along the point order), pumps [{lat, lon, downLevel,
//     upLevel, heading}] (lifts where the ground rises; not sluices), melt ('foot'|'outflow': OX4 meltwater
//     rivers MW-* / MO-*). scripts/check-terrain-sluice.mjs checks the invariants.
//   iceFootSystem() -> OX4 cliff foot / meltwater channel / outlets + pools (world/terrain/icefoot.js).
//   lakesInTile(face, level, x, y) -> [{id, kind, level, lat, lon, radius}] (additive helper)
//   The sea is wherever terrain < 0 (coast metric < 0); inland lakes / canals / reservoirs carry
//   explicit levels. Seas: the two inner seas (+ ZR4 island sea, ZR5 basin bay, OX1 estuaries) and
//   the OX3 赤岸海 inland sea at sea level (scripts/check-terrain.mjs checks the components).
//   ZR4 晨曦群岛: a network of navigable straits (0.5-3 km, nodal lines of two noise families,
//   applied after the fractal coast so nothing closes them) cuts the island chains and joins the
//   inter-island waters to the east sea (scripts/check-terrain-arch.mjs: ~98 % of the island-sea
//   water connected at 1.5 km; the rest are small lagoons / straits below the check grid).
//   OX3 赤岸海 is the one deliberate exception to "connected": the map has no sea within ~1400 km
//   of 135W, so the tidal coast is built around a modest closed sea held at level 0 (type 1).
import { R } from '../core/constants.js';
import { tileBounds, vecToFace, faceToVec } from '../core/geo.js';
import { heightWithFields, WATER_INFO } from './terrain/index.js';
import { newFields } from './terrain/field.js';
import { canalsInRect, outletCanal } from './terrain/irrigation.js';
import { LINE_DATA, linePoint, lineNormal } from './terrain/layout.js';
import { canyonOffset } from './terrain/relief.js';
import { SITES, localToLatLon } from './sites.js';
import { meltPublic, meltChannelsInRect, meltPoolsInRect } from './terrain/icefoot.js';
import { OX1_BASIN, OUTLET, basinToLatLon } from './terrain/basin.js';

export const WaterType = { NONE: 0, SEA: 1, CANAL: 2, LAKE: 3 };
const F = newFields();

export function waterAt(x, y, z, out = {}) {
  const h = heightWithFields(x, y, z, 0.5, F, null);
  const W = WATER_INFO;
  out.type = W.type;
  out.level = W.type === 1 ? 0 : W.type ? W.level : 0;
  out.depth = W.type ? out.level - h : -h;
  out.dist = W.type === 2 ? W.dist : 1e9;
  out.width = W.type === 2 ? W.width : 0;
  const fl = out.flow || (out.flow = [0, 0]);
  fl[0] = W.fx; fl[1] = W.fy;
  out.id = W.id; out.kind = W.kind; out.order = W.order; out.ground = h;
  return out;
}

// ---------------------------------------------------------------------------------------------
// rivers of the canyon / gorge lines, as vector channels
// ---------------------------------------------------------------------------------------------
const VF = {}, P3 = new Float64Array(3), N3 = new Float64Array(3);
function riversInRect(f, a0, a1, b0, b1) {
  const out = [];
  const ma = (a1 - a0) * 0.1;
  for (const ld of LINE_DATA) {
    if (ld.kind !== 'canyon' && ld.kind !== 'valley') continue;
    const rv = ld.params.river;
    if (!rv) continue;
    let run = null;
    const flush = () => { if (run && run.points.length >= 2) out.push(run); run = null; };
    for (let k = 0; k < ld.pts.length; k++) {
      if (rv[k] <= 0) { flush(); continue; }
      const p = ld.pts[k];
      vecToFace(p[0], p[1], p[2], VF);
      const inside = VF.face === f && VF.a >= a0 - ma && VF.a <= a1 + ma && VF.b >= b0 - ma && VF.b <= b1 + ma;
      if (!inside) { flush(); continue; }
      // meander-corrected centreline (matches the carved floor): d + offset = 0
      linePoint(ld, Math.min(k, ld.pts.length - 1.000001), P3);
      lineNormal(ld, Math.min(k, ld.nSeg - 1), N3);
      const hw = ld.params.hw[k] * 1000;
      let off = canyonOffset(hw, P3[0] * R, P3[1] * R, P3[2] * R);
      let x = P3[0] - N3[0] * off / R, y = P3[1] - N3[1] * off / R, z = P3[2] - N3[2] * off / R;
      // one refinement step (the offset is evaluated at the shifted point)
      off = canyonOffset(hw, x * R, y * R, z * R);
      x = P3[0] - N3[0] * off / R; y = P3[1] - N3[1] * off / R; z = P3[2] - N3[2] * off / R;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const lev = +Math.max(0.3, ld.params.floor[k] - 0.6).toFixed(2);
      if (!run) run = { id: `R-${ld.id}-${k}`, kind: 'river', order: 0, width: +rv[k].toFixed(1), level0: lev, level1: lev, points: [], sluices: [] };
      run.points.push([Math.asin(y) * 180 / Math.PI, Math.atan2(x, z) * 180 / Math.PI]);
      run.level1 = lev;
      run.width = Math.max(run.width, +rv[k].toFixed(1));
    }
    flush();
  }
  return out;
}

function inTile(face, b, lat, lon) {
  const c = Math.cos(lat * Math.PI / 180);
  vecToFace(c * Math.sin(lon * Math.PI / 180), Math.sin(lat * Math.PI / 180), c * Math.cos(lon * Math.PI / 180), VF);
  return VF.face === face && VF.a >= b.a0 && VF.a <= b.a1 && VF.b >= b.b0 && VF.b <= b.b1;
}

export function canalsInTile(face, level, x, y) {
  const b = tileBounds(face, level, x, y);
  if (level < 5) return [];
  const list = canalsInRect(face, b.a0, b.a1, b.b0, b.b1, level);
  for (const r of riversInRect(face, b.a0, b.a1, b.b0, b.b1)) list.push(r);
  const ws = SITES.waterStairs;
  for (const ch of ws.spillChannels) {
    const pts = ch.points.map(([px, pz]) => { const ll = localToLatLon(ws, px, pz); return [ll.lat, ll.lon]; });
    let hit = false;
    for (const [la, lo] of pts) if (inTile(face, b, la, lo)) { hit = true; break; }
    if (hit) list.push({ id: ch.id, kind: 'spillway', order: 0, width: ch.width, level0: ch.level0, level1: ch.level1, points: pts, sluices: ch.sluices || [] });
  }
  if (northOX4(face, b)) for (const m of meltChannelsInRect(face, b.a0, b.a1, b.b0, b.b1)) list.push(m);
  return list;
}

/**
 * OX1 东泽汇水盆地 (world/terrain/basin.js): { id, name, lake: {id, kind 'lake', level, lat, lon, radius},
 * outlet: canal record (id 'OX1-BL1-OUT', kind 'canal', order 0, flow +1, sluices from the lake level down to the main
 * canal at its end), centre: {lat, lon}, axis (bearing outlet -> basin head), sill: {lat, lon} }.
 */
export function ox1Basin() {
  const c = basinToLatLon(0, 0), sl = basinToLatLon(OUTLET.pts[0][0], OUTLET.pts[0][1]);
  return { id: OX1_BASIN.id, name: OX1_BASIN.name, lake: basinLake(), outlet: outletCanal(), centre: { lat: c[0], lon: c[1] }, axis: OX1_BASIN.axis, sill: { lat: sl[0], lon: sl[1] } };
}
function basinLake() {
  const c = basinToLatLon(0, 0);
  return { id: OX1_BASIN.lakeId, kind: 'lake', level: OX1_BASIN.level, lat: +c[0].toFixed(5), lon: +c[1].toFixed(5), radius: 8500 };
}
/** does the tile come within r metres of (lat, lon)? (corners + centre + edge midpoints) */
function tileNearDisc(face, b, lat, lon, r) {
  const c = Math.cos(lat * Math.PI / 180);
  const px = c * Math.sin(lon * Math.PI / 180), py = Math.sin(lat * Math.PI / 180), pz = c * Math.cos(lon * Math.PI / 180);
  const am = (b.a0 + b.a1) / 2, bm = (b.b0 + b.b1) / 2;
  for (const [a, bb] of [[b.a0, b.b0], [b.a1, b.b0], [b.a0, b.b1], [b.a1, b.b1], [am, bm], [am, b.b0], [am, b.b1], [b.a0, bm], [b.a1, bm]]) {
    faceToVec(face, a, bb, VT);
    const d = Math.acos(Math.min(1, VT.x * px + VT.y * py + VT.z * pz)) * R;
    if (d < r) return true;
  }
  return false;
}
/** could the tile reach the OX4 meltwater system (north of 66N, 0-90E)? cheap corner test */
const VT = {};
function northOX4(face, b) {
  for (const [a, bb] of [[b.a0, b.b0], [b.a1, b.b0], [b.a0, b.b1], [b.a1, b.b1], [(b.a0 + b.a1) / 2, (b.b0 + b.b1) / 2]]) {
    faceToVec(face, a, bb, VT);
    const lat = Math.asin(Math.max(-1, Math.min(1, VT.y))) * 180 / Math.PI, lon = Math.atan2(VT.x, VT.z) * 180 / Math.PI;
    if (lat > 64 && lon > -5 && lon < 95) return true;
  }
  return false;
}

/**
 * OX4 北冠冰缘 meltwater system (§5 04): { foot: [[lat, lon]...] cliff-foot line (west -> east, ice to the
 * north / left), reaches: [{id, flow, points, levels, widths}] ice-marginal channel ~260 m outside the foot
 * (flow +1 = downstream along the point order), outlets: [{id, lat, lon, level, heading (outward, deg),
 * footLat, footLon, pool:{id, lat, lon, radius, level} forebay pool (pump intake), lake:{...} meltwater lake
 * at the outflow end, channel: [[lat, lon]...] outflow (downstream order), levels}] }. Built once per thread
 * (~0.2 s); deterministic. Channels are waterAt type 2 kind 'river' (ids MW-*, MO-*), pools type 3 kind
 * 'melt' (MP-* forebay, ML-* lake).
 */
export function iceFootSystem() { return meltPublic(); }

/** G02 reservoirs overlapping a tile (lakes from the procedural classes are found via waterAt) */
export function lakesInTile(face, level, x, y) {
  const b = tileBounds(face, level, x, y);
  const out = [];
  const ws = SITES.waterStairs;
  for (const L of ws.levels) {
    let cx = 0, cz = 0;
    for (const [px, pz] of L.outline) { cx += px; cz += pz; }
    cx /= L.outline.length; cz /= L.outline.length;
    let rad = 0;
    for (const [px, pz] of L.outline) rad = Math.max(rad, Math.hypot(px - cx, pz - cz));
    const ll = localToLatLon(ws, cx, cz);
    if (inTile(face, b, ll.lat, ll.lon) || L.outline.some(([px, pz]) => { const q = localToLatLon(ws, px, pz); return inTile(face, b, q.lat, q.lon); })) {
      out.push({ id: L.id, kind: 'reservoir', level: L.level, lat: ll.lat, lon: ll.lon, radius: Math.round(rad) });
    }
  }
  if (level >= 5 && northOX4(face, b)) for (const p of meltPoolsInRect(face, b.a0, b.a1, b.b0, b.b1)) out.push(p);
  // OX1 basin lake: the tile overlaps its ~9 km disc (corner / centre test against the disc)
  const bl = basinLake();
  if (inTile(face, b, bl.lat, bl.lon) || tileNearDisc(face, b, bl.lat, bl.lon, bl.radius)) out.push(bl);
  return out;
}
