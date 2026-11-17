// Assembler: turns a PlanModel (plan.js) into geometry. Types call the passes they need:
//   emitFacades(ctx, plan)        walls with real openings + window/door/shop units per room
//   emitBands(ctx, plan, bandFn)  slab bands / balconies / railings / planters per level
//   emitRoof(ctx, plan, opts)     parapets, membrane falls, core exit, equipment, garden
//   emitBase(ctx, plan, opts)     plinth, retaining steps, entrances (steps, ramps, canopies)
//   emitAnchors(ctx, plan)        anchors (floors, entrances, roof, rooms, cameras)
// and interior/index.js emitInterior(ctx, plan) for 'full'.
// Everything is deterministic from ctx.spec.hash.

import { wallWithOpenings, facadeFrame, perimeterU, facadePoint, facadeNormal } from './walls.js';
import { windowUnit, shopfront, louvrePanel, ROOM_KIND } from './windows.js';
import { doorUnit, vestibule } from './doors.js';
import { steps, rampAlong, handrail, risers } from './stairs.js';
import { stairFrame, stairPoint } from './cores.js';
import { canopyFlat, canopyCurved, porch, arcade } from './structure.js';
import { downpipe, scupper } from './drainage.js';
import { parapets, roofDeck, hvacUnit, ventMushroom, ventStack, roofHatch, stairHouse, liftOverrun, waterTank, antennaMast, solarArray, skylight, roofGarden, plantRoom, pitchedRoof } from './roof.js';
import { plinth, retainingSteps, sideGround, groundAlong } from './plinth.js';
import { bandPaths, curvedBand, railing, bandPlanter, railLine } from './balconies.js';
import { wallLight, plaque, signPanel, storeyLine, acScreen } from './facade.js';
import { binStore, bikeRacks, pavingPad, bollard } from './site.js';
import { planterBox } from './vegetation.js';
import { SIDES, planToU, uToPlan, kindCode } from './plan.js';
import { cumLength, pointAt } from './math.js';
import { hash4 } from '../../core/hash.js';
import { daylightScore } from './spec.js';

const isFB = (s) => s === 'front' || s === 'back';

/** Floor groups with identical facade inset on side (for setbacks). */
function groups(plan, side) {
  const out = [];
  for (let i = 0; i < plan.floors.length; i++) {
    const f = plan.floors[i];
    const ins = insetOf(f, side);
    const g = out[out.length - 1];
    if (g && Math.abs(g.inset - ins) < 1e-3 && sameSpan(plan.floors[g.i0], f)) g.i1 = i;
    else out.push({ i0: i, i1: i, inset: ins });
  }
  return out;
}
const insetOf = (f, side) => (f.inset && f.inset[side]) || 0;
const sameSpan = (a, b) => insetOf(a, 'front') === insetOf(b, 'front') && insetOf(a, 'back') === insetOf(b, 'back') && insetOf(a, 'left') === insetOf(b, 'left') && insetOf(a, 'right') === insetOf(b, 'right');

/** Facade u-range [u0,u1] occupied by the floor rect on a side. */
function sideSpan(plan, f, side) {
  const w = plan.w, d = plan.d;
  const iF = insetOf(f, 'front'), iB = insetOf(f, 'back'), iL = insetOf(f, 'left'), iR = insetOf(f, 'right');
  switch (side) {
    case 'front': return [iL, w - iR];
    case 'back': return [iR, w - iL];
    case 'right': return [iF, d - iB];
    default: return [iB, d - iF];
  }
}

/** Wall material keys for a style + instance. */
export function wallKeys(ctx) {
  const st = ctx.style, inst = ctx.inst;
  return {
    wall: st.wall, band: st.band, accent: st.wallAccent, soffit: st.soffit,
    frame: inst.frameDark ? 'aluminium_dark' : st.frame,
    glass: ctx.full ? 'glass_clear' : (st.glass || 'glass_window'),   // zr_glass: blue-grey glass_curtain
    shopGlass: ctx.full ? 'glass_clear' : 'glass_shop',
    sill: st.id === 'zr_cold' || st.id === 'zr_highland' ? 'stone_sill' : 'aluminium',
  };
}

// ---------------------------------------------------------------------------
// FACADES
// ---------------------------------------------------------------------------
/**
 * Walls + openings + units for every side. opts: {extraOpenings:[Opening], partyKey}
 * Openings come from plan.floors[i].openings and plan.extraOpenings (entrances, cores).
 */
export function emitFacades(ctx, plan, opts = {}) {
  const b = ctx.b, s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const K = wallKeys(ctx);
  const T = plan.wallT;
  const all = [];
  for (const f of plan.floors) for (const o of f.openings) all.push(o);
  for (const o of plan.extraOpenings || []) all.push(o);
  plan.allOpenings = all;
  const rngW = ctx.sub(301);
  for (const side of SIDES) {
    const shared = plan.shared[side];
    for (const g of groups(plan, side)) {
      const f0 = plan.floors[g.i0], f1 = plan.floors[g.i1];
      const top = g.i1 === plan.floors.length - 1;
      const y0 = g.i0 === 0 ? plan.ffl : f0.y - 0.0;
      let y1, innerY1;
      if (top) {
        y1 = plan.roof.y + (plan.roof.wallParapet ?? plan.roof.parapet);
        // interior plaster ('full') stops at the roof slab: above it the parapet has its own inner
        // face (kit/roof.js parapets) — a plaster face up to the coping was coplanar with it and
        // z-fought (QQ-02)
        innerY1 = plan.roof.y;
      } else {
        const nf = plan.floors[g.i1 + 1];
        // lower group continues as terrace upstand where the next group is set back
        const setback = insetOf(nf, side) > g.inset + 0.05;
        y1 = nf.y + (setback ? (plan.terraceUp ?? 0.3) : 0);
        innerY1 = setback ? nf.y : y1;
      }
      const [ua, ub] = sideSpan(plan, f0, side);
      const fb = isFB(side);
      // side walls fit between front/back walls of the same floor group
      let uS = ua, uE = ub;
      if (!fb) { uS += T; uE -= T; }
      b.push();
      facadeFrame(b, side, plan.w, plan.d, g.inset);
      const ops = [];
      if (!shared) {
        for (const o of all) {
          if (o.side !== side) continue;
          if (o.v0 < y0 - 0.01 || o.v1 > y1 + 0.01) continue;
          if (o.u0 < uS + 0.05 || o.u1 > uE - 0.05) continue;
          // buried openings (terrain above the sill) are dropped, except entrance doors at grade
          const gr = groundAlong(s, side, o.u0, o.u1);
          if (o.kind !== 'door' && o.kind !== 'shop' && gr > o.v0 - 0.15) continue;
          if ((o.kind === 'door' || o.kind === 'shop') && gr > o.v0 + 0.2) continue;
          ops.push(o);
        }
      }
      const R = st.reveal;
      const wallOps = ops.map((o) => ({ u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, reveal: o.kind === 'shop' ? Math.min(0.14, R) : o.kind === 'door' ? Math.min(R, 0.22) : R, chamfer: o.kind === 'shop' ? 0.015 : 0.02, noSillReveal: o.kind === 'door' || o.kind === 'slider' || o.kind === 'shop' }));
      b.pushTint(inst.shellTint);
      wallWithOpenings(b, {
        L: uE - uS, u0: uS, y0, y1, T, openings: wallOps,
        outer: shared ? (opts.partyKey || K.wall) : K.wall,
        inner: ctx.full ? 'plaster' : null, innerReveals: ctx.full, innerY0: y0, innerY1,
        capStart: fb, capEnd: fb, chamferStart: fb && !plan.shared[side === 'front' ? 'left' : 'right'] ? 0.035 : 0, chamferEnd: fb && !plan.shared[side === 'front' ? 'right' : 'left'] ? 0.035 : 0,
      });
      b.popTint();
      // units
      for (const o of ops) emitUnit(ctx, plan, o, side, K, rngW);
      // storey lines where no bands
      if (!shared && (opts.storeyLines ?? (st.bandShape === 'none'))) {
        for (let i = Math.max(1, g.i0); i <= g.i1; i++) {
          const y = plan.floors[i].y - 0.05;
          const gaps = ops.filter((o) => o.v0 < y + 0.1 && o.v1 > y - 0.1).map((o) => [o.u0 - 0.05, o.u1 + 0.05]);
          b.withTint(inst.bandTint, () => storeyLine(b, uS - (fb ? 0 : 0), uE, y, gaps, { key: K.band }));
        }
      }
      b.pop();
    }
  }
}

