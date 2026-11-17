// Irrigation canal network of the O zones (pure, deterministic, worker-safe). OWNER: terrain-fn.
//
// "富氧水网呈蓝色树枝，沿枝条两侧长出颜色深浅不同的耕地，过了灌溉末端便露出粗糙的赤土"
//
// order 0  main canals (40–120 m): one jittered node per 18 km cell of the cube-face planning grid;
//          every node drains to its lowest active neighbour (steepest descent on the large-scale
//          terrain + noise) -> dendritic trees whose roots are outlets / reservoirs. Each main reach
//          bends gently (deterministic meander that vanishes at the nodes).
// order 1  branch canals (10–30 m): laterals leaving each main every ~1.2 km (jittered) on both
//          sides at 50–130°, 1.2–7.5 km long — the farmland ends where the laterals end.
// order 2  field ditches (3–6 m): every ~320 m along each lateral, 260–520 m each side.
// Water levels are flat between sluices and step at sluices (pump houses / sluice stations); they
// follow the band-limited terrain (mw 300 m) and are evaluated lazily per channel.

import { R, FACE_ARC } from '../../core/constants.js';
import { getControlMaps } from '../../data/controlMaps.js';
import { faceToVec, vecToFace } from '../../core/geo.js';
import { computeFields, newFields, liteFields } from './field.js';
import { relief } from './relief.js';
// layout derivations (node drainage P, canal levels) use the frozen fix-round-1 relief outside the OX1 basin, so the
// canal network / sluice levels (and the buildings urban places on them) stay stable while the live terrain evolves
import { relief as reliefV1 } from './relief_v1.js';
import { makeNoise, hash3, rehash, u01, smoothstep, clamp } from './noise.js';
import { inG02 } from './sitezones.js';
import { SITES, localToUnit } from '../sites.js';
import { basinMask, basinToUnit, OUTLET } from './basin.js';

export const S0 = 18000;
const N0 = Math.ceil((2 * FACE_ARC) / S0), DA0 = S0 / FACE_ARC;
const NP = makeNoise(601);
const LEV_MW = 300;
const LAT_MAX = 7500, LAT_SP = 1200, DITCH_SP = 320, DITCH_LEN = 520;
const FN = newFields();
const VF = {};

const C0 = new Map(), L0 = new Map(), LV = new Map();
const MAXC = 150000;           // ~30 MB of nodes per thread; cleared wholesale when full
function trim() {
  if (C0.size > MAXC) { C0.clear(); L0.clear(); }
  if (LV.size > 240000) LV.clear();
}
const key0 = (f, i, j) => (f * 1024 + i) * 1024 + j;

function levelTerrain(x, y, z) {
  computeFields(x, y, z, LEV_MW, FN);
  return (FN.basinW > 0 ? relief : reliefV1)(FN, LEV_MW, null);
}
function district(x, y, z) {
  const X = x * R, Y = y * R, Z = z * R;
  return NP.n3(X / 340000, Y / 340000, Z / 340000) * 0.7 + NP.n3(X / 90000 + 3, Y / 90000, Z / 90000) * 0.3;
}

// ---------------------------------------------------------------------------------------------
// OX1 catchment basin (basin.js): the node of the cell holding the end of the lake outlet channel is moved onto
// it and forced active as a LEAF (higher than its neighbours), so the main canal network starts at the lake outlet
// sluices and runs downstream; nodes in the basin / on its tablelands are inactive.
// ---------------------------------------------------------------------------------------------
// The G02 spill channel (G02-OUT, sites.js) ends at a forced leaf node the same way: the G02 irrigation district on
// the plain below the water stairs is fed from the spillways.
let FORCED = null;
const BC = basinToUnit(0, 0), BC_DOT = Math.cos(52000 / R);
const LE = [0, 0, 0];
function forcedCells() {
  if (FORCED) return FORCED;
  const ends = [basinToUnit(OUTLET.end[0], OUTLET.end[1])];
  const ws = SITES.waterStairs, sp = ws.spillChannels[0].points, pe = sp[sp.length - 1];
  const u = localToUnit(ws, pe[0], pe[1], {});
  ends.push([u.x, u.y, u.z]);
  FORCED = ends.map((p) => {
    const V = {};
    vecToFace(p[0], p[1], p[2], V);
    return { f: V.face, a: V.a, b: V.b, i: Math.min(N0 - 1, Math.max(0, Math.floor((V.a + 1) / DA0))), j: Math.min(N0 - 1, Math.max(0, Math.floor((V.b + 1) / DA0))) };
  });
  return FORCED;
}
function forcedCell() { return forcedCells()[0]; }
function forcedAt(f, i, j) { const L = forcedCells(); for (let k = 0; k < L.length; k++) if (L[k].f === f && L[k].i === i && L[k].j === j) return L[k]; return null; }
/** the C0 node at the end of the OX1 lake outlet channel (forced active leaf) */
export function outletNode() { const q = forcedCell(); return node0(q.f, q.i, q.j); }
/** the C0 node at the end of the G02 spill channel (forced active leaf) */
export function g02SpillNode() { const q = forcedCells()[1]; return node0(q.f, q.i, q.j); }
/** water level (m) of the main canal leaving the outlet node (outlet channel end level) */
export function outletNodeLevel() {
  const n = outletNode();
  const s = seg0(n);
  if (s) { levels0(s); return s.levA; }
  return Math.max(0.8, levelTerrain(n.x, n.y, n.z) - 2.6);
}

