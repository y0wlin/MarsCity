// Walls with real openings (windows, doors, shopfronts, vents).
//
// All functions work in the builder's CURRENT local frame, which must be a "wall frame":
//   local x = u along the wall (0 → L, left → right as seen from OUTSIDE)
//   local y = up (same as building y when the frame comes from facadeFrame())
//   local z = outward normal; outer face at z = 0, inner face at z = −T
// Use facadeFrame(b, side, building) or b.frame(...) to enter one.
//
// The outer face is emitted as a full grid of cells between all opening edges so there are no
// T-junctions (no sparkling cracks). Openings get chamfered outer edges and reveals 0.15–0.3 m
// deep down to the window/door frame plane, plus optional inner reveals + inner face ('full').

import { PX, NX, PY, NY, PZ, NZ } from './MeshBuilder.js';

/**
 * @typedef {object} Opening
 * @property {number} u0  left edge (m along wall)
 * @property {number} u1  right edge
 * @property {number} v0  bottom (m, local y)
 * @property {number} v1  top
 * @property {number} [reveal=0.2]   depth of the outer reveal (outer face → frame plane)
 * @property {number} [chamfer=0.02] 45° chamfer on the outer opening edge
 * @property {boolean} [noSillReveal] skip the bottom reveal (door thresholds supply their own)
 * @property {string} [revealKey]     material of the reveal surfaces
 */

/**
 * Emit a wall with rectangular openings.
 * @param {MeshBuilder} b
 * @param {object} o
 * @param {number} o.L          wall length
 * @param {number} o.y0         bottom (local y)
 * @param {number} o.y1         top
 * @param {number} [o.T=0.3]    thickness
 * @param {Opening[]} [o.openings]
 * @param {string} o.outer      outer face material key
 * @param {string|null} [o.inner=null] inner face key (null: not emitted — 'exterior' LOD)
 * @param {string} [o.revealKey]  reveal key (default outer)
 * @param {boolean} [o.capStart=false] emit end face at u=0   (also o.capEnd at u=L)
 * @param {boolean} [o.capTop=false]   emit top face           (also o.capBottom)
 * @param {number} [o.chamferStart=0]  chamfer on the outer vertical corner at u=0 (also chamferEnd)
 * @param {number} [o.u0=0]     start u of the wall (wall spans u0..u0+L)
 * @param {boolean} [o.innerReveals] emit reveal surfaces from frame plane to the inner face
 * @param {number} [o.frameDepth=0.08] depth taken by the frame (inner reveal starts behind it)
 */
