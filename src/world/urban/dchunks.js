// Chunks (v2, district seeds from dseeds.js) = level-0 cells used as acceleration structures for nearest-district queries.
// A chunk holds every district seed that can matter for a point inside it (also seeds of
// neighbouring faces) plus a 16×16 bin grid with per-bin candidate lists, so that a Voronoi
// query (nearest seed + exact distance to the closest Voronoi edge) costs ~10 dot products.
import { R } from '../../core/constants.js';
import { faceToVec } from '../../core/geo.js';
import { N0, S0, cell0Key, faceAB, forCellsNear, cellTrueSize } from './cells.js';
import { cell0Seeds } from './dseeds.js';
import { Lru, onClearAll } from './lru.js';

const BINS = 16;
const MARGIN = 700;            // m: edge queries are exact for edges within this distance
const chunkCache = new Lru(768, 'dchunks.chunkCache');
const T = {}, FA = { a: 0, b: 0, dn: 0 };

export class Chunk {
  constructor(face, cx, cy) {
    this.face = face; this.cx = cx; this.cy = cy;
    this.key = cell0Key(face, cx, cy);
    this.a0 = -1 + cx * S0; this.b0 = -1 + cy * S0;
    this._seeds = null;          // lazily: {keys, xyz, n, binStart, binList}
    this.towns = null;           // lazily (towns.js)
    this.rails = null;           // lazily (rails.js)
    this.links = null;           // lazily (rails.js, geometry only)
    this.lattice = null;         // lazily (fieldlattice in sample.js)
  }

  seeds() { if (!this._seeds) this._seeds = buildSeeds(this); return this._seeds; }
}

function buildSeeds(ch) {
  const c = faceToVec(ch.face, ch.a0 + S0 / 2, ch.b0 + S0 / 2, {});
  const size = cellTrueSize(ch.face, 0, ch.cx, ch.cy);
  const radius = size * 0.75 + 1.32 * 20800 + 2 * MARGIN + 600;
  const keys = [], xyz = [];
  const seen = new Set();
  forCellsNear(c.x, c.y, c.z, radius, 0, (f, x, y) => {
    const k0 = cell0Key(f, x, y);
    if (seen.has(k0)) return; seen.add(k0);
    const s = cell0Seeds(f, x, y);
    for (let i = 0; i < s.keys.length; i++) {
      const sx = s.xyz[3 * i], sy = s.xyz[3 * i + 1], sz = s.xyz[3 * i + 2];
      const dot = sx * c.x + sy * c.y + sz * c.z;
      if (dot < Math.cos(radius / R)) continue;
      keys.push(s.keys[i]); xyz.push(sx, sy, sz);
    }
  });
  const n = keys.length;
  const K = Int32Array.from(keys), P = Float64Array.from(xyz);
  // bins
  const binStart = new Int32Array(BINS * BINS + 1);
  const lists = [];
  const bs = S0 / BINS;
  const corner = {};
  const dist = new Float64Array(n);
  for (let by = 0; by < BINS; by++) for (let bx = 0; bx < BINS; bx++) {
    const ac = ch.a0 + (bx + 0.5) * bs, bc = ch.b0 + (by + 0.5) * bs;
    faceToVec(ch.face, ac, bc, T);
    // bin radius: max distance centre→corners
    let r = 0;
    for (let q = 0; q < 4; q++) {
      faceToVec(ch.face, ac + (q & 1 ? 0.5 : -0.5) * bs, bc + (q & 2 ? 0.5 : -0.5) * bs, corner);
      const d = chord(T.x, T.y, T.z, corner.x, corner.y, corner.z);
      if (d > r) r = d;
    }
    let d1 = 1e30;
    for (let i = 0; i < n; i++) {
      const d = chord(T.x, T.y, T.z, P[3 * i], P[3 * i + 1], P[3 * i + 2]);
      dist[i] = d; if (d < d1) d1 = d;
    }
    const lim = d1 + 2 * r + 2 * MARGIN;
    const start = lists.length;
    for (let i = 0; i < n; i++) if (dist[i] <= lim) lists.push(i);
    // sort candidates by distance so the nearest is usually first (faster early-outs)
    const seg = lists.slice(start).sort((p, q) => dist[p] - dist[q]);
    for (let i = 0; i < seg.length; i++) lists[start + i] = seg[i];
    binStart[by * BINS + bx] = start;
  }
  binStart[BINS * BINS] = lists.length;
  // fix: binStart must be monotone in bin index order (we filled in by,bx order == index order)
  return { n, keys: K, xyz: P, binStart, binList: Int32Array.from(lists) };
}

function chord(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
}