// ---------------------------------------------------------------------------------------------
// order-0 nodes (large-scale fields + terrain only: no dependency on canals)
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// precomputed node table (scripts/prep-data.mjs -> public/data/canalnodes.bin, loaded with the control maps as
// 'canalNodes'): activity bit + float64 P / farm of every active order-0 node, bit-identical with makeNodeLive.
// Orbit tiles otherwise built the network lazily (makeNode = fields + relief at 6 km, ~50 per cold cell). The table is
// validated against live nodes when installed (stale tables after a terrain change are ignored -> live compute).
// Layout: 64 B header ('MCNT', u32 version, u32 N0, u32 active count), bitset 6*N0*N0 bits (u32 LE words, padded to
// 8 B), Float64 LE [P, farm] per active node in bit order. Forced nodes (outlets) are never in the table.
// ---------------------------------------------------------------------------------------------
const NODE_VERSION = 1;
let NT_FOR, NT_BITS = null, NT_RANK = null, NT_VAL = null;
function popc(v) { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function nodeTable() {
  let maps = null;
  try { maps = getControlMaps(); } catch (e) { return false; }
  if (NT_FOR === maps) return NT_BITS !== null;
  NT_FOR = maps; NT_BITS = null; NT_RANK = null; NT_VAL = null;
  const m = maps.canalNodes;
  if (!m || !m.data || m.data.byteLength < 64) return false;
  const u8 = m.data instanceof Uint8Array ? m.data : new Uint8Array(m.data.buffer, m.data.byteOffset, m.data.byteLength);
  if (u8[0] !== 77 || u8[1] !== 67 || u8[2] !== 78 || u8[3] !== 84) return false;            // 'MCNT'
  const dv = new DataView(u8.buffer, u8.byteOffset, 64);
  if (dv.getUint32(4, true) !== NODE_VERSION || dv.getUint32(8, true) !== N0) return false;
  const count = dv.getUint32(12, true);
  const nBits = 6 * N0 * N0, nWords = Math.ceil(nBits / 32), bitBytes = Math.ceil((nWords * 4) / 8) * 8;
  if (u8.byteLength !== 64 + bitBytes + count * 16) return false;
  const copy = (off, len) => (u8.byteOffset + off) % 8 === 0 ? new Uint8Array(u8.buffer, u8.byteOffset + off, len) : u8.slice(off, off + len);
  const bits = new Uint32Array(copy(64, nWords * 4).slice().buffer);
  const val = new Float64Array(copy(64 + bitBytes, count * 16).slice().buffer);
  const rank = new Uint32Array(nWords);
  let acc = 0;
  for (let w = 0; w < nWords; w++) { rank[w] = acc; acc += popc(bits[w]); }
  if (acc !== count) return false;
  NT_BITS = bits; NT_RANK = rank; NT_VAL = val;
  // validation against live nodes (deterministic sample of active and candidate cells)
  let bad = 0, n = 0;
  for (let k = 0; k < nBits && n < 96; k += 5477) {
    const f = Math.floor(k / (N0 * N0)), r = k % (N0 * N0), i = Math.floor(r / N0), j = r % N0;
    if (forcedAt(f, i, j)) continue;
    const L = makeNodeLive(f, i, j), T = tableNode(f, i, j);
    // tolerance for last-bit differences of Math.* between the V8 that wrote the table (Node) and the browser's:
    // every thread of a session uses the same table values, so they stay consistent
    if (L.act || T.act) { n++; if (L.act !== T.act || (L.act && (Math.abs(L.P - T.P) > 1e-6 * (1 + Math.abs(L.P)) || Math.abs(L.farm - T.farm) > 1e-9))) bad++; }
  }
  if (bad > 0) {
    if (typeof console !== 'undefined') console.warn(`[terrain] stale canalnodes.bin (${bad}/${n} sampled nodes differ): computing the canal network live`);
    NT_BITS = null; NT_RANK = null; NT_VAL = null;
    return false;
  }
  return true;
}
const TN = { act: false, P: 0, farm: 0 };
function tableNode(f, i, j) {
  const id = (f * N0 + i) * N0 + j, w = id >>> 5, b = id & 31;
  const word = NT_BITS[w];
  TN.act = ((word >>> b) & 1) === 1;
  if (TN.act) { const k = NT_RANK[w] + popc(b ? word & ((1 << b) - 1) >>> 0 : 0); TN.P = NT_VAL[2 * k]; TN.farm = NT_VAL[2 * k + 1]; }
  else { TN.P = 0; TN.farm = 0; }
  return TN;
}
/** serialized node table (scripts/prep-data.mjs): { bytes: Uint8Array, count } */
export function serializeCanalNodes() {
  const nBits = 6 * N0 * N0, nWords = Math.ceil(nBits / 32), bitBytes = Math.ceil((nWords * 4) / 8) * 8;
  const bits = new Uint32Array(nWords), vals = [];
  for (let f = 0; f < 6; f++) for (let i = 0; i < N0; i++) for (let j = 0; j < N0; j++) {
    if (forcedAt(f, i, j)) continue;
    const n = makeNodeLive(f, i, j);
    if (!n.act) continue;
    const id = (f * N0 + i) * N0 + j;
    bits[id >>> 5] |= 1 << (id & 31);
    vals.push(n.P, n.farm);
  }
  const count = vals.length / 2;
  const bytes = new Uint8Array(64 + bitBytes + count * 16);
  const dv = new DataView(bytes.buffer);
  bytes.set([77, 67, 78, 84], 0);
  dv.setUint32(4, NODE_VERSION, true); dv.setUint32(8, N0, true); dv.setUint32(12, count, true);
  bytes.set(new Uint8Array(bits.buffer), 64);
  bytes.set(new Uint8Array(new Float64Array(vals).buffer), 64 + bitBytes);
  return { bytes, count };
}

function makeNode(f, i, j) {
  if (!forcedAt(f, i, j) && nodeTable()) {
    const h = hash3(f * 7919 + i, j, 0x0a11, 0x5ca1);
    const a = -1 + (i + 0.15 + 0.7 * u01(h)) * DA0, b = -1 + (j + 0.15 + 0.7 * u01(rehash(h, 1))) * DA0;
    const node = { f, i, j, a, b, x: 0, y: 0, z: 0, act: false, P: 0, par: undefined, w: 0, seg: null, hash: h, farm: 0 };
    if (a > 1 || b > 1 || i >= N0 || j >= N0) return node;
    faceToVec(f, a, b, VF);
    node.x = VF.x; node.y = VF.y; node.z = VF.z;
    const T = tableNode(f, i, j);
    node.act = T.act; node.P = T.P; node.farm = T.farm;
    return node;
  }
  return makeNodeLive(f, i, j);
}
function makeNodeLive(f, i, j) {
  const h = hash3(f * 7919 + i, j, 0x0a11, 0x5ca1);
  let a = -1 + (i + 0.15 + 0.7 * u01(h)) * DA0, b = -1 + (j + 0.15 + 0.7 * u01(rehash(h, 1))) * DA0;
  const fc = forcedAt(f, i, j);
  const forced = fc !== null;
  if (forced) { a = fc.a; b = fc.b; }
  const node = { f, i, j, a, b, x: 0, y: 0, z: 0, act: false, P: 0, par: undefined, w: 0, seg: null, hash: h, farm: 0 };
  if (a > 1 || b > 1 || i >= N0 || j >= N0) return node;
  faceToVec(f, a, b, VF);
  node.x = VF.x; node.y = VF.y; node.z = VF.z;
  if (forced) {
    computeFields(VF.x, VF.y, VF.z, 6000, FN);
    node.act = true; node.farm = Math.max(0.5, FN.farmBase);
    // a leaf: higher than every active neighbour (no upstream node drains into the lake outlet)
    let pm = (FN.basinW > 0 ? relief : reliefV1)(FN, 6000, null);
    const nx = node.x, ny = node.y, nz = node.z;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const nb = neighbour(f, i, j, di, dj);
      const m = node0(nb.f, nb.i, nb.j);
      if (m.act && m.P + 25 > pm) pm = m.P + 25;
    }
    node.x = nx; node.y = ny; node.z = nz;
    node.P = pm;
    return node;
  }
  const LT = liteFields(VF.x, VF.y, VF.z);
  if (LT.zoneO < 0.35 || LT.coastKm < 1 || LT.density > 0.6) return node;
  computeFields(VF.x, VF.y, VF.z, 6000, FN);
  const F = FN;
  let ok = F.zoneO > 0.55 && F.c > 1500 && F.mount < 0.3 && F.ice < 0.05 && F.canyon < 0.25 && F.farmOK > 0.3 && F.wOX6 < 0.6;
  if (ok) ok = district(VF.x, VF.y, VF.z) > -0.15 - 0.25 * Math.max(F.wOX1, F.wOX3, F.wOX5 * 0.6);
  if (ok) ok = !inG02(VF.x, VF.y, VF.z);
  if (ok) ok = basinMask(VF.x, VF.y, VF.z).inner < 0.15;
  node.act = ok;
  if (ok) { node.farm = F.farmOK; node.P = (F.basinW > 0 ? relief : reliefV1)(F, 6000, null) + 34 * NP.n3(VF.x * R / 52000, VF.y * R / 52000, VF.z * R / 52000); }
  return node;
}

