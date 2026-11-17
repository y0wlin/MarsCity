// Shared engineering parts for the megastructures (worker-safe). OWNER: megastructure agent.
// All helpers emit into ctx.b (building-kit MeshBuilder) in its CURRENT local frame, metres.
// Material keys: building vocabulary (buildings/materials.js) + the mega_* keys of
// megastructures/materials.js (mega_concrete / mega_rock / mega_steel carry the vec4 `aMega`
// attribute: (water reference level -> becomes height above it, exposure, splash top, wear)).
import { MeshBuilder, PX, NX, PY, NY, PZ, NZ, ALL } from '../buildings/kit/MeshBuilder.js';
import { ladder as kitLadder, antennaMast, hvacUnit } from '../buildings/kit/roof.js';
import { shrub } from '../buildings/kit/vegetation.js';
import { hash4, hashString, Rng } from '../core/hash.js';

export { PX, NX, PY, NY, PZ, NZ, ALL };
export const MEGA_SURFACES = ['mega_concrete', 'mega_rock', 'mega_steel', 'mega_asphalt', 'mega_road'];
export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// exposure codes for aMega.y
export const EXPO = { DRY: 0, INNER: 0.5, OUTER: 1, CHUTE: 2, LOCK: 0.75 };

/**
 * Generation context of one chunk: builder + LOD flags + part registry for picking.
 * Colliders are always collected (walking at near/mid, picking at every LOD).
 */
export class Ctx {
  constructor(site, chunk, lod) {
    this.site = site; this.chunk = chunk; this.lod = lod;
    this.far = lod === 'far'; this.mid = lod === 'mid'; this.near = lod === 'near';
    this.detail = lod !== 'far';
    this.seed = hashString(chunk.id);
    this.b = new MeshBuilder({ hash: this.seed, colliders: true });
    for (const k of MEGA_SURFACES) this.b.declareExtras(k, { aMega: 4 });
    this.parts = []; this.partIdx = new Map(); this.marks = []; this.cur = -1;
    this.setPart(chunk.part || chunk.id, chunk.name || chunk.id);
    this.water(0, EXPO.DRY, 0, 0);
    this.lights = [];          // night light anchors {x,y,z,kind} (chunk-flat) for diagnostics
    this.coolLights = site && site.id === 'G01';   // harbour works: cool white; water stairs: warm
  }
  rng(channel, extra = 0) { return new Rng(hash4(this.seed, channel | 0, extra | 0, 0x3e9a)); }
  setPart(id, name) {
    let i = this.partIdx.get(id);
    if (i === undefined) { i = this.parts.length; this.parts.push({ id, name: name || id }); this.partIdx.set(id, i); }
    if (this.cur !== i) { this.cur = i; this.marks.push(this.b.col ? this.b.col.n : 0, i); }
    return i;
  }
  /** set the aMega state for following mega_* vertices: water reference level (m), exposure, splash top above it (m), wear */
  water(ref, expo, splash, wear = 0) { this.b.setExtra('aMega', ref, expo, splash, wear); }
}

// ---------------------------------------------------------------------------------------------
// generic solids
// ---------------------------------------------------------------------------------------------
/** box + matching collider */
export function solid(c, key, x0, y0, z0, x1, y1, z1, faces = ALL, col = true) {
  c.b.box(key, x0, y0, z0, x1, y1, z1, faces);
  if (col) c.b.colBox(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
}
export function csolid(c, key, x0, y0, z0, x1, y1, z1, ch = 0.05, col = true, bottom = false) {
  c.b.cbox(key, x0, y0, z0, x1, y1, z1, ch, bottom);
  if (col) c.b.colBox(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
}

/** quad strip between two polylines (same count) a[i] -> b[i]; CCW faces toward the viewer side */
export function strip(c, key, A, B, flip = false) {
  for (let i = 0; i < A.length - 1; i++) {
    const a0 = A[i], a1 = A[i + 1], b0 = B[i], b1 = B[i + 1];
    if (!flip) c.b.quad(key, a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], b1[0], b1[1], b1[2], b0[0], b0[1], b0[2]);
    else c.b.quad(key, a0[0], a0[1], a0[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], a1[0], a1[1], a1[2]);
  }
}

/**
 * Profile [[z, y], ...] (in the local Z-Y plane) extruded along local X from x0 to x1, with end
 * caps (profile must be CCW seen from +X: z to the right... we orient automatically).
 */
export function extrude(c, key, prof, x0, x1, caps = true, sides = true) {
  const b = c.b;
  // orientation: signed area in (z, y)
  let area = 0; for (let i = 0, n = prof.length, j = n - 1; i < n; j = i++) area += prof[j][0] * prof[i][1] - prof[i][0] * prof[j][1];
  const P = area < 0 ? prof : prof.slice().reverse();     // want clockwise in (z,y) so normals face out (+X looking)
  const n = P.length;
  if (sides) for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n];
    b.quad(key, x0, p[1], p[0], x1, p[1], p[0], x1, q[1], q[0], x0, q[1], q[0]);
  }
  if (caps && n >= 3) {
    // fan caps (profile convex-ish); use polygon triangulation in the Z-Y plane via polyY trick
    capFan(b, key, P, x1, 1); capFan(b, key, P, x0, -1);
  }
}
function capFan(b, key, P, x, s) {
  const p = b.part(key);
  const idx = [];
  for (const q of P) idx.push(b.vert(p, x, q[1], q[0], s, 0, 0, 0, 0));
  // ear-clip simple polygon in (z,y)
  const pts = P.map((q) => [q[0], q[1]]);
  const tri = earClip(pts);
  for (let k = 0; k < tri.length; k += 3) {
    const A = pts[tri[k]], B = pts[tri[k + 1]], C = pts[tri[k + 2]];
    // facing +X: (z right?, y up) seen from +X, z axis points left. Check orientation by cross
    const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    const wantPos = s > 0 ? cr < 0 : cr > 0;
    if (wantPos) b.tri(p, idx[tri[k]], idx[tri[k + 1]], idx[tri[k + 2]]); else b.tri(p, idx[tri[k]], idx[tri[k + 2]], idx[tri[k + 1]]);
  }
}
function earClip(pts) {
  const n = pts.length; if (n < 3) return [];
  let area = 0; for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  const V = []; for (let i = 0; i < n; i++) V.push(area > 0 ? i : n - 1 - i);
  const out = []; let guard = 0;
  while (V.length > 3 && guard++ < 4 * n) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const a = pts[V[(i + V.length - 1) % V.length]], b = pts[V[i]], cc = pts[V[(i + 1) % V.length]];
      const cr = (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0]);
      if (cr <= 1e-9) continue;
      let inside = false;
      for (let k = 0; k < V.length && !inside; k++) {
        const pk = pts[V[k]]; if (pk === a || pk === b || pk === cc) continue;
        const d1 = (b[0] - a[0]) * (pk[1] - a[1]) - (b[1] - a[1]) * (pk[0] - a[0]);
        const d2 = (cc[0] - b[0]) * (pk[1] - b[1]) - (cc[1] - b[1]) * (pk[0] - b[0]);
        const d3 = (a[0] - cc[0]) * (pk[1] - cc[1]) - (a[1] - cc[1]) * (pk[0] - cc[0]);
        if (d1 >= 0 && d2 >= 0 && d3 >= 0) inside = true;
      }
      if (inside) continue;
      out.push(V[(i + V.length - 1) % V.length], V[i], V[(i + 1) % V.length]);
      V.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (V.length === 3) out.push(V[0], V[1], V[2]);
  return out;
}

/** horizontal cylinder along local X from x0 to x1 centred at (y, z) */
export function cylX(c, key, x0, x1, y, z, r, segs = 12, caps = true) {
  const b = c.b; b.push(); b.translate(x0, y, z); b.rotZ(-Math.PI / 2);
  b.lathe(key, [[r, 0], [r, x1 - x0]], segs, { capTop: caps, capBottom: caps });
  b.pop();
}
/** horizontal cylinder along local Z */
export function cylZ(c, key, x, y, z0, z1, r, segs = 12, caps = true) {
  const b = c.b; b.push(); b.translate(x, y, z0); b.rotX(Math.PI / 2);
  b.lathe(key, [[r, 0], [r, z1 - z0]], segs, { capTop: caps, capBottom: caps });
  b.pop();
}

// ---------------------------------------------------------------------------------------------
// walkway parts
// ---------------------------------------------------------------------------------------------
/**
 * Safety railing along a polyline of base points [[x,y,z]...]: top rail, knee rail, toe board, posts.
 * o: {key='steel_yellow', h=1.1, spacing=1.5, toe=true, col=true}
 */
