# city (render/city streamer) — progress log

Owner files: src/render/city/*, src/workers/handlers/cityTile.js, dev/city.html + src/dev/city.js (optional).
Private port: 5192 — now `vite preview` of a build snapshot (.build/city/dist, rebuild with
`npx vite build --config .build/city/vite.config.mjs`, ~6 s); the shared tree breaks transiently while
others edit. Screenshots: shots/city/.

## Status
- [14:30] first instance: read docs, wrote the whole module set (index/tiles/massBuild/massMaterial/
  detail/streets/streetBuild/streetMaterials/outline + handlers/cityTile.js). Interrupted ~15:03.
- [18:01] second instance resumed. Verifying the existing code in the main app, then fixing.
- [18:40] found: shared pool starved — dense-city terrainTiles jobs take 35–50 s each (urbanSample
  per texel) and run first (negative priority) → zero city tiles in 120 s. FIX: dedicated city worker
  pool (render/city/pool.js + city.worker.js, 4 workers): 148 tiles / 27.5k buildings in 60 s.
- [18:50] seat offsets: far city sits on the DISPLAYED terrain (coarse terrain tiles hid buildings);
  per-building offset in state texture A, sampled via terrain.groundHeightAt, animated 25 m/s.
- roof colours mirror surface-3 gradeUrban (+parcel tone, 0.92 clamp); surfaceSample was 5 ms/pt.
- areas draped over terrain on a 6 m grid (were flat 4-corner polygons).
- worker priorities unified by distance (tiles 100+d/12, exterior 100+d/4, full 90+d/2, streets 110+d/6).
- [23:01] THIRD instance resumed (second one stopped ~19:21). Plan: verify descent ladder in one page
  (scratchpad seq.mjs: one browser page, goto() between poses so caches persist), fix, then walk /
  enter / pick / outline / night / other sites; report.
- [23:10] first full-app shot (fresh page, 5 km ZR1): 195 s, not idle (terrain jobs), 60 M tris, 20 fps,
  no console errors; massing reads as distinct buildings.

- [23:30] measured: kit 'exterior' residential = ~0.32 M tris / 24 MB / 2.8 s worker each (28 of them
  = 9 M tris, 690 MB) -> unbounded exterior LOD would exhaust memory. Mass BVH build 1–1.5 s per dense
  tile (three-mesh-bvh 0.9.17 is slow), residential 'mass' 6 ms/bldg (other types 0.1–0.3 ms).
- [23:50] changes: (1) no mass BVH: per-building contiguous index ranges + tile-frame AABBs in info
  (INFO_STRIDE 19), raycast = AABB slab test + exact triangles of candidates; outline by range.
  (2) detail residency budget (36 M tris / 2.6 GB, nearest first; 'full' always), CPU arrays of drawn
  geometry released after upload (onUpload), new materials linked with renderer.compileAsync against
  pipeline.sceneRT before attaching (first exterior upload stalled 4.6 s before). (3) collider BVHs
  (building 'full' + streets) built in the worker ('cityBuilding' job, colliderBVH roots) and
  deserialized. (4) mass CPU copies of normal/uv/mcolor/facade/facadeId/bidx released after upload.
  (5) street install waits for final kit textures (no recompile storm); garden edging, solar rows,
  basins, yards. (6) facade: grid fades earlier (no moiré), lighter far glass average.
- [00:01] 5 km ZR1 after changes: 520 tiles / 121 k buildings / 20.8 M mass tris idle in 107 s
  (machine load avg 150+ from other agents).

- [01:05] FOURTH instance resumed (plan upgraded). City files unchanged since the 00:31 checkpoint.
  Plan: rebuild private preview (5192), audit (build, Node checks, descent ladder shots), fix, verify
  walk/enter/pick/outline/night/other sites, final build, report.
- [01:30] audit: build OK (vite 8, ~1 s). Node: dense tiles mass 0.8–1.5 s, 26 tris/bldg avg,
  no empty/NaN; streets 3.7–12 s/tile in Node (heightAt samples 6–12 k/tile) under load avg ~300.
  Sites: ZR1 core 22.34N 117.78E (h 477, 281 bldgs); ZR1 tower 22.34N 118.29E; ZR2 35N 105W (h 1780);
  O-town 9.05N 106.25E (h 185, 380 bldgs, canal); ZR1 is INLAND (sea starts ~6N) and the tidal
  barrier's north shore is wild -> coastal city = ZR5 bay south shore ~ -42.9N 104.4E / -43.2 104.5.
  Change: mass models dissolve over the outer 16 % of the streamed radius (uCityMaxDist; picking
  ignores them too) so tall towers never pop at the edge. Seq screenshot script: scratchpad seq.mjs.
- [01:45] in-app (load avg ~290): 5 km ZR1 = 396/520 tiles, 85.8 k bldgs, 15.9 M mass tris after
  248 s (terrain still untextured: shared pool starved); 1 km = city idle, 133 tiles / 23.4 k bldgs /
  3.8 M mass tris, 9 exterior, 18 street tiles (1.6 M tris), JS heap 1.45 GB, 22 fps. Defect found:
  park paths = same loop + diagonal on every park block, bright -> read as white triangle wireframes
  from 1 km. FIX: per-park hashed layouts (single crossing / loop / cross / loop+cross / side path),
  warm gravel or grey paving tint. City pool: 2 workers under webdriver, ?cityWorkers=N override.
- [02:17] run2 (ZR1 descent, old build): 300 m = 169 tiles, 178 exterior (12.4 M tris, 0.93 GB),
  25 street tiles, 71 M tris drawn, 26 k draw calls, 10 fps; 50 m = 520 tiles / 116 k bldgs / 21 M mass
  tris + 166 detailed (17 M tris) + 27 street tiles, JS heap 2.9 GB, 10 fps. Shots z03..z05 good.
  Bugs: findBuildings({near:{lat,lon}}) measured from sea level -> empty on high ground (FIXED: surface
  distance + tile pre-test); schoolyard / pitch coplanar z-fight (FIXED: per-kind lift order);
  night 2 km: far window average blotchy / greyish (CHANGED: 8-tap rotated average, warmer colour).
  run3 (new build): outline/clean/street/enter/lobby/stair/living/back + API + ZR5/ZR2/OX1 sites.
- [02:50] run3 (new build, 2 city workers): ZR1 640 m city idle in 112 s (225 tiles, 110 exterior,
  25 street tiles). Outline picked via findBuildings OK, 'full' in 2.9 s; DEFECT: outline hull with
  1.7 m world margin filled the gaps between cantilevered balconies with outline colour at close range
  (FIXED: 6 cm margin, constant-px rim only). clean -> no outline OK. street/enter/lobby/stair/back in
  walk mode, colliders 11 (building 'full' + neighbours + streets), floor 1.65 m below the eye in
  lobby / stair / living (2nd floor); controls chose orbit for 'living' (their standability test uses
  city.raycast = mass hull, not colliders -> request). API: focusInfo of a non-streamed id 356 ms
  (pool 'buildingSpec'), findBuildings 200, raycast/getBuilding OK. Coast ZR5 shots good (skyline with
  several centres + reflections). Canyon / O-town shots invalid (walk mode persisted after x08 ->
  goto snapped to the ground); redone in run4 with setMode('orbit') first.
- [02:35 real clock] run4: outline with 6 cm margin still filled the air under balcony corners where
  the mass hull is larger than the detailed volume -> NEW: per-frame coverage mask of the hull's front
  faces (own small RT, same camera; skipped under view offset / tiled capture); outline fragments
  inside the hull silhouette are discarded -> rim only outside the silhouette. Night 2 km / 300 m:
  windows correct but the terrain's road emission dominates exposure (request to terrain/urban).
  Canyon 2.6 km (terraced slopes + strata, city seated; terrain blobs = terrain LOD), O-town 1 km /
  300 m good (greenhouses, basins, water tower, pitches without z-fight). run5 = mask verification.
- [02:45] run5 (mask outline): close range = thin rim along the hull silhouette, no fill; far = thin
  rim (width raised 1.8 -> 2.4 px afterwards, not re-shot). Park paths at 1 km now varied and subtle.
  Final: `npx vite build --outDir .build/city` OK (49 s). Private preview server (5192) stopped.
  Report delivered; remaining gaps listed under Remaining.

## Decisions
- One merged far-LOD mesh per L13 tile (worker: generateBuilding(spec,'mass') per building →
  tile frame, + serialized MeshBVH). Per-building state texture (vis/highlight/size) drives dithered
  fades in the shader (no geometry rebuilds on LOD change).
- Detailed buildings = kit 'exterior'/'full' via worker 'building' job, createBuildingObject; mass of
  that building dithered out once the detailed one is uploaded.
- Streets: worker job 'cityStreets' (streetBuild.js) per tile within ~1.3 km, one mesh per material.
- Selection outline: inverted hull of the mass geometry (constant px width).
- Dense ZR1 core: ~22.34N 117.78E (281 bldgs/tile, 125 ≥12 floors), 22.34N 118.29E (96-floor tower).

## Done
- streaming (L13 tiles, near-first, cancel, LRU 700 MB), mass LOD + far facade shader (storeys,
  windows, styles, night lights via OCCUPANCY_GLSL, terrain-matched roofs, dithered fades by size and
  by distance), detail exterior/full with residency budget, streets/areas/rails/docks/bridges, picking,
  focusInfo/getBuilding/getColliders/findBuildings/isIdle, outline, debug layers. Verified in app
  (shots/city/z0*, x0*, y0*, w0*).

## Remaining (known issues)
- draw calls: detailed buildings are one mesh per material per building (26 k calls at 300 m, 10 fps);
  JS heap 2–3 GB at street level with 520 tiles (CPU position/index kept for picking + tile data).
- night far-window average dim vs terrain road glow (terrain road emission dominates exposure).
- outline follows the MASS hull silhouette (detailed balconies outside it are not outlined).
- getColliders requests 'full' only for tiles within 1.5 km of the camera (walker = camera).
- no geometry reuse for identical specs; hover tint only on mass models.

## Verification
- see the run logs summarised above (load avg 150–340 during all runs).

## Fix round 1
Private port 5202: `npx vite build --outDir .build/city && npx vite preview --outDir .build/city --port 5202 --strictPort --host 127.0.0.1`.
Shots: shots/city/fix1-*.png. Scratch scripts: scratchpad/city-fix1/.
- [05:01] started (instance 5). Order: ★1 batching + heap → ★2 rails/stations (D1) → 3 debug layers → 4 detailed
  picking/outline → 5 getColliders near point → 6 night windows → 7 G02 towns.
- Plan ★1: detailed buildings go into GPU-only batches (one THREE.BatchedMesh subclass per material key, global, not per
  tile; geometry lives only in WebGL buffers (GLBufferAttribute, GPU-side growth via copyBufferSubData), per-instance
  matrices relative to a camera-near anchor, per-instance culling + multi-draw); picking of detailed buildings uses a
  compact CPU copy (position + index only, chunk AABBs); mass CPU index/position released for picking-far tiles;
  hidden-tile cache capped by an estimate of its JS memory.

### Requests to building-kit (D5)
- (seen in materials.js already: VERT_XFORM applies batchingMatrix — thanks.) City puts every part of material key K of
  every detailed building into ONE THREE.BatchedMesh per key (multi-draw, per-instance matrix = building frame relative
  to a camera-near anchor). Please keep: (a) no per-building/per-mesh uniforms or onBeforeRender in kit materials;
  (b) all parts of one key carry the same attribute set (position, normal, uv, color, + the key's extras iwin0/1/2);
  (c) export `NO_SHADOW_KEYS` (or `castsShadow(key)`) so batches cast shadows exactly like createBuildingObject.
  City reads `materials.js` exports only; city falls back to per-building meshes if a part brings an unknown attribute set.
- **building-kit answer (fix round 1, 06:00)**: (a) kept — kit materials have no per-building / per-mesh uniforms and
  no onBeforeRender; every per-building value is vertex data. (b) kept — `materials.js` now exports
  `attributeNamesOf(key)` = position, normal, uv, color + EXTRA_ATTRIBUTES[key]. NEW attribute sets this round:
  `glass_clear` and the new key `glass_curtain` carry iwin0/1/2 (vec4); the indoor keys (plaster, stone_floor,
  wood_floor, wood_door, cabinet, counter, tile_floor, tile_wall, porcelain, fabric, black, mirror) carry `idl`
  (float, itemSize 1 — indoor daylight factor). (c) exported: `NO_SHADOW_KEYS` (Set), `castsShadow(key)`,
  `renderOrderOf(key)` (transparent glass 2), `isTransparentKey(key)`. VERT_XFORM handles USE_BATCHING and
  USE_INSTANCING. Kit README §7 "Batching" documents the rules.
- **building-kit → city (far mass shader, ★3 / D4)**: mass `flag 1` now means blank wall ONLY when `facade.y` (bayW)
  is 0 (kit emitMass writes 0 there); flag 1 with bayW > 0 (loftMass sky-garden / refuge storeys of buildings-z towers)
  is a **sky-garden storey** — please mirror in `massMaterial.js`: `bool skyG = blank && vCFac.y > 5.0;` (bayW cm > 5) → per storey
  fv = fract((v-gh)/fh): fv<0.07 white slab edge (0.95,0.94,0.92); 0.07–0.13 glass rail; < crown (0.42–0.84 per 2.3 m
  cell) green (0.13,0.24,0.08)…(0.3,0.42,0.15); fv>0.9 white soffit; else shaded set-back (0.27,0.3,0.3). Kit
  materials.js MASS_FRAG has the reference code.

### Requests (fix round 1) — read by the other fixers
- **buildings-z + urban (D1 trackOffset sign)**: urban `specs.js` writes `meta.trackOffset` = building-frame **z** of the
  track centreline (negative, e.g. −27.5 for station S9ruz39h.4 / ZR1-0.3.1a5.17w-n10.n5-0 next to S07), but
  `z_station_geom.stationTrack()` reads it as the **distance** (`zTrack = −trackOffset` = +27.5): the station
  building puts its tracks + platforms 27.5 m IN FRONT of itself, 55 m away from the rails (Node check:
  anchors.meta.trackZ = 27.5 while the tile rail polyline runs at z = −27.5). Please agree on one meaning — simplest:
  stationTrack `zTrack = trackOffset <= 0 ? trackOffset : −trackOffset`. City accepts both signs (≤ 0 → z, > 0 → distance).
- **props (D1)**: city rail head = polyline y + 0.35 at grade (ballast top y + 0.05, sleepers y + 0.00…0.18, rails
  y + 0.18…0.35) and = polyline y on viaducts AND rail bridges (deck top y − 0.35, slab track) → trains: RAIL_TOP_GRADE
  0.35, RAIL_TOP_DECK **0** (polyline y of elevated = ground + 9.0, of bridges = max(ground,0) + 7). Rail heads at the
  S07 station match the building's railHead within 5 mm (Node check).

#### Progress (fix round 1)
- [05:25] BASELINE S07 (workers=2, load avg 20–60): 42.4 k draw calls (city shadow passes alone ~28 k / frame),
  135 M tris, 10 fps, JS heap 1.81 GB at 348/520 tiles and still rising; 387 exterior + 16 full detailed (33.7 M
  tris). Root cause of the heap: detailed meshes released their CPU arrays only in onUpload, which never fires for
  meshes that are never drawn (culled parts) → the packed per-building buffers stayed alive.
- [05:40] DONE ★1 core: src/render/city/batch.js GpuBatch (BatchedMesh subclass, GLBufferAttribute buffers, GPU
  growth via copyBufferSubData, free-list ranges, per-camera culled multi-draw lists with their own indirect
  textures, uploads only when a camera's list changes); detail.js and streets.js draw through it (one batch per
  material key); quantised pick copies (16-bit positions / indices + worker chunk boxes, ≤ 320 m) for exact
  picking of balconies/canopies; outline = screen-space rim from a coverage+depth mask of the drawn geometry
  (shared GPU buffers via proxy meshes: detail parts or the building's mass range); debug layers on batches
  (objectId / lod per-instance tag texture, wireframe = LineSegments of the nearest 40 detailed buildings from the
  pick copies + flat batches, castShadow off; mass wireframe keeps its index, castShadow off).
- [05:50] run 1 after batching: 1.9 k draw calls (from 42 k) at 260 ext + 15 full; but 2.5 fps — three warned
  "17 texture units" on every draw (batching adds 2 vertex samplers) → FIX: warning threshold = fragment+vertex
  units (index.js init, comment there); result backlog capped (jobs + waiting ≤ maxJobs + 6: 149 finished
  buildings were piling up at low fps = ~750 MB); tile priority 100 + d/24 (far tiles no longer starve behind
  hundreds of detail jobs).
- DONE ★2 rails (D1) in streetBuild.js: head = y + 0.35 grade / = y viaduct+bridge, sleepers/ballast/deck from it,
  VIADUCT width, platform zones from the station buildings of the tile + neighbours (no parapets, bed/deck end at
  the platform edge). Node: S9ruz39h.4 rail head 542.225 vs building railHead 542.230.
- DONE 5 (getColliders anywhere; select() also takes forced-'full' buildings of far tiles), 7 G02 work towns
  (render/city/towns.js, 39–58 buildings + streets per town, Node-checked: 0 mass errors, terrain flat at y).
- [06:35] Node checks (scratchpad/city-fix1): at-grade S9ruz39h.4 rail head 542.225 vs building railHead 542.230,
  ballast top ends 3.57 m from the centreline along the platform (5.00 m elsewhere); elevated Sg1b4vvq.1 (ZR2)
  rail head 978.155 vs 978.160, deck half width 3.55 m in the platform zone, 0 parapet vertices there. Batch
  free-list fuzz (20 k ops) OK. Far mass tiles (> 2.6 km at install) drop CPU position/index (OBB picking).
  Detail queue backlog capped; front-to-back sorted batch lists (stable: re-sorted only after 12 m / 16°);
  interior-only kit materials cast into cascades ≤ 320 m wide only. Browser slots (2 machine-wide) busy
  since 06:16 → in-app verification queued.
- [06:50] answered building-kit: far facade shader mirrors the sky-garden storey (flag 1 + bayW > 5 cm → slab edge,
  glass rail, planting crowns, set-back, soffit; area average when unresolved); batches use kit castsShadow /
  renderOrderOf; street ground materials that borrow kit colours (now true mean albedos) get kitTint (ballast
  0.62, sidewalk 0.9).
- [07:15] IN-APP v1 (build of 07:00, workers=2, load avg 20–60, shots/city/fix1-v1-*): S07 at 502–520 tiles,
  380 exterior + 15 full: **2.0–2.3 k draw calls** (was 42 k), 112–128 M tris, 10–13 fps (GPU-bound under load),
  **heap 1.14–1.24 GB** without forced GC (was 1.81 GB at 348 tiles and rising); city idle at 520 tiles. Debug
  objectId / lod: 0 errors, per-building colour across all parts; wireframe renders (flat batches + edge lines,
  mass wire) but 8 uncaught "Cannot read properties of null (reading '0')" in 22 s (source not identified; frames
  keep rendering). Found + FIXED after v1: pickRay TDZ (dequantisation vars shadowed → every detailed pick threw;
  controls swallowed it), outline proxies needed manual bounds (49 console errors), wire lines / rim made
  non-raycastable. v1's ZR1 / G02 poses were taken in walk mode (S07 bookmark switches to walk) → redone in v2.
- [07:50] IN-APP v2 (orbit poses; build 07:21 with the fixes): S07 balcony pick test **10/15** points on detailed
  geometry outside the mass hull hit their own building within 20 m (the other 5 hit a nearer neighbour = real
  occlusion); the mass-only ray missed / hit farther in **15/15** → detailed picking works. Selection rim follows the
  detailed silhouette (balcony slabs, roof stair house: fix1-v2-s07-outline-aerial.png), 0 console errors, 0
  warnings in the whole session. G02-T1 work town renders (dorms, depots, control tower, treatment basins,
  greenhouses on the graded shoulder: fix1-v2-g02-town.png). ZR1 300 m: 1.39 k calls, 29 fps.
- [08:30] **OPEN, pre-existing (also in last round's z03/z04 shots): mass models beyond the detail ring are
  invisible in ZR1 1 km / 300 m views** (empty tree-filled blocks, no mass shadows). Diagnosed so far (v3/v4):
  the in-view tile meshes ARE drawn (23 main + shadow draws per frame), program linked, uniforms right (uCityK 1556,
  maxDist 15960/18430, fadePx 1.6/4), CPU state R = 255 / A ≈ 128 — yet no fragments survive. Suspects for the next
  pass: the vertex-stage state fetch (texelFetch(uCityState, bidx…) returning 0 → vCFade 0 + seat −64 m) or real
  seat offsets (A channel from terrain.groundHeightAt) sinking whole tiles. Not fixed this round.

### Done (fix round 1)
- ★1 GPU batches for detailed buildings + streets (batch.js), draw calls 42 k → 2.0–2.3 k at S07 (520 tiles), heap
  1.81 GB @348 tiles → 1.14–1.24 GB @520 tiles; per-camera culled, front-to-back, upload-stable lists; result backlog
  cap; far-tile mass CPU release (OBB picking); realistic tile-cache estimate (220 MB); interior materials only in
  narrow cascades; texture-unit warning threshold.
- ★2 rails per D1 (Node-verified at grade + elevated), station zones from station buildings (tile + neighbours).
- 3 debug layers on batches (objectId / lod per-instance tags, wireframe edge lines + flat batches, mass wire, no
  shadow casting while debugging); 4 picking + outline on the drawn detailed geometry; 5 getColliders anywhere;
  7 G02 work towns (towns.js); kit follow-ups (sky-garden far facade, castsShadow / renderOrderOf, kitTint).

### Remaining (fix round 1)
- invisible mid-range mass (above) — highest priority.
- wireframe layer: 8 uncaught "Cannot read properties of null (reading '0')" in 22 s (source not identified).
- 6 night windows: ZR1 300 m / 2 km night shots taken (fix1-v2-zr1-*-night.png) but the missing mass hides the far
  window field, so the window emission was NOT re-tuned.
- fps at S07: 10–13 with 112–128 M tris (GPU-bound on a loaded machine; 29–31 fps at ZR1 300 m); ≥ 30 fps at S07 not
  shown. Mass tiles are still one draw per tile (+ shadows).
- trackOffset sign (buildings-z / urban request above) still open on their side.

### Verification (fix round 1)
- shots/city/fix1-s07-before.png, fix1-s07-after1.png, fix1-v1-{s07,s07-outline,dbg-wireframe-s07,dbg-objectId-s07,
  dbg-lod-s07,s07-station-across}.png, fix1-v2-{zr1-1km-day,zr1-300m-day,zr1-300m-night,zr1-2km-night,s07-pick,
  s07-outline-aerial,g02-town}.png, fix1-v3-diag-zr1-1km-b.png. `npx vite build --outDir .build/city` OK (08:35).
  Private preview (5202) stopped.

## Fix round 1b (city-mass)
Instance "city-mass" (private port 5220: `npx vite build --outDir .build/city-mass` + `vite preview --outDir
.build/city-mass --port 5220`). Shots: shots/city-mass/ (d1-* diagnosis, d2-* mass ladder, d3-/d4-* S07). Scratch:
scratchpad/cm (diag.mjs = one-page step driver under slot.mjs, lib.js = in-page probes: GPU read-back of the state
textures, per-tile seat / ground / frustum report, fetch-only debug material, ring counter e_ring.js).
- [08:40] started (load avg 50–320 all session; browser slots held by QA most of the time).

### ★ "Invisible mid-range mass" — root cause: NOT a renderer defect (urban green belt in the repro view)
- Repro /?pose=22.34,117.78,780,30,-22,35 looks NNE straight along an urban GREEN BELT (暗绿间隔, world/urban/parcels.js:
  beltMask → BU.GREENBELT / BU.SPORTS blocks): Node `generateCityTile` of the in-view tiles gives 1–4 buildings per tile
  (0/6625/6365: 2 'community' sports pavilions, 25 park + 2 pitch areas, 10 local + 3 collector roads = 5.9 km of street,
  the same street density as the 281-building core tile 0/6624/6363). The blocks are empty in the DATA (terrain texture
  shows parks too); the belt is ~2 km wide and runs ~NE–SW for > 10 km (shots/city-mass/d2-5km-day.png / -night.png).
- Evidence the mass path works (d1 run, same pose): all 182 displayed tiles' state textures read back from the GPU =
  CPU stateData (0 mismatching bytes; R = 255 except the 19 buildings drawn detailed); seat offsets 0.00 m on every tile
  < 2.6 km (displayed − full-detail heightAt = 0.00 ± 0.02 m); fades off (uCityFadePx 0, uCityMaxDist 1e9) and seat
  forced to 0 → pixel-identical frames; a fetch-only debug material (texelFetch(uCityState, bidx) → colour, no fade / seat
  / dither) draws exactly the same few pavilions (d1-1km-day-dbgall.png). The "draws but no fragments" of round 1 were
  the meshes of belt tiles that hold 1–4 small buildings; the "sharp boundary at ~3 km" (2 km night) is the belt edge,
  which follows district polygons (CORE districts / town influence T > 0.6 keep their blocks), not a tile ring.
- Proof, dense heading 220 from the same point (d2 run, e_ring.js: buildings whose centre sphere is in the frustum, by
  camera distance; "orphan" = mass hidden while no detailed version is drawn): 300 m 0–8 km 8 854 in view, 1 km 12 671,
  2 km 27 189, 5 km 100 064, day and night — 0 orphans in every band (detail ring 300–1000 m: 107/108 and 137–143/230
  drawn detailed, the rest mass). Repro heading 30 night 2 km: 34 buildings in the 2–4 km band (belt), 17 988 at 4–8 km.

### 2 Seating (analytic ground for detailed buildings + colliders; mass converges)
- detail.js: detailed buildings (`_place`) and their walk colliders (`colliders()`) stand on the planned ground
  (spec.ground, analytic full-detail heights) — no seat offset at all any more (the S07c building had carried a 12.4 m
  coarse-terrain offset with its colliders).
- index.js / tiles.js: mass seating keeps the displayed terrain cut from the terrain contract (`tile:add` / `tile:remove`,
  numeric-keyed map, seeded from drawnTiles()); per building the drawn tile under its centre (cube-face lookup, level hint per
  city tile) gives `geomErr` and the height on the mesh's own triangles. Target = displayed − planned ground (±60 m, dead
  zone 0.4 m) ONLY while that tile's mesh error > `CITY_CFG.seatErr` (2 m), else 0 — so the mass converges to 0 offset
  once terrain refines (animated 25 m/s as before). Replaces terrain.groundHeightAt (finest READY tile, not the drawn one).
- Measured (d2 / d3 runs): 300 m step while terrain was still coarse (39 drawn tiles, p50 geomErr 1.5 km): mass offsets
  up to 17 m; same session 3 min later (refined): 0 non-zero offsets < 8 km; at 5 km only > 8 km (coarse) tiles keep
  offsets (≤ 11 m). S07 (walk, terrain L18/19 geomErr 0): detail placement − planned = (0, 0, 0) m, collider anchor −
  planned = (0, 0, 0) m, 11 126 mass buildings < 2.6 km with 0 non-zero offsets.

### 5 Station platforms at the tracks (S07 area, station S9ruz39h.4 = ZR1-0.3.1a5.17w-n10.n5-0)
- Node (types registered via registerTypeModules — plain Node otherwise falls back to generic!): stationTrack zTrack −27.50,
  kit anchors.meta.trackZ −27.5; tile rail polyline R9ruz39h.0_13_6644_6321.0 crosses building x = 0 at z = −27.504
  (4 mm), rail head polyline y + 0.35 = 0.160 = building railY 0.160; platform paving at platY 1.16 from the back facade
  (z −13.5) to the near edge −23.55..−23.9 and the far platform −31.1..−37.6; edge copings at 1.6 m from the track centres.
- In app: d3-station-aerial.png (both platforms + PV canopies on the tracks behind the station, bed ends at the platform
  edges), d3-station-platform.png (far-platform eye: train car floor at the platform edge, tactile line, sleepers).

### 3 Asphalt — real root cause: every street TOP face was wound face-down (culled), the terrain showed through
- d4 run at S07 (current build, walk mode): the asphalt street material set to pure red / black / envMapIntensity 0 →
  street pixels unchanged ((31,51,84) in all three, while 6 % of the frame changed between steps = live frames). The blue
  carriageway was the TERRAIN's painted road, not city geometry; the wireframe layer showed the terrain grid there.
- Node audit (scratchpad/cm/nwind.mjs, S07 tile 0/6644/6321): asphalt 34 224 / 34 360 triangles face-down, gutters 100 %,
  kerb tops 100 %, road sidewalks 7 048 / 8 828, markings 9 774 / 9 878, medians, rural shoulders; every obox (sleepers,
  posts, grates, bollards, piers) inside-out with face-down tops; bridge deck / box-girder soffits face-up. Vertical
  strips (kerb faces, retaining walls, fascias, parapets) were already right; areas (yards, plazas, pitches) and dock decks
  too. Cause: road()/bridge()/rail() author strips with "right of travel" offsets in the right-handed x east / z south
  frame in the order that winds them clockwise from above; obox's handedness test was inverted.
- FIX (streetBuild.js Builder): quad()/tri() orient horizontal-ish faces (|n.y| > 0.5) UP (reverse winding + normal + uv),
  DOWN while `b.down` is set (deck underside, box-girder soffit, solar frame underside, obox bottoms); obox flip test
  corrected (all box faces outward). After: 0 face-down horizontal triangles in every part of the S07 tile.
- Asphalt material (streetMaterials.js) now actually drawn: neutral dark grey albedo 0.092/0.090/0.087 (patches 0.076),
  roughness 0.95 × grain map 0.86–1.0 (aggregate glints 0.74 → ≥ 0.70), bump rescaled. Street-canyon horizon occlusion of
  the sky-only environment reflection on upward ground faces (uStreetHorizon; metals, glass, water exempt): 12 % at
  grazing → full from ~30° up, so eye-level streets stop mirroring blue sky while aerial views keep the sky reflection.
- After (d6 run on the fixed build, S07 walk view, same pose): lane markings, gutters, kerbs and the carriageway are city
  geometry now (wireframe layer: street debug grey + collider lines over the road instead of the terrain grid,
  d6-s07-wireframe.png). Sunlit asphalt = neutral dark grey (112,109,107 sRGB, d6-station-aerial.png, zebra crossing and
  edge lines visible; the terrain paint there read (128,139,117) / (98,116,85) before). Asphalt in a building's shadow is
  still dark blue (16,31,57 sRGB = linear 1 : 2.6 : 7.9): sky-only irradiance — every shaded surface takes that hue
  (shaded paving 68,93,128). Not a material property (request to atmosphere below).

### 4 Wireframe layer errors
- Not reproducible with the round-1 code (07:21+ fixes: wire lines / rim non-raycastable, outline proxy bounds, pickRay):
  0 page errors / 0 console errors in 25 s at S07 (d3), and in the d4 stress run (wireframe on 20 s at S07, 25 s at the
  station aerial with 16 wire buildings, 25 s at 2.6 km, back to S07 20 s; then 25 s on the next build and 25 s on the
  final one, d6). No code change.

### Requests (fix round 1b)
- **urban (world/urban/parcels.js green belts)**: the ZR1 belt next to the core (0/6625..6631/6363..6373, ~2 km wide,
  > 10 km long) keeps the district's full street grid — 10 local + 3 collector roads = 5.9 km of street, sidewalks and
  street trees per 650 m tile around parks — so from 300 m – 2 km it reads as "a district whose buildings failed to load"
  (the lead filed it as invisible mass). Suggest: no local streets inside belts (keep collectors / arterials crossing
  them), merged landscape (woodland, meadow, water, paths), and an organic edge instead of whole district polygons.
- **atmosphere (lighting patch)**: up-facing ground in shade gets only the sky SH irradiance (deep blue, linear chroma
  ≈ 1 : 2.6 : 7.9 on asphalt at S07, 10:30 local); real street canyons are mostly lit by sunlit facades / paving there.
  An urban fill for up-facing surfaces (sun irradiance × local ground / facade albedo × open-sky complement, from
  uLpGroundAlbedo) would make shaded streets, plazas and lawns neutral without per-material hacks. City materials only
  add the street-canyon horizon occlusion of the sky-only specular (streetMaterials.js).

### Remaining (fix round 1b)
- night: near detailed buildings read darker than the mid-range mass windows at 300 m (d2-300m-night.png) — window
  emission / lit fraction near vs far not re-tuned (item 6 of round 1, not in this brief).
- street tiles end at 1.3 km (STREET_CFG): beyond, the terrain's painted roads (similar grey) take over.

### Verification (fix round 1b)
- Diagnosis d1-1km-day-{base,fadeoff,dbgnear,dbgall,seat0}.png; mass ladder (heading 220 dense + heading 30 belt)
  d2-{300m,1km,2km,5km}-{day,night}.png, d2-2km-night-repro.png, d5/d6-1km-day-final.png, d5/d6-2km-night-repro-final.png
  (0 orphans in every band); S07 d3-s07-street.png / d4-s07-* (asphalt experiments) → d6-s07-street.png,
  d6-s07-street-aerial.png, d6-s07-wireframe.png; station d3-station-{aerial,platform}.png, d6-station-aerial.png.
  0 page / console errors in all runs (~25 browser steps). Final check &workers=3 (d6). `npx vite build --outDir
  .build/city-mass` OK (13:05). Private preview (5220) stopped; scratch builds removed.

## Fix round 2
Instance "city" (fix round 2). Private port 5302: `npx vite build --outDir .build/city && npx vite preview --outDir
.build/city --port 5302 --strictPort --host 127.0.0.1`. Shots: shots/city/fix2-*.png. Scratch: scratchpad/city-fix2/.
Items: ★C1 bridge structures (DB), ★C2 asphalt in shade, ★C3 plaza paving, C4 rail gauge, C5 G02 town ids, C6 outline
rim vs reflection pass + wireframe nulls, C7 city.farCoverage.
- [14:12] read ARCHITECTURE, brief §5/§6, qa-round1 (QS-06, QQ-04, QQ-10, QA-ASSETS-03, QA-ID-02), round2 backlog,
  notes/urban.md (urban-2.2.0 delivered DB: BG01 G01 A-pylons 128 m on 70 m islands, BZ5 ZR5 H-pylons 165 m, ZR4 127
  cable-stayed rail bridges with H-pylons up to 220 m, corridor girders; no arch bridge exists in the world yet).
  Node probe (scratchpad/city-fix2/nbr.mjs): pieces stitch by bridgeS (designated bridges measure s from the chord
  start, corridor ones from the abutment — only monotonic s is assumed), pylon t along THIS piece's polyline.
  Plan C1: street tiles keep the walkable deck top (asphalt / sidewalks / railings / colliders) of long-bridge
  pieces but no longer draw their structure; a new BridgeManager (render/city/bridges.js) stitches the pieces of
  every streamed city tile (out to the mass radius, ~19 km) per bridgeId and has the city worker build the whole
  structure (render/city/bridgeBuild.js, job 'cityBridge'): box girder + fairings, piers / pile caps, pylons H / A
  with footings on rock-armoured islands or caissons, semi-fan cables (min-pixel width + coverage dither so fans
  read at 5–10 km), arch ribs + spandrel columns, deck light dots + red aviation lights (min-pixel, energy kept).
- [14:30] code done for all items (build OK, 13 s): bridgeBuild.js + bridges.js + 'cityBridge' job; streetBuild long-bridge
  pieces = deck top only (+ lane markings, median barrier ≥ 9 m carriageway half, rail slab/parapets/track), rail gauge,
  gravel key for park paths, plaza uv along the longest edge; streetMaterials: procedural paving (plaza 1.2 × 0.6 m stone,
  sidewalk 0.3 × 0.6 m pavers, island 0.9 m), street-canyon term (C2), br_* materials with min-pixel cables / lights;
  towns.js townSpecById + lookup.js; outline rim only for the frame camera; city.farCoverage + truncation-aware mass band.
  Node checks: BG01 12 pieces → 1 run 440–5810 m, 2 A-pylons s 2725 / 3385 (660 m), level 0, build 77 ms, 25.3 k tris
  (68 piers, 208 cables, 372 lights), no NaN; BZ5 (H 165 m) 13 k tris; ZR4 B1s6xqwpj.1 rail cable (H 207 m) 12.7 k tris;
  arch mock (ZR2) path OK; BG01 street tile = marking / barrier / asphalt / sidewalk / kerb / railings only; rail inner
  gauge 1.4350 m (head edges ±0.7175 / ±0.7875); G02 towns: 187/187 ids resolve through lookup.js, JSON-identical.
  Browser cap is 1 machine-wide (MARS_SLOT_CAP) with a queue → one long session (job1: S05/BG01 far + outline in the
  reflection + pylon + deck + night, ZR4 far, S07 asphalt + wireframe 20 s, C06, C03, C03 down) queued at 14:29.

### Requests (fix round 2)
- **terrain-render (C7)**: `app.systems.city.farCoverage` → `{maxDist0, maxDist1, fadePx:[a, b], typicalSize, K, streamDist,
  truncated}` now exists; please read it in `render/terrain/index.js _updateLightBands` instead of mirroring CITY_CFG
  (`uTrCityFade = (typicalSize·K, fadePx[0], fadePx[1], 1)`, `uTrCityMax = (maxDist0, maxDist1)`): when the 520-tile cap
  truncates the streamed disc, the city's mass dissolve band now ends where the first dropped in-view tile begins, and
  the window aggregate must start there too (the old mirror leaves a dark ring).
- **props (C4)**: rail centrelines are now at ±0.7525 m (inner gauge 1.435 m between the 70 mm heads, head edges ±0.7175 /
  ±0.7875); train wheel treads (props/models.js, ±0.72 m today) should sit at ±0.7525 m. Long road bridges now have a
  0.6 m concrete median barrier at the deck centre where the carriageway half is ≥ 9 m (BG01 / BZ5): vehicles already keep
  to their lanes beside PR.median; lamps on long bridges stay props' (city draws only the far light dots beyond ~1.5 km).
- **ui**: the UI lookup worker (src/ui/lookup.worker.js) calls urban.buildingSpecById directly, which does not know the G02
  work towns; the pool job 'buildingSpec' (workers/handlers/lookup.js) resolves them now — use it, or import
  `townSpecById` from render/city/towns.js as a fallback there.
- **atmosphere (optional)**: the street-canyon term of streetMaterials.js (HORIZON_FRAG, CANYON: upward faces see 1 − SVF
  of facades / street instead of sky) could move into the lighting patch for every upward face in built-up areas, so the
  kit's plinths / forecourts / roofs in shade match the city streets' neutral grey.
- **urban (FYI)**: ZR4 inter-island cable bridges carry H pylons 168–220 m above the deck (h = 0.23·mainSpan + 18 for
  650–880 m main spans); the brief's 细索桥 asks for 60–140 m pylons — physically consistent as is, rendered as given.
  No arch record exists anywhere yet (the renderer's arch path is Node-tested with a mock).
- [15:18] job1 (build of 14:42, one session 27 min, workers=2, 0 page errors / 0 console errors in all 14 steps incl. 20 s of
  the wireframe layer at S07): 
  * BG01 (S05 urban pose, 4.7 km): 9/12 pieces → 24.5 k tris (worker 10.7 ms); A-pylons + islands + approach piers read, the
    pylons blend into the grey skyline at 4.7 km, fans too faint (coverage 7 %). 1.6 km: A-pylons, islands, piers, faint
    fans (fix2-bg01-pylon-day.png). On the deck: A-pylon, two inclined semi-fan cable planes, the far pylon, median barrier,
    lane markings, footways + railings, props lamps / cars / people (fix2-bg01-deck-day.png) — BUT the far deck-light heads
    were drawn near the camera as floating grey boxes → FIXED (discarded inside the near band, dithered in 1.3–1.8 km).
  * ZR4 (6 km): B1s6xqwpj.2 reads as a cable-stayed bridge (two 220 m pylons on islands, deck, piers, faint fans) — but the
    corridor ROAD beside the rail (34 m) shares the bridgeId → its pieces were merged into the rail deck's runs → FIXED:
    one record per (bridgeId, kind) = twin decks; the road twin of a rail crossing stands its pylons on caissons inside the
    rail bridge's islands (no overlapping islands).
  * Night (S05 4.7 km, local 21:00): no deck light dots / aviation lights visible (pylons dark against the lit city) →
    diagnosis job2 queued (renderer.properties uniforms of the bridge light materials).
  * C2 S07 shaded asphalt (same session A/B by the live canyon uniform): no term B/R 7.99 sRGB (14,28,52) = the QA navy;
    0.5 → 2.69 (25,31,45); 0.7 → 1.90 (29,33,43) dark neutral-cool grey; near lane 1.24. Defaults now 0.7 streets / 0.5 plazas.
    C06 asphalt (0.5): B/R 4.5 → 2.8.
  * C3 C03 plaza: 1.2 × 0.6 m slabs in a running bond, joints crisp near / averaged far, per-slab tones, dirt edges
    (fix2-c03-plaza.png, fix2-c03-plaza-down.png); plaza p10/p50/p90 lum 163/169/174 (QA flat slab 175/182/189).
- Also: far cable coverage ≥ 45 % out to 5 km (fading to physical by 18 km) so fans read in the mid ground.
- [15:30] night lights root cause (no browser needed): the min-pixel growth moved vertices along FLAT face normals — a box's
  faces only translate apart, its silhouette never grows (cables grow because their normals are radial). FIX: lights are
  `lightBox` with shared corners carrying corner normals (±1, ±hy/hx, ±1), growth = normal × grow (no normalize). Build OK.

### Done (fix round 2)
- ★C1 bridge structures (decision DB): render/city/bridgeBuild.js (worker) + bridges.js (BridgeManager) + job 'cityBridge';
  cable-stayed (H / A pylons on rock-armoured islands or caissons, pile caps, semi-fan stays in two planes, steel box
  fairing, auxiliary + approach piers), girder (box girder on twin-column bents / wall piers, pile caps at the waterline),
  arch (ribs, springing blocks, spandrel columns, approach columns; Node-mock tested — no arch record exists yet); deck
  light heads (far) + rail walkway / island lamps + red aviation lights (min-pixel, night only); street tiles keep only the
  walkable deck top of long-bridge pieces (+ lane markings, median barrier, rail slab / parapets / track); twin decks for
  rail + corridor road crossings. Verified in-app: BG01 4.7 km / 1.6 km / on the deck, ZR4 rail bridge at 6 km.
- ★C2 asphalt: street-canyon term in the street materials (sky occluded by 1 − SVF, replaced by facade + ground bounce),
  tuned in-app at S07: shaded asphalt linear B/R 8.0 → 1.9 (sRGB 14,28,52 → 29,33,43); C06 4.5 → 2.8 (at 0.5; now 0.7).
- ★C3 plaza / sidewalk / island paving: procedural slab shader (analytic box-filtered joints, per-slab tone / hue /
  roughness / tilt, edge dirt, wear lines, bevels, macro variation; plaza uv along the plaza's longest edge); park gravel
  paths have their own 'gravel' key. Verified at C03 (eye level + looking down).
- C4 rail gauge: rail centrelines ±0.7525 m → inner gauge 1.4350 m (Node-measured).
- C5 G02 work-town ids: towns.js g02Towns() / townSpecById() from sites.js, 'buildingSpec' job (lookup.js) tries them first:
  187/187 ids resolve, JSON-identical to workTown().
- C6 selection rim discards for any camera but the frame camera (water planar reflection, env captures); wireframe layer: 0
  errors in 20 s at S07 (and in every other step of job1).
- C7 city.farCoverage {maxDist0, maxDist1, fadePx, typicalSize, K, streamDist, truncated}; the mass dissolve band follows the
  maxTiles truncation (in-app at S05: 520 tiles, truncated, band unchanged 15.96–18.43 km because the cut lay beyond).
- [16:05] job2 (build of 15:31 with the lightBox fix, twin decks, near discard, cable coverage, canyon 0.7; 6 steps, 0 page /
  0 console errors of mine): night BG01 at 1.6 km — red aviation lights on both pylon tops + mid height, island lamps,
  faint fans against the lit city (fix2-bg01-night-near.png); 4.7 km — continuous deck-light row across the harbour +
  reflection, red lights (fix2-s05-bg01-night2.png); proposed S05 framing 2 km from the main span: both A-pylons on islands,
  BOTH cable fans clearly readable, approach piers, deck, harbour city behind (fix2-s05-proposal-day.png / -night.png);
  selection of the 72-floor tower ZR1-0.3.1hp.sy-n1.n1-0 across the harbour with the planar reflection active: rim mask
  drawn (rim.visible true, hazed rim on the tower at 6.4 km), no rim in the reflection (fix2-s05-outline.png).
  Final `npx vite build --outDir .build/city` OK (16:05); preview 5302 stopped.

### Remaining (fix round 2)
- Bridges are built from the city tiles that stream (frustum + 1.6 km ring, ≤ 19 km, 520-tile cap): a bridge partly outside
  the view / beyond a truncated disc shows only its streamed part (pylons whose piece is not streamed are missing).
- No arch record exists in the urban plan yet (renderer path Node-mock tested only).
- The kit's own plinths / forecourts in shade keep the sky-only blue ambient (the canyon term is in the street materials;
  request to atmosphere to generalise it).
- A-pylons seen broadside read as single columns (their A is across the deck); at 4–5 km against the grey skyline the pylons
  are low-contrast — the 2 km framing reads well.

### Verification (fix round 2)
- Node: scratchpad/city-fix2/nbr.mjs (bridge records / pieces), nbuild.mjs (stitch + build: BG01, BZ5, ZR4 rail + twin road,
  no NaN), narch.mjs (arch mock), nstreet.mjs (long-bridge street tile, S07 tile), rail gauge 1.4350 m, lookup 187/187 town ids.
- In-app (port 5302, workers=2, machine browser cap 1): shots/city/fix2-s05-bg01-day.png, fix2-bg01-pylon-day.png,
  fix2-bg01-deck-day.png, fix2-s05-bg01-night.png (before the light fix), fix2-zr4-bridge-day.png, fix2-s07-asphalt{,-cy0,-cy07}.png,
  fix2-s07-wireframe.png, fix2-c06.png, fix2-c03-plaza.png, fix2-c03-plaza-down.png, fix2-bg01-night-near.png,
  fix2-s05-bg01-night2.png, fix2-bg01-pylon-day2.png, fix2-s05-outline.png, fix2-s05-proposal-day.png, fix2-s05-proposal-night.png.
- Lead (bookmarks.js): suggested S05 = pose 0.53127,129.95260,20,12.7,2,45 at solTime 6.84 (local 15:30): BG01 across the
  mid-ground at 2 km, both pylons on their islands, fans readable, harbour city behind (urban's 0.48653,129.94351 puts the
  bridge at 4.7 km against the skyline).

## Fix round 3
Instance "city" (fix round 3). Private port 5308: `npx vite build --outDir .build/city && npx vite preview --outDir .build/city
--port 5308 --strictPort --host 127.0.0.1`. Shots: shots/city/fix3-*.png. Scratch: $SCRATCHPAD/city-fix3/.
Items: ★C1 S05 far towers (2–6 km mass LOD reads as plain grey boxes) → far facade articulation (storey bands, window grid with
depth, ceramic fins / crowns, curtain-wall reflections mirroring the kit BK_CURTAIN layers, per-building tones); C2 C04
plaza-edge glowing-cap bollards (kit `bollard()` via station.js `bollardLine`, not props') light no ground → light pools.
Browser budget: ONE machine-wide slot (shared with QA) → Node checks, ≤ 3 app shots.
- [start] read ARCHITECTURE, brief §5/§6, qa-round2 (C04 evidence A-C04.png: 15 kit bollards at the station plaza edge, lens
  band lit, no pool), props notes (light bollards are props' own; the C04 row is the kit's), kit materials.js MASS_FRAG /
  BK_CURTAIN, city massMaterial.js (far facade = flat avgC once the window grid is sub-pixel → grey boxes at 2–6 km).
- [21:22] C1 code: massMaterial.js far facade = exactly box-filtered storey / bay pulses (cityPulse: spandrels, slab bands,
  mullions, window reveals with view-angle occlusion) instead of the flat avgC once the window grid is sub-pixel; glass
  towers by family (massBuild.js farFamily → facadeId.w bits 10–15, mirrors office.js towerLayout's random stream:
  Node-verified on 6 S05 towers: lantern ↔ frosted glass, plant ↔ grille, banded ↔ ceramic spandrels); coated glass F0
  0.2–0.31 tinted per building + aluminium / ceramic F0 by coverage (after lights_physical_fragment); city reflection
  (cityReflect, far twin of the kit BK_CURTAIN rings, scaled to the building height) mixed into the env radiance; per-
  building ceramic / glass tones. C2 code: cityTile.js findBollards (lens band + post foot signature; station
  ZR1-0.3.1a5.17w-n10.n5-0: 22 bollards at the forecourt, office tower 19), detail.js updatePools (additive warm
  discs r 1.9 m like props' light bollards, × uLpEmissiveScale, night-gated). Build OK; preview 5308 up.
- [21:31] in-app cap1 (build 21:20, workers 2, not idle at 247 s): S05 → the far towers now show storey bands, sky-garden
  bands and tone differences (shots/city/fix3-cap1/S05.png; urban's new G01 skyline: crown CBD cluster mid-frame) but read
  dark-grey (glass reflected the "neighbour ring" up to the top: Hm was 1.15 × own height). 0 console errors. C04 → the
  pools render, but at the kit's LEVEL foot height (gF) while the plaza slopes: Node (poolground.mjs) feet 0.9 m above …
  0.37 m below the street surface along the row → seen edge-on as a thin bright line (fix3-cap1/C04.png).
- [21:35] fixes: findBollards(data, spec) puts each pool on the draped ground (heightAt(…, 1.5) + 0.14, feet within
  −0.6 … +1.2 m of the terrain; Node: 1–3 cm above the plaza paving along the row), pool r 2.1 m; reflect skyline Hm =
  0.8 × height (upper floors mirror the sky), coated glass F0 0.26–0.38, lighter office glass diffuse, silver diffuse
  0.46 + F0 0.5; podium office towers get crown + sail-fin geometry in the mass (officeTowerLayout / towerExtras: crown
  tops identical to the 'exterior' model in Node — lantern lid 311.0 m, plant screen 173.4 / 80.9 m). cap2 queued.
- [21:46] cap2 (build 21:35, workers 3, not idle at 317 s): S05 (fix3-cap2/S05.png) towers lighter, storey / sky-garden bands
  and the new crowns read at 5–6 km; haze still dominates the tone at that range (luma p50 137.6 = QA's 139.3, p5 85 vs 79).
  C04 (fix3-cap2/C04.png): pools lie on the plaza along the bollard row — mean luma of the plaza strip in front of the row
  rows 670–705: 19.8 / 25.3 / 33.7 / 37.5 / 60.1 / 57.4 / 56.3 / 45.3 vs QA 16.2 / 14.3 / 18.6 / 31.3 / 49.8 / 45.4 / 34.8 / 36.1,
  no floating line any more. 0 console errors in both.
- [21:52] QZ2-06 (qa-round2 addendum, city): C11 cold start with the wider ±240 m clamp first floated near blocks ~240 m UP
  (fix3-cap3/C11.png): the seat target used the unshifted coarse tile heights while terrain-render draws those tiles shifted
  onto the analytic ground around the nadir (datum shift; the old ±60 m clamp hid most of it, the far slopes still floated).
  FIX: target = tile height + terrain.displayShift(building centre) − planned ground; nonlinear 8-bit seat code (encodeSeat,
  ±250 m, Node round trip ≤ 1.6 m at 240 m, 4 mm at 0), seat speed max(25, 3.5·|err|) m/s. fix3-cap4/C11.png (33 s): every
  block sits on the drawn terrain, no floating clusters.
- [21:55] regression check C01 (fix3-cap5/C01.png, 1 km in the ZR1 tower district): mid / far mass towers read as white-banded
  glass towers with blue-gradient glass, crown fins / lanterns, sky gardens, round towers with white rings — consistent with
  the detailed towers in front. 0 console errors.

### Done (fix round 3)
- ★C1 far towers: massMaterial.js far facade = exact box filter of storey / bay zones (spandrels, slab bands, mullions,
  window reveals hiding glass with the view angle) instead of a flat average; glass families from massBuild.js farFamily
  (white-banded / silver / round, mirrors office.js towerLayout's random stream; facadeId.w bits 10–15); coated glass F0
  0.26–0.38 tinted per building + aluminium / ceramic F0 by coverage; cityReflect (far twin of the kit BK_CURTAIN rings,
  skyline scaled to 0.8 × own height) mixed into the env radiance; per-building ceramic / glass tones; crown (12 white
  blades / white louvred plant screen / frosted lantern box) + two white sail fins as mass geometry for podium office
  towers (officeTowerLayout + towerExtras, Node: crown tops = the 'exterior' model's). Program key city-mass-7.
- C2 bollard pools: cityTile.js findBollards (lens band + post-foot signature, pools on the draped ground) → data.bollards;
  detail.js updatePools (night-gated additive warm discs r 2.1 m × uLpEmissiveScale, like props' light bollards).
- QZ2-06 (addendum): seat target on the DRAWN ground (+ terrain.displayShift), ±240 m nonlinear seat code, faster seating.

### Requests (fix round 3)
- **buildings-z (station.js / z_common.js bollardLine)**: kit bollard rows are emitted LEVEL at the front-side mean ground
  (gF) while the plaza in front follows the terrain — at the S07 / C04 station ZR1-0.3.1a5.17w-n10.n5-0 the 22 posts float
  up to 0.9 m above the street surface at one end and sink 0.37 m into it at the other (front corners 540.66 / 544.70 m).
  Seat each bollard on its own ground (`groundAtU`-style per post) — city's pools already follow the ground.
- **buildings-z (office.js towerLayout)**: city's far LOD mirrors towerLayout (random stream subRng(hash, 970): p, taper,
  twist, fins, crown, banded in that order; plan superellipse + taper / twist; crown() / sail-fin dimensions) in
  render/city/massBuild.js officeTowerLayout / towerExtras. If you change it, tell city (or export towerLayout).
- **lead**: S05 at 5–6 km is haze-dominated (tower tone ≈ sky); the articulation reads much better at 1–3 km (C01). A
  final S05 capture with workers=8 / converged accumulation will show the bands and crowns more clearly than the
  workers=3, not-idle check shots.

### Remaining (fix round 3)
- Residential towers (residential_tower / residential_round) keep the shader-only far look (no corner ribbon fins / crown
  set-back geometry beyond the kit mass).
- Pools are flat discs: on stairs / kerbs inside the 2.1 m radius the light does not wrap; the near kit lamps are not in
  props' SpotLight set.

### Verification (fix round 3)
- Node (scratchpad city-fix3): s05towers.mjs (826 tall buildings in the S05 frame: office / residential_tower Z-glass),
  famcheck.mjs (6 towers: lantern ↔ frosted glass, plant ↔ grille, banded ↔ ceramic spandrels), extras.mjs (crown tops vs
  'exterior' model: 311.0 / 173.4 / 80.9 m identical, no NaN, 224–720 tris per tower), masscheck.mjs (S05 tile, 0 errors,
  family bits present), bollards.mjs (station 22 / office 19), poolground.mjs (pools 1–3 cm above the plaza paving),
  encodeSeat round trip.
- In-app (port 5308, slot cap 1): shots/city/fix3-cap1/{S05,C04}.png, fix3-cap2/{S05,C04}.png, fix3-cap3/C11.png (before
  the displayShift fix), fix3-cap4/C11.png, fix3-cap5/C01.png — 0 console errors in all. `npx vite build --outDir
  .build/city` OK (final). Preview 5308 stopped.
