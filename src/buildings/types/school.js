// School (学校), Zhurong family (owner: buildings-z).
// Classroom wing along the street: front-loaded corridor on the street facade (windows to the street),
// classrooms (≈ 8.4 m modules) facing the schoolyard (spec.meta.yardSide, default back) with big windows;
// covered main entrance (deep ZR arch canopy, bike shelter) → entrance hall → stair hall + lift core;
// canteen / assembly hall on the ground floor opening onto a covered walkway (colonnade) along the
// yard side; WC + staff rooms by the core; roof garden (classes use it). L footprints (urban: front bar
// + back-left wing) put the sports hall (gym) in the wing: tall vaulted volume with clerestory strips,
// doors to the yard, joined to the classroom corridor.

import * as K from '../kit/index.js';
import { corridorPlan, publicOpenings, addDoor, assemblePublic, pubStoreys, specEntrances, columnCanopy, cyanStrip, signTotem, groundAtU, clamp, zMass, subCtx, offsetAnchors, lobbyFurniture } from './z_common.js';
import { hall, entranceSteps } from './z_hall.js';
import { sideGround } from '../kit/plinth.js';

const STY = { gh: 4.5, fh: 4.0, ghMin: 4.5, fhMin: 3.9 };

/** L footprint → {bar depth, wing width} (null for rect). */
function lParts(s) {
  const fp = s.footprint || {};
  if (fp.shape !== 'L' || !Array.isArray(fp.points) || fp.points.length !== 6) return null;
  const w = s._w, d = s._d;
  const xs = fp.points.map((p) => p[0]), zs = fp.points.map((p) => p[1]);
  const wingX1 = Math.max(...xs.filter((x) => x < w / 2 - 1e-3));
  const barZ0 = Math.min(...zs.filter((z) => z > -d / 2 + 1e-3));
  const barD = d / 2 - barZ0, wing = wingX1 + w / 2;
  if (barD < 8 || wing < 6 || barD > d - 4) return null;
  return { barD, wing };
}

function classroomWing(ctx) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const S = pubStoreys(ctx, STY);
  const plan = corridorPlan(ctx, {
    storeys: S, single: 'front', corridorW: 3.0, lobbyW: clamp(s._w * 0.16, 7, 10),
    module: () => 8.4,
    kind: (L, zone, i, n, x0, x1) => {
      if (L === 0 && i === 0 && x1 - x0 > 5) return 'hall';                 // canteen / assembly
      if (i === n - 1 && x1 - x0 < 9.5) return L % 2 ? 'office' : 'bath';   // staff room / WC at the ends
      return 'classroom';
    },
  });
  plan.bayW = 3.2;
  plan.roof.kind = 'garden';
  const w = plan.w, d = plan.d, ffl = plan.ffl;
  const lob = plan.lobby;
  const mainU = lob ? lob.cx + w / 2 : w / 2;
  const doors = [addDoor(plan, { side: 'front', u: mainU, w: 3.0, h: 2.6, kind: 'main', room: lob && lob.room, vestibule: st.coveredEntry })];
  // yard door from the canteen / hall module under the colonnade
  const hallR = plan.floors[0].rooms.find((r) => r.kind === 'hall');
  if (hallR && !s._shared.back) doors.push(addDoor(plan, { side: 'back', u: w / 2 - (hallR.x0 + hallR.x1) / 2, w: 2.4, h: 2.5, kind: 'yard', room: hallR }));
  // service door (kitchen supplies) on a free short side
  const svcSide = !s._shared.left ? 'left' : !s._shared.right ? 'right' : null;
  if (svcSide) {
    const cor = plan.corridor;
    const u = svcSide === 'left' ? (cor.z0 + cor.z1) / 2 + d / 2 : d / 2 - (cor.z0 + cor.z1) / 2;
    doors.push(addDoor(plan, { side: svcSide, u, w: 1.4, h: 2.3, kind: 'service' }));
  }
  return { plan, doors, S };
}

