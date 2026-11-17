// Rail station (站房 + 站台), Zhurong family (owner: buildings-z). Z03 middle / R2 / Z02 language.
//
// Sequence (§1 站房的步行入口、检票厅、候车面与站台边沿依次相接，后勤门另接服务道):
//   plaza (bike shelter, totems, bollards) → glazed front with three entrance groups under a curved
//   canopy → ticket hall (machines, service counter) → fare-gate line → paid concourse →
//   platforms along the track (spec.meta trackHeading / platformSide = back, platformLength = w):
//   * at grade: hall floor = platform level (rail head + 1.0 m), so the near platform opens straight
//     off the paid concourse; the plaza climbs to it by broad steps + 1:12 ramps. A glazed footbridge
//     leaves the level-1 concourse (stair + escalator + glass lift in the hall), crosses both tracks and
//     lands in a stair + lift tower on the far platform.
//   * elevated (Z03): ticket hall at street level; stair + escalator + glass lift rise to a platform-level
//     mezzanine that opens onto the near platform deck (on white columns beside the viaduct); the far
//     platform is reached by a covered ground passage under the viaduct and a stair + lift tower. A white
//     sculptural arch with a glass spine spans the platforms.
//   Platforms: 0.9–1.1 m above the rail head (STATION_GEOM), length = spec w, white edge coping, yellow
//   tactile line, under-edge recess, canopy (white frames, PV glass, downlights, limited cyan strip),
//   benches, blank sign boxes, end railings. Back of house: service door + yard on the free short side
//   with a driveway to the service road. Halts (w < 40): short platform, shelter, crossing ramp.
// Track bed itself is drawn by the city agent (see types/z_station_geom.js for the shared numbers).

import * as K from '../kit/index.js';
import { kindCode } from '../kit/plan.js';
import { clamp, columnCanopy, cyanStrip, signTotem, glassScreen, reception, waitingBench, zMass, groundAtU, bollardLine, planterStrip, furnishPublic, slabWithHoles, lightBox, ledBoard } from './z_common.js';
import { hall, entranceSteps } from './z_hall.js';
import { finLoft } from './z_curtain.js';
import { stationTrack, STATION_GEOM } from './z_station_geom.js';
import { sideGround } from '../kit/plinth.js';

// occupancy (pure): station hall glazing uses bay ids whose public-profile decision is "lit all night"
// (transit halls stay lit through the service day, §1 客运站的顶棚透光 / 换乘厅先亮)
let OCC = null;
try { const m = import.meta.glob('../../world/occupancy.js', { eager: true }); OCC = m['../../world/occupancy.js'] || null; } catch { OCC = null; }
/** k-th bay id ≥ base whose window decision (floor 0, profile 2) is lit at 05:00, 12:00, 21:30 and 00:30. */
function litBays(hash, n, base = 3000) {
  const out = [];
  for (let bay = base; out.length < n && bay < base + 4000; bay++) {
    if (!OCC || !OCC.windowLitMinute) { out.push(bay); continue; }
    let ok = true;
    for (const m of [300, 720, 1290, 30]) if (!(OCC.windowLitMinute(hash >>> 0, 0, bay, m, 2) > 0)) { ok = false; break; }
    if (ok) out.push(bay);
  }
  while (out.length < n) out.push(base + out.length);
  return out;
}

const G = STATION_GEOM;

function layout(ctx) {
  const s = ctx.spec;
  const w = s._w, d = s._d;
  const T = stationTrack(s);
  const halt = w < 40;
  const main = !!(s._meta.main) || s.tier === 'landmark';
  const nF = clamp(s._floors, 1, 3);
  const Lh = halt ? Math.min(10, w * 0.4) : clamp(main ? w * 0.42 : w * 0.34, 34, main ? 96 : 60);
  const ffl = T.elevated || halt ? Math.max(0.3, Math.max(s._ground.fl, s._ground.fr) + 0.15) : Math.max(T.platY, Math.max(s._ground.fl, s._ground.fr) + 0.3);
  const gh = T.elevated ? clamp(T.platY - ffl, 6, 14) : clamp(s._gh || 7, 6, 8);
  const fh = clamp(s._fh || 6, 4.5, 6.5);
  const levels = halt ? 1 : (T.elevated ? Math.max(1, nF - 1) + 1 : nF);
  const eave = halt ? 3.2 : gh + (levels > 1 ? fh * (levels - 1) : 0);
  // shells spring from ys (walls stop there; above it the glazed fans + white shells); halts keep a flat roof
  const ysRel = halt ? eave : Math.max(gh + 2.2, eave - 2.0);
  // far platform width (wider at the access tower), near platform runs from its edge to the hall back
  return { w, d, T, halt, main, Lh, ffl, gh, fh, levels, eave, ysRel, farW: halt ? 3.2 : 6.5 };
}

// ---------------------------------------------------------------------------------------------
// platforms + canopies
// ---------------------------------------------------------------------------------------------
function platform(ctx, L, o) {
  const b = ctx.b, T = L.T;
  const { x0, x1, zEdge, zOut, side } = o;      // side +1: platform on the +z side of its edge (near), −1 far
  const y = T.platY, yb = T.railY - 0.5;
  const za = Math.min(zEdge, zOut), zb = Math.max(zEdge, zOut);
  // deck (elevated: slab on columns; at grade: solid body down to the track bed / ground)
  const bottom = T.elevated ? y - 0.65 : Math.min(yb, T.groundTrack - 0.3);
  b.cbox('concrete_smooth', x0, bottom, za, x1, y - 0.05, zb, 0.02, T.elevated);
  // finish paving + edge coping + tactile line
  b.box('paving', x0, y - 0.05, za + (side > 0 ? 0.35 : 0), x1, y, zb - (side < 0 ? 0.35 : 0), 4);
  const ze = zEdge, zi = zEdge + side * 0.35;
  b.cbox('stone_sill', x0, y - 0.28, Math.min(ze, zi) - (side > 0 ? 0.03 : 0), x1, y, Math.max(ze, zi) + (side < 0 ? 0.03 : 0), 0.01, false);
  b.box('steel_yellow', x0 + 0.3, y, Math.min(zEdge + side * 0.6, zEdge + side * 1.0), x1 - 0.3, y + 0.006, Math.max(zEdge + side * 0.6, zEdge + side * 1.0), 4 | 16 | 32);
  // under-edge recess (refuge) in the platform face
  b.box('stone_dark', x0, yb, ze + side * 0.3, x1, y - 0.28, ze + side * 0.32, side > 0 ? 32 : 16);
  if (b.collecting) {
    b.colQuad(x0, y, zb, x1, y, zb, x1, y, za, x0, y, za);
    b.colBox(x0, bottom, Math.min(ze, ze + side * 0.3), x1, y, Math.max(ze, ze + side * 0.3));
  }
  if (T.elevated) {
    // white columns under the deck down to the terrain
    const n = Math.max(2, Math.round((x1 - x0) / 12));
    for (let i = 0; i <= n; i++) {
      const x = x0 + 1 + ((x1 - x0 - 2) * i) / n, z = (za + zb) / 2;
      K.columnRound(b, 'ceramic_white', x, z, T.groundTrack - 0.2, y - 0.65, 0.35, { baseKey: 'concrete' });
      if (b.collecting) b.colBox(x - 0.35, T.groundTrack, z - 0.35, x + 0.35, y - 0.65, z + 0.35);
    }
  }
  // end railings + outer guard (far platform: glass screen)
  const rail = (pts) => K.railing(b, pts, y, { kind: 'glass', key: 'aluminium', startH: 0.0 });
  rail([[x0 + 0.1, za + 0.1], [x0 + 0.1, zb - 0.1]]);
  rail([[x1 - 0.1, za + 0.1], [x1 - 0.1, zb - 0.1]]);
  if (b.collecting) { b.colBox(x0, y, za, x0 + 0.2, y + 1.1, zb); b.colBox(x1 - 0.2, y, za, x1, y + 1.1, zb); }
  if (o.outerRail) {
    // outer guard rail, open where the platform meets the hall's platform doors (o.railGap x ranges)
    const segs = [];
    let xs = x0 + 0.1;
    for (const [g0, g1] of (o.railGap || []).slice().sort((p, q) => p[0] - q[0])) { if (g0 > xs + 0.3) segs.push([xs, Math.min(g0, x1 - 0.1)]); xs = Math.max(xs, g1); }
    if (x1 - 0.1 > xs + 0.3) segs.push([xs, x1 - 0.1]);
    for (const [a0, a1] of segs) {
      rail([[a0, zOut - side * 0.1], [a1, zOut - side * 0.1]]);
      if (b.collecting) b.colBox(a0, y, Math.min(zOut, zOut - side * 0.2), a1, y + 1.1, Math.max(zOut, zOut - side * 0.2));
    }
  }
  // benches + bins + blank sign boxes along the platform middle line
  const zm = (za + zb) / 2 + side * 0.4;
  for (let x = x0 + 9; x < x1 - 6; x += 18) {
    if (o.skipX && o.skipX.some(([a, c]) => x > a - 2 && x < c + 2)) continue;
    K.bench(b, x, y, zm, side > 0 ? Math.PI : 0);
    b.cylinder('steel_dark', x + 1.6, y, zm, 0.22, 0.85, 12, { top: true });
  }
}

function platformCanopy(ctx, L, o) {
  const b = ctx.b, T = L.T, inst = ctx.inst;
  const { x0, x1, za, zb } = o;              // covered band
  const y = T.platY, h = o.h ?? 4.6;
  const zc = (za + zb) / 2, W = zb - za;
  const n = Math.max(2, Math.round((x1 - x0) / 12));
  const yTop = y + h;
  // columns (slightly tapered white steel) on the platform centreline, cantilever arms both ways
  for (let i = 0; i <= n; i++) {
    const x = x0 + 1.2 + ((x1 - x0 - 2.4) * i) / n;
    if (o.skipX && o.skipX.some(([a, c]) => x > a - 1 && x < c + 1)) continue;
    b.withTint(inst.bandTint, () => {
      b.lathe('ceramic_band', [[0.2, 0], [0.2, 0.06], [0.16, 0.12], [0.13, h - 0.5], [0.18, h - 0.3]], 14, { x, y, z: zc + (o.colOff || 0) });
      // curved rib across the canopy
      const pts = [];
      for (let k = 0; k <= 10; k++) { const t = k / 10; const z = za - 0.3 + (W + 0.6) * t; pts.push([x, yTop - 0.42 + Math.sin(t * Math.PI) * 0.35 - Math.abs(t - 0.5) * 0.3, z]); }
      b.sweep('ceramic_band', pts, [[-0.09, -0.32], [0.09, -0.32], [0.09, 0], [-0.09, 0]], { smoothAngle: 40 });
    });
    if (b.collecting) b.colBox(x - 0.2, y, zc + (o.colOff || 0) - 0.2, x + 0.2, yTop - 0.4, zc + (o.colOff || 0) + 0.2);
  }
  // roof: PV-glass panels between white edge beams, slight arch across
  const segs = 8;
  const yr = (t) => yTop - 0.42 + Math.sin(t * Math.PI) * 0.35 - Math.abs(t - 0.5) * 0.3 + 0.02;
  const nx = Math.max(1, Math.floor((x1 - x0) / 1.72));
  const px = (x1 - x0) / nx;
  for (let k = 0; k < segs; k++) {
    const ta = k / segs, tb = (k + 1) / segs;
    const zA = za - 0.3 + (W + 0.6) * ta, zB = za - 0.3 + (W + 0.6) * tb;
    const yA = yr(ta), yB = yr(tb);
    const glass = k > 0 && k < segs - 1;
    for (let i = 0; i < nx; i++) {
      const xa = x0 + i * px, xb = xa + px;
      if (glass) b.quad('solar_panel', xa + 0.02, yA, zA, xa + 0.02, yB, zB, xb - 0.02, yB, zB, xb - 0.02, yA, zA, [0, 0, 0, 1, 1, 1, 1, 0]);
    }
    if (!glass) b.withTint(inst.bandTint, () => b.quad('ceramic_band', x0, yA, zA, x0, yB, zB, x1, yB, zB, x1, yA, zA));
    // soffit
    b.quad('render_white', x1, yA - 0.06, zA, x1, yB - 0.06, zB, x0, yB - 0.06, zB, x0, yA - 0.06, zA);
  }
  // edge fascias (white, rounded) along both long edges + ends
  b.withTint(inst.bandTint, () => {
    // (o.joinL / o.joinR: another canopy continues at that end — no overhang, the fascias abut instead of overlapping)
    for (const [z, sg] of [[za - 0.3, -1], [zb + 0.3, 1]]) b.cbox('ceramic_band', x0 - (o.joinL ? 0 : 0.15), yr(sg < 0 ? 0 : 1) - 0.32, z - (sg < 0 ? 0.12 : 0), x1 + (o.joinR ? 0 : 0.15), yr(sg < 0 ? 0 : 1) + 0.06, z + (sg > 0 ? 0.12 : 0), 0.04);
  });
  // downlights + two continuous linear luminaires in the soffit (night-gated: the canopy reads as a lit
  // band at dusk, §1 "客运站的顶棚透光") + limited cyan wayfinding strip on the track-side fascia
  for (let x = x0 + 3; x < x1 - 2; x += 6) b.cylinder('light_warm', x, yTop - 0.75, zc, 0.11, 0.008, 12, { top: false, bottom: true });
  for (const f of [0.27, 0.73]) {
    const zs = za - 0.3 + (W + 0.6) * f, ys = yr(f) - 0.075;
    b.quad('light_warm', x1 - 1.0, ys, zs - 0.08, x1 - 1.0, ys, zs + 0.08, x0 + 1.0, ys, zs + 0.08, x0 + 1.0, ys, zs - 0.08);
    b.box('aluminium', x0 + 0.95, ys, zs - 0.12, x1 - 0.95, ys + 0.014, zs + 0.12, 1 | 2 | 16 | 32);
  }
  // luminous ridge rooflight (frosted strip lit from below, night-gated): the platforms read as lit lines from above
  const yc = yr(0.5) + 0.035;
  b.quad('light_warm', x0 + 0.6, yc, zc - 0.2, x0 + 0.6, yc, zc + 0.2, x1 - 0.6, yc, zc + 0.2, x1 - 0.6, yc, zc - 0.2);
  b.box('aluminium', x0 + 0.55, yc - 0.03, zc - 0.26, x1 - 0.55, yc + 0.012, zc - 0.2, 1 | 2 | 4 | 16 | 32);
  b.box('aluminium', x0 + 0.55, yc - 0.03, zc + 0.2, x1 - 0.55, yc + 0.012, zc + 0.26, 1 | 2 | 4 | 16 | 32);
  const ze = o.trackSide > 0 ? zb + 0.31 : za - 0.31;
  cyanStrip(b, x0 + 2, ze, x1 - 2, ze, yr(o.trackSide > 0 ? 1 : 0) - 0.2, { t: 0.03 });
  // hanging blank sign boxes
  let k = 0;
  for (let x = x0 + 14; x < x1 - 10; x += 26, k++) {
    b.box('steel_dark', x - 0.02, yTop - 1.6, zc - 0.02, x + 0.02, yTop - 0.75, zc + 0.02, 63);
    // two-sided platform sign: exit arrow / train pictogram + station name glyphs (QQ-13: no blank light boxes)
    lightBox(b, x, yTop - 2.1, 2.2, 0.5, zc + 0.08, { twoSided: true, depth: 0.16, picto: k % 2 ? 'train' : 'arrow', dir: x < (x0 + x1) / 2 ? -1 : 1, rows: 1, seed: (ctx.spec.hash + k * 13 + Math.round(zc)) >>> 0 });
  }
}


