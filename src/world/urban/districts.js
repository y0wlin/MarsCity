// Districts: the Voronoi cells of the seed set (dseeds.js) with their plan.
//   district1(key) — cheap record: fields at the seed, intensity, class, settlement node, grid
//                    orientation / module / jitter / phase, province rules, flags. Enough for
//                    regional-scale samples (one sampleFields + a few heights).
//   district2(key) — geometry record: Voronoi polygon in the district's gnomonic plane, arterial
//                    edges, inset block area, land / height raster, rails, stations, piers, canals,
//                    special sites. Needed for block-level samples, tiles and building specs.
//
// District plane: gnomonic projection about the seed s, axes e1 (u) / e2 (v) rotated by the grid
// angle θ from east toward north. Great circles (district edges, rails, tile edges) are straight
// lines in it; the scale error stays < 1e-5 within a district.
//
// Street grid: lines u = U(i) = u0 + i·bw + jitter(i), v = V(j) likewise (jitter ≤ jit·module), so
// blocks vary in size; every n-th line is a collector, a rail corridor may take one v-line.
import { R, PROVINCE_CODES } from '../../core/constants.js';
import { hash4 } from '../../core/hash.js';
import { enuBasisFromUnit, latLonToUnit, tileAt } from '../../core/geo.js';
import { DC, CLASS, PROVINCE_RULES, arterialWidth, RAIL } from './rules.js';
import { seedOfKey, dkeyDecode, districtNominalSize, dkeyOf, cell0Seeds } from './dseeds.js';
import { forCellsNear } from './cells.js';
import { chunkAt, nearestDistrict } from './dchunks.js';
import { meltOutlets, outletsNear } from './melt.js';
import { townInfluenceAt } from './settlements.js';
import { railsNearInChunk, segDistance, pointAt, inIntervals } from './corridors.js';
import { envZ, bgZ, envO, farmO, greenBelt, industrialTendency, regionalAngle, windGap, sstep, grain } from './potential.js';
import { height, waterProbe, canalsIn, hasCanals, lakesIn, isWet } from './probe.js';
import { clipHalfPlane, polyBounds, polyHalfPlanes, rectPoly, pointInPoly } from './geom.js';
import { Lru } from './lru.js';
import { fieldsAt, fieldsExact } from './lattice.js';
import { harbourAt } from './harbour.js';
import { basinProgram, nearBasinProgram } from './basin.js';
import { g02Farm } from '../terrain/sitezones.js';
export { g02Farm };

const d1Cache = new Lru(40000, 'districts.d1Cache');
const d2Cache = new Lru(3000, 'districts.d2Cache');
const F = {}, F2 = {}, TI = {}, Q = {}, SD = {}, PL = {}, HB1 = {};

export function districtId(key) {
  const d = dkeyDecode(key, {});
  return `${d.face}.${d.level}.${d.x.toString(36)}.${d.y.toString(36)}`;
}
export function parseDistrictId(s) {
  const p = String(s).split('.');
  if (p.length !== 4) return -1;
  const face = +p[0], level = +p[1], x = parseInt(p[2], 36), y = parseInt(p[3], 36);
  if (!(face >= 0 && face < 6 && level >= 0 && level < 4 && x >= 0 && y >= 0 && x < 2048 && y < 2048)) return -1;
  return dkeyOf(face, level, x, y);
}

// ---------------------------------------------------------------------------------------------
// plane conversions
// ---------------------------------------------------------------------------------------------
export function toPlane(D, x, y, z, out) {
  const ps = x * D.sx + y * D.sy + z * D.sz;
  if (ps <= 0.2) { out.u = out.v = 1e12; return out; }
  const qx = x / ps - D.sx, qy = y / ps - D.sy, qz = z / ps - D.sz;
  out.u = R * (qx * D.e1x + qy * D.e1y + qz * D.e1z);
  out.v = R * (qx * D.e2x + qy * D.e2y + qz * D.e2z);
  return out;
}
export function fromPlane(D, u, v, out) {
  const k = 1 / R;
  const x = D.sx + (u * D.e1x + v * D.e2x) * k, y = D.sy + (u * D.e1y + v * D.e2y) * k, z = D.sz + (u * D.e1z + v * D.e2z) * k;
  const l = Math.sqrt(x * x + y * y + z * z);
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}
/** compass heading (deg) of a plane direction (du,dv) */
export function planeHeading(D, du, dv) {
  const e = du * D.cosT - dv * D.sinT, n = du * D.sinT + dv * D.cosT;
  return ((Math.atan2(e, n) * 180 / Math.PI) + 360) % 360;
}
/** plane direction (du,dv) of a compass heading (deg) */
export function headingToPlane(D, hdg, out) {
  const a = hdg * Math.PI / 180, e = Math.sin(a), n = Math.cos(a);
  out.du = e * D.cosT + n * D.sinT; out.dv = -e * D.sinT + n * D.cosT;
  return out;
}
/** east/north vector → plane */
export function enToPlane(D, e, n, out) { out.du = e * D.cosT + n * D.sinT; out.dv = -e * D.sinT + n * D.cosT; return out; }

// ---------------------------------------------------------------------------------------------
// street grid (jittered lines)
// ---------------------------------------------------------------------------------------------
function jitter(D, axis, i) {
  if (!D.jit) return 0;
  const h = hash4(D.key, i, axis, 0x6a17);
  return ((h & 0xffff) / 65535 - 0.5) * D.jit;
}
export function lineU(D, i) { return D.u0 + i * D.bw + jitter(D, 1, i) * D.bw; }
export function lineV(D, j) { return D.v0 + j * D.bd + jitter(D, 2, j) * D.bd; }
export function blockIndexU(D, u) {
  let i = Math.floor((u - D.u0) / D.bw);
  if (u < lineU(D, i)) i--; else if (u >= lineU(D, i + 1)) i++;
  return i;
}
export function blockIndexV(D, v) {
  let j = Math.floor((v - D.v0) / D.bd);
  if (v < lineV(D, j)) j--; else if (v >= lineV(D, j + 1)) j++;
  return j;
}
/** street width of grid line i along u (lines of constant u) */
export function lineWidthU(D, i) {
  if (D.street === 0) return 0;
  return ((i + D.collPhU) % D.collEvery + D.collEvery) % D.collEvery === 0 ? D.coll : D.street;
}
/** street width of grid line j along v; the rail-aligned slot carries the rail corridor */
export function lineWidthV(D, j) {
  if (D.street === 0) return 0;
  if (D.railKey && j === D.railJ) return D.railElev ? Math.max(D.coll + 8, 30) : RAIL.corridor + 2 * 9;
  return ((j + D.collPhV) % D.collEvery + D.collEvery) % D.collEvery === 0 ? D.coll : D.street;
}
export function isCollU(D, i) { return D.street > 0 && lineWidthU(D, i) >= D.coll; }
export function isCollV(D, j) { return D.street > 0 && lineWidthV(D, j) >= D.coll && !(D.railKey && j === D.railJ); }
/** block rectangle: centre-line bounds U0..U1, V0..V1 and street-inset interior u0..u1, v0..v1 */
export function blockRect(D, i, j, out) {
  const U0 = lineU(D, i), U1 = lineU(D, i + 1), V0 = lineV(D, j), V1 = lineV(D, j + 1);
  out.U0 = U0; out.U1 = U1; out.V0 = V0; out.V1 = V1;
  out.u0 = U0 + lineWidthU(D, i) / 2; out.u1 = U1 - lineWidthU(D, i + 1) / 2;
  out.v0 = V0 + lineWidthV(D, j) / 2; out.v1 = V1 - lineWidthV(D, j + 1) / 2;
  return out;
}

// ---------------------------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------------------------
export function district1(key) {
  let D = d1Cache.get(key);
  if (!D) { D = buildD1(key); d1Cache.set(key, D); }
  return D;
}

function offsetPoint(s, E, de, dn, out) {
  const k = 1 / R;
  const x = s.x + (E.east[0] * de + E.north[0] * dn) * k, y = s.y + (E.east[1] * de + E.north[1] * dn) * k, z = s.z + (E.east[2] * de + E.north[2] * dn) * k;
  const l = Math.sqrt(x * x + y * y + z * z); out.x = x / l; out.y = y / l; out.z = z / l; return out;
}

