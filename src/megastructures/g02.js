// G02 南台地水阶 — six staggered gravity dams with gated spillways (OX5). OWNER: megastructure agent.
// Worker-safe generator. layoutG02(heightFn) samples the carved terrain (world/terrain heightAt) to
// key every dam monolith into the canyon and to drape the switchback roads; genG02Chunk(c) emits a
// chunk at LOD 'far' | 'mid' | 'near'.
// Dam frame: origin = midpoint of the dam axis (a→b) at height 0, local X from a to b, local Z =
// downstream (spillway.dir), Y = height above sea level. The upstream face is the plane Z = 0.
import { SITES, localToUnit, G02_AXIS, G02_DAMS, G02_GEO, g02HalfWidth } from '../world/sites.js';
import { hash4 } from '../core/hash.js';
import * as M from './parts.js';
import { EXPO, PX, NX, PY, NY, PZ, NZ, ALL } from './parts.js';

const S = SITES.waterStairs;
export const G02_SITE = S;
const BAY = 12, PIER = 6, TRAIN = 4, MONO = 15;
const STATE_SEED = 0x6022;

/**
 * Spillway gate rule of the water renderer (render/water/tiles.js spillwayGateOpen — foam / jets
 * below open bays). Its bay index runs along −X of this dam frame (from the b end), so my bay k is
 * its bay (bays − 1 − k). Replicated here (worker-safe, no THREE); index.js cross-checks at runtime.
 */
function waterGateOpen(dam, bay) {
  const bays = 5 + (dam % 3);
  const h = hash4(dam, bay, 0x6a7e, 0) / 4294967296;
  if (bay === Math.floor(bays / 2) || bay === Math.floor(bays / 2) - 1 + (dam & 1) * 2) return true;
  return h < 0.42;
}
/** deterministic spillway gate states (true = open). Same at every LOD and in every shot. */
export function gateOpen(dam, bay, bays) { return waterGateOpen(dam, bays - 1 - bay); }

