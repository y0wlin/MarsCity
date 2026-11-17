// Corridors on the settlement graph (relative-neighbourhood graph of valid settlements, land
// checked). Segments are great-circle arcs between settlement centres, so they are straight lines
// in every district's gnomonic plane. Kinds:
//   metro     Z city/town ↔ city/town: 2-track passenger rail (stations every 1.5–4 km in dense
//             areas, elevated through dense cores like Z03) + intercity road outside towns
//   regional  Z ↔ O (city/town ↔ otown): 2-track regional rail + road (O/Z hand-over, §1 自然交接)
//   service   O otown ↔ otown: single-track service line + service road along the water network
//   road      links that involve a village or hamlet: a road only (sparse lights)
//   pipe      polar stations: insulated pipe gallery + service road (marker lights at the bends)
//
// Cold-start budget (buildingSpecById ≤ 50 ms without any warm-up): every query only touches the
// settlements within one link length of what it needs (62 km, 95 km for polar pipe galleries), land
// checks use the control-map water + the coarsest field lattice, and segment profiles use the 10 km
// lattice with exact (band-limited) terrain heights only near shores. No global state.
import { R } from '../../core/constants.js';
import { faceToVec, unitToLatLon } from '../../core/geo.js';
import { waterAt as mapWater } from '../../data/controlMaps.js';
import { RAIL } from './rules.js';
import { S0, forCellsNear } from './cells.js';
import { townByKey, townsNear, TOWN_REACH, KIND_RANK, candidateOfCell, townOfCell, townProfileT } from './settlements.js';
import { envZ } from './potential.js';
import { fieldsAt } from './lattice.js';
import { height } from './probe.js';
import { Lru } from './lru.js';
import { bridgeType, finishBridge, deckAt, BRIDGE_MIN, bridgeSeed } from './bridges.js';

const edgeCache = new Lru(60000, 'corridors.edgeCache');
const segCache = new Lru(16000, 'corridors.segCache');
const linkCache = new Lru(40000, 'corridors.linkCache');
const landCache = new Lru(60000, 'corridors.landCache');
const F = {}, TI = {}, Q = {}, LLq = {};

/** settlement search radius for the links of A (a link is never longer than this) */
function linkReach(A) { return A.kind === 'station' ? 95000 : RAIL.maxEdge; }
/** corridor reach around a chunk centre: links of settlements beyond this cannot pass the chunk */
function chunkLinkReach(c) { return Math.abs(c.y) > 0.74 ? 95000 : RAIL.maxEdge; }   // |lat| > ~48°: polar pipe galleries

export function segKeyOf(ka, kb) { return ka < kb ? ka * 400000 + kb : kb * 400000 + ka; }

function isMajorZ(t) { return t.zone === 'Z' && (t.kind === 'city' || t.kind === 'town'); }
export function linkKind(A, B) {
  if (A.kind === 'station' || B.kind === 'station') return (A.kind === 'station' && B.kind === 'station') ? 'pipe' : 'road';
  if (isMajorZ(A) && isMajorZ(B)) return 'metro';
  if ((isMajorZ(A) && B.kind === 'otown') || (isMajorZ(B) && A.kind === 'otown')) return 'regional';
  if (A.kind === 'otown' && B.kind === 'otown') return 'service';
  return 'road';
}
function maxLen(A, B) {
  const a = KIND_RANK[A.kind] || 0, b = KIND_RANK[B.kind] || 0;
  if (A.kind === 'station' && B.kind === 'station') return 95000;
  if (a >= 2 && b >= 2) return RAIL.maxEdge;
  return 40000;
}

function dist(A, B) { const dx = A.x - B.x, dy = A.y - B.y, dz = A.z - B.z; return Math.sqrt(dx * dx + dy * dy + dz * dz) * R; }

/** neighbour settlement keys of a valid settlement (RNG within the kind's reach, land-checked) */
export function townEdges(A) {
  let e = edgeCache.get(A.key);
  if (e) return e;
  e = [];
  if (A.valid) {
    // every C of the relative-neighbourhood test lies within dab ≤ maxLen ≤ linkReach(A) of A
    const cand = townsNear(A.x, A.y, A.z, linkReach(A));
    for (const B of cand) {
      if (B.key === A.key) continue;
      const dab = dist(A, B);
      if (dab > maxLen(A, B)) continue;
      let ok = true;
      for (const C of cand) {
        if (C === A || C === B) continue;
        if (Math.max(dist(A, C), dist(B, C)) < dab) { ok = false; break; }
      }
      if (!ok) continue;
      if (!landOkCached(A, B, dab)) continue;
      e.push(B.key);
    }
  }
  edgeCache.set(A.key, e);
  return e;
}

