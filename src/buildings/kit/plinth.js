// Plinth / foundation adapting to terrain (spec._ground corner heights relative to the
// entrance). The base course runs from 0.5 m below the lowest terrain up to the ground-floor
// level, projecting slightly from the facade; where the terrain is higher than the floor,
// stepped retaining walls with copings and a drainage channel hold it back.

import { PX, NX, PY, NY, PZ, NZ, ALL } from './MeshBuilder.js';
import { groundAt } from './spec.js';

const SIDES = ['front', 'right', 'back', 'left'];

/** Corner terrain heights for a side, in its wall-frame direction (left→right seen outside). */
export function sideGround(s, side) {
  const G = s._ground;
  switch (side) {
    case 'front': return [G.fl, G.fr];
    case 'right': return [G.fr, G.br];
    case 'back': return [G.br, G.bl];
    default: return [G.bl, G.fl];
  }
}

/**
 * Plinth band around a rectangular footprint.
 * @param {MeshBuilder} b
 * @param {object} s     normalized spec
 * @param {number} ffl   ground-floor finished level (relative to entrance)
 * @param {object} o     {key='stone_plinth', proj=0.03, top (y of the plinth top, default ffl), skip:{side:true}, w, d}
 */
export function plinth(b, s, ffl, o = {}) {
  const w = o.w ?? s._w, d = o.d ?? s._d, key = o.key || 'stone_plinth';
  const proj = o.proj ?? 0.035, top = o.top ?? ffl;
  const bottom = Math.min(s._ground.min, 0) - 0.6;
  for (const side of SIDES) {
    if (o.skip && o.skip[side]) continue;
    const [g0, g1] = sideGround(s, side);
    const L = side === 'front' || side === 'back' ? w : d;
    b.push();
    frameSide(b, side, w, d);
    // outer face as a trapezoid (bottom follows terrain − 0.6), top at `top`
    const yb0 = Math.min(g0, top) - 0.6, yb1 = Math.min(g1, top) - 0.6;
    b.quad(key, -proj, yb0, proj, L + proj, yb1, proj, L + proj, top - 0.012, proj, -proj, top - 0.012, proj);
    // weathered top: chamfer + ledge back to the wall line
    b.quad(key, -proj, top - 0.012, proj, L + proj, top - 0.012, proj, L + proj, top, proj - 0.012, -proj, top, proj - 0.012);
    b.quad(key, -proj, top, proj - 0.012, L + proj, top, proj - 0.012, L + proj, top, 0.0, -proj, top, 0.0);
    // end returns at corners (mitre): side faces at u = −proj and L + proj
    b.quad(key, -proj, yb0, 0, -proj, yb0, proj, -proj, top, proj - 0.012, -proj, top, 0);
    b.quad(key, L + proj, yb1, proj, L + proj, yb1, 0, L + proj, top, 0, L + proj, top, proj - 0.012);
    b.pop();
    void bottom;
  }
}

/** Enter a facade frame (wall frame, outer face z = 0) for a centred w×d rect. */
export function frameSide(b, side, w, d) {
  switch (side) {
    case 'front': b.frame(-w / 2, 0, d / 2, 1, 0, 0, 0, 1, 0, 0, 0, 1); return w;
    case 'right': b.frame(w / 2, 0, d / 2, 0, 0, -1, 0, 1, 0, 1, 0, 0); return d;
    case 'back': b.frame(w / 2, 0, -d / 2, -1, 0, 0, 0, 1, 0, 0, 0, -1); return w;
    default: b.frame(-w / 2, 0, -d / 2, 0, 0, 1, 0, 1, 0, -1, 0, 0); return d;
  }
}

/**
 * Retaining terraces on sides where terrain rises above the floor level: a stepped concrete
 * wall `gap` m out from the facade, top stepping with the terrain, coping, drainage channel
 * with grating at its foot and a guard rail where the drop exceeds 0.6 m.
 */
export function retainingSteps(b, s, ffl, o = {}) {
  const w = o.w ?? s._w, d = o.d ?? s._d;
  const gap = o.gap ?? 1.2, t = 0.25;
  for (const side of SIDES) {
    if (s._shared[side]) continue;
    const [g0, g1] = sideGround(s, side);
    if (Math.max(g0, g1) < ffl + 0.25) continue;
    const L = side === 'front' || side === 'back' ? w : d;
    b.push();
    frameSide(b, side, w, d);
    // areaway floor (channel) at ffl - 0.05
    b.box('concrete', -0.2, ffl - 0.35, 0.0, L + 0.2, ffl - 0.05, gap, PY | PZ);
    b.box('grille_dark', 0.2, ffl - 0.049, 0.15, L - 0.2, ffl - 0.04, 0.45, PY);
    // stepped wall segments
    const nSeg = Math.max(1, Math.ceil(L / 2.4));
    for (let i = 0; i < nSeg; i++) {
      const u0 = (L * i) / nSeg, u1 = (L * (i + 1)) / nSeg;
      const gm = Math.max(g0 + ((g1 - g0) * (i + 0.5)) / nSeg, ffl);
      const topY = Math.max(ffl + 0.2, Math.round((gm + 0.15) / 0.3) * 0.3);
      b.cbox(o.key || 'concrete', u0, ffl - 0.35, gap, u1 + (i < nSeg - 1 ? 0.001 : 0), topY, gap + t, 0.015, false);
      b.cbox(o.copingKey || 'stone_plinth', u0 - 0.02, topY, gap - 0.04, u1 + 0.02, topY + 0.06, gap + t + 0.04, 0.01);
      if (topY - ffl > 0.6) {
        b.tube('steel', [[u0 + 0.1, topY + 1.0, gap + t / 2], [u1 - 0.1, topY + 1.0, gap + t / 2]], 0.02, 8);
        b.tube('steel', [[u0 + 0.1, topY + 0.06, gap + t / 2], [u0 + 0.1, topY + 1.0, gap + t / 2]], 0.02, 8);
      }
      if (b.collecting) b.colBox(u0, ffl - 0.35, gap, u1, topY + 1.0, gap + t);
    }
    b.pop();
  }
}

/** Highest terrain (relative) along a facade segment u0..u1 of a side (for buried openings). */
export function groundAlong(s, side, u0, u1) {
  const [g0, g1] = sideGround(s, side);
  const L = side === 'front' || side === 'back' ? s._w : s._d;
  const a = g0 + ((g1 - g0) * u0) / L, c = g0 + ((g1 - g0) * u1) / L;
  return Math.max(a, c);
}

export { groundAt };