function ogeeY(z, sill, Hd) { return sill - 0.5 * Hd * Math.pow(Math.max(0, z) / Hd, 1.85); }
/** spillway surface profile [[z, y]...] from the crest to the stilling-basin apron */
export function spillProfile(sill, crest, apron, Hd = 6) {
  const pts = [[-3.2, sill - 3.2], [-2.4, sill - 1.2], [-1.4, sill - 0.35], [0, sill]];
  const k = 1 / 0.78;
  let zt = 0;
  for (let z = 0.8; z < 30; z += 0.8) { const y = ogeeY(z, sill, Hd); pts.push([z, y]); const dydz = 0.5 * 1.85 * Math.pow(z / Hd, 0.85); if (dydz >= k) { zt = z; break; } }
  const [z0, y0] = pts[pts.length - 1];
  const R = 12, nk = Math.sqrt(1 + k * k);
  const yb = apron + R * (1 - 1 / nk);                // tangent point of the toe bucket on the chute
  const zb = z0 + (y0 - yb) / k;
  pts.push([zb, yb]);
  const zc = zb + R * k / nk, yc = apron + R, th0 = Math.atan(k);
  for (let i = 1; i <= 6; i++) { const th = th0 * (1 - i / 6); pts.push([zc - R * Math.sin(th), yc - R * Math.cos(th)]); }
  void zt; void crest;
  return pts;
}

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------
export function layoutG02(heightFn) {
  const U = {};
  const H = (x, z) => { localToUnit(S, x, z, U); return heightFn(U.x, U.y, U.z); };
  const chunks = [], dams = [], spill = [];
  for (const lv of S.levels) {
    const d = lv.dam, i = lv.index;
    const a = d.a, b = d.b, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;      // local X
    const dx = d.spillway.dir[0], dz = d.spillway.dir[1];
    const zx = -tz, zz = tx;                                     // local Z = X × Y (right-handed)
    const flip = zx * dx + zz * dz < 0;                          // spillway dir should equal local Z
    const ZX = flip ? -zx : zx, ZZ = flip ? -zz : zz;
    const TX = flip ? -tx : tx, TZ = flip ? -tz : tz;
    const toXZ = (X, Z) => [mx + TX * X + ZX * Z, mz + TZ * X + ZZ * Z];
    const level = lv.level, next = i < 5 ? S.levels[i + 1].level : S.plain.level + 6;
    const crest = d.crest, Wc = d.width;
    const toeZ = Wc + 0.78 * (crest - 3 - (next - 8));
    // ground profile along the axis: min over the footprint (upstream face .. toe)
    const half = L / 2 + 80, step = 5;
    const prof = [];
    for (let X = -half; X <= half + 1e-6; X += step) {
      let g = Infinity, gUp = Infinity;
      for (const Z of [-4, 0, Wc * 0.5, Wc, (Wc + toeZ) * 0.5, toeZ, toeZ + 10]) { const [x, z] = toXZ(X, Z); const h = H(x, z); if (h < g) g = h; if (Z <= Wc) gUp = Math.min(gUp, h); }
      prof.push({ X, g, gUp });
    }
    // dam ends: walk outward from the middle while the crest-line ground is below the crest
    const mid = Math.floor(prof.length / 2);
    let li = mid, ri = mid;
    while (li > 0 && prof[li - 1].gUp < crest - 0.5) li--;
    while (ri < prof.length - 1 && prof[ri + 1].gUp < crest - 0.5) ri++;
    const xl = Math.max(-half, prof[li].X - 14), xr = Math.min(half, prof[ri].X + 14);
    const bays = d.spillway.bays, SW = BAY * bays + PIER * (bays - 1);
    const states = []; for (let k = 0; k < bays; k++) states.push(gateOpen(i, k, bays));
    const roadSide = i % 2 ? 1 : -1;            // sites.js: road from the b end (+1) or the a end (−1) of the axis
    const ctrlSide = flip ? -roadSide : roadSide;  // in dam X (a → b is +X unless flipped)
    const dam = { id: d.id, i, level, next, crest, Wc, toeZ, sill: d.spillway.sill, bays, SW, states, xl, xr, mx, mz, TX, TZ, ZX, ZZ, prof, ctrlSide, apron: next - 8 };
    dams.push(dam);
    // chunks: left non-overflow, spillway, right non-overflow
    const sx0 = -SW / 2 - TRAIN, sx1 = SW / 2 + TRAIN;
    const parts = [
      { k: 'L', x0: xl, x1: sx0, name: '左岸挡水坝段' },
      { k: 'S', x0: sx0, x1: sx1, name: '溢流坝段' },
      { k: 'R', x0: sx1, x1: xr, name: '右岸挡水坝段' },
    ];
    for (const p of parts) {
      if (p.x1 - p.x0 < 4) continue;
      const xc = (p.x0 + p.x1) / 2;
      const [cx, cz] = toXZ(xc, toeZ * 0.4);
      const hasCtrl = (p.k === 'L' && ctrlSide < 0) || (p.k === 'R' && ctrlSide > 0);
      chunks.push({ id: `${d.id}-${p.k}`, site: 'G02', kind: p.k === 'S' ? 'spill' : 'dam', part: d.id, name: `${d.id} ${p.name}`, cx, cz, r: Math.hypot((p.x1 - p.x0) / 2 + (hasCtrl ? 40 : 10), toeZ + 60) + 20, y0: next - 14, y1: crest + 30, dam: i, x0: p.x0, x1: p.x1, side: p.k, hasCtrl });
    }
    // spillway outlets (for the water renderer: foam / tailwater)
    const prof2 = spillProfile(dam.sill, crest, dam.apron);
    const zOut = prof2[prof2.length - 1][0];
    for (let k = 0; k < bays; k++) {
      const X = -SW / 2 + k * (BAY + PIER) + BAY / 2;
      const [x, z] = toXZ(X, zOut + 4);
      const head = level - dam.sill;
      const q = states[k] ? 2.1 * BAY * Math.pow(head, 1.5) : 0;       // m³/s, broad-crested weir
      spill.push({ id: `${d.id}-B${k + 1}`, damId: d.id, dam: i, bay: k, open: states[k], x, z, y: next, dir: [ZX, ZZ], width: BAY, flow: Math.round(q), level, tail: next, crestY: dam.sill });
    }
  }
  // roads: drape on the terrain with bounded cut / fill (retaining walls show the fill)
  const roads = [];
  for (const rd of S.roads) {
    // the terrain carves a 9 m bench along the ORIGINAL polyline (megasites.js): keep the legs on it and round
    // only the hairpin tips (22 m cut: the turn stays inside the overlapping benches of the two legs)
    const P0 = rd.points.map((p) => [p[0], p[1], p[2]]);
    let P = [P0[0]];
    for (let k = 1; k < P0.length - 1; k++) {
      const A = P0[k - 1], V = P0[k], B = P0[k + 1];
      const la = Math.hypot(A[0] - V[0], A[2] - V[2]), lb = Math.hypot(B[0] - V[0], B[2] - V[2]);
      const fa = Math.min(0.45, 22 / Math.max(1, la)), fb = Math.min(0.45, 22 / Math.max(1, lb));
      const Pa = [V[0] + (A[0] - V[0]) * fa, V[1] + (A[1] - V[1]) * fa, V[2] + (A[2] - V[2]) * fa];
      const Pb = [V[0] + (B[0] - V[0]) * fb, V[1] + (B[1] - V[1]) * fb, V[2] + (B[2] - V[2]) * fb];
      for (let j = 0; j <= 6; j++) {
        const t = j / 6, u = 1 - t;
        P.push([u * u * Pa[0] + 2 * u * t * V[0] + t * t * Pb[0], u * u * Pa[1] + 2 * u * t * V[1] + t * t * Pb[1], u * u * Pa[2] + 2 * u * t * V[2] + t * t * Pb[2]]);
      }
    }
    P.push(P0[P0.length - 1]);
    // densify to ~8 m and sample the ground
    const D = [];
    for (let k = 0; k < P.length - 1; k++) {
      const p = P[k], q = P[k + 1], l = Math.hypot(q[0] - p[0], q[2] - p[2]), n = Math.max(1, Math.ceil(l / 8));
      for (let j = 0; j < n; j++) { const t = j / n; D.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
    }
    D.push(P[P.length - 1]);
    // design height = the carved bench; stay within [ground − 0.15, ground + 3] where other carvings (dam
    // abutments, town platforms) override the bench
    const pts = D.map(([x, yd, z]) => { const g = H(x, z); return { x, z, g, y: Math.min(Math.max(yd, g - 0.15), g + 3) }; });
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const p of pts) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); miny = Math.min(miny, p.g); maxy = Math.max(maxy, p.y); }
    const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
    roads.push({ id: rd.id, width: rd.width, pts });
    chunks.push({ id: rd.id, site: 'G02', kind: 'road', part: rd.id, name: `${rd.id} 回头弯检修路`, cx, cz, r: Math.hypot(maxx - minx, maxz - minz) / 2 + 20, y0: miny - 10, y1: maxy + 12, road: roads.length - 1 });
  }
  // old-water-line deposit bands (旧水位沉积线, §5 08): pale mineral ring from just below the water line up to
  // the old high-water mark on both banks of the two lowest reservoirs (the S08 foreground), draped on the
  // full-detail terrain (profile samples every 10 m across the bank)
  const bands = [];
  for (const i of BAND_RES) {
    const L = S.levels[i].level, top = L + BAND_TOP;
    const s0 = G02_DAMS[i - 1] * 1000 + 120, s1 = G02_DAMS[i] * 1000 - 110;
    for (const side of [-1, 1]) {
      const runs = []; let run = [];
      const n = Math.max(8, Math.round((s1 - s0) / 95));
      for (let k = 0; k <= n; k++) {
        const s = s0 + ((s1 - s0) * k) / n;
        const p = axisAt(s), w = g02HalfWidth(i, s, side);
        const nx = side < 0 ? -p.tz : p.tz, nz = side < 0 ? p.tx : -p.tx;   // from the axis toward the bank
        const E = [], G = [];
        for (let e = w - 60; e <= w + 150; e += 10) { E.push(e); G.push(H(p.x + nx * e, p.z + nz * e)); }
        // first crossing of L − 1.2 (submerged edge) and of the old line going outward
        let a = -1, bI = -1;
        for (let j = 1; j < E.length; j++) { if (a < 0 && G[j - 1] < L - 1.2 && G[j] >= L - 1.2) a = j; if (a >= 0 && G[j - 1] < top && G[j] >= top) { bI = j; break; } }
        if (a < 0 || bI < 0) { if (run.length > 2) runs.push(run); run = []; continue; }
        const cross = (j, t) => { const f = (t - G[j - 1]) / Math.max(1e-6, G[j] - G[j - 1]); return E[j - 1] + (E[j] - E[j - 1]) * f; };
        const ea = cross(a, L - 1.2), eb = cross(bI, top);
        const row = [[ea, L - 1.2]];
        for (let j = a; j < bI; j++) if (E[j] > ea + 2 && E[j] < eb - 2) row.push([E[j], G[j]]);
        row.push([eb, top]);
        // fixed BAND_NQ vertices across the band (resampled) so consecutive rows can be stitched
        const R6 = [];
        for (let q = 0; q < BAND_NQ; q++) {
          const et = ea + ((eb - ea) * q) / (BAND_NQ - 1);
          let y = row[row.length - 1][1];
          for (let m = 1; m < row.length; m++) if (et <= row[m][0]) { const f = (et - row[m - 1][0]) / Math.max(1e-6, row[m][0] - row[m - 1][0]); y = row[m - 1][1] + (row[m][1] - row[m - 1][1]) * f; break; }
          R6.push([+(p.x + nx * et).toFixed(2), +(y + 0.18).toFixed(2), +(p.z + nz * et).toFixed(2)]);
        }
        run.push(R6);
      }
      if (run.length > 2) runs.push(run);
      for (let r = 0; r < runs.length; r++) {
        const rows = runs[r];
        let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
        for (const R6 of rows) for (const v of R6) { minx = Math.min(minx, v[0]); maxx = Math.max(maxx, v[0]); minz = Math.min(minz, v[2]); maxz = Math.max(maxz, v[2]); }
        const id = `G02-WL${i + 1}${side < 0 ? 'L' : 'R'}${r ? r : ''}`;
        bands.push({ id, res: i, side, level: L, top, rows });
        chunks.push({ id, site: 'G02', kind: 'band', part: id, name: `G02-R${i + 1} 旧水位沉积线`, cx: (minx + maxx) / 2, cz: (minz + maxz) / 2, r: Math.hypot(maxx - minx, maxz - minz) / 2 + 20, y0: L - 4, y1: top + 6, band: bands.length - 1 });
      }
    }
  }
  return { id: 'G02', chunks, dams, roads, bands, spillways: spill, towns: S.towns };
}
/** reservoirs carrying the old-water-line deposit band, and the old high-water mark above the level (m) */
const BAND_RES = [4, 5];
const BAND_TOP = 6.5, BAND_NQ = 9;
/** point + unit tangent of the valley axis at station s (m from the head) */
function axisAt(s) {
  const P = G02_AXIS.pts, C = G02_AXIS.cum;
  let i = 0; while (i < C.length - 2 && C[i + 1] < s) i++;
  const t = (s - C[i]) / Math.max(1e-6, C[i + 1] - C[i]);
  const ex = P[i + 1][0] - P[i][0], ez = P[i + 1][1] - P[i][1], l = Math.hypot(ex, ez) || 1;
  return { x: P[i][0] + ex * t, z: P[i][1] + ez * t, tx: ex / l, tz: ez / l };
}
void G02_GEO;