const NB = { f: 0, i: 0, j: 0 };
function neighbour(f, i, j, di, dj) {
  const ii = i + di, jj = j + dj;
  if (ii >= 0 && jj >= 0 && ii < N0 && jj < N0 && -1 + (ii + 0.5) * DA0 < 1 && -1 + (jj + 0.5) * DA0 < 1) { NB.f = f; NB.i = ii; NB.j = jj; return NB; }
  const a = -1 + (ii + 0.5) * DA0, b = -1 + (jj + 0.5) * DA0;
  faceToVec(f, a, b, VF);
  vecToFace(VF.x, VF.y, VF.z, VF);
  NB.f = VF.face;
  NB.i = Math.min(N0 - 1, Math.max(0, Math.floor((VF.a + 1) / DA0)));
  NB.j = Math.min(N0 - 1, Math.max(0, Math.floor((VF.b + 1) / DA0)));
  return NB;
}
function node0(f, i, j) {
  const k = key0(f, i, j);
  let n = C0.get(k);
  if (!n) { trim(); n = makeNode(f, i, j); C0.set(k, n); }
  return n;
}
/** would the main canal n -> m cut through the OX1 basin / its tablelands? (quarter points) */
function crossesBasin(n, m) {
  for (const t of [0.25, 0.5, 0.75]) {
    const x = n.x + (m.x - n.x) * t, y = n.y + (m.y - n.y) * t, z = n.z + (m.z - n.z) * t, l = Math.hypot(x, y, z);
    if (basinMask(x / l, y / l, z / l).inner > 0.3) return true;
  }
  return false;
}
function parent0(n) {
  if (n.par !== undefined) return n.par;
  n.par = null;
  if (!n.act) return null;
  let best = null, bp = n.P, sum = 0, cnt = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const nb = neighbour(n.f, n.i, n.j, di, dj);
    const m = node0(nb.f, nb.i, nb.j);
    if (!m.act || m === n) continue;
    sum += m.P; cnt++;
    if (m.P < bp && !crossesBasin(n, m)) { bp = m.P; best = m; }
  }
  n.par = best;
  const trunk = cnt ? clamp((sum / cnt - n.P) / 40 + 0.35, 0, 1) : 0.3;
  n.w = 40 + 80 * trunk * trunk;
  return best;
}

