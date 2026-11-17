// 温室 — O-zone glass house (O02 middle, O03 lee rows, shot 03 / 04). OWNER: buildings-o.
//
// Plan first: the ridges run along the longer side; spans of meta.span (8–12 m) across the shorter side
// (single span for the urban rows, Venlo-style multi-span for wide lots). The main entrance (spec 'main',
// usually the street gable) gets a panel-clad entrance vestibule (门斗 with inner + outer doors) with steps
// and yellow handrails; the service entrance (spec 'service', 3.2 m) is a wide sliding glass door onto a
// concrete service apron with fertigation tanks and a cabinet. Inside: a concrete central work aisle from
// the vestibule to the service door, cross aisles at both gables, raised planting beds either side with the
// crop of the instance (tomato / cucumber high-wire rows, leafy greens, table-top berries), drip lines,
// heating pipes, light trusses with grow-light bars (occupancy-gated) and valley columns. Outside: knee
// wall (white panel / frost-white insulated in the polar provinces), aluminium frame grid with posts per
// 2.5 m bay, glazing bars, ridge caps, ridge vent lanterns, valley + eave gutters with downpipes, and the
// irrigation channel (配水渠) along one long side with its inlet riser, gate valve, slide gate and the
// wet grating where the service road crosses it. Climate: lee-side dust (dry), snow tongues + gutter snow
// and a higher insulated knee wall (polar), algae on the channel (wet).
// Glazing is agricultural glass at every LOD ('glass_agri': low-iron, slightly diffusing, transparent enough to read the
// beds, crops and work aisle), so beds and crops are built at 'exterior' too; doors keep clear glass. Plinths: oxidised basalt.

import * as K from '../kit/index.js';
import { PX, NX, PY, NY, PZ, NZ, ALL, oEnv, yellowRail, pipeRun, valve, lampPost, cabinet, drift, utilAnchors } from './o_common.js';
import { hash4, Rng } from '../../core/hash.js';

const DEG = Math.PI / 180;

/** Layout shared by generate + massing. */
export function ghLayout(ctx) {
  const s = ctx.spec, m = s._meta || {};
  const w = s._w, d = s._d;
  const alongZ = d >= w;                       // ridges along the building z axis
  const L = alongZ ? d : w, S = alongZ ? w : d;
  const span0 = Math.max(8, Math.min(12, +m.span || 9.6));
  const n = Math.max(1, Math.round(S / span0));
  const span = S / n;
  const E = oEnv(ctx);
  const ffl = 0.15;
  const pitch = 24 * DEG;
  const rise = (span / 2) * Math.tan(pitch);
  const ridgeH = Math.max(4.2, Math.min(7, s._fh || 5.2));
  const eave = Math.max(3.0, ridgeH - rise);
  const nb = Math.max(2, Math.round(L / 2.5)), bay = L / nb;
  const knee = E.polar ? 1.15 : 0.75;
  return { w, d, alongZ, L, S, n, span, ffl, pitch, rise, eave, ridge: eave + rise, nb, bay, knee, E };
}

/** roof height (local) at across-coordinate x */
function roofY(G, x) {
  const t = (x + G.S / 2) / G.span;
  const i = Math.max(0, Math.min(G.n - 1, Math.floor(t)));
  const f = t - i;
  return G.eave + G.rise * (1 - Math.abs(2 * f - 1));
}

