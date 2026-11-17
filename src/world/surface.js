// Surface "look" function: what colour / roughness / night light a patch of ground has when it is
// seen at a given texel size. Pure, worker-safe, float64, deterministic. OWNER: terrain-render agent.
//
// CONTRACT
//   surfaceSample(x, y, z, texelMeters, out) -> out
//       (x,y,z) unit direction (ECEF), texelMeters = ground footprint of one texel (m).
//       out.albedo    [r,g,b] linear base colour, area-averaged over the texel footprint
//       out.roughness 0..1
//       out.lightStreet  street-level night light (streets / plazas / quays) in EMISSIVE units (1 = a
//                        typical lit window), out.lightFar  aggregated window light (+ orbit envelope)
//                        in EMISSIVE units, out.lightTemp 0 warm … 1 cold (lightColour(temp))
//       out.emission  [r,g,b] = lightColour(lightTemp) × (lightFar + lightStreet)  (units; previews)
//       out.onset 0 (lights up early at dusk) .. 1 (late)
//       out.wet 0..1, out.ice 0..1, out.gloss 0..1 (wet / ice / glass / water specular mask), out.ao 0..1
//       out.urban 0..1 (built fabric share), out.microHeight metres of sub-geometry relief (normal maps)
//   shadeSurface(x, y, z, texelMeters, T, U, W, ctx, out) -> out
//       Same result from pre-computed samples (the terrain tile worker evaluates every world function
//       once per texel): T = sampleTerrain(), U = urbanSample() (or null), W = waterAt() (or null),
//       ctx = {slope, ao, waterFrac, depth, waterResolved, canalResolved} (see SHADE_CTX).
//   surfaceMicroHeight(x, y, z, texelMeters, T, U) -> metres (fine relief for the normal map)
//   configureSurface({urban?, terrain?, hydro?}) — modules providing the enums / samplers. The urban
//       module is optional: initSurfaceModules() imports it dynamically so that the terrain keeps
//       rendering (without the city) while world/urban.js is being rewritten or fails to load.
//
// LOOK (A03 / A01 / R3 / R1 / O01 / O03 / G02 / Z04)
//   silver-white city = pale ceramic roofs mixed with dark street canyons and their shadow; cobalt seas
//   (the sea floor seen through the water column — the water surface itself belongs to the water
//   renderer); ochre-red ridges with layered strata; dark basalt / lava fields; olive and green farms
//   with blue canals; white ice with blue crevasse light.
// SCALE CONSISTENCY
//   Everything finer than ~2 texels is replaced by its area average: band-limited noise only adds
//   octaves the texel resolves, the urban raster is area-averaged by world/urban.js, and every colour
//   operation applied to the urban fabric is affine (it commutes with averaging) so the orbit texture
//   is the average of the street-level one. Fine detail (gravel, pebbles, cracks, joints, slab and
//   paver joints, kerbs, crop rows, glass panes, wet edges) fades in only once it is resolved.
// TOLERANCE
//   The terrain and urban functions are developed in parallel: enum values are looked up by name
//   (unknown values fall back to sensible defaults), missing fields default to neutral values, and
//   the urban `fabric` colour is used when present (else a class palette).

import { R, RAD } from '../core/constants.js';
import { createNoise, worley3, worley2, clamp, smoothstep } from '../core/noise.js';
import { hash4 } from '../core/hash.js';
import { emissionAt, zoneSmooth, densityAt, provinceAt } from '../data/controlMaps.js';
import * as TERRAIN from './terrain.js';
import * as HYDRO from './hydro.js';
import { SITES, unitToLocal, g01ToUV, g01ShoreV, g01ArcV, G01_GEO } from './sites.js';
// orbit-scale irrigation network (fix round 3, QA2P-02): the order-0 main canals of the O zones
import { node0, parent0, N0 as CN0, DA0 as CDA0, outletSeg } from './terrain/irrigation.js';
import { hash3 as ihash3, rehash as irehash, u01 as iu01 } from './terrain/noise.js';
import { vecToFace, faceToVec } from '../core/geo.js';
import { basinMask, OX1_BASIN } from './terrain/basin.js';
import { queryLines, HIT as LHIT, LINE_DATA, lineParam } from './terrain/layout.js';

export const SURFACE_VERSION = 'surface-5';

// ---------------------------------------------------------------------------------------------
// modules (urban is optional and loaded dynamically)
// ---------------------------------------------------------------------------------------------
const MOD = { terrain: TERRAIN, hydro: HYDRO, urban: null };
let urbanTried = false, urbanError = null, urbanForced = false, urbanTries = 0, urbanTriedAt = 0;

/** Install module objects (tests / tools). Each is optional. */
export function configureSurface(mods = {}) {
  if (mods.terrain) MOD.terrain = mods.terrain;
  if (mods.hydro) MOD.hydro = mods.hydro;
  if (mods.urban !== undefined) { MOD.urban = mods.urban; urbanTried = true; urbanForced = true; }
  resolveEnums();
}

/** Dynamically import world/urban.js. Resolves to true when the urban module is usable. A failed import
 *  (e.g. the dev server serving a half-written urban module) is retried at most every 15 s (up to 6
 *  times, cache-busted), so a worker that started during a broken moment does not keep building tiles
 *  without the city for its whole lifetime (tiles without the city next to tiles with it = hard seams). */
export async function initSurfaceModules() {
  const now = Date.now();
  if (!MOD.urban && !urbanForced && (!urbanTried || (urbanTries < 6 && now - urbanTriedAt > 15000))) {
    urbanTried = true; urbanTriedAt = now; urbanTries++;
    try {
      const m = urbanTries === 1 ? await import('./urban.js') : await import(/* @vite-ignore */ `./urban.js?retry=${urbanTries}`);
      if (m && typeof m.urbanSample === 'function') { MOD.urban = m; urbanError = null; }
    } catch (e) { urbanError = e; MOD.urban = null; }
    resolveEnums();
  }
  return !!MOD.urban;
}
export function surfaceModules() { return { urban: !!MOD.urban, urbanError: urbanError ? String(urbanError.message || urbanError) : null }; }
export function getUrbanSampler() { return MOD.urban ? MOD.urban.urbanSample : null; }

// ---------------------------------------------------------------------------------------------
// noise channels 700..729 belong to the surface look (world definition: never reuse elsewhere)
// ---------------------------------------------------------------------------------------------
const NA = createNoise(701);   // macro albedo variation
const NB = createNoise(702);   // geology facies / basalt / dust
const NC = createNoise(703);   // strata wobble
const ND = createNoise(704);   // fine grain
const NE = createNoise(705);   // vegetation / field texture
const NF = createNoise(706);   // urban neighbourhood variation
const NG = createNoise(707);   // wind streaks / dust drift
const NH = createNoise(708);   // asphalt / concrete wear

// ---------------------------------------------------------------------------------------------
// palette (linear reflectance). Natural values are physically plausible Martian albedos tuned to the
// reference palette (A03 / A01 rock orange-red, R1 / O01 ochre plains, O03 ice, G02 strata).
// ---------------------------------------------------------------------------------------------
const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const C = (r, g, b) => new Float64Array([s2l(r), s2l(g), s2l(b)]);
const L = (r, g, b) => new Float64Array([r, g, b]);

const P = {
  // rock facies (saturated iron-oxide orange-red: A01 / A03 / R3)
  rockRed: L(0.275, 0.074, 0.031), rockOchre: L(0.360, 0.135, 0.050), rockBrown: L(0.160, 0.062, 0.033),
  rockDeep: L(0.195, 0.047, 0.025), rockPale: L(0.420, 0.205, 0.105), rockTan: L(0.310, 0.150, 0.075),
  cliffFace: L(0.170, 0.056, 0.029), mesaCap: L(0.380, 0.170, 0.085), fresh: L(0.105, 0.066, 0.050),
  basalt: L(0.070, 0.056, 0.048), basaltRed: L(0.112, 0.062, 0.044), lava: L(0.042, 0.038, 0.037),
  // loose ground
  sand: L(0.360, 0.138, 0.054), dust: L(0.420, 0.178, 0.077), dune: L(0.440, 0.192, 0.082),
  soil: L(0.140, 0.072, 0.041), soilDark: L(0.088, 0.050, 0.032), gravel: L(0.220, 0.125, 0.080),
  // cold
  frost: L(0.700, 0.690, 0.680), ice: L(0.780, 0.830, 0.875), iceDirty: L(0.520, 0.470, 0.430),
  iceBlue: L(0.380, 0.600, 0.740), snow: L(0.860, 0.880, 0.900),
  crevasse: L(0.085, 0.240, 0.400), rime: L(0.760, 0.840, 0.900),
  // shores / beds
  beach: L(0.540, 0.410, 0.270), wetSand: L(0.250, 0.170, 0.105), seaSediment: L(0.200, 0.140, 0.090),
  riverbed: L(0.220, 0.180, 0.140), waterline: L(0.520, 0.440, 0.360),
  // water column (bed seen through water, sky lit) — apparent reflectance, no surface specular
  seaShallow: L(0.040, 0.150, 0.170), seaMid: L(0.014, 0.075, 0.150), seaDeep: L(0.0075, 0.030, 0.088),
  canalWater: L(0.016, 0.060, 0.105), lakeWater: L(0.012, 0.052, 0.100),
  // vegetation
  grass: L(0.075, 0.125, 0.036), meadow: L(0.150, 0.150, 0.060), trees: L(0.032, 0.062, 0.024),
  // urban fallback palette (used when urbanSample does not provide a fabric colour)
  roofCeramic: L(0.80, 0.77, 0.70), roofMetal: L(0.43, 0.45, 0.46), roofMembrane: L(0.88, 0.88, 0.85),
  roofSolar: L(0.035, 0.05, 0.09), roofGarden: L(0.20, 0.27, 0.12), roofGlass: L(0.50, 0.58, 0.62),
  roofWarm: L(0.62, 0.40, 0.25), roofDark: L(0.12, 0.13, 0.15), roofTerrace: L(0.44, 0.48, 0.36), roofInsulated: L(0.76, 0.78, 0.80),
  asphalt: L(0.055, 0.058, 0.064), lane: L(0.30, 0.29, 0.27), sidewalk: L(0.56, 0.53, 0.48), plaza: L(0.62, 0.60, 0.55),
  yard: L(0.36, 0.36, 0.30), park: L(0.05, 0.12, 0.035), industrial: L(0.27, 0.26, 0.24), dock: L(0.48, 0.46, 0.42),
  pier: L(0.30, 0.24, 0.18), rail: L(0.15, 0.13, 0.11), farmRoad: L(0.36, 0.23, 0.15), parking: L(0.20, 0.20, 0.21),
  solar: L(0.03, 0.045, 0.085), pitch: L(0.09, 0.22, 0.06), bank: L(0.20, 0.22, 0.14), pipe: L(0.62, 0.63, 0.64),
  greenhouse: L(0.50, 0.58, 0.62), barrier: L(0.58, 0.56, 0.52),
};
// crops by FarmCrop (palette index) × FarmStage [grown, harvested, flooding, young]
const CROP = [
  [P.meadow, P.meadow, P.meadow, P.meadow],
  [L(0.10, 0.21, 0.05), L(0.34, 0.30, 0.13), L(0.06, 0.10, 0.11), L(0.18, 0.28, 0.08)],     // 1 fodder (olive)
  [L(0.09, 0.20, 0.05), L(0.33, 0.27, 0.12), L(0.05, 0.10, 0.12), L(0.14, 0.26, 0.10)],     // 2 paddy
  [L(0.12, 0.19, 0.035), L(0.42, 0.29, 0.12), L(0.06, 0.10, 0.11), L(0.20, 0.30, 0.06)],    // 3 grain
  [L(0.30, 0.11, 0.05), L(0.30, 0.11, 0.05), L(0.30, 0.11, 0.05), L(0.30, 0.11, 0.05)],     // 4 fallow
  [L(0.05, 0.16, 0.13), L(0.05, 0.16, 0.13), L(0.05, 0.16, 0.13), L(0.05, 0.16, 0.13)],     // 5 algae ponds
  [L(0.10, 0.21, 0.05), L(0.34, 0.30, 0.13), L(0.06, 0.10, 0.11), L(0.18, 0.28, 0.08)],     // 6 (unused)
  [L(0.07, 0.17, 0.04), L(0.30, 0.20, 0.10), L(0.06, 0.10, 0.11), L(0.15, 0.27, 0.07)],     // 7 vegetables
  [L(0.035, 0.085, 0.025), L(0.035, 0.085, 0.025), L(0.035, 0.085, 0.025), L(0.035, 0.085, 0.025)], // 8 orchard
];

// night light colours (linear, relative): warm residential (A02 sodium-gold) → white-gold civic /
// station cores → cold white port rows. The terrain shader rebuilds the same colours from the texel
// temperature (render/terrain/material.js trLightColour — keep both in sync).
const LIGHT_WARM = L(1.0, 0.47, 0.13), LIGHT_NEUTRAL = L(1.0, 0.76, 0.44), LIGHT_COLD = L(0.74, 0.86, 1.0);
// Night radiance in EMISSIVE units (ARCHITECTURE §3 / D3: 1.0 = one typical lit window at night):
//   street  ground-level street / plaza / quay light (lightGround of the urban plan), thin and dim:
//           a boulevard carriageway ≈ 0.33 units, a local street ≈ 0.18, block interiors ≈ 0. The
//           renderer fades it out within ~1.5 km of the camera (props street lamps take over).
//   far     the aggregated window light of the built fabric (+ station / core glow, the emission-map
//           envelope at orbit). The renderer shows it only where the 3D city does not draw its
//           buildings (complement of the city's distance / size fade): orbit and regional views.
// Orbit calibration (A02 at the night-side exposure, 1 unit ≈ mid grey): residential texel ≈ 1–1.5
// units, corridor beads ≈ 0.5–2, bright cores 6–12 (bloom, keep internal contrast through the
// filigree), isolated O-zone posts ≈ 0.3–1 (sub-texel dots).
const STREET_UNITS = 0.35;                          // units per unit of urban lightGround
const FAR_UNITS = 3.0, FAR_GAMMA = 1.0;             // aggregate: units = FAR_UNITS·(light·filigree)^γ
const BG_UNITS = 0.12;                              // outskirts node network, mean units on habitable land
// DN port working light (urbanSample.lightPort 0..1, max / coverage aggregated): cold-white quay floodlight rows
// (street channel, ground-level light): PORT_NEAR units of mean where the rows resolve, PORT_ORBIT at orbit texels
const PORT_NEAR = 1.4, PORT_ORBIT = 3.0;
export const LIGHT_RANGE = { far: 16, street: 8 };  // texture encoding ranges (units) — config.js mirrors

