// 值守屋 / 维护房 / 水务维护楼 — O-zone duty house, maintenance workshop and (2–4 storeys) water-works
// maintenance building with an upper control room (shot 07, O variant). OWNER: buildings-o.
//
// Plan first: the street door (spec 'main') opens into the duty room (值守入口); vehicles enter the
// workshop through roller doors on the far half of the front (1–3 bays by width) from a concrete turning
// apron with painted guide lines (维修车的回转场); the back door (spec 'back' / 'service') leads to the
// equipment yard (transformer kiosk, tank, spare-parts container, lamp). Upper storeys: offices / rest
// rooms with regular windows; the top storey is the control room with a wide observation band facing the
// yard / water side (meta.waterSide | poolSide, default back); an external steel stair with yellow rails
// climbs a free side wall to the first-floor door. Small duty huts (one storey, < 12 m) are a single room
// with a porch. Roof: parapet, gravel / snow, HVAC, antenna, hatch; louvres for the workshop air.
// 'full': storey slabs + straight stair, partitions (duty room / workshop / WC, upper corridor), workbenches,
// racks, consoles, colliders.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, oEnv, roomMap, drift, utilAnchors, massVol, BAY_W } from './o_common.js';
import { buildHall, consoleDesk, chairSimple, workbench, rack, partition, doorSpans } from './o_hall.js';
import { bandWindows, dedupeOps, storeySlabs, externalStair, equipmentYard } from './o_block.js';

