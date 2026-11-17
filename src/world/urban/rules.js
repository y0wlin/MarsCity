// Urban plan constants, enums and per-province rule tables (pure data, worker-safe).
// OWNER: urban-fn agent. Values here ARE the world definition: changing them changes every
// district, block, building and ID, so bump URBAN_VERSION when you do.

export const URBAN_VERSION = 'urban-2.3.0';

// ---------------------------------------------------------------------------------------------
// Public enums (re-exported by world/urban.js). The first entries are the contract values from
// ARCHITECTURE.md / the original stub and keep their numbers; new entries are appended.
// ---------------------------------------------------------------------------------------------
export const SurfaceClass = {
  NATURAL: 0, ROAD_ART: 1, ROAD_LOCAL: 2, RAIL: 3, SIDEWALK: 4, ROOF: 5, YARD: 6, PARK: 7, PLAZA: 8,
  FARM: 9, GREENHOUSE: 10, DOCK: 11, PIER: 12, INDUSTRIAL: 13, CANAL_BANK: 14, SOLAR: 15, PARKING: 16, BARRIER: 17,
  LANE: 18,        // 巷道 / alley 4–7 m
  FARM_ROAD: 19,   // gravel farm road / levee road
  BRIDGE: 20,      // road or rail deck over water
  PIPE: 21,        // insulated pipe gallery (OX4/OX6)
  TREE_ROW: 22,    // street tree row / canal-bank tree belt
  SPORTS: 23,      // sports field / schoolyard pitch
};

export const LandUse = {
  NONE: 0, RES_LOW: 1, RES_MID: 2, RES_HIGH: 3, COMMERCIAL: 4, CIVIC: 5, INDUSTRIAL: 6, PORT: 7, TRANSIT: 8,
  PARK: 9, FARM: 10, UTILITY: 11, GREENHOUSE: 12,
};

// Roof kinds: 0 white ceramic shells, 1 metal / silver, 2 membrane, 3 solar, 4 roof garden, 5 glass
// (greenhouse / atrium), 6 warm ceramic, 7 dark / patinated, 8 planted terrace, 9 insulated shell.
export const RoofKind = {
  CERAMIC: 0, METAL: 1, MEMBRANE: 2, SOLAR: 3, GARDEN: 4, GLASS: 5, WARM: 6, DARK: 7, TERRACE: 8, INSULATED: 9,
};
export const RoofKindNames = ['ceramic', 'metal', 'membrane', 'solar', 'garden', 'glass', 'warm', 'dark', 'terrace', 'insulated'];

// Crop types (stage separate: farmStage). Values double as palette indices.
export const FarmCrop = { NONE: 0, FODDER: 1, PADDY: 2, GRAIN: 3, FALLOW: 4, ALGAE: 5, VEGETABLE: 7, ORCHARD: 8 };
export const FarmStage = { GROWN: 0, HARVESTED: 1, FLOODING: 2, YOUNG: 3 };

export const USES = {
  Z: ['residential', 'residential_tower', 'shop_row', 'clinic', 'school', 'market', 'station', 'ferry_terminal', 'research', 'office', 'civic_tower', 'warehouse', 'port_shed', 'community'],
  O: ['pumphouse', 'sluice_station', 'greenhouse', 'dorm', 'control_tower', 'maintenance', 'cold_storage', 'farm_station', 'water_treatment', 'service_depot', 'insulated_station', 'meltwater_pump'],
};

// ---------------------------------------------------------------------------------------------
// Night light classes. lightTemp 0 warm … 1 cold; lightOnset 0 early … 1 late at dusk
// (stations / canopies first, then shops and civic cores, residential windows last).
// ---------------------------------------------------------------------------------------------
export const LightClass = {
  NONE: 0, RESIDENTIAL: 1, COMMERCIAL: 2, CIVIC: 3, TRANSIT: 4, PORT: 5, INDUSTRIAL: 6, STREET: 7, UTILITY: 8, RURAL: 9,
};
export const LIGHT_TEMP = [0.3, 0.08, 0.40, 0.48, 0.66, 0.97, 0.80, 0.30, 0.88, 0.14];
export const LIGHT_ONSET = [1, 0.70, 0.30, 0.18, 0.02, 0.06, 0.12, 0.22, 0.08, 0.55];

