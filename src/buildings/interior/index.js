// Interiors for the 'full' LOD: room floors & ceilings, partitions with door openings and
// (open) doors, stair cores and lift shafts, furniture per room kind, emissive ceiling panels
// gated by the same occupancy ids as the room's windows, lobby mailbox walls, colliders
// (floors, walls with door gaps, stair ramps). Driven entirely by the PlanModel (kit/plan.js).

import { sharedEdges, connected, openTo, roomFacades, kindCode, repairDoors } from '../kit/plan.js';
import { wallWithOpenings } from '../kit/walls.js';
import { doorUnit } from '../kit/doors.js';
import { stairFlights, stairTop, liftStorey } from '../kit/stairs.js';
import { stairFrame } from '../kit/cores.js';
import { mailboxWall } from '../kit/site.js';
import { ladder } from '../kit/roof.js';
import { furnishRoom } from './rooms.js';
import * as F from './furniture.js';
import { hash4 } from '../../core/hash.js';
import { facadePoint, facadeNormal } from '../kit/walls.js';

const FLOOR_KEY = { living: 'wood_floor', bedroom: 'wood_floor', kitchen: 'tile_floor', bath: 'tile_floor', hall: 'wood_floor', corridor: 'tile_floor', lobby: 'stone_floor', stair: 'stone_floor', shop: 'tile_floor', office: 'wood_floor', classroom: 'wood_floor', clinic: 'tile_floor', storage: 'concrete', plant: 'concrete', bike: 'concrete', bin: 'concrete' };
const PAINT = [[0.95, 0.94, 0.9], [0.93, 0.9, 0.84], [0.88, 0.91, 0.92], [0.92, 0.88, 0.86], [0.86, 0.9, 0.86], [0.97, 0.96, 0.95]];

/** Paint tint of a room (stable per building + room). */
export function roomPaint(s, r) {
  if (r.kind === 'bath' || r.kind === 'kitchen') return [0.97, 0.97, 0.96];
  if (r.kind === 'stair' || r.kind === 'corridor' || r.kind === 'lobby') return [0.93, 0.93, 0.91];
  return PAINT[hash4(s.hash, r.unit ?? 0, r.kind.length, 3) % PAINT.length];
}

/**
 * @param {object} ctx  generation context (lod 'full')
 * @param {object} plan PlanModel after emitFacades (openings carry light ids)
 * @param {object} [o]  {furnish=true, repairDoors=true (kit/plan.js repairDoors per floor)}
 */
