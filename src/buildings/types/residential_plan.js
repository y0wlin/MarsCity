// Residential plan-first layout (shared by residential, residential_tower, shop_row).
//
// From the spec: arrival side (front/street door → lobby with mailbox wall → core), service
// side (core against it, back door under the ground-floor stair flight → bin store / yard),
// daylight side (living rooms + balconies on the sunnier long facade). Width is split into
// core groups (stair + lift, 一梯两户) each serving two through-units; units are split into bays
// (3.3–4.2 m) and bands: living band (living + bedrooms), hall band (entry from the landing),
// service band (kitchen, bath around a vertical shaft, second bedroom). Facade openings are then
// derived from these rooms so every window belongs to a real room (§1).

import { coreLayout, coreLayoutX, groundSplit, stairLength, stairLengthX } from '../kit/cores.js';
import { room, resetRoomIds, deriveOpenings } from '../kit/plan.js';
import { daylightScore } from '../kit/spec.js';
import { bayCount, clamp } from '../kit/math.js';
import { roofSpec } from '../kit/styles.js';

/**
 * Terrace setbacks (zr_terrace, Z04 canyon): as many planted steps of 1.4–2.4 m as the living band
 * allows (≤ 3, never the ground floor, at most every floor above the second), equal step depth.
 */
export function terraceSteps(maxInset, nF, d) {
  if (maxInset < 1.2 || nF < 3) return { steps: 0, step: 0 };
  const pref = clamp(d * 0.12, 1.6, 2.4);
  let steps = Math.min(3, nF - 2, Math.max(1, Math.floor(maxInset / 1.4 + 1e-6)));
  while (steps > 1 && maxInset / steps > pref * 1.5) steps--;
  const step = Math.min(2.4, maxInset / steps);
  return { steps, step: Math.round(step * 100) / 100 };
}

/**
 * Ground-floor arcade (檐廊) depth for shop rows on the street side, 0 = none. Cold valleys and
 * covered districts always shelter the walkway (§3 在寒谷把步道收进有顶廊); the ZR styles roll per
 * instance. Needs a real block (not a shop-house), ≥ 2 floors and enough depth behind the colonnade.
 * o.arcade: number (force depth) | false (never).
 */
export function arcadeDepth(ctx, o = {}) {
  const s = ctx.spec, st = ctx.style;
  if (o.arcade === false || o.ground !== 'shops') return 0;
  if (typeof o.arcade === 'number') return o.arcade;
  if (st.id === 'o_utility' || s._floors < 2 || s._w < 10.5 || s._d < 11.5 || isHouse(s, o)) return 0;
  const r = ctx.sub(720);
  const p = st.id === 'zr_cold' || (s._meta && s._meta.covered) ? 1 : st.id === 'zr_island' ? 0.6 : st.id === 'zr_terrace' ? 0.3 : 0.5;
  if (r.next() >= p) return 0;
  return Math.round(clamp(2.5 + r.next() * 0.8 + (s._d - 12) * 0.04, 2.4, 3.3) * 20) / 20;
}

/**
 * @param {object} ctx  generation context
 * @param {object} [o]  {ground:'units'|'shops', gh, ffl, terrace:boolean, minFront}
 * @returns PlanModel (+ residential extras: liveSide, units, groupsX)
 */
