// Continuous curved balcony bands (ZR style: white ceramic bullnose ribbons wrapping corners,
// R2 / Z03 / Z02), straight balcony slabs, glass / bar railings, integrated planters,
// soffit downlights. Plan coordinates are building-frame [x, z]; rect footprints centred.
//
//   const paths = bandPaths(w, d, { front: 1.8, right: 0.7, back: 0.7, left: 0.7 }, shared, opts)
//   for (const p of paths) curvedBand(b, p, y, { w, d, rail: 'glass', ... })
//
// Offsets may be numbers or functions of t∈[0,1] along the side (left→right seen from outside)
// for undulating bands. A side with offset ≤ 0 has no band; the band tapers back into the wall.
// Shared (party-wall) sides cut the band flush with the party wall plane.

import { offsetPolyline, chaikin, cumLength, pointAt, slicePolyline, arcSegs, clamp, simplify } from './math.js';
import { trailing, shrub } from './vegetation.js';
import { PX, NX, PY, NY, PZ, NZ, ALL } from './MeshBuilder.js';

const SIDE = ['front', 'right', 'back', 'left'];

/** Perimeter geometry helpers for a centred w×d rectangle (perimeter order front→right→back→left). */
function sideLine(side, w, d) {
  // returns {o:[x,z] start corner, dir:[dx,dz], n:[nx,nz] outward, L}
  switch (side) {
    case 'front': return { o: [-w / 2, d / 2], dir: [1, 0], n: [0, 1], L: w };
    case 'right': return { o: [w / 2, d / 2], dir: [0, -1], n: [1, 0], L: d };
    case 'back': return { o: [w / 2, -d / 2], dir: [-1, 0], n: [0, -1], L: w };
    default: return { o: [-w / 2, -d / 2], dir: [0, 1], n: [-1, 0], L: d };
  }
}

/**
 * Band outline paths around a w×d footprint.
 * @param {number} w @param {number} d
 * @param {object} off  {front,right,back,left}: number | (t)=>number  projection (m)
 * @param {object} shared {left,right,back} party walls
 * @param {object} [o] {cornerR=2, step=0.35, smooth=2}
 * @returns {{pts:number[][], closed:boolean}[]}
 */
