// Worker-side builder of the far LOD ("mass models") of one CITY_TILE_LEVEL tile: every building
// of the tile massed by the building kit (generateBuilding(spec, 'mass') — footprint extrusion,
// set-backs, round drums, gables, slab lips) transformed into the tile frame and merged into ONE
// geometry with per-vertex building index and far-facade attributes. Pure JS, no THREE.
// OWNER: city agent.
//
// Tile frame: tangent frame at the tile centre (+x east, +y up, +z south), origin at the tile centre
// direction at height h0 = data.center.h (so y is small: metres relative to the tile's ground).
//
// Output (all typed arrays transferable):
//   position Float32 xyz · normal Int8 xyzw (normalised) · uv Float32 (perimeter m, m above entrance)
//   color Uint8 rgba (linear tint ×255: roof colour on roofs, 255 on facades; a = 255 facade / 0 roof)
//   facade Uint16 (floorH cm, bayW cm, styleId, groundH cm)   facadeId Uint16 (hash hi, hash lo,
//   eave dm (+1000 offset), flags: kit bits 0–6 + city far family bits 10–15, see farFamily)
//   bidx Uint16 (building index in data.buildings)   index Uint32
//   info Float32 per building (INFO_STRIDE): see INFO below.
import { R } from '../../core/constants.js';
import { latLonToUnit, buildingAxes, enuBasisFromUnit, parseTileKey, tileCenterUnit } from '../../core/geo.js';
import { hash4 } from '../../core/hash.js';
import { subRng } from '../../buildings/kit/math.js';
import { normalizeSpec } from '../../buildings/kit/spec.js';
import { superEllipse, surfacePoint, offsetRing, resampleClosed } from '../../buildings/types/z_tower.js';

/**
 * City far-facade family of a building, OR-ed into bits 10–15 of `facadeId.w` (kit flags use bits 0–6) of the
 * merged tile geometry and read by massMaterial.js (fix round 3, ★C1):
 *   bits 10–11 family: 0 = by kit style id, 1 = glass tower with white ceramic spandrels + slab rings ('banded'),
 *              2 = glass tower with silver aluminium spandrels, 3 = round glass tower (white spandrels + storey rings)
 *   bits 12–13 crown: 0 plant screen, 1 crown fins, 2 lantern;   bit 14: white sail fins
 * Mirrors the decisions of buildings/types/office.js towerLayout (buildings-z): same random stream
 * subRng(hash, 970) consumed in the same order, so the far tower matches its detailed model. Other uses → 0.
 */
export function farFamily(spec) {
  const L = officeTowerLayout(spec);
  if (!L) return 0;
  return (L.fam << 10) | (L.crownK << 12) | (L.fins ? 1 << 14 : 0);
}

const clampN = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothN = (t) => { t = clampN(t, 0, 1); return t * t * (3 - 2 * t); };
/**
 * Replica of buildings/types/office.js towerLayout (buildings-z) for podium office towers: the decisions (same
 * random stream, same order) and the plan (superellipse with taper / twist) — so the far tower's family, crown and
 * sail fins (towerExtras) match its detailed model. null for every other building.
 */
