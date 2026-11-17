// Civic / landmark tower (公共塔, R2 / Z02 / Z01 skyline), Zhurong family (owner: buildings-z).
// Few per city, 100–150 storeys (≈ 400–600 m). Each instance picks one of four sculptural families from
// spec.hash (round footprints: needle / fluted, rect: sail / twist) with its own proportions:
//   sail    lens plan (convex back, flatter or concave front) tapering and slightly twisting; two white
//           ceramic spines along the plan tips rise past the roof and meet in a pointed blade crown.
//   needle  round glass shaft with entasis, white ribs every third mullion; observation disc over the
//           top storey, slender spire carrying 2–3 rings on spokes (Z02 centre tower).
//   twist   rounded-square plan rotating 60–110° bottom → top with white corner fins following the
//           twist; set-back crown ring + mast (R2 right).
//   fluted  elliptic bullet: glass between 10–16 white ribs that converge into a spire (R2 centre).
// Common: double-height lobby (gh 7 m) behind a glazed porch under a curved white canopy, refuge
// storeys every ~28 floors built as open sky gardens (white slab bands, glass balustrade, planter ring,
// trees in tubs, benches, glazed sky lobby set back; needle: halo rings around the shaft at the two
// upper gardens), plaza with planters, benches, totems, the
// garage ramp on the 'garage' side, service door + yard at the back. 'full': lobby (reception, gates,
// lift lobby), slabs + core on every storey, furnished office floors 1–3, wall colliders.

import * as K from '../kit/index.js';
import { clamp, lerp, smooth, superEllipse, lensPlan, towerLevels, loftCurtain, loftMass, ringSlab, ringRoof, serviceCore, surfaceFin, ringBand, ringNormals, resampleClosed, offsetRing, polyPerimeter, skyGarden, skyDoor } from './z_tower.js';
import { signTotem, benchRow, bollardLine, planterStrip, cyanStrip, reception, waitingBench } from './z_common.js';
import { officeDesk, plantPot } from '../interior/furniture.js';

const DENSE = 96;           // dense plan sampling (resampled per storey)

/** Layout + shape functions (shared by generate and massing). */
function layout(ctx) {
  const s = ctx.spec;
  const r = ctx.sub(950);
  const w = s._w, d = s._d;
  const round = (s.footprint && s.footprint.shape === 'round');
  const nF = clamp(s._floors, 30, 180);
  const gh = 7.0, fh = clamp(s._fh || 4, 3.6, 4.4);
  const plazaY = Math.max(0.15, Math.max(s._ground.fl, s._ground.fr) + 0.05);
  const ffl = plazaY + 0.15;
  const levels = towerLevels(ffl, gh, fh, nF);
  const top = levels[nF - 1].y + fh;                    // roof of the last storey
  const H = top - ffl;
  const R0 = 0.41 * Math.min(w, d);
  const pick = r.next();
  const forced = ['sail', 'needle', 'twist', 'fluted'].includes(s._meta.towerKind) ? s._meta.towerKind : null;
  const kind = forced || (round ? (pick < 0.5 ? 'needle' : 'fluted') : (pick < 0.55 ? 'sail' : 'twist'));
  const L = { s, w, d, nF, gh, fh, plazaY, ffl, levels, top, H, R0, kind, round };
  // per-family parameters
  if (kind === 'sail') {
    L.a0 = R0 * r.float(1.12, 1.25); L.bB = R0 * r.float(0.62, 0.78); L.bF = R0 * r.float(-0.12, 0.22);
    L.rot0 = r.float(-0.25, 0.25); L.twist = r.float(-0.35, 0.35);
    L.crownH = H * r.float(0.1, 0.16);
  } else if (kind === 'needle') {
    L.ent = r.float(0.25, 0.4); L.ribEvery = 2; L.rings = r.int(2, 3); L.spireH = H * r.float(0.16, 0.24);
  } else if (kind === 'twist') {
    L.p = r.float(3.2, 4.6); L.rot0 = r.float(0, Math.PI / 2); L.twist = (r.next() < 0.5 ? -1 : 1) * r.float(1.05, 1.9);
    L.taper = r.float(0.16, 0.3); L.aspect = r.float(0.82, 1.0);
  } else {
    L.ribs = r.int(10, 16); L.aspect = r.float(0.78, 0.95); L.bullet = r.float(0.55, 0.72); L.spireH = H * r.float(0.08, 0.14);
  }
  // refuge storeys = open sky gardens every 21 floors (green bands that read from afar, R2 / Z01)
  L.spandrel = kind === 'sail' ? 1.3 : kind === 'twist' ? 1.15 : kind === 'fluted' ? 1.05 : 0.95;
  L.bandEvery = kind === 'sail' ? 1 : kind === 'fluted' ? 2 : kind === 'needle' ? 3 : 2;   // white slab-edge band rhythm
  L.plant = (lv) => lv > 6 && lv < nF - 3 && (lv % 21) === 20;
  // shape
  L.planAt = (y) => planAt(L, y);
  return L;
}

function tOf(L, y) { return clamp((y - L.ffl) / L.H, 0, 1); }

