# props — progress log

Owner: props agent. Files: src/props/*, (optional) dev/props.html + src/dev/props.js.
Private port: 5196 (dev server `npx vite --config .build/props/vite.dev.config.mjs`, hmr off). Screenshots: shots/props/.
Scratch scripts: <session scratchpad>/props/ (the scratchpad dir is shared with the other agents!).

## Plan / decisions (14:30, first instance)
- City tile data: 'city:tile' cache + city.tileData(key); if the city is generating the tile wait ≤ 240 frames;
  else generate in the PRIVATE props workers (3 module workers, props.worker.js) — the shared pool is saturated.
  Workers also compute all placements (pure src/props/place.js). Data is slimmed before postMessage.
- Coordinates: per-tile static groups in the tile-local frame, dynamic objects in anchor frames re-centred near
  the camera (float64 tile->anchor transforms).
- Vegetation: 6 procedural species, LOD0 3D (< 80 m), LOD1 simplified 3D (< 425 m) CPU-bucketed, LOD2 impostor
  billboards per tile (baked atlas, half-float linear RT), dithered cross-fades.
- Trains: corridors.js segments, timetable pure function of sol time (headway divides 86400 s, trapezoid speed,
  dwell 30–60 s), right-hand running, tracks ±2.0 m, rail head = polyline y + 0.77 (grade) / + 0.37 (deck)
  as the city draws it; trains only shown PRE 40 s before departure .. POST 50 s after arrival at termini.
- Boats: ferries from 'ferry'/'landing' docks, ambient boats in sea cells, G01 mouth (2 lanes per direction,
  common speed per lane -> no overtaking). Wakes handed to water.addWake (water agent API), own strips as fallback.
- People / vehicles: near camera, pure functions of sol time (frozen when the clock is paused).
- Wind sway runs while camera/time move, settles when static (TAA converges on crisp foliage).

## Status (19:20, second instance resumed 18:01)
- [x] index.js PropsSystem (was a stub!) — init/update/isIdle/nextArrival/wakes/stats/debug layers
- [x] people.js, vehicles.js written
- [x] place.js rewritten against the city's real street profile (render/city/streetBuild.js profileOf)
- [x] NaN source fixed: degenerate train matrices at termini (grey screen) + zero-normal guards
- [ ] verify in app (machine load avg ~300: screenshots very slow)
- [ ] screenshots: boulevard day/dusk, station two frames, elevated line, harbour, O-zone canal, polar
- [ ] build check

## Locations (node surveys)
- ZR1 dense residential: 22.0025, 118.0096 (ground ~562 m). Station tile at-grade S9ruz39h.4: 21.8705, 117.9971 (~542 m).
- Elevated metro stations: S9ruz39h.1 (21.8971,117.8788), S9tjxvly.5 (22.0017,118.2283).
- Ferries ZR4 islands: 7.70422,165.38377 (core), 7.50021,164.97404 …  G01 mouth: SITES.tidalBarrier (0.47N 129.94E).

## Instance 3 (resumed 23:01)
- load avg ~2 now (was ~300): doing the in-app verification + fixes + build check, then the report.
- 23:20 fixed: tile distances measured to the sea-level frame origin (near trees / people / vehicles never
  appeared where the ground is ~500 m high) -> now to the tile's mean ground (t.gy).
- 23:45 props bench dev/props.html + src/dev/props.js (all models, app-like light units) for fast look dev
  (the app takes 3-8 min per shot under load avg 300-400).
- leaf atlas rewritten (2048², small leaves on twig sprays, natural greens, round clipped cards), neutral
  species tints, foliage = MeshPhysical specularIntensity 0.22 (no white Fresnel sheen on edge-on cards),
  bleedTexture bug fixed (getImageData is not premultiplied -> white fringes).
- seat offsets: prop tiles follow the DISPLAYED terrain like the city's buildings (groundHeightAt at the
  tile point nearest the camera, |d|<0.4 ignored, 25 m/s), people / vehicles / near trees included.
- still view -> LOD and distance fades snap to hard edges (no dither pattern in converged shots).
- pedestrians x2.4 denser.

## Instance 4 (resumed 02:40, plan upgraded; time-box ~2 h -> report by ~04:45)
- src/props == HEAD (01:18 commit). My dev server on 5196 (pid 82203, hmr off) still running.
- Audit findings so far:
  - BUG boats: routes were built from UNIT vectors (dock / G01 / ambient) -> rt.len in radians while
    schedules use metres (G01 boats never past s>len, ambient boats jump every frame, ferries 40 s trips).
  - BUG boats: shuttle ease discontinuous at the braking phase; nav lights port/starboard swapped
    (facing +z, port = +x).
  - s01-s03 station shots: camera ended ON the platform canopy roof -> train hidden; need a real
    platform pose (bookmark S07 area: at-grade station S9ruz39h.4).
- Priority list: S05 (ferry crossing + widening wake), S06 (canyon commuter trains at blue hour),
  S07 (street trees / platform / people / train), S09b (next inbound ferry through the G01 mouth),
  then the brief's 8 verification shots, build check, report.
- 03:30 done:
  - boats.js refactored; pure route/schedule code + G01 layout moved to NEW src/props/harbour.js (worker-safe);
    G01 layout computed in the props worker ('g01' message, ~250 slow terrain samples next to the landform);
    G01 lanes = closed loops (sea -> mouth -> turning basin -> mouth -> sea), harbour ferry line along the
    north shore with two floating landings (models.js buildLanding), keep-right offset on two-way lines.
    Shot sync: S09b -> inbound ferry ~300 m ahead (rel +17 deg); S05 -> eastbound ferry crossing ~510 m ahead
    just right of centre with a 6-min-old wake (Node-verified: boats-test.mjs in scratchpad/props4).
  - BUG trains: reverse direction used the forward station spacing (dwelled between stations, nextArrival
    wrong). Now lineSchedule has per-direction run profiles (dirs[1] / dirs[-1]); nextArrival matches trainsAt.
  - trains SHOT_SYNC: line 9ruz39h -> a train stands at S9ruz39h.4 at the S07 bookmark time (+ an arrival
    12 s later); line g1b4vvq -> a train arrives at Sg1b4vvq.2 15 s after the S06 time.
  - S06 bookmark (heading 95) sees NO rail line within 30 km (corridor network) -> request: heading 253,
    pitch -2 (station Sg1b4vvq.2 at ~540 m, arriving lit train). Not my file (src/app/bookmarks.js).
  - leaf atlas sparser / smaller leaves / no round card outline, AO lifted, poplar denser; lamp glow sprites
    smaller (0.2 m), pools dimmer; rovers denser on farm / levee / service roads.
  - camera gets lifted ~18 m by the controls at some street/platform poses after streaming (floor = mass
    model roof?) -> my plans re-apply the pose after idle. Not my module (controls/city).
- runs queued: run2b (station 2 frames, S07, elevated 300 m, O-zone canal, polar), run3 (S05, harbour 2 km,
  S09b, S09). Logs/plans in scratchpad/props4.
- 04:00 verified in app (shots/props/): r2_boulevard_day/dusk (trees, lamps on, people, cars), r2b_station_a/b
  (platform S9ruz39h.4, train standing; arriving train hidden behind it -> r4 from the opposite platform),
  r2b_s07 (S07 street: entrance + street trees + walker), r2b_ozone_canal (canal-bank belt, poplar rows,
  rover), r2b_polar (one hardy conifer, otherwise bare). Elevated 300 m pose was above a tower roof -> redo r4.
  Fixed after these: idle people no longer intersect (0.8 m spacing), walk paths split at buildings / rail
  corridors (heads poking through platforms), entrance clear zones for street trees (PLACE_VERSION 3),
  train head/tail light glow sprites (dusk readability). Build check OK (.build/props/dist).
- pseq.mjs now exits after closing the browser (stale processes blocked the queue).
- 04:15 run3: r3_harbour_2km (G01 barrier + mouth, ships with Kelvin wakes from water.addWake, basin traffic)
  GOOD; r3_s09b dusk mouth with nav lights GOOD (but the bookmark S09b/S09 now resolve to mega views
  'g01-ship' / 'g01-5km' -> harbour.js S09b sync now uses the 'g01-ship' camera: ferry 313 m ahead, +16.5 deg).
  r3_s05 BROKEN by the controls: camera lifted 25 -> 149 m at bookmark load (coarse floor?), the synced
  ferry (532 m) falls below the frame. run4 re-applies the pose after idle.
- determinism check (scratchpad/props4/determ.mjs): placeTile + trainsAt hashes identical across runs.
- run4 queued: opposite-platform arrival frames, S05 retry, S09b with new sync, S06 alt heading 253, elevated.
## Remaining / known (for QA)
- S06 bookmark sees no rail (request heading 253); controls lift camera at some poses (S05, S07 first resolve).
- leaves still read as large cards closer than ~5 m; poplars slightly lumpy far away.
- dusk ground in the boulevard looks uniformly warm (terrain/street emission + my pools; pools dimmed x0.6).
- no near-field crop rows, no flying craft (both optional in the brief).
- 04:45 run4: r4_station_arr_a/b GOOD (opposite platform: train arriving on the near track 139 m out,
  second train standing beyond; frame b: arrived train beside the platform), r4_s05 GOOD (crossing ferry
  right of centre + white wake trailing left; needs the pose re-applied after idle), r4_s09b GOOD (synced
  inbound ferry 313 m ahead, nav lights, cargo ship wake on the left). r4_s06_alt_heading: controls lifted the
  camera 1122 -> 1734 m (coarse floor at load), view not usable; the timetable sync itself is Node-verified
  (train a:31 enters the 253-deg frame at 510 m, stops at Sg1b4vvq.2 15 s later).
- STATUS: deliverable complete; report sent. Next instance (if any): S06 re-check after the bookmark /
  controls fixes, leaf close-up quality, dusk ground warmth.

## Fix round 1 (started 05:10, private port 5208, build .build/props, shots shots/props/fix1-*)
Items (★ first): ★1 rails per D1 + platform stops; ★2 S07c street-tree pruning in front of station-facing
2F windows; 3 people on the city's actual paving; 4 G01 ferry piers/landings vs shoreline + depth along legs;
5 dusk boulevard warmth re-check; 6 optional flying craft / crop rows.

### Node findings (05:10, scratchpad/props5/stcheck.mjs)
- S9ruz39h.4 (at grade, plen 161, 4 cars = 100 m): train centres exactly at x = 0, z = zNear (dir −1) /
  zFar (dir +1) of the station building frame. Vertical: stationTrack railY (no meta.railGround yet →
  corner extrapolation) is 0.50 m above the 20 m-lattice ground + 0.35 the city/props use. The terrain also
  slopes 2.4 % along the platform (rail polyline ±1.2 m vs a flat platform at the ends of a 100 m train).
- Sg1b4vvq.2 (elevated, plen 134): lateral exact; railY 8.54 vs lattice ground + 9.0 = 9.54 (railGround missing).

### Requests (fix round 1)
- urban (★1 railGround): please compute `meta.railGround` from the SAME ground the rail polylines use:
  lattice ground at the station's arc position st.t = linear interpolation in t of
  `heightAt(pointAt(sg, 20k), 2)` and `heightAt(pointAt(sg, 20(k+1)), 2)` (k = floor(st.t/20)), minus
  `ground.entrance`. Then platY = railGround + 0.35 + 1.0 (at grade) / + 9.0 + 1.0 (elevated) matches the
  props car floor exactly at the platform centre.
- urban (optional but needed for a flat platform on sloped ground): level the rail polyline y in
  CityTileData.rails through stations, e.g. y = lattice ground at st.t for |t − st.t| ≤ plen/2 + 10 m,
  blending linearly back to the terrain-following lattice over the next ~150 m. props trains now follow the
  CityTileData rail polylines (absolute height of each 20 m lattice point) wherever a props tile is loaded,
  so any levelling done there is followed automatically (no props change needed).
- city: props puts the rail head at polyline y + 0.35 on at-grade runs and exactly at polyline y on
  viaduct (= ground + 9.0, D1) and bridge runs — please draw the rail head there (bridges: same as viaducts).
- **URGENT urban ↔ buildings-z: `meta.trackOffset` sign.** urban/specs.js now writes trackOffset = building-frame
  z of the track centreline (−27.5 at S9ruz39h.4), but types/z_station_geom.js `stationTrack()` reads it as the
  positive distance `off` and sets zTrack = −off = +27.5 → tracks / platforms would be generated in FRONT of the
  station (in the plaza). STATION_GEOM is canonical (D1) and documents off > 0: urban, please write the positive
  distance (−z), or buildings-z accept either sign (zTrack = −|trackOffset|). props does not read trackOffset (its
  trains are at z = −27.5 ± 2.0 of the station frame, Node-verified).
- (05:25) urban's railGround / levelled beds (corridors.js railBedGround) are in: props trains now use the
  tile rails polylines near the camera and railBedGround for far trains → rail head − stationTrack railY =
  +0.008 m (S9ruz39h.4) / −0.03 m (Sg1b4vvq.2 elevated).

### Progress (05:40)
- ★1 DONE (code): trains.js RAIL_TOP_GRADE 0.35 / deck 0 (D1); heights from the loaded props tiles' CityTileData
  rail polylines (absolute height per 20 m lattice point; urban's levelled station beds are followed) and
  urban `railBedGround` for far trains (computed = polyline heights to the mm, Node polycheck.mjs); service
  lines run one 25 m railcar (halt platforms are 24 m), metro/regional 4–5 cars ≤ 125 m < 130 m platforms;
  models.js car floor = rail head + 1.0 (door glass from the sill at 1.0 + dark sill plates) = platY.
  Node stcheck.mjs: S9ruz39h.4 train centre x = 0, z = zNear (dir −1) / zFar (dir +1), rail head − railY
  +0.008 m; Sg1b4vvq.2 −0.03 m. The Z03 arch is a longitudinal arch over the near platform (z = mid near
  platform), 1.8 m clear of the near train's side.
- ★2 DONE (code): place.js stationViewPrune: residential facades (2+ floors) facing a station platform
  (corridor stations from corridors.js, any tile) with an unoccluded 2F sight line keep no tall crown in the
  window-axis zone (14 m) or along the sight lines (first 48 m): crowns replaced by small round ornamentals
  below the line (foliage stays low in the frame), else removed. S07 tile: 124 replaced / 9 removed of 1084;
  every crown within 63 m of the S07c camera (±45°) now tops out 1–2 m below the eye (Node s07c.mjs).
- 3 DONE (code): park/green walks follow the exact path layout the city draws (copy of streetBuild parkPaths:
  same hash/inset/picks), trees / benches / lamps kept off those paths, park idle group on the longest path;
  sidewalk walks run in the walking strip outside the furniture zone (tree pits / lamps) with people.js keeping
  within the paved width (keep-right fixed: it used to shift every walker to the same side).
- 4 DONE (code): harbour.js G01 landings re-placed on the real 2 m-band waterline with the local shore normal;
  pontoons fully afloat (corners −1.6…−2.1 m), parallel to the shore, gangway onto the cliff foot, ferry berth
  depth checked; the bay head is a 40–90 m bank → new cliff lift (shaft + head + glazed footbridge to the cliff
  edge, models.js buildLandingTower). Every harbour leg sampled every 15 m (0 dry legs); dock ferries
  (boats.js dockRoute) sample every leg every 20 m (detour dropped / route truncated before land).
- 5 (props side): light pools 1.5 → 0.42 window units, 2700 K → ~3800 K (pools, glow sprites, lamp lens).
- 6 eVTOL air taxis (aircraft.js, new): sparse lanes 70–110 m right of each rail corridor, 120–300 m above
  the rail level, nav lights + strobe / beacon at night (sol-time driven).
- **(05:55) urban — levelled station beds sit in a CUTTING on the uphill side** (in-app shot
  shots/props/fix1-station-along.png, S9ruz39h.4 at 62 m from the platform centre): the natural terrain is up to
  ~0.9 m above the level bed (2.4 % grade), so the terrain mesh covers the ballast and the lower third of both
  trains (the trains are exactly on the polylines). Nobody can cut the terrain mesh, so please never put the bed
  below the natural ground: `stationRailLevel(st)` = MAX natural ground over the level zone (20 m lattice), and
  `railBedGround()` returns `Math.max(gh, blended)` (downhill side = embankment, which the city can draw with
  vertical faces down to the terrain; uphill ramp then simply follows the natural ground). props follows
  whatever the polylines / railBedGround say (no props change needed).
- **(05:55) trackOffset sign — confirmed in Node** (scratchpad/props5/stbuild.mjs): with urban's trackOffset −27.5
  the station generator builds trackZ = +27.5 (platforms in the plaza in front of the hall); in the app the
  trains stand behind the hall next to no platform. urban: write the positive distance, or buildings-z: use
  zTrack = −|trackOffset|.

### Verification (06:35, preview 5208, load avg 85–127, workers=2; no shot reached idle within 120 s)
- fix1-s07c.png: the 2F living room now looks over low small-tree crowns at the station hall roof, the
  platform canopy and a standing train (brief: 抬高的视点应看见站台雨棚顶，较低处仍被近处枝叶和窗框遮挡). The
  blue-grey crumpled cards right behind the balcony glass are the building kit's balcony planters (not props).
  Note: the S07c camera resolves 12 m above the bookmark fallback (alt 558 vs 545.9 — controls / kit anchor).
- fix1-s07.png: street trees, walkers on the sidewalk, train 9ruz39h:b:36 standing at S9ruz39h.4 (112 m).
- fix1-station-floor/along.png: trains on the levelled bed exactly at the urban rail level, BUT (a) no platform
  there (trackOffset sign → platforms built in front of the hall), (b) the natural terrain covers the bed and the
  lower third of the trains at the uphill platform end (cutting). Both requested from urban / buildings-z above.
- fix1-s06*.png: bookmark S06 (alt 1122 m a.s.l. = ~4 m above the ground) looks into a building wall; data:
  train g1b4vvq:a:31 at 510 m moving at the bookmark time, stopped 533 m away 15 s later (nextArrival 15 s).
- fix1-s05.png: harbour ferry G01-H0 crossing at 511 m right of centre with its widening wake.
- fix1-s09b.png: inbound ferry G01big106 313 m ahead in the mouth with nav lights, harbour traffic beyond.
- fix1-g01-landing.png: west landing — pontoon afloat parallel to the cliff foot, gangway + stage, 88 m cliff
  lift with footbridge to the cliff edge.
- fix1-boulevard-dusk.png: no orange cast any more (neutral-warm lamps, subtle pools); one walker stood on a
  grass strip: the terrain covers the arterial's sidewalk there (+0.2 m) → sidewalk walks are now split where
  the terrain rises above the paving (Node near.mjs).
- (06:58) fix1-s06-raised.png / -15s.png (S06 pose raised to 1175 m a.s.l., pitch −5): blue-hour canyon, the lit
  4-car train g1b4vvq:a:31 running in on the viaduct at 512 m, stopped at Sg1b4vvq.2 15 s later (535 m, mv false);
  fix1-s06-station-behind.png: the standing lit train beside the Z03-arch station (head / tail glows), subtle
  pools. 15 eVTOLs placed within 9 km (120–300 m above the rail level).
- Final: pools 0.3 window units; trains re-sync polylines when segments change. `npx vite build --outDir
  .build/props` OK (7 s). Preview server on 5208 stopped.

### Remaining / for QA (fix round 1)
- BLOCKERS outside props: urban trackOffset sign (platforms generated in front of the station halls) and the
  levelled station bed in a cutting on the uphill side (terrain covers ballast + lower train) — see Requests.
- S06 bookmark pose (alt 1122 m a.s.l.) is ~4 m above the ground and faces a building wall: lead, please raise it
  (e.g. 34.893,−105.24,1175,253,−5,40 shows the canyon, the arch station and the arriving train).
- S07c resolves 12 m above its fallback pose (controls / kit 'living' anchor), so it is not the 2F view.
- near-field crop rows in O fields not done (optional).

## Fix round 2 (started 12:18, private port 5309, build .build/props, shots shots/props/fix2-*)
Items (★ first): ★P1 game-grade pedestrians (QQ-08, QS-12), ★P2 trees: bark resolution/filtering, leaf cards
side view, multi-layer crowns with branches (QQ-09, QS-12), ★P3 night light pools near the camera at C04 (QQ-06),
P4 ferries on urban's new terminals + G01 harbour, widening wakes (QS S05), P5 optional crop rows.
Load avg ~130 at start (5 fixers) -> look-dev on a new bench dev/props-lab.html (inline module, no world),
in-app checks only for the proof shots.

### Plan (12:25)
- P1: new src/props/people-models.js: lofted anatomical bodies (8 body/outfit types: men/women/older/child,
  heights 1.55–1.90 m), sculpted head with nose/ears/brow + face texture (eyes, brows, lips), hair shells
  (5 styles), hands with fingers (LOD0), shoes with soles, outfits (jackets with collars/hems, long coats, skirts,
  vests, scarves, bags) + fabric/fold normal atlas; procedural skeleton in the vertex shader (pelvis, spine,
  hips/knees/ankles, shoulders/elbows; 2-bone weights) driving walk cycles and several idle poses; shadow depth
  material with the same skinning; LOD0 (< 28 m) / LOD1 (< 110 m) / LOD2 (< 320 m).
- P2: real branching skeleton (limbs -> branches -> twigs, arc-length UVs), leaf-cluster cards at twig ends in
  layered shells, card facing fade (aCardN), bark 1024x2048 + normal map, max anisotropy.
- P3: nearest-N SpotLights (three punctual lights work through lighting.patch) on lamp heads / light bollards near
  the camera + improved decal pools elsewhere (suppressed inside the spot radius); light bollards on plazas.

### Progress (13:15)
- ★P1 code done: src/props/humans.js (new): 10 body types (manJacket, manCoat, manHeavy, womanJacket, womanSkirt,
  womanCoat, elder, worker, youth, child; 1.28/1.62–1.85 m, ±3 % instance scale) built from lofted superellipse
  torso sections (male / female / heavy / stooped), limb tubes with muscle profiles, sculpted head (jaw, cheekbones,
  eye sockets, brow, lips, chin) + lofted nose + ears, face texture (6 faces: eyes with iris / pupil / highlight,
  lids, lashes, brows, lips, stubble / beard, wrinkles), hair shells (crop, short, side, bob, long + back sheet,
  bun, pony, grey), hands with 4 fingers + thumb (LOD0) / mitten (LOD1), shoes with soles, outfits (stand collars,
  long coats with V opening + buttons, skirts, hi-vis vest with reflective bands, hoodies, scarves, messenger bags,
  backpacks, phone), geometric folds (ankle stacking, knee backs, inner elbows, waist), fabric DataArrayTexture
  (knit, twill, technical shell, wool, leather, hair). LOD0 ~8k verts, LOD1 ~2k, LOD2 ~0.8k.
  materials.js HUMAN_VS: per-vertex skeleton (15 joints, R = Ry·Rz·Rx chains), walk cycle (hip / knee / ankle
  with toe-off + heel strike, arm swing, pelvis yaw / drop / bob / sway, spine counter-rotation) and idle poses
  (relaxed, contrapposto, phone, hands in pockets, arms crossed, cup); humanDepthMaterial skins the CSM shadows.
  people.js: per type × LOD InstancedMeshes (LOD0 < 30 m, LOD1 < 110 m, LOD2 < 320 m), look = pickLook(hash)
  (Z / O-zone / idle mixes), idle poses by group kind. Lab: dev/props-lab.html (?view=people|faces|crowd|trees|...).
- ★P2 code done: models.js broadleafLOD0 (trunk flare + leader, 5–18 limbs, 2–4 branches each, twigs, bark tubes
  with arc-length UVs) with leaf-cluster cards in layered shells (no dark core); bark 1024×2048 + Sobel normal map,
  anisotropy 16; PROPS_LEAFFACE (aCardN) fades edge-on cards on leaf / shrub materials.
- ★P3 code done: lights.js (16 SpotLights on the nearest lamp heads + entrance canopy downlights from place.js
  elights), decal pools dimmed inside the spot radius, light bollards (lens band + pool decals).
- P4: ferry wakes handed to water with width ×1.2 and strength up to 1.45 (water draws the widening V).

### Progress (14:12) — in-app verification (slot cap now 1 machine-wide: long waits)
- fix2-c03-a.png (day, C03): new pedestrians on the plaza; fix2-s07-b.png: elder walking at ~5 m (cardigan,
  hands with fingers, grey hair, shoes), coat / backpack walkers at the door, street trees with V-forked limbs;
  fix2-s07d-b.png: S07d street trees: branch skeleton + leaf clusters, crisp bark (QQ-09 blocky bark gone).
- fix2-c04-a/b.png (21:30): the atmosphere's darker night is in; spot pools work (post lamp pool on the steps,
  walker lit on the plaza). b: plaza lamp lattice (14 m) + 16 spots within 37 m, but the entrance canopy lights
  (44 m) were not selected and the pools were modest -> 24 spots, E 0.3 / 0.28 / canopy 0.45, canopy lights rank
  30 m ahead, spot radius = nearest lamp left out (decals inside it dimmed to 35 %, spots fade towards it).
- light bollards: own pool material (never dimmed), 0.95 window units, r 1.9 m.
- trees LOD1 (70–380 m) now uses the same skeleton builder (q 0.5: fewer limbs, 1.5× cards, no dark core) so
  the LOD0/LOD1/impostor crowns agree (QS-12 "S06 crowns are dark lumps").
- people load progressively (lib.buildHumans(false): one body type per macrotask; props.isIdle false until done).
- P4: harbour.js ferryNetwork(u, 7 km) in the props worker: terminals = urban district2(...).piers / .ferry /
  .ferries with kind 'ferry' | 'landing'; each linked to its nearest terminal 0.8–7.5 km away across open water
  (straight or one detour waypoint, legs sampled every 45 m); boats.js runs 1–2 ferries per line (shuttle
  timetable, keep-right 26 m), refreshed when the camera moved 2.5 km. Node: G01 harbour 6 terminals / 3 lines,
  ZR5 (-42.36, 101.62) 1 line 3.8 km, ZR4 1 line 3.6 km. Ferry wakes: width ×1.2, strength ≤ 1.45.
- build: npx vite build --outDir .build/props/dist OK (10.6 s).

### Requests (fix round 2)
- urban: props reads the ferry piers through district2(key).piers (+ .ferry / .ferries) entries with kind 'ferry' |
  'landing' and fields cu, cv, du, dv, len (harbour.js ferryNetwork); please keep these names (or tell props).
- lead: S05 — a terminal-to-terminal ferry line exists at the ZR5 candidate 2 (-42.3597, 101.6207, heading 165:
  3.8 km crossing); if S05 moves there, ask props for a timetable sync constant (harbour.js SYNC_*) so the crossing
  ferry is in frame at the bookmark time.
- city / buildings-z: the glowing-cap bollards along the C04 station plaza edge are not props'; they light no
  ground (props' own light bollards carry decal pools).
- (14:25) atmosphere request done: glow / pool materials bind the shared `uLpEmissiveScale` uniform object (the
  emissive unit now follows the capped ground-night exposure every frame); the SpotLights scale with the same
  gain (ES / 0.05) so pools keep their relation to lit windows (C04-c was dim: gain not applied yet).
- S05 (fix2-s05-a.png): port city behind the G01 harbour now (urban U1); synced harbour ferry G01-H0 crossing at
  511 m with its wake; 3 terminal lines active (T-…, 1.5–3.4 km). From 25 m the wake is foreshortened to a thin
  band (grazing view) -> ferry wakes now width ×1.6 (longer Kelvin arms, wider white centre).

### Final (15:00)
- fix2-c04-d.png (C04 21:30, with the atmosphere's darker night + emissive gain): light pools on the plaza around
  the lattice post lamps and the walker, the entrance canopy downlight pool on the station steps, light-bollard
  pools; 20 spots within 38 m (stats().lights). fix2-c03-a / fix2-s07-b / fix2-s07d-b: people + trees by day.
- lab (dev/props-lab.html): fix2-lab-faces2 (face close-up: eyes / brows / nose / lips / ears, stand collar +
  zipper, hands), fix2-lab-people3 / -crowd (10 body types, outfits, idle poses incl. arms crossed / phone),
  fix2-lab-trees2 / -treeside2 / -bark (branch skeletons, leaf clusters, bark detail).
- S05 is now the G01 mouth-channel pose (lead): fix2-s05-b.png shows a lane vessel with a wide V wake; no
  terminal line crosses near this camera (lines run across the inner harbour ~5 km out) -> syncFerryLines puts
  the in-view line's ferry mid-crossing at ~5.3 km at the bookmark time (Node-verified); a foreground crossing
  needs a line near the pose (request below).
- P5 crop rows: not done (optional).
- build OK (.build/props/dist). Dev server 5309 stopped.
- Request (lead): S05 — for a FOREGROUND crossing ferry (§5 05) either look across an existing terminal line
  (G01 inner harbour: lines T-16538639|16538640, T-16538640|16540688, T-16542737|16544784 ~5 km north of the
  current pose) or tell props the pose and props adds a cross-channel line (two landings) just inside the mouth.

## Fix round 3 (started 18:55, private port 5309, build .build/props, shots shots/props/fix3-*, scratch $SCRATCHPAD/props6)
Items: ★P1 S05 foreground ferry + widening wake at the bookmark time, ★P2 wheel treads at ±0.7525 m, P3 no trees on the
water side of water works (S07O control room), P4 QQ2-03 pink blossom crowns = discs -> clustered blossom, P5 optional
props.treesNear(ecef, r). Browser budget: ONE machine-wide slot -> Node checks, ≤ 3 app shots.
### Log
- 19:00 S05 survey (Node, props6/survey.mjs + net.mjs): camera in the middle of the 8 km G01 inner bay, ON the G01 lanes
  (inbound big lane ~100 m east). No line crossed the foreground: G01 harbour line ran along the north shore behind BG01
  (2.3 km), terminal lines T-…|… 2–7 km out / outside the FOV.
- 19:10 first try = a NEW cross-harbour line with its own landings: rejected — the west landing put its berth 5 m from
  the urban terminal line T-16538639|16538640 (hugs the west shore), the east one landed in a slip between two city
  cargo piers / on the G01 east landing.
- 19:15 terrain-fn ★T1 is turning the G01 shore into +2–4 m quays (megasites.js): the G01 landings now have no cliff lift
  (top < 6 m) and the east one moved INTO the city's cargo-pier slip -> landingFinder now reads the urban piers
  (district2().piers, sitePiers) and keeps pontoon / gangway / berthed ferry / straight approach ≥ 5 m off every pier;
  the final approach runs out beyond the heads of the piers beside the berth (≤ 700 m).
- 19:25 ★P1 DONE (code): the EXISTING G01 harbour line (west bay-head landing <-> east-shore landing) now crosses the
  harbour through the S05 foreground: straight 1.4 km section 360 m ahead of the S05 camera, tilted 15° off square
  (eastbound ferry draws away, wake trails back towards the camera across the left of the frame); s05Phases() puts
  the eastbound ferry at rel +8.5° at the bookmark time (steps aside from G01 lane vessels), the second ferry half a
  period later (or ±420/800 s) when that keeps it > 1.2 km away. Node (props6/s05check.mjs, bookmark camera 1600×900):
  G01-H0 ferry 345 m, course 88°, moving, hull x 921–1270 / y 553–641 (mast top 553, below the horizon ~521), stern
  wake from x 939 to the left edge (ages 0–20 s, depth 332 -> 296 m); cargo G01big72 (turning basin, 1.09 km) at x
  672–906 clear of the ferry; G01-H1 2.9 km east (outside the FOV). T±30 s: ferry at x≈ -86 / +335 m east -> crossing.
  Route vs city docks (piercheck.mjs): ≥ 19 m from every pier incl. the ±32 m keep-right offsets; 0 dry legs.
- 19:40 ★P2 DONE: models.js buildTrainCar — open bogies (outboard side frames, axle boxes, transom, axles) and
  wheelsets with a real profile: tread (tape circle r 0.43 m to the rail head y = 0) centred at ±(1.435 + 0.07)/2 =
  ±0.7525 m, inner flange r 0.458 (x 0.685–0.7105, 2.8 cm below the rail head, just inside the rail head 0.7175–0.7875);
  underfloor equipment only between the bogies. Node wheel.mjs: tape-circle vertices mean x = ±0.7525.
- 19:45 P3 DONE: place.js wzones — buildings with meta.water (pool / intake facade from meta.poolSide / intakeSide,
  default back): no tree from that facade out to meta.water.dist − width/2 (+1 m), ±(half width + 12 m) along it
  (addTree rejects). PLACE_VERSION props-place-7. Node o7trees.mjs: S07O station OX1-0.2.iy.gk-n7.n1-0 had 6 trees in
  that strip (row 3.5 m behind the back facade + one at the bank) -> 0; 49 tiles around: 9 water works, 0 with trees on
  the water side. Remaining trees in the S07Od control cone: the poplar row across the canal (66–79 m).
- 19:50 P4 (code): materials.js leaf atlas cell 2 rewritten — blossom branchlet: 8 twigs + side spurs from a stalk,
  umbels of 2–5 five-petal flowers (notched petals, pink base -> pale tip gradient, dark eye + stamens, a few near-white
  and shaded flowers) on pedicels at the spurs / twig tips, buds, bronze young leaves; gaps between the sprays, ragged
  outline (was a solid disc of 420 flowers = the "coins"). models.js: blossom 11 sprays per twig (was 9).
  Lab bench views added: dev/props-lab.html?view=atlas | blossom.
- 19:55 P5 DONE: props.treesNear(ecef, r = 30) -> [{ecef (trunk base as displayed), height, crownBase, crownR, species,
  distance}] nearest first (tiles.js treesNear over the loaded prop tiles). Node: S07Od eye 6 trees within 40 m.
- 20:20 extra (QA2 added two props minors after triage, both cheap / low risk, done):
  QZ2-08 Canvas2D getImageData warning: every read-back 2D canvas (materials.js leaf atlas / bark / foam / panel,
  humans.js face + fabric atlases) now uses getContext('2d', {willReadFrequently: true}).
  QZ2-09 benches level on slopes (one end buried): plaza / park / courtyard benches sit on the EXACT ground at their
  four feet (place.js benchY: level on the highest foot, plaza paving +0.12, no bench where the feet differ by > 7 cm);
  street benches use the graded sidewalk at both leg frames (±0.72 m along the street, same 7 cm rule).
- 20:25 build OK (.build/props/dist); preview 5309; proof shots queued behind QA's chain in the single browser slot
  (S05 app, lab atlas / blossom, S07Od app).
  Node bench.mjs (27 tiles: QZ2-09 riverside plaza 34.8678,-105.21372 / S07 / ZR5): plaza / park / courtyard benches
  218 + 461 + 390, every foot 0.000–0.070 m above the drawn surface (terrain, plaza paving = terrain + 0.12): none buried.
- 20:48 APP fix3-s05.png (bookmark S05, preview 5309, 1600×900, workers=3; idle not reached in 500 s under load, shot at
  538 s; 0 console errors / warnings): the harbour ferry G01-H0 crosses the foreground right of centre (hull x ≈
  915–1270, y ≈ 577–640 = the Node prediction) heading right with a white wake trailing to the left edge, widening
  from the stern; BG01 + container ship (turning basin) behind. In-app boatsNear(): G01-H0 345 m moving, G01-H1
  2899 m, wakes handed to water incl. G01-H0 — identical to Node.
- 20:50 lab fix3-lab-atlas.png (cell 2 = blossom branchlet: twigs, umbels, buds, gaps, no disc), fix3-lab-blossom.png /
  -near.png (17 m / 6.5 m: crown of small irregular flower sprays on the branch skeleton, no coins; petals read a bit
  lilac under the blue sky ambient -> petal saturation raised 58/46 % -> 72/62 %, fewer near-white flowers).
- 20:58 APP fix3-s07od.png: the trees in front of the control bay were STILL there — cause: tiles.js slimCity() (the
  CityTileData copy posted to the props worker) dropped meta.water / poolSide / intakeSide, so the worker's placeTile
  had no water works (Node used full tile data). Fixed (slim meta keeps water / poolSide / intakeSide); re-shot queued.
- 21:00 S05 ferry model (the S05 hero is now 345 m away, ~350 px long; it read as a white box): painted hull bands
  (antifouling red / dark-blue boot stripe / blue sheer line, 3 cm proud), window mullions every 1.7 m, funnel with blue
  band + cap, 12 life-raft canisters, mast now stands on the upper deck (it floated 2.2 m above it) + radar bar. Node:
  buildFerry 0 NaN (hull 1061 tris). Lab view dev/props-lab.html?view=boats.
- 21:16 APP fix3-s07od-b.png (after the slimCity fix): the control-bay view over the pool / gates / walkway is open — the
  trunk behind the mullion and the leafy tree at the right are gone (also their shadows on the sill); in-app
  treesNear(camera, 40 m) = the same 6 trees as Node (nearest 27.9 m, the poplar row across the canal). The only
  console line is controls' "buildingView: … has no 'control' view" (not props; the stored pose is used).
  Lab fix3-lab-ferry-near.png / -345m.png: ferry with mullioned window bands, funnel, rafts, mast on the deck, boot /
  sheer stripes. fix3-lab-blossom2.png: pinker crowns.
- 21:18 final: npx vite build --outDir .build/props/dist OK (22 s, all changes); preview 5309 stopped, no browsers of mine.
### Requests (fix round 3)
- lead (bookmarks.js): the S05 foreground ferry is synced to the CURRENT S05 bookmark (pose 0.53127, 129.95260, 20 m,
  heading 12.7, 45 mm; solTime local(129.94351, 15.5)). If S05's pose or time changes, tell props (harbour.js S05X) —
  the harbour line crossing section and the phase follow those constants.
- controls / buildings-o: S07Od logs "[controls] buildingView: building OX1-0.2.iy.gk-n7.n1-0 has no 'control' view"
  (the stored pose is used, the frame is right) — one console warning per S07Od load.
### Remaining / known (fix round 3)
- S05 app shot (fix3-s05.png) shows the ferry BEFORE the model upgrade (bands / mullions / funnel came after; lab shots
  show the new model, the sync / position are unchanged).
- The camera of S05 sits on the G01 navigation lanes (inbound big lane ~100 m east): ~45 s after the bookmark time an
  inbound lane ferry passes close to the camera (not in the frozen bookmark frame).
- terrain-fn is still reshaping the G01 shore into quays this round: the harbour landings (pontoon + gangway, lift
  tower only on banks > 6 m) are recomputed from the live terrain + urban piers in the props worker; no props change
  needed when they finish.
