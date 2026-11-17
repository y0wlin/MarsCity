// Harbour-office display atlas (港务工作间, §5 09 S09c): procedural, deterministic console screen pages —
// radar PPI, ECDIS harbour charts, AIS target list, tide / wave graphs, lock & gate status board, CCTV quad,
// weather dials, systems tiles, berth schedule, comms panel — and one paper nautical chart for the chart desk.
// OWNER: megastructure agent. Worker-safe (no DOM / canvas, no fonts: "text" is drawn as glyph-like blocks), so
// the same pixels come out on every machine. Generated in a mega worker ('texture' job, name 'mega_screens').
//
// Layout: SCREEN_COLS × SCREEN_ROWS pages of PAGE_W × PAGE_H px, page p at column p % COLS, row floor(p / COLS),
// row 0 at the TOP of the image. screenUV(p) → [u0, v0, u1, v1] (v up, DataTexture flipY = false).
import { hash4, Rng } from '../core/hash.js';

export const PAGE_W = 512, PAGE_H = 288, SCREEN_COLS = 4, SCREEN_ROWS = 4;
export const ATLAS_W = PAGE_W * SCREEN_COLS, ATLAS_H = PAGE_H * SCREEN_ROWS;
export const PAGE = {
  RADAR: 0, ECDIS: 1, AIS: 2, TIDE: 3, LOCKS: 4, CCTV: 5, WEATHER: 6, SYSTEMS: 7,
  ECDIS_MOUTH: 8, RADAR_LONG: 9, BERTHS: 10, COMMS: 11, PAPER_CHART: 12, PAPER_LOG: 13,
};
/** atlas uv rectangle of a page (small inset against mip bleeding) */
export function screenUV(p) {
  const col = p % SCREEN_COLS, row = Math.floor(p / SCREEN_COLS);
  const iu = 1.5 / ATLAS_W, iv = 1.5 / ATLAS_H;
  return [col / SCREEN_COLS + iu, 1 - (row + 1) / SCREEN_ROWS + iv, (col + 1) / SCREEN_COLS - iu, 1 - row / SCREEN_ROWS - iv];
}

/** G01 lock outer-gate rule (same hash as megastructures/g01.js lockState) */
function lockOuterOpen(i) { return (hash4(0x6011, i, 7, 0) & 3) === 0; }

