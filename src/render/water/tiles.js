// Per-tile water surface geometry (main thread, float64 maths). OWNER: water agent.
//
// One water mesh per displayed terrain tile that carries `tile.water` (ARCHITECTURE.md §8 "Tile water
// data"): the same 65×65 vertex grid as the terrain tile, every vertex at its water level, positions
// relative to tile.centerEcef (sea-level centre, like the terrain mesh). Only quads whose four vertices
// carry a water level (water vertices + the 3-vertex shoreline dilation) are indexed; the terrain depth
// test cuts the true coastline and the texel-resolution wet mask (tile.water.mask) gives the coverage.
//
// Vertex attributes
//   position   water surface (rel. centre)            normal  radial up
//   aWtrGrid   (i/64, j/64)                           aWtrEdge  stitch delta of odd edge vertices
//   aWtrA      (depth m, draw 0|1, tint 0 sea..1 lake, flowMix)
//   aWtrB      (swell amp, wind amp, foam source, turbulence)
//   aWtrF      (flow u, flow v (face-plane m/s), level m, calm)
//   aWtrI      polar ice cover 0..1 (floes / brash / slush on meltwater pools and the near-ice sea); −(0..1) = G01
//              protected-basin factor (harbour tint, fix round 2; G01 is equatorial, never polar)
// draw = 0 for canal / river vertices the vertex grid cannot resolve (width < 2 vertex spacings): the
// terrain paints those into its albedo (same rule as render/terrain/tileBuilder.js canalResolved).
import { R, FACE_ARC } from '../../core/constants.js';
import { FACES, vecToFace } from '../../core/geo.js';
import { createNoise } from '../../core/noise.js';
import { hash4 } from '../../core/hash.js';
import { SITES, unitToLocal, g01ToUV, g01ShoreV, G01_GEO } from '../../world/sites.js';
import { sluiceOpen } from '../../world/sluice.js';
import { sampleFields } from '../../world/fields.js';
import { WAVE_PERIOD } from './waves.js';

export const N = 64, NV = 65, GV = NV * NV;
const QPI = Math.PI / 4;

// shared grid uv (each geometry gets its own BufferAttribute over this array)
export const GRID_UV = (() => {
  const a = new Float32Array(GV * 2);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) { const o = j * NV + i; a[o * 2] = i / N; a[o * 2 + 1] = j / N; }
  return a;
})();

const SEA_NOISE = createNoise(0x5ea);
const D = new Float64Array(GV * 3);

function faceDir(F, a, b, out, o) {
  const s = Math.tan(a * QPI), t = Math.tan(b * QPI);
  const N0 = F[0], U = F[1], V = F[2];
  const x = N0[0] + s * U[0] + t * V[0], y = N0[1] + s * U[1] + t * V[1], z = N0[2] + s * U[2] + t * V[2];
  const il = 1 / Math.sqrt(x * x + y * y + z * z);
  out[o] = x * il; out[o + 1] = y * il; out[o + 2] = z * il;
}

/** unit flow (east, north) at unit vector (ux, uy, uz) -> face-plane (u, v) components (not normalised) */
function flowToFace(U, V, ux, uy, uz, fe, fn, out) {
  let ex = uz, ez = -ux; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
  const wx = fe * ex + fn * nx, wy = fn * ny, wz = fe * ez + fn * nz;
  const du = U[0] * ux + U[1] * uy + U[2] * uz, dv = V[0] * ux + V[1] * uy + V[2] * uz;
  const tux = U[0] - ux * du, tuy = U[1] - uy * du, tuz = U[2] - uz * du; const tul = Math.hypot(tux, tuy, tuz) || 1;
  const tvx = V[0] - ux * dv, tvy = V[1] - uy * dv, tvz = V[2] - uz * dv; const tvl = Math.hypot(tvx, tvy, tvz) || 1;
  out[0] = (wx * tux + wy * tuy + wz * tuz) / tul;
  out[1] = (wx * tvx + wy * tvy + wz * tvz) / tvl;
  return out;
}
const _fu = [0, 0];

// ---------------------------------------------------------------------------------------------
// G02 spillways (foam / jets below the open bays). Two sources, identical gate states:
//   * default: SITES.waterStairs layout + a replica of megastructures/g02.js gateOpen() and of the
//     chute length (outlet ≈ toe of the ogee + 4 m), available synchronously in every thread;
//   * the megastructure system's spillways() (exact chute outlets, flows) once its layout arrived —
//     installed with setG02Spillways(list); the water system then rebuilds the G02 tiles.
// Bay offsets are measured along the dam axis a→b from its midpoint (megastructure `across`).
// ---------------------------------------------------------------------------------------------
let G02_LIVE = null;          // megastructure spillway data once installed ({key, states})
/**
 * Gate state of G02 dam `dam` (0..5), bay `bay` in the water renderer's order (bay 0 at the
 * megastructure's +X end, i.e. megastructure bay = bays − 1 − bay). Deterministic; this is THE rule:
 * megastructures/g02.js gateOpen(dam, k, bays) replicates it as spillwayGateOpen(dam, bays − 1 − k)
 * and cross-checks at runtime. Every dam keeps its two central bays discharging (泄流口白沫).
 */
export function spillwayGateOpen(dam, bay) {
  const bays = 5 + (dam % 3);
  const st = G02_LIVE?.states?.[dam];
  if (st && st.length === bays && typeof st[bays - 1 - bay] === 'boolean') return st[bays - 1 - bay];
  const h = hash4(dam, bay, 0x6a7e, 0) / 4294967296;
  if (bay === Math.floor(bays / 2) || bay === Math.floor(bays / 2) - 1 + (dam & 1) * 2) return true;
  return h < 0.42;
}

