// Blocks of a district street grid.
//   blockPoly(G, i, j)        convex block polygon = street-inset grid cell ∩ district inset polygon,
//                             each edge labelled with what lies beyond it (local street, collector,
//                             rail corridor, arterial / boulevard, district edge)
//   blockInfo(G, i, j, out)   statistical description (use, activity, coverage, colour, light, year …)
//   blockLayout(G, i, j)      exact layout: plots, building footprints, open areas, lanes (cached)
//   point queries inside a layout: buildingAt, areaAt, laneAt, canalBandAt, partHeight
import { hash4 } from '../../core/hash.js';
import { DC, CLASS, CLASS_MIX, BU, BU_STATS, FarmCrop, FarmStage, RAIL } from './rules.js';
import { lineWidthU, lineWidthV, isCollU, isCollV, blockRect, blockIndexU, blockIndexV, rasterLand, rasterSlope, rasterSample, enToPlane, nodeShape, slopeAt, keepsCliffsBare } from './districts.js';
import { pointInPoly, segDist, polyArea } from './geom.js';
import { NF, sstep, grain, beltMask, greenBelt, beltCap } from './potential.js';
/** density of the metro fabric a green belt crosses (district envelope) → belt width cap (U6) */
export function beltDense(D) { return sstep(0.4, 0.7, D.env || 0); }
import { chunkAt } from './dchunks.js';
import { townInfluenceAt } from './settlements.js';
import { Lru } from './lru.js';
import { generateBlock } from './builders.js';
import { harbourAt, skylineCentre } from './harbour.js';
import { basinTownAt } from './basin.js';
import { g02Farm } from './districts.js';
/** G02 bench-terrace weight (terrain-fn sitezones.g02Farm) at plane point (u,v) of district D (U3, fix round 3) */
export function g02TerraceAt(D, u, v) { fromPlaneP(D, u, v, QP); return g02Farm(QP.x, QP.y, QP.z).terrace; }

const layoutCache = new Lru(8000, 'parcels.layoutCache');
const infoCache = new Lru(80000, 'parcels.infoCache');
const RB = {}, QP = {}, TIB = {};

export function blockKey(dkey, i, j) { return dkey * 262144 + (((i + 256) & 511) << 9) + ((j + 256) & 511); }
export function blockIdStr(i, j) { return `${i < 0 ? 'n' + (-i) : i}.${j < 0 ? 'n' + (-j) : j}`; }
export function parseBlockId(s) {
  const p = String(s).split('.'); if (p.length !== 2) return null;
  const f = (t) => (t[0] === 'n' ? -parseInt(t.slice(1), 10) : parseInt(t, 10));
  const i = f(p[0]), j = f(p[1]);
  return Number.isFinite(i) && Number.isFinite(j) && Math.abs(i) < 256 && Math.abs(j) < 256 ? { i, j } : null;
}
export function hb(G, i, j, k) { return hash4(G.key, i, j, k) / 4294967296; }

// ---------------------------------------------------------------------------------------------
// labelled convex clipping
// ---------------------------------------------------------------------------------------------
/** Sutherland–Hodgman clip of a convex polygon P (flat) with per-edge labels L (edge i: vertex i→i+1)
 *  by the half-plane a·u + b·v + c ≥ 0; the new edge along the clip line gets label lab. */
export function clipLabeled(P, L, a, b, c, lab, outP, outL) {
  const n = P.length >> 1;
  outP.length = 0; outL.length = 0;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const cx = P[2 * i], cy = P[2 * i + 1], nx = P[2 * k], ny = P[2 * k + 1];
    const dc = a * cx + b * cy + c, dn = a * nx + b * ny + c;
    if (dc >= 0) {
      outP.push(cx, cy); outL.push(L[i]);
      if (dn < 0) { const t = dc / (dc - dn); outP.push(cx + (nx - cx) * t, cy + (ny - cy) * t); outL.push(lab); }
    } else if (dn >= 0) {
      const t = dc / (dc - dn); outP.push(cx + (nx - cx) * t, cy + (ny - cy) * t); outL.push(L[i]);
    }
  }
  return outP;
}

/** street label of grid line i (u) / j (v) */
function gridLabelU(D, i) { const w = lineWidthU(D, i); return { kind: isCollU(D, i) ? 'coll' : 'street', w, line: 'u', idx: i }; }
function gridLabelV(D, j) {
  const w = lineWidthV(D, j);
  if (D.railKey && j === D.railJ) return { kind: 'rail', w, line: 'v', idx: j, elevated: D.railElev };
  return { kind: isCollV(D, j) ? 'coll' : 'street', w, line: 'v', idx: j };
}

