// 工务 / 农工宿舍 — O-zone workers' dormitory (2–4 storeys). OWNER: buildings-o.
//
// Practical housing on the kit's plan-first residential pipeline (residential_plan.js: street door → lobby with
// mailboxes → stair core → corridor / through-units → rooms with real windows, back door under the half landing to
// the bin store, 'full' interiors + colliders) in the O-zone utility language: white panel shell with grey slab bands,
// dark aluminium frames, yellow-rail steps, gravel roof. dorm.js runs the same pass sequence as
// residential.generateResidential (plan → facades → bands → roof → base → interior → anchors) so it can add O-zone
// worker-housing structure to the PLAN before the facades are cut:
//   * external steel escape stair on a free gable: stacked straight flights alternating along the wall, a grated
//     landing at every upper floor with a real door into the end unit (the gable window there is dropped), yellow
//     rails, posts, ladder from the top landing to the roof (外部疏散楼梯 / 外廊);
//   * entrance portal: deep steel-framed canopy on two posts beside the steps, yellow fascia, downlights, notice board,
//     bike shelter beside the main door; the back door keeps the kit canopy (polar: the kit's insulated porch);
//   * roof equipment: water tank on a steel stand, solar water heaters (polar: heat-recovery units), roof extract fans
//     in a row, vent stacks, antenna mast;
//   * yard side: drying racks; polar specs (≥ 62° / OX4 / OX6): frost-white insulated shell with thick walls / deep
//     reveals, covered entrance porches, insulated escape-stair doors, snow tongues; dry provinces: lee-side dust.

import * as K from '../kit/index.js';
import { residentialPlan, housePlan, isHouse } from './residential_plan.js';
import { decorateResidential, residentialMassing } from './residential.js';
import { emitFacades, emitRoof, emitBase, emitAnchors } from '../kit/assemble.js';
import { emitInterior } from '../interior/index.js';
import { STYLE_ID } from '../kit/styles.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, isFB, oEnv, drift, steelStair, grating, yellowRail, cagedLadder } from './o_common.js';

function polarStyle(ctx) {
  const E = oEnv(ctx);
  if (E.polar) ctx.style = { ...ctx.style, wall: 'panel_insulated', wallT: 0.46, reveal: 0.3, coveredEntry: true, roofSurface: 'roof_membrane' };
  return E;
}

/**
 * Plan the gable escape stair: pick a free gable (not shared, no entrance), landings alternating between two ends of
 * the wall, one per upper floor, each with a door opening in the plan (conflicting gable windows dropped).
 * Returns the stair layout or null.
 */
function planGableStair(ctx, plan, E) {
  const s = ctx.spec;
  if (plan.house || plan.floors.length < 2) return null;
  const ents = new Set((plan.entrances || []).map((e) => e.side));
  const cands = ['right', 'left'].filter((sd) => !plan.shared[sd] && !ents.has(sd));
  if (!cands.length) return null;
  const side = cands.length > 1 ? ((s.hash >>> 3) & 1 ? 'right' : 'left') : cands[0];
  const L = plan.d, W = 1.1;
  const rMax = Math.max(...plan.floors.slice(1).map((f, i) => f.y - (i === 0 ? Math.min(0, plan.ffl - 0.45) : plan.floors[i].y)));
  const run = Math.max(2, Math.ceil(rMax / 0.19) - 1) * 0.25;
  const need = run + 2 * 1.5 + 0.6;
  if (L < need) return null;
  const uA = (L - run) / 2 - 0.75, uB = (L + run) / 2 + 0.75;           // landing centres (1.5 m landings)
  const landings = [];
  for (let i = 1; i < plan.floors.length; i++) {
    const f = plan.floors[i];
    const u = i % 2 ? uA : uB;
    const door = { side, u0: u - 0.5, u1: u + 0.5, v0: f.y, v1: f.y + 2.1, kind: 'door', doorKind: E.polar ? 'service' : 'glazed', floor: i };
    // drop gable windows of this floor that would cross the door
    f.openings = f.openings.filter((o) => !(o.side === side && o.u1 > door.u0 - 0.35 && o.u0 < door.u1 + 0.35));
    plan.extraOpenings.push(door);
    landings.push({ floor: i, y: f.y, u });
  }
  return { side, L, W, run, uA, uB, landings };
}