function generate(spec, lod, ctx) {
  const b = ctx.b, s = ctx.spec;
  const G = ghLayout(ctx);
  const E = G.E;
  const { L, S, n, span, ffl, eave, rise, bay, knee } = G;
  const rng = ctx.sub(1501);
  const cropR = ctx.sub(1502);
  const crop = E.polar ? (cropR.next() < 0.55 ? 'greens' : 'berries') : ['vine', 'vine', 'greens', 'berries', 'vine'][Math.floor(cropR.next() * 5)];
  // ---- entrances → local walls ----
  const mainE = s._entrances.find((e) => e.kind === 'main') || { side: 'front', offset: 0, width: 2.4 };
  const svcE = s._entrances.find((e) => e.kind === 'service' || e.kind === 'loading') || { side: 'back', offset: 0, width: 3.2 };
  const wallOf = (side) => (G.alongZ ? { front: 'gP', back: 'gN', right: 'sP', left: 'sN' } : { front: 'sN', back: 'sP', right: 'gP', left: 'gN' })[side];
  // along-wall coordinate of a building-frame entrance
  const entLocal = (e) => {
    const sd = e.side;
    const bx = sd === 'front' ? e.offset : sd === 'back' ? -e.offset : 0;   // building x along front/back
    const bz = sd === 'right' ? e.offset : sd === 'left' ? -e.offset : 0;   // building z along right/left (right: z = offset)
    // local (x, z): alongZ → same; else building (x,z) = (zl, −xl) → xl = −z, zl = x
    const xl = G.alongZ ? bx : -bz, zl = G.alongZ ? bz : bx;
    return { wall: wallOf(sd), xl, zl };
  };
  const me = entLocal(mainE), se = entLocal(svcE);
  const wallU = (wall, xl, zl) => (wall === 'gP' ? xl + S / 2 : wall === 'gN' ? S / 2 - xl : wall === 'sP' ? L / 2 - zl : zl + L / 2);
  const wallLen = (wall) => (wall[0] === 'g' ? S : L);
  const doors = { gP: [], gN: [], sP: [], sN: [] };
  const clampU = (wall, u, hw) => Math.max(hw + 0.6, Math.min(wallLen(wall) - hw - 0.6, u));
  const mainW = 1.9, svcW = Math.max(2.4, Math.min(3.6, svcE.width || 3.2));
  const mU = clampU(me.wall, wallU(me.wall, me.xl, me.zl), mainW / 2);
  doors[me.wall].push({ u0: mU - mainW / 2, u1: mU + mainW / 2, h: 2.4, kind: 'main' });
  let sU = clampU(se.wall, wallU(se.wall, se.xl, se.zl), svcW / 2);
  if (se.wall === me.wall && Math.abs(sU - mU) < (mainW + svcW) / 2 + 1.5) sU = clampU(se.wall, mU + (mU < wallLen(se.wall) / 2 ? 1 : -1) * ((mainW + svcW) / 2 + 2), svcW / 2);
  doors[se.wall].push({ u0: sU - svcW / 2, u1: sU + svcW / 2, h: Math.min(3.0, eave - 0.3), kind: 'service' });
  // ---- local frame: x across spans, z along ridges ----
  b.push();
  if (!G.alongZ) b.rotY(Math.PI / 2);
  const toB = (x, y, z) => (G.alongZ ? [x, y, z] : [z, y, -x]);
  // ---- foundations, floor ----
  const gMin = Math.min(0, s._ground.min);
  b.box('basalt', -S / 2 - 0.08, gMin - 0.6, -L / 2 - 0.08, S / 2 + 0.08, ffl - 0.02, L / 2 + 0.08, ALL & ~NY);
  b.withTint([0.55, 0.42, 0.33], () => b.rectY('soil', -S / 2 + 0.2, -L / 2 + 0.2, S / 2 - 0.2, L / 2 - 0.2, ffl + 0.002, 1));
  if (b.collecting) b.colQuad(-S / 2, ffl, L / 2, S / 2, ffl, L / 2, S / 2, ffl, -L / 2, -S / 2, ffl, -L / 2);
  // ---- walls ----
  const wallDefs = [
    { id: 'gP', ax: -S / 2, az: L / 2, bx: S / 2, bz: L / 2 },
    { id: 'sP', ax: S / 2, az: L / 2, bx: S / 2, bz: -L / 2 },
    { id: 'gN', ax: S / 2, az: -L / 2, bx: -S / 2, bz: -L / 2 },
    { id: 'sN', ax: -S / 2, az: -L / 2, bx: -S / 2, bz: L / 2 },
  ];
  for (const wd of wallDefs) glassWall(ctx, G, wd, doors[wd.id]);
  // ---- roof: glass slopes, bars, ridge caps, gutters, vents ----
  roof(ctx, G, rng);
  // ---- interior structure: valley columns, trusses, grow lights ----
  structure(ctx, G);
  // ---- aisles, beds, crops, irrigation ----
  const aisleW = Math.max(1.6, Math.min(2.4, span * 0.2));
  const crossD = 2.3;
  // span carrying the main work aisle: the one containing the main door (gable) or the middle one
  const mainX = me.wall[0] === 'g' ? me.xl : 0;
  const aSpan = Math.max(0, Math.min(n - 1, Math.floor((mainX + S / 2) / span)));
  const aisleX = -S / 2 + (aSpan + 0.5) * span;
  // door cross paths on the long walls (non-gable doors)
  const sideCross = [];
  for (const id of ['sP', 'sN']) for (const dr of doors[id]) { const zc = id === 'sP' ? L / 2 - (dr.u0 + dr.u1) / 2 : (dr.u0 + dr.u1) / 2 - L / 2; sideCross.push([zc - (dr.u1 - dr.u0) / 2 - 0.4, zc + (dr.u1 - dr.u0) / 2 + 0.4]); }
  // concrete aisles
  b.withTint([0.9, 0.89, 0.86], () => {
    b.box('concrete_smooth', aisleX - aisleW / 2, ffl, -L / 2 + 0.2, aisleX + aisleW / 2, ffl + 0.06, L / 2 - 0.2, PY | PX | NX);
    for (const z of [L / 2 - crossD / 2 - 0.2, -L / 2 + crossD / 2 + 0.2]) b.box('concrete_smooth', -S / 2 + 0.25, ffl, z - crossD / 2, S / 2 - 0.25, ffl + 0.06, z + crossD / 2, PY | PZ | NZ);
    for (const [z0, z1] of sideCross) b.box('concrete_smooth', -S / 2 + 0.25, ffl, z0, S / 2 - 0.25, ffl + 0.06, z1, PY | PZ | NZ);
  });
  const bz0 = -L / 2 + crossD + 0.45, bz1 = L / 2 - crossD - 0.45;
  for (let i = 0; i < n; i++) {
    const x0 = -S / 2 + i * span + 0.45, x1 = -S / 2 + (i + 1) * span - 0.45;
    const xc = (x0 + x1) / 2;
    const cw = i === aSpan ? aisleW : 0.8;
    for (const [a, c] of [[x0, xc - cw / 2 - 0.05], [xc + cw / 2 + 0.05, x1]]) {
      const wb = c - a;
      const nbd = Math.max(1, Math.floor((wb + 0.6) / 1.75));
      const bw = (wb - (nbd - 1) * 0.6) / nbd;
      for (let k = 0; k < nbd; k++) {
        const bx0 = a + k * (bw + 0.6), bx1 = bx0 + bw;
        // split the bed at side door cross paths
        let zs = [[bz0, bz1]];
        for (const [p0, p1] of sideCross) zs = zs.flatMap(([q0, q1]) => (p1 < q0 || p0 > q1 ? [[q0, q1]] : [[q0, p0], [p1, q1]].filter(([u, v]) => v - u > 1.5)));
        for (const [z0, z1] of zs) bedWithCrop(ctx, G, bx0, z0, bx1, z1, crop, hash4(s.hash, i, k, Math.round(z0)));
      }
      // heating pipes along the paths between beds (pairs of white pipes on the floor)
      for (let k = 0; k <= nbd; k++) {
        const px = k === 0 ? a - 0.3 : k === nbd ? c + 0.3 : a + k * (bw + 0.6) - 0.3;
        if (Math.abs(px - aisleX) < aisleW / 2 + 0.1 && i === aSpan) continue;
        for (const dx of [-0.1, 0.1]) b.tube('tank_white', [[px + dx, ffl + 0.09, bz0 + 0.3], [px + dx, ffl + 0.09, bz1 - 0.3]], 0.026, 6);
      }
    }
  }
  // headhouse kit at the service end inside: fertigation unit, mixing tanks, potting bench, crates
  {
    const sgn = se.wall === 'gN' ? -1 : 1;
    const zIn = sgn * (L / 2 - 1.1);
    const xa = aisleX + aisleW / 2 + 1.2;
    if (xa + 1.6 < S / 2 - 0.4) {
      b.cylinder('tank_white', xa + 0.45, ffl, zIn, 0.42, 1.25, 16, { top: true });
      b.cylinder('tank_white', xa + 1.35, ffl, zIn, 0.42, 1.25, 16, { top: true });
      b.cbox('hvac', xa - 0.3, ffl, zIn - 0.35, xa - 0.0 + 0.0, ffl + 1.7, zIn + 0.35, 0.01);
      b.tube('rubber', [[xa + 0.45, ffl + 1.25, zIn], [xa + 0.45, ffl + 1.6, zIn], [xa - 0.15, ffl + 1.6, zIn]], 0.02, 5);
      if (b.collecting) b.colBox(xa - 0.3, ffl, zIn - 0.45, xa + 1.8, ffl + 1.7, zIn + 0.45);
    }
    const xb = aisleX - aisleW / 2 - 1.4;
    if (xb - 1.2 > -S / 2 + 0.4) {
      // crate stack on a pallet
      b.cbox('wood', xb - 0.6, ffl, zIn - 0.5, xb + 0.6, ffl + 0.14, zIn + 0.5, 0.01, false);
      for (let k = 0; k < 3; k++) b.withTint(k % 2 ? [0.25, 0.55, 0.35] : [0.85, 0.55, 0.2], () => b.cbox('plastic_bin', xb - 0.55, ffl + 0.14 + k * 0.3, zIn - 0.45, xb + 0.55, ffl + 0.42 + k * 0.3, zIn + 0.45, 0.02));
      if (b.collecting) b.colBox(xb - 0.6, ffl, zIn - 0.5, xb + 0.6, ffl + 1.05, zIn + 0.5);
    }
  }
  b.pop();
  // ---- entrance vestibule (building frame) ----
  const mainSide = mainE.side;
  const mainU = facadeUOf(G, me.wall, mU, mainSide);
  vestibule(ctx, G, mainSide, mainU, mainW);
  // ---- service apron + equipment outside the service door ----
  const svcSide = svcE.side;
  const svcU = facadeUOf(G, se.wall, sU, svcSide);
  serviceApron(ctx, G, svcSide, svcU, svcW, rng);
  // ---- irrigation channel along one long side (local sP / sN) ----
  const chanWall = G.alongZ ? (rng.next() < 0.5 ? 'sP' : 'sN') : 'sP';
  channel(ctx, G, chanWall, se, svcW, rng);
  // ---- lamps ----
  {
    const sideL = svcSide;
    b.push(); K.facadeFrame(b, sideL, G.w, G.d, 0);
    const Ls = sideL === 'front' || sideL === 'back' ? G.w : G.d;
    const u = svcU + svcW / 2 + 2.4 < Ls - 0.3 ? svcU + svcW / 2 + 2.4 : svcU - svcW / 2 - 2.4;
    lampPost(b, u, 0, 4.2, 5.5, -Math.PI / 2);
    b.pop();
  }
  // ---- climate ----
  if (E.dry) drift(ctx, E.lee, { kind: 'dust', h: 0.12, reach: 0.9, skip: [[0, 0]] });
  if (E.polar) {
    drift(ctx, E.windward, { kind: 'snow', h: 0.55, reach: 3.2, skip: [] });
    drift(ctx, E.lee, { kind: 'snow', h: 0.3, reach: 2.0, seed: 4, skip: [] });
  }
  // OX4 lee rows (urban meta.lee): the back faces the ice cliff / foot channel → slatted snow fence 4.5 m out with the
  // snow tongue banked against its windward face (背风温室: the katabatic drift stops at the fence, not on the glass)
  if ((s._meta || {}).lee && !s._shared.back) snowFence(ctx, E);
  // ---- anchors ----
  const mp = K.facadePoint(mainSide, G.w, G.d, mainU, ffl, 3.0), mn = K.facadeNormal(mainSide);
  const sp = K.facadePoint(svcSide, G.w, G.d, svcU, ffl, 0.4), sn = K.facadeNormal(svcSide);
  const aislePos = toB(aisleX + 0.3, ffl + 1.65, me.wall === 'gN' ? -L / 2 + 2.2 : L / 2 - 2.2);
  const aisleTgt = toB(aisleX, ffl + 1.2, me.wall === 'gN' ? L / 2 - 4 : -L / 2 + 4);
  utilAnchors(ctx, {
    ffl, h: eave - ffl, roofY: G.ridge, access: toB(0, G.ridge, 0),
    floors: [{ level: 0, y: ffl, height: eave - ffl }],
    entrances: [
      { kind: 'main', side: mainSide, pos: mp, dir: mn, width: mainW },
      { kind: 'service', side: svcSide, pos: sp, dir: sn, width: svcW },
    ],
    rooms: [{ floor: 0, name: 'growing hall', kind: 'plant', center: [0, ffl, 0], size: [G.w, eave, G.d] }],
    cameras: { living: { pos: aislePos, target: aisleTgt }, lobby: { pos: aislePos, target: aisleTgt } },
  });
  b.meta.crop = crop; b.meta.spans = n; b.meta.span = +span.toFixed(2); b.meta.channel = chanWall;
  void rise; void bay;
}

/** facade u (building side) of a local-wall coordinate. */
/** Slatted snow fence (wall frame of the back facade, 4.5 m out) on steel posts + snow bank on its windward side. */
function snowFence(ctx, E) {
  const b = ctx.b, s = ctx.spec;
  const w = s._w, L = w + 6, out = 4.5, H = 2.2;
  const [g0, g1] = K.sideGround(s, 'back');
  b.push(); K.facadeFrame(b, 'back', w, s._d, 0);
  const gy = (u) => g0 + ((g1 - g0) * Math.max(0, Math.min(w, u))) / w;
  const n = Math.max(2, Math.round(L / 3));
  for (let i = 0; i <= n; i++) {
    const u = -3 + (L * i) / n, y = gy(u);
    b.box('steel_dark', u - 0.05, y - 0.4, out - 0.05, u + 0.05, y + H, out + 0.05, PX | NX | PZ | NZ);
    b.tube('steel', [[u, y + H * 0.85, out + 0.05], [u, y, out + 1.3]], 0.025, 5);
  }
  // horizontal slats (50 % porosity), weathered timber
  for (let k = 0; k < 7; k++) {
    const yk = 0.35 + k * 0.27;
    b.withTint([0.62, 0.55, 0.47], () => b.box('wood', -3, gy(w / 2) + yk, out - 0.09, L - 3, gy(w / 2) + yk + 0.14, out - 0.05, PZ | NZ | PY | NY));
  }
  // snow bank against the windward (outer) face, tapering away from the fence
  b.withTint(E.snowTint, () => {
    const y0 = gy(w / 2) - 0.05;
    b.quad('render_white', L - 3.2, y0 + 1.1, out + 0.12, -2.8, y0 + 1.1, out + 0.12, -2.8, y0 + 0.75, out + 1.4, L - 3.2, y0 + 0.75, out + 1.4);
    b.quad('render_white', L - 3.2, y0 + 0.75, out + 1.4, -2.8, y0 + 0.75, out + 1.4, -2.8, y0, out + 3.6, L - 3.2, y0, out + 3.6);
  });
  if (b.collecting) b.colBox(-3, gy(w / 2) - 0.1, out - 0.1, L - 3, gy(w / 2) + H, out + 0.06);
  b.pop();
}

