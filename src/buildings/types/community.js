// Community centre (社区中心) + small civic pavilions, Zhurong family (owner: buildings-z).
// Community: multi-purpose hall in the front zone (big glazing to the street, stage end), lobby at the
// main door, kitchen / WC / store / office along the back corridor, activity rooms upstairs, a covered
// colonnade (首层廊) along the street front, roof garden reached by the stair house. Side door on the
// left (spec 'main' left), service door at the back.
// meta.kiosk → glazed kiosk under a floating canopy; meta.pavilion → park pavilion (pergola + green roof
// room); meta.clubhouse → sports clubhouse (changing rooms + canopy terrace).

import * as K from '../kit/index.js';
import { corridorPlan, publicOpenings, addDoor, assemblePublic, pubStoreys, columnCanopy, cyanStrip, signTotem, groundAtU, clamp, zMass, benchRow, planterStrip, lobbyFurniture, lightBox } from './z_common.js';
import { hall, entranceSteps } from './z_hall.js';
import { sideGround } from '../kit/plinth.js';

const STY = { gh: 4.5, fh: 4.5, ghMin: 4.5, fhMin: 4.2 };

function generateCentre(ctx) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const S = pubStoreys(ctx, STY);
  const w = s._w;
  const lobbyW = clamp(w * 0.22, 6, 9);
  const plan = corridorPlan(ctx, {
    storeys: S, corridorW: 2.4, lobbyW, lobbyX: -w / 2 + lobbyW / 2 + 0.01,
    module: (L, zone) => (zone === 'front' ? 7.5 : 4.8),
    hall: (L) => (L === 0 ? { x0: -w / 2 + lobbyW, x1: w / 2, kind: 'hall', name: 'hall' } : null),
    kind: (L, zone, i, n) => {
      if (zone === 'back') return L === 0 ? ['kitchen', 'bath', 'storage', 'office'][i % 4] : (i % 3 === 1 ? 'bath' : 'office');
      return L === 0 ? 'office' : 'classroom';
    },
  });
  plan.bayW = 3.6;
  plan.roof.kind = 'garden';
  const d = plan.d, ffl = plan.ffl;
  const lob = plan.lobby;
  const doors = [];
  doors.push(addDoor(plan, { side: 'front', u: lob ? lob.cx + w / 2 : 3.5, w: 2.4, h: 2.6, kind: 'main', room: lob && lob.room, vestibule: st.coveredEntry }));
  if (!s._shared.left) { const cor = plan.corridor; doors.push(addDoor(plan, { side: 'left', u: (cor.z0 + cor.z1) / 2 + d / 2, w: 1.8, h: 2.4, kind: 'main' })); }
  if (!s._shared.back) doors.push(addDoor(plan, { side: 'back', u: w * 0.25, w: 1.4, h: 2.3, kind: 'service' }));
  const hallR = plan.floors[0].rooms.find((r) => r.kind === 'hall');
  for (const f of plan.floors) f.openings = publicOpenings(ctx, plan, f, { avoid: doors, rules: { hall: { sill: 0.3, head: 0.3, frac: 0.86, bay: 3.0 }, kitchen: { sill: 1.1, head: 0.4, frac: 0.5, bay: 3 } } });
  assemblePublic(ctx, plan, {
    bands: (L, side) => (L === plan.floors.length ? 0.4 : side === 'front' && L === 1 ? 0.6 : 0.42),
    roof: { garden: true, stairHouse: true, solar: false },
    base: { canopy: 'none', bikes: true },
  });
  // covered colonnade along the street front (columns on the kerb line, soffit lights, benches)
  if (!s._shared.front) {
    const gF = Math.min(...sideGround(s, 'front'));
    const cy = ffl + Math.min(S.gh - 0.3, 4.0);
    const cols = [];
    const n = Math.max(2, Math.round((w - 1.2) / 6.0));
    for (let i = 0; i <= n; i++) cols.push([-w / 2 + 0.6 + ((w - 1.2) * i) / n, d / 2 + 3.6, gF]);
    b.withTint(inst.bandTint, () => columnCanopy(b, { x0: -w / 2 - 0.3, x1: w / 2 + 0.3, z0: d / 2 - 0.05, z1: d / 2 + 4.1, y: cy, t: 0.36, rounded: 1.2, cols, key: st.band, colR: 0.2 }));
    cyanStrip(b, -w / 2 + 1.0, d / 2 + 4.12, w / 2 - 1.0, d / 2 + 4.12, cy - 0.2, { t: 0.03 });
    b.cbox('paving_stone', -w / 2 - 0.3, gF - 0.4, d / 2 + 1.8, w / 2 + 0.3, Math.max(gF, ffl - 0.17) - 0.005, d / 2 + 4.1, 0.012, false);
    benchRow(b, -w / 2 + 3, w / 2 - 3, d / 2 + 2.6, Math.max(gF, ffl - 0.17), Math.PI, 7);
    signTotem(b, w / 2 + 2.5, gF, d / 2 + 5.5, 0, { w: 0.9, h: 2.4 });
  }
  if (ctx.full && plan.lobby && plan.lobby.room) lobbyFurniture(ctx, plan.lobby.room, plan.ffl);
  // stage at the end of the hall ('full')
  if (ctx.full && hallR) {
    const sx0 = hallR.x1 - 4.2, z0 = hallR.z0 + 0.4, z1 = hallR.z1 - 0.6;
    b.cbox('wood_floor', sx0, ffl, z0, hallR.x1 - 0.35, ffl + 0.6, z1, 0.02, false);
    if (b.collecting) b.colBox(sx0, ffl, z0, hallR.x1 - 0.35, ffl + 0.6, z1);
  }
  b.anchors.cameras.interior = hallR ? { pos: [hallR.x0 + 1.5, ffl + 1.65, (hallR.z0 + hallR.z1) / 2 + 1], target: [hallR.x1 - 2, ffl + 1.6, (hallR.z0 + hallR.z1) / 2] } : b.anchors.cameras.lobby;
}

