// 闸务站 — O-zone sluice station (O02 left): a two-storey control house on the footprint and the gate
// structure across the canal behind it (spec.meta.poolSide, default back; canal geometry from
// meta.water {dist, width} else defaults; water levels from meta.sluice {up, down}). OWNER: buildings-o.
//
// Gate structure (pool frame: local −z = towards the canal, flow along +x by default):
//   abutments + piers with rounded upstream noses, 2–5 bays by canal width; vertical lift gates in pier
//   slots, each bay open or closed from spec.hash (identical at every LOD, also in meta.gates); steel gate
//   frames above the deck hold the raised gates; grated maintenance walkway (upstream) + concrete deck
//   (downstream) with yellow railings; travelling gantry crane with a hoist over the gate line; hoist
//   gearboxes on the pier tops; stairs + caged ladders; lamp posts; hydraulic lines + cable tray.
//   Weathering: concrete darker (concrete_wet) below the highest splash line — upstream faces up to
//   up+0.35 m, downstream faces / stilling-basin walls up to down+1.1 m; algae band at the water lines in
//   the wet provinces. Stilling basin downstream (sunk floor, baffle blocks, end sill, training walls) and
//   an upstream apron with approach walls — the water renderer draws water + foam; this is the structure.
// Control house: duty room + switchgear + workshop (maintenance roller door) on the ground floor, the
// control room upstairs in a glazed bay projecting towards the gates (抬高的控制室能看见闸池), stair, roof
// plant. 'full' adds slabs, partitions, stair, consoles and colliders (gate deck walkable too).

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, oEnv, roomMap, yellowRail, grating, steelStair, cagedLadder, pipeRun, lampPost, cabinet, drift, waterInfo, utilAnchors, massVol, massBox, apron, glazedBay, siteWorks } from './o_common.js';
import { buildHall, consoleDesk, chairSimple, workbench, partition, railSimple, stairStraight, doorSpans } from './o_hall.js';
import { externalStair, equipmentYard } from './o_block.js';
import { hash4 } from '../../core/hash.js';
import { sluiceOpen } from '../../world/sluice.js';

/**
 * Bay count and open state per bay, identical at every LOD. Whether the station discharges at all is the water
 * owner's gate rule (D2: src/world/sluice.js sluiceOpen(up, down), the same function render/water/tiles.js uses for
 * the foam below the level step): a discharging station opens 1..n−1 bays chosen from spec.hash (foam below them), a
 * non-discharging one keeps every gate down (calm reach below). Without sluice levels the station discharges.
 */
