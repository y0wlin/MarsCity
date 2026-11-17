// Round residential tower (spec.footprint.shape === 'round'; ZR signature: R2 / Z03 drum towers
// wrapped by continuous white ceramic balcony rings with glass rails and planters, floor-to-ceiling
// blue-grey glazing between the rings, a set-back crown with a roof garden).
//
// Plan: facade = regular n-gon inscribed in the footprint circle (facets ≈ 2.9 m, one glazing unit
// each); central core (switchback stair + two lifts) inside a square corridor ring; four wedge
// apartments per floor separated by radial party walls — living room facets in the middle of each
// wedge (sliders to the balcony ring), bedrooms either side, kitchen and bath facets next to the
// party walls. Ground floor: glazed lobby on the front, café / amenity facets, service door at the
// back. Every window gets a fake-interior room of its real kind and the occupancy ids of its
// apartment (far facade bay = floor(perimU / bayW) with bayW = facet width).
//
// Called by residential_tower.js for round footprints; also usable directly by other types.

import { ringPolygon, polyEdges, polyWalls, polyPlinth, polyParapet, insetPolygon, radialProjector, radialInside, ringBandPath, edgeFrame } from '../kit/polyfacade.js';
import { windowUnit, shopfront, ROOM_KIND, clearGlassRoom } from '../kit/windows.js';
import { doorUnit } from '../kit/doors.js';
import { curvedBand, railing, railLine, bandPlanter } from '../kit/balconies.js';
import { stairFlights, liftStorey, steps, risers } from '../kit/stairs.js';
import { stairHouse, liftOverrun, hvacUnit, roofDeck, antennaMast } from '../kit/roof.js';
import { planterBox } from '../kit/vegetation.js';
import { canopyCurved } from '../kit/structure.js';
import { wallLight, plaque, ribbonFin } from '../kit/facade.js';
import { downpipe } from '../kit/drainage.js';
import { coreLayout, groundSplit } from '../kit/cores.js';
import { solidWall } from '../kit/walls.js';
import * as F from '../interior/furniture.js';
import { clamp, smooth01 } from '../kit/math.js';
import { hash4 } from '../../core/hash.js';
import { STYLE_ID } from '../kit/styles.js';

const KIND_AT = ['living', 'living', 'bedroom', 'bedroom', 'kitchen', 'bath'];

/** Storey stack + radii shared by the generator and the massing. */
export function roundTowerStack(ctx) {
  const s = ctx.spec, st = ctx.style;
  const D = Math.min(s._w, s._d), R = D / 2;
  const nF = s._floors;
  const fh = s.floorHeight ? s._fh : st.storeyH;
  const gh = s._gh || 4.5;
  const ffl = Math.max(0.3, s._ground.max * 0.5 + 0.15, Math.max(s._ground.fl, s._ground.fr) + 0.12);
  const crown = nF >= 12 ? 2 : nF >= 8 ? 1 : 0;
  const floors = [];
  let y = ffl;
  for (let i = 0; i < nF; i++) {
    const k = i - (nF - crown) + 1;
    floors.push({ level: i, y, h: i === 0 ? gh : fh, r: k > 0 ? R - Math.min(k * 1.7, R * 0.22) : R });
    y += floors[i].h;
  }
  let n = Math.max(16, 4 * Math.round((2 * Math.PI * R) / 2.9 / 4));
  return { R, D, nF, fh, gh, ffl, floors, roofY: y, n, bayW: (2 * R * Math.sin(Math.PI / n)) };
}

