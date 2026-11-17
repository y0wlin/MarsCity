// 保温站 — OX6 / polar insulated supply station (O03 low vaulted halls, §2 OX6 南极补给链). OWNER: buildings-o.
//
// Low and half-buried: frost-white insulated panel shell (thick walls, deep reveals, small windows) under a
// standing-seam insulated vault, snow banked against the windward walls (snow-side walls) and a snow tongue
// in the lee; a concrete windbreak wall at the windward corner keeps snow behind it (shot 04). Recessed
// entries: the airlock (spec 'airlock' / 'main', on the lee side per meta.leeSide) is an insulated vestibule
// (门斗) with outer + inner doors, warm downlight, condensate tray and a cyan guide beacon; the vehicle /
// cargo door (spec 'service') sits inside a heated hood with a swept apron showing dark wheel tracks.
// The pipe gallery (管廊): heat-traced insulated mains on steel trestles leave the back towards the next
// station, with a marker light at the bend. Interior ('full'): central corridor along the long axis with
// bunk / mess / radio / plant rooms both sides, an upper deck under the vault (2-storey specs) with stair.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, OPP, isFB, oEnv, roomMap, yellowRail, grating, pipeRun, cabinet, drift, utilAnchors, massVol, massVault, groundAtU, lampPost } from './o_common.js';
import { buildHall, partition, consoleDesk, chairSimple, doorSpans } from './o_hall.js';
import { bandWindows, dedupeOps, storeySlabs } from './o_block.js';