/**
 * Block polygon (flat CCW array) + edge labels {kind: 'street'|'coll'|'rail'|'art'|'edge', w}.
 * Returns null when the block lies outside the district's inset polygon.
 */
export function blockPoly(G, i, j) {
  const D = G.D;
  blockRect(D, i, j, RB);
  if (RB.u1 - RB.u0 < 4 || RB.v1 - RB.v0 < 4) return null;
  // CCW: (u0,v0) → (u1,v0) → (u1,v1) → (u0,v1); edge 0 bottom (v0 line j), 1 right (u1 line i+1), 2 top (v1, j+1), 3 left (u0, i)
  let P = [RB.u0, RB.v0, RB.u1, RB.v0, RB.u1, RB.v1, RB.u0, RB.v1];
  let L = [gridLabelV(D, j), gridLabelU(D, i + 1), gridLabelV(D, j + 1), gridLabelU(D, i)];
  const P2 = [], L2 = [];
  for (const e of G.edges) {
    if (!e.a && !e.b) continue;
    const off = e.w > 0 ? e.w / 2 : (CLASS[D.cls].grid ? 6 : 0);
    // quick reject: half-plane entirely satisfied by all vertices
    let all = true;
    for (let k = 0; k < P.length; k += 2) if (e.a * P[k] + e.b * P[k + 1] + e.c - off < 0) { all = false; break; }
    if (all) continue;
    clipLabeled(P, L, e.a, e.b, e.c - off, { kind: e.w > 0 ? 'art' : 'edge', w: e.w, nkey: e.nkey, ncls: e.ncls, nzone: e.nzone }, P2, L2);
    if (P2.length < 6) return null;
    P = P2.slice(); L = L2.slice();
  }
  const area = Math.abs(polyArea(P));
  if (area < 60) return null;
  return { P, L, area, rect: { u0: RB.u0, v0: RB.v0, u1: RB.u1, v1: RB.v1, U0: RB.U0, U1: RB.U1, V0: RB.V0, V1: RB.V1 } };
}

// ---------------------------------------------------------------------------------------------
// features (stations, ferry, sites) per block, cached per district
// ---------------------------------------------------------------------------------------------
function fkey(i, j) { return (i + 4096) * 8192 + (j + 4096); }
export function features(G) {
  if (G._feat) return G._feat;
  const D = G.D;
  const m = new Map();
  for (const st of G.stations) {
    if (st.halt && st.kind === 'pipe') continue;
    const off = (st.elev ? RAIL.viaduct / 2 + 4 : RAIL.corridor / 2 + 6) + st.depth / 2;
    const cu = st.u - st.dv * st.side * off, cv = st.v + st.du * st.side * off;
    st.bu = cu; st.bv = cv;
    const k = fkey(blockIndexU(D, cu), blockIndexV(D, cv));
    if (!m.has(k)) m.set(k, { station: st });
  }
  for (const f of G.ferries || (G.ferry ? [G.ferry] : [])) {
    const cu = f.coastU - f.du * 30, cv = f.coastV - f.dv * 30;
    const k = fkey(blockIndexU(D, cu), blockIndexV(D, cv));
    const e = m.get(k) || {}; if (!e.station && !e.ferry) e.ferry = f; m.set(k, e);
  }
  for (const s of G.sites) {
    const k = fkey(blockIndexU(D, s.u), blockIndexV(D, s.v));
    const e = m.get(k) || {}; (e.sites || (e.sites = [])).push(s); m.set(k, e);
  }
  G._feat = m;
  return m;
}
export function blockFeatures(G, i, j) { return features(G).get(fkey(i, j)) || null; }

// ---------------------------------------------------------------------------------------------
// Block info (statistical)
// ---------------------------------------------------------------------------------------------
const INFO_KEYS = ['cu', 'cv', 'use', 'active', 'cov', 'h', 'rk', 'roof', 'lu', 'green', 'paved', 'light', 'lc', 'farmCrop', 'farmStage', 'year', 'inside', 'area', 'fill'];
export function blockInfo(G, i, j, out) {
  const k = blockKey(G.key, i, j);
  let c = infoCache.get(k);
  if (!c) { c = blockInfoRaw(G, i, j, {}); infoCache.set(k, c); }
  for (let n = 0; n < INFO_KEYS.length; n++) out[INFO_KEYS[n]] = c[INFO_KEYS[n]];
  return out;
}

