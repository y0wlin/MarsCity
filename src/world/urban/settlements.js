// Settlements: one candidate per level-0 cell (≈ 15–21 km), placed at the best of four jittered
// spots. Valid settlements are the cores of the plan:
//   Z  city / town (density stars, coastal belts) with a main station and a tower cluster,
//      village (background stripes: sparse farming villages, 郊外断续的节点)
//   O  otown (levee / station towns on the water network), hamlet (farm station, sluice
//      settlement), station (polar insulated supply station)
// The settlement graph carries the rail and road network (corridors.js).
import { R, PROVINCE_CODES } from '../../core/constants.js';
import { hash4 } from '../../core/hash.js';
import { faceToVec, unitToLatLon } from '../../core/geo.js';
import { densityAt, waterAt as mapWater } from '../../data/controlMaps.js';
import { N0, S0, cell0Key, forCellsNear } from './cells.js';
import { envZ, bgZ, envO, farmO, sstep } from './potential.js';
import { fieldsExact } from './lattice.js';
import { Lru } from './lru.js';
import { outletOfCell, iceMarginQ } from './melt.js';
import { HARBOUR_CELL, harbourCityAnchor } from './harbour.js';

const CH_TOWN = 0x70e2;
const townCache = new Lru(60000, 'settlements.townCache');
const F = {}, P = {}, LLp = {};

export const TOWN_REACH = 26000;      // m: max distance at which a settlement shapes district intensity
export const KIND_RANK = { none: 0, hamlet: 1, village: 1, station: 2, otown: 2, town: 3, city: 4 };

function proxyRank(x, y, z) {
  unitToLatLon(x, y, z, LLp);
  const w = mapWater(LLp.lat, LLp.lon);
  if (w > 0.5) return -1;
  return densityAt(LLp.lat, LLp.lon) * (1 - w);
}

// raw candidate of a level-0 cell (no neighbourhood rules yet)
const candCache = new Lru(90000, 'settlements.candCache');
function candidate(face, cx, cy) {
  const key = cell0Key(face, cx, cy);
  let c = candCache.get(key);
  if (c) return c;
  // most promising of 4 jittered spots by the cheap control-map proxy, then the real fields once
  let bh = 0, bq = -2, bx = 0, by = 0, bz = 0;
  for (let t = 0; t < 4; t++) {
    const h = hash4(key, t, 0, CH_TOWN);
    const ja = ((h & 1023) / 1023 - 0.5) * 0.72, jb = (((h >>> 10) & 1023) / 1023 - 0.5) * 0.72;
    faceToVec(face, -1 + (cx + 0.5 + ja) * S0, -1 + (cy + 0.5 + jb) * S0, P);
    const q = proxyRank(P.x, P.y, P.z) + 0.03 * (((h >>> 20) & 1023) / 1023);
    if (q > bq) { bq = q; bh = h; bx = P.x; by = P.y; bz = P.z; }
  }
  fieldsExact(bx, by, bz, F);
  const hr = ((bh >>> 20) & 1023) / 1023;
  let code = PROVINCE_CODES[F.province] || '';
  // OX4 北冠冰缘 (§5 04): station settlements sit at the meltwater outlets of the ice-cliff foot (forebay
  // pool = pump intake, melt.js); elsewhere within ~40 km of the cliff no settlement competes with them
  let outlet = null, nearFoot = false;
  if (code === 'OX4' || (F.lat > 66 && F.lon > -5 && F.lon < 95 && F.zone === 'O')) {
    outlet = outletOfCell(face, cx, cy);
    if (outlet) { bx = outlet.sx; by = outlet.sy; bz = outlet.sz; fieldsExact(bx, by, bz, F); code = PROVINCE_CODES[F.province] || ''; }
    else nearFoot = iceMarginQ(bx, by, bz) > -40;
  }
  // G01 protected port city (harbour.js): this cell's settlement is the harbour metropolis at its main centre
  const harbour = key === HARBOUR_CELL;
  if (harbour) { const a = harbourCityAnchor(); bx = a.x; by = a.y; bz = a.z; fieldsExact(bx, by, bz, F); code = PROVINCE_CODES[F.province] || code; }
  const polar = code === 'OX4' || code === 'OX6';
  const land = harbour || (F.coastM > 60 && F.ridge < 0.62 && F.ice < 0.75);
  let rank = 0, cls = 0, core = 0;   // cls: 0 none, 1 rural (village / hamlet / station), 2 town level
  if (F.zone === 'Z') {
    const e = envZ(F, bx, by, bz), b = bgZ(F, bx, by, bz);
    const re = e * (0.80 + 0.20 * hr), rb = b * (0.25 + 0.45 * hr);
    rank = Math.max(re, rb);
    if (land) { if (re >= 0.24) cls = 2; else if (rank >= 0.12) cls = 1; }
    core = re * (0.35 + 0.65 * sstep(0.25, 0.9, F.density)) + 0.02 * hr;
    if (harbour) { rank = 0.97; cls = 2; core = 0.99; }
  } else if (polar) {
    const e = envO(F, bx, by, bz);
    rank = Math.max(e * 0.8, 0.36 * sstep(-0.02, 0.1, F.coast) * (1 - sstep(0.55, 0.8, F.ridge)) * (1 - 0.6 * sstep(0.6, 0.95, F.ice))) * (0.7 + 0.3 * hr);
    if (code === 'OX4' && outlet) rank = 0.9 + 0.08 * hr;           // meltwater outlet station
    else if (code === 'OX4' && nearFoot) rank *= 0.3;               // the cliff foot belongs to the outlets
    if (land && rank > 0.15) cls = 1;
    core = rank;
  } else {
    const e = envO(F, bx, by, bz), fm = farmO(F);
    const near = F.canal < 2500 ? 1 : 0.55;
    rank = Math.max(e * (0.78 + 0.22 * hr), (0.18 + 0.30 * fm) * near * (0.5 + 0.5 * hr) * sstep(0.0, 0.25, fm + F.density));
    if (land) { if (rank >= 0.30) cls = 2; else if (rank >= 0.13) cls = 1; }
    core = rank;
  }
  c = { key, face, cx, cy, x: bx, y: by, z: bz, rank, cls, core, zone: F.zone, polar, density: harbour ? Math.max(F.density, 0.62) : F.density, province: F.province, code, hash: bh >>> 0, coastM: F.coastM, lat: F.lat, lon: F.lon, outlet: outlet ? outlet.idx : -1, harbour: harbour || undefined };
  candCache.set(key, c);
  return c;
}

