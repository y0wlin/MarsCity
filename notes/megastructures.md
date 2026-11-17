# megastructures — progress log

Owner files: `src/megastructures/*`, (optional) `dev/mega.html`, `src/dev/mega.js`.
Private server: port 5195 (`npx vite --config .build/megastructures/vite.dev.config.mjs`, hmr off).

## Decisions
- Geometry is generated in PRIVATE module workers (`src/megastructures/mega.worker.js`) so no edit of
  `workers/handlers/index.js` is needed; main-thread fallback if the worker cannot start.
- Each site is split into chunks (G01: caisson segment sub-chunks of 4 units, locks, abutments, channel
  markers; G02: per dam L / spillway / R, roads). Each chunk has 3 LODs: far (silhouette), mid
  (engineering units), near (walkways, grating, railings, ladders, bolts, fenders, armour rocks...).
  near replaces mid (same code path, shared elements identical) so the swap only adds detail.
- Vertices are authored in site-local gnomonic metres (sites.js frame, x east, z south, y = height
  above sea level) relative to the chunk centre, then bent exactly onto the sphere in the worker:
  P = localToUnit(x,z)·(R+y) − anchor, expressed in the SITE axes (east/up/south at the site anchor).
  All chunk meshes of a site share one quaternion; position = anchor − origin each frame.
- Custom surface materials (`mega_concrete`, `mega_rock`, `mega_steel`) carry a vec4 `aMega`
  (height above the local water level, exposure, splash top, wear) → wet splash band, marine growth,
  mooring wear, leeward dust in the shader. Everything else uses the building material vocabulary.
- Picking/walking use per-chunk collider meshes (three-mesh-bvh, built lazily) with per-vertex part ids.
- G02 gate states: the water agent already exports `spillwayGateOpen(dam, bay)` in
  render/water/tiles.js (bay index runs the other way along the axis). g02.js replicates it with the
  index mapping (my bay k == water bay bays-1-k); index.js cross-checks at runtime.
- Layout cost is now ~0.25 s (terrain got faster); only worker 0 computes it, the others get it installed.
- Controls already query mega (controls/ground.js iterates ['city','mega'] for raycast + getColliders).

## Done
- 14:24–15:01 (instance 1): frame.js, gen.js, mega.worker.js, parts.js, g01.js, g02.js, materials.js.
- 18:00 (instance 2): generator runs in Node for all 84 chunks × 3 LODs without errors
  (far 30k tris, mid 174k, near 4.5M total; ~40 s all near).
- 19:21 (instance 2): index.js MegaSystem (streaming, placement, LOD, raycast, colliders, spillways,
  gateStates, towns, views, debug layers) — wired by App.js.
- 23:00–00:51 (instance 3): worker-0-only layout, material albedo normalisation, b1–b4 shots.
- 01:05 (instance 4): resumed. Node layout check OK (G01 60 chunks, G02 24 chunks; dams keyed into
  the carved gorges: D1 ground 779 under a 856.5 crest etc.). Baseline batch c1-* running.

- 01:10–02:15 (instance 4): c1/c2 shots. Findings: b3 haze was a transient terrain state (c1 5 km
  dusk fine). G02 canyon poses need the terrain refined BEFORE the pose is set: the orbit controls
  clamp the camera above the displayed (coarse) tile height and never bring it back down → shots use
  a two-step goto (warm-up 1500 m above the spot, waitIdle, then the pose); c2-g02-dam50 is good.
  Changes: caisson unit pilasters + quay-face joint grooves (unit rhythm); neutral concrete albedo;
  pier wet marks follow the reservoir upstream of the gate / the sheet downstream (splash line steps
  at the gate slot); grille = proud housing (was coplanar with the pier face → z-fighting) moved down
  into the splash zone right above the sheet; road chunks cast no shadow (floating-road shadow wedge
  over still-coarse terrain); views: g01-300m (ref framing), g01-heads, g02-valley = up-valley high
  oblique (old down-valley = g02-down), g02-grille 85 mm from the crest-bridge railing.
