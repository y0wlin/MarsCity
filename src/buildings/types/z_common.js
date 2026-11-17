// Shared helpers for the Zhurong (祝融市) public & commercial family (owner: buildings-z).
// Not a type module (no default export with `uses`), so the dispatcher ignores it.
//
//   pubStoreys(ctx, o)          storey stack for public buildings (public storeys 4.5–6 m, §3)
//   corridorPlan(ctx, o)        PlanModel: rooms on a double- or front-loaded corridor + stair/lift core,
//                               lobby at the main entrance, service door at the back (kit PlanModel)
//   publicOpenings(ctx, plan)   facade openings from rooms (classrooms / clinic rooms / offices / halls …)
//   addDoor(plan, o)            entrance door (+ glazed side lights) as plan.extraOpenings + plan.entrances
//   assemblePublic(ctx, plan,o) facades → bands → roof → base → interior ('full') → anchors
//   columnCanopy, cyanStrip, signBox, bollards, benchRow, kioskFurniture …  small structures
// Everything deterministic from spec.hash (ctx.sub channels ≥ 900 are used here).

import * as K from '../kit/index.js';
import { room, resetRoomIds, kindCode } from '../kit/plan.js';
import { emitFacades, emitBands, emitRoof, emitBase, emitAnchors, rectOf } from '../kit/assemble.js';
import { emitInterior } from '../interior/index.js';
import { coreLayout } from '../kit/cores.js';
import { sideGround } from '../kit/plinth.js';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const isFB = (side) => side === 'front' || side === 'back';
export const sideLen = (plan, side) => (isFB(side) ? plan.w : plan.d);

/** Terrain height (relative to the entrance) at facade position u of a side. */
export function groundAtU(s, side, u, L) {
  const [g0, g1] = sideGround(s, side);
  return g0 + ((g1 - g0) * clamp(u / Math.max(L, 1e-3), 0, 1));
}

/** Facade u (along the side, left→right seen from outside) of an entrance record of the spec. */
export function entranceU(s, e, w, d) {
  const L = isFB(e.side) ? w : d;
  // urban entrancePos: front x = offset, back x = −offset, left z = −offset, right z = +offset
  let u;
  switch (e.side) {
    case 'front': u = w / 2 + e.offset; break;
    case 'back': u = w / 2 + e.offset; break;     // back: x = −offset → u = w/2 − x = w/2 + offset
    case 'left': u = d / 2 - e.offset; break;     // left: z = −offset → u = z + d/2
    default: u = d / 2 - e.offset; break;         // right: z = offset → u = d/2 − z
  }
  return clamp(u, 0, L);
}

/** Entrances of a kind from the normalized spec, with facade u. */
export function specEntrances(ctx, kind) {
  const s = ctx.spec;
  return s._entrances.filter((e) => !kind || e.kind === kind).map((e) => ({ ...e, u: entranceU(s, e, s._w, s._d) }));
}

// ---------------------------------------------------------------------------------------------
// storeys
// ---------------------------------------------------------------------------------------------
/**
 * Storey stack. o: {gh, fh, ghMin=4.5, fhMin=3.8, fhMax=6.5, floors, ffl}
 * FFL sits above the front terrain so entrances are never buried.
 */
export function pubStoreys(ctx, o = {}) {
  const s = ctx.spec, st = ctx.style;
  const nF = o.floors ?? s._floors;
  const gh = clamp(+s.groundFloorHeight || o.gh || 4.8, o.ghMin ?? 4.5, o.ghMax ?? 8);
  const fh = clamp(+s.floorHeight || o.fh || 4.2, o.fhMin ?? 3.8, o.fhMax ?? 6.5);
  const frontG = Math.max(s._ground.fl, s._ground.fr);
  const ffl = o.ffl ?? Math.max(st.id === 'zr_cold' ? 0.45 : 0.3, frontG + 0.15);
  const floors = [];
  let y = ffl;
  for (let i = 0; i < nF; i++) { const h = i === 0 ? gh : fh; floors.push({ level: i, y, h, rooms: [], openings: [], inset: {} }); y += h; }
  return { ffl, gh, fh, floors, roofY: y };
}

// ---------------------------------------------------------------------------------------------
// corridor plan
// ---------------------------------------------------------------------------------------------
/**
 * Rooms on a corridor along x with one stair/lift core on the back wall.
 * o: {
 *   gh, fh, ffl, floors        storeys (pubStoreys)
 *   corridorW=2.4              corridor width
 *   single: false|'front'      'front' = single-loaded, corridor along the front facade (schools)
 *   coreX                      core centre x (default: spec-hash offset near the centre)
 *   module(level, zone)        target room width (m) for 'back' / 'front' zones
 *   kind(level, zone, i, n, x0, x1) → room kind
 *   lobbyW=8, lobbyKind='lobby', lobbyX (centre x)
 *   hall(level) → {x0,x1,kind} optional extra-wide room in the front zone (gym, waiting hall)
 * }
 */