function facadeUOf(G, wall, u, side) {
  // local wall u runs in facade order on the local box; the building facade u runs in facade order too,
  // and every local wall maps onto exactly one building side with the same direction → identical u
  void G; void wall; void side;
  return u;
}

// ---------------------------------------------------------------------------------------------
// walls
// ---------------------------------------------------------------------------------------------
function glassWall(ctx, G, wd, doors) {
  const b = ctx.b, E = G.E;
  const dx = wd.bx - wd.ax, dz = wd.bz - wd.az, Lw = Math.hypot(dx, dz);
  const gable = wd.id[0] === 'g';
  const ffl = G.ffl, kTop = ffl + G.knee;
  // wall-u → plan x (across) for gables
  const xOf = (u) => (wd.id === 'gP' ? u - G.S / 2 : G.S / 2 - u);
  const top = (u) => (gable ? roofY(G, xOf(u)) : G.eave);
  b.push(); b.translate(wd.ax, 0, wd.az); b.rotY(-Math.atan2(dz, dx));
  // wall frame: x = u along, z = outward
  const gaps = doors.map((d) => [d.u0, d.u1]).sort((a, c) => a[0] - c[0]);
  const spans = []; { let u = 0; for (const [a, c] of gaps) { if (a > u) spans.push([u, a]); u = c; } if (Lw > u) spans.push([u, Lw]); }
  const shell = E.polar ? 'panel_insulated' : 'panel_white';
  const gy = Math.min(0, ctx.spec._ground.min) - 0.3;
  // knee wall (panel on a concrete base course) + aluminium cap
  for (const [a, c] of spans) {
    if (c - a < 0.02) continue;
    b.box('basalt', a, gy, -0.24, c, ffl + 0.12, 0.03, PZ | PY | PX | NX);
    b.withTint(E.shellTint, () => b.box(shell, a, ffl + 0.12, -0.2, c, kTop, 0.0, PZ | NZ | PX | NX));
    b.box('aluminium', a - 0.01, kTop, -0.22, c + 0.01, kTop + 0.05, 0.035, ALL);
    if (b.collecting) b.colBox(a, ffl, -0.2, c, kTop + 0.05, 0);
  }
  // posts: bay posts (long walls) / quarter-span posts with posts at ridges + valleys (gables)
  const posts = [];
  if (gable) {
    for (let i = 0; i <= G.n; i++) { const xv = -G.S / 2 + i * G.span; posts.push(wd.id === 'gP' ? xv + G.S / 2 : G.S / 2 - xv); }
    for (let i = 0; i < G.n; i++) for (const f of [0.25, 0.5, 0.75]) { const xv = -G.S / 2 + (i + f) * G.span; posts.push(wd.id === 'gP' ? xv + G.S / 2 : G.S / 2 - xv); }
  } else for (let j = 0; j <= G.nb; j++) posts.push(j * G.bay);
  posts.sort((a, c) => a - c);
  const inDoor = (u, m = 0.06) => doors.some((d) => u > d.u0 - m && u < d.u1 + m);
  const ys = kTop + 0.05;
  for (let k = 0; k < posts.length; k++) {
    const u = posts[k];
    if (inDoor(u, 0.02)) continue;
    const t = top(u);
    const main = !gable || Math.abs(((u + 1e-6) % (G.span)) ) < 0.01 || k === 0 || k === posts.length - 1;
    b.box(main ? 'steel' : 'aluminium', u - (main ? 0.05 : 0.03), ys, -0.1, u + (main ? 0.05 : 0.03), t, 0.02, PX | NX | PZ | NZ);
  }
  // glazing between posts (+ intermediate mullions every ~0.8 m, transom at 2.6 m)
  const yTr = Math.min(ffl + 2.6, G.eave - 0.3);
  for (let k = 0; k < posts.length - 1; k++) {
    const a = posts[k], c = posts[k + 1];
    if (c - a < 0.05) continue;
    const dm = doors.find((d) => a < d.u1 && c > d.u0);
    const glassSeg = (u0, u1, y0) => {
      if (u1 - u0 < 0.03) return;
      const t0 = top(u0), t1 = top(u1);
      b.quad('glass_agri', u0, y0, -0.03, u1, y0, -0.03, u1, t1 - 0.03, -0.03, u0, t0 - 0.03, -0.03);
    };
    if (dm) {
      // door bay: glass beside the door + transom above it
      if (dm.u0 - a > 0.08) glassSeg(a, dm.u0, ys);
      if (c - dm.u1 > 0.08) glassSeg(dm.u1, c, ys);
      const h = ffl + dm.h + 0.12;
      const u0 = Math.max(a, dm.u0), u1 = Math.min(c, dm.u1);
      if (top(u0) > h + 0.1) {
        b.quad('glass_agri', u0, h, -0.03, u1, h, -0.03, u1, top(u1) - 0.03, -0.03, u0, top(u0) - 0.03, -0.03);
      }
    } else glassSeg(a, c, ys);
    const nm = Math.max(1, Math.round((c - a) / 0.82));
    for (let q = 1; q < nm; q++) {
      const u = a + ((c - a) * q) / nm;
      if (inDoor(u)) continue;
      b.box('aluminium', u - 0.016, ys, -0.07, u + 0.016, top(u) - 0.02, -0.0, PX | NX | PZ);
    }
    if (!dm && yTr < Math.min(top(a), top(c)) - 0.2) b.box('aluminium', a, yTr - 0.02, -0.07, c, yTr + 0.02, 0.0, PY | NY | PZ);
  }
  // eave rail along the long walls / verge rail along the gable profile
  if (!gable) b.box('aluminium_dark', 0, G.eave - 0.12, -0.12, Lw, G.eave, 0.03, PY | NY | PZ | PX | NX);
  else {
    const pts = [];
    for (let i = 0; i <= G.n; i++) {
      const xv = -G.S / 2 + i * G.span;
      pts.push([wd.id === 'gP' ? xv + G.S / 2 : G.S / 2 - xv, G.eave]);
      if (i < G.n) { const xr = xv + G.span / 2; pts.push([wd.id === 'gP' ? xr + G.S / 2 : G.S / 2 - xr, G.eave + G.rise]); }
    }
    pts.sort((p, q) => p[0] - q[0]);
    b.sweep('aluminium_dark', pts.map(([u, y]) => [u, y + 0.02, 0.0]), [[-0.11, -0.12], [0.04, -0.12], [0.04, 0.03], [-0.11, 0.03]], { smoothAngle: 5 });
  }
  // doors
  for (const dr of doors) {
    const v1 = ffl + dr.h;
    // frame
    b.box('aluminium_dark', dr.u0 - 0.08, ffl, -0.14, dr.u0, v1 + 0.1, 0.03, ALL);
    b.box('aluminium_dark', dr.u1, ffl, -0.14, dr.u1 + 0.08, v1 + 0.1, 0.03, ALL);
    b.box('aluminium_dark', dr.u0 - 0.08, v1, -0.14, dr.u1 + 0.08, v1 + 0.12, 0.03, ALL);
    b.box('steel', dr.u0, ffl - 0.01, -0.2, dr.u1, ffl + 0.015, 0.05, PY | PZ | NZ);
    if (dr.kind === 'service') {
      // two-leaf sliding glass door (one leaf slid open per hash at 'full' views stays closed: simpler)
      const mid = (dr.u0 + dr.u1) / 2;
      for (const [a, c, z] of [[dr.u0 + 0.02, mid + 0.04, -0.05], [mid - 0.04, dr.u1 - 0.02, -0.1]]) {
        b.box('aluminium', a, ffl + 0.02, z - 0.03, c, ffl + 0.14, z + 0.03, ALL);
        b.box('aluminium', a, v1 - 0.1, z - 0.03, c, v1 - 0.02, z + 0.03, ALL);
        b.box('aluminium', a, ffl + 0.14, z - 0.03, a + 0.06, v1 - 0.1, z + 0.03, ALL);
        b.box('aluminium', c - 0.06, ffl + 0.14, z - 0.03, c, v1 - 0.1, z + 0.03, ALL);
        b.box('aluminium', a + 0.06, ffl + 1.0, z - 0.025, c - 0.06, ffl + 1.08, z + 0.025, ALL);
        b.quad('glass_clear', a + 0.06, ffl + 0.14, z, c - 0.06, ffl + 0.14, z, c - 0.06, v1 - 0.1, z, a + 0.06, v1 - 0.1, z);
      }
      b.box('aluminium_dark', dr.u0 - 0.1, v1 + 0.02, -0.02, dr.u1 + 0.1, v1 + 0.2, 0.06, ALL);   // track
      if (b.collecting) b.colBox(dr.u0, ffl, -0.12, dr.u1, v1, 0);
    } else {
      K.doorUnit(b, { u0: dr.u0, u1: dr.u1, v0: ffl, v1, R: 0.04, kind: 'glazed_double', open: 0, glassKey: 'glass_clear', T: 0.2 });
    }
  }
  b.pop();
}