/** Interior-mapping room descriptor for an opening. */
function roomInfo(ctx, plan, o, side) {
  const s = ctx.spec;
  const f = plan.floors[o.floor ?? 0] || plan.floors[0];
  const r = o.room;
  const ceil = f.y + f.h - plan.slabT;
  const roomU0 = (o.roomU0 ?? o.u0 - 0.6) + (r ? 0.05 : 0);
  const roomW = Math.max(0.8, (o.roomU1 ?? o.u1 + 0.6) - (o.roomU0 ?? o.u0 - 0.6) - 0.1);
  const depth = Math.max(1.2, (o.depth ?? 5) - plan.wallT - 0.05);
  const uc = (o.u0 + o.u1) / 2;
  const bay = Math.floor((perimeterU(side, plan.w, plan.d) + (r && r.lightU != null ? r.lightU : uc)) / plan.bayW);
  return {
    u0: o.u0 - roomU0, w: roomW, d: depth, h: ceil - f.y, sill: o.v0 - f.y,
    kind: r ? kindCode(r.kind) : o.kind === 'shop' ? ROOM_KIND.shop : ROOM_KIND.office,
    seed: (hash4(s.hash, o.floor ?? 0, Math.round(uc * 10), SIDES.indexOf(side)) & 1023) / 1023,
    floor: o.floor ?? 0, bay: r && r.lightBay != null ? r.lightBay : bay, hash: s.hash, profile: s._profile | 0,
  };
}

function emitUnit(ctx, plan, o, side, K, rng) {
  const b = ctx.b, st = ctx.style, inst = ctx.inst;
  const R = st.reveal;
  const room = roomInfo(ctx, plan, o, side);
  if (o.kind === 'strip') {
    // a vertical strip spans several storeys: map it onto one tall stair-well volume
    room.sill = 0.6; room.h = o.v1 - o.v0 + 1.2; room.kind = ROOM_KIND.stair;
    room.d = plan.core ? Math.max(3, plan.core.stair.Lz) : 5; room.u0 = 0.15; room.w = o.u1 - o.u0 + 0.3;
  }
  o.light = room; // remember for interior light panels
  const common = { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R, frameKey: K.frame, glassKey: K.glass, sillKey: K.sill, room, inner: ctx.full, T: plan.wallT };
  switch (o.kind) {
    // 'full': the wall colliders leave door / slider / shop-door openings walkable, so those units
    // render open (leaves swung in, last slider panel slid aside) — nobody walks through closed glass
    case 'slider': windowUnit(b, { ...common, type: 'slider', sillKey: null, open: ctx.full ? 0.92 : 0 }); break;
    case 'tall': windowUnit(b, { ...common, type: 'tall', juliet: !!o.juliet && !o.balcony, sillKey: o.balcony ? null : K.sill, blind: inst.windowFamily === 2, blindDrop: inst.blinds ? rng.next() * 0.6 : 0 }); break;
    case 'small': windowUnit(b, { ...common, type: 'small', glassKey: o.frosted ? 'glass_frosted' : K.glass }); break;
    case 'strip': windowUnit(b, { ...common, type: 'strip', transoms: o.transoms, sillKey: null, cols: o.cols ?? 1 }); break;
    case 'vent': louvrePanel(b, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R: Math.min(0.12, R), key: K.frame }); break;
    case 'shop': {
      const door = o.door ? shopfront(b, { ...common, R: Math.min(0.14, R), glassKey: K.shopGlass, frameKey: 'aluminium_dark', doorWidth: o.door.width, doorAt: o.door.u0 }) : shopfront(b, { ...common, R: Math.min(0.14, R), glassKey: K.shopGlass, frameKey: 'aluminium_dark' });
      if (door) doorUnit(b, { u0: door[0], u1: door[1], v0: o.v0, v1: Math.min(o.v1 - 0.6, o.v0 + 2.4), R: Math.min(0.14, R) + 0.02, kind: door[1] - door[0] > 1.5 ? 'glazed_double' : 'glazed', glassKey: K.shopGlass, room, open: ctx.full ? 0.72 : 0 });
      break;
    }
    case 'door': {
      const kind = o.doorKind || 'glazed_double';
      doorUnit(b, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R: Math.min(R, 0.22), kind, glassKey: K.shopGlass, room: { ...room, kind: o.roomKind ?? ROOM_KIND.lobby }, open: o.open ?? (ctx.full ? (kind === 'service' ? 0.8 : 0.72) : 0) });
      if (o.vestibule && ctx.full) vestibule(b, { u0: o.u0 - 0.3, u1: o.u1 + 0.3, v0: o.v0, R: plan.wallT, depth: 1.8, open: 0.72 });
      // transom light over glazed entrance doors
      break;
    }
    default: {
      const tr = inst.windowFamily === 1 && o.v1 - o.v0 > 1.4 ? [o.v1 - o.v0 - 0.45] : undefined;
      windowUnit(b, { ...common, type: 'casement', transoms: tr, blind: inst.windowFamily === 2 && o.room && (o.room.kind === 'bedroom' || o.room.kind === 'living'), blindDrop: inst.blinds ? rng.next() * 0.7 : 0, louvres: inst.louvres && (o.room?.kind === 'bedroom') && rng.next() < 0.5 });
    }
  }
}