export function emitInterior(ctx, plan, o = {}) {
  const b = ctx.b, s = ctx.spec;
  const T = plan.wallT, slab = plan.slabT;
  const nF = plan.floors.length;
  // light ids per room from its windows
  const lightOf = new Map();
  for (const op of plan.allOpenings || []) if (op.room && op.light && !lightOf.has(op.room)) lightOf.set(op.room, op.light);
  // exterior wall colliders per floor (with gaps at doors)
  for (let fi = 0; fi < nF; fi++) {
    const f = plan.floors[fi];
    const ceil = f.y + f.h - slab;
    const rect = rectOfFloor(plan, f);
    // doors: every door cuttable and every room reachable from the stairs / street doors
    // (kit/plan.js repairDoors) before the daylight borrowing and the partitions read them
    if (o.repairDoors !== false) {
      const roots = [];
      for (const op of plan.allOpenings || []) if (op.room && (op.kind === 'door' || (op.kind === 'shop' && op.door)) && Math.abs(op.v0 - f.y) < 0.35 && f.rooms.includes(op.room)) roots.push(op.room);
      for (const e of plan.entrances || []) if (e.room && f.rooms.includes(e.room)) roots.push(e.room);
      const lonely = repairDoors(f.rooms, { roots });
      if (lonely.length) b.meta.unreachableRooms = (b.meta.unreachableRooms || 0) + lonely.length;
    }
    // daylight falloff from the windows: per-vertex 'idl' on indoor surfaces of each room
    const dl = daylight(plan, f);
    if (b.collecting) {
      // floor slab collider for the whole floor (stair well excluded by rooms)
      for (const r of f.rooms) if (r.kind !== 'stair' && r.kind !== 'lift') b.colQuad(r.x0, f.y, r.z1, r.x1, f.y, r.z1, r.x1, f.y, r.z0, r.x0, f.y, r.z0);
      exteriorWallColliders(b, plan, f, rect);
    }
    // ---- floors & ceilings ----
    for (const r of f.rooms) {
      if (r.kind === 'lift') continue;
      const ix0 = r.x0 + (Math.abs(r.x0 - rect.x0) < 0.02 ? T : 0.05), ix1 = r.x1 - (Math.abs(r.x1 - rect.x1) < 0.02 ? T : 0.05);
      const iz0 = r.z0 + (Math.abs(r.z0 - rect.z0) < 0.02 ? T : 0.05), iz1 = r.z1 - (Math.abs(r.z1 - rect.z1) < 0.02 ? T : 0.05);
      r._in = { x0: ix0, x1: ix1, z0: iz0, z1: iz1 };
      if (r.kind === 'stair') continue; // stair handles its landings
      b.setExtraFn('idl', dl(r));
      // floor + ceiling on a ≤ 1.5 m grid so the daylight falloff from the windows is resolved
      gridY(b, FLOOR_KEY[r.kind] || 'wood_floor', ix0, iz0, ix1, iz1, f.y, 1);
      b.withTint([0.97, 0.97, 0.96], () => gridY(b, 'plaster', ix0, iz0, ix1, iz1, ceil, -1));
      // skirting
      b.withTint([0.9, 0.9, 0.88], () => {
        b.box('wood', ix0, f.y, iz0, ix1, f.y + 0.08, iz0 + 0.012, PZf);
        b.box('wood', ix0, f.y, iz1 - 0.012, ix1, f.y + 0.08, iz1, NZf);
        b.box('wood', ix0, f.y, iz0, ix0 + 0.012, f.y + 0.08, iz1, PXf);
        b.box('wood', ix1 - 0.012, f.y, iz0, ix1, f.y + 0.08, iz1, NXf);
      });
      // ceiling light panels gated by the room's window occupancy
      const L = lightOf.get(r);
      const kind = kindCode(r.kind);
      b.setExtra('iwin1', 0, 0.5, L ? L.floor : f.level, L ? L.bay : 1000 + (hash4(s.hash, fi, Math.round(r.x0 * 10), Math.round(r.z0 * 10)) % 500));
      b.setExtra('iwin2', (s.hash >>> 16) & 0xffff, s.hash & 0xffff, kind, s._profile | 0);
      const cw = ix1 - ix0, cd = iz1 - iz0;
      const nx = Math.max(1, Math.round(cw / 3.2)), nz = Math.max(1, Math.round(cd / 3.2));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const cx = ix0 + (cw * (i + 0.5)) / nx, cz = iz0 + (cd * (j + 0.5)) / nz;
        const pw = r.kind === 'corridor' || r.kind === 'hall' ? 0.25 : 0.55;
        b.box('light_panel', cx - pw / 2, ceil - 0.025, cz - pw / 2, cx + pw / 2, ceil - 0.001, cz + pw / 2, NYf | PXf | NXf | PZf | NZf);
      }
    }
    // ---- partitions ----
    const edges = sharedEdges(f.rooms);
    for (const e of edges) {
      const A = e.a, B = e.b;
      if (openTo(A, B)) continue;
      if ((A.kind === 'lift' || B.kind === 'lift')) continue; // lift shafts draw their own walls
      const heavy = A.kind === 'stair' || B.kind === 'stair' || (A.unit !== B.unit && A.unit != null && B.unit != null);
      const t = heavy ? 0.2 : 0.1;
      const door = connected(A, B);
      // frame: along the segment, normal pointing into A's side
      let ox, oz, ux, uz, nx, nz, L;
      if (e.axis === 'z') { // x const, along z
        L = e.z1 - e.z0;
        const aLeft = (A.x0 + A.x1) / 2 < e.x0; // A on −x side
        // normal towards +x (B side if A left); choose normal towards A so 'outer' face is A's
        if (aLeft) { ox = e.x0 - t / 2; oz = e.z0; ux = 0; uz = 1; nx = -1; nz = 0; }
        else { ox = e.x0 + t / 2; oz = e.z1; ux = 0; uz = -1; nx = 1; nz = 0; }
      } else {
        L = e.x1 - e.x0;
        const aBack = (A.z0 + A.z1) / 2 < e.z0;
        if (aBack) { ox = e.x1; oz = e.z0 - t / 2; ux = -1; uz = 0; nx = 0; nz = -1; }
        else { ox = e.x0; oz = e.z0 + t / 2; ux = 1; uz = 0; nx = 0; nz = 1; }
      }
      // wall local frame: x along u, y up, z = normal (towards A); outer face at z=0 → move origin so wall spans z∈[−t,0] centred on the edge
      b.push();
      b.frame(ox, 0, oz, ux, 0, uz, 0, 1, 0, nx, 0, nz);
      const ops = [];
      if (door) {
        const dd = (A.doors.find((x) => x.to === B.id) || B.doors.find((x) => x.to === A.id) || {});
        // usable span of the partition: an end that meets an exterior wall loses the wall thickness
        // (room rects run to the outer face), so doors never sink into the facade wall
        const atRect = (x, z) => Math.abs(x - rect.x0) < 0.03 || Math.abs(x - rect.x1) < 0.03 || Math.abs(z - rect.z0) < 0.03 || Math.abs(z - rect.z1) < 0.03;
        const pu = (u) => (e.axis === 'z' ? [e.x0, oz + uz * u] : [ox + ux * u, e.z0]);
        const m0 = atRect(...pu(0)) ? T + 0.04 : 0.06, m1 = atRect(...pu(L)) ? T + 0.04 : 0.06;
        const span = Math.max(0.5, L - m0 - m1);
        const dw = Math.min(dd.width || (A.kind === 'bath' || B.kind === 'bath' ? 0.8 : 0.9), span - 0.2);
        // dd.at: metres along this partition frame; dd.pos: [x, z] plan point the door centre should
        // sit nearest to (frame-independent, e.g. a door at the floor-landing end of a stair room)
        const at = dd.at != null ? dd.at : dd.pos ? (e.axis === 'z' ? Math.abs(dd.pos[1] - oz) : Math.abs(dd.pos[0] - ox)) : (span > 2.6 ? m0 + 0.25 + dw / 2 : m0 + span / 2);
        const u0 = Math.max(m0 + 0.06, Math.min(L - m1 - dw - 0.06, at - dw / 2));
        ops.push({ u0, u1: u0 + dw, v0: f.y, v1: f.y + 2.1, reveal: t, chamfer: 0, noSillReveal: true });
        // actual door span in plan coordinates (furnishRoom keeps it and its swing clear)
        const pA = [ox + ux * u0, oz + uz * u0], pB = [ox + ux * (u0 + dw), oz + uz * (u0 + dw)];
        (A._doorSpans || (A._doorSpans = [])).push([pA, pB]); (B._doorSpans || (B._doorSpans = [])).push([pA, pB]);
      }
      b.pushTint(roomPaint(s, A));
      b.setExtraFn('idl', dl(A));
      wallWithOpenings(b, { L, y0: f.y, y1: ceil, T: t, openings: ops.map((p) => ({ ...p, reveal: t })), outer: 'plaster', inner: null });
      b.popTint();
      // inner face (B side) with B's paint
      b.pushTint(roomPaint(s, B));
      b.setExtraFn('idl', dl(B));
      b.push(); b.translate(L, 0, -t); b.rotY(Math.PI);
      wallWithOpenings(b, { L, y0: f.y, y1: ceil, T: 0.001, openings: ops.map((p) => ({ u0: L - p.u1, u1: L - p.u0, v0: p.v0, v1: p.v1, reveal: 0.0005, chamfer: 0, noSillReveal: true })), outer: 'plaster', inner: null });
      b.pop();
      b.popTint();
      // door units (the reveals through the wall thickness come from wallWithOpenings, reveal = t;
      // a second set here was coplanar with them); the interior door unit is centred on z = 0, the
      // wall spans z ∈ [−t, 0] → shift it onto the wall's centre plane (frame and architraves sat
      // t/2 towards room A, one architrave buried in the wall, QQ-02 audit)
      b.setExtraFn('idl', dl(A));
      for (const p of ops) {
        // wallWithOpenings stops its reveals 2 cm short of the far face (R ≤ T − 0.02): close that strip
        const Rr = t - 0.02;
        b.rectX('plaster', -t, p.v0, -Rr, p.v1, p.u0, 1); b.rectX('plaster', -t, p.v0, -Rr, p.v1, p.u1, -1); b.rectY('plaster', p.u0, -t, p.u1, -Rr, p.v1, -1);
        const stairDoor = A.kind === 'stair' || B.kind === 'stair';
        const kind = (A.kind === 'corridor' || B.kind === 'corridor' || A.kind === 'lobby' || B.kind === 'lobby') && (A.unit != null || B.unit != null) ? 'apartment' : 'interior';
        b.push(); if (kind === 'interior') b.translate(0, 0, -t / 2);
        doorUnit(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: 0, T: t, kind, open: stairDoor ? 0.95 : 0.85, hinge: 'left', inward: true });
        b.pop();
      }
      if (b.collecting) {
        let u = 0;
        for (const p of ops) { if (p.u0 > u) b.colBox(u, f.y, -t, p.u0, ceil, 0); u = p.u1; b.colBox(p.u0, p.v1, -t, p.u1, ceil, 0); }
        if (L > u) b.colBox(u, f.y, -t, L, ceil, 0);
      }
      b.pop();
    }
    // ---- stairs & lifts (every core: wide blocks have one per 一梯两户 group) ----
    b.setExtraFn('idl', dl(f.rooms.find((r) => r.kind === 'stair') || null));
    for (const core of plan.cores && plan.cores.length ? plan.cores : plan.core ? [plan.core] : []) {
      const st = core.stair;
      // the last flight climbs into a stair house wherever emitRoof built one (plan.roof.stairHouse,
      // set by emitRoof — also podiums / towers with < 4 storeys that pass opts.stairHouse)
      const lastWithStairHouse = fi === nF - 1 && (plan.roof && plan.roof.stairHouse != null ? !!plan.roof.stairHouse : nF >= 4);
      const top = fi === nF - 1 && !lastWithStairHouse;
      b.push();
      const SF = stairFrame(st);
      b.frame(SF.ox, f.y, SF.oz, SF.ax[0], 0, SF.ax[1], 0, 1, 0, SF.az[0], 0, SF.az[1]);
      const W = SF.W, Lz = SF.Lz;
      const xin = 0.12; // inside the stair walls
      b.push(); b.translate(xin, 0, 0);
      const rise = fi === nF - 1 ? (lastWithStairHouse ? plan.roof.y - f.y : f.h) : f.h;
      if (top && plan.house) stairTop(b, { W: W - 2 * xin, Lz: Lz - 0.02, landD: st.landD, slabT: slab });
      else stairFlights(b, { W: W - 2 * xin, Lz: Lz - 0.02, landD: st.landD, halfD: st.halfD, rise, top, key: 'stone_floor', split: fi === 0 && core.groundSplit && core.split0 ? core.split0 : null });
      b.pop();
      // roof-level floor landing inside the stair house: the last flight arrives at the roof level and
      // the walker crosses this landing to the stair-house door (the roof deck leaves the well open)
      if (lastWithStairHouse) {
        b.rectY('stone_floor', 0.1, 0, W - 0.1, st.landD + 0.02, rise, 1);
        b.withTint([0.95, 0.95, 0.93], () => {
          b.rectY('plaster', 0.1, 0, W - 0.1, st.landD + 0.02, rise - slab, -1);
          const fwB = Math.min(1.25, (W - 2 * xin - 0.12) / 2);
          b.rectZ('plaster', 0.1, rise - slab, W - xin - fwB - 0.02, rise, st.landD + 0.02, 1);
        });
        if (b.collecting) b.colQuad(0, rise, st.landD + 0.03, W, rise, st.landD + 0.03, W, rise, -0.3, 0, rise, -0.3);
      }
      // floor landing slab (+ its plastered soffit and well-side edge above the floor below); on the
      // lowest floor the stair column has a floor all the way to the back wall (the passage under
      // the half landing to the service door, the door into the bike store)
      const landEnd = fi === 0 ? Lz : st.landD + 0.02;
      b.rectY('stone_floor', 0.1, 0, W - 0.1, landEnd, 0.0, 1);
      if (fi > 0) b.withTint([0.95, 0.95, 0.93], () => {
        b.rectY('plaster', 0.1, 0, W - 0.1, st.landD + 0.02, -slab, -1);
        // edge only where no flight arrives (the arriving flight B covers its own side)
        const fwB = Math.min(1.25, (W - 2 * xin - 0.12) / 2);
        b.rectZ('plaster', 0.1, -slab, W - xin - fwB - 0.02, 0.0, st.landD + 0.02, 1);
      });
      if (b.collecting) b.colQuad(0, 0, landEnd + 0.03, W, 0, landEnd + 0.03, W, 0, 0, 0, 0, 0);
      if (top && fi === nF - 1 && !plan.house) ladder(b, W * 0.5, 0, Lz - 0.6, f.h - slab + 0.3, Math.PI);
      b.pop();
      // ceiling over the stair column where no stair house continues above (building frame)
      if (top) b.withTint([0.97, 0.97, 0.96], () => b.rectY('plaster', st.x0 + 0.12, st.z0 + 0.05, st.x1 - 0.12, st.z1 - 0.05, f.y + f.h - slab, -1));
      if (core.lift && fi < nF) {
        const l = core.lift;
        b.push();
        if (l.door === '+z') b.frame(l.x0, f.y, l.z0, 1, 0, 0, 0, 1, 0, 0, 0, 1);
        else b.frame(l.x1, f.y, l.z1, -1, 0, 0, 0, 1, 0, 0, 0, -1);
        liftStorey(b, { W: l.x1 - l.x0, D: l.z1 - l.z0, h: f.h, key: 'ceramic_grey', doorKey: 'steel_brushed' });
        b.pop();
      }
    }
    // ---- furniture ----
    if (o.furnish !== false) {
      for (const r of f.rooms) {
        if (!r._in) continue;
        b.setExtraFn('idl', dl(r));
        furnishRoom(ctx, plan, f, r, edges);
      }
    }
    // ---- lobby: mailbox wall (housing) or reception desk + directory board (public uses) on the
    // lobby's side wall (x0 side, facing +x) — QY-02: no residential mailboxes in clinics / offices ----
    if (fi === 0 && plan.lobby) {
      const housing = o.mailboxes ?? HOUSING_USES.has(s.use);
      for (const lob of f.rooms) {
        if (lob.kind !== 'lobby' || !lob._in) continue;
        b.setExtraFn('idl', dl(lob));
        const I = lob._in;
        const len = I.z1 - I.z0;
        if (len <= 2.2) continue;
        b.push(); b.frame(I.x0, 0, I.z1, 0, 0, -1, 0, 1, 0, 1, 0, 0);
        if (housing) {
          const cols = Math.max(3, Math.min(8, Math.floor((len - 1.6) / 0.3)));
          mailboxWall(b, Math.min(len - cols * 0.15 - 0.5, Math.max(cols * 0.15 + 0.5, len * 0.42)), f.y + 1.0, { cols, rows: 4 });
        } else {
          const u = Math.min(len - 1.0, Math.max(1.0, len * 0.42));
          directoryBoard(b, u, f.y);
          if (I.x1 - I.x0 > 2.6 && len > 3.4) { b.push(); b.translate(Math.min(len - 1.1, u + 1.6), f.y, 0.35); F.receptionDesk(b); b.pop(); }
        }
        b.pop();
      }
    }
    b.setExtraFn('idl', null);
  }
}

