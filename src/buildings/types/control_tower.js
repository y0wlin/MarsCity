// 监测塔 / 调度塔 — O-zone control & observation tower (O02 right, R1/O01 white towers). OWNER: buildings-o.
//
// Round footprint (spec.footprint round, w = d = 8–9 m). A white cylindrical shaft of insulated panels
// (n-gon facets with real wall thickness, horizontal grey joint bands every storey, small square stair
// windows climbing with the spiral stair), a projecting balcony ring with yellow railing under the cab,
// a fully glazed observation cab (wider than the shaft, raked glass in aluminium mullions, sunshade lip),
// a white crown ring, roof deck with radar dome on a mast, antenna mast + aviation light. An external caged
// ladder runs from the annex roof to the balcony. At the base (spec 'main' entrance side) a door with a
// canopy, steps + yellow handrails; an annex (equipment + duty room) attaches on the right, with its own
// louvres, HVAC unit and cable tray into the shaft. 'full' adds the spiral stair around a central column
// (walkable ramp colliders), annular floors with a guard ring, cab consoles and chairs.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, oEnv, yellowRail, cagedLadder, cabinet, drift, utilAnchors, lampPost, BAY_W } from './o_common.js';
import { consoleDesk, chairSimple } from './o_hall.js';
import { hash4 } from '../../core/hash.js';