export function railing(c, pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const b = c.b, key = o.key || 'steel_yellow', H = o.h ?? 1.1, sp = o.spacing ?? 1.5;
  if (!c.near) {
    // mid: a thin flat band (reads as the railing line from a few hundred metres)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], q = pts[i + 1];
      b.quad(key, a[0], a[1] + H - 0.06, a[2], q[0], q[1] + H - 0.06, q[2], q[0], q[1] + H, q[2], a[0], a[1] + H, a[2]);
      b.quad(key, q[0], q[1] + H - 0.06, q[2], a[0], a[1] + H - 0.06, a[2], a[0], a[1] + H, a[2], q[0], q[1] + H, q[2]);
    }
  } else {
    b.tube(key, pts.map((p) => [p[0], p[1] + H, p[2]]), 0.024, 8, { transport: true });
    b.tube(key, pts.map((p) => [p[0], p[1] + H * 0.52, p[2]]), 0.017, 6, { transport: true });
    let acc = 0;
    const post = (p) => b.box(key, p[0] - 0.025, p[1], p[2] - 0.025, p[0] + 0.025, p[1] + H - 0.02, p[2] + 0.025, PX | NX | PZ | NZ);
    post(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const L = Math.hypot(q[0] - p[0], q[2] - p[2]);
      let t = sp - acc;
      while (t < L - 0.1) { const k = t / L; post([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k]); t += sp; }
      acc = (acc + L) % sp;
      if (o.toe !== false) {
        // toe board: 0.1 m flat bar both faces
        const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.004, nz = dx / l * 0.004;
        b.quad(key, p[0] + nx, p[1], p[2] + nz, q[0] + nx, q[1], q[2] + nz, q[0] + nx, q[1] + 0.1, q[2] + nz, p[0] + nx, p[1] + 0.1, p[2] + nz);
        b.quad(key, q[0] - nx, q[1], q[2] - nz, p[0] - nx, p[1], p[2] - nz, p[0] - nx, p[1] + 0.1, p[2] - nz, q[0] - nx, q[1] + 0.1, q[2] - nz);
      }
    }
    post(pts[pts.length - 1]);
  }
  if (o.col !== false) for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], q = pts[i + 1];
    b.colQuad(a[0], a[1], a[2], q[0], q[1], q[2], q[0], q[1] + H, q[2], a[0], a[1] + H, a[2]);
  }
}

/** straight railing along local X at (y, z) from x0 to x1 */
export function railX(c, x0, x1, y, z, o = {}) { railing(c, [[x0, y, z], [x1, y, z]], o); }
export function railZ(c, x, y, z0, z1, o = {}) { railing(c, [[x, y, z0], [x, y, z1]], o); }

/** steel bar-grating deck (see-through near) between x0..x1, z0..z1 at height y with edge angles */
export function grating(c, x0, z0, x1, z1, y, o = {}) {
  const b = c.b;
  if (c.near) {
    b.rectY('mega_grating', x0, z0, x1, z1, y, 1);
    b.rectY('mega_grating', x0, z0, x1, z1, y - 0.03, -1);
    // edge angles + cross bearers every 1.2 m
    b.box('steel', x0, y - 0.08, z0, x1, y, z0 + 0.05, ALL); b.box('steel', x0, y - 0.08, z1 - 0.05, x1, y, z1, ALL);
    const along = x1 - x0 > z1 - z0;
    if (along) for (let x = x0; x <= x1 + 1e-6; x += 1.2) b.box('steel', x - 0.025, y - 0.1, z0, x + 0.025, y - 0.03, z1, PX | NX | NY);
    else for (let z = z0; z <= z1 + 1e-6; z += 1.2) b.box('steel', x0, y - 0.1, z - 0.025, x1, y - 0.03, z + 0.025, PZ | NZ | NY);
  } else {
    b.rectY(o.midKey || 'steel', x0, z0, x1, z1, y, 1);
  }
  if (o.col !== false) b.colBox(Math.min(x0, x1), y - 0.08, Math.min(z0, z1), Math.max(x0, x1), y, Math.max(z0, z1));
}

/** cable tray (缆槽) along local X at height y (bottom), centred on z, width w: U channel + cables + brackets */
export function cableTray(c, x0, x1, y, z, w = 0.6, o = {}) {
  const b = c.b, key = o.key || 'steel';
  if (!c.near) { b.box(key, x0, y, z - w / 2, x1, y + 0.15, z + w / 2, PY | PZ | NZ); return; }
  b.box(key, x0, y, z - w / 2, x1, y + 0.012, z + w / 2, PY | NY | PZ | NZ);
  b.box(key, x0, y, z - w / 2, x1, y + 0.15, z - w / 2 + 0.01, ALL & ~(PX | NX));
  b.box(key, x0, y, z + w / 2 - 0.01, x1, y + 0.15, z + w / 2, ALL & ~(PX | NX));
  const n = Math.max(2, Math.floor((w - 0.08) / 0.09));
  for (let i = 0; i < n; i++) {
    const zz = z - w / 2 + 0.06 + i * ((w - 0.12) / Math.max(1, n - 1));
    const r = 0.022 + (i % 3) * 0.008;
    cylX(c, i % 4 === 1 ? 'steel_dark' : 'black', x0, x1, y + 0.012 + r, zz, r, 6, false);
  }
  const sp = o.spacing ?? 2.0;
  if (o.brackets !== false) for (let x = x0 + 0.3; x < x1; x += sp) {
    b.box(key, x - 0.03, y - 0.05, z - w / 2 - 0.02, x + 0.03, y, z + w / 2 + 0.02, ALL);
    if (o.hang !== undefined) b.box(key, x - 0.02, y - 0.05, z - 0.02, x + 0.02, o.hang, z + 0.02, PX | NX | PZ | NZ);
  }
  if (o.cover) for (let x = x0; x < x1 - 0.1; x += 1.5) b.box('mega_grating', x + 0.01, y + 0.15, z - w / 2, Math.min(x1, x + 1.49), y + 0.16, z + w / 2, PY | NY);
}

/** cable duct on a deck (缆槽): low concrete trough with chequer-plate covers, along X at deck height y */
export function cableTrench(c, x0, x1, y, z, w = 1.0) {
  const b = c.b;
  b.box('mega_concrete', x0, y, z - w / 2 - 0.15, x1, y + 0.22, z - w / 2, PZ | NZ | PY);
  b.box('mega_concrete', x0, y, z + w / 2, x1, y + 0.22, z + w / 2 + 0.15, PZ | NZ | PY);
  if (c.near) {
    for (let x = x0; x < x1 - 0.2; x += 1.0) b.box('steel', x + 0.006, y + 0.16, z - w / 2, Math.min(x1, x + 0.994), y + 0.19, z + w / 2, PY | PX | NX);
  } else b.box('steel_dark', x0, y + 0.16, z - w / 2, x1, y + 0.19, z + w / 2, PY);
}

/** lamp post standing at (x, y, z), arm towards local +Z rotated by rot (radians about Y) */
export function lampPost(c, x, y, z, rot = 0, h = 8, o = {}) {
  const b = c.b;
  b.push(); b.translate(x, y, z); b.rotY(rot);
  if (c.near) {
    b.cbox('concrete', -0.3, 0, -0.3, 0.3, 0.35, 0.3, 0.04, false);
    b.box('steel', -0.2, 0.35, -0.2, 0.2, 0.38, 0.2, ALL & ~NY);
    for (const [bx, bz] of [[-0.15, -0.15], [0.15, -0.15], [0.15, 0.15], [-0.15, 0.15]]) b.cylinder('steel', bx, 0.38, bz, 0.018, 0.04, 6, { top: true });
    b.lathe('steel', [[0.1, 0.38], [0.085, h * 0.5], [0.065, h]], 12, { capTop: true });
    b.tube('steel', [[0, h - 0.4, 0], [0, h - 0.05, 0.35], [0, h, 1.1]], 0.04, 8);
    b.cbox('aluminium_dark', -0.18, h - 0.14, 0.9, 0.18, h + 0.04, 1.6, 0.02);
    b.box('light_warm', -0.14, h - 0.15, 0.95, 0.14, h - 0.14, 1.55, NY);
  } else {
    b.box('steel', -0.08, 0, -0.08, 0.08, h, 0.08, PX | NX | PZ | NZ);
    b.box('steel', -0.05, h - 0.1, 0, 0.05, h, 1.2, PY | PX | NX | NY);
    b.box('aluminium_dark', -0.18, h - 0.15, 0.9, 0.18, h, 1.6, PY | PX | NX | PZ);
    b.box('light_warm', -0.15, h - 0.16, 0.92, 0.15, h - 0.15, 1.58, NY);
  }
  b.pop();
  if (o.pool !== false) lightPool(c, x + Math.sin(rot) * 1.25, y + 0.12, z + Math.cos(rot) * 1.25, h * 0.85, !!(o.cool ?? c.coolLights));
  if (o.col !== false && c.detail) { b.push(); b.translate(x, y, z); b.colBox(-0.12, 0, -0.12, 0.12, 3, 0.12); b.pop(); }
}

