// Planet coordinate systems (float64, worker-safe, no THREE dependency).
//
// ECEF ("planet frame", metres, origin = planet centre, right-handed, THREE world axes):
//   +Y = north pole, +Z = (lat 0, lon 0), +X = (lat 0, lon 90°E)
//   unit(lat,lon) = (cos(lat)·sin(lon), sin(lat), cos(lat)·cos(lon))
// Local tangent frame at a point (prompt §4): +X = east, +Y = up, −Z = north (so +Z = south).
// Equirectangular maps: u = (lon+180)/360 (left edge 180°W), v = (90−lat)/180 (top = north).
//
// Cube sphere (quadtree + planning grid): 6 faces, face-uniform coords (a,b) ∈ [-1,1]²,
//   cube point = N + tan(πa/4)·U + tan(πb/4)·V, normalised. U×V = N (outward), so CCW
//   triangles in (a,b) are front facing from outside.

import { R, DEG, RAD, FACE_ARC } from './constants.js';

// face: [N, U, V]
export const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],   // 0 +X (lon 90E)
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],   // 1 -X (lon 90W)
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],   // 2 +Y (north pole)
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],   // 3 -Y (south pole)
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],    // 4 +Z (lon 0)
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],  // 5 -Z (lon 180)
];

// ---------------------------------------------------------------------------
// Lat/lon <-> unit vector / ECEF
// ---------------------------------------------------------------------------
export function latLonToUnit(latDeg, lonDeg, out = {}) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  const c = Math.cos(la);
  out.x = c * Math.sin(lo); out.y = Math.sin(la); out.z = c * Math.cos(lo);
  return out;
}

export function unitToLatLon(x, y, z, out = {}) {
  const r = Math.hypot(x, y, z) || 1;
  out.lat = Math.asin(Math.max(-1, Math.min(1, y / r))) * RAD;
  out.lon = Math.atan2(x, z) * RAD;
  return out;
}

/** ECEF position (metres) of a point at height h (m above sea level) */
export function latLonHToEcef(latDeg, lonDeg, h = 0, out = {}) {
  latLonToUnit(latDeg, lonDeg, out);
  const r = R + h;
  out.x *= r; out.y *= r; out.z *= r;
  return out;
}

export function ecefToLatLonH(x, y, z, out = {}) {
  const r = Math.hypot(x, y, z);
  unitToLatLon(x, y, z, out);
  out.h = r - R;
  return out;
}

/**
 * Local tangent basis at (lat, lon) in ECEF axes.
 * east = +X_local, up = +Y_local, south = +Z_local (north = −Z_local).
 * Returned as 3 arrays of 3 numbers. Column-major rotation matrix [east, up, south].
 */
export function enuBasis(latDeg, lonDeg, out = {}) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  const sla = Math.sin(la), cla = Math.cos(la), slo = Math.sin(lo), clo = Math.cos(lo);
  out.east = [clo, 0, -slo];
  out.up = [cla * slo, sla, cla * clo];
  out.north = [-sla * slo, cla, -sla * clo];
  out.south = [sla * slo, -cla, sla * clo];
  return out;
}

/** Same as enuBasis but from an ECEF/unit direction (avoids trig when you already have p). */
export function enuBasisFromUnit(x, y, z, out = {}) {
  const r = Math.hypot(x, y, z) || 1; const ux = x / r, uy = y / r, uz = z / r;
  // east = normalize(Y × up) ; handles poles by falling back to +X
  let ex = uz, ey = 0, ez = -ux; let el = Math.hypot(ex, ez);
  if (el < 1e-12) { ex = 1; ez = 0; el = 1; }
  ex /= el; ez /= el;
  // north = up × east
  const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;
  out.east = [ex, ey, ez]; out.up = [ux, uy, uz]; out.north = [nx, ny, nz]; out.south = [-nx, -ny, -nz];
  return out;
}

/**
 * Convert a local ENU offset (east, up, north in metres; NOTE local +Z = south, so pass
 * localZ and it is interpreted as south) around an ECEF origin into ECEF.
 */
export function localToEcef(origin, basis, lx, ly, lz, out = {}) {
  const e = basis.east, u = basis.up, s = basis.south;
  out.x = origin.x + e[0] * lx + u[0] * ly + s[0] * lz;
  out.y = origin.y + e[1] * lx + u[1] * ly + s[1] * lz;
  out.z = origin.z + e[2] * lx + u[2] * ly + s[2] * lz;
  return out;
}

export function ecefToLocal(origin, basis, x, y, z, out = {}) {
  const dx = x - origin.x, dy = y - origin.y, dz = z - origin.z;
  const e = basis.east, u = basis.up, s = basis.south;
  out.x = e[0] * dx + e[1] * dy + e[2] * dz;
  out.y = u[0] * dx + u[1] * dy + u[2] * dz;
  out.z = s[0] * dx + s[1] * dy + s[2] * dz;
  return out;
}

// ---------------------------------------------------------------------------
// Distances / bearings on the sphere (sea-level radius)
// ---------------------------------------------------------------------------
export function greatCircleDistance(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dp = p2 - p1, dl = (lon2 - lon1) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** initial bearing (deg, 0 = north, 90 = east) */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * RAD + 360) % 360;
}

/** destination from start, bearing (deg), distance (m) */
export function destination(latDeg, lonDeg, bearingDeg, dist, out = {}) {
  const d = dist / R, b = bearingDeg * DEG, p1 = latDeg * DEG, l1 = lonDeg * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  out.lat = p2 * RAD; out.lon = ((l2 * RAD + 540) % 360) - 180;
  return out;
}