export function generateRoundTower(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec, st = ctx.style, inst = ctx.inst;
  const S = roundTowerStack(ctx);
  const { R, nF, floors, ffl } = S;
  const T = Math.min(st.wallT, 0.34);
  const full = ctx.full;
  const glassKey = full ? 'glass_clear' : (st.glass || 'glass_window');
  const shopGlass = full ? 'glass_clear' : 'glass_shop';
  const frameKey = inst.frameDark ? 'aluminium_dark' : st.frame;
  const wallKey = st.wall, bandKey = st.band;
  const rngF = ctx.sub(901);
  // ---- core ------------------------------------------------------------------------------------
  const gs = groundSplit(S.gh);
  const core = coreLayout({ cx: -1.25, zBack: -2.6, towards: 1, maxRise: Math.max(S.gh, S.fh), minRun: gs.run, lift: true, liftSide: 1, landingDepth: 1.5, W: 2.8 });
  core.lift2 = { ...core.lift, x0: core.lift.x1 + 0.1, x1: core.lift.x1 + 2.4 };
  core.x1 = core.lift2.x1;
  const cx0 = core.x0 - 0.15, cx1 = core.x1 + 0.15, cz0 = core.stair.z0 - 0.15, cz1 = core.stair.z1 + 0.15;
  const ring = 1.5;
  const rx0 = cx0 - ring, rx1 = cx1 + ring, rz0 = cz0 - ring, rz1 = cz1 + ring;
  // ---- facets → units / room kinds ---------------------------------------------------------------
  const unitsPerFloor = 4;
  const facetInfo = (n, i) => {
    // angle of the facet centre (front = π/2, decreasing clockwise like ringPolygon)
    const a = Math.PI / 2 - (i * 2 * Math.PI) / n;
    // units centred on the diagonals so the front facet sits in a unit's living zone? no: party walls on the diagonals
    const t = ((Math.PI / 2 - a) / (2 * Math.PI)) * unitsPerFloor + 0.5;            // unit coordinate
    const unit = ((Math.floor(t) % unitsPerFloor) + unitsPerFloor) % unitsPerFloor;
    const f = t - Math.floor(t);                                                       // 0..1 across the unit
    const per = n / unitsPerFloor;
    const k = Math.floor(f * per);                                                     // facet index in unit
    const mid = Math.abs(f - 0.5);
    let kind;
    if (mid < 0.18) kind = 'living';
    else if (k === 0) kind = 'bath';
    else if (k === per - 1) kind = 'kitchen';
    else kind = 'bedroom';
    return { a, unit, f, kind };
  };
  // ---- facades per floor group (crown floors are separate rings) ---------------------------------
  const groups = [];
  for (let i = 0; i < nF; i++) { const g = groups[groups.length - 1]; if (g && Math.abs(floors[g.i0].r - floors[i].r) < 1e-3) g.i1 = i; else groups.push({ i0: i, i1: i, r: floors[i].r }); }
  const roofY = S.roofY;
  const bandFor = (L) => L >= 1 && L < nF;    // ring band at the slab of floor L
  const allWindows = [];
  for (const g of groups) {
    const n = g.r === R ? S.n : Math.max(12, 4 * Math.round((2 * Math.PI * g.r) / 2.9 / 4));
    const poly = ringPolygon(0, 0, g.r, n);
    const y0 = g.i0 === 0 ? ffl : floors[g.i0].y;
    const top = g.i1 === nF - 1;
    const y1 = top ? roofY + 0.35 : floors[g.i1 + 1].y + (floors[g.i1 + 1].r < g.r - 0.05 ? 0.3 : 0);
    polyWalls(b, poly, {
      y0, y1, T, outer: wallKey, inner: full ? 'plaster' : null, innerReveals: full, tint: inst.shellTint,
      // interior plaster stops at the roof slab / the next floor (the parapet / upstand has its own inner face)
      innerY1: top ? roofY : floors[g.i1 + 1].y,
      openings: (e) => {
        const ops = [];
        for (let fi = g.i0; fi <= g.i1; fi++) {
          const f = floors[fi], info = facetInfo(n, e.i);
          const head = f.y + f.h - 0.22 - 0.1;
          if (fi === 0) {
            // ground floor: lobby glazing at the front facets, café / amenity glazing, solid at the back
            const front = info.a > Math.PI / 2 - 0.6 && info.a < Math.PI / 2 + 0.6;
            const back = Math.cos(info.a - (-Math.PI / 2)) > 0.85;
            if (back && !s._shared.back && e.i === Math.round(n / 2)) ops.push({ u0: e.L / 2 - 0.55, u1: e.L / 2 + 0.55, v0: ffl, v1: ffl + 2.15, kind: 'door', doorKind: 'service', fi, info, noSillReveal: true });
            else if (front && e.i === 0) ops.push({ u0: 0.25, u1: e.L - 0.25, v0: ffl, v1: ffl + 2.6, kind: 'door', doorKind: 'glazed_double', fi, info, noSillReveal: true, main: true });
            else if (!back) ops.push({ u0: 0.18, u1: e.L - 0.18, v0: ffl + 0.0, v1: Math.min(head, ffl + 3.4), kind: 'shop', fi, info, noSillReveal: true, lobby: front });
            else ops.push({ u0: e.L / 2 - 0.45, u1: e.L / 2 + 0.45, v0: ffl + 1.7, v1: ffl + 2.5, kind: 'vent', fi, info });
            continue;
          }
          const k = info.kind;
          if (k === 'living') ops.push({ u0: 0.12, u1: e.L - 0.12, v0: f.y + 0.02, v1: head, kind: 'slider', fi, info, noSillReveal: true });
          else if (k === 'bedroom') ops.push({ u0: 0.3, u1: e.L - 0.3, v0: f.y + 0.05, v1: head, kind: 'tall', fi, info, noSillReveal: true });
          else if (k === 'kitchen') ops.push({ u0: e.L / 2 - 0.65, u1: e.L / 2 + 0.65, v0: f.y + 1.0, v1: head - 0.05, kind: 'casement', fi, info });
          else ops.push({ u0: e.L / 2 - 0.35, u1: e.L / 2 + 0.35, v0: f.y + 1.5, v1: head - 0.1, kind: 'small', fi, info, frosted: true });
        }
        return ops;
      },
      units: (e, ops) => {
        for (const o of ops) {
          const f = floors[o.fi];
          const room = { u0: 0.35, w: e.L + 0.7, d: clamp(g.r - 6.2, 3.2, 6.5), h: f.h - 0.22, sill: o.v0 - f.y, kind: ROOM_KIND[o.info.kind] ?? ROOM_KIND.living, seed: (hash4(s.hash, o.fi, e.i, 7) & 1023) / 1023, floor: o.fi, bay: Math.floor((e.perimU + e.L / 2) / S.bayW), hash: s.hash, profile: s._profile | 0 };
          if (o.fi === 0) { room.kind = o.lobby ? ROOM_KIND.lobby : ROOM_KIND.shop; room.d = 5; }
          allWindows.push({ fi: o.fi, e, o, room });
          const common = { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R: st.reveal, frameKey, glassKey, room, inner: full, T };
          switch (o.kind) {
            case 'slider': windowUnit(b, { ...common, type: 'slider', sillKey: null }); break;
            case 'tall': windowUnit(b, { ...common, type: 'tall', sillKey: null, cols: 2 }); break;
            case 'casement': windowUnit(b, { ...common, type: 'casement' }); break;
            case 'small': windowUnit(b, { ...common, type: 'small', glassKey: 'glass_frosted' }); break;
            case 'shop': shopfront(b, { ...common, R: 0.12, glassKey: shopGlass, frameKey: 'aluminium_dark', paneWidth: 1.4 }); break;
            case 'vent': { b.push(); b.box('grille_dark', o.u0, o.v0, -0.1, o.u1, o.v1, -0.09, 16); b.pop(); break; }
            case 'door':
              // 'full': the ground-floor front / back facets have no wall collider → doors render open
              doorUnit(b, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R: 0.2, kind: o.doorKind, glassKey: shopGlass, room: { ...room, kind: ROOM_KIND.lobby }, open: full ? (o.doorKind === 'service' ? 0.8 : 0.72) : 0 });
              break;
            default: break;
          }
        }
        clearGlassRoom(b);
      },
    });
  }
  // ---- balcony rings --------------------------------------------------------------------------------
  const rB = ctx.sub(902);
  const deep = st.balconyDepth[0] + (st.balconyDepth[1] - st.balconyDepth[0]) * rB.next();
  const wave = inst.bandWave || 0.3;
  const phase = rB.next() * Math.PI * 2;
  for (let L = 1; L <= nF; L++) {
    const below = floors[L - 1];
    const y = L < nF ? floors[L].y : roofY;
    const r = below.r;
    const topBand = L === nF || floors[L].r < r - 0.05;
    const depthFn = topBand ? () => (L === nF ? 0.55 : Math.max(0.6, r - floors[L].r + 0.25)) : (a) => {
      // bulges in front of each wedge's living facets (unit centres at the front / right / back / left)
      const u = Math.cos(4 * (a - Math.PI / 2));      // +1 at unit centres
      return deep * (0.82 + 0.1 * Math.sin(3 * a + phase)) + wave * Math.max(0, u) * 0.9;
    };
    const path = ringBandPath(0, 0, r, depthFn, 0.5);
    b.pushTint(inst.bandTint);
    curvedBand(b, path, y, { w: 2 * r, d: 2 * r, key: bandKey, deckKey: st.deck, soffitKey: st.soffit, up: 0.3, project: radialProjector(0, 0, r), inside: radialInside(0, 0, r), lights: true });
    b.popTint();
    if (!topBand || L === nF) railing(b, railLine(path, 0.13), y - 0.03, { kind: inst.railing === 'glass' ? 'glass' : 'bars', key: inst.railing === 'glass' ? 'aluminium' : st.railKey, closed: true, startH: 0.3 });
    // planters on the deep bulges
    if (!topBand && inst.planterDensity > 0.1) {
      const per = (2 * Math.PI * (r + deep)) / 4;
      for (let q = 0; q < 4; q++) {
        if (rngF.next() > inst.planterDensity) continue;
        const sMid = per * q + per * 0.5 * 0.0 + 0.0;   // path starts at the front (unit 0 centre)
        bandPlanter(b, path, sMid - 1.4, sMid + 1.4, y, (s.hash + L * 31 + q) >>> 0);
      }
    }
    // crown terraces: planters on the set-back terrace
    if (topBand && L < nF) {
      const rt = floors[L].r;
      for (let q = 0; q < 8; q++) {
        if ((q + L) % 2) continue;
        const a = Math.PI / 2 - (q / 8) * 2 * Math.PI;
        const cx = Math.cos(a) * (rt + 0.75), cz = Math.sin(a) * (rt + 0.75);
        b.push(); b.translate(cx, 0, cz); b.rotY(-a + Math.PI / 2);
        planterBox(b, -1.0, -0.35, 1.0, 0.35, y - 0.03, 0.5, (s.hash + q * 7 + L) >>> 0, { tree: q % 4 === 0, treeH: 2.6, density: 1.6, key: bandKey });
        b.pop();
      }
    }
  }
  // ---- sweeping fins on the front (ZR signature) ---------------------------------------------------
  if (inst.fins && st.bandShape === 'curved') {
    for (const sg of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const a = Math.PI / 2 + sg * (0.55 + 0.35 * Math.sin(t * Math.PI));
        const rr = (R + deep + 0.5) * (1 - t) + (floors[nF - 1].r + 0.9) * t + 0.5 * Math.sin(t * Math.PI);
        pts.push([Math.cos(a) * rr, ffl + (roofY + 1.6 - ffl) * t, Math.sin(a) * rr]);
      }
      b.withTint(inst.bandTint, () => ribbonFin(b, pts, { width: 1.5, thickness: 0.6, samples: 6 }));
    }
  }
  // ---- roof ------------------------------------------------------------------------------------------
  const rTop = floors[nF - 1].r;
  const roofPoly = ringPolygon(0, 0, rTop, Math.max(12, 4 * Math.round((2 * Math.PI * rTop) / 2.9 / 4)));
  polyParapet(b, roofPoly, roofY, 0.35, T, { innerKey: st.soffit, copingKey: st.coping });
  const inner = insetPolygon(roofPoly, T);
  // the stair well stays open under the stair house (the last flight climbs to a roof-level landing,
  // roundInterior) — the deck used to close it: no headroom, the roof could not be reached on foot
  const st0 = core.stair;
  const well = [[st0.x0 + 0.2, st0.z1 - 0.2], [st0.x1 - 0.2, st0.z1 - 0.2], [st0.x1 - 0.2, st0.z0 + 0.2], [st0.x0 + 0.2, st0.z0 + 0.2]];
  b.polyY(st.roofSurface || 'roof_membrane', inner, [well], roofY + 0.04, 1);
  if (b.collecting) b.colPolyY(inner, [well], roofY + 0.04);
  stairHouse(b, { x0: st0.x0 - 0.05, x1: st0.x1 + 0.05, z0: st0.z0 - 0.05, z1: st0.z1 + 0.05 }, roofY, 2.9, { key: wallKey, capKey: bandKey, door: 'front' });
  liftOverrun(b, { x0: core.lift.x0, x1: core.lift2.x1, z0: core.lift.z0, z1: core.lift.z1 }, roofY, 3.6, { key: wallKey, capKey: bandKey });
  // roof garden ring + plant at the back
  const rg = ctx.sub(903);
  const nP = 10;
  for (let q = 0; q < nP; q++) {
    const a = Math.PI / 2 - ((q + 0.5) / nP) * 2 * Math.PI;
    if (Math.sin(a) < -0.55 && q % 2) continue;
    const rr = rTop - T - 1.0;
    b.push(); b.translate(Math.cos(a) * rr, 0, Math.sin(a) * rr); b.rotY(-a + Math.PI / 2);
    planterBox(b, -1.2, -0.45, 1.2, 0.45, roofY + 0.04, 0.55, (s.hash * 3 + q) >>> 0, { tree: q % 3 === 0, treeH: 2.8 + rg.next() * 1.4, density: 1.4, key: bandKey });
    b.pop();
  }
  for (let q = 0; q < 2; q++) hvacUnit(b, -3 + q * 3.2, roofY + 0.04, core.stair.z0 - 2.4, 0, { w: 2.2, d: 1.1, h: 1.1 });
  if (rg.next() < 0.6) antennaMast(b, core.lift2.x1 + 1.5, roofY + 0.04, core.lift.z1 - 0.5, 4 + rg.next() * 3, s.hash);
  // downpipes in the facet joints at the back (rainwater from the rings and roof)
  const edges0 = polyEdges(ringPolygon(0, 0, R, S.n));
  for (const ei of [Math.round(S.n * 0.4), Math.round(S.n * 0.6)]) {
    const e = edges0[ei % edges0.length];
    b.push(); edgeFrame(b, e); downpipe(b, 0.12, roofY - 0.3, Math.min(s._ground.min, 0) + 0.02, { key: 'aluminium_dark', head: false }); b.pop();
  }
  // ---- base: plinth, entrance steps + canopy ---------------------------------------------------------
  const ringPoly0 = ringPolygon(0, 0, R, S.n);
  b.withTint(inst.shellTint, () => polyPlinth(b, ringPoly0, ffl, (x, z) => groundRel(s, x, z), { key: st.plinth }));
  {
    const e = edges0[0];
    b.push(); edgeFrame(b, e);
    const gy = groundRel(s, (e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2 + 2);
    b.cbox('paving_stone', -0.6, Math.min(gy, ffl) - 0.45, 0.0, e.L + 0.6, ffl - 0.005, 2.0, 0.012, false);
    if (b.collecting) b.colQuad(-0.6, ffl, 2.0, e.L + 0.6, ffl, 2.0, e.L + 0.6, ffl, 0, -0.6, ffl, 0);
    if (ffl - gy > 0.04) steps(b, { u0: -0.6, u1: e.L + 0.6, z0: 2.0, y0: gy, y1: ffl, key: 'stone_step', cheeks: ffl - gy > 0.5, rails: ffl - gy > 0.45 });
    b.pushTint(inst.bandTint);
    canopyCurved(b, { u0: -1.6, u1: e.L + 1.6, y: ffl + 3.25, depth: 3.0, key: bandKey });
    b.popTint();
    const lw = wallLight; void lw;
    b.pop();
    // lights + plaque on the solid facet joints beside the door
    for (const [ei, u, pq] of [[S.n - 1, edges0[S.n - 1].L - 0.25, false], [1, 0.25, true]]) {
      const e2 = edges0[ei];
      b.push(); edgeFrame(b, e2);
      if (pq) plaque(b, 0.32, ffl + 1.45);
      b.pop();
      void u;
    }
  }
  // ---- interiors ('full') ------------------------------------------------------------------------------
  const plan = { w: 2 * R, d: 2 * R, ffl, wallT: T, slabT: 0.22, floors: floors.map((f) => ({ level: f.level, y: f.y, h: f.h, rooms: [], openings: [], inset: {} })), roof: { y: roofY, access: [0, roofY, st0.z1 + 0.8] }, core, shared: s._shared, entrances: [], bayW: S.bayW };
  if (full) roundInterior(ctx, S, core, { rx0, rx1, rz0, rz1, cx0, cx1, cz0, cz1 }, plan, allWindows);
  // ---- anchors ------------------------------------------------------------------------------------------
  const A = b.anchors;
  A.floors = floors.map((f) => ({ level: f.level, y: f.y, height: f.h }));
  A.roof = { y: roofY, access: [(st0.x0 + st0.x1) / 2, roofY, st0.z1 + 0.8] };
  A.entrances.push({ kind: 'main', side: 'front', pos: [0, ffl, R + 0.6], dir: [0, 0, 1], width: edges0[0].L - 0.5 });
  if (!s._shared.back) A.entrances.push({ kind: 'service', side: 'back', pos: [0, ffl, -R - 0.6], dir: [0, 0, -1], width: 1.1 });
  A.rooms = [];
  const eye = 1.65;
  A.cameras.street = { pos: [-4, eye, R + 20], target: [0, Math.min(roofY * 0.4, 14), 0] };
  A.cameras.entrance = { pos: [2.2, ffl + eye, R + 6], target: [0, ffl + 1.3, R - 2] };
  A.cameras.lobby = { pos: [0.5, ffl + eye, R - 2.0], target: [-1.5, ffl + 1.2, cz1] };   // clear of the open door leaves
  {
    // on the first flight's axis (stair frame: origin (x1, z1), u = −x, n = −z, flights from 0.12 m in),
    // standing on the floor landing and looking up the flight to the half landing
    const f0 = floors[0], Wl = st0.x1 - st0.x0 - 0.24, Lz = st0.z1 - st0.z0 - 0.02, fw = Math.min(1.25, (Wl - 0.12) / 2);
    const landD = st0.landD ?? 1.4, halfD = st0.halfD ?? 1.3;
    let { n } = risers(f0.h, 0.172); if (n % 2) n++;
    const n1 = n / 2, h = f0.h / n, t1 = Math.min(0.3, Math.max(1.0, Lz - landD - halfD) / Math.max(1, n1 - 1));
    const ax = 0.12 + fw / 2, zc = Math.max(0.42, Math.min(0.6, landD - 0.5)), zA1 = landD + (n1 - 1) * t1;
    A.cameras.stair = { pos: [st0.x1 - ax, f0.y + eye, st0.z1 - zc], target: [st0.x1 - ax, f0.y + n1 * h + 1.25, st0.z1 - zA1 - 0.35] };
  }
  // living (2F): inside the front wedge flat just past its ring door, looking over the sofa group to
  // the street glazing (the old pose stood on the diagonal = on a radial party wall: not walkable)
  if (nF > 1) { const f1 = floors[1], zc = Math.min(rz1 + 1.3, (rz1 + f1.r - T) / 2); A.cameras.living = { pos: [1.8, f1.y + eye, zc], target: [-0.8, f1.y + 1.2, R + 10] }; }
  // room anchors (fix round 3: round towers carried none): ground-floor lobby + café / amenity sides,
  // per upper floor the corridor ring and the four wedge flats (centre half-way between ring and facade)
  for (const f of floors) {
    const rOut = f.r - T;
    const rIn = (am) => { const ca = Math.cos(am), sa = Math.sin(am); const tx = Math.abs(ca) > 1e-6 ? (ca > 0 ? rx1 : rx0) / ca : 1e9, tz = Math.abs(sa) > 1e-6 ? (sa > 0 ? rz1 : rz0) / sa : 1e9; return Math.min(tx, tz); };
    if (f.level === 0) {
      const zl = (rz1 + rOut) / 2;
      A.rooms.push({ floor: 0, name: 'lobby', kind: 'lobby', unit: null, center: [0, f.y, zl], size: [6, f.h, rOut - rz1] });
      for (const am of [0, Math.PI]) { const ri = rIn(am), rm = (ri + rOut) / 2; if (rOut - ri > 1.6) A.rooms.push({ floor: 0, name: 'café', kind: 'shop', unit: null, center: [Math.cos(am) * rm, f.y, Math.sin(am) * rm], size: [rOut - ri, f.h, 6] }); }
      continue;
    }
    A.rooms.push({ floor: f.level, name: 'corridor', kind: 'corridor', unit: null, center: [(rx0 + rx1) / 2, f.y, (cz1 + rz1) / 2], size: [rx1 - rx0, f.h, rz1 - cz1] });
    for (let q = 0; q < 4; q++) {
      const am = Math.PI / 2 - q * Math.PI / 2, ri = rIn(am);
      if (rOut - ri < 1.6) continue;
      const rm = (ri + rOut) / 2;
      A.rooms.push({ floor: f.level, name: 'flat', kind: 'living', unit: `${f.level}-${q}`, center: [Math.cos(am) * rm, f.y, Math.sin(am) * rm], size: [rOut - ri, f.h, rOut - ri] });
    }
  }
  A.cameras.back = { pos: [R * 0.5, eye, -R - 14], target: [0, 5, -R] };
  A.cameras.roof = { pos: [2, roofY + eye, st0.z1 + 3.5], target: [0, roofY + 0.5, R * 0.5] };
  b.meta.style = st.id; b.meta.styleId = STYLE_ID[st.id]; b.meta.round = true;
}

