// Clinic (诊所 / 社区医院), Zhurong family (owner: buildings-z). Fix round 2 (QY-01): recognisable as a health
// building without labels, in the R2 / Z03 language.
//
// Arrival: drop-off lay-by under a sculpted white shell canopy (lifted elliptic visor on two tapered columns,
// edge light line, downlights, a cyan-cross name light box on its crown) → glazed main door → registration
// lobby (counter under a hanging cross light box, queue display, waiting hall open to it) → front corridor
// whose glass wall looks into the DAYLIGHT COURTYARD: a planted light well cut through every storey (white
// slab bands + glass walls on all four sides, garden with trees / benches at the bottom, open to the sky with
// a glass balustrade on the roof). A ring of two corridors (front / back) and two links round the well;
// consult rooms on the street front (desk + examination couch on a curtain track + sink + chairs), treatment
// rooms / WCs / stores in the middle band and on the back beside the stair + bed-lift core. Ambulance bay on
// a free short side (raised dock, ramp, drive-through canopy with a red cross / 急诊 light box, a parked
// ambulance), staff / supplies through the service door at the back (bins, bikes). Identity at distance: a
// white ceramic sign blade rising 4.5 m above the roof at the front corner with cyan crosses on both faces +
// a vertical glyph column, crosses on the roof stair house, healing roof garden + solar, deep curved
// sunshade bands with large corner radii. Narrow lots (no room for the ring) keep the single-corridor plan
// with the same identity elements.

import * as K from '../kit/index.js';
import { room, resetRoomIds } from '../kit/plan.js';
import { emitFacades, emitBands, emitRoof, emitBase, emitAnchors, rectOf, wallKeys } from '../kit/assemble.js';
import { emitInterior } from '../interior/index.js';
import { plantPot } from '../interior/furniture.js';
import { corridorPlan, publicOpenings, addDoor, stairWindows, pubStoreys, specEntrances, cyanStrip, signTotem, groundAtU, clamp, reception, waitingBench, zMass, sunSide, furnishPublic, glassScreen, lightBox, ledBoard, crossMark, glyphText, solarRack } from './z_common.js';
import { sideGround } from '../kit/plinth.js';

const STOREYS = { gh: 4.8, fh: 4.2, ghMin: 4.5, fhMin: 4.0 };

// ---------------------------------------------------------------------------------------------
// plan: ring of two corridors round a daylight courtyard (light well) — or the single-corridor fallback
// ---------------------------------------------------------------------------------------------
function ringPlan(ctx, S) {
  const s = ctx.spec, st = ctx.style;
  const w = s._w, d = s._d, T = st.wallT;
  const floors = S.floors, nF = floors.length;
  if (nF < 2 || w < 28 || d < 17) return null;
  resetRoomIds();
  const plan = { w, d, ffl: S.ffl, wallT: T, slabT: 0.25, floors, roof: { y: S.roofY, parapet: 1.1, kind: 'flat' }, shared: s._shared, entrances: [], extraOpenings: [], shafts: [], bayW: 3.6 };
  const rng = ctx.sub(901);
  const maxRise = Math.max(S.gh, S.fh);
  const mainE = specEntrances(ctx, 'main').find((e) => e.side === 'front');
  const mainX = mainE ? mainE.u - w / 2 : 0;
  const lobbyW = clamp(w * 0.24, 8, 12.5);
  let coreX = clamp((rng.next() - 0.5) * w * 0.25, -w / 2 + 6, w / 2 - 6);
  if (Math.abs(coreX - mainX) < lobbyW / 2 + 3.2) coreX = mainX + (coreX >= mainX ? 1 : -1) * (lobbyW / 2 + 3.4);
  coreX = clamp(coreX, -w / 2 + T + 3.0, w / 2 - T - 3.0);
  const core = K.coreLayout({ cx: coreX, zBack: -d / 2 + T, towards: 1, maxRise, lift: true, liftSide: rng.next() < 0.5 ? 1 : -1, landingDepth: 1.8 });
  const cw = 2.2;
  const zb0 = core.stair.z1, zb1 = zb0 + cw;                       // back corridor
  const fd = clamp(d * 0.22, 4.2, 5.4);
  const zf1 = d / 2 - fd, zf0 = zf1 - cw;                           // front corridor
  if (zf0 - zb1 < 4.2) return null;                                // middle band too thin for a courtyard
  const Lw = clamp(w * 0.3, 8, 15);
  const xW = clamp(mainX, -w / 2 + cw + Lw / 2 + 4.6, w / 2 - cw - Lw / 2 - 4.6);
  const well = { x0: xW - Lw / 2, x1: xW + Lw / 2, z0: zb1, z1: zf0 };
  plan.core = core; plan.well = well; plan.corridor = { z0: zb0, z1: zb1, single: false, front: [zf0, zf1] };
  const lx0 = clamp(mainX - lobbyW / 2, -w / 2, w / 2 - lobbyW), lx1 = lx0 + lobbyW;
  const split = (x0, x1, mod) => { const zw = x1 - x0, n = Math.max(1, Math.round(zw / mod)), out = []; for (let i = 0; i < n; i++) out.push([x0 + (zw * i) / n, x0 + (zw * (i + 1)) / n, i, n]); return zw < 1.6 ? [] : out; };
  for (const f of floors) {
    const R = f.rooms, L = f.level;
    const stair = room('stair', core.stair.x0, core.stair.x1, -d / 2, core.stair.z1, { floor: L, name: 'stair' });
    R.push(stair);
    const l = core.lift;
    R.push(room('lift', l.x0, l.x1, l.z0, l.z1, { floor: L }));
    if (l.z0 > -d / 2 + 0.6) R.push(room('shaft', l.x0, l.x1, -d / 2, l.z0, { floor: L, name: 'riser', extra: { noWindows: true } }));
    const cb = room('corridor', -w / 2, w / 2, zb0, zb1, { floor: L, name: 'corridor' });
    const cf = room('corridor', -w / 2, w / 2, zf0, zf1, { floor: L, name: 'corridor' });
    stair.doors.push({ to: cb.id, width: 1.2 });
    R.push(cb, cf);
    // links at the courtyard ends (open to both corridors) + the courtyard void (kind 'lift': no floor /
    // ceiling / partitions / colliders from the interior pass; its glass walls are built by lightWell())
    for (const [a, c] of [[well.x0 - cw, well.x0], [well.x1, well.x1 + cw]]) { const k = room('corridor', a, c, zb1, zf0, { floor: L, name: 'link' }); k.open.push(cb.id, cf.id); R.push(k); }
    R.push(room('lift', well.x0, well.x1, well.z0, well.z1, { floor: L, name: 'courtyard', extra: { noWindows: true } }));
    // middle band beside the links: treatment rooms, WCs, stores (doors to the back corridor)
    for (const [x0, x1, sg] of [[-w / 2, well.x0 - cw, -1], [well.x1 + cw, w / 2, 1]]) {
      for (const [a, c, i, n] of split(x0, x1, 4.4)) {
        const nearWell = sg < 0 ? i === n - 1 : i === 0;
        const kind = nearWell ? (L === 0 ? 'bath' : (sg < 0 ? 'bath' : 'storage')) : 'clinic';
        const r = room(kind, a, c, zb1, zf0, { floor: L });
        r.doors.push({ to: (kind === 'clinic' ? cf : cb).id, width: kind === 'clinic' ? 1.2 : 1.0 });
        R.push(r);
      }
    }
    // back band (left / right of the core): consult / treatment, WC + store at the ends
    for (const [x0, x1, sg] of [[-w / 2, core.x0, -1], [core.x1, w / 2, 1]]) {
      for (const [a, c, i, n] of split(x0, x1, 4.2)) {
        const kind = L === 0 ? (i === 0 && sg < 0 ? 'storage' : 'clinic') : (i === 0 && sg < 0 ? 'bath' : i === n - 1 && sg > 0 ? 'storage' : 'clinic');
        const r = room(kind, a, c, -d / 2, zb0, { floor: L });
        r.doors.push({ to: cb.id, width: kind === 'clinic' ? 1.2 : 1.0 });
        R.push(r);
      }
    }
    // front band: ground floor = registration lobby at the main door + waiting halls open to it + consult rooms;
    // upper floors = consult rooms + a waiting area at the front window nearest the courtyard
    const spans = L === 0 ? [[-w / 2, lx0], [lx1, w / 2]] : [[-w / 2, w / 2]];
    if (L === 0) {
      const lob = room('lobby', lx0, lx1, zf1, d / 2, { floor: 0, name: 'lobby' });
      lob.open.push(cf.id);
      R.push(lob);
      plan.lobby = { cx: (lx0 + lx1) / 2, cz: (zf1 + d / 2) / 2, nx: 0, nz: 1, depth: d / 2 - zf1, room: lob };
    }
    let best = null, bestD = 1e9;
    const front = [];
    for (const [x0, x1] of spans) for (const [a, c, i, n] of split(x0, x1, 4.1)) {
      const r = room('clinic', a, c, zf1, d / 2, { floor: L });
      front.push([r, i, n, x0, x1]);
      const dd = Math.abs((a + c) / 2 - xW);
      if (dd < bestD) { bestD = dd; best = r; }
    }
    for (const [r, i, n, x0] of front) {
      const adjLobby = L === 0 && ((x0 < lx0 && i === n - 1) || (x0 >= lx1 - 0.01 && i === 0));
      if (adjLobby) { r.kind = 'waiting'; r.name = 'waiting'; r.open.push(plan.lobby.room.id); r.doors.push({ to: cf.id, width: 1.6 }); }
      else if (L > 0 && r === best) { r.kind = 'waiting'; r.name = 'waiting'; r.open.push(cf.id); }
      else r.doors.push({ to: cf.id, width: 1.2, pos: [r.x0 + 0.85, zf1] });
      R.push(r);
    }
  }
  return plan;
}

