// Long-span halls and sheds for the Zhurong family (owner: buildings-z): market halls, warehouses,
// port sheds, school gyms, community halls, ferry / station halls. Helper module (no default export).
//
//   hall(ctx, o)           walls with real openings on four sides + roof ('flat' | 'vault' | 'sawtooth' |
//                          'gable' | 'none') + steel portal frames + floor / inner faces / colliders
//   rollerDoor(b, o)       sectional loading door in a wall opening (wall frame), optional dock leveller
//   dockLeveller(b, o)     raised loading dock with leveller plate, bumpers, dock seal, edge stripe
//   entranceSteps(ctx, o)  landing + steps + ramp (+ flat canopy) outside a door (wall frame of a side)
//   roofProfile(o)         eave/ridge heights + y(z) of a roof kind (used by the facade gables)
// Frames: hall rect {x0,x1,z0,z1} in the building frame; sides use wall frames (u along the facade
// from its left end seen from outside, y up, z outward) of that rect.

import * as K from '../kit/index.js';
import { kindCode } from '../kit/plan.js';
import { clamp, isFB, glassScreen } from './z_common.js';
import { finLoft } from './z_curtain.js';

const SIDES = ['front', 'right', 'back', 'left'];

/** Roof height function across the depth (z) for a roof kind. Returns {eave, ridge, y(z), axis}. */
export function roofProfile(o) {
  const { z0, z1 } = o, D = z1 - z0, zm = (z0 + z1) / 2;
  const eave = o.y0 + o.eave;
  const kind = o.roof?.kind || 'flat';
  const rise = o.roof?.rise ?? (kind === 'vault' ? D * 0.16 : kind === 'gable' ? D * 0.06 : 0);
  let y = () => eave;
  if (kind === 'vault') y = (z) => { const t = (z - zm) / (D / 2); return eave + rise * Math.sqrt(Math.max(0, 1 - t * t * 0.84)) - rise * 0.4; };
  else if (kind === 'gable') y = (z) => eave + rise * (1 - Math.abs(z - zm) / (D / 2));
  // vault: springs at eave (t = ±1 → sqrt(0.16) = 0.4 → eave)
  return { eave, ridge: eave + rise, y, kind, rise };
}

/**
 * Hall. o: { x0,x1,z0,z1, y0 (FFL), eave (wall height above FFL), wallKey, wallT=0.3, wallTint,
 *   sides: { front: { openings:[{u0,u1,v0,v1,kind,...}], skip, solid }, ... },
 *   roof: { kind, rise, key, soffitKey, overhang=0.6, lights:'crown'|'strips'|false, teeth (sawtooth count),
 *           glazeSide:'back'|'front', parapet (flat), parapetSides ({side:'none'} where another volume abuts) },
 *   frames: spacing (portal frames along x; 0 = none), frameKey, floorKey, noFloor (caller draws the floor), interior (bool), lightPanels }
 * Returns {eave, ridge, prof, frames:[x...]}
 */
