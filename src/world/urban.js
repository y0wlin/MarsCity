// Urban / land-use plan of the whole planet (pure, worker-safe, float64). OWNER: urban-fn agent.
// The same deterministic plan feeds (a) per-texel surface rasters at every zoom level and (b) the 3D
// city (plots → BuildingSpec), so far fabric, night lights and near buildings agree
// ("远景城群的占地、剪影、色彩和灯光从同一组地块派生").
//
// Hierarchy (each level only reads the levels above it and the lower world layers):
//   fields (control maps) → settlements (≈ 15–21 km lattice: cities, towns, villages, O towns,
//   hamlets, polar stations; neighbourhood-thinned) → corridor graph (RNG of settlements: metro /
//   regional rail with stations every 1.5–4 km, roads, service lines, pipe galleries) → districts
//   (adaptive Voronoi in 3D, 1.7–21 km, class, grid orientation / module / jitter) → blocks (jittered
//   street grid ∩ district inset polygon, labelled edges) → plots & buildings (frontage strips,
//   BuildingSpec) → entrances.
// Modules: urban/{rules, lattice, potential, settlements, dseeds, dchunks, corridors, districts,
//          parcels, builders, raster, specs, citytile, cells, geom, lru, probe}.js
// Cold start (fresh worker, nothing cached): buildingSpecById touches only the district + its Voronoi
// neighbours (D1 records), the corridor links within 12.5 km of those seeds, one D2 geometry record
// whose land / height raster is evaluated lazily (only the nodes around the requested block), and one
// block layout. Settlement validity (a 24–50 km neighbourhood maximum) is established lazily: only for
// link endpoints, lens blockers and candidates whose best possible outcome can change an answer
// (settlements.js outcomes / townInfluenceAt / townProfileT, corridors.js linksNear, dseeds.js
// desiredDistrictSize) — results bit-identical to the eager queries (check-urban.mjs links / roundtrip).
// Ground heights are memoised on fixed lattices (evaluated at the lattice points), so tile generation
// and id lookups return bit-identical specs.
//
// CONTRACT (ARCHITECTURE.md §5 world/urban) — implemented as documented, plus additive extras:
//   urbanSample(x, y, z, texelMeters, out, fields?) -> raster sample at unit direction (x,y,z)
//       contract fields: cls (SurfaceClass), coverage (roof fraction), roofKind (RoofKind), roof (tone 0..1),
//       height (m, coverage-weighted mean roof height), landUse (LandUse; NONE when < 50 % of the texel is
//       built), light (0..~1.5 night radiance, windows + streets + stations, area-averaged), lightTemp
//       (0 warm…1 cold), lightOnset (0 early…1 late at dusk), districtTone (0..1, 0.5 neutral; district
//       patchwork), farmCrop (FarmCrop), blockId, parcelId (uint24 hashes, 0 = none).
//       extras: fabric (0..1 share of the texel that is built fabric: roofs + streets + yards + fields),
//       fabricR/G/B (linear albedo of that fabric → albedo = mix(terrain, fabricRGB, fabric)), green, road,
//       farm, water (fractions), farmStage (FarmStage), lightGround (street-level light only — use it under
//       3D buildings), dclass (district class), elevated (rail viaduct), bridge, covered (ZR6 warm
//       corridors), zone ('O'|'Z'), province (1..12), lightPort (0..1 cold-white quay / port working-light
//       presence, coverage-preserving across texel sizes — decision DN, fix round 2).
//       fields (optional 6th arg): the caller's own fields.sampleFields(x,y,z) result for this texel; the
//       orbit / district levels then use it instead of the urban lattice cache.
//   generateCityTile(face, x, y)            -> CityTileData for the CITY_TILE_LEVEL tile (face,x,y)
//       contract: key, face, x, y, level, center{lat,lon,h}, buildings (BuildingSpec[]), roads
//       [{id, cls, width, points, bridge?, covered?, district?}] cls ∈ boulevard|arterial|collector|local|
//       lane|farm|levee|highway|service, areas [{id, kind, polygon, y, crop?, stage?, block}], rails
//       [{id, points, elevated, tracks, kind, bridge, segment}], stations [{id, buildingId, x, y, z, heading,
//       platformLength, elevated, main, kind, side}], docks [{id, kind: pier|ferry|landing, polygon, y,
//       heading, length, width}]; extras: pipes [{id, points, diameter, insulated}], lanes [], stats.
//   buildingSpecById(id)                    -> BuildingSpec | null (regenerates its block only)
//       BuildingSpec extras: ground.corners [fl, fr, br, bl] (full-detail terrain heights at the footprint
//       corners), meta.{districtClass, blockUse, frontage, roofKind, height, covered, terraced, cold, polar,
//       orient, tone, corner, shops, courtyard, podium, tower, trackHeading, platformSide, platformLength,
//       stationKind, elevated, main, poolSide, canalId, yardSide, …}
//   districtInfo(lat, lon)                  -> district summary (UI / debugging)
//   clearUrbanCaches()                      -> drop caches (results never change)
//   parseBuildingId(id)                     -> {prov, dkey, i, j, k} | null
//   USES / SurfaceClass / LandUse / RoofKind / FarmCrop / FarmStage enums
// Building ids: "<province>-<face.level.x36.y36>-<i.j>-<k>" e.g. "ZR1-0.3.1a5.17z-n8.n6-4".
// Window lights: world/occupancy.js (windowLit + OCCUPANCY_GLSL, verified bit-identical on GPU).
import { USES, SurfaceClass, LandUse, RoofKind, FarmCrop, FarmStage, URBAN_VERSION, DC_NAMES, BU_NAMES } from './urban/rules.js';
import { urbanSample as sampleImpl } from './urban/raster.js';
import { generateCityTile as tileImpl } from './urban/citytile.js';
import { specById, parseBuildingId } from './urban/specs.js';
import { nearestDistrict } from './urban/dchunks.js';
import { district1, districtId } from './urban/districts.js';
import { latLonToUnit } from '../core/geo.js';
import { clearAllLru } from './urban/lru.js';
import { bridgesNear as bridgesNearImpl } from './urban/bridgequery.js';
import { harbourAt as harbourAtImpl, HARBOUR_CENTRES, harbourBridge } from './urban/harbour.js';

