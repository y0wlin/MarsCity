// Station ↔ track geometry shared by the station generator (types/station.js), the bench and —
// by request — the city (track bed) and props (trains) agents. Owner: buildings-z. Pure, no THREE.
//
// Urban placement (world/urban/parcels.js features()): the station building centre lies
//   off = (elevated ? RAIL.viaduct/2 + 4 : RAIL.corridor/2 + 6) + depth/2
// from the rail centreline, on the side `st.side`; the building front faces away from the track, so in
// the BUILDING FRAME the track runs along local x at z = −off (behind the back facade).
// D1 (fix round 1): urban supplies spec.meta.trackOffset (= −off, building-frame z of the centreline),
// railGround (rail bed level − ground.entrance), railHead (railGround + 0.35 at grade / + 9.0 elevated);
// they override the fallbacks below. Canonical numbers: STATION_GEOM.
//
// Assumed track layout (2 tracks, standard gauge 1.435 m):
//   track centres at ±TRACK_HALF_SPACING (2.0 m) from the rail centreline,
//   platform edge PLATFORM_EDGE (1.60 m) from the nearer track centre (≈ 2.9 m wide light-metro cars + gap),
//   rail head RAIL_HEAD_AT_GRADE (0.35 m) above the terrain at the track (ballast / slab track) or
//   ELEVATED_DECK (9.0 m, RAIL.elevatedHeight) above the terrain for viaduct lines,
//   platform top PLATFORM_HEIGHT (1.00 m) above the rail head  (0.9–1.1 m metro platform).

export const STATION_GEOM = {
  CORRIDOR: 16,             // at-grade 2-track corridor width (urban RAIL.corridor)
  VIADUCT: 11,              // elevated deck width (urban RAIL.viaduct)
  ELEVATED_DECK: 9.0,       // rail head above terrain on viaducts (urban RAIL.elevatedHeight)
  RAIL_HEAD_AT_GRADE: 0.35, // rail head above terrain at grade
  TRACK_HALF_SPACING: 2.0,  // track centre offset from the rail centreline
  PLATFORM_EDGE: 1.6,       // platform edge offset from the track centre
  PLATFORM_HEIGHT: 1.0,     // platform top above the rail head
  GAUGE: 1.435,
};

/**
 * Track / platform geometry of a station spec in its building frame.
 * spec: normalized (kit/spec.js) or raw BuildingSpec with meta.elevated. Returns
 * { elevated, zTrack (centreline z), zNear (near track centre), zFar, zEdgeNear (near platform edge),
 *   zEdgeFar, railY (rail head y, building frame), platY (platform top y), groundTrack (terrain y at the track) }
 */
export function stationTrack(spec) {
  const G = STATION_GEOM;
  const meta = spec._meta || spec.meta || {};
  const d = spec._d || (spec.footprint && spec.footprint.d) || 26;
  const elevated = !!meta.elevated;
  // meta.trackOffset (urban, D1) = building-frame z of the track centreline (NEGATIVE: behind the back
  // facade). A positive value is accepted as the distance (older specs / benches): zTrack = −|trackOffset|.
  const t0 = meta.trackOffset != null ? +meta.trackOffset : NaN;
  const off = Number.isFinite(t0) && Math.abs(t0) > 1e-6 ? Math.abs(t0) : (elevated ? G.VIADUCT / 2 + 4 : G.CORRIDOR / 2 + 6) + d / 2;
  const zTrack = -off;
  const zNear = zTrack + G.TRACK_HALF_SPACING, zFar = zTrack - G.TRACK_HALF_SPACING;
  // terrain at the track: explicit meta.railGround (relative to entrance) or extrapolated from the corners
  let groundTrack;
  if (meta.railGround != null) groundTrack = +meta.railGround;
  else {
    const g = spec._ground || { fl: 0, fr: 0, br: 0, bl: 0 };
    const front = (g.fl + g.fr) / 2, back = (g.br + g.bl) / 2;
    const slope = (back - front) / Math.max(d, 1);           // per metre towards −z
    groundTrack = back + Math.max(-0.25, Math.min(0.25, slope)) * (off - d / 2);
  }
  const rh = meta.railY != null ? +meta.railY : meta.railHead != null ? +meta.railHead : NaN;
  const railY = Number.isFinite(rh) ? rh : groundTrack + (elevated ? G.ELEVATED_DECK : G.RAIL_HEAD_AT_GRADE);
  return {
    elevated, off, zTrack, zNear, zFar,
    zEdgeNear: zNear + G.PLATFORM_EDGE, zEdgeFar: zFar - G.PLATFORM_EDGE,
    railY, platY: railY + G.PLATFORM_HEIGHT, groundTrack,
  };
}