export function residentialPlan(ctx, o = {}) {
  resetRoomIds();
  const s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const w = s._w, d = s._d, T = st.wallT;
  const nF = s._floors;
  const fh = s.floorHeight ? s._fh : st.storeyH;
  const shops = o.ground === 'shops';
  const gh = s._gh || o.gh || (shops ? 4.5 : st.id === 'zr_ceramic' || st.id === 'zr_glass' ? 4.0 : 3.6);
  let ffl = o.ffl ?? (st.id === 'zr_cold' ? 0.6 : shops ? 0.15 : 0.45);
  // never bury the ground floor on the street side
  ffl = Math.max(ffl, Math.max(s._ground.fl, s._ground.fr) + 0.12);
  const floors = [];
  let y = ffl;
  for (let i = 0; i < nF; i++) { const h = i === 0 ? gh : fh; floors.push({ level: i, y, h, rooms: [], openings: [], inset: {} }); y += h; }
  const R = roofSpec(s, st, inst);
  let roofKind = R.kind === 'other' ? 'flat' : R.kind;
  if (o.terrace ?? st.terrace > 0) roofKind = roofKind === 'pitched' ? 'garden' : roofKind;
  // pitched roofs need a plan that the ridge can span (deep blocks / towers keep flat roofs)
  if (roofKind === 'pitched' && (nF > 6 || Math.min(w, d) > 16)) roofKind = 'flat';
  const plan = {
    w, d, ffl, wallT: T, slabT: 0.22, floors,
    roof: { y, parapet: roofKind === 'garden' ? 1.1 : 1.05, wallParapet: roofKind === 'pitched' ? 0 : roofKind === 'garden' && st.bandShape === 'curved' ? 0.32 : 1.05, kind: roofKind, surface: R.surface, pitchKey: R.pitchKey, tint: R.tint, solar: R.solar, skylights: R.skylights },
    shared: s._shared, entrances: [], extraOpenings: [], shafts: [], units: [],
    bayW: w / bayCount(w),
  };
  // ---- sides -------------------------------------------------------------
  const dsF = daylightScore(s, 'front'), dsB = daylightScore(s, 'back');
  plan.liveSide = s._shared.back ? 'front' : (dsB > dsF + 0.25 ? 'back' : 'front');
  plan.serviceSide = s._shared.back ? 'front' : 'back';
  // ---- ground-floor arcade on the street (arrival) side: shops sit behind the colonnade ----
  const arc = arcadeDepth(ctx, o);
  if (arc > 0) {
    const arrSide = plan.serviceSide === 'back' ? 'front' : 'back';
    floors[0].inset = { [arrSide]: arc };
    plan.arcade = { side: arrSide, depth: arc };
  }
  // ---- narrow plots (w < 9.5 m, more storeys than a house): one flat per floor (一梯一户) beside a
  // stair column along a side wall (fix round 3, QQ2-01: the old 'small' layout drew one room over
  // the whole floor — the stair well was slabbed over and no upper floor could be reached)
  if (w < 9.5) { narrowPlan(ctx, plan, o); return plan; }
  // ---- cores along x -------------------------------------------------------
  const maxRise = Math.max(gh, fh);
  const zS = plan.serviceSide === 'back' ? -d / 2 + T : d / 2 - T; // inner face of the service wall
  const towards = plan.serviceSide === 'back' ? 1 : -1;
  // SHALLOW plans (fix round 3, QQ2-01 / QA2P-03): a stair along z (≈ 6.2 m with the ground-floor
  // passage) leaves < 3.2 m in front of it — no lobby to the street door, no living band. The stair
  // then runs along x against the service wall (kit/cores.js coreLayoutX) with the landing / lobby in
  // front of it; no lift (walk-up), the service door opens off the floor landing.
  const gs0 = groundSplit(gh);
  const LzZ = Math.max(4.6, stairLength(maxRise, 1.4, 1.2, gs0.run));
  const shallow = d - T - LzZ < 3.2;
  // core column width: stair + lift (≥ 4 storeys) or the stair alone — units start right at the
  // core, so the rooms tile the plan without gaps (a 5.2 m core slot without a lift left 1.2 m
  // strips of no room between the stair and both flats: unreachable 2–3 storey slabs / dorms)
  const hasLift = nF >= 4 && !shallow;
  const CW = shallow ? stairLengthX(maxRise) : hasLift ? 2.8 + 0.1 + 2.3 : 2.8;
  plan.shallow = shallow;
  let ng = clamp(Math.round(w / 21), 1, 8);
  while (ng > 1 && (w - ng * CW) / (2 * ng) < 6.0) ng--;
  let layout = (w - CW) / 2 >= 5.4 || ng > 1 ? 'pair' : 'end';
  if (w < 9.5) layout = 'small';
  const groups = [];
  if (layout === 'pair') {
    const uw = (w - ng * CW) / (2 * ng);
    for (let g = 0; g < ng; g++) {
      const gx0 = -w / 2 + g * (2 * uw + CW);
      const cx = gx0 + uw + CW / 2;
      groups.push({ cx, units: [[gx0, gx0 + uw, 'right'], [gx0 + uw + CW, gx0 + 2 * uw + CW, 'left']] });
    }
    // honour the spec's main entrance position: move the nearest core towards it
    const me = s._entrances.find((e) => e.kind === 'main' && e.side === 'front');
    if (me && Math.abs(me.offset) > 0.5) {
      const want = clamp(me.offset, -w / 2 + CW, w / 2 - CW);
      let gi = 0; for (let g = 1; g < groups.length; g++) if (Math.abs(groups[g].cx - want) < Math.abs(groups[gi].cx - want)) gi = g;
      const g = groups[gi];
      const delta = clamp(want - g.cx, -(uw - 5.6), uw - 5.6);
      if (Math.abs(delta) > 0.3) {
        g.cx += delta;
        g.units[0][1] += delta; g.units[1][0] += delta;
      }
    }
  } else if (layout === 'end') {
    // core at the end away from a party wall (or the right end); the lift column (and the room
    // behind it) always faces the flat, the stair runs along the end wall. A shallow (along-x)
    // stair stops at the end wall's inner face: its core is one wall thickness longer.
    const atLeft = !!s._shared.right && !s._shared.left;
    const CWe = shallow ? CW + T - 0.1 : CW;
    const cx = atLeft ? -w / 2 + CWe / 2 : w / 2 - CWe / 2;
    groups.push({ cx, liftSide: atLeft ? 1 : -1, wallEnd: atLeft ? 'x0' : 'x1', units: atLeft ? [[-w / 2 + CWe, w / 2, 'left']] : [[-w / 2, w / 2 - CWe, 'right']] });
  } else {
    groups.push({ cx: 0, units: [], small: true });
  }
  // stair needs the ground-floor passage under flight B: split flights so the half landing ≥ 2.35
  const coreDepthMax = d - 2 * T - 3.0;
  plan.cores = [];
  for (const g of groups) {
    if (shallow && !g.small) {
      // floor landing at the end of the stair facing the building centre (the flats of an end core)
      const c = coreLayoutX({ cx: g.cx, zBack: zS, towards, maxRise, landAt: g.cx >= 0 ? 'minx' : 'maxx', landingDepth: 1.5, wallEnd: g.wallEnd, wallT: T });
      c.liftSide = 1;
      g.core = c; plan.cores.push(c);
      continue;
    }
    const lift = hasLift && !g.small;
    const gs = groundSplit(gh);
    const c = coreLayout({ cx: g.cx, zBack: zS, towards, maxRise, minRun: gs.run, lift, liftSide: g.liftSide || 1, landingDepth: 1.8, W: g.small ? 2.5 : 2.8, halfD: 1.2 });
    c.liftSide = g.liftSide || 1;
    c.split0 = [gs.n1, gs.n2];
    if (c.z1 - c.z0 > coreDepthMax) { c.landing.z1 = towards > 0 ? c.landing.z0 + 1.3 : c.landing.z1; }
    g.core = c; plan.cores.push(c);
  }
  plan.core = plan.cores[0];
  // ---- setbacks (terraces on the living side, canyon style): keep ≥ 3.8 m of living band ----
  if (o.terrace ?? st.terrace > 0) {
    const c0 = plan.cores[0];
    const bandFree = c0 ? (plan.liveSide === 'front' ? d / 2 - T - Math.min(c0.landing.z1, d / 2) : Math.max(c0.landing.z0, -d / 2) - (-d / 2 + T)) : d * 0.4;
    const { steps, step } = terraceSteps(Math.max(0, bandFree - 3.4), nF, d);
    if (steps > 0) {
      const startAt = Math.max(1, nF - steps);
      for (let i = startAt; i < nF; i++) floors[i].inset = { [plan.liveSide]: (i - startAt + 1) * step };
    }
  }
  // ---- rooms per floor ----------------------------------------------------
  const zLand0 = (c) => (towards > 0 ? c.stair.z1 : c.stair.z0);  // landing starts at the stair end
  const liveFront = plan.liveSide === 'front';
  let unitId = 0;
  for (const f of floors) {
    const insF = f.inset.front || 0, insB = f.inset.back || 0;
    const zF = d / 2 - insF, zB = -d / 2 + insB; // floor rect front/back lines
    const rooms = f.rooms;
    unitId = 0;
    for (const g of groups) {
      const c = g.core;
      if (g.small) { smallPlan(ctx, plan, f, zF, zB); continue; }
      // core column rooms
      const st0 = c.stair;
      const stairR = room('stair', st0.x0, st0.x1, towards > 0 ? -d / 2 : st0.z0, towards > 0 ? st0.z1 : d / 2, { floor: f.level });
      rooms.push(stairR);
      const zl0 = zLand0(c), LD = c.alongX ? 1.5 : 1.8;
      let zl1 = towards > 0 ? Math.min(zl0 + LD, zF - 0.5) : Math.max(zl0 - LD, zB + 0.5);
      // never leave a slit of ≤ 0.9 m between the landing and the facade: it had no room at all (a hole
      // in the floor; the lobby stopped short of the street door — QA2P-03 dorm OX3-1.3.9.1as-31.0-0)
      if (towards > 0 ? zF - zl1 <= 0.9 : zl1 - zB <= 0.9) zl1 = towards > 0 ? zF : zB;
      let liftR = null, behind = null;
      // lift column beside the stair (rooms tile the plan without gaps; partitions come from
      // shared edges): right of the stair, or left of it for a core at the right end
      const lx0 = c.liftSide < 0 ? c.x0 : st0.x1, lx1 = c.liftSide < 0 ? st0.x0 : c.x1;
      if (c.lift) {
        const L = c.lift;
        liftR = room('lift', lx0, lx1, L.z0, L.z1, { floor: f.level });
        rooms.push(liftR);
        const bz0 = towards > 0 ? -d / 2 : L.z1, bz1 = towards > 0 ? L.z0 : d / 2;
        if (bz1 - bz0 > 1.0) { behind = room(f.level === 0 ? 'bike' : 'bath', lx0, lx1, bz0, bz1, { floor: f.level, name: f.level === 0 ? 'bike store' : 'bath' }); rooms.push(behind); }
      } else if (lx1 - lx0 > 0.8) {
        // no lift but a wider core slot: the space beside the stair is a store
        const bz0 = towards > 0 ? -d / 2 : zl0, bz1 = towards > 0 ? zl0 : d / 2;
        behind = room(f.level === 0 ? 'bike' : 'storage', lx0, lx1, bz0, bz1, { floor: f.level, extra: { noWindows: f.level !== 0 } }); rooms.push(behind);
      }
      // landing / lobby
      const lz0 = Math.min(zl0, zl1), lz1 = Math.max(zl0, zl1);
      const front0 = f.level === 0;
      const landing = room(front0 ? 'lobby' : 'corridor', c.x0, c.x1, lz0, lz1, { floor: f.level, name: front0 ? 'lobby' : 'landing' });
      rooms.push(landing);
      if (c.alongX) {
        // along-x stair: the door to the landing sits at the floor landing (one x end of the stair);
        // above the ground floor doors into the stair room are cut only there (kit/plan.js repairDoors)
        const e0 = st0.endInset0 ?? 0.1, e1 = st0.endInset1 ?? 0.1, lD = st0.landD ?? 1.3;
        const minx = st0.landAt === 'minx';
        stairR.landing = minx ? { x0: st0.x0, x1: st0.x0 + e0 + lD + 0.05, z0: stairR.z0, z1: stairR.z1 } : { x0: st0.x1 - e1 - lD - 0.05, x1: st0.x1, z0: stairR.z0, z1: stairR.z1 };
        stairR.doors.push({ to: landing.id, width: 1.1, pos: [minx ? st0.x0 + e0 + lD / 2 : st0.x1 - e1 - lD / 2, towards > 0 ? st0.z1 : st0.z0] });
      } else stairR.doors.push({ to: landing.id, width: 1.1 });
      if (behind && f.level === 0) behind.doors.push({ to: stairR.id, width: 0.9 });
      // front zone of the core column (between landing and the front line)
      const fz0 = towards > 0 ? lz1 : zB, fz1 = towards > 0 ? zF : lz0;
      if (fz1 - fz0 > 0.9) {
        if (front0) {
          // lobby extends to the street door
          landing.z0 = Math.min(landing.z0, fz0); landing.z1 = Math.max(landing.z1, fz1);
          if (towards < 0) { landing.z0 = fz0; }
        } else {
          // split between the two adjacent units as studies / bedrooms
          const mid = (c.x0 + c.x1) / 2;
          // narrow core columns give their front zone to one unit (no 1.4 m slit rooms); an end core has
          // one flat only, which takes the whole zone (the far half used to stay a hole in the plan)
          const all = [c.x0, c.x1, fz0, fz1];
          g.frontZone = g.units.length < 2 ? [all, all] : c.x1 - c.x0 < 4.8 ? [all, null] : [[c.x0, mid, fz0, fz1], [mid, c.x1, fz0, fz1]];
        }
      }
      // units
      for (let ui = 0; ui < g.units.length; ui++) {
        const [ux0, ux1, coreSide] = g.units[ui];
        const uid = `${groups.indexOf(g)}-${ui}`;
        if (f.level === 0 && shops) { shopUnit(ctx, plan, f, ux0, ux1, zF, zB, uid, landing); continue; }
        const extra = g.frontZone && !front0 ? g.frontZone[coreSide === 'right' ? 0 : 1] : null;
        // the room behind the lift belongs to the flat on the lift side of the core
        const liftSideUnit = c.liftSide < 0 ? coreSide === 'right' : coreSide === 'left';
        unitRooms(ctx, plan, f, { ux0, ux1, coreSide, zF, zB, zl0: lz0, zl1: lz1, uid, landing, behind: liftSideUnit && behind && f.level > 0 ? behind : null, extra, liveFront });
        unitId++;
      }
      // shaft vents (above baths)
      if (f.level === nF - 1) for (const r of rooms) if (r.kind === 'bath') plan.shafts.push([(r.x0 + r.x1) / 2, towards > 0 ? r.z0 + 0.5 : r.z1 - 0.5]);
    }
    // openings from rooms
    const rng = ctx.sub(210, f.level);
    const balconySides = {};
    if (ctx.style.balconyDepth[1] > 0.8) balconySides[plan.liveSide] = f.level > 0;
    f.openings = deriveOpenings(rooms.filter((r) => r.kind !== 'lobby' && r.kind !== 'shop'), { w, d, y: f.y, h: f.h, rng, style: st, inst, floor: f.level, slabT: plan.slabT, balconySides, blank: s._shared, bayW: plan.bayW, rect: { x0: -w / 2, x1: w / 2, z0: zB, z1: zF } });
  }
  // ---- entrances: street door per core, service door under the stair -------
  for (const g of groups) {
    const c = g.core; if (!c) continue;
    const lob = floors[0].rooms.find((r) => r.kind === 'lobby' && Math.abs((r.x0 + r.x1) / 2 - c.x0 - (c.x1 - c.x0) / 2) < 0.2) || floors[0].rooms.find((r) => r.kind === 'lobby');
    const arr = plan.serviceSide === 'back' ? 'front' : 'back';
    const uC = arr === 'front' ? (c.x0 + c.x1) / 2 + w / 2 : w / 2 - (c.x0 + c.x1) / 2;
    const dw = 1.8;
    plan.entrances.push({ kind: 'main', side: arr, u0: uC - dw / 2, u1: uC + dw / 2, v1: ffl + 2.4, room: lob });
    plan.extraOpenings.push({ side: arr, u0: uC - dw / 2, u1: uC + dw / 2, v0: ffl, v1: ffl + 2.4, kind: 'door', doorKind: 'glazed_double', floor: 0, room: lob, vestibule: st.coveredEntry });
    // glazed lobby side lights / transom
    if (lob) {
      const span0 = arr === 'front' ? lob.x0 + w / 2 : w / 2 - lob.x1, span1 = arr === 'front' ? lob.x1 + w / 2 : w / 2 - lob.x0;
      for (const [a, b] of [[span0 + 0.35, uC - dw / 2 - 0.3], [uC + dw / 2 + 0.3, span1 - 0.35]]) if (b - a > 0.55) plan.extraOpenings.push({ side: arr, u0: a, u1: b, v0: ffl, v1: ffl + 2.75, kind: 'shop', floor: 0, room: lob, roomU0: span0, roomU1: span1, depth: lob.z1 - lob.z0 });
      plan.lobby = { cx: (lob.x0 + lob.x1) / 2, cz: (lob.z0 + lob.z1) / 2, nx: 0, nz: arr === 'front' ? 1 : -1, depth: lob.z1 - lob.z0 };
    }
    // service door of an along-x (shallow) stair: off the ground-floor floor landing, in the service
    // wall at that end of the stair (the floor-1 landing slab gives it headroom)
    if (c.alongX && !s._shared[plan.serviceSide]) {
      const st0 = c.stair, e0 = st0.endInset0 ?? 0.1, e1 = st0.endInset1 ?? 0.1, lD = st0.landD ?? 1.3;
      const dx0 = st0.landAt === 'minx' ? st0.x0 + e0 + 0.12 : st0.x1 - e1 - 0.12 - Math.min(0.95, lD - 0.3);
      const dx1 = dx0 + Math.min(0.95, lD - 0.3);
      const u0 = plan.serviceSide === 'back' ? w / 2 - dx1 : dx0 + w / 2, u1 = u0 + (dx1 - dx0);
      plan.entrances.push({ kind: 'service', side: plan.serviceSide, u0, u1, v1: ffl + 2.1 });
      plan.extraOpenings.push({ side: plan.serviceSide, u0, u1, v0: ffl, v1: ffl + 2.1, kind: 'door', doorKind: 'service', floor: 0 });
    }
    // service door: under flight B (half landing ≥ 2.35 m) in the service wall
    if (!c.alongX && !s._shared[plan.serviceSide]) {
      const st0 = c.stair, fw = Math.min(1.25, (st0.x1 - st0.x0 - 0.36) / 2);
      // flight B side in plan x: stair local x maps to building −x when landing at max z
      const xb0 = towards > 0 ? st0.x0 + 0.12 : st0.x1 - 0.12 - fw, xb1 = xb0 + fw;
      const u0 = plan.serviceSide === 'back' ? w / 2 - xb1 : xb0 + w / 2;
      plan.entrances.push({ kind: 'service', side: plan.serviceSide, u0: u0 + 0.12, u1: u0 + fw - 0.08, v1: ffl + 2.1 });
      plan.extraOpenings.push({ side: plan.serviceSide, u0: u0 + 0.12, u1: u0 + fw - 0.08, v0: ffl, v1: ffl + 2.1, kind: 'door', doorKind: 'service', floor: 0 });
      c.groundSplit = true;
    }
    // stair windows on the service facade: vertical strip (ZR) or staggered at half landings
    if (!s._shared[plan.serviceSide]) {
      const st0 = c.stair;
      let xa = st0.x0 + 0.35, xb = st0.x1 - 0.35;
      if (c.alongX) {
        // along-x stair: the window lights the half landing at the far end of the flights
        const e0 = st0.endInset0 ?? 0.1, e1 = st0.endInset1 ?? 0.1, hD = st0.halfD ?? 1.15;
        if (st0.landAt === 'minx') { xa = st0.x1 - e1 - hD; xb = st0.x1 - e1; } else { xa = st0.x0 + e0; xb = st0.x0 + e0 + hD; }
      }
      const u0 = plan.serviceSide === 'back' ? w / 2 - xb : xa + w / 2, u1 = plan.serviceSide === 'back' ? w / 2 - xa : xb + w / 2;
      const stairRoomOf = (i) => floors[i].rooms.find((r) => r.kind === 'stair' && r.x0 === st0.x0);
      if (ctx.style.bandShape === 'curved' && floors.length > 1) {
        const transoms = [];
        const v0 = floors[0].y + 2.6;
        for (let i = 1; i < floors.length; i++) transoms.push(floors[i].y - v0);
        plan.extraOpenings.push({ side: plan.serviceSide, u0, u1, v0, v1: plan.roof.y - 0.25, kind: 'strip', floor: 1, room: stairRoomOf(1), transoms: transoms.filter((t) => t > 0.3), cols: 2, coreStrip: true });
        g.stripU = [u0 - 0.5, u1 + 0.5];
      } else {
        for (let i = 0; i < floors.length - 1; i++) {
          const f = floors[i];
          const vh = f.y + (i === 0 && !c.alongX ? 2.45 : f.h * 0.5) + 0.95;
          const v1 = Math.min(vh + 1.15, floors[i + 1].y + floors[i + 1].h - 0.5);
          plan.extraOpenings.push({ side: plan.serviceSide, u0: u0 + 0.2, u1: u1 - 0.2, v0: vh, v1, kind: 'casement', floor: i, room: stairRoomOf(i) });
        }
      }
    }
  }
  plan.groups = groups;
  return plan;
}

