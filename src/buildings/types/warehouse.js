// Warehouse (仓库), Zhurong family (owner: buildings-z). Exports shed(ctx, o) shared with port_shed.js.
//
// Long-span portal-frame shed: insulated metal cladding with a white ceramic eaves band, clear height
// = spec.floorHeight (8–12 m). Goods: the loading side (spec 'loading' entrances, meta.loadingSide —
// right, else back) has dock doors at the urban offsets: floor at dock height (1.2 m above the yard),
// sectional doors with dock seals, rubber bumpers, leveller lips, yellow guide lines on a concrete
// apron with truck bays, a continuous white canopy over the docks and steps + a personnel door at the
// end of the dock run. People: the street front has a two-storey office annex (strip windows, glazed
// entrance with steps + 1:12 ramp + canopy) in the corner nearest the main entrance. Roof: flat with
// roof-light strips, or north-light sawtooth (spec.roof 'sawtooth'); high clerestory strips on the
// other walls, escape doors. 'full': concrete floor, pallet racking aisles, office mezzanine + stair,
// high-bay lights, colliders (walls with door gaps, floor, racks, mezzanine).

import * as K from '../kit/index.js';
import { kindCode } from '../kit/plan.js';
import { clamp, cyanStrip, signTotem, bollardLine, zMass, specEntrances, lightBox } from './z_common.js';
import { hall, rollerDoor, entranceSteps, roofProfile } from './z_hall.js';

const SIDES = ['front', 'right', 'back', 'left'];
const isFB = (sd) => sd === 'front' || sd === 'back';

/** Wall-frame u of a spec entrance on its side (same convention as z_common.entranceU). */
function eU(s, e) {
  const w = s._w, d = s._d;
  switch (e.side) {
    case 'front': return w / 2 + e.offset;
    case 'back': return w / 2 + e.offset;
    case 'left': return d / 2 - e.offset;
    default: return d / 2 - e.offset;
  }
}

/**
 * Floor level + eave of a shed (same numbers for the near model and the far mass, QA-ID (2): the mass top and the
 * exterior roof agree on sloped lots). o: {dockSide, raised}
 */
export function shedLevels(ctx, o) {
  const s = ctx.spec;
  const eave = clamp(+s.floorHeight || s._fh || 10, 6.5, 16);
  const [gd0, gd1] = K.sideGround(s, o.dockSide);
  const gy = Math.min(gd0, gd1);
  const frontG = Math.max(s._ground.fl, s._ground.fr);
  const ffl = o.raised ? Math.max(gy + 1.2, frontG + 0.15) : Math.max(gy, frontG) + 0.15;
  return { ffl, eave, gy };
}
/** Warehouse dock side + roof kind (variation by hash when the spec leaves the roof flat: flat / duo-pitch / sawtooth). */
export function warehouseKind(s) {
  const want = s._meta.loadingSide || 'right';
  const dockSide = !s._shared[want] ? want : !s._shared.back ? 'back' : 'front';
  let roof = s.roof === 'sawtooth' ? 'sawtooth' : 'flat';
  if (s.roof !== 'sawtooth' && s.roof !== 'vault') { const r = ((s.hash >>> 11) % 100); roof = r < 42 ? 'flat' : r < 78 ? 'gable' : 'sawtooth'; }
  return { dockSide, roof };
}
// cladding families (warehouses neutral; port sheds carry the port-blue base band)
const CLAD = [
  { key: 'panel_insulated', band: [0.42, 0.5, 0.56] },     // white-grey panels, slate band
  { key: 'panel_grey', band: [0.86, 0.85, 0.82] },         // mid-grey panels, white band
  { key: 'panel_white', band: [0.36, 0.52, 0.5] },         // white panels, teal-grey band
  { key: 'panel_insulated', band: [0.72, 0.62, 0.46] },    // white-grey panels, warm sand band
];

/**
 * Shared shed generator. o: {
 *   dockSide, raised (dock-height floor), doorW, doorH, roof:'flat'|'sawtooth'|'vault', officeSide ('front'),
 *   canopyDepth, apronDepth, port (port shed details), wallKey }
 * Returns layout info.
 */