export function corridorPlan(ctx, o = {}) {
  resetRoomIds();
  const s = ctx.spec, st = ctx.style;
  const w = s._w, d = s._d, T = st.wallT;
  const S = o.storeys || pubStoreys(ctx, o);
  const floors = S.floors;
  const nF = floors.length;
  const plan = { w, d, ffl: S.ffl, wallT: T, slabT: 0.25, floors, roof: { y: S.roofY, parapet: 1.1, kind: 'flat' }, shared: s._shared, entrances: [], extraOpenings: [], shafts: [], bayW: o.bayW || 3.6 };
  const rng = ctx.sub(901);
  const maxRise = Math.max(S.gh, S.fh);
  const mainE = specEntrances(ctx, 'main').find((e) => e.side === 'front');
  const mainX = o.lobbyX ?? (mainE ? mainE.u - w / 2 : 0);
  let coreX = o.coreX ?? clamp((rng.next() - 0.5) * w * 0.25, -w / 2 + 6, w / 2 - 6);
  // keep the core out of the lobby
  const lobbyW = Math.min(o.lobbyW ?? 8, w * 0.5);
  if (Math.abs(coreX - mainX) < lobbyW / 2 + 3.2 && !o.coreInLobby) coreX = mainX + (coreX >= mainX ? 1 : -1) * (lobbyW / 2 + 3.4);
  coreX = clamp(coreX, -w / 2 + T + 3.0, w / 2 - T - 3.0);
  const core = coreLayout({ cx: coreX, zBack: -d / 2 + T, towards: 1, maxRise, lift: nF >= 2, liftSide: rng.next() < 0.5 ? 1 : -1, landingDepth: 1.8 });
  plan.core = core;
  const cw = o.corridorW ?? 2.4;
  let single = o.single || false;
  let zc0 = core.stair.z1, zc1 = zc0 + cw;
  if (!single && d / 2 - zc1 < 4.0) single = 'front';
  if (single === 'front') { zc1 = d / 2; zc0 = d / 2 - cw; }
  plan.corridor = { z0: zc0, z1: zc1, single };
  for (const f of floors) {
    const R = f.rooms;
    const stair = room('stair', core.stair.x0, core.stair.x1, -d / 2, core.stair.z1, { floor: f.level, name: 'stair' });
    R.push(stair);
    let lift = null;
    if (core.lift) {
      lift = room('lift', core.lift.x0, core.lift.x1, core.lift.z0, core.lift.z1, { floor: f.level });
      R.push(lift);
      if (core.lift.z0 > -d / 2 + 0.6) R.push(room('shaft', core.lift.x0, core.lift.x1, -d / 2, core.lift.z0, { floor: f.level, name: 'riser', extra: { noWindows: true } }));
    }
    const corr = room('corridor', -w / 2, w / 2, zc0, zc1, { floor: f.level, name: 'corridor' });
    let landing = null;
    if (core.stair.z1 < zc0 - 0.3) {
      landing = room('corridor', core.x0, core.x1, core.stair.z1, zc0, { floor: f.level, name: 'landing' });
      landing.open.push(corr.id);
      R.push(landing);
      stair.doors.push({ to: landing.id, width: 1.2 });
    } else stair.doors.push({ to: corr.id, width: 1.2 });
    R.push(corr);
    // back zone: left / right of the core
    const backZ1 = zc0;
    const modB = o.module ? o.module(f.level, 'back') : 7.2;
    for (const [x0, x1] of [[-w / 2, core.x0], [core.x1, w / 2]]) {
      const zw = x1 - x0;
      if (zw < 1.6) continue;
      const n = Math.max(1, Math.round(zw / modB));
      for (let i = 0; i < n; i++) {
        const a = x0 + (zw * i) / n, c = x0 + (zw * (i + 1)) / n;
        const kind = o.kind ? o.kind(f.level, 'back', i, n, a, c) : 'office';
        const r = room(kind, a, c, -d / 2, backZ1, { floor: f.level });
        if (kind === 'open') { r.kind = 'office'; r.open.push(corr.id); } else r.doors.push({ to: corr.id, width: kind === 'classroom' || kind === 'hall' ? 1.2 : 1.0 });
        R.push(r);
      }
    }
    // front zone (double-loaded)
    if (!single) {
      const modF = o.module ? o.module(f.level, 'front') : 7.2;
      const spans = [];
      let lob = null;
      if (f.level === 0 && o.lobby !== false) {
        const lx0 = clamp(mainX - lobbyW / 2, -w / 2, w / 2 - lobbyW), lx1 = lx0 + lobbyW;
        lob = room(o.lobbyKind || 'lobby', lx0, lx1, zc1, d / 2, { floor: 0, name: 'lobby' });
        lob.open.push(corr.id);
        R.push(lob);
        spans.push([-w / 2, lx0], [lx1, w / 2]);
        plan.lobby = { cx: (lx0 + lx1) / 2, cz: (zc1 + d / 2) / 2, nx: 0, nz: 1, depth: d / 2 - zc1, room: lob };
      } else spans.push([-w / 2, w / 2]);
      const hall = o.hall ? o.hall(f.level) : null;
      for (const [x0, x1] of spans) {
        let pieces = [[x0, x1]];
        if (hall && hall.x0 < x1 && hall.x1 > x0) {
          const hx0 = Math.max(x0, hall.x0), hx1 = Math.min(x1, hall.x1);
          const hr = room(hall.kind || 'hall', hx0, hx1, zc1, d / 2, { floor: f.level, name: hall.name || 'hall' });
          hr.doors.push({ to: corr.id, width: 1.6 });
          R.push(hr);
          pieces = [[x0, hx0], [hx1, x1]];
        }
        for (const [a0, a1] of pieces) {
          const zw = a1 - a0;
          if (zw < 1.6) continue;
          const n = Math.max(1, Math.round(zw / modF));
          for (let i = 0; i < n; i++) {
            const a = a0 + (zw * i) / n, c = a0 + (zw * (i + 1)) / n;
            const kind = o.kind ? o.kind(f.level, 'front', i, n, a, c) : 'office';
            const r = room(kind, a, c, zc1, d / 2, { floor: f.level });
            if (kind === 'open') { r.kind = 'office'; r.open.push(corr.id); } else r.doors.push({ to: corr.id, width: kind === 'classroom' ? 1.2 : 1.0 });
            R.push(r);
          }
        }
      }
    } else if (f.level === 0 && o.lobby !== false) {
      // front-loaded: the corridor at the entrance is the lobby (its segment becomes a lobby room)
      const lx0 = clamp(mainX - lobbyW / 2, -w / 2, w / 2 - lobbyW), lx1 = lx0 + lobbyW;
      // split corridor into three rooms: left, lobby, right
      const idx = R.indexOf(corr);
      R.splice(idx, 1);
      const cl = room('corridor', -w / 2, lx0, zc0, zc1, { floor: 0, name: 'corridor' });
      const lob = room(o.lobbyKind || 'lobby', lx0, lx1, zc0, zc1, { floor: 0, name: 'lobby' });
      const cr = room('corridor', lx1, w / 2, zc0, zc1, { floor: 0, name: 'corridor' });
      cl.open.push(lob.id); cr.open.push(lob.id);
      for (const r of R) { // re-point doors to the segment that touches them
        for (const dd of r.doors) if (dd.to === corr.id) { const cx = (r.x0 + r.x1) / 2; dd.to = cx < lx0 ? cl.id : cx > lx1 ? cr.id : lob.id; }
        if (r.open.includes(corr.id)) { const cx = (r.x0 + r.x1) / 2; r.open = r.open.map((id) => (id === corr.id ? (cx < lx0 ? cl.id : cx > lx1 ? cr.id : lob.id) : id)); }
      }
      if (lx0 - (-w / 2) > 0.4) R.push(cl);
      R.push(lob);
      if (w / 2 - lx1 > 0.4) R.push(cr);
      plan.lobby = { cx: (lx0 + lx1) / 2, cz: (zc0 + zc1) / 2, nx: 0, nz: 1, depth: zc1 - zc0, room: lob };
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// openings
// ---------------------------------------------------------------------------------------------
function roomFacadeSpans(r, w, d) {
  const out = [], e = 0.02;
  if (Math.abs(r.z1 - d / 2) < e) out.push({ side: 'front', u0: r.x0 + w / 2, u1: r.x1 + w / 2, depth: r.z1 - r.z0 });
  if (Math.abs(r.z0 + d / 2) < e) out.push({ side: 'back', u0: w / 2 - r.x1, u1: w / 2 - r.x0, depth: r.z1 - r.z0 });
  if (Math.abs(r.x1 - w / 2) < e) out.push({ side: 'right', u0: d / 2 - r.z1, u1: d / 2 - r.z0, depth: r.x1 - r.x0 });
  if (Math.abs(r.x0 + w / 2) < e) out.push({ side: 'left', u0: r.z0 + d / 2, u1: r.z1 + d / 2, depth: r.x1 - r.x0 });
  return out;
}

/**
 * Facade openings for public rooms. o: {rules:{kind: {sill, head (below ceiling), frac (glazed share of a bay),
 * bay, type}}, skip(room, side) → bool, avoid:[{side,u0,u1,v0,v1}] (doors), bayW}
 */
export function publicOpenings(ctx, plan, f, o = {}) {
  const s = ctx.spec;
  const w = plan.w, d = plan.d, slab = plan.slabT;
  const ceil = f.y + f.h - slab;
  const out = [];
  const R = { classroom: { sill: 0.75, head: 0.3, frac: 0.78, bay: 3.2 }, clinic: { sill: 0.9, head: 0.35, frac: 0.6, bay: 3.6 }, office: { sill: 0.7, head: 0.3, frac: 0.7, bay: 3.6 }, waiting: { sill: 0.45, head: 0.3, frac: 0.82, bay: 3.2 }, hall: { sill: 2.3, head: 0.45, frac: 0.7, bay: 4.2 }, corridor: { sill: 0.9, head: 0.35, frac: 0.55, bay: 3.6, ends: true }, storage: { sill: 1.9, head: 0.5, frac: 0.4, bay: 4.5, type: 'vent' }, plant: { sill: 1.9, head: 0.5, frac: 0.4, bay: 4.5, type: 'vent' }, bath: { sill: 1.6, head: 0.4, frac: 0.25, bay: 3, type: 'small' }, ...(o.rules || {}) };
  for (const r of f.rooms) {
    if (r.kind === 'stair' || r.kind === 'lift' || r.noWindows) continue;
    for (const fs of roomFacadeSpans(r, w, d)) {
      if (plan.shared[fs.side]) continue;
      if (o.skip && o.skip(r, fs.side)) continue;
      const span = fs.u1 - fs.u0;
      if (span < 1.2) continue;
      const base = { side: fs.side, room: r, floor: f.level, depth: fs.depth, roomU0: fs.u0, roomU1: fs.u1 };
      if (r.kind === 'lobby' || r.kind === 'shop') {
        // full-height glazing (doors are cut out by the caller via o.avoid)
        const top = Math.min(ceil - 0.15, f.y + (r.kind === 'lobby' ? Math.min(f.h - slab - 0.15, 4.6) : 3.6));
        let segs = [[fs.u0 + 0.45, fs.u1 - 0.45]];
        for (const a of o.avoid || []) {
          if (a.side !== fs.side || a.v0 > top || a.v1 < f.y) continue;
          const nx = [];
          for (const [p, q] of segs) { if (a.u1 + 0.3 <= p || a.u0 - 0.3 >= q) { nx.push([p, q]); continue; } if (a.u0 - 0.3 - p > 0.8) nx.push([p, a.u0 - 0.3]); if (q - (a.u1 + 0.3) > 0.8) nx.push([a.u1 + 0.3, q]); }
          segs = nx;
        }
        for (const [p, q] of segs) out.push({ ...base, u0: p, u1: q, v0: f.y, v1: top, kind: 'shop', lobby: r.kind === 'lobby' });
        continue;
      }
      const rule = R[r.kind] || R.office;
      if (r.kind === 'corridor' && !(fs.side === 'left' || fs.side === 'right') && !o.corridorFacade) {
        // corridor touching a long facade (front-loaded): windows per bay
      }
      const v0 = f.y + rule.sill, v1 = Math.min(ceil - rule.head, f.y + (rule.maxH ?? 99));
      if (v1 - v0 < 0.5) continue;
      if (r.kind === 'corridor' && (fs.side === 'left' || fs.side === 'right')) {
        // corridor end window: tall, centred
        const ww = Math.min(span - 0.9, 1.6);
        if (ww > 0.6) out.push({ ...base, u0: (fs.u0 + fs.u1) / 2 - ww / 2, u1: (fs.u0 + fs.u1) / 2 + ww / 2, v0: f.y + 0.1, v1, kind: 'tall' });
        continue;
      }
      const bay = rule.bay;
      const n = Math.max(1, Math.round((span - 0.6) / bay));
      for (let i = 0; i < n; i++) {
        const c = fs.u0 + (span * (i + 0.5)) / n, ww = Math.min((span / n) * rule.frac, span / n - 0.6);
        if (ww < 0.5) continue;
        const op = { ...base, u0: c - ww / 2, u1: c + ww / 2, v0, v1, kind: rule.type || (v1 - v0 > 2.6 && rule.sill < 0.6 ? 'tall' : 'casement') };
        if (rule.type === 'small') op.frosted = true;
        if ((o.avoid || []).some((a) => a.side === op.side && a.u0 < op.u1 + 0.25 && a.u1 > op.u0 - 0.25 && a.v0 < op.v1 && a.v1 > op.v0)) continue;
        out.push(op);
      }
    }
  }
  void s;
  return out;
}

/**
 * Entrance door: o {side, u (centre), w, h=2.4, kind:'main'|'service'|..., doorKind, room, vestibule, sideLights}
 * Adds plan.entrances + plan.extraOpenings. Returns the opening.
 */
export function addDoor(plan, o) {
  const ffl = o.y ?? plan.ffl, h = o.h ?? 2.4;
  const op = { side: o.side, u0: o.u - o.w / 2, u1: o.u + o.w / 2, v0: ffl, v1: ffl + h, kind: 'door', doorKind: o.doorKind || (o.kind === 'service' ? 'service' : 'glazed_double'), floor: o.floor ?? 0, room: o.room || null, vestibule: !!o.vestibule, roomKind: o.roomKind };
  plan.extraOpenings.push(op);
  if (o.entrance !== false) plan.entrances.push({ kind: o.kind || 'main', side: o.side, u0: op.u0, u1: op.u1, v1: op.v1, sign: o.sign });
  return op;
}

/** Staggered stair-well windows at the half landings (core against the back wall). */
export function stairWindows(plan, side = 'back') {
  const core = plan.core;
  if (!core || plan.shared[side]) return;
  const w = plan.w;
  const su = side === 'back' ? w / 2 - (core.stair.x0 + core.stair.x1) / 2 : w / 2 + (core.stair.x0 + core.stair.x1) / 2;
  const stairRoom = (i) => plan.floors[i].rooms.find((r) => r.kind === 'stair');
  for (let i = 0; i < plan.floors.length - 1; i++) {
    const f = plan.floors[i], f2 = plan.floors[i + 1];
    const yh = f.y + f.h * 0.5 + 0.95;
    plan.extraOpenings.push({ side, u0: su - 0.7, u1: su + 0.7, v0: yh, v1: Math.min(yh + 1.5, f2.y + f2.h - 0.6), kind: 'casement', floor: i, room: stairRoom(i) });
  }
}

/**
 * All passes for a public plan. o: {bands: depth | fn(L, side) | 0, roof:{…emitRoof opts} | false,
 * base:{…emitBase opts}, interior:{…}, facades:{…}}
 */
export function assemblePublic(ctx, plan, o = {}) {
  emitFacades(ctx, plan, o.facades || {});
  const st = ctx.style;
  if (o.bands !== 0 && o.bands !== false && st.bandShape !== 'none') {
    const dfn = typeof o.bands === 'function' ? o.bands : () => (o.bands ?? (st.bandShape === 'curved' ? 0.45 : 0.28));
    emitBands(ctx, plan, (L, side, rect) => dfn(L, side, rect), { railFn: o.railFn || (() => null), up: st.bandShape === 'curved' ? 0.12 : 0.08, lights: false, cornerR: o.cornerR ?? 0.6 });
  }
  if (o.roof !== false) plan.roofOut = emitRoof(ctx, plan, o.roof || {});
  emitBase(ctx, plan, o.base || {});
  if (ctx.full) emitInterior(ctx, plan, o.interior || {});
  emitAnchors(ctx, plan);
}

// ---------------------------------------------------------------------------------------------
// small structures
// ---------------------------------------------------------------------------------------------
/** Limited cyan wayfinding strip (thin emissive bar) between two points at height y. */
export function cyanStrip(b, x0, z0, x1, z1, y, o = {}) {
  const t = o.t ?? 0.04, h = o.h ?? 0.03;
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  if (L < 0.05) return;
  b.push(); b.translate(x0, y, z0); b.rotY(-Math.atan2(dz, dx));
  b.box('aluminium_dark', -0.01, -h - 0.01, -t / 2 - 0.012, L + 0.01, 0.005, t / 2 + 0.012, 63 & ~8);
  b.box('light_cyan', 0, -h, -t / 2, L, 0.0, t / 2, 4 | 1 | 2 | 16 | 32);
  b.pop();
}

/**
 * Flat canopy on round columns over a rect (building frame): slab with fascia, soffit + downlights,
 * columns at `cols` [[x,z]...] from y0 (ground) to the soffit. o: {x0,x1,z0,z1,y (top), t=0.35, cols,
 * key, soffitKey, colKey, colR, rounded (corner radius), lights, gutterSide}
 */
export function columnCanopy(b, o) {
  const t = o.t ?? 0.35, key = o.key || 'ceramic_band', sk = o.soffitKey || 'render_white';
  const r = Math.min(o.rounded ?? 0, (o.x1 - o.x0) / 2 - 0.01, (o.z1 - o.z0) / 2 - 0.01);
  if (r > 0.05) {
    const poly = K.roundedRect(o.x0, o.z0, o.x1, o.z1, r);
    b.prism(key, poly, o.y - t, o.y, { top: true, bottom: false });
    b.polyY(sk, poly.map((p) => [p[0], p[1]]), [], o.y - t + 0.002, -1);
  } else {
    b.cbox(key, o.x0, o.y - t, o.z0, o.x1, o.y, o.z1, 0.03);
  }
  if (o.lights !== false) {
    const nx = Math.max(1, Math.round((o.x1 - o.x0) / 2.4)), nz = Math.max(1, Math.round((o.z1 - o.z0) / 2.4));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) b.cylinder('light_warm', o.x0 + ((o.x1 - o.x0) * (i + 0.5)) / nx, o.y - t - 0.006, o.z0 + ((o.z1 - o.z0) * (j + 0.5)) / nz, 0.08, 0.006, 12, { top: false, bottom: true });
  }
  for (const c of o.cols || []) {
    const y0 = c[2] ?? o.y0 ?? 0;
    K.columnRound(b, o.colKey || 'ceramic_white', c[0], c[1], y0, o.y - t, o.colR ?? 0.22, { baseKey: 'stone_plinth' });
    if (b.collecting) b.colBox(c[0] - (o.colR ?? 0.22), y0, c[1] - (o.colR ?? 0.22), c[0] + (o.colR ?? 0.22), o.y - t, c[1] + (o.colR ?? 0.22));
  }
}

/** Sign totem (light box on a plinth) facing rotY, both faces with content (fix round 2: pictogram + glyph rows,
 *  no blank boxes). o: {w, h, cross:'cyan'|'red'|null, seed} */
export function signTotem(b, x, y, z, rot, o = {}) {
  const w = o.w ?? 0.9, h = o.h ?? 2.4;
  b.push(); b.translate(x, y, z); b.rotY(rot);
  b.cbox('aluminium_dark', -w / 2, 0, -0.12, w / 2, h, 0.12, 0.02, false);
  for (const sg of [1, -1]) {
    b.push(); if (sg < 0) b.rotY(Math.PI);
    b.rectZ('signage_blank', -w / 2 + 0.07, 0.6, w / 2 - 0.07, h - 0.1, 0.124, 1);
    signContent(b, -w / 2 + 0.07, 0.6, w / 2 - 0.07, h - 0.1, 0.125, { vertical: true, cross: o.cross, seed: ((o.seed ?? 7) + (sg > 0 ? 0 : 101)) >>> 0 });
    b.pop();
  }
  b.box('light_cyan', -w / 2 + 0.07, h - 0.08, -0.13, w / 2 - 0.07, h - 0.05, 0.13, 63);
  b.pop();
}

// ---------------------------------------------------------------------------------------------
// sign content (fix round 2, QQ-13 "灯箱是没有内容的平板白块"): pseudo-CJK glyph text, pictograms
// (medical cross, train, arrow), LED rows — thin boxes standing proud of the light-box face so the
// lit face shows printed / cut-out content day and night. Deterministic from a seed.
// ---------------------------------------------------------------------------------------------
function glyphRng(seed) {
  let h = ((seed >>> 0) ^ 0x9e3779b9) >>> 0;
  return () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
}

/**
 * n pseudo-CJK glyphs (cell g × g, gap 0.3 g) from x0 along +x, centred on cy, on the plane z facing +z
 * (current frame). Horizontal and vertical strokes sit at different depths (no coplanar overlaps).
 * o: {gap, dz, vertical (column downwards from cy)}. Returns the run length.
 */
export function glyphText(b, x0, cy, z, g, n, seed, key = 'steel_dark', o = {}) {
  const t = Math.max(0.008, g * 0.11), gap = o.gap ?? g * 0.3, dz = o.dz ?? Math.max(0.003, g * 0.02);
  const rnd = glyphRng(seed);
  const H = (a, c, y) => b.box(key, a, y - t / 2, z, c, y + t / 2, z + dz * 1.6, 16 | 4 | 8);
  const V = (x, lo, hi) => b.box(key, x - t / 2, lo, z, x + t / 2, hi, z + dz, 16 | 1 | 2);
  for (let i = 0; i < n; i++) {
    const a = o.vertical ? x0 : x0 + i * (g + gap), c = a + g;
    const ym = o.vertical ? cy - i * (g + gap) : cy, lo = ym - g / 2, hi = ym + g / 2, m = (a + c) / 2;
    const p = Math.floor(rnd() * 9), j = (rnd() - 0.5) * g * 0.2;
    switch (p) {
      case 0: H(a, c, ym + j); V(m, lo, hi); break;                                               // 十
      case 1: H(a, c, hi - t / 2); H(a, c, lo + t / 2); V(a + t / 2, lo, hi); V(c - t / 2, lo, hi); break;   // 口
      case 2: H(a, c, hi - t / 2); H(a, c, ym); H(a, c, lo + t / 2); V(a + t / 2, lo, hi); V(c - t / 2, lo, hi); break; // 日
      case 3: H(a, c, hi - t / 2); V(m, lo, hi); H(a, c, lo + t / 2); break;                          // 工
      case 4: H(a + g * 0.1, c - g * 0.1, hi - t / 2); H(a + g * 0.18, c - g * 0.18, ym); H(a, c, lo + t / 2); break; // 三
      case 5: V(a + t / 2, lo, hi); H(a, c, hi - t / 2); V(c - t / 2, lo, hi); break;                  // 门
      case 6: H(a, c, lo + t / 2); V(a + t / 2, lo, ym + g * 0.15); V(m, lo, hi); V(c - t / 2, lo, ym + g * 0.15); break; // 山
      case 7: V(a + g * 0.22, lo, hi); H(a + g * 0.42, c, ym + g * 0.28); H(a + g * 0.42, c, ym - g * 0.1); V(a + g * 0.72, lo, ym + g * 0.28); break; // 亻+ component
      default: H(a + g * 0.12, c - g * 0.12, hi - t / 2); H(a, c, ym + j); V(m, lo, ym + j); H(a + g * 0.2, c - g * 0.2, lo + t / 2); break; // 主
    }
  }
  return n * (g + gap) - gap;
}

/** Medical cross (three non-overlapping boxes) of size s centred at (cx, cy) on the plane z facing +z. */
export function crossMark(b, cx, cy, z, s, key = 'light_cyan', dz = 0.025) {
  const a = s * 0.17;
  b.box(key, cx - a, cy - s / 2, z, cx + a, cy + s / 2, z + dz, 16 | 1 | 2 | 4 | 8);
  b.box(key, cx - s / 2, cy - a, z, cx - a, cy + a, z + dz, 16 | 2 | 4 | 8);
  b.box(key, cx + a, cy - a, z, cx + s / 2, cy + a, z + dz, 16 | 1 | 4 | 8);
}

/** Train pictogram (front view of a car: body, windscreen, lamps) in a square s at (cx, cy), plane z. */
export function trainMark(b, cx, cy, z, s, key = 'steel_dark', dz = 0.012) {
  const w = s * 0.62, h = s * 0.7, y0 = cy - s * 0.32, t = s * 0.07;
  b.box(key, cx - w / 2, y0, z, cx - w / 2 + t, y0 + h, z + dz, 16 | 1 | 2);
  b.box(key, cx + w / 2 - t, y0, z, cx + w / 2, y0 + h, z + dz, 16 | 1 | 2);
  b.box(key, cx - w / 2 + t, y0 + h - t, z, cx + w / 2 - t, y0 + h, z + dz, 16 | 4 | 8);
  b.box(key, cx - w / 2 + t, y0 + h * 0.48, z, cx + w / 2 - t, y0 + h * 0.48 + t, z + dz, 16 | 4 | 8);
  b.box(key, cx - w / 2 + t, y0, z, cx + w / 2 - t, y0 + t * 1.6, z + dz, 16 | 4 | 8);
  for (const sg of [-1, 1]) b.box(key, cx + sg * w * 0.28 - t * 0.6, y0 + t * 2.2, z, cx + sg * w * 0.28 + t * 0.6, y0 + t * 3.4, z + dz * 1.5, 16);
  b.box(key, cx - w * 0.36, cy - s * 0.46, z, cx - w * 0.36 + t, y0, z + dz, 16 | 1 | 2);
  b.box(key, cx + w * 0.36 - t, cy - s * 0.46, z, cx + w * 0.36, y0, z + dz, 16 | 1 | 2);
}

/** Arrow pictogram pointing dir (+1 right / −1 left) in a square s at (cx, cy), plane z. */
export function arrowMark(b, cx, cy, z, s, dir = 1, key = 'steel_dark', dz = 0.012) {
  const t = s * 0.14;
  b.box(key, cx - s * 0.42, cy - t / 2, z, cx + s * 0.18, cy + t / 2, z + dz, 16 | 4 | 8);
  for (let k = 0; k < 5; k++) {           // stepped head
    const xa = cx + dir * (s * 0.12 + k * s * 0.07), hh = s * 0.32 * (1 - k / 5);
    b.box(key, Math.min(xa, xa + dir * s * 0.07), cy - hh, z, Math.max(xa, xa + dir * s * 0.07), cy + hh, z + dz * 1.4, 16);
  }
}

/**
 * Content for a light-box face (x0..x1 × y0..y1 on the plane z, facing +z): optional pictogram square on the
 * left (cross 'cyan' | 'red' | 'green', 'train', 'arrow'), then one or two rows of glyphs (dark print on the
 * lit face); o.vertical → pictogram on top, glyph column below. o: {cross, picto, rows, seed, key}
 */
export function signContent(b, x0, y0, x1, y1, z, o = {}) {
  const W = x1 - x0, H = y1 - y0, key = o.key || 'steel_dark', seed = (o.seed ?? 1) >>> 0;
  const crossKey = o.cross === 'red' ? 'light_red' : 'light_cyan';
  if (o.vertical) {
    const s = Math.min(W * 0.78, H * 0.3);
    let top = y1 - 0.08;
    if (o.cross) { crossMark(b, (x0 + x1) / 2, top - s / 2, z, s, crossKey); top -= s + 0.12; }
    else if (o.picto === 'train') { trainMark(b, (x0 + x1) / 2, top - s / 2, z, s, key); top -= s + 0.12; }
    const g = Math.min(W * 0.62, 0.42);
    const n = Math.max(0, Math.floor((top - y0 - 0.05) / (g * 1.3)));
    if (n) glyphText(b, (x0 + x1) / 2 - g / 2, top - g / 2, z, g, n, seed, key, { vertical: true });
    return;
  }
  if (o.rows === 0) {                       // pictogram only, centred (cross boxes on blades / stair houses)
    const s0 = Math.min(W, H) * 0.8, cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2;
    if (o.cross) crossMark(b, cx0, cy0, z, s0, crossKey);
    else if (o.picto === 'train') trainMark(b, cx0, cy0, z, s0, key);
    else if (o.picto === 'arrow') arrowMark(b, cx0, cy0, z, s0, o.dir ?? 1, key);
    return;
  }
  let xa = x0 + Math.min(0.12, W * 0.04);
  const s = H * 0.74;
  if (o.cross) { crossMark(b, xa + s / 2, (y0 + y1) / 2, z, s, crossKey); xa += s + H * 0.25; }
  else if (o.picto === 'train') { trainMark(b, xa + s / 2, (y0 + y1) / 2, z, s, key); xa += s + H * 0.25; }
  else if (o.picto === 'arrow') { arrowMark(b, xa + s / 2, (y0 + y1) / 2, z, s, o.dir ?? 1, key); xa += s + H * 0.25; }
  const rows = o.rows ?? (H > 0.9 ? 2 : 1);
  const g = rows === 2 ? H * 0.3 : H * 0.5;
  const n = Math.max(0, Math.floor((x1 - 0.08 - xa + g * 0.3) / (g * 1.3)));
  if (!n) return;
  if (rows === 2) {
    glyphText(b, xa, y0 + H * 0.68, z, g, n, seed, key);
    // second row: smaller latin-like line (short strokes)
    const g2 = g * 0.62, n2 = Math.max(0, Math.floor((x1 - 0.08 - xa) / (g2 * 1.3)));
    if (n2) glyphText(b, xa, y0 + H * 0.26, z, g2, n2, seed + 17, key);
  } else glyphText(b, xa, (y0 + y1) / 2, z, g, n, seed, key);
}

/**
 * Light box with content: aluminium case (front face at z, depth dep behind it), lit face (signage_blank,
 * night-gated) + content; o.twoSided adds the back face (case centred on z then). o: {cross, picto, rows, seed,
 * depth, frameKey, twoSided, dir}
 */
export function lightBox(b, cx, y, w, h, z, o = {}) {
  const dep = o.depth ?? 0.16, fk = o.frameKey || 'aluminium_dark', fw = Math.min(0.05, w * 0.06, h * 0.08);
  // case body stops 2 cm behind the face plane; a 3 cm frame border stands proud round the lit face
  b.cbox(fk, cx - w / 2, y, o.twoSided ? z - dep + 0.02 : z - dep, cx + w / 2, y + h, z - 0.02, 0.012, true);
  const faces = o.twoSided ? [1, -1] : [1];
  for (const sg of faces) {
    b.push();
    if (sg < 0) { b.translate(cx, 0, z - dep / 2); b.rotY(Math.PI); b.translate(-cx, 0, -(z - dep / 2)); }
    b.box(fk, cx - w / 2, y, z - 0.02, cx - w / 2 + fw, y + h, z + 0.012, 1 | 2 | 4 | 8 | 16);
    b.box(fk, cx + w / 2 - fw, y, z - 0.02, cx + w / 2, y + h, z + 0.012, 1 | 2 | 4 | 8 | 16);
    b.box(fk, cx - w / 2 + fw, y, z - 0.02, cx + w / 2 - fw, y + fw, z + 0.012, 4 | 8 | 16);
    b.box(fk, cx - w / 2 + fw, y + h - fw, z - 0.02, cx + w / 2 - fw, y + h, z + 0.012, 4 | 8 | 16);
    b.rectZ('signage_blank', cx - w / 2 + fw, y + fw, cx + w / 2 - fw, y + h - fw, z, 1);
    signContent(b, cx - w / 2 + fw + 0.03, y + fw + 0.03, cx + w / 2 - fw - 0.03, y + h - fw - 0.03, z + 0.001, { ...o, seed: ((o.seed ?? 3) + (sg < 0 ? 57 : 0)) >>> 0 });
    b.pop();
  }
}

/** LED information board (dark screen, cyan text rows, always lit) on the plane z facing +z: o {rows, seed}. */
export function ledBoard(b, cx, y, w, h, z, o = {}) {
  b.cbox('aluminium_dark', cx - w / 2, y, z - 0.08, cx + w / 2, y + h, z - 0.02, 0.01, true);
  for (const [a0, a1, c0, c1, f] of [[cx - w / 2, cx - w / 2 + 0.04, y, y + h, 1 | 2 | 4 | 8 | 16], [cx + w / 2 - 0.04, cx + w / 2, y, y + h, 1 | 2 | 4 | 8 | 16], [cx - w / 2 + 0.04, cx + w / 2 - 0.04, y, y + 0.04, 4 | 8 | 16], [cx - w / 2 + 0.04, cx + w / 2 - 0.04, y + h - 0.04, y + h, 4 | 8 | 16]]) b.box('aluminium_dark', a0, c0, z - 0.02, a1, c1, z + 0.01, f);
  b.rectZ('black', cx - w / 2 + 0.04, y + 0.04, cx + w / 2 - 0.04, y + h - 0.04, z - 0.005, 1);
  const rows = o.rows ?? Math.max(1, Math.floor((h - 0.1) / 0.16));
  const rh = (h - 0.12) / rows, g = Math.min(rh * 0.62, 0.2);
  for (let r = 0; r < rows; r++) {
    const yc = y + h - 0.06 - rh * (r + 0.5);
    const n = Math.max(1, Math.floor((w * 0.55) / (g * 1.3)));
    glyphText(b, cx - w / 2 + 0.1, yc, z + 0.002, g, n, ((o.seed ?? 5) + r * 31) >>> 0, 'light_cyan', { dz: 0.002 });
    // right-aligned "time / platform" digits block
    const nd = 3;
    glyphText(b, cx + w / 2 - 0.1 - nd * g * 1.3, yc, z + 0.002, g * 0.8, nd, ((o.seed ?? 5) + r * 77) >>> 0, r % 4 === 1 ? 'light_red' : 'light_cyan', { dz: 0.002 });
  }
}

/** Row of outdoor benches along x (building frame) at z facing +z (rot). */
export function benchRow(b, x0, x1, z, y, rot = 0, spacing = 4.5) {
  const n = Math.max(1, Math.floor((x1 - x0) / spacing));
  for (let i = 0; i < n; i++) K.bench(b, x0 + ((x1 - x0) * (i + 0.5)) / n, y, z, rot);
}

/** Bollards along a line (building frame). */
export function bollardLine(b, x0, z0, x1, z1, y, spacing = 1.8) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / spacing));
  for (let i = 0; i <= n; i++) K.bollard(b, x0 + ((x1 - x0) * i) / n, y, z0 + ((z1 - z0) * i) / n);
}

