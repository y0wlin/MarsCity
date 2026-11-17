// OX4 北冠冰缘 meltwater system (pure, deterministic, built lazily once per thread). OWNER: terrain-fn.
//
// §5 04 "进水池接冰崖脚下的水道": along the OX4 ice cliffs an ice-marginal meltwater channel runs ~260 m
// outside the cliff foot; it drains in both directions from local divides to outlets at the low points of
// the foot (every 12-40 km), where an outflow channel leaves the foot away from the ice, steering down the
// lowland for 5-12 km into a meltwater lake. A forebay pool (融水前池, pump-station intake) sits at every
// outflow head next to the foot channel, at the channel's level.
//
// Geometry: the channel is the iso-line q = Q_CH of the band-limited ice-margin metric (field.northIceQ at
// mw 300 m, contour-followed in 200 m steps from 45E both ways while the OX4 cliff weight > 0.4, ~10E-80E);
// the published cliff-foot line is the iso-line q = Q_FOOT next to it. Levels come from the natural relief
// (mw 300 m, no water carving) and descend monotonically from each divide to its outlet (no sluices: natural
// channels). Everything depends only on field.js / relief.js (no water bodies) -> no cycles.
//
//   meltSystem()          -> the lazily built system (unit-vector arrays; internal)
//   meltQuery(x, y, z)    -> nearest channel / pool at a unit vector (fills MQ; for the water carver)
//   meltPublic()          -> JSON-friendly lat/lon description (hydro.iceFootSystem)
//   meltChannelsInRect(f, a0, a1, b0, b1) / meltPoolsInRect(...) -> hydro.canalsInTile / lakesInTile parts

import { R } from '../../core/constants.js';
import { vecToFace } from '../../core/geo.js';
import { northIceQ, ox4Weight, computeFields, newFields } from './field.js';
import { relief } from './relief_v1.js';   // frozen fix-round-1 relief: stable OX4 layout (ids / levels)
import { hash3, rehash, u01, makeNoise } from './noise.js';

const DEG = Math.PI / 180;
const MW_TRACE = 300, Q_CH = -0.36, Q_FOOT = -0.10, STEP = 200, OX4_MIN = 0.4;
const FREE = 2.6;              // channel water level below the (smoothed) foot terrain (m)
const CUT = 12;                // deepest channel cut into the natural ground (m)
const OUT_STEP = 250;          // outflow path step (m)
const CELL = 2000;             // spatial hash cell (m)
const NM = makeNoise(811);
const FT = newFields();

let SYS = null;
const cellKey = (i, j, k) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);

function unit(lat, lon, o) { const la = lat * DEG, lo = lon * DEG, c = Math.cos(la); o[0] = c * Math.sin(lo); o[1] = Math.sin(la); o[2] = c * Math.cos(lo); return o; }
const U3 = [0, 0, 0];
function qAt(lat, lon) { unit(lat, lon, U3); return northIceQ(U3[0], U3[1], U3[2], lat, MW_TRACE); }
/** gradient of q (km per km = dimensionless) in local east / north */
function qGrad(lat, lon, out) {
  const e = 40, dla = e / R / DEG, dlo = e / (R * Math.cos(lat * DEG)) / DEG;
  out[0] = (qAt(lat, lon + dlo) - qAt(lat, lon - dlo)) / (2 * e) * 1000;
  out[1] = (qAt(lat + dla, lon) - qAt(lat - dla, lon)) / (2 * e) * 1000;
  return out;
}
const G2 = [0, 0];
/** Newton projection of (lat, lon) onto the iso-line q = q0 along the gradient */
function project(lat, lon, q0, out) {
  for (let it = 0; it < 4; it++) {
    const v = qAt(lat, lon) - q0;
    if (Math.abs(v) < 2e-5) break;
    qGrad(lat, lon, G2);
    const g2 = G2[0] * G2[0] + G2[1] * G2[1] || 1e-9;
    const s = Math.max(-400, Math.min(400, -v * 1000 / g2));
    lat += G2[1] * s / R / DEG; lon += G2[0] * s / (R * Math.cos(lat * DEG)) / DEG;
  }
  out[0] = lat; out[1] = lon;
  return out;
}
/** natural terrain (no water bodies) at mw 300 m */
function terrain(lat, lon) {
  unit(lat, lon, U3);
  computeFields(U3[0], U3[1], U3[2], MW_TRACE, FT);
  return relief(FT, MW_TRACE, null);
}