function fallbackPlan(ctx, S) {
  const s = ctx.spec;
  const plan = corridorPlan(ctx, {
    storeys: S, corridorW: 2.6, lobbyW: clamp(s._w * 0.3, 9, 15),
    module: (L, zone) => (zone === 'front' ? 4.2 : 4.0),
    kind: (L, zone, i, n) => {
      if (L === 0) return zone === 'back' ? (i === 0 ? 'storage' : 'clinic') : (i === n - 1 ? 'waiting' : 'clinic');
      if (zone === 'back') return i === 0 ? 'bath' : i === n - 1 ? 'storage' : 'clinic';
      return 'clinic';
    },
  });
  plan.bayW = 3.6;
  return plan;
}

// ---------------------------------------------------------------------------------------------
// daylight courtyard: glass walls + white slab bands round the void on every storey, garden at the bottom
// ---------------------------------------------------------------------------------------------
function lightWell(ctx, plan) {
  const b = ctx.b, s = ctx.spec, inst = ctx.inst;
  const W = plan.well, full = ctx.full;
  const nF = plan.floors.length;
  const gk = full ? 'glass_clear' : 'glass_window';
  // four walls in wall frames whose +z faces INTO the courtyard (u along the wall seen from the courtyard)
  const walls = [
    { o: [W.x1, W.z0], u: [-1, 0], n: [0, 1], L: W.x1 - W.x0 },     // back corridor side, faces +z
    { o: [W.x0, W.z1], u: [1, 0], n: [0, -1], L: W.x1 - W.x0 },     // front corridor side, faces −z
    { o: [W.x0, W.z0], u: [0, 1], n: [1, 0], L: W.z1 - W.z0 },      // left link, faces +x
    { o: [W.x1, W.z1], u: [0, -1], n: [-1, 0], L: W.z1 - W.z0 },    // right link, faces −x
  ];
  for (let fi = 0; fi < nF; fi++) {
    const f = plan.floors[fi];
    const yTop = fi === nF - 1 ? plan.roof.y : plan.floors[fi + 1].y;
    const bandLo = fi === 0 ? f.y - 0.02 : f.y - 0.42, bandHi = f.y + 0.4;
    for (const wl of walls) {
      b.push(); b.frame(wl.o[0], 0, wl.o[1], wl.u[0], 0, wl.u[1], 0, 1, 0, wl.n[0], 0, wl.n[1]);
      // white slab band (spandrel) at this floor level, 0.18 m proud of the glass line
      const side = walls.indexOf(wl) >= 2;          // link walls fit between the back / front bands (no overlapping corner boxes)
      b.withTint(inst.bandTint, () => b.cbox('ceramic_band', side ? 0.18 : -0.12, bandLo, -0.1, side ? wl.L - 0.18 : wl.L + 0.12, bandHi, 0.18, 0.03, fi > 0));
      // glazing up to the next band (mullions every ~1.5 m, transom at door height)
      const v0 = bandHi, v1 = (fi === nF - 1 ? yTop : yTop - 0.42);
      if (v1 - v0 > 0.6) {
        const room = { u0: 0.4, w: wl.L + 0.8, d: 2.2, h: Math.max(2.6, f.h - 0.4), sill: 0.4, kind: K.ROOM_KIND.corridor, seed: ((s.hash >>> 5) % 97) / 97, floor: f.level, bay: 900 + fi * 4 + walls.indexOf(wl), hash: s.hash, profile: s._profile | 0 };
        glassScreen(b, { u0: 0.05, u1: wl.L - 0.05, v0, v1, z: 0.0, pane: 1.5, rows: [v0, Math.min(v1, f.y + 2.6), v1].filter((v, i, a) => i === 0 || v > a[i - 1] + 0.3), glassKey: gk, frameKey: 'aluminium', room, back: full });
      }
      if (b.collecting) b.colBox(0, f.y, -0.1, wl.L, f.y + f.h, 0.05);
      b.pop();
    }
  }
  // roof: upstand + glass balustrade round the opening (the courtyard stays open to the sky)
  const ry = plan.roof.y;
  b.withTint(inst.bandTint, () => {
    b.cbox('ceramic_band', W.x0 - 0.3, ry - 0.42, W.z0 - 0.3, W.x1 + 0.3, ry + 0.45, W.z0 + 0.02, 0.03, false);
    b.cbox('ceramic_band', W.x0 - 0.3, ry - 0.42, W.z1 - 0.02, W.x1 + 0.3, ry + 0.45, W.z1 + 0.3, 0.03, false);
    b.cbox('ceramic_band', W.x0 - 0.3, ry - 0.42, W.z0 + 0.02, W.x0 + 0.02, ry + 0.45, W.z1 - 0.02, 0.03, false);
    b.cbox('ceramic_band', W.x1 - 0.02, ry - 0.42, W.z0 + 0.02, W.x1 + 0.3, ry + 0.45, W.z1 - 0.02, 0.03, false);
  });
  K.railing(b, [[W.x0 - 0.15, W.z0 - 0.15], [W.x1 + 0.15, W.z0 - 0.15], [W.x1 + 0.15, W.z1 + 0.15], [W.x0 - 0.15, W.z1 + 0.15]], ry + 0.45, { kind: 'glass', key: 'aluminium', closed: true });
  if (b.collecting) {
    b.colBox(W.x0 - 0.3, ry, W.z0 - 0.3, W.x1 + 0.3, ry + 1.55, W.z0);
    b.colBox(W.x0 - 0.3, ry, W.z1, W.x1 + 0.3, ry + 1.55, W.z1 + 0.3);
    b.colBox(W.x0 - 0.3, ry, W.z0, W.x0, ry + 1.55, W.z1);
    b.colBox(W.x1, ry, W.z0, W.x1 + 0.3, ry + 1.55, W.z1);
  }
  // garden at the bottom: paving frame, planted bed with two trees, gravel path + bench, soft uplight bollards
  const y0 = plan.ffl;
  const gx0 = W.x0 + 0.08, gx1 = W.x1 - 0.08, gz0 = W.z0 + 0.08, gz1 = W.z1 - 0.08;
  b.rectY('paving_stone', gx0, gz0, gx1, gz1, y0 + 0.002, 1);
  const bedZ0 = gz0 + 0.5, bedZ1 = gz1 - 1.6;
  if (bedZ1 - bedZ0 > 1.2) {
    K.planterBox(b, gx0 + 0.6, bedZ0, gx1 - 0.6, bedZ1, y0, 0.45, (s.hash ^ 0x6a1) >>> 0, { tree: true, treeH: Math.min(6.5, plan.floors[1].y - y0 + 2.0), density: 1.0 });
  }
  b.box('roof_gravel', gx0 + 0.3, y0, gz1 - 1.4, gx1 - 0.3, y0 + 0.02, gz1 - 0.3, 4);
  const nb = Math.max(1, Math.floor((gx1 - gx0 - 1) / 4.5));
  for (let i = 0; i < nb; i++) K.bench(b, gx0 + ((gx1 - gx0) * (i + 0.5)) / nb, y0, gz1 - 0.9, Math.PI);
  for (const x of [gx0 + 0.4, gx1 - 0.4]) K.bollard(b, x, y0, gz1 - 0.4);
}