function g02Default() {
  const ws = SITES.waterStairs;
  const out = [];
  for (const L of ws.levels) {
    const d = L.dam, sp = d.spillway, i = L.index;
    const cx = (d.a[0] + d.b[0]) / 2, cz = (d.a[1] + d.b[1]) / 2;
    const dx = sp.dir[0], dz = sp.dir[1];
    const abl = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) || 1;
    const ax = (d.b[0] - d.a[0]) / abl, az = (d.b[1] - d.a[1]) / abl;
    // megastructure dam frame: Z = spillway dir, X = Z rotated by -90° = (dz, -dx)
    const flipX = dz * ax - dx * az < 0 ? -1 : 1;
    const bays = [];
    const SW = 12 * sp.bays + 6 * (sp.bays - 1);
    for (let k = 0; k < sp.bays; k++) {
      const X = -SW / 2 + 6 + k * 18;
      bays.push({ off: X * flipX, open: spillwayGateOpen(i, sp.bays - 1 - k), flow: 1 });
    }
    const next = i < 5 ? ws.levels[i + 1].level : ws.plain.level + 6;
    const crest = d.crest, toe = d.width + 0.78 * (crest - 3 - (next - 8));
    out.push({ i, cx, cz, dx, dz, ax, az, hw: SW / 2, bays, level: L.level, next, out: toe + 4 });
  }
  return out;
}
let G02 = g02Default();
const G02_R = SITES.waterStairs.radius + 6000;

/**
 * Install the megastructure spillway outlets (app.systems.mega.spillways()):
 * [{dam, bay, open, across, ecef:{x,y,z}, dirEcef, flow, level, tailLevel}]. Returns true when the
 * data changed the layout (the caller rebuilds the G02 tiles).
 */
export function setG02Spillways(list) {
  if (!Array.isArray(list) || !list.length) return false;
  const ws = SITES.waterStairs;
  const next = g02Default();
  const states = [];
  let maxFlow = 0;
  for (const s of list) maxFlow = Math.max(maxFlow, s.flow || 0);
  const byDam = new Map();
  for (const s of list) {
    const D = next[s.dam];
    if (!D || !s.ecef) continue;
    if (!byDam.has(s.dam)) { byDam.set(s.dam, []); D.bays = []; }
    const r = Math.hypot(s.ecef.x, s.ecef.y, s.ecef.z) || 1;
    unitToLocal(ws, s.ecef.x / r, s.ecef.y / r, s.ecef.z / r, _loc);
    const along = (_loc.x - D.cx) * D.dx + (_loc.z - D.cz) * D.dz;
    if (isFinite(along) && along > 5 && along < 400) D.out = along;
    D.bays.push({ off: +s.across || 0, open: !!s.open, flow: maxFlow > 0 ? Math.max(0.35, (s.flow || 0) / maxFlow) : 1 });
    byDam.get(s.dam)[s.bay] = !!s.open;
  }
  for (const [dam, st] of byDam) states[dam] = st;
  const key = JSON.stringify(next.map((D) => [D.out.toFixed(1), D.bays.map((b) => (b.open ? 1 : 0) + ':' + b.off.toFixed(1))]));
  if (key === G02_LIVE?.key) return false;
  G02 = next;
  G02_LIVE = { key, states };
  return true;
}

// Gate state of a canal sluice / level step: the pure rule lives in world/sluice.js (D2; buildings-o imports
// it from there), re-exported here for the render-side callers.
export { sluiceOpen };

/**
 * Outlets of the G02 spillway bays (current layout: SITES default or the megastructure's exact chutes):
 * [{dam, x, z (site-local m at the chute end), dx, dz (downstream unit), level (tail water m), open, flow (0..1)}]
 */
export function g02Outlets() {
  const out = [];
  for (const s of G02) {
    for (const bay of s.bays) {
      out.push({ dam: s.i, x: s.cx + s.dx * s.out + s.ax * bay.off, z: s.cz + s.dz * s.out + s.az * bay.off, dx: s.dx, dz: s.dz, level: s.next, open: bay.open, flow: bay.flow });
    }
  }
  return out;
}
/** layout version of the G02 spillways (changes when the megastructure data is installed) */
export function g02Version() { return G02_LIVE ? G02_LIVE.key : 'default'; }

// G01 harbour / barrier geometry in (u, v) frame (U along the shore ESE, V offshore SSW; arc centre (0, cv))
const G01_ARC = G01_GEO.arc;
/** a gap in the barrier (navigation mouth / lock): centre, inward unit normal (towards the arc centre), tangent,
 *  half width, arc angles of its ends */
function g01Gap(p) {
  const a = g01ToUV(p.a[0], p.a[1], {}), b = g01ToUV(p.b[0], p.b[1], {});
  const c = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
  let nu = -c.u, nv = G01_ARC.cv - c.v; const nl = Math.hypot(nu, nv) || 1; nu /= nl; nv /= nl;
  const t0 = Math.atan2(a.u, a.v - G01_ARC.cv), t1 = Math.atan2(b.u, b.v - G01_ARC.cv);
  return { c, nu, nv, tu: -nv, tv: nu, hw: Math.hypot(a.u - b.u, a.v - b.v) / 2, th0: Math.min(t0, t1), th1: Math.max(t0, t1), chamber: p.chamber || 0 };
}
const G01_MOUTH = g01Gap(SITES.tidalBarrier.mouth);
const G01_LOCKS = SITES.tidalBarrier.locks.map(g01Gap);
const G01_R = SITES.tidalBarrier.radius + 4000;
const TAN22 = Math.tan(22 * Math.PI / 180), TAN32 = Math.tan(32 * Math.PI / 180);
const G01_SHOAL = 1.45;          // swell amplitude at the barrier line relative to the open sea (shoaling over the shelf)

