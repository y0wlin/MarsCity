// Procedural prop models (main thread, deterministic). OWNER: props agent.
// Every builder returns {parts: {materialKey: BufferGeometry}, ...dims}. Models are in metres,
// base at y = 0, front / travel direction along +z (vehicles, people) unless noted.
import * as THREE from 'three';
import { Geo, ring } from './geo.js';

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------------------------------------
// vegetation
// ---------------------------------------------------------------------------------------------
export const SPECIES = [
  { name: 'broadleafA', H: 8.6, trunk: 2.7, crownR: 3.1, cell: 0, tiers: 3, clumps: 22, cards: 13, color: [0.78, 0.80, 0.55] },
  { name: 'broadleafB', H: 9.8, trunk: 2.5, crownR: 4.1, cell: 0, tiers: 0, clumps: 26, cards: 13, color: [0.66, 0.72, 0.52] },
  { name: 'blossom', H: 5.2, trunk: 1.5, crownR: 2.5, cell: 2, tiers: 0, clumps: 16, cards: 12, color: [1.0, 0.96, 0.98] },
  { name: 'poplar', H: 14.5, trunk: 1.4, crownR: 1.7, cell: 0, tiers: 0, clumps: 34, cards: 12, color: [0.80, 0.84, 0.52] },
  { name: 'conifer', H: 10.5, trunk: 0.9, crownR: 2.5, cell: 3, tiers: 9, clumps: 0, cards: 0, color: [0.75, 0.80, 0.72] },
  { name: 'roundSmall', H: 4.6, trunk: 1.35, crownR: 1.95, cell: 1, tiers: 0, clumps: 14, cards: 12, color: [0.86, 0.86, 0.52] },
];

const CELL_UV = (cell) => [(cell % 2) * 0.5, (cell >> 1) * 0.5];

/** store the card plane normal (cross of the card axes) in the leaf Geo extras (aCardN, facing fade) */
function cardNormal(leaf, ax, ay, az, bx, by, bz) {
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1;
  if (leaf.extra.cnx) leaf.set('cnx', nx / l).set('cny', ny / l).set('cnz', nz / l);
}
export const LEAF_EXTRAS = ['cnx', 'cny', 'cnz'];

/**
 * Bark tube with arc-length UVs (tile ~0.42 m around × 0.84 m along) so the bark texel density is the
 * same on the trunk and on thin branches (QQ-09: no magnified blocky bark).
 */
function barkTube(g, path, radii, segs, capEnd = false) {
  const rows = [];
  let px = [1, 0, 0], vAcc = 0;
  for (let k = 0; k < path.length; k++) {
    const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let ux = px[1] * tz - px[2] * ty, uy = px[2] * tx - px[0] * tz, uz = px[0] * ty - px[1] * tx;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-4) { px = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0]; ux = px[1] * tz - px[2] * ty; uy = px[2] * tx - px[0] * tz; uz = px[0] * ty - px[1] * tx; ul = Math.hypot(ux, uy, uz); }
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
    px = [vx, vy, vz];
    if (k > 0) vAcc += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1], path[k][2] - path[k - 1][2]);
    const r = radii[k];
    const uRep = Math.max(1, Math.round((2 * Math.PI * radii[0]) / 0.42));
    const row = [];
    for (let s = 0; s <= segs; s++) {
      const an = (s / segs) * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
      const nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
      row.push(g.vert(path[k][0] + nx * r, path[k][1] + ny * r, path[k][2] + nz * r, nx, ny, nz, (s / segs) * uRep, vAcc / 0.84));
    }
    rows.push(row);
  }
  for (let k = 0; k + 1 < rows.length; k++) for (let s = 0; s < segs; s++) g.quadIdx(rows[k][s], rows[k][s + 1], rows[k + 1][s + 1], rows[k + 1][s]);
  if (capEnd) { const k = path.length - 1; const c = g.vert(path[k][0], path[k][1], path[k][2], 0, 1, 0, 0, vAcc / 0.84); for (let s = 0; s < segs; s++) g.tri(c, rows[k][s], rows[k][s + 1]); }
}

/**
 * Leaf card around point p: normal f (unit), size s, rotation rot; bent shading normal from the crown
 * volume (lit top / dark underside) blended with the card normal; AO tint from the depth in the crown.
 */
function leafCard(leaf, p, f, s, rot, cell, tint, crownC, crownR, stretch = 1) {
  const [u0, v0] = CELL_UV(cell);
  let ux = -f[2], uz = f[0]; let ul = Math.hypot(ux, uz); if (ul < 1e-3) { ux = 1; uz = 0; ul = 1; } ux /= ul; uz /= ul;
  const vx = f[1] * uz, vy = f[2] * ux - f[0] * uz, vz = -f[1] * ux;
  const cr = Math.cos(rot), sn = Math.sin(rot);
  const ax = ux * cr + vx * sn, ay = vy * sn, az = uz * cr + vz * sn;
  const bx = -ux * sn + vx * cr, by = vy * cr, bz = -uz * sn + vz * cr;
  cardNormal(leaf, ax, ay, az, bx, by, bz);
  const ids = [];
  for (let k = 0; k < 4; k++) {
    const a = (k === 0 || k === 3 ? -1 : 1) * s, b = (k < 2 ? -1 : 1) * s * stretch;
    const qx = p[0] + ax * a + bx * b, qy = p[1] + ay * a + by * b, qz = p[2] + az * a + bz * b;
    let mx = (qx - crownC[0]) / crownR[0], my = (qy - crownC[1]) / crownR[1] + 0.3, mz = (qz - crownC[2]) / crownR[0];
    const ml = Math.hypot(mx, my, mz) || 1; mx = mx / ml * 0.85 + f[0] * 0.3; my = my / ml * 0.85 + f[1] * 0.3 + 0.12; mz = mz / ml * 0.85 + f[2] * 0.3;
    const rel = Math.min(1.15, Math.hypot((qx - crownC[0]) / crownR[0], (qy - crownC[1]) / crownR[1], (qz - crownC[2]) / crownR[0]));
    const hgt = Math.max(0, Math.min(1, ((qy - crownC[1]) / crownR[1]) * 0.5 + 0.5));
    const ao = 0.58 + 0.36 * Math.pow(rel, 1.4) + 0.14 * hgt;
    leaf.color(tint[0] * ao, tint[1] * ao, tint[2] * ao);
    const U = k === 0 || k === 3 ? 0 : 1, V = k < 2 ? 0 : 1;
    ids.push(leaf.vert(qx, qy, qz, mx, my, mz, u0 + U * 0.5, v0 + V * 0.5));
  }
  leaf.quadIdx(ids[0], ids[1], ids[2], ids[3]);
}

/**
 * Broadleaf LOD0 (fix round 2): a real branching skeleton (flared trunk -> leader -> limbs -> branches ->
 * twigs, bark tubes with arc-length UVs) carrying small leaf-cluster cards at the twigs in layered shells
 * (outer shell dense and light, inner sparse and dark, gaps show the limbs). Poplar: many short steep
 * limbs along a leader (columnar); blossom: spreading low limbs; broadleafB: wide, slightly drooping.
 */