// ---------------------------------------------------------------------------------------------
// roof with the courtyard opening (emitRoof cannot cut an extra hole): parapets, deck with holes, stair house
// with cross light boxes, lift overrun, plant on the service side, healing roof garden, solar, drainage
// ---------------------------------------------------------------------------------------------
function clinicRoof(ctx, plan) {
  const b = ctx.b, s = ctx.spec, st = ctx.style;
  const KW = wallKeys(ctx);
  const top = plan.floors[plan.floors.length - 1];
  const rect = rectOf(plan, top);
  const T = plan.wallT, ry = plan.roof.y;
  const sides = {};
  for (const sd of ['front', 'right', 'back', 'left']) sides[sd] = plan.shared[sd] ? 'firewall' : 'parapet';
  K.parapets(b, rect, ry, plan.roof.parapet, T, { sides, innerKey: KW.soffit, copingKey: st.coping, outerKey: KW.wall });
  const inner = { x0: rect.x0 + T, x1: rect.x1 - T, z0: rect.z0 + T, z1: rect.z1 - T };
  const core = plan.core, st0 = core.stair, W = plan.well;
  const holes = [{ x0: W.x0 - 0.3, x1: W.x1 + 0.3, z0: W.z0 - 0.3, z1: W.z1 + 0.3 }];
  if (plan.floors.length >= 4) holes.push({ x0: st0.x0 + 0.2, x1: st0.x1 - 0.2, z0: st0.z0 + 0.2, z1: st0.z1 - 0.2 });
  const yr = K.roofDeck(b, inner, ry, { key: plan.roof.surface || st.roofSurface, mode: 'ridge', holes });
  const keep = [{ x0: W.x0 - 1.2, x1: W.x1 + 1.2, z0: W.z0 - 1.2, z1: W.z1 + 1.2 }];
  // core exit: stair house (≥ 4 storeys) or hatch, lift overrun; cyan crosses on the stair house sides
  const access = plan.floors.length >= 4;
  const r = { x0: st0.x0 - 0.05, x1: st0.x1 + 0.05, z0: st0.z0 - 0.05, z1: st0.z1 + 0.05 };
  if (access) {
    K.stairHouse(b, r, ry, 2.9, { key: KW.wall, capKey: KW.band, door: 'front' });
    keep.push({ x0: r.x0 - 1.2, x1: r.x1 + 1.2, z0: r.z0 - 1.2, z1: r.z1 + 1.6 });
    plan.roof.access = [(r.x0 + r.x1) / 2, ry, r.z1 + 0.8];
    // cross light boxes on both side walls of the stair house (seen from the street and from the air)
    const zc = (r.z0 + r.z1) / 2;
    for (const [x, rot] of [[r.x0 - 0.02, -Math.PI / 2], [r.x1 + 0.02, Math.PI / 2]]) {
      b.push(); b.translate(x, ry, zc); b.rotY(rot);
      lightBox(b, 0, 0.9, 1.7, 1.7, 0.16, { cross: 'cyan', rows: 0, seed: s.hash });
      b.pop();
    }
  } else {
    const hx = (st0.x0 + st0.x1) / 2, hz = st0.z0 + 0.8;
    K.roofHatch(b, hx, ry, hz, { ladderDepth: ctx.full ? (top.h - plan.slabT) : 0 });
    keep.push({ x0: hx - 1.3, x1: hx + 1.3, z0: hz - 1.4, z1: hz + 1.4 });
    plan.roof.access = [hx, ry + 0.4, hz + 0.9];
  }
  const l = core.lift;
  if (l) { K.liftOverrun(b, { x0: l.x0, x1: l.x1, z0: l.z0, z1: l.z1 }, ry, access ? 3.6 : 1.6, { key: KW.wall, capKey: KW.band }); keep.push({ x0: l.x0 - 0.8, x1: l.x1 + 0.8, z0: l.z0 - 0.8, z1: l.z1 + 0.8 }); }
  // medical-gas / HVAC plant along the back (service side), screened by a louvre fence
  const rng = ctx.sub(931);
  const hz = inner.z0 + 1.0;
  let placed = 0;
  for (let i = 0; i < 12 && placed < 4; i++) {
    const x = inner.x0 + 1.6 + rng.next() * Math.max(0.1, inner.x1 - inner.x0 - 3.2);
    const c = { x0: x - 1.4, x1: x + 1.4, z0: hz - 0.8, z1: hz + 0.9 };
    if (keep.some((k) => k.x0 < c.x1 && k.x1 > c.x0 && k.z0 < c.z1 && k.z1 > c.z0)) continue;
    K.hvacUnit(b, x, yr, hz + 0.05, 0, { w: 2.0, d: 1.0, h: 1.1 });
    keep.push(c); placed++;
  }
  // healing roof garden on the street half (decks, planters, benches, trees), solar on what is left behind
  const gz0 = inner.z0 + (inner.z1 - inner.z0) * 0.36;           // street side of the roof (round the courtyard opening)
  if (inner.z1 - gz0 > 3.0) K.roofGarden(b, { x0: inner.x0 + 0.3, x1: inner.x1 - 0.3, z0: gz0, z1: inner.z1 - 0.3 }, yr, s.hash, { keepOut: keep, deckKey: st.deck });
  keep.push({ x0: inner.x0, x1: inner.x1, z0: gz0, z1: inner.z1 });
  for (const [x0, x1] of [[inner.x0 + 0.8, W.x0 - 1.4], [W.x1 + 1.4, inner.x1 - 0.8]]) {
    const sr = { x0, x1, z0: inner.z0 + 2.6, z1: gz0 - 0.6 };
    if (sr.x1 - sr.x0 > 3 && sr.z1 - sr.z0 > 2.8 && !keep.some((k) => k.x0 < sr.x1 && k.x1 > sr.x0 && k.z0 < sr.z1 && k.z1 > sr.z0)) solarRack(b, sr, yr, { tilt: 0.3, azimuth: s._lat >= 0 ? 0 : Math.PI });
  }
  // scuppers + downpipes on the back facade (front if the back is a party wall)
  const dpSide = plan.shared.back ? 'front' : 'back';
  const L = plan.w, nD = Math.max(2, Math.round(L / 12));
  for (let i = 0; i < nD; i++) {
    const u = i === 0 ? 0.6 : i === nD - 1 ? L - 0.6 : (L * i) / (nD - 1);
    b.push(); K.facadeFrame(b, dpSide, plan.w, plan.d, 0);
    K.scupper(b, u, ry + 0.05);
    K.downpipe(b, u, ry + 0.2, Math.max(groundAtU(s, dpSide, u, L), plan.ffl - 0.3), { key: 'aluminium_dark' });
    b.pop();
  }
  return { yr, inner, keep };
}