function buildD1(key) {
  const s = seedOfKey(key, {});
  const dk = dkeyDecode(key, {});
  const size = districtNominalSize(key);
  const hr = (k) => hash4(key, k, 0x0d16, 0) / 4294967296;
  const E = enuBasisFromUnit(s.x, s.y, s.z, {});
  fieldsExact(s.x, s.y, s.z, F);
  const lat = F.lat, lon = F.lon;
  let landSeed = F.coastM > 0;
  if (!landSeed) {
    // seeds that fall in the sea: plan the district from its land side
    let best = null;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, rr = 0.45 * size;
      offsetPoint(s, E, Math.cos(a) * rr, Math.sin(a) * rr, Q);
      fieldsAt(Q.x, Q.y, Q.z, Math.max(650, size * 0.2), F2);
      if (F2.coastM > 150 && (!best || F2.coastM > best.c)) best = { c: F2.coastM, x: Q.x, y: Q.y, z: Q.z };
    }
    // U4 (fix round 3): front-row seeds of the ferry provinces that fall in the water look for their land side on
    // three rings (the 0.45 ring misses narrow shore strips) — their shore then gets terminals / promenade
    if (!best && (PROVINCE_RULES[PROVINCE_CODES[F.province]] || {}).ferry) {
      for (const rf of [0.25, 0.6, 0.8]) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 + rf, rr = rf * size;
          offsetPoint(s, E, Math.cos(a) * rr, Math.sin(a) * rr, Q);
          fieldsAt(Q.x, Q.y, Q.z, Math.max(650, size * 0.2), F2);
          if (F2.coastM > 80 && height(Q.x, Q.y, Q.z, 60) > 1 && (!best || F2.coastM > best.c)) best = { c: F2.coastM, x: Q.x, y: Q.y, z: Q.z };
        }
        if (best) break;
      }
    }
    if (best) { fieldsExact(best.x, best.y, best.z, F); F.coastM = Math.min(F.coastM, 50); landSeed = true; F.lat = lat; F.lon = lon; }
  }
  const zone = F.zone, province = F.province, code = PROVINCE_CODES[province] || (zone === 'O' ? 'OX1' : 'ZR3');
  const rules = PROVINCE_RULES[code] || PROVINCE_RULES.ZR3;
  const D = {
    key, level: dk.level, face: dk.face, size, sx: s.x, sy: s.y, sz: s.z, lat, lon,
    zone, province, code, rules, hash: hash4(key, 0x0d15, 0, 0) >>> 0,
    coastM: F.coastM, ridge: F.ridge, ice: F.ice, urban: F.urban, farm: F.farm, density: F.density, emission: F.emission, zoneO: F.zoneO,
    canyonF: F.canyon || 0, park: F.park || 0,
    env: 0, T: 0, townKey: -1, townKind: 'none', townDist: 1e30, townRank: 0, townR: 0, tx: 0, ty: 0, tz: 0,
    stationDist: 1e30, inten: 0, cls: DC.WILD, node: 0,
    coastal: false, seaE: 0, seaN: 0, waterRing: 0, slope: 0, gE: 0, gN: 0, h0: 0, canalE: 0, canalN: 0, canalDist: 1e9,
    theta: 0, cosT: 1, sinT: 0, e1x: 0, e1y: 0, e1z: 0, e2x: 0, e2y: 0, e2z: 0,
    bw: 100, bd: 100, u0: 0, v0: 0, jit: 0, street: 0, coll: 0, collEvery: 4, collPhU: 0, collPhV: 0, lane: 0, walk: 0, trees: 0,
    railKey: 0, railJ: 0, railElev: false, orient: 'hash',
    terraced: false, canyon: false, cold: !!rules.cold, covered: !!rules.covered, polar: !!rules.polar, border: false,
    tone: 0.5, year0: 2300, irrig: 0, farmMax: F.farm || 0, landSeed, roofStyle: 0, meltOutlet: -1,
  };
  // ring of 6 lattice samples at 0.42·size: shore gradient → coastal flag and sea direction
  const rr = 0.42 * size, tl = Math.max(1300, size * 0.4);   // shared coarse lattice: cheap cold start
  let gE = 0, gN = 0, minC = 1e9, wet = 0, farmMax = F.farm || 0, ridgeMax = F.ridge;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3, ce = Math.cos(a), cn = Math.sin(a);
    offsetPoint(s, E, ce * rr, cn * rr, Q);
    fieldsAt(Q.x, Q.y, Q.z, tl, F2);
    gE += ce * F2.coastM; gN += cn * F2.coastM;
    if (F2.coastM < minC) minC = F2.coastM;
    if (F2.coastM < 0) wet++;
    if (F2.farm > farmMax) farmMax = F2.farm;
    if (F2.ridge > ridgeMax) ridgeMax = F2.ridge;
  }
  D.farmMax = farmMax; D.waterRing = wet / 6; D.ridgeMax = ridgeMax;
  if (landSeed && (minC < 0 || F.coastM < 0.35 * size)) {
    D.coastal = true;
    const gl = Math.hypot(gE, gN) || 1; D.seaE = -gE / gl; D.seaN = -gN / gl;
  }
  const inSea = !landSeed;
  // slope (band-limited heights) — skipped for districts that are entirely sea / ice
  if (!inSea && F.ice < 0.9) {
    const sd = Math.max(120, size * 0.12), wl = Math.max(60, sd * 0.6);
    const h0 = height(s.x, s.y, s.z, wl);
    offsetPoint(s, E, sd, 0, Q); const hE = height(Q.x, Q.y, Q.z, wl);
    offsetPoint(s, E, 0, sd, Q); const hN = height(Q.x, Q.y, Q.z, wl);
    D.gE = (hE - h0) / sd; D.gN = (hN - h0) / sd; D.slope = Math.hypot(D.gE, D.gN); D.h0 = h0;
  }
  // settlements / stations
  const ch = chunkAt(s.x, s.y, s.z);
  townInfluenceAt(s.x, s.y, s.z, TI);   // = townInfluence(chunkTowns(ch), seed), validated lazily
  D.T = TI.T;
  if (TI.town) {
    const t = TI.town;
    D.townKey = t.key; D.townKind = t.kind; D.townDist = TI.td; D.townRank = t.rank; D.townR = t.radius; D.tx = t.x; D.ty = t.y; D.tz = t.z;
  }
  // corridors near the seed only: stations farther than 12.5 km add exactly 0 to the intensity
  // (0.17·e^-69 is below one ulp of I), rails / roads only align grids within 0.5 / 0.4 of the size
  const rails = railsNearInChunk(s.x, s.y, s.z, Math.max(0.5 * size + 1000, 12500), ch);
  let railBest = null, railD = 1e30, roadBest = null, roadD = 1e30, railAlong = 0, roadAlong = 0;
  for (const sg of rails) {
    const d = segDistance(sg, s.x, s.y, s.z, SD);
    if (sg.kind === 'metro' || sg.kind === 'regional') {
      for (const st of sg.stations) {
        const dx = st.x - s.x, dy = st.y - s.y, dz = st.z - s.z;
        const ds = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
        if (ds < D.stationDist) D.stationDist = ds;
      }
    }
    if (SD.along < 0 || SD.along > sg.len) continue;
    if (sg.rail) { if (d < railD) { railD = d; railBest = sg; railAlong = SD.along; } }
    else if (d < roadD) { roadD = d; roadBest = sg; roadAlong = SD.along; }
  }
  // ---------------- intensity and class ----------------
  const hc = hr(1), hc2 = hr(2), hc3 = hr(3);
  const slopeMaxR = rules.terraced ? (rules.slopeTerrace || 0.6) : rules.slopeMax;
  D.meltOutlet = !inSea && rules.meltwater && D.polar ? hostedOutlet(key, s, size) : -1;
  if (inSea || F.ice > 0.85) {
    D.cls = D.meltOutlet >= 0 ? DC.OUTPOST : DC.WILD;
  } else if (zone === 'Z') {
    const env = envZ(F, s.x, s.y, s.z);
    const bg = bgZ(F, s.x, s.y, s.z);
    // G01 protected port city (harbour.js): centres + dense waterfront band replace the plateau's control maps
    harbourAt(s.x, s.y, s.z, HB1);
    const inHarbour = landSeed && HB1.w > 0.35;
    if (inHarbour) {
      D.T = Math.max(D.T, HB1.T);
      D.harbour = { side: HB1.side, ds: Math.round(HB1.ds), centre: HB1.centre, U: Math.round(HB1.U), V: Math.round(HB1.V) };
      D.peakFloors = Math.max(6, HB1.peak0);   // round-2 cap (outside the overlay); blocks inside take harbour.js skylineAt
    }
    let g = 0.30 + 0.40 * F.urban;
    if (rules.windGaps) g *= rules.gap || 0.7;
    const stBoost = env > 0.08 ? 0.17 * Math.exp(-((D.stationDist / 1500) ** 2)) : 0;
    const nv = grain(s.x, s.y, s.z, 6500, 1);
    let I = env * (g + (1 - g) * D.T) + stBoost + 0.14 * nv * env;
    if (rules.sunSlope && D.slope > 0.05) {
      // southern cold valley: equator(north)-facing slopes get the sun (住宅集中在向阳谷坡)
      const facing = -D.gN / D.slope;
      I *= 0.72 + 0.48 * facing;
    }
    I = Math.max(0, Math.min(1, I));
    D.env = env; D.inten = I;
    const gb = greenBelt(s.x, s.y, s.z);
    const ind = industrialTendency(s.x, s.y, s.z);
    const wg = rules.windGaps ? windGap(s.x, s.y, s.z, lat, lon) : 0;
    const villageNear = (D.townKind === 'village') && D.townDist < 2.6 * D.townR + 600;
    // O/Z hand-over band (§1 让相邻区域自然交接): logistics, farm stations and low housing keep the
    // land developed up to the border instead of leaving an empty seam
    const borderDev = F.zoneO > 0.05 && F.zoneO < 0.7 && F.ridge < 0.5 ? sstep(0.05, 0.22, F.density) : 0;
    let cls;
    if (D.park > 0.5 && env > 0.02) cls = DC.PARK;                                           // landmark crater parks
    else if (wg > 0.5 && D.T < 0.45 && stBoost < 0.08 && env > 0.05) cls = hc < 0.35 ? DC.PARK : (hc < 0.8 ? DC.RURAL : DC.WILD);   // ZR3 风口
    else if (env < 0.12 && borderDev > 0.3 && D.slope < rules.slopeMax) { cls = hc < 0.5 ? DC.LOGISTICS : (hc < 0.85 ? DC.LOW : DC.RURAL); I = Math.max(I, 0.2 + 0.2 * borderDev); D.inten = I; }
    else if (env < 0.10) {
      // background country: villages with their lanes and plots, farmsteads, red earth
      if (villageNear && D.townDist < 1.25 * D.townR + 400 && D.slope < rules.slopeMax) { cls = DC.LOW; D.node = 1; I = Math.max(I, 0.16 + 0.3 * D.T); D.inten = I; }
      else if (villageNear || (bg > 0.22 && hc < 0.30 + 0.5 * bg)) cls = DC.RURAL;
      else cls = hc < 0.02 && F.ridge < 0.5 ? DC.OUTPOST : DC.WILD;
    }
    else if (D.slope > slopeMaxR * 1.25) cls = hc < 0.05 ? DC.OUTPOST : DC.WILD;
    // dark-green gaps between towns (暗绿间隔) are organic belts across districts (parcels.js), plus
    // whole park districts where the settlement influence is very low inside a weak envelope
    else if (stBoost < 0.06 && I < 0.30 && D.T < 0.10 && env < 0.45 && hc2 < 0.5) cls = DC.PARK;
    else if (I < 0.11) cls = hc < 0.62 ? DC.RURAL : DC.WILD;
    else if (I < 0.36) cls = DC.LOW;
    else if (I < 0.64) cls = DC.MID;
    else cls = (D.T > 0.70 || (stBoost > 0.10 && I > 0.7)) ? DC.CORE : DC.MID;
    if (cls === DC.LOW || cls === DC.MID || (cls === DC.RURAL && !villageNear)) {
      if (D.coastal && I > 0.18 && (rules.port || 0) * (0.55 + 0.45 * (ind + 1) / 2) > 0.36 + 0.42 * hc2) cls = DC.PORT;
      else if (ind > 0.38 && I > 0.15 && I < 0.86 && cls !== DC.RURAL && !D.node) cls = DC.INDUSTRIAL;
      else if (F.zoneO > 0.07 && F.zoneO < 0.5 && hc3 < 0.55 && !D.node) cls = DC.LOGISTICS;
      else if (hc2 < 0.05 && cls !== DC.RURAL && !D.node) cls = DC.CAMPUS;
    }
    if (inHarbour && cls !== DC.WILD && cls !== DC.OUTPOST) {
      // waterfront band: deep-water cargo quays on the east flank, ferry / promenade / public front row elsewhere
      if (HB1.ds < 950) cls = HB1.side === 'cargo' ? DC.PORT : (D.T > 0.7 && I > 0.6 ? DC.CORE : DC.MID);
      else if (HB1.side === 'cargo' && HB1.ds < 2600 && D.T < 0.6) cls = DC.LOGISTICS;   // port backland: sheds, cold stores, depots
      else if (cls === DC.PORT || cls === DC.RURAL || cls === DC.PARK || cls === DC.WILD || (cls === DC.INDUSTRIAL && !(HB1.side === 'cargo' && HB1.ds < 3500))) cls = I < 0.36 ? DC.LOW : DC.MID;
    }
    // waterfront program (§5 05, U3): dense residential coasts of the ferry provinces get ferry terminals, a
    // shaded promenade, low public buildings on the front row and heights rising inland
    // (also first-row districts whose seed lies within ~0.75 size of the shore: their ring test misses the water)
    // (U4, fix round 3: ZR5 industrial shores get the same terrain-shore test → one passenger landing, no promenade)
    const indFerry = code === 'ZR5' && cls === DC.INDUSTRIAL;
    if (rules.ferry && (cls === DC.LOW || cls === DC.MID || cls === DC.CORE || indFerry) && landSeed) {
      if (D.coastal) { if (!indFerry) D.waterfront = true; else D.shoreFerry = true; }
      else {
        // terrain shores the coast metric does not carry: open water (terrain < 0) on a ring at 0.65·size
        let we = 0, wn = 0, nw = 0, nwIn = 0;
        for (const rr of [0.6, 1.05]) for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + 0.2 + rr, ce = Math.cos(a), cn = Math.sin(a);
          offsetPoint(s, E, ce * rr * size, cn * rr * size, Q);
          if (height(Q.x, Q.y, Q.z, 60) < 0) { we += ce; wn += cn; nw++; if (rr < 1) nwIn++; }
        }
        const gl = Math.hypot(we, wn);
        if (nw > 0 && nwIn < 7 && gl > 1e-6) { if (indFerry) D.shoreFerry = true; else D.waterfront = true; D.seaE = we / gl; D.seaN = wn / gl; }
      }
    }
    if (rules.canyon && (D.slope > 0.10 || D.canyonF > 0.3) && cls >= DC.LOW && cls <= DC.CORE) { D.canyon = true; D.terraced = true; }
    if (rules.terraced && D.slope > 0.16) D.terraced = true;
    if (cls === DC.CORE && D.terraced) cls = DC.MID;
    D.cls = cls;
  } else {
    const env = envO(F, s.x, s.y, s.z);
    let farm = farmO(F);
    if (F.zoneO < 0.95 && F.ridge < 0.5) farm = Math.max(farm, 0.45 * sstep(0.04, 0.2, F.density));
    D.env = env;
    let I = Math.max(env * (0.5 + 0.5 * D.T), 0.35 * D.T);
    D.inten = I = Math.max(0, Math.min(1, I));
    D.canalDist = F.canal;
    if (F.canal < 4000) {
      // canal direction = perpendicular to the gradient of the canal-distance field
      offsetPoint(s, E, 160, 0, Q); fieldsAt(Q.x, Q.y, Q.z, 160, F2); const cE = F2.canal;
      offsetPoint(s, E, 0, 160, Q); fieldsAt(Q.x, Q.y, Q.z, 160, F2); const cN = F2.canal;
      offsetPoint(s, E, -160, 0, Q); fieldsAt(Q.x, Q.y, Q.z, 160, F2); const cW = F2.canal;
      offsetPoint(s, E, 0, -160, Q); fieldsAt(Q.x, Q.y, Q.z, 160, F2); const cS = F2.canal;
      const gx = (cE - cW) / 320, gy = (cN - cS) / 320, gl = Math.hypot(gx, gy);
      if (gl > 0.2 && Math.max(cE, cN, cW, cS) < 1e8) { D.canalE = -gy / gl; D.canalN = gx / gl; }
    }
    const townNear = (D.townKind === 'otown' || D.townKind === 'hamlet') && D.townDist < 1.3 * D.townR + 500;
    let cls;
    if (D.polar) {
      // OX4: the district holding a meltwater outlet's forebay pool gets the pump house + lee greenhouses
      // (meltEnsemble); meltwater pumps exist only there (§5 04), not scattered over the frost plain
      if (D.townKind === 'station' && D.townDist < 1.6 * D.townR + 400) { cls = DC.POLAR; D.node = 1; }
      else if (D.meltOutlet >= 0) cls = DC.OUTPOST;
      else if (rules.greenhouse && F.ridge > 0.16 && F.ridge < 0.62 && D.T > 0.10 && hc < rules.greenhouse) { cls = DC.GREENHOUSE; D.node = 1; }
      else cls = hc < 0.025 ? DC.OUTPOST : DC.WILD;
    } else {
      if (townNear) { cls = DC.OTOWN; D.node = 1; }
      else if (env < 0.02 && farm < 0.10 && farmMax < 0.4) cls = hc < 0.02 ? DC.OUTPOST : DC.WILD;
      else if (D.T > 0.16 && hc < (rules.greenhouse || 0.1) * 1.3) { cls = DC.GREENHOUSE; D.node = D.T < 0.3 ? 1 : 0; }
      else if (farm > 0.18 || farmMax > 0.42) cls = DC.FARM;
      else if (env > 0.25 && F.canal < 4000) cls = DC.FARM;
      else cls = hc < 0.03 ? DC.OUTPOST : DC.WILD;
      if (D.slope > rules.slopeMax * 1.3 && cls !== DC.OUTPOST) cls = DC.WILD;
      // G02 irrigation (fix round 3, U3; terrain-fn sitezones.g02Farm): the irrigation district on the plain below dam 6
      // and the bench terraces on the R2–R6 banks are farmland even where the seed / ring samples miss it (narrow
      // terrace belts, seeds on a reservoir or the escarpment)
      if ((cls === DC.WILD || cls === DC.OUTPOST) && !inSea) {
        const g = g02FarmIn(s, E, size);
        if (g) { cls = DC.FARM; D.g02 = g; farm = Math.max(farm, 0.5); }
      }
    }
    D.cls = cls;
    D.irrig = farm;
  }
  D.border = F.zoneO > 0.08 && F.zoneO < 0.92;
  if (D.cls === DC.RURAL || D.cls === DC.OTOWN) D.node = 1;
  // ---------------- orientation ----------------
  const C = CLASS[D.cls];
  let theta = regionalAngle(s.x, s.y, s.z) + (hc3 - 0.5) * 0.5, orient = 'hash';
  let railAlign = false;
  const corr = railBest && railD < 0.5 * size ? railBest : (roadBest && roadD < 0.4 * size && (D.cls === DC.LOW || D.cls === DC.RURAL || D.cls === DC.OTOWN || D.cls === DC.LOGISTICS) ? roadBest : null);
  const corrAlong = corr === railBest ? railAlong : roadAlong;
  if (C.grid && corr && corr.kind !== 'pipe') {
    const th = corrAlong / R;
    const tx = -corr.ax * Math.sin(th) + corr.mx * Math.cos(th);
    const ty = -corr.ay * Math.sin(th) + corr.my * Math.cos(th);
    const tz = -corr.az * Math.sin(th) + corr.mz * Math.cos(th);
    theta = Math.atan2(tx * E.north[0] + ty * E.north[1] + tz * E.north[2], tx * E.east[0] + ty * E.east[1] + tz * E.east[2]);
    orient = corr.rail ? 'rail' : 'road'; railAlign = !!corr.rail;
  } else if (D.coastal && C.grid) {
    theta = Math.atan2(-D.seaE, D.seaN); orient = 'coast';   // e2 = toward the sea
  } else if (zone === 'O' && D.canalDist < 3500 && (D.canalE || D.canalN)) {
    theta = Math.atan2(D.canalN, D.canalE); orient = 'canal';
  } else if (D.slope > 0.07) {
    theta = Math.atan2(D.gE, -D.gN); orient = 'contour';   // u along the contour
  } else if (D.townKey >= 0 && D.townDist < 13000 && D.inten > 0.25 && D.townDist > 300) {
    const dx = D.tx - s.x, dy = D.ty - s.y, dz = D.tz - s.z;
    theta = Math.atan2(dx * E.north[0] + dy * E.north[1] + dz * E.north[2], dx * E.east[0] + dy * E.east[1] + dz * E.east[2]);
    orient = 'core';
  }
  D.theta = theta; D.cosT = Math.cos(theta); D.sinT = Math.sin(theta); D.orient = orient;
  D.e1x = D.cosT * E.east[0] + D.sinT * E.north[0]; D.e1y = D.cosT * E.east[1] + D.sinT * E.north[1]; D.e1z = D.cosT * E.east[2] + D.sinT * E.north[2];
  D.e2x = -D.sinT * E.east[0] + D.cosT * E.north[0]; D.e2y = -D.sinT * E.east[1] + D.cosT * E.north[1]; D.e2z = -D.sinT * E.east[2] + D.cosT * E.north[2];
  // ---------------- module / streets ----------------
  let bw = C.module[0] * (0.92 + 0.2 * hr(4)), bd = C.module[1] * (0.92 + 0.2 * hr(5));
  if (D.terraced && (D.cls === DC.LOW || D.cls === DC.MID || D.cls === DC.CORE)) { bw *= 1.5; bd *= 0.55; }   // long narrow blocks along the contour
  if (rules.longStrips && D.cls === DC.FARM) bd *= 1.6;
  if (D.cold && D.cls >= DC.LOW && D.cls <= DC.CORE) { bw *= 0.9; bd *= 0.9; }
  if (D.cls === DC.FARM) { const k = 0.75 + 0.6 * hr(12); bw *= k; }
  D.bw = bw; D.bd = bd; D.jit = C.jit;
  D.street = C.street; D.coll = C.coll; D.collEvery = C.collEvery || 4; D.lane = C.lane; D.walk = C.walk; D.trees = C.trees;
  D.collPhU = Math.floor(hr(6) * D.collEvery); D.collPhV = Math.floor(hr(7) * D.collEvery);
  D.u0 = hr(8) * bw; D.v0 = hr(9) * bd;
  if (railAlign) {
    pointAt(railBest, railAlong, Q);
    const P = toPlane(D, Q.x, Q.y, Q.z, {});
    // put the rail on grid line j (the jitter of that line is cancelled through v0)
    const j = Math.round((P.v - D.v0) / bd);
    D.v0 += P.v - lineV(D, j);
    D.railJ = j;
    D.railKey = railBest.key;
    D.railElev = inIntervals(railBest.elev, railAlong);
  }
  // settlement node (organic town outline instead of the Voronoi polygon)
  if (D.node) {
    if (D.cls === DC.RURAL && !(D.townKind === 'village' && D.townDist < 2.6 * D.townR + 600)) { D.nodeU = 0; D.nodeV = 0; D.nodeR = 260 + 420 * hr(13); }
    else if (D.townKey >= 0) { toPlane(D, D.tx, D.ty, D.tz, PL); D.nodeU = PL.u; D.nodeV = PL.v; D.nodeR = Math.max(300, D.townR * (D.cls === DC.OTOWN ? 1.1 : 1.0)); }
    else { D.nodeU = 0; D.nodeV = 0; D.nodeR = 500; }
  }
  // ---------------- tone / era / roof palette ----------------
  {
    // roof palette regions span several districts (smooth 16 km field + a little per-district jitter), so
    // neighbouring districts usually share a palette: no 100 km mosaic of unrelated tones
    const hs = Math.max(0, Math.min(0.999, 0.5 + 0.62 * grain(s.x, s.y, s.z, 16000, 6) + 0.16 * (hr(14) - 0.5)));
    D.roofStyle = D.cold ? (hs < 0.5 ? 0 : 4) : D.terraced ? (hs < 0.55 ? 2 : 0) : hs < 0.38 ? 0 : hs < 0.56 ? 1 : hs < 0.72 ? 2 : hs < 0.86 ? 3 : 4;
  }
  const nt = grain(s.x, s.y, s.z, 9000, 2);
  D.tone = Math.max(0, Math.min(1, 0.5 + 0.30 * nt + 0.10 * (hr(10) - 0.5)));
  const era = rules.era || 200;
  D.year0 = Math.round((rules.year0 || 2250) + era * Math.max(0, Math.min(1, 1 - 0.75 * D.inten - 0.25 * D.T + 0.25 * (hr(11) - 0.5))));
  return D;
}