function follow(lat0, lon0, dir) {
  const P = [0, 0];
  project(lat0, lon0, Q_CH, P);
  let lat = P[0], lon = P[1];
  const pts = [[lat, lon]];
  for (let k = 0; k < 20000; k++) {
    qGrad(lat, lon, G2);
    const gl = Math.hypot(G2[0], G2[1]) || 1;
    // tangent: the ice (higher q) on the left when dir = +1
    const te = (G2[1] / gl) * dir, tn = (-G2[0] / gl) * dir;
    lat += tn * STEP / R / DEG; lon += te * STEP / (R * Math.cos(lat * DEG)) / DEG;
    project(lat, lon, Q_CH, P); lat = P[0]; lon = P[1];
    pts.push([lat, lon]);
    unit(lat, lon, U3);
    if (ox4Weight(U3[0], U3[1], U3[2]) < OX4_MIN) break;
    if (k > 50 && Math.abs(lat - pts[0][0]) < 0.002 && Math.abs(lon - pts[0][1]) < 0.006) break;   // closed loop
  }
  return pts;
}

function build() {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  // start on the main margin south of the cap at 45E (OX4 centre): first crossing scanning north
  const lon0 = 45;
  let lat0 = 73, prev = qAt(72.5, lon0);
  for (let la = 72.5; la < 77; la += 0.002) { const v = qAt(la, lon0); if (prev < Q_CH && v >= Q_CH) { lat0 = la; break; } prev = v; }
  const east = follow(lat0, lon0, 1), west = follow(lat0, lon0, -1);
  const ll = [...west.reverse(), ...east.slice(1)];       // west -> east, ice on the left
  const n = ll.length;
  const ch = new Float64Array(n * 3), out = new Float64Array(n * 2);
  const T = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const [la, lo] = ll[k];
    unit(la, lo, U3); ch[k * 3] = U3[0]; ch[k * 3 + 1] = U3[1]; ch[k * 3 + 2] = U3[2];
    qGrad(la, lo, G2);
    const gl = Math.hypot(G2[0], G2[1]) || 1;
    out[k * 2] = -G2[0] / gl; out[k * 2 + 1] = -G2[1] / gl;     // outward (away from the ice), east / north
    T[k] = terrain(la, lo);
  }
  // smoothed foot profile (+-2 km) -> outlets at its low points, 12-40 km apart
  const S = new Float64Array(n);
  for (let k = 0; k < n; k++) { let s = 0, c = 0; for (let q = Math.max(0, k - 10); q <= Math.min(n - 1, k + 10); q++) { s += T[q]; c++; } S[k] = s / c; }
  const cand = [];
  for (let k = 5; k < n - 5; k++) {
    let isMin = true;
    for (let q = Math.max(0, k - 30); q <= Math.min(n - 1, k + 30) && isMin; q++) if (S[q] < S[k] || (S[q] === S[k] && q < k)) isMin = false;
    if (isMin) cand.push(k);
  }
  cand.sort((a, b) => S[a] - S[b] || a - b);
  const outl = [];
  for (const k of cand) if (outl.every((o) => Math.abs(o - k) >= 60)) outl.push(k);
  outl.sort((a, b) => a - b);
  // fill gaps longer than 40 km with the lowest point of the gap
  for (let pass = 0; pass < 4; pass++) {
    const add = [];
    const bounds = [-1, ...outl, n];
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i], b = bounds[i + 1];
      if (b - a <= 200) continue;
      let best = -1;
      for (let k = Math.max(0, a + 60); k <= Math.min(n - 1, b - 60); k++) if (best < 0 || S[k] < S[best]) best = k;
      if (best >= 0) add.push(best);
    }
    if (!add.length) break;
    outl.push(...add); outl.sort((a, b) => a - b);
  }
  // levels: from each divide (highest foot point between two outlets) down to the outlets. The level is the
  // running minimum of the terrain (monotone downstream); where it would lie more than CUT below the ground
  // (a rock knob across the foot) the channel goes dry (meltwater passes under the knob / the ice toe) and,
  // after >= 1.6 km dry on the far side of the crest, resurfaces at the ground level as a new source.
  const L = new Float64Array(n), flow = new Int8Array(n), dry = new Uint8Array(n);
  const bnd = [...outl];
  const fill = (from, to) => {           // from vertex `from` toward `to` (inclusive)
    const st = to > from ? 1 : -1;
    let cur = T[from] - FREE, run = 0;
    for (let k = from; ; k += st) {
      const want = T[k] - FREE;
      let isDry = 0;
      if (want > cur + CUT) {
        run++;
        if (run >= 8 && k !== from && want < T[k - st] - FREE) { cur = want; run = 0; } else isDry = 1;
      } else { cur = Math.min(cur, want); run = 0; }
      if (k === from || cur < L[k] || flow[k] === 0) { L[k] = cur; flow[k] = st; dry[k] = isDry; }
      if (k === to) break;
    }
  };
  for (let k = 0; k < n; k++) L[k] = Infinity;
  if (!bnd.length) bnd.push(n - 1);
  // west end -> first outlet, last outlet -> east end
  fill(0, bnd[0]);
  for (let i = 0; i < bnd.length - 1; i++) {
    const a = bnd[i], b = bnd[i + 1];
    let dv = a;
    for (let k = a; k <= b; k++) if (T[k] > T[dv]) dv = k;
    fill(dv, a); fill(dv, b);
  }
  fill(n - 1, bnd[bnd.length - 1]);
  for (let k = 0; k < n; k++) L[k] = Math.max(0.8, L[k]);
  // no wet bits shorter than 3 vertices
  for (let k = 0; k < n;) {
    if (dry[k]) { k++; continue; }
    let e = k; while (e + 1 < n && !dry[e + 1]) e++;
    if (e - k < 2) for (let q = k; q <= e; q++) dry[q] = 1;
    k = e + 1;
  }
  // widths grow with the drained length toward each outlet (18 -> 44 m), gentle along-channel variation
  const W = new Float64Array(n);
  {
    const acc = new Float64Array(n);
    for (let k = 1; k < n; k++) if (flow[k] > 0 && flow[k - 1] > 0) acc[k] = acc[k - 1] + STEP;
    for (let k = n - 2; k >= 0; k--) if (flow[k] < 0 && flow[k + 1] < 0) acc[k] = acc[k + 1] + STEP;
    for (let k = 0; k < n; k++) {
      const v = 0.5 + 0.5 * NM.n3(ch[k * 3] * R / 9000, ch[k * 3 + 1] * R / 9000, ch[k * 3 + 2] * R / 9000);
      W[k] = 18 + 20 * Math.min(1, acc[k] / 25000) + 6 * v;
    }
  }
  // outflow channels + forebay pools + end lakes
  const outflows = [], pools = [];
  const Q = [0, 0];
  for (let oi = 0; oi < outl.length; oi++) {
    const k = outl[oi];
    if (dry[k]) continue;
    const h = hash3(k, oi, 0x0f4, 0x3e1);
    const [la0, lo0] = ll[k];
    let de = out[k * 2], dn = out[k * 2 + 1];
    const lev0 = L[k];
    // forebay pool next to the foot channel (outward side), at the channel's level
    const pr = 120 + 90 * u01(rehash(h, 1));
    const poff = W[k] * 0.5 + pr * 0.75;
    const pla = la0 + dn * poff / R / DEG, plo = lo0 + de * poff / (R * Math.cos(la0 * DEG)) / DEG;
    pools.push({ id: `MP-${oi}`, kind: 'forebay', lat: pla, lon: plo, r: pr, level: lev0, depth: 4 + 3 * u01(rehash(h, 2)), out: oi });
    // outflow: starts at the pool's outer rim, steers down the lowland inside a +-35 deg cone around the outward
    // direction (3 probes 500 m ahead), gentle meander; levels = running minimum of the terrain
    const len = 5000 + 7000 * u01(rehash(h, 3));
    const pts = [], levs = [], wid = [], tts = [];
    let la = pla + dn * pr / R / DEG, lo = plo + de * pr / (R * Math.cos(pla * DEG)) / DEG;
    let cur = lev0;
    const ph = u01(rehash(h, 4)) * 6.283, wl = 2600 + 1800 * u01(rehash(h, 5));
    let ce = de, cn = dn;
    for (let s = 0; s <= len; s += OUT_STEP) {
      const tH = terrain(la, lo);
      // the outflow ends in its lake where it would cut deeper than CUT or turn back toward the ice
      if (pts.length >= 2 && (tH - FREE > cur + CUT || qAt(la, lo) > Q_CH * 0.6)) break;
      cur = Math.min(cur, tH - FREE);
      pts.push([la, lo]); levs.push(Math.max(0.8, cur)); wid.push(26 + 22 * Math.min(1, s / 4000)); tts.push(tH);
      // choose the lowest of three probe directions (cone around the outward direction)
      let bestE = ce, bestN = cn, bestH = Infinity;
      for (const a of [-0.6, 0, 0.6]) {
        const ca = Math.cos(a), sa = Math.sin(a);
        const pe = ce * ca - cn * sa, pn = cn * ca + ce * sa;
        // keep inside the outward cone
        if (pe * de + pn * dn < Math.cos(35 * DEG)) continue;
        const hh = terrain(la + pn * 500 / R / DEG, lo + pe * 500 / (R * Math.cos(la * DEG)) / DEG);
        if (hh < bestH - 0.5 || (Math.abs(hh - bestH) <= 0.5 && a === 0)) { bestH = hh; bestE = pe; bestN = pn; }
      }
      // meander
      const m = 0.22 * Math.sin(ph + (2 * Math.PI * s) / wl);
      const cm = Math.cos(m), sm = Math.sin(m);
      ce = bestE * cm - bestN * sm; cn = bestN * cm + bestE * sm;
      const l = Math.hypot(ce, cn) || 1; ce /= l; cn /= l;
      la += cn * OUT_STEP / R / DEG; lo += ce * OUT_STEP / (R * Math.cos(la * DEG)) / DEG;
    }
    // the meltwater lake sits where the outflow lies closest to the ground (second half of its course): the
    // lake level then meets the lowland instead of lying in a pit; the outflow ends in it
    let li = pts.length - 1;
    for (let i = Math.floor(pts.length / 2); i < pts.length; i++) if (tts[i] - levs[i] < tts[li] - levs[li] - 0.25) li = i;
    pts.length = li + 1; levs.length = li + 1; wid.length = li + 1;
    let lr = 350 + 400 * u01(rehash(h, 6));
    const [lla, llo] = pts[li];
    // shrink the lake until its rim meets the ground (<= 6 m above the water), at least 150 m
    for (let it = 0; it < 8 && lr > 150; it++) {
      let hi = -Infinity;
      for (let q = 0; q < 6; q++) {
        const th = q * Math.PI / 3, dE = Math.cos(th) * lr, dN = Math.sin(th) * lr;
        hi = Math.max(hi, terrain(lla + dN / R / DEG, llo + dE / (R * Math.cos(lla * DEG)) / DEG));
      }
      if (hi - levs[li] <= 6) break;
      lr = Math.max(150, lr * 0.78);
    }
    pools.push({ id: `ML-${oi}`, kind: 'lake', lat: lla, lon: llo, r: lr, level: levs[li], depth: 6 + 6 * u01(rehash(h, 7)), out: oi });
    outflows.push({ id: `MO-${oi}`, oi, k, pts, levs, wid, heading: (Math.atan2(de, dn) / DEG + 360) % 360 });
  }
  // ---- polylines for queries: foot reaches (divide -> outlet, ids MW-<i>) and outflows
  const lines = [];
  {
    // segment flow: downstream toward the lower level (flats: the fill direction of the vertex)
    const sf = new Int8Array(Math.max(1, n - 1));
    for (let k = 0; k < n - 1; k++) sf[k] = L[k] > L[k + 1] + 1e-9 ? 1 : L[k + 1] > L[k] + 1e-9 ? -1 : (flow[k + 1] || flow[k] || 1);
    const isOut = new Uint8Array(n); for (const k of outl) isOut[k] = 1;
    // split the foot channel into reaches at outlets and divides (segment flow sign changes)
    let start = -1;
    for (let k = 0; k < n; k++) {
      if (dry[k]) { start = -1; continue; }
      if (start < 0) { start = k; continue; }
      const brk = k === n - 1 || isOut[k] || dry[k + 1] || sf[k] !== sf[start];
      if (!brk) continue;
      const idx = [];
      for (let q = start; q <= k; q++) idx.push(q);
      if (idx.length >= 2) lines.push({ id: `MW-${lines.length}`, kind: 'foot', idx, flow: sf[start] });
      start = k;
    }
  }
  const segs = [];      // [lineIndex, vertexIndex] per segment, geometry looked up lazily
  const LV = [];        // per line: Float64Array xyz, levels, widths
  for (const ln of lines) {
    const m = ln.idx.length;
    const xyz = new Float64Array(m * 3), lv = new Float64Array(m), wd = new Float64Array(m);
    for (let i = 0; i < m; i++) { const k = ln.idx[i]; xyz[i * 3] = ch[k * 3]; xyz[i * 3 + 1] = ch[k * 3 + 1]; xyz[i * 3 + 2] = ch[k * 3 + 2]; lv[i] = L[k]; wd[i] = W[k]; }
    LV.push({ id: ln.id, kind: 'foot', xyz, lv, wd, flow: ln.flow, m });
  }
  for (const o of outflows) {
    const m = o.pts.length;
    const xyz = new Float64Array(m * 3), lv = new Float64Array(m), wd = new Float64Array(m);
    for (let i = 0; i < m; i++) { unit(o.pts[i][0], o.pts[i][1], U3); xyz[i * 3] = U3[0]; xyz[i * 3 + 1] = U3[1]; xyz[i * 3 + 2] = U3[2]; lv[i] = o.levs[i]; wd[i] = o.wid[i]; }
    LV.push({ id: o.id, kind: 'outflow', xyz, lv, wd, flow: 1, m });
  }
  const grid = new Map();
  const add = (key, v) => { let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(v); };
  const cellsOf = (x0, y0, z0, x1, y1, z1, pad, v) => {
    const i0 = Math.floor((Math.min(x0, x1) * R - pad) / CELL), i1 = Math.floor((Math.max(x0, x1) * R + pad) / CELL);
    const j0 = Math.floor((Math.min(y0, y1) * R - pad) / CELL), j1 = Math.floor((Math.max(y0, y1) * R + pad) / CELL);
    const k0 = Math.floor((Math.min(z0, z1) * R - pad) / CELL), k1 = Math.floor((Math.max(z0, z1) * R + pad) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) add(cellKey(i, j, k), v);
  };
  for (let li = 0; li < LV.length; li++) {
    const { xyz, m } = LV[li];
    for (let i = 0; i < m - 1; i++) {
      segs.push(li, i);
      cellsOf(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2], xyz[i * 3 + 3], xyz[i * 3 + 4], xyz[i * 3 + 5], 420, segs.length / 2 - 1);
    }
  }
  const PU = [];
  for (let pi = 0; pi < pools.length; pi++) {
    const p = pools[pi];
    unit(p.lat, p.lon, U3);
    p.x = U3[0]; p.y = U3[1]; p.z = U3[2];
    // local frame for the lobed outline
    PU.push(p);
    cellsOf(p.x, p.y, p.z, p.x, p.y, p.z, p.r * 1.9 + 60, -1 - pi);
  }
  SYS = { n, ll, foot: null, T, L, W, flow, dry, outl, outflows, pools, lines: LV, segs: new Int32Array(segs), grid, ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
  return SYS;
}