function generate(spec, lod, ctx) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const LP = lParts(s);
  let wctx = ctx, zOff = 0;
  if (LP) { zOff = s._d / 2 - LP.barD / 2; wctx = subCtx(ctx, { cx: 0, cz: zOff, w: s._w, d: LP.barD, shared: { ...s._shared, back: false } }); }
  b.push(); b.translate(0, 0, zOff);
  const savedA = b.anchors;
  if (LP) b.anchors = { entrances: [], floors: [], roof: null, rooms: [], windows: [], cameras: {} };
  const { plan, doors } = classroomWing(wctx);
  const w = plan.w, d = plan.d, ffl = plan.ffl;
  const gymU = LP ? { u0: w - LP.wing, u1: w } : null;   // back-facade u range occupied by the gym wing
  if (gymU) doors.push(addDoor(plan, { side: 'back', u: w - LP.wing / 2, w: 2.0, h: 2.5, kind: 'internal', entrance: false, doorKind: 'glazed_double' }));
  for (const f of plan.floors) {
    f.openings = publicOpenings(wctx, plan, f, { avoid: doors, rules: { hall: { sill: 0.5, head: 0.3, frac: 0.8, bay: 3.2 } }, skip: gymU ? (r, side) => side === 'back' && (w / 2 - r.x0) > gymU.u0 + 0.5 && f.level <= 1 : null });
  }
  assemblePublic(wctx, plan, {
    bands: (L, side) => (L === plan.floors.length ? 0.35 : side === 'back' ? 0.9 : 0.42),
    roof: { garden: true, stairHouse: true },
    base: { canopy: st.bandShape === 'curved' ? 'curved' : 'flat', bikes: false },
  });
  // ---- covered walkway (colonnade) along the yard side ----
  if (!s._shared.back) {
    const xa = LP ? -w / 2 + LP.wing + 0.2 : -w / 2 + 0.6, xb = w / 2 - 0.6;
    const [g0, g1] = sideGround(wctx.spec, 'back');
    const gy = Math.min(g0, g1);
    const cy = ffl + 3.4;
    const cols = [];
    const n = Math.max(2, Math.round((xb - xa) / 6.4));
    for (let i = 0; i <= n; i++) cols.push([xa + 0.4 + ((xb - xa - 0.8) * i) / n, -d / 2 - 3.4, Math.min(ffl, gy + 0.0)]);
    b.withTint(inst.bandTint, () => columnCanopy(b, { x0: xa, x1: xb, z0: -d / 2 - 3.9, z1: -d / 2 + 0.05, y: cy, t: 0.32, cols, key: st.band, colR: 0.18 }));
    // paved walk under it (FFL) with a step down to the yard
    b.cbox('paving_stone', xa, gy - 0.4, -d / 2 - 3.9, xb, ffl - 0.025, -d / 2, 0.012, false);   // 2 cm under the kit door landings (coplanar tops z-fought)
    if (b.collecting) b.colQuad(xa, ffl, -d / 2, xb, ffl, -d / 2, xb, ffl, -d / 2 - 3.9, xa, ffl, -d / 2 - 3.9);
    if (ffl - gy > 0.05) { b.push(); K.facadeFrame(b, 'back', w, d, 0); K.steps(b, { u0: w / 2 - xb + 0.2, u1: w / 2 - xa - 0.2, z0: 3.9, y0: gy, y1: ffl, key: 'stone_step', cheeks: false }); b.pop(); }
  }
  // ---- entrance forecourt: school sign, bike shelter, planters ----
  const lob = plan.lobby;
  const mainX = lob ? lob.cx : 0;
  const gF = groundAtU(wctx.spec, 'front', mainX + w / 2, w);
  signTotem(b, clamp(mainX - 6.5, -w / 2 + 1, w / 2 - 1), gF, d / 2 + 5.5, 0, { w: 1.2, h: 2.2 });
  const bx0 = clamp(mainX + 5, -w / 2 + 1, w / 2 - 9);
  K.bikeShelter(b, bx0, d / 2 + 3.0, bx0 + 8, d / 2 + 5.2, gF);
  if (ctx.full && lob && lob.room) lobbyFurniture(ctx, lob.room, plan.ffl);
  b.pop();
  // ---- gym wing (L) ----
  if (LP) {
    const subA = b.anchors;
    offsetAnchors(subA, 0, 0, zOff);
    b.anchors = savedA;
    Object.assign(b.anchors, subA);
    const x0 = -s._w / 2, x1 = -s._w / 2 + LP.wing, z1 = s._d / 2 - LP.barD, z0 = -s._d / 2;
    const gffl = ffl;
    const eave = plan.floors[0].h + (plan.floors[1] ? plan.floors[1].h : 3.5);
    const L2 = z1 - z0;
    const yard = 'right';
    const ops = { right: [], left: [], back: [] };
    // clerestory strips on both long sides, doors to the yard
    for (const side of ['right', 'left']) {
      const n = Math.max(1, Math.round(L2 / 4.5));
      for (let i = 0; i < n; i++) { const c = (L2 * (i + 0.5)) / n; ops[side].push({ u0: c - 1.6, u1: c + 1.6, v0: gffl + eave - 2.6, v1: gffl + eave - 0.5, kind: 'strip', room: 'hall' }); }
    }
    ops[yard].push({ u0: L2 * 0.25 - 1.0, u1: L2 * 0.25 + 1.0, v0: gffl, v1: gffl + 2.4, kind: 'door', doorKind: 'glazed_double' });
    ops[yard].push({ u0: L2 * 0.7 - 0.6, u1: L2 * 0.7 + 0.6, v0: gffl, v1: gffl + 2.2, kind: 'door', doorKind: 'service' });
    ops.back.push({ u0: LP.wing * 0.5 - 2.5, u1: LP.wing * 0.5 + 2.5, v0: gffl + 0.9, v1: gffl + eave - 0.8, kind: 'curtain', pane: 1.25, room: 'hall' });
    hall(ctx, { x0, x1, z0, z1, y0: gffl, eave, wallKey: st.wall, wallT: st.wallT, wallTint: inst.shellTint, sides: { front: { skip: true }, right: { openings: ops.right }, left: { openings: ops.left }, back: { openings: ops.back } }, roof: { kind: 'vault', rise: Math.min(3.2, LP.wing * 0.16), key: 'ceramic_band', tint: inst.bandTint, soffitKey: 'render_white', overhang: 0.5, lights: 'crown' }, frames: 6, frameKey: 'steel_dark', floorKey: 'wood_floor', interior: true });
    K.plinth(b, s, gffl, { w: LP.wing, d: L2, skip: { front: true } });
    // yard door landing / steps
    b.push(); b.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); K.facadeFrame(b, yard, LP.wing, L2, 0);
    const [ga, gb] = sideGround(s, yard);
    entranceSteps(ctx, { u0: L2 * 0.25 - 1.0, u1: L2 * 0.25 + 1.0, ffl: gffl, g0: ga, g1: gb, L: L2, main: false, canopy: true, cy: gffl + 3.0 });
    b.pop();
    b.anchors.entrances.push({ kind: 'yard', side: yard, pos: [x1 + 0.6, gffl, z0 + L2 * 0.75], dir: [1, 0, 0], width: 2.0 });
  }
  // interior view: a ground-floor classroom, from the corridor wall towards the big yard windows
  // (room coords are in the classroom-wing frame, shifted by zOff for the L plan)
  const f0 = plan.floors[0];
  const minX = LP ? -s._w / 2 + LP.wing - 0.5 : -1e9;              // rooms whose yard windows are not behind the gym
  const crs = f0.rooms.filter((r) => r.kind === 'classroom' && r.x0 >= minX);
  // lobby view: from the entrance hall along the corridor (doors to the classrooms on one side)
  if (lob && plan.corridor) {
    const zc = (plan.corridor.z0 + plan.corridor.z1) / 2 + zOff, dir = lob.cx > 0 ? -1 : 1;
    b.anchors.cameras.lobby = { pos: [lob.cx - dir * 1.2, f0.y + 1.65, zc + 0.3], target: [lob.cx + dir * 14, f0.y + 1.35, zc - 0.4] };
  }
  crs.sort((a, c) => Math.abs((a.x0 + a.x1) / 2) - Math.abs((c.x0 + c.x1) / 2));
  const cr = crs[0];
  if (cr && !s._shared.back) {
    const W = cr.x1 - cr.x0, cx = (cr.x0 + cr.x1) / 2;
    b.anchors.cameras.interior = { pos: [cx + W * 0.3, f0.y + 1.65, cr.z1 - 0.8 + zOff], target: [cx - W * 0.1, f0.y + 1.2, cr.z0 - 3 + zOff] };
  } else b.anchors.cameras.interior = b.anchors.cameras.lobby;
}

export default {
  name: 'school',
  uses: ['school'],
  generate,
  massing(spec, ctx) {
    const s = ctx.spec;
    const LP = lParts(s);
    const S = pubStoreys(ctx, STY);
    if (!LP) return [zMass(ctx, S, { bayW: 3.2 })];
    const eave = S.ffl + S.gh + (S.floors[1] ? S.fh : 3.5);
    return [
      zMass(ctx, S, { z0: s._d / 2 - LP.barD, bayW: 3.2, blank: { ...s._shared, back: false } }),
      zMass(ctx, { ...S, roofY: eave }, { x0: -s._w / 2, x1: -s._w / 2 + LP.wing, z1: s._d / 2 - LP.barD, y1: eave, bayW: 4.5, blank: { front: true }, uBase: 2 * s._w, parapet: 0.6, roofColor: [0.62, 0.65, 0.68], bands: false }),
    ];
  },
};
