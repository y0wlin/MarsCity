// Facade details: sweeping ribbon fins (ZR signature), vertical fins / brise-soleil, blank
// signage panels, house-number plaques, wall lights, storey lines, AC screens.
// Wall-frame functions: x along facade, y up, z outward (facade plane z = 0).

import { PX, NX, PY, NY, PZ, NZ, ALL } from './MeshBuilder.js';
import { acUnit } from './roof.js';

/**
 * Sweeping ribbon fin in the BUILDING frame: a tall slender ceramic blade following a smooth
 * 3D curve (e.g. rising from ground at one corner and leaning across the facade), with an
 * elliptic section. pts: control points [[x,y,z],...] (Catmull-Rom smoothed).
 */
export function ribbonFin(b, pts, o = {}) {
  const key = o.key || 'ceramic_band', wdt = o.width ?? 0.55, th = o.thickness ?? 0.3;
  const path = catmull(pts, o.samples ?? 10);
  const n = 12, prof = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; prof.push([Math.cos(a) * th * 0.5, Math.sin(a) * wdt * 0.5]); }
  b.sweep(key, path, prof, { transport: true, smoothAngle: 70 });
}

/** Catmull-Rom resampling of 3D control points. */
export function catmull(pts, sub = 8) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const q = [0, 1, 2].map((j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3));
      out.push(q);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

/** Vertical fins (wall frame) at positions us, from y0 to y1, depth dz, thickness t. */
export function verticalFins(b, us, y0, y1, o = {}) {
  const key = o.key || 'aluminium', dz = o.depth ?? 0.35, t = o.t ?? 0.06;
  for (const u of us) b.cbox(key, u - t / 2, y0, 0.0, u + t / 2, y1, dz, 0.01);
}

/** Horizontal brise-soleil blades (wall frame) across u0..u1 at height y, n blades. */
export function sunshade(b, u0, u1, y, o = {}) {
  const key = o.key || 'aluminium', n = o.n ?? 4, depth = o.depth ?? 0.9;
  for (let i = 0; i < n; i++) {
    const z = 0.15 + (depth * (i + 0.5)) / n;
    b.push(); b.translate(0, y, z); b.rotX(-0.35);
    b.box(key, u0, -0.01, -0.09, u1, 0.01, 0.09, ALL);
    b.pop();
  }
  for (const u of [u0 + 0.05, u1 - 0.05]) b.box('steel_dark', u - 0.02, y - 0.05, 0.0, u + 0.02, y + 0.05, depth + 0.2, ALL);
}

/** Blank signage panel (light box) on the facade (wall frame), centre u, bottom y. */
export function signPanel(b, u, y, w, h, o = {}) {
  const z0 = o.z ?? 0.0;
  b.cbox(o.frameKey || 'aluminium_dark', u - w / 2, y, z0, u + w / 2, y + h, z0 + 0.09, 0.01);
  b.rectZ(o.key || 'signage_blank', u - w / 2 + 0.04, y + 0.04, u + w / 2 - 0.04, y + h - 0.04, z0 + 0.0905, 1);
}

/** Small house-number plaque (blank) beside an entrance. */
export function plaque(b, u, y, o = {}) {
  b.cbox(o.key || 'steel_brushed', u - 0.16, y, 0.0, u + 0.16, y + 0.22, 0.02, 0.004);
  b.rectZ('signage_blank', u - 0.12, y + 0.04, u + 0.12, y + 0.18, 0.0205, 1);
}

/** Wall light (up/down cylinder) at (u, y) on the facade. */
export function wallLight(b, u, y, o = {}) {
  b.cbox('aluminium_dark', u - 0.05, y - 0.15, 0.0, u + 0.05, y + 0.15, 0.1, 0.01);
  b.rectY(o.key || 'light_warm', u - 0.035, 0.02, u + 0.035, 0.08, y - 0.152, -1);
  b.rectY(o.key || 'light_warm', u - 0.035, 0.02, u + 0.035, 0.08, y + 0.152, 1);
}

/** Thin projecting storey line (wall frame) across u0..u1 at y, with gaps for openings. */
export function storeyLine(b, u0, u1, y, gaps = [], o = {}) {
  const key = o.key || 'ceramic_band', h = o.h ?? 0.12, dz = o.depth ?? 0.04;
  const cuts = gaps.filter((g) => g[1] > u0 && g[0] < u1).sort((a, c) => a[0] - c[0]);
  let u = u0;
  for (const g of cuts) { if (g[0] > u + 0.05) b.cbox(key, u, y - h / 2, -0.02, g[0], y + h / 2, dz, 0.008); u = Math.max(u, g[1]); }
  if (u1 > u + 0.05) b.cbox(key, u, y - h / 2, -0.02, u1, y + h / 2, dz, 0.008);
}

/**
 * AC unit on a ledge behind a louvred screen (wall frame): unit centred at u on a ledge at y
 * (top of the ledge), screen at depth zs.
 */
export function acScreen(b, u, y, zs, o = {}) {
  acUnit(b, u, y, zs * 0.45, 0, { w: 0.82, d: 0.3, h: 0.58 });
  const w = 1.15, h = 0.9, key = o.key || 'aluminium';
  b.box(key, u - w / 2, y, zs - 0.03, u - w / 2 + 0.04, y + h, zs, ALL);
  b.box(key, u + w / 2 - 0.04, y, zs - 0.03, u + w / 2, y + h, zs, ALL);
  for (let yy = y + 0.09; yy < y + h - 0.05; yy += 0.12) {
    b.push(); b.translate(0, yy, zs - 0.015); b.rotX(-0.6);
    b.box(key, u - w / 2 + 0.04, -0.004, -0.035, u + w / 2 - 0.04, 0.004, 0.035, PY | NY | PZ | NZ);
    b.pop();
  }
  b.box(key, u - w / 2, y + h, zs - 0.04, u + w / 2, y + h + 0.03, zs + 0.005, ALL);
}

export { PX, NX, PY, NY, PZ, NZ };