export function bandPaths(w, d, off, shared = {}, o = {}) {
  const P = (side, t) => { const v = off[side]; if (shared[side]) return -1; return typeof v === 'function' ? v(t) : (v ?? 0); };
  const pts = []; const tags = []; // tag: 1 = inside band, 0 = no band (P<=0), 2 = shared cut
  for (let si = 0; si < 4; si++) {
    const side = SIDE[si], L = sideLine(side, w, d);
    const nextSide = SIDE[(si + 1) % 4];
    const pEnd = P(side, 1), pNextStart = P(nextSide, 0);
    const fnSide = typeof off[side] === 'function' && !shared[side] ? off[side] : null;
    // sample positions t∈[0,1): uniform (≤ 0.5 m) plus the function's declared break points
    // (fn.breaks = [t…]) so stepped profiles (rectangular balconies) keep crisp corners
    let ts = [0];
    if (fnSide) {
      const n = Math.max(6, Math.ceil(L.L / 0.5));
      ts = [];
      for (let i = 0; i < n; i++) ts.push(i / n);
      if (Array.isArray(fnSide.breaks)) for (const t of fnSide.breaks) if (t > 1e-4 && t < 1 - 1e-4) ts.push(t);
      ts.sort((a, c) => a - c);
      ts = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 0.004 / L.L);
    }
    // corner fillet radius between this side and the next
    const rc = pEnd > 0 && pNextStart > 0 ? filletRadius(pEnd, pNextStart, Math.min(L.L, sideLine(nextSide, w, d).L), o.cornerR ?? 2.0) : 0;
    const prevSide = SIDE[(si + 3) % 4];
    const pPrevEnd = P(prevSide, 1), pStart = P(side, 0);
    const rp = pPrevEnd > 0 && pStart > 0 ? filletRadius(pPrevEnd, pStart, Math.min(L.L, sideLine(prevSide, w, d).L), o.cornerR ?? 2.0) : 0;
    for (const t of ts) {
      const p = P(side, t);
      const x = L.o[0] + L.dir[0] * L.L * t + L.n[0] * p, z = L.o[1] + L.dir[1] * L.L * t + L.n[1] * p;
      // skip samples that fall into the fillet zone of the next corner
      const distToEnd = L.L * (1 - t);
      if (rc > 0 && distToEnd < rc - pNextStart - 1e-6) continue;
      // also skip samples in the fillet zone of the previous corner
      if (rp > 0 && L.L * t < rp - pPrevEnd - 1e-6) continue;
      pts.push([x, z]); tags.push(shared[side] ? 2 : p > 0.02 ? 1 : 0);
    }
    // corner
    if (rc > 0) {
      // corner point of the offset lines
      const nL = sideLine(nextSide, w, d);
      const cxL = L.o[0] + L.dir[0] * L.L + L.n[0] * pEnd + nL.n[0] * pNextStart;
      const czL = L.o[1] + L.dir[1] * L.L + L.n[1] * pEnd + nL.n[1] * pNextStart;
      // fillet centre: rc inside both offset lines → corner − n·rc − nNext·rc
      const ccx = cxL - L.n[0] * rc - nL.n[0] * rc, ccz = czL - L.n[1] * rc - nL.n[1] * rc;
      const a0 = Math.atan2(L.n[1], L.n[0]), a1 = Math.atan2(nL.n[1], nL.n[0]);
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const segs = arcSegs(rc, Math.abs(da), 0.012, 6, 32);
      for (let k = 0; k <= segs; k++) { const a = a0 + (da * k) / segs; pts.push([ccx + Math.cos(a) * rc, ccz + Math.sin(a) * rc]); tags.push(1); }
    } else if (pEnd > 0 && shared[nextSide]) {
      // cut flush at the party wall plane: final point exactly on the shared side line
      const x = L.o[0] + L.dir[0] * (L.L - 0.02) + L.n[0] * pEnd, z = L.o[1] + L.dir[1] * (L.L - 0.02) + L.n[1] * pEnd;
      pts.push([x, z]); tags.push(1);
      pts.push([x, z]); tags.push(2); // break marker
    } else if (pEnd > 0 && !(pNextStart > 0)) {
      // band runs to the corner, then returns into the wall (arc added below)
      const x = L.o[0] + L.dir[0] * L.L + L.n[0] * pEnd, z = L.o[1] + L.dir[1] * L.L + L.n[1] * pEnd;
      pts.push([x, z]); tags.push(1);
    }
  }
  // split into runs of tag 1
  const N = pts.length;
  const runs = [];
  const allIn = tags.every((t) => t === 1);
  if (allIn) return [{ pts: simplify(dedupe2(pts, true), 0.014, true), closed: true }];
  // rotate so we start at a non-band sample
  let s0 = tags.findIndex((t) => t !== 1);
  for (let k = 0; k < N; k++) {
    const i = (s0 + k) % N;
    if (tags[i] === 1) {
      if (!runs.length || runs[runs.length - 1].done) runs.push({ pts: [], done: false, cutStart: tags[(i - 1 + N) % N] === 2 });
      runs[runs.length - 1].pts.push(pts[i]);
    } else if (runs.length && !runs[runs.length - 1].done) { runs[runs.length - 1].done = true; runs[runs.length - 1].cutEnd = tags[i] === 2; }
  }
  if (runs.length && !runs[runs.length - 1].done) runs[runs.length - 1].cutEnd = tags[s0] === 2;
  const out = [];
  for (const r of runs) {
    if (r.pts.length < 2) continue;
    let p = dedupe2(r.pts, false);
    if (p.length < 2) continue;
    // rounded returns into the wall at free ends (ZR bands die into the facade)
    if (!r.cutStart) p = [...returnArc(p[0], p[1], w, d).reverse(), ...p];
    if (!r.cutEnd) p = [...p, ...returnArc(p[p.length - 1], p[p.length - 2], w, d)];
    p = simplify(dedupe2(p, false), 0.014, false);
    out.push({ pts: p, closed: false, cutStart: !!r.cutStart, cutEnd: !!r.cutEnd });
  }
  return out;
}

