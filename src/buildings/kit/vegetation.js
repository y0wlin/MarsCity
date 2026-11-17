// Planting for planters, balconies and roof gardens (street trees belong to props/).
// Deterministic from seeds. A foliage clump = a small dark core ('plant', hides see-through gaps)
// + alpha-tested leaf cards ('foliage' atlas) placed on the clump's surface and facing outwards,
// with normals bent away from the clump centre so it shades like a volume (bright top, darker
// underside). Trunks/limbs 'bark', soil 'soil'. Vertex tints vary hue / brightness per plant.

import { Rng, hash4 } from '../../core/hash.js';

const GREENS = [[0.20, 0.36, 0.12], [0.24, 0.42, 0.14], [0.17, 0.31, 0.12], [0.30, 0.45, 0.16], [0.22, 0.38, 0.18], [0.27, 0.40, 0.11], [0.19, 0.34, 0.2]];
const FLOWERS = [[0.85, 0.42, 0.55], [0.95, 0.9, 0.85], [0.92, 0.72, 0.3], [0.7, 0.45, 0.8], [0.9, 0.55, 0.35]];

function green(r, k = 1) { const g = GREENS[Math.floor(r.next() * GREENS.length)]; const v = 0.85 + r.next() * 0.3; return [g[0] * v * k, g[1] * v * k, g[2] * v * k]; }

const CUV = [0, 0, 1, 0, 1, 1, 0, 1];

/**
 * Foliage clump of radius `rad` at (x,y,z): ellipsoidal (ry = rad·squash), `cards` leaf cards on
 * a Fibonacci-jittered shell facing outwards, a small dark core.
 */
export function leafCluster(b, x, y, z, rad, seed, tint, cards = 9, squash = 0.82) {
  const r = new Rng(hash4(seed, 13, 0, 0));
  b.pushTint([tint[0] * 0.45, tint[1] * 0.45, tint[2] * 0.45]);
  b.blob('plant', x, y, z, rad * 0.5, rad * 0.42 * squash / 0.82, rad * 0.5, seed, 0);
  b.popTint();
  const p = b.part('foliage');
  const prev = b.uvMode; b.uvMode = 1;
  // cards keep the atlas colour; the tint only shifts hue / brightness slightly; every card is
  // darkened by its ambient occlusion inside the clump (underside and deep cards darker)
  const g = Math.max(tint[1], 1e-3);
  const ct = [Math.min(1.2, (tint[0] / g) * 1.6), 0.95 + (tint[1] - 0.38) * 0.6, Math.min(1.2, (tint[2] / g) * 1.6)];
  b.pushTint(ct);
  const golden = 2.399963229728653;
  const off0 = r.next() * 6.283;
  for (let i = 0; i < cards; i++) {
    // direction on the shell (Fibonacci sphere, biased upwards a little), jittered
    const t = (i + 0.5) / cards;
    const cy = 1 - 2 * t * 0.92;
    const sr = Math.sqrt(Math.max(0, 1 - cy * cy));
    const ph = off0 + i * golden + (r.next() - 0.5) * 0.6;
    let nx = Math.cos(ph) * sr, ny = cy + 0.15, nz = Math.sin(ph) * sr;
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    // card centre slightly inside the shell, card faces outwards but tilted randomly (no edge-on cards)
    const depth = r.next();
    const dist = rad * (0.45 + depth * 0.25);
    const cxp = x + nx * dist, cyp = y + ny * dist * squash, czp = z + nz * dist;
    const ao = (0.55 + 0.45 * Math.min(1, Math.max(0, ny * 0.55 + 0.5))) * (0.82 + 0.18 * depth);
    b.tint(ct[0] * ao, ct[1] * ao, ct[2] * ao);
    let fx = nx + (r.next() - 0.5) * 0.9, fy = ny + (r.next() - 0.5) * 0.9 + 0.2, fz = nz + (r.next() - 0.5) * 0.9;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    // tangent frame of the card
    let ux = -fz, uy = 0, uz = fx; let ul = Math.hypot(ux, uy, uz); if (ul < 1e-3) { ux = 1; uz = 0; ul = 1; } ux /= ul; uz /= ul;
    const vx = fy * uz - fz * uy, vy = fz * ux - fx * uz, vz = fx * uy - fy * ux;
    const rot = r.next() * 6.283, cr = Math.cos(rot), sn = Math.sin(rot);
    const ax = ux * cr + vx * sn, ay = uy * cr + vy * sn, az = uz * cr + vz * sn;
    const bx = -ux * sn + vx * cr, by = -uy * sn + vy * cr, bz = -uz * sn + vz * cr;
    const s = rad * (0.62 + r.next() * 0.38);
    let i0 = 0, i1 = 0, i2 = 0, i3 = 0;
    for (let k = 0; k < 4; k++) {
      const a = (k === 0 || k === 3 ? -1 : 1) * s, c = (k < 2 ? -1 : 1) * s;
      const px = cxp + ax * a + bx * c, py = cyp + ay * a + by * c, pz = czp + az * a + bz * c;
      // bent normal: from the clump centre towards the vertex, biased up (sky-lit crown)
      const qx = px - x, qy = (py - y) / squash + rad * 0.5, qz = pz - z; const ql = Math.hypot(qx, qy, qz) || 1;
      const vi = b.vert(p, px, py, pz, qx / ql, qy / ql, qz / ql, CUV[k * 2], CUV[k * 2 + 1]);
      if (k === 0) i0 = vi; else if (k === 1) i1 = vi; else if (k === 2) i2 = vi; else i3 = vi;
    }
    b.q(p, i0, i1, i2, i3);
  }
  b.popTint();
  b.uvMode = prev;
}