export function shed(ctx, o) {
  const s = ctx.spec, b = ctx.b, st = ctx.style, inst = ctx.inst;
  const w = s._w, d = s._d;
  const full = ctx.full;
  const dockSide = o.dockSide;
  const { ffl, eave, gy } = shedLevels(ctx, o);       // gy: yard level at the docks
  const Ld = isFB(dockSide) ? w : d;
  // ---- office annex on the front (people entrance) ----
  const mainE = specEntrances(ctx, 'main').find((e) => e.side === 'front' || e.side === o.officeSide) || { side: 'front', u: w * 0.2 };
  const offSide = mainE.side;
  const Lo = isFB(offSide) ? w : d;
  const offW = clamp(Lo * 0.28, 9, 18);
  const offU0 = mainE.u < Lo / 2 ? 0.0 : Lo - offW, offU1 = offU0 + offW;
  const doorU = clamp(mainE.u, offU0 + 1.6, offU1 - 1.6);
  // ---- loading doors from the spec (fallback: evenly spaced), clear of the office annex ----
  const dw = o.doorW ?? 3.4, dh = o.doorH ?? 4.2;
  const clearOf = (side, us) => (side === offSide ? us.filter((u) => u + dw / 2 + 1.2 < offU0 || u - dw / 2 - 1.2 > offU1) : us);
  const runDoors = (side) => {
    const Lr = isFB(side) ? w : d;
    let us = specEntrances(ctx, 'loading').filter((e) => e.side === side).map((e) => e.u);
    if (!us.length) { const n = Math.max(1, Math.floor(Lr / 14)); for (let k = 0; k < n; k++) us.push((Lr * (k + 0.5)) / n); }
    us = us.map((u) => clamp(u, dw / 2 + 1.2, Lr - dw / 2 - 1.2));
    return clearOf(side, us);
  };
  let docks = runDoors(dockSide);
  if (!docks.length) docks = [offU0 < Ld / 2 ? Ld - dw / 2 - 3 : dw / 2 + 3];
  const bd = o.backDocks && !s._shared[o.backDocks.side] && o.backDocks.side !== dockSide ? o.backDocks : null;
  const docks2 = bd ? (() => { const L2 = isFB(bd.side) ? w : d; const n = bd.n ?? Math.max(1, Math.floor(L2 / 18)); const us = []; for (let k = 0; k < n; k++) us.push((L2 * (k + 0.5)) / n); return clearOf(bd.side, us.map((u) => clamp(u, 3.4 / 2 + 1.2, L2 - 3.4 / 2 - 1.2))); })() : [];
  const oh = 3.6;                                          // office storey
  const sides = {};
  for (const side of SIDES) {
    const L = isFB(side) ? w : d;
    const ops = [];
    if (s._shared[side]) { sides[side] = { openings: [], key: o.wallKey }; continue; }
    if (side === dockSide) {
      for (const u of docks) ops.push({ u0: u - dw / 2, u1: u + dw / 2, v0: ffl, v1: ffl + dh, kind: 'roller', open: 0 });
      // personnel door at the end of the dock run (never inside the office annex)
      const inOff = (u) => side === offSide && u + 0.8 > offU0 && u - 0.8 < offU1;
      let pu = docks[docks.length - 1] + dw / 2 + 2.2;
      if (inOff(pu) || pu + 0.8 > L - 0.6) pu = docks[0] - dw / 2 - 2.2;
      if (pu - 0.8 > 0.6 && pu + 0.8 < L - 0.6 && !inOff(pu)) { ops.push({ u0: pu - 0.55, u1: pu + 0.55, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'service' }); o._pu = pu; } else o._pu = null;
    }
    if (bd && side === bd.side) for (const u of docks2) ops.push({ u0: u - 1.7, u1: u + 1.7, v0: ffl, v1: ffl + 4.2, kind: 'roller', open: 0 });
    if (side === offSide) {
      ops.push({ u0: doorU - 1.0, u1: doorU + 1.0, v0: ffl, v1: ffl + 2.5, kind: 'door', doorKind: 'glazed_double' });
      // office windows on two storeys
      const n = Math.max(1, Math.round(offW / 3.2));
      for (let lv = 0; lv < 2; lv++) for (let i = 0; i < n; i++) {
        const c = offU0 + (offW * (i + 0.5)) / n;
        if (lv === 0 && Math.abs(c - doorU) < 2.0) continue;
        ops.push({ u0: c - 1.15, u1: c + 1.15, v0: ffl + lv * oh + 0.95, v1: ffl + lv * oh + 2.75, kind: 'window', type: 'casement', room: 'office', floorY: ffl + lv * oh, floor: lv, depth: 6 });
      }
    }
    // high clerestory strips on the long walls (outside the office and the dock door heads)
    if (eave > 6) {
      const n = Math.max(1, Math.floor(L / 7.5));
      for (let i = 0; i < n; i++) {
        const c = (L * (i + 0.5)) / n;
        if (side === offSide && c > offU0 - 1.5 && c < offU1 + 1.5) continue;
        const v0 = ffl + Math.max(dh + 1.4, eave - 2.4), v1 = ffl + eave - 0.6;
        if (v1 - v0 < 0.6) continue;
        ops.push({ u0: c - 2.2, u1: c + 2.2, v0, v1, kind: 'strip', room: 'hall', floorY: ffl, depth: d * 0.5 });
      }
    }
    // escape door on the side opposite the docks
    if (side !== dockSide && side !== offSide && !(bd && side === bd.side) && L > 20) ops.push({ u0: L * 0.5 - 0.55, u1: L * 0.5 + 0.55, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'service' });
    sides[side] = { openings: ops, key: o.wallKey, gable: o.gable };
  }
  const roofKind = o.roof || 'flat';
  const H = hall(ctx, {
    x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y0: ffl, eave, wallKey: o.wallKey || 'panel_insulated', wallT: 0.3,
    sides, roof: { kind: roofKind, rise: roofKind === 'vault' ? Math.min(d * 0.14, 7) : roofKind === 'sawtooth' ? 3.0 : roofKind === 'gable' ? gableRise(d) : 0, key: 'roof_metal', tint: [1.32, 1.34, 1.36], soffitKey: 'steel', overhang: roofKind === 'gable' ? 0.9 : 0.6, lights: roofKind === 'vault' ? 'crown' : true, parapet: 1.0, teeth: Math.max(2, Math.round(d / 10)), glazeSide: s._lat >= 0 ? 'back' : 'front' },
    frames: 7.5, frameKey: 'steel_dark', floorKey: 'concrete_smooth', interior: true, lightPanels: true,
  });
  // white ceramic eaves band (ZR identity) + base plinth
  if (roofKind !== 'vault') {
    b.withTint(inst.bandTint, () => {
      for (const side of SIDES) {
        if (s._shared[side]) continue;
        if (roofKind === 'gable' && !isFB(side)) continue;          // gable ends: the raking verge carries the line
        b.push(); K.facadeFrame(b, side, w, d, 0);
        const L = isFB(side) ? w : d;
        b.cbox('ceramic_band', -0.15, ffl + eave - 0.2, -0.02, L + 0.15, ffl + eave + 1.05, 0.22, 0.04);
        b.pop();
      }
    });
  }
  b.withTint([0.92, 0.92, 0.9], () => K.plinth(b, s, ffl, { key: 'concrete', skip: s._shared }));
  // coloured base band (cladding family): 2.4 m painted panel strip, 4 cm proud of the cladding, broken at the openings
  if (o.band) {
    for (const side of SIDES) {
      if (s._shared[side]) continue;
      const L = isFB(side) ? w : d;
      const ops = (sides[side].openings || []).filter((p) => p.v0 < ffl + 2.5).map((p) => [p.u0 - 0.15, p.u1 + 0.15]).sort((a, c) => a[0] - c[0]);
      b.push(); K.facadeFrame(b, side, w, d, 0);
      let u = 0.05;
      const strip = (a, c) => { if (c - a > 0.3) b.withTint(o.band, () => b.box('panel_white', a, ffl - 0.02, 0.0, c, ffl + 2.4, 0.04, 1 | 2 | 4 | 16)); };
      for (const [a, c] of ops) { strip(u, Math.min(a, L - 0.05)); u = Math.max(u, c); }
      strip(u, L - 0.05);
      b.pop();
    }
  }
  // ---- docks: apron + bay lines, seals, bumpers, leveller lips, dock face, canopy, steps ----
  const dockRun = (side, us, raised, DW, DH, apD, cd, pu) => {
    const Lr = isFB(side) ? w : d;
    const [g0, g1] = K.sideGround(s, side);
    const gyr = Math.min(g0, g1);
    const rz = raised && ffl - gyr > 0.5;
    b.push(); K.facadeFrame(b, side, w, d, 0);
    b.box('concrete', -0.5, gyr - 0.35, 0.0, Lr + 0.5, gyr + 0.02, apD, 4 | 16 | 1 | 2);
    if (b.collecting) b.colQuad(-0.5, gyr + 0.02, apD, Lr + 0.5, gyr + 0.02, apD, Lr + 0.5, gyr + 0.02, 0, -0.5, gyr + 0.02, 0);
    for (const u of us) {
      if (rz) {
        b.box('rubber', u - DW / 2 - 0.35, ffl - 0.05, 0.0, u - DW / 2, ffl + DH, 0.45, 63 & ~4);
        b.box('rubber', u + DW / 2, ffl - 0.05, 0.0, u + DW / 2 + 0.35, ffl + DH, 0.45, 63 & ~4);
        b.box('rubber', u - DW / 2 - 0.35, ffl + DH, 0.0, u + DW / 2 + 0.35, ffl + DH + 0.5, 0.45, 63);
        for (const uu of [u - DW / 2 + 0.25, u + DW / 2 - 0.25]) b.cbox('rubber', uu - 0.14, ffl - 0.5, 0.0, uu + 0.14, ffl - 0.12, 0.13, 0.015);
        b.cbox('steel', u - DW / 2 + 0.2, ffl - 0.03, -0.25, u + DW / 2 - 0.2, ffl + 0.01, 0.22, 0.006);
        b.box('steel_yellow', u - DW / 2 + 0.2, ffl - 0.25, 0.2, u + DW / 2 - 0.2, ffl - 0.03, 0.24, 16 | 4);
        for (const uu of [u - 1.7, u + 1.7]) b.box('steel_yellow', uu - 0.06, gyr + 0.02, 1.0, uu + 0.06, gyr + 0.025, apD - 1, 4);
        for (const uu of [u - 1.45, u + 1.45]) b.cbox('steel_yellow', uu - 0.08, gyr + 0.02, 0.6, uu + 0.08, gyr + 0.32, 6.5, 0.02, false);
      } else {
        b.box('steel', u - DW / 2, ffl - 0.05, 0.0, u + DW / 2, ffl + 0.005, 0.3, 4 | 16);
        for (const uu of [u - DW / 2 - 0.35, u + DW / 2 + 0.35]) b.cylinder('steel_yellow', uu, gyr, 0.35, 0.12, 1.2, 10, { top: true });
      }
    }
    if (us.length) {
      const c0 = Math.max(0.2, Math.min(...us) - DW / 2 - 1.6), c1 = Math.min(Lr - 0.2, Math.max(...us) + DW / 2 + 1.6);
      const cy = ffl + DH + 1.0;
      b.withTint(inst.bandTint, () => K.canopyFlat(b, { u0: c0, u1: c1, y: cy, depth: cd, t: 0.35, key: 'ceramic_band', rods: true }));
      cyanStrip(b, c0 + 0.5, cd + 0.02, c1 - 0.5, cd + 0.02, cy - 0.17, { t: 0.025 });
    }
    if (rz && pu && ffl - gyr > 0.2) {
      b.cbox('concrete', pu - 1.0, gyr - 0.3, 0.0, pu + 1.0, ffl - 0.005, 1.4, 0.02, false);
      if (b.collecting) b.colQuad(pu - 1.0, ffl, 1.4, pu + 1.0, ffl, 1.4, pu + 1.0, ffl, 0, pu - 1.0, ffl, 0);
      K.steps(b, { u0: pu - 1.0, u1: pu + 1.0, z0: 1.4, y0: gyr, y1: ffl, key: 'concrete', cheeks: true, rails: true, railKey: 'steel_yellow' });
    }
    b.pop();
  };
  const apD = o.apronDepth ?? (o.raised ? 18 : 6);
  dockRun(dockSide, docks, !!o.raised, dw, dh, apD, o.canopyDepth ?? (o.raised ? 4.5 : 6.0), o._pu);
  if (bd) dockRun(bd.side, docks2, bd.raised !== false, 3.4, 4.2, bd.apron ?? 16, 4.5, null);
  // ---- office entrance: steps + ramp + canopy, sign totem ----
  b.push(); K.facadeFrame(b, offSide, w, d, 0);
  const [go0, go1] = K.sideGround(s, offSide);
  entranceSteps(ctx, { u0: doorU - 1.0, u1: doorU + 1.0, ffl, g0: go0, g1: go1, L: Lo, main: true, canopy: true, ramp: true, cy: ffl + 3.1, canopyKey: 'ceramic_band' });
  lightBox(b, (offU0 + offU1) / 2, ffl + 2 * oh + 0.4, Math.min(offW - 2, 7), 1.0, 0.16, { depth: 0.13, rows: 2, seed: s.hash });
  b.pop();
  // ---- interior ('full'): office mezzanine, racks ----
  if (full) shedInterior(ctx, { w, d, ffl, eave, offSide, offU0, offU1, oh, dockSide, docks, dw, port: o.port });
  // ---- anchors ----
  const A = b.anchors;
  // one storey (spec floors = 1, clear height = eave); the office annex's upper floor is a mezzanine inside it
  A.floors = [{ level: 0, y: ffl, height: eave }];
  A.mezzanines = [{ y: ffl + oh, height: oh, name: 'office mezzanine' }];
  A.roof = { y: ffl + eave, access: [w / 2 - 2, ffl + eave, -d / 2 + 2] };
  A.entrances = [{ kind: 'main', side: offSide, pos: K.facadePoint(offSide, w, d, doorU, ffl, 0.8), dir: K.facadeNormal(offSide), width: 2 }];
  for (const u of docks) A.entrances.push({ kind: 'loading', side: dockSide, pos: K.facadePoint(dockSide, w, d, u, ffl, 0.6), dir: K.facadeNormal(dockSide), width: dw });
  if (bd) for (const u of docks2) A.entrances.push({ kind: 'loading', side: bd.side, pos: K.facadePoint(bd.side, w, d, u, ffl, 0.6), dir: K.facadeNormal(bd.side), width: 3.4 });
  const pIn = K.facadePoint(offSide, w, d, doorU, ffl + 1.65, -3.0), pDock = K.facadePoint(dockSide, w, d, docks[0], ffl + 1.65, -4);
  A.rooms = [{ floor: 0, name: 'hall', kind: 'hall', center: [0, ffl, 0], size: [w, eave, d] }];
  { const c = K.facadePoint(offSide, w, d, (offU0 + offU1) / 2, ffl + oh, -3.4); A.rooms.push({ floor: 0, name: 'office mezzanine', kind: 'office', center: c, size: [offW, oh, 6.5] }); }
  const pStreet = K.facadePoint(offSide, w, d, doorU - 4, frontOr(go0, go1) + 1.65, 24);
  A.cameras = {
    street: { pos: pStreet, target: K.facadePoint(offSide, w, d, Lo / 2, ffl + eave * 0.4, 0) },
    entrance: { pos: K.facadePoint(offSide, w, d, doorU + 2, ffl + 1.65, 7), target: K.facadePoint(offSide, w, d, doorU, ffl + 1.5, -2) },
    interior: { pos: pIn, target: [0, ffl + 2.5, 0] },
    lobby: { pos: pIn, target: [0, ffl + 2.5, 0] },
    back: { pos: K.facadePoint(dockSide, w, d, Ld * 0.3, gy + 1.65, apD + 10), target: K.facadePoint(dockSide, w, d, Ld * 0.5, ffl + 2.5, 0) },
    loading: { pos: pDock, target: K.facadePoint(dockSide, w, d, docks[0], ffl + 1.5, 3) },
    roof: { pos: [-w * 0.3, ffl + eave + 18, d * 0.8], target: [0, ffl + eave, 0] },
  };
  return { ffl, eave, docks, H, doorW: dw };
}
function frontOr(a, c) { return Math.min(a, c); }