export function wrapLon(lon) { return ((lon + 540) % 360) - 180; }

// ---------------------------------------------------------------------------
// Cube sphere
// ---------------------------------------------------------------------------
const QPI = Math.PI / 4;

/** unit/any vector -> {face, a, b} face-uniform coordinates in [-1,1] */
export function vecToFace(x, y, z, out = {}) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face;
  if (ax >= ay && ax >= az) face = x > 0 ? 0 : 1;
  else if (ay >= az) face = y > 0 ? 2 : 3;
  else face = z > 0 ? 4 : 5;
  const [N, U, V] = FACES[face];
  const dn = x * N[0] + y * N[1] + z * N[2];
  const s = (x * U[0] + y * U[1] + z * U[2]) / dn;
  const t = (x * V[0] + y * V[1] + z * V[2]) / dn;
  out.face = face; out.a = Math.atan(s) / QPI; out.b = Math.atan(t) / QPI;
  return out;
}

/** {face, a, b} -> unit vector */
export function faceToVec(face, a, b, out = {}) {
  const [N, U, V] = FACES[face];
  const s = Math.tan(a * QPI), t = Math.tan(b * QPI);
  const x = N[0] + s * U[0] + t * V[0];
  const y = N[1] + s * U[1] + t * V[1];
  const z = N[2] + s * U[2] + t * V[2];
  const l = Math.hypot(x, y, z);
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}

/** Face-plane metres (planning grid). a,b ∈[-1,1] -> metres. Approximately isotropic. */
export function faceToPlane(a, b, out = {}) { out.X = a * FACE_ARC; out.Y = b * FACE_ARC; return out; }
export function planeToFace(X, Y, out = {}) { out.a = X / FACE_ARC; out.b = Y / FACE_ARC; return out; }

/**
 * Local metric scale of face-plane metres at (a,b): true ground metres per plane metre along
 * a and b. Used by planners to keep blocks near their intended size everywhere on the face.
 */
export function facePlaneScale(a, b, out = {}) {
  const s = Math.tan(a * QPI), t = Math.tan(b * QPI);
  const d2 = 1 + s * s + t * t;
  const dsda = QPI * (1 + s * s), dtdb = QPI * (1 + t * t);
  // derivative of normalised cube point wrt s (magnitude): sqrt(1+t^2)/d2 ; wrt t: sqrt(1+s^2)/d2
  const ka = (Math.sqrt(1 + t * t) / d2) * dsda * R / FACE_ARC;
  const kb = (Math.sqrt(1 + s * s) / d2) * dtdb * R / FACE_ARC;
  out.ka = ka; out.kb = kb;
  return out;
}

// ---------------------------------------------------------------------------
// Quadtree tiles: key = {face, level, x, y}; tile covers
//   a ∈ [-1 + 2x/2^L, -1 + 2(x+1)/2^L], b likewise with y.
// ---------------------------------------------------------------------------
export function tileKey(face, level, x, y) { return `${face}/${level}/${x}/${y}`; }
export function parseTileKey(key) { const [f, l, x, y] = key.split('/').map(Number); return { face: f, level: l, x, y }; }

export function tileBounds(face, level, x, y, out = {}) {
  const n = 1 << level, s = 2 / n;
  out.a0 = -1 + x * s; out.a1 = out.a0 + s; out.b0 = -1 + y * s; out.b1 = out.b0 + s;
  return out;
}

/** tile containing unit vector at given level */
export function tileAt(x, y, z, level, out = {}) {
  const f = vecToFace(x, y, z);
  const n = 1 << level;
  out.face = f.face; out.level = level;
  out.x = Math.min(n - 1, Math.max(0, Math.floor((f.a + 1) * 0.5 * n)));
  out.y = Math.min(n - 1, Math.max(0, Math.floor((f.b + 1) * 0.5 * n)));
  return out;
}

/** approximate edge length of a tile in metres */
export function tileSizeMeters(level) { return (2 * FACE_ARC) / (1 << level); }

/** ECEF centre of a tile at sea level */
export function tileCenterUnit(face, level, x, y, out = {}) {
  const b = tileBounds(face, level, x, y);
  return faceToVec(face, (b.a0 + b.a1) / 2, (b.b0 + b.b1) / 2, out);
}

// ---------------------------------------------------------------------------
// Building frame (ARCHITECTURE.md §Building local frame)
//   origin: footprint centre at height ground.entrance; +Y up; +Z = outward normal of the FRONT
//   facade; +X = right-hand side for a viewer standing outside looking at the front.
//   heading = compass direction (deg, clockwise from north) the front faces.
//   In the local tangent frame (x east, z south) the building is rotated about +Y by (180-heading)°.
// Returns ECEF unit axes {x:[..], y:[..], z:[..]} of the building frame.
// ---------------------------------------------------------------------------
export function buildingAxes(latDeg, lonDeg, headingDeg, out = {}) {
  const B = enuBasis(latDeg, lonDeg);
  const phi = (180 - headingDeg) * DEG, c = Math.cos(phi), s = Math.sin(phi);
  // rotation about local up: x' = c*E - s*S ... (right-handed about +Y: x->(c,0,-s), z->(s,0,c))
  const E = B.east, S = B.south, U = B.up;
  out.x = [c * E[0] - s * S[0], c * E[1] - s * S[1], c * E[2] - s * S[2]];
  out.y = [U[0], U[1], U[2]];
  out.z = [s * E[0] + c * S[0], s * E[1] + c * S[1], s * E[2] + c * S[2]];
  return out;
}