/** raw settlement candidate of a level-0 cell (one exact fields evaluation; cls 0 = never a settlement) */
export function candidateOfCell(face, cx, cy) { return candidate(face, cx, cy); }

/** is candidate c the strongest (by score) among the candidates of its own class within radius? */
function localMax(c, radius, scoreOf) {
  const s0 = scoreOf(c);
  let ok = true;
  const cosr = Math.cos(radius / R);
  forCellsNear(c.x, c.y, c.z, radius, 0, (f, cx, cy) => {
    if (!ok) return;
    const n = candidate(f, cx, cy);
    if (n.key === c.key || n.cls === 0) return;
    if (n.x * c.x + n.y * c.y + n.z * c.z < cosr) return;
    const s = scoreOf(n);
    if (s > s0 || (s === s0 && n.key > c.key)) ok = false;
  });
  return ok;
}
const tieH = (c) => (c.hash & 4095) / 4095e4;

function buildTown(face, cx, cy) {
  const c = candidate(face, cx, cy);
  let kind = 'none', radius = 0;
  if (c.cls > 0) {
    if (c.zone === 'Z') {
      if (c.cls === 2) {
        // polycentric metros: main cities ≥ ~45 km apart, sub-centre towns between them
        const isCity = c.density >= 0.42 && localMax(c, 47000, (n) => (n.cls === 2 ? n.core + tieH(n) : -1));
        kind = isCity ? 'city' : 'town';
        radius = isCity ? 3000 + 3600 * sstep(0.4, 1.0, c.density) : 1500 + 1500 * sstep(0.24, 0.7, c.rank);
      } else if (localMax(c, 30000, (n) => (n.cls >= 1 ? n.rank + tieH(n) : -1))) {
        kind = 'village'; radius = 520 + 700 * sstep(0.12, 0.45, c.rank);
      }
    } else if (c.polar) {
      if (localMax(c, 50000, (n) => (n.cls >= 1 ? n.rank + tieH(n) : -1))) { kind = 'station'; radius = 450 + 500 * sstep(0.15, 0.5, c.rank); }
    } else if (c.cls === 2 && localMax(c, 30000, (n) => (n.cls === 2 ? n.rank + tieH(n) : -1))) {
      kind = 'otown'; radius = 1100 + 1500 * sstep(0.3, 0.75, c.rank);
    } else if (localMax(c, 24000, (n) => (n.cls >= 1 ? n.rank + tieH(n) : -1))) {
      kind = 'hamlet'; radius = 380 + 320 * sstep(0.13, 0.4, c.rank);
    }
  }
  return {
    key: c.key, face, cx, cy, x: c.x, y: c.y, z: c.z, rank: c.rank, valid: kind !== 'none', radius, kind, zone: c.zone,
    province: c.province, code: c.code, hash: c.hash, coastM: c.coastM, lat: c.lat, lon: c.lon, density: c.density, outlet: c.outlet,
  };
}

