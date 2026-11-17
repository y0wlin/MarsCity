// Ferry terminal (轮渡站), Zhurong family (owner: buildings-z).
//
// Landside (front, +z) → waterside (back, −z, spec.meta.waterSide 'back', pier along meta.pierHeading):
// street forecourt with drop-off kerb, bollards and bikes → glazed entrance (two glazed double doors
// under a tall transom) → ticket hall (ticket counters, a line of ticket gates across the hall) →
// waiting hall with benches facing the full-height waterside glazing → boarding doors ('ferry'
// entrance) → covered boarding walkway on columns out over the quay / pier (the pier deck itself is
// the city's dock geometry) ending in a boarding gate portal. Service end (spec 'service' side):
// stair + lift core, WC, staff rooms, service door. Upper floor: café / lounge, set back on the water
// side to a terrace with glass balustrades. Over everything floats the ZR roof: a rounded white
// ceramic canopy slab overhanging 6–9 m towards the water on slender white columns and short pins
// above the upper roof, with downlights, a limited cyan edge strip and a blank sign on the fascia.
// Variants: zr_cold / meta.covered → enclosed glazed walkway + draught porch; zr_island → timber
// soffit and timber walkway deck. Instance variation: terrace depth, canopy overhang, bay rhythm.

import * as K from '../kit/index.js';
import { kindCode } from '../kit/plan.js';
import { clamp, cyanStrip, signTotem, bollardLine, zMass, specEntrances, columnCanopy, glassScreen, benchRow, glassRoom, reception, waitingBench, straightStair, slabWithHoles, lightBox, signContent } from './z_common.js';
import { hall } from './z_hall.js';

function layout(ctx) {
  const s = ctx.spec;
  const w = s._w, d = s._d;
  const rng = ctx.sub(1201);
  const frontG = Math.max(s._ground.fl, s._ground.fr);
  const ffl = Math.max(0.35, frontG + 0.15);
  const gh = clamp(+s.groundFloorHeight || 6, 5.0, 6.5);
  const fh = clamp(+s.floorHeight || 5, 4.2, 5.5);
  const two = (s._floors | 0) >= 2;
  const roofY = ffl + gh + (two ? fh : 0);
  const tz = clamp(3.0 + rng.next() * 1.5, 3.0, 4.5);
  const ovW = clamp(6.5 + rng.next() * 2.5, 6.0, 9.0);
  const ovF = 2.6, ovS = 1.8 + rng.next() * 1.0;
  const gap = 1.3;
  const cT = 0.85;
  const cY = roofY + gap + cT;
  const svc = specEntrances(ctx, 'service')[0];
  const coreSide = svc && (svc.side === 'left' || svc.side === 'right') && !s._shared[svc.side] ? svc.side : (!s._shared.left ? 'left' : 'right');
  const coreW = clamp(w * 0.17, 6.0, 8.5);
  const coreX0 = coreSide === 'left' ? -w / 2 : w / 2 - coreW, coreX1 = coreX0 + coreW;
  const Lw = clamp(12 + rng.next() * 6, 12, 18);
  return { w, d, ffl, gh, fh, two, roofY, tz, ovW, ovF, ovS, gap, cT, cY, coreSide, coreW, coreX0, coreX1, Lw, rng, svc };
}

/** Glazed bays between ceramic piers along a side (wall-frame u), skipping [a,b] ranges. */
function glazedBays(L, skip, v0, v1, o = {}) {
  const out = [];
  const bay = o.bay ?? 7.2;
  const n = Math.max(1, Math.round(L / bay));
  for (let i = 0; i < n; i++) {
    let a = (L * i) / n + 0.35, c = (L * (i + 1)) / n - 0.35;
    if (i === 0) a = Math.max(a, 0.7);
    if (i === n - 1) c = Math.min(c, L - 0.7);
    const parts = [[a, c]];
    for (const [p, q] of skip) {
      for (let k = parts.length - 1; k >= 0; k--) {
        const [x, y] = parts[k];
        if (q <= x || p >= y) continue;
        parts.splice(k, 1);
        if (p - x > 1.0) parts.push([x, p]);
        if (y - q > 1.0) parts.push([q, y]);
      }
    }
    for (const [x, y] of parts) out.push({ u0: x, u1: y, v0, v1, kind: 'curtain', pane: o.pane ?? 1.5, rows: o.rows ? o.rows(v0, v1) : undefined, room: o.room || 'waiting', depth: o.depth ?? 8, floorY: o.floorY, floor: o.floor ?? 0, bay: i });
  }
  return out;
}