/**
 * Floors / roof only (no rooms) — cheap path for the 'mass' LOD (same heights and setbacks as
 * residentialPlan so far and near silhouettes agree).
 */
export function residentialFloors(ctx, o = {}) {
  const s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const d = s._d, nF = s._floors;
  const fh = s.floorHeight ? s._fh : st.storeyH;
  const shops = o.ground === 'shops';
  const house = isHouse(s, o);
  const gh = s._gh || o.gh || (house ? (shops ? 4.2 : 3.1) : shops ? 4.5 : st.id === 'zr_ceramic' || st.id === 'zr_glass' ? 4.0 : 3.6);
  let ffl = o.ffl ?? (st.id === 'zr_cold' ? (house ? 0.55 : 0.6) : shops ? 0.15 : 0.45);
  ffl = Math.max(ffl, Math.max(s._ground.fl, s._ground.fr) + 0.12);
  const floors = []; let y = ffl;
  for (let i = 0; i < nF; i++) { const h = i === 0 ? gh : fh; floors.push({ level: i, y, h, inset: {} }); y += h; }
  const live = s._shared.back ? 'front' : (daylightScore(s, 'back') > daylightScore(s, 'front') + 0.25 ? 'back' : 'front');
  const arc = arcadeDepth(ctx, o);
  if (arc > 0) floors[0].inset = { [s._shared.back ? 'back' : 'front']: arc };
  // (same core depth as residentialPlan: narrow plots have no terraces, shallow plans an along-x stair
  // band of 2.6 m + a 1.5 m landing)
  if (!house && s._w >= 9.5 && (o.terrace ?? st.terrace > 0)) {
    const T = st.wallT;
    const Lz = Math.max(4.6, stairLength(Math.max(gh, fh), 1.4, 1.2, groundSplit(gh).run));
    const coreD = d - T - Lz < 3.2 ? 2.6 + 1.5 : Lz + 1.8;
    const { steps, step } = terraceSteps(Math.max(0, d - 2 * T - coreD - 3.4), nF, d);
    if (steps > 0) { const startAt = Math.max(1, nF - steps); for (let i = startAt; i < nF; i++) floors[i].inset = { [live]: (i - startAt + 1) * step }; }
  }
  const R = roofSpec(s, st, inst);
  let kind = R.kind === 'other' ? 'flat' : R.kind;
  if (!house && (o.terrace ?? st.terrace > 0)) kind = kind === 'pitched' ? 'garden' : kind;
  if (!house && kind === 'pitched' && (nF > 6 || Math.min(s._w, d) > 16)) kind = 'flat';
  return { w: s._w, d, ffl, floors, roof: { y, kind, spec: R, ridgeAxis: house && (s._shared.left || s._shared.right) ? 'x' : null }, shared: s._shared, bayW: house ? s._w / bayCount(s._w, 2.8, 4.4, 3.6) : s._w / bayCount(s._w), liveSide: live, house, arcade: arc > 0 ? { side: s._shared.back ? 'back' : 'front', depth: arc } : null };
}

