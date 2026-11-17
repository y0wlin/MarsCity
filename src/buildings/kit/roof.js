// Roof construction and equipment: parapet copings, membrane roofs with drainage falls,
// stair houses / hatches with ladders, lift overruns, HVAC condensers, vents, water tanks,
// antenna masts, solar arrays, skylights, plant rooms, roof-garden planters and decks.
// All in the building frame (or the caller's current frame) with y up.

import { PX, NX, PY, NY, PZ, NZ, ALL } from './MeshBuilder.js';
import { roofDrain, gutter } from './drainage.js';
import { planterBox, plantBed, smallTree, shrub } from './vegetation.js';
import { doorUnit } from './doors.js';
import { Rng, hash4 } from '../../core/hash.js';

/**
 * Coping cap on top of a wall run (current frame, run along x from 0..L, wall between z=−T..0,
 * top at y). Aluminium/ceramic cap overhanging 30 mm both sides with drip noses.
 */
export function coping(b, key, L, T, y, o = {}) {
  const ov = o.overhang ?? 0.03, h = o.h ?? 0.06;
  const prof = [[-T - ov, y - 0.02], [-T - ov + 0.006, y - 0.026], [-T + 0.004, y - 0.026], [-T + 0.004, y], [0.0 - 0.004, y], [-0.004, y - 0.026], [ov - 0.006, y - 0.026], [ov, y - 0.02], [ov, y + h * 0.55], [-T / 2, y + h], [-T - ov, y + h * 0.55]];
  b.push(); b.translate(o.x0 ?? 0, 0, 0);
  b.extrudeX(key, prof, 0, L, { smoothAngle: 10 });
  b.pop();
}

/**
 * Parapet inner faces + copings for a rectangular roof. Outer faces are the facade walls
 * (they should extend to y + h). rect {x0,x1,z0,z1} = OUTER line of walls, T = wall thickness.
 * sides: {front,right,back,left} = 'parapet' | 'none' | 'firewall' (raised party wall).
 */
export function parapets(b, rect, y, h, T, o = {}) {
  const ik = o.innerKey || 'render_white', ck = o.copingKey || 'aluminium';
  const { x0, x1, z0, z1 } = rect;
  const top = y + h;
  const sides = o.sides || {};
  const runs = [
    ['front', [x0, top, z1], [1, 0, 0], x1 - x0],
    ['right', [x1, top, z1], [0, 0, -1], z1 - z0],
    ['back', [x1, top, z0], [-1, 0, 0], x1 - x0],
    ['left', [x0, top, z0], [0, 0, 1], z1 - z0],
  ];
  for (const [side, o0, dir, L] of runs) {
    const kind = sides[side] || 'parapet';
    if (kind === 'none') continue;
    const hh = kind === 'firewall' ? h + 0.45 : h;
    // frame: x along the run, z outward (= dir rotated: outward normal), wall from z=−T..0
    const nx = -dir[2], nz = dir[0]; // outward normal = dir × up (right-handed wall frame)
    b.push();
    b.frame(o0[0], 0, o0[2], dir[0], 0, dir[2], 0, 1, 0, nx, 0, nz);
    // inner face (between neighbouring runs' inner faces)
    b.rectZ(ik, T, y, L - T, y + hh, -T, -1);
    if (kind === 'firewall') { b.rectZ(o.outerKey || ik, 0, top, L, y + hh, 0, 1); b.rectX(ik, -T, top, 0, y + hh, 0, -1); b.rectX(ik, -T, top, 0, y + hh, L, 1); }
    coping(b, ck, L, T, y + hh);
    // flashing upstand at the roof edge (membrane turned up 0.15 m, 3 cm proud of the inner face);
    // the side runs stop short of the front / back upstands so the corner tops never overlap
    const fe = side === 'right' || side === 'left' ? 0.03 : 0;
    b.box(o.membraneKey || 'roof_membrane', T + fe, y, -T - 0.03, L - T - fe, y + 0.16, -T, NZ | PY | (fe ? PX | NX : 0));
    // walk colliders: the parapet keeps walkers on the roof
    if (b.collecting) b.colBox(0, y, -T, L, y + hh, 0);
    b.pop();
  }
}

/**
 * Membrane roof surface inside the parapets with drainage falls to a central valley/drains or
 * towards the back edge. rect = inner rect; y = level at the low points.
 * o: {key, fall=0.012 (per m), drains:boolean, mode:'ridge'|'back'}
 */