/** Build the planned gable stair (wall frame of the gable: x = u, z outward). */
function gableStair(ctx, plan, G, E) {
  const b = ctx.b, s = ctx.spec;
  const [g0, g1] = K.sideGround(s, G.side);
  const gAt = (u) => g0 + ((g1 - g0) * u) / G.L;
  b.push(); K.facadeFrame(b, G.side, plan.w, plan.d, 0);
  const z0 = 0.3, zc = z0 + G.W / 2, z1 = z0 + G.W;
  const postY = Math.min(g0, g1) - 0.3;
  const post = (u, z, y) => { if (y - postY > 0.4) b.box('steel', u - 0.06, postY, z - 0.06, u + 0.06, y, z + 0.06, PX | NX | PZ | NZ); };
  let prev = null;
  for (const Ld of G.landings) {
    const la = Ld.u - 0.75, lb = Ld.u + 0.75;
    grating(b, la, 0.08, lb, z1 + 0.1, Ld.y);
    for (const uu of [la + 0.08, lb - 0.08]) post(uu, z1 + 0.02, Ld.y - 0.16);
    // flight from the previous landing (or the ground) up to this one, running along the wall towards Ld.u
    const toLeft = Ld.u < G.L / 2;                       // landing at the uA end: the flight climbs towards −u
    const footU = toLeft ? lb + G.run : la - G.run;
    const y0 = prev ? prev.y : gAt(footU);
    const rise = Ld.y - y0;
    // every flight spans the same run between the two landing ends (tread stretched for the shorter storeys)
    const nR = Math.max(2, Math.ceil(rise / 0.19));
    steelStair(b, { x: footU, z: zc, y0, rise, dir: toLeft ? Math.PI : 0, W: G.W, rails: 'left', tread: G.run / (nR - 1) });
    const mu = (footU + (toLeft ? lb : la)) / 2;
    post(mu, z1 - 0.04, y0 + rise * 0.5 - 0.4);
    if (!prev) b.cbox('concrete', footU - 0.6, y0 - 0.3, z0 - 0.1, footU + 0.6, y0 + 0.05, z1 + 0.1, 0.01, false);
    // outer rail of the landing (wall side is the facade), opening towards the flight
    yellowRail(b, toLeft ? [[lb - 0.05, Ld.y, z1 + 0.05], [la + 0.05, Ld.y, z1 + 0.05], [la + 0.05, Ld.y, 0.12]] : [[la + 0.05, Ld.y, z1 + 0.05], [lb - 0.05, Ld.y, z1 + 0.05], [lb - 0.05, Ld.y, 0.12]]);
    // wall-side handrail along the flight
    b.tube('steel_yellow', [[footU, y0 + 0.95, 0.24], [toLeft ? lb : la, Ld.y + 0.95, 0.24]], 0.02, 6);
    // wall lamp over the landing door (night: lit escape route)
    K.wallLight(b, Ld.u + 0.75, Ld.y + 2.35);
    if (E.polar) b.withTint(E.snowTint, () => b.box('render_white', la + 0.1, Ld.y, z1 - 0.25, lb - 0.1, Ld.y + 0.03, z1 + 0.05, PY | PZ));
    prev = Ld;
  }
  // caged ladder from the top landing to the roof parapet
  const top = G.landings[G.landings.length - 1];
  if (top && plan.roof && Number.isFinite(plan.roof.y)) {
    const lu = top.u + (top.u < G.L / 2 ? -0.45 : 0.45);
    cagedLadder(b, lu, top.y, 0.05, plan.roof.y + (plan.roof.wallParapet ?? 1.05) - top.y + 0.2, 0, { cageKey: 'steel_yellow' });
  }
  b.pop();
}

