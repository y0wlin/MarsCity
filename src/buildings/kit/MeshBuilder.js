// MeshBuilder — the part-accumulating geometry builder at the heart of the building kit.
// Worker-safe (no DOM, no THREE objects). Every emitted vertex goes into the part buffer of
// its MATERIAL KEY (see buildings/materials.js + kit/README.md), so a finished building is
// one merged geometry per material: few draw calls, typed arrays ready to transfer.
//
//   const b = new MeshBuilder({ hash: spec.hash });
//   b.push(); b.translate(0, 3.1, 0); b.rotY(Math.PI / 2);
//   b.box('concrete', -1, 0, -1, 1, 0.2, 1);          // in the current local frame
//   b.pop();
//   const data = b.finish();                             // -> { parts, colliders?, bounds, anchors, stats }
//
// Coordinates: metres in the BUILDING LOCAL FRAME (ARCHITECTURE.md §2): origin = footprint
// centre at ground.entrance height, +Y up, +Z = outward normal of the front facade.
// Transforms are rigid (rotation + translation) so normals stay exact. Faces are CCW when
// seen from their front (normal) side.
//
// UVs are in METRES. Default uvMode 'box': u/v are derived from the final building-frame
// position and normal (box projection), so textures keep world scale and panel joints line up
// across separately emitted pieces. Sweeps/lathes use explicit arc-length UVs.
//
// Per-vertex colour = linear RGB tint multiplied with the material base colour (instance
// variation: ceramic colour temperature, paint, foliage...). Every part always carries colour.
//
// Extra attributes: some material keys carry additional per-vertex vec4 attributes (window
// interior mapping, night-light ids, far-facade parameters). They are declared in
// EXTRA_ATTRIBUTES (or with declareExtras) and filled from the builder's current extra state
// (setExtra) at emit time.
//
// Memory: part buffers are pooled per thread and reused by the next builder (a worker builds
// thousands of buildings — no buffer growth / GC churn after warm-up). finish() packs every
// attribute of every part into ONE shared ArrayBuffer per attribute kind (parts hold subarray
// views), so a building transfers as ~6 buffers. Call dispose() if you abandon a builder
// without finishing it (the dispatcher does this on generator errors).

import * as P from './primitives.js';

/** Material keys that carry extra per-vertex attributes: { key: { attrName: itemSize } } */
export const EXTRA_ATTRIBUTES = {
  // window glass with interior mapping + occupancy night lights (see materials.js glass shader)
  glass_window: { iwin0: 4, iwin1: 4, iwin2: 4 },
  // shopfront / lobby glass: same interior mapping, different interior palette
  glass_shop: { iwin0: 4, iwin1: 4, iwin2: 4 },
  // blue-grey coated curtain wall (towers / offices): same interior mapping behind a reflective coat
  glass_curtain: { iwin0: 4, iwin1: 4, iwin2: 4 },
  // transparent 'full' LOD glass: room ids only drive the street reflection (height above the street)
  glass_clear: { iwin0: 4, iwin1: 4, iwin2: 4 },
  // emissive ceiling panels inside rooms ('full' LOD) gated by the room's window occupancy
  light_panel: { iwin1: 4, iwin2: 4 },
  // frosted bathroom / stair windows glow with the room's occupancy (zero ids = never lit)
  glass_frosted: { iwin1: 4, iwin2: 4 },
  // far-facade attributes for the 'mass' LOD
  mass_facade: { facade: 4, facadeId: 4 },
};
// indoor surfaces ('full' interiors): daylight factor from the room's windows (0 = not set → the
// uniform indoor sky level), written per vertex by interior/index.js (setExtraFn('idl', …))
for (const k of ['plaster', 'stone_floor', 'wood_floor', 'wood_door', 'cabinet', 'counter', 'tile_floor', 'tile_wall', 'porcelain', 'fabric', 'black', 'mirror']) EXTRA_ATTRIBUTES[k] = { idl: 1 };

// Face flags for box()
export const PX = 1, NX = 2, PY = 4, NY = 8, PZ = 16, NZ = 32, ALL = 63, SIDES = PX | NX | PZ | NZ;

const INIT_V = 4096;
const MAX_POOLED_V = 1 << 21;   // larger buffers are not kept after a build