/** mooring bollard (tee head) on a deck at (x, y, z) */
export function bollard(c, x, y, z, o = {}) {
  const b = c.b, k = o.key || 'steel_dark';
  if (!c.near) { b.box(k, x - 0.25, y, z - 0.25, x + 0.25, y + 0.7, z + 0.25, ALL & ~NY); return; }
  b.box(k, x - 0.45, y, z - 0.45, x + 0.45, y + 0.05, z + 0.45, ALL & ~NY);
  for (const [bx, bz] of [[-0.35, -0.35], [0.35, -0.35], [0.35, 0.35], [-0.35, 0.35]]) b.cylinder('steel', x + bx, y + 0.05, z + bz, 0.03, 0.04, 6, { top: true });
  b.lathe(k, [[0.26, 0.05], [0.22, 0.2], [0.2, 0.5], [0.24, 0.58], [0.34, 0.62], [0.34, 0.72], [0.2, 0.76], [0.0, 0.77]], 16, { x, y, z, smoothAngle: 50 });
  b.box(k, x - 0.48, y + 0.6, z - 0.08, x + 0.48, y + 0.7, z + 0.08, ALL);
  b.box('steel_yellow', x - 0.2, y + 0.765, z - 0.2, x + 0.2, y + 0.775, z + 0.2, PY);
  if (o.col !== false) b.colBox(x - 0.3, y, z - 0.3, x + 0.3, y + 0.75, z + 0.3);
}

/** ladder on a wall face: wall plane at local z = 0 facing +Z (after rot), from y0 up h metres */
export function ladder(c, x, y0, z, h, rot = 0, o = {}) {
  if (!c.near) return;
  kitLadder(c.b, x, y0, z, h, rot, { key: o.key || 'steel_yellow', w: 0.5 });
  if (o.hoop) {
    const b = c.b; b.push(); b.translate(x, y0, z); b.rotY(rot);
    for (let yy = 2.4; yy < h; yy += 0.9) b.tube(o.key || 'steel_yellow', hoop(yy), 0.012, 5);
    for (const a of [0.6, Math.PI / 2, Math.PI - 0.6]) b.box(o.key || 'steel_yellow', Math.cos(a) * 0.38 - 0.01, 2.4, 0.17 + Math.sin(a) * 0.62 - 0.01, Math.cos(a) * 0.38 + 0.01, h, 0.17 + Math.sin(a) * 0.62 + 0.01, PX | NX | PZ | NZ);
    b.pop();
  }
}
/** safety-cage hoop around the climber (ladder frame: wall at z = 0, rungs at z ≈ 0.15) */
function hoop(y) { const out = []; for (let i = 0; i <= 10; i++) { const a = (Math.PI * i) / 10; out.push([Math.cos(a) * 0.38, y, 0.17 + Math.sin(a) * 0.62]); } return out; }

/**
 * panel fender on a vertical quay face: face plane at local z = 0 facing +Z. Rubber cone + steel
 * frame + UHMW pads + chains. Centre (x, y). Panel w × h.
 */
export function fender(c, x, y, o = {}) {
  const b = c.b, w = o.w ?? 2.4, h = o.h ?? 3.0, d = o.d ?? 1.0;
  if (!c.near) { b.box('rubber', x - w / 2, y - h / 2, 0, x + w / 2, y + h / 2, d, PZ | PX | NX | PY | NY); return; }
  // rubber cone unit
  b.push(); b.translate(x, y, 0); b.rotX(Math.PI / 2);
  b.lathe('rubber', [[0.75, 0], [0.7, 0.08], [0.48, d * 0.7], [0.5, d * 0.78]], 16, { smoothAngle: 30 });
  b.pop();
  // steel frame panel
  b.cbox('steel_dark', x - w / 2, y - h / 2, d * 0.78, x + w / 2, y + h / 2, d * 0.92, 0.03, true);
  // UHMW pads (pale, scuffed)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const px = x - w / 2 + 0.1 + j * (w / 2 - 0.05), py = y - h / 2 + 0.1 + i * (h / 3 - 0.03);
    b.withTint([0.55, 0.56, 0.55], () => b.box('plastic_bin', px, py, d * 0.92, px + w / 2 - 0.15, py + h / 3 - 0.17, d, PZ | PX | NX | PY | NY));
  }
  // chains (tension / weight) to wall eyes
  for (const s of [-1, 1]) {
    b.tube('steel_dark', [[x + s * (w / 2 - 0.15), y + h / 2 - 0.1, d * 0.85], [x + s * (w / 2 + 0.25), y + h / 2 + 0.4, 0.05]], 0.02, 5);
    b.tube('steel_dark', [[x + s * (w / 2 - 0.15), y - h / 2 + 0.1, d * 0.85], [x + s * 0.3, y - h / 2 - 0.6, 0.05]], 0.02, 5);
  }
}

/** grid of hex bolt heads on the plane z (facing +Z), spacing sp, head radius r */
export function bolts(c, x0, y0, x1, y1, z, sp = 0.15, r = 0.018, key = 'steel', dustSide = 0) {
  if (!c.near) return;
  const b = c.b;
  const nx = Math.max(1, Math.round((x1 - x0) / sp)), ny = Math.max(1, Math.round((y1 - y0) / sp));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    if (nx > 1 && ny > 1 && i > 0 && i < nx && j > 0 && j < ny) continue;     // perimeter only
    const x = x0 + ((x1 - x0) * i) / nx, y = y0 + ((y1 - y0) * j) / ny;
    // counterbore: a dark recess ring the head sits in
    b.push(); b.translate(x, y, z); b.rotX(Math.PI / 2);
    b.lathe('steel_dark', [[r * 1.75, 0.0015], [r * 1.25, 0.0015]], 10, {});
    b.lathe(key, [[r, 0], [r, r * 0.7], [r * 0.6, r * 0.95]], 6, { capTop: true });
    b.pop();
    // dry dust left in the leeward / lower part of the recess (the wind side is washed clean)
    if (dustSide) dustCrescent(c, x, y, z + 0.002, r, dustSide, hash4(c.seed, i, j, 0x5d) / 4294967296);
  }
}
/** small flat crescent of red dust around the lee-lower quadrant of a bolt head (plane z, facing +Z) */
function dustCrescent(c, x, y, z, r, side, h) {
  const b = c.b, n = 7, r0 = r * 1.02, r1 = r * (1.55 + 0.35 * h);
  const a0 = side > 0 ? -1.75 : Math.PI + 0.25, a1 = a0 + 1.5 + 0.6 * h;       // angle around +Z, 0 = +X
  const p = b.part('mega_dust');
  let prevI = -1, prevO = -1;
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n, w = Math.sin((Math.PI * k) / n);
    const ca = Math.cos(a), sa = Math.sin(a), ro = r0 + (r1 - r0) * (0.35 + 0.65 * w);
    const vi = b.vert(p, x + ca * r0, y + sa * r0, z, 0, 0, 1, 0, 0);
    const vo = b.vert(p, x + ca * ro, y + sa * ro, z, 0, 0, 1, 0, 0);
    if (k) { b.tri(p, prevI, prevO, vo); b.tri(p, prevI, vo, vi); }
    prevI = vi; prevO = vo;
  }
}

/**
 * Bar grille panel set in a recess on a wall plane z = 0 facing +Z: frame, vertical bars, bolts.
 * (x0..x1, y0..y1); recess depth dr.
 */
export function grille(c, x0, y0, x1, y1, o = {}) {
  const b = c.b, dr = o.depth ?? 0.25, key = o.key || 'mega_steel';
  // o.proud: a grille housing mounted on a continuous wall face (frame plane dr in front of the wall,
  // dark back plate on the wall) — no hole in the wall needed. Otherwise a recess cut into the wall.
  const zf = o.proud ? dr : 0, zr = o.proud ? 0.004 : -dr;
  b.rectZ('steel_dark', x0, y0, x1, y1, zr, 1);
  if (o.proud) {
    b.rectX(key, zr, y0, zf, y1, x0, -1); b.rectX(key, zr, y0, zf, y1, x1, 1);
    b.rectY(key, x0, zr, x1, zf, y0, -1); b.rectY(key, x0, zr, x1, zf, y1, 1);
    b.rectX('steel_dark', zr, y0, zf, y1, x0 + 0.003, 1); b.rectX('steel_dark', zr, y0, zf, y1, x1 - 0.003, -1);
    b.rectY('steel_dark', x0, zr, x1, zf, y0 + 0.003, 1); b.rectY('steel_dark', x0, zr, x1, zf, y1 - 0.003, -1);
    if (o.col !== false) c.b.colBox(x0, y0, 0, x1, y1, zf + 0.02);
  } else {
    b.rectX('mega_concrete', -dr, y0, 0, y1, x0, 1); b.rectX('mega_concrete', -dr, y0, 0, y1, x1, -1);
    b.rectY('mega_concrete', x0, -dr, x1, 0, y0, 1); b.rectY('mega_concrete', x0, -dr, x1, 0, y1, -1);
  }
  // frame
  const fw = 0.08;
  b.box(key, x0, y0, zf - 0.06, x1, y0 + fw, zf + 0.02, ALL); b.box(key, x0, y1 - fw, zf - 0.06, x1, y1, zf + 0.02, ALL);
  b.box(key, x0, y0, zf - 0.06, x0 + fw, y1, zf + 0.02, ALL); b.box(key, x1 - fw, y0, zf - 0.06, x1, y1, zf + 0.02, ALL);
  if (!c.near) { b.rectZ(key, x0 + fw, y0 + fw, x1 - fw, y1 - fw, zf - 0.05, 1); return; }
  // bars + two horizontal tie bars
  for (let x = x0 + fw + 0.06; x < x1 - fw - 0.02; x += 0.075) b.box(key, x - 0.012, y0 + fw, zf - 0.05, x + 0.012, y1 - fw, zf, PZ | PX | NX);
  for (const t of [0.33, 0.66]) { const y = y0 + (y1 - y0) * t; b.box(key, x0 + fw, y - 0.02, zf - 0.02, x1 - fw, y + 0.02, zf + 0.012, ALL); }
  // bolts in the frame (recessed counterbores: dust collects on the lee side, see shader)
  const sp = Math.max(0.25, (x1 - x0) / Math.max(2, Math.round((x1 - x0) / 0.35)));
  bolts(c, x0 + 0.04, y0 + 0.04, x1 - 0.04, y1 - 0.04, zf + 0.02, sp, 0.016, 'steel', o.dustSide || 0);
}

