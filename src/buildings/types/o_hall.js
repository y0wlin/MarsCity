// O-zone generic utility hall (buildings-o helper, not a type module).
// A declarative rectangular hall → walls with real openings + units, O02 trims, plinth, roof (flat with
// parapet / barrel vault / pitched metal / none), entrances (landing, steps, canopy, lamps, aprons),
// 'full' interiors (slabs, partitions with door gaps, mezzanines with rails, straight stairs, roof
// steel, high-bay lights gated by occupancy, colliders). Types describe their plan and add their own
// use-specific structure afterwards.
//
// H = {
//   R: {x0,x1,z0,z1}        outer wall line (default: footprint)
//   ffl, top                ground-floor level, wall-top / roof level (y)
//   parapet (0.9), T, key, tint, env (oEnv)
//   ops: {front:[Opening], right, back, left}   Opening = {u0,u1,v0,v1, kind:'win'|'door'|'roller'|'louvre',
//                           type, cols, doorKind, open, entry:true (landing+steps+canopy), apron:{depth}, room:{...}}
//   roof: {kind:'flat'|'vault'|'pitched'|'none', rise, axis, key, dp}
//   slabs: [{x0,x1,z0,z1,y, rails:['front'...] (open edges), key}]           upper floors / mezzanines
//   walls: [{x0,z0,x1,z1,y0,y1, doors:[{at,w,h}], key, t}]                   interior partitions ('full')
//   stairs: [{x,z,y0,rise,dir,W}]                                            straight stairs ('full')
//   rooms: [{x0,x1,z0,z1,y,h,kind,name}]                                      anchors / furniture hints
//   lights: [{x,z,y}] or auto grid                                            ('full')
//   noInteriorFloor, floorKey, ceiling: 'beams'|'flat'
// }

import * as K from '../kit/index.js';
import { sideGround } from '../kit/plinth.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, SIDES, isFB, oEnv, facadeWall, boxTrims, flatRoof, vaultRoof, rectFrame, apron, lampPost, groundAtU, freeSpans } from './o_common.js';
import { hash4 } from '../../core/hash.js';

/** Build the hall shell. Returns {R, inner, roofTop, opsBySide}. */
export function buildHall(ctx, H) {
  const b = ctx.b, s = ctx.spec;
  const E = H.env || oEnv(ctx);
  const R = H.R || { x0: -s._w / 2, x1: s._w / 2, z0: -s._d / 2, z1: s._d / 2 };
  const T = H.T ?? E.wallT;
  const ffl = H.ffl ?? E.ffl;
  const top = H.top;
  const roof = H.roof || { kind: 'flat' };
  const ph = roof.kind === 'flat' ? (H.parapet ?? 0.9) : 0;
  const wallTop = top + ph;
  const ops = H.ops || {};
  // ---- walls ----
  const opsBySide = {};
  for (const side of SIDES) {
    if (H.skip && H.skip[side]) continue;
    opsBySide[side] = facadeWall(ctx, side, R, { y0: ffl, y1: wallTop, T, key: H.key || E.shell, tint: H.tint || E.shellTint, ops: ops[side] || [], reveal: H.reveal ?? E.reveal, inner: ctx.full ? (H.innerKey || 'plaster') : null, frameKey: 'aluminium_dark', lower: H.lower });
  }
  // ---- trims (O02: grey fascia band, corner trims, kick band) ----
  if (H.trims !== false) boxTrims(ctx, R, { y0: ffl, y1: wallTop, env: E, fascia: roof.kind === 'flat' ? 0.42 : 0.3, band: H.band, skip: H.skip });
  // ---- plinth ----
  if (H.plinth !== false) {
    const w = R.x1 - R.x0, d = R.z1 - R.z0, cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
    b.push(); b.translate(cx, 0, cz);
    b.withTint([0.95, 0.94, 0.92], () => K.plinth(b, s, ffl, { key: E.base, w, d, skip: { ...(H.skip || {}), ...(H.plinthSkip || {}) } }));
    b.pop();
  }
  // ---- roof ----
  let roofTop = top;
  if (roof.kind === 'flat') {
    const psides = {};
    for (const sd of SIDES) if (H.skip && H.skip[sd]) psides[sd] = 'none';
    const fr = flatRoof(ctx, R, top, { parapet: ph, T, key: roof.key || (E.polar ? 'roof_membrane' : 'roof_gravel'), snow: E.polar && roof.snow !== false, env: E, dp: roof.dp || 'back', ffl, downpipes: roof.downpipes, sides: psides });
    roofTop = top + ph;
    H._roofInner = fr.inner; H._roofY = fr.yr;
  } else if (roof.kind === 'vault') {
    roofTop = vaultRoof(ctx, R, top, { rise: roof.rise, axis: roof.axis, key: roof.key || 'roof_metal', gableKey: H.key || E.shell, gableTint: H.tint || E.shellTint, snow: E.polar, env: E, T });
  } else if (roof.kind === 'pitched') {
    b.pushTint(H.tint || E.shellTint);
    roofTop = K.pitchedRoof(b, R, top, { key: roof.key || 'roof_metal', gableKey: H.key || E.shell, pitch: roof.pitch ?? 0.26, overhang: 0.4, seed: s.hash, ridgeAxis: roof.axis, solarChance: roof.solar ?? 0.3, sunSide: s._lat >= 0 ? 1 : -1 });
    b.popTint();
  }
  // ---- entrances: landings, steps, canopies, lamps; aprons at roller doors ----
  for (const side of SIDES) {
    for (const o of (opsBySide[side] || [])) {
      if (o.entry) entryAt(ctx, R, side, o, ffl, E, H);
      if (o.kind === 'roller' && o.apron !== false) rollerApron(ctx, R, side, o, ffl, o.apron || {});
    }
  }
  // ---- facade dressing: floodlights, conduits + junction boxes, AC units, exit signs, hose cabinets ----
  if (H.dressing !== false) utilityDressing(ctx, R, opsBySide, ffl, wallTop, E, H);
  // ---- interiors ----
  if (ctx.full) hallInterior(ctx, H, R, T, ffl, top);
  H.R = R; H.ffl = ffl; H.T = T;
  const sk = H.skip || {};
  return { R, inner: { x0: R.x0 + (sk.left ? 0 : T), x1: R.x1 - (sk.right ? 0 : T), z0: R.z0 + (sk.back ? 0 : T), z1: R.z1 - (sk.front ? 0 : T) }, roofTop, opsBySide, ffl, T, env: E };
}

