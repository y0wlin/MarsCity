// Deterministic prop placement for one CITY_TILE_LEVEL tile (pure, worker-safe, no THREE).
// OWNER: props agent. Input: CityTileData (world/urban.js generateCityTile) + world functions.
// Output: compact Float32Arrays in the tile-local frame (x east, y up, z south, metres):
//   trees     stride 8  [x, y, z, rot, scale, species, tint, flags]   flags: 1 street, 2 deciduous
//   shrubs    stride 6  [x, y, z, rot, scale, kind]                   kind: 0 shrub, 1 flowering, 2 hardy/dwarf
//   lamps     stride 8  [x, y, z, rot(arm direction), kind, height, arm, bridge]
//             kind: 0 single-arm street lamp, 1 double-arm median lamp, 2 park post-top lamp
//   furniture stride 6  [x, y, z, rot, kind, var]   kind: 0 bench, 1 bollard, 2 bike rack, 3 planter,
//                                                         4 litter bin, 5 shelter
//   walks     polylines [{id, pts: Float32Array(xyz…), w, density}] sidewalk / plaza paths for people
//   idle      stride 7  [x, y, z, radius, count, kind, yaw]  kind: 0 plaza, 1 platform, 2 waterfront
//             (yaw: facing of platform / waterfront groups; model +z forward, yaw = atan2(fx, fz))
//   drives    polylines [{id, pts, cls, width, lanes, bridge}] streets / farm roads for vehicles
//   parks     stride 5  [x, y, z, rot, kind]  parked vehicles  kind: 0 car, 1 van, 2 rover
//   grid      Float32Array(GRID_N²) local ground y on a GRID_STEP lattice centred on the tile
// Species: 0 broadleaf A (layered street tree), 1 broadleaf B (wide), 2 ornamental blossom,
//          3 columnar poplar (canal belts), 4 conifer (cold), 5 small round ornamental
// Street cross-sections mirror render/city/streetBuild.js profileOf (kerb at ±cw, sidewalk +0.15 m).
import { R } from '../core/constants.js';
import { heightAt } from '../world/terrain.js';
import { sampleFields } from '../world/fields.js';
import * as HYDRO from '../world/hydro.js';
import * as RULES from '../world/urban/rules.js';
import * as CORR from '../world/urban/corridors.js';
import * as DCH from '../world/urban/dchunks.js';
import { hash4 } from '../core/hash.js';
import { tileFrame, frameUnit, ecefToFrame, strHash, mix32, u01, rng, clamp, smooth, cumLengths, pointAlong, pointInPoly, polyEdgeDist, segDist, polyArea, polyBounds } from './util.js';

export const GRID_N = 33, GRID_STEP = 25, GRID_HALF = ((GRID_N - 1) / 2) * GRID_STEP;
export const PLACE_VERSION = 'props-place-7';
// public entrances with canopy downlights (night light pools under the entrance canopies, lights.js)
const CANOPY_USES = new Set(['station', 'ferry_terminal', 'clinic', 'school', 'market', 'civic_tower', 'community', 'office', 'research']);
const SIDEWALK_Y = 0.16;
// crown envelope per species (models.js SPECIES: total height, trunk / crown base, crown radius; × scale)
const CROWN = [[8.6, 2.7, 3.1], [9.8, 2.5, 4.1], [5.2, 1.5, 2.5], [14.5, 1.4, 1.7], [10.5, 0.9, 2.5], [4.6, 1.35, 1.95]];
// residential facades looking at a station keep their 2F view to the platform canopies (§5 07 定格三)
const RES_USES = new Set(['residential', 'residential_tower', 'shop_row', 'dorm']);
const VIEW_REACH = 200;     // m from a facade to a platform point
const VIEW_NEAR = 48;       // m along a sight line within which crowns are pruned (farther foliage stays)
const AXIS_DEPTH = 14;      // m in front of the facade: no crown above the window-axis line

// fallback copy of urban/rules.js CLASS (street, coll, walk, trees) in DC order
const CLASS_FALLBACK = [
  [0, 0, 0, 0], [9, 13, 1.5, 0], [13, 20, 2.5, 1], [17, 25, 3.5, 1], [19, 28, 5, 2], [20, 26, 2, 0], [22, 28, 2, 0],
  [16, 22, 3.5, 2], [0, 0, 0, 0], [18, 24, 2, 0], [7, 9, 0, 0], [8, 10, 0.5, 0], [11, 15, 2, 1], [9, 12, 0, 0], [0, 0, 0, 0],
];
const CLS_NAMES = ['wild', 'rural', 'low', 'mid', 'core', 'industrial', 'port', 'campus', 'park', 'logistics', 'farm', 'greenhouse', 'otown', 'polar', 'outpost'];
function classTable() {
  const out = [];
  const C = RULES.CLASS;
  if (Array.isArray(C) && C.length >= 10 && C[1] && 'street' in C[1]) {
    for (let i = 0; i < C.length; i++) out.push({ id: i, name: CLS_NAMES[i] || String(i), street: C[i].street || 0, coll: C[i].coll || 0, walk: C[i].walk ?? C[i].sidewalk ?? 0, trees: C[i].trees || 0 });
  } else {
    for (let i = 0; i < CLASS_FALLBACK.length; i++) { const c = CLASS_FALLBACK[i]; out.push({ id: i, name: CLS_NAMES[i], street: c[0], coll: c[1], walk: c[2], trees: c[3] }); }
  }
  return out;
}
const CLASSES = classTable();

/** road cross-section as drawn by the city (render/city/streetBuild.js profileOf) */
export function roadProfile(r) {
  const w = Math.max(2.5, r.width || 8), cls = r.cls || 'local';
  if (cls === 'lane') return { kind: 'lane', w, cw: w / 2, sw: 0, median: 0 };
  if (cls === 'farm' || cls === 'levee' || cls === 'service') return { kind: 'rural', w, cw: Math.max(1.5, w / 2 - 1.0), sw: 0, median: 0 };
  if (cls === 'highway') return { kind: 'highway', w, cw: w / 2 - 0.8, sw: 0, median: w >= 18 ? 2.4 : 0 };
  const sw = cls === 'boulevard' ? Math.min(6, Math.max(3.5, w * 0.12)) : cls === 'arterial' ? Math.min(5, Math.max(3, w * 0.15)) : Math.min(3.6, Math.max(1.8, w * 0.2));
  const cw = Math.max(2.5, w / 2 - sw);
  const median = cls === 'boulevard' ? Math.min(8, Math.max(3, w * 0.12)) : (cls === 'arterial' && w >= 30 ? 2.5 : 0);
  return { kind: 'urban', w, cw, sw, median };
}

/** district class of a grid street from its width (urban rules: street / collector width per class) */
function streetClass(road, zone) {
  if (road.cls !== 'local' && road.cls !== 'collector') return null;
  const key = road.cls === 'local' ? 'street' : 'coll';
  const W = road.width || 0;
  let best = null;
  for (const c of CLASSES) {
    if (Math.abs(c[key] - W) > 0.01) continue;
    const isO = c.name === 'farm' || c.name === 'greenhouse' || c.name === 'otown' || c.name === 'polar';
    const score = ((zone === 'O') === isO ? 2 : 1) + c.trees * 0.1;
    if (!best || score > best.s) best = { c, s: score };
  }
  return best ? best.c : null;
}

// ---------------------------------------------------------------------------------------------
// spatial hash of obstacles (buildings, roads)
// ---------------------------------------------------------------------------------------------
class Grid2 {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return (i + 4096) * 8192 + (j + 4096); }
  add(x0, z0, x1, z1, item) {
    const c = this.cell;
    const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(z0 / c), j1 = Math.floor(z1 / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j); let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); } a.push(item);
    }
  }
  query(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || null; }
}

/**
 * placeTile(data) -> placement result (see header). Pure: same data -> same output.
 * opts.grid: optional precomputed height grid.
 */