/**
 * Corner fillet radius for two band projections pa (this side) / pb (next side): the requested
 * `projection + cornerR`, limited by the side lengths, and shrunk until the arc clears the
 * building corner by min(0.25, pmin/2) — a large radius on a shallow band would bury the arc in
 * the wall corner (the band then seems to stop short of every corner).
 */
function filletR0(pa, pb, len, cornerR) {
  const pm = Math.min(pa, pb);
  return clamp(pm + cornerR, 0.3, len * 0.45 + pm);
}
function filletRadius(pa, pb, len, cornerR) {
  let rc = filletR0(pa, pb, len, cornerR);
  const clr = Math.min(0.25, Math.min(pa, pb) * 0.5);
  for (let k = 0; k < 40 && rc > 0.06; k++) {
    // wall corner relative to the fillet centre: (pa − rc, pb − rc) in (n, nNext) axes
    const da = rc - pa, db = rc - pb;
    if (da <= 0 || db <= 0 || rc - Math.hypot(da, db) >= clr) break;
    rc *= 0.93;
  }
  return Math.max(0.06, rc);
}

function dedupe2(pts, closed) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.02) out.push(p); }
  if (closed && out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.02) out.pop();
  return out;
}

/**
 * Quarter-circle return from band end E (coming from point F) back into the nearest wall line of
 * the w×d rectangle: radius = band projection (≤ 1.4), ending 0.14 m inside the wall.
 */
function returnArc(E, F, w, d) {
  let tx = E[0] - F[0], tz = E[1] - F[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  // nearest wall: outward normal n and projection distance P
  const cands = [[0, 1, E[1] - d / 2], [1, 0, E[0] - w / 2], [0, -1, -d / 2 - E[1]], [-1, 0, -w / 2 - E[0]]];
  let best = null;
  for (const c of cands) if (Math.abs(c[0] * tx + c[1] * tz) < 0.5 && c[2] > -0.05 && (best === null || c[2] < best[2])) best = c;
  if (!best) best = cands.reduce((a, c) => (Math.abs(c[2]) < Math.abs(a[2]) ? c : a));
  const nx = best[0], nz = best[1], P = Math.max(0.05, best[2]);
  const r = Math.min(P, 1.4);
  // straight part keeps the projection until the arc starts
  const cx = E[0] - nx * r, cz = E[1] - nz * r;
  const out = [];
  const segs = Math.max(4, Math.ceil(r / 0.12));
  for (let i = 1; i <= segs; i++) { const a = (i / segs) * Math.PI / 2; out.push([cx + (nx * Math.cos(a) + tx * Math.sin(a)) * r, cz + (nz * Math.cos(a) + tz * Math.sin(a)) * r]); }
  // continue straight down to the wall and 0.14 m into it
  const last = out[out.length - 1];
  const rem = P - r;
  out.push([last[0] - nx * (rem + 0.14), last[1] - nz * (rem + 0.14)]);
  return out;
}

/** Point moved from a (band end) towards/into the wall line of a w×d rectangle. */
function intoWall(a, from, w, d) {
  // project onto nearest rectangle side, then 0.12 m inside the wall
  const dx = Math.min(Math.abs(a[0] - w / 2), Math.abs(a[0] + w / 2)), dz = Math.min(Math.abs(a[1] - d / 2), Math.abs(a[1] + d / 2));
  if (dz <= dx) return [a[0] + (a[0] - from[0]) * 0.3, Math.sign(a[1]) * (d / 2 - 0.12)];
  return [Math.sign(a[0]) * (w / 2 - 0.12), a[1] + (a[1] - from[1]) * 0.3];
}

/**
 * Horizontal ribbon between a band edge polyline and its projection onto the (inset) wall
 * rectangle — the balcony deck / soffit without polygon triangulation. Points on corner arcs
 * all project to the rectangle corner (fan). facing +1 up / −1 down.
 */
export function ribbonToWall(b, key, pts, closed, w, d, inset, y, facing, project = null) {
  const n = pts.length; if (n < 2) return;
  const hx = w / 2 - inset, hz = d / 2 - inset;
  const p = b.part(key);
  const ny = facing > 0 ? 1 : -1;
  const A = new Int32Array(n), W = new Int32Array(n);
  const wx = new Float64Array(n), wz = new Float64Array(n);
  const tmp = [0, 0];
  for (let i = 0; i < n; i++) {
    const x = pts[i][0], z = pts[i][1];
    let px, pz;
    if (project) { project(x, z, inset, tmp); px = tmp[0]; pz = tmp[1]; }
    else {
      px = Math.max(-hx, Math.min(hx, x)); pz = Math.max(-hz, Math.min(hz, z));
      // point outside the rect → nearest boundary point is the clamp; if inside (shouldn't), push to the nearest side
      if (Math.abs(x) <= hx && Math.abs(z) <= hz) { if (hx - Math.abs(x) < hz - Math.abs(z)) px = Math.sign(x || 1) * hx; else pz = Math.sign(z || 1) * hz; }
    }
    wx[i] = px; wz[i] = pz;
    A[i] = b.vert(p, x, y, z, 0, ny, 0, 0, 0);
    W[i] = b.vert(p, px, y, pz, 0, ny, 0, 0, 0);
  }
  const segs = closed ? n : n - 1;
  // emit one triangle oriented by its own signed area (CCW in (x,z) faces −Y, see polyY)
  const tri = (ia, ax, az, ib, bx, bz, ic, cx, cz) => {
    const cr = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(cr) < 1e-10) return;
    if ((cr < 0) === (facing > 0)) b.tri(p, ia, ib, ic); else b.tri(p, ia, ic, ib);
  };
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const same = Math.abs(wx[i] - wx[j]) < 1e-6 && Math.abs(wz[i] - wz[j]) < 1e-6;
    tri(A[i], pts[i][0], pts[i][1], A[j], pts[j][0], pts[j][1], W[i], wx[i], wz[i]);
    if (!same) tri(A[j], pts[j][0], pts[j][1], W[j], wx[j], wz[j], W[i], wx[i], wz[i]);
  }
  if (b.collecting && facing > 0) {
    for (let i = 0; i < segs; i++) { const j = (i + 1) % n; b.colQuad(pts[i][0], y, pts[i][1], pts[j][0], y, pts[j][1], wx[j], y, wz[j], wx[i], y, wz[i]); }
  }
}