// ---------------------------------------------------------------------------
// BANDS / BALCONIES
// ---------------------------------------------------------------------------
/**
 * Slab-edge bands for each level ≥ 1 (and roof level). bandFn(level, side, rect) returns a
 * projection (number or (t)=>number) or 0. Level L band sits at floors[L].y (roof: roof.y) on
 * the rect of floor L−1. opts: {railFn(level, side, depth) → 'glass'|'bars'|null, planters, flat}
 */
export function emitBands(ctx, plan, bandFn, opts = {}) {
  const b = ctx.b, st = ctx.style, inst = ctx.inst, s = ctx.spec;
  const K = wallKeys(ctx);
  const rng = ctx.sub(401);
  const levels = plan.floors.length;
  plan.bandInfo = [];
  for (let L = 1; L <= levels; L++) {
    // no roof band under a pitched roof or behind a full-height solid parapet (it would read as a stray ledge)
    if (L === levels && (plan.roof.kind === 'pitched' || (plan.roof.wallParapet ?? plan.roof.parapet) > 0.5)) continue;
    const below = plan.floors[L - 1];
    const y = L < levels ? plan.floors[L].y : plan.roof.y;
    const rect = L < levels ? outerRect(plan, below, plan.floors[L]) : rectOf(plan, below);
    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
    const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
    const off = {};
    for (const side of SIDES) off[side] = plan.shared[side] ? 0 : bandFn(L, side, rect);
    if (!SIDES.some((sd) => { const v = off[sd]; return typeof v === 'function' || v > 0; })) continue;
    const paths = bandPaths(w, d, off, plan.shared, { cornerR: opts.cornerR ?? 1.6 });
    b.push(); b.translate(cx, 0, cz);
    for (const p of paths) {
      b.pushTint(inst.bandTint);
      curvedBand(b, p, y, { w, d, key: K.band, flat: st.bandShape === 'flat', deckKey: st.deck, soffitKey: K.soffit, up: opts.up ?? (st.bandShape === 'flat' ? 0.15 : 0.3), lights: opts.lights !== false });
      b.popTint();
      // railing only along the stretches deep enough to stand on (whole loop at roof level)
      const depthAt = maxDepth(p, w, d);
      const roofLevel = L === levels;
      const railKind = opts.railFn ? opts.railFn(L, depthAt) : (depthAt > 0.85 || roofLevel ? inst.railing : null);
      if (railKind) {
        const line = railLine(p, 0.13);
        const rOpts = { kind: railKind === 'glass' ? 'glass' : 'bars', key: railKind === 'glass' ? 'aluminium' : st.railKey, startH: (opts.up ?? 0.3) + 0.0 };
        if (roofLevel) railing(b, line, y - 0.03, { ...rOpts, closed: p.closed });
        else for (const run of deepRuns(p.pts, line, p.closed, w, d, 0.8)) railing(b, run, y - 0.03, { ...rOpts, closed: run.closed });
      }
      // planters only along stretches that are deep enough to be a real balcony
      if (!roofLevel && depthAt > 1.0 && inst.planterDensity > 0) {
        const cum = cumLength(p.pts), Lp = cum[cum.length - 1];
        const n = Math.floor(Lp / 5);
        for (let i = 0; i < n; i++) {
          if (rng.next() > Math.min(0.85, inst.planterDensity * 1.1)) continue;
          const s0 = (Lp * i) / n + 0.5, s1 = s0 + 1.8 + rng.next() * 1.6;
          if (s1 >= Lp - 0.5) continue;
          let ok = true;
          for (let k = 0; k <= 4 && ok; k++) { const q = pointAt(p.pts, cum, s0 + ((s1 - s0) * k) / 4); if (localDepth(q, w, d) < 1.05) ok = false; }
          if (ok) bandPlanter(b, p, s0, s1, y, (s.hash + L * 97 + i * 13) >>> 0);
        }
      }
      plan.bandInfo.push({ level: L, y, path: p, rect, depth: depthAt });
    }
    b.pop();
  }
}
/**
 * Runs of a railing line where the band below is at least `minD` deep (corner fillets between two
 * deep sides count as deep). Returns open polylines (or the whole closed loop when all is deep).
 */
function deepRuns(pts, line, closed, w, d, minD) {
  const n = pts.length;
  const deep = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const ld = localDepth(pts[i], w, d); deep[i] = ld < 0 || ld >= minD ? 1 : 0; }
  // corner points (−1) are deep only when a deep neighbour exists on both sides of the corner run
  for (let i = 0; i < n; i++) {
    if (localDepth(pts[i], w, d) >= 0) continue;
    let a = i, c = i;
    for (let k = 0; k < n && localDepth(pts[(a - 1 + n) % n], w, d) < 0; k++) a = (a - 1 + n) % n;
    for (let k = 0; k < n && localDepth(pts[(c + 1) % n], w, d) < 0; k++) c = (c + 1) % n;
    const pa = (a - 1 + n) % n, pc = (c + 1) % n;
    deep[i] = (closed || (i > 0 && i < n - 1)) && localDepth(pts[pa], w, d) >= minD && localDepth(pts[pc], w, d) >= minD ? 1 : 0;
  }
  if (deep.every((v) => v)) { const r = line.slice(); r.closed = closed; return [r]; }
  const runs = [];
  let start = closed ? deep.indexOf(0) : 0;
  if (start < 0) start = 0;
  let cur = null;
  const m = closed ? n + 1 : n;
  for (let k = 0; k < m; k++) {
    const i = (start + k) % n;
    if (deep[i]) { if (!cur) cur = []; cur.push(i); }
    else if (cur) { if (cur.length >= 2) runs.push(cur); cur = null; }
  }
  if (cur && cur.length >= 2) runs.push(cur);
  // a run ending at a crisp step (rectangular balcony: the next sample is < 0.2 m further along the
  // wall) also guards the balcony's side return down to the shallow band
  const along = (a, c) => {
    const qa = pts[a], qc = pts[c];
    const frontBack = Math.abs(qa[1]) - d / 2 > Math.abs(qa[0]) - w / 2;
    return frontBack ? Math.abs(qa[0] - qc[0]) : Math.abs(qa[1] - qc[1]);
  };
  const stepTo = (a, c) => c >= 0 && c < n && !deep[c] && localDepth(pts[c], w, d) >= 0 && along(a, c) < 0.2;
  return runs.map((r) => {
    const a = r[0], z = r[r.length - 1];
    const pa = closed ? (a - 1 + n) % n : a - 1, pz = closed ? (z + 1) % n : z + 1;
    const idx = [...(stepTo(a, pa) ? [pa] : []), ...r, ...(stepTo(z, pz) ? [pz] : [])];
    return idx.map((i) => line[i]);
  });
}
/** Perpendicular distance of a band point from the wall it runs along (corner zones: −1). */
function localDepth(q, w, d) {
  const dx = Math.abs(q[0]) - w / 2, dz = Math.abs(q[1]) - d / 2;
  if (dx > 0 && dz > 0) return -1;
  return Math.max(dx, dz);
}
function maxDepth(p, w, d) {
  let m = 0;
  for (const q of p.pts) { const dx = Math.abs(q[0]) - w / 2, dz = Math.abs(q[1]) - d / 2; m = Math.max(m, Math.min(Math.max(dx, dz), 4)); }
  return m;
}
/** Union of two floor rects (the slab edge of an upper floor overhanging an arcade / recess). */
export function outerRect(plan, a, c) {
  const w = plan.w, d = plan.d;
  const i = (sd) => Math.min(insetOf(a, sd), insetOf(c, sd));
  return { x0: -w / 2 + i('left'), x1: w / 2 - i('right'), z0: -d / 2 + i('back'), z1: d / 2 - i('front') };
}
export function rectOf(plan, f) {
  const w = plan.w, d = plan.d;
  return { x0: -w / 2 + insetOf(f, 'left'), x1: w / 2 - insetOf(f, 'right'), z0: -d / 2 + insetOf(f, 'back'), z1: d / 2 - insetOf(f, 'front') };
}