/** faceted armour stone (icosahedron, flat faces) at (x, y, z) radius s, seed */
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; });
  const f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  return { v, f };
})();
export function rock(c, key, x, y, z, s, seed, squash = 0.7) {
  const b = c.b, r = new Rng(seed >>> 0);
  const P = ICO.v.map((p) => { const k = 0.72 + r.next() * 0.5; return [x + p[0] * s * k * (0.9 + r.next() * 0.3), y + p[1] * s * k * squash, z + p[2] * s * k * (0.9 + r.next() * 0.3)]; });
  // quarry mix: mostly grey granite / basalt, some dark basalt, a few iron-oxidised blocks
  const q = r.next(), v = 0.82 + r.next() * 0.36;
  const t = q < 0.18 ? [0.62, 0.6, 0.6] : q < 0.3 ? [1.28, 0.98, 0.82] : q < 0.42 ? [1.22, 1.2, 1.16] : [1, 1, 1];
  b.pushTint(b.tintR * t[0] * v, b.tintG * t[1] * v, b.tintB * t[2] * v);
  const F = ICO.f;
  for (let i = 0; i < F.length; i += 3) {
    const A = P[F[i]], B = P[F[i + 1]], C = P[F[i + 2]];
    // ensure outward orientation
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const out = nx * (A[0] - x) + ny * (A[1] - y) + nz * (A[2] - z) > 0;
    if (out) b.triangle(key, A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    else b.triangle(key, A[0], A[1], A[2], C[0], C[1], C[2], B[0], B[1], B[2]);
  }
  b.popTint();
}

/**
 * Concrete armour unit (cube with chamfered corners, Antifer-type) at (x, y, z), edge s, yaw ry.
 * Used on the seaward berm of the caissons: reads as the regular grey block texture of the
 * reference at the toe of the barrier.
 */
export function armourCube(c, x, y, z, s, ry, tilt = 0) {
  const b = c.b;
  b.push(); b.translate(x, y, z); b.rotY(ry); if (tilt) b.rotX(tilt);
  b.cbox('mega_concrete', -s / 2, -s / 2, -s / 2, s / 2, s / 2, s / 2, s * 0.12, true);
  b.pop();
}

/** horizontal construction (lift) joints: thin dark grooves on the plane z = zf (facing sign s), x0..x1, every dy from y0 to y1 */
export function liftJoints(c, x0, x1, y0, y1, zf, s, dy = 2.5) {
  if (!c.near) return;
  const b = c.b;
  b.pushTint(b.tintR * 0.55, b.tintG * 0.55, b.tintB * 0.55);
  for (let y = y0; y <= y1 + 1e-6; y += dy) b.rectZ('mega_concrete', x0, y - 0.025, x1, y + 0.025, zf + s * 0.006, s);
  b.popTint();
}

// ---------------------------------------------------------------------------------------------
// buildings
// ---------------------------------------------------------------------------------------------
/**
 * Round white gate-house / control tower standing at (x, y, z): drum radius r, height h, glass band
 * (lit windows at night), cornice, roof deck with parapet, mast. o.door: rotation of the door.
 */
export function roundTower(c, x, y, z, r, h, o = {}) {
  const b = c.b, segs = c.near ? 40 : c.mid ? 24 : 12;
  const band0 = o.band0 ?? h * 0.6, band1 = o.band1 ?? h * 0.86;
  b.push(); b.translate(x, y, z);
  if (c.far) {
    b.lathe('panel_white', [[r, 0], [r, h]], segs, { capTop: true });
    b.lathe(o.lit !== false ? 'mega_window_lit' : 'mega_window', [[r + 0.05, band0], [r + 0.05, band1]], segs, {});
    if (o.band2) b.lathe(o.lit !== false ? 'mega_window_lit' : 'mega_window', [[r + 0.05, o.band2[0]], [r + 0.05, o.band2[1]]], segs, {});
    if (o.mast !== false && (o.mastH ?? 6) > 8) b.box('steel', -0.25, h, -0.25, 0.25, h + (o.mastH ?? 6), 0.25, PX | NX | PZ | NZ);
    if (o.beacon) { b.cylinder(o.beacon, -r * 0.3, h + 0.3, 0, 0.6, 1.6, 6, { top: true }); c.lights.push({ x, y: y + h + 1.5, z, kind: o.beacon }); }
    b.pop(); b.push(); b.translate(x, y, z); b.colBox(-r, 0, -r, r, h, r); b.pop();
    return;
  }
  b.lathe('concrete', [[r + 0.25, 0], [r + 0.25, 0.9], [r, 1.0]], segs, {});
  b.lathe(o.shell || 'panel_white', [[r, 1.0], [r, band0]], segs, {});
  // window band: glass ring (lit), mullions
  const lit = o.lit !== false;
  b.lathe(lit ? 'mega_window_lit' : 'mega_window', [[r - 0.2, band0], [r - 0.2, band1]], segs, {});
  b.lathe(o.shell || 'panel_white', [[r - 0.2, band0], [r, band0]], segs, {});
  b.lathe(o.shell || 'panel_white', [[r, band1], [r - 0.2, band1]], segs, {});
  if (c.near) {
    const nm = Math.max(12, Math.round((TAU * r) / (o.mullion ?? 1.8))), mw = (o.mullionW ?? 0.1) / 2;
    for (let i = 0; i < nm; i++) {
      const a = ((i + (o.mullionPhase || 0)) / nm) * TAU;
      b.push(); b.rotY(a); b.box('aluminium', -mw, band0, r - 0.26, mw, band1, r - 0.08, ALL); b.pop();
    }
    // sill and head bands
    b.lathe('aluminium', [[r + 0.05, band0 - 0.05], [r + 0.05, band0 + 0.06], [r - 0.2, band0 + 0.06]], segs, {});
  }
  if (o.band2) {
    // second glazed storey (radar / lantern room near the top): white drum - glass ring - white drum
    const [c0, c1] = o.band2;
    b.lathe(o.shell || 'panel_white', [[r, band1], [r, c0]], segs, {});
    b.lathe(lit ? 'mega_window_lit' : 'mega_window', [[r - 0.2, c0], [r - 0.2, c1]], segs, {});
    b.lathe(o.shell || 'panel_white', [[r - 0.2, c0], [r, c0]], segs, {});
    b.lathe(o.shell || 'panel_white', [[r, c1], [r - 0.2, c1]], segs, {});
    if (c.near) {
      const nm = Math.max(12, Math.round((TAU * r) / 1.8));
      for (let i = 0; i < nm; i++) { const a = (i / nm) * TAU; b.push(); b.rotY(a); b.box('aluminium', -0.05, c0, r - 0.26, 0.05, c1, r - 0.08, ALL); b.pop(); }
    }
    // dark shadow line under a thin projecting sun-shade ring (reads as a storey line from afar)
    b.lathe('panel_white', [[r, c1 + 0.05], [r + 0.9, c1 + 0.2], [r + 0.9, c1 + 0.55], [r, c1 + 0.6]], segs, {});
    b.lathe(o.shell || 'panel_white', [[r, c1 + 0.6], [r, h - 0.6]], segs, {});
  } else b.lathe(o.shell || 'panel_white', [[r, band1], [r, h - 0.6]], segs, {});
  if (o.ring !== false && !c.far) {
    // projecting sun-shade ring above the main window band
    b.lathe('panel_white', [[r, band1 + 0.05], [r + 0.8, band1 + 0.2], [r + 0.8, band1 + 0.5], [r, band1 + 0.55]], segs, {});
  }
  // cornice + roof slab
  b.lathe('panel_white', [[r, h - 0.6], [r + 0.6, h - 0.45], [r + 0.6, h], [r - 0.3, h], [r - 0.3, h + 0.9], [r - 0.55, h + 0.9], [r - 0.55, h + 0.25]], segs, { smoothAngle: 10 });
  b.lathe('roof_membrane', [[r - 0.55, h + 0.25], [0.0, h + 0.3]], segs, {});
  // door
  if (o.door !== undefined) {
    b.push(); b.rotY(o.door);
    b.box('steel_door', -0.8, 1.0, r - 0.12, 0.8, 3.4, r + 0.05, PZ);
    b.cbox('panel_white', -1.2, 3.4, r - 0.1, 1.2, 3.7, r + 0.9, 0.03);
    if (c.near) { b.box('light_warm', -0.3, 3.38, r + 0.3, 0.3, 3.4, r + 0.5, NY); b.cbox('concrete', -1.2, 0, r, 1.2, 1.0, r + 1.6, 0.03, false); }
    b.pop();
  }
  // mast, antennas, beacon
  if (o.mast !== false) {
    if (c.near) antennaMast(b, r * 0.3, h + 0.3, 0, o.mastH ?? 6, (c.seed ^ (x * 7)) | 0);
    else { b.box('steel', r * 0.3 - 0.12, h + 0.3, -0.12, r * 0.3 + 0.12, h + 0.3 + (o.mastH ?? 6), 0.12, PX | NX | PZ | NZ); }
    if (o.radar) {
      // radar scanner on a short lattice post (harbour control)
      b.box('steel', -0.3, h + 0.3, -0.3, 0.3, h + 3.2, 0.3, PX | NX | PZ | NZ);
      b.cbox('panel_white', -0.6, h + 3.2, -0.6, 0.6, h + 3.7, 0.6, 0.03);
      b.cbox('panel_white', -3.2, h + 3.75, -0.22, 3.2, h + 4.25, 0.22, 0.04);
    }
    if (o.beacon) { b.cylinder(o.beacon, -r * 0.3, h + 0.3, 0, 0.45, 1.4, 12, { top: true }); c.lights.push({ x, y: y + h + 1.5, z, kind: o.beacon }); }
  }
  if (c.near) {
    // roof railing ring + hvac
    const ring = []; for (let i = 0; i <= 32; i++) { const a = (i / 32) * TAU; ring.push([Math.sin(a) * (r - 0.75), h + 0.3, Math.cos(a) * (r - 0.75)]); }
    railing(c, ring, { key: 'aluminium', h: 1.0, toe: false, col: false });
    hvacUnit(b, -r * 0.35, h + 0.3, r * 0.25, 0.4, { w: 2.0, d: 1.0, h: 1.0 });
  }
  b.pop();
  b.push(); b.translate(x, y, z);
  if (o.hollow) {
    // walkable drum: ring of wall boxes + ground floor + roof (floors inside are added by the interior)
    const n = 18, hw = r * Math.sin(Math.PI / n) * 1.08;
    for (let i = 0; i < n; i++) { b.push(); b.rotY(((i + 0.5) / n) * TAU); b.colBox(-hw, 0, r - 0.45, hw, h + 0.9, r + 0.05); b.pop(); }
    b.colPolyY(ringXZ(r - 0.2, n), [], 1.0);
    b.colPolyY(ringXZ(r + 0.6, n), [], h + 0.3);
  } else {
    // collider: octagonal-ish column of boxes
    b.colBox(-r * 0.92, 0, -r * 0.38, r * 0.92, h + 0.9, r * 0.38); b.colBox(-r * 0.38, 0, -r * 0.92, r * 0.38, h + 0.9, r * 0.92);
    b.colBox(-r * 0.7, 0, -r * 0.7, r * 0.7, h + 0.9, r * 0.7);
  }
  b.pop();
}
/** closed ring polygon [[x, z]...] of radius r */
export function ringXZ(r, n) { const out = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([Math.cos(a) * r, Math.sin(a) * r]); } return out; }