// ---------------------------------------------------------------------------------------------
// segments: gnomonic 2D frame at the midpoint; mains bend by a sine meander (0 at the nodes)
// ---------------------------------------------------------------------------------------------
function makeSeg(A, B, width, id, bend) {
  const ax = A[0], ay = A[1], az = A[2], bx = B[0], by = B[1], bz = B[2];
  let mx = ax + bx, my = ay + by, mz = az + bz; const ml = Math.hypot(mx, my, mz); mx /= ml; my /= ml; mz /= ml;
  let ex = mz, ez = -mx; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  const nx = my * ez, ny = mz * ex - mx * ez, nz = -my * ex;
  const pa = 1 / (ax * mx + ay * my + az * mz), pb = 1 / (bx * mx + by * my + bz * mz);
  const s = {
    id, w: width, mx, my, mz, ex, ez, nx, ny, nz,
    ax: (ax * ex + az * ez) * pa * R, ay: (ax * nx + ay * ny + az * nz) * pa * R,
    bx: (bx * ex + bz * ez) * pb * R, by: (bx * nx + by * ny + bz * nz) * pb * R,
    len: 1, ux: 0, uy: 0, A, B, reach: null, sl: null, levA: 0, levB: 0, bend: 0, order: 0,
    hash: hash3(Math.round(ax * 1e6), Math.round(ay * 1e6), Math.round(az * 1e6), 0x77),
  };
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  s.len = Math.hypot(dx, dy) || 1; s.ux = dx / s.len; s.uy = dy / s.len;
  s.bend = bend ? (u01(rehash(s.hash, 9)) - 0.5) * 0.24 * s.len : 0;
  return s;
}
/** point at along-fraction t on the (bent) segment, in its frame -> out[0], out[1] */
function segFramePoint(s, t, out) {
  const off = s.bend * Math.sin(Math.PI * t);
  out[0] = s.ax + (s.bx - s.ax) * t - s.uy * off;
  out[1] = s.ay + (s.by - s.ay) * t + s.ux * off;
  return out;
}
function frameToUnit(s, px, py, out) {
  const x = s.mx + (s.ex * px + s.nx * py) / R, y = s.my + (s.ny * py) / R, z = s.mz + (s.ez * px + s.nz * py) / R;
  const l = Math.hypot(x, y, z); out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}
const FP2 = [0, 0];
function segPoint(s, t, out) { segFramePoint(s, t, FP2); return frameToUnit(s, FP2[0], FP2[1], out); }

function seg0(n) {
  if (n.seg !== null) return n.seg;
  const p = parent0(n);
  if (!p) { n.seg = false; return false; }
  n.seg = makeSeg([n.x, n.y, n.z], [p.x, p.y, p.z], n.w, `C0-${n.f}-${n.i}-${n.j}`, true);
  n.seg.node = n; n.seg.parent = p; n.seg.order = 0;
  // laterals of mains near the OX1 basin must not run into it (checked per lateral)
  n.seg.nearBasin = n.seg.mx * BC[0] + n.seg.my * BC[1] + n.seg.mz * BC[2] > BC_DOT;
  return n.seg;
}

// single sluice step limit (m): larger drops become a staircase of sluices (decision D2: <= ~14 m)
const MAX_STEP = 12;
/** terrain-based target levels (terrain - freeboard) at nSamples+1 evenly spaced points of a channel */
function sampleLevels(s, nSamples, free) {
  const levs = new Float64Array(nSamples + 1);
  const P = [0, 0, 0];
  for (let k = 0; k <= nSamples; k++) { segPoint(s, k / nSamples, P); levs[k] = Math.max(0.8, levelTerrain(P[0], P[1], P[2]) - free); }
  return levs;
}
const MAX_LIFT = 20;           // single pump lift (m)
const CUT_MAIN = 10, CUT_LAT = 6;   // deepest channel cut into the ground before a pump lifts the level (m)
/** staircase of level changes a -> b spread over (t0, t1): drops (sluices) or lifts (pumps) */
function addSteps(ev, t0, t1, a, b, maxStep) {
  const m = Math.max(1, Math.ceil(Math.abs(a - b) / maxStep - 1e-9));
  for (let i = 0; i < m; i++) ev.push({ t: t0 + ((t1 - t0) * (i + 1)) / (m + 1), from: a + ((b - a) * i) / m, to: a + ((b - a) * (i + 1)) / m });
}
/**
 * Quantised level profile (flat reaches, sluices, pumps); water flows toward +t (t = 0 is upstream). The level
 * is the running minimum of the target levels `levs` (terrain - freeboard at t = k/n), quantised to drops
 * >= `step`; where the ground rises more than `cut` above the water a pump lifts it back to the target.
 * `feed` (optional) = level of the feeding channel at t = 0 (offtake sluice below it / pump above it).
 * Sets s.reach ([[t, level from t on]] ascending t), s.sl (sluices {t, up, down}, up >= down, drop <=
 * MAX_STEP: larger drops become staircases), s.pumps ({t, down, up}, lift <= MAX_LIFT), s.levA / s.levB, s.dir.
 */
function buildProfile(s, levs, step, cut, feed) {
  const n = levs.length - 1;
  const ev = [];
  let cur = levs[0], t0 = 0;
  if (feed !== undefined) {
    cur = feed; t0 = 0.3 / n;
    if (levs[0] > feed + cut) { addSteps(ev, 0, t0, feed, levs[0], MAX_LIFT); cur = levs[0]; }
    else if (feed - levs[0] >= 0.05) { addSteps(ev, 0, t0, feed, levs[0], MAX_STEP); cur = levs[0]; }
  }
  const top = feed !== undefined ? feed : levs[0];
  for (let k = 1; k <= n; k++) {
    const tp = k === 1 ? t0 : (k - 1) / n, tk = k / n;
    if (levs[k] > cur + cut) { addSteps(ev, tp, tk, cur, levs[k], MAX_LIFT); cur = levs[k]; continue; }
    const want = Math.min(cur, levs[k]);
    if (cur - want >= step) { addSteps(ev, tp, tk, cur, want, MAX_STEP); cur = want; }
  }
  const reach = [[0, top]];
  for (const e of ev) reach.push([e.t, e.to]);
  s.reach = reach; s.dir = 1;
  s.sl = ev.filter((e) => e.from >= e.to).map((e) => ({ t: e.t, up: e.from, down: e.to }));
  s.pumps = ev.filter((e) => e.from < e.to).map((e) => ({ t: e.t, down: e.from, up: e.to }));
  s.levA = reach[0][1]; s.levB = reach[reach.length - 1][1];
  return s;
}
function levels0(s) {
  if (!s.reach) {
    if (s.pseudo) outletReach(s);
    else buildProfile(s, sampleLevels(s, Math.max(4, Math.ceil(s.len / 1000)), 2.6), 3.0, CUT_MAIN);
  }
  return s;
}
// ---- OX1 lake outlet (basin.js): an explicit main canal from the outlet sill (lake level) down a sluice staircase
// to the forced node, where the regular main canal network continues; carries laterals / ditches like any main
let OSEG = null;
export function outletSeg() {
  if (OSEG) return OSEG;
  const A = basinToUnit(OUTLET.pts[0][0], OUTLET.pts[0][1]), B = basinToUnit(OUTLET.end[0], OUTLET.end[1]);
  OSEG = makeSeg(A, B, OUTLET.width, OUTLET.id, false);
  OSEG.order = 0; OSEG.pseudo = true; OSEG.nearBasin = true; OSEG.node = { farm: 1 };
  return OSEG;
}
function outletReach(s) {
  const Lk = OUTLET.level;
  const end = Math.min(Lk - 1, outletNodeLevel());
  const n = Math.max(1, Math.ceil((Lk - end) / 11.5 - 1e-9));
  const t0 = 140 / s.len, t1 = (s.len - 450) / s.len;
  const reach = [[0, Lk]], sl = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? t0 : t0 + ((t1 - t0) * i) / (n - 1);
    const up = Lk - ((Lk - end) * i) / n, down = Lk - ((Lk - end) * (i + 1)) / n;
    reach.push([t, down]); sl.push({ t, up, down });
  }
  s.reach = reach; s.sl = sl; s.pumps = []; s.dir = 1; s.levA = Lk; s.levB = end;
}
/** canalsInTile record of the OX1 lake outlet (id 'OX1-BL1-OUT') */
export function outletCanal() { return segToCanal(levels0(outletSeg()), 0, 'canal'); }
function segLevel(s, t) {
  const r = s.reach;
  let L = r[0][1];
  for (let k = 1; k < r.length; k++) { if (t >= r[k][0]) L = r[k][1]; else break; }
  return L;
}

