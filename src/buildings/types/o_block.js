// O-zone multi-storey utility block helpers (buildings-o, not a type module): window bands per storey,
// storey slabs with a stair well + straight stair ('full'), external steel escape stair with landings
// and upper doors (O02 yellow-rail language), equipment yard pads. Used by maintenance / farm_station /
// cold_storage / service_depot / water_treatment / insulated_station office parts.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, isFB, roomMap, steelStair, yellowRail, grating, cabinet, lampPost } from './o_common.js';
import { railSimple, stairStraight, partition } from './o_hall.js';

/**
 * Regular windows on `side` for one storey. o: {L (facade length), y (floor level), h (storey height),
 * sill=0.95, head=2.35 (above floor), every=3.6, width=1.5, avoid:[[u0,u1]], a=0.9, c=L-0.9 (usable range),
 * kind='office', floor, depth=5, type='casement', cols}
 * Pushes into ops[side] and returns the new openings.
 */
export function bandWindows(ctx, ops, side, w, d, o) {
  const L = o.L ?? (isFB(side) ? w : d);
  const a = o.a ?? 0.9, c = o.c ?? L - 0.9;
  const every = o.every ?? 3.6, ww = o.width ?? 1.5;
  const n = Math.max(1, Math.floor((c - a) / every));
  const out = [];
  for (let i = 0; i < n; i++) {
    const uc = a + ((c - a) * (i + 0.5)) / n;
    const u0 = uc - ww / 2, u1 = uc + ww / 2;
    if ((o.avoid || []).some(([p, q]) => u1 > p - 0.35 && u0 < q + 0.35)) continue;
    const op = { u0, u1, v0: o.y + (o.sill ?? 0.95), v1: o.y + (o.head ?? 2.35), kind: 'win', type: o.type || 'casement', cols: o.cols };
    op.room = roomMap(ctx, side, w, d, op, { y: o.y, h: (o.h ?? 3.4) - 0.3, depth: o.depth ?? 5, kind: o.kind || 'office', floor: o.floor ?? 0, u0: uc - every / 2, u1: uc + every / 2 });
    ops[side].push(op);
    out.push(op);
  }
  return out;
}

/** Remove overlapping openings (doors/rollers win over windows). */
export function dedupeOps(list) {
  const out = [];
  const pri = (o) => (o.kind === 'blank' ? -1 : o.kind === 'roller' ? 0 : o.kind === 'door' ? 1 : o.kind === 'louvre' ? 2 : 3);
  for (const o of list.slice().sort((x, y) => pri(x) - pri(y))) {
    if (out.some((q) => o.u0 < q.u1 + 0.3 && o.u1 > q.u0 - 0.3 && o.v0 < q.v1 + 0.2 && o.v1 > q.v0 - 0.2)) continue;
    out.push(o);
  }
  return out;
}

/**
 * Storey slabs with a stair well and straight flights ('full' only). I = inner rect, levels [{y,h}],
 * st: {x0, z, dir:+1|-1 (climb along +x / −x), W}. Flights alternate direction per storey along the same
 * wall strip (scissor-free: each storey's flight starts where the last one ended). Returns the well rects.
 */
export function storeySlabs(ctx, I, levels, st, o = {}) {
  const b = ctx.b;
  if (!ctx.full || levels.length < 2) return [];
  const W = st.W ?? 1.1;
  const wells = [];
  for (let l = 1; l < levels.length; l++) {
    const y = levels[l].y, rise = y - levels[l - 1].y;
    const n = Math.ceil(rise / 0.18), run = (n - 1) * 0.27 + 0.27;
    const dir = (l % 2 === 1) ? st.dir : -st.dir;
    const xs = dir > 0 ? st.x0 : st.x0 + run;
    // well over the flight; the slab edge stays at the last riser of the arrival end (no gap where the flight lands)
    const wx0 = dir > 0 ? st.x0 - 0.05 : st.x0 + 0.25, wx1 = dir > 0 ? st.x0 + run - 0.25 : st.x0 + run + 0.05;
    const wz0 = st.z - W / 2 - 0.1, wz1 = st.z + W / 2 + 0.1;
    // slab pieces around the well
    const parts = [
      { x0: I.x0, x1: I.x1, z0: I.z0, z1: wz0 },
      { x0: I.x0, x1: I.x1, z0: wz1, z1: I.z1 },
      { x0: I.x0, x1: wx0, z0: wz0, z1: wz1 },
      { x0: wx1, x1: I.x1, z0: wz0, z1: wz1 },
    ].filter((r) => r.x1 - r.x0 > 0.05 && r.z1 - r.z0 > 0.05);
    for (const r of parts) {
      b.cbox('concrete_smooth', r.x0, y - 0.25, r.z0, r.x1, y, r.z1, 0.005);
      b.rectY(o.floorKey || 'tile_floor', r.x0, r.z0, r.x1, r.z1, y + 0.003, 1);
      b.withTint([0.95, 0.95, 0.94], () => b.rectY('plaster', r.x0, r.z0, r.x1, r.z1, y - 0.252, -1));
      if (b.collecting) b.colQuad(r.x0, y, r.z1, r.x1, y, r.z1, r.x1, y, r.z0, r.x0, y, r.z0);
    }
    stairStraight(ctx, { x: xs, z: st.z, y0: levels[l - 1].y, rise, dir: dir > 0 ? 0 : Math.PI, W });
    // guard rail on the open long side of the well
    const zr = st.z > (I.z0 + I.z1) / 2 ? wz0 + 0.04 : wz1 - 0.04;
    railSimple(b, [[wx0, y, zr], [wx1, y, zr]]);
    wells.push({ x0: wx0, x1: wx1, z0: wz0, z1: wz1, y });
  }
  return wells;
}