function broadleafLOD0(S, rnd, H, trunkH, R, tint, lean, bark, leaf, q = 1) {
  const narrow = S.name === 'poplar', wide = S.name === 'broadleafB', small = S.name === 'roundSmall', blossom = S.name === 'blossom';
  const baseR = Math.max(0.09, H * 0.026);
  const crownBot = trunkH + 0.2, crownTop = H;
  const crownC = [lean, (crownBot + crownTop) / 2, 0], crownR = [R, (crownTop - crownBot) / 2];
  const golden = 2.399963229728653;
  // ---- trunk + leader ----
  const leaderTop = narrow ? H * 0.96 : trunkH + (H - trunkH) * (wide ? 0.42 : 0.58);
  const tp = [], tr = [];
  const nT = 12;
  for (let i = 0; i <= nT; i++) {
    const t = i / nT, y = leaderTop * t;
    tp.push([lean * t * t + Math.sin(t * 5.3 + 1.1) * 0.035 * Math.min(1, y), y, Math.cos(t * 4.1) * 0.025 * Math.min(1, y)]);
    const taper = y < trunkH ? 1 : 1 - 0.78 * (y - trunkH) / Math.max(0.1, leaderTop - trunkH);
    tr.push(baseR * (1 + 0.75 * Math.exp(-y / 0.22)) * taper * (narrow ? 0.9 : 1));
  }
  barkTube(bark, tp, tr, q < 1 ? 7 : 12, false);
  const leaderAt = (y) => { const t = Math.max(0, Math.min(1, y / leaderTop)) * nT; const i = Math.min(nT - 1, Math.floor(t)), f = t - i; const a = tp[i], b = tp[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  const leaderR = (y) => { const t = Math.max(0, Math.min(1, y / leaderTop)) * nT; const i = Math.min(nT - 1, Math.floor(t)), f = t - i; return tr[i] + (tr[i + 1] - tr[i]) * f; };
  // distance along a direction from p to a fraction k of the crown envelope
  const reach = (p, d, k) => {
    const ex = (p[0] - crownC[0]) / crownR[0], ey = (p[1] - crownC[1]) / crownR[1], ez = (p[2] - crownC[2]) / crownR[0];
    const dx = d[0] / crownR[0], dy = d[1] / crownR[1], dz = d[2] / crownR[0];
    const A = dx * dx + dy * dy + dz * dz, B = 2 * (ex * dx + ey * dy + ez * dz), C = ex * ex + ey * ey + ez * ez - k * k;
    const disc = B * B - 4 * A * C;
    return disc > 0 ? Math.max(0.3, (-B + Math.sqrt(disc)) / (2 * A)) : 0.5;
  };
  const twigs = [];            // [p, dir]
  const nL = Math.max(3, Math.round((narrow ? 18 : small ? 5 : wide ? 7 : blossom ? 6 : 6) * (q < 1 ? 0.7 : 1)));
  for (let i = 0; i < nL; i++) {
    const fy = (i + 0.5) / nL;
    const y0 = narrow ? 1.3 + (leaderTop - 1.6) * fy : trunkH + (leaderTop - trunkH) * (0.04 + 0.86 * fy);
    const p0 = leaderAt(y0);
    const az = i * golden + (rnd() - 0.5) * 0.7;
    const el = narrow ? 1.15 + rnd() * 0.25 : wide ? 0.35 + rnd() * 0.3 : blossom ? 0.45 + rnd() * 0.35 : 0.55 + rnd() * 0.4 + 0.25 * fy;
    const d = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const L = reach(p0, d, narrow ? 0.95 : 0.82) * (0.85 + rnd() * 0.2);
    const nP = 6, path = [], rad = [];
    const r0 = Math.min(leaderR(y0) * 0.8, baseR * (narrow ? 0.32 : 0.55) * (1 - 0.35 * fy));
    for (let k = 0; k <= nP; k++) {
      const t = k / nP;
      const up = (narrow ? 0.1 : wide ? -0.12 : 0.25) * Math.sin(t * Math.PI * 0.5) * L * 0.35 * t;
      path.push([p0[0] + d[0] * L * t, p0[1] + d[1] * L * t + up, p0[2] + d[2] * L * t]);
      rad.push(Math.max(0.012, r0 * (1 - 0.82 * t)));
    }
    barkTube(bark, path, rad, q < 1 ? 4 : narrow ? 6 : 8, true);
    twigs.push([path[nP], d, 1]);
    // secondary branches
    const nB = q < 1 ? 2 : narrow ? 2 : small ? 3 : 4;
    for (let j = 0; j < nB; j++) {
      const tb = 0.32 + 0.6 * ((j + 0.5) / nB) + (rnd() - 0.5) * 0.08;
      const kk = Math.min(nP - 1, Math.floor(tb * nP)), ff = tb * nP - kk;
      const q0 = [path[kk][0] + (path[kk + 1][0] - path[kk][0]) * ff, path[kk][1] + (path[kk + 1][1] - path[kk][1]) * ff, path[kk][2] + (path[kk + 1][2] - path[kk][2]) * ff];
      const side = j % 2 ? 1 : -1;
      const ab = az + side * (0.6 + rnd() * 0.5), eb = el + (rnd() - 0.3) * 0.6;
      const db = [Math.cos(eb) * Math.cos(ab), Math.sin(eb), Math.cos(eb) * Math.sin(ab)];
      const Lb = Math.min(reach(q0, db, 1.0), L * (0.45 + rnd() * 0.2) * (1 - tb * 0.35)) * (narrow ? 0.8 : 1);
      const rb = Math.max(0.01, rad[kk] * 0.55);
      const bp = [], br = [];
      for (let k = 0; k <= 3; k++) { const t = k / 3; bp.push([q0[0] + db[0] * Lb * t, q0[1] + db[1] * Lb * t + 0.12 * Lb * t * t, q0[2] + db[2] * Lb * t]); br.push(Math.max(0.006, rb * (1 - 0.8 * t))); }
      if (q >= 1 || j === 0) barkTube(bark, bp, br, q < 1 ? 3 : 5, true);
      twigs.push([bp[3], db, 1]);
      twigs.push([bp[2], db, 0.8]);
      if (!narrow) twigs.push([bp[1], [db[0], db[1] + 0.6, db[2]], 0.6]);
    }
    twigs.push([path[Math.floor(nP * 0.65)], d, 0.7]);
  }
  if (narrow) for (let y = crownBot; y < leaderTop; y += 0.55) twigs.push([leaderAt(y), [rnd() - 0.5, 0.4, rnd() - 0.5], 0.75]);
  // ---- leaf clusters at the twigs ----
  const cell = S.cell;
  const perTwig = (narrow ? 8 : small ? 7 : blossom ? 11 : 9) * (q < 1 ? 0.55 : 1);   // blossom: more, layered sprays (QQ2-03)
  const cs0 = (narrow ? 0.62 : small ? 0.62 : blossom ? 0.7 : 0.82) * Math.pow(R / 3.1, 0.25) * (q < 1 ? 1.5 : 1);
  for (const [p, d, w] of twigs) {
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const n = Math.max(2, Math.round(perTwig * w));
    for (let k = 0; k < n; k++) {
      const spread = (narrow ? 0.45 : 0.75) * cs0;
      const c = [p[0] + (rnd() - 0.5) * spread * 2 + d[0] / dl * 0.25 * cs0, p[1] + (rnd() - 0.4) * spread * 1.6, p[2] + (rnd() - 0.5) * spread * 2 + d[2] / dl * 0.25 * cs0];
      let ox = c[0] - crownC[0], oy = (c[1] - crownC[1]) * 0.6, oz = c[2] - crownC[2]; const ol = Math.hypot(ox, oy, oz) || 1;
      let fx = ox / ol + (rnd() - 0.5) * 1.3 + d[0] / dl * 0.3, fy = oy / ol + (rnd() - 0.5) * 1.3 + 0.45, fz = oz / ol + (rnd() - 0.5) * 1.3 + d[2] / dl * 0.3;
      const fl = Math.hypot(fx, fy, fz) || 1;
      const ct = tint.map((v) => v * (0.86 + rnd() * 0.26));
      leafCard(leaf, c, [fx / fl, fy / fl, fz / fl], cs0 * (0.75 + rnd() * 0.45) * 0.5, rnd() * 6.283, cell, ct, crownC, crownR);
    }
  }
}

/**
 * Leaf clump: dark core blob + outward-facing alpha cards with normals bent away from the crown
 * centre (the crown shades as one volume: lit top, dark underside).
 */
function clump(leaf, core, c, r, n, cell, tint, crownC, crownR, rnd, squash = 0.85, cardK = 1.0) {
  const [u0, v0] = CELL_UV(cell);
  core.color(tint[0] * 0.11, tint[1] * 0.17, tint[2] * 0.075);
  core.blob(c[0], c[1], c[2], r * 0.45, r * 0.4 * squash, r * 0.45, 6, 4, 0.25, (rnd() * 1e9) | 0);
  const golden = 2.399963229728653, off0 = rnd() * 6.283;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, cy = 1 - 2 * t * 0.9, sr = Math.sqrt(Math.max(0, 1 - cy * cy));
    const ph = off0 + i * golden + (rnd() - 0.5) * 0.6;
    let nx = Math.cos(ph) * sr, ny = cy + 0.12, nz = Math.sin(ph) * sr; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const dist = r * (0.4 + rnd() * 0.28);
    const px = c[0] + nx * dist, py = c[1] + ny * dist * squash, pz = c[2] + nz * dist;
    let fx = nx + (rnd() - 0.5) * 0.9, fy = ny + (rnd() - 0.5) * 0.9 + 0.25, fz = nz + (rnd() - 0.5) * 0.9;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let ux = -fz, uz = fx; let ul = Math.hypot(ux, uz); if (ul < 1e-3) { ux = 1; uz = 0; ul = 1; } ux /= ul; uz /= ul;
    const vx = fy * uz, vy = fz * ux - fx * uz, vz = -fy * ux;
    const rot = rnd() * 6.283, cr = Math.cos(rot), sn = Math.sin(rot);
    const ax = ux * cr + vx * sn, ay = vy * sn, az = uz * cr + vz * sn;
    const bx = -ux * sn + vx * cr, by = vy * cr, bz = -uz * sn + vz * cr;
    const s = r * (0.6 + rnd() * 0.38) * cardK;
    const ids = [];
    cardNormal(leaf, ax, ay, az, bx, by, bz);
    for (let k = 0; k < 4; k++) {
      const a = (k === 0 || k === 3 ? -1 : 1) * s, b = (k < 2 ? -1 : 1) * s;
      const qx = px + ax * a + bx * b, qy = py + ay * a + by * b, qz = pz + az * a + bz * b;
      // bent normal: crown volume + clump + sky bias
      let mx = (qx - crownC[0]) / crownR[0] + (qx - c[0]) / r * 0.45;
      let my = (qy - crownC[1]) / crownR[1] + (qy - c[1]) / r * 0.45 + 0.35;
      let mz = (qz - crownC[2]) / crownR[0] + (qz - c[2]) / r * 0.45;
      const ml = Math.hypot(mx, my, mz) || 1; mx /= ml; my /= ml; mz /= ml;
      // ambient occlusion tint: darker inside / underneath the crown
      const rel = Math.min(1, Math.hypot((qx - crownC[0]) / crownR[0], (qz - crownC[2]) / crownR[0]));
      const hgt = Math.max(0, Math.min(1, ((qy - crownC[1]) / crownR[1]) * 0.5 + 0.5));
      const ao = 0.74 + 0.26 * hgt + 0.14 * rel;
      leaf.color(tint[0] * ao, tint[1] * ao, tint[2] * ao);
      const U = k === 0 || k === 3 ? 0 : 1, V = k < 2 ? 0 : 1;
      ids.push(leaf.vert(qx, qy, qz, mx, my, mz, u0 + U * 0.5, v0 + V * 0.5));
    }
    leaf.quadIdx(ids[0], ids[1], ids[2], ids[3]);
  }
}

/** curved limb path from a to b with an upward bow */
function limbPath(a, b, bow, n = 4) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * bow, a[2] + (b[2] - a[2]) * t]);
  }
  return pts;
}

/**
 * Build one tree. lod 0: full (limbs, twigs, ~20-30 clumps), lod 1: simplified (~8 clumps).
 * Returns {bark, core, leaf: Geo, H, crownR}.
 */
