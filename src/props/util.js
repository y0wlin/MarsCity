// Small shared helpers for the props system (frames, hashing, polylines). OWNER: props agent.
// Worker-safe except for the THREE-based Frame.apply (only used on the main thread).
import { R, CITY_TILE_LEVEL } from '../core/constants.js';
import { tileBounds, faceToVec, enuBasisFromUnit, tileKey } from '../core/geo.js';

/** Tile-local frame of a CITY_TILE_LEVEL tile (identical to urban/citytile.js): origin = tile centre
 *  at sea level, E = +x (east), U = +y (up), S = +z (south). */
export function tileFrame(face, x, y, level = CITY_TILE_LEVEL) {
  const b = tileBounds(face, level, x, y);
  const c = faceToVec(face, (b.a0 + b.a1) / 2, (b.b0 + b.b1) / 2, {});
  const B = enuBasisFromUnit(c.x, c.y, c.z, {});
  return { key: tileKey(face, level, x, y), face, x, y, level, c, ox: c.x * R, oy: c.y * R, oz: c.z * R, E: B.east, U: B.up, S: B.south, bounds: b };
}

/** local (x,y,z) of frame F -> ECEF */
export function frameToEcef(F, x, y, z, out = {}) {
  out.x = F.ox + F.E[0] * x + F.U[0] * y + F.S[0] * z;
  out.y = F.oy + F.E[1] * x + F.U[1] * y + F.S[1] * z;
  out.z = F.oz + F.E[2] * x + F.U[2] * y + F.S[2] * z;
  return out;
}
/** ECEF -> local of frame F */
export function ecefToFrame(F, X, Y, Z, out = {}) {
  const dx = X - F.ox, dy = Y - F.oy, dz = Z - F.oz;
  out.x = F.E[0] * dx + F.E[1] * dy + F.E[2] * dz;
  out.y = F.U[0] * dx + F.U[1] * dy + F.U[2] * dz;
  out.z = F.S[0] * dx + F.S[1] * dy + F.S[2] * dz;
  return out;
}
/** frame for an arbitrary ECEF point (projected onto the sea-level sphere) */
export function pointFrame(X, Y, Z) {
  const l = Math.hypot(X, Y, Z) || 1; const ux = X / l, uy = Y / l, uz = Z / l;
  const B = enuBasisFromUnit(ux, uy, uz, {});
  return { c: { x: ux, y: uy, z: uz }, ox: ux * R, oy: uy * R, oz: uz * R, E: B.east, U: B.up, S: B.south };
}

/** local tile point (x,z) on the sea-level sphere -> unit vector (gnomonic, as urban/citytile.js) */
export function frameUnit(F, x, z, out = {}) {
  const px = F.c.x + (F.E[0] * x + F.S[0] * z) / R;
  const py = F.c.y + (F.E[1] * x + F.S[1] * z) / R;
  const pz = F.c.z + (F.E[2] * x + F.S[2] * z) / R;
  const l = Math.hypot(px, py, pz);
  out.x = px / l; out.y = py / l; out.z = pz / l;
  return out;
}

// ---------------------------------------------------------------------------------------------
// hashing (deterministic, independent of the world hash channels used elsewhere)
// ---------------------------------------------------------------------------------------------
export function strHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function mix32(a, b) {
  let h = (a ^ Math.imul(b | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
export const u01 = (h) => (h >>> 0) / 4294967296;
/** small seeded PRNG */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// polylines ([[x,y,z],...] in a local frame)
// ---------------------------------------------------------------------------------------------
export function cumLengths(pts) {
  const L = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) L[i] = L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
  return L;
}
/** point at arc length s (xz length) with tangent; out = {x,y,z,tx,tz} */
export function pointAlong(pts, L, s, out) {
  const n = pts.length;
  if (s <= 0) s = 0; else if (s >= L[n - 1]) s = L[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi];
  const seg = L[hi] - L[lo] || 1e-9, f = (s - L[lo]) / seg;
  out.x = a[0] + (b[0] - a[0]) * f; out.y = a[1] + (b[1] - a[1]) * f; out.z = a[2] + (b[2] - a[2]) * f;
  let tx = b[0] - a[0], tz = b[2] - a[2]; const tl = Math.hypot(tx, tz) || 1;
  out.tx = tx / tl; out.tz = tz / tl;
  return out;
}

export function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** distance from (x,z) to the polygon boundary */
export function polyEdgeDist(poly, x, z) {
  let d = 1e30;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return d;
}
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}
export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]);
  return Math.abs(a) / 2;
}
export function polyBounds(poly) {
  let x0 = 1e30, z0 = 1e30, x1 = -1e30, z1 = -1e30;
  for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  return { x0, z0, x1, z1 };
}

/** sun elevation sine at a unit up vector (ECEF) */
export function sunSin(sunDir, ux, uy, uz) { return sunDir.x * ux + sunDir.y * uy + sunDir.z * uz; }

/** night factor for street lights: 0 by day, 1 when the sun is ~3 deg below the horizon */
export function nightFactor(sinElev) { return smooth(0.05, -0.05, sinElev); }