export function sluiceDischarging(s) {
  const m = s._meta || s.meta || {};
  const sl = m.sluice;
  const a = sl && sl.up !== null && sl.up !== undefined ? +sl.up : NaN, c = sl && sl.down !== null && sl.down !== undefined ? +sl.down : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(c)) return true;
  return sluiceOpen(a, c);
}
export function gateLayout(s, width) {
  const n = width < 11 ? 2 : width < 21 ? 3 : width < 30 ? 4 : 5;
  const discharging = sluiceDischarging(s);
  const open = [];
  for (let i = 0; i < n; i++) open.push(discharging && (hash4(s.hash >>> 0, 0x5a7e, i, 0) & 255) < 110);
  if (discharging && !open.some((o) => o)) open[(s.hash >>> 5) % n] = true;   // at least one bay discharging
  if (open.every((o) => o)) open[n - 1] = false;                            // at least one bay regulating
  return { n, open, discharging };
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const E = oEnv(ctx);
  const W = waterInfo(ctx);
  const P = W.side;
  const w = s._w, d = s._d;
  const fh = Math.max(4.0, s._fh), nF = Math.max(2, s._floors);
  const ffl = E.ffl, T = E.wallT;
  const ySlab = ffl + fh;
  const top = ffl + nF * fh;
  const rng = ctx.sub(1401);
  const L = (side) => (isFB(side) ? w : d);
  // ---- sides: pool P, service S (roller door), main M ----
  const svcE = s._entrances.find((e) => e.kind === 'service' || e.kind === 'equipment');
  let S = svcE ? svcE.side : 'right';
  if (S === P) S = 'right';
  // duty entrance (值守入口): the spec's 'control' entrance, else 'main'; a second 'main' door on the same side opens the workshop half
  const mainE = s._entrances.find((e) => e.kind === 'control') || s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: 0 };
  const main2 = mainE.kind === 'control' ? s._entrances.find((e) => e.kind === 'main' && e.side === mainE.side) : null;
  const M = mainE.side === P || mainE.side === S ? SIDES.find((x) => x !== P && x !== S) : mainE.side;
  const ops = { front: [], right: [], back: [], left: [] };
  const room = (side, o, r) => { o.room = roomMap(ctx, side, w, d, o, r); return o; };
  // pool facade: upper floor control room bay (centred) — the bay is a separate projecting box; the wall
  // behind it gets a wide opening; ground floor: back door to the gate yard + small windows
  const LP = L(P);
  const bayW = Math.min(9, LP - 5);
  const bu0 = LP / 2 - bayW / 2, bu1 = LP / 2 + bayW / 2;
  ops[P].push(room(P, { u0: bu0 + 0.35, u1: bu1 - 0.35, v0: ySlab + 0.05, v1: ySlab + 2.75, kind: 'blank' }, { y: ySlab, h: 3, depth: 5, kind: 'office', floor: 1 }));
  const backE = s._entrances.find((e) => e.side === P && (e.kind === 'back' || e.kind === 'maintenance' || e.kind === 'service'));
  let bdu = backE ? LP / 2 + (P === 'back' || P === 'left' ? -1 : 1) * (backE.offset || 0) : LP * 0.72;
  bdu = Math.max(1.2, Math.min(LP - 1.2, bdu));
  if (bdu > LP / 2 - 1.6 && bdu < LP / 2 + 1.6) bdu = LP / 2 + 2.4;
  const backDoor = { u0: bdu - 0.55, u1: bdu + 0.55, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service', entry: true, canopy: true };
  ops[P].push(backDoor);
  for (const u of [1.6, LP - 1.6]) if (Math.abs(u - bdu) > 1.6) ops[P].push(room(P, { u0: u - 0.6, u1: u + 0.6, v0: ffl + 1.1, v1: ffl + 2.3, kind: 'win', type: 'casement' }, { y: ffl, h: 3.4, depth: 4, kind: 'office', floor: 0 }));
  // upper floor side windows on the pool facade beside the bay
  for (const u of [1.6, LP - 1.6]) ops[P].push(room(P, { u0: u - 0.7, u1: u + 0.7, v0: ySlab + 0.9, v1: ySlab + 2.4, kind: 'win', type: 'casement' }, { y: ySlab, h: 3, depth: 4, kind: 'office', floor: 1 }));
  // service side: workshop roller door + upper windows
  const LS = L(S);
  const rdW = Math.min(3.6, LS - 4);
  const roller = { u0: LS / 2 - rdW / 2 + (S === 'right' ? 1.2 : -1.2), u1: LS / 2 + rdW / 2 + (S === 'right' ? 1.2 : -1.2), v0: ffl, v1: ffl + Math.min(3.6, fh - 0.6), kind: 'roller', open: rng.next() < 0.3 ? 0.55 : 0, apron: { depth: 7, ext: 1.5 } };
  ops[S].push(roller);
  for (const u of [1.8, LS - 1.8]) ops[S].push(room(S, { u0: u - 0.7, u1: u + 0.7, v0: ySlab + 0.9, v1: ySlab + 2.4, kind: 'win', type: 'casement' }, { y: ySlab, h: 3, depth: 4, kind: 'office', floor: 1 }));
  // main side: entrance + duty-room windows + louvres (switchgear), upper office windows
  const LM = L(M);
  let du = LM / 2 + (mainE.side === M ? mainE.offset : -LM * 0.25);
  du = Math.max(1.8, Math.min(LM - 1.8, du));
  const door = { u0: du - 0.6, u1: du + 0.6, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'glazed', entry: true, plate: true };
  ops[M].push(door);
  let door2 = null;
  if (main2) {
    // facade u of an entrance offset (front / right: +offset, back / left: −offset; kit entrancePos convention)
    let u2 = LM / 2 + (M === 'back' || M === 'left' ? -1 : 1) * (main2.offset || 0);
    u2 = Math.max(1.8, Math.min(LM - 1.8, u2));
    if (Math.abs(u2 - du) > 3.0) { door2 = { u0: u2 - 0.6, u1: u2 + 0.6, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'service', entry: true, canopy: true }; ops[M].push(door2); }
  }
  const nWin = Math.max(2, Math.floor((LM - 2) / 3.4));
  for (let i = 0; i < nWin; i++) {
    const c = 1.2 + (LM - 2.4) * (i + 0.5) / nWin;
    if (Math.abs(c - du) > 1.7) ops[M].push(room(M, { u0: c - 0.75, u1: c + 0.75, v0: ffl + 0.95, v1: ffl + 2.35, kind: 'win', type: 'casement' }, { y: ffl, h: 3.6, depth: 5, kind: 'office', floor: 0 }));
    ops[M].push(room(M, { u0: c - 0.8, u1: c + 0.8, v0: ySlab + 0.9, v1: ySlab + 2.45, kind: 'win', type: 'casement' }, { y: ySlab, h: 3, depth: 5, kind: 'office', floor: 1 }));
  }
  // remaining side O: external steel stair from the gate yard up to a door into the control floor (second
  // means of escape + the walkway → stair → control-room route of shot 07), louvre at the far end
  const O = SIDES.find((x) => x !== P && x !== S && x !== M);
  const LO = L(O);
  const nP = K.facadeNormal(P);
  const endDot = (u) => { const q = K.facadePoint(O, w, d, u, 0, 0); return q[0] * nP[0] + q[2] * nP[2]; };
  const poolEnd0 = endDot(0) > endDot(LO);          // true: u = 0 is the pool-side end of side O
  const extU = poolEnd0 ? 1.6 : LO - 1.6;            // landing centre
  const extDir = poolEnd0 ? -1 : 1;                  // climb towards the pool end
  const extOk = LO >= 10;
  if (extOk) ops[O].push({ u0: extU - 0.5, u1: extU + 0.5, v0: ySlab, v1: ySlab + 2.15, kind: 'door', doorKind: 'service' });
  {
    const lu = poolEnd0 ? LO - 2.6 : 2.6;
    ops[O].push({ u0: lu - 0.9, u1: lu + 0.9, v0: ffl + 0.6, v1: ffl + 1.9, kind: 'louvre' });
    for (const u of [1.8, LO - 1.8]) if (!extOk || Math.abs(u - extU) > 1.4) ops[O].push(room(O, { u0: u - 0.7, u1: u + 0.7, v0: ySlab + 0.9, v1: ySlab + 2.4, kind: 'win', type: 'casement' }, { y: ySlab, h: 3, depth: 4, kind: 'office', floor: 1 }));
  }
  for (const side of SIDES) ops[side] = dedupe(ops[side]);
  // ---- control house shell ----
  const slabs = [], walls = [], stairs = [];
  // flood-proof board-formed concrete ground storey under the panel shell (not in the polar frost-white kit)
  const lower = E.polar ? null : { key: 'concrete_smooth', y: ySlab - 0.05, tint: [1.0, 1.0, 0.98] };
  const H = buildHall(ctx, { env: E, ffl, top, T, ops, roof: { kind: 'flat', dp: S }, slabs, walls, stairs, ceiling: 'flat', band: ySlab, parapet: 1.0, lower });
  if (extOk) externalStair(ctx, O, w, d, ySlab, { u: extU, dir: extDir, W: 1.0 });
  const I = H.inner;
  // ---- interior ('full'): upper slab, stair, partitions, rooms ----
  // stair plan (also for the 'exterior' anchors: the stair camera must not depend on the LOD)
  const stW = 1.1;
  const alongO = (O === 'left' || O === 'right') && (M === 'front' || M === 'back') && P === OPP[M] && (I.z1 - I.z0) > 11.5;
  const sgM = M === 'front' ? 1 : -1;                      // +z towards the main (street) side
  const sx0 = O === 'left' ? I.x0 + 0.06 : I.x1 - 0.06 - stW - 0.16, sx1 = sx0 + stW + 0.16;   // stair strip (x)
  const xsC = (sx0 + sx1) / 2;
  const zFoot = sgM > 0 ? I.z1 - 2.6 : I.z0 + 2.6;
  let stairCam;
  if (alongO) {
    // standing in the duty room beside the foot, level, reading flight 1 + landing + flight 2
    stairCam = { pos: [O === 'left' ? sx1 + 1.25 : sx0 - 1.25, ffl + 1.65, zFoot + sgM * 2.1], target: [xsC + (O === 'left' ? 0.25 : -0.25), ffl + 2.55, zFoot - sgM * 4.6] };
  } else {
    const run0 = Math.ceil((ySlab - ffl) / 0.18) * 0.27, sxo = I.x0 + 0.3, szo = I.z1 - 1.0;
    stairCam = { pos: [sxo + run0 + 1.6, ffl + 1.65, szo - 2.4], target: [sxo + run0 * 0.45, ffl + (ySlab - ffl) * 0.55, szo] };
  }
  if (ctx.full) {
    const rise = ySlab - ffl;
    slabs.length = 0;
    const xm = (I.x0 + I.x1) / 2;
    const zmU = (I.z0 + I.z1) / 2 + 0.6;
    const slab = (sl) => {
      for (const r of sl) { b.cbox('concrete_smooth', r.x0, ySlab - 0.25, r.z0, r.x1, ySlab, r.z1, 0.01); b.rectY('tile_floor', r.x0, r.z0, r.x1, r.z1, ySlab + 0.003, 1); if (b.collecting) b.colQuad(r.x0, ySlab, r.z1, r.x1, ySlab, r.z1, r.x1, ySlab, r.z0, r.x0, ySlab, r.z0); }
      b.withTint([0.95, 0.95, 0.94], () => { for (const r of sl) b.rectY('plaster', r.x0, r.z0, r.x1, r.z1, ySlab - 0.252, -1); });
    };
    // fix 2 (shot 07 O 楼梯): the stair runs along the side-O wall (no ground-floor doors there) from the street half
    // towards the pool half — flight, half landing, flight — with 2.6 m clear in front of the first riser, so the duty
    // door opens into the duty room (not under a flight) and the stair arrives in the control room
    if (alongO) {
      const xs = xsC;
      const runL = stairLanding(ctx, { x: xs, z: zFoot, y0: ffl, rise, rot: sgM > 0 ? Math.PI / 2 : -Math.PI / 2, W: stW, landing: 1.2 });
      const zEnd = zFoot - sgM * runL;
      const zWell = zFoot - sgM * 2.9;                       // headroom ≥ 2.1 m under the slab from here on
      const zlo = (a, c) => Math.min(a, c), zhi = (a, c) => Math.max(a, c);
      const inX0 = O === 'left' ? sx1 : I.x0, inX1 = O === 'left' ? I.x1 : sx0;
      slab([
        { x0: inX0, x1: inX1, z0: I.z0, z1: I.z1 },
        { x0: O === 'left' ? I.x0 : sx0, x1: O === 'left' ? sx1 : I.x1, z0: sgM > 0 ? zWell : I.z0, z1: sgM > 0 ? I.z1 : zWell },
        { x0: O === 'left' ? I.x0 : sx0, x1: O === 'left' ? sx1 : I.x1, z0: sgM > 0 ? I.z0 : zEnd, z1: sgM > 0 ? zEnd : I.z1 },
      ]);
      const xe = O === 'left' ? sx1 + 0.03 : sx0 - 0.03;
      railSimple(b, [[xe, ySlab, zlo(zWell, zEnd) + 0.05], [xe, ySlab, zhi(zWell, zEnd) - 0.05]]);
      railSimple(b, [[O === 'left' ? I.x0 + 0.05 : sx0, ySlab, zWell], [O === 'left' ? sx1 : I.x1 - 0.05, ySlab, zWell]]);
      // ground floor: duty room / switchgear partition stops at the stair strip, workshop partition as before
      partition(ctx, { x0: xm, z0: I.z0, x1: xm, z1: I.z1 - 2.4, y0: ffl, y1: ySlab - 0.25, doors: [{ at: (I.z1 - 2.4 - I.z0) - 1.2, w: 1.0 }] });
      const px0 = O === 'left' ? sx1 + 0.05 : I.x0, px1 = O === 'left' ? xm : Math.min(xm, sx0 - 0.05);
      partition(ctx, { x0: px0, z0: (I.z0 + I.z1) / 2 - 0.5, x1: px1, z1: (I.z0 + I.z1) / 2 - 0.5, y0: ffl, y1: ySlab - 0.25, doors: [{ at: (px1 - px0) * 0.6, w: 1.0 }] });
      // upper floor: control room (pool half) / office (street half)
      const ux0 = O === 'left' ? sx1 + 0.05 : I.x0, ux1 = O === 'left' ? I.x1 : sx0 - 0.05;
      partition(ctx, { x0: ux0, z0: zmU, x1: ux1, z1: zmU, y0: ySlab, y1: top - 0.35, doors: [{ at: O === 'left' ? 1.2 : ux1 - ux0 - 2.2, w: 1.0, glazed: true }] });
    } else {
      // stair in the corner by the main entrance (old layout: building frame, along x)
      const n = Math.ceil(rise / 0.18), run = n * 0.27;
      const sxo = I.x0 + 0.3, sz = I.z1 - 1.0;
      const wellX1 = sxo + run - 0.25, wellZ0 = sz - 0.75;          // slab edge at the last riser (no gap at the arrival)
      slab([{ x0: I.x0, x1: I.x1, z0: I.z0, z1: wellZ0 }, { x0: wellX1, x1: I.x1, z0: wellZ0, z1: I.z1 }]);
      stairStraight(ctx, { x: sxo, z: sz, y0: ffl, rise, dir: 0, W: stW });
      railSimple(b, [[sxo, ySlab, wellZ0 + 0.04], [wellX1, ySlab, wellZ0 + 0.04]]);
      partition(ctx, { x0: xm, z0: I.z0, x1: xm, z1: I.z1 - 2.4, y0: ffl, y1: ySlab - 0.25, doors: [{ at: (I.z1 - 2.4 - I.z0) - 1.2, w: 1.0 }] });
      partition(ctx, { x0: I.x0, z0: (I.z0 + I.z1) / 2 - 0.5, x1: xm, z1: (I.z0 + I.z1) / 2 - 0.5, y0: ffl, y1: ySlab - 0.25, doors: [{ at: (xm - I.x0) * 0.75, w: 1.0 }] });
      partition(ctx, { x0: wellX1 + 0.1, z0: zmU, x1: I.x1, z1: zmU, y0: ySlab, y1: top - 0.35, doors: [{ at: 1.2, w: 1.0, glazed: true }] });
    }
    // furniture: the console row stands IN the glazed bay against the upstand, operators facing the gates
    // (抬高的控制室能看见闸池); the monitors sit low under the sill line
    const dOut = 2.1 - 0.4 - 0.36;
    const pcp = K.facadePoint(P, w, d, LP / 2, ySlab, dOut), chp = (du) => K.facadePoint(P, w, d, LP / 2 + du, ySlab, dOut - 0.95);
    const rotD = P === 'back' ? 0 : P === 'front' ? Math.PI : P === 'left' ? Math.PI / 2 : -Math.PI / 2;
    consoleDesk(b, pcp[0], ySlab + 0.05, pcp[2], 3.6, rotD);
    { const c1 = chp(-0.8), c2 = chp(0.8); chairSimple(b, c1[0], ySlab + 0.05, c1[2], rotD); chairSimple(b, c2[0], ySlab + 0.05, c2[2], rotD + 0.3); }
    for (let k = 0; k < 5; k++) cabinet(b, I.x0 + 0.6 + k * 0.85, ffl, I.z0 + 0.4, 0.8, 2.1, 0.55, 0, 'hvac');
    workbench(b, I.x1 - 1.6, ffl, I.z0 + 0.5, 2.2, 0);
  }
  // ---- projecting control-room bay (glazed on three sides) on the pool facade ----
  glazedBay(ctx, P, bu0, bu1, ySlab, top + 0.2, E, { dep: 2.1, roomDepth: 5 });
  // ---- roof plant ----
  {
    const yr = top;
    K.hvacUnit(b, I.x1 - 1.8, yr, I.z1 - 1.2, 0, { w: 2.0, d: 1.0, h: 1.0 });
    K.antennaMast(b, I.x0 + 1.0, yr, I.z0 + 1.0, 5.5, s.hash);
    K.roofHatch(b, I.x0 + 2.4, yr, I.z1 - 1.4, {});
    // signal beacon / siren on a short mast at the pool-side parapet (spill warning)
    const bp = K.facadePoint(P, w, d, LP * 0.15, yr, -0.8);
    b.cylinder('steel', bp[0], yr, bp[2], 0.05, 2.2, 8, { top: true });
    b.cbox('steel_yellow', bp[0] - 0.18, yr + 2.2, bp[2] - 0.18, bp[0] + 0.18, yr + 2.45, bp[2] + 0.18, 0.01);
    b.cylinder('light_red', bp[0], yr + 2.45, bp[2], 0.1, 0.18, 10, { top: true });
  }
  // ---- gate structure + canal works ----
  const G = gateStructure(ctx, W, E, rng);
  // ---- ground works: basalt retaining terraces where the bank rises above the floor, levelled pad skirt ----
  siteWorks(ctx, ffl, { pad: !!W.pad, doors: Object.fromEntries(SIDES.map((sd) => [sd, doorSpans(H.opsBySide[sd]).map(([a, c]) => [a - 0.4, c + 0.4])])) });
  // ---- 背侧设备院: equipment yard behind the house (transformer kiosk, hydraulic power unit, standby tank) in the
  // widest free stretch of the pool facade (clear of the yard door landing and the deck access) ----
  {
    const toU = (x) => W.hw - x;          // pool-frame x → pool facade u
    const busy = [[bdu - 2.0, bdu + 2.0]];
    if (G.access) for (const [x0, x1] of G.access) { const a = toU(x0), c = toU(x1); busy.push([Math.min(a, c) - 1.0, Math.max(a, c) + 1.0]); }
    busy.sort((p, q) => p[0] - q[0]);
    // fix 2: the yard may run up to 4.5 m past the facade end on the service side (S: roller-door apron in front of
    // that facade, never behind the pool facade) — the deck access stair + back door often leave no 5.5 m stretch
    const nS = K.facadeNormal(S), dS = (u) => { const q = K.facadePoint(P, w, d, u, 0, 0); return q[0] * nS[0] + q[2] * nS[2]; };
    const sEnd0 = dS(0) > dS(LP);
    const uLo = sEnd0 ? -4.5 : 0.4, uHi = sEnd0 ? LP - 0.4 : LP + 4.5;
    let u = uLo, best = null;
    for (const [a, c] of [...busy, [uHi, uHi + 9]]) { const a2 = Math.min(a, uHi); if (a2 - u > (best ? best[1] - best[0] : 5.0)) best = [u, a2]; u = Math.max(u, c); }
    if (best && W.gap > 7.5) { equipmentYard(ctx, P, w, d, best[0], best[1], { depth: Math.min(6, W.gap - 2.2), container: best[1] - best[0] > 11.5 }); G.yardU = best; G.yardD = Math.min(6, W.gap - 2.2); }
  }
  // ---- climate dressing ----
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', skip: doorSpans(H.opsBySide[E.lee]) });
  if (E.polar) drift(ctx, E.lee, { kind: 'snow', skip: doorSpans(H.opsBySide[E.lee]) });
  // ---- anchors (shot 07, O variant: 检修道 → 值守入口 → 楼梯 → 控制室观察窗 → 背侧设备院) ----
  const C = {};
  C.gate = { pos: G.walkCam, target: G.deckCenter };
  // 检修道 (fix 2): on the near abutment's maintenance way just downstream of the deck end, inside the guard rail,
  // looking along the deck's downstream rail across the canal (pitch ≈ −12°): the retained pool beyond the raised
  // leaves / frames (≈ 1 m under the deck), the open bays discharging into the stilling basin far below (water
  // renderer jets + roller), pier ends and gantry — both levels and the flow direction in one frame
  C.walkway = G.walkView;
  // 控制室观察窗 (fix 2): standing just inside the bay opening behind the operators' chairs, looking through the bay
  // glazing (mullions, sill rail, the console row low in the frame) diagonally over the gate line: the retained pool
  // against the leaves upstream, raised leaves of the open bays, the deck / walkway and the gangway to it — the same
  // retained level as from the walkway (a levee / abutment hides the basin from this house; the walkway shows it)
  const eyeY = ySlab + 1.7;
  {
    // offset towards the upstream end of the bay, so the view runs diagonally downstream over the gates
    const xPool = (p) => p[0] * Math.cos(W.rot) - p[2] * Math.sin(W.rot);
    const pa = K.facadePoint(P, w, d, LP / 2 + 2.6, eyeY, -0.4), pb = K.facadePoint(P, w, d, LP / 2 - 2.6, eyeY, -0.4);
    C.control = { pos: W.flow * xPool(pa) < W.flow * xPool(pb) ? pa : pb, target: G.controlLook };
  }
  // 楼梯 (fix 2): level camera on the ground floor beside the stair foot reading flight + landing + flight
  if (stairCam) C.stair = stairCam;
  // 背侧设备院 (fix 2): standing off the service-side end of the yard, looking along the pool facade over the yard
  // plant (transformer kiosk, tank, container, lamp) to the back door, the glazed control bay above and the deck
  // access stair beyond
  {
    const yu0 = G.yardU ? G.yardU[0] : LP * 0.15, yu1 = G.yardU ? G.yardU[1] : LP * 0.45, yd = G.yardD || 4;
    const sEnd0 = yu0 < LP / 2;                                // the yard sits at the u = 0 end
    const cu = sEnd0 ? yu0 - 2.0 : yu1 + 2.0;
    // (on a levelled pad the camera stays on the pad: the bank falls away beyond it)
    const bp = K.facadePoint(P, w, d, cu, 0, W.pad ? Math.min(yd + 0.5, W.gap - 2.5) : Math.max(yd + 1.0, Math.min(yd + 4.5, W.gap * 0.5)));
    const gy = K.groundAt(s, bp[0], bp[2]);
    bp[1] = gy + 1.65;
    const tu = sEnd0 ? yu1 + 2.4 : yu0 - 2.4;
    C.back = { pos: bp, target: K.facadePoint(P, w, d, tu, gy + 2.3, 1.0) };
  }
  const ctlE = s._entrances.find((e) => e.kind === 'control' && e.side === M);
  utilAnchors(ctx, {
    ffl, roofY: top, access: [I.x0 + 2.4, top, I.z1 - 1.4],
    floors: [{ level: 0, y: ffl, height: fh }, { level: 1, y: ySlab, height: top - ySlab }],
    entrances: [
      { kind: ctlE ? 'control' : 'main', side: M, pos: K.facadePoint(M, w, d, du, ffl, 0.6), dir: K.facadeNormal(M), width: 1.2 },
      { kind: 'back', side: P, pos: K.facadePoint(P, w, d, bdu, ffl, 0.6), dir: K.facadeNormal(P), width: 1.1 },
      { kind: 'service', side: S, pos: K.facadePoint(S, w, d, (roller.u0 + roller.u1) / 2, ffl, 0.6), dir: K.facadeNormal(S), width: rdW },
    ],
    rooms: [
      { floor: 0, name: 'duty room', kind: 'office', center: [0, ffl, 0], size: [w / 2, fh, d / 2] },
      { floor: 1, name: 'control room', kind: 'office', center: K.facadePoint(P, w, d, LP / 2, ySlab, -3), size: [bayW, top - ySlab, 5] },
    ],
    cameras: C,
  });
  b.anchors.cameras.stair = C.stair;
  b.anchors.cameras.living = C.control;
  b.anchors.cameras.back = C.back;
  if (G.walkFoot) b.anchors.walk = { walkway: G.walkView.pos.map((v, i) => (i === 1 ? v - 1.65 : v)), yardStair: G.walkFoot, deckY: G.deckY };
  b.meta.gates = { bays: G.n, open: G.open, discharging: G.open.some((o) => o), kind: 'vertical-lift', side: P, gateX: G.gx };
  b.meta.water = { side: P, gap: W.gap, width: W.width, up: W.up, down: W.down, flow: W.flow, deck: W.deck, explicit: W.explicit, pad: W.pad ? W.pad.y : null };
}