function dims(ctx) {
  const s = ctx.spec;
  const E = oEnv(ctx);
  E.polar = true; E.dry = false; E.wet = false; E.shell = 'panel_insulated'; E.wallT = 0.46; E.reveal = 0.3; E.ffl = 0.45;
  E.shellTint = [0.99, 1.0, 1.02];
  const w = s._w, d = s._d;
  // fix 2 (QA-ID-04): the storey table follows the spec (floors, groundFloorHeight, floorHeight); upper decks sit under
  // the vault, the springing line at the nominal top minus half the rise (mean headroom of the top deck = floorHeight)
  const nF = Math.max(1, Math.min(3, s._floors || 1));
  const gh = Math.max(3.6, s._gh || 4);
  const fh = Math.max(3.0, s._fh || 3.6);
  const span = Math.min(w, d);
  const rise = Math.min(span * 0.24, nF > 1 ? 3.0 : 3.2);
  const top = E.ffl + gh + (nF - 1) * fh - (nF > 1 ? rise * 0.5 : 0);
  const levels = [{ y: E.ffl, h: gh }];
  for (let i = 1; i < nF; i++) levels.push({ y: E.ffl + gh + (i - 1) * fh, h: fh });
  return { E, w, d, nF, gh, fh, top, rise, crown: top + rise, ffl: E.ffl, levels };
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const D = dims(ctx);
  const { E, w, d, nF, gh, top, rise, ffl } = D;
  const m = s._meta || {};
  const rng = ctx.sub(1901);
  const L = (side) => (isFB(side) ? w : d);
  const uOf = (e, side) => L(side) / 2 + (side === 'back' || side === 'left' ? -1 : 1) * (e.offset || 0);
  const ops = { front: [], right: [], back: [], left: [] };
  const airE = s._entrances.find((e) => e.kind === 'airlock' || e.kind === 'main') || { side: SIDES.includes(m.leeSide) ? m.leeSide : 'front', offset: 0, width: 2.0 };
  const svcE = s._entrances.find((e) => e.kind === 'service' || e.kind === 'loading' || e.kind === 'equipment');
  const A = airE.side;
  let S = svcE ? svcE.side : (isFB(A) ? 'right' : 'front');
  if (S === A) S = isFB(A) ? 'right' : 'front';
  const windSide = E.windward === A ? OPP[A] : E.windward;
  // ---- airlock door (inner door in the facade; the vestibule projects outside) ----
  const LA = L(A);
  const au = Math.max(2.2, Math.min(LA - 2.2, uOf(airE, A)));
  const aDoor = { u0: au - 0.75, u1: au + 0.75, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'glazed_double' };
  ops[A].push(aDoor);
  // small deep windows (bunk rooms / mess) on the airlock + opposite side, none on the windward wall
  for (const side of SIDES) {
    if (side === windSide && side !== A) continue;
    if (side === S) continue;
    const avoid = side === A ? [[au - 2.6, au + 2.6]] : [];
    bandWindows(ctx, ops, side, w, d, { y: ffl, h: gh, sill: 1.15, head: 2.25, every: side === A ? 3.4 : 4.2, width: 1.0, avoid, kind: side === A ? 'living' : 'bedroom', floor: 0, depth: Math.min(5, (isFB(side) ? d : w) / 2 - 1), type: 'casement' });
  }
  // fix 2: small deep windows on the upper decks too (below the vault springing), same sides as the ground floor
  for (let i = 1; i < nF; i++) {
    const l = D.levels[i], head = Math.min(2.2, top - l.y - 0.3);
    if (head - 1.0 < 0.7) continue;
    for (const side of SIDES) {
      if ((side === windSide && side !== A) || side === S) continue;
      bandWindows(ctx, ops, side, w, d, { y: l.y, h: l.h, sill: 1.0, head, every: 4.2, width: 1.0, avoid: side === A ? [[au - 2.6, au + 2.6]] : [], kind: 'bedroom', floor: i, depth: Math.min(5, (isFB(side) ? d : w) / 2 - 1), type: 'casement' });
    }
  }
  // ---- service hood door ----
  const LS = L(S);
  const su = Math.max(3, Math.min(LS - 3, svcE ? uOf(svcE, S) : LS / 2));
  const rdW = Math.min(3.8, Math.max(3.2, (svcE && svcE.width) || 3.6));
  const roller = { u0: su - rdW / 2, u1: su + rdW / 2, v0: ffl, v1: ffl + Math.min(3.6, gh - 0.3), kind: 'roller', open: 0, apron: false };
  ops[S].push(roller);
  for (const u of [roller.u0 - 1.4, roller.u1 + 1.4]) if (u > 1.2 && u < LS - 1.2) ops[S].push({ u0: u - 0.5, u1: u + 0.5, v0: ffl + 0.6, v1: ffl + 1.6, kind: 'louvre' });
  for (const side of SIDES) ops[side] = dedupeOps(ops[side]);
  // ---- shell with vault ----
  const I = { x0: -w / 2 + E.wallT, x1: w / 2 - E.wallT, z0: -d / 2 + E.wallT, z1: d / 2 - E.wallT };
  const walls = [];
  const alongX = w >= d;
  if (ctx.full) {
    // central corridor along the long axis; rooms both sides with doors
    const cw = 2.0;
    if (alongX) {
      const z0 = -cw / 2, z1 = cw / 2;
      for (const z of [z0, z1]) {
        const doors = []; for (let x = I.x0 + 2.4; x < I.x1 - 1.5; x += 4.2) doors.push({ at: x - I.x0, w: 0.95 });
        walls.push({ x0: I.x0 + 3.5, z0: z, x1: I.x1 - 3.5, z1: z, y0: ffl, y1: ffl + gh - 0.3, doors: doors.filter((dd) => dd.at > 4.2 && dd.at < I.x1 - I.x0 - 4.2).map((dd) => ({ ...dd, at: dd.at - 3.5 })) });
      }
      for (let x = I.x0 + 3.5 + 4.2; x < I.x1 - 3.6; x += 4.2) for (const [za, zb] of [[I.z0, -cw / 2], [cw / 2, I.z1]]) walls.push({ x0: x, z0: za, x1: x, z1: zb, y0: ffl, y1: ffl + gh - 0.3, doors: [] });
    } else {
      const x0 = -cw / 2, x1 = cw / 2;
      for (const x of [x0, x1]) {
        const doors = []; for (let z = 4.2; z < I.z1 - I.z0 - 4.2; z += 4.2) doors.push({ at: z - 3.5 + 2.1, w: 0.95 });
        walls.push({ x0: x, z0: I.z0 + 3.5, x1: x, z1: I.z1 - 3.5, y0: ffl, y1: ffl + gh - 0.3, doors });
      }
    }
  }
  const H = buildHall(ctx, { env: E, ffl, top, T: E.wallT, ops, roof: { kind: 'vault', rise, axis: alongX ? 'x' : 'z' }, walls, slabs: [], stairs: [], ceiling: 'flat', lights: null });
  // upper deck under the vault (2-storey specs)
  if (ctx.full && nF > 1) {
    storeySlabs(ctx, I, D.levels, { x0: alongX ? I.x0 + 0.4 : -0.55, z: alongX ? I.z1 - 0.75 : I.z0 + 4, dir: 1, W: 1.0 });
  }
  // ---- airlock vestibule ----
  vestibule(ctx, D, A, au, aDoor);
  // ---- service hood + swept apron with wheel tracks ----
  serviceHood(ctx, D, S, roller, rng);
  // ---- snow-side walls: banked snow on the windward wall + ends, lee tongue, windbreak ----
  drift(ctx, windSide, { kind: 'snow', h: 1.5, reach: 5.0, seed: 1, skip: doorSpans(H.opsBySide[windSide]) });
  for (const side of SIDES) if (side !== windSide && side !== OPP[windSide] && side !== S) drift(ctx, side, { kind: 'snow', h: 0.8, reach: 3.0, seed: 2, skip: doorSpans(H.opsBySide[side]) });
  drift(ctx, OPP[windSide], { kind: 'snow', h: 0.45, reach: 4.2, seed: 5, skip: doorSpans(H.opsBySide[OPP[windSide]]).concat([[au - 3.5, au + 3.5]]) });
  windbreak(ctx, D, windSide, rng);
  // ---- pipe gallery (管廊) leaving the back ----
  const pgSide = [OPP[A], windSide, S].find((x) => x !== A && x !== S) || OPP[A];
  pipeGallery(ctx, D, pgSide, rng);
  // ---- roof: vent stacks through the vault, marker lights, mast ----
  {
    const span = alongX ? d : w;
    for (let k = 0; k < 3; k++) {
      const t = (k + 1) / 4;
      const p = alongX ? [-w / 2 + w * t, span * 0.18] : [span * 0.18, -d / 2 + d * t];
      const yy = top + rise * (1 - Math.pow((alongX ? p[1] : p[0]) / (span / 2), 2)) - 0.1;
      K.ventStack(b, p[0], yy, p[1], 0.12, 1.4);
    }
    for (const sg of [-1, 1]) {
      const p = alongX ? [sg * (w / 2 - 0.4), top + rise + 0.05, 0] : [0, top + rise + 0.05, sg * (d / 2 - 0.4)];
      b.cylinder('steel', p[0], p[1], p[2], 0.04, 0.6, 6, { top: true });
      b.cylinder('light_red', p[0], p[1] + 0.6, p[2], 0.07, 0.14, 8, { top: true });
    }
    const mp = alongX ? [w * 0.3, top + rise - 0.2, 0] : [0, top + rise - 0.2, d * 0.3];
    K.antennaMast(b, mp[0], mp[1], mp[2], 6 + rng.next() * 3, s.hash);
  }
  // ---- anchors ----
  const vd = 3.2;
  utilAnchors(ctx, {
    ffl, h: gh, roofY: top + rise, access: [0, top + rise, 0],
    floors: D.levels.map((l, i) => ({ level: i, y: l.y, height: l.h })),
    entrances: [
      { kind: 'airlock', side: A, pos: K.facadePoint(A, w, d, au, ffl, vd + 0.6), dir: K.facadeNormal(A), width: 1.5 },
      { kind: 'service', side: S, pos: K.facadePoint(S, w, d, su, ffl, 4.2), dir: K.facadeNormal(S), width: rdW },
    ],
    rooms: [{ floor: 0, name: 'station hall', kind: 'living', center: [0, ffl, 0], size: [w, gh, d] }],
    cameras: { entrance: { pos: K.facadePoint(A, w, d, au + 3.5, ffl + 1.65, vd + 6), target: K.facadePoint(A, w, d, au, ffl + 1.4, vd * 0.4) }, living: { pos: K.facadePoint(A, w, d, au, ffl + 1.65, -1.5), target: K.facadePoint(A, w, d, au, ffl + 1.4, -8) } },
  });
  b.meta.windward = windSide; b.meta.pipeGallery = pgSide;
}