// ---------------------------------------------------------------------------------------------
// District classes and their planning parameters.
//   module [bw, bd]: block module (street centre to street centre) along u and v (m)
//   street / coll: local street / collector width incl. sidewalks; collEvery: every n-th line
//   lane: mid-block lane (巷道) width, 0 = none; walk: sidewalk width; trees: street tree rows
//   jit: grid line jitter (fraction of the module); art: own arterial width at the district edge
// ---------------------------------------------------------------------------------------------
export const DC = {
  WILD: 0, RURAL: 1, LOW: 2, MID: 3, CORE: 4, INDUSTRIAL: 5, PORT: 6, CAMPUS: 7, PARK: 8, LOGISTICS: 9,
  FARM: 10, GREENHOUSE: 11, OTOWN: 12, POLAR: 13, OUTPOST: 14,
};
export const DC_NAMES = ['wild', 'rural', 'low', 'mid', 'core', 'industrial', 'port', 'campus', 'park', 'logistics',
  'farm', 'greenhouse', 'otown', 'polar', 'outpost'];
export const NCLASS = 15;

export const CLASS = [
  /* WILD       */ { grid: false, module: [400, 400], street: 0, coll: 0, collEvery: 0, lane: 0, walk: 0, trees: 0, jit: 0, art: 0 },
  /* RURAL      */ { grid: true, module: [110, 210], street: 9, coll: 13, collEvery: 5, lane: 0, walk: 1.5, trees: 0, jit: 0.16, art: 16 },
  /* LOW        */ { grid: true, module: [64, 124], street: 13, coll: 20, collEvery: 4, lane: 5, walk: 2.5, trees: 1, jit: 0.12, art: 30 },
  /* MID        */ { grid: true, module: [92, 140], street: 17, coll: 25, collEvery: 4, lane: 0, walk: 3.5, trees: 1, jit: 0.10, art: 40 },
  /* CORE       */ { grid: true, module: [72, 92], street: 19, coll: 28, collEvery: 3, lane: 0, walk: 5, trees: 2, jit: 0.07, art: 48 },
  /* INDUSTRIAL */ { grid: true, module: [150, 300], street: 20, coll: 26, collEvery: 3, lane: 0, walk: 2, trees: 0, jit: 0.10, art: 34 },
  /* PORT       */ { grid: true, module: [150, 280], street: 22, coll: 28, collEvery: 3, lane: 0, walk: 2, trees: 0, jit: 0.06, art: 36 },
  /* CAMPUS     */ { grid: true, module: [130, 180], street: 16, coll: 22, collEvery: 3, lane: 0, walk: 3.5, trees: 2, jit: 0.10, art: 32 },
  /* PARK       */ { grid: false, module: [240, 240], street: 0, coll: 0, collEvery: 0, lane: 0, walk: 0, trees: 0, jit: 0, art: 30 },
  /* LOGISTICS  */ { grid: true, module: [140, 230], street: 18, coll: 24, collEvery: 3, lane: 0, walk: 2, trees: 0, jit: 0.08, art: 30 },
  /* FARM       */ { grid: true, module: [420, 260], street: 7, coll: 9, collEvery: 4, lane: 0, walk: 0, trees: 0, jit: 0.20, art: 12 },
  /* GREENHOUSE */ { grid: true, module: [136, 100], street: 8, coll: 10, collEvery: 4, lane: 0, walk: 0.5, trees: 0, jit: 0.06, art: 14 },
  /* OTOWN      */ { grid: true, module: [62, 104], street: 11, coll: 15, collEvery: 4, lane: 4.5, walk: 2, trees: 1, jit: 0.12, art: 18 },
  /* POLAR      */ { grid: true, module: [150, 150], street: 9, coll: 12, collEvery: 3, lane: 0, walk: 0, trees: 0, jit: 0.08, art: 12 },
  /* OUTPOST    */ { grid: false, module: [300, 300], street: 0, coll: 0, collEvery: 0, lane: 0, walk: 0, trees: 0, jit: 0, art: 0 },
];

/** Arterial (district boundary road) width between classes a and b (0 = none). */
export function arterialWidth(ca, cb) {
  const A = CLASS[ca].art, B = CLASS[cb].art;
  if (A === 0 && B === 0) return 0;
  if (ca === DC.CORE && cb === DC.CORE) return 50;               // boulevard with tree rows
  if ((ca === DC.CORE && cb === DC.MID) || (ca === DC.MID && cb === DC.CORE)) return 44;
  if (A === 0 || B === 0) return Math.max(A, B) > 20 ? 16 : 0;   // town edge road
  if (ca === DC.FARM && cb === DC.FARM) return 10;               // farm main road
  return Math.max(A, B);
}