/**
 * Close an open band path (inner edge) back along the building rectangle (inset into the
 * wall by `inset`) → polygon for deck / soffit. Closed paths return {outer, hole}.
 */
function bandRegion(path, w, d, inset) {
  if (path.closed) {
    const hole = [[-w / 2 + inset, -d / 2 + inset], [w / 2 - inset, -d / 2 + inset], [w / 2 - inset, d / 2 - inset], [-w / 2 + inset, d / 2 - inset]];
    return { outer: path.inner, holes: [hole] };
  }
  const pts = path.inner;
  const per = (p) => { // perimeter coordinate of the nearest point on the rect
    const x = clamp(p[0], -w / 2, w / 2), z = clamp(p[1], -d / 2, d / 2);
    const df = Math.abs(z - d / 2), dr = Math.abs(x - w / 2), db = Math.abs(z + d / 2), dl = Math.abs(x + w / 2);
    const m = Math.min(df, dr, db, dl);
    if (m === df) return x + w / 2;
    if (m === dr) return w + (d / 2 - z);
    if (m === db) return w + d + (w / 2 - x);
    return 2 * w + d + (z + d / 2);
  };
  const P = 2 * (w + d);
  const atPer = (u) => {
    u = ((u % P) + P) % P;
    if (u <= w) return [-w / 2 + u, d / 2 - inset];
    if (u <= w + d) return [w / 2 - inset, d / 2 - (u - w)];
    if (u <= 2 * w + d) return [w / 2 - (u - w - d), -d / 2 + inset];
    return [-w / 2 + inset, -d / 2 + (u - 2 * w - d)];
  };
  let u0 = per(pts[0]), u1 = per(pts[pts.length - 1]);
  if (u1 < u0) u1 += P;
  const back = [atPer(u1)];
  const corners = [w, w + d, 2 * w + d, P, P + w, P + w + d];
  for (let k = corners.length - 1; k >= 0; k--) if (corners[k] < u1 - 1e-6 && corners[k] > u0 + 1e-6) back.push(atPer(corners[k]));
  back.push(atPer(u0));
  // insets at corners: atPer gives points on the rect inset lines (corners approximate)
  return { outer: [...pts, ...back], holes: [] };
}

