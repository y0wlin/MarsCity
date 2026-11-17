# controls — progress log

Owner: controls agent. Files: src/controls/* (CameraRig.js, index.js, ground.js, collide.js,
transition.js, lookat.js, math.js, help.js, modes/{orbit,fly,walk,focus}.js), dev/controls.html,
src/dev/controls.js, dev/controls-verify.mjs (verification driver). Private port 5184.

## Status (2026-11-16, resumed instance)
Earlier instances (stopped by usage limits) wrote all modules; no notes file existed. Files are
identical to git checkpoint 2f21c71. This instance: audit → fix → verify → report.

## Done (from code audit)
- Orbit: sphere trackball grab, zoom-to-cursor (exp., inertia, floor/ceiling clamp), rotate/tilt about
  centre ground point, auto-tilt < 50 km, keys, N/U, inertia, double-click fly, sky dolly, landing.
- Fly: 6-DOF, speed ∝ hAG, Shift/Alt, pointer lock, sweep + sphere colliders, horizon lock (L).
- Walk: capsule vs BVH colliders, step 0.35, slope 40°, gravity, jump, water, guardWalls fallback.
- Focus: orbit building, presets 1–5, eye viewpoints 6–9, spring arm vs neighbours, Enter → walk.
- Transitions: VWN arc + glide, lens log-interp, back stack, flyPath, camera:arrive.
- Picking: city > mega > terrain/water location, hover throttled, click/drag/double-click, touch.
- UI requests 1–7 handled (inUi / isInteractive guards, Tab only when view active, canGoBack,
  setMode('focus') w/o target → false, Promises).

## Audit / remaining
(see below, updated as work proceeds)

### 02:50 audit
- numeric bench (dev/controls.html, 39 checks) on private server 5184: 39/39 pass (old code).
- City notes report: buildingView('living') chose orbit in the real city — standability used
  city.raycast (mass hull) instead of the walk colliders. FIX (02:55): ControlsSystem.walkFloorBelow()
  (colliders → hull fallback → terrain/water), used by buildingView standability, _switchMode('walk'),
  _arrive walk checks and _dropToWalk('below'); WalkMode.updateHull(): picking hull carries the walker
  on roofs / decks whose colliders are not loaded yet (no fall-through). Ground.hullBelow(), collider _src tag.
- 03:00 added debugLayer 'wireframe' overlay of the walk colliders near the camera (< 400 m above
  ground; city cyan, mega magenta; hidden in clean mode) — ControlsSystem._updateDebug (runs in _post).
- city suite (real city, private server) running: shots/controls/city3/.
- 03:12 city suite run 1 (walkFloorBelow fix in): district/focus/presets/door/living/stair/back/revisit shots
  in shots/controls/city3. Found: (a) walker stopped at the glass entrance doors (Node sim of the real
  WalkMode vs kit colliders walks straight in for residential / tower / office / school → app-side
  cause: colliders late (guardWalls on the mass hull) or street colliders — checking JSON);
  (b) focus presets / revisit pressed the camera against the facade in dense blocks (spring arm).
  FIX (b): FocusMode.clearElevation() — presets 1–4 and the focus flight rise until the building is
  seen over its neighbours; after arrival an auto-rise (5 s, cancelled by input) handles neighbours
  that stream in late. (c) TAA never converged in walk / focus (rig touched every frame) → FIX:
  CameraRig.setStateIfChanged() used by walk.writeCamera and focus.update.
- 03:20 verify script: partial report saved every 5 s (shots/controls/<out>/report-<suite>.json),
  watchdog (--maxMin, default 55), browser.close() bounded; city suite: walk-in diagnostics (own
  colliders, wallGuard count), stair test turns when the anchor looks along the stair well, resting
  walker must not bump rig.version. Node walk sim (scratchpad walksim.mjs, real WalkMode vs kit
  colliders): residential / tower / office / school main doors are walkable; residential 'stair' anchor
  (ZR1-0.3.1ai.189-6.n12-2) looks along the well → walking straight ahead hits the well blocker box
  (kit request). Old screenshots removed (kept audit3, city3, main4 until the new main run, bench-visual).
- 03:25 numeric bench rerun with all changes: 39/39 pass (controls EMA 0.09 ms/frame). Build OK
  (npx vite build --outDir .build/controls, 1 m 19 s). Added 'controls:hint' {kind:'building-loading', id}
  event (walker held at a facade whose interior is still loading) + help lines. city4 + main5 suites running.
- 03:32 city4: clinic ZR1-0.3.1ai.189-10.n9-0 picked/hovered/focused (lod full); back preset rose to
  38° and frames the whole back facade over the low neighbours (city3: camera pressed against it).
  clearElevation now also probes ±12° side rays (a neighbour beside the camera filled 1/3 of c01).
  Node walk sim: clinic main door walkable (stops 2.6 m inside at a 0.9 m counter).
- 03:38 city4 results: Enter → walk at the clinic door (own colliders, facing 0.998); walking in
  through the door → 2.3 m inside, stops at the reception counter (= Node sim), feet error 0, no
  wall guard; resting walker leaves rig.version unchanged. city3's door stop = colliders not loaded yet
  under load avg 200 (by design). Front preset (old code) went to 62° (buildings across the street
  block low views at the full framing distance) → clearElevation now takes a low street view at
  ≥ 55 % of the framing distance when no full framing appears within +18°. 'living' on a clinic fell
  back to 'stair' → fallback order now living → interior → stair → lobby → entrance.
  enterBuilding standoff 2.4 → 3.4 m (door leaves + steps + lobby in one frame, §5 07 定格二).
- 03:45 city4 summary: 7/8 checks (pick+hover, Enter→focus, presets back/roof/front, Enter→walk at the
  door with own colliders, walk in through the door, resting walker static, stairs climbable (1.05 m),
  home + revisit by ID). The failing 'upper floor' check used a clinic (no 'living' anchor → stair
  fallback, ground floor). Test now visits a residential candidate for 'living'; buildingView waits
  for the 'full' LOD before deciding walkability of interior / roof views (colliders decide).
  main5 suite running (m01 full disc OK; m02 at 30 km: terrain still streaming under load avg 200).
- 03:50 main5 (real app): zoom-to-cursor 0 px at orbit and regional altitude (in/out), drag 0 px
  (region, canyon), flyTo exact (posErr 0, angErr 3e-17), back() exact, dive stops 1.7 m before a
  warehouse parapet (31 m above ground; buildings stop the zoom), walk drop to the street + run 4 s
  (feet error 7e-10; stands on the pavement collider 0.12 m above the terrain mesh → old check too
  strict, updated), focus front = near street view (new rule), Enter → door of the residential with
  stair + lift visible through the glass (§5 07 定格二).
- 03:53 main5 finished: 15/18 with the old checks; the 3 misses are test thresholds made obsolete by
  real-city geometry / today's changes (sky wheel started at 31 m on a roof edge, walker on the
  pavement collider 0.12 m above the terrain mesh, door distance 4.501 vs 4.5 after standoff 3.4 m) —
  checks updated (sky: h1 < max(6, 1.15·h0); walk: standing surface; door < 5.5). Also: pole drag
  0 px / roll 0, Tab cycle, UI 步行 button, agl walk 1.65, flyPath exact, pick location + hover
  clear, water pick/grab/walk-drop, home() 9,500 km over the same lat/lon. controls EMA 0.17 ms/frame.
  city5 (latest code) running.
- 03:56 build OK (38.9 s). Debug collider overlay now keyed by collider mesh (systems return fresh
  wrapper objects per query). city5 running with the latest code.
- 04:03 city5 (latest code): focus / back (38°) as city4; front preset now 30° (near rule) showing the
  whole 7-storey clinic facade with canopy + cross sign (city4: 62° near top-down).
- 04:13 city5 summary (latest code): 8/9 — pick/hover, Enter→focus + presets, Enter→walk at the
  door (3.55 m, own colliders), resting walker static, debug collider overlay on (7 meshes) / hidden
  in clean, 'living' on residential ZR1-0.3.1ai.189-9.n9-4 → WALK mode on the 2nd-floor floor
  (feet local y 4.05, stays after strafing) = the city-notes 'living→orbit' bug fixed, stairs +1.16 m,
  back, home + revisit by ID. The walk-in check failed on time only: app at 2.3 fps → 7 s wall-clock
  = 1.6 s simulated, 2.2 m walked of the 3.4 m standoff (city4 passed the same door); test now walks
  by simulated progress. Found: debugLayer 'wireframe' throws in WebGLShadowMap every frame
  (city mass meshes switched to wireframe after their CPU index arrays were released →
  updateWireframeAttribute null.length) → no frame renders while that layer is on (city request).
  Overlay colour now divided by the pipeline exposure. Walk substeps capped at 6 / frame (controls
  frame max 316 ms at 2 fps with 12 substeps). Final numeric bench + build running.
- 04:16 final build OK (6.7 s, .build/controls). Final numeric bench run in progress.

## Remaining / known issues (for QA)
- Walking into a building needs its 'full' LOD colliders: until they stream in the walker is held at
  the facade ('controls:hint' event); minutes under extreme machine load.
- Focus framing in dense blocks: elevation search (axis + ±12° rays) or a low street view at ≥ 55 %
  of the full framing; a neighbour outside ±12° can still crowd the frame edge; auto-rise only 5 s.
- Kit: 'stair' anchors look along the stair well; entrance doors drawn closed (walker passes the
  glass); walk-buildings.mjs uses r 0.22 / step 0.42 vs controls 0.28 / 0.35.
- City: debugLayer 'wireframe' throws in WebGLShadowMap (released index arrays) → frames abort, so the
  controls collider overlay could only be verified structurally.
- Pointer lock / trackpad / Safari gestures verified only with synthetic events (headless).
- main5 / city5 checks updated after the runs (thresholds, simulated-time walk-in) were not re-run.
- 04:19 FINAL: numeric bench with the final code 39/39, no console errors (controls EMA 0.07 ms,
  max 33 ms). Build OK. Private server (5184) stopped; .build/controls-dev keeps only its vite config.
  Screenshots kept: shots/controls/{audit3 (report-numeric.json), city4, city5, main5, bench-visual}.
  Report delivered.

## Fix round 1
Private port 5201 (dev server, hmr off: `npx vite --config .build/controls-dev/vite.config.mjs`).
Shots: shots/controls/fix1-*.
- [05:10] started. Plan: ★1 programmatic pose hold (requested position remembered, analytic floor,
  return when refined) → ★2 building-view bookmarks via controls.buildingView → 3 fly below water →
  4 enter-building re-test (after kit opens the doors) → 5 re-run changed main5/city5 items → capture verify.
- [05:30] ★1 implemented: programmatic pose HOLD (index.js _setHold/_holdOn/_holdFloor/_clampHeld,
  releaseHold, holdInfo, cameraInfo().hold). Set by every external rig write (_externalChange: URL
  pose, bookmarks, __MARS__.goto, UI) and every flight arrival (_arrive); released by user input
  (interrupt) and new flights. Held poses are checked against the FINAL ground: Ground.analyticAt
  (terrain.heightAtLatLon full detail + hydro waterAt) + Ground.structureBelow (walk colliders, else
  picking hulls below); HOLD_CLEAR 1.0 m (eye-level poses never lifted); re-measured 60 ms while lifted /
  250 ms otherwise → returns as soon as the refined floor allows. clampAbove (orbit/fly), _safety and
  focus use it; coarse tiles never lift a held pose. Walk: a walking arrival (flight with mode walk, or
  an eye-level external pose in walk mode) stands on analytic terrain + colliders and is pinned at the
  requested feet height while nothing carries it (room colliders still streaming) — no fall-through.
  Node mock (scratchpad holdsim.mjs): S05 coarse tile 147 m → stays 25.000; deck 0.5 m below → 25.5 → back
  to 25.000 when removed; input → normal clamp; S06 stays 1122.000; walk pinned 545.860; fly dives to −3.6 m,
  orbit pops back to +1.7.
- ★2 implemented: App.applyBookmark (building views) → controls.buildingView(id, view, {lens, pitch,
  instant, bookmark, waitMs 90 s when instant}); buildingView: waits for the building to stream + reach
  'full' (bookmark landings), else generates the kit anchors in a pool worker ('building' exterior);
  ground views stand on analytic ground + colliders; room views on the collider storey floor, or (colliders
  not streamed) trust the anchor's storey floor (walk + trustFloor: _arrive does not drop to the ground);
  opts.pitch overrides the anchor pitch (S07 viewPitch 7); instant = duration 0, no door / orbit detour.
- 3 fly mode: clampAbove / zoomTowards / sweep / _safety ignore the water surface (dives below it).
- [05:50] run-a (my suite: dev/controls-verify.mjs --suite bookmarks, fresh page per bookmark like
  capture-shots, workers=2, load avg 40–145): S05 alt 25.000 (= bookmark, hold lifted 0), S09c 27.600
  (= mega view, office floor 25.9 below), S07c FAILED 558.26: the walker stood on the 2nd-floor slab of a
  building the city had SEATED 12.4 m up onto still-coarse terrain (render/city tiles.js seatSample:
  buildings follow terrain.groundHeightAt of the finest LOADED tile, ±60 m, animated 25 m/s) and rode up
  with it. FIX: requested poses come from final geometry only — kit camera anchors (building frame) for
  room / roof views (trusted: walk, no collider snapping) and the analytic terrain (+ a kerb / step
  collider ≤ 1.2 m above it) for street views — and a held walker is FROZEN at the requested pose
  (WalkMode._freeze: no physics until user input). Re-run (trace of every rig write, diag-s07c.mjs):
  S07c → walk mode at 545.860 exactly (2nd-floor living room, train + platform roof seen through the
  window, foliage / frames hide the lower part) — shots/controls/fix1diag/S07c.png.
- [06:24] walk freeze restricted to final-geometry arrivals (flyTo opts.holdWalk: buildingView passes
  it; enterBuilding / walk drops / double-click walks keep normal physics on arrival — their targets come
  from the loaded tiles). Build OK (.build/controls, 43 s).
- run-b (same suite, load avg 120–240, workers=2, waitIdle 150 s never idle under that load): S06 1122.000
  (= bookmark; was lifted to 1734), S07 542.020 walk (= buildingView request: street eye on the analytic
  ground / kerb), S07b 541.875 walk (doors now open: mailboxes + core visible), S07d 541.636 walk, S08b
  743.500 (= g02-dam50 mega view), trace max after goto = the request (no transient lift) — 5/5. run-a:
  S05 25.000, S09c 27.600 (office window frame, ferry + cargo ship). Shots shots/controls/fix1a, fix1b.
  NOTE for the lead: S06's pose (1122 m) is 1.37 m above the analytic ground — a street-level corner in
  the canyon town, not the mid-slope terrace looking along the valley (the old frame was the lifted one).

### Requests (fix round 1)
- lead (app/bookmarks.js): (S06 re-aimed by the lead at 07:08 → 1175 m, lands exactly there.) S07–S07d keep
  `mode: 'orbit'` in the data but arrive in
  walk mode via buildingView (consider `mode: 'walk'` for the UI's sake). S08b's fallback pose (634.5 m)
  is stale vs the g02-dam50 view (743.5 m) — harmless (the mega view wins).
- megastructures / props: the two-step goto / "re-apply the pose after idle" workarounds are no longer
  needed — programmatic poses are held at the requested position (D6).
- water: fly mode may dive below the surface now — verify the underwater fog with
  `__MARS__.app.controls.setMode('fly'); __MARS__.goto({lat, lon, alt: -4, heading, pitch: -5})`
  (a held pose in fly mode stays under water) or by flying down with C.
- city (info): tiles.js seatSample seats buildings onto terrain.groundHeightAt of the finest LOADED tile
  (±60 m); under heavy load the S07c building sat 12.4 m high for minutes and its walk colliders with it.
  Controls no longer lets programmatic walkers ride such colliders (requests come from kit anchors +
  analytic ground); a visitor walking inside a building whose terrain has not refined still meets
  displaced floors (consider seating 'full' LODs / walk colliders on the analytic ground near the camera).
- [06:50] hold safety: an external pose write in the same frame as user input (or while keys / drags are
  active) does not start a hold (_inputSeen); WalkMode.setLook marks its rig write as internal. Mock
  re-run OK; build OK again (22 s). Numeric bench queued since 06:24 (machine slots cut to 2, load
  60–240) — see below for its result.

### Status / remaining (fix round 1)
- DONE: ★1 hold (all bookmark altitudes = requested ±0.000 m in runs a/b), ★2 building-view bookmarks via
  buildingView (S07 / S07b / S07c / S07d walk mode; S07c on the 2nd floor), 3 fly below water, 4 doors
  open (kit, landed 05:45) — S07b shows the open leaves, mailboxes and core through the door.
- NOT RE-RUN this round (machine overload, 2 browser slots for 13 engineers): city / main suites
  (enter-building walk-in through the now-open door, item 5) — QA please run
  `node scripts/slot.mjs -- node dev/controls-verify.mjs --base <port> --suite city` (and `--suite main`).
- Known: a held room view sits at the building's FINAL height; while the city still seats that building on
  coarse terrain (heavy load) the camera can be inside its displaced shell until the terrain refines.
- [07:04] numeric bench (dev/controls.html, final code): 39/39 checks, no console errors
  (shots/controls/fix1num/report-numeric.json). Official capture-shots batch started (waiting for a slot;
  --idle 120000 to stay in the time box) → shots/controls/fix1-cap/report.json.
- [07:31] OFFICIAL capture (scripts/capture-shots.mjs --only S05,S06,S07,S07b,S07c,S08b,S09c --query
  "&workers=3" --idle 120000; report shots/controls/fix1-cap/report.json): final alt S05 25.000, S06 1175.000
  (the lead re-aimed S06 at 07:08: 1175 m, pitch −5 — matches), S07 542.020, S07b 541.875, S07c 545.860
  (walk, 2nd-floor living room), S08b 743.500, S09c 27.600 = requested / resolved altitudes (0.000 m);
  no console errors; NOT-IDLE everywhere (120 s cap at load avg 20–150). Private server stopped.

## Fix round 2
Private port 5312 (build .build/controls + vite preview, or dev server with hmr off from .build/controls-dev/).
Shots: shots/controls/fix2-*. Items: ★CT1 consecutive building-view bookmarks (QS-03), ★CT2 walk ground on the
analytic terrain (Z-02), CT3 buildingViews(id) beyond focus mode (ui request); then QA addendum QP-02/03/04 if time.
- [13:59] started (load avg 16). Root cause CT1 (code reading, evidence runC.log: every 2nd goto r:false at once):
  for a building that is already streamed at 'full', buildingView resolves entirely in microtasks (city.focusInfo
  has no worker job, _fullInfo returns at once, anchors cached) → its flyTo(duration 0) is created in the SAME task
  as applyBookmark's provisional rig.setPose(bm.pose) → the next controls.update sees rig.version changed →
  _externalChange() → _endTransition(false, 'external') → {arrived:false, interrupted:'external'} → applyBookmark
  `return false` with the camera left at the provisional (fallback) pose. Cold first visits wait for workers, so the
  provisional write is processed before the flight → only the first works.
  Root cause Z-02 a-rock-start: URL pose + mode=walk → setMode('walk') → _enterMode → _markInternal swallowed the
  pending external pose (no hold) and WalkMode.groundAt = max(finest loaded tile, analytic) → stood on the L4 tile.
- [14:08] CT1 code: ControlsSystem._absorbExternal() (processes a pending external rig write at once) at the entry
  points flyTo / setMode / _beginFocusReq and in update (_inUpdate guard: writes made inside update stay internal);
  _externalChange also cancels a pending focus / view request ('external'); every request loss carries its reason
  (_cancelFocusReq(restore, reason), _reqLost → 'pointer' | 'wheel' | 'key' | 'gesture' | 'api' | 'cancelled' |
  'flight' | 'superseded' | 'external'). App.applyBookmark (my exception): bookmark token (newest wins, megaView /
  fallback paths too), retry ≤ 2× for non-user interruptions that left the camera where the request started,
  console.info for every false result. URL pose + &mode=walk: _enterMode('walk') upgrades the external hold to a walk
  hold (eye-level pose kept until input).
  CT2 code: Ground.walkTerrainAt (terrain.heightAtLatLon, 12-entry ring cache) used by WalkMode.groundAt /
  terrainSlope, walkFloorBelow, _dryHeight, _dropToWalk (centre hits re-seated by _walkGroundPoint, below = walk floor),
  _standPointNear (walk floor in front of the wall), _walkTo, enterBuilding, _doorPath.
  CT3 code: _rememberInfo / _knownInfo (24-entry id cache, kit cameras kept when newer data lacks them), buildingViews
  answers for cached ids, _wantViews (background refresh: getFocusInfo once the city has 'full', else kit anchors from
  a worker; ≥ 2 s apart), _refreshFocusViews in update (focused building, every 0.5 s).
  Node mock (scratchpad controls-fix2/ct1sim.mjs: provisional pose + buildingView in the same task, 9 views on two
  buildings in a row): 9/9 arrived at the requested alt (before: every 2nd would be 'external'); newer request →
  older 'external' + newer arrives; raw pose during a wait → 'external'; buildingViews(A) unfocused → 7 views;
  walker with tiles 147 m above the analytic ground: URL pose + walk → walk hold, 8 s of W: feet − analytic 0.000,
  drop to walk from 300 m → eye 1.650 above the analytic ground.
- [14:11] ARCHITECTURE §8 controls: fix round 2 paragraph. Build OK; preview on 5312; dev/controls-verify.mjs gains
  --suite sequence (one page, S07…S07Oe) and --suite walkground (Z-02 poses, W/D walk trace vs heightAtLatLon).
- [14:17] QP-03 (QA addendum) code: ControlsSystem._clearGroundView(id, eye, target) — ground views (street /
  entrance / back) are tested against the streamed neighbours' PLAN footprints (city.findBuildings specs: rect or
  footprint.points, roof = ground.entrance + specHeight): eye inside / within 1.2 m of one, or the sight line to the
  anchor target crossing one below its roof → the eye slides towards the building (×0.85…0.34) and round the target
  (±8…35°), cheapest clear candidate on dry ground; buildingView waits ≤ 20 s (bookmarks) / ≤ 3 s for the building's
  tile so the neighbours are known; result carries `adjusted {moved, reason}`. Node (real urban plan + kit anchors,
  qp03sim.mjs): ZR1-…n1.4-9 street was inside n1.5-1 → moved 6.7 m; OX3-…n8.3-1 street inside n7.3-3 → 3.4 m, back
  inside n8.3-4 → 2.0 m; ZR2-…n4.3-11 street inside n3.3-1 → 3.4 m, back inside n4.3-14 → 3.7 m; S07 building
  (street / entrance / back) clear → S07 / S07b / S07d unchanged. Street trees are not tested (no props query).
  Build 2 OK; sequence suite waiting for the single browser slot (props batch holds it).

- [14:30] ★CT1 browser run (shots/controls/fix2-seq/report-sequence.json, ONE page, workers=2, idle cap 45 s, load 5–30):
  S07 true (40.8 s cold: spec + tile streaming) → S07b true (1.6 s) → S07s true (1.4 s) → S07c true (1.2 s, 2nd-floor
  living room 545.86, station roof + train through the window) → S07d true (0.5 s) — every one in walk mode exactly at
  the controls' resolved viewpoint (hold 'bookmark', err 0.000), centre pick = ZR1-0.3.1a5.17w-n8.n6-7 (22.5 / 12.3 /
  6.1 / 3.9 / 12.7 m); buildingViews(S07 building) = all 7 views outside focus mode (CT3). Shots fix2-seq-S07b/c/d.png.
  (QA: every 2nd one false.) S07d: a street-tree trunk stands in front of the back door (trees are not tested).
  S07O…S07Oe resolved true but via the stored pose: `[controls] buildingView: no data for building
  OX1-0.3.11t.x8-n1.1-0` — that building no longer exists in the plan (buildingSpecById → null; urban-2.2.0 has NO
  building within 400 m of the shared fallback pose, terrain there 126.2 m vs the old 160 m sluice levels; nearest
  sluice stations: OX1-0.2.ix.gl-1.1-0 4.8 km, OX1-0.2.ix.gl-n3.2-0 4.9 km) → lead must re-target S07O* (request).
  The walker then fell from the fallback pose (37 m above the terrain) to the ground — correct walk physics.
  Re-run queued with --o07 OX1-0.2.ix.gl-1.1-0 (S07O* views on a current sluice station, one shared fallback pose).
- [14:34] CT3 Node mock (ct3sim.mjs: focused building 'exterior' → 'full'): buildingViews street/entrance/back/roof
  (spec stand-ins) → all 7 views within one refresh tick (_wantViews runs at once when the building's LOD changed,
  else ≥ 2 s apart) and still answered after leaving focus (remembered info). A rebuild at 14:34 failed on
  src/render/water/material.js:377 (water fixer mid-edit, not mine) — the 14:21 build (everything except this
  refresh-timing tweak) stays deployed on 5312 for the queued runs.
- [14:54] CT2 Node run on the real terrain function with "loaded tiles" = heightAt band-limited at 4 km (ct2sim.mjs,
  the three Z-02 repro poses, URL pose + walk, 8 s W + 4 s D/A): the coarse surface stands 180 / 0.3 / 354 m above the
  real ground there; feet − analytic ground max 0.0000 / 0.0000 / 0.0004 m over 360 / 240 / 360 grounded samples,
  12.5 / 11.1 / 10.6 m walked (QA: lifted 146–206 m, fell 69–185 m). Found: QA's poses 1 and 2 are now 88.2 m / 1.56 m
  BELOW the current analytic ground (made on the older terrain) — the new walk-hold upgrade first froze the walker
  underground there → _eyeLevelPose(p): an external pose is held for walking only when the eye is ≥ 1.05 m and < 8 m
  above the final floor below it (used by _externalChange and _enterMode); a pose below the ground puts the walker
  on the ground (eye 1.650 above the analytic ground at all three poses). Build 8 OK (14:54).
- [15:12] Browser chain on the second machine-wide slot (MARS_SLOT_CAP=2 per the brief's "2 browsers"; slot0 was held by
  other fixers for 20+ min; load avg 4–7):
  ★CT2 walkground (shots/controls/fix2-walk/report-walkground.json, Z-02 poses 1 + 2, cold page, URL pose + &mode=walk,
  30 s, then W 8 s + D 4 s): start eye 1.650 above the analytic ground at both (the terrain chain was still at nadir
  L0 / L4 with a datum shift of +871 / −211 m); while walking the coarse tiles stood up to 707.8 m above the real ground
  and the feet stayed on it: max |feet − heightAtLatLon| 0.000 m on every terrain sample; ends at nadir L17 / L15, eye
  1.650 — 2/2. (QA: lifted 146–206 m, fell 69–185 m.) Shots fix2-walk-start/end-0/1.png.
  QP-03 clearview (fix2-clear/report-clearview.json): ZR1-…n1.4-9 street (was inside n1.5-1) moved 6.71 m → centre pick
  = the building at 18.7 m; OX3-…n8.3-1 street (inside n7.3-3) 3.35 m → itself at 19.2 m (canopy, open doors, steps,
  ramp in frame), back (inside n8.3-4) 1.99 m → 11.2 m; ZR2-…n4.3-11 street (inside n3.3-1) 3.35 m → 19.7 m, back
  (inside n4.3-14) 3.68 m → 8.8 m — 5/5 (QA picked the neighbours at 0.16–5.1 m).
- [15:21] ★CT1 re-run, ONE page (fix2-seq2/report-sequence.json, --o07 OX1-0.2.ix.gl-1.1-0 because the bookmarked S07O*
  building no longer exists): S07 true (46.9 s cold) → S07b 2.2 s → S07s 2.0 s → S07c 1.4 s → S07d 1.8 s → switch
  building: S07O 8.1 s → S07Ob 0.26 s → S07Oc 0.27 s → S07Od 0.46 s → S07Oe 0.27 s — all true, walk mode, held 'bookmark'
  exactly at the resolved viewpoint (err 0.000), the five S07O* views (ONE shared fallback pose) at five distinct
  viewpoints 8.5–39 m from it, centre pick = the S07 building / the sluice station; no '[bookmark] …' interruption
  message; 12/12 checks, 0 console errors. Shots fix2-seq2/fix2-seq-S07Ob/Oc/Od/Oe.png (S07Ob: duty entrance with
  steps and canopy; S07Od: control-room window with monitors over the walkway and the canal).
- [15:30] Numeric bench (dev/controls.html on a dev server, port 5312): first run 38/39 — 'walk: door → stairs → upper
  floor, feet on the ground' groundErrMax 20 m = WalkMode._freeze left info.groundH stale (the bench writes a pose +
  setMode('walk') → now a walk hold; the first sample after the key press read it) → _freeze sets info.groundH; re-run
  39/39, 0 console errors. Final build `npx vite build --outDir .build/controls` OK (4.5 s). Servers / browsers stopped.

### Status (fix round 2, 15:31)
- DONE + verified in the app: ★CT1 (S07 → S07b → S07s → S07c → S07d → other building ×5, one page: all true, at their
  viewpoints), ★CT2 (Z-02 poses: feet on the analytic ground while coarse tiles stood up to 708 m off), CT3
  (buildingViews outside focus mode in the app; 'full' refresh in the Node mock), QA addendum QP-02 (same root cause as
  CT1) and QP-03 (5/5 QA viewpoints now stand free, centre pick = the building).
- NOT DONE: S07O* bookmarks themselves (stale building id → lead), street trees in QP-03 (no props query), QP-04
  (drawn scene: terrain-render R1 + city seating).

### Requests (fix round 2)
- ui (QP-02): the revisit itself is fixed (same root cause as CT1: the 2nd building-view bookmark of a session
  resolved 'external' at once). `saveAllViews` still stores a generic fallback pose (three-quarter / entrance); please
  store each viewpoint's resolved eye pose instead (after `controls.buildingView(id, view)` resolves: `r.requested`
  {lat, lon, alt} + `rig.getPose()` heading / pitch / lens), so even a fallback lands at the right place.
  `controls.buildingViews(id)` now answers for the buildings of the last buildingView / enterBuilding /
  getFocusInfo calls and refreshes itself in the background (kit / 'full' anchors) — keep polling it while the
  panel is open. buildingView results may carry `adjusted {moved, reason}` (QP-03 eye moved off a neighbour).
- lead (app/bookmarks.js): S07O / S07Ob / S07Oc / S07Od / S07Oe reference OX1-0.3.11t.x8-n1.1-0, which the current
  plan (urban-2.2.0 + this round's terrain) no longer contains — no building within 400 m of their fallback pose; the
  nearest sluice stations are OX1-0.2.ix.gl-1.1-0 (7.254696, 104.884412, 4.8 km) and OX1-0.2.ix.gl-n3.2-0 (4.9 km).
  Re-target them (scripts/find-shots.mjs) and give each its own fallback pose (all five share one).
- props (QP-03 c, optional): a query of street trees near a point (`props.treesNear(ecef, r)` → [{ecef, crownR,
  height}]) would let eye-level viewpoints avoid a trunk / crown in the middle of the frame; today only buildings
  (plan footprints) are tested.
- city / terrain-render (QP-04): the held camera stands on the final ground; what remains of QP-04 is the drawn
  scene (coarse tiles / seated masses) — terrain-render R1 (datum shift at the nadir) + city seating near the camera
  on `terrain.groundHeightAt` (includes the shift) or the analytic ground.

## Fix round 3
Private port 5312. Shots: shots/controls/fix3-*. Items: ★CT1 cold-start building-view bookmarks without anchors (buildings-o
S07Ob / Oc / Oe at load ~100: spec-synthesised entrance / back views and the stair → lobby → entrance chain were used),
CT2 props.treesNear in the eye-view occlusion check (QP-03 trees). Browser budget: ONE slot machine-wide → Node first.
- [21:10] started (load avg 15–77). Root cause CT1 (code reading + buildings-o 15:55 batch): cold landing → city.focusInfo gives
  the spec only → `_fullInfo` returns at once (not streamed, waitMs 8 s < 15 s) → `_anchorsById` submits the kit 'building' job
  on the shared pool at priority −100, behind every terrain tile whose SSE priority is < −100 (chain −2e6, roots −3e6, near
  tiles −ratio) → at load ~100 with 300–400 queued jobs it times out (45 s) → buildingView falls back to the spec-synthesised
  'entrance' / 'back' (the spec's 'main' = workshop door) and the stair → lobby → entrance chain; the stored bookmark pose
  (= the asset anchors, buildings-o pose table) was only used for names the spec cannot synthesise ('walkway', 'control').
- [21:20] CT1 code (src/controls/index.js): VIEW_JOB_PRIORITY −2.5e6 for the viewpoint jobs (kit 'building' anchors job,
  spec by id): ahead of the terrain chain (−2e6) and near terrain tiles (−SSE ratio), after the six roots (−3e6) — one job
  of 5–60 ms. `_anchorsById(spec, {priority, timeoutMs})`: one in-flight job per building (a later, more urgent caller
  raises the queued job's priority; a timed-out job is not cancelled, it fills the cache). buildingView: anchor wait
  `anchorWaitMs` (bookmarks 60 s, others 45 s); then a BOOKMARK landing whose view the asset's anchors do not provide
  (anchors not generated in time, or the asset lacks that view) lands on the bookmark's STORED pose (storedCamera: eye at
  lat/lon/alt, heading/pitch; source 'bookmark'): ground views keep the stored eye while it stands 1.35–3.15 m over the
  final ground (else re-seated at +1.65), no QP-03 slide; room / deck views walk + trusted (frozen hold) like kit anchors;
  never the spec stand-ins or the stair → lobby → entrance chain (that chain stays for UI calls without a stored pose).
  console.info names the reason. Result gains `source` ('city' | 'anchors' | 'spec' | 'bookmark').
  App.applyBookmark (exception): a `false` from buildingView (= no building data) goes to the stored pose directly
  (resolveBuildingView only repeated the same lookups at priority −100).
- Node check of the kit anchors (types registered — NOTE: plain Node needs registerTypeModules, my round-2 qp03sim used the
  generic type): S07O station anchors = street, entrance, back, roof, gate, walkway, control, stair, living; kit ↔ stored
  pose: walkway 0.00 m, entrance 0.22, stair 0.00, control 0.00, back 0.04; spec stand-ins: entrance 10.6 m, back 21.95 m
  off (= the workshop door frames buildings-o saw). S07 building: street / entrance / back / living = stored (≤ 0.05 m),
  stair 5.57 m (S07s's stored pose is a rough fallback; the kit anchor wins when available).
- Node mock ct1sim.mjs (real specs + kit generator + analytic terrain, fake pool): A) every job starved, anchorWaitMs 1.5 s →
  all 10 S07* / S07O* bookmarks land on the stored pose exactly (Δ 0.00 m, walk, source 'bookmark', heading / pitch =
  stored); B) same as a UI call (no bookmark) → old behaviour (spec entrance 10.6 m off, stair → spec entrance); C) jobs
  ≥ −100 starved but VIEW_JOB_PRIORITY runs → kit anchors in 21–77 ms (walkway / stair / control / living); D) a queued
  −100 background job is raised to −2.5e6 by a viewpoint request and shared (1 job). Round-2 mock (ct1sim fix2) still 9/9 +
  CT2 walk checks.
- CT2 code: `_clearGroundView` adds props.treesNear trees (treeObstacles: trunk r = max(0.09, 0.026·H)·1.25 as
  props/models.js; base taken from the eye's ground when the displayed base is > 3 m off): eye within trunkR + 0.6 m of a
  trunk / inside a crown; on the sight line (s 0.02–0.92) a trunk covering the frame centre (perp < trunkR + 0.3 + a·tan 3°)
  or a crown within 12 m of the lens (perp < 0.8 crownR). Two-phase search (buildings + trees, then buildings alone when the
  buildings were the problem: a tree never undoes a neighbour fix); finer candidates (±4°, ×0.92). buildingView waits for
  the prop tiles round a ground view (`_waitTrees`: a tree within 150 m reported or props idle; bookmarks ≤ 12 s, others
  ≤ 1.5 s). Node ct2trees.mjs (real plan + kit anchors + props placeTile trees): S07 street / entrance clear; S07d back
  MOVED 5.93 m (low crowns, crown base 1.4–2.0 m, 6.4–8.3 m ahead on the line — QA's "tree in front of the back door");
  S07O street / entrance / back clear (no tree on the lines: the authored views stay); 7 QA camclash buildings: same
  neighbour moves as round 2, no extra tree moves except where a building already forced one.
- [21:26] build OK (.build/controls, 5.1 s); preview 5312; batch (cold S07Oc, cold S07d via goto, result logged) queued on
  slot 0 behind the city fixer's capture.
- [21:29] CT2 refined after a Node trace of S07d (QA2 evidence shots/qa2-shots/extra/S07d-after-S07c.png: a tree trunk in
  front of the back door, low crowns over the facade): the first slide (5.93 m) put the eye 0.85 m from another trunk under
  a crown 0.35 m above the eye → new rules: eye under a low crown (d < crownR + 0.5, crown base < eye + 1.5 m) and a trunk
  < 3 m within ±45° of the view are rejected; candidates also step back (×1.12, ×1.25; cost (k − 1)·2.5). S07d now rotates
  35° round the target at the same 13.1 m (yard full of small low-crowned trees: 45 candidates blocked by a crown on the
  line, 22 under a crown). Other samples: S07 street / entrance and S07O street / entrance / back unchanged; QA camclash
  buildings: same neighbour moves (ZR2 street now 3.12 m instead of 6.71 m: the cheaper candidate clears trees too).
  `_clearTrace` (array) = verification hook listing every tested candidate. Rebuilt (3.6 s) before the batch got its slot.

### Requests (fix round 3)
- lead (app/bookmarks.js): building-view bookmarks now land on their stored `pose` whenever the asset's anchors do not
  provide the view in time, so the stored poses should equal the anchors. S07s's stored pose is NOT the kit 'stair' anchor
  (5.6 m off, heading 300 vs 103.67): use `{lat 21.8690742, lon 117.9991466, alt 542.26, heading 103.67, pitch 21.62,
  lens 28}` (scripts/find-shots.mjs view ZR1-0.3.1a5.17w-n8.n6-7 stair). S07 / S07b / S07c / S07d and all S07O* stored poses
  match their anchors (≤ 0.22 m). S07d: the kit 'back' view now slides round its target off the yard trees (CT2); the
  resolved pose is in the app run below — consider storing it as S07d's pose so a cold fallback frames the same.
- props (optional): a readiness signal for tree data at a point (e.g. `props.treesReady(ecef)` = the prop tile under it is
  placed) — controls waits for "a tree within 150 m, or props idle" (≤ 12 s on bookmark landings) before the tree test.
- [21:37] APP (preview 5312, build with all round-3 code, cold page per shot like capture-shots: /?clean=1&workers=2 →
  goto(id, {instant}), 1600×900, load 9–13; result logged through a buildingView wrapper; idle cap 150 s not reached):
  ★CT1 fix3-S07Oc-cold.png: goto true in 1.14 s, view 'stair' from the kit anchors (worker job at −2.5e6), walk, hold
  'bookmark' lifted 0, pose = anchor = stored pose (100.52 m, heading 45.8, pitch 7.4): flight · half landing · flight with
  the yellow rails up to the control-floor door (buildings-o's frame; before: the spec 'entrance' = workshop door).
  CT2 fix3-S07d-cold.png: goto true in 1.49 s, kit 'back' view adjusted 7.88 m ("view blocked by a tree crown") → heading
  342.4 / pitch 10.7, centre pick = the S07 building at 12.3 m: the back door with canopy, steps + rails, bike racks,
  service enclosure, kitchen windows and the vent read along the back facade, the trees stand to the right (QA2: a trunk
  right in front of the back door). Resolved S07d pose: lat 21.8688016, lon 117.9993144, alt 541.69, heading 342.40,
  pitch 10.67, lens 28. 0 console errors / warnings, 0 page errors in both.
- [21:49] ★CT1 fix3-S07Oe-cold.png (same setup, load 93): goto true in 8.6 s (ground view: kit anchor + tile / tree waits),
  no slide, pose = anchor (100.417 m, heading 294.3, pitch 2.1), centre pick = the sluice station at 18.3 m: transformer
  kiosk + tank, pool facade with the glazed control bay on its cantilevers, back-door canopy, deck access stair + gangway
  (buildings-o's equipment-yard frame; before: the spec 'back' view 22 m off). 0 console errors / warnings.
- [21:50] final build OK (.build/controls, 5.2 s); preview 5312 stopped; no browsers of mine running.

### Status (fix round 3, 21:50)
- DONE + verified: ★CT1 — viewpoint jobs at −2.5e6 (kit anchors in ~1 s on a cold page: S07Oc 1.14 s, S07d 1.49 s,
  S07Oe 8.6 s at load 93), bookmark landings never use spec stand-ins / the fallback chain: anchors missing after
  anchorWaitMs → stored pose (Node mock: all 10 S07* / S07O* exactly on the stored pose with every job starved); App
  `false` → stored pose directly. CT2 — props.treesNear in `_clearGroundView` (S07d: trunk / low crowns in front of the back
  door → 35° round its target, door + steps + kitchen windows free; S07 street / entrance, S07O views unchanged).
- Verification hooks: buildingView result `source`; `_clearTrace`; dev/controls-verify.mjs --suite bookmarks rows carry the
  buildingView result (`view: {source, view, adjusted, requested}`).
- NOT DONE / known: tree data exists only for loaded prop tiles (≈ 2 km round the camera): a viewpoint flown to from far
  away is tested against buildings only; a stored pose (anchors missing) is never slid (author's frame).