export function officeTowerLayout(spec) {
  const m = (spec && spec.meta) || {};
  if (!spec || spec.use !== 'office' || !m.podium || !m.tower) return null;
  let s;
  try { s = normalizeSpec(spec); } catch { return null; }
  if (!(s._floors > (m.podium.floors || 3) + 4)) return null;          // office.js isPodiumTower
  const w = s._w, d = s._d;
  const pf = clampN((m.podium.floors | 0) || 3, 1, 8);
  const pfh = clampN(+m.podium.floorHeight || 5, 4.2, 6);
  const fh = clampN(s._fh || 3.8, 3.4, 4.4);
  const ffl = Math.max(0.3, Math.max(s._ground.fl, s._ground.fr) + 0.15);
  const podTop = ffl + pf * pfh;
  const nT = Math.max(4, s._floors - pf);
  const T = m.tower;
  const tw = clampN(+T.w || w * 0.5, 12, w - 4), td = clampN(+T.d || d * 0.5, 12, d - 4);
  const tx = clampN(+T.x || 0, -w / 2 + tw / 2 + 1, w / 2 - tw / 2 - 1), tz = clampN(+T.z || 0, -d / 2 + td / 2 + 1, d / 2 - td / 2 - 1);
  const round = T.shape === 'round';
  const r = subRng(s.hash >>> 0, 970);
  const top = podTop + nT * fh;
  const tall = nT >= 45;
  const p = round ? 2 : r.float(4.5, 9);
  const taper = tall ? r.float(0.06, 0.16) : 0;
  const twist = !round && tall && r.next() < 0.35 ? r.float(-0.35, 0.35) : 0;
  const fins = !round && r.next() < 0.8;
  const crown = tall ? (r.next() < 0.5 ? 'lantern' : 'fins') : 'plant';
  const banded = !round && r.next() < 0.5;
  const L = { s, pf, nT, fh, podTop, top, tall, round, tw, td, tx, tz, p, taper, twist, fins, crown, banded };
  L.fam = round ? 3 : banded ? 1 : 2;
  L.crownK = crown === 'lantern' ? 2 : crown === 'fins' ? 1 : 0;
  L.planAt = (y) => {
    const t = clampN((y - podTop) / Math.max(1, top - podTop), 0, 1);
    const sc = 1 - taper * smoothN(t);
    return superEllipse(tx, tz, (tw / 2) * sc, (td / 2) * sc, p, round ? 72 : 64, twist * t);
  };
  return L;
}

const WHITE = [0.9, 0.9, 0.88], GRILLE = [0.075, 0.08, 0.085], FROST = [0.5, 0.56, 0.62];
/**
 * Far-LOD crown + sail fins of a podium office tower (building frame, one 'mass_roof' part with its own colours):
 * the white S-curve sail fins of office.js (two per tower, perimeter fractions 0.06 / 0.56 ± 0.05·sin, depth
 * 0.8–1.7 m, 0.6 m thick, rising 5.5 m over the parapet), and the crown — ring of 12 white blades 7–10 m ('fins'),
 * white louvred plant screen on a dark grille ('plant') or the frosted lantern box with its white lid ('lantern'; the
 * kit mass already carries the mast). Silhouettes that the far facade shader cannot draw.
 */