class Page {
  constructor(buf, p) {
    this.buf = buf; this.x0 = (p % SCREEN_COLS) * PAGE_W; this.y0 = Math.floor(p / SCREEN_COLS) * PAGE_H;
    this.rng = new Rng(hash4(0x5c4e, p, 11, 0));
  }
  /** alpha-blend a pixel (page coords, y down); colours 0..255 */
  px(x, y, c, a = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= PAGE_W || y >= PAGE_H || a <= 0) return;
    const gx = this.x0 + x, gy = this.y0 + y;
    const o = ((ATLAS_H - 1 - gy) * ATLAS_W + gx) * 4;      // data row 0 = bottom (v = 0)
    const B = this.buf, k = a > 1 ? 1 : a;
    B[o] += (c[0] - B[o]) * k; B[o + 1] += (c[1] - B[o + 1]) * k; B[o + 2] += (c[2] - B[o + 2]) * k; B[o + 3] = 255;
  }
  rect(x0, y0, x1, y1, c, a = 1) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(PAGE_H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(PAGE_W, Math.ceil(x1)); x++) this.px(x, y, c, a);
  }
  frame(x0, y0, x1, y1, c, a = 1) { this.rect(x0, y0, x1, y0 + 1, c, a); this.rect(x0, y1 - 1, x1, y1, c, a); this.rect(x0, y0, x0 + 1, y1, c, a); this.rect(x1 - 1, y0, x1, y1, c, a); }
  /** anti-aliased segment of width w */
  line(xa, ya, xb, yb, c, w = 1, a = 1) {
    const r = w / 2 + 1, dx = xb - xa, dy = yb - ya, l2 = dx * dx + dy * dy || 1;
    for (let y = Math.floor(Math.min(ya, yb) - r); y <= Math.ceil(Math.max(ya, yb) + r); y++) {
      for (let x = Math.floor(Math.min(xa, xb) - r); x <= Math.ceil(Math.max(xa, xb) + r); x++) {
        const t = Math.max(0, Math.min(1, ((x + 0.5 - xa) * dx + (y + 0.5 - ya) * dy) / l2));
        const ex = xa + dx * t - x - 0.5, ey = ya + dy * t - y - 0.5;
        const d = Math.sqrt(ex * ex + ey * ey);
        const cov = Math.max(0, Math.min(1, w / 2 + 0.5 - d));
        if (cov > 0) this.px(x, y, c, cov * a);
      }
    }
  }
  poly(pts, c, w = 1, a = 1, closed = false) { for (let i = 0; i < pts.length - 1; i++) this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, w, a); if (closed) this.line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], c, w, a); }
  ring(cx, cy, r, c, w = 1, a = 1) {
    for (let y = Math.floor(cy - r - w); y <= Math.ceil(cy + r + w); y++) for (let x = Math.floor(cx - r - w); x <= Math.ceil(cx + r + w); x++) {
      const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r), cov = Math.max(0, Math.min(1, w / 2 + 0.5 - d));
      if (cov > 0) this.px(x, y, c, cov * a);
    }
  }
  disc(cx, cy, r, c, a = 1) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const cov = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
      if (cov > 0) this.px(x, y, c, cov * a);
    }
  }
  /** filled polygon (even-odd scanline, 4× vertical supersampling for soft edges), clipped to the page */
  fill(pts, c, a = 1) {
    let y0 = Infinity, y1 = -Infinity; for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    y0 = Math.max(0, y0); y1 = Math.min(PAGE_H, y1);
    if (y1 <= y0) return;
    const acc = new Float32Array(PAGE_W * PAGE_H);
    let rMin = PAGE_H, rMax = -1;
    for (let ys = Math.floor(y0 * 4); ys < Math.ceil(y1 * 4); ys++) {
      const yy = (ys + 0.5) / 4, xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > yy) !== (yj > yy)) xs.push(xi + ((yy - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((p, q) => p - q);
      const row = Math.floor(yy);
      if (row < 0 || row >= PAGE_H) continue;
      rMin = Math.min(rMin, row); rMax = Math.max(rMax, row);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, xs[k]), xb = Math.min(PAGE_W, xs[k + 1]);
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          const cov = Math.min(x + 1, xb) - Math.max(x, xa);
          if (cov > 0) acc[row * PAGE_W + x] += cov / 4;
        }
      }
    }
    for (let y = rMin; y <= rMax; y++) for (let x = 0; x < PAGE_W; x++) { const v = acc[y * PAGE_W + x]; if (v > 0) this.px(x, y, c, Math.min(1, v) * a); }
  }
  /** pseudo text: a run of glyph blocks (word gaps), h px tall, until width w */
  text(x, y, w, h, c, a = 1, dense = 0.75) {
    let cx = x;
    const r = this.rng;
    while (cx < x + w - 2) {
      const word = 2 + Math.floor(r.next() * 6);
      for (let k = 0; k < word && cx < x + w - 2; k++) {
        const gw = Math.max(2, Math.round(h * (0.45 + r.next() * 0.25)));
        // glyph = a few strokes in a cell: top / mid / bottom bars + verticals
        const s = r.next();
        if (s < dense) {
          this.rect(cx, y, cx + gw, y + 1, c, a * 0.9);
          if (r.next() < 0.6) this.rect(cx, y + Math.floor(h / 2), cx + gw, y + Math.floor(h / 2) + 1, c, a * 0.8);
          if (r.next() < 0.7) this.rect(cx, y + h - 1, cx + gw, y + h, c, a * 0.9);
          if (r.next() < 0.7) this.rect(cx, y, cx + 1, y + h, c, a * 0.85);
          if (r.next() < 0.6) this.rect(cx + gw - 1, y, cx + gw, y + h, c, a * 0.85);
        } else this.rect(cx, y + 1, cx + gw, y + h - 1, c, a * 0.75);
        cx += gw + 1;
      }
      cx += Math.max(3, Math.round(h * 0.6));
    }
  }
  /** numbers-like block run (narrow glyphs) */
  digits(x, y, n, h, c, a = 1) { this.text(x, y, n * (Math.round(h * 0.55) + 1), h, c, a, 0.95); }
  gradientV(x0, y0, x1, y1, ca, cb) { for (let y = y0; y < y1; y++) { const t = (y - y0) / Math.max(1, y1 - y0 - 1); this.rect(x0, y, x1, y + 1, [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]); } }
  noise(x0, y0, x1, y1, c, amt) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const n = this.rng.next(); if (n < amt) this.px(x, y, c, 0.15 + 0.5 * this.rng.next()); } }
}

// ------------------------------------------------------------------------------------------------
// shared harbour geometry for the charts (schematic of SITES.tidalBarrier: shore bay, arc, mouth, locks)
// chart coords: x along the shore (−1..1 = arc ends), y offshore (0 = arc crown) — mapped per page
function arcPt(t) { const th = t * 0.557, r = 1.0; return [Math.sin(th) * r / 0.53, (Math.cos(th) - 1) * r / 0.53 + 0.0]; }
function shorePt(t) { const c = Math.cos((Math.PI * t * 1.06) / 2); return [t * 1.06, -0.42 - 0.38 * Math.pow(Math.max(0, c), 0.7) + 0.38 * 0.0]; }

