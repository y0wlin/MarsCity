// Shared helpers for the urban preview scripts: a tiny software canvas (polygon fill, thick
// lines, discs, text-free legends), colour conversions and a simple terrain base colour.
import { writePng } from './node-world.mjs';

export function lin2srgb(c) { c = c <= 0 ? 0 : c >= 1 ? 1 : c; return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
export function srgb2lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function hex(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }

export class Canvas {
  constructor(w, h, bg = [0, 0, 0]) {
    this.w = w; this.h = h; this.px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { this.px[4 * i] = bg[0]; this.px[4 * i + 1] = bg[1]; this.px[4 * i + 2] = bg[2]; this.px[4 * i + 3] = 255; }
  }
  set(x, y, c, a = 1) {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = 4 * (y * this.w + x);
    if (a >= 1) { this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; return; }
    this.px[i] = this.px[i] * (1 - a) + c[0] * a; this.px[i + 1] = this.px[i + 1] * (1 - a) + c[1] * a; this.px[i + 2] = this.px[i + 2] * (1 - a) + c[2] * a;
  }
  /** even-odd scanline polygon fill; pts = [[x,y],...] in pixels */
  poly(pts, c, a = 1) {
    if (pts.length < 3) return;
    let y0 = 1e9, y1 = -1e9;
    for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(this.h - 1, Math.ceil(y1));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5; xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > sy) !== (yj > sy)) xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(this.w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) this.set(x, y, c, a);
      }
    }
  }
  /** thick line as a quad (+ round caps) */
  line(x0, y0, x1, y1, width, c, a = 1) {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
    const hw = Math.max(0.5, width / 2);
    if (l < 1e-6) { this.disc(x0, y0, hw, c, a); return; }
    const nx = -dy / l * hw, ny = dx / l * hw;
    this.poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], c, a);
    if (hw > 1.5) { this.disc(x0, y0, hw, c, a); this.disc(x1, y1, hw, c, a); }
  }
  polyline(pts, width, c, a = 1) { for (let i = 1; i < pts.length; i++) this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], width, c, a); }
  disc(cx, cy, r, c, a = 1) {
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d <= r) this.set(x, y, c, a); }
  }
  rect(x, y, w, h, c, a = 1) { for (let j = Math.max(0, y | 0); j < Math.min(this.h, (y + h) | 0); j++) for (let i = Math.max(0, x | 0); i < Math.min(this.w, (x + w) | 0); i++) this.set(i, j, c, a); }
  async save(file) { await writePng(file, this.w, this.h, this.px); }
}

/** simple preview terrain colour (linear) from fields: sea, rock, ochre plains, ice */
export function terrainColor(F, h, out) {
  if ((F.coastM !== undefined ? F.coastM : F.coast) < 0) { const d = Math.min(1, -F.coast * 2); out[0] = 0.012 + 0.01 * (1 - d); out[1] = 0.035 + 0.03 * (1 - d); out[2] = 0.085 + 0.06 * (1 - d); return out; }
  const rock = F.ridge, ice = F.ice;
  let r = 0.30, g = 0.12, b = 0.055;                    // ochre-red plain
  r = r * (1 - rock) + 0.22 * rock; g = g * (1 - rock) + 0.075 * rock; b = b * (1 - rock) + 0.04 * rock;
  if (F.zoneO > 0.5) { r *= 1.05; g *= 1.0; }
  const ii = Math.min(1, ice * 1.2);
  out[0] = r * (1 - ii) + 0.75 * ii; out[1] = g * (1 - ii) + 0.78 * ii; out[2] = b * (1 - ii) + 0.82 * ii;
  return out;
}

// Land-use / class palette (sRGB bytes) for planning maps
export const CLS_COLORS = {
  0: [176, 92, 58],     // natural (terrain)
  1: [70, 70, 78],      // arterial
  2: [112, 112, 118],   // local road
  3: [120, 60, 150],    // rail
  4: [196, 190, 178],   // sidewalk
  5: [236, 232, 222],   // roof
  6: [170, 182, 140],   // yard
  7: [62, 120, 58],     // park
  8: [222, 214, 196],   // plaza
  9: [140, 170, 70],    // farm
  10: [160, 210, 225],  // greenhouse
  11: [200, 196, 186],  // dock
  12: [215, 210, 200],  // pier
  13: [150, 146, 140],  // industrial
  14: [120, 130, 90],   // canal bank
  15: [30, 40, 80],     // solar
  16: [90, 90, 96],     // parking
  17: [80, 80, 80],     // barrier
  18: [150, 140, 128],  // lane
  19: [178, 140, 100],  // farm road
  20: [90, 90, 120],    // bridge
  21: [210, 210, 214],  // pipe
  22: [40, 85, 40],     // tree row
  23: [80, 150, 60],    // sports
};

export const USE_COLORS = {
  residential: [238, 214, 168], residential_tower: [240, 170, 110], shop_row: [235, 120, 110], clinic: [230, 60, 70], school: [250, 210, 60],
  market: [240, 140, 40], station: [150, 60, 210], ferry_terminal: [60, 160, 230], research: [110, 190, 200], office: [120, 150, 230],
  civic_tower: [255, 80, 200], warehouse: [150, 150, 150], port_shed: [100, 120, 140], community: [200, 230, 120],
  pumphouse: [40, 120, 230], sluice_station: [20, 80, 200], greenhouse: [150, 230, 200], dorm: [230, 200, 150], control_tower: [250, 250, 250],
  maintenance: [190, 170, 140], cold_storage: [170, 220, 250], farm_station: [210, 160, 90], water_treatment: [60, 200, 220], service_depot: [170, 150, 120],
  insulated_station: [245, 245, 255], meltwater_pump: [100, 180, 255],
};
export const AREA_COLORS = {
  park: [70, 125, 60], green: [80, 135, 70], garden: [110, 150, 85], courtyard: [120, 160, 95], yard: [175, 180, 150], lane: [150, 140, 128],
  plaza: [225, 218, 200], station_plaza: [215, 205, 235], schoolyard: [210, 190, 150], pitch: [60, 150, 60], parking: [100, 100, 108],
  yard_industrial: [160, 156, 150], yard_service: [168, 162, 152], container_yard: [170, 120, 90], dock: [205, 200, 190], solar: [30, 40, 80],
  basins: [40, 110, 150], field: [140, 170, 70],
};
export const CROP_COLORS = {
  1: [[150, 170, 60], [200, 160, 100], [70, 110, 120], [170, 200, 90]],
  2: [[90, 150, 60], [170, 130, 90], [70, 110, 120], [140, 190, 90]],
  3: [[110, 170, 70], [180, 160, 100], [60, 110, 130], [140, 190, 110]],
  4: [[50, 100, 45], [50, 100, 45], [50, 100, 45], [50, 100, 45]],
  5: [[120, 175, 70], [190, 170, 110], [70, 110, 120], [160, 195, 100]],
  6: [[160, 95, 60], [160, 95, 60], [160, 95, 60], [160, 95, 60]],
  7: [[60, 140, 120], [60, 140, 120], [60, 140, 120], [60, 140, 120]],
};

export function srgbBytes(r, g, b) { return [Math.round(lin2srgb(r) * 255), Math.round(lin2srgb(g) * 255), Math.round(lin2srgb(b) * 255)]; }
