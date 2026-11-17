// Worker handler registry. Each handler: async (payload) => ({ result, transfer?: ArrayBuffer[] })
// Ownership: one file per subsystem; only add an import line here for a new file.
import probe from './probe.js';
import terrainTile from './terrainTile.js';
import cityTile from './cityTile.js';
import building from './building.js';
import lookup from './lookup.js';

export const HANDLERS = { ...probe, ...terrainTile, ...cityTile, ...building, ...lookup };
