// Plan model: the plan-first description of a building that drives facades, interiors,
// colliders and anchors so that rooms and windows always align (§1 生成可使用的普通建筑).
// Types build a PlanModel (rooms per floor, core, entrances) and hand it to assemble.js.
//
// PlanModel (building frame, metres; footprint rect centred, x∈[−w/2,w/2], z∈[−d/2,d/2]):
// {
//   w, d, ffl, wallT, slabT,
//   floors: [{ level, y, h, rooms:[Room], openings:[Opening], inset:{front,back}, rect:{x0,x1,z0,z1} }],
//   roof:   { y, parapet, kind:'flat'|'garden'|'pitched', rect },
//   core:   { x0,x1,z0,z1, stair:{x0,x1,z0,z1, along:'z'|'x', landingAt:'max'|'min'}, lift?:{x0,x1,z0,z1, door:'+z'|'-z'|'+x'|'-x'} } | null,
//   shared: {left,right,back},
//   entrances: [{ kind, side, u0, u1, y, room? }],
//   bayW,    far-shader / window-light bay width
// }
// Room    = { id, kind, name, x0,x1,z0,z1, floor, unit, doors:[{to, at?, pos?, width?, kind?}], open:[ids] }
//           door.pos = [x, z] plan point the door centre should sit nearest to (else interior/index.js
//           puts it 0.25 m from one end of the partition, clear of exterior walls)
//           x/z extents run to the OUTER face of exterior walls and to the centre of partitions.
// Opening = { side, u0, u1, v0, v1, kind, room?, floor, balcony?, frosted?, doorKind?, door? }
//   kinds: 'casement' 'tall' 'slider' 'small' 'strip' 'shop' 'door' 'vent' 'garage'
//   u = metres along the facade from its left end seen from outside; v = absolute local y.

import { ROOM_KIND } from './windows.js';

export const SIDES = ['front', 'right', 'back', 'left'];

/** Facade u of a plan point on a side of a w×d rect. */
export function planToU(side, w, d, x, z) {
  switch (side) {
    case 'front': return x + w / 2;
    case 'right': return d / 2 - z;
    case 'back': return w / 2 - x;
    default: return z + d / 2;
  }
}
/** Plan point at facade u (on the facade line) of a side. */
export function uToPlan(side, w, d, u) {
  switch (side) {
    case 'front': return [u - w / 2, d / 2];
    case 'right': return [w / 2, d / 2 - u];
    case 'back': return [w / 2 - u, -d / 2];
    default: return [-w / 2, u - d / 2];
  }
}

/** Sides of rect r (floor rect) that room touches; returns [{side, u0, u1, depth}] */
export function roomFacades(room, rect, w, d) {
  const out = [], e = 0.02;
  const fw = rect ? rect : { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 };
  if (Math.abs(room.z1 - fw.z1) < e) out.push({ side: 'front', a: room.x0, b: room.x1, depth: room.z1 - room.z0 });
  if (Math.abs(room.x1 - fw.x1) < e) out.push({ side: 'right', a: room.z1, b: room.z0, depth: room.x1 - room.x0 });
  if (Math.abs(room.z0 - fw.z0) < e) out.push({ side: 'back', a: room.x1, b: room.x0, depth: room.z1 - room.z0 });
  if (Math.abs(room.x0 - fw.x0) < e) out.push({ side: 'left', a: room.z0, b: room.z1, depth: room.x1 - room.x0 });
  for (const f of out) {
    // convert plan extents to facade u (sorted)
    const p0 = f.side === 'front' || f.side === 'back' ? [f.a, 0] : [0, f.a];
    const p1 = f.side === 'front' || f.side === 'back' ? [f.b, 0] : [0, f.b];
    const u0 = planToU(f.side, w, d, p0[0], p0[1]), u1 = planToU(f.side, w, d, p1[0], p1[1]);
    f.u0 = Math.min(u0, u1); f.u1 = Math.max(u0, u1);
  }
  return out;
}

/** Room area & helpers */
export const roomW = (r) => r.x1 - r.x0;
export const roomD = (r) => r.z1 - r.z0;
export const roomCenter = (r) => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];

let ROOM_ID = 0;
/** Create a room record. */
export function room(kind, x0, x1, z0, z1, o = {}) {
  return { id: o.id ?? `r${ROOM_ID++}`, kind, name: o.name || kind, x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), unit: o.unit ?? null, doors: o.doors || [], open: o.open || [], floor: o.floor ?? 0, ...o.extra };
}
export function resetRoomIds() { ROOM_ID = 0; }

