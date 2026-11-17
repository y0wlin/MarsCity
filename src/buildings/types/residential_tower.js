// Residential tower (point block, 12–30+ floors): central core (switchback stair + lift bank)
// wrapped by a corridor ring; four corner units per floor, each with a corner living room
// (two-sided glazing), bedroom on the side facade, kitchen on the main facade, bath between,
// hall at the corridor. Glass-heavy ZR tower language: continuous corner-wrapping bands,
// vertical ribbon fins on two corners, set-back crown floors with roof garden and plant room.
// Uses spec.meta.podium / spec.meta.tower when present (podium of shops/lobby under a tower).

import { coreLayout, groundSplit, stairLength } from '../kit/cores.js';
import { room, resetRoomIds, deriveOpenings, roomFacades } from '../kit/plan.js';
import { emitFacades, emitBands, emitRoof, emitBase, emitAnchors, rectOf } from '../kit/assemble.js';
import { emitInterior } from '../interior/index.js';
import { ribbonFin } from '../kit/facade.js';
import { bayCount, clamp, smooth01 } from '../kit/math.js';
import { daylightScore } from '../kit/spec.js';
import { residentialBands, generateResidential, residentialMassing } from './residential.js';
import { generateRoundTower, roundTowerMassing } from './residential_round.js';
import { genericPlan, assembleAll } from './generic.js';
import { normalizeSpec } from '../kit/spec.js';

/** Storey stack + crown set-backs of the rect tower (cheap; the 'mass' LOD uses this). */
export function towerFloors(ctx) {
  const s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const w = s._w, d = s._d, nF = s._floors;
  const fh = s.floorHeight ? s._fh : st.storeyH;
  const gh = s._gh || 4.5;
  const ffl = Math.max(0.3, Math.max(s._ground.fl, s._ground.fr) + 0.12);
  const floors = [];
  let y = ffl;
  const crown = nF >= 12 ? 2 : nF >= 8 ? 1 : 0;
  for (let i = 0; i < nF; i++) {
    const h = i === 0 ? gh : fh;
    const k = i - (nF - crown) + 1;
    const ins = k > 0 ? Math.min(k * 1.8, Math.min(w, d) * 0.16) : 0;
    floors.push({ level: i, y, h, inset: ins ? { front: ins, back: ins, left: ins, right: ins } : {} });
    y += h;
  }
  return { w, d, ffl, floors, roof: { y, kind: inst.roofGarden || st.roofGarden > 0.5 ? 'garden' : 'flat' }, shared: s._shared, bayW: w / bayCount(w) };
}