export function meltSystem() { return SYS || build(); }

/** cheap gate: could (x,y,z) with ice metric iceQ (km) and OX4 weight be near the meltwater system? */
export function meltNear(lat, wOX4, iceQ) { return lat > 66 && wOX4 > 0.05 && iceQ > -40 && iceQ < 1.5; }

// nearest channel + pool at a unit vector
export const MQ = { d: 1e9, line: null, t: 0, i: 0, level: 0, width: 0, fe: 0, fn: 0, pool: null, rho: 9, pd: 1e9 };
export function meltQuery(x, y, z) {
  const S = meltSystem();
  MQ.d = 1e9; MQ.line = null; MQ.pool = null; MQ.rho = 9; MQ.pd = 1e9;
  const list = S.grid.get(cellKey(Math.floor(x * R / CELL), Math.floor(y * R / CELL), Math.floor(z * R / CELL)));
  if (!list) return MQ;
  for (let q = 0; q < list.length; q++) {
    const v = list[q];
    if (v < 0) {
      const p = S.pools[-1 - v];
      const dx = x - p.x, dy = y - p.y, dz = z - p.z;
      const dm = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
      const il = 1 / (p.r * 0.7);
      const rho = dm / p.r + 0.14 * NM.n3(x * R * il, y * R * il, z * R * il + 7);
      if (rho < MQ.rho) { MQ.rho = rho; MQ.pool = p; MQ.pd = dm; }
      continue;
    }
    const li = S.segs[v * 2], i = S.segs[v * 2 + 1];
    const Lr = S.lines[li], a = Lr.xyz;
    const ax = a[i * 3], ay = a[i * 3 + 1], az = a[i * 3 + 2], bx = a[i * 3 + 3], by = a[i * 3 + 4], bz = a[i * 3 + 5];
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const px = x - ax, py = y - ay, pz = z - az;
    const ll = ex * ex + ey * ey + ez * ez || 1e-30;
    let t = (px * ex + py * ey + pz * ez) / ll; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = px - ex * t, qy = py - ey * t, qz = pz - ez * t;
    const d = Math.sqrt(qx * qx + qy * qy + qz * qz) * R;
    if (d < MQ.d) { MQ.d = d; MQ.line = Lr; MQ.i = i; MQ.t = t; }
  }
  if (MQ.line) {
    const Lr = MQ.line, i = MQ.i, t = MQ.t, a = Lr.xyz;
    MQ.level = Lr.lv[i] + (Lr.lv[i + 1] - Lr.lv[i]) * t;
    MQ.width = Lr.wd[i] + (Lr.wd[i + 1] - Lr.wd[i]) * t;
    // flow direction (east / north) along the polyline, signed by the reach's flow
    const ex = a[i * 3 + 3] - a[i * 3], ey = a[i * 3 + 4] - a[i * 3 + 1], ez = a[i * 3 + 5] - a[i * 3 + 2];
    const lon = Math.atan2(x, z), lat = Math.asin(y < -1 ? -1 : y > 1 ? 1 : y);
    const Ee = Math.cos(lon), Ez = -Math.sin(lon);
    const Nx = -Math.sin(lat) * Math.sin(lon), Ny = Math.cos(lat), Nz = -Math.sin(lat) * Math.cos(lon);
    let fe = ex * Ee + ez * Ez, fn = ex * Nx + ey * Ny + ez * Nz;
    const fl = Math.hypot(fe, fn) || 1;
    MQ.fe = fe / fl * Lr.flow; MQ.fn = fn / fl * Lr.flow;
  }
  return MQ;
}