function planAt(L, y) {
  const t = tOf(L, y);
  switch (L.kind) {
    case 'sail': {
      const a = L.a0 * (1 - 0.3 * Math.pow(t, 1.4));
      const bB = L.bB * (1 - 0.45 * Math.pow(t, 1.2)), bF = L.bF * (1 - 0.7 * t);
      return lensPlan(0, 0, a, bF, bB, DENSE, L.rot0 + L.twist * smooth(t));
    }
    case 'needle': {
      const r = L.R0 * (1 - L.ent * t + 0.06 * Math.sin(t * Math.PI));
      return superEllipse(0, 0, r, r, 2, DENSE, 0);
    }
    case 'twist': {
      const sc = 1 - L.taper * t;
      return superEllipse(0, 0, L.R0 * sc, L.R0 * L.aspect * sc, L.p, DENSE, L.rot0 + L.twist * t);
    }
    default: {
      // bullet: constant in the lower half, then an ogive to bullet·R at the top
      const k = t < 0.5 ? 1 : 1 - (1 - L.bullet) * Math.pow((t - 0.5) / 0.5, 1.6);
      const r = L.R0 * k;
      return superEllipse(0, 0, r, r * L.aspect, 2, DENSE, 0);
    }
  }
}

/** Analytic point on the plan at angle θ (same parametrisation as planAt: θ = π/2 front, decreasing). */
function pointAt(L, theta, y) {
  const t = tOf(L, y);
  if (L.kind === 'fluted') {
    const k = t < 0.5 ? 1 : 1 - (1 - L.bullet) * Math.pow((t - 0.5) / 0.5, 1.6);
    const r = L.R0 * k;
    return [r * Math.cos(theta), r * L.aspect * Math.sin(theta)];
  }
  if (L.kind === 'needle') { const r = L.R0 * (1 - L.ent * t + 0.06 * Math.sin(t * Math.PI)); return [r * Math.cos(theta), r * Math.sin(theta)]; }
  if (L.kind === 'twist') {
    const sc = 1 - L.taper * t, a = L.R0 * sc, b2 = L.R0 * L.aspect * sc, rot = L.rot0 + L.twist * t, p = L.p;
    const ct = Math.cos(theta), st = Math.sin(theta);
    const x = a * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / p), z = b2 * Math.sign(st) * Math.pow(Math.abs(st), 2 / p);
    const c = Math.cos(rot), s = Math.sin(rot);
    return [x * c + z * s, -x * s + z * c];
  }
  return [0, 0];
}
function normalAt(L, theta, y) {
  const e = 0.004, p0 = pointAt(L, theta + e, y), p1 = pointAt(L, theta - e, y);
  // θ decreasing = facade order direction → tangent u = p1 − p0, outward normal (−uz, ux)
  let ux = p1[0] - p0[0], uz = p1[1] - p0[1]; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
  return [-uz, ux];
}