function drawChart(P, o) {
  const { cx, cy, sx, sy, sea, deep, land, landEdge, barrier, contour, gridC, magenta } = o;
  const M = (x, y) => [cx + x * sx, cy - y * sy];
  P.rect(0, 0, PAGE_W, PAGE_H, sea);
  // deep water band offshore (darker / whiter per palette)
  const deepPts = []; for (let k = 0; k <= 24; k++) { const t = -1.6 + 3.2 * k / 24; deepPts.push(M(t * 1.4, 0.35 + 0.1 * Math.sin(t * 2.3))); }
  deepPts.push(M(3, 3)); deepPts.push(M(-3, 3));
  P.fill(deepPts, deep, 1);
  // depth contours
  for (const dy of [0.12, 0.22, 0.5, 0.75]) { const pts = []; for (let k = 0; k <= 30; k++) { const t = -1.8 + 3.6 * k / 30; pts.push(M(t * 1.3, dy + 0.04 * Math.sin(t * 3.1 + dy * 9))); } P.poly(pts, contour, 1, 0.8); }
  // land with the harbour bay
  const lp = [M(-3, -3), M(-3, -0.35)];
  for (let k = 0; k <= 40; k++) { const t = -1.5 + 3 * k / 40; const at = Math.abs(t) < 1 ? shorePt(t) : [t * 1.06, -0.42 + 0.05 * Math.sin(t * 5)]; lp.push(M(at[0], at[1] + (Math.abs(t) < 1 ? 0 : 0.36))); }
  lp.push(M(3, -0.35)); lp.push(M(3, -3));
  P.fill(lp, land, 1);
  P.poly(lp.slice(1, -1), landEdge, 1.2, 0.9);
  // harbour basin contour + quays (short parallel docks cut into the shore)
  for (let q = -3; q <= 3; q++) { const [x, y] = shorePt(q * 0.22); const a = M(x, y), b = M(x, y - 0.06); P.line(a[0], a[1] + 1, b[0], b[1] + 6, landEdge, 2.2, 0.9); }
  // grid / graticule
  for (let gx = 0; gx < PAGE_W; gx += 64) P.rect(gx, 0, gx + 1, PAGE_H, gridC, 0.35);
  for (let gy = 0; gy < PAGE_H; gy += 64) P.rect(0, gy, PAGE_W, gy + 1, gridC, 0.35);
  // barrier: 10 caisson segments + abutments, lock gaps, the mouth in the middle
  const segs = [[-1, -0.83], [-0.81, -0.66], [-0.64, -0.49], [-0.47, -0.31], [-0.29, -0.06], [0.06, 0.29], [0.31, 0.47], [0.49, 0.64], [0.66, 0.81], [0.83, 1]];
  for (const [a, b] of segs) { const pts = []; for (let k = 0; k <= 8; k++) pts.push(M(...arcPt(a + (b - a) * k / 8))); P.poly(pts, barrier, o.barrierW || 3, 1); }
  // channel through the mouth (dashed magenta limits) + buoys
  for (const s of [-1, 1]) for (let k = 0; k < 14; k++) { const y0 = -0.35 + k * 0.1, a = M(s * 0.045, y0), b = M(s * 0.045, y0 + 0.05); P.line(a[0], a[1], b[0], b[1], magenta, 1.2, 0.9); }
  for (let k = 0; k < 6; k++) { const y = 0.08 + k * 0.17; const r = M(-0.07, y), g = M(0.07, y); P.disc(r[0], r[1], 2.2, [220, 40, 40]); P.disc(g[0], g[1], 2.2, [40, 190, 80]); }
  return M;
}
function vessel(P, x, y, hdg, len, c, vec = 26) {
  const s = Math.sin(hdg), co = -Math.cos(hdg);
  const tip = [x + s * len, y + co * len], l = [x - s * len * 0.5 + co * len * 0.45, y - co * len * 0.5 - s * len * 0.45], r = [x - s * len * 0.5 - co * len * 0.45, y - co * len * 0.5 + s * len * 0.45];
  P.fill([tip, l, r], c, 1);
  P.line(x, y, x + s * vec, y + co * vec, c, 1, 0.8);
}