/** Planter strip with shrubs + small trees (building frame rect, top at y0+h). */
export function planterStrip(b, x0, z0, x1, z1, y0, seed, o = {}) {
  K.planterBox(b, x0, z0, x1, z1, y0, o.h ?? 0.5, seed >>> 0, { tree: o.tree ?? true, treeH: o.treeH ?? 3.2, density: o.density ?? 0.9 });
}

/** Room-info (interior mapping) for a custom glass pane: o {u0 (pane offset in room), w, d, h, sill, kind, floor, bay}. */
export function glassRoom(ctx, o) {
  const s = ctx.spec;
  return { u0: o.u0 ?? 0.5, w: o.w ?? 4, d: o.d ?? 6, h: o.h ?? 3, sill: o.sill ?? 0.1, kind: typeof o.kind === 'string' ? kindCode(o.kind) : (o.kind ?? kindCode('office')), seed: ((s.hash >>> 3) % 997) / 997, floor: o.floor ?? 0, bay: o.bay ?? 0, hash: s.hash, profile: s._profile | 0 };
}

/** Glazed screen (mullions + panes) in a wall frame between u0..u1, v0..v1 at z (no wall). */
export function glassScreen(b, o) {
  const fk = o.frameKey || 'aluminium', gk = o.glassKey || 'glass_shop';
  const L = o.u1 - o.u0, n = Math.max(1, Math.round(L / (o.pane ?? 1.8)));
  const z = o.z ?? 0, mw = o.mw ?? 0.07, md = o.md ?? 0.14;
  const rows = o.rows || [o.v0, o.v1];
  // end mullions sit INSIDE the screen (u0 … u0 + mw, u1 − mw … u1) and transoms stop at the ends, so two screens
  // that share an edge get a double mullion instead of coincident boxes (QQ-02 audit)
  const mu = (i) => (i === 0 ? o.u0 + mw / 2 + 0.005 : i === n ? o.u1 - mw / 2 - 0.005 : o.u0 + (L * i) / n);   // 5 mm off the reveals
  for (let i = 0; i <= n; i++) {
    const u = mu(i);
    b.box(fk, u - mw / 2, o.v0, z - md / 2, u + mw / 2, o.v1, z + md / 2, 63 & ~8 & ~4);
  }
  // transoms stand 6 mm proud of the mullions on both faces (crossing frame faces were coplanar, QQ-02 audit)
  for (let j = 0; j < rows.length; j++) b.box(fk, o.u0 + mw, rows[j] - mw / 2, z - md / 2 - 0.006, o.u1 - mw, rows[j] + mw / 2, z + md / 2 + 0.006, 63 & ~1 & ~2);
  for (let i = 0; i < n; i++) {
    const a = mu(i) + mw / 2, c = mu(i + 1) - mw / 2;
    for (let j = 0; j < rows.length - 1; j++) {
      const lo = rows[j] + mw / 2, hi = rows[j + 1] - mw / 2;
      if (hi - lo < 0.05) continue;
      if (o.room) K.setGlassRoom(b, typeof o.room === 'function' ? o.room(i, j) : o.room, a - o.u0, lo - o.v0);
      b.quad(gk, a, lo, z, c, lo, z, c, hi, z, a, hi, z, [0, 0, c - a, 0, c - a, hi - lo, 0, hi - lo]);
      if (o.back) b.quad(gk, c, lo, z - 0.002, a, lo, z - 0.002, a, hi, z - 0.002, c, hi, z - 0.002, [0, 0, c - a, 0, c - a, hi - lo, 0, hi - lo]);
    }
  }
  K.clearGlassRoom(b);
}