/**
 * Derive facade openings from the rooms of a floor (windows follow rooms: §1 朝街或朝院的
 * 房间对应外立面的真实窗洞). Rules per room kind; `balconySides` tells which sides have a usable
 * balcony at this floor (living rooms get sliding doors there).
 * o: {style, inst, rng, wallT, w, d, rect, floor, y, h, slabT, balconySides:{front:bool...}, blank:{side:bool}, bayW}
 */
export function deriveOpenings(rooms, o) {
  const out = [];
  const { w, d, y, h, rng, style, inst } = o;
  const slab = o.slabT ?? 0.22;
  const ceil = y + h - slab;               // ceiling level of this floor
  const head = Math.min(y + 2.45, ceil - 0.12);
  for (const r of rooms) {
    if (r.kind === 'stair' || r.kind === 'lift' || r.kind === 'shaft' || r.noWindows) continue;
    const facades = roomFacades(r, o.rect, w, d);
    for (const f of facades) {
      if (o.blank && o.blank[f.side]) continue;
      const span = f.u1 - f.u0;
      const margin = 0.45; // to partitions / corners
      const avail = span - 2 * margin;
      if (avail < 0.5) continue;
      const balcony = o.balconySides && o.balconySides[f.side];
      const cu = (f.u0 + f.u1) / 2;
      const push = (kind, width, v0, v1, extra = {}) => {
        const ww = Math.min(width, avail);
        out.push({ side: f.side, u0: cu - ww / 2 + (extra.shift || 0), u1: cu + ww / 2 + (extra.shift || 0), v0, v1, kind, room: r, floor: o.floor, depth: f.depth, roomU0: f.u0, roomU1: f.u1, ...extra });
      };
      switch (r.kind) {
        case 'living': {
          const g = style.glazing ?? 0.6;
          if (balcony) {
            const sw = Math.min(avail + 0.5, Math.max(2.4, span * g + 0.2));
            if (sw > 4.2) {
              // sliding door + fixed full-height panel
              const a = cu - sw / 2;
              out.push({ side: f.side, u0: a, u1: a + 3.0, v0: y + 0.02, v1: head, kind: 'slider', room: r, floor: o.floor, depth: f.depth, roomU0: f.u0, roomU1: f.u1, balcony: true });
              out.push({ side: f.side, u0: a + 3.12, u1: cu + sw / 2, v0: y + 0.05, v1: head, kind: 'tall', room: r, floor: o.floor, depth: f.depth, roomU0: f.u0, roomU1: f.u1, balcony: true });
            } else push('slider', sw, y + 0.02, head, { balcony: true });
          } else if (rng.next() < style.windowTall) push('tall', Math.min(avail, 2.6), y + 0.05, head, { juliet: true });
          else push('casement', Math.min(avail, 2.4), y + 0.6, head);
          break;
        }
        case 'bedroom': {
          const g = style.glazing ?? 0.6;
          if (balcony && rng.next() < (style.windowTall ?? 0.5) + 0.2) push('tall', Math.min(avail + 0.3, Math.max(1.5, span * g - 0.3)), y + 0.05, head, { balcony: true });
          else push('casement', Math.min(avail, span > 3.4 ? 1.8 : 1.5), y + 0.9, head);
          break;
        }
        case 'kitchen': push('casement', Math.min(avail, 1.4), y + 1.05, head - 0.05); break;
        case 'bath': push('small', Math.min(avail, 0.7), y + 1.5, head - 0.1, { frosted: true }); break;
        case 'corridor': case 'hall': if (span > 1.4) push('casement', Math.min(avail, 1.1), y + 0.9, head); break;
        case 'lobby': push('shop', Math.min(avail, span - 0.8), y + 0.0, Math.min(ceil - 0.15, y + 3.2), { lobby: true }); break;
        case 'shop': push('shop', span - 0.5, y + 0.0, Math.min(ceil - 0.1, y + h - slab - 0.2), {}); break;
        case 'storage': case 'plant': case 'bike': case 'bin': push('vent', Math.min(avail, 1.2), y + 1.6, Math.min(head, y + 2.3)); break;
        case 'office': case 'classroom': case 'clinic': {
          // repeat windows per bay along the room facade
          const bw = o.bayW || 3.6;
          const n = Math.max(1, Math.round(span / bw));
          for (let i = 0; i < n; i++) {
            const c = f.u0 + (span * (i + 0.5)) / n, ww = Math.min(bw * 0.62, span / n - 0.7);
            if (ww < 0.6) continue;
            out.push({ side: f.side, u0: c - ww / 2, u1: c + ww / 2, v0: y + 0.85, v1: head, kind: 'casement', room: r, floor: o.floor, depth: f.depth, roomU0: f.u0, roomU1: f.u1 });
          }
          break;
        }
        default: push('casement', Math.min(avail, 1.5), y + 0.9, head);
      }
    }
  }
  void inst;
  return out;
}