/** 'terrace' | 'plain' | null: does the G02 irrigation zone (with fields.farm) reach into the district around seed s? */
const QG = {}, FG = {};
function g02FarmIn(s, E, size) {
  // (g02Farm rejects by a dot product beyond 48 km of the site: the sample net costs nothing elsewhere)
  let g, res = null;
  for (const rr of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
    const n = rr === 0 ? 1 : 20;
    for (let k = 0; k < n; k++) {
      const a = k * Math.PI * 2 / n + rr * 3;
      offsetPoint(s, E, Math.cos(a) * size * rr, Math.sin(a) * size * rr, QG);
      g = g02Farm(QG.x, QG.y, QG.z);
      if (g.terrace > 0.5) return 'terrace';   // terrain-fn irrigates the whole bench belt (fields.farm 0.85)
      if (g.plain > 0.5 && !res) { fieldsAt(QG.x, QG.y, QG.z, 400, FG); if (FG.farm > 0.25) res = 'plain'; }
    }
  }
  return res;
}

/** index of the OX4 meltwater outlet whose forebay pool lies in district `key` (Voronoi cell), or −1 */
const NDo = {};
function hostedOutlet(key, s, size) {
  const L = outletsNear(s.x, s.y, s.z, Math.max(3 * size, 8000));
  for (const o of L) { nearestDistrict(o.x, o.y, o.z, NDo); if (NDo.key === key) return o.idx; }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// D2
// ---------------------------------------------------------------------------------------------
export function district2(key) {
  let G = d2Cache.get(key);
  if (!G) { G = buildD2(key); d2Cache.set(key, G); }
  return G;
}

function buildD2(key) {
  const D = district1(key);
  const size = D.size;
  // --- Voronoi polygon in the plane ---
  const H = Math.max(size * 2.2, 6000);
  let poly = rectPoly(-H, -H, H, H);
  const cand = [];
  const crad = Math.max(size * 2.6, 8000) + 6000, ccos = Math.cos(crad / R);
  forCellsNear(D.sx, D.sy, D.sz, crad, 0, (f, cx, cy) => {
    const S = cell0Seeds(f, cx, cy);
    for (let i = 0; i < S.keys.length; i++) {
      const k = S.keys[i]; if (k === key) continue;
      const x = S.xyz[3 * i], y = S.xyz[3 * i + 1], z = S.xyz[3 * i + 2];
      if (x * D.sx + y * D.sy + z * D.sz < ccos) continue;
      const dx = D.sx - x, dy = D.sy - y, dz = D.sz - z;
      cand.push({ k, x, y, z, d: Math.sqrt(dx * dx + dy * dy + dz * dz) * R });
    }
  });
  cand.sort((a, b) => a.d - b.d);
  const used = [];
  for (const c of cand) {
    let rmax = 0; for (let i = 0; i < poly.length; i += 2) { const r = Math.hypot(poly[i], poly[i + 1]); if (r > rmax) rmax = r; }
    if (c.d > 2 * rmax + 1) break;
    const nx = D.sx - c.x, ny = D.sy - c.y, nz = D.sz - c.z;
    const A = D.e1x * nx + D.e1y * ny + D.e1z * nz, Bv = D.e2x * nx + D.e2y * ny + D.e2z * nz;
    const Cc = R * (1 - (D.sx * c.x + D.sy * c.y + D.sz * c.z));
    const L = Math.hypot(A, Bv);
    const a = A / L, b = Bv / L, cc = Cc / L;
    const np = clipHalfPlane(poly, a, b, cc);
    if (np.length !== poly.length || np.some((v, i) => v !== poly[i])) used.push({ k: c.k, a, b, c: cc });
    poly = np;
    if (poly.length < 6) break;
  }
  // edges: match polygon edges to the half-planes that produced them
  const n = poly.length >> 1;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const x0 = poly[2 * i], y0 = poly[2 * i + 1], x1 = poly[(2 * i + 2) % (2 * n)], y1 = poly[(2 * i + 3) % (2 * n)];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let best = null, bd = 1e9;
    for (const hp of used) { const d = Math.abs(hp.a * mx + hp.b * my + hp.c); if (d < bd) { bd = d; best = hp; } }
    let w = 0, nk = -1, ncls = DC.WILD, nland = false, nzone = D.zone;
    if (best && bd < 0.5) {
      nk = best.k;
      const N = district1(nk);
      ncls = N.cls; nzone = N.zone;
      nland = N.landSeed || N.waterRing < 0.5;
      w = arterialWidth(D.cls, N.cls);
    }
    edges.push({ x0, y0, x1, y1, nkey: nk, ncls, nland, nzone, w, a: best ? best.a : 0, b: best ? best.b : 0, c: best ? best.c : 0 });
  }
  // inset (block area): arterial half widths (+ small verge) from each edge
  let inset = rectPoly(-H, -H, H, H);
  for (const e of edges) {
    if (!e.a && !e.b) continue;
    const off = e.w > 0 ? e.w / 2 : (CLASS[D.cls].grid ? 6 : 0);
    inset = clipHalfPlane(inset, e.a, e.b, e.c - off);
  }
  const hp = polyHalfPlanes(poly);
  const ihp = inset.length >= 6 ? polyHalfPlanes(inset) : [];
  const bb = polyBounds(poly, {});
  const G = { key, D, poly, hp, edges, inset, ihp, bb, rails: [], stations: [], sites: [], piers: [], canals: [], ferry: null, raster: null, meltSite: null };
  G.raster = buildRaster(G);
  buildRails(G);
  buildCanals(G);
  buildPiers(G);
  buildSites(G);
  G.promenade = null;   // lazily (promenadeOf): waterfront districts only
  return G;
}