// ---------------------------------------------------------------------------------------------
// roof
// ---------------------------------------------------------------------------------------------
function roof(ctx, G, rng) {
  const b = ctx.b, E = G.E;
  const { L, S, n, span, eave, rise, bay, nb } = G;
  const slopeL = Math.hypot(span / 2, rise);
  const ang = Math.atan2(rise, span / 2);
  const vents = ctx.sub(1503);
  for (let i = 0; i < n; i++) {
    const x0 = -S / 2 + i * span, xc = x0 + span / 2, x1 = x0 + span;
    const yr = eave + rise;
    // glass slopes (one pane sheet per slope; the bars give the module)
    b.quad('glass_agri', x0, eave, L / 2, x0, eave, -L / 2, xc, yr, -L / 2, xc, yr, L / 2);
    b.quad('glass_agri', xc, yr, L / 2, xc, yr, -L / 2, x1, eave, -L / 2, x1, eave, L / 2);
    // glazing bars along the slope every ~0.82 m, rafters at bays
    const nbar = Math.max(nb, Math.round(L / 0.82));
    for (let k = 0; k <= nbar; k++) {
      const z = -L / 2 + (L * k) / nbar;
      const isRafter = Math.abs((z + L / 2) / bay - Math.round((z + L / 2) / bay)) < 1e-3;
      const hw = isRafter ? 0.035 : 0.018, hh = isRafter ? 0.09 : 0.045;
      for (const sgn of [1, -1]) {
        b.push();
        b.translate(sgn > 0 ? x0 : x1, eave, z);
        b.rotZ(sgn * ang);
        // bar from the eave towards the ridge along local +x (sgn>0) or −x (sgn<0)
        const xa = sgn > 0 ? 0 : -slopeL, xb = sgn > 0 ? slopeL : 0;
        b.box(isRafter ? 'aluminium_dark' : 'aluminium', xa, 0.0, -hw, xb, hh, hw, PY | PZ | NZ | NY);
        b.pop();
      }
    }
    // ridge cap
    b.box('aluminium', xc - 0.1, yr - 0.02, -L / 2 - 0.05, xc + 0.1, yr + 0.1, L / 2 + 0.05, ALL);
    // ridge vent lanterns (O02): every other bay, alternate offset per span; polar halls keep closed ridges
    if (!E.polar || vents.next() < 0.3) {
      const off = i % 2;
      for (let j = off; j < nb; j += 2) {
        if (j === 0 || j === nb - 1) continue;
        const zc = -L / 2 + (j + 0.5) * bay, hl = Math.min(1.0, bay * 0.38);
        const open = vents.next() < 0.5;
        b.withTint([0.95, 0.95, 0.95], () => b.cbox('panel_white', xc - 0.55, yr - 0.05, zc - hl, xc + 0.55, yr + 0.5, zc + hl, 0.02));
        b.box('panel_grey', xc - 0.62, yr + 0.5, zc - hl - 0.06, xc + 0.62, yr + 0.58, zc + hl + 0.06, ALL);
        for (const sx of [-1, 1]) {
          const xf = xc + sx * 0.552;
          b.push(); b.translate(xf, 0, zc); b.rotY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
          K.louvrePanel(b, { u0: -hl + 0.12, u1: hl - 0.12, v0: yr + 0.06, v1: yr + 0.44, R: 0.03, key: open ? 'grille_dark' : 'aluminium' });
          b.pop();
        }
      }
    }
    // valley / eave gutters
    for (const xg of [x0, x1]) {
      const outer = Math.abs(xg) > S / 2 - 0.01;
      if (!outer && xg === x1 && i < n - 1) continue;            // emit valleys once (at x0 of the next span)
      const gw = outer ? 0.18 : 0.32;
      const xa = outer ? (xg > 0 ? xg - 0.04 : xg - gw + 0.04) : xg - gw / 2, xb = xa + gw;
      b.box('aluminium', xa, eave - 0.2, -L / 2 - 0.12, xb, eave + 0.02, L / 2 + 0.12, ALL & ~PY);
      b.box('aluminium_dark', xa + 0.02, eave - 0.06, -L / 2 - 0.1, xb - 0.02, eave - 0.05, L / 2 + 0.1, PY);
      if (E.polar && !outer) b.withTint(E.snowTint, () => b.box('render_white', xa + 0.03, eave - 0.05, -L / 2 + 0.2, xb - 0.03, eave + 0.07 + rng.next() * 0.04, L / 2 - 0.2, PY | PX | NX));
      // downpipes at both gables
      for (const zg of [L / 2 + 0.06, -L / 2 - 0.06]) {
        const xp = (xa + xb) / 2;
        b.tube('aluminium_dark', [[xp, eave - 0.2, zg], [xp, eave - 0.45, zg + Math.sign(zg) * 0.12], [xp, 0.3, zg + Math.sign(zg) * 0.12], [xp, 0.06, zg + Math.sign(zg) * 0.3]], 0.045, 8);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// interior structure: valley columns, trusses, grow lights (visible through the glass at every LOD)
// ---------------------------------------------------------------------------------------------
function structure(ctx, G) {
  const b = ctx.b, s = ctx.spec;
  const { L, S, n, span, eave, rise, bay, nb, ffl } = G;
  // valley columns every 2 bays
  for (let i = 1; i < n; i++) {
    const x = -S / 2 + i * span;
    for (let j = 0; j <= nb; j += 2) {
      const z = -L / 2 + j * bay;
      if (j === 0 || j === nb) continue;
      b.box('steel', x - 0.05, ffl, z - 0.05, x + 0.05, eave - 0.2, z + 0.05, PX | NX | PZ | NZ);
      if (b.collecting) b.colBox(x - 0.06, ffl, z - 0.06, x + 0.06, eave, z + 0.06);
    }
  }
  // light trusses at every second bay line
  for (let j = 2; j < nb; j += 2) {
    const z = -L / 2 + j * bay;
    for (let i = 0; i < n; i++) {
      const x0 = -S / 2 + i * span, xc = x0 + span / 2, x1 = x0 + span;
      const yb = eave - 0.15;
      b.box('steel', x0, yb - 0.03, z - 0.025, x1, yb + 0.03, z + 0.025, ALL);              // bottom chord
      b.box('steel', xc - 0.02, yb, z - 0.02, xc + 0.02, eave + rise - 0.1, z + 0.02, PX | NX | PZ | NZ); // king post
      for (const [ax, ay, cx, cy] of [[x0 + span * 0.25, yb, xc, eave + rise * 0.55], [x1 - span * 0.25, yb, xc, eave + rise * 0.55], [x0 + span * 0.25, yb, x0 + span * 0.25, eave + rise * 0.5], [x1 - span * 0.25, yb, x1 - span * 0.25, eave + rise * 0.5]]) {
        b.tube('steel', [[ax, ay, z], [cx, cy, z]], 0.016, 5);
      }
    }
  }
  // grow-light bars (occupancy-gated panels) along each span, hung under the chords
  b.setExtra('iwin1', 0, 0.5, 0, 2000 + (s.hash % 89));
  b.setExtra('iwin2', (s.hash >>> 16) & 0xffff, s.hash & 0xffff, K.ROOM_KIND.plant, s._profile | 0);
  for (let i = 0; i < n; i++) {
    const xc = -S / 2 + (i + 0.5) * span;
    for (const dx of [-span * 0.25, span * 0.25]) {
      const x = xc + dx, y = eave - 0.55;
      for (let j = 0; j < nb; j++) {
        if (j % 2) continue;
        const z0 = -L / 2 + j * bay + 0.3, z1 = z0 + bay * 2 - 0.6;
        if (z1 > L / 2 - 0.3) continue;
        b.box('aluminium_dark', x - 0.09, y, z0, x + 0.09, y + 0.07, z1, ALL & ~NY);
        b.rectY('light_panel', x - 0.07, z0 + 0.03, x + 0.07, z1 - 0.03, y - 0.002, -1);
        for (const zz of [z0 + 0.4, z1 - 0.4]) b.box('steel', x - 0.005, y + 0.07, zz - 0.005, x + 0.005, eave - 0.15, zz + 0.005, PX | NX | PZ | NZ);
      }
    }
  }
  b.clearExtra('iwin1'); b.clearExtra('iwin2');
}

// ---------------------------------------------------------------------------------------------
// beds + crops
// ---------------------------------------------------------------------------------------------
const GREENS = [[0.36, 0.62, 0.22], [0.3, 0.55, 0.18], [0.42, 0.66, 0.26], [0.26, 0.5, 0.2], [0.5, 0.68, 0.3]];

function bedWithCrop(ctx, G, x0, z0, x1, z1, crop, seed) {
  const b = ctx.b;
  const ffl = G.ffl;
  const r = new Rng(seed >>> 0);
  if (crop === 'berries') {
    // table-top gutters on stands at 1.0 m (strawberries)
    const ht = ffl + 1.0;
    const xc = (x0 + x1) / 2;
    const n = Math.max(1, Math.round((z1 - z0) / 2.4));
    for (let k = 0; k <= n; k++) { const z = z0 + ((z1 - z0) * k) / n; b.box('steel', xc - 0.02, ffl, z - 0.02, xc + 0.02, ht - 0.12, z + 0.02, PX | NX | PZ | NZ); b.box('steel', x0 + 0.05, ht - 0.14, z - 0.02, x1 - 0.05, ht - 0.11, z + 0.02, ALL); }
    for (const gx of [x0 + 0.28, x1 - 0.28]) {
      b.withTint([0.95, 0.95, 0.95], () => b.box('plastic_bin', gx - 0.17, ht - 0.11, z0, gx + 0.17, ht, z1, ALL));
      b.withTint([0.4, 0.3, 0.24], () => b.rectY('soil', gx - 0.14, z0 + 0.03, gx + 0.14, z1 - 0.03, ht + 0.002, 1));
      // fix 2 (QY-08): strawberry plants — trifoliate leaves on arching petioles, fruit trusses hanging over the gutter lip
      const stage = cropStage(seed);
      for (let z = z0 + 0.2; z < z1 - 0.1; z += 0.36) {
        if (stage.gap && r.next() < stage.gap) continue;
        strawberry(b, gx + (r.next() - 0.5) * 0.05, ht + 0.01, z, r, stage, ctx.full);
      }
      b.tube('rubber', [[gx, ht + 0.02, z0 + 0.05], [gx, ht + 0.02, z1 - 0.05]], 0.008, 4);
    }
    if (b.collecting) b.colBox(x0, ffl, z0, x1, ht, z1);
    return;
  }
  // raised bed: concrete curb walls + soil
  const h = 0.32;
  const yt = ffl + h;
  b.withTint([0.88, 0.87, 0.84], () => {
    b.box('concrete', x0, ffl, z0, x1, yt - 0.05, z1, PX | NX | PZ | NZ);
    for (const [a, c, e, f] of [[x0, z0, x0 + 0.07, z1], [x1 - 0.07, z0, x1, z1], [x0 + 0.07, z0, x1 - 0.07, z0 + 0.07], [x0 + 0.07, z1 - 0.07, x1 - 0.07, z1]]) b.box('concrete', a, yt - 0.05, c, e, yt, f, PY | PX | NX | PZ | NZ);
  });
  b.withTint([0.42, 0.31, 0.24], () => b.rectY('soil', x0 + 0.07, z0 + 0.07, x1 - 0.07, z1 - 0.07, yt - 0.03, 1));
  if (b.collecting) b.colBox(x0, ffl, z0, x1, yt, z1);
  // drip lines
  const rows = crop === 'vine' ? [x0 + (x1 - x0) * 0.3, x1 - (x1 - x0) * 0.3] : [x0 + (x1 - x0) * 0.27, x1 - (x1 - x0) * 0.27];
  for (const rx of rows) b.tube('rubber', [[rx, yt - 0.015, z0 + 0.12], [rx, yt - 0.015, z1 - 0.12]], 0.007, 4);
  if (crop === 'greens') {
    // fix 2 (QY-08): leafy greens as real rosettes — variety per bed (butterhead / red oak leaf / romaine / pak choi),
    // growth stage per bed (transplants / young / harvest-ready, a few harvested gaps), leaves in a 137.5° spiral:
    // outer blades long, spreading and drooping with ruffled cupped edges, inner ones short and upright (heart)
    const stage = cropStage(seed), variety = GREEN_VARIETIES[(seed >>> 3) % GREEN_VARIETIES.length];
    for (const rx of rows) {
      for (let z = z0 + 0.25; z < z1 - 0.15; z += 0.34) {
        if (stage.gap && r.next() < stage.gap) { r.next(); continue; }
        rosette(b, rx + (r.next() - 0.5) * 0.05, yt - 0.03, z, r, variety, stage, ctx.full);
      }
    }
    return;
  }
  // vine rows (tomato / cucumber on high wires): leafy walls of alpha leaf cards, strings, wires, fruit
  const wireY = Math.min(G.eave - 0.35, ffl + 3.1);
  // fix 2: growth stage per bed — young / transplanted rows stand lower on their strings, fruit ripens with the stage
  const vStage = cropStage(seed);
  const leafTop = Math.min(wireY - 0.25, yt + 0.6 + 1.7 * vStage.scale);
  for (const rx of rows) {
    b.tube('steel_brushed', [[rx, wireY, z0], [rx, wireY, z1]], 0.006, 4);
    for (let z = z0 + 0.25; z < z1; z += 0.5) b.box('steel_brushed', rx - 0.004, yt, z - 0.004, rx + 0.004, wireY, z + 0.004, PX | NX);
    // dark stems core
    b.withTint([0.12, 0.22, 0.08], () => b.box('plant', rx - 0.05, yt + 0.25, z0 + 0.2, rx + 0.05, leafTop - 0.2, z1 - 0.2, PX | NX | PY));
    // leaf card walls: 3 layers across the row (outer layers lean in), short segments with yaw / height
    // jitter so the alpha leaves never read as a flat wallpaper
    const p = b.part('foliage');
    const prevUv = b.uvMode; b.uvMode = 1;
    const TILE = 0.36;
    for (const off of [-0.13, 0.0, 0.13]) {
      let z = z0 + 0.1 + r.next() * 0.3;
      while (z < z1 - 0.2) {
        const seg = 0.55 + r.next() * 0.5;
        const za = z, zb = Math.min(z1 - 0.1, z + seg);
        z += seg * (0.7 + r.next() * 0.2);
        const ya = yt + 0.2 + r.next() * 0.25, yb = leafTop - r.next() * 0.45 - (off === 0 ? 0 : 0.15);
        const ja = (r.next() - 0.5) * 0.12, jb = (r.next() - 0.5) * 0.12;
        const t = GREENS[Math.floor(r.next() * GREENS.length)];
        const k = 0.8 + r.next() * 0.35;
        b.pushTint([t[0] * 1.6 * k, (0.95 + (t[1] - 0.38) * 0.6) * k, t[2] * 1.6 * k]);
        const u0 = r.next(), ua = u0, ub = u0 + (zb - za) / TILE, va = r.next(), vb = va + (yb - ya) / TILE;
        const nx = off > 0 ? 1 : off < 0 ? -1 : (r.next() < 0.5 ? 1 : -1);
        const lean = off * 0.35;
        const i0 = b.vert(p, rx + off + ja, ya, za, nx * 0.7, 0.5, 0, ua, va);
        const i1 = b.vert(p, rx + off + jb, ya, zb, nx * 0.7, 0.5, 0, ub, va);
        const i2 = b.vert(p, rx + off - lean + jb, yb, zb, nx * 0.5, 0.85, 0, ub, vb);
        const i3 = b.vert(p, rx + off - lean + ja, yb, za, nx * 0.5, 0.85, 0, ua, vb);
        if (nx > 0) b.q(p, i0, i1, i2, i3); else b.q(p, i1, i0, i3, i2);
        b.popTint();
      }
    }
    b.uvMode = prevUv;
    // fruit trusses low on the stems
    for (let z = z0 + 0.4; z < z1 - 0.2; z += 0.55 + r.next() * 0.4) {
      if (r.next() < (vStage.scale < 0.5 ? 0.9 : 0.35)) continue;
      const red = vStage.scale < 0.7 ? 0.8 + r.next() * 0.2 : r.next();
      const tint = red < 0.5 ? [0.85, 0.12, 0.08] : red < 0.75 ? [0.9, 0.45, 0.1] : [0.35, 0.55, 0.2];
      const yy = yt + 0.35 + r.next() * Math.max(0.2, leafTop - yt - 1.0), sx = rx + (r.next() < 0.5 ? -0.14 : 0.14);
      b.withTint(tint, () => { b.blob('plant', sx, yy, z, 0.045, 0.045, 0.045, seed + Math.round(z * 7), 0); b.blob('plant', sx, yy - 0.08, z + 0.06, 0.04, 0.04, 0.04, seed + 3, 0); });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// crop plants (fix 2, QY-08): curved double-sided leaf blades ('plant', explicit uv in metres, per-vertex tint =
// midrib / blade / margin colours as vein shading), per crop type and growth stage; 'exterior' keeps a light
// single-sided version of the same rosettes (seen through the agricultural glazing)
// ---------------------------------------------------------------------------------------------
const GREEN_VARIETIES = [
  { id: 'butterhead', n: 11, L: 0.16, W: 0.075, cup: 0.45, ruffle: 0.012, rf: 16, droop: 0.55, elev0: 0.18, elev1: 1.15, shape: (s) => Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.92 + 0.04)), 0.55) * (0.35 + 0.65 * Math.min(1, s * 1.6)), mid: [0.62, 0.78, 0.36], blade: [0.34, 0.6, 0.18], edge: [0.5, 0.72, 0.26] },
  { id: 'redleaf', n: 12, L: 0.17, W: 0.07, cup: 0.3, ruffle: 0.022, rf: 24, droop: 0.65, elev0: 0.22, elev1: 1.1, shape: (s) => Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.95 + 0.03)), 0.6) * (0.3 + 0.7 * Math.min(1, s * 1.4)), mid: [0.5, 0.62, 0.28], blade: [0.3, 0.2, 0.12], edge: [0.42, 0.1, 0.12] },
  { id: 'romaine', n: 9, L: 0.24, W: 0.055, cup: 0.55, ruffle: 0.006, rf: 12, droop: 0.25, elev0: 0.75, elev1: 1.35, shape: (s) => Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.08)), 0.45), mid: [0.68, 0.8, 0.45], blade: [0.22, 0.48, 0.13], edge: [0.28, 0.54, 0.16] },
  { id: 'pakchoi', n: 8, L: 0.2, W: 0.06, cup: 0.6, ruffle: 0.0, rf: 0, droop: 0.2, elev0: 0.85, elev1: 1.3, shape: (s) => (s < 0.42 ? 0.22 + s * 0.4 : Math.pow(Math.sin(Math.PI * ((s - 0.42) / 0.58 * 0.92 + 0.04)), 0.6)), mid: [0.86, 0.9, 0.78], blade: [0.12, 0.34, 0.1], edge: [0.16, 0.38, 0.12], petiole: [0.85, 0.9, 0.8] },
];
/** Growth stage of a bed: scale of the plants, gap share (harvested / failed positions). */
function cropStage(seed) {
  const k = (seed >>> 9) % 7;
  return k < 2 ? { id: 'young', scale: 0.55, gap: 0.04 } : k < 3 ? { id: 'transplant', scale: 0.36, gap: 0.0 } : k < 6 ? { id: 'mature', scale: 1.0, gap: 0.06 } : { id: 'harvesting', scale: 1.0, gap: 0.45 };
}
const mix3 = (a, c, t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];

