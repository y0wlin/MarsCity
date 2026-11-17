// Shared lookups (owner: core). 'buildingSpec' regenerates a BuildingSpec by its stable id inside
// a pool worker, reusing whatever urban caches that worker has already warmed.
import { buildingSpecById } from '../../world/urban.js';
import { canalsInTile, lakesInTile, iceFootSystem } from '../../world/hydro.js';
// city agent (fix round 2, QA-ID-02): G02 work-town ids (OX5-G02-T<k>-<i>, synthesised by render/city/towns.js)
import { townSpecById } from '../../render/city/towns.js';

export default {
  buildingSpec: async ({ id }) => ({ result: townSpecById(id) || buildingSpecById(id) || null }),
  // hydro vector data (terrain-fn): the main thread must never call hydro.canalsInTile itself (it builds the
  // canal network lazily: seconds on a cold thread).
  /** payload {face, level, x, y, lakes?} -> canalsInTile(...) array, or {canals, lakes} when lakes is true */
  canals: async ({ face, level, x, y, lakes = false }) => {
    const canals = canalsInTile(face, level, x, y);
    return { result: lakes ? { canals, lakes: lakesInTile(face, level, x, y) } : canals };
  },
  /** payload {} -> hydro.iceFootSystem() (OX4 cliff foot, meltwater channel, outlets / pools) */
  iceFoot: async () => ({ result: iceFootSystem() }),
};