function generate(ctx) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const L = layout(ctx);
  const { w, d, ffl, gh, fh, two, roofY, tz, ovW, ovF, ovS, cT, cY, coreSide, coreW, coreX0, coreX1, Lw } = L;
  const full = ctx.full;
  const cold = st.id === 'zr_cold' || !!s._meta.covered;
  const island = st.id === 'zr_island';
  const T = 0.3;
  const wk = st.wall, shell = inst.shellTint;
  // ---- entrances ----
  const mainE = specEntrances(ctx, 'main').find((e) => e.side === 'front');
  const mainU = clamp(mainE ? mainE.u : w / 2, 4, w - 4);
  const ferryE = specEntrances(ctx, 'ferry').find((e) => e.side === 'back');
  const ferryU = clamp(ferryE ? ferryE.u : w / 2, 4, w - 4);         // back wall frame u (u = 0 at x = +w/2)
  const ferryX = w / 2 - ferryU;
  const coreFrontU = coreSide === 'left' ? [0, coreW] : [w - coreW, w];
  const coreBackU = coreSide === 'left' ? [w - coreW, w] : [0, coreW];
  const top0 = ffl + gh - 0.75;
  const rows = (v0, v1) => [v0, v0 + 0.3, Math.min(v1 - 0.6, v0 + 3.0), v1];
  // ---------------- ground floor ----------------
  const sides = { front: [], back: [], left: [], right: [] };
  // front: two glazed double doors under a transom, glazed bays elsewhere, solid core end
  const dA = [mainU - 2.75, mainU - 0.35], dB = [mainU + 0.35, mainU + 2.75];
  for (const [a, c] of [dA, dB]) sides.front.push({ u0: a, u1: c, v0: ffl, v1: ffl + 2.75, kind: 'door', doorKind: 'glazed_double' });
  sides.front.push({ u0: mainU - 2.95, u1: mainU + 2.95, v0: ffl + 2.95, v1: top0, kind: 'curtain', pane: 1.5, room: 'lobby', depth: 8 });
  sides.front.push(...glazedBays(w, [coreFrontU.map((u, i) => u + (i ? 0.3 : -0.3)), [mainU - 3.3, mainU + 3.3]], ffl, top0, { rows, room: 'waiting', depth: d * 0.5, floorY: ffl }));
  // back (water): boarding doors + full glazing
  const fA = [ferryU - 2.55, ferryU - 0.25], fB = [ferryU + 0.25, ferryU + 2.55];
  for (const [a, c] of [fA, fB]) sides.back.push({ u0: a, u1: c, v0: ffl, v1: ffl + 2.75, kind: 'door', doorKind: 'glazed_double' });
  sides.back.push({ u0: ferryU - 2.75, u1: ferryU + 2.75, v0: ffl + 2.95, v1: top0, kind: 'curtain', pane: 1.4, room: 'waiting', depth: 8 });
  sides.back.push(...glazedBays(w, [coreBackU.map((u, i) => u + (i ? 0.3 : -0.3)), [ferryU - 3.1, ferryU + 3.1]], ffl, top0, { rows, room: 'waiting', depth: d * 0.5, floorY: ffl }));
  // core end: service door + WC windows; other end glazed
  const otherSide = coreSide === 'left' ? 'right' : 'left';
  if (!s._shared[coreSide]) {
    const su = clamp(L.svc ? L.svc.u : d / 2, 2, d - 2);
    sides[coreSide].push({ u0: su - 0.6, u1: su + 0.6, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'service' });
    for (const u of [d * 0.2, d * 0.8]) if (Math.abs(u - su) > 2) sides[coreSide].push({ u0: u - 0.9, u1: u + 0.9, v0: ffl + 1.7, v1: ffl + 2.9, kind: 'window', type: 'casement', room: 'bath', floorY: ffl, depth: 3 });
  }
  if (!s._shared[otherSide]) sides[otherSide].push(...glazedBays(d, [], ffl, top0, { rows, room: 'waiting', depth: w * 0.4, floorY: ffl, bay: 6 }));
  hall(ctx, {
    x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y0: ffl, eave: gh - 0.35, wallKey: wk, wallT: T, wallTint: shell,
    sides: { front: { openings: sides.front }, back: { openings: sides.back }, left: { openings: sides.left }, right: { openings: sides.right } },
    roof: { kind: 'none' }, frames: 0, floorKey: 'stone_floor', lightPanels: true,
  });
  K.plinth(b, s, ffl, { skip: s._shared });
  const yT = ffl + gh;
  // stair well (2 storeys): straight flight along +z inside the core, hole through the terrace slab
  const sxc = coreSide === 'left' ? coreX0 + 2.2 : coreX1 - 2.2;
  const zS0 = -d / 2 + T + 1.0;
  const stairRun = K.risers(gh, 0.175).n * 0.28;
  const zS1 = zS0 + stairRun;
  const hole = two ? { x0: sxc - 0.8, x1: sxc + 0.8, z0: zS0 + (stairRun * (gh - 2.7)) / gh, z1: zS1 + 0.1 } : null;
  // terrace slab (projecting white slab edge between the storeys)
  b.withTint(inst.bandTint, () => slabWithHoles(b, { x0: -w / 2 - 0.15, x1: w / 2 + 0.15, z0: -d / 2 - 0.15, z1: d / 2 + 0.15 }, hole ? [hole] : [], yT - 0.35, yT, { top: 'roof_tiles', bottom: 'render_white', edge: st.band, holeEdge: 'concrete_smooth' }));
  // terrace balustrade on the ground-floor roof
  const ux0 = -w / 2 + 0.25, ux1 = w / 2 - 0.25, uz0 = -d / 2 + 0.25, uz1 = d / 2 - 0.25;
  K.railing(b, [[ux0, uz1], [ux0, uz0], [ux1, uz0], [ux1, uz1]], yT + 0.2, { kind: 'glass', key: 'aluminium' });
  if (b.collecting) { b.colBox(ux0 - 0.05, yT, uz0 - 0.05, ux1 + 0.05, yT + 1.3, uz0 + 0.05); b.colBox(ux0 - 0.05, yT, uz0, ux0 + 0.05, yT + 1.3, uz1); b.colBox(ux1 - 0.05, yT, uz0, ux1 + 0.05, yT + 1.3, uz1); }
  // ---------------- upper floor (café / lounge) ----------------
  const ux = [-w / 2 + 1.2, w / 2 - 1.2], uz = [-d / 2 + tz, d / 2 - 1.0];
  if (two) {
    const W2 = ux[1] - ux[0], D2 = uz[1] - uz[0];
    const up = { front: [], back: [], left: [], right: [] };
    const y1 = yT, top1 = y1 + fh - 0.7;
    const cU = coreSide === 'left' ? [0, coreW - 1.2] : [W2 - coreW + 1.2, W2];
    const cUb = coreSide === 'left' ? [W2 - coreW + 1.2, W2] : [0, coreW - 1.2];
    up.front.push(...glazedBays(W2, [[cU[0] - 0.3, cU[1] + 0.3]], y1, top1, { rows: (a, c) => [a, a + 1.1, c], room: 'shop', depth: D2 * 0.6, floorY: y1, floor: 1 }));
    const tdu = clamp(ux[1] - ferryX, 3, W2 - 3);              // back frame u of the terrace door (u = 0 at x = ux[1])
    up.back.push({ u0: tdu - 1.2, u1: tdu + 1.2, v0: y1, v1: y1 + 2.6, kind: 'door', doorKind: 'glazed_double' });
    up.back.push(...glazedBays(W2, [[cUb[0] - 0.3, cUb[1] + 0.3], [tdu - 1.6, tdu + 1.6]], y1, top1, { rows: (a, c) => [a, a + 0.2, c], room: 'shop', depth: D2 * 0.6, floorY: y1, floor: 1 }));
    up[otherSide].push(...glazedBays(D2, [], y1, top1, { rows: (a, c) => [a, a + 1.1, c], room: 'shop', depth: W2 * 0.5, floorY: y1, floor: 1, bay: 6 }));
    hall(ctx, {
      x0: ux[0], x1: ux[1], z0: uz[0], z1: uz[1], y0: y1, eave: fh, wallKey: wk, wallT: 0.28, wallTint: shell,
      sides: { front: { openings: up.front }, back: { openings: up.back }, left: { openings: up.left }, right: { openings: up.right } },
      roof: { kind: 'flat', parapet: 0.45, surface: 'roof_membrane' }, frames: 0, noFloor: true, lightPanels: true,
    });
    if (full) {
      const ir = [[ux[0] + 0.28, uz[0] + 0.28], [ux[1] - 0.28, uz[0] + 0.28], [ux[1] - 0.28, uz[1] - 0.28], [ux[0] + 0.28, uz[1] - 0.28]];
      b.polyY('wood_floor', ir, hole ? [[[hole.x0, hole.z0], [hole.x1, hole.z0], [hole.x1, hole.z1], [hole.x0, hole.z1]]] : [], yT + 0.02, 1);
    }
    // terrace deck (raised timber) on the water side
    b.box('wood_deck', ux0 + 0.1, yT, uz0 + 0.1, ux1 - 0.1, yT + 0.1, uz[0] - 0.05, 4 | 1 | 2 | 16 | 32);
    benchRow(b, ux[0] + 3, ux[1] - 3, uz0 + 1.2, yT + 0.1, 0, 6);
    // roof plant (upper roof, under the canopy)
    for (let i = 0; i < 2; i++) K.hvacUnit(b, (coreSide === 'left' ? -1 : 1) * (W2 / 2 - 4 - i * 3.4), roofY + 0.02, (uz[0] + uz[1]) / 2, 0, { w: 2.2, d: 1.1, h: 1.1 });
  }
  // ---------------- floating canopy roof ----------------
  const cx0 = -w / 2 - ovS, cx1 = w / 2 + ovS, cz0 = -d / 2 - ovW, cz1 = d / 2 + ovF;
  const cols = [];
  const gAt = (x, z) => Math.min(ffl, K.groundAt(s, x, z)) - 0.15;
  const nFront = Math.max(2, Math.round((cx1 - cx0) / 12));
  for (let i = 0; i <= nFront; i++) { const x = cx0 + 1.2 + ((cx1 - cx0 - 2.4) * i) / nFront; if (Math.abs(x - (mainU - w / 2)) < 3.6) continue; cols.push([x, cz1 - 0.9, gAt(x, cz1 - 0.9)]); }
  const nBack = Math.max(2, Math.round((cx1 - cx0) / 10));
  for (let i = 0; i <= nBack; i++) { const x = cx0 + 1.2 + ((cx1 - cx0 - 2.4) * i) / nBack; if (Math.abs(x - ferryX) < 3.2) continue; cols.push([x, cz0 + 1.0, gAt(x, cz0 + 1.0)]); }
  b.withTint(inst.bandTint, () => columnCanopy(b, { x0: cx0, x1: cx1, z0: cz0, z1: cz1, y: cY, t: cT, rounded: Math.min(9, (cz1 - cz0) * 0.32), cols, key: st.band, soffitKey: island ? 'wood' : 'render_white', colKey: 'ceramic_white', colR: 0.26 }));
  // pins from the roof below up to the canopy soffit (the canopy floats)
  const pinY0 = two ? roofY + 0.01 : yT + 0.01;
  for (const [x, z] of [[-w * 0.32, -d * 0.1], [w * 0.32, -d * 0.1], [-w * 0.32, d * 0.3], [w * 0.32, d * 0.3]]) {
    const xx = clamp(x, ux[0] + 1, ux[1] - 1), zz = two ? clamp(z, uz[0] + 1, uz[1] - 1) : z;
    b.lathe('ceramic_white', [[0.42, 0], [0.42, 0.06], [0.14, 0.35], [0.12, cY - cT - pinY0 - 0.3], [0.34, cY - cT - pinY0]], 20, { x: xx, y: pinY0, z: zz, capTop: false, capBottom: false });
    if (b.collecting) b.colBox(xx - 0.3, pinY0, zz - 0.3, xx + 0.3, cY - cT, zz + 0.3);
  }
  // cyan edge strip on the water-side fascia (limited) + blank sign on the land-side fascia
  cyanStrip(b, cx0 + 6, cz0 - 0.012, cx1 - 6, cz0 - 0.012, cY - cT * 0.55, { t: 0.03 });
  b.push(); K.facadeFrame(b, 'front', w, d, 0); b.translate(0, 0, ovF);
  lightBox(b, mainU, cY - cT + 0.15, Math.min(9, w * 0.3), cT - 0.3, 0.15, { depth: 0.13, picto: 'arrow', rows: 1, seed: s.hash });
  b.pop();
  // ---------------- boarding walkway (water side) ----------------
  // urban meta.pierHeading = compass bearing of the pier (out over the water); the back facade normal points to
  // heading + 180. The walkway turns about its root at the back facade by the difference (≤ 35°) so it runs
  // along the city's pier; waterSide is always 'back' (urban parcels face the front to the land).
  const pierDelta = (() => {
    const ph = +s._meta.pierHeading;
    if (!Number.isFinite(ph)) return 0;
    let dlt = ((ph - ((+s.heading || 0) + 180)) % 360 + 540) % 360 - 180;
    return clamp(dlt, -35, 35) * Math.PI / 180;
  })();
  b.push(); b.translate(ferryX, 0, -d / 2); b.rotY(-pierDelta); b.translate(-ferryX, 0, d / 2);
  const wz0 = -d / 2 - Lw, wz1 = -d / 2;
  const wy = ffl + 3.9;
  const wcols = [];
  for (let z = -d / 2 - 4; z > wz0 + 0.5; z -= 5) for (const sx of [-1.95, 1.95]) wcols.push([ferryX + sx, z, gAt(ferryX + sx, z)]);
  wcols.push([ferryX - 1.95, wz0 + 0.6, gAt(ferryX - 1.95, wz0 + 0.6)], [ferryX + 1.95, wz0 + 0.6, gAt(ferryX + 1.95, wz0 + 0.6)]);
  b.withTint(inst.bandTint, () => columnCanopy(b, { x0: ferryX - 2.3, x1: ferryX + 2.3, z0: wz0, z1: wz1 + 0.1, y: wy, t: 0.32, rounded: 0.8, cols: wcols, key: st.band, soffitKey: island ? 'wood' : 'render_white', colKey: 'ceramic_white', colR: 0.14 }));
  // walkway deck (raised boardwalk) + side rails
  const deckK = island ? 'wood_deck' : 'paving_stone';
  b.cbox(deckK, ferryX - 2.0, ffl - 0.35, wz0, ferryX + 2.0, ffl - 0.01, wz1, 0.015, false);
  if (b.collecting) b.colQuad(ferryX - 2.0, ffl, wz1, ferryX + 2.0, ffl, wz1, ferryX + 2.0, ffl, wz0, ferryX - 2.0, ffl, wz0);
  if (cold) {
    // enclosed walkway: glass walls on both sides
    for (const sx of [-1, 1]) {
      b.push(); b.translate(ferryX + sx * 2.05, 0, (wz0 + wz1) / 2); b.rotY(sx < 0 ? -Math.PI / 2 : Math.PI / 2);
      glassScreen(b, { u0: -Lw / 2 + 0.3, u1: Lw / 2 - 0.3, v0: ffl, v1: wy - 0.33, z: 0, pane: 1.6, rows: [ffl, ffl + 0.3, wy - 0.33], frameKey: 'aluminium_dark', glassKey: full ? 'glass_clear' : 'glass_shop', room: glassRoom(ctx, { kind: 'corridor', w: 4, d: 3.8, h: 3.6, sill: 0 }), back: true });
      b.pop();
    }
  } else {
    for (const sx of [-1, 1]) {
      K.railing(b, [[ferryX + sx * 1.92, wz1 - 0.3], [ferryX + sx * 1.92, wz0 + 0.2]], ffl, { kind: 'bars', key: 'steel' });
      if (b.collecting) b.colBox(ferryX + sx * 1.92 - 0.05, ffl, wz0, ferryX + sx * 1.92 + 0.05, ffl + 1.1, wz1 - 0.3);
    }
  }
  // boarding gate portal at the walkway end: posts + lintel sign + cyan line + gate leaves
  b.cbox('aluminium_dark', ferryX - 2.25, ffl, wz0 + 0.1, ferryX - 1.95, wy - 0.32, wz0 + 0.45, 0.01, false);
  b.cbox('aluminium_dark', ferryX + 1.95, ffl, wz0 + 0.1, ferryX + 2.25, wy - 0.32, wz0 + 0.45, 0.01, false);
  b.cbox('aluminium_dark', ferryX - 2.25, ffl + 2.7, wz0 + 0.1, ferryX + 2.25, ffl + 3.3, wz0 + 0.45, 0.01, false);
  b.rectZ('signage_blank', ferryX - 2.0, ffl + 2.76, ferryX + 2.0, ffl + 3.24, wz0 + 0.094, -1);
  b.push(); b.translate(ferryX, 0, wz0 + 0.094); b.rotY(Math.PI); signContent(b, -1.97, ffl + 2.79, 1.97, ffl + 3.21, 0.001, { picto: 'arrow', rows: 1, seed: s.hash ^ 0x5f }); b.pop();
  cyanStrip(b, ferryX - 1.9, wz0 + 0.08, ferryX + 1.9, wz0 + 0.08, ffl + 2.68, { t: 0.025 });
  for (const sx of [-1, 1]) { b.box('glass_railing', ferryX + sx * 0.05, ffl + 0.05, wz0 + 0.25, ferryX + sx * 1.9, ffl + 1.05, wz0 + 0.27, 63); b.box('aluminium', ferryX + sx * 0.05, ffl + 1.05, wz0 + 0.23, ferryX + sx * 1.9, ffl + 1.1, wz0 + 0.29, 63); }
  b.pop();
  // ---------------- land side: forecourt, steps, ramp, kerb, bikes ----------------
  b.push(); K.facadeFrame(b, 'front', w, d, 0);
  const [g0, g1] = K.sideGround(s, 'front');
  const gF = Math.min(g0, g1);
  b.cbox('paving_stone', 0.2, Math.min(gF, ffl) - 0.4, 0.0, w - 0.2, ffl - 0.005, 2.2, 0.012, false);
  if (b.collecting) b.colQuad(0.2, ffl, 2.2, w - 0.2, ffl, 2.2, w - 0.2, ffl, 0, 0.2, ffl, 0);
  const rise = ffl - gF;
  if (rise > 0.04) {
    K.steps(b, { u0: mainU - 4.5, u1: mainU + 4.5, z0: 2.2, y0: gF, y1: ffl, key: 'stone_step', cheeks: rise > 0.5, rails: rise > 0.45 });
    const uS = mainU + 4.8 + rise * 12;
    if (uS < w - 0.3) K.rampAlong(b, { uStart: uS, uEnd: mainU + 4.8, y0: gF, y1: ffl, z0: 0.6, z1: 2.1, key: 'paving_stone', railKey: 'steel' });
  }
  if (st.coveredEntry || cold) K.porch(b, { u0: mainU - 3.0, u1: mainU + 3.0, y0: ffl, depth: 2.0, h: 2.95, glassKey: full ? 'glass_clear' : 'glass_shop' });
  b.pop();
  const zK = d / 2 + 2.2 + Math.ceil(Math.max(0, rise) / 0.165) * 0.3 + 1.0;
  bollardLine(b, -w / 2 + 2, zK + 1.5, w / 2 - 2, zK + 1.5, gF, 2.2);
  K.bikeRacks(b, (coreSide === 'left' ? -w / 2 + 1.5 : w / 2 - 8.5), zK + 0.5, gF, 7, { spacing: 0.95 });
  signTotem(b, (mainU - w / 2) + (coreSide === 'left' ? 7 : -7), gF, zK + 0.4, 0, { w: 1.0, h: 2.8 });
  // waterside apron (paving at FFL) between the walkway and the facade, benches facing the water
  b.cbox('paving_stone', -w / 2 - 0.5, Math.min(ffl, K.groundAt(s, 0, -d / 2)) - 0.4, -d / 2 - Math.min(4.5, ovW - 1.5), w / 2 + 0.5, ffl - 0.035, -d / 2 + 0.02, 0.012, false);
  if (b.collecting) b.colQuad(-w / 2 - 0.5, ffl, -d / 2, w / 2 + 0.5, ffl, -d / 2, w / 2 + 0.5, ffl, -d / 2 - Math.min(4.5, ovW - 1.5), -w / 2 - 0.5, ffl, -d / 2 - Math.min(4.5, ovW - 1.5));
  benchRow(b, -w / 2 + 2, ferryX - 4, -d / 2 - 2.6, ffl, Math.PI, 5);
  benchRow(b, ferryX + 4, w / 2 - 2, -d / 2 - 2.6, ffl, Math.PI, 5);
  // ---------------- interior ('full') ----------------
  if (full) ferryInterior(ctx, L, { mainU, ferryX, T, yT, ux, uz, sxc, zS0, zS1, hole });
  // ---------------- anchors ----------------
  const A = b.anchors;
  A.floors = [{ level: 0, y: ffl, height: gh }];
  if (two) A.floors.push({ level: 1, y: yT, height: fh });
  A.roof = { y: two ? roofY : yT, access: [(coreX0 + coreX1) / 2, two ? roofY : yT, -d / 4] };
  A.entrances = [
    { kind: 'main', side: 'front', pos: [mainU - w / 2, ffl, d / 2 + 0.6], dir: [0, 0, 1], width: 5.4 },
    { kind: 'ferry', side: 'back', pos: [ferryX + (Lw + 0.6) * Math.sin(pierDelta), ffl, -d / 2 - (Lw + 0.6) * Math.cos(pierDelta)], dir: [Math.sin(pierDelta), 0, -Math.cos(pierDelta)], width: 4 },
  ];
  if (!s._shared[coreSide]) { const su = clamp(L.svc ? L.svc.u : d / 2, 2, d - 2); A.entrances.push({ kind: 'service', side: coreSide, pos: K.facadePoint(coreSide, w, d, su, ffl, 0.6), dir: K.facadeNormal(coreSide), width: 1.2 }); }
  A.rooms = [
    { floor: 0, name: 'ticket hall', kind: 'lobby', center: [mainU - w / 2, ffl, d * 0.22], size: [w - coreW, gh, d * 0.45] },
    { floor: 0, name: 'waiting hall', kind: 'waiting', center: [0, ffl, -d * 0.25], size: [w - coreW, gh, d * 0.5] },
  ];
  if (two) A.rooms.push({ floor: 1, name: 'cafe', kind: 'shop', center: [0, yT, (uz[0] + uz[1]) / 2], size: [ux[1] - ux[0], fh, uz[1] - uz[0]] });
  A.cameras = {
    street: { pos: [mainU - w / 2 - w * 0.4, gF + 1.65, d / 2 + Math.max(24, w * 0.6)], target: [0, ffl + 5, 0] },
    entrance: { pos: [mainU - w / 2 + 4, ffl + 1.65, d / 2 + 7], target: [mainU - w / 2, ffl + 2, d / 2] },
    interior: { pos: [mainU - w / 2 + 2, ffl + 1.65, d / 2 - 2.5], target: [ferryX, ffl + 1.8, -d / 2] },
    lobby: { pos: [mainU - w / 2 + 2, ffl + 1.65, d / 2 - 2.5], target: [ferryX, ffl + 1.8, -d / 2] },
    platform: { pos: [ferryX + 1.2, ffl + 1.65, wz0 + 1.5], target: [ferryX - 2, ffl + 3, -d / 2] },
    back: { pos: [ferryX - w * 0.5, ffl + 3, -d / 2 - Lw - 22], target: [0, ffl + 5, -d / 2] },
    roof: { pos: [-w * 0.6, cY + 22, -d / 2 - 24], target: [0, cY - 2, 0] },
  };
  if (two) A.cameras.living = { pos: [ux[0] + 2, yT + 1.65, uz[1] - 2], target: [ferryX, yT + 1.5, -d / 2 - 8] };
}