/**
 * One curved leaf blade from base (bx, by, bz): yaw (rad, direction in the xz plane), elev (rad at the base), length L,
 * half-width W, droop (rad of midrib bend over the length), cup (edge lift / half width), ruffle (m, margin wave),
 * shape(s) half-width profile 0..1, tints mid / blade / edge, ns × (2·nt+1) grid, two faces unless single.
 */
function leafBlade(b, o) {
  const ns = o.ns || 4, nt = o.nt || 1;
  const fx = Math.cos(o.yaw), fz = Math.sin(o.yaw), sxA = -fz, szA = fx;
  const mid = [];
  let x = 0, y = 0, an = o.elev;
  const ds = o.L / ns;
  for (let i = 0; i <= ns; i++) { mid.push([x, y, an]); an -= o.droop / ns; x += Math.cos(an) * ds; y += Math.sin(an) * ds; }
  const P = [], N = [], T = [], UV = [];
  for (let i = 0; i <= ns; i++) {
    const sN = i / ns, [mx, my, a] = mid[i];
    const hw = o.W * Math.max(0.02, o.shape(sN));
    const nfx = -Math.sin(a), nfy = Math.cos(a);           // blade normal in the (forward, up) plane
    for (let j = -nt; j <= nt; j++) {
      const t = j / nt, side = t * hw;
      const lift = o.cup * hw * t * t + (o.ruffle ? o.ruffle * t * t * Math.sin(sN * o.rf + j * 1.7 + o.ph) : 0);
      const lx = mx + nfx * lift, ly = my + nfy * lift;
      P.push([o.bx + fx * lx + sxA * side, o.by + ly, o.bz + fz * lx + szA * side]);
      const dl = 2 * o.cup * t;                                // slope of the cup across the blade
      let nx = fx * nfx - sxA * dl, ny = nfy, nz = fz * nfx - szA * dl;
      const nl = Math.hypot(nx, ny, nz) || 1; N.push([nx / nl, ny / nl, nz / nl]);
      const at = Math.abs(t);
      const c0 = at < 0.01 ? o.mid : mix3(o.blade, o.edge, at > 0.75 ? (at - 0.75) * 4 : 0);
      const c1 = o.petiole && sN < 0.42 ? o.petiole : mix3(c0, o.mid, Math.max(0, 0.35 - sN) * 1.2);
      T.push(mix3(c1, [c1[0] * 0.8, c1[1] * 0.8, c1[2] * 0.8], sN * 0.25 * o.dark));
      UV.push([o.u0 + side * 1.2, o.v0 + sN * o.L * 1.2]);
    }
  }
  const nc = 2 * nt + 1;
  const emit = (flip) => {
    const p = b.part('plant');
    const base = [];
    for (let k = 0; k < P.length; k++) {
      b.tint(T[k][0], T[k][1], T[k][2]);
      const n = N[k];
      base.push(b.vert(p, P[k][0] + (flip ? -n[0] * 0.0015 : 0), P[k][1] + (flip ? -n[1] * 0.0015 : 0), P[k][2] + (flip ? -n[2] * 0.0015 : 0), flip ? -n[0] : n[0], flip ? -n[1] : n[1], flip ? -n[2] : n[2], UV[k][0], UV[k][1]));
    }
    // winding: compare the first quad's geometric normal with the vertex normal
    const a0 = P[0], a1 = P[nc], a2 = P[nc + 1];
    const gx = (a1[1] - a0[1]) * (a2[2] - a0[2]) - (a1[2] - a0[2]) * (a2[1] - a0[1]);
    const gy = (a1[2] - a0[2]) * (a2[0] - a0[0]) - (a1[0] - a0[0]) * (a2[2] - a0[2]);
    const gz = (a1[0] - a0[0]) * (a2[1] - a0[1]) - (a1[1] - a0[1]) * (a2[0] - a0[0]);
    const n0 = N[nc];
    let ccw = gx * n0[0] + gy * n0[1] + gz * n0[2] > 0;
    if (flip) ccw = !ccw;
    for (let i = 0; i < ns; i++) for (let j = 0; j < nc - 1; j++) {
      const q0 = base[i * nc + j], q1 = base[(i + 1) * nc + j], q2 = base[(i + 1) * nc + j + 1], q3 = base[i * nc + j + 1];
      if (ccw) b.q(p, q0, q1, q2, q3); else b.q(p, q0, q3, q2, q1);
    }
  };
  const prev = b.uvMode; b.uvMode = 1;
  b.pushTint(1, 1, 1);
  emit(false);
  if (!o.single) emit(true);
  b.popTint();
  b.uvMode = prev;
}