// ---------------------------------------------------------------------------------------------
// enum lookups (by name: renamed / added values in other modules degrade gracefully)
// ---------------------------------------------------------------------------------------------
const v = (o, k, d) => (o && typeof o[k] === 'number' ? o[k] : d);
const CLS = {}, LUSE = {}, ROOF = {}, MAT = {};
const ROOF_COLOR = [];
function resolveEnums() {
  const SC = (MOD.urban && MOD.urban.SurfaceClass) || {};
  const LU = (MOD.urban && MOD.urban.LandUse) || {};
  const RK = (MOD.urban && MOD.urban.RoofKind) || {};
  const TM = (MOD.terrain && MOD.terrain.TerrainMat) || {};
  Object.assign(CLS, {
    NATURAL: v(SC, 'NATURAL', 0), ROAD_ART: v(SC, 'ROAD_ART', 1), ROAD_LOCAL: v(SC, 'ROAD_LOCAL', 2), RAIL: v(SC, 'RAIL', 3),
    SIDEWALK: v(SC, 'SIDEWALK', 4), ROOF: v(SC, 'ROOF', 5), YARD: v(SC, 'YARD', 6), PARK: v(SC, 'PARK', 7), PLAZA: v(SC, 'PLAZA', 8),
    FARM: v(SC, 'FARM', 9), GREENHOUSE: v(SC, 'GREENHOUSE', 10), DOCK: v(SC, 'DOCK', 11), PIER: v(SC, 'PIER', 12),
    INDUSTRIAL: v(SC, 'INDUSTRIAL', 13), CANAL_BANK: v(SC, 'CANAL_BANK', 14), SOLAR: v(SC, 'SOLAR', 15), PARKING: v(SC, 'PARKING', 16),
    BARRIER: v(SC, 'BARRIER', 17), LANE: v(SC, 'LANE', 18), FARM_ROAD: v(SC, 'FARM_ROAD', 19), BRIDGE: v(SC, 'BRIDGE', 20),
    PIPE: v(SC, 'PIPE', 21), TREE_ROW: v(SC, 'TREE_ROW', 22), SPORTS: v(SC, 'SPORTS', 23),
  });
  Object.assign(LUSE, {
    NONE: v(LU, 'NONE', 0), RES_LOW: v(LU, 'RES_LOW', 1), RES_MID: v(LU, 'RES_MID', 2), RES_HIGH: v(LU, 'RES_HIGH', 3),
    COMMERCIAL: v(LU, 'COMMERCIAL', 4), CIVIC: v(LU, 'CIVIC', 5), INDUSTRIAL: v(LU, 'INDUSTRIAL', 6), PORT: v(LU, 'PORT', 7),
    TRANSIT: v(LU, 'TRANSIT', 8), PARK: v(LU, 'PARK', 9), FARM: v(LU, 'FARM', 10), UTILITY: v(LU, 'UTILITY', 11), GREENHOUSE: v(LU, 'GREENHOUSE', 12),
  });
  Object.assign(ROOF, {
    CERAMIC: v(RK, 'CERAMIC', 0), METAL: v(RK, 'METAL', 1), MEMBRANE: v(RK, 'MEMBRANE', 2), SOLAR: v(RK, 'SOLAR', 3),
    GARDEN: v(RK, 'GARDEN', 4), GLASS: v(RK, 'GLASS', 5), WARM: v(RK, 'WARM', 6), DARK: v(RK, 'DARK', 7),
    TERRACE: v(RK, 'TERRACE', 8), INSULATED: v(RK, 'INSULATED', 9),
  });
  Object.assign(MAT, { SEAFLOOR: v(TM, 'SEAFLOOR', 0), BEACH: v(TM, 'BEACH', 1), ROCK_RED: v(TM, 'ROCK_RED', 3), BASALT: v(TM, 'BASALT', 4), ICE: v(TM, 'ICE', 8) });
  ROOF_COLOR.length = 0;
  const kinds = [[ROOF.CERAMIC, P.roofCeramic], [ROOF.METAL, P.roofMetal], [ROOF.MEMBRANE, P.roofMembrane], [ROOF.SOLAR, P.roofSolar],
    [ROOF.GARDEN, P.roofGarden], [ROOF.GLASS, P.roofGlass], [ROOF.WARM, P.roofWarm], [ROOF.DARK, P.roofDark],
    [ROOF.TERRACE, P.roofTerrace], [ROOF.INSULATED, P.roofInsulated]];
  for (const [k, c] of kinds) if (k >= 0 && k < 64) ROOF_COLOR[k] = c;
}
resolveEnums();

// ---------------------------------------------------------------------------------------------
// helpers (allocation free)
// ---------------------------------------------------------------------------------------------
const TMP = new Float64Array(3), TMP2 = new Float64Array(3), TMP3 = new Float64Array(3);
const ROCKC = new Float64Array(3), SANDC = new Float64Array(3), BASC = new Float64Array(3);
const NAT = new Float64Array(3), BED = new Float64Array(3), URB = new Float64Array(3);
function set3(o, c) { o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; }
function mix3(o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; }
function lerpTo(o, b, t) { o[0] += (b[0] - o[0]) * t; o[1] += (b[1] - o[1]) * t; o[2] += (b[2] - o[2]) * t; }
function mul3(o, k) { o[0] *= k; o[1] *= k; o[2] *= k; }
function addW(o, c, w) { o[0] += c[0] * w; o[1] += c[1] * w; o[2] += c[2] * w; }
const num = (x, d = 0) => (typeof x === 'number' && x === x ? x : d);
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** octave weight: 1 when the wavelength spans ≥ 4 texels, 0 below 2 texels */
function fadeWl(wl, texel) { const r = wl / (texel + 1e-9); return r >= 4 ? 1 : r <= 2 ? 0 : (r - 2) * 0.5; }
/** feature resolvability: 0 when the feature is ≤ 1 texel, 1 from 3 texels */
function resolved(size, texel) { return sat((size / (texel + 1e-9) - 1) * 0.5); }

/** band-limited fbm in metres (≈ -1..1); unresolved octaves contribute their mean (0) */
function bandFbm(n, X, Y, Z, wl, oct, gain, texel) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    norm += amp;
    const f = fadeWl(wl, texel);
    if (f > 0) sum += amp * f * n.noise3(X / wl + o * 13.7, Y / wl - o * 7.3, Z / wl + o * 3.1);
    else if (o > 0) { for (let k = o + 1; k < oct; k++) { amp *= gain; norm += amp; } break; }
    amp *= gain; wl *= 0.5;
  }
  return sum / norm;
}

const WOR = {}, WOR2 = {};

/** local east / north unit vectors at unit direction (x,y,z) → TMP3 = east, returned north in E_N */
const E_N = new Float64Array(6);
function enu(x, y, z) {
  let ex = z, ez = -x; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  E_N[0] = ex; E_N[1] = 0; E_N[2] = ez;
  E_N[3] = -y * ez; E_N[4] = z * ex - x * ez; E_N[5] = y * ex;   // north = up × east
  return E_N;
}

// ---------------------------------------------------------------------------------------------
// natural ground
// ---------------------------------------------------------------------------------------------
/** share of an ice cliff face (terrain iceCliff on steep ground: the texel slope or the terrain's fine slope hint) */
function iceCliffShare(T, slope) {
  const ic = sat(num(T.iceCliff, 0));
  return ic > 0 ? ic * Math.max(smoothstep(0.08, 0.3, slope), smoothstep(0.45, 0.9, num(T.slopeHint, 0))) : 0;
}
const NAT_OVR = { on: false, soil: 0 };
/** returns the ice share; writes the natural albedo into out */
function naturalColour(x, y, z, X, Y, Z, texel, T, ctx, out) {
  const slope = num(ctx.slope, num(T.slopeHint, 0) * 0.3);          // 1 - cos(slope angle)
  const h = num(T.h, 0);
  let rock = sat(num(T.rock, 0)), basalt = sat(num(T.basalt, 0)), sand = sat(num(T.sand, 0));
  let soil = sat(num(T.soil, 0)), ice = sat(num(T.ice, 0)), beach = sat(num(T.beach, 0));
  // orbit O-zone farm soil follows the drawn irrigation network (shadeSurface: dark soil only under the farmland,
  // red sand / earth beyond the irrigation ends instead of the uniform expectation of the coarse terrain sample)
  if (NAT_OVR.on) { sand = Math.max(0, sand + soil - NAT_OVR.soil); soil = NAT_OVR.soil; }
  const sea = sat(num(T.seafloor, 0));
  const mat = num(T.mat, -1);
  if (T.basalt === undefined && mat === MAT.BASALT) { basalt = Math.max(basalt, 0.7 * rock); rock *= 0.3; }
  // steep ground sheds sand and soil (angle of repose ≈ 33° → 1-cos ≈ 0.16): bare rock on cliffs
  const steep = smoothstep(0.09, 0.28, slope);
  // ice cliffs (OX4 冰崖, O03): the face is ice whatever the regolith weights say (QY-04: it read as farm / sand,
  // i.e. a red rock wall); the gentle top keeps its frost
  const icl = iceCliffShare(T, slope);
  if (icl > 0) {
    const others = rock + basalt + sand + soil + beach;
    rock *= 1 - icl; basalt *= 1 - icl; sand *= 1 - icl; soil *= 1 - icl; beach *= 1 - icl;
    ice = Math.min(1, ice + others * icl);
  }
  const shed = (sand + soil + beach) * steep * 0.85;
  sand *= 1 - steep * 0.85; soil *= 1 - steep * 0.85; beach *= 1 - steep * 0.85;
  rock += shed;
  const cliff = Math.max(sat(num(T.cliff, 0)), steep);
  const sum = rock + basalt + sand + soil + ice + beach + sea || 1;
  const inv = 1 / sum;

  out[0] = 0; out[1] = 0; out[2] = 0;
  // ---- rock: oxidised red base with regional facies (ochre / tan / brown / deep red)
  if (rock > 1e-3) {
    const reg = bandFbm(NB, X, Y, Z, 420000, 5, 0.55, texel);
    const reg2 = bandFbm(NB, X + 7.7e5, Y, Z, 90000, 3, 0.6, texel);
    set3(ROCKC, P.rockRed);
    lerpTo(ROCKC, P.rockOchre, smoothstep(-0.05, -0.45, reg) * 0.75);
    lerpTo(ROCKC, P.rockBrown, smoothstep(0.12, 0.5, reg) * 0.55);
    lerpTo(ROCKC, P.rockDeep, smoothstep(0.1, 0.5, reg2) * 0.4);
    lerpTo(ROCKC, P.rockTan, smoothstep(-0.15, -0.55, reg2) * 0.35);
    // cliffs and canyon walls: darker, layered strata (tone from terrain.js), wobbling bands
    if (cliff > 0.02) {
      lerpTo(ROCKC, P.cliffFace, cliff * 0.30);
      const tone = num(T.strata, 0.5);
      const tanS = Math.sqrt(Math.max(0, 1 - (1 - slope) * (1 - slope))) / Math.max(0.05, 1 - slope);
      const spacing = 24 / Math.max(0.02, tanS);                        // horizontal spacing of ~24 m layers
      const vis = sat(spacing / (3 * texel) - 0.5) * cliff;
      if (vis > 0) {
        const wob = bandFbm(NC, X, Y, Z, 900, 3, 0.5, texel);
        const t2 = sat(tone + 0.15 * wob);
        if (t2 > 0.55) lerpTo(ROCKC, P.rockPale, (t2 - 0.55) * 1.6 * vis);
        else if (t2 < 0.4) lerpTo(ROCKC, P.rockDeep, (0.4 - t2) * 1.8 * vis);
      }
    }
    const mesa = sat(num(T.mesa, 0));
    if (mesa > 0) lerpTo(ROCKC, P.mesaCap, mesa * 0.4 * (1 - steep));
    const fresh = sat(num(T.fresh, 0));
    if (fresh > 0) lerpTo(ROCKC, P.fresh, fresh * 0.55);
    // dust mantle on gentle rock (plateaus read paler / pinker than ridge flanks)
    const mantle = (1 - steep) * smoothstep(0.02, 0.0, slope - 0.02) * 0.25;
    if (mantle > 0) lerpTo(ROCKC, P.dust, mantle);
    addW(out, ROCKC, rock * inv);
  }
  // ---- basalt / lava
  if (basalt > 1e-3) {
    mix3(BASC, P.basalt, P.basaltRed, 0.5 + 0.5 * bandFbm(NB, X - 377, Y, Z, 40000, 3, 0.5, texel));
    const lava = sat(num(T.lava, 0));
    if (lava > 0) lerpTo(BASC, P.lava, lava * 0.7);
    addW(out, BASC, basalt * inv);
  }
  // ---- sand / dust / dunes
  const dune = sat(num(T.dune, 0));
  if (sand > 1e-3) {
    mix3(SANDC, P.sand, P.dust, 0.5 + 0.5 * bandFbm(NB, X + 911, Y, Z, 60000, 3, 0.5, texel));
    if (dune > 0) lerpTo(SANDC, P.dune, dune * 0.5);
    addW(out, SANDC, sand * inv);
  }
  if (soil > 1e-3) { mix3(TMP2, P.soil, P.soilDark, 0.5 + 0.5 * bandFbm(NE, X, Y, Z, 6000, 2, 0.5, texel)); addW(out, TMP2, soil * inv); }
  if (beach > 0) addW(out, h < 0.6 ? P.wetSand : P.beach, beach * inv);
  if (sea > 0) addW(out, P.seaSediment, sea * inv);
  if (ice > 0) {
    mix3(TMP2, P.ice, P.iceDirty, smoothstep(0.15, 0.6, bandFbm(NA, X + 77, Y, Z, 20000, 6, 0.6, texel)) * 0.45);
    const ic = sat(num(T.iceCliff, 0));
    if (ic > 0) lerpTo(TMP2, P.iceBlue, ic * 0.65);
    else lerpTo(TMP2, P.snow, (1 - steep) * 0.3);
    // OX4 ice-cliff faces (O03 / §5 04 「冰层裂隙和霜面偏冷」): terrain's vertical crevasse cue (band-limited by the slot
    // width) → deep cold blue slots; the faces between them carry a thin cold rime (frost) on the shaded face
    const crev = sat(num(T.crevasse, 0));
    if (crev > 0) lerpTo(TMP2, P.crevasse, crev * 0.8);
    if (icl > 0) lerpTo(TMP2, P.rime, icl * (1 - crev) * 0.22);
    // crevasse banding on resolved steep ice, dust layers in ice cliffs (O03), wind sastrugi
    if (texel < 400) {
      const cr = bandFbm(NC, X * 1.7 + 31, Y, Z * 0.6, 180, 5, 0.55, texel);
      lerpTo(TMP2, P.iceBlue, smoothstep(0.35, 0.7, cr) * 0.35 * steep);
      if (steep > 0.05) {
        const layer = Math.sin(h / 7.0 + 2.0 * NC.noise3(X / 400, Y / 400, Z / 400)) * 0.5 + 0.5;
        const vis = resolved(7 / Math.max(0.05, Math.sqrt(Math.max(0, slope * (2 - slope)))), texel);
        lerpTo(TMP2, P.iceDirty, smoothstep(0.65, 0.95, layer) * 0.5 * steep * vis);
      }
    }
    if (texel < 6) {
      const En = enu(x, y, z);
      const e = X * En[0] + Z * En[2], nn = X * En[3] + Y * En[4] + Z * En[5];
      const sg = bandFbm(NC, e * 0.4 + 11, nn * 1.8, 0, 3.5, 4, 0.55, texel * 1.8);
      mul3(TMP2, 1 + 0.07 * sg * (1 - steep));
    }
    addW(out, TMP2, ice * inv);
  }
  // crater parks inside cities (A03 landmark crater floors) and river beds
  const park = sat(num(T.park, 0));
  if (park > 0) {
    mix3(TMP2, P.grass, P.trees, 0.35);
    vegetationFactor(x, y, z, X, Y, Z, texel, 0, VEG);
    TMP2[0] *= VEG[0]; TMP2[1] *= VEG[1]; TMP2[2] *= VEG[2];
    lerpTo(out, TMP2, park * 0.85);
  }
  const riverbed = sat(num(T.riverbed, 0));
  if (riverbed > 0) lerpTo(out, P.riverbed, riverbed * 0.6);
  const wline = sat(num(T.waterline, 0));
  if (wline > 0) lerpTo(out, P.waterline, wline * 0.7);

  // macro brightness / hue variation (band-limited, mean preserving)
  const vv = bandFbm(NA, X, Y, Z, 600000, 6, 0.6, texel);
  const br = 1 + 0.18 * vv;
  out[0] *= br; out[1] *= br * (1 - 0.05 * vv); out[2] *= br * (1 - 0.09 * vv);
  const looseShare = (sand + soil * 0.5 + rock * 0.35 + basalt * 0.3) * inv * (1 - ice * inv);
  // regolith patchiness (80 m .. 8 km): coarse gravel lag (darker, browner) vs fine dust (paler,
  // more orange). Linear in the band-limited noise → exactly mean preserving across scales.
  if (looseShare > 0.05) {
    const pz = bandFbm(NG, X + 1.3e5, Y - 2.1e5, Z, 8000, 7, 0.6, texel);
    const k = pz * looseShare * (1 - steep * 0.6);
    out[0] *= 1 - 0.30 * k; out[1] *= 1 - 0.26 * k; out[2] *= 1 - 0.12 * k;
    // bedrock outcrops poking through the sand sheet (150 m .. 3 km)
    if (sand * inv > 0.2 && texel < 1500) {
      const oc = bandFbm(NB, X - 5.5e5, Y, Z + 3e5, 3000, 5, 0.55, texel);
      const outcrop = smoothstep(0.30, 0.58, oc) * sand * inv;
      if (outcrop > 0) { mix3(TMP2, P.rockBrown, P.rockRed, 0.5 + 0.5 * oc); lerpTo(out, TMP2, outcrop * 0.55); }
    }
  }
  // wind streaks: elongated dust drifts in the lee of obstacles (anisotropic, ~5–300 m)
  if (texel < 150 && (sand + rock * 0.4) * inv > 0.2) {
    const En = enu(x, y, z);
    const e = X * En[0] + Z * En[2], nn = X * En[3] + Y * En[4] + Z * En[5];
    const s = bandFbm(NG, e * 0.35, nn * 1.6, h * 0.5, 120, 5, 0.55, texel * 1.6);
    mul3(out, 1 + 0.10 * s * (sand + rock * 0.4) * inv * (1 - steep));
    // dust-devil tracks: thin dark sinuous lines (a few metres wide, km long) on dusty plains
    if (texel < 12) {
      const n = NG.noise3(e / 900 + 3.7, nn / 900 - 1.1, 0.37);
      const wpx = 0.012 + texel / 900 * 0.8;
      const line = 1 - smoothstep(wpx * 0.5, wpx, Math.abs(n));
      const res = resolved(5, texel);
      mul3(out, 1 - (0.16 * line * res + 0.004 * (1 - res)) * sand * inv * (1 - steep));
    }
  }

  // fine grain / gravel / pebbles / cracks (mean preserving, only where resolved)
  if (texel < 3.0) {
    const g = bandFbm(ND, X, Y, Z, 2.4, 6, 0.68, texel);
    mul3(out, 1 + 0.20 * g);
    const looseW = (sand + soil * 0.6 + rock * 0.4 + basalt * 0.5) * inv;
    if (texel < 0.16 && looseW > 0.05) {
      // pebbles & gravel: Worley cells ~7 cm, toned per stone, dark joints between stones
      const w = worley3(X / 0.07, Y / 0.07, Z / 0.07, 711, 1, WOR);
      const f = smoothstep(0.16, 0.04, texel);
      const tone = ((w.id >>> 8) & 255) / 255;
      const peb = (0.80 + 0.40 * tone) * (0.58 + 0.42 * smoothstep(0.0, 0.22, w.f2 - w.f1));
      const k = 1 + (peb - 0.9) * f * looseW;
      out[0] *= k; out[1] *= k * (1 - 0.04 * f * tone); out[2] *= k * (1 - 0.07 * f * tone);
      // coarser cobbles scattered on rock debris
      if (texel < 0.08 && rock * inv > 0.2) {
        const w2 = worley3(X / 0.32 + 9.1, Y / 0.32, Z / 0.32, 715, 1, WOR2);
        const cob = smoothstep(0.42, 0.30, w2.f1) * (((w2.id >>> 3) & 7) < 3 ? 1 : 0);
        mul3(out, 1 + cob * 0.22 * smoothstep(0.08, 0.03, texel) * (((w2.id >>> 12) & 255) / 255 - 0.35));
      }
    }
    if (dune > 0.2 && texel < 0.3) {
      const En = enu(x, y, z);
      const e = X * En[0] + Z * En[2], nn = X * En[3] + Y * En[4] + Z * En[5];
      const r = Math.sin((e * 0.83 + nn * 0.31) / 0.12 + 3 * ND.noise3(X / 0.9, Y / 0.9, Z / 0.9));
      mul3(out, 1 + 0.06 * r * smoothstep(0.3, 0.06, texel) * dune);
    }
  }
  const rockW = (rock + basalt) * inv;
  if (rockW > 0.25 && texel < 2.5) {
    // joints & fractures: Worley borders ~2.2 m (and ~9 m blocks), dark hairlines
    const w = worley3(X / 2.2, Y / 2.2, Z / 2.2, 712, 1, WOR);
    const e = w.f2 - w.f1;
    const res = smoothstep(2.5, 0.06, texel);
    const line = 1 - smoothstep(0.006, 0.02 + texel / 2.2, e);
    const blockTone = 1 + 0.12 * ((((w.id >>> 5) & 255) / 255) - 0.5) * res;
    mul3(out, (1 - 0.5 * line * res * rockW) * blockTone);
  }
  // frost overlay (shaded / high latitude ground)
  const frost = sat(num(T.frost, 0));
  if (frost > 0) lerpTo(out, P.frost, frost * (0.85 - 0.45 * steep));
  // legacy beach band (terrain without a beach weight)
  if (T.beach === undefined && ctx.coastal && h > -1.5 && h < 4) {
    const b = smoothstep(4, 1.0, h) * smoothstep(-1.5, 0, h) * (1 - steep) * (1 - ice);
    if (b > 0) lerpTo(out, h < 0.4 ? P.wetSand : P.beach, b * 0.85);
  }
  return ice * inv;
}