export function buildTree(sp, variant = 0, lod = 0) {
  const S = SPECIES[sp];
  const rnd = prng(1009 * (sp + 1) + 7919 * (variant + 1));
  const bark = new Geo(), core = new Geo(), leaf = new Geo(LEAF_EXTRAS);
  const H = S.H * (0.94 + rnd() * 0.12), trunkH = S.trunk, R = S.crownR * (0.92 + rnd() * 0.16);
  const tint = S.color.map((v) => v * (0.92 + rnd() * 0.16));
  const segs = lod === 0 ? 9 : 5;
  const baseR = Math.max(0.09, H * 0.026);
  bark.color(1, 1, 1);
  if (S.name === 'conifer') {
    // trunk to the top, tiers of drooping needle cards
    { const pts = [], rr = []; for (let i = 0; i <= 8; i++) { const t = i / 8, y = H * t; pts.push([0, y, 0]); rr.push(Math.max(0.03, baseR * (1 + 0.5 * Math.exp(-y / 0.3)) * (1 - 0.85 * t))); } barkTube(bark, pts, rr, segs, false); }
    const tiers = lod === 0 ? S.tiers : 5;
    const crownC = [0, H * 0.5, 0], crownR = [R, H * 0.5];
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1);
      const y = trunkH + (H - trunkH - 0.6) * f;
      const rr = R * (1 - f * 0.88) + 0.25;
      const n = lod === 0 ? Math.max(5, Math.round(10 * (1 - f * 0.6))) : 5;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + f * 2.1 + rnd() * 0.3;
        const ca = Math.cos(a), sa = Math.sin(a);
        // branch: radial tube + needle card along it (drooping)
        const tip = [ca * rr, y - rr * 0.28, sa * rr];
        if (lod === 0 && f < 0.75) barkTube(bark, limbPath([0, y + 0.1, 0], tip, rr * 0.08, 2), [baseR * 0.3, baseR * 0.2, 0.02], 4, false);
        const [u0, v0] = CELL_UV(S.cell);
        const w = rr * 0.55 + 0.2;
        // card plane: spans from trunk to tip, width w, tilted
        const px = -sa, pz = ca;                       // perpendicular (horizontal)
        const q0 = [px * w * 0.5, y + 0.15, pz * w * 0.5], q1 = [-px * w * 0.5, y + 0.15, -pz * w * 0.5];
        const q2 = [tip[0] - px * w * 0.5, tip[1], tip[2] - pz * w * 0.5], q3 = [tip[0] + px * w * 0.5, tip[1], tip[2] + pz * w * 0.5];
        const ao = 0.55 + 0.45 * f;
        leaf.color(tint[0] * ao, tint[1] * ao, tint[2] * ao);
        const nrm = (q) => { let mx = (q[0] - crownC[0]) / crownR[0], my = (q[1] - crownC[1]) / crownR[1] + 0.5, mz = (q[2] - crownC[2]) / crownR[0]; const l = Math.hypot(mx, my, mz) || 1; return [mx / l, my / l, mz / l]; };
        cardNormal(leaf, q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2], q3[0] - q0[0], q3[1] - q0[1], q3[2] - q0[2]);
        const ids = [q0, q1, q2, q3].map((q, i) => { const m = nrm(q); return leaf.vert(q[0], q[1], q[2], m[0], m[1], m[2], u0 + (i === 1 || i === 2 ? 0.5 : 0), v0 + (i >= 2 ? 0.05 : 0.5)); });
        leaf.quadIdx(ids[0], ids[1], ids[2], ids[3]);
        // a second, more vertical card for volume
        const tipU = [tip[0] * 0.7, tip[1] + rr * 0.35, tip[2] * 0.7];
        const r0 = [0, y + 0.3, 0];
        const qq = [[r0[0] + px * 0.3, r0[1], r0[2] + pz * 0.3], [r0[0] - px * 0.3, r0[1], r0[2] - pz * 0.3], [tipU[0] - px * w * 0.45, tipU[1], tipU[2] - pz * w * 0.45], [tipU[0] + px * w * 0.45, tipU[1], tipU[2] + pz * w * 0.45]];
        cardNormal(leaf, qq[1][0] - qq[0][0], qq[1][1] - qq[0][1], qq[1][2] - qq[0][2], qq[3][0] - qq[0][0], qq[3][1] - qq[0][1], qq[3][2] - qq[0][2]);
        const ids2 = qq.map((q, i) => { const m = nrm(q); return leaf.vert(q[0], q[1], q[2], m[0], m[1], m[2], u0 + (i === 1 || i === 2 ? 0.5 : 0), v0 + (i >= 2 ? 0.05 : 0.5)); });
        leaf.quadIdx(ids2[0], ids2[1], ids2[2], ids2[3]);
      }
      // dark core cone segment hides the trunk between tiers
      core.color(tint[0] * 0.09, tint[1] * 0.15, tint[2] * 0.08);
      if (t < tiers - 1) core.lathe([[rr * 0.55, y - rr * 0.2], [rr * 0.25, y + (H - trunkH) / tiers * 0.9]], lod === 0 ? 7 : 5, false, false);
    }
    return { bark, core, leaf, H, crownR: R };
  }
  // ---- broadleaf types ------------------------------------------------------------------------
  const lean = (rnd() - 0.5) * 0.25;
  if (lod === 0 || lod === 1) {
    // LOD1 (70–380 m) = the same skeleton with fewer limbs / larger cards (no dark crown core: consistent
    // with LOD0 and the impostors baked from it)
    broadleafLOD0(S, rnd, H, trunkH, R, tint, lean, bark, leaf, lod === 0 ? 1 : 0.5);
    core.color(0.05, 0.07, 0.03); core.blob(0, 0.6, 0, 0.02, 0.02, 0.02, 4, 3);     // (placeholder inside the trunk: no dark crown core at LOD0)
    return { bark, core, leaf, H, crownR: R };
  }
  const topR = baseR * 0.55;
  bark.lathe([[baseR * 1.7, 0], [baseR * 1.15, 0.25], [baseR, trunkH * 0.5], [baseR * 0.85, trunkH], [topR, trunkH + (H - trunkH) * 0.45]], segs, false, false);
  const crownBot = trunkH + 0.2, crownTop = H;
  const crownC = [lean, (crownBot + crownTop) / 2, 0];
  const crownR = [R, (crownTop - crownBot) / 2];
  const clumps = [];
  const narrow = S.name === 'poplar';
  const nClumps = lod === 0 ? S.clumps : Math.max(6, Math.round(S.clumps * 0.32));
  if (S.tiers > 0) {
    // layered crown (R2 / Z02 street trees): horizontal tiers of clumps
    for (let t = 0; t < S.tiers; t++) {
      const f = (t + 0.5) / S.tiers;
      const y = crownBot + (crownTop - crownBot) * (0.15 + 0.75 * f);
      const rr = R * (1.05 - 0.45 * f);
      const n = Math.max(3, Math.round(nClumps / S.tiers * (1.25 - 0.4 * f)));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + t * 1.3 + rnd() * 0.5;
        const d = rr * (0.55 + rnd() * 0.4);
        clumps.push([Math.cos(a) * d + lean * f, y + (rnd() - 0.5) * 0.5, Math.sin(a) * d, (lod === 0 ? 1.05 : 1.45) * (0.85 + rnd() * 0.35) * (R / 3.1)]);
      }
      clumps.push([lean * f, y + 0.4, 0, (lod === 0 ? 1.0 : 1.4) * (R / 3.1)]);
    }
  } else {
    for (let i = 0; i < nClumps; i++) {
      const u = rnd(), v = rnd();
      const th = u * Math.PI * 2, cphi = 1 - 2 * Math.pow(v, narrow ? 1 : 0.8);
      const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
      const rr = 0.62 + 0.3 * rnd();
      const x = Math.cos(th) * sphi * R * rr, z = Math.sin(th) * sphi * R * rr;
      const y = crownC[1] + cphi * crownR[1] * (narrow ? 0.92 : 0.8) * rr;
      const size = (narrow ? 1.05 : S.name === 'broadleafB' ? 1.35 : 1.0) * (0.85 + rnd() * 0.35) * (lod === 0 ? 1 : 1.5) * Math.max(0.8, R / 3);
      clumps.push([x + lean * (y - crownBot) / (crownTop - crownBot), y, z, size]);
    }
    clumps.push([lean, crownTop - crownR[1] * 0.25, 0, (narrow ? 0.9 : 1.15) * (lod === 0 ? 1 : 1.35) * Math.max(0.8, R / 3)]);
  }
  // limbs: from the trunk top to (a subset of) clumps
  const limbFrom = [lean * 0.3, trunkH + 0.1, 0];
  const nLimbs = lod === 0 ? Math.min(clumps.length, narrow ? 6 : 7) : 4;
  const order = clumps.map((c, i) => [Math.atan2(c[2], c[0]), i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  for (let i = 0; i < nLimbs; i++) {
    const c = clumps[order[Math.floor((i / nLimbs) * order.length)]];
    const end = [c[0] * 0.8, c[1] - c[3] * 0.3, c[2] * 0.8];
    const start = [limbFrom[0], limbFrom[1] + (narrow ? i * 0.9 : i * 0.18), limbFrom[2]];
    barkTube(bark, limbPath(start, end, narrow ? 0.2 : 0.45, lod === 0 ? 4 : 2), lod === 0 ? [baseR * 0.62, baseR * 0.48, baseR * 0.36, baseR * 0.25, baseR * 0.16] : [baseR * 0.55, baseR * 0.35, baseR * 0.18], lod === 0 ? 6 : 4, true);
    // twigs (lod 0): two short side branches per limb
    if (lod === 0) for (let k = 0; k < 2; k++) {
      const t = 0.5 + k * 0.25;
      const p = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t + 0.3, start[2] + (end[2] - start[2]) * t];
      const a = rnd() * 6.283;
      const q = [p[0] + Math.cos(a) * 0.9, p[1] + 0.6 + rnd() * 0.4, p[2] + Math.sin(a) * 0.9];
      bark.tube([p, q], [baseR * 0.2, baseR * 0.08], 4, false);
    }
  }
  const cards = lod === 0 ? S.cards : 7;
  for (const c of clumps) {
    const ct = tint.map((v) => v * (0.88 + rnd() * 0.24));
    clump(leaf, core, [c[0], c[1], c[2]], c[3], cards, S.cell, ct, crownC, crownR, rnd, narrow ? 1.15 : 0.82, lod === 0 ? 1.0 : 1.12);
  }
  return { bark, core, leaf, H, crownR: R };
}

