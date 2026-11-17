// Worker-side structure of ONE long bridge (decision DB: urban marks water / gorge crossings of 300–3000 m on
// tile road / rail pieces with bridgeType 'cable' | 'arch' | 'girder', bridgeSpan, clearance, bridgeS, pylons,
// archRise). Pure JS, no THREE. OWNER: city agent.
//
// Input (render/city/bridges.js stitches the pieces of every streamed tile by bridgeS): the deck centreline runs
// in a bridge frame (x east, y up, z south at the frame origin c·R; y ≈ height a.s.l. near the origin) with the
// global s of each point, the pylons {s, h, shape, base, baseR}, the deck width / kind, the water level.
// Output: {parts:[{material, position, normal, uv, color, index}], stats} in the bridge frame.
//
// What is built (the street tiles keep the walkable deck top — asphalt, sidewalks, kerbs, railings, colliders —
// of the same pieces near the camera; this is everything else, at every distance):
//  * deck girder: top layer 6 cm under the street deck (the far deck surface), edge beam with a lip (road) or a
//    solid parapet (rail), streamlined steel box fairing (cable) / concrete box (girder, arch), flat soffit
//  * cable-stayed: H pylons (two tapered legs outside the deck, lower deck-support beam, upper beam) or A pylons
//    (inclined legs meeting above the deck, single anchorage head), pile cap on a rock-armoured pylon island
//    (oval, revetment slope 1:1.8, paved top with a coping and a service house) or a caisson pier; semi-fan stay
//    cables in two planes (anchored in the legs / the head, deck anchors every 12 m / 10 m at the deck edges out
//    to half the main span); auxiliary piers at the ends of the side spans, approach piers every 60 m / 50 m
//  * girder: box girder (depth ≈ span / 18) on twin-column bents (road) or wall piers (rail), pile caps at the
//    waterline
//  * arch (gorge): two parabolic ribs under the deck from springing blocks on the walls, spandrel columns, cross
//    beams, approach columns
//  * lights: deck light heads (road, staggered like the props lamps; drawn from afar only), walkway lights (rail),
//    red aviation lights on the pylon tops (+ mid height above 100 m), island lamps — materials br_light,
//    'br_light_near', 'br_aviation' expand to a minimum pixel size with their energy kept (bridges.js)
//  * cables: material 'br_cable' expands to a minimum pixel width with a coverage dither (fans read at 5–10 km)
import { R } from '../../core/constants.js';
import { heightAt } from '../../world/terrain.js';