function blockInfoRaw(G, i, j, out) {
  const D = G.D, C = CLASS[D.cls];
  blockRect(D, i, j, RB);
  const cu = (RB.u0 + RB.u1) * 0.5, cv = (RB.v0 + RB.v1) * 0.5;
  out.cu = cu; out.cv = cv;
  out.use = BU.NONE; out.active = false; out.cov = 0; out.h = 0; out.rk = 0; out.roof = 0; out.lu = 0; out.green = 0; out.paved = 0;
  out.light = 0; out.lc = 0; out.farmCrop = 0; out.farmStage = 0; out.year = D.year0; out.inside = 0; out.area = 0; out.fill = 0;
  if (!C.grid || G.ihp.length === 0) return out;
  const bp = blockPoly(G, i, j);
  if (!bp) return out;
  const rectA = (RB.u1 - RB.u0) * (RB.v1 - RB.v0);
  out.inside = Math.min(1, bp.area / Math.max(1, rectA));
  out.area = bp.area;
  // centroid of the actual block polygon
  let sx = 0, sy = 0; const nv = bp.P.length >> 1; for (let k = 0; k < bp.P.length; k += 2) { sx += bp.P[k]; sy += bp.P[k + 1]; }
  const pcu = sx / nv, pcv = sy / nv;
  out.cu = pcu; out.cv = pcv;
  const land = rasterLand(G, pcu, pcv);
  const f = blockFeatures(G, i, j);
  if (land < 0.5 && !(f && (f.station || f.ferry))) return out;
  const slope = rasterSlope(G, pcu, pcv);
  const smax = D.terraced ? (D.rules.slopeTerrace || 0.6) : D.rules.slopeMax;
  if (keepsCliffsBare(D)) {
    // canyon walls (ZR2, U5): a block lives when enough of it is tread (contour-terraced housing steps along the
    // benches, builders GEN[TERRACE]); blocks that are mostly riser stay bare red rock
    if (!(f && f.station)) {
      let treadN = 0;
      for (let q = 0; q < 9; q++) {
        const fu = (q % 3) / 2, fv = Math.floor(q / 3) / 2;
        const u = RB.u0 + (RB.u1 - RB.u0) * (0.15 + 0.7 * fu), v = RB.v0 + (RB.v1 - RB.v0) * (0.15 + 0.7 * fv);
        if (slopeAt(G, u, v, 32) < 0.45) treadN++;
      }
      if (treadN < 3) return out;
    }
  } else if (slope > smax && !(f && (f.station || f.ferry)) && !(D.g02 && g02TerraceAt(D, pcu, pcv) > 0.3)) return out;
  const urban = D.cls === DC.LOW || D.cls === DC.MID || D.cls === DC.CORE || D.cls === DC.CAMPUS || D.cls === DC.OTOWN || D.cls === DC.INDUSTRIAL || D.cls === DC.PORT || D.cls === DC.LOGISTICS;
  if (bp.area < (D.cls === DC.FARM ? 3000 : 700) && !(f && f.station)) {
    // slivers between street grids: pocket greens / small squares instead of raw ground
    if (!urban || bp.area < 120 || (D.node && Math.hypot(pcu - D.nodeU, pcv - D.nodeV) > D.nodeR)) return out;
    return smallBlock(G, i, j, out, D.cls === DC.CORE || (D.cls === DC.MID && hb(G, i, j, 24) < 0.4) ? BU.PLAZA : BU.GREENBELT);
  }
  // settlement nodes: organic outline around the village / town / station centre
  if (D.node && D.nodeR) {
    const du = pcu - D.nodeU, dv = pcv - D.nodeV;
    const rn = D.nodeR * nodeShape(G, Math.atan2(dv, du));
    const d = Math.hypot(du, dv);
    if (d > rn) {
      // fringe: scattered plots along the first streets, then nothing
      const p = 1 - sstep(rn, rn * 1.9, d);
      if (hb(G, i, j, 23) > p * 0.55 || D.cls === DC.POLAR) return out;
    }
  } else if (D.cls !== DC.FARM && D.cls !== DC.PARK) {
    // ragged edge toward wild / rural / farm country: blocks near such an edge thin out
    let de = 1e9;
    for (const e of G.edges) {
      if (!(e.ncls === DC.WILD || e.ncls === DC.RURAL || e.ncls === DC.FARM || e.ncls === DC.OUTPOST) || (!e.a && !e.b) || !e.nland) continue;
      const d = e.a * pcu + e.b * pcv + e.c;
      if (d < de) de = d;
    }
    if (de < 480) {
      const pd = 0.72 * (1 - sstep(40, 480, de));
      if (hb(G, i, j, 21) < pd) return out;
    }
  }
  let use = chooseUse(G, i, j, pcu, pcv, bp, f, slope);
  // organic green belts between towns (暗绿间隔) cross the districts
  // (canyon benches keep their housing: the red risers are the gaps there; dense metro fabric: belts ≤ ~900 m, U6)
  if (D.zone === 'Z' && !D.terraced && !D.harbour && use !== BU.STATION && use !== BU.FERRY && use !== BU.CIVIC && (D.cls === DC.LOW || D.cls === DC.MID || D.cls === DC.INDUSTRIAL || D.cls === DC.CAMPUS || D.cls === DC.LOGISTICS || D.cls === DC.RURAL)) {
    fromPlaneP(D, pcu, pcv, QP);
    const dense = beltDense(D);
    // beltMask ≤ greenBelt: the settlement influence is only needed where a belt can be
    if (greenBelt(QP.x, QP.y, QP.z, 0, beltCap(dense)) > 0.5) {
      townInfluenceAt(QP.x, QP.y, QP.z, TIB);
      if (beltMask(QP.x, QP.y, QP.z, TIB.T, 0, dense) > 0.5) use = D.cls === DC.RURAL ? BU.NONE : (hb(G, i, j, 25) < 0.16 ? BU.SPORTS : BU.GREENBELT);
    }
  }
  if (use === BU.NONE) return out;
  out.active = true; out.use = use;
  const st = BU_STATS[use];
  const h1 = hb(G, i, j, 11), h2 = hb(G, i, j, 12);
  out.cov = st.cov * (0.88 + 0.24 * h1);
  out.h = st.h * heightFactor(D, use) * (0.85 + 0.3 * h2);
  out.rk = st.rk; out.roof = st.roof; out.lu = st.lu; out.green = st.green; out.paved = st.paved; out.light = st.light; out.lc = st.lc;
  out.year = blockYear(G, i, j);
  out.fill = out.inside;
  if (use === BU.FARM) { const c = cropOf(G, i, j, 0); out.farmCrop = c.crop; out.farmStage = c.stage; }
  return out;
}