/** shrub: kind 0 green shrub, 1 flowering, 2 hardy dwarf conifer */
export function buildShrub(kind) {
  const rnd = prng(3301 + kind * 17);
  const core = new Geo(), leaf = new Geo(LEAF_EXTRAS);
  const cell = kind === 1 ? 2 : kind === 2 ? 3 : 1;
  const tint = kind === 1 ? [1.0, 0.96, 0.98] : kind === 2 ? [0.72, 0.78, 0.7] : [0.8, 0.82, 0.55];
  const n = 3;
  const crownC = [0, 0.45, 0], crownR = [0.8, 0.5];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rnd(), d = 0.28 + rnd() * 0.15;
    clump(leaf, core, [Math.cos(a) * d, 0.42 + rnd() * 0.15, Math.sin(a) * d], 0.45 + rnd() * 0.12, 10, cell, tint, crownC, crownR, rnd, 0.8);
  }
  return { core, leaf };
}

// ---------------------------------------------------------------------------------------------
// street lights (pole 'metal', housing 'paint', lens 'lampHead')
// ---------------------------------------------------------------------------------------------
export const LAMP_MODELS = [
  { name: 'S', H: 6.5, arm: 1.2, double: false },
  { name: 'M', H: 8.2, arm: 1.8, double: false },
  { name: 'L', H: 10, arm: 2.4, double: false },
  { name: 'D', H: 11, arm: 2.4, double: true },
  { name: 'P', H: 4.2, arm: 0, double: false, post: true },
  { name: 'B', H: 5.6, arm: 0.7, double: false },
];
export function lampModelFor(kind, height, arm, bridge) {
  if (kind === 2) return 4;
  if (kind === 1) return 3;
  if (bridge) return 5;
  if (height <= 7) return 0;
  if (height <= 9) return 1;
  return 2;
}
/** lamp head points along +z (towards the carriageway) */
export function buildLamp(mi) {
  const M = LAMP_MODELS[mi];
  const pole = new Geo(), housing = new Geo(), lens = new Geo();
  pole.color(0.93, 0.94, 0.95);
  // base plinth + tapered pole
  pole.lathe([[0.17, 0], [0.17, 0.32], [0.11, 0.38], [0.085, 0.5], [0.06, M.H - (M.post ? 0.5 : 0.6)]], 12, false, false);
  if (M.post) {
    // post-top: lantern disc
    housing.color(0.85, 0.86, 0.88);
    housing.lathe([[0.06, M.H - 0.55], [0.32, M.H - 0.18], [0.36, M.H - 0.08], [0.06, M.H]], 14, false, true);
    lens.lathe([[0.06, M.H - 0.56], [0.3, M.H - 0.2]], 14, false, false);
    return { pole, housing, lens, H: M.H, headY: M.H - 0.3, armX: 0 };
  }
  const arms = M.double ? [1, -1] : [1];
  for (const s of arms) {
    const pts = [];
    const r0 = M.H - 0.6;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([0, r0 + Math.sin(t * Math.PI * 0.5) * 0.55, s * M.arm * (1 - Math.cos(t * Math.PI * 0.5) * 0.92 - 0.08 * (1 - t))]);
    }
    pole.tube(pts, pts.map((_, i) => 0.055 - i * 0.003), 6, false);
    const end = pts[pts.length - 1];
    // luminaire: flat elongated housing with a chamfered top, lens underneath
    housing.color(0.9, 0.91, 0.93);
    housing.push().translate(0, end[1] - 0.02, end[2] + s * 0.25);
    housing.cbox(-0.17, -0.07, -0.4, 0.17, 0.05, 0.4, 0.06, true, true);
    housing.pop();
    lens.push().translate(0, end[1] - 0.095, end[2] + s * 0.25);
    lens.box(-0.13, 0, -0.33, 0.13, 0.012, 0.33, 8);
    lens.pop();
  }
  return { pole, housing, lens, H: M.H, headY: M.H - 0.15, armX: M.arm };
}

// ---------------------------------------------------------------------------------------------
// furniture
// ---------------------------------------------------------------------------------------------
export function buildBench() {
  const wood = new Geo(), metal = new Geo();
  // seat slats along x (1.8 m), facing +z
  for (let i = 0; i < 4; i++) wood.box(-0.9, 0.43, -0.22 + i * 0.11, 0.9, 0.47, -0.14 + i * 0.11);
  for (let i = 0; i < 3; i++) { wood.push().translate(0, 0.55 + i * 0.12, -0.27).rotX(-0.22); wood.box(-0.9, 0, -0.025, 0.9, 0.08, 0.02); wood.pop(); }
  metal.color(0.35, 0.36, 0.38);
  for (const x of [-0.72, 0.72]) {
    metal.box(x - 0.03, 0, -0.25, x + 0.03, 0.43, -0.2);
    metal.box(x - 0.03, 0, 0.16, x + 0.03, 0.43, 0.21);
    metal.box(x - 0.03, 0.4, -0.25, x + 0.03, 0.44, 0.21);
    metal.push().translate(x, 0.44, -0.28).rotX(-0.22); metal.box(-0.03, 0, -0.02, 0.03, 0.42, 0.02); metal.pop();
  }
  return { wood, metal };
}
/** light bollard (plaza edges): steel post with a lit lens band under the cap (night pools, tiles.js) */
export function buildBollard() {
  const metal = new Geo(), lens = new Geo();
  metal.color(0.42, 0.44, 0.47);
  metal.lathe([[0.1, 0], [0.1, 0.7], [0.093, 0.72]], 16, false, false);
  metal.lathe([[0.093, 0.82], [0.104, 0.84], [0.104, 0.9], [0.06, 0.93], [0.0, 0.935]], 16, false, false);
  lens.lathe([[0.094, 0.715], [0.094, 0.825]], 16, false, false);
  return { metal, lampHead: lens };
}
export function buildBikeRack() {
  const metal = new Geo();
  metal.color(0.75, 0.77, 0.8);
  const pts = []; for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push([Math.cos(a) * 0.38, 0.55 + Math.sin(a) * 0.3 * (i > 0 && i < 10 ? 1 : 0) + (i === 0 || i === 10 ? -0.55 : 0), 0]); }
  const path = [[0.38, 0, 0], [0.38, 0.6, 0]];
  for (let i = 1; i < 10; i++) { const a = (i / 10) * Math.PI; path.push([Math.cos(a) * 0.38, 0.6 + Math.sin(a) * 0.3, 0]); }
  path.push([-0.38, 0.6, 0], [-0.38, 0, 0]);
  metal.tube(path, 0.025, 6, false);
  return { metal };
}
export function buildPlanter() {
  const ceramic = new Geo(), wood = new Geo();
  ceramic.color(0.95, 0.94, 0.9);
  ceramic.cbox(-0.8, 0, -0.8, 0.8, 0.55, 0.8, 0.12, false, false);
  ceramic.color(0.2, 0.15, 0.12);
  ceramic.box(-0.72, 0.5, -0.72, 0.72, 0.52, 0.72, 4);
  wood.color(0.9, 0.8, 0.7);
  wood.box(-0.82, 0.55, -0.82, 0.82, 0.6, -0.68); wood.box(-0.82, 0.55, 0.68, 0.82, 0.6, 0.82);
  return { ceramic, wood };
}
export function buildBin() {
  const paint = new Geo();
  paint.color(0.32, 0.35, 0.38);
  paint.lathe([[0.24, 0], [0.26, 0.85], [0.27, 0.9], [0.0, 0.93]], 12, false, false);
  return { paint };
}
export function buildShelter() {
  const ceramic = new Geo(), metal = new Geo(), glass = new Geo(), wood = new Geo();
  // curved white canopy (Z03 style), 4.2 m long, faces +z
  ceramic.color(0.96, 0.96, 0.95);
  const prof = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push([-0.9 + t * 1.9, 2.55 + Math.sin(t * Math.PI) * 0.18]); }
  for (let i = 0; i < prof.length - 1; i++) {
    const [z0, y0] = prof[i], [z1, y1] = prof[i + 1];
    ceramic.quad([-2.1, y0, z0], [-2.1, y1, z1], [2.1, y1, z1], [2.1, y0, z0].map((v, k) => v), [0, 0, 1, 0, 1, 1, 0, 1]);
    ceramic.quad([2.1, y0 - 0.08, z0], [2.1, y1 - 0.08, z1], [-2.1, y1 - 0.08, z1], [-2.1, y0 - 0.08, z0]);
  }
  ceramic.box(-2.1, 2.47, 0.98, 2.1, 2.57, 1.0, 16);
  metal.color(0.8, 0.82, 0.85);
  for (const x of [-1.95, 1.95]) metal.box(x - 0.05, 0, -0.75, x + 0.05, 2.5, -0.65);
  glass.box(-1.9, 0.15, -0.73, 1.9, 2.4, -0.69, 16 | 32);
  glass.box(-2.0, 0.15, -0.65, -1.96, 2.4, 0.4, 1 | 2);
  wood.color(0.85, 0.75, 0.6);
  wood.box(-1.6, 0.44, -0.6, 1.6, 0.49, -0.25);
  metal.box(-1.5, 0, -0.5, -1.44, 0.44, -0.35); metal.box(1.44, 0, -0.5, 1.5, 0.44, -0.35);
  return { ceramic, metal, glassFurn: glass, wood };
}

