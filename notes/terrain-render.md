# terrain-render — progress log

Owner files: src/render/terrain/* (index.js, material.js, tileBuilder.js, raycast.js, config.js,
benchWorker.js, tools/*), src/workers/handlers/terrainTile.js, src/world/surface.js,
dev/terrain.html + src/dev/terrain.js, ARCHITECTURE.md §8 "Tile water data" subsection.

Private port 5185: `npx vite --config src/render/terrain/tools/vite.bench.config.js --port 5185 --strictPort --host 127.0.0.1`
(dev server, hmr=false — restart after edits to be safe).

## State at resumption (2026-11-16, instance N+1)
Previous instances (several, interrupted by usage limits) wrote everything below but no notes file.
Implemented (per code audit):
- index.js: quadtree over 6 faces, SSE split (geom error + texel criterion, grazing relax), frustum +
  horizon culling, parents stay until 4 children READY, merge hysteresis 0.72, 2:1 balance
  (restricted quadtree) + edge morph stitching (uTrEdgeCoarse), geomorph + texture cross-fade
  (0.5 s), look-ahead requests of grandchildren, sibling batching ('terrainTiles' job), priority by
  ratio, stale-job cancel (40 frames), LRU eviction (1.8 GB / 3000 tiles), progressive textures
  128 → 256 → 512 (in-place upgrade, rev++), placeholder globe until roots exist, failure back-off.
  API: raycast (exact tri test, block AABBs), heightAtLatLon, groundHeightCached, groundHeightAt,
  isIdle, drawnTiles, getTile, tileGridPosition, debugStats; events tile:add/remove.
- tileBuilder.js: worker build of mesh (65² + skirts, morph deltas to parent shape), textures
  albedo(sRGB, A=AO)/normal(object space, A=gloss)/emission(sRGB/EMISSION_RANGE, A=onset), water
  grid data + texel mask, urban lattice for coarse texels, neighbour-building AO, terrain band AO.
- material.js: MeshStandardMaterial + onBeforeCompile, lighting.patch(nightEmissive, onsetAlpha,
  cloud shadow), relief exaggeration by screen footprint, procedural sub-texel detail, strata bands,
  debug layers province/zone/density/emission/wireframe/lod/normals, clean → none.
- surface.js: full look function (rock facies, basalt, sand, soil, ice, frost, beach, sea tint,
  urban fabric grade, vegetation, fine detail, road markings, night light shaping + emission-map
  envelope + filigree), surfaceSample / shadeSurface / surfaceMicroHeight.
- Uncommitted change found: removed the urban 8×8 block pre-pass gate in tileBuilder (complete).

## Audit / TODO (this instance)
- [x] restart 5185 server, screenshot tours a1 (17 stops, died at 11) and a2 (15 stops incl. layers)
- [x] check-water contract (checker false positive on sea-dilated shoreline vertices fixed), debug
      layers sweep (all 7 + clean), idle timings (disc 247 s cold under load ~340; 1 km oblique not
      idle in 300 s under load ~390)
- [x] fixes: stale upgrade jobs cancelled, AO lattice step, filigree cache + prefilter + floor, city
      lift, shallow tint
- [x] build check `npx vite build --outDir .build/terrain-render` OK (55 s)
- [x] final report delivered (2026-11-16 ~02:50); server on 5185 stopped

## Remaining (for the next instance / QA)
- Time-to-idle is dominated by world-function cost per texel (sampleTerrain 10–75 µs, urbanSample
  5–30 µs) × 17k–264k texels per tile; re-measure on an unloaded machine (tools/idle.mjs) — the
  numbers above were taken at load avg 280–390 with swapping.
- Merges (zoom out) pop: children are dropped without a reverse geomorph (splits do morph in).
- Eye-level verification in open terrain still to redo when the machine is quiet (a1/09 landed inside
  a building; the coast/ridge/ZR2/ice stops never reached their finest levels under load).
- Orbit city has no street-grain texture (texel 3.8–7.6 km at the disc); district polygons from the
  urban fabric read as a mosaic at 100 km.

## Log
- 01:05 resumed; machine heavily overloaded (load avg 280–390, swapping, ~5 % of a core per
  process): wall-clock timings are meaningless, use CPU time (process.cpuUsage) in Node.
- check-water.mjs: contract OK (5 tiles incl. L13 T256 sea tile).
- tour a1 (shots/terrain-render/a1/): no stop reached terrain idle within 150 s; 1 km / 100 m views
  look good (city on terrain); orbit day = flat grey city blobs (2.2× rock luminance, A03 ~2.9×);
  orbit night = only the emission-map "spider" (fat beads), rest of the city black. Tour died at
  stop 11 (browser could not render a frame in 30 s).
- warm CPU per tile (Node, after 1-time terrain map preprocessing ~2 s/worker): L2 128² 1.6 s,
  L2 256² 2–3 s, L5 256² 4.6–5.8 s, L9 256² 2.0–3.0 s. shadeSurface 170–225 µs/texel at orbit texels.
- FIX index.js: texture-upgrade jobs of tiles that left the cut were never cancelled → they piled up
  at the back of the pool (pending 40 → 343 in the tour) and kept app.isIdle() false. Now tracked in
  `upgrading` and cancelled when not wanted for staleFrames/4 frames.
- FIX tileBuilder.js: neighbour-building AO lattice step 2.5 m → [4.5, 9) m (blur radius is 10 m):
  −55k urbanSample calls per L13 512² tile.
- surface.js: filigree octaves cached per texel (was evaluated up to 3× = 12 worley3 per coarse
  urban texel); prefiltered (energy-conserving) corridor / town profiles so sub-texel towns sparkle
  at orbit (A02) instead of fading out; built-fabric lift (gradeUrban(c, built)) for the A03 silver
  sheet, coarse canyon darkening 0.28 → 0.18.
- urban light filigree gets a 0.4 uniform floor (mean preserving) so residential areas glow between
  the corridors; teal shallow tint limited to the first metres (no turquoise coastal ribbon at orbit).
- Node globe previews: shots/terrain-render/a1/g_night_v2.png, g_day_v2.png. Finding: the urban
  plan's ZR1 extent itself is the radial "star" of the control maps (day city = night spider): world
  layout (urban-fn / control maps), not a renderer defect.
- tour a2 (after the fixes, load avg 340–390): disc day terrain idle 247 s from cold (110 builds + 84
  upgrades, pending 0), disc night idle 7 s; 1 km oblique ZR1 NOT idle after 300 s (reached L12, 207
  drawn, 318 built). Warm CPU per tile (contended, old code): L2 128² 1.6 s / 256² 2–3.3 s, L5 256²
  4.6–5.8 s, L9 256² 2–3 s, L13 256² 2.7–3.5 s / 512² 6.1–7.2 s, L17 512² 6.6–7.9 s; shadeSurface
  ≈ 37 µs/texel at 8 km texels → tile cost is dominated by sampleTerrain / heightAt / urbanSample and
  their one-time per-worker setup (terrain maps.js edt2 + gaussBlur ≈ 2 s CPU per worker).

## Fix round 1 (2026-11-16, port 5203)
Brief: ★1 night emission (D3), ★2 orbit look, ★3 orbit night sharpness, ★4 seam 22.3N 117.8E, 5 shore,
6 merge pops, 7 district mosaic / steep rock, 8 near-first refinement, 9 night-side legibility.
Server: `npx vite --config .build/terrain-render/vite.dev.mjs --port 5203 --strictPort --host 127.0.0.1`
- [05:10] started; reading code / notes.
- [05:50] ★1 done (code): emission texture re-encoded (R window aggregate, G street light — EMISSIVE units,
  B temperature, A onset; sRGB so premultiplied intensities filter linearly). surface.js: STREET_UNITS 0.35
  per unit lightGround (boulevard ≈ 0.33 u, local ≈ 0.18 u), far = FAR_UNITS·(light·fil) − street (one formula
  at all texel sizes), map envelope MAP_UNITS 3.2 (cores ≈ 10 u peak), orbit outskirts settlement dots
  (bgDots, BG_UNITS 0.12, O zones sparse/cold). material.js rebuilds the radiance after LP_EMISSIVE with the
  same gate/unit; street light × smoothstep(1000, 1500, d); window aggregate × (1 − city visibility of a 30 m
  building: px 1.6–4 & city dmax band, from app.systems.city.cfg/K). First shot (night 2 km, terrain not
  refined): road glow gone, windows readable.
- ★2: urban lattice footprint = texel for texel ≥ 2.6 km (towns resolve at 5.2 km texels); orbit tiles
  supersampled (orbitTexelPx 0.62 at level ≤ 3 → L2 tiles at the full disc, limb relax ≤ 1.3);
  orbitPatchwork (48/17/6/2.2 km cells, ±8–10 % tones, dark border streets ≥ 0.7 texel); ragged fringe
  modulation; ★3 shader local-contrast (vs 4× coarser mip) at footprints > 1.5 km.
- 6 reverse geomorph on merges (_applyMerges), 7 district tone −50 % at all texel sizes + no urban paint on
  slopes > ~41° / cliff, 8 nearness-boosted priorities (builds ×(1+3e^(−d/2.5h)), near upgrades compete with
  builds, balance ×1.5 instead of ×4), 5 shoreClamp (interior shore vertices lowered 0.3 m under the level when
  the fine ground in their 1-ring is wet, low shores only).
- ★4 analysis: mean albedo of a 3 km ZR1-core patch is consistent across texel sizes (5–650 m: sRGB 178–192,
  +12 step at 41 m from the urban L2 level). Hard "road grid vs flat" tile boundaries match tiles built WITHOUT
  the city: a worker whose dynamic import of world/urban.js failed (dev server serving a half-written urban
  module) kept building city-less tiles for its whole life, and urbanSample exceptions were swallowed per
  texel. Fix: initSurfaceModules retries a failed import (≤ 6×, 15 s apart, cache-busted), ensureTileBuilder
  re-checks, tiles report urbanOk/urbanErrors and the main thread rebuilds degraded tiles (3×, 8 s apart).
  Also removed texel-size dependent colour terms (single far-light formula, district tone fix at all sizes,
  wide ramps for the orbit patchwork / map envelope / outskirts dots) so neighbouring levels agree.

### Requests (fix round 1)
- city: expose the effective far-window coverage (e.g. `city.farCoverage → {maxDist0, maxDist1, fadePx:[1.6,4],
  typicalSize}` reflecting the maxTiles cap) — terrain mirrors CITY_CFG + uCityFadePx for a 30 m building to
  draw the window aggregate exactly where the 3D city does not (gap if the 520-tile cap truncates the disc).
- urban-fn: (a) L0 samples could carry the metro / regional corridor road fraction (or distance) so orbit
  textures draw the real dark rail / road lines instead of synthetic patch borders; (b) L1 vs L2 colour mean
  in the ZR1 core differs by ≈ +12 sRGB at 41 m texels.
- [06:15] ★4 ROOT CAUSE confirmed in-app (fix1-seam-day/lod.png at 22.24N 117.72E 2.6 km): the seam is a
  level boundary (orange coarse tile = flat dark green, teal finer tile = road grid). Node scan: the urban
  raster's L1 (≥ 140 m) and L2 (≤ 60 m) levels disagree locally on parks / green belts — 371 of 1681 points
  in the ZR1 core differ by > 0.3 green share between 41 m and 164 m footprints (L1 park where L2 has a road
  grid and vice versa). Renderer fix: parent-texture edge band (22 % of the tile) on edges that border a
  coarser displayed neighbour (uTrEdgeCoarse, parent textures kept bound) → no hard line between levels.
  Request to urban-fn: L1 park / belt placement must follow the L2 blocks (or L1 must not place parks L2 does
  not have).
- S02 (first bg version): fine warm dots + point-like spider cores, dark inner sea outlined by coast dots;
  then restricted the dots to settled land (density prior) for long dark gaps.
- [06:22] regional night sparkle (material.js): window aggregate × world-anchored lit/dark building / block
  dots (34 m / 130 m cells, 55 % lit, mean 1, footprint-prefiltered) at 3–150 m/px → no flat glowing sheet.
  Final batch shots (load avg 150–240, workers=3, pages NOT idle after 110 s — partially refined tiles):
  seam-day2 (soft transition, no hard line), 100 km day/night & 20 km day still show unrefined coarse tiles
  (blurry, filigree cells / district mosaic of coarse parents).
- [06:40] regional sparkle toned down (single jittered 34 m octave, amplitude 0.6); urban-light filigree and
  outskirts dots limited to orbit tiles (texel > 1.2–1.4 km) so coarse transient parents at regional views do
  not show Voronoi cells. Final batch (12 shots, 0 console / page errors, none idle in 110 s at load 150–240):
  1 km night = windows readable, no terrain glow near the camera, thin dim street grid beyond 1.5 km; 1 km /
  5 km day OK; seam spot soft (no hard line); S02 dots + point-like cores, dark inner sea outlined by coast
  dots; S01 night side dots concentrated on settled land. Not verified refined: 100 km / 20 km (pages left
  coarse tiles), G01 grazing far shore still serrated at distant coarse tiles.
- Build: `npx vite build --outDir .build/terrain-render` OK (20 s). Dev server for next time:
  `npx vite --config src/render/terrain/tools/vite.bench.config.js --port 5203 --strictPort --host 127.0.0.1`
  (the .build/terrain-render dev config is wiped by the build).

- [06:52] regional night (20 km shot from the build showed every district lit as a flat tan sheet with bright
  arterial edges): window aggregate redistributed along the street light at 3 m – 3 km/px (ratio to the
  2.5-mip street light, mean preserving) → street networks glow, block interiors darker. Rebuilt OK.

### Remaining (fix round 1)
- Verify refined 100 km / 20 km day & night and S01 day patchwork once the machine is quiet (tiles never
  finished loading at load avg 150–240).
- Far serrated shoreline at grazing views on distant coarse tiles (G01 S09): clamp is interior-only and
  limited to low shores (≤ max(2 m, 10 % vertex spacing)).
- Night-side relief legibility comes from the atmosphere's night light (directional night term); terrain only
  exaggerates relief at orbit footprints.
- Orbit day: patchwork / dark lines are mostly sub-pixel at the full disc; cities still read pale grey with
  crisp envelope edges (urban envelope from the control maps); terraced field arcs not done.
- [07:12] final 20 km night re-shot (after the street-concentration change) could not get a browser slot in
  20 min → not verified. Servers on 5203 stopped, scratch deleted. Final report delivered.

## Fix round 2 (2026-11-16, port 5304)
Brief: ★R1 camera-first refinement (Z-01, QA-ASSETS-01), ★R2 steep faces (QQ-11 S08 curtains, S04 ice cliff),
★R3 waterlines (Z-04 sawtooth / width jumps, water's steep-shore request), ★R4 orbit readability (Z-05, S01/S02,
DN lightPort, DG harbour), R5 night-side relief (optional).
- [12:20] started (load avg ~120 on 10 cores). Read QA texts / evidence (cropS08C-ll, crop-waterline, L0-orbit-crop,
  TW90-zr2-crop, S01/S02-320).
- Node chain bench (ZR1 street pose 22.0015N 118.0107E, one tile per level 1..17, CPU s): T=64 Σ 2.6 s (0.06–0.46),
  T=128 Σ 6.2 s → a full 4-sibling chain is 10–25 CPU-s: the 2–3 min of Z-01 is scheduling (frontier advances one level
  per "4 siblings READY", sibling batches build serially in one worker, waits behind breadth / city jobs), not cost.
- [12:50] ★R1 implemented (index.js): _focusChain (chain root→L(≈6×hAG, ≥40 m; L17 at eye level) requested every frame,
  all levels at once, single-tile jobs, priority −2e6+L, roots −3e6, queued sibling batches split, chainTex 64 for
  intermediate levels, TEX_LOW for the last two), chain priorities protected against the traversal's overrides,
  _updateDatum + material uTrDatum (vertex shift of coarse tiles onto the analytic ground at the nadir, soft threshold
  0.3–1 m, full within 0.6 leaf sizes, none beyond 2.5; no terrain shadow casters while |Δ| > 0.5 m), displayShift(ecef),
  chainInfo(), debugStats().chain; 64² parents used as edge-band sources get a TEX_LOW upgrade (pri 1000).
  Test (dev 5304, workers=2, load ~110, cold start ZR1 street walk pose of QA-ASSETS-01): roots at +44 s after ready,
  nadir L0→L17 by +109 s, tile error at the camera −90.9 m (L0) → 0.55 (L8) → 0.03 (L11) → 0.00; datum kept the shown
  ground at the camera within 0.4 m from the first tile on. shots/terrain-render/fix2-r1-zr1-street.png: entrance at
  eye level, steps / ramp on the pavement (QA saw the camera above the 8-storey roof). CPU: chain ≈ 10–25 CPU-s →
  idle machine with 8 workers ≈ 2–4 s, 2 workers ≈ 15 s.
- [13:25] R2/R3/R4 code in: material.js FRAG_MAP rewrite (derivatives in uniform flow; steep-face procedural material
  > ~46°: mean colour from mip+2, strata bands from vTrH with 3D wobble, world-anchored periodic 3D noise blocks
  (uTrCMod = centre mod 65536 + vTrLoc), ice-cliff variant (dust layers, blue recesses, gloss 0.5); normal → mesh normal
  on stretched texels + strata/blocks bump), water dry-out (per-vertex level attribute trWl from tileBuilder `wl`,
  mesh > level + 0.15–0.6 m → dry bank colour sampled uphill, gloss ≤ 0.42, mesh normal), steep tiles (cell rise
  > 1.2× width) refine with minVertexPx/2; shoreClamp now from the texel water mask (1-ring ≥ 0.2, water vertices
  included; perched-river levees no longer pulled down); surface.js: ice-cliff faces forced to ice (iceCliff ×
  slope / slopeHint), no urban paint there, DN lightPort → cold street-channel floodlight rows (PORT_NEAR 1.4 /
  PORT_ORBIT 3.0 units, EMIT_STREET_RANGE 2 → 8), coast cold-port hack only without lightPort, bg dots only on
  settled texels (urban light > 0.002–0.02), G01 harbour tint (deep green-blue, coverage boost at orbit);
  tileBuilder orbit canyon darkening from the cavity bands (texel ≥ 0.7–2.6 km); uTrExag 3.2/5.5/11.5 → 5.5/6/12.
- [13:20] batch 1 (dev 5304, workers=2, load 40–110, pages not idle after 120 s): S08 (fix2-r2-S08.png) cliffs now
  horizontal strata, no vertical curtains (QA cropS08C-ll had curtains); S04 (fix2-r2-S04.png) ice cliff reads as
  white-blue ice with thin dust layers / blue recesses (was brown rock); levee eye pose of Z-04
  (fix2-r3-levee-eye.png + -crop) near waterline smooth, no cell sawtooth; S05 (fix2-r3-S05.png) cliff-foot waterline
  straight, no blue glossy teeth (white zig-zags on the cliff are 3D city roads, not texture); S02 rural dots gone
  between the city stars (long dark gaps). S01 page failed to start (2× "[worker error] Event" while I was writing
  tileBuilder.js) → re-shot in batch 2.
- Node: orbit canyon darkening v1 (AO bands) had no effect — heightAt keeps the big landforms (ZR2 canyon, rifts) at
  every band limit (h(6 km) = h(24 km) = h(96 km)), so h_lp(r) − h_lp(r/4) = 0; v3 = texel-height window
  (±12 km, margin ring from heightAt for seamless edges) × relief gate (max−min > 3–7 % of the radius): ZR2 canyon
  now a dark branching line through the white city at L3, range-zr1w valleys dark between ridges (Node albedo
  previews). shorecheck (Node): ZR2 levee L15/L17 wet-mask texels with mesh above level: 0 (max 0.00 m); G01 L13 6,
  L11 455 (quay walls / steep coast > lim: handled by the shader dry-out).
- groundHeightAt / groundHeightCached return the drawn ground (displayed leaf + datum shift) inside the shift region.
- [13:45] build `npx vite build --outDir .build/terrain-render` OK (39 s); check-water contract OK. Batch 2 (S01,
  disc, R1 canyon timing) failed once on page.goto timeout (load) → retried, waiting for a browser slot (other fixers'
  long batches hold both).
- [13:55] trWl: own BufferAttribute per geometry (a shared attribute object loses its GL buffer when any tile is
  disposed); full-detail analytic ground only for cameras < 40 km (no cache-building hitches while spinning at orbit).
  Canyon pose chain CPU (Node): T=64 Σ 13.7 s / T=128 Σ 17.7 s per tile-per-level → 4-sibling chain ≈ 55–70 CPU-s
  (hydro / rock heavy) → ≈ 7–9 s with the default 8 workers on an idle machine, ≈ 30 s with 2.

### Requests (fix round 2)
- city: while `terrain.chainInfo().datum` ≠ 0 the shown terrain near the camera is shifted by `terrain.displayShift(ecef)`
  (`groundHeightAt` includes it): seat near-camera masses on that (or on the analytic ground, as already requested)
  so they do not float / sink by the coarse-tile error during the first seconds after a jump.
- urban: `urbanSample(...).lightPort` (DN) is consumed when present (cold street-channel floodlight rows, PORT_NEAR 1.4 /
  PORT_ORBIT 3.0 units); until then the old coast-distance cold tint stays. Orbit rural dots now need urban light in the
  texel (U.light > 0.002–0.02): O-zone sluices / shift stations / levee towns must be lit in the plan to show at orbit.
- terrain-fn (FYI): heightAt keeps the big landforms at every band limit (ZR2 canyon: h(200 m) ≈ h(6 km) = h(96 km)),
  so any consumer expecting low-passed heights sees full-depth canyons; Z-03 comb spikes still on the S08 west flank;
  ice-cliff faces still carry sand / farm weights (renderer now forces ice where iceCliff × slope).
- water: DG calm-harbour tint is painted by terrain (agreement appended to notes/water.md); the steep-shore request is done
  (no water tint / gloss where the mesh is > 0.15–0.6 m above the level).

### Status at hand-off (fix round 2)
- DONE ★R1 chain + datum (verified in-app cold start at the QA-ASSETS-01 ZR1 street pose), ★R2 steep-face / ice-cliff
  material + steep refinement (S08 / S04 in-app), ★R3 mask-based shore clamp + dry-out (Z-04 levee in-app + Node 0 pokes),
  ★R4 orbit relief ×5.5, canyon lines (Node previews), city patchwork, DN (dots gated, lightPort consumer), DG harbour
  tint (Node preview), R5 via the exaggeration. Build OK (.build/terrain-render, 28–39 s), check-water OK.
- NOT verified: refined (idle) frames — no page reached idle under load 35–120; lightPort rendering (urban field not
  shipped yet); final S01 / disc look with the canyon-score code (batch 2 pending at the time of writing).
- [14:05] batch 2 (dev 5304, workers=2, load ~35–50, 0 console errors on all pages):
  fix2-r1-canyon-200m.png = QA Z-01 case (2) (camera 200 m above the ZR2 canyon floor, cold start): tile error at the
  camera +747 m (L1, camera would be 550 m under the shown ground; datum −747 m held it on the analytic ground) → 31 m
  (L7, +31 s) → 0.31 m (L9, +33 s) → 0.38 m at the chain target L13 (+45 s); frame: river, streets and buildings on the
  canyon floor, strata on the walls, no underground view. fix2-r4-S01.png / fix2-r4-disc-zr1w.png: stronger relief
  (ridges / wrinkle ridges / limb relief), ZR1 red rift, night coast dotted by settlement lights only; overall disc still
  hazy / low contrast (orbit exposure = atmosphere QQ-14; S01 composition = lead plan).
- Dev server 5304 stopped. Final build OK (28 s).

## Fix round 3 (2026-11-16, port 5304)
Brief: ★R1 O-zone at orbit (QA2P-02 / QP-07: blue dendritic canal trees, farmland of varying shades along the branches,
rough red earth beyond the irrigation ends; TE0 / TE90), R2 HARBOUR_C → water's HARBOUR_TINT, sampleTerrain.crevasse on
OX4 ice-cliff faces, OX1 basin floor colour variation, read city.farCoverage instead of mirroring CITY_CFG.
- [20:20] started (load avg 35–77). Read QA2 evidence (TE0-crop-sw: O zone = olive lattice patches, no canals).
  Node analysis of the C0 canal network: 53,232 active nodes, 5,813 trees (largest 63 nodes), Strahler 1: 41,570 /
  2: 10,284 / 3: 1,368 / 4: 10; acc log2 hist 0..5. Root causes of the orbit look: sampleTerrain.farm is the uniform
  expectation (farmOK·0.42) at mw ≥ 5 km (point sample < 2.5 km → L2 vs L3 differ), urban level0 farm = trilinear 8 km
  lattice blobs of fields.farm (diamond / Voronoi-like patches), farm colour greyed by gradeUrban; canals (40–120 m) never
  reach the orbit texture.
- [20:35] ★R1 implemented (surface.js surface-5): orbit irrigation network (netQuery: per-planning-cell segment lists, replica
  of irrigation.js makeSeg / segDist / neighbour; acc = upstream node count, iterative memoised; lines box-prefiltered at
  max(real, exag·0.8 km·acc^0.75 ≤ 12 km), exag log-linear 120 m → 2.6 km texels), statistical irrigated share along each
  main (calibrated: mean 0.316 vs fields.farm point mean 0.278 over OX5 network cells; widened to the full lateral reach at
  disc scales), farmland tones lush → grown → ripening + field-block stages (OX3 paddies, OX5 orchards), farm soil only under
  that farmland (NAT_OVR), mottled red earth beyond; urban coarse farm share removed in orbit O mode (kF 300 → 1600 m).
  Node previews shots/terrain-render/fix3-ox5-patch-{a..d}.png (gnomonic, 2.6 km texels, + _d3 = disc pixel) and the real
  L3 tile albedo fix3-tile-L3-ox5.png: blue dendritic twigs / trunks with green belts, red earth between and beyond.
  Tile cost (Node, warm, L3 256²): OX5 4.8 CPU-s vs ZR1 5.8 CPU-s (network adds little).
- [20:50] R2: HARBOUR_C = water HARBOUR_TINT; crevasse slots (P.crevasse) + rime on ice-cliff faces, steep-face shader keeps
  the strong blue darkening of the texture (trCrev); OX1 basin floor (basinFloor: reed / meadow belt 0–8 m above the lake,
  damp silt to ~16 m, pale fans vs gravel lag); index.js _updateLightBands reads city.farCoverage (fallback mirror).
  Build OK (12 s). Preview server 5304 up; TE0 / TE90 capture queued behind the browser slot.
- [21:05] app TE0 (build of 21:01, idle 172 s, 0 errors): shots/terrain-render/fix3-cap/TE0.png, -crop-sw.png (same crop as
  QA2P-02's TE0-crop-sw), TE0-320.png — OX5 now green-teal farmland belts with blue twigs, red earth between / beyond, clearly
  apart from the silver city and the bare rock at 320 px (was grey-olive lattice patches). TE90 (idle 120 s, 0 errors): OX1 is on
  the night side at the bookmark time (local 21:00) → day check with a TE90-like pose at local 13:30 (batch below).
- Tuning after that: leaf 0.9 km × acc^0.9 (≤ 12 km: acc 8 ≈ 0.75 px, acc ≥ 16 ≈ 1.5 px at the disc), brighter azure line
  colour (0.030 0.120 0.270), exaggeration ramp 400 m → 2.6 km texels (regional / grazing far tiles keep true canal widths),
  scale terms read the level's nominal 256² texel (CTX.texelRef) so 128 → 256 → 512 upgrades only sharpen the lines.
  Node: L3 512² tile albedo fix3-tile-L3-ox5-512.png = blue dendritic trees, dark green belts, red earth beyond; OX3 patch
  (fix3-ox3-patch.png) paddy-tinted belts; 650 m texels (fix3-ox5-patch-650m.png) thin real-width-ish lines in olive belts.
  check-water contract OK. Tile CPU (Node warm): L3 256² O 4.8 s / Z 5.8 s; L3 512² O 7.8 s / Z 7.5 s.
- [21:15] extra (QA2 addendum Z-05, not in the binding list but contained / orbit-only): ZR2 canyon band at orbit
  (orbitCanyon: layout.js canyon lines, main 5.2 km / tributaries 3.4 km visual half-width × exag, side canyons true,
  CANYON_ORBIT red-brown over the city paint). Node: L3 tile fix3-tile-L3-zr2.png = red dendritic canyon through the white
  ZR2 fabric (10 km main ≈ 1.35 px at the disc); globe fix3-globe-TW100.png. Rebuilt; final batch = TE0 + TW112 day
  (ZR2 canyon, OX2, OX3) queued.
- [21:20] final app shots (build with texelRef / azure lines; 0 console / page errors, idle):
  shots/terrain-render/fix3-TE0-final.png (+ -crop-sw = QA2P-02 crop, -320) — OX5 teal-green farmland belts with blue
  canal strokes, red earth between / beyond, separate from the silver ZR3 star and bare rock at 320 px;
  shots/terrain-render/fix3-OX1-day-orbit.png (+ -crop, -320; pose 2,100,17900000,0,-90,50 time 6.3 = local 13:00 at 100E)
  — OX1 farmland belts with blue twigs inland and the dendritic estuary waters at the coast. (TE90 at its bookmark time has
  OX1 on the night side: fix3-cap/TE90.png.) The ZR2 canyon band was checked in Node only (browser budget).
- Server 5304 stopped; final `npx vite build --outDir .build/terrain-render` OK.

### Requests (fix round 3)
- terrain-fn: surface.js now reads the order-0 network through irrigation.js exports (`node0, parent0, N0, DA0, outletSeg`)
  and REPLICATES `makeSeg` / `segDist` / `neighbour` (bent main geometry) — if you change the main canal geometry, keep the
  replica in sync or export `segGeomOf(node)` / `segDistance(seg, x, y, z)`. Also uses basin.js `basinMask` / `OX1_BASIN` and
  layout.js `queryLines` / `HIT` / `LINE_DATA` / `lineParam` (canyon kind, `line.side`).
- lead (bookmarks): TE90 (solTime 15, local 21:00 at 90E) shows OX1 only at night; for the O-zone day read use e.g.
  `/?pose=2,100,17900000,0,-90,50&time=6.3` (local 13:00) or a day variant of TE90.
- atmosphere (QZ2-05, FYI): the 30 km night frame's mean brightness (104/255 vs 147 by day) is mostly exposure; please check
  the night exposure lift between the ground regime and the orbit dodge at ~30 km.

### Status at hand-off (fix round 3)
- DONE ★R1 (TE0 / OX1-day in-app, OX3 / L3 tiles in Node), R2 all four (harbour tint, crevasse + rime + steep-face keep,
  OX1 basin floor, city.farCoverage), extra Z-05 canyon band (Node-verified).
- NOT DONE (QA2 addendum, not in the binding list): QZ2-04 eye-level rock sections / scree, QZ2-05 30 km night carpet (cause:
  the regional window aggregate = 3·urban light with the material's mean-preserving redistribution along the street light,
  so district boundary roads / street grids carry the light; fix idea: weight the street channel by a coarse lattice of
  district-level window light (activity) and reduce the redistribution — needs visual iteration).
