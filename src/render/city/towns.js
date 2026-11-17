// G02 work towns (prompt §5 shot 08 "沿途出现少量工作镇和灌区，它们落在可通车的台肩上"; §2 OX5 "工作镇落在
// 泄洪线以外的台肩"): the urban plan has no settlement on the G02 shoulders, so the city synthesises a
// small O-zone work town at each anchor of mega.towns() (= sites.js SITES.waterStairs.towns, where the
// terrain is graded flat at y). Pure, worker-safe, deterministic from (SEED, town id) via core/hash.js.
// Buildings are complete BuildingSpecs (province OX5, zone O, uses of USES.O) and the town streets are
// CityTileData roads; the 'cityTile' worker job appends the ones whose anchor lies in the requested
// L13 tile, so mass models, detailed buildings, picking, colliders, streets and props treat them like
// any other. OWNER: city agent.
import { R } from '../../core/constants.js';
import { latLonToUnit, tileAt, tileCenterUnit, enuBasisFromUnit } from '../../core/geo.js';
import { hash4, hashString } from '../../core/hash.js';
import { SITES, localToLatLon } from '../../world/sites.js';

const TOWN_VERSION = 'g02town-1';
const CACHE = new Map();   // town id -> {buildings, roads}

const rnd = (h, k) => (hash4(h, k, 0x51, 7) >>> 0) / 4294967296;

/** unit vector at (east, north) metres from the town centre (tangent plane, small offsets) */
function offsetLL(B, cu, e, n, out) {
  const x = cu.x + (B.east[0] * e + B.north[0] * n) / R, y = cu.y + (B.east[1] * e + B.north[1] * n) / R, z = cu.z + (B.east[2] * e + B.north[2] * n) / R;
  const l = Math.hypot(x, y, z);
  out.x = x / l; out.y = y / l; out.z = z / l;
  out.lat = Math.asin(out.y) * 180 / Math.PI;
  out.lon = Math.atan2(out.x, out.z) * 180 / Math.PI;
  return out;
}

// lot programme: [use, w, d, floors, floorHeight, groundFloorHeight, tier, roof]
const PROGRAMME = [
  ['dorm', 26, 13, 4, 3.1, 3.4, 'lowrise', 'flat'],
  ['dorm', 32, 13, 3, 3.1, 3.4, 'lowrise', 'flat'],
  ['maintenance', 36, 15, 2, 4.2, 5.0, 'lowrise', 'flat'],
  ['service_depot', 40, 26, 2, 5.0, 5.0, 'utility', 'flat'],
  ['cold_storage', 34, 22, 1, 7.0, 7.0, 'utility', 'flat'],
  ['water_treatment', 30, 24, 2, 4.5, 4.5, 'utility', 'flat'],
  ['farm_station', 28, 18, 2, 4.0, 4.5, 'lowrise', 'flat'],
  ['greenhouse', 9, 32, 1, 5.6, 5.6, 'shed', 'gable'],
];

/**
 * Buildings + streets of one work town. town: {id, lat, lon, y, radius}.
 * Layout: a main street along the town axis, cross streets every ~70 m, lots on both sides of every
 * street (dorms and the control tower near the middle, depots / cold stores / treatment works on the
 * outer lots, greenhouse rows at both ends), all inside 0.62 × radius of the graded shoulder.
 */