// ---------------------------------------------------------------------------------------------
// exterior identity pieces
// ---------------------------------------------------------------------------------------------
/**
 * Sculpted drop-off canopy (current frame = building frame): white shell cantilevered from the facade plane zf
 * with an elliptic outer edge; the surface lifts towards the tip (y = y0 + lift·q^1.6, q = depth fraction),
 * thinning from t at the wall to 0.4 t at the edge. Edge band, soffit downlights, light line under the edge,
 * two tapered columns. Returns {yAt(z) soffit height}.
 */
function shellCanopy(ctx, o) {
  const b = ctx.b, inst = ctx.inst;
  const { cx, zf, hw, D, y0, lift, g0 } = o;
  const t = o.t ?? 0.42;
  const NX = 26, NZ = 7;
  const Y = (z) => y0 + lift * Math.pow(clamp((z - zf) / D, 0, 1), 1.6);
  const Th = (z) => t * (1 - 0.6 * clamp((z - zf) / D, 0, 1));
  const zmax = (x) => zf + D * Math.sqrt(Math.max(0, 1 - Math.pow((x - cx) / hw, 2)));
  const nrm = (z) => { const q = clamp((z - zf) / D, 1e-4, 1), dy = (lift * 1.6 * Math.pow(q, 0.6)) / D, l = Math.hypot(dy, 1); return [0, 1 / l, -dy / l]; };
  const pT = b.part('ceramic_band'), pS = b.part('render_white');
  b.pushTint(inst.bandTint);
  const gT = [], gS = [];
  for (let i = 0; i <= NX; i++) {
    const x = cx - hw + (2 * hw * i) / NX, zm = zmax(x);
    const rT = [], rS = [];
    for (let j = 0; j <= NZ; j++) {
      const z = zf + ((zm - zf) * j) / NZ, n = nrm(z), y = Y(z);
      rT.push(b.vert(pT, x, y, z, n[0], n[1], n[2], x, z));
      rS.push(b.vert(pS, x, y - Th(z), z, -n[0], -n[1], -n[2], x, z));
    }
    gT.push(rT); gS.push(rS);
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    b.q(pT, gT[i][j], gT[i][j + 1], gT[i + 1][j + 1], gT[i + 1][j]);
    b.q(pS, gS[i][j], gS[i + 1][j], gS[i + 1][j + 1], gS[i][j + 1]);
  }
  // outer edge band (thickness) along the ellipse
  for (let i = 0; i < NX; i++) {
    const xa = cx - hw + (2 * hw * i) / NX, xb = cx - hw + (2 * hw * (i + 1)) / NX, za = zmax(xa), zb = zmax(xb);
    b.quad('ceramic_band', xa, Y(za) - Th(za), za, xb, Y(zb) - Th(zb), zb, xb, Y(zb), zb, xa, Y(za), za);
  }
  b.popTint();
  // light line just inside the edge (night-gated) + downlights on a mid-depth arc
  for (let i = 1; i < NX - 1; i++) {
    const xa = cx - hw + (2 * hw * i) / NX, xb = cx - hw + (2 * hw * (i + 1)) / NX;
    const za = zf + (zmax(xa) - zf) * 0.9, zb = zf + (zmax(xb) - zf) * 0.9, za2 = zf + (zmax(xa) - zf) * 0.93, zb2 = zf + (zmax(xb) - zf) * 0.93;
    b.quad('light_warm', xa, Y(za) - Th(za) - 0.012, za, xb, Y(zb) - Th(zb) - 0.012, zb, xb, Y(zb2) - Th(zb2) - 0.012, zb2, xa, Y(za2) - Th(za2) - 0.012, za2);
  }
  const nL = Math.max(3, Math.round(hw / 1.4));
  for (let i = 0; i < nL; i++) {
    const a = Math.PI * ((i + 0.5) / nL), x = cx - Math.cos(a) * hw * 0.6, z = zf + Math.sin(a) * D * 0.5;
    b.cylinder('light_warm', x, Y(z) - Th(z) - 0.008, z, 0.08, 0.008, 12, { top: false, bottom: true });
  }
  // two tapered white columns near the tip
  for (const sg of [-1, 1]) {
    const x = cx + sg * hw * 0.42, z = zf + D * 0.7, yt = Y(z) - Th(z);
    b.withTint(inst.bandTint, () => b.lathe('ceramic_white', [[0.26, 0], [0.26, 0.12], [0.2, 0.2], [0.15, yt - g0 - 0.25], [0.24, yt - g0]], 16, { x, y: g0, z }));
    if (b.collecting) b.colBox(x - 0.26, g0, z - 0.26, x + 0.26, yt, z + 0.26);
  }
  return { Y, Th, zmax };
}

