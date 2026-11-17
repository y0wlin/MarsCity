// Procedural, tileable PBR textures for the building material library. Pure JS, worker-safe,
// deterministic (seeded). Each generator returns
//   { size, metres, color: Uint8Array RGBA (sRGB base colour), normal: Uint8Array RGBA
//     (tangent space, +Y up / OpenGL), orm: Uint8Array RGBA (R = AO, G = roughness, B = metalness) }
// `metres` = world size of one tile (materials set repeat = 1/metres on uv-in-metres meshes).
// Row 0 of every array is v = 0 (bottom) — upload with flipY = false.

import { mulberry32 } from '../../core/hash.js';

// ---------------------------------------------------------------------------
// tileable value noise
// ---------------------------------------------------------------------------
function grid(period, seed) {
  const r = mulberry32(seed >>> 0), g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  return g;
}
/** Periodic value noise: x,y >= 0 in texture space (1 = one tile); period = power of two. */
function vnoise(g, period, x, y) {
  const fx = x * period, fy = y * period;
  const ix = fx | 0, iy = fy | 0;
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const m = period - 1;
  const x0 = ix & m, y0 = (iy & m) * period, x1 = (ix + 1) & m, y1 = ((iy + 1) & m) * period;
  const a = g[y0 + x0], b = g[y0 + x1], c = g[y1 + x0], d = g[y1 + x1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** fbm with octaves doubling the period (stays tileable). */
function makeFbm(seed, basePeriod, octaves = 5, gain = 0.5) {
  const G = [], P = [], A = [];
  let a = 1, n = 0;
  for (let o = 0; o < octaves; o++) { G.push(grid(basePeriod << o, seed + o * 7919)); P.push(basePeriod << o); A.push(a); n += a; a *= gain; }
  for (let o = 0; o < octaves; o++) A[o] /= n;
  const no = octaves;
  return (x, y) => {
    let s = 0;
    for (let o = 0; o < no; o++) s += A[o] * vnoise(G[o], P[o], x, y);
    return s;
  };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

// ---------------------------------------------------------------------------
// output helpers
// ---------------------------------------------------------------------------
function out(size, metres) {
  return { size, metres, color: new Uint8Array(size * size * 4), normal: new Uint8Array(size * size * 4), orm: new Uint8Array(size * size * 4), H: new Float32Array(size * size) };
}
/** Normal map from height field (metres-ish units scaled by strength). */
function bakeNormal(T, strength) {
  const N = T.size, H = T.H, nm = T.normal;
  for (let y = 0; y < N; y++) {
    const ym = ((y - 1 + N) % N) * N, yp = ((y + 1) % N) * N, y0 = y * N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N, xp = (x + 1) % N;
      const dx = (H[y0 + xp] - H[y0 + xm]) * strength, dy = (H[yp + x] - H[ym + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz);
      const o = (y0 + x) * 4;
      nm[o] = ((nx / l) * 0.5 + 0.5) * 255; nm[o + 1] = ((ny / l) * 0.5 + 0.5) * 255; nm[o + 2] = ((nz / l) * 0.5 + 0.5) * 255; nm[o + 3] = 255;
    }
  }
  delete T.H;
  return T;
}
function put(T, i, r, g, b, ao, rough, metal) {
  const o = i * 4, c = T.color, m = T.orm;
  c[o] = clamp01(r) * 255; c[o + 1] = clamp01(g) * 255; c[o + 2] = clamp01(b) * 255; c[o + 3] = 255;
  m[o] = clamp01(ao) * 255; m[o + 1] = clamp01(rough) * 255; m[o + 2] = clamp01(metal) * 255; m[o + 3] = 255;
}

/**
 * Rectangular joint pattern: returns {d (distance to nearest joint, m), id (panel id), u, v (local)}
 * pw, ph panel size; offset = running-bond offset fraction per row.
 */
function joints(xm, ym, pw, ph, offset = 0) {
  const row = Math.floor(ym / ph);
  const xo = xm + row * offset * pw;
  const col = Math.floor(xo / pw);
  const lu = xo - col * pw, lv = ym - row * ph;
  const d = Math.min(lu, pw - lu, lv, ph - lv);
  return { d, row, col, lu, lv };
}

// ---------------------------------------------------------------------------
// generators
// ---------------------------------------------------------------------------
const GEN = {};

/** Glazed ceramic façade panels 1.2 × 0.6 m stack-bond, 8 mm joints. Tile 2.4 m. */
GEN.ceramic = (size = 1024) => {
  const M = 2.4, T = out(size, M);
  const n1 = makeFbm(11, 8, 5), n2 = makeFbm(12, 64, 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, xm = u * M, ym = v * M;
    const j = joints(xm, ym, 1.2, 0.6, 0);
    const pid = hash2(((j.col % 2) + 2) % 2, ((j.row % 4) + 4) % 4, 5);
    const jw = 0.004, bev = 0.006;
    const inJ = 1 - smooth(jw, jw + 0.0015, j.d);
    const edge = smooth(jw, jw + bev, j.d);
    const tone = 0.93 + pid * 0.05 + n1(u, v) * 0.02;
    const glaze = n2(u, v);
    const r = tone * 0.96, g = tone * 0.955, b = tone * 0.94;
    const jr = 0.42;
    const i = y * size + x;
    T.H[i] = edge * 0.002 + glaze * 0.00015 - inJ * 0.002;
    put(T, i, r * (1 - inJ) + jr * inJ, g * (1 - inJ) + jr * inJ, b * (1 - inJ) + (jr + 0.01) * inJ, 1 - inJ * 0.5, 0.22 + glaze * 0.05 + pid * 0.06 + inJ * 0.55, 0);
  }
  return bakeNormal(T, 1.8 * size / M);
};

/** Bright ceramic band (slab edges, balcony fronts): long panels 2.4 × 0.65, fine joints. */
GEN.ceramic_band = (size = 512) => {
  const M = 4.8, T = out(size, M);
  const n1 = makeFbm(21, 4, 4), n2 = makeFbm(22, 64, 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, xm = u * M, ym = v * M;
    const j = joints(xm, ym, 2.4, 1.2, 0.0);
    const inJ = 1 - smooth(0.003, 0.0045, Math.min(j.lu, 2.4 - j.lu));
    const tone = 0.955 + n1(u, v) * 0.012 + hash2(j.col & 1, j.row & 3, 9) * 0.02;
    const i = y * size + x;
    T.H[i] = -inJ * 0.0015 + n2(u, v) * 0.0001;
    put(T, i, tone * (1 - inJ) + 0.5 * inJ, tone * 0.995 * (1 - inJ) + 0.5 * inJ, tone * 0.985 * (1 - inJ) + 0.5 * inJ, 1 - inJ * 0.4, 0.18 + n2(u, v) * 0.04 + inJ * 0.5, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** Concrete: mottled cement, pores, formwork panel joints 1.2×2.4 with tie holes. Tile 4.8 m. */
GEN.concrete = (size = 1024) => {
  const M = 4.8, T = out(size, M);
  const n1 = makeFbm(31, 6, 6, 0.55), n2 = makeFbm(32, 256, 2), n3 = makeFbm(33, 24, 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, xm = u * M, ym = v * M;
    const j = joints(xm, ym, 1.2, 2.4, 0);
    const line = 1 - smooth(0.002, 0.004, j.d);
    const tx = ((j.lu % 0.6) + 0.6) % 0.6 - 0.3, ty = ((j.lv % 0.6) + 0.6) % 0.6 - 0.3;
    const hole = 1 - smooth(0.009, 0.013, Math.hypot(tx, ty));
    // bug holes: small (≈ 1–2 cm) and sparse (a few % of the area), not blotches
    const pore = smooth(0.73, 0.86, n2(u, v) * 0.5 + 0.5);
    const m = n1(u, v), s = n3(u, v);
    const tone = 0.62 + m * 0.07 + s * 0.03 - pore * 0.11 - line * 0.06 - hole * 0.25;
    const i = y * size + x;
    T.H[i] = -pore * 0.0008 - line * 0.0012 - hole * 0.004 + m * 0.0004;
    put(T, i, tone * 1.0, tone * 0.985, tone * 0.955, 1 - hole * 0.6 - pore * 0.2, 0.82 + s * 0.08 - m * 0.04, 0);
  }
  return bakeNormal(T, 2.0 * size / M);
};

/** Smooth render / plaster (interiors, soffits). Tile 2 m. */
GEN.render = (size = 512) => {
  const M = 2.0, T = out(size, M);
  const n1 = makeFbm(41, 8, 5), n2 = makeFbm(42, 96, 2);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const t = 0.94 + n1(u, v) * 0.015, g = n2(u, v);
    T.H[i] = g * 0.00025 + n1(u, v) * 0.0003;
    put(T, i, t, t * 0.995, t * 0.985, 1, 0.86 + g * 0.06, 0);
  }
  return bakeNormal(T, 1.2 * size / M);
};

/** Granite / terrazzo speckled stone. Tile 1.2 m. */
GEN.stone = (size = 512) => {
  const M = 1.2, T = out(size, M);
  const n1 = makeFbm(51, 6, 5), n2 = makeFbm(52, 256, 1);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const sp = n2(u, v), m = n1(u, v);
    const dark = smooth(0.42, 0.7, sp), light = smooth(-0.6, -0.8, sp);
    const t = 0.66 + m * 0.04 - dark * 0.1 + light * 0.08;
    T.H[i] = sp * 0.0002;
    put(T, i, t, t * 0.985, t * 0.96, 1, 0.55 - light * 0.15 + m * 0.05, 0);
  }
  return bakeNormal(T, 1.0 * size / M);
};

/** Stone blocks with joints (plinths, copings): 0.9 × 0.45 running bond. Tile 1.8 m. */
GEN.stone_blocks = (size = 512) => {
  const M = 1.8, T = out(size, M);
  const n1 = makeFbm(61, 6, 5), n2 = makeFbm(62, 160, 1);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size, xm = u * M, ym = v * M;
    const j = joints(xm, ym, 0.9, 0.45, 0.5);
    const inJ = 1 - smooth(0.004, 0.007, j.d);
    const sp = n2(u, v), m = n1(u, v), pid = hash2(j.col & 7, j.row & 3, 3);
    const t = 0.6 + m * 0.05 + pid * 0.05 - smooth(0.35, 0.6, sp) * 0.15 - inJ * 0.25;
    T.H[i] = -inJ * 0.003 + sp * 0.0002 + smooth(0.007, 0.03, j.d) * 0.001;
    put(T, i, t, t * 0.98, t * 0.95, 1 - inJ * 0.5, 0.6 + inJ * 0.3, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** Exterior paving: 0.6 × 0.6 slabs, 5 mm joints, wear and dirt. Tile 2.4 m. */
GEN.paving = (size = 1024) => {
  const M = 2.4, T = out(size, M);
  const n1 = makeFbm(71, 6, 5), n2 = makeFbm(72, 128, 2), n3 = makeFbm(73, 3, 3);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size, xm = u * M, ym = v * M;
    const j = joints(xm, ym, 0.6, 0.6, 0);
    const inJ = 1 - smooth(0.003, 0.005, j.d);
    const pid = hash2(j.col & 3, j.row & 3, 7);
    const m = n1(u, v), g = n2(u, v), dirt = smooth(0.1, 0.6, n3(u, v));
    const t = 0.7 + pid * 0.06 + m * 0.03 - dirt * 0.07 - inJ * 0.3;
    T.H[i] = -inJ * 0.003 + g * 0.0003 + smooth(0.005, 0.02, j.d) * 0.0008;
    put(T, i, t * 1.0, t * 0.975, t * 0.94, 1 - inJ * 0.5, 0.7 + g * 0.08 + inJ * 0.2, 0);
  }
  return bakeNormal(T, 1.6 * size / M);
};

/** Brushed aluminium: horizontal streaks (along u). Tile 0.6 m. */
GEN.brushed = (size = 512) => {
  const M = 0.6, T = out(size, M);
  const gs = grid(size, 81);
  const n1 = makeFbm(82, 4, 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // streaks: 1D noise along v (rows), stretched along u
      const s = vnoise(gs, size, u * 0.02, v) * 0.6 + vnoise(gs, size, u * 0.05 + 0.3, v * 0.5) * 0.4;
      const i = y * size + x;
      const t = 0.82 + s * 0.05 + n1(u, v) * 0.02;
      T.H[i] = s * 0.00012;
      put(T, i, t, t * 1.005, t * 1.02, 1, 0.3 + s * 0.08 + n1(u, v) * 0.04, 1);
    }
  }
  return bakeNormal(T, 1.0 * size / M);
};

/** Galvanised / painted steel mottling. Tile 1 m. */
GEN.galvanised = (size = 256) => {
  const M = 1.0, T = out(size, M);
  const n1 = makeFbm(91, 6, 4), n2 = makeFbm(92, 24, 2);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const sp = n2(u, v), m = n1(u, v);
    const t = 0.72 + m * 0.06 + (sp > 0.2 ? 0.05 : 0);
    T.H[i] = sp * 0.0002;
    put(T, i, t, t * 1.0, t * 1.01, 1, 0.42 + m * 0.1 + (sp > 0.2 ? -0.08 : 0), 1);
  }
  return bakeNormal(T, 0.6 * size / M);
};

/** Paint orange-peel (equipment casings, doors). Tile 0.5 m. */
GEN.paint = (size = 256) => {
  const M = 0.5, T = out(size, M);
  const n1 = makeFbm(101, 32, 2), n2 = makeFbm(102, 4, 3);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const p = n1(u, v), t = 0.95 + n2(u, v) * 0.03;
    T.H[i] = p * 0.00008;
    put(T, i, t, t, t, 1, 0.38 + n2(u, v) * 0.06, 0);
  }
  return bakeNormal(T, 1.0 * size / M);
};

/** Timber boards along u (decks, benches, doors). boardW m. Tile 2.4 m. */
function woodGen(seed, boardW, size, M, tone) {
  const T = out(size, M);
  const n1 = makeFbm(seed, 4, 4), gs = grid(256, seed + 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, xm = u * M, ym = v * M;
    const row = Math.floor(ym / boardW);
    const off = hash2(row & 255, 0, seed) * M;
    const xx = (xm + off) % M;
    const boardLen = M / 2;
    const seg = Math.floor(xx / boardLen);
    const lv = ym - row * boardW, lu = xx - seg * boardLen;
    const d = Math.min(lv, boardW - lv);
    const dEnd = Math.min(lu, boardLen - lu);
    const gap = 1 - smooth(0.0025, 0.004, Math.min(d, dEnd));
    const pid = hash2(row & 255, seg, seed + 1);
    const grain = vnoise(gs, 256, (u * 3 + pid) % 1, (v * M / boardW * 0.25 + pid * 7) % 1) * 0.5 + Math.sin((lv / boardW) * 20 + vnoise(gs, 256, u * 2 % 1, v) * 4) * 0.25;
    const t = (0.75 + pid * 0.25 + grain * 0.12 + n1(u, v) * 0.06) * (1 - gap * 0.7);
    const i = y * size + x;
    T.H[i] = -gap * 0.002 + grain * 0.0002;
    put(T, i, t * tone[0], t * tone[1], t * tone[2], 1 - gap * 0.5, 0.55 + grain * 0.1 + gap * 0.3, 0);
  }
  return bakeNormal(T, 1.4 * size / M);
}
GEN.wood_deck = (size = 1024) => woodGen(111, 0.145, size, 2.4, [0.62, 0.44, 0.3]);
GEN.wood_floor = (size = 1024) => woodGen(121, 0.19, size, 2.4, [0.72, 0.56, 0.4]);
GEN.wood = (size = 512) => woodGen(131, 0.6, size, 1.2, [0.66, 0.5, 0.36]);

/** Porcelain floor tiles 0.6 × 0.6 with grout. Tile 2.4 m. */
GEN.tile_floor = (size = 1024) => {
  const M = 2.4, T = out(size, M);
  const n1 = makeFbm(141, 8, 4), n2 = makeFbm(142, 96, 2);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size, xm = u * M, ym = v * M;
    const j = joints(xm, ym, 0.6, 0.6, 0);
    const inJ = 1 - smooth(0.0015, 0.003, j.d);
    const pid = hash2(j.col & 3, j.row & 3, 11);
    const t = 0.78 + pid * 0.04 + n1(u, v) * 0.03 - inJ * 0.3;
    T.H[i] = -inJ * 0.0015 + n2(u, v) * 0.00005;
    put(T, i, t, t * 0.98, t * 0.95, 1 - inJ * 0.4, 0.25 + n1(u, v) * 0.05 + inJ * 0.5, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** White wall tiles 0.3 × 0.6 (bath, kitchen splashback). Tile 1.2 m. */
GEN.tile_wall = (size = 512) => {
  const M = 1.2, T = out(size, M);
  const n1 = makeFbm(151, 8, 3);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size, xm = u * M, ym = v * M;
    const j = joints(xm, ym, 0.6, 0.3, 0.5);
    const inJ = 1 - smooth(0.0012, 0.0025, j.d);
    const t = 0.93 + n1(u, v) * 0.015 - inJ * 0.25;
    T.H[i] = -inJ * 0.001 + smooth(0.0025, 0.01, j.d) * 0.0006;
    put(T, i, t, t, t * 0.99, 1 - inJ * 0.3, 0.12 + inJ * 0.6, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** Roof membrane: 2 m wide welded sheets, slight ponding stains. Tile 6 m. */
GEN.membrane = (size = 1024) => {
  const M = 6.0, T = out(size, M);
  const n1 = makeFbm(161, 4, 5), n2 = makeFbm(162, 128, 2), n3 = makeFbm(163, 2, 3);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size, xm = u * M;
    const lu = xm % 2.0;
    const seam = smooth(0.0, 0.03, lu) * (1 - smooth(0.03, 0.05, lu)) ;
    const stain = smooth(0.2, 0.7, n3(u, v));
    const t = 0.5 + n1(u, v) * 0.04 - stain * 0.06 + seam * 0.03;
    T.H[i] = seam * 0.003 + n2(u, v) * 0.0003;
    put(T, i, t, t * 0.99, t * 0.98, 1, 0.78 - stain * 0.1 + n2(u, v) * 0.05, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** Gravel ballast. Tile 1 m. */
GEN.gravel = (size = 512) => {
  const M = 1.0, T = out(size, M);
  const n1 = makeFbm(171, 4, 3);
  const cells = 48;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const fx = u * cells, fy = v * cells, ix = Math.floor(fx), iy = Math.floor(fy);
    let d1 = 9, id = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = ((ix + ox) % cells + cells) % cells, cy = ((iy + oy) % cells + cells) % cells;
      const px = ix + ox + hash2(cx, cy, 1), py = iy + oy + hash2(cx, cy, 2);
      const d = Math.hypot(fx - px, fy - py); if (d < d1) { d1 = d; id = hash2(cx, cy, 3); }
    }
    const hgt = Math.max(0, 1 - d1 * 1.6);
    const t = 0.45 + id * 0.25 + n1(u, v) * 0.05 - (1 - hgt) * 0.15;
    const i = y * size + x;
    T.H[i] = Math.sqrt(hgt) * 0.01;
    put(T, i, t, t * 0.97, t * 0.93, 0.6 + hgt * 0.4, 0.85, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** Planter soil with clods and bark mulch. Tile 1 m. */
GEN.soil = (size = 512) => {
  const M = 1.0, T = out(size, M);
  const n1 = makeFbm(181, 8, 5, 0.6), n2 = makeFbm(182, 64, 2);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const c = n1(u, v), g = n2(u, v);
    const mulch = smooth(0.3, 0.5, g);
    const t = 0.22 + c * 0.06 + mulch * 0.08;
    T.H[i] = c * 0.006 + g * 0.002;
    put(T, i, t * 1.15 + mulch * 0.05, t * 0.92, t * 0.72, 0.8, 0.95, 0);
  }
  return bakeNormal(T, 1.2 * size / M);
};

/** Foliage surface (lobed leaf normals, light/dark variation). Tile 0.6 m. */
GEN.leaf = (size = 256) => {
  const M = 0.6, T = out(size, M);
  const n1 = makeFbm(191, 16, 3, 0.6), n2 = makeFbm(192, 4, 2);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const c = n1(u, v), m = n2(u, v);
    const t = 0.75 + c * 0.35 + m * 0.1;
    T.H[i] = c * 0.01;
    put(T, i, t, t, t, 0.65 + c * 0.35, 0.7, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** Bark (vertical fissures). Tile 0.5 m. */
GEN.bark = (size = 256) => {
  const M = 0.5, T = out(size, M);
  const n1 = makeFbm(201, 4, 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const f = Math.abs(Math.sin((u * 14 + n1(u, v) * 2.5) * Math.PI));
    const t = 0.3 + f * 0.2 + n1(u, v) * 0.05;
    T.H[i] = f * 0.004;
    put(T, i, t * 1.1, t * 0.95, t * 0.8, 0.7 + f * 0.3, 0.9, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** Fabric weave. Tile 0.1 m. */
GEN.fabric = (size = 512) => {
  // upholstery weave readable at 1–3 m (QA-ASSETS-04): 4 mm basket weave, heathered threads and
  // slub mottling at cm scale (the old 2.5 mm weave on a 0.1 m tile mip-mapped to a flat colour)
  const M = 0.4, T = out(size, M), P = 100;
  const n1 = makeFbm(211, 6, 3), n2 = makeFbm(212, 24, 2);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const cu = Math.floor(u * P), cv = Math.floor(v * P), fu = u * P - cu, fv = v * P - cv;
    const over = (cu + cv) & 1;                           // basket: warp over / weft over
    const prof = over ? Math.sin(fu * Math.PI) : Math.sin(fv * Math.PI);
    const heather = hash2(cu & 255, (cv >> 1) & 255, 213) - 0.5;
    const slub = n1(u, v), fine = n2(u, v);
    const t = 0.78 + prof * 0.12 + heather * 0.08 + slub * 0.07 + fine * 0.03;
    T.H[i] = prof * 0.00035 + slub * 0.0002;
    put(T, i, t, t, t, 0.85 + prof * 0.15, 0.92, 0);
  }
  return bakeNormal(T, 0.5 * size / M);
};

/** Dark perforated grille / louvre infill. Tile 0.3 m. */
GEN.grille = (size = 256) => {
  const M = 0.3, T = out(size, M);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const gx = (u * 30) % 1, gy = (v * 30) % 1;
    const hole = 1 - smooth(0.26, 0.32, Math.hypot(gx - 0.5, gy - 0.5));
    const t = 0.18 * (1 - hole) + 0.02 * hole;
    T.H[i] = -hole * 0.002;
    put(T, i, t, t, t * 1.05, 1 - hole * 0.8, 0.5 + hole * 0.4, 0.6 * (1 - hole));
  }
  return bakeNormal(T, 1.0 * size / M);
};

/** PV panel cells (uv 0..1 over one 1.0 × 1.7 m panel): 6 × 10 cells, busbars. */
GEN.solar = (size = 512) => {
  const T = out(size, 1);
  const n1 = makeFbm(221, 8, 3);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const cu = (u * 6) % 1, cv = (v * 10) % 1;
    const gap = (cu < 0.03 || cu > 0.97 || cv < 0.02 || cv > 0.98) ? 1 : 0;
    const bus = (Math.abs(cu - 0.33) < 0.006 || Math.abs(cu - 0.66) < 0.006) ? 1 : 0;
    const t = 0.05 + n1(u, v) * 0.02;
    const i4 = i;
    T.H[i4] = gap * -0.0005;
    if (gap) put(T, i4, 0.78, 0.8, 0.82, 1, 0.4, 0.2);
    else if (bus) put(T, i4, 0.6, 0.62, 0.64, 1, 0.3, 0.8);
    else put(T, i4, t * 0.7, t * 0.9, t * 2.2 + 0.05, 1, 0.12, 0.3);
  }
  return bakeNormal(T, 0.002 * size);
};

/** O-zone utility panels: 1.2 × 2.4 m insulated panels with joints and fixings. Tile 4.8 m. */
GEN.panel = (size = 1024) => {
  const M = 4.8, T = out(size, M);
  const n1 = makeFbm(231, 6, 5), n2 = makeFbm(232, 2, 3);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size, xm = u * M, ym = v * M;
    const j = joints(xm, ym, 1.2, 2.4, 0);
    const inJ = 1 - smooth(0.006, 0.009, j.d);
    const fx = Math.min(Math.abs(j.lu - 0.05), Math.abs(j.lu - 1.15)), fy = ((j.lv % 0.6) + 0.6) % 0.6 - 0.3;
    const rivet = 1 - smooth(0.006, 0.01, Math.hypot(fx, fy));
    const dust = smooth(0.0, 0.8, n2(u, v)) * smooth(1.2, 0.0, j.lv);
    const t = 0.88 + n1(u, v) * 0.03 - inJ * 0.45 - dust * 0.06 - rivet * 0.1;
    T.H[i] = -inJ * 0.004 + rivet * 0.002 + n1(u, v) * 0.0003;
    put(T, i, t, t * 0.99, t * 0.97 - dust * 0.03, 1 - inJ * 0.5, 0.45 + dust * 0.2 + inJ * 0.3, 0);
  }
  return bakeNormal(T, 1.5 * size / M);
};

/** Frosted glass roughness / slight waviness. Tile 1 m. */
GEN.frost = (size = 256) => {
  const M = 1.0, T = out(size, M);
  const n1 = makeFbm(241, 32, 3);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const n = n1(u, v);
    T.H[i] = n * 0.0004;
    put(T, i, 0.9, 0.93, 0.95, 1, 0.35 + n * 0.1, 0);
  }
  return bakeNormal(T, 1.0 * size / M);
};

/** Low-frequency macro variation (tint), tile 40 m, used by the macro patch. */
GEN.macro = (size = 256) => {
  const M = 40, T = out(size, M);
  const n1 = makeFbm(251, 3, 5, 0.55);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size;
    const n = n1(u, v) * 0.5 + 0.5;
    T.H[i] = 0;
    put(T, i, n, n, n, 1, n, 0);
  }
  return bakeNormal(T, 0);
};

/**
 * Leaf atlas for alpha-tested foliage cards (uv 0..1 per card): many overlapping lobed leaves,
 * darker toward the cluster centre, midribs, alpha = leaf coverage (stored in color.a).
 */
GEN.foliage = (size = 512) => {
  const T = out(size, 1);
  const r = mulberry32(2601);
  const alpha = new Float32Array(size * size);
  const col = new Float32Array(size * size * 3);
  const H = T.H;
  const leaves = 150;
  for (let k = 0; k < leaves; k++) {
    // leaves fill a rough disc; centre leaves darker (inner shade)
    const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * 0.42;
    const cx = 0.5 + Math.cos(ang) * rad, cy = 0.5 + Math.sin(ang) * rad;
    const L = 0.07 + r() * 0.06, Wd = L * (0.32 + r() * 0.18);
    const rot = ang + (r() - 0.5) * 1.6;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const shade = 0.55 + 0.45 * (rad / 0.42) + (r() - 0.5) * 0.15;
    const g0 = [0.2 + r() * 0.08, 0.31 + r() * 0.11, 0.09 + r() * 0.06];   // olive / sap greens (props' leaf hues)
    const x0 = Math.max(0, Math.floor((cx - L) * size)), x1 = Math.min(size - 1, Math.ceil((cx + L) * size));
    const y0 = Math.max(0, Math.floor((cy - L) * size)), y1 = Math.min(size - 1, Math.ceil((cy + L) * size));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x / size - cx, dy = y / size - cy;
      const u = (dx * ca + dy * sa) / L, v = (-dx * sa + dy * ca) / Wd; // u along leaf [-1,1]
      if (u < -1 || u > 1) continue;
      const half = Math.pow(Math.max(0, 1 - u * u), 0.75) * (u > 0 ? 1 - u * 0.25 : 1);
      const av = Math.abs(v);
      if (av > half) continue;
      const i = y * size + x;
      const rib = Math.max(0, 1 - av / 0.08);
      const edge = av / Math.max(half, 1e-3);
      const t = shade * (0.85 + 0.15 * (1 - edge)) * (1 + rib * 0.18);
      col[i * 3] = g0[0] * t; col[i * 3 + 1] = g0[1] * t; col[i * 3 + 2] = g0[2] * t;
      alpha[i] = 1;
      H[i] = (1 - edge * edge) * 0.004 + k * 0.00001;
    }
  }
  for (let i = 0; i < size * size; i++) {
    const a = alpha[i];
    const o = i * 4;
    // linear mean albedo ≈ (0.07, 0.13, 0.02): dark green foliage (QQ-03, 0.05–0.15)
    T.color[o] = clamp01(col[i * 3] * 1.4) * 255; T.color[o + 1] = clamp01(col[i * 3 + 1] * 1.4) * 255; T.color[o + 2] = clamp01(col[i * 3 + 2] * 1.4) * 255; T.color[o + 3] = a * 255;
    // roughness 0.84 (props' leaves 0.82); occlusion = the inner shade of the spray
    T.orm[o] = 255; T.orm[o + 1] = 0.84 * 255; T.orm[o + 2] = 0; T.orm[o + 3] = 255;
  }
  return bakeNormal(T, 0.8 * size);
};

/**
 * Glazed ceramic roof tiles (pitched roofs): interlocking flat tiles 0.3 m wide in courses of
 * 0.33 m running along u, each course overlapping the one below (v = down the slope) with a
 * shadowed lap edge, vertical interlock ribs offset by half a tile per course. Tile 1.2 × 1.32 m.
 */
GEN.rooftile = (size = 512) => {
  const M = 1.32, T = out(size, M);
  const n1 = makeFbm(281, 4, 4), n2 = makeFbm(282, 64, 2);
  const W = 0.3, C = 0.33;
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size, xm = u * 1.2 * (M / 1.2), ym = v * M;
    const row = Math.floor(ym / C), lv = ym - row * C;                 // lv: 0 at the course top, C at its lap edge
    const xo = xm + (row & 1) * W * 0.5;
    const col = Math.floor(xo / W), lu = xo - col * W;
    const pid = hash2(col & 7, row & 7, 19);
    // tile surface rises towards the lap edge (thickness shadow below it)
    const slope = lv / C;
    const lap = smooth(C - 0.012, C - 0.002, lv);                     // bevelled lap edge
    const rib = 1 - smooth(0.004, 0.012, Math.min(lu, W - lu));         // interlock rib
    const groove = smooth(0.0, 0.01, lv) * (1 - smooth(0.02, 0.035, lv)); // shadow under the course above
    const t = 0.86 + pid * 0.07 + n1(u, v) * 0.03 - groove * 0.35 - lap * 0.1;
    T.H[i] = slope * 0.012 - lap * 0.008 + rib * 0.003 + n2(u, v) * 0.0002 - groove * 0.004;
    put(T, i, t, t * 0.985, t * 0.965, 1 - groove * 0.55, 0.3 + pid * 0.1 + groove * 0.3 + n2(u, v) * 0.04, 0);
  }
  return bakeNormal(T, 1.4 * size / M);
};

/** Standing-seam metal roofing: panels 0.55 m wide along u, fine ribs, slight oil-canning. */
GEN.metal_seam = (size = 512) => {
  const M = 2.2, T = out(size, M);
  const n1 = makeFbm(271, 4, 4), n2 = makeFbm(272, 64, 2);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0, u = x / size, v = y / size, xm = u * M;
    const lu = xm % 0.55;
    const rib = Math.abs(lu - 0.275) / 0.275;
    const stiff = Math.abs(Math.sin(lu / 0.55 * Math.PI * 4)) * 0.2;
    const t = 0.62 + n1(u, v) * 0.03;
    T.H[i] = stiff * 0.0005 + n2(u, v) * 0.0001 + Math.sin(v * Math.PI * 2 * 3 + n1(u, v) * 3) * 0.00015;
    put(T, i, t, t * 1.01, t * 1.03, 1, 0.42 + n1(u, v) * 0.08 + rib * 0.02, 0.85);
  }
  return bakeNormal(T, 1.2 * size / M);
};

/** Names of all textures. */
export const TEXTURE_NAMES = Object.keys(GEN);

let SRGB_LUT = null;
/** Mean linear RGB of an sRGB RGBA byte array (materials.js normalises albedo with it). */
export function meanLinear(color) {
  if (!SRGB_LUT) { SRGB_LUT = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; SRGB_LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); } }
  const m = [0, 0, 0]; let n = 0;
  for (let i = 0; i < color.length; i += 4 * 3) { m[0] += SRGB_LUT[color[i]]; m[1] += SRGB_LUT[color[i + 1]]; m[2] += SRGB_LUT[color[i + 2]]; n++; }
  return m.map((v) => v / Math.max(1, n));
}

/** Generate one texture by name (size optional). `mean` = mean linear RGB of the colour map. */
export function generateTexture(name, size) {
  const g = GEN[name];
  if (!g) throw new Error('unknown texture ' + name);
  const t = g(size);
  return { name, size: t.size, metres: t.metres, color: t.color, normal: t.normal, orm: t.orm, mean: meanLinear(t.color) };
}