/** Simple interior counter / reception desk (current frame, front at +z). */
export function reception(b, L = 3.2, o = {}) {
  b.cbox(o.key || 'cabinet', -L / 2, 0, -0.35, L / 2, 1.05, 0.35, 0.02, false);
  b.cbox('counter', -L / 2 - 0.03, 1.05, -0.4, L / 2 + 0.03, 1.1, 0.42, 0.01);
  b.box('light_cyan', -L / 2 + 0.1, 0.12, 0.351, L / 2 - 0.1, 0.15, 0.36, 63);
  if (b.collecting) b.colBox(-L / 2, 0, -0.35, L / 2, 1.1, 0.35);
}

/** Bench seating (interior waiting), current frame, along x. */
export function waitingBench(b, L = 2.4) {
  for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) b.cbox('aluminium_dark', x - 0.03, 0, -0.25, x + 0.03, 0.45, 0.25, 0.006, false);
  b.cbox('wood', -L / 2, 0.42, -0.24, L / 2, 0.47, 0.24, 0.01);
  b.cbox('wood', -L / 2, 0.47, -0.27, L / 2, 0.86, -0.22, 0.01);
  if (b.collecting) b.colBox(-L / 2, 0, -0.27, L / 2, 0.86, 0.25);
}

/**
 * Furnish a public waiting / lobby area (building frame rect r = {x0,x1,z0,z1} inside the room, floor y):
 * rows of waiting benches facing `face` (+1 → +z, −1 → −z) with a clear aisle, planters at the corners,
 * an information totem + wall screen, waste bins. o: {face, keep:[rects], seed, sign, rowGap, aisle (x of a
 * kept-clear aisle, half width 1.6), planters}
 */