/** Insulated airlock vestibule (门斗) projecting from side A around the inner door. */
function vestibule(ctx, D, A, au, door) {
  const b = ctx.b, s = ctx.spec, E = D.E;
  const { w, d, ffl } = D;
  const vw = 4.2, dep = 3.2, h = 3.1;
  const u0 = au - vw / 2, u1 = au + vw / 2;
  b.push(); K.facadeFrame(b, A, w, d, 0);
  const L = isFB(A) ? w : d;
  const gy = groundAtU(s, A, au, L);
  b.pushTint(E.shellTint);
  b.cbox('panel_insulated', u0, ffl - 0.15, 0, u0 + 0.4, ffl + h, dep, 0.02, false);
  b.cbox('panel_insulated', u1 - 0.4, ffl - 0.15, 0, u1, ffl + h, dep, 0.02, false);
  // front wall with the recessed outer door (door set 0.45 m back from the front face: 内缩)
  b.cbox('panel_insulated', u0 + 0.4, ffl - 0.15, dep - 0.4, au - 0.8, ffl + h, dep, 0.02, false);
  b.cbox('panel_insulated', au + 0.8, ffl - 0.15, dep - 0.4, u1 - 0.4, ffl + h, dep, 0.02, false);
  b.cbox('panel_insulated', au - 0.8, ffl + 2.35, dep - 0.4, au + 0.8, ffl + h, dep, 0.02, false);
  b.cbox('panel_insulated', u0 - 0.15, ffl + h, -0.05, u1 + 0.15, ffl + h + 0.45, dep + 0.25, 0.03);
  b.popTint();
  b.withTint(E.trimTint, () => { b.box('panel_grey', u0 - 0.17, ffl + h + 0.36, -0.06, u1 + 0.17, ffl + h + 0.47, dep + 0.27, PY | PZ | PX | NX); b.box('panel_grey', u0 - 0.02, ffl - 0.15, dep, u1 + 0.02, ffl + 0.45, dep + 0.02, PZ | PY); });
  // snow on the vestibule roof
  b.withTint(E.snowTint, () => b.box('render_white', u0 + 0.1, ffl + h + 0.45, 0.2, u1 - 0.1, ffl + h + 0.58, dep + 0.05, PY | PX | NX | PZ));
  // outer door in the recess (doorUnit in a frame translated to the recess plane)
  b.push(); b.translate(0, 0, dep - 0.4);
  K.doorUnit(b, { u0: au - 0.8, u1: au + 0.8, v0: ffl, v1: ffl + 2.35, R: 0.05, kind: 'glazed_double', open: 0, glassKey: ctx.full ? 'glass_clear' : 'glass_shop', T: 0.35 });
  b.pop();
  // frost on the outer door frame (thin white edge), condensate tray inside, warm downlight, cyan beacon
  b.withTint(E.snowTint, () => { b.box('render_white', au - 0.85, ffl, dep - 0.4, au - 0.8, ffl + 2.4, dep - 0.36, PZ | NX); b.box('render_white', au + 0.8, ffl, dep - 0.4, au + 0.85, ffl + 2.4, dep - 0.36, PZ | PX); b.box('render_white', au - 0.85, ffl + 2.35, dep - 0.4, au + 0.85, ffl + 2.42, dep - 0.36, PZ | PY); });
  b.box('steel_brushed', au - 0.7, ffl, 0.3, au + 0.7, ffl + 0.02, 0.9, PY | PZ | NZ);
  b.withTint([0.6, 0.7, 0.74], () => b.box('chrome', au - 0.64, ffl + 0.021, 0.36, au + 0.64, ffl + 0.022, 0.84, PY));
  b.cylinder('light_warm', au, ffl + h - 0.02, dep * 0.5, 0.11, 0.015, 12, { top: false, bottom: true });
  b.cylinder('light_warm', au, ffl + 2.5, dep - 0.42, 0.09, 0.02, 10, { top: false, bottom: true });
  b.cylinder('steel', u1 + 0.4, gy, dep + 0.2, 0.05, 2.6, 8, { top: true });
  b.cylinder('light_cyan', u1 + 0.4, gy + 2.6, dep + 0.2, 0.08, 0.2, 10, { top: true });
  b.rectY('mat_entrance', au - 0.8, 0.3, au + 0.8, dep - 0.5, ffl + 0.004, 1);
  b.rectY('concrete_smooth', u0 + 0.4, 0.0, u1 - 0.4, dep - 0.4, ffl + 0.002, 1);
  if (ctx.full) b.withTint([0.95, 0.95, 0.94], () => b.rectY('plaster', u0 + 0.4, 0, u1 - 0.4, dep - 0.4, ffl + h - 0.01, -1));
  if (b.collecting) {
    b.colBox(u0, ffl, 0, u0 + 0.4, ffl + h, dep); b.colBox(u1 - 0.4, ffl, 0, u1, ffl + h, dep);
    b.colBox(u0 + 0.4, ffl, dep - 0.4, au - 0.8, ffl + h, dep); b.colBox(au + 0.8, ffl, dep - 0.4, u1 - 0.4, ffl + h, dep);
    b.colQuad(u0, ffl, dep, u1, ffl, dep, u1, ffl, 0, u0, ffl, 0);
  }
  // landing + steps + swept path (dark compacted strip in the snow)
  const landD = 1.6;
  b.cbox('concrete_smooth', au - 1.3, Math.min(gy, ffl) - 0.4, dep, au + 1.3, ffl - 0.005, dep + landD, 0.012, false);
  if (b.collecting) b.colQuad(au - 1.3, ffl, dep + landD, au + 1.3, ffl, dep + landD, au + 1.3, ffl, dep, au - 1.3, ffl, dep);
  if (ffl - gy > 0.05) K.steps(b, { u0: au - 1.3, u1: au + 1.3, z0: dep + landD, y0: gy, y1: ffl, key: 'stone_step', cheeks: false, rails: false });
  const nS = Math.max(1, Math.ceil(Math.max(0, ffl - gy) / 0.165)), run = nS * 0.3;
  for (const ux of [au - 1.2, au + 1.2]) {
    const pts = [[ux, ffl + 1.0, dep + 0.1], [ux, ffl + 1.0, dep + landD], [ux, Math.min(gy, ffl) + 1.0, dep + landD + run], [ux, Math.min(gy, ffl) + 1.0, dep + landD + run + 0.3]];
    b.tube('steel_yellow', pts, 0.022, 8, { transport: true });
    for (const z of [dep + 0.15, dep + landD, dep + landD + run]) { const yy = z <= dep + landD + 0.01 ? ffl : Math.min(gy, ffl); b.box('steel_yellow', ux - 0.022, yy, z - 0.022, ux + 0.022, yy + 1.0, z + 0.022, PX | NX | PZ | NZ); }
  }
  b.withTint([0.55, 0.53, 0.52], () => b.quad('concrete', au - 1.0, gy + 0.015, dep + landD + run, au + 1.0, gy + 0.015, dep + landD + run, au + 1.4, gy + 0.015, dep + landD + run + 8, au - 1.4, gy + 0.015, dep + landD + run + 8));
  b.pop();
  void door;
}