export function roofDeck(b, rect, y, o = {}) {
  const { x0, x1, z0, z1 } = rect, key = o.key || 'roof_membrane';
  const fall = o.fall ?? 0.012, d = z1 - z0;
  const mode = o.mode || 'ridge';
  // holes (stair houses over the stair well): the deck and its collider leave the well open, so
  // the last flight keeps its headroom and climbs into the stair house (o.holes [{x0,x1,z0,z1}])
  const holes = (o.holes || []).map((h) => ({ x0: Math.max(x0, h.x0), x1: Math.min(x1, h.x1), z0: Math.max(z0, h.z0), z1: Math.min(z1, h.z1) })).filter((h) => h.x1 - h.x0 > 0.05 && h.z1 - h.z0 > 0.05);
  if (holes.length) {
    const zm = (z0 + z1) / 2, yr = mode === 'ridge' ? y + fall * d * 0.5 : y + fall * d;
    const yAt = mode === 'ridge' ? (z) => yr - (yr - y) * Math.abs(z - zm) / (d / 2) : (z) => y + fall * (z - z0);
    const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h.x0, h.x1])])].sort((a, c) => a - c);
    const zs = [...new Set([z0, z1, ...(mode === 'ridge' ? [zm] : []), ...holes.flatMap((h) => [h.z0, h.z1])])].sort((a, c) => a - c);
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      const ax = xs[i], bx = xs[i + 1], az = zs[j], bz = zs[j + 1];
      if (bx - ax < 1e-4 || bz - az < 1e-4) continue;
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      if (holes.some((h) => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)) continue;
      const ya = yAt(az), yb = yAt(bz);
      b.quad(key, ax, yb, bz, bx, yb, bz, bx, ya, az, ax, ya, az);
      if (b.collecting) b.colQuad(ax, yb, bz, bx, yb, bz, bx, ya, az, ax, ya, az);
    }
    if (mode === 'ridge') {
      b.triangle(key, x0, y, z0, x0, y, z1, x0, yr, zm);
      b.triangle(key, x1, y, z1, x1, y, z0, x1, yr, zm);
      if (o.drains !== false) {
        const n = Math.max(1, Math.round((x1 - x0) / 9));
        for (let i = 0; i < n; i++) { const x = x0 + ((x1 - x0) * (i + 0.5)) / n; roofDrain(b, x, y - 0.005, z0 + 0.35); roofDrain(b, x, y - 0.005, z1 - 0.35); }
      }
    }
    return yr;
  }
  if (mode === 'ridge') {
    // ridge along x in the middle, falls to the front and back edges (drains at edges)
    const zm = (z0 + z1) / 2, yr = y + fall * d * 0.5;
    b.quad(key, x0, y, z1, x1, y, z1, x1, yr, zm, x0, yr, zm);
    b.quad(key, x0, yr, zm, x1, yr, zm, x1, y, z0, x0, y, z0);
    // small gable triangles at the ends to close against the parapet (hidden by upstand mostly)
    b.triangle(key, x0, y, z0, x0, y, z1, x0, yr, zm);
    b.triangle(key, x1, y, z1, x1, y, z0, x1, yr, zm);
    if (o.drains !== false) {
      const n = Math.max(1, Math.round((x1 - x0) / 9));
      for (let i = 0; i < n; i++) { const x = x0 + ((x1 - x0) * (i + 0.5)) / n; roofDrain(b, x, y - 0.005, z0 + 0.35); roofDrain(b, x, y - 0.005, z1 - 0.35); }
    }
    if (b.collecting) { b.colQuad(x0, y, z1, x1, y, z1, x1, yr, zm, x0, yr, zm); b.colQuad(x0, yr, zm, x1, yr, zm, x1, y, z0, x0, y, z0); }
    return yr;
  }
  const yb = y + fall * d;
  b.quad(key, x0, yb, z1, x1, yb, z1, x1, y, z0, x0, y, z0);
  if (b.collecting) b.colQuad(x0, yb, z1, x1, yb, z1, x1, y, z0, x0, y, z0);
  return yb;
}

/** Paving/deck tiles path on a roof garden (rect, y). */
export function deckArea(b, key, x0, z0, x1, z1, y, h = 0.06) {
  b.cbox(key, x0, y, z0, x1, y + h, z1, 0.01, false);
  if (b.collecting) b.colQuad(x0, y + h, z1, x1, y + h, z1, x1, y + h, z0, x0, y + h, z0);
}

/** HVAC condenser unit (rooftop): casing with chamfers, fan grilles, side louvres, feet. */
export function hvacUnit(b, x, y, z, rot = 0, o = {}) {
  const w = o.w ?? 2.2, d = o.d ?? 1.1, h = o.h ?? 1.2, key = o.key || 'hvac';
  const fans = o.fans ?? Math.max(1, Math.round(w / 1.1));
  b.push(); b.translate(x, y, z); b.rotY(rot);
  // steel rails / feet
  for (const zz of [-d / 2 + 0.1, d / 2 - 0.1]) b.box('steel_dark', -w / 2 - 0.1, 0, zz - 0.05, w / 2 + 0.1, 0.12, zz + 0.05, ALL & ~NY);
  b.cbox(key, -w / 2, 0.12, -d / 2, w / 2, 0.12 + h, d / 2, 0.025);
  // side louvre panels (front & back): grooves as thin slats
  for (const s of [1, -1]) {
    for (let yy = 0.3; yy < h - 0.1; yy += 0.09) b.box('grille_dark', -w / 2 + 0.08, 0.12 + yy, s * (d / 2) - (s > 0 ? 0 : 0.012), w / 2 - 0.08, 0.12 + yy + 0.035, s * (d / 2) + (s > 0 ? 0.012 : 0), s > 0 ? PZ | PY : NZ | PY);
  }
  // fans on top
  for (let i = 0; i < fans; i++) {
    const fx = -w / 2 + (w * (i + 0.5)) / fans;
    const r = Math.min(w / fans, d) * 0.42;
    b.lathe(key, [[r + 0.04, 0], [r + 0.04, 0.05], [r, 0.05]], 20, { x: fx, y: 0.12 + h, z: 0 });
    b.cylinder('grille_dark', fx, 0.12 + h + 0.005, 0, r, 0.02, 20, { top: true });
    // guard spokes
    for (let k = 0; k < 4; k++) { b.push(); b.translate(fx, 0.12 + h + 0.05, 0); b.rotY((k * Math.PI) / 4); b.box('steel_dark', -r, 0, -0.008, r, 0.012, 0.008, ALL); b.pop(); }
  }
  // pipes going down
  b.tube('aluminium', [[w / 2 - 0.2, 0.5, -d / 2], [w / 2 - 0.2, 0.5, -d / 2 - 0.25], [w / 2 - 0.2, 0.05, -d / 2 - 0.25]], 0.03, 8);
  b.pop();
  if (b.collecting) { b.push(); b.translate(x, y, z); b.rotY(rot); b.colBox(-w / 2, 0, -d / 2, w / 2, h + 0.15, d / 2); b.pop(); }
}

/** Small split-AC outdoor unit (facade ledges / balconies): x,y,z = bottom-centre, faces +z. */
export function acUnit(b, x, y, z, rot = 0, o = {}) {
  const w = o.w ?? 0.85, d = o.d ?? 0.32, h = o.h ?? 0.6;
  b.push(); b.translate(x, y, z); b.rotY(rot);
  b.cbox('hvac', -w / 2, 0.05, -d / 2, w / 2, 0.05 + h, d / 2, 0.015);
  // fan grille: dark disc on the front face with a hub
  {
    const p = b.part('grille_dark'), cx = -w * 0.12, cy = 0.05 + h / 2, z = d / 2 + 0.003, r = h * 0.36;
    const c = b.vert(p, cx, cy, z, 0, 0, 1, 0, 0); const ring = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ring.push(b.vert(p, cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, 0, 0, 1, 0, 0)); }
    for (let i = 0; i < 12; i++) b.tri(p, c, ring[i], ring[(i + 1) % 12]);
    b.box('hvac', cx - 0.05, cy - 0.05, z, cx + 0.05, cy + 0.05, z + 0.03, PX | NX | PY | NY | PZ);
  }
  for (const xx of [-w / 2 + 0.08, w / 2 - 0.08]) b.box('steel_dark', xx - 0.02, 0, -d / 2, xx + 0.02, 0.05, d / 2, ALL & ~NY);
  b.pop();
}