// ---------------------------------------------------------------------------------------------
function generate(spec, lod, ctx) {
  const s = ctx.spec, b = ctx.b, inst = ctx.inst, st = ctx.style;
  const L = layout(ctx);
  const { w, d, ffl, plazaY, levels, top, nF } = L;
  const full = ctx.full;
  const white = inst.bandTint;
  // ---------------- front entrance geometry (porch in front of the ground ring) ----------------
  const g0 = resampleClosed(L.planAt(ffl), 180).pts;
  let zFront = -1e9, xFront = 0;
  for (const p of g0) if (Math.abs(p[0]) < 6 && p[1] > zFront) { zFront = p[1]; xFront = p[0]; }
  if (zFront < -1e8) { zFront = 0; for (const p of g0) zFront = Math.max(zFront, p[1]); }
  const porchW = 8.4, porchD = 4.0, porchH = 4.4;
  // ---------------- curtain wall ----------------
  const realFloors = (lv) => full && (lv <= 3);
  const curtain = loftCurtain(ctx, {
    // blue-grey coated curtain wall (D4 glass_curtain) between white ceramic spandrel bands: the silver-white /
    // blue-grey skyline of R2 / Z02 / Z01 (the white share of the silhouette comes from the spandrels, the
    // slab-edge bands, the ribs / spines / fins and the crowns)
    levels, planAt: L.planAt, bayW: L.kind === 'needle' ? 2.7 : 3.0, spandrel: L.spandrel,
    glassKey: 'glass_curtain', frameKey: 'aluminium', spandrelKey: 'ceramic_band',
    spandrelTint: white, mullD: 0.22, kind: 'office', depth: 10,
    back: realFloors, open: L.plant,
    hole: (lv, k, mid, nrm) => full && lv === 0 && Math.abs(mid[0] - xFront) < porchW / 2 - 0.2 && nrm[1] > 0.35 && mid[1] > zFront - 4,
  });
  // ---------------- refuge storeys = open sky gardens between white bands ----------------
  let skyIdx = 0;
  const skyLevels = [];
  for (const c of curtain) {
    if (!L.plant(c.level)) continue;
    c.inner = skyGarden(ctx, L.planAt, c, skyIdx++, { white });
    skyLevels.push(c);
  }
  // white projecting slab-edge bands (bullnose) on the band rhythm of the family; skipped next to the sky
  // gardens (they carry their own deeper bands) and on the lobby top (own band below)
  for (const c of curtain) {
    if (c.level < 2 || c.open || L.plant(c.level - 1) || (c.level % L.bandEvery) !== 0) continue;
    ringBand(ctx, c.ring, c.y + 0.02, { proj: L.kind === 'sail' ? 0.55 : 0.42, h0: L.kind === 'sail' ? 0.5 : 0.36, h1: 0.07, tint: white });
  }
  L.skyLevels = skyLevels;
  // lobby top band (white) + base plinth
  ringBand(ctx, curtain[0].top, ffl + L.gh, { proj: 1.1, h0: 0.55, h1: 0.12, tint: white });
  K.polyPlinth(b, g0, ffl, (x, z) => K.groundAt(s, x, z), { key: 'stone_plinth', proj: 0.12 });
  // ---------------- family-specific sculpture ----------------
  const topRing = curtain[curtain.length - 1].top;
  if (L.kind === 'sail') sailSculpture(ctx, L, curtain, topRing);
  else if (L.kind === 'needle') needleSculpture(ctx, L, curtain, topRing);
  else if (L.kind === 'twist') twistSculpture(ctx, L, curtain, topRing);
  else flutedSculpture(ctx, L, curtain, topRing);
  // ---------------- porch + curved canopy ----------------
  b.push(); b.translate(xFront - porchW / 2, 0, zFront - 3.2);
  K.setGlassRoom(b, { u0: 0.3, w: porchW, d: 12, h: L.gh - 0.4, sill: 0.1, kind: 5, seed: 0.37, floor: 0, bay: 900, hash: s.hash, profile: s._profile | 0 }, 0, 0);
  K.porch(b, { u0: 0, u1: porchW, y0: ffl, depth: porchD + 3.2, h: porchH, glassKey: full ? 'glass_clear' : 'glass_shop', key: 'aluminium_dark', roofKey: 'ceramic_band' });
  K.clearGlassRoom(b);
  b.pop();
  b.push(); b.translate(xFront, 0, zFront);
  b.withTint(white, () => K.canopyCurved(b, { u0: -10, u1: 10, y: ffl + 6.2, depth: 9.5, t: 0.6, key: 'ceramic_band' }));
  b.pop();
  cyanStrip(b, xFront - 6, zFront + 9.3, xFront + 6, zFront + 9.3, ffl + 5.75, { t: 0.04 });
  // entrance steps from the plaza (one step) + mat
  b.cbox('stone_step', xFront - porchW / 2 - 1.5, plazaY - 0.3, zFront + porchD, xFront + porchW / 2 + 1.5, ffl - 0.004, zFront + porchD + 1.6, 0.015, false);
  if (b.collecting) b.colQuad(xFront - porchW / 2 - 1.5, ffl, zFront + porchD + 1.6, xFront + porchW / 2 + 1.5, ffl, zFront + porchD + 1.6, xFront + porchW / 2 + 1.5, ffl, zFront, xFront - porchW / 2 - 1.5, ffl, zFront);
  // ---------------- plaza ----------------
  plaza(ctx, L, { xFront, zFront });
  // ---------------- interior / slabs / core ----------------
  const coreR = Math.min(L.R0 * 0.32, 9);
  const core = { x0: -coreR, x1: coreR, z0: -coreR * 0.8, z1: coreR * 0.8 };
  if (full) {
    for (const c of curtain) {
      if (c.level === 0) continue;
      ringSlab(ctx, c.ring, c.y, { holes: [core], key: realFloors(c.level) ? 'wood_floor' : 'concrete_smooth', inset: 0.1 });
    }
    // ground floor: stone floor over the whole ring (porch included)
    ringSlab(ctx, curtain[0].ring, ffl, { holes: [core], key: 'stone_floor', soffit: false, inset: 0.05 });
    serviceCore(ctx, { ...core, y0: ffl, y1: top + 1.5, levels, full: true, lifts: 3, key: 'render_white' });
    // wall colliders (glass) on every storey except the porch opening; sky gardens: balustrade (1.2 m)
    // at the slab edge + the glazed sky-lobby line with its door bay open
    if (b.collecting) for (const c of curtain) {
      const hh = c.open ? 1.3 : c.h;
      for (let k = 0; k < c.n; k++) {
        const a = c.ring[k], q = c.ring[(k + 1) % c.n];
        const mx = (a[0] + q[0]) / 2, mz = (a[1] + q[1]) / 2;
        if (c.level === 0 && Math.abs(mx - xFront) < porchW / 2 - 0.2 && mz > zFront - 4) continue;
        b.colQuad(a[0], c.y, a[1], q[0], c.y, q[1], q[0], c.y + hh, q[1], a[0], c.y + hh, a[1]);
      }
      if (c.inner) {
        const R = c.inner.ring, n = R.length;
        for (let k = 0; k < n; k++) {
          const a = R[k], q = R[(k + 1) % n];
          if (skyDoor(a, q)) continue;
          b.colQuad(a[0], c.y, a[1], q[0], c.y, q[1], q[0], c.y + c.h, q[1], a[0], c.y + c.h, a[1]);
        }
      }
    }
    lobbyInterior(ctx, L, core, { xFront, zFront });
    for (const c of curtain) if (c.level >= 1 && c.level <= 3) officeFloor(ctx, L, c, core);
  } else {
    // exterior: the core reads through the clear lobby glass only — keep a closed core box in the lobby
    b.box('render_white', core.x0, ffl, core.z0, core.x1, ffl + L.gh, core.z1, 1 | 2 | 16 | 32);
  }
  // ---------------- anchors ----------------
  const A = b.anchors;
  A.floors = levels.map((lv) => ({ level: lv.level, y: lv.y, height: lv.h }));
  A.roof = { y: top, access: [0, top, 0] };
  A.entrances = [{ kind: 'main', side: 'front', pos: [xFront, ffl, zFront + porchD + 0.8], dir: [0, 0, 1], width: 1.8 }];
  A.entrances.push({ kind: 'service', side: 'back', pos: [L.serviceX ?? 0, plazaY, -d / 2 + 1], dir: [0, 0, -1], width: 1.4 });
  if (L.garage) A.entrances.push({ kind: 'garage', side: L.garage.side, pos: L.garage.pos, dir: L.garage.dir, width: 6 });
  A.rooms = [{ floor: 0, name: 'lobby', kind: 'lobby', center: [0, ffl, zFront * 0.5], size: [L.R0 * 1.6, L.gh, L.R0] }];
  const Hh = top - ffl;
  A.cameras = {
    street: { pos: [-w * 0.9, plazaY + 1.65, d / 2 + 40], target: [0, ffl + Math.min(60, Hh * 0.2), 0] },
    entrance: { pos: [xFront + 3, plazaY + 1.65, zFront + porchD + 14], target: [xFront, ffl + 3, zFront] },
    lobby: { pos: [xFront + 2.5, ffl + 1.65, zFront - 1.5], target: [0, ffl + 2.5, core.z1 + 1] },
    interior: { pos: [xFront + 2.5, ffl + 1.65, zFront - 1.5], target: [0, ffl + 2.5, core.z1 + 1] },
    back: { pos: [w * 0.5, plazaY + 1.65, -d / 2 - 35], target: [0, ffl + 25, 0] },
    roof: { pos: [-L.R0 * 2.5, top + L.R0 * 2.2, L.R0 * 2.8], target: [0, top + 4, 0] },
    stair: { pos: [core.x1 + 2, ffl + 1.65, core.z1 + 2], target: [core.x0, ffl + 2, core.z1] },
  };
  b.meta.tower = { kind: L.kind, height: top + (L.crownH || L.spireH || 0) };
}

