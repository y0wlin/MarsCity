// Large-scale planetary fields shared by terrain.js and urban.js (pure, worker-safe, float64).
// OWNER: terrain-fn agent. CONTRACT (ARCHITECTURE.md §5): sampleFields(x,y,z,out) with (x,y,z) a
// unit vector (ECEF direction).
//
// out.lat, out.lon        degrees
// out.province            1..12 exact pixel lookup (administrative)
// out.zone                'O' | 'Z' exact pixel lookup (administrative)
// out.zoneO               0..1 smooth / domain-warped zone blend for VISUAL transitions (1 = O look)
// out.coast               signed land metric: > 0 land, < 0 sea; |coast| -> 1 at >= 50 km from shore
// out.density             0..1 smooth (warped B-spline) built-density tendency
// out.emission            0..1 smooth night-emission tendency
// out.ridge               0..1 bare-rock / mountain mask (mountain belts, ranges across city bands,
//                         rift walls, canyon walls); low at passes where a city corridor squeezes through
// out.urban               0..1 urban potential in Z-look areas (0 on water, rock, ice, rift floor)
// out.farm                0..1 irrigated farmland potential in O-look areas (bands along the canal
//                         network; raw red soil beyond the irrigation ends)
// out.ice                 0..1 polar ice / frost mask (OX4 ice cliffs, OX6 frost plains)
// Extra (additive, used by urban.js):
// out.coastM              signed distance-like metric to the sea shore in metres (> 0 land)
// out.frost               0..1 frost tendency (high latitudes, OX6 frost plains)
// out.canal               metres to the nearest irrigation canal centreline (O look; 1e9 if none)
// out.pass                0..1 mountain / rift pass corridor (where a city band squeezes through)
// out.canyon              0..1 inside a canyon / gorge / glacial trough
// out.rift                0..1 inside the red rift (bare rock)
// out.park                0..1 inside a city crater park (landmark crater floors, A03)
// out.farmBase            0..1 farmable O-zone lowland before irrigation (basins vs red tablelands)
// out.mount, out.rough    0..1 mountain belts / natural ruggedness (geology hints)
import { computeFields, newFields } from './terrain/field.js';
import { farmPotential } from './terrain/irrigation.js';
import { fixedCraters } from './terrain/impact.js';

const F = newFields();
const CP = { fresh: 0, wall: 0, floor: 0, rim: 0, park: 0 };

export function sampleFields(x, y, z, out = {}) {
  computeFields(x, y, z, 0, F);
  out.lat = F.lat; out.lon = F.lon;
  out.province = F.province;
  out.zone = F.isO ? 'O' : 'Z';
  out.zoneO = F.zoneO;
  const c = F.c;
  out.coast = c >= 0 ? Math.min(1, c / 50000) : Math.max(-1, c / 50000);
  out.coastM = c;
  out.density = F.density;
  out.emission = F.emission;
  out.ridge = F.ridge;
  out.urban = F.urban;
  out.ice = Math.max(F.ice, F.frost * 0.45);
  out.frost = F.frost;
  const fp = farmPotential(F);
  // G02 irrigated bench terraces on the benched reservoir banks below dams D1-D5 (QS-08)
  out.farm = F.g02Terrace > 0 ? Math.max(fp.farm, 0.85 * F.g02Terrace) : fp.farm;
  out.canal = fp.dist;
  out.farmBase = F.farmOK;     // farmable lowland where farmland is allowed (none north of 70N, OX1 basin)
  out.pass = F.pass;
  out.canyon = F.canyon;
  out.rift = F.rift;
  out.mount = F.mount;
  out.rough = F.rough;
  fixedCraters(x, y, z, 0, CP);
  out.park = CP.park;
  return out;
}
