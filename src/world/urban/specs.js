// BuildingSpec construction and stable IDs (ARCHITECTURE.md §5).
//
// ID = "<province>-<district>-<block>-<index>", e.g. "ZR1-0.3.1a5.17z-n8.n6-4"
//   province  code of the province at the building anchor (OX1..OX6, ZR1..ZR6; informative)
//   district  face.level.x36.y36 of the district seed cell (quadtree under the cube face)
//   block     i.j street-grid cell inside the district ('n' marks negatives)
//   index     building index inside the block layout (deterministic order)
// buildingSpecById regenerates only that district record + block layout (no global state).
import { PROVINCE_CODES } from '../../core/constants.js';
import { hash4 } from '../../core/hash.js';
import { unitToLatLon } from '../../core/geo.js';
import { provinceAt, zoneAt } from '../../data/controlMaps.js';
import { URBAN_VERSION, DC, DC_NAMES, BU_NAMES, RoofKindNames } from './rules.js';
import { districtId, parseDistrictId, district2, fromPlane, planeHeading } from './districts.js';
import { blockLayout, blockIdStr, parseBlockId } from './parcels.js';
import { districtExists } from './dseeds.js';
import { height } from './probe.js';
import { stationRailLevel } from './corridors.js';
import { buildingOccupancy } from '../occupancy.js';

const Q = {}, LL = {};

export function makeBuildingId(G, L, b, provCode) {
  return `${provCode}-${districtId(G.key)}-${blockIdStr(L.i, L.j)}-${b.idx}`;
}

export function parseBuildingId(id) {
  if (typeof id !== 'string') return null;
  const p = id.split('-');
  if (p.length !== 4) return null;
  const dkey = parseDistrictId(p[1]);
  if (dkey < 0) return null;
  const bj = parseBlockId(p[2]);
  if (!bj) return null;
  if (!/^\d+$/.test(p[3])) return null;
  const k = parseInt(p[3], 10);
  return { prov: p[0], dkey, i: bj.i, j: bj.j, k };
}

const r2 = (x) => Math.round(x * 100) / 100;
/** plane point → building local [x, z] (x right, z front) */
function toLocal(b, u, v) { const du = u - b.cu, dv = v - b.cv; return [r2(du * b.xu + dv * b.xv), r2(du * b.fu + dv * b.fv)]; }
/** building local (x,z) → plane */
function toPlaneB(b, x, z, out) { out.u = b.cu + x * b.xu + z * b.fu; out.v = b.cv + x * b.xv + z * b.fv; return out; }

/**
 * Ground heights at full detail on a 0.25 m lattice of the district plane. The height is evaluated AT
 * the lattice point (not at the first requested position), so a value never depends on which caller
 * asked first: party-wall corners of terraces share their samples within one tile generation, and
 * buildingSpecById (fresh memo) returns exactly the same numbers as generateCityTile.
 */
export class GroundMemo {
  constructor() { this.m = new Map(); }
  at(D, u, v) {
    const ku = Math.round(u * 4), kv = Math.round(v * 4);
    const k = `${D.key}:${ku}:${kv}`;
    let h = this.m.get(k);
    if (h === undefined) { fromPlane(D, ku / 4, kv / 4, Q); h = height(Q.x, Q.y, Q.z, 0); this.m.set(k, h); }
    return h;
  }
}
const PB = {};