function groundRel(s, x, z) {
  const G = s._ground;
  const tx = clamp(x / s._w + 0.5, 0, 1), tz = clamp(z / s._d + 0.5, 0, 1);
  const front = G.fl + (G.fr - G.fl) * tx, back = G.bl + (G.br - G.bl) * tx;
  return back + (front - back) * tz;
}

/** Interiors of the round tower: slabs, core, corridor ring, wedge units with partitions, furniture. */
function roundInterior(ctx, S, core, Rr, plan, windows) {
  const b = ctx.b, s = ctx.spec;
  const { rx0, rx1, rz0, rz1, cx0, cx1, cz0, cz1 } = Rr;
  const T = plan.wallT, slab = 0.22;
  const nF = S.nF;
  for (let fi = 0; fi < nF; fi++) {
    const f = S.floors[fi];
    const ceil = f.y + f.h - slab;
    const poly = insetPolygon(ringPolygon(0, 0, f.r, f.r === S.R ? S.n : Math.max(12, 4 * Math.round((2 * Math.PI * f.r) / 2.9 / 4))), T);
    const coreHole = [[cx0, cz1], [cx1, cz1], [cx1, cz0], [cx0, cz0]];
    // floor + ceiling with the core cut out; corridor ring in stone
    b.polyY(fi === 0 ? 'stone_floor' : 'wood_floor', poly, [[[rx0, rz1], [rx1, rz1], [rx1, rz0], [rx0, rz0]]], f.y, 1);
    b.polyY(fi === 0 ? 'stone_floor' : 'tile_floor', [[rx0, rz1], [rx1, rz1], [rx1, rz0], [rx0, rz0]], [coreHole], f.y, 1);
    b.withTint([0.97, 0.97, 0.96], () => b.polyY('plaster', poly, [coreHole], ceil, -1));
    if (b.collecting) { b.colPolyY(poly, [coreHole], f.y); }
    // exterior wall colliders (one box per facet, door gaps on the ground floor front / back)
    if (b.collecting) {
      for (const e of polyEdges(ringPolygon(0, 0, f.r, f.r === S.R ? S.n : Math.max(12, 4 * Math.round((2 * Math.PI * f.r) / 2.9 / 4))))) {
        if (fi === 0 && (e.i === 0 || e.i === Math.round(S.n / 2))) {
          // door facet: no wall box, but a threshold across the wall thickness (the floor polygon stops at
          // the inner face, the landing at the outer face — the doorway had no ground and the lobby could
          // not be entered on foot)
          b.push(); edgeFrame(b, e); b.colQuad(0, f.y, 0.05, e.L, f.y, 0.05, e.L, f.y, -T - 0.05, 0, f.y, -T - 0.05); b.pop();
          continue;
        }
        b.push(); edgeFrame(b, e); b.colBox(0, f.y, -T, e.L, f.y + f.h, 0); b.pop();
      }
    }
    // corridor ring walls (around the ring rect) with unit doors at the diagonals
    b.pushTint([0.93, 0.93, 0.91]);
    const runs = fi === 0 ? [] : [[rx0, rz1, rx1, rz1], [rx1, rz1, rx1, rz0], [rx1, rz0, rx0, rz0], [rx0, rz0, rx0, rz1]];
    for (const [x0, z0, x1, z1] of runs) {
      // one apartment door per ring side (each side faces one wedge unit)
      const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      const d0 = L / 2 - 0.5, d1 = L / 2 + 0.5;
      solidWall(b, 'plaster', x0, z0, x0 + ux * d0, z0 + uz * d0, f.y, ceil, 0.2);
      solidWall(b, 'plaster', x0 + ux * d0, z0 + uz * d0, x0 + ux * d1, z0 + uz * d1, f.y + 2.1, ceil, 0.2);
      solidWall(b, 'plaster', x0 + ux * d1, z0 + uz * d1, x1, z1, f.y, ceil, 0.2);
      b.push(); b.translate(x0, 0, z0); b.rotY(-Math.atan2(uz, ux));
      // apartment door leaf (open into the unit) in the gap
      b.push(); b.translate(0, 0, 0.0); b.frame(d0, 0, -0.1, 1, 0, 0, 0, 1, 0, 0, 0, 1);
      b.pop();
      if (b.collecting) { b.colBox(0, f.y, -0.1, d0, ceil, 0.1); b.colBox(d1, f.y, -0.1, L, ceil, 0.1); b.colBox(d0, f.y + 2.1, -0.1, d1, ceil, 0.1); }
      b.pop();
    }
    // radial party walls between the four wedge units (on the diagonals)
    if (fi > 0) {
      for (let q = 0; q < 4; q++) {
        const ab = Math.PI / 4 + q * Math.PI / 2;
        const ca = Math.cos(ab), sa = Math.sin(ab);
        const tx = Math.abs(ca) > 1e-6 ? (ca > 0 ? rx1 : rx0) / ca : 1e9, tz = Math.abs(sa) > 1e-6 ? (sa > 0 ? rz1 : rz0) / sa : 1e9;
        const rIn = Math.min(tx, tz), rOut = f.r - T + 0.02;
        if (rOut - rIn < 0.8) continue;
        solidWall(b, 'plaster', ca * rIn, sa * rIn, ca * rOut, sa * rOut, f.y, ceil, 0.22);
        if (b.collecting) { b.push(); b.translate(ca * rIn, 0, sa * rIn); b.rotY(-Math.atan2(sa, ca)); b.colBox(0, f.y, -0.11, rOut - rIn, ceil, 0.11); b.pop(); }
      }
    }
    b.popTint();
    // core: stair + lifts
    const st = core.stair;
    const top = fi === nF - 1;
    b.push(); b.frame(st.x1, f.y, st.z1, -1, 0, 0, 0, 1, 0, 0, 0, -1);
    b.push(); b.translate(0.12, 0, 0);
    stairFlights(b, { W: st.x1 - st.x0 - 0.24, Lz: st.z1 - st.z0 - 0.02, landD: st.landD, halfD: st.halfD, rise: top ? S.roofY - f.y : f.h, top: false, key: 'stone_floor' });
    b.pop();
    // floor landing, carried 0.16 m past the stair end to the corridor floor (the core hole of the
    // floor polygon is 0.15 m larger than the stair: a slit, and no ground for walkers, at the landing)
    b.rectY('stone_floor', 0.1, -0.16, st.x1 - st.x0 - 0.1, st.landD + 0.02, 0.0, 1);
    if (b.collecting) b.colQuad(0, 0, st.landD + 0.05, st.x1 - st.x0, 0, st.landD + 0.05, st.x1 - st.x0, 0, -0.17, 0, 0, -0.17);
    if (top) {
      // roof-level landing inside the stair house (the roof deck leaves the well open above it)
      const ry = S.roofY - f.y;
      b.rectY('stone_floor', 0.1, -0.2, st.x1 - st.x0 - 0.1, st.landD + 0.02, ry, 1);
      b.withTint([0.95, 0.95, 0.93], () => b.rectY('plaster', 0.1, -0.2, st.x1 - st.x0 - 0.1, st.landD + 0.02, ry - slab, -1));
      if (b.collecting) b.colQuad(0, ry, st.landD + 0.05, st.x1 - st.x0, ry, st.landD + 0.05, st.x1 - st.x0, ry, -0.35, 0, ry, -0.35);
    }
    b.pop();
    b.pushTint([0.92, 0.92, 0.9]);
    solidWall(b, 'plaster', st.x0, st.z0, st.x0, st.z1, f.y, ceil, 0.2);
    solidWall(b, 'plaster', st.x0, st.z0, st.x1, st.z0, f.y, ceil, 0.2);
    b.popTint();
    if (b.collecting) { b.colBox(st.x0 - 0.1, f.y, st.z0, st.x0 + 0.1, ceil, st.z1); b.colBox(st.x0, f.y, st.z0 - 0.1, st.x1, ceil, st.z0 + 0.1); }
    for (const l of [core.lift, core.lift2]) {
      b.push(); b.frame(l.x0, f.y, l.z0, 1, 0, 0, 0, 1, 0, 0, 0, 1);
      liftStorey(b, { W: l.x1 - l.x0, D: l.z1 - l.z0, h: f.h, key: 'ceramic_grey', doorKey: 'steel_brushed' });
      b.pop();
    }
    // light panels per unit + furniture near the facade
    for (let q = 0; q < 4; q++) {
      const am = Math.PI / 2 - q * Math.PI / 2;                     // unit centre angle (front, right, back, left)
      const win = windows.find((w) => w.fi === fi && w.o.info && w.o.info.unit === q && w.o.info.kind === 'living') || windows.find((w) => w.fi === fi);
      const L = win ? win.room : null;
      b.setExtra('iwin1', 0, 0.5, fi, L ? L.bay : 700 + q);
      b.setExtra('iwin2', (s.hash >>> 16) & 0xffff, s.hash & 0xffff, fi === 0 ? ROOM_KIND.lobby : ROOM_KIND.living, s._profile | 0);
      for (const rr of [f.r * 0.45, f.r * 0.72]) {
        const x = Math.cos(am) * rr, z = Math.sin(am) * rr;
        b.box('light_panel', x - 0.3, ceil - 0.025, z - 0.3, x + 0.3, ceil - 0.001, z + 0.3, 1 | 2 | 8 | 16 | 32);
      }
      if (fi === 0) continue;
      // living group facing the window, bed in the side zone
      const rl = f.r - T - 2.6;
      const lx = Math.cos(am) * rl, lz = Math.sin(am) * rl;
      const seed = hash4(s.hash, fi, q, 3) % 97;
      b.push(); b.translate(lx, f.y, lz); b.rotY(-am - Math.PI / 2);
      b.translate(0, 0, -1.2); F.sofa(b, seed); b.translate(0, 0, 1.55); F.rug(b, 2.2, 1.5, seed); F.coffeeTable(b);
      b.pop();
      const ab = am + 0.42;
      const rb = f.r - T - 2.3;
      b.push(); b.translate(Math.cos(ab) * rb, f.y, Math.sin(ab) * rb); b.rotY(-ab + Math.PI / 2);
      F.bed(b, 1.6, seed); b.pop();
      const ak = am - 0.5, rk = Math.max(Math.hypot(rx1, rz1) + 0.6, f.r - T - 4.2);
      b.push(); b.translate(Math.cos(ak) * rk, f.y, Math.sin(ak) * rk); b.rotY(-ak + Math.PI / 2 + Math.PI);
      F.diningSet(b, seed); b.pop();
    }
    b.clearExtra('iwin1'); b.clearExtra('iwin2');
  }
}

/** Mass LOD volumes for a round tower (n-gon prisms; crown rings). */
export function roundTowerMassing(spec, ctx) {
  const S = roundTowerStack(ctx);
  const vols = [];
  let i0 = 0;
  for (let i = 1; i <= S.nF; i++) {
    const a = S.floors[i0], f = S.floors[i];
    if (f && Math.abs(f.r - a.r) < 1e-3) continue;
    const last = S.floors[i - 1];
    vols.push({ round: a.r, n: a.r === S.R ? S.n : Math.max(12, 4 * Math.round((2 * Math.PI * a.r) / 2.9 / 4)), x0: -a.r, x1: a.r, z0: -a.r, z1: a.r, y0: i0 === 0 ? Math.min(0, ctx.spec._ground.min) - 0.5 : a.y, y1: last.y + last.h, parapet: i === S.nF ? 0.35 : 0.3, floorH: S.fh, groundH: S.gh + S.ffl, bayW: S.bayW, blank: {}, garden: true, flags: 4 | 2, bands: true, uBase: 0 });
    i0 = i;
  }
  return vols;
}

void smooth01;
