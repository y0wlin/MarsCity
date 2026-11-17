// Generic building type: the fallback for every BuildingSpec.use without its own type file.
// Plan-first like the others (core + rooms → facades), so even a placeholder clinic or depot
// has real window reveals, an entrance with steps/ramp/canopy, a service door, a roof with
// parapets/equipment, a walkable stair at 'full' — just less specific than a dedicated type.
// Other types can reuse genericPlan() / assembleAll() as a starting point.

import { coreLayout } from '../kit/cores.js';
import { room, resetRoomIds, deriveOpenings } from '../kit/plan.js';
import { emitFacades, emitBands, emitRoof, emitBase, emitAnchors } from '../kit/assemble.js';
import { emitInterior } from '../interior/index.js';
import { bayCount } from '../kit/math.js';
import { defaultMassing } from '../kit/mass.js';

const PUBLIC = new Set(['clinic', 'school', 'market', 'station', 'ferry_terminal', 'research', 'office', 'civic_tower', 'community', 'warehouse', 'port_shed', 'pumphouse', 'sluice_station', 'greenhouse', 'control_tower', 'maintenance', 'cold_storage', 'farm_station', 'water_treatment', 'service_depot', 'insulated_station', 'meltwater_pump']);

/** Storey heights for a spec + style. */
export function storeys(ctx) {
  const s = ctx.spec, st = ctx.style;
  const pub = PUBLIC.has(s.use);
  const fh = s.floorHeight ? s._fh : pub ? 4.2 : st.storeyH;
  const gh = s._gh || (pub ? Math.max(4.5, fh) : Math.max(st.groundH, fh));
  return { fh, gh, pub };
}

/**
 * Simple plan: central stair/lift core against the back wall, lobby on the street side,
 * rooms ('office' or opts.kind) left/right by bays. Returns a PlanModel.
 */