const BAND_PROFILES = new Map();
/** Band cross-section (s outward from the band edge, y relative to FFL), cached. */
function bandProfile(flat, slabT, up, drop) {
  const k = `${flat}|${slabT}|${up}|${drop}`;
  let p = BAND_PROFILES.get(k);
  if (p) return p;
  const bot = -slabT - drop, mid = (up + bot) / 2;
  p = flat
    ? [[-0.24, -slabT], [-0.24, bot], [-0.012, bot], [0, bot + 0.012], [0, up - 0.012], [-0.012, up], [-0.2, up], [-0.2, -0.03]]
    : [[-0.24, -slabT], [-0.24, bot], [-0.07, bot], [-0.018, bot + 0.04], [0, mid - 0.06], [0, mid + 0.06], [-0.014, up - 0.035], [-0.06, up], [-0.22, up], [-0.22, -0.03]];
  BAND_PROFILES.set(k, p);
  return p;
}
const RAIL_TOP = [[-0.028, -0.03], [0.028, -0.03], [0.03, -0.004], [0.0, 0.01], [-0.03, -0.004]];
const RAIL_SHOE = [[-0.035, 0], [0.035, 0], [0.035, 0.09], [-0.035, 0.09]];

/**
 * Emit one curved band (fascia sweep + deck + soffit + downlights) at floor level y (FFL).
 * o: {w, d, key='ceramic_band', deckKey='wood_deck', soffitKey='render_white', slabT=0.22,
 *     up=0.3 (upstand above FFL), drop=0.12 (fascia below soffit), lights=true, deck=true, soffit=true,
 *     flat=false (rectangular profile for the cold style),
 *     project(x, z, inset, out) — nearest wall point for non-rect footprints (default: the w×d rect),
 *     inside(x, z, margin) — true when a point lies inside the footprint (default: the w×d rect)}
 */
export function curvedBand(b, path, y, o = {}) {
  const key = o.key || 'ceramic_band';
  const slabT = o.slabT ?? 0.22, up = o.up ?? 0.3, drop = o.drop ?? 0.12;
  const prof = bandProfile(!!o.flat, slabT, up, drop);
  const p3 = path.pts.map((p) => [p[0], y, p[1]]);
  b.sweep(key, p3, prof, { closed: path.closed, smoothAngle: 32, caps: !path.closed });
  path.inner = offsetPolyline(path.pts, 0.215, path.closed);
  const w = o.w, d = o.d;
  if (o.deck !== false) {
    const inner = offsetPolyline(path.pts, 0.215, path.closed);
    ribbonToWall(b, o.deckKey || 'wood_deck', inner, path.closed, w, d, 0.06, y - 0.03, 1, o.project);
  }
  if (o.soffit !== false) {
    const inner = offsetPolyline(path.pts, 0.235, path.closed);
    ribbonToWall(b, o.soffitKey || 'render_white', inner, path.closed, w, d, 0.06, y - slabT, -1, o.project);
  }
  if (o.lights !== false) {
    const inner = offsetPolyline(path.pts, (o.lightInset ?? 0.7), path.closed);
    const cum = cumLength(inner), L = cum[cum.length - 1];
    const n = Math.floor(L / (o.lightSpacing ?? 2.4));
    for (let i = 0; i < n; i++) {
      const q = pointAt(inner, cum, (L * (i + 0.5)) / n);
      if (o.inside ? o.inside(q[0], q[1], 0.25) : (Math.abs(q[0]) < w / 2 + 0.25 && Math.abs(q[1]) < d / 2 + 0.25)) continue;
      disc(b, 'light_warm', q[0], y - slabT - 0.008, q[1], 0.055, -1);   // 8 mm proud of the soffit (no coplanar flicker)
    }
  }
  return path;
}

/**
 * Railing along a plan polyline at deck level y0: glass panels with clamps + top rail, or bar
 * railing (posts + rails). The polyline is the railing line (usually band path offset 0.13).
 * o: {kind:'glass'|'bars', top=1.1 (above y0), key, glassKey, segment=1.5, startH (base of glass)}
 */