// Lock gate states (W4): replica of megastructures/g01.js lockState(i) (pure: hash4(0x6011, i, 7, 0)) so the first
// build is already right; the megastructure layout's own states are installed with setG01Locks() once it arrived
// (mega.layout.G01 lock chunks), which rebuilds the G01 tiles only if they differ.
function lockStateRule(i) {
  const h = hash4(0x6011, i, 7, 0);
  const outerOpen = (h & 3) === 0;
  return { outerOpen, innerOpen: !outerOpen || ((h >> 2) & 1) === 0 };
}
let G01_LOCK_STATE = G01_LOCKS.map((_, i) => lockStateRule(i));
/** install the G01 lock gate states [{outerOpen, innerOpen}] by lock index (G01-L1..L8); true when they changed */
export function setG01Locks(states) {
  if (!Array.isArray(states)) return false;
  let changed = false;
  const next = G01_LOCK_STATE.map((s, i) => {
    const t = states[i];
    if (!t || typeof t.outerOpen !== 'boolean') return s;
    const n = { outerOpen: t.outerOpen, innerOpen: t.innerOpen !== false };
    if (n.outerOpen !== s.outerOpen || n.innerOpen !== s.innerOpen) changed = true;
    return n;
  });
  G01_LOCK_STATE = next;
  return changed;
}
/** current G01 lock gate states (debug / tests) */
export function g01LockStates() { return G01_LOCK_STATE.map((s) => ({ ...s })); }

/**
 * Wave transmission through a barrier gap (amplitude factor, 1 = open sea): the waves pass the gap and spread in a fan
 * (half angle atan(spreadTan) from the gap edges, amplitude ∝ 1/√fan width), the barrier heads cast a diffraction
 * penumbra that widens with the distance, and the energy decays slowly (e-fold `decay` m) across the basin. 1 on the
 * gap line itself, so the open sea continues through the mouth without any seam.
 */
function gapK(u, v, g, spreadTan, decay) {
  const du = u - g.c.u, dv = v - g.c.v;
  const a = du * g.nu + dv * g.nv;                       // metres into the harbour
  if (a <= 0) return 1;
  const l = Math.abs(du * g.tu + dv * g.tv);
  const edge = g.hw + a * spreadTan;
  const ex = l - edge;
  const ls = 110 + 0.35 * a;
  const sh = ex <= 0 ? 1 : Math.exp(-(ex * ex) / (ls * ls));
  return Math.sqrt(g.hw / edge) * sh * Math.exp(-a / decay);
}
/** is the barrier arc at angle th a gap (mouth / lock with open gates)? (no caisson face: no wall wash / shelter) */
function g01GapAt(th, pad) {
  const M = G01_MOUTH;
  if (th > M.th0 - pad && th < M.th1 + pad) return true;
  for (let i = 0; i < G01_LOCKS.length; i++) {
    const L = G01_LOCKS[i];
    if (G01_LOCK_STATE[i].outerOpen && th > L.th0 - pad && th < L.th1 + pad) return true;
  }
  return false;
}
const _g01 = { swell: 1, calm: 0, wash: 0, turb: 0, basin: 0 };
/**
 * G01 sea state at harbour-frame (u, v) (W1, fix round 2): swell transmission, sheltering (`calm` 0 open sea … 1
 * sheltered: long wind sea / whitecaps damped in the shader, chop and ripples kept), caisson wash, mouth turbulence.
 * Every term varies smoothly with the distance from the walls and the mouth: the open sea runs through the 560 m mouth
 * and fades inside over a few hundred metres to kilometres (no ruler-straight seam across the mouth).
 */
