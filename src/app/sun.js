// Sun geometry (prompt: 太阳、昼夜和云层在世界坐标里统一求解). The planet frame is fixed; time of
// day moves the sub-solar point westwards. At solTime = 12 the sun is over longitude 0.
import { latLonToUnit } from '../core/geo.js';
const T = {};
export function subsolarPoint(solTime, subsolarLat) { return { lat: subsolarLat, lon: ((((12 - solTime) * 15) + 540) % 360) - 180 }; }
export function sunDirection(solTime, subsolarLat, out) {
  const s = subsolarPoint(solTime, subsolarLat);
  latLonToUnit(s.lat, s.lon, T);
  out.x = T.x; out.y = T.y; out.z = T.z;
  return out;
}
/** local solar time (hours) at longitude lon */
export function localSolarTime(lon, solTime) { return (((solTime + lon / 15) % 24) + 24) % 24; }
/** sol time (at lon 0) that puts local solar time `local` at longitude `lon` */
export function solTimeForLocal(lon, local) { return (((local - lon / 15) % 24) + 24) % 24; }