const PXf = 1, NXf = 2, PYf = 4, NYf = 8, PZf = 16, NZf = 32;
/** Uses whose lobby gets a residents' mailbox wall (others: reception desk + directory board). */
export const HOUSING_USES = new Set(['residential', 'residential_tower', 'shop_row', 'dorm']);

/** Wall-mounted directory / wayfinding board (current wall frame: u along the wall, z out of it). */
function directoryBoard(b, u, y) {
  const w = 1.2, h = 1.5, y0 = y + 0.9;
  b.cbox('aluminium_dark', u - w / 2, y0, 0, u + w / 2, y0 + h, 0.05, 0.008);
  b.box('black', u - w / 2 + 0.05, y0 + 0.05, 0.05, u + w / 2 - 0.05, y0 + h - 0.05, 0.052, PZf);
  // backlit header + entry rows (night-gated light panel strips)
  b.box('light_panel', u - w / 2 + 0.08, y0 + h - 0.22, 0.052, u + w / 2 - 0.08, y0 + h - 0.1, 0.055, PZf);
  for (let k = 0; k < 6; k++) { const yy = y0 + 0.2 + k * 0.17; b.box('steel_brushed', u - w / 2 + 0.12, yy, 0.052, u - w / 2 + 0.12 + 0.55 + ((k * 37) % 5) * 0.06, yy + 0.035, 0.054, PZf); }
}