function g01SeaState(u, v, out) {
  out.swell = 1; out.calm = 0; out.wash = 0; out.turb = 0; out.basin = 0;
  const A = G01_ARC;
  const rr = Math.hypot(u, v - A.cv);
  const th = Math.atan2(u, v - A.cv);
  const onArc = Math.abs(u) < A.half + 300;
  if (rr < A.r && Math.abs(u) < A.half + 900 && v > g01ShoreV(u) - 200) {
    const dArc = A.r - rr;                                   // metres inside the barrier line
    // a solid wall cuts the waves right behind it; the ramp only keeps the cut a few vertices wide on coarse tiles
    const leak = g01GapAt(th, 0) ? 0 : 1 - sstep(10, 130, dArc);
    // swell: through the mouth and the locks whose outer AND inner gates are open (a lock with only the outer gate
    // open lets the swell into its chamber, ≈ 260 m, but not into the basin)
    let k2 = gapK(u, v, G01_MOUTH, TAN22, 7000) ** 2;
    for (let i = 0; i < G01_LOCKS.length; i++) {
      const st = G01_LOCK_STATE[i];
      if (!st.outerOpen) continue;
      const L = G01_LOCKS[i];
      let k = gapK(u, v, L, TAN22, 3000);
      if (k <= 0) continue;
      if (!st.innerOpen) {
        const a = (u - L.c.u) * L.nu + (v - L.c.v) * L.nv;
        k *= 1 - sstep(0.7 * L.chamber, L.chamber, a);
      }
      k2 += k * k;
    }
    // the incident swell is the one shoaled over the shelf at the barrier line (SHOAL × open sea, see below)
    out.swell = Math.max(0.03, Math.min(G01_SHOAL, G01_SHOAL * Math.max(Math.sqrt(k2), leak)));
    // wind sea: comes through the mouth too (wider fan) and regrows with the fetch inside the basin (wind from ESE,
    // along +U: short fetch behind the eastern barrier, longer to the west). No wall leak here: right behind a caisson
    // the open-sea wind waves are blocked (the leak ramp only keeps the swell cut a few vertices wide)
    const kw = gapK(u, v, G01_MOUTH, TAN32, 12000);
    const fetch = Math.max(0, A.half + 400 - u);
    const regrow = Math.sqrt(fetch / (fetch + 9000));
    out.calm = Math.max(0, Math.min(1, (1 - kw) * (1 - 0.35 * regrow)));
    // protected-basin factor (calm-water tint, W2): the whole basin except the mouth approach (fades in 0.3–1.5 km)
    out.basin = sstep(0.05, 0.45, 1 - kw);
  } else {
    // offing: the swell shoals over the shelf crest under the barrier (−40 → −9.5 m) and steepens towards the wall
    // (§5 09 外海长浪), ×1 a few km out → ×G01_SHOAL at the barrier line (the mouth passes this incident swell on)
    const d = Math.max(0, rr - A.r);
    out.swell = 1 + (G01_SHOAL - 1) * Math.exp(-d / 2500);
    if (rr >= A.r && onArc && !g01GapAt(th, 4 / A.r)) {
      // seaward face of the caissons (not across the mouth / open lock gaps): breaking swell, white water along the wall
      out.wash = Math.exp(-Math.max(0, d - 8) / 22);
    }
  }
  // tidal current through the mouth: turbulence along the channel axis, fading smoothly both ways
  const M = G01_MOUTH;
  const du = u - M.c.u, dv = v - M.c.v;
  const ax = du * M.nu + dv * M.nv, la = du * M.tu + dv * M.tv;
  const e = (ax * ax) / (650 * 650) + (la * la) / (300 * 300);
  if (e < 9) out.turb = 0.2 * Math.exp(-e);
  return out;
}
/** G01 sea state at a unit vector (tests / debug): {swell, calm, wash, turb} or null outside the site frame */
export function g01SeaStateAt(ux, uy, uz) {
  if (!unitToLocal(SITES.tidalBarrier, ux, uy, uz, _loc)) return null;
  g01ToUV(_loc.x, _loc.z, _uv);
  return { ...g01SeaState(_uv.u, _uv.v, _g01), u: _uv.u, v: _uv.v };
}

function siteDist(site, ux, uy, uz) {
  const la = site.lat * Math.PI / 180, lo = site.lon * Math.PI / 180;
  const cx = Math.cos(la) * Math.sin(lo), cy = Math.sin(la), cz = Math.cos(la) * Math.cos(lo);
  const d = Math.min(1, Math.max(-1, ux * cx + uy * cy + uz * cz));
  return Math.acos(d) * R;
}

const _loc = {}, _uv = {};
/** e-folding length (m) of a sluice plume: local white water below the gates, clear after the stilling reach */
const plumeLen = (w, head) => Math.max(30, Math.min(110, 0.5 * w + 5 * head));
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const _fc = {};
/**
 * Build the attribute arrays of a tile's water surface. Returns null when nothing is drawable.
 * @param {object} tile terrain tile object (tile:add payload)
 * @param {object} [opts]
 * @param {Array|null} [opts.sluices] exact canal sluices around the tile (hydro canalsInTile records, see
 *   WaterSystem._sluicesFor): [{u:{x,y,z} unit, up, down, heading (deg, downstream), width, open}]. When given,
 *   the sluice plumes start just downstream of the OPEN sluices (sluiceOpen(up, down), the rule buildings-o draws);
 *   null = records not loaded yet (tiles from L11: no canal plumes yet; coarser tiles: level-step heuristic).
 */