/** Mushroom vent (lathe) — soil/vent stacks above wet-room shafts. */
export function ventMushroom(b, x, y, z, r = 0.15, h = 0.6) {
  b.lathe('aluminium', [[r * 0.6, 0], [r * 0.6, h * 0.75], [r * 1.3, h * 0.78], [r * 1.35, h * 0.85], [r * 0.9, h], [0.0, h * 1.02]], 14, { x, y, z, capBottom: false });
}

/** Straight vent stack with a rain cap. */
export function ventStack(b, x, y, z, r = 0.08, h = 1.0) {
  b.cylinder('steel', x, y, z, r, h, 12, { top: false });
  b.lathe('steel', [[r * 2.2, 0], [r * 2.2, 0.03], [0, r * 1.4]], 12, { x, y: y + h + 0.08, z });
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; b.box('steel', x + Math.cos(a) * r * 0.9 - 0.006, y + h, z + Math.sin(a) * r * 0.9 - 0.006, x + Math.cos(a) * r * 0.9 + 0.006, y + h + 0.09, z + Math.sin(a) * r * 0.9 + 0.006, ALL); }
}

/** Roof hatch with upstand, lid, grab rails; ladder below when o.ladderDepth given. */
export function roofHatch(b, x, y, z, o = {}) {
  const w = o.w ?? 0.9, d = o.d ?? 1.0, k = o.key || 'steel';
  b.cbox('concrete', x - w / 2 - 0.12, y, z - d / 2 - 0.12, x + w / 2 + 0.12, y + 0.35, z + d / 2 + 0.12, 0.015, false);
  b.cbox(k, x - w / 2 - 0.08, y + 0.35, z - d / 2 - 0.08, x + w / 2 + 0.08, y + 0.42, z + d / 2 + 0.08, 0.01);
  // grab rails either side (yellow safety)
  for (const s of [-1, 1]) b.tube('steel_yellow', [[x + s * (w / 2 + 0.2), y, z - d / 2], [x + s * (w / 2 + 0.2), y + 1.1, z - d / 2 + 0.1], [x + s * (w / 2 + 0.2), y + 1.1, z + d / 2 - 0.1], [x + s * (w / 2 + 0.2), y, z + d / 2]], 0.022, 8, { transport: true });
  if (o.ladderDepth) ladder(b, x, y - o.ladderDepth, z - d / 2 + 0.08, o.ladderDepth + 0.4, 0);
}

/** Vertical steel ladder: x,z = centre at wall line, from y0 up height h, rotated rot. */
export function ladder(b, x, y0, z, h, rot = 0, o = {}) {
  const k = o.key || 'steel', w = o.w ?? 0.45;
  b.push(); b.translate(x, y0, z); b.rotY(rot);
  for (const s of [-1, 1]) b.box(k, s * w / 2 - 0.025, 0, 0.12, s * w / 2 + 0.025, h, 0.17, ALL);
  for (let yy = 0.25; yy < h; yy += 0.28) { b.push(); b.translate(-w / 2, yy, 0.145); b.rotZ(-Math.PI / 2); b.cylinder(k, 0, 0, 0, 0.014, w, 6, { top: false }); b.pop(); }
  for (let yy = 0.6; yy < h; yy += 1.5) for (const s of [-1, 1]) b.box(k, s * w / 2 - 0.015, yy, 0, s * w / 2 + 0.015, yy + 0.05, 0.12, ALL);
  b.pop();
}

/**
 * Stair house (penthouse over the stair core) with a door to the roof. rect in building
 * frame {x0,x1,z0,z1}, y = roof level, h = height. door: {side:'front'|'back'|'left'|'right'}.
 */
export function stairHouse(b, rect, y, h, o = {}) {
  const { x0, x1, z0, z1 } = rect, key = o.key || 'ceramic_white', T = 0.25;
  const side = o.door || 'front';
  // walls as a box shell with a door opening on `side`
  const W = x1 - x0, D = z1 - z0;
  const dw = 1.0, dh = 2.15;
  const runs = { front: [x0, z1, 1, 0, W], right: [x1, z1, 0, -1, D], back: [x1, z0, -1, 0, W], left: [x0, z0, 0, 1, D] };
  // door centre along its run (o.doorU, metres from the run's start: front from x0, right from z1,
  // back from x1, left from z0 — the floor landing end of the stair below); default the middle
  const runL = side === 'front' || side === 'back' ? W : D;
  const du = o.doorU != null ? Math.max(T + dw / 2 + 0.05, Math.min(runL - T - dw / 2 - 0.05, o.doorU)) : runL / 2;
  for (const [sd, [ox, oz, dx, dz, L]] of Object.entries(runs)) {
    b.push(); b.frame(ox, 0, oz, dx, 0, dz, 0, 1, 0, -dz, 0, dx);
    const ops = sd === side ? [{ u0: du - dw / 2, u1: du + dw / 2, v0: y + 0.15, v1: y + 0.15 + dh, reveal: 0.12, noSillReveal: true }] : [];
    wallRun(b, key, L, y, y + h, T, ops);
    if (ops.length) doorUnit(b, { u0: ops[0].u0, u1: ops[0].u1, v0: y + 0.15, v1: y + 0.15 + dh, R: 0.12, kind: 'service', open: o.open ?? 0 });
    if (ops.length) b.cylinder('light_warm', du, y + 0.15 + dh + 0.25, 0.05, 0.08, 0.04, 10, { top: true });
    b.pop();
  }
  // roof slab with coping band
  b.cbox(o.capKey || 'ceramic_band', x0 - 0.06, y + h, z0 - 0.06, x1 + 0.06, y + h + 0.22, z1 + 0.06, 0.03);
  if (b.collecting) {
    // four walls with the roof door left open (the door side used to be one solid box: the roof —
    // and a tower standing on a podium roof — could not be reached on foot); wall above the door
    const dz = side === 'front' || side === 'back', cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (const sd of ['front', 'back', 'left', 'right']) {
      const along = sd === 'front' || sd === 'back';
      const box = (a, c) => {
        if (sd === 'front') b.colBox(a, y, z1 - T, c, y + h, z1);
        else if (sd === 'back') b.colBox(a, y, z0, c, y + h, z0 + T);
        else if (sd === 'left') b.colBox(x0, y, a, x0 + T, y + h, c);
        else b.colBox(x1 - T, y, a, x1, y + h, c);
      };
      // door centre in plan coordinates (runs: front from x0, back from x1, right from z1, left from z0)
      const dm = o.doorU == null ? (along ? cx : cz) : sd === 'front' ? x0 + du : sd === 'back' ? x1 - du : sd === 'right' ? z1 - du : z0 + du;
      const a0 = along ? x0 : z0, a1 = along ? x1 : z1, m = dm;
      if (sd !== side) { box(a0, a1); continue; }
      box(a0, m - dw / 2); box(m + dw / 2, a1);
      const yd = y + 0.15 + dh;
      if (sd === 'front') b.colBox(m - dw / 2, yd, z1 - T, m + dw / 2, y + h, z1);
      else if (sd === 'back') b.colBox(m - dw / 2, yd, z0, m + dw / 2, y + h, z0 + T);
      else if (sd === 'left') b.colBox(x0, yd, m - dw / 2, x0 + T, y + h, m + dw / 2);
      else b.colBox(x1 - T, yd, m - dw / 2, x1, y + h, m + dw / 2);
      void dz;
    }
  }
}