const ss = (a, b, x) => { const t = (x - a) / (b - a); return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); };
/**
 * Terrain carving + water classification of the OX4 meltwater system (called by the water carver for points
 * passing meltNear). Channels: flat bed, cut banks (never eating into the ice cliff), levees where the
 * ground is low; pools: shelf + bowl, raised shore. Fills W (hydro WATER_INFO) for water points.
 */
export function carveMelt(F, h, mw, M, W) {
  if (mw > 360) return h;
  meltQuery(F.x, F.y, F.z);
  // the bank clamps fade out toward the ice margin q = -0.03 km (banks never eat into the ice cliff). A hard switch
  // there drew a vertical step along that iso-line wherever the cliff stands above the bank (36 m at S04): ramp
  // >= 1.5 mw in metres for |grad q| <= 6 m/m (p99 at the OX4 margin: 5.7), kept between Q_FOOT and the margin
  const wq = Math.min(-0.03 - Q_FOOT, Math.max(0.03, 0.009 * mw));
  const iceK = ss(-0.03 - wq, -0.03, F.iceQ);
  if (MQ.line && MQ.d < MQ.width * 0.5 + 200) {
    const w = MQ.width, lev = MQ.level, d = MQ.d;
    const fade = Math.min(1, Math.max(0, (360 - mw) / 140)) * Math.min(1, Math.max(0, (w * 1.6 - mw) / (w * 0.8)));
    if (fade > 0) {
      const bank = w * 0.5 + Math.max(3, w * 0.15), top = lev + 1.1, depth = 1.4 + w * 0.03;
      let t;
      if (d < w * 0.5) { const u = d / (w * 0.5); t = lev - depth * (1 - u * u * u) - 0.1; }
      else if (d < bank) { const u = (d - w * 0.5) / (bank - w * 0.5); t = lev - 0.1 + (top - lev + 0.1) * ss(0, 1, u); }
      else {
        const e = d - bank;
        const cb = top + e * 0.65;
        const c = h < top - e * 0.35 ? top - e * 0.35 : h > cb && iceK < 1 ? cb + (h - cb) * iceK : h;
        t = h + (c - h) * (1 - ss(110, 190, e));
      }
      h = h + (t - h) * fade;
      if (M && d < bank + 12) { M.wet = Math.max(M.wet, 1 - ss(bank, bank + 12, d)); if (d < bank) M.riverbed = Math.max(M.riverbed, 1 - ss(w * 0.5, bank, d)); }
      if (d < w * 0.5 && fade > 0.5 && h < lev) {
        W.type = 2; W.level = lev; W.width = w; W.dist = d; W.kind = 'river'; W.id = MQ.line.id; W.order = 0; W.fx = MQ.fe; W.fy = MQ.fn;
      }
    }
  }
  const P = MQ.pool;
  if (P && MQ.rho < 1.85) {
    const fade = Math.min(1, Math.max(0, (900 - mw) / 500)) * Math.min(1, Math.max(0, (P.r * 1.2 - mw) / (P.r * 0.6)));
    if (fade > 0) {
      const rho = MQ.rho, lev = P.level;
      let t = h;
      if (rho < 1) {
        const shelf = 0.8 * ss(1, 0.82, rho);
        t = Math.min(h, lev - 0.3 - shelf - P.depth * Math.pow(Math.max(0, 1 - rho * rho * 1.15), 0.8));
      } else if (iceK < 1) {
        const e = (rho - 1) * P.r;
        const rimMin = lev + 0.35 + Math.min(1.4 * ss(0, 5, e) + 1.8 * ss(P.r * 0.1, P.r * 0.1 + 6, e), e * 0.08 + 0.5);
        // low ground: raised shore terraces; high ground: a sloped bank (no vertical pit walls)
        const bank = lev + 1.1 + e * 0.45;
        t = h < rimMin ? rimMin + (h - rimMin) * ss(0, 1, (rho - 1) / 0.7) : h > bank ? bank + (h - bank) * ss(1.55, 1.85, rho) : h;
        t += (h - t) * iceK;
        if (M && e < 30) M.wet = Math.max(M.wet, (1 - e / 30) * (1 - iceK));
      }
      h = h + (t - h) * fade;
      if (rho < 1 && fade > 0.5 && h < lev && (W.type !== 2 || rho < 0.9)) {   // inside a pool the pool wins (same level)
        W.type = 3; W.level = lev; W.width = 0; W.dist = 0; W.id = P.id; W.kind = 'melt'; W.fx = 0; W.fy = 0; W.order = -1;
      }
    }
  }
  return h;
}