export function furnishPublic(ctx, r, y, o = {}) {
  const b = ctx.b;
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  if (W < 3 || D < 2.4) return;
  const face = o.face ?? 1, seed = (o.seed ?? ctx.spec.hash) >>> 0;
  const keep = (o.keep || []).slice();
  if (o.aisle != null) keep.push({ x0: o.aisle - 1.6, x1: o.aisle + 1.6, z0: r.z0 - 1, z1: r.z1 + 1 });
  const free = (x0, z0, x1, z1) => !keep.some((k) => k.x0 < x1 && k.x1 > x0 && k.z0 < z1 && k.z1 > z0);
  // planters at the four corners (pots, colliders)
  if (o.planters !== false) {
    const cs = [[r.x0 + 0.5, r.z0 + 0.5], [r.x1 - 0.5, r.z0 + 0.5], [r.x0 + 0.5, r.z1 - 0.5], [r.x1 - 0.5, r.z1 - 0.5]];
    cs.forEach(([x, z], i) => {
      if (!free(x - 0.3, z - 0.3, x + 0.3, z + 0.3)) return;
      b.push(); b.translate(0, y, 0); plantPotFn(b, x, z, 1.25, (seed + i * 17) >>> 0); b.pop();
      if (b.collecting) b.colBox(x - 0.22, y, z - 0.22, x + 0.22, y + 0.45, z + 0.22);
      keep.push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
    });
  }
  // bench rows (2.4 m benches, 0.4 m gaps, 1.7 m row pitch), facing `face`
  const rowGap = o.rowGap ?? 1.7, bl = 2.4;
  const nRow = Math.max(1, Math.floor((D - 1.6) / rowGap));
  for (let j = 0; j < nRow; j++) {
    const z = face > 0 ? r.z0 + 1.0 + j * rowGap : r.z1 - 1.0 - j * rowGap;
    for (let x = r.x0 + 1.0; x + bl <= r.x1 - 1.0; x += bl + 0.45) {
      if (!free(x, z - 0.35, x + bl, z + 0.35)) continue;
      b.push(); b.translate(x + bl / 2, y, z); b.rotY(face > 0 ? 0 : Math.PI); waitingBench(b, bl); b.pop();
    }
  }
  // information totem (two-sided blank light box) + bins near the first row
  if (o.sign !== false) {
    const tx = r.x0 + Math.min(W - 0.8, 0.8), tz = face > 0 ? r.z1 - 0.8 : r.z0 + 0.8;
    if (free(tx - 0.5, tz - 0.2, tx + 0.5, tz + 0.2)) {
      signTotem(b, tx, y, tz, face > 0 ? Math.PI : 0, { w: 0.8, h: 2.1 });
      if (b.collecting) b.colBox(tx - 0.4, y, tz - 0.12, tx + 0.4, y + 2.1, tz + 0.12);
    }
    for (const bx of [r.x1 - 0.6, r.x0 + 2.2]) {
      const bz = face > 0 ? r.z1 - 0.6 : r.z0 + 0.6;
      if (free(bx - 0.25, bz - 0.25, bx + 0.25, bz + 0.25)) b.cylinder('steel_dark', bx, y, bz, 0.22, 0.9, 12, { top: true });
    }
  }
}
/** Lobby furniture ('full'): planters in the front corners, a bench on a side wall, blank notice screen on the back wall. */
export function lobbyFurniture(ctx, r, y) {
  const b = ctx.b, W = r.x1 - r.x0, D = r.z1 - r.z0;
  if (W < 3 || D < 2.5) return;
  b.push(); b.translate(0, y, 0);
  plantPotFn(b, r.x0 + 0.55, r.z1 - 0.7, 1.2, ctx.spec.hash >>> 0);
  plantPotFn(b, r.x1 - 0.55, r.z1 - 0.7, 1.2, (ctx.spec.hash + 7) >>> 0);
  b.pop();
  if (D > 4.2) { b.push(); b.translate(r.x0 + 0.45, y, (r.z0 + r.z1) / 2 + 0.4); b.rotY(Math.PI / 2); waitingBench(b, Math.min(2.4, D - 2.6)); b.pop(); }
  // hanging two-sided sign (lobbies are often open to the corridor behind — no wall to mount on)
  const cx = (r.x0 + r.x1) / 2, hw = Math.min(1.1, W * 0.25), zs = r.z0 + Math.min(0.8, D * 0.3);
  for (const dx of [-hw * 0.8, hw * 0.8]) b.box('steel_dark', cx + dx - 0.012, y + 2.8, zs - 0.012, cx + dx + 0.012, y + 4.15, zs + 0.012, 63);
  b.cbox('aluminium_dark', cx - hw, y + 2.3, zs - 0.05, cx + hw, y + 2.82, zs + 0.05, 0.01);
  b.rectZ('signage_blank', cx - hw + 0.05, y + 2.35, cx + hw - 0.05, y + 2.77, zs + 0.055, 1);
  signContent(b, cx - hw + 0.08, y + 2.38, cx + hw - 0.08, y + 2.74, zs + 0.056, { picto: 'arrow', rows: 1, seed: ctx.spec.hash });
  if (b.collecting) for (const x of [r.x0 + 0.55, r.x1 - 0.55]) b.colBox(x - 0.22, y, r.z1 - 0.92, x + 0.22, y + 0.45, r.z1 - 0.48);
}
// plantPot lives in interior/furniture.js (imported lazily to keep this module's import list small)
import { plantPot as plantPotFn } from '../interior/furniture.js';