function shedInterior(ctx, o) {
  const b = ctx.b, s = ctx.spec;
  const { w, d, ffl, eave, offSide, offU0, offU1, oh, dockSide } = o;
  // office annex box inside the hall corner: mezzanine floor + partition walls + stair
  const fp = (u, z) => K.facadePoint(offSide, w, d, u, 0, z);
  const p0 = fp(offU0 + 0.3, -0.3), p1 = fp(offU1 - 0.3, -6.5);
  const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]), z0 = Math.min(p0[2], p1[2]), z1 = Math.max(p0[2], p1[2]);
  b.cbox('concrete_smooth', x0, ffl + oh - 0.3, z0, x1, ffl + oh - 0.015, z1, 0.02, true);   // slab top under the timber floor (was 2 mm: z-fight)
  b.rectY('wood_floor', x0, z0, x1, z1, ffl + oh, 1);
  if (b.collecting) b.colQuad(x0, ffl + oh, z1, x1, ffl + oh, z1, x1, ffl + oh, z0, x0, ffl + oh, z0);
  // straight stair up to the mezzanine, parallel to its hall-side edge and 0.7 m out in the hall; it arrives on a
  // landing at mezzanine level that joins the edge, where the glass balustrade leaves a gap (the mezzanine was not
  // reachable before: the balustrade closed the whole edge and side offices put the stair under the slab)
  const { n } = K.risers(oh, 0.175);
  const run = n * 0.28;
  const alongX = offSide === 'front' || offSide === 'back';
  const yM = ffl + oh;
  let edge, hallSg, a0, a1;                      // edge coordinate, hall direction (±1), edge extent along it
  if (alongX) { edge = offSide === 'front' ? z0 : z1; hallSg = offSide === 'front' ? -1 : 1; a0 = x0; a1 = x1; }
  else { edge = offSide === 'right' ? x0 : x1; hallSg = offSide === 'right' ? -1 : 1; a0 = z0; a1 = z1; }
  const c = (a0 + a1) / 2, sA0 = clamp(c - run / 2 - 0.5, a0 + 0.3, a1 - run - 1.4), sA1 = sA0 + run;   // stair start / top along the edge
  const lnd0 = sA1 - 0.15, lnd1 = Math.min(a1 - 0.1, sA1 + 1.2);                                           // landing along the edge
  const sc = edge + hallSg * 0.7;                                                                           // stair centre line
  b.push();
  if (alongX) b.translate(sA0, ffl, sc); else { b.translate(sc, ffl, sA0); b.rotY(-Math.PI / 2); }
  for (let i = 0; i < n; i++) {
    const yy = ((i + 1) * oh) / n;
    b.cbox('steel_dark', i * 0.28, yy - 0.05, -0.55, (i + 1) * 0.28 + 0.02, yy, 0.55, 0.004, true);
  }
  b.sweep('steel_dark', [[0, 0, 0.6], [run, oh, 0.6]], [[-0.06, -0.15], [0.06, -0.15], [0.06, 0], [-0.06, 0]], {});
  b.sweep('steel_dark', [[0, 0, -0.6], [run, oh, -0.6]], [[-0.06, -0.15], [0.06, -0.15], [0.06, 0], [-0.06, 0]], {});
  K.handrail(b, [[0, 0.9, hallSg * (alongX ? 0.62 : -0.62)], [run, oh + 0.9, hallSg * (alongX ? 0.62 : -0.62)]], { posts: true, height: 0 });
  if (b.collecting) b.colQuad(0, 0, 0.55, run, oh, 0.55, run, oh, -0.55, 0, 0, -0.55);
  b.pop();
  // landing (steel plate on the stair line, from the top tread to the mezzanine edge) + its outer guard
  const l0 = Math.min(edge, sc + hallSg * 0.6), l1 = Math.max(edge, sc + hallSg * 0.6);
  if (alongX) {
    b.cbox('steel_dark', lnd0, yM - 0.12, l0, lnd1, yM, l1, 0.01, true);
    if (b.collecting) b.colQuad(lnd0, yM, l1, lnd1, yM, l1, lnd1, yM, l0, lnd0, yM, l0);
    K.railing(b, [[lnd1, sc + hallSg * 0.58], [lnd1, edge]], yM, { kind: 'bars', key: 'steel_yellow' });
    if (b.collecting) b.colBox(lnd1 - 0.05, yM, l0, lnd1 + 0.05, yM + 1.1, l1);
  } else {
    b.cbox('steel_dark', l0, yM - 0.12, lnd0, l1, yM, lnd1, 0.01, true);
    if (b.collecting) b.colQuad(l0, yM, lnd1, l1, yM, lnd1, l1, yM, lnd0, l0, yM, lnd0);
    K.railing(b, [[sc + hallSg * 0.58, lnd1], [edge, lnd1]], yM, { kind: 'bars', key: 'steel_yellow' });
    if (b.collecting) b.colBox(l0, yM, lnd1 - 0.05, l1, yM + 1.1, lnd1 + 0.05);
  }
  // glass balustrade along the hall-side edge, open at the landing
  for (const [p, q] of [[a0, lnd0], [lnd1, a1]]) {
    if (q - p < 0.3) continue;
    const pts = alongX ? [[p, edge], [q, edge]] : [[edge, p], [edge, q]];
    K.railing(b, pts, yM, { kind: 'glass', key: 'aluminium' });
    if (b.collecting) { if (alongX) b.colBox(p, yM, edge - 0.05, q, yM + 1.1, edge + 0.05); else b.colBox(edge - 0.05, yM, p, edge + 0.05, yM + 1.1, q); }
  }
  if (o.port) { portStacks(ctx, { w, d, ffl, x0, x1, z0, z1 }); return; }
  // pallet racking aisles parallel to the dock side, clear of the office and a 4 m dock zone
  const rackH = Math.min(eave - 1.6, 9);
  const dockN = K.facadeNormal(dockSide);
  const rackX = Math.abs(dockN[2]) > 0.5;                  // racks run along x when docks are front/back
  const len = rackX ? w : d, dep = rackX ? d : w;
  const nA = Math.max(1, Math.floor((dep - 14) / 3.8));
  const rng = ctx.sub(980);
  for (let i = 0; i < nA; i++) {
    const t = -dep / 2 + 7 + i * 3.8;                     // across
    for (let a = -len / 2 + 3; a < len / 2 - 3; a += 2.8) {
      const x = rackX ? a : t, z = rackX ? t : a;
      if (x > x0 - 2 && x < x1 + 2 && z > z0 - 2 && z < z1 + 2) continue;
      // one bay: uprights + beams + pallets
      b.push(); b.translate(x, ffl, z); if (!rackX) b.rotY(Math.PI / 2);
      for (const ux of [0, 2.7]) for (const uz of [-0.5, 0.5]) b.box('steel_yellow', ux - 0.05, 0, uz - 0.05, ux + 0.05, rackH, uz + 0.05, 1 | 2 | 16 | 32);
      for (let yy = 1.6; yy < rackH; yy += 1.8) {
        b.box('steel_dark', 0.05, yy - 0.08, -0.545, 2.65, yy, -0.455, 63);     // beams between the uprights, 5 mm inside their faces
        b.box('steel_dark', 0.05, yy - 0.08, 0.455, 2.65, yy, 0.545, 63);
        if (rng.next() < 0.8) b.withTint([0.95, 0.85, 0.65], () => b.box('wood', 0.15, yy, -0.45, 1.3, yy + 1.2, 0.45, 63 & ~8));
        if (rng.next() < 0.7) b.withTint([0.8, 0.82, 0.86], () => b.box('cabinet', 1.4, yy, -0.45, 2.55, yy + 1.1, 0.45, 63 & ~8));
      }
      if (b.collecting) b.colBox(0, 0, -0.55, 2.7, rackH, 0.55);
      b.pop();
    }
  }
  void s;
}

