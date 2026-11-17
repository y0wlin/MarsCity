// 水处理站 — O-zone water treatment works (R1/O01 round clarifiers, O03 polar water logic). OWNER: buildings-o.
//
// Plan first: the footprint holds the treatment building — filter hall (rapid sand filter cells with
// walkways, pipe gallery, backwash pumps), chemical store behind the equipment roller door (spec
// 'equipment' side, loading apron) and the control room / lab along the street front (spec 'control' +
// 'main' doors, band windows). The back door (spec 'maintenance') opens onto the basin yard that urban.js
// reserves behind the building ('basins' area, starting 6 m behind the back facade): two round clarifiers
// (or one clarifier + a flocculation / aeration basin on narrow lots) with sunk walls, launders, centre
// drive, rotating half bridge with walkway + yellow rails, access stairs; a pipe bridge on steel trestles
// carries raw / settled water mains between the hall and the tanks. Roof: rooflight strips, extract fans,
// chemical vent stacks. Climate: lee dust (dry), snow + insulated shell (polar), algae lines (wet).

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, oEnv, roomMap, yellowRail, grating, steelStair, pipeRun, valve, cabinet, drift, utilAnchors, massVol, massCyl, lampPost } from './o_common.js';
import { buildHall, consoleDesk, chairSimple, railSimple, partition, doorSpans } from './o_hall.js';
import { bandWindows, dedupeOps } from './o_block.js';