// ---------------------------------------------------------------------------------------------
// dam chunk geometry
// ---------------------------------------------------------------------------------------------
function pushDam(c, dam) {
  const ch = c.chunk, b = c.b;
  b.push(); b.translate(dam.mx - ch.cx, 0, dam.mz - ch.cz);
  b.rotY(Math.atan2(-dam.TZ, dam.TX));
}
function groundAt(dam, X) {
  const P = dam.prof, s = (X - P[0].X) / (P[1].X - P[0].X);
  const i = Math.max(0, Math.min(P.length - 2, Math.floor(s))), t = Math.max(0, Math.min(1, s - i));
  return P[i].g + (P[i + 1].g - P[i].g) * t;
}
function groundUp(dam, X) {
  const P = dam.prof, s = (X - P[0].X) / (P[1].X - P[0].X);
  const i = Math.max(0, Math.min(P.length - 2, Math.floor(s))), t = Math.max(0, Math.min(1, s - i));
  return P[i].gUp + (P[i + 1].gUp - P[i].gUp) * t;
}

/** non-overflow monoliths between x0 and x1 (gravity section, crest road, parapets) */
function damSection(c, dam, x0, x1) {
  const b = c.b, crest = dam.crest, Wc = dam.Wc, L = dam.level;
  const nM = Math.max(1, Math.round((x1 - x0) / MONO));
  for (let m = 0; m < nM; m++) {
    const xa = x0 + ((x1 - x0) * m) / nM + 0.06, xb = x0 + ((x1 - x0) * (m + 1)) / nM - 0.06;
    const xm = (xa + xb) / 2;
    const gr = Math.min(groundAt(dam, xa), groundAt(dam, xb), groundAt(dam, xm));
    const gu = Math.min(groundUp(dam, xa), groundUp(dam, xb));
    if (gu > crest + 1) continue;                    // inside the abutment rock
    const bot = gr - 3;
    const knee = crest - 3;
    const toe = Wc + 0.78 * Math.max(0, knee - bot);
    c.setPart(`${dam.id}/M${Math.round(xm)}`, `${dam.id} 挡水坝段`);
    // upstream face (reservoir side, waterline at the level)
    c.water(L, EXPO.LOCK, 1.2, 0);
    b.rectZ('mega_concrete', xa, bot, xb, crest, 0, -1);
    // downstream face (dry above the tailwater + spray near the spillway)
    const spray = Math.abs(xm) < dam.SW / 2 + 60 ? 9 : 1.5;
    c.water(dam.next, EXPO.INNER, spray, 0);
    b.quad('mega_concrete', xa, knee, Wc, xa, bot, toe, xb, bot, toe, xb, knee, Wc);
    c.water(dam.next, EXPO.DRY, 0, 0);
    b.rectZ('mega_concrete', xa, knee, xb, crest, Wc, 1);
    b.rectY('mega_concrete', xa, 0, xb, Wc, crest, 1);
    // monolith end faces (joints)
    M.extrude(c, 'mega_concrete', [[0, bot], [toe, bot], [Wc, knee], [Wc, crest], [0, crest]], xa, xb, true, false);
    b.colBox(xa, bot, 0, xb, crest, Wc); b.colQuad(xa, knee, Wc, xb, knee, Wc, xb, bot, toe, xa, bot, toe);
    if (c.far) { if (m % 2 === 0) M.lightPool(c, xm, crest + 0.6, Wc - 1.6, 7); continue; }
    // crest: parapet (upstream), road, railing (downstream), cable duct, lamps
    c.water(L, EXPO.DRY, 0, 0);
    b.box('mega_concrete', xa, crest, 0, xb, crest + 1.25, 0.45, ALL & ~NY);
    b.colBox(xa, crest, 0, xb, crest + 1.25, 0.45);
    b.withTint([0.95, 0.95, 0.95], () => b.rectY('mega_asphalt', xa, 2.4, xb, Wc - 1.6, crest + 0.03, 1));
    M.cableTrench(c, xa, xb, crest, 1.35, 0.8);
    if (c.near) {
      for (let x = xa + 1; x < xb - 3; x += 9) b.box('paving', x, crest + 0.03, (2.4 + Wc - 1.6) / 2 - 0.07, x + 4.5, crest + 0.036, (2.4 + Wc - 1.6) / 2 + 0.07, PY);
      M.railX(c, xa, xb, crest, Wc - 0.25, { key: 'aluminium', toe: false });
      // drainage-gallery outlet + monolith number plate on the downstream face
      b.box('steel_dark', xm - 0.6, knee - 6, Wc + 0.78 * 3 + 0.02, xm + 0.6, knee - 4.8, Wc + 0.78 * 3 + 0.06, PZ);
    } else b.box('aluminium', xa, crest + 1.0, Wc - 0.3, xb, crest + 1.1, Wc - 0.2, PY | PZ | NZ);
    if (m % 2 === 0) M.lampPost(c, xm, crest, Wc - 0.9, Math.PI, 8);
  }
}