/** symmetric, cached per link: both ends see the same decision */
function landOkCached(A, B, d) {
  const key = segKeyOf(A.key, B.key);
  let v = landCache.get(key);
  if (v === undefined) {
    v = A.key < B.key ? landOk(A, B, d) : landOk(B, A, d);
    landCache.set(key, v);
  }
  return v;
}

function landOk(A, B, d) {
  // water from the control map (2.5 km steps), rock / ice from the coarsest field lattice
  const n = Math.max(6, Math.ceil(d / 2500));
  let wet = 0, run = 0, maxRun = 0, rock = 0, ice = 0;
  for (let i = 1; i < n; i++) {
    slerpTo(A, B, i / n, Q);
    unitToLatLon(Q.x, Q.y, Q.z, LLq);
    const w = mapWater(LLq.lat, LLq.lon) > 0.5;
    if (w) { wet++; run++; if (run > maxRun) maxRun = run; } else run = 0;
    if (!w && (i & 1)) {
      fieldsAt(Q.x, Q.y, Q.z, 20800, F);
      if (F.ridge > 0.72) rock += 2;
      if (F.ice > 0.8) ice += 2;
    }
  }
  if (wet / n > 0.3 || maxRun * (d / n) > 9000) return false;
  if (rock / n > 0.6 || ice / n > 0.5) return false;
  return true;
}

function slerpTo(A, B, t, out) {
  const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t, z = A.z + (B.z - A.z) * t;
  const l = Math.sqrt(x * x + y * y + z * z);
  out.x = x / l; out.y = y / l; out.z = z / l; return out;
}

function frame(A, B, s) {
  const ax = A.x, ay = A.y, az = A.z;
  let nx = ay * B.z - az * B.y, ny = az * B.x - ax * B.z, nz = ax * B.y - ay * B.x;
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  const mx = ny * az - nz * ay, my = nz * ax - nx * az, mz = nx * ay - ny * ax;
  const ang = Math.atan2(B.x * mx + B.y * my + B.z * mz, B.x * ax + B.y * ay + B.z * az);
  s.ax = ax; s.ay = ay; s.az = az; s.bx = B.x; s.by = B.y; s.bz = B.z; s.nx = nx; s.ny = ny; s.nz = nz; s.mx = mx; s.my = my; s.mz = mz;
  s.ang = ang; s.len = ang * R;
  return s;
}

/** full segment record between two settlement keys (stations, elevated and bridge intervals) */
export function segment(ka, kb) {
  const key = segKeyOf(ka, kb);
  let s = segCache.get(key);
  if (s) return s;
  const A = townByKey(Math.min(ka, kb)), B = townByKey(Math.max(ka, kb));
  s = buildSegment(key, A, B);
  segCache.set(key, s);
  return s;
}

