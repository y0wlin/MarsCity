// OWNER: terrain-render agent. Terrain tile handlers (see render/terrain/tileBuilder.js for the
// output layout):
//   'terrainTile'  payload {face, level, x, y, texRes}            -> tile result
//   'terrainTiles' payload {tiles:[{face, level, x, y, texRes}]}  -> {results:[tile result...]}
//       siblings built back to back in one worker share the world functions' per-area caches
// The optional urban module is imported dynamically on the first job (ensureTileBuilder) so that a
// broken / mid-rewrite world/urban.js only removes the city from the terrain textures.
import { buildTerrainTile, ensureTileBuilder } from '../../render/terrain/tileBuilder.js';

export default {
  terrainTile: async (payload) => { await ensureTileBuilder(); return buildTerrainTile(payload); },
  terrainTiles: async ({ tiles }) => {
    await ensureTileBuilder();
    const results = [], transfer = [];
    for (const t of tiles) {
      const r = buildTerrainTile(t);
      results.push(r.result);
      for (const b of r.transfer) transfer.push(b);
    }
    return { result: { results }, transfer };
  },
};