/** Straight stair (current frame) rising along +x from (x0, y0, z), width W, stone treads on steel stringers, rails + ramp collider. Returns the run length. */
export function straightStair(b, x0, y0, z, rise, W = 1.3) {
  const { n, h } = K.risers(rise, 0.175);
  const run = n * 0.28;
  b.push(); b.translate(x0, y0, z);
  for (let i = 0; i < n; i++) b.cbox('stone_step', i * 0.28, (i + 1) * h - 0.05, -W / 2, (i + 1) * 0.28 + 0.02, (i + 1) * h, W / 2, 0.004, true);
  for (const zz of [-W / 2 - 0.06, W / 2 + 0.06]) b.sweep('steel_dark', [[0, 0, zz], [run, rise, zz]], [[-0.06, -0.2], [0.06, -0.2], [0.06, 0], [-0.06, 0]], {});
  for (const zz of [-W / 2 + 0.02, W / 2 - 0.02]) K.handrail(b, [[0, 0.9, zz], [run, rise + 0.9, zz]], { posts: true, height: 0 });
  if (b.collecting) b.colQuad(0, 0, W / 2, run, rise, W / 2, run, rise, -W / 2, 0, 0, -W / 2);
  b.pop();
  return run;
}

/**
 * Slab between y0..y1 over rect {x0,x1,z0,z1} with rectangular holes [{x0,x1,z0,z1}] (stair wells):
 * top / bottom faces with holes, outer edge faces (edgeKey, e.g. the ZR slab band), hole edge faces.
 * o: {top, bottom, edge, holeEdge, collider (walkable top)}
 */