export function genericPlan(ctx, opts = {}) {
  resetRoomIds();
  const s = ctx.spec, st = ctx.style;
  const w = s._w, d = s._d, T = st.wallT;
  const { fh, gh } = storeys(ctx);
  const ffl = opts.ffl ?? (st.id === 'zr_cold' ? 0.45 : 0.3);
  const nF = s._floors;
  const floors = [];
  let y = ffl;
  for (let i = 0; i < nF; i++) { const h = i === 0 ? gh : fh; floors.push({ level: i, y, h, rooms: [], openings: [], inset: {} }); y += h; }
  const plan = { w, d, ffl, wallT: T, slabT: 0.22, floors, roof: { y, parapet: 1.1, kind: 'flat' }, shared: s._shared, entrances: [], extraOpenings: [], shafts: [], bayW: (w / bayCount(w)) };
  // core
  const maxRise = Math.max(gh, fh);
  const canCore = d - 2 * T > 7.2 && w > 9;
  let core = null;
  if (canCore) {
    core = coreLayout({ cx: opts.coreX ?? 0, zBack: -d / 2 + T, towards: 1, maxRise, lift: nF >= 3, liftSide: 1, landingDepth: 1.8 });
    if (core.landing.z1 > d / 2 - T - 2.0 || core.x0 < -w / 2 + T + 2 || core.x1 > w / 2 - T - 2) core = null;
  }
  plan.core = core;
  const kind = opts.kind || 'office';
  for (const f of floors) {
    const rooms = f.rooms;
    if (core) {
      const stair = room('stair', core.stair.x0, core.stair.x1, -d / 2, core.stair.z1, { floor: f.level, name: 'stair' });
      rooms.push(stair);
      let lift = null;
      if (core.lift) { lift = room('lift', core.lift.x0, core.lift.x1, core.lift.z0, core.lift.z1, { floor: f.level }); rooms.push(lift); }
      // back strip behind the lift (duct/storage)
      if (core.lift && core.lift.z0 > -d / 2 + 0.6) rooms.push(room('storage', core.lift.x0, core.lift.x1, -d / 2, core.lift.z0, { floor: f.level, name: 'riser', extra: { noWindows: true } }));
      const front = room(f.level === 0 ? 'lobby' : 'corridor', core.x0, core.x1, core.landing.z0, d / 2, { floor: f.level, name: f.level === 0 ? 'lobby' : 'landing' });
      rooms.push(front);
      stair.doors.push({ to: front.id, width: 1.0 });
      // left / right zones
      for (const [x0, x1] of [[-w / 2, core.x0], [core.x1, w / 2]]) {
        const zw = x1 - x0; if (zw < 1.5) continue;
        const n = Math.max(1, Math.round(zw / 7.5));
        for (let i = 0; i < n; i++) {
          const a = x0 + (zw * i) / n, c = x0 + (zw * (i + 1)) / n;
          const r = room(f.level === 0 && opts.groundKind ? opts.groundKind : kind, a, c, -d / 2, d / 2, { floor: f.level });
          rooms.push(r);
          if ((x0 < 0 && i === n - 1) || (x0 > 0 && i === 0)) r.doors.push({ to: front.id, width: 0.9 });
          else r.doors.push({ to: rooms[rooms.length - 2].id, width: 0.9 });
        }
      }
    } else {
      // no core: one or two rooms, external access
      const n = Math.max(1, Math.round(w / 8));
      for (let i = 0; i < n; i++) rooms.push(room(i === 0 && f.level === 0 ? 'lobby' : kind, -w / 2 + (w * i) / n, -w / 2 + (w * (i + 1)) / n, -d / 2, d / 2, { floor: f.level }));
      for (let i = 1; i < rooms.length; i++) rooms[i].doors.push({ to: rooms[i - 1].id });
    }
    const rng = ctx.sub(200, f.level);
    f.openings = deriveOpenings(rooms.filter((r) => !(f.level === 0 && r.kind === 'lobby')), { w, d, y: f.y, h: f.h, rng, style: st, inst: ctx.inst, floor: f.level, slabT: plan.slabT, balconySides: {}, blank: s._shared, bayW: plan.bayW });
  }
  // entrances
  const lob = floors[0].rooms.find((r) => r.kind === 'lobby');
  const mainU = lob ? (lob.x0 + lob.x1) / 2 + w / 2 : w / 2;
  const dw = 1.8;
  plan.entrances.push({ kind: 'main', side: 'front', u0: mainU - dw / 2, u1: mainU + dw / 2, v1: ffl + 2.4 });
  plan.extraOpenings.push({ side: 'front', u0: mainU - dw / 2, u1: mainU + dw / 2, v0: ffl, v1: ffl + 2.4, kind: 'door', doorKind: 'glazed_double', floor: 0, room: lob, vestibule: st.coveredEntry });
  if (lob) {
    // glazed side lights either side of the entrance
    for (const sgn of [-1, 1]) {
      const a = sgn < 0 ? lob.x0 + w / 2 + 0.45 : mainU + dw / 2 + 0.35, c = sgn < 0 ? mainU - dw / 2 - 0.35 : lob.x1 + w / 2 - 0.45;
      if (c - a > 0.6) plan.extraOpenings.push({ side: 'front', u0: a, u1: c, v0: ffl + 0.0, v1: ffl + 2.75, kind: 'shop', floor: 0, room: lob, roomU0: lob.x0 + w / 2, roomU1: lob.x1 + w / 2, depth: d / 2 - lob.z0 });
    }
    plan.lobby = { cx: (lob.x0 + lob.x1) / 2, cz: (lob.z0 + lob.z1) / 2, nx: 0, nz: 1, depth: lob.z1 - lob.z0 };
  }
  if (!s._shared.back && core) {
    const su = w / 2 - (core.stair.x0 + core.stair.x1) / 2; // back facade u of the stair centre
    // service door beside the core on the back facade
    const u = Math.min(w - 1.5, su + core.stair.W / 2 + 1.4);
    plan.entrances.push({ kind: 'service', side: 'back', u0: u - 0.5, u1: u + 0.5, v1: ffl + 2.15 });
    plan.extraOpenings.push({ side: 'back', u0: u - 0.5, u1: u + 0.5, v0: ffl, v1: ffl + 2.15, kind: 'door', doorKind: 'service', floor: 0 });
    // staggered stair windows at half landings on the back facade
    for (let i = 0; i < floors.length - 1; i++) {
      const f = floors[i];
      const yh = f.y + f.h * 0.5 + 0.95;
      plan.extraOpenings.push({ side: 'back', u0: su - 0.6, u1: su + 0.6, v0: yh, v1: Math.min(yh + 1.2, floors[i + 1].y + floors[i + 1].h - 0.4), kind: 'casement', floor: i, room: floors[i].rooms.find((r) => r.kind === 'stair') });
    }
  }
  return plan;
}

/** Run every pass for a plan. opts: {bands:fn|false, roof:{}, base:{}} */
export function assembleAll(ctx, plan, opts = {}) {
  emitFacades(ctx, plan, opts.facades || {});
  if (opts.bands !== false) {
    const st = ctx.style;
    const fn = opts.bands || ((L) => (st.bands ? (st.bandShape === 'curved' ? 0.42 : 0.25) : 0));
    emitBands(ctx, plan, fn, { railFn: opts.railFn || (() => null), up: st.bandShape === 'curved' ? 0.12 : 0.08, lights: false, cornerR: 0.4 });
  }
  emitRoof(ctx, plan, opts.roof || {});
  emitBase(ctx, plan, opts.base || {});
  if (ctx.full) emitInterior(ctx, plan, opts.interior || {});
  emitAnchors(ctx, plan);
}

export default {
  name: 'generic',
  uses: ['generic'],
  generate(spec, lod, ctx) {
    const plan = genericPlan(ctx);
    assembleAll(ctx, plan);
  },
  massing(spec, ctx) {
    const v = defaultMassing(ctx.spec, ctx);
    const { gh, fh } = storeys(ctx);
    v[0].groundH = gh + 0.3; v[0].floorH = fh; v[0].y1 = 0.3 + gh + (ctx.spec._floors - 1) * fh;
    return v;
  },
};