function wallRun(b, key, L, y0, y1, T, ops) {
  // lightweight version of wallWithOpenings (avoid a cycle: walls.js imports nothing from here)
  // emits outer face (grid) and reveals for doors; no end caps: the runs of a box shell overlap at
  // the corners, so a cap would lie in the neighbouring run's outer face (coplanar z-fighting, QQ-02)
  const holes = ops.map((p) => [p.u0, p.u1, p.v0, p.v1]);
  const us = [0, L], vs = [y0, y1];
  for (const h of holes) { us.push(h[0], h[1]); vs.push(h[2], h[3]); }
  const U = [...new Set(us)].sort((a, c) => a - c), V = [...new Set(vs)].sort((a, c) => a - c);
  for (let i = 0; i < U.length - 1; i++) for (let j = 0; j < V.length - 1; j++) {
    const cu = (U[i] + U[i + 1]) / 2, cv = (V[j] + V[j + 1]) / 2;
    if (holes.some((h) => cu > h[0] && cu < h[1] && cv > h[2] && cv < h[3])) continue;
    b.rectZ(key, U[i], V[j], U[i + 1], V[j + 1], 0, 1);
    b.rectZ('render_white', U[i], V[j], U[i + 1], V[j + 1], -T, -1);
  }
  for (const p of ops) {
    b.rectX(key, -T, p.v0, 0, p.v1, p.u0, 1); b.rectX(key, -T, p.v0, 0, p.v1, p.u1, -1); b.rectY(key, p.u0, -T, p.u1, 0, p.v1, -1);
  }
}

/** Lift overrun box with louvre vent. */
export function liftOverrun(b, rect, y, h, o = {}) {
  const { x0, x1, z0, z1 } = rect;
  b.cbox(o.key || 'ceramic_white', x0, y, z0, x1, y + h, z1, 0.03, false);
  b.cbox(o.capKey || 'ceramic_band', x0 - 0.05, y + h, z0 - 0.05, x1 + 0.05, y + h + 0.15, z1 + 0.05, 0.02);
  b.box('grille_dark', x0 + 0.3, y + h - 0.7, z1, x1 - 0.3, y + h - 0.3, z1 + 0.01, PZ);
}

/** Cylindrical water tank on a steel stand. */
export function waterTank(b, x, y, z, r = 0.8, h = 1.8) {
  const leg = 0.5;
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.78; b.box('steel_dark', x + Math.cos(a) * r * 0.7 - 0.04, y, z + Math.sin(a) * r * 0.7 - 0.04, x + Math.cos(a) * r * 0.7 + 0.04, y + leg, z + Math.sin(a) * r * 0.7 + 0.04, ALL & ~NY); }
  b.lathe('tank_white', [[r * 0.95, 0], [r, 0.08], [r, h - 0.12], [r * 0.9, h - 0.02], [r * 0.25, h + 0.1], [0.0, h + 0.12]], 22, { x, y: y + leg, z, capBottom: true });
  for (const hh of [h * 0.3, h * 0.7]) b.lathe('steel_dark', [[r + 0.012, 0], [r + 0.012, 0.05]], 22, { x, y: y + leg + hh, z });
  b.tube('steel', [[x + r, y + leg + 0.3, z], [x + r + 0.3, y + leg + 0.3, z], [x + r + 0.3, y + 0.05, z]], 0.04, 8);
}

/** Antenna mast with dishes and whips (deterministic layout from seed). */
export function antennaMast(b, x, y, z, h = 4, seed = 1) {
  const r = new Rng(hash4(seed, 5, 0, 0));
  b.cbox('concrete', x - 0.35, y, z - 0.35, x + 0.35, y + 0.25, z + 0.35, 0.02, false);
  b.cylinder('steel', x, y + 0.25, z, 0.06, h, 10, { top: true });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    b.tube('steel', [[x, y + h * 0.6, z], [x + Math.cos(a) * 1.2, y + 0.25, z + Math.sin(a) * 1.2]], 0.012, 6);
  }
  const dishes = 1 + Math.floor(r.next() * 2);
  for (let i = 0; i < dishes; i++) {
    const yy = y + h * (0.45 + 0.2 * i), a = r.next() * Math.PI * 2;
    b.push(); b.translate(x + Math.cos(a) * 0.25, yy, z + Math.sin(a) * 0.25); b.rotY(-a + Math.PI / 2); b.rotX(-Math.PI / 2 + 0.25);
    b.lathe('tank_white', [[0.0, 0.0], [0.25, 0.04], [0.42, 0.12], [0.44, 0.14]], 18, { smoothAngle: 60 });
    b.lathe('tank_white', [[0.44, 0.13], [0.25, 0.03], [0.0, -0.01]], 18, { smoothAngle: 60 });
    b.pop();
  }
  for (let i = 0; i < 3; i++) { const a = r.next() * Math.PI * 2; b.cylinder('steel_dark', x + Math.cos(a) * 0.12, y + h * 0.85, z + Math.sin(a) * 0.12, 0.03, 0.8 + r.next() * 0.8, 6, { top: true }); }
  b.cylinder('light_red', x, y + h + 0.25, z, 0.05, 0.08, 8, { top: true });
}

/**
 * Solar array over a rect at roof level y: rows of tilted PV panels on steel frames facing
 * `azimuth` (radians about y; 0 = panels face +z). Panels 1.0 × 1.7 m.
 */
