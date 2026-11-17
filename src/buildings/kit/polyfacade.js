// Polygon / round footprints: facades along every edge of a plan polygon with real openings,
// plinths, parapets with seamless copings, roof decks and band projectors. Used by the round
// residential tower; also the base for 'poly' / 'L' / round footprints of other types.
//
// Facade order: polygons are listed like the rectangle perimeter used everywhere else — front-left
// → front-right → back-right → back-left (negative shoelace area in (x, z)) — so walking an edge
// a → b the outside is on the right of a viewer standing outside... i.e. the edge frame is
//   u = (b − a)/|b − a| (left → right seen from outside), v = up, n = (−u.z, 0, u.x) outward,
// exactly the wall frame of walls.js / facadeFrame(). `perimU` (metres along the perimeter from
// vertex 0) is the far-facade / window-bay coordinate.

import { wallWithOpenings } from './walls.js';
import { polyArea } from './math.js';

/** Re-order a plan polygon [[x,z]...] into facade order (negative shoelace area). */
export function facadeOrder(poly) {
  return polyArea(poly) > 0 ? poly.slice().reverse() : poly.slice();
}

/**
 * Regular n-gon approximating a circle of radius r (vertices ON the circle) in facade order, with
 * the first facet centred on the front (+z). Returns [[x,z]...].
 */
export function ringPolygon(cx, cz, r, n) {
  const out = [];
  const a0 = Math.PI / 2 + Math.PI / n;      // front-left vertex of the front facet
  for (let k = 0; k < n; k++) { const a = a0 - (k * 2 * Math.PI) / n; out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return out;
}

/** Edges of a facade-ordered polygon: [{i, a:[x,z], b:[x,z], L, ux, uz, nx, nz, perimU}]. */
export function polyEdges(poly) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1e-9;
    const ux = dx / L, uz = dz / L;
    out.push({ i, a, b: c, L, ux, uz, nx: -uz, nz: ux, perimU: acc });
    acc += L;
  }
  return out;
}

/** Enter the wall frame of an edge (call b.push() before / b.pop() after). */
export function edgeFrame(b, e, inset = 0) {
  b.frame(e.a[0] - e.nx * inset, 0, e.a[1] - e.nz * inset, e.ux, 0, e.uz, 0, 1, 0, e.nx, 0, e.nz);
  return e.L;
}

/**
 * Walls along every edge with openings.
 * o: { y0, y1, T, outer, inner (null at 'exterior'), innerReveals, revealKey, chamfer,
 *      openings(e) -> [{u0,u1,v0,v1,reveal?,noSillReveal?}],  units(e, ops) -> void (emit window units
 *      in the same edge frame), tint }
 */
export function polyWalls(b, poly, o) {
  const edges = polyEdges(poly);
  for (const e of edges) {
    const ops = o.openings ? o.openings(e) : [];
    b.push(); edgeFrame(b, e);
    if (o.tint) b.pushTint(o.tint);
    wallWithOpenings(b, { L: e.L, y0: o.y0, y1: o.y1, T: o.T ?? 0.3, openings: ops, outer: o.outer, inner: o.inner ?? null, innerReveals: !!o.innerReveals, revealKey: o.revealKey, innerY1: o.innerY1 });
    if (o.tint) b.popTint();
    if (o.units) o.units(e, ops);
    b.pop();
  }
  return edges;
}

/**
 * Base course around a polygon from 0.6 m below the lowest terrain up to `top`, projecting `proj`
 * with a weathered top chamfer (ground: number = relative terrain height, or fn(x,z)).
 */
