// Terrain core: fields -> natural relief -> water bodies -> sea consistency, plus the geology-
// consistent material classification used by sampleTerrain. OWNER: terrain-fn agent.
// world/terrain.js re-exports the public functions from here.
import { computeFields, newFields } from './field.js';
import { relief, newMat, resetMat } from './relief.js';
import { smoothstep, clamp } from './noise.js';
import { farmPotential } from './irrigation.js';

// mean irrigated share of farmable O-zone land (measured over OX1/OX2/OX3/OX5: 0.33-0.47)
const FARM_MEAN = 0.42;

export const TerrainMat = { SEAFLOOR: 0, BEACH: 1, SAND: 2, ROCK_RED: 3, BASALT: 4, SOIL: 5, FARM: 6, URBAN: 7, ICE: 8, FROST: 9 };

const F = newFields();
const M = newMat();
let carveHook = null;   // installed by waterbodies.js (lakes, canals, rivers, sites)
export function installWaterCarver(fn) { carveHook = fn; }
export const WATER_INFO = { type: 0, level: 0, width: 0, dist: 1e9, fx: 0, fy: 0, id: '', order: -1, kind: '' };

/** keep land strictly above sea level and sea strictly below (coast metric decides) */
function enforceSea(c, h) {
  if (c > 0) {
    const m = 0.06 + Math.min(1.2, 0.004 * c);
    return h < m ? m : h;
  }
  const m = -0.08 - Math.min(1.2, 0.004 * -c);
  return h > m ? m : h;
}

function resetWater(F) {
  const W = WATER_INFO;
  W.type = F.c < 0 ? 1 : 0; W.level = 0; W.width = 0; W.dist = 1e9; W.fx = 0; W.fy = 0;
  W.id = F.c < 0 ? 'sea' : ''; W.order = -1; W.kind = F.c < 0 ? 'sea' : '';
}

/** height + fields (F is filled), used by every public entry point */
export function heightWithFields(x, y, z, mw, Fout, Mout) {
  computeFields(x, y, z, mw, Fout);
  let h = relief(Fout, mw, Mout);
  resetWater(Fout);
  if (carveHook) h = carveHook(Fout, h, mw, Mout, WATER_INFO);
  return enforceSea(Fout.c, h);
}

export function heightCore(x, y, z, minWavelength = 0) {
  return heightWithFields(x, y, z, minWavelength > 0 ? minWavelength : 0, F, null);
}

export function sampleCore(x, y, z, minWavelength, out) {
  const mw = minWavelength > 0 ? minWavelength : 0;
  resetMat(M);
  const h = heightWithFields(x, y, z, mw, F, M);
  out.h = h;
  const c = F.c, sea = c < 0;
  const ice = M.ice;
  let rock = M.rock, basalt = 0, sand = 0, soil = 0, beach = 0, seafloor = 0;
  out.farm = 0;
  if (sea) {
    seafloor = 1;
    sand = 0.55 * (1 - smoothstep(8, 70, -h));
    rock *= 0.25;
  } else {
    let farm = 0;
    if (F.farmOK > 0.02) {
      // coarse texels: the irrigated bands (0.9-2.6 km either side of the canals) are sub-texel, so
      // the band-limited value is their area expectation (no canal network needed for orbit tiles)
      const kf = smoothstep(2500, 5000, mw);
      const pt = kf < 1 ? farmPotential(F).farm : 0;
      farm = pt + (F.farmOK * FARM_MEAN - pt) * kf;
    }
    if (F.g02Terrace > 0) farm = Math.max(farm, 0.85 * F.g02Terrace);   // G02 irrigated bench terraces
    out.farm = farm;
    soil = clamp(Math.max(F.urban, farm), 0, 1) * (1 - rock * 0.75) * (1 - ice);
    // dark basalt: lava plains, the volcano, fresh crater floors/ejecta, wet / polar dark rock
    basalt = Math.max(F.wLava * (0.55 + 0.3 * smoothstep(0.3, 1, F.wLava)), M.lava * 0.65, M.fresh * 0.7, F.wOX4 * rock * 0.55, F.wOX6 * rock * 0.45);
    basalt *= (1 - ice) * (1 - 0.6 * soil);
    beach = M.beach * (1 - ice);
    sand = Math.max(M.sand, M.trough * 0.5, 1 - rock - soil - basalt);
    sand = clamp(sand, 0, 1) * (1 - ice);
  }
  rock *= 1 - ice;
  const sum = rock + basalt + sand + soil + ice + beach + seafloor || 1;
  out.rock = rock / sum; out.basalt = basalt / sum; out.sand = sand / sum; out.soil = soil / sum;
  out.ice = ice / sum; out.beach = beach / sum; out.seafloor = seafloor / sum;
  const frostF = F.frost;
  out.frost = sea ? 0 : clamp(frostF * (1 - ice) * (0.45 + 0.55 * rock) * (1 - soil * 0.6) + M.iceCliff * 0.3, 0, 1);
  out.wet = clamp(M.wet, 0, 1);
  out.strata = M.strata;
  out.cliff = clamp(M.cliff, 0, 1);
  out.slopeHint = clamp(Math.max(M.cliff, M.iceCliff, M.rock * 0.5), 0, 1);
  out.dune = M.dune; out.park = M.park; out.fresh = M.fresh; out.lava = M.lava; out.mesa = M.mesa;
  out.iceCliff = M.iceCliff; out.riverbed = M.riverbed; out.waterline = M.waterline;
  out.scree = M.scree; out.trough = M.trough; out.rim = M.rim; out.crevasse = M.crevasse;
  out.coast = c;
  out.water = WATER_INFO.type;
  let mat = TerrainMat.SAND, best = out.sand;
  if (sea) { mat = h > -3 ? TerrainMat.BEACH : TerrainMat.SEAFLOOR; best = 2; }
  if (out.rock > best) { best = out.rock; mat = TerrainMat.ROCK_RED; }
  if (out.basalt > best) { best = out.basalt; mat = TerrainMat.BASALT; }
  if (out.soil > best) { best = out.soil; mat = F.urban >= out.farm ? TerrainMat.URBAN : TerrainMat.FARM; }
  if (out.ice > best) { best = out.ice; mat = TerrainMat.ICE; }
  if (out.beach > best) { best = out.beach; mat = TerrainMat.BEACH; }
  if (!sea && out.frost > 0.6 && best < 0.6) mat = TerrainMat.FROST;
  out.mat = mat;
  return out;
}

/** fields of the last evaluated point (read-only view for hydro/fields wrappers) */
export const LAST = F;
