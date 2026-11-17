// O-zone pump stations (buildings-o helper): canal pump house (泵房), greenhouse feeder pump room,
// utility pump hall and the OX4 meltwater pump hall (融水泵房). Shared by pumphouse.js and meltwater_pump.js.
//
// Plan first (§1 生成可使用的普通建筑):
//  * the crane hall (pump floor) stands against the pool (meta.poolSide / intakeSide, default back) — or the
//    back of the lot for utility halls — and a lower annex (duty room, switchgear, WC) runs along the street
//    side, so the silhouette reads hall + annex from every side; the hall wall above the annex roof carries
//    clerestory windows;
//  * the intake chamber with trash racks, stop-log guides and a hoist portal sits on the pool; suction pipes
//    pass LOW through the pool wall into the hall;
//  * the maintenance door (spec 'service' / 'equipment', roller shutter) opens straight onto the crane-served
//    lifting floor; a yellow monorail hoist beam leaves the hall above the door and reaches over a hatched
//    lifting square on the loading apron / turning area outside (检修门通到设备吊装面);
//  * the control room is raised on a mezzanine against the pool wall and pushes out as a glazed bay over the
//    intake yard (抬高的控制室能看见闸池);
//  * the high windows' sills sit above the discharge header and pipe runs (高窗的窗台避开设备管线);
//  * air intakes are louvres low on the street / end walls (泵房进风) and extract fans sit on the roof;
//  * outside: delivery main with valves, a white surge vessel, a valve chamber, transformer kiosk, lamps,
//    caged roof ladders; polar halls get the insulated shell, heat-traced pipes and a vestibule (门斗).

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, oEnv, roomMap, yellowRail, grating, pipeRun, valve, lampPost, cabinet, drift, waterInfo, utilAnchors, massVol, massBox, cagedLadder, rectFrame, splitRect, rectStartU, rectLen, glazedBay, hoistBeam, siteWorks, steelStair } from './o_common.js';
import { buildHall, consoleDesk, chairSimple, workbench, railSimple, partition, doorSpans, stairStraight } from './o_hall.js';

/** Which variant a spec is. */
export function pumpVariant(s, melt) {
  const m = s._meta || {};
  if (melt) return m.serves === 'greenhouses' && !m.intakeSide ? 'feeder' : 'melt';
  if (m.serves === 'greenhouses') return 'feeder';
  // specs.js stamps poolSide='back' on every pump house; only a canal id / explicit water data means a pool
  if ((m.canalId !== undefined && m.canalId !== null && m.canalId !== '') || m.canal || m.water) return 'canal';
  return 'utility';
}

const ROT_OF = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

/** Building side whose facade is the +x end of the pump frame. */
function endSidePlus(rot) {
  if (Math.abs(rot) < 1e-6) return 'right';
  if (Math.abs(rot - Math.PI) < 1e-6) return 'left';
  return rot > 0 ? 'back' : 'front';
}

/** Layout shared by generate + massing (deterministic, cheap). */
export function pumpLayout(ctx, melt) {
  const s = ctx.spec;
  const E = oEnv(ctx);
  if (melt) { E.polar = true; E.dry = false; E.wet = false; E.shell = 'panel_insulated'; E.wallT = 0.46; E.reveal = 0.3; E.ffl = Math.max(0.45, E.ffl); E.shellTint = [0.99, 1.0, 1.02]; E.roofKey = 'roof_metal'; }
  const variant = pumpVariant(s, melt);
  const hasPool = variant === 'canal' || variant === 'melt';
  const W = waterInfo(ctx);
  const P = hasPool ? W.side : null;
  const w = s._w, d = s._d;
  const fh = Math.max(4.2, s._fh || 4.5);
  const ffl = E.ffl;
  // fix 2 (QA-ID-04): the storey table follows the spec — a 1-storey spec is a compact single-height pump room (no
  // raised control room: that needs two storeys), 2+ storeys = hall with the raised control room at groundFloorHeight
  const nF = Math.max(1, s._floors || 1);
  const gfh = Math.max(3.6, Math.min(6, s._gh || Math.min(fh, 4.6)));
  const small = variant === 'feeder' || Math.min(w, d) < 11 || nF < 2;
  const top = ffl + (small ? Math.max(4.4, Math.min(5.2, fh)) : gfh + (nF - 1) * fh);
  const svcE = s._entrances.find((e) => e.kind === 'service' || e.kind === 'equipment' || e.kind === 'loading');
  let S = svcE ? svcE.side : 'right';
  if (S === P) S = OPP[P] === 'front' ? 'right' : OPP[P];
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: 0 };
  const M = mainE.side === P || mainE.side === S ? SIDES.find((x) => x !== P && x !== S) : mainE.side;
  const back = P || OPP[M];
  const Dm = isFB(M) ? d : w;
  const annex = !small && back === OPP[M] && S !== M && Dm >= 11;
  const aD = annex ? Math.max(3.6, Math.min(5.0, Dm * 0.3)) : 0;
  const fp = { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 };
  const sp = annex ? splitRect(fp, M, aD) : null;
  const annexTop = ffl + Math.min(4.6, Math.max(3.9, fh * 0.95));
  return { E, variant, hasPool, W, P, w, d, fh, ffl, small, top, S, M, mainE, svcE, back, annex, aD, fp, hallR: annex ? sp.rest : fp, annexR: annex ? sp.strip : null, annexTop, rot: ROT_OF[back], gfh };
}