// ---------------------------------------------------------------------------------------------
// Z03 sculptural shell roof: parallel white barrel shells running front→back over the hall, the centre
// one wider and taller; each projects over the forecourt as a cantilevered visor whose tip lifts (the
// entrance canopy that reads from the street) and over the platform at the back; glazed fans fill the
// arches in the front / back facades; valley gutters + white valley girders (spanning facade to facade,
// carried by white columns in the facade line); soffit light lines (night-gated) along every shell.
// ---------------------------------------------------------------------------------------------
/** Shell list for a hall x0..x1 (deterministic from the layout). */
function shellSet(L, hx0, hx1) {
  const Lh = hx1 - hx0;
  const wts = L.main ? [0.16, 0.2, 0.28, 0.2, 0.16] : [0.3, 0.4, 0.3];
  const n = wts.length, mid = (n - 1) / 2;
  const out = [];
  let x = hx0;
  for (let i = 0; i < n; i++) {
    const span = Lh * wts[i];
    const c = Math.abs(i - mid) < 0.1, edge = i === 0 || i === n - 1;
    out.push({
      xa: x, xb: x + span, i, centre: c, edge, side: i < mid ? -1 : i > mid ? 1 : 0,
      rise: Math.min(c ? 7.5 : 5.2, span * (c ? 0.3 : 0.26)),
      ovF: c ? (L.main ? 11 : 8.5) : edge && n > 3 ? 3.2 : 5.0,
      ovB: L.T.elevated ? 0.6 : 2.6,                 // elevated: the Z03 arch rises 1.5 m behind the back wall
      lift: c ? 2.4 : 1.2,
      // outermost shells continue 1.4 m past the side walls and turn down (wing edge)
      extL: i === 0 ? 1.4 : 0, extR: i === n - 1 ? 1.4 : 0,
    });
    x += span;
  }
  return out;
}

/** Cross-section of shell sh: height of the outer surface above the spring line at x (the wing edge turns down). */
function archY(sh, x) {
  const xm = (sh.xa + sh.xb) / 2, hw = (sh.xb - sh.xa) / 2;
  const q = (x - xm) / hw, aq = Math.abs(q);
  return aq <= 1 ? sh.rise * (1 - Math.pow(aq, 2.3)) : -sh.rise * 1.8 * (aq - 1) * (aq - 1) * 6;
}
/** Outer-surface height of shell sh at (x, z) (building frame). */
function shellY(sh, ys, hz0, hz1, x, z) {
  let lift = 0;
  if (z > hz1) lift = sh.lift * Math.pow(Math.min(1, (z - hz1) / sh.ovF), 1.7);
  else if (z < hz0) lift = sh.lift * 0.35 * Math.pow(Math.min(1, (hz0 - z) / sh.ovB), 1.7);
  return ys + archY(sh, x) + lift;
}

// shell cladding (QQ2-04): open-joint white ceramic rainscreen. Modules ≈ 2.4 m across (two 1.2 m tiles) × 1.8 m along
// (three 0.6 m courses), laid on the arc length of the cross-section; each module has its own glaze tone and UVs on the
// ceramic tile grid (tile joints / tone mosaic up close, roughness from the texture); 24 mm open joints show a dark
// backing 30 mm down (the joint lines read to ~100 m) and every module edge has a cheek down to it.
const SH_G = 0.024, SH_JD = 0.05;
/** Arc-length table of the cross-section over [xa, xb] (the section is the same at every z). */
function arcTable(sh, xa, xb) {
  const n = 720, X = new Float64Array(n + 1), S = new Float64Array(n + 1);
  let px = xa, py = archY(sh, xa), s = 0;
  X[0] = xa;
  for (let i = 1; i <= n; i++) { const x = xa + ((xb - xa) * i) / n, y = archY(sh, x); s += Math.hypot(x - px, y - py); X[i] = x; S[i] = s; px = x; py = y; }
  const sOf = (x) => { const f = clamp(((x - xa) / (xb - xa)) * n, 0, n); const i = Math.min(n - 1, Math.floor(f)); return S[i] + (S[i + 1] - S[i]) * (f - i); };
  const xOf = (sv) => {
    if (sv <= 0) return xa;
    if (sv >= s) return xb;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] < sv) lo = m; else hi = m; }
    return X[lo] + ((X[hi] - X[lo]) * (sv - S[lo])) / Math.max(1e-9, S[hi] - S[lo]);
  };
  return { S: s, sOf, xOf };
}
/** Deterministic 0..1 from integers (module tones). */
function h01(a, b, c, d) { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519) + Math.imul(d | 0, 3266489917)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
/** Quad a,b,c,d (ring) into part p with the face normal turned towards `out` (explicit uvs: metres along the ring). */
function ringQuad(b, p, A, B, C, D, out) {
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) return;
  nx /= l; ny /= l; nz /= l;
  const flip = nx * out[0] + ny * out[1] + nz * out[2] < 0;
  const L = Math.hypot(ux, uy, uz), H = Math.hypot(vx, vy, vz);
  const sg = flip ? -1 : 1;
  const a = b.vert(p, A[0], A[1], A[2], nx * sg, ny * sg, nz * sg, 0, 0), c1 = b.vert(p, B[0], B[1], B[2], nx * sg, ny * sg, nz * sg, L, 0);
  const c2 = b.vert(p, C[0], C[1], C[2], nx * sg, ny * sg, nz * sg, L, H), d = b.vert(p, D[0], D[1], D[2], nx * sg, ny * sg, nz * sg, 0, H);
  if (flip) b.q(p, a, d, c2, c1); else b.q(p, a, c1, c2, d);
}