// ---------------------------------------------------------------------------------------------
// vegetation: groves of tree crowns over lawn / meadow, statistically consistent across scales
// ---------------------------------------------------------------------------------------------
const VEG = new Float64Array(3), WV = {};
const LAWN = L(0.088, 0.135, 0.042), CANOPY = L(0.030, 0.060, 0.024), DRY = L(0.150, 0.140, 0.065);
/**
 * Per-channel brightness factor of a vegetated texel relative to its area mean (≈1 when crowns and
 * groves are unresolved). kind 0 park / meadow, 1 yard / garden, 2 tree row / canal-bank belt.
 *   canopy fraction c(p) = band-limited grove field (clumps of 40–400 m)
 *   crowns: Worley cells of ~7 m, occupied with probability c/0.62; resolved from ~3 texels
 */
function vegetationFactor(x, y, z, X, Y, Z, texel, kind, out) {
  const base = kind === 2 ? 0.72 : kind === 1 ? 0.30 : 0.42;
  const grove = bandFbm(NE, X + 233, Y, Z, 420, 5, 0.6, texel);
  const c = sat(base + 0.55 * grove);
  const dry = sat(0.5 * bandFbm(NE, X - 911, Y + 77, Z, 180, 4, 0.55, texel) - 0.1) * (1 - c);
  // area means of the three surfaces
  const cExp = Math.min(c, 0.62);
  const mR = LAWN[0] * (1 - cExp - dry) + CANOPY[0] * cExp + DRY[0] * dry;
  const mG = LAWN[1] * (1 - cExp - dry) + CANOPY[1] * cExp + DRY[1] * dry;
  const mB = LAWN[2] * (1 - cExp - dry) + CANOPY[2] * cExp + DRY[2] * dry;
  // reference mean of the urban palette's park colour mix (so the factor ≈1 on average across parks)
  const refR = LAWN[0] * 0.58 + CANOPY[0] * 0.42, refG = LAWN[1] * 0.58 + CANOPY[1] * 0.42, refB = LAWN[2] * 0.58 + CANOPY[2] * 0.42;
  let fr = mR / refR, fg = mG / refG, fb = mB / refB;
  const k = resolved(5, texel);
  if (k > 0) {
    // resolved crowns: dome-shaded discs with dark gaps (inter-crown shade) and leaf clusters
    const cell = kind === 2 ? 5.5 : 7.0;
    const w = worley3(X / cell, Y / cell, Z / cell, 721, 0.9, WV);
    const occ = (((w.id >>> 7) & 1023) / 1023) < cExp / 0.62 ? 1 : 0;
    const rc = 0.36 + 0.14 * (((w.id >>> 17) & 255) / 255);          // crown radius (cells)
    const inside = occ * smoothstep(rc, rc * 0.7, w.f1);
    const dome = 0.75 + 0.45 * smoothstep(rc, 0.0, w.f1);              // brighter crown tops
    const leaf = texel < 0.6 ? 1 + 0.18 * ND.noise3(X / 0.45, Y / 0.45, Z / 0.45) * smoothstep(0.6, 0.15, texel) : 1;
    // local surface at this point (crown or lawn / dry patch)
    let lr, lg, lb;
    if (inside > 0) {
      lr = CANOPY[0] * dome * leaf; lg = CANOPY[1] * dome * leaf; lb = CANOPY[2] * dome * leaf;
      const t = 1 - inside;
      lr += (LAWN[0] - lr) * t; lg += (LAWN[1] - lg) * t; lb += (LAWN[2] - lb) * t;
    } else {
      const d2 = sat(dry * 1.6);
      lr = LAWN[0] + (DRY[0] - LAWN[0]) * d2; lg = LAWN[1] + (DRY[1] - LAWN[1]) * d2; lb = LAWN[2] + (DRY[2] - LAWN[2]) * d2;
      // shade ring around occupied crowns
      const ring = occ * smoothstep(rc * 1.35, rc, w.f1) * (1 - inside);
      lr *= 1 - 0.35 * ring; lg *= 1 - 0.32 * ring; lb *= 1 - 0.25 * ring;
      if (texel < 0.3) { const gr = 1 + 0.16 * ND.noise3(X / 0.09, Y / 0.09, Z / 0.09) * smoothstep(0.3, 0.06, texel); lr *= gr; lg *= gr; lb *= gr; }
    }
    // very close: flat crowns would read as blobs (3D trees are the props system's) → soften to shade
    const near = smoothstep(0.35, 0.08, texel);
    const amp = k * (1 - 0.65 * near);
    fr += (lr / refR - fr) * amp; fg += (lg / refG - fg) * amp; fb += (lb / refB - fb) * amp;
  }
  out[0] = fr; out[1] = fg; out[2] = fb;
  return out;
}

// ---------------------------------------------------------------------------------------------
// night-light filigree at orbit scale (A02: lit corridors and town dots with dark land between)
// ---------------------------------------------------------------------------------------------
// The urban light field carries its corridor / station network from ~1 km texels down; coarser
// texels only hold its area average, which reads as a flat glow from orbit. There a world-anchored,
// band-limited, MEAN-PRESERVING modulation (Voronoi edges = lit corridors, a share of the cell nodes
// = towns) redistributes the same regional light into a filigree the texel can still resolve. It
// fades out as the real network resolves, so the regional brightness never changes across zoom.
const FIL_CELLS = [240000, 80000, 27000, 9000];   // m, octave cell sizes
const FIL_EW = 0.05, FIL_DOT = 0.085;              // corridor half-width / town radius (cell units)
const FIL_SIG = 0.35;                              // texel footprint prefilter (σ in texels)
const WF = {};
let FIL_MEAN = null;
/**
 * One filigree octave: lit corridors along the Voronoi edges + towns on ~60 % of the nodes (unequal size
 * and brightness, long dark gaps between them). `sig` (m) prefilters the profiles with the texel
 * footprint: Gaussians widen and dim with their area kept, so a town or corridor smaller than a texel
 * still contributes its light (a sparkle, like A02's sub-pixel towns) instead of aliasing or vanishing;
 * sig = 0 is the exact pattern (FIL_MEAN is its expectation, preserved by the energy-conserving filter).
 */