export function maintLevels(ctx) {
  const s = ctx.spec, E = oEnv(ctx);
  const w = s._w, d = s._d;
  const nF = Math.max(1, s._floors);
  const hut = nF === 1 && Math.max(w, d) < 12;
  const shop = !hut && w >= 12;
  const fh = Math.max(3.2, Math.min(4.5, s._fh || 3.4));
  const gh = shop ? Math.max(4.5, s._gh || 0, Math.min(6, s._fh || 4.5)) : Math.max(3.4, s._gh || fh);
  const ffl = E.ffl;
  const levels = [{ y: ffl, h: gh }];
  for (let i = 1; i < nF; i++) levels.push({ y: ffl + gh + (i - 1) * fh, h: fh });
  const top = ffl + gh + (nF - 1) * fh;
  return { E, w, d, nF, hut, shop, fh, gh, ffl, levels, top };
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const G = maintLevels(ctx);
  const { E, w, d, nF, hut, shop, gh, ffl, levels, top } = G;
  const m = s._meta || {};
  const rng = ctx.sub(1701);
  const L = (side) => (isFB(side) ? w : d);
  const ops = { front: [], right: [], back: [], left: [] };
  // ---- sides ----
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: 0, width: 1.2 };
  const M = mainE.side;
  const backE = s._entrances.find((e) => e.kind === 'back' || e.kind === 'service');
  const Bk = backE && backE.side !== M ? backE.side : OPP[M];
  const waterSide = SIDES.includes(m.waterSide) ? m.waterSide : SIDES.includes(m.poolSide) ? m.poolSide : Bk;
  const uOf = (e, side) => { const Ls = L(side); return Ls / 2 + (side === 'back' || side === 'left' ? -1 : 1) * (e.offset || 0); };
  // ---- main door + duty room windows ----
  const LM = L(M);
  let du = Math.max(1.4, Math.min(LM - 1.4, uOf(mainE, M)));
  // workshop roller doors on the half away from the door
  const nR = shop ? (w >= 28 ? 3 : w >= 18 ? 2 : 1) : 0;
  const rollers = [];
  if (nR) {
    const rw = 3.6, gap = 1.4;
    const span = nR * rw + (nR - 1) * gap;
    const leftHalf = du > LM / 2;             // door on the right half → rollers on the left half
    const a = leftHalf ? 1.2 : LM - 1.2 - span;
    // keep the main door clear of the roller group
    if (leftHalf && du < a + span + 1.6) du = Math.min(LM - 1.4, a + span + 2.2);
    if (!leftHalf && du > a - 1.6) du = Math.max(1.4, a - 2.2);
    for (let i = 0; i < nR; i++) {
      const u0 = a + i * (rw + gap);
      const o = { u0, u1: u0 + rw, v0: ffl, v1: ffl + Math.min(4.2, gh - 0.7), kind: 'roller', open: rng.next() < 0.3 ? 0.7 : 0, apron: { depth: 9, ext: 0.7 } };
      rollers.push(o); ops[M].push(o);
    }
  }
  const door = { u0: du - 0.55, u1: du + 0.55, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: hut ? 'service' : 'glazed', entry: true, plate: true };
  ops[M].push(door);
  const dutyRoom = { y: ffl, h: Math.min(3.2, gh - 0.3), depth: Math.min(5, d - 1), kind: 'office', floor: 0 };
  for (const off of [-2.0, 2.0, 4.6]) {
    const uc = du + off;
    if (uc < 1.1 || uc > LM - 1.1) continue;
    const o = { u0: uc - 0.7, u1: uc + 0.7, v0: ffl + 0.95, v1: ffl + 2.3, kind: 'win', type: 'casement' };
    o.room = roomMap(ctx, M, w, d, o, dutyRoom);
    ops[M].push(o);
  }
  // workshop high windows over the roller doors
  for (const r of rollers) { const o = { u0: r.u0 + 0.3, u1: r.u1 - 0.3, v0: r.v1 + 0.45, v1: Math.min(levels[0].y + gh - 0.35, r.v1 + 1.25), kind: 'win', type: 'strip', cols: 3 }; if (o.v1 - o.v0 > 0.4) { o.room = roomMap(ctx, M, w, d, o, { y: ffl, h: gh, depth: d - 1, kind: 'plant', floor: 0 }); ops[M].push(o); } }
  // ---- back: door to the equipment yard, small windows ----
  const LB = L(Bk);
  let bu = backE && backE.side === Bk ? Math.max(1.3, Math.min(LB - 1.3, uOf(backE, Bk))) : LB * 0.3;
  const backDoor = { u0: bu - 0.5, u1: bu + 0.5, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service', entry: true, canopy: !hut };
  ops[Bk].push(backDoor);
  bandWindows(ctx, ops, Bk, w, d, { y: ffl, h: gh, sill: shop ? 2.2 : 1.1, head: shop ? 3.4 : 2.3, every: 4.2, width: 1.4, avoid: [[backDoor.u0, backDoor.u1]], kind: shop ? 'plant' : 'office', floor: 0, depth: d - 1 });
  // ---- upper storeys ----
  for (let l = 1; l < nF; l++) {
    const y = levels[l].y, h = levels[l].h, topFloor = l === nF - 1;
    for (const side of [M, Bk]) {
      if (topFloor && side === waterSide && nF >= 2) {
        // control room observation band (fixed glazing, mullions every 1.2 m)
        const Ls = L(side), a = Ls * 0.18, c = Ls * 0.82;
        const o = { u0: a, u1: c, v0: y + 0.85, v1: y + Math.min(2.65, h - 0.45), kind: 'win', type: 'fixed', cols: Math.max(3, Math.round((c - a) / 1.25)) };
        o.room = roomMap(ctx, side, w, d, o, { y, h: h - 0.3, depth: Math.min(6, d / 2), kind: 'office', floor: l, u0: a - 0.6, u1: c + 0.6 });
        ops[side].push(o);
        bandWindows(ctx, ops, side, w, d, { y, h, every: 3.6, width: 1.3, avoid: [[a, c]], floor: l, depth: d / 2 });
      } else bandWindows(ctx, ops, side, w, d, { y, h, every: 3.6, width: 1.5, floor: l, depth: d / 2 });
    }
  }
  // ---- side walls: louvres (workshop air intake), windows on upper floors, external stair ----
  let ext = null;
  const sideWalls = ['left', 'right'].map((x) => (isFB(M) ? x : x === 'left' ? 'front' : 'back')).filter((x) => x !== M && x !== Bk && !s._shared[x]);
  for (const side of sideWalls) {
    const Ls = L(side);
    ops[side].push({ u0: Ls / 2 - 0.9, u1: Ls / 2 + 0.9, v0: ffl + 0.5, v1: ffl + 1.7, kind: 'louvre' });
    for (let l = 1; l < nF; l++) bandWindows(ctx, ops, side, w, d, { y: levels[l].y, h: levels[l].h, every: 4.0, width: 1.3, floor: l, depth: w / 2 });
  }
  if (nF >= 2 && sideWalls.length && !hut) {
    const side = sideWalls[Math.floor(rng.next() * sideWalls.length)];
    const Ls = L(side);
    const yTop = levels[1].y;
    const dir = rng.next() < 0.5 ? 1 : -1;
    const u = dir > 0 ? Ls - 1.4 : 1.4;
    const run = (Math.max(2, Math.ceil((yTop + 0.3) / 0.19)) - 1) * 0.25;
    if (Ls - 2.8 > run + 1.0) {
      ops[side] = ops[side].filter((o) => !(o.u1 > Math.min(u - run - 1, u - 1) && o.u0 < Math.max(u + run + 1, u + 1) && o.v0 > ffl + 1.9 && o.v0 < yTop + 0.5) || o.kind === 'louvre');
      ext = { side, u, dir, yTop };
      ops[side].push({ u0: u - 0.5, u1: u + 0.5, v0: yTop, v1: yTop + 2.15, kind: 'door', doorKind: 'service' });
    }
  }
  for (const side of SIDES) ops[side] = dedupeOps(ops[side]);
  // ---- shell ----
  const I = { x0: -w / 2 + E.wallT, x1: w / 2 - E.wallT, z0: -d / 2 + E.wallT, z1: d / 2 - E.wallT };
  const walls = [], slabs = [], stairs = [];
  if (ctx.full) {
    // ground floor partitions: duty room (around the main door) | workshop; WC by the back door
    if (shop) {
      const sp = mainSplit(M, du, w, d, I, rollers);
      if (sp) walls.push({ ...sp, y0: ffl, y1: levels[0].y + gh - 0.3, doors: [{ at: sp.len * 0.7, w: 1.0 }] });
    }
    for (let l = 1; l < nF; l++) {
      const y = levels[l].y, zc = (I.z0 + I.z1) / 2;
      walls.push({ x0: I.x0 + 2.2, z0: zc, x1: I.x1, z1: zc, y0: y, y1: y + levels[l].h - 0.3, doors: [{ at: 1.2, w: 0.95 }, { at: (I.x1 - I.x0 - 2.2) * 0.6, w: 0.95 }] });
    }
  }
  const H = buildHall(ctx, { env: E, ffl, top, T: E.wallT, ops, roof: { kind: 'flat', dp: Bk }, slabs, walls, stairs, ceiling: shop ? 'beams' : 'flat', band: nF >= 2 ? levels[1].y : undefined, parapet: 0.9 });
  if (ctx.full && nF >= 2) storeySlabs(ctx, I, levels, { x0: I.x0 + 0.3, z: isFB(M) ? (M === 'front' ? I.z1 - 0.75 : I.z0 + 0.75) : I.z1 - 0.75, dir: 1, W: 1.1 });
  if (ext) externalStair(ctx, ext.side, w, d, ext.yTop, { u: ext.u, dir: ext.dir });
  // ---- interior fit-out ('full') ----
  if (ctx.full) {
    if (shop) {
      workbench(b, I.x0 + 2.0, ffl, I.z0 + 0.6, 2.4, 0);
      rack(b, I.x1 - 2.6, ffl, I.z0 + 0.8, 4.2, 3.0, 0, s.hash);
      // inspection pit with yellow edge in the first bay
      if (rollers.length) {
        const r0 = rollers[0], uc = (r0.u0 + r0.u1) / 2;
        const p = K.facadePoint(M, w, d, uc, 0, -d * 0.45);
        const ax = isFB(M);
        const pw = 0.9, pl = Math.min(6, d - 3);
        const x0 = ax ? p[0] - pw / 2 : p[0] - pl / 2, x1 = ax ? p[0] + pw / 2 : p[0] + pl / 2, z0 = ax ? p[2] - pl / 2 : p[2] - pw / 2, z1 = ax ? p[2] + pl / 2 : p[2] + pw / 2;
        b.rectY('black', x0, z0, x1, z1, ffl + 0.008, 1);
        b.box('steel_yellow', x0 - 0.12, ffl, z0 - 0.12, x1 + 0.12, ffl + 0.012, z0, PY);
        b.box('steel_yellow', x0 - 0.12, ffl, z1, x1 + 0.12, ffl + 0.012, z1 + 0.12, PY);
        b.box('steel_yellow', x0 - 0.12, ffl, z0, x0, ffl + 0.012, z1, PY);
        b.box('steel_yellow', x1, ffl, z0, x1 + 0.12, ffl + 0.012, z1, PY);
      }
    }
    // duty desk by the main door
    const dp = K.facadePoint(M, w, d, du + (du > LM / 2 ? -2.2 : 2.2), ffl, -1.2);
    const rotM = { front: Math.PI, back: 0, left: Math.PI / 2, right: -Math.PI / 2 }[M];
    consoleDesk(b, dp[0], ffl, dp[2], 1.8, rotM + Math.PI);
    chairSimple(b, dp[0] + K.facadeNormal(M)[0] * -0.9, ffl, dp[2] + K.facadeNormal(M)[2] * -0.9, rotM + Math.PI);
    if (nF >= 2) {
      const yT = levels[nF - 1].y;
      const cp = K.facadePoint(waterSide, w, d, L(waterSide) / 2, yT, -0.9);
      const rotW = { front: Math.PI, back: 0, left: Math.PI / 2, right: -Math.PI / 2 }[waterSide];
      consoleDesk(b, cp[0], yT, cp[2], Math.min(4.2, L(waterSide) * 0.5), rotW + Math.PI);
      chairSimple(b, cp[0] - K.facadeNormal(waterSide)[0] * 1.0, yT, cp[2] - K.facadeNormal(waterSide)[2] * 1.0, rotW + Math.PI);
    }
  }
  // ---- roof plant ----
  const ri = H.inner;
  K.hvacUnit(b, ri.x1 - 1.8, top, ri.z0 + 1.1, 0, { w: 2.0, d: 1.0, h: 1.0 });
  if (rng.next() < 0.8) K.antennaMast(b, ri.x0 + 0.9, top, ri.z0 + 0.9, 3.5 + rng.next() * 3, s.hash);
  K.roofHatch(b, ri.x0 + 1.6, top, ri.z1 - 1.4, {});
  if (shop && ri.x1 - ri.x0 > 10) for (let k = 0; k < 2; k++) K.ventMushroom(b, ri.x0 + (ri.x1 - ri.x0) * (0.35 + k * 0.3), top, (ri.z0 + ri.z1) / 2, 0.3, 0.8);
  // ---- equipment yard behind ----
  if (!hut && !s._shared[Bk]) {
    const LBk = L(Bk);
    const ya = Math.min(backDoor.u1 + 1.5, LBk - 6), yb = Math.min(LBk - 0.5, ya + Math.max(6, LBk * 0.55));
    if (yb - ya > 5) equipmentYard(ctx, Bk, w, d, ya, yb, { depth: 6.5 });
  }
  // ---- landing canopy for water-side maintenance sites ----
  if (m.waterSide && s.roof === 'canopy') {
    b.push(); K.facadeFrame(b, m.waterSide, w, d, 0);
    const Lw = L(m.waterSide);
    b.withTint(E.trimTint, () => K.canopyFlat(b, { u0: 1.0, u1: Lw - 1.0, y: ffl + 3.4, depth: 4.5, key: 'panel_grey', rods: false }));
    for (let u = 1.6; u < Lw - 1.0; u += 4.5) b.box('steel', u - 0.1, 0, 4.1, u + 0.1, ffl + 3.25, 4.3, ALL);
    b.pop();
  }
  // ---- climate ----
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', skip: doorSpans(H.opsBySide[E.lee]) });
  if (E.polar) { drift(ctx, E.lee, { kind: 'snow', skip: doorSpans(H.opsBySide[E.lee]) }); drift(ctx, E.windward, { kind: 'snow', h: 0.25, reach: 1.4, seed: 3, skip: doorSpans(H.opsBySide[E.windward]) }); }
  // ---- anchors ----
  const ents = [{ kind: 'main', side: M, pos: K.facadePoint(M, w, d, du, ffl, 0.6), dir: K.facadeNormal(M), width: 1.1 }, { kind: 'back', side: Bk, pos: K.facadePoint(Bk, w, d, bu, ffl, 0.6), dir: K.facadeNormal(Bk), width: 1.0 }];
  for (const r of rollers) ents.push({ kind: 'service', side: M, pos: K.facadePoint(M, w, d, (r.u0 + r.u1) / 2, ffl, 0.6), dir: K.facadeNormal(M), width: 3.6 });
  const cams = {};
  if (nF >= 2) {
    const yT = levels[nF - 1].y;
    cams.living = { pos: K.facadePoint(waterSide, w, d, L(waterSide) * 0.42, yT + 1.65, -2.6), target: K.facadePoint(waterSide, w, d, L(waterSide) * 0.5, yT - 1.5, 14) };
    cams.stair = { pos: [I.x0 + 0.6, ffl + 1.65, isFB(M) && M === 'back' ? I.z0 + 2.4 : I.z1 - 2.4], target: [I.x0 + 4, levels[1].y + 0.6, isFB(M) && M === 'back' ? I.z0 + 0.8 : I.z1 - 0.8] };
  } else cams.living = { pos: K.facadePoint(M, w, d, du, ffl + 1.65, -1.0), target: K.facadePoint(M, w, d, du, ffl + 1.2, -d + 1) };
  utilAnchors(ctx, {
    ffl, h: gh, roofY: top + 0.9, access: [ri.x0 + 1.6, top, ri.z1 - 1.4],
    floors: levels.map((l, i) => ({ level: i, y: l.y, height: l.h })),
    entrances: ents,
    rooms: [{ floor: 0, name: shop ? 'workshop' : 'duty room', kind: shop ? 'plant' : 'office', center: [0, ffl, 0], size: [w, gh, d] }, ...(nF >= 2 ? [{ floor: nF - 1, name: 'control room', kind: 'office', center: K.facadePoint(waterSide, w, d, L(waterSide) / 2, levels[nF - 1].y, -3), size: [L(waterSide) * 0.64, levels[nF - 1].h, 5] }] : [])],
    cameras: cams,
  });
  b.meta.variant = hut ? 'hut' : shop ? (nF >= 2 ? 'works' : 'workshop') : 'office';
}