// ---------------------------------------------------------------------------
// ROOF
// ---------------------------------------------------------------------------
/**
 * opts: {garden:boolean, solar:boolean, parapetKind:'solid'|'rail', vents:[[x,z]...], plant:boolean}
 */
export function emitRoof(ctx, plan, opts = {}) {
  const b = ctx.b, s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const K = wallKeys(ctx);
  const top = plan.floors[plan.floors.length - 1];
  const rect = rectOf(plan, top);
  const T = plan.wallT, ry = plan.roof.y;
  const rng = ctx.sub(501);
  const sides = {};
  for (const sd of SIDES) sides[sd] = plan.shared[sd] ? 'firewall' : 'parapet';
  if (plan.roof.kind === 'pitched') {
    // standing-seam metal roof; equipment moves to the ground / leeward side. No stair house: the
    // stair ends at the top floor (emitInterior reads plan.roof.stairHouse)
    plan.roof.stairHouse = false;
    b.pushTint(inst.shellTint);
    const axis = plan.roof.ridgeAxis || ((rect.x1 - rect.x0) >= (rect.z1 - rect.z0) ? 'x' : 'z');
    // gable ends: local −x / +x of the ridge frame = building left / right (ridge along x) or front / back
    const pA = axis === 'x' ? !!plan.shared.left : false, pB = axis === 'x' ? !!plan.shared.right : !!plan.shared.back;
    const sunSide = axis === 'x' ? (s._lat >= 0 ? (daylightScore(s, 'front') >= daylightScore(s, 'back') ? 1 : -1) : 1) : 1;
    const ridge = pitchedRoof(b, { x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: rect.z1 }, ry, { gableKey: K.wall, key: plan.roof.pitchKey || 'roof_metal', roofTint: plan.roof.tint, pitch: st.id === 'zr_cold' ? 0.62 : 0.5, seed: s.hash, ridgeAxis: axis, partyA: pA, partyB: pB, vergeA: pA ? 0 : 0.3, vergeB: pB ? 0 : 0.3, copingKey: st.coping, sunSide });
    b.popTint();
    plan.roof.access = [0, ry, 0];
    plan.roof.ridge = ridge;
    // vents through the roof slope above wet shafts
    for (const v of plan.shafts || []) ventStack(b, v[0], ry + 0.2, v[1], 0.07, Math.max(0.8, (ridge - ry) * 0.7));
    // downpipes at the corners of the eaves
    for (const side of ['front', 'back']) {
      if (plan.shared[side]) continue;
      const L = plan.w;
      for (const u of [0.35, L - 0.35]) { b.push(); facadeFrame(b, side, plan.w, plan.d, 0); downpipe(b, u, ry - 0.1, Math.max(sideGroundAt(s, side, u, plan), plan.ffl - 0.3), { head: false }); b.pop(); }
    }
    return { yr: ry, inner: rect, keep: [] };
  }
  const ph = plan.roof.wallParapet ?? plan.roof.parapet;
  if (ph > 0.05) parapets(b, rect, ry, ph, T, { sides, innerKey: K.soffit, copingKey: st.coping, outerKey: K.wall });
  const inner = { x0: rect.x0 + T, x1: rect.x1 - T, z0: rect.z0 + T, z1: rect.z1 - T };
  // stair wells under the stair houses stay open in the deck (walkable roof exits)
  const coresR = plan.cores && plan.cores.length ? plan.cores : plan.core ? [plan.core] : [];
  const holes = (plan.floors.length >= 4 || opts.stairHouse) ? coresR.filter((c) => c.stair).map((c) => ({ x0: c.stair.x0 + 0.2, x1: c.stair.x1 - 0.2, z0: c.stair.z0 + 0.2, z1: c.stair.z1 - 0.2 })) : [];
  const deckO = { key: plan.roof.surface || st.roofSurface, mode: 'ridge', holes };
  const yr = plan.roof.tint ? (b.pushTint(plan.roof.tint), roofDeck(b, inner, ry, deckO)) : roofDeck(b, inner, ry, deckO);
  if (plan.roof.tint) b.popTint();
  // core exit
  const keep = (opts.keepOut || []).slice();   // extra keep-out rects (e.g. a tower standing on a podium)
  // every core of the plan (wide blocks: one stair + lift per 一梯两户 group) exits on the roof;
  // the first core gives plan.roof.access
  const cores = plan.cores && plan.cores.length ? plan.cores : plan.core ? [plan.core] : [];
  cores.forEach((core, ci) => {
    const st0 = core.stair;
    if (!st0) return;
    const access = plan.floors.length >= 4 || opts.stairHouse;
    plan.roof.stairHouse = !!access;       // emitInterior: the last flight climbs into the stair house
    let acc;
    if (access) {
      const r = { x0: st0.x0 - 0.05, x1: st0.x1 + 0.05, z0: st0.z0 - 0.05, z1: st0.z1 + 0.05 };
      // the door opens off the roof-level floor landing (the end of the stair where the last flight
      // arrives, interior/index.js): on that end wall when the deck has room in front of it, else in
      // a side wall beside the landing (a door at the half-landing end had no floor behind it)
      const D = roofDoorOf(core, r, inner);
      stairHouse(b, r, ry, 2.9, { key: K.wall, capKey: K.band, door: D.side, doorU: D.u });
      keep.push({ x0: r.x0 - 1.2, x1: r.x1 + 1.2, z0: r.z0 - 1.2, z1: r.z1 + 1.6 });
      acc = D.at(ry);
    } else {
      const hx = (st0.x0 + st0.x1) / 2, hz = st0.z0 + 0.8;
      roofHatch(b, hx, ry, hz, { ladderDepth: ctx.full ? (plan.floors[plan.floors.length - 1].h - plan.slabT) : 0 });
      keep.push({ x0: hx - 1.3, x1: hx + 1.3, z0: hz - 1.4, z1: hz + 1.4 });
      acc = [hx, ry + 0.4, hz + 0.9];
    }
    if (ci === 0) plan.roof.access = acc;
    if (core.lift) {
      const l = core.lift;
      liftOverrun(b, { x0: l.x0, x1: l.x1, z0: l.z0, z1: l.z1 }, ry, access ? 3.6 : 1.6, { key: K.wall, capKey: K.band });
      keep.push({ x0: l.x0 - 0.8, x1: l.x1 + 0.8, z0: l.z0 - 0.8, z1: l.z1 + 0.8 });
    }
  });
  if (!cores.length || !plan.roof.access) plan.roof.access = [0, ry, 0];
  // vents above wet-room shafts
  for (const v of plan.shafts || []) {
    if (v[0] < inner.x0 + 0.4 || v[0] > inner.x1 - 0.4 || v[1] < inner.z0 + 0.4 || v[1] > inner.z1 - 0.4) continue;
    if (rng.next() < 0.5) ventMushroom(b, v[0], yr - 0.02, v[1], 0.14, 0.7); else ventStack(b, v[0], yr - 0.02, v[1], 0.08, 0.9);
    keep.push({ x0: v[0] - 0.5, x1: v[0] + 0.5, z0: v[1] - 0.5, z1: v[1] + 0.5 });
  }
  // HVAC condensers along the back (leeward / service side)
  const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
  const nH = Math.max(1, Math.min(6, Math.round((W * D) / 120)));
  const garden = opts.garden ?? inst.roofGarden;
  const hvacZ = inner.z0 + 1.0;
  let placed = 0;
  for (let i = 0; i < nH * 2 && placed < nH; i++) {
    const x = inner.x0 + 1.6 + rng.next() * Math.max(0.1, W - 3.2);
    const cand = { x0: x - 1.4, x1: x + 1.4, z0: hvacZ - 0.8, z1: hvacZ + 0.9 };
    if (keep.some((k) => overlap(k, cand))) continue;
    hvacUnit(b, x, yr, hvacZ + 0.05, 0, { w: 2.0, d: 1.0, h: 1.1 });
    keep.push(cand); placed++;
  }
  if (rng.next() < (st.id === 'o_utility' ? 0.8 : 0.25)) {
    const x = inner.x1 - 1.4, z = inner.z0 + 1.4;
    const c = { x0: x - 1.1, x1: x + 1.1, z0: z - 1.1, z1: z + 1.1 };
    if (!keep.some((k) => overlap(k, c))) { waterTank(b, x, yr, z, 0.8, 1.7); keep.push(c); }
  }
  if (rng.next() < 0.35 && W > 8) {
    const x = inner.x0 + 1.0, z = inner.z0 + 1.0;
    const c = { x0: x - 1.4, x1: x + 1.4, z0: z - 1.4, z1: z + 1.4 };
    if (!keep.some((k) => overlap(k, c))) { antennaMast(b, x, yr, z, 3.5 + rng.next() * 2.5, s.hash); keep.push(c); }
  }
  if (garden && W > 5 && D > 5) {
    roofGarden(b, { x0: inner.x0 + 0.3, x1: inner.x1 - 0.3, z0: inner.z0 + 0.3, z1: inner.z1 - 0.3 }, yr, s.hash, { keepOut: keep, deckKey: st.deck });
  } else if (plan.roof.skylights && W > 6) {
    const n = Math.max(1, Math.round(W / 7));
    for (let i = 0; i < n; i++) {
      const cx = inner.x0 + (W * (i + 0.5)) / n, cz = (inner.z0 + inner.z1) / 2 + D * 0.12;
      const r = { x0: cx - 1.4, x1: cx + 1.4, z0: cz - 1.0, z1: cz + 1.0 };
      if (!keep.some((k) => overlap(k, r))) { skylight(b, r, yr, { glassKey: 'glass_frosted' }); keep.push(r); }
    }
  } else if ((opts.solar ?? plan.roof.solar ?? true) && W > 6) {
    const z0 = inner.z0 + (keep.length ? 2.5 : 0.8), z1 = inner.z1 - 0.8;
    const sr = { x0: inner.x0 + 0.8, x1: inner.x1 - 0.8, z0, z1 };
    const free = !keep.some((k) => overlap(k, sr));
    if (free && z1 - z0 > 2.8) solarArray(b, sr, yr, { tilt: 0.3, azimuth: s._lat >= 0 ? 0 : Math.PI });
  }
  // scuppers + downpipes on the back facade (or front if back shared)
  const dpSide = plan.shared.back ? 'front' : 'back';
  const L = isFB(dpSide) ? plan.w : plan.d;
  const nD = Math.max(2, Math.round(L / 12));
  for (let i = 0; i < nD; i++) {
    const u = i === 0 ? 0.6 : i === nD - 1 ? L - 0.6 : (L * i) / (nD - 1);
    b.push(); facadeFrame(b, dpSide, plan.w, plan.d, insetOf(top, dpSide));
    scupper(b, u, ry + 0.05);
    const [g0] = sideGround(s, dpSide);
    downpipe(b, u, ry + 0.2, Math.max(sideGroundAt(s, dpSide, u, plan), plan.ffl - 0.3) + 0.0, { key: 'aluminium_dark' });
    b.pop();
    void g0;
  }
  return { yr, inner, keep };
}
/**
 * Stair-house door of a core (fix round 3): at the floor-landing end of the stair (where the last
 * flight arrives at the roof level), on that end wall when the deck in front of it is ≥ 1.2 m deep,
 * else in the roomier side wall at the landing. core.roofDoor ('front'|'back'|'left'|'right') forces
 * a side. Returns {side, u (along the stairHouse run, null = middle), at(ry) → access point 0.8 m out}.
 */