/**
 * O02 utility-box clutter on the walls of rect R (wall frames): a floodlight beside every roller door, a
 * vertical conduit from the roof edge to a junction box + a short cable tray on the most open wall, 1–2 split
 * AC units on brackets above head height on the door side, green-cyan exit signs over personnel doors, a red
 * hose / extinguisher cabinet beside the main door, meter box low on the wall. Placed only in free wall spans.
 */
export function utilityDressing(ctx, R, opsBySide, ffl, top, E, H = {}) {
  const b = ctx.b;
  const sides = SIDES.filter((sd) => opsBySide[sd]);
  let best = null, bestFree = 0;
  for (const side of sides) {
    const ops = opsBySide[side];
    const L = isFB(side) ? R.x1 - R.x0 : R.z1 - R.z0;
    const rng = ctx.sub(1990 + SIDES.indexOf(side), Math.round(L * 10));
    b.push(); rectFrame(b, side, R);
    // floodlights at roller doors (aimed down at the apron)
    for (const o of ops) {
      if (o.kind !== 'roller') continue;
      const u = o.u1 + 0.7 < L - 0.4 ? o.u1 + 0.7 : o.u0 - 0.7;
      const y = Math.min(top - 0.75, o.v1 + 1.1);
      if (u < 0.4 || y < o.v1 + 0.3) continue;
      b.box('steel_dark', u - 0.03, y - 0.05, 0.0, u + 0.03, y + 0.05, 0.35, ALL);
      b.push(); b.translate(u, y, 0.38); b.rotX(0.55);
      b.cbox('aluminium_dark', -0.22, -0.16, -0.06, 0.22, 0.12, 0.08, 0.01);
      b.rectY('light_warm', -0.18, -0.02, 0.18, 0.06, -0.162, -1);
      b.pop();
    }
    // exit signs over personnel doors; hose cabinet beside the first entry door
    let hose = false;
    for (const o of ops) {
      if (o.kind !== 'door' || o.v0 > ffl + 0.5) continue;
      const yS = o.v1 + (o.entry && o.canopy !== false ? 0.06 : 0.12);
      if (!(o.entry && o.canopy !== false)) { b.cbox('aluminium_dark', (o.u0 + o.u1) / 2 - 0.2, yS, 0.0, (o.u0 + o.u1) / 2 + 0.2, yS + 0.16, 0.05, 0.005); b.withTint([0.25, 1.0, 0.6], () => b.rectZ('light_cyan', (o.u0 + o.u1) / 2 - 0.17, yS + 0.025, (o.u0 + o.u1) / 2 + 0.17, yS + 0.135, 0.051, 1)); }
      if (!hose && o.entry) {
        const fr = freeSpans(ops, L, ffl + 0.5, ffl + 1.9, 0.25).find(([a, c]) => (a <= o.u1 + 1.0 && c >= o.u1 + 1.8) || (a <= o.u0 - 1.8 && c >= o.u0 - 1.0));
        if (fr) {
          const hu = fr[0] <= o.u1 + 1.0 && fr[1] >= o.u1 + 1.8 ? o.u1 + 1.4 : o.u0 - 1.4;
          b.withTint([0.85, 0.16, 0.12], () => b.cbox('hvac', hu - 0.32, ffl + 0.85, 0.0, hu + 0.32, ffl + 1.75, 0.2, 0.012));
          b.box('aluminium', hu - 0.25, ffl + 0.95, 0.2, hu + 0.25, ffl + 1.65, 0.204, PZ);
          hose = true;
        }
      }
    }
    // AC units above head height on the door / window side
    if (ops.some((o) => o.kind === 'door' && o.entry) && !E.polar) {
      const spans = freeSpans(ops, L, ffl + 2.35, ffl + 3.35, 0.3).filter(([a, c]) => c - a > 1.4);
      const n = Math.min(spans.length, 1 + (rng.next() < 0.5 ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const [a, c] = spans[Math.floor(rng.next() * spans.length)];
        const u = a + (c - a) * (0.3 + rng.next() * 0.4), y = ffl + 2.5;
        if (y + 0.75 > top - 0.5) break;
        for (const du of [-0.32, 0.32]) b.box('steel_dark', u + du - 0.02, y - 0.04, 0.0, u + du + 0.02, y, 0.42, ALL);
        K.acUnit(b, u, y, 0.22, 0, { w: 0.85, d: 0.32, h: 0.6 });
        b.tube('aluminium', [[u + 0.35, y + 0.35, 0.05], [u + 0.55, y + 0.35, 0.05], [u + 0.55, y + 1.2 > top - 0.6 ? top - 0.6 : y + 1.2, 0.05]], 0.022, 6);
      }
    }
    // track the most open wall for the conduit run
    const fr = freeSpans(ops, L, ffl, top, 0.3);
    const tot = fr.reduce((acc, [a, c]) => acc + (c - a), 0);
    if (tot > bestFree && L > 6) { bestFree = tot; best = { side, L, fr }; }
    b.pop();
  }
  if (best && H.conduit !== false) {
    const sp = best.fr.slice().sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    if (sp && sp[1] - sp[0] > 1.6) {
      b.push(); rectFrame(b, best.side, R);
      const u = sp[0] + 0.6, yb = ffl + 1.35;
      b.tube('steel', [[u, top - 0.45, 0.07], [u, yb + 0.55, 0.07]], 0.035, 6);
      for (let y = yb + 1.2; y < top - 0.6; y += 1.2) b.box('steel_dark', u - 0.06, y - 0.03, 0.0, u + 0.06, y + 0.03, 0.11, ALL);
      b.cbox('hvac', u - 0.3, yb - 0.3, 0.0, u + 0.3, yb + 0.55, 0.22, 0.012);
      b.box('steel_dark', u - 0.27, yb - 0.27, 0.22, u + 0.27, yb + 0.52, 0.224, PZ);
      const ue = Math.min(sp[1] - 0.5, u + 5.5);
      if (ue - u > 1.5) {
        const yt = ffl + 3.05;
        if (yt < top - 0.8) {
          b.box('steel', u, yt - 0.04, 0.02, ue, yt + 0.04, 0.2, PY | NY | PZ);
          b.box('steel', u, yt - 0.04, 0.18, ue, yt + 0.06, 0.2, PZ | NZ | PY);
          for (let x = u + 0.6; x < ue; x += 1.5) b.box('steel_dark', x - 0.02, yt - 0.06, 0.0, x + 0.02, yt - 0.04, 0.2, ALL);
          b.tube('steel', [[u, yt, 0.1], [u, yb + 0.55, 0.1]], 0.025, 6);
          b.cbox('hvac', ue - 0.25, ffl + 1.0, 0.0, ue + 0.25, ffl + 1.6, 0.18, 0.01);
          b.tube('steel', [[ue, yt, 0.1], [ue, ffl + 1.6, 0.1]], 0.025, 6);
        }
      }
      b.pop();
    }
  }
}

/** Landing + steps + canopy + wall lamps at a personnel door (wall frame of the side of R). */
export function entryAt(ctx, R, side, o, ffl, E, H = {}) {
  const b = ctx.b, s = ctx.spec;
  const L = isFB(side) ? R.x1 - R.x0 : R.z1 - R.z0;
  // terrain at this facade (rect sides inside the footprint use the footprint ground interpolation)
  const gy = groundAtRect(s, R, side, (o.u0 + o.u1) / 2, L);
  b.push(); rectFrame(b, side, R);
  const lw = (o.u1 - o.u0) + 1.2, landD = o.landD ?? 1.5;
  const lu0 = Math.max(0.05, (o.u0 + o.u1) / 2 - lw / 2), lu1 = Math.min(L - 0.05, (o.u0 + o.u1) / 2 + lw / 2);
  b.cbox('concrete_smooth', lu0, Math.min(gy, ffl) - 0.45, 0.0, lu1, ffl - 0.005, landD, 0.012, false);
  if (b.collecting) b.colQuad(lu0, ffl, landD, lu1, ffl, landD, lu1, ffl, 0, lu0, ffl, 0);
  const rise = ffl - gy;
  if (rise > 0.05) K.steps(b, { u0: lu0, u1: lu1, z0: landD, y0: gy, y1: ffl, key: 'stone_step', cheeks: false, rails: false });
  if (rise > 0.3) {
    // yellow handrails both sides of the steps (O02)
    const n = Math.ceil(rise / 0.165), run = n * 0.3;
    for (const u of [lu0 + 0.08, lu1 - 0.08]) b.tube('steel_yellow', [[u, ffl + 1.0, 0.2], [u, ffl + 1.0, landD], [u, gy + 1.0, landD + run], [u, gy + 1.0, landD + run + 0.25]], 0.022, 8, { transport: true });
    for (const u of [lu0 + 0.08, lu1 - 0.08]) for (const z of [0.25, landD, landD + run]) { const yy = z <= landD ? ffl : gy; b.box('steel_yellow', u - 0.02, yy, z - 0.02, u + 0.02, yy + 1.0, z + 0.02, PX | NX | PZ | NZ); }
  }
  if (o.canopy !== false) {
    const cy = Math.min(o.v1 + 0.5, (H.top ?? o.v1 + 1) - 0.3);
    b.withTint(E.trimTint, () => K.canopyFlat(b, { u0: o.u0 - 0.6, u1: o.u1 + 0.6, y: cy, depth: landD + 0.2, key: E.polar ? 'panel_insulated' : 'panel_grey', rods: true }));
  }
  // wall lamp + name plate beside the door
  K.wallLight(b, o.u0 - 0.4, ffl + 2.25);
  if (o.plate) K.signPanel(b, o.u1 + 0.95, ffl + 1.55, 1.1, 0.32, { frameKey: 'aluminium_dark' });
  b.pop();
}

/** Concrete apron with yellow guide lines in front of a roller door (turning / loading area). */
export function rollerApron(ctx, R, side, o, ffl, ao) {
  const b = ctx.b, s = ctx.spec;
  const L = isFB(side) ? R.x1 - R.x0 : R.z1 - R.z0;
  const gy = groundAtRect(s, R, side, (o.u0 + o.u1) / 2, L);
  b.push(); rectFrame(b, side, R);
  const depth = ao.depth ?? 7, ext = ao.ext ?? 1.5;
  const y = Math.min(ffl, gy + 0.08);
  // ramp from the floor down to the apron when the hall floor is higher (≤ 1:10)
  const up = ffl - y;
  if (up > 0.03) {
    const rl = Math.max(1.2, up * 10);
    // wedge ramp swept along the door width: profile (s = outward, y), CCW
    const prof = [[0, y - 0.4], [rl, y - 0.4], [rl, y], [0, ffl]];
    b.sweep('concrete_smooth', [[o.u0 - 0.3, 0, 0], [o.u1 + 0.3, 0, 0]], prof, { smoothAngle: 5 });
    if (b.collecting) b.colQuad(o.u0 - 0.3, ffl, 0, o.u1 + 0.3, ffl, 0, o.u1 + 0.3, y, rl, o.u0 - 0.3, y, rl);
  }
  apron(b, o.u0 - ext, 0.0, o.u1 + ext, depth, y, { lines: [[o.u0 - ext + 0.1, depth - 0.25, o.u1 + ext - 0.1, depth - 0.12], [o.u0 - 0.05, 0.4, o.u0 + 0.07, depth - 0.4], [o.u1 - 0.07, 0.4, o.u1 + 0.05, depth - 0.4]] });
  b.pop();
}

/** Terrain (relative) at facade u of side of a rect (bilinear over the footprint corners). */
export function groundAtRect(s, R, side, u, L) {
  const fp = { x0: -s._w / 2, x1: s._w / 2, z0: -s._d / 2, z1: s._d / 2 };
  if (Math.abs(R.x0 - fp.x0) < 0.01 && Math.abs(R.x1 - fp.x1) < 0.01 && Math.abs(R.z0 - fp.z0) < 0.01 && Math.abs(R.z1 - fp.z1) < 0.01) return groundAtU(s, side, u, L);
  const p = K.facadePoint(side, R.x1 - R.x0, R.z1 - R.z0, u, 0, 0);
  return K.groundAt(s, p[0] + (R.x0 + R.x1) / 2, p[2] + (R.z0 + R.z1) / 2);
}

// ---------------------------------------------------------------------------------------------
// interiors
// ---------------------------------------------------------------------------------------------
function hallInterior(ctx, H, R, T, ffl, top) {
  const b = ctx.b, s = ctx.spec;
  const sk = H.skip || {};
  const I = { x0: R.x0 + (sk.left ? 0 : T), x1: R.x1 - (sk.right ? 0 : T), z0: R.z0 + (sk.back ? 0 : T), z1: R.z1 - (sk.front ? 0 : T) };
  // ground slab (+ skirting line) and collider
  if (!H.noInteriorFloor) {
    b.rectY(H.floorKey || 'concrete_smooth', I.x0, I.z0, I.x1, I.z1, ffl, 1);
    if (b.collecting) b.colQuad(I.x0, ffl, I.z1, I.x1, ffl, I.z1, I.x1, ffl, I.z0, I.x0, ffl, I.z0);
  }
  // exterior wall colliders with gaps at doors / roller doors
  if (b.collecting) {
    for (const side of SIDES) {
      const L = isFB(side) ? R.x1 - R.x0 : R.z1 - R.z0;
      // ground doors cut a full-height gap; upper doors (external stair landings) keep the wall below the sill
      // ('blank' = the wall opening behind a glazed control bay: the bay is part of the room)
      const gaps = ((H.ops && H.ops[side]) || []).filter((o) => o.kind === 'door' || o.kind === 'roller' || o.kind === 'blank').map((o) => [o.u0, o.u1, o.v0]).sort((a, c) => a[0] - c[0]);
      let u = 0;
      b.push(); rectFrame(b, side, R);
      for (const [a, c, v0] of gaps) { if (a > u) b.colBox(u, ffl, -T, a, top, 0); if (v0 > ffl + 0.4) b.colBox(Math.max(a, u), ffl, -T, c, v0, 0); u = Math.max(u, c); }
      if (L > u) b.colBox(u, ffl, -T, L, top, 0);
      b.pop();
    }
  }
  // ceiling / roof structure
  const ceil = top - 0.32;
  if (H.ceiling !== 'none') {
    b.withTint([0.82, 0.83, 0.84], () => b.rectY('panel_grey', I.x0, I.z0, I.x1, I.z1, ceil, -1));
    if (H.ceiling !== 'flat') {
      // steel I-beams across the short span every ~6 m
      const alongX = I.x1 - I.x0 >= I.z1 - I.z0;
      const L = alongX ? I.x1 - I.x0 : I.z1 - I.z0, n = Math.max(1, Math.round(L / 6));
      for (let i = 1; i < n; i++) {
        const t = (L * i) / n;
        if (alongX) { const x = I.x0 + t; b.box('steel_dark', x - 0.1, ceil - 0.5, I.z0, x + 0.1, ceil, I.z1, PX | NX | NY); b.box('steel_dark', x - 0.15, ceil - 0.52, I.z0, x + 0.15, ceil - 0.48, I.z1, ALL); }
        else { const z = I.z0 + t; b.box('steel_dark', I.x0, ceil - 0.5, z - 0.1, I.x1, ceil, z + 0.1, PZ | NZ | NY); b.box('steel_dark', I.x0, ceil - 0.52, z - 0.15, I.x1, ceil - 0.48, z + 0.15, ALL); }
      }
    }
  }
  // occupancy-gated lights (room kind 'plant'/'office'), stable ids
  const lights = H.lights || autoLights(I, ceil - 0.55);
  b.setExtra('iwin1', 0, 0.5, 0, 1000 + (s.hash % 97));
  b.setExtra('iwin2', (s.hash >>> 16) & 0xffff, s.hash & 0xffff, K.ROOM_KIND.plant, s._profile | 0);
  for (const L of lights) {
    b.cylinder('steel_dark', L.x, L.y + 0.05, L.z, 0.012, ceil - L.y - 0.05, 4, { top: false });
    b.lathe('aluminium_dark', [[0.05, 0.25], [0.28, 0.06], [0.3, 0.0]], 12, { x: L.x, y: L.y - 0.02, z: L.z });
    b.cylinder('light_panel', L.x, L.y - 0.025, L.z, 0.26, 0.01, 12, { top: false, bottom: true });
  }
  b.clearExtra('iwin1'); b.clearExtra('iwin2');
  // upper slabs / mezzanines
  for (const sl of H.slabs || []) {
    const k = sl.key || 'concrete_smooth';
    b.cbox(k, sl.x0, sl.y - 0.25, sl.z0, sl.x1, sl.y, sl.z1, 0.01);
    if (b.collecting) b.colQuad(sl.x0, sl.y, sl.z1, sl.x1, sl.y, sl.z1, sl.x1, sl.y, sl.z0, sl.x0, sl.y, sl.z0);
    for (const e of sl.rails || []) {
      const pts = e === 'front' ? [[sl.x0, sl.y, sl.z1 - 0.06], [sl.x1, sl.y, sl.z1 - 0.06]] : e === 'back' ? [[sl.x1, sl.y, sl.z0 + 0.06], [sl.x0, sl.y, sl.z0 + 0.06]] : e === 'right' ? [[sl.x1 - 0.06, sl.y, sl.z1], [sl.x1 - 0.06, sl.y, sl.z0]] : [[sl.x0 + 0.06, sl.y, sl.z0], [sl.x0 + 0.06, sl.y, sl.z1]];
      const gap = sl.gap && sl.gap.side === e ? sl.gap : null;
      if (gap) {
        // leave the stair arrival open
        const [p, q] = pts, horiz = Math.abs(q[0] - p[0]) > Math.abs(q[2] - p[2]);
        const a = gap.a, c = gap.c;
        const seg = (u0, u1) => horiz ? [[u0, sl.y, p[2]], [u1, sl.y, p[2]]] : [[p[0], sl.y, u0], [p[0], sl.y, u1]];
        const lo = horiz ? Math.min(p[0], q[0]) : Math.min(p[2], q[2]), hi = horiz ? Math.max(p[0], q[0]) : Math.max(p[2], q[2]);
        if (a - lo > 0.3) railSimple(b, seg(lo, a));
        if (hi - c > 0.3) railSimple(b, seg(c, hi));
      } else railSimple(b, pts);
    }
    // columns under free corners
    for (const [x, z] of sl.columns || []) { b.cbox('steel_dark', x - 0.12, ffl, z - 0.12, x + 0.12, sl.y - 0.25, z + 0.12, 0.01, false); if (b.collecting) b.colBox(x - 0.12, ffl, z - 0.12, x + 0.12, sl.y, z + 0.12); }
  }
  // partitions
  for (const wd of H.walls || []) partition(ctx, wd);
  // stairs
  for (const st of H.stairs || []) stairStraight(ctx, st);
}

function autoLights(I, y) {
  const out = [];
  const nx = Math.max(1, Math.round((I.x1 - I.x0) / 6)), nz = Math.max(1, Math.round((I.z1 - I.z0) / 6));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push({ x: I.x0 + ((I.x1 - I.x0) * (i + 0.5)) / nx, z: I.z0 + ((I.z1 - I.z0) * (j + 0.5)) / nz, y });
  return out;
}

/** Guard rail (steel) along an interior slab edge with collider. */
export function railSimple(b, pts, key = 'steel_yellow') {
  const H = 1.1;
  b.tube(key, pts.map((p) => [p[0], p[1] + H, p[2]]), 0.022, 8);
  b.tube(key, pts.map((p) => [p[0], p[1] + 0.55, p[2]]), 0.016, 6);
  const p = pts[0], q = pts[pts.length - 1], L = Math.hypot(q[0] - p[0], q[2] - p[2]);
  const n = Math.max(1, Math.ceil(L / 1.4));
  for (let k = 0; k <= n; k++) { const t = k / n, x = p[0] + (q[0] - p[0]) * t, z = p[2] + (q[2] - p[2]) * t; b.box(key, x - 0.022, p[1], z - 0.022, x + 0.022, p[1] + H, z + 0.022, PX | NX | PZ | NZ); }
  if (b.collecting) b.colBox(Math.min(p[0], q[0]) - 0.03, p[1], Math.min(p[2], q[2]) - 0.03, Math.max(p[0], q[0]) + 0.03, p[1] + H, Math.max(p[2], q[2]) + 0.03);
}

/** Interior partition (plaster both faces) with door openings + door units + colliders. */
export function partition(ctx, wd) {
  const b = ctx.b;
  const t = wd.t ?? 0.15, y0 = wd.y0, y1 = wd.y1;
  const dx = wd.x1 - wd.x0, dz = wd.z1 - wd.z0, L = Math.hypot(dx, dz);
  if (L < 0.3) return;
  b.push(); b.translate(wd.x0, 0, wd.z0); b.rotY(-Math.atan2(dz, dx));
  // wall frame: x along, z normal; wall spans z ∈ [−t/2, t/2]
  b.translate(0, 0, t / 2);
  const ops = (wd.doors || []).map((d) => ({ u0: Math.max(0.1, d.at - d.w / 2), u1: Math.min(L - 0.1, d.at + d.w / 2), v0: y0, v1: y0 + (d.h ?? 2.1), reveal: t, chamfer: 0, noSillReveal: true, glazed: d.glazed }));
  b.pushTint(wd.tint || [0.93, 0.93, 0.91]);
  K.wallWithOpenings(b, { L, y0, y1, T: t, openings: ops, outer: wd.key || 'plaster', inner: wd.key || 'plaster', innerReveals: true, capStart: true, capEnd: true });
  b.popTint();
  for (const p of ops) K.doorUnit(b, { u0: p.u0, u1: p.u1, v0: p.v0, v1: p.v1, R: 0, T: t, kind: p.glazed ? 'glazed' : 'interior', open: 0.85, hinge: 'left', inward: true, glassKey: 'glass_clear' });
  if (b.collecting) {
    let u = 0;
    for (const p of ops) { if (p.u0 > u) b.colBox(u, y0, -t, p.u0, y1, 0); u = p.u1; b.colBox(p.u0, p.v1, -t, p.u1, y1, 0); }
    if (L > u) b.colBox(u, y0, -t, L, y1, 0);
  }
  b.pop();
}

/** Straight interior stair (steel, yellow rails): {x, z, y0, rise, dir (rad, 0=+x), W}. */
export function stairStraight(ctx, st) {
  const b = ctx.b;
  const n = Math.max(2, Math.ceil(st.rise / 0.18)), h = st.rise / n, tr = 0.27;
  const W = st.W ?? 1.0, run = (n - 1) * tr;
  b.push(); b.translate(st.x, st.y0, st.z); b.rotY(-(st.dir || 0));
  for (let i = 0; i < n - 1; i++) {
    const x0 = i * tr, yt = (i + 1) * h;
    b.box(st.treadKey || 'grille_dark', x0, yt - 0.04, -W / 2, x0 + tr + 0.02, yt, W / 2, PY | NY | PX | NX);
    b.box('steel', x0 + tr - 0.02, yt - 0.05, -W / 2, x0 + tr + 0.02, yt, W / 2, PX | PY | NX);
  }
  const ang = Math.atan2(st.rise, run + tr), len = Math.hypot(st.rise, run + tr);
  for (const sz of [-W / 2 - 0.03, W / 2 + 0.03]) { b.push(); b.translate(0, -0.06, sz); b.rotZ(ang); b.box('steel_dark', -0.05, -0.2, -0.025, len, 0.04, 0.025, ALL); b.pop(); }
  for (const sz of [-W / 2 - 0.05, W / 2 + 0.05]) {
    const pts = [[0, 1.0, sz], [run + tr, st.rise + 1.0, sz]];
    b.tube('steel_yellow', pts, 0.022, 8);
    b.tube('steel_yellow', pts.map((p) => [p[0], p[1] - 0.5, p[2]]), 0.016, 6);
    for (let k = 0; k <= 3; k++) { const t = k / 3; b.box('steel_yellow', (run + tr) * t - 0.02, st.rise * t, sz - 0.02, (run + tr) * t + 0.02, st.rise * t + 1.0, sz + 0.02, PX | NX | PZ | NZ); }
  }
  if (b.collecting) { b.colQuad(0, 0, W / 2, run + tr, st.rise, W / 2, run + tr, st.rise, -W / 2, 0, 0, -W / 2); b.colBox(0, 0, W / 2 + 0.03, run + tr, st.rise + 1.0, W / 2 + 0.08); b.colBox(0, 0, -W / 2 - 0.08, run + tr, st.rise + 1.0, -W / 2 - 0.03); }
  b.pop();
  return run + tr;
}

/** Furniture helpers for small offices / control rooms (current frame, facing +z after rot). */
export function consoleDesk(b, x, y, z, w = 2.4, rot = 0) {
  b.push(); b.translate(x, y, z); b.rotY(rot);
  b.cbox('cabinet', -w / 2, 0, -0.35, w / 2, 0.72, 0.35, 0.01, false);
  b.push(); b.translate(0, 0.72, -0.2); b.rotX(-0.35);
  b.cbox('steel_dark', -w / 2 + 0.05, 0, -0.12, w / 2 - 0.05, 0.03, 0.12, 0.005);
  b.pop();
  const n = Math.max(1, Math.round(w / 0.8));
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (w * (i + 0.5)) / n;
    b.cbox('black', cx - 0.3, 0.78, -0.3, cx + 0.3, 1.18, -0.26, 0.005);
    // (fix 2) screens dim enough to read as displays by day ('light_cyan' glows always), not as blank light panels
    b.withTint([0.1, 0.17, 0.22], () => b.rectZ('light_cyan', cx - 0.27, 0.81, cx + 0.27, 1.15, -0.258, 1));
    b.box('steel_dark', cx - 0.03, 0.72, -0.32, cx + 0.03, 0.8, -0.28, ALL);
  }
  b.pop();
  if (b.collecting) { b.push(); b.translate(x, y, z); b.rotY(rot); b.colBox(-w / 2, 0, -0.35, w / 2, 0.75, 0.35); b.pop(); }
}