export function towerPlan(ctx) {
  resetRoomIds();
  const s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const w = s._w, d = s._d, T = st.wallT;
  const nF = s._floors;
  const fh = s.floorHeight ? s._fh : st.storeyH;
  const gh = s._gh || 4.5;
  const ffl = Math.max(0.3, Math.max(s._ground.fl, s._ground.fr) + 0.12);
  const floors = [];
  let y = ffl;
  const crown = nF >= 12 ? 2 : nF >= 8 ? 1 : 0;
  for (let i = 0; i < nF; i++) {
    const h = i === 0 ? gh : fh;
    const k = i - (nF - crown) + 1;
    const ins = k > 0 ? Math.min(k * 1.8, Math.min(w, d) * 0.16) : 0;
    floors.push({ level: i, y, h, rooms: [], openings: [], inset: ins ? { front: ins, back: ins, left: ins, right: ins } : {} });
    y += h;
  }
  const plan = {
    w, d, ffl, wallT: T, slabT: 0.22, floors,
    roof: { y, parapet: 1.1, wallParapet: st.bandShape === 'curved' ? 0.32 : 1.1, kind: inst.roofGarden || st.roofGarden > 0.5 ? 'garden' : 'flat' },
    shared: s._shared, entrances: [], extraOpenings: [], shafts: [], units: [], bayW: w / bayCount(w),
  };
  plan.liveSide = daylightScore(s, 'back') > daylightScore(s, 'front') + 0.25 ? 'back' : 'front';
  plan.serviceSide = plan.liveSide === 'front' ? 'back' : 'front';
  // core: stair along z on the left of a lift bank, centred
  const gs = groundSplit(gh);
  const core = coreLayout({ cx: 0, zBack: -2.9, towards: 1, maxRise: Math.max(gh, fh), minRun: gs.run, lift: true, liftSide: 1, landingDepth: 1.6, W: 2.8 });
  core.split0 = [gs.n1, gs.n2];
  // second lift beside the first
  if (core.lift) { core.lift2 = { ...core.lift, x0: core.lift.x1 + 0.1, x1: core.lift.x1 + 2.4 }; core.x1 = core.lift2.x1; }
  plan.core = core; plan.cores = [core];
  // the corridor ring abuts the core rooms exactly: partitions (stair walls with the stair door, the
  // riser cupboard door) come from shared edges, floors tile without slits (a 0.1 m gap left the stair
  // open to the ring and the stair → lift-lobby door uncuttable)
  const cx0 = core.x0, cx1 = core.x1, cz0 = core.stair.z0, cz1 = core.stair.z1;
  const ring = 1.6;
  const rx0 = cx0 - ring, rx1 = cx1 + ring, rz0 = cz0 - ring, rz1 = cz1 + ring;
  for (const f of floors) {
    const R = rectOf(plan, f);
    const rooms = f.rooms;
    // core rooms
    const stair = room('stair', core.stair.x0, core.stair.x1, core.stair.z0, core.stair.z1, { floor: f.level });
    rooms.push(stair);
    const L1 = room('lift', core.lift.x0, core.lift.x1, core.lift.z0, core.lift.z1, { floor: f.level });
    const L2 = room('lift', core.lift2.x0, core.lift2.x1, core.lift2.z0, core.lift2.z1, { floor: f.level });
    rooms.push(L1, L2);
    // services behind the lifts (riser / storage)
    rooms.push(room('storage', core.lift.x0, core.lift2.x1, core.stair.z0, core.lift.z0, { floor: f.level, extra: { noWindows: true }, name: 'riser' }));
    // corridor ring (4 pieces)
    const corr = f.level === 0 ? 'lobby' : 'corridor';
    const ringF = room(corr, rx0, rx1, cz1, rz1, { floor: f.level, name: f.level === 0 ? 'lobby' : 'lift lobby' });
    const ringB = room('corridor', rx0, rx1, rz0, cz0, { floor: f.level });
    const ringL = room('corridor', rx0, cx0, cz0, cz1, { floor: f.level });
    const ringR = room('corridor', cx1, rx1, cz0, cz1, { floor: f.level });
    // core column fill between stair/lifts and the ring (keep landing continuous)
    rooms.push(ringF, ringB, ringL, ringR);
    stair.doors.push({ to: ringF.id, width: 1.1 });
    ringL.doors.push({ to: ringF.id, width: 1.4 }); ringR.doors.push({ to: ringF.id, width: 1.4 });
    ringL.doors.push({ to: ringB.id, width: 1.4 }); ringR.doors.push({ to: ringB.id, width: 1.4 });
    ringF.open.push(ringL.id, ringR.id); ringB.open.push(ringL.id, ringR.id);
    // four corner units (quadrants)
    const quads = [
      { sx: -1, sz: 1, ring: ringF }, { sx: 1, sz: 1, ring: ringF }, { sx: 1, sz: -1, ring: ringB }, { sx: -1, sz: -1, ring: ringB },
    ];
    let qi = 0;
    for (const q of quads) {
      const uid = `t${qi++}`;
      const X0 = q.sx > 0 ? 0 : R.x0, X1 = q.sx > 0 ? R.x1 : 0;
      const Zf0 = q.sz > 0 ? rz1 : R.z0, Zf1 = q.sz > 0 ? R.z1 : rz0;          // main band (front/back)
      const xin = q.sx > 0 ? rx1 : rx0;                                         // ring edge on this side
      const zmid0 = q.sz > 0 ? 0 : rz0, zmid1 = q.sz > 0 ? rz1 : 0;            // side band z range
      const Rm = (kind, x0, x1, z0, z1, name) => { const r = room(kind, x0, x1, z0, z1, { floor: f.level, unit: uid, name }); rooms.push(r); return r; };
      if (f.level === 0) {
        // ground: lobby wing (front) + amenity / bike / bins
        const kind = q.sz > 0 ? 'shop' : (q.sx > 0 ? 'bike' : 'storage');
        const r1 = Rm(kind, X0, X1, Math.min(Zf0, Zf1), Math.max(Zf0, Zf1), kind === 'shop' ? 'café' : kind);
        const r2 = Rm(q.sz > 0 ? 'office' : 'storage', q.sx > 0 ? xin : R.x0, q.sx > 0 ? R.x1 : xin, Math.min(zmid0, zmid1), Math.max(zmid0, zmid1), q.sz > 0 ? 'management' : 'store');
        r1.doors.push({ to: q.ring.id, width: 1.2 }); r2.doors.push({ to: r1.id, width: 0.9 });
        continue;
      }
      // main band: [hall+kitchen strip near the core | living at the corner]
      const kx0 = q.sx > 0 ? 0 : xin, kx1 = q.sx > 0 ? xin : 0;
      const hallZ0 = q.sz > 0 ? Zf0 : Zf1 - 1.8, hallZ1 = q.sz > 0 ? Zf0 + 1.8 : Zf1;
      const hall = Rm('hall', kx0, kx1, Math.min(hallZ0, hallZ1), Math.max(hallZ0, hallZ1), 'hall');
      const kz0 = q.sz > 0 ? hallZ1 : Zf0, kz1 = q.sz > 0 ? Zf1 : hallZ0;
      const kit = Rm('kitchen', kx0, kx1, Math.min(kz0, kz1), Math.max(kz0, kz1));
      const liv = Rm('living', q.sx > 0 ? xin : X0, q.sx > 0 ? X1 : xin, Math.min(Zf0, Zf1), Math.max(Zf0, Zf1), 'living');
      // side band: bath next to the ring, bedroom(s) to the facade
      const bx0 = q.sx > 0 ? xin : R.x0, bx1 = q.sx > 0 ? R.x1 : xin;
      const bathW = 2.3;
      // set-back crown floors narrow the side band: below bath + 2.4 m there is no bedroom (it had no
      // usable wall to the living room and stayed unreachable) — the bath takes the band
      const roomyBand = bx1 - bx0 >= bathW + 2.4;
      const bath = roomyBand ? Rm('bath', q.sx > 0 ? bx0 : bx1 - bathW, q.sx > 0 ? bx0 + bathW : bx1, Math.min(zmid0, zmid1), Math.max(zmid0, zmid1)) : Rm('bath', bx0, bx1, Math.min(zmid0, zmid1), Math.max(zmid0, zmid1));
      const bed = roomyBand ? Rm('bedroom', q.sx > 0 ? bx0 + bathW : bx0, q.sx > 0 ? bx1 : bx1 - bathW, Math.min(zmid0, zmid1), Math.max(zmid0, zmid1), 'bedroom') : null;
      hall.doors.push({ to: q.ring.id, width: 1.0, kind: 'apartment' });
      kit.doors.push({ to: hall.id }); liv.doors.push({ to: hall.id, width: 1.2 });
      if (bed) { bed.doors.push({ to: liv.id }); bath.doors.push({ to: bed.id, width: 0.8 }); }
      bath.doors.push({ to: liv.id, width: 0.8 });
      plan.units.push({ id: uid, floor: f.level });
      if (f.level === nF - 1) plan.shafts.push([(bath.x0 + bath.x1) / 2, (bath.z0 + bath.z1) / 2]);
    }
    const rng = ctx.sub(220, f.level);
    const balconySides = { front: f.level > 0, back: f.level > 0, left: f.level > 0, right: f.level > 0 };
    f.openings = deriveOpenings(rooms.filter((r) => r.kind !== 'lobby' && r.kind !== 'shop'), { w, d, y: f.y, h: f.h, rng, style: st, inst, floor: f.level, slabT: plan.slabT, balconySides, blank: s._shared, bayW: plan.bayW, rect: R });
  }
  // entrance: lobby in the front ring, double doors on the axis; shop fronts in the front quadrants
  const lob = floors[0].rooms.find((r) => r.kind === 'lobby');
  // extend the lobby to the street: corridor from the ring to the front facade
  const entry = room('lobby', -1.6, 1.6, rz1, d / 2, { floor: 0, name: 'entrance hall' });
  floors[0].rooms = floors[0].rooms.map((r) => {
    if (r.kind === 'shop' && r.z1 > rz1 && Math.abs(r.z1 - d / 2) < 0.05) {
      // cut the entrance hall out of the shops
      if (r.x1 <= 0) r.x1 = -1.6; else r.x0 = 1.6;
    }
    return r;
  });
  floors[0].rooms.push(entry);
  entry.doors.push({ to: lob.id, width: 2.4 });
  for (const r of floors[0].rooms) if (r.kind === 'shop') r.doors = [{ to: entry.id, width: 1.2 }];
  const dw = 2.4;
  plan.entrances.push({ kind: 'main', side: 'front', u0: w / 2 - dw / 2, u1: w / 2 + dw / 2, v1: ffl + 2.6, room: entry });
  plan.extraOpenings.push({ side: 'front', u0: w / 2 - dw / 2, u1: w / 2 + dw / 2, v0: ffl, v1: ffl + 2.6, kind: 'door', doorKind: 'glazed_double', floor: 0, room: entry, vestibule: st.coveredEntry });
  for (const r of floors[0].rooms) {
    if (r.kind !== 'shop') continue;
    const u0 = r.x0 + w / 2, u1 = r.x1 + w / 2;
    plan.extraOpenings.push({ side: 'front', u0: u0 + 0.4, u1: u1 - 0.4, v0: ffl, v1: ffl + gh - 0.9, kind: 'shop', floor: 0, room: r, roomU0: u0, roomU1: u1, depth: r.z1 - r.z0, door: { u0: (u0 + u1) / 2 - 0.8, width: 1.6 } });
  }
  plan.lobby = { cx: 0, cz: (rz1 + d / 2) / 2, nx: 0, nz: 1, depth: d / 2 - rz1 };
  if (!s._shared.back) {
    plan.entrances.push({ kind: 'service', side: 'back', u0: w / 2 - 2.6, u1: w / 2 - 1.5, v1: ffl + 2.1 });
    plan.extraOpenings.push({ side: 'back', u0: w / 2 - 2.6, u1: w / 2 - 1.5, v0: ffl, v1: ffl + 2.1, kind: 'door', doorKind: 'service', floor: 0 });
  }
  return plan;
}

