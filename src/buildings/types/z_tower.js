// Loft-tower engine for the Zhurong family (owner: buildings-z): storeys of a plan shape that changes
// with height (taper, twist, lens / sail, round), clad in a curtain wall whose panes, spandrels and
// mullions follow the shape; matching far-LOD loft (mass_facade) with the same window ids; floor slabs,
// core and colliders for 'full'. Helper module (no default export) used by civic_tower.js / office.js.
//
// Plan polygons are in FACADE ORDER (kit/polyfacade.js: front-left → front-right → back-right →
// back-left, negative shoelace area), so edge k→k+1 runs left→right seen from outside and its outward
// normal is (−uz, ux) — the wall frame of the kit.
//
// Window ids: storey i is resampled into n_i bays of equal arc length (n_i = round(P_i / bayW)); pane k
// carries (floor i, bay k). The far loft gives every storey band facade.bayW = P_i / n_i and
// uv.u = k·bayW_i at near vertex k, so the mass shader's bay = floor(u / bayW) = k and its floor index
// (groundH = FFL + ground storey, floorH = typical storey) = i: identical lights near and far.

import * as K from '../kit/index.js';
import { kindCode } from '../kit/plan.js';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------
// plan shapes (facade order, first vertex at the front-left, angle decreasing from the front)
// ---------------------------------------------------------------------------------------------
/** Superellipse |x/a|^p + |z/b|^p = 1 rotated by rot (rad, CCW seen from above), n points. */
export function superEllipse(cx, cz, a, b, p, n, rot = 0) {
  const out = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  const a0 = Math.PI / 2 + Math.PI / n;
  for (let k = 0; k < n; k++) {
    const t = a0 - (k * 2 * Math.PI) / n;
    const ct = Math.cos(t), st = Math.sin(t);
    const x = a * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / p), z = b * Math.sign(st) * Math.pow(Math.abs(st), 2 / p);
    out.push([cx + x * c + z * s, cz - x * s + z * c]);
  }
  return out;
}

/**
 * Sail / lens plan: convex back arc (towards −z) and a flatter front arc, pointed ends at ±a.
 * bulgeF / bulgeB = sagitta of the front / back arc (front may be negative = concave crescent).
 */
export function lensPlan(cx, cz, a, bulgeF, bulgeB, n, rot = 0) {
  const out = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  const half = Math.max(4, Math.floor(n / 2));
  // front edge: left tip (−a) → right tip (+a), z = bulgeF·(1 − (x/a)²)^0.85 ; back edge: right → left
  const tipR = 0.06 * a;                     // blunt tips (rounded nose)
  for (let k = 0; k < half; k++) {
    const t = k / half, x = -a + 2 * a * t;
    const q = 1 - (x / a) * (x / a);
    out.push([x, bulgeF * Math.pow(Math.max(q, 0), 0.85) + (k === 0 ? 0 : 0)]);
  }
  for (let k = 0; k < half; k++) {
    const t = k / half, x = a - 2 * a * t;
    const q = 1 - (x / a) * (x / a);
    out.push([x, -bulgeB * Math.pow(Math.max(q, 0), 0.75)]);
  }
  // blunt the two tips slightly (move the tip vertices inwards along x)
  out[0][0] += tipR; out[half][0] -= tipR;
  return out.map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
}

export function polyPerimeter(pts) {
  let P = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; P += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return P;
}

/** Resample a closed polygon into n points evenly spaced by arc length, starting at vertex 0. */
export function resampleClosed(pts, n) {
  const m = pts.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m]; cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const P = cum[m];
  const out = new Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (P * k) / n;
    while (j < m - 1 && cum[j + 1] < s) j++;
    const a = pts[j], b = pts[(j + 1) % m];
    const L = cum[j + 1] - cum[j] || 1e-9, t = (s - cum[j]) / L;
    out[k] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return { pts: out, P };
}

