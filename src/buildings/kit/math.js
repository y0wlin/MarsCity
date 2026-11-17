// Small worker-safe maths helpers for the building kit (no THREE objects, float64).
// 2D points are [x, z] arrays (plan view, building frame), 3D points are [x, y, z].
// None of these are used per-vertex in hot loops; they shape paths/profiles/plans.

import earcut from 'three/src/extras/lib/earcut.js';
import { Rng, hash4 } from '../../core/hash.js';

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// Seeded randomness (always derived from BuildingSpec.hash — never Math.random)
// ---------------------------------------------------------------------------
/** Sub-RNG for a named purpose so adding a feature never reshuffles another one. */
export function subRng(hash, channel, extra = 0) { return new Rng(hash4(hash | 0, channel | 0, extra | 0, 0x6b17)); }
/** Deterministic float in [0,1) for (hash, a, b, c). */
export function h01(hash, a = 0, b = 0, c = 0) { return hash4(hash | 0, a | 0, b | 0, c | 0) / 4294967296; }

// ---------------------------------------------------------------------------
// 2D polylines / polygons
// ---------------------------------------------------------------------------
export function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a * 0.5;
}
export function polyLength(pts, closed = false) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return L;
}
export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Arc points around (cx,cz) radius r from angle a0 to a1 (radians, CCW positive in x→z?).
 *  Angle convention: point = (cx + r·cos a, cz + r·sin a). `segs` segments → segs+1 points. */
export function arcPts(cx, cz, r, a0, a1, segs, out = []) {
  for (let i = 0; i <= segs; i++) { const a = a0 + ((a1 - a0) * i) / segs; out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return out;
}

/** Number of segments for an arc of radius r and angle span so that chord error < tol. */
export function arcSegs(r, span, tol = 0.01, min = 2, max = 48) {
  if (r <= 1e-6) return min;
  const step = 2 * Math.acos(clamp(1 - tol / r, -1, 1));
  return clamp(Math.ceil(Math.abs(span) / Math.max(step, 1e-3)), min, max);
}

/**
 * Rounded rectangle outline (closed, CCW in x/z when viewed from +Y... i.e. x right, z down
 * on screen means clockwise; we just keep a consistent order: front edge first, left→right).
 * Returned order: starts at front-left after the corner, goes along front (+z) towards +x,
 * then right side towards −z, back towards −x, left side towards +z.
 * radii: number or [frontRight, backRight, backLeft, frontLeft].
 */
export function roundedRect(x0, z0, x1, z1, radii = 0, tol = 0.01) {
  const R = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  const maxR = Math.min((x1 - x0) / 2, (z1 - z0) / 2);
  const [rfr, rbr, rbl, rfl] = R.map((r) => clamp(r, 0, maxR));
  const out = [];
  const corner = (cx, cz, r, a0, a1) => {
    if (r < 1e-4) { out.push([cx, cz]); return; }
    const segs = arcSegs(r, Math.abs(a1 - a0), tol, 3, 32);
    for (let i = 0; i <= segs; i++) { const a = a0 + ((a1 - a0) * i) / segs; out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  };
  // front edge z = z1 (front), from left to right; then corner front-right
  corner(x1 - rfr, z1 - rfr, rfr, Math.PI / 2, 0);            // front-right: from +z dir to +x dir
  corner(x1 - rbr, z0 + rbr, rbr, 0, -Math.PI / 2);           // back-right
  corner(x0 + rbl, z0 + rbl, rbl, -Math.PI / 2, -Math.PI);    // back-left
  corner(x0 + rfl, z1 - rfl, rfl, Math.PI, Math.PI / 2);      // front-left
  return dedupe(out, true);
}

/** Remove consecutive duplicate points (and closing duplicate when closed). */
export function dedupe(pts, closed = false, eps = 1e-6) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) > eps || Math.abs(q[1] - p[1]) > eps) out.push(p); }
  if (closed && out.length > 2) { const a = out[0], b = out[out.length - 1]; if (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps) out.pop(); }
  return out;
}