/**
 * Shaded waterfront promenade (遮阳步廊, U3) of a waterfront district: polylines (plane coords) 24 m inland of the
 * exact waterline, sampled every 24 m along the shore; coves / headlands that jump > 70 m start a new run.
 * [{pts: Float64Array [u0,v0,u1,v1,...]}] — cached on the district geometry record.
 */
const QPm = {};
export function promenadeOf(G) {
  if (G.promenade) return G.promenade;
  const D = G.D, runs = [];
  G.promenade = runs;
  if (!D.waterfront) return runs;
  const S = enToPlane(D, D.seaE, D.seaN, {});
  let sdu = S.du, sdv = S.dv; { const l = Math.hypot(sdu, sdv) || 1; sdu /= l; sdv /= l; }
  const tu = -sdv, tv = sdu;
  const span = Math.max(G.bb.x1 - G.bb.x0, G.bb.y1 - G.bb.y0);
  const P = G.inset.length >= 6 ? G.inset : G.poly;
  let cur = null, lastS = 0;
  const flush = () => { if (cur && cur.length >= 6) runs.push({ pts: Float64Array.from(cur) }); cur = null; };
  for (let ou = -span; ou <= span; ou += 24) {
    let last = null, cross = null;
    for (let s = -span * 0.6; s < span * 0.8; s += 20) {
      const u = ou * tu + s * sdu, v = ou * tv + s * sdv;
      if (!pointInPoly(P, u, v)) { if (last !== null) break; else continue; }
      if (rasterLand(G, u, v) >= 0.5) last = s; else if (last !== null) { cross = s; break; }
    }
    if (cross === null) { flush(); continue; }
    let a = last, b = cross;
    for (let k = 0; k < 6; k++) { const m = (a + b) / 2; fromPlane(D, ou * tu + m * sdu, ou * tv + m * sdv, QPm); if (isWet(QPm.x, QPm.y, QPm.z, 2)) b = m; else a = m; }
    const sp = a - 24, u = ou * tu + sp * sdu, v = ou * tv + sp * sdv;
    if (!pointInPoly(P, u, v)) { flush(); continue; }
    if (cur && Math.abs(sp - lastS) > 70) flush();
    if (!cur) cur = [];
    cur.push(u, v); lastS = sp;
  }
  flush();
  return runs;
}
/** distance (m) from plane point (u,v) to the district's promenade (1e9 when none) */
export function promenadeDist(G, u, v) {
  const runs = promenadeOf(G);
  let best = 1e9;
  for (const r of runs) {
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], ex = p[i + 2] - ax, ey = p[i + 3] - ay, l2 = ex * ex + ey * ey || 1;
      let t = ((u - ax) * ex + (v - ay) * ey) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + ex * t - u, ay + ey * t - v);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Land / height raster over the district bounds. Step ≈ 120 m (9–21 nodes per axis). Land is the
 * signed shore distance of the fields (exactly the terrain's sea) reconciled with inland water
 * (canals, rivers, lakes, reservoirs) from hydro where the district can have any.
 * Nodes are evaluated LAZILY (first read through rasterSample): every node is a pure function of its
 * position, so the values are identical to an eager build, but a building lookup or a city tile only
 * pays for the few nodes around the blocks it actually needs (cold buildingSpecById budget).
 */
function buildRaster(G) {
  const D = G.D, bb = G.bb;
  const wid = bb.x1 - bb.x0 + 80, hgt = bb.y1 - bb.y0 + 80;
  const nx = Math.max(9, Math.min(21, Math.ceil(wid / 120) + 1)), ny = Math.max(9, Math.min(21, Math.ceil(hgt / 120) + 1));
  const x0 = bb.x0 - 40, y0 = bb.y0 - 40, dx = wid / (nx - 1), dy = hgt / (ny - 1);
  const N = nx * ny;
  const active = CLASS[D.cls].grid || D.cls === DC.OUTPOST || D.cls === DC.PARK;
  const r = {
    nx, ny, x0, y0, dx, dy,
    h: new Float32Array(N), cm: new Float32Array(N), inl: new Float32Array(N), cdist: new Float32Array(N), farm: new Float32Array(N),
    done: new Uint8Array(N), G, active,
    wl: Math.max(25, Math.min(dx, dy) * 0.35),
    sp: Math.max(650, 2 * Math.min(dx, dy)),          // fields are smooth here; heights carry the detail
    // nodes farther outside the polygon than any consumer can reach (bilinear support + slope
    // stencil ≤ 1.9 node spacings) keep the lattice values only: no terrain / water probes
    far: 2.2 * Math.max(dx, dy),
    lakes: false, probeWater: false,
  };
  // inland water is only probed where the district can have any (O zone, canyons, canals near, lakes)
  if (active) { const t = tileAt(D.sx, D.sy, D.sz, 9, {}); r.lakes = lakesIn(t.face, 9, t.x, t.y).length > 0; }
  r.probeWater = active && (D.zone === 'O' || D.canyonF > 0.15 || D.canalDist < 6000 || D.farm > 0.05 || r.lakes || D.rules.canyon);
  return r;
}

const QN = {}, FN = {};
/** evaluate raster node k (pure function of the node position) */
function rasterNode(r, k) {
  const G = r.G, D = G.D;
  const i = k % r.nx, j = (k - i) / r.nx;
  const u = r.x0 + i * r.dx, v = r.y0 + j * r.dy;
  fromPlane(D, u, v, QN);
  fieldsAt(QN.x, QN.y, QN.z, r.sp, FN);
  let c = FN.coastM;
  r.cdist[k] = Math.min(FN.canal, 3e4); r.farm[k] = FN.farm;
  let out = -1e9;
  const hpl = G.hp;
  for (let q = 0; q < hpl.length; q += 3) { const o = -(hpl[q] * u + hpl[q + 1] * v + hpl[q + 2]); if (o > out) out = o; }
  if (r.active && c > -200 && out < r.far) {
    const h = height(QN.x, QN.y, QN.z, r.wl);
    r.h[k] = h;
    if (h < 0.25 && c > 0) c = Math.min(c, -5);
    else if (h > 0.6 && c < 0) c = 6;            // the terrain is the truth at the shore
    if (r.probeWater && c > 0 && (FN.canal < 600 || r.lakes || D.canyonF > 0.15 || D.rules.canyon)) {
      const wt = waterProbe(QN.x, QN.y, QN.z);
      if (wt === 2 || wt === 3) r.inl[k] = 1;
    }
  } else r.h[k] = c < 0 ? -Math.min(60, -c * 0.01) : 0;
  r.cm[k] = Math.max(-3000, Math.min(3000, c));
  r.done[k] = 1;
}

export function rasterSample(r, arr, u, v) {
  let fx = (u - r.x0) / r.dx, fy = (v - r.y0) / r.dy;
  if (fx < 0) fx = 0; else if (fx > r.nx - 1.0001) fx = r.nx - 1.0001;
  if (fy < 0) fy = 0; else if (fy > r.ny - 1.0001) fy = r.ny - 1.0001;
  const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
  const i0 = iy * r.nx + ix, dn = r.done;
  if (!dn[i0]) rasterNode(r, i0);
  if (!dn[i0 + 1]) rasterNode(r, i0 + 1);
  if (!dn[i0 + r.nx]) rasterNode(r, i0 + r.nx);
  if (!dn[i0 + r.nx + 1]) rasterNode(r, i0 + r.nx + 1);
  return (arr[i0] * (1 - tx) + arr[i0 + 1] * tx) * (1 - ty) + (arr[i0 + r.nx] * (1 - tx) + arr[i0 + r.nx + 1] * tx) * ty;
}
/** share of land among the raster nodes inside the district polygon (diagnostics; evaluates every node) */
export function rasterLandShare(G) {
  const r = G.raster; let land = 0, cnt = 0;
  for (let k = 0; k < r.nx * r.ny; k++) {
    const i = k % r.nx, j = (k - i) / r.nx, u = r.x0 + i * r.dx, v = r.y0 + j * r.dy;
    if (!pointInPoly(G.poly, u, v)) continue;
    if (!r.done[k]) rasterNode(r, k);
    cnt++; if (r.cm[k] > 0 && !r.inl[k]) land++;
  }
  return cnt ? land / cnt : (G.D.landSeed ? 1 : 0);
}
/** raster land value (1 land, 0 water) at plane (u,v): smooth shore from the signed coast distance */
export function rasterLand(G, u, v) {
  const r = G.raster;
  const c = rasterSample(r, r.cm, u, v);
  const L = c >= 12 ? 1 : c <= -12 ? 0 : 0.5 + c / 24;
  if (L <= 0) return 0;
  const w = rasterSample(r, r.inl, u, v);
  return w > 0 ? L * (1 - Math.min(1, w * 1.6)) : L;
}
export function rasterCoast(G, u, v) { return rasterSample(G.raster, G.raster.cm, u, v); }
export function rasterHeight(G, u, v) { return rasterSample(G.raster, G.raster.h, u, v); }
/** height gradient (rise/run) at plane (u,v) from the raster; writes rasterSlope.gu/gv */
export function rasterSlope(G, u, v) {
  const r = G.raster, eu = r.dx * 0.5, ev = r.dy * 0.5;
  const gu = (rasterSample(r, r.h, u + eu, v) - rasterSample(r, r.h, u - eu, v)) / (2 * eu);
  const gv = (rasterSample(r, r.h, u, v + ev) - rasterSample(r, r.h, u, v - ev)) / (2 * ev);
  rasterSlope.gu = gu; rasterSlope.gv = gv;
  return Math.hypot(gu, gv);
}
rasterSlope.gu = 0; rasterSlope.gv = 0;

/**
 * Fine terrain slope (rise/run) at plane (u,v) of district G from lazily evaluated height lattices of the
 * district plane: 8 m spacing (band limit 4 m) for texels / footprints ≤ 20 m, else 32 m (16 m). Pure per
 * node, so tiles, ids and raster samples agree. Used where the plan must keep cliff faces bare (ZR2
 * canyon risers: "红岩越过楼冠", Z04 / §5 06): no buildings, streets or fabric on slopes > ~0.8.
 */
const QS = {};
export function slopeAt(G, u, v, t = 0) {
  const sp = t > 20 ? 32 : 8, lv = sp === 8 ? 0 : 1;
  let M = G.slat;
  if (!M) M = G.slat = new Map();
  if (M.size > 400000) M.clear();
  const D = G.D;
  const node = (a, b) => {
    const k = (lv * 2097152 + (a + 1048576)) * 2097152 + (b + 1048576);
    let h = M.get(k);
    if (h === undefined) { fromPlane(D, a * sp, b * sp, QS); h = height(QS.x, QS.y, QS.z, sp / 2); M.set(k, h); }
    return h;
  };
  const fu = u / sp, fv = v / sp, iu = Math.floor(fu), iv = Math.floor(fv), tu = fu - iu, tv = fv - iv;
  const h00 = node(iu, iv), h10 = node(iu + 1, iv), h01 = node(iu, iv + 1), h11 = node(iu + 1, iv + 1);
  const gu = ((h10 - h00) * (1 - tv) + (h11 - h01) * tv) / sp, gv = ((h01 - h00) * (1 - tu) + (h11 - h10) * tu) / sp;
  return Math.hypot(gu, gv);
}
/** max fine slope over the centre and the 4 corners of an oriented rect (building footprints) */
export function rectSlope(G, cu, cv, xu, xv, fu, fv, w, d) {
  let m = slopeAt(G, cu, cv, 0);
  for (let q = 0; q < 4; q++) {
    const x = q & 1 ? w / 2 : -w / 2, z = q & 2 ? d / 2 : -d / 2;
    const s = slopeAt(G, cu + x * xu + z * fu, cv + x * xv + z * fv, 0);
    if (s > m) m = s;
  }
  return m;
}
/** districts whose cliff faces stay bare (ZR2 canyon walls) */
export function keepsCliffsBare(D) { return !!D.canyon; }

// ---------------------------------------------------------------------------------------------
function buildRails(G) {
  const D = G.D;
  const ch = chunkAt(D.sx, D.sy, D.sz);
  const reach = Math.max(G.bb.x1 - G.bb.x0, G.bb.y1 - G.bb.y0) * 0.75 + 600;
  const rails = railsNearInChunk(D.sx, D.sy, D.sz, reach, ch);   // = chunkRails(ch) within reach
  for (const sg of rails) {
    const d = segDistance(sg, D.sx, D.sy, D.sz, SD);
    if (d > reach) continue;
    const t0 = Math.max(0, Math.min(sg.len, SD.along));
    const t1 = t0 + 1000 <= sg.len ? t0 + 1000 : t0 - 1000;
    pointAt(sg, t0, Q); const P0 = toPlane(D, Q.x, Q.y, Q.z, {});
    pointAt(sg, t1, Q); const P1 = toPlane(D, Q.x, Q.y, Q.z, {});
    const sgn = t1 > t0 ? 1 : -1;
    let du = (P1.u - P0.u) * sgn, dv = (P1.v - P0.v) * sgn; const l = Math.hypot(du, dv) || 1; du /= l; dv /= l;
    const aligned = D.railKey === sg.key;
    G.rails.push({ seg: sg, pu: P0.u, pv: P0.v, du, dv, t0, s0: -t0, s1: sg.len - t0, aligned, kind: sg.kind, rail: sg.rail, roadW: sg.roadW });
    for (const st of sg.stations) {
      const P = toPlane(D, st.x, st.y, st.z, {});
      if (P.u < G.bb.x0 - 50 || P.u > G.bb.x1 + 50 || P.v < G.bb.y0 - 50 || P.v > G.bb.y1 + 50) continue;
      if (!pointInPoly(G.poly, P.u, P.v)) continue;
      const hs = hash4(G.key, st.idx, sg.key % 1000003, 0x57a7);
      const main = !!st.main, isHalt = !!st.halt;
      const plen = isHalt ? 24 : main ? 210 + (hs % 40) : 130 + (hs % 50);
      const depth = isHalt ? 12 : main ? 44 : 26 + (hs % 8);
      const nu = -dv, nv = du;
      const lp = rasterLand(G, P.u + nu * 60, P.v + nv * 60), lm = rasterLand(G, P.u - nu * 60, P.v - nv * 60);
      const side = Math.abs(lp - lm) > 0.2 ? (lp > lm ? 1 : -1) : ((hs >>> 8) & 1 ? 1 : -1);
      const elev = inIntervals(sg.elev, st.t);
      G.stations.push({ id: st.id, segKey: sg.key, t: st.t, u: P.u, v: P.v, du, dv, side, plen, depth, main, halt: isHalt, elev, kind: sg.kind,
        heading: planeHeading(D, du, dv), hash: hs >>> 0, aligned, ref: st });
    }
  }
}

// ditches / small canals at block scale: hydro returns field ditches only for tiles of level ≥ 13
const ditchCache = new Lru(4000, 'districts.ditchCache');
const QD = {}, PD = {};
/** canals + ditches near a plane rect of district G, in plane coords: [{id, kind, order, width, pts}] */
export function waterLinesNear(G, u0, v0, u1, v1) {
  if (!hasCanals()) return G.canals;
  const D = G.D;
  const keys = new Set();
  for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1], [(u0 + u1) / 2, (v0 + v1) / 2]]) {
    fromPlane(D, u, v, QD);
    const t = tileAt(QD.x, QD.y, QD.z, 13, {});
    keys.add(`${t.face}/${t.x}/${t.y}`);
  }
  const out = [], seen = new Set();
  for (const c of G.canals) { out.push(c); seen.add(c.id); }
  for (const k of keys) {
    let list = ditchCache.get(k);
    if (!list) { const [f, x, y] = k.split('/').map(Number); list = canalsIn(f, 13, x, y).filter((c) => c && c.points && c.points.length >= 2); ditchCache.set(k, list); }
    for (const c of list) {
      const id = c.id !== undefined ? String(c.id) : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const pts = new Float64Array(c.points.length * 2);
      for (let i = 0; i < c.points.length; i++) { latLonToUnit(c.points[i][0], c.points[i][1], QD); toPlane(D, QD.x, QD.y, QD.z, PD); pts[2 * i] = PD.u; pts[2 * i + 1] = PD.v; }
      out.push({ id, kind: c.kind || 'canal', order: c.order || 0, width: c.width || 4, pts, sluices: [] });
    }
  }
  return out;
}