/**
 * Night light pool on the deck under a lamp (additive, night-gated emissive disc, reads as the row
 * of lamp lights from the air at night). (x, y, z) = ground point under the lamp head, radius rr.
 */
export function lightPool(c, x, y, z, rr = 7, cool = false) {
  c.b.quad(cool ? 'mega_lightpool_cool' : 'mega_lightpool', x - rr, y, z + rr, x + rr, y, z + rr, x + rr, y, z - rr, x - rr, y, z - rr, [-1, -1, 1, -1, 1, 1, -1, 1]);
}

/**
 * Rectangular service building (white panels), x0..x1, z0..z1, from y0 to y0+h, window strip on
 * the faces listed in o.windows ('px'|'nx'|'pz'|'nz'), door on o.door face.
 */
export function serviceBlock(c, x0, z0, x1, z1, y0, h, o = {}) {
  const b = c.b, shell = o.shell || 'panel_white';
  const w0 = y0 + (o.win0 ?? h * 0.45), w1 = y0 + (o.win1 ?? h * 0.8);
  const wins = o.windows || ['pz'];
  if (c.far) { b.box(shell, x0, y0, z0, x1, y0 + h, z1, ALL & ~NY); b.colBox(x0, y0, z0, x1, y0 + h, z1); return; }
  b.cbox('concrete', x0 - 0.15, y0 - 0.5, z0 - 0.15, x1 + 0.15, y0 + 0.3, z1 + 0.15, 0.03, false);
  // walls: solid below/above the window band, glass band recessed 0.15
  const faces = { px: [x1, 1, 'x'], nx: [x0, -1, 'x'], pz: [z1, 1, 'z'], nz: [z0, -1, 'z'] };
  for (const [name, [pl, s, ax]] of Object.entries(faces)) {
    const hasWin = wins.includes(name);
    const glassKey = o.lit === false ? 'mega_window' : 'mega_window_lit';
    if (ax === 'z') {
      if (!hasWin) b.rectZ(shell, x0, y0 + 0.3, x1, y0 + h, pl, s);
      else {
        b.rectZ(shell, x0, y0 + 0.3, x1, w0, pl, s); b.rectZ(shell, x0, w1, x1, y0 + h, pl, s);
        b.rectZ(glassKey, x0 + 0.3, w0, x1 - 0.3, w1, pl - s * 0.15, s);
        b.rectZ(shell, x0, w0, x0 + 0.3, w1, pl, s); b.rectZ(shell, x1 - 0.3, w0, x1, w1, pl, s);
        b.rectY(shell, x0 + 0.3, Math.min(pl, pl - s * 0.15), x1 - 0.3, Math.max(pl, pl - s * 0.15), w0, 1);
        if (c.near) for (let xm = x0 + 0.3 + 1.5; xm < x1 - 0.5; xm += 1.5) b.box('aluminium', xm - 0.04, w0, Math.min(pl, pl - s * 0.15), xm + 0.04, w1, Math.max(pl, pl - s * 0.15) + s * 0.02, ALL);
      }
    } else {
      if (!hasWin) b.rectX(shell, z0, y0 + 0.3, z1, y0 + h, pl, s);
      else {
        b.rectX(shell, z0, y0 + 0.3, z1, w0, pl, s); b.rectX(shell, z0, w1, z1, y0 + h, pl, s);
        b.rectX(glassKey, z0 + 0.3, w0, z1 - 0.3, w1, pl - s * 0.15, s);
        b.rectX(shell, z0, w0, z0 + 0.3, w1, pl, s); b.rectX(shell, z1 - 0.3, w0, z1, w1, pl, s);
        b.rectY(shell, Math.min(pl, pl - s * 0.15), z0 + 0.3, Math.max(pl, pl - s * 0.15), z1 - 0.3, w0, 1);
        if (c.near) for (let zm = z0 + 0.3 + 1.5; zm < z1 - 0.5; zm += 1.5) b.box('aluminium', Math.min(pl, pl - s * 0.15), w0, zm - 0.04, Math.max(pl, pl - s * 0.15) + s * 0.02, w1, zm + 0.04, ALL);
      }
    }
  }
  // roof: parapet + membrane
  b.box('panel_white', x0, y0 + h, z0, x1, y0 + h + 0.7, z0 + 0.25, ALL & ~NY); b.box('panel_white', x0, y0 + h, z1 - 0.25, x1, y0 + h + 0.7, z1, ALL & ~NY);
  b.box('panel_white', x0, y0 + h, z0 + 0.25, x0 + 0.25, y0 + h + 0.7, z1 - 0.25, ALL & ~NY); b.box('panel_white', x1 - 0.25, y0 + h, z0 + 0.25, x1, y0 + h + 0.7, z1 - 0.25, ALL & ~NY);
  b.rectY('roof_membrane', x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, y0 + h + 0.05, 1);
  if (c.near) {
    if (x1 - x0 > 5 && z1 - z0 > 4) hvacUnit(b, (x0 + x1) / 2, y0 + h + 0.05, (z0 + z1) / 2, 0, { w: 2.2, d: 1.1, h: 1.1 });
    if (o.door) {
      const d = o.door, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (d === 'pz' || d === 'nz') { const zz = d === 'pz' ? z1 : z0, s = d === 'pz' ? 1 : -1; b.rectZ('steel_door', cx - 0.9, y0 + 0.3, cx + 0.9, y0 + 2.6, zz + s * 0.01, s); b.box('light_warm', cx - 0.2, y0 + 2.75, zz + s * 0.01, cx + 0.2, y0 + 2.85, zz + s * 0.12, ALL); }
      else { const xx = d === 'px' ? x1 : x0, s = d === 'px' ? 1 : -1; b.rectX('steel_door', cz - 0.9, y0 + 0.3, cz + 0.9, y0 + 2.6, xx + s * 0.01, s); b.box('light_warm', xx + Math.min(0, s * 0.12), y0 + 2.75, cz - 0.2, xx + Math.max(0, s * 0.12), y0 + 2.85, cz + 0.2, ALL); }
    }
  }
  b.colBox(x0, y0, z0, x1, y0 + h + 0.7, z1);
}

