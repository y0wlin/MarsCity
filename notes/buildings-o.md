# buildings-o — 富氧改造区 water-works & agriculture family — progress log

Owner files: src/buildings/types/{pumphouse,sluice_station,greenhouse,dorm,control_tower,maintenance,cold_storage,
farm_station,water_treatment,service_depot,insulated_station,meltwater_pump}.js, src/buildings/types/o_*.js,
dev/buildings-o.html, src/dev/buildings-o.js. Private port 5194. Shots: shots/buildings-o/.

## Status
- [14:25] fresh start (no previous notes). Read ARCHITECTURE, prompt §1/§3/§5/§6, kit README + kit sources,
  urban spec/builders (O-zone uses + meta), refs O02/R1/O01/O03.

## Decisions
- Shared helpers in o_common.js (climate/lee side, yellow rails, gratings, steel stairs, caged ladders, pipes,
  lamp posts, roller doors, dust/snow drifts, wet line) and o_hall.js (generic utility hall: walls+openings+units,
  trims, roofs flat/vault/pitched, interiors+colliders, anchors).
- Water side: meta.poolSide (default 'back'); canal geometry from optional meta.water {dist,width,flow} else
  defaults (canal edge 3 m behind the pool facade, width 16–20 m). Request to urban for explicit numbers.
- Gate open/closed per bay from spec.hash only (same at every LOD).
- Dorm = kit residential plan (o_utility style) + O-zone dressing (escape stair, entrance rails, climate).
- No hydro import in type modules (worker/bench safety, determinism).

## Done
- [~15:05, previous instance] o_common.js, o_hall.js, o_pump.js (pumphouse + meltwater_pump), sluice_station.js,
  dev/buildings-o.html + src/dev/buildings-o.js bench (20 lots incl. polar sector, canal with two levels).

## Status log
- [18:05] RESUMED after interruption (new instance). Read all existing files + kit + urban specs/builders.
  Findings: real specs use entrance kinds control/main/equipment/maintenance (water works), airlock/service
  (insulated_station), loading (depots); specs.js sets meta.poolSide='back' on EVERY pumphouse (canalId null
  for non-canal ones) → variant detection must use canalId, not poolSide. Canal gap from urban placement:
  sluice centre = canal width/2 + 22 m → back facade 22 − d/2 m from the canal centreline edge; pumphouse 20 m.
  'basins' area behind water_treatment is raster colour only → tanks are built by water_treatment.