export function polyPlinth(b, poly, top, ground, o = {}) {
  const key = o.key || 'stone_plinth', proj = o.proj ?? 0.035;
  const g = typeof ground === 'function' ? ground : () => ground || 0;
  for (const e of polyEdges(poly)) {
    const g0 = Math.min(g(e.a[0], e.a[1]), top) - 0.6, g1 = Math.min(g(e.b[0], e.b[1]), top) - 0.6;
    b.push(); edgeFrame(b, e);
    // outward offset faces; ends meet the neighbouring edge's faces at the vertex (no gaps on convex rings)
    b.quad(key, -proj * 0.2, g0, proj, e.L + proj * 0.2, g1, proj, e.L + proj * 0.2, top - 0.012, proj, -proj * 0.2, top - 0.012, proj);
    b.quad(key, -proj * 0.2, top - 0.012, proj, e.L + proj * 0.2, top - 0.012, proj, e.L + proj * 0.2, top, proj - 0.012, -proj * 0.2, top, proj - 0.012);
    b.quad(key, -proj * 0.2, top, proj - 0.012, e.L + proj * 0.2, top, proj - 0.012, e.L + proj * 0.2, top, 0.0, -proj * 0.2, top, 0.0);
    b.pop();
  }
}

/** Offset a facade-ordered polygon inward by d (positive = inwards, mitred). */
export function insetPolygon(poly, d) {
  const n = poly.length, out = [];
  const E = polyEdges(poly);
  for (let i = 0; i < n; i++) {
    const e0 = E[(i - 1 + n) % n], e1 = E[i];
    let mx = e0.nx + e1.nx, mz = e0.nz + e1.nz; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = 1 / Math.max(0.2, mx * e1.nx + mz * e1.nz);
    out.push([poly[i][0] - mx * d * k, poly[i][1] - mz * d * k]);
  }
  return out;
}

/**
 * Parapet on a polygon roof: inner faces (from roof level y to y + h) and a seamless coping swept
 * around the wall centreline. Outer faces are the facade walls (extend them to y + h).
 */
export function polyParapet(b, poly, y, h, T, o = {}) {
  const ik = o.innerKey || 'render_white', ck = o.copingKey || 'aluminium';
  for (const e of polyEdges(poly)) {
    b.push(); edgeFrame(b, e);
    b.rectZ(ik, 0, y, e.L, y + h, -T, -1);
    b.box(o.membraneKey || 'roof_membrane', 0, y, -T - 0.03, e.L, y + 0.16, -T, 16 | 4);
    b.pop();
  }
  // coping: closed sweep along the wall centreline (profile s = outward)
  const mid = insetPolygon(poly, T / 2);
  const ov = 0.03, hh = 0.06, top = y + h;
  const prof = [[-T / 2 - ov, -0.02], [-T / 2 - ov + 0.006, -0.026], [T / 2 + ov - 0.006, -0.026], [T / 2 + ov, -0.02], [T / 2 + ov, hh * 0.55], [0, hh], [-T / 2 - ov, hh * 0.55]];
  b.sweep(ck, mid.map((p) => [p[0], top, p[1]]), prof, { closed: true, smoothAngle: 25 });
}

/** Radial projector for bands around a circle-like footprint of wall radius r (centre cx, cz). */
export function radialProjector(cx, cz, r) {
  return (x, z, inset, out) => {
    const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
    const rr = r - inset;
    out[0] = cx + (dx / l) * rr; out[1] = cz + (dz / l) * rr;
    return out;
  };
}
/** Inside test for a circle-like footprint. */
export function radialInside(cx, cz, r) { return (x, z, m = 0) => Math.hypot(x - cx, z - cz) < r + m; }

/**
 * Closed band path around a ring of wall radius r: projection depth(θ) (number or fn of the angle
 * θ measured like ringPolygon: θ = π/2 at the front, decreasing clockwise), sampled every `step` m.
 * Returns {pts, closed:true} in facade order (compatible with curvedBand / railLine).
 */
export function ringBandPath(cx, cz, r, depth, step = 0.45) {
  const fn = typeof depth === 'function' ? depth : () => depth;
  const n = Math.max(24, Math.ceil((2 * Math.PI * (r + 1)) / step));
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = Math.PI / 2 - (k * 2 * Math.PI) / n;
    const rr = r + fn(a);
    pts.push([cx + rr * Math.cos(a), cz + rr * Math.sin(a)]);
  }
  return { pts, closed: true };
}