function buildSegment(key, A, B) {
  const kind = linkKind(A, B);
  const s = frame(A, B, { key, ka: A.key, kb: B.key, kind, stations: [], elev: [], bridge: [] });
  s.tracks = kind === 'metro' || kind === 'regional' ? 2 : kind === 'service' ? 1 : 0;
  s.rail = s.tracks > 0;
  s.roadW = kind === 'metro' ? RAIL.highwayWidth : kind === 'regional' ? 16 : kind === 'pipe' ? 8 : kind === 'service' ? 9 : 12;
  const len = s.len;
  const step = 400;
  const n = Math.max(2, Math.ceil(len / step));
  let elevOn = false, elev0 = 0, wetOn = false, wet0 = 0, lastSt = 0, prog = 0;
  const I = new Float64Array(n + 1);
  // settlement influence along the line (only passenger lines use the intensity profile); evaluated
  // lazily = townInfluence(townsNear(midpoint, len/2 + TOWN_REACH), point).T at every sample
  const TP = new Float64Array(n + 1);
  if (kind === 'metro' || kind === 'regional') {
    const P = new Float64Array(3 * (n + 1));
    for (let i = 0; i <= n; i++) { pointAt(s, (i / n) * len, Q); P[3 * i] = Q.x; P[3 * i + 1] = Q.y; P[3 * i + 2] = Q.z; }
    townProfileT((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2, len / 2 + TOWN_REACH, P, TP);
  }
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * len;
    pointAt(s, t, Q);
    // intensity profile from the 10 km lattice + settlement cores (station spacing / elevated runs);
    // water exactly from the band-limited terrain near shores (bridges start and end on land)
    fieldsAt(Q.x, Q.y, Q.z, 10400, F);
    const e = F.zoneO < 0.5 ? envZ(F, Q.x, Q.y, Q.z) : 0;
    const inten = e * (0.45 + 0.55 * TP[i]);
    I[i] = inten;
    const wet = Math.abs(F.coastM) < 7000 ? height(Q.x, Q.y, Q.z, 250) < 0 : F.coastM < 0;
    if (wet && !wetOn) { wetOn = true; wet0 = t; }
    if (!wet && wetOn) { wetOn = false; s.bridge.push(Math.max(0, wet0 - 60), t + 60); }
    const el = kind === 'metro' && inten > 0.52;
    if (el && !elevOn) { elevOn = true; elev0 = t; }
    if (!el && elevOn) { elevOn = false; if (t - elev0 > 600) s.elev.push(elev0 - 150, t + 150); }
  }
  if (wetOn) s.bridge.push(wet0 - 60, len);
  if (elevOn && len - elev0 > 600) s.elev.push(elev0 - 150, len);
  // long water crossings → bridge records (decision DB): exact water ends (20 m), structure type, deck profile
  s.bridges = [];
  for (let k = 0; k + 1 < s.bridge.length; k += 2) {
    const a = Math.max(0, s.bridge[k]), b = Math.min(len, s.bridge[k + 1]);
    let w0 = -1, w1 = -1;
    for (let t = a; t <= b; t += 20) { pointAt(s, t, Q); if (height(Q.x, Q.y, Q.z, 60) < 0) { if (w0 < 0) w0 = t; w1 = t; } }
    if (w0 < 0) continue;
    const span = w1 - w0 + 20;
    const ty = bridgeType(span, s.rail ? 'rail' : 'road', true, false, bridgeSeed(key % 1000003, k, 1));
    if (!ty || span < BRIDGE_MIN) continue;
    pointAt(s, a, Q); const hA = Math.max(0, height(Q.x, Q.y, Q.z, 2));
    pointAt(s, b, Q); const hB = Math.max(0, height(Q.x, Q.y, Q.z, 2));
    const rec = { id: `B${key.toString(36)}.${k / 2}`, kind: s.rail ? 'rail' : 'road', t0: a, t1: b, span, length: b - a, ...ty };
    finishBridge(rec, hA, hB, 0, w0 - a, w1 + 20 - a);
    s.bridges.push(rec);
  }
  // stations: main stations at both settlements; intermediate by spacing (passenger lines only)
  const mainA = s.rail || kind === 'pipe', mainB = mainA;
  if (mainA) s.stations.push({ t: 0, main: true, town: A.key, idx: 0 });
  if (kind === 'metro' || kind === 'regional') {
    for (let i = 1; i < n; i++) {
      const t = (i / n) * len;
      const inten = I[i];
      const spacing = inten > 0.62 ? 1600 : inten > 0.42 ? 2300 : inten > 0.22 ? 3500 : 0;
      if (spacing === 0) { prog = Math.min(prog, 0.5); continue; }
      prog += (len / n) / spacing;
      if (prog >= 1 && t - lastSt > 1100 && len - t > 1100 && !inside(s.bridge, t, 120)) {
        s.stations.push({ t, main: false, town: -1, idx: s.stations.length });
        prog = 0; lastSt = t;
      }
    }
  } else if (kind === 'service' || kind === 'pipe') {
    // service halts / pipe-gallery marker stations every ~9–14 km (long dark stretches between)
    const sp = kind === 'pipe' ? 13000 : 9000;
    for (let t = sp; t < len - sp * 0.6; t += sp) s.stations.push({ t, main: false, town: -1, idx: s.stations.length, halt: true });
  }
  if (mainB) s.stations.push({ t: len, main: true, town: B.key, idx: s.stations.length });
  for (const st of s.stations) { pointAt(s, st.t, Q); st.x = Q.x; st.y = Q.y; st.z = Q.z; st.id = st.main ? `T${st.town.toString(36)}` : `S${key.toString(36)}.${st.idx}`; }
  // U11: the level rail bed of a station never cuts below the natural ground — its level is the highest ground of
  // the levelled zone (embankment on the downhill side), evaluated once per station on a 20 m lattice
  if (s.rail) for (const st of s.stations) {
    const h = stationLevelHalf(st);
    let lv = -1e9;
    for (let d = -h; d <= h + 1e-6; d += 20) { const t = Math.max(0, Math.min(len, st.t + d)); pointAt(s, t, Q); const g = height(Q.x, Q.y, Q.z, 2); if (g > lv) lv = g; }
    st._lvl = lv;
  }
  return s;
}

