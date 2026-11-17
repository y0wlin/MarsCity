// urbanSample: per-texel raster of the plan at any texel size, area-averaged (never aliasing):
//   L0  field expectation       texel ≳ 2.6 km  (orbit: settlement envelope, town cores, class mix,
//                                                corridor light network, emission envelope)
//   L1  district                0.14–1 km       (district patchwork, arterials, rails, stations)
//   L2  block statistics        6–60 m          (block uses, filtered street grid, parks, docks)
//   L3  exact                   ≲ 2.5 m         (footprints, lanes, sidewalks, yards, fields)
// Neighbouring levels are cross-faded so zooming never pops. Every level derives from the same
// settlements / districts / blocks / buildings as the 3D city (远景城群…从同一组地块派生): the class
// statistics used at L0/L1 are the expectation of the block mix used at L2/L3.
import { R, PROVINCE_CODES } from '../../core/constants.js';
import { hash4 } from '../../core/hash.js';
import { provinceAt, isOxygenZone } from '../../data/controlMaps.js';
import {
  SurfaceClass as SC, LandUse as LU, RoofKind as RK, DC, NCLASS, CLASS, CLASS_MIX, CLASS_LANDUSE, BU, BU_STATS,
  LIGHT_TEMP, LIGHT_ONSET, LightClass as LC, FarmCrop, RAIL, STREET_LIGHT, arterialWidth, ROOF_STYLES, WINDOW_K, PROVINCE_RULES,
} from './rules.js';
import { chunkAt, nearestDistrict } from './dchunks.js';
import { chunkTowns, townInfluence } from './settlements.js';
import { chunkRails, chunkLinks, segDistance, inIntervals } from './corridors.js';
import { district1, district2, toPlane, fromPlane, lineU, lineV, lineWidthU, lineWidthV, isCollU, isCollV, blockIndexU, blockIndexV, blockRect, rasterLand, nodeShape, slopeAt, keepsCliffsBare } from './districts.js';
import { blockInfo, blockLayout, buildingAt, partHeight, areaAt, laneAt, canalBandAt, hb, beltDense, farmIrrigated } from './parcels.js';
import { envZ, bgZ, envO, farmO, industrialTendency, greenBelt, beltMask, landFrac, sstep, bandK, grain } from './potential.js';
import { fieldsAt, fieldsFrom } from './lattice.js';
import { hpDistance, pointInPoly } from './geom.js';
import { Lru } from './lru.js';

// ---------------------------------------------------------------------------------------------
// palette (linear RGB): renderers may use fabricRGB directly: albedo = mix(terrain, fabricRGB, fabric)
// ---------------------------------------------------------------------------------------------
const ROOF_RGB = [   // by RoofKind: ceramic, metal, membrane, solar, garden, glass, warm, dark, terrace, insulated
  [0.80, 0.77, 0.70], [0.48, 0.50, 0.51], [0.88, 0.88, 0.84], [0.20, 0.23, 0.28], [0.17, 0.25, 0.11],
  [0.50, 0.58, 0.62], [0.64, 0.46, 0.33], [0.16, 0.17, 0.19], [0.38, 0.44, 0.30], [0.80, 0.82, 0.84],
];
const C_ROAD = [0.085, 0.088, 0.094], C_WALK = [0.52, 0.50, 0.46], C_PLAZA = [0.60, 0.58, 0.53], C_YARD = [0.30, 0.30, 0.25];
const C_PARK = [0.09, 0.16, 0.055], C_TREE = [0.038, 0.082, 0.028], C_IND = [0.25, 0.245, 0.23], C_DOCK = [0.40, 0.385, 0.35];
const C_RAIL = [0.15, 0.13, 0.11], C_FROAD = [0.34, 0.22, 0.14], C_CONT = [0.30, 0.21, 0.15], C_PARKING = [0.17, 0.17, 0.18];
const C_SOLAR = [0.06, 0.08, 0.12], C_PITCH = [0.09, 0.22, 0.06], C_BANK = [0.20, 0.22, 0.14], C_LANE = [0.26, 0.25, 0.23];
const C_COURT = [0.20, 0.25, 0.13], C_GARDEN = [0.13, 0.19, 0.08], C_PAVE_LIGHT = [0.46, 0.44, 0.40], C_SCHOOLYARD = [0.38, 0.33, 0.27], C_BASIN = [0.05, 0.12, 0.16];
const C_STREET = mixc(C_ROAD, C_WALK, 0.38);
const CROP_RGB = {   // [grown, harvested, flooding, young] per FarmCrop
  [FarmCrop.GRAIN]: [[0.12, 0.19, 0.035], [0.42, 0.29, 0.12], [0.06, 0.10, 0.11], [0.20, 0.30, 0.06]],
  [FarmCrop.VEGETABLE]: [[0.07, 0.17, 0.04], [0.30, 0.20, 0.10], [0.06, 0.10, 0.11], [0.15, 0.27, 0.07]],
  [FarmCrop.PADDY]: [[0.09, 0.20, 0.05], [0.33, 0.27, 0.12], [0.05, 0.10, 0.12], [0.14, 0.26, 0.10]],
  [FarmCrop.ORCHARD]: [[0.035, 0.085, 0.025], [0.035, 0.085, 0.025], [0.035, 0.085, 0.025], [0.035, 0.085, 0.025]],
  [FarmCrop.FODDER]: [[0.10, 0.21, 0.05], [0.34, 0.30, 0.13], [0.06, 0.10, 0.11], [0.18, 0.28, 0.08]],
  [FarmCrop.FALLOW]: [[0.30, 0.11, 0.05], [0.30, 0.11, 0.05], [0.30, 0.11, 0.05], [0.30, 0.11, 0.05]],
  [FarmCrop.ALGAE]: [[0.05, 0.16, 0.13], [0.05, 0.16, 0.13], [0.05, 0.16, 0.13], [0.05, 0.16, 0.13]],
};
const CROP_DEFAULT = CROP_RGB[FarmCrop.GRAIN];
const C_FARM_MEAN = [0.11, 0.17, 0.05];
function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// ---------------------------------------------------------------------------------------------
// expected statistics of a block use and of a district class (L0 / L1), derived from the same
// tables the block generator uses
// ---------------------------------------------------------------------------------------------
const OTHER_RGB = [];   // non-roof, non-green remainder of a block by use (yards, plazas, quays …)
function otherColour(u) {
  switch (u) {
    case BU.TOWER_PODIUM: case BU.OFFICE: case BU.PLAZA: case BU.MARKET: case BU.CIVIC: case BU.STATION: case BU.FERRY: return C_PLAZA;
    case BU.WAREHOUSE: case BU.LOGISTICS: case BU.UTILITY: case BU.POLAR_STATION: return C_IND;
    case BU.PORT_SHEDS: return mixc(C_CONT, C_DOCK, 0.4);
    case BU.PARKING: return C_PARKING;
    case BU.SOLAR: return C_SOLAR;
    case BU.SCHOOL: return C_SCHOOLYARD;
    case BU.FARM: return C_FARM_MEAN;
    default: return C_YARD;
  }
}
for (let u = 0; u < BU_STATS.length; u++) OTHER_RGB[u] = otherColour(u);
/** mean roof colour of ordinary housing in a district roof style */
const STYLE_ROOF = ROOF_STYLES.map((list) => {
  const c = [0, 0, 0];
  for (const k of list) { const r = ROOF_RGB[k], gm = k === RK.GARDEN ? 0.45 : 0; for (let q = 0; q < 3; q++) c[q] += (r[q] * (1 - gm) + ROOF_RGB[0][q] * gm) / list.length; }
  return c;
});
const STYLE_W = [0.38, 0.18, 0.16, 0.14, 0.14];
const HOUSING = new Set([BU.ROW, BU.DETACHED, BU.COURT, BU.PERIMETER, BU.MIXED, BU.SLAB, BU.TOWER_PARK, BU.SHOPS, BU.VILLAGE, BU.DORMS]);
/** mean albedo of a block of use u (tone multiplies roofs) in district roof style `style` */
function blockRGB(u, tone, out, style = 0) {
  const st = BU_STATS[u];
  const rc = HOUSING.has(u) ? STYLE_ROOF[style] : (ROOF_RGB[st.rk] || ROOF_RGB[0]);
  const gc = u === BU.SPORTS || u === BU.SCHOOL ? C_PITCH : u === BU.ROW || u === BU.DETACHED || u === BU.VILLAGE ? C_GARDEN : C_PARK;
  const oc = OTHER_RGB[u];
  const rmix = !HOUSING.has(u) && st.rk === RK.GARDEN ? 0.45 : 0;   // garden roofs are never all planted
  const cov = st.cov, gr = st.green, oth = Math.max(0, 1 - cov - gr);
  for (let k = 0; k < 3; k++) {
    const roof = (rc[k] * (1 - rmix) + ROOF_RGB[0][k] * rmix) * tone;
    out[k] = cov * roof + gr * gc[k] + oth * oc[k];
  }
  return out;
}