/** ROOM_KIND code for the glass shader. */
export function kindCode(kind) {
  if (kind in ROOM_KIND) return ROOM_KIND[kind];
  if (kind === 'bike' || kind === 'bin') return ROOM_KIND.storage;
  return ROOM_KIND.office;
}

/**
 * Shared edges between rooms on one floor → partition segments.
 * Returns [{a, b, x0,z0,x1,z1, axis:'x'|'z'}] (segment along z if axis 'z' (x const)).
 */
export function sharedEdges(rooms, e = 0.02) {
  const out = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const A = rooms[i], B = rooms[j];
    // vertical edge (x = const)
    for (const [xa, xb] of [[A.x1, B.x0], [A.x0, B.x1]]) {
      if (Math.abs(xa - xb) < e) {
        const z0 = Math.max(A.z0, B.z0), z1 = Math.min(A.z1, B.z1);
        if (z1 - z0 > 0.3) out.push({ a: A, b: B, x0: xa, z0, x1: xa, z1, axis: 'z' });
      }
    }
    for (const [za, zb] of [[A.z1, B.z0], [A.z0, B.z1]]) {
      if (Math.abs(za - zb) < e) {
        const x0 = Math.max(A.x0, B.x0), x1 = Math.min(A.x1, B.x1);
        if (x1 - x0 > 0.3) out.push({ a: A, b: B, x0, z0: za, x1, z1: za, axis: 'x' });
      }
    }
  }
  return out;
}

/** Length of the edge two rect rooms share (0 when they only touch at a corner or not at all). */
export function sharedEdgeLength(A, B, e = 0.02) {
  if (Math.abs(A.x1 - B.x0) < e || Math.abs(A.x0 - B.x1) < e) return Math.max(0, Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0));
  if (Math.abs(A.z1 - B.z0) < e || Math.abs(A.z0 - B.z1) < e) return Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0));
  return 0;
}

// preferred door targets when a door has to be re-routed (lower = better). Baths are never a
// passage (30): a room only reachable through a bath gets its own door from the common landing.
const DOOR_PREF = { hall: 0, corridor: 1, landing: 1, lobby: 2, living: 3, dining: 3, kitchen: 4, office: 5, bedroom: 5, classroom: 5, clinic: 5, shop: 6, storage: 7, bike: 8, bin: 8, plant: 8, bath: 30 };
const COMMON_KIND = new Set(['corridor', 'lobby', 'landing', 'hall']);
const NON_WALK = new Set(['lift', 'shaft']);
const SERVICE_KIND = new Set(['bike', 'storage', 'bin', 'plant']);

/** Rooms of one floor reachable from `roots` through doors (either side lists the other) and open links. */
export function reachableRooms(rooms, roots) {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const adj = new Map(rooms.map((r) => [r, []]));
  const link = (a, b) => { if (a && b && a !== b) { adj.get(a).push(b); adj.get(b).push(a); } };
  for (const r of rooms) {
    for (const dd of r.doors || []) link(r, byId.get(dd.to));
    for (const id of r.open || []) { const t = byId.get(id); if (t && sharedEdgeLength(r, t) > 0.6) link(r, t); }
  }
  const seen = new Set();
  const q = [];
  for (const r of roots) if (r && !seen.has(r)) { seen.add(r); q.push(r); }
  while (q.length) { const a = q.pop(); for (const b of adj.get(a) || []) if (!seen.has(b) && !NON_WALK.has(b.kind)) { seen.add(b); q.push(b); } }
  return seen;
}