export function placeTile(data, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const F = tileFrame(data.face, data.x, data.y);
  const key = data.key;
  const Q = {};
  // ---- climate ------------------------------------------------------------------------------
  const fields = sampleFields(F.c.x, F.c.y, F.c.z, {});
  const lat = fields.lat, alat = Math.abs(lat);
  const prov = fields.province, zone = fields.zone;
  const code = ['', 'OX1', 'OX2', 'OX3', 'OX4', 'OX5', 'OX6', 'ZR1', 'ZR2', 'ZR3', 'ZR4', 'ZR5', 'ZR6'][prov] || '';
  const polar = code === 'OX4' || code === 'OX6' || alat > 62;
  const coldValley = code === 'ZR6';
  const cold = smooth(42, 64, alat);
  const iceAll = fields.ice > 0.55;
  // drier / colder → sparser and hardier (§3 植被遵循水分、季节、风向和维护范围)
  const dry = code === 'ZR3' ? 0.85 : code === 'ZR2' ? 0.9 : 1;
  const vegDensity = iceAll ? 0 : polar ? 0.22 : coldValley ? 0.45 : (1 - 0.45 * cold) * dry;
  const conifShare = clamp(cold * 1.2 + (polar ? 1 : 0) + (coldValley ? 0.6 : 0), 0, 1);

  // ---- height grid ---------------------------------------------------------------------------
  const grid = opts.grid || new Float32Array(GRID_N * GRID_N);
  if (!opts.grid) {
    for (let j = 0; j < GRID_N; j++) for (let i = 0; i < GRID_N; i++) {
      const x = -GRID_HALF + i * GRID_STEP, z = -GRID_HALF + j * GRID_STEP;
      frameUnit(F, x, z, Q);
      const h = heightAt(Q.x, Q.y, Q.z, 2);
      grid[j * GRID_N + i] = h - (x * x + z * z) / (2 * R);
    }
  }
  const groundY = (x, z) => {
    let fi = (x + GRID_HALF) / GRID_STEP, fj = (z + GRID_HALF) / GRID_STEP;
    fi = clamp(fi, 0, GRID_N - 1.0001); fj = clamp(fj, 0, GRID_N - 1.0001);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const o = j * GRID_N + i;
    return (grid[o] * (1 - u) + grid[o + 1] * u) * (1 - v) + (grid[o + GRID_N] * (1 - u) + grid[o + GRID_N + 1] * u) * v;
  };
  /** exact ground (2 m band limit) for props that must sit on small features */
  const groundExact = (x, z) => { frameUnit(F, x, z, Q); return heightAt(Q.x, Q.y, Q.z, 2) - (x * x + z * z) / (2 * R); };
  const W = { type: 0, level: 0, depth: 0 };
  const waterTypeAt = (x, z) => { try { frameUnit(F, x, z, Q); HYDRO.waterAt(Q.x, Q.y, Q.z, W); return W.type && W.depth > 0.05 ? W.type : 0; } catch (e) { return 0; } };

  // ---- obstacles -----------------------------------------------------------------------------
  const bgrid = new Grid2(16);
  const egrid = new Grid2(16);
  const resB = [];
  for (const b of data.buildings || []) {
    if (b.lat === undefined) continue;
    const cosl = Math.cos(b.lat * Math.PI / 180);
    const ux = cosl * Math.sin(b.lon * Math.PI / 180), uy = Math.sin(b.lat * Math.PI / 180), uz = cosl * Math.cos(b.lon * Math.PI / 180);
    const dx = ux * R - F.ox, dy = uy * R - F.oy, dz = uz * R - F.oz;
    const cx = F.E[0] * dx + F.E[1] * dy + F.E[2] * dz, cz = F.S[0] * dx + F.S[1] * dy + F.S[2] * dz;
    const h = (b.heading || 0) * Math.PI / 180;
    const fx = Math.sin(h), fz = -Math.cos(h);          // front normal in local (x,z)
    let w = (b.footprint && b.footprint.w) || 12, d = (b.footprint && b.footprint.d) || 12;
    const round = b.footprint && (b.footprint.shape === 'round' || b.footprint.shape === 'circle');
    const pod = b.meta && b.meta.podium; if (pod && pod.w) { w = Math.max(w, pod.w); d = Math.max(d, pod.d || d); }
    // roof height (tile-local y) for sight-line occlusion; stations never occlude their own platforms
    const drop = (cx * cx + cz * cz) / (2 * R);
    const ent = b.ground && Number.isFinite(b.ground.entrance) ? b.ground.entrance : NaN;
    const bh = (b.meta && b.meta.height) || ((b.floors || 1) * (b.floorHeight || 3.1) + Math.max(0, (b.groundFloorHeight || 0) - (b.floorHeight || 3.1)));
    const rec = { cx, cz, fx, fz, hw: w / 2, hd: d / 2, round, r: Math.max(w, d) / 2, top: Number.isFinite(ent) ? ent + bh - drop : Infinity, station: b.use === 'station' };
    const ext = Math.hypot(w, d) / 2 + 3;
    bgrid.add(cx - ext, cz - ext, cx + ext, cz + ext, rec);
    if (RES_USES.has(b.use) && !round && (b.floors || 0) >= 2 && Number.isFinite(ent)) {
      // 2F eye line (tile-local y: height minus the curvature drop, like the placement grid)
      const gfh = b.groundFloorHeight || b.floorHeight || 3.1;
      resB.push({ rec, cx, cz, fx, fz, hw: ((b.footprint && b.footprint.w) || w) / 2, hd: ((b.footprint && b.footprint.d) || d) / 2, eyeY: ent + gfh + 1.6 - drop });
    }
    // front entrances keep a clear zone on the sidewalk (no street tree right in front of a door)
    const fd = (b.footprint && b.footprint.d) || d;
    for (const e of b.entrances || []) {
      if (e.side !== 'front' || !(e.kind === 'main' || e.kind === 'shop' || e.kind === 'ferry')) continue;
      const ex = cx + fx * fd / 2 + fz * (e.offset || 0), ez = cz + fz * fd / 2 - fx * (e.offset || 0);
      const er = Math.max(3.2, (e.width || 1.5) / 2 + 2.6);
      egrid.add(ex - er - 8, ez - er - 8, ex + er + 8, ez + er + 8, { x: ex, z: ez, r: er, fx, fz });
    }
  }
  // water works (urban meta.water: sluice stations, canal pumphouses, meltwater pumps; pool / intake on the back
  // facade unless meta.poolSide / intakeSide says otherwise): no tree between that facade and the canal bank
  // (building frame: out of the facade up to meta.water.dist − width / 2) nor 12 m beyond either end, so the
  // control-room / walkway views over the pool stay open (fix round 3, P3: S07O control bay)
  const wzones = [];
  for (const b of data.buildings || []) {
    const m = b.meta, Wm = m && m.water;
    if (!Wm || b.lat === undefined || !Number.isFinite(+Wm.dist)) continue;
    const cosl = Math.cos(b.lat * Math.PI / 180);
    const ux = cosl * Math.sin(b.lon * Math.PI / 180), uy = Math.sin(b.lat * Math.PI / 180), uz = cosl * Math.cos(b.lon * Math.PI / 180);
    const dx = ux * R - F.ox, dy = uy * R - F.oy, dz = uz * R - F.oz;
    const cx = F.E[0] * dx + F.E[1] * dy + F.E[2] * dz, cz = F.S[0] * dx + F.S[1] * dy + F.S[2] * dz;
    const h = (b.heading || 0) * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h);
    const w = (b.footprint && b.footprint.w) || 12, d = (b.footprint && b.footprint.d) || 12;
    const side = ['back', 'front', 'left', 'right'].includes(m.poolSide) ? m.poolSide : ['back', 'front', 'left', 'right'].includes(m.intakeSide) ? m.intakeSide : 'back';
    const fb = side === 'back' || side === 'front';
    const half = fb ? d / 2 : w / 2, hw = fb ? w / 2 : d / 2;
    const reach = Math.max(half + 3, +Wm.dist - (+Wm.width || 16) / 2 + 1);
    // outward unit of the water facade (building +z = front normal (fx, fz), +x = right = (-fz, fx))
    const ox = side === 'back' ? -fx : side === 'front' ? fx : side === 'left' ? fz : -fz;
    const oz = side === 'back' ? -fz : side === 'front' ? fz : side === 'left' ? -fx : fx;
    wzones.push({ cx, cz, ox, oz, half, hw: hw + 12, reach });
  }
  const onWaterSide = (x, z) => {
    for (const q of wzones) {
      const px = x - q.cx, pz = z - q.cz;
      const out = px * q.ox + pz * q.oz;
      if (out > q.half - 0.5 && out < q.reach && Math.abs(-px * q.oz + pz * q.ox) < q.hw) return true;
    }
    return false;
  };
  // entrance canopy downlights: [x, y, z, nx, nz, width] (tile frame), 4 m in front of the main entrances (the pool
  // spills over the entrance steps / terrace edge)
  const elights = [];
  for (const b of data.buildings || []) {
    if (!CANOPY_USES.has(b.use) || b.lat === undefined || !b.ground || !Number.isFinite(b.ground.entrance)) continue;
    const cosl = Math.cos(b.lat * Math.PI / 180);
    const ux = cosl * Math.sin(b.lon * Math.PI / 180), uy = Math.sin(b.lat * Math.PI / 180), uz = cosl * Math.cos(b.lon * Math.PI / 180);
    const dx = ux * R - F.ox, dy = uy * R - F.oy, dz = uz * R - F.oz;
    const cx = F.E[0] * dx + F.E[1] * dy + F.E[2] * dz, cz = F.S[0] * dx + F.S[1] * dy + F.S[2] * dz;
    const h = (b.heading || 0) * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h);
    const fd = (b.footprint && b.footprint.d) || 12;
    const drop = (cx * cx + cz * cz) / (2 * R);
    const cy = b.ground.entrance - drop + Math.min(5.4, Math.max(3.1, (b.groundFloorHeight || b.floorHeight || 4.5) - 0.5));
    for (const e of b.entrances || []) {
      if (e.side !== 'front' || !(e.kind === 'main' || e.kind === 'ferry' || e.kind === 'shop')) continue;
      const off = e.offset || 0;
      elights.push(cx + fx * (fd / 2 + 4.0) + fz * off, cy, cz + fz * (fd / 2 + 4.0) - fx * off, fx, fz, Math.max(2, e.width || 2));
    }
  }
  const inBuilding = (x, z, m) => {
    const list = bgrid.query(x, z); if (!list) return false;
    for (const b of list) {
      const px = x - b.cx, pz = z - b.cz;
      if (b.round) { if (px * px + pz * pz < (b.r + m) * (b.r + m)) return true; continue; }
      const a = px * b.fx + pz * b.fz, c = -px * b.fz + pz * b.fx;
      if (Math.abs(a) < b.hd + m && Math.abs(c) < b.hw + m) return true;
    }
    return false;
  };
  /** within the clear zone in front of a building entrance (measured along the facade, any distance out to 9 m) */
  const nearEntrance = (x, z) => {
    const list = egrid.query(x, z); if (!list) return false;
    for (const e of list) {
      const px = x - e.x, pz = z - e.z;
      const out = px * e.fx + pz * e.fz, along = -px * e.fz + pz * e.fx;
      if (out > -1 && out < 9 && Math.abs(along) < e.r) return true;
    }
    return false;
  };
  const rgrid = new Grid2(16);
  const roads = [];
  for (const r of data.roads || []) {
    if (!r.points || r.points.length < 2) continue;
    const P = roadProfile(r);
    const rec = { r, P, half: P.w / 2, carriage: P.cw, id: r.id, pts: r.points, L: cumLengths(r.points) };
    roads.push(rec);
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      const m = rec.half + 2;
      rgrid.add(Math.min(a[0], b[0]) - m, Math.min(a[2], b[2]) - m, Math.max(a[0], b[0]) + m, Math.max(a[2], b[2]) + m, { rec, ax: a[0], az: a[2], bx: b[0], bz: b[2] });
    }
  }
  for (const rl of data.rails || []) {
    if (!rl.points || rl.points.length < 2 || rl.elevated) continue;
    const half = rl.tracks >= 2 ? 8.5 : 5;
    const rec = { half, carriage: half, id: rl.id, rail: true };
    for (let i = 1; i < rl.points.length; i++) {
      const a = rl.points[i - 1], b = rl.points[i];
      rgrid.add(Math.min(a[0], b[0]) - half - 2, Math.min(a[2], b[2]) - half - 2, Math.max(a[0], b[0]) + half + 2, Math.max(a[2], b[2]) + half + 2, { rec, ax: a[0], az: a[2], bx: b[0], bz: b[2] });
    }
  }
  /** true when (x,z) lies on a road / rail other than `self` (full width + m, or carriageway only) */
  const onRoad = (x, z, m, self, carriageOnly) => {
    const list = rgrid.query(x, z); if (!list) return false;
    for (const s of list) {
      if (self && s.rec === self) continue;
      const lim = (carriageOnly ? s.rec.carriage : s.rec.half) + m;
      if (segDist(x, z, s.ax, s.az, s.bx, s.bz) < lim) return true;
    }
    return false;
  };

  /** inside an at-grade rail corridor (tracks / platforms) */
  const onRail = (x, z, m = 1.5) => {
    const list = rgrid.query(x, z); if (!list) return false;
    for (const s of list) if (s.rec.rail && segDist(x, z, s.ax, s.az, s.bx, s.bz) < s.rec.half + m) return true;
    return false;
  };
  /** people may walk here (not inside buildings, not across the rail corridor) */
  const walkable = (x, z) => !inBuilding(x, z, 0.3) && !onRail(x, z);
  const trees = [], shrubs = [], lamps = [], furn = [], walks = [], idle = [], drives = [], parks = [];
  const P = {};
  const speciesStreet = (h) => { const u = u01(h); if (conifShare > 0.6) return 4; return u < 0.62 ? 0 : u < 0.9 ? 1 : 5; };
  const speciesPark = (h) => {
    const u = u01(h);
    if (u < conifShare * 0.8) return 4;
    const v = u01(mix32(h, 77));
    return v < 0.42 ? 0 : v < 0.62 ? 1 : v < 0.78 ? 2 : v < 0.9 ? 5 : 3;
  };
  const addTree = (x, y, z, sp, h, flags, sc = 1) => {
    if (wzones.length && onWaterSide(x, z)) return;
    const r = rng(h);
    const scale = sc * (0.82 + r() * 0.36) * (polar ? 0.75 : 1);
    const deciduous = sp === 0 || sp === 1 || sp === 2 || sp === 3 || sp === 5 ? 2 : 0;
    trees.push(x, y, z, r() * Math.PI * 2, scale, sp, r(), flags | deciduous);
  };
  const isWet = (y) => y < 0.35;
  const yawOf = (dx, dz) => Math.atan2(dx, dz);
  /** bench on the exact ground (QZ2-09: a bench set level on a slope buried one end): the four feet (legs at ±0.72 m
   *  along / −0.225, +0.185 m across the seat, yaw rot as tiles.js applies it) -> level on the highest foot + base,
   *  NaN (no bench) where the feet differ by more than 7 cm */
  const benchY = (x, z, rot, base) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    let lo = 1e9, hi = -1e9;
    for (const [lx, lz] of [[-0.72, -0.225], [0.72, -0.225], [-0.72, 0.185], [0.72, 0.185]]) {
      const g = groundExact(x + lx * c + lz * s, z - lx * s + lz * c);
      if (g < lo) lo = g; if (g > hi) hi = g;
    }
    return hi - lo > 0.07 ? NaN : hi + base;
  };

  // ---- streets: tree pits, lamps, benches, sidewalks -------------------------------------------
  for (const rec of roads) {
    const r = rec.r, PR = rec.P, pts = rec.pts, L = rec.L, len = L[L.length - 1];
    if (len < 4) continue;
    const rh = strHash(r.id || '');
    const urban = PR.kind === 'urban';
    const klass = streetClass(r, zone);
    const treeLevel = r.cls === 'boulevard' ? 2 : r.cls === 'arterial' ? (PR.w >= 30 ? 2 : 1) : klass ? klass.trees : 0;
    const zStreet = urban && (zone === 'Z' || (klass && klass.name === 'otown') || r.cls === 'boulevard' || r.cls === 'arterial');
    // along-street phase: grid street ids carry the plane coordinate of the piece start, so the
    // rhythm of trees / lamps continues across tile seams
    let phase0 = 0;
    const m = /:([uv])(-?\d+)([sn]?):(-?\d+)/.exec(r.id || '');
    if (m) phase0 = +m[4];
    // drives (vehicles)
    if (r.cls !== 'lane' && len > 25) {
      const fp = new Float32Array(pts.length * 3);
      for (let i = 0; i < pts.length; i++) { fp[i * 3] = pts[i][0]; fp[i * 3 + 1] = pts[i][1]; fp[i * 3 + 2] = pts[i][2]; }
      drives.push({ id: r.id, pts: fp, cls: r.cls, width: PR.w, lanes: Math.max(1, Math.floor((PR.cw - PR.median / 2 - 0.6) / 3.4)), bridge: !!r.bridge });
    }
    // ---- lamps ----
    let spacing = 0, lampH = 6.5, sides = 1;
    if (r.cls === 'boulevard') { spacing = 30; lampH = 10; sides = 2; }
    else if (r.cls === 'arterial') { spacing = 32; lampH = 9.5; sides = 2; }
    else if (r.cls === 'collector') { spacing = 30; lampH = 8; sides = PR.w >= 20 ? 2 : 1; }
    else if (r.cls === 'local') { spacing = 30; lampH = 6.5; sides = 1; }
    else if (r.cls === 'highway') { spacing = 44; lampH = 11; sides = PR.median > 0 ? 0 : 1; }
    else if (r.cls === 'service' && zone === 'Z') { spacing = 50; lampH = 7; sides = 1; }
    else if ((r.cls === 'levee' || r.cls === 'farm' || r.cls === 'service') && r.bridge) { spacing = 26; lampH = 5.6; sides = 2; }
    if (zone === 'O' && (r.cls === 'local' || r.cls === 'collector') && !(klass && klass.name === 'otown')) spacing = r.bridge ? 26 : 0;
    if (polar && r.cls !== 'highway') spacing = spacing ? Math.max(spacing, 45) : 0;
    if (r.covered) spacing = 0;                          // ZR6 warm corridors carry their own lights
    const bridgeHalf = r.bridge ? (PR.sw > 0 ? PR.w / 2 + 0.6 : PR.w / 2 + 0.6) : 0;
    const lampOff = r.bridge ? bridgeHalf - 0.45 : urban ? PR.cw + 0.5 : PR.w / 2 + 0.6;
    const lampY = r.bridge ? 0.18 : urban ? SIDEWALK_Y : 0;
    const lampAlong = (side, k0) => {
      const st = sides === 2 && side > 0 ? spacing / 2 : 0;
      return ((k0 - st + phase0) % spacing + spacing) % spacing;
    };
    if (spacing > 0) {
      const first = ((-phase0 % spacing) + spacing) % spacing;
      const sideList = sides === 0 ? [] : sides === 2 ? [-1, 1] : [(rh & 1) ? 1 : -1];
      for (const side of sideList) {
        const stagger = sides === 2 && side > 0 ? spacing / 2 : 0;
        for (let s = first + stagger + 1.5; s < len - 1.5; s += spacing) {
          pointAlong(pts, L, s, P);
          const nx = -P.tz, nz = P.tx;              // right of the polyline direction
          const x = P.x + nx * side * lampOff, z = P.z + nz * side * lampOff;
          if (onRoad(x, z, 0.6, rec, false) || inBuilding(x, z, 0.4)) continue;
          const y = P.y + lampY;
          if (!r.bridge && isWet(y)) continue;
          lamps.push(x, y, z, yawOf(-nx * side, -nz * side), 0, lampH, clamp(PR.cw * 0.3, 1.0, 2.6), r.bridge ? 1 : 0);
        }
      }
      if (PR.median >= 2.4 && (r.cls === 'boulevard' || r.cls === 'highway' || (r.cls === 'arterial' && PR.median >= 2.5))) {
        // double-arm lamps in the median
        const sp2 = r.cls === 'highway' ? spacing : spacing;
        for (let s = first + 1.5 + sp2 / 4; s < len - 1.5; s += sp2) {
          pointAlong(pts, L, s, P);
          if (onRoad(P.x, P.z, 0.5, rec, false)) continue;
          lamps.push(P.x, P.y + 0.2, P.z, yawOf(P.tx, P.tz), 1, r.cls === 'highway' ? 12 : 11, 2.6, 0);
        }
      }
    }
    // ---- street trees (tree pits in the sidewalk furniture zone, every 7–9 m) + benches ----
    if (zStreet && treeLevel > 0 && PR.sw >= 3.0 && !r.bridge && !r.covered && vegDensity > 0.12) {
      const spacingT = treeLevel >= 2 ? 7 + (rh % 2) : 8 + (rh % 3);   // 7..10 m
      const pitOff = PR.cw + Math.min(1.35, PR.sw * 0.3);
      const first = ((-phase0 % spacingT) + spacingT) % spacingT + spacingT * 0.5;
      const spStreet = speciesStreet(mix32(rh, 3));
      const rowSides = [-1, 1];
      for (const side of rowSides) {
        let k = 0;
        for (let s = first; s < len - 2; s += spacingT, k++) {
          // keep 3 m clear of the lamp posts of this side
          if (spacing > 0 && (sides === 2 || side === ((rh & 1) ? 1 : -1))) {
            const dl = lampAlong(side, s - 1.5);
            if (dl < 3 || dl > spacing - 3) continue;
          }
          pointAlong(pts, L, s, P);
          const nx = -P.tz, nz = P.tx;
          const x = P.x + nx * side * pitOff, z = P.z + nz * side * pitOff;
          if (onRoad(x, z, 1.4, rec, false) || inBuilding(x, z, 1.6) || nearEntrance(x, z)) continue;
          const hh = mix32(rh, (k * 7 + (side + 2) * 131071) | 0);
          if (u01(mix32(hh, 9)) > 0.93 + 0.07 * vegDensity - (1 - vegDensity) * 0.3) continue;  // occasional gap / young pit
          const y = P.y + SIDEWALK_Y;
          if (isWet(y)) continue;
          addTree(x, y, z, spStreet, hh, 1, treeLevel >= 2 ? 1.05 : 0.92);
          // bench in every 4th gap (furniture zone), facing away from the road; bins beside some
          if ((k & 3) === 1 && PR.sw >= 3.4) {
            pointAlong(pts, L, s + spacingT / 2, P);
            const bx = P.x + nx * side * pitOff, bz = P.z + nz * side * pitOff;
            // sloping sidewalk (QZ2-09): the bench's two leg frames (±0.72 m along the street) on the graded
            // sidewalk; no bench where they differ by more than 7 cm, else level on the higher one (none buried)
            const sB = s + spacingT / 2, PB = {};
            pointAlong(pts, L, sB - 0.72, PB); const ya = PB.y; pointAlong(pts, L, sB + 0.72, PB); const yb = PB.y;
            if (!onRoad(bx, bz, 0.8, rec, false) && !inBuilding(bx, bz, 0.8) && Math.abs(ya - yb) <= 0.07) {
              const rot = yawOf(nx * side, nz * side);
              furn.push(bx, Math.max(ya, yb) + SIDEWALK_Y, bz, rot, 0, u01(hh) * 4 | 0);
              if ((k & 7) === 1) furn.push(bx + P.tx * 1.5, P.y + SIDEWALK_Y, bz + P.tz * 1.5, rot, 4, 0);
            }
          }
        }
      }
      // boulevard median: a row of large broadleaf trees in the planting strip
      if (PR.median >= 4 && r.cls === 'boulevard') {
        let k = 0;
        for (let s = first + spacingT * 0.5; s < len - 2; s += spacingT + 1, k++) {
          const dl = ((s + phase0 - spacing / 4 - 1.5) % spacing + spacing) % spacing;
          if (spacing > 0 && (dl < 3.5 || dl > spacing - 3.5)) continue;
          pointAlong(pts, L, s, P);
          if (onRoad(P.x, P.z, 1.0, rec, false)) continue;
          const hh = mix32(rh, k * 913 + 5);
          addTree(P.x, P.y + 0.2, P.z, 1, hh, 1, 1.1);
        }
      }
    }
    // ---- sidewalks for pedestrians ----
    if (zStreet && PR.sw >= 1.8 && !r.covered) {
      // walking strip of the paved sidewalk the city draws (kerb top cw..cw+0.16, sidewalk cw+0.16..w/2 with
      // 1 % crossfall; render/city/streetBuild.js road()) outside the furniture zone (tree pits, benches,
      // lamp posts); walkers keep within it (people.js lateral spread)
      const treeRow = treeLevel > 0 && PR.sw >= 3.0 && !r.bridge && vegDensity > 0.12;
      const inner = PR.cw + (treeRow ? Math.min(1.35, PR.sw * 0.3) + 0.75 : 0.85), outer = PR.w / 2 - 0.2;
      const pw = Math.max(0.4, outer - inner), off = Math.min((inner + outer) / 2, outer);
      const lift = r.bridge ? 0.18 : 0.15 + 0.01 * (off - PR.cw) + 0.02;
      for (const side of [-1, 1]) {
        const fp = new Float32Array(pts.length * 3);
        let ok = true;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          let tx = b[0] - a[0], tz = b[2] - a[2]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          fp[i * 3] = pts[i][0] - tz * off * side; fp[i * 3 + 1] = pts[i][1] + lift; fp[i * 3 + 2] = pts[i][2] + tx * off * side;
          if (isWet(pts[i][1]) && !r.bridge) ok = false;
        }
        const dens = r.cls === 'boulevard' ? 1.0 : r.cls === 'arterial' ? 0.75 : klass && klass.name === 'core' ? 0.9 : klass && klass.name === 'mid' ? 0.6 : 0.4;
        // only where the paving is really visible: the terrain mesh rises above the sidewalk on some banks
        // (people then walked on the grass that covers it)
        const paved = (x, z, y) => walkable(x, z) && (r.bridge || groundExact(x, z) < y - lift + 0.17);
        if (ok) for (const run of splitWalk(fp, paved)) walks.push({ id: `${r.id}:${side}:${run.k}`, pts: run.pts, w: pw, density: dens * (zone === 'O' ? 0.5 : 1) });
      }
    }
    // ---- canal-bank tree belts (渠岸林带) along levee roads; windbreaks along some farm roads ----
    if ((r.cls === 'levee' || r.cls === 'farm') && !r.bridge && vegDensity > 0.1) {
      const isLevee = r.cls === 'levee';
      if (!isLevee && u01(mix32(rh, 21)) > 0.33) continue;
      pointAlong(pts, L, len / 2, P);
      const nx = -P.tz, nz = P.tx;
      // canal side: hydro water beside the road (fallback: the lower bank)
      let canalSide = 0;
      if (isLevee) {
        const wp = waterTypeAt(P.x + nx * 13, P.z + nz * 13), wm = waterTypeAt(P.x - nx * 13, P.z - nz * 13);
        if (wp && !wm) canalSide = 1; else if (wm && !wp) canalSide = -1;
        else canalSide = groundY(P.x + nx * 14, P.z + nz * 14) < groundY(P.x - nx * 14, P.z - nz * 14) ? 1 : -1;
      } else canalSide = (rh >>> 4) & 1 ? 1 : -1;
      const rows = isLevee ? [[canalSide, PR.w / 2 + 2.6, 6.5, polar ? 4 : 3]] : [[canalSide, PR.w / 2 + 2.2, 8, polar ? 4 : (u01(mix32(rh, 5)) < 0.5 ? 3 : 0)]];
      // main canals: a second, field-side belt of broadleaf trees
      if (isLevee && u01(mix32(rh, 23)) < 0.55) rows.push([-canalSide, PR.w / 2 + 3.0, 9, polar ? 4 : (u01(mix32(rh, 24)) < 0.5 ? 0 : 1)]);
      for (let ri = 0; ri < rows.length; ri++) {
        const [side, off, spacingB, sp] = rows[ri];
        let k = 0;
        for (let s = 3 + (rh % 5) + ri * 2.5; s < len - 3; s += spacingB, k++) {
          pointAlong(pts, L, s, P);
          const x = P.x - P.tz * off * side, z = P.z + P.tx * off * side;
          if (onRoad(x, z, 1.0, rec, false) || inBuilding(x, z, 2)) continue;
          const y = groundExact(x, z);
          if (isWet(y) || y < P.y - 3 || waterTypeAt(x, z)) continue;
          const hh = mix32(rh, k * 31 + 7 + ri * 7777);
          if (u01(hh) > 0.92 * vegDensity + 0.04) continue;
          addTree(x, y, z, sp, hh, 0, sp === 3 ? 1.0 : 0.95);
          if (ri === 0 && (k % 3) === 0) shrubs.push(x + P.tx * 3, y, z + P.tz * 3, u01(hh) * 6.28, 0.8 + u01(mix32(hh, 3)) * 0.5, polar ? 2 : 0);
        }
      }
    }
  }

  // ---- areas ---------------------------------------------------------------------------------
  for (const a of data.areas || []) {
    const poly = a.polygon;
    if (!poly || poly.length < 3) continue;
    const ah = strHash(a.id || '');
    const area = polyArea(poly);
    const bb = polyBounds(poly);
    const kind = a.kind;
    const R2 = rng(ah);
    const inside = (x, z, inset) => pointInPoly(poly, x, z) && polyEdgeDist(poly, x, z) > inset;
    const freeAt = (x, z, mb, mr) => !inBuilding(x, z, mb) && !onRoad(x, z, mr, null, false);
    const scatter = (spacing, inset, fn) => {
      // jittered lattice aligned to the tile frame (deterministic per area)
      const ox = bb.x0 + R2() * spacing, oz = bb.z0 + R2() * spacing;
      let n = 0;
      for (let z = oz; z < bb.z1; z += spacing) for (let x = ox; x < bb.x1; x += spacing) {
        const hh = mix32(ah, (Math.round(x * 4) * 73856093) ^ (Math.round(z * 4) * 19349663));
        const jx = x + (u01(hh) - 0.5) * spacing * 0.8, jz = z + (u01(mix32(hh, 1)) - 0.5) * spacing * 0.8;
        if (!inside(jx, jz, inset)) continue;
        if (fn(jx, jz, hh, n++) === false) return;
      }
    };
    if (kind === 'park' || kind === 'green') {
      // the gravel / paved paths the city draws on this green (render/city/streetBuild.js parkPaths)
      const PP = cityParkPaths(poly);
      const onPath = (x, z, m) => { for (const q of PP.segs) if (segDist(x, z, q[0], q[1], q[2], q[3]) < PP.w + m) return true; return false; };
      // walkers on those paths only (never across the lawn); a chatting group on the longest path
      if (PP.segs.length && area > 900) {
        let best = null, bl = 0;
        for (let k = 0; k < PP.segs.length; k++) {
          const q = PP.segs[k], L = Math.hypot(q[2] - q[0], q[3] - q[1]);
          if (L > bl) { bl = L; best = q; }
          const n = Math.max(2, Math.ceil(L / 4)), fp = [];
          for (let i = 0; i <= n; i++) { const x = q[0] + (q[2] - q[0]) * i / n, z = q[1] + (q[3] - q[1]) * i / n; fp.push(x, groundExact(x, z) + 0.06, z); }
          for (const run of splitWalk(new Float32Array(fp), walkable)) walks.push({ id: `pp${ah}:${k}:${run.k}`, pts: run.pts, w: PP.w * 2, density: kind === 'park' ? 0.55 : 0.3 });
        }
        if (best && bl > 12 && kind === 'park') {
          const x = (best[0] + best[2]) / 2, z = (best[1] + best[3]) / 2;
          if (walkable(x, z)) idle.push(x, groundExact(x, z) + 0.06, z, Math.min(1.1, PP.w), 2 + (ah % 3), 0, 0);
        }
      }
      if (vegDensity <= 0) continue;
      const sp = kind === 'park' ? 10.5 : 9;
      scatter(sp / Math.sqrt(Math.max(0.15, vegDensity)), 2.5, (x, z, hh) => {
        // groves and clearings: low-frequency density pattern
        const g = Math.sin(x * 0.045 + (ah & 255)) * Math.cos(z * 0.052 + ((ah >>> 8) & 255)) + Math.sin((x + z) * 0.021);
        if (g < -0.35 && u01(mix32(hh, 4)) < 0.75) return;
        if (!freeAt(x, z, 3, 1.5) || onPath(x, z, 1.6)) return;
        const y = groundY(x, z); if (isWet(y) || waterTypeAt(x, z)) return;
        addTree(x, y, z, speciesPark(hh), hh, 0, polar ? 0.7 : 1);
        if (u01(mix32(hh, 6)) < 0.35) shrubs.push(x + 2.4, y, z + 1.1, u01(hh) * 6.28, 0.7 + u01(mix32(hh, 8)) * 0.6, polar ? 2 : (u01(mix32(hh, 9)) < 0.3 ? 1 : 0));
      });
      // perimeter: benches + park lamps
      let per = 0;
      for (let i = 0; i < poly.length; i++) {
        const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
        const el = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (el < 6) continue;
        const tx = (p1[0] - p0[0]) / el, tz = (p1[1] - p0[1]) / el;
        let nx = -tz, nz = tx;
        const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
        if (!pointInPoly(poly, mx + nx * 2, mz + nz * 2)) { nx = -nx; nz = -nz; }
        for (let s = 8; s < el - 4; s += 24) {
          const x = p0[0] + tx * s + nx * 2.2, z = p0[1] + tz * s + nz * 2.2;
          if (!freeAt(x, z, 1, 0.8) || onPath(x, z, 0.4)) continue;
          const y = groundY(x, z); if (isWet(y)) continue;
          if ((per++ & 1) === 0) lamps.push(x, y, z, yawOf(nx, nz), 2, 4.2, 0, 0);
          else { const by = benchY(x, z, yawOf(-nx, -nz), 0); if (by === by) furn.push(x, by, z, yawOf(-nx, -nz), 0, per & 3); }
        }
      }
    } else if (kind === 'courtyard' || kind === 'garden' || kind === 'schoolyard') {
      if (vegDensity <= 0 && !(coldValley && kind === 'courtyard')) continue;
      const dens = coldValley && kind === 'courtyard' ? 0.8 : vegDensity;
      const sp = kind === 'courtyard' ? 9 : kind === 'garden' ? 10 : 11;
      const inset = kind === 'schoolyard' ? 2 : 3;
      scatter(sp / Math.sqrt(Math.max(0.2, dens)), inset, (x, z, hh) => {
        if (kind === 'schoolyard' && polyEdgeDist(poly, x, z) > 7) return;      // perimeter only
        if (!freeAt(x, z, 2.2, 1.2)) return;
        const y = groundY(x, z); if (isWet(y)) return;
        const u = u01(mix32(hh, 12));
        if (u < 0.5) addTree(x, y, z, conifShare > 0.6 ? 4 : (u < 0.2 ? 2 : 5), hh, 0, kind === 'garden' ? 0.8 : 0.9);
        else if (u < 0.62 && kind !== 'schoolyard') addTree(x, y, z, conifShare > 0.6 ? 4 : 0, hh, 0, 0.85);
        else shrubs.push(x, y, z, u01(hh) * 6.28, 0.6 + u01(mix32(hh, 13)) * 0.7, polar ? 2 : (u < 0.8 ? 0 : 1));
      });
      if (kind === 'courtyard' && area > 150) {
        const c = centroid(poly);
        if (pointInPoly(poly, c[0], c[1]) && freeAt(c[0], c[1], 1, 0.5)) {
          const y = groundY(c[0], c[1]);
          const r0 = (ah % 628) / 100, by0 = benchY(c[0] + 2, c[1], r0, 0), by1 = benchY(c[0] - 2, c[1] + 1, r0 + Math.PI, 0);
          if (by0 === by0) furn.push(c[0] + 2, by0, c[1], r0, 0, ah & 3);
          if (by1 === by1) furn.push(c[0] - 2, by1, c[1] + 1, r0 + Math.PI, 0, (ah >>> 2) & 3);
          idle.push(c[0], y, c[1], 5, 1 + (ah % 3), 0, 0);
        }
      }
    } else if (kind === 'pitch') {
      // a sparse row of trees beyond the pitch ends
      if (vegDensity <= 0.15) continue;
      for (let i = 0; i < poly.length; i++) {
        const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
        const el = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (el < 10 || el > 80) continue;
        const tx = (p1[0] - p0[0]) / el, tz = (p1[1] - p0[1]) / el;
        let nx = -tz, nz = tx; const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
        if (pointInPoly(poly, mx + nx * 2, mz + nz * 2)) { nx = -nx; nz = -nz; }
        for (let s = 4; s < el - 3; s += 9) {
          const x = p0[0] + tx * s + nx * 4, z = p0[1] + tz * s + nz * 4;
          if (!freeAt(x, z, 2.5, 1.5)) continue;
          const y = groundY(x, z); if (isWet(y)) continue;
          addTree(x, y, z, conifShare > 0.6 ? 4 : 3, mix32(ah, i * 97 + Math.round(s)), 0, 0.9);
        }
      }
    } else if (kind === 'parking') {
      if (vegDensity <= 0.1) continue;
      scatter(13, 2, (x, z, hh) => {
        if (!freeAt(x, z, 2, 1)) return;
        const y = groundY(x, z); if (isWet(y)) return;
        if (u01(hh) < 0.55) addTree(x, y, z, 5, hh, 0, 0.85);
        else if (u01(hh) < 0.8) parks.push(x, y, z, (u01(mix32(hh, 3)) < 0.5 ? 0 : Math.PI) + Math.round((ah % 4)) * Math.PI / 2, zone === 'O' ? 2 : (u01(mix32(hh, 4)) < 0.2 ? 1 : 0));
      });
    } else if (kind === 'plaza' || kind === 'station_plaza') {
      // planters with small trees, benches, bollards, bike racks, people
      const st = kind === 'station_plaza';
      scatter(st ? 14 : 16, 3, (x, z, hh) => {
        if (!freeAt(x, z, 2.5, 1)) return;
        const y = groundY(x, z) + 0.12; if (isWet(y)) return;
        const u = u01(mix32(hh, 15));
        const rot = Math.round(u01(mix32(hh, 16)) * 4) * Math.PI / 2;
        if (u < 0.45 && vegDensity > 0.1) { furn.push(x, y, z, rot, 3, hh & 3); addTree(x, y + 0.55, z, conifShare > 0.6 ? 4 : (u < 0.15 ? 2 : 5), hh, 0, 0.7); }
        else if (u < 0.7) { const by = benchY(x, z, rot, 0.12); if (by === by) furn.push(x, by, z, rot, 0, hh & 3); }
        else if (u < 0.82 && st) { furn.push(x, y, z, rot, 2, hh & 3); furn.push(x + Math.cos(rot) * 1.2, y, z - Math.sin(rot) * 1.2, rot, 2, (hh >> 2) & 3); }
      });
      // plaza lighting (fix round 2, QQ-06): a regular lattice of post-top lamps (14 m station plazas, 16 m
      // others) so every part of the plaza lies in a light pool at night
      {
        const sp = st ? 14 : 16;
        const ox = bb.x0 + ((ah >>> 3) % 97) / 97 * sp, oz = bb.z0 + ((ah >>> 11) % 89) / 89 * sp;
        for (let z = oz; z < bb.z1; z += sp) for (let x = ox; x < bb.x1; x += sp) {
          if (!inside(x, z, 1.5) || !freeAt(x, z, 1.5, 0.8)) continue;
          const y = groundY(x, z) + 0.12; if (isWet(y)) continue;
          lamps.push(x, y, z, 0, 2, 4.2, 0, 0);
        }
      }
      // bollards along the station-plaza edges that face a road
      for (let i = 0; i < (st ? poly.length : 0); i++) {
        const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
        const el = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (el < 4) continue;
        const tx = (p1[0] - p0[0]) / el, tz = (p1[1] - p0[1]) / el;
        const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
        let nx = -tz, nz = tx; if (!pointInPoly(poly, mx + nx, mz + nz)) { nx = -nx; nz = -nz; }
        if (!onRoad(mx - nx * 2.5, mz - nz * 2.5, 1, null, false)) continue;
        for (let s = 1.5; s < el - 1; s += 3.2) {
          const x = p0[0] + tx * s + nx * 0.6, z = p0[1] + tz * s + nz * 0.6;
          if (inBuilding(x, z, 0.3) || onRoad(x, z, 0.2, null, true)) continue;
          furn.push(x, groundY(x, z) + 0.12, z, 0, 1, 0);
        }
      }
      const c = centroid(poly);
      if (pointInPoly(poly, c[0], c[1])) idle.push(c[0], groundY(c[0], c[1]) + 0.12, c[1], Math.min(st ? 14 : 10, Math.sqrt(area) * 0.3), (st ? 8 : 4) + (ah % 5), 0, 0);
      walks.push(...parkWalks(poly, groundExact, ah, 0.12, walkable));
    } else if (kind === 'yard_service' || kind === 'container_yard' || kind === 'dock' || kind === 'yard_industrial' || kind === 'yard') {
      // parked service vehicles at loading docks / yards
      const n = Math.min(kind === 'yard' ? 2 : 6, Math.floor(area / (kind === 'yard' ? 900 : 600)));
      for (let i = 0; i < n; i++) {
        const x = bb.x0 + (bb.x1 - bb.x0) * (0.15 + 0.7 * R2()), z = bb.z0 + (bb.z1 - bb.z0) * (0.15 + 0.7 * R2());
        if (!pointInPoly(poly, x, z) || !freeAt(x, z, 2, 1)) continue;
        const y = groundY(x, z); if (isWet(y)) continue;
        parks.push(x, y + 0.06, z, R2() * Math.PI * 2, zone === 'O' ? 2 : (R2() < 0.6 ? 1 : 0));
      }
    }
  }

  // ---- stations: platform crowds + a street shelter --------------------------------------------
  for (const st of data.stations || []) {
    const h = (st.heading || 0) * Math.PI / 180;
    const tx = Math.sin(h), tz = -Math.cos(h);        // track direction (local x east, z south)
    const nx = tz, nz = -tx;                           // plane-CCW normal = the side the building is on
    const side = st.side || 1;
    const plen = Math.max(20, st.platformLength || 120);
    const platY = st.y + (st.elevated ? 1.0 : 1.35);   // types/z_station_geom.js: rail head + 1.0 m
    const n = Math.max(2, Math.round(plen / 26));
    const hs = strHash(st.id);
    for (const ps of [side, -side]) {
      const off = 2.0 + 1.6 + 1.3;                     // track centre, platform edge, stand back
      const faceYaw = yawOf(-nx * ps, -nz * ps);       // towards the track
      for (let i = 0; i < n; i++) {
        if (ps !== side && (i & 1)) continue;          // fewer people on the far platform
        const s = (i / (n - 1) - 0.5) * plen * 0.78;
        idle.push(st.x + tx * s + nx * off * ps, platY, st.z + tz * s + nz * off * ps, 2.6, 1 + ((hs >>> (i % 24)) % 3), 1, faceYaw);
      }
    }
    // a street-side shelter near the station building
    const sx = st.x + nx * side * 26, sz = st.z + nz * side * 26;
    if (!inBuilding(sx, sz, 1) && !onRoad(sx, sz, 0.5, null, true) && onRoad(sx, sz, 4, null, false)) furn.push(sx, groundY(sx, sz) + SIDEWALK_Y, sz, yawOf(nx * side, nz * side), 5, 0);
  }
  // docks: waterfront groups (ferry passengers) facing the water
  for (const d of data.docks || []) {
    if (!d.polygon) continue;
    const c = centroid(d.polygon);
    const h = (d.heading || 0) * Math.PI / 180;
    const fx = Math.sin(h), fz = -Math.cos(h);
    const half = (d.length || 40) / 2;
    if (d.kind === 'ferry' || d.kind === 'landing') {
      idle.push(c[0] + fx * half * 0.55, (d.y || 2.5) + 0.02, c[1] + fz * half * 0.55, d.kind === 'ferry' ? 6 : 3, d.kind === 'ferry' ? 8 : 3, 2, yawOf(fx, fz));
      idle.push(c[0] - fx * half * 0.3, (d.y || 2.5) + 0.02, c[1] - fz * half * 0.3, 4, d.kind === 'ferry' ? 4 : 2, 2, yawOf(fx, fz));
    }
  }

  // ---- station view corridors: crowns in front of 2F windows of residential facades that look at a
  // station platform are replaced by small ornamentals below the sight line (or removed) -------------
  /** a building (other than `self` and stations) whose roof rises above the sight line at (x, z, y) */
  const occluded = (x, z, y, self) => {
    const list = bgrid.query(x, z); if (!list) return false;
    for (const b of list) {
      if (b === self || b.station || b.top <= y) continue;
      const px = x - b.cx, pz = z - b.cz;
      if (b.round) { if (px * px + pz * pz < b.r * b.r) return true; continue; }
      if (Math.abs(px * b.fx + pz * b.fz) < b.hd && Math.abs(-px * b.fz + pz * b.fx) < b.hw) return true;
    }
    return false;
  };
  const view = resB.length && trees.length ? stationViewPrune(trees, resB, nearStations(F, 650 + VIEW_REACH), occluded) : { trees, replaced: 0, removed: 0 };

  const f32 = (arr) => new Float32Array(arr);
  return {
    key, version: PLACE_VERSION,
    climate: { lat, province: prov, code, zone, polar, cold, vegDensity, ice: fields.ice },
    trees: f32(view.trees), shrubs: f32(shrubs), lamps: f32(lamps), furniture: f32(furn), idle: f32(idle), parks: f32(parks), elights: f32(elights),
    walks, drives, grid,
    stats: { trees: view.trees.length / 8, viewReplaced: view.replaced, viewRemoved: view.removed, shrubs: shrubs.length / 6, lamps: lamps.length / 8, furniture: furn.length / 6, walks: walks.length, ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10 },
  };
}