function pageRadar(P, long) {
  P.rect(0, 0, PAGE_W, PAGE_H, [4, 9, 7]);
  const cx = 168, cy = 144, R = 132;
  P.disc(cx, cy, R, [6, 22, 14]);
  // land / barrier echoes (speckled bright returns)
  const r = P.rng, k = long ? 0.45 : 1;
  for (let i = 0; i < 2600; i++) {
    const t = r.next() * 2 - 1, ab = arcPt(t * 0.98);
    const isArc = i % 3 !== 0;
    const pt = isArc ? ab : shorePt(t * 1.4);
    if (!isArc && Math.abs(t * 1.4) > 1.2) continue;
    if (isArc && Math.abs(t) < 0.06) continue;      // the mouth
    const x = cx + (pt[0] * 70 + (r.next() - 0.5) * 3) * k, y = cy + 26 * k - (pt[1] * 70 + (isArc ? 0 : -6) + (r.next() - 0.5) * 3) * k;
    if (Math.hypot(x - cx, y - cy) < R - 2) P.px(x, y, [150, 255, 120], 0.35 + 0.5 * r.next());
  }
  // coastal land mass beyond the shore (dense returns)
  for (let i = 0; i < 2400; i++) {
    const x = cx + (r.next() * 2 - 1) * R, y = cy - 20 * k - r.next() * R;
    const sy = cy + 26 * k - (shorePt(Math.max(-1, Math.min(1, (x - cx) / (70 * k * 1.06))))[1] * 70) * k;
    if (y < sy - 8 * k && Math.hypot(x - cx, y - cy) < R - 2 && r.next() < 0.5) P.px(x, y, [90, 210, 80], 0.15 + 0.35 * r.next());
  }
  // sea clutter near the centre
  for (let i = 0; i < 900; i++) { const a = r.next() * 6.283, d = Math.pow(r.next(), 2) * 40; P.px(cx + Math.cos(a) * d, cy + Math.sin(a) * d, [90, 200, 90], 0.25); }
  // range rings, bearing scale
  for (let i = 1; i <= 5; i++) P.ring(cx, cy, (R * i) / 5, [40, 120, 60], 1, 0.55);
  P.ring(cx, cy, R, [80, 190, 100], 1.4, 0.9);
  for (let d = 0; d < 360; d += 5) { const a = (d * Math.PI) / 180, l = d % 30 === 0 ? 9 : 4; P.line(cx + Math.sin(a) * R, cy - Math.cos(a) * R, cx + Math.sin(a) * (R - l), cy - Math.cos(a) * (R - l), [90, 200, 110], 1, 0.9); }
  P.line(cx, cy, cx + Math.sin(0.21) * R, cy - Math.cos(0.21) * R, [180, 255, 190], 1, 0.7);      // heading line
  // targets with afterglow trails
  const tg = long ? [[0.3, 0.55], [-0.4, 0.3], [0.62, -0.2], [0.1, 0.8], [-0.7, 0.62]] : [[0.08, 0.5], [0.22, 0.32], [-0.35, 0.1], [0.5, 0.72], [-0.15, 0.85], [0.04, -0.12]];
  for (const [tx, ty] of tg) {
    const x = cx + tx * R * 0.9, y = cy - ty * R * 0.9;
    for (let j = 0; j < 7; j++) P.disc(x - j * 2.2, y + j * 1.6, 1.8 - j * 0.15, [60, 200, 90], 0.35 - j * 0.04);
    P.rect(x - 2, y - 1.5, x + 3, y + 2, [220, 255, 170], 1);
    P.ring(x, y, 6, [255, 200, 60], 1, 0.75);                 // acquired target symbol
    P.line(x, y, x + 12, y - 14, [255, 200, 60], 1, 0.75);     // vector
  }
  // sweep: bright line + fading wedge behind it
  const sw = 2.1;
  for (let j = 0; j < 40; j++) { const a = sw - j * 0.012; P.line(cx, cy, cx + Math.sin(a) * (R - 2), cy - Math.cos(a) * (R - 2), [120, 255, 140], 1.5, 0.16 * (1 - j / 40)); }
  P.line(cx, cy, cx + Math.sin(sw) * (R - 2), cy - Math.cos(sw) * (R - 2), [190, 255, 200], 1.5, 0.95);
  // right data panel
  P.rect(322, 6, 506, 282, [10, 22, 18]); P.frame(322, 6, 506, 282, [40, 110, 70], 1);
  P.rect(322, 6, 506, 22, [22, 60, 40]); P.text(328, 11, 120, 7, [170, 255, 190]);
  for (let i = 0; i < 9; i++) { const y = 32 + i * 18; P.text(330, y, 90, 7, [120, 220, 140], 0.9); P.digits(440, y, 6, 7, i === 2 ? [255, 210, 80] : [170, 255, 190]); }
  for (let i = 0; i < 4; i++) { P.rect(330 + i * 44, 200, 368 + i * 44, 222, i === 1 ? [40, 120, 70] : [20, 50, 35]); P.text(334 + i * 44, 208, 28, 6, [170, 255, 190]); }
  P.text(330, 236, 160, 7, [120, 220, 140]); P.text(330, 254, 120, 7, [120, 220, 140]);
}

