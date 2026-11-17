// Geometric primitives for the building kit. All functions take the MeshBuilder `b` first and
// emit into material part `key` in b's current local frame. Worker-safe, allocation-light.
//
//   sweep(b, key, path3D, profile2D, opts)   profile swept along a polyline (bands, copings, rails)
//   tube(b, key, path3D, r, segs)            round tube along a polyline (handrails, pipes)
//   lathe(b, key, profile[[r,y]], segs, opts) surface of revolution about local +Y
//   cylinder(b, key, x,y,z, r, h, segs, opts)
//   prism(b, key, poly[[x,z]], y0, y1, opts) vertical extrusion of a plan polygon
//   extrudeX(b, key, profile[[z,y]], x0, x1)  2D profile extruded along local X (steps, mouldings)
//   blob(b, key, cx,cy,cz, rx,ry,rz, seed)   noisy closed blob (shrubs, foliage clusters)
//
// Profile convention (sweep/extrudeX): points [s, y] where s = right-hand side of the path
// direction (s = t × up). For the front facade running left→right (+X), s = +Z = outward.
// Closed profiles must be CCW in the (s, y) plane (s to the right, y up) so normals face out.
// Vertices whose adjacent edges turn by less than `smoothAngle` get smooth normals.

import earcut from 'three/src/extras/lib/earcut.js';

const DEG = Math.PI / 180;

/** earcut wrapper for [[x,y],...] outer + holes → flat index list */
export function triangulate2(outer, holes = []) {
  const flat = [];
  const hi = [];
  for (const p of outer) flat.push(p[0], p[1]);
  for (const h of holes) { if (!h || h.length < 3) continue; hi.push(flat.length / 2); for (const p of h) flat.push(p[0], p[1]); }
  return earcut(flat, hi.length ? hi : null, 2);
}

/**
 * Analyse a 2D profile into ring vertices with normals and v-coordinates.
 * Returns { verts:[{s,y,ns,ny,v}], edges:[[ia,ib]], closed }
 */
function analyseProfile(profile, closed, smoothAngle) {
  const n = profile.length;
  const en = []; // edge normals
  const elen = [];
  const ecount = closed ? n : n - 1;
  for (let k = 0; k < ecount; k++) {
    const a = profile[k], b = profile[(k + 1) % n];
    const ds = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(ds, dy) || 1e-9;
    en.push([dy / L, -ds / L]); elen.push(L);
  }
  const cosLim = Math.cos(smoothAngle);
  const verts = [], edges = [];
  // per profile vertex: index of vertex used by the edge ending here (in) and starting here (out)
  const vin = new Int32Array(n).fill(-1), vout = new Int32Array(n).fill(-1);
  let vacc = 0; const vAt = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) { vAt[k] = vacc; if (k < ecount) vacc += elen[k]; }
  vAt[n] = vacc;
  for (let k = 0; k < n; k++) {
    const eIn = closed ? (k - 1 + n) % n : k - 1; // edge ending at k
    const eOut = k < ecount ? k : -1;             // edge starting at k
    const hasIn = eIn >= 0 && eIn < ecount, hasOut = eOut >= 0;
    if (hasIn && hasOut) {
      const a = en[eIn], b = en[eOut];
      if (a[0] * b[0] + a[1] * b[1] >= cosLim) {
        let ns = a[0] + b[0], ny = a[1] + b[1]; const l = Math.hypot(ns, ny) || 1;
        verts.push({ s: profile[k][0], y: profile[k][1], ns: ns / l, ny: ny / l, v: vAt[k] });
        vin[k] = vout[k] = verts.length - 1;
      } else {
        verts.push({ s: profile[k][0], y: profile[k][1], ns: a[0], ny: a[1], v: vAt[k] }); vin[k] = verts.length - 1;
        verts.push({ s: profile[k][0], y: profile[k][1], ns: b[0], ny: b[1], v: vAt[k] }); vout[k] = verts.length - 1;
      }
    } else if (hasOut) {
      verts.push({ s: profile[k][0], y: profile[k][1], ns: en[eOut][0], ny: en[eOut][1], v: vAt[k] }); vout[k] = verts.length - 1;
    } else if (hasIn) {
      verts.push({ s: profile[k][0], y: profile[k][1], ns: en[eIn][0], ny: en[eIn][1], v: vAt[k] }); vin[k] = verts.length - 1;
    }
  }
  for (let k = 0; k < ecount; k++) {
    const kb = (k + 1) % n;
    let ib = vin[kb];
    // closing edge of a closed profile ends at vertex 0: use a duplicated vertex with v = total
    if (closed && kb === 0) {
      const src = verts[vin[0]];
      verts.push({ ...src, v: vAt[n] }); ib = verts.length - 1;
    }
    edges.push([vout[k], ib]);
  }
  return { verts, edges };
}