/**
 * ISO 20 ft container (6.06 × 2.44 × 2.59 m) centred at (x, z) on y, long axis x: trapezoidal corrugated side
 * walls (0.28 m pitch, 36 mm deep), corrugated roof, corner posts + top / bottom rails, door end (+x) with
 * two leaves, four locking bars and hinges, corrugated front end (−x). Tint = livery colour.
 */
function container20(b, x, y, z) {
  const L = 6.06, W = 2.44, H = 2.59, hx = L / 2, hz = W / 2;
  const k = 'steel_door', dep = 0.036, pitch = 0.28;
  const p = b.part(k);
  // corrugated long sides (±z): per pitch four vertical strips (flat out, slope in, flat in, slope out)
  for (const sg of [1, -1]) {
    const n = Math.floor((L - 0.3) / pitch);
    const x0 = x - hx + 0.15;
    const prof = [];
    for (let i = 0; i < n; i++) { const a = x0 + i * pitch; prof.push([a, 0], [a + pitch * 0.32, 0], [a + pitch * 0.42, -dep], [a + pitch * 0.9, -dep]); }
    prof.push([x0 + n * pitch, 0]);
    for (let i = 0; i < prof.length - 1; i++) {
      const [ua, da] = prof[i], [ub, db] = prof[i + 1];
      const za = z + sg * (hz + da), zb = z + sg * (hz + db);
      if (sg > 0) b.quad(k, ua, y + 0.15, za, ub, y + 0.15, zb, ub, y + H - 0.1, zb, ua, y + H - 0.1, za);
      else b.quad(k, ub, y + 0.15, zb, ua, y + 0.15, za, ua, y + H - 0.1, za, ub, y + H - 0.1, zb);
    }
  }
  // roof (shallow corrugation across) + floor underside closed by the bottom rails
  const nr = Math.floor((L - 0.3) / 0.45);
  for (let i = 0; i < nr; i++) {
    const a = x - hx + 0.15 + i * 0.45, c = a + 0.45, m = a + 0.225;
    b.quad(k, a, y + H - 0.02, z + hz, m, y + H, z + hz, m, y + H, z - hz, a, y + H - 0.02, z - hz);
    b.quad(k, m, y + H, z + hz, c, y + H - 0.02, z + hz, c, y + H - 0.02, z - hz, m, y + H, z - hz);
  }
  // corner posts, top + bottom rails
  for (const xx of [x - hx, x + hx - 0.15]) for (const zz of [z - hz, z + hz - 0.15]) b.box(k, xx, y, zz, xx + 0.15, y + H, zz + 0.15, 63);
  for (const zz of [z - hz, z + hz - 0.12]) { b.box(k, x - hx, y, zz, x + hx, y + 0.16, zz + 0.12, 63); b.box(k, x - hx, y + H - 0.12, zz, x + hx, y + H, zz + 0.12, 63); }
  // front end (−x): corrugated panel (vertical ribs)
  for (let i = 0; i < 7; i++) {
    const za = z - hz + 0.15 + i * 0.31;
    b.quad(k, x - hx - 0.02, y + 0.15, za + 0.31, x - hx - 0.02, y + 0.15, za, x - hx - 0.02, y + H - 0.1, za, x - hx - 0.02, y + H - 0.1, za + 0.31);
    b.box(k, x - hx - 0.05, y + 0.15, za + 0.12, x - hx - 0.02, y + H - 0.1, za + 0.19, 63 & ~2);
  }
  // door end (+x): two leaves, four locking bars with handles, hinges
  b.box(k, x + hx - 0.02, y + 0.15, z - hz + 0.15, x + hx, y + H - 0.12, z + hz - 0.15, 1);
  b.box('steel_dark', x + hx, y + 0.15, z - 0.012, x + hx + 0.01, y + H - 0.12, z + 0.012, 1);
  for (const zz of [z - hz + 0.45, z - 0.35, z + 0.35, z + hz - 0.45]) {
    b.cylinder('steel', x + hx + 0.05, y + 0.18, zz, 0.022, H - 0.36, 6, { top: true });
    b.box('steel', x + hx + 0.02, y + 1.0, zz - 0.02, x + hx + 0.12, y + 1.06, zz + 0.16, 63);
  }
  for (const zz of [z - hz + 0.16, z + hz - 0.2]) for (const yy of [0.5, 1.3, 2.1]) b.box('steel_dark', x + hx, y + yy, zz, x + hx + 0.04, y + yy + 0.14, zz + 0.04, 63);
  void p;
}