/** full BuildingSpec for layout building b of block layout L in district G */
export function buildSpec(G, L, b, memo = null) {
  const D = G.D;
  const M = memo || new GroundMemo();
  fromPlane(D, b.cu, b.cv, Q);
  unitToLatLon(Q.x, Q.y, Q.z, LL);
  const lat = LL.lat, lon = LL.lon;
  const province = provinceAt(lat, lon);
  const provinceCode = PROVINCE_CODES[province] || D.code;
  const zone = zoneAt(lat, lon);
  const id = makeBuildingId(G, L, b, provinceCode);
  const hash = hash4(G.key, L.i, L.j, 0x5bec + b.idx) >>> 0;
  const heading = r2(planeHeading(D, b.fu, b.fv));
  const w = b.w, d = b.d;
  // footprint (building local: x right, z front)
  let footprint;
  if (b.shape === 'round') footprint = { shape: 'round', w: r2(w), d: r2(w) };
  else if (b.shape === 'tower') footprint = { shape: 'tower', w: r2(w), d: r2(d) };
  else if (b.local && (b.shape === 'L' || b.shape === 'U' || b.shape === 'court' || b.shape === 'poly')) footprint = { shape: b.shape, w: r2(w), d: r2(d), points: b.local.map(([x, z]) => [r2(x), r2(z)]) };
  else footprint = { shape: 'rect', w: r2(w), d: r2(d) };
  // ground: full-detail terrain at the corners (fl, fr, br, bl), the centre and the main entrance
  const corners = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
  const ch = [];
  let gmin = 1e9, gmax = -1e9;
  for (const [x, z] of corners) {
    toPlaneB(b, x, z, PB);
    const h = M.at(D, PB.u, PB.v);
    ch.push(r2(h));
    if (h < gmin) gmin = h; if (h > gmax) gmax = h;
  }
  const entrances = makeEntrances(b, hash, D);
  const main = entrances.find((e) => e.kind === 'main') || entrances[0];
  let ge = (ch[0] + ch[1]) / 2;
  if (main) {
    const { x, z } = entrancePos(main, w, d);
    toPlaneB(b, x, z, PB);
    ge = M.at(D, PB.u, PB.v);
  }
  if (ge < gmin) gmin = ge; if (ge > gmax) gmax = ge;
  // plot polygon (building local)
  const plot = { id: `${districtId(G.key)}/${blockIdStr(L.i, L.j)}/${b.idx}`, polygon: [] };
  if (b.plot) for (let k = 0; k < b.plot.length; k += 2) plot.polygon.push(toLocal(b, b.plot[k], b.plot[k + 1]));
  const nb = {};
  for (const s of ['left', 'right', 'back']) if (b.nbr[s] >= 0) nb[s] = `${provinceCode}-${districtId(G.key)}-${blockIdStr(L.i, L.j)}-${b.nbr[s]}`;
  const yearBuilt = Math.min(2458, (L.year || D.year0) + b.yearOff);
  const meta = {
    districtClass: DC_NAMES[D.cls], blockUse: BU_NAMES[L.use] || 'none', frontage: b.frontage, roofKind: RoofKindNames[b.roofKind] || 'ceramic',
    height: r2(b.height), covered: !!D.covered, terraced: !!b.meta.terraced || (D.terraced && (b.use === 'residential' || b.use === 'station')),
    cold: !!D.cold, polar: !!D.polar, orient: D.orient, tone: r2(D.tone),
  };
  for (const k in b.meta) if (b.meta[k] !== undefined) meta[k] = b.meta[k];
  if (b.podium) meta.podium = { floors: b.podium.floors, height: r2(b.podium.height), floorHeight: b.podium.floorHeight };
  if (b.tower) {
    const [tx, tz] = toLocal(b, b.tower.cu, b.tower.cv);
    meta.tower = { w: r2(b.tower.w), d: r2(b.tower.d), x: tx, z: tz, shape: b.tower.round ? 'round' : 'rect' };
  }
  if (b.station) {
    const st = b.station;
    meta.trackHeading = r2(st.heading); meta.platformSide = 'back'; meta.platformLength = st.plen; meta.stationKind = st.kind;
    meta.elevated = !!st.elev; meta.main = !!st.main;
    // D1 STATION_GEOM: level rail bed over the platform at railLevel (m above sea level, = tile rails
    // polyline y there); railGround = railLevel − ground.entrance; trackOffset = building-frame z of the
    // track centreline (negative: the tracks run along x behind the back facade, centres trackOffset ± 2.0)
    const rl = st.ref ? stationRailLevel(st.ref) : ge;
    meta.railLevel = r2(rl);
    meta.railGround = r2(rl - ge);
    meta.trackOffset = r2((st.u - b.cu) * b.fu + (st.v - b.cv) * b.fv);
    meta.railHead = r2(rl - ge + (st.elev ? 9.0 : 0.35));
  }
  if (b.use === 'school') meta.yardSide = meta.yardSide || 'back';
  if (b.use === 'pumphouse' || b.use === 'sluice_station') { meta.poolSide = meta.poolSide || 'back'; if (meta.canalId === undefined) meta.canalId = null; }
  if (b.shape === 'round') meta.radius = r2(w / 2);
  return {
    id, hash, version: URBAN_VERSION, province, provinceCode, zone,
    use: b.use, tier: b.tier, style: styleOf(D, b),
    lat, lon, heading,
    ground: { entrance: r2(ge), min: r2(gmin), max: r2(gmax), corners: ch },
    footprint,
    floors: b.floors, floorHeight: b.fh, groundFloorHeight: b.gfh,
    basement: b.basement || (b.tier === 'tower' || b.tier === 'landmark' ? 2 : 0),
    roof: b.roofType,
    plot,
    block: `${districtId(G.key)}/${blockIdStr(L.i, L.j)}`,
    district: districtId(G.key),
    neighbors: nb,
    sharedWalls: { left: !!b.shared.left, right: !!b.shared.right, back: !!b.shared.back },
    entrances,
    occupancy: Math.round(buildingOccupancy(hash, b.use) * 1000) / 1000,
    yearBuilt,
    meta,
  };
}