export function generatePump(ctx, melt = false) {
  const b = ctx.b, s = ctx.spec;
  const G = pumpLayout(ctx, melt);
  const { E, variant, hasPool, W, P, w, d, fh, ffl, small, top, S, M, mainE, svcE, annex, aD, hallR, annexR, annexTop, rot } = G;
  const T = E.wallT;
  const rng = ctx.sub(1301);
  const L = (side) => (isFB(side) ? w : d);
  const ops = { front: [], right: [], back: [], left: [] };          // footprint facade u
  const hw = isFB(G.back) ? w / 2 : d / 2, hd = isFB(G.back) ? d / 2 : w / 2;   // pump frame half extents
  const hz1 = hd - aD;                                                 // hall front line (pump frame z)
  const hallD = hz1 + hd;
  // control room end (pump frame ±x), away from the service door
  const plusEnd = endSidePlus(rot);
  const cSign = (plusEnd === S) ? -1 : 1;
  const cw = small ? 0 : Math.min(6.5, Math.max(4.2, hw * 2 * 0.32));    // control room length along the pool wall
  const cd = small ? 0 : Math.min(4.2, hallD * 0.4);                      // depth from the pool wall
  const ySlab = ffl + G.gfh;
  const bayTop = Math.min(top + 0.4, ySlab + 3.35);
  // ---- openings (footprint u) ----
  const hiSill = small ? ffl + 2.7 : ffl + 5.3, hiHead = top - (small ? 0.55 : 0.8);
  const roomHall = (side) => ({ y: ffl, h: top - ffl - 0.4, depth: hallD - 2 * T, kind: 'plant', floor: 0, u0: 0, u1: L(side) });
  const highBand = (side, avoid = []) => {
    const Ls = L(side);
    const n = Math.max(1, Math.floor((Ls - 2) / 3.6));
    for (let i = 0; i < n; i++) {
      const c = 1 + (Ls - 2) * (i + 0.5) / n, hw2 = Math.min(1.25, (Ls - 2) / n / 2 - 0.35);
      if (hw2 < 0.4) continue;
      if (avoid.some(([a, e]) => c + hw2 > a - 0.3 && c - hw2 < e + 0.3)) continue;
      const o = { u0: c - hw2, u1: c + hw2, v0: hiSill, v1: hiHead, kind: 'win', type: 'fixed', cols: 2 };
      o.room = roomMap(ctx, side, w, d, o, roomHall(side));
      ops[side].push(o);
    }
  };
  // pool side: glazed control bay (upper level, opening behind it) + high band; ground-floor door to the deck
  let ctlU = null;
  if (P && !small) {
    const x0 = cSign > 0 ? hw - T - cw : -hw + T, x1 = x0 + cw;
    ctlU = [hw - x1, hw - x0];
    const o = { u0: ctlU[0] + 0.35, u1: ctlU[1] - 0.35, v0: ySlab + 0.05, v1: bayTop - 0.55, kind: 'blank' };
    o.room = roomMap(ctx, P, w, d, o, { y: ySlab, h: 3.0, depth: cd, kind: 'office', floor: 1, u0: ctlU[0], u1: ctlU[1] });
    ops[P].push(o);
    highBand(P, [ctlU]);
  } else if (P) highBand(P);
  let poolDoor = null;
  if (P) {
    const LP = L(P);
    const be = s._entrances.find((e) => e.side === P && (e.kind === 'maintenance' || e.kind === 'back'));
    let u = be ? LP / 2 + (P === 'back' || P === 'left' ? -1 : 1) * (be.offset || 0) : (ctlU ? (ctlU[0] > LP / 2 ? ctlU[0] - 1.6 : ctlU[1] + 1.6) : LP * 0.25);
    u = Math.max(1.4, Math.min(LP - 1.4, u));
    if (ctlU && u > ctlU[0] - 0.9 && u < ctlU[1] + 0.9) u = ctlU[0] > LP / 2 ? ctlU[0] - 1.4 : ctlU[1] + 1.4;
    u = Math.max(1.4, Math.min(LP - 1.4, u));
    poolDoor = { u0: u - 0.5, u1: u + 0.5, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service', entry: true, canopy: true };
    ops[P].push(poolDoor);
  }
  // service side: roller door onto the lifting floor (inside the hall part of that facade)
  const LS = L(S);
  const hs0 = rectStartU(S, w, d, hallR), hsL = rectLen(S, hallR);
  const rdW = Math.min(svcE && svcE.width > 2.5 ? Math.min(4.2, svcE.width) : 3.6, hsL - 2.2);
  const rdH = small ? Math.min(3.0, top - ffl - 0.9) : Math.min(4.2, top - ffl - 2.6);
  let rc = LS / 2 + (svcE && svcE.side === S ? (S === 'back' || S === 'left' ? -1 : 1) * (svcE.offset || 0) : 0);
  rc = Math.max(hs0 + rdW / 2 + 1.0, Math.min(hs0 + hsL - rdW / 2 - 1.0, rc));
  const roller = { u0: rc - rdW / 2, u1: rc + rdW / 2, v0: ffl, v1: ffl + rdH, kind: 'roller', open: (rng.next() < 0.25 ? 0.62 : 0), apron: { depth: small ? 6 : 10, ext: 2.2 } };
  ops[S].push(roller);
  highBand(S, [[roller.u0 - 0.6, roller.u1 + 0.6]]);
  // street side (annex front): personnel door with canopy + steps, duty-room windows, low louvres (air intake)
  const LM = L(M);
  const dCenter = Math.max(1.6, Math.min(LM - 1.6, LM / 2 + (mainE.side === M ? (M === 'back' || M === 'left' ? -1 : 1) * (mainE.offset || 0) : -LM * 0.25)));
  const door = { u0: dCenter - 0.55, u1: dCenter + 0.55, v0: ffl, v1: ffl + 2.25, kind: 'door', doorKind: melt ? 'glazed' : 'service', entry: !melt, plate: true };
  ops[M].push(door);
  for (const u of [dCenter - 2.6, dCenter + 2.6]) if (u > 1.2 && u < LM - 1.2) ops[M].push({ u0: u - 0.7, u1: u + 0.7, v0: ffl + 0.45, v1: ffl + 1.65, kind: 'louvre' });
  if (!small) {
    for (const u of [dCenter + 4.6, dCenter - 4.6, dCenter + 7.6]) if (u > 1.4 && u < LM - 1.4) { const o = { u0: u - 0.75, u1: u + 0.75, v0: ffl + 0.95, v1: ffl + 2.35, kind: 'win', type: 'casement' }; o.room = roomMap(ctx, M, w, d, o, { y: ffl, h: 3.2, depth: Math.max(2.5, aD - 0.6), kind: 'office', floor: 0 }); ops[M].push(o); }
    if (!annex) highBand(M, []);
  }
  // remaining end wall(s): louvres low + high band (+ annex window on the end wall of the annex)
  for (const side of SIDES) {
    if (side === P || side === S || side === M) continue;
    const Ls = L(side);
    if (annex) {
      const h0 = rectStartU(side, w, d, hallR), hL = rectLen(side, hallR);
      ops[side].push({ u0: h0 + hL / 2 - 0.9, u1: h0 + hL / 2 + 0.9, v0: ffl + 0.45, v1: ffl + 1.65, kind: 'louvre' });
      const a0 = rectStartU(side, w, d, annexR), aL = rectLen(side, annexR);
      if (aL > 3) { const o = { u0: a0 + aL / 2 - 0.6, u1: a0 + aL / 2 + 0.6, v0: ffl + 1.0, v1: ffl + 2.2, kind: 'win', type: 'casement' }; o.room = roomMap(ctx, side, w, d, o, { y: ffl, h: 3.2, depth: 3, kind: 'office', floor: 0 }); ops[side].push(o); }
    } else if (!ops[side].some((o) => o.kind === 'louvre')) ops[side].push({ u0: Ls / 2 - 0.9, u1: Ls / 2 + 0.9, v0: ffl + 0.5, v1: ffl + 1.7, kind: 'louvre' });
    highBand(side, ops[side].map((o) => [o.u0, o.u1]));
  }
  for (const side of SIDES) ops[side] = dedupeOps(ops[side]);
  // ---- distribute the openings onto the hall / annex walls (rect-local u) ----
  const opsH = { front: [], right: [], back: [], left: [] }, opsA = { front: [], right: [], back: [], left: [] };
  const AT = annexTop + 0.6;
  for (const side of SIDES) {
    for (const o of ops[side]) {
      const targets = annex ? [[hallR, opsH, top + 0.9, side === M], [annexR, opsA, AT, side === OPP[M]]] : [[hallR, opsH, top + 0.9, false]];
      for (const [R, dst, yTop, internal] of targets) {
        if (internal) continue;
        const s0 = rectStartU(side, w, d, R), Ls = rectLen(side, R);
        const u0 = o.u0 - s0, u1 = o.u1 - s0;
        if (u0 >= 0.3 && u1 <= Ls - 0.3 && o.v1 <= yTop - 0.35) { dst[side].push({ ...o, u0, u1 }); break; }
      }
    }
  }
  // hall wall facing the annex: clerestory above the annex roof + the internal door into the annex
  let innerDoor = null;
  if (annex) {
    const Lh = rectLen(M, hallR);
    const v0 = AT + 0.45, v1 = top - 0.75;
    if (v1 - v0 > 0.8) {
      const n = Math.max(1, Math.floor((Lh - 2) / 3.6));
      for (let i = 0; i < n; i++) {
        const c = 1 + (Lh - 2) * (i + 0.5) / n;
        const o = { u0: c - 1.15, u1: c + 1.15, v0, v1, kind: 'win', type: 'fixed', cols: 2 };
        o.room = roomMap(ctx, M, w, d, o, { y: ffl, h: top - ffl - 0.4, depth: hallD - 2 * T, kind: 'plant', floor: 0, u0: c - 1.8, u1: c + 1.8 });
        opsH[M].push(o);
      }
    }
    const du = Math.max(1.2, Math.min(Lh - 1.2, dCenter + (dCenter < Lh / 2 ? 2.4 : -2.4)));
    innerDoor = { u0: du - 0.5, u1: du + 0.5, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service', open: ctx.full ? 0.85 : 0 };
    opsH[M].push(innerDoor);
    // the annex has no wall of its own there: keep its collider gap at the same door (annex side u is mirrored)
    const La = rectLen(OPP[M], annexR);
    opsA[OPP[M]].push({ ...innerDoor, u0: La - innerDoor.u1, u1: La - innerDoor.u0 });
  }
  // ---- hall shell ----
  const H = buildHall(ctx, { R: hallR, env: E, ffl, top, T, ops: opsH, roof: { kind: 'flat', dp: P || S }, slabs: [], walls: [], stairs: [], ceiling: 'beams', parapet: 0.9, lights: null });
  let A = null;
  if (annex) {
    const walls = [];
    if (ctx.full) {
      // duty room | switchgear room partition across the annex (pump frame → building via the M-side frame)
      const Lm = rectLen(M, annexR);
      const up = dCenter < Lm / 2 ? Math.min(Lm - 2, dCenter + 3.4) : Math.max(2, dCenter - 3.4);
      const pA = K.facadePoint(M, w, d, up, 0, 0), pB = K.facadePoint(M, w, d, up, 0, -aD);
      walls.push({ x0: pA[0], z0: pA[2], x1: pB[0], z1: pB[2], y0: ffl, y1: annexTop - 0.3, doors: [{ at: aD * 0.5, w: 0.95 }] });
    }
    A = buildHall(ctx, { R: annexR, env: E, ffl, top: annexTop, T, ops: opsA, skip: { [OPP[M]]: true }, roof: { kind: 'flat', dp: M, downpipes: true }, walls, slabs: [], stairs: [], ceiling: 'flat', parapet: 0.6, conduit: false });
  }
  // ---- interior + equipment (pump frame: local −z = pool / back wall) ----
  b.push(); b.rotY(rot);
  const I = { x0: -hw + T, x1: hw - T, z0: -hd + T, z1: hz1 - T };
  const nPumps = small ? 2 : Math.max(1, Math.min(4, Math.floor((I.x1 - I.x0 - cw - 1.5) / 3.4)));
  const pumpX = [];
  {
    const a = cSign > 0 ? I.x0 + 1.4 : I.x0 + cw + 1.4, c = cSign > 0 ? I.x1 - cw - 1.2 : I.x1 - 1.4;
    for (let i = 0; i < nPumps; i++) pumpX.push(a + (c - a) * (nPumps === 1 ? 0.5 : i / (nPumps - 1)));
  }
  const pz = I.z0 + (small ? 1.5 : 2.3);
  const yHeader = ffl + (small ? 2.0 : 3.4);
  // pumps are visible through the windows at 'exterior' too (big units), small fittings only at 'full'
  for (let i = 0; i < pumpX.length; i++) pumpUnit(ctx, pumpX[i], ffl, pz, small ? 0.75 : 1.0, yHeader - ffl, i);
  const exitX = cSign > 0 ? I.x0 : I.x1;
  const hr = small ? 0.16 : 0.28;
  const hx0 = cSign > 0 ? Math.max(...pumpX) + 0.6 : Math.min(...pumpX) - 0.6;
  pipeRun(b, [[hx0, yHeader, pz + 0.2], [exitX, yHeader, pz + 0.2]], hr, { insulated: melt });
  if (hasPool) for (const x of pumpX) pipeRun(b, [[x, ffl + 0.95, pz - 1.0], [x, ffl + 0.95, -hd - 0.1]], small ? 0.14 : 0.22, { insulated: melt });
  if (!small) bridgeCrane(ctx, I, top, ffl, rng);
  if (ctx.full) {
    if (cw > 0) {
      const cx0 = cSign > 0 ? I.x1 - cw : I.x0, cx1 = cx0 + cw;
      controlRoom(ctx, { x0: cx0, x1: cx1, z0: I.z0, z1: I.z0 + cd }, ySlab, top, ffl, cSign, I, !!ctlU);
    }
    workbench(b, (I.x0 + I.x1) / 2 + (cSign > 0 ? -1 : 1) * 1.0, ffl, I.z1 - 0.5, 2.0, Math.PI);
    for (let k = 0; k < Math.min(4, Math.floor((I.x1 - I.x0 - cw) / 1.2) - 2); k++) cabinet(b, (cSign > 0 ? I.x0 + 0.8 : I.x1 - 0.8) + (cSign > 0 ? 1 : -1) * k * 0.9, ffl, I.z1 - 0.35, 0.8, 2.0, 0.5, Math.PI, 'hvac');
    if (annex) {
      // annex fit-out (pump frame: street wall at +z, facade u = x + hw): duty desk beside the street door on
      // the duty-room side of the partition, switchgear row against the hall wall away from the inner door
      const Lm = rectLen(M, annexR);
      const upX = (dCenter < Lm / 2 ? Math.min(Lm - 2, dCenter + 3.4) : Math.max(2, dCenter - 3.4)) - hw;
      const doorX = dCenter - hw;
      const deskX = doorX > upX ? Math.min(hw - T - 1.1, doorX + 2.0) : Math.max(-hw + T + 1.1, doorX - 2.0);
      consoleDesk(b, deskX, ffl, hd - T - 0.55, 1.8, Math.PI);
      chairSimple(b, deskX, ffl, hd - T - 1.45, Math.PI);
      const dX = innerDoor ? (innerDoor.u0 + innerDoor.u1) / 2 - hw : 0, sg = dX > 0 ? 1 : -1;
      for (let k = 0; k < 5; k++) {
        const x = -sg * (hw - T - 0.6) + sg * k * 0.85;
        if (Math.abs(x - dX) < 1.2) break;
        cabinet(b, x, ffl, hz1 + 0.35, 0.8, 2.1, 0.55, 0, 'hvac');
      }
    }
  }
  b.pop();
  // ---- glazed control bay over the pool ----
  if (ctlU) glazedBay(ctx, P, ctlU[0], ctlU[1], ySlab, bayTop, E, { dep: 2.0, roomDepth: cd, consoles: true });
  // ---- outside: intake, delivery main + surge vessel, hoist beam, kiosk, lamps, ladders ----
  const IK = hasPool ? intake(ctx, W, E, nPumps, pumpX, melt, small) : null;
  {
    b.push(); b.rotY(rot);
    const ex = cSign > 0 ? -hw - 0.1 : hw + 0.1, dir = cSign > 0 ? -1 : 1;
    const yy = ffl + (small ? 2.0 : 3.4);
    const gEx = 0.0, zp = pz + 0.2, zEnd = hasPool ? -hd - Math.min(2.0, W.gap * 0.6) : -hd - 2.5;
    const xo = ex + dir * 1.3;
    pipeRun(b, [[ex, yy, zp], [xo, yy, zp], [xo, gEx + 0.75, zp], [xo, gEx + 0.75, zEnd], [xo, gEx - 0.6, zEnd]], hr, { insulated: melt || E.polar, ground: gEx });
    b.push(); b.translate(ex, yy, zp); b.rotZ(Math.PI / 2); b.cylinder('steel_dark', 0, -0.06, 0, hr + 0.12, 0.12, 14, { top: true, bottom: true }); b.pop();
    b.cbox('concrete', xo - 0.9, gEx - 0.3, zEnd - 0.9, xo + 0.9, gEx + 0.12, zEnd + 0.9, 0.02, false);
    b.box('steel_dark', xo - 0.55, gEx + 0.12, zEnd - 0.4, xo + 0.55, gEx + 0.14, zEnd + 0.4, PY | PX | NX | PZ | NZ);
    valve(b, xo, gEx + 0.75, (zp + zEnd) / 2, hr * 0.8);
    // surge vessel (white, O02) on a pad beside the main + branch
    if (!small) {
      const vx = xo + dir * 1.9, vz = (zp + zEnd) / 2 + 0.6, vr = 0.85, vh = Math.min(3.6, top - 3.4);
      b.cbox('concrete', vx - 1.15, gEx - 0.3, vz - 1.15, vx + 1.15, gEx + 0.2, vz + 1.15, 0.02, false);
      K.waterTank(b, vx, gEx + 0.2, vz, vr, vh);
      pipeRun(b, [[xo, gEx + 0.75, vz], [vx - dir * vr, gEx + 0.75, vz]], hr * 0.55, { insulated: melt || E.polar, flange: true });
      if (b.collecting) b.colBox(vx - 1.0, gEx, vz - 1.0, vx + 1.0, gEx + vh + 0.8, vz + 1.0);
    }
    b.pop();
  }
  // monorail hoist beam over the maintenance door + lifting square on the apron
  {
    const hs = rectStartU(S, w, d, hallR);
    b.push(); rectFrame(b, S, hallR);
    const ru = (roller.u0 + roller.u1) / 2 - hs;
    const yB = Math.min(top - 0.9, roller.v1 + 1.0);
    const [g0, g1] = K.sideGround(s, S);
    const gy = Math.min(ffl, (g0 + g1) / 2 + 0.08);
    hoistBeam(b, { u: ru, y: yB, out: small ? 3.0 : 3.9, inside: ctx.full ? 2.0 : 0.3, hookY: Math.max(gy + 2.2, yB - 2.4 - rng.next() * 1.0), gy, tieY: Math.min(top + 0.6, yB + 2.0) });
    b.pop();
  }
  // transformer / switchgear kiosk + lamp at the apron
  {
    const Lsv = L(S);
    b.push(); K.facadeFrame(b, S, w, d, 0);
    const ku = roller.u1 + 2.6 < Lsv - 1.0 ? roller.u1 + 2.3 : roller.u0 - 2.3;
    cabinet(b, ku, 0, 1.4, 1.4, 2.0, 0.9, 0, 'hvac');
    lampPost(b, roller.u1 + 1.0 < Lsv ? Math.min(Lsv - 0.5, roller.u1 + 1.0) : roller.u0 - 1.0, 0, (small ? 6.2 : 10.2), small ? 4.5 : 6.5, Math.PI / 2);
    b.pop();
  }
  // greenhouse feeder (配水间): supply + return mains leave the wall facing the greenhouse row (urban places the
  // rows beside the head along the street: meta.servesSide, default 'right'), run on saddles and drop into a
  // valve pit; polar mains are insulated and heat-traced (沿保温管可从融水泵房找到温室配水间)
  // (urban fix 1: OX4 outlet pumps are intake + greenhouse feeder at once: meta.intakeSide 'back' + serves 'greenhouses')
  if (variant === 'feeder' || (variant === 'melt' && (s._meta || {}).serves === 'greenhouses')) feederMains(ctx, G, E, melt);
  // roof equipment: extract fans (air path: louvres low → fans high), HVAC on the annex, hatch, mast
  roofKit(ctx, H.inner, top, E, rng, small, melt);
  if (A) {
    const ai = A.inner;
    const along = rectLen(M, annexR);
    const c = (ai.x0 + ai.x1) / 2, cz = (ai.z0 + ai.z1) / 2;
    const rotU = isFB(M) ? 0 : Math.PI / 2;
    const n = Math.max(1, Math.min(3, Math.floor(along / 7)));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5;
      const x = isFB(M) ? c + t * (ai.x1 - ai.x0) * 0.8 : c, z = isFB(M) ? cz : cz + t * (ai.z1 - ai.z0) * 0.8;
      K.hvacUnit(b, x, annexTop, z, rotU, { w: 1.8, d: 0.9, h: 0.9 });
    }
    // caged ladder: annex roof → hall roof on the hall's street-side wall, near the end away from the bay
    const Lh = rectLen(M, hallR);
    b.push(); rectFrame(b, M, hallR);
    const lu = cSign > 0 ? Lh - 1.0 : 1.0;
    cagedLadder(b, lu, annexTop + 0.05, 0, top + 0.9 - annexTop - 0.05 + 0.2, 0, { cageKey: 'steel_yellow' });
    b.pop();
  }
  // ground → roof ladder on the end wall without the service door
  {
    const Q = SIDES.find((x) => x !== P && x !== S && x !== M) || OPP[S];
    const R = annex ? annexR : hallR;
    const Lq = rectLen(Q, R);
    const qs = annex ? rectStartU(Q, w, d, annexR) : 0;
    const qo = (ops[Q] || []).map((o) => [o.u0 - qs, o.u1 - qs]);
    let lu = 0.9;
    for (const cand of [0.9, Lq - 0.9, Lq / 2]) if (!qo.some(([a, c]) => cand > a - 0.8 && cand < c + 0.8)) { lu = cand; break; }
    const yTop = annex ? annexTop + 0.6 : top + 0.9;
    b.push(); rectFrame(b, Q, R);
    cagedLadder(b, lu, 2.4, 0, yTop - 2.4 + 0.1, 0, { cageKey: 'steel_yellow' });
    b.pop();
  }
  // ground works: basalt retaining terraces where the bank rises above the floor, levelled pad skirt (meta.pad)
  siteWorks(ctx, ffl, { pad: !!(W && W.pad), doors: Object.fromEntries(SIDES.map((sd) => [sd, doorSpans(ops[sd]).map(([a, c]) => [a - 0.4, c + 0.4])])) });
  // climate dressing
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', skip: doorSpans(ops[E.lee]) });
  if (E.polar) { drift(ctx, E.lee, { kind: 'snow', skip: doorSpans(ops[E.lee]) }); drift(ctx, E.windward, { kind: 'snow', h: 0.25, reach: 1.4, seed: 3, skip: doorSpans(ops[E.windward]) }); }
  if (melt) meltVestibule(ctx, M, door, E, w, d);
  // anchors
  const ents = [
    { kind: 'main', side: M, pos: K.facadePoint(M, w, d, (door.u0 + door.u1) / 2, ffl, melt ? 3.0 : 0.6), dir: K.facadeNormal(M), width: 1.1 },
    { kind: 'service', side: S, pos: K.facadePoint(S, w, d, (roller.u0 + roller.u1) / 2, ffl, 0.6), dir: K.facadeNormal(S), width: rdW },
  ];
  if (poolDoor) ents.push({ kind: 'maintenance', side: P, pos: K.facadePoint(P, w, d, (poolDoor.u0 + poolDoor.u1) / 2, ffl, 0.6), dir: K.facadeNormal(P), width: 1.0 });
  const cams = {};
  if (ctlU) {
    const um = (ctlU[0] + ctlU[1]) / 2;
    // eye at the end of the glazed bay beside the console row (the monitors no longer fill the view), looking at the intake pool
    const ue = um + (ctlU[1] - ctlU[0]) / 2 - 0.45;
    cams.living = { pos: K.facadePoint(P, w, d, ue, ySlab + 1.7, 1.25), target: K.facadePoint(P, w, d, um - 1.5, W.up, W.gap + Math.min(W.width * 0.4, 25)) };
    cams.control = cams.living;
    // 检修道 on the intake apron (quay) looking along the canal past the trash racks: water level + flow direction
    const qy = IK ? IK.yDeck + 0.12 : 0.3, qz = IK && IK.raised ? W.gap - 1.6 : W.gap * 0.6;
    cams.walkway = { pos: K.facadePoint(P, w, d, (poolDoor.u0 + poolDoor.u1) / 2 + 2.5, qy + 1.65, qz), target: K.facadePoint(P, w, d, um - 8 * W.flow, W.up, W.gap + W.width * 0.5) };
  }
  cams.hoist = { pos: K.facadePoint(S, w, d, (roller.u0 + roller.u1) / 2 + 6, 1.65, 12), target: K.facadePoint(S, w, d, (roller.u0 + roller.u1) / 2, ffl + 2.6, 0) };
  utilAnchors(ctx, {
    ffl, h: top - ffl, roofY: top, access: [0, top, 0],
    floors: small ? [{ level: 0, y: ffl, height: top - ffl }] : [{ level: 0, y: ffl, height: ySlab - ffl }, { level: 1, y: ySlab, height: top - ySlab }],
    entrances: ents,
    rooms: [
      { floor: 0, name: 'pump hall', kind: 'plant', center: [(hallR.x0 + hallR.x1) / 2, ffl, (hallR.z0 + hallR.z1) / 2], size: [hallR.x1 - hallR.x0 - 2 * T, top - ffl, hallR.z1 - hallR.z0 - 2 * T] },
      ...(annex ? [{ floor: 0, name: 'duty room / switchgear', kind: 'office', center: [(annexR.x0 + annexR.x1) / 2, ffl, (annexR.z0 + annexR.z1) / 2], size: [annexR.x1 - annexR.x0, annexTop - ffl, annexR.z1 - annexR.z0] }] : []),
      ...(cw ? [{ floor: 1, name: 'control room', kind: 'office', center: ctlU ? K.facadePoint(P, w, d, (ctlU[0] + ctlU[1]) / 2, ySlab, -cd / 2 + 1.0) : [0, ySlab, 0], size: [cw, 3, cd + 2.0] }] : []),
    ],
    cameras: cams,
  });
  b.meta.variant = variant; b.meta.pool = P; b.meta.annex = annex;
  b.meta.water = hasPool ? { side: W.side, gap: W.gap, width: W.width, level: W.up, flow: W.flow, deck: IK ? IK.yDeck : null, explicit: W.explicit, pad: W.pad ? W.pad.y : null } : null;
}

function dedupeOps(list) {
  const out = [];
  const pri = (o) => (o.kind === 'blank' ? -1 : o.kind === 'roller' ? 0 : o.kind === 'door' ? 1 : o.kind === 'louvre' ? 2 : o.type === 'fixed' && o.v0 > 4 ? 4 : 3);
  for (const o of list.slice().sort((a, c) => pri(a) - pri(c))) {
    if (out.some((q) => o.u0 < q.u1 + 0.3 && o.u1 > q.u0 - 0.3 && o.v0 < q.v1 + 0.2 && o.v1 > q.v0 - 0.2)) continue;
    out.push(o);
  }
  return out;
}

/** Pump + motor set on a plinth (pump frame: suction along −z). */
function pumpUnit(ctx, x, ffl, z, s, yHeader, i) {
  const b = ctx.b;
  b.push(); b.translate(x, ffl, z);
  b.cbox('concrete_smooth', -0.75 * s, 0, -1.25 * s, 0.75 * s, 0.32, 1.9 * s, 0.03, false);
  if (b.collecting) b.colBox(-0.75 * s, 0, -1.25 * s, 0.75 * s, 0.32 + 1.5 * s, 1.9 * s);
  const ay = 0.32 + 0.62 * s;
  // volute casing (lathe about the suction axis −z) — painted blue-grey
  b.withTint([0.55, 0.68, 0.85], () => {
    b.push(); b.translate(0, ay, -0.25 * s); b.rotX(-Math.PI / 2);
    b.lathe('steel_dark', [[0.18 * s, -0.55 * s], [0.2 * s, -0.4 * s], [0.52 * s, -0.25 * s], [0.6 * s, 0.0], [0.58 * s, 0.22 * s], [0.3 * s, 0.32 * s], [0.12 * s, 0.4 * s]], 18, { capTop: true, capBottom: true });
    b.pop();
    b.cylinder('steel_dark', 0.32 * s, ay + 0.3 * s, -0.25 * s, 0.17 * s, 0.4 * s, 12, { top: true });
  });
  b.cbox('steel_dark', -0.5 * s, 0.32, -0.6 * s, 0.5 * s, ay - 0.45 * s, 0.1 * s, 0.01);
  b.push(); b.translate(0, ay, 0.35 * s); b.rotX(Math.PI / 2);
  b.lathe('steel_yellow', [[0.2 * s, 0], [0.24 * s, 0.05], [0.24 * s, 0.38 * s], [0.2 * s, 0.42 * s]], 14, {});
  b.pop();
  b.withTint([0.32, 0.45, 0.62], () => {
    b.push(); b.translate(0, ay, 0.8 * s); b.rotX(Math.PI / 2);
    b.lathe('steel_dark', [[0.2 * s, 0], [0.4 * s, 0.06 * s], [0.42 * s, 0.12 * s], [0.42 * s, 0.85 * s], [0.38 * s, 0.95 * s], [0.18 * s, 1.0 * s]], 18, { capTop: true, capBottom: true });
    b.pop();
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.push(); b.translate(Math.cos(a) * 0.43 * s, ay + Math.sin(a) * 0.43 * s, 1.25 * s); b.rotZ(a); b.box('steel_dark', -0.015, -0.025, -0.42 * s, 0.015, 0.025, 0.42 * s, PX | NX | PY | NY); b.pop(); }
  });
  b.cbox('steel_dark', -0.55 * s, 0.32, 0.6 * s, 0.55 * s, ay - 0.42 * s, 1.85 * s, 0.01);
  b.cbox('hvac', 0.4 * s, ay + 0.15 * s, 0.9 * s, 0.62 * s, ay + 0.42 * s, 1.25 * s, 0.01);
  const top = ay + 0.7 * s;
  b.tube('steel', [[0.32 * s, top, -0.25 * s], [0.32 * s, yHeader - 0.35, -0.25 * s], [0.32 * s, yHeader - 0.35, 0.2]], 0.15 * s, 10, { smoothAngle: 30 });
  valve(b, 0.32 * s, ay + 1.15 * s, -0.25 * s, 0.13 * s);
  b.cylinder('steel', 0.32 * s, yHeader - 0.38, 0.2, 0.15 * s, 0.4, 10, { top: false });
  b.push(); b.translate(0, ay, -0.8 * s); b.rotX(-Math.PI / 2);
  b.lathe('steel', [[0.2 * s, 0], [0.26 * s, 0.2 * s]], 12, {});
  b.pop();
  b.cylinder('steel_brushed', 0.32 * s + 0.2, ay + 0.95 * s, -0.25 * s, 0.07, 0.03, 10, { top: true });
  b.pop();
  void i;
}