/**
 * Aerated water sheet running down an open bay (fix round 2, S08b / S08c "flat texture" → a free surface with
 * thickness): drawdown from the reservoir, glassy flow over the ogee crest, the depth thinning down the chute,
 * side-wall pile-up against the piers (the sheet climbs the pier faces), longitudinal streak ridges growing after the
 * aeration inception point and roll waves on the steep chute (near / mid LOD relief, smooth normals). Vertex colour:
 * r = aeration (0 glassy … 1 white water), g = pier-wall proximity, b = 1; uv = (across, along) metres — the
 * mega_water shader draws the flow-aligned streaks / foam / bump from them (materials.js).
 */
function spillSheet(c, dam, k, xa, xb, prof) {
  const b = c.b, L = dam.level, sill = dam.sill;
  // surface polyline [z, y] + flow depth: reservoir drawdown, then the chute bed + depth (thinning downstream)
  const P = [[-11, L, 6], [-6, L - 0.4, 5.2], [-3, sill + 4.2, 4.2]];
  for (let i = 3; i < prof.length; i++) {
    const depth = i < 6 ? 3.2 - (i - 3) * 0.55 : Math.max(0.9, 1.6 - (i - 6) * 0.08);
    P.push([prof[i][0], prof[i][1] + depth, depth]);
  }
  // cut where the sheet plunges below the tailwater (the water renderer's plume takes over there)
  const S = [P[0]];
  for (let i = 1; i < P.length; i++) { if (P[i - 1][1] < dam.next - 1.5) break; S.push(P[i]); }
  // resample along the flow (≤ ds m) with the arc length s
  const ds = c.near ? 0.8 : c.mid ? 2.5 : 1e9;
  const st = [];
  let acc = 0;
  for (let i = 0; i < S.length - 1; i++) {
    const p = S[i], q = S[i + 1], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(1, Math.ceil(l / ds));
    for (let j = 0; j < n; j++) { const t = j / n; st.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, acc + l * t]); }
    acc += l;
  }
  const last = S[S.length - 1]; st.push([last[0], last[1], last[2], acc]);
  // aeration: glassy over the crest, inception ≈ 9 m down the ogee, white water from ≈ 27 m on
  let sCrest = 0; for (const q of st) if (q[0] <= 0) sCrest = q[3];
  const aer = (sv) => smooth01((sv - sCrest - 9) / 18);
  const nx = c.near ? 18 : c.mid ? 6 : 1, x0 = xa + 0.02, x1 = xb - 0.02, W = x1 - x0;
  const r = c.rng(140 + dam.i, k);
  const ph = [r.next() * 6.28, r.next() * 6.28, r.next() * 6.28, r.next() * 6.28], lam = [0.62 + r.next() * 0.2, 1.1 + r.next() * 0.3, 1.9 + r.next() * 0.5];
  const relief = !c.far;
  const nJ = st.length, nI = nx + 1;
  const pos = new Float64Array(nI * nJ * 3), col = new Float32Array(nI * nJ * 2);
  for (let j = 0; j < nJ; j++) {
    const [z, y, depth, sv] = st[j];
    const jp = st[Math.min(nJ - 1, j + 1)], jm = st[Math.max(0, j - 1)];
    let tz = jp[0] - jm[0], ty = jp[1] - jm[1]; const tl = Math.hypot(tz, ty) || 1; tz /= tl; ty /= tl;
    const nz = -ty, ny = tz;                         // surface normal in the (z, y) plane (up / downstream)
    const a = aer(sv), steep = smooth01((-ty - 0.3) / 0.4);
    for (let i = 0; i < nI; i++) {
      const x = x0 + (W * i) / nx;
      const dW = Math.min(x - x0, x1 - x);
      const wall = Math.exp(-(dW / 0.9) * (dW / 0.9));
      let h = 0;
      if (relief) {
        // side-wall pile-up (the sheet climbs the pier faces), stronger where the flow is fast
        h += depth * (0.22 + 0.25 * a) * Math.exp(-(dW / 0.75) * (dW / 0.75));
        // roll waves on the steep chute (transverse bulges every ≈ 11 m, slightly skewed across)
        const rw = Math.sin((2 * Math.PI * (sv + 0.35 * (x - x0))) / 11.3 + ph[3]);
        h += 0.24 * a * steep * Math.pow(Math.max(0, rw), 3);
        // longitudinal streak ridges (aerated: up to ≈ 0.15 m), drifting slowly across along the flow
        if (c.near) {
          const sr = Math.sin((2 * Math.PI * x) / lam[0] + ph[0] + sv * 0.05) * 0.4 + Math.sin((2 * Math.PI * x) / lam[1] + ph[1] - sv * 0.03) * 0.35 + Math.sin((2 * Math.PI * x) / lam[2] + ph[2] + sv * 0.02) * 0.25;
          h += (0.015 + 0.13 * a) * sr * (1 - wall * 0.6);
        }
      }
      const o = (j * nI + i) * 3;
      pos[o] = x; pos[o + 1] = y + ny * h; pos[o + 2] = z + nz * h;
      col[(j * nI + i) * 2] = a; col[(j * nI + i) * 2 + 1] = wall;
    }
  }
  // emit with smooth normals (central differences of the displaced grid), explicit uvs
  const pr = b.part('mega_water');
  const mode = b.uvMode; b.uvMode = 1;
  b.pushTint(1, 1, 1);
  const idx = new Int32Array(nI * nJ);
  const at = (i, j, kk) => pos[(j * nI + i) * 3 + kk];
  for (let j = 0; j < nJ; j++) for (let i = 0; i < nI; i++) {
    const ip = Math.min(nI - 1, i + 1), im = Math.max(0, i - 1), jp = Math.min(nJ - 1, j + 1), jm = Math.max(0, j - 1);
    const ax = at(ip, j, 0) - at(im, j, 0), ay = at(ip, j, 1) - at(im, j, 1), az = at(ip, j, 2) - at(im, j, 2);
    const sx = at(i, jp, 0) - at(i, jm, 0), sy = at(i, jp, 1) - at(i, jm, 1), sz = at(i, jp, 2) - at(i, jm, 2);
    // n = s × a (up / out of the water)
    let nxv = sy * az - sz * ay, nyv = sz * ax - sx * az, nzv = sx * ay - sy * ax;
    const nl = Math.hypot(nxv, nyv, nzv) || 1; nxv /= nl; nyv /= nl; nzv /= nl;
    const ci = (j * nI + i) * 2;
    b.tint(col[ci], col[ci + 1], 1);
    idx[j * nI + i] = b.vert(pr, at(i, j, 0), at(i, j, 1), at(i, j, 2), nxv, nyv, nzv, at(i, j, 0) - x0, st[j][3]);
  }
  for (let j = 0; j < nJ - 1; j++) for (let i = 0; i < nI - 1; i++) b.q(pr, idx[j * nI + i], idx[(j + 1) * nI + i], idx[(j + 1) * nI + i + 1], idx[j * nI + i + 1]);
  // plunge roller: where the sheet dives under the tailwater a white aerated hump (hydraulic-jump roller, ≈ 1.3 m
  // high, ≈ 8 m long) spans the bay — the sheet's thickness reads at its foot; the water renderer's plume continues
  if (!c.far) {
    let zp = null, sp = acc;
    for (let j = 1; j < nJ; j++) if (st[j][1] < dam.next && st[j - 1][1] >= dam.next) { const t = (st[j - 1][1] - dam.next) / Math.max(1e-6, st[j - 1][1] - st[j][1]); zp = st[j - 1][0] + (st[j][0] - st[j - 1][0]) * t; sp = st[j - 1][3] + (st[j][3] - st[j - 1][3]) * t; break; }
    if (zp !== null) {
      const nT = c.near ? 14 : 5, len = 8.5, hgt = 1.3;
      const rp = new Float64Array((nx + 1) * (nT + 1) * 3);
      const ri = new Int32Array((nx + 1) * (nT + 1));
      for (let j = 0; j <= nT; j++) {
        const t = j / nT, z = zp - 1.2 + len * t;
        for (let i = 0; i <= nx; i++) {
          const x = x0 + (W * i) / nx, dW = Math.min(x - x0, x1 - x);
          const bump = c.near ? 0.22 * Math.sin(x * 2.3 + ph[0] + t * 5.1) * Math.sin(x * 0.9 + ph[1] - t * 3.3) + 0.12 * Math.sin(x * 5.7 + ph[2] + t * 9.0) : 0;
          const prof = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, t * 1.15))), 0.7) * (1 + 0.35 * Math.exp(-(dW / 0.9) * (dW / 0.9)));
          const o = (j * (nx + 1) + i) * 3;
          rp[o] = x; rp[o + 1] = dam.next - 0.35 + hgt * prof * (1 + bump); rp[o + 2] = z;
        }
      }
      const rat = (i, j, kk) => rp[(j * (nx + 1) + i) * 3 + kk];
      for (let j = 0; j <= nT; j++) for (let i = 0; i <= nx; i++) {
        const ip = Math.min(nx, i + 1), im = Math.max(0, i - 1), jp = Math.min(nT, j + 1), jm = Math.max(0, j - 1);
        const ax = rat(ip, j, 0) - rat(im, j, 0), ay = rat(ip, j, 1) - rat(im, j, 1), az = rat(ip, j, 2) - rat(im, j, 2);
        const sx = rat(i, jp, 0) - rat(i, jm, 0), sy = rat(i, jp, 1) - rat(i, jm, 1), sz = rat(i, jp, 2) - rat(i, jm, 2);
        let nxv = sy * az - sz * ay, nyv = sz * ax - sx * az, nzv = sx * ay - sy * ax;
        const nl = Math.hypot(nxv, nyv, nzv) || 1; nxv /= nl; nyv /= nl; nzv /= nl;
        const dW = Math.min(rat(i, j, 0) - x0, x1 - rat(i, j, 0));
        b.tint(1, Math.exp(-(dW / 0.9) * (dW / 0.9)), 1);
        ri[j * (nx + 1) + i] = b.vert(pr, rat(i, j, 0), rat(i, j, 1), rat(i, j, 2), nxv, nyv, nzv, rat(i, j, 0) - x0, sp + (j / nT) * len);
      }
      for (let j = 0; j < nT; j++) for (let i = 0; i < nx; i++) b.q(pr, ri[j * (nx + 1) + i], ri[(j + 1) * (nx + 1) + i], ri[(j + 1) * (nx + 1) + i + 1], ri[j * (nx + 1) + i + 1]);
    }
  }
  b.popTint();
  b.uvMode = mode;
}
function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