function ferryInterior(ctx, L, o) {
  const b = ctx.b, s = ctx.spec;
  const { w, d, ffl, gh, fh, two, coreSide, coreX0, coreX1 } = L;
  const { mainU, ferryX, T, yT, ux, uz, sxc, zS0, hole } = o;
  const mainX = mainU - w / 2;
  const inX0 = coreSide === 'left' ? coreX1 : -w / 2 + T, inX1 = coreSide === 'left' ? w / 2 - T : coreX0;
  // core block: WC + staff + stair hall (partition walls with door gaps)
  const cz = -d / 2 + T, czF = d / 2 - T;
  const xW = coreSide === 'left' ? coreX1 : coreX0;
  const gapZ = [-1.2, 1.2];
  b.box('plaster', xW - 0.08, ffl, cz, xW + 0.08, ffl + gh - 0.3, gapZ[0], 63 & ~8);
  b.box('plaster', xW - 0.08, ffl, gapZ[1], xW + 0.08, ffl + gh - 0.3, czF, 63 & ~8);
  if (b.collecting) { b.colBox(xW - 0.08, ffl, cz, xW + 0.08, ffl + gh, gapZ[0]); b.colBox(xW - 0.08, ffl, gapZ[1], xW + 0.08, ffl + gh, czF); }
  // ticket counters along the core wall (front half) + ticket gates across the hall
  b.push(); b.translate(xW + (coreSide === 'left' ? 0.8 : -0.8), ffl, d * 0.22); b.rotY(coreSide === 'left' ? Math.PI / 2 : -Math.PI / 2); reception(b, Math.min(6, d * 0.3)); b.pop();
  const zG = d * 0.02;
  const nG = Math.max(4, Math.floor((inX1 - inX0 - 4) / 1.1));
  for (let i = 0; i < nG; i++) {
    const x = inX0 + 2 + i * 1.1;
    if (x > inX1 - 1.5) break;
    b.cbox('steel_brushed', x - 0.14, ffl, zG - 0.6, x + 0.14, ffl + 1.0, zG + 0.6, 0.02, false);
    b.box('light_cyan', x - 0.1, ffl + 1.0, zG - 0.5, x + 0.1, ffl + 1.012, zG - 0.3, 63 & ~8);
    if (i < nG - 1) b.box('glass_railing', x + 0.14, ffl + 0.35, zG - 0.02, x + 0.55, ffl + 1.0, zG + 0.02, 63);
    if (b.collecting) b.colBox(x - 0.14, ffl, zG - 0.6, x + 0.14, ffl + 1.0, zG + 0.6);
  }
  // waiting benches facing the water
  for (let zr = -d / 2 + 3.2; zr < zG - 2.0; zr += 2.4) {
    for (let x = inX0 + 2.5; x < inX1 - 2.5; x += 3.2) {
      if (Math.abs(x - ferryX) < 2.8) continue;
      b.push(); b.translate(x, ffl, zr); b.rotY(Math.PI); waitingBench(b, 2.6); b.pop();
    }
  }
  // café kiosk at the far end of the ticket hall
  b.push(); b.translate(coreSide === 'left' ? inX1 - 2.5 : inX0 + 2.5, ffl, d * 0.25); b.rotY(coreSide === 'left' ? -Math.PI / 2 : Math.PI / 2); reception(b, 3.0); b.pop();
  // stair to the upper floor (inside the core, rising towards +x or −x)
  if (two) {
    const yU = yT;
    // straight flight along +z through the slab hole, guard rail around the well upstairs
    b.push(); b.translate(sxc, 0, 0); b.rotY(-Math.PI / 2); straightStair(b, zS0, ffl, 0, gh, 1.3); b.pop();
    if (hole) {
      K.railing(b, [[hole.x0, hole.z1 - 0.05], [hole.x0, hole.z0], [hole.x1, hole.z0], [hole.x1, hole.z1 - 0.05]], yU + 0.02, { kind: 'glass', key: 'aluminium' });
      if (b.collecting) { b.colBox(hole.x0 - 0.05, yU, hole.z0, hole.x0 + 0.05, yU + 1.1, hole.z1); b.colBox(hole.x1 - 0.05, yU, hole.z0, hole.x1 + 0.05, yU + 1.1, hole.z1); b.colBox(hole.x0, yU, hole.z0 - 0.05, hole.x1, yU + 1.1, hole.z0 + 0.05); }
    }
    // café tables upstairs
    for (let x = ux[0] + 3; x < ux[1] - 3; x += 3.6) {
      if (x > coreX0 - 1 && x < coreX1 + 1) continue;
      for (let z = uz[0] + 2; z < uz[1] - 1.5; z += 3.2) {
        b.cylinder('aluminium_dark', x, yU, z, 0.05, 0.72, 8, { top: false });
        b.cylinder('counter', x, yU + 0.72, z, 0.42, 0.03, 18, { top: true, bottom: true });
        for (const a of [0, Math.PI]) b.cbox('wood', x + Math.cos(a) * 0.7 - 0.2, yU, z + Math.sin(a) * 0.7 - 0.2, x + Math.cos(a) * 0.7 + 0.2, yU + 0.45, z + Math.sin(a) * 0.7 + 0.2, 0.01, false);
      }
    }
  }
  void s; void fh;
}