// distance from a unit vector to the (bent) segment; fills SD
const SD = { d: 0, t: 0, along: 0, cross: 0, px: 0, py: 0 };
function segDist(s, x, y, z) {
  const dot = x * s.mx + y * s.my + z * s.mz;
  if (dot < 0.95) { SD.d = 1e9; SD.cross = 0; SD.along = 0; SD.t = 0; return 1e9; }
  const ip = R / dot;
  const px = (x * s.ex + z * s.ez) * ip, py = (x * s.nx + y * s.ny + z * s.nz) * ip;
  const qx = px - s.ax, qy = py - s.ay;
  const al = qx * s.ux + qy * s.uy;
  let cr = -qx * s.uy + qy * s.ux;
  let t = al / s.len, d;
  if (t < 0) { t = 0; d = Math.hypot(qx, qy); }
  else if (t > 1) { t = 1; d = Math.hypot(px - s.bx, py - s.by); }
  else {
    const off = s.bend * Math.sin(Math.PI * t);
    const sl = s.bend * Math.PI / s.len * Math.cos(Math.PI * t);
    cr -= off;
    d = Math.abs(cr) / Math.sqrt(1 + sl * sl);
  }
  SD.d = d; SD.t = t; SD.along = al; SD.cross = cr; SD.px = px; SD.py = py;
  return d;
}

function cellList0(f, i, j) {
  const k = key0(f, i, j);
  let L = L0.get(k);
  if (L) return L;
  L = [];
  const a = -1 + (i + 0.5) * DA0, b = -1 + (j + 0.5) * DA0;
  faceToVec(f, Math.min(1, a), Math.min(1, b), VF);
  const cx = VF.x, cy = VF.y, cz = VF.z;
  const lim = S0 * 0.8 + LAT_MAX + DITCH_LEN + 600;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const nb = neighbour(f, i, j, di, dj);
    const n = node0(nb.f, nb.i, nb.j);
    const s = seg0(n);
    if (!s || L.indexOf(s) >= 0) continue;
    if (segDist(s, cx, cy, cz) < lim) L.push(s);
  }
  const os = outletSeg();
  if (os.mx * cx + os.my * cy + os.mz * cz > 0.99 && segDist(os, cx, cy, cz) < lim) L.push(os);
  L0.set(k, L);
  return L;
}

// ---------------------------------------------------------------------------------------------
// laterals (order 1) and ditches (order 2), analytic from the trunk
// ---------------------------------------------------------------------------------------------
const LAT = { ok: false, ox: 0, oy: 0, dx: 0, dy: 0, len: 0, w: 0, k: 0, side: 0, h: 0, t: 0 };
const LP = [0, 0];
function lateral(s, k, side) {
  const h = hash3(k, side, s.hash, 0x1a7e);
  LAT.ok = false;
  const off = (k + 0.2 + 0.6 * u01(h)) * LAT_SP;
  if (off < 300 || off > s.len - 300) return LAT;
  if (u01(rehash(h, 1)) < 0.12) return LAT;
  const t = off / s.len;
  // local tangent of the bent trunk
  const sl = s.bend * Math.PI / s.len * Math.cos(Math.PI * t);
  let tx = s.ux - s.uy * sl, ty = s.uy + s.ux * sl; const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
  const ang = (90 + (u01(rehash(h, 2)) - 0.5) * 50 + (u01(rehash(h, 6)) < 0.5 ? 12 : -12)) * Math.PI / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang) * side;
  LAT.dx = tx * ca - ty * sa; LAT.dy = ty * ca + tx * sa;
  segFramePoint(s, t, LP);
  LAT.ox = LP[0] + LAT.dx * s.w * 0.5; LAT.oy = LP[1] + LAT.dy * s.w * 0.5;
  LAT.len = LAT_MAX * (0.16 + 0.84 * Math.pow(u01(rehash(h, 3)), 0.8)) * clamp(0.35 + s.node.farm * 0.75, 0, 1);
  LAT.w = 10 + 20 * Math.pow(u01(rehash(h, 4)), 1.5) * (LAT.len / LAT_MAX + 0.3);
  LAT.k = k; LAT.side = side; LAT.h = h; LAT.t = t;
  if (s.nearBasin) {
    frameToUnit(s, LAT.ox + LAT.dx * LAT.len, LAT.oy + LAT.dy * LAT.len, LE);
    if (basinMask(LE[0], LE[1], LE[2]).inner > 0.2) return LAT;
    frameToUnit(s, LAT.ox + LAT.dx * LAT.len * 0.5, LAT.oy + LAT.dy * LAT.len * 0.5, LE);
    if (basinMask(LE[0], LE[1], LE[2]).inner > 0.2) return LAT;
  }
  LAT.ok = true;
  return LAT;
}