function towerFins(ctx, plan) {
  const b = ctx.b, inst = ctx.inst, st = ctx.style;
  if (st.bandShape !== 'curved' || !inst.fins) return;
  const rng = ctx.sub(801);
  const w = plan.w, d = plan.d;
  const side = plan.liveSide, sg = side === 'front' ? 1 : -1;
  const zf = sg * (d / 2 + Math.max(1.0, st.balconyDepth[0]) + 0.45);
  const top = plan.roof.y + 3.0;
  // two ribbons rising from the front corners, leaning in and bowing outwards, meeting under the crown
  for (const sx of [-1, 1]) {
    if (plan.shared[sx < 0 ? (side === 'front' ? 'left' : 'right') : (side === 'front' ? 'right' : 'left')]) continue;
    const pts = [];
    const x0 = sx * (w / 2 - 0.4), x1 = sx * (1.4 + rng.next() * 1.2);
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const e = smooth01(t);
      pts.push([x0 + (x1 - x0) * e, plan.ffl + (top - plan.ffl) * t, zf + sg * Math.sin(t * Math.PI) * 1.1]);
    }
    b.withTint(inst.bandTint, () => ribbonFin(b, pts, { width: 1.1, thickness: 0.5, samples: 6 }));
  }
}

// ---------------------------------------------------------------------------------------------
// Tower on a podium (urban.js TOWER_PODIUM: spec.meta.podium {floors, height, floorHeight} and
// spec.meta.tower {w, d, x, z, shape}): a shop / amenity podium over the whole plot with a roof
// garden terrace, the residential tower (rect or round) standing on it at meta.tower.
// ---------------------------------------------------------------------------------------------
function subContext(ctx, spec2, channelOffset) {
  const s = normalizeSpec({ ...spec2, __normalized: false });
  return { ...ctx, spec: s, sub: (channel, extra = 0) => ctx.sub(channel + channelOffset, extra) };
}
function podiumParts(ctx) {
  const s = ctx.spec, P = s._meta.podium, Tm = s._meta.tower;
  const pf = Math.max(1, Math.min(P.floors | 0, s._floors - 1));
  const pfh = P.floorHeight || 5;
  const podSpec = { ...s, floors: pf, floorHeight: pfh, groundFloorHeight: pfh, footprint: { shape: 'rect', w: s._w, d: s._d }, roof: 'garden', meta: { ...s._meta, roofKind: 'garden', podium: null, tower: null } };
  const tw = clamp(Tm.w, 12, s._w - 4), td = clamp(Tm.d, 12, s._d - 4);
  let tx = clamp(Tm.x || 0, -s._w / 2 + tw / 2 + 1, s._w / 2 - tw / 2 - 1), tz = clamp(Tm.z || 0, -s._d / 2 + td / 2 + 1, s._d / 2 - td / 2 - 1);
  // keep the podium's roof exit clear (fix round 3, QQ2-01): genericPlan puts the podium core against the back
  // wall, centred (≤ 5.1 m wide, stair for `pfh` storeys) — the tower stood on its stair house (or left < 2.2 m in
  // front of the door) and its floors could not be reached from the podium terrace. The tower moves forward until
  // a 2.2 m walkway is left in front of the stair-house door, else sideways off the core (same in the massing).
  const T = (ctx.style && ctx.style.wallT) || 0.3;
  const cz1 = -s._d / 2 + T + Math.max(4.6, stairLength(pfh, 1.4, 1.3)) + 0.05, cx0 = -2.6, cx1 = 2.6;
  if (tx - tw / 2 < cx1 + 1.0 && tx + tw / 2 > cx0 - 1.0 && tz - td / 2 < cz1 + 2.2) {
    const tzMin = cz1 + 2.2 + td / 2, tzMax = s._d / 2 - td / 2 - 1;
    const xr = cx1 + 1.2 + tw / 2, xl = cx0 - 1.2 - tw / 2;
    if (tzMin <= tzMax) tz = tzMin;
    else if (xr <= s._w / 2 - tw / 2 - 1) tx = xr;
    else if (xl >= -s._w / 2 + tw / 2 + 1) tx = xl;
    else tz = tzMax;
  }
  const towSpec = { ...s, floors: Math.max(1, s._floors - pf), groundFloorHeight: 4.2, footprint: { shape: Tm.shape === 'round' ? 'round' : 'tower', w: tw, d: td }, ground: { entrance: 0, min: 0, max: 0 }, sharedWalls: {}, entrances: [{ kind: 'main', side: 'front', offset: 0 }, { kind: 'service', side: 'back', offset: 0 }], meta: { ...s._meta, podium: null, tower: null } };
  return { pf, pfh, podSpec, towSpec, tw, td, tx, tz };
}
/**
 * Rect towers narrower than 20 m (podium plots give 12–20 m) cannot hold the point-block plan (stair + two
 * lifts in a 1.6 m corridor ring + four corner flats: no room left for the flats, unreachable rooms) → they
 * are generated as a slender residential block (residentialPlan: one core, one or two flats per floor).
 */
