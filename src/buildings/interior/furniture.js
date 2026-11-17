// Interior furniture and fixtures — simple but correctly sized (metres). Every function draws
// in the builder's current frame with the item standing on y=0, its BACK against z=0 and its
// front facing +z, centred on x=0 unless noted. Callers translate/rotate into place.

import { ALL, NY, PY, PX, NX, PZ, NZ } from '../kit/MeshBuilder.js';
import { leafCluster } from '../kit/vegetation.js';

const FAB = [[0.42, 0.45, 0.48], [0.55, 0.5, 0.42], [0.32, 0.38, 0.45], [0.6, 0.58, 0.55], [0.45, 0.35, 0.3], [0.3, 0.42, 0.38]];

/** 3-seat sofa 2.1 × 0.9. */
export function sofa(b, seed = 0, w = 2.1) {
  const c = FAB[seed % FAB.length];
  b.withTint(c, () => {
    b.cbox('fabric', -w / 2, 0.1, 0.0, w / 2, 0.42, 0.9, 0.05, false);      // base
    b.cbox('fabric', -w / 2 + 0.02, 0.42, 0.0, w / 2 - 0.02, 0.86, 0.24, 0.07, false);   // back (rounded top)
    b.cbox('fabric', -w / 2, 0.42, 0.18, -w / 2 + 0.2, 0.66, 0.9, 0.07, false);         // padded arms
    b.cbox('fabric', w / 2 - 0.2, 0.42, 0.18, w / 2, 0.66, 0.9, 0.07, false);
    const n = w > 1.6 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = -w / 2 + 0.2 + ((w - 0.4) * i) / n, e = -w / 2 + 0.2 + ((w - 0.4) * (i + 1)) / n;
      b.cbox('fabric', a + 0.01, 0.42, 0.24, e - 0.01, 0.58, 0.89, 0.06);                  // seat cushions
      b.cbox('fabric', a + 0.03, 0.56, 0.2, e - 0.03, 0.84, 0.36, 0.07);                   // back cushions
    }
  });
  // a throw pillow or two in a contrasting tone
  b.withTint(FAB[(seed + 3) % FAB.length].map((v) => Math.min(1, v * 1.35)), () => { b.push(); b.translate(-w / 2 + 0.42, 0.58, 0.42); b.rotY(0.35); b.cbox('fabric', -0.2, 0, -0.07, 0.2, 0.36, 0.07, 0.05); b.pop(); if (seed % 2) { b.push(); b.translate(w / 2 - 0.4, 0.58, 0.42); b.rotY(-0.3); b.cbox('fabric', -0.2, 0, -0.07, 0.2, 0.36, 0.07, 0.05); b.pop(); } });
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) for (const z of [0.08, 0.82]) b.box('wood', x - 0.025, 0, z - 0.025, x + 0.025, 0.1, z + 0.025, PX | NX | PZ | NZ);
  if (b.collecting) b.colBox(-w / 2, 0, 0, w / 2, 0.85, 0.9);
}

export function coffeeTable(b) {
  b.cbox('wood', -0.55, 0.38, -0.3, 0.55, 0.42, 0.3, 0.01);
  for (const x of [-0.5, 0.5]) for (const z of [-0.25, 0.25]) b.box('steel_dark', x - 0.015, 0, z - 0.015, x + 0.015, 0.38, z + 0.015, ALL & ~NY);
}

export function rug(b, w = 2.0, d = 1.4, seed = 0) {
  b.withTint(FAB[(seed + 2) % FAB.length].map((v) => v * 1.2), () => b.box('fabric', -w / 2, 0.002, -d / 2, w / 2, 0.012, d / 2, ALL & ~NY));
}

export function tvUnit(b, w = 1.8) {
  b.cbox('wood', -w / 2, 0.0, 0.0, w / 2, 0.48, 0.4, 0.01, false);
  b.cbox('black', -0.7, 0.6, 0.05, 0.7, 1.4, 0.09, 0.006);
  b.box('steel_dark', -0.1, 0.48, 0.12, 0.1, 0.6, 0.2, ALL);
}