/** Transit-shed floor: blocks of stacked crates / bagged cargo and a few shipping containers in aisles. */
function portStacks(ctx, o) {
  const b = ctx.b, s = ctx.spec;
  const { w, d, ffl, x0, x1, z0, z1 } = o;
  const rng = ctx.sub(981);
  const CON = [[0.62, 0.22, 0.16], [0.18, 0.36, 0.55], [0.75, 0.75, 0.72], [0.25, 0.45, 0.38], [0.8, 0.55, 0.2]];
  for (let x = -w / 2 + 5; x < w / 2 - 5; x += 9) {
    for (let z = -d / 2 + 6; z < d / 2 - 8; z += 7) {
      if (x > x0 - 3 && x < x1 + 3 && z > z0 - 3 && z < z1 + 3) continue;
      const r = rng.next();
      if (r < 0.22) {
        // 20 ft container (6.06 × 2.44 × 2.59) with corrugated doors end
        const c = CON[Math.floor(rng.next() * CON.length)];
        b.withTint(c, () => container20(b, x, ffl, z));
        if (b.collecting) b.colBox(x - 3.03, ffl, z - 1.22, x + 3.03, ffl + 2.59, z + 1.22);
      } else if (r < 0.85) {
        // pallet block: 3 × 2 pallets, 1–3 high
        const hN = 1 + Math.floor(rng.next() * 3);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < hN; k++) {
          const px = x - 2.0 + i * 1.35, pz = z - 0.7 + j * 1.3, py = ffl + k * 1.25;
          b.withTint([0.9, 0.82, 0.62], () => b.box('wood', px - 0.6, py, pz - 0.6, px + 0.6, py + 0.14, pz + 0.6, 63 & ~8));
          b.withTint(rng.next() < 0.5 ? [0.92, 0.88, 0.8] : [0.6, 0.66, 0.72], () => b.cbox('cabinet', px - 0.56, py + 0.14, pz - 0.56, px + 0.56, py + 1.2, pz + 0.56, 0.03, false));
        }
        if (b.collecting) b.colBox(x - 2.6, ffl, z - 1.3, x + 1.3 + 0.7, ffl + hN * 1.25, z + 1.3 + 0.6);
      }
    }
  }
  void s;
}