/** Halo ring around the shaft (needle family, Z02): white swept ring + cyan edge line + radial spokes. */
function haloRing(ctx, L, y, rIn, rOut, rot) {
  const b = ctx.b, white = ctx.inst.bandTint;
  const path = K.ringPolygon(0, 0, rOut, 72).map((p) => [p[0], y, p[1]]);
  b.withTint(white, () => b.sweep('ceramic_band', path, [[-0.5, -0.3], [0.5, -0.3], [0.62, 0], [0.5, 0.3], [-0.5, 0.3], [-0.62, 0]], { closed: true, smoothAngle: 30 }));
  cyanRing(b, 0, 0, rOut + 0.63, y, 72);
  for (let k = 0; k < 6; k++) {
    const a = rot + (k / 6) * Math.PI * 2;
    b.tube('aluminium', [[Math.cos(a) * rIn, y, Math.sin(a) * rIn], [Math.cos(a) * (rOut - 0.45), y, Math.sin(a) * (rOut - 0.45)]], 0.14, 8);
  }
}

// ---------------------------------------------------------------------------------------------
// sculptures
// ---------------------------------------------------------------------------------------------
function sailSculpture(ctx, L, curtain, topRing) {
  const b = ctx.b, white = ctx.inst.bandTint;
  const half = Math.floor(DENSE / 2);
  // spines along both tips: sample every few storeys
  const step = Math.max(1, Math.round(curtain.length / 40));
  const tips = [[], []];
  const nrms = [[], []];
  for (let i = 0; i <= curtain.length; i += step) {
    const y = i >= curtain.length ? L.top : curtain[i].y;
    const P = L.planAt(y);
    for (const [j, idx] of [[0, 0], [1, half]]) {
      const p = P[idx], prev = P[(idx - 1 + DENSE) % DENSE], next = P[(idx + 1) % DENSE];
      // tip direction: away from the plan centre along the bisector of the two edges
      let tx = (p[0] - prev[0]) + (p[0] - next[0]), tz = (p[1] - prev[1]) + (p[1] - next[1]); const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      tips[j].push([p[0] + tx * 0.2, y, p[1] + tz * 0.2]);
      nrms[j].push([tx, tz]);
    }
  }
  if (tips[0][tips[0].length - 1][1] < L.top - 0.01) for (const j of [0, 1]) { const P = L.planAt(L.top); const idx = j ? half : 0; tips[j].push([P[idx][0], L.top, P[idx][1]]); nrms[j].push(nrms[j][nrms[j].length - 1]); }
  // crown: spines continue up and meet at the apex above the plan centre line
  const P = L.planAt(L.top);
  const tl = P[0], tr = P[half];
  const cx = (tl[0] + tr[0]) / 2, cz = (tl[1] + tr[1]) / 2;
  const apex = [cx + (tr[0] - tl[0]) * 0.18, L.top + L.crownH, cz + (tr[1] - tl[1]) * 0.18];   // leaning apex (asymmetric sail)
  const crownPts = [[], []];
  for (const j of [0, 1]) {
    const base = j ? tr : tl;
    const N = 14;
    for (let k = 1; k <= N; k++) {
      const u = k / N;
      const yy = L.top + (apex[1] - L.top) * (1 - Math.pow(1 - u, 1.7));
      const xx = base[0] + (apex[0] - base[0]) * Math.pow(u, 1.5), zz = base[1] + (apex[2] - base[1]) * Math.pow(u, 1.5);
      crownPts[j].push([xx, yy, zz]);
    }
  }
  const ax = tr[0] - tl[0], az = tr[1] - tl[1], al = Math.hypot(ax, az) || 1;
  for (const j of [0, 1]) {
    const pts = tips[j].concat(crownPts[j]);
    const nn = nrms[j].concat(crownPts[j].map(() => [(j ? 1 : -1) * ax / al, (j ? 1 : -1) * az / al]));
    surfaceFin(ctx, pts, (t, i) => nn[Math.min(i, nn.length - 1)], { depth: (t) => lerp(2.6, 0.9, t * t), thick: (t) => lerp(3.8, 1.3, t * t), seg: 14, key: 'ceramic_band', tint: white, capTop: false });
  }
  // blade between the spines above the roof (two faces, ceramic)
  const outline = [[0, 0]];
  const toPlane = (p) => [((p[0] - tl[0]) * ax + (p[2] - tl[1]) * az) / al, p[1] - L.top];
  for (const p of crownPts[0]) outline.push(toPlane(p));
  for (let k = crownPts[1].length - 2; k >= 0; k--) outline.push(toPlane(crownPts[1][k]));
  outline.push([al, 0]);
  const tri = K.triangulate(outline);
  const nx = -az / al, nz = ax / al;                 // blade normal (front side)
  const T = 0.35;
  const P3 = (q, off) => [tl[0] + (ax / al) * q[0] + nx * off, L.top + q[1], tl[1] + (az / al) * q[0] + nz * off];
  b.withTint(white, () => {
    for (let i = 0; i < tri.length; i += 3) {
      const A = outline[tri[i]], B = outline[tri[i + 1]], C = outline[tri[i + 2]];
      const a1 = P3(A, T), b1 = P3(B, T), c1 = P3(C, T);
      const a2 = P3(A, -T), b2 = P3(B, -T), c2 = P3(C, -T);
      // orient each face by its intended normal
      const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (cr > 0) { b.triangle('ceramic_band', a1[0], a1[1], a1[2], b1[0], b1[1], b1[2], c1[0], c1[1], c1[2]); b.triangle('ceramic_band', a2[0], a2[1], a2[2], c2[0], c2[1], c2[2], b2[0], b2[1], b2[2]); }
      else { b.triangle('ceramic_band', a1[0], a1[1], a1[2], c1[0], c1[1], c1[2], b1[0], b1[1], b1[2]); b.triangle('ceramic_band', a2[0], a2[1], a2[2], b2[0], b2[1], b2[2], c2[0], c2[1], c2[2]); }
    }
  });
  // roof inside the crown (membrane + parapet) and an aviation light at the apex
  ringRoof(ctx, topRing, L.top, { parapet: 1.2, key: 'ceramic_band', surface: 'roof_membrane' });
  b.cylinder('light_red', apex[0], apex[1] - 0.6, apex[2], 0.25, 0.4, 10, { top: true });
  // white vertical edge line on the concave front: thin fins every 6th bay
}