/** Rooms of one through-unit on one floor. */
function unitRooms(ctx, plan, f, u) {
  const { ux0, ux1, coreSide, zF, zB, zl0, zl1, uid, landing, behind, extra, liveFront } = u;
  const rooms = f.rooms;
  const uw = ux1 - ux0;
  const nb = uw >= 6.0 ? clamp(Math.round(uw / 3.7), 2, 4) : 1;
  const outerLeft = coreSide === 'right'; // core is to the right → outer edge at ux0
  // bay boundaries from the outer edge
  const bx = [];
  for (let i = 0; i <= nb; i++) bx.push(outerLeft ? ux0 + (uw * i) / nb : ux1 - (uw * i) / nb);
  const span = (i) => [Math.min(bx[i], bx[i + 1]), Math.max(bx[i], bx[i + 1])];
  // bands
  const hallZ0 = Math.min(zl0, zl1), hallZ1 = Math.max(zl0, zl1);
  let frontZ0 = hallZ1, frontZ1 = zF, backZ0 = zB, backZ1 = hallZ0;
  // shallow plans: no separate hall band — the living band reaches back to the landing and the
  // flat door opens straight into the living room (entry corner)
  const liveDepth = liveFront ? frontZ1 - frontZ0 : backZ1 - backZ0;
  const mergeHall = liveDepth < 3.4;
  if (mergeHall) { if (liveFront) frontZ0 = hallZ0; else backZ1 = hallZ1; }
  const liveBand = liveFront ? [frontZ0, frontZ1] : [backZ0, backZ1];
  const servBand = liveFront ? [backZ0, backZ1] : [frontZ0, frontZ1];
  const R = (kind, x0, x1, z0, z1, name) => { const r = room(kind, x0, x1, z0, z1, { floor: f.level, unit: uid, name: name || kind }); rooms.push(r); return r; };
  // hall band (entry from the landing)
  const hall = mergeHall ? null : R('hall', ux0, ux1, hallZ0, hallZ1, 'hall');
  if (hall) hall.doors.push({ to: landing.id, width: 1.0, kind: 'apartment' });
  // living band
  const lv = [];
  if (liveBand[1] - liveBand[0] > 2.4) {
    if (nb === 1) lv.push(R('living', ux0, ux1, liveBand[0], liveBand[1]));
    else {
      // living = outer bay (wider), bedrooms in the others
      for (let i = 0; i < nb; i++) {
        const [a, c] = span(i);
        lv.push(R(i === 0 ? 'living' : 'bedroom', a, c, liveBand[0], liveBand[1], i === 1 ? 'master bedroom' : undefined));
      }
    }
  }
  // service band: kitchen behind the living room, bath near the core, bedroom(s) between
  const sv = [];
  if (servBand[1] - servBand[0] > 2.0) {
    // narrow flats (shallow end cores leave 3.2–4 m): the bath takes the whole band, or half of it
    // with the kitchen — never a strip without a room (a hole in the floor)
    const bathW = !behind && uw - 2.2 < 1.75 ? (uw < 3.5 ? uw : uw / 2) : 2.2;
    const coreEdge = outerLeft ? ux1 : ux0;
    const bathX0 = outerLeft ? coreEdge - bathW : coreEdge, bathX1 = bathX0 + bathW;
    const rest0 = outerLeft ? ux0 : bathX1, rest1 = outerLeft ? bathX0 : ux1;
    const restW = rest1 - rest0;
    if (!behind) sv.push(R('bath', bathX0, bathX1, servBand[0], servBand[1]));
    const r0 = behind ? (outerLeft ? ux0 : ux0) : rest0, r1 = behind ? (outerLeft ? ux1 : ux1) : rest1;
    const W2 = r1 - r0;
    if (W2 > 6.2) {
      const kw = clamp(W2 * 0.45, 2.6, 3.6);
      const kx0 = outerLeft ? r0 : r1 - kw;
      sv.push(R('kitchen', kx0, kx0 + kw, servBand[0], servBand[1]));
      sv.push(R('bedroom', outerLeft ? kx0 + kw : r0, outerLeft ? r1 : kx0, servBand[0], servBand[1], 'bedroom 2'));
    } else if (W2 >= 1.7) sv.push(R('kitchen', r0, r1, servBand[0], servBand[1]));
    void restW;
  }
  // doors: hall (or the living room on shallow plans) → every room
  const liv = lv.find((r) => r.kind === 'living'), kit = sv.find((r) => r.kind === 'kitchen');
  const hub = hall || liv || lv[0] || sv[0];
  if (!hall && hub) {
    // flat door from the landing into the room that touches the core side
    const coreTouch = [...lv, ...sv].find((r) => (outerLeft ? Math.abs(r.x1 - ux1) < 0.05 : Math.abs(r.x0 - ux0) < 0.05) && r.z0 < Math.max(zl0, zl1) && r.z1 > Math.min(zl0, zl1)) || hub;
    coreTouch.doors.push({ to: landing.id, width: 1.0, kind: 'apartment' });
    if (coreTouch !== hub) coreTouch.doors.push({ to: hub.id, width: 0.9 });
  }
  for (const r of [...lv, ...sv]) if (r !== hub && !r.doors.some((x) => x.to === hub.id)) r.doors.push({ to: hub.id, width: r.kind === 'bath' ? 0.8 : 0.9 });
  // living ↔ kitchen open plan when adjacent
  if (liv && kit && hub !== liv) liv.doors.push({ to: kit.id, width: 1.2 });
  if (behind && hub) { behind.unit = uid; behind.doors.push({ to: hub.id, width: 0.8 }); }
  if (extra && hub) {
    const [a, c, z0, z1] = extra;
    const st = R('bedroom', a, c, z0, z1, 'study');
    st.doors.push({ to: hub.id, width: 0.9 });
  }
  plan.units.push({ id: uid, floor: f.level, x0: ux0, x1: ux1 });
  // light ids: a room uses the bay of its first window (set in assemble), nothing to do here
  void ctx;
}