export function solarArray(b, rect, y, o = {}) {
  const { x0, x1, z0, z1 } = rect, tilt = o.tilt ?? 0.32, rowD = o.rowSpacing ?? 2.6;
  const pw = 1.02, ph = 1.7;
  const W = x1 - x0, D = z1 - z0;
  const nRows = Math.max(1, Math.floor(D / rowD)), nCols = Math.max(1, Math.floor(W / (pw + 0.02)));
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.push(); b.translate(cx, y, cz); b.rotY(o.azimuth ?? 0);
  for (let r = 0; r < nRows; r++) {
    const zc = -D / 2 + rowD * (r + 0.5);
    const hBack = Math.sin(tilt) * ph + 0.3;
    // frame legs
    for (let c = 0; c <= nCols; c += 2) {
      const xx = -nCols * (pw + 0.02) / 2 + c * (pw + 0.02);
      b.box('steel', xx - 0.025, 0, zc + 0.6, xx + 0.025, 0.3, zc + 0.65, ALL & ~NY);
      b.box('steel', xx - 0.025, 0, zc - 0.65, xx + 0.025, hBack, zc - 0.6, ALL & ~NY);
      b.box('concrete', xx - 0.15, 0, zc - 0.8, xx + 0.15, 0.08, zc + 0.8, ALL & ~NY);
    }
    for (let c = 0; c < nCols; c++) {
      const xa = -nCols * (pw + 0.02) / 2 + c * (pw + 0.02);
      b.push(); b.translate(xa + pw / 2, 0.3, zc + ph / 2 * Math.cos(tilt)); b.rotX(-tilt);
      // panel: frame + cell surface (explicit uv 0..1 for the cell texture)
      b.box('aluminium', -pw / 2, -0.035, -ph, pw / 2, 0.0, 0, ALL);
      b.quad('solar_panel', -pw / 2 + 0.015, 0.001, -0.015, pw / 2 - 0.015, 0.001, -0.015, pw / 2 - 0.015, 0.001, -ph + 0.015, -pw / 2 + 0.015, 0.001, -ph + 0.015, [0, 0, 1, 0, 1, 1, 0, 1]);
      b.pop();
    }
  }
  b.pop();
}

/** Skylight: concrete upstand + framed glass hip. */
export function skylight(b, rect, y, o = {}) {
  const { x0, x1, z0, z1 } = rect;
  b.cbox('concrete', x0, y, z0, x1, y + 0.3, z1, 0.015, false);
  const h = Math.min(0.5, (x1 - x0) * 0.25);
  const xm0 = x0 + 0.1, xm1 = x1 - 0.1, zm0 = z0 + 0.1, zm1 = z1 - 0.1;
  const ridge0 = xm0 + (zm1 - zm0) / 2, ridge1 = xm1 - (zm1 - zm0) / 2, zm = (zm0 + zm1) / 2;
  const yt = y + 0.3 + h, yb = y + 0.32;
  const gk = o.glassKey || 'glass_frosted';
  b.quad(gk, xm0, yb, zm1, xm1, yb, zm1, Math.max(ridge1, (xm0 + xm1) / 2), yt, zm, Math.min(ridge0, (xm0 + xm1) / 2), yt, zm);
  b.quad(gk, xm1, yb, zm0, xm0, yb, zm0, Math.min(ridge0, (xm0 + xm1) / 2), yt, zm, Math.max(ridge1, (xm0 + xm1) / 2), yt, zm);
  b.triangle(gk, xm0, yb, zm0, xm0, yb, zm1, Math.min(ridge0, (xm0 + xm1) / 2), yt, zm);
  b.triangle(gk, xm1, yb, zm1, xm1, yb, zm0, Math.max(ridge1, (xm0 + xm1) / 2), yt, zm);
  b.cbox('aluminium', x0 + 0.05, y + 0.3, z0 + 0.05, x1 - 0.05, y + 0.34, z1 - 0.05, 0.01);
}

/** Plant room: louvred enclosure with a service door. rect, y, h. */
export function plantRoom(b, rect, y, h, o = {}) {
  const { x0, x1, z0, z1 } = rect, key = o.key || 'ceramic_white';
  b.cbox(key, x0, y, z0, x1, y + 0.35, z1, 0.02, false);
  // louvre walls: vertical framing + horizontal blades on all 4 sides
  const fk = 'aluminium';
  const sides = [[x0, z1, x1, z1, 0, 0, 1], [x1, z1, x1, z0, 1, 0, 0], [x1, z0, x0, z0, 0, 0, -1], [x0, z0, x0, z1, -1, 0, 0]];
  for (const [ax, az, cx, cz, nx, , nz] of sides) {
    const L = Math.hypot(cx - ax, cz - az), dx = (cx - ax) / L, dz = (cz - az) / L;
    b.push(); b.frame(ax, 0, az, dx, 0, dz, 0, 1, 0, nx, 0, nz);
    const n = Math.max(1, Math.round(L / 1.5));
    for (let i = 0; i <= n; i++) b.box(fk, (L * i) / n - 0.04, y + 0.35, -0.08, (L * i) / n + 0.04, y + h, 0.0, ALL);
    for (let yy = y + 0.45; yy < y + h - 0.1; yy += 0.12) { b.push(); b.translate(0, yy, -0.05); b.rotX(-0.6); b.box(fk, 0.04, -0.005, -0.05, L - 0.04, 0.005, 0.05, PY | NY | PZ | NZ); b.pop(); }
    b.rectZ('grille_dark', 0, y + 0.35, L, y + h, -0.12, 1);
    b.pop();
  }
  b.cbox(o.capKey || 'ceramic_band', x0 - 0.08, y + h, z0 - 0.08, x1 + 0.08, y + h + 0.25, z1 + 0.08, 0.03);
  if (b.collecting) b.colBox(x0, y, z0, x1, y + h, z1);
}

/**
 * Roof garden: planters with soil + shrubs + small trees, deck paths, benches, optional
 * pergola. rect = usable inner roof area; y = roof deck level. Avoids `keepOut` rects.
 */