export function diningSet(b, seed = 0) {
  b.cbox('wood', -0.8, 0.72, -0.45, 0.8, 0.76, 0.45, 0.01);
  for (const x of [-0.72, 0.72]) for (const z of [-0.38, 0.38]) b.box('wood', x - 0.03, 0, z - 0.03, x + 0.03, 0.72, z + 0.03, ALL & ~NY);
  for (const [x, z, r] of [[-0.4, -0.65, 0], [0.4, -0.65, 0], [-0.4, 0.65, Math.PI], [0.4, 0.65, Math.PI]]) { b.push(); b.translate(x, 0, z); b.rotY(r); chair(b, seed); b.pop(); }
  if (b.collecting) b.colBox(-0.8, 0, -0.45, 0.8, 0.76, 0.45);
}

export function chair(b, seed = 0) {
  b.withTint(FAB[(seed + 1) % FAB.length], () => b.box('fabric', -0.22, 0.43, -0.22, 0.22, 0.48, 0.22, ALL));
  b.box('wood', -0.22, 0.48, -0.24, 0.22, 0.9, -0.2, ALL & ~NY);
  for (const x of [-0.19, 0.19]) for (const z of [-0.19, 0.19]) b.box('steel_dark', x - 0.012, 0, z - 0.012, x + 0.012, 0.43, z + 0.012, PX | NX | PZ | NZ);
}

/** Double (w=1.6) or single (0.9) bed, headboard at z=0. */
export function bed(b, w = 1.6, seed = 0) {
  b.cbox('wood', -w / 2 - 0.04, 0.0, 0.0, w / 2 + 0.04, 0.3, 2.08, 0.015, false);
  b.cbox('wood', -w / 2 - 0.05, 0.0, 0.0, w / 2 + 0.05, 1.05, 0.06, 0.012, false);
  b.withTint([0.92, 0.92, 0.9], () => b.cbox('fabric', -w / 2, 0.3, 0.06, w / 2, 0.52, 2.04, 0.05));
  b.withTint(FAB[seed % FAB.length], () => b.cbox('fabric', -w / 2 - 0.01, 0.42, 0.9, w / 2 + 0.01, 0.56, 2.06, 0.05));
  const np = w > 1.2 ? 2 : 1;
  for (let i = 0; i < np; i++) { const cx = np === 1 ? 0 : (i ? 1 : -1) * w * 0.24; b.withTint([0.95, 0.95, 0.93], () => b.cbox('fabric', cx - 0.3, 0.52, 0.12, cx + 0.3, 0.66, 0.5, 0.05)); }
  if (b.collecting) b.colBox(-w / 2, 0, 0, w / 2, 0.56, 2.08);
}

export function bedside(b) {
  b.cbox('wood', -0.22, 0.0, 0.0, 0.22, 0.5, 0.4, 0.01, false);
  b.lathe('fabric', [[0.12, 0.62], [0.09, 0.82]], 12, { capTop: true });
  b.cylinder('steel_dark', 0, 0.5, 0.2, 0.06, 0.12, 10, { top: true });
}

export function wardrobe(b, w = 1.8, h = 2.2) {
  b.cbox('wood', -w / 2, 0.0, 0.0, w / 2, h, 0.6, 0.01, false);
  const n = Math.max(2, Math.round(w / 0.6));
  for (let i = 1; i < n; i++) { const x = -w / 2 + (w * i) / n; b.box('black', x - 0.003, 0.05, 0.6, x + 0.003, h - 0.05, 0.602, PZ); }
  for (let i = 0; i < n; i++) { const x = -w / 2 + (w * (i + 0.5)) / n + 0.2; b.box('chrome', x - 0.006, 1.0, 0.6, x + 0.006, 1.3, 0.625, ALL); }
  if (b.collecting) b.colBox(-w / 2, 0, 0, w / 2, h, 0.6);
}

/**
 * Desk + chair; what stands on it varies with the seed (monitor / laptop + lamp / books + plant /
 * bare) so a row of bedroom or study windows does not repeat one desk-and-monitor picture.
 */