/** Outward unit normals at the vertices of a facade-ordered ring (average of the adjacent edges). */
export function ringNormals(r) {
  const n = r.length, out = new Array(n);
  for (let k = 0; k < n; k++) {
    const p = r[(k - 1 + n) % n], q = r[k], s = r[(k + 1) % n];
    let ax = q[0] - p[0], az = q[1] - p[1]; const la = Math.hypot(ax, az) || 1; ax /= la; az /= la;
    let bx = s[0] - q[0], bz = s[1] - q[1]; const lb = Math.hypot(bx, bz) || 1; bx /= lb; bz /= lb;
    let nx = -(az + bz), nz = ax + bx; const ln = Math.hypot(nx, nz) || 1; nx /= ln; nz /= ln;
    out[k] = [nx, nz];
  }
  return out;
}

/** Offset a ring outwards by d along the vertex normals (simple, for smooth convex-ish rings). */
export function offsetRing(r, d, N = null) {
  const nn = N || ringNormals(r);
  return r.map((p, k) => [p[0] + nn[k][0] * d, p[1] + nn[k][1] * d]);
}

/** Storey list: ground storey gh, then fh. */
export function towerLevels(ffl, gh, fh, nF) {
  const out = [];
  let y = ffl;
  for (let i = 0; i < nF; i++) { const h = i === 0 ? gh : fh; out.push({ level: i, y, h }); y += h; }
  return out;
}

// ---------------------------------------------------------------------------------------------
// curtain wall loft
// ---------------------------------------------------------------------------------------------
/**
 * Curtain-wall storeys. o: {
 *   levels: [{level, y, h}], planAt(y) → facade-ordered polygon (dense, consistent start vertex),
 *   bayW=3.0, spandrel=0.95 (opaque band at the top of each storey), glassKey, frameKey='aluminium',
 *   spandrelKey='aluminium_dark', spandrelTint, mullD=0.2, mullW=0.08, mullKey,
 *   kind='office' (interior mapping), depth=9 (room depth),
 *   back(level) → inner faces + clear glass (real interior floors), louvre(level) → plant floor,
 *   open(level) → storey left open (no glass, mullions or transoms; info.open = true — sky gardens),
 *   hole(level, k, mid:[x,z], nrm:[nx,nz]) → true = no glass in bay k (doors / porch openings),
 *   groupBays=3 (interior-mapped rooms span this many bays), uOffset=0 (bay id offset)
 * }
 * Returns [{level, y, h, ring, top, n, P, bayW, N}] (bottom ring at y, top ring at y+h).
 */