export function roofGarden(b, rect, y, seed, o = {}) {
  const r = new Rng(hash4(seed, 77, 0, 0));
  const { x0, x1, z0, z1 } = rect;
  const W = x1 - x0, D = z1 - z0;
  const keep = o.keepOut || [];
  const free = (a, c, d0, d1) => !keep.some((k) => a < k.x1 && c > k.x0 && d0 < k.z1 && d1 > k.z0);
  // perimeter planter strip along the front edge and short sides
  const pd = Math.min(1.0, D * 0.2);
  const segs = Math.max(1, Math.round(W / 3.2));
  for (let i = 0; i < segs; i++) {
    const a = x0 + (W * i) / segs + 0.15, c = x0 + (W * (i + 1)) / segs - 0.15;
    if (free(a, c, z1 - pd, z1)) planterBox(b, a, z1 - pd, c, z1 - 0.05, y, 0.5, (seed + i * 7) >>> 0, { tree: i % 3 === 1 && D > 6, treeH: 2.6 + r.next() * 1.4, density: 0.9 });
  }
  // a couple of island planters with trees
  const islands = Math.max(1, Math.round((W * D) / 90));
  for (let i = 0; i < islands; i++) {
    const w = 1.6 + r.next() * 1.4, d = 1.2 + r.next() * 0.8;
    const cx = x0 + 1 + r.next() * Math.max(0.1, W - 2 - w), cz = z0 + 1 + r.next() * Math.max(0.1, D - pd - 2 - d);
    if (!free(cx - 0.3, cx + w + 0.3, cz - 0.3, cz + d + 0.3)) continue;
    planterBox(b, cx, cz, cx + w, cz + d, y, 0.55, (seed * 3 + i) >>> 0, { tree: true, treeH: 2.8 + r.next() * 1.8, density: 0.9 });
    // bench beside
    if (free(cx, cx + 1.6, cz + d + 0.3, cz + d + 0.8)) bench(b, cx + w / 2, y, cz + d + 0.55, 0);
  }
  // deck path
  if (free(x0 + 0.3, x1 - 0.3, z0 + D * 0.4, z0 + D * 0.4 + 1.4)) deckArea(b, o.deckKey || 'wood_deck', x0 + 0.3, z0 + D * 0.4, x1 - 0.3, z0 + D * 0.4 + 1.4, y + 0.01, 0.05);
}

/** Outdoor bench (current frame), seat facing +z. */
export function bench(b, x, y, z, rot = 0) {
  b.push(); b.translate(x, y, z); b.rotY(rot);
  for (const s of [-0.6, 0.6]) b.cbox('aluminium_dark', s - 0.04, 0, -0.22, s + 0.04, 0.42, 0.2, 0.008, false);
  for (let k = 0; k < 4; k++) b.cbox('wood', -0.75, 0.42, -0.22 + k * 0.11, 0.75, 0.46, -0.13 + k * 0.11, 0.008);
  b.pop();
  if (b.collecting) { b.push(); b.translate(x, y, z); b.rotY(rot); b.colBox(-0.75, 0, -0.22, 0.75, 0.46, 0.22); b.pop(); }
}

/**
 * Pitched roof over a rect (building frame) with the ridge along the long axis: sloped slabs with
 * thickness, eaves + verge overhangs, fascia, ridge cap, gable walls (gableKey) above the eave,
 * half-round gutters. key 'roof_metal' → standing seams + snow guards; 'roof_shingle' (glazed
 * ceramic tiles) → tiled verges and a round ridge course. y = eave (top of walls). Optional
 * roofTint, flush solar panels on the slope facing `sunSide` (+1 / −1 of local z) and roof windows
 * (o.seed decides). Returns the ridge height.
 */