export function hall(ctx, o) {
  const b = ctx.b, s = ctx.spec;
  const { x0, x1, z0, z1 } = o;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const T = o.wallT ?? 0.3, y0 = o.y0;
  const prof = roofProfile(o);
  const eave = prof.eave;
  const wk = o.wallKey || 'panel_white';
  const full = ctx.full;
  const roof = o.roof || { kind: 'flat' };
  const parapet = roof.kind === 'flat' ? (roof.parapet ?? 1.0) : 0;
  // ---------------- walls ----------------
  for (const side of SIDES) {
    const sd = (o.sides && o.sides[side]) || {};
    if (sd.skip) continue;
    const L = isFB(side) ? W : D;
    b.push(); b.translate(cx, 0, cz); K.facadeFrame(b, side, W, D, 0);
    const ops = (sd.openings || []).filter((p) => p.u1 > p.u0 + 0.1);
    const yTop = eave + parapet;
    const fb = isFB(side);
    const uS = fb ? 0 : T, uE = fb ? L : L - T;
    if (o.wallTint) b.pushTint(o.wallTint);
    K.wallWithOpenings(b, {
      // inner face stops at the roof slab where a parapet stands above it: kit parapets() draws the parapet's own inner
      // face there (a plaster face up to the coping was coplanar with it and z-fought, QQ-02)
      L: uE - uS, u0: uS, y0: y0 - 0.02, y1: yTop, T, outer: sd.key || wk, inner: full ? (o.innerKey || 'plaster') : null, innerReveals: full, innerY1: parapet > 0 ? eave : yTop,
      openings: ops.map((p) => ({ u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, reveal: p.kind === 'roller' ? 0.12 : p.kind === 'curtain' ? 0.1 : 0.18, chamfer: 0.02, noSillReveal: p.kind === 'roller' || p.kind === 'door' || p.kind === 'curtain' || p.kind === 'shop' })),
      capStart: fb, capEnd: fb, capTop: roof.kind === 'none',
    });
    // gable infill above the eave on the gable-end sides (vault / gable roofs, axis x → left/right sides)
    if (!fb && (roof.kind === 'vault' || roof.kind === 'gable')) {
      gableInfill(b, ctx, L, eave, (u) => prof.y(side === 'right' ? z1 - u : z0 + u) - eave, T, sd.gable || 'solid', sd.key || wk, o);
    }
    if (o.wallTint) b.popTint();
    for (const p of ops) hallUnit(ctx, p, T);
    b.pop();
  }
  // ---------------- roof ----------------
  const ov = roof.overhang ?? 0.6;
  const rk = roof.key || 'roof_metal', sk = roof.soffitKey || 'steel';
  if (roof.kind === 'flat') {
    K.parapets(b, { x0, x1, z0, z1 }, eave, parapet, T, { innerKey: 'render_white', copingKey: 'aluminium', sides: roof.parapetSides });
    const inner = { x0: x0 + T, x1: x1 - T, z0: z0 + T, z1: z1 - T };
    K.roofDeck(b, inner, eave, { key: roof.surface || 'roof_membrane', mode: 'ridge' });
    if (full) b.rectY(sk, inner.x0, inner.z0, inner.x1, inner.z1, eave - 0.35, -1);
    if (roof.lights) {
      const n = Math.max(1, Math.round(W / 9));
      for (let i = 0; i < n; i++) {
        const xx = x0 + (W * (i + 0.5)) / n;
        const r = { x0: xx - 1.2, x1: xx + 1.2, z0: z0 + D * 0.2, z1: z1 - D * 0.2 };
        if (r.z1 - r.z0 > 2) K.skylight(b, r, eave + 0.1, { glassKey: 'glass_frosted' });
      }
    }
  } else if (roof.kind === 'vault' || roof.kind === 'gable') {
    if (roof.tint) b.pushTint(roof.tint);
    vaultRoof(b, { x0: x0 - ov, x1: x1 + ov, z0: z0 - ov * 0.6, z1: z1 + ov * 0.6, prof, key: rk, soffitKey: sk, lights: roof.lights, segs: roof.kind === 'gable' ? 2 : 28, crownW: roof.crownW });
    if (roof.tint) b.popTint();
    // eaves gutters along front / back
    for (const zz of [z0 - ov * 0.6, z1 + ov * 0.6]) {
      const sg = zz < cz ? -1 : 1;
      b.box('aluminium', x0 - ov, prof.y(zz) - 0.18, zz - (sg < 0 ? 0.18 : 0), x1 + ov, prof.y(zz) - 0.02, zz + (sg > 0 ? 0.18 : 0), 63);
    }
  } else if (roof.kind === 'sawtooth') {
    sawtoothRoof(b, ctx, { x0, x1, z0, z1, eave, teeth: roof.teeth ?? Math.max(2, Math.round(D / 9)), rise: roof.rise ?? 3.2, key: rk, soffitKey: sk, glazeSide: roof.glazeSide || 'back', T });
  }
  // ---------------- portal frames + floor + interior ----------------
  const frames = [];
  const sp = o.frames ?? 0;
  if (sp > 0) {
    const n = Math.max(1, Math.round(W / sp));
    const fk = o.frameKey || 'steel_dark';
    for (let i = 0; i <= n; i++) {
      const x = x0 + T + 0.25 + ((W - 2 * T - 0.5) * i) / n;
      frames.push(x);
      if (!full && i > 0 && i < n && !o.framesAlways) continue;
      for (const zz of [z0 + T + 0.2, z1 - T - 0.2]) b.box(fk, x - 0.15, y0, zz - 0.22, x + 0.15, prof.y(zz) - 0.3, zz + 0.22, 1 | 2 | 16 | 32);
      // rafter under the roof
      const pts = [];
      const m = roof.kind === 'vault' ? 16 : 2;
      for (let k = 0; k <= m; k++) { const zz = z0 + T + 0.2 + ((D - 2 * T - 0.4) * k) / m; pts.push([x, (roof.kind === 'flat' ? eave - 0.45 : prof.y(zz) - 0.38), zz]); }
      if (roof.kind !== 'sawtooth') b.sweep(fk, pts, [[-0.12, -0.32], [0.12, -0.32], [0.12, 0.0], [-0.12, 0.0]], { smoothAngle: 30 });
    }
  }
  if (full) {
    const fk = o.floorKey || 'concrete_smooth';
    if (!o.noFloor) b.rectY(fk, x0 + T, z0 + T, x1 - T, z1 - T, y0, 1);
    if (b.collecting) {
      if (!o.noFloor) b.colQuad(x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0);
      // wall colliders with door gaps
      for (const side of SIDES) {
        const sd = (o.sides && o.sides[side]) || {};
        if (sd.skip) continue;
        const L = isFB(side) ? W : D;
        // walkable openings (doors at any level, e.g. a mezzanine door onto a platform deck): the wall collider is
        // split into horizontal bands at the openings' sill / head heights, each band gapped where an opening spans it
        const walk = (sd.openings || []).filter((p) => p.kind === 'door' || p.kind === 'roller' || (p.kind === 'shop' && p.door) || p.kind === 'opening').map((p) => ({ u0: p.u0, u1: p.u1, v0: p.v0 < y0 + 0.4 ? y0 : p.v0, v1: p.v1 }));
        const cuts = [y0, eave];
        for (const p of walk) { if (p.v0 > y0 && p.v0 < eave) cuts.push(p.v0); if (p.v1 > y0 && p.v1 < eave) cuts.push(p.v1); }
        cuts.sort((a, c) => a - c);
        b.push(); b.translate(cx, 0, cz); K.facadeFrame(b, side, W, D, 0);
        for (let k = 0; k < cuts.length - 1; k++) {
          const ya = cuts[k], yb = cuts[k + 1];
          if (yb - ya < 0.02) continue;
          const gaps = walk.filter((p) => p.v0 <= ya + 1e-3 && p.v1 >= yb - 1e-3).map((p) => [p.u0, p.u1]).sort((a, c) => a[0] - c[0]);
          let u = 0;
          for (const g of gaps) { if (g[0] > u) b.colBox(u, ya, -T, g[0], yb, 0); u = Math.max(u, g[1]); }
          if (L > u) b.colBox(u, ya, -T, L, yb, 0);
        }
        b.pop();
      }
    }
    if (o.lightPanels !== false) {
      // high-bay lights (occupancy-gated panels) on the frames
      b.setExtra('iwin1', 0, 0.5, 0, 2000 + (s.hash % 97));
      b.setExtra('iwin2', (s.hash >>> 16) & 0xffff, s.hash & 0xffff, kindCode('hall'), s._profile | 0);
      const nx = Math.max(1, Math.round(W / 7)), nz = Math.max(1, Math.round(D / 8));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const xx = x0 + (W * (i + 0.5)) / nx, zz = z0 + (D * (j + 0.5)) / nz;
        const yy = (roof.kind === 'flat' ? eave - 0.6 : prof.y(zz) - 0.9);
        b.box('light_panel', xx - 0.45, yy - 0.06, zz - 0.18, xx + 0.45, yy, zz + 0.18, 63);
      }
      b.clearExtra('iwin1'); b.clearExtra('iwin2');
    }
  }
  return { eave, ridge: prof.ridge, prof, frames };
}