/** White ceramic sign blade rising above the roof at a front corner: cyan crosses on both faces + glyph column. */
function signBlade(ctx, o) {
  const b = ctx.b, inst = ctx.inst, s = ctx.spec;
  const { x, z0, g, yTop } = o;                  // x: blade plane, z0: facade line, blade projects to +z
  const dep = 3.0, th = 0.9;
  const y0 = g - 0.3, H = yTop - y0;
  b.withTint(inst.bandTint, () => {
    // blade body (box) with a half-round nose towards the street: cylinder side + half-disc cap
    const zN = z0 + dep - th / 2;
    b.cbox('ceramic_band', x - th / 2, y0, z0 - 0.4, x + th / 2, yTop, zN, 0.04, false);
    b.cylinder('ceramic_band', x, y0, zN, th / 2, H, 20, { top: false, bottom: false });
    const cap = [];
    for (let k = 0; k <= 10; k++) { const a = (Math.PI * k) / 10; cap.push([x + Math.cos(a) * th / 2, zN + Math.sin(a) * th / 2]); }
    b.polyY('ceramic_band', cap, [], yTop, 1);
  });
  if (b.collecting) b.colBox(x - th / 2, y0, z0 - 0.4, x + th / 2, yTop, z0 + dep);
  // faces: +x and −x — cross light box near the top, vertical glyph light box below it
  for (const sg of [1, -1]) {
    b.push(); b.translate(x + sg * (th / 2 + 0.005), 0, z0 + dep / 2 - 0.2); b.rotY(sg > 0 ? Math.PI / 2 : -Math.PI / 2);
    // in this frame: +z = out of the blade face, x along the blade (towards the street for sg > 0 … mirrored)
    lightBox(b, 0, yTop - 2.9, 2.2, 2.4, 0.14, { cross: 'cyan', rows: 0, seed: s.hash });
    b.cbox('aluminium_dark', -0.55, yTop - 9.2, -0.02, 0.55, yTop - 3.3, 0.12, 0.01, true);
    b.rectZ('signage_blank', -0.5, yTop - 9.15, 0.5, yTop - 3.35, 0.126, 1);
    glyphText(b, -0.32, yTop - 3.75, 0.127, 0.64, 6, (s.hash + (sg > 0 ? 3 : 9)) >>> 0, 'steel_dark', { vertical: true, gap: 0.22 });
    b.pop();
  }
  cyanStrip(b, x - th / 2 - 0.01, z0 + dep - 0.6, x - th / 2 - 0.01, z0 + dep - 0.6, yTop - 0.3, { t: 0.03 });
}

/** Parked ambulance (body facing +z, wheels on y): white box van, high-vis stripes, light bar, cab glazing. */
function ambulance(b, x, y, z, rot) {
  b.push(); b.translate(x, y, z); b.rotY(rot);
  const L = 6.2, W = 2.15;
  b.withTint([1.0, 1.0, 1.0], () => {
    b.cbox('tank_white', -W / 2, 0.45, -L / 2, W / 2, 2.75, L / 2 - 1.6, 0.08, true);       // box body
    b.cbox('tank_white', -W / 2 + 0.02, 0.45, L / 2 - 1.62, W / 2 - 0.02, 2.05, L / 2 - 0.25, 0.12, true);   // cab
    b.cbox('tank_white', -W / 2 + 0.04, 0.45, L / 2 - 0.3, W / 2 - 0.04, 1.05, L / 2, 0.08, true);   // bonnet / bumper
  });
  const stripe = (y0, y1) => { for (const sg of [-1, 1]) b.box('plastic_bin', sg > 0 ? W / 2 - 0.01 : -W / 2 - 0.006, y0, -L / 2 + 0.1, sg > 0 ? W / 2 + 0.006 : -W / 2 + 0.01, y1, L / 2 - 1.7, sg > 0 ? 1 : 2); };
  b.withTint([0.95, 0.42, 0.12], () => stripe(1.15, 1.42));
  b.withTint([0.15, 0.45, 0.85], () => stripe(1.42, 1.55));
  // red crosses on both flanks + rear doors
  for (const sg of [-1, 1]) { b.push(); b.translate(sg * (W / 2 + 0.008), 0, -0.6); b.rotY(sg > 0 ? Math.PI / 2 : -Math.PI / 2); b.withTint([0.85, 0.08, 0.06], () => crossMark(b, 0, 2.05, 0, 0.75, 'plastic_bin', 0.004)); b.pop(); }
  b.push(); b.translate(0, 0, -L / 2 - 0.004); b.rotY(Math.PI); b.withTint([0.85, 0.08, 0.06], () => crossMark(b, 0, 1.9, 0, 0.6, 'plastic_bin', 0.004)); b.pop();
  // windscreen + side windows of the cab (dark glass)
  b.box('black', -W / 2 + 0.12, 1.35, L / 2 - 0.27, W / 2 - 0.12, 1.98, L / 2 - 0.24, 16);
  for (const sg of [-1, 1]) b.box('black', sg * (W / 2 - 0.0) - 0.005, 1.35, L / 2 - 1.45, sg * (W / 2 - 0.0) + 0.005, 1.95, L / 2 - 0.5, sg > 0 ? 1 : 2);
  // light bar (lenses: red / blue tinted plastic, off while parked)
  b.cbox('steel_dark', -0.8, 2.05, L / 2 - 1.2, 0.8, 2.12, L / 2 - 0.95, 0.01, true);
  b.withTint([0.9, 0.12, 0.1], () => b.cbox('plastic_bin', -0.78, 2.12, L / 2 - 1.18, -0.05, 2.24, L / 2 - 0.97, 0.02, false));
  b.withTint([0.12, 0.25, 0.9], () => b.cbox('plastic_bin', 0.05, 2.12, L / 2 - 1.18, 0.78, 2.24, L / 2 - 0.97, 0.02, false));
  // wheels
  for (const zz of [-L / 2 + 1.1, L / 2 - 1.2]) for (const sg of [-1, 1]) { b.push(); b.translate(sg * (W / 2 - 0.12), 0.38, zz); b.rotZ(Math.PI / 2); b.cylinder('rubber', 0, -0.13, 0, 0.38, 0.26, 14, { top: true, bottom: true }); b.pop(); }
  if (b.collecting) b.colBox(-W / 2, 0, -L / 2, W / 2, 2.75, L / 2);
  b.pop();
}