/** Query the canal network at fields F (geometry only; levels are lazy). Fills CQ. */
export const CQ = {
  d0: 1e9, d1: 1e9, d2: 1e9, dist: 1e9, width: 0, order: -1, fx: 0, fy: 0, id: '',
  o0: null, o0d: 1e9, o0t: 0, o1: null, o1d: 1e9, o1t: 0, o1w: 0, o1k: 0, o1s: 0, o1len: 0, o1fx: 0, o1fy: 0, o1lt: 0,
  o2d: 1e9, o2w: 0, o2fx: 0, o2fy: 0, o2kd: 0,
};
let QX = NaN, QY = NaN, QZ = NaN;
export function canalQuery(F) {
  if (F.x === QX && F.y === QY && F.z === QZ) return CQ;
  QX = F.x; QY = F.y; QZ = F.z;
  CQ.d0 = 1e9; CQ.d1 = 1e9; CQ.d2 = 1e9; CQ.dist = 1e9; CQ.order = -1; CQ.width = 0; CQ.id = '';
  CQ.o0 = null; CQ.o0d = 1e9; CQ.o1 = null; CQ.o1d = 1e9; CQ.o2d = 1e9;
  if (F.zoneO < 0.35 || F.c < 200 || F.ice > 0.3) return CQ;
  const x = F.x, y = F.y, z = F.z;
  vecToFace(x, y, z, VF);
  const f = VF.face;
  const i0 = Math.min(N0 - 1, Math.max(0, Math.floor((VF.a + 1) / DA0))), j0 = Math.min(N0 - 1, Math.max(0, Math.floor((VF.b + 1) / DA0)));
  const L = cellList0(f, i0, j0);
  for (let q = 0; q < L.length; q++) {
    const s = L[q];
    const d = segDist(s, x, y, z);
    if (d > LAT_MAX + DITCH_LEN + 300) continue;
    if (d < CQ.o0d) { CQ.o0 = s; CQ.o0d = d; CQ.o0t = SD.t; }
    const side = SD.cross >= 0 ? 1 : -1;
    const px = SD.px, py = SD.py;
    const kc = Math.floor(SD.along / LAT_SP);
    for (let k = kc - 5; k <= kc + 5; k++) {
      const lt = lateral(s, k, side);
      if (!lt.ok) continue;
      const qx = px - lt.ox, qy = py - lt.oy;
      const al = qx * lt.dx + qy * lt.dy, cr = qx * -lt.dy + qy * lt.dx;
      let dd;
      if (al < 0) dd = Math.hypot(qx, qy); else if (al > lt.len) dd = Math.hypot(qx - lt.dx * lt.len, qy - lt.dy * lt.len); else dd = Math.abs(cr);
      if (dd < CQ.o1d) {
        CQ.o1d = dd; CQ.o1 = s; CQ.o1t = al / lt.len; CQ.o1w = lt.w; CQ.o1k = k; CQ.o1s = side; CQ.o1len = lt.len;
        CQ.o1fx = lt.dx; CQ.o1fy = lt.dy; CQ.o1lt = lt.t;
        CQ.o2d = 1e9;
        if (al > 120 && al < lt.len - 60 && Math.abs(cr) > lt.w * 0.5 + 6) {
          const kd = Math.round(al / DITCH_SP);
          const hd = hash3(kd, k * 2 + (side > 0 ? 1 : 0), s.hash, 0xd17c);
          const dl = DITCH_LEN * (0.5 + 0.5 * u01(hd));
          if (Math.abs(cr) < dl) {
            CQ.o2d = Math.abs(al - kd * DITCH_SP); CQ.o2w = 3 + 3 * u01(rehash(hd, 3)); CQ.o2kd = kd;
            const sg = cr >= 0 ? 1 : -1; CQ.o2fx = -lt.dy * sg; CQ.o2fy = lt.dx * sg;
          }
        }
      }
    }
  }
  CQ.d0 = CQ.o0d; CQ.d1 = CQ.o1d; CQ.d2 = CQ.o2d;
  let best = 1e9;
  if (CQ.o0) { const r = CQ.o0d - CQ.o0.w * 0.5; if (r < best) { best = r; CQ.order = 0; CQ.dist = CQ.o0d; CQ.width = CQ.o0.w; CQ.id = CQ.o0.id; CQ.fx = CQ.o0.ux; CQ.fy = CQ.o0.uy; } }
  if (CQ.o1) {
    // lateral / ditch ids are built lazily (canalId()): no string allocation per query
    const r = CQ.o1d - CQ.o1w * 0.5; if (r < best) { best = r; CQ.order = 1; CQ.dist = CQ.o1d; CQ.width = CQ.o1w; CQ.id = ''; CQ.fx = CQ.o1fx; CQ.fy = CQ.o1fy; }
    if (CQ.o2d < 1e8) { const r2 = CQ.o2d - CQ.o2w * 0.5; if (r2 < best) { best = r2; CQ.order = 2; CQ.dist = CQ.o2d; CQ.width = CQ.o2w; CQ.id = ''; CQ.fx = CQ.o2fx; CQ.fy = CQ.o2fy; } }
  }
  return CQ;
}