function gableInfill(b, ctx, L, eave, hAt, T, kind, key, o) {
  const n = 24;
  const gk = ctx.full ? 'glass_clear' : 'glass_shop';
  for (let i = 0; i < n; i++) {
    const ua = (L * i) / n, ub = (L * (i + 1)) / n;
    const ha = hAt(ua), hb = hAt(ub);
    if (ha < 0.02 && hb < 0.02) continue;
    if (kind === 'glass') {
      // glazed fan with a mullion every other strip
      K.setGlassRoom(ctx.b, { u0: ua, w: L, d: 10, h: 8, sill: 0.1, kind: kindCode('hall'), seed: 0.3, floor: 0, bay: 0, hash: ctx.spec.hash, profile: ctx.spec._profile | 0 }, 0, 0);
      b.quad(gk, ua, eave, -0.12, ub, eave, -0.12, ub, eave + hb, -0.12, ua, eave + ha, -0.12, [0, 0, ub - ua, 0, ub - ua, hb, 0, ha]);
      K.clearGlassRoom(b);
      if (i % 2 === 0) b.box('aluminium', ua - 0.04, eave, -0.16, ua + 0.04, eave + ha, 0.0, 1 | 2 | 16);
    } else {
      b.quad(key, ua, eave, 0, ub, eave, 0, ub, eave + hb, 0, ua, eave + ha, 0);
      if (ctx.full) b.quad(o.innerKey || 'plaster', ub, eave, -T, ua, eave, -T, ua, eave + ha, -T, ub, eave + hb, -T);
    }
  }
  if (kind === 'glass') b.box('aluminium', 0, eave - 0.06, -0.18, L, eave + 0.06, 0.02, 63);
  // top edge cap (under the roof overhang)
  void o;
}

