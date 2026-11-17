// O-zone big shed helpers (buildings-o, not a type module): vehicle / loading doors from the spec's
// 'loading' entrances, an office corner with two storeys of windows by the main door, clerestory bands,
// dock shelters + levellers + bumpers, loading canopies on columns, apron lane markings, roof equipment
// rows. Used by service_depot / cold_storage / farm_station.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, roomMap, cabinet, lampPost, apron } from './o_common.js';
import { bandWindows } from './o_block.js';

/** Loading-door centres on a side from the spec entrances (kind 'loading'), else n evenly spaced. */
export function loadingDoors(s, side, L, n, dw, o = {}) {
  const es = s._entrances.filter((e) => e.kind === 'loading' && e.side === side);
  const off = (e) => L / 2 + (side === 'back' || side === 'left' ? -1 : 1) * (e.offset || 0);
  let us = es.length ? es.map(off) : Array.from({ length: n }, (_, i) => L * (i + 0.5) / n);
  if (o.extra && us.length < o.extra) us = Array.from({ length: o.extra }, (_, i) => L * (i + 0.5) / o.extra);
  us = us.map((u) => Math.max(dw / 2 + (o.margin ?? 1.2), Math.min(L - dw / 2 - (o.margin ?? 1.2), u))).sort((a, c) => a - c);
  // enforce spacing
  const out = [];
  for (const u of us) if (!out.length || u - out[out.length - 1] >= dw + 1.2) out.push(u);
  return out;
}

/** Office corner windows (two storeys) + main door with canopy on side M. Returns {door, u0, u1}. */
export function officeFront(ctx, ops, M, w, d, ffl, du, o = {}) {
  const L = isFB(M) ? w : d;
  const span = o.span ?? Math.min(12, L * 0.35);
  const left = du < L / 2;
  const u0 = left ? 0.6 : L - span - 0.6, u1 = u0 + span;
  const door = { u0: du - 0.6, u1: du + 0.6, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'glazed', entry: true, plate: true };
  ops[M].push(door);
  const levels = o.levels || [ffl, ffl + 3.6];
  levels.forEach((y, i) => bandWindows(ctx, ops, M, w, d, { y, h: 3.4, a: u0, c: u1, every: 2.8, width: 1.4, avoid: i === 0 ? [[door.u0, door.u1]] : [], kind: 'office', floor: i, depth: 5 }));
  return { door, u0, u1 };
}

/** Clerestory strip windows high on a side (fixed glazing). */
export function clerestory(ctx, ops, side, w, d, y0, y1, o = {}) {
  const L = isFB(side) ? w : d;
  return bandWindows(ctx, ops, side, w, d, { y: 0, h: y1, sill: y0, head: y1, a: o.a ?? 1.0, c: o.c ?? L - 1.0, every: o.every ?? 5.0, width: o.width ?? 3.6, avoid: o.avoid || [], kind: 'plant', floor: 0, depth: isFB(side) ? d - 1 : w - 1, type: 'fixed', cols: 3 });
}

/**
 * Dock shelter + leveller + bumpers in front of a door (wall frame of the side): dock face at z=0,
 * dock platform top at y=ffl, apron (truck yard) at ground gy.
 */
export function dockFront(b, u0, u1, v1, ffl, gy) {
  const uc = (u0 + u1) / 2;
  // shelter: black curtain frame around the opening, projecting 0.6 m
  b.cbox('black', u0 - 0.45, ffl, 0.0, u0 - 0.05, v1 + 0.35, 0.6, 0.03);
  b.cbox('black', u1 + 0.05, ffl, 0.0, u1 + 0.45, v1 + 0.35, 0.6, 0.03);
  b.cbox('black', u0 - 0.45, v1 + 0.05, 0.0, u1 + 0.45, v1 + 0.55, 0.65, 0.03);
  for (let u = u0 - 0.05; u < u1 + 0.05; u += 0.25) b.withTint([0.6, 0.6, 0.6], () => b.box('rubber', u, v1 + 0.05 - 0.6, 0.55, u + 0.22, v1 + 0.05, 0.6, PZ));
  // leveller lip plate + bumpers + wheel guide + dock light arm
  b.box('steel', uc - 1.0, ffl - 0.04, 0.0, uc + 1.0, ffl + 0.01, 0.45, PY | PZ | PX | NX);
  for (const uu of [uc - 1.25, uc + 1.25]) b.cbox('rubber', uu - 0.15, ffl - 0.45, 0.0, uu + 0.15, ffl - 0.05, 0.14, 0.02);
  b.withTint([1, 1, 1], () => { b.box('steel_yellow', u0 - 0.2, gy, 1.0, u0 - 0.08, gy + 0.25, 6.5, ALL & ~NY); b.box('steel_yellow', u1 + 0.08, gy, 1.0, u1 + 0.2, gy + 0.25, 6.5, ALL & ~NY); });
  b.tube('steel_dark', [[u1 + 0.7, v1 + 0.2, 0.05], [u1 + 0.7, v1 + 0.2, 0.6], [u1 + 0.3, v1 + 0.1, 0.8]], 0.03, 5);
  b.cbox('aluminium_dark', u1 + 0.18, v1 - 0.05, 0.7, u1 + 0.42, v1 + 0.15, 0.9, 0.01);
}