const smallTower = (Q) => Q.towSpec.footprint.shape !== 'round' && Math.min(Q.tw, Q.td) < 20;
function generatePodiumTower(spec, lod, ctx) {
  const b = ctx.b;
  const Q = podiumParts(ctx);
  // podium
  const pctx = subContext(ctx, Q.podSpec, 3000);
  const plan = genericPlan(pctx, { kind: 'office', groundKind: 'shop' });
  const keepOut = [{ x0: Q.tx - Q.tw / 2 - 1.2, x1: Q.tx + Q.tw / 2 + 1.2, z0: Q.tz - Q.td / 2 - 1.2, z1: Q.tz + Q.td / 2 + 1.2 }];
  assembleAll(pctx, plan, { roof: { garden: true, keepOut, stairHouse: true } });
  const podA = JSON.parse(JSON.stringify(b.anchors));
  // tower on the podium roof
  const yOff = plan.roof.y + 0.05;
  const tctx = subContext(ctx, Q.towSpec, 6000);
  tctx.onPodium = true;
  b.anchors = { entrances: [], floors: [], roof: null, rooms: [], windows: [], cameras: {} };
  b.push(); b.translate(Q.tx, yOff, Q.tz);
  if (Q.towSpec.footprint.shape === 'round') generateRoundTower(Q.towSpec, lod, tctx);
  else if (smallTower(Q)) generateResidential(Q.towSpec, lod, tctx);   // slender point block (see smallTower)
  else generateRectTower(tctx);
  b.pop();
  // merge anchors (tower anchors were written in its own frame)
  const off = (p) => (p ? [p[0] + Q.tx, p[1] + yOff, p[2] + Q.tz] : p);
  const T = b.anchors;
  b.anchors = podA;
  const nPod = podA.floors.length;     // (read before podA.floors is replaced: tower room floors were offset by the merged count)
  b.anchors.floors = [...podA.floors, ...T.floors.map((f) => ({ ...f, level: f.level + nPod, y: f.y + yOff }))];
  b.anchors.roof = T.roof ? { y: T.roof.y + yOff, access: off(T.roof.access) } : podA.roof;
  b.anchors.rooms = [...(podA.rooms || []), ...(T.rooms || []).map((r) => ({ ...r, floor: r.floor + nPod, center: off(r.center) }))];
  b.anchors.cameras.roof = T.cameras.roof ? { pos: off(T.cameras.roof.pos), target: off(T.cameras.roof.target) } : podA.cameras.roof;
  b.anchors.cameras.terrace = T.cameras.entrance ? { pos: off(T.cameras.entrance.pos), target: off(T.cameras.entrance.target) } : undefined;
  b.meta.podium = { floors: Q.pf, height: yOff };
}
function podiumMassing(spec, ctx) {
  const Q = podiumParts(ctx);
  const pctx = subContext(ctx, Q.podSpec, 3000);
  const s = pctx.spec;
  const ffl = 0.3, ph = Q.pf * Q.pfh;
  const vols = [{ x0: -s._w / 2, x1: s._w / 2, z0: -s._d / 2, z1: s._d / 2, y0: Math.min(0, s._ground.min) - 0.5, y1: ffl + ph, parapet: 1.1, floorH: Q.pfh, groundH: Q.pfh + ffl, bayW: 4.5, blank: s._shared, flags: 2, shops: true, garden: true, roofColor: [0.42, 0.52, 0.36] }];
  const tctx = subContext(ctx, Q.towSpec, 6000);
  const tv = Q.towSpec.footprint.shape === 'round' ? roundTowerMassing(Q.towSpec, tctx) : smallTower(Q) ? residentialMassing(Q.towSpec, tctx) : rectTowerMassing(tctx);
  const yOff = ffl + ph + 0.05;
  for (const v of tv) vols.push({ ...v, x0: v.x0 + Q.tx, x1: v.x1 + Q.tx, z0: v.z0 + Q.tz, z1: v.z1 + Q.tz, y0: Math.max(v.y0, 0) + yOff, y1: v.y1 + yOff, groundH: v.groundH + yOff, uBase: 2 * (s._w + s._d) });
  return vols;
}

