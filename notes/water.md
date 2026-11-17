# water — progress log

Owner: water agent. Files: src/render/water/*, dev/water.html, src/dev/water.js (optional).
Private server: http://127.0.0.1:5191 (`npx vite --config .build/water/vite.dev.config.mjs`, hmr off,
started 14:28 by the first instance; still running).

## Decisions
- Water surface per terrain tile on the terrain vertex grid (65x65), mirrored from tile:add/remove,
  built synchronously in update() so parents/children swap in the same frame as the terrain.
- Coverage = tile.water.mask (texel-resolution wet fraction, iso-line 0.5); terrain depth test gives
  occlusion; log-depth bias (relative) against z-fighting with the painted shallows.
- Canals drawn only where resolved (width >= 2 vertex spacings) — same rule as tileBuilder.
- Material: MeshPhysicalMaterial (ior 1.333) + onBeforeCompile + app.lighting.patch; premultiplied
  blending (rgb = reflection + specular + body in-scatter + foam, alpha = 1 - (1-F)*Tw).
- Waves: 42 analytic waves on the face-plane lattice (period 4096 m), phases advanced on the CPU in
  float64; unresolved slope variance -> GGX roughness (glint width from orbit).
- Wave clock freezes after 24 still frames so the pipeline's accumulation converges (soft reset).
- Planar reflection pass (camera < 2.5 km above a large water body), env / analytic sky otherwise.
- Underwater: camera-centred concentric fog shells.
- Wakes: props draws foam wakes itself and exposes app.systems.props.wakes; water keeps addWake().

## Done (instance 1, 14:24–15:02)
- index.js, tiles.js, material.js, waves.js, reflection.js, wakes.js written (complete, working).
- orbit shot v1_orbit.png.

## Instance 2 (from 18:00)
- 18:15 baseline shots c1_*: orbit OK (cobalt sea, turquoise shallows). Low-altitude views slow:
  machine load ~200, workers pending hundreds -> idle rarely reached; shots capped.
- G02 gate states must match megastructures/g02.js gateOpen() (mega cross-checks
  spillwayGateOpen(dam, bays-1-bay) == open) -> fixing.

- 18:30 G02 gates: mega now replicates MY rule (g02.js gateOpen = waterGateOpen(dam, bays-1-bay));
  tiles.js keeps the rule, uses mega.spillways() outlets/flows when the layout arrives
  (setG02Spillways + forced rebuild of G02 tiles); jet flow direction override below open bays.
- metre depth bias per tile = min(geomErr, 0.15*vertex spacing), capped at 0.5 % of the distance.
- shore foam: texel-accurate band from the wet-mask mip (surf width), faded when sub-pixel
  (300 km shot showed a pale coast outline).
- objectId debug layer (water class colours).
- ARCHITECTURE.md §8 "Water renderer" subsection added.
- NOTE: the scratchpad dir is SHARED with other agents (my b2.json was overwritten by buildings-z at
  18:28 and my batch re-rendered 4 of their shots/buildings-z/ct_* PNGs from my server, same code).
  Now using scratchpad/water_agent/ only.
- c2 shots: orbit glint visible (soft broad sunglint), night sea very dark with same outline, 300 km
  coast good (turquoise shallows -> cobalt). 5 km / 30 km: haze dominates (atmosphere AP); a flat
  grey polygon over the G01 harbour at 30 km under investigation.

## Remaining
- G02 gates/outlets from mega; verify glint, night, 300 km coast, G01 20 km / 2 km / 50 m, canals,
  G02 reservoirs, dusk, debug layers; build check; ARCHITECTURE subsection.

## Verification
- c1_orbit_day.png OK; c1_g01_20km (hazy, low LOD), c1_g01_2km (uniform, no detail), c1_g02 (unloaded).

## Instance 3 (from 23:01)
- Code state as of 19:27 (all agents were interrupted ~19:20–19:27). Private server 5191 still up
  (started 14:28 by instance 1, hmr off). Scratch: scratchpad/water_agent/ (wdiag.mjs plans).
- 23:15 baseline f_* shots: orbit day/night OK; 300 km coast OK (glint blob greyish); 30 km G01 OK
  (harbour shallows, channel band = terrain bed); 2 km harbour: wake ribbon shows the whole route
  polygon (Kelvin arms at the ribbon edge widen 0.35·s and fold at corners) -> fix; 50 m: planar
  reflection works, water reads flat teal.
- 23:35 g_* shots: G02 valley OK (foam downstream of the dams, but a blurry glow; pale fuzzy band along the
  reservoir shores = vertex-depth shore band); G02 dam close-up: whole tailwater turbulent -> one huge glitter
  carpet; quay eye level: corduroy stripes of the chop band, water too bright/green; dusk ship level reads well
  (swell streaks, barrier / city reflections). OX1 canal shot: terrain not loaded (load ~300).
- 23:50 changes: wakes.js v3 (length cap 45 beams+100 m, Kelvin arms fade in ~10 beams, smoothed side vectors +
  no-backtrack edges, bubble trail, water clock); material: multi-octave resolution-aware foam pattern
  (wtrFoamPattern / wtrFoamCov keep mean coverage when sub-pixel), whitecaps on crests (open sea only), crest
  lightening + sun-side crest transmission, milky plume water, irregular chop noise (8/2/0.5 m), body palette
  bluer/darker, shore band from the wet mask only; tiles: lake wind 0.30, G02 plumes narrower / shorter, calm
  below closed bays; canal sluice plumes by BFS from level steps in metres, gate rule sluiceOpen(up, down)
  (canalsInTile is far too slow on the main thread: 42 s first call at L9, 1 s at L11 -> not used).

## Instance 4 (from 01:04, Nov 16)
- Code state = checkpoint 2f21c71 (00:31) + material.js milky tweak. Private server 5191 still up (PID 75963,
  started 14:28 by instance 1). Machine load low at start (~3) -> fresh baseline batch K (workers=3).
- Last j_* shots (made under load ~200, not idle): orbit OK; G01 20 km hazy but OK; harbour 2 km shows a
  flat mauve polygon instead of water inside the barrier (to investigate); quay eye level teal & flat;
  G02 dam shot = all brown haze (camera inside terrain / not loaded?).
- 01:15 batch K (load 3 -> 250 during the run): orbit day/night OK (night sea black, same outline); 300 km coast
  OK (glint soft grey); 20 km OK but the open sea shows the regular lattice of the discrete wave set; harbour
  2 km now correct (the mauve polygon of j_ was a loading state); whitecaps = 10–30 m polygonal blobs
  (value-noise threshold, too sharp) and grey at night (i_g01_night2km); wake ribbon = translucent trapezoid
  (bubble term B·0.022·s wide) offset from the ship (to diagnose: props points[0] vs boat position).
- 01:25 changes: material.js — gradient-noise foam texture on rotated lattices (wtrGrad / wtrGradM, 4096 m
  periodic, sigma 0.345, calibrated in scratch gradsim.mjs), soft coverage ramp (wtrFoamCov(c, pat, soft)),
  whitecaps rebuilt (crest field + 4 m / 1 m noise normalised by its own std-dev, mean 0.85 %·wind², none in
  the harbour / lakes), foam dimmed on the night side, gust / wave-group modulation (1024 m + 341 m gradient
  noise drifting with the wind, scales wind sea + unresolved roughness), bluer sea body palette;
  wakes.js — centre / bubble widths in metres (0.55B + 0.035 s, 0.9B + 0.06 s), bubble alpha 0.16;
  index.js — underwater test also near the ground (reservoirs / canals above 400 m);
  waves.js — waveHeight uses sin (matches the shader).
- 01:40 batch L: harbour 50 m bluer (azure) with planar reflections (planar pass active, calls ok); quay eye has
  planar city reflections, but whitecaps looked like confetti discs and the camera there is only 52 m inside
  the barrier line (calm ramp 380 m wide) -> calm ramp now 15 m + 140 m; caps softer (ramp 1.5 sd, squared,
  mean 0.65 %·wind²). Night 2 km: no grey confetti any more, dark sea.
- PROPS BUG (request): ambient boat routes (boats.js cellRoutes) are built from UNIT vectors (faceToVec) so
  route.L / len are in radians, not metres: wake samples 2 s apart are 0.2–2 km apart and points[0] is far
  from the hull. wakes.js now cuts a track at the first step > max(80 m, 8 beams) (no garbage ribbons);
  G01 lane boats (metric routes) are fine.
- Shoreline at grazing eye-level views 2–4 km away: scalloped coast = coarse terrain mesh triangles poking
  through the water plane (terrain LOD); not fixable on the water side without overdrawing quay walls.
- 02:00 batch M: G02 valley OK; G02 dam close-up: spillway plume reads as scattered crisp blobs + glitter
  carpet (camera faces the morning sun; 8 m tailwater boils had ~14° slopes); 20 km: gust patches visible
  (natural cat's-paw look, contrast a bit strong).
- 02:10 changes: foam coverage now averages the unresolved octaves analytically (wtrFoamCov = logistic of
  (pattern - quantile threshold) / sd_unresolved; WTR_FOAM_SD = 0.1007 total), flow-map blend contrast
  restored (1/sqrt(w0²+(1-w0)²)); G02 plume lateral width >= half the vertex spacing (coarse tiles no longer
  sample the gaps between bays), plume shorter (foam e-fold 70+50q m, spread 0.15/m); boils 0.10 -> 0.04;
  gust contrast 0.48/0.26; isIdle no longer waits forever if mega has a layout but no spillways.
- 02:15 final batch N running (G02 valley/dam, OX1 canals, G01 harbour 2 km, quay, dusk, night, 20 km +
  wireframe + lod debug, orbit); build check -> .build/water/dist.
- 02:30 batch N so far: G02 valley — plume below dam 0 is now a soft white film fading downstream (no blobs);
  G02 dam close-up — plume shorter / narrower, white at the outlets then patches (glitter of the turbulent
  water toward the morning sun); OX1 canals step unusable (terrain not refined under load ~360, L1–L7 tiles);
  harbour 2 km — no garbage wake polygons, softer mouth wash, gust patches; quay eye — whitecaps only near
  the barrier (calm ramp), city skyline reflected (planar). Build check OK (.build/water/dist, 1 m 11 s).
- underwater test now uses the displayed water tiles (waterLevelAt) instead of hydro waterAt (1–3 ms/call);
  whitecaps capMean 0.75 %·wind², ramp 1.3 sd, s·(0.5+0.5s).
- 02:50 batch N complete, no console errors/warnings (LOGS []): dusk ship (hill / towers / city reflected,
  violet-blue water), night 2 km (dark navy, faint mouth foam, no grey confetti), 20 km (subtle gust patches,
  lattice broken up), wireframe + lod debug layers OK, orbit day unchanged. Build check OK again (40 s).
  Final single shot o_g01_harbour50m.png checks the last whitecap / underwater edits.

## Status at hand-off (instance 4)
- DONE: all brief items implemented (per-tile surfaces, material, foam / whitecaps / plumes / spray, wakes API,
  planar reflection, underwater fog, debug layers, G02 gate rule shared with mega, ARCHITECTURE §8 subsection).
- KNOWN: scalloped far coast at grazing eye-level views (terrain mesh LOD); ambient boat wakes cut (props
  route units bug); faint lattice of the analytic wave set at 5–20 km; whitecaps round-ish; underwater fog not
  reachable with the controls (camera clamped above water); OX1 canal view not re-verified this round (terrain
  did not refine under load ~360; i_ox1_canals.png from instance 3 shows the canals).

## Fix round 1 (2026-11-16, from 06:52; private dev server 5209: `npx vite --config .build/water/vite.dev.config.mjs`)
Brief: ★1 sluiceOpen → world/sluice.js, ★2 wave cross-hatch at 5–20 km, ★3 grazing shores (G01), 4 whitecap
streaks + trails, 5 G02 tailwater glints / streaky spray, 6 polar floes / slush, 7 tile build off the main thread
or time-sliced, 8 underwater fog check, 9 OX1 canals at S03.
- [07:00] ★1 DONE: `src/world/sluice.js` exports `sluiceOpen(upLevel, downLevel)` (pure, worker-safe; levels snapped
  to cm, argument order irrelevant, hash of the decimetre pair = the old rule). render/water/tiles.js and index.js
  re-export it. Node check (200k random steps): identical to buildings-o `sluiceDischarging` for urban
  meta.sluice inputs, and Float32 vertex levels give the same answer as the cm inputs (0 mismatches).
  **For buildings-o:** replace the replica in sluice_station.js by
  `import { sluiceOpen } from '../../world/sluice.js'` → `sluiceDischarging(s) = sluiceOpen(sl.up, sl.down)`
  (same results today; future rule changes then stay in sync automatically).
- [07:35] ★2 code: waves.js 58 waves (12 swell in two systems λ 55–230 m, 24 wind sea, 12 chop, 10 ripples; same
  total slope variance), WAVE_JITTER per-wave coefficients; material.js: planet-anchored 3D value / gradient
  noise of the planet direction (wtrVNoise4 / wtrGNoise3: continuous across tiles AND cube faces, not periodic)
  → per-wave amplitude (±~20 %) and phase (±~1 rad) jitter at 2–5 km, regional wind direction (±0.25 rad) /
  strength (±15 %) / swell at 13 km; gust patches now planet-anchored (were 4096 m-periodic → repeated every
  4 km at 5–20 km views). Per-face uniforms: uWtrWaves (.w = phase), uWtrWindDir, uWtrWindPQ; shared uWtrWaveJ.
  fix1-b1-sea9km.png: no diagonal lattice any more (crop vs n_g01_20km.png).
- 4 code: whitecaps = crest phase of the resolved wind sea (complex amplitude normalised to N(0,1)): sharp white
  line just behind the crest + exp trail (τ 1.1 rad) × group envelope + wind-aligned anisotropic noise
  (wtrGradW: rational-direction lattice noise, still 4096 m periodic → seamless): 7 m along crests / 22 m along
  the wind (breaking segments, same lateral profile in the trail) + 0.8 × 2.6 m streaks. Threshold for the mean
  coverage calibrated by Monte Carlo (thr = 0.1457 − 0.2059 ln capMean).
- 5 code: turbulent tailwater slope energy moved to the 0.5 / 0.25 m cells, boils 0.04 → 0.022, turbulent
  roughness var 0.012 → 0.03 (small glints / sheen instead of a glitter carpet); spray.js: 22 streaks per open
  bay (5–15 m), billboards stretched 2.4–4× along the screen-space motion (drift + rise), streaky noise,
  opacity 0.16.
- 6 code: aWtrI (ice cover) per vertex beyond 64° (latitude + fields.ice on a 9×9 grid); shader floes (periodic
  Voronoi 9 m pools / 26 m sea, gap, coverage), brash ice (2.5 m) in dense cover, slush film, waves damped.
- 7 code: time-sliced builds (cfg.buildBudgetMs 5, nearest first, sibling groups together) + hand-over of the
  removed meshes (linger until no pending tile overlaps them, ≤ 180 frames); regional sea-state noise on a 9×9
  grid (was 2 noise3 per vertex). Node bench (real tiles, loaded machine): 1–5 ms per tile (min), first call
  20–250 ms = JIT; in-app maxBuildMs 100–143 ms at load avg 180 (first calls).
- 9 code: canal plumes from the exact hydro sluice records (worker job 'canals' per L11 ancestor, cached; tiles
  rebuilt when they arrive): sources = drawn canal vertices of the lower reach right below each OPEN sluice
  (sluiceOpen(up, down)). Coarser tiles keep the level-step heuristic, now skipping pumps (higher reach
  downstream) and gentle gradients (step > max(0.4 m, 2 %)). Node: S03 L12 tile — the old heuristic put plumes
  on lateral junctions / pump intakes (main 82.0 m vs pumped lateral 92.7 m).
- ★3: depth bias metric part capped at 0.25 m and 1e-4 of the distance (was min(geomErr, 0.15·vs) ≤ 2e-4·d).
  fix1-b1-S05.png (25 m, 2–4 km grazing): waterline straight and clean; the remaining serration is TERRAIN: blue
  glossy "teeth" + striped gloss on coarse steep cliff-foot triangles above the water level (painted wet texels;
  shoreClamp only treats low shores) → request to terrain-render.
- [07:50] buildings-o already imports `sluiceOpen` from world/sluice.js (sluice_station.js line 24) — in sync.
  fix1-b2-S03.png (not idle, load ~150): 120 m main canal drawn as water mesh, 10–26 m laterals / ditches painted
  by the terrain; Node: the S03 frustum holds a 4-step main-canal staircase 3.2–3.9 km ahead (3 open, 1 closed) at
  the bottom edge of the frame. Plumes shortened (e-fold max(30, min(110, w/2 + 5·head)) m, sources over the
  central ~70 % of the channel) — the old 40 m·(3+…) e-fold whitened whole 140 m staircase reaches.

### Requests (fix round 1)
- terrain-render: steep shores at grazing 2–4 km views (S05 north cliff): wet-mask texels painted as glossy water
  on coarse cliff-foot triangles that rise above the water level → blue "teeth" + striped gloss above the
  waterline (fix1-b1-S05.png). shoreClamp only lowers low shores; suggestion: do not paint water gloss / colour on
  texels whose interpolated MESH height is above the water level (+0.2 m), or clamp steep-shore vertices too.
- lead (bookmarks): S03's main-canal sluice staircase (3 open gates with foam) sits at the very bottom edge of the
  frame (3.2–3.9 km ahead, depression ≈ 41° vs pitch −24°, 35 mm); pitch −30° (or the camera ~1 km further
  south-west) would put the gates and their plumes in the lower third (§5 03 闸 + 白沫).
- [07:55] batch b2 (load 120–180, workers=2, no page idle in 150 s; 0 console errors / warnings from water):
  fix1-b2-S09.png dusk: open-sea foreground = irregular wind streaks (no lattice), harbour calmer, barrier waterline
  clean (no wash band hiding the caissons); the far-coast serration (pale scallops at the base of the hills) is
  the terrain (coarse shore triangles, known terrain-render item). fix1-b2-S08b.png: chutes only (tailwater out of
  frame → b3 pose looking down). fix1-b2-polar.png: camera inside the haze/terrain (bad pose) → b3 uses
  terrain-fn's forebay-pool pose. fix1-b2-under.png: underwater fog works in fly mode (alt −4 m, `under` true)
  but the 16 discrete shells drew banding arcs where the surface / seabed cut them → 44 thin shells (ratio 1.2)
  with per-frame jittered radii (accumulation averages the steps). S03: the 'canals' job (priority 60) never ran
  behind 118 pending terrain jobs → priority −2 (with the visible terrain builds; one job per L11 tile).
  Water stats: avg build 3.3–5 ms (11 ms polar), max single build 35–86 ms (first calls / load), deferred 0,
  linger 0 at the end.
- [08:00] fix1-b3-capsday.png (30 m over the open sea, day): caps were small crisp "droplets" (crest field weighted
  by s·k → dominated by 3–5 m waves; the single hard threshold cut the trail off) → reworked: crest field weighted
  towards the energetic longer wind waves (s/√k), a breaking decision per crest segment (envelope × 12 m-along-crest
  noise vs the threshold of a breaking fraction fb = capMean/0.11), a bright frayed LINE just behind the crest and a
  translucent wind-streaked TRAIL (e-fold 1.6 rad) behind it. fix1-b3-g02tail.png: upstream reservoir calm with fine
  natural texture; tailwater below the frame (pitch −14 too shallow → b4 uses −42).
- [08:05] equatorial cube faces (0, 1, 4, 5: U = east, V = north on all) now share one sea state (wind toward WNW,
  swell from SSW = G01 open sea, second swell from W) and their wave phases are offset (kx·2·FACE_ARC per edge) so
  crests continue across 135°E (the east inner sea!), 135°W and 45°W (G02); the ring closes with a jump only at
  45°E (no water: meridian scan 0 sea / 0 lake samples). Node: |Δh| across the three edges 0.02 mm, 3 m at 45°E.
  (Polar faces keep their own random sea; their edges cross no sea.)
- [08:08] item 9 Node check (scratchpad s03foam.mjs: real L13 terrain tiles + hydro canalsInTile of the L11 ancestor,
  flattened like WaterSystem._sluicesFor): S03 main-canal staircase 116.78→107.61→98.43→89.25→82.02 m: tiles
  0/13/5450/4780 → 305 drawn plume vertices (2 open gates), 0/13/5451/4780 → 150 (98.43→89.25 open),
  0/13/5452/4780 → 0 (89.25→82.02 CLOSED: calm reach) ✓. In-app S03 (fix1-b3-S03low.png, pitch −33) not refined
  under load (L10 tiles: the 120 m canal is still painted there) — the plumes need the L12+ tiles.
- [08:12] batch b3 (load ~100, no page idle in 135–160 s): 0 console errors / warnings in all 5 pages; warm-up
  23–43 ms at init, max single tile build 30–45 ms (was 35–143), avg 2–7 ms, deferred 0 / linger 0 at the end.
  fix1-b3-polar.png (OX4 forebay pool at the cliff foot, 70 mm): sparse small floes on the pools, cliff reflected.
  fix1-b3-under.png (fly mode, −4 m under the S05 harbour): smooth fog gradient, no shell banding ✓ (item 8).
- [08:16] fix1-b4-capsday.png: mid-field whitecaps now read as crest-parallel white streaks with translucent fading
  trails (no droplets); near field still a bit blotchy → core sharpened (smoothstep 0.30–0.62) + finer 1.2 × 0.3 m
  wind streaks in the trail (b5 check). fix1-b4-g02tail.png (pitch −42 below S08b): white water from the open
  chutes torn into patches, clearing downstream into milky turquoise; no glitter carpet (small glints / soft sheen)
  ✓ item 5; spray streaks too faint to read (opacity 0.16) → 0.3.
- [08:20] fix1-b4-S08.png: six reservoirs, foam below each open dam spreading into the next level, fine lake texture,
  no seam at the 45°W face edge; fix1-b4-S05.png: harbour calm, waterline clean (the cliff's left half still shows
  the terrain's coarse-tile teeth mid-refinement, right half refined and straight). b4: 0 console errors.

### Status at hand-off (fix round 1)
- DONE: ★1 world/sluice.js (buildings-o imports it), ★2 wave cross-hatch broken (58 waves + planet-anchored regional
  jitter + continuous equatorial faces), ★3 shores verified (water side clean, bias capped at 0.25 m / 1e-4·d;
  remaining serration = terrain request), 4 whitecap streaks + trails, 5 tailwater glints / streaky spray, 6 polar
  floes / brash / slush, 7 time-sliced builds + hand-over + warm-up + cheaper per-tile noise, 8 underwater fog
  verified + de-banded, 9 exact sluice plumes from hydro records (Node-verified on the S03 staircase).
- NOT verified in-app (machine load 100–180, no page idle): S03 sluice plumes on refined L12+ tiles (Node-verified
  instead); final look of the b5 whitecap tweak / spray opacity (see b5 shots if present).
- Known: wave-set phase jump at the 45°E face edge (no water there) and on polar-face edges (no sea); foam patterns
  (≤ 32 m lattice noise) still change across cube-face edges; plume foam is isotropic (torn patches, not flow-aligned
  streaks); single tile builds still 30–50 ms under heavy load (JIT warmed at init; builds are not split).
- [08:32] batch b5 (0 console errors): fix1-b5-capsday.png — crest-line whitecap streaks with translucent trails at
  mid range, streaky translucent patches up close; fix1-b5-g02spray.png — two open chutes, plume torn into patches,
  closed bays calm, spray streaks faint / translucent (no cotton balls); fix1-b5-sea9km.png — equatorial shared sea
  state, no lattice. Dev server 5209 stopped. Final build `npx vite build --outDir .build/water` OK (51 s; it wipes
  .build/water — recreate the dev config from the snippet below next time).
  Dev config (.build/water/vite.dev.config.mjs): `defineConfig({ root, base: './', worker: { format: 'es' }, server:
  { host: '127.0.0.1', port: 5209, strictPort: true, hmr: false, fs: { allow: [resolve(root, '..')] } }, cacheDir:
  resolve(root, '.build/water/.vite-cache') })` with `root = resolve(import.meta.dirname, '../..')`.

> [terrain-render, fix round 2 — DG agreement] At disc scales (L2–L5 tiles, 2.6–20 km vertex spacing) the water mesh
> cannot resolve the G01 basin (~11 × 4 km), so terrain-render paints it: surface.js `harbourTint` gives the sea texels
> between `g01ShoreV(u)` and `g01ArcV(u)` (|u| < arc.half) a deep green-blue calm-water tint (HARBOUR_C, 85 %, coverage
> boosted ×2.5 at ≥ 5 km texels so the basin stays a visible spot inside the barrier's bright crest line). It applies at
> every texel size (same colour family as the water's own calm harbour surface up close; the water mesh adds Fresnel /
> glint on top). If water wants a different calm-water colour, tell terrain-render (one constant).

## Fix round 2 (2026-11-16, from 14:15; private preview server 5310: `npx vite preview --outDir .build/water --port 5310`)
Brief: ★W1 S09 mouth seam (QS-11), ★W2 G01 harbour tint readable from orbit (DG), W3 sluice gates (both levels + jet /
foam, no flat pool in the openings), W4 G01 swell entry gated by lockState(i), W5 ferry wakes widen, W6 spillway / sluice
foam torn into streaks along the flow.
- [14:20] read evidence: S09 seam = tiles.js calm ramp (15 m + 140 m from the ARC CIRCLE, which also runs across the
  560 m mouth) + all wind bands × 0.38 inside (slope variance × 0.14 → roughness 0.48 → 0.30: horizon-mirror "mud flat").
  Orbit: the water mesh covers the harbour with its own body colour (alpha ≈ 1 at 15 m depth), so terrain-render's
  harbourTint (surface.js) is hidden under it → the water shader must draw the calm tint itself (analytic per fragment).
  Baseline batch fix2-base (S09, S05, S07O, S08c) queued behind the browser slot.
- [14:55] code (not yet verified in the browser): W1 tiles.js g01SeaState (mouth / open-lock diffraction fans, wall
  leak ramp only where a wall stands, calm = sheltering field 0 on the mouth line → 0.66 on the axis 6 km in, fetch
  regrowth; wash not across gaps; mouth turbulence 0.2 elongated along the channel) + shader: long wind sea (λ 3–24 m)
  damped by calm, chop / ripples kept (roughness 0.48 → ~0.40 instead of 0.30), caps × (1 − calm). Node map
  scratchpad water2/g01field.png: smooth fields, no seam (transect u = −30: swell 1 → 0.96 at 50 m → 0.61 at 800 m →
  0.34 at 2.5 km; calm 0 → 0.04 → 0.34 → 0.53). W4: lock states replica + mega layout sync (setG01Locks); today
  L2, L6 fully open, L3 outer-only. W2: analytic harbour mask in the water shader + HARBOUR_TINT (lighter azure-turquoise,
  G01/A03 refs) at all scales (calm-driven near, mask-driven at ≥ 250–1500 m footprints, also calms waves / glint).
  W5 wakes v4 (centre 0.09 s, bubbles 0.15 s alpha 0.3, arms e-fold 22 B + feathers). W6 streak foam
  (wtrStreakPattern). W3 sluicejet.js (new): jets through the OPEN bays (gateLayout lazily imported from buildings-o).
- S07O evidence station OX1-0.3.11t.x8-n1.1-0 no longer exists (the round-2 OX1 basin replaced the area; 7×7 L13 tiles
  around the S07O pose hold 3 maintenance sheds) → W3 test station: OX1-0.2.ix.gl-1.1-0 (OX1 outlet canal, 132.03 →
  123.04 m, width 44 m, open, 5 bays, bay 0 open) at 7.254696N 104.884412E; hydro step exactly at building x = 0 (gate line).
- Agreement with terrain-render (DG): the water mesh covers the harbour with alpha ≈ 0.9 (15 m deep), so the water draws
  its own HARBOUR_TINT; surface.js HARBOUR_C (0.007 0.040 0.058) is mostly hidden under it — optional: align it to
  HARBOUR_TINT (0.016 0.100 0.165) for shallow / transparent views.

### Requests (fix round 2)
- lead (bookmarks): S07O–S07Oe point at OX1-0.3.11t.x8-n1.1-0, which no longer exists (round-2 OX1 basin; the 7×7 L13
  tiles around the stored pose hold 3 maintenance sheds; cold landing = bare red plain, shots/water/fix2-base/S07O.png).
  Candidate with a discharging gate for the walkway / control-room frames (W3 jets): OX1-0.2.ix.gl-1.1-0 (OX1 outlet canal
  OX1-BL1-OUT, sluice 132.03 → 123.04 m, 44 m wide, 5 bays, bay 0 open) at 7.254696N 104.884412E; tail-side check pose
  7.2538531,104.8845318,135.03,45.8,-11.8,35 (time 8.508 = local 15:30). Alternatives: OX1-0.2.ix.gl-n1.2-0 (114.19 →
  110.39, 22.4 m, bay 2 open).
- megastructures (S08c 「泡沫在流向下侧撕散」): the smooth pale curtain on the left of S08c is the G02 chute sheet
  (materials.js 'mega_water'), not the water renderer; tear it into streaks along the flow (noise stretched along uv.y,
  scrolled at the chute speed, thresholded with aeration rising downstream) to match the tailwater streak foam (W6).
- buildings-o (coupling, FYI): render/water/sluicejet.js replicates o_common.js waterInfo (pool side, gap, levels, depth)
  and sluice_station.js gateStructure (bays from zE, 1.5 m piers, sill bedU + 0.15, chute / basin lengths) and imports
  `gateLayout` lazily for the open bays. If you change that geometry, either tell water or export a pure
  `sluiceGateGeometry(spec)` → {rot, flow, zE, width, bays:[{z0, z1, open}], up, down, bedU, bedD, chute, basin} and the
  water layer will use it (feature-detected).
- terrain-render (DG, please): set surface.js HARBOUR_C to the water's HARBOUR_TINT (linear 0.016 0.100 0.165, lighter
  azure-turquoise like the G01 / A03 references) — today HARBOUR_C (0.007 0.040 0.058, lum 0.034) is DARKER than the
  shelf seaMid (lum 0.067), while the water mesh (alpha ≈ 0.9 over the 15 m basin) draws the lighter tint on top; where
  coarse disc-scale terrain hides the water the two would disagree.
- For megastructures M3 (chute sheet streaks, coordinate with W6): the tailwater plume foam below the G02 chutes now uses
  flow-aligned streaks (material.js wtrStreakPattern: octave cells 40 × 9, 12 × 2.4, 3.2 × 0.7 m along × across the
  flow + 0.5 m isotropic; scrolled with the two-phase flow map at the jet speed ≈ 2.8 m/s × jet factor; coverage thins
  downstream with e-fold 70–120 m) — matching streak widths at the chute toe keep the hand-over seamless.
- [14:47] W4 Node cross-check: megastructures layoutG01() lock states == tiles.js replica (L2, L6 open/open, L3 outer
  only; setG01Locks → unchanged).
- [14:52] BUG found + fixed (tiles.js plume walk, round-1 code): the breadth-first plume walk stored distances in a
  Float32Array and re-pushed a vertex whenever a relaxation rounded UP to the stored value → on fine tiles (L15+, 2.5 m
  vertices, 80-step walks) next to an OPEN exact sluice the walk grew exponentially ("RangeError: Invalid array length"
  in Node at 0/15/21803/19115) → the build threw, `_build` caught it and the tile got NO water mesh (the terrain's flat
  painted water showed instead — likely part of QS-04's "flat grey-blue pool"). Now Float64 + strict improvement + a
  safety cap; Node: the same tile builds, plume as expected.
- W3 plume below the OPEN bays only: sluicejet.js computes each station's open-bay spans (metres left of the flow from the
  canal centreline, gateLayout) and its gate-line centre; WaterSystem._build attaches them to the matching hydro sluice
  record (same levels ±3 cm, ≤ 40 m) and tiles.js writes the plume analytically below those spans (lateral spread 1.5 m
  + 0.2·distance); reach below closed bays calm. Tiles under the station's L11 tile are rebuilt when spans arrive.
  Node (scratchpad water2/plume-span.png vs plume-nospan.png): OX1-0.2.ix.gl-1.1-0 bay 0 (near bank = right of the flow,
  span [−22, −14.4] m) → foam only along that bank, spreading downstream.
- [14:57] S09 「外海长浪」: the incident swell shoals over the shelf at the barrier (×1.45 at the arc line, e-fold 2.5 km
  offshore); the mouth / walls pass that incident swell on (continuous at the mouth line: 1.45 both sides, Node).
  Shader fix: pow(negative, 2.0) in wtrHarbourMask → hq·hq (undefined in GLSL).
- Batch b1 (orbit 2500 km, S09, S05, G01 9 km, W3 tail / high, S08c) queued since 14:39 behind the 1-slot semaphore.
- [14:58] Node regression (scratchpad water2/regress.mjs, real terrain tiles): G01 L13/L11/L9/L5, OX1 sluice L16/L17/L13
  (exact records, spans path + BFS path), OX1 L10, G02 L13, ZR5 L12 → all build, no NaN, 0.5–15 ms; shader harbour
  projection replica (float32) within 0.12 m of sites.js, shore replica exact (maskcheck.mjs). Wake replica top view
  (wakeimg.mjs → wake-top.png): widening V, centre ≈ 1 → 2.5 beams, bubble band, arms + feathers.

> [megastructures, fix round 2 — W6 / M3 coordination] The G02 chute sheet (mega `mega_water`, g02.js `spillSheet`) is now
> a subdivided free surface: glassy dark-teal over the ogee crest, aeration inception ≈ 9 m below the crest, full white
> water from ≈ 27 m down the chute to the plunge (the sheet still stops 1.5 m below the tailwater level, so the water
> renderer's plume at `mega.spillways()[i].ecef` takes over exactly as before — outlets, dirEcef, width, flow unchanged).
> Its streaks are flow-aligned: across-flow wavelengths ≈ 0.6 / 0.23 / 0.09 m, along-flow ≈ 11 / 4.8 / 1.6 m, scrolling
> at ≈ 17 m/s at the toe (roll-wave bands every ≈ 11 m). If W6 makes the tailwater foam streaky, matching that streak
> direction (dirEcef) / ≈ 1–2 m across-flow scale near the outlet keeps the hand-over seamless; foam white ≈ linear
> (0.92, 0.94, 0.94) on the sheet.
- [15:02] city's S05 shot (shots/city/fix2-s05-bg01-day.png, built from this checkout with the first W1/W5 code) showed
  (a) straight hard outer edges on the wakes: the wider Kelvin-arm profile was cut by the ribbon geometry (edge only 2 m
  outside the arm line) → ribbon half width now arm line + 2 m + 3 arm widths, arm width 1.2 + 0.02 s + 0.06 B
  (replica wake-top.png: soft outer edges); (b) confetti whitecaps 1 km inside the mouth → caps × (1 − calm)².
- [15:06] sluicejet.js: bays resolved through stationBays() (buildings-o `sluiceGateGeometry(spec)` if ever exported,
  else replica + gateLayout). Node lifecycle test (jetbuild.mjs): 3 OX1 outlet stations → 2 meshes (open bays), the
  closed station none; meshes dropped beyond 5 km; span infos persist after the city tile leaves.
- [15:22] b1 in: fix2-b1-S09.png — ★W1 OK: no seam across the mouth (open-sea texture runs through the 560 m mouth and
  calms gradually inside; no white wash line across the gap; harbour reads as blue water, no purple-brown mirror);
  wakes of the ferry / container ship read as widening V's (crop scratchpad water2/crop-S09x2.png).
  fix2-b1-orbit2500.png — W2: the basin is lighter than the open sea inside the megastructure's white crest arc, but
  subtle at 1.3 km/px under the orbit haze → orbit tint brighter jade-turquoise (HARBOUR_TINT_ORBIT 0.026 0.165 0.180,
  weight 0.95 at ≥ 1.5 km footprints), soft edge 0.6 px, coverage boost from 0.7 km footprints (re-check in b2).
- [15:31] b1 complete (no page idle: 107–275 pending jobs at capture, workers=2; 0 errors, only a props Canvas2D
  readback warning): S05 — harbour turquoise with fine chop, fewer caps, ferry wake = widening V with soft outer edges;
  G01 9 km — inner basin uniform calm blue, boat wakes read as V's; S08c — the chute sheet is megastructures' (now
  streaked by their M3), tailwater edge blotches are shore-band foam; W3 tail / high — NO plume and no jets yet: the
  'canals' job (priority −2) sat behind ~200 tile jobs and the station's city tile had not arrived. → 'canals' priority
  −1.2e6 (right after the camera chain). Batch b2 (orbit recheck, W3 high / walk with an eval that waits for the jets +
  sluice records, G02 tailwater for W6) queued 15:31.

### Status at hand-off (fix round 2)
- DONE + verified in the app: ★W1 (fix2-b1-S09.png: no seam, open sea runs through the mouth), ★W2 (fix2-b2-orbit2500.png:
  light jade-turquoise basin inside the white crest arc), W3 (fix2-b2-W3high.png: plume only below the open bay, closed
  bays calm; jets built — WSTATS jets.meshes 5; plume-walk blow-up fixed), W4 (WSTATS g01Locks "-Oo--O--" = layout;
  Node cross-check equal), W5 (S05 / S09: widening V's, soft edges), W6 (fix2-b2-g02tail.png: streaks along the flow).
- Not verified: the bay-0 jet sheet in direct sun / from the walkway (the only frame had it in the abutment's shadow).
  Every code change was in the build a batch used (b1 = build 15:02, b2 = build 16:05). Final build OK (.build/water,
  16:18); preview server 5310 stopped, no browser of mine left.
- Files: src/render/water/{tiles.js, material.js, index.js, wakes.js, sluicejet.js (new)}; ARCHITECTURE.md water section.
- [16:05] slot races lost to city / megastructures / buildings-o batches since 15:31. buildings-o's walkway render of
  OX1-0.2.iy.gk-n7.n1-0 (their build 14:52, early jets code) shows pale roller sheets below the 4 open bays with hard
  straight lateral edges → jet sheets now 9 columns with soft lateral alpha edges widening downstream (0.25 m between
  the piers → +0.16 m per m past x = 5 m). Rebuilt .build/water; b2 still queued.
- [16:14] b2 started 16:12. fix2-b2-orbit2500.png: the harbour now reads as a distinct light jade-turquoise spot right
  inside the megastructure's white crest arc at 1.3 km/px (crop scratchpad water2/crop-orbit-b2x4.png) ✓ W2.
- [16:17] b2 complete (0 console errors / page errors; still not idle under load: 110–183 pending jobs):
  * fix2-b2-W3high.png — W3 OK: white water only below the OPEN bay 0 along the near bank, tearing into streaks
    downstream, the reach below the 4 closed bays calm and clear (停用闸孔下方的水比泄流口平静); bay-0 jet in the abutment's
    shadow (grey-white). WSTATS: sluice records 56, jets {stations 9, meshes 5, bays 6, spans 9}.
  * fix2-b2-g02tail.png — W6 OK: G02 tailwater plume white at the two open chutes, torn into long streaks along the
    flow downstream; closed bays calm.
  * fix2-b2-orbit2500.png — W2 OK (see 16:14). WSTATS g01Locks "-Oo--O--" = megastructure layout (W4 in-app).
  * fix2-b2-W3walk.png — pose looked upstream along the walkway (upstream pool + pier noses), not a jet frame.

## Fix round 3 (2026-11-16, from ~18:45; private port 5310)
Brief: ★W1 S05 reflections blur / break up with distance + wave slope (crisp near waves), ★W2 S07O sluice jets = aerated
white water + white hydraulic jump + foam tearing downstream, W3 lake OX1-BL1 calm + foam at the OX1-BL1-OUT sluices.
NOTE: another agent (round-3 memory work) edits render/water/index.js concurrently (_onRemove / _evict, "fix round 3
(memory)") — my index.js changes are small targeted Edits only.
- [19:00] W1 code: reflection.js target mipmapped (LinearMipmapLinear, three regenerates the chain after the nested
  render); material.js planar block rewritten: D = reflected-object distance from the flat-mirror depth lookup; ray through
  the resolved wave normal scaled by WTR_REFL_DISTORT 0.14 (of the physical 2·tilt) re-projected at D (wavy break-up near,
  none where the object meets the water); anisotropic Gaussian blur (12 stratified taps along the elevation, IGN-jittered per
  pixel / frame -> converges in stills, mip level from the azimuth axis) with angular sigma wtrReflSig = 0.17 · sqrt(varB)
  · (1 + 0.6 smoothstep(4, 120 m, footprint)); varB = unresolved slope variance of the waves ≥ 0.3–3 m (ripples masked at
  grazing angles); the kernel scales with D / (D + distance) through the projection (contact hardening) and the azimuth
  axis is × tan(grazing) (≥ 12 %): the far city merges into vertical streaks fading into the sky reflection. Premultiplied
  composition (target cleared to 0): refl = env·(1 − a·T) + rgb·T. Node: harbour σB 0 (30 m) → 0.035 (120 m) → 0.10 (≥ 500 m)
  -> far-shore vertical blur ≈ 1–1.6°, near distortion ≈ 1.4° at 120 m.
- [19:05] W2 code: sluicejet.js — jetProfile(Gm) (shared hydraulics: drop, yc, toe speed, Froude, conjugate depth, roller
  length ≈ 6·y2 bounded by the basin, front height hJ), baySheet (aeration from 22 % to full white after 35 % of the drop,
  roll-wave relief), NEW jumpGrid: one grid across the whole stilling basin (training wall to wall) fed by every open bay
  (cover spreads sideways past the 6.4 m pier ends, a closed bay leaves a calm wedge that closes downstream), white boiling
  front ~hJ (≤ 0.6 m) above the tail water, roller collapsing over Lr, then a foam carpet (1.5·Lr, ≤ 32 m) torn into flow
  streaks; vertex relief (roll waves on the chute, boils on the roller) + bump-mapped foam lumps; foam albedo 0.9 with
  darker grooves / cells. Node (S07O station OX1-0.2.iy.gk-n7.n1-0): drop 11.1 m, toe 8.2 m/s, Fr 6.7, plunge x 6.2 m,
  Lr 21.7 m, hJ 0.58 m; 3606 verts, 0 NaN (scratchpad water3/jump-top.png: closed bay 1 wedge).
- [19:10] W2 plume: the S07O station had NO tile plume at all — hydro canalsInTile(L11) returns 0 canals there (trunk
  segment tested by 9 samples; L10 also misses, L9 lists the sluice 102.35 -> 92.29). index.js _sluicesFor now queries the
  L9 ancestor (superset; warm 1–56 ms per call in Node, cold network build ~0.5 s as before). Request to terrain-fn below.
- [19:12] W3 Node check (scratchpad water3/bl1.mjs): lake OX1-BL1 = waterAt type 3 'lake', level 150; L13 / L15 lake tiles:
  swell 0, wind 0.276 (lake 0.30 × regional), tint 1 (lake palette), foam 0, turbulence 0 -> calm (no whitecaps: capMean ×
  (1 − tint)); the planar reflection there blurs ~2.2× less than the harbour (σB 0.046 vs 0.10). OX1-BL1-OUT sluices:
  150 -> 141.01 CLOSED by the shared rule (sluiceOpen; buildings-o draws its gates closed), 141.01 -> 132.03 and
  132.03 -> 123.04 open -> plumes + jets below those two; all three listed at L11 and L9. No code change needed for W3.
- [19:16] builds OK (.build/water); preview 5310 up; batch b1 (S05 bookmark, S07O jet high oblique, S07O walkway bookmark)
  queued behind the single browser slot (held by qa2-shots chain3 since 18:47).

### Requests (fix round 3)
- terrain-fn (world/terrain/irrigation.js canalsInRect): a trunk segment is tested against the tile by 9 samples along it
  (k/8, `trunkIn` with margin 2 % of the tile), so a long trunk crossing a small tile between two samples is not listed:
  OX1 main canal C0-0-196-172 at the S07O station (7.1425N 104.9447E): canalsInTile L11 / L10 → 0 canals, L9 → listed with
  the sluice 102.35 -> 92.29 49 m from the station. Suggest a segment-vs-rect test (or samples ≤ ¼ of the tile width
  apart). Water works around it (queries the L9 ancestor); other consumers of canalsInTile at L10+ (urban? props?) may
  miss canals the same way.
- buildings-o (FYI): jumpGrid uses your pier length (10 m: pier end 6.4 m downstream of the gate line) and the basin between
  the training walls (zE − width … zE) besides the already replicated waterInfo / gateLayout / chute; tell water if they
  change (or export sluiceGateGeometry with `pierEnd`, `zE`, `width`).
- [19:25] W2 extra: plunge spray for the sluice jets (12 streaks per open bay, spray.js material now exported as
  createSprayMaterial and shared; child InstancedMesh of the jet mesh, rising ~1–4 m, drifting 3–11 m downstream). Node:
  48 streaks at the S07O station (x 8–9 m, tail level + 0.15–0.65 m, inside the open bays), disposed with the jet mesh.
- [19:28] W1 2D preview (scratchpad water3/reflsim.cjs on the S05 evidence frame: mirrored scene + the shader's kernel,
  harbour σB table, D = 3 km − distance): crisp waterline, tower reflections streak vertically and merge into the sky
  colour towards the camera (water3/reflsim.png) — gain 0.17 kept for the app check.
- Browser: b1 still queued (qa2-shots chain3 holds the single slot: cap2 → data0809 → cap3 → extras, est. until ~21:00).
- [19:34] OFFLINE SHADER CHECK (no browser slot): scratchpad water3/glc/capture.mjs builds the real three.js r187 programs
  of the water, sluice-jet and spray materials (THREE.WebGLRenderer on a mock WebGL2 context in Node, real PlanetLighting
  patch, logarithmic depth, a shadow-casting sun) and glc (CGL, OpenGL 4.1 core) compiles them natively: water vert/frag,
  sluiceJet vert/frag, sluiceSpray vert/frag all OK (the captured water frag contains the new planar code; an injected
  undeclared identifier is reported, so the check bites). ES-3.00-only strictness (implicit int -> float) checked by a scan
  of the new GLSL: no integer literals in float contexts. Reusable: `node capture.mjs && ./glc frag out/0-water.frag`.
- [19:38] capture now ONE page (scratchpad water3/seq3.mjs: jet high oblique → goto S07O → goto S05, waits idle + pipeline.converged) queued behind the slot (QA chain3 in cap2).
- [20:26] NO APP SCREENSHOTS this round: the single machine-wide browser slot was held by qa2-shots chain3 (one slot for
  its whole chain) from 18:47 through cap2 (S09b hung 30 min) and is still held (data0809 → cap3 C01–C10 → extras, est.
  ≥ 21:15); my capture waited 18:5x–20:26 and was withdrawn at the end of the time box (no browser of mine ran).
  Replacement checks: native compile of all 12 program variants (above), Node geometry / plume / lake / lifecycle checks,
  2D reflection preview, projection of the new jet / jump-grid vertices into the S07O walkway frame (scratchpad
  water3/overlay-walk.png: the white jump grid covers exactly the basin where round 2 showed the greenish ramps, the jets
  sit behind the abutment / deck). Ready-made one-page capture for the acceptance pass:
  `node scripts/slot.mjs -- node shots/water/fix3-seq3.mjs --base http://127.0.0.1:<port> --out shots/<dir>` (jet high
  oblique 7.1419653,104.9453353,118.62,13.7,-26.7,35 time 8.504 → S07O → S05; waits idle + pipeline.converged).
- Final build OK (.build/water, 40 s); preview 5310 stopped.

### Status at hand-off (fix round 3)
- ★W1 DONE in code, compile-verified, NOT seen in the app: planar reflection = depth-based re-projection through the
  scaled wave normal + anisotropic, distance / slope-dependent blur (mipmapped target, 12 jittered taps) with contact
  hardening; near water keeps crisp waves. Tunables: material.js WTR_REFL_BLUR 0.17 (more = merged sooner),
  WTR_REFL_DISTORT 0.14 (more = more broken near field).
- ★W2 DONE in code, compile-verified, NOT seen in the app: white aerated chute (roll-wave relief, bump foam), one
  jump-roller grid across the stilling basin (boiling white front ≤ 0.6 m, Froude-based length, calm wedge below a closed
  bay), foam carpet torn into flow streaks, plunge spray; the S07O tail plume now exists (L9 sluice records — before this
  round the station had none). Tunables: sluicejet.js jetProfile aeration (0.35·drop), jumpGrid hJ / Lr / Lc.
- W3 DONE (Node): lake OX1-BL1 calm (lake wind 0.30, tint 1, no caps / foam), OX1-BL1-OUT plumes + jets below the two open
  sluices; the sill sluice 150 → 141.01 m is CLOSED by the shared gate rule (no foam there by design).
- Files: src/render/water/{material.js, reflection.js, sluicejet.js, spray.js, index.js (small targeted edits next to
  another agent's round-3 memory edits)}; ARCHITECTURE.md water subsection; shots/water/fix3-seq3.mjs.