// Land use that dominates each district class (coarse samples)
export const CLASS_LANDUSE = [
  LandUse.NONE, LandUse.RES_LOW, LandUse.RES_LOW, LandUse.RES_MID, LandUse.RES_HIGH, LandUse.INDUSTRIAL, LandUse.PORT,
  LandUse.CIVIC, LandUse.PARK, LandUse.INDUSTRIAL, LandUse.FARM, LandUse.GREENHOUSE, LandUse.RES_LOW, LandUse.UTILITY, LandUse.UTILITY,
];

// ---------------------------------------------------------------------------------------------
// Block uses (internal). Every block of a gridded district gets one; layouts follow it.
// ---------------------------------------------------------------------------------------------
export const BU = {
  NONE: 0, ROW: 1, DETACHED: 2, PERIMETER: 3, SLAB: 4, TOWER_PARK: 5, TOWER_PODIUM: 6, OFFICE: 7, SHOPS: 8, MARKET: 9,
  SCHOOL: 10, CLINIC: 11, COMMUNITY: 12, CIVIC: 13, STATION: 14, PLAZA: 15, PARK: 16, SPORTS: 17, WAREHOUSE: 18,
  PORT_SHEDS: 19, RESEARCH: 20, LOGISTICS: 21, FARM: 22, GREENHOUSES: 23, DORMS: 24, UTILITY: 25, POLAR_STATION: 26,
  PARKING: 27, SOLAR: 28, GREENBELT: 29, TERRACE: 30, FERRY: 31, VILLAGE: 32, MIXED: 33, COURT: 34,
};
export const NBU = 35;
export const BU_NAMES = Object.keys(BU).reduce((a, k) => { a[BU[k]] = k.toLowerCase(); return a; }, []);

// Block use mix per district class: [use, weight] (services, stations, quays … are placed by rules
// first; this mix fills the rest). The statistical samples use the same table, so the area
// averages seen from orbit equal the block layouts seen from the street.
export const CLASS_MIX = [];
CLASS_MIX[DC.WILD] = [];
CLASS_MIX[DC.RURAL] = [[BU.VILLAGE, 1]];
CLASS_MIX[DC.LOW] = [[BU.ROW, 0.46], [BU.DETACHED, 0.18], [BU.COURT, 0.10], [BU.MIXED, 0.08], [BU.SHOPS, 0.05], [BU.SLAB, 0.05], [BU.PARK, 0.05], [BU.SPORTS, 0.03]];
CLASS_MIX[DC.MID] = [[BU.PERIMETER, 0.34], [BU.MIXED, 0.16], [BU.SLAB, 0.12], [BU.COURT, 0.08], [BU.TOWER_PARK, 0.10], [BU.SHOPS, 0.06], [BU.OFFICE, 0.04], [BU.ROW, 0.04], [BU.PARK, 0.04], [BU.SPORTS, 0.02]];
CLASS_MIX[DC.CORE] = [[BU.TOWER_PODIUM, 0.40], [BU.OFFICE, 0.18], [BU.MIXED, 0.12], [BU.PERIMETER, 0.10], [BU.TOWER_PARK, 0.08], [BU.SHOPS, 0.06], [BU.PLAZA, 0.06]];
CLASS_MIX[DC.INDUSTRIAL] = [[BU.WAREHOUSE, 0.48], [BU.RESEARCH, 0.14], [BU.LOGISTICS, 0.12], [BU.SOLAR, 0.08], [BU.PARKING, 0.06], [BU.OFFICE, 0.07], [BU.UTILITY, 0.05]];
CLASS_MIX[DC.PORT] = [[BU.WAREHOUSE, 0.40], [BU.LOGISTICS, 0.16], [BU.OFFICE, 0.12], [BU.PERIMETER, 0.14], [BU.PARKING, 0.08], [BU.SHOPS, 0.10]];
CLASS_MIX[DC.CAMPUS] = [[BU.RESEARCH, 0.36], [BU.SCHOOL, 0.14], [BU.CLINIC, 0.08], [BU.PARK, 0.18], [BU.SPORTS, 0.10], [BU.COMMUNITY, 0.06], [BU.SLAB, 0.08]];
CLASS_MIX[DC.PARK] = [];
CLASS_MIX[DC.LOGISTICS] = [[BU.LOGISTICS, 0.42], [BU.WAREHOUSE, 0.26], [BU.DORMS, 0.18], [BU.PARKING, 0.08], [BU.UTILITY, 0.06]];
CLASS_MIX[DC.FARM] = [[BU.FARM, 1]];
CLASS_MIX[DC.GREENHOUSE] = [[BU.GREENHOUSES, 0.78], [BU.UTILITY, 0.08], [BU.DORMS, 0.08], [BU.PARKING, 0.06]];
CLASS_MIX[DC.OTOWN] = [[BU.DORMS, 0.52], [BU.ROW, 0.16], [BU.GREENHOUSES, 0.14], [BU.SHOPS, 0.08], [BU.PARK, 0.05], [BU.UTILITY, 0.05]];
CLASS_MIX[DC.POLAR] = [[BU.GREENHOUSES, 0.5], [BU.UTILITY, 0.3], [BU.NONE, 0.2]];
CLASS_MIX[DC.OUTPOST] = [];