/** Crane rails on corbels along both long walls + bridge crane with hoist (pump frame inner rect I). */
function bridgeCrane(ctx, I, top, ffl, rng) {
  const b = ctx.b;
  const yR = top - 1.7;
  const alongX = I.x1 - I.x0 >= I.z1 - I.z0;
  b.push();
  if (!alongX) b.rotY(Math.PI / 2);
  const Lx = alongX ? I.x1 - I.x0 : I.z1 - I.z0, Sz = alongX ? I.z1 - I.z0 : I.x1 - I.x0;
  const xa = -Lx / 2 + 0.1, xb = Lx / 2 - 0.1;
  const cx = alongX ? (I.x0 + I.x1) / 2 : -(I.z0 + I.z1) / 2, cz = alongX ? (I.z0 + I.z1) / 2 : (I.x0 + I.x1) / 2;
  b.translate(cx, 0, cz);
  for (const sz of [-Sz / 2 + 0.25, Sz / 2 - 0.25]) {
    b.box('steel_dark', xa, yR - 0.45, sz - 0.12, xb, yR, sz + 0.12, ALL);
    b.box('steel', xa, yR, sz - 0.03, xb, yR + 0.06, sz + 0.03, PY | PZ | NZ);
    const n = Math.max(2, Math.round(Lx / 4));
    for (let i = 0; i <= n; i++) { const x = xa + ((xb - xa) * i) / n; b.box('concrete_smooth', x - 0.2, yR - 0.95, sz - 0.25 * Math.sign(sz), x + 0.2, yR - 0.45, sz + 0.2 * Math.sign(sz), ALL); }
  }
  const bx = xa + 1.5 + rng.next() * Math.max(0.1, xb - xa - 3);
  b.cbox('steel_yellow', bx - 0.3, yR + 0.06, -Sz / 2 + 0.2, bx + 0.3, yR + 0.75, Sz / 2 - 0.2, 0.02);
  for (const sz of [-Sz / 2 + 0.25, Sz / 2 - 0.25]) b.cbox('steel_yellow', bx - 1.0, yR + 0.06, sz - 0.22, bx + 1.0, yR + 0.55, sz + 0.22, 0.02);
  const tz = (rng.next() - 0.5) * (Sz - 3);
  b.cbox('steel_dark', bx - 0.55, yR + 0.75, tz - 0.6, bx + 0.55, yR + 1.15, tz + 0.6, 0.02);
  b.cbox('steel_yellow', bx - 0.45, yR - 0.3, tz - 0.35, bx + 0.45, yR + 0.06, tz + 0.35, 0.02);
  const hookY = Math.max(ffl + 2.8, yR - 2.8 - rng.next() * 1.5);
  for (const dz of [-0.08, 0.08]) b.cylinder('steel', bx, hookY + 0.35, tz + dz, 0.012, yR - 0.3 - hookY - 0.35, 4, { top: false });
  b.cbox('steel_yellow', bx - 0.14, hookY, tz - 0.18, bx + 0.14, hookY + 0.4, tz + 0.18, 0.02);
  b.tube('steel_dark', [[bx, hookY, tz], [bx, hookY - 0.2, tz], [bx + 0.06, hookY - 0.3, tz], [bx + 0.12, hookY - 0.22, tz]], 0.03, 6);
  b.pop();
}