/** O-zone entrance portal at the main entrance: canopy on two steel posts beside the steps, notice board, bikes. */
function entrancePortal(ctx, plan, E) {
  const b = ctx.b, s = ctx.spec;
  for (const e of plan.entrances || []) {
    if (e.kind !== 'main' || e.house) continue;
    const L = isFB(e.side) ? plan.w : plan.d;
    const [g0, g1] = K.sideGround(s, e.side);
    const uc = (e.u0 + e.u1) / 2;
    const gy = g0 + ((g1 - g0) * uc) / L;
    const ffl = plan.ffl;
    const hw = (e.u1 - e.u0) / 2 + 1.55, dep = 3.4;
    const u0 = Math.max(0.15, uc - hw), u1 = Math.min(L - 0.15, uc + hw);
    const cy = Math.min(e.v1 + 0.6, plan.floors[0].y + plan.floors[0].h - 0.3);
    b.push(); K.facadeFrame(b, e.side, plan.w, plan.d, 0);
    // canopy slab with a grey soffit, yellow fascia line, gutter + downpipe to the ground at one post
    b.withTint(E.trimTint, () => b.cbox(E.polar ? 'panel_insulated' : 'panel_grey', u0, cy, 0.0, u1, cy + 0.28, dep, 0.02));
    b.withTint([1, 1, 1], () => b.box('steel_yellow', u0, cy + 0.06, dep, u1, cy + 0.16, dep + 0.012, PZ));
    for (const uu of [uc - 0.8, uc + 0.8]) b.cylinder('light_warm', uu, cy - 0.005, dep * 0.55, 0.11, 0.01, 12, { top: false, bottom: true });
    // posts on footings beside the steps (outside the landing / step width)
    for (const uu of [u0 + 0.12, u1 - 0.12]) {
      const py = Math.min(gy, ffl) - 0.05;
      b.cbox('concrete', uu - 0.25, py - 0.3, dep - 0.55, uu + 0.25, py + 0.12, dep - 0.05, 0.015, false);
      b.box('steel_dark', uu - 0.08, py + 0.12, dep - 0.38, uu + 0.08, cy, dep - 0.22, PX | NX | PZ | NZ);
      if (b.collecting) b.colBox(uu - 0.1, py, dep - 0.4, uu + 0.1, cy, dep - 0.2);
    }
    b.tube('aluminium_dark', [[u1 - 0.12, cy + 0.2, dep - 0.1], [u1 - 0.12, Math.min(gy, ffl) + 0.1, dep - 0.1]], 0.04, 6);
    // notice board on the solid wall beside the door + house-number plate
    const nb = e.u0 - 1.35 > 0.4 ? e.u0 - 1.35 : e.u1 + 1.35;
    if (nb > 0.5 && nb < L - 0.5) {
      b.withTint([0.32, 0.45, 0.58], () => b.cbox('steel_dark', nb - 0.55, ffl + 1.0, 0.0, nb + 0.55, ffl + 1.85, 0.06, 0.008));
      b.box('panel_white', nb - 0.48, ffl + 1.07, 0.06, nb + 0.48, ffl + 1.78, 0.064, PZ);
    }
    // bike shelter (steel frame, curved roof) beside the portal on the side away from the ramp
    const bu = u1 + 1.0 + 3.0 < L - 0.3 ? u1 + 1.0 : u0 - 1.0 - 3.0 > 0.3 ? u0 - 4.0 : null;
    if (bu !== null && !E.polar) {
      const yb = Math.min(gy, ffl) - 0.02;
      for (const uu of [bu + 0.1, bu + 2.9]) b.box('steel_dark', uu - 0.04, yb, 2.6, uu + 0.04, yb + 2.1, 2.68, PX | NX | PZ | NZ);
      b.withTint(E.trimTint, () => b.box('panel_grey', bu, yb + 2.1, 0.9, bu + 3.0, yb + 2.18, 2.9, ALL));
      K.bikeRacks && K.bikeRacks(b, bu + 0.3, 1.7, yb, 4);
    }
    b.pop();
  }
}