export function wallWithOpenings(b, o) {
  const T = o.T ?? 0.3, y0 = o.y0, y1 = o.y1, ua = o.u0 ?? 0, ub = ua + o.L;
  const ops = (o.openings || []).filter((p) => p.u1 > p.u0 + 1e-3 && p.v1 > p.v0 + 1e-3);
  const outerKey = o.outer, revealKey = o.revealKey || o.outer;
  const cs = o.chamferStart || 0, ce = o.chamferEnd || 0;
  // ---- outer face grid -------------------------------------------------
  const holes = ops.map((p) => {
    const c = p.chamfer ?? 0.02;
    return [Math.max(ua + cs, p.u0 - c), Math.min(ub - ce, p.u1 + c), Math.max(y0, p.v0 - (p.v0 - c < y0 + 1e-4 ? 0 : c)), Math.min(y1, p.v1 + c)];
  });
  gridFace(b, outerKey, ua + cs, ub - ce, y0, y1, 0, 1, holes);
  // ---- corner chamfers + end caps ----------------------------------------
  if (cs > 0) b.quad(outerKey, ua, y0, -cs, ua + cs, y0, 0, ua + cs, y1, 0, ua, y1, -cs);
  if (ce > 0) b.quad(outerKey, ub - ce, y0, 0, ub, y0, -ce, ub, y1, -ce, ub - ce, y1, 0);
  if (o.capStart) b.rectX(outerKey, -T, y0, -cs, y1, ua, -1);
  if (o.capEnd) b.rectX(outerKey, -T, y0, -ce, y1, ub, 1);
  if (o.capTop) b.rectY(outerKey, ua, -T, ub, 0, y1, 1);
  if (o.capBottom) b.rectY(outerKey, ua, -T, ub, 0, y0, -1);
  // ---- openings: chamfers + reveals ------------------------------------
  const fd = o.frameDepth ?? 0.08;
  for (let i = 0; i < ops.length; i++) {
    const p = ops[i], hz = holes[i];
    const c = p.chamfer ?? 0.02, R = Math.min(p.reveal ?? 0.2, T - 0.02);
    const U0 = p.u0, U1 = p.u1, V0 = p.v0, V1 = p.v1;
    const atBottom = V0 - c < y0 + 1e-4;
    const cu0 = U0 - hz[0], cu1 = hz[1] - U1, cv1 = hz[3] - V1, cv0 = atBottom ? 0 : V0 - hz[2];
    const cz = c > 1e-5 ? -c : 0; // every reveal starts at depth −c, chamfer strips close the gap
    // chamfer strips (mitred trapezoids), CCW seen from outside / into the opening
    if (c > 1e-5) {
      b.quad(revealKey, U0 - cu0, V0 - cv0, 0, U0, V0, cz, U0, V1, cz, U0 - cu0, V1 + cv1, 0);
      b.quad(revealKey, U1, V0, cz, U1 + cu1, V0 - cv0, 0, U1 + cu1, V1 + cv1, 0, U1, V1, cz);
      b.quad(revealKey, U0 - cu0, V1 + cv1, 0, U0, V1, cz, U1, V1, cz, U1 + cu1, V1 + cv1, 0);
      if (!p.noSillReveal) b.quad(revealKey, U0, V0, cz, U0 - cu0, V0 - cv0, 0, U1 + cu1, V0 - cv0, 0, U1, V0, cz);
    }
    // reveals from chamfer depth to the frame plane (−R)
    b.rectX(revealKey, -R, V0, cz, V1, U0, 1);
    b.rectX(revealKey, -R, V0, cz, V1, U1, -1);
    b.rectY(revealKey, U0, -R, U1, cz, V1, -1);
    if (!p.noSillReveal) b.rectY(revealKey, U0, -R, U1, cz, V0, 1);
    if (o.innerReveals) {
      const zi = -Math.min(R + fd, T);
      const ik = o.innerRevealKey || o.inner || revealKey;
      if (-zi < T - 1e-4) {
        b.rectX(ik, -T, V0, zi, V1, U0, 1);
        b.rectX(ik, -T, V0, zi, V1, U1, -1);
        b.rectY(ik, U0, -T, U1, zi, V1, -1);
        if (!p.noSillReveal && !p.noInnerSill) b.rectY(ik, U0, -T, U1, zi, V0, 1);
      }
    }
  }
  // ---- inner face ---------------------------------------------------------
  if (o.inner) {
    const ih = ops.map((p) => [p.u0, p.u1, p.v0, p.v1]);
    gridFace(b, o.inner, ua + (o.innerInsetStart || 0), ub - (o.innerInsetEnd || 0), o.innerY0 ?? y0, o.innerY1 ?? y1, -T, -1, ih);
  }
}

/**
 * Emit a planar face in plane z = zf (facing ±z) covering [ua,ub]×[y0,y1] minus rectangular
 * holes [[u0,u1,v0,v1],...] as a crack-free grid of cells.
 */