/** Chaikin corner cutting (keeps endpoints for open polylines). */
export function chaikin(pts, iterations = 2, closed = false) {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

/** Resample a polyline at roughly `step` spacing (keeps original vertices). */
export function densify(pts, step, closed = false) {
  const out = [];
  const n = pts.length;
  const lim = closed ? n : n - 1;
  for (let i = 0; i < lim; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/**
 * Offset a polyline/polygon in 2D by distance d to the LEFT of travel (x right, z "down"):
 * for travel direction (dx,dz) the left normal is (dz, −dx)... we define side = (−dz, dx)·(−1)
 * Simply: positive d moves points to the side given by normal n = (dz, −dx) (right-hand of
 * travel when +x is right and +z is towards the viewer of a plan drawn with z down).
 * Miter joins limited to `miterLimit`.
 */
export function offsetPolyline(pts, d, closed = false, miterLimit = 4) {
  const n = pts.length, out = [];
  const segN = (i) => {
    const a = pts[i], b = pts[(i + 1) % n];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    return [dz, -dx];
  };
  for (let i = 0; i < n; i++) {
    let nPrev, nNext;
    if (closed) { nPrev = segN((i - 1 + n) % n); nNext = segN(i); }
    else { nPrev = i > 0 ? segN(i - 1) : segN(i); nNext = i < n - 1 ? segN(i) : segN(i - 1); }
    let mx = nPrev[0] + nNext[0], mz = nPrev[1] + nNext[1]; const ml = Math.hypot(mx, mz);
    if (ml < 1e-9) { mx = nNext[0]; mz = nNext[1]; } else { mx /= ml; mz /= ml; }
    const cosHalf = mx * nNext[0] + mz * nNext[1];
    const k = Math.min(miterLimit, 1 / Math.max(cosHalf, 1e-6));
    out.push([pts[i][0] + mx * d * k, pts[i][1] + mz * d * k]);
  }
  return out;
}

/**
 * Douglas–Peucker simplification of a 2D polyline (keeps endpoints; closed loops keep 2 anchors).
 * Removes collinear samples on straight runs so sweeps stay light.
 */
export function simplify(pts, tol = 0.01, closed = false) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  const rec = (a, b) => {
    let md = 0, mi = -1;
    const ax = pts[a][0], az = pts[a][1], bx = pts[b][0], bz = pts[b][1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - az) * dz) / L2));
      const ex = ax + dx * t - pts[i][0], ez = az + dz * t - pts[i][1];
      const d2 = ex * ex + ez * ez;
      if (d2 > md) { md = d2; mi = i; }
    }
    if (mi >= 0 && md > tol * tol) { keep[mi] = 1; rec(a, mi); rec(mi, b); }
  };
  if (closed) {
    // split the loop at the point farthest from pts[0]
    let far = 0, fd = -1;
    for (let i = 1; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
    keep[0] = 1; keep[far] = 1;
    rec(0, far);
    const ext = [...pts, pts[0]];
    const k2 = new Uint8Array(ext.length);
    // second half
    const rec2 = (a, b) => {
      let md = 0, mi = -1;
      const ax = ext[a][0], az = ext[a][1], bx = ext[b][0], bz = ext[b][1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-12;
      for (let i = a + 1; i < b; i++) {
        const t = Math.max(0, Math.min(1, ((ext[i][0] - ax) * dx + (ext[i][1] - az) * dz) / L2));
        const ex = ax + dx * t - ext[i][0], ez = az + dz * t - ext[i][1];
        const d2 = ex * ex + ez * ez;
        if (d2 > md) { md = d2; mi = i; }
      }
      if (mi >= 0 && md > tol * tol) { k2[mi] = 1; rec2(a, mi); rec2(mi, b); }
    };
    rec2(far, pts.length);
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i] || k2[i]) out.push(pts[i]);
    return out;
  }
  keep[0] = 1; keep[pts.length - 1] = 1;
  rec(0, pts.length - 1);
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Cumulative arc length array for a polyline of [x,z] or [x,y,z] points. */
export function cumLength(pts) {
  const L = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let s = 0; for (let k = 0; k < a.length; k++) s += (b[k] - a[k]) ** 2;
    L[i] = L[i - 1] + Math.sqrt(s);
  }
  return L;
}

