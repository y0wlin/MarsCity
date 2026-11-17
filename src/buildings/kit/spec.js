// BuildingSpec normalisation: every generator receives a spec with all fields present and
// sane, whatever the urban generator (or a dev bench) provided. Pure, worker-safe.
//
// Added derived fields (prefixed with _ so they never clash with urban.js fields):
//   _w, _d          footprint size (m) along building x / z
//   _floors         storeys above ground (>= 1)
//   _fh, _gh        typical storey height, ground storey height
//   _height         eave height (top of the last storey, excluding parapet)
//   _ground         {fl, fr, br, bl, min, max}: terrain heights RELATIVE to ground.entrance at the
//                   footprint corners (front-left, front-right, back-right, back-left)
//   _shared         {left, right, back} booleans
//   _entrances      [{kind, side, offset, width}] with at least a 'main' entrance
//   _lat            latitude (for daylight side), defaults 20

import { RES_FLOOR_H } from '../../core/constants.js';

// occupancy profile per use (src/world/occupancy.js profileOf when available; same table as fallback)
let OCC = null;
try { const m = import.meta.glob('../../world/occupancy.js', { eager: true }); OCC = m['../../world/occupancy.js'] || null; } catch { OCC = null; }
const USE_PROFILE = {
  residential: 0, residential_tower: 0, dorm: 0, shop_row: 0, office: 1, research: 1,
  station: 2, ferry_terminal: 2, market: 2, community: 2, civic_tower: 2, school: 2, clinic: 4,
  warehouse: 3, port_shed: 3, cold_storage: 3, farm_station: 3, service_depot: 3, pumphouse: 3, sluice_station: 3,
  water_treatment: 3, maintenance: 3, meltwater_pump: 3, insulated_station: 3, control_tower: 3, greenhouse: 3,
};
/** Occupancy profile (0 residential, 1 office, 2 public, 3 industrial, 4 care) for a use. */
export function occProfile(use) {
  if (OCC && typeof OCC.profileOf === 'function') { try { return OCC.profileOf(use) | 0; } catch { /* fall through */ } }
  return USE_PROFILE[use] ?? 0;
}

const SIDES = ['front', 'right', 'back', 'left'];

export function normalizeSpec(spec) {
  if (spec && spec.__normalized) return spec;
  const s = { ...spec };
  const fp = s.footprint || {};
  let w = +fp.w || 0, d = +fp.d || 0;
  if ((!w || !d) && Array.isArray(fp.points) && fp.points.length >= 3) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of fp.points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    w = x1 - x0; d = z1 - z0;
  }
  s._w = Math.max(4, w || 20);
  s._d = Math.max(4, d || 14);
  s._floors = Math.max(1, Math.round(+s.floors || 3));
  s._fh = clamp(+s.floorHeight || RES_FLOOR_H, 2.7, 7);
  s._gh = clamp(+s.groundFloorHeight || 0, 0, 9) || 0; // 0 = let the type decide
  s.hash = (s.hash >>> 0) || hashStr(String(s.id || 'b'));
  s._profile = occProfile(s.use);
  s._meta = s.meta || {};
  s._lat = Number.isFinite(+s.lat) ? +s.lat : 20;
  s.heading = Number.isFinite(+s.heading) ? +s.heading : 0;
  // ground relative to the entrance level
  const g = s.ground || {};
  const e = Number.isFinite(+g.entrance) ? +g.entrance : 0;
  const gmin = Number.isFinite(+g.min) ? +g.min - e : 0, gmax = Number.isFinite(+g.max) ? +g.max - e : 0;
  let corners = null;
  if (Array.isArray(g.corners) && g.corners.length === 4) corners = g.corners.map((v) => +v - e);
  if (!corners) {
    // no slope direction given: front at entrance level, back takes the larger deviation
    const back = Math.abs(gmax) >= Math.abs(gmin) ? gmax : gmin;
    corners = [0, 0, back, back];
  }
  s._ground = { fl: corners[0], fr: corners[1], br: corners[2], bl: corners[3], min: Math.min(gmin, ...corners), max: Math.max(gmax, ...corners) };
  const sw = s.sharedWalls || {};
  s._shared = { left: !!sw.left, right: !!sw.right, back: !!sw.back };
  // entrances
  let ents = Array.isArray(s.entrances) ? s.entrances.filter((x) => x && SIDES.includes(x.side || 'front')).map((x) => ({ kind: x.kind || 'main', side: x.side || 'front', offset: +x.offset || 0, width: +x.width || 0 })) : [];
  if (!ents.some((x) => x.kind === 'main')) ents.unshift({ kind: 'main', side: 'front', offset: 0, width: 0 });
  // never put an entrance on a shared wall
  ents = ents.filter((x) => !(s._shared[x.side]));
  if (!ents.some((x) => x.kind === 'main')) ents.unshift({ kind: 'main', side: 'front', offset: 0, width: 0 });
  if (!ents.some((x) => x.kind === 'service') && !s._shared.back) ents.push({ kind: 'service', side: 'back', offset: 0, width: 0 });
  s._entrances = ents;
  s.__normalized = true;
  return s;
}

/** Terrain height relative to entrance at building-local (x, z) (bilinear over the corners). */
export function groundAt(s, x, z) {
  const G = s._ground;
  const tx = clamp(x / s._w + 0.5, 0, 1), tz = clamp(z / s._d + 0.5, 0, 1); // tz=1 front
  const front = G.fl + (G.fr - G.fl) * tx, back = G.bl + (G.br - G.bl) * tx;
  return back + (front - back) * tz;
}

/** Compass bearing (deg) of a facade's outward normal. */
export function sideBearing(s, side) {
  const h = s.heading;
  const o = side === 'front' ? 0 : side === 'back' ? 180 : side === 'right' ? 270 : 90;
  return (((h + o) % 360) + 360) % 360;
}

/** 0..1 daylight score of a facade (1 = faces the equator-side sun). */
export function daylightScore(s, side) {
  const sun = s._lat >= 0 ? 180 : 0;
  const d = ((sideBearing(s, side) - sun + 540) % 360) - 180;
  return 0.5 + 0.5 * Math.cos((d * Math.PI) / 180);
}

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function hashStr(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
