// District seeds: an adaptive quadtree of jittered points under every level-0 cell of every cube
// face. Cell size follows the planning intensity — dense cores ≈ 1.8–2.6 km, town districts ≈ 2–4
// km, suburbs ≈ 3.7–5.2 km, farmland / rural ≈ 5–10 km, wilderness ≈ 15–21 km — and is corrected
// with the face-plane scale so ground sizes stay true. Settlements (settlements.js) refine the
// size around their centres, so every village and town gets its own small districts. The Voronoi
// diagram itself is computed in 3D (great-circle bisectors) and is seamless across cube faces.
//
// District key (int < 2^31): ((face*4 + level) * 2048 + x) * 2048 + y, x/y at quadtree level.
import { R } from '../../core/constants.js';
import { hash4 } from '../../core/hash.js';
import { unitToLatLon, faceToVec } from '../../core/geo.js';
import { densityAt, waterAt as mapWater, zoneSmooth } from '../../data/controlMaps.js';
import { N0, S0, MAX_DLEVEL, cell0Key, cellTrueSize } from './cells.js';
import { rawTownsNear, validTown, outcomes } from './settlements.js';
import { Lru } from './lru.js';

const CH_SEED = 0x51ee, CH_SPLIT = 0x5b18;
const LL = {}, V = {}, C = {};

export function dkeyOf(face, level, x, y) { return ((face * 4 + level) * 2048 + x) * 2048 + y; }
export function dkeyDecode(k, out = {}) {
  out.y = k % 2048; let t = (k - out.y) / 2048;
  out.x = t % 2048; t = (t - out.x) / 2048;
  out.level = t % 4; out.face = (t - out.level) / 4;
  return out;
}

function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

/** cheap control-map size proxy (true metres) */
function proxySize(x, y, z) {
  unitToLatLon(x, y, z, LL);
  const w = mapWater(LL.lat, LL.lon);
  if (w > 0.72) return 21000;
  const d = densityAt(LL.lat, LL.lon);
  const zo = zoneSmooth(LL.lat, LL.lon);
  const qz = smooth01((d - 0.10) / 0.32);
  const qo = 0.30 + 0.25 * smooth01((d - 0.02) / 0.2);     // O farmland: 5–9 km districts follow the canals
  let q = qz + (qo - qz) * zo;
  if (w > 0.35) q *= 0.75;
  return Math.exp(9.75 + (7.80 - 9.75) * q);              // 17 km … 2.4 km
}

/** district edge (true m) wanted near a settlement t at distance d (m) */
function townSize(t, d) {
  const r = t.radius;
  switch (t.kind) {
    case 'city': return 1700 + 0.30 * Math.max(0, d - 0.6 * r);
    case 'town': return 2000 + 0.32 * Math.max(0, d - 0.8 * r);
    case 'otown': return 1900 + 0.45 * Math.max(0, d - 0.9 * r);
    case 'village': case 'hamlet': return 1700 + 0.9 * Math.max(0, d - 1.4 * r);
    case 'station': return 1900 + 1.0 * Math.max(0, d - 1.5 * r);
    default: return 1e9;
  }
}

/** smallest district edge any possible outcome of raw candidate c could demand at distance d */
function townSizeLB(c, d) {
  let m = 1e9;
  for (const o of outcomes(c)) { const v = townSize({ kind: o.kind, radius: o.r }, d); if (v < m) m = v; }
  return m;
}

/**
 * desired district edge (true m) at unit vector p, given the settlements around. `towns` is either
 * an array of settlement records or a lazy list from rawTownsNear (validated only when the best
 * possible outcome of a candidate could lower the size — identical result, far fewer validations).
 */
export function desiredDistrictSize(x, y, z, towns) {
  let s = proxySize(x, y, z);
  if (towns) {
    for (let i = 0; i < towns.length; i++) {
      let t = towns[i];
      if (t.c) {
        const c = t.c;
        const dx = x - c.x, dy = y - c.y, dz = z - c.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
        if (townSizeLB(c, d) >= s) continue;
        t = validTown(t);
        if (!t.valid) continue;
        const ts = townSize(t, d);
        if (ts < s) s = ts;
        continue;
      }
      const dx = x - t.x, dy = y - t.y, dz = z - t.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
      const ts = townSize(t, d);
      if (ts < s) s = ts;
    }
  }
  return s;
}