function smallBlock(G, i, j, out, use) {
  const st = BU_STATS[use];
  out.active = true; out.use = use; out.cov = st.cov; out.h = st.h; out.rk = st.rk; out.roof = st.roof; out.lu = st.lu; out.green = st.green;
  out.paved = st.paved; out.light = st.light; out.lc = st.lc; out.year = blockYear(G, i, j); out.fill = out.inside;
  return out;
}
function fromPlaneP(D, u, v, o) {
  const k = 1 / 3389500;
  const x = D.sx + (u * D.e1x + v * D.e2x) * k, y = D.sy + (u * D.e1y + v * D.e2y) * k, z = D.sz + (u * D.e1z + v * D.e2z) * k;
  const l = Math.sqrt(x * x + y * y + z * z); o.x = x / l; o.y = y / l; o.z = z / l; return o;
}

/** mean height factor of a block use in a district (intensity / town centre) */
export function heightFactor(D, use) {
  switch (use) {
    case BU.PERIMETER: case BU.MIXED: case BU.SLAB: return D.cls === DC.CORE ? 1.25 : 0.65 + 0.6 * Math.min(1, D.inten);
    case BU.TOWER_PODIUM: case BU.OFFICE: return 0.55 + 0.75 * Math.min(1, D.T + 0.15);
    case BU.TOWER_PARK: return 0.7 + 0.5 * Math.min(1, D.T + 0.1);
    case BU.TERRACE: return 1;
    default: return 1;
  }
}

export function blockYear(G, i, j) {
  const D = G.D;
  // construction waves: groups of 3×3 blocks were often built in the same decade, single blocks
  // were rebuilt later (different construction years per block)
  const wave = (hash4(G.key, Math.floor(i / 3), Math.floor(j / 3), 0x7ea) / 4294967296 - 0.5) * 70;
  const own = (hb(G, i, j, 31) - 0.5) * 24;
  const rebuilt = hb(G, i, j, 32) < 0.12 ? 40 + 60 * hb(G, i, j, 33) : 0;
  return Math.min(2455, Math.round(D.year0 + wave + own + rebuilt));
}