export function desk(b, w = 1.2, seed = 0, o = {}) {
  b.cbox('wood', -w / 2, 0.72, 0.0, w / 2, 0.75, 0.6, 0.008);
  b.cbox('wood', -w / 2, 0.0, 0.02, -w / 2 + 0.03, 0.72, 0.58, 0.004, false);
  b.cbox('wood', w / 2 - 0.03, 0.0, 0.02, w / 2, 0.72, 0.58, 0.004, false);
  if ((seed >> 2) % 2) b.cbox('cabinet', w / 2 - 0.45, 0.05, 0.04, w / 2 - 0.04, 0.7, 0.56, 0.006, false);   // drawer pedestal
  const top = o.top ?? ['monitor', 'laptop', 'books', 'bare'][((seed * 7) >>> 0) % 4];
  if (top === 'monitor') { b.cbox('black', -0.3, 0.82, 0.1, 0.3, 1.16, 0.125, 0.004); b.box('steel_dark', -0.03, 0.75, 0.1, 0.03, 0.82, 0.16, ALL); b.box('steel_dark', -0.12, 0.75, 0.06, 0.12, 0.758, 0.22, ALL & ~NY); }
  else if (top === 'laptop') { b.push(); b.translate((seed % 3 - 1) * 0.15, 0.75, 0.25); b.box('aluminium', -0.17, 0, -0.12, 0.17, 0.015, 0.12, ALL & ~NY); b.push(); b.translate(0, 0.015, -0.12); b.rotX(-0.35); b.box('aluminium', -0.17, 0, -0.008, 0.17, 0.23, 0.0, ALL); b.pop(); b.pop(); deskLamp(b, -w / 2 + 0.18, 0.75, 0.15); }
  else if (top === 'books') { for (let k = 0; k < 3; k++) b.withTint(FAB[(seed + k) % FAB.length].map((v) => v * 1.3), () => b.cbox('fabric', -w / 2 + 0.12, 0.75 + k * 0.035, 0.12 + k * 0.01, -w / 2 + 0.38 - k * 0.02, 0.783 + k * 0.035, 0.32, 0.003)); deskLamp(b, w / 2 - 0.2, 0.75, 0.12); }
  b.push(); b.translate(0, 0, 0.85); b.rotY(Math.PI); chair(b, seed); b.pop();
}

/** Small desk lamp (base + arm + shade) at x, y (desk top), z. */
export function deskLamp(b, x, y, z) {
  b.cylinder('steel_dark', x, y, z, 0.07, 0.015, 10, { top: true });
  b.tube('steel_dark', [[x, y + 0.015, z], [x, y + 0.3, z + 0.05], [x + 0.06, y + 0.38, z + 0.12]], 0.008, 6);
  b.lathe('steel_dark', [[0.06, 0], [0.03, 0.09]], 10, { x: x + 0.06, y: y + 0.3, z: z + 0.12 });
}

/** Chest of drawers with a mirror above (bedroom window-wall alternative to a desk). Back at z=0. */
export function dresser(b, w = 1.0, seed = 0) {
  b.cbox('wood', -w / 2, 0.08, 0.0, w / 2, 0.82, 0.45, 0.008, false);
  for (let k = 1; k < 3; k++) b.box('black', -w / 2 + 0.03, 0.08 + k * 0.245 - 0.002, 0.45, w / 2 - 0.03, 0.08 + k * 0.245 + 0.002, 0.452, PZ);
  for (let k = 0; k < 3; k++) b.box('chrome', -0.08, 0.2 + k * 0.245, 0.45, 0.08, 0.215 + k * 0.245, 0.47, ALL);
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) b.box('steel_dark', x - 0.02, 0, 0.05, x + 0.02, 0.08, 0.09, PX | NX | PZ | NZ);
  if (seed % 3) b.cbox('mirror', -w * 0.35, 1.05, 0.0, w * 0.35, 1.75, 0.02, 0.004);
  else plantPot(b, w / 2 - 0.2, 0.25, 0.5, seed);
  if (b.collecting) b.colBox(-w / 2, 0, 0, w / 2, 0.82, 0.45);
}