/**
 * Make every room of one floor placeable AND reachable (called by `emitInterior` for every floor,
 * so all plan-based types get it; residentialPlan also runs it per floor before the windows are
 * derived). A door is valid when its two rooms share an edge ≥ width + `clear` (default 0.25 m);
 * invalid doors are dropped. Then every walkable room must be reachable from the floor's roots —
 * its stair rooms plus `o.roots` (rooms with a street / shop door) — through doors and open links;
 * unreached rooms get a door to the best adjacent reached room: the same unit first (hall ›
 * corridor › living › kitchen › bedroom …, never through a bath), else a common corridor /
 * landing / lobby (a unit room then gets its own door from the landing; service rooms may also
 * open onto the stair), never into another unit. The dropped door's target wins ties. Repeats
 * until nothing more can be connected. Typical fixes: a study in front of a core whose hall only
 * touches it at a corner, an en-suite bath behind a lift, an "open plan" living ↔ kitchen door
 * across a hall, a bath ↔ bedroom pair cut off from its flat.
 * @param {Room[]} rooms  rooms of one floor (mutated: room.doors)
 * @param {{clear?:number, roots?:Array<Room|string>}} [o]
 * @returns {Room[]} walkable rooms that are still unreachable (no adjacent candidate)
 */
export function repairDoors(rooms, o = {}) {
  const clear = o.clear ?? 0.25;
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const roots = rooms.filter((r) => r.kind === 'stair');
  for (const x of o.roots || []) { const r = typeof x === 'string' ? byId.get(x) : x; if (r && rooms.includes(r) && !roots.includes(r)) roots.push(r); }
  if (!roots.length) return repairDoorsLocal(rooms, o);
  // a door into a stair room above the lowest floor must meet its floor landing (stair.landing rect,
  // when the plan gives one): elsewhere the side wall of a stair room runs along a flight
  const clipR = (r, c) => ({ x0: Math.max(r.x0, c.x0), x1: Math.min(r.x1, c.x1), z0: Math.max(r.z0, c.z0), z1: Math.min(r.z1, c.z1) });
  const edge = (A, B) => {
    if (B.kind === 'stair' && B.landing && (B.floor ?? 0) > 0) return sharedEdgeLength(A, clipR(B, B.landing));
    if (A.kind === 'stair' && A.landing && (A.floor ?? 0) > 0) return sharedEdgeLength(clipR(A, A.landing), B);
    return sharedEdgeLength(A, B);
  };
  const ok = (A, B, w) => edge(A, B) >= (w || 0.9) + clear;
  // 1. drop the doors that cannot be cut; remember the first one per room as its wish
  const wish = new Map();
  for (const r of rooms) {
    if (!r.doors || !r.doors.length) continue;
    const valid = [];
    for (const dd of r.doors) {
      const t = byId.get(dd.to);
      if (!t || ok(r, t, dd.width)) valid.push(dd);
      else if (!wish.has(r)) wish.set(r, dd);
    }
    r.doors = valid;
  }
  // 2. connect unreached rooms one door at a time (globally best candidate first)
  const entry = new Set();      // units that already have a door from the common circulation
  const markEntries = () => {
    for (const r of rooms) {
      if (r.unit == null) continue;
      for (const dd of r.doors) { const t = byId.get(dd.to); if (t && t.unit == null && COMMON_KIND.has(t.kind)) entry.add(r.unit); }
      for (const t of rooms) if (t.unit == null && COMMON_KIND.has(t.kind) && t.doors.some((dd) => dd.to === r.id)) entry.add(r.unit);
    }
  };
  markEntries();
  for (let guard = 0; guard < rooms.length + 4; guard++) {
    const reached = reachableRooms(rooms, roots);
    let best = null, bs = 1e9;
    for (const u of rooms) {
      if (reached.has(u) || NON_WALK.has(u.kind)) continue;
      const minW = u.kind === 'bath' ? 0.7 : 0.8;
      const w0 = wish.get(u);
      for (const t of reached) {
        if (NON_WALK.has(t.kind)) continue;
        const L = sharedEdgeLength(u, t);
        if (L < minW + clear) continue;
        const same = u.unit != null && t.unit === u.unit;
        const tCommon = t.unit == null;
        let sc;
        if (t.kind === 'stair') {
          // a door in the side wall of a stair room lands on a flight, except on the lowest floor
          // where the stair column has a floor to the back wall (bike store / riser beside a core)
          if (!(u.unit == null && (SERVICE_KIND.has(u.kind) || COMMON_KIND.has(u.kind)) && (u.floor ?? 0) === 0)) continue;
          sc = 12;
        } else if (same) {
          sc = DOOR_PREF[t.kind] ?? 6;
          if (u.kind === 'bath' && (t.kind === 'kitchen' || t.kind === 'living' || t.kind === 'dining')) sc += 3;
        } else if (tCommon && COMMON_KIND.has(t.kind)) {
          // a unit room opening onto the common landing: its flat's entry, or a second door
          sc = u.unit == null ? 2 + (DOOR_PREF[t.kind] ?? 2) : (entry.has(u.unit) ? 16 : 10) + (DOOR_PREF[t.kind] ?? 2);
        } else if (tCommon && u.unit == null) sc = 14 + (DOOR_PREF[t.kind] ?? 6);
        else continue;                                   // never into another unit
        if (w0 && w0.to === t.id) sc -= 2;
        sc -= Math.min(L, 4) * 0.05;
        if (sc < bs) { bs = sc; best = [u, t, L]; }
      }
    }
    if (!best) break;
    const [u, t, L] = best;
    const w0 = wish.get(u) || {};
    const def = u.kind === 'bath' || t.kind === 'bath' ? 0.8 : 0.9;
    const apt = u.unit != null && t.unit == null && COMMON_KIND.has(t.kind);
    u.doors.push({ ...w0, to: t.id, at: undefined, pos: undefined, width: Math.max(0.7, Math.min(w0.width || (apt ? 1.0 : def), L - clear)), ...(apt ? { kind: 'apartment' } : {}) });
    if (apt) entry.add(u.unit);
  }
  const reached = reachableRooms(rooms, roots);
  return rooms.filter((r) => !reached.has(r) && !NON_WALK.has(r.kind));
}