function needleSculpture(ctx, L, curtain, topRing) {
  const b = ctx.b, white = ctx.inst.bandTint;
  // white ribs every third mullion (sample every few storeys)
  const nR = Math.max(12, Math.round(polyPerimeter(L.planAt(L.ffl)) / (2.7 * L.ribEvery)));
  const step = Math.max(1, Math.round(curtain.length / 36));
  for (let j = 0; j < nR; j++) {
    const th = Math.PI / 2 - (j * 2 * Math.PI) / nR + 0.0001;
    const pts = [], nn = [];
    for (let i = 0; i <= curtain.length; i += step) {
      const y = i >= curtain.length ? L.top : curtain[i].y + (i === 0 ? 0.0 : 0);
      const p = pointAt(L, th, y), n = normalAt(L, th, y);
      pts.push([p[0] + n[0] * 0.15, y, p[1] + n[1] * 0.15]); nn.push(n);
    }
    surfaceFin(ctx, pts, (t, i) => nn[Math.min(i, nn.length - 1)], { depth: 1.15, thick: 0.95, seg: 10, key: 'ceramic_band', tint: white });
  }
  // halo rings around the shaft at the two upper sky gardens (in the plane of their roof band)
  (L.skyLevels || []).slice(-2).forEach((c, i) => {
    const y = c.y + c.h - 0.1;
    const r = Math.hypot(...pointAt(L, 0, y));
    haloRing(ctx, L, y, r + 0.8, r + 5.2 + i * 1.1, 0.3 + i * 0.52);
  });
  // observation disc over the top storey (saucer), roof + spire with rings
  const rTop = Math.hypot(...pointAt(L, 0, L.top));
  const y0 = L.top;
  b.withTint(white, () => {
    b.lathe('ceramic_band', [[rTop - 0.2, y0 - 0.2], [rTop + 4.5, y0 + 0.6], [rTop + 5.4, y0 + 1.4], [rTop + 4.8, y0 + 2.4], [rTop + 1.0, y0 + 3.2], [rTop * 0.55, y0 + 3.6]], 64, { capTop: true });
  });
  // glazed observation band under the disc lip (frosted ring, glows at night with zero ids = never: use cyan line)
  b.lathe('glass_railing', [[rTop + 4.6, y0 + 1.0], [rTop + 5.3, y0 + 1.5], [rTop + 4.7, y0 + 2.2]], 64, {});
  cyanRing(b, 0, 0, rTop + 5.42, y0 + 1.4, 64);
  // spire
  const H2 = L.spireH;
  const rs = Math.max(1.6, rTop * 0.32);
  b.withTint(white, () => b.lathe('ceramic_band', [[rs, y0 + 3.5], [rs * 0.85, y0 + 3.5 + H2 * 0.35], [rs * 0.55, y0 + 3.5 + H2 * 0.7], [0.35, y0 + 3.5 + H2 * 0.97], [0.0, y0 + 3.5 + H2]], 24, {}));
  b.cylinder('light_red', 0, y0 + 3.5 + H2 * 0.97, 0, 0.3, 0.45, 10, { top: true });
  // rings on spokes
  for (let i = 0; i < L.rings; i++) {
    const yy = y0 + 3.5 + H2 * (0.18 + 0.2 * i);
    const rr = rs * (1 - 0.45 * (0.18 + 0.2 * i)) + 7.5 - i * 1.6;
    const path = K.ringPolygon(0, 0, rr, 56).map((p) => [p[0], yy, p[1]]);
    b.withTint(white, () => b.sweep('ceramic_band', path, [[-0.45, -0.32], [0.45, -0.32], [0.55, 0], [0.45, 0.32], [-0.45, 0.32], [-0.55, 0]], { closed: true, smoothAngle: 30 }));
    cyanRing(b, 0, 0, rr + 0.56, yy, 56);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + i * 0.4;
      const r0 = rs * (1 - 0.45 * (0.18 + 0.2 * i)) * 0.9;
      b.tube('aluminium', [[Math.cos(a) * r0, yy, Math.sin(a) * r0], [Math.cos(a) * (rr - 0.4), yy, Math.sin(a) * (rr - 0.4)]], 0.12, 8);
    }
  }
  void topRing;
}