/** Shelf unit 0.9 × 0.35 × 1.9 with book rows (a few tinted blocks per shelf). */
export function shelves(b, w = 0.9, h = 1.9, seed = 0) {
  const d = 0.35;
  b.box('wood', -w / 2, 0, 0, -w / 2 + 0.025, h, d, ALL & ~NY);
  b.box('wood', w / 2 - 0.025, 0, 0, w / 2, h, d, ALL & ~NY);
  b.box('wood', -w / 2, 0, 0, w / 2, h, 0.01, PZ);
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const y = (h * i) / n;
    b.box('wood', -w / 2 + 0.025, y, 0.01, w / 2 - 0.025, y + 0.025, d, PY | NY | PZ);
    if (i < n) {
      // individual books (varying height, thickness, colour, a few leaning), gaps, the odd object
      let x = -w / 2 + 0.035, k = 0;
      const hs = ((seed * 13 + i * 29) >>> 0);
      const end = w / 2 - 0.035 - (hs % 3 === 0 ? 0.22 : 0.02);
      while (x < end - 0.02) {
        const hk = (hs + k * 7919) >>> 0;
        const bt = 0.018 + (hk % 5) * 0.008, bh = Math.min(h / n - 0.04, 0.16 + ((hk >> 3) % 6) * 0.018);
        if ((hk >> 6) % 9 === 0) { x += 0.06; k++; continue; }                        // gap
        const col = FAB[(hk >> 4) % FAB.length].map((v, ci) => Math.min(1, v * (1.05 + ((hk >> (8 + ci)) % 4) * 0.12)));
        b.withTint(col, () => b.box('fabric', x, y + 0.025, 0.05, Math.min(end, x + bt), y + 0.025 + bh, d - 0.03 - ((hk >> 5) % 3) * 0.01, PZ | PY | PX | NX));
        x += bt + 0.002; k++;
      }
      if (hs % 3 === 0) b.withTint([0.85, 0.82, 0.76], () => b.cbox('porcelain', end + 0.05, y + 0.025, 0.1, end + 0.17, y + 0.025 + 0.14, 0.22, 0.02));   // vase / box
    }
  }
  if (b.collecting) b.colBox(-w / 2, 0, 0, w / 2, h, d);
}

/**
 * Kitchen run along x from 0..L: base cabinets, worktop, sink, hob, wall cabinets, hood,
 * optional tall fridge at the end. Back at z=0.
 */
export function kitchenRun(b, L, o = {}) {
  const fridge = o.fridge !== false && L > 2.0;
  const Lb = fridge ? L - 0.65 : L;
  b.cbox('cabinet', 0, 0.1, 0.0, Lb, 0.88, 0.58, 0.006, false);
  b.box('black', 0.02, 0.0, 0.02, Lb - 0.02, 0.1, 0.52, PZ | PX | NX);
  const n = Math.max(1, Math.round(Lb / 0.6));
  for (let i = 1; i < n; i++) { const x = (Lb * i) / n; b.box('black', x - 0.002, 0.12, 0.58, x + 0.002, 0.86, 0.582, PZ); }
  for (let i = 0; i < n; i++) b.box('chrome', (Lb * (i + 0.5)) / n - 0.08, 0.78, 0.58, (Lb * (i + 0.5)) / n + 0.08, 0.795, 0.6, ALL);
  b.cbox('counter', -0.005, 0.88, 0.0, Lb + 0.005, 0.92, 0.62, 0.004);
  // sink (recess) + tap
  const sx = o.sinkAt ?? Math.min(Lb - 0.45, Math.max(0.45, Lb * 0.3));
  b.box('steel_brushed', sx - 0.3, 0.921, 0.12, sx + 0.3, 0.923, 0.5, PY);
  b.box('steel_dark', sx - 0.26, 0.922, 0.15, sx + 0.26, 0.924, 0.47, PY);
  b.tube('chrome', [[sx, 0.92, 0.06], [sx, 1.2, 0.06], [sx, 1.22, 0.2]], 0.012, 8);
  // hob
  const hx = Math.min(Lb - 0.35, Math.max(0.35, Lb * 0.75));
  b.box('black', hx - 0.3, 0.921, 0.08, hx + 0.3, 0.927, 0.55, PY | PZ | PX | NX);
  // wall cabinets + hood
  b.cbox('cabinet', 0, 1.45, 0.0, Lb, 2.15, 0.35, 0.006);
  b.cbox('steel_brushed', hx - 0.3, 1.3, 0.0, hx + 0.3, 1.45, 0.45, 0.006);
  // splashback tiles
  b.rectZ('tile_wall', 0, 0.92, Lb, 1.45, 0.003, 1);
  if (fridge) {
    b.cbox('steel_brushed', L - 0.63, 0.0, 0.0, L, 1.85, 0.65, 0.01, false);
    b.box('black', L - 0.63, 1.2, 0.65, L, 1.204, 0.652, PZ);
    b.box('chrome', L - 0.6, 0.9, 0.65, L - 0.58, 1.5, 0.68, ALL);
  }
  if (b.collecting) b.colBox(0, 0, 0, L, 0.92, 0.62);
}