- [23:05] RESUMED again (3rd instance). State found: all 12 types + helpers o_common/o_hall/o_pump/o_block/o_shed
  implemented, bench complete (22 lots). Node check (.build/buildings-o/ocheck.mjs): every lot × LOD generates with
  no errors / NaN. Screenshots d01–d14 taken (shots/buildings-o/). Machine load avg ~100 (others' Chrome runs) →
  timings noisy. Plan: pumphouse overhaul (hall + annex massing, outside hoist beam over the maintenance door,
  visible discharge pipes, raised control bay to the pool), shared utility dressing for halls, sluice bracket fix,
  verify full/mass/night, perf table, build.

- [23:55] Pump house overhaul done (o_pump.js rewritten): crane hall against the pool + lower annex on the street
  side (split footprint, hall wall clerestory above the annex roof, internal door), glazed control bay projecting
  over the intake yard (shared glazedBay in o_common, also used by the sluice house; fixes the old inverted cheek
  glass + odd triangle brackets), yellow monorail hoist beam over the maintenance roller door with hatched lifting
  square on the apron, white surge vessel on the delivery main, caged roof ladders, annex HVAC, 'full' annex
  fit-out (duty desk clear of the door, switchgear row, partition). Shared utility dressing pass in buildHall
  (floodlights at roller doors, conduit + junction boxes + cable tray, AC units on brackets, exit signs, hose
  cabinet) → every hall type gets it. buildHall/boxTrims/flatRoof/hallInterior now honour `skip` sides.
  Shots e01–e06 verified.

## Remaining (old list, mostly done by instance 2)
- fix pump/sluice variant + entrance kinds + waterInfo defaults
- greenhouse, control_tower, dorm, maintenance, cold_storage, farm_station, water_treatment, service_depot,
  insulated_station
- bench lots with real entrance kinds, screenshots of every type, perf table, build check

## Verification
- (none yet)

- [02:45] RESUMED (5th instance, plan upgraded). State: all 12 types + helpers + bench unchanged since the WIP checkpoint
  (23:57). Kit changed since (plan.js/assemble.js/index.js/README small additions) → re-verified: Node check
  (ocheck.mjs) all 22 lots × 3 LODs generate, no errors / NaN. Restarted private server (5194, hmr off,
  .build/buildings-o-dev/restart.sh). Audit shots g01–g06. Plan for this session: real-city check (ocity.mjs),
  in-app shots near O-zone water works, polish the O02 trio (sluice / pump / tower / greenhouse) where weakest,
  climate variants check, perf table, build, report (time-box ~2 h).
- [03:35] Done this session:
  * waterInfo: real hydro sluices can list up < down and canals can lie 10–40 m below the station (OX1 / OX4
    real specs) → levels relative to the entrance, high side = retained level, clamp [-30, -0.4], step ≤ 14 m,
    null sluice no longer read as 0 (was: clamp [-6,-0.4] → piers hanging above the real water).
  * sluice house: board-formed concrete ground storey under the panel shell (facadeWall/buildHall option
    `lower: {key, y, tint}`, split only where no opening crosses), external steel stair on the remaining side
    up to a control-floor door (walkway → stair → control room route), control camera anchor fixed (was
    pointing from outside into the room; now from the glazed bay down to the gate pool).
  * 'mass' LOD fixes: greenhouse roof planes and insulated-station vault were wound inside-out (invisible
    from above) → fixed; shared massVault helper; polar service depot mass now has its vault.
  * bench: per-lot quay gap (sluice 9 m) so the gantry rail clears the control bay (real data: 15 m).
  * real-city check (ocity.mjs, 927 O buildings in 12 tiles): 0 errors / NaN.
  Shots i01–i05, j01–j05. In-app shots unreliable under machine load (load avg 60–220, not idle after 150 s).
  Next: perf table (ocheck --runs 5), build, report.
- [04:10] Also: feeder pump rooms (pumphouse / meltwater_pump with meta.serves='greenhouses' = every real polar
  meltwater pump) now run supply + return mains out of the wall towards the greenhouse row (meta.servesSide,
  default 'right') on saddles into a valve pit with a marker post (polar: insulated + heat-traced); bench lot
  MP-OX4-feed added. Hall wall colliders: upper doors (external-stair landings) now get a door gap (was blocked).
  Perf (Node, CPU ms median of 5, load avg ~300): mass ≤ 0.5, exterior 3.6–42.5 (dorm max), full 4.2–61.5.
  Build OK (.build/buildings-o). Private server stopped. In-app S04 shot l01 (not idle after 300 s under load,
  no console errors).
## Remaining / known issues (for QA / next instance)
- urban: sluice levels can be reversed (up < down) and 30–48 m steps; stations placed on 30 m slopes;
  no canal level / flow side / servesSide in meta (requests in the final report).
- debug layers (objectId / wireframe / lod) are drawn by the city renderer's materials, not by type modules.
- polar sluice station variant not on the bench (exists in the real OX4 data); dorm stays a plain kit block.
- [04:22] Sluice gate states now follow the water renderer's discharge rule (sluiceOpen(higher, lower) replicated
  in sluice_station.js sluiceDischarging): discharging stations open 1..n−1 bays from spec.hash, others keep all
  gates down; verified identical to render/water/tiles.js sluiceOpen on 5 real stations at exterior + full.
  data.meta.gates gains `discharging`. Final build OK. Report delivered.

## Fix round 1
Started 2026-11-16 07:03 (load avg ~5). Private port 5212. Shots: shots/buildings-o/fix1-*.
Items: ★1 urban meta water/sluice/servesSide/pad; ★2 sluiceOpen from world/sluice.js; 3 greenhouse glass_agri +
basalt walls/plinths; 4 dorm worker housing; 5 bench polar sluice + OX4 in-app shots; 6 §5 07 O control-room route.
### Log
- 07:03 read ARCHITECTURE, prompt, notes (urban, water). water already moved sluiceOpen → src/world/sluice.js.
- 07:10 ★2 DONE: sluice_station.js sluiceDischarging → `sluiceOpen(up, down)` from src/world/sluice.js (water's
  pure module, D2); same results as the old replica.