/**
 * External steel escape / access stair against a facade (wall frame of `side` of the footprint): a straight
 * flight along the wall from the ground up to a grated landing at level y with an upper door, yellow rails.
 * o: {u (landing centre along the facade), dir: +1 (climb towards +u) | −1, W=1.1, door=true}
 */
export function externalStair(ctx, side, w, d, yTop, o = {}) {
  const b = ctx.b, s = ctx.spec;
  const L = isFB(side) ? w : d;
  const W = o.W ?? 1.1, dir = o.dir ?? 1;
  const [g0, g1] = K.sideGround(s, side);
  const u = o.u;
  const gy = g0 + ((g1 - g0) * u) / L;
  const rise = yTop - gy;
  const n = Math.max(2, Math.ceil(rise / 0.19)), run = (n - 1) * 0.25;
  b.push(); K.facadeFrame(b, side, w, d, 0);
  const zc = 0.25 + W / 2;
  // landing at the top (grated platform on two posts + brackets)
  const lu0 = u - 0.9, lu1 = u + 0.9;
  grating(b, lu0, 0.12, lu1, 0.25 + W + 0.1, yTop);
  for (const uu of [lu0 + 0.1, lu1 - 0.1]) b.box('steel', uu - 0.06, gy, 0.25 + W - 0.02, uu + 0.06, yTop - 0.16, 0.25 + W + 0.1, PX | NX | PZ | NZ);
  // flight: foot at u − dir·(0.9 + run), climbing along +dir towards the landing
  const footU = dir > 0 ? lu0 - run : lu1 + run;
  steelStair(b, { x: footU, y0: gy, z: zc, rise, dir: dir > 0 ? 0 : Math.PI, W, rails: 'left' });
  // outer rail of the landing (+ the wall side is the facade)
  yellowRail(b, dir > 0 ? [[lu0 + 0.05, yTop, 0.25 + W + 0.05], [lu1 - 0.05, yTop, 0.25 + W + 0.05], [lu1 - 0.05, yTop, 0.15]] : [[lu1 - 0.05, yTop, 0.25 + W + 0.05], [lu0 + 0.05, yTop, 0.25 + W + 0.05], [lu0 + 0.05, yTop, 0.15]]);
  // wall-side handrail along the flight
  b.tube('steel_yellow', [[footU, gy + 0.95, 0.22], [dir > 0 ? lu0 : lu1, yTop + 0.95, 0.22]], 0.02, 6);
  // posts under the flight's mid point
  const mu = footU + dir * run * 0.5, my = gy + rise * 0.5;
  b.box('steel', mu - 0.05, gy, zc + W / 2 - 0.05, mu + 0.05, my - 0.2, zc + W / 2 + 0.05, PX | NX | PZ | NZ);
  b.cbox('concrete', footU - 0.4 * dir - 0.4, gy - 0.3, zc - W / 2 - 0.1, footU - 0.4 * dir + 0.4, gy + 0.05, zc + W / 2 + 0.1, 0.01, false);
  b.pop();
  return { u0: u - 0.5, u1: u + 0.5, v0: yTop, v1: yTop + 2.15 };
}

/** Equipment yard pad (wall frame of side): concrete pad + transformer kiosk + tank + container + lamp. */
export function equipmentYard(ctx, side, w, d, u0, u1, o = {}) {
  const b = ctx.b, s = ctx.spec;
  const L = isFB(side) ? w : d;
  const [g0, g1] = K.sideGround(s, side);
  const gy = Math.min(g0, g1);
  const dep = o.depth ?? 6;
  b.push(); K.facadeFrame(b, side, w, d, 0);
  b.withTint([0.9, 0.89, 0.86], () => b.cbox('concrete', u0, gy - 0.35, 0.3, u1, gy + 0.1, dep, 0.02, false));
  if (b.collecting) b.colQuad(u0, gy + 0.1, dep, u1, gy + 0.1, dep, u1, gy + 0.1, 0.3, u0, gy + 0.1, 0.3);
  const y = gy + 0.1;
  const span = u1 - u0;
  // transformer kiosk
  cabinet(b, u0 + Math.min(2.0, span * 0.25), y, dep - 1.4, 1.8, 2.1, 1.2, Math.PI, 'hvac');
  // tank on saddles
  if (span > 7) {
    const tu = u0 + span * 0.55;
    b.push(); b.translate(tu, y + 1.0, dep - 2.2); b.rotZ(Math.PI / 2);
    b.lathe('tank_white', [[0.0, -1.6], [0.6, -1.55], [0.85, -1.3], [0.85, 1.3], [0.6, 1.55], [0.0, 1.6]], 18, {});
    b.pop();
    for (const du of [-0.9, 0.9]) b.box('steel_dark', tu + du - 0.12, y, dep - 2.95, tu + du + 0.12, y + 0.4, dep - 1.45, ALL);
  }
  // spare-parts container
  if (span > 11 && o.container !== false) {
    const cu = u1 - 3.4;
    b.withTint(o.containerTint || [0.32, 0.45, 0.6], () => b.cbox('steel_dark', cu - 3.0, y, dep - 2.6, cu + 3.0, y + 2.6, dep - 0.2, 0.03));
    for (let k = 0; k < 14; k++) { const uu = cu - 2.9 + k * 0.42; b.withTint(o.containerTint || [0.32, 0.45, 0.6], () => b.box('steel_dark', uu, y + 0.12, dep - 0.2, uu + 0.12, y + 2.5, dep - 0.16, PZ | PX | NX)); }
  }
  if (o.lamp !== false) lampPost(b, u1 - 0.6, y, 0.9, 6, Math.PI);
  b.pop();
  void L;
}

export { partition };