/** WC: back at z=0. */
export function toilet(b) {
  b.cbox('porcelain', -0.19, 0.4, 0.0, 0.19, 0.8, 0.18, 0.03);
  b.lathe('porcelain', [[0.12, 0], [0.16, 0.15], [0.19, 0.38], [0.18, 0.4]], 14, { z: 0.45, capTop: true });
  b.cbox('porcelain', -0.19, 0.4, 0.15, 0.19, 0.43, 0.7, 0.03);
}

/** Basin on a vanity + mirror. */
export function vanity(b, w = 0.8) {
  b.cbox('cabinet', -w / 2, 0.15, 0.0, w / 2, 0.82, 0.48, 0.008, false);
  b.cbox('porcelain', -w / 2 - 0.01, 0.82, 0.0, w / 2 + 0.01, 0.86, 0.5, 0.01);
  b.box('porcelain', -0.22, 0.861, 0.12, 0.22, 0.862, 0.42, PY);
  b.tube('chrome', [[0, 0.86, 0.05], [0, 1.0, 0.05], [0, 1.02, 0.14]], 0.01, 8);
  b.cbox('mirror', -w / 2 + 0.05, 1.1, 0.0, w / 2 - 0.05, 1.85, 0.02, 0.004);
  b.box('light_panel', -w / 2 + 0.1, 1.88, 0.0, w / 2 - 0.1, 1.92, 0.05, ALL);
}

/** Shower tray with glass screen, in a corner: tray from x 0..s, z 0..s. */
export function shower(b, s = 0.9) {
  b.cbox('porcelain', 0, 0, 0, s, 0.05, s, 0.01, false);
  b.clearExtra('iwin0'); b.clearExtra('iwin1'); b.clearExtra('iwin2');   // indoor glass: no street reflection
  b.box('glass_clear', s - 0.005, 0.05, 0.02, s + 0.005, 2.0, s, PX | NX);
  b.box('glass_clear', 0.02, 0.05, s - 0.005, s * 0.55, 2.0, s + 0.005, PZ | NZ);
  b.tube('chrome', [[0.1, 1.0, 0.04], [0.1, 2.0, 0.04], [0.3, 2.05, 0.04]], 0.012, 8);
  b.cylinder('chrome', 0.32, 1.98, 0.04, 0.09, 0.02, 12, { top: true, bottom: true });
}

export function bathtub(b, L = 1.7) {
  b.cbox('porcelain', 0, 0, 0, L, 0.55, 0.75, 0.04, false);
  b.box('porcelain', 0.08, 0.2, 0.08, L - 0.08, 0.551, 0.67, PY);
}

export function plantPot(b, x, z, h = 0.9, seed = 0) {
  b.lathe('ceramic_grey', [[0.13, 0], [0.19, 0.34], [0.205, 0.36], [0.2, 0.4]], 16, { x, z, capBottom: false });
  b.lathe('ceramic_grey', [[0.185, 0.38], [0.17, 0.12]], 16, { x, z });          // inner wall of the rim
  b.rectY('soil', x - 0.12, z - 0.12, x + 0.12, z + 0.12, 0.36, 1);
  const tint = [[0.24, 0.42, 0.16], [0.2, 0.38, 0.18], [0.28, 0.44, 0.14]][seed % 3];
  const n = 3 + (seed % 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * 0.7, rr = 0.06 + (i % 2) * 0.04;
    const tx = x + Math.cos(a) * rr * 2.2, tz = z + Math.sin(a) * rr * 2.2, ty = 0.4 + h * (0.45 + 0.12 * (i % 3));
    b.tube('bark', [[x + Math.cos(a) * 0.03, 0.36, z + Math.sin(a) * 0.03], [tx, ty, tz]], 0.008, 5);
    leafCluster(b, tx, ty + h * 0.08, tz, h * (0.17 + 0.04 * (i % 2)), (seed * 7 + i) >>> 0, tint, 9, 0.9);
  }
  leafCluster(b, x, 0.4 + h * 0.72, z, h * 0.22, (seed + 11) >>> 0, tint, 10, 0.85);
}