function roofDoorOf(core, r, inner) {
  const st = core.stair, lD = st.landD ?? 1.4, e = st.endInset || 0;
  const room = { front: inner.z1 - r.z1, back: r.z0 - inner.z0, left: r.x0 - inner.x0, right: inner.x1 - r.x1 };
  const W = r.x1 - r.x0, Dz = r.z1 - r.z0;
  const endSide = { max: 'front', min: 'back', minx: 'left', maxx: 'right' }[st.landAt] || 'front';
  let side = endSide, u = null;
  if (core.roofDoor) side = core.roofDoor;
  else if (room[endSide] < 1.2) {
    const cands = st.landAt === 'minx' || st.landAt === 'maxx' ? ['front', 'back'] : ['left', 'right'];
    side = room[cands[0]] >= room[cands[1]] ? cands[0] : cands[1];
    if (room[side] < 1.0 && room[endSide] > room[side]) side = endSide;
    else if (st.landAt === 'max') u = side === 'right' ? 0.05 + lD / 2 : Dz - 0.05 - lD / 2;      // right runs from z1, left from z0
    else if (st.landAt === 'min') u = side === 'right' ? Dz - 0.05 - lD / 2 : 0.05 + lD / 2;
    else if (st.landAt === 'minx') u = side === 'front' ? 0.05 + e + lD / 2 : W - 0.05 - e - lD / 2; // front runs from x0, back from x1
    else u = side === 'front' ? W - 0.05 - e - lD / 2 : 0.05 + e + lD / 2;
  }
  const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
  const at = (ry) => {
    if (side === 'front') return [u == null ? mx : r.x0 + u, ry, r.z1 + 0.8];
    if (side === 'back') return [u == null ? mx : r.x1 - u, ry, r.z0 - 0.8];
    if (side === 'right') return [r.x1 + 0.8, ry, u == null ? mz : r.z1 - u];
    return [r.x0 - 0.8, ry, u == null ? mz : r.z0 + u];
  };
  return { side, u, at };
}

