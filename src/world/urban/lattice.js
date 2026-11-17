// Multi-resolution lattice cache of the planetary fields (fields.sampleFields contract) for the
// urban plan. Nodes sit on seamless 3D grids (spacing s_k = 20.8 km · 2^-k, k = -4..7, i.e.
// 333 km … 162 m), are evaluated once at the node direction and interpolated trilinearly at a
// query point on the sphere. A 3D grid has no cube faces, so there are no seams anywhere.
//
// fieldsAt(x, y, z, spacing, out) reads the coarsest lattice whose spacing is ≤ `spacing` metres.
// Callers choose the spacing from their own footprint (urbanSample: a few texels; district
// rasters: the raster step), so the expensive world fields are evaluated a handful of times per
// thousand queries. Consecutive queries in the same lattice cell reuse the 8 node vectors.
import { R } from '../../core/constants.js';
import { sampleFields } from '../fields.js';
import { Lru, onClearAll } from './lru.js';

// packed field vector layout
export const FI = { coastM: 0, ridge: 1, ice: 2, density: 3, emission: 4, urban: 5, farm: 6, zoneO: 7, canal: 8, rift: 9, park: 10, canyon: 11, pass: 12, frost: 13 };
const NF = 14;
const KMIN = -4, KMAX = 7;
const SP = []; for (let k = KMIN; k <= KMAX; k++) SP[k - KMIN] = 20800 * Math.pow(2, -k);
const SPU = SP.map((s) => s / R);                     // spacing in unit-sphere units
const nodeCache = new Lru(160000, 'lattice.nodeCache');
const F = {};
let calls = 0;
export function latticeCalls() { return calls; }
/** diagnostics: node count per lattice level k (spacing 20.8 km · 2^-k) */
export function latticeLevels() {
  const c = {};
  for (const m of [nodeCache.young, nodeCache.old]) for (const key of m.keys()) { const k = Math.floor(key / 281474976710656) + KMIN; c[k] = (c[k] || 0) + 1; }
  return c;
}

/** convert a sampleFields result into a packed vector */
export function packFields(Fx, arr, o = 0) {
  arr[o] = Fx.coastM !== undefined ? Fx.coastM : (Fx.coast || 0) * 50000;
  arr[o + 1] = Fx.ridge || 0; arr[o + 2] = Fx.ice || 0; arr[o + 3] = Fx.density || 0; arr[o + 4] = Fx.emission || 0;
  arr[o + 5] = Fx.urban || 0; arr[o + 6] = Fx.farm || 0; arr[o + 7] = Fx.zoneO || 0;
  arr[o + 8] = Fx.canal !== undefined && Fx.canal === Fx.canal ? Math.min(Fx.canal, 60000) : 60000;
  arr[o + 9] = Fx.rift || 0; arr[o + 10] = Fx.park || 0; arr[o + 11] = Fx.canyon || 0; arr[o + 12] = Fx.pass || 0;
  arr[o + 13] = Fx.frost || 0;
  return arr;
}

function node(k, ix, iy, iz) {
  const key = (((k - KMIN) * 65536 + (ix + 32768)) * 65536 + (iy + 32768)) * 65536 + (iz + 32768);
  let v = nodeCache.get(key);
  if (v !== undefined) return v;
  const q = SPU[k - KMIN];
  let x = ix * q, y = iy * q, z = iz * q;
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  x /= l; y /= l; z /= l;
  sampleFields(x, y, z, F);
  calls++;
  v = packFields(F, new Float32Array(NF));
  nodeCache.set(key, v);
  return v;
}

/** lattice level whose spacing is the largest one ≤ spacing (m) */
export function latticeLevel(spacing) {
  const k = Math.ceil(Math.log2(20800 / Math.max(1, spacing)));
  return k < KMIN ? KMIN : k > KMAX ? KMAX : k;
}