/** Curved / gable roof shell: outer skin + soffit + end fascias; crown roof-light strip optional. */
function vaultRoof(b, o) {
  const { x0, x1, z0, z1, prof } = o;
  const segs = o.segs ?? 24;
  const zs = [];
  for (let i = 0; i <= segs; i++) zs.push(z0 + ((z1 - z0) * i) / segs);
  const t = 0.22;
  const nrm = (z) => { const e = 0.01; const dy = (prof.y(z + e) - prof.y(z - e)) / (2 * e); const l = Math.hypot(dy, 1); return [-dy / l, 1 / l]; }; // (nz, ny)
  const crownW = o.crownW ?? (z1 - z0) * 0.18, zm = (z0 + z1) / 2;
  const p = b.part(o.key), ps = b.part(o.soffitKey);
  for (let i = 0; i < segs; i++) {
    const za = zs[i], zb = zs[i + 1];
    const crown = o.lights === 'crown' && Math.abs((za + zb) / 2 - zm) < crownW / 2;
    const key = crown ? 'glass_frosted' : o.key;
    const [nza, nya] = nrm(za), [nzb, nyb] = nrm(zb);
    const ya = prof.y(za), yb = prof.y(zb);
    if (crown) {
      K.clearGlassRoom(b);
      b.quad('glass_frosted', x0, ya, za, x0, yb, zb, x1, yb, zb, x1, ya, za);
      for (let x = x0 + 1.5; x < x1; x += 3.0) b.box('aluminium', x - 0.04, Math.min(ya, yb) - 0.02, za, x + 0.04, Math.max(ya, yb) + 0.08, zb, 63);
    } else {
      const pp = b.part(key);
      const a = b.vert(pp, x0, ya, za, 0, nya, nza, 0, 0), c = b.vert(pp, x0, yb, zb, 0, nyb, nzb, 0, 0), dd = b.vert(pp, x1, yb, zb, 0, nyb, nzb, 0, 0), e = b.vert(pp, x1, ya, za, 0, nya, nza, 0, 0);
      b.q(pp, a, c, dd, e);
    }
    // soffit (inner face) below by t
    const a2 = b.vert(ps, x1, ya - t, za, 0, -nya, -nza, 0, 0), c2 = b.vert(ps, x1, yb - t, zb, 0, -nyb, -nzb, 0, 0), d2 = b.vert(ps, x0, yb - t, zb, 0, -nyb, -nzb, 0, 0), e2 = b.vert(ps, x0, ya - t, za, 0, -nya, -nza, 0, 0);
    b.q(ps, a2, c2, d2, e2);
    // end fascias (x0 / x1)
    b.quad(o.key, x0, ya - t, za, x0, yb - t, zb, x0, yb, zb, x0, ya, za);
    b.quad(o.key, x1, yb - t, zb, x1, ya - t, za, x1, ya, za, x1, yb, zb);
  }
  // eave edges
  b.quad(o.key, x1, prof.y(z0) - t, z0, x0, prof.y(z0) - t, z0, x0, prof.y(z0), z0, x1, prof.y(z0), z0);
  b.quad(o.key, x0, prof.y(z1) - t, z1, x1, prof.y(z1) - t, z1, x1, prof.y(z1), z1, x0, prof.y(z1), z1);
  void p;
}