/** gated spillway block: piers, ogee + chute, training walls, stilling basin, gates, hoist bridge */
function spillwaySection(c, dam) {
  const b = c.b, crest = dam.crest, Wc = dam.Wc, L = dam.level, sill = dam.sill, SW = dam.SW;
  const prof = spillProfile(sill, crest, dam.apron);
  const zEnd = prof[prof.length - 1][0];
  const basinEnd = zEnd + 46;
  const x0 = -SW / 2, x1 = SW / 2;
  const pierTop = crest + 9;
  // ---- ogee + chute surfaces per bay (chute wet: CHUTE exposure)
  for (let k = 0; k < dam.bays; k++) {
    const xa = x0 + k * (BAY + PIER), xb = xa + BAY;
    c.setPart(`${dam.id}/BAY${k + 1}`, `${dam.id} ${k + 1}号溢流孔（${dam.states[k] ? '泄流' : '关闭'}）`);
    c.water(dam.next, dam.states[k] ? EXPO.CHUTE : EXPO.INNER, dam.states[k] ? 80 : 4, 0);
    for (let i = 0; i < prof.length - 1; i++) {
      const p = prof[i], q = prof[i + 1];
      b.quad('mega_concrete', xa, p[1], p[0], xa, q[1], q[0], xb, q[1], q[0], xb, p[1], p[0]);
    }
    c.water(L, EXPO.LOCK, 1.0, 0);
    b.rectZ('mega_concrete', xa, dam.apron - 4, xb, prof[0][1], prof[0][0], -1);        // upstream face below the crest
    c.water(dam.next, EXPO.DRY, 0, 0);
    for (let i = 0; i < prof.length - 1; i++) { const p = prof[i], q = prof[i + 1]; b.colQuad(xa, p[1], p[0], xb, p[1], p[0], xb, q[1], q[0], xa, q[1], q[0]); }
    // water sheet over open bays (aerated free surface down the ogee + chute, fix round 2)
    if (dam.states[k]) spillSheet(c, dam, k, xa, xb, prof);
    // gates (vertical lift) in the pier slots at Z = 1.5
    c.setPart(`${dam.id}/GATE${k + 1}`, `${dam.id} ${k + 1}号弧形闸门`);
    const gy0 = dam.states[k] ? crest + 2.6 : sill, gy1 = gy0 + (L + 0.6 - sill);
    c.water(L, dam.states[k] ? EXPO.DRY : EXPO.LOCK, dam.states[k] ? 0 : 0.8, 0);
    M.csolid(c, 'mega_steel', xa + 0.1, gy0, 0.9, xb - 0.1, gy1, 1.6, 0.03, true, true);
    c.water(L, EXPO.DRY, 0, 0);
    if (c.detail) {
      // downstream girders + bolts on the skin plate
      const n = Math.max(3, Math.round((gy1 - gy0) / 1.4));
      for (let j = 0; j <= n; j++) { const y = gy0 + ((gy1 - gy0) * j) / n; b.box('mega_steel', xa + 0.2, y - 0.14, 1.6, xb - 0.2, y + 0.14, 2.3, ALL & ~NZ); }
      for (const xs of [xa + 0.6, (xa + xb) / 2, xb - 0.6]) b.box('mega_steel', xs - 0.12, gy0, 1.6, xs + 0.12, gy1, 2.25, PZ | PX | NX);
      if (c.near) { b.push(); b.translate(0, 0, 2.3); for (let j = 0; j < n; j++) M.bolts(c, xa + 0.6, gy0 + ((gy1 - gy0) * (j + 0.3)) / n, xb - 0.6, gy0 + ((gy1 - gy0) * (j + 0.7)) / n, 0.0, 0.5, 0.022, 'steel', 1); b.pop(); }
      // hoist wire ropes from the hoist bridge to the gate
      if (c.near) for (const xs of [xa + 1.2, xb - 1.2]) b.box('steel_dark', xs - 0.025, gy1, 1.2, xs + 0.025, pierTop, 1.3, PX | NX | PZ | NZ);
    }
  }
  // ---- piers (between bays) and training walls (sides)
  for (let k = 0; k <= dam.bays; k++) {
    const outer = k === 0 || k === dam.bays;
    const xc = outer ? (k === 0 ? x0 - TRAIN / 2 : x1 + TRAIN / 2) : x0 + k * (BAY + PIER) - PIER / 2;
    const w = outer ? TRAIN : PIER, xa = xc - w / 2, xb = xc + w / 2;
    c.setPart(`${dam.id}/PIER${k}`, `${dam.id} ${outer ? '导墙' : `${k}号闸墩`}`);
    const bot = dam.apron - 4;
    // pier body: upstream nose (rounded) .. downstream along the chute
    c.water(L, EXPO.LOCK, 1.0, 0);
    b.push(); b.translate(xc, 0, -6);
    b.lathe('mega_concrete', [[w / 2, bot], [w / 2, pierTop]], c.far ? 4 : 12, { a0: Math.PI / 2, a1: Math.PI * 1.5, capTop: true });
    b.pop();
    // pier sides beside the gate: wet only up to the highest splash line above the reservoir /
    // the water running past (the wet mark follows the chute below, see the loop further down)
    // upstream of the gate the reservoir stands at L; downstream of it the sheet drops along the ogee
    // (≈ L − 5 beside the grille), so the highest splash line steps down at the gate slot
    c.water(L, EXPO.INNER, 1.2, 0);
    b.box('mega_concrete', xa, bot, -6, xb, pierTop, 1.6, PX | NX | PY);
    c.water(L - 5.0, EXPO.INNER, outer ? 1.6 : 2.4, 0);
    b.box('mega_concrete', xa, bot, 1.6, xb, pierTop, 6, PX | NX | PY);
    // downstream part of the pier follows the chute + 3.5 m (outer: training wall to the basin end)
    const zDs = outer ? basinEnd : 20;
    const chuteY = (z) => { let y = prof[prof.length - 1][1]; for (let i = 0; i < prof.length - 1; i++) if (z >= prof[i][0] && z <= prof[i + 1][0]) { const t = (z - prof[i][0]) / (prof[i + 1][0] - prof[i][0]); y = prof[i][1] + (prof[i + 1][1] - prof[i][1]) * t; } return Math.max(y, dam.apron); };
    const top = (z) => (z <= 6 ? pierTop : chuteY(z) + (outer ? 5.5 : 3.5));
    const zs = [6, 8, 12, 16, 20, 26, 34, 44, 56, 70, 86, 104, 124, zEnd, zDs].filter((z, j, arr) => z <= zDs && (j === 0 || z > arr[j - 1]));
    for (let j = 0; j < zs.length - 1; j++) {
      const za = zs[j], zb = zs[j + 1], ya = j === 0 ? Math.min(top(za), crest + 1.2) : top(za), yb = top(zb);
      // wet mark: the aerated sheet (1–3 m deep) plus spray, stepping down with the chute
      c.water(Math.max(Math.min(chuteY(za), chuteY(zb)), za >= zEnd - 1 ? dam.next : -1e9), EXPO.INNER, outer ? 3.2 : 4.2, 0);
      b.quad('mega_concrete', xa, bot, za, xa, bot, zb, xa, yb, zb, xa, ya, za);
      b.quad('mega_concrete', xb, bot, zb, xb, bot, za, xb, ya, za, xb, yb, zb);
      b.quad('mega_concrete', xa, ya, za, xa, yb, zb, xb, yb, zb, xb, ya, za);
      b.colBox(xa, bot, za, xb, Math.max(ya, yb), zb);
    }
    b.rectZ('mega_concrete', xa, bot, xb, top(zs[zs.length - 1]), zs[zs.length - 1], 1);
    b.colBox(xa, bot, -8, xb, pierTop, 6);
    c.water(dam.next, EXPO.DRY, 0, 0);
    // gate slots (dark grooves) + gate-side grille (闸侧格栅) on each pier face beside the gate
    if (c.detail) for (const s of [-1, 1]) {
      if ((k === 0 && s < 0) || (k === dam.bays && s > 0)) continue;
      const xf = s > 0 ? xb : xa;
      b.box('steel_dark', s > 0 ? xf - 0.01 : xf - 0.25, sill - 0.5, 0.8, s > 0 ? xf + 0.25 : xf + 0.01, pierTop, 1.7, ALL);
      // grille housing on the pier face just downstream of the gate slot, in the splash zone right
      // above the sheet running past (≈ L − 5 here): the highest splash line crosses it
      b.push(); b.translate(xf, 0, 0); b.rotY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
      // local frame: +Z out of the pier face; local X along ±Z of the dam
      const gzA = s > 0 ? -4.4 : 2.6, gzB = s > 0 ? -2.6 : 4.4;
      c.setPart(`${dam.id}/GRILLE${k}${s > 0 ? 'E' : 'W'}`, `${dam.id} 闸侧格栅`);
      c.water(L - 5.0, EXPO.INNER, 2.0, 0);
      M.grille(c, gzA, L - 4.1, gzB, L - 2.1, { key: 'mega_steel', depth: 0.22, proud: true, dustSide: s > 0 ? -1 : 1 });
      c.water(dam.next, EXPO.DRY, 0, 0);
      b.pop();
    }
    // stair / ladder down a pier head (near)
    if (c.near && !outer && k % 2 === 1) M.ladder(c, xa - 0.0, crest + 1.2, 6, pierTop - crest - 1.2, 0, { hoop: true });
  }
  // ---- hoist bridge (起吊轨): continuous deck on the pier heads + crane rails + gantry hoist
  c.setPart(`${dam.id}/HOIST`, `${dam.id} 坝顶起吊轨 / 门机`);
  const hx0 = x0 - TRAIN, hx1 = x1 + TRAIN;
  M.csolid(c, 'mega_concrete', hx0, pierTop, -4.2, hx1, pierTop + 1.1, 5.2, 0.05, true, true);
  if (c.detail) {
    M.craneRails(c, hx0, hx1, pierTop + 1.1, [-3.4, 4.4]);
    const gb = Math.floor(hash4(STATE_SEED, dam.i, 99, 0) % dam.bays);
    M.gantryCrane(c, x0 + gb * (BAY + PIER) + BAY / 2, pierTop + 1.1, -3.4, 4.4, 9, { hookDrop: 4 });
    // walkway railings both edges of the hoist bridge, cable tray under the downstream edge
    M.railX(c, hx0, hx1, pierTop + 1.1, -4.0, { key: 'steel_yellow' });
    M.railX(c, hx0, hx1, pierTop + 1.1, 5.0, { key: 'steel_yellow' });
    M.cableTray(c, hx0, hx1, pierTop - 0.7, 5.6, 0.6, {});
    // hoist machinery housings above every gate
    for (let k = 0; k < dam.bays; k++) {
      const xm = x0 + k * (BAY + PIER) + BAY / 2;
      M.csolid(c, 'panel_white', xm - 2.2, pierTop + 1.1, -1.0, xm + 2.2, pierTop + 3.4, 2.4, 0.04, true, false);
      if (c.near) b.box('grille_dark', xm - 1.6, pierTop + 2.0, 2.41, xm + 1.6, pierTop + 3.0, 2.43, PZ);
    }
    // crest road bridge downstream of the gates (crest level) between the piers
    c.setPart(`${dam.id}/BRIDGE`, `${dam.id} 坝顶交通桥 / 检修通道`);
    M.csolid(c, 'mega_concrete', hx0, crest - 0.8, 7, hx1, crest, 15.5, 0.04, true, true);
    b.withTint([0.95, 0.95, 0.95], () => b.rectY('mega_asphalt', hx0, 8.2, hx1, 14.3, crest + 0.02, 1));
    if (c.near) { M.railX(c, hx0, hx1, crest, 7.25, { key: 'aluminium', toe: false }); M.railX(c, hx0, hx1, crest, 15.25, { key: 'aluminium', toe: false }); }
    // maintenance walkway (grating) upstream along the gate slots, between the pier noses
    for (let k = 0; k < dam.bays; k++) {
      const xa = x0 + k * (BAY + PIER), xb = xa + BAY;
      M.grating(c, xa, -1.6, xb, 0.5, crest + 1.2, {});
      if (c.near) M.railX(c, xa, xb, crest + 1.2, -1.5, {});
    }
    for (let k = 0; k <= dam.bays; k += 2) M.lampPost(c, k === dam.bays ? hx1 - 1 : x0 + k * (BAY + PIER) - PIER / 2, pierTop + 1.1, 4.6, 0, 6);
    for (let x = hx0 + 8; x < hx1; x += 18) M.lightPool(c, x, crest + 0.15, 11.2, 6.5);
  } else {
    for (let x = hx0 + 6; x < hx1; x += 18) M.lightPool(c, x, pierTop + 1.7, 0.5, 7);
  }
  // ---- stilling basin: apron, baffle blocks, end sill
  c.setPart(`${dam.id}/BASIN`, `${dam.id} 消力池`);
  c.water(dam.next, EXPO.CHUTE, 6, 0);
  b.rectY('mega_concrete', x0 - TRAIN, zEnd, x1 + TRAIN, basinEnd, dam.apron, 1);
  b.box('mega_concrete', x0, dam.apron, basinEnd - 4, x1, dam.apron + 3.2, basinEnd, ALL & ~NY);
  if (c.detail) for (let k = 0; k < dam.bays * 2; k++) {
    const bx = x0 + (k + 0.5) * (SW / (dam.bays * 2));
    b.box('mega_concrete', bx - 1.4, dam.apron, zEnd + 10, bx + 1.4, dam.apron + 2.4, zEnd + 12.5, ALL & ~NY);
    b.box('mega_concrete', bx - 1.4 + SW / (dam.bays * 4), dam.apron, zEnd + 18, bx + 1.4 + SW / (dam.bays * 4), dam.apron + 2.0, zEnd + 20.5, ALL & ~NY);
  }
  c.water(dam.next, EXPO.DRY, 0, 0);
}