/** Small glazed room under a floating canopy (kiosk / pavilion / clubhouse). */
function generatePavilion(ctx, kind) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const w = s._w, d = s._d;
  const ffl = Math.max(0.15, Math.max(s._ground.fl, s._ground.fr) + 0.12);
  const h = clamp(s._fh || 4, 3.4, 4.5);
  const inset = kind === 'pavilion' ? 2.0 : 1.4;
  const x0 = -w / 2 + inset, x1 = w / 2 - inset, z0 = -d / 2 + inset, z1 = d / 2 - inset;
  const W = x1 - x0, D = z1 - z0;
  const ops = { front: [], back: [], left: [], right: [] };
  ops.front.push({ u0: 0.4, u1: W - 0.4, v0: ffl, v1: ffl + h - 0.5, kind: 'shop', door: { u0: W / 2 - 0.9, width: 1.8 }, room: 'shop', depth: D });
  if (kind === 'kiosk') ops.left.push({ u0: 0.5, u1: D - 0.5, v0: ffl + 0.95, v1: ffl + h - 0.6, kind: 'shop', room: 'shop', depth: W });
  else { ops.left.push({ u0: 0.6, u1: D - 0.6, v0: ffl, v1: ffl + h - 0.5, kind: 'curtain', pane: 1.3, room: 'hall' }); ops.right.push({ u0: 0.6, u1: D - 0.6, v0: ffl, v1: ffl + h - 0.5, kind: 'curtain', pane: 1.3, room: 'hall' }); }
  ops.back.push({ u0: W * 0.7 - 0.5, u1: W * 0.7 + 0.5, v0: ffl, v1: ffl + 2.2, kind: 'door', doorKind: 'service' });
  hall(ctx, { x0, x1, z0, z1, y0: ffl, eave: h, wallKey: st.wall, wallT: 0.25, wallTint: inst.shellTint, sides: { front: { openings: ops.front }, back: { openings: ops.back }, left: { openings: ops.left }, right: { openings: ops.right } }, roof: { kind: 'flat', parapet: 0.3, surface: kind === 'pavilion' ? 'roof_membrane' : 'roof_membrane' }, frames: 0, floorKey: 'tile_floor', interior: true });
  K.plinth(b, s, ffl, { w: W, d: D });
  // floating canopy roof (rounded) over the whole plot, on slim columns
  const cy = ffl + h + 0.9;
  const cols = [[-w / 2 + 0.6, -d / 2 + 0.6], [w / 2 - 0.6, -d / 2 + 0.6], [-w / 2 + 0.6, d / 2 - 0.6], [w / 2 - 0.6, d / 2 - 0.6]].map(([x, z]) => [x, z, K.groundAt(s, x, z)]);
  b.withTint(inst.bandTint, () => columnCanopy(b, { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y: cy, t: 0.45, rounded: Math.min(w, d) * 0.3, cols, key: st.band, colR: 0.14 }));
  cyanStrip(b, -w / 2 + 1.2, d / 2 + 0.01, w / 2 - 1.2, d / 2 + 0.01, cy - 0.25, { t: 0.03 });
  if (kind === 'pavilion' || inst.roofGarden) {
    // green canopy roof
    const pr = K.roundedRect(-w / 2 + 0.4, -d / 2 + 0.4, w / 2 - 0.4, d / 2 - 0.4, Math.min(w, d) * 0.26);
    b.withTint([0.55, 0.7, 0.45], () => b.polyY('soil', pr, [], cy + 0.05, 1));
    for (let i = 0; i < 6; i++) K.shrub(b, -w / 2 + 2 + ((w - 4) * ((i * 0.37) % 1)), cy + 0.05, -d / 2 + 2 + ((d - 4) * ((i * 0.61) % 1)), 0.6, (s.hash + i * 31) >>> 0);
  }
  if (kind === 'kiosk') {
    // service counter + blank menu boards
    lightBox(b, 0, ffl + h - 0.45, Math.min(W - 1, 4), 0.5, z1 + 0.16, { depth: 0.13, rows: 1, seed: ctx.spec.hash });
  }
  // terrace paving + benches
  b.cbox('paving_stone', -w / 2, Math.min(s._ground.min, 0) - 0.3, -d / 2, w / 2, ffl - 0.01, d / 2, 0.012, false);
  if (b.collecting) b.colQuad(-w / 2, ffl, d / 2, w / 2, ffl, d / 2, w / 2, ffl, -d / 2, -w / 2, ffl, -d / 2);
  if (kind !== 'kiosk') benchRow(b, x0, x1, z1 + 0.9, ffl, Math.PI, 3.5);
  b.push(); K.facadeFrame(b, 'front', w, d, 0);
  const [g0, g1] = sideGround(s, 'front');
  if (ffl - Math.min(g0, g1) > 0.05) K.steps(b, { u0: 1.0, u1: w - 1.0, z0: 0.0, y0: Math.min(g0, g1), y1: ffl, key: 'stone_step', cheeks: false });
  b.pop();
  const A = b.anchors;
  A.floors = [{ level: 0, y: ffl, height: h }];
  A.roof = { y: cy, access: [0, cy, 0] };
  A.entrances.push({ kind: 'main', side: 'front', pos: [0, ffl, d / 2 + 0.5], dir: [0, 0, 1], width: 1.8 });
  A.rooms = [{ floor: 0, name: kind, kind: 'shop', center: [0, ffl, 0], size: [W, h, D] }];
  A.cameras = { street: { pos: [-w * 0.6, 1.65 + ffl, d / 2 + 14], target: [0, ffl + 2, 0] }, entrance: { pos: [1.5, ffl + 1.65, d / 2 + 3.5], target: [0, ffl + 1.4, 0] }, interior: { pos: [x0 + 1, ffl + 1.65, z1 - 1], target: [x1 - 1, ffl + 1.3, z0 + 1] }, back: { pos: [w * 0.3, 1.65, -d / 2 - 10], target: [0, 2, 0] }, roof: { pos: [0, cy + 6, d], target: [0, cy, 0] } };
}