/** Shrub: 1–3 clumps. size ≈ diameter (m). */
export function shrub(b, x, y, z, size, seed, o = {}) {
  const r = new Rng(hash4(seed, 11, 0, 0));
  const n = size > 0.7 ? 3 : size > 0.4 ? 2 : 1;
  const tint = o.tint || green(r);
  for (let i = 0; i < n; i++) {
    const s = size * (0.42 + r.next() * 0.22);
    const ox = (r.next() - 0.5) * size * 0.4, oz = (r.next() - 0.5) * size * 0.4;
    leafCluster(b, x + ox, y + s * 0.58, z + oz, s * 0.62, (seed * 7 + i) >>> 0, tint, s > 0.3 ? 10 : 7);
  }
  if (o.flowers || (o.flowers === undefined && r.next() < 0.25)) {
    const f = FLOWERS[Math.floor(r.next() * FLOWERS.length)];
    b.pushTint(f);
    for (let i = 0; i < 4; i++) b.blob('plant', x + (r.next() - 0.5) * size * 0.6, y + size * (0.5 + r.next() * 0.3), z + (r.next() - 0.5) * size * 0.6, size * 0.11, size * 0.08, size * 0.11, seed + i * 31, 0);
    b.popTint();
  }
}

/**
 * Small ornamental tree (2–5 m): tapered trunk, 3–4 limbs ending in clumps, rounded crown of
 * 8–12 clumps distributed in an ellipsoid (reads as a tree crown, not a stick with a ball).
 */
