// Site and back-of-house furniture: bin store, bicycle racks / shelter, mailbox wall (信报区),
// bollards, entrance mats, paving pads. Frames as documented per function.

import { PX, NX, PY, NY, PZ, NZ, ALL } from './MeshBuilder.js';
import { bench } from './roof.js';

/**
 * Bin store enclosure (current frame): footprint x0..x1 × z0..z1 at ground y, open towards +z
 * (louvred double gates), roof slab, wheelie bins inside (colour-coded for sorting).
 */
export function binStore(b, x0, z0, x1, z1, y, o = {}) {
  const h = o.h ?? 1.6, k = o.key || 'aluminium', wk = o.wallKey || 'ceramic_grey';
  // pad
  b.cbox('concrete', x0 - 0.3, y - 0.3, z0 - 0.3, x1 + 0.3, y + 0.06, z1 + 0.6, 0.01, false);
  // back + sides (solid)
  b.cbox(wk, x0, y + 0.06, z0, x1, y + h, z0 + 0.12, 0.01, false);
  b.cbox(wk, x0, y + 0.06, z0 + 0.12, x0 + 0.12, y + h, z1, 0.01, false);
  b.cbox(wk, x1 - 0.12, y + 0.06, z0 + 0.12, x1, y + h, z1, 0.01, false);
  // roof
  b.cbox(o.roofKey || 'ceramic_band', x0 - 0.1, y + h, z0 - 0.1, x1 + 0.1, y + h + 0.12, z1 + 0.2, 0.02);
  // louvred gates (two, slightly ajar)
  const gw = (x1 - x0 - 0.24) / 2;
  for (let i = 0; i < 2; i++) {
    const gx = x0 + 0.12 + i * gw;
    b.push(); b.translate(i === 0 ? gx : gx + gw, y + 0.1, z1 - 0.03); b.rotY(i === 0 ? 0.15 : -0.15);
    const a = i === 0 ? 0 : -gw, c = i === 0 ? gw : 0;
    b.box(k, a, 0, -0.025, a + 0.04, h - 0.2, 0.0, ALL); b.box(k, c - 0.04, 0, -0.025, c, h - 0.2, 0.0, ALL);
    for (let yy = 0.05; yy < h - 0.25; yy += 0.1) b.box(k, a + 0.04, yy, -0.02, c - 0.04, yy + 0.06, -0.005, PZ | NZ | PY | NY);
    b.pop();
  }
  // bins
  const cols = [[0.25, 0.32, 0.27], [0.18, 0.28, 0.48], [0.5, 0.42, 0.12], [0.35, 0.35, 0.36]];
  const n = Math.max(1, Math.floor((x1 - x0 - 0.3) / 0.75));
  for (let i = 0; i < n; i++) {
    const cx = x0 + 0.2 + 0.375 + i * 0.75;
    b.withTint(cols[i % cols.length], () => {
      b.cbox('plastic_bin', cx - 0.3, y + 0.08, z0 + 0.25, cx + 0.3, y + 1.02, z0 + 0.95, 0.03, false);
      b.cbox('plastic_bin', cx - 0.32, y + 1.02, z0 + 0.22, cx + 0.32, y + 1.08, z0 + 0.98, 0.015);
    });
    for (const s of [-0.22, 0.22]) b.cylinder('rubber', cx + s, y + 0.08, z0 + 0.3, 0.09, 0.05, 10, { top: true });
  }
  if (b.collecting) b.colBox(x0, y, z0, x1, y + h, z1);
}

/** Sheffield bike stands in a row along x from x0, n stands at spacing, ground y, at z. */
export function bikeRacks(b, x0, z, y, n = 4, o = {}) {
  const sp = o.spacing ?? 0.9, k = o.key || 'steel_brushed';
  for (let i = 0; i < n; i++) {
    const x = x0 + i * sp;
    const path = [[x, y - 0.05, z - 0.35], [x, y + 0.62, z - 0.35], [x, y + 0.78, z - 0.2], [x, y + 0.78, z + 0.2], [x, y + 0.62, z + 0.35], [x, y - 0.05, z + 0.35]];
    b.tube(k, path, 0.025, 8);
  }
}