// Statistical block properties (what a block of this use looks like on average, calibrated against
// the layout generator with scripts/check-urban.mjs calib):
//   cov roof fraction (fix round 2, U10: re-calibrated against the generated layouts — actual roof area / block
//   area over ~730 blocks in 10 districts — so district / block texels match the exact footprints' brightness),
//   h mean roof height (m), rk dominant RoofKind, roof tone, lu LandUse,
//   green fraction, paved fraction (plazas / yards / parking / quays), light (night radiance per
//   unit block area, 0..1), lc LightClass
export const BU_STATS = [];
function bs(u, cov, h, rk, roof, lu, green, paved, light, lc) { BU_STATS[u] = { cov, h, rk, roof, lu, green, paved, light, lc }; }
bs(BU.NONE, 0, 0, RoofKind.CERAMIC, 0, LandUse.NONE, 0, 0, 0, LightClass.NONE);
bs(BU.ROW, 0.28, 8.5, RoofKind.CERAMIC, 0.80, LandUse.RES_LOW, 0.26, 0.10, 0.30, LightClass.RESIDENTIAL);
bs(BU.DETACHED, 0.32, 7.0, RoofKind.CERAMIC, 0.78, LandUse.RES_LOW, 0.46, 0.08, 0.20, LightClass.RESIDENTIAL);
bs(BU.COURT, 0.34, 12, RoofKind.CERAMIC, 0.82, LandUse.RES_LOW, 0.30, 0.10, 0.32, LightClass.RESIDENTIAL);
bs(BU.PERIMETER, 0.45, 26, RoofKind.CERAMIC, 0.84, LandUse.RES_MID, 0.24, 0.10, 0.46, LightClass.RESIDENTIAL);
bs(BU.MIXED, 0.52, 22, RoofKind.CERAMIC, 0.82, LandUse.COMMERCIAL, 0.16, 0.16, 0.58, LightClass.COMMERCIAL);
bs(BU.SLAB, 0.27, 30, RoofKind.CERAMIC, 0.84, LandUse.RES_MID, 0.44, 0.12, 0.40, LightClass.RESIDENTIAL);
bs(BU.TOWER_PARK, 0.14, 80, RoofKind.CERAMIC, 0.86, LandUse.RES_HIGH, 0.52, 0.14, 0.50, LightClass.RESIDENTIAL);
bs(BU.TOWER_PODIUM, 0.62, 95, RoofKind.CERAMIC, 0.86, LandUse.COMMERCIAL, 0.08, 0.26, 0.95, LightClass.COMMERCIAL);
bs(BU.OFFICE, 0.17, 42, RoofKind.SOLAR, 0.74, LandUse.COMMERCIAL, 0.14, 0.30, 0.72, LightClass.COMMERCIAL);
bs(BU.SHOPS, 0.5, 14, RoofKind.CERAMIC, 0.84, LandUse.COMMERCIAL, 0.08, 0.26, 0.78, LightClass.COMMERCIAL);
bs(BU.MARKET, 0.5, 9, RoofKind.MEMBRANE, 0.92, LandUse.COMMERCIAL, 0.08, 0.46, 0.85, LightClass.COMMERCIAL);
bs(BU.SCHOOL, 0.26, 13, RoofKind.GARDEN, 0.80, LandUse.CIVIC, 0.34, 0.40, 0.22, LightClass.CIVIC);
bs(BU.CLINIC, 0.13, 20, RoofKind.CERAMIC, 0.92, LandUse.CIVIC, 0.36, 0.26, 0.55, LightClass.CIVIC);
bs(BU.COMMUNITY, 0.08, 8, RoofKind.GARDEN, 0.82, LandUse.CIVIC, 0.50, 0.24, 0.40, LightClass.CIVIC);
bs(BU.CIVIC, 0.26, 280, RoofKind.GLASS, 0.88, LandUse.CIVIC, 0.24, 0.48, 1.00, LightClass.CIVIC);
bs(BU.STATION, 0.36, 16, RoofKind.MEMBRANE, 0.95, LandUse.TRANSIT, 0.06, 0.54, 1.10, LightClass.TRANSIT);
bs(BU.PLAZA, 0.04, 5, RoofKind.MEMBRANE, 0.94, LandUse.CIVIC, 0.22, 0.72, 0.70, LightClass.CIVIC);
bs(BU.PARK, 0.005, 4, RoofKind.GARDEN, 0.70, LandUse.PARK, 0.90, 0.08, 0.05, LightClass.STREET);
bs(BU.SPORTS, 0.04, 6, RoofKind.MEMBRANE, 0.90, LandUse.PARK, 0.66, 0.24, 0.20, LightClass.CIVIC);
bs(BU.WAREHOUSE, 0.47, 10, RoofKind.METAL, 0.70, LandUse.INDUSTRIAL, 0.04, 0.42, 0.34, LightClass.INDUSTRIAL);
bs(BU.PORT_SHEDS, 0.42, 12, RoofKind.METAL, 0.66, LandUse.PORT, 0.02, 0.54, 0.80, LightClass.PORT);
bs(BU.RESEARCH, 0.08, 20, RoofKind.SOLAR, 0.80, LandUse.COMMERCIAL, 0.40, 0.24, 0.48, LightClass.COMMERCIAL);
bs(BU.LOGISTICS, 0.11, 8.5, RoofKind.METAL, 0.74, LandUse.INDUSTRIAL, 0.06, 0.48, 0.40, LightClass.INDUSTRIAL);
bs(BU.FARM, 0, 0, RoofKind.CERAMIC, 0, LandUse.FARM, 0.88, 0.0, 0.0, LightClass.NONE);
bs(BU.GREENHOUSES, 0.58, 5.2, RoofKind.GLASS, 0.86, LandUse.GREENHOUSE, 0.10, 0.28, 0.12, LightClass.UTILITY);
bs(BU.DORMS, 0.34, 9.5, RoofKind.CERAMIC, 0.86, LandUse.RES_LOW, 0.30, 0.20, 0.30, LightClass.RESIDENTIAL);
bs(BU.UTILITY, 0.06, 7, RoofKind.CERAMIC, 0.90, LandUse.UTILITY, 0.10, 0.50, 0.42, LightClass.UTILITY);
bs(BU.POLAR_STATION, 0.20, 7, RoofKind.INSULATED, 0.92, LandUse.UTILITY, 0.0, 0.50, 0.40, LightClass.UTILITY);
bs(BU.PARKING, 0.0, 0, RoofKind.CERAMIC, 0.45, LandUse.TRANSIT, 0.06, 0.88, 0.30, LightClass.STREET);
bs(BU.SOLAR, 0.0, 0, RoofKind.SOLAR, 0.25, LandUse.UTILITY, 0.06, 0.10, 0.0, LightClass.NONE);
bs(BU.GREENBELT, 0.0, 0, RoofKind.CERAMIC, 0, LandUse.PARK, 0.94, 0.02, 0.02, LightClass.STREET);
bs(BU.TERRACE, 0.42, 13, RoofKind.TERRACE, 0.78, LandUse.RES_MID, 0.34, 0.12, 0.40, LightClass.RESIDENTIAL);
bs(BU.FERRY, 0.26, 10, RoofKind.MEMBRANE, 0.94, LandUse.TRANSIT, 0.10, 0.56, 0.90, LightClass.TRANSIT);
bs(BU.VILLAGE, 0.18, 6, RoofKind.CERAMIC, 0.78, LandUse.RES_LOW, 0.40, 0.10, 0.16, LightClass.RURAL);