// ---------------------------------------------------------------------------------------------
// people (1.7 m, faces +z). Vertex colour markers: (1,0,0) shirt, (0,1,0) trousers. aPart: 0 body,
// 1 left leg, 2 right leg, 3 left arm, 4 right arm (pivots at hips 0.92 / shoulders 1.40)
// ---------------------------------------------------------------------------------------------
export function buildPerson(variant = 0) {
  const g = new Geo(['aPart']);
  const SHIRT = [1, 0, 0], PANTS = [0, 1, 0];
  const skin = variant === 1 ? [0.55, 0.38, 0.28] : variant === 2 ? [0.35, 0.24, 0.17] : [0.78, 0.6, 0.48];
  const hair = variant === 2 ? [0.05, 0.04, 0.04] : variant === 1 ? [0.12, 0.08, 0.05] : [0.18, 0.12, 0.07];
  const longCoat = variant === 3;
  // torso (tapered octagonal prism, shoulders 0.42 wide)
  g.set('aPart', 0).color(...SHIRT);
  g.push().scale(1, 1, 0.66);
  g.lathe([[0.15, 0.9], [0.165, 1.02], [0.17, 1.2], [0.2, 1.38], [0.17, 1.46], [0.07, 1.5]], 8, false, false);
  g.pop();
  // hips
  g.color(...PANTS); g.lathe([[0.13, 0.84], [0.16, 0.92], [0.15, 0.98]], 8, false, false);
  if (longCoat) { g.color(...SHIRT); g.lathe([[0.2, 0.55], [0.18, 0.9], [0.165, 1.02]], 8, false, false); }
  // neck + head + hair
  g.color(...skin); g.lathe([[0.05, 1.48], [0.055, 1.56]], 6, false, false);
  g.blob(0, 1.62, 0.01, 0.095, 0.115, 0.105, 8, 6);
  g.color(...hair); g.blob(0, 1.67, -0.012, 0.1, 0.075, 0.105, 8, 4);
  // legs
  for (const [part, x] of [[1, 0.085], [2, -0.085]]) {
    g.set('aPart', part).color(...PANTS);
    g.push().translate(x, 0, 0);
    g.lathe([[0.05, 0.08], [0.06, 0.45], [0.075, 0.7], [0.085, 0.9]], 6, false, false);
    g.color(0.12, 0.12, 0.13); g.box(-0.05, 0, -0.06, 0.05, 0.08, 0.15);
    g.pop();
  }
  // arms
  for (const [part, x] of [[3, 0.215], [4, -0.215]]) {
    g.set('aPart', part).color(...SHIRT);
    g.push().translate(x, 0, 0);
    g.lathe([[0.04, 0.8], [0.045, 1.1], [0.055, 1.38], [0.03, 1.44]], 6, false, false);
    g.color(...skin); g.blob(0, 0.76, 0, 0.04, 0.055, 0.035, 5, 3);
    g.pop();
  }
  return { people: g };
}

// ---------------------------------------------------------------------------------------------
// train car (25 m, travel +z). Body cross-section swept along z; cab nose tapers over the last 4 m
// ---------------------------------------------------------------------------------------------
const CAR_L = 25, CAR_HALF = 12.25;
function bodyProfile(scale = 1, roofDrop = 0) {
  // (x, y) half profile, symmetric, y above the rail
  const p = [[1.42, 0.62], [1.46, 1.0], [1.48, 1.9], [1.45, 2.9], [1.32, 3.35], [1.0, 3.62], [0.5, 3.74], [0, 3.76]];
  return p.map(([x, y]) => [x * scale, 0.62 + (y - 0.62) * scale - roofDrop * (y / 3.76)]);
}
export function buildTrainCar(cab) {
  const body = new Geo(), glass = new Geo(), dark = new Geo(), head = new Geo(), tail = new Geo();
  const n = cab ? 14 : 2;
  const zs = [];
  // stations along z: straight part + nose
  const noseL = cab ? 4.2 : 0;
  zs.push(-CAR_HALF);
  zs.push(CAR_HALF - noseL);
  if (cab) for (let i = 1; i <= n; i++) zs.push(CAR_HALF - noseL + noseL * (i / n));
  const rings = zs.map((z) => {
    const t = cab ? Math.max(0, (z - (CAR_HALF - noseL)) / noseL) : 0;
    const sc = 1 - 0.55 * t * t;                          // narrows
    const drop = 1.6 * t * t;                             // roof slopes down to the nose
    const prof = bodyProfile(sc, drop);
    const full = [...prof.map(([x, y]) => [x, y]), ...prof.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
    return { z, full, t };
  });
  // sweep quads
  const stripe = (y) => (y > 1.45 && y < 1.62 ? [0.32, 0.45, 0.62] : y > 1.62 && y < 1.7 ? [0.6, 0.68, 0.78] : [1, 1, 1]);
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r], B = rings[r + 1];
    for (let k = 0; k + 1 < A.full.length; k++) {
      const a0 = A.full[k], a1 = A.full[k + 1], b0 = B.full[k], b1 = B.full[k + 1];
      const yc = (a0[1] + a1[1]) / 2;
      body.color(...stripe(yc));
      body.quad([a1[0], a1[1], A.z], [a0[0], a0[1], A.z], [b0[0], b0[1], B.z], [b1[0], b1[1], B.z], [A.z / 4, a1[1] / 4, A.z / 4, a0[1] / 4, B.z / 4, b0[1] / 4, B.z / 4, b1[1] / 4]);
    }
  }
  // end caps: rear (always) and nose tip
  const cap = (R, dir) => {
    const pts = R.full;
    body.color(0.95, 0.95, 0.96);
    const cx = 0, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const c = body.vert(cx, cy, R.z, 0, 0, dir, 0, 0);
    const ids = pts.map((p) => body.vert(p[0], p[1], R.z, 0, 0, dir, p[0] / 4, p[1] / 4));
    for (let i = 0; i + 1 < ids.length; i++) { if (dir > 0) body.tri(c, ids[i + 1], ids[i]); else body.tri(c, ids[i], ids[i + 1]); }
  };
  cap(rings[0], -1);
  cap(rings[rings.length - 1], 1);
  // side window band (slightly proud of the body) and doors. Car floor = rail head + 1.0 m = platform top
  // (STATION_GEOM.PLATFORM_HEIGHT, level boarding): door glass from the sill at FLOOR to 2.95 m
  const FLOOR = 1.0;
  const winY0 = 1.95, winY1 = 2.85;
  const zEnd = CAR_HALF - (cab ? noseL + 0.6 : 0.5);
  for (const s of [1, -1]) {
    const x = s * 1.485;
    for (let d = 0; d < 3; d++) {
      const zc = -CAR_HALF + 3.6 + d * ((CAR_L - (cab ? noseL + 1.5 : 0) - 7.2) / 2);
      // door: glass with a darker frame (full height door window) down to the floor-level sill
      glass.quad(s > 0 ? [x + 0.005, FLOOR + 0.03, zc - 0.65] : [x - 0.005, FLOOR + 0.03, zc + 0.65], s > 0 ? [x + 0.005, FLOOR + 0.03, zc + 0.65] : [x - 0.005, FLOOR + 0.03, zc - 0.65], s > 0 ? [x + 0.005, 2.95, zc + 0.65] : [x - 0.005, 2.95, zc - 0.65], s > 0 ? [x + 0.005, 2.95, zc - 0.65] : [x - 0.005, 2.95, zc + 0.65]);
      // door sill plate at floor level (reads the floor line against the platform edge)
      dark.box(s > 0 ? x - 0.02 : x - 0.035, FLOOR - 0.035, zc - 0.72, s > 0 ? x + 0.035 : x + 0.02, FLOOR + 0.03, zc + 0.72);
    }
    // continuous window band between doors
    const z0 = -CAR_HALF + 0.6;
    glass.quad(s > 0 ? [x + 0.003, winY0, z0] : [x - 0.003, winY0, zEnd], s > 0 ? [x + 0.003, winY0, zEnd] : [x - 0.003, winY0, z0], s > 0 ? [x + 0.003, winY1, zEnd] : [x - 0.003, winY1, z0], s > 0 ? [x + 0.003, winY1, z0] : [x - 0.003, winY1, zEnd]);
  }
  // cab windshield and lights
  if (cab) {
    const R0 = rings.find((r) => r.t > 0.3) || rings[rings.length - 2];
    const R1 = rings[rings.length - 2];
    const wz0 = R0.z, wz1 = R1.z;
    const w0 = R0.full, w1 = R1.full;
    const pick = (P, y) => { let best = P[0]; for (const p of P) if (p[0] > 0 && Math.abs(p[1] - y) < Math.abs(best[1] - y)) best = p; return best; };
    const a = pick(w0, 2.2), b = pick(w0, 3.0), c = pick(w1, 2.0), d = pick(w1, 2.6);
    glass.quad([-a[0] * 0.98, a[1], wz0 + 0.02], [a[0] * 0.98, a[1], wz0 + 0.02], [d[0] * 0.95, d[1], wz1 + 0.02], [-d[0] * 0.95, d[1], wz1 + 0.02]);
    void b; void c;
    // headlights / tail lights near the nose tip
    const zt = CAR_HALF - 0.25;
    for (const s of [1, -1]) {
      head.box(s * 0.55 - 0.18, 1.05, zt - 0.3, s * 0.55 + 0.18, 1.18, zt - 0.05, 16 | 4 | 1 | 2);
      tail.box(s * 0.85 - 0.12, 1.05, zt - 0.5, s * 0.85 + 0.12, 1.18, zt - 0.28, 16 | 4 | 1 | 2);
    }
  }
  // undercarriage + bogies (fix round 3, ★P2): underfloor equipment between the bogies, open bogies with outboard
  // side frames / axle boxes / transom, wheelsets with tread + inner flange. The wheel tread (tape circle, r 0.43 m
  // to the rail head at y = 0) is centred on the rail centreline ±(1.435 + 0.07) / 2 = ±0.7525 m that the city
  // draws (render/city/streetBuild.js: inner gauge 1.435 m, 70 mm rail head).
  const WHEEL_X = (1.435 + 0.07) / 2, WHEEL_R = 0.43, BOGIE_Z = 8.75, BOGIE_HL = 1.55;
  dark.box(-1.25, 0.3, -CAR_HALF + 1, 1.25, 0.65, -BOGIE_Z - BOGIE_HL - 0.15);
  dark.box(-1.25, 0.3, -BOGIE_Z + BOGIE_HL + 0.15, 1.25, 0.65, BOGIE_Z - BOGIE_HL - 0.15);
  dark.box(-1.25, 0.3, BOGIE_Z + BOGIE_HL + 0.15, 1.25, 0.65, CAR_HALF - 1);
  for (const z of [-BOGIE_Z, BOGIE_Z]) {
    dark.box(-1.3, 0.6, z - BOGIE_HL - 0.15, 1.3, 0.66, z + BOGIE_HL + 0.15);    // floor over the bogie well
    for (const s of [1, -1]) {
      const x0 = s > 0 ? 0.86 : -0.98, x1 = s > 0 ? 0.98 : -0.86;               // side frame outboard of the wheel
      dark.box(x0, 0.42, z - 1.45, x1, 0.6, z + 1.45);
      dark.box(x0, 0.3, z - 0.55, x1, 0.42, z + 0.55);                           // spring plank under the bolster
      for (const zz of [-0.9, 0.9]) dark.box(s > 0 ? 0.8 : -1.0, 0.31, z + zz - 0.16, s > 0 ? 1.0 : -0.8, 0.56, z + zz + 0.16);   // axle box + primary spring
    }
    dark.box(-0.98, 0.45, z - 0.22, 0.98, 0.6, z + 0.22);                         // transom / bolster
    for (const zz of [-0.9, 0.9]) {
      dark.push().translate(0, WHEEL_R, z + zz).rotZ(Math.PI / 2); dark.lathe([[0.075, -0.8], [0.075, 0.8]], 8, false, false); dark.pop();
      for (const s of [1, -1]) {
        // [radius, axial (+ = outward)]: web, flange on the inner face, coned tread (tape circle at axial 0), outer rim
        dark.push().translate(s * WHEEL_X, WHEEL_R, z + zz).rotZ(-s * Math.PI / 2);
        dark.lathe([[0.3, -0.0675], [0.458, -0.0675], [0.458, -0.042], [0.436, -0.03], [WHEEL_R, 0.0], [0.425, 0.045], [0.42, 0.0675], [0.3, 0.0675]], 14, true, true);
        dark.pop();
      }
    }
  }
  // roof fairing
  body.color(0.9, 0.91, 0.92);
  body.cbox(-0.7, 3.7, -CAR_HALF + 3, 0.7, 3.88, CAR_HALF - (cab ? 6 : 3), 0.2, true, false);
  return { trainBody: body, trainGlass: glass, dark, headlight: head, taillight: tail, length: CAR_L };
}

