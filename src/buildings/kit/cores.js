// Vertical circulation cores (stair + lift) sized from storey heights so the switchback stair
// really fits (riser ≤ 0.172 m, tread 0.28–0.30 m, landings ≥ 1.3 m).
//
// coreLayout(o) → { x0,x1,z0,z1, stair:{x0,x1,z0,z1, W, Lz, landAt:'max'|'min'}, lift?:{x0,x1,z0,z1, door:'+z'|'-z'}, landing:{x0,x1,z0,z1} }
//   o: { cx (core centre x), zBack (z of the inner face of the back wall — stair starts here),
//        towards: +1 (flights' floor landing towards +z) | −1, maxRise (largest storey height),
//        lift: boolean, liftSide: +1 (right of stair) | −1, landingDepth=1.8, W=2.7 }

import { risers } from './stairs.js';

export function stairLength(maxRise, landD = 1.4, halfD = 1.3, minRun = 0) {
  let { n } = risers(maxRise, 0.172); if (n % 2) n++;
  const n1 = n / 2;
  return landD + Math.max((n1 - 1) * 0.28, minRun) + halfD;
}

/** Riser split for a ground floor whose half landing must clear a passage (≥ hClear). */
export function groundSplit(rise, hClear = 2.22) {
  let { n } = risers(rise, 0.172); if (n % 2) n++;
  const h = rise / n;
  const n1 = Math.min(n - 2, Math.ceil(hClear / h));
  return { n1, n2: n - n1, run: (Math.max(n1, n - n1) - 1) * 0.28 };
}

/**
 * Local frame of a switchback stair (stairs.js stairFlights: x across the well 0..W, z along the
 * flights, 0 = floor-landing end … Lz = half-landing end, y up) in the building frame.
 * landAt 'max' | 'min': flights along z, floor landing at z1 | z0 (coreLayout);
 * landAt 'minx' | 'maxx': flights along x (shallow plans, coreLayoutX), floor landing at x0 | x1;
 * the well spans z0..z1 and the flights stop `st.endInset0` / `st.endInset1` short of the x0 / x1 ends
 * (0.1 m at a partition, the wall thickness where the core meets an end wall).
 * Returns { ox, oz, ax:[x,z] (local x axis), az:[x,z] (local z axis), W, Lz } — right-handed with y up.
 */
export function stairFrame(st) {
  const e0 = st.endInset0 ?? st.endInset ?? 0, e1 = st.endInset1 ?? st.endInset ?? 0;
  switch (st.landAt) {
    case 'max': return { ox: st.x1, oz: st.z1, ax: [-1, 0], az: [0, -1], W: st.x1 - st.x0, Lz: st.z1 - st.z0 };
    case 'minx': return { ox: st.x0 + e0, oz: st.z1, ax: [0, -1], az: [1, 0], W: st.z1 - st.z0, Lz: st.x1 - st.x0 - e0 - e1 };
    case 'maxx': return { ox: st.x1 - e1, oz: st.z0, ax: [0, 1], az: [-1, 0], W: st.z1 - st.z0, Lz: st.x1 - st.x0 - e0 - e1 };
    default: return { ox: st.x0, oz: st.z0, ax: [1, 0], az: [0, 1], W: st.x1 - st.x0, Lz: st.z1 - st.z0 };
  }
}
/** Building-frame point [x, y, z] of a local stair-frame point (x across, y up from `y0`, z along). */
export function stairPoint(st, x, y, z, y0 = 0) {
  const F = stairFrame(st);
  return [F.ox + F.ax[0] * x + F.az[0] * z, y0 + y, F.oz + F.ax[1] * x + F.az[1] * z];
}
/** True when the flights of `st` run along x (shallow plans). */
export const stairAlongX = (st) => st.landAt === 'minx' || st.landAt === 'maxx';

/**
 * Core for SHALLOW plans (fix round 3, QQ2-01 / QA2P-03): the switchback stair runs ALONG x against
 * the service wall (a stair along z — 6.2 m with the ground-floor passage — does not fit a 6.7–8.7 m
 * deep slab with a landing in front of it), the landing / lobby lies in front of the stair across the
 * whole core width. No lift and no ground-floor passage (no service door under the flights).
 * o: { cx, zBack (inner face of the service wall), towards (+1: the landing is towards +z), maxRise,
 *      W=2.6 (well depth along z), landD=1.3, halfD=1.15, landingDepth=1.5, landAt 'minx'|'maxx',
 *      maxLen (cap of the x length; treads compress to fit, never below 0.25 m),
 *      wallEnd 'x0'|'x1' + wallT (the core meets an end wall there: the flights stop at its inner face) }
 * Returns the coreLayout shape { x0,x1,z0,z1, stair:{…, landAt, endInset}, lift:null, landing } —
 * the stair rect spans the whole core width (x0..x1); the flights stop 0.1 m short of both ends.
 */
