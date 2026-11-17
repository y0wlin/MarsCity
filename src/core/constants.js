// Global, frozen world constants. Every module (main thread and workers) reads these.
// Changing any value here changes the world itself, so bump WORLD_VERSION when you do.

export const WORLD_VERSION = 'mars-world-1.0.0';
export const SEED = 351165;            // world seed from the brief (prompt.md §5 template)

export const R = 3389500;              // planet radius in metres == sea-level radius
export const SEA_LEVEL = 0;            // metres, heights are relative to R
export const CLOUD_ALT = 7000;         // metres, base of the thin cloud layer
export const CLOUD_TOP = 9500;         // metres, top of the cloud layer (for shading/parallax)
export const ATMO_HEIGHT = 110000;     // metres, top of the scattering shell

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

// Face-plane metres: the quadtree / planning grid use the tangent-warped cube
// coordinate a in [-1,1]. Near a face centre one unit of a spans FACE_ARC metres.
export const FACE_ARC = (R * Math.PI) / 4; // ~2,662,124 m

// Quadtree / LOD constants (render/terrain uses these, world/urban aligns to them)
export const TILE_SEGMENTS = 64;       // quads per tile edge (65x65 vertices + skirts)
export const MAX_TILE_LEVEL = 20;      // level 20 tile ~ 5 m across
export const CITY_TILE_LEVEL = 13;     // tiles at this level (~650 m) own city parcels/buildings

// Province table order (ID 1..12) — §4 图层接入: ID 1..12 follow OX1–OX6, ZR1–ZR6
export const PROVINCE_CODES = ['', 'OX1', 'OX2', 'OX3', 'OX4', 'OX5', 'OX6', 'ZR1', 'ZR2', 'ZR3', 'ZR4', 'ZR5', 'ZR6'];

// Human scale references used by generators (§3 模块与尺度)
export const HUMAN_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.65;
export const RES_FLOOR_H = 3.1;        // residential storey height
export const PUBLIC_FLOOR_H = 4.8;     // public storey height (4.5–6 m)
