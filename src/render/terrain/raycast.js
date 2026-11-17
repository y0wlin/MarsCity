// Exact ray / tile-mesh intersection against the grid triangles of loaded terrain tiles
// (float64, tile-relative). Per tile an 8×8 block min/max box hierarchy is built lazily.
// OWNER: terrain-render agent.
import { N, NV } from './config.js';

const BLK = 8;                 // quads per block edge
const NBLK = N / BLK;          // blocks per tile edge

/** Lazily build per-block AABBs (tile-relative coordinates). */
export function ensureBlocks(tile) {
  if (tile.rayBlocks) return tile.rayBlocks;
  const p = tile.positions;
  const boxes = new Float64Array(NBLK * NBLK * 6);
  for (let bj = 0; bj < NBLK; bj++) for (let bi = 0; bi < NBLK; bi++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let j = bj * BLK; j <= bj * BLK + BLK; j++) for (let i = bi * BLK; i <= bi * BLK + BLK; i++) {
      const o = (j * NV + i) * 3;
      const x = p[o], y = p[o + 1], z = p[o + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const pad = 1e-3;
    const b = (bj * NBLK + bi) * 6;
    boxes[b] = x0 - pad; boxes[b + 1] = y0 - pad; boxes[b + 2] = z0 - pad; boxes[b + 3] = x1 + pad; boxes[b + 4] = y1 + pad; boxes[b + 5] = z1 + pad;
  }
  tile.rayBlocks = boxes;
  return boxes;
}

function rayBox(ox, oy, oz, ix, iy, iz, b, o, tmax) {
  let t0 = 0, t1 = tmax;
  let ta = (b[o] - ox) * ix, tb = (b[o + 3] - ox) * ix;
  if (ta > tb) { const s = ta; ta = tb; tb = s; }
  t0 = ta > t0 ? ta : t0; t1 = tb < t1 ? tb : t1; if (t0 > t1) return -1;
  ta = (b[o + 1] - oy) * iy; tb = (b[o + 4] - oy) * iy;
  if (ta > tb) { const s = ta; ta = tb; tb = s; }
  t0 = ta > t0 ? ta : t0; t1 = tb < t1 ? tb : t1; if (t0 > t1) return -1;
  ta = (b[o + 2] - oz) * iz; tb = (b[o + 5] - oz) * iz;
  if (ta > tb) { const s = ta; ta = tb; tb = s; }
  t0 = ta > t0 ? ta : t0; t1 = tb < t1 ? tb : t1; if (t0 > t1) return -1;
  return t0;
}

// Möller–Trumbore, double sided; returns t or -1
function rayTri(ox, oy, oz, dx, dy, dz, p, a, b, c) {
  const ax = p[a], ay = p[a + 1], az = p[a + 2];
  const e1x = p[b] - ax, e1y = p[b + 1] - ay, e1z = p[b + 2] - az;
  const e2x = p[c] - ax, e2y = p[c + 1] - ay, e2z = p[c + 2] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 ? t : -1;
}

const ORDER = [];
/**
 * Intersect a ray (origin relative to the tile centre, unit dir) with the tile's grid triangles.
 * Returns the nearest t (< tmax) or -1.
 */
export function raycastTile(tile, ox, oy, oz, dx, dy, dz, tmax) {
  const boxes = ensureBlocks(tile);
  const p = tile.positions;
  const ix = 1 / (Math.abs(dx) > 1e-15 ? dx : 1e-15), iy = 1 / (Math.abs(dy) > 1e-15 ? dy : 1e-15), iz = 1 / (Math.abs(dz) > 1e-15 ? dz : 1e-15);
  ORDER.length = 0;
  for (let b = 0; b < NBLK * NBLK; b++) {
    const t = rayBox(ox, oy, oz, ix, iy, iz, boxes, b * 6, tmax);
    if (t >= 0) ORDER.push(t, b);
  }
  if (!ORDER.length) return -1;
  // sort block hits by entry distance (pairs)
  const n = ORDER.length / 2;
  const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => ORDER[a * 2] - ORDER[b * 2]);
  let best = tmax;
  let found = false;
  for (let q = 0; q < n; q++) {
    const tEntry = ORDER[idx[q] * 2]; if (tEntry > best) break;
    const blk = ORDER[idx[q] * 2 + 1];
    const bi = blk % NBLK, bj = (blk / NBLK) | 0;
    for (let j = bj * BLK; j < bj * BLK + BLK; j++) for (let i = bi * BLK; i < bi * BLK + BLK; i++) {
      const v00 = (j * NV + i) * 3, v10 = v00 + 3, v01 = v00 + NV * 3, v11 = v01 + 3;
      let t1, t2;
      if (((i + j) & 1) === 0) { t1 = rayTri(ox, oy, oz, dx, dy, dz, p, v00, v10, v11); t2 = rayTri(ox, oy, oz, dx, dy, dz, p, v00, v11, v01); }
      else { t1 = rayTri(ox, oy, oz, dx, dy, dz, p, v00, v10, v01); t2 = rayTri(ox, oy, oz, dx, dy, dz, p, v10, v11, v01); }
      if (t1 >= 0 && t1 < best) { best = t1; found = true; }
      if (t2 >= 0 && t2 < best) { best = t2; found = true; }
    }
  }
  return found ? best : -1;
}

/** ray / sphere entry distance (or -1); centre relative to ray origin */
export function raySphere(cx, cy, cz, r, dx, dy, dz) {
  const b = cx * dx + cy * dy + cz * dz;
  const c = cx * cx + cy * cy + cz * cz - r * r;
  if (c <= 0) return 0;                      // origin inside
  if (b < 0) return -1;
  const disc = b * b - c; if (disc < 0) return -1;
  return b - Math.sqrt(disc);
}