function filPattern(X, Y, Z, c, o, sig) {
  const w = worley3(X / c + o * 31.7, Y / c - o * 17.3, Z / c + o * 5.1, 731 + o, 0.85, WF);
  const wl = FIL_EW * c * 0.5;                                   // corridor Gaussian width (m)
  const we = sig > 0 ? Math.sqrt(wl * wl + sig * sig) : wl;
  const e = (w.f2 - w.f1) * c * 0.5 / we;
  const line = (wl / we) * Math.exp(-e * e);
  let dot = 0;
  if (((w.id >>> 11) & 255) < 155) {
    const town = 0.45 + 1.1 * (((w.id >>> 3) & 255) / 255);
    const r = FIL_DOT * c * (0.55 + 0.9 * (((w.id >>> 19) & 255) / 255));
    const re2 = r * r + sig * sig, d = w.f1 * c;
    dot = town * (r * r / re2) * Math.exp(-d * d / re2);
  }
  return 0.05 + 0.85 * line + 3.4 * dot;
}
function filMeans() {
  // expectation of each octave pattern (homogeneous in 3D cell space), deterministic quasi-MC
  FIL_MEAN = [];
  for (let o = 0; o < FIL_CELLS.length; o++) {
    let s = 0; const n = 8000, c = FIL_CELLS[o];
    for (let i = 0; i < n; i++) {
      const h = hash4(i, o, 4242, 7), h2 = hash4(i, o, 977, 11);
      s += filPattern(((h & 0xffff) / 65536) * 40 * c, (((h >>> 16) & 0xffff) / 65536) * 40 * c, ((h2 & 0xffff) / 65536) * 40 * c, c, o, 0);
    }
    FIL_MEAN.push(s / n);
  }
}
// per-texel cache: the day texture, the urban light and the map envelope all use the same octaves
const FILC = { X: NaN, Y: NaN, Z: NaN, t: NaN, p: new Float64Array(FIL_CELLS.length), w: new Float64Array(FIL_CELLS.length) };
function filPrepare(X, Y, Z, texel) {
  if (FILC.X === X && FILC.Y === Y && FILC.Z === Z && FILC.t === texel) return FILC;
  if (!FIL_MEAN) filMeans();
  const sig = FIL_SIG * texel;
  for (let o = 0; o < FIL_CELLS.length; o++) {
    const c = FIL_CELLS[o];
    // nearest-feature evaluation holds while the footprint is small against the cell (≥ 2.4 texels per
    // cell: full pattern); coarser octaves blend to their mean (factor 1)
    const w = sat((c / texel - 0.8) / 1.6);
    FILC.w[o] = w;
    FILC.p[o] = w > 0 ? filPattern(X, Y, Z, c, o, sig) / FIL_MEAN[o] : 1;
  }
  FILC.X = X; FILC.Y = Y; FILC.Z = Z; FILC.t = texel;
  return FILC;
}
// outskirts settlement dots (A02 fine warm dots between the corridors): three octaves of Worley nodes,
// ~59 % of them settlements of unequal size / brightness (mostly small, a few bright), prefiltered with
// the texel footprint like the filigree (energy kept); each octave normalised to mean 1
const BG_CELLS = [27000, 9000, 3000], BG_W = [0.40, 0.35, 0.25];
let BG_MEAN = null;
function bgDot(X, Y, Z, o, sig) {
  const c = BG_CELLS[o];
  const w = worley3(X / c + o * 11.3 + 5.1, Y / c - o * 9.1, Z / c + o * 4.7, 761 + o, 0.85, WF);
  if (((w.id >>> 11) & 255) >= 150) return 0;
  const u = ((w.id >>> 3) & 255) / 255;
  const town = 0.3 + 1.4 * u * u;
  const r = c * (0.035 + 0.05 * (((w.id >>> 19) & 255) / 255));
  const re2 = r * r + sig * sig, d = w.f1 * c;
  return town * (r * r / re2) * Math.exp(-d * d / re2);
}
function bgDots(X, Y, Z, texel) {
  if (!BG_MEAN) {
    BG_MEAN = [];
    for (let o = 0; o < BG_CELLS.length; o++) {
      let sum = 0; const n = 12000, c = BG_CELLS[o];
      for (let i = 0; i < n; i++) {
        const h = hash4(i, o, 5151, 3), h2 = hash4(i, o, 919, 13);
        sum += bgDot(((h & 0xffff) / 65536) * 40 * c, (((h >>> 16) & 0xffff) / 65536) * 40 * c, ((h2 & 0xffff) / 65536) * 40 * c, o, 0);
      }
      BG_MEAN.push(Math.max(1e-6, sum / n));
    }
  }
  const sig = FIL_SIG * texel;
  let s = 0;
  for (let o = 0; o < BG_CELLS.length; o++) {
    // octaves much smaller than the footprint average to their mean (1)
    const res = sat((BG_CELLS[o] / texel - 0.8) / 1.6);
    s += BG_W[o] * (res > 0 ? 1 + res * (bgDot(X, Y, Z, o, sig) / BG_MEAN[o] - 1) : 1);
  }
  return s;
}

/** mean-preserving filigree factor (1 where nothing is resolved); `on` = strength 0..1; `floor` mixes a
 *  uniform share back in (E = floor + (1 - floor)·1 = 1): the product of independent octaves alone is
 *  very sparse (≈3 % of the mean between corridors), right for the map's bead chains, too dark for the
 *  dense residential sparkle of A02 */
function lightFiligree(X, Y, Z, texel, on, floor = 0) {
  if (on <= 0) return 1;
  const F = filPrepare(X, Y, Z, texel);
  let g = 1;
  for (let o = 0; o < FIL_CELLS.length; o++) if (F.w[o] > 0) g *= 1 + F.w[o] * on * (F.p[o] - 1);
  return floor > 0 ? floor * on + (1 - floor * on) * g : g;
}

// ---------------------------------------------------------------------------------------------
// orbit-scale night light envelope from the emission control map (§4 图层接入: emission.png is the
// binding night-light tendency: radial city stars, corridor beads, sparse O-zone posts). It carries
// the night side where the texel aggregates whole regions (≥ ~2.5 km) and hands over to the urban
// plan's own light below ~0.5 km. In window units (mean; the filigree concentrates it into dots and
// corridors): full core (e = 1) ≈ 3.2 (peaks ≈ 10), corridor beads (e ≈ 0.45) ≈ 0.9, isolated O-zone
// posts (e ≈ 0.12) ≈ 0.1 (dots ≈ 0.4).
// ---------------------------------------------------------------------------------------------
const MAP_UNITS = 3.2, MAP_GAMMA = 1.65, MAP_FLOOR = 0.035;
function mapEmission(x, y, z) {
  const lat = Math.asin(y < -1 ? -1 : y > 1 ? 1 : y) * RAD, lon = Math.atan2(x, z) * RAD;
  let e = 0;
  try { e = emissionAt(lat, lon); } catch { e = 0; }
  return e > MAP_FLOOR ? (e - MAP_FLOOR) / (1 - MAP_FLOOR) : 0;
}

// orbit patchwork octaves (see shadeSurface): cell size (m), tone amplitude, street darkness
// fix round 2 (R4): the disc-resolved octaves (48 / 17 km) carry more tone and darker corridor lines, so a city belt
// reads as textured built fabric (districts of different roof stock, arterial / rail lines) instead of flat paint
const PW_CELLS = [48000, 17000, 6000, 2200], PW_AMP = [0.21, 0.17, 0.11, 0.08], PW_DARK = [0.44, 0.36, 0.25, 0.18];
const WPW = {};
function orbitPatchwork(X, Y, Z, texel, k, c) {
  let f = 1, warm = 0, dark = 0;
  for (let o = 0; o < PW_CELLS.length; o++) {
    const cs = PW_CELLS[o];
    const w = sat((cs / texel - 2.0) * 0.5);            // resolved from 2 texels per cell, full at 4
    if (w <= 0) continue;
    const wd = worley3(X / cs + o * 7.13, Y / cs - o * 3.31, Z / cs + o * 1.77, 751 + o, 0.9, WPW);
    f *= 1 + w * PW_AMP[o] * 2 * (((wd.id >>> 6) & 255) / 255 - 0.5);
    warm += w * 0.06 * (((wd.id >>> 15) & 255) / 255 - 0.5);
    // street / rail line along the patch border, prefiltered to ≥ 0.7 texel (never aliases)
    const e = (wd.f2 - wd.f1) * cs * 0.5;
    const sw = Math.max(texel * 0.8, cs * 0.018);
    dark = Math.max(dark, w * PW_DARK[o] * Math.exp(-(e * e) / (sw * sw)));
  }
  const fil = Math.min(2.5, lightFiligree(X, Y, Z, texel, 1));
  const g = (1 + k * (f - 1 + 0.05 * (fil - 1))) * (1 - k * dark) * (1 + 0.11 * k);   // + lift ≈ line loss
  c[0] *= g * (1 + k * warm); c[1] *= g; c[2] *= g * (1 - 1.2 * k * warm);
}

/**
 * Quay floodlight rows (mean 1): masts every 45 m along rows 160 m apart in the local east / north frame, a soft
 * 12 m pool each (energy kept, prefiltered by the texel footprint); averages to 1 once the rows are sub-texel.
 */
function portRows(x, y, z, X, Y, Z, texel) {
  const res = sat((90 - texel) / 60);
  if (res <= 0) return 1;
  const En = enu(x, y, z);
  const e = X * En[0] + Z * En[2], n = X * En[3] + Y * En[4] + Z * En[5];
  const de = (e / 45 - Math.floor(e / 45) - 0.5) * 45, dn = (n / 160 - Math.floor(n / 160) - 0.5) * 160;
  const r2 = 144, s2 = r2 + (0.35 * texel) * (0.35 * texel);
  const dots = (45 * 160 / (Math.PI * s2)) * Math.exp(-(de * de + dn * dn) / s2);
  return 1 + res * (0.35 + 0.65 * dots - 1);
}

// G01 protected harbour (DG): calm sheltered water of its own deep green-blue tint between the designed shore and the
// barrier arc, so the basin the barrier protects reads from orbit (the water mesh cannot resolve it at disc scales);
// soft edges of ≈ half a texel, coverage boosted at orbit texels so the ~11 × 4 km basin stays a visible spot.
// Fix round 3: the same lighter azure-turquoise as the water renderer's HARBOUR_TINT (render/water/material.js, linear
// 0.016 0.100 0.165), so the painted basin and the water mesh drawn over it agree at every distance
const G01S = SITES.tidalBarrier, HARBOUR_C = L(0.016, 0.100, 0.165), HLOC = {}, HUV = {};
const G01U = (() => { const la = G01S.lat * Math.PI / 180, lo = G01S.lon * Math.PI / 180; return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)]; })();
function harbourTint(x, y, z, texel, c) {
  const dx = x - G01U[0], dy = y - G01U[1], dz = z - G01U[2];
  if ((dx * dx + dy * dy + dz * dz) * R * R > (22000 + texel) * (22000 + texel)) return;
  unitToLocal(G01S, x, y, z, HLOC); g01ToUV(HLOC.x, HLOC.z, HUV);
  const u = HUV.u, v = HUV.v, A = G01_GEO.arc;
  const e = Math.max(texel * 0.5, 40);
  const sv = g01ShoreV(u), av = g01ArcV(u);
  const cov = smoothstep(A.half + e, A.half - e, Math.abs(u)) * smoothstep(sv - e, sv + e, v) * smoothstep(av + e, av - e, v);
  if (cov <= 0) return;
  lerpTo(c, HARBOUR_C, Math.min(1, cov * (1 + 1.5 * smoothstep(1500, 5000, texel))) * 0.85);
}

// ---------------------------------------------------------------------------------------------
// O-zone irrigation network at orbit (§1 「富氧水网呈蓝色树枝，沿枝条两侧长出颜色深浅不同的耕地，过了灌溉末端
// 便露出粗糙的赤土」, fix round 3 QA2P-02 / QP-07). The real canals (40–120 m mains, laterals ≤ 7.5 km) are far below
// an orbit texel, and the coarse terrain / urban samples only carry their expectation (uniform farm share, lattice
// blobs). Here the order-0 main canals of world/terrain/irrigation.js are drawn exactly where they run (same nodes,
// parents and bent segment geometry as hydro.canalsInTile), with a visual width that grows with the drainage area
// (accumulated upstream nodes → dendritic trees: thin twigs, wide trunks) and shrinks back to the real width as the
// texel resolves them; the farmland is the statistical irrigated share along each main (laterals of the main's node
// reach on both sides), toned by the distance to the canal and by field blocks of different crop stages; beyond the
// irrigation ends the ground is bare, rough red earth (no farm soil). Widths are in metres and every term is an
// area average over the texel (box-prefiltered lines), so neighbouring tile levels agree at orbit (L2 / L3).
// ---------------------------------------------------------------------------------------------
const NET_S0 = 18000;                                    // irrigation.js S0 (planning cell)
const NET_LATMAX = 7500;                                 // irrigation.js LAT_MAX (longest lateral)
const NET_W1 = 900, NET_WP = 0.9, NET_WMAX = 12000;    // m: visual width of a leaf main at orbit × acc^0.9 (≤ 12 km)
const NET_LIM = NET_S0 * 0.8 + 10000;                    // cell list radius (line half-width + farm reach)
const NETW = { seg: new Map(), cell: new Map(), acc: new Map(), outlet: undefined };
const nkey = (f, i, j) => (f * 1024 + i) * 1024 + j;
const NBC = { f: 0, i: 0, j: 0 }, VFS = {}, VFQ = {};
/** neighbour planning cell across face edges (replica of irrigation.js neighbour) */
function netNeighbour(f, i, j, di, dj) {
  const ii = i + di, jj = j + dj;
  if (ii >= 0 && jj >= 0 && ii < CN0 && jj < CN0 && -1 + (ii + 0.5) * CDA0 < 1 && -1 + (jj + 0.5) * CDA0 < 1) { NBC.f = f; NBC.i = ii; NBC.j = jj; return NBC; }
  faceToVec(f, -1 + (ii + 0.5) * CDA0, -1 + (jj + 0.5) * CDA0, VFS);
  vecToFace(VFS.x, VFS.y, VFS.z, VFS);
  NBC.f = VFS.face;
  NBC.i = Math.min(CN0 - 1, Math.max(0, Math.floor((VFS.a + 1) / CDA0)));
  NBC.j = Math.min(CN0 - 1, Math.max(0, Math.floor((VFS.b + 1) / CDA0)));
  return NBC;
}
const sameNode = (p, f, i, j) => p.f === f && p.i === i && p.j === j;
/** active neighbours draining into n */
function netChildren(n) {
  const out = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const nb = netNeighbour(n.f, n.i, n.j, di, dj);
    if (sameNode(nb, n.f, n.i, n.j)) continue;
    const m = node0(nb.f, nb.i, nb.j);
    if (!m.act) continue;
    const p = parent0(m);
    if (!p || !sameNode(p, n.f, n.i, n.j)) continue;
    let dup = false;
    for (let q = 0; q < out.length; q++) if (sameNode(out[q], m.f, m.i, m.j)) { dup = true; break; }
    if (!dup) out.push(m);
  }
  return out;
}
/** accumulated node count of the tree upstream of n (n included): iterative post-order, memoised */
function netAcc(n) {
  const memo = NETW.acc;
  const k0 = nkey(n.f, n.i, n.j);
  const v0 = memo.get(k0);
  if (v0 !== undefined) return v0;
  const stack = [{ n, k: k0, kids: null, idx: 0, sum: 1 }];
  const open = new Set([k0]);
  while (stack.length) {
    const fr = stack[stack.length - 1];
    if (!fr.kids) fr.kids = netChildren(fr.n);
    if (fr.idx < fr.kids.length) {
      const c = fr.kids[fr.idx++];
      const kc = nkey(c.f, c.i, c.j);
      const vc = memo.get(kc);
      if (vc !== undefined) { fr.sum += vc; continue; }
      if (open.has(kc) || stack.length > 6000) continue;          // no cycles by construction (P decreases)
      open.add(kc);
      stack.push({ n: c, k: kc, kids: null, idx: 0, sum: 1 });
      continue;
    }
    memo.set(fr.k, fr.sum);
    stack.pop();
    if (stack.length) stack[stack.length - 1].sum += fr.sum;
  }
  return memo.get(k0);
}
/** bent main segment in its gnomonic frame (replica of irrigation.js makeSeg) */
function netSegGeom(A, B, width, bend) {
  const ax = A[0], ay = A[1], az = A[2], bx = B[0], by = B[1], bz = B[2];
  let mx = ax + bx, my = ay + by, mz = az + bz; const ml = Math.hypot(mx, my, mz); mx /= ml; my /= ml; mz /= ml;
  let ex = mz, ez = -mx; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  const nx = my * ez, ny = mz * ex - mx * ez, nz = -my * ex;
  const pa = 1 / (ax * mx + ay * my + az * mz), pb = 1 / (bx * mx + by * my + bz * mz);
  const s = {
    w: width, mx, my, mz, ex, ez, nx, ny, nz,
    ax: (ax * ex + az * ez) * pa * R, ay: (ax * nx + ay * ny + az * nz) * pa * R,
    bx: (bx * ex + bz * ez) * pb * R, by: (bx * nx + by * ny + bz * nz) * pb * R,
    len: 1, ux: 0, uy: 0, bend: 0, acc: 1, farm: 0, reach: 0, wv: 0,
  };
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  s.len = Math.hypot(dx, dy) || 1; s.ux = dx / s.len; s.uy = dy / s.len;
  if (bend) {
    const h = ihash3(Math.round(ax * 1e6), Math.round(ay * 1e6), Math.round(az * 1e6), 0x77);
    s.bend = (iu01(irehash(h, 9)) - 0.5) * 0.24 * s.len;
  }
  return s;
}
/** distance (m) from a unit vector to a (bent) segment (replica of irrigation.js segDist) */
function netSegDist(s, x, y, z) {
  const dot = x * s.mx + y * s.my + z * s.mz;
  if (dot < 0.95) return 1e9;
  const ip = R / dot;
  const px = (x * s.ex + z * s.ez) * ip, py = (x * s.nx + y * s.ny + z * s.nz) * ip;
  const qx = px - s.ax, qy = py - s.ay;
  const al = qx * s.ux + qy * s.uy;
  const t = al / s.len;
  if (t <= 0) return Math.hypot(qx, qy);
  if (t >= 1) return Math.hypot(px - s.bx, py - s.by);
  const cr = -qx * s.uy + qy * s.ux - s.bend * Math.sin(Math.PI * t);
  const sl = s.bend * Math.PI / s.len * Math.cos(Math.PI * t);
  return Math.abs(cr) / Math.sqrt(1 + sl * sl);
}
function netFinish(s, acc, farm) {
  s.acc = acc; s.farm = farm;
  s.reach = NET_LATMAX * Math.min(1, Math.max(0, 0.35 + farm * 0.75)) * 0.92;   // mean lateral angle ≈ 67–113°
  s.wv = Math.min(NET_WMAX, NET_W1 * Math.pow(acc, NET_WP));
  return s;
}
function netSeg(n) {
  const k = nkey(n.f, n.i, n.j);
  let s = NETW.seg.get(k);
  if (s !== undefined) return s;
  s = null;
  if (n.act) {
    const p = parent0(n);
    if (p) s = netFinish(netSegGeom([n.x, n.y, n.z], [p.x, p.y, p.z], n.w, true), netAcc(n), n.farm);
  }
  if (NETW.seg.size > 120000) NETW.seg.clear();
  NETW.seg.set(k, s);
  return s;
}
function netOutlet() {
  if (NETW.outlet !== undefined) return NETW.outlet;
  NETW.outlet = null;
  try {
    const o = outletSeg();
    const s = { w: o.w, mx: o.mx, my: o.my, mz: o.mz, ex: o.ex, ez: o.ez, nx: o.nx, ny: o.ny, nz: o.nz, ax: o.ax, ay: o.ay, bx: o.bx, by: o.by,
      len: o.len, ux: o.ux, uy: o.uy, bend: o.bend || 0, acc: 1, farm: 1, reach: 0, wv: 0 };
    NETW.outlet = netFinish(s, 2, 1);
  } catch { NETW.outlet = null; }
  return NETW.outlet;
}
/** main segments within NET_LIM of a planning cell (cached per cell) */
function netCell(f, i, j) {
  const k = nkey(f, i, j);
  let L = NETW.cell.get(k);
  if (L) return L;
  if (NETW.cell.size > 24000) NETW.cell.clear();
  L = [];
  faceToVec(f, Math.min(1, -1 + (i + 0.5) * CDA0), Math.min(1, -1 + (j + 0.5) * CDA0), VFS);
  const cx = VFS.x, cy = VFS.y, cz = VFS.z;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const nb = netNeighbour(f, i, j, di, dj);
    const n = node0(nb.f, nb.i, nb.j);
    if (!n.act) continue;
    const s = netSeg(n);
    if (!s || L.indexOf(s) >= 0) continue;
    if (netSegDist(s, cx, cy, cz) < NET_LIM) L.push(s);
  }
  const os = netOutlet();
  if (os && os.mx * cx + os.my * cy + os.mz * cz > 0.99 && netSegDist(os, cx, cy, cz) < NET_LIM) L.push(os);
  NETW.cell.set(k, L);
  return L;
}
/** box-filtered coverage of a texel (width t) by a straight band of width w whose centre line is d away */
function bandCover(d, w, t) {
  const lo = Math.max(d - t * 0.5, -w * 0.5), hi = Math.min(d + t * 0.5, w * 0.5);
  return hi > lo ? (hi - lo) / t : 0;
}
/** share of the land at distance d (m) from a main that its laterals irrigate (statistics of irrigation.js:
 *  the main's own band ±~2.6 km, laterals every 1.2 km on both sides, 88 % present, lengths reach·(0.16..1)·u^0.8,
 *  each irrigating ≈ ±1 km) */
