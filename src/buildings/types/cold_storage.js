// 冷藏间 — O-zone cold store beside the farm station yard (§1 自然交接: 仓库、冷藏间和工务宿舍沿站场布置).
// OWNER: buildings-o.
//
// Plan first: produce arrives by truck on the loading side (spec 'loading' entrances, meta.loadingSide):
// a raised dock (floor at truck-bed height 1.2 m) runs along that side under a deep canopy; each bay has a
// sectional door with a black dock shelter, leveller lip, rubber bumpers and wheel guides on the apron.
// Behind the dock doors an ante-room corridor (cold lock) leads to the insulated cold rooms with pallet
// racking. The staff door (spec 'main') on the street front climbs to the dock level into a two-storey
// office / plant corner (windows on both storeys). The shell is a windowless insulated panel box with
// vertical joints, a grey fascia + kick band; the refrigeration plant sits on the roof (condenser rows,
// pipe rack, access ladder + hatch). Climate: dust lee (dry), snow (polar), algae (wet). 'full': cold
// rooms + racks + ante-room partitions, office slab, colliders.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, oEnv, drift, utilAnchors, massVol, lampPost, cagedLadder } from './o_common.js';
import { buildHall, rack, partition, consoleDesk, chairSimple, doorSpans } from './o_hall.js';
import { dedupeOps } from './o_block.js';
import { loadingDoors, officeFront, dockFront, sideCanopy, laneMarks, condenserRow } from './o_shed.js';