/** Flat canopy on columns along a side (wall frame): from u0 to u1, depth dep, soffit at y. */
export function sideCanopy(b, u0, u1, dep, y, o = {}) {
  const t = o.t ?? 0.55;
  b.withTint(o.tint || [0.92, 0.93, 0.95], () => b.cbox(o.key || 'panel_grey', u0, y, -0.05, u1, y + t, dep, 0.03));
  b.withTint([0.9, 0.9, 0.9], () => b.rectY('panel_grey', u0 + 0.05, 0.0, u1 - 0.05, dep - 0.05, y - 0.002, -1));
  // downlights + columns + edge gutter
  const n = Math.max(1, Math.round((u1 - u0) / (o.colEvery ?? 7.5)));
  for (let i = 0; i <= n; i++) {
    const u = u0 + 0.25 + ((u1 - u0 - 0.5) * i) / n;
    b.cbox('steel', u - 0.15, o.gy ?? 0, dep - 0.55, u + 0.15, y, dep - 0.25, 0.01, false);
    b.cbox('concrete', u - 0.3, (o.gy ?? 0) - 0.3, dep - 0.7, u + 0.3, (o.gy ?? 0) + 0.25, dep - 0.1, 0.02, false);
    if (b.collecting) b.colBox(u - 0.15, o.gy ?? 0, dep - 0.55, u + 0.15, y, dep - 0.25);
  }
  for (let i = 0; i < n * 2; i++) { const u = u0 + ((u1 - u0) * (i + 0.5)) / (n * 2); b.cylinder('light_warm', u, y - 0.008, dep * 0.45, 0.12, 0.008, 12, { top: false, bottom: true }); }
  b.box('aluminium_dark', u0, y + t - 0.05, dep, u1, y + t + 0.12, dep + 0.15, ALL);
}

/** Apron lane markings (wall frame): lanes centred on us, depth dep, plus a stop bar. */
export function laneMarks(b, us, y, dep, lw = 3.6) {
  for (const u of us) {
    b.box('steel_yellow', u - lw / 2 - 0.06, y, 1.2, u - lw / 2 + 0.06, y + 0.004, dep - 0.8, PY);
    b.box('steel_yellow', u + lw / 2 - 0.06, y, 1.2, u + lw / 2 + 0.06, y + 0.004, dep - 0.8, PY);
    b.withTint([0.95, 0.95, 0.95], () => b.box('render_white', u - 0.6, y, dep - 3.2, u + 0.6, y + 0.004, dep - 2.7, PY));
  }
}

/** Row of roof condenser / fan units (current frame) along x from x0 to x1 at z, roof level y. */
export function condenserRow(b, x0, x1, z, y, o = {}) {
  const n = Math.max(1, Math.floor((x1 - x0) / 2.6));
  b.box('steel_dark', x0, y, z - 1.1, x1, y + 0.4, z - 0.95, ALL);
  b.box('steel_dark', x0, y, z + 0.95, x1, y + 0.4, z + 1.1, ALL);
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    b.cbox('hvac', x - 1.2, y + 0.4, z - 1.0, x + 1.2, y + 1.5, z + 1.0, 0.02);
    for (const dz of [-0.48, 0.48]) {
      b.cylinder('grille_dark', x, y + 1.5, z + dz, 0.42, 0.02, 18, { top: true });
      b.lathe('steel', [[0.44, 0], [0.44, 0.12], [0.4, 0.12]], 18, { x, y: y + 1.5, z: z + dz });
      b.cylinder('steel_dark', x, y + 1.52, z + dz, 0.07, 0.05, 8, { top: true });
    }
    b.box('grille_dark', x - 1.15, y + 0.5, z + 1.0, x + 1.15, y + 1.35, z + 1.004, PZ);
  }
  if (o.pipes !== false) b.tube('steel', [[x0 - 0.3, y + 0.6, z], [x1 + 0.3, y + 0.6, z]], 0.08, 8);
}

export { SIDES, OPP, isFB, roomMap, cabinet, lampPost, apron };