/** North-light sawtooth roof: teeth along z, solid slope + glazed steep face; gable triangles at the ends. */
function sawtoothRoof(b, ctx, o) {
  const { x0, x1, z0, z1, eave, teeth, rise } = o;
  const D = z1 - z0, tz = D / teeth;
  const back = o.glazeSide !== 'front';
  const gk = 'glass_frosted';
  for (let i = 0; i < teeth; i++) {
    const za = z0 + i * tz, zb = za + tz;
    // glazed face at the low-z end of each tooth when glazing faces back (−z)
    const zg = back ? za : zb, zs = back ? zb : za;          // zg = glazed (high) side, zs = low side of the slope
    const yHi = eave + rise, yLo = eave;
    const zgi = zg + (back ? 0.6 : -0.6);
    // solid slope from (zs, yLo) up to (zgi, yHi)
    if (back) b.quad(o.key, x1, yHi, zgi, x0, yHi, zgi, x0, yLo, zs, x1, yLo, zs);
    else b.quad(o.key, x0, yHi, zgi, x1, yHi, zgi, x1, yLo, zs, x0, yLo, zs);
    // soffit
    if (back) b.quad(o.soffitKey, x0, yHi - 0.2, zgi, x1, yHi - 0.2, zgi, x1, yLo - 0.2, zs, x0, yLo - 0.2, zs);
    else b.quad(o.soffitKey, x1, yHi - 0.2, zgi, x0, yHi - 0.2, zgi, x0, yLo - 0.2, zs, x1, yLo - 0.2, zs);
    // glazed steep face (slightly raked) from the eave up to the ridge, facing the glazed side
    K.clearGlassRoom(b);
    if (back) b.quad(gk, x1, yLo, zg, x0, yLo, zg, x0, yHi, zgi, x1, yHi, zgi);
    else b.quad(gk, x0, yLo, zg, x1, yLo, zg, x1, yHi, zgi, x0, yHi, zgi);
    // glazing bars
    for (let x = x0 + 1.2; x < x1 - 0.5; x += 2.4) b.box('aluminium', x - 0.035, yLo, Math.min(zg, zgi) - 0.03, x + 0.035, yHi, Math.max(zg, zgi) + 0.03, 1 | 2 | 4);
    // ridge cap + valley gutter
    b.cbox('aluminium', x0 - 0.1, yHi - 0.05, zgi - 0.15, x1 + 0.1, yHi + 0.08, zgi + 0.15, 0.01);
    b.box('aluminium_dark', x0 - 0.1, yLo - 0.12, zg - 0.25, x1 + 0.1, yLo + 0.02, zg + 0.25, 63);
    // gable triangles at the ends
    const gkey = ctx.style.wall === 'panel_insulated' ? 'panel_insulated' : 'panel_grey';
    for (const [xx, f] of [[x0, -1], [x1, 1]]) {
      // triangle (zs,yLo) (zgi,yHi) (zgi,yLo): x-normal sign = sign(zgi − zs) → flip to face outwards (f)
      const pos = (zgi - zs) * f > 0;
      if (pos) b.triangle(gkey, xx, yLo, zs, xx, yHi, zgi, xx, yLo, zgi);
      else b.triangle(gkey, xx, yLo, zgi, xx, yHi, zgi, xx, yLo, zs);
    }
  }
}