function buildCanals(G) {
  if (!hasCanals()) return;
  const D = G.D;
  if (!(D.zone === 'O' || D.border || D.canyonF > 0.15 || D.rules.canyon || D.canalDist < 8000)) return;
  if (!CLASS[D.cls].grid && D.cls !== DC.OUTPOST && D.cls !== DC.PARK) return;
  const size = Math.max(G.bb.x1 - G.bb.x0, G.bb.y1 - G.bb.y0);
  const level = Math.max(9, Math.min(12, Math.round(Math.log2(5324000 / Math.max(800, size * 1.2)))));
  const keys = new Set();
  for (const [u, v] of [[G.bb.x0, G.bb.y0], [G.bb.x1, G.bb.y0], [G.bb.x0, G.bb.y1], [G.bb.x1, G.bb.y1], [0, 0]]) {
    fromPlane(D, u, v, Q);
    const t = tileAt(Q.x, Q.y, Q.z, level, {});
    keys.add(`${t.face}/${t.x}/${t.y}`);
  }
  const seen = new Set();
  for (const k of keys) {
    const [f, x, y] = k.split('/').map(Number);
    for (const c of canalsIn(f, level, x, y)) {
      if (!c || !c.points || c.points.length < 2) continue;
      const id = c.id !== undefined ? String(c.id) : `${k}:${seen.size}`;
      if (seen.has(id)) continue; seen.add(id);
      const pts = new Float64Array(c.points.length * 2);
      let near = false;
      for (let i = 0; i < c.points.length; i++) {
        latLonToUnit(c.points[i][0], c.points[i][1], Q);
        toPlane(D, Q.x, Q.y, Q.z, PL);
        pts[2 * i] = PL.u; pts[2 * i + 1] = PL.v;
        if (PL.u > G.bb.x0 - 800 && PL.u < G.bb.x1 + 800 && PL.v > G.bb.y0 - 800 && PL.v < G.bb.y1 + 800) near = true;
      }
      if (!near) continue;
      const sl = [];
      for (const s of c.sluices || []) {
        latLonToUnit(s.lat, s.lon, Q); toPlane(D, Q.x, Q.y, Q.z, PL);
        sl.push({ u: PL.u, v: PL.v, up: s.upLevel, down: s.downLevel, heading: s.heading || 0 });
      }
      G.canals.push({ id, kind: c.kind || 'canal', order: c.order || 0, width: c.width || 20, level0: c.level0, level1: c.level1, pts, sluices: sl });
    }
  }
}