export function smallTree(b, x, y, z, h, seed, o = {}) {
  const r = new Rng(hash4(seed, 23, 0, 0));
  const tr = Math.max(0.05, h * 0.03);
  const crownY = y + h * 0.58;
  b.lathe('bark', [[tr * 1.6, 0], [tr * 1.15, 0.15], [tr, h * 0.4], [tr * 0.75, h * 0.6]], 8, { x, y, z, capTop: true });
  const tint = o.tint || green(r, 1.05);
  const cr = h * 0.34, cyr = h * 0.27;                      // crown radii
  const ccy = crownY + cyr * 0.75;
  const limbs = 3 + Math.floor(r.next() * 2);
  const tips = [];
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + r.next() * 0.8, L = cr * (0.55 + r.next() * 0.25);
    const ex = x + Math.cos(a) * L, ez = z + Math.sin(a) * L, ey = ccy + (r.next() - 0.3) * cyr * 0.6;
    b.tube('bark', [[x, crownY - h * 0.06, z], [x + (ex - x) * 0.45, (crownY + ey) * 0.5 + 0.1, z + (ez - z) * 0.45], [ex, ey, ez]], tr * 0.5, 6);
    tips.push([ex, ey, ez]);
  }
  // clumps: one per limb tip + a shell of clumps around the crown centre + a top clump
  const clumps = tips.map((t) => [t[0], t[1], t[2], cr * (0.42 + r.next() * 0.12)]);
  const ns = 6 + Math.floor(r.next() * 4);
  for (let i = 0; i < ns; i++) {
    const a = (i / ns) * Math.PI * 2 + r.next() * 0.7, e = (r.next() - 0.35) * 1.2;
    const rr = cr * (0.55 + r.next() * 0.3);
    clumps.push([x + Math.cos(a) * rr * Math.cos(e), ccy + Math.sin(e) * cyr * 0.85, z + Math.sin(a) * rr * Math.cos(e), cr * (0.36 + r.next() * 0.14)]);
  }
  clumps.push([x + (r.next() - 0.5) * cr * 0.3, ccy + cyr * 0.7, z + (r.next() - 0.5) * cr * 0.3, cr * 0.42]);
  for (let i = 0; i < clumps.length; i++) {
    const c = clumps[i];
    const ti = [tint[0] * (0.9 + r.next() * 0.2), tint[1] * (0.9 + r.next() * 0.2), tint[2] * (0.9 + r.next() * 0.2)];
    leafCluster(b, c[0], c[1], c[2], c[3], (seed * 13 + i) >>> 0, ti, 11, 0.8);
  }
}

/**
 * Hanging / trailing plant spilling over an edge at (x,y,z) towards dirZ·z (local): a cushion clump
 * on the edge and a curtain of 4–7 vine strands of overlapping leaf cards that bulge out over the
 * edge and taper as they fall (R2 / Z02 balcony greenery). len = longest strand (m), width = spread.
 */
export function trailing(b, x, y, z, len, seed, dirZ = 1, width = 0.7) {
  const r = new Rng(hash4(seed, 37, 0, 0));
  const tint = green(r, 1.0);
  leafCluster(b, x, y + 0.03, z - dirZ * 0.1, 0.2, seed, tint, 8, 0.62);
  const p = b.part('foliage');
  const prev = b.uvMode; b.uvMode = 1;
  const g = Math.max(tint[1], 1e-3);
  b.pushTint([Math.min(1.2, (tint[0] / g) * 1.6), 0.95 + (tint[1] - 0.38) * 0.6, Math.min(1.2, (tint[2] / g) * 1.6)]);
  const strands = 4 + Math.floor(r.next() * 4);
  for (let st = 0; st < strands; st++) {
    const sx = x + (r.next() - 0.5) * width;
    const L = len * (0.4 + r.next() * 0.8);
    const n = Math.max(3, Math.ceil(L / 0.11));
    const ph = r.next() * 6.283, sway = 0.025 + r.next() * 0.05, bulge = 0.06 + r.next() * 0.1;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const cy = y - L * t;
      const cz = z + dirZ * (0.03 + bulge * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.62));
      const cx = sx + Math.sin(t * 4.2 + ph) * sway;
      const sz = 0.13 * (1 - 0.4 * t) * (0.8 + r.next() * 0.45);
      // card faces outwards with yaw / pitch jitter, random roll
      const yaw = (r.next() - 0.5) * 1.5, pitch = (r.next() - 0.35) * 0.9;
      const fx = Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = dirZ * Math.cos(yaw) * Math.cos(pitch);
      let ux = fz, uz = -fx; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const vx = fy * uz, vy = fz * ux - fx * uz, vz = -fy * ux;
      const rot = r.next() * 6.283, cr = Math.cos(rot), sn = Math.sin(rot);
      const ax = ux * cr + vx * sn, ay = vy * sn, az = uz * cr + vz * sn;
      const bx = -ux * sn + vx * cr, by = vy * cr, bz = -uz * sn + vz * cr;
      let i0 = 0, i1 = 0, i2 = 0, i3 = 0;
      for (let q = 0; q < 4; q++) {
        const a = (q === 0 || q === 3 ? -1 : 1) * sz, c = (q < 2 ? -1 : 1) * sz;
        const px = cx + ax * a + bx * c, py = cy + ay * a + by * c, pz = cz + az * a + bz * c;
        // bent normal: outwards from the strand + up (sky-lit), so the curtain shades as a volume
        const nx = (px - sx) * 2.0 + fx * 0.6, ny = 0.45 + fy * 0.3, nz = dirZ * 0.8 + fz * 0.4;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const vi = b.vert(p, px, py, pz, nx / nl, ny / nl, nz / nl, CUV[q * 2], CUV[q * 2 + 1]);
        if (q === 0) i0 = vi; else if (q === 1) i1 = vi; else if (q === 2) i2 = vi; else i3 = vi;
      }
      b.q(p, i0, i1, i2, i3);
    }
  }
  b.popTint();
  b.uvMode = prev;
}