function styleOf(D, b) {
  const base = D.rules.style || (D.zone === 'O' ? 'O-utility' : 'Z-ceramic');
  if (D.zone === 'Z') {
    if (b.tier === 'tower' || b.tier === 'landmark') return D.cold ? 'Z-cold' : 'Z-glass';
    if (b.use === 'port_shed' || b.use === 'warehouse') return 'Z-port';
    if (b.use === 'office' || b.use === 'research') return D.cold ? 'Z-cold' : 'Z-glass';
    if (D.terraced) return 'Z-terrace';
    return base;
  }
  if (D.polar) return 'O-polar';
  return base;
}

/** entrance position (building local x,z) for an entrance record */
export function entrancePos(e, w, d) {
  switch (e.side) {
    case 'front': return { x: e.offset, z: d / 2 };
    case 'back': return { x: -e.offset, z: -d / 2 };
    case 'left': return { x: -w / 2, z: -e.offset };
    default: return { x: w / 2, z: e.offset };
  }
}

function makeEntrances(b, hash, D) {
  const w = b.w, d = b.d, E = [];
  const r = (k) => (hash4(hash, k, 0xe17, 0) / 4294967296);
  const free = (side) => !b.shared[side];
  const add = (kind, side, offset, width) => E.push({ kind, side, offset: r2(offset), width: r2(width) });
  const use = b.use;
  const mainOff = (r(1) - 0.5) * Math.max(0, w * 0.5 - 3);
  switch (use) {
    case 'shop_row': {
      add('main', 'front', w > 10 ? -w / 2 + 2.2 : 0, 1.4);
      const n = Math.max(1, Math.floor((w - 4) / 7));
      for (let k = 0; k < n; k++) add('shop', 'front', -w / 2 + 4 + (k + 0.5) * ((w - 4) / n), 2.6);
      if (free('back')) add('service', 'back', (r(2) - 0.5) * w * 0.4, 1.2);
      else if (free('left')) add('service', 'left', 0, 1.2);
      if (b.meta.corner && free('right')) add('shop', 'right', d * 0.15, 2.6);
      break;
    }
    case 'station': {
      add('main', 'front', 0, 8);
      add('main', 'front', -w * 0.32, 4); add('main', 'front', w * 0.32, 4);
      const n = Math.max(2, Math.round(w / 40));
      for (let k = 0; k < n; k++) add('platform', 'back', -w / 2 + (k + 0.5) * (w / n), 4);
      add('service', free('left') ? 'left' : 'right', 0, 3);
      break;
    }
    case 'ferry_terminal': {
      add('main', 'front', 0, 6); add('ferry', 'back', 0, 4); add('service', free('left') ? 'left' : 'right', 0, 2.4);
      break;
    }
    case 'warehouse': case 'port_shed': case 'cold_storage': case 'service_depot': case 'farm_station': {
      add('main', 'front', w * 0.35 * (r(3) < 0.5 ? -1 : 1), 1.2);
      const side = use === 'port_shed' ? 'front' : (free('right') ? 'right' : 'back');
      const L = side === 'right' ? d : w;
      const n = Math.max(1, Math.floor(L / 14));
      for (let k = 0; k < n; k++) add('loading', side, -L / 2 + (k + 0.5) * (L / n), 4.2);
      break;
    }
    case 'school':
      add('main', 'front', mainOff * 0.5, 3.2); add('yard', 'back', 0, 2.4); add('service', free('left') ? 'left' : 'right', 0, 1.6); break;
    case 'clinic':
      add('main', 'front', mainOff * 0.5, 3.0); add('ambulance', 'right', -d * 0.2, 3.6); add('service', 'back', 0, 1.6); break;
    case 'greenhouse':
      add('main', 'front', 0, 2.4); add('service', 'back', 0, 3.2); break;
    case 'pumphouse': case 'sluice_station': case 'meltwater_pump': case 'water_treatment':
      add('control', 'front', -w * 0.25, 1.4); add('main', 'front', w * 0.2, 1.2); add('equipment', free('right') ? 'right' : 'left', 0, 3.6); add('maintenance', 'back', w * 0.2, 1.2); break;
    case 'insulated_station':
      add('airlock', 'front', mainOff * 0.3, 2.0); add('service', free('right') ? 'right' : 'left', 0, 3.6); break;
    case 'control_tower':
      add('main', 'front', 0, 1.2); break;
    case 'office': case 'residential_tower': case 'civic_tower': case 'research':
      add('main', 'front', mainOff * 0.3, b.tier === 'landmark' ? 8 : 4);
      add('service', free('back') ? 'back' : (free('left') ? 'left' : 'right'), (r(4) - 0.5) * w * 0.3, 2.4);
      if (b.tier === 'tower' || b.tier === 'landmark') add('garage', free('right') ? 'right' : 'left', d * 0.3, 6);
      break;
    case 'market': case 'community':
      add('main', 'front', 0, use === 'market' ? 6 : 3); if (free('left')) add('main', 'left', 0, 2.4); add('service', free('back') ? 'back' : 'right', w * 0.25, 2.4); break;
    default: {
      // residential, dorm, maintenance, …: street door into the lobby (信报区 + core), back door to yard/lane
      add('main', 'front', mainOff, b.tier === 'midrise' ? 1.8 : 1.2);
      if (b.w > 34 && b.tier !== 'lowrise') add('main', 'front', -mainOff - Math.sign(mainOff || 1) * w * 0.3, 1.8);
      if (b.meta.shops) { const n = Math.max(1, Math.floor((w - 6) / 8)); for (let k = 0; k < n; k++) add('shop', 'front', -w / 2 + 3 + (k + 0.5) * ((w - 6) / n), 2.6); }
      if (free('back')) add(b.meta.backLane ? 'service' : 'back', 'back', (r(5) - 0.5) * w * 0.5, 1.0);
      else if (free('left')) add('service', 'left', 0, 1.0);
      else if (free('right')) add('service', 'right', 0, 1.0);
    }
  }
  return E;
}

/** regenerate a building spec from its id (null when unknown) */
export function specById(id) {
  const p = parseBuildingId(id);
  if (!p) return null;
  if (!districtExists(p.dkey)) return null;
  const G = district2(p.dkey);
  const L = blockLayout(G, p.i, p.j);
  const b = L.bld[p.k];
  if (!b) return null;
  const s = buildSpec(G, L, b);
  return s.id === id ? s : (s.id.split('-').slice(1).join('-') === id.split('-').slice(1).join('-') ? s : null);
}

export { DC };