/** Horizontal rect as a grid of ≤ 1.5 m cells (per-vertex daylight needs vertices inside the room). */
function gridY(b, key, x0, z0, x1, z1, y, facing) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / 1.5)), nz = Math.max(1, Math.ceil((z1 - z0) / 1.5));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    b.rectY(key, x0 + ((x1 - x0) * i) / nx, z0 + ((z1 - z0) * j) / nz, x0 + ((x1 - x0) * (i + 1)) / nx, z0 + ((z1 - z0) * (j + 1)) / nz, y, facing);
  }
}

/**
 * Daylight from the windows of a storey: dl(room) → per-vertex writer for the 'idl' attribute
 * (MeshBuilder.setExtraFn) = fraction of the outdoor sky irradiance reaching an indoor surface
 * (0.2 deep inside, 0.32 in lit common areas … ≈ 0.9 at the glass): Σ over the room's windows of the window's solid angle
 * seen from the vertex (area · cos at the pane / (π d² + area), surfaces turned to the window get more).
 * Rooms without windows (halls, baths, corridors) borrow the windows of the rooms they open to at 35 %.
 */
function daylight(plan, f) {
  const own = new Map();
  for (const op of plan.allOpenings || []) {
    if (!op.room || op.kind === 'vent') continue;
    const y0 = Math.max(op.v0, f.y), y1 = Math.min(op.v1, f.y + f.h);
    if (y1 - y0 < 0.3) continue;
    const u = (op.u0 + op.u1) / 2, c = facadePoint(op.side, plan.w, plan.d, u, (y0 + y1) / 2, 0), n = facadeNormal(op.side);
    const A = (op.u1 - op.u0) * (y1 - y0) * (op.kind === 'small' ? 0.4 : op.kind === 'door' ? 0.6 : 1);
    if (!own.has(op.room)) own.set(op.room, []);
    own.get(op.room).push([c[0], c[1], c[2], n[0], n[2], A, 1]);
  }
  const cache = new Map();
  return (r) => {
    if (!r) return null;
    if (cache.has(r)) return cache.get(r);
    let wins = own.get(r) || [];
    if (!wins.length) {
      for (const q of f.rooms) {
        if (q === r || !own.has(q)) continue;
        const linked = (r.doors || []).some((d) => d.to === q.id) || (q.doors || []).some((d) => d.to === r.id) || (r.open || []).includes(q.id) || (q.open || []).includes(r.id);
        if (linked) wins = wins.concat(own.get(q).map((w) => [w[0], w[1], w[2], w[3], w[4], w[5], 0.35]));
      }
    }
    // floor level: borrowed / electric light — common areas (stair, lobby, corridor, hall) stay lit
    const base = r.kind === 'stair' || r.kind === 'lobby' || r.kind === 'corridor' || r.kind === 'hall' ? 0.32 : 0.2;
    const fn = (X, Y, Z, NX, NY, NZ, d, o) => {
      let sum = 0;
      for (let k = 0; k < wins.length; k++) {
        const w = wins[k];
        const dx = X - w[0], dy = Y - w[1], dz = Z - w[2];
        const into = -(dx * w[3] + dz * w[4]);           // depth behind the window plane
        if (into < -0.05) continue;
        const d2 = dx * dx + dy * dy + dz * dz + 0.04, dd = Math.sqrt(d2);
        const cw = Math.max(0.05, into) / dd;
        const cs = -(NX * dx + NY * dy + NZ * dz) / dd;  // surface turned towards the window
        sum += w[6] * w[5] * cw * (0.55 + 0.45 * Math.max(0, cs)) / (Math.PI * d2 + w[5]);
      }
      d[o] = base + 0.72 * (1 - Math.exp(-3.0 * sum));
    };
    cache.set(r, fn);
    return fn;
  };
}