/**
 * A facade position near `want` (searching ±range) where [u−hw, u+hw]×[y0, y1] is solid wall on
 * `side` — no opening of plan.allOpenings, inside the facade, clear of `avoid` (another fixture).
 */
export function solidSpot(plan, side, want, hw, y0, y1, L, range = 1.5, avoid = null) {
  const ops = (plan.allOpenings || []).filter((o) => o.side === side && o.v0 < y1 && o.v1 > y0);
  const ok = (u) => u - hw > 0.2 && u + hw < L - 0.2 && !ops.some((o) => u + hw > o.u0 - 0.07 && u - hw < o.u1 + 0.07) && (avoid === null || Math.abs(u - avoid) > hw + 0.12);
  for (let k = 0; k <= 32; k++) { const d = (k * range) / 32; if (ok(want + d)) return want + d; if (ok(want - d)) return want - d; }
  return null;
}
function sideGroundAt(s, side, u, plan) {
  const [g0, g1] = sideGround(s, side); const L = isFB(side) ? plan.w : plan.d; return g0 + ((g1 - g0) * u) / L;
}
function overlap(a, c) { return a.x0 < c.x1 && a.x1 > c.x0 && a.z0 < c.z1 && a.z1 > c.z0; }

/**
 * Arcade along plan.arcade.side: colonnade on the outer line, paved floor at FFL, soffit under the
 * first-floor slab, step + ramp down to the terrain where the street is lower than the floor.
 */
export function emitArcade(ctx, plan) {
  const b = ctx.b, s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const A = plan.arcade, side = A.side;
  const L = isFB(side) ? plan.w : plan.d;
  const f1 = plan.floors[1];
  if (!f1) return;
  const ffl = plan.ffl;
  const ys = f1.y - plan.slabT - 0.16;
  const sh = (sd) => !!plan.shared[sd];
  // party-wall ends continue into the neighbour's arcade: one column per boundary (the left building's)
  const startShared = side === 'front' ? sh('left') : side === 'back' ? sh('right') : false;
  const endShared = side === 'front' ? sh('right') : side === 'back' ? sh('left') : false;
  const doors = (plan.entrances || []).filter((e) => e.side === side).map((e) => [e.u0, e.u1]);
  b.push(); facadeFrame(b, side, plan.w, plan.d, 0);
  b.pushTint(inst.shellTint);
  arcade(b, { u0: 0, u1: L, depth: A.depth, y0: ffl, ySoffit: ys, yTop: f1.y, spacing: Math.max(5.2, plan.bayW * 1.8), r: st.id === 'zr_cold' ? 0.22 : 0.24, shape: st.id === 'zr_cold' ? 'square' : 'round', colKey: st.wall === 'panel_insulated' ? 'ceramic_white' : st.wall, colStart: !startShared, colEnd: true, doors, fasciaKey: st.band, soffitKey: st.soffit });
  b.popTint();
  // the street is usually a riser below the floor: continuous step along the open edge + one ramp
  const [g0, g1] = sideGround(s, side);
  const rise = ffl - Math.min(g0, g1);
  if (rise > 0.17) {
    const n = Math.max(1, Math.round(L / 9));
    for (let i = 0; i < n; i++) {
      const a = (L * i) / n + 0.6, c = (L * (i + 1)) / n - 0.6;
      const gy = g0 + ((g1 - g0) * ((a + c) / 2)) / L;
      if (ffl - gy > 0.17 && c - a > 1.2) steps(b, { u0: a, u1: c, z0: 0.035, y0: gy, y1: ffl, key: 'stone_step', cheeks: false, rails: ffl - gy > 0.6, railKey: 'steel' });
    }
  }
  if (rise > 0.04 && !endShared) {
    // accessible ramp (≤ 1:12) on the pavement along the colonnade, low end at the open corner
    const uLow = L - 0.3, gLow = g0 + ((g1 - g0) * uLow) / L;
    const uHigh = uLow - Math.max(1.2, (ffl - gLow) * 12);
    if (ffl - gLow > 0.04 && uHigh > 0.5) rampAlong(b, { uStart: uLow, uEnd: uHigh, y0: gLow, y1: ffl, z0: 0.04, z1: 1.4, key: 'paving_stone', railKey: 'steel' });
  }
  b.pop();
}

// ---------------------------------------------------------------------------
// BASE: plinth, retaining steps, entrances
// ---------------------------------------------------------------------------
/**
 * opts: {canopy:'curved'|'flat'|'none', ramp:boolean, binStore:boolean, bikes:boolean}
 */