/** Point at distance s along polyline (2D or 3D). */
export function pointAt(pts, cum, s) {
  if (s <= 0) return pts[0].slice();
  const n = pts.length; if (s >= cum[n - 1]) return pts[n - 1].slice();
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / Math.max(cum[hi] - cum[lo], 1e-9);
  const a = pts[lo], b = pts[hi], out = [];
  for (let k = 0; k < a.length; k++) out.push(a[k] + (b[k] - a[k]) * t);
  return out;
}

/** Sub-polyline between distances s0..s1. */
export function slicePolyline(pts, cum, s0, s1) {
  const out = [pointAt(pts, cum, s0)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push(pts[i].slice());
  out.push(pointAt(pts, cum, s1));
  return out;
}

// ---------------------------------------------------------------------------
// Triangulation (earcut). Points [[x,y],...]; holes array of same. Returns flat index array
// into the concatenated (outer + holes) point list.
// ---------------------------------------------------------------------------
export function triangulate(outer, holes = []) {
  const flat = [];
  const holeIdx = [];
  for (const p of outer) flat.push(p[0], p[1]);
  for (const h of holes) { holeIdx.push(flat.length / 2); for (const p of h) flat.push(p[0], p[1]); }
  return earcut(flat, holeIdx.length ? holeIdx : null, 2);
}

/** Ensure polygon winding: CCW positive area in (x, y) math orientation when `ccw` true. */
export function orient(pts, ccw = true) {
  const a = polyArea(pts);
  if ((a > 0) !== ccw) return pts.slice().reverse();
  return pts;
}

// ---------------------------------------------------------------------------
// Interval helpers (facade layout)
// ---------------------------------------------------------------------------
/** Split length L into n near-equal parts, returning n+1 boundaries starting at a. */
export function splitEven(a, L, n) { const out = []; for (let i = 0; i <= n; i++) out.push(a + (L * i) / n); return out; }

/** Choose a count n so that L/n is within [minW, maxW], preferring L/n close to target. */
export function bayCount(L, minW = 3.3, maxW = 4.2, target = 3.75) {
  let best = Math.max(1, Math.round(L / target)), bestErr = 1e9;
  for (let n = Math.max(1, Math.floor(L / maxW)); n <= Math.max(1, Math.ceil(L / minW)); n++) {
    const w = L / n; const pen = (w < minW ? (minW - w) * 10 : 0) + (w > maxW ? (w - maxW) * 10 : 0);
    const err = Math.abs(w - target) + pen;
    if (err < bestErr) { bestErr = err; best = n; }
  }
  return best;
}

/** Merge overlapping [a,b] intervals (sorted output). */
export function mergeIntervals(list) {
  const s = list.filter((r) => r[1] > r[0]).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const r of s) { const l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push([r[0], r[1]]); }
  return out;
}

/** Complement of intervals within [a,b]. */
export function gaps(a, b, list) {
  const m = mergeIntervals(list); const out = []; let x = a;
  for (const r of m) { if (r[0] > x) out.push([x, Math.min(r[0], b)]); x = Math.max(x, r[1]); if (x >= b) break; }
  if (x < b) out.push([x, b]);
  return out.filter((r) => r[1] - r[0] > 1e-4);
}

// ---------------------------------------------------------------------------
// Colours (linear RGB multipliers for vertex tints)
// ---------------------------------------------------------------------------
export function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
/** Hex sRGB (0xrrggbb) → linear [r,g,b]. */
export function hexLin(hex) { return [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)]; }
/** Mix two RGB triplets. */
export function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
/** Scale RGB. */
export function mulRgb(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
