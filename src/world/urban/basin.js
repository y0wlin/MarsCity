// OX1 东泽汇水盆地 programme (fix round 3, U1; §5 03 "闸前深水…沿堤路排开白色维护房、工务塔和低层聚落，塔只占少量轮廓").
// Pure, worker-safe, deterministic (hydro.ox1Basin() + terrain only). Placed ONCE in a global basin frame — origin at
// the sill (first point of the outlet main 'OX1-BL1-OUT'), x downstream along the canal, y toward its left bank — so
// every district that holds part of it adds exactly the same buildings (sites whose anchor lies in its polygon) and
// the same street pieces, whatever its own plane:
//   * sluice stations at the three outlet sluices (back on the canal, meta.sluice / meta.water from the hydro record;
//     dry corners, ≥ 10 m from the lake; embankment banks get a levelled pad, meta.pad, up to 9 m spread),
//   * a work tower (工务塔) beside the sill station and one in the town, white maintenance houses every ~420 m along
//     the levee roads (alternating banks, fronts to the levee road),
//   * a low utility town (dorm rows, maintenance halls, depots, cold store, water treatment, farm station) on the left
//     bank between the sill and the second sluice, with a spine street and cross streets to the levee road; its west
//     end is a row on the lake's SW shore (backs to the lake, ≥ 15 m from the water).
// Nothing stands in the lake (waterAt type 3 'OX1-BL1'), on water or on steep ground (corner spread limits).
//   basinProgram()        → {canalId, sites:[{use, lat, lon, heading, w, d, meta, round?}], roads:[{id, cls, width, pts:[[lat,lon]..]}]} | null
//   basinTownAt(x, y, z)  → true inside the town's reserved ground (farm blocks there stay unplanted)
import { R } from '../../core/constants.js';
import { latLonToUnit, enuBasis } from '../../core/geo.js';
import { ox1BasinInfo, isWet, waterProbe } from './probe.js';

const DEG = Math.PI / 180;
let PROG, FR = null;
const Q = {};

function frame() {
  if (FR !== null) return FR;
  FR = false;
  const B = ox1BasinInfo();
  if (!B || !B.outlet || !B.outlet.points || B.outlet.points.length < 2) return FR;
  const oc = B.outlet, p0 = oc.points[0], pN = oc.points[oc.points.length - 1];
  const O = latLonToUnit(p0[0], p0[1], {}), E = enuBasis(p0[0], p0[1], {});
  const enOf = (lat, lon) => {
    const q = latLonToUnit(lat, lon, {}); const dx = q.x - O.x, dy = q.y - O.y, dz = q.z - O.z;
    return [(dx * E.east[0] + dy * E.east[1] + dz * E.east[2]) * R, (dx * E.north[0] + dy * E.north[1] + dz * E.north[2]) * R];
  };
  const [ex, nx] = enOf(pN[0], pN[1]); const L = Math.hypot(ex, nx);
  const X = [ex / L, nx / L], Y = [-X[1], X[0]];
  FR = { B, oc, O, E, X, Y, L, enOf };
  return FR;
}
function unitOf(F, x, y, out) {
  const e = F.X[0] * x + F.Y[0] * y, n = F.X[1] * x + F.Y[1] * y, k = 1 / R, E = F.E, O = F.O;
  const qx = O.x + (E.east[0] * e + E.north[0] * n) * k, qy = O.y + (E.east[1] * e + E.north[1] * n) * k, qz = O.z + (E.east[2] * e + E.north[2] * n) * k;
  const l = Math.sqrt(qx * qx + qy * qy + qz * qz); out.x = qx / l; out.y = qy / l; out.z = qz / l;
  return out;
}
/** basin-frame coordinates of unit vector p */
function xyOf(F, x, y, z, out) {
  const dx = x - F.O.x, dy = y - F.O.y, dz = z - F.O.z, E = F.E;
  const e = (dx * E.east[0] + dy * E.east[1] + dz * E.east[2]) * R, n = (dx * E.north[0] + dy * E.north[1] + dz * E.north[2]) * R;
  out.x = e * F.X[0] + n * F.X[1]; out.y = e * F.Y[0] + n * F.Y[1];
  return out;
}