function irrigatedShare(d, reach) {
  const main = smoothstep(3300, 1500, d);
  const x = (d - 700) / Math.max(1, reach);
  const pl = x <= 0.16 ? 1 : x >= 1 ? 0 : 1 - Math.pow((x - 0.16) / 0.84, 1.25);
  return Math.max(main, 0.8 * pl);
}
const NQ = { d: 1e9, reach: 0, farm: 0, line: 0, acc: 0, any: false };
/** nearest main + combined canal line coverage at a texel; exag 0..1 scales the orbit widths */
function netQuery(x, y, z, texel, exag) {
  NQ.d = 1e9; NQ.reach = 0; NQ.farm = 0; NQ.line = 0; NQ.acc = 0; NQ.any = false;
  vecToFace(x, y, z, VFQ);
  const i = Math.min(CN0 - 1, Math.max(0, Math.floor((VFQ.a + 1) / CDA0))), j = Math.min(CN0 - 1, Math.max(0, Math.floor((VFQ.b + 1) / CDA0)));
  const L = netCell(VFQ.face, i, j);
  if (!L.length) return NQ;
  NQ.any = true;
  let keep = 1;
  const t = Math.max(texel, 1);
  for (let q = 0; q < L.length; q++) {
    const s = L[q];
    const d = netSegDist(s, x, y, z);
    if (d < NQ.d) { NQ.d = d; NQ.reach = s.reach; NQ.farm = s.farm; NQ.acc = s.acc; }
    const w = Math.max(s.w, exag * s.wv);
    if (d < w * 0.5 + t) { const c = bandCover(d, w, t); if (c > 0) keep *= 1 - c; }
  }
  NQ.line = 1 - keep;
  return NQ;
}
// orbit farmland palette (linear): lush canal-side belts → grown fields → lighter ripening fields toward the irrigation
// end; field blocks of different stages (grown / young / harvested / flooding) on top
const OF_LUSH = L(0.042, 0.110, 0.030), OF_GROWN = L(0.080, 0.160, 0.042), OF_RIPE = L(0.155, 0.195, 0.062);
const OF_STAGE = [L(0.070, 0.160, 0.040), L(0.150, 0.235, 0.070), L(0.300, 0.250, 0.110), L(0.040, 0.095, 0.100)];
const OF_PADDY = L(0.040, 0.105, 0.085), OF_ORCH = L(0.030, 0.085, 0.030);
const ORBIT_CANAL = L(0.030, 0.120, 0.270);          // azure canal water seen from orbit (reads blue on green / red, like the seas)
const FB_CELLS = [9000, 3200], FB_W = [0.7, 0.3], WFB = {};
/** orbit farmland colour at distance-to-canal fraction u (0 canal … 1 irrigation end) */
function orbitFarmColour(X, Y, Z, texel, u, prov, out) {
  mix3(out, OF_LUSH, OF_GROWN, smoothstep(0.05, 0.35, u));
  lerpTo(out, OF_RIPE, smoothstep(0.40, 0.95, u) * 0.85);
  if (prov === 3) lerpTo(out, OF_PADDY, 0.45 * (1 - smoothstep(0.3, 0.8, u)));          // OX3 赤岸围垦地: wet paddies
  else if (prov === 5) lerpTo(out, OF_ORCH, 0.35 * (1 - smoothstep(0.2, 0.7, u)));      // OX5 terraces / orchards
  // field blocks of different stages (resolved from 2 texels per cell; unresolved octaves = their mean)
  let r = 0, g = 0, b = 0, wsum = 0;
  for (let o = 0; o < FB_CELLS.length; o++) {
    const cs = FB_CELLS[o];
    const wr = sat((cs / texel - 2.0) * 0.5) * FB_W[o];
    if (wr <= 0) continue;
    const w = worley3(X / cs + o * 5.31, Y / cs - o * 2.77, Z / cs + o * 9.13, 741 + o, 0.9, WFB);
    const hsh = (w.id >>> 5) & 255;
    const flood = prov === 3 ? 90 : 30;
    const st = hsh < 115 ? 0 : hsh < 175 ? 1 : hsh < 255 - flood ? 2 : 3;
    const c = OF_STAGE[st];
    r += c[0] * wr; g += c[1] * wr; b += c[2] * wr; wsum += wr;
  }
  if (wsum > 0) {
    // stage colour relative to its expectation (mean preserving): E ≈ 0.45 grown + 0.24 young + 0.19 harvested + 0.12 flood
    const k = 0.85 * wsum;
    const er = 0.45 * OF_STAGE[0][0] + 0.24 * OF_STAGE[1][0] + 0.19 * OF_STAGE[2][0] + 0.12 * OF_STAGE[3][0];
    const eg = 0.45 * OF_STAGE[0][1] + 0.24 * OF_STAGE[1][1] + 0.19 * OF_STAGE[2][1] + 0.12 * OF_STAGE[3][1];
    const eb = 0.45 * OF_STAGE[0][2] + 0.24 * OF_STAGE[1][2] + 0.19 * OF_STAGE[2][2] + 0.12 * OF_STAGE[3][2];
    out[0] *= 1 + k * (r / wsum / er - 1); out[1] *= 1 + k * (g / wsum / eg - 1); out[2] *= 1 + k * (b / wsum / eb - 1);
  }
  return out;
}
// OX1 东泽汇水盆地 floor (fix round 3, terrain-fn's basin.js): the floor between the lake and the escarpments was flat
// natural sand. Now: a damp reed / meadow belt along the lake shore (green-olive, patchy), darker damp silt behind it,
// then dry alluvium of mixed tones (pale silt fans, darker gravel lag, red dust) rising toward the tablelands.
const OX1U = (() => { const la = OX1_BASIN.lat * Math.PI / 180, lo = OX1_BASIN.lon * Math.PI / 180; return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)]; })();
const OX1_DOT = Math.cos(40000 / R);
const BF_REED = L(0.058, 0.092, 0.034), BF_SILT = L(0.105, 0.072, 0.048), BF_FAN = L(0.40, 0.255, 0.145), BF_LAG = L(0.17, 0.095, 0.060);
function basinFloor(x, y, z, X, Y, Z, texel, h, steep, c) {
  if (x * OX1U[0] + y * OX1U[1] + z * OX1U[2] < OX1_DOT) return;
  const bm = basinMask(x, y, z);
  const w = bm.inner * (1 - bm.tab) * (1 - steep);
  if (w < 0.01) return;
  const above = h - OX1_BASIN.level;
  // shore belts: reeds / meadow within ~0–8 m above the lake, damp silt to ~16 m
  const n1 = bandFbm(NE, X + 1.7e5, Y, Z - 0.9e5, 1600, 6, 0.6, texel);
  const n2 = bandFbm(NB, X - 2.3e5, Y + 1.1e5, Z, 2600, 5, 0.58, texel);
  const reed = smoothstep(8 + 4 * n1, 0.6, above) * smoothstep(-0.5, 0.4, above) * sat(0.62 + 0.55 * n1);
  const damp = smoothstep(18 + 6 * n2, 4, above) * (1 - reed);
  // dry alluvium: pale silt fans vs darker gravel lag (zero-mean tone field, resolved octaves only)
  mix3(TMP3, BF_LAG, BF_FAN, sat(0.5 + 0.9 * n2));
  lerpTo(c, TMP3, w * 0.45 * (1 - reed - damp));
  lerpTo(c, BF_SILT, w * damp * 0.7);
  if (reed > 0) {
    mix3(TMP3, BF_REED, P.trees, sat(0.35 - 0.6 * n1) * 0.6);
    lerpTo(c, TMP3, w * reed * 0.85);
  }
}

// ZR2 西陆峡廊 at orbit (fix round 3, Z-05: the 2–7 km wide canyon was sub-pixel at the disc and the white city paint
// swallowed it): the canyon lines of world/terrain/layout.js (main stem + tributaries; side canyons stay true) are drawn
// as a red-rock band of visual half-width max(true, exag·5.2 km main / 3.4 km tributaries) over the city paint —
// shadowed walls and benches (A03: red veins cutting the silver fabric). Same exaggeration ramp as the canals.
const CANYON_ORBIT = L(0.135, 0.044, 0.024), CANYON_RIM = L(0.30, 0.10, 0.045);
function orbitCanyon(x, y, z, lat, lon, texel, ex) {
  const n = queryLines(x, y, z, lat, lon);
  if (!n) return 0;
  let keep = 1;
  const t = Math.max(texel, 1);
  for (let k = 0; k < n; k++) {
    const ld = LINE_DATA[LHIT.line[k]];
    if (!ld || ld.kind !== 'canyon' || (ld.line && ld.line.side)) continue;
    const hw = lineParam(ld, 'hw', LHIT.v[k]) * 1000;
    const hv = Math.max(hw, ex * (ld.id === 'zr2-main' ? 5200 : 3400) * Math.min(1, hw / 1200));
    const d = Math.abs(LHIT.d[k]);
    if (d > hv + t) continue;
    const c = bandCover(d, 2 * hv, t);
    if (c > 0) keep *= 1 - c;
  }
  return 1 - keep;
}

/** diagnostics / tools: the orbit network around a point */
export function orbitCanalQuery(x, y, z, texel = 2600) {
  const q = netQuery(x, y, z, texel, orbitExag(texel));
  return { ...q, share: q.any ? sat(q.farm * 1.15) * irrigatedShare(q.d, q.reach) : 0 };
}
/** orbit exaggeration of the canal widths: 1 from 2.6 km texels (disc), log-linear down to the real width at 400 m
 *  texels (regional / grazing views — the far tiles of a 3 km high oblique — keep true canal widths) */
function orbitExag(texel) { return sat(Math.log2(Math.max(1, texel) / 400) / Math.log2(2600 / 400)); }