/** crop and stage of strip k of a farm block — neighbouring fields correlate (season waves) */
export function cropOf(G, i, j, k) {
  const D = G.D;
  const h = hash4(G.key, i, j, 0xc40 + k);
  const season = NF.noise3(D.sx * 900 + i * 0.07, D.sy * 900 + j * 0.07, D.sz * 900);
  const r = (h & 1023) / 1023;
  let crop;
  const code = D.code;
  if (code === 'OX3') crop = r < 0.45 ? FarmCrop.PADDY : r < 0.75 ? FarmCrop.GRAIN : r < 0.9 ? FarmCrop.FODDER : FarmCrop.FALLOW;
  else if (code === 'OX1') crop = r < 0.3 ? FarmCrop.PADDY : r < 0.55 ? FarmCrop.VEGETABLE : r < 0.8 ? FarmCrop.GRAIN : r < 0.9 ? FarmCrop.ORCHARD : FarmCrop.ALGAE;
  else if (code === 'OX5') crop = r < 0.25 ? FarmCrop.ORCHARD : r < 0.6 ? FarmCrop.GRAIN : r < 0.85 ? FarmCrop.VEGETABLE : FarmCrop.FALLOW;
  else if (D.zone === 'Z') crop = r < 0.35 ? FarmCrop.VEGETABLE : r < 0.6 ? FarmCrop.ORCHARD : r < 0.85 ? FarmCrop.GRAIN : FarmCrop.FALLOW;
  else crop = r < 0.4 ? FarmCrop.GRAIN : r < 0.65 ? FarmCrop.VEGETABLE : r < 0.8 ? FarmCrop.FODDER : r < 0.9 ? FarmCrop.ORCHARD : FarmCrop.FALLOW;
  const s = season * 0.8 + (((h >>> 10) & 1023) / 1023 - 0.5) * 0.9;
  let stage = s < -0.32 ? FarmStage.HARVESTED : s < -0.05 ? FarmStage.FLOODING : s < 0.25 ? FarmStage.YOUNG : FarmStage.GROWN;
  if (crop === FarmCrop.FALLOW) stage = FarmStage.HARVESTED;
  if (crop === FarmCrop.ORCHARD) stage = FarmStage.GROWN;
  if (crop !== FarmCrop.PADDY && crop !== FarmCrop.ALGAE && stage === FarmStage.FLOODING) stage = FarmStage.YOUNG;
  return { crop, stage };
}

/** irrigation reach (m from the canal network) at plane point (u,v) of farm district G — smooth, 1.5 km grain */
export function farmReach(G, u, v) {
  const D = G.D;
  fromPlaneP(D, u, v, QP);
  return 450 + 900 * Math.min(1, D.irrig + 0.2) * (0.62 + 0.38 * (1 + grain(QP.x, QP.y, QP.z, 1500, 9)));
}
/** > 0 irrigated (1 well inside, 0.5 in the last 150 m: fallow / half fields), 0 beyond the reach */
export function farmIrrigated(G, u, v) {
  if (G.D.g02 && g02TerraceAt(G.D, u, v) > 0.3) return 1;   // G02 bench terraces (U3): irrigated belt
  const r = G.raster;
  if (rasterSample(r, r.farm, u, v) > 0.4) return 1;
  const cd = rasterSample(r, r.cdist, u, v), reach = farmReach(G, u, v);
  return cd < reach - 150 ? 1 : cd < reach ? 0.5 : 0;
}

/** weighted pick from a [use, weight] mix with a uniform hash value r */
function pickMix(mix, r) {
  let sum = 0; for (const m of mix) sum += m[1];
  let x = r * sum;
  for (const m of mix) { x -= m[1]; if (x <= 0) return m[0]; }
  return mix.length ? mix[mix.length - 1][0] : BU.NONE;
}

/** superblock service placement: one school / clinic / park / community per group of blocks */
function service(G, i, j, sbx, sby, salt) {
  const I = Math.floor(i / sbx), J = Math.floor(j / sby);
  const li = i - I * sbx, lj = j - J * sby, n = sbx * sby;
  const hs = hash4(G.key, I, J, 0x5eb + salt);
  const k = li * sby + lj;
  if (k === hs % n) return BU.SCHOOL;
  if (k === (hs >>> 8) % n && ((hs >>> 30) & 1)) return BU.CLINIC;
  if (k === (hs >>> 14) % n) return BU.PARK;
  if (k === (hs >>> 20) % n) return (hs >>> 29) & 1 ? BU.COMMUNITY : BU.MARKET;
  return -1;
}

/** distance (m) from the block centre to the nearest arterial / collector frontage of the block */
function onMainStreet(bp) {
  for (const l of bp.L) if (l.kind === 'art' || l.kind === 'coll') return true;
  return false;
}