/** One hall opening unit (current wall frame). */
function hallUnit(ctx, p, T) {
  const b = ctx.b, s = ctx.spec;
  const gk = ctx.full ? 'glass_clear' : (p.kind === 'shop' || p.kind === 'curtain' ? 'glass_shop' : 'glass_window');
  const room = { u0: 0.5, w: Math.max(2, p.roomW ?? (p.u1 - p.u0 + 1)), d: p.depth ?? 8, h: Math.max(2.8, p.v1 - (p.floorY ?? p.v0) + 0.6), sill: p.v0 - (p.floorY ?? p.v0), kind: kindCode(p.room || (p.kind === 'shop' ? 'shop' : 'hall')), seed: (((s.hash >>> 7) + Math.round(p.u0 * 3)) % 997) / 997, floor: p.floor ?? 0, bay: p.bay ?? Math.floor(p.u0 / 3.6), hash: s.hash, profile: s._profile | 0 };
  switch (p.kind) {
    case 'roller': rollerDoor(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: 0.12, open: p.open ?? 0, key: p.doorKey }); break;
    case 'door': K.doorUnit(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: 0.16, kind: p.doorKind || 'service', glassKey: ctx.full ? 'glass_clear' : 'glass_shop', open: 0 }); break;
    case 'shop': {
      const door = K.shopfront(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: 0.12, glassKey: gk, frameKey: 'aluminium_dark', room, doorWidth: p.door ? p.door.width : undefined, doorAt: p.door ? p.door.u0 : undefined, inner: ctx.full });
      if (door) K.doorUnit(b, { u0: door[0], u1: door[1], v0: p.v0, v1: Math.min(p.v1 - 0.6, p.v0 + 2.4), R: 0.14, kind: door[1] - door[0] > 1.5 ? 'glazed_double' : 'glazed', glassKey: gk, room, open: 0 });
      break;
    }
    case 'curtain': {
      // p.bayRooms: the interior mapping models the tall hall glazing as bay-sized rooms per glazing row (5 panes
      // wide, lamp just above the row) instead of one huge box whose single lamp leaves the glass dark at night
      let rm = room;
      if (p.bayRooms) {
        const rows = p.rows || [p.v0, p.v1];
        const nP = Math.max(1, Math.round((p.u1 - p.u0) / (p.pane ?? 1.6))), pw = (p.u1 - p.u0) / nP;
        rm = (i, j) => { const g = Math.floor(i / 5), rh = (rows[j + 1] ?? p.v1) - rows[j]; return { ...room, u0: 0.3 - g * 5 * pw, w: 5 * pw + 0.6, d: Math.min(room.d, 12), h: Math.max(3.0, rh + 0.9), sill: 0.12 - (rows[j] - rows[0]), seed: (room.seed + g * 0.137 + j * 0.271) % 1 }; };
      }
      glassScreen(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, z: -0.1, pane: p.pane ?? 1.6, rows: p.rows, glassKey: gk, room: rm, frameKey: p.frameKey || 'aluminium', back: ctx.full });
      break;
    }
    case 'louvre': K.louvrePanel(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: 0.1, key: 'aluminium' }); break;
    case 'opening': break;
    case 'strip': K.windowUnit(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: 0.15, type: 'strip', frameKey: 'aluminium', glassKey: gk, sillKey: null, room, inner: ctx.full, T, cols: Math.max(1, Math.round((p.u1 - p.u0) / 1.5)) }); break;
    default: K.windowUnit(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: 0.18, type: p.type || 'casement', frameKey: 'aluminium', glassKey: gk, sillKey: 'aluminium', room, inner: ctx.full, T });
  }
}

