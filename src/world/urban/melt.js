// OX4 北冠冰缘 — the plan's view of terrain-fn's meltwater system (hydro.iceFootSystem): outlets of the
// ice-marginal channel with their forebay pools (融水前池 = pump-station intakes) on the ice-cliff foot.
// §5 04 "把泵站放在稳固岩脚，进水池接冰崖脚下的水道，成排温室沿背风侧延伸": OX4 station settlements sit at
// the outlets (settlements.js), every outlet district gets a meltwater pump house with its intake on the
// forebay pool and a row of lee-side greenhouses (districts.js meltEnsemble). Pure, deterministic; the
// system is built lazily once per thread by hydro (≈ 0.2 s) and shared with the terrain's water carver.
import { R } from '../../core/constants.js';
import { latLonToUnit, enuBasisFromUnit, vecToFace } from '../../core/geo.js';
import * as hydro from '../hydro.js';
import * as FLD from '../terrain/field.js';
import { N0, S0, cell0Key } from './cells.js';

const STATION_OUT = 450;     // m: station settlement centre outward (away from the ice) from the pool edge
let OUT = null, BYCELL = null;
const VF = {};

/** outlet records [{id, x,y,z (pool centre unit), r, level, hdg, oe,on (outward east/north), sx,sy,sz (station point), cell}] */
export function meltOutlets() {
  if (OUT) return OUT;
  OUT = []; BYCELL = new Map();
  let S = null;
  try { S = typeof hydro.iceFootSystem === 'function' ? hydro.iceFootSystem() : null; } catch (e) { S = null; }
  if (!S || !S.outlets) return OUT;
  for (const o of S.outlets) {
    if (!o.pool || !Number.isFinite(o.pool.lat)) continue;
    const p = latLonToUnit(o.pool.lat, o.pool.lon, {});
    const E = enuBasisFromUnit(p.x, p.y, p.z, {});
    const a = (o.heading || 0) * Math.PI / 180, oe = Math.sin(a), on = Math.cos(a);
    const k = (o.pool.radius + STATION_OUT) / R;
    let sx = p.x + (E.east[0] * oe + E.north[0] * on) * k, sy = p.y + (E.east[1] * oe + E.north[1] * on) * k, sz = p.z + (E.east[2] * oe + E.north[2] * on) * k;
    const l = Math.hypot(sx, sy, sz); sx /= l; sy /= l; sz /= l;
    vecToFace(sx, sy, sz, VF);
    const cx = Math.min(N0 - 1, Math.max(0, Math.floor((VF.a + 1) / S0))), cy = Math.min(N0 - 1, Math.max(0, Math.floor((VF.b + 1) / S0)));
    const rec = { id: o.id, idx: OUT.length, x: p.x, y: p.y, z: p.z, r: o.pool.radius, level: o.pool.level, poolId: o.pool.id, hdg: o.heading || 0, oe, on, sx, sy, sz, cell: cell0Key(VF.face, cx, cy) };
    OUT.push(rec);
    if (!BYCELL.has(rec.cell)) BYCELL.set(rec.cell, rec);   // first (west-most) outlet of a cell hosts its station
  }
  return OUT;
}

/** the outlet whose station point lies in level-0 cell (face, cx, cy), or null */
export function outletOfCell(face, cx, cy) {
  meltOutlets();
  return BYCELL.get(cell0Key(face, cx, cy)) || null;
}

/** outlets whose pool lies within radius (m) of unit vector p */
export function outletsNear(x, y, z, radius) {
  const L = meltOutlets(), c = Math.cos(radius / R), out = [];
  for (const o of L) if (o.x * x + o.y * y + o.z * z >= c) out.push(o);
  return out;
}

/** band-limited OX4 ice-margin metric (km, > 0 on the ice; −1e9 far from the north cap) */
export function iceMarginQ(x, y, z, mw = 1500) {
  if (typeof FLD.northIceQ !== 'function') return -1e9;
  const lat = Math.asin(y < -1 ? -1 : y > 1 ? 1 : y) * 180 / Math.PI;
  return FLD.northIceQ(x, y, z, lat, mw);
}
