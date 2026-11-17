// Columns, beams, canopies and awnings. Frames: canopies/awnings use the WALL FRAME (x along
// facade, y up, z outward from the facade plane z = 0); columns use the current frame.

import { PX, NX, PY, NY, PZ, NZ } from './MeshBuilder.js';
import { roundedRect } from './math.js';

/** Round column with base plinth and top collar. */
export function columnRound(b, key, x, z, y0, y1, r = 0.2, o = {}) {
  b.cylinder(key, x, y0, z, r, y1 - y0, o.segs ?? 20, { top: false });
  if (o.base !== false) b.lathe(o.baseKey || key, [[r + 0.04, 0], [r + 0.04, 0.06], [r + 0.01, 0.09]], o.segs ?? 20, { x, y: y0, z });
}

/** Square column with chamfered edges. */
export function columnSquare(b, key, x, z, y0, y1, s = 0.35, c = 0.02) {
  b.cbox(key, x - s / 2, y0, z - s / 2, x + s / 2, y1, z + s / 2, c, false);
}

/** Grid of columns over a rect (x0..x1, z0..z1) with spacing; returns positions. */
export function columnGrid(b, key, x0, x1, z0, z1, y0, y1, spacing = 6, o = {}) {
  const nx = Math.max(1, Math.round((x1 - x0) / spacing)), nz = Math.max(1, Math.round((z1 - z0) / spacing));
  const out = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    if (o.perimeterOnly && i > 0 && i < nx && j > 0 && j < nz) continue;
    const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
    if (o.round !== false) columnRound(b, key, x, z, y0, y1, o.r ?? 0.2);
    else columnSquare(b, key, x, z, y0, y1, o.s ?? 0.35);
    out.push([x, z]);
  }
  return out;
}

/**
 * Flat cantilever canopy (wall frame) over u0..u1 projecting `depth`, top at y.
 * Fascia with crisp edge, soffit with downlights (light_warm, night gated), drip edge, optional
 * steel tie rods back to the wall.
 */
export function canopyFlat(b, o) {
  const { u0, u1, y } = o, depth = o.depth ?? 1.6, t = o.t ?? 0.18;
  const key = o.key || 'ceramic_band', sk = o.soffitKey || 'render_white';
  // body: top + fascia + soffit
  b.cbox(key, u0, y - t, -0.05, u1, y, depth, 0.025);
  // soffit lights
  const n = Math.max(1, Math.round((u1 - u0) / 1.4));
  for (let i = 0; i < n; i++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / n;
    b.cylinder('light_warm', u, y - t - 0.006, depth * 0.55, 0.07, 0.006, 14, { top: false, bottom: true });
  }
  if (o.rods) for (const u of [u0 + 0.3, u1 - 0.3]) b.tube('steel', [[u, y + 1.1, 0], [u, y + 0.02, depth - 0.15]], 0.016, 8);
  if (o.sign) b.cbox('signage_blank', (u0 + u1) / 2 - o.sign / 2, y - t + 0.03, depth + 0.004, (u0 + u1) / 2 + o.sign / 2, y - 0.03, depth + 0.02, 0.004);
  void sk;
}

/**
 * ZR curved canopy: a white ceramic arch-band springing from the ground beside the entrance,
 * rising over the door and returning into the facade (Z03 left entrance). Built as a sweep of
 * a rounded band profile along an arc in the facade-normal plane... simplified as a curved
 * cantilever whose plan edge is an elliptic arc and whose fascia thickens towards the centre.
 */
export function canopyCurved(b, o) {
  const { u0, u1, y } = o, depth = o.depth ?? 2.2, key = o.key || 'ceramic_band';
  const cx = (u0 + u1) / 2, hw = (u1 - u0) / 2;
  // plan outline: straight back edge at the wall (z=−0.05), elliptic front edge
  const segs = 24, front = [];
  for (let i = 0; i <= segs; i++) { const a = Math.PI * (i / segs); front.push([cx - Math.cos(a) * hw, -0.05 + Math.sin(a) * depth]); }
  // fascia band: sweep a rounded profile along the front curve
  const path = front.map((p) => [p[0], y, p[1]]);
  const th = o.t ?? 0.28;
  const prof = [[-0.12, -th], [0.0, -th + 0.05], [0.04, -th * 0.5], [0.0, -0.03], [-0.03, 0.0], [-0.14, 0.0]];
  b.sweep(key, path, prof.map((p) => [p[0], p[1]]), { smoothAngle: 50, caps: true });
  // top and soffit surfaces
  const inner = front.map((p) => [p[0], p[1] - 0.1]);
  const poly = [...inner];
  b.polyY(o.topKey || key, poly, [], y - 0.005, 1);
  b.polyY(o.soffitKey || 'render_white', poly, [], y - th + 0.04, -1);
  // downlights along an inner arc
  const n = Math.max(2, Math.round((u1 - u0) / 1.2));
  for (let i = 0; i < n; i++) {
    const a = Math.PI * ((i + 0.5) / n);
    b.cylinder('light_warm', cx - Math.cos(a) * hw * 0.62, y - th + 0.032, -0.05 + Math.sin(a) * depth * 0.55, 0.06, 0.006, 12, { top: false, bottom: true });
  }
}