function dims(ctx) {
  const s = ctx.spec, E = oEnv(ctx);
  E.shell = 'panel_insulated';
  const w = s._w, d = s._d;
  const ffl = 1.2;                         // dock height
  const H = Math.max(6, Math.min(11, s._fh || 9));
  return { E, w, d, ffl, H, top: ffl + H - 1.0 };
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const D = dims(ctx);
  const { E, w, d, ffl, top } = D;
  const m = s._meta || {};
  const rng = ctx.sub(2101);
  const L = (side) => (isFB(side) ? w : d);
  const ops = { front: [], right: [], back: [], left: [] };
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: w * 0.35 };
  const M = mainE.side;
  const loadE = s._entrances.find((e) => e.kind === 'loading');
  let V = SIDES.includes(m.loadingSide) ? m.loadingSide : loadE ? loadE.side : 'right';
  if (V === M) V = isFB(M) ? 'right' : 'front';
  const LV = L(V);
  const dw = 3.0, dh = 3.2;
  const us = loadingDoors(s, V, LV, Math.max(2, Math.floor(LV / 9)), dw, { extra: Math.max(2, Math.min(5, Math.floor((LV - 6) / 7))), margin: 3 });
  const doors = us.map((u) => ({ u0: u - dw / 2, u1: u + dw / 2, v0: ffl, v1: ffl + dh, kind: 'roller', open: rng.next() < 0.2 ? 0.8 : 0, apron: false }));
  ops[V].push(...doors);
  const LM = L(M);
  const du = Math.max(1.6, Math.min(LM - 1.6, LM / 2 + (M === 'back' || M === 'left' ? -1 : 1) * (mainE.offset || 0)));
  const office = officeFront(ctx, ops, M, w, d, ffl, du, { levels: [ffl, ffl + 3.6], span: Math.min(11, LM * 0.3) });
  // few high vents on the other walls
  for (const side of SIDES) if (side !== V && side !== M) { const Ls = L(side); for (const u of [Ls * 0.25, Ls * 0.75]) ops[side].push({ u0: u - 0.6, u1: u + 0.6, v0: top - 2.0, v1: top - 1.2, kind: 'louvre' }); }
  for (const side of SIDES) ops[side] = dedupeOps(ops[side]);
  // ---- shell ----
  const Hh = buildHall(ctx, { env: E, ffl, top, T: 0.36, ops, roof: { kind: 'flat', dp: OPP[V] }, ceiling: 'beams', parapet: 1.0, walls: [], slabs: [], stairs: [], plinthSkip: {} });
  const I = Hh.inner;
  // vertical panel joints (insulated sandwich panels 1.2 m) on the long blank walls
  b.withTint([0.8, 0.81, 0.82], () => {
    for (const side of SIDES) {
      if (side === M) continue;
      const Ls = L(side);
      b.push(); K.facadeFrame(b, side, w, d, 0);
      for (let u = 1.2; u < Ls - 0.6; u += 1.2) { if (ops[side].some((o) => u > o.u0 - 0.15 && u < o.u1 + 0.15)) continue; b.box('panel_grey', u - 0.012, ffl + 0.5, 0.0, u + 0.012, top + 0.4, 0.012, PZ | PX | NX); }
      b.pop();
    }
  });
  // ---- dock: raised platform along V under a canopy, steps at the end, apron + lane marks ----
  {
    const [g0, g1] = K.sideGround(s, V);
    const gy = Math.min(g0, g1);
    b.push(); K.facadeFrame(b, V, w, d, 0);
    const dockD = 2.4;
    const a = 0.3, c = LV - 0.3;
    b.withTint([0.9, 0.89, 0.86], () => b.cbox('concrete', a, gy - 0.4, 0.0, c, ffl, dockD, 0.02, false));
    b.box('steel', a, ffl - 0.08, dockD - 0.06, c, ffl + 0.005, dockD + 0.01, PY | PZ);
    b.withTint([1, 1, 1], () => b.box('steel_yellow', a, ffl, dockD - 0.35, c, ffl + 0.004, dockD - 0.2, PY));
    if (b.collecting) { b.colQuad(a, ffl, dockD, c, ffl, dockD, c, ffl, 0, a, ffl, 0); b.colBox(a, gy, dockD - 0.1, c, ffl, dockD); }
    for (const u of us) { b.push(); b.translate(0, 0, dockD); dockFront(b, u - dw / 2, u + dw / 2, ffl + dh - 0.2, ffl, gy); b.pop(); }
    // steps at one end of the dock
    K.steps(b, { u0: c - 1.6, u1: c - 0.2, z0: dockD, y0: gy, y1: ffl, key: 'stone_step', cheeks: true, rails: false });
    b.tube('steel_yellow', [[c - 0.25, ffl + 1.0, 0.2], [c - 0.25, ffl + 1.0, dockD], [c - 0.25, gy + 1.0, dockD + Math.ceil((ffl - gy) / 0.165) * 0.3]], 0.022, 8);
    yellowEdge(b, a, c, dockD, ffl, us, dw);
    sideCanopy(b, a, c, dockD + 4.5, ffl + dh + 0.9, { gy, colEvery: 8 });
    // truck apron
    const apD = 18;
    b.withTint([0.86, 0.85, 0.83], () => b.cbox('concrete', a - 2, gy - 0.4, dockD, c + 2, gy + 0.02, dockD + apD, 0.02, false));
    if (b.collecting) b.colQuad(a - 2, gy + 0.02, dockD + apD, c + 2, gy + 0.02, dockD + apD, c + 2, gy + 0.02, dockD, a - 2, gy + 0.02, dockD);
    b.push(); b.translate(0, 0, dockD); laneMarks(b, us, gy + 0.025, apD, dw + 0.6); b.pop();
    lampPost(b, a - 1.0, gy, dockD + 5, 8, 0);
    lampPost(b, c + 1.0, gy, dockD + 5, 8, Math.PI);
    b.pop();
  }
  // ---- interior ('full'): ante-room corridor along the dock, cold rooms with racks, office ----
  if (ctx.full) {
    const rot = { front: 0, back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }[V];
    b.push(); b.rotY(rot);
    const hw = (isFB(V) ? I.x1 - I.x0 : I.z1 - I.z0) / 2, hd = (isFB(V) ? I.z1 - I.z0 : I.x1 - I.x0) / 2;
    const zA = hd - 4.0;
    const doorsAt = us.map((u) => ({ at: u - (LV / 2 - hw), w: 1.6 }));
    partition(ctx, { x0: -hw, z0: zA, x1: hw, z1: zA, y0: ffl, y1: top - 0.5, doors: doorsAt.map((x) => ({ ...x, h: 2.6 })), key: 'panel_insulated', t: 0.2, tint: [0.98, 0.98, 0.98] });
    // cold room dividers + racks
    const nRoom = Math.max(1, Math.round((2 * hw) / 14));
    for (let k = 1; k < nRoom; k++) { const x = -hw + (2 * hw * k) / nRoom; partition(ctx, { x0: x, z0: -hd, x1: x, z1: zA, y0: ffl, y1: top - 0.5, doors: [], key: 'panel_insulated', t: 0.2, tint: [0.98, 0.98, 0.98] }); }
    for (let k = 0; k < nRoom; k++) {
      const xa = -hw + (2 * hw * k) / nRoom + 1.2, xb = -hw + (2 * hw * (k + 1)) / nRoom - 1.2;
      for (let z = -hd + 1.0; z < zA - 2.5; z += 3.4) rack(b, (xa + xb) / 2, ffl, z + 0.55, xb - xa, Math.min(6, top - ffl - 1.5), 0, s.hash + k * 17 + Math.round(z));
    }
    b.pop();
    const oc0 = K.facadePoint(M, w, d, office.u0, 0, -0.3), oc1 = K.facadePoint(M, w, d, office.u1, 0, -6);
    const R = { x0: Math.max(I.x0, Math.min(oc0[0], oc1[0])), x1: Math.min(I.x1, Math.max(oc0[0], oc1[0])), z0: Math.max(I.z0, Math.min(oc0[2], oc1[2])), z1: Math.min(I.z1, Math.max(oc0[2], oc1[2])) };
    const yU = ffl + 3.6;
    b.cbox('concrete_smooth', R.x0, yU - 0.25, R.z0, R.x1, yU, R.z1, 0.01);
    if (b.collecting) b.colQuad(R.x0, yU, R.z1, R.x1, yU, R.z1, R.x1, yU, R.z0, R.x0, yU, R.z0);
    consoleDesk(b, (R.x0 + R.x1) / 2, ffl, (R.z0 + R.z1) / 2, 2.2, 0);
    chairSimple(b, (R.x0 + R.x1) / 2, ffl, (R.z0 + R.z1) / 2 - 0.9, 0);
  }
  // ---- roof plant: condenser rows + pipe rack, hatch, ladder down the back ----
  {
    const ri = Hh.inner, yr = top;
    const alongX = ri.x1 - ri.x0 >= ri.z1 - ri.z0;
    if (alongX) { condenserRow(b, ri.x0 + 3, ri.x1 - 3, (ri.z0 + ri.z1) / 2 - 2.5, yr); condenserRow(b, ri.x0 + 3, ri.x0 + (ri.x1 - ri.x0) * 0.55, (ri.z0 + ri.z1) / 2 + 2.5, yr); }
    else { b.push(); b.rotY(Math.PI / 2); condenserRow(b, -ri.z1 + 3, -ri.z0 - 3, (ri.x0 + ri.x1) / 2 - 2.5, yr); b.pop(); }
    K.roofHatch(b, ri.x1 - 1.4, yr, ri.z1 - 1.4, {});
    const bs = OPP[V];
    const p = K.facadePoint(bs, w, d, L(bs) * 0.85, 0, 0);
    const rotL = { front: 0, back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }[bs];
    const [g0, g1] = K.sideGround(s, bs);
    cagedLadder(b, p[0], Math.min(g0, g1) + 2.4, p[2], top + 1.0 - Math.min(g0, g1) - 2.4, rotL);
  }
  // ---- climate ----
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', skip: doorSpans(Hh.opsBySide[E.lee]) });
  if (E.polar) drift(ctx, E.lee, { kind: 'snow', skip: doorSpans(Hh.opsBySide[E.lee]) });
  utilAnchors(ctx, {
    ffl, h: top - ffl, roofY: top + 1, access: [I.x1 - 1.4, top, I.z1 - 1.4],
    floors: [{ level: 0, y: ffl, height: top - ffl }],
    entrances: [{ kind: 'main', side: M, pos: K.facadePoint(M, w, d, du, ffl, 0.6), dir: K.facadeNormal(M), width: 1.2 }, ...us.map((u) => ({ kind: 'loading', side: V, pos: K.facadePoint(V, w, d, u, ffl, 2.6), dir: K.facadeNormal(V), width: dw }))],
    rooms: [{ floor: 0, name: 'cold rooms', kind: 'storage', center: [0, ffl, 0], size: [w, top - ffl, d] }],
    cameras: { dock: { pos: K.facadePoint(V, w, d, LV * 0.15, 1.8, 14), target: K.facadePoint(V, w, d, LV * 0.5, ffl + 1.5, 0) } },
  });
  b.meta.docks = us.length;
}

/** Painted edge / door guide lines on the dock top. */
function yellowEdge(b, a, c, dockD, ffl, us, dw) {
  for (const u of us) { b.box('steel_yellow', u - dw / 2 - 0.08, ffl, 0.05, u - dw / 2, ffl + 0.004, dockD - 0.4, PY); b.box('steel_yellow', u + dw / 2, ffl, 0.05, u + dw / 2 + 0.08, ffl + 0.004, dockD - 0.4, PY); }
  void a; void c;
}

function massing(spec, ctx) {
  const D = dims(ctx);
  const s = ctx.spec;
  return [massVol(-D.w / 2, D.w / 2, -D.d / 2, D.d / 2, Math.min(0, s._ground.min) - 0.5, D.top, { floorH: D.top, groundH: D.top + 2, flags: 1, roofColor: [0.62, 0.62, 0.62] })];
}

export default { name: 'cold_storage', uses: ['cold_storage'], generate, massing };