/** Ground-floor shop unit: sales floor on the street, storage behind with a back door. */
function shopUnit(ctx, plan, f, ux0, ux1, zF, zB, uid, landing) {
  const rooms = f.rooms;
  const d = zF - zB;
  const storeD = clamp(d * 0.3, 3.0, 5.0);
  const front = plan.serviceSide === 'back';
  const sz0 = front ? zB : zF - storeD, sz1 = front ? zB + storeD : zF;
  const shop = room('shop', ux0, ux1, front ? sz1 : zB, front ? zF : sz0, { floor: 0, unit: 'shop' + uid, name: 'shop' });
  const store = room('storage', ux0, ux1, sz0, sz1, { floor: 0, unit: 'shop' + uid, name: 'storage' });
  store.doors.push({ to: shop.id, width: 0.9 });
  rooms.push(shop, store);
  const w = plan.w;
  // shopfront on the street + back door from the storage
  const arr = front ? 'front' : 'back';
  const u0 = arr === 'front' ? ux0 + w / 2 : w / 2 - ux1, u1 = arr === 'front' ? ux1 + w / 2 : w / 2 - ux0;
  const dw = 1.6;
  const du = (u0 + u1) / 2 + ((u1 - u0) > 6 ? (u1 - u0) * 0.22 : 0) - dw / 2;
  plan.extraOpenings.push({ side: arr, u0: u0 + 0.35, u1: u1 - 0.35, v0: plan.ffl, v1: plan.ffl + Math.min(3.6, f.h - plan.slabT - 1.05), kind: 'shop', floor: 0, room: shop, roomU0: u0, roomU1: u1, depth: shop.z1 - shop.z0, door: { u0: du, width: dw } });
  plan.entrances.push({ kind: 'shop', side: arr, u0: du, u1: du + dw, v1: plan.ffl + 2.4, sign: Math.min(4, u1 - u0 - 1.5) });
  const svc = arr === 'front' ? 'back' : 'front';
  if (!plan.shared[svc]) {
    const bu0 = svc === 'back' ? w / 2 - ux1 + 0.8 : ux0 + w / 2 + 0.8;
    plan.extraOpenings.push({ side: svc, u0: bu0, u1: bu0 + 1.0, v0: plan.ffl, v1: plan.ffl + 2.1, kind: 'door', doorKind: 'service', floor: 0 });
    plan.extraOpenings.push({ side: svc, u0: bu0 + 1.6, u1: Math.min(bu0 + 3.0, svc === 'back' ? w / 2 - ux0 - 0.6 : ux1 + w / 2 - 0.6), v0: plan.ffl + 1.7, v1: plan.ffl + 2.5, kind: 'vent', floor: 0, room: store });
  }
  void landing; void ctx;
}

/** Legacy single-room floor (kept for callers of the old 'small' group; narrowPlan replaced it). */
function smallPlan(ctx, plan, f, zF, zB) {
  const w = plan.w;
  const rooms = f.rooms;
  const r = room(f.level === 0 ? 'living' : 'bedroom', -w / 2, w / 2, zB, zF, { floor: f.level, unit: 'u0' });
  rooms.push(r);
  void ctx;
}

/**
 * NARROW plot (w < 9.5 m, ≥ 5 storeys — fix round 3, QQ2-01): a point block with one flat per floor
 * (一梯一户). A switchback stair column (2.3–2.5 m) runs along one side wall — the party wall when there
 * is one — from the service wall towards the street, floor landings at its street end; the zone
 * beside it holds the flat (living room on the street, bath + bedroom / kitchen behind).
 *  - deep enough: a landing / lobby room in front of the stair column (street door there), the flat
 *    door opens off it; the ground floor has a studio (or a shop) + a bike store with the back door;
 *  - shallow (< 1.5 m left in front of the stair): the stair spans the whole inner depth (treads
 *    compress to fit, ≥ 0.25 m), the lobby moves into the zone beside it (street door + bike store),
 *    the flat door opens straight off the floor landing (stairRoom.landing).
 */