/** Office chair (current frame). */
export function chairSimple(b, x, y, z, rot = 0) {
  b.push(); b.translate(x, y, z); b.rotY(rot);
  b.cylinder('steel_dark', 0, 0.05, 0, 0.03, 0.4, 6, { top: false });
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; b.box('steel_dark', Math.cos(a) * 0.25 - 0.02, 0.02, Math.sin(a) * 0.25 - 0.02, Math.cos(a) * 0.25 + 0.02, 0.06, Math.sin(a) * 0.25 + 0.02, ALL); }
  b.withTint([0.25, 0.28, 0.32], () => { b.cbox('fabric', -0.24, 0.44, -0.24, 0.24, 0.52, 0.24, 0.02); b.cbox('fabric', -0.22, 0.55, -0.27, 0.22, 1.0, -0.22, 0.02); });
  b.pop();
}

/** Workbench with tools (current frame). */
export function workbench(b, x, y, z, w = 2.0, rot = 0) {
  b.push(); b.translate(x, y, z); b.rotY(rot);
  b.cbox('wood', -w / 2, 0.86, -0.38, w / 2, 0.92, 0.38, 0.01);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('steel_dark', sx * (w / 2 - 0.08) - 0.03, 0, sz * 0.3 - 0.03, sx * (w / 2 - 0.08) + 0.03, 0.86, sz * 0.3 + 0.03, PX | NX | PZ | NZ);
  b.box('steel_dark', -w / 2 + 0.05, 0.15, -0.35, w / 2 - 0.05, 0.18, 0.35, ALL);
  b.cbox('steel_dark', -w / 2, 0.92, -0.4, w / 2, 1.8, -0.36, 0.005);      // tool wall
  b.withTint([0.8, 0.25, 0.2], () => b.cbox('hvac', w / 2 - 0.55, 0.92, -0.3, w / 2 - 0.1, 1.15, 0.0, 0.01)); // tool box
  b.pop();
  if (b.collecting) { b.push(); b.translate(x, y, z); b.rotY(rot); b.colBox(-w / 2, 0, -0.4, w / 2, 0.92, 0.38); b.pop(); }
}