// class statistics: fraction of district area that is fabric (blocks + streets), roof cover, green,
// road, farm, mean roof height (coverage weighted), roof tone, colour, light, light temp / onset
const ACT = [0, 0.13, 0.86, 0.92, 0.95, 0.90, 0.88, 0.90, 0, 0.86, 0.80, 0.72, 0.40, 0.08, 0.004];
export function streetLightOf(cls) {
  switch (cls) {
    case DC.CORE: return 0.95; case DC.MID: return 0.52; case DC.PORT: return 0.62; case DC.INDUSTRIAL: return 0.42; case DC.LOGISTICS: return 0.40;
    case DC.LOW: return 0.30; case DC.OTOWN: return 0.32; case DC.CAMPUS: return 0.34; case DC.RURAL: return 0.18; case DC.GREENHOUSE: case DC.POLAR: return 0.14;
    case DC.FARM: return 0.0; default: return 0.25;
  }
}
const DSTATS = [];    // [style][class]
function computeClassStats(style) {
  const tmp = [0, 0, 0], out = [];
  for (let c = 0; c < NCLASS; c++) {
    const C = CLASS[c], mix = CLASS_MIX[c] || [];
    const s = { fabric: 0, cov: 0, green: 0, road: 0, farm: 0, h: 0, roof: 0, rgb: [0, 0, 0], light: 0, lt: 0, lo: 0, rk: RK.CERAMIC, lu: CLASS_LANDUSE[c] };
    if (c === DC.PARK) {
      s.fabric = 0.96; s.green = 0.88; s.road = 0.05; s.cov = 0.002; s.h = 4; s.roof = 0.7; s.rk = RK.GARDEN;
      s.rgb = mixc(C_PARK, C_TREE, 0.35).map((v, k) => v * 0.92 + C_WALK[k] * 0.06);
      s.light = 0.03; s.lt = LIGHT_TEMP[LC.STREET]; s.lo = LIGHT_ONSET[LC.STREET];
      out[c] = s; continue;
    }
    if (!C.grid || !mix.length) {
      if (c === DC.OUTPOST) { s.fabric = 0.004; s.cov = 0.0006; s.h = 6; s.roof = 0.9; s.rgb = [0.5, 0.5, 0.48]; s.light = 0.004; s.lt = LIGHT_TEMP[LC.UTILITY]; s.lo = 0; }
      out[c] = s; continue;
    }
    const wu = C.street + (C.coll - C.street) / Math.max(1, C.collEvery), wv = wu;
    const sf = 1 - (1 - wu / C.module[0]) * (1 - wv / C.module[1]);
    const act = ACT[c];
    let wsum = 0; for (const m of mix) wsum += m[1];
    let cov = 0, green = 0, hcov = 0, roofT = 0, light = 0, lt = 0, lo = 0, farm = 0;
    const rgb = [0, 0, 0];
    let bestRk = RK.CERAMIC, bestRkW = -1; const rkW = new Float64Array(10);
    for (const [u, w0] of mix) {
      const w = w0 / wsum, st = BU_STATS[u];
      cov += w * st.cov; green += w * st.green; hcov += w * st.cov * st.h; roofT += w * st.cov * st.roof;
      light += w * st.light * WINDOW_K; lt += w * st.light * WINDOW_K * LIGHT_TEMP[st.lc]; lo += w * st.light * WINDOW_K * LIGHT_ONSET[st.lc];
      if (u === BU.FARM) farm += w * 0.96;
      blockRGB(u, 1, tmp, style); rgb[0] += w * tmp[0]; rgb[1] += w * tmp[1]; rgb[2] += w * tmp[2];
      rkW[st.rk] += w * st.cov;
    }
    for (let k = 0; k < 10; k++) if (rkW[k] > bestRkW) { bestRkW = rkW[k]; bestRk = k; }
    const blockA = (1 - sf) * act, streetA = sf * Math.min(1, act * 1.15);
    const streetL = streetLightOf(c);
    s.fabric = blockA + streetA;
    s.cov = blockA * cov; s.green = blockA * green; s.road = streetA; s.farm = blockA * farm;
    s.h = cov > 0 ? hcov / cov : 0; s.roof = cov > 0 ? roofT / cov : 0.8; s.rk = bestRk;
    const sc = c === DC.FARM || c === DC.GREENHOUSE || c === DC.POLAR ? C_FROAD : C_STREET;
    for (let k = 0; k < 3; k++) s.rgb[k] = s.fabric > 0 ? (blockA * rgb[k] + streetA * sc[k]) / s.fabric : 0;
    const bl = blockA * light, sl = streetA * streetL;
    s.light = bl + sl;
    s.lt = s.light > 0 ? (bl * (light > 0 ? lt / light : 0.3) + sl * LIGHT_TEMP[LC.STREET]) / s.light : 0.3;
    s.lo = s.light > 0 ? (bl * (light > 0 ? lo / light : 0.5) + sl * LIGHT_ONSET[LC.STREET]) / s.light : 0.5;
    out[c] = s;
  }
  return out;
}
for (let st = 0; st < ROOF_STYLES.length; st++) DSTATS[st] = computeClassStats(st);
// style-weighted expectation for the field level (no district known there)
const DSTAT = DSTATS[0].map((s0, c) => {
  const s = { ...s0, rgb: [0, 0, 0] };
  for (let st = 0; st < ROOF_STYLES.length; st++) for (let k = 0; k < 3; k++) s.rgb[k] += STYLE_W[st] * DSTATS[st][c].rgb[k];
  return s;
});
export function classStats(c, style = -1) { return style < 0 ? DSTAT[c] : DSTATS[style][c]; }

// ---------------------------------------------------------------------------------------------
// sample record helpers
// ---------------------------------------------------------------------------------------------
function newS() {
  return { cls: 0, coverage: 0, roofKind: 0, roof: 0, height: 0, landUse: 0, light: 0, lightGround: 0, lightTemp: 0.3, lightOnset: 0.5,
    districtTone: 0.5, farmCrop: 0, farmStage: 0, blockId: 0, parcelId: 0, fabric: 0, green: 0, road: 0, farm: 0, water: 0,
    fabricR: 0, fabricG: 0, fabricB: 0, dclass: 0, elevated: 0, bridge: 0, covered: 0, lightPort: 0 };
}
function zeroS(s) {
  s.cls = 0; s.coverage = 0; s.roofKind = 0; s.roof = 0; s.height = 0; s.landUse = 0; s.light = 0; s.lightGround = 0; s.lightTemp = 0.3; s.lightOnset = 0.5;
  s.districtTone = 0.5; s.farmCrop = 0; s.farmStage = 0; s.blockId = 0; s.parcelId = 0; s.fabric = 0; s.green = 0; s.road = 0; s.farm = 0; s.water = 0;
  s.fabricR = 0; s.fabricG = 0; s.fabricB = 0; s.dclass = 0; s.elevated = 0; s.bridge = 0; s.covered = 0; s.lightPort = 0;
  return s;
}
const CONT = ['coverage', 'roof', 'height', 'light', 'lightGround', 'lightTemp', 'lightOnset', 'districtTone', 'fabric', 'green', 'road', 'farm', 'water', 'fabricR', 'fabricG', 'fabricB', 'lightPort'];
/** a ← lerp(a, b, w) for continuous fields (colours weighted by fabric); discrete fields from b when w ≥ 0.5 */
function mixInto(a, b, w) {
  if (w <= 0) return a;
  if (w >= 1) { for (const k in b) a[k] = b[k]; return a; }
  const wa = 1 - w;
  const la = a.light, lb = b.light, lw = la * wa + lb * w;
  const lt = lw > 1e-6 ? (a.lightTemp * la * wa + b.lightTemp * lb * w) / lw : a.lightTemp * wa + b.lightTemp * w;
  const lo = lw > 1e-6 ? (a.lightOnset * la * wa + b.lightOnset * lb * w) / lw : a.lightOnset * wa + b.lightOnset * w;
  const cw = a.coverage * wa + b.coverage * w;
  const h = cw > 1e-6 ? (a.height * a.coverage * wa + b.height * b.coverage * w) / cw : a.height * wa + b.height * w;
  const fw = a.fabric * wa + b.fabric * w;
  const fr = fw > 1e-6 ? (a.fabricR * a.fabric * wa + b.fabricR * b.fabric * w) / fw : a.fabricR * wa + b.fabricR * w;
  const fg = fw > 1e-6 ? (a.fabricG * a.fabric * wa + b.fabricG * b.fabric * w) / fw : a.fabricG * wa + b.fabricG * w;
  const fb = fw > 1e-6 ? (a.fabricB * a.fabric * wa + b.fabricB * b.fabric * w) / fw : a.fabricB * wa + b.fabricB * w;
  for (let i = 0; i < CONT.length; i++) { const k = CONT[i]; a[k] = a[k] * wa + b[k] * w; }
  a.lightTemp = lt; a.lightOnset = lo; a.height = h; a.fabricR = fr; a.fabricG = fg; a.fabricB = fb;
  if (w >= 0.5) {
    a.cls = b.cls; a.roofKind = b.roofKind; a.landUse = b.landUse; a.farmCrop = b.farmCrop; a.farmStage = b.farmStage;
    a.blockId = b.blockId; a.parcelId = b.parcelId; a.dclass = b.dclass; a.elevated = b.elevated; a.bridge = b.bridge; a.covered = b.covered;
  }
  return a;
}

const S_A = newS(), S_B = newS(), S_C = newS(), S_D = newS();
const TI = {}, ND = {}, SD = {}, PL = {}, BI = {}, RB = {}, LF = {}, BI2 = {};

// night-light envelope from the emission control map: keeps the gradient from dim arms to bright
// centres (no saturation), so the large-scale light pattern follows emission.png
function emissionEnv(e) { return 0.08 + 0.92 * Math.pow(sstep(0.0, 0.9, e), 1.2); }
/** settlement nodes (villages, hamlets, O towns, polar stations) stay visible as discrete points */
function nodeEnv(e) { return Math.max(0.42, emissionEnv(e)); }

/** smooth intra-district fabric brightness variation at 1–5 km (band-limited by the footprint t), ±~9 % */
function toneGrain(x, y, z, t) {
  const k1 = bandK(4200, t), k2 = bandK(1700, t);
  let g = 1;
  if (k1 > 0) g += 0.065 * k1 * grain(x, y, z, 4200, 21);
  if (k2 > 0) g += 0.045 * k2 * grain(x, y, z, 1700, 22);
  return g;
}

function addColor(s, c, w) { s.fabricR += c[0] * w; s.fabricG += c[1] * w; s.fabricB += c[2] * w; }
function normColor(s) {
  const f = s.fabric;
  if (f > 1e-6) { s.fabricR /= f; s.fabricG /= f; s.fabricB /= f; } else { s.fabricR = s.fabricG = s.fabricB = 0; }
}

/** box-filtered fraction of a line of width w at distance d for texel t */
function lineFrac(d, w, t) {
  if (w <= 0) return 0;
  const a = Math.abs(d);
  if (t <= w * 0.25) return a <= w / 2 ? 1 : 0;
  const lo = Math.max(a - t / 2, -w / 2), hi = Math.min(a + t / 2, w / 2);
  return hi > lo ? Math.min(1, (hi - lo) / Math.max(t, 1e-6)) : 0;
}