function towerDims(ctx) {
  const s = ctx.spec;
  const r = Math.max(3.2, Math.min(6.5, Math.min(s._w, s._d) / 2));
  const nF = Math.max(3, s._floors);
  const fh = Math.max(3.3, Math.min(4.2, s._fh || 3.6));
  const E = oEnv(ctx);
  const ffl = E.ffl + 0.1;
  const cabY = ffl + (nF - 1) * fh;               // cab floor
  const cabH = 3.4;
  const rc = r + 0.55;                            // cab radius (projects past the shaft)
  return { r, nF, fh, ffl, cabY, cabH, rc, top: cabY + cabH + 0.9, E, n: Math.max(16, Math.round((2 * Math.PI * r) / 1.4)) };
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const D = towerDims(ctx);
  const { r, nF, fh, ffl, cabY, cabH, rc, E, n } = D;
  const rng = ctx.sub(1601);
  const T = E.polar ? 0.42 : 0.3;
  const shell = E.polar ? 'panel_insulated' : 'panel_white';
  // the tower frame: main door on the spec's main side (round specs are rotated by heading → front)
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: 0 };
  const doorAng = { front: Math.PI / 2, right: 0, back: -Math.PI / 2, left: Math.PI }[mainE.side] ?? Math.PI / 2;   // plan angle (x = cos, z = sin)
  const poly = K.ringPolygon(0, 0, r, n);
  const edges = K.polyEdges(poly);
  // edge whose midpoint direction is closest to the door angle
  const midAng = (e) => Math.atan2((e.a[1] + e.b[1]) / 2, (e.a[0] + e.b[0]) / 2);
  const angDist = (a, c) => Math.abs(((a - c + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  let doorEdge = 0, bd = 9;
  edges.forEach((e, i) => { const dd = angDist(midAng(e), doorAng); if (dd < bd) { bd = dd; doorEdge = i; } });
  // annex on the right of the door (seen from outside): plan direction doorAng − 90°
  const annexAng = doorAng - Math.PI / 2;
  // stair windows: one small window per storey, rotating with the spiral (~ 140° per storey)
  const winEdge = (lvl) => (doorEdge + Math.round((lvl * 0.39 + 0.25) * n)) % n;
  const yTopShaft = cabY - 0.35;
  // ---- shaft walls ----
  K.polyWalls(b, poly, {
    y0: ffl, y1: yTopShaft, T, outer: shell, inner: ctx.full ? 'plaster' : null, innerReveals: ctx.full, tint: E.shellTint,
    openings: (e) => {
      const ops = [];
      if (e.i === doorEdge) ops.push({ u0: e.L / 2 - 0.55, u1: e.L / 2 + 0.55, v0: ffl, v1: ffl + 2.25, reveal: 0.2, noSillReveal: true });
      for (let l = 1; l < nF - 1; l++) if (winEdge(l) === e.i) ops.push({ u0: e.L / 2 - 0.42, u1: e.L / 2 + 0.42, v0: ffl + l * fh + 1.05, v1: ffl + l * fh + 1.95, reveal: 0.18 });
      if (e.i === (doorEdge + Math.round(n / 2)) % n) ops.push({ u0: e.L / 2 - 0.42, u1: e.L / 2 + 0.42, v0: ffl + 1.1, v1: ffl + 2.0, reveal: 0.18 });
      return ops.filter((o) => o.u0 > 0.05 && o.u1 < e.L - 0.05);
    },
    units: (e, ops) => {
      for (const o of ops) {
        if (o.v0 <= ffl + 0.01) K.doorUnit(b, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R: 0.2, kind: 'service', open: 0, T });
        else {
          const lvl = Math.max(0, Math.floor((o.v0 - ffl) / fh));
          const room = { u0: 0.3, w: 2.4, d: r * 1.4, h: fh - 0.3, sill: 1.05, kind: K.ROOM_KIND.stair, seed: (hash4(s.hash, lvl, e.i, 7) & 1023) / 1023, floor: lvl, bay: Math.floor((e.perimU + e.L / 2) / BAY_W), hash: s.hash, profile: s._profile | 0 };
          K.windowUnit(b, { ...o, R: 0.18, type: 'fixed', cols: 1, frameKey: 'aluminium_dark', glassKey: ctx.full ? 'glass_clear' : 'glass_window', sillKey: 'aluminium', room, inner: ctx.full, T });
        }
      }
    },
  });
  // grey joint bands every storey + kick band (O02 dark rings)
  b.pushTint(E.trimTint);
  const band = (y, h, proud = 0.03) => {
    const pr = K.insetPolygon(poly, -proud);
    for (const e of K.polyEdges(pr)) { b.push(); K.edgeFrame(b, e); b.box('panel_grey', -0.002, y, -0.04, e.L + 0.002, y + h, 0, PZ | PY | NY); b.pop(); }
  };
  band(ffl, 0.5);
  for (let l = 1; l < nF - 1; l++) band(ffl + l * fh - 0.12, 0.2);
  band(yTopShaft - 0.5, 0.5, 0.05);
  b.popTint();
  // base plinth ring
  b.withTint([0.93, 0.92, 0.9], () => b.prism('concrete', K.insetPolygon(poly, -0.12), Math.min(0, s._ground.min) - 0.6, ffl - 0.02, { top: true, bottom: false }));
  // ---- balcony ring under the cab: slab + yellow railing, access door from the cab ----
  const balR = rc + 0.95;
  const balY = cabY - 0.05;
  {
    const ring = K.ringPolygon(0, 0, balR, n);
    const inner = K.ringPolygon(0, 0, r - 0.05, n);
    b.withTint([0.9, 0.9, 0.9], () => b.polyY('concrete_smooth', ring, [inner], balY, 1));
    b.withTint([0.88, 0.88, 0.88], () => b.polyY('panel_grey', ring, [inner], balY - 0.3, -1));
    // slab edge fascia
    for (const e of K.polyEdges(ring)) { b.push(); K.edgeFrame(b, e); b.box('panel_grey', 0, balY - 0.3, -0.02, e.L, balY + 0.02, 0, PZ); b.pop(); }
    yellowRail(b, ring.map(([x, z]) => [x * (balR - 0.08) / balR, balY, z * (balR - 0.08) / balR]), { closed: true, posts: 1.6 });
    // brackets under the balcony
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; b.push(); b.rotY(-a); b.extrudeX('steel_dark', [[r - 0.1, balY - 0.3], [balR - 0.2, balY - 0.3], [r - 0.1, balY - 1.6]].map(([z, y]) => [z, y]), -0.06, 0.06); b.pop(); }
    if (b.collecting) b.colPolyY(ring, [], balY);
  }
  // ---- observation cab: glazed ring, sill band, mullions, crown ----
  {
    const ring = K.ringPolygon(0, 0, rc, n);
    const sillY = cabY + 0.95, headY = cabY + cabH - 0.25;
    b.withTint(E.shellTint, () => {
      b.prism(shell, ring, cabY - 0.35, sillY, { top: false, bottom: true });
      b.prism(shell, K.ringPolygon(0, 0, rc + 0.15, n), headY, cabY + cabH + 0.55, { top: false, bottom: true });
    });
    b.withTint(E.trimTint, () => b.prism('panel_grey', K.ringPolygon(0, 0, rc + 0.22, n), cabY + cabH + 0.55, cabY + cabH + 0.75, { top: true, bottom: true }));
    // raked glazing (top leans out 0.25 m) between mullions
    const out = 0.25;
    const glass = ctx.full ? 'glass_clear' : 'glass_window';
    const room = { u0: 0.3, w: 2.0 * rc, d: 2 * rc - 0.6, h: cabH - 0.3, sill: 0.95, kind: K.ROOM_KIND.office, seed: 0.37, floor: nF - 1, bay: 0, hash: s.hash, profile: s._profile | 0 };
    for (const e of K.polyEdges(ring)) {
      const sc = (rc + out) / rc;
      const a0 = [e.a[0], sillY, e.a[1]], b0 = [e.b[0], sillY, e.b[1]];
      const a1 = [e.a[0] * sc, headY, e.a[1] * sc], b1 = [e.b[0] * sc, headY, e.b[1] * sc];
      K.setGlassRoom(b, { ...room, bay: Math.floor((e.perimU + e.L / 2) / BAY_W) }, 0, 0);
      b.quad(glass, a0[0], a0[1], a0[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], a1[0], a1[1], a1[2], [0, 0, e.L, 0, e.L * sc, headY - sillY, 0, headY - sillY]);
      K.clearGlassRoom(b);
      b.tube('aluminium_dark', [[e.a[0] * 1.004, sillY, e.a[1] * 1.004], [e.a[0] * sc * 1.004, headY, e.a[1] * sc * 1.004]], 0.045, 6);
    }
    b.tube('aluminium_dark', [...ring, ring[0]].map(([x, z]) => [x * 1.01, sillY + 0.02, z * 1.01]), 0.05, 6);
    // sunshade lip over the glass
    const lip = K.ringPolygon(0, 0, rc + out + 0.55, n), lipIn = K.ringPolygon(0, 0, rc + 0.1, n);
    b.withTint(E.trimTint, () => { b.polyY('panel_grey', lip, [lipIn], headY + 0.06, 1); b.polyY('panel_grey', lip, [lipIn], headY - 0.04, -1); });
    for (const e of K.polyEdges(lip)) { b.push(); K.edgeFrame(b, e); b.box('panel_grey', 0, headY - 0.04, -0.03, e.L, headY + 0.06, 0, PZ); b.pop(); }
    // roof deck, parapet coping, radar + antenna + aviation light
    const yr = cabY + cabH + 0.75;
    b.polyY('roof_membrane', K.ringPolygon(0, 0, rc + 0.1, n), [], yr - 0.15, 1);
    // radar dome on a lattice mast
    const ra = 0.5 * rc;
    b.cylinder('steel', ra * Math.cos(doorAng + 2.4), yr - 0.15, ra * Math.sin(doorAng + 2.4), 0.12, 2.2, 10, { top: true });
    b.lathe('tank_white', [[0.0, 0], [0.42, 0.08], [0.6, 0.35], [0.62, 0.6], [0.52, 0.95], [0.3, 1.15], [0.0, 1.22]], 16, { x: ra * Math.cos(doorAng + 2.4), y: yr + 2.05, z: ra * Math.sin(doorAng + 2.4), capTop: true });
    K.antennaMast(b, ra * Math.cos(doorAng - 2.2), yr - 0.15, ra * Math.sin(doorAng - 2.2), 6.5 + rng.next() * 2, s.hash);
    b.cylinder('light_red', ra * Math.cos(doorAng - 2.2), yr + 6.4, ra * Math.sin(doorAng - 2.2), 0.08, 0.16, 8, { top: true });
    // small roof hatch box + HVAC
    b.cbox('panel_grey', -0.6, yr - 0.15, -0.6, 0.6, yr + 0.55, 0.6, 0.02);
    K.hvacUnit(b, ra * Math.cos(doorAng), yr - 0.15, ra * Math.sin(doorAng), -doorAng + Math.PI / 2, { w: 1.2, d: 0.7, h: 0.8 });
    // cab door onto the balcony (one facet: solid door panel in the glazing line)
    {
      const de = K.polyEdges(ring)[(doorEdge + Math.round(n * 0.3)) % n];
      b.push(); K.edgeFrame(b, de);
      b.box('steel_door', de.L / 2 - 0.45, cabY, 0.02, de.L / 2 + 0.45, cabY + 2.15, 0.08, ALL);
      b.box('aluminium_dark', de.L / 2 - 0.5, cabY, 0.0, de.L / 2 + 0.5, cabY + 2.22, 0.1, PY | PX | NX);
      b.pop();
    }
    // cab interior ('full'): floor, ceiling, consoles round the glass, chairs
    if (ctx.full) {
      const fl = K.ringPolygon(0, 0, rc - 0.05, n);
      b.polyY('tile_floor', fl, [K.ringPolygon(0, 0, 1.15, 16)], cabY + 0.01, 1);
      b.withTint([0.94, 0.94, 0.93], () => b.polyY('plaster', fl, [], cabY + cabH - 0.3, -1));
      for (let k = 0; k < 5; k++) {
        const a = doorAng + Math.PI + (k - 2) * 0.62;
        const cr = rc - 0.75;
        consoleDesk(b, Math.cos(a) * cr, cabY, Math.sin(a) * cr, 1.5, Math.PI / 2 - a + Math.PI);
        if (k % 2 === 0) chairSimple(b, Math.cos(a) * (cr - 0.9), cabY, Math.sin(a) * (cr - 0.9), Math.PI / 2 - a + Math.PI);
      }
      if (b.collecting) {
        b.colPolyY(fl, [K.ringPolygon(0, 0, 1.15, 16)], cabY);
        for (const e of K.polyEdges(ring)) { b.push(); K.edgeFrame(b, e); b.colBox(0, cabY, -0.1, e.L, cabY + cabH, 0); b.pop(); }
      }
    }
  }
  // ---- base: door canopy, steps, rails, lamp ----
  {
    const e = edges[doorEdge];
    b.push(); K.edgeFrame(b, e);
    const u = e.L / 2;
    const gy = K.groundAt(s, (e.a[0] + e.b[0]) / 2 + e.nx * 2.2, (e.a[1] + e.b[1]) / 2 + e.nz * 2.2);
    const landD = 1.6;
    b.cbox('concrete_smooth', u - 1.5, Math.min(gy, ffl) - 0.45, 0, u + 1.5, ffl - 0.005, landD, 0.012, false);
    if (b.collecting) b.colQuad(u - 1.5, ffl, landD, u + 1.5, ffl, landD, u + 1.5, ffl, 0, u - 1.5, ffl, 0);
    if (ffl - gy > 0.05) K.steps(b, { u0: u - 1.5, u1: u + 1.5, z0: landD, y0: gy, y1: ffl, key: 'stone_step', cheeks: false, rails: false });
    const nS = Math.max(1, Math.ceil(Math.max(0, ffl - gy) / 0.165)), run = nS * 0.3;
    for (const ux of [u - 1.35, u + 1.35]) {
      const pts = [[ux, ffl + 1.0, 0.25], [ux, ffl + 1.0, landD], [ux, Math.min(gy, ffl) + 1.0, landD + run], [ux, Math.min(gy, ffl) + 1.0, landD + run + 0.3]];
      b.tube('steel_yellow', pts, 0.022, 8, { transport: true });
      b.tube('steel_yellow', pts.map((p) => [p[0], p[1] - 0.5, p[2]]), 0.016, 6, { transport: true });
      for (const z of [0.3, landD, landD + run]) { const yy = z <= landD ? ffl : Math.min(gy, ffl); b.box('steel_yellow', ux - 0.022, yy, z - 0.022, ux + 0.022, yy + 1.0, z + 0.022, PX | NX | PZ | NZ); }
    }
    b.withTint(E.trimTint, () => K.canopyFlat(b, { u0: u - 1.2, u1: u + 1.2, y: ffl + 2.75, depth: 1.5, key: E.polar ? 'panel_insulated' : 'panel_grey', rods: true }));
    K.signPanel(b, u, ffl + 3.05, 1.3, 0.3, { frameKey: 'aluminium_dark' });
    b.pop();
  }
  // ---- annex: equipment + duty room box on the right of the door ----
  const ax = Math.cos(annexAng), az = Math.sin(annexAng);
  const aw = 4.4, ad = 3.8, ah = 3.6;
  const annex = annexBox(ctx, D, annexAng, aw, ad, ah, T, shell);
  // ---- caged ladder from the annex roof up the shaft to the balcony ----
  {
    const la = annexAng + 0.32;
    const lx = Math.cos(la) * (r + 0.02), lz = Math.sin(la) * (r + 0.02);
    const y0 = ffl + ah + 0.05;
    cagedLadder(b, lx, y0, lz, balY - y0, Math.PI / 2 - la, { cageKey: 'steel_yellow' });
  }
  // ---- cable tray + conduit from the annex into the shaft, lamp post ----
  b.tube('steel', [[ax * (r + 0.1), ffl + ah - 0.4, az * (r + 0.1)], [ax * (r + 0.1), ffl + ah + 1.4, az * (r + 0.1)], [ax * (r + 0.05), cabY - 0.6, az * (r + 0.05)]], 0.04, 6);
  lampPost(b, Math.cos(doorAng + 0.9) * (r + 4.5), 0, Math.sin(doorAng + 0.9) * (r + 4.5), 5.5, doorAng + 0.9 + Math.PI);
  // ---- interior ('full'): spiral stair, floors with guard ring ----
  if (ctx.full) towerInterior(ctx, D, doorAng, T);
  // ---- climate ----
  if (E.polar || E.dry) {
    const leeAng = { front: Math.PI / 2, right: 0, back: -Math.PI / 2, left: Math.PI }[E.lee];
    const kind = E.polar ? 'snow' : 'dust';
    const h0 = E.polar ? 0.5 : 0.12, reach = E.polar ? 3.0 : 0.9;
    b.withTint(E.polar ? E.snowTint : E.dustTint, () => {
      const N = 10;
      for (let k = 0; k < N; k++) {
        const a0 = leeAng - 0.9 + (1.8 * k) / N, a1 = leeAng - 0.9 + (1.8 * (k + 1)) / N;
        const f0 = Math.cos(((k / N) - 0.5) * Math.PI), f1 = Math.cos((((k + 1) / N) - 0.5) * Math.PI);
        const g = (a, rr) => K.groundAt(s, Math.cos(a) * rr, Math.sin(a) * rr);
        const p = (a, rr, h) => [Math.cos(a) * rr, g(a, rr) + h, Math.sin(a) * rr];
        const A = p(a0, r + 0.12, h0 * f0), B = p(a1, r + 0.12, h0 * f1), C = p(a1, r + 0.12 + reach * f1, -0.04), Dd = p(a0, r + 0.12 + reach * f0, -0.04);
        b.quad(kind === 'snow' ? 'render_white' : 'soil', A[0], A[1], A[2], Dd[0], Dd[1], Dd[2], C[0], C[1], C[2], B[0], B[1], B[2]);
      }
    });
  }
  // ---- anchors ----
  const de = edges[doorEdge];
  const dmx = (de.a[0] + de.b[0]) / 2, dmz = (de.a[1] + de.b[1]) / 2;
  utilAnchors(ctx, {
    ffl, h: fh, roofY: D.top, access: [0, D.top - 0.15, 0],
    floors: Array.from({ length: nF }, (_, l) => ({ level: l, y: ffl + l * fh, height: l === nF - 1 ? cabH : fh })),
    entrances: [
      { kind: 'main', side: mainE.side, pos: [dmx + de.nx * 0.6, ffl, dmz + de.nz * 0.6], dir: [de.nx, 0, de.nz], width: 1.1 },
      { kind: 'service', side: mainE.side, pos: annex.door, dir: annex.dir, width: 1.0 },
    ],
    rooms: [{ floor: nF - 1, name: 'observation cab', kind: 'office', center: [0, cabY, 0], size: [2 * rc, cabH, 2 * rc] }, { floor: 0, name: 'annex', kind: 'plant', center: annex.center, size: [aw, ah, ad] }],
    cameras: {
      street: { pos: [dmx + de.nx * 22 - de.nz * 6, 1.65, dmz + de.nz * 22 + de.nx * 6], target: [0, D.top * 0.45, 0] },
      living: { pos: [Math.cos(doorAng) * (rc - 1.0), cabY + 1.65, Math.sin(doorAng) * (rc - 1.0)], target: [-Math.cos(doorAng) * 30, cabY - 6, -Math.sin(doorAng) * 30] },
      stair: { pos: [Math.cos(doorAng) * (r - 1.0), ffl + fh + 1.65, Math.sin(doorAng) * (r - 1.0)], target: [0, ffl + fh * 1.6, 0] },
      roof: { pos: [Math.cos(doorAng) * 14, D.top + 6, Math.sin(doorAng) * 14], target: [0, D.top, 0] },
    },
  });
  b.meta.tower = { r, cabY, rc };
}