/** Storage rack (pallet racking) along local x (current frame). */
export function rack(b, x, y, z, L = 4, h = 3.6, rot = 0, seed = 1) {
  b.push(); b.translate(x, y, z); b.rotY(rot);
  const n = Math.max(1, Math.round(L / 2.7)), d = 1.1;
  for (let i = 0; i <= n; i++) { const xx = -L / 2 + (L * i) / n; for (const zz of [-d / 2, d / 2]) b.box('steel_yellow', xx - 0.04, 0, zz - 0.04, xx + 0.04, h, zz + 0.04, PX | NX | PZ | NZ); }
  const levels = Math.max(2, Math.floor(h / 1.2));
  for (let k = 1; k <= levels; k++) {
    const yy = (h * k) / (levels + 0.3);
    for (const zz of [-d / 2, d / 2]) b.withTint([0.95, 0.45, 0.15], () => b.box('steel_yellow', -L / 2, yy - 0.06, zz - 0.03, L / 2, yy + 0.04, zz + 0.03, ALL));
    // boxes / crates on the level
    for (let i = 0; i < n; i++) {
      const h2 = hash4(seed, k, i, 3);
      if ((h2 & 3) === 0) continue;
      const xx = -L / 2 + (L * (i + 0.5)) / n, bw = L / n - 0.3;
      b.withTint(((h2 >> 3) & 1) ? [0.75, 0.6, 0.42] : [0.85, 0.85, 0.82], () => b.cbox((h2 >> 3) & 1 ? 'wood' : 'plastic_bin', xx - bw / 2, yy + 0.04, -d / 2 + 0.05, xx + bw / 2, yy + 0.04 + 0.7 + ((h2 >> 5) & 3) * 0.08, d / 2 - 0.05, 0.02));
    }
  }
  b.pop();
  if (b.collecting) { b.push(); b.translate(x, y, z); b.rotY(rot); b.colBox(-L / 2, 0, -d / 2, L / 2, h, d / 2); b.pop(); }
}

/** Ground floor sides of the footprint as a list of the door-free spans (for drifts). */
export function doorSpans(ops) { return (ops || []).filter((o) => o.kind === 'door' || o.kind === 'roller').map((o) => [o.u0 - 0.5, o.u1 + 0.5]); }

export { sideGround, lampPost, rectFrame };