export function railing(b, pts0, y0, o = {}) {
  if (pts0.length < 2) return;
  const closed = !!o.closed;
  const pts = simplify(pts0, 0.02, closed);
  const kind = o.kind || 'glass', top = y0 + (o.top ?? 1.1), rk = o.key || 'aluminium';
  const base = y0 + (o.startH ?? 0.28);
  const P = closed ? [...pts, pts[0]] : pts;
  const cum = cumLength(P); const L = cum[cum.length - 1];
  if (L < 0.2) return;
  const rail = P.map((p) => [p[0], top, p[1]]);
  if (kind === 'glass') {
    // top rail (flat oval cap) + continuous base shoe; frameless glass panels between
    b.sweep(rk, rail, RAIL_TOP, { closed: false, smoothAngle: 50 });
    b.sweep(rk, P.map((p) => [p[0], base - 0.07, p[1]]), RAIL_SHOE, { closed: false, smoothAngle: 20 });
    const seg = o.segment ?? 1.9;
    const n = Math.max(1, Math.round(L / seg));
    const gk = o.glassKey || 'glass_railing';
    for (let i = 0; i < n; i++) {
      const s0 = (L * i) / n + 0.008, s1 = (L * (i + 1)) / n - 0.008;
      glassStrip(b, gk, slicePolyline(P, cum, s0, s1), base + 0.02, top - 0.03);
    }
  } else {
    b.tube(rk, rail, 0.025, 8);
    const n = Math.max(1, Math.round(L / 1.2));
    for (let i = 0; i <= n; i++) {
      const q = pointAt(P, cum, (L * i) / n);
      b.box(rk, q[0] - 0.02, y0 + 0.02, q[1] - 0.02, q[0] + 0.02, top - 0.02, q[1] + 0.02, PX | NX | PZ | NZ);
    }
    for (const hh of [0.18, 0.48, 0.78]) b.tube(rk, P.map((p) => [p[0], y0 + hh + (o.startH ?? 0) * 0.4, p[1]]), 0.011, 6);
  }
  if (b.collecting) {
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], c = P[i + 1];
      b.colQuad(a[0], y0, a[1], c[0], y0, c[1], c[0], top, c[1], a[0], top, a[1]);
    }
  }
}

/**
 * Thin vertical glass panel along a plan polyline between heights y0..y1: two faces 12 mm apart
 * plus a polished top edge (direct emission, no profile analysis).
 */
export function glassStrip(b, key, pts, y0, y1, t = 0.006) {
  const n = pts.length; if (n < 2) return;
  const p = b.part(key);
  const prev = b.uvMode; b.uvMode = 1;
  const off = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    let dx = c[0] - a[0], dz = c[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    off.push([-dz, dx]); // right of travel (= outward for perimeter-order band railings), matches the quad winding
  }
  let u = 0;
  const outer = [], inner = [], topO = [], topI = [];
  for (let i = 0; i < n; i++) {
    if (i) u += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [ox, oz] = off[i];
    const xo = pts[i][0] + ox * t, zo = pts[i][1] + oz * t, xi = pts[i][0] - ox * t, zi = pts[i][1] - oz * t;
    outer.push(b.vert(p, xo, y0, zo, ox, 0, oz, u, 0), b.vert(p, xo, y1, zo, ox, 0, oz, u, y1 - y0));
    inner.push(b.vert(p, xi, y0, zi, -ox, 0, -oz, u, 0), b.vert(p, xi, y1, zi, -ox, 0, -oz, u, y1 - y0));
    topO.push(b.vert(p, xo, y1, zo, 0, 1, 0, u, 0)); topI.push(b.vert(p, xi, y1, zi, 0, 1, 0, u, t * 2));
  }
  for (let i = 0; i < n - 1; i++) {
    b.q(p, outer[i * 2], outer[i * 2 + 2], outer[i * 2 + 3], outer[i * 2 + 1]);
    b.q(p, inner[i * 2 + 2], inner[i * 2], inner[i * 2 + 1], inner[i * 2 + 3]);
    b.q(p, topO[i], topO[i + 1], topI[i + 1], topI[i]);
  }
  b.uvMode = prev;
}