// ---------------------------------------------------------------------------------------------
// mesh builder: flat polygons oriented away from a reference point, smooth tubes
// ---------------------------------------------------------------------------------------------
class Part { constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; } }
class Mesh {
  constructor() { this.parts = new Map(); this.tint = [1, 1, 1]; this.tris = 0; }
  part(k) { let b = this.parts.get(k); if (!b) { b = new Part(); this.parts.set(k, b); } return b; }
  /**
   * Convex polygon with a flat normal (Newell). ref: a point on the INSIDE of the solid — the polygon is wound so
   * its normal points away from it (null: keep the given CCW order). uv: metres (planar on horizontal faces,
   * (along, y) on the others).
   */
  poly(k, pts, ref = null) {
    const n = pts.length; if (n < 3) return;
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0] / n; cy += a[1] / n; cz += a[2] / n;
    }
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    if (ref && (cx - ref[0]) * nx + (cy - ref[1]) * ny + (cz - ref[2]) * nz < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const B = this.part(k), t = this.tint;
    // uv basis
    let ux, uy, uz, vx, vy, vz;
    if (Math.abs(ny) > 0.7) { ux = 1; uy = 0; uz = 0; vx = 0; vy = 0; vz = -1; }
    else { const hl = Math.hypot(nz, nx) || 1; ux = -nz / hl; uy = 0; uz = nx / hl; vx = 0; vy = 1; vz = 0; }
    const o = B.v;
    for (const p of pts) {
      B.p.push(p[0], p[1], p[2]); B.n.push(nx, ny, nz); B.c.push(t[0], t[1], t[2]);
      B.u.push(p[0] * ux + p[1] * uy + p[2] * uz, p[0] * vx + p[1] * vy + p[2] * vz);
    }
    for (let i = 1; i < n - 1; i++) B.i.push(o, o + i, o + i + 1);
    B.v += n; this.tris += n - 2;
  }
  /** box: centre c, horizontal unit axes ex, ez, half sizes */
  box(k, c, ex, ez, hx, hy, hz, bottom = true) {
    const P = (sx, sy, sz) => [c[0] + ex[0] * sx * hx + ez[0] * sz * hz, c[1] + sy * hy, c[2] + ex[2] * sx * hx + ez[2] * sz * hz];
    const f = [
      [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
      [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)], [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
      [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)],
    ];
    if (bottom) f.push([P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)]);
    for (const q of f) this.poly(k, q, c);
  }
  /**
   * Prism between two horizontal sections (chamfered rectangles, `sides` 4 or 8): bottom centre b, top centre t,
   * half sizes along the horizontal unit axes ex / ez at the bottom (ab, bb) and top (at, bt); caps optional.
   */
  prism(k, b, t, ex, ez, ab, bb, at, bt, cap = true, bottomCap = false, chamfer = 0.22) {
    const sec = (c, a, bz) => {
      const ch = Math.min(a, bz) * chamfer, out = [];
      const corners = chamfer > 0
        ? [[a, bz - ch], [a - ch, bz], [-a + ch, bz], [-a, bz - ch], [-a, -bz + ch], [-a + ch, -bz], [a - ch, -bz], [a, -bz + ch]]
        : [[a, bz], [-a, bz], [-a, -bz], [a, -bz]];
      for (const [x, z] of corners) out.push([c[0] + ex[0] * x + ez[0] * z, c[1], c[2] + ex[2] * x + ez[2] * z]);
      return out;
    };
    const S0 = sec(b, ab, bb), S1 = sec(t, at, bt), n = S0.length;
    // side faces point away from the axis midpoint (also right for sheared prisms such as A-pylon legs)
    const mid = [(b[0] + t[0]) / 2, (b[1] + t[1]) / 2, (b[2] + t[2]) / 2];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.poly(k, [S0[i], S0[j], S1[j], S1[i]], mid);
    }
    if (cap) this.poly(k, S1, [t[0], t[1] - 1, t[2]]);
    if (bottomCap) this.poly(k, S0, [b[0], b[1] + 1, b[2]]);
  }
  /**
   * Light head: box with shared corners whose normals are the corner offsets / half sizes (length ≈ √3), so the
   * min-pixel expansion (transformed += normal · grow) scales the whole box — flat face normals would only push
   * the faces apart and the silhouette would never grow.
   */
  lightBox(k, c, hx, hy, hz) {
    const B = this.part(k), t = this.tint, o = B.v;
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      B.p.push(c[0] + sx * hx, c[1] + sy * hy, c[2] + sz * hz); B.n.push(sx, sy * (hy / Math.max(hx, 1e-6)), sz); B.u.push(0, 0); B.c.push(t[0], t[1], t[2]);
    }
    // corner index = (sy>0)*4 + (sz>0)*2 + (sx>0); faces wound CCW from outside
    const F = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const [a, b, c2, d] of F) B.i.push(o + a, o + b, o + c2, o + a, o + c2, o + d);
    B.v += 8; this.tris += 12;
  }
  /** smooth tube a → b (radius ra → rb), `sides` facets, normals radial (min-pixel expansion moves along them) */
  tube(k, a, b, ra, rb, sides = 6) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); if (L < 1e-6) return;
    const tx = dx / L, ty = dy / L, tz = dz / L;
    // perpendicular basis
    let px = -tz, py = 0, pz = tx; let pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) { px = 1; py = 0; pz = 0; pl = 1; }
    px /= pl; py /= pl; pz /= pl;
    const qx = ty * pz - tz * py, qy = tz * px - tx * pz, qz = tx * py - ty * px;
    const B = this.part(k), t = this.tint, o = B.v;
    for (let i = 0; i <= sides; i++) {
      const an = (i / sides) * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
      const nx = px * ca + qx * sa, ny = py * ca + qy * sa, nz = pz * ca + qz * sa;
      B.p.push(a[0] + nx * ra, a[1] + ny * ra, a[2] + nz * ra); B.n.push(nx, ny, nz); B.u.push(i / sides, 0); B.c.push(t[0], t[1], t[2]);
      B.p.push(b[0] + nx * rb, b[1] + ny * rb, b[2] + nz * rb); B.n.push(nx, ny, nz); B.u.push(i / sides, L); B.c.push(t[0], t[1], t[2]);
    }
    for (let i = 0; i < sides; i++) { const v = o + i * 2; B.i.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
    B.v += (sides + 1) * 2; this.tris += sides * 2;
  }
  finish() {
    const parts = [];
    for (const [k, B] of this.parts) {
      if (!B.i.length) continue;
      parts.push({ material: k, position: new Float32Array(B.p), normal: new Float32Array(B.n), uv: new Float32Array(B.u), color: new Float32Array(B.c), index: new Uint32Array(B.i) });
    }
    return parts;
  }
}