// ---------------------------------------------------------------------------------------------
// boats (travel +z, waterline at y = 0)
// ---------------------------------------------------------------------------------------------
function hullGeo(g, L, B, freeboard, draft, bowK = 0.32, sternK = 0.08) {
  // plan outline of the deck: pointed bow, rounded stern
  const n = 10, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const z = -L / 2 + L * (1 - bowK) * t; const w = B / 2 * (t < 0.1 ? 0.82 + 1.8 * t : 1); pts.push([w, z]); }
  for (let i = 1; i <= n; i++) { const t = i / n; const z = L / 2 - L * bowK * (1 - t); const w = B / 2 * Math.cos(t * Math.PI / 2) ** 0.8; pts.push([w, z]); }
  const side = [...pts, ...pts.slice(0, -1).reverse().map(([x, z]) => [-x, z])];
  // hull sides from -draft (narrower) to freeboard
  for (let i = 0; i + 1 < side.length; i++) {
    const [x0, z0] = side[i], [x1, z1] = side[i + 1];
    const k = 0.78;
    // sides are wound so that the outward face is front-facing
    g.quad([x1, freeboard, z1], [x0, freeboard, z0], [x0 * k, -draft, z0], [x1 * k, -draft, z1]);
  }
  g.color(0.75, 0.76, 0.78);
  g.prism(side.map(([x, z]) => [x, z]), freeboard - 0.01, freeboard, true, false);
  return side;
}
export function buildFerry() {
  const hull = new Geo(), deck = new Geo(), glass = new Geo(), red = new Geo(), green = new Geo(), white = new Geo();
  const L = 64, B = 13, FB = 2.6, DR = 1.6, K = 0.78;
  hull.color(1, 1, 1);
  const side = hullGeo(hull, L, B, FB, DR, 0.28);
  // fix round 3 (the S05 foreground ferry): painted hull bands 3 cm proud of the plating (antifouling red under a
  // dark-blue boot stripe at the waterline, blue sheer line under the deck edge), window mullions, funnel, life-raft
  // canisters, mast down to the deck with a radar bar
  const hullBand = (y0, y1, col, off = 0.03) => {
    const n = side.length, sc = (y) => K + (1 - K) * (y + DR) / (FB + DR);
    const nrm = side.map((q, i) => { const a = side[(i - 1 + n) % n], b = side[(i + 1) % n]; const nx = b[1] - a[1], nz = -(b[0] - a[0]); const l = Math.hypot(nx, nz) || 1; return [nx / l, nz / l]; });
    const v = (q, nn, y) => [q[0] * sc(y) + nn[0] * off, y, q[1] + nn[1] * off];
    hull.color(...col);
    for (let i = 0; i + 1 < n; i++) hull.quad(v(side[i + 1], nrm[i + 1], y1), v(side[i], nrm[i], y1), v(side[i], nrm[i], y0), v(side[i + 1], nrm[i + 1], y0));
  };
  hullBand(-0.55, -0.04, [0.42, 0.12, 0.1]);
  hullBand(-0.04, 0.42, [0.1, 0.17, 0.32]);
  hullBand(2.12, 2.4, [0.2, 0.34, 0.56]);
  /** white mullions every ~1.7 m along a deck's window band (2 cm proud of the glass) */
  const mullions = (poly, y0, y1) => {
    let A = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; A += a[0] * b[1] - b[0] * a[1]; }
    hull.color(0.96, 0.96, 0.95);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
      if (l < 0.5) continue;
      const tx = dx / l, tz = dz / l, nx = A > 0 ? tz : -tz, nz = A > 0 ? -tx : tx;
      for (let s = 0.85; s < l - 0.3; s += 1.7) {
        const cx = a[0] + tx * s + nx * 0.02, cz = a[1] + tz * s + nz * 0.02, h = 0.07;
        hull.quad([cx - tx * h, y0, cz - tz * h], [cx + tx * h, y0, cz + tz * h], [cx + tx * h, y1, cz + tz * h], [cx - tx * h, y1, cz - tz * h]);
      }
    }
  };
  // superstructure: two decks, rounded prisms with window bands
  const deckOutline = (w, z0, z1, r) => { const o = []; const nn = 6; for (let i = 0; i <= nn; i++) { const a = -Math.PI / 2 + (i / nn) * Math.PI; o.push([Math.sin(a) * w, z1 - r + Math.cos(a) * r * 0.0 + (Math.cos(a)) * 0]); } return o; };
  void deckOutline;
  const levels = [{ y0: 2.6, y1: 5.4, w: B / 2 - 0.9, z0: -L / 2 + 5, z1: L / 2 - 14 }, { y0: 5.4, y1: 8.0, w: B / 2 - 2.0, z0: -L / 2 + 10, z1: L / 2 - 20 }];
  for (const lv of levels) {
    const poly = [];
    const nn = 8;
    for (let i = 0; i <= nn; i++) { const a = -Math.PI / 2 + (i / nn) * Math.PI; poly.push([Math.sin(a) * lv.w, lv.z1 + Math.cos(a) * lv.w * 0.9]); }
    poly.push([-lv.w, lv.z0 + 1.5], [-lv.w + 1.5, lv.z0], [lv.w - 1.5, lv.z0], [lv.w, lv.z0 + 1.5]);
    // walls (white) + window band as a slightly larger glass prism slice
    hull.color(0.98, 0.98, 0.97);
    hull.prism(poly, lv.y0, lv.y0 + 0.9, false, false);
    hull.prism(poly, lv.y1 - 0.45, lv.y1, true, false);
    const gpoly = poly.map(([x, z]) => [x * 0.995, z]);
    glass.prism(gpoly, lv.y0 + 0.9, lv.y1 - 0.45, false, false);
    mullions(gpoly, lv.y0 + 0.9, lv.y1 - 0.45);
  }
  // funnel aft on the upper deck (white, blue band, dark cap) and life-raft canisters along the upper deck edges
  hull.color(0.97, 0.97, 0.95); hull.cbox(-1.15, 8.0, -L / 2 + 13.2, 1.15, 10.4, -L / 2 + 16.6, 0.8, false, false);
  hull.color(0.2, 0.34, 0.56); hull.cbox(-1.17, 10.4, -L / 2 + 13.18, 1.17, 10.9, -L / 2 + 16.62, 0.8, false, false);
  deck.color(0.16, 0.17, 0.18); deck.cbox(-1.17, 10.9, -L / 2 + 13.18, 1.17, 11.25, -L / 2 + 16.62, 0.8, true, false);
  hull.color(0.94, 0.94, 0.92);
  for (const sx of [1, -1]) for (let z = -L / 2 + 19; z <= -1; z += 3.2) { const cx = sx * (B / 2 - 2.0 - 0.5); hull.cbox(cx - 0.42, 8.0, z - 0.55, cx + 0.42, 8.62, z + 0.55, 0.18, true, false); }
  // wheelhouse + mast
  hull.color(0.98, 0.98, 0.98);
  hull.cbox(-3.2, 8.0, L / 2 - 26, 3.2, 10.2, L / 2 - 21, 0.8, true, false);
  glass.box(-3.25, 8.9, L / 2 - 21.05, 3.25, 9.9, L / 2 - 20.95, 16);
  deck.color(0.7, 0.72, 0.74);
  deck.lathe([[0.14, 8.0], [0.12, 10.2], [0.08, 14.5]], 6, true, false);     // from the upper deck (was floating)
  deck.box(-1.3, 12.3, -0.12, 1.3, 12.42, 0.12);                               // radar bar / yard
  // nav lights (facing +z the port side is +x): port red, starboard green, masthead white, stern white
  red.box(3.2, 9.5, L / 2 - 22, 3.5, 9.8, L / 2 - 21.6);
  green.box(-3.5, 9.5, L / 2 - 22, -3.2, 9.8, L / 2 - 21.6);
  white.box(-0.15, 14.3, -0.15, 0.15, 14.6, 0.15);
  white.box(-0.2, 3.0, -L / 2 + 0.1, 0.2, 3.3, -L / 2 + 0.4);
  return { hull, deck, boatGlass: glass, navRed: red, navGreen: green, navWhite: white, length: L, beam: B };
}
export function buildTug() {
  const hull = new Geo(), deck = new Geo(), glass = new Geo(), red = new Geo(), green = new Geo(), white = new Geo();
  const L = 24, B = 9;
  hull.color(0.95, 0.35, 0.18);
  hullGeo(hull, L, B, 2.2, 2.0, 0.3, 0.1);
  hull.color(0.98, 0.98, 0.97);
  hull.cbox(-3, 2.2, -3, 3, 4.6, 5, 0.8, true, false);
  hull.cbox(-2.2, 4.6, 0, 2.2, 6.8, 4, 0.6, true, false);
  glass.box(-2.25, 5.6, 0, 2.25, 6.5, 4.05, 16 | 1 | 2);
  deck.color(0.25, 0.25, 0.27);
  deck.lathe([[0.25, 6.8], [0.2, 9.5]], 8, true, false);
  red.box(2.2, 6.2, 3.2, 2.5, 6.5, 3.6); green.box(-2.5, 6.2, 3.2, -2.2, 6.5, 3.6); white.box(-0.15, 9.5, -0.15, 0.15, 9.8, 0.15);
  return { hull, deck, boatGlass: glass, navRed: red, navGreen: green, navWhite: white, length: L, beam: B };
}
export function buildLaunch() {
  const hull = new Geo(), deck = new Geo(), glass = new Geo(), red = new Geo(), green = new Geo(), white = new Geo();
  const L = 11, B = 3.4;
  hull.color(1, 1, 1);
  hullGeo(hull, L, B, 1.1, 0.6, 0.38);
  hull.color(0.96, 0.96, 0.96);
  hull.cbox(-1.2, 1.1, -1.5, 1.2, 2.2, 1.6, 0.4, true, false);
  glass.box(-1.22, 1.6, 1.0, 1.22, 2.1, 1.62, 16 | 1 | 2);
  red.box(1.22, 1.9, 1.3, 1.35, 2.0, 1.5); green.box(-1.35, 1.9, 1.3, -1.22, 2.0, 1.5); white.box(-0.06, 2.6, -0.06, 0.06, 2.75, 0.06);
  deck.lathe([[0.04, 2.2], [0.03, 2.6]], 5, false, false);
  return { hull, deck, boatGlass: glass, navRed: red, navGreen: green, navWhite: white, length: L, beam: B };
}
export function buildCargoShip() {
  const hull = new Geo(), deck = new Geo(), glass = new Geo(), cargo = new Geo(), red = new Geo(), green = new Geo(), white = new Geo();
  const L = 128, B = 21;
  hull.color(0.86, 0.88, 0.9);
  hullGeo(hull, L, B, 5.5, 4.5, 0.18, 0.05);
  // containers in bays
  const cols = [[0.75, 0.22, 0.15], [0.2, 0.36, 0.6], [0.85, 0.85, 0.85], [0.35, 0.55, 0.4], [0.8, 0.55, 0.2], [0.55, 0.57, 0.6]];
  const rnd = prng(1234);
  for (let bay = 0; bay < 12; bay++) {
    const z0 = -L / 2 + 22 + bay * 7.4;
    if (z0 + 6.1 > L / 2 - 16) break;
    const tiers = 2 + Math.floor(rnd() * 3);
    for (let row = -3; row <= 3; row++) for (let t = 0; t < tiers; t++) {
      if (rnd() < 0.08) continue;
      cargo.color(...cols[Math.floor(rnd() * cols.length)]);
      cargo.box(row * 2.5 - 1.2, 5.5 + t * 2.6, z0, row * 2.5 + 1.2, 5.5 + t * 2.6 + 2.55, z0 + 6.06);
    }
  }
  // bridge at the stern
  hull.color(0.98, 0.98, 0.98);
  hull.cbox(-9, 5.5, -L / 2 + 6, 9, 17, -L / 2 + 15, 1.2, true, false);
  glass.box(-9.05, 15, -L / 2 + 14.95, 9.05, 16.4, -L / 2 + 15.05, 16);
  deck.color(0.3, 0.3, 0.32); deck.lathe([[0.3, 17], [0.2, 23]], 6, true, false);
  red.box(9.0, 16, -L / 2 + 13, 9.4, 16.4, -L / 2 + 13.6); green.box(-9.4, 16, -L / 2 + 13, -9.0, 16.4, -L / 2 + 13.6); white.box(-0.2, 22.8, -0.2, 0.2, 23.2, 0.2);
  return { hull, deck, boatGlass: glass, cargo, navRed: red, navGreen: green, navWhite: white, length: L, beam: B };
}

