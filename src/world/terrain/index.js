// Wiring of the terrain-fn helper modules (import order = installation order, no import cycles):
// core (fields -> relief -> sea consistency) <- waterbodies (rivers, canals, lakes) <- megasites
// (G01 coast + harbour, G02 water stairs). OWNER: terrain-fn agent.
export { heightCore, sampleCore, heightWithFields, TerrainMat, WATER_INFO, LAST } from './core.js';
import './waterbodies.js';
import './megasites.js';