function dims(ctx) {
  const s = ctx.spec, E = oEnv(ctx);
  const w = s._w, d = s._d;
  const nF = Math.max(1, Math.min(2, s._floors));
  const fh = Math.max(4.5, Math.min(6, s._fh || 5));
  const ffl = E.ffl;
  const top = ffl + (nF === 1 ? Math.max(5.5, fh) : nF * fh);
  // basin yard behind: clarifier radius from the lot width
  const m = s._meta || {};
  const by = m.basins || {};
  const gapB = Number.isFinite(+by.gap) ? +by.gap : 6;
  const depthB = Number.isFinite(+by.depth) ? +by.depth : 22;
  const R = Math.max(5, Math.min(8.5, Math.min(w / 4 - 0.8, (depthB - 3) / 2)));
  const two = w >= 4 * R + 3.5;
  return { E, w, d, nF, fh, ffl, top, gapB, depthB, R, two };
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const D = dims(ctx);
  const { E, w, d, nF, ffl, top, R, two, gapB } = D;
  const rng = ctx.sub(1801);
  const L = (side) => (isFB(side) ? w : d);
  const ops = { front: [], right: [], back: [], left: [] };
  const uOf = (e, side) => L(side) / 2 + (side === 'back' || side === 'left' ? -1 : 1) * (e.offset || 0);
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: w * 0.2 };
  const ctlE = s._entrances.find((e) => e.kind === 'control');
  const eqE = s._entrances.find((e) => e.kind === 'equipment' || e.kind === 'service' || e.kind === 'loading');
  const mtE = s._entrances.find((e) => e.kind === 'maintenance' || e.kind === 'back');
  const M = mainE.side;
  const Bk = OPP[M];
  let S = eqE ? eqE.side : 'right';
  if (S === M || S === Bk) S = isFB(M) ? 'right' : 'front';
  // ---- front: main door (lab / control), control door, band windows ----
  const LM = L(M);
  const du = Math.max(1.5, Math.min(LM - 1.5, uOf(mainE, M)));
  const door = { u0: du - 0.6, u1: du + 0.6, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'glazed', entry: true, plate: true };
  ops[M].push(door);
  const avoid = [[door.u0, door.u1]];
  if (ctlE && ctlE.side === M) {
    let cu = Math.max(1.5, Math.min(LM - 1.5, uOf(ctlE, M)));
    if (Math.abs(cu - du) < 3) cu = du + (du < LM / 2 ? 4 : -4);
    const cd = { u0: cu - 0.5, u1: cu + 0.5, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service', entry: true };
    ops[M].push(cd); avoid.push([cd.u0, cd.u1]);
  }
  bandWindows(ctx, ops, M, w, d, { y: ffl, h: nF === 1 ? top - ffl : D.fh, sill: 0.95, head: 2.4, every: 3.6, width: 1.6, avoid, kind: 'office', floor: 0, depth: 5 });
  if (nF === 1) bandWindows(ctx, ops, M, w, d, { y: ffl, h: top - ffl, sill: 3.3, head: Math.min(top - ffl - 0.5, 4.6), every: 3.6, width: 2.2, kind: 'plant', floor: 0, depth: d - 1, type: 'fixed', cols: 2 });
  else bandWindows(ctx, ops, M, w, d, { y: ffl + D.fh, h: D.fh, every: 3.6, width: 1.6, floor: 1, depth: 6 });
  // ---- equipment side: roller door to the chemical store + louvres ----
  const LS = L(S);
  const ru = Math.max(2.6, Math.min(LS - 2.6, eqE && eqE.side === S ? uOf(eqE, S) : LS * 0.6));
  const roller = { u0: ru - 1.8, u1: ru + 1.8, v0: ffl, v1: ffl + Math.min(4.2, top - ffl - 1.0), kind: 'roller', open: rng.next() < 0.25 ? 0.6 : 0, apron: { depth: 9, ext: 1.8 } };
  ops[S].push(roller);
  for (const u of [roller.u0 - 1.6, roller.u1 + 1.6]) if (u > 1.2 && u < LS - 1.2) ops[S].push({ u0: u - 0.6, u1: u + 0.6, v0: ffl + 0.5, v1: ffl + 1.7, kind: 'louvre' });
  bandWindows(ctx, ops, S, w, d, { y: ffl, h: top - ffl, sill: 3.3, head: Math.min(top - ffl - 0.5, 4.6), every: 4.0, width: 2.0, avoid: [[roller.u0, roller.u1]], kind: 'plant', floor: 0, depth: w - 1, type: 'fixed', cols: 2 });
  // ---- back: maintenance door to the basin yard, high windows ----
  const LB = L(Bk);
  const bu = Math.max(1.4, Math.min(LB - 1.4, mtE && mtE.side === Bk ? uOf(mtE, Bk) : LB * 0.35));
  const backDoor = { u0: bu - 0.55, u1: bu + 0.55, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service', entry: true };
  ops[Bk].push(backDoor);
  bandWindows(ctx, ops, Bk, w, d, { y: ffl, h: top - ffl, sill: 3.3, head: Math.min(top - ffl - 0.5, 4.6), every: 3.8, width: 2.0, avoid: [[backDoor.u0, backDoor.u1]], kind: 'plant', floor: 0, depth: d - 1, type: 'fixed', cols: 2 });
  // remaining side
  for (const side of SIDES) {
    if (side === M || side === Bk || side === S) continue;
    const Ls = L(side);
    ops[side].push({ u0: Ls / 2 - 0.9, u1: Ls / 2 + 0.9, v0: ffl + 0.5, v1: ffl + 1.7, kind: 'louvre' });
    bandWindows(ctx, ops, side, w, d, { y: ffl, h: top - ffl, sill: 3.3, head: Math.min(top - ffl - 0.5, 4.6), every: 4.0, width: 2.0, avoid: [[Ls / 2 - 1, Ls / 2 + 1]], kind: 'plant', floor: 0, depth: w - 1, type: 'fixed', cols: 2 });
  }
  for (const side of SIDES) ops[side] = dedupeOps(ops[side]);
  // ---- shell ----
  const H = buildHall(ctx, { env: E, ffl, top, T: E.wallT, ops, roof: { kind: 'flat', dp: S }, ceiling: 'beams', parapet: 0.9, band: nF === 2 ? ffl + D.fh : undefined, walls: [], slabs: [], stairs: [] });
  const I = H.inner;
  // ---- interior ('full'): office strip along the front, filter cells, pipe gallery ----
  if (ctx.full) hallFitOut(ctx, D, I, M, du);
  // ---- roof: rooflight strips, extract fans, vent stacks, hatch ----
  {
    const ri = H.inner, yr = top;
    const alongX = ri.x1 - ri.x0 >= ri.z1 - ri.z0;
    const nS = 2;
    for (let k = 0; k < nS; k++) {
      const t = (k + 1) / (nS + 1);
      if (alongX) { const z = ri.z0 + (ri.z1 - ri.z0) * t; K.skylight(b, { x0: ri.x0 + 2, x1: ri.x1 - 2, z0: z - 0.7, z1: z + 0.7 }, yr, {}); }
      else { const x = ri.x0 + (ri.x1 - ri.x0) * t; K.skylight(b, { x0: x - 0.7, x1: x + 0.7, z0: ri.z0 + 2, z1: ri.z1 - 2 }, yr, {}); }
    }
    for (let k = 0; k < 3; k++) K.ventMushroom(b, ri.x0 + 1.2 + k * 1.1, yr, ri.z1 - 1.0, 0.18, 1.2);
    K.hvacUnit(b, ri.x1 - 2.0, yr, ri.z0 + 1.2, 0, { w: 2.2, d: 1.1, h: 1.1 });
    K.roofHatch(b, ri.x0 + 1.4, yr, ri.z0 + 1.4, {});
  }
  // ---- basin yard behind the building ----
  const yard = basinYard(ctx, D, Bk, bu, rng);
  // ---- climate ----
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', skip: doorSpans(H.opsBySide[E.lee]) });
  if (E.polar) drift(ctx, E.lee, { kind: 'snow', skip: doorSpans(H.opsBySide[E.lee]) });
  // ---- anchors ----
  utilAnchors(ctx, {
    ffl, h: top - ffl, roofY: top + 0.9, access: [I.x0 + 1.4, top, I.z0 + 1.4],
    floors: nF === 1 ? [{ level: 0, y: ffl, height: top - ffl }] : [{ level: 0, y: ffl, height: D.fh }, { level: 1, y: ffl + D.fh, height: D.fh }],
    entrances: [
      { kind: 'main', side: M, pos: K.facadePoint(M, w, d, du, ffl, 0.6), dir: K.facadeNormal(M), width: 1.2 },
      { kind: 'equipment', side: S, pos: K.facadePoint(S, w, d, ru, ffl, 0.6), dir: K.facadeNormal(S), width: 3.6 },
      { kind: 'maintenance', side: Bk, pos: K.facadePoint(Bk, w, d, bu, ffl, 0.6), dir: K.facadeNormal(Bk), width: 1.1 },
    ],
    rooms: [{ floor: 0, name: 'filter hall', kind: 'plant', center: [0, ffl, 0], size: [w, top - ffl, d] }],
    cameras: { basins: yard.cam, back: yard.cam },
  });
  b.meta.basins = yard.meta;
}

/** 'full' fit-out: office strip along the front, filter cells with walkways, pipe gallery + pumps. */
function hallFitOut(ctx, D, I, M, du) {
  const b = ctx.b, s = ctx.spec;
  const { ffl, top } = D;
  // work in a frame where the front (M) is +z
  const rot = { front: 0, back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }[M];
  b.push(); b.rotY(rot);
  const hw = isFB(M) ? (I.x1 - I.x0) / 2 : (I.z1 - I.z0) / 2, hd = isFB(M) ? (I.z1 - I.z0) / 2 : (I.x1 - I.x0) / 2;
  const zOff = hd - 4.2;           // office strip depth 4.2 m
  partition(ctx, { x0: -hw, z0: zOff, x1: hw, z1: zOff, y0: ffl, y1: ffl + 3.4, doors: [{ at: hw + (du - (isFB(M) ? D.w : D.d) / 2) + (du > (isFB(M) ? D.w : D.d) / 2 ? -2.2 : 2.2), w: 1.0, glazed: true }, { at: hw * 0.4, w: 1.0 }] });
  b.cbox('panel_grey', -hw, ffl + 3.4, zOff, hw, ffl + 3.55, hd, 0.01);
  consoleDesk(b, -hw * 0.45, ffl, hd - 1.0, 2.8, 0);
  chairSimple(b, -hw * 0.45, ffl, hd - 1.9, 0);
  for (let k = 0; k < 3; k++) cabinet(b, hw - 0.8 - k * 0.9, ffl, zOff + 0.4, 0.8, 2.0, 0.5, 0, 'hvac');
  // filter cells (2 × n) with central walkway
  const cw = 4.2, cl = Math.min(6.5, (zOff + hd) - 4.5);
  const nC = Math.max(1, Math.floor((2 * hw - 2) / (cw + 0.4)));
  const z0 = -hd + 0.6, z1 = z0 + cl;
  const yW = ffl + 1.1;
  for (let i = 0; i < nC; i++) {
    const x0 = -hw + 1.0 + i * (cw + 0.4), x1 = x0 + cw;
    b.box('concrete_smooth', x0, ffl, z0, x1, yW + 0.1, z0 + 0.25, ALL & ~NY);
    b.box('concrete_smooth', x0, ffl, z1 - 0.25, x1, yW + 0.1, z1, ALL & ~NY);
    b.box('concrete_smooth', x0, ffl, z0 + 0.25, x0 + 0.25, yW + 0.1, z1 - 0.25, PX | NX | PY);
    b.box('concrete_smooth', x1 - 0.25, ffl, z0 + 0.25, x1, yW + 0.1, z1 - 0.25, PX | NX | PY);
    b.withTint([0.15, 0.26, 0.28], () => b.rectY('chrome', x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, yW - 0.25, 1));
    // wash-water troughs across the cell
    for (const zz of [z0 + cl * 0.33, z0 + cl * 0.66]) b.box('concrete_smooth', x0 + 0.25, yW - 0.45, zz - 0.15, x1 - 0.25, yW - 0.15, zz + 0.15, ALL);
    if (b.collecting) b.colBox(x0, ffl, z0, x1, yW + 0.1, z1);
    yellowRail(b, [[x0 + 0.1, yW + 0.1, z1 + 0.05], [x1 - 0.1, yW + 0.1, z1 + 0.05]], { h: 1.0 });
  }
  // walkway (grating) on posts along the cells' front edge + stair
  grating(b, -hw + 0.8, z1, -hw + 1.0 + nC * (cw + 0.4), z1 + 1.2, yW + 0.1);
  yellowRail(b, [[-hw + 0.85, yW + 0.1, z1 + 1.15], [-hw + 1.0 + nC * (cw + 0.4) - 0.05, yW + 0.1, z1 + 1.15]]);
  steelStair(b, { x: -hw + 1.0 + nC * (cw + 0.4) + 1.6, y0: ffl, z: z1 + 0.6, rise: yW + 0.1 - ffl, dir: Math.PI, W: 0.9, rails: 'both' });
  // pipe gallery: blue header + valves along the walkway, backwash pumps
  b.withTint([0.4, 0.55, 0.78], () => pipeRun(b, [[-hw + 0.6, ffl + 0.6, z1 + 2.0], [hw - 0.6, ffl + 0.6, z1 + 2.0]], 0.25, { key: 'steel_dark', ground: ffl }));
  for (let i = 0; i < nC; i++) valve(b, -hw + 1.0 + i * (cw + 0.4) + cw / 2, ffl + 0.6, z1 + 2.0, 0.22);
  for (let k = 0; k < 2; k++) {
    const x = hw - 2.0 - k * 2.2, z = z1 + 3.4;
    b.cbox('concrete_smooth', x - 0.6, ffl, z - 0.9, x + 0.6, ffl + 0.3, z + 0.9, 0.02, false);
    b.withTint([0.4, 0.55, 0.78], () => b.cylinder('steel_dark', x, ffl + 0.3, z - 0.3, 0.38, 0.9, 16, { top: true }));
    b.withTint([0.32, 0.45, 0.62], () => b.cylinder('steel_dark', x, ffl + 0.3, z + 0.45, 0.3, 1.1, 16, { top: true }));
    if (b.collecting) b.colBox(x - 0.6, ffl, z - 0.9, x + 0.6, ffl + 1.4, z + 0.9);
  }
  b.pop();
  void s; void top;
}

/** Clarifiers / basin behind the building (building frame via the back facade frame). */
function basinYard(ctx, D, Bk, bu, rng) {
  const b = ctx.b, s = ctx.spec, E = D.E;
  const { w, d, R, two, gapB, ffl } = D;
  const L = isFB(Bk) ? w : d;
  b.push(); K.facadeFrame(b, Bk, w, d, 0);
  // yard frame: x = u along the back facade (0..L), z = distance out from the facade
  const [g0, g1] = K.sideGround(s, Bk);
  const gy = Math.min(g0, g1);
  const zc = gapB + R + 0.5;
  const tanks = two ? [L * 0.27, L * 0.73] : [L * 0.3];
  const yRim = gy + 1.25, yWater = yRim - 0.35;
  // yard paving strip from the door to the tanks
  b.withTint([0.9, 0.89, 0.86], () => b.cbox('concrete', bu - 1.2, gy - 0.3, 0.3, bu + 1.2, gy + 0.06, gapB + 0.6, 0.01, false));
  if (b.collecting) b.colQuad(bu - 1.2, gy + 0.06, gapB + 0.6, bu + 1.2, gy + 0.06, gapB + 0.6, bu + 1.2, gy + 0.06, 0.3, bu - 1.2, gy + 0.06, 0.3);
  const n = 40;
  for (const tx of tanks) {
    // tank wall (outer + inner face), coping, launder ring, water surface
    const outer = [], inner = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; outer.push([tx + Math.cos(a) * R, zc + Math.sin(a) * R]); inner.push([tx + Math.cos(a) * (R - 0.3), zc + Math.sin(a) * (R - 0.3)]); }
    b.lathe('concrete', [[R, gy - 0.6], [R, yRim]], n, { x: tx, y: 0, z: zc });
    b.lathe('concrete_smooth', [[R + 0.03, yRim], [R - 0.33, yRim]], n, { x: tx, y: 0, z: zc });
    b.withTint([0.82, 0.82, 0.8], () => b.lathe('concrete_wet', [[R - 0.3, yRim], [R - 0.3, yWater - 1.6]], n, { x: tx, y: 0, z: zc }));
    if (E.wet) b.withTint(E.algaeTint, () => b.lathe('concrete_wet', [[R - 0.302, yWater + 0.06], [R - 0.302, yWater - 0.2]], n, { x: tx, y: 0, z: zc }));
    // launder (inner peripheral channel) with V-notch weir plate
    b.lathe('concrete_smooth', [[R - 0.3, yWater + 0.12], [R - 1.1, yWater + 0.12], [R - 1.1, yWater - 0.5]], n, { x: tx, y: 0, z: zc });
    b.lathe('steel_brushed', [[R - 1.12, yWater + 0.14], [R - 1.12, yWater - 0.02]], n, { x: tx, y: 0, z: zc });
    b.withTint([0.16, 0.27, 0.29], () => { b.lathe('chrome', [[R - 1.15, yWater], [0.45, yWater]], n, { x: tx, y: 0, z: zc }); b.lathe('chrome', [[R - 0.32, yWater + 0.02], [R - 1.08, yWater + 0.02]], n, { x: tx, y: 0, z: zc }); });
    // centre column + drive + feed well
    b.cylinder('concrete_smooth', tx, yWater - 0.5, zc, 0.45, yRim - yWater + 0.9, 16, { top: true });
    b.lathe('steel_brushed', [[1.6, yWater + 0.25], [1.6, yWater - 0.8]], 24, { x: tx, y: 0, z: zc });
    b.withTint([0.42, 0.56, 0.72], () => b.cbox('steel_dark', tx - 0.6, yRim + 0.4, zc - 0.6, tx + 0.6, yRim + 1.1, zc + 0.6, 0.02));
    // rotating half bridge: truss girder from the centre to the rim + walkway + rails + end carriage
    const ang = rng.next() * Math.PI * 2;
    b.push(); b.translate(tx, 0, zc); b.rotY(-ang);
    const yb = yRim + 0.4;
    b.box('steel', 0.3, yb - 0.5, -0.06, R + 0.15, yb - 0.38, 0.06, ALL);
    grating(b, 0.4, -0.55, R + 0.1, 0.55, yb);
    yellowRail(b, [[0.5, yb, 0.5], [R + 0.05, yb, 0.5]]);
    yellowRail(b, [[0.5, yb, -0.5], [R + 0.05, yb, -0.5]]);
    for (let k = 1; k <= 4; k++) { const x = 0.4 + ((R - 0.3) * k) / 4; b.tube('steel', [[x, yb - 0.45, -0.5], [x - (R - 0.3) / 8, yb - 0.1, 0]], 0.025, 5); }
    b.withTint([0.42, 0.56, 0.72], () => b.cbox('steel_dark', R - 0.6, yRim, -0.6, R + 0.25, yb - 0.1, 0.6, 0.02));
    // scraper arm under water (visible as a dark bar at the surface) + skimmer
    b.box('steel_dark', 0.5, yWater - 0.12, -0.05, R - 1.2, yWater + 0.05, 0.05, PY | PZ | NZ);
    b.pop();
    // access stair to the rim facing the building + platform
    const sx = tx + (tx < bu ? 1 : -1) * 0;
    steelStair(b, { x: sx - 0.45, y0: gy, z: zc - R - 2.2, rise: yRim + 0.4 - gy, dir: Math.PI / 2, W: 0.9, rails: 'both' });
    grating(b, sx - 0.9, zc - R - 0.6, sx + 0.9, zc - R + 0.3, yRim + 0.4);
    if (b.collecting) b.colBox(tx - R, gy, zc - R, tx + R, yRim, zc + R);
    // feed main from the building: pipe bridge on trestles at 3.2 m
    const yP = gy + 3.2;
    const xs = Math.max(1.0, Math.min(L - 1.0, tx + (tx < L / 2 ? 1.2 : -1.2)));
    pipeRun(b, [[xs, ffl + 3.4, -0.2], [xs, yP, 1.0], [xs, yP, zc - 1.2], [tx, yP, zc - 0.6], [tx, yRim + 1.1, zc - 0.6]], 0.2, { key: 'steel_dark', ground: gy, flange: true, insulated: E.polar });
    for (let z = 2.0; z < zc - R; z += 3.2) { b.box('steel', xs - 0.08, gy, z - 0.08, xs + 0.08, yP - 0.2, z + 0.08, PX | NX | PZ | NZ); b.box('steel', xs - 0.5, yP - 0.28, z - 0.06, xs + 0.5, yP - 0.2, z + 0.06, ALL); b.cbox('concrete', xs - 0.3, gy - 0.3, z - 0.3, xs + 0.3, gy + 0.1, z + 0.3, 0.01, false); }
  }
  if (!two) {
    // flocculation / aeration basin beside the clarifier
    const x0 = L * 0.58, x1 = L - 0.8, z0 = gapB + 0.5, z1 = gapB + 2 * R + 0.5;
    if (x1 - x0 > 4) {
      b.box('concrete', x0, gy - 0.6, z0, x1, yRim, z1, PX | NX | PZ | NZ);
      for (const [a, c, e, f] of [[x0 - 0.02, z0 - 0.02, x1 + 0.02, z0 + 0.3], [x0 - 0.02, z1 - 0.3, x1 + 0.02, z1 + 0.02], [x0 - 0.02, z0 + 0.3, x0 + 0.3, z1 - 0.3], [x1 - 0.3, z0 + 0.3, x1 + 0.02, z1 - 0.3]]) b.cbox('concrete_smooth', a, yRim, c, e, yRim + 0.1, f, 0.01);
      // inner wall faces down to the water (wet below the water line)
      for (const [xa, za, xb, zb, nx, nz] of [[x0 + 0.3, z0 + 0.3, x1 - 0.3, z0 + 0.3, 0, 1], [x1 - 0.3, z1 - 0.3, x0 + 0.3, z1 - 0.3, 0, -1], [x0 + 0.3, z1 - 0.3, x0 + 0.3, z0 + 0.3, 1, 0], [x1 - 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, -1, 0]]) {
        b.quad('concrete_wet', xa, yWater - 0.6, za, xb, yWater - 0.6, zb, xb, yRim, zb, xa, yRim, za);
        void nx; void nz;
      }
      b.withTint([0.18, 0.3, 0.3], () => b.rectY('chrome', x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, yWater, 1));
      // baffle walls + aeration foam patches
      const zm = (z0 + z1) / 2;
      b.box('concrete_smooth', x0 + 0.3, yWater - 0.8, zm - 0.12, x1 - 0.3, yRim + 0.1, zm + 0.12, ALL);
      b.withTint([0.96, 0.97, 0.96], () => { for (let k = 0; k < 6; k++) { const xx = x0 + 0.8 + ((x1 - x0 - 1.6) * (k + 0.5)) / 6; b.blob('render_white', xx, yWater, z0 + 0.3 + (zm - z0) * 0.5, 0.45, 0.04, 0.45, k + 3, 0); } });
      grating(b, x0 + 0.3, zm - 0.6, x1 - 0.3, zm + 0.6, yRim + 0.12);
      yellowRail(b, [[x0 + 0.3, yRim + 0.12, zm + 0.55], [x1 - 0.3, yRim + 0.12, zm + 0.55]]);
      yellowRail(b, [[x1 - 0.3, yRim + 0.12, zm - 0.55], [x0 + 0.3, yRim + 0.12, zm - 0.55]]);
      if (b.collecting) b.colBox(x0, gy, z0, x1, yRim, z1);
    }
  }
  // lamp + sample cabinet
  lampPost(b, Math.min(L - 0.6, bu + 2.2), gy, gapB - 0.8, 6, Math.PI / 2);
  cabinet(b, Math.max(0.8, bu - 2.4), gy, gapB - 1.2, 0.9, 1.6, 0.5, Math.PI, 'hvac');
  b.pop();
  const cam = { pos: K.facadePoint(Bk, w, d, tanks[0] - R * 0.6, gy + 5.5, zc - R - 6), target: K.facadePoint(Bk, w, d, tanks[0], gy + 1, zc) };
  return { cam, meta: { tanks: tanks.length, radius: R, behind: gapB } };
}