function gableRise(D) { return clamp(D * 0.06, 1.2, 4.0); }

function shedMassing(ctx, o) {
  const s = ctx.spec, b = ctx.b;
  const { ffl, eave } = shedLevels(ctx, o);
  const blank = { front: true, right: true, back: true, left: true };
  const R = K.roofSpec(s, ctx.style, ctx.inst);
  const vols = [zMass(ctx, { fh: eave, gh: eave, ffl: 0, roofY: ffl + eave }, { blank, parapet: o.roof === 'flat' ? 1.0 : 0.05, bands: false, roofColor: K.roofFarColor(R), bayW: 7.5 })];
  if (o.roof === 'gable') {
    const D = s._d, W = s._w, y0 = ffl + eave, r = gableRise(D), ov = 0.9;
    b.pushTint([0.62, 0.65, 0.68]);
    b.quad('mass_roof', -W / 2 - ov, y0 - 0.06, D / 2 + 0.5, W / 2 + ov, y0 - 0.06, D / 2 + 0.5, W / 2 + ov, y0 + r, 0, -W / 2 - ov, y0 + r, 0);
    b.quad('mass_roof', W / 2 + ov, y0 - 0.06, -D / 2 - 0.5, -W / 2 - ov, y0 - 0.06, -D / 2 - 0.5, -W / 2 - ov, y0 + r, 0, W / 2 + ov, y0 + r, 0);
    b.triangle('mass_roof', W / 2, y0, D / 2, W / 2, y0, -D / 2, W / 2, y0 + r, 0);
    b.triangle('mass_roof', -W / 2, y0, -D / 2, -W / 2, y0, D / 2, -W / 2, y0 + r, 0);
    b.popTint();
  }
  if (o.roof === 'vault') {
    const D = s._d, rise = Math.min(D * 0.14, 7), n = 10, y0 = ffl + eave;
    const prof = roofProfile({ z0: -D / 2, z1: D / 2, y0: ffl, eave, roof: { kind: 'vault', rise } });   // same curve as the near roof
    b.pushTint([0.62, 0.65, 0.68]);
    for (let i = 0; i < n; i++) {
      const za = -D / 2 + (D * i) / n, zb = za + D / n;
      const ya = prof.y(za), yb = prof.y(zb);
      b.quad('mass_roof', -s._w / 2, ya, za, -s._w / 2, yb, zb, s._w / 2, yb, zb, s._w / 2, ya, za);
      b.triangle('mass_roof', s._w / 2, y0, 0, s._w / 2, ya, za, s._w / 2, yb, zb);     // closed gable ends
      b.triangle('mass_roof', -s._w / 2, y0, 0, -s._w / 2, yb, zb, -s._w / 2, ya, za);
    }
    b.popTint();
  } else if (o.roof === 'sawtooth') {
    const D = s._d, nT = Math.max(2, Math.round(D / 10)), tz = D / nT, y0 = ffl + eave;
    b.pushTint([0.62, 0.65, 0.68]);
    for (let i = 0; i < nT; i++) {
      const za = -D / 2 + i * tz, zb = za + tz;
      b.quad('mass_roof', -s._w / 2, y0 + 3.0, za + 0.6, s._w / 2, y0 + 3.0, za + 0.6, s._w / 2, y0, zb, -s._w / 2, y0, zb);
      b.quad('mass_roof', s._w / 2, y0, za, -s._w / 2, y0, za, -s._w / 2, y0 + 3.0, za + 0.6, s._w / 2, y0 + 3.0, za + 0.6);
    }
    b.popTint();
  }
  return vols;
}

export default {
  name: 'warehouse',
  uses: ['warehouse'],
  generate(spec, lod, ctx) {
    const s = ctx.spec;
    const { dockSide, roof } = warehouseKind(s);
    const clad = ctx.style.id === 'zr_cold' ? { key: 'panel_insulated', band: null } : CLAD[(s.hash >>> 5) % CLAD.length];
    shed(ctx, { dockSide, raised: true, doorW: 3.4, doorH: 4.2, roof, wallKey: clad.key, band: clad.band, gable: roof === 'gable' ? 'solid' : undefined });
  },
  massing(spec, ctx) { const { dockSide, roof } = warehouseKind(ctx.spec); return shedMassing(ctx, { roof, dockSide, raised: true }); },
};

export { shedMassing, eU };