function buildPiers(G) {
  const D = G.D;
  if (!D.coastal && !D.waterfront && !D.shoreFerry) return;
  if (!(D.cls === DC.PORT || D.shoreFerry || (D.zone === 'Z' && D.rules.ferry && D.cls >= DC.LOW && D.cls <= DC.CORE) || D.cls === DC.OTOWN || D.cls === DC.POLAR)) return;
  // district sea direction in the plane; piers of one port stay parallel (短而平行的港池)
  const SDp = enToPlane(D, D.seaE, D.seaN, {});
  let sdu = SDp.du, sdv = SDp.dv; { const l = Math.hypot(sdu, sdv) || 1; sdu /= l; sdv /= l; }
  // snap the pier direction to the grid when close (quays follow the street grid)
  if (Math.abs(sdu) > 0.92) { sdu = Math.sign(sdu); sdv = 0; } else if (Math.abs(sdv) > 0.92) { sdv = Math.sign(sdv); sdu = 0; }
  const tu = -sdv, tv = sdu;   // along-shore
  const span = Math.max(G.bb.x1 - G.bb.x0, G.bb.y1 - G.bb.y0);
  const isPort = D.cls === DC.PORT;
  let portFerry = false;
  const h = (k) => hash4(G.key, k, 0x91e7, 0) / 4294967296;
  const Pt = {};
  const exactWet = (u, v) => { fromPlane(D, u, v, Pt); return isWet(Pt.x, Pt.y, Pt.z, 2); };
  const shoreAt = (ou, s0, s1) => {
    let last = null, cross = null;
    for (let s = s0; s < s1; s += 20) {
      const u = ou * tu + s * sdu, v = ou * tv + s * sdv;
      if (!pointInPoly(G.poly, u, v)) { if (last !== null) break; else continue; }
      if (rasterLand(G, u, v) >= 0.5) last = s; else if (last !== null) { cross = s; break; }
    }
    if (cross === null) return null;
    let run = 0, shore = null;
    for (let s = cross - 120; s <= cross + 120; s += 6) {
      if (!exactWet(ou * tu + s * sdu, ou * tv + s * sdv)) { run++; continue; }
      if (run >= 3) { shore = s - 6; break; }
      run = 0;
    }
    return shore;
  };
  const overWater = (ou, sA, len) => {
    for (let s = sA + 25; s <= sA + len; s += 30) if (!exactWet(ou * tu + s * sdu, ou * tv + s * sdv)) return false;
    return true;
  };
  if (isPort) {
    // U4 (fix round 3): ZR5 port districts also carry one passenger ferry terminal on their shore, clear of the cargo
    // piers, so dense ZR5 shores have terminals every 2–5 km (cargo bays included)
    if (D.code === 'ZR5' && D.rules.ferry) portFerry = true;
    const spacing = 150 + (D.hash % 70);
    const nslots = Math.floor(span / spacing);
    for (let k = -nslots; k <= nslots; k++) {
      const ou = k * spacing;
      const sh = shoreAt(ou, -span * 0.5, span * 0.7);
      if (sh === null) continue;
      const len = 160 + h(k) * 220, wid = 34 + h(k + 99) * 26;
      if (!overWater(ou, sh, len)) continue;
      const c0 = sh - 25, c1 = sh + len;
      G.piers.push({ kind: 'pier', cu: ou * tu + (c0 + c1) / 2 * sdu, cv: ou * tv + (c0 + c1) / 2 * sdv, len: c1 - c0, wid, du: sdu, dv: sdv,
        root: [ou * tu + c0 * sdu, ou * tv + c0 * sdv], coastS: sh, ou });
    }
    if (!portFerry) return;
    // the cargo berth nearest the district centre becomes the passenger terminal (ferry pier + terminal block)
    let bi = -1;
    for (let q = 0; q < G.piers.length; q++) if (G.piers[q].kind === 'pier' && (bi < 0 || Math.abs(G.piers[q].ou) < Math.abs(G.piers[bi].ou))) bi = q;
    if (bi >= 0) {
      const pp = G.piers[bi], len = 90, c0 = pp.coastS - 20, c1 = pp.coastS + len;
      const f = { kind: 'ferry', cu: pp.ou * tu + (c0 + c1) / 2 * sdu, cv: pp.ou * tv + (c0 + c1) / 2 * sdv, len: c1 - c0, wid: 18, du: sdu, dv: sdv,
        coastU: pp.ou * tu + pp.coastS * sdu, coastV: pp.ou * tv + pp.coastS * sdv, port: true };
      G.piers.splice(bi, 1);
      G.piers.push(f);
      G.ferries = [f]; G.ferry = f;
      return;
    }
  }
  // ferry terminal / landing: the shore point nearest to the district seed with deep water in front; waterfront
  // districts (U3) get one more terminal for every ~2.6 km of their shore (terminals ≥ 2 km apart, 2–5 km rhythm)
  const cand = [];
  const kmax = D.waterfront || portFerry ? Math.max(4, Math.ceil(span * 0.5 / 220)) : 4;
  for (let k = -kmax; k <= kmax; k++) {
    const ou = k * 220;
    const sh = shoreAt(ou, -span * 0.4, span * 0.7);
    if (sh === null) continue;
    const len = D.zone === 'Z' ? 90 : 50;
    if (!overWater(ou, sh, len)) continue;
    // (a ZR5 port's passenger terminal keeps 350 m clear of its cargo piers)
    if (portFerry && G.piers.some((pp) => pp.kind === 'pier' && Math.abs(pp.ou - ou) < 350)) continue;
    cand.push({ ou, sh, d: Math.abs(ou) + Math.abs(sh) * 0.25, len });
  }
  cand.sort((a, b) => a.d - b.d || a.ou - b.ou);
  const nF = portFerry ? 1 : D.waterfront ? Math.max(1, Math.min(3, Math.round(cand.length * 220 / 2600))) : 1;
  const chosen = [];
  for (const c of cand) { if (chosen.length >= nF) break; if (chosen.every((o) => Math.abs(o.ou - c.ou) >= 2000)) chosen.push(c); }
  G.ferries = [];
  for (const best of chosen) {
    const wid = D.zone === 'Z' ? 18 : 10;
    const c0 = best.sh - 20, c1 = best.sh + best.len;
    const f = { kind: D.zone === 'Z' ? 'ferry' : 'landing', cu: best.ou * tu + (c0 + c1) / 2 * sdu, cv: best.ou * tv + (c0 + c1) / 2 * sdv, len: c1 - c0, wid, du: sdu, dv: sdv,
      coastU: best.ou * tu + best.sh * sdu, coastV: best.ou * tv + best.sh * sdv };
    G.ferries.push(f);
    G.piers.push(f);
  }
  G.ferry = G.ferries[0] || null;
}

/** nearest point / direction of a canal polyline to (u,v) */
export function canalNearest(c, u, v, out) {
  const p = c.pts;
  let best = 1e30;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
    let t = ((u - ax) * ex + (v - ay) * ey) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * ex, qy = ay + t * ey, d = Math.hypot(qx - u, qy - v);
    if (d < best) { best = d; const l = Math.sqrt(l2); out.du = ex / l; out.dv = ey / l; out.qu = qx; out.qv = qy; }
  }
  out.d = best;
  return out;
}