/** round control house (like the reference) on a terrace at the dam end */
function controlHouse(c, dam, side) {
  const b = c.b, crest = dam.crest;
  const xEnd = side > 0 ? dam.xr : dam.xl;
  const xc = xEnd + side * 6, zc = dam.Wc + 12;
  c.setPart(`${dam.id}/CTRL`, `${dam.id} 闸控楼`);
  // terrace platform keyed into the abutment
  const g = Math.min(groundAt(dam, xc - 14), groundAt(dam, xc + 14), groundAt(dam, xc));
  M.csolid(c, 'mega_concrete', xc - 16, Math.min(g, crest) - 4, zc - 15, xc + 16, crest, zc + 15, 0.1, true, false);
  if (c.near) { M.railX(c, xc - 16, xc + 16, crest, zc + 14.7, { key: 'aluminium', toe: false }); }
  M.roundTower(c, xc, crest, zc, 10, 9.5, { band0: 4.2, band1: 7.6, door: side > 0 ? -Math.PI / 2 : Math.PI / 2, mastH: 7, lit: true, beacon: undefined });
  M.serviceBlock(c, xc - side * 4 - 6, zc - 13, xc - side * 4 + 6, zc - 6, crest, 5, { windows: ['pz'], door: 'nz' });
}

function genDam(c) {
  const ch = c.chunk, dam = c.layout.dams[ch.dam];
  pushDam(c, dam);
  if (ch.kind === 'spill') spillwaySection(c, dam);
  else damSection(c, dam, ch.x0, ch.x1);
  if (ch.hasCtrl && !c.far) controlHouse(c, dam, ch.side === 'R' ? 1 : -1);
  else if (ch.hasCtrl) { const xEnd = ch.side === 'R' ? dam.xr + 6 : dam.xl - 6; M.roundTower(c, xEnd, dam.crest, dam.Wc + 12, 10, 9.5, {}); }
  c.b.pop();
}