function pageEcdis(P, mouth) {
  const pal = { sea: [200, 222, 236], deep: [236, 244, 250], land: [222, 202, 150], landEdge: [120, 100, 70], barrier: [90, 92, 98], contour: [90, 140, 200], gridC: [120, 140, 160], magenta: [200, 40, 160] };
  const M = drawChart(P, mouth ? { ...pal, cx: 256, cy: 110, sx: 520, sy: 360, barrierW: 6 } : { ...pal, cx: 236, cy: 120, sx: 180, sy: 150 });
  // own tower symbol, vessels with heading vectors, track history of the inbound ferry
  const ot = M(-0.07, 0.0); P.ring(ot[0], ot[1], 5, [200, 40, 160], 1.5); P.disc(ot[0], ot[1], 1.5, [200, 40, 160]);
  const ships = mouth ? [[0.02, 0.28, 3.3, 9, [20, 20, 30]], [0.12, 0.55, 3.0, 11, [20, 20, 30]], [-0.2, -0.1, 1.2, 7, [20, 120, 40]]] : [[0.02, 0.32, 3.3, 7, [20, 20, 30]], [0.25, 0.7, 3.4, 9, [20, 20, 30]], [-0.5, 0.45, 1.9, 6, [20, 20, 30]], [0.4, -0.18, 4.4, 5, [20, 120, 40]], [-0.3, -0.25, 0.4, 5, [20, 120, 40]], [0.75, 0.9, 3.9, 8, [20, 20, 30]]];
  for (const [x, y, h, l, c] of ships) { const p = M(x, y); vessel(P, p[0], p[1], h, l, c, l * 3); }
  for (let k = 1; k < 9; k++) { const p = M(0.02 + 0.006 * k, 0.32 + 0.07 * k * (mouth ? 0.5 : 1)); P.disc(p[0], p[1], 1.2, [60, 60, 70], 0.8); }
  // top bar + right info panel
  P.rect(0, 0, PAGE_W, 16, [52, 58, 66]); P.text(6, 5, 200, 6, [230, 235, 240]); P.digits(420, 5, 10, 6, [230, 235, 240]);
  P.rect(416, 16, 512, 288, [238, 240, 242]); P.rect(416, 16, 417, 288, [150, 155, 160]);
  for (let i = 0; i < 12; i++) { const y = 24 + i * 15; P.text(422, y, 50, 6, [60, 64, 70]); P.digits(476, y, 5, 6, i === 3 ? [200, 40, 160] : [30, 34, 40]); }
  P.rect(422, 210, 506, 236, [210, 225, 240]); P.text(428, 220, 70, 6, [40, 60, 90]);
  // scale bar + north arrow
  P.rect(14, 266, 94, 268, [30, 30, 40]); for (let k = 0; k <= 4; k++) P.rect(14 + k * 20, 262, 15 + k * 20, 270, [30, 30, 40]);
  P.fill([[396, 30], [390, 46], [402, 46]], [30, 30, 40]);
}

function pageAis(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [10, 18, 32]);
  P.rect(0, 0, PAGE_W, 22, [28, 52, 86]); P.text(8, 8, 160, 7, [210, 230, 255]); P.digits(420, 8, 9, 7, [150, 200, 255]);
  P.rect(0, 22, PAGE_W, 38, [20, 36, 60]);
  const cols = [8, 108, 196, 262, 326, 392, 452];
  for (const x of cols) P.text(x, 28, 40, 6, [140, 175, 220]);
  for (let i = 0; i < 13; i++) {
    const y = 42 + i * 18;
    if (i === 1) P.rect(0, y - 3, PAGE_W, y + 13, [20, 90, 120]);
    else if (i % 2) P.rect(0, y - 3, PAGE_W, y + 13, [14, 25, 44]);
    const st = [[60, 200, 110], [240, 200, 60], [60, 200, 110], [120, 140, 170]][(i * 7) % 4];
    P.disc(cols[0] + 3, y + 5, 3, st);
    P.text(cols[0] + 12, y + 2, 78, 7, [215, 228, 245]);
    for (let c = 1; c < cols.length; c++) P.digits(cols[c], y + 2, 4 + ((i + c) % 4), 7, i === 1 ? [240, 255, 255] : [170, 195, 230]);
  }
  P.rect(0, 276, PAGE_W, 288, [28, 52, 86]); P.text(8, 279, 240, 6, [180, 210, 245]);
}

function graph(P, x0, y0, x1, y1, fn, c, fillC) {
  P.rect(x0, y0, x1, y1, [12, 20, 26]); P.frame(x0, y0, x1, y1, [50, 70, 85]);
  for (let gx = x0; gx < x1; gx += 32) P.rect(gx, y0, gx + 1, y1, [35, 50, 60], 0.8);
  for (let gy = y0; gy < y1; gy += 16) P.rect(x0, gy, x1, gy + 1, [35, 50, 60], 0.8);
  const pts = [];
  for (let x = x0 + 2; x < x1 - 2; x += 2) { const t = (x - x0) / (x1 - x0); pts.push([x, y1 - 4 - fn(t) * (y1 - y0 - 8)]); }
  if (fillC) for (const [x, y] of pts) P.rect(x, y, x + 2, y1 - 1, fillC, 0.25);
  P.poly(pts, c, 1.6, 1);
}
function pageTide(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [8, 13, 18]);
  P.rect(0, 0, PAGE_W, 18, [24, 38, 50]); P.text(8, 6, 180, 6, [200, 225, 240]);
  graph(P, 8, 26, 330, 140, (t) => 0.5 + 0.42 * Math.sin(t * 9.4 - 1.2), [80, 210, 255], [40, 120, 170]);
  P.rect(196, 26, 198, 140, [255, 190, 60]);                                    // now
  graph(P, 8, 150, 330, 280, (t) => 0.3 + 0.25 * Math.sin(t * 23) * Math.sin(t * 5) + 0.15 * t, [120, 230, 140]);
  // wave height bars + wind rose
  P.rect(340, 26, 504, 150, [12, 20, 26]); P.frame(340, 26, 504, 150, [50, 70, 85]);
  for (let i = 0; i < 18; i++) { const h = 20 + 70 * (0.5 + 0.5 * Math.sin(i * 0.7 + 1)) * (0.6 + 0.4 * P.rng.next()); P.rect(346 + i * 8.8, 146 - h, 352 + i * 8.8, 146, [70, 140, 230]); }
  const cx = 422, cy = 214; P.ring(cx, cy, 52, [60, 90, 110], 1); P.ring(cx, cy, 30, [45, 65, 80], 1);
  for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.283, l = 10 + 36 * Math.pow(0.5 + 0.5 * Math.cos(a - 1.25), 2.2); P.line(cx, cy, cx + Math.sin(a) * l, cy - Math.cos(a) * l, [120, 220, 255], 3, 0.8); }
  P.text(346, 270, 150, 6, [160, 190, 210]);
}