function twistSculpture(ctx, L, curtain, topRing) {
  const b = ctx.b, white = ctx.inst.bandTint;
  const step = Math.max(1, Math.round(curtain.length / 48));
  for (let c = 0; c < 4; c++) {
    const th = Math.PI / 4 + (c * Math.PI) / 2;
    const pts = [], nn = [];
    for (let i = 0; i <= curtain.length; i += step) {
      const y = i >= curtain.length ? L.top : curtain[i].y;
      const p = pointAt(L, th, y), n = normalAt(L, th, y);
      pts.push([p[0] + n[0] * 0.1, y, p[1] + n[1] * 0.1]); nn.push(n);
    }
    // corner fins rise 6 m above the roof
    const pT = pts[pts.length - 1], nT = nn[nn.length - 1];
    pts.push([pT[0] - nT[0] * 0.4, L.top + 6, pT[2] - nT[1] * 0.4]); nn.push(nT);
    surfaceFin(ctx, pts, (t, i) => nn[Math.min(i, nn.length - 1)], { depth: 2.3, thick: 2.8, seg: 12, key: 'ceramic_band', tint: white });
  }
  // crown: set-back glazed lantern + white ring + mast
  const rr = ringRoof(ctx, topRing, L.top, { parapet: 1.5, key: 'ceramic_band', surface: 'roof_membrane' });
  ringBand(ctx, topRing, L.top + 1.5, { proj: 0.6, h0: 0.3, h1: 0.15, tint: white });
  const lan = offsetRing(rr, -L.R0 * 0.18);
  for (let k = 0; k < lan.length; k += 1) {
    const a = lan[k], q = lan[(k + 1) % lan.length];
    K.clearGlassRoom(b);
    b.quad('glass_frosted', a[0], L.top, a[1], q[0], L.top, q[1], q[0], L.top + 7, q[1], a[0], L.top + 7, a[1]);
    if (k % 3 === 0) b.box('aluminium', a[0] - 0.06, L.top, a[1] - 0.06, a[0] + 0.06, L.top + 7, a[1] + 0.06, 63 & ~8);
  }
  b.withTint(white, () => b.polyY('ceramic_band', lan, [], L.top + 7.0, 1));
  b.withTint(white, () => b.lathe('ceramic_band', [[1.2, L.top + 7], [0.9, L.top + 20], [0.25, L.top + 34], [0, L.top + 36]], 16, {}));
  b.cylinder('light_red', 0, L.top + 34, 0, 0.25, 0.4, 10, { top: true });
}

function flutedSculpture(ctx, L, curtain, topRing) {
  const b = ctx.b, white = ctx.inst.bandTint;
  const step = Math.max(1, Math.round(curtain.length / 44));
  const apexY = L.top + L.spireH;
  for (let j = 0; j < L.ribs; j++) {
    const th = Math.PI / 2 - (j * 2 * Math.PI) / L.ribs + 0.0001;
    const pts = [], nn = [];
    for (let i = 0; i <= curtain.length; i += step) {
      const y = i >= curtain.length ? L.top : curtain[i].y;
      const p = pointAt(L, th, y), n = normalAt(L, th, y);
      pts.push([p[0] + n[0] * 0.15, y, p[1] + n[1] * 0.15]); nn.push(n);
    }
    // converge into the spire
    const pT = pts[pts.length - 1], nT = nn[nn.length - 1];
    for (let k = 1; k <= 8; k++) {
      const u = k / 8;
      // the ribs meet at the apex: their end caps are staggered 7 mm apart in height (coplanar caps z-fought)
      const y = L.top + (apexY - L.top) * u - (k === 8 ? 0.007 * j : 0);
      const f = Math.pow(1 - u, 1.3);
      pts.push([pT[0] * f, y, pT[2] * f]); nn.push(nT);
    }
    surfaceFin(ctx, pts, (t, i) => nn[Math.min(i, nn.length - 1)], { depth: (t) => (t > 0.9 ? 0.9 : 1.6), thick: (t) => (t > 0.9 ? 0.8 : 1.35), seg: 10, key: 'ceramic_band', tint: white });
  }
  // roof: glazed lantern dome inside the converging ribs
  const rT = Math.hypot(...pointAt(L, 0, L.top));
  const prof = [];
  for (let k = 0; k <= 10; k++) { const u = k / 10; prof.push([rT * Math.pow(1 - u, 1.25) * 0.98, L.top + (apexY - L.top) * 0.92 * u]); }
  b.lathe('glass_frosted', prof, 48, {});
  b.cylinder('light_red', 0, apexY - 0.5, 0, 0.25, 0.4, 10, { top: true });
  b.withTint(white, () => b.polyY('ceramic_band', topRing, [], L.top + 0.02, 1));
}

function cyanRing(b, cx, cz, r, y, n) {
  const pts = K.ringPolygon(cx, cz, r, n);
  for (let k = 0; k < n; k++) {
    const a = pts[k], c = pts[(k + 1) % n];
    b.quad('light_cyan', a[0], y - 0.04, a[1], c[0], y - 0.04, c[1], c[0], y + 0.04, c[1], a[0], y + 0.04, a[1]);
  }
}