/** settlement record of a level-0 cell (always returns an object; check .valid) */
export function townOfCell(face, cx, cy) {
  const k = cell0Key(face, cx, cy);
  let t = townCache.get(k);
  if (!t) { t = buildTown(face, cx, cy); townCache.set(k, t); }
  return t;
}

export function townByKey(k) {
  const y = k % N0, t1 = (k - y) / N0, x = t1 % N0, face = (t1 - x) / N0;
  return townOfCell(face, x, y);
}

/** valid settlements within radius (m) of unit vector p → array */
export function townsNear(x, y, z, radius) {
  const out = [];
  const c = Math.cos(radius / R);
  forCellsNear(x, y, z, radius, 0, (f, cx, cy) => {
    const t = townOfCell(f, cx, cy);
    if (!t.valid) return;
    if (t.x * x + t.y * y + t.z * z >= c) out.push(t);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lazy settlement queries (cold-start budget). A settlement's validity is a neighbourhood maximum
// over 24–50 km (one exact fields evaluation per level-0 cell of that disc). The queries below only
// validate a raw candidate when its best possible outcome could change the answer: every raw
// candidate has at most two possible outcomes (kind, radius, amplitude) whose numbers are exact
// functions of the candidate itself, so the bounds are exact and the answers are bit-identical to
// the eager versions (townsNear + townInfluence).
// ---------------------------------------------------------------------------------------------
/** possible outcomes [{kind, r, amp}] of a raw candidate (the same formulas as buildTown / townAmp) */
export function outcomes(c) {
  if (c._out) return c._out;
  const o = [];
  if (c.cls > 0) {
    if (c.zone === 'Z') {
      if (c.cls === 2) {
        if (c.density >= 0.42) o.push({ kind: 'city', r: 3000 + 3600 * sstep(0.4, 1.0, c.density) });
        o.push({ kind: 'town', r: 1500 + 1500 * sstep(0.24, 0.7, c.rank) });
      } else o.push({ kind: 'village', r: 520 + 700 * sstep(0.12, 0.45, c.rank) });
    } else if (c.polar) o.push({ kind: 'station', r: 450 + 500 * sstep(0.15, 0.5, c.rank) });
    else {
      if (c.cls === 2) o.push({ kind: 'otown', r: 1100 + 1500 * sstep(0.3, 0.75, c.rank) });
      o.push({ kind: 'hamlet', r: 380 + 320 * sstep(0.13, 0.4, c.rank) });
    }
  }
  for (const e of o) e.amp = townAmp({ kind: e.kind, rank: c.rank });
  c._out = o;
  return o;
}

/**
 * Raw candidates (cls > 0, not yet validated) exactly as townsNear(x,y,z,radius) would test them:
 * [{c, f, cx, cy, t}] — call validTown(e) for the settlement record (cached on the entry).
 */
export function rawTownsNear(x, y, z, radius) {
  const out = [];
  const cr = Math.cos(radius / R);
  forCellsNear(x, y, z, radius, 0, (f, cx, cy) => {
    const c = candidate(f, cx, cy);
    if (c.cls === 0) return;
    if (c.x * x + c.y * y + c.z * z >= cr) out.push({ c, f, cx, cy, t: null });
  });
  return out;
}
export function validTown(e) { return e.t || (e.t = townOfCell(e.f, e.cx, e.cy)); }

/**
 * townInfluence(chunkTowns(chunkAt(p)), p, out) with texel 0, evaluated lazily (identical result):
 * only candidates within TOWN_REACH of p whose best outcome could raise T or beat the nearest town
 * (in units of its radius) are validated.
 */
const TIL = [];
export function townInfluenceAt(x, y, z, out) {
  const raw = rawTownsNear(x, y, z, TOWN_REACH + 1500);
  TIL.length = 0;
  for (const e of raw) {
    const c = e.c;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
    if (d > TOWN_REACH) continue;
    let rmax = 0, vub = 0;
    for (const o of outcomes(c)) { if (o.r > rmax) rmax = o.r; const v = o.amp * Math.exp(-(d * d) / (o.r * o.r)); if (v > vub) vub = v; }
    TIL.push({ e, d, qlb: d / rmax, vub });
  }
  TIL.sort((a, b) => a.qlb - b.qlb || a.e.c.key - b.e.c.key);
  let T = 0, best = null, bd = 1e30;
  for (const it of TIL) {
    if (it.qlb >= bd && it.vub <= T) continue;
    const t = validTown(it.e);
    if (!t.valid) continue;
    const v = townAmp(t) * Math.exp(-(it.d * it.d) / (t.radius * t.radius));
    if (v > T) T = v;
    const q = it.d / t.radius;
    if (q < bd) { bd = q; best = t; }
  }
  TIL.length = 0;
  out.T = T; out.town = best; out.td = best ? bd * best.radius : 1e30;
  return out;
}

/**
 * Settlement influence T at the points P (flat xyz, unit vectors) from the settlements near the
 * (unnormalised) centre (mx,my,mz) within radius — identical to townInfluence(townsNear(m, radius), …).T
 * per point, validating only candidates whose upper bound exceeds the running maximum somewhere.
 */
export function townProfileT(mx, my, mz, radius, P, T) {
  const n = P.length / 3;
  T.fill(0);
  const raw = rawTownsNear(mx, my, mz, radius);
  const items = [];
  for (const e of raw) {
    const c = e.c, o = outcomes(c);
    const ub = new Float64Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const dx = P[3 * i] - c.x, dy = P[3 * i + 1] - c.y, dz = P[3 * i + 2] - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
      if (d > TOWN_REACH) continue;
      let u = 0; for (const q of o) { const v = q.amp * Math.exp(-(d * d) / (q.r * q.r)); if (v > u) u = v; }
      ub[i] = u; if (u > peak) peak = u;
    }
    if (peak > 0) items.push({ e, ub, peak });
  }
  items.sort((a, b) => b.peak - a.peak || a.e.c.key - b.e.c.key);
  for (const it of items) {
    let need = false;
    for (let i = 0; i < n; i++) if (it.ub[i] > T[i]) { need = true; break; }
    if (!need) continue;
    const t = validTown(it.e);
    if (!t.valid) continue;
    const amp = townAmp(t), r2 = t.radius * t.radius;
    for (let i = 0; i < n; i++) {
      const dx = P[3 * i] - t.x, dy = P[3 * i + 1] - t.y, dz = P[3 * i + 2] - t.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
      if (d > TOWN_REACH) continue;
      const v = amp * Math.exp(-(d * d) / r2);
      if (v > T[i]) T[i] = v;
    }
  }
  return T;
}

/** settlements relevant to a chunk (lazy, cached on the chunk object) */
export function chunkTowns(ch) {
  if (ch.towns) return ch.towns;
  const c = faceToVec(ch.face, ch.a0 + S0 / 2, ch.b0 + S0 / 2, {});
  ch.towns = townsNear(c.x, c.y, c.z, 15500 + TOWN_REACH);
  return ch.towns;
}

/** amplitude of a settlement's influence by kind and rank */
export function townAmp(t) {
  switch (t.kind) {
    case 'city': return 0.80 + 0.20 * sstep(0.6, 1.0, t.rank);
    case 'town': return 0.62 + 0.18 * sstep(0.24, 0.6, t.rank);
    case 'otown': return 0.58 + 0.2 * sstep(0.3, 0.75, t.rank);
    case 'station': return 0.5;
    default: return 0.38 + 0.14 * sstep(0.13, 0.5, t.rank);
  }
}

/**
 * Settlement influence at p: out.T (0..1 core proximity), out.town (nearest settlement in units
 * of its radius, or null), out.td (m to it). Area-averaged over a footprint `texel` (gaussian ⊗ box
 * ≈ wider gaussian with the same integral) so coarse samples never alias town cores.
 */
export function townInfluence(towns, x, y, z, out, texel = 0) {
  let T = 0, best = null, bd = 1e30;
  const h2 = texel > 0 ? 0.25 * texel * texel : 0;
  for (let i = 0; i < towns.length; i++) {
    const t = towns[i];
    const dx = x - t.x, dy = y - t.y, dz = z - t.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
    if (d > TOWN_REACH + texel) continue;
    const amp = townAmp(t);
    const r2 = t.radius * t.radius;
    let v;
    if (h2 > 0) { const re2 = r2 + h2; v = amp * (r2 / re2) * Math.exp(-(d * d) / re2); }
    else v = amp * Math.exp(-(d * d) / r2);
    if (v > T) T = v;
    const q = d / t.radius;
    if (q < bd) { bd = q; best = t; }
  }
  out.T = T; out.town = best; out.td = best ? bd * best.radius : 1e30;
  return out;
}