/** night light colour for a light temperature (0 warm … 1 cold); material.js trLightColour mirrors it */
export function lightColour(temp, out) {
  mix3(out, LIGHT_WARM, LIGHT_NEUTRAL, smoothstep(0.30, 0.68, temp));
  if (temp > 0.68) lerpTo(out, LIGHT_COLD, smoothstep(0.68, 0.95, temp));
  return out;
}

// ---------------------------------------------------------------------------------------------
// water column tint (sea floor / submerged canal & lake beds) as seen from above
// ---------------------------------------------------------------------------------------------
function waterTint(depth, out) {
  // teal only over the first metres (orbit: wide shallow shelves must not read as a turquoise ribbon,
  // A03 keeps the cobalt close to the shore)
  if (depth < 3) mix3(out, P.seaShallow, P.seaMid, smoothstep(0, 3, depth) * 0.3);
  else if (depth < 40) mix3(out, P.seaShallow, P.seaMid, 0.3 + 0.7 * smoothstep(3, 40, depth));
  else mix3(out, P.seaMid, P.seaDeep, smoothstep(40, 700, depth));
}

// ---------------------------------------------------------------------------------------------
// urban fallback palette (when urbanSample gives no fabric colour)
// ---------------------------------------------------------------------------------------------
function roofColour(U, out) {
  const k = num(U.roofKind, ROOF.CERAMIC) | 0, tone = sat(num(U.roof, 0.8));
  const c = ROOF_COLOR[k] || P.roofCeramic;
  set3(out, c);
  if (c === P.roofCeramic || c === P.roofMembrane || c === P.roofInsulated) mul3(out, 0.82 + 0.22 * tone);
}
function classColour(cls, U, out) {
  switch (cls) {
    case CLS.ROAD_ART: case CLS.ROAD_LOCAL: case CLS.BRIDGE: set3(out, P.asphalt); return true;
    case CLS.LANE: set3(out, P.lane); return true;
    case CLS.PARKING: set3(out, P.parking); return true;
    case CLS.RAIL: set3(out, P.rail); return true;
    case CLS.SIDEWALK: set3(out, P.sidewalk); return true;
    case CLS.PLAZA: set3(out, P.plaza); return true;
    case CLS.ROOF: roofColour(U, out); return true;
    case CLS.YARD: set3(out, P.yard); return true;
    case CLS.PARK: case CLS.TREE_ROW: set3(out, P.park); return true;
    case CLS.SPORTS: set3(out, P.pitch); return true;
    case CLS.FARM: { const c = CROP[num(U.farmCrop, 3) | 0] || CROP[3]; set3(out, c[(num(U.farmStage, 0) | 0) & 3]); return true; }
    case CLS.FARM_ROAD: set3(out, P.farmRoad); return true;
    case CLS.GREENHOUSE: set3(out, P.greenhouse); return true;
    case CLS.DOCK: set3(out, P.dock); return true;
    case CLS.PIER: set3(out, P.pier); return true;
    case CLS.INDUSTRIAL: set3(out, P.industrial); return true;
    case CLS.CANAL_BANK: set3(out, P.bank); return true;
    case CLS.SOLAR: set3(out, P.solar); return true;
    case CLS.BARRIER: set3(out, P.barrier); return true;
    case CLS.PIPE: set3(out, P.pipe); return true;
    default: return false;
  }
}

// ---------------------------------------------------------------------------------------------
// main combine
// ---------------------------------------------------------------------------------------------
export const SHADE_CTX = {
  slope: 0,            // 1 - (n · up) of the texel normal (0 flat .. 1 vertical)
  ao: -1,              // building / terrain sky visibility 0..1 from the tile builder (-1 = derive from U)
  waterFrac: -1,       // fraction of the texel below the water level (-1 = derive from W)
  depth: 0,            // water level - ground height at the texel centre (m)
  waterResolved: true, // the water renderer's mesh shows this water body (paint the bed, not water)
  canalResolved: true, // same for canals (narrow canals are painted into the texture)
  coastal: true,       // legacy beach band allowed (terrain without beach weights)
  texelRef: 0,         // nominal texel of the tile level (256² texel; 0 = texelMeters): scale looks (orbit canals)
};

/** affine colour grade of the urban fabric (commutes with area averaging → scale consistent).
 *  A03 reads the built-up land as a pale silver-cream sheet clearly brighter than the oxidised
 *  rock: lift the luminance (neutral part more than the chroma, so greens stay green), slightly
 *  warm, greens a little less saturated. Pale ceramic roofs / paving dominate the fabric. */
function gradeUrban(c, built) {
  const r = c[0], g = c[1], b = c[2];
  const gn = 0.82 * g + 0.09 * (r + b);
  const m = (r + gn + b) * (1 / 3);
  c[0] = r * 1.14 + m * 0.30 + 0.014; c[1] = gn * 1.12 + m * 0.30 + 0.013; c[2] = b * 1.06 + m * 0.30 + 0.011;
  // pale ceramic / paving lift of the BUILT share (A03: the city sheet reads ~3× brighter than the
  // oxidised rock): strongest on mid tones, fading towards white so roofs and sidewalks keep their
  // contrast instead of clipping; greens (parks, yards, farms) are not lifted
  const k = 0.55 * sat(built);
  if (k > 0) for (let i = 0; i < 3; i++) c[i] *= 1 + k * Math.max(0, 1 - c[i] / 0.95);
}