- build check OK (.build/megastructures/dist; mega.worker emitted).

- 02:15–03:05: c3/c4 shots: g01-300m, g01-ship (good), g02-grille (proud housing, splash line, lee dust:
  good), g02-valley up-valley (six levels + switchbacks: good). Office: harbourTower collider hollow at
  mid too; consoles + view look 36° seaward of the tangent (layout office.look). Office frame still
  fails: ~15 s after load ControlsSystem.clampAbove lifts the camera 27.6 → 58.95 m (floorHeightAt =
  57.25 m) although mega.raycast down from the eye returns the office floor (25.9 m) and city none —
  reported to controls. Spillway sheet: torn foam streaks + bubbles at close range.

## Remaining (for a next instance / QA)
- office frame (controls floor clamp, see above); then re-shoot g01-office.
- G01 at 1–5 km reads as long flat strips (refs show chunkier heads); lock chambers (260 m, data)
  look like thin piers from 300 m up.
- shots use a two-step goto for G02 canyon poses (terrain must refine before the pose is set).

## Verification
- node generator test: OK (scratch script).

## Fix round 1
Private dev server: port 5210 (`npx vite --config .build/megastructures/vite.dev.config.mjs`, hmr off,
restart after edits). Shots: shots/megastructures/fix1-*.
- [07:05] started (instance 5). Plan: ★1 G01 silhouette (bold heads, big towers / gate houses, mouth
  navigation towers + lights, lock gantries, lock heads + gates, wide quays vs narrow sections, crest detail)
  → ★2 g01-office frame (mouth + inbound ferry; screens faced the window) → 3 weathering bands → 4 G02
  (old water line band, roads grounded, gate states S08/b/c) → 5 dusk / night + debug layers.
- [07:25] ★1 done in code (g01.js / parts.js): cross-sections by function (full-width caissons at heads / quay /
  maintenance building, narrow 26–32 m plain caissons between; seaward line continuous, steps on the harbour
  face); lock / abutment head complexes (podium with harbour bulge, 4-storey head house 闸房楼 with ribbon
  windows + glazed top storey, Ø19 m drum 30–36 m high with two glazed bands, gate dock portal in the end
  face, armour end cap); mouth heads: roundhead R18 + navigation light towers (red/white west, green/white
  east, always-on lanterns) + harbour tower Ø20 × 34 m (radar, 2nd glazed band); locks: walls widen behind
  the heads, inner lock heads with 2-storey control houses, portal gantries over both gate lines (girder
  37 m above water), outer gates mostly CLOSED (dark lattice leaf across the entrance, lockState changed),
  yellow gate top rails; wave wall pale coping; wider quays (20 m) with an 18 m gantry crane on every quay.
  Node gencheck: G01 far 25.8k / mid 143k / near 5.25M tris, no NaN.
- ★2 office: screens now face the operator; office look 21° seaward of the tangent (far head ≈ 0°, near light
  tower ≈ 33°, inbound ferry ≈ 40°); eye = drum radius − 3.8 m from the axis (office.radius in the layout).
- 3 shader: outer waterline scour band (exposed aggregate) above the growth band + dark tide line, brown weed
  lower down; berth wear = horizontal rubber smears + pale scrapes clustered along the berth + rust streaks.
- 4 G02: old-water-line deposit bands (旧水位沉积线) on both banks of R5 / R6 (layout samples the full-detail
  terrain, 9 vertices across, L − 1.2 … L + 6.5 m, 18–43 m wide, mega_deposit lifted ≤ 4 m with distance);
  switchback roads use mega_road (sunk ≤ 3 m with distance, never floating over coarse tiles), road fill walls
  only within 2.5 km.
- S09 view (g01-5km) re-framed: oblique from the SE offing, ~3.4 km to the mouth, alt 380 m (was 4.5 km / 900 m
  frontal: barrier = 4 px line).