// ---------------------------------------------------------------------------------------------
// plaza, lobby, office floors
// ---------------------------------------------------------------------------------------------
function plaza(ctx, L, o) {
  const b = ctx.b, s = ctx.spec;
  const { w, d, plazaY } = L;
  const gmin = Math.min(s._ground.min, 0);
  // garage ramp on the 'garage' entrance side (right/left), service yard at the back
  const ge = s._entrances.find((e) => e.kind === 'garage');
  const side = ge ? ge.side : (s._shared.right ? 'left' : 'right');
  const sx = side === 'left' ? -1 : 1;
  const rampW = 6.4, rampL = 22;
  const rz0 = clamp(-d / 2 + 4, -d / 2 + 2, d / 2 - rampL - 2), rz1 = rz0 + rampL;
  const rx0 = sx > 0 ? w / 2 - rampW - 1.2 : -w / 2 + 1.2, rx1 = rx0 + rampW;
  // paving pad split around the ramp
  const pad = (x0, z0, x1, z1) => { if (x1 - x0 < 0.2 || z1 - z0 < 0.2) return; b.box('paving_stone', x0, gmin - 0.5, z0, x1, plazaY, z1, 4 | 1 | 2 | 16 | 32); if (b.collecting) b.colQuad(x0, plazaY, z1, x1, plazaY, z1, x1, plazaY, z0, x0, plazaY, z0); };
  pad(-w / 2, -d / 2, rx0, d / 2); pad(rx1, -d / 2, w / 2, d / 2); pad(rx0, -d / 2, rx1, rz0); pad(rx0, rz1, rx1, d / 2);
  // ramp: slope from the plaza edge (front end) down to −4 m at the back, side walls with rails, portal
  const yb = plazaY - 4.2;
  b.quad('concrete', rx0, plazaY, rz1, rx1, plazaY, rz1, rx1, yb, rz0 + 4, rx0, yb, rz0 + 4);
  b.box('concrete', rx0, yb - 0.3, rz0, rx1, yb, rz0 + 4, 4);
  for (const xx of [rx0, rx1]) {
    b.box('concrete_smooth', xx - 0.15, yb - 0.3, rz0, xx + 0.15, plazaY + 1.0, rz1, 63);
    K.railing(b, [[xx, rz0 + 0.2], [xx, rz1 - 0.2]], plazaY + 1.0, { kind: 'bars', key: 'aluminium', top: 0.1 });
  }
  b.box('concrete_smooth', rx0 - 0.15, yb - 0.3, rz0 - 0.3, rx1 + 0.15, plazaY + 1.0, rz0, 63);            // back wall over the portal
  b.box('black', rx0 + 0.2, yb, rz0, rx1 - 0.2, yb + 3.0, rz0 + 0.02, 16);                                   // dark portal
  b.box('steel_yellow', rx0 + 0.2, yb + 3.0, rz0 + 0.02, rx1 - 0.2, yb + 3.3, rz0 + 0.1, 63);
  b.box('light_cyan', rx0 + 0.4, yb + 3.32, rz0 + 0.05, rx1 - 0.4, yb + 3.36, rz0 + 0.09, 63);
  L.garage = { side, pos: [(rx0 + rx1) / 2, plazaY, rz1], dir: [0, 0, 1] };
  // planters with trees at the plaza corners, benches, totems, bollards along the kerb
  const seed = s.hash >>> 0;
  const R = L.R0;
  const corners = [[-w / 2 + 5, d / 2 - 4], [w / 2 - 5, d / 2 - 4], [-w / 2 + 5, -d / 2 + 5]];
  for (const [x, z] of corners) {
    if (x > rx0 - 3 && x < rx1 + 3) continue;
    if (Math.hypot(x, z) < R + 4) continue;
    planterStrip(ctx.b, x - 3, z - 1.4, x + 3, z + 1.4, plazaY, (seed + Math.round(x * 7 + z)) >>> 0, { tree: true, treeH: 5.2 });
  }
  benchRow(b, -w / 2 + 3, Math.min(w / 2 - 3, rx0 - 2), d / 2 - 1.8, plazaY, 0, 6);
  signTotem(b, o.xFront - 9, plazaY, d / 2 - 3, 0, { w: 1.1, h: 3.4 });
  bollardLine(b, -w / 2 + 1, d / 2 - 0.4, w / 2 - 1, d / 2 - 0.4, plazaY, 2.4);
  // service yard at the back: low wall, bins, service door into the core (via a short covered link)
  L.serviceX = -R * 0.3;
  b.push(); b.translate(L.serviceX, 0, -d / 2 + 3.5); b.rotY(Math.PI);
  K.binStore(b, -2.0, -1.0, 2.0, 1.0, plazaY, { wallKey: 'ceramic_grey' });
  b.pop();
}

function lobbyInterior(ctx, L, core, o) {
  const b = ctx.b;
  const y = L.ffl;
  // reception desk facing the entrance, gate line in front of the lift lobby, benches, planters
  b.push(); b.translate(o.xFront - 6, y, o.zFront - 7); b.rotY(0.25); reception(b, 4.2); b.pop();
  const zg = core.z1 + 3.2;
  const nG = 6;
  for (let i = 0; i <= nG; i++) {
    const x = -nG * 0.5 + i * 1.0;
    b.cbox('aluminium_dark', x - 0.13, y, zg - 0.8, x + 0.13, y + 1.05, zg + 0.8, 0.02, false);
    b.box('light_cyan', x - 0.09, y + 1.05, zg - 0.75, x + 0.09, y + 1.07, zg - 0.55, 63);
    if (b.collecting) b.colBox(x - 0.13, y, zg - 0.8, x + 0.13, y + 1.05, zg + 0.8);
  }
  for (const x of [-L.R0 * 0.55, L.R0 * 0.55]) { b.push(); b.translate(x, y, o.zFront - 4); b.rotY(Math.PI); waitingBench(b, 2.6); b.pop(); }
  b.push(); b.translate(0, y, 0);
  for (const [x, z] of [[-L.R0 * 0.6, core.z1 + 1.5], [L.R0 * 0.6, core.z1 + 1.5], [o.xFront + 5, o.zFront - 6]]) plantPot(b, x, z, 1.2, (ctx.spec.hash + Math.round(x * 3)) >>> 0);
  b.pop();
  // big blank media wall on the core face
  b.box('signage_blank', core.x0 + 1, y + 3.0, core.z1, core.x1 - 1, y + 6.2, core.z1 + 0.05, 16);
}