export function loftCurtain(ctx, o) {
  const b = ctx.b, s = ctx.spec;
  const bayT = o.bayW ?? 3.0, sp = o.spandrel ?? 0.95;
  const fk = o.frameKey || 'aluminium', mk = o.mullKey || fk;
  const sk = o.spandrelKey || 'aluminium_dark';
  const md = o.mullD ?? 0.2, mw = o.mullW ?? 0.08;
  const kind = kindCode(o.kind || 'office');
  const grp = o.groupBays ?? 3;
  const out = [];
  const seed = ((s.hash >>> 5) % 991) / 991;
  for (const L of o.levels) {
    const y0 = L.y, y1 = L.y + L.h;
    const base = o.planAt(y0), topP = o.planAt(y1);
    const P0 = polyPerimeter(base);
    const n = Math.max(8, Math.round(P0 / bayT));
    const R0 = resampleClosed(base, n).pts, R1 = resampleClosed(topP, n).pts;
    const bayW = P0 / n;
    const N0 = ringNormals(R0), N1 = ringNormals(R1);
    const info = { level: L.level, y: y0, h: L.h, ring: R0, top: R1, n, P: P0, bayW, N: N0 };
    out.push(info);
    if (o.open && o.open(L.level)) { info.open = true; continue; }     // open storey (sky garden): caller builds it
    const back = o.back ? o.back(L.level) : false;
    const louvre = o.louvre ? o.louvre(L.level) : false;
    const gk = back ? 'glass_clear' : (o.glassKey || 'glass_window');
    const at = (k, y) => { const t = (y - y0) / L.h, a = R0[k % n], c = R1[k % n]; return [a[0] + (c[0] - a[0]) * t, y, a[1] + (c[1] - a[1]) * t]; };
    const yv1 = y1 - sp;
    const yg0 = y0 + 0.02;
    const holes = new Array(n).fill(false);
    if (o.hole) for (let k = 0; k < n; k++) {
      const a = R0[k], c = R0[(k + 1) % n];
      const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      let ex = c[0] - a[0], ez = c[1] - a[1]; const el = Math.hypot(ex, ez) || 1;
      holes[k] = !!o.hole(L.level, k, mid, [-ez / el, ex / el]);
    }
    // ---- panes ----
    for (let k = 0; k < n; k++) {
      if (holes[k]) continue;
      const A0 = at(k, yg0), B0 = at(k + 1, yg0), B1 = at(k + 1, yv1), A1 = at(k, yv1);
      const w = Math.hypot(B0[0] - A0[0], B0[2] - A0[2]), hh = yv1 - yg0;
      if (louvre) {
        K.clearGlassRoom(b);
        b.quad('grille_dark', A0[0], A0[1], A0[2], B0[0], B0[1], B0[2], B1[0], B1[1], B1[2], A1[0], A1[1], A1[2], [0, 0, w, 0, w, hh, 0, hh]);
      } else if (hh > 0.3) {
        const room = { u0: (k % grp) * bayW, w: grp * bayW, d: o.depth ?? 9, h: Math.max(2.7, L.h - 0.9), sill: 0.02, kind, seed: (seed + k * 0.618) % 1, floor: L.level, bay: k + (o.uOffset || 0), hash: s.hash, profile: s._profile | 0 };
        K.setGlassRoom(b, room, 0, 0);
        b.quad(gk, A0[0], A0[1], A0[2], B0[0], B0[1], B0[2], B1[0], B1[1], B1[2], A1[0], A1[1], A1[2], [0, 0, w, 0, w, hh, 0, hh]);
        if (back) b.quad(gk, B0[0], B0[1], B0[2], A0[0], A0[1], A0[2], A1[0], A1[1], A1[2], B1[0], B1[1], B1[2], [0, 0, w, 0, w, hh, 0, hh]);
      }
      // spandrel (slab zone) slightly behind the glass plane
      const S0 = at(k, yv1), S1 = at(k + 1, yv1), S2 = at(k + 1, y1), S3 = at(k, y1);
      const nk = N0[k], nk1 = N0[(k + 1) % n];
      const ins = 0.02;
      K.clearGlassRoom(b);
      if (o.spandrelTint) b.pushTint(o.spandrelTint);
      b.quad(sk, S0[0] - nk[0] * ins, S0[1], S0[2] - nk[1] * ins, S1[0] - nk1[0] * ins, S1[1], S1[2] - nk1[1] * ins, S2[0] - nk1[0] * ins, S2[1], S2[2] - nk1[1] * ins, S3[0] - nk[0] * ins, S3[1], S3[2] - nk[1] * ins);
      if (o.spandrelTint) b.popTint();
      if (back) b.withTint([0.95, 0.95, 0.93], () => b.quad('plaster', S1[0] - nk1[0] * 0.08, S1[1], S1[2] - nk1[1] * 0.08, S0[0] - nk[0] * 0.08, S0[1], S0[2] - nk[1] * 0.08, S3[0] - nk[0] * 0.08, S3[1], S3[2] - nk[1] * 0.08, S2[0] - nk1[0] * 0.08, S2[1], S2[2] - nk1[1] * 0.08));
    }
    K.clearGlassRoom(b);
    // ---- mullions at every vertex (outer face + two sides), lean with the loft ----
    const mp = b.part(mk);
    for (let k = 0; k < n; k++) {
      if (holes[k] && holes[(k - 1 + n) % n]) continue;
      const a = R0[k], c = R1[k], na = N0[k], nc = N1[k];
      const ta = [na[1], -na[0]], tc = [nc[1], -nc[0]];
      const dd = louvre ? md * 0.5 : md;
      const pt = (p, nrm, t, su, sn, y) => [p[0] + t[0] * su + nrm[0] * sn, y, p[1] + t[1] * su + nrm[1] * sn];
      const yb = y0, yt = y1;
      const BL = pt(a, na, ta, -mw / 2, dd, yb), BR = pt(a, na, ta, mw / 2, dd, yb), TL = pt(c, nc, tc, -mw / 2, dd, yt), TR = pt(c, nc, tc, mw / 2, dd, yt);
      const BLi = pt(a, na, ta, -mw / 2, -0.04, yb), BRi = pt(a, na, ta, mw / 2, -0.04, yb), TLi = pt(c, nc, tc, -mw / 2, -0.04, yt), TRi = pt(c, nc, tc, mw / 2, -0.04, yt);
      b.quad(mk, BL[0], BL[1], BL[2], BR[0], BR[1], BR[2], TR[0], TR[1], TR[2], TL[0], TL[1], TL[2]);          // outer
      b.quad(mk, BLi[0], BLi[1], BLi[2], BL[0], BL[1], BL[2], TL[0], TL[1], TL[2], TLi[0], TLi[1], TLi[2]);  // left side
      b.quad(mk, BR[0], BR[1], BR[2], BRi[0], BRi[1], BRi[2], TRi[0], TRi[1], TRi[2], TR[0], TR[1], TR[2]);  // right side
    }
    void mp;
    // ---- transoms: slab line (outer + soffit + top) and vision/spandrel line (outer) ----
    for (const [yy, hh2, dep, full] of [[y0, 0.07, md * 0.75, true], [yv1, 0.05, md * 0.35, false]]) {
      for (let k = 0; k < n; k++) {
        if (holes[k] && yy < y0 + 0.5) continue;
        const A = at(k, yy), C = at(k + 1, yy), na = N0[k], nc = N0[(k + 1) % n];
        const ax = A[0] + na[0] * dep, az = A[2] + na[1] * dep, cx = C[0] + nc[0] * dep, cz = C[2] + nc[1] * dep;
        b.quad(fk, ax, yy - hh2, az, cx, yy - hh2, cz, cx, yy + hh2, cz, ax, yy + hh2, az);
        if (full) {
          b.quad(fk, A[0], yy + hh2, A[2], ax, yy + hh2, az, cx, yy + hh2, cz, C[0], yy + hh2, C[2]);
          b.quad(fk, ax, yy - hh2, az, A[0], yy - hh2, A[2], C[0], yy - hh2, C[2], cx, yy - hh2, cz);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// far LOD loft (mass_facade, same window ids)
// ---------------------------------------------------------------------------------------------
/**
 * o: {levels, planAt, bayW, groundH (FFL + ground storey), floorH, eaveY, flags, step (mass vertex stride,
 *     default ≈ 4 m chords), y0 (bottom of the first band, below ground)}
 * Emits one band per storey; returns the top ring.
 */
export function loftMass(ctx, o) {
  const b = ctx.b, s = ctx.spec;
  const styleId = K.STYLE_ID[ctx.style?.id] ?? 5;
  const hhi = (s.hash >>> 16) & 0xffff, hlo = s.hash & 0xffff;
  const flags = (o.flags || 0) | ((((s._profile | 0) & 7) << 4));
  const bayT = o.bayW ?? 3.0;
  let lastTop = null;
  b.uvMode = 1;
  for (let li = 0; li < o.levels.length; li++) {
    const L = o.levels[li];
    const y0 = li === 0 && o.y0 != null ? o.y0 : L.y, y1 = L.y + L.h;
    const base = o.planAt(L.y), topP = o.planAt(y1);
    const P0 = polyPerimeter(base);
    const n = Math.max(8, Math.round(P0 / bayT));
    const R0 = resampleClosed(base, n).pts, R1 = resampleClosed(topP, n).pts;
    const bayW = P0 / n;
    const stride = Math.max(1, Math.round((o.chord ?? 4.5) / bayW));
    const idx = [];
    for (let k = 0; k < n; k += stride) idx.push(k);
    idx.push(n);
    b.setExtra('facade', o.floorH, bayW, styleId, o.groundH);
    b.setExtra('facadeId', hhi, hlo, o.eaveY, flags | (o.louvre && o.louvre(L.level) ? 1 : 0));
    // the first band extends below ground: shift its bottom ring along the loft
    const at0 = (k) => { const a = R0[k % n], c = R1[k % n], t = (y0 - L.y) / L.h; return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]; };
    for (let j = 0; j < idx.length - 1; j++) {
      const ka = idx[j], kc = idx[j + 1];
      const A = at0(ka), C = at0(kc), At = R1[ka % n], Ct = R1[kc % n];
      const ua = ka * bayW, uc = kc * bayW;
      b.quad('mass_facade', A[0], y0, A[1], C[0], y0, C[1], Ct[0], y1, Ct[1], At[0], y1, At[1], [ua, y0, uc, y0, uc, y1, ua, y1]);
    }
    lastTop = R1;
  }
  b.uvMode = 0;
  return lastTop;
}

// ---------------------------------------------------------------------------------------------
// slabs, roof caps, cores
// ---------------------------------------------------------------------------------------------
/** Floor slab inside a ring (inset), with optional rect holes [{x0,x1,z0,z1}] (core). Top face + soffit + colliders. */
export function ringSlab(ctx, ring, y, o = {}) {
  const b = ctx.b;
  const inner = offsetRing(ring, -(o.inset ?? 0.12));
  const outer = inner.map((p) => [p[0], p[1]]).reverse();          // polyY expects CCW (positive area)
  const holes = (o.holes || []).map((r) => [[r.x0, r.z0], [r.x0, r.z1], [r.x1, r.z1], [r.x1, r.z0]]);
  if (o.top !== false) b.polyY(o.key || 'stone_floor', outer, holes, y, 1);
  if (o.soffit !== false) b.withTint([0.96, 0.96, 0.95], () => b.polyY(o.soffitKey || 'plaster', outer, holes, y - (o.t ?? 0.3), -1));
  if (b.collecting && o.collide !== false) b.colPolyY(outer, holes, y);
}

/** Flat roof cap over a ring: parapet (inner faces + swept coping) + membrane deck at y. */
export function ringRoof(ctx, ring, y, o = {}) {
  const b = ctx.b;
  const h = o.parapet ?? 1.1, T = o.T ?? 0.3;
  // outer parapet face (continuation of the curtain wall plane)
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const a = ring[k], c = ring[(k + 1) % n];
    b.quad(o.key || 'ceramic_band', a[0], y, a[1], c[0], y, c[1], c[0], y + h, c[1], a[0], y + h, a[1]);
  }
  K.polyParapet(b, ring, y, h, T, { innerKey: o.innerKey || 'render_white', copingKey: o.copingKey || 'aluminium' });
  const inner = offsetRing(ring, -T).reverse();
  b.polyY(o.surface || 'roof_membrane', inner, [], y + 0.02, 1);
  if (b.collecting) b.colPolyY(inner, [], y + 0.02);
  return offsetRing(ring, -T);
}

/**
 * Service core through the storeys: shear walls (white render outside the lift lobby side, concrete
 * elsewhere), lift doors on the lobby face per storey, closed top with a lift overrun box.
 * o: {x0,x1,z0,z1, y0, y1, levels, doorSide:'front', lifts:2, key, full}
 */
export function serviceCore(ctx, o) {
  const b = ctx.b;
  const { x0, x1, z0, z1, y0, y1 } = o;
  const T = 0.3, key = o.key || 'concrete_smooth';
  // four walls (outer faces) + top
  b.box(key, x0, y0, z0, x1, y1, z1, 1 | 2 | 16 | 32 | 4);
  if (b.collecting) b.colBox(x0, y0, z0, x1, y1, z1);
  // lift doors (brushed steel leaves in a frame) on the door face per storey
  if (o.levels && o.full) {
    const nL = o.lifts ?? 2, W = x1 - x0;
    for (const L of o.levels) {
      if (o.skipDoors && o.skipDoors(L.level)) continue;
      for (let i = 0; i < nL; i++) {
        const cx = x0 + (W * (i + 0.5)) / nL;
        b.box('steel_brushed', cx - 0.65, L.y, z1, cx + 0.65, L.y + 2.3, z1 + 0.025, 16 | 1 | 2 | 4);
        b.box('aluminium_dark', cx - 0.75, L.y + 2.3, z1, cx + 0.75, L.y + 2.42, z1 + 0.04, 63 & ~8);
        b.box('light_cyan', cx - 0.12, L.y + 2.45, z1 + 0.01, cx + 0.12, L.y + 2.5, z1 + 0.03, 63);
      }
    }
  }
}

/**
 * Fin lofted along a 3D centreline with its depth axis along `nrm(t)` (unit [x,z]) — white sail fins,
 * corner fins, spines. o: {depth(t)|number, thick(t)|number, seg=10, key, capTop, capBottom, tint}
 */
export function surfaceFin(ctx, pts, nrm, o = {}) {
  const b = ctx.b;
  const m = pts.length;
  if (m < 2) return;
  const seg = o.seg ?? 10;
  const D = typeof o.depth === 'function' ? o.depth : () => o.depth ?? 0.8;
  const Th = typeof o.thick === 'function' ? o.thick : () => o.thick ?? 0.35;
  const NF = typeof nrm === 'function' ? nrm : () => nrm;
  const key = o.key || 'ceramic_band';
  if (o.tint) b.pushTint(o.tint);
  const p = b.part(key);
  const prevMode = b.uvMode; b.uvMode = 1;
  const rings = [];
  let acc = 0;
  for (let i = 0; i < m; i++) {
    const t = i / (m - 1);
    if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    const nn = NF(t, i), nx = nn[0], nz = nn[1], ux = nz, uz = -nx;
    const dd = D(t, i), th = Th(t, i);
    const ring = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      // section: half-ellipse outward (depth dd) + flat back (against the facade)
      const cn = Math.cos(a), cu = Math.sin(a);
      const sn = cn > 0 ? cn * dd : cn * 0.15 * dd;
      const su = cu * th * 0.5;
      let gn = cn / Math.max(cn > 0 ? dd : 0.15 * dd, 1e-3), gu = cu / Math.max(th * 0.5, 1e-3);
      const gl = Math.hypot(gn, gu) || 1; gn /= gl; gu /= gl;
      const x = pts[i][0] + nx * sn + ux * su, z = pts[i][2] + nz * sn + uz * su;
      ring.push(b.vert(p, x, pts[i][1], z, nx * gn + ux * gu, 0, nz * gn + uz * gu, (k / seg) * (dd + th) * 1.5, acc));
    }
    rings.push(ring);
  }
  for (let i = 0; i < m - 1; i++) for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; b.q(p, rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]); }
  b.uvMode = prevMode;
  const cap = (i, up) => {
    const c = pts[i], t = i / (m - 1), nn = NF(t, i), dd = D(t, i), th = Th(t, i);
    const ux = nn[1], uz = -nn[0];
    const ci = b.vert(p, c[0] + nn[0] * dd * 0.4, c[1], c[2] + nn[1] * dd * 0.4, 0, up ? 1 : -1, 0, 0, 0);
    const ids = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2, cn = Math.cos(a), cu = Math.sin(a);
      const sn = cn > 0 ? cn * dd : cn * 0.15 * dd, su = cu * th * 0.5;
      ids.push(b.vert(p, c[0] + nn[0] * sn + ux * su, c[1], c[2] + nn[1] * sn + uz * su, 0, up ? 1 : -1, 0, 0, 0));
    }
    for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; if (up) b.tri(p, ci, ids[k], ids[k2]); else b.tri(p, ci, ids[k2], ids[k]); }
  };
  if (o.capTop !== false) cap(m - 1, true);
  if (o.capBottom) cap(0, false);
  if (o.tint) b.popTint();
}