/** Heated hood around the vehicle door + swept apron with wheel tracks (OX6 货车停靠处的轮迹). */
function serviceHood(ctx, D, S, r, rng) {
  const b = ctx.b, s = ctx.spec, E = D.E;
  const { w, d, ffl } = D;
  const L = isFB(S) ? w : d;
  const u = (r.u0 + r.u1) / 2;
  const gy = groundAtU(s, S, u, L);
  const hw = (r.u1 - r.u0) / 2 + 0.7, dep = 2.4, h = r.v1 - ffl + 0.8;
  b.push(); K.facadeFrame(b, S, w, d, 0);
  b.pushTint(E.shellTint);
  b.cbox('panel_insulated', u - hw, ffl - 0.15, 0, u - hw + 0.4, ffl + h, dep, 0.02, false);
  b.cbox('panel_insulated', u + hw - 0.4, ffl - 0.15, 0, u + hw, ffl + h, dep, 0.02, false);
  b.cbox('panel_insulated', u - hw - 0.1, ffl + h, -0.05, u + hw + 0.1, ffl + h + 0.45, dep + 0.2, 0.03);
  b.popTint();
  b.withTint(E.snowTint, () => b.box('render_white', u - hw, ffl + h + 0.45, 0.2, u + hw, ffl + h + 0.56, dep, PY | PX | NX | PZ));
  b.withTint(E.trimTint, () => b.box('panel_grey', u - hw - 0.12, ffl + h + 0.36, -0.06, u + hw + 0.12, ffl + h + 0.47, dep + 0.22, PY | PZ | PX | NX));
  for (const uu of [u - hw + 0.2, u + hw - 0.2]) { b.cylinder('steel_yellow', uu, gy - 0.2, dep + 0.35, 0.11, 1.3, 12, { top: true }); }
  b.cylinder('light_warm', u, ffl + h - 0.02, dep * 0.5, 0.12, 0.015, 12, { top: false, bottom: true });
  // floor slab in the hood + apron (swept concrete) with dark compacted wheel tracks + snow edges
  const y = Math.min(ffl, gy + 0.06);
  b.withTint([0.88, 0.88, 0.88], () => b.cbox('concrete', u - hw, y - 0.45, 0, u + hw, y, dep + 9, 0.02, false));
  if (b.collecting) b.colQuad(u - hw, y, dep + 9, u + hw, y, dep + 9, u + hw, y, 0, u - hw, y, 0);
  if (ffl > y + 0.02) { b.sweep('concrete_smooth', [[r.u0, 0, 0], [r.u1, 0, 0]], [[0, y - 0.3], [1.4, y - 0.3], [1.4, y], [0, ffl]], { smoothAngle: 5 }); }
  for (const du of [-0.95, 0.95]) b.withTint([0.32, 0.31, 0.31], () => b.box('concrete', u + du - 0.28, y, dep + 0.2, u + du + 0.28, y + 0.004, dep + 9, PY));
  b.withTint(E.snowTint, () => { for (const sg of [-1, 1]) b.box('render_white', u + sg * hw - (sg > 0 ? 0 : 0.6), y, dep + 0.5, u + sg * hw + (sg > 0 ? 0.6 : 0), y + 0.35 + rng.next() * 0.2, dep + 9, PY | PX | NX | PZ); });
  b.pop();
}