export function slabWithHoles(b, r, holes, y0, y1, o = {}) {
  const outer = [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
  const H = (holes || []).map((h) => [[h.x0, h.z0], [h.x1, h.z0], [h.x1, h.z1], [h.x0, h.z1]]);
  b.polyY(o.top || 'concrete_smooth', outer, H, y1, 1);
  b.polyY(o.bottom || 'plaster', outer, H, y0, -1);
  const ek = o.edge || 'concrete_smooth';
  b.rectZ(ek, r.x0, y0, r.x1, y1, r.z1, 1);
  b.rectZ(ek, r.x0, y0, r.x1, y1, r.z0, -1);
  b.rectX(ek, r.z0, y0, r.z1, y1, r.x1, 1);
  b.rectX(ek, r.z0, y0, r.z1, y1, r.x0, -1);
  const hk = o.holeEdge || ek;
  for (const h of holes || []) {
    b.rectZ(hk, h.x0, y0, h.x1, y1, h.z0, 1);
    b.rectZ(hk, h.x0, y0, h.x1, y1, h.z1, -1);
    b.rectX(hk, h.z0, y0, h.z1, y1, h.x0, 1);
    b.rectX(hk, h.z0, y0, h.z1, y1, h.x1, -1);
  }
  if (o.collider !== false && b.collecting) b.colPolyY(outer, H, y1);
}

/**
 * Rooftop PV rack (rows of tilted panels on steel legs + concrete pads) — the kit's solarArray layout with the cell
 * surface 6 mm proud of its aluminium frame (the kit's 1 mm offset z-fights: 20–25 m² per clinic roof). rect in the
 * current frame, y = roof surface. o: {tilt, azimuth, rowSpacing}
 */
export function solarRack(b, rect, y, o = {}) {
  const { x0, x1, z0, z1 } = rect, tilt = o.tilt ?? 0.32, rowD = o.rowSpacing ?? 2.6;
  const pw = 1.02, ph = 1.7;
  const W = x1 - x0, D = z1 - z0;
  const nRows = Math.max(1, Math.floor(D / rowD)), nCols = Math.max(1, Math.floor(W / (pw + 0.02)));
  b.push(); b.translate((x0 + x1) / 2, y, (z0 + z1) / 2); b.rotY(o.azimuth ?? 0);
  for (let r = 0; r < nRows; r++) {
    const zc = -D / 2 + rowD * (r + 0.5);
    const hBack = Math.sin(tilt) * ph + 0.3;
    for (let c = 0; c <= nCols; c += 2) {
      const xx = (-nCols * (pw + 0.02)) / 2 + c * (pw + 0.02);
      b.box('steel', xx - 0.025, 0.08, zc + 0.6, xx + 0.025, 0.3, zc + 0.65, 63 & ~8);
      b.box('steel', xx - 0.025, 0.08, zc - 0.65, xx + 0.025, hBack, zc - 0.6, 63 & ~8);
      b.box('concrete', xx - 0.15, 0.004, zc - 0.8, xx + 0.15, 0.08, zc + 0.8, 63 & ~8);
    }
    for (let c = 0; c < nCols; c++) {
      const xa = (-nCols * (pw + 0.02)) / 2 + c * (pw + 0.02);
      b.push(); b.translate(xa + pw / 2, 0.3, zc + (ph / 2) * Math.cos(tilt)); b.rotX(-tilt);
      b.box('aluminium', -pw / 2, -0.035, -ph, pw / 2, 0.0, 0, 63);
      b.quad('solar_panel', -pw / 2 + 0.015, 0.006, -0.015, pw / 2 - 0.015, 0.006, -0.015, pw / 2 - 0.015, 0.006, -ph + 0.015, -pw / 2 + 0.015, 0.006, -ph + 0.015, [0, 0, 1, 0, 1, 1, 0, 1]);
      b.pop();
    }
  }
  b.pop();
}

/** Exterior site paving pad around a building (building frame), top at y. */
export function apron(b, x0, z0, x1, z1, y, key = 'paving') {
  b.box(key, x0, y - 0.25, z0, x1, y, z1, 4 | 1 | 2 | 16 | 32);
  if (b.collecting) b.colQuad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
}

/**
 * Sub-building context sharing the builder: a rect part of the footprint (cx, cz offset, w × d),
 * with ground corners re-sampled from the parent so terrain stays continuous. Caller translates the
 * builder by (cx, 0, cz) around the sub-generation and offsets the sub-plan's anchors (offsetAnchors).
 */
export function subCtx(ctx, o) {
  const s = ctx.spec;
  const e = (s.ground && Number.isFinite(+s.ground.entrance)) ? +s.ground.entrance : 0;
  const ga = (x, z) => K.groundAt(s, x, z) + e;
  const { cx = 0, cz = 0, w, d } = o;
  const corners = [ga(cx - w / 2, cz + d / 2), ga(cx + w / 2, cz + d / 2), ga(cx + w / 2, cz - d / 2), ga(cx - w / 2, cz - d / 2)];
  const spec2 = { ...s, __normalized: false, footprint: { shape: 'rect', w, d }, ground: { entrance: e, min: Math.min(...corners), max: Math.max(...corners), corners }, sharedWalls: o.shared || s.sharedWalls || {}, entrances: o.entrances || s.entrances, floors: o.floors ?? s.floors, meta: { ...(s.meta || {}), ...(o.meta || {}) } };
  const ns = K.normalizeSpec(spec2);
  const off = o.channel || 5000;
  return { ...ctx, spec: ns, sub: (ch, extra = 0) => ctx.sub(ch + off, extra) };
}

/** Offset anchors written by a sub-plan (emitAnchors) by (dx, dy, dz). */
export function offsetAnchors(A, dx, dy, dz) {
  const off = (p) => (Array.isArray(p) ? [p[0] + dx, p[1] + dy, p[2] + dz] : p);
  for (const e of A.entrances || []) e.pos = off(e.pos);
  for (const r of A.rooms || []) r.center = off(r.center);
  if (A.roof && A.roof.access) A.roof = { ...A.roof, y: A.roof.y + dy, access: off(A.roof.access) };
  for (const f of A.floors || []) f.y += dy;
  for (const k of Object.keys(A.cameras || {})) { const c = A.cameras[k]; if (c) A.cameras[k] = { pos: off(c.pos), target: off(c.target) }; }
}

/** The free (not shared) side facing the equator-side sun most. */
export function sunSide(s) {
  let best = 'front', bs = -1;
  for (const side of ['front', 'right', 'back', 'left']) { if (s._shared[side]) continue; const v = K.daylightScore(s, side); if (v > bs) { bs = v; best = side; } }
  return best;
}

/**
 * Mass-LOD volume for a storey stack S (pubStoreys) over a rect (default: the footprint). Far facade
 * attributes use the same floorH / groundH (incl. FFL) / bayW as the near windows (same light ids).
 * o: {x0,x1,z0,z1,y0,y1,parapet,bayW,blank,flags,bands,roofColor,garden,shops,glazedGround}
 */
export function zMass(ctx, S, o = {}) {
  const s = ctx.spec;
  const R = K.roofSpec(s, ctx.style || {}, ctx.inst);
  const bands = o.bands ?? (!!ctx.style.bands && ctx.style.bandShape !== 'none');
  return {
    x0: o.x0 ?? -s._w / 2, x1: o.x1 ?? s._w / 2, z0: o.z0 ?? -s._d / 2, z1: o.z1 ?? s._d / 2,
    y0: o.y0 ?? Math.min(0, s._ground.min) - 0.5, y1: o.y1 ?? S.roofY, parapet: o.parapet ?? 1.1,
    floorH: o.floorH ?? S.fh, groundH: o.groundH ?? S.ffl + S.gh, bayW: o.bayW ?? 3.6, blank: o.blank ?? s._shared,
    flags: (o.flags ?? 0) | (bands ? 4 : 0) | (o.glazedGround ? 8 : 0), bands, shops: !!o.shops,
    roofColor: o.roofColor ?? K.roofFarColor(R), garden: o.garden ?? R.kind === 'garden', soffit: o.soffit, round: o.round, n: o.n, uBase: o.uBase, plant: o.plant,
  };
}

export { room, kindCode, rectOf };