function generateRectTower(ctx) {
  const plan = towerPlan(ctx);
  emitFacades(ctx, plan);
  const st = ctx.style;
  if (st.bands || st.balconyDepth[1] > 0) {
    const fn = residentialBands(ctx, plan);
    emitBands(ctx, plan, (L, side, rect) => {
      const v = fn(L, side, rect);
      if (side === 'left' || side === 'right') return plan.shared[side] ? 0 : (L === plan.floors.length ? 0.55 : Math.max(1.2, st.balconyDepth[0] * 0.85));
      if (side === plan.serviceSide && L < plan.floors.length) return Math.max(st.balconyDepth[0] * 0.8, 0.6);
      return v;
    }, { up: st.bandShape === 'flat' ? 0.15 : 0.3, cornerR: 2.8, railFn: (L, depth) => (depth > 0.85 || L === plan.floors.length ? ctx.inst.railing : null) });
  }
  towerFins(ctx, plan);
  emitRoof(ctx, plan, { garden: plan.roof.kind === 'garden', stairHouse: true });
  // on a podium roof: no bin store / bike racks in the service yard (they stood in front of the podium's
  // stair-house door — the tower floors could not be reached from the podium, QQ2-01)
  emitBase(ctx, plan, { canopy: st.bandShape === 'curved' ? 'curved' : 'flat', ...(ctx.onPodium ? { binStore: false, bikes: false } : {}) });
  if (ctx.full) emitInterior(ctx, plan);
  emitAnchors(ctx, plan);
}
function rectTowerMassing(ctx) {
  const plan = towerFloors(ctx);
  const vols = [];
  let i0 = 0;
  for (let i = 1; i <= plan.floors.length; i++) {
    const a = plan.floors[i0], f = plan.floors[i];
    if (f && JSON.stringify(f.inset) === JSON.stringify(a.inset)) continue;
    const r = rectOf(plan, a), last = plan.floors[i - 1];
    vols.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y0: i0 === 0 ? Math.min(0, ctx.spec._ground.min) - 0.5 : a.y, y1: last.y + last.h, parapet: i === plan.floors.length ? 1.1 : 0.3, floorH: plan.floors[1]?.h || 3.1, groundH: plan.floors[0].h + plan.ffl, bayW: plan.bayW, blank: plan.shared, garden: plan.roof.kind === 'garden', flags: 4 | 2, shops: true, bands: !!ctx.style.bands && ctx.style.bandShape !== 'none' });
    i0 = i;
  }
  return vols;
}
const hasPodium = (s) => !!(s._meta && s._meta.podium && s._meta.tower && s._meta.podium.floors > 0 && s._floors > (s._meta.podium.floors | 0) + 2);

export default {
  name: 'residential_tower',
  uses: ['residential_tower'],
  generate(spec, lod, ctx) {
    if (hasPodium(ctx.spec)) { generatePodiumTower(spec, lod, ctx); return; }
    if (ctx.spec.footprint && ctx.spec.footprint.shape === 'round') { generateRoundTower(spec, lod, ctx); return; }
    generateRectTower(ctx);
  },
  massing(spec, ctx) {
    if (hasPodium(ctx.spec)) return podiumMassing(spec, ctx);
    if (ctx.spec.footprint && ctx.spec.footprint.shape === 'round') return roundTowerMassing(spec, ctx);
    return rectTowerMassing(ctx);
  },
};