const _up = [0, 1, 0];

// profile analysis is cached per profile array (callers reuse constant profiles)
const PROF_CACHE = new WeakMap();
function analyseCached(profile, closed, smoothDeg) {
  let m = PROF_CACHE.get(profile);
  if (!m) { m = new Map(); PROF_CACHE.set(profile, m); }
  const k = (closed ? 1 : 0) + smoothDeg * 2;
  let r = m.get(k);
  if (!r) { r = analyseProfile(profile, closed, smoothDeg * DEG); m.set(k, r); }
  return r;
}

/**
 * Sweep a 2D profile along a 3D polyline.
 * @param {MeshBuilder} b
 * @param {string} key material key
 * @param {number[][]} path [[x,y,z],...] (local frame)
 * @param {number[][]} profile [[s,y],...] (CCW if closed)
 * @param {object} [o]
 * @param {boolean} [o.closed=false]        path is a closed loop
 * @param {boolean} [o.closedProfile=true]  profile is a closed polygon
 * @param {boolean} [o.caps=true]           cap the ends (closed profile, open path)
 * @param {number[]} [o.up=[0,1,0]]         reference up for the profile frame
 * @param {number} [o.smoothAngle=35]       degrees: profile vertex smoothing threshold
 * @param {number} [o.uScale=1]             uv u multiplier (metres along path)
 * @param {number} [o.u0=0]                 uv u offset
 */