/**
 * Glazed entrance porch / draught lobby projecting from the facade (cold climates, 门斗):
 * wall frame, spans u0..u1, depth outwards, floor at y0. Framed glass walls on three sides with
 * a glazed double door in the front, insulated roof slab with fascia and downlight.
 */
export function porch(b, o) {
  const { u0, u1, y0 } = o, depth = o.depth ?? 1.6, h = o.h ?? 2.7, fk = o.key || 'aluminium_dark';
  const W = u1 - u0;
  // corner posts
  for (const [u, z] of [[u0, depth], [u1, depth]]) b.cbox(fk, u - 0.06, y0, z - 0.06, u + 0.06, y0 + h, z + 0.06, 0.008, false);
  // side glass walls (framed) — local frames rotated to face ±u
  const side = (u, sgn) => {
    b.push(); b.translate(u, 0, 0); b.rotY(sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
    const a = sgn > 0 ? 0.05 : -depth + 0.06, c = sgn > 0 ? depth - 0.06 : -0.05;
    b.box(fk, a, y0, -0.03, c, y0 + 0.08, 0.03, 63);
    b.box(fk, a, y0 + h - 0.08, -0.03, c, y0 + h, 0.03, 63);
    b.quad(o.glassKey || 'glass_shop', a, y0 + 0.08, 0, c, y0 + 0.08, 0, c, y0 + h - 0.08, 0, a, y0 + h - 0.08, 0);
    b.quad(o.glassKey || 'glass_shop', c, y0 + 0.08, -0.001, a, y0 + 0.08, -0.001, a, y0 + h - 0.08, -0.001, c, y0 + h - 0.08, -0.001);
    b.pop();
  };
  side(u0, -1); side(u1, 1);
  // front: fixed side lights + glazed double door in the middle
  const dw = Math.min(1.8, W - 0.5), d0 = (u0 + u1) / 2 - dw / 2;
  b.push(); b.translate(0, 0, depth);
  for (const [a, c] of [[u0 + 0.06, d0], [d0 + dw, u1 - 0.06]]) if (c - a > 0.1) {
    b.box(fk, a, y0, -0.03, c, y0 + 0.1, 0.03, 63);
    b.quad(o.glassKey || 'glass_shop', a, y0 + 0.1, 0, c, y0 + 0.1, 0, c, y0 + h - 0.08, 0, a, y0 + h - 0.08, 0);
  }
  b.box(fk, u0, y0 + 2.3, -0.04, u1, y0 + 2.38, 0.04, 63);
  b.quad(o.glassKey || 'glass_shop', d0, y0 + 2.38, 0, d0 + dw, y0 + 2.38, 0, d0 + dw, y0 + h - 0.08, 0, d0, y0 + h - 0.08, 0);
  b.pop();
  // door leaves (closed, glazed) in the front plane
  b.push(); b.translate(0, 0, depth + 0.03);
  for (const [a, c] of [[d0, d0 + dw / 2 - 0.005], [d0 + dw / 2 + 0.005, d0 + dw]]) {
    b.box(fk, a, y0, -0.03, a + 0.07, y0 + 2.3, 0.03, 63); b.box(fk, c - 0.07, y0, -0.03, c, y0 + 2.3, 0.03, 63);
    b.box(fk, a + 0.07, y0, -0.03, c - 0.07, y0 + 0.2, 0.03, 63); b.box(fk, a + 0.07, y0 + 2.22, -0.03, c - 0.07, y0 + 2.3, 0.03, 63);
    b.quad(o.glassKey || 'glass_shop', a + 0.07, y0 + 0.2, 0, c - 0.07, y0 + 0.2, 0, c - 0.07, y0 + 2.22, 0, a + 0.07, y0 + 2.22, 0);
    b.tube('chrome', [[a < d0 + 0.1 ? c - 0.12 : a + 0.12, y0 + 0.8, 0.03], [a < d0 + 0.1 ? c - 0.12 : a + 0.12, y0 + 0.8, 0.09], [a < d0 + 0.1 ? c - 0.12 : a + 0.12, y0 + 1.5, 0.09], [a < d0 + 0.1 ? c - 0.12 : a + 0.12, y0 + 1.5, 0.03]], 0.015, 8);
  }
  b.pop();
  // roof slab with fascia + downlight
  b.cbox(o.roofKey || 'ceramic_band', u0 - 0.15, y0 + h, -0.05, u1 + 0.15, y0 + h + 0.22, depth + 0.2, 0.02);
  b.cylinder('light_warm', (u0 + u1) / 2, y0 + h - 0.005, depth * 0.5, 0.08, 0.005, 10, { top: false, bottom: true });
  if (b.collecting) { b.colBox(u0 - 0.06, y0, -0.05, u0 + 0.06, y0 + h, depth); b.colBox(u1 - 0.06, y0, -0.05, u1 + 0.06, y0 + h, depth); }
}

/** Fabric awning (wall frame): sloped panel with front valance, steel arms. */
export function awning(b, o) {
  const { u0, u1, y } = o, depth = o.depth ?? 1.4, drop = o.drop ?? 0.45, key = o.key || 'fabric_awning';
  b.quad(key, u0, y, 0.02, u1, y, 0.02, u1, y - drop, depth, u0, y - drop, depth);
  b.quad(key, u1, y, 0.02, u0, y, 0.02, u0, y - drop, depth, u1, y - drop, depth); // underside
  b.box(key, u0, y - drop - 0.22, depth - 0.01, u1, y - drop, depth + 0.01, PZ | NZ);
  b.tube('steel_dark', [[u0 + 0.05, y + 0.02, 0.03], [u1 - 0.05, y + 0.02, 0.03]], 0.03, 8);
  for (const u of [u0 + 0.1, u1 - 0.1]) b.tube('steel_dark', [[u, y - 0.6, 0.02], [u, y - drop - 0.02, depth - 0.02]], 0.014, 6);
}

/** Pergola: posts + beams + slats over a rect (current frame, y0 ground level). */
export function pergola(b, o) {
  const { x0, x1, z0, z1, y0 } = o, h = o.h ?? 2.6, key = o.key || 'aluminium', curved = !!o.curved;
  const posts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
  for (const [x, z] of posts) b.cbox(key, x - 0.06, y0, z - 0.06, x + 0.06, y0 + h, z + 0.06, 0.01, false);
  b.cbox(key, x0 - 0.15, y0 + h - 0.05, z0 - 0.08, x1 + 0.15, y0 + h + 0.12, z0 + 0.08, 0.01);
  b.cbox(key, x0 - 0.15, y0 + h - 0.05, z1 - 0.08, x1 + 0.15, y0 + h + 0.12, z1 + 0.08, 0.01);
  const n = Math.max(3, Math.round((x1 - x0) / 0.35));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    if (curved) {
      const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([x, y0 + h + 0.12 + Math.sin(t * Math.PI) * 0.35, z0 - 0.3 + (z1 - z0 + 0.6) * t]); }
      b.sweep(o.slatKey || 'wood', pts, [[-0.025, 0], [0.025, 0], [0.025, 0.09], [-0.025, 0.09]], { smoothAngle: 10 });
    } else b.box(o.slatKey || 'wood', x - 0.025, y0 + h + 0.12, z0 - 0.3, x + 0.025, y0 + h + 0.21, z1 + 0.3, PX | NX | PY | NY | PZ | NZ);
  }
}