function massing(ctx) {
  const s = ctx.spec;
  const L = layout(ctx);
  const { w, d, ffl, gh, fh, two, roofY, tz, ovW, ovF, ovS, cT, cY } = L;
  const all = { front: true, right: true, back: true, left: true };
  const vols = [zMass(ctx, { fh: gh, gh, ffl, roofY: ffl + gh }, { parapet: 0.2, glazedGround: true, bands: false, roofColor: [0.86, 0.86, 0.84], bayW: 3.6 })];
  if (two) vols.push(zMass(ctx, { fh, gh: fh, ffl: ffl + gh, roofY }, { x0: -w / 2 + 1.2, x1: w / 2 - 1.2, z0: -d / 2 + tz, z1: d / 2 - 1.0, y0: ffl + gh, parapet: 0.45, glazedGround: true, bands: false, groundH: ffl + gh + fh, floorH: fh, bayW: 3.6 }));
  vols.push(zMass(ctx, { fh: 1, gh: 1, ffl, roofY: cY }, { x0: -w / 2 - ovS, x1: w / 2 + ovS, z0: -d / 2 - ovW, z1: d / 2 + ovF, y0: cY - cT, parapet: 0.0, blank: all, soffit: true, bands: false, roofColor: [0.92, 0.92, 0.9] }));
  void s;
  return vols;
}

export default {
  name: 'ferry_terminal',
  uses: ['ferry_terminal'],
  generate(spec, lod, ctx) { generate(ctx); },
  massing(spec, ctx) { return massing(ctx); },
};