/**
 * Waterfront front row (U3, §5 05 / ZR5 侧湾): blocks with open water within ~170 m seaward carry the low public
 * programme — waterfront parks, water markets, community halls, small squares, waterside shop rows (临水餐廊),
 * clinics / schools — and leave the dense housing (rising inland, builders.js hk) to the rows behind. −1 = not front row.
 */
const SDW = {};
function waterfrontUse(G, i, j, cu, cv) {
  const D = G.D;
  enToPlane(D, D.seaE, D.seaN, SDW);
  if (rasterLand(G, cu + SDW.du * 170, cv + SDW.dv * 170) >= 0.5 && rasterLand(G, cu + SDW.du * 90, cv + SDW.dv * 90) >= 0.5) return -1;
  const r = hb(G, i, j, 40);
  return r < 0.26 ? BU.PARK : r < 0.44 ? BU.MARKET : r < 0.58 ? BU.COMMUNITY : r < 0.70 ? BU.SHOPS : r < 0.80 ? BU.PLAZA : r < 0.90 ? BU.CLINIC : BU.SCHOOL;
}

/**
 * G01 harbour city (U2, fix round 3): the skyline (harbour.js skylineAt) decides where towers stand — tower blocks only
 * inside the clusters (towers become 8–12 storey courtyard / mixed / slab blocks between them and on the low front row),
 * plain blocks inside a cluster become towers with the cluster's share (crown CBD: podium towers; the 35–45 storey
 * cluster: podium + park towers; the low clusters: towers in parks), and the landmark tower stands at the crown point.
 */
const HBU = {};
function harbourUse(G, i, j, cu, cv, use, f) {
  if (f && (f.station || f.ferry)) return use;
  fromPlaneP(G.D, cu, cv, QP);
  harbourAt(QP.x, QP.y, QP.z, HBU);
  if (!(HBU.w > 0)) return use;
  const tw = HBU.tower;
  const towerUse = use === BU.TOWER_PODIUM || use === BU.TOWER_PARK || use === BU.CIVIC;
  if (towerUse || (use === BU.OFFICE && HBU.peak < 12)) {
    if (tw >= 0.5) return use;
    const r = hb(G, i, j, 42);
    return r < 0.45 ? BU.PERIMETER : r < 0.75 ? BU.MIXED : BU.SLAB;
  }
  const c = HBU.cluster ? skylineCentre(HBU.cluster) : null;
  if (!c) return use;
  const plain = use === BU.PERIMETER || use === BU.MIXED || use === BU.SLAB || use === BU.COURT || use === BU.ROW || use === BU.SHOPS || use === BU.OFFICE || use === BU.DETACHED;
  if (HBU.crown && c.use === 'podium' && (plain || use === BU.PLAZA || use === BU.PARK || use === BU.SCHOOL || use === BU.CLINIC || use === BU.COMMUNITY || use === BU.MARKET)) return BU.TOWER_PODIUM;
  if (plain && hb(G, i, j, 43) < 0.85 * tw) {
    if (c.use === 'podium') return hb(G, i, j, 44) < 0.8 ? BU.TOWER_PODIUM : BU.TOWER_PARK;
    if (c.use === 'mixed') return hb(G, i, j, 44) < 0.5 ? BU.TOWER_PODIUM : BU.TOWER_PARK;
    return BU.TOWER_PARK;
  }
  return use;
}

function chooseUse(G, i, j, cu, cv, bp, f, slope) {
  const use = chooseUse0(G, i, j, cu, cv, bp, f, slope);
  return G.D.harbour ? harbourUse(G, i, j, cu, cv, use, f) : use;
}