- [07:35] G02 roads: the two Chaikin passes cut every hairpin by up to ¼ of a 470 m leg, so long stretches
  left the 9 m bench the terrain carves along the ORIGINAL polyline (floating up to 7 m on fill walls). Now
  the legs follow the original polyline and only the hairpin tips are rounded (22 m quadratic cut, inside the
  overlapping benches): Node check max 0.94 m above full-detail ground (RD1–RD6), fills > 0.6 m on 0–3 samples.
  Road surface = pale gravel-concrete (mega_road albedo 0.34) so the switchbacks read on the red slopes.
- [07:50] verification batch fix1-b (dev 5210, workers=2, machine load 130–165, no shot idle within 150 s,
  0 console errors): S09c frames the far mouth head (harbour tower + green light), the mouth gap, the near
  red/white light tower with lit lantern, the inbound ferry, dim consoles; S08 shows the pale old-water-line
  rings on R5 / R6 and no floating roads; S08b D3 gates ---OOO- (= Node rule = water spillwayGateOpen,
  0 mismatches over all 6 dams); S08c grille OK. S09 oblique faced the sunset (backlit, no city) → mirrored
  to the SW offing (looking NE, sun behind the camera, city behind the barrier).
- Collision: the wave-wall coping (deck + 3.75) is in the colliders; every new solid (podium, head house,
  drum, light tower, gantry legs, lock blocks) has a matching colBox; picking part names for heads, drums,
  navigation lights, gantries, lock control houses.
- [08:05] fix1-c (shot.mjs batch): S09 from the SW offing (barrier receding right, mouth light towers, drums,
  lock gate + head complex in front, city behind the barrier); g01-300m day (ref framing: heads, harbour /
  light towers, lock gantries, quay cranes); g01-2km night (window bands, nav / obstruction lights; deck light
  pools too dim → pool emissive 0.55 → 1.6, far pools r 11 m); debug lod (near = orange) and objectId
  (pastel per chunk) work, nothing drawn in clean mode; 0 console errors in all 5 pages.
- Build OK (`npx vite build --outDir .build/megastructures/dist`, 6.3 s).

### Requests (fix round 1)
- lead (app/bookmarks.js, optional): the S09 fallback pose (0.4172 N, alt 55) and S08b fallback (634.5 m) are
  stale — the mega views win at runtime; S09 (`g01-5km`) is now the SW-offing oblique (~3 km to the mouth,
  380→320 m, 40 mm). Suggested S09 note: 「西南外海斜望主航口，堤后为港区与城市」.
- water (optional): G01 lock outer gates are now mostly CLOSED (`lockState(i)` in megastructures/g01.js, pure /
  worker-safe, i = 0..7 → G01-L1..L8; L? open when `.outerOpen`). If the G01 swell model lets waves in through
  the lock gaps, gate it with lockState(i).outerOpen (only the mouth + open locks).
- terrain-fn (optional): megasites.js paints the old water line only up to L + 3.6 m; my deposit bands (R5 / R6)
  reach L + 6.5 m. For the other reservoirs a matching paint top (~L + 6.5 on the `waterline.side` bank) would
  make every level read the same.

### Remaining / known (fix round 1)
- Deposit band vertices follow a 10 m bank profile: up close they can sit ±2 m off the bench steps (the
  distance lift hides this from afar; bands are only on R5 / R6 to keep the layout cheap, ~2.3k terrain samples).
- At ≥ 5 km a 10–14 m crest is physically a few pixels: the silhouette now carries 30–40 m drums, light
  towers, gantries and lit window bands, and S09 is re-framed closer (~3 km).