export function sweep(b, key, path, profile, o = {}) {
  const closed = !!o.closed;
  // drop (near-)duplicate path points: zero-length segments break the frames
  {
    const pp = [];
    for (const q of path) { const l = pp[pp.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1], q[2] - l[2]) > 1e-4) pp.push(q); }
    if (closed && pp.length > 2) { const a = pp[0], z = pp[pp.length - 1]; if (Math.hypot(a[0] - z[0], a[1] - z[1], a[2] - z[2]) <= 1e-4) pp.pop(); }
    path = pp;
  }
  const closedProfile = o.closedProfile !== false;
  const up = o.up || _up;
  const m = path.length;
  if (m < 2 || profile.length < 2) return;
  const prof = analyseCached(profile, closedProfile, o.smoothAngle ?? 35);
  const nseg = closed ? m : m - 1;
  // segment tangents
  const T = new Float64Array(nseg * 3);
  for (let i = 0; i < nseg; i++) {
    const a = path[i], c = path[(i + 1) % m];
    let x = c[0] - a[0], y = c[1] - a[1], z = c[2] - a[2]; const l = Math.hypot(x, y, z) || 1e-9;
    T[i * 3] = x / l; T[i * 3 + 1] = y / l; T[i * 3 + 2] = z / l;
  }
  const frameOf = (tx, ty, tz) => {
    // s = t × up, u = s × t
    let sx = ty * up[2] - tz * up[1], sy = tz * up[0] - tx * up[2], sz = tx * up[1] - ty * up[0];
    let l = Math.hypot(sx, sy, sz);
    if (l < 1e-6) { // t parallel to up: pick another reference
      const r = Math.abs(tx) < 0.9 ? [1, 0, 0] : [0, 0, 1];
      sx = ty * r[2] - tz * r[1]; sy = tz * r[0] - tx * r[2]; sz = tx * r[1] - ty * r[0]; l = Math.hypot(sx, sy, sz);
    }
    sx /= l; sy /= l; sz /= l;
    const ux = sy * tz - sz * ty, uy = sz * tx - sx * tz, uz = sx * ty - sy * tx;
    return [sx, sy, sz, ux, uy, uz];
  };
  // Per-segment frames: 'up' frames are exact for horizontal bands; paths that run (nearly)
  // parallel to `up` or o.transport use parallel transport (no flips / twists).
  let transport = !!o.transport;
  if (!transport) for (let i = 0; i < nseg; i++) { const d = T[i * 3] * up[0] + T[i * 3 + 1] * up[1] + T[i * 3 + 2] * up[2]; if (Math.abs(d) > 0.97) { transport = true; break; } }
  const FR = new Array(nseg);
  FR[0] = frameOf(T[0], T[1], T[2]);
  for (let i = 1; i < nseg; i++) {
    if (!transport) { FR[i] = frameOf(T[i * 3], T[i * 3 + 1], T[i * 3 + 2]); continue; }
    const ax = T[i * 3 - 3], ay = T[i * 3 - 2], az = T[i * 3 - 1], cx = T[i * 3], cy = T[i * 3 + 1], cz = T[i * 3 + 2];
    let kx = ay * cz - az * cy, ky = az * cx - ax * cz, kz = ax * cy - ay * cx; const sn = Math.hypot(kx, ky, kz), cs = ax * cx + ay * cy + az * cz;
    const f = FR[i - 1];
    if (sn < 1e-9) { FR[i] = f.slice(); continue; }
    kx /= sn; ky /= sn; kz /= sn;
    const rot = (vx, vy, vz) => { // Rodrigues
      const kd = kx * vx + ky * vy + kz * vz;
      const crx = ky * vz - kz * vy, cry = kz * vx - kx * vz, crz = kx * vy - ky * vx;
      return [vx * cs + crx * sn + kx * kd * (1 - cs), vy * cs + cry * sn + ky * kd * (1 - cs), vz * cs + crz * sn + kz * kd * (1 - cs)];
    };
    FR[i] = [...rot(f[0], f[1], f[2]), ...rot(f[3], f[4], f[5])];
  }
  const p = b.part(key);
  const prevMode = b.uvMode; b.uvMode = 1;
  const uScale = o.uScale ?? 1, u0 = o.u0 ?? 0;
  const ringCount = closed ? m + 1 : m;
  const nv = prof.verts.length;
  const rings = new Int32Array(ringCount * nv);
  let dist = 0;
  const capRings = [];
  for (let r = 0; r < ringCount; r++) {
    const j = r % m;
    if (r > 0) { const a = path[(r - 1) % m], c = path[j]; dist += Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]); }
    // incoming / outgoing segment
    let i1, i2;
    if (closed) { i1 = (j - 1 + nseg) % nseg; i2 = j % nseg; }
    else { i1 = Math.max(0, j - 1); i2 = Math.min(nseg - 1, j); }
    const t1x = T[i1 * 3], t1y = T[i1 * 3 + 1], t1z = T[i1 * 3 + 2];
    const t2x = T[i2 * 3], t2y = T[i2 * 3 + 1], t2z = T[i2 * 3 + 2];
    const f1 = FR[i1], f2 = FR[i2];
    let bx = t1x + t2x, by = t1y + t2y, bz = t1z + t2z; let bl = Math.hypot(bx, by, bz);
    if (bl < 1e-6) { bx = t1x; by = t1y; bz = t1z; bl = 1; }
    bx /= bl; by /= bl; bz /= bl;
    let fa;
    if (i1 === i2) fa = f1;
    else {
      let sx = f1[0] + f2[0], sy = f1[1] + f2[1], sz = f1[2] + f2[2]; const sl = Math.hypot(sx, sy, sz) || 1;
      let ux = f1[3] + f2[3], uy = f1[4] + f2[4], uz = f1[5] + f2[5]; const ul = Math.hypot(ux, uy, uz) || 1;
      fa = [sx / sl, sy / sl, sz / sl, ux / ul, uy / ul, uz / ul];
    }
    const tdotn = t1x * bx + t1y * by + t1z * bz;
    const P0 = path[j];
    const wantCap = r === 0 || r === ringCount - 1;
    const ringPos = wantCap ? [] : null;
    for (let k = 0; k < nv; k++) {
      const pv = prof.verts[k];
      let ox = pv.s * f1[0] + pv.y * f1[3], oy = pv.s * f1[1] + pv.y * f1[4], oz = pv.s * f1[2] + pv.y * f1[5];
      if (i1 !== i2) {
        const lam = (ox * bx + oy * by + oz * bz) / Math.max(tdotn, 0.2);
        ox -= t1x * lam; oy -= t1y * lam; oz -= t1z * lam;
      }
      const nx = pv.ns * fa[0] + pv.ny * fa[3], ny = pv.ns * fa[1] + pv.ny * fa[4], nz = pv.ns * fa[2] + pv.ny * fa[5];
      rings[r * nv + k] = b.vert(p, P0[0] + ox, P0[1] + oy, P0[2] + oz, nx, ny, nz, u0 + dist * uScale, pv.v);
      if (wantCap) ringPos.push([P0[0] + ox, P0[1] + oy, P0[2] + oz]);
    }
    if (wantCap) capRings.push({ pos: ringPos, t: r === 0 ? [t1x, t1y, t1z] : [t2x, t2y, t2z] });
  }
  for (let r = 0; r < ringCount - 1; r++) {
    for (const [ea, eb] of prof.edges) {
      b.q(p, rings[r * nv + ea], rings[(r + 1) * nv + ea], rings[(r + 1) * nv + eb], rings[r * nv + eb]);
    }
  }
  b.uvMode = prevMode;
  // caps
  if (closedProfile && !closed && o.caps !== false) {
    const idx = capIndices(profile);
    const capV = (ring, sign) => {
      // map original profile index -> position: use analyse verts' positions (first occurrence)
      const pos = [];
      for (let k = 0; k < profile.length; k++) {
        const pr = profile[k];
        let best = 0; for (let q = 0; q < nv; q++) if (prof.verts[q].s === pr[0] && prof.verts[q].y === pr[1]) { best = q; break; }
        pos.push(ring.pos[best]);
      }
      const t = ring.t, nx = t[0] * sign, ny = t[1] * sign, nz = t[2] * sign;
      const base = pos.map((q) => b.vert(p, q[0], q[1], q[2], nx, ny, nz, 0, 0));
      for (let i = 0; i < idx.length; i += 3) {
        const A = pos[idx[i]], B = pos[idx[i + 1]], C = pos[idx[i + 2]];
        const cx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
        const cy = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
        const cz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (cx * nx + cy * ny + cz * nz >= 0) b.tri(p, base[idx[i]], base[idx[i + 1]], base[idx[i + 2]]);
        else b.tri(p, base[idx[i]], base[idx[i + 2]], base[idx[i + 1]]);
      }
    };
    capV(capRings[0], -1);
    capV(capRings[capRings.length - 1], 1);
  }
}