/** Roof extract fans in a row along the service side + vent stacks (current frame, roof level y). */
function roofFans(b, x0, x1, z, y, n) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    b.cbox('concrete', x - 0.45, y, z - 0.45, x + 0.45, y + 0.2, z + 0.45, 0.01, false);
    b.lathe('aluminium', [[0.36, 0], [0.36, 0.42], [0.4, 0.44], [0.4, 0.5]], 14, { x, y: y + 0.2, z });
    b.lathe('aluminium', [[0.46, 0], [0.46, 0.04], [0.22, 0.24], [0, 0.26]], 14, { x, y: y + 0.78, z });
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; b.box('steel', x + Math.cos(a) * 0.4 - 0.012, y + 0.68, z + Math.sin(a) * 0.4 - 0.012, x + Math.cos(a) * 0.4 + 0.012, y + 0.8, z + Math.sin(a) * 0.4 + 0.012, ALL); }
    b.cylinder('grille_dark', x, y + 0.7, z, 0.36, 0.02, 14, { top: true });
  }
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const E = polarStyle(ctx);
  // ---- plan (+ O-zone additions before the facades are cut) ----
  const po = {};
  const plan = isHouse(ctx.spec, po) ? housePlan(ctx, po) : residentialPlan(ctx, po);
  const GS = planGableStair(ctx, plan, E);
  // ---- the residential pass sequence (residential.generateResidential) ----
  emitFacades(ctx, plan);
  decorateResidential(ctx, plan, {});
  emitRoof(ctx, plan, { garden: plan.roof.kind === 'garden', solar: false });
  emitBase(ctx, plan, { canopy: E.polar ? undefined : 'none', ramp: !plan.house, binStore: !plan.house });
  if (ctx.full) emitInterior(ctx, plan);
  emitAnchors(ctx, plan);
  b.meta.style = ctx.style.id; b.meta.styleId = STYLE_ID[ctx.style.id];
  // ---- O-zone worker-housing structure ----
  if (GS) gableStair(ctx, plan, GS, E);
  if (!E.polar) entrancePortal(ctx, plan, E);
  const rng = ctx.sub(2301);
  const w = s._w, d = s._d;
  // ---- roof: water tank on a steel stand, solar water heaters / heat-recovery units, extract fans ----
  const ry = plan.roof && Number.isFinite(plan.roof.y) ? plan.roof.y : s._ffl;
  if (Number.isFinite(ry) && w > 8 && d > 7 && plan.roof.kind !== 'pitched') {
    const T = ctx.style.wallT || 0.32;
    const x = -w / 2 + T + 2.2, z = -d / 2 + T + 1.6;
    for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]]) b.box('steel', x + dx - 0.05, ry, z + dz - 0.05, x + dx + 0.05, ry + 1.1, z + dz + 0.05, PX | NX | PZ | NZ);
    b.box('steel', x - 0.85, ry + 1.05, z - 0.85, x + 0.85, ry + 1.15, z + 0.85, ALL);
    K.waterTank(b, x, ry + 1.15, z, 0.75, 1.6);
    const n = Math.max(1, Math.min(4, Math.floor((w - 8) / 5)));
    if (!E.polar) {
      if (rng.next() < 0.8) for (let k = 0; k < n; k++) solarHeater(b, x + 3 + k * 2.6, ry, z + 0.4, s._lat >= 0 ? 1 : -1);
    } else {
      for (let k = 0; k < Math.min(2, n); k++) K.hvacUnit(b, x + 3.2 + k * 2.8, ry, z + 0.6, 0, { w: 2.2, d: 1.1, h: 1.2 });
    }
    roofFans(b, -w / 2 + T + 1.2 + w * 0.35, w / 2 - T - 1.4, d / 2 - T - 1.3, ry, Math.max(1, Math.min(4, Math.round(w / 9))));
    for (let k = 0; k < 3; k++) b.cylinder('steel', -w / 2 + T + 1.0 + k * 0.6, ry, d / 2 - T - 0.8, 0.06, 0.9, 8, { top: true });
    K.antennaMast(b, w / 2 - T - 0.9, ry, -d / 2 + T + 0.9, 4.5, s.hash);
  }
  // ---- yard side: drying racks ----
  if (!s._shared.back && !E.polar) {
    const [g0, g1] = K.sideGround(s, 'back');
    const gy = Math.min(g0, g1);
    b.push(); K.facadeFrame(b, 'back', w, d, 0);
    const n = Math.max(1, Math.min(3, Math.floor(w / 10)));
    for (let k = 0; k < n; k++) {
      const u = w * (k + 0.5) / n + (rng.next() - 0.5) * 2;
      for (const du of [-1.4, 1.4]) b.box('steel', u + du - 0.03, gy, 4.2, u + du + 0.03, gy + 1.9, 4.26, PX | NX | PZ | NZ);
      for (const yy of [1.55, 1.75]) b.tube('steel_brushed', [[u - 1.4, gy + yy, 4.23], [u + 1.4, gy + yy, 4.23]], 0.008, 4);
      for (let j = 0; j < 4; j++) { if (rng.next() < 0.35) continue; const a = u - 1.2 + j * 0.62; const t = [[0.85, 0.82, 0.78], [0.45, 0.6, 0.8], [0.8, 0.45, 0.35], [0.9, 0.85, 0.5]][Math.floor(rng.next() * 4)]; b.withTint(t, () => b.box('fabric', a, gy + 1.0 + rng.next() * 0.2, 4.22, a + 0.45, gy + 1.74, 4.24, PZ | NZ)); }
    }
    b.pop();
  }
  // ---- climate ----
  const skipG = GS ? { [GS.side]: true } : {};
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', h: 0.12, reach: 0.8 });
  if (E.polar) { if (!skipG[E.lee]) drift(ctx, E.lee, { kind: 'snow', h: 0.6, reach: 4.0 }); if (!skipG[E.windward]) drift(ctx, E.windward, { kind: 'snow', h: 0.22, reach: 1.2, seed: 3 }); }
  b.meta.dorm = { polar: E.polar, prov: E.prov, escapeStair: GS ? { side: GS.side, landings: GS.landings.length } : null };
  void SIDES;
}