function officeFloor(ctx, L, c, core) {
  const b = ctx.b, s = ctx.spec;
  // desks on a grid between the core and the glass (inside 1.8 m of the facade ring), ceiling panels
  const R = offsetRing(c.ring, -1.8);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of R) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const inside = (x, z) => K.pointInPoly(x, z, R) && !(x > core.x0 - 2.2 && x < core.x1 + 2.2 && z > core.z0 - 2.2 && z < core.z1 + 2.2);
  let i = 0;
  for (let x = x0 + 1.2; x < x1 - 1; x += 3.0) for (let z = z0 + 1.2; z < z1 - 1; z += 2.6) {
    if (!inside(x, z) || !inside(x + 1.4, z + 1.2)) continue;
    b.push(); b.translate(x, c.y, z); officeDesk(b, (s.hash + i++) >>> 0); b.pop();
  }
  b.setExtra('iwin1', 0, 0.5, c.level, 0);
  b.setExtra('iwin2', (s.hash >>> 16) & 0xffff, s.hash & 0xffff, 7, s._profile | 0);
  const ceil = c.y + c.h - 0.35;
  for (let x = x0 + 1.5; x < x1 - 1; x += 3.6) for (let z = z0 + 1.5; z < z1 - 1; z += 3.6) {
    if (!inside(x, z)) continue;
    b.box('light_panel', x - 0.6, ceil - 0.025, z - 0.3, x + 0.6, ceil, z + 0.3, 63 & ~4);
  }
  b.clearExtra('iwin1'); b.clearExtra('iwin2');
}

// ---------------------------------------------------------------------------------------------
// mass LOD: per-storey loft + crown silhouette
// ---------------------------------------------------------------------------------------------
function massing(spec, ctx) {
  const L = layout(ctx);
  const b = ctx.b, s = ctx.spec;
  const top = loftMass(ctx, { levels: L.levels, planAt: L.planAt, bayW: L.kind === 'needle' ? 2.7 : 3.0, groundH: L.ffl + L.gh, floorH: L.fh, eaveY: L.top, flags: 8, y0: Math.min(0, s._ground.min) - 0.5, louvre: L.plant, chord: 5 });
  b.pushTint([0.93, 0.92, 0.89]);
  // roof cap
  b.polyY('mass_roof', top, [], L.top, 1);
  const rT = Math.hypot(...(top[0] || [0, 0]));
  if (L.kind === 'needle') {
    b.lathe('mass_roof', [[rT + 5, L.top + 0.6], [rT + 5.4, L.top + 1.6], [rT * 0.6, L.top + 3.6]], 24, { capTop: true });
    b.lathe('mass_roof', [[Math.max(1.6, rT * 0.32), L.top + 3.5], [0, L.top + 3.5 + L.spireH]], 10, {});
  } else if (L.kind === 'fluted') {
    b.lathe('mass_roof', [[rT, L.top], [rT * 0.45, L.top + L.spireH * 0.6], [0, L.top + L.spireH]], 16, {});
  } else if (L.kind === 'twist') {
    b.lathe('mass_roof', [[1.2, L.top], [0, L.top + 36]], 8, {});
  } else {
    // sail crown: a thin vertical triangle on the major axis
    const P = L.planAt(L.top), half = Math.floor(DENSE / 2), tl = P[0], tr = P[half];
    const ax = (tl[0] + tr[0]) / 2 + (tr[0] - tl[0]) * 0.18, az = (tl[1] + tr[1]) / 2 + (tr[1] - tl[1]) * 0.18;
    const nx = -(tr[1] - tl[1]), nz = tr[0] - tl[0], nl = Math.hypot(nx, nz) || 1;
    for (const sg of [1, -1]) {
      const ox = (nx / nl) * 0.6 * sg, oz = (nz / nl) * 0.6 * sg;
      if (sg > 0) b.triangle('mass_roof', tl[0] + ox, L.top, tl[1] + oz, tr[0] + ox, L.top, tr[1] + oz, ax + ox, L.top + L.crownH, az + oz);
      else b.triangle('mass_roof', tr[0] + ox, L.top, tr[1] + oz, tl[0] + ox, L.top, tl[1] + oz, ax + ox, L.top + L.crownH, az + oz);
    }
  }
  b.popTint();
  // plaza slab (so the base reads)
  b.pushTint([0.72, 0.71, 0.68]);
  b.box('mass_roof', -L.w / 2, Math.min(0, s._ground.min) - 0.5, -L.d / 2, L.w / 2, L.plazaY, L.d / 2, 4 | 1 | 2 | 16 | 32);
  b.popTint();
  b.anchors.roof = { y: L.top, access: [0, L.top, 0] };
  b.anchors.floors = L.levels.map((lv) => ({ level: lv.level, y: lv.y, height: lv.h }));
  return [];
}

export default {
  name: 'civic_tower',
  uses: ['civic_tower'],
  generate,
  massing,
};

export { layout as civicLayout, ringNormals };