/**
 * Fill a planter rectangle (current frame, soil surface at y) with shrubs, ground cover and an
 * optional small tree. density: shrubs per m².
 */
export function plantBed(b, x0, z0, x1, z1, y, seed, o = {}) {
  const r = new Rng(hash4(seed, 41, 0, 0));
  const area = (x1 - x0) * (z1 - z0);
  const dens = o.density ?? 1.2;
  const n = Math.max(1, Math.min(o.max ?? 40, Math.round(area * dens)));
  const m = 0.12;
  for (let i = 0; i < n; i++) {
    const x = x0 + m + (x1 - x0 - 2 * m) * r.next(), z = z0 + m + (z1 - z0 - 2 * m) * r.next();
    const s = (o.size ?? 0.55) * (0.6 + r.next() * 0.8);
    shrub(b, x, y, z, Math.min(s, (x1 - x0) * 0.9, (z1 - z0) * 1.2), (seed * 131 + i) >>> 0);
  }
  if (o.tree) {
    const tx = (x0 + x1) / 2 + (r.next() - 0.5) * (x1 - x0) * 0.3, tz = (z0 + z1) / 2;
    smallTree(b, tx, y, tz, o.treeH ?? 3.2, seed * 7 + 3);
  }
}

/** Planter box (current frame): walls with coping, soil, plants. */
export function planterBox(b, x0, z0, x1, z1, y0, h, seed, o = {}) {
  const t = o.t ?? 0.08, key = o.key || 'ceramic_band';
  b.cbox(key, x0, y0, z0, x1, y0 + h, z0 + t, 0.015, false);
  b.cbox(key, x0, y0, z1 - t, x1, y0 + h, z1, 0.015, false);
  b.cbox(key, x0, y0, z0 + t - 0.001, x0 + t, y0 + h, z1 - t + 0.001, 0.015, false);
  b.cbox(key, x1 - t, y0, z0 + t - 0.001, x1, y0 + h, z1 - t + 0.001, 0.015, false);
  const sy = y0 + h - 0.06;
  b.rectY('soil', x0 + t, z0 + t, x1 - t, z1 - t, sy, 1);
  if (o.plants !== false) plantBed(b, x0 + t, z0 + t, x1 - t, z1 - t, sy, seed, o);
  // trailing plants over the outer long edge (local −z / +z chosen by o.trailSide)
  if (o.trail) {
    const n = Math.max(1, Math.round((x1 - x0) / 0.9));
    const zt = o.trail > 0 ? z1 + 0.02 : z0 - 0.02;
    for (let i = 0; i < n; i++) { if ((seed + i) % 2) continue; trailing(b, x0 + (x1 - x0) * (i + 0.5) / n, sy + 0.05, zt, 0.5 + ((seed + i) % 3) * 0.15, (seed * 5 + i) >>> 0, o.trail > 0 ? 1 : -1); }
  }
}