/**
 * Straight steel stair with a half landing (flight · landing · flight, the same tread / rail language as o_hall
 * stairStraight). Foot at (x, z) on y0, climbing along local +x turned by `rot` (MeshBuilder.rotY: π/2 → −z).
 * Side colliders are walls from the floor (closed stair strip, entered at the foot). Returns the run length.
 */
function stairLanding(ctx, st) {
  const b = ctx.b;
  const n = Math.max(4, Math.ceil(st.rise / 0.18)), h = st.rise / n, tr = 0.27, W = st.W ?? 1.1, Lg = st.landing ?? 1.2;
  const n1 = Math.ceil(n / 2), n2 = n - n1;
  const xL0 = (n1 - 1) * tr, xL1 = xL0 + Lg, yL = n1 * h;          // landing
  const runL = xL1 + (n2 - 1) * tr;                                 // arrival (last riser) at the upper floor edge
  b.push(); b.translate(st.x, st.y0, st.z); b.rotY(st.rot || 0);
  const tread = (x0, yt) => {
    b.box('grille_dark', x0, yt - 0.04, -W / 2, x0 + tr + 0.02, yt, W / 2, PY | NY | PX | NX);
    b.box('steel', x0 + tr - 0.02, yt - 0.05, -W / 2, x0 + tr + 0.02, yt, W / 2, PX | PY | NX);
  };
  for (let i = 0; i < n1 - 1; i++) tread(i * tr, (i + 1) * h);
  for (let j = 0; j < n2 - 1; j++) tread(xL1 + j * tr, yL + (j + 1) * h);
  // landing: grating in a steel frame on two posts (inner side) + a cross beam into the wall
  grating(b, xL0, -W / 2, xL1, W / 2, yL);
  b.box('steel_dark', xL0, yL - 0.2, -W / 2 - 0.05, xL1, yL - 0.04, -W / 2, ALL);
  b.box('steel_dark', xL0, yL - 0.2, W / 2, xL1, yL - 0.04, W / 2 + 0.05, ALL);
  for (const xx of [xL0 + 0.06, xL1 - 0.06]) b.box('steel', xx - 0.05, 0, W / 2 - 0.02, xx + 0.05, yL - 0.2, W / 2 + 0.08, PX | NX | PZ | NZ);
  // stringers per flight
  const flights = [[0, 0, xL0 + tr * 0.0, yL], [xL1, yL, runL, st.rise]];
  for (const [xa, ya, xb, yb] of flights) {
    const ang = Math.atan2(yb - ya, xb - xa + tr), len = Math.hypot(yb - ya, xb - xa + tr);
    for (const sz of [-W / 2 - 0.03, W / 2 + 0.03]) { b.push(); b.translate(xa, ya - 0.06, sz); b.rotZ(ang); b.box('steel_dark', -0.05, -0.2, -0.025, len, 0.04, 0.025, ALL); b.pop(); }
  }
  // handrails both sides along flight · landing · flight (posts at the flight ends + landing corners)
  for (const sz of [-W / 2 - 0.05, W / 2 + 0.05]) {
    const pts = [[0, 1.0, sz], [xL0, yL + 1.0, sz], [xL1, yL + 1.0, sz], [runL, st.rise + 1.0, sz]];
    b.tube('steel_yellow', pts, 0.022, 8);
    b.tube('steel_yellow', pts.map((p) => [p[0], p[1] - 0.5, p[2]]), 0.016, 6);
    for (const [px, py] of [[0, 0], [xL0 * 0.5, yL * 0.5], [xL0, yL], [xL1, yL], [(xL1 + runL) / 2, (yL + st.rise) / 2], [runL, st.rise]]) b.box('steel_yellow', px - 0.02, py, sz - 0.02, px + 0.02, py + 1.0, sz + 0.02, PX | NX | PZ | NZ);
  }
  if (b.collecting) {
    b.colQuad(0, 0, W / 2, xL0, yL, W / 2, xL0, yL, -W / 2, 0, 0, -W / 2);
    b.colQuad(xL0, yL, W / 2, xL1, yL, W / 2, xL1, yL, -W / 2, xL0, yL, -W / 2);
    b.colQuad(xL1, yL, W / 2, runL, st.rise, W / 2, runL, st.rise, -W / 2, xL1, yL, -W / 2);
    for (const [za, zb] of [[W / 2 + 0.03, W / 2 + 0.08], [-W / 2 - 0.08, -W / 2 - 0.03]]) {
      b.colBox(0, 0, za, xL0, yL + 1.0, zb); b.colBox(xL0, 0, za, xL1, yL + 1.0, zb); b.colBox(xL1, 0, za, runL, st.rise + 1.0, zb);
    }
  }
  b.pop();
  return runL;
}