function chooseUse0(G, i, j, cu, cv, bp, f, slope) {
  const D = G.D;
  if (f && f.station) return BU.STATION;
  if (f && f.ferry) return BU.FERRY;
  if (D.waterfront && (D.cls === DC.LOW || D.cls === DC.MID || D.cls === DC.CORE) && !D.terraced) {
    const w = waterfrontUse(G, i, j, cu, cv);
    if (w >= 0) return w;
  }
  const h = hb(G, i, j, 1);
  const cls = D.cls;
  const dSeed = Math.hypot(cu, cv);
  const main = onMainStreet(bp);
  // proximity to a station (passenger flows): mixed-use and shops around the station square
  let stD = 1e9;
  for (const st of G.stations) { if (st.halt) continue; const d = Math.hypot(st.u - cu, st.v - cv); if (d < stD) stD = d; }
  const nearSt = stD < 420;
  switch (cls) {
    case DC.CORE: {
      if (D.townKey >= 0 && D.townKind === 'city' && D.townDist < 900 && dSeed < Math.max(D.bw, D.bd) * 0.7 && h < 0.6) return BU.CIVIC;
      const s = service(G, i, j, 4, 4, 1); if (s === BU.PARK) return BU.PLAZA; if (s === BU.SCHOOL || s === BU.CLINIC) return s;
      if (nearSt && h < 0.5) return h < 0.25 ? BU.TOWER_PODIUM : BU.MIXED;
      return pickMix(CLASS_MIX[DC.CORE], hb(G, i, j, 2));
    }
    case DC.MID: {
      if (D.terraced) { const s = service(G, i, j, 3, 6, 2); if (s >= 0 && s !== BU.MARKET) return s; return h < 0.86 ? BU.TERRACE : BU.PARK; }
      const s = service(G, i, j, 5, 4, 3); if (s >= 0) return s;
      if (nearSt && h < 0.55) return h < 0.3 ? BU.MIXED : BU.SHOPS;
      if (main && h < 0.35) return BU.MIXED;
      return pickMix(CLASS_MIX[DC.MID], hb(G, i, j, 2));
    }
    case DC.LOW: {
      if (D.terraced) { const s = service(G, i, j, 3, 6, 4); if (s >= 0 && s !== BU.MARKET) return s; return h < 0.88 ? BU.TERRACE : BU.PARK; }
      if (D.node) {
        // village centre: a square with shops / clinic / school near the node, rows and houses around
        const dn = Math.hypot(cu - D.nodeU, cv - D.nodeV);
        if (dn < D.bw * 0.8) return h < 0.4 ? BU.MARKET : h < 0.75 ? BU.SHOPS : BU.COMMUNITY;
        const s = service(G, i, j, 5, 3, 5); if (s === BU.SCHOOL || s === BU.CLINIC) return s;
        return h < 0.5 ? BU.ROW : h < 0.85 ? BU.DETACHED : BU.COURT;
      }
      const s = service(G, i, j, 6, 3, 6); if (s >= 0) return s;
      if (nearSt && h < 0.45) return BU.MIXED;
      if (main && h < 0.25) return BU.SHOPS;
      return pickMix(CLASS_MIX[DC.LOW], hb(G, i, j, 2));
    }
    case DC.RURAL: {
      // village / hamlet: houses with gardens along the first streets, a few fields around
      if (D.townKind === 'village' && D.nodeR > 400 && Math.hypot(cu - D.nodeU, cv - D.nodeV) < D.bw * 0.7 && h < 0.5) return BU.SHOPS;
      if (h < 0.72) return BU.VILLAGE;
      return D.zone === 'Z' ? BU.FARM : BU.VILLAGE;
    }
    case DC.INDUSTRIAL: return pickMix(CLASS_MIX[DC.INDUSTRIAL], hb(G, i, j, 2));
    case DC.PORT: {
      // quay-side blocks: water within ~180 m seaward
      const sd = enToPlane(D, D.seaE, D.seaN, {});
      const Lq = rasterLand(G, cu + sd.du * 160, cv + sd.dv * 160), L2 = rasterLand(G, cu + sd.du * 400, cv + sd.dv * 400);
      if (Lq < 0.5) return BU.PORT_SHEDS;
      if (L2 < 0.5) return h < 0.7 ? BU.WAREHOUSE : BU.PORT_SHEDS;
      return pickMix(CLASS_MIX[DC.PORT], hb(G, i, j, 2));
    }
    case DC.CAMPUS: return pickMix(CLASS_MIX[DC.CAMPUS], hb(G, i, j, 2));
    case DC.LOGISTICS: return pickMix(CLASS_MIX[DC.LOGISTICS], hb(G, i, j, 2));
    case DC.FARM: {
      // OX1 basin town ground (U1, basin.js): no fields under the utility town below the sill
      fromPlaneP(D, cu, cv, QP);
      if (basinTownAt(QP.x, QP.y, QP.z)) return BU.NONE;
      // fields follow the irrigated farmland of the canal network; past the last ditches the rough
      // red earth shows (过了灌溉末端便露出粗糙的赤土). U7: the reach is a smooth field (no per-block dice) and a
      // block lives when any part of it is irrigated — GEN[FARM] then keeps only the field pieces within reach, so
      // the farmland edge follows the canal branches instead of the block grid
      let irrigated = false;
      for (let q = 0; q < 5 && !irrigated; q++) {
        const u = q === 0 ? cu : q & 1 ? bp.rect.u0 + 4 : bp.rect.u1 - 4, v = q === 0 ? cv : q & 2 ? bp.rect.v0 + 4 : bp.rect.v1 - 4;
        irrigated = farmIrrigated(G, u, v) > 0;
      }
      if (!irrigated) return BU.NONE;
      if (h < 0.018) return BU.GREENHOUSES;
      if (h < 0.026) return BU.UTILITY;
      return BU.FARM;
    }
    case DC.GREENHOUSE: return pickMix(CLASS_MIX[DC.GREENHOUSE], hb(G, i, j, 2));
    case DC.OTOWN: {
      const s = (() => {
        const I = Math.floor(i / 5), J = Math.floor(j / 4), n = 20, hs = hash4(G.key, I, J, 0x07e);
        const k = (i - I * 5) * 4 + (j - J * 4);
        if (k === hs % n) return BU.UTILITY; if (k === (hs >>> 8) % n) return BU.LOGISTICS; if (k === (hs >>> 16) % n) return BU.PARK;
        if (k === (hs >>> 22) % n) return BU.SCHOOL;
        return -1;
      })();
      if (s >= 0) return s;
      return pickMix(CLASS_MIX[DC.OTOWN], hb(G, i, j, 2));
    }
    case DC.POLAR: {
      const dn = Math.hypot(cu - D.nodeU, cv - D.nodeV);
      if (dn < 230) return BU.POLAR_STATION;
      return pickMix(CLASS_MIX[DC.POLAR], hb(G, i, j, 2));
    }
    default: return BU.NONE;
  }
}