/** Concrete windbreak wall at the windward corner with snow banked behind (lee) and a thin scour in front. */
function windbreak(ctx, D, windSide, rng) {
  const b = ctx.b, s = ctx.spec, E = D.E;
  const { w, d } = D;
  const L = isFB(windSide) ? w : d;
  b.push(); K.facadeFrame(b, windSide, w, d, 0);
  const u0 = rng.next() < 0.5 ? -2.5 : L - 7.5, u1 = u0 + 10;
  const z = 7.5;
  const gy = Math.min(groundAtU(s, windSide, Math.max(0, Math.min(L, u0)), L), groundAtU(s, windSide, Math.max(0, Math.min(L, u1)), L));
  b.withTint([0.9, 0.89, 0.87], () => b.cbox('concrete', u0, gy - 0.5, z, u1, gy + 2.3, z + 0.3, 0.03, false));
  for (let u = u0 + 1; u < u1; u += 2.5) b.box('concrete', u - 0.2, gy - 0.5, z + 0.3, u + 0.2, gy + 1.6, z + 0.9, ALL & ~NY);
  // snow wedge on the lee (building) side of the wall
  b.withTint(E.snowTint, () => {
    b.quad('render_white', u0 + 0.3, gy + 1.7, z - 0.01, u1 - 0.3, gy + 1.7, z - 0.01, u1 - 0.8, gy - 0.03, z - 3.6, u0 + 0.8, gy - 0.03, z - 3.6);
    b.quad('render_white', u0 + 0.3, gy + 0.6, z + 1.0, u1 - 0.3, gy + 0.6, z + 1.0, u1 - 0.3, gy + 1.7, z + 0.31, u0 + 0.3, gy + 1.7, z + 0.31);
  });
  if (b.collecting) b.colBox(u0, gy, z, u1, gy + 2.3, z + 0.3);
  b.pop();
}