function pavKind(s) { const m = s._meta || {}; return m.kiosk ? 'kiosk' : m.pavilion ? 'pavilion' : m.clubhouse ? 'clubhouse' : (s._w * s._d < 200 ? 'kiosk' : null); }

export default {
  name: 'community',
  uses: ['community'],
  generate(spec, lod, ctx) {
    const k = pavKind(ctx.spec);
    if (k) generatePavilion(ctx, k); else generateCentre(ctx);
  },
  massing(spec, ctx) {
    const s = ctx.spec;
    const k = pavKind(s);
    if (k) {
      const ffl = 0.2, h = clamp(s._fh || 4, 3.4, 4.5);
      return [
        zMass(ctx, { fh: h, gh: h, ffl, roofY: ffl + h }, { x0: -s._w / 2 + 1.4, x1: s._w / 2 - 1.4, z0: -s._d / 2 + 1.4, z1: s._d / 2 - 1.4, parapet: 0.3, glazedGround: true, bands: false }),
        zMass(ctx, { fh: 1, gh: 1, ffl, roofY: ffl + h + 0.9 }, { y0: ffl + h + 0.45, y1: ffl + h + 0.9, parapet: 0.0, blank: { front: true, right: true, back: true, left: true }, soffit: true, bands: false, garden: k === 'pavilion' }),
      ];
    }
    return [zMass(ctx, pubStoreys(ctx, STY), { bayW: 3.6 })];
  },
};