/**
 * Raised control room (pump frame rect r against the pool wall): mezzanine slab, glazed walls towards the
 * hall, switchgear room below, stair + landing. With `bay` the consoles stand in the glazed bay outside.
 */
function controlRoom(ctx, r, ySlab, top, ffl, cSign, I, bay) {
  const b = ctx.b;
  b.cbox('concrete_smooth', r.x0, ySlab - 0.25, r.z0, r.x1, ySlab, r.z1, 0.01);
  b.rectY('tile_floor', r.x0 + 0.05, r.z0 + 0.05, r.x1 - 0.05, r.z1 - 0.05, ySlab + 0.003, 1);
  if (b.collecting) b.colQuad(r.x0, ySlab, r.z1, r.x1, ySlab, r.z1, r.x1, ySlab, r.z0, r.x0, ySlab, r.z0);
  const yc = Math.min(top - 0.6, ySlab + 3.0);
  b.cbox('panel_grey', r.x0, yc, r.z0, r.x1, yc + 0.18, r.z1, 0.01);
  b.withTint([0.95, 0.95, 0.94], () => b.rectY('plaster', r.x0, r.z0, r.x1, r.z1, yc - 0.002, -1));
  const xin = cSign > 0 ? r.x0 : r.x1;
  const doorX = cSign > 0 ? r.x0 + 0.75 : r.x1 - 0.75;
  glazedWall(b, [r.x0, r.z1], [r.x1, r.z1], ySlab, yc, doorX - r.x0);
  glazedWall(b, [xin, r.z0], [xin, r.z1], ySlab, yc, null);
  partition(ctx, { x0: r.x0, z0: r.z1, x1: r.x1, z1: r.z1, y0: ffl, y1: ySlab - 0.25, doors: [{ at: (r.x1 - r.x0) * (cSign > 0 ? 0.75 : 0.25), w: 1.0 }] });
  partition(ctx, { x0: xin, z0: r.z0, x1: xin, z1: r.z1, y0: ffl, y1: ySlab - 0.25, doors: [] });
  for (let k = 0; k < Math.floor((r.x1 - r.x0 - 1) / 0.85); k++) cabinet(b, r.x0 + 0.7 + k * 0.85, ffl, r.z0 + 0.4, 0.8, 2.1, 0.55, 0, 'hvac');
  if (!bay) {
    consoleDesk(b, (r.x0 + r.x1) / 2, ySlab, r.z0 + 0.75, Math.min(3.2, r.x1 - r.x0 - 1.2), Math.PI);
    chairSimple(b, (r.x0 + r.x1) / 2 - 0.6, ySlab, r.z0 + 1.6, Math.PI);
  } else {
    // records cabinet + plan table in the back of the room (the consoles stand in the bay)
    b.cbox('cabinet', r.x0 + 0.3, ySlab, r.z1 - 0.65, r.x0 + 1.5, ySlab + 1.9, r.z1 - 0.2, 0.01);
    b.cbox('wood', (r.x0 + r.x1) / 2 - 0.8, ySlab + 0.72, r.z1 - 1.6, (r.x0 + r.x1) / 2 + 0.8, ySlab + 0.76, r.z1 - 0.8, 0.01);
    for (const sx of [-0.7, 0.7]) for (const sz of [-1.5, -0.9]) b.box('steel_dark', (r.x0 + r.x1) / 2 + sx - 0.02, ySlab, r.z1 + sz - 0.02, (r.x0 + r.x1) / 2 + sx + 0.02, ySlab + 0.72, r.z1 + sz + 0.02, PX | NX | PZ | NZ);
  }
  const rise = ySlab - ffl;
  const n = Math.max(2, Math.ceil(rise / 0.18)), run = n * 0.27;
  const zS = r.z1 + 0.68;
  const lx0 = cSign > 0 ? r.x0 : r.x1 - 1.5, lx1 = lx0 + 1.5;
  grating(b, lx0, r.z1, lx1, r.z1 + 1.3, ySlab);
  const xFoot = cSign > 0 ? lx0 - run : lx1 + run;
  stairStraight(ctx, { x: xFoot, z: zS, y0: ffl, rise, dir: cSign > 0 ? 0 : Math.PI, W: 1.0 });
  railSimple(b, [[lx0, ySlab, r.z1 + 1.25], [lx1, ySlab, r.z1 + 1.25]]);
  const xo = cSign > 0 ? lx1 - 0.05 : lx0 + 0.05;
  railSimple(b, [[xo, ySlab, r.z1 + 0.05], [xo, ySlab, r.z1 + 1.25]]);
  void I;
}

