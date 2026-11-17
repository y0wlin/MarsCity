// 农产集散站 — O-zone farm produce station where the field road meets the town (§1 让田间路接入农产集散站).
// OWNER: buildings-o.
//
// Plan first: farm trucks pull in under a deep canopy over two loading lanes on the loading side (spec
// 'loading' entrances), unload through roller doors onto the sorting floor; the sorting hall (clerestory
// bands, rooflight strips) holds conveyor sorting lines and crate stacks; the street front (spec 'main')
// has the two-storey office (weighing / dispatch office upstairs with band windows), the entrance canopy
// and a small weigh-house kiosk at the yard gate. Produce crates on pallets wait under the canopy.
// 'full': sorting lines, crate stacks, office slab + stair, colliders.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, oEnv, drift, utilAnchors, massVol, lampPost, cabinet } from './o_common.js';
import { buildHall, consoleDesk, chairSimple, doorSpans } from './o_hall.js';
import { dedupeOps, storeySlabs } from './o_block.js';
import { loadingDoors, officeFront, clerestory, sideCanopy, laneMarks } from './o_shed.js';
import { hash4 } from '../../core/hash.js';

function dims(ctx) {
  const s = ctx.spec, E = oEnv(ctx);
  const w = s._w, d = s._d;
  const ffl = 0.25;
  const fh = Math.max(4, Math.min(5.5, s._fh || 4.5));
  const top = ffl + Math.max(2, s._floors) * fh;
  return { E, w, d, ffl, fh, top };
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const D = dims(ctx);
  const { E, w, d, ffl, fh, top } = D;
  const rng = ctx.sub(2201);
  const L = (side) => (isFB(side) ? w : d);
  const ops = { front: [], right: [], back: [], left: [] };
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: -w * 0.3 };
  const M = mainE.side;
  const loadE = s._entrances.find((e) => e.kind === 'loading');
  let V = loadE ? loadE.side : 'right';
  if (V === M) V = isFB(M) ? 'right' : 'front';
  const LV = L(V);
  const dw = 4.2, dh = Math.min(4.6, top - ffl - 1.5);
  const us = loadingDoors(s, V, LV, 2, dw, { margin: 2 });
  ops[V].push(...us.map((u) => ({ u0: u - dw / 2, u1: u + dw / 2, v0: ffl, v1: ffl + dh, kind: 'roller', open: rng.next() < 0.5 ? 0.85 : 0, apron: false })));
  const LM = L(M);
  const du = Math.max(1.6, Math.min(LM - 1.6, LM / 2 + (M === 'back' || M === 'left' ? -1 : 1) * (mainE.offset || 0)));
  const office = officeFront(ctx, ops, M, w, d, ffl, du, { levels: [ffl, ffl + fh], span: Math.min(14, LM * 0.48) });
  for (const side of SIDES) {
    const avoid = side === M ? [[office.u0, office.u1]] : [];
    clerestory(ctx, ops, side, w, d, top - 2.2, top - 0.7, { avoid, every: 4.5, width: 3.2 });
    if (side !== M && side !== V) ops[side].push({ u0: L(side) / 2 - 0.5, u1: L(side) / 2 + 0.5, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service', entry: true });
  }
  for (const side of SIDES) ops[side] = dedupeOps(ops[side]);
  const Hh = buildHall(ctx, { env: E, ffl, top, T: E.wallT, ops, roof: { kind: 'flat', dp: OPP[M] }, ceiling: 'beams', parapet: 0.9, band: ffl + fh, walls: [], slabs: [], stairs: [] });
  const I = Hh.inner;
  // ---- loading canopy over two lanes + crates + lane marks ----
  {
    const [g0, g1] = K.sideGround(s, V);
    const gy = Math.min(g0, g1);
    b.push(); K.facadeFrame(b, V, w, d, 0);
    const dep = 9.5;
    // apron under + in front of the canopy
    b.withTint([0.86, 0.85, 0.83], () => b.cbox('concrete', -1.5, gy - 0.4, 0.0, LV + 1.5, gy + 0.03, dep + 12, 0.02, false));
    if (b.collecting) b.colQuad(-1.5, gy + 0.03, dep + 12, LV + 1.5, gy + 0.03, dep + 12, LV + 1.5, gy + 0.03, 0, -1.5, gy + 0.03, 0);
    if (ffl > gy + 0.05) for (const u of us) { b.sweep('concrete_smooth', [[u - dw / 2 - 0.3, 0, 0], [u + dw / 2 + 0.3, 0, 0]], [[0, gy - 0.2], [Math.max(1.2, (ffl - gy) * 10), gy - 0.2], [Math.max(1.2, (ffl - gy) * 10), gy + 0.03], [0, ffl]], { smoothAngle: 5 }); }
    sideCanopy(b, 0.0, LV, dep, Math.max(ffl + dh + 0.8, 5.6), { gy, colEvery: 9, key: 'panel_white', tint: E.shellTint });
    laneMarks(b, us, gy + 0.035, dep + 10, dw + 0.8);
    // crate stacks on pallets beside the doors
    const cr = ctx.sub(2202);
    for (const u of us) {
      for (const side of [-1, 1]) {
        const cu = u + side * (dw / 2 + 1.4);
        if (cu < 1 || cu > LV - 1) continue;
        b.cbox('wood', cu - 0.6, gy + 0.03, 0.6, cu + 0.6, gy + 0.17, 1.6, 0.01, false);
        const nk = 2 + Math.floor(cr.next() * 4);
        for (let k = 0; k < nk; k++) { const h = hash4(s.hash, Math.round(cu * 10), k, 5); b.withTint((h & 3) === 0 ? [0.85, 0.5, 0.18] : (h & 3) === 1 ? [0.3, 0.55, 0.35] : [0.75, 0.2, 0.15], () => b.cbox('plastic_bin', cu - 0.55, gy + 0.17 + k * 0.3, 0.65, cu + 0.55, gy + 0.45 + k * 0.3, 1.55, 0.02)); }
        if (b.collecting) b.colBox(cu - 0.6, gy, 0.6, cu + 0.6, gy + 0.2 + nk * 0.3, 1.6);
      }
    }
    // weigh-house kiosk at the yard entry + barrier arm
    const ku = LV + 0.5, kz = dep + 6;
    b.withTint(E.shellTint, () => b.cbox('panel_white', ku - 1.2, gy, kz - 1.0, ku + 1.2, gy + 2.6, kz + 1.0, 0.03));
    b.withTint(E.trimTint, () => b.cbox('panel_grey', ku - 1.35, gy + 2.6, kz - 1.15, ku + 1.35, gy + 2.85, kz + 1.15, 0.02));
    b.quad('glass_window', ku - 1.21, gy + 1.0, kz + 0.7, ku - 1.21, gy + 1.0, kz - 0.7, ku - 1.21, gy + 2.2, kz - 0.7, ku - 1.21, gy + 2.2, kz + 0.7);
    b.cylinder('steel', ku - 1.8, gy, kz - 1.6, 0.12, 1.0, 10, { top: true });
    b.withTint([1, 1, 1], () => b.box('steel_yellow', ku - 1.85, gy + 0.9, kz - 1.6 - 0.05, ku - 1.85 + 0.1, gy + 1.0, kz - 1.6 + 6.0, ALL));
    b.withTint([0.6, 0.6, 0.62], () => b.box('steel', -0.5, gy + 0.03, kz - 1.6, LV - 1.5, gy + 0.08, kz + 1.6, PY | PZ | NZ | PX | NX));   // weighbridge deck
    if (b.collecting) b.colBox(ku - 1.2, gy, kz - 1.0, ku + 1.2, gy + 2.6, kz + 1.0);
    lampPost(b, -1.0, gy, dep + 2, 7, 0);
    b.pop();
  }
  // ---- interior ('full'): sorting lines, crate stacks, office slab + stair ----
  if (ctx.full) {
    const rot = { front: 0, back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }[V];
    b.push(); b.rotY(rot);
    const hw = (isFB(V) ? I.x1 - I.x0 : I.z1 - I.z0) / 2, hd = (isFB(V) ? I.z1 - I.z0 : I.x1 - I.x0) / 2;
    for (let k = 0; k < 2; k++) {
      const z = hd - 6 - k * 4.5;
      if (z < -hd + 2) continue;
      // conveyor: frame + belt + side guides + legs, sorting stations
      b.box('steel', -hw + 3, ffl + 0.85, z - 0.45, hw - 3, ffl + 0.95, z + 0.45, ALL);
      b.box('rubber', -hw + 3, ffl + 0.95, z - 0.4, hw - 3, ffl + 0.97, z + 0.4, PY);
      for (const sz of [-0.48, 0.48]) b.box('steel_brushed', -hw + 3, ffl + 0.95, z + sz - 0.02, hw - 3, ffl + 1.12, z + sz + 0.02, ALL);
      for (let x = -hw + 3.5; x < hw - 3; x += 2.2) for (const sz of [-0.4, 0.4]) b.box('steel', x - 0.03, ffl, z + sz - 0.03, x + 0.03, ffl + 0.85, z + sz + 0.03, PX | NX | PZ | NZ);
      for (let x = -hw + 4.5; x < hw - 4; x += 3.0) { b.withTint([0.25, 0.55, 0.35], () => b.cbox('plastic_bin', x - 0.3, ffl + 0.97, z - 0.25, x + 0.3, ffl + 1.25, z + 0.25, 0.02)); }
      if (b.collecting) b.colBox(-hw + 3, ffl, z - 0.5, hw - 3, ffl + 1.1, z + 0.5);
    }
    for (let k = 0; k < 6; k++) {
      const x = -hw + 2 + k * 2.0, z = -hd + 1.6;
      b.cbox('wood', x - 0.6, ffl, z - 0.5, x + 0.6, ffl + 0.14, z + 0.5, 0.01, false);
      for (let j = 0; j < 4; j++) b.withTint(j % 2 ? [0.85, 0.5, 0.18] : [0.3, 0.55, 0.35], () => b.cbox('plastic_bin', x - 0.55, ffl + 0.14 + j * 0.3, z - 0.45, x + 0.55, ffl + 0.42 + j * 0.3, z + 0.45, 0.02));
      if (b.collecting) b.colBox(x - 0.6, ffl, z - 0.5, x + 0.6, ffl + 1.35, z + 0.5);
    }
    b.pop();
    const oc0 = K.facadePoint(M, w, d, office.u0, 0, -0.3), oc1 = K.facadePoint(M, w, d, office.u1, 0, -6.5);
    const R = { x0: Math.max(I.x0, Math.min(oc0[0], oc1[0])), x1: Math.min(I.x1, Math.max(oc0[0], oc1[0])), z0: Math.max(I.z0, Math.min(oc0[2], oc1[2])), z1: Math.min(I.z1, Math.max(oc0[2], oc1[2])) };
    storeySlabs(ctx, R, [{ y: ffl, h: fh }, { y: ffl + fh, h: fh }], { x0: R.x0 + 0.3, z: (R.z0 + R.z1) / 2, dir: 1, W: 1.1 });
    consoleDesk(b, R.x1 - 2, ffl + fh, (R.z0 + R.z1) / 2, 2.4, 0);
    chairSimple(b, R.x1 - 2, ffl + fh, (R.z0 + R.z1) / 2 - 0.9, 0);
  }
  // ---- roof ----
  {
    const ri = Hh.inner;
    const alongX = ri.x1 - ri.x0 >= ri.z1 - ri.z0;
    for (let k = 1; k <= 2; k++) { const t = k / 3; if (alongX) { const z = ri.z0 + (ri.z1 - ri.z0) * t; K.skylight(b, { x0: ri.x0 + 2, x1: ri.x1 - 2, z0: z - 0.7, z1: z + 0.7 }, top, {}); } else { const x = ri.x0 + (ri.x1 - ri.x0) * t; K.skylight(b, { x0: x - 0.7, x1: x + 0.7, z0: ri.z0 + 2, z1: ri.z1 - 2 }, top, {}); } }
    K.hvacUnit(b, ri.x0 + 2.0, top, ri.z0 + 1.2, 0, { w: 2.2, d: 1.1, h: 1.1 });
    K.roofHatch(b, ri.x1 - 1.4, top, ri.z0 + 1.4, {});
    if (rng.next() < 0.6) K.solarArray(b, { x0: ri.x0 + 1.5, x1: ri.x0 + Math.min(14, (ri.x1 - ri.x0) * 0.45), z0: ri.z1 - 5.5, z1: ri.z1 - 1.2 }, top, { tilt: 0.25 });
  }
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', skip: doorSpans(Hh.opsBySide[E.lee]) });
  if (E.polar) drift(ctx, E.lee, { kind: 'snow', skip: doorSpans(Hh.opsBySide[E.lee]) });
  utilAnchors(ctx, {
    ffl, h: fh, roofY: top + 0.9, access: [I.x1 - 1.4, top, I.z0 + 1.4],
    floors: [{ level: 0, y: ffl, height: fh }, { level: 1, y: ffl + fh, height: fh }],
    entrances: [{ kind: 'main', side: M, pos: K.facadePoint(M, w, d, du, ffl, 0.6), dir: K.facadeNormal(M), width: 1.2 }, ...us.map((u) => ({ kind: 'loading', side: V, pos: K.facadePoint(V, w, d, u, ffl, 0.6), dir: K.facadeNormal(V), width: dw }))],
    rooms: [{ floor: 0, name: 'sorting hall', kind: 'hall', center: [0, ffl, 0], size: [w, top - ffl, d] }, { floor: 1, name: 'dispatch office', kind: 'office', center: K.facadePoint(M, w, d, (office.u0 + office.u1) / 2, ffl + fh, -3), size: [office.u1 - office.u0, fh, 6] }],
    cameras: { canopy: { pos: K.facadePoint(V, w, d, LV * 0.1, 1.8, 16), target: K.facadePoint(V, w, d, LV * 0.55, 3, 2) } },
  });
}

function massing(spec, ctx) {
  const D = dims(ctx);
  const s = ctx.spec, b = ctx.b;
  const loadE = s._entrances.find((e) => e.kind === 'loading');
  const V = loadE ? loadE.side : 'right';
  b.push(); K.facadeFrame(b, V, D.w, D.d, 0);
  const LV = isFB(V) ? D.w : D.d;
  b.pushTint([0.88, 0.88, 0.86]); b.box('mass_roof', 0, 5.6, -0.05, LV, 6.15, 9.5, ALL); b.popTint();
  b.pop();
  return [massVol(-D.w / 2, D.w / 2, -D.d / 2, D.d / 2, Math.min(0, s._ground.min) - 0.5, D.top, { floorH: D.fh, groundH: D.ffl + D.fh, roofColor: [0.55, 0.53, 0.5] })];
}

export default { name: 'farm_station', uses: ['farm_station'], generate, massing };