export function towerExtras(L) {
  const P = [], N = [], C = [], I = [];
  const quad = (a, b, c, d, out, col) => {
    // a, b, c, d around the face; flipped if needed so it faces `out`
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    let flip = false;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
    const o = P.length / 3;
    for (const q of [a, b, c, d]) { P.push(q[0], q[1], q[2]); N.push(nx, ny, nz); C.push(col[0], col[1], col[2]); }
    if (!flip) I.push(o, o + 1, o + 2, o, o + 2, o + 3); else I.push(o, o + 2, o + 1, o, o + 3, o + 2);
  };
  // vertical ribbon of a box section along points pts [[x,y,z]], outward normal per point nn [[nx,nz]], depth / thick
  const ribbon = (pts, nn, depth, thick, col) => {
    const rings = pts.map((q, i) => {
      const nx = nn[i][0], nz = nn[i][1], ux = nz, uz = -nx, dd = depth(i), th = thick / 2;
      return [[q[0] - ux * th, q[1], q[2] - uz * th], [q[0] + ux * th, q[1], q[2] + uz * th], [q[0] + ux * th + nx * dd, q[1], q[2] + uz * th + nz * dd], [q[0] - ux * th + nx * dd, q[1], q[2] - uz * th + nz * dd], [nx, nz, ux, uz]];
    });
    for (let i = 0; i + 1 < rings.length; i++) {
      const A = rings[i], B = rings[i + 1], f = A[4];
      quad(A[3], A[2], B[2], B[3], [f[0], 0, f[1]], col);                 // front
      quad(A[1], A[2], B[2], B[1], [f[2], 0, f[3]], col);                 // side +u
      quad(A[0], A[3], B[3], B[0], [-f[2], 0, -f[3]], col);               // side −u
    }
    const E = rings[rings.length - 1];
    quad(E[0], E[1], E[2], E[3], [0, 1, 0], col);                         // top cap
  };
  const top = L.top;
  // ---- sail fins ----
  if (L.fins) {
    const nC = L.nT, step = Math.max(1, Math.round(nC / 30));
    const ys = [];
    for (let i = 0; i <= nC; i += step) ys.push(i >= nC ? top : L.podTop + i * L.fh);
    if (ys[ys.length - 1] < top - 0.01) ys.push(top);
    for (const [f0, amp] of [[0.06, 0.05], [0.56, -0.05]]) {
      const pts = [], nn = [], ts = [];
      for (const y of ys) {
        const t = (y - L.podTop) / (top - L.podTop);
        const sp = surfacePoint(L.planAt, f0 + amp * Math.sin(t * Math.PI), y, 0.25);
        pts.push(sp.p); nn.push(sp.n); ts.push(t);
      }
      const pT = pts[pts.length - 1], nT = nn[nn.length - 1];
      pts.push([pT[0] - nT[0] * 0.6, top + 5.5, pT[2] - nT[1] * 0.6]); nn.push(nT); ts.push(1);
      ribbon(pts, nn, (i) => 0.8 + 0.9 * Math.sin(Math.min(1, ts[i]) * Math.PI), 0.6, WHITE);
    }
  }
  // ---- crown ----
  const ring = resampleClosed(L.planAt(top), 64).pts;
  const rr = offsetRing(ring, -0.3);
  const cx = L.tx, cz = L.tz;
  const cap = (R, y, col) => {
    let mx = 0, mz = 0; for (const q of R) { mx += q[0]; mz += q[1]; } mx /= R.length; mz /= R.length;
    for (let k = 0; k < R.length; k++) {
      const a = R[k], c = R[(k + 1) % R.length];
      const o = P.length / 3;
      const pts = [[mx, y, mz], [a[0], y, a[1]], [c[0], y, c[1]]];
      const ux = pts[1][0] - pts[0][0], uz = pts[1][2] - pts[0][2], vx = pts[2][0] - pts[0][0], vz = pts[2][2] - pts[0][2];
      const up = uz * vx - ux * vz;                       // y of (u × v)
      for (const q of pts) { P.push(q[0], q[1], q[2]); N.push(0, 1, 0); C.push(col[0], col[1], col[2]); }
      if (up >= 0) I.push(o, o + 1, o + 2); else I.push(o, o + 2, o + 1);
    }
  };
  if (L.crown === 'fins') {
    const R = resampleClosed(rr, 24).pts;
    const hs = (L.s.hash >>> 0) % 7;
    for (let k = 0; k < R.length; k += 2) {
      const q = R[k];
      const nx0 = q[0] - cx, nz0 = q[1] - cz, nl = Math.hypot(nx0, nz0) || 1, nx = nx0 / nl, nz = nz0 / nl;
      const hh = 7 + 3 * Math.sin((k / R.length) * Math.PI * 2 + hs);
      ribbon([[q[0], top, q[1]], [q[0] - nx * 0.5, top + hh, q[1] - nz * 0.5]], [[nx, nz], [nx, nz]], () => 0.5, 0.9, WHITE);
    }
  } else if (L.crown === 'plant') {
    const R = resampleClosed(offsetRing(rr, -2.2), 32).pts;
    for (let k = 0; k < R.length; k++) {
      const a = R[k], c = R[(k + 1) % R.length];
      const ex = c[0] - a[0], ez = c[1] - a[1], el = Math.hypot(ex, ez) || 1, nx = -ez / el, nz = ex / el;
      const out = [nx, 0, nz], ox = nx * 0.07, oz = nz * 0.07;
      quad([a[0], top, a[1]], [c[0], top, c[1]], [c[0], top + 3.2, c[1]], [a[0], top + 3.2, a[1]], out, GRILLE);
      for (const yb of [top + 0.9, top + 2.1]) quad([a[0] + ox, yb, a[1] + oz], [c[0] + ox, yb, c[1] + oz], [c[0] + ox, yb + 0.75, c[1] + oz], [a[0] + ox, yb + 0.75, a[1] + oz], out, WHITE);
    }
    cap(R, top + 3.25, WHITE);
  } else if (L.crown === 'lantern') {
    const lan = offsetRing(rr, -Math.min(L.tw, L.td) * 0.12);
    const h = 6 + L.nT * 0.05;
    const R = resampleClosed(lan, 32).pts;
    for (let k = 0; k < R.length; k++) {
      const a = R[k], c = R[(k + 1) % R.length];
      const ex = c[0] - a[0], ez = c[1] - a[1], el = Math.hypot(ex, ez) || 1;
      quad([a[0], top, a[1]], [c[0], top, c[1]], [c[0], top + h, c[1]], [a[0], top + h, a[1]], [-ez / el, 0, ex / el], FROST);
    }
    cap(R, top + h, WHITE);
  }
  if (!I.length) return null;
  const n = P.length / 3;
  return { material: 'mass_roof', keepColor: true, position: new Float32Array(P), normal: new Float32Array(N), uv: new Float32Array(n * 2), color: new Float32Array(C), index: new Uint32Array(I) };
}