/** Glazed partition between two plan points (aluminium frames, clear glass on a solid upstand) + optional door. */
function glazedWall(b, p, q, y0, y1, doorAt) {
  const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
  b.push(); b.translate(p[0], 0, p[1]); b.rotY(-Math.atan2(dz, dx));
  const du = doorAt != null ? Math.max(0.6, Math.min(L - 0.6, doorAt)) : null;
  const segs = du != null ? [[0, du - 0.5], [du + 0.5, L]] : [[0, L]];
  for (const [a, c] of segs) {
    if (c - a < 0.05) continue;
    b.box('panel_grey', a, y0, -0.06, c, y0 + 0.9, 0.06, ALL);
    const n = Math.max(1, Math.round((c - a) / 1.3));
    for (let i = 0; i <= n; i++) { const u = a + ((c - a) * i) / n; b.box('aluminium_dark', u - 0.03, y0 + 0.9, -0.04, u + 0.03, y1, 0.04, ALL); }
    b.box('aluminium_dark', a, y0 + 0.88, -0.07, c, y0 + 0.94, 0.07, ALL);
    b.quad('glass_clear', a, y0 + 0.94, 0, c, y0 + 0.94, 0, c, y1 - 0.06, 0, a, y1 - 0.06, 0);
    if (b.collecting) b.colBox(a, y0, -0.06, c, y1, 0.06);
  }
  b.box('aluminium_dark', 0, y1 - 0.06, -0.05, L, y1, 0.05, ALL);
  if (du != null) {
    K.doorUnit(b, { u0: du - 0.5, u1: du + 0.5, v0: y0, v1: y0 + 2.15, R: -0.05, kind: 'glazed', open: 0.0, glassKey: 'glass_clear' });
    b.box('aluminium_dark', du - 0.5, y0 + 2.15, -0.05, du + 0.5, y0 + 2.22, 0.05, ALL);
    b.quad('glass_clear', du - 0.5, y0 + 2.22, 0, du + 0.5, y0 + 2.22, 0, du + 0.5, y1 - 0.06, 0, du - 0.5, y1 - 0.06, 0);
  }
  b.pop();
}