export function floorLamp(b) {
  b.cylinder('steel_dark', 0, 0, 0, 0.14, 0.02, 12, { top: true });
  b.cylinder('steel_dark', 0, 0.02, 0, 0.012, 1.45, 6, { top: false });
  b.lathe('fabric', [[0.2, 1.45], [0.14, 1.7]], 14, {});
}

/** Shop shelving gondola (two-sided) along x. */
export function gondola(b, L = 2.4) {
  b.cbox('steel_brushed', 0, 0, -0.4, L, 0.1, 0.4, 0.01, false);
  b.box('steel_brushed', 0, 0.1, -0.02, L, 1.6, 0.02, ALL);
  for (const y of [0.4, 0.75, 1.1, 1.45]) {
    for (const s of [-1, 1]) {
      b.box('steel_brushed', 0, y, s > 0 ? 0.02 : -0.38, L, y + 0.02, s > 0 ? 0.38 : -0.02, ALL);
      let x = 0.05, k = 0;
      while (x < L - 0.1) { const w = 0.12 + ((k * 7 + Math.round(y * 10)) % 4) * 0.04; b.withTint(FAB[(k + Math.round(y * 10)) % FAB.length].map((v) => v * 1.4), () => b.box('fabric', x, y + 0.02, s > 0 ? 0.05 : -0.33, x + w - 0.01, y + 0.2 + (k % 3) * 0.04, s > 0 ? 0.33 : -0.05, ALL & ~NY)); x += w; k++; }
    }
  }
  if (b.collecting) b.colBox(0, 0, -0.4, L, 1.6, 0.4);
}

export function counter(b, L = 2.0) {
  b.cbox('wood', 0, 0, 0, L, 1.0, 0.6, 0.01, false);
  b.cbox('counter', -0.02, 1.0, -0.02, L + 0.02, 1.04, 0.64, 0.005);
  b.cbox('black', L * 0.6, 1.04, 0.2, L * 0.6 + 0.35, 1.3, 0.24, 0.005);
  if (b.collecting) b.colBox(0, 0, 0, L, 1.04, 0.6);
}

export function officeDesk(b, seed = 0) { desk(b, 1.4, seed); }

/** Reception / information desk (public lobbies): curved front, worktop, monitor, low back counter. Back at z=0. */
export function receptionDesk(b, w = 1.8) {
  b.cbox('wood', -w / 2, 0, 0.05, w / 2, 1.05, 0.65, 0.02, false);                        // front body
  b.cbox('counter', -w / 2 - 0.03, 1.05, 0.0, w / 2 + 0.03, 1.09, 0.72, 0.01);            // transaction top
  b.cbox('counter', -w / 2 + 0.05, 0.74, -0.45, w / 2 - 0.05, 0.77, 0.05, 0.008);         // work surface behind
  b.box('steel_dark', -0.3, 0.77, -0.3, -0.26, 1.0, -0.26, ALL);
  b.cbox('black', -0.55, 0.95, -0.32, -0.02, 1.27, -0.29, 0.004);                          // monitor
  b.withTint([0.32, 0.38, 0.45], () => b.cbox('fabric', 0.15, 0.45, -0.9, 0.6, 0.5, -0.45, 0.04));   // chair seat
  if (b.collecting) b.colBox(-w / 2, 0, 0, w / 2, 1.09, 0.72);
}

/** Lobby bench + notice board (blank). */
export function lobbyBench(b) {
  b.cbox('wood', -0.8, 0.42, 0.0, 0.8, 0.47, 0.42, 0.01);
  for (const x of [-0.7, 0.7]) b.cbox('steel_dark', x - 0.03, 0, 0.03, x + 0.03, 0.42, 0.39, 0.005, false);
}