/** Point + normal on the loft surface at arc fraction f (0..1 from vertex 0) and height y. */
export function surfacePoint(planAt, f, y, off = 0) {
  const P = planAt(y);
  const R = resampleClosed(P, 240).pts;
  const n = R.length;
  const x = ((f % 1) + 1) % 1 * n, k = Math.floor(x) % n, t = x - Math.floor(x);
  const a = R[k], c = R[(k + 1) % n];
  const p = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
  let ex = c[0] - a[0], ez = c[1] - a[1]; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  const nrm = [-ez, ex];
  return { p: [p[0] + nrm[0] * off, y, p[1] + nrm[1] * off], n: nrm };
}

/** Horizontal ring band (white slab edge / sky-garden balustrade) around a ring at y: outer face + top + soffit. */
export function ringBand(ctx, ring, y, o = {}) {
  const b = ctx.b;
  const proj = o.proj ?? 0.6, h0 = o.h0 ?? 0.35, h1 = o.h1 ?? 0.08;
  const N = ringNormals(ring);
  const n = ring.length;
  const key = o.key || 'ceramic_band';
  if (o.tint) b.pushTint(o.tint);
  for (let k = 0; k < n; k++) {
    const a = ring[k], c = ring[(k + 1) % n], na = N[k], nc = N[(k + 1) % n];
    const A = [a[0] + na[0] * proj, a[1] + na[1] * proj], C = [c[0] + nc[0] * proj, c[1] + nc[1] * proj];
    b.quad(key, A[0], y - h0, A[1], C[0], y - h0, C[1], C[0], y + h1, C[1], A[0], y + h1, A[1]);
    b.quad(key, A[0], y + h1, A[1], C[0], y + h1, C[1], c[0], y + h1, c[1], a[0], y + h1, a[1]);
    b.quad(o.soffitKey || 'render_white', a[0], y - h0, a[1], c[0], y - h0, c[1], C[0], y - h0, C[1], A[0], y - h0, A[1]);
  }
  if (o.tint) b.popTint();
}