function narrowPlan(ctx, plan, o) {
  const s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const { w, d, floors } = plan, T = plan.wallT;
  const shops = o.ground === 'shops';
  const nF = floors.length;
  const gh = floors[0].h, fh = nF > 1 ? floors[1].h : gh;
  const ffl = plan.ffl;
  const SW = w < 6.6 ? 2.3 : 2.5;
  const stairLeft = s._shared.left ? true : s._shared.right ? false : (inst.seed & 1) === 0;
  const sx0 = stairLeft ? -w / 2 + T : w / 2 - T - SW, sx1 = sx0 + SW;
  const landD = 1.15, halfD = 1.05;
  const avail = d - 2 * T;
  const core = coreLayout({ cx: sx0 + SW / 2, zBack: -d / 2 + T, towards: 1, maxRise: Math.max(gh, fh), lift: false, W: SW, landD, halfD, landingDepth: 1.2 });
  core.stair.x0 = sx0; core.stair.x1 = sx1; core.x0 = sx0; core.x1 = sx1;
  const full = d / 2 - core.stair.z1 < 1.5;
  if (full) { core.stair.z1 = core.stair.z0 + avail; core.stair.Lz = avail; core.landing = { x0: sx0, x1: sx1, z0: core.stair.z1, z1: core.stair.z1 }; core.z1 = core.stair.z1; }
  core.liftSide = 1;
  plan.core = core; plan.cores = [core];
  const sz1 = core.stair.z1;
  const ax0 = stairLeft ? sx1 : -w / 2, ax1 = stairLeft ? w / 2 : sx0, aw = ax1 - ax0;
  const edgeX = stairLeft ? sx1 : sx0;                       // stair column ↔ zone partition
  // zone bands: living on the street, a back band (bath + bedroom / kitchen) when deep enough
  const backD = avail >= 5.6 ? clamp(avail * 0.42, 2.2, 4.0) + T : 0;
  const zMid = -d / 2 + backD;
  const lobbyD = full ? clamp(avail * 0.45, 2.2, 3.4) + T : 0;
  for (const f of floors) {
    const lv = f.level, rooms = f.rooms;
    const stairR = room('stair', sx0, sx1, -d / 2, full ? d / 2 : sz1, { floor: lv });
    stairR.landing = { x0: sx0, x1: sx1, z0: sz1 - landD - 0.1, z1: full ? d / 2 : sz1 };
    rooms.push(stairR);
    let land = null;
    if (!full) {
      land = room(lv === 0 ? 'lobby' : 'corridor', sx0, sx1, sz1, d / 2, { floor: lv, name: lv === 0 ? 'lobby' : 'landing' });
      rooms.push(land);
      stairR.doors.push({ to: land.id, width: 1.0 });
    }
    const uid = 'n' + lv;
    const R = (kind, x0, x1, z0, z1, name, unit = uid) => { const r = room(kind, x0, x1, z0, z1, { floor: lv, unit, name: name || kind }); rooms.push(r); return r; };
    const stairDoor = (r, wdt = 0.95, extra = {}) => r.doors.push({ to: stairR.id, width: wdt, pos: [edgeX, lv === 0 ? Math.max(r.z0 + 0.7, Math.min(r.z1 - 0.7, sz1 - landD / 2)) : sz1 - landD / 2], ...extra });
    if (lv === 0) {
      if (full) {
        // lobby beside the stair (street door) + bike store behind it (back door)
        const lob = R('lobby', ax0, ax1, d / 2 - lobbyD, d / 2, 'lobby', null);
        stairDoor(lob, 1.0);
        const bk = R('bike', ax0, ax1, -d / 2, d / 2 - lobbyD, 'bike store', null);
        bk.doors.push({ to: lob.id, width: 0.9 });
      } else if (shops) {
        const front = R('shop', ax0, ax1, Math.max(zMid, -d / 2 + 2.6), d / 2, 'shop', 'shop');
        if (front.z0 > -d / 2 + 1.2) { const store = R('storage', ax0, ax1, -d / 2, front.z0, 'storage', 'shop'); store.doors.push({ to: front.id, width: 0.9 }); }
      }
    }
    if (lv > 0 || (!full && !shops)) {
      // the flat (also on the ground floor beside the lobby): living on the street (flat door from the
      // landing / the floor landing), back band behind it
      const liv = R('living', ax0, ax1, backD ? zMid : -d / 2, d / 2);
      if (land) liv.doors.push({ to: land.id, width: 0.95, kind: 'apartment' });
      else stairDoor(liv, 0.95, { kind: 'apartment' });
      if (backD) {
        if (aw >= 4.4) {
          const bw = 2.0;
          const bx0 = stairLeft ? ax0 : ax1 - bw, bx1 = bx0 + bw;
          const bath = R('bath', bx0, bx1, -d / 2, zMid);
          const bed = R('bedroom', stairLeft ? bx1 : ax0, stairLeft ? ax1 : bx0, -d / 2, zMid);
          bath.doors.push({ to: liv.id, width: 0.8 }); bed.doors.push({ to: liv.id, width: 0.9 });
        } else if (aw >= 3.4) {
          const bw = clamp(aw * 0.5, 1.7, 2.0);
          const bx0 = stairLeft ? ax0 : ax1 - bw, bx1 = bx0 + bw;
          const bath = R('bath', bx0, bx1, -d / 2, zMid);
          const kit = R('kitchen', stairLeft ? bx1 : ax0, stairLeft ? ax1 : bx0, -d / 2, zMid);
          bath.doors.push({ to: liv.id, width: 0.75 }); kit.doors.push({ to: liv.id, width: 0.9 });
        } else {
          const bath = R('bath', ax0, ax1, -d / 2, zMid);
          bath.doors.push({ to: liv.id, width: 0.75 });
        }
      }
      plan.units.push({ id: uid, floor: lv, x0: ax0, x1: ax1 });
    }
    if (lv === nF - 1) for (const r of rooms) if (r.kind === 'bath') plan.shafts.push([(r.x0 + r.x1) / 2, r.z0 + 0.6]);
    const rng = ctx.sub(210, lv);
    const balconySides = {};
    if (st.balconyDepth[1] > 0.8) balconySides[plan.liveSide] = lv > 0;
    f.openings = deriveOpenings(rooms.filter((r) => r.kind !== 'lobby' && r.kind !== 'shop'), { w, d, y: f.y, h: f.h, rng, style: st, inst, floor: lv, slabT: plan.slabT, balconySides, blank: s._shared, bayW: plan.bayW, rect: { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 } });
  }
  // ---- entrances ----
  const lob = floors[0].rooms.find((r) => r.kind === 'lobby');
  const lu0 = lob.x0 + w / 2, lu1 = lob.x1 + w / 2;
  const dw = clamp(lu1 - lu0 - 0.8, 1.0, 1.6);
  const uC = (lu0 + lu1) / 2;
  plan.entrances.push({ kind: 'main', side: 'front', u0: uC - dw / 2, u1: uC + dw / 2, v1: ffl + 2.4, room: lob });
  plan.extraOpenings.push({ side: 'front', u0: uC - dw / 2, u1: uC + dw / 2, v0: ffl, v1: ffl + 2.4, kind: 'door', doorKind: dw >= 1.5 ? 'glazed_double' : 'glazed', floor: 0, room: lob, vestibule: st.coveredEntry });
  for (const [a, c] of [[lu0 + 0.3, uC - dw / 2 - 0.25], [uC + dw / 2 + 0.25, lu1 - 0.3]]) if (c - a > 0.5) plan.extraOpenings.push({ side: 'front', u0: a, u1: c, v0: ffl, v1: ffl + 2.75, kind: 'shop', floor: 0, room: lob, roomU0: lu0, roomU1: lu1, depth: lob.z1 - lob.z0 });
  plan.lobby = { cx: (lob.x0 + lob.x1) / 2, cz: (lob.z0 + lob.z1) / 2, nx: 0, nz: 1, depth: lob.z1 - lob.z0 };
  // shop front of the ground-floor shop (zone beside the stair column)
  const shop = floors[0].rooms.find((r) => r.kind === 'shop');
  if (shop) {
    const u0 = shop.x0 + w / 2, u1 = shop.x1 + w / 2, sdw = Math.min(1.5, u1 - u0 - 1.0);
    const sdu = (u0 + u1) / 2 - sdw / 2;
    plan.extraOpenings.push({ side: 'front', u0: u0 + 0.3, u1: u1 - 0.3, v0: ffl, v1: ffl + Math.min(3.3, gh - 0.9), kind: 'shop', floor: 0, room: shop, roomU0: u0, roomU1: u1, depth: shop.z1 - shop.z0, door: { u0: sdu, width: sdw } });
    plan.entrances.push({ kind: 'shop', side: 'front', u0: sdu, u1: sdu + sdw, v1: ffl + 2.4, sign: Math.min(3.6, u1 - u0 - 1.2) });
  }
  // back door from the bike store / shop storage (yard side)
  const bk = floors[0].rooms.find((r) => r.kind === 'bike' || r.kind === 'storage');
  if (bk && !s._shared.back && bk.z0 < -d / 2 + 0.05 && bk.x1 - bk.x0 > 1.6) {
    const ku0 = w / 2 - bk.x1, ku1 = w / 2 - bk.x0;
    const bu = stairLeft ? ku0 + 0.35 : ku1 - 0.35 - 0.95;
    plan.entrances.push({ kind: 'service', side: 'back', u0: bu, u1: bu + 0.95, v1: ffl + 2.1, room: bk });
    plan.extraOpenings.push({ side: 'back', u0: bu, u1: bu + 0.95, v0: ffl, v1: ffl + 2.1, kind: 'door', doorKind: 'service', floor: 0, room: bk });
    floors[0].openings = floors[0].openings.filter((op) => !(op.room === bk && op.side === 'back' && op.u1 > bu - 0.25 && op.u0 < bu + 1.2));
  }
  // stair windows at each half landing in the service wall
  if (!s._shared.back) {
    const u0 = w / 2 - sx1 + 0.45, u1 = w / 2 - sx0 - 0.45;
    for (let i = 0; i < floors.length - 1; i++) {
      const f = floors[i];
      const vh = f.y + f.h * 0.5 + 0.9;
      plan.extraOpenings.push({ side: 'back', u0, u1, v0: vh, v1: Math.min(vh + 1.0, floors[i + 1].y + floors[i + 1].h - 0.5), kind: 'casement', floor: i, room: f.rooms.find((r) => r.kind === 'stair') });
    }
  }
  plan.groups = [{ cx: sx0 + SW / 2, core, units: [] }];
  plan.narrow = { stairLeft, full };
}