export function emitBase(ctx, plan, opts = {}) {
  const b = ctx.b, s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const K = wallKeys(ctx);
  const skip = {};
  for (const sd of SIDES) skip[sd] = plan.shared[sd];
  b.withTint(inst.shellTint, () => plinth(b, s, plan.ffl, { key: st.plinth, skip }));
  retainingSteps(b, s, plan.ffl, {});
  if (plan.arcade) emitArcade(ctx, plan);
  for (const e of plan.entrances || []) {
    const arc = plan.arcade && plan.arcade.side === e.side ? plan.arcade.depth : 0;
    if (arc) {
      // under the colonnade: the arcade floor is the landing, the soffit the canopy; lamps + plaque only
      b.push(); facadeFrame(b, e.side, plan.w, plan.d, arc);
      const L = isFB(e.side) ? plan.w : plan.d, ffl = plan.ffl;
      const lL = solidSpot(plan, e.side, e.u0 - 0.35, 0.06, ffl + 1.8, ffl + 2.2, L, 1.6);
      if (lL !== null) wallLight(b, lL, ffl + 2.0);
      if (e.kind === 'main') {
        const pq = solidSpot(plan, e.side, e.u1 + 0.75, 0.18, ffl + 1.4, ffl + 1.72, L, 2.5);
        if (pq !== null) plaque(b, pq, ffl + 1.45);
      }
      b.pop();
      continue;
    }
    b.push(); facadeFrame(b, e.side, plan.w, plan.d, 0);
    const L = isFB(e.side) ? plan.w : plan.d;
    const [g0, g1] = sideGround(s, e.side);
    const gy = g0 + ((g1 - g0) * ((e.u0 + e.u1) / 2)) / L; // terrain at the door
    const ffl = plan.ffl;
    const main = e.kind === 'main' && !e.house;
    const lw = (e.u1 - e.u0) + (main ? 1.6 : 0.8);
    const lu0 = Math.max(0.1, (e.u0 + e.u1) / 2 - lw / 2), lu1 = Math.min(L - 0.1, (e.u0 + e.u1) / 2 + lw / 2);
    const landD = main ? 1.8 : e.house ? 1.3 : 1.2;
    // landing slab at FFL
    b.cbox('paving_stone', lu0, Math.min(gy, ffl) - 0.45, 0.0, lu1, ffl - 0.005, landD, 0.012, false);
    if (b.collecting) b.colQuad(lu0, ffl, landD, lu1, ffl, landD, lu1, ffl, 0, lu0, ffl, 0);
    const rise = ffl - gy;
    if (rise > 0.04) {
      steps(b, { u0: lu0, u1: lu1, z0: landD, y0: gy, y1: ffl, key: 'stone_step', cheeks: rise > 0.5, rails: rise > 0.45, railKey: st.railKey === 'steel_yellow' ? 'steel_yellow' : 'steel' });
      // ramp along the facade for the main entrance (≤ 1:12)
      if (main && opts.ramp !== false && rise > 0.06) {
        const dir = lu1 + rise * 12 + 1.2 < L - 0.2 ? 1 : -1;
        const uEnd = dir > 0 ? lu1 : lu0;
        const uStart = uEnd + dir * rise * 12;
        if (uStart > 0.2 && uStart < L - 0.2) rampAlong(b, { uStart, uEnd, y0: gy, y1: ffl, z0: 0.02, z1: 1.45, key: 'paving_stone', railKey: 'steel' });
      }
    }
    // canopy over the door
    const cu0 = e.u0 - (main ? 0.9 : 0.4), cu1 = e.u1 + (main ? 0.9 : 0.4);
    const cy = Math.min(e.v1 + 0.45, plan.floors[0].y + plan.floors[0].h - 0.35);
    let ckind = main ? (opts.canopy || (st.bandShape === 'curved' ? 'curved' : 'flat')) : e.kind === 'shop' ? 'none' : 'flat';
    if (e.house) ckind = st.bandShape === 'curved' && e.kind === 'main' ? 'curvedSmall' : 'flat';
    if (main && st.coveredEntry) ckind = 'porch';
    b.pushTint(inst.bandTint);
    if (ckind === 'porch') porch(b, { u0: lu0 + 0.05, u1: lu1 - 0.05, y0: ffl, depth: landD - 0.05, h: Math.min(2.75, cy - ffl + 0.2), key: K.frame, roofKey: K.band, glassKey: ctx.full ? 'glass_clear' : 'glass_shop', room: null });
    else if (ckind === 'curved') canopyCurved(b, { u0: cu0 - 0.4, u1: cu1 + 0.4, y: cy + 0.3, depth: landD + 0.8, key: K.band });
    else if (ckind === 'curvedSmall') canopyCurved(b, { u0: cu0 - 0.15, u1: cu1 + 0.15, y: cy + 0.1, depth: 1.15, t: 0.2, key: K.band });
    else if (ckind === 'flat') canopyFlat(b, { u0: cu0, u1: cu1, y: cy, depth: main ? landD + 0.4 : 1.1, key: K.band, rods: !main, sign: e.sign });
    b.popTint();
    // lights + plaque on solid wall beside the door (never on glazed side lights)
    const lL = solidSpot(plan, e.side, e.u0 - 0.35, 0.06, ffl + 1.8, ffl + 2.2, L, 1.6);
    if (lL !== null) wallLight(b, lL, ffl + 2.0);
    if (main) {
      const lR = solidSpot(plan, e.side, e.u1 + 0.35, 0.06, ffl + 1.8, ffl + 2.2, L, 1.6);
      if (lR !== null) wallLight(b, lR, ffl + 2.0);
      const pq = solidSpot(plan, e.side, e.u1 + 0.75, 0.18, ffl + 1.4, ffl + 1.72, L, 2.5, lR);
      if (pq !== null) plaque(b, pq, ffl + 1.45);
    }
    b.pop();
  }
  // houses: a two-bin enclosure in the front garden beside the steps, on the side away from the door
  const hmain = (plan.entrances || []).find((e) => e.house && e.kind === 'main');
  if (hmain && opts.houseBins !== false) {
    b.push(); facadeFrame(b, 'front', plan.w, plan.d, 0);
    const [g0, g1] = sideGround(s, 'front');
    const left = hmain.u0 > plan.w / 2;
    const u = left ? Math.max(0.9, hmain.u0 - 2.6) : Math.min(plan.w - 0.9, hmain.u1 + 2.6);
    if (u > 0.85 && u < plan.w - 0.85 && !(plan.allOpenings || []).some((o) => o.side === 'front' && o.kind === 'door' && Math.abs((o.u0 + o.u1) / 2 - u) < 1.2)) {
      const gy = Math.max(g0 + ((g1 - g0) * u) / plan.w, plan.ffl - 1.5);
      b.push(); b.translate(u, 0, 2.4); b.rotY(Math.PI);
      binStore(b, -0.9, -0.5, 0.9, 0.5, gy, { wallKey: st.wallAccent, h: 1.3 });
      b.pop();
    }
    b.pop();
  }
  // service yard furniture near the service entrance
  const svc = (plan.entrances || []).find((e) => e.kind === 'service');
  if (svc && opts.binStore !== false) {
    b.push(); facadeFrame(b, svc.side, plan.w, plan.d, 0);
    const L = isFB(svc.side) ? plan.w : plan.d;
    const [g0, g1] = sideGround(s, svc.side);
    const u = svc.u1 + 1.0;
    if (u + 3.2 < L) {
      const gy = Math.max(g0 + ((g1 - g0) * (u + 1.5)) / L, plan.ffl - 1.5);
      b.push(); b.translate(u + 1.6, 0, 2.2); b.rotY(Math.PI);
      binStore(b, -1.5, -0.9, 1.5, 0.9, gy, { wallKey: st.wallAccent });
      b.pop();
    }
    if (opts.bikes !== false) {
      const u2 = svc.u0 - 4.2;
      if (u2 > 0.5) bikeRacks(b, u2, 1.6, Math.max(g0 + ((g1 - g0) * u2) / L, plan.ffl - 1.5), 4);
    }
    b.pop();
  }
}