// ---------------------------------------------------------------------------------------------
// L0 — field expectation
// ---------------------------------------------------------------------------------------------
const W_CLS = new Float64Array(NCLASS);
const C3 = [0, 0, 0];
const NODE_CLS = new Uint8Array(NCLASS); NODE_CLS[DC.RURAL] = 1; NODE_CLS[DC.OTOWN] = 1; NODE_CLS[DC.POLAR] = 1; NODE_CLS[DC.GREENHOUSE] = 1;
function level0(x, y, z, t, Fx, s) {
  zeroS(s);
  const land = landFrac(Fx, t);
  if (land <= 0.001) { s.water = 1; return s; }
  // settlements resolve below ~9 km texels; coarser footprints read the field envelope alone, so
  // planet-scale tiles never need the settlement graph (no global warm-up at orbit)
  const kT = 1 - sstep(5000, 9000, t);
  let ch = null, T = 0, tk = 'none';
  if (kT > 0) {
    ch = chunkAt(x, y, z);
    townInfluence(chunkTowns(ch), x, y, z, TI, t);
    T = TI.T * kT; tk = TI.town ? TI.town.kind : 'none';
  }
  W_CLS.fill(0);
  const zO = Fx.zoneO;
  // ---- Z mixture
  if (zO < 0.999) {
    const wZ = 1 - zO;
    const env = envZ(Fx, x, y, z, t);
    const bg = bgZ(Fx, x, y, z);
    const g = 0.30 + 0.40 * Fx.urban;
    const kn = bandK(6500, t);
    const nv = kn > 0 ? kn * grain(x, y, z, 6500, 1) : 0;
    const I = Math.max(0, Math.min(1, env * (g + (1 - g) * T) + 0.14 * nv * env));
    if (env < 0.10) {
      // background country: villages (T of a village) and farmsteads in the stripes
      const vill = tk === 'village' ? sstep(0.05, 0.4, T) : 0;
      const rural = Math.min(1, bg * 0.55 + vill * 0.6);
      W_CLS[DC.LOW] += wZ * vill * 0.35;
      W_CLS[DC.RURAL] += wZ * rural * (1 - vill * 0.35);
      W_CLS[DC.WILD] += wZ * Math.max(0, 1 - rural * (1 - vill * 0.35) - vill * 0.35);
      if (env > 0.035) { const k = sstep(0.035, 0.10, env); W_CLS[DC.LOW] += wZ * 0.25 * k; W_CLS[DC.WILD] = Math.max(0, W_CLS[DC.WILD] - wZ * 0.25 * k); }
    } else {
      const ind = industrialTendency(x, y, z);
      // dark-green belts between towns (暗绿间隔), crater parks, a few big parks
      const belt = beltMask(x, y, z, T, t, sstep(0.4, 0.7, env));
      const park = Math.min(0.85, Math.max(Fx.park || 0, belt * 0.92 + 0.035));
      const rest = (1 - park) * wZ;
      W_CLS[DC.PARK] += park * wZ;
      const wRural = 1 - sstep(0.07, 0.15, I), wLow = sstep(0.07, 0.15, I) * (1 - sstep(0.32, 0.40, I));
      const wMid = sstep(0.32, 0.40, I), wCore = wMid * sstep(0.55, 0.72, T) * sstep(0.6, 0.75, I);
      const fInd = sstep(0.30, 0.48, ind) * 0.9;
      const coastal = Fx.coastM < 2500 ? sstep(2500, 600, Fx.coastM) : 0;
      W_CLS[DC.RURAL] += rest * wRural * 0.62; W_CLS[DC.WILD] += rest * wRural * 0.38;
      W_CLS[DC.INDUSTRIAL] += rest * fInd * (wLow + wMid - wCore);
      W_CLS[DC.PORT] += rest * coastal * 0.35 * (wLow + wMid);
      const resi = rest * (1 - fInd) * (1 - coastal * 0.35);
      W_CLS[DC.LOW] += resi * wLow * 0.96;
      W_CLS[DC.MID] += resi * (wMid - wCore) * 0.96;
      W_CLS[DC.CAMPUS] += resi * (wMid - wCore + wLow) * 0.04;
      W_CLS[DC.CORE] += rest * wCore;
    }
  }
  // ---- O mixture
  if (zO > 0.001) {
    const env = envO(Fx, x, y, z, t);
    const farm = Math.max(farmO(Fx), zO < 0.95 ? 0.45 * sstep(0.04, 0.2, Fx.density) : 0);
    // decision DD (U13): no open farmland north of 70N — the ice-margin country farms in greenhouses only
    const polar = Fx.frost > 0.35 || Fx.ice > 0.25 || y > 0.9397;
    if (polar) {
      const st = tk === 'station' ? sstep(0.05, 0.35, T) : 0;
      W_CLS[DC.POLAR] += zO * st * 0.5;
      W_CLS[DC.GREENHOUSE] += zO * st * 0.15;
      W_CLS[DC.WILD] += zO * (1 - st * 0.65);
    } else if (env < 0.02 && farm < 0.05) W_CLS[DC.WILD] += zO;
    else {
      const wt = (tk === 'otown' || tk === 'hamlet') ? sstep(0.25, 0.55, T) : 0;
      const wg = (1 - wt) * sstep(0.15, 0.3, T) * 0.08;
      const wf = (1 - wt - wg) * farm;
      W_CLS[DC.OTOWN] += zO * wt;
      W_CLS[DC.GREENHOUSE] += zO * wg;
      W_CLS[DC.FARM] += zO * wf;
      W_CLS[DC.WILD] += zO * Math.max(0, 1 - wt - wg - wf);
    }
  }
  // ---- accumulate class statistics
  const em = emissionEnv(Fx.emission), emN = nodeEnv(Fx.emission);
  // night (DN / A02): background farmland country is dark between its settlements — rural light only where a
  // village / hamlet / O town actually is (settlement influence), never a uniform sprinkle over the land
  const kRural = Math.min(1, 0.06 + 2.2 * sstep(0.04, 0.35, T));
  let roofW = 0, light = 0, lt = 0, lo = 0, best = 0, bw = -1;
  for (let c = 0; c < NCLASS; c++) {
    const w = W_CLS[c]; if (w <= 1e-6) continue;
    if (w > bw) { bw = w; best = c; }
    const st = DSTAT[c];
    s.fabric += w * st.fabric; s.coverage += w * st.cov; s.green += w * st.green; s.road += w * st.road; s.farm += w * st.farm;
    s.height += w * st.cov * st.h; roofW += w * st.cov; s.roof += w * st.cov * st.roof;
    addColor(s, st.rgb, w * st.fabric);
    const l = st.light * w * (NODE_CLS[c] ? emN : em) * (c === DC.RURAL || c === DC.GREENHOUSE || c === DC.OTOWN ? kRural : 1);
    light += l; lt += l * st.lt; lo += l * st.lo;
  }
  // cold-white port working lights (DN lightPort): presence of lit quays in the texel, coverage-preserving
  // (a quay row anywhere in a 2–9 km texel keeps the texel's port value) — terrain-render draws short point rows
  if (zO < 0.5 && Math.abs(Fx.coastM) < 0.6 * t + 900) {
    const lat = Math.asin(Math.max(-1, Math.min(1, y))) * 57.29577951308232, lon = Math.atan2(x, z) * 57.29577951308232;
    const pr = PROVINCE_RULES[PROVINCE_CODES[provinceAt(lat, lon)]], port = pr && pr.zone === 'Z' ? (pr.port || 0) : 0;
    if (port > 0) s.lightPort = Math.min(1, 0.4 + port) * sstep(0.05, 0.22, envZ(Fx, x, y, z, t)) * (1 - sstep(0.35 * t + 300, 0.6 * t + 900, Math.abs(Fx.coastM)));
  }
  if (roofW > 1e-6) { s.height /= roofW; s.roof /= roofW; }
  normColor(s);
  // town cores: denser, taller, brighter (city centres and their station squares)
  const core = sstep(0.45, 0.9, T) * (tk === 'city' ? 1 : tk === 'town' ? 0.6 : 0.2);
  s.height *= 1 + 1.5 * core;
  s.fabric *= land; s.coverage *= land; s.green *= land; s.road *= land; s.farm *= land;
  s.water = 1 - land;
  // lit corridors between settlements (光网): highways with lights, rail stations, roadside nodes
  let corridor = 0, corrT = 0;
  if (kT > 0) {
    const links = chunkLinks(ch);
    for (let i = 0; i < links.length; i++) {
      const sg = links[i];
      const amp = sg.kind === 'metro' ? 0.20 : sg.kind === 'regional' ? 0.12 : sg.kind === 'road' ? (zO > 0.5 ? 0.0 : 0.06) : sg.kind === 'pipe' ? 0.012 : 0.02;
      if (amp <= 0) continue;
      const hw = sg.kind === 'metro' ? 1100 : 550, se = hw * hw + 0.25 * t * t;
      const d = segDistance(sg, x, y, z, SD);
      if (d > 3 * Math.sqrt(se)) continue;
      // light along the corridor is not uniform: roadside clusters every few km
      const beads = 0.5 + 0.5 * Math.cos(SD.t / 2600 + (sg.key % 97));
      const k = amp * Math.sqrt((hw * hw) / se) * Math.exp(-(d * d) / se) * (t < 3000 ? beads : 1);
      corridor += k * kT; corrT += k * kT * LIGHT_TEMP[sg.kind === 'pipe' ? LC.UTILITY : LC.STREET];
    }
  }
  const coreL = 0.30 * core * em;
  const L = (light * (0.5 + 1.6 * core) + coreL) * land + corridor * (0.45 + 0.55 * em) * land;
  s.light = Math.min(1.5, L);
  const lTot = light * (0.5 + 1.6 * core) + coreL + corridor;
  s.lightTemp = lTot > 1e-6 ? (lt * (0.5 + 1.6 * core) + coreL * 0.28 + corrT) / lTot : 0.3;   // station / civic cores: wide, bright, warm
  s.lightOnset = light > 1e-6 ? lo / light : 0.5;
  s.lightGround = s.light * 0.6;
  s.dclass = best;
  s.landUse = s.fabric < 0.5 ? LU.NONE : CLASS_LANDUSE[best];
  s.cls = best === DC.WILD ? SC.NATURAL : best === DC.FARM ? SC.FARM : best === DC.PARK ? SC.PARK : best === DC.GREENHOUSE ? SC.GREENHOUSE : s.fabric > 0.3 ? SC.ROOF : SC.NATURAL;
  s.roofKind = DSTAT[best].rk;
  s.districtTone = 0.5;
  return s;
}