function pageLocks(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [14, 16, 20]);
  P.rect(0, 0, PAGE_W, 20, [40, 44, 52]); P.text(8, 7, 200, 6, [220, 225, 235]);
  // schematic barrier arc: 10 segments, 8 locks, the mouth
  const cx = 256, cy = 330, R = 240;
  const items = [];
  let a = -0.9;
  const segW = 0.13, gapW = 0.045, mouthW = 0.12;
  for (let i = 0; i < 10; i++) {
    items.push({ k: 'seg', a0: a, a1: a + segW }); a += segW;
    if (i === 4) { items.push({ k: 'mouth', a0: a, a1: a + mouthW }); a += mouthW; } else if (i < 9) { items.push({ k: 'lock', a0: a, a1: a + gapW, i: items.filter((q) => q.k === 'lock').length }); a += gapW; }
  }
  const S = (ang, r) => [cx + Math.sin(ang) * r, cy - Math.cos(ang) * r];
  for (const it of items) {
    if (it.k === 'seg') { const pts = []; for (let k = 0; k <= 6; k++) pts.push(S(it.a0 + (it.a1 - it.a0) * k / 6, R)); P.poly(pts, [150, 155, 165], 12, 1); }
    else if (it.k === 'lock') {
      const open = lockOuterOpen(it.i), m = (it.a0 + it.a1) / 2, p = S(m, R), q = S(m, R - 46);
      P.line(p[0], p[1], q[0], q[1], [90, 95, 105], 3, 1);
      const g0 = S(it.a0, R + 4), g1 = S(it.a1, R + 4);
      P.line(g0[0], g0[1], g1[0], g1[1], open ? [60, 220, 110] : [235, 60, 50], 4, 1);
      P.disc(q[0], q[1] - 8, 6, open ? [60, 220, 110] : [235, 60, 50]);
      P.digits(q[0] - 8, q[1] + 2, 2, 7, [220, 225, 235]);
    } else {
      const m = (it.a0 + it.a1) / 2, p = S(m, R + 30), q = S(m, R - 30);
      P.line(p[0], p[1], q[0], q[1], [60, 220, 110], 2, 1); P.fill([[q[0], q[1] - 2], [q[0] - 6, q[1] - 12], [q[0] + 6, q[1] - 12]], [60, 220, 110]);
    }
  }
  // status rows
  for (let i = 0; i < 4; i++) { const y = 232 + i * 13; P.disc(14, y + 3, 3.5, i === 2 ? [240, 190, 50] : [60, 220, 110]); P.text(24, y, 180, 6, [200, 205, 215]); P.digits(300, y, 8, 6, [200, 205, 215]); }
}

function pageCctv(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [6, 6, 8]);
  const r = P.rng;
  for (let q = 0; q < 4; q++) {
    const x0 = (q % 2) * 256 + 3, y0 = Math.floor(q / 2) * 144 + 3, x1 = x0 + 250, y1 = y0 + 138;
    const hz = y0 + 40 + q * 9;
    P.gradientV(x0, y0, x1, hz, [150, 160, 172], [196, 196, 192]);
    P.gradientV(x0, hz, x1, y1, [86, 98, 108], [52, 62, 70]);
    for (let i = 0; i < 260; i++) { const x = x0 + r.next() * 250, y = hz + 2 + Math.pow(r.next(), 1.5) * (y1 - hz - 4); P.rect(x, y, x + 3 + r.next() * 10, y + 1, [150, 160, 170], 0.25); }
    // structures: caisson wall / gantry / tower silhouettes
    if (q === 0) { P.rect(x0, hz - 6, x0 + 170, hz + 8, [130, 132, 135]); for (let k = 0; k < 6; k++) P.rect(x0 + 10 + k * 28, hz - 4, x0 + 12 + k * 28, hz + 8, [90, 92, 95]); P.rect(x0 + 180, hz - 40, x0 + 196, hz + 8, [205, 205, 200]); }
    if (q === 1) { P.rect(x0 + 40, hz - 34, x0 + 46, hz + 6, [180, 160, 60]); P.rect(x0 + 180, hz - 34, x0 + 186, hz + 6, [180, 160, 60]); P.rect(x0 + 40, hz - 36, x0 + 186, hz - 28, [190, 170, 70]); P.rect(x0, hz + 6, x1, hz + 18, [120, 122, 125]); }
    if (q === 2) { P.fill([[x0 + 70, hz + 10], [x0 + 150, hz + 10], [x0 + 160, hz], [x0 + 60, hz]], [220, 222, 225]); P.rect(x0 + 90, hz - 12, x0 + 130, hz, [235, 235, 238]); }
    if (q === 3) { P.rect(x0 + 120, hz - 52, x0 + 132, hz + 4, [235, 235, 235]); P.rect(x0 + 120, hz - 40, x0 + 132, hz - 30, [190, 40, 40]); P.rect(x0 + 120, hz - 20, x0 + 132, hz - 10, [190, 40, 40]); }
    P.noise(x0, y0, x1, y1, [255, 255, 255], 0.02);
    P.frame(x0 - 1, y0 - 1, x1 + 1, y1 + 1, [70, 70, 75]);
    P.text(x0 + 6, y0 + 6, 70, 6, [240, 240, 240]); P.digits(x1 - 70, y1 - 12, 10, 6, [240, 240, 240]);
  }
}