/** Flat n-gon facing up (+1) or down (−1) — light lenses, drain grates. */
export function disc(b, key, x, y, z, r, facing = 1, n = 8) {
  const p = b.part(key), ny = facing > 0 ? 1 : -1;
  const c = b.vert(p, x, y, z, 0, ny, 0, 0, 0);
  const ring = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ring.push(b.vert(p, x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, ny, 0, 0, 0)); }
  for (let i = 0; i < n; i++) { const a = ring[i], c2 = ring[(i + 1) % n]; if (facing > 0) b.tri(p, c, c2, a); else b.tri(p, c, a, c2); }
}

/**
 * Integrated planter trough on a band between path distances s0..s1 (inner side of the
 * upstand), soil + shrubs + trailing plants spilling over the band edge.
 */
export function bandPlanter(b, path, s0, s1, y, seed, o = {}) {
  const ip = offsetPolyline(path.pts, 0.24, path.closed);
  const ip2 = offsetPolyline(path.pts, 0.62, path.closed);
  const cum = cumLength(ip), sub = slicePolyline(ip, cum, s0, s1);
  const cum2 = cumLength(ip2), sub2 = slicePolyline(ip2, cum2, s0 * cum2[cum2.length - 1] / cum[cum.length - 1], s1 * cum2[cum2.length - 1] / cum[cum.length - 1]);
  if (sub.length < 2 || sub2.length < 2) return;
  const h = o.h ?? 0.42, key = o.key || 'ceramic_band';
  // inner wall of the trough along sub2 (facing the balcony)
  b.sweep(key, sub2.map((p) => [p[0], y - 0.03, p[1]]), [[0.0, 0.0], [0.06, 0.0], [0.06, h], [0.03, h + 0.02], [0.0, h]], { smoothAngle: 40 });
  // soil strip between sub and sub2 (resampled to matching counts)
  const cs = cumLength(sub), L = cs[cs.length - 1];
  const cs2 = cumLength(sub2), L2 = cs2[cs2.length - 1];
  {
    const m = Math.max(2, Math.ceil(L / 0.6) + 1);
    const p = b.part('soil'), ys = y + h - 0.08;
    let pa = -1, pb = -1;
    for (let k = 0; k < m; k++) {
      const qa = pointAt(sub, cs, (L * k) / (m - 1)), qb = pointAt(sub2, cs2, (L2 * k) / (m - 1));
      const va = b.vert(p, qa[0], ys, qa[1], 0, 1, 0, 0, 0), vb = b.vert(p, qb[0], ys, qb[1], 0, 1, 0, 0, 0);
      if (k) { const cr = (qa[0] - qb[0]) * 0; void cr; b.q(p, pa, va, vb, pb); b.q(p, pa, pb, vb, va); }
      pa = va; pb = vb;
    }
  }
  // plants
  const n = Math.max(1, Math.round(L / 0.72));
  for (let i = 0; i < n; i++) {
    const q = pointAt(sub, cs, (L * (i + 0.5)) / n);
    const q2 = pointAt(sub2, cs2, (L2 * (i + 0.5)) / n);
    const mx = (q[0] + q2[0]) / 2, mz = (q[1] + q2[1]) / 2;
    shrub(b, mx, y + h - 0.08, mz, 0.46 + ((seed + i * 13) % 7) * 0.05, (seed * 31 + i) >>> 0, { flowers: (seed + i) % 4 === 0 });
    if ((seed + i) % 2 === 0 && i % 2 === 0) {
      // trailing over the outer edge (direction = outward from building centre)
      const ox = q[0] - q2[0], oz = q[1] - q2[1], l = Math.hypot(ox, oz) || 1;
      b.push(); b.translate(q[0] + (ox / l) * 0.22, 0, q[1] + (oz / l) * 0.22); b.rotY(-Math.atan2(oz, ox) + Math.PI / 2);
      trailing(b, 0, y + 0.25, 0, 0.6 + ((seed + i) % 4) * 0.15, (seed * 17 + i) >>> 0, 1);
      b.pop();
    }
  }
}

/** Railing line for a band path (offset inwards from the outer edge to the upstand middle). */
export function railLine(path, inset = 0.13) { return offsetPolyline(path.pts, inset, path.closed); }

export { PX, NX, PY, NY, PZ, NZ };