export const INFO_STRIDE = 19;
// per building: 0..2 centre (tile frame, mid height), 3 bounding radius, 4 top y, 5 entrance y,
// 6 height above lowest ground, 7 yaw cos, 8 yaw sin (building +x in the tile x/z plane), 9 w, 10 d,
// 11 base y (lowest ground), 12 first triangle (index offset / 3), 13 triangle count, 14..17 tile-frame
// AABB x0, x1, z0, z1 of the vertices, 18 lowest vertex y (incl. the 4 m skirt). Buildings are emitted
// in order, so each one owns a contiguous index range: picking tests the AABBs then the triangles of
// the nearest candidates (no per-tile BVH: building one cost ~1.3 s per dense tile in the worker).
export const INFO = { CX: 0, CY: 1, CZ: 2, RAD: 3, TOP: 4, ENT: 5, H: 6, YC: 7, YS: 8, W: 9, D: 10, BASE: 11, T0: 12, TN: 13, X0: 14, X1: 15, Z0: 16, Z1: 17, YMIN: 18 };

// Mirror of world/urban/raster.js ROOF_RGB (linear, by RoofKind) — the exact roof colour the terrain
// texture paints for a building, so mass roofs fade in over the texture without a colour change.
const ROOF_RGB = [
  [0.80, 0.77, 0.70], [0.48, 0.50, 0.51], [0.88, 0.88, 0.84], [0.20, 0.23, 0.28], [0.17, 0.25, 0.11],
  [0.50, 0.58, 0.62], [0.64, 0.46, 0.33], [0.16, 0.17, 0.19], [0.38, 0.44, 0.30], [0.80, 0.82, 0.84],
];
const ROOF_NAMES = ['ceramic', 'metal', 'membrane', 'solar', 'garden', 'glass', 'warm', 'dark', 'terrace', 'insulated'];
const DIST_SEP = '.';

function parseDistrictKey(s) {
  // districtId(key) = face.level.x36.y36 → we only need a stable integer equal to the urban district
  // key; it is not exported, so the colour hash below uses the id fields through parseBuildingId.
  return s;
}

/**
 * Terrain-matching roof albedo of a spec (linear RGB): world/urban/raster.js exactInBlock roof colour
 * (ROOF_RGB[roofKind] × district tone × per-parcel factor) → world/surface.js gradeUrban (affine
 * urban grade) × parcel tone → 0.92 albedo clamp. Mirrors surface-3 (surfaceSample costs ~5 ms per
 * point, far too slow per building); the band-limited neighbourhood variation (mean preserving)
 * is left out.
 */