// ---------------------------------------------------------------------------------------------
// sky gardens (refuge storeys of civic / office towers): the storey is left open between white slab
// bands; a glass balustrade runs along the slab edge, a planter ring with shrubs inside it, trees in
// round tubs on a timber deck, benches, and a glazed sky lobby (interior-mapped) set back by 3.2–5.5 m.
// The deck is flush with the floor slab (+2 cm), so the sky-lobby door has no step ('full'); the white
// edge band stands 0.18 m proud outside the balustrade as a kerb. Far LOD: loftMass louvre(level) → mass
// flag 1 with bay width = the green sky-garden storey of the far facade shaders.
// ---------------------------------------------------------------------------------------------
/** Door bay of the sky-lobby glass line: the segment facing the front (+z) near x = 0. */
export function skyDoor(a, q) {
  const mx = (a[0] + q[0]) / 2, ex = q[0] - a[0], ez = q[1] - a[1], el = Math.hypot(ex, ez) || 1;
  return (ex / el) > 0.9 && Math.abs(mx) < 2.4 && (a[1] + q[1]) > 0;     // outward normal (−ez, ex)·z > 0.9
}

/**
 * Sky garden on an open loft storey c ({level, y, h, ring, top, n}) of a tower whose plan is planAt(y).
 * o: {white (tint), uOffset (bay id base of the sky-lobby panes), doorX (x of the sky-lobby door, 0)}
 * Returns the inner (sky lobby) loft storey (ring / top) for colliders.
 */