function dial(P, cx, cy, r, v, c) {
  P.disc(cx, cy, r, [16, 22, 28]); P.ring(cx, cy, r, [80, 100, 115], 1.5);
  for (let k = 0; k <= 10; k++) { const a = -2.4 + 4.8 * k / 10; P.line(cx + Math.sin(a) * r * 0.82, cy - Math.cos(a) * r * 0.82, cx + Math.sin(a) * r * 0.95, cy - Math.cos(a) * r * 0.95, [170, 190, 205], 1, 0.9); }
  const a = -2.4 + 4.8 * v; P.line(cx, cy, cx + Math.sin(a) * r * 0.78, cy - Math.cos(a) * r * 0.78, c, 2.2, 1); P.disc(cx, cy, 3, c);
  P.digits(cx - 14, cy + r * 0.45, 4, 7, [220, 230, 240]);
}
function pageWeather(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [10, 14, 18]);
  P.rect(0, 0, PAGE_W, 18, [28, 40, 50]); P.text(8, 6, 150, 6, [210, 225, 235]);
  dial(P, 70, 86, 52, 0.42, [255, 190, 60]); dial(P, 194, 86, 52, 0.66, [90, 210, 255]); dial(P, 318, 86, 52, 0.3, [120, 230, 140]); dial(P, 442, 86, 52, 0.55, [240, 120, 90]);
  for (let i = 0; i < 4; i++) P.text(30 + i * 124, 146, 80, 6, [170, 190, 205]);
  graph(P, 8, 162, 504, 280, (t) => 0.45 + 0.2 * Math.sin(t * 13) + 0.1 * Math.sin(t * 41), [255, 190, 60]);
}

function pageSystems(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [12, 14, 16]);
  P.rect(0, 0, PAGE_W, 18, [36, 40, 46]); P.text(8, 6, 220, 6, [215, 220, 228]);
  for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) {
    const x = 8 + i * 84, y = 26 + j * 52, h = hash4(0x5e5, i, j, 1) % 13;
    const c = h === 0 ? [200, 140, 30] : h === 1 ? [70, 76, 84] : [34, 120, 70];
    P.rect(x, y, x + 78, y + 46, c); P.frame(x, y, x + 78, y + 46, [200, 210, 220], 0.35);
    P.text(x + 6, y + 8, 60, 6, [235, 240, 245]); P.digits(x + 6, y + 28, 5, 9, [255, 255, 255]);
  }
}

function pageBerths(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [14, 18, 24]);
  P.rect(0, 0, PAGE_W, 18, [34, 46, 62]); P.text(8, 6, 170, 6, [210, 225, 240]);
  for (let gx = 96; gx < PAGE_W; gx += 34) { P.rect(gx, 18, gx + 1, PAGE_H, [40, 52, 66]); P.digits(gx + 4, 22, 2, 6, [140, 160, 185]); }
  const r = P.rng, cols = [[70, 150, 230], [90, 200, 140], [230, 170, 60], [170, 120, 230]];
  for (let i = 0; i < 12; i++) {
    const y = 36 + i * 20;
    P.text(8, y + 4, 80, 6, [190, 205, 225]);
    let x = 96 + r.next() * 60;
    while (x < PAGE_W - 30) { const w = 30 + r.next() * 110; P.rect(x, y, Math.min(PAGE_W - 4, x + w), y + 14, cols[Math.floor(r.next() * 4)], 0.9); P.text(x + 4, y + 4, Math.min(w - 8, 60), 5, [20, 24, 30]); x += w + 10 + r.next() * 50; }
  }
  P.rect(300, 18, 302, PAGE_H, [255, 80, 70]);
}

function pageComms(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [12, 12, 16]);
  P.rect(0, 0, PAGE_W, 18, [40, 36, 50]); P.text(8, 6, 160, 6, [225, 220, 235]);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) {
    const x = 10 + i * 66, y = 28 + j * 66, act = (i + j * 5) === 6 || (i + j * 5) === 12;
    P.rect(x, y, x + 60, y + 58, act ? [30, 140, 90] : [36, 38, 48]); P.frame(x, y, x + 60, y + 58, [120, 125, 140], 0.6);
    P.digits(x + 10, y + 12, 2, 12, [240, 240, 245]); P.text(x + 8, y + 40, 44, 6, [200, 205, 215]);
  }
  for (let k = 0; k < 14; k++) { const h = 20 + 150 * Math.abs(Math.sin(k * 1.7 + 0.4)) * (k < 9 ? 1 : 0.5); P.rect(352 + k * 11, 230 - h, 360 + k * 11, 230, h > 120 ? [240, 90, 60] : h > 80 ? [240, 200, 60] : [70, 210, 110]); }
  P.text(352, 244, 150, 6, [200, 205, 215]); P.text(10, 236, 300, 7, [200, 205, 215]); P.text(10, 254, 220, 7, [150, 155, 170]);
}