/** Sectional roller door filling an opening (wall frame): panel rows, track guides, head box, windows row. */
export function rollerDoor(b, o) {
  const { u0, u1, v0, v1 } = o, R = o.R ?? 0.12, key = o.key || 'steel_door';
  const W = u1 - u0, H = v1 - v0;
  const open = clamp(o.open ?? 0, 0, 0.95);
  const vb = v0 + H * open;
  // guide tracks + head box
  for (const u of [u0 + 0.05, u1 - 0.05]) b.box('steel_dark', u - 0.05, v0, -R - 0.12, u + 0.05, v1, -R + 0.02, 63 & ~8);
  b.cbox('steel_dark', u0 - 0.05, v1 - 0.35, -R - 0.3, u1 + 0.05, v1 + 0.02, -R + 0.02, 0.01);
  // panels (horizontal sections with grooves)
  const n = Math.max(3, Math.round((v1 - 0.35 - vb) / 0.55));
  const ph = (v1 - 0.35 - vb) / n;
  for (let i = 0; i < n; i++) {
    const ya = vb + i * ph, yb = ya + ph - 0.015;
    const win = i === n - 2 && W > 2.5;
    if (win) {
      const m = Math.max(2, Math.round(W / 1.1));
      for (let k = 0; k < m; k++) {
        const a = u0 + 0.1 + ((W - 0.2) * k) / m, c = a + (W - 0.2) / m;
        b.box(key, a, ya, -R - 0.06, a + 0.12, yb, -R - 0.02, 63);
        b.box(key, c - 0.12, ya, -R - 0.06, c, yb, -R - 0.02, 63);
        K.clearGlassRoom(b);
        b.quad('glass_frosted', a + 0.12, ya + 0.08, -R - 0.04, c - 0.12, ya + 0.08, -R - 0.04, c - 0.12, yb - 0.08, -R - 0.04, a + 0.12, yb - 0.08, -R - 0.04);
      }
    } else b.box(key, u0 + 0.1, ya, -R - 0.06, u1 - 0.1, yb, -R - 0.02, 63);
  }
  // bottom rubber seal + handle
  if (open < 0.05) b.box('rubber', u0 + 0.1, v0, -R - 0.07, u1 - 0.1, v0 + 0.03, -R - 0.01, 63);
  b.box('steel_brushed', (u0 + u1) / 2 - 0.25, vb + 0.6, -R - 0.02, (u0 + u1) / 2 + 0.25, vb + 0.64, -R + 0.02, 63);
}

/**
 * Raised loading dock outside a door (wall frame): platform at FFL from the facade out to `depth`,
 * leveller plate, rubber bumpers, dock seal around the opening, yellow edge stripe, steps at one end.
 * o: {u0, u1 (door), ffl, gy (yard level), depth=3.2, ext (extra width each side)=1.2, seal=true, canopy}
 */
