// 工务车辆段 / 服务站场 — O-zone service depot: vehicle shed for maintenance rovers and trucks (and the halt
// building of O-zone pipe / halt stations: spec.meta.platformLength → platform canopy on the back). OWNER: buildings-o.
//
// Plan first: vehicles arrive on the loading side (spec 'loading' entrances; polar meta.vehicleBay depots
// use the front) through 4.6 m roller doors from a wide concrete turning yard with lane markings and stop
// bars (维修车的回转场), each bay inside has an inspection pit with yellow edges; the personnel door
// (spec 'main') opens into a two-storey office / crew corner on the street front; clerestory bands light
// the shed; charging posts + a wash-down point by the yard; roof: flat with rooflight strips + extract fans
// (polar: insulated vault, heated door hoods, snow). 'full': pits, workbenches, racks, crane runway,
// office slab + stair, colliders.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, oEnv, drift, utilAnchors, massVol, massVault, cabinet, lampPost, yellowRail } from './o_common.js';
import { buildHall, workbench, rack, consoleDesk, chairSimple, doorSpans } from './o_hall.js';
import { dedupeOps, storeySlabs, bandWindows } from './o_block.js';
import { loadingDoors, officeFront, clerestory, laneMarks } from './o_shed.js';

function dims(ctx) {
  const s = ctx.spec, E = oEnv(ctx);
  const w = s._w, d = s._d;
  const ffl = E.polar ? 0.3 : 0.15;
  const H = Math.max(5.5, Math.min(9.5, s._fh || 7));
  const top = ffl + H;
  return { E, w, d, ffl, H, top, vault: E.polar };
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const D = dims(ctx);
  const { E, w, d, ffl, H, top } = D;
  const m = s._meta || {};
  const rng = ctx.sub(2001);
  const L = (side) => (isFB(side) ? w : d);
  const ops = { front: [], right: [], back: [], left: [] };
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: w * 0.35 };
  const M = mainE.side;
  const loadE = s._entrances.find((e) => e.kind === 'loading' || e.kind === 'service');
  const halt = !!m.platformLength;
  let V = loadE ? loadE.side : (m.vehicleBay ? M : 'right');
  if (halt && V === 'back') V = 'right';
  const LV = L(V);
  const dw = Math.min(4.6, Math.max(3.6, (LV - 4) / 3)), dh = Math.min(5.0, H - 1.2);
  const nD = Math.max(1, Math.min(6, Math.floor((LV - 3) / (dw + 2.2))));
  let us = loadingDoors(s, V, LV, nD, dw, { extra: nD > 2 ? nD : 0 });
  // office corner on the main side
  const LM = L(M);
  const uOf = (e, side) => L(side) / 2 + (side === 'back' || side === 'left' ? -1 : 1) * (e.offset || 0);
  let du = Math.max(1.6, Math.min(LM - 1.6, uOf(mainE, M)));
  if (V === M) {
    // doors share the front with the office: keep the office corner clear
    const left = du < LM / 2;
    us = us.filter((u) => (left ? u - dw / 2 > Math.min(LM * 0.35, 12) + 1.2 : u + dw / 2 < LM - Math.min(LM * 0.35, 12) - 1.2));
    if (!us.length) us = [left ? LM * 0.72 : LM * 0.28];
  }
  const office = officeFront(ctx, ops, M, w, d, ffl, du, { levels: [ffl, ffl + 3.6] });
  const doors = us.map((u) => ({ u0: u - dw / 2, u1: u + dw / 2, v0: ffl, v1: ffl + dh, kind: 'roller', open: rng.next() < 0.35 ? 0.85 : 0, apron: E.polar ? false : { depth: Math.min(16, Math.max(10, d * 0.45)), ext: 1.0 } }));
  ops[V].push(...doors);
  // clerestory on the long walls + the remaining walls
  for (const side of SIDES) {
    const avoid = side === M ? [[office.u0, office.u1]] : [];
    if (!(halt && side === 'back')) clerestory(ctx, ops, side, w, d, top - 2.3, top - 0.7, { avoid });
    if (side !== M && side !== V && side !== 'back') ops[side].push({ u0: L(side) / 2 - 1.0, u1: L(side) / 2 + 1.0, v0: ffl + 0.6, v1: ffl + 1.9, kind: 'louvre' });
  }
  if (halt) {
    // halt: waiting room door + windows onto the platform at the back
    const LB = L('back');
    ops.back.push({ u0: LB / 2 - 0.9, u1: LB / 2 + 0.9, v0: ffl, v1: ffl + 2.4, kind: 'door', doorKind: 'glazed_double' });
    bandWindows(ctx, ops, 'back', w, d, { y: ffl, h: 3.4, every: 3.6, width: 1.8, avoid: [[LB / 2 - 1.2, LB / 2 + 1.2]], kind: 'lobby', floor: 0, depth: 6 });
  }
  for (const side of SIDES) ops[side] = dedupeOps(ops[side]);
  // ---- shell ----
  const Hh = buildHall(ctx, { env: E, ffl, top, T: E.wallT, ops, roof: D.vault ? { kind: 'vault', rise: Math.min(Math.min(w, d) * 0.16, 3.6) } : { kind: 'flat', dp: OPP[V] === M ? 'left' : OPP[V] }, ceiling: 'beams', parapet: 1.0, walls: [], slabs: [], stairs: [] });
  const I = Hh.inner;
  // ---- interior ('full') ----
  if (ctx.full) {
    // inspection pits behind each door, crane runway, workbenches, racks
    for (const u of us) {
      const p = K.facadePoint(V, w, d, u, 0, -Math.min(9, (isFB(V) ? d : w) * 0.4));
      const along = !isFB(V);
      const pl = Math.min(8, (isFB(V) ? d : w) - 5), pw = 0.95;
      const x0 = along ? p[0] - pl / 2 : p[0] - pw / 2, x1 = along ? p[0] + pl / 2 : p[0] + pw / 2;
      const z0 = along ? p[2] - pw / 2 : p[2] - pl / 2, z1 = along ? p[2] + pw / 2 : p[2] + pl / 2;
      b.rectY('black', x0, z0, x1, z1, ffl + 0.008, 1);
      for (const [a, c, e, f] of [[x0 - 0.15, z0 - 0.15, x1 + 0.15, z0], [x0 - 0.15, z1, x1 + 0.15, z1 + 0.15], [x0 - 0.15, z0, x0, z1], [x1, z0, x1 + 0.15, z1]]) b.box('steel_yellow', a, ffl, c, e, ffl + 0.012, f, PY);
    }
    workbench(b, I.x0 + 2.2, ffl, I.z0 + 0.6, 2.6, 0);
    rack(b, I.x1 - 3.0, ffl, I.z0 + 0.8, 5.0, 3.6, 0, s.hash);
    // office: upper slab over the office corner + stair
    const oc0 = K.facadePoint(M, w, d, office.u0, 0, -0.3), oc1 = K.facadePoint(M, w, d, office.u1, 0, -6.5);
    const R = { x0: Math.max(I.x0, Math.min(oc0[0], oc1[0])), x1: Math.min(I.x1, Math.max(oc0[0], oc1[0])), z0: Math.max(I.z0, Math.min(oc0[2], oc1[2])), z1: Math.min(I.z1, Math.max(oc0[2], oc1[2])) };
    const yU = ffl + 3.6;
    b.cbox('concrete_smooth', R.x0, yU - 0.25, R.z0, R.x1, yU, R.z1, 0.01);
    b.rectY('tile_floor', R.x0, R.z0, R.x1, R.z1, yU + 0.003, 1);
    if (b.collecting) b.colQuad(R.x0, yU, R.z1, R.x1, yU, R.z1, R.x1, yU, R.z0, R.x0, yU, R.z0);
    const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
    consoleDesk(b, cx, yU, cz, 2.4, 0);
    chairSimple(b, cx, yU, cz - 0.9, 0);
  }
  // ---- outside: yard marks, charging posts, wash point, lamps ----
  {
    const [g0, g1] = K.sideGround(s, V);
    const gy = Math.min(ffl, Math.min(g0, g1) + 0.08);
    b.push(); K.facadeFrame(b, V, w, d, 0);
    if (!E.polar) laneMarks(b, us, gy + 0.001, Math.min(16, Math.max(10, d * 0.45)), dw);
    // charging posts between the doors
    for (let i = 0; i < us.length - 1; i++) { const u = (us[i] + us[i + 1]) / 2; cabinet(b, u, gy, 1.2, 0.5, 1.5, 0.35, 0, 'hvac'); b.withTint([0.2, 0.75, 0.85], () => b.box('light_cyan', u - 0.12, gy + 1.25, 1.2 + 0.18, u + 0.12, gy + 1.35, 1.2 + 0.181, PZ)); }
    lampPost(b, Math.max(0.6, us[0] - dw / 2 - 1.2), gy, 4.0, 7, -Math.PI / 2);
    lampPost(b, Math.min(LV - 0.6, us[us.length - 1] + dw / 2 + 1.2), gy, 4.0, 7, -Math.PI / 2);
    b.pop();
    if (E.polar) for (const dr of doors) polarHood(ctx, D, V, dr);
  }
  // ---- roof equipment ----
  if (!D.vault) {
    const ri = Hh.inner;
    const alongX = ri.x1 - ri.x0 >= ri.z1 - ri.z0;
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      if (alongX) { const z = ri.z0 + (ri.z1 - ri.z0) * t; K.skylight(b, { x0: ri.x0 + 2.5, x1: ri.x1 - 2.5, z0: z - 0.8, z1: z + 0.8 }, top, {}); }
      else { const x = ri.x0 + (ri.x1 - ri.x0) * t; K.skylight(b, { x0: x - 0.8, x1: x + 0.8, z0: ri.z0 + 2.5, z1: ri.z1 - 2.5 }, top, {}); }
    }
    K.hvacUnit(b, ri.x0 + 2.0, top, ri.z1 - 1.3, 0, { w: 2.2, d: 1.1, h: 1.1 });
    K.roofHatch(b, ri.x1 - 1.4, top, ri.z1 - 1.4, {});
    for (let k = 0; k < 3; k++) K.ventMushroom(b, ri.x0 + (ri.x1 - ri.x0) * (0.25 + k * 0.25), top, ri.z0 + 1.2, 0.35, 0.9);
  }
  // ---- halt platform canopy on the back ----
  if (halt) haltPlatform(ctx, D);
  // ---- climate ----
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', skip: doorSpans(Hh.opsBySide[E.lee]) });
  if (E.polar) { drift(ctx, E.lee, { kind: 'snow', skip: doorSpans(Hh.opsBySide[E.lee]) }); drift(ctx, E.windward, { kind: 'snow', h: 0.5, reach: 2.5, seed: 3, skip: doorSpans(Hh.opsBySide[E.windward]) }); }
  // ---- anchors ----
  utilAnchors(ctx, {
    ffl, h: H, roofY: top + 1, access: [I.x1 - 1.4, top, I.z1 - 1.4],
    floors: [{ level: 0, y: ffl, height: H }],
    entrances: [{ kind: 'main', side: M, pos: K.facadePoint(M, w, d, du, ffl, 0.6), dir: K.facadeNormal(M), width: 1.2 }, ...us.map((u) => ({ kind: 'loading', side: V, pos: K.facadePoint(V, w, d, u, ffl, 0.6), dir: K.facadeNormal(V), width: dw }))],
    rooms: [{ floor: 0, name: 'vehicle shed', kind: 'plant', center: [0, ffl, 0], size: [w, H, d] }],
    cameras: { yard: { pos: K.facadePoint(V, w, d, LV * 0.2, 2.2, 18), target: K.facadePoint(V, w, d, LV * 0.5, 3, 0) }, living: { pos: K.facadePoint(V, w, d, us[0], ffl + 1.7, -2), target: K.facadePoint(V, w, d, LV * 0.6, ffl + 2, -(isFB(V) ? d : w) + 2) } },
  });
  b.meta.bays = us.length; b.meta.halt = halt;
}

