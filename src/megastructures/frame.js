// Site frames for the megastructures (pure, worker-safe, float64). OWNER: megastructure agent.
//
// Authoring space = the sites.js gnomonic tangent frame of a site: x east, z south, y = metres above
// sea level. Chunk geometry is authored relative to a chunk centre (cx, cz) ("chunk-flat" coords,
// small numbers -> float32 safe) and then BENT exactly onto the sphere:
//     P_ecef = localToUnit(site, x + cx, z + cz) * (R + y)
//     v      = (P_ecef - A_chunk) expressed in the SITE axes (east, up, south at the site anchor)
// so long straight walls follow great circles, verticals are radial and the curvature drop
// (~15 m at 10 km) is exact. Every chunk mesh of a site uses the same quaternion (site axes ->
// ECEF); its position is A_chunk - origin each frame (camera-relative placement).
import { R } from '../core/constants.js';
import { localToUnit } from '../world/sites.js';

const DEG = Math.PI / 180;

/** ENU axes at the site anchor (ECEF unit vectors): east, up, south */
export function siteAxes(site) {
  if (site._ax) return site._ax;
  const la = site.lat * DEG, lo = site.lon * DEG;
  const ax = {
    east: [Math.cos(lo), 0, -Math.sin(lo)],
    up: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)],
    south: [Math.sin(la) * Math.sin(lo), -Math.cos(la), Math.sin(la) * Math.cos(lo)],
  };
  Object.defineProperty(site, '_ax', { value: ax, enumerable: false, writable: true });
  return ax;
}

/** quaternion [x,y,z,w] of the rotation site axes (x=east, y=up, z=south) -> ECEF */
export function siteQuaternion(site) {
  const { east: e, up: u, south: s } = siteAxes(site);
  // rotation matrix columns e, u, s
  const m00 = e[0], m01 = u[0], m02 = s[0], m10 = e[1], m11 = u[1], m12 = s[1], m20 = e[2], m21 = u[2], m22 = s[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; w = 0.25 * S; x = (m21 - m12) / S; y = (m02 - m20) / S; z = (m10 - m01) / S; }
  else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / S; x = 0.25 * S; y = (m01 + m10) / S; z = (m02 + m20) / S; }
  else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / S; x = (m01 + m10) / S; y = 0.25 * S; z = (m12 + m21) / S; }
  else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / S; x = (m02 + m20) / S; y = (m12 + m21) / S; z = 0.25 * S; }
  return [x, y, z, w];
}

const U = {};
/** ECEF of a site-local point (x east, z south, y = height above sea level) */
export function siteToEcef(site, x, y, z, out = {}) {
  localToUnit(site, x, z, U);
  const r = R + y;
  out.x = U.x * r; out.y = U.y * r; out.z = U.z * r;
  return out;
}

/** chunk anchor (ECEF, sea level under the chunk centre) */
export function chunkAnchor(site, cx, cz) { return siteToEcef(site, cx, 0, cz, {}); }

/**
 * Bend chunk-flat positions (Float32Array xyz, relative to (cx, cz), y absolute) in place onto the
 * sphere, relative to the chunk anchor, in site axes. Returns {min, max} bounds.
 */
export function bendPositions(site, cx, cz, anchor, pos) {
  const { east: e, up: u, south: s } = siteAxes(site);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0, n = pos.length; i < n; i += 3) {
    localToUnit(site, pos[i] + cx, pos[i + 2] + cz, U);
    const r = R + pos[i + 1];
    const dx = U.x * r - anchor.x, dy = U.y * r - anchor.y, dz = U.z * r - anchor.z;
    const X = dx * e[0] + dy * e[1] + dz * e[2];
    const Y = dx * u[0] + dy * u[1] + dz * u[2];
    const Z = dx * s[0] + dy * s[1] + dz * s[2];
    pos[i] = X; pos[i + 1] = Y; pos[i + 2] = Z;
    if (X < minX) minX = X; if (X > maxX) maxX = X;
    if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
    if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z;
  }
  if (!isFinite(minX)) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** ECEF -> site axes relative to an anchor (for picking / diagnostics) */
export function ecefToSiteAxes(site, anchor, p, out = {}) {
  const { east: e, up: u, south: s } = siteAxes(site);
  const dx = p.x - anchor.x, dy = p.y - anchor.y, dz = p.z - anchor.z;
  out.x = dx * e[0] + dy * e[1] + dz * e[2];
  out.y = dx * u[0] + dy * u[1] + dz * u[2];
  out.z = dx * s[0] + dy * s[1] + dz * s[2];
  return out;
}

/** site-local direction (x east, y up, z south) -> ECEF direction */
export function siteDirToEcef(site, dx, dy, dz, out = {}) {
  const { east: e, up: u, south: s } = siteAxes(site);
  out.x = e[0] * dx + u[0] * dy + s[0] * dz;
  out.y = e[1] * dx + u[1] * dy + s[1] * dz;
  out.z = e[2] * dx + u[2] * dy + s[2] * dz;
  return out;
}