// ---------------------------------------------------------------------------------------------
// L1 — district
// ---------------------------------------------------------------------------------------------
function nodeCover(dist, t, r) {
  // area-averaged settlement node (gaussian ⊗ box) around the node centre
  const s2 = r * r, e2 = s2 + 0.35 * t * t;
  return Math.min(1, (s2 / e2) * 1.25 * Math.exp(-(dist * dist) / e2));
}
const PARK_RGB = mixc(C_PARK, C_TREE, 0.4);
function level1(x, y, z, t, Fx, s) {
  zeroS(s);
  nearestDistrict(x, y, z, ND);
  const D = district1(ND.key);
  const ch = ND.chunk;
  const land = landFrac(Fx, t);
  s.dclass = D.cls; s.districtTone = D.tone; s.covered = D.covered ? 1 : 0;
  const st = DSTATS[D.roofStyle || 0][D.cls];
  const hMod = D.cls === DC.CORE ? 0.6 + 0.9 * D.T : D.cls === DC.MID ? 0.7 + 0.5 * D.inten : 1;
  let fabric = st.fabric, cov = st.cov, road = st.road, green = st.green, farm = st.farm, light = st.light;
  // settlement nodes (villages, hamlets, O towns, polar stations): organic outline around the centre
  if (D.node) {
    toPlane(D, x, y, z, PL);
    const du = PL.u - (D.nodeU || 0), dv = PL.v - (D.nodeV || 0);
    const r = (D.nodeR || 400) * 0.9;
    const k = nodeCover(Math.hypot(du, dv), t, r) / Math.max(0.05, ACT[D.cls]);
    fabric = Math.min(1, fabric * k * 0.85); cov = Math.min(0.6, cov * k * 0.85); road = Math.min(1, road * k); green *= k; light *= k * 0.85;
  }
  if (D.cls === DC.FARM) {
    // fields only within irrigation reach of the canal network (beyond: rough red earth)
    const reach = 450 + 900 * Math.min(1, D.irrig + 0.2);
    const irr = Math.max(sstep(0.25, 0.6, Fx.farm), 1 - sstep(reach * 0.7, reach * 1.3, Fx.canal));
    farm *= irr; fabric *= irr;
  }
  // organic green belts between towns cross the districts (same mask as the blocks)
  let belt = 0;
  if (D.zone === 'Z' && !D.terraced && !D.harbour && (D.cls === DC.LOW || D.cls === DC.MID || D.cls === DC.INDUSTRIAL || D.cls === DC.CAMPUS || D.cls === DC.LOGISTICS)) {
    townInfluence(chunkTowns(ch), x, y, z, TI, t);
    belt = beltMask(x, y, z, TI.T, t, beltDense(D));
  }
  s.height = st.h * hMod; s.roof = st.roof;
  s.roofKind = st.rk; s.landUse = CLASS_LANDUSE[D.cls];
  // colour: class mean (district palette pulled halfway to the regional mean), district tone patchwork
  // (A03: ±8 % roof brightness, a little hue) and intra-district variation at 1–5 km (toneGrain)
  const tm = (0.92 + 0.16 * D.tone) * toneGrain(x, y, z, t), sm = DSTAT[D.cls].rgb;
  C3[0] = (st.rgb[0] * 0.55 + sm[0] * 0.45) * tm; C3[1] = (st.rgb[1] * 0.55 + sm[1] * 0.45) * tm; C3[2] = (st.rgb[2] * 0.55 + sm[2] * 0.45) * tm * (0.98 + 0.04 * D.tone);
  if (D.cls === DC.FARM && farm > 0) {
    const c = farmColor(D);
    const k = farm / Math.max(1e-6, fabric);
    for (let q = 0; q < 3; q++) C3[q] = C3[q] * (1 - k) + c[q] * k;
  }
  // sub-district grain: blocks of different age / use read as a fine patchwork (band-limited)
  const kg = bandK(700, t);
  if (kg > 0) { const g = 1 + 0.10 * kg * grain(x, y, z, 700, 3); C3[0] *= g; C3[1] *= g; C3[2] *= g; }
  if (belt > 0) {
    for (let q = 0; q < 3; q++) C3[q] = C3[q] * (1 - belt) + PARK_RGB[q] * belt;
    fabric = fabric * (1 - belt) + 0.96 * belt; cov *= 1 - belt; green = green * (1 - belt) + 0.9 * belt; light *= 1 - belt * 0.9; farm *= 1 - belt;
  }
  if (keepsCliffsBare(D)) {
    // canyon districts: ~1/4 of the wall area is bare risers (sub-texel here; resolved by level 2/3)
    const k = 0.76; fabric *= k; cov *= k; road *= k; green *= k; light *= 0.85;
  }
  s.fabric = fabric; s.coverage = cov; s.road = road; s.green = green; s.farm = farm;
  addColor(s, C3, fabric);
  // arterials (district edges) as filtered lines
  let lineRoad = 0, lineLight = 0;
  if (ND.nkey >= 0 && ND.edge < t * 1.5 + 40) {
    const N = district1(ND.nkey);
    const w = arterialWidth(D.cls, N.cls);
    if (w > 0) { const f = lineFrac(ND.edge, w, t) * land; lineRoad += f; lineLight += f * (D.zone === 'Z' ? STREET_LIGHT.arterial : 0.15); }
  }
  const rl = corridorLines(ch, x, y, z, t, D);
  lineRoad += rl.road; lineLight += rl.light;
  if (lineRoad > 0) {
    const f = Math.min(1, lineRoad), keep = 1 - f;
    s.coverage *= keep; s.green *= keep; s.farm *= keep;
    const fabNew = s.fabric * keep + f;
    s.fabricR = s.fabricR * keep + f * C_STREET[0]; s.fabricG = s.fabricG * keep + f * C_STREET[1]; s.fabricB = s.fabricB * keep + f * C_STREET[2];
    s.fabric = fabNew; s.road = s.road * keep + f;
  }
  s.fabric *= land; s.coverage *= land; s.green *= land; s.road *= land; s.farm *= land;
  s.fabricR *= land; s.fabricG *= land; s.fabricB *= land;
  normColor(s);
  s.water = 1 - land;
  // lights
  const em = D.node ? nodeEnv(Fx.emission) : emissionEnv(Fx.emission);
  let L = light * (0.6 + 0.4 * D.inten) * (0.75 + 0.7 * D.T);
  if (D.cls === DC.FARM || D.cls === DC.WILD) L = 0;
  if (D.cls === DC.RURAL && !D.node) L *= 0.12;   // farmsteads between villages: a few faint points, mostly dark
  if (kg > 0) L *= 1 + 0.5 * kg * grain(x, y, z, 900, 4);
  const stl = stationGlow(ch, x, y, z, t) * (0.5 + 0.5 * emissionEnv(Fx.emission));
  let Lb = L * land * em;
  const Ll = lineLight * (0.4 + 0.6 * emissionEnv(Fx.emission));
  // working port quays (A02 / §1 夜面): a hard, cold-white band of floodlit berths along the port shoreline;
  // the rest of the port district is dimmer than housing
  let Lq = 0;
  if (D.cls === DC.PORT) {
    Lb *= 0.7; Lq = 1.1 * lineFrac(Fx.coastM - 150, 280, t) * (0.45 + 0.55 * em);
    // lightPort: the quay band widened to the texel so the row survives aggregation (presence, not a mean)
    s.lightPort = (1 - sstep(140 + 0.5 * t, 260 + 0.9 * t, Math.abs(Fx.coastM - 150))) * land;
  }
  L = Lb + Ll + stl + Lq;
  s.light = Math.min(2, L);
  if (L > 1e-6) {
    s.lightTemp = (Lb * st.lt + Ll * LIGHT_TEMP[LC.STREET] + stl * 0.34 + Lq * LIGHT_TEMP[LC.PORT]) / L;
    s.lightOnset = (Lb * st.lo + Ll * LIGHT_ONSET[LC.STREET] + stl * LIGHT_ONSET[LC.TRANSIT] + Lq * LIGHT_ONSET[LC.PORT]) / L;
  } else { s.lightTemp = st.lt; s.lightOnset = st.lo; }
  s.lightGround = s.light * 0.6;
  s.cls = D.cls === DC.WILD ? SC.NATURAL : D.cls === DC.FARM ? (s.farm > 0.3 ? SC.FARM : SC.NATURAL) : D.cls === DC.PARK || belt > 0.5 ? SC.PARK
    : D.cls === DC.GREENHOUSE ? SC.GREENHOUSE : (s.fabric > 0.3 ? SC.ROOF : SC.NATURAL);
  if (lineRoad > 0.5) s.cls = SC.ROAD_ART;
  if (land < 0.5) s.cls = SC.NATURAL;
  if (s.fabric < 0.5 && s.farm < 0.5) s.landUse = LU.NONE;
  s.elevated = rl.elevated;
  return s;
}

const RL = { road: 0, light: 0, elevated: 0, d: 1e9, rail: false };
/** rails / corridor roads near p (filtered); outside dense districts a road runs beside the rail */
function corridorLines(ch, x, y, z, t, D) {
  RL.road = 0; RL.light = 0; RL.elevated = 0; RL.d = 1e9; RL.rail = false;
  const rails = chunkRails(ch);
  const lim = t * 1.5 + 80;
  const dense = D && (D.cls === DC.CORE || D.cls === DC.MID);
  for (let i = 0; i < rails.length; i++) {
    const sg = rails[i];
    if (Math.abs(x * sg.nx + y * sg.ny + z * sg.nz) * R > lim) continue;
    const d = segDistance(sg, x, y, z, SD);
    if (d > lim) continue;
    if (sg.rail) {
      const rw = RAIL.corridor;
      const f = lineFrac(d, rw, t);
      if (f > 0 && d < RL.d) { RL.d = d; RL.rail = true; }
      RL.road += f;
      if (sg.kind === 'metro' && inIntervals(sg.elev, SD.t)) RL.elevated = Math.max(RL.elevated, f > 0 ? 1 : 0);
    }
    // corridor road: beside the rail (offset) or on the centreline for road-only links
    if (!dense || !sg.rail) {
      const off = sg.rail ? RAIL.highwayOffset : 0, hw = sg.roadW || 12;
      const f = lineFrac(Math.abs(SD.side) - off, hw, t) * (d < off + hw + t ? 1 : 0);
      if (f > 0 && !sg.rail && d < RL.d) { RL.d = d; RL.rail = false; }
      RL.road += f;
      const ll = sg.kind === 'metro' ? STREET_LIGHT.highway : sg.kind === 'regional' ? 0.5 : sg.kind === 'road' ? (D && D.zone === 'O' ? 0.03 : 0.35) : sg.kind === 'pipe' ? 0.02 : STREET_LIGHT.service;
      RL.light += f * ll;
    }
  }
  return RL;
}

function stationGlow(ch, x, y, z, t) {
  const rails = chunkRails(ch);
  let g = 0;
  const rad = Math.max(t * 0.9, 260);
  for (let i = 0; i < rails.length; i++) {
    const sg = rails[i];
    if (!sg.stations.length) continue;
    if (Math.abs(x * sg.nx + y * sg.ny + z * sg.nz) * R > rad * 3) continue;
    for (const st of sg.stations) {
      const dx = st.x - x, dy = st.y - y, dz = st.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
      if (d > rad * 3) continue;
      const amp = st.halt ? (sg.kind === 'pipe' ? 0.35 : 0.25) : st.main ? 1.3 : 0.85;
      // area-normalised so the glow integral is constant across texel sizes (no fat blobs at orbit)
      const rr = st.halt ? 40 : st.main ? 380 : 230;
      const sig = Math.max(rr, t * 0.6);
      g += amp * (rr * rr) / (sig * sig) * Math.exp(-(d * d) / (sig * sig));
    }
  }
  return g;
}

function farmColor(D) {
  const season = grain(D.sx, D.sy, D.sz, 14000, 5);
  const st = season < -0.3 ? 1 : season < 0 ? 3 : 0;
  const crop = D.code === 'OX3' ? FarmCrop.PADDY : D.code === 'OX5' ? FarmCrop.ORCHARD : FarmCrop.GRAIN;
  const a = CROP_RGB[crop][st], b = CROP_RGB[FarmCrop.VEGETABLE][0];
  return mixc(a, b, 0.4);
}