// ---------------------------------------------------------------------------
// ANCHORS
// ---------------------------------------------------------------------------
export function emitAnchors(ctx, plan) {
  const b = ctx.b, s = ctx.spec;
  const A = b.anchors;
  A.floors = plan.floors.map((f) => ({ level: f.level, y: f.y, height: f.h }));
  A.roof = { y: plan.roof.y, access: plan.roof.access || [0, plan.roof.y, 0] };
  for (const e of plan.entrances || []) {
    const u = (e.u0 + e.u1) / 2;
    const arc = plan.arcade && plan.arcade.side === e.side ? plan.arcade.depth : 0;
    const p = facadePoint(e.side, plan.w, plan.d, u, plan.ffl, 0.6 - arc);
    A.entrances.push({ kind: e.kind, side: e.side, pos: p, dir: facadeNormal(e.side), width: e.u1 - e.u0 });
  }
  A.rooms = [];
  for (const f of plan.floors) for (const r of f.rooms) A.rooms.push({ floor: f.level, name: r.name, kind: r.kind, unit: r.unit, center: [(r.x0 + r.x1) / 2, f.y, (r.z0 + r.z1) / 2], size: [r.x1 - r.x0, f.h, r.z1 - r.z0] });
  // cameras (§5 shot 07): street, entrance, lobby, stair, living (2nd floor street window), back, roof
  const C = A.cameras;
  const main = (plan.entrances || []).find((e) => e.kind === 'main') || { side: 'front', u0: plan.w / 2 - 0.9, u1: plan.w / 2 + 0.9 };
  const mu = (main.u0 + main.u1) / 2;
  const nrm = facadeNormal(main.side);
  const eye = 1.65;
  const pAt = (u, y, z) => facadePoint(main.side, plan.w, plan.d, u, y, z);
  C.street = { pos: pAt(mu - 4, eye, 22), target: pAt(mu, Math.min(plan.roof.y * 0.45, 12), 0) };
  C.entrance = { pos: pAt(mu + 2.2, plan.ffl + eye, 5.5), target: pAt(mu, plan.ffl + 1.3, -2) };
  const lob = plan.lobby;
  // lobby: inside the street door, clear of the door leaves now swung open (≈ 0.85 m into the lobby)
  if (lob) { const k = Math.max(0, lob.depth * 0.5 - 1.6); C.lobby = { pos: [lob.cx + 0.6 + lob.nx * k, plan.ffl + eye, lob.cz + lob.nz * k], target: [lob.cx - 1.6 - lob.nx * 2.0, plan.ffl + 1.1, lob.cz - lob.nz * 2.0] }; }
  if (plan.core && plan.floors.length > 1) {
    // on the axis of the first flight (flight A of interior/index.js stairFlights), standing on the
    // floor landing and looking up the flight to the half landing — never into the well between
    // the flights. Same local stair frame as emitInterior (landAt 'max' flips x and z).
    const st0 = plan.core.stair, f0 = plan.floors[0];
    const SF = stairFrame(st0);
    const xin = 0.12, Wl = SF.W - 2 * xin, Lz = SF.Lz - 0.02;
    const fw = Math.min(1.25, (Wl - 0.12) / 2), landD = st0.landD ?? 1.4, halfD = st0.halfD ?? 1.3;
    let { n } = risers(f0.h, 0.172); if (n % 2) n++;
    const n1 = plan.core.groundSplit && plan.core.split0 ? plan.core.split0[0] : n / 2;
    const n2 = plan.core.groundSplit && plan.core.split0 ? plan.core.split0[1] : n - n / 2;
    const h = f0.h / (n1 + n2), run = Math.max(1.0, Lz - landD - halfD), t1 = Math.min(0.3, run / Math.max(1, n1 - 1));
    const zA1 = landD + (n1 - 1) * t1, yHalf = n1 * h;
    const loc = (x, y, z) => stairPoint(st0, x, y, z, f0.y);
    const ax = xin + fw / 2, zc = Math.max(0.42, Math.min(0.6, landD - 0.5));
    C.stair = { pos: loc(ax, eye, zc), target: loc(ax, yHalf + 1.25, zA1 + 0.35) };
  }
  const f1r = plan.floors[1] ? plan.floors[1].rooms : [];
  const liv = f1r.find((r) => r.kind === 'living' && Math.abs(r.z1 - plan.d / 2) < 0.05) || f1r.find((r) => r.kind === 'living') || f1r.find((r) => (r.kind === 'bedroom' || r.kind === 'office') && Math.abs(r.z1 - plan.d / 2) < 0.05) || null;
  if (liv) {
    // from the back corner diagonal to the street window, on the side opposite the sofa (so the
    // sofa, coffee table and the window with the street beyond are all in view)
    const f1 = plan.floors[1];
    const front = Math.abs(liv.z1 - plan.d / 2) < 0.05;
    const W = liv.x1 - liv.x0, cx = (liv.x0 + liv.x1) / 2;
    const sw = liv._sofaWall;
    // camera x: the wall away from the sofa; sofa on a back/front wall → the side nearer the core
    const sg = sw === 'x1' ? -1 : sw === 'x0' ? 1 : (cx < 0 ? 1 : -1);
    // inner faces of the room (exterior walls are wallT thick, partitions ≈ 0.1) so the eye stands
    // ≥ 0.5 m inside the plaster even behind the thick cold-climate walls
    const fr = rectOf(plan, f1), tw = plan.wallT || 0.3;
    const inX0 = liv.x0 + (Math.abs(liv.x0 - fr.x0) < 0.03 ? tw : 0.05), inX1 = liv.x1 - (Math.abs(liv.x1 - fr.x1) < 0.03 ? tw : 0.05);
    const inZ0 = liv.z0 + (Math.abs(liv.z0 - fr.z0) < 0.03 ? tw : 0.05), inZ1 = liv.z1 - (Math.abs(liv.z1 - fr.z1) < 0.03 ? tw : 0.05);
    const camX = inX1 - inX0 > 1.4 ? (sg > 0 ? inX1 - 0.55 : inX0 + 0.55) : (inX0 + inX1) / 2, tgtX = cx - sg * W * 0.18;
    C.living = front
      ? { pos: [camX, f1.y + eye, inZ0 + 0.55], target: [tgtX, f1.y + 1.15, plan.d / 2 + 4] }
      : { pos: [camX, f1.y + eye, inZ1 - 0.55], target: [tgtX, f1.y + 1.15, -plan.d / 2 - 4] };
  }
  C.back = { pos: facadePoint(plan.shared.back ? 'front' : 'back', plan.w, plan.d, plan.w * 0.3, eye + Math.max(0, s._ground.br), 12), target: facadePoint(plan.shared.back ? 'front' : 'back', plan.w, plan.d, plan.w * 0.5, 4, 0) };
  const acc = plan.roof.access || [0, plan.roof.y, 0];
  C.roof = { pos: [acc[0] + 1.5, plan.roof.y + eye, acc[2] + 2.5], target: [0, plan.roof.y + 0.5, plan.d * 0.25] };
  void nrm;
}

export { planToU, uToPlan };