function massing(spec, ctx) {
  const D = dims(ctx);
  const s = ctx.spec, b = ctx.b;
  const Bk = OPP[(s._entrances.find((e) => e.kind === 'main') || { side: 'front' }).side];
  const L = isFB(Bk) ? D.w : D.d;
  b.push(); K.facadeFrame(b, Bk, D.w, D.d, 0);
  const zc = D.gapB + D.R + 0.5;
  for (const tx of D.two ? [L * 0.27, L * 0.73] : [L * 0.3]) {
    massCyl(b, tx, -0.6, zc, D.R, 1.85, [0.62, 0.6, 0.57]);
    b.pushTint([0.12, 0.24, 0.27]); b.lathe('mass_roof', [[D.R - 0.3, 0.92], [0, 0.92]], 24, { x: tx, y: 0, z: zc }); b.popTint();
  }
  b.pop();
  return [massVol(-D.w / 2, D.w / 2, -D.d / 2, D.d / 2, Math.min(0, s._ground.min) - 0.5, D.top, { floorH: D.nF === 1 ? D.top - D.ffl : D.fh, groundH: D.ffl + (D.nF === 1 ? D.top : D.fh), roofColor: D.E.polar ? [0.82, 0.84, 0.86] : [0.55, 0.53, 0.5] })];
}

export default { name: 'water_treatment', uses: ['water_treatment'], generate, massing };