// ---------------------------------------------------------------------------------------------
// L2/L3 — block statistics and exact geometry
// ---------------------------------------------------------------------------------------------
function level23(x, y, z, t, exact, s) {
  zeroS(s);
  nearestDistrict(x, y, z, ND);
  const D = district1(ND.key);
  const ch = ND.chunk;
  s.dclass = D.cls; s.districtTone = D.tone; s.covered = D.covered ? 1 : 0;
  if (D.cls === DC.WILD && ND.edge > t + 60) {
    // wilderness: only corridors (rails, roads, pipe galleries) can be here
    const rl = corridorLines(ch, x, y, z, t, D);
    if (rl.road > 0) { fieldsAt(x, y, z, Math.max(t * 4, 200), LF); const land = landFrac(LF, t); if (land > 0.5) { linearOnly(s, rl, t, D); s.water = 1 - land; return s; } }
    s.cls = SC.NATURAL;
    return s;
  }
  const G = district2(ND.key);
  toPlane(D, x, y, z, PL);
  const u = PL.u, v = PL.v;
  const land = rasterLand(G, u, v);
  const rl = corridorLines(ch, x, y, z, t, D);
  let art = 0, artW = 0;
  if (ND.nkey >= 0 && ND.edge < 40 + t) {
    const N = district1(ND.nkey);
    artW = arterialWidth(D.cls, N.cls);
    if (artW > 0) art = lineFrac(ND.edge, artW, t);
  }
  let pier = 0;
  for (let k = 0; k < G.piers.length; k++) {
    const p = G.piers[k];
    const du = u - p.cu, dv = v - p.cv;
    const along = du * p.du + dv * p.dv, cross = -du * p.dv + dv * p.du;
    const f = lineFrac(along, p.len, t) * lineFrac(cross, p.wid, t);
    if (f > pier) pier = f;
  }
  const r = exact ? exactSample(s, G, D, u, v, t, land, rl, art, artW, pier, x, y, z) : blockStats(s, G, D, u, v, t, land, rl, art, artW, pier, x, y, z);
  // canyon walls (ZR2, Z04 / §5 06): red rock risers between the terraced benches — no district fabric,
  // streets or yards on fine slopes > 0.5…0.8 (the 3D buildings follow the same rule, builders.finalize);
  // rails / corridor roads keep their lines
  if (keepsCliffsBare(D) && land >= 0.5) {
    const k = sstep(0.5, 0.8, slopeAt(G, u, v, t));
    if (k > 0) bareCliff(r, k, Math.min(1, rl.road));
  }
  return r;
}

/** fade the built fabric of sample s by k on a cliff face, keeping corridor lines (fraction lin) */
function bareCliff(s, k, lin) {
  const keep = 1 - k;
  const nonLin = Math.max(0, s.fabric - lin);
  s.fabric = lin + nonLin * keep;
  s.coverage *= keep; s.green *= keep; s.farm *= keep; s.road = Math.min(s.road, lin + Math.max(0, s.road - lin) * keep);
  s.light *= keep + (1 - keep) * lin; s.lightGround *= keep + (1 - keep) * lin;
  s.height *= s.coverage > 0.02 ? 1 : 0;
  if (k > 0.5 && lin < 0.5) {
    s.cls = SC.NATURAL; s.landUse = LU.NONE; s.blockId = 0; s.parcelId = 0; s.roofKind = 0; s.coverage = 0;
    if (s.fabric < 0.02) { s.fabricR = s.fabricG = s.fabricB = 0; }
  }
  return s;
}

function linearOnly(s, rl, t, D) {
  const f = Math.min(1, rl.road);
  s.road = f; s.fabric = f;
  addColor(s, rl.rail ? C_RAIL : (D.zone === 'O' ? C_FROAD : C_ROAD), f);
  normColor(s);
  s.cls = f > 0.5 ? (rl.rail ? SC.RAIL : (D.polar ? SC.PIPE : SC.ROAD_ART)) : SC.NATURAL;
  const em = emissionEnv(D.emission);
  s.light = rl.light * em; s.lightGround = s.light; s.lightTemp = LIGHT_TEMP[LC.STREET]; s.lightOnset = LIGHT_ONSET[LC.STREET];
  s.elevated = rl.elevated;
  s.landUse = f > 0.5 ? LU.TRANSIT : LU.NONE;
  return s;
}

/** filtered coverage of the street bands of one grid axis over [x−t/2, x+t/2] */
function gridFracU(D, x, t) {
  const lo = x - t / 2, hi = x + t / 2;
  const i0 = blockIndexU(D, lo), i1 = blockIndexU(D, hi) + 1;
  let s = 0;
  for (let i = i0; i <= i1; i++) {
    const c = lineU(D, i), w = lineWidthU(D, i);
    if (w <= 0) continue;
    const a = Math.max(lo, c - w / 2), b = Math.min(hi, c + w / 2);
    if (b > a) s += b - a;
  }
  return Math.min(1, s / Math.max(t, 1e-6));
}
function gridFracV(D, x, t) {
  const lo = x - t / 2, hi = x + t / 2;
  const j0 = blockIndexV(D, lo), j1 = blockIndexV(D, hi) + 1;
  let s = 0;
  for (let j = j0; j <= j1; j++) {
    const c = lineV(D, j), w = lineWidthV(D, j);
    if (w <= 0) continue;
    const a = Math.max(lo, c - w / 2), b = Math.min(hi, c + w / 2);
    if (b > a) s += b - a;
  }
  return Math.min(1, s / Math.max(t, 1e-6));
}

function parkGround(s, D, land, rl, art, x, y, z, t) {
  const lin = Math.min(1, art + rl.road);
  const g = (1 - lin) * land;
  s.fabric = g + lin * land; s.green = g * 0.9; s.road = lin * land;
  const grove = sstep(-0.2, 0.3, grain(x, y, z, 160, 6) * bandK(160, t) + 0.05);
  addColor(s, mixc(C_PARK, C_TREE, grove), g); addColor(s, C_STREET, lin * land);
  normColor(s);
  s.water = 1 - land;
  s.cls = land < 0.5 ? SC.NATURAL : lin > 0.5 ? SC.ROAD_ART : SC.PARK;
  s.landUse = land < 0.5 ? LU.NONE : LU.PARK;
  const em = emissionEnv(D.emission);
  s.light = (0.02 * g + (art * STREET_LIGHT.arterial + rl.light)) * em; s.lightGround = s.light;
  s.lightTemp = LIGHT_TEMP[LC.STREET]; s.lightOnset = LIGHT_ONSET[LC.STREET];
  return s;
}

// ---------------------------------------------------------------------------------------------
// block mini-rasters: the exact layout of a block sampled on a 2 m grid (+ mips 4, 8, 16 m), so
// texels of 2.5–30 m show real footprints, courtyards and lanes without aliasing
// ---------------------------------------------------------------------------------------------
const brCache = new Lru(1400, 'raster.brCache');
const S_E = newS(), QE = {};
const BR_CH = 8;   // r, g, b (sqrt-encoded), fabric, coverage, height (sqrt, /640 m), ground light (sqrt, /2), green
function enc(v) { return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(Math.sqrt(v) * 255); }
function blockRaster(G, D, L, i, j, em) {
  let r = brCache.get(L.key);
  if (r !== undefined) return r;
  r = null;
  const rc = L.rect;
  if (rc && L.poly && (L.bld.length || L.areas.length)) {
    const cs = 2, u0 = rc.u0, v0 = rc.v0;
    const nx = Math.max(1, Math.ceil((rc.u1 - rc.u0) / cs)), ny = Math.max(1, Math.ceil((rc.v1 - rc.v0) / cs));
    const d0 = new Uint8Array(nx * ny * BR_CH);
    for (let iy = 0; iy < ny; iy++) {
      const v = v0 + (iy + 0.5) * cs;
      for (let ix = 0; ix < nx; ix++) {
        const u = u0 + (ix + 0.5) * cs, o = (iy * nx + ix) * BR_CH;
        if (!pointInPoly(L.poly, u, v)) continue;
        fromPlane(D, u, v, QE);
        EXX = QE.x; EXY = QE.y; EXZ = QE.z; EXT = cs;
        zeroS(S_E); S_E.fabric = 1;
        const e = exactInBlock(S_E, G, D, L, u, v, i, j, em) || S_E;
        if (e.water > 0.5) continue;
        d0[o] = enc(e.fabricR); d0[o + 1] = enc(e.fabricG); d0[o + 2] = enc(e.fabricB);
        d0[o + 3] = Math.round(Math.min(1, e.fabric) * 255); d0[o + 4] = Math.round(e.coverage * 255);
        d0[o + 5] = enc(e.height / 640); d0[o + 6] = enc(e.lightGround / 2); d0[o + 7] = Math.round(Math.min(1, e.green) * 255);
      }
    }
    const mips = [{ cs, nx, ny, d: d0 }];
    while (mips.length < 4) {
      const m = mips[mips.length - 1];
      if (m.nx <= 1 && m.ny <= 1) break;
      const mx = Math.ceil(m.nx / 2), my = Math.ceil(m.ny / 2), d = new Uint8Array(mx * my * BR_CH);
      for (let y = 0; y < my; y++) for (let x = 0; x < mx; x++) {
        const acc = [0, 0, 0, 0, 0, 0, 0, 0]; let n = 0, fw = 0;
        for (let q = 0; q < 4; q++) {
          const sx = 2 * x + (q & 1), sy = 2 * y + (q >> 1);
          if (sx >= m.nx || sy >= m.ny) continue;
          const o = (sy * m.nx + sx) * BR_CH, f = m.d[o + 3] / 255;
          n++; fw += f;
          for (let c = 0; c < 3; c++) { const lin = (m.d[o + c] / 255) ** 2; acc[c] += lin * f; }
          acc[3] += f; acc[4] += m.d[o + 4] / 255; const hh = (m.d[o + 5] / 255) ** 2; acc[5] += hh * (m.d[o + 4] / 255);
          acc[6] += (m.d[o + 6] / 255) ** 2; acc[7] += m.d[o + 7] / 255;
        }
        const o = (y * mx + x) * BR_CH;
        if (n === 0) continue;
        for (let c = 0; c < 3; c++) d[o + c] = enc(fw > 0 ? acc[c] / fw : 0);
        d[o + 3] = Math.round(acc[3] / n * 255); d[o + 4] = Math.round(acc[4] / n * 255);
        d[o + 5] = enc(acc[4] > 0 ? acc[5] / acc[4] : 0); d[o + 6] = enc(acc[6] / n); d[o + 7] = Math.round(acc[7] / n * 255);
      }
      mips.push({ cs: m.cs * 2, nx: mx, ny: my, d });
    }
    r = { u0, v0, mips };
  }
  brCache.set(L.key, r);
  return r;
}
const BRS = { r: 0, g: 0, b: 0, fab: 0, cov: 0, h: 0, lg: 0, green: 0 };
/** bilinear sample of a block raster at (u,v) for footprint t → BRS (linear values) */
function sampleBR(br, u, v, t) {
  let m = 0;
  while (m < br.mips.length - 1 && br.mips[m].cs * 1.5 < t) m++;
  const M = br.mips[m];
  const fx = (u - br.u0) / M.cs - 0.5, fy = (v - br.v0) / M.cs - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  BRS.r = BRS.g = BRS.b = BRS.fab = BRS.cov = BRS.h = BRS.lg = BRS.green = 0;
  let wf = 0, wc = 0;
  for (let q = 0; q < 4; q++) {
    const x = ix + (q & 1), y = iy + (q >> 1);
    const w = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
    if (w <= 0 || x < 0 || y < 0 || x >= M.nx || y >= M.ny) continue;
    const o = (y * M.nx + x) * BR_CH, d = M.d;
    const f = d[o + 3] / 255, c = d[o + 4] / 255;
    BRS.r += w * f * (d[o] / 255) ** 2; BRS.g += w * f * (d[o + 1] / 255) ** 2; BRS.b += w * f * (d[o + 2] / 255) ** 2;
    BRS.fab += w * f; BRS.cov += w * c; BRS.h += w * c * (d[o + 5] / 255) ** 2 * 640; BRS.lg += w * (d[o + 6] / 255) ** 2 * 2; BRS.green += w * d[o + 7] / 255;
    wf += w * f; wc += w * c;
  }
  if (wf > 1e-6) { BRS.r /= wf; BRS.g /= wf; BRS.b /= wf; }
  if (wc > 1e-6) BRS.h /= wc;
  return BRS;
}