function dedupe(list) {
  const out = [];
  const pri = (o) => (o.kind === 'blank' ? -1 : o.kind === 'roller' ? 0 : o.kind === 'door' ? 1 : o.kind === 'louvre' ? 2 : 3);
  for (const o of list.slice().sort((a, c) => pri(a) - pri(c))) {
    if (out.some((q) => o.u0 < q.u1 + 0.3 && o.u1 > q.u0 - 0.3 && o.v0 < q.v1 + 0.2 && o.v1 > q.v0 - 0.2)) continue;
    out.push(o);
  }
  return out;
}

/**
 * Gate structure across the canal (pool frame). Every level follows waterInfo (urban meta.sluice / meta.water, the
 * levels the water renderer draws): retained (upstream) level `up`, tail level `down`, deck with freeboard over `up`,
 * sill on the upstream bed, a glacis / drop from the sill into a stilling basin on the tail bed (steep for big steps),
 * training walls just over the tail water, approach walls up to the bank. The gate line sits on the hydro level step
 * (urban centres the station on the sluice: building x = 0). Returns layout info for anchors.
 */
function gateStructure(ctx, W, E, rng) {
  const b = ctx.b, s = ctx.spec;
  b.push(); b.rotY(W.rot);
  const hd = W.hd;
  const zE = -hd - W.gap;                    // near bank (quay face)
  const zF = zE - W.width;                   // far bank
  const up = W.up, down = W.down;
  const fl = W.flow;                          // +1: flow along +x (upstream at −x)
  const yD = W.deck;                          // deck top (≥ 1.1 m over the retained level)
  const yardY = W.yard;
  const bedU = W.bedU, bedD = W.bedD;
  const footY = Math.min(bedU, bedD) - 1.2;   // pier / abutment foundations (buried)
  const xg = 0;                               // gate line (slots) on the level step
  const gx = xg + fl * 1.4;                   // structure centre: piers 3.6 m upstream / 6.4 m downstream of the slots
  const { n, open } = gateLayout(s, W.width);
  const tp = 1.5;                             // pier thickness
  const bw = (W.width - (n - 1) * tp) / n;    // clear bay width
  const Lp = 10;                              // pier length along the flow
  const xU = gx - fl * Lp / 2, xDn = gx + fl * Lp / 2;   // upstream nose / downstream end
  const wetU = up + 0.35, wetD = down + 1.1;   // highest splash lines
  const lo = (a, c) => Math.min(a, c), hi = (a, c) => Math.max(a, c);
  // training walls (downstream) stand just over the tail water / up to the yard, approach walls up to the bank
  const tD = Math.min(Math.max(down + 1.6, Math.min(yardY + 0.05, yD - 0.3)), down + 6);
  const tU = Math.max(up + 0.6, Math.min(yardY + 0.05, yD - 0.3));
  // ---- bays / piers (z ranges, from the near bank towards −z) ----
  const bays = [], piers = [];
  let z = zE;
  for (let i = 0; i < n; i++) {
    bays.push([z - bw, z]);
    z -= bw;
    if (i < n - 1) { piers.push([z - tp, z]); z -= tp; }
  }
  // ---- piers: wet / dry split at the splash lines, rounded upstream nose ----
  for (const [pz0, pz1] of piers) pier(b, pz0, pz1, xU, xDn, xg, fl, footY, yD, wetU, wetD, up, down, E);
  // ---- abutments on both banks (wide piers merged into the quay walls) ----
  for (const [za, zb, side] of [[zE, zE + 2.6, 1], [zF - 2.6, zF, -1]]) {
    const x0 = lo(xU, xDn) - 3.0, x1 = hi(xU, xDn) + 3.0;
    const faceZ = side > 0 ? za : zb;           // face towards the water
    b.box('concrete', x0, wetU, za, x1, yD, zb, PY | PX | NX | (side > 0 ? NZ : PZ));
    b.box('concrete_wet', x0, footY - 1.0, za, x1, wetU, zb, PX | NX | (side > 0 ? NZ : PZ));
    if (E.wet) b.withTint(E.algaeTint, () => b.rectZ('concrete_wet', x0, up - 0.3, x1, up + 0.12, faceZ + (side > 0 ? -0.006 : 0.006), side > 0 ? -1 : 1));
    b.cbox('concrete_smooth', x0 - 0.05, yD, za - 0.05, x1 + 0.05, yD + 0.12, zb + 0.05, 0.015);
    if (b.collecting) b.colBox(x0, footY, za, x1, yD + 0.12, zb);
  }
  // ---- gate slots: guides in the pier faces + gates (sill on the upstream bed) ----
  const gateTop = up + 0.45, gateBot = bedU + 0.15;
  const lift = yD + 2.6 - gateTop;               // raised gate top ends 2.6 m above the deck
  for (let i = 0; i < n; i++) {
    const [z0, z1] = bays[i];
    const op = open[i];
    for (const zz of [z0, z1]) b.box('steel_dark', xg - 0.32, bedU, zz - 0.06, xg + 0.32, yD, zz + 0.06, PX | NX | (zz === z0 ? PZ : NZ));
    const dy = op ? lift : 0;
    gate(b, xg, z0 + 0.04, z1 - 0.04, gateBot + dy, gateTop + dy, up, fl, E, op);
    b.box('steel', xg - 0.3, bedU, z0, xg + 0.3, bedU + 0.15, z1, PY | PX | NX);
  }
  // ---- gate frames above the deck (portal per pier line) holding raised gates, hoist gear on pier tops ----
  const frameTop = yD + 3.4;
  const pierLines = [zE + 0.3, ...piers.map(([a, c]) => (a + c) / 2), zF - 0.3];
  for (const pz of pierLines) {
    for (const xo of [xg - 0.42, xg + 0.42]) b.cbox('steel_dark', xo - 0.11, yD, pz - 0.18, xo + 0.11, frameTop, pz + 0.18, 0.01);
    b.withTint([0.45, 0.58, 0.72], () => b.cbox('steel_dark', xg + fl * 0.7 - 0.35, yD + 0.12, pz - 0.45, xg + fl * 0.7 + 0.35, yD + 0.85, pz + 0.45, 0.02));
    b.cylinder('steel', xg + fl * 0.7, yD + 0.85, pz, 0.12, 0.25, 10, { top: true });
  }
  for (let i = 0; i < n; i++) {
    const [z0, z1] = bays[i];
    for (const xo of [xg - 0.42, xg + 0.42]) b.box('steel_dark', xo - 0.1, frameTop - 0.32, z0 - 0.4, xo + 0.1, frameTop, z1 + 0.4, ALL);
    b.push(); b.translate(xg, frameTop + 0.25, (z0 + z1) / 2); b.rotX(Math.PI / 2);
    b.withTint([0.45, 0.58, 0.72], () => b.lathe('steel_dark', [[0.22, -bw * 0.3], [0.22, bw * 0.3]], 14, { capTop: true, capBottom: true }));
    b.pop();
    const gTop = gateTop + (open[i] ? lift : 0);
    for (const zz of [z0 + 0.6, z1 - 0.6]) b.cylinder('steel', xg, gTop + 0.25, zz, 0.018, frameTop - gTop - 0.25, 5, { top: false });
  }
  // ---- deck: grated maintenance walkway upstream of the slots, concrete deck downstream ----
  const zDeck0 = zF + 0.0, zDeck1 = zE;
  const xw0 = xg - fl * 0.42 - fl * 0.12, xw1 = xg - fl * 2.4;     // walkway (upstream)
  const xd0 = xg + fl * 0.55, xd1 = xg + fl * 5.2;                 // deck (downstream)
  grating(b, lo(xw0, xw1), zDeck0, hi(xw0, xw1), zDeck1, yD);
  b.cbox('concrete_smooth', lo(xd0, xd1), yD - 0.7, zDeck0, hi(xd0, xd1), yD, zDeck1, 0.015);
  if (b.collecting) b.colQuad(lo(xd0, xd1), yD, zDeck1, hi(xd0, xd1), yD, zDeck1, hi(xd0, xd1), yD, zDeck0, lo(xd0, xd1), yD, zDeck0);
  for (const [z0, z1] of bays) b.box('concrete_wet', lo(xw0, xw1), yD - 0.6, z0, hi(xw0, xw1), yD - 0.16, z1, NY | PX | NX);
  for (const [pz0, pz1] of piers) b.cbox('concrete_smooth', lo(xU, xDn), yD - 0.05, pz0 - 0.05, hi(xU, xDn), yD + 0.1, pz1 + 0.05, 0.015);
  yellowRail(b, [[xw1, yD, zDeck0 + 0.1], [xw1, yD, zDeck1 - 0.1]]);
  yellowRail(b, [[xd1, yD, zDeck0 + 0.1], [xd1, yD, zDeck1 - 0.1]]);
  for (const [z0, z1] of bays) {
    yellowRail(b, [[xg - fl * 0.5, yD, z0 + 0.15], [xg - fl * 0.5, yD, z1 - 0.15]], { toe: true });
    yellowRail(b, [[xg + fl * 0.5, yD, z0 + 0.15], [xg + fl * 0.5, yD, z1 - 0.15]], { toe: true });
  }
  // ---- travelling gantry crane over the gate line (legs on rails along the abutments) ----
  gantry(b, xg, zE + 1.3, zF - 1.3, yD + 0.12, frameTop + 3.4, rng, bays, fl);
  // ---- glacis / drop from the sill into the stilling basin on the tail bed ----
  const basinBed = bedD - 1.0;
  const drop = Math.max(0, bedU - basinBed);
  const xc0 = xg + fl * 0.35;                                 // sill end (just downstream of the slot)
  const chute = Math.max(1.2, drop * (drop > 4 ? 0.7 : 1.2));  // steep drop for big steps, glacis for small ones
  const xc1 = xc0 + fl * chute;
  const Lb = Math.max(12, 6 + drop * 1.4);
  const xb0 = xc1, xb1 = xc1 + fl * Lb;
  // crest slab between the piers (upstream nose → sill end) on the upstream bed
  b.box('concrete_wet', lo(xU, xc0), bedU - 0.4, zF, hi(xU, xc0), bedU, zE, PY);
  // chute face (both windings so it reads from either flow direction)
  if (fl > 0) b.quad('concrete_wet', xc0, bedU, zF, xc0, bedU, zE, xc1, basinBed, zE, xc1, basinBed, zF);
  else b.quad('concrete_wet', xc0, bedU, zE, xc0, bedU, zF, xc1, basinBed, zF, xc1, basinBed, zE);
  b.box('concrete_wet', lo(xb0, xb1), basinBed - 0.4, zF, hi(xb0, xb1), basinBed, zE, PY);
  for (let r = 0; r < 2; r++) {
    const xr = xb0 + fl * (4 + r * 2.4);
    const nb = Math.max(3, Math.round(W.width / 2.2));
    for (let k = 0; k < nb; k++) {
      if ((k + r) % 2) continue;
      const zc = zF + (W.width * (k + 0.5)) / nb;
      b.cbox('concrete_wet', xr - 0.5, basinBed, zc - 0.55, xr + 0.5, basinBed + 0.9, zc + 0.55, 0.06, false);
    }
  }
  b.box('concrete_wet', lo(xb1 - fl * 1.2, xb1), basinBed, zF, hi(xb1 - fl * 1.2, xb1), bedD + 0.5, zE, PY | PX | NX);
  // training walls along both banks (downstream) and approach walls (upstream)
  for (const [zw0, zw1, sgn] of [[zE, zE + 0.6, 1], [zF - 0.6, zF, -1]]) {
    const x0 = lo(xDn, xb1), x1 = hi(xDn, xb1);
    const wd = Math.min(wetD, tD - 0.05);
    b.box('concrete', x0, wd, zw0, x1, tD, zw1, PY | PX | NX | (sgn > 0 ? NZ : PZ));
    b.box('concrete_wet', x0, basinBed - 0.4, zw0, x1, wd, zw1, PX | NX | (sgn > 0 ? NZ : PZ));
    if (E.wet) b.withTint(E.algaeTint, () => b.rectZ('concrete_wet', x0, down - 0.3, x1, down + 0.15, (sgn > 0 ? zw0 - 0.006 : zw1 + 0.006), sgn > 0 ? -1 : 1));
    b.cbox('concrete_smooth', x0 - 0.02, tD, zw0 - 0.05, x1 + 0.02, tD + 0.12, zw1 + 0.05, 0.01);
    yellowRail(b, [[x0 + 0.2, tD + 0.12, (zw0 + zw1) / 2], [x1 - 0.2, tD + 0.12, (zw0 + zw1) / 2]]);
    const u0 = lo(xU - fl * 9, xU), u1 = hi(xU - fl * 9, xU);
    b.box('concrete', u0, wetU, zw0, u1, tU, zw1, PY | PX | NX | (sgn > 0 ? NZ : PZ));
    b.box('concrete_wet', u0, bedU - 0.2, zw0, u1, wetU, zw1, PX | NX | (sgn > 0 ? NZ : PZ));
    if (E.wet) b.withTint(E.algaeTint, () => b.rectZ('concrete_wet', u0, up - 0.3, u1, up + 0.12, (sgn > 0 ? zw0 - 0.006 : zw1 + 0.006), sgn > 0 ? -1 : 1));
    b.cbox('concrete_smooth', u0 - 0.02, tU, zw0 - 0.05, u1 + 0.02, tU + 0.12, zw1 + 0.05, 0.01);
    if (b.collecting) { b.colBox(x0, basinBed, zw0, x1, tD + 1.2, zw1); b.colBox(u0, bedU, zw0, u1, tU + 1.2, zw1); }
  }
  // upstream apron (bed slab)
  b.box('concrete_wet', lo(xU - fl * 9, xU), bedU - 0.3, zF, hi(xU - fl * 9, xU), bedU, zE, PY);
  // (the jets / boil of the OPEN bays are drawn by the water renderer — render/water/sluicejet.js replicates this
  // structure's pool frame, levels, bays and chute; keep gateLayout / waterInfo / the chute geometry in sync with it)
  // ---- access from the yard to the deck (检修道): steps for a low deck, a steel stair + gangway otherwise ----
  const rise = yD + 0.12 - yardY;
  const zA = zE + 2.6;                           // land edge of the near abutment
  let walkFoot = null;
  const accessX = [];
  if (rise <= 1.3) {
    accessX.push([lo(xd0, xd1) - 1.0, hi(xd0, xd1) + 1.0]);
    const sx = lo(xd0, xd1) + 0.4, ex = hi(xd0, xd1) - 0.4;
    const nS = Math.max(1, Math.ceil(rise / 0.16));
    for (let i = 0; i < nS; i++) {
      const yt = yardY + (rise * (i + 1)) / nS, z0 = zA + (nS - 1 - i) * 0.3;
      b.cbox('stone_step', sx, yardY - 0.3, z0, ex, yt, z0 + 0.3, 0.01, false);
    }
    if (b.collecting) b.colQuad(sx, yardY, zA + nS * 0.3, ex, yardY, zA + nS * 0.3, ex, yD + 0.12, zA, sx, yD + 0.12, zA);
    b.cbox('concrete', lo(xd0, xd1) - 1.0, yardY - 0.4, zA, hi(xd0, xd1) + 1.0, yardY - 0.01, -hd, 0.01, false);
    if (b.collecting) b.colQuad(lo(xd0, xd1) - 1.0, yardY, -hd, hi(xd0, xd1) + 1.0, yardY, -hd, hi(xd0, xd1) + 1.0, yardY, zA, lo(xd0, xd1) - 1.0, yardY, zA);
    walkFoot = [(xd0 + xd1) / 2, yardY, (zA - hd) / 2];
  } else {
    // stair parallel to the bank beside the house (foot on the yard), flights of ≤ 16 risers with grated landings,
    // top landing + gangway (service bridge) at deck level onto the abutment top; steel posts down to the lower
    // ground (the bank may fall into a cutting or rise to a levee: posts simply run into the ground)
    const Ws = 1.2;
    const zcs = Math.max(zA + 0.8 + Ws / 2, -hd - 3.2 - Ws / 2);   // clear of the yard door landing
    const xTop = gx;                             // landing at the deck centre
    const yTop = yD + 0.12;
    const doorX = -W.hw * 0.4;                   // foot towards the house's yard door side
    const sd = doorX < xTop ? -1 : 1;            // foot at xTop + sd·(totRun + 0.8)
    // fix 2: the foot stands on the (spec-extrapolated) ground at the foot, not on the house yard level — sloping
    // banks left the last tread hanging ~1 m over the ground (or buried); the paved path ramps from the house to it
    const cR = Math.cos(W.rot), sR = Math.sin(W.rot);
    const gPool = (px, pz) => K.groundAt(s, px * cR + pz * sR, -px * sR + pz * cR);
    let fls, totRun, footY = yardY;
    for (let it = 0; it < 3; it++) {
      const riseS = yTop - footY, nFl = Math.max(1, Math.ceil(riseS / 3.0));
      fls = [];
      for (let k = 0; k < nFl; k++) { const fr = riseS / nFl; const nn = Math.max(2, Math.ceil(fr / 0.19)); fls.push({ fr, run: (nn - 1) * 0.25 }); }
      totRun = fls.reduce((a, f) => a + f.run, 0) + (nFl - 1) * 1.3;
      footY = Math.max(yardY - 2.5, Math.min(yardY + 1.2, yTop - 0.6, gPool(xTop + sd * (0.8 + totRun + 0.4), zcs) + 0.05));
    }
    const nFl = fls.length;
    const postY = Math.min(footY, yardY, down + 0.5) - 0.3;
    const post = (xx, zz, yy) => { if (yy - postY > 0.5) b.box('steel', xx - 0.055, postY, zz - 0.055, xx + 0.055, yy, zz + 0.055, PX | NX | PZ | NZ); };
    let x = xTop + sd * (0.8 + totRun), y = footY;
    for (let k = 0; k < nFl; k++) {
      const f = fls[k];
      const top = steelStair(b, { x, z: zcs, y0: y, rise: f.fr, dir: sd > 0 ? Math.PI : 0, W: Ws, rails: 'both' });
      const xm = (x + top[0]) / 2;
      for (const zz of [zcs - Ws / 2, zcs + Ws / 2]) post(xm, zz, y + f.fr * 0.5 - 0.35);
      x = top[0]; y += f.fr;
      if (k < nFl - 1) {
        const xa = x, xb = x - sd * 1.3;
        grating(b, lo(xa, xb), zcs - Ws / 2, hi(xa, xb), zcs + Ws / 2, y);
        for (const xx of [xa, xb]) for (const zz of [zcs - Ws / 2 + 0.06, zcs + Ws / 2 - 0.06]) post(xx, zz, y - 0.16);
        yellowRail(b, [[xa, y, zcs + Ws / 2 - 0.05], [xb, y, zcs + Ws / 2 - 0.05]]);
        yellowRail(b, [[xa, y, zcs - Ws / 2 + 0.05], [xb, y, zcs - Ws / 2 + 0.05]]);
        x = xb;
      }
    }
    // top landing (x around xTop) + gangway (−z) onto the abutment top
    const la = xTop - 0.8, lb = xTop + 0.8;
    grating(b, la, zA - 0.2, lb, zcs + Ws / 2, yTop);
    for (let zz = zcs + Ws / 2 - 0.1; zz > zA + 0.1; zz -= 3.0) for (const xx of [la + 0.1, lb - 0.1]) post(xx, zz, yTop - 0.16);
    for (const xx of [la + 0.1, lb - 0.1]) post(xx, zA + 0.2, yTop - 0.16);
    yellowRail(b, sd > 0 ? [[lb - 0.05, yTop, zcs - Ws / 2], [lb - 0.05, yTop, zA + 0.1]] : [[la + 0.05, yTop, zcs - Ws / 2], [la + 0.05, yTop, zA + 0.1]]);
    yellowRail(b, sd > 0 ? [[la + 0.05, yTop, zA + 0.1], [la + 0.05, yTop, zcs + Ws / 2 - 0.05], [lb - 0.05, yTop, zcs + Ws / 2 - 0.05]] : [[lb - 0.05, yTop, zA + 0.1], [lb - 0.05, yTop, zcs + Ws / 2 - 0.05], [la + 0.05, yTop, zcs + Ws / 2 - 0.05]]);
    // paved path from the house to the stair foot: a ramp from the ground at the house wall to the foot level
    const xf = xTop + sd * (0.8 + totRun);
    const pa = lo(doorX, xf) - 1.0, pb = hi(doorX, xf) + 1.0;
    const zP = zcs - Ws / 2 - 0.2;                                     // far (bank-side) edge of the path
    const yH = Math.max(yardY - 2.5, Math.min(yardY, gPool((pa + pb) / 2, -hd - 0.3) + 0.03));   // at the house wall
    const yP = footY;                                                  // at the stair foot
    const yDn = Math.min(yH, yP) - 0.45;
    b.withTint([1, 1, 1], () => {
      b.quad('concrete', pa, yH, -hd, pb, yH, -hd, pb, yP, zP, pa, yP, zP);           // top (normal up: z decreasing)
      b.quad('concrete', pa, yDn, zP, pa, yP, zP, pb, yP, zP, pb, yDn, zP);           // bank-side face
      b.quad('concrete', pa, yDn, -hd, pa, yH, -hd, pa, yP, zP, pa, yDn, zP);         // end faces
      b.quad('concrete', pb, yDn, zP, pb, yP, zP, pb, yH, -hd, pb, yDn, -hd);
    });
    if (b.collecting) b.colQuad(pa, yH, -hd, pb, yH, -hd, pb, yP, zP, pa, yP, zP);
    walkFoot = [xf + sd * 0.6, footY, zcs];
    accessX.push([lo(xf, xTop - sd * 0.8), hi(xf, xTop - sd * 0.8)]);
  }
  // fix 2: guard rails round both abutment tops (water faces beside the deck / walkway, the downstream drop onto the
  // training walls, the land edge over the bank) — left open where the deck, the walkway and the access arrive
  {
    const ax0 = lo(xU, xDn) - 3.0, ax1 = hi(xU, xDn) + 3.0, yA = yD + 0.12;
    const dk0 = lo(xw1, xd1) - 0.05, dk1 = hi(xw1, xd1) + 0.05;
    const gaps = (spans) => {
      // x pieces of [ax0 + 0.1, ax1 − 0.1] outside the given spans
      const out = []; let x = ax0 + 0.1;
      for (const [a, c] of spans.slice().sort((p, q) => p[0] - q[0])) { if (a > x + 0.3) out.push([x, Math.min(a, ax1 - 0.1)]); x = Math.max(x, c); }
      if (ax1 - 0.1 > x + 0.3) out.push([x, ax1 - 0.1]);
      return out;
    };
    for (const near of [true, false]) {
      const zw = near ? zE + 0.12 : zF - 0.12;             // water face
      const zl = near ? zA - 0.1 : zF - 2.6 + 0.1;         // land edge
      for (const [a, c] of gaps([[dk0, dk1]])) yellowRail(b, [[a, yA, zw], [c, yA, zw]], { toe: true });
      const landSpans = near ? accessX.map(([a, c]) => [a - 0.2, c + 0.2]).concat([[gx - 1.0, gx + 1.0]]) : [];
      for (const [a, c] of gaps(landSpans)) yellowRail(b, [[a, yA, zl], [c, yA, zl]], { toe: true });
      // downstream end (drop onto the training wall), upstream end where it stands over the approach wall
      const xEndD = fl > 0 ? ax1 - 0.1 : ax0 + 0.1, xEndU = fl > 0 ? ax0 + 0.1 : ax1 - 0.1;
      yellowRail(b, [[xEndD, yA, zw], [xEndD, yA, zl]], { toe: true });
      if (yA - (tU + 0.12) > 0.45) yellowRail(b, [[xEndU, yA, zw], [xEndU, yA, zl]], { toe: true });
    }
  }
  // inspection access from the deck down onto the downstream training wall (stair for a short drop, else ladder)
  const dRise = yD + 0.12 - (tD + 0.12);
  if (dRise > 0.2 && dRise <= 3.2) steelStair(b, { x: xd1 + fl * 0.1, z: zE + 1.0, y0: tD + 0.12, rise: dRise, dir: fl > 0 ? Math.PI : 0, W: 0.9, rails: 'both' });
  else if (dRise > 3.2) cagedLadder(b, xd1 + fl * 0.6, tD + 0.12, zE + 0.9, dRise, fl > 0 ? -Math.PI / 2 : Math.PI / 2);
  for (const zz of [zE - 0.35, zF + 0.35]) cagedLadder(b, xb0 + fl * 8, basinBed + 0.3, zz, tD - basinBed, zz > (zE + zF) / 2 ? Math.PI : 0);
  // ---- lamps, hydraulic lines, cable tray, control kiosk ----
  lampPost(b, xd1 - fl * 0.3, yD + 0.12, zE + 1.2, 6, fl > 0 ? Math.PI : 0);
  lampPost(b, xd1 - fl * 0.3, yD + 0.12, zF - 1.2, 6, fl > 0 ? Math.PI : 0);
  pipeRun(b, [[xg + fl * 1.2, yD + 0.25, zE + 1.8], [xg + fl * 1.2, yD + 0.25, zF - 1.8]], 0.035, { key: 'steel', flange: false });
  pipeRun(b, [[xg + fl * 1.35, yD + 0.25, zE + 1.8], [xg + fl * 1.35, yD + 0.25, zF - 1.8]], 0.035, { key: 'steel', flange: false });
  b.box('steel', xg + fl * 1.6 - 0.15, yD + 0.12, zF - 1.8, xg + fl * 1.6 + 0.15, yD + 0.2, zE + 1.8, ALL);
  cabinet(b, hi(xd0, xd1) + 1.6, yD + 0.12, zE + 1.4, 1.2, 1.8, 0.6, Math.PI, 'hvac');
  b.pop();
  // pool-frame → building-frame helper for the anchors
  const c = Math.cos(W.rot), sn = Math.sin(W.rot);
  const toB = (x, y, zz) => [x * c + zz * sn, y, -x * sn + zz * c];
  const zm = (zE + zF) / 2;
  return {
    n, open, gx: xg, flow: fl,
    deckCenter: toB(xg, yD + 1, zm),
    walkCam: toB(xg - fl * 1.6, yD + 0.12 + 1.65, zE + 0.8),
    // 检修道 view (fix 2): on the near abutment's maintenance way just downstream of the deck end (inside the guard
    // rails), looking along the deck's downstream rail across the canal: raised leaves / frames with the retained pool
    // beyond them (left, ~1 m under the deck), white water boiling out of the open bays into the basin (right, far
    // below), pier ends and gantry — both levels and the flow in one frame (best at 24 mm)
    walkView: { pos: toB(xd1 + fl * 1.0, yD + 0.12 + 1.65, zE + 0.5), target: toB(xg - fl * 1.0, yD + 1.77 - 0.22 * Math.hypot(xd1 + fl * 2.0 - xg, W.width * 0.78 + 0.5), zE - W.width * 0.78) },
    // control-room look: over the gate line slightly downstream, down to the far half of the basin
    controlLook: toB(xg - fl * 3.5, yD + 1.62 - 0.155 * Math.hypot(W.hd + W.gap + W.width * 0.6, 3.0), zE - W.width * 0.6),
    walkFoot: walkFoot ? toB(...walkFoot) : null,
    // water points (building frame): upstream pool beside the walkway, tail water below the gates (foam)
    upPool: toB(xg - fl * 7, up, zm),
    upGate: toB(xg - fl * 1.5, up, zE - Math.min(3, W.width * 0.25)),
    access: accessX,                     // pool-frame x spans of the deck access (facade u = hw − x)
    tailPool: toB(xg + fl * Math.min(10, chute + 5), down, zm),
    gateMid: toB(xg, (Math.max(up, down) + yD) / 2, zm),
    deckY: yD,
  };
}