export function skyGarden(ctx, planAt, c, idx, o = {}) {
  const b = ctx.b, s = ctx.spec, white = o.white || ctx.inst.bandTint, full = ctx.full;
  const y0 = c.y, y1 = c.y + c.h, deckY = y0 + 0.02;
  let area = 0;
  for (let k = 0; k < c.n; k++) { const a = c.ring[k], q = c.ring[(k + 1) % c.n]; area += a[0] * q[1] - q[0] * a[1]; }
  const R = Math.sqrt(Math.abs(area) / 2 / Math.PI);
  const gi = clamp(R * 0.2, 3.2, 5.5);
  // white slab edge bands (bottom = kerb outside the balustrade, top = soffit edge of the storey above)
  ringBand(ctx, c.ring, y0 + 0.1, { proj: 0.85, h0: 0.45, h1: 0.1, tint: white });
  ringBand(ctx, c.top, y1, { proj: 0.85, h0: 0.35, h1: 0.12, tint: white });
  // glazed sky lobby line (same loft, inset); the door bay stays open in 'full' (real floor behind)
  const inner = loftCurtain(ctx, {
    levels: [{ level: c.level, y: y0, h: c.h }], planAt: (y) => offsetRing(planAt(y), -gi), bayW: 3.0, spandrel: 0.55,
    glassKey: 'glass_shop', frameKey: 'aluminium', spandrelKey: 'aluminium_dark', kind: 'lobby', depth: 7, uOffset: (o.uOffset ?? 600) + idx * 64, mullD: 0.12,
    hole: full ? (lv, k, mid, nrm) => nrm[1] > 0.9 && Math.abs(mid[0]) < 2.4 : null,
  })[0];
  const iR = inner.ring.map((p) => [p[0], p[1]]), iT = inner.top.map((p) => [p[0], p[1]]);
  // timber deck from the slab edge to the glass line (flush with the lobby floor), white soffit above
  const edge = c.ring.map((p) => [p[0], p[1]]);
  b.polyY('wood_deck', edge.slice().reverse(), [iR], deckY, 1);
  if (b.collecting) b.colPolyY(edge.slice().reverse(), [iR], deckY);
  b.withTint(white, () => b.polyY('render_white', c.top.map((p) => [p[0], p[1]]).reverse(), [iT], y1 - 0.36, -1));
  // glass balustrade along the edge
  K.railing(b, offsetRing(edge, -0.12), deckY, { kind: 'glass', closed: true, top: 1.1 });
  // planter ring inside the balustrade: white walls, soil, shrubs every ~2.4 m
  const pO = offsetRing(edge, -0.4), pI = offsetRing(edge, -1.3);
  const ph = 0.7, n = edge.length;
  b.withTint(white, () => {
    for (let k = 0; k < n; k++) {
      const a = pO[k], q = pO[(k + 1) % n], ai = pI[k], qi = pI[(k + 1) % n];
      b.quad('ceramic_band', a[0], deckY, a[1], q[0], deckY, q[1], q[0], deckY + ph, q[1], a[0], deckY + ph, a[1]);
      b.quad('ceramic_band', qi[0], deckY, qi[1], ai[0], deckY, ai[1], ai[0], deckY + ph, ai[1], qi[0], deckY + ph, qi[1]);
    }
    b.polyY('ceramic_band', pO.slice().reverse(), [offsetRing(edge, -0.48)], deckY + ph, 1);
    b.polyY('ceramic_band', offsetRing(edge, -1.22).reverse(), [pI.map((p) => [p[0], p[1]])], deckY + ph, 1);
  });
  b.polyY('soil', offsetRing(edge, -0.48).reverse(), [offsetRing(edge, -1.22)], deckY + ph - 0.06, 1);
  const seed0 = (s.hash ^ (c.level * 2654435761)) >>> 0;
  const P = polyPerimeter(edge);
  const rs = resampleClosed(offsetRing(edge, -0.85), Math.max(8, Math.round(P / 2.4))).pts;
  rs.forEach((p, k) => K.shrub(b, p[0], deckY + ph - 0.06, p[1], 1.05 + ((k * 7) % 5) * 0.12, (seed0 + k * 31) >>> 0));   // lush planting reads from the street
  // trees in round tubs + benches between them, on the middle line of the deck
  const mid = offsetRing(edge, -(1.3 + (gi - 1.3) * 0.5));
  const nT = Math.max(6, Math.round(P / 11));
  const tp = resampleClosed(mid, nT * 2).pts;
  for (let k = 0; k < tp.length; k++) {
    const p = tp[k], q = tp[(k + 1) % tp.length];
    if (k % 2 === 0) {
      if (full && Math.abs(p[0]) < 3.5 && p[1] > 0) continue;                // keep the sky-lobby door clear
      b.withTint(white, () => b.cylinder('ceramic_band', p[0], deckY, p[1], 0.62, 0.5, 18, { top: false }));
      b.polyY('soil', K.ringPolygon(p[0], p[1], 0.55, 14).reverse(), [], deckY + 0.46, 1);
      K.smallTree(b, p[0], deckY + 0.46, p[1], 2.7 + ((k * 13) % 7) * 0.05, (seed0 + k * 97) >>> 0);
      if (b.collecting) b.colBox(p[0] - 0.62, deckY, p[1] - 0.62, p[0] + 0.62, deckY + 0.5, p[1] + 0.62);
    } else {
      const t = [q[0] - tp[k - 1][0], q[1] - tp[k - 1][1]];
      K.bench(b, p[0], deckY, p[1], Math.atan2(-t[1], t[0]));
    }
  }
  // soffit downlights (night-gated warm points) over the deck + a continuous warm line along the edge
  const dl = resampleClosed(offsetRing(c.top.map((p) => [p[0], p[1]]), -gi * 0.45), Math.max(8, Math.round(P / 4))).pts;
  for (const p of dl) b.box('light_warm', p[0] - 0.12, y1 - 0.38, p[1] - 0.12, p[0] + 0.12, y1 - 0.36, p[1] + 0.12, 4);
  return inner;
}