/** Consult room fit-out ('full'): examination couch on a ceiling curtain track, sink cabinet, patient chairs. */
function consultRoom(ctx, r, f, plan) {
  const b = ctx.b, T = plan.wallT;
  const rect = rectOf(plan, f);
  const ix0 = r.x0 + (Math.abs(r.x0 - rect.x0) < 0.02 ? T : 0.06), ix1 = r.x1 - (Math.abs(r.x1 - rect.x1) < 0.02 ? T : 0.06);
  const iz0 = r.z0 + (Math.abs(r.z0 - rect.z0) < 0.02 ? T : 0.06), iz1 = r.z1 - (Math.abs(r.z1 - rect.z1) < 0.02 ? T : 0.06);
  const W = ix1 - ix0, D = iz1 - iz0;
  if (W < 2.6 || D < 3.0) return;
  const front = Math.abs(r.z1 - plan.d / 2) < 0.05;           // window on +z; the corridor door wall is z0
  const zw = front ? iz1 : iz0, zc = front ? iz0 : iz1, sg = front ? 1 : -1;   // window wall / corridor wall
  const y = f.y, ceil = f.y + f.h - plan.slabT;
  // couch along the x1 wall, centred between the corridor wall and the window (head at the window end)
  const cl = Math.min(1.95, D - 1.4), cz = (zw + zc) / 2 + sg * 0.25;
  b.withTint([0.55, 0.7, 0.74], () => b.cbox('fabric', ix1 - 0.72, y + 0.55, cz - cl / 2, ix1 - 0.08, y + 0.68, cz + cl / 2, 0.03, true));
  b.cbox('steel_brushed', ix1 - 0.7, y, cz - cl / 2 + 0.1, ix1 - 0.1, y + 0.55, cz + cl / 2 - 0.1, 0.02, false);
  b.withTint([0.9, 0.92, 0.95], () => b.box('fabric', ix1 - 0.68, y + 0.68, cz + sg * (cl / 2 - 0.45), ix1 - 0.12, y + 0.76, cz + sg * (cl / 2 - 0.05), 63 & ~8));   // pillow
  if (b.collecting) b.colBox(ix1 - 0.72, y, cz - cl / 2, ix1 - 0.08, y + 0.7, cz + cl / 2);
  // curtain track (aluminium) round the couch + a drawn curtain on the room side
  const tx = ix1 - 1.25, tz0 = cz - cl / 2 - 0.25, tz1 = cz + cl / 2 + 0.25;
  b.box('aluminium', tx - 0.02, ceil - 0.06, tz0, tx + 0.02, ceil - 0.03, tz1, 63);
  b.box('aluminium', tx, ceil - 0.06, tz0 - 0.02, ix1 - 0.02, ceil - 0.03, tz0 + 0.02, 63);
  b.box('aluminium', tx, ceil - 0.06, tz1 - 0.02, ix1 - 0.02, ceil - 0.03, tz1 + 0.02, 63);
  const ca = front ? tz1 - (tz1 - tz0) * 0.45 : tz0, cb2 = front ? tz1 : tz0 + (tz1 - tz0) * 0.45;   // drawn at the window end
  b.withTint([0.62, 0.8, 0.8], () => { const n = 8; for (let k = 0; k < n; k++) { const za = ca + ((cb2 - ca) * k) / n, zb = ca + ((cb2 - ca) * (k + 1)) / n; b.quad('fabric', tx + (k % 2 ? 0.05 : -0.05), y + 0.25, za, tx + (k % 2 ? -0.05 : 0.05), y + 0.25, zb, tx + (k % 2 ? -0.05 : 0.05), ceil - 0.08, zb, tx + (k % 2 ? 0.05 : -0.05), ceil - 0.08, za); } });
  // sink cabinet on the x0 wall near the corridor wall (clear of the door at the x0 end of the corridor wall)
  const sz = zc + sg * 1.9;
  if (Math.abs(sz - zc) < D - 0.8) {
    b.cbox('cabinet', ix0 + 0.02, y, sz - 0.5, ix0 + 0.62, y + 0.88, sz + 0.5, 0.01, false);
    b.cbox('counter', ix0 + 0.02, y + 0.88, sz - 0.52, ix0 + 0.65, y + 0.92, sz + 0.52, 0.006);
    b.cylinder('porcelain', ix0 + 0.33, y + 0.86, sz, 0.18, 0.07, 14, { top: false, bottom: true });
    b.cylinder('chrome', ix0 + 0.1, y + 0.92, sz, 0.015, 0.28, 8, { top: true });
    b.box('mirror', ix0 + 0.005, y + 1.15, sz - 0.35, ix0 + 0.015, y + 1.8, sz + 0.35, 1);
    if (b.collecting) b.colBox(ix0, y, sz - 0.5, ix0 + 0.62, y + 0.92, sz + 0.5);
  }
  // two patient chairs facing the doctor's desk (the kit places the desk in the room middle)
  for (const dx of [-0.35, 0.35]) {
    const x = (ix0 + ix1) / 2 - 0.4 + dx, z = zw - sg * 0.7;
    if (Math.abs(x - (ix1 - 0.72)) < 0.9) continue;
    b.push(); b.translate(x, y, z); b.rotY(front ? Math.PI : 0); K.furniture.chair(b, 3); b.pop();
  }
}

/** Drop-off canopy half width + the corner of the sign blade (the lobby side, unless the canopy is in the way). */
function canopyHW(w) { return clamp(w * 0.19, 6.0, 9.0); }
function bladeSide(plan) {
  const w = plan.w, cx = plan.lobby ? plan.lobby.cx : 0, hw = canopyHW(w);
  let right = cx > 0;
  if ((right ? w / 2 - (cx + hw) : (cx - hw) + w / 2) < 3.0) right = !right;     // keep clear of the drop-off canopy
  return { right, bx: right ? w / 2 - 0.55 : -w / 2 + 0.55 };     // blade faces 0.1 m inside the side facade plane (never coplanar)
}