export function workTown(town) {
  const key = town.id + '|' + TOWN_VERSION;
  let T = CACHE.get(key);
  if (T) return T;
  const h0 = hashString(town.id) >>> 0;
  const cu = latLonToUnit(town.lat, town.lon, {});
  const B = enuBasisFromUnit(cu.x, cu.y, cu.z, {});
  const y = town.y;
  const half = Math.max(160, (town.radius || 480) * 0.62);
  const axis = rnd(h0, 1) * 180;                       // compass bearing of the main street
  const th = axis * Math.PI / 180;
  const ux = Math.sin(th), un = Math.cos(th);          // along the main street (east, north)
  const vx = Math.cos(th), vn = -Math.sin(th);         // across (right hand)
  const P = (u, v) => [u * ux + v * vx, u * un + v * vn]; // -> (east, north)
  const buildings = [], roads = [];
  const Q = {};
  const nCross = Math.max(2, Math.floor((2 * half) / 72));
  const crossU = [];
  for (let k = 0; k <= nCross; k++) crossU.push(-half + (2 * half * k) / nCross);
  const vHalf = Math.min(half * 0.55, 130);
  // streets: main street (12 m), cross streets (9 m), an outer service loop on the long sides (7 m)
  const line = (id, cls, width, a, b) => roads.push({ id, cls, width, ends: [P(a[0], a[1]), P(b[0], b[1])] });
  line(`${town.id}-M`, 'collector', 12, [-half - 20, 0], [half + 20, 0]);
  for (let k = 0; k < crossU.length; k++) line(`${town.id}-C${k}`, 'local', 9, [crossU[k], -vHalf], [crossU[k], vHalf]);
  line(`${town.id}-SL`, 'service', 7, [-half, -vHalf], [half, -vHalf]);
  line(`${town.id}-SR`, 'service', 7, [-half, vHalf], [half, vHalf]);
  // lots between the cross streets, both sides of the main street
  let idx = 0, towerDone = false;
  for (let k = 0; k < crossU.length - 1; k++) {
    const u0 = crossU[k] + 7, u1 = crossU[k + 1] - 7;
    const mid = Math.abs((u0 + u1) / 2) / half;        // 0 centre … 1 end
    for (const side of [-1, 1]) {
      const vIn = 9, vOut = vHalf - 6;
      let u = u0;
      let row = 0;
      while (u < u1 - 8) {
        const hb = hash4(h0, k, side + 2, row);
        let prog;
        if (mid > 0.72) prog = PROGRAMME[7];
        else if (mid < 0.3) prog = PROGRAMME[(hb >>> 3) % 2];
        else prog = PROGRAMME[2 + ((hb >>> 5) % 5)];
        let [use, w, d, floors, fh, gfh, tier, roof] = prog;
        w *= 0.9 + 0.2 * rnd(hb, 2); d *= 0.9 + 0.2 * rnd(hb, 3);
        const greenhouse = use === 'greenhouse';
        // front faces the main street; greenhouses run across the lots (gable ends to the street)
        const along = greenhouse ? w : w;
        if (u + along > u1 + 2) { if (along < 12) break; w = Math.max(10, u1 - u); }
        const cu2 = u + w / 2;
        const depth = Math.min(d, vOut - vIn);
        const cv = side * (vIn + depth / 2);
        let use2 = use, floors2 = floors, tier2 = tier;
        if (!towerDone && mid < 0.35 && side > 0 && row === 1) { use2 = 'control_tower'; floors2 = 6; tier2 = 'midrise'; w = Math.min(w, 14); towerDone = true; }
        const [e, n] = P(cu2, cv);
        offsetLL(B, cu, e, n, Q);
        const heading = ((axis + (side > 0 ? 270 : 90)) % 360 + 360) % 360;   // front towards the main street
        const id = `OX5-${town.id}-${idx}`;
        const hash = hash4(h0, idx, 0x6f, 5) >>> 0;
        const W = Math.round(w * 100) / 100, D = Math.round(depth * 100) / 100;
        buildings.push({
          id, hash, version: TOWN_VERSION, province: 5, provinceCode: 'OX5', zone: 'O',
          use: use2, tier: tier2, style: 'O-utility', lat: Q.lat, lon: Q.lon, heading: Math.round(heading * 100) / 100,
          ground: { entrance: y, min: y - 0.15, max: y + 0.15, corners: [y, y, y, y] },
          footprint: { shape: 'rect', w: W, d: D },
          floors: floors2, floorHeight: fh, groundFloorHeight: gfh, basement: 0, roof,
          plot: { id: `${town.id}/${k}/${side}/${row}`, polygon: [[-W / 2 - 2, -D / 2 - 2], [W / 2 + 2, -D / 2 - 2], [W / 2 + 2, D / 2 + 2], [-W / 2 - 2, D / 2 + 2]] },
          block: `${town.id}/${k}/${side}`, district: town.id,
          neighbors: {}, sharedWalls: { left: false, right: false, back: false },
          entrances: greenhouse ? [{ kind: 'main', side: 'front', offset: 0, width: 2.4 }, { kind: 'service', side: 'back', offset: 0, width: 3.2 }]
            : [{ kind: 'main', side: 'front', offset: Math.round((rnd(hb, 4) - 0.5) * W * 0.4 * 100) / 100, width: 1.4 }, { kind: use2 === 'service_depot' ? 'loading' : 'back', side: use2 === 'service_depot' ? 'right' : 'back', offset: 0, width: use2 === 'service_depot' ? 4.2 : 1.0 }],
          occupancy: Math.round((0.62 + 0.3 * rnd(hb, 5)) * 1000) / 1000, yearBuilt: 2330 + Math.floor(rnd(hb, 6) * 30),
          meta: { districtClass: 'otown', blockUse: greenhouse ? 'greenhouses' : use2 === 'dorm' ? 'dorms' : 'utility', frontage: 'collector', roofKind: greenhouse ? 'glass' : 'ceramic', height: Math.round(((floors2 - 1) * fh + gfh) * 100) / 100, covered: false, terraced: false, cold: false, polar: false, orient: 'road', tone: 0.5, workTown: town.id, ...(greenhouse ? { span: Math.round(w * 10) / 10 } : {}) },
        });
        idx++; row++;
        u += w + 6 + 4 * rnd(hb, 7);
      }
    }
  }
  T = { buildings, roads, y };
  CACHE.set(key, T);
  return T;
}