function blockStats(s, G, D, u, v, t, land, rl, art, artW, pier, x, y, z) {
  const C = CLASS[D.cls];
  if (D.cls === DC.PARK) return parkGround(s, D, land, rl, art, x, y, z, t);
  let fu = 0, fv = 0;
  if (C.grid) { fu = gridFracU(D, u, t); fv = gridFracV(D, v, t); }
  const i = blockIndexU(D, u), j = blockIndexV(D, v);
  blockInfo(G, i, j, BI);
  const inside = G.ihp.length ? sstep(-t * 0.5, t * 0.5, hpDistance(G.ihp, u, v)) : 0;
  // streets only exist where the block or a neighbour is active (no streets across water / wild)
  let streetOk = BI.active ? 1 : 0;
  if (!streetOk && C.grid) {
    blockRect(D, i, j, RB);
    const ni = u - RB.U0 < RB.U1 - u ? i - 1 : i + 1, nj = v - RB.V0 < RB.V1 - v ? j - 1 : j + 1;
    streetOk = blockInfo(G, ni, j, BI2).active || blockInfo(G, i, nj, BI2).active ? 0.7 : 0;
  }
  // O-zone farm grid roads end with the irrigated farmland (final-capture review, S03): a farm block lives when any
  // corner is irrigated, and its roads used to run on across the bare red earth beyond the last fields
  if (streetOk && D.zone === 'O' && D.cls === DC.FARM && farmIrrigated(G, u, v) <= 0) streetOk = 0;
  const street = (1 - (1 - fu) * (1 - fv)) * streetOk * inside;
  const blockF = (1 - fu) * (1 - fv) * inside * (BI.active ? Math.min(1, BI.fill * 1.15) : 0);
  const st = BU_STATS[BI.use];
  const lin = Math.min(1, art + rl.road);
  const keep = 1 - lin;
  let cov = 0, green = 0, farm = 0, fabric = 0, hgt = BI.active ? BI.h : 0, lgB = 0;
  const em0 = D.node ? nodeEnv(D.emission) : emissionEnv(D.emission);
  // fine texels: the block's own layout raster (footprints, courtyards, lanes)
  const wR = BI.active && BI.use !== BU.FARM ? 1 - sstep(16, 32, t) : 0;
  let br = null;
  if (wR > 0) { const L = blockLayout(G, i, j); br = blockRaster(G, D, L, i, j, em0); }
  if (BI.active) {
    const geomF = (1 - fu) * (1 - fv) * inside;
    if (br) {
      sampleBR(br, u, v, t);
      const fR = BRS.fab * geomF, fS = blockF;
      const wS = 1 - wR;
      const bf = fR * wR + fS * wS;
      cov = BRS.cov * geomF * wR + BI.cov * blockF * wS;
      green = BRS.green * geomF * wR + st.green * blockF * wS;
      fabric = bf;
      if (BRS.cov > 0.01) hgt = wR * BRS.h + wS * BI.h;
      lgB = BRS.lg * geomF * wR;
      const bc = blockColor(BI, D), tg = toneGrain(x, y, z, t);
      BC2[0] = BRS.r * fR * wR + bc[0] * tg * fS * wS; BC2[1] = BRS.g * fR * wR + bc[1] * tg * fS * wS; BC2[2] = BRS.b * fR * wR + bc[2] * tg * fS * wS;
      addColor(s, BC2, keep);
    } else {
      cov = BI.cov * blockF; green = st.green * blockF; fabric = blockF;
      if (BI.use === BU.FARM) {
        // the same irrigation reach as the field pieces (U7): the farmland edge follows the canals, not the blocks
        const irr = farmIrrigated(G, u, v), k = irr >= 1 ? 1 : irr > 0 ? 0.75 : 0;
        farm = blockF * 0.96 * k; green = 0; fabric = blockF * k;
      }
      addColor(s, blockColor(BI, D), blockF * keep * (BI.use === BU.FARM ? 1 : toneGrain(x, y, z, t)));
    }
  }
  fabric += street;
  cov *= keep; green *= keep; farm *= keep; fabric = fabric * keep + lin;
  const roadF = street * keep + lin;
  const sc = D.zone === 'O' && (D.cls === DC.FARM || D.cls === DC.GREENHOUSE || D.cls === DC.POLAR) ? C_FROAD : C_STREET;
  addColor(s, sc, street * keep);
  addColor(s, C_STREET, art);
  addColor(s, rl.rail ? C_RAIL : C_ROAD, rl.road);
  if (pier > 0) { fabric = Math.max(fabric, pier); addColor(s, C_DOCK, pier); }
  s.fabric = fabric; s.coverage = cov; s.green = green; s.farm = farm; s.road = roadF;
  s.height = hgt;
  s.roof = BI.roof; s.roofKind = BI.rk; s.landUse = BI.active ? BI.lu : LU.NONE;
  s.farmCrop = BI.farmCrop; s.farmStage = BI.farmStage;
  const landK = Math.max(land > 0.5 ? 1 : land * 2, pier);
  s.fabric *= landK; s.coverage *= landK; s.green *= landK; s.road *= landK; s.farm *= landK;
  s.fabricR *= landK; s.fabricG *= landK; s.fabricB *= landK;
  normColor(s);
  s.water = (1 - land) * (1 - pier);
  // light: windows of the block + street lights
  const em = D.node ? nodeEnv(D.emission) : emissionEnv(D.emission);
  const lc = BI.active ? BI.lc : LC.NONE;
  let Lb = BI.active ? BI.light * WINDOW_K * blockF * keep * (0.65 + 0.45 * D.inten) * (0.75 + 0.7 * D.T) : 0;
  if (BI.active && BI.lc === LC.RESIDENTIAL) Lb *= 0.75 + 0.5 * hb(G, i, j, 0x11);
  const sl = streetLightOf(D.cls);
  const Ls = (street * keep * sl + art * STREET_LIGHT.arterial + rl.light) * (D.cls === DC.FARM ? 0.1 : 1);
  const Lp = pier * 0.7;
  const L = (Lb + Ls + Lp) * em * landK + lgB * keep * landK;
  // lightPort (DN): lit piers / quay aprons / port-shed blocks, coverage-preserving up to the 60 m texels
  s.lightPort = Math.max(Math.min(1, pier * 2), BI.active && BI.use === BU.PORT_SHEDS ? 0.9 * Math.min(1, blockF * 1.6) : 0);
  s.light = Math.min(2, L);
  s.lightGround = Math.min(2, (Ls + Lp) * em * landK + (br ? lgB * keep : (BI.use === BU.PLAZA || BI.use === BU.STATION ? 0.5 * blockF * em : 0)) * landK);
  const tot = Lb + Ls + Lp;
  s.lightTemp = tot > 1e-6 ? (Lb * LIGHT_TEMP[lc] + Ls * LIGHT_TEMP[LC.STREET] + Lp * LIGHT_TEMP[LC.PORT]) / tot : LIGHT_TEMP[lc];
  const onsetB = BI.active && lc === LC.RESIDENTIAL ? 0.45 + 0.35 * hb(G, i, j, 0x12) : LIGHT_ONSET[lc];
  s.lightOnset = tot > 1e-6 ? (Lb * onsetB + Ls * LIGHT_ONSET[LC.STREET] + Lp * LIGHT_ONSET[LC.PORT]) / tot : onsetB;
  s.blockId = BI.active ? (hash4(G.key, i, j, 0xb1d) & 0xffffff) || 1 : 0;
  if (pier > 0.5 && land < 0.5) s.cls = SC.PIER;
  else if (land < 0.5) s.cls = SC.NATURAL;
  else if (rl.road > 0.5) s.cls = rl.rail ? SC.RAIL : SC.ROAD_ART;
  else if (art > 0.5) s.cls = SC.ROAD_ART;
  else if (street > 0.5) s.cls = D.zone === 'O' && D.cls === DC.FARM ? SC.FARM_ROAD : SC.ROAD_LOCAL;
  else s.cls = BI.active ? useClass(BI.use) : SC.NATURAL;
  s.elevated = rl.elevated;
  if (s.fabric < 0.5 && s.farm < 0.5) s.landUse = LU.NONE;
  return s;
}

function useClass(use) {
  switch (use) {
    case BU.PARK: case BU.GREENBELT: return SC.PARK;
    case BU.SPORTS: return SC.SPORTS;
    case BU.PLAZA: case BU.STATION: case BU.MARKET: case BU.CIVIC: case BU.FERRY: return SC.PLAZA;
    case BU.FARM: return SC.FARM;
    case BU.GREENHOUSES: return SC.GREENHOUSE;
    case BU.WAREHOUSE: case BU.LOGISTICS: case BU.UTILITY: case BU.POLAR_STATION: return SC.INDUSTRIAL;
    case BU.PORT_SHEDS: return SC.DOCK;
    case BU.PARKING: return SC.PARKING;
    case BU.SOLAR: return SC.SOLAR;
    default: return SC.ROOF;
  }
}

const BC = [0, 0, 0], BC2 = [0, 0, 0];
function blockColor(BI, D) {
  if (BI.use === BU.FARM) { const c = CROP_RGB[BI.farmCrop] || CROP_DEFAULT; return c[BI.farmStage] || c[0]; }
  return blockRGB(BI.use, 0.9 + 0.2 * D.tone, BC, D.roofStyle || 0);
}

