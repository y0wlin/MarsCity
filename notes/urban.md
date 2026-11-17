# urban — deterministic city & land-use plan — progress log

Owner files: src/world/urban.js, src/world/urban/*, src/world/occupancy.js, scripts/preview-urban*.mjs,
scripts/check-urban*.mjs. Took over from urban-fn (no notes/urban-fn.md existed; previous reports in
shots/urban-fn/check-report.json). Private port 5205. Shots: shots/urban/. Scratch: $SCRATCHPAD/urban/.

## Fix round 1

Started 2026-11-16 05:00 (load avg ~1). Items from the lead (★ first):
- ★1 station meta railGround / trackOffset; ferry_terminal waterSide / pierHeading; port_shed quaySide
- ★2 water-facing utilities meta.water {level,width,dist,flow}; meta.sluice {up>=down, upSide}; servesSide
- ★3 reject / level steep utility sites (corner spread <= ~3 m, or levelled pad flagged in meta)
- ★4 ZR2 canyon walls: coverage/cls = 0 on steep canyon faces
- ★5 OX4 settlements / meltwater pumps / greenhouse rows at the ice-cliff foot; S04 viewpoint
- 6 100 km mosaic contrast; 7 night classes (A02 structure); 8 generateCityTile cold cost

### Log
- 05:00 read ARCHITECTURE, prompt §5/§6, notes of terrain-fn / buildings-o / buildings-z / city /
  props / terrain-render; read all of src/world/urban/*.
- 05:05 baseline survey (scripts/check-urban-sites.mjs → shots/urban/sites-before.json): OX1 sluice stations
  34 / 32 m corner spread, levels reversed (115/163), FRONT facing the canal although meta.poolSide='back'
  (genSite flipped the normal); ZR2 sample 2625 bldgs: 226 residential with spread > 6 m, 154 with slope > 0.8
  (max spread 119 m: houses on the canyon risers).
- 05:10 ★1 DONE: corridors.js railBedGround / stationRailLevel: tile rails polylines are LEVEL over the
  longest platform (main ±130 m, normal ±95 m, halt ±20 m) + 180 m smoothstep ramps; stations[].y on that
  level; BuildingSpec.meta.railLevel (abs m), railGround (= railLevel − ground.entrance), trackOffset
  (building-frame z of the track centreline, NEGATIVE = behind the back facade; tracks at trackOffset ± 2.0),
  railHead (railGround + 0.35 at grade / + 9.0 elevated). Ex. S9ruz39h.4: railGround −0.19, trackOffset −27.5.
  Port sheds were placed with the quay apron on the LANDWARD side (frame normal sign) → fixed: front (quaySide
  'front') now faces the water (ZR5: frontWet 5/15, backWet 0; before 0/28 vs 5/28). Ferry: waterSide back OK.
- 05:15 ★2/★3: districts.js waterSite(): sluice stations / junction pump houses with the BACK on the canal,
  candidates on both banks × 3 gaps (laterals: bank without the levee road first), corners clear of every canal
  (geometric) + exact hydro test of the winner, corner spread ≤ 3 m (≤ 5 m → meta.pad {level, spread,
  retaining}), else no station. meta.water {level, width, dist, flow}, meta.sluice {up ≥ down, upSide, step}
  from hydro probes on both sides of the gate (fallback: record + heading). Junction heads placed before the
  sluices (77/114 heads now have a pump, before ~0). finalize: O utilities need spread ≤ 3 m (≤ 4 m > 26 m).
  Greenhouse-row head pumps: meta.servesSide 'right'.
- 05:20 ★4: districts.slopeAt (8 m / 32 m lazily evaluated height lattices per district) → canyon districts
  (D.canyon, ZR2): buildings rejected at fine slope > 0.65 (builders.finalize), blocks centred on slope > 0.65
  inactive (parcels), urbanSample L2/L3 fabric fades sstep(0.5, 0.8, slope) to NATURAL / coverage 0 (rails and
  corridor roads kept), L1 canyon districts × 0.76 fabric. ZR2 sample: spread > 6 m 226 → 7, slope > 0.8 154 → 0.
- 05:25 ★5: terrain-fn published hydro.iceFootSystem() (icefoot.js: cliff-foot line, foot channel, outlets with
  forebay pools). urban/melt.js indexes the outlets; OX4 settlement candidates of a cell holding an outlet's
  station point (pool + r + 450 m outward) become stations (rank 0.9+), other OX4 candidates within 40 km of
  the margin are suppressed; every district holding a forebay pool → meltEnsemble: meltwater pump house (back =
  intake on the pool, 8 m bank, meta.water {level, width = 2r, dist, flow, pool}, serves 'greenhouses',
  servesSide) + 4–7 lee-side greenhouse halls (11 m span) along the pool flank; old scattered meltwater
  outposts removed. 13 stations at outlets, 0 settlements elsewhere within 40 km of the foot; 50/53 outlets
  with pump (most with 4–7 halls). scripts/preview-urban-ox4.mjs lists them + S04 poses (shots/urban/ox4-outlets.json).
- 05:27 check-urban roundtrip 1000/1000 identical, determinism OK. Build OK (.build/urban), preview on 5205.

- 05:40 item 8: generateCityTile(face, x, y, {buildingsOnly:true}) → buildings + stations only, identical
  buildings, CPU 609/477 ms vs 1154/889 ms for 12 dense ZR1 tiles (urban caches cleared, lower layers warm);
  stats.msBlocks / msStreets / msRails added (blocks dominate: layouts + full-detail ground corners).
  Cold dense tile in a fresh process: 0.7 s CPU (wall 18 s at load 160 → wall time is load, not urban).
- 05:42 item 6: roof palette regions from a smooth 16 km field (+small jitter) instead of per-district hash;
  district tone hash ±0.05 (was ±0.16); L1 palette pulled 45 % to the regional mean; toneGrain (4.2 km +
  1.7 km, ±~9 %) applied consistently at L1 / L2 block colours / L3 roofs. Item 7: L1 PORT districts get a
  cold-white quay band along the shore (lineFrac of coastM, LIGHT_TEMP port), rest of the port × 0.7;
  O-zone water works / insulated stations lit all night from above (0.75, cold).
- 05:44 canyon streets: wetSplit cuts grid streets / levee roads at fine slope > 0.8 (never bridged),
  arterials split into gentle spans (≥ 30 m) → no roads climbing the risers. Node map
  shots/urban/fix1-canyon-map-after.png (6 km, 20 m texels): 84 % built, 10 % steep, 8.8 % of steep texels
  with fabric > 0.3 (riser edges).
- URBAN_VERSION urban-2.0.0 → urban-2.1.0. S07 building ZR1-0.3.1a5.17w-n8.n6-7 unchanged (residential).
- 06:00 app shots (port 5205, load avg 40–160, not idle after 200 s, 0 console errors):
  shots/urban/fix1-zr2-canyon-9km.png (34.80N −105.24, 4 km alt, N, −17°, 35 mm): red riser bands bare,
  terraced housing on the benches. shots/urban/fix1-s04-mo45b.png / fix1-s04-mo32.png: pump house (yellow hoist)
  on the forebay pool + greenhouse row at the foot of the ice cliff, water in front. The cliff renders as tan
  rock with vertical texture streaks and the pool banks as striped walls (terrain-render look, not urban).
  Lead's bad examples OX1-0.2.ix.gl-n5.n8-2 / -n4.n5-0 → null (no dry ≤ 5 m bank at those sluices).
- Feeder pumps of greenhouse rows: servesSide 'right' (rows at +x; verified against the hall positions with
  the ARCHITECTURE axis convention +X = (−cos h, sin h) east/north).

### Verification summary
- 06:31 final check-urban (all changes): roundtrip 1000/1000 identical (922 unique ids), determinism identical
  (check now ignores the new stats.ms* timing fields), lazy vs full corridor links 40/40 identical.
  Changed areas: ZR2 1/13/2708/7360 (133 bldgs), OX4 MO-45 2/13/5303/3190 (8), OX1 0/13/5453/4785 (2):
  deterministic + every building round-trips. urbanSample smoke (9 sites × 7 texel sizes): no NaN / throw.
- check-urban-sites.mjs before/after (shots/urban/sites-before.json, sites-after2.json).
- Node maps: shots/urban/fix1-canyon-map-after.png, fix1-ox4-mo45-map.png; OX4 table shots/urban/ox4-outlets.json.

- 06:56 final build OK (.build/urban); preview server 5205 stopped; scratch deleted. A refined S04 frame
  (heading 29, 50 mm) never got a browser slot (2-slot semaphore saturated 06:05–06:55) → not shot.
  Recommended S04 (verified frame fix1-s04-mo45b.png): pose 73.61413,53.32391,426.5,36.5,6,55,
  solTime = local(53.32, 8.0) = 4.445 (MO-45 forebay pool: meltwater pump OX4-2.3.10t.m5-3.0-0 + 7 halls,
  station settlement 450 m outward). Recompute after terrain-fn's final iceFootSystem with
  node scripts/preview-urban-ox4.mjs (prints a pose per outlet).

### Remaining / known
- hydro sluice steps up to ~50 m (terrain-fn normalisation pending) → meta.sluice.step reports them.
- canyon slope lattice adds ~10 µs/texel cold in ZR2 canyon districts only (L13 5 m texels: 41 µs cold / 11 µs warm).
- item 7 at orbit (L0): O-zone sluice white dots are not in the L0/L1 expectation (sites need D2).

### Requests (to other modules)
- buildings-o: (1) water works now carry meta.water {level (m a.s.l.), width, dist (centre → canal centreline /
  pool centre), flow ±1 along +x, pool?} and sluice stations meta.sluice {up (always the HIGHER level), down,
  upSide 'left'|'right' (building frame), step}; the pool / canal is really behind the back facade now (it was in
  FRONT before: genSite flipped the normal). (2) meta.pad {level, spread, retaining:true} on banks with 3–5 m
  corner spread: please draw a levelled pad with retaining walls. (3) OX4 outlet pumps have intakeSide 'back'
  AND serves 'greenhouses' + servesSide: please also run the feeder mains to servesSide in the 'melt' variant
  (the halls stand beside the pump on that side, 12 m gap, 11 m span, 3.5 m apart). (4) OX4 greenhouses with
  meta.lee:true: back (−z) faces the ice / foot channel — a windbreak / snow fence there would read well.
- buildings-z: station specs now have meta.railGround / trackOffset / railHead / railLevel (D1, see ARCHITECTURE
  §5 urban). Port sheds: quaySide 'front' now really faces the water (the quay apron was on the landward side).
- city: rails polylines are level over each station's platform zone (+ramps) and stations[].y sits on it. Far
  mass-only tiles can call generateCityTile(f, x, y, {buildingsOnly:true}) (≈ ½ CPU, identical buildings).
- props: nothing required (trains follow the polylines; stations[].y = level rail bed, rail head = y + 0.35).
- lead (bookmarks.js): new S04 pose — see the fix-1 report (OX4 outlet ensembles at hydro.iceFootSystem
  outlets; the old S04 point 73.575N 51.10E looks at empty frost plain).
- terrain-fn: OX1 lateral sluices still measure up to ~50 m single steps on the water (median ~11 m); the plan
  reports them as measured (meta.sluice.step) — please normalise to ≤ 14 m as planned. The OX4 stations follow
  the iceFootSystem outlets, so keep outlet ids / pools stable once final.

## Fix round 2

Started 2026-11-16 12:16 (load avg ~130). Private port 5301, build dir .build/urban, shots shots/urban/fix2-*.
Items (★ first): ★U1 G01 protected port city, ★U2 long bridges (DB: bridge records + urban.bridgesNear), ★U3 waterfront
program (ferry terminals every 2–5 km, promenade, front-row public buildings, towers rising inland), ★U4 orbit night
structure (DN: lightPort, rural dots only at settlements), ★U5 ZR2 canyon terraces on treads; U6 green-belt width cap in
cores; U7 OX1 S03 (canal-following field edges, levee towns, pumps on real canals); U8 small plots (office/civic);
U9 residential_tower meta.height; U10 L1 vs L2 park/belt agreement + 41 m brightness; U11 station rail-bed never a cut;
U12 river corridors; U13 OX4 no open farm strips north of 70N.

### Log
- 12:16 read ARCHITECTURE, prompt §5/§6, qa-round1 (QS-02/05/07/10, QY-03/05/06/07, QA-ID-03), round2.md, all urban/*.
- 13:45 ★U1 done in the plan: urban/harbour.js (G01 overlay: shore distance to the designed bay shore, 5 centres
  west/headW/head/headE/north with peaks 32/46/60/38/24 storeys, waterfront band T, side cargo|inner|west), envZ max()
  with the overlay (orbit L0, corridors, D1 all agree), cell (0,241,130) candidate = harbour city at the 'head'
  centre (0.6275N 129.9795E, city r≈4 km → main station + metro links; the old plateau town 0.745N 129.999E of that
  cell is now the 'north' low-rise centre — its districts re-planned), D1: waterfront band <950 m → PORT (east cargo
  flank) / MID-CORE waterfront, port backland LOGISTICS, no industry/parks/rural inside the ring, peakFloors caps.
- ★U2 bridges: urban/bridges.js (types/deck), corridors segment.bridges records, citytile rail / corridor-road /
  arterial pieces carry bridgeId/bridgeType/bridgeSpan/clearance/pylons[{t,h,shape,base,baseR}]/bridgeS, G01 inner-bay
  cable-stayed bridge BG01 (A-pylons 128 m on 70 m islands, main span 660 m, deck 33→53.5→62 m, span 5.3 km of water),
  urban.bridgesNear(lat, lon, r) (bridgequery.js). Over water the bridge wins over the metro 'elevated' flag.
- U8/U9 in builders (offices only on ≥12 m short sides, civic ≥36 m or ≤3.5·w storeys, tower height own fh).
- 13:20–13:45 ★U3: waterfront districts (coastal ring test OR terrain water on rings at 0.6/1.05·size: the coast metric
  misses many terrain shores, e.g. ZR5 35.3S) get front-row public blocks (waterfrontUse: park / market / community /
  shop rows / plaza / clinic / school), heights rising inland (Builder.hk from rasterCoast), shaded promenade
  (districts.promenadeOf: 24 m inland of the exact waterline, road cls 'promenade', covered, canopy 'shade'; buildings
  kept 8 m clear), up to 3 ferry terminals per district ≥ 2 km apart (G.ferries; ferry blocks allowed on steep
  shores). ZR5 port share 0.95 → 0.6 (cargo bays vs residential side bays). G01 harbour shore: 5 ferry terminals.
- ★U4: urbanSample.lightPort (L3 piers/quays 1, container yards 0.8; L2 piers / port-shed blocks; L1 PORT quay band
  widened to the texel; L0 province port share × envelope near the coast) — ZR5 quay lp 1.0 at 2–5 km texels, 0.53 at
  9 km (was light 0.001); L0 rural / greenhouse / O-town light × kRural(T) (dark between settlements), L1 non-node
  rural × 0.12; L0 cores / L1 station glow warm (temp 0.28 / 0.34).
- ★U5: canyon blocks live when ≥ 3/9 points are tread (slope < 0.45 @32 m) instead of the centroid test; no green
  belts in terraced (canyon) districts (the S06 slope district was 71/125 GREENBELT blocks!); GEN[TERRACE] canyon variant
  terraceCanyon(): houses slide ±6 m in their row band to a tread fit (rectSlope ≤ 0.5), meta.retaining 'back',
  walkway 'front'. S06 wedge (34.8905,−105.286, hdg 245 ±24°, ≤ 3.5 km): buildings 1146 → 2870 (on treads 1124 →
  2842), tread roof cover 9 % → 16 %. Shot shots/urban/fix2-s06-day.png.
- U6: greenBelt(…, capM): half-width cap 320 m (+4.2 km·(1−dense)) via the local noise gradient, dense =
  sstep(0.4, 0.7, district env); L0/L1/L2 all use it; no belts in the harbour city. U10: L1 belt edge softness in
  metres (~t/2) so district texels put the edge where the blocks are; BU_STATS.cov re-calibrated against ~730 real
  layouts (ZR1 core 1.2 km: coverage 0.245 → 0.20 vs exact 0.19; mean albedo 41 m vs 20 m +8 → +6 sRGB; 41 = 82 m).
- U7: FARM blocks live when any corner is irrigated; field pieces kept only within a smooth reach field
  (parcels.farmReach, 1.5 km grain), last 150 m fallow, beyond red earth (L2 uses the same farmIrrigated);
  levee hamlets (dorm / maintenance / farm_station / cold_storage sites) beside every other sluice station of farm
  districts; greenhouse feed pumps only on a canal (waterSite → meta.water) else a dry 'maintenance' distribution shed.
- U11 station level = highest ground of the levelled zone, railBedGround never below gh. U12 nearRiver(half width
  + 15 m) in finalize. U13 L0 farmland off north of 70N. U8 floors ≤ 0.9·short side on strip plots.
- check-urban (code of 13:20): roundtrip 1000/1000 identical, determinism identical. S07 building unchanged.
- 13:45–14:00 designated cable bridges (citytile designatedBridges): BG01 (G01 inner bay) + BZ5 (ZR5 2.3 km channel at
  38.35S 103.18E, H-pylons 165 m, main span 640 m, clearance 52 m); corridor crossings > 3 km stay 'girder'. ZR4: 127
  inter-island cable-stayed rail bridges + 4 girders near 8N 165E (bridgesNear 60 km scans); ZR1: BG01 (+1 girder).
  Utility-block pump houses only on a canal (else maintenance): S03 area pumphouses 22 → 1 (all with meta.water).
  S03 area (7.0–7.55N, 104.6–105.15E, 420 sampled tiles): dorm 757, maintenance 288, farm_station 24, cold_storage 1.
- Shots (port 5301, load 40–150, never idle): fix2-s05-g01c.png (recommended S05: harbour city skyline across the bay;
  the bridge needs city's DB renderer), fix2-g01-harbour-420m.png, fix2-s09.png (city band behind the barrier),
  fix2-s06-day.png (terraced housing on every tread of the far slope, red risers between).

### Requests (round 2)
- city: render long bridges from the DB fields (bridgeType cable / arch / girder, pylons {t on THIS piece, h, shape,
  base 'island', baseR}, bridgeS [sa, sb, length] to stitch pieces across tiles, clearance, archRise); designated
  BG01 / BZ5 come as cls 'boulevard' pieces (land approaches `bridgehead: true`); ZR4 rail bridges are rails pieces.
  New road cls 'promenade' (width 12, covered, canopy 'shade', waterSide 'sea'): a shaded walkway with canopy.
- terrain-render: urbanSample.lightPort → short cold-white point rows at orbit / region scales (DN); background
  rural light is now ~0 between settlements (O-zone dark gaps), cores warmer (lightTemp ≈ 0.28–0.34).
- props: ferries between the new ferry terminals (docks kind 'ferry'; G01 harbour has 5: 0.5737N 129.9765E bay head,
  0.5730N 129.9135E, 0.5562N 129.8844E, 0.5241N 129.8581E, 0.5549N 130.0047E) and a ferry crossing the S05 frame.
- terrain-fn: the G01 harbour shore is a 25–60 m vertical cliff within 20 m of the water (bay head bench 42 m, west
  60–90 m, east 24–30 m): a quay apron at +2–4 m along harbour.shore (300–600 m wide, ramping up to the plateau)
  would put the cargo quays, ferry terminals and promenade at the water. ZR2 has no inner gorge near S06 (floor
  ~1.3 km wide at ~960 m, river at grade): urban has the 'arch' type ready for 80–650 m gorge spans.
- lead (bookmarks.js): S05 → pose 0.48653,129.94351,24,14,0.5,45, solTime 6.84 (local 15:30). Alternative S05b (ZR5
  channel, BZ5 mid-ground): -38.3725,103.18,24,0,0.5,50, solTime 8.62. S06: keep 34.8905,−105.286,1135,245,−4,40.
- 14:05 final: check-urban roundtrip 1000/1000 identical + determinism identical (all changes); targeted roundtrip (G01 harbour, ZR2 canyon, ZR5 waterfront, OX1 levee, BZ5, S07) 1511/1511 identical with cleared caches; urbanSample smoke 143 samples no NaN; bridge pieces well-formed; build OK (.build/urban); preview 5301 stopped. URBAN_VERSION urban-2.2.0.

## Fix round 3

Started 2026-11-16 18:47 (load avg ~36). Private port 5302, build dir .build/urban, shots shots/urban/fix3-*.
Items (★ first): ★U1 OX1 basin program (sluice stations at the 3 OX1-BL1-OUT sluices, levee roads, white maintenance
houses, low utility town along the outlet canal + SW lake shore, nothing in the lake / on cliffs); ★U2 G01 skyline (>= 3
centres with clearly different peaks 60–80 / 35–45 / 20–28 floors, mid-rise 6–12 between with gaps, low front row; ids
outside the G01 overlay unchanged); ★U3 OX4 farm strips off north of 70N (greenhouses stay), G02 farm parcels on the new
irrigated plain + R2–R6 bench terraces; U4 ZR5 ferry terminals every 2–5 km on dense shores; U5 QY-03 no office/civic on
short side < 12 m anywhere, QY-05 farm edges follow field blocks along canals (no staircase).
Browser budget: ONE browser machine-wide (slot cap 1) → Node checks first, 2–3 app shots max.

### Log
- 18:47 read ARCHITECTURE, prompt §5/§6, qa-round2 (urban-relevant: QY-03 partly → narrow plots now residential, QY-05
  staircase edges, QY-06/07 fixed in data), terrain-fn round 2 requests (basin, DD, G02).
- 19:00–20:05 ★U2 G01 skyline: harbour.js HARBOUR_SKYLINE + skylineAt (storey caps only; the round-2 centres keep driving
  w / env / T, so the district plan, settlements, corridors do not move): crown CBD at the main station (U 150, V −9600,
  78 storeys spike over a 35–55 cluster), eastTowers 44 (U 1500, V −8900), westTowers 28 (U −1040, V −7400, nearer the bay),
  west 22, north 14; mid-rise base 6–12 (lower toward the bay), front row ≤ 4–5 storeys (ramp 110–500 m, clusters from
  700–1500 m). parcels.harbourUse: tower blocks only where cap ≥ ~18 (else PERIMETER/MIXED/SLAB), plain blocks inside a
  cluster become towers (crown: podium towers, east: podium+park, west: park towers), crown point → TOWER_PODIUM 'big'.
  builders: B.sky cap inside the overlay (fillStrip corner boost capped, CIVIC capped at the cap), outside the overlay the
  round-2 D.peakFloors (+12 civic) unchanged. New Node tool scripts/preview-urban-skyline.mjs (flat-shaded skyline render
  from a pose + per-cluster stats): S05 before shots/urban/fix3-skyline-before.png (even wall, 485 towers > 35 F), after
  fix3-skyline-v4.png: crown 78 F (centre, between the bridge pylons), east cluster 43 F (right third, above the plateau
  line), west cluster 27 F (left), mid-rise ≤ 13 between, front row max 7 / median 3.
- 20:05–20:35 ★U1 OX1 basin programme: new urban/basin.js (global basin frame at the sill: x downstream, y left bank):
  sluice stations at the outlet sluices (gate line first, house on the downstream abutment when the embankment steps at the
  gate: meta.gateX = building-frame x of the hydro gate line), work towers, 17 white maintenance houses along the levee roads,
  low utility town (3 rows + lake-shore row, spine street + 3 cross streets 'OX1T-*') on the left bank below the sill; farm
  blocks under the town unplanted; fields cut around every district site (+8 m); buildings on canal water rejected; outposts
  never on (lake) water. scripts/check-urban-basin.mjs (map + wet / steep checks). SILL STATION NOT PLACEABLE: hydro
  classifies the outlet reach 20–120 m below the first sluice and both banks as lake 'OX1-BL1' (type 3, level 150; ground
  141–145) and the levee crest at the gate is only ~8 m wide → request to terrain-fn (basin.js retries automatically).
- 20:35–20:50 ★U3: north of 70N already clean (10836 samples: fields.farm 0, urbanSample farm 0 at 160 m–9 km texels; 81
  OX4 outlet tiles: 0 field areas, 416 greenhouses). G02: districts.g02FarmIn (sample net over the cell) → FARM class for
  WILD/OUTPOST cells reached by the plain district (with fields.farm) or the R2–R6 bench belt; bench blocks exempt from the
  slope limit, irrigated, parcels as long contour bands 14–22 m deep. Terrace belt: urban farm 2/110 → 86/110 samples;
  plain: urban farm 93 vs fields.farm 112 of 508 samples (87 agree; rest OTOWN ground / fallow edges).
- 20:35–20:50 U4 ZR5 shores: sea-seeded front-row districts of the ferry provinces search their land side on rings 0.25 /
  0.6 / 0.8 (after the old 0.45 ring) → waterfront districts; ZR5 PORT districts turn their central cargo berth into a ferry
  terminal; ZR5 INDUSTRIAL shore districts (terrain-shore ring test, D.shoreFerry) get one landing (no promenade). Dense ZR5
  shore samples (box −39…−34.5, 101…107E, 51 samples ~2 km apart) farther than 2.5 km from a terminal: 18 → 2.
- 20:50 U5: podium tower plates ≥ 14 m (QY-03: 1147 office / civic in 150 dense tiles of 6 areas, 0 with a side < 12 m);
  QY-05: field strips cut along their axis where the reach ends (12 m steps): shots/urban/fix3-farmedge-s03.png (6 km,
  25 m px: smooth farmland / red-earth edges following the canals, no strip staircase). New tools:
  scripts/preview-urban-farmedge.mjs, scripts/check-urban-diff.mjs (baseline tree diff of tiles).
- 20:45 build OK (.build/urban), preview 5302 up; app shots S05 + OX1 town queued on scripts/slot.mjs (both slots busy:
  qa2-shots since 18:47, props since 20:39; load 150–170).

### Requests (fix round 3)
- terrain-fn: the OX1-BL1 lake mask spills over the outlet main below the FIRST sluice (7.3054N 104.9187E): 20–120 m
  downstream the canal and both banks are lake type 3 (level 150, ground 141–145), and at the gate line the dry levee crest is
  only ~8 m wide (26–30 m from the centreline, lake beyond 34 m) → no dry abutment for the sill sluice station. Please end
  the lake at the sill sluice (clip the lake mask at the gate / raise both abutments to ≥ 151 m, ≥ 20 m deep for ~60 m
  around the gate line). urban/basin.js retries the gate line automatically (no urban change needed). Sluices 2 / 3: the
  embankment crest steps 9 m exactly at the gate (no level ground across the gate line) → the stations stand 16 m beside
  the gate on the abutment (meta.gateX).
- buildings-o: sluice_station `meta.gateX` (m, building-frame x of the hydro gate line; default 0) — draw the gate
  structure / leaves / deck at that x (the house stands on the abutment beside it); basin town uses `service_depot`,
  `water_treatment`, `control_tower` (work tower, `meta.workTower`), `maintenance` with `meta.white` (white render welcome).
- water: render/water/sluicejet.js replicates gateLayout — apply the same `meta.gateX` offset (jets on the hydro sluice).
- props: nothing (new ZR5 ferry terminals come through district2().ferries / docks kind 'ferry').
- lead (bookmarks.js): S05 keeps its pose (three clusters now in frame: crown between the BG01 pylons, 44-storey cluster
  right, 28-storey cluster left). Optional OX1 town / sluice frame: pose 7.27295,104.88900,347,45,-8,35, time 3.0.

### Verification (fix round 3)
- URBAN_VERSION urban-2.2.0 → urban-2.3.0. vite build OK (.build/urban).
- Targeted roundtrip (final code, caches cleared): 136/136 buildingSpecById == tile spec over G01 crown / east cluster, OX1
  basin town / sluice, G02 terraces, ZR5 port / industrial shores, S07 (scratch rt.mjs); determinism identical in all 8
  areas. S07 building ZR1-0.3.1a5.17w-n8.n6-7 identical to round 2 (version field aside).
- Baseline diff (scripts/check-urban-diff.mjs vs a round-2 copy of the tree): G01 ring 9–16 km round the head centre, 239
  tiles: 207 identical, 32 changed — all changes in harbour-overlay blocks (5 buildings in 2 tiles lie just outside w > 0 in
  blocks whose centre is inside); 12 O-zone farm tiles away from the basin / G02 (OX1/OX3/OX5): 12/12 identical.
- Basin (scripts/check-urban-basin.mjs, 168 tiles, r 3.8 km): all 52 programme sites in the tiles (2 sluice stations,
  17 maintenance, 23 dorm, 6 service depots, 2 water treatment, 1 farm station, 1 work tower), 0 buildings on water / lake,
  0 on steep ground (corner spread > 6 m, > 9.5 m with pad), 26 levee-road pieces on the outlet main, 9 town street pieces.
  Map shots/urban/fix3-ox1-basin-map.png.
- Skyline S05 (Node render, 16 km): shots/urban/fix3-skyline-after.png — crown 78 F (39 towers > 35 F), east cluster 43 F,
  west cluster 27 F, mid-rise max 13 F, front row (ds < 250 m) max 7 / median 3 (before: one even wall, 485 > 35 F).
- IDs changed: G01 harbour-overlay blocks (skyline uses / caps); OX1 district 0.2.ix.gl (basin programme sites, town blocks,
  outlet sluices) and any O-zone block where a building stood on canal water; G02 districts that became FARM; ZR5 coastal
  districts whose seed lies in the water (new land plan), ZR5 PORT districts (central berth → ferry block) and ZR5 INDUSTRIAL
  shore districts (+ ferry block). Podium towers everywhere: meta.tower w/d ≥ 14 m (ids unchanged).
- check-urban roundtrip 1000/1000 identical (911 unique), determinism identical (run on the 20:42 state; the final code
  is covered by the targeted roundtrip above).
- App shots (port 5302, build of the final code, one browser via slot.mjs, load 150–170, not idle after ~250 s, 0 console
  errors / page errors): shots/urban/fix3-s05.png (lead's S05 pose: crown CBD between the BG01 pylons, 44-storey cluster
  right, 28-storey cluster left in front of the hillside, mid-rise between, low front row; ferry + wake in front) and
  shots/urban/fix3-ox1-town.png (pose 7.27295,104.88900,347,45,-8,35, time 3.0: outlet main from the lake, sluice station
  with open-bay foam at sluice 2, white maintenance houses + tree-lined levee roads, low utility town with work tower on the
  left bank below the sill, lake-shore row, tablelands behind).
- 21:06 preview 5302 stopped; no browsers / servers of mine left.

### Known / remaining (fix round 3)
- Sill sluice station missing until terrain-fn ends the lake at the first sluice (see Requests); the two placed stations
  stand 16 m beside their gate lines (meta.gateX) until buildings-o / water honour it.
- The town stands on bare ground (its farm blocks are unplanted → natural terrain colour, reads as a red-earth rectangle
  among the fields from the air); yards only round each building.
- S05 west cluster (28 storeys) stands in front of the built hillside — readable by scale, weaker than the other two.