/** Annex box against the shaft at plan angle a (outward), width aw (tangential), depth ad (radial). */
function annexBox(ctx, D, a, aw, ad, ah, T, shell) {
  const b = ctx.b, s = ctx.spec, E = D.E;
  const { r, ffl } = D;
  // annex frame: origin at the shaft surface point, +z outward (radial), +x tangential
  b.push();
  b.rotY(Math.PI / 2 - a);
  // local: (x, z) with z = radial distance; box from z = r − 0.6 (tucked into the shaft) to r + ad
  const R = { x0: -aw / 2, x1: aw / 2, z0: r - 0.6, z1: r + ad };
  const wallT = 0.25;
  b.pushTint(E.shellTint);
  // front (outer, +z), left/right side walls with openings; the back face sits inside the shaft
  const sideWall = (side) => {
    b.push();
    const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
    b.translate(cx, 0, cz);
    const L = K.facadeFrame(b, side, R.x1 - R.x0, R.z1 - R.z0, 0);
    const ops = side === 'front' ? [{ u0: 0.8, u1: 2.0, v0: ffl + 0.5, v1: ffl + 1.6 }, { u0: L - 1.9, u1: L - 0.9, v0: ffl + 1.0, v1: ffl + 2.2 }]
      : side === 'right' ? [{ u0: L - ad + 0.2, u1: L - ad + 1.25, v0: ffl, v1: ffl + 2.2, door: true }] : [{ u0: L / 2 - 0.6 + 0.6, u1: L / 2 + 0.6 + 0.6, v0: ffl + 0.5, v1: ffl + 1.4 }];
    const okOps = ops.filter((o) => o.u0 > 0.3 && o.u1 < L - 0.3);
    K.wallWithOpenings(b, { L, y0: ffl, y1: ffl + ah, T: wallT, openings: okOps.map((o) => ({ u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, reveal: 0.15, noSillReveal: !!o.door })), outer: shell, inner: ctx.full ? 'plaster' : null, innerReveals: ctx.full, capStart: true, capEnd: true });
    b.popTint();
    for (const o of okOps) {
      if (o.door) K.doorUnit(b, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R: 0.15, kind: 'service', open: 0, T: wallT });
      else if (side === 'front' && o.u0 < 1) K.louvrePanel(b, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R: 0.1, key: 'aluminium' });
      else K.windowUnit(b, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, R: 0.15, type: 'casement', frameKey: 'aluminium_dark', glassKey: ctx.full ? 'glass_clear' : 'glass_window', sillKey: 'aluminium', inner: ctx.full, T: wallT, room: { u0: 0.4, w: 3.0, d: 3.0, h: 3.0, sill: o.v0 - ffl, kind: K.ROOM_KIND.office, seed: 0.6, floor: 0, bay: 0, hash: s.hash, profile: s._profile | 0 } });
    }
    b.pushTint(E.shellTint);
    b.pop();
    return okOps;
  };
  sideWall('front');
  const rops = sideWall('right');
  sideWall('left');
  b.popTint();
  // roof slab with parapet + coping, HVAC, plinth
  b.withTint(E.shellTint, () => b.cbox(shell, R.x0 - 0.05, ffl + ah, R.z0, R.x1 + 0.05, ffl + ah + 0.5, R.z1 + 0.05, 0.02));
  b.withTint(E.trimTint, () => b.box('panel_grey', R.x0 - 0.08, ffl + ah + 0.42, R.z0, R.x1 + 0.08, ffl + ah + 0.52, R.z1 + 0.08, PY | PZ | PX | NX));
  K.hvacUnit(b, (R.x0 + R.x1) / 2 + 0.6, ffl + ah + 0.5, R.z1 - 1.0, 0, { w: 1.4, d: 0.9, h: 0.9 });
  b.withTint([0.93, 0.92, 0.9], () => b.box('concrete', R.x0 - 0.08, Math.min(0, s._ground.min) - 0.6, R.z0, R.x1 + 0.08, ffl - 0.02, R.z1 + 0.08, ALL & ~NY));
  b.withTint(E.trimTint, () => { b.box('panel_grey', R.x0 - 0.03, ffl, R.z1, R.x1 + 0.03, ffl + 0.45, R.z1 + 0.03, PZ | PY | PX | NX); });
  if (ctx.full) {
    b.rectY('concrete_smooth', R.x0 + wallT, r, R.x1 - wallT, R.z1 - wallT, ffl + 0.005, 1);
    b.withTint([0.94, 0.94, 0.93], () => b.rectY('plaster', R.x0 + wallT, r, R.x1 - wallT, R.z1 - wallT, ffl + ah - 0.01, -1));
    for (let k = 0; k < 3; k++) cabinet(b, R.x0 + wallT + 0.5 + k * 0.85, ffl, r + 0.6, 0.8, 2.0, 0.5, 0, 'hvac');
    if (b.collecting) {
      b.colQuad(R.x0, ffl, R.z1, R.x1, ffl, R.z1, R.x1, ffl, R.z0, R.x0, ffl, R.z0);
      b.colBox(R.x0, ffl, R.z1 - wallT, R.x1, ffl + ah, R.z1);
      b.colBox(R.x0, ffl, R.z0, R.x0 + wallT, ffl + ah, R.z1);
    }
  }
  // door landing on the right wall (side facing away from the main door)
  const dO = rops[0];
  let doorPos = [0, ffl, R.z1], dir = [0, 0, 1];
  if (dO) {
    // right side wall frame: u runs +z → −z at x = R.x1; door centre z = R.z1 − (u0+u1)/2
    const zc = R.z1 - (dO.u0 + dO.u1) / 2;
    b.cbox('concrete_smooth', R.x1, ffl - 0.45, zc - 0.9, R.x1 + 1.4, ffl - 0.005, zc + 0.9, 0.012, false);
    if (b.collecting) b.colQuad(R.x1, ffl, zc + 0.9, R.x1 + 1.4, ffl, zc + 0.9, R.x1 + 1.4, ffl, zc - 0.9, R.x1, ffl, zc - 0.9);
    K.wallLight !== undefined && b.push(); b.translate(R.x1, 0, zc); b.rotY(Math.PI / 2); K.wallLight(b, 0.9, ffl + 2.2); b.pop();
    doorPos = [R.x1 + 0.6, ffl, zc]; dir = [1, 0, 0];
  }
  b.pop();
  // annex local → building
  const c = Math.cos(Math.PI / 2 - a), sn = Math.sin(Math.PI / 2 - a);
  const toB = (p) => [p[0] * c + p[2] * sn, p[1], -p[0] * sn + p[2] * c];
  return { door: toB(doorPos), dir: toB(dir), center: toB([0, ffl, (R.z0 + R.z1) / 2]) };
}