// ---------------------------------------------------------------------------------------------
// Street / rail dimensions (metres) and street light per class (night radiance of the paved area)
// ---------------------------------------------------------------------------------------------
export const RAIL = {
  corridor: 16,          // 2-track at-grade corridor incl. ballast and fences
  viaduct: 11,           // elevated deck width
  highwayOffset: 34,     // parallel intercity road offset from rail centreline (outside towns)
  highwayWidth: 22,
  maxEdge: 62000,        // max town-to-town link length (m)
  elevatedHeight: 9,     // deck height above ground of elevated (Z03) lines
};
export const STREET_LIGHT = { boulevard: 0.95, arterial: 0.85, collector: 0.70, local: 0.52, lane: 0.30, farm: 0.0, levee: 0.03, highway: 0.75, service: 0.08 };

// ---------------------------------------------------------------------------------------------
// Province rule variants (§3 地域变体). Keys are province codes.
//   slopeMax: max ground slope (rise/run) for ordinary plots; slopeTerrace: terraced housing limit
//   year0/era: first construction year and the span over which districts were built
// ---------------------------------------------------------------------------------------------
export const PROVINCE_RULES = {
  OX1: { zone: 'O', canals: 1, levee: 1, greenhouse: 0.16, otown: 1.0, slopeMax: 0.22, style: 'O-utility', year0: 2236, era: 150 },
  OX2: { zone: 'O', canals: 1, valley: 1, greenhouse: 0.12, otown: 0.8, slopeMax: 0.30, style: 'O-utility', year0: 2262, era: 140 },
  OX3: { zone: 'O', canals: 1, dikes: 1, longStrips: 1, greenhouse: 0.06, otown: 1.0, slopeMax: 0.20, style: 'O-levee', year0: 2251, era: 150 },
  OX4: { zone: 'O', polar: 1, ice: 1, greenhouse: 0.7, otown: 0.5, meltwater: 1, slopeMax: 0.24, style: 'O-polar', year0: 2318, era: 110 },
  OX5: { zone: 'O', canals: 1, terraces: 1, greenhouse: 0.14, otown: 0.9, slopeMax: 0.26, style: 'O-utility', year0: 2244, era: 150 },
  OX6: { zone: 'O', polar: 1, stations: 1, pipes: 1, greenhouse: 0.5, otown: 0.35, slopeMax: 0.22, style: 'O-polar', year0: 2331, era: 100 },
  ZR1: { zone: 'Z', coastal: 1, port: 0.55, islands: 0.6, ferry: 1, multiCore: 1, slopeMax: 0.26, style: 'Z-ceramic', year0: 2182, era: 260 },
  ZR2: { zone: 'Z', canyon: 1, terraced: 1, slopeMax: 0.30, slopeTerrace: 0.85, style: 'Z-terrace', year0: 2214, era: 230 },
  ZR3: { zone: 'Z', plateau: 1, windGaps: 1, gap: 0.62, slopeMax: 0.26, style: 'Z-highland', year0: 2196, era: 250 },
  ZR4: { zone: 'Z', islands: 1, ferry: 1, port: 0.25, slopeMax: 0.28, style: 'Z-island', year0: 2228, era: 220 },
  ZR5: { zone: 'Z', port: 0.6, fan: 1, ferry: 1, slopeMax: 0.26, style: 'Z-port', year0: 2205, era: 240 },
  ZR6: { zone: 'Z', cold: 1, covered: 1, sunSlope: 1, slopeMax: 0.30, slopeTerrace: 0.55, style: 'Z-cold', year0: 2290, era: 160 },
};

// District roof palettes (A03 tonal patchwork): roof kinds of ordinary housing per district style
export const ROOF_STYLES = [
  [RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.GARDEN, RoofKind.SOLAR, RoofKind.WARM],   // white ceramic
  [RoofKind.WARM, RoofKind.WARM, RoofKind.WARM, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.GARDEN, RoofKind.SOLAR],        // warm ceramic
  [RoofKind.GARDEN, RoofKind.GARDEN, RoofKind.GARDEN, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.SOLAR],  // roof gardens
  [RoofKind.SOLAR, RoofKind.SOLAR, RoofKind.SOLAR, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.METAL, RoofKind.GARDEN],      // solar
  [RoofKind.METAL, RoofKind.METAL, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.CERAMIC, RoofKind.DARK, RoofKind.SOLAR],      // silver / grey
];
export const WINDOW_K = 0.38;      // window light of a block (BU_STATS.light) relative to street light per unit area

export const CURRENT_YEAR = 2460;   // "present day" of the setting: centuries after settlement