/**
 * The G02 work-town anchors straight from the site data (sites.js SITES.waterStairs.towns, the same
 * localToLatLon as megastructures' mega.towns()), so ids resolve in any worker without the mega system.
 */
let G02_TOWNS = null;
export function g02Towns() {
  if (!G02_TOWNS) {
    const site = SITES.waterStairs;
    G02_TOWNS = (site.towns || []).map((t) => { const ll = localToLatLon(site, t.x, t.z, {}); return { id: t.id, lat: ll.lat, lon: ll.lon, y: t.y, radius: t.radius }; });
  }
  return G02_TOWNS;
}

/**
 * BuildingSpec of a G02 work-town building by its stable id 'OX5-G02-T<k>-<i>' (QA-ID-02: buildingSpecById of
 * world/urban.js does not know the synthesised towns), identical to the streamed one; null for other ids.
 */
export function townSpecById(id) {
  const m = /^OX5-(G02-T\d+)-(\d+)$/.exec(String(id));
  if (!m) return null;
  const town = g02Towns().find((t) => t.id === m[1]);
  if (!town) return null;
  const T = workTown(town);
  return T.buildings.find((b) => b.id === id) || null;
}

/**
 * Work-town buildings / road pieces whose anchor lies in L13 tile (face, x, y), roads as tile-frame
 * polylines (y = height above sea level, as CityTileData). towns: mega.towns() records.
 */
export function townContentInTile(face, level, tx, ty, towns) {
  const out = { buildings: [], roads: [] };
  if (!towns || !towns.length) return out;
  const c = tileCenterUnit(face, level, tx, ty, {});
  const E = enuBasisFromUnit(c.x, c.y, c.z, {});
  const local = (u, h) => {
    const r = R + h;
    const X = u.x * r - c.x * R, Y = u.y * r - c.y * R, Z = u.z * r - c.z * R;
    return [X * E.east[0] + Y * E.east[1] + Z * E.east[2], X * E.up[0] + Y * E.up[1] + Z * E.up[2], X * E.south[0] + Y * E.south[1] + Z * E.south[2]];
  };
  const inTile = (u) => { const t = tileAt(u.x, u.y, u.z, level, {}); return t.face === face && t.x === tx && t.y === ty; };
  const U = {};
  for (const town of towns) {
    if (!town || !Number.isFinite(town.lat)) continue;
    const tu = latLonToUnit(town.lat, town.lon, {});
    const dd = Math.acos(Math.max(-1, Math.min(1, tu.x * c.x + tu.y * c.y + tu.z * c.z))) * R;
    if (dd > 470 + (town.radius || 600) + 200) continue;
    const T = workTown(town);
    for (const b of T.buildings) if (inTile(latLonToUnit(b.lat, b.lon, U))) out.buildings.push(b);
    // road pieces: 10 m samples, each segment goes to the tile of its midpoint (pieces join exactly)
    const cu = tu, B = enuBasisFromUnit(cu.x, cu.y, cu.z, {});
    for (const r of T.roads) {
      const [a, b] = r.ends;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / 10));
      let cur = null, part = 0;
      for (let i = 0; i < n; i++) {
        const f0 = i / n, f1 = (i + 1) / n, fm = (f0 + f1) / 2;
        const um = offsetLL(B, cu, a[0] + (b[0] - a[0]) * fm, a[1] + (b[1] - a[1]) * fm, U);
        if (!inTile(um)) { if (cur && cur.points.length >= 2) out.roads.push(cur); cur = null; continue; }
        if (!cur) {
          cur = { id: `${r.id}.${part++}`, cls: r.cls, width: r.width, points: [], district: town.id };
          const u0 = offsetLL(B, cu, a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0, {});
          cur.points.push(local(u0, T.y));
        }
        const u1 = offsetLL(B, cu, a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1, {});
        cur.points.push(local(u1, T.y));
      }
      if (cur && cur.points.length >= 2) out.roads.push(cur);
    }
  }
  return out;
}