class PartBuf {
  constructor(key, extras) {
    this.key = key;
    this.cap = INIT_V;
    this.n = 0;
    this.pos = new Float32Array(INIT_V * 3);
    this.nrm = new Float32Array(INIT_V * 3);
    this.uv = new Float32Array(INIT_V * 2);
    this.col = new Float32Array(INIT_V * 3);
    this.idx = new Uint32Array(INIT_V * 2);
    this.ni = 0;
    this.extras = [];
    this.sig = '';
    if (extras) for (const [name, size] of Object.entries(extras)) { this.extras.push({ name, size, data: new Float32Array(INIT_V * size), state: null }); this.sig += name + size; }
  }
  growV(need) {
    let cap = this.cap; while (cap < need) cap *= 2;
    const n = this.n;
    const g = (a, k) => { const b = new Float32Array(cap * k); b.set(a.subarray(0, n * k)); return b; };
    this.pos = g(this.pos, 3); this.nrm = g(this.nrm, 3); this.uv = g(this.uv, 2); this.col = g(this.col, 3);
    for (const e of this.extras) e.data = g(e.data, e.size);
    this.cap = cap;
  }
  growI(need) {
    let cap = this.idx.length; while (cap < need) cap *= 2;
    const b = new Uint32Array(cap); b.set(this.idx.subarray(0, this.ni)); this.idx = b;
  }
}

class ColBuf {
  constructor() { this.pos = new Float32Array(3 * 8192); this.n = 0; this.idx = new Uint32Array(3 * 8192); this.ni = 0; }
  v(x, y, z) {
    if ((this.n + 1) * 3 > this.pos.length) { const b = new Float32Array(this.pos.length * 2); b.set(this.pos); this.pos = b; }
    const o = this.n * 3; this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z; return this.n++;
  }
  t(a, b, c) {
    if (this.ni + 3 > this.idx.length) { const n = new Uint32Array(this.idx.length * 2); n.set(this.idx); this.idx = n; }
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  }
}

// ---- per-thread buffer pools -------------------------------------------------------------
const PART_POOL = new Map();   // key -> PartBuf[] (free)
const COL_POOL = [];
function sigOf(extras) { let s = ''; if (extras) for (const [n, k] of Object.entries(extras)) s += n + k; return s; }
function acquirePart(key, extras) {
  const list = PART_POOL.get(key);
  const sig = sigOf(extras);
  if (list) for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p.sig === sig) { list.splice(i, 1); p.n = 0; p.ni = 0; for (const e of p.extras) e.state = null; return p; }
  }
  return new PartBuf(key, extras);
}
function releasePart(p) {
  if (p.cap > MAX_POOLED_V) return;
  let list = PART_POOL.get(p.key);
  if (!list) { list = []; PART_POOL.set(p.key, list); }
  if (list.length < 2) list.push(p);
}
/** Drop all pooled buffers (memory pressure). */
export function clearBuilderPools() { PART_POOL.clear(); COL_POOL.length = 0; }