/** Bike shelter: canopy on posts with racks (Z03), current frame, rect, ground y. */
export function bikeShelter(b, x0, z0, x1, z1, y, o = {}) {
  const h = o.h ?? 2.3;
  for (const x of [x0 + 0.1, x1 - 0.1]) b.cbox('steel_dark', x - 0.05, y, z0 + 0.1, x + 0.05, y + h, z0 + 0.2, 0.008, false);
  // curved glass roof
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([x0 + (x1 - x0) * t, y + h + Math.sin(t * Math.PI) * 0.2, z0]); }
  b.sweep('glass_frosted', pts, [[0, -0.012], [z1 - z0 + 0.3, -0.012], [z1 - z0 + 0.3, 0.012], [0, 0.012]].map((p) => [p[0], p[1]]), { smoothAngle: 30, closedProfile: true });
  b.sweep('aluminium', pts, [[0, -0.06], [0.08, -0.06], [0.08, 0.0], [0, 0.0]], { smoothAngle: 30 });
  b.sweep('aluminium', pts.map((p) => [p[0], p[1], p[2] + z1 - z0 + 0.22]), [[0, -0.06], [0.08, -0.06], [0.08, 0.0], [0, 0.0]], { smoothAngle: 30 });
  const n = Math.max(2, Math.floor((x1 - x0 - 0.4) / 0.85));
  bikeRacks(b, x0 + 0.4, (z0 + z1) / 2 + 0.2, y, n);
}

/**
 * Mailbox wall (信报区) in the WALL FRAME of an interior wall: grid of lockable boxes centred
 * at u, bottom at y, protruding into +z. units: total boxes; cols x rows.
 */
export function mailboxWall(b, u, y, o = {}) {
  const cols = o.cols ?? 6, rows = o.rows ?? 5, bw = 0.3, bh = 0.24, depth = 0.32;
  const W = cols * bw, H = rows * bh;
  const u0 = u - W / 2;
  b.cbox('aluminium_dark', u0 - 0.04, y - 0.04, 0, u0 + W + 0.04, y + H + 0.04, depth, 0.01);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = u0 + i * bw + 0.012, c = u0 + (i + 1) * bw - 0.012, lo = y + j * bh + 0.012, hi = y + (j + 1) * bh - 0.012;
    b.cbox('steel_brushed', a, lo, depth, c, hi, depth + 0.012, 0.003);
    b.box('aluminium_dark', a + 0.03, hi - 0.06, depth + 0.012, c - 0.03, hi - 0.045, depth + 0.016, PZ | PY | NY); // letter slot
    b.cylinder('chrome', c - 0.04, (lo + hi) / 2, depth + 0.012, 0.01, 0.0, 6, { top: false });
    b.box('chrome', c - 0.05, (lo + hi) / 2 - 0.01, depth + 0.012, c - 0.03, (lo + hi) / 2 + 0.01, depth + 0.02, ALL);
  }
  // parcel lockers below
  if (o.parcel !== false) {
    b.cbox('aluminium_dark', u0, y - 0.95, 0, u0 + W, y - 0.08, depth, 0.01);
    for (let i = 0; i < Math.max(1, Math.floor(cols / 2)); i++) b.cbox('steel_brushed', u0 + i * bw * 2 + 0.015, y - 0.92, depth, u0 + (i + 1) * bw * 2 - 0.015, y - 0.11, depth + 0.012, 0.003);
  }
  if (b.collecting) b.colBox(u0, 0, 0, u0 + W, y + H, depth);
}

/** Bollard light (current frame). */
export function bollard(b, x, y, z, o = {}) {
  b.lathe('aluminium_dark', [[0.09, 0], [0.09, 0.75], [0.07, 0.8], [0.0, 0.82]], 12, { x, y, z, capTop: false });
  b.lathe('light_warm', [[0.0905, 0.6], [0.0905, 0.7]], 12, { x, y, z });
}

/** Paving pad (current frame) — slightly raised hardstanding with chamfered kerb. */
export function pavingPad(b, x0, z0, x1, z1, y, o = {}) {
  b.cbox(o.key || 'paving', x0, y - 0.25, z0, x1, y + 0.04, z1, 0.015, false);
  if (b.collecting) b.colQuad(x0, y + 0.04, z1, x1, y + 0.04, z1, x1, y + 0.04, z0, x0, y + 0.04, z0);
}

export { bench };