/** Pipe gallery: insulated mains on steel trestles leaving side `side`, a bend, a marker light. */
function pipeGallery(ctx, D, side, rng) {
  const b = ctx.b, s = ctx.spec, E = D.E;
  const { w, d, ffl } = D;
  const L = isFB(side) ? w : d;
  b.push(); K.facadeFrame(b, side, w, d, 0);
  const u = L * (0.25 + rng.next() * 0.5);
  const gy = groundAtU(s, side, u, L);
  const yP = gy + 2.6;
  const run = 22, bendDir = rng.next() < 0.5 ? 1 : -1;
  const pts = (du) => [[u + du, ffl + 2.2, -0.1], [u + du, yP + 0.3 + Math.abs(du) * 0.0, 0.8], [u + du, yP + 0.3, run + du * bendDir], [u + du + bendDir * 12, yP + 0.3, run + du * bendDir]];
  for (const du of [-0.45, 0, 0.45]) pipeRun(b, pts(du), du === 0 ? 0.16 : 0.11, { insulated: true, trace: du === 0 });
  // trestles every 4 m (two posts + cross beam + footings), along the run and the bent leg
  const tr = (x, z, along) => {
    const a = along === 'z';
    const p0 = a ? [x - 0.9, z] : [x, z - 0.9], p1 = a ? [x + 0.9, z] : [x, z + 0.9];
    for (const p of [p0, p1]) { b.box('steel', p[0] - 0.08, gy, p[1] - 0.08, p[0] + 0.08, yP + 0.05, p[1] + 0.08, PX | NX | PZ | NZ); b.cbox('concrete', p[0] - 0.3, gy - 0.4, p[1] - 0.3, p[0] + 0.3, gy + 0.12, p[1] + 0.3, 0.01, false); }
    b.box('steel', Math.min(p0[0], p1[0]) - 0.1, yP + 0.05, Math.min(p0[1], p1[1]) - 0.1, Math.max(p0[0], p1[0]) + 0.1, yP + 0.17, Math.max(p0[1], p1[1]) + 0.1, ALL);
  };
  for (let z = 3; z < run; z += 4) tr(u, z, 'z');
  for (let k = 1; k <= 3; k++) tr(u + bendDir * k * 4, run, 'x');
  // marker light at the bend (管廊转折处的标志灯)
  const mx = u - bendDir * 1.4, mz = run + 1.2;
  b.cylinder('steel_yellow', mx, gy, mz, 0.06, 3.4, 8, { top: true });
  b.cylinder('light_red', mx, gy + 3.4, mz, 0.1, 0.22, 10, { top: true });
  b.withTint([1, 1, 1], () => { for (let k = 0; k < 4; k++) b.lathe('steel_dark', [[0.062, 0], [0.062, 0.2]], 8, { x: mx, y: gy + 0.4 + k * 0.6, z: mz }); });
  // snow caps on the pipes
  b.withTint(E.snowTint, () => b.box('render_white', u - 0.6, yP + 0.47, 1.2, u + 0.6, yP + 0.53, run - 0.6, PY | PX | NX));
  b.pop();
}

function massing(spec, ctx) {
  const D = dims(ctx);
  const s = ctx.spec;
  const alongX = D.w >= D.d;
  massVault(ctx.b, -D.w / 2, D.w / 2, -D.d / 2, D.d / 2, D.top, D.rise, [0.86, 0.88, 0.9], { axis: alongX ? 'x' : 'z' });
  return [massVol(-D.w / 2, D.w / 2, -D.d / 2, D.d / 2, Math.min(0, s._ground.min) - 0.5, D.top, { parapet: 0, floorH: D.gh, groundH: D.ffl + D.gh, roofColor: [0.86, 0.88, 0.9] })];
}

export default { name: 'insulated_station', uses: ['insulated_station'], generate, massing };