/** planter with shrubs (roof gardens on the heads, as in the G01 reference) */
export function planter(c, x0, z0, x1, z1, y, seed) {
  const b = c.b;
  b.box('mega_concrete', x0, y, z0, x1, y + 0.6, z0 + 0.2, ALL & ~NY); b.box('mega_concrete', x0, y, z1 - 0.2, x1, y + 0.6, z1, ALL & ~NY);
  b.box('mega_concrete', x0, y, z0 + 0.2, x0 + 0.2, y + 0.6, z1 - 0.2, ALL & ~NY); b.box('mega_concrete', x1 - 0.2, y, z0 + 0.2, x1, y + 0.6, z1 - 0.2, ALL & ~NY);
  b.rectY('soil', x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, y + 0.5, 1);
  const r = new Rng(seed >>> 0);
  if (!c.near) { b.withTint([0.35, 0.5, 0.25], () => b.box('plant', x0 + 0.3, y + 0.5, z0 + 0.3, x1 - 0.3, y + 1.3, z1 - 0.3, ALL & ~NY)); return; }
  const n = Math.max(2, Math.round(((x1 - x0) * (z1 - z0)) / 2.2));
  for (let i = 0; i < n; i++) shrub(b, lerp(x0 + 0.6, x1 - 0.6, r.next()), y + 0.5, lerp(z0 + 0.6, z1 - 0.6, r.next()), 0.7 + r.next() * 0.7, (seed + i * 13) >>> 0);
}

/** navigation buoy floating at (x, 0, z): kind 'red' (port, can topmark) | 'green' (starboard, cone) */
export function buoy(c, x, z, kind, seed = 0) {
  const b = c.b, paint = kind === 'red' ? 'mega_paint_red' : 'mega_paint_green', lamp = kind === 'red' ? 'light_red' : 'mega_light_green';
  b.push(); b.translate(x, 0, z);
  b.lathe(paint, [[0.0, -1.1], [0.9, -1.0], [1.25, -0.4], [1.3, 0.5], [1.15, 0.7], [0.0, 0.72]], c.near ? 18 : 10, { smoothAngle: 40 });
  if (c.near) {
    b.lathe('rubber', [[1.32, -0.05], [1.42, 0.05], [1.42, 0.25], [1.32, 0.35]], 18, {});
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; b.tube(paint, [[Math.sin(a) * 0.9, 0.7, Math.cos(a) * 0.9], [Math.sin(a) * 0.3, 3.4, Math.cos(a) * 0.3]], 0.06, 6); }
    for (const yy of [1.6, 2.6]) b.lathe(paint, [[0.62 - (yy - 1.6) * 0.25, yy], [0.62 - (yy - 1.6) * 0.25, yy + 0.08]], 12, {});
    b.cylinder(paint, 0, 3.4, 0, 0.36, 0.12, 12, { top: true });
    if (kind === 'red') b.cylinder(paint, 0, 3.6, 0, 0.32, 0.65, 12, { top: true });
    else b.lathe(paint, [[0.38, 3.6], [0.0, 4.25]], 12, { capBottom: true });
    b.cylinder(lamp, 0, 4.3, 0, 0.11, 0.24, 10, { top: true });
    b.box('aluminium', -0.25, 2.0, -0.02, 0.25, 2.5, 0.02, ALL); b.box('aluminium', -0.02, 2.0, -0.25, 0.02, 2.5, 0.25, ALL);
  } else {
    b.lathe(paint, [[0.5, 0.7], [0.3, 3.6]], 8, {});
    b.cylinder(lamp, 0, 3.6, 0, 0.25, 0.6, 8, { top: true });
  }
  b.pop();
  c.lights.push({ x, y: 4.4, z, kind: lamp });
  b.push(); b.translate(x, 0, z); b.colBox(-1.3, -1, -1.3, 1.3, 4.4, 1.3); b.pop();
}

/** simple gantry crane on rails along local X: span along Z from z0 to z1 at rail height y, at position x */
export function gantryCrane(c, x, y, z0, z1, h, o = {}) {
  const b = c.b, key = o.key || 'steel_yellow';
  for (const zz of [z0, z1]) {
    b.box(key, x - 3, y, zz - 0.5, x + 3, y + 1.2, zz + 0.5, ALL);           // bogie
    for (const s of [-1, 1]) b.box(key, x + s * 2.4 - 0.35, y + 1.2, zz - 0.35, x + s * 2.4 + 0.35, y + h, zz + 0.35, ALL);
    if (c.near) b.tube(key, [[x - 2.4, y + 1.6, zz], [x + 2.4, y + h - 0.6, zz]], 0.1, 6);
  }
  b.cbox(key, x - 2.9, y + h, z0 - 0.8, x + 2.9, y + h + 2.2, z1 + 0.8, 0.05);
  b.cbox(key, x - 1.6, y + h + 2.2, (z0 + z1) / 2 - 2.0, x + 1.6, y + h + 4.2, (z0 + z1) / 2 + 2.0, 0.05);      // trolley + hoist house
  if (c.near) {
    b.cbox('panel_white', x - 1.2, y + h - 2.4, z0 + 0.5, x + 1.2, y + h, z0 + 2.6, 0.03);                        // cab
    b.rectZ('mega_window_lit', x - 1.0, y + h - 1.9, x + 1.0, y + h - 0.6, z0 + 2.61, 1);
    for (const s of [-1, 1]) b.tube('steel_dark', [[x + s * 0.4, y + h, (z0 + z1) / 2], [x + s * 0.4, y + h - (o.hookDrop ?? 6), (z0 + z1) / 2]], 0.03, 5);
    b.cbox('steel_yellow', x - 0.6, y + h - (o.hookDrop ?? 6) - 1.0, (z0 + z1) / 2 - 0.4, x + 0.6, y + h - (o.hookDrop ?? 6), (z0 + z1) / 2 + 0.4, 0.04);
  }
  b.colBox(x - 3, y, Math.min(z0, z1) - 0.8, x + 3, y + h + 4.2, Math.max(z0, z1) + 0.8);
}

/** crane rail pair along local X at deck height y (rails at z0 and z1): steel rail on a sole plate */
export function craneRails(c, x0, x1, y, zs) {
  const b = c.b;
  for (const z of zs) {
    if (c.near) {
      b.box('steel_dark', x0, y, z - 0.35, x1, y + 0.03, z + 0.35, PY | PZ | NZ);
      b.box('steel_brushed', x0, y + 0.03, z - 0.04, x1, y + 0.2, z + 0.04, PY | PZ | NZ);
      b.box('steel', x0, y + 0.03, z - 0.09, x1, y + 0.06, z + 0.09, PY | PZ | NZ);
    } else b.box('steel_dark', x0, y, z - 0.35, x1, y + 0.08, z + 0.35, PY | PZ | NZ);
  }
}

/** steps (stair flight) along local X from (x0, y0) rising to y1, width along Z z0..z1 */
export function stairFlight(c, x0, y0, y1, z0, z1, o = {}) {
  const b = c.b, rise = y1 - y0, n = Math.max(1, Math.ceil(Math.abs(rise) / 0.18)), hh = rise / n, run = o.run ?? 0.28, dir = o.dir ?? 1;
  for (let i = 0; i < n; i++) {
    const xa = x0 + dir * i * run, xb = xa + dir * run;
    b.box(o.key || 'mega_concrete', Math.min(xa, xb), y0 + i * hh - (i ? hh : 0.3), z0, Math.max(xa, xb), y0 + (i + 1) * hh, z1, ALL & ~NY);
  }
  if (c.near && o.rails !== false) {
    const xe = x0 + dir * n * run;
    railing(c, [[x0, y0, z0 + 0.06], [xe, y1, z0 + 0.06]], { key: o.railKey || 'steel_yellow', h: 0.95, toe: false, col: false });
    railing(c, [[x0, y0, z1 - 0.06], [xe, y1, z1 - 0.06]], { key: o.railKey || 'steel_yellow', h: 0.95, toe: false, col: false });
  }
  // ramp collider
  const xe = x0 + dir * n * run;
  b.colQuad(x0, y0, z0, xe, y1, z0, xe, y1, z1, x0, y0, z1);
  return xe;
}