export function roofAlbedo(spec, parse) {
  const rk = Math.max(0, ROOF_NAMES.indexOf(String(spec.meta && spec.meta.roofKind || 'ceramic')));
  const rc = ROOF_RGB[rk] || ROOF_RGB[0];
  const tone = Number.isFinite(spec.meta && spec.meta.tone) ? spec.meta.tone : 0.5;
  let hv = 0;
  const p = parse ? parse(spec.id) : null;
  if (p) hv = hash4(p.dkey, p.i, p.j, 0x9a00 + p.k) & 0xffffff;
  const tm = (0.92 + 0.16 * tone) * (0.94 + 0.12 * ((hv >>> 8) & 255) / 255);
  let r = rc[0] * tm, g = rc[1] * tm, b = rc[2] * tm;
  // surface.js gradeUrban
  const gn = 0.82 * g + 0.09 * (r + b);
  const m = (r + gn + b) * (1 / 3);
  r = r * 1.14 + m * 0.30 + 0.014; g = gn * 1.12 + m * 0.30 + 0.013; b = b * 1.06 + m * 0.30 + 0.011;
  // parcel tone (resolved texels)
  const pid = hv || 1;
  const hh = hash4(pid, 91, 7, 0);
  const tv = ((hh & 1023) / 1023 - 0.5) * 0.16;
  r *= 1 + tv; g *= 1 + tv; b *= 1 + tv;
  return [Math.min(0.92, r), Math.min(0.92, g), Math.min(0.92, b)];
}

// tints of kit mass parts that are not the roof surface (parapet copings, slab lips, gable ends, soffits)
const KEEP_TINTS = [[0.8, 0.79, 0.76], [0.93, 0.92, 0.89], [0.92, 0.91, 0.88], [0.78, 0.77, 0.74]];
function keepTint(c, o) {
  for (const k of KEEP_TINTS) if (Math.abs(c[o] - k[0]) < 0.004 && Math.abs(c[o + 1] - k[1]) < 0.004 && Math.abs(c[o + 2] - k[2]) < 0.004) return true;
  return false;
}

/** Tile frame of a CityTileData: {o:{x,y,z} ECEF origin, e,u,s basis, h0} */
export function tileFrame(data) {
  const c = tileCenterUnit(data.face, data.level, data.x, data.y, {});
  const h0 = Math.round(((data.center && data.center.h) || 0) * 100) / 100;
  const B = enuBasisFromUnit(c.x, c.y, c.z, {});
  const r = R + h0;
  return { o: { x: c.x * r, y: c.y * r, z: c.z * r }, e: B.east, u: B.up, s: B.south, h0, c };
}