/** 'full' interior: central column + spiral stair (walkable), annular floors with guard rings. */
function towerInterior(ctx, D, doorAng, T) {
  const b = ctx.b;
  const { r, nF, fh, ffl, cabY } = D;
  const ri = r - T;
  const rs = Math.min(1.6, ri - 1.0);          // stair outer radius
  const rcol = 0.16;
  // central column
  b.cylinder('steel_dark', 0, ffl, 0, rcol, cabY - ffl + 0.05, 12, { top: true });
  // floors: ground slab full, upper floors annulus around the stair well
  const nRing = 28;
  b.polyY('concrete_smooth', K.ringPolygon(0, 0, ri, nRing), [], ffl + 0.003, 1);
  if (b.collecting) b.colPolyY(K.ringPolygon(0, 0, ri, nRing), [], ffl);
  for (let l = 1; l < nF; l++) {
    const y = ffl + l * fh;
    if (l < nF - 1) {
      b.polyY('tile_floor', K.ringPolygon(0, 0, ri, nRing), [K.ringPolygon(0, 0, rs + 0.05, 20)], y, 1);
      b.withTint([0.94, 0.94, 0.93], () => b.polyY('plaster', K.ringPolygon(0, 0, ri, nRing), [K.ringPolygon(0, 0, rs + 0.05, 20)], y - 0.25, -1));
      if (b.collecting) b.colPolyY(K.ringPolygon(0, 0, ri, nRing), [K.ringPolygon(0, 0, rs + 0.05, 20)], y);
    }
    // guard ring round the stair well, open over the arrival sector
    const arrive = doorAng + l * 2 * Math.PI;   // the stair turns one full turn per storey → arrival above the start
    const pts = [];
    for (let k = 0; k <= 20; k++) { const a = arrive + 0.9 + (k / 20) * (2 * Math.PI - 1.5); pts.push([Math.cos(a) * (rs + 0.12), y, Math.sin(a) * (rs + 0.12)]); }
    if (l < nF - 1) {
      b.tube('steel_yellow', pts.map((p) => [p[0], p[1] + 1.05, p[2]]), 0.022, 6);
      for (let k = 0; k <= 20; k += 4) b.box('steel_yellow', pts[k][0] - 0.02, y, pts[k][2] - 0.02, pts[k][0] + 0.02, y + 1.05, pts[k][2] + 0.02, PX | NX | PZ | NZ);
      if (b.collecting) for (let k = 0; k < 20; k += 2) { const p = pts[k], q = pts[Math.min(20, k + 2)]; b.colBox(Math.min(p[0], q[0]) - 0.03, y, Math.min(p[2], q[2]) - 0.03, Math.max(p[0], q[0]) + 0.03, y + 1.05, Math.max(p[2], q[2]) + 0.03); }
    }
  }
  // spiral stair: one turn per storey, treads as wedges, outer stringer + handrail (helix)
  const steps = Math.max(18, Math.ceil(fh / 0.19));
  const dA = (2 * Math.PI) / steps, h = fh / steps;
  for (let l = 0; l < nF - 1; l++) {
    const y0 = ffl + l * fh;
    const rail = [];
    for (let i = 0; i < steps; i++) {
      const a0 = doorAng + 0.6 + i * dA, a1 = a0 + dA * 1.08;
      const yt = y0 + (i + 1) * h;
      const p = (a, rr) => [Math.cos(a) * rr, Math.sin(a) * rr];
      const A = p(a0, rcol), B = p(a0, rs), C = p(a1, rs), Dd = p(a1, rcol);
      b.prism('steel_dark', [A, Dd, C, B], yt - 0.05, yt, { top: true, bottom: true });
      if (b.collecting) b.colQuad(A[0], yt - h, A[1], B[0], yt - h, B[1], C[0], yt, C[1], Dd[0], yt, Dd[1]);
      rail.push([Math.cos(a0) * (rs - 0.05), yt + 0.95, Math.sin(a0) * (rs - 0.05)]);
      if (i % 3 === 0) b.box('steel_yellow', Math.cos(a0) * (rs - 0.05) - 0.015, yt, Math.sin(a0) * (rs - 0.05) - 0.015, Math.cos(a0) * (rs - 0.05) + 0.015, yt + 0.95, Math.sin(a0) * (rs - 0.05) + 0.015, PX | NX | PZ | NZ);
    }
    b.tube('steel_yellow', rail, 0.022, 6);
  }
}