// ---------------------------------------------------------------------------------------------
// deck line: runs of (s, x, y, z) → point / tangent / deck top at any s
// ---------------------------------------------------------------------------------------------
class DeckLine {
  constructor(runs) {
    this.runs = [];
    for (const r of runs) {
      const n = r.s.length; if (n < 2) continue;
      this.runs.push({ s: r.s, p: r.p, n, s0: r.s[0], s1: r.s[n - 1] });
    }
    this.runs.sort((a, b) => a.s0 - b.s0);
  }
  get sMin() { return this.runs.length ? this.runs[0].s0 : 0; }
  get sMax() { return this.runs.length ? this.runs[this.runs.length - 1].s1 : 0; }
  /** {x, y, z, tx, tz, nx, nz} at s, or null outside the loaded runs (tol m beyond a run end is clamped) */
  at(s, tol = 0) {
    for (const r of this.runs) {
      if (s < r.s0 - tol || s > r.s1 + tol) continue;
      const ss = Math.max(r.s0, Math.min(r.s1, s));
      let lo = 0, hi = r.n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.s[m] <= ss) lo = m; else hi = m; }
      const f = (ss - r.s[lo]) / Math.max(1e-9, r.s[hi] - r.s[lo]);
      const P = r.p, a = lo * 3, b = hi * 3;
      let tx = P[b] - P[a], tz = P[b + 2] - P[a + 2]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      return { x: P[a] + (P[b] - P[a]) * f, y: P[a + 1] + (P[b + 1] - P[a + 1]) * f, z: P[a + 2] + (P[b + 2] - P[a + 2]) * f, tx, tz, nx: -tz, nz: tx };
    }
    return null;
  }
}

/** resample a run at ≤ step m: [{s, x, y, z, tx, tz, nx, nz}] with smoothed tangents */
function samples(run, step) {
  const out = [];
  const n = run.n;
  for (let i = 0; i < n - 1; i++) {
    const s0 = run.s[i], s1 = run.s[i + 1], k = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let j = 0; j < k; j++) out.push(s0 + (s1 - s0) * (j / k));
  }
  out.push(run.s[n - 1]);
  const line = new DeckLine([run]);
  const S = out.map((s) => line.at(s));
  // central-difference tangents (smooth joints)
  for (let i = 0; i < S.length; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    S[i].tx = tx; S[i].tz = tz; S[i].nx = -tz; S[i].nz = tx; S[i].s = out[i];
  }
  return S;
}

