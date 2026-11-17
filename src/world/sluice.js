// Canal sluice gate rule (pure, worker-safe, no THREE / render imports). OWNER: water agent.
//
// sluiceOpen(upLevel, downLevel) -> true when the sluice / level step discharges (white water below its
// open gates, foam drawn by render/water/tiles.js), false when every gate is down (calm reach below:
// 停用闸孔下方的水比泄流口平静). Deterministic, the same at every LOD and on every thread; about 2/3 of the
// sluices discharge. Callers pass the two water levels of the step (m a.s.l.):
//   * render/water/tiles.js: the Float32 vertex levels of the canal reaches either side of the step;
//   * buildings-o (sluice_station.js): spec.meta.sluice {up, down} from urban (hydro waterAt levels in cm);
//   * hydro.canalsInTile sluice records {upLevel, downLevel} (D2: upLevel = upstream, higher).
// The levels are snapped to whole centimetres first (urban / hydro publish centimetres; a Float32 vertex
// level then rounds to the same centimetre), and the argument order does not matter (higher level first),
// so the renderer's foam and the station's gate leaves agree even for records written before D2.
// The hash input is the decimetre level pair (identical to the rule used up to fix round 1, so existing
// replicas — buildings-o sluiceDischarging — give the same answer).
import { hash4 } from '../core/hash.js';

/** fraction of the sluices that discharge */
export const SLUICE_OPEN_FRACTION = 0.66;

/**
 * @param {number} upLevel   water level on one side of the sluice (m; upstream = higher, D2)
 * @param {number} downLevel water level on the other side (m)
 * @returns {boolean} true = discharging (some gates open)
 */
export function sluiceOpen(upLevel, downLevel) {
  const a = Math.round(+upLevel * 100) / 100, b = Math.round(+downLevel * 100) / 100;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return hash4(Math.round(hi * 10), Math.round(lo * 10), 0x51c3, 0) / 4294967296 < SLUICE_OPEN_FRACTION;
}