/** floating ferry landing: pontoon (36 m across x, 9 m along z, deck 0.8 m above the water) with a
 *  gangway towards the shore (+z) and railings; waterline at y = 0 */
export function buildLanding() {
  const hull = new Geo(), deck = new Geo(), metal = new Geo();
  hull.color(0.86, 0.87, 0.88);
  hull.box(-18, -0.6, -4.5, 18, 0.8, 4.5, 1 | 2 | 16 | 32);
  hull.color(0.22, 0.3, 0.42); hull.box(-18.02, -0.62, -4.52, 18.02, 0.05, 4.52, 1 | 2 | 16 | 32);
  deck.color(0.55, 0.56, 0.57); deck.box(-18, 0.79, -4.5, 18, 0.8, 4.5, 4);
  // waiting shelter on the pontoon
  hull.color(0.96, 0.96, 0.95); hull.cbox(-8, 3.1, -3.2, 8, 3.35, 2.6, 0.5, true, true);
  metal.color(0.75, 0.77, 0.8);
  for (const x of [-7.5, -2.5, 2.5, 7.5]) metal.box(x - 0.06, 0.8, -2.8, x + 0.06, 3.1, -2.68);
  // gangway: from the pontoon edge up to the quay (16 m, 2.6 m wide)
  const g0 = 4.5, g1 = 20.5, y0 = 0.8, y1 = 2.6, ang = Math.atan2(y1 - y0, g1 - g0), gl = Math.hypot(g1 - g0, y1 - y0);
  deck.push().translate(0, y0, g0).rotX(-ang); deck.box(-1.3, -0.12, 0, 1.3, 0.04, gl, 63); deck.pop();
  metal.push().translate(0, y0, g0).rotX(-ang);
  for (const x of [-1.3, 1.3]) { metal.box(x - 0.03, 1.0, 0, x + 0.03, 1.06, gl); for (let k = 0; k <= 4; k++) metal.box(x - 0.025, 0, k * gl / 4 - 0.025, x + 0.025, 1.0, k * gl / 4 + 0.025); }
  metal.pop();
  // railings along the pontoon's water side and ends
  for (let x = -18; x <= 18.01; x += 3) metal.box(x - 0.025, 0.8, -4.45, x + 0.025, 1.85, -4.4);
  metal.box(-18, 1.8, -4.47, 18, 1.86, -4.38);
  // bollards
  for (const x of [-15, -6, 6, 15]) metal.box(x - 0.15, 0.8, -3.9, x + 0.15, 1.15, -3.6);
  // landing stage on the shore at the gangway top (concrete block on the cliff-foot strip, 2.6 m)
  hull.color(0.62, 0.6, 0.57); hull.box(-3.2, -1.6, 20.3, 3.2, 2.6, 23.6, 1 | 2 | 4 | 16 | 32);
  for (const x of [-3.15, 3.15]) metal.box(x - 0.03, 2.6, 20.6, x + 0.03, 3.65, 23.5);
  return { hull, deck, metal };
}

/**
 * Cliff lift of a harbour ferry landing (the G01 bay head is a 40–90 m bank): white ceramic shaft with a
 * glazed car strip facing the water, machine-room head and a glazed footbridge to the cliff edge.
 * Three parts so one geometry serves every height: shaft (unit height, y 0..1, scaled per instance),
 * head (origin at the bridge deck level), bridge (unit length along +z, scaled per instance).
 * Landing frame: +z towards the shore, x along the shore.
 */