// ---------------------------------------------------------------------------------------------
export function buildBridge(payload) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { type, kind } = payload;
  const F = payload.frame;
  const c = F.c, E = F.E, U = F.U, S = F.S;
  const M = new Mesh();
  const line = new DeckLine((payload.runs || []).map((r) => ({ s: r.s, p: r.p })));
  if (!line.runs.length) return { id: payload.id, parts: [], stats: { triangles: 0 } };
  const rail = kind === 'rail';
  // ---- frame helpers: unit vector under a frame point, frame y of a height above sea level -------------------
  const unitAt = (x, z) => {
    const X = c[0] * R + E[0] * x + S[0] * z, Y = c[1] * R + E[1] * x + S[1] * z, Z = c[2] * R + E[2] * x + S[2] * z;
    const l = Math.hypot(X, Y, Z); return [X / l, Y / l, Z / l];
  };
  const yAt = (x, z, h) => {
    const u = unitAt(x, z), r = R + h;
    return (u[0] * r - c[0] * R) * U[0] + (u[1] * r - c[1] * R) * U[1] + (u[2] * r - c[2] * R) * U[2];
  };
  const bedMemo = new Map();
  /** terrain (bed / gorge wall) frame y under a frame point */
  const groundY = (x, z) => {
    const k = Math.round(x) * 100003 + Math.round(z);
    let v = bedMemo.get(k);
    if (v === undefined) { const u = unitAt(x, z); v = yAt(x, z, heightAt(u[0], u[1], u[2], 2)); bedMemo.set(k, v); }
    return v;
  };
  const level = Number.isFinite(payload.level) ? payload.level : 0;
  const waterY = (x, z) => yAt(x, z, level);
  // ---- deck section --------------------------------------------------------------------------------------------
  const roadHalf = (payload.width || 12) / 2 + 0.6;            // streetBuild bridge(): sidewalk outer edge
  const tracks = Math.max(1, Math.min(4, payload.tracks || 2));
  const railHalf = Math.max(5.5, ((tracks - 1) / 2) * 4.0 + 3.5); // streetBuild rail(): VIADUCT / 2, outer + 3.5
  const hw = rail ? railHalf : roadHalf;
  // carriageway half width of the street deck (streetBuild profileOf: footways from cw to the deck edge)
  const cls0 = payload.cls || 'arterial', w0 = Math.max(2.5, payload.width || 12);
  const swy = cls0 === 'highway' ? 0 : cls0 === 'boulevard' ? Math.min(6, Math.max(3.5, w0 * 0.12)) : cls0 === 'arterial' ? Math.min(5, Math.max(3, w0 * 0.15)) : Math.min(3.6, Math.max(1.8, w0 * 0.2));
  const cwy = cls0 === 'highway' ? w0 / 2 - 0.8 : Math.max(2.5, w0 / 2 - swy);
  const deckTop = (yPoly) => yPoly + (rail ? -0.35 : 0.03);    // street deck top (asphalt / slab)
  const pierSpan = payload.pierSpan || Math.min(160, Math.round(payload.span / Math.max(1, Math.round(payload.span / 90))));
  const dG = type === 'cable' ? (rail ? 3.4 : 3.0) : type === 'arch' ? 1.7 : Math.max(2.4, Math.min(6, pierSpan / 18));
  const steelBox = type === 'cable';
  const girderKey = steelBox ? 'br_steel' : 'br_concrete';
  const lipH = rail ? 1.1 : 0.25;
  const hb = steelBox ? hw - Math.min(3.2, 0.9 * dG) : hw - 0.6;   // soffit half width
  let tris0 = 0;
  for (const run of line.runs) {
    const smp = samples(run, type === 'cable' ? 10 : 8);
    for (let k = 0; k < smp.length - 1; k++) {
      const A = smp[k], B = smp[k + 1];
      const yA = deckTop(A.y), yB = deckTop(B.y);
      const P = (Q, y, o, dy) => [Q.x + Q.nx * o, y + dy, Q.z + Q.nz * o];
      const refA = [(A.x + B.x) / 2, (yA + yB) / 2 - dG * 0.5, (A.z + B.z) / 2];
      // top layer (under the street deck: the deck surface from afar): dark carriageway, light footways (road) /
      // concrete slab (rail) through the vertex tint
      if (rail) {
        M.tint = [4.2, 4.15, 4.0];
        M.poly('br_deck', [P(A, yA, -hw, -0.06), P(A, yA, hw, -0.06), P(B, yB, hw, -0.06), P(B, yB, -hw, -0.06)], refA);
      } else {
        M.poly('br_deck', [P(A, yA, -cwy, -0.06), P(A, yA, cwy, -0.06), P(B, yB, cwy, -0.06), P(B, yB, -cwy, -0.06)], refA);
        M.tint = [4.4, 4.3, 4.1];
        for (const sd of [-1, 1]) M.poly('br_deck', [P(A, yA, sd * cwy, -0.06), P(A, yA, sd * hw, -0.06), P(B, yB, sd * hw, -0.06), P(B, yB, sd * cwy, -0.06)], refA);
      }
      M.tint = [1, 1, 1];
      for (const sd of [-1, 1]) {
        const oO = sd * (hw + 0.07), oI = sd * (hw - 0.22);
        // edge beam / parapet: outer face, top, inner face
        M.poly(girderKey, [P(A, yA, oO, lipH), P(B, yB, oO, lipH), P(B, yB, oO, -0.45), P(A, yA, oO, -0.45)], refA);
        M.poly(girderKey, [P(A, yA, oI, lipH), P(B, yB, oI, lipH), P(B, yB, oO, lipH), P(A, yA, oO, lipH)], [refA[0], refA[1] - 5, refA[2]]);
        const refIn = [(A.x + B.x) / 2 + A.nx * sd * (hw + 3), (yA + yB) / 2, (A.z + B.z) / 2 + A.nz * sd * (hw + 3)];
        M.poly(girderKey, [P(A, yA, oI, -0.06), P(B, yB, oI, -0.06), P(B, yB, oI, lipH), P(A, yA, oI, lipH)], refIn);
        // fairing down to the soffit
        M.poly(girderKey, [P(A, yA, oO, -0.45), P(B, yB, oO, -0.45), P(B, yB, sd * hb, -dG), P(A, yA, sd * hb, -dG)], refA);
      }
      M.poly(girderKey, [P(A, yA, -hb, -dG), P(A, yA, hb, -dG), P(B, yB, hb, -dG), P(B, yB, -hb, -dG)], [refA[0], refA[1] + 5, refA[2]]);
    }
  }
  tris0 = M.tris;
  const stats = { deckTris: tris0, piers: 0, pylons: 0, cables: 0, lights: 0 };

  // ---- piers ---------------------------------------------------------------------------------------------------
  const pier = (s) => {
    const Q = line.at(s); if (!Q) return;
    const top = deckTop(Q.y) - dG;
    const g = groundY(Q.x, Q.z);
    if (top - g < 2.5) return;
    const wY = waterY(Q.x, Q.z);
    const ex = [Q.nx, 0, Q.nz], ez = [Q.tx, 0, Q.tz];
    const wet = g < wY - 0.3;
    let base;
    const wide = hw >= 9;
    const capHalfX = wide ? hw - 1.2 : hw * 0.75;
    if (wet) {
      // pile cap at the waterline (the foundation reads above the water)
      M.box('br_concrete', [Q.x, wY + 0.1, Q.z], ex, ez, capHalfX + 1.4, 1.5, 3.4);
      base = wY + 1.6;
    } else {
      M.box('br_concrete', [Q.x, g + 0.2, Q.z], ex, ez, capHalfX + 0.8, 0.6, 2.6);
      base = g + 0.8;
    }
    if (wide) {
      // twin octagonal columns + cap beam under the girder
      const cx = hw - 0.3 * hw;
      for (const sd of [-1, 1]) {
        const bx = Q.x + Q.nx * sd * cx, bz = Q.z + Q.nz * sd * cx;
        M.prism('br_concrete', [bx, base, bz], [bx, top - 2.0, bz], ex, ez, 1.45, 1.45, 1.2, 1.2, false);
      }
      M.box('br_concrete', [Q.x, top - 1.0, Q.z], ex, ez, hw - 1.6, 1.0, 1.5);
    } else {
      M.prism('br_concrete', [Q.x, base, Q.z], [Q.x, top, Q.z], ex, ez, hw * 0.62, 1.3, hw * 0.55, 1.1, false);
    }
    stats.piers++;
  };

  // ---- lights (deck / walkway / island / aviation): small boxes, min-pixel materials ------------------------------
  const light = (key, p, r) => { M.lightBox(key, p, r, r * 0.6, r); stats.lights++; };
  const cls = payload.cls || 'arterial';
  const lampSp = rail ? 50 : cls === 'highway' ? 44 : cls === 'boulevard' || cls === 'collector' || cls === 'local' ? 30 : 32;
  const lampH = cls === 'boulevard' ? 10 : cls === 'highway' ? 11 : cls === 'arterial' ? 9.5 : 8;
  for (const sd of [-1, 1]) {
    const stagger = sd > 0 ? lampSp / 2 : 0;
    for (let s = Math.ceil((line.sMin - stagger) / lampSp) * lampSp + stagger; s <= line.sMax; s += lampSp) {
      const Q = line.at(s); if (!Q) continue;
      if (rail) light('br_light_near', [Q.x + Q.nx * sd * (hw - 0.05), deckTop(Q.y) + 1.25, Q.z + Q.nz * sd * (hw - 0.05)], 0.16);
      else light('br_light', [Q.x + Q.nx * sd * (hw - 0.45 - 1.4), deckTop(Q.y) + 0.18 + lampH, Q.z + Q.nz * sd * (hw - 0.45 - 1.4)], 0.32);
    }
  }

  // ---- type-specific structure ---------------------------------------------------------------------------------
  if (type === 'cable') {
    const py = (payload.pylons || []).slice().sort((a, b) => a.s - b.s);
    const sp = py.length >= 2 ? py[py.length - 1].s - py[0].s : NaN;
    const mainSpan = Number.isFinite(sp) && sp > 100 ? sp : Math.max(320, Math.min(880, ((py[0] ? py[0].h : 120) - 18) / 0.23));
    const reach = mainSpan / 2 - 6;
    const cabSp = rail ? 10 : 12;
    // approach / auxiliary piers outside the cable zone
    const zones = [];
    if (py.length >= 2) zones.push([py[0].s - reach - 6, py[py.length - 1].s + reach + 6]);
    else if (py.length === 1) zones.push([py[0].s - reach - 6, py[0].s + reach + 6]);
    const apSp = rail ? 50 : 60;
    for (const z of zones) { pier(z[0]); pier(z[1]); }
    for (let s = Math.ceil(line.sMin / apSp) * apSp; s <= line.sMax; s += apSp) {
      if (zones.some((z) => s > z[0] - apSp * 0.5 && s < z[1] + apSp * 0.5)) continue;
      pier(s);
    }
    for (const p of py) {
      const Q = line.at(p.s, 2); if (!Q) continue;
      stats.pylons++;
      const yd = deckTop(Q.y);
      const h = Math.max(30, p.h || 100);
      const ex = [Q.nx, 0, Q.nz], ez = [Q.tx, 0, Q.tz];      // ex across the deck, ez along it
      const wY = waterY(Q.x, Q.z), g = groundY(Q.x, Q.z);
      const wet = g < wY - 0.5;
      // leg sections (half sizes): a along the deck, b across
      // slender legs (细索桥): ≈ 7.6 × 5.9 m at the foot of a 128 m pylon, 60 % / 70 % of that at the top
      const aB = Math.max(2.4, Math.min(5.5, 0.022 * h + 1.0)), bB = Math.max(1.8, Math.min(4.0, 0.016 * h + 0.9));
      const aT = aB * 0.6, bT = bB * 0.7;
      const islandTop = wet ? wY + (p.base === 'pier' || payload.noIsland ? 2.5 : 3.6) : g + 0.4;
      const capH = 3.2, yF = islandTop + capH;
      const yLow = yd - dG - 1.6;                               // lower (deck support) beam centre
      let legFoot, anchorLat, ya0, ya1, apexY = 0;
      if (p.shape === 'A') {
        apexY = yd + 0.68 * h;
        legFoot = (hw + 1.4 + bB) * (apexY - yF) / Math.max(10, apexY - yd);
        anchorLat = Math.max(0.8, bT * 0.9 - 0.5);
        ya0 = apexY + 3; ya1 = yd + h - 3.5;
      } else {
        legFoot = hw + 1.4 + bB;
        anchorLat = legFoot - bT * 0.3;
        ya0 = yd + 0.62 * h + 6; ya1 = yd + h - 3.5;
      }
      // ---- foundation: island (rock armour revetment, paved top, coping, service house) or caisson ----
      const base = payload.noIsland ? 'pier' : p.base;
      if (wet && base !== 'pier') {
        const ra = Math.max(p.baseR || 40, aB + 14), rb = Math.max((p.baseR || 40) * 0.82, legFoot + bB + 10);
        const NS = 28, low = Math.max(g, wY - 6);
        const slope = 1.8, dr = (islandTop - low) * slope;
        const ring = (rad, y, ka, kb) => { const out = []; for (let i = 0; i < NS; i++) { const an = (i / NS) * Math.PI * 2, ca = Math.cos(an) * (ka + rad), sb = Math.sin(an) * (kb + rad); out.push([Q.x + ez[0] * ca + ex[0] * sb, y, Q.z + ez[2] * ca + ex[2] * sb]); } return out; };
        const rTop = ring(0, islandTop - 0.4, ra, rb), rBot = ring(dr, low, ra, rb), rCop = ring(-1.2, islandTop, ra, rb), rCopO = ring(0.2, islandTop, ra, rb);
        for (let i = 0; i < NS; i++) {
          const j = (i + 1) % NS;
          M.poly('br_armour', [rBot[i], rBot[j], rTop[j], rTop[i]], [Q.x, (islandTop + low) / 2, Q.z]);
          M.poly('br_concrete', [rTop[i], rTop[j], rCopO[j], rCopO[i]], [Q.x, islandTop - 3, Q.z]);
          M.poly('br_concrete', [rCop[i], rCop[j], rCopO[j], rCopO[i]], [Q.x, islandTop - 3, Q.z]);
        }
        M.tint = [0.86, 0.85, 0.83];
        M.poly('br_paving', rCop.slice().reverse(), [Q.x, islandTop - 3, Q.z]);
        M.tint = [1, 1, 1];
        // service house + island lamps
        const hx = Q.x + ez[0] * (ra * 0.55), hz = Q.z + ez[2] * (ra * 0.55);
        M.box('br_concrete', [hx, islandTop + 2.1, hz], ex, ez, 5.5, 2.1, 3.6);
        M.box('br_steel', [hx, islandTop + 4.35, hz], ex, ez, 5.9, 0.15, 4.0);
        for (const [fa, fb] of [[0.75, 0.6], [-0.75, 0.6], [0.75, -0.6], [-0.75, -0.6]]) {
          const lx = Q.x + ez[0] * ra * fa * 0.9 + ex[0] * rb * fb, lz = Q.z + ez[2] * ra * fa * 0.9 + ex[2] * rb * fb;
          M.prism('br_steel', [lx, islandTop, lz], [lx, islandTop + 6, lz], ex, ez, 0.09, 0.09, 0.07, 0.07, true, false, 0);
          light('br_light_near', [lx, islandTop + 6.25, lz], 0.22);
        }
      } else if (wet) {
        M.prism('br_concrete', [Q.x, Math.max(g, wY - 6), Q.z], [Q.x, islandTop, Q.z], ex, ez, legFoot + bB + 4, aB + 5, legFoot + bB + 4, aB + 5, true, false, 0.35);
      }
      // pile cap
      M.box('br_concrete', [Q.x, islandTop + capH / 2, Q.z], ex, ez, legFoot + bB + 2.5, capH / 2, aB + 2.5);
      // ---- legs ----
      if (p.shape === 'A') {
        const xAt = (y) => legFoot * (apexY - y) / (apexY - yF);
        for (const sd of [-1, 1]) {
          const bx = Q.x + ex[0] * sd * legFoot, bz = Q.z + ex[2] * sd * legFoot;
          const tx = Q.x + ex[0] * sd * bT * 0.5, tz = Q.z + ex[2] * sd * bT * 0.5;
          M.prism('br_pylon', [bx, yF, bz], [tx, apexY, tz], ex, ez, bB, aB, bT, aT, false);
        }
        // head (anchorage column) from below the apex to the top
        M.prism('br_pylon', [Q.x, apexY - 6, Q.z], [Q.x, yd + h, Q.z], ex, ez, bT * 1.15, aT * 1.05, bT * 0.95, aT * 0.9, true);
        // lower strut under the deck
        const xl = xAt(yLow);
        M.box('br_pylon', [Q.x, yLow, Q.z], ex, ez, xl, 1.6, aB * 0.8);
        // aviation lights: head top + legs at mid height
        light('br_aviation', [Q.x, yd + h + 0.5, Q.z], 0.4);
        if (h > 100) for (const sd of [-1, 1]) { const ym = yd + 0.4 * h, xm = xAt(ym) + bB + 0.4; light('br_aviation', [Q.x + ex[0] * sd * xm, ym, Q.z + ex[2] * sd * xm], 0.35); }
      } else {
        for (const sd of [-1, 1]) {
          const bx = Q.x + ex[0] * sd * legFoot, bz = Q.z + ex[2] * sd * legFoot;
          M.prism('br_pylon', [bx, yF, bz], [bx, yd + h, bz], ex, ez, bB, aB, bT, aT, true);
          light('br_aviation', [bx, yd + h + 0.5, bz], 0.4);
          if (h > 100) { const xm = legFoot + (bB + bT) * 0.5 + 0.4; light('br_aviation', [Q.x + ex[0] * sd * xm, yd + 0.5 * h, Q.z + ex[2] * sd * xm], 0.35); }
        }
        // lower (deck support) beam and upper beam
        M.box('br_pylon', [Q.x, yLow, Q.z], ex, ez, legFoot, 1.6, aB * 0.8);
        const yUp = yd + 0.62 * h, uh = Math.max(1.6, Math.min(3.5, 0.022 * h));
        M.box('br_pylon', [Q.x, yUp, Q.z], ex, ez, legFoot - bB * 0.5, uh, aT * 1.1);
      }
      // ---- stay cables: semi-fan, two planes, both sides ----
      const d0 = Math.max(14, aB + 9);
      const nC = Math.max(2, Math.floor((reach - d0) / cabSp) + 1);
      for (const side of [-1, 1]) {
        for (let i = 0; i < nC; i++) {
          const d = d0 + i * cabSp;
          const D = line.at(p.s + side * d);
          if (!D) continue;
          const f = nC > 1 ? i / (nC - 1) : 1;
          const ya = ya0 + (ya1 - ya0) * f;
          const rc = 0.075 + 0.06 * f;
          for (const sd of [-1, 1]) {
            const pa = [Q.x + ex[0] * sd * anchorLat, ya, Q.z + ex[2] * sd * anchorLat];
            const da = [D.x + D.nx * sd * (hw - 0.15), deckTop(D.y) + 0.12, D.z + D.nz * sd * (hw - 0.15)];
            M.tube('br_cable', da, pa, rc, rc, 8);
            stats.cables++;
          }
        }
      }
    }
  } else if (type === 'arch') {
    const sA = line.sMin, sB = line.sMax, L = sB - sA;
    const mid = line.at((sA + sB) / 2);
    if (mid && L > 40) {
      const yCrown = deckTop(mid.y) - dG - 0.7;
      const rise = Math.max(12, payload.archRise || L * 0.18);
      const ySpr = yCrown - rise;
      // springing points: first point from each end where the gorge wall drops below the springing level
      const findSpring = (from, dir) => {
        for (let s = from; dir > 0 ? s < (sA + sB) / 2 : s > (sA + sB) / 2; s += dir * 4) {
          const Q = line.at(s); if (!Q) continue;
          if (groundY(Q.x, Q.z) <= ySpr + 1) return s;
        }
        return from + dir * L * 0.1;
      };
      const s0 = findSpring(sA + 2, 1), s1 = findSpring(sB - 2, -1);
      const sc = (s0 + s1) / 2, half = Math.max(10, (s1 - s0) / 2);
      const ribY = (s) => ySpr + rise * (1 - ((s - sc) / half) ** 2);
      const ribLat = hw - 1.6, rh = 1.25, rwd = 0.95;
      for (const sd of [-1, 1]) {
        let prev = null;
        for (let s = s0; s <= s1 + 1e-6; s += Math.max(3, (s1 - s0) / 48)) {
          const Q = line.at(s); if (!Q) { prev = null; continue; }
          const y = ribY(s), o = sd * ribLat;
          const C = [Q.x + Q.nx * o, y, Q.z + Q.nz * o];
          const sec = [[-rwd, -rh], [rwd, -rh], [rwd, rh], [-rwd, rh]].map(([a, b]) => [C[0] + Q.nx * a, C[1] + b, C[2] + Q.nz * a]);
          if (prev) for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; M.poly('br_concrete', [prev.sec[i], prev.sec[j], sec[j], sec[i]], [(prev.C[0] + C[0]) / 2, (prev.C[1] + C[1]) / 2, (prev.C[2] + C[2]) / 2]); }
          prev = { sec, C };
        }
      }
      // springing (thrust) blocks
      for (const s of [s0, s1]) {
        const Q = line.at(s); if (!Q) continue;
        M.box('br_concrete', [Q.x, ribY(s) - 1.5, Q.z], [Q.nx, 0, Q.nz], [Q.tx, 0, Q.tz], ribLat + 2.2, 3.2, 3.5);
      }
      // spandrel columns (+ cross beams) on the ribs, approach columns beyond them
      for (let s = Math.ceil((s0 + 6) / 12) * 12; s < s1 - 6; s += 12) {
        const Q = line.at(s); if (!Q) continue;
        const top = deckTop(Q.y) - dG, yr = ribY(s) + rh;
        if (top - yr < 1.0) continue;
        for (const sd of [-1, 1]) {
          const x = Q.x + Q.nx * sd * ribLat, z = Q.z + Q.nz * sd * ribLat;
          M.prism('br_concrete', [x, yr - 0.3, z], [x, top, z], [Q.nx, 0, Q.nz], [Q.tx, 0, Q.tz], 0.55, 0.7, 0.5, 0.65, false, false, 0);
        }
        M.box('br_concrete', [Q.x, top - 0.6, Q.z], [Q.nx, 0, Q.nz], [Q.tx, 0, Q.tz], ribLat + 0.5, 0.6, 0.75);
        if (Math.round(s / 12) % 2 === 0) M.box('br_concrete', [Q.x, yr + 0.3, Q.z], [Q.nx, 0, Q.nz], [Q.tx, 0, Q.tz], ribLat, 0.55, 0.6);
      }
      for (let s = Math.ceil(sA / 16) * 16; s <= sB; s += 16) {
        if (s > s0 - 4 && s < s1 + 4) continue;
        pier(s);
      }
    }
  } else {
    // girder: piers on a global lattice (pierSpan) along the whole bridge
    for (let s = Math.ceil(line.sMin / pierSpan) * pierSpan; s <= line.sMax; s += pierSpan) pier(s);
  }
  const parts = M.finish();
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  stats.triangles = M.tris; stats.ms = Math.round((t1 - t0) * 10) / 10;
  return { id: payload.id, parts, stats };
}

export function bridgeTransferList(out) {
  const t = new Set();
  for (const p of out.parts || []) for (const k of ['position', 'normal', 'uv', 'color', 'index']) if (p[k]) t.add(p[k].buffer);
  return [...t];
}