// ---------------------------------------------------------------------------------------------
// HOUSES: terraced houses (联排, w 6–10.5 m), semi-detached / detached houses (≤ 16.5 m) and narrow
// shop-houses (ground: 'shops'). One dwelling per building: street door → hall (open to the stair) →
// living room on the street side, kitchen-dining on the garden side with the back door; bedrooms and
// bath upstairs. A switchback stair column runs along a party wall (or the middle of wide houses).
// ---------------------------------------------------------------------------------------------

/** True when the spec should be generated as a single house (or narrow shop-house). */
export function isHouse(spec, o = {}) {
  const w = spec._w, d = spec._d, n = spec._floors;
  if (n > 4 || w > 16.5 || d > 16) return false;
  if (o.ground === 'shops') return w < 10.5;
  return spec.tier === 'lowrise' || n <= 3 || w < 10.5;
}

export function housePlan(ctx, o = {}) {
  resetRoomIds();
  const s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const w = s._w, d = s._d, T = Math.min(st.wallT, 0.36);
  const nF = s._floors;
  const fh = s.floorHeight ? s._fh : st.storeyH;
  const shops = o.ground === 'shops';
  const gh = s._gh || o.gh || (shops ? 4.2 : 3.1);
  let ffl = o.ffl ?? (st.id === 'zr_cold' ? 0.55 : shops ? 0.15 : 0.45);
  ffl = Math.max(ffl, Math.max(s._ground.fl, s._ground.fr) + 0.12);
  const floors = [];
  let y = ffl;
  for (let i = 0; i < nF; i++) { const h = i === 0 ? gh : fh; floors.push({ level: i, y, h, rooms: [], openings: [], inset: {} }); y += h; }
  const R = roofSpec(s, st, inst);
  let roofKind = R.kind === 'other' ? 'flat' : R.kind;
  const plan = {
    w, d, ffl, wallT: T, slabT: 0.22, floors, house: true,
    roof: { y, parapet: roofKind === 'garden' ? 1.1 : 0.9, wallParapet: roofKind === 'pitched' ? 0 : roofKind === 'garden' && st.bandShape === 'curved' ? 0.32 : 0.9, kind: roofKind, surface: R.surface, pitchKey: R.pitchKey, tint: R.tint, solar: R.solar, skylights: R.skylights, ridgeAxis: s._shared.left || s._shared.right ? 'x' : null },
    shared: s._shared, entrances: [], extraOpenings: [], shafts: [], units: [], bayW: w / bayCount(w, 2.8, 4.4, 3.6),
  };
  const front = 'front';
  plan.serviceSide = s._shared.back ? 'front' : 'back';
  plan.liveSide = s._shared.back ? 'front' : (daylightScore(s, 'back') > daylightScore(s, 'front') + 0.35 ? 'back' : 'front');
  // ---- stair column: along a party wall (or the side away from the entrance offset) ------------
  const SW = 2.5;
  const maxRise = Math.max(gh, fh);
  const wide = w >= 11;
  const stairLeft = s._shared.left ? true : s._shared.right ? false : (inst.seed & 1) === 0;
  let sx0;
  if (!wide) sx0 = stairLeft ? -w / 2 + T : w / 2 - T - SW;
  else sx0 = stairLeft ? -w / 2 + T + clamp(w * 0.38, 3.6, 5.2) : w / 2 - T - clamp(w * 0.38, 3.6, 5.2) - SW;
  const core = coreLayout({ cx: sx0 + SW / 2, zBack: -d / 2 + T, towards: 1, maxRise, lift: false, W: SW, landD: 1.1, halfD: 1.05, landingDepth: 1.2 });
  core.stair.x0 = sx0; core.stair.x1 = sx0 + SW; core.x0 = sx0; core.x1 = sx0 + SW;
  plan.core = core; plan.cores = [core];
  const sz1 = core.stair.z1;                        // stair front end (floor landings at the front)
  // zones beside the stair column
  const zones = [];
  if (!wide) zones.push(stairLeft ? [sx0 + SW, w / 2] : [-w / 2, sx0]);
  else { zones.push([-w / 2, sx0]); zones.push([sx0 + SW, w / 2]); }
  // the larger zone holds living + kitchen
  zones.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const zA = zones[0], zB = zones[1] || null;
  const zMid = clamp(sz1 + (d / 2 - sz1) * 0.0, -d / 2 + 3.4, d / 2 - 3.4);   // front/back band split line
  for (const f of floors) {
    const rooms = f.rooms;
    const lv = f.level, top = lv === nF - 1;
    const stairR = room('stair', sx0, sx0 + SW, -d / 2, sz1, { floor: lv, unit: 'h' });
    stairR.landing = { x0: sx0, x1: sx0 + SW, z0: sz1 - (core.stair.landD ?? 1.1) - 0.1, z1: sz1 };   // floor landing (doors only here)
    rooms.push(stairR);
    // column in front of the stair: hall (ground) / landing + bath (upper)
    let hall;
    if (lv === 0) {
      hall = room('hall', sx0, sx0 + SW, sz1, d / 2, { floor: lv, unit: 'h', name: shops ? 'stair hall' : 'hall', extra: { noWindows: true } });
      rooms.push(hall); stairR.open.push(hall.id);
    } else {
      const lz1 = Math.min(d / 2, sz1 + 1.35);
      hall = room('corridor', sx0, sx0 + SW, sz1, lz1, { floor: lv, unit: 'h', name: 'landing', extra: { noWindows: true } });
      rooms.push(hall); stairR.open.push(hall.id);
      if (d / 2 - lz1 > 1.6) { const bath = room(zB ? 'storage' : 'bath', sx0, sx0 + SW, lz1, d / 2, { floor: lv, unit: 'h', name: zB ? 'linen' : 'bath' }); rooms.push(bath); bath.doors.push({ to: hall.id, width: 0.8 }); }
    }
    // zone A
    const [ax0, ax1] = zA;
    if (lv === 0) {
      if (shops) {
        const shop = room('shop', ax0, ax1, zMid - 1.0, d / 2, { floor: 0, unit: 'shop', name: 'shop' });
        const store = room('storage', ax0, ax1, -d / 2, zMid - 1.0, { floor: 0, unit: 'shop', name: 'storage' });
        store.doors.push({ to: shop.id, width: 0.9 }); rooms.push(shop, store);
      } else {
        const liv = room('living', ax0, ax1, zMid, d / 2, { floor: 0, unit: 'h' });
        const kit = room('kitchen', ax0, ax1, -d / 2, zMid, { floor: 0, unit: 'h', name: 'kitchen-dining' });
        liv.doors.push({ to: hall.id, width: 0.9 }); kit.doors.push({ to: liv.id, width: 1.4 });
        if (ax1 - ax0 > 4.2) kit.doors.push({ to: hall.id, width: 0.9 });
        rooms.push(liv, kit);
      }
    } else {
      const b1 = room('bedroom', ax0, ax1, zMid, d / 2, { floor: lv, unit: 'h', name: lv === 1 ? 'master bedroom' : 'bedroom' });
      const b2 = room('bedroom', ax0, ax1, -d / 2, zMid, { floor: lv, unit: 'h', name: 'bedroom' });
      // the back bedroom opens onto the floor landing at the front end of the stair column
      b1.doors.push({ to: hall.id, width: 0.9 }); b2.doors.push({ to: stairR.id, width: 0.9, pos: [ax0 >= sx0 + SW - 0.01 ? sx0 + SW : sx0, sz1 - 0.56] });
      rooms.push(b1, b2);
    }
    // zone B (wide houses)
    if (zB) {
      const [bx0, bx1] = zB;
      if (lv === 0) {
        const study = room(shops ? 'shop' : 'bedroom', bx0, bx1, zMid, d / 2, { floor: 0, unit: 'h', name: shops ? 'shop' : 'study' });
        // the wc reaches the study unless a utility room fits between them (a 0.4–1.4 m gap used to stay
        // a hole: the wc touched no room it could open onto — 19/20 shallow wide houses, QQ2-01)
        const wcZ1 = zMid - (-d / 2 + 2.6) > 1.4 ? -d / 2 + 2.6 : zMid;
        const wc = room('bath', bx0, bx1, -d / 2, wcZ1, { floor: 0, unit: 'h', name: 'wc' });
        rooms.push(study, wc);
        study.doors.push({ to: hall.id, width: 0.9 }); wc.doors.push({ to: study.id, width: 0.8 });
        if (zMid - (-d / 2 + 2.6) > 1.4) { const ut = room('storage', bx0, bx1, -d / 2 + 2.6, zMid, { floor: 0, unit: 'h', name: 'utility' }); ut.doors.push({ to: study.id, width: 0.8 }); rooms.push(ut); }
      } else {
        const bd = room('bedroom', bx0, bx1, zMid, d / 2, { floor: lv, unit: 'h' });
        const ba = room('bath', bx0, bx1, -d / 2, zMid, { floor: lv, unit: 'h' });
        bd.doors.push({ to: hall.id, width: 0.9 }); ba.doors.push({ to: stairR.id, width: 0.8, pos: [bx1 <= sx0 + 0.01 ? sx0 : sx0 + SW, sz1 - 0.5] });
        rooms.push(bd, ba);
      }
    }
    if (top) for (const r of rooms) if (r.kind === 'bath') plan.shafts.push([(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]);
    // openings from rooms (party walls blank)
    const rng = ctx.sub(230, lv);
    f.openings = deriveOpenings(rooms.filter((r) => r.kind !== 'shop'), { w, d, y: f.y, h: f.h, rng, style: st, inst, floor: lv, slabT: plan.slabT, balconySides: {}, blank: s._shared, bayW: plan.bayW, rect: { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 } });
  }
  // ---- entrances ------------------------------------------------------------------------------
  const hall0 = floors[0].rooms.find((r) => r.kind === 'hall');
  const hu0 = sx0 + w / 2, hu1 = sx0 + SW + w / 2;            // hall span on the front facade (u)
  const dw = 1.0;
  const du = clamp((hu0 + hu1) / 2 - dw / 2, hu0 + 0.35, hu1 - dw - 0.35);
  plan.entrances.push({ kind: 'main', side: front, u0: du, u1: du + dw, v1: ffl + 2.3, room: hall0, house: true });
  plan.extraOpenings.push({ side: front, u0: du, u1: du + dw, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'entry', floor: 0, room: hall0, house: true });
  // glazed side light / fanlight beside the door
  const slA = du + dw + 0.25, slB = hu1 - 0.3;
  if (slB - slA > 0.3) plan.extraOpenings.push({ side: front, u0: slA, u1: slB, v0: ffl + 0.5, v1: ffl + 2.3, kind: 'small', floor: 0, room: hall0, frosted: true });
  if (shops) {
    const shop = floors[0].rooms.find((r) => r.kind === 'shop');
    if (shop) {
      const u0 = shop.x0 + w / 2, u1 = shop.x1 + w / 2;
      const sdw = 1.5, sdu = (u0 + u1) / 2 - sdw / 2 + (stairLeft ? 0.4 : -0.4);
      plan.extraOpenings.push({ side: front, u0: u0 + 0.3, u1: u1 - 0.3, v0: ffl, v1: ffl + Math.min(3.3, gh - 0.9), kind: 'shop', floor: 0, room: shop, roomU0: u0, roomU1: u1, depth: shop.z1 - shop.z0, door: { u0: sdu, width: sdw } });
      plan.entrances.push({ kind: 'shop', side: front, u0: sdu, u1: sdu + sdw, v1: ffl + 2.4, sign: Math.min(3.6, u1 - u0 - 1.2) });
    }
  } else {
    plan.lobby = { cx: (hall0.x0 + hall0.x1) / 2, cz: (hall0.z0 + hall0.z1) / 2, nx: 0, nz: 1, depth: hall0.z1 - hall0.z0 };
  }
  // back door from the kitchen (or storage) to the yard / lane
  if (!s._shared.back) {
    const kit = floors[0].rooms.find((r) => r.kind === 'kitchen' || (shops && r.kind === 'storage'));
    if (kit) {
      const ku0 = w / 2 - kit.x1, ku1 = w / 2 - kit.x0;                      // back facade u of the room
      const bu = stairLeft ? ku0 + 0.45 : ku1 - 0.45 - 1.0;
      plan.entrances.push({ kind: shops ? 'service' : 'back', side: 'back', u0: bu, u1: bu + 1.0, v1: ffl + 2.2, room: kit });
      plan.extraOpenings.push({ side: 'back', u0: bu, u1: bu + 1.0, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: shops ? 'service' : 'glazed', floor: 0, room: kit });
      // the kitchen window moves away from the door
      for (const op of floors[0].openings) if (op.room === kit && op.side === 'back' && op.u1 > bu - 0.3 && op.u0 < bu + 1.3) { const wdt = op.u1 - op.u0; if (stairLeft) { op.u0 = Math.min(ku1 - 0.45 - wdt, bu + 1.45); op.u1 = op.u0 + wdt; } else { op.u1 = Math.max(ku0 + 0.45 + wdt, bu - 0.45); op.u0 = op.u1 - wdt; } if (op.u0 < ku0 + 0.3 || op.u1 > ku1 - 0.3) op.dropped = true; }
      floors[0].openings = floors[0].openings.filter((op) => !op.dropped);
    }
  }
  // stair window at each half landing on the back facade (stair against the back wall)
  if (!s._shared.back) {
    const st0 = core.stair;
    const u0 = w / 2 - st0.x1 + 0.45, u1 = w / 2 - st0.x0 - 0.45;
    for (let i = 0; i < floors.length - 1; i++) {
      const f = floors[i];
      const vh = f.y + f.h * 0.5 + 0.9;
      plan.extraOpenings.push({ side: 'back', u0, u1, v0: vh, v1: Math.min(vh + 1.0, floors[i + 1].y + floors[i + 1].h - 0.5), kind: 'casement', floor: i, room: f.rooms.find((r) => r.kind === 'stair') });
    }
  }
  plan.units.push({ id: 'h', floor: 0, x0: -w / 2, x1: w / 2 });
  plan.groups = [{ cx: sx0 + SW / 2, core, units: [] }];
  return plan;
}
