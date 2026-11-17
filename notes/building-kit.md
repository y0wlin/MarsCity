# building-kit — progress log

Owner files: src/buildings/kit/*, src/buildings/interior/*, src/buildings/materials.js, src/buildings/index.js,
src/buildings/types/residential*.js, shop_row.js, generic.js, src/workers/handlers/building.js,
dev/buildings.html + src/dev/buildings.js (+ src/dev/buildings.worker.js, src/dev/buildings-inapp.js,
scripts/bench-buildings.mjs, scripts/walk-buildings.mjs, scripts/bk-inapp.mjs).
Private port 5182: dev server with hmr off — `npx vite --config .build/building-kit-dev/vite.config.mjs`
(restart after edits). Screenshots: shots/building-kit/.

## Status log
- [2026-11-16 01:05] RESUMED (instance N+1; previous instances left no notes file). Kit, materials, dispatcher,
  residential family, interiors, bench all present (committed in WIP checkpoint 2f21c71, unchanged since).
  Node bench (scripts/bench-buildings.mjs, load ~3): R10 mass 0.04 ms / 276 t, exterior 7.2 ms / 102 k t,
  full 18 ms / 278 k t (col 14 k); T24 ext 22 ms / 306 k, full 58 ms / 876 k. City tiles (--city, 1320 gens):
  0 errors; residential ext 4.9 ms / 70 k t avg, full 12.4 ms / 192 k t.
  Next: visual audit on private server 5182 (front/back/roof/lobby/stair/living/night/mass), fix, README, build.
- [01:10–01:20] visual audit d1 (shots/building-kit/d1/*.png, 22 bench buildings corner + R10 views): exteriors,
  roof, night, mass all good. Machine load avg 250–360 (other agents) → shots ~40 s each, Node timings noisy.
- [01:20–01:55] walkability audit (scripts/walk-buildings.mjs) found real 'full' defects, fixed:
  * kit/plan.js `repairDoors(rooms)` (+ `sharedEdgeLength`) — doors to rooms that only touch at a corner are
    re-routed (study in front of a core, en-suite bath behind the lift, living↔kitchen across a hall);
    called by emitInterior per floor (all plan-based types benefit). R5-ZR6 55/68 → 68/68 rooms, R10 141→168/169.
  * interior: stairs/lifts for EVERY core (plan.cores) — blocks ≥ 34.4 m wide (3.7 % of city residential) had
    a stairless hole at the 2nd core; emitRoof: stair house / hatch + lift overrun per core; mailbox wall per lobby.
  * interior doors keep clear of exterior wall thickness; door.pos [x,z] (plan point) honoured; house back
    bedroom / wide-house bath doors now at the floor-landing end of the stair (RW2 9/11 → 11/11).
  * ground-floor stair column floor + collider to the back wall (passage under the half landing → bike store).
  * living camera anchor ≥ 0.55 m inside the plaster (thick ZR6 walls put it inside the wall).
  * kit/index.js re-exports everything the README lists (plan/assemble/cores/interior/furniture/texgen;
    plan SIDES as SIDE_NAMES); MeshBVH maxLeafSize → targetLeafSize.

- [02:00–02:35] walk check all bench specs: R10 169/169, SR4 57/57, T24 589/589, R5-ZR6 68/68, RW2 11/11,
  R6W (46 m, 2 cores) 178/178 rooms; lobby/stair/2F living/back door reachable everywhere. City tiles
  (--city --max 80): 880 gens, 0 errors. Build OK (.build/building-kit). Shots d1/r6w_*, r5cold_*, rw2_living,
  *_entrance verified. Added: materials `basalt` (oxidised local basalt; plinths of zr_terrace / zr_highland)
  and `glass_agri` (greenhouse glazing); bench `?view=board` = §3 材质样板 (dry/wet concrete, basalt, ceramic,
  brushed aluminium, interior-mapped window in a ceramic wall, agricultural glass, 18 % grey card, 1.7 m
  figure); bench lot 22 = R6W-ZR1 two-core slab; ground widened to 520 m.

- [02:35–02:45] concrete texture pores made small/sparse (were blotches), board reframed (d1/material_board.png),
  all 27 registered types × 2 sizes × 3 LODs generate with 0 errors after the interior changes; final build OK;
  private servers stopped (5182 + a leftover 5181 from an earlier instance). FINAL REPORT DELIVERED.

## Decisions
- (see kit/README.md for the API; this log records only work state)

## Done
- kit primitives/components, MeshBuilder, materials (procedural textures in workers), dispatcher + registry,
  mass LOD with facade attributes, residential (slab blocks, houses/terraces, shop-houses, round + podium towers),
  shop_row, generic fallback, interiors + colliders, bench page + node bench.

## Remaining / known issues (for QA)
- in-app band soffits read strongly orange (lighting patch warm ground bounce on downward faces) — request to
  atmosphere; materials unchanged.
- exterior tri counts of towers are high (T24 306 k, T30 round 486 k) — city residency budget copes; no mid LOD.
- interior daylight = uniform sky × uBkIndoorAO (no window falloff) → rooms read flat / dim by day.
- worker timings not re-measured this session (load avg 300–400); Node numbers at low load in the log above.

## Verification
- Node: scripts/bench-buildings.mjs (low load 01:05): R10 mass 0.04 ms / 276 t, exterior 7.2 ms / 102 k t,
  full 18 ms / 278 k t + 14 k collider t. --city: 0 errors (1320 + 880 gens). scripts/walk-buildings.mjs: every
  room reached in R10, SR4, T24, R5-ZR6, RW2, R6W.
- shots/building-kit/d1/: r10_* (corner/back/roof/lobby/stair/living/night), c00–c19 (bench corner views),
  mass_aerial, r6w_roof, r6w_plan1, r5cold_living/entrance, rw2_living, r3island_entrance, sr4_entrance,
  r6slope_back/entrance, material_board. No console errors/warnings.
- npx vite build --outDir .build/building-kit OK.

## Fix round 1
Private port 5206 (dev server, hmr off: `npx vite --config .build/building-kit-dev/vite.config.mjs`).
Shots: shots/building-kit/fix1-*.png.
- [05:05] started. Plan: ★1 glass (IGU reflectance, glass_curtain) → ★2 concrete albedo → ★3 mass sky garden →
  ★4 closed entrance doors → ★5 stair camera → 6 batching audit + README → 7 walk constants → 8 glass_clear depth →
  9 interior daylight / furniture → 10 balcony undersides.
- [05:40] DONE (code): ★1 glass — IGU reflectance f0 0.125 (glass_window) / 0.1 (shop, clear), street-scene
  reflection for façade glass (GLASS_PARS bkStreetReflect: opposite frontage + street trees + paving replace the
  env's bare red ground; parallax from the pane's storey height), NEW key `glass_curtain` (blue-grey coated
  curtain wall f0 0.3, interior mapping behind a blue-grey coat; carries iwin0/1/2 like glass_window).
  ★2 albedo normalisation (`norm: true`: concrete family, stone family, paving, roof membrane/gravel/metal/tiles,
  metals, panels, render/plaster, floors): material colour = true mean albedo (concrete 0.15 → 0.48).
  ★3 mass_facade sky-garden storey (flag 1 + bayW > 0; kit emitMass writes bayW 0 on blank walls).
  ★4 'full' LOD exterior doors / shop doors / vestibule doors open (leaves 65° inward), sliders slid open.
  ★5 stair camera on flight A's axis looking up the flight. 6 batching: VERT_XFORM applies batchingMatrix /
  instanceMatrix; exports NO_SHADOW_KEYS, castsShadow, renderOrderOf, attributeNamesOf. 7 walk-buildings uses
  WALK (r 0.28, step 0.35): all bench specs 100 % rooms. 9 interior daylight falloff ('idl' per-vertex attribute
  on indoor keys, floors/ceilings on a 1.5 m grid) + fuller bedrooms / studies.
  Remaining: shots (board, entrance, stair, interiors, app S07/S07b), item 8 lobby glass, 10 balconies, README.

### Announcements / requests (fix round 1) — read by the other fixers
- **NEW material key `glass_curtain` (for buildings-z, D4)**: blue-grey coated curtain wall (reflectance 0.3 with a blue
  cast + street / sky reflection, interior-mapped room visible through a blue-grey coat). Same attributes as
  glass_window (iwin0/1/2): emit with `K.setGlassRoom(b, room, …)` / `K.glassPane(b, 'glass_curtain', …)` or
  `windowUnit({glassKey: 'glass_curtain'})`; room kind office (7) by default. Use it for tower / office curtain walls
  at 'mass'…'exterior' (keep 'glass_clear' for 'full' floors that have real interiors).
- **Albedo normalisation (★2) — all type owners**: materials with `norm: true` (concrete, concrete_smooth, concrete_wet,
  stone_plinth / sill / step / dark, basalt, stone_floor, paving, paving_stone, aluminium(_dark), steel, steel_brushed,
  blind, counter, tile_floor, roof_tiles, roof_membrane, roof_gravel, roof_metal, panel_insulated / white / grey,
  render_white, plaster) now render at their declared colour (concrete ×3.1, membrane ×4.8, paving ×2.4, panels ×1.4
  brighter than before). **buildings-o**: drop the compensation tint `[1.7, 1.67, 1.6]` on concrete_smooth in
  sluice_station.js:122 (use ~[1, 1, 0.98]); re-check other brightening tints on these keys. **city**: street materials
  that borrow `src.color` (sidewalk paving, kerb stone_step, concrete, ballast roof_gravel, stone walls) get the new
  colour automatically — re-check sidewalk brightness (paving now linear ≈ 0.53).
- **Far sky gardens (★3, city)**: see notes/city.md "building-kit → city": flag 1 + bayW > 0 = sky-garden storey.
- **controls / lead**: 'full' LOD exterior doors now render open (65° inward), sliders slid open; `anchors.cameras.stair`
  moved onto the first flight's axis (looks up the flight).
- [06:15] verification so far: bench shots shots/building-kit/fix1-board-a.png (concrete / smooth / wet / basalt /
  ceramic: concrete now light fair-faced), fix1-board-b.png (window, blue-grey curtain wall with sky + street
  reflections, agri glass, far-LOD sky-garden band green), fix1-r10-entrance.png (double door open 65°, lobby with
  mailbox wall + core door visible through it), fix1-r10-stair.png (on flight A, looking up to the half landing),
  fix1-r10-living.png (daylight falloff from the balcony slider, slider panel slid open), fix1-r10-lobby.png (found:
  camera inside the swing of the open leaf + street reflection on the leaf glass → FIXED: open leaves carry no room
  ids (no street reflection), lobby camera 1.6 m inside the front; round tower lobby camera R−2). All 0 console errors.
  Node: walk-buildings (WALK r 0.28 / step 0.35) R10 169/169, SR4 57/57, RW2 11/11 (a new bedroom shelf blocked the
  back bedroom → moved beside the bed; furnishRoom now blocks the real door spans), R5-ZR6 68/68, T24 589/589,
  R6W 178/178, real S07 building ZR1-0.3.1a5.17w-n8.n6-7 127/127, stair-report building ZR1-0.3.1ai.189-6.n12-2
  238/238 (stair eye x 0.13 → 0.80 = flight A axis). bench --city --max 60: 660 gens 0 errors; all 27 types × 2 sizes
  × 3 LODs 0 errors. `npx vite build --outDir .build/building-kit` OK (42 s).
- [06:28] indoor daylight retuned (base 0.2 rooms / 0.32 common areas, gain 0.72): R10 'full' idl mean 0.33
  (old uniform 0.42), 0.96 max at the glass. zr_glass style windows (and round towers in that style) use
  glass_curtain at 'exterior'. walk-buildings: `--id` for real buildings, robust start node; README updated.
  Waiting for browser slots (2 machine-wide, load avg 120–150) for the app S07 / S07b / stair shots + batch2.
- [07:00] batch3 (one browser slot for bench + app): fix1-r10-lobby.png (camera clear of the open leaves: mailbox wall,
  bike-store door, stair core with its flight visible through the open door), fix1-t30-stair.png (round tower:
  on flight A looking up the flight), fix1-r10-living.png; APP (private dev server 5206, workers=2):
  fix1-app-S07b.png (S07 building ZR1-0.3.1a5.17w-n8.n6-7: double door open, 信报区 + core visible through it,
  steps / ramp / canopy on one ground, side lights reflect the street frontage), fix1-app-stair.png
  (buildingView 'stair': on the first flight, looking up to the half-landing window with the neighbour tower
  outside), fix1-app-S07.png (street view). Production build re-run after the last edits: OK (53.7 s).
- [07:05] FINAL (fix round 1). All 6 batch3 shots 0 console errors / warnings (app shots not idle within 200 s at
  load avg 80–150, images complete). S07 street view: band soffits now neutral light grey (atmosphere's neutral
  bounce) — item 10 OK, no kit change needed. Numbers (sRGB means): concrete board panel 75,68,63 → 121,112,106;
  office tower glass in the buildings-z bench (still glass_window) 44,46,51 → 57,60,66; street-level window
  29–36 → 43. Private dev server 5206 stopped; scratch removed.

### Remaining / known issues (fix round 1)
- street reflection is a model: waterfront façades also "see" a virtual opposite frontage; low-floor windows reflect
  dark tree crowns (physically right, reads darker than upper floors).
- far towers are drawn by city massMaterial (glassFar / sky gardens): needs city's mirror of the flag-1 rule.
- buildings-z still has to switch tower / office curtain walls to `glass_curtain` (D4).
- 'full' LOD triangles +23 % (R10 278 k → 343 k: floors / ceilings on a 1.5 m grid for the daylight falloff, fuller
  rooms); round-tower core stairs (windowless) stay dim; bench lighting (no atmosphere) still shows a warm canopy
  soffit — app is neutral.

### Verification (fix round 1)
- shots/building-kit/fix1-board-a.png, fix1-board-b.png, fix1-r10-entrance.png, fix1-r10-lobby.png,
  fix1-r10-stair.png, fix1-t30-stair.png, fix1-r10-living.png, fix1-t24-aerial.png, fix1-z-oftp-corner.png,
  fix1-app-S07.png, fix1-app-S07b.png, fix1-app-stair.png (also shots/controls/fix1b/fix1-S07*.png by controls).
- node scripts/walk-buildings.mjs (all bench specs 100 % rooms) + --id ZR1-0.3.1a5.17w-n8.n6-7 (127/127),
  ZR1-0.3.1ai.189-6.n12-2 (238/238); bench-buildings --city --max 60 (660 gens, 0 errors); 27 types × 2 × 3 LODs 0
  errors; npx vite build --outDir .build/building-kit OK.

## Fix round 2
Private port 5306 (vite preview of .build/building-kit or a dev server with hmr off from .build/building-kit/).
Shots: shots/building-kit/fix2-*.png.
- [start] items: ★K1 plan connectivity (QA-ASSETS-02, QA-ID-01) → ★K2 plant foliage (QQ-03) → ★K3 parapet z-fighting (QQ-02)
  → K4 mailbox wall only in residential lobbies (QY-02) → K5 furniture materials / per-window interior variety (QA-ASSETS-04)
  → K6 curtain-wall local reflections (QQ-15).
- [~1h] ★K1 root causes found + fixed: (1) interior/rooms.js furnishRoom door blocks had maxH 99 but the test is
  `item.h > maxH` → doors never blocked anything (ZR5 kitchen runs stood across the kitchen door) → hard blocks (−1),
  real door spans only, keep-out boxes (swing + 1 m approach) for furniture on perpendicular walls, exterior doors /
  sliders too; (2) kit/plan.js repairDoors called a room "reachable" when any room had a door to it → bath↔bedroom
  islands (ZR5 n8-12) → rewritten graph-based: BFS from the stairs + street/shop-door rooms, unreached rooms get a door
  to the best adjacent reached room (same unit › common landing, never through a bath, never into another unit);
  (3) residential_plan.js: unit layout assumed a 5.2 m stair+lift core even without a lift (≤ 3 storeys) → 1.2 m
  untiled strips between core and flats, hall→landing doors uncuttable (all 2–3 storey dorms, wide low slabs) → core
  width = stair (2.8) without lift; 'end' cores at the right end put the lift column beside the flat (liftSide −1) so
  the room behind the lift joins the flat (was a doorless bath, ZR5 n8-6); (4) residential_tower.js: 0.1 m gap ring
  between core rooms and corridor ring (stair→lobby door uncuttable, no stair partitions, floor slits) → abutting.
  walk-buildings: sloped sites use the corner-bilinear street level (kit/spec.js groundAt), --around/--family/--n
  city sampling + SUMMARY, --zfight coplanar-overlap audit. QA cases: ZR5 n8-5 109/109, n8-12 142/142, n8-4 175/175,
  n8-6 90/90, dorms OX1-…n25.n4-2 73/73 (was 10/67), OX1-…n8-0 61/61 (8/64), OX3-…n13-0 46/46 (3/44), OX5-…10-3 108/108.
  Regression (50 real buildings each): ZR1 slabs 50/50 (6771/6771 rooms), ZR3 slabs 50/50 (8197/8197), ZR5 slabs
  50/50 (5349/5349); towers / dorms / houses running.
- [~1h30] ★K2 plant/foliage: physical leaves with specularIntensity 0.22 (props' value; F90 = 1 mirrored the blue sky
  on up-bent leaf normals = pale cyan blobs), no sheen, crisp alpha cut-outs (no alpha-to-coverage ghosting), roughness
  0.84, olive atlas (linear mean 0.062/0.145/0.017), per-card AO in clumps. 'plant' keeps colour × tint semantics
  (greenhouse / mega tint it).
- [~1h50] ★K3: the 'full' facade inner plaster ran up to the parapet coping, coplanar with the parapet inner face
  (QQ-02's dark grey-brown patches = indoor-shaded plaster) → stops at the roof slab (also round towers, terrace
  upstands); stair-house wall-run end caps lay in the neighbouring run's outer face (5.8 m² per core on every flat
  roof) → removed; house party-wall upstand reached 0.3 m below the eave into the walls' end caps → starts at the eave;
  side-run flashing corners; balcony soffit downlights 3 → 8 mm proud; interior door units were centred on the wall's
  A face (architrave buried in the wall, duplicate reveals) → centred, duplicate reveals removed. --zfight on the
  bench: no roof-level coplanar pairs left at exterior or full LOD.
- [~2h10] K4 lobby: mailbox wall only for HOUSING_USES (residential, residential_tower, shop_row, dorm); clinics /
  offices / schools / community get a reception desk + backlit directory board (interior/index.js, furniture.js
  receptionDesk). K5: bedroom window wall varies (desk with monitor / laptop + lamp / books + lamp / bare, chest of
  drawers + mirror, armchair corner), padded sofa (rounded cushions, throw pillows), individual books with gaps and
  objects, fabric texture readable at 1–3 m (0.4 m tile, 4 mm basket weave + heather + slub; the 2.5 mm weave mip-mapped
  flat); interior-mapping shader: per-window layout variants (living ×3, bedroom ×2, office ×3, own classroom / clinic
  layouts, mirrored by seed). K6: glass_curtain street reflection gains neighbouring towers (55–95 m out, 45–175 m,
  glass or ceramic, lit windows at night) and a hazy city silhouette by world azimuth (BK_CURTAIN in GLASS_PARS).
- [~2h40] tower regression found more (all fixed): stair houses had solid colliders across the roof door, roofDeck
  collider/visual covered the stair well (no headroom on the last flight, deck cut through the stair in 'full') →
  door gap + wall colliders, deck holes; parapets now have colliders; round towers: no ground across the door threshold
  (floor polygon ends at the inner face) + 15 cm slit before the stair landing → threshold quad, landing carried to the
  corridor; rect tower crown floors: side-band bedroom degenerate when set back → bath takes the band; shallow houses:
  back bedroom door into the stair room mid-flight → doors into stair rooms only at `stairRoom.landing`.
  Regression (50 per seed area): ZR1 slabs 50/50, ZR3 50/50, ZR5 50/50 (100 % rooms), dorms 99/100 (6126/6155),
  houses 95/100 before the landing rule (4 of the 5 fixed after), rect towers: crown fix → 583/583 on the failing one.
- [~3h] build OK (.build/building-kit), bench walks 6/6 (1068/1068 rooms), --zfight bench: no roof pairs.

### Announcements / requests (fix round 2)
- **buildings-o (QA-ID-01)**: the dorm failures were kit bugs, fixed in residential_plan.js (core slot without lift,
  1.2 m untiled strips) + kit/plan.js repairDoors (graph-based) + rooms.js (furniture never blocks doors). dorm.js
  needs no change; regression: 99/100 dorms fully walkable around OX1-0.3.11r.x7-n25.n4-2 / OX3-1.3.a.1ar-28.n13-0
  (exception OX3-1.3.9.1as-31.0-0: lobby not reached from the street — check its entrance portal / slope). Note the
  plan geometry of 2–3 storey dorms changed (units 1.2 m wider each side of a stair-only core).
- **buildings-z (QQ-02)**: the parapet z-fight came from kit emitFacades (fixed for every type that uses it); run
  `node scripts/walk-buildings.mjs --zfight both --id <station id>` for your own roofs (the C06 foreground station roof
  showed the same pattern) — the tool lists coplanar overlapping faces per material pair.
- **all plan-based types**: `repairDoors` now connects every room to the stairs / street-door rooms; a stair room may
  carry `landing {x0,x1,z0,z1}` (doors above floor 0 only there); `data.meta.unreachableRooms` > 0 = rooms with no
  adjacent route.

### Remaining / known issues (fix round 2)
- podium towers (ZR1 tower_podium): the tower floors were not reached — the podium roof access was blocked (stair house
  door collider, deck over the stair well: fixed), not re-verified on all 4 sampled podium towers after the fix.
- round towers carry no room anchors (walk counts 0/0); floors 75 % reached after the threshold / landing fixes; the
  'living' camera anchor of round towers is not on a walkable node (living2F false).
- one shallow house with 1 room without any adjacent route (ZR1-0.3.1a5.17w-n7.n4-14); dorm OX3-1.3.9.1as-31.0-0 entrance.
- interior coplanar leftovers (bed back faces against walls, door frame details) are hidden or tiny.
- [final] towers (100 sampled around ZR1 / ZR5 cores, after all fixes): 65/100 fully walkable (rect towers incl. the
  crown fix), 30 round towers reach lobby / stair / every floor (75 % of floor nodes) but carry no room anchors and their
  'living' camera anchor is not on a walkable node (living2F ✗), 4 podium towers (tower_podium) still do NOT reach the
  tower floors from the podium (roof door / deck holes fixed, something else still blocks the podium roof → tower
  entrance; not diagnosed), ZR5-0.3.12c.p-n13.n9-0 364/371. Screens: shots/building-kit/fix2-cap/C06.png (dark green
  balcony / planter foliage, clean parapets incl. the foreground roof, varied window interiors; 0 console errors),
  fix2-cap/C05.png (curtain-wall tower; reflections only partly verified, page not idle at load 230). Preview server
  5306 and background walks stopped.

## Fix round 3
Private port 5306 (vite preview of .build/building-kit). Shots: shots/building-kit/fix3-*.png. Items: ★K1 narrow /
shallow plans (QQ2-01, QA2P-03 dorm, podium towers, round towers) → ★K2 curtain-wall front panes (QQ2-06) → K3
bkInterior lobby branch (QY-02 leftover).
- [start] reproduced: n10.n9-2 1/6, 6.0-13 2/25, n7.n4-11 1/30, n7.n4-14 19/20, dorm OX3-1.3.9.1as-31.0-0 0/29. Root
  causes: (1) w < 9.5 'small' layout = ONE room over the whole floor (stair well slabbed over → no upper floor);
  (2) shallow slabs (d − T − 6.24 m stair < 3.2): the along-z stair + landing ran into the front wall / left a ≤ 0.9 m
  roomless slit before the street door (lobby unreachable) and no living band; (3) wide shallow houses: 0.4–1.4 m gap
  between wc and study (hole); (4) ROOF EXITS BROKEN EVERYWHERE: no roof-level floor landing in the stair house (the
  deck hole covered the landing) and podiums (< 4 storeys, opts.stairHouse) ended in a ladder → podium towers' floors
  unreachable; (5) 'end' cores ≥ 4.8 m wide left half their front zone roomless.
- [~45 min] fixed (kit/cores.js coreLayoutX / stairFrame / stairPoint; residential_plan.js narrowPlan + shallow
  along-x core + landing slit rule + end-core front zone + narrow service bands + house wc; interior/index.js roof
  landing + plan.roof.stairHouse; assemble.js roofDoorOf (door at the landing end) + stair camera via stairFrame;
  roof.js stairHouse doorU). The 5 QA cases: 24/24, 24/24, 53/53, 20/20, dorm 70/70, all with roof ✓.
- [~1h20] regression so far (walk-buildings, real buildings): QA narrow lists ZR1 143/143 (rooms 3394/3394; QA: 54/143),
  ZR5 56/56 (1223/1223; QA 29/56); dorms around OX3 50/50 (2925/2925; QA 49/50); podium tower ZR1-0.3.1a3.17w-13.n5-0
  (--floors 8) 121/121 + roof (QA: tower floors 0 %). Podium blocker found: the tower's service-yard bin store stood in
  front of the podium stair-house door → no bin store / bikes for towers on podiums (ctx.onPodium). Podium-tower room
  anchor floors were offset by the merged count (fixed). Round towers: room anchors + walkable living pose + open well /
  roof landing. K2: glass_curtain near tower ring (42–75 m, 60–260 m) + far ring for steep reflections. K3: bkInterior
  mailbox wall only for profile 0, public lobbies = reception desk + backlit directory board. Build OK; preview 5306 up;
  C05 capture waiting for the (single) browser slot. walk-buildings: `--family narrow`, `--floors N`, `roof` result.
- [~1h35] regression results (walk-buildings, real buildings, "fully walkable" = every room + lobby + stair + 2F living):
  narrow lists of QQ2-01 ZR1 143/143 (3394/3394 rooms), ZR5 56/56 (1223/1223); --family narrow around ZR3 50/50
  (1114/1114); slabs around ZR1 50/50 (6641/6641); shop rows around ZR3 50/50 (3137/3137); houses around ZR1 50/50
  (735/735); dorms around OX3 50/50 (2925/2925); towers around ZR1 (16 rect + 9 round, --floors 10) 25/25
  (4222/4222); round tower ZR1-0.3.1a4.17w-4.n9-0 (12 F) 58/58 rooms, living ✓, roof ✓. bench-buildings --city
  --max 120: 1320 generations, 0 errors. Pitched roofs: plan.roof.stairHouse = false (the stair ends at the top floor
  — ≥ 4-storey pitched blocks used to run a flight up into the roof void). Browser: the single machine slot has been
  held by qa2-shots/chain3.sh since 18:47 — the C05 capture is queued.
- [~2h] podium towers (10 of the 30 found around ZR1, --floors 10): 6/10 before → the generic podium core (back wall,
  centred) sat under / right behind the tower (28 of 30 left < 2.2 m in front of the podium stair-house door): podiumParts
  now moves the tower forward (else sideways) to keep a 2.2 m walkway (massing uses the same function). Batch A 4/5 after
  (ZR1-0.3.1a3.17w-14.n7-0 fixed); remaining failure ZR1-0.3.1a3.17w-17.n4-0 = a 12 m tower (meta 10.6 m) on a 28 × 25 m
  podium: towerPlan (stair + 2 lifts + 1.6 m ring + 4 corner flats) degenerates below ≈ 20 m (meta.unreachableRooms
  42) — known issue (3 of 30 podium towers are < 20 m). Slabs around ZR3 50/50 (5502/5502), ZR5 50/50 (5349/5349); towers
  around ZR5 (14 rect + 11 round, --floors 10) 25/25 (3862/3862); 12 round towers full height 12/12 (1411/1411).
  walk-buildings backDoorOutside: probes 1–4 m out at any height between yard and sill (sloped-site false negative of
  QA2 #1 on OX3-1.3.7a.13o-11.1-4 → true). Screens: fix3-k3-clinic-lobby.png (bench clinic at 'exterior': backlit
  directory board + desk behind the doors, no mailboxes; 0 console errors), fix3-k1-narrow-street.png (app, narrow
  6-storey point block ZR1-0.3.1a5.17w-n10.n9-2: lobby door + glazing, one flat per floor; 0 errors, not idle in 360 s).
- [~2h05] small podium towers (< 20 m, rect) → generated as a slender residential block (residentialPlan; massing
  residentialMassing — same switch `smallTower(Q)` in both): ZR1-0.3.1a3.17w-17.n4-0 (--floors 10) 72/72 + roof. All 30
  sampled podium towers generate at mass + exterior with 0 errors.
- [~2h15] FINAL (fix round 3). Podium towers (10 sampled, --floors 10): 10/10 with the final code (batch B 5/5 858/858;
  batch A 4/5 + ZR1-0.3.1a3.17w-17.n4-0 72/72 after the small-tower fallback; ZR1-0.3.1a3.17w-9.6-0 re-checked with
  the fallback 118/118). App C05 (shots/building-kit/fix3-cap/C05.png, crop fix3-C05-crop-glass.png; not idle after
  465 s at load 80–100, 0 console errors): the main tower's front panes now mirror grey glass / ceramic tower bodies
  with window grids in their lower and middle storeys (QA2 crop: uniform blue); upper panes keep the sky (steep rays).
  Build `npx vite build --outDir .build/building-kit` OK (after the last source edit). Preview 5306, monitors and
  background walks stopped.

### Requests (fix round 3)
- buildings-o: dorm.js needs no change — narrow / shallow dorms now get narrowPlan / the along-x stair from
  residential_plan.js (50/50 dorms walkable); please eyeball `planGableStair` on a shallow dorm (OX3-1.3.9.1as-31.0-0:
  along-x stair at the back wall, no lift) in your final pass.
- lead: podium towers can sit a few metres off `meta.tower.x/z` (podium core clearance) and podium towers < 20 m are
  slender residential blocks; no bookmark references them as far as I know.

### Known issues (fix round 3)
- along-z 'end' cores still run their flights ≈ 0.18 m into the end wall (walkable; unchanged geometry).
- shallow plans have no lift (walk-up, ≤ 7 storeys in the samples); narrow plans none either.
- walk-buildings `backDoorOutside` false on some podiums (e.g. ZR1-0.3.1a3.17w-9.6-0 podium service door) — not
  investigated (not part of "fully walkable").
- the tower walks used `--floors 10` (crown floors included) for speed; full-height runs: 12 round towers 12/12, the
  44-storey podium tower before the bin-store fix only.