/** life-buoy stand (near only) */
export function lifeBuoy(c, x, y, z, rot = 0) {
  if (!c.near) return;
  const b = c.b; b.push(); b.translate(x, y, z); b.rotY(rot);
  b.box('steel', -0.04, 0, -0.04, 0.04, 1.5, 0.04, ALL & ~NY);
  b.box('steel_dark', -0.35, 0.9, 0.04, 0.35, 1.6, 0.08, ALL);
  b.push(); b.translate(0, 1.25, 0.16); b.rotX(Math.PI / 2);
  b.lathe('mega_paint_red', [[0.18, -0.05], [0.28, -0.05], [0.3, 0], [0.28, 0.05], [0.18, 0.05], [0.16, 0]], 16, { smoothAngle: 60 });
  b.pop(); b.pop();
}

/**
 * Multi-storey white head house (堤头闸房楼) on a segment head: x0..x1, z0..z1 from y0, `storeys` storeys of
 * height sh with recessed ribbon windows (lit at night), the top storey fully glazed under a deep cornice,
 * parapet, roof planting, stair / lift core and plant. Far LOD: block + glass bands (silhouette).
 * o.blank: faces without windows ('px'|'nx'|'pz'|'nz'); o.door: face of the entrance.
 */
export function headHouse(c, x0, z0, x1, z1, y0, storeys = 3, o = {}) {
  const b = c.b, sh = o.sh ?? 3.8, H = storeys * sh, blank = o.blank || [];
  const glass = o.lit === false ? 'mega_window' : 'mega_window_lit';
  b.colBox(x0, y0, z0, x1, y0 + H + 1.0, z1);
  if (c.far) {
    b.box('panel_white', x0, y0, z0, x1, y0 + H, z1, ALL & ~NY);
    for (let s = 0; s < storeys; s++) {
      const ya = y0 + s * sh + (s === storeys - 1 ? 0.5 : 1.0), yb = y0 + (s + 1) * sh - (s === storeys - 1 ? 0.3 : 1.2);
      if (!blank.includes('pz')) b.rectZ(glass, x0 + 1, ya, x1 - 1, yb, z1 + 0.05, 1);
      if (!blank.includes('nz')) b.rectZ(glass, x0 + 1, ya, x1 - 1, yb, z0 - 0.05, -1);
      if (!blank.includes('px')) b.rectX(glass, z0 + 1, ya, z1 - 1, yb, x1 + 0.05, 1);
      if (!blank.includes('nx')) b.rectX(glass, z0 + 1, ya, z1 - 1, yb, x0 - 0.05, -1);
    }
    return;
  }
  b.cbox('concrete', x0 - 0.2, y0 - 0.4, z0 - 0.2, x1 + 0.2, y0 + 0.35, z1 + 0.2, 0.03, false);
  const faces = [['pz', z1, 1, 'z'], ['nz', z0, -1, 'z'], ['px', x1, 1, 'x'], ['nx', x0, -1, 'x']];
  for (let s = 0; s < storeys; s++) {
    const top = s === storeys - 1;
    const ya = y0 + s * sh, yb = ya + sh;
    const w0 = ya + (top ? 0.45 : 1.0), w1 = yb - (top ? 0.25 : 0.9);
    for (const [name, pl, sg, ax] of faces) {
      const win = !blank.includes(name);
      const A0 = ax === 'z' ? x0 : z0, A1 = ax === 'z' ? x1 : z1;
      const R = (k, a0, ya0, a1, ya1, p, f) => (ax === 'z' ? b.rectZ(k, a0, ya0, a1, ya1, p, f) : b.rectX(k, a0, ya0, a1, ya1, p, f));
      if (!win) { R('panel_white', A0, ya + (s ? 0 : 0.35), A1, yb, pl, sg); continue; }
      const inset = top ? 0.35 : 0.2, pr = pl - sg * inset;
      R('panel_white', A0, ya + (s ? 0 : 0.35), A1, w0, pl, sg); R('panel_white', A0, w1, A1, yb, pl, sg);
      R('panel_white', A0, w0, A0 + 0.6, w1, pl, sg); R('panel_white', A1 - 0.6, w0, A1, w1, pl, sg);
      R(glass, A0 + 0.6, w0, A1 - 0.6, w1, pr, sg);
      // reveals (sill / head / jambs) so the band reads as a real opening
      if (ax === 'z') {
        b.rectY('panel_white', A0 + 0.6, Math.min(pl, pr), A1 - 0.6, Math.max(pl, pr), w0, 1);
        b.rectY('panel_white', A0 + 0.6, Math.min(pl, pr), A1 - 0.6, Math.max(pl, pr), w1, -1);
      } else {
        b.rectY('panel_white', Math.min(pl, pr), A0 + 0.6, Math.max(pl, pr), A1 - 0.6, w0, 1);
        b.rectY('panel_white', Math.min(pl, pr), A0 + 0.6, Math.max(pl, pr), A1 - 0.6, w1, -1);
      }
      if (c.near) {
        const step = top ? 1.6 : 1.35;
        for (let a = A0 + 0.6 + step; a < A1 - 0.8; a += step) {
          if (ax === 'z') b.box('aluminium', a - 0.04, w0, Math.min(pl, pr) - 0.01, a + 0.04, w1, Math.max(pl, pr) - (sg > 0 ? 0.02 : -0.02), ALL);
          else b.box('aluminium', Math.min(pl, pr) - 0.01, w0, a - 0.04, Math.max(pl, pr) - (sg > 0 ? 0.02 : -0.02), w1, a + 0.04, ALL);
        }
      }
    }
    // storey line: thin projecting slab edge (shadow line) on every face
    if (s > 0) {
      const ys = ya;
      b.box('panel_white', x0 - 0.25, ys - 0.12, z0 - 0.25, x1 + 0.25, ys + 0.12, z1 + 0.25, ALL);
    }
  }
  // deep cornice over the glazed top storey + parapet
  const yt = y0 + H;
  b.box('panel_white', x0 - 0.9, yt - 0.05, z0 - 0.9, x1 + 0.9, yt + 0.55, z1 + 0.9, ALL);
  b.box('panel_white', x0 - 0.9, yt + 0.55, z0 - 0.9, x1 + 0.9, yt + 1.25, z0 - 0.6, ALL & ~NY);
  b.box('panel_white', x0 - 0.9, yt + 0.55, z1 + 0.6, x1 + 0.9, yt + 1.25, z1 + 0.9, ALL & ~NY);
  b.box('panel_white', x0 - 0.9, yt + 0.55, z0 - 0.6, x0 - 0.6, yt + 1.25, z1 + 0.6, ALL & ~NY);
  b.box('panel_white', x1 + 0.6, yt + 0.55, z0 - 0.6, x1 + 0.9, yt + 1.25, z1 + 0.6, ALL & ~NY);
  b.rectY('roof_membrane', x0 - 0.6, z0 - 0.6, x1 + 0.6, z1 + 0.6, yt + 0.6, 1);
  // stair / lift core + plant on the roof, roof garden on the rest
  const cx = o.coreX ?? (x0 + 3.2), cz = (z0 + z1) / 2;
  b.cbox('panel_white', cx - 2.6, yt + 0.6, cz - 3.2, cx + 2.6, yt + 4.0, cz + 3.2, 0.04, false);
  b.colBox(cx - 2.6, yt + 0.6, cz - 3.2, cx + 2.6, yt + 4.0, cz + 3.2);
  if (c.near) {
    b.rectX('steel_door', cz - 0.5, yt + 0.6, cz + 0.5, yt + 2.7, cx + 2.61, 1);
    hvacUnit(b, (x0 + x1) / 2, yt + 0.6, z0 + 2.2, 0, { w: 2.4, d: 1.2, h: 1.2 });
    const ring = [[x0 - 0.3, yt + 1.25, z0 - 0.3], [x1 + 0.3, yt + 1.25, z0 - 0.3], [x1 + 0.3, yt + 1.25, z1 + 0.3], [x0 - 0.3, yt + 1.25, z1 + 0.3], [x0 - 0.3, yt + 1.25, z0 - 0.3]];
    railing(c, ring, { key: 'aluminium', h: 0.9, toe: false, col: false });
  }
  // roof garden on the side away from the core
  const pa = cx - x0 < x1 - cx ? [cx + 4, x1 - 2] : [x0 + 2, cx - 4];
  if (pa[1] - pa[0] > 5 && z1 - z0 > 10) planter(c, pa[0], z0 + 4.2, pa[1], z1 - 2, yt + 0.6, (c.seed + Math.round(x0 * 7 + z0 * 3)) >>> 0);
  if (o.door && c.near) {
    const d = o.door;
    if (d === 'nz' || d === 'pz') { const zz = d === 'pz' ? z1 : z0, sg = d === 'pz' ? 1 : -1, xm = (x0 + x1) / 2; b.rectZ('steel_door', xm - 1.2, y0 + 0.35, xm + 1.2, y0 + 2.8, zz + sg * 0.01, sg); b.cbox('panel_white', xm - 2.0, y0 + 2.9, Math.min(zz, zz + sg * 1.4), xm + 2.0, y0 + 3.15, Math.max(zz, zz + sg * 1.4), 0.03); }
    else { const xx = d === 'px' ? x1 : x0, sg = d === 'px' ? 1 : -1, zm = (z0 + z1) / 2; b.rectX('steel_door', zm - 1.2, y0 + 0.35, zm + 1.2, y0 + 2.8, xx + sg * 0.01, sg); }
  }
}