// exact ------------------------------------------------------------------------------------------
function exactSample(s, G, D, u, v, t, land, rl, art, artW, pier, x, y, z) {
  EXX = x; EXY = y; EXZ = z; EXT = t;
  const C = CLASS[D.cls];
  const em = D.node ? nodeEnv(D.emission) : emissionEnv(D.emission);
  s.fabric = 1;
  if (land < 0.5) {
    if (pier > 0.5) { s.cls = SC.PIER; addColor(s, C_DOCK, 1); s.light = 0.6 * em; s.lightGround = s.light; s.lightTemp = LIGHT_TEMP[LC.PORT]; s.lightOnset = LIGHT_ONSET[LC.PORT]; s.landUse = LU.PORT; s.lightPort = 1; normColor(s); return s; }
    if (rl.road > 0.5 || art > 0.5) {
      s.cls = SC.BRIDGE; s.bridge = 1; s.road = 1; addColor(s, C_ROAD, 1); s.light = 0.5 * em; s.lightGround = s.light; s.lightTemp = LIGHT_TEMP[LC.STREET]; s.lightOnset = LIGHT_ONSET[LC.STREET]; s.landUse = LU.TRANSIT; normColor(s);
      return s;
    }
    zeroS(s); s.water = 1; s.dclass = D.cls; s.districtTone = D.tone; return s;
  }
  if (rl.road > 0.5) {
    s.road = 1; s.elevated = rl.elevated;
    if (rl.rail) { s.cls = SC.RAIL; addColor(s, C_RAIL, 1); s.light = 0.10 * em; }
    else { s.cls = D.polar && D.zone === 'O' ? SC.PIPE : SC.ROAD_ART; addColor(s, D.zone === 'O' ? C_FROAD : C_ROAD, 1); s.light = rl.light * em; }
    s.lightGround = s.light; s.lightTemp = LIGHT_TEMP[LC.STREET]; s.lightOnset = LIGHT_ONSET[LC.STREET]; s.landUse = LU.TRANSIT;
    normColor(s); return s;
  }
  if (art > 0.5) {
    // arterial cross-section: sidewalk | tree row | carriageway (| median tree row on boulevards)
    const half = artW / 2, e = ND.edge;
    const sw = Math.max(2.5, C.walk || 3), tr = artW >= 30 ? 3 : 0;
    s.road = 1;
    if (e > half - sw) { s.cls = SC.SIDEWALK; addColor(s, C_WALK, 1); }
    else if (e > half - sw - tr) { s.cls = SC.TREE_ROW; addColor(s, C_TREE, 1); s.green = 1; }
    else if (artW >= 44 && e < 2.5) { s.cls = SC.TREE_ROW; addColor(s, C_TREE, 1); s.green = 1; }
    else { s.cls = SC.ROAD_ART; addColor(s, C_ROAD, 1); }
    const pool = 0.6 + 0.4 * Math.cos(((u + v) / 32) * Math.PI * 2);
    s.light = (D.zone === 'Z' ? STREET_LIGHT.arterial : 0.2) * em * pool; s.lightGround = s.light; s.lightTemp = LIGHT_TEMP[LC.STREET]; s.lightOnset = LIGHT_ONSET[LC.STREET];
    s.landUse = LU.TRANSIT; normColor(s); return s;
  }
  if (!C.grid) {
    if (D.cls === DC.PARK) {
      const grove = grain(x, y, z, 70, 7) > 0.15;
      const wu = u + 38 * grain(x, y, z, 230, 8), wv = v + 38 * grain(x, y, z, 230, 9);
      const pu = Math.abs(((wu / 150) % 1 + 1) % 1 - 0.5) * 150, pv = Math.abs(((wv / 190) % 1 + 1) % 1 - 0.5) * 190;
      if (pu < 1.6 || pv < 1.6) { s.cls = SC.SIDEWALK; addColor(s, C_WALK, 1); s.light = 0.18 * em; s.lightGround = s.light; s.landUse = LU.PARK; s.lightTemp = LIGHT_TEMP[LC.STREET]; normColor(s); return s; }
      s.cls = SC.PARK; s.green = 1; addColor(s, grove ? C_TREE : C_PARK, 1); s.landUse = LU.PARK; s.light = 0.01 * em; s.lightGround = s.light; normColor(s); return s;
    }
    const i = blockIndexU(D, u), j = blockIndexV(D, v);
    const L = blockLayout(G, i, j);
    if (L.bld.length) { const r = exactInBlock(s, G, D, L, u, v, i, j, em); if (r) return r; }
    zeroS(s); s.dclass = D.cls; s.districtTone = D.tone; s.cls = SC.NATURAL; return s;
  }
  // street grid
  const i = blockIndexU(D, u), j = blockIndexV(D, v);
  blockRect(D, i, j, RB);
  const inDistrict = G.ihp.length ? hpDistance(G.ihp, u, v) : -1;
  if (inDistrict < 0) { zeroS(s); s.dclass = D.cls; s.districtTone = D.tone; s.cls = SC.NATURAL; return s; }
  const L = blockLayout(G, i, j);
  const inU = u >= RB.u0 && u <= RB.u1, inV = v >= RB.v0 && v <= RB.v1;
  if (!(inU && inV)) {
    // in a street band: does the street exist here?
    let ok = L.active;
    if (!ok) {
      const ni = u < RB.u0 ? i - 1 : u > RB.u1 ? i + 1 : i, nj = v < RB.v0 ? j - 1 : v > RB.v1 ? j + 1 : j;
      ok = (ni !== i && blockInfo(G, ni, j, BI).active) || (nj !== j && blockInfo(G, i, nj, BI).active) || (ni !== i && nj !== j && blockInfo(G, ni, nj, BI).active);
    }
    if (!ok) { zeroS(s); s.dclass = D.cls; s.districtTone = D.tone; s.cls = SC.NATURAL; return s; }
    let du = 1e9, w = 0, dv = 1e9, wv = 0;
    if (u < RB.u0) { w = lineWidthU(D, i); du = RB.u0 - u; } else if (u > RB.u1) { w = lineWidthU(D, i + 1); du = u - RB.u1; }
    if (v < RB.v0) { wv = lineWidthV(D, j); dv = RB.v0 - v; } else if (v > RB.v1) { wv = lineWidthV(D, j + 1); dv = v - RB.v1; }
    const sw = D.walk, tr = D.trees > 0 && Math.max(w, wv) >= 16 ? 2.2 : 0;
    const onWalk = (du < sw && dv === 1e9) || (dv < sw && du === 1e9) || (du < sw && dv < sw);
    const onTree = !onWalk && tr > 0 && ((du < sw + tr && dv === 1e9) || (dv < sw + tr && du === 1e9));
    const farm = D.zone === 'O' && D.cls !== DC.OTOWN;
    const railLine = D.railKey && ((v < RB.v0 && j === D.railJ) || (v > RB.v1 && j + 1 === D.railJ));
    // farm grid roads end with the irrigated farmland (same reach as the field pieces; see the coarse path)
    if (farm && D.cls === DC.FARM && !railLine && farmIrrigated(G, u, v) <= 0) { zeroS(s); s.dclass = D.cls; s.districtTone = D.tone; s.cls = SC.NATURAL; return s; }
    s.road = 1;
    const coll = (u < RB.u0 && isCollU(D, i)) || (u > RB.u1 && isCollU(D, i + 1)) || (v < RB.v0 && isCollV(D, j)) || (v > RB.v1 && isCollV(D, j + 1));
    if (railLine && !D.railElev && Math.abs(dv - wv / 2) < RAIL.corridor / 2) { s.cls = SC.RAIL; addColor(s, C_RAIL, 1); }
    else if (onWalk && sw > 0) { s.cls = SC.SIDEWALK; addColor(s, C_WALK, 1); }
    else if (onTree) { s.cls = SC.TREE_ROW; addColor(s, C_TREE, 1); s.green = 1; }
    else if (farm) { s.cls = SC.FARM_ROAD; addColor(s, C_FROAD, 1); }
    else { s.cls = coll ? SC.ROAD_ART : SC.ROAD_LOCAL; addColor(s, C_ROAD, 1); }
    s.elevated = railLine && D.railElev ? 1 : 0;
    const ll = farm ? 0.03 : coll ? STREET_LIGHT.collector : streetLightOf(D.cls);
    const along = dv === 1e9 ? v : u;
    const pool = 0.55 + 0.45 * Math.cos((along / 30) * Math.PI * 2);
    s.light = ll * em * pool * (s.cls === SC.SIDEWALK ? 0.8 : 1); s.lightGround = s.light; s.lightTemp = LIGHT_TEMP[LC.STREET]; s.lightOnset = LIGHT_ONSET[LC.STREET];
    s.landUse = LU.TRANSIT; normColor(s); return s;
  }
  if (!L.active && !L.bld.length) {
    zeroS(s); s.dclass = D.cls; s.districtTone = D.tone; s.cls = SC.NATURAL;
    return s;
  }
  const r = exactInBlock(s, G, D, L, u, v, i, j, em);
  if (r) return r;
  zeroS(s); s.dclass = D.cls; s.districtTone = D.tone; s.cls = SC.NATURAL;
  return s;
}