function lateralSeg(s, k, side) {
  const id = `${s.id}-L${side > 0 ? 'l' : 'r'}${k}`;
  let L = LV.get(id);
  if (L !== undefined) return L;
  trim();
  const lt = lateral(s, k, side);
  if (!lt.ok) { LV.set(id, null); return null; }
  const A = frameToUnit(s, lt.ox, lt.oy, [0, 0, 0]), B = frameToUnit(s, lt.ox + lt.dx * lt.len, lt.oy + lt.dy * lt.len, [0, 0, 0]);
  L = makeSeg(A, B, lt.w, id, false);
  L.order = 1; L.trunk = s; L.trunkT = lt.t; L.k = k; L.side = side;
  LV.set(id, L);
  return L;
}
/**
 * Lateral levels: every lateral takes its water from the main canal (offtake sluice at t = 0 when it starts
 * below the main canal's level, offtake pump when the ground there lies more than CUT_LAT above it) and
 * flows away from it, dropping through sluices and lifted by pumps where the ground rises (提水灌溉).
 */
function lateralLevels(L) {
  if (L.reach) return L;
  levels0(L.trunk);
  const lj = segLevel(L.trunk, L.trunkT);
  buildProfile(L, sampleLevels(L, Math.max(3, Math.ceil(L.len / 600)), 1.6), 2.0, CUT_LAT, lj);
  return L;
}
/** water level of field ditch kd of lateral L (flat; follows the ground at its junction with the lateral) */
const DT = [0, 0, 0];
function ditchLevel(L, kd) {
  const m = L.dl || (L.dl = new Map());
  let v = m.get(kd);
  if (v === undefined) {
    const al = kd * DITCH_SP;
    frameToUnit(L, L.ax + L.ux * al, L.ay + L.uy * al, DT);
    v = Math.max(0.8, levelTerrain(DT[0], DT[1], DT[2]) - 0.9);
    m.set(kd, v);
  }
  return v;
}
function levelOf(order) {
  if (order === 0) { levels0(CQ.o0); return segLevel(CQ.o0, CQ.o0t); }
  const L = lateralSeg(CQ.o1, CQ.o1k, CQ.o1s);
  if (!L) return 0;
  if (order === 2) return ditchLevel(L, CQ.o2kd);
  lateralLevels(L);
  return segLevel(L, clamp(CQ.o1t, 0, 1));
}
/** stable id of the overall nearest channel (after canalQuery) */
export function canalId() {
  if (CQ.order === 0) return CQ.o0.id;
  if (CQ.order < 0 || !CQ.o1) return '';
  const lid = `${CQ.o1.id}-L${CQ.o1s > 0 ? 'l' : 'r'}${CQ.o1k}`;
  return CQ.order === 2 ? `${lid}-d` : lid;
}

/** water level of the overall nearest channel (after canalQuery) */
export function canalLevel() { return CQ.order < 0 ? 0 : levelOf(CQ.order); }

/** +1 when the nearest channel flows along CQ.fx/fy, -1 when against it (collector laterals; after canalLevel) */
export function canalFlowSign() {
  if (CQ.order !== 1 || !CQ.o1) return 1;
  const L = lateralSeg(CQ.o1, CQ.o1k, CQ.o1s);
  return L && L.dir < 0 ? -1 : 1;
}

const FPOT = { farm: 0, dist: 1e9 };
/** farmland potential (O look): irrigated bands along mains and laterals, raw red soil beyond */
export function farmPotential(F) {
  FPOT.farm = 0; FPOT.dist = 1e9;
  if (F.farmOK < 0.02) return FPOT;
  canalQuery(F);
  const d0 = CQ.d0, d1 = CQ.d1;
  FPOT.dist = Math.min(d0, d1);
  const X = F.X, Y = F.Y, Z = F.Z;
  const wob = 0.78 + 0.22 * NP.n3(X / 4000, Y / 4000 + 1, Z / 4000);
  const irr = Math.max(Math.exp(-((d0 / (2600 * wob)) ** 2)), 0.95 * Math.exp(-((d1 / (900 * wob)) ** 2)));
  FPOT.farm = clamp(F.farmOK * smoothstep(0.1, 0.62, irr), 0, 1);
  return FPOT;
}

function carveOne(h, d, w, lev, order, fade, M) {
  const bank = w * 0.5 + Math.max(2, w * 0.12);
  const fb = order === 0 ? 1.1 : order === 1 ? 0.7 : 0.35;
  const top = lev + fb;
  const eNeed = h > top ? (h - top) / 0.9 : (top - h) / 0.28;
  if (d > bank + eNeed + 1) return h;
  const depth = order === 0 ? 2.8 + w * 0.012 : order === 1 ? 1.6 : 0.7;
  let t;
  if (d < w * 0.5) { const u = d / (w * 0.5); t = lev - depth * (1 - u * u * u * u) - 0.15; }
  else if (d < bank) { const u = (d - w * 0.5) / (bank - w * 0.5); t = lev - 0.15 + (top - lev + 0.15) * smoothstep(0, 1, u); }
  else { const e = d - bank; t = clamp(h, top - e * 0.28, top + e * 0.9); }
  if (M && d < bank + 6) M.wet = Math.max(M.wet, 1 - smoothstep(bank, bank + 6, d));
  return h + (t - h) * fade;
}