export function dockLeveller(b, o) {
  const { u0, u1, ffl, gy } = o, depth = o.depth ?? 3.2, ext = o.ext ?? 1.2;
  const a = u0 - ext, c = u1 + ext;
  b.cbox('concrete', a, Math.min(gy, ffl) - 0.5, -0.05, c, ffl - 0.004, depth, 0.02, false);
  if (b.collecting) b.colQuad(a, ffl, depth, c, ffl, depth, c, ffl, 0, a, ffl, 0);
  b.box('steel_yellow', a, ffl - 0.004, depth - 0.25, c, ffl + 0.003, depth - 0.02, 4 | 16);
  // leveller plate in front of the door
  b.cbox('steel', u0 + 0.2, ffl - 0.02, 0.2, u1 - 0.2, ffl + 0.015, depth - 0.02, 0.008);
  b.box('steel_yellow', u0 + 0.2, ffl - 0.3, depth - 0.02, u1 - 0.2, ffl + 0.0, depth + 0.02, 16 | 4);
  // bumpers on the dock face
  for (const u of [u0 + 0.25, u1 - 0.25]) b.cbox('rubber', u - 0.13, ffl - 0.45, depth, u + 0.13, ffl - 0.1, depth + 0.12, 0.015);
  // dock seal (black foam frame) around the opening on the facade
  if (o.seal !== false && o.v1) {
    b.box('rubber', u0 - 0.35, ffl, 0.0, u0, o.v1, 0.5, 63 & ~4);
    b.box('rubber', u1, ffl, 0.0, u1 + 0.35, o.v1, 0.5, 63 & ~4);
    b.box('rubber', u0 - 0.35, o.v1, 0.0, u1 + 0.35, o.v1 + 0.45, 0.5, 63);
  }
  // steps at the end of the dock
  if (ffl - gy > 0.2) K.steps(b, { u0: c - 1.2, u1: c, z0: depth, y0: gy, y1: ffl, key: 'concrete', cheeks: false, rails: true, railKey: 'steel_yellow' });
}

/**
 * Landing + steps + ramp + optional flat canopy outside a door (current wall frame of the hall side).
 * o: {u0, u1, ffl, g0, g1 (terrain at u=0 / u=L), L, main, canopy:boolean, canopyKey, ramp:boolean, landD}
 */
export function entranceSteps(ctx, o) {
  const b = ctx.b;
  const gy = o.g0 + ((o.g1 - o.g0) * ((o.u0 + o.u1) / 2)) / o.L;
  const landD = o.landD ?? (o.main ? 2.0 : 1.3);
  const lw = (o.u1 - o.u0) + (o.main ? 1.6 : 0.8);
  const lu0 = Math.max(0.1, (o.u0 + o.u1) / 2 - lw / 2), lu1 = Math.min(o.L - 0.1, (o.u0 + o.u1) / 2 + lw / 2);
  b.cbox('paving_stone', lu0, Math.min(gy, o.ffl) - 0.45, 0.0, lu1, o.ffl - 0.005, landD, 0.012, false);
  if (b.collecting) b.colQuad(lu0, o.ffl, landD, lu1, o.ffl, landD, lu1, o.ffl, 0, lu0, o.ffl, 0);
  const rise = o.ffl - gy;
  if (rise > 0.04) {
    K.steps(b, { u0: lu0, u1: lu1, z0: landD, y0: gy, y1: o.ffl, key: 'stone_step', cheeks: rise > 0.5, rails: rise > 0.45, railKey: 'steel' });
    if (o.ramp && rise > 0.06) {
      const dir = lu1 + rise * 12 + 1.2 < o.L - 0.2 ? 1 : -1;
      const uEnd = dir > 0 ? lu1 : lu0, uStart = uEnd + dir * rise * 12;
      if (uStart > 0.2 && uStart < o.L - 0.2) K.rampAlong(b, { uStart, uEnd, y0: gy, y1: o.ffl, z0: 0.02, z1: 1.45, key: 'paving_stone', railKey: 'steel' });
    }
  }
  if (o.canopy) {
    const cy = o.cy ?? o.ffl + 3.2;
    b.withTint(ctx.inst.bandTint, () => K.canopyFlat(b, { u0: o.u0 - (o.main ? 1.0 : 0.5), u1: o.u1 + (o.main ? 1.0 : 0.5), y: cy, depth: o.main ? landD + 0.6 : 1.3, key: o.canopyKey || ctx.style.band, rods: !o.main }));
  }
  const ll = o.u0 - 0.4;
  if (ll > 0.3) K.wallLight(b, ll, o.ffl + 2.2);
  return gy;
}

export { finLoft };