/**
 * Navigation light tower (导航灯塔) on a mouth head at (x, y, z): tapering white concrete shaft with coloured
 * bands (red: port / west head, green: starboard / east head), gallery with railing, lantern with an
 * always-on light, small service door. h = height of the lantern floor above y.
 */
export function lightTower(c, x, y, z, h, kind, o = {}) {
  const b = c.b, r0 = o.r0 ?? 2.8, r1 = o.r1 ?? 1.9, segs = c.near ? 24 : c.mid ? 14 : 8;
  const paint = kind === 'red' ? 'mega_paint_red' : 'mega_paint_green', lamp = kind === 'red' ? 'light_red' : 'mega_light_green';
  const rAt = (t) => r0 + (r1 - r0) * t;
  b.push(); b.translate(x, y, z);
  // shaft: white with two broad colour bands (day mark)
  const bands = [[0, 0.18, 'panel_white'], [0.18, 0.36, paint], [0.36, 0.6, 'panel_white'], [0.6, 0.78, paint], [0.78, 1, 'panel_white']];
  for (const [t0, t1, key] of bands) b.lathe(key, [[rAt(t0), t0 * h], [rAt(t1), t1 * h]], segs, {});
  b.lathe('concrete', [[r0 + 0.6, 0], [r0 + 0.6, 0.8], [r0, 0.9]], segs, {});
  // gallery slab + railing, lantern room, dome
  b.lathe('panel_white', [[r1 + 1.2, h], [r1 + 1.2, h + 0.35], [0, h + 0.36]], segs, { capBottom: true });
  // lantern: clear glazing (the lamp shows through), a few astragals, light inside
  b.lathe(c.far ? lamp : 'glass_railing', [[r1 * 0.72, h + 0.35], [r1 * 0.72, h + 2.6]], segs, {});
  b.cylinder(lamp, 0, h + 0.7, 0, r1 * 0.5, 1.5, segs, { top: true });
  if (!c.far) for (let k = 0; k < 6; k++) { b.push(); b.rotY((k / 6) * TAU); b.box('steel_dark', -0.04, h + 0.35, r1 * 0.72 - 0.04, 0.04, h + 2.6, r1 * 0.72 + 0.04, ALL); b.pop(); }
  b.lathe(paint, [[r1 * 0.85, h + 2.6], [r1 * 0.45, h + 3.3], [0.0, h + 3.5]], segs, { capBottom: true });
  b.box('steel', -0.04, h + 3.5, -0.04, 0.04, h + 5.2, 0.04, PX | NX | PZ | NZ);
  if (!c.far) {
    const ring = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * TAU; ring.push([Math.sin(a) * (r1 + 1.1), h + 0.35, Math.cos(a) * (r1 + 1.1)]); }
    railing(c, ring, { key: 'steel', h: 1.0, toe: false, col: false });
    if (o.door !== undefined) { b.push(); b.rotY(o.door); b.box('steel_door', -0.5, 0.9, r0 - 0.1, 0.5, 3.0, r0 + 0.08, PZ); b.pop(); }
    if (c.near) for (const yy of [0.3, 0.55, 0.8]) { b.push(); b.rotY((o.door || 0) + Math.PI); b.box('mega_window', -0.3, yy * h, rAt(yy) - 0.05, 0.3, yy * h + 1.0, rAt(yy) + 0.04, PZ); b.pop(); }
  }
  b.pop();
  c.lights.push({ x, y: y + h + 1.4, z, kind: lamp });
  b.push(); b.translate(x, y, z); b.colBox(-r0, 0, -r0, r0, h + 3.5, r0); b.pop();
}

/**
 * Portal gantry (闸首门机) spanning a lock chamber along local X from x0 to x1 at z, legs standing on the
 * chamber walls at deck height y, girder underside at y + h. Box-girder beam with a hoist trolley house,
 * braced legs, access ladder; lit cab. Far LOD: legs + girder boxes.
 */
export function portalGantry(c, x0, x1, z, y, h, o = {}) {
  const b = c.b, key = o.key || 'panel_white', gd = o.girder ?? 3.6, lw = 2.4, sp = o.spread ?? 7;
  for (const xl of [x0, x1]) {
    for (const s of [-1, 1]) b.box(key, xl - lw / 2, y, z + s * sp - lw / 2, xl + lw / 2, y + h, z + s * sp + lw / 2, ALL & ~NY);
    // bogie on the wall rails
    b.box('steel_dark', xl - 2.2, y, z - sp - 2.2, xl + 2.2, y + 1.6, z + sp + 2.2, ALL & ~NY);
    b.colBox(xl - 2.2, y, z - sp - 2.2, xl + 2.2, y + h + gd, z + sp + 2.2);
    if (!c.far) {
      // cross bracing between the leg pair
      b.tube(key, [[xl, y + 2, z - sp], [xl, y + h - 1, z + sp]], 0.28, c.near ? 8 : 5);
      b.tube(key, [[xl, y + 2, z + sp], [xl, y + h - 1, z - sp]], 0.28, c.near ? 8 : 5);
      b.box(key, xl - 0.5, y + h * 0.5 - 0.4, z - sp, xl + 0.5, y + h * 0.5 + 0.4, z + sp, ALL);
      if (c.near) ladder(c, xl + lw / 2 + 0.01, y + 1.6, z - sp, h - 1.6, Math.PI / 2, { key: 'steel_yellow', hoop: true });
    }
  }
  // twin box girders + end ties
  for (const s of [-1, 1]) c.b.box(key, x0 - 2, y + h, z + s * sp - 1.3, x1 + 2, y + h + gd, z + s * sp + 1.3, ALL);
  b.box(key, x0 - 2, y + h + gd - 0.6, z - sp, x0 + 2, y + h + gd, z + sp, PY | NY | PX | NX);
  b.box(key, x1 - 2, y + h + gd - 0.6, z - sp, x1 + 2, y + h + gd, z + sp, PY | NY | PX | NX);
  // hoist trolley + machinery house (yellow) on the girders, parked over the gate
  const xt = o.trolley ?? (x0 + (x1 - x0) * 0.62);
  b.cbox('steel_yellow', xt - 5, y + h + gd, z - sp - 1.3, xt + 5, y + h + gd + 3.4, z + sp + 1.3, 0.05);
  if (!c.far) {
    b.cbox('panel_white', x0 + 2.5, y + h - 3.2, z - sp - 1.3, x0 + 7, y + h, z - sp + 2.2, 0.04);
    b.rectZ('mega_window_lit', x0 + 2.8, y + h - 2.7, x0 + 6.7, y + h - 0.8, z - sp - 1.31, -1);
    if (c.near) {
      railing(c, [[x0 - 2, y + h + gd, z - sp - 1.2], [x1 + 2, y + h + gd, z - sp - 1.2]], { key: 'steel_yellow', h: 1.0, toe: false, col: false });
      railing(c, [[x0 - 2, y + h + gd, z + sp + 1.2], [x1 + 2, y + h + gd, z + sp + 1.2]], { key: 'steel_yellow', h: 1.0, toe: false, col: false });
      for (const s of [-1, 1]) b.box('steel_dark', xt - 0.04 + s * 2, y + 2, z - 0.04, xt + 0.04 + s * 2, y + h + gd, z + 0.04, PX | NX | PZ | NZ);
    }
    // obstruction lights on the girder ends
    b.cylinder('light_red', x0, y + h + gd, z, 0.25, 0.5, 8, { top: true });
    b.cylinder('light_red', x1, y + h + gd, z, 0.25, 0.5, 8, { top: true });
  }
  c.lights.push({ x: (x0 + x1) / 2, y: y + h + gd, z, kind: 'light_red' });
}