/** Intake chamber on the pool / canal: quay walls, chamber walls, trash racks, deck, hoist, rails. */
function intake(ctx, W, E, nPumps, pumpX, melt, small) {
  const b = ctx.b;
  b.push(); b.rotY(W.rot);
  const hd = W.hd, zw = -hd;
  const zEdge = zw - W.gap;
  const zMouth = zEdge - 1.6;
  const xs = pumpX.length ? [Math.min(...pumpX), Math.max(...pumpX)] : [-2, 2];
  const iw = Math.max(small ? 3.2 : 4.4, xs[1] - xs[0] + (small ? 2.4 : 3.2));
  const xc = (xs[0] + xs[1]) / 2;
  const x0 = xc - iw / 2, x1 = xc + iw / 2;
  // intake deck follows the real water level (urban meta.water): at the yard for a canal below the station, raised
  // with ≥ 0.9 m freeboard over a perched reach (then a retaining face + steel stair from the yard)
  const yardY = W.yard ?? 0.3, yDeck = Math.max(yardY, W.up + 0.9), bed = W.bed, lvl = W.up;
  const wetTop = lvl + 0.35;
  const qx0 = x0 - 5, qx1 = x1 + 5;
  const raised = yDeck > yardY + 0.6;
  const quay = (xa, xb) => {
    b.box('concrete', xa, wetTop, zEdge - 0.5, xb, yDeck, zEdge, PY | NZ | PX | NX);
    b.box('concrete_wet', xa, bed, zEdge - 0.5, xb, wetTop, zEdge, NZ | PX | NX);
    if (E.wet) b.withTint(E.algaeTint, () => b.rectZ('concrete_wet', xa, lvl - 0.35, xb, lvl + 0.12, zEdge - 0.505, -1));
    b.cbox('concrete_smooth', xa - 0.02, yDeck, zEdge - 0.58, xb + 0.02, yDeck + 0.12, zEdge + 0.08, 0.01);
  };
  quay(qx0, x0); quay(x1, qx1);
  // quay apron: up to the house at the yard level; a raised deck keeps a 3.2 m apron with a basalt retaining face
  const zLand = raised ? Math.min(zw - 0.8, zEdge + 3.2) : zw;
  b.cbox('concrete', qx0, yDeck - 0.35, zEdge, qx1, yDeck - 0.02, zLand, 0.01, false);
  if (b.collecting) b.colQuad(qx0, yDeck, zLand, qx1, yDeck, zLand, qx1, yDeck, zEdge, qx0, yDeck, zEdge);
  if (raised) {
    b.box('basalt', qx0, yardY - 0.4, zLand - 0.6, qx1, yDeck - 0.02, zLand, PZ | PX | NX);
    b.cbox('concrete_smooth', qx0 - 0.02, yDeck - 0.02, zLand - 0.65, qx1 + 0.02, yDeck + 0.1, zLand + 0.04, 0.01);
    yellowRail(b, [[qx0 + 0.15, yDeck + 0.1, zLand - 0.25], [x0 - 0.2, yDeck + 0.1, zLand - 0.25]], { toe: false });
    if (b.collecting) b.colBox(qx0, yardY - 0.4, zLand - 0.6, qx1, yDeck, zLand);      // the rail has its own colliders; the stair landing stays open
    // steel stair from the yard along the retaining face up to the apron (lands at the x1 end)
    const rise = yDeck - yardY, nn = Math.max(2, Math.ceil(rise / 0.19)), run = (nn - 1) * 0.25;
    steelStair(b, { x: x1 + 0.4 + run, z: zLand + 0.65, y0: yardY, rise, dir: Math.PI, W: 1.0, rails: 'both' });
    grating(b, x1 - 0.8, zLand - 0.1, x1 + 0.4, zLand + 1.2, yDeck);
    W._stairFoot = [x1 + 0.4 + run + 0.6, yardY, zLand + 0.65];
  }
  for (const [a, c] of [[x0, x0 + 0.45], [x1 - 0.45, x1]]) {
    b.box('concrete', a, wetTop, zMouth, c, yDeck, zLand, PY | PX | NX | NZ);
    b.box('concrete_wet', a, bed, zMouth, c, wetTop, zEdge, PX | NX | NZ);
    if (E.wet) b.withTint(E.algaeTint, () => { b.rectX('concrete_wet', zMouth, lvl - 0.35, zEdge, lvl + 0.1, c + 0.003, 1); b.rectX('concrete_wet', zMouth, lvl - 0.35, zEdge, lvl + 0.1, a - 0.003, -1); });
  }
  b.cbox('concrete_smooth', x0 + 0.45, yDeck - 0.3, zEdge + 0.6, x1 - 0.45, yDeck, zLand, 0.01, false);
  grating(b, x0 + 0.45, zMouth + 0.2, x1 - 0.45, zEdge + 0.6, yDeck);
  for (let i = 1; i < pumpX.length; i++) { const x = (pumpX[i - 1] + pumpX[i]) / 2; b.box('concrete_wet', x - 0.15, bed, zMouth + 0.1, x + 0.15, yDeck - 0.16, zLand, PX | NX | NZ | PY); }
  const rx0 = x0 + 0.45, rx1 = x1 - 0.45;
  b.box('steel_dark', rx0, bed + 0.2, zMouth - 0.08, rx1, bed + 0.35, zMouth + 0.08, ALL);
  for (let x = rx0 + 0.05; x < rx1 - 0.02; x += 0.09) b.box('steel_dark', x - 0.012, bed + 0.35, zMouth - 0.04, x + 0.012, yDeck - 0.16, zMouth + 0.04, PX | NX | PZ | NZ);
  for (let y = bed + 1.2; y < yDeck - 0.3; y += 1.0) b.box('steel_dark', rx0, y - 0.03, zMouth - 0.05, rx1, y + 0.03, zMouth + 0.05, ALL);
  for (const x of [rx0 + 0.04, rx1 - 0.04]) b.box('steel', x - 0.08, bed, zMouth + 0.18, x + 0.08, yDeck + 0.05, zMouth + 0.34, ALL);
  const hy = yDeck + 3.6;
  for (const x of [rx0 - 0.25, rx1 + 0.25]) b.cbox('steel_dark', x - 0.12, yDeck, zMouth + 0.3, x + 0.12, hy, zMouth + 0.54, 0.01);
  b.box('steel_dark', rx0 - 0.5, hy, zMouth + 0.3, rx1 + 0.5, hy + 0.32, zMouth + 0.54, ALL);
  const hx = rx0 + (rx1 - rx0) * 0.35;
  b.cbox('steel_yellow', hx - 0.22, hy - 0.5, zMouth + 0.24, hx + 0.22, hy, zMouth + 0.6, 0.015);
  b.cylinder('steel', hx, hy - 1.6, zMouth + 0.42, 0.012, 1.1, 4, { top: false });
  b.cbox('steel_yellow', hx - 0.1, hy - 1.85, zMouth + 0.34, hx + 0.1, hy - 1.55, zMouth + 0.5, 0.01);
  yellowRail(b, [[x0 + 0.1, yDeck, zMouth + 0.12], [x1 - 0.1, yDeck, zMouth + 0.12]]);
  yellowRail(b, [[x0 - 5 + 0.1, yDeck + 0.12, zEdge - 0.3], [x0 - 0.1, yDeck + 0.12, zEdge - 0.3]]);
  yellowRail(b, [[x1 + 0.1, yDeck + 0.12, zEdge - 0.3], [x1 + 5 - 0.1, yDeck + 0.12, zEdge - 0.3]]);
  lampPost(b, x1 + 0.6, yDeck + 0.12, zEdge - 0.25, 6, -Math.PI / 2);
  cagedLadder(b, x0 - 2.4, bed + 0.5, zEdge - 0.5, yDeck - bed - 0.5, Math.PI, { cageKey: 'steel_yellow' });
  // OX4 forebay pools (urban meta.water.pool): the bank shelves gently to the waterline, so an intake jetty on pile
  // bents carries the insulated suction mains 12 m out from the chamber mouth to a screened intake head below the
  // pool level (the intake reaches the water wherever the shore lies)
  if (melt && ((ctx.spec._meta || {}).water || {}).pool) {
    const Lj = 12, jw = 1.6, xj = xc, z0 = zMouth, z1 = zMouth - Lj;
    grating(b, xj - jw / 2, z1, xj + jw / 2, z0 + 0.2, yDeck);
    yellowRail(b, [[xj - jw / 2 + 0.05, yDeck, z0], [xj - jw / 2 + 0.05, yDeck, z1 + 0.05], [xj + jw / 2 - 0.05, yDeck, z1 + 0.05], [xj + jw / 2 - 0.05, yDeck, z0]]);
    for (let z = z0 - 1.5; z > z1 - 0.1; z -= 3) {
      for (const xx of [xj - jw / 2 + 0.12, xj + jw / 2 - 0.12]) b.cylinder('steel_dark', xx, lvl - 3.0, z, 0.11, yDeck - 0.16 - (lvl - 3.0), 10, { top: false });
      b.box('steel_dark', xj - jw / 2, yDeck - 0.36, z - 0.1, xj + jw / 2, yDeck - 0.16, z + 0.1, ALL);
    }
    for (const dx of [-0.35, 0.35]) pipeRun(b, [[xj + dx, yDeck - 0.55, z0 + 0.2], [xj + dx, yDeck - 0.55, z1 + 0.7], [xj + dx, lvl - 1.6, z1 + 0.7]], 0.11, { insulated: true, trace: dx < 0 });
    b.cylinder('steel_dark', xj, lvl - 2.7, z1 + 0.7, 0.6, 1.1, 14, { top: true, bottom: true });
    b.cylinder('grille_dark', xj, lvl - 2.6, z1 + 0.7, 0.62, 0.9, 14, { top: false });
    lampPost(b, xj + jw / 2 - 0.1, yDeck, z1 + 0.5, 4.5, -Math.PI / 2);
  }
  if (melt) {
    pipeRun(b, [[rx0 - 0.4, yDeck + 0.4, zEdge + 0.3], [rx0 - 0.4, lvl - 0.2, zMouth - 0.2], [rx1 + 0.4, lvl - 0.2, zMouth - 0.2]], 0.04, { insulated: true, trace: false });
    cabinet(b, x0 - 1.5, yDeck + 0.12, zEdge + 1.4, 0.9, 1.7, 0.5, Math.PI, 'hvac');
  }
  b.pop();
  return { yDeck, zEdge, raised };
}