/** Triangulation of a closed 2D profile: fan for convex profiles, earcut otherwise (cached). */
const CAP_CACHE = new WeakMap();
export function capIndices(profile) {
  const c = CAP_CACHE.get(profile); if (c) return c;
  const n = profile.length;
  let convex = true, sign = 0;
  for (let i = 0; i < n && convex; i++) {
    const a = profile[i], b = profile[(i + 1) % n], q = profile[(i + 2) % n];
    const cr = (b[0] - a[0]) * (q[1] - b[1]) - (b[1] - a[1]) * (q[0] - b[0]);
    if (Math.abs(cr) < 1e-12) continue;
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) convex = false;
  }
  let idx;
  if (convex) { idx = []; for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1); }
  else idx = triangulate2(profile, []);
  CAP_CACHE.set(profile, idx);
  return idx;
}

/** Circle profile (CCW) with n segments (cached per radius/segments when centred). */
const CIRCLES = new Map();
export function circleProfile(r, n = 12, cx = 0, cy = 0) {
  const key = r + ':' + n;
  if (!cx && !cy) { const c = CIRCLES.get(key); if (c) return c; }
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  if (!cx && !cy) CIRCLES.set(key, out);
  return out;
}

/** Round tube along a polyline. */
export function tube(b, key, path, r, segs = 10, o = {}) {
  sweep(b, key, path, circleProfile(r, segs), { smoothAngle: 80, ...o });
}

/**
 * Surface of revolution about local +Y. profile [[r,y],...] ordered bottom→top on the outside
 * (normals face +r). opts: {a0, a1 (radians), capTop, capBottom, smoothAngle, x, y, z}
 */
export function lathe(b, key, profile, segs = 16, o = {}) {
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2;
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const prof = analyseCached(profile, false, o.smoothAngle ?? 40);
  const nv = prof.verts.length;
  const p = b.part(key);
  const prevMode = b.uvMode; b.uvMode = 1;
  const ox = o.x || 0, oy = o.y || 0, oz = o.z || 0;
  const idx = new Int32Array((segs + 1) * nv);
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs, sa = Math.sin(a), ca = Math.cos(a);
    for (let k = 0; k < nv; k++) {
      const pv = prof.verts[k];
      idx[i * nv + k] = b.vert(p, ox + pv.s * sa, oy + pv.y, oz + pv.s * ca, pv.ns * sa, pv.ny, pv.ns * ca, a * Math.max(pv.s, 0.05), pv.v);
    }
  }
  for (let i = 0; i < segs; i++) for (const [ea, eb] of prof.edges) b.q(p, idx[i * nv + ea], idx[(i + 1) * nv + ea], idx[(i + 1) * nv + eb], idx[i * nv + eb]);
  b.uvMode = prevMode;
  const cap = (pr, top) => {
    if (pr[0] <= 1e-5) return;
    const ny = top ? 1 : -1;
    const c = b.vert(p, ox, oy + pr[1], oz, 0, ny, 0, 0, 0);
    const ring = [];
    for (let i = 0; i <= segs; i++) { const a = a0 + ((a1 - a0) * i) / segs; ring.push(b.vert(p, ox + pr[0] * Math.sin(a), oy + pr[1], oz + pr[0] * Math.cos(a), 0, ny, 0, 0, 0)); }
    for (let i = 0; i < segs; i++) { if (top) b.tri(p, c, ring[i], ring[i + 1]); else b.tri(p, c, ring[i + 1], ring[i]); }
  };
  if (o.capBottom) cap(profile[0], false);
  if (o.capTop) cap(profile[profile.length - 1], true);
  return full;
}