const toLL = (x, y, z) => [Math.asin(Math.max(-1, Math.min(1, y))) / DEG, Math.atan2(x, z) / DEG];
const r6 = (v) => Math.round(v * 1e6) / 1e6, r2 = (v) => Math.round(v * 100) / 100;

/** JSON-friendly description of the whole OX4 meltwater system (lat / lon degrees, metres) */
/** cliff-foot line (iso-line q = Q_FOOT beside every channel vertex), built on first request */
function footLine(S) {
  if (!S.foot) {
    const P = [0, 0];
    S.foot = S.ll.map(([la, lo]) => { project(la, lo, Q_FOOT, P); return [P[0], P[1]]; });
  }
  return S.foot;
}
export function meltPublic() {
  const S = meltSystem();
  const foot = footLine(S).map(([la, lo]) => [r6(la), r6(lo)]);
  const reaches = S.lines.filter((l) => l.kind === 'foot').map((l) => ({
    id: l.id, flow: l.flow, points: Array.from({ length: l.m }, (_, i) => { const p = toLL(l.xyz[i * 3], l.xyz[i * 3 + 1], l.xyz[i * 3 + 2]); return [r6(p[0]), r6(p[1])]; }),
    levels: Array.from(l.lv, r2), widths: Array.from(l.wd, (v) => Math.round(v)),
  }));
  const outlets = S.outflows.map((o) => {
    const [la, lo] = S.ll[o.k];
    const pool = S.pools.find((p) => p.out === o.oi && p.kind === 'forebay'), lake = S.pools.find((p) => p.out === o.oi && p.kind === 'lake');
    const fp = footLine(S)[o.k];
    return {
      id: o.id, lat: r6(la), lon: r6(lo), level: r2(S.L[o.k]), heading: Math.round(o.heading * 10) / 10, footLat: r6(fp[0]), footLon: r6(fp[1]),
      pool: { id: pool.id, lat: r6(pool.lat), lon: r6(pool.lon), radius: Math.round(pool.r), level: r2(pool.level) },
      lake: { id: lake.id, lat: r6(lake.lat), lon: r6(lake.lon), radius: Math.round(lake.r), level: r2(lake.level) },
      channel: o.pts.map(([a, b]) => [r6(a), r6(b)]), levels: o.levs.map(r2),
    };
  });
  return { foot, reaches, outlets, buildMs: Math.round(S.ms) };
}