/** Roof equipment for pump halls. */
/** Greenhouse distribution mains of a feeder pump room (side wall → saddles → valve pit). */
function feederMains(ctx, G, E, melt) {
  const b = ctx.b, s = ctx.spec, m = s._meta || {};
  const { w, d, ffl, M } = G;
  let side = SIDES.includes(m.servesSide) ? m.servesSide : 'right';
  if (side === M) side = 'right' === M ? 'left' : 'right';
  const L = isFB(side) ? w : d;
  const [g0, g1] = K.sideGround(s, side);
  // exit near the end of the wall away from the street front (the greenhouses start deeper in the plot)
  const towardsBack = side === 'right' ? 1 : side === 'left' ? -1 : 0;
  const u = towardsBack > 0 ? L - 1.0 : towardsBack < 0 ? 1.0 : L - 1.0;
  const gy = g0 + ((g1 - g0) * u) / L;
  const yP = Math.max(ffl + 0.9, gy + 0.9), run = 3.2, r = 0.075;
  b.push(); K.facadeFrame(b, side, w, d, 0);
  for (const [k, du] of [[0, -0.22], [1, 0.22]]) {
    const uu = u + du * (towardsBack >= 0 ? -1 : 1);
    pipeRun(b, [[uu, yP, -0.05], [uu, yP, run], [uu, gy - 0.4, run]], r, { insulated: melt, key: 'steel', ground: gy, trace: k === 0 });
    // wall sleeve
    b.push(); b.translate(uu, yP, -0.02); b.rotX(Math.PI / 2); b.cylinder('steel_dark', 0, 0, 0, r + 0.07, 0.1, 12, { top: true }); b.pop();
  }
  // valve pit: concrete curb + chequer-plate lid + marker post (snow pole in the polar provinces)
  const pu0 = u - 0.75, pu1 = u + 0.75;
  b.cbox('concrete', pu0, gy - 0.3, run - 0.6, pu1, gy + 0.12, run + 0.6, 0.02, false);
  b.box('steel', pu0 + 0.08, gy + 0.12, run - 0.52, pu1 - 0.08, gy + 0.14, run + 0.52, PY | PX | NX | PZ | NZ);
  const mp = [pu1 + 0.3, gy, run + 0.5];
  b.withTint(melt ? [1.0, 0.35, 0.18] : [1.0, 0.8, 0.2], () => b.cylinder('plastic_bin', mp[0], gy, mp[2], 0.035, melt ? 2.2 : 1.2, 8, { top: true }));
  if (b.collecting) b.colBox(pu0, gy - 0.3, run - 0.6, pu1, gy + 0.14, run + 0.6);
  b.pop();
}