const RC = [0, 0, 0];
const WORKS = new Set(['sluice_station', 'pumphouse', 'meltwater_pump', 'insulated_station']);
let EXX = 0, EXY = 0, EXZ = 0, EXT = 1;
function exactInBlock(s, G, D, L, u, v, i, j, em) {
  s.blockId = (hash4(G.key, i, j, 0xb1d) & 0xffffff) || 1;
  const b = buildingAt(L, u, v);
  if (b) {
    s.cls = SC.ROOF; s.coverage = 1; s.roofKind = b.roofKind;
    const hv = (hash4(G.key, i, j, 0x9a00 + b.idx) & 0xffffff);
    s.roof = b.roof * (0.92 + 0.16 * ((hv & 255) / 255));
    s.height = partHeight(b, u, v);
    s.landUse = useLandUse(b.use, b.tier);
    s.parcelId = hv || 1;
    const rc = ROOF_RGB[b.roofKind] || ROOF_RGB[0];
    const tm = (0.92 + 0.16 * D.tone) * (0.94 + 0.12 * ((hv >>> 8) & 255) / 255) * toneGrain(EXX, EXY, EXZ, EXT);
    RC[0] = rc[0] * tm; RC[1] = rc[1] * tm; RC[2] = rc[2] * tm;
    addColor(s, RC, 1);
    if (b.roofKind === RK.GARDEN || b.roofKind === RK.TERRACE) s.green = 0.6;
    const lc = b.lc || LC.RESIDENTIAL;
    // from above at night a roof is mostly dark: skylights, roof gardens, beacons; window light belongs
    // to the facades (3D buildings), street-level spill to the ground texels
    const bl = (BU_STATS[L.use] ? BU_STATS[L.use].light : 0.3);
    s.light = bl * em * 0.25; s.lightGround = 0;
    s.lightTemp = LIGHT_TEMP[lc];
    // O-zone water works / shift stations stay lit all night (A02: 闸室、换班站 white points in dark farmland)
    if (b.site && D.zone === 'O' && WORKS.has(b.use)) { s.light = 0.75 * Math.max(0.6, em); s.lightGround = 0.3; s.lightTemp = LIGHT_TEMP[LC.UTILITY]; }
    s.lightOnset = lc === LC.RESIDENTIAL ? 0.45 + 0.35 * ((hash4(G.key, i, j, 0x11 + b.idx) & 1023) / 1023) : LIGHT_ONSET[lc];
    normColor(s);
    return s;
  }
  if (L.canalSegs && L.canalSegs.length) {
    const cb = canalBandAt(L, u, v);
    if (cb === 3) { zeroS(s); s.water = 1; s.dclass = D.cls; s.districtTone = D.tone; return s; }
    if (cb === 1) { s.cls = SC.CANAL_BANK; addColor(s, C_BANK, 1); s.green = 0.6; s.landUse = LU.FARM; normColor(s); return s; }
    if (cb === 2) { s.cls = SC.FARM_ROAD; s.road = 1; addColor(s, C_FROAD, 1); s.light = 0.02 * em; s.lightGround = s.light; s.landUse = LU.TRANSIT; normColor(s); return s; }
  }
  const ln = L.lanes.length ? laneAt(L, u, v) : null;
  if (ln) {
    s.cls = SC.LANE; s.road = 1; addColor(s, C_LANE, 1); s.light = STREET_LIGHT.lane * em; s.lightGround = s.light; s.lightTemp = LIGHT_TEMP[LC.STREET]; s.lightOnset = 0.3;
    s.landUse = LU.TRANSIT; normColor(s); return s;
  }
  const a = areaAt(L, u, v);
  if (a) return areaSample(s, a, L, D, em, EXX, EXY, EXZ, EXT);
  s.cls = L.defaultCls;
  const col = L.defaultCls === SC.PLAZA ? C_PLAZA : L.defaultCls === SC.INDUSTRIAL ? C_IND : L.defaultCls === SC.PARK ? C_PARK : L.defaultCls === SC.FARM ? C_FROAD : L.defaultCls === SC.PARKING ? C_PARKING : C_YARD;
  if (L.defaultCls === SC.NATURAL) { zeroS(s); s.cls = SC.NATURAL; s.dclass = D.cls; s.districtTone = D.tone; return s; }
  addColor(s, col, 1);
  if (L.defaultCls === SC.PARK || L.defaultCls === SC.YARD) s.green = L.defaultCls === SC.PARK ? 1 : 0.5;
  s.landUse = BU_STATS[L.use] ? BU_STATS[L.use].lu : LU.NONE;
  s.light = (L.defaultCls === SC.PLAZA ? 0.45 : 0.04 + 0.2 * (BU_STATS[L.use] ? BU_STATS[L.use].light : 0)) * em; s.lightGround = s.light;
  normColor(s);
  return s;
}

const AC = [0, 0, 0];
function areaSample(s, a, L, D, em, x, y, z, t) {
  let c = C_YARD, cls = SC.YARD, light = 0.04, lt = LC.RESIDENTIAL, green = 0.5;
  const tex = (wl, ch) => { const k = bandK(wl, t); return k > 0 ? k * grain(x, y, z, wl, ch) : 0; };
  switch (a.kind) {
    case 'park': case 'green': {
      // tree groves and lawns, paths
      const g = sstep(-0.15, 0.25, tex(55, 11) + 0.6 * tex(16, 12));
      c = mixc(C_PARK, C_TREE, g); AC[0] = c[0]; AC[1] = c[1]; AC[2] = c[2]; c = AC;
      cls = SC.PARK; green = 1; light = 0.03; lt = LC.STREET; break;
    }
    case 'garden': { const g = sstep(-0.3, 0.3, tex(9, 13)); c = mixc(C_GARDEN, C_TREE, g * 0.7); cls = SC.YARD; green = 0.8; light = 0.05; break; }
    case 'courtyard': {
      // paved courts with tree clumps, lawn patches and play areas; denser districts pave more
      const g = tex(14, 14), p = tex(6, 15), dense = D.cls === DC.CORE ? 0.35 : D.cls === DC.MID ? 0.15 : 0;
      c = g > 0.42 + dense ? C_TREE : g > 0.02 + dense ? C_COURT : (p > -0.1 ? C_PAVE_LIGHT : C_YARD);
      cls = SC.YARD; green = g > 0.02 + dense ? 0.7 : 0.1; light = 0.06; break;
    }
    case 'yard': { const g = tex(10, 16); c = g > 0.3 ? C_GARDEN : C_YARD; cls = SC.YARD; green = 0.4; light = 0.05; break; }
    case 'lane': c = C_LANE; cls = SC.LANE; green = 0; light = STREET_LIGHT.lane; lt = LC.STREET; break;
    case 'plaza': c = C_PLAZA; cls = SC.PLAZA; green = 0.08; light = 0.5; lt = LC.COMMERCIAL; break;
    case 'station_plaza': c = C_PLAZA; cls = SC.PLAZA; green = 0.05; light = 0.95; lt = LC.TRANSIT; break;
    case 'schoolyard': c = C_SCHOOLYARD; cls = SC.YARD; green = 0.2; light = 0.08; lt = LC.CIVIC; break;
    case 'pitch': c = C_PITCH; cls = SC.SPORTS; green = 0.9; light = 0.1; lt = LC.CIVIC; break;
    case 'parking': c = C_PARKING; cls = SC.PARKING; green = 0; light = 0.3; lt = LC.STREET; break;
    case 'yard_industrial': case 'yard_service': c = C_IND; cls = SC.INDUSTRIAL; green = 0.02; light = 0.3; lt = LC.INDUSTRIAL; break;
    case 'container_yard': c = C_CONT; cls = SC.INDUSTRIAL; green = 0; light = 0.75; lt = LC.PORT; break;
    case 'dock': c = C_DOCK; cls = SC.DOCK; green = 0; light = 0.85; lt = LC.PORT; break;
    case 'solar': c = C_SOLAR; cls = SC.SOLAR; green = 0; light = 0; break;
    case 'basins': c = C_BASIN; cls = SC.INDUSTRIAL; green = 0; light = 0.15; lt = LC.UTILITY; break;
    case 'field': {
      const cc = CROP_RGB[a.crop] || CROP_DEFAULT; c = cc[a.stage] || cc[0]; cls = SC.FARM; green = a.crop === FarmCrop.FALLOW ? 0 : 0.9; light = 0;
      s.farmCrop = a.crop; s.farmStage = a.stage; s.farm = 1; break;
    }
    default: break;
  }
  s.cls = cls; addColor(s, c, 1); s.green = green;
  s.light = light * em; s.lightGround = s.light; s.lightTemp = LIGHT_TEMP[lt]; s.lightOnset = LIGHT_ONSET[lt];
  if (a.kind === 'dock') s.lightPort = 1; else if (a.kind === 'container_yard') s.lightPort = 0.8;
  s.landUse = cls === SC.DOCK ? LU.PORT : cls === SC.FARM ? LU.FARM : (BU_STATS[L.use] ? BU_STATS[L.use].lu : LU.NONE);
  normColor(s);
  return s;
}

function useLandUse(use, tier) {
  switch (use) {
    case 'residential': return tier === 'lowrise' ? LU.RES_LOW : LU.RES_MID;
    case 'residential_tower': return LU.RES_HIGH;
    case 'shop_row': case 'market': case 'office': case 'research': return LU.COMMERCIAL;
    case 'clinic': case 'school': case 'community': case 'civic_tower': return LU.CIVIC;
    case 'station': case 'ferry_terminal': return LU.TRANSIT;
    case 'warehouse': case 'cold_storage': case 'farm_station': case 'service_depot': return LU.INDUSTRIAL;
    case 'port_shed': return LU.PORT;
    case 'greenhouse': return LU.GREENHOUSE;
    case 'dorm': return LU.RES_LOW;
    default: return LU.UTILITY;
  }
}

function copyOut(s, o) {
  o.cls = s.cls; o.coverage = s.coverage; o.roofKind = s.roofKind; o.roof = s.roof; o.height = s.height; o.landUse = s.landUse;
  o.light = s.light; o.lightGround = s.lightGround; o.lightTemp = s.lightTemp; o.lightOnset = s.lightOnset; o.districtTone = s.districtTone;
  o.farmCrop = s.farmCrop; o.farmStage = s.farmStage; o.blockId = s.blockId; o.parcelId = s.parcelId; o.fabric = s.fabric; o.green = s.green;
  o.road = s.road; o.farm = s.farm; o.water = s.water; o.fabricR = s.fabricR; o.fabricG = s.fabricG; o.fabricB = s.fabricB;
  o.dclass = s.dclass; o.elevated = s.elevated; o.bridge = s.bridge; o.covered = s.covered; o.lightPort = s.lightPort;
}

// ---------------------------------------------------------------------------------------------
// public entry
// ---------------------------------------------------------------------------------------------
const FX = {};
export function urbanSample(x, y, z, texelMeters, out = {}, fields = null) {
  const t = texelMeters > 0.05 ? texelMeters : 0.05;
  const r = Math.sqrt(x * x + y * y + z * z) || 1;
  if (Math.abs(r - 1) > 1e-9) { x /= r; y /= r; z /= r; }
  const lat = Math.asin(y < -1 ? -1 : y > 1 ? 1 : y) * 57.29577951308232, lon = Math.atan2(x, z) * 57.29577951308232;
  const w0 = sstep(1000, 2600, t);          // L0 vs L1
  const w1 = sstep(60, 140, t);             // L1 vs L2
  const w2 = sstep(2.5, 6, t);              // L2 vs L3
  let res;
  if (w1 > 0) {
    // the field expectation / district levels need the smooth fields of this footprint
    if (fields && fields.urban !== undefined) fieldsFrom(fields, FX); else fieldsAt(x, y, z, Math.max(160, t * 3), FX);
  }
  if (w0 >= 1) res = level0(x, y, z, t, FX, S_A);
  else if (w1 >= 1) {
    res = level1(x, y, z, t, FX, S_B);
    if (w0 > 0) { level0(x, y, z, t, FX, S_A); res = mixInto(S_A, S_B, 1 - w0); }
  } else if (w2 >= 1) {
    res = level23(x, y, z, t, false, S_C);
    if (w1 > 0) { level1(x, y, z, t, FX, S_B); res = mixInto(S_B, S_C, 1 - w1); }
  } else {
    res = level23(x, y, z, t, true, S_D);
    if (w2 > 0) { level23(x, y, z, t, false, S_C); res = mixInto(S_C, S_D, 1 - w2); }
  }
  copyOut(res, out);
  out.zone = isOxygenZone(lat, lon) ? 'O' : 'Z';
  out.province = provinceAt(lat, lon);
  return out;
}

export { ROOF_RGB, CROP_RGB };