/** mass LOD: shaft n-gon (far facade), cab ring + crown (mass_roof), annex box. */
function massing(spec, ctx) {
  const b = ctx.b, s = ctx.spec;
  const D = towerDims(ctx);
  const { r, rc, cabY, cabH, ffl } = D;
  const y0 = Math.min(0, s._ground.min) - 0.5;
  b.pushTint([0.42, 0.52, 0.58]); b.cylinder('mass_roof', 0, cabY + 0.9, 0, rc + 0.12, cabH - 1.1, 16, { top: false }); b.popTint();
  b.pushTint([0.9, 0.9, 0.88]);
  b.cylinder('mass_roof', 0, cabY - 0.35, 0, rc, 1.25, 16, { top: false, bottom: true });
  b.cylinder('mass_roof', 0, cabY + cabH - 0.2, 0, rc + 0.2, 0.95, 16, { top: true, bottom: true });
  b.popTint();
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front' };
  const a = ({ front: Math.PI / 2, right: 0, back: -Math.PI / 2, left: Math.PI }[mainE.side] ?? Math.PI / 2) - Math.PI / 2;
  b.push(); b.rotY(Math.PI / 2 - a);
  b.pushTint([0.88, 0.88, 0.86]); b.box('mass_roof', -2.2, y0, r - 0.6, 2.2, ffl + 4.1, r + 3.8, ALL & ~NY); b.popTint();
  b.pop();
  return [{ x0: -r, x1: r, z0: -r, z1: r, y0, y1: cabY - 0.35, parapet: 0, round: r, n: 18, floorH: D.fh, groundH: ffl + D.fh, bayW: BAY_W, blank: {}, flags: 0, roofColor: [0.8, 0.8, 0.78] }];
}

export default { name: 'control_tower', uses: ['control_tower'], generate, massing };