// ---------------------------------------------------------------------------------------------
// Exact layouts
// ---------------------------------------------------------------------------------------------
export function blockLayout(G, i, j) {
  const k = blockKey(G.key, i, j);
  let L = layoutCache.get(k);
  if (!L) { L = generateBlock(G, i, j, blockInfo(G, i, j, {}), blockPoly(G, i, j), blockFeatures(G, i, j)); L.key = k; layoutCache.set(k, L); }
  return L;
}

// ---------------------------------------------------------------------------------------------
// point queries inside a layout
// ---------------------------------------------------------------------------------------------
export function buildingAt(L, u, v) {
  const bl = L.bld;
  for (let k = 0; k < bl.length; k++) {
    const b = bl[k];
    if (u < b.bx0 || u > b.bx1 || v < b.by0 || v > b.by1) continue;
    if (b.circle) { const du = u - b.cu, dv = v - b.cv; if (du * du + dv * dv <= b.circle * b.circle) return b; continue; }
    if (b.pp) { if (pointInPoly(b.pp, u, v)) return b; continue; }
    const du = u - b.cu, dv = v - b.cv;
    const a = du * b.xu + dv * b.xv, c = du * b.fu + dv * b.fv;
    if (a >= -b.w / 2 && a <= b.w / 2 && c >= -b.d / 2 && c <= b.d / 2) return b;
  }
  return null;
}
/** roof height (m) of building b at (u,v) (tower on podium / stepped terraces) */
export function partHeight(b, u, v) {
  if (!b.tower) return b.height;
  const t = b.tower;
  const du = u - t.cu, dv = v - t.cv;
  if (t.round) return du * du + dv * dv <= (t.w / 2) * (t.w / 2) ? b.height : b.podium.height;
  const a = du * b.xu + dv * b.xv, c = du * b.fu + dv * b.fv;
  return Math.abs(a) <= t.w / 2 && Math.abs(c) <= t.d / 2 ? b.height : b.podium.height;
}
export function areaAt(L, u, v) {
  const a = L.areas;
  for (let k = 0; k < a.length; k++) {
    const e = a[k];
    if (u < e.x0 || u > e.x1 || v < e.y0 || v > e.y1) continue;
    if (!pointInPoly(e.poly, u, v)) continue;
    return e;
  }
  return null;
}
/** canal bank / levee band at (u,v): 0 none, 1 bank, 2 levee road, 3 water (from the block's canal segments) */
export function canalBandAt(L, u, v) {
  const sg = L.canalSegs;
  if (!sg || !sg.length) return 0;
  let best = 1e9, ditch = false;
  for (let k = 0; k < sg.length; k++) {
    const s = sg[k];
    const d = segDist(u, v, s.x0, s.y0, s.x1, s.y1) - s.hw;
    if (d < best) { best = d; ditch = s.ditch; }
  }
  if (best < 0) return 3;
  if (best < (ditch ? 1.5 : 7)) return 1;
  if (!ditch && best < 15) return 2;
  return 0;
}
export function laneAt(L, u, v) {
  for (const l of L.lanes) if (segDist(u, v, l.u0, l.v0, l.u1, l.v1) <= l.w / 2) return l;
  return null;
}