export function shadeSurface(x, y, z, texel, T, U, W, ctx, out) {
  ctx = ctx || SHADE_CTX;
  const X = x * R, Y = y * R, Z = z * R;
  const alb = out.albedo || (out.albedo = [0, 0, 0]);
  const emi = out.emission || (out.emission = [0, 0, 0]);
  let gloss = 0, wet = sat(num(T.wet, 0)), ao = 1;

  // ---------------- O-zone irrigation network at orbit (fix round 3, see netQuery): farm share along the mains,
  // canal lines, rough red earth beyond the irrigation ends. kF = weight of the orbit farmland representation
  // (replaces the urban plan's coarse farm share and the uniform farm soil), kL = canal line weight.
  let kF = 0, kL = 0, fOrb = 0, uOrb = 1, oLine = 0, oZone = 0, oProv = 0, canyonA = 0;
  NAT_OVR.on = false;
  const tRef = num(ctx.texelRef, 0) > 0 ? ctx.texelRef : texel;
  if (tRef > 150) {
    const lat = Math.asin(y < -1 ? -1 : y > 1 ? 1 : y) * RAD, lon = Math.atan2(x, z) * RAD;
    // ZR2 canyon band at orbit (Z-05)
    if (tRef > 400) { try { canyonA = orbitCanyon(x, y, z, lat, lon, texel, orbitExag(tRef)) * orbitExag(tRef); } catch { canyonA = 0; } }
    try { oZone = zoneSmooth(lat, lon); } catch { oZone = 0; }
    if (oZone > 0.02) {
      const ex = orbitExag(tRef);
      const q = netQuery(x, y, z, texel, ex);
      kF = smoothstep(300, 1600, tRef) * smoothstep(0.25, 0.65, oZone);
      if (q.any) { kL = smoothstep(150, 350, tRef); oLine = q.line; }
      if (kF > 0) {
        const rock = sat(num(T.rock, 0)), ice = sat(num(T.ice, 0));
        if (q.any) {
          try { oProv = provinceAt(lat, lon); } catch { oProv = 0; }
          const slope = num(ctx.slope, num(T.slopeHint, 0) * 0.3);
          // farmable ground only (the coarse terrain's rock weight ≈ 0.5 on the farm plains is not a mask; tablelands /
          // mesas > 0.75 are)
          const local = (1 - smoothstep(0.72, 0.95, rock)) * (1 - ice) * (1 - smoothstep(0.08, 0.25, slope)) * (1 - sat(num(T.seafloor, 0)));
          // statistical irrigated share (≈ the street-level farmland averaged over the texel); at disc scales the
          // irrigated belts are widened to the laterals' full reach (art direction, same exaggeration ramp as the canal
          // widths) so the farmland reads as continuous green along the branches, the red earth beyond their ends
          const share = irrigatedShare(q.d, q.reach), wide = smoothstep(q.reach + 2500, 0.55 * q.reach, q.d);
          fOrb = sat(q.farm * (1.15 + 0.5 * ex)) * (share + (Math.max(share, wide) - share) * ex * 0.85) * local;
          uOrb = sat(q.d / (q.reach + 1000));
        }
        // no canal within reach → no farm soil (bare red earth), as at street level
        NAT_OVR.on = true;
        const soil = sat(num(T.soil, 0));
        NAT_OVR.soil = soil + kF * (fOrb * (1 - rock * 0.5) * (1 - ice) - soil);
      }
    }
  }

  const iceW = naturalColour(x, y, z, X, Y, Z, texel, T, ctx, NAT);
  NAT_OVR.on = false;
  basinFloor(x, y, z, X, Y, Z, texel, num(T.h, 0), smoothstep(0.09, 0.28, num(ctx.slope, num(T.slopeHint, 0) * 0.3)), NAT);
  set3(BED, NAT);                                   // natural bed (for water tint)

  // ---------------- urban layer
  let urbanCover = 0, uFar = 0, uStreet = 0, uTemp = 0.2, lightAll = 0, uPort = 0, hasPort = false;
  emi[0] = emi[1] = emi[2] = 0; out.onset = 0.5;
  if (U) {
    const cls = num(U.cls, CLS.NATURAL) | 0;
    const cov = sat(num(U.coverage, 0));
    const H = Math.max(0, num(U.height, 0));
    let fabric = -1;
    if (typeof U.fabric === 'number' && U.fabric === U.fabric) {
      fabric = sat(U.fabric);
      URB[0] = num(U.fabricR, 0.3); URB[1] = num(U.fabricG, 0.3); URB[2] = num(U.fabricB, 0.3);
      if (fabric > 0 && URB[0] + URB[1] + URB[2] <= 0) { if (!classColour(cls, U, URB)) roofColour(U, URB); }
    } else if (classColour(cls, U, URB)) fabric = 1;
    else if (cov > 0) { roofColour(U, URB); fabric = Math.min(1, cov * 2); }
    if (fabric > 0) {
      const green = sat(num(U.green, 0)), farmF = sat(num(U.farm, 0));
      const builtShare = Math.max(0, 1 - green - farmF);
      gradeUrban(URB, cls === CLS.FARM || cls === CLS.PARK || cls === CLS.TREE_ROW || cls === CLS.SPORTS || cls === CLS.CANAL_BANK ? 0 : builtShare);
      // neighbourhood variation (towns / quarters / blocks of different age): band-limited, mean
      // preserving, only on the built (non-green) fabric. 120 km .. 2 texels.
      if (builtShare > 0.05) {
        const nv = bandFbm(NF, X, Y, Z, 120000, 7, 0.62, texel);
        const nw = bandFbm(NF, X + 3.1e5, Y - 1.7e5, Z, 6000, 5, 0.6, texel);
        const k = 1 + builtShare * (0.09 * nv + 0.06 * nw);
        URB[0] *= k * (1 + 0.025 * nw); URB[1] *= k; URB[2] *= k * (1 - 0.03 * nw);
      }
      // district mosaic softening: the urban plan tones every district by ≈ (0.92 + 0.16·tone) at all
      // levels (district colour, blocks, roofs); about half of that patchwork is taken back here, at every
      // texel size alike (a texel-size dependent correction would itself draw seams between tile levels),
      // so neighbouring districts read as one city at 100 km instead of a hard mosaic
      if (builtShare > 0.05) mul3(URB, 1 - 0.075 * (sat(num(U.districtTone, 0.5)) - 0.5) * builtShare);
      // orbit-scale city texture (A03 银白城带): the texel holds a whole quarter (≥ 0.7 km), whose mean
      // alone reads as flat paint. Variance-preserving texture instead: a hierarchical patchwork of
      // quarters of different age / roof stock (world-anchored cells 48 / 17 / 6 / 2.2 km, gentle
      // ±8–10 % tones, a little warm / cool) with darker streets / rails between the patches (≈ 0.7 texel
      // wide, every octave only once it spans ≥ 2–4 texels), plus the pale transit hubs of the night
      // filigree network (bright night cores sit on pale day hubs). Fades out where the urban raster
      // resolves its own districts and blocks (texel < ~1.5 km; wide ramp = small steps between levels).
      if (builtShare > 0.05 && texel > 500) orbitPatchwork(X, Y, Z, texel, builtShare * smoothstep(500, 3200, texel), URB);
      // roof tone per parcel (resolved only: mean preserving)
      if (cls === CLS.ROOF && texel < 40) {
        const pid = num(U.parcelId, 0) | 0;
        if (pid) {
          const hh = hash4(pid, 91, 7, 0);
          const tv = ((hh & 1023) / 1023 - 0.5) * 0.16 * resolved(14, texel);
          mul3(URB, 1 + tv);
        }
      }
      // unresolved street canyons / building shadow (coarse texels): tall dense districts read
      // darker-textured; resolved texels get the neighbour-height AO from the tile builder instead
      if (cov > 0.02 && ctx.ao < 0) {
        const canyon = H / (H + 22);
        const kk = 1 - 0.18 * canyon * Math.min(1, cov * 2.5) * (1 - 0.5 * cov) * smoothstep(3, 30, texel);
        mul3(URB, kk);
      }
      // green areas (parks, yards, tree belts): tree crowns / groves / lawns. The vegetation factor
      // averages to 1 over unresolved scales, so the area mean stays the urban fabric colour
      if (green > 0.08) {
        const kind = cls === CLS.TREE_ROW ? 2 : (cls === CLS.YARD ? 1 : 0);
        vegetationFactor(x, y, z, X, Y, Z, texel, kind, VEG);
        const g = Math.min(1, green * 1.1);
        URB[0] *= 1 + (VEG[0] - 1) * g; URB[1] *= 1 + (VEG[1] - 1) * g; URB[2] *= 1 + (VEG[2] - 1) * g;
      }
      // fine material texture (mean preserving)
      if (texel < 1.0) fineUrban(cls, U, x, y, z, X, Y, Z, texel, URB);
      // ragged fringes and satellite clusters at orbit: the built share of fringe texels is modulated
      // by a band-limited field (zero mean), so city edges break up instead of ending in a hard line
      if (texel > 500 && fabric < 0.9) {
        const n = bandFbm(NF, X - 2.7e5, Y + 1.9e5, Z, 26000, 4, 0.6, texel);
        fabric = sat(fabric * (1 + smoothstep(500, 3500, texel) * 2.2 * n * Math.max(0.15, 1 - fabric)));
      }
      // steep ground keeps its rock colour (canyon walls, reservoir cliffs): no urban paint on cliffs
      // (+ the terrain's fine slope hint: a near-vertical face narrower than two vertex spacings barely tilts the
      // interpolated vertex normals, and urban roads / parks were painted down coastal cliffs — S05)
      const steepU = Math.max(smoothstep(0.25, 0.6, num(ctx.slope, 0)), smoothstep(0.6, 1.0, num(T.cliff, 0)), smoothstep(0.55, 0.9, num(T.slopeHint, 0)), iceCliffShare(T, num(ctx.slope, 0)));
      if (steepU > 0) fabric *= 1 - steepU;
      // orbit O zones: the urban plan's coarse farm share (lattice blobs) gives way to the network farmland below
      if (kF > 0) fabric = Math.max(0, fabric - kF * Math.min(fabric, sat(num(U.farm, 0)) * (fabric > 0 ? 1 : 0)));
      lerpTo(NAT, URB, fabric);
      urbanCover = fabric;
      // specular share: glass roofs / greenhouses / solar / metal (area-weighted at coarse texels)
      const rk = num(U.roofKind, -1) | 0;
      if (cls === CLS.GREENHOUSE || (cls === CLS.ROOF && (rk === ROOF.GLASS || rk === ROOF.SOLAR))) gloss = Math.max(gloss, 0.62 * fabric);
      else if (cls === CLS.ROOF && rk === ROOF.METAL) gloss = Math.max(gloss, 0.32 * fabric);
      else if (cls === CLS.SOLAR) gloss = Math.max(gloss, 0.58 * fabric);
      else if (texel > 6) {
        const lu = num(U.landUse, 0) | 0;
        if (rk === ROOF.GLASS || lu === LUSE.GREENHOUSE) gloss = Math.max(gloss, 0.36 * cov * fabric);
        else if (rk === ROOF.METAL || lu === LUSE.INDUSTRIAL || lu === LUSE.PORT) gloss = Math.max(gloss, 0.16 * cov * fabric);
      }
    }
    // building occlusion (fine texels: neighbourhood AO from the tile builder)
    if (ctx.ao >= 0) ao = ctx.ao;
    else ao = 1 - 0.32 * (H / (H + 20)) * Math.min(1, cov * 3) * (1 - 0.5 * cov);
    // night light (window units, see STREET_UNITS / FAR_UNITS): street-level light (lightGround: streets,
    // plazas, quays; excludes facades / roofs) and the window aggregate of the fabric. Both are area
    // averages of the urban plan (linear → consistent across texel sizes); at orbit texels the window
    // aggregate gets the mean-preserving filigree (lit corridors / town dots) and a contrast curve.
    const lAll = Math.max(0, num(U.light, 0));
    const lGround = Math.min(lAll, typeof U.lightGround === 'number' ? Math.max(0, U.lightGround) : lAll * 0.35);
    if (lAll > 0) {
      // one formula at every texel size (a texel-size blend between formulas would draw seams between
      // tile levels): the far part is the whole aggregate minus the street part. It is only displayed
      // beyond the 3D city (coarse texels); at street texels it is meaningless but never shown.
      uStreet = STREET_UNITS * lGround;
      const fil = texel > 1400 ? lightFiligree(X, Y, Z, texel, smoothstep(1400, 3000, texel), 0.4) : 1;   // orbit tiles only
      uFar = Math.max(0, FAR_UNITS * Math.pow(Math.min(2.5, lAll * fil), FAR_GAMMA) - uStreet);
    }
    uTemp = sat(num(U.lightTemp, 0.2));
    lightAll = lAll;
    // DN: port / quay working light, cold white (urban plan lightPort, max-aggregated so short rows survive orbit
    // texels): rows of floodlight masts where they resolve, a cold glow per texel at orbit (point rows on screen)
    if (typeof U.lightPort === 'number') {
      hasPort = true;
      const lp = sat(U.lightPort);
      if (lp > 0) {
        const kO = smoothstep(300, 2000, texel);
        uPort = lp * ((1 - kO) * PORT_NEAR * portRows(x, y, z, X, Y, Z, texel) + kO * PORT_ORBIT);
        uStreet += uPort;
        uTemp += (0.97 - uTemp) * sat(uPort / (uPort + uFar + 0.25 * uStreet + 1e-6));
      }
    }
    out.onset = sat(num(U.lightOnset, 0.5));
  } else if (ctx.ao >= 0) ao = ctx.ao;

  // ---------------- ZR2 canyon at orbit (Z-05): red-rock walls over the city paint (orbitCanyon)
  if (canyonA > 0.002) {
    mix3(TMP2, CANYON_ORBIT, CANYON_RIM, 0.25);
    lerpTo(NAT, TMP2, canyonA);
    urbanCover *= 1 - canyonA;
    gloss *= 1 - canyonA;
  }

  // ---------------- O-zone irrigation network at orbit: farmland of varying shades along the branches, rough red
  // earth beyond the irrigation ends, blue canal trees on top (all area averages over the texel)
  if (kF > 0 || (kL > 0 && oLine > 0)) {
    const free = 1 - urbanCover;
    if (kF > 0 && fOrb > 0.002 && free > 0) {
      orbitFarmColour(X, Y, Z, texel, uOrb, oProv, TMP2);
      lerpTo(NAT, TMP2, kF * fOrb * free);
    }
    const rough = kF * (1 - fOrb) * free * smoothstep(0.3, 0.7, oZone) * (1 - iceW);
    if (rough > 0.01) {
      // 粗糙的赤土: mottled bare red earth (gravel lag / dust / outcrop patches, 5–40 km, resolved octaves only)
      const n1 = bandFbm(NB, X + 4.4e5, Y - 2.2e5, Z + 1.1e5, 24000, 4, 0.6, texel);
      const k1 = 1 + 0.24 * n1 * rough;
      NAT[0] *= k1 * (1 + 0.05 * rough); NAT[1] *= k1 * (1 - 0.04 * rough); NAT[2] *= k1 * (1 - 0.08 * rough);
    }
    if (kL > 0 && oLine > 0) {
      const a = sat(oLine * kL);
      lerpTo(NAT, ORBIT_CANAL, a);
      gloss = Math.max(gloss, 0.9 * a);
      urbanCover *= 1 - a;
    }
  }

  // ---------------- night light (urban plan + orbit envelope of the emission map)
  {
    let far = uFar, street = uStreet, temp = uTemp;
    const wMap = smoothstep(400, 4000, texel);          // wide ramp: small steps between tile levels
    if (wMap > 0) {
      const e = mapEmission(x, y, z);
      if (e > 0) {
        const fil = lightFiligree(X, Y, Z, texel, 1);
        const lMap = wMap * MAP_UNITS * Math.pow(e, MAP_GAMMA) * Math.min(3.2, fil);
        const own = far + street;
        if (lMap > own) {
          // the envelope dominates: station / civic cores white-gold, the rest sodium-warm; onset
          // early in cores, later in the outskirts (dusk spreads outward)
          const kMap = own > 0 ? sat((lMap - own) / lMap * 2) : 1;
          temp += (0.22 + 0.42 * smoothstep(0.75, 1.0, e) - temp) * kMap;
          out.onset += (sat(0.12 + 0.62 * (1 - e) + 0.18 * bandFbm(NF, X - 9.1e5, Y, Z, 60000, 3, 0.5, texel)) - out.onset) * kMap;
          far += lMap - own;
        }
      }
    }
    // sparse outskirts nodes at orbit (A02 / brief 01–02: 郊外断续的节点灯, 增加城镇、街块和节点的数量来
    // 丰富夜面): villages, farmsteads, depots and junction lights below the urban plan's resolution, as the
    // filigree network of dots and lit corridors on habitable land (dark gaps between them). O zones are
    // much sparser and colder (sluices, shift stations, levee settlements); none on ice / cliffs / water.
    const kBg = smoothstep(1200, 3000, texel);
    if (kBg > 0) {
      const lat = Math.asin(y < -1 ? -1 : y > 1 ? 1 : y) * RAD, lon = Math.atan2(x, z) * RAD;
      let zo = 0, dens = 0;
      try { zo = zoneSmooth(lat, lon); dens = densityAt(lat, lon); } catch { zo = 0; dens = 0; }
      const habit = (1 - iceW) * (1 - smoothstep(0.08, 0.3, num(ctx.slope, 0))) * (1 - 0.8 * sat(num(T.frost, 0)));
      // only around settled land (built-density prior): long dark gaps on empty uplands, deep water, O zones
      // DN: only where there are settlements (the urban plan lights the texel: towns, villages, O-zone sluices /
      // shift stations / levee towns), long dark gaps between, dark highlands
      const zW = ((1 - zo) * (0.15 + 0.85 * smoothstep(0.05, 0.4, dens)) + zo * 0.12) * smoothstep(0.01, 0.06, dens) * smoothstep(0.002, 0.02, lightAll);
      if (habit * zW > 0.01) {
        const bg = kBg * BG_UNITS * habit * zW * bgDots(X, Y, Z, texel);
        if (bg > 0) {
          const kb = bg / (bg + far + street + 1e-6);
          temp += ((zo > 0.5 ? 0.62 : 0.14) - temp) * kb;
          far += bg;
        }
      }
    }
    if (far + street > 0) {
      // working port rows on the sea coast stay cold white (A02 / brief 02: 冷白装卸区)
      const coastM = num(T.coast, 1e9);
      if (!hasPort && coastM < 1e8 && coastM > -texel) {
        const port = smoothstep(Math.max(1500, texel * 1.5), Math.max(250, texel * 0.25), coastM);
        if (port > 0) temp += (0.92 - temp) * port * 0.75;
      }
      far = Math.min(LIGHT_RANGE.far, far); street = Math.min(LIGHT_RANGE.street, street);
      // residential (lightTemp ≲ 0.35) sodium-gold, civic / station cores white-gold, port rows cold
      lightColour(temp, TMP);
      const l = far + street;
      emi[0] = TMP[0] * l; emi[1] = TMP[1] * l; emi[2] = TMP[2] * l;
    }
    out.lightFar = far; out.lightStreet = street; out.lightTemp = sat(temp);
  }

  // ---------------- water
  let wf = ctx.waterFrac, depth = ctx.depth, wtype = 0;
  if (W) {
    wtype = num(W.type, 0) | 0;
    if (wf < 0) {
      if (wtype === 0) { wf = 0; depth = -1; }
      else {
        depth = num(W.depth, 0);
        wf = sat(0.5 + depth / Math.max(0.05, texel * 0.5));
        if (wtype === 2) {
          const width = Math.max(0, num(W.width, 0)), dist = Math.max(0, num(W.dist, 1e9));
          const cv = sat((width * 0.5 - dist) / Math.max(texel, 0.05) + 0.5);
          wf = Math.max(wf, cv * (texel > width ? Math.min(1, width / texel * 1.6) : 1));
        }
      }
    }
  } else if (wf < 0) wf = 0;
  if (wf > 0) {
    if (ctx.waterResolved && (wtype !== 2 || ctx.canalResolved !== false)) {
      // drawn by the water renderer: show the submerged bed tinted by the water column
      waterTint(Math.max(0, depth), TMP);
      const keep = Math.exp(-Math.max(0, depth) / 1.4) * 0.55;
      mix3(TMP2, TMP, BED, keep);
      if (wtype === 1) harbourTint(x, y, z, texel, TMP2);
      lerpTo(NAT, TMP2, wf);
      gloss = Math.max(gloss, 0.9 * wf);
    } else {
      // unresolved water body (canal narrower than the mesh can show, sub-vertex pond / lagoon): paint
      // water (gloss ≥ 0.86 → the material draws a level, glossy surface with sun glint)
      if (wtype === 1) { waterTint(Math.max(0, depth), TMP); mix3(TMP2, TMP, P.seaMid, 0.35); harbourTint(x, y, z, texel, TMP2); lerpTo(NAT, TMP2, wf); }
      else lerpTo(NAT, wtype === 3 ? P.lakeWater : P.canalWater, wf);
      gloss = Math.max(gloss, 0.92 * wf);
    }
    const k = 1 - wf; emi[0] *= k; emi[1] *= k; emi[2] *= k;
    out.lightFar *= k; out.lightStreet *= k;
    urbanCover *= 1 - wf;
  }
  // wet edges: a band just above the water line (splash / capillary rise)
  if (W && wtype !== 0 && depth < 0 && depth > -0.8) wet = Math.max(wet, smoothstep(-0.8, 0, depth) * 0.9);
  if (wet > 0) { mul3(NAT, 1 - 0.40 * wet * (1 - urbanCover * 0.5)); gloss = Math.max(gloss, wet * 0.62); }
  if (iceW > 0) gloss = Math.max(gloss, iceW * 0.45 * (1 - urbanCover));

  alb[0] = clamp(NAT[0], 0.004, 0.92); alb[1] = clamp(NAT[1], 0.004, 0.92); alb[2] = clamp(NAT[2], 0.004, 0.92);
  out.gloss = sat(gloss);
  out.roughness = 0.95 - 0.72 * out.gloss;
  out.wet = wet; out.ice = iceW; out.ao = sat(ao);
  out.urban = urbanCover;
  return out;
}