function roofKit(ctx, inner, yr, E, rng, small, melt) {
  const b = ctx.b;
  if (!inner) return;
  const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
  const n = Math.max(1, Math.round(Math.max(W, D) / 6));
  const alongX = W >= D;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = alongX ? inner.x0 + W * t : (inner.x0 + inner.x1) / 2 + W * 0.15, z = alongX ? (inner.z0 + inner.z1) / 2 + D * 0.15 : inner.z0 + D * t;
    b.cbox('concrete', x - 0.6, yr, z - 0.6, x + 0.6, yr + 0.3, z + 0.6, 0.01, false);
    b.lathe('aluminium', [[0.5, 0], [0.5, 0.6], [0.56, 0.62], [0.56, 0.7]], 16, { x, y: yr + 0.3, z });
    b.lathe('aluminium', [[0.62, 0], [0.62, 0.05], [0.3, 0.32], [0, 0.34]], 16, { x, y: yr + 1.15, z });
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; b.box('steel', x + Math.cos(a) * 0.55 - 0.015, yr + 0.95, z + Math.sin(a) * 0.55 - 0.015, x + Math.cos(a) * 0.55 + 0.015, yr + 1.18, z + Math.sin(a) * 0.55 + 0.015, ALL); }
    b.cylinder('grille_dark', x, yr + 0.98, z, 0.5, 0.02, 16, { top: true });
  }
  if (!small && D > 5 && W > 6) { b.cbox('concrete', inner.x0 + 1.0, yr, inner.z1 - 3.6, inner.x0 + 3.6, yr + 0.35, inner.z1 - 1.0, 0.015, false); b.cbox('steel', inner.x0 + 1.05, yr + 0.35, inner.z1 - 3.55, inner.x0 + 3.55, yr + 0.42, inner.z1 - 1.05, 0.01); }
  if (rng.next() < 0.7) K.antennaMast(b, inner.x0 + 0.9, yr, inner.z0 + 0.9, 3.5 + rng.next() * 2, ctx.spec.hash);
  K.roofHatch(b, inner.x1 - 1.2, yr, inner.z1 - 1.3, {});
  if (small && W > 4) K.hvacUnit(b, inner.x1 - 1.6, yr, inner.z0 + 0.9, 0, { w: 1.6, d: 0.8, h: 0.8 });
  void E; void melt;
}

/** Polar vestibule (门斗): insulated draught lobby projecting in front of the main door, recessed look. */
function meltVestibule(ctx, side, door, E, w, d) {
  const b = ctx.b;
  b.push(); K.facadeFrame(b, side, w, d, 0);
  const u0 = door.u0 - 0.9, u1 = door.u1 + 0.9, dep = 2.4, h = 3.0, y0 = door.v0;
  const s = ctx.spec, L = isFB(side) ? w : d;
  const [g0, g1] = K.sideGround(s, side);
  const gy = g0 + ((g1 - g0) * ((u0 + u1) / 2)) / L;
  b.cbox('concrete_smooth', u0, Math.min(gy, y0) - 0.45, 0, u1, y0 - 0.005, dep, 0.012, false);
  if (b.collecting) b.colQuad(u0, y0, dep, u1, y0, dep, u1, y0, 0, u0, y0, 0);
  if (y0 - gy > 0.05) K.steps(b, { u0: u0 + 0.3, u1: u1 - 0.3, z0: dep, y0: gy, y1: y0, key: 'stone_step', cheeks: false, rails: false });
  b.pushTint(E.shellTint);
  b.cbox('panel_insulated', u0, y0 - 0.1, 0, u0 + 0.3, y0 + h, dep, 0.02, false);
  b.cbox('panel_insulated', u1 - 0.3, y0 - 0.1, 0, u1, y0 + h, dep, 0.02, false);
  b.cbox('panel_insulated', u0 - 0.1, y0 + h, -0.05, u1 + 0.1, y0 + h + 0.35, dep + 0.15, 0.02);
  b.box('panel_insulated', u0 + 0.3, y0 + 2.35, dep - 0.3, u1 - 0.3, y0 + h, dep, PZ | NY | NZ);
  b.popTint();
  b.cbox('panel_grey', u0 - 0.12, y0 + h + 0.35, -0.05, u1 + 0.12, y0 + h + 0.45, dep + 0.2, 0.01);
  b.withTint(E.snowTint, () => b.box('render_white', u0, y0 + h + 0.45, 0.15, u1, y0 + h + 0.56, dep + 0.1, PY | PX | NX | PZ));
  // outer door in the recess + frost on its frame, warm light at the entrance (设备间的暖光留在入口)
  b.push(); b.translate(0, 0, dep - 0.3);
  K.doorUnit(b, { u0: door.u0 - 0.1, u1: door.u1 + 0.1, v0: y0, v1: y0 + 2.3, R: 0.05, kind: 'glazed', open: 0, glassKey: ctx.full ? 'glass_clear' : 'glass_shop', T: 0.3 });
  b.pop();
  b.withTint(E.snowTint, () => { b.box('render_white', door.u0 - 0.16, y0, dep - 0.3, door.u0 - 0.1, y0 + 2.36, dep - 0.26, PZ | NX); b.box('render_white', door.u1 + 0.1, y0, dep - 0.3, door.u1 + 0.16, y0 + 2.36, dep - 0.26, PZ | PX); });
  b.cylinder('light_warm', (u0 + u1) / 2, y0 + h - 0.01, dep * 0.5, 0.1, 0.01, 12, { top: false, bottom: true });
  K.wallLight(b, u1 + 0.35, y0 + 2.3);
  b.withTint(E.snowTint, () => b.box('render_white', u0 + 0.3, y0, dep - 0.5, u1 - 0.3, y0 + 0.03, dep + 0.4, PY | PZ));
  if (b.collecting) { b.colBox(u0, y0, 0, u0 + 0.3, y0 + h, dep); b.colBox(u1 - 0.3, y0, 0, u1, y0 + h, dep); }
  b.pop();
}

/** Mass LOD: crane hall + annex volumes + intake / pool block + control bay. */
export function pumpMassing(spec, ctx, melt = false) {
  const G = pumpLayout(ctx, melt);
  const s = ctx.spec, b = ctx.b;
  const y0 = Math.min(0, s._ground.min) - 0.5;
  const roofColor = melt ? [0.6, 0.62, 0.64] : [0.55, 0.53, 0.5];
  const R = G.hallR;
  const vols = [massVol(R.x0, R.x1, R.z0, R.z1, y0, G.top, { floorH: G.top - G.ffl, groundH: G.top + 1, roofColor })];
  if (G.annex) { const A = G.annexR; vols.push(massVol(A.x0, A.x1, A.z0, A.z1, y0, G.annexTop, { parapet: 0.6, floorH: G.annexTop - G.ffl, groundH: G.annexTop + 0.5, roofColor })); }
  if (G.hasPool) {
    const W = G.W;
    b.push(); b.rotY(W.rot);
    massBox(b, -3, Math.min(-1.2, W.up - 1.5), -W.hd - W.gap - 1.6, 3, Math.max(0.4, W.up + 1.0), W.up + 0.9 > 0.9 ? -W.hd - 0.8 : -W.hd, [0.62, 0.6, 0.57]);
    b.pop();
  }
  return vols;
}

export { roomMap, rectFrame, SIDES };