/**
 * Ground-floor arcade / colonnade (檐廊 · 首层廊) in the WALL FRAME of the OUTER facade line: the
 * column line runs just inside z = 0, the recessed shopfront wall stands at z = −depth. Emits the
 * paved floor (top at y0, with a drainage channel grating along the open edge and colliders),
 * a suspended soffit at ySoffit with recessed downlights, a fascia from the soffit up to yTop (the
 * upper slab edge), columns (round ceramic with stone bases, or square) and downpipes with shoes
 * on every other column (落水口). Columns avoid the door ranges given in `doors`.
 * o: {u0=0, u1, depth, y0, ySoffit, yTop, spacing=6.4, r=0.24, shape:'round'|'square',
 *     colKey='ceramic_white', baseKey='stone_plinth', floorKey='paving_stone', soffitKey='render_white',
 *     fasciaKey='ceramic_band', colStart=true, colEnd=true, doors:[[u0,u1]...], lights=true, drains=true}
 * Returns the column u positions.
 */
export function arcade(b, o) {
  const u0 = o.u0 ?? 0, u1 = o.u1, A = o.depth, y0 = o.y0, ys = o.ySoffit, yt = o.yTop ?? ys + 0.4;
  const r = o.r ?? 0.24, zc = -(o.colZ ?? r + 0.06);
  const colKey = o.colKey || 'ceramic_white', sk = o.soffitKey || 'render_white';
  // ---- floor: paving top + drainage channel along the open edge ----
  b.rectY(o.floorKey || 'paving_stone', u0, -A, u1, -0.2, y0, 1);
  b.rectY(o.floorKey || 'paving_stone', u0, -0.06, u1, 0, y0, 1);
  if (o.drains !== false) {
    b.rectY('grille_dark', u0, -0.2, u1, -0.06, y0 - 0.012, 1);
    b.rectZ(o.floorKey || 'paving_stone', u0, y0 - 0.06, u1, y0, -0.2, 1);
    b.rectZ(o.floorKey || 'paving_stone', u0, y0 - 0.06, u1, y0, -0.06, -1);
    b.rectY('steel_dark', u0, -0.2, u1, -0.06, y0 - 0.06, 1);
  } else b.rectY(o.floorKey || 'paving_stone', u0, -0.2, u1, -0.06, y0, 1);
  if (b.collecting) b.colQuad(u0, y0, 0, u1, y0, 0, u1, y0, -A, u0, y0, -A);
  // ---- soffit + fascia ----
  b.rectY(sk, u0, -A, u1, 0, ys, -1);
  b.box(o.fasciaKey || 'ceramic_band', u0, ys - 0.02, -0.14, u1, yt, 0, PZ | NY);
  // ---- columns, spaced evenly, nudged off door openings ----
  const L = u1 - u0;
  const n = Math.max(1, Math.round(L / (o.spacing ?? 6.4)));
  const doors = o.doors || [];
  const cols = [];
  for (let i = 0; i <= n; i++) {
    if (i === 0 && o.colStart === false) continue;
    if (i === n && o.colEnd === false) continue;
    let u = u0 + (L * i) / n;
    if (i === 0) u = u0 + r + 0.08; else if (i === n) u = u1 - r - 0.08;
    for (const [a, c] of doors) if (u > a - r - 0.35 && u < c + r + 0.35) u = (u - a < c - u) ? a - r - 0.35 : c + r + 0.35;
    if (u < u0 + r || u > u1 - r) continue;
    if (cols.some((q) => Math.abs(q - u) < 2 * r + 0.6)) continue;
    cols.push(u);
  }
  cols.forEach((u, i) => {
    if (o.shape === 'square') b.cbox(colKey, u - r, y0, zc - r, u + r, ys, zc + r, 0.03, false);
    else {
      b.cylinder(colKey, u, y0, zc, r, ys - y0, 24, { top: false });
      b.lathe(o.baseKey || 'stone_plinth', [[r + 0.05, 0], [r + 0.05, 0.16], [r + 0.012, 0.2]], 24, { x: u, y: y0, z: zc });
      b.lathe(colKey, [[r, 0], [r + 0.06, 0.1], [r + 0.06, 0.14]], 24, { x: u, y: ys - 0.14, z: zc, capTop: false });
    }
    if (b.collecting) b.colBox(u - r, y0, zc - r, u + r, ys, zc + r);
    // downpipe on the inner face of every other column, shoe into the channel
    if (o.drains !== false && i % 2 === 1) {
      const zp = zc - r - 0.07;
      b.cylinder('steel_dark', u, y0 + 0.16, zp, 0.05, ys - y0 - 0.16, 10, { top: false, bottom: false });
      b.tube('steel_dark', [[u, y0 + 0.2, zp], [u, y0 + 0.07, zp], [u, y0 + 0.03, zp + 0.08], [u, y0 + 0.03, -0.12]], 0.05, 10);
      for (const yy of [y0 + 1.0, ys - 0.6]) b.box('steel_dark', u - 0.06, yy, zp - 0.06, u + 0.06, yy + 0.04, zc - r + 0.01, PX | NX | PY | NY | NZ);
    }
  });
  // ---- recessed downlights between the columns ----
  if (o.lights !== false) {
    const m = Math.max(1, Math.round(L / 2.6));
    for (let i = 0; i < m; i++) {
      const u = u0 + (L * (i + 0.5)) / m;
      b.cylinder('light_warm', u, ys - 0.006, -A * 0.5, 0.075, 0.006, 14, { top: false, bottom: true });
    }
  }
  return cols;
}

/** Rounded rectangular slab (podium edge, island) between y0..y1 */
export function roundedSlab(b, key, x0, z0, x1, z1, r, y0, y1) {
  b.prism(key, roundedRect(x0, z0, x1, z1, r), y0, y1, { top: true, bottom: false });
}

export { PX, NX, PY, NY, PZ, NZ };