- 07:15 survey of real OX1 sluice stations (S03, 60 specs, .build/buildings-o-dev/ospecs.mjs + oxsec.mjs terrain/hydro
  cross-sections): retained level −5.8 … +10.0 m relative to the entrance (≈ 65 % PERCHED above the station ground
  on levee reaches), tail −13 … +0.7 m, the hydro level step sits exactly at building x = 0; junction pumps −20.8 …
  +6.2 m; 5 pads (spread 3.4–4.4 m). The old clamp up ≤ −0.4 m put decks under water by up to 10 m.
- 07:30 ★1: waterInfo rewritten (real levels −35…+15 m, step ≤ 16 m; flow from meta.sluice.upSide, then meta.water.flow,
  front-side frames flipped; deck = max(yard + 0.6, up + 1.1); beds ~1.9 m under each level; meta.pad → pad).
  gateStructure v2: gate line on the level step (x = 0), sill on the upstream bed, glacis (small steps) / steep drop
  (big steps) into a stilling basin on the tail bed (length 6 + 1.4·drop), training walls just over the tail water,
  approach walls to the bank, abutments to the deck; access = steps for a low deck, else a steel stair parallel to
  the bank beside the house (flights ≤ 16 risers + landings) + gangway (service bridge) at deck level onto the
  abutment; 背侧设备院 equipment yard (kit-style equipmentYard) in the widest free stretch of the pool facade.
  Pump intake deck follows the water (raised deck: basalt retaining face + steel stair). siteWorks(): basalt
  retaining terraces (kit retainingSteps) wherever the bank rises above the floor + pad skirt for meta.pad; floor on
  the pad level (oEnv.ffl). Door thresholds get walk colliders (facadeWall). Stair arrivals: slab edge at the last
  riser (sluice house + o_block.storeySlabs had a 0.2–0.25 m hole at the top of every flight).
- 07:40 walk check (.build/buildings-o-dev/owalk.mjs, WALK r 0.28 / step 0.35 / drop ≤ 0.9): shot-07 O route
  walkway → duty entrance → stair → control window → back equipment yard ALL reachable on SL-OX1 (bench) and real
  OX1-0.3.11t.x8-n1.1-0 (perched +3.1 / −8.0), OX1-0.2.ix.gl-2.1-1 (pad, +10.0 / +0.7), OX1-0.2.iy.gk-3.n6-0,
  OX1-0.2.ix.gl-n1.0-0 (120 m canal, 5 bays), OX1-0.2.ix.gl-n2.6-0 (pad); floors 86–93 % / 95–96 %.
- Private dev server 5212 (.build/buildings-o-dev/restart.sh, hmr off).
- 07:50 item 3 DONE: greenhouse envelope glass → kit 'glass_agri' (walls, roof slopes, porch side lights; doors keep
  clear glass), foundation slab + wall base course → 'basalt'. Urban request (4): OX4 lee rows (meta.lee) get a slatted
  snow fence 4.5 m behind the back gable with the snow bank on its windward face. Kit request: sluice lower-storey
  concrete tint [1.7, 1.67, 1.6] → [1, 1, 0.98] (albedo normalisation).