const VF = {};
function lineHitsRect(Lr, f, a0, a1, b0, b1, m) {
  for (let i = 0; i < Lr.m; i++) {
    vecToFace(Lr.xyz[i * 3], Lr.xyz[i * 3 + 1], Lr.xyz[i * 3 + 2], VF);
    if (VF.face === f && VF.a >= a0 - m && VF.a <= a1 + m && VF.b >= b0 - m && VF.b <= b1 + m) return true;
  }
  return false;
}
/** meltwater channels intersecting a face rectangle, in the canalsInTile format (kind 'river') */
export function meltChannelsInRect(f, a0, a1, b0, b1) {
  const S = meltSystem();
  const out = [];
  const m = (a1 - a0) * 0.02 + 600 / 2662000;
  for (const Lr of S.lines) {
    if (!lineHitsRect(Lr, f, a0, a1, b0, b1, m)) continue;
    const pts = [];
    for (let i = 0; i < Lr.m; i++) { const p = toLL(Lr.xyz[i * 3], Lr.xyz[i * 3 + 1], Lr.xyz[i * 3 + 2]); pts.push([r6(p[0]), r6(p[1])]); }
    // points run downstream
    if (Lr.flow < 0) pts.reverse();
    const l0 = Lr.flow < 0 ? Lr.lv[Lr.m - 1] : Lr.lv[0], l1 = Lr.flow < 0 ? Lr.lv[0] : Lr.lv[Lr.m - 1];
    let w = 0; for (let i = 0; i < Lr.m; i++) w = Math.max(w, Lr.wd[i]);
    out.push({ id: Lr.id, kind: 'river', melt: Lr.kind, order: 0, width: Math.round(w), level0: r2(l0), level1: r2(l1), points: pts, sluices: [] });
  }
  return out;
}
/** forebay pools / meltwater lakes intersecting a face rectangle (lakesInTile format) */
export function meltPoolsInRect(f, a0, a1, b0, b1) {
  const S = meltSystem();
  const out = [];
  for (const p of S.pools) {
    vecToFace(p.x, p.y, p.z, VF);
    const m = (p.r * 1.2) / 2662000;
    if (VF.face === f && VF.a >= a0 - m && VF.a <= a1 + m && VF.b >= b0 - m && VF.b <= b1 + m) {
      out.push({ id: p.id, kind: 'melt', role: p.kind, level: r2(p.level), lat: r6(p.lat), lon: r6(p.lon), radius: Math.round(p.r) });
    }
  }
  return out;
}