export function pitchedRoof(b, rect, y, o = {}) {
  const { x0, x1, z0, z1 } = rect;
  const W = x1 - x0, D = z1 - z0;
  const alongX = o.ridgeAxis ? o.ridgeAxis === 'x' : W >= D;
  const pitch = o.pitch ?? 0.52;               // ~30°
  const ov = o.overhang ?? 0.45, t = 0.16;
  const key = o.key || 'roof_metal', gk = o.gableKey || 'ceramic_white', fk = o.fasciaKey || 'aluminium_dark';
  const metal = key === 'roof_metal';
  // verge overhang per gable end (0 at party walls so terrace roofs meet without overlap)
  const vgA = o.vergeA ?? o.verge ?? 0.3, vgB = o.vergeB ?? o.verge ?? 0.3;
  const rng = new Rng(hash4(o.seed || 1, 91, 0, 0));
  // work in a local frame where the ridge runs along local x
  b.push();
  if (alongX) b.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  else { b.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); b.rotY(Math.PI / 2); }
  const L = alongX ? W : D, S = alongX ? D : W; // ridge length, span
  const half = S / 2;
  const tp = Math.tan(pitch), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const rise = tp * half;
  const yr = y + rise;
  const ex = half + ov, ey = y - tp * ov; // eave edge
  const xa = -L / 2 - vgA, xb = L / 2 + vgB;
  const len = Math.hypot(ex, yr - ey);
  // slope point at local x, distance s down the slope from the ridge, height h above the surface
  const P = (sg, s, h) => [sg * (s * cp - h * sp), yr - s * sp + h * cp];
  const slope = (sg) => {
    const zA = 0, zB = sg * ex;
    if (o.roofTint) b.pushTint(o.roofTint);
    if (sg > 0) b.quad(key, xa, ey, zB, xb, ey, zB, xb, yr, zA, xa, yr, zA, [xa, len, xb, len, xb, 0, xa, 0]);
    else b.quad(key, xb, ey, zB, xa, ey, zB, xa, yr, zA, xb, yr, zA, [xb, len, xa, len, xa, 0, xb, 0]);
    if (o.roofTint) b.popTint();
    // underside (soffit) + fascia
    const dy = -t / cp;
    if (sg > 0) { b.quad('render_white', xa, yr + dy, zA, xb, yr + dy, zA, xb, ey + dy, zB, xa, ey + dy, zB); b.quad(fk, xa, ey + dy - 0.05, zB, xb, ey + dy - 0.05, zB, xb, ey + 0.02, zB, xa, ey + 0.02, zB); }
    else { b.quad('render_white', xb, yr + dy, zA, xa, yr + dy, zA, xa, ey + dy, zB, xb, ey + dy, zB); b.quad(fk, xb, ey + dy - 0.05, zB, xa, ey + dy - 0.05, zB, xa, ey + 0.02, zB, xb, ey + 0.02, zB); }
    if (metal) {
      // standing seams (thin ribs down the slope)
      const n = Math.floor((xb - xa) / 0.55);
      for (let i = 1; i < n; i++) {
        const x = xa + ((xb - xa) * i) / n;
        b.quad(key, x - 0.012, yr + 0.035, zA, x + 0.012, yr + 0.035, zA, x + 0.012, ey + 0.035, zB, x - 0.012, ey + 0.035, zB);
        if (sg > 0) { b.quad(key, x - 0.012, ey, zB, x - 0.012, ey + 0.035, zB, x - 0.012, yr + 0.035, zA, x - 0.012, yr, zA); b.quad(key, x + 0.012, yr, zA, x + 0.012, yr + 0.035, zA, x + 0.012, ey + 0.035, zB, x + 0.012, ey, zB); }
        else { b.quad(key, x - 0.012, yr, zA, x - 0.012, yr + 0.035, zA, x - 0.012, ey + 0.035, zB, x - 0.012, ey, zB); b.quad(key, x + 0.012, ey, zB, x + 0.012, ey + 0.035, zB, x + 0.012, yr + 0.035, zA, x + 0.012, yr, zA); }
      }
      if (o.snowGuards !== false) b.tube('steel', [[xa + 0.2, ey + 0.12 + (rise / ex) * 0.6, sg * (ex - 0.6)], [xb - 0.2, ey + 0.12 + (rise / ex) * 0.6, sg * (ex - 0.6)]], 0.02, 6);
    } else {
      // eave course: a slightly thicker first row of tiles over the gutter
      const [e0z, e0y] = P(sg, len - 0.02, 0.0), [e1z, e1y] = P(sg, len - 0.36, 0.035);
      b.pushTint(o.roofTint || [1, 1, 1]);
      if (sg > 0) b.quad(key, xa, e0y + 0.03, e0z, xb, e0y + 0.03, e0z, xb, e1y, e1z, xa, e1y, e1z, [xa, 0.33, xb, 0.33, xb, 0.0, xa, 0.0]);
      else b.quad(key, xb, e0y + 0.03, e0z, xa, e0y + 0.03, e0z, xa, e1y, e1z, xb, e1y, e1z, [xb, 0.33, xa, 0.33, xa, 0.0, xb, 0.0]);
      b.popTint();
    }
  };
  slope(1); slope(-1);
  // verge ends (gable edges of the roof slab) — tiled verges on ceramic roofs
  for (const [xx, sx] of [[xa, -1], [xb, 1]]) {
    const dy = -t / cp;
    const vk = metal ? fk : key;
    if ((sx < 0 ? o.partyA : o.partyB)) {
      // party wall: the upstand closes the roof slab over the wall; only the eave overhang beyond
      // the wall face gets an end face (visible where the neighbour is lower or set back)
      const zh = half + 0.02, yh = yr - tp * zh;
      if (sx < 0) { b.quad(vk, xx, ey + dy, ex, xx, ey, ex, xx, yh, zh, xx, yh + dy, zh); b.quad(vk, xx, ey + dy, -ex, xx, yh + dy, -zh, xx, yh, -zh, xx, ey, -ex); }
      else { b.quad(vk, xx, ey, ex, xx, ey + dy, ex, xx, yh + dy, zh, xx, yh, zh); b.quad(vk, xx, yh + dy, -zh, xx, ey + dy, -ex, xx, ey, -ex, xx, yh, -zh); }
      continue;
    }
    if (sx < 0) { b.quad(vk, xx, ey + dy, ex, xx, ey, ex, xx, yr, 0, xx, yr + dy, 0); b.quad(vk, xx, ey + dy, -ex, xx, yr + dy, 0, xx, yr, 0, xx, ey, -ex); }
    else { b.quad(vk, xx, ey, ex, xx, ey + dy, ex, xx, yr + dy, 0, xx, yr, 0); b.quad(vk, xx, yr + dy, 0, xx, ey + dy, -ex, xx, ey, -ex, xx, yr, 0); }
    if (!metal) {
      // verge tile roll along the gable edge
      for (const sg of [1, -1]) { const a = P(sg, 0.05, 0.03), c = P(sg, len, 0.03); b.sweep(key, [[xx - sx * 0.04, a[1], a[0]], [xx - sx * 0.04, c[1], c[0]]], VERGE_ROLL, { smoothAngle: 10 }); }
    }
  }
  // ridge cap
  if (metal) b.sweep(fk, [[xa - 0.02, yr + 0.02, 0], [xb + 0.02, yr + 0.02, 0]], [[-0.14, -0.03], [0.14, -0.03], [0.0, 0.08]], { smoothAngle: 10 });
  else {
    b.pushTint(o.roofTint || [1, 1, 1]);
    b.sweep(key, [[xa - 0.03, yr + 0.01, 0], [xb + 0.03, yr + 0.01, 0]], RIDGE_ROLL, { smoothAngle: 40 });
    b.popTint();
  }
  // gable walls (triangles above the eave line) in the facade material; party walls rise above
  // the roof as an upstand with a coping. Each house builds ITS half of the upstand (inside its own
  // footprint, flush with the boundary): equal neighbours join into one 0.32 m upstand with a
  // continuous coping, and a house taller than its neighbour still shows a closed gable wall (its
  // own upstand) above the lower roof — nothing depends on knowing the neighbour's height.
  for (const [xx, sx] of [[-L / 2, -1], [L / 2, 1]]) {
    const party = sx < 0 ? o.partyA : o.partyB;
    if (party) {
      // starts at the eave line: below it the facade walls' end caps and the party wall already close
      // the boundary (a band reaching 0.3 m down was coplanar with them and z-fought, QQ-02)
      const up = 0.32, hw = 0.16, prof = [[-half - 0.02, y], [half + 0.02, y], [half + 0.02, y + up - 0.02 * tp], [0, yr + up / cp], [-half - 0.02, y + up - 0.02 * tp]];
      const xi = sx < 0 ? xx : xx - hw;          // this house's half: [xx, xx+hw] (left) / [xx−hw, xx] (right)
      b.push(); b.translate(xi, 0, 0);
      b.extrudeX(gk, prof, 0, hw, { smoothAngle: 5 });
      b.pop();
      // half coping: flush with the boundary, 3 cm drip over the inner face (s = right of travel:
      // travelling up the slope on the +z side the inner side (+x for the left boundary) is s < 0)
      const ck = o.copingKey || 'aluminium';
      for (const sg of [1, -1]) {
        const inner = -sx * sg;                    // sign of s pointing into this house
        const a = [0, -0.02], bq = [inner * (hw + 0.03), -0.02], c = [inner * (hw + 0.03), 0.03], dq = [inner * 0.02, 0.055], e = [0, 0.055];
        const pr = inner > 0 ? [a, bq, c, dq, e] : [bq, a, e, dq, c];
        b.sweep(ck, [[xx, y + up - 0.02 * tp + 0.01, sg * (half + 0.05)], [xx, yr + up / cp + 0.01, 0]], pr, { smoothAngle: 20 });
      }
      continue;
    }
    if (sx < 0) b.quad(gk, xx, y, -half, xx, y, half, xx, yr - 0.05, 0, xx, yr - 0.05, 0);
    else b.quad(gk, xx, y, half, xx, y, -half, xx, yr - 0.05, 0, xx, yr - 0.05, 0);
  }
  // half-round gutters along both eaves
  for (const sg of [1, -1]) gutter(b, [[xa + 0.05, ey - 0.06, sg * (ex + 0.06)], [xb - 0.05, ey - 0.06, sg * (ex + 0.06)]], { key: fk });
  // slope furniture: flush PV on the sunny slope, roof windows on the other (attic light)
  const sunSg = o.sunSide ?? 1;
  const usable = L - 1.6;
  if (usable > 2.5 && len > 2.6) {
    if (rng.next() < (o.solarChance ?? 0.45)) {
      const nCols = Math.max(1, Math.floor(usable / 1.05)), nRows = Math.max(1, Math.min(3, Math.floor((len - 1.4) / 1.75)));
      const x0p = -nCols * 1.05 / 2;
      for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) {
        const s0 = 0.5 + r * 1.75, s1 = s0 + 1.7, xa2 = x0p + c * 1.05 + 0.02, xb2 = xa2 + 1.01;
        const [za, ya] = P(sunSg, s0, 0.05), [zb, yb] = P(sunSg, s1, 0.05);
        const [za2, ya2] = P(sunSg, s0, 0.09), [zb2, yb2] = P(sunSg, s1, 0.09);
        // frame (thin box via quads) + cells
        if (sunSg > 0) {
          b.quad('aluminium', xa2, ya2, za2, xb2, ya2, za2, xb2, ya, za, xa2, ya, za);
          b.quad('aluminium', xb2, yb2, zb2, xa2, yb2, zb2, xa2, yb, zb, xb2, yb, zb);
          b.quad('solar_panel', xa2, yb2, zb2, xb2, yb2, zb2, xb2, ya2, za2, xa2, ya2, za2, [0, 1, 1, 1, 1, 0, 0, 0]);
        } else {
          b.quad('aluminium', xb2, ya2, za2, xa2, ya2, za2, xa2, ya, za, xb2, ya, za);
          b.quad('aluminium', xa2, yb2, zb2, xb2, yb2, zb2, xb2, yb, zb, xa2, yb, zb);
          b.quad('solar_panel', xb2, yb2, zb2, xa2, yb2, zb2, xa2, ya2, za2, xb2, ya2, za2, [0, 1, 1, 1, 1, 0, 0, 0]);
        }
        b.quad('aluminium', xa2, ya2, za2, xa2, ya, za, xa2, yb, zb, xa2, yb2, zb2);
        b.quad('aluminium', xb2, ya, za, xb2, ya2, za2, xb2, yb2, zb2, xb2, yb, zb);
      }
    }
    const nw = rng.next() < 0.7 ? Math.max(1, Math.min(3, Math.floor(usable / 4))) : 0;
    for (let i = 0; i < nw; i++) {
      const xc = -usable / 2 + (usable * (i + 0.5)) / nw, s0 = len * 0.3, s1 = s0 + 1.15;
      const sg = -sunSg;
      b.push(); b.translate(xc, 0, 0);
      const [za, ya] = P(sg, s0, 0.0), [zb, yb] = P(sg, s1, 0.0), [za1, ya1] = P(sg, s0, 0.11), [zb1, yb1] = P(sg, s1, 0.11);
      const hw = 0.39;
      // kerb (aluminium_dark) and the glass pane slightly recessed in it
      const Q4 = (k, a, c, d, e) => b.quad(k, ...a, ...c, ...d, ...e);
      const A0 = [-hw, ya, za], B0 = [hw, ya, za], C0 = [hw, yb, zb], D0 = [-hw, yb, zb];
      const A1 = [-hw, ya1, za1], B1 = [hw, ya1, za1], C1 = [hw, yb1, zb1], D1 = [-hw, yb1, zb1];
      if (sg > 0) { Q4(fk, A0, B0, B1, A1); Q4(fk, C0, D0, D1, C1); Q4(fk, B0, C0, C1, B1); Q4(fk, D0, A0, A1, D1); }
      else { Q4(fk, B0, A0, A1, B1); Q4(fk, D0, C0, C1, D1); Q4(fk, C0, B0, B1, C1); Q4(fk, A0, D0, D1, A1); }
      const [zg0, yg0] = P(sg, s0 + 0.06, 0.09), [zg1, yg1] = P(sg, s1 - 0.06, 0.09);
      b.setExtra('iwin0', 0.3, 3.2, 3.6, 2.4); b.setExtra('iwin1', 1.4, (i * 0.37 + 0.2) % 1, 99, 900 + i); b.setExtra('iwin2', 0, 0, 1, 0);
      if (sg > 0) b.quad('glass_window', -hw + 0.06, yg1, zg1, hw - 0.06, yg1, zg1, hw - 0.06, yg0, zg0, -hw + 0.06, yg0, zg0, [0, 0, 0.66, 0, 0.66, 1.0, 0, 1.0]);
      else b.quad('glass_window', hw - 0.06, yg1, zg1, -hw + 0.06, yg1, zg1, -hw + 0.06, yg0, zg0, hw - 0.06, yg0, zg0, [0, 0, 0.66, 0, 0.66, 1.0, 0, 1.0]);
      b.clearExtra('iwin0'); b.clearExtra('iwin1'); b.clearExtra('iwin2');
      b.pop();
    }
  }
  b.pop();
  return yr;
}
const VERGE_ROLL = [[-0.07, -0.03], [0.07, -0.03], [0.07, 0.03], [-0.07, 0.03]];
const RIDGE_ROLL = [[-0.13, -0.02], [0.13, -0.02], [0.12, 0.03], [0.08, 0.07], [0.0, 0.09], [-0.08, 0.07], [-0.12, 0.03]];

export { shrub, smallTree, plantBed, planterBox };