- 07:58 item 4 DONE: dorm.js runs the residential pass sequence itself (plan → facades → bands → roof → base →
  interior → anchors, same as residential.generateResidential) so it can add to the PLAN: external steel escape
  stair on a free gable (stacked flights alternating along the wall, grated landing + real door at every upper floor,
  conflicting gable windows dropped, caged ladder to the roof, landing lamps), entrance portal (canopy on two posts
  beside the steps, yellow fascia, downlights, notice board, bike shelter; polar keeps the kit's insulated porch),
  roof: tank + solar heaters (polar: heat-recovery units) + extract-fan row + vent stacks + mast.
- 08:02 urban request (3): OX4 outlet pumps (intakeSide + serves 'greenhouses') now also run the feeder mains to
  servesSide. Sluice duty door = spec 'control' entrance (+ workshop 'main' door); control camera stands at the bay
  end beside the console row (the monitors filled the old view).
- 08:05 bench: SL-OX4-polar lot (polar sluice −3.4 → −5.6 m), bench water reaches split at every sluice lot,
  water lots carry meta.water.level (bench canal level), GH-OX4-polar has meta.lee. Bench shots fix1-bench-*.
- 08:15 walk-collider fixes found by owalk: control-bay wall opening ('blank') now leaves a gap in the hall wall
  colliders and the bay floor collider runs through the wall (pump control bays were sealed off: PH-OX1 / MP-OX4
  control window now reachable); pump control camera also moved beside the console row; pad stations: yard on the
  pad level. Dorm escape stair flights all span the same run (tread stretched on shorter storeys, no gap at landings).
- 08:20 node: ocheck all 23 bench lots × 3 LODs 0 errors / NaN; real specs (S03 sluices, junction pumps −20.8 / +6.2,
  OX4 MO-45 pump) generate at every LOD. Build OK (.build/buildings-o, 37 s). Waiting for browser slots (3 busy).
### Requests (fix round 1)
- lead (bookmarks.js): §5 07 O version on a real OX1 sluice station near S03 — building OX1-0.3.11t.x8-n1.1-0 (perched
  canal +3.1 m / tail −8.0 m, 4 bays (2 open), flow north): views 'walkway' (检修道, on the abutment end of the grated
  maintenance walkway, looking across the gate line downstream), 'entrance' (值守入口 = the 'control' door), 'stair',
  'control' (控制室观察窗, eye in the glazed bay
  beside the consoles, same gate pool), 'back' (背侧设备院). Suggested time local 15:30 (solTime 8.51: the canal side is
  lit). All five are walk-reachable on the 'full' colliders (.build/buildings-o-dev/owalk.mjs).
- building-kit: real dorm OX1-0.3.11r.x7-n25.n4-2 (3 floors, 37.65 × 13.56) — scripts/walk-buildings.mjs reaches only
  10/67 rooms (upper floors 10–11 %) with the kit's own generateResidential too (stair / core connectivity of that plan).
- urban (optional): OX4 forebay pumps — the terrain bank shelves ~10 m beyond the nominal pool radius, so meta.water.dist −
  width/2 is not the waterline; a meta.water.shore (distance to the real waterline) would let the intake sit on a quay
  (the 12 m intake jetty bridges it for now).
- water / others: nothing — sluiceOpen comes from src/world/sluice.js; urban meta consumed as published.
- 08:26 APP (private dev 5212, workers=3, load ~100): shots/buildings-o/fix1-app-ox1-sluice-overview.png — real station
  OX1-0.3.11t.x8-n1.1-0 from across the canal: deck + gantry at the perched upstream level (+3.1 m), tall piers /
  drop / training walls down to the tail water (−8.0 m), control house with the glazed bay behind; structure agrees
  with the rendered water on both reaches. Real-city check (ocity, 914 O buildings × 3 LODs): 0 errors.
- 08:33 APP fix1-app-ox1-sluice-control.png (buildingView 'control'): from the glazed bay the retained pool at the
  gates (left, deck level) and the tail water far below the drop (right) with the service bridge — level difference
  and flow direction readable, consistent with the overview. fix1-app-ox1-sluice-walkway.png was a bad frame (camera
  on the abutment end beside a frame post, pitched −45° into the slot) → walkway camera moved onto the grated walkway
  over the first bay, looking diagonally across the gate line downstream (re-shoot queued).
- 08:35 real S03 water works (94 specs: sluices, junction / feeder / utility pumps) × 3 LODs: 0 errors / NaN
  (.build/buildings-o-dev/oreal.mjs). Kit walk check on real dorms: OX1-0.3.11r.x7-n25.n4-0 101/101 rooms;
  -n4-2 10/67 rooms — identical with the kit's own generateResidential (pre-existing, reported to building-kit).
- 08:37 APP fix1-app-ox4-meltpump.png: OX4 MO-45 forebay pump OX4-2.3.10t.m5-3.0-0 (pool −6.4 m) at the ice-cliff foot,
  greenhouse row with snow fence at the right; the terrain bank shelves gently so the waterline lies ~10 m beyond the
  intake mouth → melt-pool intakes (meta.water.pool) get a 12 m intake jetty on pile bents with the insulated suction
  mains down to a screened intake head below the pool level. All 4 app shots: 0 console errors / warnings.
- 08:40 build OK (.build/buildings-o, 39 s). Re-shoot batch (walkway, back yard, melt pump + bench walkway / dorm gable /
  melt pump) queued on 5212.
- 08:44 walkway camera again (app frame 2 was cluttered: frame post + hoist gearbox at 3 m): now on the near
  abutment's maintenance way 4.5 m upstream of the slots, looking diagonally across the gate line and downstream
  (retained pool below the eye, leaves / frames / gantry obliquely, drop + tail water, far bank). Route re-verified.
### Remaining / known issues (fix round 1)
- Perched reaches higher than the control-room eye (up > eye − 1.5 m, ~25 % of real OX1 stations, +7…+10 m): the
  house keeps its 2 storeys, so the control camera aims at the tail water below the gates (the retained pool is
  above eye level there).
- kit retainingSteps (used by siteWorks) puts an areaway wall 1.2 m in front of a pool-side yard door where the bank
  rises above the floor (walkable around its open ends).
- Dorm escape-stair landing doors open into the end-unit room; the kit interior does not know them ('full' furniture
  may stand in front). Real dorm OX1-0.3.11r.x7-n25.n4-2: kit walk check 10/67 rooms (also with the kit's own
  generateResidential — pre-existing, reported).
- OX4 forebay banks shelve gently: the rendered waterline lies ~10 m beyond the nominal pool radius → bridged by the
  intake jetty; a quay at the pump would need terrain / urban data (meta.water has no waterline distance).
- owalk extrapolates the terrain from the footprint corners: stairs that land far from the house (raised-deck
  junction pumps) cannot be verified in Node; app shots were not idle (load ~100, images complete, 0 console errors).
- 08:55 final batch (0 console errors / warnings in all 10 app + bench frames of this round): fix1-app-ox1-sluice-walkway
  (grated walkway + pier nose + retained pool against the structure), fix1-app-ox1-sluice-back (frame taken before
  the last back-camera fix: two stair posts in front of the lens → camera now at the equipment yard's OUTER end, away
  from the deck stair; route re-verified, not re-shot), fix1-app-ox4-meltpump (intake jetty now reaches the waterline),
  fix1-bench-sl-ox1-walkway, fix1-bench-dorm-ox1-gable (stacked escape flights, landing doors, roof ladder),
  fix1-bench-mp-ox4-back. Final build OK (.build/buildings-o). Private server 5212 stopped; scratch removed.
### Verification (fix round 1)
- Node: ocheck 23 bench lots × 3 LODs 0 errors / NaN; oreal S03 (94 water-works specs) and OX4 (277 specs: melt pumps,
  lee greenhouses, insulated stations, dorms) × 3 LODs 0 errors; ocity 914 O buildings × 3 LODs 0 errors; owalk
  shot-07 O route (walkway → duty entrance → stair → control window → back yard) reachable on SL-OX1, SL-OX4-polar,
  OX1-0.3.11t.x8-n1.1-0, -x5-1.0-0, OX1-0.2.iy.gk-3.n6-0, -ix.gl-n1.0-0 (120 m canal), -ix.gl-n2.6-0 (pad),
  -ix.gl-2.1-1 (pad; its back-yard point fails only on the check's extrapolated terrain); kit walk-buildings on
  real dorm -n25.n4-0 101/101 rooms.
- Shots: shots/buildings-o/fix1-bench-{sl-ox1-back, sl-ox1-control, sl-ox1-walkway, sl-ox4-back, sl-ox4-aerial,
  gh-ox4-lee, gh-ox1, dorm-ox1-corner, dorm-ox1-back, dorm-ox1-gable, dorm-ox6-corner, mp-ox4-back}.png,
  fix1-app-{ox1-sluice-overview, ox1-sluice-walkway, ox1-sluice-control, ox1-sluice-back, ox4-meltpump}.png.

## Fix round 2
Started 2026-11-16 14:10 (load avg ~8). Private port 5308. Shots: shots/buildings-o/fix2-*.
Items: ★O1 shot-07 O anchors (QS-04) on OX1-0.3.11t.x8-n1.1-0 + per-view poses for the lead; ★O2 dorm connectivity
(QA-ID-01, kit fixed the plan in parallel → re-run walk-buildings on the 31 QA dorms); O3 floors tables vs spec
(QA-ID-04: insulated_station / pumphouse / meltwater_pump); O4 greenhouse crops at eye level (QY-08).
### Log
- 14:10 read ARCHITECTURE, prompt §5/§6, qa-round1 (QS-04, QA-ID-01/04, QY-08), round2 backlog, building-kit fix-2 notes
  (K1 done: residential_plan core slot / repairDoors graph-based / furniture never blocks doors; "dorm.js needs no change").
  Controls: 'street' / 'entrance' / 'back' are GROUND views (dropped to the analytic terrain + eye, collider ≤ 1.2 m above
  it), every other view is trusted at the anchor position (walk mode on that floor).
- 14:15 ★O1: OX1-0.3.11t.x8-n1.1-0 NO LONGER EXISTS (terrain-fn T1 東泽 basin + urban U7 re-planned S03: ground there
  162 → 125 m, no sluice within 2 km of the old bookmark). Candidates surveyed (.build/buildings-o-dev/ocand.mjs, oxsec,
  ostep): chosen **OX1-0.2.iy.gk-n7.n1-0** (7.142514N 104.944731E, heading 239.44, sluice 102.35 → 92.29 = 10.06 m
  step, retained +3.73 / tail −6.33 m vs the entrance 98.62, 40 m main canal C0-0-196-172, 5 bays, 4 open → big
  discharge, flow along +x = compass 149° (SSE), hydro level step exactly at x = 0, flat house site, levee upstream /
  cutting downstream). Same S03 area (8.4 km from the basin outlet staircase).
- 14:20–14:40 sluice_station.js (fix 2): white water of the open bays (aerated sheet down each chute, boil in the
  stilling basin over the pier wakes, foam streaks downstream; 'plastic_bin' white, tinted water→foam; closed bays calm);
  guard rails round both abutment tops (water faces, downstream drop, land edge; open at deck / walkway / gangway);
  interior stair moved to the side-O wall: flight · half landing · flight (stairLanding), 2.6 m clear before the
  first riser, duty door opens into the duty room (was under the old flight), arrives in the control room; console row
  moved INTO the glazed bay facing the gates; equipment yard may run 4.5 m past the S-side facade end (the access stair +
  back door left no 5.5 m stretch → no yard at all on this station before). New anchors (stair camera LOD-independent).
  CPU ray-cast preview tool .build/buildings-o-dev/oray.mjs (geometry + terrain grid + hydro water, sees through glass)
  used to compose the five views; owalk route reachable (walkway → entrance → stair → control → back yard).
- 14:40 ★O2: kit fix landed; scripts/walk-buildings on the 31 QA dorms: **31/31 fully walkable, rooms 1664/1664**,
  living2F ✓ everywhere. Kit-noted exception OX3-1.3.9.1as-31.0-0 (30.34 × 8.74, 4F): plan.unreachableRooms 24 with
  dorm.js AND as 'residential' (kit plan, shallow depth) → request to building-kit.
- 14:45 O3: insulated_station storeys follow spec (floors ≤ 3, gfh, fh; vault springing = nominal top − rise/2, upper
  decks + small windows), o_pump (pumphouse / meltwater_pump): 1-storey spec = compact single-height pump room, 2+ =
  hall with the raised control room at groundFloorHeight. Census (55 real specs around the QA ids + S03):
  insulated 26/26, meltwater 13/13, pumphouse 15/16 match (the 1 = a 2.13 m meta.pad floor, storeys match).
- 14:50 O4: greenhouse crops: greens = rosettes of curved double-sided leaf blades (butterhead / red oak / romaine /
  pak choi per bed, stage per bed: transplant / young / mature / harvesting gaps, 137.5° spiral, cupped + ruffled
  margins, midrib/blade/margin vertex tints); berries = strawberry plants (trifoliate toothed leaflets on arching
  petioles, fruit trusses over the gutter lip); 'exterior' keeps a light single-sided version. Vines unchanged.
- Browser: MARS_SLOT_CAP is 1 machine-wide now; my 5-view batch waits for the slot (props / controls ahead).
- 14:50 water (parallel fixer, W3) now draws the jets of the OPEN bays (render/water/sluicejet.js replicates gateLayout /
  waterInfo / chute) → my station-side white-water geometry REMOVED again (no double foam); the structure (gate line,
  chute, basin, training walls) is unchanged so their replica stays valid. Water suggested OX1-0.2.ix.gl-1.1-0 (outlet
  main, 132.03 → 123.04) for S07O: there the retained pool is +9.2 m over the station ground, ABOVE the control-room eye
  (+6.45/7.9 m) → the window only sees the access stair + levee (oray preview) → keep OX1-0.2.iy.gk-n7.n1-0 for S07O.
- 14:55 back camera re-composed (off the yard's service-side end, 10.5 m out: kiosk, tank, pool facade + glazed bay +
  back door, deck access stair + gangway); greenhouse vine rows get the bed growth stage (string height, ripeness).
  Build OK (.build/buildings-o). Batch of 7 app shots queued behind the single browser slot since 14:37.
### Pose table (shot 07 O-version, building OX1-0.2.iy.gk-n7.n1-0, time 8.504 = local 15:30)
| view | lat | lon | alt ASL (eye) | heading | pitch | lens |
|---|---|---|---|---|---|---|
| walkway (检修道) | 7.1426692 | 104.9452032 | 105.22 | 46.6 | −12.4 | 24 (28 ok) |
| entrance (值守入口, ground view) | 7.1424644 | 104.9445120 | 100.30 | 47.3 | −2.8 | 28 |
| stair (楼梯) | 7.1425794 | 104.9445706 | 100.52 | 45.8 | 7.4 | 28 |
| control (控制室观察窗) | 7.1426091 | 104.9448058 | 105.07 | 58.3 | −10.1 | 28 |
| back (背侧设备院, ground view) | 7.1424102 | 104.9451397 | 100.42 | 294.3 | 2.3 | 28 |
### Requests (fix round 2)
- lead (bookmarks.js): O07_BUILDING → 'OX1-0.2.iy.gk-n7.n1-0' (old id gone); S07O–S07Oe fallback poses from the table
  above; solTime local(104.9447, 15.5); S07O viewLens 24 recommended.
- building-kit: dorm OX3-1.3.9.1as-31.0-0 (30.34 × 8.74 m, 4 F, O-levee): kit plan leaves 24 rooms unreachable
  (data.meta.unreachableRooms 24, identical when the spec is run as 'residential' → residentialPlan shallow-depth case),
  lobby not reached from the street.
- water: nothing new — sluice_station gateLayout / waterInfo / chute unchanged in round 2 (sluicejet replica valid).
- 14:57 walkway target height now relative to the eye (pitch ≈ −12° on every station, low-head bench lots were −27°).
  Node CPU ray-cast previews of the five S07O views + a greens bed saved as fallback evidence:
  shots/buildings-o/fix2-ray-o7-{walkway,entrance,stair,control,back}.png, fix2-ray-gh-greens.png (material-coded, no
  lighting; the app shots follow when the single browser slot frees — ~10 waiters).
- 15:03 deck-access stair foot now stands on the spec-extrapolated ground at the foot (was the house yard level 0.3:
  on banks falling to the canal the last tread hung ~1 m over the ground — OX1-0.2.iy.gj-n1.5-0 yard → deck route was
  cut); the paved path is a ramp from the ground at the house wall to the foot. Back camera stays on a meta.pad.
  owalk route regression (walkway → duty entrance → stair → control window → back yard) on 40 real sluice stations:
  38/40, the 2 misses are only the back-yard point on perched-levee sites (owalk's corner-bilinear terrain vs kit
  groundAt, ±0.6 m tolerance; the app drops the 'back' ground view on the analytic terrain). 315 real sluice stations ×
  3 LODs: 0 errors / NaN; 1040 O water-works / greenhouse / dorm / insulated specs × 3 LODs: 0 errors.
- 15:55–16:12 APP batch 1 (port 5308, workers=2, load 60–140, never idle; 0 console errors / page errors in all 6):
  shots/buildings-o/fix2-o7-{walkway,control,stair,entrance,back}.png, fix2-gh-greens-living.png. FINDING (controls,
  cold landing under load): the building was not streamed and the controls' worker 'building' anchors job did not
  return (≈ 300–400 pending jobs) → buildingView knew only the spec-synthesised views (street / entrance / back /
  roof): 'walkway' / 'control' → "has no view" → the bookmark's stored pose was used (= my anchor poses → frames
  correct: walkway shows the retained pool beyond the raised leaves on the left at deck level and the basin ~11 m
  below on the right; control looks through the bay glazing over the console row at the gate structure + gantry with
  the upstream pool on the left), but 'entrance' / 'back' used the SPEC-SYNTHESISED views (the workshop 'main' door,
  not the duty door) and 'stair' silently fell back to that synthesised entrance (fallback chain stair → lobby →
  entrance) → those 3 frames are not my anchors. Batch 2 (direct poses: stair / entrance / back / control / greens)
  queued. Water W3 jets render as smooth greenish sheets in the basin (little white aeration, no visible roller) and a
  props tree stands right outside the control bay (right third of the control frame).
- 16:10 control look re-aimed at the gate line (target x −3.5, pitch −10: heading 58.3, keeps the tree at the edge);
  console screens dimmed (o_hall consoleDesk 'light_cyan' tint 0.35/0.6/0.75 → 0.1/0.17/0.22: by day they read as
  bright blank panels).
### Requests (fix round 2, added after the app batch)
- controls (buildingView, cold bookmark landings under load): when the building's own anchors are not available yet
  (not streamed + worker 'building' anchors job pending / timed out), a bookmark with a stored pose should use that pose
  instead of (a) the spec-synthesised 'entrance' / 'back' views (they frame the spec's 'main' door — for a sluice station
  the workshop door, not the duty 'control' door) and (b) the view fallback chain (stair → lobby → entrance); or wait for
  the anchors with the bookmark's waitMs before choosing. Seen on all S07O-type frames at load ~100 (S07Ob / S07Oc / S07Oe
  framed the workshop door).