/** Leafy-green rosette at (x, y, z) (y = soil level). */
function rosette(b, x, y, z, r, V, stage, full) {
  const sc = stage.scale * (0.85 + r.next() * 0.3);
  const n = full ? Math.max(4, Math.round(V.n * (0.55 + 0.45 * stage.scale))) : 4;
  const a0 = r.next() * Math.PI * 2;
  const hue = 0.88 + r.next() * 0.24;
  for (let k = 0; k < n; k++) {
    const f = n > 1 ? k / (n - 1) : 0;                    // 0 = outermost (oldest) … 1 = heart
    const outer = 1 - f;
    const L = V.L * sc * (0.55 + 0.45 * outer) * (0.9 + r.next() * 0.2);
    const tintK = (c) => [c[0] * hue, c[1] * (0.95 + 0.1 * f), c[2] * hue];
    leafBlade(b, {
      bx: x, by: y + 0.01 + f * 0.02 * sc, bz: z, yaw: a0 + k * 2.39996, elev: V.elev0 + (V.elev1 - V.elev0) * f, L, W: V.W * sc * (0.6 + 0.4 * outer),
      droop: V.droop * (0.4 + outer) * (0.8 + r.next() * 0.4), cup: V.cup * (0.6 + f * 0.8), ruffle: V.ruffle * sc * outer, rf: V.rf, ph: r.next() * 6.3,
      shape: V.shape, mid: tintK(V.mid), blade: tintK(mix3(V.blade, V.mid, f * 0.45)), edge: tintK(mix3(V.edge, V.mid, f * 0.3)), petiole: V.petiole,
      dark: 1, ns: full ? (outer > 0.45 ? 4 : 3) : 1, nt: full && outer > 0.45 && V.ruffle ? 2 : 1, single: !full, u0: r.next(), v0: r.next(),
    });
  }
}