export class MeshBuilder {
  /**
   * @param {object} [opts]
   * @param {number} [opts.hash=0]        building hash (uv offsets etc.)
   * @param {boolean} [opts.colliders=false] collect collision geometry (lod 'full')
   */
  constructor(opts = {}) {
    this.parts = new Map();
    this.m = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]); // 3x4 row-major [R | t]
    this.stack = [];
    this.depth = 0;
    this.tintR = 1; this.tintG = 1; this.tintB = 1;
    this.tintStack = [];
    this.uvMode = 0;           // 0 box projection, 1 explicit
    const h = opts.hash >>> 0;
    this.uvOffU = ((h & 1023) / 1023) * 7.2;      // per-building texture offset (metres)
    this.uvOffV = 0;                              // keep vertical joints aligned to storeys
    this.extraState = {};      // name -> Float32Array(4)
    this.extraDecl = { ...EXTRA_ATTRIBUTES };
    this.col = opts.colliders ? (COL_POOL.pop() || new ColBuf()) : null;
    if (this.col) { this.col.n = 0; this.col.ni = 0; }
    this.anchors = { entrances: [], floors: [], roof: null, rooms: [], windows: [], cameras: {} };
    this.meta = {};
    this.done = false;
    this.t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  // -------------------------------------------------------------------------
  // parts / state
  // -------------------------------------------------------------------------
  /** Declare extra per-vertex attributes for a material key (before emitting into it). */
  declareExtras(key, decl) { this.extraDecl[key] = { ...(this.extraDecl[key] || {}), ...decl }; }
  /** Set the current value of an extra attribute (used by every following vertex of keys that carry it). */
  setExtra(name, a = 0, b = 0, c = 0, d = 0) {
    let s = this.extraState[name]; if (!s) s = this.extraState[name] = new Float32Array(4);
    s[0] = a; s[1] = b; s[2] = c; s[3] = d;
  }
  clearExtra(name) { const s = this.extraState[name]; if (s) s.fill(0); }
  /**
   * Per-vertex extra attribute: fn(X, Y, Z, NX, NY, NZ, out, offset) writes the value(s) of `name` for
   * each following vertex from its building-frame position / normal (e.g. the indoor daylight factor
   * 'idl'); null restores the constant state of setExtra.
   */
  setExtraFn(name, fn) { if (!this.extraFns) this.extraFns = {}; this.extraFns[name] = fn || null; }
  part(key) {
    if (key === this._lk) return this._lp;
    let p = this.parts.get(key);
    if (!p) { p = acquirePart(key, this.extraDecl[key]); this.parts.set(key, p); }
    this._lk = key; this._lp = p;
    return p;
  }
  /** Set the vertex tint (linear RGB multiplier of the material colour). */
  tint(r, g, b) { if (Array.isArray(r)) { this.tintR = r[0]; this.tintG = r[1]; this.tintB = r[2]; } else { this.tintR = r; this.tintG = g; this.tintB = b; } return this; }
  pushTint(r, g, b) { this.tintStack.push(this.tintR, this.tintG, this.tintB); return this.tint(r, g, b); }
  popTint() { const s = this.tintStack; if (s.length >= 3) { this.tintB = s.pop(); this.tintG = s.pop(); this.tintR = s.pop(); } return this; }
  /** Run fn with a temporary tint. */
  withTint(rgb, fn) { this.pushTint(rgb); try { fn(); } finally { this.popTint(); } }

  // -------------------------------------------------------------------------
  // transforms (rigid). Post-multiplied like a scene graph: later calls are more local.
  // -------------------------------------------------------------------------
  push() {
    const d = ++this.depth;
    let a = this.stack[d - 1];
    if (!a) { a = new Float64Array(12); this.stack[d - 1] = a; }
    a.set(this.m);
    return this;
  }
  pop() { const d = this.depth; if (d > 0) { this.m.set(this.stack[d - 1]); this.depth = d - 1; } return this; }
  identity() { const m = this.m; m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0; m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0; m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0; return this; }
  translate(x, y, z) {
    const m = this.m;
    m[3] += m[0] * x + m[1] * y + m[2] * z;
    m[7] += m[4] * x + m[5] * y + m[6] * z;
    m[11] += m[8] * x + m[9] * y + m[10] * z;
    return this;
  }
  /** Rotate about local +Y by `a` radians (THREE convention: +X turns towards −Z). */
  rotY(a) {
    if (!a) return this;
    const c = Math.cos(a), s = Math.sin(a), m = this.m;
    for (let r = 0; r < 3; r++) {
      const i = r * 4, x = m[i], z = m[i + 2];
      m[i] = x * c - z * s; m[i + 2] = x * s + z * c;
    }
    return this;
  }
  rotX(a) {
    if (!a) return this;
    const c = Math.cos(a), s = Math.sin(a), m = this.m;
    for (let r = 0; r < 3; r++) {
      const i = r * 4, y = m[i + 1], z = m[i + 2];
      m[i + 1] = y * c + z * s; m[i + 2] = -y * s + z * c;
    }
    return this;
  }
  rotZ(a) {
    if (!a) return this;
    const c = Math.cos(a), s = Math.sin(a), m = this.m;
    for (let r = 0; r < 3; r++) {
      const i = r * 4, x = m[i], y = m[i + 1];
      m[i] = x * c + y * s; m[i + 1] = -x * s + y * c;
    }
    return this;
  }
  /**
   * Multiply by a frame with origin o and orthonormal axes u (new local x), v (new local y),
   * n (new local z). Must be right-handed (u × v = n).
   */
  frame(ox, oy, oz, ux, uy, uz, vx, vy, vz, nx, ny, nz) {
    const m = this.m;
    for (let i = 0; i < 3; i++) {
      const a = m[i * 4], b = m[i * 4 + 1], c = m[i * 4 + 2], t = m[i * 4 + 3];
      m[i * 4] = a * ux + b * uy + c * uz;
      m[i * 4 + 1] = a * vx + b * vy + c * vz;
      m[i * 4 + 2] = a * nx + b * ny + c * nz;
      m[i * 4 + 3] = a * ox + b * oy + c * oz + t;
    }
    return this;
  }
  /** Transform a local point to the building frame. */
  tp(x, y, z) { const m = this.m; return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]]; }
  /** Transform a local direction to the building frame. */
  td(x, y, z) { const m = this.m; return [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z]; }

  // -------------------------------------------------------------------------
  // low level emit
  // -------------------------------------------------------------------------
  /** Emit one vertex (local coords) into part p; returns its index. */
  vert(p, x, y, z, nx, ny, nz, u, v) {
    const i = p.n;
    if (i >= p.cap) p.growV(i + 1);
    const m = this.m;
    const X = m[0] * x + m[1] * y + m[2] * z + m[3];
    const Y = m[4] * x + m[5] * y + m[6] * z + m[7];
    const Z = m[8] * x + m[9] * y + m[10] * z + m[11];
    const NX = m[0] * nx + m[1] * ny + m[2] * nz;
    const NY = m[4] * nx + m[5] * ny + m[6] * nz;
    const NZ = m[8] * nx + m[9] * ny + m[10] * nz;
    const i3 = i * 3, i2 = i * 2;
    const pos = p.pos, nrm = p.nrm, col = p.col;
    pos[i3] = X; pos[i3 + 1] = Y; pos[i3 + 2] = Z;
    nrm[i3] = NX; nrm[i3 + 1] = NY; nrm[i3 + 2] = NZ;
    if (this.uvMode === 0) {
      const ax = NX < 0 ? -NX : NX, ay = NY < 0 ? -NY : NY, az = NZ < 0 ? -NZ : NZ;
      if (ay >= ax && ay >= az) { u = X; v = NY > 0 ? -Z : Z; }
      else if (ax >= az) { u = NX > 0 ? -Z : Z; v = Y; }
      else { u = NZ > 0 ? X : -X; v = Y; }
      u += this.uvOffU; v += this.uvOffV;     // per-building texture offset (box-projected uvs only)
    }
    p.uv[i2] = u; p.uv[i2 + 1] = v;
    col[i3] = this.tintR; col[i3 + 1] = this.tintG; col[i3 + 2] = this.tintB;
    const ex = p.extras;
    if (ex.length) {
      for (let k = 0; k < ex.length; k++) {
        const e = ex[k];
        const s = e.state || (e.state = this.extraState[e.name] || null), size = e.size, o = i * size, d = e.data;
        const fn = this.extraFns ? this.extraFns[e.name] : null;
        if (fn) fn(X, Y, Z, NX, NY, NZ, d, o);
        else if (s) for (let j = 0; j < size; j++) d[o + j] = s[j];
        else for (let j = 0; j < size; j++) d[o + j] = 0;
      }
    }
    p.n = i + 1;
    return i;
  }
  tri(p, a, b, c) {
    if (p.ni + 3 > p.idx.length) p.growI(p.ni + 3);
    const I = p.idx; let n = p.ni;
    I[n] = a; I[n + 1] = b; I[n + 2] = c; p.ni = n + 3;
  }
  /** Emit indices for quad a,b,c,d (CCW). */
  q(p, a, b, c, d) {
    if (p.ni + 6 > p.idx.length) p.growI(p.ni + 6);
    const I = p.idx; const n = p.ni;
    I[n] = a; I[n + 1] = b; I[n + 2] = c; I[n + 3] = a; I[n + 4] = c; I[n + 5] = d; p.ni = n + 6;
  }

  /**
   * Planar quad p0..p3 (CCW seen from the front). Normal from the geometry unless given.
   * uvs: optional [u0,v0,u1,v1,u2,v2,u3,v3] (explicit uv mode for this quad only).
   */
  quad(key, x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, uvs) {
    const p = this.part(key);
    let ax = x1 - x0, ay = y1 - y0, az = z1 - z0, bx = x3 - x0, by = y3 - y0, bz = z3 - z0;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    let l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-12) { // degenerate along one diagonal: try the other
      ax = x2 - x0; ay = y2 - y0; az = z2 - z0; bx = x3 - x1; by = y3 - y1; bz = z3 - z1;
      nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx; l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-12) return;
    }
    nx /= l; ny /= l; nz /= l;
    let a, b, c, d;
    if (uvs) {
      const mode = this.uvMode; this.uvMode = 1;
      a = this.vert(p, x0, y0, z0, nx, ny, nz, uvs[0], uvs[1]);
      b = this.vert(p, x1, y1, z1, nx, ny, nz, uvs[2], uvs[3]);
      c = this.vert(p, x2, y2, z2, nx, ny, nz, uvs[4], uvs[5]);
      d = this.vert(p, x3, y3, z3, nx, ny, nz, uvs[6], uvs[7]);
      this.uvMode = mode;
    } else {
      a = this.vert(p, x0, y0, z0, nx, ny, nz, 0, 0);
      b = this.vert(p, x1, y1, z1, nx, ny, nz, 0, 0);
      c = this.vert(p, x2, y2, z2, nx, ny, nz, 0, 0);
      d = this.vert(p, x3, y3, z3, nx, ny, nz, 0, 0);
    }
    this.q(p, a, b, c, d);
  }
  /** Triangle (CCW from front). */
  triangle(key, x0, y0, z0, x1, y1, z1, x2, y2, z2) {
    const p = this.part(key);
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0, bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    const a = this.vert(p, x0, y0, z0, nx, ny, nz, 0, 0), b = this.vert(p, x1, y1, z1, nx, ny, nz, 0, 0), c = this.vert(p, x2, y2, z2, nx, ny, nz, 0, 0);
    this.tri(p, a, b, c);
  }

  // Axis-aligned rectangles in the current local frame ------------------------
  // (direct emission with known normals: no cross products / square roots)
  /** Rect in plane z=const spanning x0..x1, y0..y1. facing +1 → normal +Z, −1 → −Z. */
  rectZ(key, x0, y0, x1, y1, z, facing = 1) {
    if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6) return;
    const p = this.part(key);
    if (facing > 0) { const a = this.vert(p, x0, y0, z, 0, 0, 1, 0, 0), b = this.vert(p, x1, y0, z, 0, 0, 1, 0, 0), c = this.vert(p, x1, y1, z, 0, 0, 1, 0, 0), d = this.vert(p, x0, y1, z, 0, 0, 1, 0, 0); this.q(p, a, b, c, d); }
    else { const a = this.vert(p, x1, y0, z, 0, 0, -1, 0, 0), b = this.vert(p, x0, y0, z, 0, 0, -1, 0, 0), c = this.vert(p, x0, y1, z, 0, 0, -1, 0, 0), d = this.vert(p, x1, y1, z, 0, 0, -1, 0, 0); this.q(p, a, b, c, d); }
  }
  /** Rect in plane x=const spanning z0..z1, y0..y1. facing +1 → normal +X. */
  rectX(key, z0, y0, z1, y1, x, facing = 1) {
    if (z1 - z0 <= 1e-6 || y1 - y0 <= 1e-6) return;
    const p = this.part(key);
    if (facing > 0) { const a = this.vert(p, x, y0, z1, 1, 0, 0, 0, 0), b = this.vert(p, x, y0, z0, 1, 0, 0, 0, 0), c = this.vert(p, x, y1, z0, 1, 0, 0, 0, 0), d = this.vert(p, x, y1, z1, 1, 0, 0, 0, 0); this.q(p, a, b, c, d); }
    else { const a = this.vert(p, x, y0, z0, -1, 0, 0, 0, 0), b = this.vert(p, x, y0, z1, -1, 0, 0, 0, 0), c = this.vert(p, x, y1, z1, -1, 0, 0, 0, 0), d = this.vert(p, x, y1, z0, -1, 0, 0, 0, 0); this.q(p, a, b, c, d); }
  }
  /** Rect in plane y=const spanning x0..x1, z0..z1. facing +1 → normal +Y. */
  rectY(key, x0, z0, x1, z1, y, facing = 1) {
    if (x1 - x0 <= 1e-6 || z1 - z0 <= 1e-6) return;
    const p = this.part(key);
    if (facing > 0) { const a = this.vert(p, x0, y, z1, 0, 1, 0, 0, 0), b = this.vert(p, x1, y, z1, 0, 1, 0, 0, 0), c = this.vert(p, x1, y, z0, 0, 1, 0, 0, 0), d = this.vert(p, x0, y, z0, 0, 1, 0, 0, 0); this.q(p, a, b, c, d); }
    else { const a = this.vert(p, x0, y, z0, 0, -1, 0, 0, 0), b = this.vert(p, x1, y, z0, 0, -1, 0, 0, 0), c = this.vert(p, x1, y, z1, 0, -1, 0, 0, 0), d = this.vert(p, x0, y, z1, 0, -1, 0, 0, 0); this.q(p, a, b, c, d); }
  }

  /** Axis-aligned box; `faces` = bit mask of PX|NX|PY|NY|PZ|NZ (default all). */
  box(key, x0, y0, z0, x1, y1, z1, faces = ALL) {
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    if (z0 > z1) { const t = z0; z0 = z1; z1 = t; }
    if (faces & PZ) this.rectZ(key, x0, y0, x1, y1, z1, 1);
    if (faces & NZ) this.rectZ(key, x0, y0, x1, y1, z0, -1);
    if (faces & PX) this.rectX(key, z0, y0, z1, y1, x1, 1);
    if (faces & NX) this.rectX(key, z0, y0, z1, y1, x0, -1);
    if (faces & PY) this.rectY(key, x0, z0, x1, z1, y1, 1);
    if (faces & NY) this.rectY(key, x0, z0, x1, z1, y0, -1);
  }

  /**
   * Chamfered box: every edge bevelled by c (crisp highlights). With bottom=false the
   * bottom face and bottom-edge chamfers are omitted (object sits on a surface).
   */
  cbox(key, x0, y0, z0, x1, y1, z1, c = 0.02, bottom = true) {
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    if (z0 > z1) { const t = z0; z0 = z1; z1 = t; }
    c = Math.min(c, (x1 - x0) * 0.45, (y1 - y0) * 0.45, (z1 - z0) * 0.45);
    if (c <= 1e-4) { this.box(key, x0, y0, z0, x1, y1, z1, bottom ? ALL : ALL & ~NY); return; }
    const yb = bottom ? y0 + c : y0; // bottom of side faces
    const X0 = x0 + c, X1 = x1 - c, Y1 = y1 - c, Z0 = z0 + c, Z1 = z1 - c;
    const k = 0.7071067811865476, kk = 0.5773502691896258;
    // main faces
    this.rectZ(key, X0, yb, X1, Y1, z1, 1); this.rectZ(key, X0, yb, X1, Y1, z0, -1);
    this.rectX(key, Z0, yb, Z1, Y1, x1, 1); this.rectX(key, Z0, yb, Z1, Y1, x0, -1);
    this.rectY(key, X0, Z0, X1, Z1, y1, 1);
    if (bottom) this.rectY(key, X0, Z0, X1, Z1, y0, -1);
    const p = this.part(key);
    const Q = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz) => {
      const a = this.vert(p, ax, ay, az, nx, ny, nz, 0, 0), b = this.vert(p, bx, by, bz, nx, ny, nz, 0, 0), cc = this.vert(p, cx, cy, cz, nx, ny, nz, 0, 0), d = this.vert(p, dx, dy, dz, nx, ny, nz, 0, 0);
      this.q(p, a, b, cc, d);
    };
    const T = (ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz) => {
      const a = this.vert(p, ax, ay, az, nx, ny, nz, 0, 0), b = this.vert(p, bx, by, bz, nx, ny, nz, 0, 0), cc = this.vert(p, cx, cy, cz, nx, ny, nz, 0, 0);
      this.tri(p, a, b, cc);
    };
    // vertical edges (x,z corners) from yb..Y1
    Q(X1, yb, z1, x1, yb, Z1, x1, Y1, Z1, X1, Y1, z1, k, 0, k);      // +x+z
    Q(x1, yb, Z0, X1, yb, z0, X1, Y1, z0, x1, Y1, Z0, k, 0, -k);     // +x-z
    Q(X0, yb, z0, x0, yb, Z0, x0, Y1, Z0, X0, Y1, z0, -k, 0, -k);    // -x-z
    Q(x0, yb, Z1, X0, yb, z1, X0, Y1, z1, x0, Y1, Z1, -k, 0, k);     // -x+z
    // top edges
    Q(X0, Y1, z1, X1, Y1, z1, X1, y1, Z1, X0, y1, Z1, 0, k, k);      // top-front
    Q(X1, Y1, z0, X0, Y1, z0, X0, y1, Z0, X1, y1, Z0, 0, k, -k);     // top-back
    Q(x1, Y1, Z1, x1, Y1, Z0, X1, y1, Z0, X1, y1, Z1, k, k, 0);      // top-right
    Q(x0, Y1, Z0, x0, Y1, Z1, X0, y1, Z1, X0, y1, Z0, -k, k, 0);     // top-left
    // top corners
    T(X1, Y1, z1, x1, Y1, Z1, X1, y1, Z1, kk, kk, kk);
    T(x1, Y1, Z0, X1, Y1, z0, X1, y1, Z0, kk, kk, -kk);
    T(X0, Y1, z0, x0, Y1, Z0, X0, y1, Z0, -kk, kk, -kk);
    T(x0, Y1, Z1, X0, Y1, z1, X0, y1, Z1, -kk, kk, kk);
    if (bottom) {
      Q(X1, y0 + c, z1, X0, y0 + c, z1, X0, y0, Z1, X1, y0, Z1, 0, -k, k);   // bottom-front
      Q(X0, y0 + c, z0, X1, y0 + c, z0, X1, y0, Z0, X0, y0, Z0, 0, -k, -k);  // bottom-back
      Q(x1, y0 + c, Z0, x1, y0 + c, Z1, X1, y0, Z1, X1, y0, Z0, k, -k, 0);   // bottom-right
      Q(x0, y0 + c, Z1, x0, y0 + c, Z0, X0, y0, Z0, X0, y0, Z1, -k, -k, 0);  // bottom-left
      T(x1, y0 + c, Z1, X1, y0 + c, z1, X1, y0, Z1, kk, -kk, kk);
      T(X1, y0 + c, z0, x1, y0 + c, Z0, X1, y0, Z0, kk, -kk, -kk);
      T(x0, y0 + c, Z0, X0, y0 + c, z0, X0, y0, Z0, -kk, -kk, -kk);
      T(X0, y0 + c, z1, x0, y0 + c, Z1, X0, y0, Z1, -kk, -kk, kk);
    }
  }

  /** Box centred at (cx, y0, cz) with size (w, h, d) standing on y0, rotated by rotY. */
  boxAt(key, cx, y0, cz, w, h, d, rot = 0, chamfer = 0, faces = ALL) {
    this.push(); this.translate(cx, y0, cz); this.rotY(rot);
    if (chamfer > 0) this.cbox(key, -w / 2, 0, -d / 2, w / 2, h, d / 2, chamfer, !!(faces & NY));
    else this.box(key, -w / 2, 0, -d / 2, w / 2, h, d / 2, faces);
    this.pop();
  }

  /**
   * Horizontal polygon (with holes) at height y. pts are [x,z] in local frame. facing +1 = up.
   * Polygon winding is handled automatically.
   */
  polyY(key, outer, holes, y, facing = 1) {
    if (!outer || outer.length < 3) return;
    const all = holes && holes.length ? [outer, ...holes] : [outer];
    const idx = P.triangulate2(outer, holes || []);
    if (!idx.length) return;
    const p = this.part(key), base = [];
    const ny = facing > 0 ? 1 : -1;
    const pts = [];
    for (const ring of all) for (const pt of ring) { base.push(this.vert(p, pt[0], y, pt[1], 0, ny, 0, 0, 0)); pts.push(pt); }
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const A = pts[a], B = pts[b], C = pts[c];
      const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]); // >0: CCW in (x,z)
      // seen from +Y with x right and z towards the viewer, CCW in (x,z) appears clockwise
      const up = cr < 0;
      if (up === (facing > 0)) this.tri(p, base[a], base[b], base[c]); else this.tri(p, base[a], base[c], base[b]);
    }
  }

  // -------------------------------------------------------------------------
  // colliders (lod 'full'): plain triangles in the building frame
  // -------------------------------------------------------------------------
  colBox(x0, y0, z0, x1, y1, z1) {
    const C = this.col; if (!C) return;
    const m = this.m, v = this._cv || (this._cv = new Int32Array(8));
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? x1 : x0, y = i & 2 ? y1 : y0, z = i & 4 ? z1 : z0;
      v[i] = C.v(m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]);
    }
    C.t(v[0], v[2], v[3]); C.t(v[0], v[3], v[1]);
    C.t(v[4], v[5], v[7]); C.t(v[4], v[7], v[6]);
    C.t(v[0], v[1], v[5]); C.t(v[0], v[5], v[4]);
    C.t(v[2], v[6], v[7]); C.t(v[2], v[7], v[3]);
    C.t(v[0], v[4], v[6]); C.t(v[0], v[6], v[2]);
    C.t(v[1], v[3], v[7]); C.t(v[1], v[7], v[5]);
  }
  colQuad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3) {
    const C = this.col; if (!C) return;
    const m = this.m;
    const T = (x, y, z) => C.v(m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]);
    const ia = T(x0, y0, z0), ib = T(x1, y1, z1), ic = T(x2, y2, z2), id = T(x3, y3, z3);
    C.t(ia, ib, ic); C.t(ia, ic, id);
  }
  colPolyY(outer, holes, y) {
    const C = this.col; if (!C) return;
    const idx = P.triangulate2(outer, holes || []);
    const pts = [outer, ...(holes || [])].flat();
    const base = pts.map((pt) => { const q = this.tp(pt[0], y, pt[1]); return C.v(q[0], q[1], q[2]); });
    for (let i = 0; i < idx.length; i += 3) C.t(base[idx[i]], base[idx[i + 1]], base[idx[i + 2]]);
  }
  get collecting() { return !!this.col; }

  // -------------------------------------------------------------------------
  // convenience wrappers for primitives.js (pleasant API: b.sweep(...), b.lathe(...))
  // -------------------------------------------------------------------------
  sweep(key, path, profile, opts) { return P.sweep(this, key, path, profile, opts); }
  lathe(key, profile, segs, opts) { return P.lathe(this, key, profile, segs, opts); }
  cylinder(key, x, y, z, r, h, segs, opts) { return P.cylinder(this, key, x, y, z, r, h, segs, opts); }
  tube(key, path, r, segs, opts) { return P.tube(this, key, path, r, segs, opts); }
  prism(key, poly, y0, y1, opts) { return P.prism(this, key, poly, y0, y1, opts); }
  extrudeX(key, profile, x0, x1, opts) { return P.extrudeX(this, key, profile, x0, x1, opts); }
  blob(key, cx, cy, cz, rx, ry, rz, seed, detail) { return P.blob(this, key, cx, cy, cz, rx, ry, rz, seed, detail); }

  // -------------------------------------------------------------------------
  // output
  // -------------------------------------------------------------------------
  /** Total triangles so far. */
  triangleCount() { let t = 0; for (const p of this.parts.values()) t += p.ni / 3; return t; }
  /** Vertices so far in part `key` (0 when absent). */
  vertexCount(key) { const p = this.parts.get(key); return p ? p.n : 0; }

  /** Release pooled buffers without producing output (abandoned builder). */
  dispose() {
    if (this.done) return;
    this.done = true;
    for (const p of this.parts.values()) releasePart(p);
    this.parts.clear(); this._lk = null; this._lp = null;
    if (this.col) { COL_POOL.push(this.col); this.col = null; }
  }

  /**
   * Finish into BuildingMeshData. Every attribute kind of every part lives in one packed
   * ArrayBuffer (parts hold subarray views) → few transferables, no per-part allocation.
   * @returns {{parts:Array, colliders?:{position:Float32Array,index:Uint32Array}, bounds:{min:number[],max:number[]}, anchors:object, stats:object}}
   */
  finish() {
    if (this.done) throw new Error('MeshBuilder.finish() called twice');
    const keys = [...this.parts.keys()].sort();
    let NV = 0, NI = 0;
    const extraTot = {};
    for (const key of keys) {
      const p = this.parts.get(key);
      if (!p.n || !p.ni) continue;
      NV += p.n; NI += p.ni;
      for (const e of p.extras) extraTot[e.name] = (extraTot[e.name] || 0) + p.n * e.size;
    }
    const POS = new Float32Array(NV * 3), NRM = new Float32Array(NV * 3), UV = new Float32Array(NV * 2), COL = new Float32Array(NV * 3), IDX = new Uint32Array(NI);
    const EXB = {}, EXO = {};
    for (const [name, n] of Object.entries(extraTot)) { EXB[name] = new Float32Array(n); EXO[name] = 0; }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const parts = [];
    let ov = 0, oi = 0;
    for (const key of keys) {
      const p = this.parts.get(key);
      if (!p.n || !p.ni) continue;
      const n = p.n, ni = p.ni;
      const pos = p.pos;
      for (let i = 0, e = n * 3; i < e; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      POS.set(pos.subarray(0, n * 3), ov * 3); NRM.set(p.nrm.subarray(0, n * 3), ov * 3);
      UV.set(p.uv.subarray(0, n * 2), ov * 2); COL.set(p.col.subarray(0, n * 3), ov * 3);
      IDX.set(p.idx.subarray(0, ni), oi);
      const part = {
        material: key,
        position: POS.subarray(ov * 3, (ov + n) * 3),
        normal: NRM.subarray(ov * 3, (ov + n) * 3),
        uv: UV.subarray(ov * 2, (ov + n) * 2),
        color: COL.subarray(ov * 3, (ov + n) * 3),
        index: IDX.subarray(oi, oi + ni),
      };
      if (p.extras.length) {
        part.attributes = {};
        for (const e of p.extras) {
          const o = EXO[e.name], len = n * e.size;
          EXB[e.name].set(e.data.subarray(0, len), o);
          part.attributes[e.name] = { array: EXB[e.name].subarray(o, o + len), itemSize: e.size };
          EXO[e.name] = o + len;
        }
      }
      parts.push(part);
      ov += n; oi += ni;
    }
    const out = {
      parts,
      bounds: { min: isFinite(minX) ? [minX, minY, minZ] : [0, 0, 0], max: isFinite(maxX) ? [maxX, maxY, maxZ] : [0, 0, 0] },
      anchors: this.anchors,
      stats: { triangles: NI / 3, vertices: NV, parts: parts.length, ms: 0 },
    };
    if (this.col && this.col.ni) {
      out.colliders = { position: this.col.pos.slice(0, this.col.n * 3), index: this.col.idx.slice(0, this.col.ni) };
      out.stats.colliderTriangles = this.col.ni / 3;
    }
    if (Object.keys(this.meta).length) out.meta = this.meta;
    this.dispose();
    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    out.stats.ms = Math.round((t1 - this.t0) * 100) / 100;
    return out;
  }
}