export function gridFace(b, key, ua, ub, y0, y1, zf, facing, holes) {
  if (ub - ua < 1e-4 || y1 - y0 < 1e-4) return;
  const us = [ua, ub], vs = [y0, y1];
  for (const h of holes) {
    if (h[1] <= ua || h[0] >= ub || h[3] <= y0 || h[2] >= y1) continue;
    us.push(clampN(h[0], ua, ub), clampN(h[1], ua, ub)); vs.push(clampN(h[2], y0, y1), clampN(h[3], y0, y1));
  }
  const U = uniq(us), V = uniq(vs);
  const nu = U.length - 1, nv = V.length - 1;
  if (nu <= 0 || nv <= 0) return;
  // cell occupancy
  const solid = new Uint8Array(nu * nv).fill(1);
  for (const h of holes) {
    for (let i = 0; i < nu; i++) {
      const cu = (U[i] + U[i + 1]) * 0.5; if (cu <= h[0] || cu >= h[1]) continue;
      for (let j = 0; j < nv; j++) { const cv = (V[j] + V[j + 1]) * 0.5; if (cv > h[2] && cv < h[3]) solid[j * nu + i] = 0; }
    }
  }
  // shared vertex grid (watertight, indexed)
  const p = b.part(key);
  const idx = new Int32Array((nu + 1) * (nv + 1)).fill(-1);
  const nz = facing > 0 ? 1 : -1;
  const vi = (i, j) => {
    const k = j * (nu + 1) + i;
    if (idx[k] < 0) idx[k] = b.vert(p, U[i], V[j], zf, 0, 0, nz, 0, 0);
    return idx[k];
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (!solid[j * nu + i]) continue;
    const a = vi(i, j), c = vi(i + 1, j), d = vi(i + 1, j + 1), e = vi(i, j + 1);
    if (facing > 0) b.q(p, a, c, d, e); else b.q(p, c, a, e, d);
  }
}

function clampN(x, a, b) { return x < a ? a : x > b ? b : x; }
function uniq(arr) {
  arr.sort((a, b) => a - b);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) if (arr[i] - out[out.length - 1] > 1e-5) out.push(arr[i]);
  return out;
}

/**
 * Enter the wall frame of a rectangular footprint side. After this, local x runs along the
 * facade from its left end (seen from outside), y up, z outward; outer face plane at z=0.
 *   side: 'front' (+Z), 'right' (+X), 'back' (−Z), 'left' (−X)
 *   w, d: footprint size; inset: move the facade plane inwards (setbacks); returns L.
 * Call b.push() before and b.pop() after.
 */
export function facadeFrame(b, side, w, d, inset = 0) {
  switch (side) {
    case 'front': b.frame(-w / 2, 0, d / 2 - inset, 1, 0, 0, 0, 1, 0, 0, 0, 1); return w;
    case 'right': b.frame(w / 2 - inset, 0, d / 2, 0, 0, -1, 0, 1, 0, 1, 0, 0); return d;
    case 'back': b.frame(w / 2, 0, -d / 2 + inset, -1, 0, 0, 0, 1, 0, 0, 0, -1); return w;
    case 'left': b.frame(-w / 2 + inset, 0, -d / 2, 0, 0, 1, 0, 1, 0, -1, 0, 0); return d;
    default: throw new Error('bad side ' + side);
  }
}

/** Building-frame point of facade coords (u along facade, y, z outward) for a rect footprint. */
export function facadePoint(side, w, d, u, y, z = 0) {
  switch (side) {
    case 'front': return [-w / 2 + u, y, d / 2 + z];
    case 'right': return [w / 2 + z, y, d / 2 - u];
    case 'back': return [w / 2 - u, y, -d / 2 - z];
    case 'left': return [-w / 2 - z, y, -d / 2 + u];
    default: return [0, y, 0];
  }
}
/** Outward normal of a facade side. */
export function facadeNormal(side) {
  return side === 'front' ? [0, 0, 1] : side === 'back' ? [0, 0, -1] : side === 'right' ? [1, 0, 0] : [-1, 0, 0];
}
/** Perimeter offset (u origin) of each side for the continuous facade u used by the far shader. */
export function perimeterU(side, w, d) {
  return side === 'front' ? 0 : side === 'right' ? w : side === 'back' ? w + d : 2 * w + d;
}

/** Simple solid wall slab between two plan points (interior partitions, party walls). */
export function solidWall(b, key, x0, z0, x1, z1, y0, y1, T, faces = PX | NX | PZ | NZ | PY) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  if (L < 1e-4) return;
  b.push();
  b.translate(x0, 0, z0);
  b.rotY(-Math.atan2(dz, dx));
  b.box(key, 0, y0, -T / 2, L, y1, T / 2, faces);
  b.pop();
}

export { PX, NX, PY, NY, PZ, NZ };