// town ground (basin frame, left bank): x 380–1380 m below the sill, y 40–330 m from the canal centreline
const TOWN = { x0: 330, x1: 1400, y0: 38, y1: 330 };
const XY = {};
export function basinTownAt(x, y, z) {
  const F = frame();
  if (!F) return false;
  xyOf(F, x, y, z, XY);
  return XY.x > TOWN.x0 - 20 && XY.x < TOWN.x1 + 20 && XY.y > TOWN.y0 && XY.y < TOWN.y1 + 30;
}
/** quick test: is unit vector p within r metres of the programme (sill … canal end)? */
export function nearBasinProgram(x, y, z, r) {
  const F = frame();
  if (!F) return false;
  xyOf(F, x, y, z, XY);
  return XY.x > -1500 - r && XY.x < F.L + 600 + r && Math.abs(XY.y) < 1500 + r;
}

export function basinProgram() {
  if (PROG === undefined) { try { PROG = build(); } catch (e) { PROG = null; } }
  return PROG;
}

function build() {
  const F = frame();
  if (!F) return null;
  const oc = F.oc, cw = oc.width || 44;
  const sites = [], roads = [];
  const llOf = (x, y) => { unitOf(F, x, y, Q); return [Math.asin(Q.y) / DEG, Math.atan2(Q.x, Q.z) / DEG]; };
  const bearing = (dx, dy) => { const e = F.X[0] * dx + F.Y[0] * dy, n = F.X[1] * dx + F.Y[1] * dy; return (Math.atan2(e, n) / DEG + 360) % 360; };
  const taken = [];   // [x, y, r] footprints already used (basin frame)
  const free = (x, y, r) => taken.every(([a, b, c]) => Math.hypot(a - x, b - y) > c + r + 4);
  // footprint test of a rect centred (x, y): w along x, d along y (rot: w along y); clear = water clearance ring (m),
  // lakeOnly: only lake water counts for the ring (water works beside the canal). → {lo, hi, spread} | null
  function foot(x, y, w, d, clear, lakeOnly, rot) {
    const hw = (rot ? d : w) / 2, hd = (rot ? w : d) / 2;
    // water clearance ring first (water lookups only), then the footprint (ground + water)
    if (clear > 0) {
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        unitOf(F, x + a * (hw + clear), y + b * (hd + clear), Q);
        const t = waterProbe(Q.x, Q.y, Q.z);
        if (t && (!lakeOnly || t === 3)) return null;
      }
    }
    let lo = 1e9, hi = -1e9;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      unitOf(F, x + a * hw, y + b * hd, Q);
      if (isWet(Q.x, Q.y, Q.z, 6)) return null;
      if (a !== 0 && b !== 0) { if (isWet.h < lo) lo = isWet.h; if (isWet.h > hi) hi = isWet.h; if (hi - lo > 9) return null; }
    }
    return { lo, hi, spread: hi - lo };
  }
  const push = (use, x, y, w, d, fx, fy, meta, r, extra) => {
    const [lat, lon] = llOf(x, y);
    const s = { use, lat, lon, heading: Math.round(bearing(fx, fy) * 1000) / 1000, w, d, meta: { basin: 'OX1-BL1', ...meta }, x, y, ...(extra || {}) };
    if (r && r.spread > 3) s.meta.pad = { level: Math.round((r.lo + r.hi) * 50) / 100, spread: Math.round(r.spread * 100) / 100, retaining: true };
    sites.push(s);
    taken.push([x, y, Math.hypot(w, d) / 2]);
    return s;
  };

  // ---- sluice stations at the outlet sluices ----
  const xs = [];
  for (let k = 0; k < (oc.sluices || []).length; k++) {
    const sl = oc.sluices[k];
    const [e, n] = F.enOf(sl.lat, sl.lon);
    const sx = e * F.X[0] + n * F.X[1];
    xs.push(sx);
    // gate line first (the station's gates stand where hydro steps the level); a narrower house on the levee crest
    // with a 2 m lake clearance where the lake reaches the gate (the sill)
    let best = null;
    for (const [dd, clr] of [[14, 10], [11, 2]]) {
      for (const along of [0, 8, -8, 16, -16, 24, -24, 32, -32]) {
        if (best && best.score < 0.15 * Math.abs(along)) break;
        for (const side of [1, -1]) {
          for (const gap of dd > 12 ? [3, 8, 16] : [2, 4]) {
            const y = side * (cw / 2 + gap + dd / 2);
            const r = foot(sx + along, y, 22, dd, clr, true, false);
            if (!r || r.spread > 9) continue;
            const score = r.spread + 0.04 * gap + 0.15 * Math.abs(along) + (side > 0 ? 0 : 0.2);
            if (!best || score < best.score) best = { score, along, side, gap, y, r, d: dd };
          }
        }
      }
      if (best) break;
    }
    if (!best) continue;
    const up = Math.max(+sl.upLevel, +sl.downLevel), dn = Math.min(+sl.upLevel, +sl.downLevel);
    // building +X = −side·x̂ (front normal side·ŷ): the upstream (higher) reach lies at −x̂
    const upSide = best.side > 0 ? 'right' : 'left';
    const meta = {
      canalId: oc.id, poolSide: 'back', canalOrder: oc.order || 0, controlRoom: 'upper', sluiceIndex: k,
      sluice: { up: Math.round(up * 100) / 100, down: Math.round(dn * 100) / 100, upSide, step: Math.round((up - dn) * 100) / 100 },
      water: { level: Math.round(up * 100) / 100, width: Math.round(cw * 10) / 10, dist: Math.round(Math.abs(best.y) * 100) / 100, flow: upSide === 'left' ? 1 : -1 },
    };
    // the house may stand beside the gate line on the downstream / upstream abutment: building-frame x of the hydro
    // gate line (+X = −side·downstream)
    if (best.along) meta.gateX = best.along * best.side;
    push('sluice_station', sx + best.along, best.y, 22, best.d, 0, best.side, meta, best.r, { sluice: true });
  }

  // ---- work tower beside the sill station (工务塔), on the station's bank behind the levee road ----
  const st0 = sites.find((s) => s.meta.sluiceIndex === 0);
  if (st0) {
    const side = Math.sign(st0.y) || 1;
    for (const dx of [60, 85, 110, 40, 135]) {
      const x = st0.x + dx, y = side * (cw / 2 + 11 + 4 + 8 + 4.5);
      if (!free(x, y, 7)) continue;
      const r = foot(x, y, 9, 9, 6, false, false);
      if (r && r.spread <= 3) { push('control_tower', x, y, 9, 9, 0, -side, { workTower: true }, r, { round: true }); break; }
    }
  }

  // ---- low utility town on the left bank (spine street y = 180, cross streets to the levee road) ----
  const SPINE = 180, CROSS = [400, 890, 1380];
  const nearCross = (x, w) => CROSS.some((c) => Math.abs(x - c) < w / 2 + 4 + 7);
  const rowSpecs = [
    // y-side of the spine, uses (cycle), front toward
    { y0: cw / 2 + 11 + 4 + 8, toward: -1, uses: [['maintenance', 24, 16], ['cold_storage', 40, 24], ['service_depot', 30, 20], ['water_treatment', 28, 20], ['maintenance', 20, 14], ['farm_station', 30, 20]] },
    { y0: SPINE - 4 - 6, toward: 1, uses: [['dorm', 30, 12], ['dorm', 28, 12], ['maintenance', 18, 14], ['dorm', 32, 12], ['service_depot', 26, 16], ['dorm', 30, 12]] },
    { y0: SPINE + 4 + 6, toward: -1, uses: [['dorm', 30, 12], ['dorm', 34, 12], ['farm_station', 28, 18], ['dorm', 30, 12], ['dorm', 26, 12], ['maintenance', 22, 14]] },
  ];
  let ti = 0, towerDone = false;
  for (let ri = 0; ri < rowSpecs.length; ri++) {
    const rs = rowSpecs[ri];
    let x = TOWN.x0 + 90 + ri * 17;
    let k = 0;
    while (x < TOWN.x1 - 30) {
      let [use, w, d] = rs.uses[k % rs.uses.length];
      k++;
      // the town's own work tower stands on the spine near the middle cross street
      if (ri === 2 && !towerDone && x > CROSS[1] + 12) { use = 'control_tower'; w = 9; d = 9; towerDone = true; }
      if (nearCross(x + w / 2, w)) { x += 16; continue; }
      const yc = ri === 0 ? rs.y0 + d / 2 : ri === 1 ? rs.y0 - d / 2 : rs.y0 + d / 2;
      const cx = x + w / 2;
      const r = free(cx, yc, Math.hypot(w, d) / 2) ? foot(cx, yc, w, d, 5, false, false) : null;
      const lim = Math.max(w, d) > 26 ? 4 : 3;
      if (r && r.spread <= lim) push(use, cx, yc, w, d, 0, ri === 0 ? -1 : ri === 1 ? 1 : -1, { town: 'OX1-BL1-T', levee: ri === 0 || undefined }, r, use === 'control_tower' ? { round: true } : null);
      x += w + 9 + ((ti++ * 7) % 6);
    }
  }
  // lake-shore row at the town's west end: backs to the lake (≥ 15 m from the water), fronts to the first cross street
  {
    const uses = [['maintenance', 26, 14], ['dorm', 30, 12], ['water_treatment', 28, 18], ['dorm', 28, 12], ['service_depot', 26, 16]];
    let q = 0;
    for (let y = 70; y <= 300 && q < uses.length; y += 46) {
      const [use, w, d] = uses[q];
      let placed = false;
      for (let xc = 250; xc <= CROSS[0] - 4 - 6 - d / 2; xc += 8) {
        if (!free(xc, y, Math.hypot(w, d) / 2)) continue;
        const r = foot(xc, y, w, d, 15, false, true);
        if (r && r.spread <= 3) { push(use, xc, y, w, d, 1, 0, { town: 'OX1-BL1-T', lakeShore: true }, r); placed = true; break; }
      }
      if (placed) q++;
    }
  }

  // ---- white maintenance houses along the levee roads (alternating banks, fronts to the levee road) ----
  let mi = 0;
  for (let x = 420; x < F.L - 120; x += 420) {
    if (xs.some((s) => Math.abs(s - x) < 170)) continue;
    const side = mi++ % 2 === 0 ? -1 : 1;
    if (side > 0 && x > TOWN.x0 - 60 && x < TOWN.x1 + 60) continue;
    const y = side * (cw / 2 + 11 + 4 + 7 + 7);
    for (const dx of [0, 40, -40, 80, -80]) {
      if (!free(x + dx, y, 13)) continue;
      const r = foot(x + dx, y, 20, 14, 5, false, false);
      if (r && r.spread <= 5) { push('maintenance', x + dx, y, 20, 14, 0, -side, { levee: true, canalId: oc.id, white: true }, r); break; }
    }
  }

  // ---- town streets (local, 8 m) ----
  const road = (id, pts) => roads.push({ id, cls: 'local', width: 8, pts: pts.map(([x, y]) => llOf(x, y)) });
  road('OX1T-spine', [[TOWN.x0, SPINE], [TOWN.x1, SPINE]]);
  for (let k = 0; k < CROSS.length; k++) road(`OX1T-x${k}`, [[CROSS[k], cw / 2 + 11 + 4], [CROSS[k], TOWN.y1]]);
  return { canalId: oc.id, sites, roads, town: TOWN };
}