- water (W3 sluicejet): at the S07O walkway pose (station OX1-0.2.iy.gk-n7.n1-0, 4 of 5 bays open, 10.06 m step) the jets
  read as smooth greenish inclined sheets in the stilling basin, little white aeration and no visible roller — the drop
  is 10 m, the jet should be white water by the toe (shots/buildings-o/fix2-o7-walkway.png, lower right).
- props: a tree stands right outside the sluice house's glazed control bay (between the pool facade and the canal),
  covering the right third of the control-room frame — keep trees out of water-works yards on the water side
  (building frame z < −d/2 up to meta.water.dist − width/2).
- 16:17–16:24 APP batch 2 (direct poses, final code; 0 console errors / page errors): fix2-pose-stair.png (level view:
  flight 1 · half landing · flight 2 to the control floor door ✓), fix2-pose-entrance.png (duty door: glazed door,
  canopy with downlights, wall lamp, nameplate, notice board; the interior stair visible through the window ✓),
  fix2-pose-back.png (equipment yard: transformer kiosk + tank, pool facade with the glazed control bay on its
  cantilevers, back-door canopy, deck access stair + gangway ✓), fix2-pose-control.png (through the bay glazing over
  the console row: retained pool with reflections on the left = the same level the walkway shows, gate frames / deck /
  gantry, gangway; a props tree at the right ✓), fix2-pose-gh-greens.png (greenhouse beds: young green rosettes left,
  mature red oak-leaf rosettes right — real leaf shapes ✓). Console screens still glow light cyan ('light_cyan'
  emissive ignores the tint) — harmless.
- 16:25 final: build OK (.build/buildings-o), private dev server 5308 stopped, no browsers of mine running.
### Verification (fix round 2)
- Node: bench ocheck 24 lots × 3 LODs 0 errors / NaN; 315 real sluice stations × 3 LODs 0 errors; 1040 real O specs
  (water works, greenhouses, dorms, insulated stations) × 3 LODs 0 errors; owalk S07O route on the chosen station ✓ and
  38/40 real stations (2 = check artifact at the back-yard point); walk-buildings 31 QA dorms 31/31 (1664/1664 rooms);
  floors census 54/55 match (1 = meta.pad floor).
- App: shots/buildings-o/fix2-o7-{walkway,control}.png (bookmark-style landing; stored poses), fix2-pose-{stair,
  entrance,back,control,gh-greens}.png (direct poses). Node ray previews fix2-ray-o7-*.png, walk maps fix2-walk-o7-floor{0,1}.png.