// ---------------------------------------------------------------------------------------------
// switchback maintenance road
// ---------------------------------------------------------------------------------------------
function genRoad(c) {
  const ch = c.chunk, rd = c.layout.roads[ch.road], b = c.b;
  const P = rd.pts, w = rd.width / 2;
  c.setPart(rd.id, `${rd.id} 回头弯检修路`);
  // per-vertex lateral normals
  const N = P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], q = P[Math.min(P.length - 1, i + 1)];
    const dx = q.x - a.x, dz = q.z - a.z, l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  });
  const L = (i, s, off) => [P[i].x + N[i][0] * s * off - ch.cx, P[i].y, P[i].z + N[i][1] * s * off - ch.cz];
  for (let i = 0; i < P.length - 1; i++) {
    const a0 = L(i, -1, w), a1 = L(i + 1, -1, w), b0 = L(i, 1, w), b1 = L(i + 1, 1, w);
    b.quad('mega_road', a0[0], a0[1] + 0.05, a0[2], b0[0], b0[1] + 0.05, b0[2], b1[0], b1[1] + 0.05, b1[2], a1[0], a1[1] + 0.05, a1[2]);
    b.quad('mega_road', a0[0], a0[1] + 0.05, a0[2], a1[0], a1[1] + 0.05, a1[2], b1[0], b1[1] + 0.05, b1[2], b0[0], b0[1] + 0.05, b0[2]);
    b.colQuad(a0[0], a0[1], a0[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], a1[0], a1[1], a1[2]);
    if (c.far) continue;
    // fill / retaining walls where the road stands above the ground, on both edges
    for (const s of [-1, 1]) {
      const e0 = L(i, s, w + 0.4), e1 = L(i + 1, s, w + 0.4);
      const g0 = Math.min(P[i].g, P[i].y) - 0.8, g1 = Math.min(P[i + 1].g, P[i + 1].y) - 0.8;
      if (P[i].y - P[i].g > 0.6 || P[i + 1].y - P[i + 1].g > 0.6) {
        b.quad('mega_concrete', e0[0], g0, e0[2], e1[0], g1, e1[2], e1[0], e1[1] + 0.6, e1[2], e0[0], e0[1] + 0.6, e0[2]);
        b.quad('mega_concrete', e1[0], g1, e1[2], e0[0], g0, e0[2], e0[0], e0[1] + 0.6, e0[2], e1[0], e1[1] + 0.6, e1[2]);
      }
      const k0 = L(i, s, w + 0.15), k1 = L(i + 1, s, w + 0.15);
      b.quad('concrete_smooth', k0[0], k0[1] - 0.3, k0[2], k1[0], k1[1] - 0.3, k1[2], k1[0], k1[1] + 0.2, k1[2], k0[0], k0[1] + 0.2, k0[2]);
      b.quad('concrete_smooth', k1[0], k1[1] - 0.3, k1[2], k0[0], k0[1] - 0.3, k0[2], k0[0], k0[1] + 0.2, k0[2], k1[0], k1[1] + 0.2, k1[2]);
    }
    if (c.near) {
      // guard rails: both edges on fills, the outer edge elsewhere
      const fill = P[i].y - P[i].g > 0.4;
      for (const s of fill ? [-1, 1] : [1]) {
        const g0 = L(i, s, w + 0.3), g1 = L(i + 1, s, w + 0.3);
        M.railing(c, [[g0[0], g0[1], g0[2]], [g1[0], g1[1], g1[2]]], { key: 'steel', h: 0.8, spacing: 2.0, toe: false, col: true });
      }
    }
  }
  if (!c.far) for (let i = 6; i < P.length; i += 9) { const q = L(i, 1, w + 1.0); M.lampPost(c, q[0], q[1], q[2], Math.atan2(-N[i][0], -N[i][1]), 7); }
}