function rectOfFloor(plan, f) {
  const w = plan.w, d = plan.d, I = f.inset || {};
  return { x0: -w / 2 + (I.left || 0), x1: w / 2 - (I.right || 0), z0: -d / 2 + (I.back || 0), z1: d / 2 - (I.front || 0) };
}

function exteriorWallColliders(b, plan, f, rect) {
  const T = plan.wallT, y0 = f.y, y1 = f.y + f.h;
  const doors = (plan.allOpenings || []).filter((o) => (o.kind === 'door' || o.kind === 'slider' || (o.kind === 'shop' && o.door)) && o.v0 < y0 + 0.3 && o.v0 > y0 - 0.3);
  const runs = [
    ['front', rect.x0, rect.x1, (u) => [u - plan.w / 2], (a, c) => b.colBox(a, y0, rect.z1 - T, c, y1, rect.z1)],
    ['back', rect.x0, rect.x1, null, (a, c) => b.colBox(a, y0, rect.z0, c, y1, rect.z0 + T)],
    ['right', rect.z0, rect.z1, null, (a, c) => b.colBox(rect.x1 - T, y0, a, rect.x1, y1, c)],
    ['left', rect.z0, rect.z1, null, (a, c) => b.colBox(rect.x0, y0, a, rect.x0 + T, y1, c)],
  ];
  for (const [side, a0, a1, , emit] of runs) {
    // convert door u-ranges on this side to plan coordinate ranges
    const gaps = [];
    for (const o of doors) {
      if (o.side !== side) continue;
      let p0, p1;
      if (side === 'front') { p0 = o.u0 - plan.w / 2; p1 = o.u1 - plan.w / 2; }
      else if (side === 'back') { p0 = plan.w / 2 - o.u1; p1 = plan.w / 2 - o.u0; }
      else if (side === 'right') { p0 = plan.d / 2 - o.u1; p1 = plan.d / 2 - o.u0; }
      else { p0 = o.u0 - plan.d / 2; p1 = o.u1 - plan.d / 2; }
      gaps.push([p0, p1]);
    }
    gaps.sort((p, q) => p[0] - q[0]);
    let a = a0;
    for (const g of gaps) { if (g[0] > a) emit(a, g[0]); a = Math.max(a, g[1]); }
    if (a1 > a) emit(a, a1);
  }
}

export { roomFacades };