/** Flat-plate solar water heater on a frame with its tank (current frame), facing the equator. */
function solarHeater(b, x, y, z, ns) {
  const tilt = 0.6;
  b.push(); b.translate(x, y, z); if (ns < 0) b.rotY(Math.PI);
  b.box('steel', -1.0, 0, 0.9, 1.0, 0.06, 0.96, ALL);
  b.box('steel', -1.0, 0, -0.6, 1.0, 0.06, -0.54, ALL);
  b.push(); b.translate(0, 0.15, 0.9); b.rotX(-tilt);
  b.box('aluminium_dark', -1.0, 0, -1.8, 1.0, 0.07, 0, ALL);
  b.withTint([0.25, 0.32, 0.45], () => b.rectY('solar_panel', -0.95, -1.75, 0.95, -0.05, 0.072, 1));
  b.pop();
  b.push(); b.translate(0, 1.25, -0.55); b.rotZ(Math.PI / 2);
  b.lathe('tank_white', [[0, -1.05], [0.22, -1.03], [0.24, -0.95], [0.24, 0.95], [0.22, 1.03], [0, 1.05]], 12, {});
  b.pop();
  for (const sx of [-0.8, 0.8]) b.box('steel', sx - 0.03, 0, -0.6, sx + 0.03, 1.05, -0.54, PX | NX | PZ | NZ);
  b.pop();
}

function massing(spec, ctx) {
  polarStyle(ctx);
  return residentialMassing(spec, ctx);
}

export default { name: 'dorm', uses: ['dorm'], generate, massing };