function pagePaperChart(P) {
  const pal = { sea: [232, 238, 236], deep: [244, 246, 240], land: [226, 206, 158], landEdge: [96, 78, 52], barrier: [70, 70, 74], contour: [110, 150, 190], gridC: [150, 150, 140], magenta: [180, 50, 140], cx: 250, cy: 120, sx: 190, sy: 160, barrierW: 3.5 };
  const M = drawChart(P, pal);
  // paper tone + soundings (tiny digit clusters) + compass rose + title block
  const r = P.rng;
  for (let i = 0; i < 220; i++) {
    const t = r.next() * 3 - 1.5, yo = -0.3 + r.next() * 1.6;           // chart coords; soundings only on the water
    const sh = Math.abs(t) < 1 ? shorePt(t)[1] : -0.06;
    const inHarbour = Math.abs(t) < 0.95 && yo < arcPt(t)[1] - 0.03 && yo > sh + 0.04;
    if (!(inHarbour || (yo > arcPt(Math.max(-1, Math.min(1, t)))[1] + 0.05 && yo > sh + 0.1))) continue;
    const p = M(t, yo); P.digits(p[0], p[1], 2, 3, [70, 90, 120], 0.7);
  }
  const cx = 424, cy = 214;
  P.ring(cx, cy, 44, [150, 60, 120], 1); P.ring(cx, cy, 36, [150, 60, 120], 1);
  for (let d = 0; d < 360; d += 10) { const a = d * Math.PI / 180, l = d % 90 === 0 ? 12 : 4; P.line(cx + Math.sin(a) * 44, cy - Math.cos(a) * 44, cx + Math.sin(a) * (44 - l), cy - Math.cos(a) * (44 - l), [150, 60, 120], 1, 0.9); }
  P.fill([[cx, cy - 30], [cx - 5, cy], [cx + 5, cy]], [150, 60, 120]);
  P.rect(16, 230, 180, 276, [246, 242, 228]); P.frame(16, 230, 180, 276, [90, 80, 60]); P.text(24, 238, 140, 7, [60, 50, 40]); P.text(24, 254, 110, 5, [80, 70, 55]);
  // pencil course line + fixes
  const a = M(0.02, 1.2), b = M(0.02, -0.3); P.line(a[0], a[1], b[0], b[1], [60, 60, 70], 1, 0.7);
  for (let k = 0; k < 5; k++) { const p = M(0.02, 0.2 + k * 0.22); P.ring(p[0], p[1], 3, [60, 60, 70], 1, 0.8); P.digits(p[0] + 6, p[1] - 3, 4, 5, [60, 60, 70], 0.8); }
  P.noise(0, 0, PAGE_W, PAGE_H, [200, 190, 160], 0.05);
}

function pagePaperLog(P) {
  P.rect(0, 0, PAGE_W, PAGE_H, [238, 236, 228]);
  for (let y = 24; y < PAGE_H; y += 12) P.rect(0, y, PAGE_W, y + 1, [170, 190, 215], 0.8);
  P.rect(40, 0, 41, PAGE_H, [220, 120, 120]);
  for (let i = 0; i < 20; i++) { const y = 26 + i * 12; P.text(46, y + 2, 140 + (i * 37) % 260, 7, [40, 44, 70], 0.85); }
  P.text(46, 8, 160, 8, [30, 30, 50]);
}

/** generate the atlas: { name, width, height, color: Uint8Array RGBA (sRGB) } */
export function generateScreenAtlas() {
  const buf = new Float32Array(ATLAS_W * ATLAS_H * 4);
  const pg = (p) => new Page(buf, p);
  pageRadar(pg(PAGE.RADAR), false);
  pageEcdis(pg(PAGE.ECDIS), false);
  pageAis(pg(PAGE.AIS));
  pageTide(pg(PAGE.TIDE));
  pageLocks(pg(PAGE.LOCKS));
  pageCctv(pg(PAGE.CCTV));
  pageWeather(pg(PAGE.WEATHER));
  pageSystems(pg(PAGE.SYSTEMS));
  pageEcdis(pg(PAGE.ECDIS_MOUTH), true);
  pageRadar(pg(PAGE.RADAR_LONG), true);
  pageBerths(pg(PAGE.BERTHS));
  pageComms(pg(PAGE.COMMS));
  pagePaperChart(pg(PAGE.PAPER_CHART));
  pagePaperLog(pg(PAGE.PAPER_LOG));
  const color = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) color[i] = Math.max(0, Math.min(255, Math.round(buf[i])));
  return { name: 'mega_screens', width: ATLAS_W, height: ATLAS_H, color };
}