/**
 * Stations of the corridor network near a tile (pure; any tile, also stations of neighbouring tiles):
 * [{id, pts:[{x, y, z}]}] = five points along the platform zone at the canopy roof height (tile frame).
 */
function nearStations(F, reach) {
  const out = [];
  if (typeof CORR.chunkRails !== 'function' || typeof DCH.chunkAt !== 'function' || typeof CORR.pointAt !== 'function') return out;
  let rails;
  try { rails = CORR.chunkRails(DCH.chunkAt(F.c.x, F.c.y, F.c.z)) || []; } catch (e) { return out; }
  const SD = {}, A = {}, B = {}, L = {}, La = {}, Lb = {};
  for (const sg of rails) {
    if (!sg || !sg.rail || !sg.stations || !(sg.tracks > 0)) continue;
    let d; try { d = CORR.segDistance(sg, F.c.x, F.c.y, F.c.z, SD); } catch (e) { continue; }
    if (d > reach + 1000) continue;
    for (const st of sg.stations) {
      ecefToFrame(F, st.x * R, st.y * R, st.z * R, L);
      if (Math.abs(L.x) > reach || Math.abs(L.z) > reach) continue;
      CORR.pointAt(sg, st.t - 30, A); CORR.pointAt(sg, st.t + 30, B);
      ecefToFrame(F, A.x * R, A.y * R, A.z * R, La); ecefToFrame(F, B.x * R, B.y * R, B.z * R, Lb);
      let tx = Lb.x - La.x, tz = Lb.z - La.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const elev = sg.kind === 'metro' && typeof CORR.inIntervals === 'function' && CORR.inIntervals(sg.elev || [], st.t);
      const lvl = typeof CORR.stationRailLevel === 'function' ? CORR.stationRailLevel(st) : heightAt(st.x, st.y, st.z, 2);
      const top = lvl + (elev ? 9.0 : 0.35) + 1.0 + 4.9;     // rail head + platform + canopy roof (types/station.js)
      const half = st.halt ? 10 : st.main ? 100 : 62;        // ≈ platform half length (urban districts.js plen)
      const pts = [];
      for (const f of [-1, -0.5, 0, 0.5, 1]) { const x = L.x + tx * half * f, z = L.z + tz * half * f; pts.push({ x, z, y: top - (x * x + z * z) / (2 * R) }); }
      out.push({ id: st.id, pts });
    }
  }
  return out;
}