/** Partition separating the duty room (by the main door) from the workshop (rollers). */
function mainSplit(M, du, w, d, I, rollers) {
  if (!rollers.length) return null;
  const LM = isFB(M) ? w : d;
  const rMid = (rollers[0].u0 + rollers[rollers.length - 1].u1) / 2;
  const uSplit = rMid < du ? rollers[rollers.length - 1].u1 + 0.8 : rollers[0].u0 - 0.8;
  const p = K.facadePoint(M, w, d, Math.max(1, Math.min(LM - 1, uSplit)), 0, 0);
  if (isFB(M)) return { x0: p[0], z0: I.z0, x1: p[0], z1: I.z1, len: I.z1 - I.z0 };
  return { x0: I.x0, z0: p[2], x1: I.x1, z1: p[2], len: I.x1 - I.x0 };
}

function massing(spec, ctx) {
  const G = maintLevels(ctx);
  const s = ctx.spec;
  return [massVol(-G.w / 2, G.w / 2, -G.d / 2, G.d / 2, Math.min(0, s._ground.min) - 0.5, G.top, { floorH: G.fh, groundH: G.ffl + G.gh, roofColor: G.E.polar ? [0.82, 0.84, 0.86] : [0.55, 0.53, 0.5] })];
}

export default { name: 'maintenance', uses: ['maintenance'], generate, massing };
export { BAY_W };