export function buildLandingTower() {
  const shaft = { hull: new Geo(), boatGlass: new Geo() };
  shaft.hull.color(0.93, 0.93, 0.92); shaft.hull.box(-1.9, 0, 0, 1.9, 1, 3.6, 1 | 2 | 16 | 32);
  shaft.hull.color(0.8, 0.81, 0.82); for (const x of [-1.96, 1.96]) shaft.hull.box(x - 0.06, 0, -0.06, x + 0.06, 1, 0.06, 1 | 2 | 16 | 32);
  shaft.boatGlass.quad([1.05, 0, -0.012], [-1.05, 0, -0.012], [-1.05, 1, -0.012], [1.05, 1, -0.012]);
  const head = { hull: new Geo(), metal: new Geo(), boatGlass: new Geo() };
  head.hull.color(0.95, 0.95, 0.94);
  head.hull.box(-2.15, -0.4, -0.25, 2.15, 3.3, 3.85, 63);                        // machine room / upper lobby
  head.hull.cbox(-2.6, 3.3, -0.7, 2.6, 3.55, 4.6, 0.3, true, true);              // roof cap
  head.boatGlass.quad([-1.2, 0.05, 3.862], [1.2, 0.05, 3.862], [1.2, 2.5, 3.862], [-1.2, 2.5, 3.862]);   // door to the bridge
  head.boatGlass.quad([1.4, 0.9, -0.262], [-1.4, 0.9, -0.262], [-1.4, 2.6, -0.262], [1.4, 2.6, -0.262]); // sea window
  head.metal.color(0.3, 0.75, 0.8); head.metal.box(-2.16, 2.75, -0.27, 2.16, 2.85, 3.87, 63);            // cyan guide band
  const bridge = { deck: new Geo(), metal: new Geo(), boatGlass: new Geo() };
  bridge.deck.color(0.62, 0.63, 0.64); bridge.deck.box(-1.45, -0.5, 0, 1.45, 0, 1, 63);
  for (const sx of [-1, 1]) {
    const x = sx * 1.42;
    bridge.boatGlass.quad([x, 0, sx > 0 ? 0 : 1], [x, 0, sx > 0 ? 1 : 0], [x, 1.1, sx > 0 ? 1 : 0], [x, 1.1, sx > 0 ? 0 : 1]);
    bridge.metal.color(0.78, 0.8, 0.82); bridge.metal.box(x - 0.035, 1.1, 0, x + 0.035, 1.16, 1, 63);
  }
  return { shaft, head, bridge };
}

// ---------------------------------------------------------------------------------------------
// eVTOL air taxi (flight +z, origin = fuselage centre; port = +x like the boats): white ceramic
// pod with a glazed nose, four ducted rotors on a lateral frame, V-tail, skids. ~8.6 m span, 5.2 m long.
// Nav lights (glow sprites, aircraft.js): red +x / green −x wing tips, white tail strobe, red top beacon.
// ---------------------------------------------------------------------------------------------
export const AIR_NAV = { tip: [4.55, 0.05, 0.0], strobe: [0, 0.55, -2.75], beacon: [0, 0.95, -0.2] };
export function buildAirTaxi() {
  const hull = new Geo(), glass = new Geo(), dark = new Geo();
  hull.color(0.95, 0.95, 0.94);
  // fuselage: lathe about y, turned onto +z
  hull.push().rotX(Math.PI / 2);
  hull.lathe([[0.0, -2.6], [0.42, -2.45], [0.72, -1.7], [0.86, -0.5], [0.84, 0.6], [0.66, 1.6], [0.36, 2.25], [0.0, 2.6]], 16);
  hull.pop();
  glass.blob(0, 0.28, 1.05, 0.66, 0.46, 1.25, 12, 7, 0, 7);                      // glazed nose / cabin
  glass.blob(0, 0.42, -0.55, 0.6, 0.3, 0.75, 10, 5, 0, 9);                        // cabin roof window
  // lateral frame + rotor ducts
  hull.color(0.9, 0.9, 0.9);
  for (const z of [-1.55, 1.55]) hull.box(-3.3, -0.06, z - 0.12, 3.3, 0.1, z + 0.12, 63);
  hull.box(-0.18, -0.06, -1.55, 0.18, 0.1, 1.55, 1 | 2 | 4 | 8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 3.3, z = sz * 1.55;
    hull.push().translate(x, 0.02, z);
    hull.lathe([[1.18, -0.14], [1.3, -0.16], [1.36, 0.0], [1.3, 0.16], [1.18, 0.14], [1.18, -0.14]], 20);
    hull.pop();
    dark.push().translate(x, 0.0, z);
    dark.lathe([[1.16, -0.012], [1.16, 0.012]], 18, true, true);                // rotor disc (blur)
    dark.lathe([[0.16, -0.18], [0.16, 0.12]], 8, true, true);                   // hub
    dark.pop();
  }
  // V-tail
  for (const sx of [-1, 1]) { hull.push().translate(sx * 0.32, 0.45, -2.25).rotZ(-sx * 0.55); hull.box(-0.04, 0, -0.45, 0.04, 0.85, 0.35, 63); hull.pop(); }
  // skids
  for (const sx of [-1, 1]) {
    dark.box(sx * 0.62 - 0.04, -1.0, -1.3, sx * 0.62 + 0.04, -0.94, 1.4, 63);
    for (const z of [-0.8, 0.9]) dark.box(sx * 0.6 - 0.03, -0.96, z - 0.03, sx * 0.55 + 0.03, -0.6, z + 0.03, 63);
  }
  return { hull, boatGlass: glass, dark };
}

// ---------------------------------------------------------------------------------------------
// road vehicles (travel +z)
// ---------------------------------------------------------------------------------------------
function wheels(g, xs, zs, r, w) {
  for (const x of xs) for (const z of zs) { g.push().translate(x, r, z).rotZ(Math.PI / 2); g.lathe([[r, -w / 2], [r, w / 2]], 10, true, true); g.pop(); }
}
export function buildCar() {
  const body = new Geo(), glass = new Geo(), tyre = new Geo(), head = new Geo(), tail = new Geo();
  body.color(1, 1, 1);
  // smooth pod body: rounded box + canopy
  body.cbox(-0.88, 0.28, -2.2, 0.88, 0.95, 2.2, 0.35, true, true);
  const can = []; const nn = 10;
  for (let i = 0; i <= nn; i++) { const a = (i / nn) * Math.PI; can.push([Math.cos(a) * 1.6, Math.sin(a) * 0.5]); }
  glass.push().translate(0, 0.95, -0.2);
  for (let i = 0; i < nn; i++) {
    const [z0, y0] = can[i], [z1, y1] = can[i + 1];
    glass.quad([0.8, y0, z0], [0.8, y1, z1], [-0.8, y1, z1], [-0.8, y0, z0]);
    glass.quad([0.8, y1, z1], [0.8, y0, z0], [0.8, 0, z0], [0.8, 0, z1].map((v) => v));
  }
  glass.pop();
  tyre.color(1, 1, 1);
  wheels(tyre, [0.8, -0.8], [1.4, -1.4], 0.33, 0.24);
  head.box(-0.7, 0.62, 2.18, -0.35, 0.72, 2.22, 16); head.box(0.35, 0.62, 2.18, 0.7, 0.72, 2.22, 16);
  tail.box(-0.75, 0.7, -2.22, 0.75, 0.78, -2.18, 32);
  return { carBody: body, carGlass: glass, tyre, headlight: head, taillight: tail };
}
export function buildVan() {
  const body = new Geo(), glass = new Geo(), tyre = new Geo(), head = new Geo(), tail = new Geo();
  body.color(1, 1, 1);
  body.cbox(-1.0, 0.35, -2.7, 1.0, 2.25, 2.0, 0.25, true, true);
  body.cbox(-1.0, 0.35, 2.0, 1.0, 1.4, 2.7, 0.3, true, true);
  glass.quad([1.0, 1.4, 2.7], [-1.0, 1.4, 2.7], [-0.95, 2.1, 2.05], [0.95, 2.1, 2.05]);
  glass.box(-1.01, 1.45, 1.2, 1.01, 2.0, 2.0, 1 | 2);
  tyre.color(1, 1, 1);
  wheels(tyre, [0.88, -0.88], [1.8, -1.9], 0.36, 0.26);
  head.box(-0.85, 0.85, 2.68, -0.5, 0.98, 2.72, 16); head.box(0.5, 0.85, 2.68, 0.85, 0.98, 2.72, 16);
  tail.box(-0.95, 1.0, -2.72, -0.75, 1.5, -2.68, 32); tail.box(0.75, 1.0, -2.72, 0.95, 1.5, -2.68, 32);
  return { carBody: body, carGlass: glass, tyre, headlight: head, taillight: tail };
}
/** O02-style autonomous utility rover */
export function buildRover() {
  const body = new Geo(), glass = new Geo(), tyre = new Geo(), head = new Geo(), tail = new Geo(), dark = new Geo();
  body.color(0.95, 0.95, 0.93);
  body.cbox(-0.95, 0.55, -1.6, 0.95, 1.35, 1.6, 0.18, true, true);
  body.cbox(-0.85, 1.35, -1.4, 0.85, 1.75, 0.5, 0.15, true, false);
  dark.color(1, 1, 1);
  dark.box(-0.75, 1.75, -0.6, 0.75, 1.83, -0.2);
  glass.quad([0.8, 1.38, 0.52], [-0.8, 1.38, 0.52], [-0.75, 1.72, 0.3], [0.75, 1.72, 0.3]);
  tyre.color(1, 1, 1);
  wheels(tyre, [0.98, -0.98], [1.05, -1.05], 0.42, 0.34);
  head.box(-0.75, 1.0, 1.58, -0.45, 1.12, 1.62, 16); head.box(0.45, 1.0, 1.58, 0.75, 1.12, 1.62, 16);
  head.box(-0.6, 1.83, -0.5, 0.6, 1.88, -0.3, 4);
  tail.box(-0.85, 1.05, -1.62, -0.6, 1.15, -1.58, 32); tail.box(0.6, 1.05, -1.62, 0.85, 1.15, -1.58, 32);
  return { carBody: body, carGlass: glass, tyre, headlight: head, taillight: tail, dark };
}

/** quad used by impostors (x in [-0.5,0.5], y in [0,1]) and glow sprites ([-1,1]²) */
export function impostorQuad() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
export function spriteQuad() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
export function poolQuad() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

export { ring };