export function buildWaterTile(tile, opts = {}) {
  const W = tile.water;
  if (!W || !W.type) return null;
  const F = FACES[tile.face];
  const b = tile.bounds;
  const a0 = b.a0, b0 = b.b0, da = b.a1 - b.a0, db = b.b1 - b.b0;
  const C = tile.centerEcef;
  const tileM = da * FACE_ARC;
  const vs = tileM / N;                                   // vertex spacing (face-plane m)
  const type = W.type, level = W.level, depth = W.depth, flow = W.flow, width = W.width;

  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) faceDir(F, a0 + da * i / N, b0 + db * j / N, D, (j * NV + i) * 3);

  // ---- per-vertex parameters of the water body
  const set = new Uint8Array(GV);
  const P = new Float32Array(GV * 8);   // swell, wind, tint, flowMix, draw, flowSpeed, foam, turb
  let any = false;
  for (let o = 0; o < GV; o++) {
    const t = type[o];
    if (!t) continue;
    set[o] = 1; any = true;
    const q = o * 8;
    if (t === 1) { P[q] = 1; P[q + 1] = 1; P[q + 2] = 0; P[q + 3] = 0; P[q + 4] = 1; P[q + 5] = 0; }
    else if (t === 3) { P[q] = 0; P[q + 1] = 0.30; P[q + 2] = 1; P[q + 3] = 0; P[q + 4] = 1; P[q + 5] = 0; }
    else {
      const w = width[o] || 0;
      P[q] = 0; P[q + 1] = 0.10; P[q + 2] = 0.55; P[q + 3] = 1;
      P[q + 4] = w >= 2 * vs ? 1 : 0;
      P[q + 5] = w > 30 ? 0.75 : w > 8 ? 0.5 : 0.3;      // m/s
    }
  }
  if (!any) return null;
  // shoreline dilation (3 vertices, like the terrain's level dilation): copy the neighbour's params
  for (let pass = 0; pass < 3; pass++) {
    const add = [];
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const o = j * NV + i; if (set[o]) continue;
      let src = -1;
      if (i > 0 && set[o - 1]) src = o - 1;
      else if (i < N && set[o + 1]) src = o + 1;
      else if (j > 0 && set[o - NV]) src = o - NV;
      else if (j < N && set[o + NV]) src = o + NV;
      if (src >= 0) add.push(o, src);
    }
    for (let k = 0; k < add.length; k += 2) {
      const o = add[k], s = add[k + 1];
      set[o] = 1;
      for (let c = 0; c < 8; c++) P[o * 8 + c] = P[s * 8 + c];
    }
  }

  // ---- regional sea state, harbour calm, megastructure foam
  const nearG01 = siteDist(SITES.tidalBarrier, C.x / R, C.y / R, C.z / R) < G01_R + tile.size;
  const nearG02 = siteDist(SITES.waterStairs, C.x / R, C.y / R, C.z / R) < G02_R + tile.size;
  const calmArr = new Float32Array(GV);
  const basinArr = new Float32Array(GV);      // G01 protected-basin factor (harbour tint), written as −aWtrI (never polar)
  const JF = new Float32Array(GV * 3);        // jet flow override (east, north, speed m/s)
  // large-scale sea state (fetch, 90–380 km noise): sampled every 8 vertices and interpolated (the field is
  // smooth over a tile at every level; ~60× fewer noise calls than per vertex)
  let SK = null;
  for (let o = 0; o < GV; o++) if (set[o] && (P[o * 8] > 0 || P[o * 8 + 1] > 0.3)) { SK = new Float32Array(81); break; }
  if (SK) {
    for (let gj = 0; gj <= 8; gj++) for (let gi = 0; gi <= 8; gi++) {
      const o = gj * 8 * NV + gi * 8, ux = D[o * 3], uy = D[o * 3 + 1], uz = D[o * 3 + 2];
      const n = SEA_NOISE.noise3(ux * 9.0, uy * 9.0, uz * 9.0) * 0.6 + SEA_NOISE.noise3(ux * 37, uy * 37, uz * 37) * 0.4;
      SK[gj * 9 + gi] = 0.9 + 0.35 * n;
    }
  }
  for (let o = 0; o < GV; o++) {
    if (!set[o]) continue;
    const q = o * 8;
    const ux = D[o * 3], uy = D[o * 3 + 1], uz = D[o * 3 + 2];
    if (SK && (P[q] > 0 || P[q + 1] > 0.3)) {
      const i = o % NV, j = (o - i) / NV;
      const gi = Math.min(7, i >> 3), gj = Math.min(7, j >> 3), fi = (i - gi * 8) / 8, fj = (j - gj * 8) / 8;
      const k00 = SK[gj * 9 + gi], k10 = SK[gj * 9 + gi + 1], k01 = SK[gj * 9 + gi + 9], k11 = SK[gj * 9 + gi + 10];
      const k = (k00 * (1 - fi) + k10 * fi) * (1 - fj) + (k01 * (1 - fi) + k11 * fi) * fj;
      P[q] *= k; P[q + 1] *= k;
    }
    if (nearG01 && type[o] !== 2 && unitToLocal(SITES.tidalBarrier, ux, uy, uz, _loc)) {
      // harbour sea state (W1): swell through the mouth / open locks, sheltering, caisson wash, mouth turbulence —
      // smooth in the distance from the walls and the mouth (see g01SeaState)
      g01ToUV(_loc.x, _loc.z, _uv);
      const st = g01SeaState(_uv.u, _uv.v, _g01);
      calmArr[o] = st.calm;
      if (st.basin > 0) basinArr[o] = st.basin;
      P[q] *= st.swell;
      P[q + 1] *= 1 - 0.3 * st.calm;                         // chop / ripples stay (fetch-saturated); the shader damps
      if (st.wash > 0) {                                     // the long wind sea by `calm` (no mirror-flat basin)
        P[q + 6] = Math.max(P[q + 6], 0.55 * st.wash);
        P[q + 7] = Math.max(P[q + 7], 0.6 * st.wash);
      }
      if (st.turb > 0) P[q + 7] = Math.max(P[q + 7], st.turb);
    }
    if (nearG02 && unitToLocal(SITES.waterStairs, ux, uy, uz, _loc)) {
      const x = _loc.x, z = _loc.z, lvl = level[o];
      for (const s of G02) {
        const rx = x - s.cx, rz = z - s.cz;
        const along = rx * s.dx + rz * s.dz;
        if (along < -30 || along > 1300) continue;
        if (lvl > s.level - 1 || lvl < s.next - 9) continue;   // only the tailwater below this dam
        const across = rx * s.ax + rz * s.az;
        if (Math.abs(across) > s.hw + 160 + Math.max(0, along) * 0.45) continue;
        const sd = along - s.out;                               // metres past the chute outlets
        // white water below the open bays, torn apart and clearing through the stilling reach;
        // the closed bays only seep (停用闸孔下方的水比泄流口平静)
        let foam = 0, turb = 0, jet = 0;
        // a vertex stands for its whole cell: plumes narrower than the vertex spacing are widened to it
        // (area coverage), so a coarse tile never samples the gaps between bays as blobs
        const hv = 0.5 * vs;
        for (const bay of s.bays) {
          const dl = Math.abs(across - bay.off);
          const spread = Math.max(6 + Math.max(0, sd) * 0.15, 0.35 * vs);
          const lat = Math.exp(-Math.max(0, dl - 6 - hv) / spread);
          if (bay.open) {
            // white water below the stilling basin, torn into streaks, clear after ~2-3 hundred metres
            const q = bay.flow;
            const decay = sd < 0 ? 1 : Math.exp(-sd / (70 + 50 * q));
            foam = Math.max(foam, Math.min(1, 0.78 + 0.3 * q) * lat * decay);
            turb = Math.max(turb, Math.exp(-Math.max(0, dl - 6 - hv) / (spread * 1.4)) * (sd < 0 ? 1 : Math.exp(-sd / (160 + 90 * q))));
            jet = Math.max(jet, lat * (sd < 0 ? 1 : Math.exp(-sd / 260)));
          } else {
            // closed bay: only seepage, the water below stays calm
            const near = Math.exp(-Math.max(0, dl - 6) / 6) * (sd < 0 ? 1 : Math.exp(-sd / 25));
            foam = Math.max(foam, 0.015 * near);
            turb = Math.max(turb, 0.04 * near);
          }
        }
        const q = o * 8;
        P[q + 6] = Math.max(P[q + 6], foam);
        P[q + 7] = Math.max(P[q + 7], turb);
        if (jet > 0.02 && along > 0) {
          // spillway jet: fast flow away from the dam (site frame: x east, z south)
          P[q + 3] = Math.max(P[q + 3], jet);
          if (2.8 * jet > JF[o * 3 + 2]) { JF[o * 3] = s.dx; JF[o * 3 + 1] = -s.dz; JF[o * 3 + 2] = 2.8 * jet; }
        }
      }
    }
  }
  // canal sluices / level steps: white water below the discharging gates, clearing through the stilling
  // reach (闸前深水较暗，打开的闸孔下方有局部白沫，流经消能区后逐渐变清); a closed gate leaves the reach
  // below it calm. Sources (tiles from L11) = the drawn canal vertices of the lower reach right below each OPEN
  // hydro sluice record (opts.sluices, sluiceOpen(up, down) — the rule the sluice stations draw); coarser tiles
  // fall back to level steps of the vertex grid (a canal neighbour higher than max(0.4 m, 2 %)), and only when the
  // higher reach lies UPSTREAM (the vertex flow points away from it): a pump lifts the water downstream and gets
  // no plume. The plume spreads over the lower reach by a breadth-first walk (metres): LOD independent.
  const SL = opts.sluices;
  if (W.hasCanal && (SL || tile.level < 11)) {
    const rv = Math.max(1, Math.min(3, Math.round(30 / vs)));
    // float64 distances + strict improvement: with Float32 storage a relaxation whose value rounds UP to the stored one
    // re-pushed the vertex on every path from the sources (exponential walk on fine tiles near an open sluice; the
    // build then failed and the tile had no water mesh at all)
    const dist = new Float64Array(GV).fill(1e9);
    const srcLevel = new Float32Array(GV), srcHead = new Float32Array(GV), srcW = new Float32Array(GV);
    const queue = [];
    const minStep = Math.max(0.4, 0.02 * rv * vs);
    if (SL) {
      // exact sluices: the canal vertices of the lower reach right below each discharging sluice
      for (const sl of SL) {
        if (!sl.open) continue;
        vecToFace(sl.u.x, sl.u.y, sl.u.z, _fc);
        if (_fc.face !== tile.face) continue;
        const gi = (_fc.a - a0) / da * N, gj = (_fc.b - b0) / db * N;
        const rr = Math.max(1.0, 0.36 * (sl.width || 10) / vs + 0.6);
        if (gi < -rr - 2 || gi > N + rr + 2 || gj < -rr - 2 || gj > N + rr + 2) continue;
        const hr = (sl.heading || 0) * Math.PI / 180;
        flowToFace(F[1], F[2], sl.u.x, sl.u.y, sl.u.z, Math.sin(hr), Math.cos(hr), _fu);
        const fl = Math.hypot(_fu[0], _fu[1]) || 1, du = _fu[0] / fl, dv = _fu[1] / fl;
        const head = Math.max(0.5, (sl.up || 0) - (sl.down || 0));
        if (Array.isArray(sl.spans) && sl.spans.length) {
          // the station's OPEN bays are known (sluicejet.js: buildings-o gateLayout, metres left of the flow from the
          // centreline): white water only below them, spreading sideways downstream; the reach below the closed bays
          // stays calm (停用闸孔下方的水比泄流口平静). Written analytically (no breadth-first walk).
          const wch = Math.max(6, sl.width || 10), Lf = plumeLen(wch, head), Lmax = 3 * Lf;
          const R0 = Math.ceil(Lmax / vs) + 2;
          if (gi < -R0 || gi > N + R0 || gj < -R0 || gj > N + R0) continue;
          for (let j = Math.max(0, Math.floor(gj - R0)); j <= Math.min(N, Math.ceil(gj + R0)); j++) {
            for (let i = Math.max(0, Math.floor(gi - R0)); i <= Math.min(N, Math.ceil(gi + R0)); i++) {
              const o = j * NV + i;
              if (type[o] !== 2 || Math.abs(level[o] - sl.down) > 0.35) continue;
              const ri = i - gi, rj = j - gj;
              const al = (ri * du + rj * dv) * vs;                       // metres downstream of the gate line
              if (al < -0.35 * vs || al > Lmax) continue;
              const lat = (rj * du - ri * dv) * vs;                       // metres left of the flow
              if (Math.abs(lat) > wch / 2 + vs) continue;
              const a = Math.max(0, al), sig = 1.5 + 0.5 * vs + 0.2 * a;
              let lf = 0;
              for (const sp of sl.spans) {
                const dd = lat < sp[0] ? sp[0] - lat : lat > sp[1] ? lat - sp[1] : 0;
                lf = Math.max(lf, Math.exp(-(dd * dd) / (sig * sig)));
              }
              if (lf < 0.01) continue;
              const q = o * 8;
              P[q + 6] = Math.max(P[q + 6], Math.min(1, 0.55 + head * 0.06) * Math.exp(-a / Lf) * lf);
              P[q + 7] = Math.max(P[q + 7], Math.min(1, 0.4 + head * 0.04) * Math.exp(-a / (1.8 * Lf)) * Math.min(1, 1.3 * lf));
              P[q + 5] = Math.max(P[q + 5], 0.6 + 1.6 * Math.exp(-a / Lf) * lf);
            }
          }
          continue;
        }
        const r0 = Math.ceil(rr + 1.5);
        for (let j = Math.max(0, Math.floor(gj - r0)); j <= Math.min(N, Math.ceil(gj + r0)); j++) {
          for (let i = Math.max(0, Math.floor(gi - r0)); i <= Math.min(N, Math.ceil(gi + r0)); i++) {
            const o = j * NV + i;
            if (type[o] !== 2 || Math.abs(level[o] - sl.down) > 0.35) continue;
            const ri = i - gi, rj = j - gj, along = ri * du + rj * dv;
            if (along < -0.35) continue;                                  // upstream of the gate line
            if (Math.hypot(ri - du * along, rj - dv * along) > rr) continue;
            const d0 = Math.max(0, along) * vs;
            if (!(d0 < dist[o])) continue;
            dist[o] = d0; srcLevel[o] = level[o]; srcHead[o] = head; srcW[o] = Math.max(6, sl.width || 10);
            queue.push(o);
          }
        }
      }
    }
    if (!SL) for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const o = j * NV + i;
      if (type[o] !== 2) continue;
      let up = 0, upL = 0, bdi = 0, bdj = 0;
      for (let dj = -rv; dj <= rv; dj++) for (let di = -rv; di <= rv; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii > N || jj > N) continue;
        const p = jj * NV + ii; if (type[p] !== 2) continue;
        const d = level[p] - level[o];
        if (d > up) { up = d; upL = level[p]; bdi = di; bdj = dj; }
      }
      if (up <= minStep) continue;
      const fe = flow[o * 2] || 0, fn = flow[o * 2 + 1] || 0;
      if (fe || fn) {
        flowToFace(F[1], F[2], D[o * 3], D[o * 3 + 1], D[o * 3 + 2], fe, fn, _fu);
        const fl = Math.hypot(_fu[0], _fu[1]) || 1, bl = Math.hypot(bdi, bdj) || 1;
        // direction from the higher vertex to this one (grid i ~ face u, j ~ face v) vs the flow here
        if ((-bdi * _fu[0] - bdj * _fu[1]) / (fl * bl) < -0.3) continue;      // higher reach downstream: pump
      }
      if (sluiceOpen(upL, level[o])) {
        dist[o] = 0; srcLevel[o] = level[o]; srcHead[o] = up; srcW[o] = Math.max(6, width[o] || 10);
        queue.push(o);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      if (qi > GV * 16) break;                                 // safety net (a 65² walk never needs this many steps)
      const o = queue[qi];
      const i = o % NV, j = (o - i) / NV;
      const Lt = 3 * plumeLen(srcW[o], srcHead[o]);
      const nd = dist[o] + vs;
      if (!(nd <= Lt)) continue;                               // (also stops a NaN source from flooding the walk)
      const nb = [i > 0 ? o - 1 : -1, i < N ? o + 1 : -1, j > 0 ? o - NV : -1, j < N ? o + NV : -1];
      for (const p of nb) {
        if (p < 0 || type[p] !== 2 || Math.abs(level[p] - srcLevel[o]) > 0.3 || dist[p] <= nd + 1e-6) continue;
        dist[p] = nd; srcLevel[p] = srcLevel[o]; srcHead[p] = srcHead[o]; srcW[p] = srcW[o];
        queue.push(p);
      }
    }
    for (let o = 0; o < GV; o++) {
      if (dist[o] >= 1e9) continue;
      const head = srcHead[o], Lf = plumeLen(srcW[o], head);
      const sd = dist[o];
      const q = o * 8;
      P[q + 6] = Math.max(P[q + 6], Math.min(1, 0.55 + head * 0.06) * Math.exp(-sd / Lf));
      P[q + 7] = Math.max(P[q + 7], Math.min(1, 0.4 + head * 0.04) * Math.exp(-sd / (1.8 * Lf)));
      P[q + 5] = Math.max(P[q + 5], 0.6 + 1.6 * Math.exp(-sd / Lf));          // faster jet below the gate
    }
  }

  // ---- attributes
  const position = new Float32Array(GV * 3), normal = new Float32Array(GV * 3), edge = new Float32Array(GV * 3);
  const A = new Float32Array(GV * 4), B = new Float32Array(GV * 4), Fl = new Float32Array(GV * 4), I = new Float32Array(GV);
  // polar ice (floes / brash / slush): meltwater pools and channels beyond ~68°, the sea beyond ~66° and next
  // to the ice (fields.ice); only tiles that reach |lat| > 64° pay for it
  const cLat = Math.abs(Math.asin(Math.max(-1, Math.min(1, C.y / R)))) * 180 / Math.PI;
  const polar = cLat + (tile.size || 0) / R * 57.3 > 64;
  const FS = polar ? {} : null;
  // fields.ice on a 9×9 grid (every 8 vertices; sampleFields ≈ 20–60 µs), interpolated per vertex
  let ICE = null;
  if (FS) {
    ICE = new Float32Array(81);
    for (let gj = 0; gj <= 8; gj++) for (let gi = 0; gi <= 8; gi++) {
      const o = gj * 8 * NV + gi * 8;
      let fi = 0;
      try { fi = sampleFields(D[o * 3], D[o * 3 + 1], D[o * 3 + 2], FS).ice || 0; } catch { fi = 0; }
      ICE[gj * 9 + gi] = fi;
    }
  }
  const pos64 = new Float64Array(GV * 3);
  const U = F[1], V = F[2];
  let bx = 0, by = 0, bz = 0, nset = 0;
  for (let o = 0; o < GV; o++) {
    const ux = D[o * 3], uy = D[o * 3 + 1], uz = D[o * 3 + 2];
    const lvl = set[o] ? level[o] : 0;
    const r = R + lvl;
    const px = ux * r - C.x, py = uy * r - C.y, pz = uz * r - C.z;
    pos64[o * 3] = px; pos64[o * 3 + 1] = py; pos64[o * 3 + 2] = pz;
    position[o * 3] = px; position[o * 3 + 1] = py; position[o * 3 + 2] = pz;
    normal[o * 3] = ux; normal[o * 3 + 1] = uy; normal[o * 3 + 2] = uz;
    if (!set[o]) continue;
    bx += px; by += py; bz += pz; nset++;
    const q = o * 8;
    A[o * 4] = depth[o]; A[o * 4 + 1] = P[q + 4]; A[o * 4 + 2] = P[q + 2]; A[o * 4 + 3] = P[q + 3];
    B[o * 4] = P[q]; B[o * 4 + 1] = P[q + 1]; B[o * 4 + 2] = P[q + 6]; B[o * 4 + 3] = P[q + 7];
    // flow (east, north) unit -> face-plane axes, scaled by speed
    const jetOn = JF[o * 3 + 2] > 0;
    const fe = jetOn ? JF[o * 3] : flow[o * 2] || 0, fn = jetOn ? JF[o * 3 + 1] : flow[o * 2 + 1] || 0;
    const fsp = jetOn ? Math.max(P[q + 5], JF[o * 3 + 2]) : P[q + 5];
    if ((fe || fn) && fsp > 0) {
      flowToFace(U, V, ux, uy, uz, fe, fn, _fu);
      Fl[o * 4] = _fu[0] * fsp;
      Fl[o * 4 + 1] = _fu[1] * fsp;
    }
    Fl[o * 4 + 2] = lvl;
    Fl[o * 4 + 3] = calmArr[o];
    if (FS) {
      const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, uy)))) * 180 / Math.PI;
      let ic = 0;
      if (lat > 64) {
        const i = o % NV, j = (o - i) / NV;
        const gi = Math.min(7, i >> 3), gj = Math.min(7, j >> 3), fi0 = (i - gi * 8) / 8, fj0 = (j - gj * 8) / 8;
        const fi = (ICE[gj * 9 + gi] * (1 - fi0) + ICE[gj * 9 + gi + 1] * fi0) * (1 - fj0) + (ICE[gj * 9 + gi + 9] * (1 - fi0) + ICE[gj * 9 + gi + 10] * fi0) * fj0;
        // sea (tint 0, also the dilated shore vertices of the sea) vs meltwater pools / channels
        if (P[q + 2] < 0.3) ic = 0.55 * sstep(66, 80, lat) + 0.9 * fi;
        else ic = 0.12 + 0.25 * sstep(68, 80, lat) + 0.6 * fi;          // sparse floes, dense next to the ice
        ic *= sstep(64, 68, lat);
      }
      I[o] = Math.min(1, ic);
    } else if (basinArr[o] > 0) I[o] = -basinArr[o];
  }
  // stitch deltas of odd edge vertices (exact against a coarser neighbour's straight edge)
  for (let e = 0; e < 4; e++) {
    for (let t = 1; t < N; t += 2) {
      const at = (k) => (e === 0 ? k * NV : e === 1 ? k * NV + N : e === 2 ? k : N * NV + k);
      const o = at(t), p0 = at(t - 1), p1 = at(t + 1);
      for (let c = 0; c < 3; c++) edge[o * 3 + c] = (pos64[p0 * 3 + c] + pos64[p1 * 3 + c]) * 0.5 - pos64[o * 3 + c];
    }
  }
  // ---- index: quads with four water vertices; skip level steps (sluices / dams) and fully undrawn quads
  const idx = [];
  const stepTol = Math.max(1.5, vs * 0.06);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v00 = j * NV + i, v10 = v00 + 1, v01 = v00 + NV, v11 = v01 + 1;
    if (!(set[v00] && set[v10] && set[v01] && set[v11])) continue;
    if (A[v00 * 4 + 1] + A[v10 * 4 + 1] + A[v01 * 4 + 1] + A[v11 * 4 + 1] <= 0) continue;
    const l0 = level[v00], l1 = level[v10], l2 = level[v01], l3 = level[v11];
    if (Math.max(l0, l1, l2, l3) - Math.min(l0, l1, l2, l3) > stepTol) continue;
    if (((i + j) & 1) === 0) idx.push(v00, v10, v11, v00, v11, v01);
    else idx.push(v00, v10, v01, v10, v11, v01);
  }
  if (!idx.length) return null;
  bx /= nset; by /= nset; bz /= nset;
  let r2 = 0;
  for (let o = 0; o < GV; o++) if (set[o]) {
    const dx = position[o * 3] - bx, dy = position[o * 3 + 1] - by, dz = position[o * 3 + 2] - bz;
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  const P0 = WAVE_PERIOD;
  const ox = ((a0 * FACE_ARC) % P0 + P0) % P0, oy = ((b0 * FACE_ARC) % P0 + P0) % P0;
  return {
    position, normal, edge, A, B, F: Fl, I, index: new Uint16Array(idx),
    sphere: [bx, by, bz, Math.sqrt(r2) + 2],
    origin: [ox, oy], tileM, vs,
    faceU: U, faceV: V,
    upC: [C.x / R, C.y / R, C.z / R],
    minLevel: W.minLevel ?? 0, maxLevel: W.maxLevel ?? 0,
    hasSea: !!W.hasSea, hasLake: !!W.hasLake, hasCanal: !!W.hasCanal,
  };
}
