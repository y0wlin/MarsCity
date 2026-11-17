// Terrain renderer constants shared by the main thread and the tile workers (no THREE here).
// OWNER: terrain-render agent.
import { TILE_SEGMENTS, MAX_TILE_LEVEL, FACE_ARC, R } from '../../core/constants.js';

export const N = TILE_SEGMENTS;            // quads per tile edge
export const NV = N + 1;                   // vertices per tile edge
export const GRID_VERTS = NV * NV;
export const SKIRT_VERTS = 4 * NV;
export const TOTAL_VERTS = GRID_VERTS + SKIRT_VERTS;
export const MAX_LEVEL = MAX_TILE_LEVEL;

export const TEX_LOW = 128;                // first pass of every tile (ancestors never need more)
export const TEX_FAR = 256;                // displayed leaves (the split criterion is in 256-texels)
export const TEX_NEAR = 512;               // displayed leaves near the camera / at the max level

/** legacy (pre fix-round-1 encoding); kept for tools */
export const EMISSION_RANGE = 4.0;
/** Emission texture encoding (sRGB RGBA8; RGB are decoded to linear by the GPU before filtering, so the
 *  premultiplied intensities filter correctly): R = window aggregate / EMIT_FAR_RANGE, G = street light
 *  / EMIT_STREET_RANGE (both in EMISSIVE units, 1 = a typical lit window), B = light temperature
 *  (0 warm … 1 cold), A = dusk onset (linear). Mirrors world/surface.js LIGHT_RANGE. */
export const EMIT_FAR_RANGE = 16.0;
export const EMIT_STREET_RANGE = 8.0;      // fix round 2: room for cold port floodlight rows (DN)

/** face-plane edge length of a tile (m); true ground size is 0.71–1.0 of this */
export function tileSizeAt(level) { return (2 * FACE_ARC) / (1 << level); }
/** band limit of the vertex grid heights (≈ vertex spacing). Function of the level only, so that
 *  neighbours of the same level agree exactly on shared edges and a tile's "parent shape" equals the
 *  real parent tile. */
export function vertexWavelength(level) { return tileSizeAt(level) / N; }
/** band limit / footprint of one texel */
export function texelWavelength(level, T) { return tileSizeAt(level) / (T - 1); }
/** maximum chord sagitta of a grid cell on the sphere (m): the mesh dips below the true surface */
export function cellSagitta(level) { const s = vertexWavelength(level); return (s * s) / (4 * R); }
/** skirt depth: deep enough to hide any crack against a coarser neighbour */
export function skirtDepth(level, geomErr) { return Math.max(0.05, tileSizeAt(level) * 0.012 + geomErr * 3); }

/** Shared quad triangulation: quads with even (i+j) use the 00–11 diagonal, odd the 10–01 one. */
export function quadParity(i, j) { return (i + j) & 1; }