// last-cell cache (coherent raster queries hit the same cell many times in a row)
const CELL = { k: 99, ix: 0, iy: 0, iz: 0, v: new Array(8) };
onClearAll(() => { CELL.k = 99; CELL.v.fill(undefined); });
const ACC = new Float64Array(NF);

/**
 * Interpolated fields at unit vector (x,y,z). Writes the named fields of the sampleFields contract
 * (coastM, coast, ridge, ice, density, emission, urban, farm, zoneO, canal, rift, park, canyon, pass, frost).
 */
export function fieldsAt(x, y, z, spacing, out) {
  const k = latticeLevel(spacing);
  const q = SPU[k - KMIN];
  const gx = x / q, gy = y / q, gz = z / q;
  const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
  const fx = gx - ix, fy = gy - iy, fz = gz - iz;
  const V = CELL.v;
  if (CELL.k !== k || CELL.ix !== ix || CELL.iy !== iy || CELL.iz !== iz) {
    for (let c = 0; c < 8; c++) V[c] = node(k, ix + (c & 1), iy + ((c >> 1) & 1), iz + (c >> 2));
    CELL.k = k; CELL.ix = ix; CELL.iy = iy; CELL.iz = iz;
  }
  ACC.fill(0);
  for (let c = 0; c < 8; c++) {
    const w = (c & 1 ? fx : 1 - fx) * ((c >> 1) & 1 ? fy : 1 - fy) * (c >> 2 ? fz : 1 - fz);
    if (w < 1e-12) continue;
    const v = V[c];
    for (let i = 0; i < NF; i++) ACC[i] += v[i] * w;
  }
  out.coastM = ACC[0]; out.coast = ACC[0] >= 0 ? Math.min(1, ACC[0] / 50000) : Math.max(-1, ACC[0] / 50000);
  out.ridge = ACC[1]; out.ice = ACC[2]; out.density = ACC[3]; out.emission = ACC[4]; out.urban = ACC[5]; out.farm = ACC[6];
  out.zoneO = ACC[7]; out.canal = ACC[8] >= 59999 ? 1e9 : ACC[8]; out.rift = ACC[9]; out.park = ACC[10]; out.canyon = ACC[11];
  out.pass = ACC[12]; out.frost = ACC[13];
  return out;
}

/** exact fields at a point (one sampleFields call) in the same named layout */
export function fieldsExact(x, y, z, out) {
  sampleFields(x, y, z, F);
  calls++;
  out.coastM = F.coastM !== undefined ? F.coastM : (F.coast || 0) * 50000;
  out.coast = F.coast; out.ridge = F.ridge || 0; out.ice = F.ice || 0; out.density = F.density || 0; out.emission = F.emission || 0;
  out.urban = F.urban || 0; out.farm = F.farm || 0; out.zoneO = F.zoneO || 0; out.canal = F.canal !== undefined && F.canal === F.canal ? F.canal : 1e9;
  out.rift = F.rift || 0; out.park = F.park || 0; out.canyon = F.canyon || 0; out.pass = F.pass || 0; out.frost = F.frost || 0;
  out.zone = F.zone; out.province = F.province; out.lat = F.lat; out.lon = F.lon;
  return out;
}

/** copy a caller-provided sampleFields result into the named layout */
export function fieldsFrom(Fx, out) {
  out.coastM = Fx.coastM !== undefined ? Fx.coastM : (Fx.coast || 0) * 50000;
  out.coast = Fx.coast; out.ridge = Fx.ridge || 0; out.ice = Fx.ice || 0; out.density = Fx.density || 0; out.emission = Fx.emission || 0;
  out.urban = Fx.urban || 0; out.farm = Fx.farm || 0; out.zoneO = Fx.zoneO || 0; out.canal = Fx.canal !== undefined && Fx.canal === Fx.canal ? Fx.canal : 1e9;
  out.rift = Fx.rift || 0; out.park = Fx.park || 0; out.canyon = Fx.canyon || 0; out.pass = Fx.pass || 0; out.frost = Fx.frost || 0;
  return out;
}