/** Seed (unit vector) of a district key — independent of the subdivision that produced it. */
export function seedOfKey(k, out = {}) {
  const d = dkeyDecode(k, V);
  const n = N0 << d.level, s = 2 / n;
  const h = hash4(d.face * 4 + d.level, d.x, d.y, CH_SEED);
  const ja = ((h & 0xffff) / 65535 - 0.5) * 0.8;
  const jb = (((h >>> 16) & 0xffff) / 65535 - 0.5) * 0.8;
  return faceToVec(d.face, -1 + (d.x + 0.5 + ja) * s, -1 + (d.y + 0.5 + jb) * s, out);
}

/** nominal true size (m) of a district cell */
export function districtNominalSize(k) {
  const d = dkeyDecode(k, V);
  return cellTrueSize(d.face, d.level, d.x, d.y);
}

// ---------------------------------------------------------------------------------------------
// Per level-0 cell seed lists (cached)
// ---------------------------------------------------------------------------------------------
const cell0Cache = new Lru(8192, 'dseeds.cell0Cache');

function needSplit(face, level, x, y, towns) {
  if (level >= MAX_DLEVEL) return false;
  const n = N0 << level, s = 2 / n;
  const a0 = -1 + x * s, b0 = -1 + y * s;
  const size = cellTrueSize(face, level, x, y);
  // finest demand over centre + 4 inner points (cities at a cell corner still split it)
  let dmin = 1e9;
  for (let k = 0; k < 5; k++) {
    const fa = k === 0 ? 0.5 : (k & 1 ? 0.18 : 0.82), fb = k === 0 ? 0.5 : (k < 3 ? 0.18 : 0.82);
    faceToVec(face, a0 + fa * s, b0 + fb * s, C);
    const D = desiredDistrictSize(C.x, C.y, C.z, towns);
    if (D < dmin) dmin = D;
  }
  const j = 0.86 + 0.38 * (hash4(face * 4 + level, x, y, CH_SPLIT) / 4294967296);
  return size > dmin * j;
}

function buildCell0(face, cx, cy) {
  faceToVec(face, -1 + (cx + 0.5) * S0, -1 + (cy + 0.5) * S0, C);
  const towns = rawTownsNear(C.x, C.y, C.z, 34000);   // validated lazily (desiredDistrictSize)
  const keys = [], xyz = [];
  const rec = (level, x, y) => {
    if (needSplit(face, level, x, y, towns)) {
      rec(level + 1, 2 * x, 2 * y); rec(level + 1, 2 * x + 1, 2 * y);
      rec(level + 1, 2 * x, 2 * y + 1); rec(level + 1, 2 * x + 1, 2 * y + 1);
      return;
    }
    const k = dkeyOf(face, level, x, y);
    seedOfKey(k, C);
    keys.push(k); xyz.push(C.x, C.y, C.z);
  };
  rec(0, cx, cy);
  return { keys: Int32Array.from(keys), xyz: Float64Array.from(xyz) };
}

/** {keys:Int32Array, xyz:Float64Array} of the district seeds under level-0 cell (face,cx,cy) */
export function cell0Seeds(face, cx, cy) {
  const k = cell0Key(face, cx, cy);
  let v = cell0Cache.get(k);
  if (!v) { v = buildCell0(face, cx, cy); cell0Cache.set(k, v); }
  return v;
}

/** Does district key k exist (i.e. is it a leaf of the subdivision)? */
export function districtExists(k) {
  const d = dkeyDecode(k, {});
  const sh = d.level;
  const cx = d.x >> sh, cy = d.y >> sh;
  if (cx < 0 || cy < 0 || cx >= N0 || cy >= N0 || d.face > 5 || d.level > MAX_DLEVEL) return false;
  const s = cell0Seeds(d.face, cx, cy);
  for (let i = 0; i < s.keys.length; i++) if (s.keys[i] === k) return true;
  return false;
}