/** Legacy per-room repair (floors without a stair or street door to start from). */
function repairDoorsLocal(rooms, o = {}) {
  const clear = o.clear ?? 0.25;
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const ok = (A, B, w) => sharedEdgeLength(A, B) >= (w || 0.9) + clear;
  const lonely = [];
  for (const r of rooms) {
    if (!r.doors || !r.doors.length) continue;
    const valid = [], invalid = [];
    for (const dd of r.doors) {
      const t = byId.get(dd.to);
      if (!t || ok(r, t, dd.width)) valid.push(dd); else invalid.push(dd);
    }
    if (!invalid.length) continue;
    r.doors = valid;
    const reachable = valid.length > 0 || rooms.some((q) => q !== r && q.doors.some((dd) => dd.to === r.id && ok(q, r, dd.width)));
    if (reachable) continue;
    const dd = invalid[0];
    const minW = r.kind === 'bath' ? 0.7 : 0.8;
    let best = null, bs = 1e9;
    for (const t of rooms) {
      if (t === r || t.kind === 'lift' || t.kind === 'shaft') continue;
      if (t.kind === 'stair' && r.kind !== 'corridor' && r.kind !== 'lobby' && r.kind !== 'landing' && r.kind !== 'bike' && r.kind !== 'storage') continue;
      const L = sharedEdgeLength(r, t);
      if (L < minW + clear) continue;
      const same = t.unit != null && t.unit === r.unit;
      const common = t.unit == null && (t.kind === 'corridor' || t.kind === 'lobby' || t.kind === 'landing' || t.kind === 'hall');
      if (!same && !common) continue;
      let sc = (DOOR_PREF[t.kind] ?? 6) + (same ? 0 : 10) - Math.min(L, 4) * 0.05;
      if (r.kind === 'bath' && (t.kind === 'kitchen' || t.kind === 'living')) sc += 3;   // baths open to halls / bedrooms
      if (sc < bs) { bs = sc; best = t; }
    }
    if (best) r.doors.push({ ...dd, to: best.id, at: undefined, width: Math.min(dd.width || 0.9, sharedEdgeLength(r, best) - clear) });
    else { r.doors = invalid.concat(valid); lonely.push(r); }
  }
  return lonely;
}

/** Are rooms a and b connected by a door (either side lists the other)? */
export function connected(a, b) {
  return a.doors.some((dd) => dd.to === b.id) || b.doors.some((dd) => dd.to === a.id);
}
/** Open connection (no wall): open-plan living/kitchen etc. */
export function openTo(a, b) { return a.open.includes(b.id) || b.open.includes(a.id); }