/** Chunk containing unit vector p (on p's own face). */
let lastChunk = null;
onClearAll(() => { lastChunk = null; });
export function chunkAt(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face;
  if (ax >= ay && ax >= az) face = x > 0 ? 0 : 1;
  else if (ay >= az) face = y > 0 ? 2 : 3;
  else face = z > 0 ? 4 : 5;
  faceAB(face, x, y, z, FA);
  let cx = Math.floor((FA.a + 1) * 0.5 * N0), cy = Math.floor((FA.b + 1) * 0.5 * N0);
  if (cx < 0) cx = 0; else if (cx >= N0) cx = N0 - 1;
  if (cy < 0) cy = 0; else if (cy >= N0) cy = N0 - 1;
  const lc = lastChunk;
  if (lc && lc.face === face && lc.cx === cx && lc.cy === cy) { chunkAt.a = FA.a; chunkAt.b = FA.b; return lc; }
  const k = cell0Key(face, cx, cy);
  let ch = chunkCache.get(k);
  if (!ch) { ch = new Chunk(face, cx, cy); chunkCache.set(k, ch); }
  lastChunk = ch;
  chunkAt.a = FA.a; chunkAt.b = FA.b;
  return ch;
}
chunkAt.a = 0; chunkAt.b = 0;

export function chunkByKey(face, cx, cy) {
  const k = cell0Key(face, cx, cy);
  let ch = chunkCache.get(k);
  if (!ch) { ch = new Chunk(face, cx, cy); chunkCache.set(k, ch); }
  return ch;
}

/**
 * Nearest district query. Writes into out:
 *   key (district key), idx (index in chunk seeds), sx,sy,sz (seed), d1 (m to seed),
 *   edge (m to the closest Voronoi edge, ≥0, exact within MARGIN), nkey (neighbour across that edge),
 *   nsx,nsy,nsz (neighbour seed), edge2 (second closest edge distance), nkey2
 */
export function nearestDistrict(x, y, z, out) {
  const ch = chunkAt(x, y, z);
  const S = ch.seeds();
  let bx = Math.floor((chunkAt.a - ch.a0) / S0 * BINS), by = Math.floor((chunkAt.b - ch.b0) / S0 * BINS);
  if (bx < 0) bx = 0; else if (bx >= BINS) bx = BINS - 1;
  if (by < 0) by = 0; else if (by >= BINS) by = BINS - 1;
  const b = by * BINS + bx;
  const s0 = S.binStart[b], s1 = S.binStart[b + 1];
  const L = S.binList, P = S.xyz;
  let best = -1, bestDot = -2;
  for (let q = s0; q < s1; q++) {
    const i = L[q];
    const d = x * P[3 * i] + y * P[3 * i + 1] + z * P[3 * i + 2];
    if (d > bestDot) { bestDot = d; best = i; }
  }
  const ax = P[3 * best], ay = P[3 * best + 1], az = P[3 * best + 2];
  let e1 = 1e30, e2 = 1e30, n1 = -1, n2 = -1;
  for (let q = s0; q < s1; q++) {
    const i = L[q];
    if (i === best) continue;
    const dx = ax - P[3 * i], dy = ay - P[3 * i + 1], dz = az - P[3 * i + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const e = (x * dx + y * dy + z * dz) / len * R;
    if (e < e1) { e2 = e1; n2 = n1; e1 = e; n1 = i; } else if (e < e2) { e2 = e; n2 = i; }
  }
  out.chunk = ch;
  out.idx = best; out.key = S.keys[best];
  out.sx = ax; out.sy = ay; out.sz = az;
  out.d1 = Math.acos(Math.min(1, bestDot)) * R;
  out.edge = e1 < 0 ? 0 : e1; out.nidx = n1; out.nkey = n1 >= 0 ? S.keys[n1] : -1;
  out.edge2 = e2; out.nkey2 = n2 >= 0 ? S.keys[n2] : -1;
  if (n1 >= 0) { out.nsx = P[3 * n1]; out.nsy = P[3 * n1 + 1]; out.nsz = P[3 * n1 + 2]; }
  return out;
}

/** All candidate seeds near p within radius (m): calls cb(key, sx, sy, sz). Uses p's chunk seeds. */
export function seedsNear(x, y, z, radius, cb) {
  const ch = chunkAt(x, y, z);
  const S = ch.seeds();
  const c = Math.cos(radius / R);
  for (let i = 0; i < S.n; i++) {
    const sx = S.xyz[3 * i], sy = S.xyz[3 * i + 1], sz = S.xyz[3 * i + 2];
    if (x * sx + y * sy + z * sz >= c) cb(S.keys[i], sx, sy, sz);
  }
}