/** terrain carving of canals (flat beds, banks above water, levees / cuts). Returns new h. */
export function carveCanals(F, h, mw, M) {
  if (F.zoneO < 0.35 || F.c < 200 || mw > 140) return h;
  canalQuery(F);
  if (CQ.o0 && CQ.o0d < CQ.o0.w * 0.5 + 220) {
    const fade = clamp((140 - mw) / 60, 0, 1);
    if (fade > 0) h = carveOne(h, CQ.o0d, CQ.o0.w, levelOf(0), 0, fade, M);
  }
  if (CQ.o1 && CQ.o1d < 160) {
    const fade = clamp((30 - mw) / 12, 0, 1);
    if (fade > 0) h = carveOne(h, CQ.o1d, CQ.o1w, levelOf(1), 1, fade, M);
  }
  if (CQ.o2d < 60) {
    const fade = clamp((6 - mw) / 3, 0, 1);
    if (fade > 0) h = carveOne(h, CQ.o2d, CQ.o2w, levelOf(2), 2, fade, M);
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// vector output for a cube-face tile (hydro.canalsInTile)
// ---------------------------------------------------------------------------------------------
const toLL = (p) => [Math.asin(Math.max(-1, Math.min(1, p[1]))) * 180 / Math.PI, Math.atan2(p[0], p[2]) * 180 / Math.PI];
function segToCanal(s, order, kind) {
  const P = [0, 0, 0];
  const pts = [];
  const n = Math.max(2, Math.ceil(s.len / (order === 0 ? 900 : 700)) + 1);
  for (let k = 0; k < n; k++) { segPoint(s, k / (n - 1), P); pts.push(toLL(P)); }
  const sluices = s.sl.map((q) => {
    segPoint(s, q.t, P); const ll = toLL(P);
    const sl = s.bend * Math.PI / s.len * Math.cos(Math.PI * q.t);
    const tx = s.ux - s.uy * sl, ty = s.uy + s.ux * sl;
    // heading = downstream flow direction (the channel flows toward -t when s.dir < 0)
    const heading = ((Math.atan2(tx, ty) * 180) / Math.PI + (s.dir < 0 ? 540 : 360)) % 360;
    return { lat: ll[0], lon: ll[1], upLevel: +q.up.toFixed(2), downLevel: +q.down.toFixed(2), heading: +heading.toFixed(1) };
  });
  // pump lifts (level rises downstream; not sluices): {lat, lon, downLevel (intake), upLevel (outlet), heading}
  const pumps = (s.pumps || []).map((q) => {
    segPoint(s, q.t, P); const ll = toLL(P);
    const sl = s.bend * Math.PI / s.len * Math.cos(Math.PI * q.t);
    const tx = s.ux - s.uy * sl, ty = s.uy + s.ux * sl;
    const heading = ((Math.atan2(tx, ty) * 180) / Math.PI + 360) % 360;
    return { lat: ll[0], lon: ll[1], downLevel: +q.down.toFixed(2), upLevel: +q.up.toFixed(2), heading: +heading.toFixed(1) };
  });
  // flow: +1 = water flows along the point order (from points[0]); levels drop only at sluices
  return { id: s.id, kind, order, flow: s.dir < 0 ? -1 : 1, width: +s.w.toFixed(1), level0: +s.levA.toFixed(2), level1: +s.levB.toFixed(2), points: pts, sluices, pumps };
}

/** canals overlapping the face rectangle [a0,a1]x[b0,b1]; laterals from tile level 9, ditches from 13 */
export function canalsInRect(f, a0, a1, b0, b1, level) {
  const out = [];
  const seen = new Set();
  const m0 = DA0 * 0.6;
  const i0 = Math.max(0, Math.floor((a0 - m0 + 1) / DA0)), i1 = Math.min(N0 - 1, Math.floor((a1 + m0 + 1) / DA0));
  const j0 = Math.max(0, Math.floor((b0 - m0 + 1) / DA0)), j1 = Math.min(N0 - 1, Math.floor((b1 + m0 + 1) / DA0));
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 3000) return out;
  const inRect = (p, m) => { vecToFace(p[0], p[1], p[2], VF); return VF.face === f && VF.a >= a0 - m && VF.a <= a1 + m && VF.b >= b0 - m && VF.b <= b1 + m; };
  const P = [0, 0, 0];
  const mT = (a1 - a0) * 0.02;
  const OS = outletSeg();
  for (let j = j0; j <= j1 + 1; j++) for (let i = i0; i <= i1; i++) {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      // one extra pass (j = j1 + 1) only for the OX1 lake outlet main
      let s;
      if (j > j1) { if (i !== i0 || di || dj) continue; s = OS; }
      else {
        const nb = neighbour(f, i, j, di, dj);
        const n = node0(nb.f, nb.i, nb.j);
        if (!n.act) continue;
        s = seg0(n);
      }
      if (!s || seen.has(s.id)) continue;
      let touch = false;
      for (let k = 0; k <= 8 && !touch; k++) { segPoint(s, k / 8, P); if (inRect(P, mT + (level >= 9 ? DA0 * 0.45 : 0))) touch = true; }
      if (!touch) continue;
      seen.add(s.id);
      levels0(s);
      let trunkIn = false;
      for (let k = 0; k <= 8 && !trunkIn; k++) { segPoint(s, k / 8, P); if (inRect(P, mT)) trunkIn = true; }
      if (trunkIn) out.push(segToCanal(s, 0, 'canal'));
      if (level < 9) continue;
      const nk = Math.ceil(s.len / LAT_SP) + 1;
      for (let k = -1; k <= nk; k++) for (const side of [1, -1]) {
        const L = lateralSeg(s, k, side);
        if (!L) continue;
        let lt = false;
        for (let q = 0; q <= 6 && !lt; q++) { segPoint(L, q / 6, P); if (inRect(P, mT)) lt = true; }
        if (!lt) continue;
        lateralLevels(L);
        out.push(segToCanal(L, 1, 'canal'));
        if (level < 13) continue;
        const nd = Math.floor(L.len / DITCH_SP);
        for (let kd = 1; kd <= nd; kd++) {
          const al = kd * DITCH_SP;
          if (al < 120 || al > L.len - 60) continue;
          const hd = hash3(kd, k * 2 + (side > 0 ? 1 : 0), s.hash, 0xd17c);
          const dl = DITCH_LEN * (0.5 + 0.5 * u01(hd));
          const w2 = 3 + 3 * u01(rehash(hd, 3));
          const cx = L.ax + L.ux * al, cy = L.ay + L.uy * al;
          if (!inRect(frameToUnit(L, cx, cy, P), mT + DITCH_LEN / FACE_ARC)) continue;
          const pts = [];
          for (const sg of [-1, 0, 1]) { frameToUnit(L, cx - L.uy * dl * sg, cy + L.ux * dl * sg, P); pts.push(toLL(P)); }
          const lv = ditchLevel(L, kd);
          out.push({ id: `${L.id}-d${kd}`, kind: 'ditch', order: 2, width: +w2.toFixed(1), level0: +lv.toFixed(2), level1: +lv.toFixed(2), points: pts, sluices: [] });
        }
      }
    }
  }
  return out;
}

export { node0, parent0, N0, DA0 };