function buildSites(G) {
  const D = G.D;
  const h = (k) => hash4(G.key, k, 0x5173, 0) / 4294967296;
  const CN = {};
  // remote / special single sites
  // OX4 meltwater outlet: pump house on the forebay pool + lee-side greenhouse row (station or outpost district)
  if (D.meltOutlet >= 0) {
    const ol = meltOutlets()[D.meltOutlet];
    if (ol) meltEnsemble(G, ol);
  }
  if (D.cls === DC.OUTPOST && !G.meltSite) {
    const code = D.code;
    let use = 'maintenance';
    if (D.zone === 'Z') use = h(2) < 0.5 ? 'community' : 'maintenance';
    if (D.polar) use = 'insulated_station';
    else if (D.zone === 'O' && D.canalDist < 1500) use = h(1) < 0.5 ? 'pumphouse' : 'sluice_station';
    else if (D.zone === 'O') use = h(1) < 0.5 ? 'maintenance' : 'control_tower';
    for (let k = 0; k < 14; k++) {
      const a = h(10 + k) * Math.PI * 2, rr = k === 0 ? 0 : 120 + 90 * k;
      const u = Math.cos(a) * rr, v = Math.sin(a) * rr;
      if (rasterLand(G, u, v) > 0.9 && rasterSlope(G, u, v) < 0.22) {
        // never on a lake / canal the coast raster does not know (OX1 basin lake, fix round 3)
        fromPlane(D, u, v, Q); if (isWet(Q.x, Q.y, Q.z, 2)) continue;
        G.sites.push({ kind: 'outpost', use, u, v, rot: Math.floor(h(30 + k) * 4) }); break;
      }
    }
  }
  // OX1 东泽汇水盆地 programme (fix round 3, U1, basin.js): sluice stations at the outlet main's sluices, work towers,
  // white maintenance houses along its levee roads and the low utility town below the sill — placed once in the basin
  // frame; this district adds the pieces whose anchor lies in its polygon (+ the town streets, citytile.js)
  const BP = D.zone === 'O' && nearBasinProgram(D.sx, D.sy, D.sz, D.size) ? basinProgram() : null;
  const placed = [];
  if (BP) {
    G.basinRoads = BP.roads;
    for (const s of BP.sites) {
      latLonToUnit(s.lat, s.lon, Q); toPlane(D, Q.x, Q.y, Q.z, PL);
      if (!pointInPoly(G.poly, PL.u, PL.v)) continue;
      const hp = headingToPlane(D, s.heading, {});
      G.sites.push({ kind: 'basin', use: s.use, u: PL.u, v: PL.v, fu: hp.du, fv: hp.dv, w: s.w, d: s.d, meta: { ...s.meta } });
      placed.push([PL.u, PL.v]);
    }
  }
  // canal sluices / junction pump stations (O; also Z border towns on supply canals). Lateral heads first
  // (every branch canal gets its pump station where the bank allows), then the sluices; a rejected site
  // (wet / steep bank) does not block its neighbours.
  if (D.zone === 'O' || D.border) {
    const far = (u, v, d) => placed.every((p) => Math.hypot(p[0] - u, p[1] - v) > d);
    const clearOfBasin = (u, v) => !BP || G.sites.every((o) => o.kind !== 'basin' || Math.hypot(o.u - u, o.v - v) > 70);
    for (const c of G.canals) {
      if (c.kind === 'river' || c.kind === 'spillway') continue;
      if ((c.order || 0) >= 1 && c.pts.length >= 4) {
        const u = c.pts[0], v = c.pts[1];
        if (pointInPoly(G.poly, u, v) && far(u, v, 320) && clearOfBasin(u, v)) {
          canalNearest(c, u, v, CN);
          let fw = 40;
          for (const o of G.canals) {
            if (o === c || (o.order || 0) >= (c.order || 0) || o.kind === 'river') continue;
            canalNearest(o, u, v, CN2);
            if (CN2.d < (o.width || 40) / 2 + 30) { fw = o.width || 40; break; }
          }
          const s = waterSite(G, c, u, v, CN.du, CN.dv, 'pumphouse', 18, 14, fw / 2 + 18 / 2 + 8, 70 + placed.length, null);
          if (s) { G.sites.push(s); placed.push([u, v]); }
        }
      }
    }
    let hamlets = 0;
    for (const c of G.canals) {
      if (c.kind === 'river' || c.kind === 'spillway') continue;
      if (BP && c.id === BP.canalId) continue;   // the basin programme owns the outlet main's sluices
      for (const sl of c.sluices) {
        if (!pointInPoly(G.poly, sl.u, sl.v) || !far(sl.u, sl.v, 260)) continue;
        canalNearest(c, sl.u, sl.v, CN);
        const s = waterSite(G, c, sl.u, sl.v, CN.du, CN.dv, 'sluice_station', 22, 14, 0, 40 + placed.length, sl);
        if (s) {
          G.sites.push(s); placed.push([sl.u, sl.v]);
          // U7 / §2 OX1 沿堤路串起闸务站、温室和低层镇: a small levee settlement beside every other sluice station of
          // the farm country (dorms, maintenance, farm station, cold store along the levee road, behind the station)
          if (D.zone === 'O' && !D.polar && (D.cls === DC.FARM || D.cls === DC.GREENHOUSE) && (c.order || 0) <= 1 && hamlets < 2 && hash4(G.key, placed.length, 0x4a17, 0) % 3 !== 0) {
            if (leveeHamlet(G, c, s, CN.du, CN.dv)) hamlets++;
          }
        }
      }
    }
  }
}

/**
 * Levee settlement (U7): 4–7 low utility buildings in a row along the levee road on the station's bank, 45–260 m
 * up / down the canal from the sluice station, fronts to the levee road (away from the water), each on dry ground
 * with ≤ 3 m corner spread and clear of every canal; returns the number placed.
 */
const QL = {};
function leveeHamlet(G, c, st, du, dv) {
  const D = G.D;
  const nu = st.fu, nv = st.fv;                       // front normal of the station = away from the canal
  const off0 = ((st.u - 0) * nu + (st.v - 0) * nv);   // unused reference
  void off0;
  const items = [['dorm', 34, 12], ['maintenance', 24, 16], ['dorm', 30, 12], ['farm_station', 30, 20], ['cold_storage', 40, 24], ['dorm', 28, 12], ['maintenance', 18, 14]];
  const n = 4 + (hash4(G.key, Math.round(st.u), Math.round(st.v), 0x4a18) % 4);
  let placed = 0, along = 46;
  // the row stands 34 m behind the station's front (levee road between canal bank and houses)
  const back = 12 + st.d / 2 + 22;
  for (let k = 0; k < items.length && placed < n && along < 300; k++) {
    const [use, w, d] = items[k];
    const sgn = k % 2 === 0 ? 1 : -1;
    const a = sgn * (along + w / 2);
    const cu = st.u + du * a + nu * (back + d / 2 - st.d / 2), cv = st.v + dv * a + nv * (back + d / 2 - st.d / 2);
    if (!pointInPoly(G.poly, cu, cv)) { if (sgn < 0) along += w + 8; continue; }
    let lo = 1e9, hi = -1e9, ok = true;
    const xu = -nv, xv = nu;
    for (let q = 0; q < 4 && ok; q++) {
      const x = q === 1 || q === 2 ? w / 2 : -w / 2, z = q < 2 ? d / 2 : -d / 2;
      const pu = cu + x * xu + z * nu, pv = cv + x * xv + z * nv;
      if (nearCanal(G, pu, pv, 6)) { ok = false; break; }
      fromPlane(D, pu, pv, QL);
      if (isWet(QL.x, QL.y, QL.z, 2)) { ok = false; break; }
      if (isWet.h < lo) lo = isWet.h; if (isWet.h > hi) hi = isWet.h;
    }
    if (ok && hi - lo <= 3 && G.sites.every((o) => Math.hypot(o.u - cu, o.v - cv) > (Math.hypot(o.w || 20, o.d || 14) + Math.hypot(w, d)) / 2 + 4)) {
      G.sites.push({ kind: 'hamlet', use, u: cu, v: cv, fu: nu, fv: nv, w, d, meta: { levee: true, canalId: c.id, station: true } });
      placed++;
    }
    if (sgn < 0) along += w + 8 + (hash4(G.key, k, Math.round(cu), 0x4a19) % 12);
  }
  return placed;
}

/**
 * Water-facing utility site beside canal c at the centreline point (au, av) (canal direction du, dv):
 * the BACK facade faces the canal (meta.poolSide 'back'), the front faces away. Candidates on both banks
 * and at three gaps (laterals: the bank without the levee road first); every corner must be dry and the
 * corner spread ≤ 3 m — up to 5 m the site gets a levelled pad (meta.pad, retaining walls), steeper banks
 * get no station. Water levels / flow come from hydro probes on the canal (what the water renderer shows),
 * falling back to the sluice record (upLevel side = opposite to its heading). Returns a site or null.
 */
const CN2 = {}, QW = {};
/**
 * OX4 meltwater outlet ensemble (§5 04): a meltwater pump house on a flank of the forebay pool (back facade =
 * intake side on the pool, 8 m bank), and a row of 4–7 greenhouse halls beside it extending outward along
 * the pool flank — away from the ice, on the lee side of the katabatic wind; gable doors face away from the
 * pool. The flank with dry, near-level ground wins; halls on wet or steep ground are skipped.
 */