/** Heated insulated hood over a polar vehicle door (wall frame of side V). */
function polarHood(ctx, D, V, dr) {
  const b = ctx.b, E = D.E;
  b.push(); K.facadeFrame(b, V, D.w, D.d, 0);
  const u0 = dr.u0 - 0.5, u1 = dr.u1 + 0.5, dep = 1.6, y = dr.v1 + 0.5;
  b.withTint(E.shellTint, () => { b.cbox('panel_insulated', u0, D.ffl - 0.1, 0, u0 + 0.35, y, dep, 0.02, false); b.cbox('panel_insulated', u1 - 0.35, D.ffl - 0.1, 0, u1, y, dep, 0.02, false); b.cbox('panel_insulated', u0 - 0.1, y, -0.05, u1 + 0.1, y + 0.45, dep + 0.15, 0.03); });
  b.withTint(E.snowTint, () => b.box('render_white', u0, y + 0.45, 0.2, u1, y + 0.56, dep, PY | PX | NX));
  b.cylinder('light_warm', (u0 + u1) / 2, y - 0.02, dep / 2, 0.1, 0.012, 12, { top: false, bottom: true });
  b.withTint([0.88, 0.88, 0.88], () => b.cbox('concrete', u0, D.ffl - 0.45, 0, u1, D.ffl, dep + 7, 0.02, false));
  for (const du of [-0.9, 0.9]) b.withTint([0.32, 0.31, 0.31], () => b.box('concrete', (u0 + u1) / 2 + du - 0.28, D.ffl, dep, (u0 + u1) / 2 + du + 0.28, D.ffl + 0.004, dep + 7, PY));
  if (b.collecting) b.colQuad(u0, D.ffl, dep + 7, u1, D.ffl, dep + 7, u1, D.ffl, 0, u0, D.ffl, 0);
  b.pop();
}