// ---------------------------------------------------------------------------------------------
function generate(spec, lod, ctx) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const S = pubStoreys(ctx, STOREYS);
  const plan = ringPlan(ctx, S) || fallbackPlan(ctx, S);
  const ring = !!plan.well;
  const w = plan.w, d = plan.d, ffl = plan.ffl;
  const lob = plan.lobby;
  // ---- doors ----
  const mainU = lob ? lob.cx + w / 2 : w / 2;
  const doors = [];
  doors.push(addDoor(plan, { side: 'front', u: mainU, w: 2.6, h: 2.7, kind: 'main', room: lob && lob.room, vestibule: st.coveredEntry }));
  const ambSide = s._shared.right ? (s._shared.left ? null : 'left') : 'right';
  const cz0 = plan.corridor.z0, cz1 = plan.corridor.z1, zc = (cz0 + cz1) / 2;
  let amb = null;
  if (ambSide) {
    const u = ambSide === 'right' ? d / 2 - zc : zc + d / 2;
    amb = addDoor(plan, { side: ambSide, u, w: Math.min(2.2, cz1 - cz0 - 0.3), h: 2.5, kind: 'ambulance', entrance: false, doorKind: 'glazed_double' });
    doors.push(amb);
  }
  if (!s._shared.back) {
    const su = w / 2 - (plan.core.x1 + 2.2);
    doors.push(addDoor(plan, { side: 'back', u: clamp(su, 1.5, w - 1.5), w: 1.4, h: 2.3, kind: 'service' }));
  }
  stairWindows(plan, s._shared.back ? 'front' : 'back');
  for (const f of plan.floors) {
    f.openings = publicOpenings(ctx, plan, f, { avoid: doors, rules: { waiting: { sill: 0.2, head: 0.28, frac: 0.9, bay: 2.0 } } });
    // corridor end windows ignore 'avoid' in publicOpenings: drop any window that would overlap a door (ambulance door)
    f.openings = f.openings.filter((op) => !doors.some((dd) => dd.side === op.side && dd.u0 < op.u1 + 0.25 && dd.u1 > op.u0 - 0.25 && dd.v0 < op.v1 && dd.v1 > op.v0));
    // 'exterior' LOD interior mapping: the lobby glass shows a pharmacy wall (shop shelves) instead of the residential
    // lift-lobby + mailbox room, waiting rooms show rows of seats facing a screen (classroom box) — 'full' has the real rooms
    if (!ctx.full) for (const op of f.openings) if (op.room && (op.room.kind === 'lobby' || op.room.kind === 'waiting')) op.room = { ...op.room, kind: op.room.kind === 'lobby' ? 'shop' : 'classroom' };
  }
  // ---- assemble: facades, deep curved sunshade bands with large corner radii, roof, base, interior ----
  emitFacades(ctx, plan, {});
  const sun = sunSide(s);
  if (st.bandShape !== 'none') {
    emitBands(ctx, plan, (L, side) => (L === plan.floors.length ? 0.3 : side === sun ? 1.15 : st.bandShape === 'curved' ? 0.55 : 0.35),
      { railFn: () => null, up: st.bandShape === 'curved' ? 0.12 : 0.08, lights: false, cornerR: 2.6 });
  }
  if (ring) { plan.roofOut = clinicRoof(ctx, plan); lightWell(ctx, plan); }
  else plan.roofOut = emitRoof(ctx, plan, { garden: true, solar: true });
  emitBase(ctx, plan, { canopy: 'none', bikes: true });
  if (ctx.full) emitInterior(ctx, plan, {});
  emitAnchors(ctx, plan);
  // ---- sculpted drop-off canopy over the main entrance + lay-by markings + name light box ----
  const g0 = groundAtU(s, 'front', mainU, w);
  const cx = mainU - w / 2;
  const hw = canopyHW(w), cD = 8.2, cy = ffl + Math.min(plan.floors[0].h - 0.35, 4.4);
  const sh = shellCanopy(ctx, { cx, zf: d / 2 - 0.12, hw, D: cD, y0: cy, lift: 1.1, g0 });
  // name light box standing on the canopy crown (cyan cross + glyph rows), both faces
  { const zt = d / 2 + cD * 0.86, yt = sh.Y(zt);
    lightBox(b, cx, yt - 0.05, Math.min(2 * hw - 3, 7.2), 1.15, zt + 0.12, { cross: 'cyan', rows: 2, seed: s.hash, twoSided: true, depth: 0.24 }); }
  cyanStrip(b, cx - hw * 0.7, d / 2 + 0.12, cx + hw * 0.7, d / 2 + 0.12, cy - 0.5, { t: 0.03 });
  // lay-by: kerb, yellow drop-off box, white bay lines, bollards, wheelchair-bay blue panel
  const zk = d / 2 + cD + 0.4;
  b.cbox('stone_step', cx - hw - 2.0, g0 - 0.3, zk, cx + hw + 2.0, g0 + 0.12, zk + 0.25, 0.02, false);
  b.box('steel_yellow', cx - hw - 1.5, g0 + 0.001, zk + 0.35, cx + hw + 1.5, g0 + 0.012, zk + 0.5, 4);
  for (const sx of [-1, 1]) b.box('tank_white', cx + sx * (hw + 1.5) - 0.06, g0 + 0.001, zk + 0.35, cx + sx * (hw + 1.5) + 0.06, g0 + 0.012, zk + 2.8, 4);
  b.withTint([0.25, 0.45, 0.85], () => b.box('plastic_bin', cx + hw - 2.4, g0 + 0.001, zk + 0.6, cx + hw - 0.6, g0 + 0.012, zk + 2.6, 4));
  for (const sx of [-1, 1]) K.bollard(b, cx + sx * (hw + 0.6), g0, zk - 0.3);
  signTotem(b, clamp(cx - hw - 3.5, -w / 2 + 1, w / 2 - 1), g0, d / 2 + 6.5, 0, { w: 1.0, h: 2.6, cross: 'cyan', seed: s.hash });
  // ---- sign blade at the front corner nearest the entrance, rising 4.5 m above the parapet ----
  { const { right, bx } = bladeSide(plan);
    const gB = groundAtU(s, 'front', right ? w - 0.5 : 0.5, w);
    signBlade(ctx, { x: bx, z0: d / 2, g: gB, yTop: plan.roof.y + plan.roof.parapet + 4.5 }); }
  // ---- glass spine over the entrance (ring plan): the upper-floor waiting bays are glazed almost floor to ceiling,
  // framed by two white ceramic fins rising from the first band to 0.9 m above the parapet (Z03 vertical accent) ----
  if (ring && plan.floors[1]) {
    const wr = plan.floors[1].rooms.find((r) => r.kind === 'waiting' && Math.abs(r.z1 - d / 2) < 0.05);
    if (wr) {
      const yb = plan.floors[1].y - 0.5, yt = plan.roof.y + plan.roof.parapet + 0.9;
      b.withTint(inst.bandTint, () => {
        for (const x of [wr.x0, wr.x1]) {
          b.cbox('ceramic_band', x - 0.22, yb, d / 2 - 0.12, x + 0.22, yt, d / 2 + 0.95, 0.08, true);
        }
        b.cbox('ceramic_band', wr.x0 - 0.22, yt - 0.35, d / 2 - 0.08, wr.x1 + 0.22, yt - 0.02, d / 2 + 0.9, 0.08, true);   // lintel (faces off the fins' faces)
      });
      if (b.collecting) for (const x of [wr.x0, wr.x1]) b.colBox(x - 0.22, yb, d / 2, x + 0.22, yt, d / 2 + 0.95);
    }
  }
  // ---- ambulance bay: raised dock at FFL, ramp, drive-through canopy, red cross / 急诊 light box, ambulance ----
  if (amb) {
    b.push(); K.facadeFrame(b, ambSide, w, d, 0);
    const L = d, u = (amb.u0 + amb.u1) / 2;
    const [ga, gb] = sideGround(s, ambSide);
    const gy = ga + ((gb - ga) * u) / L;
    const dock0 = u - 3.0, dock1 = u + 3.0;
    b.cbox('concrete_smooth', dock0, Math.min(gy, ffl) - 0.5, -0.05, dock1, ffl - 0.005, 3.0, 0.02, false);
    if (b.collecting) b.colQuad(dock0, ffl, 3.0, dock1, ffl, 3.0, dock1, ffl, 0, dock0, ffl, 0);
    b.box('steel_yellow', dock0, ffl - 0.004, 2.75, dock1, ffl + 0.002, 2.95, 4 | 16);
    const rise = ffl - gy;
    if (rise > 0.05) {
      const uEnd = dock1, uStart = Math.min(L - 0.3, uEnd + Math.max(1.5, rise * 12));
      K.rampAlong(b, { uStart, uEnd, y0: gy, y1: ffl, z0: 0.05, z1: 1.8, key: 'paving_stone', railKey: 'steel' });
      K.steps(b, { u0: dock0, u1: dock1 - 2.0, z0: 3.0, y0: gy, y1: ffl, key: 'stone_step', cheeks: false });
    }
    const yC = ffl + 4.4;
    b.withTint(inst.bandTint, () => {
      b.cbox(st.band, u - 6.0, yC - 0.4, -0.1, u + 6.0, yC, 9.0, 0.03);
      for (let i = 0; i < 5; i++) b.cylinder('light_warm', u - 4.8 + i * 2.4, yC - 0.406, 4.5, 0.09, 0.006, 12, { top: false, bottom: true });
      for (const uu of [u - 5.3, u + 5.3]) { K.columnRound(b, 'ceramic_white', uu, 8.3, gy, yC - 0.4, 0.24); if (b.collecting) b.colBox(uu - 0.24, gy, 8.06, uu + 0.24, yC - 0.4, 8.54); }
    });
    // emergency light box on the canopy fascia (red cross + glyphs) and over the door
    lightBox(b, u, yC - 0.02, 5.2, 0.9, 9.02 + 0.2, { cross: 'red', rows: 1, seed: (s.hash + 41) >>> 0, depth: 0.2 });
    lightBox(b, u, ffl + 2.85, 2.6, 0.7, 0.14, { cross: 'red', rows: 1, seed: (s.hash + 43) >>> 0 });
    cyanStrip(b, u - 5.5, 9.02, u + 5.5, 9.02, ffl + 4.1, { t: 0.03 });
    for (const uu of [u - 1.6, u + 1.6]) b.cbox('rubber', uu - 0.9, gy, 6.8, uu + 0.9, gy + 0.15, 7.05, 0.03, false);   // wheel stops
    // hatched no-parking box + parked ambulance (most bays)
    b.box('steel_yellow', u - 3.2, gy + 0.001, 3.2, u + 3.2, gy + 0.012, 3.35, 4);
    if (((s.hash >>> 9) % 10) < 7) ambulance(b, u + 0.2, gy, 7.0, Math.PI);
    b.pop();
    const p = K.facadePoint(ambSide, w, d, u, ffl, 0.6);
    b.anchors.entrances.push({ kind: 'ambulance', side: ambSide, pos: p, dir: K.facadeNormal(ambSide), width: amb.u1 - amb.u0 });
  }
  // ---- interior extras ('full'): registration counter + cross light box, queue boards, waiting, consult rooms ----
  if (ctx.full && lob) {
    const r = lob.room;
    // registration counter facing the door, on the lobby's back edge (open to the corridor / courtyard glass)
    const cxR = lob.cx + (ring ? 1.2 : 0), czR = (ring ? plan.corridor.front[1] : r.z0) + 1.0;
    b.push(); b.translate(cxR, ffl, czR); reception(b, Math.min(4.2, r.x1 - r.x0 - 4)); b.pop();
    // hanging two-sided cross light box over the counter
    { const yc = ffl + plan.floors[0].h - plan.slabT;
      for (const dx of [-1.3, 1.3]) b.box('steel_dark', cxR + dx - 0.015, ffl + 3.05, czR - 0.015, cxR + dx + 0.015, yc, czR + 0.015, 63);
      lightBox(b, cxR, ffl + 2.45, 3.2, 0.62, czR + 0.06, { cross: 'cyan', rows: 1, seed: s.hash ^ 0x11, twoSided: true, depth: 0.12 }); }
    // queue-number display on the lobby side wall + waiting benches facing it
    b.push(); b.translate(r.x1 - 0.06, 0, (r.z0 + r.z1) / 2 + 0.4); b.rotY(-Math.PI / 2); ledBoard(b, 0, ffl + 2.0, 1.8, 0.9, 0, { rows: 4, seed: s.hash }); b.pop();
    const nB = Math.max(1, Math.floor((r.x1 - r.x0 - 3) / 2.8));
    for (let i = 0; i < nB; i++) { b.push(); b.translate(r.x0 + 1.6 + i * 2.8 + 1.2, ffl, d / 2 - 2.4); b.rotY(Math.PI); waitingBench(b, 2.4); b.pop(); }
    b.push(); b.translate(0, ffl, 0); plantPot(b, r.x0 + 0.6, d / 2 - 0.9, 1.3, s.hash >>> 0); plantPot(b, r.x1 - 0.6, d / 2 - 0.9, 1.3, (s.hash + 5) >>> 0); b.pop();
    // waiting rooms: bench rows facing the corridor, planters, info totem, bins (every floor) + a queue board
    for (const f of plan.floors) for (const rr of f.rooms) {
      if (rr.kind === 'waiting') {
        furnishPublic(ctx, { x0: rr.x0 + 0.5, x1: rr.x1 - 0.5, z0: rr.z0 + 0.6, z1: rr.z1 - 0.5 }, f.y, { face: -1, seed: s.hash ^ (rr.id.length * 131 + f.level) });
      }
      if (rr.kind === 'clinic') consultRoom(ctx, rr, f, plan);
    }
    // corridor wayfinding light boxes (arrow + glyphs) at the links / corridor middles
    if (ring) {
      const W = plan.well;
      for (const f of plan.floors) {
        const yb = f.y + Math.min(2.55, f.h - plan.slabT - 0.75);
        for (const zz of [(plan.corridor.z0 + plan.corridor.z1) / 2, (plan.corridor.front[0] + plan.corridor.front[1]) / 2]) {
          for (const [xx, dir] of [[W.x0 - 1.1, -1], [W.x1 + 1.1, 1]]) {
            b.push(); b.translate(xx, 0, zz); b.rotY(Math.PI / 2);
            b.box('steel_dark', -0.012, yb + 0.5, -0.012, 0.012, f.y + f.h - plan.slabT, 0.012, 63);
            lightBox(b, 0, yb, 1.6, 0.42, 0.05, { picto: 'arrow', dir, rows: 1, seed: (s.hash + f.level * 7 + (dir > 0 ? 1 : 2)) >>> 0, twoSided: true, depth: 0.1 });
            b.pop();
          }
        }
      }
    }
  }
  // ---- cameras: interior (lobby → registration + courtyard glass), consult room 2F, courtyard view ----
  const C = b.anchors.cameras;
  if (lob) {
    const zt = ring ? (plan.well.z0 + plan.well.z1) / 2 : plan.corridor.z0 - 2;
    C.interior = { pos: [lob.cx + 1.4, ffl + 1.65, d / 2 - 1.3], target: [ring ? (plan.well.x0 + plan.well.x1) / 2 : lob.cx - 2.0, ffl + 1.5, zt] };
  }
  if (!C.living && plan.floors[1]) {
    const f1 = plan.floors[1];
    const cr = f1.rooms.find((r) => r.kind === 'clinic' && Math.abs(r.z1 - d / 2) < 0.05);
    if (cr) C.living = { pos: [cr.x0 + 0.9, f1.y + 1.65, cr.z0 + 0.7], target: [(cr.x0 + cr.x1) / 2 + 0.6, f1.y + 1.2, d / 2 + 6] };
  }
  if (ring && plan.floors[1]) {
    const f1 = plan.floors[1], W = plan.well;
    C.courtyard = { pos: [W.x0 - 1.0, f1.y + 1.65, plan.corridor.z0 + 0.8], target: [(W.x0 + W.x1) / 2, ffl + 0.5, (W.z0 + W.z1) / 2] };
  }
  b.meta.clinic = { ring, well: plan.well || null };
}

export default {
  name: 'clinic',
  uses: ['clinic'],
  generate,
  massing(spec, ctx) {
    const s = ctx.spec, b = ctx.b;
    const S = pubStoreys(ctx, STOREYS);
    // roof: healing garden on the street half, membrane + plant + solar behind it → a mixed green-grey far colour
    const vols = [zMass(ctx, S, { bayW: 3.6, roofColor: [0.5, 0.55, 0.46] })];
    // sign blade above the parapet (same plan + corner rule as generate) — white at distance
    const { bx } = bladeSide(ringPlan(ctx, S) || fallbackPlan(ctx, S));
    b.pushTint([0.94, 0.93, 0.9]);
    b.box('mass_roof', bx - 0.45, S.roofY - 2, s._d / 2 - 0.4, bx + 0.45, S.roofY + 1.1 + 4.5, s._d / 2 + 2.6, 63 & ~8);
    b.popTint();
    return vols;
  },
};