// ---------------------------------------------------------------------------------------------
// old-water-line deposit band: draped strip, pale crust brightest just below the old mark (crisp top edge),
// greyer and streaked lower down where the water still reaches; same at every LOD (tiny)
// ---------------------------------------------------------------------------------------------
function genBand(c) {
  const ch = c.chunk, bd = c.layout.bands[ch.band], b = c.b;
  const rows = bd.rows, nq = rows[0].length;
  c.setPart(bd.id, `G02-R${bd.res + 1} 旧水位沉积线`);
  const p = b.part('mega_deposit');
  const tone = [0.55, 0.72, 0.86, 0.96, 1.04, 1.1];
  const nk = rows.length;
  const idx = rows.map((R6, k) => R6.map((v, q) => {
    const h = hash4(c.seed, k, q, 0x5ed) / 4294967296;
    const f = q / (nq - 1), ti = Math.min(tone.length - 1, Math.round(f * (tone.length - 1)));
    const t = tone[ti] * (0.9 + 0.2 * h) * (f < 0.5 ? 0.92 + 0.16 * ((k * 7 + q * 3) % 5) / 4 : 1);
    // grid normal (along-shore × across-bank), oriented up
    const A = rows[Math.max(0, k - 1)][q], B = rows[Math.min(nk - 1, k + 1)][q], P0 = R6[Math.max(0, q - 1)], P1 = R6[Math.min(nq - 1, q + 1)];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = P1[0] - P0[0], vy = P1[1] - P0[1], vz = P1[2] - P0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    b.pushTint(t, t * 0.985, t * 0.955);
    const i = b.vert(p, v[0] - ch.cx, v[1], v[2] - ch.cz, nx / nl, ny / nl, nz / nl, q / (nq - 1), k);
    b.popTint();
    return i;
  }));
  for (let k = 0; k < rows.length - 1; k++) for (let q = 0; q < nq - 1; q++) {
    // orientation: upward-facing (the strip runs along the bank; pick the winding that faces up)
    const A = rows[k][q], B = rows[k + 1][q], C = rows[k][q + 1];
    const cr = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    if (cr > 0) b.q(p, idx[k][q], idx[k + 1][q], idx[k + 1][q + 1], idx[k][q + 1]);
    else b.q(p, idx[k][q], idx[k][q + 1], idx[k + 1][q + 1], idx[k + 1][q]);
  }
}

export function genG02Chunk(c) {
  switch (c.chunk.kind) {
    case 'dam': case 'spill': return genDam(c);
    case 'road': return genRoad(c);
    case 'band': return genBand(c);
    default: return undefined;
  }
}
void PX; void NX; void PY; void NY; void PZ; void NZ; void ALL;
