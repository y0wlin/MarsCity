# terrain-fn — progress log

Owner files: src/world/fields.js, terrain.js, hydro.js, sites.js, src/world/terrain/*.js (core, field,
relief, gully, impact, irrigation, layout, lineshape, maps, megasites, noise, sitezones, waterbodies,
index), scripts/preview-terrain.mjs, scripts/check-terrain.mjs, scripts/check-terrain-arch.mjs.
Private port 5181. Scratch: $SCRATCHPAD/terrain-fn/.

## State at resumption (2026-11-16 02:45, instance N+1)
Previous instances (several, interrupted by usage limits) wrote all code but no notes file. Code state
== git HEAD 48cb8d9 (my files unchanged since 00:33). Audit:
- check-terrain.mjs --quick: ALL PASS (determinism mw 0/30/2000 incl. fresh worker, seam ±180°,
  poles, cube-face edges, band-limit smoothness, sea<=>h<0 (0 violations), sea components, waterAt,
  canalsInTile OX1/OX5/OX3).
- bench (load factor ~1.1, CPU time): heightAt random full detail ≈ 30 µs (target ≤ 5 µs!),
  mw=10 m ≈ 32 µs, mw=1 km ≈ 5 µs, mw=20 km ≈ 3 µs; tile-coherent (mw = vertex spacing) ≈ 2.7–4.5 µs;
  sampleTerrain tile-coherent ≈ 8 µs; street tiles full detail ≈ 6.5 µs.
- Other teams: terrain-render says sampleTerrain 10–75 µs/texel dominates time-to-idle and maps.js
  EDT+blur ≈ 2 s CPU per worker (contended); water says canalsInTile too slow on the main thread
  (42 s first call at L9 under load 300) and waterAt 1–3 ms/call.
- Previews (shots/terrain-fn/final2, 00:28): global + 13 zoom sheets exist. ZR2 canyons now meander
  and branch (9 tributaries), but are uniform-width ribbons at 200 km.
- app_*.png (23:45) are 6 KB blanks: app screenshots never verified.

## Plan (this instance)
1. Profile heightAt full detail; cut the hot paths toward ≤ 5 µs (early-outs, cached fields).
2. App screenshots on 5181 (orbit, ZR2 canyon, G01, G02, ridge pass) — terrain renderer exists now.
3. ZR2 canyon character (width variation / side canyons at 10–100 km), re-check sites + sea.
4. Build check, notes, report.

## Log
- 02:45 audit done (above).
- 03:05 profile (random points, full detail): 65 % in the lazily built canal network (makeNode =
  computeFields+relief at 6 km per node, 7x7 nodes per cold cell); warm street tiles: gullies 22 %,
  computeFields 18 %, detail 11 %, craters 9 %.
- 03:10 app shots (5181, load avg 300): ZR2 canyon at 260 km reads as a thin grey double line; at
  9 km / S06 the city fabric covers the walls, red only on a few risers.
- 03:40 DONE: (1) ZR2 side canyons: layout.zr2Canyons() now generates 186 dry box tributaries
  (5-17 km, every 12-24 km, alternating sides, acute junctions, rim matched, rising floor, amphitheatre
  head) from the meandered centrelines of the main stem + 5 tributaries; relief skips the rim-shoulder
  raise for them (ld.line.side). (2) canyon benches: riser share 0.38 -> 0.22 of each step (tall
  near-vertical red cliffs between broad terrace benches; urban-fn's slope rule leaves risers bare).
  (3) perf: sampleTerrain farm weight = area expectation (farmBase x 0.42) for mw >= 5 km (blend from
  2.5 km), so orbit tiles never build the canal network; node cache 60k -> 150k (laterals capped 240k).
  check-terrain --quick ALL PASS after the changes. Previews: shots/terrain-fn/v4/v4_sheet_ZR2.png,
  v4_sheet_CANYONWALL.png (600/200/60/20 km).
- 03:50 gully.js: exact per-axis distance bounds skip unreachable kernel cells before hashing (4000-point
  comparison vs HEAD: 0 differences). Site check (scratch sitecheck.mjs): G01 shelf -9.5 m under all 10
  caissons + abutments, mouth/channel -32 m, harbour type 1 'harbour'; G02 six reservoirs (type 3, levels
  852..552, floors below), next level 250 m below each dam, abutments above crest, towns graded at y.
- 04:00 continuity: relief.ridged() octaves now fade in over 1-3 cm of amplitude (was a hard f > 0.02
  gate); impact.js crater cut-off moved to 1.91 r (fixed: 1.89 rho) because the 5.5 % rim scallop shrinks
  rho below the old 1.8 r cut -> cm step rings in shrunken craters' ejecta.
- 04:10 FINAL: check-terrain --quick ALL PASS. Full run: all pass except cube-face edge (pre-existing,
  identical at HEAD): a 3 cm step at 44.0712N 165.4875E (face 2 edge b=1, t=0.3225), mw 0..200, gone by
  mw 1000; not lines / craters cut-off / ridged gate / bedrock threshold — next suspect: crater age
  thresholds (age < 0.85 peak/terrace switch with spatial ageBias) or gully steering. Build check OK
  (.build/terrain-fn/dist, 1 m 40 s). App shots under load 300-390 never reached idle in 4-5 min
  (shots/terrain-fn/v4/app*.png are partially refined). Server 5181 stopped.
- Bench (noise-eval units are load independent; µs = x 30 ns): random full detail 254 (warm) - 382
  (200k points, mostly cold network) noise-evals = 7.6-11.5 µs; mw 1 km 136-290 (4-9 µs); mw 20 km ~100
  (3 µs); tile-coherent 65x65 mw = vertex spacing ~139 (4.2 µs); before this instance random full
  detail was ~1000-1290 noise-evals (cold node cache thrash at 60k).
## Remaining
- heightAt full detail still ~7.6 µs warm (target 5): gullies 22 %, computeFields 18 %, detail fbm 11 %,
  craters 9 %. Cold canal network: makeNode = computeFields + relief at 6 km (~10 µs) x 49 per new cell.
- maps.js buildCoast (EDT + blurs) ~0.5-1.3 s CPU per thread at first use (main thread too).
- ZR2 canyon walls: city covers the benches by design; red risers depend on urban-fn's slope rule
  (slopeTerrace 0.6) — verify in the app on an idle machine (S06 bookmark, 9 km oblique).

## Fix round 1
Started 2026-11-16 05:00 (instance FR1, load avg ~1.7). Private port 5207. Shots: shots/terrain-fn/fix1-*.
Items (brief): ★1 sluice semantics + invariant check; ★2 ZR2 canyon river at S06; ★3 OX4 cliff foot +
meltwater channels / pools (publish early); 4 coarse-band fast path; 5 precomputed COAST grid in
prep-data; 6 'canals' worker job; 7 optional cube-face step.
### Log
- 05:00-05:35 read ARCHITECTURE / prompt / notes; probes: ZR2 S06 river EXISTS in waterAt (56 m wide,
  level 962.3 at -105.40 -> 955.8 at -105.08, ~0.34 m/km, kind 'river'); the S06 camera stands ~0.8 km
  back from its bench edge (bench 1105-1125 m, floor 960 m) so the floor / river is hidden behind the
  bench in the 253-deg frame -> pose request + river widening (see Requests).

### OX4 cliff foot (published 05:50 for urban; API is authoritative, numbers below are a snapshot)
NEW (src/world/terrain/icefoot.js, re-exported by src/world/hydro.js):
- `iceFootSystem()` (hydro.js) -> `{ foot, reaches, outlets }`, deterministic, built lazily once per thread
  (~0.3-0.8 s CPU; call it from workers, not per building):
  * `foot: [[lat, lon], ...]` the ice-cliff FOOT line (where the cliff starts to rise), 200 m spacing,
    west -> east (~10E-80E, 73.5-76N), ice on the north / left side. Ground within ~2 km in front of the
    cliff is now a smooth outwash apron (hills / bedrock / knobs damped) -> flat building ground.
  * `reaches: [{id 'MW-n', flow (+1 = downstream along the point order, -1 reverse), points [[lat,lon]],
    levels [m], widths [m]}]` the ice-marginal MELTWATER CHANNEL, ~260 m outside the foot line, 18-44 m
    wide, water level descending from local divides to the outlets (natural channel, no sluices). It is
    dry (gaps) where a rock rise would need a > 12 m cut (~18 % of the length).
  * `outlets: [{id 'MO-n', lat, lon (on the channel), level, heading (outward from the ice, deg),
    footLat, footLon, pool:{id 'MP-n', lat, lon, radius 120-210 m, level} = FOREBAY POOL (融水前池, pump
    intake) right beside the channel at the channel level, lake:{id 'ML-n', lat, lon, radius 350-750 m,
    level} = meltwater lake on the short outflow (06:15: now 150-170 m, placed where the outflow meets the
    ground: the apron is a moat, the lowland rises outward), channel [[lat,lon]] outflow (downstream
    order), levels}]` every 12-40 km along the foot (53 outlets with water).
- waterAt: channel/outflow points are type 2 kind 'river' (ids MW-*, MO-*), pools/lakes type 3 kind 'melt'
  (ids MP-*, ML-*). canalsInTile returns the reaches/outflows (kind 'river', extra field `melt:
  'foot'|'outflow'`, points in downstream order); lakesInTile returns the pools/lakes (kind 'melt',
  `role: 'forebay'|'lake'`).
- Suggested use (urban ★5): meltwater pump station on the apron between the foot and the forebay pool
  (`outlet.pool`, intake facing the pool), greenhouse rows along the lee (south) side of the foot channel,
  maintenance road on the apron parallel to `foot`; leave some reaches of foot unbuilt (无人维护的冰缘).
- Snapshot near S04 (73.575N 51.10E, which is ~16 km from the foot):
  MO-42 outlet 73.9270N 51.1527E level 374.5 outward 213 deg | pool MP-42 73.9249,51.1477 r179 | lake 73.9161,51.1111 r489
  MO-43 outlet 73.7510N 51.9486E level 425.7 outward 212 deg | pool MP-43 73.7493,51.9447 r147 | lake 73.7403,51.9014 r653
  MO-44 outlet 73.6073N 52.2219E level 448.8 outward 229 deg | pool MP-44 73.6061,52.2168 r130 | lake 73.5868,52.0731 r466
  MO-45 outlet 73.6275N 53.3380E level 416.5 outward 172 deg | pool MP-45 73.6250,53.3393 r180 | lake 73.6080,53.3364 r734
  MO-41 outlet 74.0911N 50.5511E level 435.0 outward 186 deg | pool MP-41 74.0889,50.5502 r161 | lake 74.0776,50.5551 r354
  foot 49-54E every 10 km: 74.2516,49.3311 74.1587,49.6979 74.1445,50.2864 74.0474,50.7523 73.9352,51.1310
  73.8422,51.4283 73.7571,51.8247 73.6531,52.1133 73.5308,52.3363 73.5384,52.7187 73.5790,53.0307
  73.6546,53.4977 73.7126,53.9066
- 05:15-05:30 ★3 DONE (first cut): src/world/terrain/icefoot.js (new): OX4 cliff-foot line, ice-marginal
  meltwater channel (iso-line q=-0.36 km of the ice metric at mw 300, contour-followed 10E-80E, 8720
  vertices), outlets at the foot low points (12-40 km), forebay pools + meltwater lakes, short outflows;
  carved by the water carver (waterbodies.js), listed by canalsInTile / lakesInTile, `hydro.iceFootSystem()`.
  field.js: northIceQ() exported (iceFields uses it, identical maths). relief.js: OX4 outwash apron (hills,
  bedrock relief, knobs damped within ~2 km in front of the ice) so the foot is flat buildable ground.
- 05:30-05:40 ★1 DONE: irrigation.js level profiles rewritten (buildProfile(levs, step, dir, cap) +
  reachFrom): mains sampled every 1 km (was 2.5 km), flow node -> parent; laterals sampled every 600 m and
  either distribute (offtake staircase, flow away from the main) or collect (flow toward the main, junction
  staircase where they arrive higher, held at the trunk level where lower); every drop > 12 m becomes a
  staircase of sluices; sluice heading = downstream (+180 for collectors); canalsInTile entries carry
  `flow` (+1 = downstream along points); waterAt flow of collector laterals reversed (canalFlowSign).
  New check scripts/check-terrain-sluice.mjs: before 438/847 up<down, 285 steps > 14 m (max 251 m);
  after 0/1649, max step 12.00 m, heading verified against waterAt reaches (0/1560 bad).
- 05:40-06:00 ★1 revised: laterals no longer become collectors; every channel flows away from its feeder and
  is lifted by PUMPS where the ground rises > CUT (mains 10 m, laterals 6 m) -> canalsInTile `pumps` list
  (additive; not sluices). Lateral cuts p50 33 -> 11 m. Ditch levels follow the ground at their junction
  (were lateral level + 0.4 -> deep ditch trenches). check-terrain --quick ALL PASS again (band-limit
  smoothness failed with the trench ditches). Sluice check 600 tiles: 0/3924 bad (L11), 0/236 (L13).
- 05:45 ★2: main-stem river widened (river [[0,30],[0.3,72],[0.45,92],[1,120]]: 83 m at S06, was 56).
  Terrain-only ray cast of the S06 pose (34.893,-105.24,1122,253,-2,40): 0 river px (bench in front);
  bench-edge pose 34.8862,-105.215,1120,250,-7,40: river crosses the lower frame (33/3600 px at 80x45).
  App shot shots/terrain-fn/fix1-s06-edge-day.png (not idle, 106 jobs pending under load 120): the teal
  river + riverbed band cross the floor between buildings (some buildings stand on it -> urban request).
- 05:50 item 5 DONE: scripts/prep-data.mjs writes public/data/coast.bin (64 B header 'MCST' + key, float32
  coast km) + manifest entry; maps.js installCoast() validates the key (hash of water map + SEA_PAINT +
  version) and computes otherwise; controlMaps.js loads optional 'coast'. Heights bit-identical (3000-point
  hash) with/without; per-thread init 1051 ms -> 23 ms CPU.
- 05:50 item 6 DONE: worker jobs 'canals' {face, level, x, y, lakes?} and 'iceFoot' in handlers/lookup.js.
- 06:05 OX4 app shot shots/terrain-fn/fix1-ox4-foot.png: cliff + apron + foot channel + lake OK, but the
  lake / pools had VERTICAL pit walls (the apron is a moat: the lowland rises outward, outlet levels are
  10-60 m below the ground further out). Fixed: pools get sloped banks (0.45), channel cut walls 0.65,
  lakes sit on the outflow where it is closest to the ground and shrink until their rim meets the ground
  (most become 150 m: the meltwater collects in the moat at the foot). Outflows stay short (0.5-3 km).
- Item 4 (coarse-band fast path) NOT done: machine load 120-240 made most benchmarks meaningless. At load
  ~35 (06:40, noise-eval units, 6000 random points): mw 2000 heightAt 347 warm, sampleTerrain 2121 COLD vs
  452 warm (same points, 2nd pass); mw 3000 ~255; mw 20 km 160-290. => the orbit-tile cost at mw < 5 km is
  the lazily built O-zone canal network (sampleTerrain farm bands -> canalQuery -> makeNode = fields +
  relief at 6 km per 18 km node). Next step: precompute the C0 node table (act, P float64, parent) into
  public/data like coast.bin (bit-exact with the compute path) -> cold == warm.
- 06:40 sluice check: L11 600 tiles 0/4904 sluices bad, 3208 pumps OK; L9 300 tiles 0/19032, 11645 pumps.
  check-terrain --quick ALL PASS (init 249 ms CPU, was 1084: precomputed coast). OX4 determinism main vs
  fresh worker (reversed order) 600/600 identical. Node previews: shots/terrain-fn/fix1-ox4-map-MO42.png
  (5 km: cliff, foot channel, forebay pool + lake), fix1-zr2-river-map.png (12 km: river on the floor).
### Requests (fix round 1)
- lead (src/app/bookmarks.js, S06): the current pose (34.893,-105.24,1122,253,-2,40) stands ~0.8 km back on a
  1.4 km wide bench (1105-1125 m); the bench hides the whole floor / river (terrain-only ray cast: 0 river
  px). Suggested: pose {lat 34.8862, lon -105.215, alt 1120, heading 250, pitch -7, lens 40} (bench edge,
  ~15 m above the bench, i.e. an elevated public terrace): the river crosses the lower frame from ~2.3 km
  (left) to ~5 km (centre). props would need to re-sync the g1b4vvq train to that frame.
- urban: (1) ZR2 river is now 83 m wide (waterAt type 2 kind 'river'); some floor buildings stand in it in
  fix1-s06-edge-day.png -> keep footprints off dist < width/2 + ~15 m. (2) canalsInTile entries carry
  `flow` (+1 always now: laterals leave their main canal at points[0]) and `pumps` [{lat, lon, downLevel,
  upLevel, heading}] (lift stations where the ground rises): optional pump houses there. (3) OX4 lakes
  ML-* are now small (150-170 m) beside the forebay pools MP-* (unchanged).
- water: pumps raise the level downstream; the level-step foam BFS (higher neighbour = source) puts foam
  on the intake side of a pump. Optional: fetch canalsInTile via the new worker job 'canals' {face, level,
  x, y} (handlers/lookup.js) and skip foam at `pumps`.
- 06:42 OX4 app shot after the bank / lake fix: shots/terrain-fn/fix1-ox4-foot2.png (73.905N 51.09E 520 m,
  heading 40, 50 mm, 10:00 local; not idle, 367 jobs pending under load): ice cliff on the smooth apron,
  forebay pool + lake at the foot in a sloped hollow (no vertical pit walls; first shot fix1-ox4-foot.png
  showed them). Final build OK (.build/terrain-fn), preview server 5207 stopped.
### Remaining (fix round 1)
- Item 4: precompute the O-zone canal node table (see above). Item 7 (3 cm cube-face step) not attempted.
- ZR2: near side-canyon junctions the canyon floor lies up to ~15 m below the main floor parameter
  (e.g. 34.906-34.916N -105.40: 948 m vs floor 963 m, river 962.3 m) -> the river runs on a low levee
  there; strata ledges add 934.6 m notches at riser feet. Not fixed (needs the side-canyon floor blend).
- OX4: the lowland rises outward from the apron (moat) -> outflows stay short (0.5-3 km), lakes small.
  Open-field irrigation canals / farm bands still exist at 70-74N in OX4 (brief: 耕地移进温室) - lead call.
- 06:45 waterAt: inside a forebay pool / lake (rho < 0.9) the pool (type 3 kind 'melt') wins over the
  channel at the same level. Final: vite build OK, check-terrain --quick ALL PASS, sluice checks PASS,
  OX4 determinism 600/600. DONE for fix round 1 (items 4, 7 open; see Remaining).

## Fix round 2
Started 2026-11-16 (instance FR2). Private port 5303. Shots: shots/terrain-fn/fix2-*. Scratch: $SCRATCHPAD/terrain-fn/.
Items: ★T1 OX1 catchment basin + tableland (QS-01); ★T2 scarp band-limiting (Z-03); ★T3 OX4 ice-cliff material +
no open farmland north of 70N; T4 G02 irrigation; T5 ZR2 side-canyon junction floors; T6 G02 old water line L+6.5 m;
T7 C0 canal node table precompute.
### Log
- read ARCHITECTURE / prompt / notes / qa-round1 / round2 backlog. Z-03 root cause found: NOT a strata/scarp step
  function — the gully filter (gully.js). Its wave direction follows the local slope field; the kernel lever arm
  (|r| <= 1.5 cells x 2 cycles/cell) turns fast rotations of the steering direction (ridged-octave creases, the
  carved-slope feedback of coarser gully octaves) into phase sweeps -> 80-90 m cliffs 14 m wide (profile 23.47N
  111.976E brg 73: gully term -797 -> -886 m within 14 m), independent of mw because the octave band limit uses
  the nominal wavelength cell/2. Plan: band-limit each gully octave by its EFFECTIVE local frequency (nominal +
  lever-arm rotation rate), fading to the octave mean (not 0) so coarse and fine LODs agree.
- 13:00-13:40 ★T1 DONE: new src/world/terrain/basin.js (东泽汇水盆地, lake centre 7.3742N 104.9724E, axis 35°):
  horseshoe red-rock tableland (inner escarpment cliffs 300-470 m, talus, cap rock, strata ledges, re-entrants, lobate
  outer edge with detached mesas, open toward the SW outlet), basin floor L+5..L+75, 13 fractally meandered drowned
  valleys (trunk + 6 tributaries + 6 branches) -> multi-branched lake 'OX1-BL1' (level 150 m, ~79 km² at 200 m/px) with
  islands and 2 butte islands; dry tributary valleys notch the tablelands (inlets); rock sill (trunk floor L-3) at the
  outlet; graded apron downstream. relief.js applies it after the coast ramp (the OX1 coastal flattening would squash
  it); fields: farmBase 0 inside (basinMask), canal nodes inactive, laterals that would run in dropped, mains never
  cross it; waterbodies: lake (type 3 kind 'lake'), no marsh / pond lakes in the basin. Outlet main 'OX1-BL1-OUT'
  (irrigation.js outletSeg(): straight 4.2 km main, sluice staircase 150 -> 141 -> 132 -> 123 m, laterals / ditches /
  farm bands like any main) ends at a FORCED C0 node (moved onto the outlet end, active leaf: P = max neighbour + 25)
  whose main continues downhill -> the canal network and farms lie downstream of the lake. hydro.ox1Basin().
  Previews: shots/terrain-fn/fix2-basin-map-v5.png (60 km map), fix2-s03-ray-b.png / fix2-s03-cand-B.png / -C.png
  (Node voxel ray casts from the candidate S03 poses).
- 13:40 ★T3 DONE: relief.js ice section: the ice-cliff FACE is ice down to a short red-rock foot (lowest ~2-40 m of the
  cliff profile), red rock / talus band at the foot, `sampleTerrain.crevasse` (vertical crevasse cue on the face).
  MO-45 profile 73.629-73.632N 53.339E: face mat ICE (was FARM), foot mat ROCK_RED. DECISION DD: field.js F.farmOK =
  farmBase faded 69.4-70.0N -> no canal nodes / farm / ponds north of 70N; F.farmBase (terrain grading) unchanged so
  the OX4 terrain and the ice-foot system (MP-45 level 416.46) do not move. fields.farmBase / farm now 0 north of 70N.
- 13:40-14:00 ★T2 DONE: gully.js (see the Z-03 root cause above): (1) ridged octaves push a softened-crease gradient
  (e >= 0.22) for the gully STEERING (height unchanged); (2) the carved steering of coarser octaves is soft-clamped so
  it never cancels more than half of the macro slope (near cancellation = hypersensitive direction); (3) octave
  amplitude from the macro slope only; (4) per-term curvature bounds (slopeTerm kappa; ridged analytic) -> effective
  local frequency -> octaves fade toward their mean carve (UMEAN 0.347, measured) where unresolved at mw, and at full
  detail where they would draw slopes > 1.6 (singular points of the steering field); (5) layout.lineNormalSmooth for
  the canyon / rift wall steering (the piecewise-constant segment normal jumped at every vertex). Z-03 profile 23.47N
  111.976E brg 73: the 80 m / 14 m scarp is gone (max slope over 5 m: 3.6 at mw 0..10, 1.8 at mw 40/80; was 6-8.8 at
  every mw); range sample 4000 pairs: mw 0 slope p99.9 2.3 / max 3.4 (was 7.8 / 31), rms(mw 80 - full) 6.6 m (was 34.6).
  Also band-limited: ZR3 / OX5 mesa cliffs (band >= 1.5 mw), coastal cliffs, ice cliff width, crevasses (12 m / 4 m),
  G02 layered walls / benches (megasites wallRiseBL: mean ramp at coarse mw; full detail = designed profile).
- 14:00 T6 DONE: megasites: old water line paint up to L + 6.5 m on the waterline.side bank (sites.js
  levels[i].waterline.paintTop, additive), L + 3.6 faint on the other bank.
- 14:05 T4 DONE: sitezones.g02Farm(): irrigation district ellipse (31 x 25 km) on the plain below dam 6 along the
  downstream direction (farmBase 0.95 -> C0 nodes active) fed by a forced C0 node at the G02-OUT spill channel end;
  irrigated bench terraces on the benched bank of R2-R6 below dams D1-D5 (fields.farm / sampleTerrain.farm, rock
  reduced). G02 box -28.3..-27.6 / -45.6..-44.5 (1980 pts): fields.farm > 0.3 = 95, mat FARM = 64 (was 0 / 0). S08
  (g02-valley) Node ray: terraces 1.8 % of the frame (green strips along the reservoirs), fix2-s08-ray.png.
- 14:10 T5 DONE: relief.js floorK / floorZ: on carved canyon / valley floors the large detail octaves (> 120-450 m)
  are damped and strata ledges off; near the floor (s < 0.4) the ground never digs below floor - 0.5 m. 34.900-34.926N
  -105.40: ground 959.7-962.6 m (river 962.3, floor 962.9; was 934.6-948 m: river on a levee + strata notch).
- 14:20 T7 DONE: irrigation.js node table (makeNodeLive / tableNode / serializeCanalNodes), prep-data writes
  public/data/canalnodes.bin (53230 active nodes, 917 KB, 12-23 s), controlMaps OPTIONAL += 'canalNodes'. Validated at
  install (96 sampled nodes vs live; stale -> warn + live). Bit-identical: 3000 sampleTerrain + 3 canalsInTile hashes
  equal live vs table; cold orbit-scale sampleTerrain (mw 2500, 6000 pts) 1512 -> 772 ms CPU.
- checks: check-terrain --quick ALL PASS; check-terrain-sluice ALL PASS (0/4462 bad); vite build OK.
### S03 candidate poses (Node voxel ray casts, 480x270; rows from the top; lens full-frame mm; time 3.009 = 10:00 local)
- A 7.21495,104.86001,3114,35,-13,35 (old S03 position, ~3 km above ground): sky 0-67, far tableland / mesa rows 73-155
  (18-27 km), lake 100-221 (6.9-16.6 km), outlet main + fields at the bottom (canal 4.9 km+). shots/terrain-fn/fix2-s03-ray-b.png
- B 7.23351,104.86894,3118,35,-16,35: sky 0-45, tableland 49-147 (17-26 km), lake 81-237 (5.6-15 km), outlet sill sluice
  (5.2 km) + outlet main + fields low. shots/terrain-fn/fix2-s03-cand-B.png  <- recommended
- C 7.19944,104.90314,3118,22,-13,32: sky 0-72, tableland 81-166, lake 104-233, fields + main low (offset east, the
  right-hand tableland arm nearer). shots/terrain-fn/fix2-s03-cand-C.png
- 14:00 STABILITY: the T2 gully change also shifted every relief-derived LAYOUT (OX4 ice-foot trace: 56 outlets with ids
  shifted by one instead of 53 -> S04 pump / urban ids would move; canal levels / lake candidates likewise). New frozen
  copies relief_v1.js + gully_v1.js (= fix-round-1 code, do not edit) are used for the layout derivations ONLY:
  icefoot trace, C0 node drainage P + canal levels (outside the OX1 basin: FN.basinW > 0 uses the live relief), lake
  candidates. Verified: iceFootSystem() JSON (foot, reaches, outlets) bit-identical to the original code; canalsInTile
  JSON identical at L9 in OX1 (outside the basin), OX3, OX5 (outside the G02 district). canalnodes.bin regenerated.
### Requests (fix round 2)
- lead (src/app/bookmarks.js S03): candidate B 7.23351,104.86894,3118,35,-16,35, time 3.009 (10:00 local) — far
  tableland upper frame, lake arms mid, outlet sill sluice + outlet main + downstream fields low (A / C as alternatives).
- urban: (1) OX1 basin (lake centre 7.3742N 104.9724E, `hydro.ox1Basin()`): sluice stations at the three sluices of
  canal 'OX1-BL1-OUT' (canalsInTile; first one at the sill 7.3054N 104.9187E, 150 -> 141 m), a levee road + white
  maintenance houses / a low work town on the apron along the outlet main and the SW lake shore (QY-06); no buildings
  in the lake (waterAt type 3 'OX1-BL1') or on the escarpment cliffs; tableland tops are bare red rock. (2) DD: fields.farm
  / farmBase are 0 north of 70N and no canals there -> drop the OX4 farm strips (greenhouses stay). (3) G02: farm parcels
  from fields.farm on the plain district below dam 6 (fed by canals from the forced node at the G02-OUT end) and irrigated
  bench terraces (fields.farm 0.85) on the benched bank of R2-R6 below dams D1-D5 (parcels following the 9 m benches).
  (4) ids: O-zone buildings within ~45 km of the basin centre, OX4 farm / canal buildings north of 70N and the new G02
  district change; elsewhere canals / sluices / levels / lakes / the ice-foot system are bit-identical (frozen relief).
- terrain-render: `sampleTerrain.crevasse` (new, 0..1 vertical crevasse cue on OX4 ice-cliff faces; mat ICE on the face,
  ROCK_RED foot band); the OX1 basin tablelands carry mesa / rock / cliff / strata weights; lake 'OX1-BL1' type 3.
- water: lake 'OX1-BL1' (type 3, level 150, calm); outlet sluice plumes from the 'OX1-BL1-OUT' sluices (canalsInTile).
- megastructures: T6 done — terrain paints the old water line up to `waterline.paintTop` = L + 6.5 m on the
  waterline.side bank of R1-R6 (sites.js additive field; `top` unchanged).
- 14:05 FIX: basin valleys used smin(k = 0.6 mw) -> at mw >= 2 km the basin collapsed into a pit (h -> 1 m); now the
  valley carve is band-limited by the valley width (fades into the floor, k = 18 m) and all basin noises carry bandW.
  Centre column mw 0/100/500/2000/5000/20000: 112/111/112/147/148/148 m (lake floor at full detail, floor just below the
  lake level coarse). canalnodes.bin regenerated (table == live hash). check-terrain --quick + sluice ALL PASS.
- 14:07 app shot (port 5303, load ~120, not idle): shots/terrain-fn/fix2-s03-candB.png — multi-branched lake with curving
  shores and islands, horseshoe red-rock escarpment with re-entrants / buttes across the upper third, outlet canal +
  field grid low, farmland beyond the tableland at the horizon (S03 reads; basin floor colour is flat, terrain-render).
- 14:10 app shot shots/terrain-fn/fix2-z03-1km.png (Z-03 pose 23.664751,111.909393,2280; not idle): smooth gullied red
  flanks, no comb teeth / needle skyline. 14:13 shots/terrain-fn/fix2-ox4-mo45.png (QY-04 pose): the MO-45 ice cliff is a
  white-blue ice wall with vertical flutes on a red rock foot, meltwater channel / forebay pool / lake, pump + greenhouses.
  Console of that (older) build: "stale canalnodes.bin (1/9 sampled nodes differ)" -> table rejected, live compute
  (harmless). Validation now tolerates last-bit Math differences between Node (writer) and the browser's V8 (all threads
  of a session use the same table values); table regenerated for the final code; final vite build OK (.build/terrain-fn).
### Remaining (fix round 2)
- Basin floor reads as flat natural sand / rock (no meadow / reed vegetation by the lake; terrain-render colours); creeks
  in the dry tributary valleys not modelled (valleys are dry above the lake level).
- Gully band limit changes the fine look of natural mountain slopes everywhere (steering smoothed, <= 1.6 slope per
  octave): extremes removed, mean unchanged; re-check S06 / S08 framing on a quiet machine.
- Browser-side table acceptance not re-verified on the final build (see final check shot log if present).
- 14:19 final-build check shot shots/terrain-fn/fix2-s03-candB-final.png: basin renders, console 0 errors / 0 page
  errors, no stale-table warning (canalnodes.bin accepted in the browser). Preview server 5303 stopped. DONE.

## Fix round 3
Started 2026-11-16 18:50 (instance FR3). Private port 5303. Shots: shots/terrain-fn/fix3-*. Scratch: $SCRATCHPAD/tf/.
Items: ★T1 G01 quays (harbour shore +2-4 m quay platforms 300-600 m wide, ramp to the terrace behind); ★T2 S08 terrain
stripes (regular ridge stripes left of the lowest G02 dam + ruler-straight flat-floored channel cut below it); T3 ids stable,
checks, data files. Browser budget: ONE shared slot, at most 2-3 app shots.
### Log
- 18:50 read ARCHITECTURE / brief / notes / qa-round2 / evidence (city fix2-s05-proposal-day: red cliff band along the far
  shore; atmosphere fix2 b0-S08-noshadow + c-S08-left-nosh: wavy contour-parallel stripes on the right bank left of D6,
  straight trench walls below D6). Node probe G01 (u = -4500..4500 across the shore): h jumps 0 -> 40-80 m within 20-60 m
  of the waterline = relief.js coast `cliffy` sea-cliff profile (fields.urban is only 0.03 there: the harbour city is an
  urban overlay, so `built` does not suppress the cliff).
- 19:10 ★T1 code (megasites.js): quayG01 (land side of carveG01, r < 10.5 km): quay platform at Q.level (cargo 3.4 /
  bay head 2.9 / west 3.0 m, +0.35 m inland rise) over Q.width (cargo 550 / bay head 385 / west 335 m ± noise,
  measured 290-597 m perpendicular), quay wall max(2.5 m, 1.5 mw) at the waterline, ramp 480±90 m to the natural
  terrace, fades out at |u| 4600-5150 (headlands at the barrier ends keep their natural shore); coast metric over its
  gradient = ~perpendicular metres from the true waterline. Sea side: berth pocket cargo 13 / bay head 8 / west 5 m
  (flat 140 / 90 / 45 m, back to the basin depth over 260 m). Materials: cliff / strata / rock / beach / scree off.
- 19:20 S08 diagnosis (Node maps, scripts/preview-terrain-site.mjs new; shots/terrain-fn/fix3/g02-d6-map-before.png):
  the stripes are the LEFT-bank (north side here) 9 m benches of g02WallRise drawn over the whole 1.2 km slope up to
  the tableland (a riser every 37.5 m), the straight scarp is the hard switch R6 walls -> outflow trench at the dam
  line (up to 243 m), the "channel cut" is the outflow trench (flat 491 m floor, 260 m half width, planar 0.35 walls).
- 19:45 ★T2 code (megasites.js): rightRise / leftRise (designed g02WallRise kept as the mean ramp; ledge / bench
  index warped monotonically + bench height varying along the valley + risers warped across contours; left bank
  benches only in the irrigated-terrace belt (benchBelt = the g02Farm terrace zone with a wandering upper edge),
  natural gullied slope above (2 octaves, masked patches, meandering)); outflow below D6 rebuilt as a canyon mouth
  continuous with the R6 walls (floor half width = neck at the dam, widening / wandering per side; wall foot steps from
  L6+0.6 to the floor within 380 m; floor relief + cross-slope + a 3 m river terrace; round-2 plain profile from
  1.8-2.8 km below the dam so the irrigation district / canals are untouched). Reservoir bank lower bound now wins over
  a carved wall below it (clamp order bug with lo > hi). New scripts/check-terrain-sites.mjs (G01 + G02 landform checks):
  round-2 terrain fails 9 of them, new code ALL PASS but a pre-existing over-strict shelf test (fixed in the test).
- 20:00 maps v2/v3 showed (a) the left-bank gully grooves as straight lines of constant s and (b) straight diagonal lines
  on the canyon-mouth north wall: g02Project's nearest-segment station JUMPS across the vertex bisectors (axis resampled
  every 28-100 m with small zigzags: up to 8-28 m at 0.7-0.9 km from the axis), and the new wall-foot step / floor
  growth varied fast with s. Fix: g02SmoothS (station from interpolated vertex normals, continuous) for every T2 term,
  dam-6 axis-line distance for the canyon-mouth growth / step / fades; gullies meander with a strong xz warp; floor edge
  wobble ±80 m; patchy terrace. shots/terrain-fn/fix3/g02-mouth-map-v4.png: no straight lines left on the walls.
- checks: check-terrain-sites ALL PASS (round-2 terrain: 9 FAIL incl. G01 quay level p50 53 m, cliff, ramp 4.35, berth
  1.9 m; G02 dam-line scarp 243 m, left-bank tread share 58 % -> 6 %); check-terrain --quick ALL PASS; check-terrain-sluice
  ALL PASS (0/4477); canalsInTile + lakesInTile JSON over 230 L11 tiles around G02 bit-identical (hash 705335…);
  canalnodes.bin / coast.bin not stale (no field / relief / coast change) -> not regenerated. vite build OK (.build/terrain-fn).
- ids: G01 harbour band (79 L13 tiles within ~1.6 km of the shore, before/after trees differing only in megasites.js):
  12775 ids kept, 1585 removed / 1380 new in 39 tiles (residential / shop_row mostly; +1 ferry_terminal, +6 warehouses on
  the cargo quay). Ferry terminals now stand at 2.8-3.1 m (were 47-87 m on the cliff top); ZR1-0.3.1hq.sw-n6.4-0 ->
  ZR1-0.3.1hq.sw-n1.5-0. BG01 abutments hA/hB 33.0/61.9 -> 3.0/3.2 m (deck rises at 5 % to 52 m clearance). G02 valley
  tiles: 0 urban buildings (towns are city-synthesised at fixed anchors) -> no id change. Elsewhere bit-identical.
### Requests (fix round 3)
- urban: (1) G01 waterfront plan changed in 39 L13 tiles (face 0, x 7724-7740, y 4158-4164; list in this log) — the quay
  band follows the TRUE waterline (coast metric 0), which differs from harbour.js shoreDist (designed g01ShoreV) by up to
  ±200 m on the flanks (sitezones.g01Coast natural coves): put quay aprons / port sheds / ferry piers on the true waterline
  (terrain height < 4 m within ~300-550 m of the water). (2) nothing else moves; quay ground 2.8-3.6 m, ramp 480 m behind.
- props: ferry / pier positions need not move (the waterline is unchanged); berths are now 5-13 m deep right at the quay
  wall (cargo east 13, bay head 8, west 5 m), so ships / ferries can lie alongside. Ferry terminal id change above.
- lead: S05 (pose unchanged) far shore = quays at +3 m with the promenade / ferry terminal / city at the water; S09 / S09b /
  S09c framings unchanged (barrier, mouth, channel and the barrier-end headlands untouched). S08: no pose change needed.
- terrain-render (optional): the 2.8-3.6 m quay wall faces at the G01 waterline are steep (> 46°) and get the procedural
  rock face; a concrete / stone quay-wall look where sampleTerrain.coast < 15 m and cliff == 0 inside the harbour would
  read better close up (S09c / ferry views).
- megastructures: nothing to do — the G02 layout keys on terrain heights at runtime (dam ends unchanged: shoulders kept;
  road benches kept; R5 / R6 old-water-line bands re-drape onto the new banks).
- 20:30-20:45 app captures (port 5303, capture-shots S08,S05 1600x900 workers=3, one browser slot; NOT idle after
  258 / 275 s under load 60-90, 0 console errors): shots/terrain-fn/fix3-cap/S08.png (+ fix3/S08-crop-bl.png): left bank of
  R6 = green terrace belt + gullied natural slope, no stripe field; canyon mouth below D6 with layered irregular south cliffs,
  natural north slope, river-terrace floor, no straight trench walls / dam-line scarp. shots/terrain-fn/fix3-cap/S05.png
  (+ fix3/S05-crop-shore.png): the red cliff band along the far shore is gone, the city / ferry terminal / BG01 approach
  viaducts come down to the water. Node maps: fix3/g02-d6-map-before.png vs g02-d6-map-v3.png, g02-mouth-map-v4.png,
  g01-bay-map-before-after.png. Final vite build OK; preview server stopped; no browser of mine left.
### Remaining (fix round 3)
- S05 (not idle): a bare sand-coloured wedge under the west BG01 approach (the quay ramp 300-750 m inland, ~50 m high
  at its top, around U -1000..-400): either coarse / unrefined tiles at capture time or sparse urban fabric on the ramp
  (urbanSample there: roads / roofs / parks, coverage 0-0.5). If it persists idle: urban could carry terrace blocks onto the
  ramp, or terrain-fn can lengthen the ramp (QY.ramp 480 -> ~750 m, slopes 0.1 instead of 0.17) — one constant.
- The thin pale line at the G01 waterline is the 2.8-3.6 m quay wall face (steep-face rock material; see the optional
  terrain-render request). G02 R4 / R5 right-bank cliffs still read as large layered steps from S08 (by design, now
  irregular). The OX5 escarpment riser itself stays straight near G02 (g02NoiseFade, round-1 design) — untouched.