class Grow {
  constructor(T, n) { this.T = T; this.a = new T(n); this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new this.T(m); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  out() { return this.a.slice(0, this.n); }
}

/**
 * @param data CityTileData (generateCityTile)
 * @param generateBuilding buildings/index.js generateBuilding
 * @param parse urban parseBuildingId (for the roof colour hash) or null
 * @param opts {roofColor?(spec, ux, uy, uz) -> [r,g,b] linear} terrain-texture roof albedo provider
 */
export function buildTileMass(data, generateBuilding, parse, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const F = tileFrame(data);
  const E = F.e, U = F.u, S = F.s;
  const nB = data.buildings.length;
  const pos = new Grow(Float32Array, 1 << 16), nrm = new Grow(Int8Array, 1 << 16), uv = new Grow(Float32Array, 1 << 15);
  const col = new Grow(Uint8Array, 1 << 16), fac = new Grow(Uint16Array, 1 << 16), fid = new Grow(Uint16Array, 1 << 16);
  const bid = new Grow(Uint16Array, 1 << 14), idx = new Grow(Uint32Array, 1 << 16);
  const info = new Float32Array(Math.max(1, nB) * INFO_STRIDE);
  let nv = 0, tris = 0, errors = 0;
  const P = {}, Q = {};
  for (let bi = 0; bi < nB; bi++) {
    const spec = data.buildings[bi];
    let m;
    try { m = generateBuilding(spec, 'mass'); } catch (e) { errors++; continue; }
    // podium office towers: crown + sail fins (towerExtras) and the far family bits (farFamily)
    let fam = 0;
    try {
      const TL = officeTowerLayout(spec);
      if (TL) {
        fam = (TL.fam << 10) | (TL.crownK << 12) | (TL.fins ? 1 << 14 : 0);
        const ex = towerExtras(TL);
        if (ex) m = { ...m, parts: [...m.parts, ex] };
      }
    } catch { fam = 0; }
    // building frame in the tile frame
    const g = spec.ground || {};
    const ent = Number.isFinite(g.entrance) ? g.entrance : 0;
    latLonToUnit(spec.lat, spec.lon, P);
    const rr = R + ent;
    const dx = P.x * rr - F.o.x, dy = P.y * rr - F.o.y, dz = P.z * rr - F.o.z;
    const ox = dx * E[0] + dy * E[1] + dz * E[2], oy = dx * U[0] + dy * U[1] + dz * U[2], oz = dx * S[0] + dy * S[1] + dz * S[2];
    const A = buildingAxes(spec.lat, spec.lon, spec.heading || 0, Q);
    const T = (v) => [v[0] * E[0] + v[1] * E[1] + v[2] * E[2], v[0] * U[0] + v[1] * U[1] + v[2] * U[2], v[0] * S[0] + v[1] * S[1] + v[2] * S[2]];
    const ax = T(A.x), ay = T(A.y), az = T(A.z);
    // roof colour = the terrain texture's albedo at the roof (world/surface.js surfaceSample, passed
    // in by the worker handler) so mass roofs fade in over the texture-only city without a change
    let roofC = null;
    if (opts.roofColor) { try { roofC = opts.roofColor(spec, P.x, P.y, P.z); } catch { roofC = null; } }
    if (!roofC || !(roofC[0] + roofC[1] + roofC[2] > 0.05)) roofC = roofAlbedo(spec, parse);
    const rc8 = [clamp8(roofC[0]), clamp8(roofC[1]), clamp8(roofC[2])];
    const gmin = Number.isFinite(g.min) ? g.min - ent : 0;
    let minY = Infinity, maxY = -Infinity;
    let rmax2 = 0, ax0 = Infinity, ax1 = -Infinity, az0 = Infinity, az1 = -Infinity;
    const tri0 = idx.n / 3;
    for (const part of m.parts) {
      const isFacade = part.material === 'mass_facade';
      const p = part.position, n = part.normal, u = part.uv, c = part.color, cnt = p.length / 3;
      const fa = isFacade && part.attributes && part.attributes.facade ? part.attributes.facade.array : null;
      const fi = isFacade && part.attributes && part.attributes.facadeId ? part.attributes.facadeId.array : null;
      // lowest wall vertices are pushed 4 m further down (coarse displayed terrain never shows a gap)
      let pmin = Infinity;
      if (isFacade) for (let k = 0; k < cnt; k++) if (p[k * 3 + 1] < pmin) pmin = p[k * 3 + 1];
      pos.need(cnt * 3); nrm.need(cnt * 4); uv.need(cnt * 2); col.need(cnt * 4); fac.need(cnt * 4); fid.need(cnt * 4); bid.need(cnt);
      for (let k = 0; k < cnt; k++) {
        let x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
        let v = u[k * 2 + 1];
        if (isFacade && y <= pmin + 1e-3) { y -= 4; v -= 4; }
        const X = ox + x * ax[0] + y * ay[0] + z * az[0];
        const Y = oy + x * ax[1] + y * ay[1] + z * az[1];
        const Z = oz + x * ax[2] + y * ay[2] + z * az[2];
        const o3 = pos.n; pos.a[o3] = X; pos.a[o3 + 1] = Y; pos.a[o3 + 2] = Z; pos.n += 3;
        const nx = n[k * 3], ny = n[k * 3 + 1], nz = n[k * 3 + 2];
        const NX = nx * ax[0] + ny * ay[0] + nz * az[0], NY = nx * ax[1] + ny * ay[1] + nz * az[1], NZ = nx * ax[2] + ny * ay[2] + nz * az[2];
        const o4 = nrm.n; nrm.a[o4] = Math.round(NX * 127); nrm.a[o4 + 1] = Math.round(NY * 127); nrm.a[o4 + 2] = Math.round(NZ * 127); nrm.a[o4 + 3] = 0; nrm.n += 4;
        const o2 = uv.n; uv.a[o2] = u[k * 2]; uv.a[o2 + 1] = v; uv.n += 2;
        const oc = col.n;
        if (isFacade) { col.a[oc] = 255; col.a[oc + 1] = 255; col.a[oc + 2] = 255; col.a[oc + 3] = 255; }
        else if (ny > 0.8 && !part.keepColor && !keepTint(c, k * 3)) { col.a[oc] = rc8[0]; col.a[oc + 1] = rc8[1]; col.a[oc + 2] = rc8[2]; col.a[oc + 3] = 0; }
        else { col.a[oc] = clamp8(c[k * 3]); col.a[oc + 1] = clamp8(c[k * 3 + 1]); col.a[oc + 2] = clamp8(c[k * 3 + 2]); col.a[oc + 3] = 0; }
        col.n += 4;
        const of = fac.n;
        if (fa) {
          fac.a[of] = clampU16(fa[k * 4] * 100); fac.a[of + 1] = clampU16(fa[k * 4 + 1] * 100); fac.a[of + 2] = fa[k * 4 + 2] | 0; fac.a[of + 3] = clampU16(fa[k * 4 + 3] * 100);
          fid.a[of] = fi[k * 4] | 0; fid.a[of + 1] = fi[k * 4 + 1] | 0; fid.a[of + 2] = clampU16(fi[k * 4 + 2] * 10 + 1000); fid.a[of + 3] = ((fi[k * 4 + 3] | 0) & 0x3ff) | fam;
        } else {
          fac.a[of] = 0; fac.a[of + 1] = 0; fac.a[of + 2] = 0; fac.a[of + 3] = 0;
          fid.a[of] = (spec.hash >>> 16) & 0xffff; fid.a[of + 1] = spec.hash & 0xffff; fid.a[of + 2] = 1000; fid.a[of + 3] = 0;
        }
        fac.n += 4; fid.n += 4;
        bid.a[bid.n++] = bi;
        if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
        if (X < ax0) ax0 = X; if (X > ax1) ax1 = X; if (Z < az0) az0 = Z; if (Z > az1) az1 = Z;
        const ddx = X - ox, ddz = Z - oz; const d2 = ddx * ddx + ddz * ddz; if (d2 > rmax2) rmax2 = d2;
      }
      const I = part.index;
      idx.need(I.length);
      for (let k = 0; k < I.length; k++) idx.a[idx.n++] = I[k] + nv;
      nv += cnt; tris += I.length / 3;
    }
    const o = bi * INFO_STRIDE;
    const top = isFinite(maxY) ? maxY : oy + 10;
    const base = oy + gmin;
    info[o] = ox; info[o + 1] = (top + base) / 2; info[o + 2] = oz;
    const hh = top - base;
    info[o + 3] = Math.sqrt(rmax2 + (hh / 2) * (hh / 2));
    info[o + 4] = top; info[o + 5] = oy; info[o + 6] = hh;
    // building +x axis in the tile x/z plane
    const yl = Math.hypot(ax[0], ax[2]) || 1;
    info[o + 7] = ax[0] / yl; info[o + 8] = ax[2] / yl;
    info[o + 9] = (spec.footprint && spec.footprint.w) || 10; info[o + 10] = (spec.footprint && spec.footprint.d) || 10;
    info[o + 11] = base;
    info[o + 12] = tri0; info[o + 13] = idx.n / 3 - tri0;
    if (isFinite(ax0)) { info[o + 14] = ax0; info[o + 15] = ax1; info[o + 16] = az0; info[o + 17] = az1; info[o + 18] = minY; }
    else { info[o + 14] = ox; info[o + 15] = ox; info[o + 16] = oz; info[o + 17] = oz; info[o + 18] = base; }
  }
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    h0: F.h0,
    position: pos.out(), normal: nrm.out(), uv: uv.out(), color: col.out(), facade: fac.out(), facadeId: fid.out(), bidx: bid.out(), index: idx.out(),
    info, stats: { vertices: nv, triangles: tris, buildings: nB, errors, ms: Math.round((t1 - t0) * 10) / 10 },
  };
}

export function massTransferList(m) {
  return [m.position.buffer, m.normal.buffer, m.uv.buffer, m.color.buffer, m.facade.buffer, m.facadeId.buffer, m.bidx.buffer, m.index.buffer, m.info.buffer];
}

function clamp8(v) { const x = Math.round(v * 255); return x < 0 ? 0 : x > 255 ? 255 : x; }
function clampU16(v) { const x = Math.round(v); return x < 0 ? 0 : x > 65535 ? 65535 : x; }
export { parseTileKey, DIST_SEP, parseDistrictKey };