function shellRoof(ctx, L, o) {
  const b = ctx.b, inst = ctx.inst, s = ctx.spec;
  const { hz0, hz1, ys, shells } = o;
  const hx0 = o.hx0 ?? -Infinity, hx1 = o.hx1 ?? Infinity;
  const t = 0.42;                                   // shell thickness at the edges
  const full = ctx.full;
  const pS = b.part('render_white');
  const pP = b.part('ceramic_white'), pB = b.part('stone_dark');
  const bt = inst.bandTint;
  const lb = o.lit;
  for (const sh of shells) {
    const xa = sh.xa - sh.extL, xb = sh.xb + sh.extR;
    const z0 = hz0 - sh.ovB, z1 = hz1 + sh.ovF;
    // x lattice: 24 steps over the arch + 8 over each wing extension (the turn-down is tight: chord sag < 1 cm, so the
    // modules never dip into the backing 30 mm below them)
    const xs = [];
    if (sh.extL > 0) for (let k = 0; k < 8; k++) xs.push(xa + (sh.extL * k) / 8);
    for (let k = 0; k <= 24; k++) xs.push(sh.xa + ((sh.xb - sh.xa) * k) / 24);
    if (sh.extR > 0) for (let k = 1; k <= 8; k++) xs.push(sh.xb + (sh.extR * k) / 8);
    const Y = (x, z) => shellY(sh, ys, hz0, hz1, x, z);
    const N = (x, z) => {
      const e = 0.05;
      const dx = (Y(x + e, z) - Y(x - e, z)) / (2 * e), dz = (Y(x, z + e) - Y(x, z - e)) / (2 * e);
      const l = Math.hypot(dx, 1, dz);
      return [-dx / l, 1 / l, -dz / l];
    };
    // thickness tapers towards the visor tip (thin sculpted edge)
    const T = (z) => (z > hz1 ? t * (1 - 0.45 * Math.min(1, (z - hz1) / sh.ovF)) : t);
    // module grid: across on the arc length, along z per zone (back overhang / hall / visor; joints on the facade lines),
    // curved zones (lift) get sub-rows so modules and backing follow the same chords
    const arc = arcTable(sh, xa, xb);
    const nS = Math.max(2, Math.round(arc.S / 2.4)), wS = arc.S / nS;
    const mods = [];
    const zSet = new Set();
    for (const [za0, zb0, curved, zone] of [[z0, hz0, true, 0], [hz0, hz1, false, 1], [hz1, z1, true, 2]]) {
      if (zb0 - za0 < 0.05) continue;
      const nZ = Math.max(1, Math.round((zb0 - za0) / 1.8)), lz = (zb0 - za0) / nZ;
      for (let m = 0; m < nZ; m++) {
        const zA = za0 + lz * m, zB = m === nZ - 1 ? zb0 : zA + lz;
        const sub = curved ? Math.max(1, Math.ceil(lz / 0.9)) : 1;
        const rows = [];
        for (let k = 0; k <= sub; k++) rows.push(zA + ((zB - zA) * k) / sub);
        mods.push({ zA, zB, lz, rows, zone, row: mods.length });
        for (const zz of rows) zSet.add(Math.round(zz * 1e4) / 1e4);
      }
    }
    const zLat = [...zSet].sort((p, q) => p - q);
    const uvm = b.uvMode;
    b.uvMode = 1;
    /** One surface of modules ('out' = extrados facing up, 'sof' = soffit facing down) over the modules in `zones`. */
    const cladding = (side, zones) => {
      const up = side === 'out';
      const surf = (x, z) => (up ? Y(x, z) : Y(x, z) - T(z));
      const inward = (x, z) => { const n = N(x, z); return up ? [-n[0], -n[1], -n[2]] : n; };
      const P = (x, z, dep = 0) => { const w = inward(x, z); return [x, surf(x, z) + w[1] * dep, z].map((v, k) => (k === 1 ? v : v + w[k] * dep)); };
      const sg = up ? 1 : -1;
      // joint floor: dark strips SH_JD inside the faces, exactly under the open joints (never behind a module)
      const floorQuad = (A, B, C, D) => ringQuad(b, pB, A, B, C, D, (() => { const n = N((A[0] + C[0]) / 2, (A[2] + C[2]) / 2); return [n[0] * sg, n[1] * sg, n[2] * sg]; })());
      const cols = [];
      for (let i = 0; i < nS; i++) {
        const sA = i * wS, sB = sA + wS;
        const sa = i === 0 ? 0 : sA + SH_G / 2, sb = i === nS - 1 ? arc.S : sB - SH_G / 2;
        const xA = arc.xOf(sa), xB = arc.xOf(sb);
        const X = [xA];
        for (const x of xs) if (x > xA + 0.03 && x < xB - 0.03) X.push(x);
        X.push(xB);
        cols.push({ sA, sB, xA, xB, X });
      }
      let prev = null;
      for (const md of mods) {
        if (!zones.includes(md.zone)) { prev = null; continue; }
        // modules run to the shell ends and (soffit) to the facade lines, where another surface takes over
        const atZ0 = md.zA <= z0 + 1e-4 || (!up && md.zone === 2 && md.zA <= hz1 + 1e-4);
        const atZ1 = md.zB >= z1 - 1e-4 || (!up && md.zone === 0 && md.zB >= hz0 - 1e-4);
        const za = atZ0 ? md.zA : md.zA + SH_G / 2, zb = atZ1 ? md.zB : md.zB - SH_G / 2;
        const Z = [za];
        for (const z of md.rows) if (z > za + 0.03 && z < zb - 0.03) Z.push(z);
        Z.push(zb);
        for (let i = 0; i < nS; i++) {
          const { sA, xA, xB, X } = cols[i];
          // glaze tone per module (± 3 %) on top of the texture's tile mosaic; tile grid offset per module row
          const k = 1 + (h01(s.hash, sh.i * 7 + (up ? 0 : 3), i, md.row) - 0.5) * 0.06;
          b.pushTint(bt[0] * k, bt[1] * k, bt[2] * k);
          const vOff = 0.6 * ((md.row * 3 + i) % 4);
          const g = Z.map((z) => X.map((x) => {
            const n = N(x, z);
            return b.vert(pP, x, surf(x, z), z, n[0] * sg, n[1] * sg, n[2] * sg, (arc.sOf(x) - sA) * (2.4 / wS), vOff + ((z - md.zA) * 1.8) / md.lz);
          }));
          for (let j = 0; j < Z.length - 1; j++) for (let kx = 0; kx < X.length - 1; kx++) {
            if (up) b.q(pP, g[j][kx], g[j + 1][kx], g[j + 1][kx + 1], g[j][kx + 1]);
            else b.q(pP, g[j][kx], g[j][kx + 1], g[j + 1][kx + 1], g[j + 1][kx]);
          }
          // cheeks down to the joint floor on every jointed edge (shell edges are closed by the edge strips)
          if (i > 0) for (let j = 0; j < Z.length - 1; j++) ringQuad(b, pP, P(xA, Z[j]), P(xA, Z[j + 1]), P(xA, Z[j + 1], SH_JD), P(xA, Z[j], SH_JD), [-1, 0, 0]);
          if (i < nS - 1) for (let j = 0; j < Z.length - 1; j++) ringQuad(b, pP, P(xB, Z[j]), P(xB, Z[j + 1]), P(xB, Z[j + 1], SH_JD), P(xB, Z[j], SH_JD), [1, 0, 0]);
          if (!atZ0) for (let kx = 0; kx < X.length - 1; kx++) ringQuad(b, pP, P(X[kx], za), P(X[kx + 1], za), P(X[kx + 1], za, SH_JD), P(X[kx], za, SH_JD), [0, 0, -1]);
          if (!atZ1) for (let kx = 0; kx < X.length - 1; kx++) ringQuad(b, pP, P(X[kx], zb), P(X[kx + 1], zb), P(X[kx + 1], zb, SH_JD), P(X[kx], zb, SH_JD), [0, 0, 1]);
          b.popTint();
        }
        b.pushTint(0.55, 0.55, 0.56);
        // longitudinal joints of this row
        for (let i = 0; i < nS - 1; i++) {
          const xl = cols[i].xB, xr = cols[i + 1].xA;
          for (let j = 0; j < Z.length - 1; j++) floorQuad(P(xl, Z[j], SH_JD), P(xr, Z[j], SH_JD), P(xr, Z[j + 1], SH_JD), P(xl, Z[j + 1], SH_JD));
        }
        // transverse joint to the previous row (+ the crossings)
        if (prev && !prev.atZ1 && !atZ0) {
          const zp = prev.zb;
          for (let i = 0; i < nS; i++) {
            const X = cols[i].X;
            for (let kx = 0; kx < X.length - 1; kx++) floorQuad(P(X[kx], zp, SH_JD), P(X[kx + 1], zp, SH_JD), P(X[kx + 1], za, SH_JD), P(X[kx], za, SH_JD));
            if (i < nS - 1) { const xl = cols[i].xB, xr = cols[i + 1].xA; floorQuad(P(xl, zp, SH_JD), P(xr, zp, SH_JD), P(xr, za, SH_JD), P(xl, za, SH_JD)); }
          }
        }
        b.popTint();
        prev = { zb, atZ1 };
      }
    };
    cladding('out', [0, 1, 2]);
    cladding('sof', [0, 2]);              // soffits outside the hall: back overhang + front visor
    b.uvMode = uvm;
    // soffit over the hall: 'full' (QQ-13) interior plaster lit by the hall luminaires — brightest along the two light
    // lines and the crown light, falling off towards the springing and the end walls; 'exterior' white render (behind
    // interior-mapped glass). Wing strips outside the side walls are exterior render at every LOD.
    b.pushTint(bt);
    const xmS = (sh.xa + sh.xb) / 2, hwS = (sh.xb - sh.xa) / 2;
    const lum = (x, z) => {
      const q = Math.abs((x - xmS) / hwS);
      const peak = Math.max(Math.exp(-Math.pow((q - 0.42) / 0.2, 2)), 0.8 * Math.exp(-Math.pow(q / 0.16, 2)));
      const along = 0.82 + 0.18 * Math.sin(Math.PI * clamp((z - hz0) / (hz1 - hz0), 0, 1));
      return (0.4 + 0.6 * peak) * along * (q > 1 ? 0.5 : 1);
    };
    const pI = full ? b.part('plaster') : null;
    const zh = zLat.filter((z) => z >= hz0 - 1e-4 && z <= hz1 + 1e-4);
    const inHall = (x) => x > hx0 + 0.2 && x < hx1 - 0.2;
    const gS = [], gI = [];
    for (const z of zh) {
      const rowS = [], rowI = [];
      for (const x of xs) {
        const y = Y(x, z) - T(z), n = N(x, z);
        rowS.push(b.vert(pS, x, y, z, -n[0], -n[1], -n[2], x, z));
        if (pI) {
          const l = lum(x, z);
          b.tint(0.97 * l, 0.965 * l, 0.95 * l);
          b.setExtraFn('idl', (X, Yy, Z, NX, NY, NZ, d, oo) => { d[oo] = 0.72; });
          rowI.push(b.vert(pI, x, y - 0.004, z, -n[0], -n[1], -n[2], x, z));
          b.setExtraFn('idl', null);
          b.tint(bt);
        } else rowI.push(-1);
      }
      gS.push(rowS); gI.push(rowI);
    }
    for (let j = 0; j < zh.length - 1; j++) for (let k = 0; k < xs.length - 1; k++) {
      if (pI && inHall((xs[k] + xs[k + 1]) / 2)) b.q(pI, gI[j][k], gI[j][k + 1], gI[j + 1][k + 1], gI[j + 1][k]);
      else b.q(pS, gS[j][k], gS[j][k + 1], gS[j + 1][k + 1], gS[j + 1][k]);
    }
    // edge strips: front + back (along x) and both sides (along z)
    for (let k = 0; k < xs.length - 1; k++) {
      const xA = xs[k], xB = xs[k + 1];
      b.quad('ceramic_band', xA, Y(xA, z1) - T(z1), z1, xB, Y(xB, z1) - T(z1), z1, xB, Y(xB, z1), z1, xA, Y(xA, z1), z1);
      b.quad('ceramic_band', xB, Y(xB, z0) - T(z0), z0, xA, Y(xA, z0) - T(z0), z0, xA, Y(xA, z0), z0, xB, Y(xB, z0), z0);
    }
    for (let j = 0; j < zLat.length - 1; j++) {
      const zA = zLat[j], zB = zLat[j + 1];
      b.quad('ceramic_band', xa, Y(xa, zA) - T(zA), zA, xa, Y(xa, zB) - T(zB), zB, xa, Y(xa, zB), zB, xa, Y(xa, zA), zA);
      b.quad('ceramic_band', xb, Y(xb, zB) - T(zB), zB, xb, Y(xb, zA) - T(zA), zA, xb, Y(xb, zA), zA, xb, Y(xb, zB), zB);
    }
    b.popTint();
    // edge trims (matte silver nosing): front / back edges = L-section capping the edge (lip 6 cm over the modules,
    // leg 2.5 cm proud of the edge face); side edges = flat cover strip over the top of the edge face
    const nosing = [[-0.06, 0.006], [0.004, 0.006], [0.004, -0.15], [0.028, -0.15], [0.028, 0.03], [-0.06, 0.03]];   // CCW (s out, u up)
    const strip = [[0.004, -0.15], [0.028, -0.15], [0.028, 0.03], [0.004, 0.03]];
    b.sweep('aluminium', xs.map((x) => [x, Y(x, z1), z1]), nosing, { smoothAngle: 50, caps: true });
    b.sweep('aluminium', xs.slice().reverse().map((x) => [x, Y(x, z0), z0]), nosing, { smoothAngle: 50, caps: true });
    // wing edges (outermost shells): cover strip along the whole edge (valley edges meet the neighbour shell)
    if (sh.extL > 0) b.sweep('aluminium', zLat.map((z) => [xa, Y(xa, z), z]), strip, { smoothAngle: 50, caps: true });
    if (sh.extR > 0) b.sweep('aluminium', zLat.slice().reverse().map((z) => [xb, Y(xb, z), z]), strip, { smoothAngle: 50, caps: true });
    // crown roof light: a frosted strip along the shell crest over the hall (daylight + night glow from above) in a
    // silver upstand frame
    const xm = (sh.xa + sh.xb) / 2, cw = Math.min(1.6, (sh.xb - sh.xa) * 0.07);
    K.clearGlassRoom(b);
    b.quad('glass_frosted', xm - cw, Y(xm - cw, hz0 + 1) + 0.03, hz0 + 1, xm - cw, Y(xm - cw, hz1 - 1) + 0.03, hz1 - 1, xm + cw, Y(xm + cw, hz1 - 1) + 0.03, hz1 - 1, xm + cw, Y(xm + cw, hz0 + 1) + 0.03, hz0 + 1);
    b.quad('light_warm', xm - 0.22, Y(xm, hz0 + 1.2) + 0.05, hz0 + 1.2, xm - 0.22, Y(xm, hz1 - 1.2) + 0.05, hz1 - 1.2, xm + 0.22, Y(xm, hz1 - 1.2) + 0.05, hz1 - 1.2, xm + 0.22, Y(xm, hz0 + 1.2) + 0.05, hz0 + 1.2);
    {
      const yc = Y(xm, (hz0 + hz1) / 2), ye = Y(xm - cw - 0.07, (hz0 + hz1) / 2);
      for (const sgn of [-1, 1]) b.box('aluminium', xm + sgn * cw, ye - 0.05, hz0 + 0.93, xm + sgn * (cw + 0.07), yc + 0.09, hz1 - 0.93, 63 & ~8);
      for (const zc of [hz0 + 0.93, hz1 - 0.93]) b.box('aluminium', xm - cw, yc - 0.05, zc - 0.035, xm + cw, yc + 0.09, zc + 0.035, 63 & ~8);
    }
    // soffit light lines (two per shell) running the full length incl. the visor (night-gated)
    for (const f of [-0.42, 0.42]) {
      const xl = xm + f * (sh.xb - sh.xa) / 2;
      for (let j = 0; j < zLat.length - 1; j++) {
        const zA = zLat[j], zB = zLat[j + 1];
        const yA = Y(xl, zA) - T(zA) - 0.016, yB = Y(xl, zB) - T(zB) - 0.016;
        b.quad('light_warm', xl + 0.07, yA, zA, xl + 0.07, yB, zB, xl - 0.07, yB, zB, xl - 0.07, yA, zA);
      }
    }
    // fan glazing filling the arch in the front and back facade planes (ys → soffit)
    for (const [zf, front] of [[hz1 - 0.12, true], [hz0 + 0.12, false]]) {
      const n = Math.max(6, Math.round((sh.xb - sh.xa) / 1.6));
      const gk = full ? 'glass_clear' : 'glass_shop';
      for (let k = 0; k < n; k++) {
        const xA = sh.xa + ((sh.xb - sh.xa) * k) / n, xB = sh.xa + ((sh.xb - sh.xa) * (k + 1)) / n;
        const hA = Y(xA, zf) - t - 0.04, hB = Y(xB, zf) - t - 0.04;
        if (hA - ys < 0.05 && hB - ys < 0.05) continue;
        const g3 = Math.floor(k / 3), sw = (sh.xb - sh.xa) / n;
        K.setGlassRoom(b, { u0: (k - g3 * 3) * sw + 0.2, w: 3 * sw + 0.4, d: 9, h: sh.rise + 0.9, sill: 0.15, kind: kindCode('lobby'), seed: (0.37 + sh.i * 0.11 + g3 * 0.173) % 1, floor: 0, bay: lb[(sh.i * 2 + (front ? 0 : 1)) % lb.length], hash: s.hash, profile: s._profile | 0 }, 0, 0);
        if (front) b.quad(gk, xA, ys, zf, xB, ys, zf, xB, Math.max(ys, hB), zf, xA, Math.max(ys, hA), zf, [0, 0, xB - xA, 0, xB - xA, hB - ys, 0, hA - ys]);
        else b.quad(gk, xB, ys, zf, xA, ys, zf, xA, Math.max(ys, hA), zf, xB, Math.max(ys, hB), zf, [0, 0, xB - xA, 0, xB - xA, hA - ys, 0, hB - ys]);
        K.clearGlassRoom(b);
        if (k > 0 && k % 2 === 0) b.box('aluminium', xA - 0.045, ys, zf - 0.08, xA + 0.045, hA + 0.02, zf + 0.08, 1 | 2 | 16 | 32);
      }
      b.box('aluminium', sh.xa + 0.012, ys - 0.06, zf - 0.1, sh.xb - 0.012, ys + 0.06, zf + 0.1, 63);
    }
  }
  // valleys between shells: box gutter on top, white girder below (facade to facade), white columns at the facades
  const zm = (hz0 + hz1) / 2;
  /** Downpipe from yTop down to a shoe + drain grate at yBot (x, z; shoe points along sz). */
  const downpipe = (x, z, yTop, yBot, sz, stays) => {
    if (yTop - yBot < 0.8) return;
    b.cylinder('aluminium', x, yBot + 0.24, z, 0.075, yTop - yBot - 0.24, 12, { top: false, bottom: false });
    b.box('aluminium', x - 0.075, yBot + 0.04, Math.min(z, z + sz * 0.32), x + 0.075, yBot + 0.26, Math.max(z, z + sz * 0.32), 63 & ~8);
    b.box('grille_dark', x - 0.16, yBot + 0.006, z + sz * 0.3 - 0.16, x + 0.16, yBot + 0.016, z + sz * 0.3 + 0.16, 4 | 1 | 2 | 16 | 32);
    for (const st of stays || []) b.box('aluminium', Math.min(x, st.x), st.y - 0.025, z - 0.02, Math.max(x, st.x), st.y + 0.025, z + 0.02, 63);
  };
  for (let i = 0; i < shells.length - 1; i++) {
    const A = shells[i], B = shells[i + 1], xv = A.xb;
    // gutter (QQ2-04): aluminium box gutter in the valley with a dark grating flush over it, top 2 cm above the module
    // faces 0.25 m either side of the valley line; at both facade lines it drains through the shell into downpipes beside
    // the facade columns (water off the visors runs back down to it: the visor tips lift)
    const yv = Math.max(shellY(A, ys, hz0, hz1, xv - 0.25, zm), shellY(B, ys, hz0, hz1, xv + 0.25, zm));
    b.box('aluminium', xv - 0.27, ys - 0.08, hz0 - 0.3, xv + 0.27, yv + 0.02, hz1 + 0.3, 63 & ~8);
    b.box('grille_dark', xv - 0.22, yv + 0.026, hz0 - 0.25, xv + 0.22, yv + 0.036, hz1 + 0.25, 4 | 1 | 2 | 16 | 32);
    b.withTint(inst.bandTint, () => {
      b.cbox('ceramic_band', xv - 0.32, ys - t - 1.05, hz0 - 0.2, xv + 0.32, ys - t + 0.01, hz1 + 0.2, 0.06, true);
      for (const zc of [hz1 + 0.55, hz0 - 0.55]) K.columnRound(b, 'ceramic_white', xv, zc, L.ffl, ys - t - 1.05, 0.34, { baseKey: 'stone_plinth' });
    });
    if (b.collecting) for (const zc of [hz1 + 0.55, hz0 - 0.55]) b.colBox(xv - 0.34, L.ffl, zc - 0.34, xv + 0.34, ys, zc + 0.34);
    for (const [zc, sz] of [[hz1 + 0.55, 1], [hz0 - 0.55, -1]]) {
      const xp = xv + 0.5;
      // the pipe rises into the shell underside (internal outlet from the gutter end)
      const TB = zc > hz1 ? t * (1 - 0.45 * Math.min(1, (zc - hz1) / B.ovF)) : t;
      const yTop = shellY(B, ys, hz0, hz1, xp, zc) - TB + 0.06, yBot = L.ffl, stays = [];
      for (let y = yBot + 2.2; y < yTop - 0.6; y += 2.6) stays.push({ x: xv + 0.3, y });
      downpipe(xp, zc, yTop, yBot, sz, stays);
    }
  }
  // wing-edge gutters on the outermost shells (water off their outer halves) over the hall length, each with two
  // downpipes near the hall corners stayed back to the side wall
  for (const [sh, sg] of [[shells[0], -1], [shells[shells.length - 1], 1]]) {
    if (!sh || !((sg < 0 ? sh.extL : sh.extR) > 0)) continue;
    const xe = sg < 0 ? sh.xa - sh.extL : sh.xb + sh.extR, xw = sg < 0 ? sh.xa : sh.xb;
    const ye = shellY(sh, ys, hz0, hz1, xe, zm) - t;          // drip edge (bottom of the edge face)
    b.box('aluminium', Math.min(xe + sg * 0.01, xe + sg * 0.23), ye - 0.08, hz0 - 0.4, Math.max(xe + sg * 0.01, xe + sg * 0.23), ye + 0.1, hz1 + 0.4, 63);
    b.box('aluminium_dark', Math.min(xe + sg * 0.03, xe + sg * 0.21), ye + 0.1, hz0 - 0.38, Math.max(xe + sg * 0.03, xe + sg * 0.21), ye + 0.106, hz1 + 0.38, 4);
    for (const zc of [hz1 - 0.5, hz0 + 0.5]) {
      const xp = xe + sg * 0.12;
      const gy = K.groundAt(s, xp, zc);
      const yTop = ye - 0.08, stays = [];
      for (const f of [0.33, 0.7]) stays.push({ x: xw, y: gy + (yTop - gy) * f });
      downpipe(xp, zc, yTop, gy, zc > zm ? 1 : -1, stays);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// circulation pieces
// ---------------------------------------------------------------------------------------------
/** Straight stair along +x (frame: current), from (x0, y0) up to y1, width wd centred on z. Returns end x. */
function stairRun(b, x0, z, y0, y1, wd, o = {}) {
  const rise = y1 - y0;
  const { n } = K.risers(rise, 0.165);
  const flights = rise > 4.2 ? 2 : 1;
  const per = Math.ceil(n / flights);
  let x = x0, y = y0;
  for (let f = 0; f < flights; f++) {
    const m = Math.min(per, n - f * per);
    const yE = y0 + (rise * (f * per + m)) / n;
    // steps(): wall frame, steps descend outward (+z): put frame so +z' = −x, u along z
    b.push(); b.translate(x + m * 0.3, 0, z - wd / 2); b.rotY(Math.PI / 2);   // local x' = −z… use frame below
    b.pop();
    b.push(); b.frame(x + m * 0.3, 0, z + wd / 2, 0, 0, -1, 0, 1, 0, -1, 0, 0);
    K.steps(b, { u0: 0, u1: wd, z0: 0, y0: y, y1: yE, key: o.key || 'stone_step', cheeks: true, cheekKey: o.cheekKey, rails: true, railKey: 'steel_brushed', buried: Math.max(0.3, yE - y0 + 0.1) - (yE - y), tread: 0.3 });
    b.pop();
    x += m * 0.3;
    y = yE;
    if (f < flights - 1) {
      b.cbox(o.key || 'stone_step', x, y - 0.3, z - wd / 2, x + 1.8, y, z + wd / 2, 0.01, true);
      if (b.collecting) b.colQuad(x, y, z + wd / 2, x + 1.8, y, z + wd / 2, x + 1.8, y, z - wd / 2, x, y, z - wd / 2);
      x += 1.8;
    }
  }
  return x;
}

/** Escalator pair along +x from (x0, y0) up to y1 (30°), width per unit 1.1 m. o.trussKey: truss cladding. */
function escalator(b, x0, z, y0, y1, o = {}) {
  const rise = y1 - y0, run = rise / Math.tan(Math.PI / 6);
  for (const dz of [-0.75, 0.75]) {
    const zc = z + dz;
    // truss body (sloped) + landing plates
    b.push(); b.translate(x0 + 1.2, y0, zc); b.rotZ(-Math.PI / 6);
    const Ls = Math.hypot(run, rise);
    b.cbox(o.trussKey || 'aluminium', 0, -0.9, -0.62, Ls, 0.0, 0.62, 0.02, true);
    b.box('grille_dark', 0, 0.001, -0.5, Ls, 0.01, 0.5, 4);
    // glass balustrades + rubber handrails
    for (const s of [-1, 1]) {
      b.box('glass_railing', 0.2, 0.05, s * 0.56 - 0.006, Ls - 0.2, 0.95, s * 0.56 + 0.006, 16 | 32);
      b.cbox('rubber', 0.1, 0.95, s * 0.56 - 0.045, Ls - 0.1, 1.02, s * 0.56 + 0.045, 0.01);
    }
    b.pop();
    b.cbox('steel_brushed', x0, y0 - 0.05, zc - 0.62, x0 + 1.25, y0 + 0.02, zc + 0.62, 0.01, false);
    b.cbox('steel_brushed', x0 + 1.15 + run, y1 - 0.05, zc - 0.62, x0 + 2.4 + run, y1 + 0.02, zc + 0.62, 0.01, false);
    b.box('light_cyan', x0 + 0.05, y0 + 0.02, zc - 0.55, x0 + 0.12, y0 + 0.03, zc + 0.55, 63);
    if (b.collecting) b.colQuad(x0 + 1.2, y0, zc + 0.62, x0 + 1.2 + run, y1, zc + 0.62, x0 + 1.2 + run, y1, zc - 0.62, x0 + 1.2, y0, zc - 0.62);
  }
  return x0 + 2.4 + run;
}

/**
 * Concourse mezzanine slab over the back of the hall with wells above the escalator / stair runs (each run arrives
 * at its well's +x end at slab level); glass balustrades along the front edge and round the wells (open at the
 * arrival ends). o: {x0, x1, z0, z1, y, t, top, wells:[{x0,x1,z0,z1}]}
 */
function mezzanine(ctx, o) {
  const b = ctx.b;
  const wells = o.wells.filter((h) => h.x1 - h.x0 > 0.5).map((h) => ({ x0: Math.max(o.x0 + 0.05, h.x0), x1: Math.min(o.x1 - 0.05, h.x1), z0: Math.max(o.z0 + 0.05, h.z0), z1: Math.min(o.z1 - 0.05, h.z1), lift: !!h.lift }));
  // 'full' (QQ2-05): the soffit over the paid concourse is an indoor plaster ceiling (lamp-lit at night like the vault)
  // with recessed downlights on a 3 m grid clear of the wells and a continuous light line along the front edge; the
  // edge fascia is plaster too (a dark concrete band read as a closed-up ground floor from the forecourt)
  const full = ctx.full, yb = o.y - o.t;
  slabWithHoles(b, { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 }, wells, yb, o.y, { top: o.top, bottom: full ? 'plaster' : 'render_white', edge: full ? 'plaster' : 'concrete_smooth' });
  if (full) {
    const lights = (ctx.mzLights = []);
    for (let x = o.x0 + 1.6; x < o.x1 - 1.0; x += 3.0) for (let z = o.z0 + 1.4; z < o.z1 - 0.8; z += 2.8) {
      if (wells.some((h) => x > h.x0 - 0.45 && x < h.x1 + 0.45 && z > h.z0 - 0.45 && z < h.z1 + 0.45)) continue;
      b.cylinder('aluminium', x, yb - 0.012, z, 0.21, 0.012, 16, { top: false, bottom: true });
      b.cylinder('light_warm', x, yb - 0.017, z, 0.16, 0.004, 16, { top: false, bottom: true });
      lights.push([x, z]);
    }
    b.box('aluminium', o.x0 + 0.6, yb - 0.05, o.z1 - 0.44, o.x1 - 0.6, yb, o.z1 - 0.2, 63 & ~4);
    b.box('light_warm', o.x0 + 0.7, yb - 0.056, o.z1 - 0.39, o.x1 - 0.7, yb - 0.05, o.z1 - 0.25, 8);
  }
  const rail = (pts) => K.railing(b, pts, o.y, { kind: 'glass', key: 'aluminium' });
  rail([[o.x0 + 0.2, o.z1 - 0.1], [o.x1 - 0.2, o.z1 - 0.1]]);
  if (b.collecting) b.colBox(o.x0, o.y, o.z1 - 0.2, o.x1, o.y + 1.1, o.z1);
  for (const h of wells) {
    if (h.lift) continue;            // glass lift shaft through the slab: the shaft walls enclose the opening
    rail([[h.x1 - 0.05, h.z0 + 0.08], [h.x0 + 0.08, h.z0 + 0.08], [h.x0 + 0.08, h.z1 - 0.08], [h.x1 - 0.05, h.z1 - 0.08]]);
    if (b.collecting) { b.colBox(h.x0, o.y, h.z0, h.x1, o.y + 1.1, h.z0 + 0.15); b.colBox(h.x0, o.y, h.z1 - 0.15, h.x1, o.y + 1.1, h.z1); b.colBox(h.x0, o.y, h.z0, h.x0 + 0.15, o.y + 1.1, h.z1); }
  }
}

/** Glass lift shaft (Z03): aluminium frame + glass + car, from y0 to y1, footprint s×s centred at (x,z). */
function glassLift(ctx, x, z, y0, y1, s = 2.4) {
  const b = ctx.b;
  const h = y1 - y0 + 3.0;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box('aluminium', x + dx * s / 2 - 0.08, y0, z + dz * s / 2 - 0.08, x + dx * s / 2 + 0.08, y0 + h, z + dz * s / 2 + 0.08, 63 & ~8);
  const sides = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
  for (const [nx, , nz] of sides) {
    b.push(); b.frame(x + nz * s / 2 - nx * 0 + (nx ? nx * s / 2 : 0) - (nz ? 0 : 0), 0, z + (nz ? nz * s / 2 : 0), nz ? nz : 0, 0, nx ? -nx : 0, 0, 1, 0, nx, 0, nz);
    b.pop();
  }
  // glass skin (4 faces) with transoms every 3 m
  const gk = 'glass_railing';
  b.box(gk, x - s / 2 + 0.06, y0, z - s / 2 + 0.06, x + s / 2 - 0.06, y0 + h, z + s / 2 - 0.06, 1 | 2 | 16 | 32);
  for (let yy = y0 + 3; yy < y0 + h; yy += 3) b.box('aluminium', x - s / 2, yy - 0.04, z - s / 2, x + s / 2, yy + 0.04, z + s / 2, 63);
  b.cbox('aluminium', x - s / 2 - 0.1, y0 + h - 0.05, z - s / 2 - 0.1, x + s / 2 + 0.1, y0 + h + 0.41, z + s / 2 + 0.1, 0.02);   // head 6 cm above the tower canopy top (was coplanar)
  // car parked at the top level
  const yc = y1;
  b.cbox('steel_brushed', x - s / 2 + 0.2, yc - 0.15, z - s / 2 + 0.2, x + s / 2 - 0.2, yc, z + s / 2 - 0.2, 0.01);
  b.cbox('steel_brushed', x - s / 2 + 0.2, yc + 2.3, z - s / 2 + 0.2, x + s / 2 - 0.2, yc + 2.45, z + s / 2 - 0.2, 0.01);
  b.box('light_cyan', x - 0.4, yc + 2.28, z - 0.4, x + 0.4, yc + 2.3, z + 0.4, 63);
  if (b.collecting) b.colBox(x - s / 2, y0, z - s / 2, x + s / 2, y0 + h, z + s / 2);
}

/** Stair + glass lift tower (along x) from y0 up to y1 at (x, z), returns {xa, xb}. */
function accessTower(ctx, L, x, z, y0, y1, wd = 2.2) {
  const b = ctx.b, inst = ctx.inst;
  const xa = x - 1.2;
  const xe = stairRun(b, xa, z, y0, y1, wd, { key: 'stone_step' });
  // top landing to the deck / bridge
  b.cbox('stone_step', xe, y1 - 0.3, z - wd / 2, xe + 2.4, y1, z + wd / 2, 0.01, true);
  if (b.collecting) b.colQuad(xe, y1, z + wd / 2, xe + 2.4, y1, z + wd / 2, xe + 2.4, y1, z - wd / 2, xe, y1, z - wd / 2);
  glassLift(ctx, xa - 1.8, z, y0, y1, 2.2);
  // canopy roof over the stair
  b.withTint(inst.bandTint, () => b.cbox('ceramic_band', xa - 3.1, y1 + 3.0, z - wd / 2 - 0.5, xe + 2.6, y1 + 3.35, z + wd / 2 + 0.5, 0.04));
  for (const xx of [xa - 3.0, xe + 2.4]) for (const zz of [z - wd / 2 - 0.35, z + wd / 2 + 0.35]) { b.box('aluminium', xx - 0.06, y1, zz - 0.06, xx + 0.06, y1 + 3.0, zz + 0.06, 63 & ~8); }
  return { xa: xa - 3.2, xb: xe + 2.6 };
}

// ---------------------------------------------------------------------------------------------
// hall lighting ('full', QQ-13): luminaires you can see (pendant discs under the shells, wall-washer lines along the
// side walls, light lines under the valley girders) and the illuminance they give — a stone floor whose vertex tint
// carries the pools under the pendants and darkens towards the walls (indoor lamp light ∝ albedo × tint), the vault
// soffit gradient (shellRoof). Walls are white ceramic (lit by what reaches them), so the hall reads as lit volumes
// with bright cores and darker edges rather than one uniform emissive wall.
// ---------------------------------------------------------------------------------------------
function stationLights(ctx, L, o) {
  const b = ctx.b;
  const { hx0, hx1, hz0, hz1, zg, ys, shells, ffl } = o;
  const T = 0.35;
  // pendant positions: two per shell across, rows along the ticket hall (zg … hz1) and one row over the paid side
  const P = [];
  for (const sh of shells) {
    const xm = (sh.xa + sh.xb) / 2, hw = (sh.xb - sh.xa) / 2;
    const zRows = [];
    for (let z = zg + 3.0; z < hz1 - 2.0; z += 5.5) zRows.push(z);
    if (zg - hz0 > 9) zRows.push(hz0 + 9.6 + Math.min(2.5, (zg - hz0 - 9.6) / 2));
    for (const z of zRows) for (const f of (hw > 6 ? [-0.3, 0.3] : [0])) P.push([xm + f * hw, z, sh]);
  }
  const yP = ys - 1.6;
  for (const [x, z, sh] of P) {
    const yS = shellY(sh, ys, hz0, hz1, x, z) - 0.42;
    for (const dx of [-0.35, 0.35]) b.box('steel_dark', x + dx - 0.006, yP + 0.14, z - 0.006, x + dx + 0.006, yS, z + 0.006, 1 | 2 | 16 | 32);
    b.cylinder('aluminium', x, yP, z, 0.62, 0.14, 28, { top: true, bottom: false });
    b.cylinder('light_warm', x, yP - 0.003, z, 0.56, 0.003, 28, { top: false, bottom: true });
  }
  // stone floor on a 1 m grid: pools under the pendants, falloff to the walls (vertex tint; idl = glazed hall)
  const x0 = hx0 + T, x1 = hx1 - T, z0 = hz0 + T, z1 = hz1 - T;
  const nx = Math.max(2, Math.ceil((x1 - x0) / 1.0)), nz = Math.max(2, Math.ceil((z1 - z0) / 1.0));
  const pf = b.part('stone_floor');
  const MZ = ctx.mzLights || [];       // downlights in the mezzanine soffit over the paid concourse (QQ2-05)
  const lumF = (x, z) => {
    let m = 0;
    for (const [px, pz] of P) { const d2 = (x - px) * (x - px) + (z - pz) * (z - pz); m = Math.max(m, Math.exp(-d2 / (2 * 2.3 * 2.3))); }
    for (const [px, pz] of MZ) { const d2 = (x - px) * (x - px) + (z - pz) * (z - pz); m = Math.max(m, 0.9 * Math.exp(-d2 / (2 * 1.5 * 1.5))); }
    const edge = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    return (0.66 + 0.34 * m) * (0.78 + 0.22 * Math.min(1, edge / 4));
  };
  b.setExtraFn('idl', (X, Y, Z, NX, NY, NZ, d, oo) => { d[oo] = 0.7; });
  const grid = [];
  for (let i = 0; i <= nx; i++) {
    const row = [], x = x0 + ((x1 - x0) * i) / nx;
    for (let j = 0; j <= nz; j++) { const z = z0 + ((z1 - z0) * j) / nz, l = lumF(x, z); b.tint(l, l, l * 0.98); row.push(b.vert(pf, x, ffl, z, 0, 1, 0, x, z)); }
    grid.push(row);
  }
  b.setExtraFn('idl', null);
  b.tint(1, 1, 1);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) b.q(pf, grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
  if (b.collecting) b.colQuad(hx0, ffl, hz1, hx1, ffl, hz1, hx1, ffl, hz0, hx0, ffl, hz0);
  // wall-washer lines along the top of both side walls (aluminium profile + light strip facing the room)
  for (const [x, sg] of [[hx0 + T, 1], [hx1 - T, -1]]) {
    b.box('aluminium', Math.min(x, x + sg * 0.16), ys - 0.62, hz0 + 0.8, Math.max(x, x + sg * 0.16), ys - 0.5, hz1 - 0.8, 63);
    b.box('light_warm', Math.min(x + sg * 0.02, x + sg * 0.14), ys - 0.64, hz0 + 0.9, Math.max(x + sg * 0.02, x + sg * 0.14), ys - 0.62, hz1 - 0.9, 8);
  }
  // light lines under the valley girders (girder bottom: ys − 0.42 − 1.05)
  for (let i = 0; i < shells.length - 1; i++) {
    const xv = shells[i].xb, yb = ys - 0.42 - 1.05;
    b.box('light_warm', xv - 0.07, yb - 0.012, hz0 + 0.6, xv + 0.07, yb - 0.002, hz1 - 0.6, 8 | 1 | 2);
  }
  // paid concourse back wall (at grade, QQ2-05): backlit information / advertising light boxes between the platform
  // doors under the mezzanine — the lit wall the forecourt sees through the ground-floor glazing
  if (!L.T.elevated && o.backDoors) {
    const d = o.backDoors.slice().sort((p, q) => p - q);
    for (let i = 0; i < d.length - 1; i++) {
      const xa = d[i] + 2.6, xb = d[i + 1] - 2.6, w = Math.min(7.0, xb - xa);
      if (w < 2.0) continue;
      const xc = (xa + xb) / 2;
      lightBox(b, xc, ffl + 2.1, w, 2.2, hz0 + T + 0.2, { picto: i % 2 ? 'train' : 'arrow', dir: i % 2 ? 1 : -1, rows: 3, depth: 0.16, seed: (ctx.spec.hash + i * 17) >>> 0 });
      if (w > 4.2) for (const sx of [-1, 1]) { const xx = xc + sx * (w / 2 + 0.45); b.push(); b.translate(xx, 0, hz0 + T + 0.14); ledBoard(b, 0, ffl + 1.2, 0.6, 1.1, 0.0, { rows: 4, seed: (ctx.spec.hash + i * 5 + (sx > 0 ? 3 : 0)) >>> 0 }); b.pop(); }
    }
  }
}

/** Multiply the tint of the vertices emitted into part `key` since index n0 by fn(x, y, z) (building frame). */
function tintSince(b, key, n0, fn) {
  const p = b.part(key);
  for (let i = n0; i < p.n; i++) {
    const f = fn(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
    p.col[i * 3] *= f; p.col[i * 3 + 1] *= f; p.col[i * 3 + 2] *= f;
  }
}

// ---------------------------------------------------------------------------------------------
// main generator
// ---------------------------------------------------------------------------------------------
function generate(spec, lod, ctx) {
  const s = ctx.spec, st = ctx.style, b = ctx.b, inst = ctx.inst;
  const L = layout(ctx);
  const { w, d, T, ffl, Lh, halt } = L;
  const hx0 = -Lh / 2, hx1 = Lh / 2;
  const hz0 = -d / 2, hz1 = halt ? d / 2 - 2 : d / 2;
  const yPlat = T.platY;
  const full = ctx.full;
  const gk = full ? 'glass_clear' : 'glass_shop';
  // ---------------- station hall ----------------
  const eave = L.eave;
  const hD = hz1 - hz0;
  const ys = ffl + L.ysRel;                                   // shell spring line (= wall top)
  const vTop = halt ? ffl + Math.min(eave - 0.8, 6.4) : ys - 0.4;
  const rowsF = (v0) => { const r = [v0, v0 + 2.9]; if (vTop - (v0 + 2.9) > 3.4) r.push(v0 + 2.9 + (vTop - v0 - 2.9) / 2); r.push(vTop); return r; };
  const LB = litBays(s.hash, 24);
  let lbi = 0;
  const lit = () => LB[(lbi++) % LB.length];
  const front = [], back = [], left = [], right = [];
  // front: curtain glazing with three entrance groups (spec: 8 m centre, 4 m at ±0.32 w → clamped into the hall)
  const doorsU = halt ? [Lh / 2] : [Lh / 2, clamp(Lh / 2 - w * 0.32, 4, Lh / 2 - 7), clamp(Lh / 2 + w * 0.32, Lh / 2 + 7, Lh - 4)];
  const doorW = halt ? 1.8 : [6.0, 3.4, 3.4];
  const dH = 2.7;
  const fronts = [];
  let u = 0.6;
  const doorsSorted = doorsU.map((c, i) => ({ c, w: halt ? 1.8 : doorW[i] })).sort((a, c2) => a.c - c2.c);
  for (const dd of doorsSorted) {
    if (dd.c - dd.w / 2 - 0.4 - u > 1.0) fronts.push({ u0: u, u1: dd.c - dd.w / 2 - 0.4, v0: ffl, v1: vTop, kind: 'curtain', pane: 1.5, rows: rowsF(ffl), room: 'lobby', depth: hD, bay: lit(), bayRooms: true });
    front.push({ u0: dd.c - dd.w / 2, u1: dd.c + dd.w / 2, v0: ffl, v1: ffl + dH, kind: 'door', doorKind: dd.w > 2.6 ? 'glazed_double' : 'glazed' });
    // transom glazing above the doors
    fronts.push({ u0: dd.c - dd.w / 2 - 0.4 + 0.0, u1: dd.c + dd.w / 2 + 0.4, v0: ffl + dH + 0.25, v1: vTop, kind: 'curtain', pane: 1.5, rows: rowsF(ffl + dH + 0.25).filter((v, i, a) => i === 0 || v > a[0] + 1.2), room: 'lobby', depth: hD, bay: lit(), bayRooms: true });
    u = dd.c + dd.w / 2 + 0.4;
  }
  if (Lh - 0.6 - u > 1.0) fronts.push({ u0: u, u1: Lh - 0.6, v0: ffl, v1: vTop, kind: 'curtain', pane: 1.5, rows: rowsF(ffl), room: 'lobby', depth: hD, bay: lit(), bayRooms: true });
  front.push(...fronts);
  // back: glazing + platform doors (at grade) / service windows (elevated)
  // footbridge (at grade) leaves the level-1 concourse through the back wall: keep that opening clear
  const towerX0 = halt ? 0 : clamp((Lh / 2) * 0.5, -w / 2 + 14, w / 2 - 20);
  const bridgeU = !T.elevated && !halt ? [Lh / 2 - (towerX0 + 8.5) - 2.3, Lh / 2 - (towerX0 + 8.5) + 2.3] : null;
  const yBr = ffl + L.gh;
  if (!T.elevated) {
    const n = Math.max(2, Math.round(Lh / 14));
    for (let i = 0; i < n; i++) {
      const c = (Lh * (i + 0.5)) / n;
      back.push({ u0: c - 2.0, u1: c + 2.0, v0: ffl, v1: ffl + 2.6, kind: 'door', doorKind: 'glazed_double' });
      const hitsBridge = bridgeU && c + 2.0 > bridgeU[0] - 0.3 && c - 2.0 < bridgeU[1] + 0.3;
      const v1 = hitsBridge ? yBr - 0.35 : vTop;
      if (v1 - (ffl + 2.85) > 0.6) back.push({ u0: c - 2.0, u1: c + 2.0, v0: ffl + 2.85, v1, kind: 'curtain', pane: 1.33, room: 'lobby', depth: hD, bay: lit(), bayRooms: true });
    }
    if (bridgeU && !halt) back.push({ u0: bridgeU[0], u1: bridgeU[1], v0: yBr, v1: yBr + 3.1, kind: 'opening' });
  } else {
    // mezzanine (platform level) doors onto the near platform deck + glazing above; back of house below
    const yP = T.platY;
    const n = Math.max(2, Math.round(Lh / 14));
    for (let i = 0; i < n; i++) {
      const c = (Lh * (i + 0.5)) / n;
      if (yP + 2.6 < ys - 0.6) {
        back.push({ u0: c - 2.0, u1: c + 2.0, v0: yP, v1: yP + 2.6, kind: 'door', doorKind: 'glazed_double' });
        if (vTop - (yP + 2.85) > 0.6) back.push({ u0: c - 2.0, u1: c + 2.0, v0: yP + 2.85, v1: vTop, kind: 'curtain', pane: 1.33, room: 'lobby', depth: hD, bay: lit(), bayRooms: true });
      }
      back.push({ u0: c - 4.6, u1: c - 2.6, v0: ffl + 1.0, v1: Math.min(yP - 1.0, ffl + 3.4), kind: 'strip', room: 'office' });
    }
  }
  // service door + clerestory on the short sides (the service side has the back-of-house door)
  const svcSide = (s._entrances.find((e) => e.kind === 'service') || {}).side === 'right' ? 'right' : 'left';
  for (const [side, arr] of [['left', left], ['right', right]]) {
    if (side === svcSide && !halt) arr.push({ u0: hD * 0.3 - 0.7, u1: hD * 0.3 + 0.7, v0: ffl, v1: ffl + 2.3, kind: 'door', doorKind: 'service' });
    arr.push({ u0: hD * 0.55, u1: hD - 1.0, v0: ffl + 0.9, v1: halt ? ffl + Math.min(eave - 0.8, 5.5) : vTop, kind: 'curtain', pane: 1.4, room: 'lobby', depth: Lh, bay: lit(), bayRooms: true });
  }
  const nTW = full && !halt ? b.part('tile_wall').n : 0;
  // glazed hall: indoor faces see a lot of sky by day (daylight factor 0.7 instead of the default room level)
  if (full && !halt) b.setExtraFn('idl', (X, Y, Z, NX, NY, NZ, dd, oo) => { dd[oo] = 0.7; });
  const H = hall(ctx, {
    x0: hx0, x1: hx1, z0: hz0, z1: hz1, y0: ffl, eave: L.ysRel, wallKey: st.wall, wallT: 0.35, wallTint: inst.shellTint,
    sides: { front: { openings: front }, back: { openings: back }, left: { openings: left, gable: 'glass' }, right: { openings: right, gable: 'glass' } },
    roof: halt ? { kind: 'flat', key: 'ceramic_band', tint: ctx.inst.bandTint, soffitKey: 'render_white', parapet: 0.4 } : { kind: 'none' },
    frames: 0, frameKey: 'ceramic_band', floorKey: 'stone_floor', interior: true,
    // halls: white glazed-tile inner walls — an indoor surface, lamp-lit at night (QQ2-05: the outdoor ceramic key of
    // round 2 took no lamp light, so the ground floor behind the glass read as a closed dark hall), with a falloff from
    // the wall washers under the springing down to the floor (vertex tint); own floor with light pools, pendants
    innerKey: halt ? undefined : 'tile_wall', lightPanels: !!halt, noFloor: !halt,
  });
  if (full && !halt) {
    b.setExtraFn('idl', null);
    tintSince(b, 'tile_wall', nTW, (x, y) => 0.6 + 0.4 * Math.pow(clamp((y - ffl) / Math.max(1, ys - 0.6 - ffl), 0, 1), 0.8));
  }
  // Z03 shell roof over the hall (+ visors over the forecourt and the platform)
  const shells = halt ? [] : shellSet(L, hx0, hx1);
  if (!halt) shellRoof(ctx, L, { hz0, hz1, hx0, hx1, ys, shells, lit: LB });
  const roofTop = halt ? ffl + eave : Math.max(...shells.map((sh) => ys + sh.rise));
  b.withTint(inst.shellTint, () => K.plinth(b, s, ffl, { w: Lh, d: hD }));
  // ---- big curved entrance canopy over the front (ZR arch band) ----
  if (!halt) {
    const cy = ffl + Math.min(eave - 0.5, 5.6);
    b.push(); K.facadeFrame(b, 'front', Lh, hD, 0); b.translate(0, 0, 0);
    b.pop();
    b.push(); b.translate(0, 0, hz1);
    b.withTint(inst.bandTint, () => K.canopyCurved(b, { u0: hx0 + 2, u1: hx1 - 2, y: cy, depth: L.main ? 7.5 : 5.5, t: 0.5, key: st.band }));
    b.pop();
    cyanStrip(b, hx0 + 6, hz1 + 0.15, hx1 - 6, hz1 + 0.15, cy - 0.55, { t: 0.04 });
    // big blank light box over the main doors + white vertical fins on the glazing
    b.push(); K.facadeFrame(b, 'front', w, d, 0);
    lightBox(b, w / 2, cy + 0.4, Math.min(Lh * 0.35, 14), 1.4, 0.22, { picto: 'train', rows: 2, seed: s.hash, depth: 0.17 });
    b.pop();
    for (let x = hx0 + 1.5; x <= hx1 - 1.5; x += Math.max(4.5, Lh / 12)) {
      if (doorsSorted.some((dd) => Math.abs(x - (dd.c - Lh / 2)) < dd.w / 2 + 0.6)) continue;
      b.withTint(inst.bandTint, () => b.cbox('ceramic_band', x - 0.09, ffl + 0.2, hz1 + 0.02, x + 0.09, cy - 0.5, hz1 + 0.55, 0.03, false));
    }
  }
  // ---- front forecourt: steps + ramps up to the hall floor, bikes, totems, bollards ----
  const [gF0, gF1] = sideGround(s, 'front');
  const gF = (gF0 + gF1) / 2;
  b.push(); K.facadeFrame(b, 'front', w, d, 0);
  const fu0 = w / 2 + hx0, fu1 = w / 2 + hx1;
  const rise = ffl - gF;
  if (rise > 0.05) {
    // broad steps along the hall front + ramps at both ends
    b.cbox('paving_stone', fu0 - 0.5, Math.min(gF, ffl) - 0.5, 0.0, fu1 + 0.5, ffl - 0.005, halt ? 1.5 : 3.0, 0.012, false);
    if (b.collecting) b.colQuad(fu0, ffl, halt ? 1.5 : 3.0, fu1, ffl, halt ? 1.5 : 3.0, fu1, ffl, 0, fu0, ffl, 0);
    K.steps(b, { u0: fu0 + (rise > 0.6 ? 6 : 1.5), u1: fu1 - (rise > 0.6 ? 6 : 1.5), z0: halt ? 1.5 : 3.0, y0: gF, y1: ffl, key: 'stone_step', cheeks: false, rails: rise > 0.45, railKey: 'steel_brushed' });
    if (rise > 0.6) {
      const len = rise * 12;
      K.rampAlong(b, { uStart: fu0 - 0.5 - len, uEnd: fu0 - 0.5, y0: gF, y1: ffl, z0: 0.3, z1: 2.6, key: 'paving_stone', railKey: 'steel_brushed' });
      K.rampAlong(b, { uStart: fu1 + 0.5 + len, uEnd: fu1 + 0.5, y0: gF, y1: ffl, z0: 0.3, z1: 2.6, key: 'paving_stone', railKey: 'steel_brushed' });
    }
  }
  b.pop();
  if (!halt) {
    const zp = d / 2 + (rise > 0.05 ? 3.0 + Math.ceil(rise / 0.165) * 0.3 : 0) + 4.0;
    signTotem(b, hx0 - 3.5, gF, zp, 0, { w: 1.0, h: 3.0 });
    signTotem(b, hx1 + 3.5, gF, zp, 0, { w: 1.0, h: 3.0 });
    bollardLine(b, hx0 + 2, zp + 2.5, hx1 - 2, zp + 2.5, gF, 2.4);
    // bike parking under shelters beside the hall
    const bxA = Math.min(hx1 + 6, w / 2 - 16), bxB = Math.max(hx0 - 6, -w / 2 + 16);
    if (w > 70) { K.bikeShelter(b, bxA, d / 2 - 4.5, bxA + 12, d / 2 - 1.8, gF); K.bikeShelter(b, bxB - 12, d / 2 - 4.5, bxB, d / 2 - 1.8, gF); }
    for (const x of [hx0 - 10, hx1 + 10]) if (Math.abs(x) < w / 2 - 6) planterStrip(b, x - 4, d / 2 - 1.2, x + 4, d / 2 + 0.6, gF, (s.hash + Math.round(x)) >>> 0, { tree: true, treeH: 4.2 });
  }
  // ---- back of house: service yard + driveway on the service side ----
  if (!halt) {
    const sx = svcSide === 'left' ? hx0 : hx1, sg = svcSide === 'left' ? -1 : 1;
    const gS = K.groundAt(s, sx + sg * 4, -d * 0.1);
    b.cbox('concrete', Math.min(sx, sx + sg * 9), gS - 0.3, hz0 + 1, Math.max(sx, sx + sg * 9), gS + 0.02, d / 2 + 6, 0.02, false);
    b.push(); b.translate(sx + sg * 5.5, 0, hz0 + 4.5); b.rotY(sg < 0 ? Math.PI / 2 : -Math.PI / 2);
    K.binStore(b, -1.6, -0.9, 1.6, 0.9, gS + 0.02, { wallKey: st.wallAccent });
    b.pop();
    if (ffl - gS > 0.05) {
      b.push(); b.translate(sx, 0, 0); b.frame(0, 0, hz0 + hD * 0.3 + 0, 0, 0, svcSide === 'left' ? 1 : -1, 0, 1, 0, sg, 0, 0);
      b.pop();
      b.push(); K.facadeFrame(b, svcSide, Lh, hD, 0);
      const uu = hD * 0.3;
      K.steps(b, { u0: uu - 1.0, u1: uu + 1.0, z0: 0.0, y0: gS, y1: ffl, key: 'concrete', cheeks: false, rails: ffl - gS > 0.45, railKey: 'steel_yellow' });
      b.pop();
    }
  }
  // ---------------- platforms ----------------
  const px0 = -w / 2, px1 = w / 2;
  const nearOuter = T.elevated ? Math.min(-d / 2 - 0.05, T.zEdgeNear + 7.5) : -d / 2;
  const skipX = [];
  // far access tower location (x) — away from the hall middle
  const towerX = halt ? 0 : clamp(hx1 * 0.5, px0 + 14, px1 - 20);
  if (!halt) skipX.push([towerX - 6, towerX + 12]);
  platform(ctx, L, { x0: px0, x1: px1, zEdge: T.zEdgeNear, zOut: nearOuter, side: 1, outerRail: true, railGap: [[hx0 - 0.4, hx1 + 0.4]], skipX: !T.elevated ? [[hx0 - 1, hx1 + 1]] : [] });
  const farOut = T.zEdgeFar - L.farW;
  platform(ctx, L, { x0: px0 + (halt ? 0 : 0), x1: px1, zEdge: T.zEdgeFar, zOut: farOut, side: -1, outerRail: true, skipX });
  // hall back opens onto the near platform (at grade): fill between the hall back wall and the platform edge zone
  // sloped sites (front ground above the platform): the hall floor sits higher than the near platform → a terrace at
  // FFL outside the platform doors with broad steps down to the platform (+ a 1:12 ramp along the platform)
  const dropP = ffl - yPlat;
  if (!T.elevated && !halt && dropP > 0.2) {
    const nR = Math.ceil(dropP / 0.165), run = nR * 0.3;
    const avail = (hz0 - T.zEdgeNear) - 2.6;                      // keep ≥ 2.6 m clear along the platform edge
    const landD = clamp(avail - run, 1.4, 3.0);
    b.push(); K.facadeFrame(b, 'back', w, d, 0);
    const bu0 = w / 2 - hx1 + 0.3, bu1 = w / 2 - hx0 - 0.3;
    b.cbox('paving_stone', bu0, yPlat - 0.3, 0.0, bu1, ffl - 0.005, landD, 0.012, false);
    if (b.collecting) b.colQuad(bu0, ffl, landD, bu1, ffl, landD, bu1, ffl, 0, bu0, ffl, 0);
    K.steps(b, { u0: bu0 + 3.2, u1: bu1 - 0.4, z0: landD, y0: yPlat, y1: ffl, key: 'stone_step', cheeks: true, rails: dropP > 0.45, railKey: 'steel_brushed', buried: 0.3 });
    // ramp down along the platform at the hall's left end (back-frame u grows towards −x)
    const len = Math.min(dropP * 12, 40);
    if (bu1 + len < w - 2) K.rampAlong(b, { uStart: bu1 + len, uEnd: bu1, y0: yPlat, y1: ffl, z0: 0.3, z1: 2.4, key: 'paving_stone', railKey: 'steel_brushed' });
    K.railing(b, [[bu0 + 0.1, landD - 0.1], [bu0 + 3.1, landD - 0.1]], ffl, { kind: 'glass', key: 'aluminium' });
    b.pop();
  }
  // canopies (cover the walking width; the near one stops at the hall)
  const canH = halt ? 3.2 : 4.6;
  if (!T.elevated) {
    platformCanopy(ctx, L, { x0: px0 + 2, x1: hx0 - 0.6, za: T.zEdgeNear + 0.4, zb: nearOuter - 0.6, h: canH, trackSide: -1, joinR: canH <= eave - 0.6 });
    platformCanopy(ctx, L, { x0: hx1 + 0.6, x1: px1 - 2, za: T.zEdgeNear + 0.4, zb: nearOuter - 0.6, h: canH, trackSide: -1, joinL: canH <= eave - 0.6 });
    platformCanopy(ctx, L, { x0: hx0 - 0.6, x1: hx1 + 0.6, za: T.zEdgeNear + 0.4, zb: hz0 - 0.1, h: Math.min(canH, eave - 0.6), trackSide: -1, joinL: canH <= eave - 0.6, joinR: canH <= eave - 0.6 });
  } else {
    platformCanopy(ctx, L, { x0: px0 + 2, x1: px1 - 2, za: T.zEdgeNear + 0.4, zb: nearOuter - 0.4, h: canH, trackSide: -1 });
  }
  platformCanopy(ctx, L, { x0: px0 + 2, x1: px1 - 2, za: farOut + 0.4, zb: T.zEdgeFar - 0.4, h: canH, trackSide: 1, skipX });
  // ---------------- vertical circulation ----------------
  if (!halt) {
    const zFarMid = (T.zEdgeFar + farOut) / 2 - 0.6;
    if (!T.elevated) {
      // footbridge from the level-1 concourse (ffl + gh) over both tracks to the far tower
      const yB = ffl + L.gh;
      const bw = 4.0, bx = towerX + 8.5;
      const zA = hz0 + 0.45, zB = zFarMid + 1.0;
      b.withTint(inst.bandTint, () => {
        // girder + roof stop at the back wall face (inside the wall opening their faces met its sill / head reveals)
        b.cbox('ceramic_band', bx - bw / 2 - 0.3, yB - 0.9, zB, bx + bw / 2 + 0.3, yB, hz0 - 0.01, 0.04);           // deck girder
        b.cbox('ceramic_band', bx - bw / 2 - 0.3, yB + 3.1, zB, bx + bw / 2 + 0.3, yB + 3.5, hz0 - 0.01, 0.04);     // roof
      });
      b.box('stone_floor', bx - bw / 2, yB, zB, bx + bw / 2, yB + 0.02, zA, 4);
      if (b.collecting) { b.colQuad(bx - bw / 2, yB, zA, bx + bw / 2, yB, zA, bx + bw / 2, yB, zB, bx - bw / 2, yB, zB); b.colBox(bx - bw / 2 - 0.2, yB, zB, bx - bw / 2, yB + 1.2, zA); b.colBox(bx + bw / 2, yB, zB, bx + bw / 2 + 0.2, yB + 1.2, zA); }
      for (const sgn of [-1, 1]) {
        b.push(); b.translate(bx + sgn * (bw / 2 + 0.05), 0, 0); b.rotY(sgn > 0 ? Math.PI / 2 : -Math.PI / 2);
        glassScreen(b, { u0: sgn > 0 ? -zA : zB, u1: sgn > 0 ? -zB : zA, v0: yB + 0.02, v1: yB + 3.1, z: 0, pane: 1.6, glassKey: 'glass_railing', frameKey: 'aluminium', rows: [yB + 0.02, yB + 1.1, yB + 3.1] });
        b.pop();
      }
      cyanStrip(b, bx - bw / 2 + 0.2, zA, bx - bw / 2 + 0.2, zB, yB + 3.05, { t: 0.03 });
      accessTower(ctx, L, towerX - 2.0, zFarMid, yPlat, yB, 2.0);
      // stair + escalator + glass lift inside the hall up to the level-1 concourse
      const sx = hx0 + 4;
      // 'full': painted truss panels / stone-tile flights are indoor surfaces (lamp-lit at night like the walls, QQ2-05)
      if (full) b.setExtraFn('idl', (X, Y, Z, NX, NY, NZ, dd, oo) => { dd[oo] = 0.7; });
      const xe = escalator(b, sx, hz0 + 3.2, ffl, yB, { trussKey: full ? 'cabinet' : 'aluminium' });
      const xs = stairRun(b, sx, hz0 + 6.2, ffl, yB, 2.0, { key: full ? 'stone_floor' : 'stone_step', cheekKey: full ? 'tile_wall' : undefined });
      if (full) b.setExtraFn('idl', null);
      glassLift(ctx, xe + 2.0, hz0 + 3.0, ffl, yB, 2.4);
      // level-1 concourse slab (mezzanine over the back of the hall): wells over the escalator and the stair (they
      // arrive at the well ends), glass balustrades round the wells and along the front edge
      const mz1 = hz0 + 9.0;
      mezzanine(ctx, { x0: hx0 + 0.4, x1: hx1 - 0.4, z0: hz0 + 0.4, z1: mz1, y: yB, t: 0.4, top: 'stone_floor', wells: [{ x0: sx - 0.3, x1: xe - 1.2, z0: hz0 + 3.2 - 1.4, z1: hz0 + 3.2 + 1.4 }, { x0: sx - 0.3, x1: xs, z0: hz0 + 6.2 - 1.15, z1: hz0 + 6.2 + 1.15 }, { x0: xe + 2.0 - 1.25, x1: xe + 2.0 + 1.25, z0: hz0 + 3.0 - 1.25, z1: hz0 + 3.0 + 1.25, lift: true }] });
      if (full) { for (let i = 0; i < 3; i++) { b.push(); b.translate(xe + 6 + i * 4, yB, hz0 + 2.0); waitingBench(b, 2.6); b.pop(); } }
    } else {
      // elevated: escalator + stair + lift up to the platform-level mezzanine at the back of the hall
      const sx = hx0 + 4;
      if (full) b.setExtraFn('idl', (X, Y, Z, NX, NY, NZ, dd, oo) => { dd[oo] = 0.7; });
      const xe = escalator(b, sx, hz0 + 4.0, ffl, yPlat, { trussKey: full ? 'cabinet' : 'aluminium' });
      const xs = stairRun(b, sx, hz0 + 7.0, ffl, yPlat, 2.0, { key: full ? 'stone_floor' : 'stone_step', cheekKey: full ? 'tile_wall' : undefined });
      if (full) b.setExtraFn('idl', null);
      glassLift(ctx, xe + 2.0, hz0 + 3.6, ffl, yPlat, 2.4);
      const mz1 = hz0 + 9.5;
      mezzanine(ctx, { x0: hx0 + 0.4, x1: hx1 - 0.4, z0: hz0 + 0.3, z1: mz1, y: yPlat, t: 0.5, top: 'paving', wells: [{ x0: sx - 0.3, x1: xe - 1.2, z0: hz0 + 4.0 - 1.4, z1: hz0 + 4.0 + 1.4 }, { x0: sx - 0.3, x1: xs, z0: hz0 + 7.0 - 1.15, z1: hz0 + 7.0 + 1.15 }, { x0: xe + 2.0 - 1.25, x1: xe + 2.0 + 1.25, z0: hz0 + 3.6 - 1.25, z1: hz0 + 3.6 + 1.25, lift: true }] });
      // openings from the mezzanine through the back wall onto the near platform deck
      // (the back wall above the mezzanine is glazed in the hall openings: strips) + bridge plates
      // from the platform edge to the mezzanine edge (both overlapped their paving)
      b.box('paving', hx0 + 2, yPlat - 0.05, nearOuter, hx1 - 2, yPlat, hz0 + 0.3, 4);
      if (b.collecting) b.colQuad(hx0 + 2, yPlat, hz0 + 0.4, hx1 - 2, yPlat, hz0 + 0.4, hx1 - 2, yPlat, nearOuter - 0.4, hx0 + 2, yPlat, nearOuter - 0.4);
      // far side: covered ground passage under the viaduct + access tower
      const gT = T.groundTrack;
      const pxm = towerX + 4;
      b.withTint(inst.bandTint, () => b.cbox('ceramic_band', pxm - 2.2, gT + 3.2, farOut - 3, pxm + 2.2, gT + 3.5, hz0, 0.03));
      for (let z = hz0 - 2; z > farOut - 2.5; z -= 6) for (const xx of [pxm - 2.0, pxm + 2.0]) b.box('aluminium', xx - 0.06, gT, z - 0.06, xx + 0.06, gT + 3.2, z + 0.06, 63 & ~8);
      b.box('paving', pxm - 2.2, gT - 0.2, farOut - 3, pxm + 2.2, gT + 0.02, hz0, 4 | 16 | 32);
      accessTower(ctx, L, towerX - 2.0, farOut - 2.4, gT, yPlat, 2.0);
      // Z03 arch with a glass spine over the platforms
      arch(ctx, L, { x0: px0 + w * 0.12, x1: px1 - w * 0.12, z: (T.zEdgeNear + nearOuter) / 2 + 0.3, y0: T.groundTrack, apex: yPlat + 15 });
    }
  }
  // halt: shelter + ticket machine
  if (halt) {
    for (const x of [-4, 4]) { b.push(); b.translate(x, yPlat, (T.zEdgeNear + nearOuter) / 2 + 0.5); b.rotY(Math.PI); waitingBench(b, 2.2); b.pop(); }
  }
  // ---------------- interior: gate line, ticket machines, counter ----------------
  const zg = halt ? hz0 + 3 : hz0 + (T.elevated ? 13 : 11);
  if (!halt && zg < hz1 - 6) {
    const nG = Math.max(6, Math.round((Lh * 0.5) / 0.95));
    const gx0 = -nG * 0.95 / 2;
    for (let i = 0; i <= nG; i++) {
      const x = gx0 + i * 0.95;
      b.cbox('aluminium_dark', x - 0.14, ffl, zg - 0.9, x + 0.14, ffl + 1.05, zg + 0.9, 0.02, false);
      b.box('light_cyan', x - 0.1, ffl + 1.05, zg - 0.85, x + 0.1, ffl + 1.07, zg - 0.65, 63);
      b.box('glass_railing', x + 0.14, ffl + 0.35, zg - 0.05, x + 0.4, ffl + 1.0, zg + 0.05, 63);
      if (b.collecting) b.colBox(x - 0.14, ffl, zg - 0.9, x + 0.14, ffl + 1.05, zg + 0.9);
    }
    // glass barrier from the gate line to the walls
    K.railing(b, [[hx0 + 0.5, zg], [gx0 - 0.2, zg]], ffl, { kind: 'glass', key: 'aluminium' });
    K.railing(b, [[-gx0 + 0.2, zg], [hx1 - 0.5, zg]], ffl, { kind: 'glass', key: 'aluminium' });
    if (b.collecting) { b.colBox(hx0, ffl, zg - 0.05, gx0 - 0.2, ffl + 1.1, zg + 0.05); b.colBox(-gx0 + 0.2, ffl, zg - 0.05, hx1, ffl + 1.1, zg + 0.05); }
    // ticket machines along the left wall, counter on the right
    for (let i = 0; i < 4; i++) {
      const z = zg + 2.5 + i * 1.3;
      if (z > hz1 - 2) break;
      b.cbox('aluminium', hx0 + 0.4, ffl, z - 0.45, hx0 + 1.0, ffl + 1.8, z + 0.45, 0.02, false);
      b.push(); b.translate(hx0 + 1.0, 0, z); b.rotY(Math.PI / 2); ledBoard(b, 0, ffl + 1.0, 0.64, 0.55, 0.03, { rows: 3, seed: (s.hash + i * 7) >>> 0 }); b.pop();
      if (b.collecting) b.colBox(hx0 + 0.4, ffl, z - 0.45, hx0 + 1.0, ffl + 1.8, z + 0.45);
    }
    b.push(); b.translate(hx1 - 2.5, ffl, Math.min(hz1 - 3, zg + 4)); b.rotY(-Math.PI / 2); reception(b, 4.0); b.pop();
    // departure boards (blank) hanging over the gate line
    // departure boards (LED: cyan text rows, always lit) back to back over the gate line, hung from rods
    for (const dx of [-3.0, 3.0]) b.box('steel_dark', dx - 0.015, ffl + 4.3, zg + 0.68, dx + 0.015, ys - 0.6, zg + 0.71, 63);
    ledBoard(b, 0, ffl + 3.4, 7.0, 0.9, zg + 0.8, { rows: 5, seed: s.hash });
    b.push(); b.translate(0, 0, zg + 0.62); b.rotY(Math.PI); ledBoard(b, 0, ffl + 3.4, 7.0, 0.9, 0.04, { rows: 5, seed: (s.hash + 99) >>> 0 }); b.pop();
    if (full) {
      // ticket hall: waiting benches facing the departure boards, planters, info totem, bins; the axis from
      // the main doors to the gate line stays clear; paid concourse: benches beside the platform doors
      furnishPublic(ctx, { x0: hx0 + 2.2, x1: hx1 - 5.2, z0: zg + 2.2, z1: hz1 - 3.6 }, ffl, { face: -1, aisle: 0, seed: s.hash ^ 0x51 });
      if (!T.elevated) {
        // paid concourse under the mezzanine, beside the platform doors (door aisles kept clear)
        const nD = Math.max(2, Math.round(Lh / 14));
        const keep = [];
        for (let i = 0; i < nD; i++) { const xd = Lh / 2 - (Lh * (i + 0.5)) / nD; keep.push({ x0: xd - 2.4, x1: xd + 2.4, z0: hz0 - 1, z1: zg }); }
        furnishPublic(ctx, { x0: hx0 + 23.5, x1: hx1 - 1.2, z0: hz0 + 3.0, z1: zg - 1.5 }, ffl, { face: 1, seed: s.hash ^ 0x77, sign: false, keep });
      }
      // hanging wayfinding signs (blank light boxes) over the hall axis
      let k = 0;
      for (const zz of [zg + 4, Math.min(hz1 - 4, zg + 10)]) {
        b.box('steel_dark', -0.02, ys - 1.2 - 2.0, zz - 0.02, 0.02, ys - 1.2, zz + 0.02, 63);
        lightBox(b, 0, ys - 4.0, 4.4, 0.8, zz + 0.08, { twoSided: true, depth: 0.16, picto: k++ ? 'train' : 'arrow', dir: -1, rows: 2, seed: (s.hash + k * 5) >>> 0 });
      }
    }
  }
  if (full && !halt) {
    const nD = Math.max(2, Math.round(Lh / 14));
    const backDoors = T.elevated ? null : Array.from({ length: nD }, (_, i) => Lh / 2 - (Lh * (i + 0.5)) / nD);
    stationLights(ctx, L, { hx0, hx1, hz0, hz1, zg, ys, shells, ffl, backDoors });
  }
  // ---------------- anchors ----------------
  const A = b.anchors;
  A.floors = [{ level: 0, y: ffl, height: L.gh }];
  if (!halt) A.floors.push({ level: 1, y: T.elevated ? yPlat : ffl + L.gh, height: L.fh });
  A.roof = { y: roofTop, access: [halt ? hx1 - 3 : 0, roofTop, halt ? hz0 + 3 : (hz0 + hz1) / 2] };
  A.entrances = [];
  for (const dd of doorsSorted) A.entrances.push({ kind: 'main', side: 'front', pos: [dd.c - Lh / 2, ffl, hz1 + 0.6], dir: [0, 0, 1], width: dd.w });
  A.entrances.push({ kind: 'platform', side: 'back', pos: [0, yPlat, (T.zEdgeNear + nearOuter) / 2], dir: [0, 0, -1], width: 4 });
  A.entrances.push({ kind: 'service', side: svcSide, pos: [svcSide === 'left' ? hx0 - 0.6 : hx1 + 0.6, ffl, hz0 + hD * 0.3], dir: [svcSide === 'left' ? -1 : 1, 0, 0], width: 1.4 });
  A.rooms = [{ floor: 0, name: 'ticket hall', kind: 'lobby', center: [0, ffl, (zg + hz1) / 2], size: [Lh, L.gh, hz1 - zg] }, { floor: 0, name: 'paid concourse', kind: 'hall', center: [0, ffl, (hz0 + zg) / 2], size: [Lh, L.gh, zg - hz0] }];
  A.meta = { platformY: yPlat, railY: T.railY, trackZ: T.zTrack };
  b.meta.station = { platformY: yPlat, railY: T.railY, trackZ: T.zTrack, zEdgeNear: T.zEdgeNear, zEdgeFar: T.zEdgeFar, elevated: T.elevated, length: w };
  const pz = (T.zEdgeNear + nearOuter) / 2;
  A.cameras = {
    street: { pos: [-Lh * 0.4, gF + 1.65, d / 2 + 28], target: [0, ffl + 5, 0] },
    entrance: { pos: [3, gF + 1.65, d / 2 + 9], target: [0, ffl + 2.2, hz1 - 3] },
    lobby: { pos: [hx1 - 3, ffl + 1.65, hz1 - 2], target: [hx0 + 6, ffl + 2.5, zg - 4] },
    interior: { pos: [hx1 - 3, ffl + 1.65, hz1 - 2], target: [hx0 + 6, ffl + 2.5, zg - 4] },
    stair: { pos: [hx0 + 2.0, ffl + 1.65, hz0 + 12], target: [hx0 + 14, ffl + 5, hz0 + 4] },
    platform: { pos: [px0 + 12, yPlat + 1.65, pz + (T.zEdgeNear - pz) * 0.45], target: [px1 - 20, yPlat + 1.5, T.zTrack] },   // off the column line
    back: { pos: [Lh * 0.3, yPlat + 6, T.zTrack - 26], target: [0, ffl + 4, hz0] },
    roof: { pos: [-Lh * 0.3, roofTop + 25, d * 1.2], target: [0, roofTop - 3, 0] },
  };
}

/** Z03 arch: wide white band with a glass spine, springing from the ground at x0 / x1 in plane z. */
function arch(ctx, L, o) {
  const b = ctx.b, inst = ctx.inst;
  const N = 28, pts = [];
  const xm = (o.x0 + o.x1) / 2, hw = (o.x1 - o.x0) / 2;
  for (let k = 0; k <= N; k++) {
    const t = k / N, x = o.x0 + (o.x1 - o.x0) * t;
    const q = (x - xm) / hw;
    pts.push([x, o.y0 + (o.apex - o.y0) * (1 - Math.pow(Math.abs(q), 2.2)), o.z]);
  }
  // band: sweep of a rounded rectangle (2.8 wide across z, 1.1 deep)
  const prof = [[-1.4, -0.55], [1.4, -0.55], [1.5, -0.3], [1.5, 0.3], [1.4, 0.55], [-1.4, 0.55], [-1.5, 0.3], [-1.5, -0.3]];
  // sweep profile (s = right of travel = across z, y = normal in the arch plane)
  b.withTint(inst.bandTint, () => b.sweep('ceramic_band', pts, prof.map(([a, c]) => [a, c]), { up: [0, 0, 1], smoothAngle: 50, caps: true }));
  // glass spine along the outer surface
  const spine = pts.slice(2, N - 1);
  b.sweep('glass_railing', spine, [[-0.7, 0.5], [0.7, 0.5], [0.7, 0.62], [-0.7, 0.62]], { up: [0, 0, 1], smoothAngle: 50, caps: true });
  cyanStrip(b, o.x0 + 1.6, o.z + 1.52, o.x0 + 3.0, o.z + 1.52, o.y0 + 1.0, { t: 0.03 });
  if (b.collecting) for (const x of [o.x0, o.x1]) b.colBox(x - 1.6, o.y0, o.z - 1.5, x + 1.6, o.y0 + 4, o.z + 1.5);
}

export default {
  name: 'station',
  uses: ['station'],
  generate,
  massing(spec, ctx) {
    const s = ctx.spec;
    const L = layout(ctx);
    const T = L.T;
    const vols = [];
    const hz1 = L.halt ? s._d / 2 - 2 : s._d / 2;
    const S = { fh: L.fh, gh: L.gh, ffl: L.ffl, roofY: L.ffl + L.ysRel };
    vols.push(zMass(ctx, S, { x0: -L.Lh / 2, x1: L.Lh / 2, z0: -s._d / 2, z1: hz1, parapet: L.halt ? 0.6 : 0, bayW: 4.0, glazedGround: true, roofColor: [0.62, 0.65, 0.68], bands: false }));
    if (!L.halt) {
      // coarse Z03 shells (same surface function as generate → shellRoof)
      const b = ctx.b, ys = L.ffl + L.ysRel, hz0 = -s._d / 2;
      b.pushTint([0.93, 0.92, 0.89]);
      for (const sh of shellSet(L, -L.Lh / 2, L.Lh / 2)) {
        const xa = sh.xa - sh.extL, xb = sh.xb + sh.extR, z0 = hz0 - sh.ovB, z1 = hz1 + sh.ovF;
        const nx = 8, zs = [z0, hz0, (hz0 + hz1) / 2, hz1, hz1 + sh.ovF * 0.5, z1];
        for (let j = 0; j < zs.length - 1; j++) for (let k = 0; k < nx; k++) {
          const xA = xa + ((xb - xa) * k) / nx, xB = xa + ((xb - xa) * (k + 1)) / nx, zA = zs[j], zB = zs[j + 1];
          const Y = (x, z) => shellY(sh, ys, hz0, hz1, x, z);
          b.quad('mass_roof', xA, Y(xA, zA), zA, xA, Y(xA, zB), zB, xB, Y(xB, zB), zB, xB, Y(xB, zA), zA);
          b.quad('mass_roof', xB, Y(xB, zA) - 0.4, zA, xB, Y(xB, zB) - 0.4, zB, xA, Y(xA, zB) - 0.4, zB, xA, Y(xA, zA) - 0.4, zA);
        }
      }
      b.popTint();
    }
    // platform canopies (blank thin volumes) + platforms
    const yC = T.platY + (L.halt ? 3.2 : 4.6);
    const blank = { front: true, right: true, back: true, left: true };
    const nearOuter = T.elevated ? Math.min(-s._d / 2 - 0.05, T.zEdgeNear + 7.5) : -s._d / 2;
    vols.push(zMass(ctx, S, { x0: -s._w / 2 + 2, x1: s._w / 2 - 2, z0: T.zEdgeNear + 0.1, z1: nearOuter - 0.3, y0: yC - 0.5, y1: yC, parapet: 0, blank, soffit: true, roofColor: [0.24, 0.3, 0.42], bands: false }));
    vols.push(zMass(ctx, S, { x0: -s._w / 2 + 2, x1: s._w / 2 - 2, z0: T.zEdgeFar - L.farW + 0.1, z1: T.zEdgeFar - 0.1, y0: yC - 0.5, y1: yC, parapet: 0, blank, soffit: true, roofColor: [0.24, 0.3, 0.42], bands: false }));
    vols.push(zMass(ctx, S, { x0: -s._w / 2, x1: s._w / 2, z0: T.zEdgeFar - L.farW, z1: T.zEdgeFar, y0: T.elevated ? T.platY - 0.7 : T.groundTrack - 0.3, y1: T.platY, parapet: 0, blank, roofColor: [0.7, 0.69, 0.66], bands: false }));
    vols.push(zMass(ctx, S, { x0: -s._w / 2, x1: s._w / 2, z0: T.zEdgeNear, z1: nearOuter, y0: T.elevated ? T.platY - 0.7 : T.groundTrack - 0.3, y1: T.platY, parapet: 0, blank, roofColor: [0.7, 0.69, 0.66], bands: false }));
    // Z03 arch silhouette over the elevated platforms (same curve as generate → arch())
    if (T.elevated && !L.halt) {
      const b = ctx.b, w = s._w;
      const x0 = -w / 2 + w * 0.12, x1 = w / 2 - w * 0.12, z = (T.zEdgeNear + nearOuter) / 2 + 0.3, y0 = T.groundTrack, apex = T.platY + 15;
      const xm = (x0 + x1) / 2, hw = (x1 - x0) / 2, pts = [];
      for (let k = 0; k <= 16; k++) { const x = x0 + (x1 - x0) * (k / 16), q = (x - xm) / hw; pts.push([x, y0 + (apex - y0) * (1 - Math.pow(Math.abs(q), 2.2)), z]); }
      b.pushTint([0.93, 0.92, 0.89]);
      b.sweep('mass_roof', pts, [[-1.45, -0.55], [1.45, -0.55], [1.45, 0.55], [-1.45, 0.55]], { up: [0, 0, 1], smoothAngle: 50, caps: true });
      b.popTint();
    }
    return vols;
  },
};