/**
 * Prune crowns that block the 2F view of residential facades towards station platforms (§5 07 定格三:
 * 抬高的视点应看见站台雨棚顶，较低处仍被近处枝叶和窗框遮挡). A crown crossing a sight line (2F window ->
 * platform canopy, first VIEW_NEAR m) or standing in the window-axis zone in front of the facade is replaced
 * by a small round ornamental whose crown stays below the line (foliage low in the frame), else removed.
 */
function stationViewPrune(trees, resB, stations, occluded) {
  const none = { trees, replaced: 0, removed: 0 };
  if (!stations.length) return none;
  const facades = [];
  for (const b of resB) {
    // outward normals: front (fx, fz), back, right / left (along-facade axis = (−fz, fx), place.js inBuilding)
    const sides = [[b.fx, b.fz, b.hd, b.hw], [-b.fx, -b.fz, b.hd, b.hw], [-b.fz, b.fx, b.hw, b.hd], [b.fz, -b.fx, b.hw, b.hd]];
    for (const [nx, nz, off, hl] of sides) {
      if (hl < 2.5) continue;
      const ox = b.cx + nx * off, oz = b.cz + nz * off, ax = -nz, az = nx;
      const tg = [];
      for (const s of stations) for (const T of s.pts) {
        const vx = T.x - ox, vz = T.z - oz, L = Math.hypot(vx, vz);
        if (L > 8 && L < VIEW_REACH && (vx * nx + vz * nz) / L > 0.45) tg.push(T);
      }
      if (!tg.length) continue;
      // 2F windows along the facade; keep only the sight lines no other building blocks (first row only)
      const lines = [], nW = Math.max(1, Math.round((2 * hl - 2) / 3.2));
      for (let i = 0; i < nW; i++) {
        const u = -hl + 1 + ((i + 0.5) * (2 * hl - 2)) / nW;
        const W = { x: ox + ax * u + nx * 0.4, z: oz + az * u + nz * 0.4 };
        for (const T of tg) {
          const dx = T.x - W.x, dz = T.z - W.z, L = Math.hypot(dx, dz);
          let free = true;
          for (let s = 1.5; s < L - 4 && free; s += 4) { const f = s / L; if (occluded(W.x + dx * f, W.z + dz * f, b.eyeY + (T.y - b.eyeY) * f, b.rec)) free = false; }
          if (free) { lines.push({ W, T }); W.view = true; }
        }
      }
      if (!lines.length) continue;
      // window axes (along-facade positions) of the windows that do see a platform
      const axes = []; for (const L of lines) if (!axes.includes(L.W)) axes.push(L.W);
      facades.push({ ox, oz, nx, nz, ax, az, hl, lines, axes: axes.map((W) => (W.x - ox) * ax + (W.z - oz) * az), eyeY: b.eyeY });
    }
  }
  if (!facades.length) return none;
  const n = trees.length / 8, keep = new Uint8Array(n).fill(1);
  let replaced = 0, removed = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const px = trees[o], py = trees[o + 1], pz = trees[o + 2], sc = trees[o + 4], sp = trees[o + 5] | 0;
    const C = CROWN[sp] || CROWN[0];
    const r = C[2] * sc, c0 = py + C[1] * sc, c1 = py + C[0] * sc;
    let line = Infinity;                 // lowest blocked line height (tile-local y)
    for (const f of facades) {
      const rx = px - f.ox, rz = pz - f.oz;
      const out = rx * f.nx + rz * f.nz;
      if (out < -r || out > VIEW_NEAR + r) continue;
      const along = rx * f.ax + rz * f.az;
      // window-axis zone right in front of the windows that see a platform: crowns stay below the eye line
      if (out < AXIS_DEPTH + r && c1 > f.eyeY - 1.0) for (const u of f.axes) if (Math.abs(along - u) < r + 1.6) { line = Math.min(line, f.eyeY - 0.65); break; }
      for (const { W, T } of f.lines) {
        const dx = T.x - W.x, dz = T.z - W.z, L2 = dx * dx + dz * dz;
        const t = ((px - W.x) * dx + (pz - W.z) * dz) / L2;
        if (t <= 0 || t * t * L2 > (VIEW_NEAR + r) * (VIEW_NEAR + r)) continue;
        const qx = W.x + dx * t - px, qz = W.z + dz * t - pz;
        if (qx * qx + qz * qz > (r + 0.8) * (r + 0.8)) continue;
        const yl = f.eyeY + (T.y - f.eyeY) * Math.min(1, t);
        if (yl < c0 - 0.3 || yl > c1 + 0.6) continue;
        if (yl < line) line = yl;
      }
    }
    if (line === Infinity) continue;
    const s5 = 0.76 + 0.12 * trees[o + 6];
    if (py + CROWN[5][0] * s5 < line - 0.35) { trees[o + 5] = 5; trees[o + 4] = s5; trees[o + 7] |= 2; replaced++; }
    else { keep[i] = 0; removed++; }
  }
  if (!removed) return { trees, replaced, removed };
  const kept = [];
  for (let i = 0; i < n; i++) if (keep[i]) for (let k = 0; k < 8; k++) kept.push(trees[i * 8 + k]);
  return { trees: kept, replaced, removed };
}