/** Vertical cylinder standing on (x,y,z). opts {top=true, bottom=false} */
export function cylinder(b, key, x, y, z, r, h, segs = 16, o = {}) {
  lathe(b, key, [[r, 0], [r, h]], segs, { x, y, z, capTop: o.top !== false, capBottom: !!o.bottom });
}

/**
 * Vertical prism from a plan polygon [[x,z],...] between y0 and y1.
 * opts {top=true, bottom=false, sides=true, smoothAngle=25}
 */
export function prism(b, key, poly, y0, y1, o = {}) {
  let pts = poly;
  // orient CCW in (x,z) math sense (shoelace > 0)
  let area = 0; for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  if (area < 0) pts = pts.slice().reverse();
  const n = pts.length;
  if (o.sides !== false) {
    // side walls: for CCW (x,z) polygon the outward normal of edge (dx,dz) is (−dz?..) — see notes:
    // quad (p[i+1],y0) (p[i],y0) (p[i],y1) (p[i+1],y1) faces outward.
    const prof = []; // build as a sweep-like strip with smoothing
    const en = [];
    for (let i = 0; i < n; i++) { const a = pts[i], c = pts[(i + 1) % n]; const dx = c[0] - a[0], dz = c[1] - a[1]; const L = Math.hypot(dx, dz) || 1e-9; en.push([-dz / L, dx / L, L]); }
    const cosLim = Math.cos((o.smoothAngle ?? 25) * DEG);
    const p = b.part(key);
    const prevMode = b.uvMode; b.uvMode = 1;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], c = pts[(i + 1) % n], e = en[i];
      const ePrev = en[(i - 1 + n) % n], eNext = en[(i + 1) % n];
      const nA = (e[0] * ePrev[0] + e[1] * ePrev[1] >= cosLim) ? norm2(e[0] + ePrev[0], e[1] + ePrev[1]) : [e[0], e[1]];
      const nC = (e[0] * eNext[0] + e[1] * eNext[1] >= cosLim) ? norm2(e[0] + eNext[0], e[1] + eNext[1]) : [e[0], e[1]];
      // normals: outward for CCW (x,z)-math polygon is (dz, −dx)?? we computed (−dz, dx); flip sign to point outward
      const v0 = b.vert(p, c[0], y0, c[1], -nC[0], 0, -nC[1], u + e[2], y0);
      const v1 = b.vert(p, a[0], y0, a[1], -nA[0], 0, -nA[1], u, y0);
      const v2 = b.vert(p, a[0], y1, a[1], -nA[0], 0, -nA[1], u, y1);
      const v3 = b.vert(p, c[0], y1, c[1], -nC[0], 0, -nC[1], u + e[2], y1);
      b.q(p, v0, v1, v2, v3);
      u += e[2];
    }
    b.uvMode = prevMode;
    void prof;
  }
  if (o.top !== false) b.polyY(key, pts, o.holes || [], y1, 1);
  if (o.bottom) b.polyY(key, pts, o.holes || [], y0, -1);
}
function norm2(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

/**
 * Extrude a closed 2D profile given in the local (z, y) plane along local +X from x0 to x1.
 * Equivalent to a straight sweep; profile CCW in (z,y) with z to the right.
 */
export function extrudeX(b, key, profile, x0, x1, o = {}) {
  sweep(b, key, [[x0, 0, 0], [x1, 0, 0]], profile, { smoothAngle: 20, ...o });
}

// ---------------------------------------------------------------------------
// Blobs (foliage / shrubs): noisy icospheres with smooth normals
// ---------------------------------------------------------------------------
const ICO = {};
function icosphere(detail) {
  if (ICO[detail]) return ICO[detail];
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  v = v.map((p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; });
  for (let d = 0; d < detail; d++) {
    const cache = new Map(); const nf = [];
    const mid = (a, c) => {
      const k = a < c ? a * 100000 + c : c * 100000 + a;
      if (cache.has(k)) return cache.get(k);
      const p = [(v[a][0] + v[c][0]) / 2, (v[a][1] + v[c][1]) / 2, (v[a][2] + v[c][2]) / 2]; const l = Math.hypot(...p);
      v.push([p[0] / l, p[1] / l, p[2] / l]); cache.set(k, v.length - 1); return v.length - 1;
    };
    for (const [a, bb, c] of f) { const ab = mid(a, bb), bc = mid(bb, c), ca = mid(c, a); nf.push([a, ab, ca], [bb, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  ICO[detail] = { v: Float64Array.from(v.flat()), f: Uint16Array.from(f.flat()), nv: v.length };
  return ICO[detail];
}

/**
 * Noisy blob centred at (cx,cy,cz) with radii (rx,ry,rz). seed varies the shape.
 * detail 0 (20 tris) / 1 (80) / 2 (320). Bottom is flattened slightly (sits on soil).
 */
export function blob(b, key, cx, cy, cz, rx, ry, rz, seed = 0, detail = 1) {
  const ico = icosphere(detail);
  const nv = ico.nv, V = ico.v, F = ico.f;
  const pos = new Float64Array(nv * 3), nrm = new Float64Array(nv * 3);
  const s1 = ((seed * 0.61803) % 1) * 6.283, s2 = ((seed * 0.41421) % 1) * 6.283, s3 = ((seed * 0.73205) % 1) * 6.283;
  for (let i = 0; i < nv; i++) {
    const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
    let r = 1 + 0.16 * Math.sin(x * 3.1 + s1) * Math.sin(y * 2.7 + s2) + 0.1 * Math.sin(z * 4.3 + s3 + x * 2.0) + 0.06 * Math.sin((x + y + z) * 7.0 + s1);
    let yy = y; if (yy < -0.35) yy = -0.35 + (yy + 0.35) * 0.35; // flatten bottom
    pos[i * 3] = cx + x * rx * r; pos[i * 3 + 1] = cy + yy * ry * r; pos[i * 3 + 2] = cz + z * rz * r;
  }
  for (let i = 0; i < F.length; i += 3) {
    const a = F[i] * 3, c = F[i + 1] * 3, d = F[i + 2] * 3;
    const ux = pos[c] - pos[a], uy = pos[c + 1] - pos[a + 1], uz = pos[c + 2] - pos[a + 2];
    const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, c, d]) { nrm[q] += nx; nrm[q + 1] += ny; nrm[q + 2] += nz; }
  }
  const p = b.part(key);
  const base = p.n;
  for (let i = 0; i < nv; i++) {
    let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2]; const l = Math.hypot(nx, ny, nz) || 1;
    // bend normals upward a little: foliage reads lit from the sky
    nx /= l; ny = ny / l + 0.25; nz /= l; const l2 = Math.hypot(nx, ny, nz);
    b.vert(p, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nx / l2, ny / l2, nz / l2, 0, 0);
  }
  // icosphere faces from the classic table are CCW from outside? verify orientation using first face
  const a = F[0] * 3, c = F[1] * 3, d = F[2] * 3;
  const cxp = (pos[c + 1] - pos[a + 1]) * (pos[d + 2] - pos[a + 2]) - (pos[c + 2] - pos[a + 2]) * (pos[d + 1] - pos[a + 1]);
  const cyp = (pos[c + 2] - pos[a + 2]) * (pos[d] - pos[a]) - (pos[c] - pos[a]) * (pos[d + 2] - pos[a + 2]);
  const czp = (pos[c] - pos[a]) * (pos[d + 1] - pos[a + 1]) - (pos[c + 1] - pos[a + 1]) * (pos[d] - pos[a]);
  const out = cxp * (pos[a] - cx) + cyp * (pos[a + 1] - cy) + czp * (pos[a + 2] - cz) > 0;
  for (let i = 0; i < F.length; i += 3) {
    if (out) b.tri(p, base + F[i], base + F[i + 1], base + F[i + 2]);
    else b.tri(p, base + F[i], base + F[i + 2], base + F[i + 1]);
  }
}