export function coreLayoutX(o) {
  const W = o.W ?? 2.6, landD = o.landD ?? 1.3, halfD = o.halfD ?? 1.15;
  const e0 = o.wallEnd === 'x0' ? (o.wallT ?? 0.3) : 0.1, e1 = o.wallEnd === 'x1' ? (o.wallT ?? 0.3) : 0.1;
  let { n } = risers(o.maxRise, 0.172); if (n % 2) n++;
  const need = landD + (n / 2 - 1) * 0.28 + halfD + e0 + e1;
  const min = landD + (n / 2 - 1) * 0.25 + halfD + e0 + e1;
  const L = Math.max(min, Math.min(need, o.maxLen ?? need));
  const dir = o.towards ?? 1;
  const x0 = o.cx - L / 2, x1 = o.cx + L / 2;
  const sz0 = dir > 0 ? o.zBack : o.zBack - W, sz1 = dir > 0 ? o.zBack + W : o.zBack;
  const stair = { x0, x1, z0: sz0, z1: sz1, W, Lz: L, landAt: o.landAt || 'minx', landD, halfD, endInset0: e0, endInset1: e1, along: 'x' };
  const ld = o.landingDepth ?? 1.5;
  const landing = { x0, x1, z0: dir > 0 ? sz1 : sz0 - ld, z1: dir > 0 ? sz1 + ld : sz0 };
  return { x0, x1, z0: Math.min(sz0, landing.z0), z1: Math.max(sz1, landing.z1), stair, lift: null, landing, alongX: true };
}
/** x length coreLayoutX needs for a storey height (incl. the 0.1 m end insets). */
export function stairLengthX(maxRise, landD = 1.3, halfD = 1.15, extra = 0) {
  let { n } = risers(maxRise, 0.172); if (n % 2) n++;
  return landD + (n / 2 - 1) * 0.28 + halfD + 0.2 + extra;
}

export function coreLayout(o) {
  const W = o.W ?? 2.7;
  const Lz = Math.max(4.6, stairLength(o.maxRise, o.landD ?? 1.4, o.halfD ?? 1.3, o.minRun || 0));
  const dir = o.towards ?? 1;
  // stair rect: from zBack going `dir`
  const sz0 = dir > 0 ? o.zBack : o.zBack - Lz, sz1 = dir > 0 ? o.zBack + Lz : o.zBack;
  const lw = o.lift === false ? 0 : 2.3;
  const side = o.liftSide ?? 1;
  const total = W + (lw ? lw + 0.1 : 0);
  const x0 = o.cx - total / 2;
  const stair = side > 0 ? { x0, x1: x0 + W } : { x0: x0 + lw + 0.1, x1: x0 + total };
  stair.z0 = sz0; stair.z1 = sz1; stair.W = W; stair.Lz = Lz; stair.landAt = dir > 0 ? 'max' : 'min';
  stair.landD = o.landD ?? 1.4; stair.halfD = o.halfD ?? 1.3;
  let lift = null;
  if (lw) {
    const lx0 = side > 0 ? stair.x1 + 0.1 : x0;
    // lift shaft at the landing end of the stair, door facing the landing direction
    const lz1 = dir > 0 ? sz1 : sz0 + 2.4, lz0 = lz1 - 2.4;
    lift = { x0: lx0, x1: lx0 + lw, z0: dir > 0 ? sz1 - 2.4 : sz0, z1: dir > 0 ? sz1 : sz0 + 2.4, door: dir > 0 ? '+z' : '-z' };
    void lz0; void lz1;
  }
  const ld = o.landingDepth ?? 1.8;
  const landing = { x0, x1: x0 + total, z0: dir > 0 ? sz1 : sz0 - ld, z1: dir > 0 ? sz1 + ld : sz0 };
  return { x0, x1: x0 + total, z0: Math.min(sz0, landing.z0), z1: Math.max(sz1, landing.z1), stair, lift, landing };
}