- Office consoles show procedural glow (grid + blobs), no real UI texture.
- Mouth foam blotches in S09b/S09c come from the water renderer's mouth turbulence (water module).
- [08:25] FINAL verify (capture-shots S08,S08b,S08c,S09,S09b,S09c, 1600×900, workers=3, dev 5210, load 100–165):
  shots/megastructures/fix1-cap/*.png — every still NOT-IDLE after the 150 s cap (machine load), mega chunks
  resident, 0 console errors in all six pages; S09c held at 27.600 m (controls fix works, no lift); S08b/S08c D3
  gates ---OOO- as in S08. Close-ups (fix1-c): g01-lock-head (closed lattice gate + yellow top rail, head houses,
  drums, portal gantry, footbridge, inner head), g01-seaward-face (armour cubes, growth band at the waterline),
  g01-berth-face (fenders, horizontal rubber smears, tide line, ladders, cable tray).
- [08:45] office mullions shifted half a spacing (one sat on the near light tower) → re-shot S09c in fix1-cap2.
- [08:48] fix1-cap2/S09c: mullions now in the mouth gap / far right; far head + green light, red light tower,
  ferry unobstructed; alt 27.600, 0 errors. Final build OK (38 s). Dev server 5210 stopped. Round complete.

## Fix round 2
Private port 5311 (dev config `.build/megastructures/vite.dev.config.mjs`, hmr off, restart after edits).
Shots: shots/megastructures/fix2-*. Items: ★M1 G01 at orbit (QS-09, DG), M2 S09c office (QS-13), M3 G02 chute
sheet thickness / streaks (S08b/S08c, coordinate with water W6).
- [14:30] started (instance 6). Read QA texts (QS-09, QS-13, S08b/S08c notes), round2 backlog, water.md DG agreement
  (terrain-render already paints the calm harbour tint in surface.js `harbourTint`, coverage boosted at orbit).
  Plan: M1 = screen-space-width crest ribbon (orbitline.js, min 1.6 px, lit concrete by day, cold-white night lights,
  camera-ward depth bias, stochastic fade-out once the true crest is ≥ ~3 px) → M2 office (real screen atlas, chairs,
  chart table, equipment, look / light-tower move) → M3 chute sheet (subdivided volumetric sheet, streak relief, new
  shader with aeration inception + flow streaks).
- [15:00] code in (Node-checked, browser batch queued behind other fixers' slot use):
  ★M1 `orbitline.js` (new): G01 crest ribbon over the 10 caisson segments + 2 abutments (gaps at locks / mouth stay
  real), expanded in the vertex shader to max(true half width, 0.8 px) via uMegaPxAng (= 2·tan(fov/2) / pipeline
  .pixelHeight, so tiled captures keep the same width), pulled 4e-5·d + 2 m toward the camera, stochastic fade-out
  while the true crest grows 1.6 → 3.2 px (gone inside ~20–35 km; mesh hidden < 9 km). Patched MeshStandardMaterial:
  pale concrete by day, cold-white night-gated lamp rows (dots every 96 m up close, averaged when sub-pixel, heads /
  locks ×1.6). MegaSystem creates it in init() (independent of the layout) and places it every frame.
  M2 `screens.js` (new): deterministic 2048×1152 display atlas (14 pages: radar ×2, ECDIS ×2, AIS, tide / waves /
  wind, lock & gate board (lockState rule), CCTV quad, weather dials, systems tiles, berth Gantt, comms, paper chart,
  log sheet), generated in a mega worker ('texture' job 'mega_screens', ~2.3 s once); materials `mega_screen`
  (emissive atlas, 2.6 units, always on) and `mega_chart` (paper). g01.js harbourOffice rewritten: VTS console
  (ECDIS / radar / AIS, keyboards, trackball, gooseneck mic, log sheet, 2 task chairs), chart desk (paper chart on
  a raked board, parallel ruler, dividers, pencil, lamp, binoculars, tide screen, chair), 4 side consoles (CCTV +
  locks, weather + mouth ECDIS, berths + comms, systems + long-range radar, phone / VHF sets, chairs), carpet,
  skirting, back wall with door frame, 2 equipment racks, printer, notice board, 8 ceiling light panels; desk
  colliders. OFFICE_LOOK_DEG 21 → 25, mullion phase 0.5 → 0.4; the red / green mouth light towers moved from the
  seaward roundhead to the harbour-side corner of the raised head block (6 m back from the end face, same lantern
  height) — it stood in the window centre (QS-13); planter moved clear of it.
  M3 g02.js `spillSheet`: subdivided free surface per open bay (near 18 × ≤0.8 m, mid 6 × 2.5 m, far 1 × polyline):
  side-wall pile-up up the pier faces, roll waves (≈ 11 m) on the steep chute, streak ridges (λ 0.6–2.4 m) after
  the aeration inception (~9 m below the crest, full white water by ~27 m), smooth normals; vertex colour r =
  aeration, g = wall proximity. mega_water shader v3: flow-aligned streaks scrolling at 6 → 17 m/s, roll bands,
  glassy dark-teal water torn into white streaks around the inception, white water with grey-blue troughs below,
  derivative bump from the same height field (faded when sub-pixel).
  Node: G01 S5 / S6 chunks far / mid / near OK (no NaN, office chunk S5#3 near 65k tris); G02 D1 / D3 spill chunks
  OK (sheet near 4.3k tris per open bay); atlas PNG checked (scratchpad atlas.png).
  NOT doing this round: extending segmented outer arcs along the shelf (needs a generic-polyline caisson generator,
  terrain-keyed bases on a -15…-40 m shelf, and checks against props ferry / boat lanes, water swell damping and the
  terrain harbour tint) → round-3 candidate.
- [15:05] atlas fill clipped to the page (2.3 s → 0.18 s per generation). Build check OK (`npx vite build --outDir
  .build/megastructures/dist`, mega.worker 275 kB). ARCHITECTURE.md §8 megastructures: "Fix round 2" paragraph added.
  W6 coordination note appended to notes/water.md (sheet streak scales / speeds, plume hand-over unchanged).
  Browser batch b12 (S09c, S01, 2000 km day / night, 300 km, S09, S08b, S08c) queued behind 4 other fixers (one
  browser slot machine-wide).

### Requests (fix round 2)
- lead (optional, S01 / QS-09): with the round-2 decision (no re-scale) the barrier is ~1.1 px long at S01
  (9.6 km/px): the crest line makes it a ~1.6 px bright mark on the coast next to terrain-render's dark harbour tint,
  a short bright arc from ~2000 km (≈ 10 px) and a segmented arc from 300 km. A readable ARC at S01 needs the
  round-3 extension: segmented outer breakwater arcs on the -12…-20 m shelf (~25 km WNW of the A1 headland, ~15 km
  ESE of A2, 800–900 m segments with 150–250 m navigation gaps) → ~45 km ≈ 5 px at S01; props (G01 lanes /
  ferryNetwork) and water (swell damping) would have to know the new gaps.
- water: see the W6 note in notes/water.md (optional match of the tailwater foam streaks to the sheet).
- [15:13] M3 plunge roller added (white aerated hump ≈ 1.3 m × 8.5 m across the bay where the sheet dives under the
  tailwater, near / mid LOD); torn foam band along the pier faces stronger (shader wall term 0.45 → 0.62, S08c brief:
  foam tearing on the downstream side). M2 desk paper sheets use the atlas log page (explicit uvs), mug + handheld
  VHF on the VTS desk. Orbit line albedo 0.66 → 0.78 ("bright line"). Top-view Node plot (scratchpad topview.png):
  red light tower 34 m east / 7 m harbour-side of the office axis, outside the 24 mm view cone (left edge ≈ along the
  barrier, far head just inside it). Dev server restarted. Still waiting for the browser slot (city job holds it).
- [15:50] batch b12 done (dev 5311, workers=2, 1600×900, idle cap 90 s — no page idle under load; 10 pages,
  0 console errors / 0 page errors, the only warning is an unrelated Canvas2D readback note):
  ★M1 fix2-m1-2000km (+ crop6x): white crest arc (~10 px) on the coast in front of the (water / terrain) teal harbour
  — the harbour + barrier read at 2000 km; fix2-m1-300km (+ crop4x): SEGMENTED arc (lock gaps, wider mouth gap)
  across the bay; fix2-m1-2000km-night (+ crop4x): thin cold-white arc of working lights next to the warm coast
  city; fix2-m1-40km: chunk LODs + partly faded line, seamless; S09 / S09b / S09c: no line (faded / hidden).
  fix2-m1-S01 (+ crop8x): at S01 the 11 km barrier is 1.1 px long (≈ 9.6 km/px, app lens = horizontal 36 mm →
  K 2222 px/rad, G01 at ≈ (858, 389)): the line is there but merges into the pale coastal city / coast pixels — the
  harbour ARC is not readable at S01 without the round-3 outer-arc extension (see Requests).
  M2 fix2-m2-S09c: window = far mouth head (harbour tower + green light) left third, open mouth centre, inbound
  ferry G01big106 (544 m) right of centre at x≈1085, cargo ship beyond; no light tower in the window; interior =
  chart desk (paper chart, parallel ruler, dividers, binoculars, lamp, tide screen) left, VTS console (ECDIS /
  radar / AIS pages legible, gooseneck mic, log sheet) right, two task chairs in the foreground; mullions at
  x≈630 / 1340 (as computed). fix2-m2-S09 / S09b: red / green light towers still flank the mouth from the sea.
  Follow-ups made after the shot: black vent "holes" on the desk fronts → slim aluminium louvres.
  M3 fix2-m3-S08b: glassy water curving over the ogee crest with a raised lip / white pile-up at the piers,
  aeration inception about a third down the chute, white streaky water below — no longer a flat strip;
  fix2-m3-S08c: torn white foam band running along the pier face under the grille, glassy water beside it, sheet
  thickness visible at the pier. Follow-up: glassy water darker / less saturated (it read glacial cyan).
  Re-shoot of S08b / S09c (b3) queued.

### Status at hand-off (fix round 2)
- DONE ★M1 (orbitline.js, verified 40 km / 300 km / 2000 km day + night, S09-series unaffected); S01 itself cannot
  show the arc at 1.1 px length (Requests: round-3 outer arcs). DONE M2 (office fit-out + screen atlas, look 25°,
  light towers moved, mullions re-phased; S09c / S09 / S09b verified). DONE M3 (volumetric sheet + plunge roller +
  shader v3; S08b / S08c verified; glassy-water darkening + desk louvres made after the shots).
- Build OK (`npx vite build --outDir .build/megastructures/dist`). Node: G01 S5 / S6 chunks far / mid / near, G02 D1 /
  D3 spill chunks far / mid / near without NaN; atlas generation 0.18 s.
- Known: S01 legibility (scale); the sheet streaks are motion-blurred under accumulation (reads as fast water); at
  2500 km the basin tint is the water / terrain renderers' (the water mesh draws over terrain's harbourTint there).
- [16:12] water's W6 tailwater streaks use cells 40 × 9 / 12 × 2.4 / 3.2 × 0.7 m (along × across); the sheet's finer
  chute streaks (11 × 0.6 / 4.8 × 0.23 / 1.6 × 0.09 m) meet them under the plunge roller, which masks the hand-over.
  Re-shoot b3 (S08b / S09c after the louvre + glassy-colour follow-ups) still queued behind other fixers at 16:12.
- [16:28] b3 re-shoot (dev 5311, workers=3, 0 errors): fix2-m3-S08b-v2 — glassy water over the crest now dark
  green-teal (no glacial cyan), aerated white streaks below; fix2-m2-S09c-v2 — desk fronts with slim louvres / hatch
  lines (no black holes), window composition unchanged (far head left, mouth centre, ferry right). Dev server 5311
  stopped, no browser of mine running. Round complete.