export { USES, SurfaceClass, LandUse, RoofKind, FarmCrop, FarmStage, URBAN_VERSION, parseBuildingId };

/**
 * urbanSample(x, y, z, texelMeters, out, fields?) — `fields` (optional) is the caller's own
 * fields.sampleFields(x,y,z) result for this texel; when given, the orbit / district levels use it
 * directly instead of the urban lattice cache.
 */
export function urbanSample(x, y, z, texelMeters, out = {}, fields = null) { return sampleImpl(x, y, z, texelMeters, out, fields); }

/** generateCityTile(face, x, y, opts?) — opts.buildingsOnly: buildings + stations only (far mass tiles; identical buildings) */
export function generateCityTile(face, x, y, opts = null) { return tileImpl(face, x, y, opts); }

export function buildingSpecById(id) {
  try { return specById(id); } catch (e) { return null; }
}

/** District summary at a lat/lon (UI / debugging) */
export function districtInfo(lat, lon) {
  const p = latLonToUnit(lat, lon, {});
  const nd = nearestDistrict(p.x, p.y, p.z, {});
  const D = district1(nd.key);
  return {
    id: districtId(nd.key), class: DC_NAMES[D.cls], zone: D.zone, province: D.province, provinceCode: D.code,
    intensity: Math.round(D.inten * 1000) / 1000, envelope: Math.round(D.env * 1000) / 1000, town: Math.round(D.T * 1000) / 1000,
    settlement: D.townKind, orient: D.orient, theta: D.theta, module: [Math.round(D.bw), Math.round(D.bd)], size: Math.round(D.size), year0: D.year0,
    coastal: D.coastal, terraced: D.terraced, covered: D.covered, polar: D.polar, roofStyle: D.roofStyle, edgeDistance: Math.round(nd.edge),
  };
}

/**
 * Long bridges (decision DB) within radiusM of (lat, lon): [{id, kind, type 'cable'|'arch'|'girder', lat, lon, heading,
 * span, clearance, length, mainSpan, archRise?, pylons:[{lat, lon, h, shape, base, baseR}]}]
 */
export function bridgesNear(lat, lon, radiusM = 5000) { try { return bridgesNearImpl(lat, lon, radiusM); } catch (e) { return []; } }

/** G01 protected port city overlay at (lat, lon) (debug / cameras): {w, ds, side, centre, peak, T} */
export function harbourCityAt(lat, lon) { const p = latLonToUnit(lat, lon, {}); return harbourAtImpl(p.x, p.y, p.z, {}); }
export { HARBOUR_CENTRES, harbourBridge };

/** Drop all urban caches (memory pressure / benchmarks). Pure functions: results never change. */
export function clearUrbanCaches() { clearAllLru(); }

export { BU_NAMES };