/** resample a walk polyline (xyz Float32Array) at <= 4 m and split it where ok(x, z) fails -> [{k, pts}] */
function splitWalk(fp, ok) {
  const out = [];
  let run = [], len = 0;
  const flush = () => { if (run.length >= 6 && len >= 8) out.push({ k: out.length, pts: new Float32Array(run) }); run = []; len = 0; };
  const n = fp.length / 3;
  for (let i = 0; i < n; i++) {
    const x1 = fp[i * 3], y1 = fp[i * 3 + 1], z1 = fp[i * 3 + 2];
    if (i === 0) { if (ok(x1, z1, y1)) run.push(x1, y1, z1); continue; }
    const x0 = fp[i * 3 - 3], y0 = fp[i * 3 - 2], z0 = fp[i * 3 - 1];
    const L = Math.hypot(x1 - x0, z1 - z0), m = Math.max(1, Math.ceil(L / 4));
    for (let k = 1; k <= m; k++) {
      const f = k / m, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, z = z0 + (z1 - z0) * f;
      if (ok(x, z, y)) { if (run.length) len += L / m; run.push(x, y, z); } else flush();
    }
  }
  flush();
  return out;
}

function centroid(poly) { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; }

/** polygon inset by d m (copy of render/city/streetBuild.js inset: same vertices for the same input) */
function insetPoly(poly, d) {
  const n = poly.length, out = [];
  let area = 0; for (let i = 0; i < n; i++) { const a = poly[i], c = poly[(i + 1) % n]; area += a[0] * c[1] - c[0] * a[1]; }
  const sg = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n], q = poly[i], r = poly[(i + 1) % n];
    let ax = q[0] - p[0], az = q[1] - p[1]; const la = Math.hypot(ax, az) || 1; ax /= la; az /= la;
    let bx = r[0] - q[0], bz = r[1] - q[1]; const lb = Math.hypot(bx, bz) || 1; bx /= lb; bz /= lb;
    const n1x = -az * sg, n1z = ax * sg, n2x = -bz * sg, n2z = bx * sg;
    let mx = n1x + n2x, mz = n1z + n2z; const lm = Math.hypot(mx, mz) || 1; mx /= lm; mz /= lm;
    const k = 1 / Math.max(0.35, mx * n1x + mz * n1z);
    out.push([q[0] + mx * d * k, q[1] + mz * d * k]);
  }
  return out;
}