/** One pier between z0..z1 from xU (upstream nose) to xDn, split wet / dry at the splash lines. */
function pier(b, z0, z1, xU, xDn, xg, fl, bed, yD, wetU, wetD, up, down, E) {
  const zc = (z0 + z1) / 2, r = (z1 - z0) / 2;
  const xa = Math.min(xU, xDn), xb = Math.max(xU, xDn);
  // plan polygon with a semicircular nose on the upstream end and a chamfered downstream end
  const nose = [];
  const xn = fl > 0 ? xa + r : xb - r;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / 8;
    nose.push([xn + Math.cos(a) * r * (fl > 0 ? 1 : -1), zc + Math.sin(a) * r]);
  }
  const xt = fl > 0 ? xb : xa, ch = 0.35 * (fl > 0 ? 1 : -1);
  const tail = [[xt - ch, z0], [xt, z0 + 0.3], [xt, z1 - 0.3], [xt - ch, z1]];
  const poly = fl > 0 ? [...nose.reverse(), ...tail] : [...nose, ...tail.reverse()];
  // split at the gate line: upstream part wet to wetU, downstream part wet to wetD
  const xs = xg;
  const clipX = (pts, keepLeft) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const pin = keepLeft ? p[0] <= xs : p[0] >= xs, qin = keepLeft ? q[0] <= xs : q[0] >= xs;
      if (pin) out.push(p);
      if (pin !== qin) { const t = (xs - p[0]) / (q[0] - p[0]); out.push([xs, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  const upPart = clipX(poly, fl > 0), dnPart = clipX(poly, fl < 0);
  if (upPart.length >= 3) {
    b.prism('concrete_wet', upPart, bed, wetU, { top: false });
    b.prism('concrete', upPart, wetU, yD - 0.05, { top: false });
    if (E.wet) b.withTint(E.algaeTint, () => b.prism('concrete_wet', upPart.map((p) => [p[0] + (p[0] - (xa + xb) / 2) * 0.0005, p[1] + (p[1] - zc) * 0.004]), up - 0.3, up + 0.12, { top: false }));
  }
  if (dnPart.length >= 3) {
    b.prism('concrete_wet', dnPart, bed, wetD, { top: false });
    b.prism('concrete', dnPart, wetD, yD - 0.05, { top: false });
    if (E.wet) b.withTint(E.algaeTint, () => b.prism('concrete_wet', dnPart.map((p) => [p[0], p[1] + (p[1] - zc) * 0.004]), down - 0.3, down + 0.15, { top: false }));
  }
  if (b.collecting) b.colBox(xa, bed, z0, xb, yD, z1);
  void up; void down;
}

/** Vertical lift gate in a bay (z0..z1) at the slot line xg, y from gy0 to gy1. */
function gate(b, xg, z0, z1, gy0, gy1, up, fl, E, open) {
  const t = 0.45, xs = xg - fl * 0.18;   // skin plate on the upstream face
  // skin plate (painted steel, dark blue-grey), darker + algae below the upstream water line when closed
  const wetY = Math.min(gy1, up + 0.25);
  const paint = [0.42, 0.5, 0.6];
  b.withTint(paint, () => {
    b.box('steel_dark', xs - 0.03, Math.max(gy0, wetY), z0, xs + 0.03, gy1, z1, ALL);
    if (wetY > gy0) b.withTint([paint[0] * 0.55, paint[1] * 0.58, paint[2] * 0.55], () => b.box('steel_dark', xs - 0.03, gy0, z0, xs + 0.03, wetY, z1, PX | NX | NY | PZ | NZ));
    // horizontal girders on the downstream face + end posts
    const nG = Math.max(3, Math.round((gy1 - gy0) / 0.75));
    for (let k = 0; k <= nG; k++) {
      const y = gy0 + 0.12 + ((gy1 - gy0 - 0.24) * k) / nG;
      b.box('steel_dark', Math.min(xs, xs + fl * t), y - 0.07, z0 + 0.05, Math.max(xs, xs + fl * t), y + 0.07, z1 - 0.05, PY | NY | (fl > 0 ? PX : NX));
    }
    for (const zz of [z0 + 0.12, z1 - 0.12]) b.box('steel_dark', Math.min(xs, xs + fl * t), gy0, zz - 0.1, Math.max(xs, xs + fl * t), gy1, zz + 0.1, ALL);
    // vertical stiffeners
    const nV = Math.max(2, Math.round((z1 - z0) / 1.2));
    for (let k = 1; k < nV; k++) { const zz = z0 + ((z1 - z0) * k) / nV; b.box('steel_dark', Math.min(xs, xs + fl * t * 0.8), gy0 + 0.1, zz - 0.04, Math.max(xs, xs + fl * t * 0.8), gy1 - 0.1, zz + 0.04, PZ | NZ | (fl > 0 ? PX : NX)); }
  });
  // guide wheels + seals + lifting lugs
  for (const zz of [z0 + 0.04, z1 - 0.04]) for (const yy of [gy0 + 0.5, gy1 - 0.5]) { b.push(); b.translate(xs + fl * 0.25, yy, zz); b.cylinder('steel', 0, -0.14, 0, 0.14, 0.28, 10, { top: true, bottom: true }); b.pop(); }
  b.box('rubber', xs - 0.05, gy0 - 0.03, z0, xs + 0.05, gy0 + 0.04, z1, ALL);
  for (const zz of [z0 + 0.6, z1 - 0.6]) b.cbox('steel_yellow', xg - 0.1, gy1, zz - 0.12, xg + 0.1, gy1 + 0.25, zz + 0.12, 0.01);
  if (open && b.collecting) b.colBox(xs - 0.1, gy0, z0, xs + fl * t, gy1, z1);
  void E;
}

/** Travelling gantry crane: legs on the abutments, box beam across, hoist trolley with a hook block. */
function gantry(b, xg, zA, zB, y0, yTop, rng, bays, fl) {
  const legs = [zA, zB];
  // rails along x on both abutments
  for (const z of legs) for (const dz of [-0.6, 0.6]) b.box('steel', xg - 6, y0, z + dz - 0.04, xg + 6, y0 + 0.08, z + dz + 0.04, PY | PZ | NZ);
  for (const z of legs) {
    // A-frame legs (two inclined columns) + bogie
    b.cbox('steel_yellow', xg - 0.9, y0, z - 0.75, xg + 0.9, y0 + 0.6, z + 0.75, 0.02);
    for (const dx of [-0.65, 0.65]) {
      const pts = [[xg + dx, y0 + 0.6, z], [xg + dx * 0.35, yTop - 0.8, z]];
      b.tube('steel_yellow', pts, 0.16, 10);
    }
    b.cbox('steel_yellow', xg - 0.5, yTop - 0.9, z - 0.5, xg + 0.5, yTop - 0.4, z + 0.5, 0.02);
  }
  // main girder (box) + top rails + walkway with rail
  b.cbox('steel_yellow', xg - 0.45, yTop - 0.4, Math.min(zA, zB) - 0.6, xg + 0.45, yTop + 0.55, Math.max(zA, zB) + 0.6, 0.03);
  b.box('grille_dark', xg + 0.45, yTop - 0.3, Math.min(zA, zB) - 0.4, xg + 1.2, yTop - 0.25, Math.max(zA, zB) + 0.4, PY | NY);
  b.tube('steel_yellow', [[xg + 1.18, yTop + 0.75, Math.min(zA, zB) - 0.3], [xg + 1.18, yTop + 0.75, Math.max(zA, zB) + 0.3]], 0.02, 6);
  // trolley over a (random) bay + hoist block + hook
  const bi = Math.floor(rng.next() * bays.length);
  const tz = (bays[bi][0] + bays[bi][1]) / 2;
  b.cbox('steel_dark', xg - 0.7, yTop + 0.55, tz - 0.8, xg + 0.7, yTop + 1.1, tz + 0.8, 0.02);
  b.withTint([1, 1, 1], () => b.cbox('steel_yellow', xg - 0.3, yTop - 1.1, tz - 0.35, xg + 0.3, yTop - 0.4, tz + 0.35, 0.02));
  const hookY = yTop - 1.1 - 1.8 - rng.next() * 1.4;
  for (const dz of [-0.07, 0.07]) b.cylinder('steel', xg, hookY + 0.4, tz + dz, 0.014, yTop - 1.1 - hookY - 0.4, 4, { top: false });
  b.cbox('steel_yellow', xg - 0.16, hookY, tz - 0.2, xg + 0.16, hookY + 0.45, tz + 0.2, 0.02);
  b.tube('steel_dark', [[xg, hookY, tz], [xg, hookY - 0.22, tz], [xg + 0.07, hookY - 0.34, tz], [xg + 0.14, hookY - 0.25, tz]], 0.035, 6);
  // cab on one leg
  b.cbox('panel_white', xg - 1.6, yTop - 2.6, zA - 0.7, xg - 0.6, yTop - 1.2, zA + 0.7, 0.02);
  b.quad('glass_window', xg - 1.61, yTop - 2.2, zA - 0.55, xg - 1.61, yTop - 2.2, zA + 0.55, xg - 1.61, yTop - 1.5, zA + 0.55, xg - 1.61, yTop - 1.5, zA - 0.55);
  void fl;
}

/** 'mass' LOD: control house box + gate structure block + gantry + piers. */
function massing(spec, ctx) {
  const s = ctx.spec, b = ctx.b;
  const fh = Math.max(4.0, s._fh), top = 0.25 + Math.max(2, s._floors) * fh;
  const W = waterInfo(ctx);
  const fl = W.flow, yD = W.deck, gx = fl * 1.4;
  b.push(); b.rotY(W.rot);
  const zE = -W.hd - W.gap, zF = zE - W.width;
  const xa = Math.min(gx - fl * 5, gx + fl * 5), xb = Math.max(gx - fl * 5, gx + fl * 5);
  massBox(b, xa, Math.min(W.bedU, W.bedD), zF - 2.6, xb, yD, zE + 2.6, [0.62, 0.6, 0.57]);                         // piers + deck
  massBox(b, -0.5, yD, zF - 0.5, 0.5, yD + 3.4, zE + 0.5, [0.32, 0.36, 0.42]);                                    // gate frames
  massBox(b, -0.45, yD + 6.1, zF - 1.9, 0.45, yD + 7.1, zE + 1.9, [0.78, 0.62, 0.16]);                            // gantry girder
  for (const z of [zE + 1.3, zF - 1.3]) massBox(b, -0.4, yD, z - 0.5, 0.4, yD + 6.1, z + 0.5, [0.78, 0.62, 0.16]);
  massBox(b, -4.5, 4.0, -W.hd - 2.1, 4.5, top + 0.2, -W.hd, [0.86, 0.87, 0.86]);                                   // control bay
  b.pop();
  return [massVol(-s._w / 2, s._w / 2, -s._d / 2, s._d / 2, Math.min(0, s._ground.min) - 0.5, top, { floorH: fh, groundH: 0.25 + fh, roofColor: [0.55, 0.53, 0.5] })];
}

export default { name: 'sluice_station', uses: ['sluice_station'], generate, massing };