const QM = {}, PM = {};
function meltEnsemble(G, ol) {
  const D = G.D;
  toPlane(D, ol.x, ol.y, ol.z, PM);
  const pu = PM.u, pv = PM.v;
  if (!pointInPoly(G.poly, pu, pv)) return;
  const E = enuBasisFromUnit(ol.x, ol.y, ol.z, {});
  const k = 100 / R;
  let qx = ol.x + (E.east[0] * ol.oe + E.north[0] * ol.on) * k, qy = ol.y + (E.east[1] * ol.oe + E.north[1] * ol.on) * k, qz = ol.z + (E.east[2] * ol.oe + E.north[2] * ol.on) * k;
  const ql = Math.hypot(qx, qy, qz); qx /= ql; qy /= ql; qz /= ql;
  toPlane(D, qx, qy, qz, QM);
  let ou = QM.u - pu, ov = QM.v - pv; { const l = Math.hypot(ou, ov) || 1; ou /= l; ov /= l; }
  const tu = -ov, tv = ou, rp = ol.r;
  const hr = (q) => hash4(G.key, q, 0x3e17, ol.idx) / 4294967296;
  const pw = 18, pd = 12, bank = 8, gw = 11, gd = 40 + Math.round(hr(3) * 12), ggap = 3.5;
  const nG = 4 + Math.floor(hr(2) * 4);
  // rect test: dry corners + 2 m band height spread
  const rectOk = (cu, cv, fu, fv, w, d) => {
    const xu = -fv, xv = fu; let lo = 1e9, hi = -1e9;
    for (let q = 0; q < 4; q++) {
      const x = q === 1 || q === 2 ? w / 2 : -w / 2, z = q < 2 ? d / 2 : -d / 2;
      fromPlane(D, cu + x * xu + z * fu, cv + x * xv + z * fv, QM);
      if (isWet(QM.x, QM.y, QM.z, 2)) return null;
      if (isWet.h < lo) lo = isWet.h; if (isWet.h > hi) hi = isWet.h;
    }
    return { spread: hi - lo, lo, hi };
  };
  const s0 = hr(1) < 0.5 ? 1 : -1;
  let best = null;
  for (const sd of [s0, -s0]) {
    const Tu = tu * sd, Tv = tv * sd;
    const cu = pu + Tu * (rp + bank + pd / 2), cv = pv + Tv * (rp + bank + pd / 2);
    const r = rectOk(cu, cv, Tu, Tv, pw, pd);
    if (!r || r.spread > 5) continue;
    // the first hall decides between equally good flanks
    const a0 = pw / 2 + 12 + gw / 2;
    const g = rectOk(pu + Tu * (rp + bank + gd / 2) + ou * a0, pv + Tv * (rp + bank + gd / 2) + ov * a0, Tu, Tv, gw, gd);
    const score = r.spread + (g ? g.spread * 0.5 : 4);
    if (!best || score < best.score) best = { score, sd, Tu, Tv, cu, cv, r };
  }
  if (!best) return;
  const { Tu, Tv } = best;
  // building +x = (−fv, fu) = −sd·o: the halls (at +o) are on the pump's right when x·o > 0
  const xo = -Tv * ou + Tu * ov;
  const pump = {
    kind: 'melt', use: 'meltwater_pump', u: best.cu, v: best.cv, fu: Tu, fv: Tv, w: pw, d: pd,
    meta: {
      intakeSide: 'back', serves: 'greenhouses', servesSide: xo > 0 ? 'right' : 'left', meltwater: true, outletId: ol.id, poolId: ol.poolId,
      water: { level: Math.round(ol.level * 100) / 100, width: Math.round(2 * rp), dist: Math.round((rp + bank + pd / 2) * 100) / 100, flow: 1, pool: true },
    },
  };
  if (best.r.spread > 3) pump.meta.pad = { level: Math.round((best.r.lo + best.r.hi) * 50) / 100, spread: Math.round(best.r.spread * 100) / 100, retaining: true };
  G.sites.push(pump);
  G.meltSite = pump;
  for (let q = 0; q < nG; q++) {
    const a = pw / 2 + 12 + q * (gw + ggap) + gw / 2;
    const cu = pu + Tu * (rp + bank + gd / 2) + ou * a, cv = pv + Tv * (rp + bank + gd / 2) + ov * a;
    const r = rectOk(cu, cv, Tu, Tv, gw, gd);
    if (!r || r.spread > 3) continue;
    G.sites.push({ kind: 'melt', use: 'greenhouse', u: cu, v: cv, fu: Tu, fv: Tv, w: gw, d: gd, meta: { polar: true, span: gw, lee: true, outletId: ol.id } });
  }
}

/** U12: is plane point (u,v) inside a river corridor of district G (river polyline, half width + m)? */
export function nearRiver(G, u, v, m) {
  for (const c of G.canals) {
    if (c.kind !== 'river') continue;
    const p = c.pts, hw = (c.width || 20) / 2 + m;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      if ((u < ax - hw && u < bx - hw) || (u > ax + hw && u > bx + hw) || (v < ay - hw && v < by - hw) || (v > ay + hw && v > by + hw)) continue;
      const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
      let t = ((u - ax) * ex + (v - ay) * ey) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * ex - u, qy = ay + t * ey - v;
      if (qx * qx + qy * qy < hw * hw) return true;
    }
  }
  return false;
}
/** is plane point (u,v) within margin m of the water of any canal of district G (polyline + half width)? */
export function nearCanal(G, u, v, m) {
  for (const c of G.canals) {
    const p = c.pts, hw = (c.width || 20) / 2 + m;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      if ((u < ax - hw && u < bx - hw) || (u > ax + hw && u > bx + hw) || (v < ay - hw && v < by - hw) || (v > ay + hw && v > by + hw)) continue;
      const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
      let t = ((u - ax) * ex + (v - ay) * ey) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * ex - u, qy = ay + t * ey - v;
      if (qx * qx + qy * qy < hw * hw) return true;
    }
  }
  return false;
}
export function waterSite(G, c, au, av, du, dv, use, w, d, along, salt, sl) {
  const D = G.D;
  const cw = c.width || 20;
  const lateral = (c.order || 0) >= 1;
  const h1 = hash4(G.key, salt, 0x5175, 0) / 4294967296;
  const s0 = lateral ? -1 : (h1 < 0.5 ? 1 : -1);
  const cands = lateral ? [[-1, 8], [-1, 12], [-1, 18], [1, 16], [1, 22], [1, 30]]
    : [[s0, 16], [s0, 22], [-s0, 16], [-s0, 22], [s0, 30], [-s0, 30]];
  // cheap pass: canal clearance (all canals of the district, geometric) + 2 m band corner heights;
  // the exact water test (hydro) only for the chosen candidate
  const tried = [];
  for (const [side, gap] of cands) {
    const nu = -dv * side, nv = du * side;            // from the canal toward the building (= front normal)
    const off = cw / 2 + gap + d / 2;
    const cu = au + nu * off + du * along, cv = av + nv * off + dv * along;
    const xu = -nv, xv = nu;                          // building +x
    let lo = 1e9, hi = -1e9, ok = true;
    for (let q = 0; q < 4 && ok; q++) {
      const x = q === 1 || q === 2 ? w / 2 : -w / 2, z = q < 2 ? d / 2 : -d / 2;
      const pu = cu + x * xu + z * nu, pv = cv + x * xv + z * nv;
      if (nearCanal(G, pu, pv, 2.5)) { ok = false; break; }
      fromPlane(D, pu, pv, QW);
      const hh = height(QW.x, QW.y, QW.z, 2);
      if (hh < 0.4) { ok = false; break; }
      if (hh < lo) lo = hh; if (hh > hi) hi = hh;
    }
    if (!ok) continue;
    const spread = hi - lo;
    tried.push({ score: spread + 0.03 * gap, spread, side, gap, cu, cv, nu, nv, xu, xv, off, lo, hi });
    if (spread < 1.2) break;
  }
  tried.sort((a, b) => a.score - b.score);
  let best = null;
  for (const t of tried) {
    if (t.spread > 5) break;
    let wet = false;
    for (let q = 0; q < 4 && !wet; q++) {
      const x = q === 1 || q === 2 ? w / 2 : -w / 2, z = q < 2 ? d / 2 : -d / 2;
      fromPlane(D, t.cu + x * t.xu + z * t.nu, t.cv + x * t.xv + z * t.nv, QW);
      if (isWet(QW.x, QW.y, QW.z, 2)) wet = true;
    }
    if (!wet) { best = t; break; }
  }
  if (!best) return null;
  const b = best;
  // water levels on the canal (hydro truth), both sides of the anchor along the canal
  const probeLevel = (k) => {
    fromPlane(D, au + du * k, av + dv * k, QW);
    const t = waterProbe(QW.x, QW.y, QW.z);
    return t === 2 || t === 3 ? waterProbe.level : (waterProbe.rawType === 2 ? waterProbe.level : NaN);
  };
  const step = Math.max(8, cw * 0.4);
  const ax = du * b.xu + dv * b.xv;                    // +1: canal direction (du,dv) runs toward building +x
  const meta = { canalId: c.id, poolSide: 'back', canalOrder: c.order || 0 };
  if (use === 'sluice_station') {
    let up = NaN, dn = NaN, upSide = 'left';
    const la = probeLevel(-step - along), lb = probeLevel(step - along);
    if (Number.isFinite(la) && Number.isFinite(lb) && Math.abs(la - lb) > 0.05) {
      up = Math.max(la, lb); dn = Math.min(la, lb);
      const highDir = la > lb ? -1 : 1;                 // along (du,dv)
      upSide = highDir * ax > 0 ? 'right' : 'left';
    } else if (sl) {
      // record semantics (before and after the hydro normalisation): upLevel lies opposite to the heading
      const hp = headingToPlane(D, sl.heading || 0, {});
      const hx = hp.du * b.xu + hp.dv * b.xv;
      const upAtPlusX = hx < 0;                         // heading toward −x → the upLevel side is +x
      const a = +sl.up, z = +sl.down;
      up = Math.max(a, z); dn = Math.min(a, z);
      upSide = (a >= z ? upAtPlusX : !upAtPlusX) ? 'right' : 'left';
    }
    if (Number.isFinite(up)) {
      meta.sluice = { up: Math.round(up * 100) / 100, down: Math.round(dn * 100) / 100, upSide, step: Math.round((up - dn) * 100) / 100 };
      meta.water = { level: meta.sluice.up, width: Math.round(cw * 10) / 10, dist: Math.round(b.off * 100) / 100, flow: upSide === 'left' ? 1 : -1 };
    }
    meta.controlRoom = 'upper';
  } else {
    const lv = probeLevel(along);
    let flow = 0;
    if (Number.isFinite(lv)) { const fp = enToPlane(D, waterProbe.fe, waterProbe.fn, {}); flow = fp.du * b.xu + fp.dv * b.xv; }
    if (Math.abs(flow) < 0.3) flow = ax;                // laterals flow away from their head
    const level = Number.isFinite(lv) ? lv : (Number.isFinite(+c.level0) ? +c.level0 : NaN);
    if (Number.isFinite(level)) meta.water = { level: Math.round(level * 100) / 100, width: Math.round(cw * 10) / 10, dist: Math.round(b.off * 100) / 100, flow: flow >= 0 ? 1 : -1 };
    meta.junction = true;
  }
  if (b.spread > 3) meta.pad = { level: Math.round((b.lo + b.hi) * 50) / 100, spread: Math.round(b.spread * 100) / 100, retaining: true };
  return { kind: use === 'sluice_station' ? 'sluice' : 'junction', use, u: b.cu, v: b.cv, fu: b.nu, fv: b.nv, w, d, canal: c.id, meta, spread: b.spread };
}

/** settlement-node activity at plane point (u,v): 1 inside the organic town outline, 0 outside */
export function nodeShape(G, ang) {
  let v = 1;
  for (let k = 1; k <= 3; k++) {
    const a = (hash4(G.key, 0, k, 41) / 4294967296) * Math.PI * 2, m = (0.30 / k) * (0.4 + 0.6 * hash4(G.key, k, 0, 42) / 4294967296);
    v += m * Math.cos(k * ang + a) + 0.5 * m * Math.cos((k + 2) * ang - a);
  }
  return Math.max(0.55, Math.min(1.45, v));
}