/**
 * The path layout render/city/streetBuild.js parkPaths() draws on a 'park' / 'green' area (same hash of the
 * centroid, inset and picks): {w: path half width (m), segs: [[x0, z0, x1, z1]]} in the tile frame.
 * Keep in sync with the city (people walk on these paths, trees and benches stay off them).
 */
function cityParkPaths(poly) {
  const out = { w: 1, segs: [] };
  if (!poly || poly.length < 3) return out;
  let cx = 0, cz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of poly) { cx += p[0] / poly.length; cz += p[1] / poly.length; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const span = Math.min(x1 - x0, z1 - z0);
  if (span < 14) return out;
  const h = hash4(Math.round(cx * 4), Math.round(cz * 4), poly.length, 0x9a7c);
  const pick = h & 7;
  out.w = 1.0 + ((h >>> 4) & 3) * 0.1;
  const path = (p0, p1) => { if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) >= 2) out.segs.push([p0[0], p0[1], p1[0], p1[1]]); };
  const I = insetPoly(poly, 3 + ((h >>> 6) & 3));
  const m = I.length;
  const midI = (i) => [(I[i % m][0] + I[(i + 1) % m][0]) / 2, (I[i % m][1] + I[(i + 1) % m][1]) / 2];
  const r = (h >>> 9) % m;
  if (span < 45 || pick === 0) {
    if (pick & 1 || m < 4) path(midI(r), midI(r + Math.floor(m / 2))); else path(I[r], I[(r + 2) % m]);
  } else if (pick <= 2) {
    for (let i = 0; i < m; i++) path(I[i], I[(i + 1) % m]);
  } else if (pick <= 4) {
    path(midI(r), midI(r + Math.floor(m / 2)));
    if (m >= 4) path(midI(r + 1), midI(r + 1 + Math.floor(m / 2)));
  } else if (pick === 5) {
    for (let i = 0; i < m; i++) path(I[i], I[(i + 1) % m]);
    path(midI(r), midI(r + Math.floor(m / 2)));
  } else {
    path(I[r], I[(r + 1) % m]);
    path(midI(r), [cx + (midI(r)[0] - cx) * -0.2, cz + (midI(r)[1] - cz) * -0.2]);
  }
  return out;
}

/** a couple of walking lines across a park / plaza (axis lines clipped to the polygon) */
function parkWalks(poly, groundY, seed, lift = 0.02, ok = null) {
  const bb = polyBounds(poly);
  const out = [];
  const lines = [[bb.x0, (bb.z0 + bb.z1) / 2, bb.x1, (bb.z0 + bb.z1) / 2], [(bb.x0 + bb.x1) / 2, bb.z0, (bb.x0 + bb.x1) / 2, bb.z1]];
  for (let li = 0; li < lines.length; li++) {
    const [x0, z0, x1, z1] = lines[li];
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 6));
    let run = [];
    const flush = () => { if (run.length >= 2 * 3) out.push({ id: `pw${seed}:${li}:${out.length}`, pts: new Float32Array(run), w: 3, density: 0.6 }); run = []; };
    for (let k = 0; k <= n; k++) {
      const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n;
      if (pointInPoly(poly, x, z) && polyEdgeDist(poly, x, z) > 1.5 && (!ok || ok(x, z))) run.push(x, groundY(x, z) + lift, z); else flush();
    }
    flush();
  }
  return out;
}