/** fine (sub-metre) material texture for urban classes, mean preserving */
function fineUrban(cls, U, x, y, z, X, Y, Z, texel, c) {
  if (cls === CLS.ROAD_ART || cls === CLS.ROAD_LOCAL || cls === CLS.LANE || cls === CLS.PARKING || cls === CLS.BRIDGE) {
    // asphalt aggregate, patched / repaired areas, cracks, oil stains
    const g = bandFbm(ND, X + 5, Y, Z, 0.9, 6, 0.65, texel);
    mul3(c, 1 + 0.14 * g);
    const p = bandFbm(NH, X - 41, Y, Z, 7, 3, 0.5, texel);
    mul3(c, 1 + 0.14 * smoothstep(0.25, 0.5, p) - 0.06 * smoothstep(-0.3, -0.55, p));
    if (texel < 0.12) {
      const w = worley3(X / 1.6, Y / 1.6, Z / 1.6, 716, 1, WOR);
      const crack = 1 - smoothstep(0.004, 0.010 + texel / 1.6, w.f2 - w.f1);
      const on = ((w.id >>> 9) & 7) === 0 ? 1 : 0;                 // sparse: 1 cell border in 8 cracks
      mul3(c, 1 - 0.28 * crack * on * smoothstep(0.12, 0.03, texel));
    }
    // lane markings, tyre lanes, crossings — when the urban raster reports the road axis
    if (typeof U.roadOffset === 'number' && typeof U.roadWidth === 'number' && U.roadWidth > 2.5) roadMarkings(U, x, y, z, X, Y, Z, texel, c);
  } else if (cls === CLS.SIDEWALK || cls === CLS.PLAZA || cls === CLS.DOCK || cls === CLS.PIER || cls === CLS.CANAL_BANK) {
    const g = bandFbm(ND, X + 5, Y, Z, 0.8, 5, 0.6, texel);
    mul3(c, 1 + 0.07 * g);
    if (cls === CLS.PIER) {
      // timber deck planks (~0.2 m) along a parcel-hashed axis
      const En = enu(x, y, z);
      const hh = hash4(num(U.parcelId, 0) | 0, 23, 0, 0), ang = ((hh & 1023) / 1023) * Math.PI;
      const e = X * En[0] + Z * En[2], nn = X * En[3] + Y * En[4] + Z * En[5];
      const s = (e * Math.cos(ang) + nn * Math.sin(ang)) / 0.21;
      const f = Math.abs(s - Math.round(s));
      const res = smoothstep(0.08, 0.02, texel);
      const plank = 1 + 0.12 * ((hash4(Math.round(s), 5, 0, 0) & 255) / 255 - 0.5);
      mul3(c, (1 - 0.4 * res * (1 - smoothstep(0.03, 0.08, f))) * (1 + (plank - 1) * res));
      return;
    }
    const cell = cls === CLS.PLAZA ? 1.4 : cls === CLS.DOCK ? 2.6 : 0.9;
    const wv = worley3(X / cell, Y / cell, Z / cell, 713, 0.55, WOR);
    const e = wv.f2 - wv.f1;
    const res = smoothstep(0.35, 0.02, texel);
    const line = 1 - smoothstep(0.006, 0.02 + texel / cell, e);
    const tone = 1 + 0.08 * res * ((((wv.id >>> 4) & 255) / 255) - 0.5);
    mul3(c, (1 - 0.16 * line * res) * tone);
    // grime near slab joints and scattered stains
    if (texel < 0.2) mul3(c, 1 - 0.06 * smoothstep(0.2, 0.05, texel) * smoothstep(0.2, 0.6, bandFbm(NH, X, Y + 3, Z, 1.8, 3, 0.5, texel)));
  } else if (cls === CLS.FARM) {
    const pid = num(U.parcelId, 0) | 0;
    const hsh = hash4(pid, 17, 3, 0);
    const ang = ((hsh & 1023) / 1023) * Math.PI;
    const pitch = 0.6 + (((hsh >>> 10) & 255) / 255) * 0.6;
    const En = enu(x, y, z);
    const e = X * En[0] + Z * En[2], n = X * En[3] + Y * En[4] + Z * En[5];
    const s = (e * Math.cos(ang) + n * Math.sin(ang)) / pitch;
    const f = smoothstep(0.5, 0.15, texel / pitch);
    const row = 0.5 + 0.5 * Math.cos(s * 6.2831853);
    mix3(TMP2, c, P.soil, (1 - row) * 0.5 * f);
    set3(c, TMP2);
    mul3(c, 1 + 0.10 * bandFbm(NE, X, Y, Z, 3, 4, 0.6, texel));
  } else if (cls === CLS.GREENHOUSE || cls === CLS.SOLAR) {
    // glazing bars / panel rows (~1.2 m) along a parcel-hashed axis
    const En = enu(x, y, z);
    const hh = hash4(num(U.parcelId, 0) | 0, 29, 0, 0), ang = ((hh & 1023) / 1023) * Math.PI;
    const e = X * En[0] + Z * En[2], nn = X * En[3] + Y * En[4] + Z * En[5];
    const pitch = cls === CLS.SOLAR ? 2.2 : 1.2;
    const s = (e * Math.cos(ang) + nn * Math.sin(ang)) / pitch;
    const f = Math.abs(s - Math.round(s));
    const res = smoothstep(0.5, 0.06, texel);
    const bar = 1 - smoothstep(0.03, 0.07, f);
    mul3(c, 1 + res * (cls === CLS.SOLAR ? 0.9 * bar : -0.3 * bar));
  } else if (cls === CLS.FARM_ROAD || cls === CLS.RAIL) {
    const w = worley3(X / 0.06, Y / 0.06, Z / 0.06, 714, 1, WOR);
    const res = smoothstep(0.12, 0.025, texel);
    mul3(c, 1 + res * (0.25 * (((w.id >>> 6) & 255) / 255 - 0.5) - 0.12 * (1 - smoothstep(0, 0.2, w.f2 - w.f1))));
  } else if (cls === CLS.PARK || cls === CLS.YARD || cls === CLS.TREE_ROW || cls === CLS.SPORTS) {
    const g = bandFbm(NE, X, Y, Z, 2.5, 6, 0.62, texel);
    mul3(c, 1 + 0.20 * g);
    if (texel < 0.1) mul3(c, 1 + 0.12 * smoothstep(0.1, 0.03, texel) * ND.noise3(X / 0.05, Y / 0.05, Z / 0.05));
  } else if (cls === CLS.ROOF || cls === CLS.INDUSTRIAL) {
    const g = bandFbm(ND, X - 9, Y, Z, 1.5, 5, 0.6, texel);
    mul3(c, 1 + 0.05 * g);
  }
}

/**
 * Road surface marks from the optional urban road-axis fields (roadOffset: signed metres from the
 * carriageway centreline, roadWidth: kerb-to-kerb width, roadDirE/roadDirN: axis in local east/north,
 * roadAlong?: metres along the axis, junction?: 0..1 inside an intersection). Mean preserving across
 * scales: unresolved marks contribute their expected brightness.
 */
const MARK = L(0.62, 0.61, 0.57), MARK_Y = L(0.62, 0.46, 0.12);
function roadMarkings(U, x, y, z, X, Y, Z, texel, c) {
  const wd = U.roadWidth, off = U.roadOffset, half = wd * 0.5;
  const junction = sat(num(U.junction, 0));
  let along = num(U.roadAlong, NaN);
  if (!(along === along)) {
    const En = enu(x, y, z), de = num(U.roadDirE, 1), dn = num(U.roadDirN, 0);
    along = (X * En[0] + Z * En[2]) * de + (X * En[3] + Y * En[4] + Z * En[5]) * dn;
  }
  const res = resolved(0.32, texel);                 // marks are 12–15 cm wide
  const lanes = Math.max(1, Math.round(wd / 3.5));
  const arterial = wd >= 14;
  let mark = 0, yellow = 0;
  if (res > 0 && junction < 0.5) {
    const lw = 0.13;
    // centre line: double solid on arterials, dashed (3 m / 6 m) on local streets
    const dc = Math.abs(off);
    if (arterial) { const d2 = Math.abs(dc - 0.18); mark = Math.max(mark, 1 - smoothstep(lw * 0.5, lw * 0.5 + texel, d2)); yellow = mark; }
    else if (lanes >= 2) { const dash = ((along % 9 + 9) % 9) < 3 ? 1 : 0; mark = Math.max(mark, dash * (1 - smoothstep(lw * 0.5, lw * 0.5 + texel, dc))); }
    // lane separators (dashed) and edge lines
    if (lanes >= 4) {
      const per = half / Math.max(1, lanes / 2);
      for (let k = 1; k < lanes / 2; k++) { const d = Math.abs(dc - per * k); const dash = ((along % 12 + 12) % 12) < 4 ? 1 : 0; mark = Math.max(mark, dash * (1 - smoothstep(lw * 0.5, lw * 0.5 + texel, d))); }
    }
    if (wd > 6) { const de = Math.abs(dc - (half - 0.35)); mark = Math.max(mark, 1 - smoothstep(lw * 0.5, lw * 0.5 + texel, de)); }
  }
  // zebra crossing bands just outside junctions
  if (res > 0 && junction > 0.05 && junction < 0.6) {
    const stripe = ((Math.abs(off) % 1.0) < 0.5) ? 1 : 0;
    mark = Math.max(mark, stripe * smoothstep(0.05, 0.25, junction) * (1 - smoothstep(0.45, 0.6, junction)));
  }
  // tyre lanes: two darker / polished bands per lane (wheel tracks ~0.9 m either side of lane centre)
  const lane = half / Math.max(1, lanes / 2);
  const inLane = ((Math.abs(off) % lane) + lane) % lane - lane * 0.5;
  const track = Math.exp(-((Math.abs(inLane) - 0.85) ** 2) / (2 * 0.22 * 0.22));
  const trackRes = resolved(0.6, texel);
  const wear = 1 - 0.10 * track * trackRes * (1 - junction);
  // unresolved marks: expected brightness (≈5 % of the carriageway is paint)
  const expect = 1 + 0.05 * (1 - res);
  c[0] *= wear * expect; c[1] *= wear * expect; c[2] *= wear * expect;
  if (mark > 0) {
    const m = mark * res * (1 - 0.15 * ND.noise3(X / 0.5, Y / 0.5, Z / 0.5));    // worn paint
    mix3(TMP3, c, yellow > 0.5 ? MARK_Y : MARK, m);
    set3(c, TMP3);
  }
}

/**
 * Sub-geometry relief (metres) for the normal map: kerbs, crop ridges, pebbles, cracks, joints.
 * Band-limited like the colour: features below ~2 texels contribute nothing.
 */
export function surfaceMicroHeight(x, y, z, texel, T, U) {
  if (texel > 2.5) return 0;
  const X = x * R, Y = y * R, Z = z * R;
  let h = 0;
  const cls = U ? num(U.cls, CLS.NATURAL) | 0 : CLS.NATURAL;
  const fabric = U ? (typeof U.fabric === 'number' ? U.fabric : (cls !== CLS.NATURAL ? 1 : 0)) : 0;
  if (U && cls !== CLS.NATURAL && fabric > 0.5) {
    // kerbs: sidewalks / plazas / block interiors stand 15 cm above the carriageway
    if (cls === CLS.SIDEWALK || cls === CLS.PLAZA || cls === CLS.YARD || cls === CLS.PARK || cls === CLS.TREE_ROW || cls === CLS.SPORTS || cls === CLS.ROOF) h += 0.15;
    else if (cls === CLS.RAIL) h += 0.25;
    else if (cls === CLS.DOCK || cls === CLS.PIER || cls === CLS.CANAL_BANK) h += 0.3;
    if (cls === CLS.FARM && texel < 0.5) {
      const pid = num(U.parcelId, 0) | 0;
      const hsh = hash4(pid, 17, 3, 0);
      const ang = ((hsh & 1023) / 1023) * Math.PI;
      const pitch = 0.6 + (((hsh >>> 10) & 255) / 255) * 0.6;
      const En = enu(x, y, z);
      const e = X * En[0] + Z * En[2], n = X * En[3] + Y * En[4] + Z * En[5];
      const s = (e * Math.cos(ang) + n * Math.sin(ang)) / pitch;
      h += 0.08 * Math.cos(s * 6.2831853) * smoothstep(0.5, 0.15, texel / pitch);
    }
    if (texel < 0.3 && (cls === CLS.SIDEWALK || cls === CLS.PLAZA || cls === CLS.DOCK)) {
      const cell = cls === CLS.PLAZA ? 1.4 : cls === CLS.DOCK ? 2.6 : 0.9;
      const wv = worley3(X / cell, Y / cell, Z / cell, 713, 0.55, WOR);
      h -= 0.006 * (1 - smoothstep(0.006, 0.03, wv.f2 - wv.f1)) * smoothstep(0.3, 0.03, texel);
    }
    if (texel < 0.12 && (cls === CLS.ROAD_ART || cls === CLS.ROAD_LOCAL || cls === CLS.LANE || cls === CLS.PARKING)) {
      const w = worley3(X / 1.6, Y / 1.6, Z / 1.6, 716, 1, WOR);
      const on = ((w.id >>> 9) & 7) === 0 ? 1 : 0;
      h -= 0.006 * on * (1 - smoothstep(0.004, 0.02, w.f2 - w.f1)) * smoothstep(0.12, 0.03, texel);
      h += 0.002 * ND.noise3(X / 0.04, Y / 0.04, Z / 0.04) * smoothstep(0.06, 0.02, texel);
    }
    if (texel < 0.1 && (cls === CLS.PARK || cls === CLS.YARD || cls === CLS.TREE_ROW)) {
      h += 0.012 * ND.noise3(X / 0.12, Y / 0.12, Z / 0.12) * smoothstep(0.1, 0.03, texel);
    }
    return h;
  }
  const rock = num(T && T.rock, 0) + num(T && T.basalt, 0), sand = num(T && T.sand, 0), soil = num(T && T.soil, 0);
  if (texel < 0.16) {
    const w = worley3(X / 0.07, Y / 0.07, Z / 0.07, 711, 1, WOR);
    const peb = Math.sqrt(Math.max(0, 0.35 - w.f1 * w.f1)) * 0.03;
    h += peb * smoothstep(0.16, 0.04, texel) * clamp(sand + soil * 0.7 + rock * 0.6, 0, 1);
    if (texel < 0.08 && rock > 0.2) {
      const w2 = worley3(X / 0.32 + 9.1, Y / 0.32, Z / 0.32, 715, 1, WOR2);
      const cob = smoothstep(0.42, 0.30, w2.f1) * (((w2.id >>> 3) & 7) < 3 ? 1 : 0);
      h += cob * 0.07 * Math.sqrt(Math.max(0, 1 - (w2.f1 / 0.42) ** 2)) * smoothstep(0.08, 0.03, texel);
    }
  }
  if (rock > 0.25 && texel < 2.5) {
    const w = worley3(X / 2.2, Y / 2.2, Z / 2.2, 712, 1, WOR);
    h -= 0.04 * (1 - smoothstep(0.004, 0.03 + texel / 2.2, w.f2 - w.f1)) * smoothstep(2.5, 0.06, texel) * Math.min(1, rock);
    h += 0.05 * ((((w.id >>> 5) & 255) / 255) - 0.5) * smoothstep(2.5, 0.3, texel) * Math.min(1, rock);   // block steps
  }
  const dune = num(T && T.dune, 0);
  if (dune > 0.2 && texel < 0.3) {
    const En = enu(x, y, z);
    const e = X * En[0] + Z * En[2], nn = X * En[3] + Y * En[4] + Z * En[5];
    h += 0.012 * Math.sin((e * 0.83 + nn * 0.31) / 0.12 + 3 * ND.noise3(X / 0.9, Y / 0.9, Z / 0.9)) * smoothstep(0.3, 0.06, texel) * dune;
  }
  if (texel < 1.0 && sand > 0.3) h += 0.02 * bandFbm(ND, X + 17, Y, Z, 1.2, 4, 0.55, texel) * sand;
  return h;
}

// ---------------------------------------------------------------------------------------------
// standalone single-point evaluation (UI probes, debug, Node previews)
// ---------------------------------------------------------------------------------------------
const ST = {}, SU = {}, SW = {};
const CTX1 = { ...SHADE_CTX };

export function surfaceSample(x, y, z, texelMeters, out = {}) {
  const texel = Math.max(0.01, texelMeters || 1);
  MOD.terrain.sampleTerrain(x, y, z, texel, ST);
  let U = null, W = null;
  const us = getUrbanSampler();
  if (us) { try { U = us(x, y, z, texel, SU); } catch { U = null; } }
  try { W = MOD.hydro.waterAt(x, y, z, SW); } catch { W = null; }
  CTX1.slope = num(ST.slopeHint, 0) * 0.3;
  CTX1.ao = -1; CTX1.waterFrac = -1; CTX1.depth = 0;
  CTX1.waterResolved = !(W && (W.type | 0) === 2 && num(W.width, 0) < texel * 2);
  CTX1.canalResolved = CTX1.waterResolved;
  CTX1.coastal = Math.abs(num(ST.coast, 0)) < 3000 || ST.coast === undefined;
  shadeSurface(x, y, z, texel, ST, U, W, CTX1, out);
  out.microHeight = surfaceMicroHeight(x, y, z, texel, ST, U);
  return out;
}

// silence unused-import lint in tools that tree-shake (worley2 kept for callers of this module)
export const _surfaceNoise = { worley2 };