/** Halt platform along the back facade: platform slab with edge + tactile strip, canopy on columns. */
function haltPlatform(ctx, D) {
  const b = ctx.b, s = ctx.spec;
  const L = D.w;
  const pl = Math.min(L + 20, s._meta.platformLength || L);
  b.push(); K.facadeFrame(b, 'back', D.w, D.d, 0);
  const u0 = L / 2 - pl / 2, u1 = L / 2 + pl / 2, dep = 4.5, yP = D.ffl;
  b.withTint([0.9, 0.89, 0.86], () => b.cbox('paving', u0, yP - 1.1, 0, u1, yP, dep, 0.02, false));
  b.box('steel_yellow', u0, yP, dep - 0.7, u1, yP + 0.005, dep - 0.45, PY);
  b.box('concrete_smooth', u0, yP - 0.15, dep - 0.05, u1, yP + 0.02, dep + 0.08, ALL);
  if (b.collecting) b.colQuad(u0, yP, dep, u1, yP, dep, u1, yP, 0, u0, yP, 0);
  b.withTint([0.95, 0.95, 0.96], () => b.cbox('panel_white', u0 + 0.5, yP + 3.4, -0.05, u1 - 0.5, yP + 3.8, dep - 0.6, 0.03));
  for (let u = u0 + 1.5; u < u1 - 1; u += 6) { b.cbox('steel', u - 0.12, yP, 0.8, u + 0.12, yP + 3.4, 1.04, 0.01, false); b.cylinder('light_warm', u + 3, yP + 3.39, dep * 0.4, 0.12, 0.01, 12, { top: false, bottom: true }); }
  yellowRail(b, [[u0 + 0.1, yP, 0.1], [u0 + 0.1, yP, dep - 0.8]]);
  yellowRail(b, [[u1 - 0.1, yP, dep - 0.8], [u1 - 0.1, yP, 0.1]]);
  b.pop();
}

function massing(spec, ctx) {
  const D = dims(ctx);
  const s = ctx.spec;
  // polar vehicle halls carry the same barrel vault as the exterior LOD (buildHall vault: axis along the longer side)
  if (D.vault) massVault(ctx.b, -D.w / 2, D.w / 2, -D.d / 2, D.d / 2, D.top, Math.min(Math.min(D.w, D.d) * 0.16, 3.6), [0.84, 0.86, 0.88]);
  return [massVol(-D.w / 2, D.w / 2, -D.d / 2, D.d / 2, Math.min(0, s._ground.min) - 0.5, D.top, { parapet: D.vault ? 0 : 1.0, floorH: D.H, groundH: D.top + 1, roofColor: D.E.polar ? [0.84, 0.86, 0.88] : [0.6, 0.6, 0.6] })];
}

export default { name: 'service_depot', uses: ['service_depot'], generate, massing };