/** Strawberry plant on a table-top gutter: trifoliate leaves on arching petioles + a fruit truss over the lip. */
function strawberry(b, x, y, z, r, stage, full) {
  const sc = stage.scale * (0.85 + r.next() * 0.3);
  const nL = full ? Math.max(3, Math.round(6 * (0.5 + 0.5 * stage.scale))) : 2;
  const a0 = r.next() * Math.PI * 2;
  const shape = (s) => Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.08)), 0.65) * (0.92 + 0.08 * Math.sin(s * 40));   // ovate, toothed margin
  const blade = [0.16 + r.next() * 0.04, 0.36 + r.next() * 0.06, 0.1], mid = [0.4, 0.55, 0.22], edge = [0.2, 0.42, 0.12];
  for (let k = 0; k < nL; k++) {
    const yaw = a0 + k * 2.39996, ca = Math.cos(yaw), sa = Math.sin(yaw);
    const pl = (0.1 + r.next() * 0.06) * sc, pe = 0.9 + r.next() * 0.35;     // petiole length, elevation
    const tx = x + ca * pl * Math.cos(pe) * 0.75, ty = y + pl * Math.sin(pe), tz = z + sa * pl * Math.cos(pe) * 0.75;
    // petiole: thin arching strip (two faces; 'full' only)
    if (full) b.withTint([0.32, 0.45, 0.18], () => {
      const p = b.part('plant'), w = 0.0035;
      const pts = [[x, y, z], [x + ca * pl * 0.3, y + pl * 0.75, z + sa * pl * 0.3], [tx, ty, tz]];
      for (let i = 0; i < 2; i++) {
        const A = pts[i], C = pts[i + 1];
        for (const fl of [1, -1]) {
          const i0 = b.vert(p, A[0] - sa * w, A[1], A[2] + ca * w, -sa * fl, 0, ca * fl, 0, 0), i1 = b.vert(p, A[0] + sa * w, A[1], A[2] - ca * w, -sa * fl, 0, ca * fl, 0.01, 0);
          const i2 = b.vert(p, C[0] + sa * w, C[1], C[2] - ca * w, -sa * fl, 0, ca * fl, 0.01, 0.1), i3 = b.vert(p, C[0] - sa * w, C[1], C[2] + ca * w, -sa * fl, 0, ca * fl, 0, 0.1);
          if (fl > 0) b.q(p, i0, i1, i2, i3); else b.q(p, i1, i0, i3, i2);
        }
      }
    });
    for (let j = -1; j <= 1; j++) {
      leafBlade(b, { bx: tx, by: ty, bz: tz, yaw: yaw + j * 0.85, elev: 0.25 - Math.abs(j) * 0.15, L: 0.075 * sc * (j === 0 ? 1.1 : 0.95), W: 0.03 * sc, droop: 0.35, cup: 0.35, ruffle: 0, rf: 0, ph: 0,
        shape, mid, blade, edge, dark: 0.8, ns: full ? 3 : 1, nt: 1, single: !full, u0: r.next(), v0: r.next() });
    }
  }
  // fruit truss hanging over the gutter lip (ripening reds, a few white flowers on young plants)
  if (stage.scale > 0.5 && r.next() < 0.75) {
    const sd = r.next() < 0.5 ? -1 : 1, nF = full ? 2 + Math.floor(r.next() * 3) : 1;
    for (let f = 0; f < nF; f++) {
      const fx = x + sd * (0.19 + r.next() * 0.03), fy = y - 0.05 - f * 0.035 - r.next() * 0.04, fz = z + (r.next() - 0.5) * 0.12;
      const ripe = r.next();
      const t = ripe < 0.55 ? [0.78, 0.06, 0.05] : ripe < 0.8 ? [0.85, 0.42, 0.12] : [0.72, 0.8, 0.5];
      b.withTint(t, () => b.blob('plant', fx, fy, fz, 0.014 + r.next() * 0.006, 0.02 + r.next() * 0.006, 0.014, (r.next() * 1e6) >>> 0, full ? 1 : 0));
      if (full) b.withTint([0.3, 0.5, 0.2], () => b.blob('plant', fx, fy + 0.02, fz, 0.012, 0.004, 0.012, 3, 0));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// entrance vestibule (门斗), service apron, irrigation channel
// ---------------------------------------------------------------------------------------------
function vestibule(ctx, G, side, u, dw) {
  const b = ctx.b, s = ctx.spec, E = G.E;
  const ffl = G.ffl;
  const vw = dw + 1.7, dep = E.polar ? 3.0 : 2.5, h = 3.0;
  const u0 = u - vw / 2, u1 = u + vw / 2;
  b.push(); K.facadeFrame(b, side, G.w, G.d, 0);
  const shell = E.polar ? 'panel_insulated' : 'panel_white';
  b.pushTint(E.shellTint);
  // side walls + front wall pieces beside the outer door (panel), roof slab with a raised attic
  b.cbox(shell, u0, ffl - 0.1, 0.0, u0 + 0.25, ffl + h, dep, 0.02, false);
  b.cbox(shell, u1 - 0.25, ffl - 0.1, 0.0, u1, ffl + h, dep, 0.02, false);
  b.cbox(shell, u0, ffl - 0.1, dep - 0.25, u - dw / 2 - 0.05, ffl + h, dep, 0.02, false);
  b.cbox(shell, u + dw / 2 + 0.05, ffl - 0.1, dep - 0.25, u1, ffl + h, dep, 0.02, false);
  b.cbox(shell, u - dw / 2 - 0.05, ffl + 2.5, dep - 0.25, u + dw / 2 + 0.05, ffl + h, dep, 0.01, false);
  b.cbox(shell, u0 - 0.08, ffl + h, -0.05, u1 + 0.08, ffl + h + 0.3, dep + 0.12, 0.02);
  b.cbox(shell, u0 + 0.5, ffl + h + 0.3, 0.2, u1 - 0.5, ffl + h + 0.75, dep - 0.35, 0.02);
  b.popTint();
  b.withTint(E.trimTint, () => {
    b.box('panel_grey', u0 - 0.1, ffl + h + 0.24, -0.06, u1 + 0.1, ffl + h + 0.33, dep + 0.14, PY | PZ | PX | NX);
    b.box('panel_grey', u0 - 0.02, ffl - 0.1, dep - 0.02, u1 + 0.02, ffl + 0.4, dep + 0.02, PZ | PX | NX | PY);
  });
  // side windows (small, glazed) in the vestibule cheeks
  for (const [ua, sg] of [[u0, -1], [u1, 1]]) {
    const z0 = 0.6, z1 = dep - 0.6;
    if (z1 - z0 < 0.4) continue;
    b.box('aluminium_dark', sg < 0 ? ua - 0.012 : ua - 0.01, ffl + 1.1, z0, sg < 0 ? ua + 0.01 : ua + 0.012, ffl + 2.2, z1, sg < 0 ? NX : PX);
    b.quad('glass_agri', ua + sg * 0.014, ffl + 1.16, sg < 0 ? z1 - 0.05 : z0 + 0.05, ua + sg * 0.014, ffl + 1.16, sg < 0 ? z0 + 0.05 : z1 - 0.05, ua + sg * 0.014, ffl + 2.14, sg < 0 ? z0 + 0.05 : z1 - 0.05, ua + sg * 0.014, ffl + 2.14, sg < 0 ? z1 - 0.05 : z0 + 0.05);
  }
  // outer door (glazed double) in the front wall plane of the vestibule
  b.push(); b.translate(0, 0, dep);
  K.doorUnit(b, { u0: u - dw / 2, u1: u + dw / 2, v0: ffl, v1: ffl + 2.4, R: 0.2, kind: 'glazed_double', open: 0, glassKey: ctx.full ? 'glass_clear' : 'glass_shop', T: 0.25 });
  K.signPanel(b, u, ffl + 2.72, Math.min(1.6, dw), 0.32, { frameKey: 'aluminium_dark' });
  K.wallLight(b, u1 + 0.35, ffl + 2.2);
  b.pop();
  // floor + mat inside, colliders
  b.rectY('mat_entrance', u - dw / 2, 0.2, u + dw / 2, dep - 0.3, ffl + 0.004, 1);
  b.rectY('concrete_smooth', u0 + 0.25, 0.02, u1 - 0.25, dep - 0.25, ffl + 0.002, 1);
  if (ctx.full) b.withTint([0.95, 0.95, 0.94], () => b.rectY('plaster', u0 + 0.25, 0.0, u1 - 0.25, dep - 0.25, ffl + h - 0.01, -1));
  if (b.collecting) {
    b.colBox(u0, ffl, 0, u0 + 0.25, ffl + h, dep); b.colBox(u1 - 0.25, ffl, 0, u1, ffl + h, dep);
    b.colBox(u0, ffl, dep - 0.25, u - dw / 2, ffl + h, dep); b.colBox(u + dw / 2, ffl, dep - 0.25, u1, ffl + h, dep);
    b.colQuad(u0, ffl, dep, u1, ffl, dep, u1, ffl, 0, u0, ffl, 0);
  }
  // steps + landing + yellow handrails (O02)
  const L = side === 'front' || side === 'back' ? G.w : G.d;
  const [g0, g1] = K.sideGround(s, side);
  const gy = g0 + ((g1 - g0) * u) / L;
  const landD = 1.4;
  b.cbox('concrete_smooth', u - dw / 2 - 0.6, Math.min(gy, ffl) - 0.4, dep, u + dw / 2 + 0.6, ffl - 0.005, dep + landD, 0.012, false);
  if (b.collecting) b.colQuad(u - dw / 2 - 0.6, ffl, dep + landD, u + dw / 2 + 0.6, ffl, dep + landD, u + dw / 2 + 0.6, ffl, dep, u - dw / 2 - 0.6, ffl, dep);
  const rise = ffl - gy;
  if (rise > 0.05) {
    K.steps(b, { u0: u - dw / 2 - 0.6, u1: u + dw / 2 + 0.6, z0: dep + landD, y0: gy, y1: ffl, key: 'stone_step', cheeks: false, rails: false });
  }
  const nS = Math.max(1, Math.ceil(Math.max(0, rise) / 0.165)), run = nS * 0.3;
  for (const ux of [u - dw / 2 - 0.5, u + dw / 2 + 0.5]) {
    const pts = [[ux, ffl + 1.0, dep + 0.1], [ux, ffl + 1.0, dep + landD], [ux, Math.min(ffl, gy) + 1.0, dep + landD + run], [ux, Math.min(ffl, gy) + 1.0, dep + landD + run + 0.3]];
    b.tube('steel_yellow', pts, 0.022, 8, { transport: true });
    b.tube('steel_yellow', pts.map((p) => [p[0], p[1] - 0.5, p[2]]), 0.016, 6, { transport: true });
    for (const z of [dep + 0.15, dep + landD, dep + landD + run]) { const yy = z <= dep + landD + 0.01 ? ffl : Math.min(ffl, gy); b.box('steel_yellow', ux - 0.022, yy, z - 0.022, ux + 0.022, yy + 1.0, z + 0.022, PX | NX | PZ | NZ); }
  }
  b.pop();
}

function serviceApron(ctx, G, side, u, dw, rng) {
  const b = ctx.b, s = ctx.spec, E = G.E;
  b.push(); K.facadeFrame(b, side, G.w, G.d, 0);
  const L = side === 'front' || side === 'back' ? G.w : G.d;
  const [g0, g1] = K.sideGround(s, side);
  const gy = g0 + ((g1 - g0) * u) / L;
  const y = Math.min(G.ffl, gy + 0.06);
  const a = Math.max(-1.5, u - dw / 2 - 3.5), c = Math.min(L + 1.5, u + dw / 2 + 3.5), dep = 7.5;
  b.withTint([0.92, 0.91, 0.88], () => b.cbox('concrete', a, y - 0.45, 0.0, c, y, dep, 0.03, false));
  if (b.collecting) b.colQuad(a, y, dep, c, y, dep, c, y, 0, a, y, 0);
  // painted guide lines + stop bar
  b.box('steel_yellow', u - dw / 2 - 0.06, y, 0.5, u - dw / 2 + 0.06, y + 0.004, dep - 0.5, PY);
  b.box('steel_yellow', u + dw / 2 - 0.06, y, 0.5, u + dw / 2 + 0.06, y + 0.004, dep - 0.5, PY);
  b.box('steel_yellow', a + 0.3, y, dep - 0.35, c - 0.3, y + 0.004, dep - 0.22, PY);
  // fertigation / buffer tanks on a pad beside the door + cabinet
  const tu = u + dw / 2 + 1.8 < c - 0.8 ? u + dw / 2 + 1.9 : u - dw / 2 - 1.9;
  b.cbox('concrete', tu - 1.0, y - 0.2, 1.0, tu + 1.0, y + 0.18, 3.2, 0.02, false);
  for (const [dz, r, h] of [[1.6, 0.55, 1.9], [2.65, 0.4, 1.5]]) {
    b.cylinder('tank_white', tu, y + 0.18, dz, r, h, 18, { top: true });
    b.lathe('tank_white', [[r, 0], [r * 0.7, r * 0.25], [0.08, r * 0.32]], 18, { x: tu, y: y + 0.18 + h, z: dz });
    for (const yy of [0.5, h - 0.3]) b.lathe('steel', [[r + 0.012, yy], [r + 0.012, yy + 0.05]], 18, { x: tu, y: y + 0.18, z: dz });
  }
  pipeRun(b, [[tu, y + 0.6, 1.6], [tu, y + 0.6, 0.35], [u + (tu > u ? 1 : -1) * (dw / 2 + 0.4), y + 0.6, 0.35], [u + (tu > u ? 1 : -1) * (dw / 2 + 0.4), y + 0.6, 0.02]], 0.05, { key: 'steel' });
  cabinet(b, tu + (tu > u ? 1.6 : -1.6), y, 1.0, 0.8, 1.6, 0.45, 0, 'hvac');
  if (b.collecting) b.colBox(tu - 1.0, y, 1.0, tu + 1.0, y + 2.3, 3.2);
  // crate stack waiting at the door (harvest)
  if (rng.next() < 0.7) {
    const cu = tu > u ? u - dw / 2 - 1.2 : u + dw / 2 + 1.2;
    b.cbox('wood', cu - 0.6, y, 1.2, cu + 0.6, y + 0.14, 2.2, 0.01, false);
    for (let k = 0; k < 2 + Math.floor(rng.next() * 3); k++) b.withTint(k % 2 ? [0.3, 0.55, 0.35] : [0.85, 0.5, 0.18], () => b.cbox('plastic_bin', cu - 0.55, y + 0.14 + k * 0.3, 1.25, cu + 0.55, y + 0.42 + k * 0.3, 2.15, 0.02));
  }
  void E;
  b.pop();
}

/** Irrigation channel (配水渠) along a long local wall, inlet riser + valve + slide gate, wet grating at the service crossing. */
function channel(ctx, G, wall, se, svcW, rng) {
  const b = ctx.b, s = ctx.spec, E = G.E;
  const { L, S } = G;
  b.push();
  if (!G.alongZ) b.rotY(Math.PI / 2);
  const sx = wall === 'sP' ? 1 : -1;
  const off = 1.4;                       // channel centre from the wall face
  const xc = sx * (S / 2 + off);
  const iw = 0.7, wt = 0.16, dep = 0.75;
  // ground along the channel (local terrain sample at the channel's centre)
  const toB = (x, z) => (G.alongZ ? [x, z] : [z, -x]);
  const gAt = (z) => { const p = toB(xc, z); return K.groundAt(s, p[0], p[1]); };
  const za = -L / 2 - 2.0, zb = L / 2 + 2.0;
  const yTop = Math.max(gAt(za), gAt(0), gAt(zb)) + 0.12;
  const yBot = yTop - dep;
  const yWater = yTop - 0.28;
  // walls (dry above the water line, wet below + algae band in the wet provinces) + floor
  for (const xw of [xc - iw / 2 - wt, xc + iw / 2]) {
    b.box('concrete', xw, yWater + 0.12, za, xw + wt, yTop, zb, PY | PX | NX | PZ | NZ);
    b.box('concrete_wet', xw, yBot - 0.15, za, xw + wt, yWater + 0.12, zb, PX | NX | PZ | NZ);
    b.box('concrete', xw, yTop - 0.6, za, xw + wt, yTop - 0.02, zb, xw < xc ? NX : PX);
  }
  b.withTint([0.32, 0.42, 0.42], () => b.box('concrete_wet', xc - iw / 2, yBot - 0.15, za, xc + iw / 2, yBot, zb, PY));
  if (E.wet) b.withTint(E.algaeTint, () => { b.rectX('concrete_wet', za, yWater - 0.18, zb, yWater + 0.05, xc - iw / 2 + 0.004, 1); b.rectX('concrete_wet', za, yWater - 0.18, zb, yWater + 0.05, xc + iw / 2 - 0.004, -1); });
  // water surface: dark teal polished sheet (the building vocabulary has no water key; reflects the sky)
  b.withTint([0.16, 0.27, 0.29], () => b.quad('chrome', xc - iw / 2, yWater, zb, xc + iw / 2, yWater, zb, xc + iw / 2, yWater, za, xc - iw / 2, yWater, za));
  // inlet end: riser from the buried main, gate valve, slide gate in guides, small stilling box
  const zi = za + 0.6;
  pipeRun(b, [[xc + sx * 1.1, yTop - 1.0, zi], [xc + sx * 1.1, yTop + 0.75, zi], [xc + sx * 0.05, yTop + 0.75, zi], [xc + sx * 0.05, yWater + 0.15, zi]], 0.09, { key: 'steel' });
  valve(b, xc + sx * 1.1, yTop + 0.35, zi, 0.08);
  b.cbox('concrete', xc + sx * 0.75, yTop - 0.3, zi - 0.6, xc + sx * 1.45 + 0.01, yTop + 0.08, zi + 0.6, 0.015, false);
  for (const dz of [-0.48, 0.48]) b.box('steel_dark', xc - iw / 2 - 0.02, yBot, zi + 1.2 + dz - 0.04, xc + iw / 2 + 0.02, yTop + 0.9, zi + 1.2 + dz + 0.04, ALL);
  b.box('steel_dark', xc - iw / 2 - 0.05, yTop + 0.86, zi + 0.68, xc + iw / 2 + 0.05, yTop + 0.96, zi + 1.72, ALL);
  b.withTint([0.42, 0.5, 0.6], () => b.box('steel_dark', xc - iw / 2 + 0.02, yWater - 0.3, zi + 1.17, xc + iw / 2 - 0.02, yTop + 0.35 + rng.next() * 0.3, zi + 1.23, ALL));
  b.cylinder('steel', xc, yTop + 0.96, zi + 1.2, 0.025, 0.5, 6, { top: true });
  // gratings over the channel at the crossings (gable ends: service road / footpath); wet steel near water
  for (const zg of [L / 2 - 0.4, -L / 2 + 0.4 + 1.6]) {
    b.box('steel', xc - iw / 2 - wt, yTop - 0.04, zg - 0.9, xc + iw / 2 + wt, yTop + 0.005, zg - 0.86, ALL);
    b.box('steel', xc - iw / 2 - wt, yTop - 0.04, zg + 0.86, xc + iw / 2 + wt, yTop + 0.005, zg + 0.9, ALL);
    b.withTint([0.55, 0.57, 0.58], () => b.rectY('grille_dark', xc - iw / 2 - 0.02, zg - 0.86, xc + iw / 2 + 0.02, zg + 0.86, yTop + 0.002, 1));
    for (let k = -8; k <= 8; k++) b.withTint([0.6, 0.62, 0.62], () => b.box('steel', xc - iw / 2, yTop - 0.05, zg + k * 0.1 - 0.006, xc + iw / 2, yTop, zg + k * 0.1 + 0.006, PY | PZ | NZ));
    if (b.collecting) b.colQuad(xc - iw / 2 - wt, yTop, zg + 0.9, xc + iw / 2 + wt, yTop, zg + 0.9, xc + iw / 2 + wt, yTop, zg - 0.9, xc - iw / 2 - wt, yTop, zg - 0.9);
  }
  // offtakes into the greenhouse: small pipe from the channel through the knee wall every ~2 bays
  for (let j = 2; j < G.nb; j += 4) {
    const z = -L / 2 + j * G.bay + 0.4;
    pipeRun(b, [[xc, yWater - 0.1, z], [xc, yTop + 0.25, z], [sx * (S / 2 + 0.05), yTop + 0.25, z]], 0.035, { key: 'steel', flange: false });
  }
  // path between channel and wall (paving), service road edge on the far side
  b.withTint([0.9, 0.89, 0.86], () => b.cbox('paving', Math.min(sx * S / 2, xc - sx * (iw / 2 + wt)) + (sx > 0 ? 0.02 : 0), yTop - 0.3, za, Math.max(sx * S / 2, xc - sx * (iw / 2 + wt)) - (sx > 0 ? 0 : 0.02), yTop - 0.06, zb, 0.01, false));
  if (b.collecting) b.colBox(xc - iw / 2 - wt, yBot, za, xc + iw / 2 + wt, yTop, zb);
  b.pop();
  void se; void svcW;
}

// ---------------------------------------------------------------------------------------------
// mass LOD: knee walls + glass-tinted gabled spans (reads as glass rows from the air)
// ---------------------------------------------------------------------------------------------
function massing(spec, ctx) {
  const b = ctx.b;
  const G = ghLayout(ctx);
  const { L, S, n, span, eave, rise, knee, ffl } = G;
  const y0 = Math.min(0, ctx.spec._ground.min) - 0.4;
  b.push();
  if (!G.alongZ) b.rotY(Math.PI / 2);
  const wallT = G.E.polar ? [0.92, 0.93, 0.95] : [0.88, 0.87, 0.85];
  const glassT = G.E.polar ? [0.5, 0.6, 0.66] : [0.42, 0.52, 0.55];
  b.pushTint(wallT); b.box('mass_roof', -S / 2, y0, -L / 2, S / 2, ffl + knee, L / 2, ALL & ~NY & ~PY); b.popTint();
  b.pushTint(glassT);
  b.box('mass_roof', -S / 2, ffl + knee, -L / 2, S / 2, eave, L / 2, PX | NX);
  for (let i = 0; i < n; i++) {
    const x0 = -S / 2 + i * span, xc = x0 + span / 2, x1 = x0 + span, yr = eave + rise;
    // roof planes, CCW seen from above-outside (normals up-left / up-right)
    b.quad('mass_roof', xc, yr, L / 2, xc, yr, -L / 2, x0, eave, -L / 2, x0, eave, L / 2);
    b.quad('mass_roof', x1, eave, L / 2, x1, eave, -L / 2, xc, yr, -L / 2, xc, yr, L / 2);
    // gable ends (rect below the eave + triangle)
    b.quad('mass_roof', x0, ffl + knee, L / 2, x1, ffl + knee, L / 2, x1, eave, L / 2, x0, eave, L / 2);
    b.triangle('mass_roof', x0, eave, L / 2, x1, eave, L / 2, xc, yr, L / 2);
    b.quad('mass_roof', x1, ffl + knee, -L / 2, x0, ffl + knee, -L / 2, x0, eave, -L / 2, x1, eave, -L / 2);
    b.triangle('mass_roof', x1, eave, -L / 2, x0, eave, -L / 2, xc, yr, -L / 2);
  }
  b.popTint();
  b.pop();
  return [];
}

export default { name: 'greenhouse', uses: ['greenhouse'], generate, massing };