function inside(list, t, pad) { for (let i = 0; i < list.length; i += 2) if (t >= list[i] - pad && t <= list[i + 1] + pad) return true; return false; }
export function inIntervals(list, t) { for (let i = 0; i < list.length; i += 2) if (t >= list[i] && t <= list[i + 1]) return true; return false; }

/** unit vector at arc length t (m) along a segment */
export function pointAt(s, t, out) {
  const th = t / R, c = Math.cos(th), sn = Math.sin(th);
  out.x = s.ax * c + s.mx * sn; out.y = s.ay * c + s.my * sn; out.z = s.az * c + s.mz * sn;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Level rail bed at stations (D1 STATION_GEOM): over the longest possible platform of a station the
// rail bed is level at the ground height of the station point (2 m band limit), with 180 m ramps back to
// the natural grade. City (beds / rails), props (trains) and the station building (meta.railGround) all
// read the same numbers: tile rails polylines (citytile.js), stations[].y and BuildingSpec.meta.
// ---------------------------------------------------------------------------------------------
export const STATION_RAMP = 180;
/** half length (m) of the level zone of a corridor station record (≥ platformLength / 2 + 5) */
export function stationLevelHalf(st) { return st.halt ? 20 : st.main ? 130 : 95; }
/** level rail-bed ground height (m above sea level) of a corridor station record {x,y,z}: the highest natural
 *  ground over its levelled zone (set when the segment is built; fallback: ground at the station point) */
export function stationRailLevel(st) {
  if (st._lvl === undefined) st._lvl = height(st.x, st.y, st.z, 2);
  return st._lvl;
}
/** rail-bed ground height at arc position t of segment s, given the natural ground gh there */
export function railBedGround(s, t, gh) {
  const S = s.stations;
  if (!S || !S.length || s.kind === 'pipe') return gh;
  let best = 0, lv = 0;
  for (let i = 0; i < S.length; i++) {
    const st = S[i];
    const d = Math.abs(t - st.t), h = stationLevelHalf(st);
    if (d >= h + STATION_RAMP) continue;
    let w = 1;
    if (d > h) { const q = 1 - (d - h) / STATION_RAMP; w = q * q * (3 - 2 * q); }
    if (w > best) { best = w; lv = stationRailLevel(st); }
  }
  return best > 0 ? Math.max(gh, gh + (lv - gh) * best) : gh;
}

/** bridge record of segment s containing arc position t (null when t is not on a long bridge) */
export function bridgeAtT(s, t) {
  const B = s.bridges;
  if (!B || !B.length) return null;
  for (let i = 0; i < B.length; i++) if (t >= B[i].t0 - 1e-6 && t <= B[i].t1 + 1e-6) return B[i];
  return null;
}
/** deck height (m a.s.l.) of a corridor bridge at arc position t, given the natural ground gh there */
export function bridgeDeckY(s, t, gh) {
  const rec = bridgeAtT(s, t);
  if (!rec) return Math.max(gh, 0) + 7;
  return Math.max(deckAt(rec, t - rec.t0), Math.max(gh, 0) + 6);
}

/** geometry-only link record (great-circle frame) — cheap, no stations */
export function linkGeom(ka, kb) {
  const key = segKeyOf(ka, kb);
  let s = linkCache.get(key);
  if (s) return s;
  const A = townByKey(Math.min(ka, kb)), B = townByKey(Math.max(ka, kb));
  s = frame(A, B, { key, ka: A.key, kb: B.key, kind: linkKind(A, B) });
  linkCache.set(key, s);
  return s;
}

/**
 * Links of the settlement graph that pass within `reach` of unit vector c, as [ka, kb] pairs
 * (ka < kb). One local relative-neighbourhood pass: identical to the per-settlement graph
 * (townEdges) because every settlement inside the lens of a link that passes near c lies within
 * reach + 1.37·(max link length) of c (lens ⊂ disc of 0.866·d around the link midpoint).
 *
 * LAZY evaluation (cold-start budget): settlement validity (a neighbourhood maximum over 24–50 km,
 * i.e. one exact fields evaluation per level-0 cell of that disc) is only established for the
 * endpoints of geometrically possible links and for the settlements that actually sit inside a
 * candidate lens — instead of for every settlement of the 104 km disc. The result is identical to
 * linksNearFull() (kept below for verification: scripts/check-urban.mjs links).
 */
const SDl = {};
function linksNear(c, reach, Lopt = 0) {
  const L = Lopt || chunkLinkReach(c);
  const bigR = reach + 1.37 * L + 1000;          // the blocker disc of the full algorithm
  // raw candidates (cls > 0) that can be endpoints: within reach + max link reach of c
  const ends = [];
  forCellsNear(c.x, c.y, c.z, reach + L, 0, (f, cx, cy) => {
    const cd = candidateOfCell(f, cx, cy);
    if (cd.cls === 0) return;
    const d = dist(c, cd);
    if (d <= reach + L) ends.push({ cd, d, f, cx, cy, t: null });
  });
  ends.sort((p, q) => p.cd.key - q.cd.key);
  const n = ends.length;
  const townOf = (e) => (e.t || (e.t = townOfCell(e.f, e.cx, e.cy)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const ea = ends[i], A0 = ea.cd;
    for (let j = i + 1; j < n; j++) {
      const eb = ends[j], B0 = eb.cd;
      const dab = dist(A0, B0);
      // kind-independent bounds first (maxLen ≤ 95 km for two polar candidates, else ≤ 62 km)
      if (dab > ((A0.polar && B0.polar) ? 95000 : RAIL.maxEdge)) continue;
      if (ea.d > reach + dab || eb.d > reach + dab) continue;
      const g = linkGeom(A0.key, B0.key);
      if (segDistance(g, c.x, c.y, c.z, SDl) > reach) continue;
      // exact rules of the full algorithm (validity, kind-dependent reach / length)
      const A = townOf(ea);
      if (!A.valid) continue;
      const B = townOf(eb);
      if (!B.valid) continue;
      if (ea.d > reach + linkReach(A) || eb.d > reach + linkReach(B)) continue;
      if (dab > maxLen(A, B)) continue;
      if (lensBlocked(A, B, dab, c, bigR)) continue;
      if (!landOkCached(A, B, dab)) continue;
      out.push(A.key < B.key ? A.key : B.key, A.key < B.key ? B.key : A.key);
    }
  }
  return out;
}

const MIDl = {};
/** is there a VALID settlement C (≠ A, B; within bigR of c) with max(|AC|, |BC|) < |AB|? */
function lensBlocked(A, B, dab, c, bigR) {
  MIDl.x = (A.x + B.x) / 2; MIDl.y = (A.y + B.y) / 2; MIDl.z = (A.z + B.z) / 2;
  const l = Math.hypot(MIDl.x, MIDl.y, MIDl.z) || 1; MIDl.x /= l; MIDl.y /= l; MIDl.z /= l;
  let blocked = false;
  forCellsNear(MIDl.x, MIDl.y, MIDl.z, 0.87 * dab + 500, 0, (f, cx, cy) => {
    if (blocked) return;
    const cd = candidateOfCell(f, cx, cy);
    if (cd.cls === 0 || cd.key === A.key || cd.key === B.key) return;
    if (Math.max(dist(A, cd), dist(B, cd)) >= dab) return;
    if (dist(c, cd) > bigR) return;
    if (townOfCell(f, cx, cy).valid) blocked = true;
  });
  return blocked;
}

/** reference implementation (validates every settlement of the disc) — verification only */
export function linksNearFull(c, reach) {
  const L = chunkLinkReach(c);
  const V = townsNear(c.x, c.y, c.z, reach + 1.37 * L + 1000);
  const n = V.length;
  const dc = new Float64Array(n);
  for (let i = 0; i < n; i++) dc[i] = dist(c, V[i]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = V[i];
    if (dc[i] > reach + linkReach(A)) continue;
    for (let j = i + 1; j < n; j++) {
      const B = V[j];
      if (dc[j] > reach + linkReach(B)) continue;
      const dab = dist(A, B);
      if (dab > maxLen(A, B) || dc[i] > reach + dab || dc[j] > reach + dab) continue;
      const g = linkGeom(A.key, B.key);
      if (segDistance(g, c.x, c.y, c.z, SDl) > reach) continue;
      let ok = true;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const C = V[k];
        if (Math.max(dist(A, C), dist(B, C)) < dab) { ok = false; break; }
      }
      if (!ok || !landOkCached(A, B, dab)) continue;
      out.push(A.key < B.key ? A.key : B.key, A.key < B.key ? B.key : A.key);
    }
  }
  return out;
}

/** corridor links (geometry only) near a chunk — orbit-scale corridor lights / roads */
export function chunkLinks(ch) {
  if (ch.links) return ch.links;
  const c = faceToVec(ch.face, ch.a0 + S0 / 2, ch.b0 + S0 / 2, {});
  const pairs = linksNear(c, 15500 + 6000);
  const list = [];
  for (let i = 0; i < pairs.length; i += 2) list.push(linkGeom(pairs[i], pairs[i + 1]));
  list.sort((a, b) => a.key - b.key);
  ch.links = list;
  return list;
}

/**
 * Full corridor segments (sorted by key) that pass within `reach` of unit vector p AND belong to the
 * corridor list of chunk ch (within 18.5 km of its centre, same link-length bound) — i.e. exactly
 * chunkRails(ch) filtered by distance to p, without building the segments of the whole chunk
 * neighbourhood (cold buildingSpecById: only the links near the district are evaluated).
 */
const SDr = {}, CCr = {};
export function railsNearInChunk(px, py, pz, reach, ch) {
  if (ch.rails) return ch.rails.filter((sg) => segDistance(sg, px, py, pz, SDr) <= reach);
  faceToVec(ch.face, ch.a0 + S0 / 2, ch.b0 + S0 / 2, CCr);
  const cc = { x: CCr.x, y: CCr.y, z: CCr.z };
  const pairs = linksNear({ x: px, y: py, z: pz }, reach, chunkLinkReach(cc));
  const list = [];
  for (let i = 0; i < pairs.length; i += 2) {
    if (segDistance(linkGeom(pairs[i], pairs[i + 1]), cc.x, cc.y, cc.z, SDr) > 15500 + 3000) continue;
    list.push(segment(pairs[i], pairs[i + 1]));
  }
  list.sort((a, b) => a.key - b.key);
  return list;
}

/** full corridor segments within reach of a chunk (lazy, cached on the chunk) */
export function chunkRails(ch) {
  if (ch.rails) return ch.rails;
  const c = faceToVec(ch.face, ch.a0 + S0 / 2, ch.b0 + S0 / 2, {});
  const pairs = linksNear(c, 15500 + 3000);
  const list = [];
  for (let i = 0; i < pairs.length; i += 2) list.push(segment(pairs[i], pairs[i + 1]));
  list.sort((a, b) => a.key - b.key);
  ch.rails = list;
  return list;
}

/**
 * Distance (m) from unit vector p to segment s; writes out.t (arc position, clamped),
 * out.side (signed cross-track m, + toward n), out.along (unclamped arc m).
 */
export function segDistance(s, x, y, z, out) {
  const pa = x * s.ax + y * s.ay + z * s.az, pm = x * s.mx + y * s.my + z * s.mz, pn = x * s.nx + y * s.ny + z * s.nz;
  const th = Math.atan2(pm, pa);
  const along = th * R;
  out.along = along;
  out.side = pn * R;
  if (th >= 0 && th <= s.ang) { out.t = along; return Math.abs(pn) * R; }
  const t = th < 0 ? 0 : s.len;
  out.t = t;
  pointAt(s, t, out);
  const dx = x - out.x, dy = y - out.y, dz = z - out.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
}

/** verification hook: the lazy link query used by chunkLinks / chunkRails */
export { linksNear as linksNearLazy };
