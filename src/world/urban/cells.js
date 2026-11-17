// Cube-sphere cell helpers for the urban plan (pure, float64, worker-safe).
// The plan uses the cube faces only to ENUMERATE things (district seeds, towns): all geometry
// is measured in 3D / on the sphere, so nothing changes across face edges (no seams).
import { R, FACE_ARC } from '../../core/constants.js';
import { FACES, faceToVec, vecToFace } from '../../core/geo.js';

export const N0 = 256;                       // level-0 cells per face edge (≈ 20.8 km plane, 14.7–20.8 km true)
export const S0 = 2 / N0;                    // level-0 cell size in face units
export const MAX_DLEVEL = 3;                 // district quadtree depth under a level-0 cell (→ 2.6 km plane)
const QPI = Math.PI / 4;

export function cell0Key(face, x, y) { return (face * N0 + x) * N0 + y; }
export function cell0FromKey(k, out = {}) { out.y = k % N0; const t = (k - out.y) / N0; out.x = t % N0; out.face = (t - out.x) / N0; return out; }

/** Face-uniform coords of a unit vector on a GIVEN face (gnomonic). Returns dn (=p·N); invalid if dn<=0. */
export function faceAB(face, x, y, z, out) {
  const F = FACES[face], N = F[0], U = F[1], V = F[2];
  const dn = x * N[0] + y * N[1] + z * N[2];
  out.dn = dn;
  if (dn <= 1e-9) { out.a = out.b = 99; return out; }
  out.a = Math.atan((x * U[0] + y * U[1] + z * U[2]) / dn) / QPI;
  out.b = Math.atan((x * V[0] + y * V[1] + z * V[2]) / dn) / QPI;
  return out;
}

const FA = { a: 0, b: 0, dn: 0 };
/**
 * Enumerate the cells of quadtree level `level` (N0·2^level per face edge) whose area may lie
 * within `radius` metres of the unit vector p, on every face. Conservative (may include extra
 * cells). cb(face, x, y) is called once per cell.
 */
const CC = {};
export function forCellsNear(px, py, pz, radius, level, cb) {
  const n = N0 << level, s = 2 / n;
  const da = (1.5 * radius) / FACE_ARC + 1e-9;   // face units (true→plane scale ≤ 1/0.707)
  const ang = radius / R;
  // exact-enough cap test on the cell centre: true lengths never exceed face-plane lengths, so
  // every point of a cell lies within 0.7072 · (plane cell size) of its centre
  const cosLim = Math.cos(Math.min(Math.PI, (radius + 0.7072 * s * FACE_ARC) / R));
  for (let f = 0; f < 6; f++) {
    faceAB(f, px, py, pz, FA);
    if (FA.dn <= 0) continue;
    // quick reject: is the cap anywhere near this face's square?
    if (FA.a < -1 - da || FA.a > 1 + da || FA.b < -1 - da || FA.b > 1 + da) continue;
    if (FA.dn < Math.cos(Math.PI / 4 + 0.62) && ang < 0.05) continue; // far from this face
    const x0 = Math.max(0, Math.floor(((FA.a - da) + 1) * 0.5 * n));
    const x1 = Math.min(n - 1, Math.floor(((FA.a + da) + 1) * 0.5 * n));
    const y0 = Math.max(0, Math.floor(((FA.b - da) + 1) * 0.5 * n));
    const y1 = Math.min(n - 1, Math.floor(((FA.b + da) + 1) * 0.5 * n));
    for (let xx = x0; xx <= x1; xx++) for (let yy = y0; yy <= y1; yy++) {
      faceToVec(f, -1 + (xx + 0.5) * s, -1 + (yy + 0.5) * s, CC);
      if (CC.x * px + CC.y * py + CC.z * pz < cosLim) continue;
      cb(f, xx, yy);
    }
  }
}

/** centre unit vector of a cell */
export function cellCenter(face, level, x, y, out = {}) {
  const n = N0 << level, s = 2 / n;
  return faceToVec(face, -1 + (x + 0.5) * s, -1 + (y + 0.5) * s, out);
}

/** true ground size (m) of a cell edge near its centre (geometric mean of the two axes) */
export function cellTrueSize(face, level, x, y) {
  const n = N0 << level, s = 2 / n;
  const a = -1 + (x + 0.5) * s, b = -1 + (y + 0.5) * s;
  const ts = Math.tan(a * QPI), tt = Math.tan(b * QPI);
  const d2 = 1 + ts * ts + tt * tt;
  const ka = (Math.sqrt(1 + tt * tt) / d2) * (1 + ts * ts);
  const kb = (Math.sqrt(1 + ts * ts) / d2) * (1 + tt * tt);
  return s * FACE_ARC * Math.sqrt(ka * kb);
}

export { vecToFace, faceToVec };
