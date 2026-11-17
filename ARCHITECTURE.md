# 火星全境 · Three.js engine architecture & contracts

This is the binding contract between all modules. The art brief is `prompt.md` (read §1–§6);
reference images are in `../参考图/` (thumbnails of every image can be produced with `sips`).
If you change a contract, update this file in the same change and say so in your report.

## 0. Principles (from the brief)

* **One deterministic world.** Seed `351165` (`core/constants.js`). Every height, road, parcel,
  building, window light and ID is a pure function of (seed, coordinates, version). Main thread
  and workers compute identical results (same V8 maths). Never use `Math.random()` for world data.
* **Terrain first, then the city grows from it** (§1 先建地形，再从地形上长出城市). Layers are
  frozen in order: sphere coords + sea level → terrain → water → roads → parcels → buildings →
  entrances/interiors. Lower layers never read higher layers (no cycles).
* **Same data at every scale.** Orbit texture colour, night lights, mass models and detailed
  buildings derive from the same parcels (§4 远景城群…从同一组地块派生).
* **Quality first, no performance budget** (§1, §6). Default quality is the maximum. Heavy work
  goes to workers, loads progressively, and the view refines to final quality. Frame time is
  diagnostic only. Never lower visible quality to hit a frame rate.
* **Float64 on the CPU, camera-relative on the GPU.** The camera sits at render-space origin.

## 1. Layout & ownership

```
web/
  index.html, vite.config.js, package.json      (core)
  public/data/*.bin + manifest.json              control maps as raw bytes (scripts/prep-data.mjs)
  scripts/shot.mjs                               headless Chrome screenshots + console report
  scripts/node-world.mjs                         load maps in Node for previews/benchmarks
  dev/*.html                                     per-module test benches (each owner adds its own)
  src/main.js, src/app/*                         App shell, state, events, sun, bookmarks (core)
  src/core/*                                     constants, geo, hash, noise, origin (core)
  src/data/*                                     control maps, province table (core)
  src/world/fields.js terrain.js hydro.js sites.js   terrain-fn agent
  src/world/urban.js (+ urban/*), occupancy.js   urban-fn agent
  src/world/surface.js                           terrain-render agent (texel colours)
  src/workers/pool.js world.worker.js            core;  handlers/<x>.js owned per subsystem
  src/render/pipeline.js, render/atmosphere/*, render/clouds/*, render/shaders/*   atmosphere agent
  src/render/terrain/*, workers/handlers/terrainTile.js                            terrain-render agent
  src/render/water/*                                                               water agent
  src/render/city/*, workers/handlers/cityTile.js                                  city agent
  src/buildings/kit/*, buildings/materials.js, buildings/index.js, types/residential*  building-kit agent
  src/buildings/types/<other>.js                 building-type agents
  src/megastructures/*                           megastructure agent
  src/props/*                                    props agent
  src/controls/*                                 controls agent
  src/ui/*                                       ui agent
```
Do not edit files you do not own. If you need a change in another module, write the request in
your final report (exact function + reason). Never run git commands that change state.

## 2. Coordinates & units

* Metres, seconds, degrees in APIs (radians internally). `R = 3,389,500 m` = sea-level radius.
* **ECEF / planet frame** (= THREE world axes before the origin shift): `+Y` north pole,
  `+Z` (lat 0, lon 0), `+X` (lat 0, lon 90°E). `unit(lat,lon) = (cosφ·sinλ, sinφ, cosφ·cosλ)`.
* **Local tangent frame** at a point (§4): `+X` east, `+Y` up, `−Z` north (so `+Z` south).
  `geo.enuBasis(lat,lon)` → `{east, up, north, south}`; `localToEcef / ecefToLocal`.
* **Equirect maps**: `u=(lon+180)/360`, `v=(90−lat)/180` (top = north, left = 180°W, x wraps).
  Caution: THREE `DataTexture` row 0 is v=0 (bottom); flip rows when uploading north-up data.
* **Cube sphere**: faces 0..5 = +X,−X,+Y,−Y,+Z,−Z (`geo.FACES`), face-uniform coords
  `(a,b)∈[-1,1]²` with tangent warp. `vecToFace / faceToVec`. Face-plane metres
  `X=a·FACE_ARC, Y=b·FACE_ARC` (`FACE_ARC≈2,662 km`); true ground scale varies 0.71–1.0 —
  use `geo.facePlaneScale(a,b)` to correct. CCW in (a,b) is front-facing from outside.
* **Quadtree tile** `{face, level, x, y}`, key `"face/level/x/y"`, covers
  `a∈[-1+2x/2^L, -1+2(x+1)/2^L]`. Level L edge ≈ `5324 km / 2^L` (L13 ≈ 650 m, L18 ≈ 20 m).
  `CITY_TILE_LEVEL = 13`: the city is generated per L13 tile.
* **Tile-local frame**: local tangent frame at the tile centre direction, origin at sea level.
  `y ≈ height above sea level` inside a tile (curvature < 2 cm over 650 m).
* **Building local frame** (`geo.buildingAxes(lat,lon,heading)`): origin = footprint centre at
  height `spec.ground.entrance`; `+Y` up; `+Z` = outward normal of the FRONT facade (main
  entrance side); `+X` = right hand of a viewer standing outside looking at the front.
  `heading` = compass bearing the front faces (0 = north, 90 = east). Footprint spans
  `x∈[−w/2,w/2]`, `z∈[−d/2,d/2]`, front facade at `z=+d/2`.
* **Time**: `state.solTime` = hours at longitude 0 (sol of 24 h). Sub-solar longitude
  `(12−solTime)·15°`, sub-solar latitude `state.subsolarLat` (season, default 12°).
  `app/sun.js` has `sunDirection`, `localSolarTime(lon, solTime)`, `solTimeForLocal`.
* Scale references: person 1.7 m, eye 1.65 m, residential storey 3.1 m, public 4.5–6 m,
  utility walkway 1.5–2.4 m clear width, door 2.1–2.4 m, standard gauge 1.435 m, rail 1.1 m.

## 3. Rendering conventions

* `App` sets the floating origin (`core/origin.js`) to the camera ECEF position every frame.
  Every planet-anchored object sets `obj.position = ecef − origin` (float64 subtraction, then
  float32) in its `update(frame)`. Store vertex data relative to a local anchor (tile centre,
  building origin) — never absolute ECEF in float32.
* Renderer uses `logarithmicDepthBuffer: true`, `near = 0.05 m`, `far = 2e8 m`. Custom
  `ShaderMaterial`s **must** include `#include <logdepthbuf_pars_vertex>`,
  `#include <logdepthbuf_vertex>` (after gl_Position), `#include <logdepthbuf_pars_fragment>`,
  `#include <logdepthbuf_fragment>`. Prefer `MeshStandardMaterial`/`MeshPhysicalMaterial` +
  `app.lighting.patch(material)`.
* Linear HDR pipeline. Base-colour & coloured-emissive textures: `SRGBColorSpace`; data textures
  (normals, roughness, IDs, heights, masks): `NoColorSpace`/linear. Tone mapping + sRGB output
  happen exactly once in the pipeline's output pass — materials must not tone-map themselves.
* `app.lighting.patch(material, {nightEmissive?:bool, emissiveOnsetAlpha?:bool,
  receiveCloudShadow?:bool})` gives every material: planet-aware sky/ground ambient (blue sky +
  ground bounce with the LOCAL ground albedo `uLpGroundAlbedo` — pavement grey in cities, red on bare
  rock, green on farms, from `world/fields.js` at the camera; on the night side only a dim, cool,
  art-directed night-sky light with a soft directional part for relief + emissive),
  atmospheric transmittance on the sun (reddening near the terminator), cloud shadows, night
  gating of emissive, ground-level ambient occlusion (pipeline GTAO, ambient terms only) and
  aerial perspective / haze (applied by the pipeline's atmosphere composite from the depth
  buffer). Emissive unit: `totalEmissive × uLpEmissiveScale` (`EMISSIVE_SCALE` 0.05 by day and from
  altitude), 1.0 = typical lit window at night. Fix round 2 (ground night regime, atmosphere): near the
  ground (< ~4 km above ground, blended out by ~60 km) the night exposure is capped at +2 EV over the noon
  exposure and the shared uniform `uLpEmissiveScale` rises by the same factor at night (≈ 0.22), so lamps /
  windows keep their brightness while reflected night light is ~4.5× darker (artificial light carries the
  night); read the uniform OBJECT (`app.lighting.uniforms.uLpEmissiveScale`), never copy its value (its
  value before the first frame is the ground-night unit). The cap engages from sun −4° (complete at −12°),
  so dusk / blue hour keep their exposure; in the same ground regime the shared `uLpSunE` is lifted up to 3×
  once the sun has set (blue hour: sky, sky irradiance, haze, clouds and reflections together) — custom
  shaders must take sun / sky light from `uLpSunE`, never from a constant. All systems must patch their
  materials; GLSL API for custom shaders and the photometry are documented at the top of
  `render/atmosphere/lighting.js`.
* Sun = one `DirectionalLight` (`app.sunLight`, owned by atmosphere) pointing along
  `frame.sunDir`; CSM shadows (`app.csm`, 4 cascades over 2.6 km + 9 × camera height above ground,
  ≤ 30 km; slope-scaled bias since fix round 2) when the camera is < 8 km above ground. Meshes that
  should cast/receive set `castShadow/receiveShadow`; nothing else.
* Pipeline settings (`state.settings`, 'settings' events): `exposure` (linear multiplier, UI sets
  2^EV), `bloom`, `taa`, `shadows`, `clouds`, `cloudCoverage`, `ao`, `localExposure`, `toneMap`
  ('agx'|'aces'), `nightDodge` (orbit night-side lift to the night-orbit exposure; from >= 600 km the
  exposure is ONE locked day baseline whatever the framing, §5 02 turntable; false/0..1), `pixelRatio` (0 = auto, capped
  by quality), `quality` ('ultra' default | 'high' | 'medium': auto-DPR cap, accumulated samples,
  cloud march quality, AO). 'time' and 'goto' events reset the accumulation.
  `pipeline.capture({scale})` → PNG Blob (tiled, converged, no UI);
  `pipeline.resetAccumulation()`, `pipeline.snapExposure()`, `pipeline.lodScale`, `pipeline.quality`.
  Fix round 2: `settings.debugView` 'ao' / 'aoRaw' show the ambient occlusion as single-channel grey;
  local exposure is off at night; orbit day baseline +0.8 EV (night side unchanged through the dodge);
  WebGL context loss pauses the frame loop (`pipeline.contextLost`) and reloads the page at the same
  pose / time when the browser restores the context (≤ 2 per 10 min, then a manual reload notice).
  Fix round 3: the cloud field is a pure function of `state.solTime` (cloud time = solTime 0..24, no
  history: same time → same clouds, turntable longitudes at one time share one field); over the sol's
  last hour (solTime 23–24, no bookmark there) it dissolves into the next sol's phase so the 24 → 0 wrap
  is seamless (`clouds.cloudTime`, `clouds.cloudMix`; exported `cloudClock(solTime)` / `cloudPhase(t)`;
  shader uniforms `uCloudRot2 / uCloudOffA2 / uCloudOffB2 / uCloudMix` next to `uCloudRot…`, GLSL
  `lpCloudWeatherP(p, footprint)` = blended weather at a planet-frame position). Orbit look (output
  pass, weight = exposure lockK, `settings.orbitLook` false/0..1): midtone contrast above the land
  level, saturation 1.32, soft shoulder (cloud tops ≤ ~245 sRGB); orbit day baseline +1.1 EV.
* Debug layers (`state.settings.debugLayer`): owners implement what applies to them:
  `'province' | 'zone' | 'density' | 'emission' | 'wireframe' | 'objectId' | 'lod' | 'normals'`.
  With `settings.clean === true` nothing but the scene may be drawn (no labels/outlines/UI).

## 4. App, frame and systems

```js
class XSystem { constructor(app); async init(); update(frame); isIdle?(); raycast?(o, d); dispose?() }
app = { renderer, pipeline, scene, camera, rig, state, events, workers, lighting, systems, controls, frame }
app.systems = { atmosphere, clouds, terrain, water, city, mega, props, controls, ui }   // update order
frame = { dt, time, frameNo, fps, solTime, sunDir:Vector3, camEcef:{x,y,z}, camLat, camLon, camAlt,
          camAltGround, camUp:Vector3, planetCenter:Vector3 (render space), camera, viewport:{width,height,pixelRatio},
          frustum:THREE.Frustum, projScreen:Matrix4, moving:bool, rigVersion, settings }
```
* `app.isIdle()` = no pending worker jobs and every system's `isIdle()` true — used by
  automation and screenshots. A system that is still refining **must** return false.
* Events (`app.events`): `select`, `hover`, `mode`, `time`, `settings`, `goto`, `camera:arrive`,
  `tile:add {tile}`, `tile:remove {tile}`, `city:tile {tile, data}`.
* Selection objects: `{type:'location', lat, lon, h, province, zone}` or
  `{type:'building', id, spec, distance}` or `{type:'mega', id, part}`.

## 5. World functions (pure, worker-safe, no THREE, float64)

### fields.js — `sampleFields(x,y,z,out)` (unit vector)
`lat, lon, province (1..12 exact), zone ('O'|'Z' exact), zoneO (0..1 visual blend), coast (signed,
>0 land), density, emission (0..1 smooth), ridge (0..1 bare-rock/mountain mask), urban (0..1 urban
potential), farm (0..1), ice (0..1)`. Administrative values are exact per-pixel lookups; all visual
transitions use the smooth/warped ones so borders never show as pixel staircases.

### terrain.js
* `heightAt(x,y,z, minWavelength=0)` → metres above sea level. Band-limited: octaves with
  wavelength `< 2·minWavelength` fade out. Full detail resolves ≈ 0.25 m.
* `sampleTerrain(x,y,z, minWavelength, out)` → `{h, mat, rock, sand, soil, ice, frost, wet, strata,
  slopeHint}`; `TerrainMat` enum.
* Built-up land is smooth at < ~150 m wavelengths (damped by `fields.urban`/`farm`) so roads and
  building plinths sit naturally; rock areas keep crisp relief (ridges, crater rims, canyon walls,
  strata terraces). Must contain the two megastructure landforms from `sites.js`.
* Fix round 2 (additive): every step-like feature is band-limited by `minWavelength` (cliff / riser widths >= ~1.5 mw:
  mesas, coastal and ice cliffs, crevasses, G02 layered walls, basin escarpments); the gully filter fades each octave by
  its EFFECTIVE local frequency (steering rotation x kernel lever arm) toward its mean carve, so coarse and fine LODs keep
  the same mean ground (rms 7 m at mw 80 vs full detail in the ZR1 range, was 35 m) and no 80 m scarps alias into combs.
  `sampleTerrain` additive `crevasse` (0..1 vertical crevasse cue on OX4 ice-cliff faces); ice-cliff faces are `ICE`
  down to a short red-rock foot. Canyon / valley floors (ZR2) are flat alluvial floors at the floor parameter (the river
  never runs on a levee above them).

### hydro.js — `waterAt(x,y,z,out)` → `{type, level, depth, dist, width, flow:[e,n]}`
`type`: 0 none, 1 sea (level 0), 2 canal/river, 3 lake/reservoir. Canal water levels are smooth
along a channel and step only at sluices. The sea is wherever terrain < 0 and connected.
`canalsInTile(face, level, x, y)` → `[{id, order, width, level0, level1, points:[[lat,lon]...],
sluices:[{lat, lon, upLevel, downLevel, heading}]}]` — vector canal network clipped to a tile, used
by urban.js (farm layout, sluice/pump stations, bridges) and the water renderer.
Sluice semantics (D2): `upLevel` = upstream (higher) ≥ `downLevel`, `heading` = downstream flow direction,
single steps ≤ 12 m (larger drops are staircases of sluices); checked by `scripts/check-terrain-sluice.mjs`.
Additive fields: `flow` (+1 = water flows along the point order; level0 = level at points[0]), `pumps:[{lat, lon,
downLevel (intake), upLevel (outlet), heading}]` (lifts where the ground rises > 6–10 m above a channel; not
sluices), `kind` ('canal'|'ditch'|'river'|'spillway'), `melt` ('foot'|'outflow' for the OX4 meltwater rivers).
Laterals always leave their main canal (offtake sluice / pump at points[0]); ditches are flat, following the ground.
`lakesInTile(face, level, x, y)` → `[{id, kind, level, lat, lon, radius, role?}]` (G02 reservoirs; OX4 pools kind
'melt', role 'forebay'|'lake'). `iceFootSystem()` → OX4 ice-cliff foot line, ice-marginal meltwater channel
reaches, outlets with forebay pools (pump intakes) and lakes (lat/lon lists; see `world/terrain/icefoot.js`).
Main thread: never call canalsInTile directly — worker job `'canals' {face, level, x, y, lakes?}` (and
`'iceFoot'`) in `workers/handlers/lookup.js`. The coast grid is precomputed (`public/data/coast.bin`, key-checked,
computed when missing/stale) by `scripts/prep-data.mjs`; re-run it after changing water.png or `SEA_PAINT`.
Fix round 2 (terrain-fn, additive): **OX1 东泽汇水盆地** (`world/terrain/basin.js`, §5 03): a catchment basin around the lake
centre 7.3742N 104.9724E (axis bearing 35° from the outlet in the SW to the basin head) — horseshoe of red-rock tablelands
(cliffs 300-470 m with talus, cap rock, strata ledges, lobate outer edge with detached mesas) open toward the outlet, a
multi-branched drowned-valley lake 'OX1-BL1' (waterAt type 3, kind 'lake', level 150 m; `lakesInTile` lists it) with
islands and dry tributary valleys notching the tablelands, a rock sill and the outlet main canal 'OX1-BL1-OUT'
(`canalsInTile`, kind 'canal', order 0, sluice staircase 150 -> ~123 m, laterals / ditches like any main) ending at a
forced C0 node from which the regular network runs downstream; no farmland / canals inside the basin or on its
tablelands. `hydro.ox1Basin()` -> {lake, outlet, centre, axis, sill}. G02: the spill channel G02-OUT ends at a forced C0
node feeding an irrigation district on the plain below the escarpment; irrigated bench terraces on the benched bank of
R2-R6 (`fields.farm`, `sampleTerrain.farm`). DECISION DD: no open farmland / canals north of 70N (`fields.farmBase` / `farm`
are 0 there; the terrain grading is unchanged). Optional precomputed C0 node table `public/data/canalnodes.bin`
('canalNodes' in the manifest, validated against live nodes at install, bit-identical) — re-run `scripts/prep-data.mjs`
after terrain / field changes (a stale table is detected and ignored).

### sites.js — `SITES.tidalBarrier`, `SITES.waterStairs`
Layout data in local tangent metres around each anchor (dam lines, reservoir levels/outlines,
barrier segments, lock gaps, maintenance roads). Read by `megastructures/*` and `terrain.js`.
Fix round 2 (additive): `levels[i].waterline.paintTop` = L + 6.5 m — the terrain paints the pale old-water-line band up to
it on the `waterline.side` bank of all six reservoirs (L + 3.6 m faintly on the other bank).
Fix round 3 (terrain only, site layout data unchanged): **G01 quays** — along the protected harbour shore (|U| < 4600 m,
fading out to 5150 m: the headlands at the barrier ends keep their natural shore) the land is a quay platform at
+2.8..3.6 m a.s.l. (east cargo 3.4 m / bay head 2.9 m / west 3.0 m, +0.35 m inland rise), 300-600 m deep measured from the
TRUE waterline (coast metric 0; cargo ~550, bay head ~385, west ~335 m), with a quay wall at the waterline and a graded
ramp (480 ± 90 m) up to the natural terrace behind (no more 25-90 m sea cliff); sea side berth pockets at the quay wall
(cargo 13 m / bay head 8 m / west 5 m deep, 140 / 90 / 45 m wide, back to the basin depth over 260 m). Barrier shelf,
mouth, channel, harbour water type unchanged. **G02** — the terrain draws `g02WallRise` (still the road-design profile)
as its mean ramp with natural variation: right bank ledge heights / positions irregular (warped ledge index, cliff foot
wandering ±35 m); left bank benches only in the irrigated-terrace belt (fields.farm terrace zone), a gullied natural
slope above; below dam 6 a natural canyon mouth (floor half width = dam neck widening / wandering per side, R6 bank
profiles continued, wall foot stepping from L6 + 0.6 m to the floor within ~380 m, floor relief + a patchy 3 m river
terrace, continuous across the dam line) replaces the straight 0.35 trench; from 1.8-2.8 km below the dam the round-2
plain profile is unchanged (G02-OUT spill channel, its water levels and the irrigation district's canals identical).
Checks: `scripts/check-terrain-sites.mjs`; previews: `scripts/preview-terrain-site.mjs map|ray`.

### urban.js (+ occupancy.js)
* `urbanSample(x,y,z, texelMeters, out)` → raster sample:
  `cls` (SurfaceClass), `coverage` (built fraction of the texel), `roofKind`, `roof` (tone),
  `height` (m, building height under the texel), `landUse` (LandUse), `light` (0..1 night),
  `lightTemp` (0 warm…1 cold), `lightOnset` (0 early…1 late at dusk), `districtTone`,
  `farmCrop`, `blockId`, `parcelId`. When `texelMeters` is large it returns area-averaged values
  (coverage etc.), never aliasing point samples.
* `generateCityTile(face, x, y)` (L13 tile) → `CityTileData`:
  `{key, face, x, y, level, center:{lat,lon,h}, buildings: BuildingSpec[], roads:[{id, cls, width,
  points:[[x,y,z]...]}], areas:[{id, kind, polygon:[[x,z]...], y}], rails:[{id, points, elevated,
  tracks}], stations:[{id, buildingId, x, y, z, heading, platformLength}], docks:[...]}` —
  geometry in the tile-local frame; contains every building whose anchor lies in the tile.
* `buildingSpecById(id)` → `BuildingSpec|null`, regenerated without global state.
* Additive (fix round 1): `generateCityTile(face, x, y, {buildingsOnly:true})` → buildings + stations only
  (identical buildings, ~½ the CPU; for far mass tiles). Rails polylines are LEVEL over every station's
  platform zone (main ±130 m, normal ±95 m, halt ±20 m, 180 m ramps) at `meta.railLevel`; `stations[].y` =
  that level (+9 m elevated). Station specs: `meta.railLevel` (m a.s.l.), `meta.railGround` (= railLevel −
  ground.entrance), `meta.trackOffset` (building-frame z of the track centreline, negative = behind the back
  facade; tracks at trackOffset ± 2.0 m, STATION_GEOM), `meta.railHead` (railGround + 0.35 / + 9.0). Water
  works (sluice_station, canal pumphouse, meltwater_pump): back facade on the water (`poolSide`/`intakeSide`
  'back'), `meta.water {level (m a.s.l.), width, dist (centre → centreline / pool centre), flow ±1 along +x}`,
  sluices `meta.sluice {up ≥ down, upSide 'left'|'right', step}`, steep banks `meta.pad {level, spread,
  retaining}`; feeder pumps `meta.servesSide`. OX4 stations / meltwater pumps / lee greenhouse rows sit at
  `hydro.iceFootSystem()` outlets (forebay pool = intake). Canyon walls (ZR2): no buildings / streets /
  fabric on fine slopes > 0.65–0.8.
* Additive (fix round 2, URBAN_VERSION urban-2.2.0):
  - **Long bridges (decision DB)**: water crossings of 300–3000 m (corridor rails / corridor roads / district
    arterials) carry, on every tile piece flagged `bridge: true`: `bridgeId`, `bridgeType` ('cable'|'arch'|'girder'),
    `bridgeSpan` (m of water), `clearance` (m above the water at mid-span), `bridgeS` [sa, sb, length] (m of this piece
    along the whole crossing, abutment to abutment), cable bridges `pylons:[{t (0..1 along THIS piece's polyline),
    h (m above deck), shape 'H'|'A', base 'island'|'pier', baseR (m)}]` (only the pylons on that piece), arches
    `archRise`. The polyline y is the deck (rises from the abutments at 3 % rail / 5 % road to the clearance; cable
    over sea ≥ 600 m: main span 0.44·span (320–880 m), clearance ≈ 42 m). Shorter crossings keep the old slab.
    `urban.bridgesNear(lat, lon, radiusM)` → `[{id, kind, type, lat, lon (mid-span), heading, span, clearance,
    length, mainSpan, deckWidth?, archRise?, pylons:[{lat, lon, h, shape, base, baseR}]}]`.
    G01 inner-bay harbour bridge `BG01` (road pieces `BG01.<tile>.<k>`, cls 'boulevard', width 34; land approaches
    carry `bridgehead: true`): cable-stayed, two A-pylons 128 m on 70 m pylon islands, main span 660 m.
  - **Waterfront (U3)**: road cls `'promenade'` (width 12, `covered: true`, `canopy: 'shade'`, `waterSide: 'sea'`;
    遮阳步廊 24 m inland of the waterline of waterfront districts); waterfront districts get ferry terminals
    (`meta.waterSide`, `pierHeading`), low public front-row blocks (park / market / community / shop rows / clinic /
    school) and heights rising inland.
  - **G01 protected port city (U1)**: `urban/harbour.js` overlay (`urban.harbourCityAt(lat, lon)`,
    `HARBOUR_CENTRES`, `harbourBridge`); the level-0 cell (0,241,130) settlement is the harbour 'city' (main station
    + metro links).
  - **urbanSample.lightPort** (decision DN): 0..1 cold-white quay / port working-light presence, coverage-preserving
    (a lit quay row anywhere in a 2–9 km texel keeps the value; L3 piers / quay aprons 1, container yards 0.8);
    rural / O-zone background light only at settlements (dark gaps between), station / civic cores warm.
  - Station rail beds never cut below natural ground (level = highest ground of the levelled zone); no buildings
    within river half-width + 15 m; no open farmland north of 70N (orbit fields too); greenhouse-row feed pumps only
    on a real canal (`meta.water`, else a dry `maintenance` distribution shed); OX1 levee settlements (dorm /
    maintenance / farm_station / cold_storage sites, `meta.levee`) beside sluice stations.
* Additive (fix round 3, URBAN_VERSION urban-2.3.0 — ids change only where stated):
  - **G01 skyline (U2)**: `harbour.js HARBOUR_SKYLINE` / `skylineAt(u, v, ds)` (exported `HARBOUR_SKYLINE` via urban/harbour.js;
    `urban.harbourCityAt` adds `peak` = storey cap, `tower` 0..1, `cluster`, `crown`, `peak0` = round-2 cap): crown CBD by the
    main station (≈ 78-storey landmark over a 35–55 cluster), a 44 and a 28 storey cluster (all three in the S05 frame), low
    west / north centres, 6–12 storey mid-rise between, 3–5 storey front row by the water. Caps / tower blocks act only inside
    the overlay (`w > 0`); the overlay weight / envelope / T and everything outside it are unchanged.
  - **OX1 basin programme (U1)**: `urban/basin.js basinProgram()` (global basin frame at the sill): sluice stations at the
    'OX1-BL1-OUT' sluices (`meta.basin 'OX1-BL1'`, `meta.sluiceIndex`, and `meta.gateX` = building-frame x of the hydro gate
    line when the house stands on an abutment beside it), work towers (`control_tower`, `meta.workTower`), white maintenance
    houses along the levee roads (`meta.levee`, `meta.white`), a low utility town (`meta.town 'OX1-BL1-T'`; dorm /
    maintenance / service_depot / water_treatment / cold_storage / farm_station, lake-shore row `meta.lakeShore`) with
    street pieces `roads[].id` 'OX1T-*' (cls 'local', 8 m). Farm blocks under the town stay unplanted; field areas are cut
    around every district site (+ 8 m); buildings never stand on canal water; outposts never on (lake) water.
  - **G02 irrigation (U3)**: districts reached by terrain-fn's `g02Farm` plain district (with fields.farm) or the R2–R6
    bench belt are FARM; bench-belt blocks ignore the slope limit and carry long contour parcels 14–22 m deep.
  - **ZR5 shores (U4)**: sea seeds of the ferry provinces look for their land side on more rings (→ waterfront districts
    with terminals / promenade); every ZR5 PORT district turns its central cargo berth into a ferry terminal (`docks` kind
    'ferry'), ZR5 INDUSTRIAL shores get one ferry landing (no promenade).
  - **U5**: podium tower plates ≥ 14 m (no office / civic floor plate < 12 m); farm field pieces are cut along their strip
    axis where the irrigation reach ends (12 m steps) → smooth farmland edges along the canals.
* **BuildingSpec**: `{ id, hash, version, province, provinceCode, zone, use, tier, style, lat, lon,
  heading, ground:{entrance,min,max}, footprint:{shape, w, d, points?}, floors, floorHeight,
  groundFloorHeight?, basement, roof, plot:{id, polygon}, block, district,
  neighbors:{left?,right?,back?}, sharedWalls:{left,right,back}, entrances:[{kind, side, offset,
  width}], occupancy, yearBuilt, meta }`. `use` ∈ `USES.Z ∪ USES.O`.
* `occupancy.js`: `windowLit(buildingHash, floor, bay, localHour)` and its GLSL twin
  `OCCUPANCY_GLSL` (bit-identical integer hash) so far and near window lights agree.

## 6. Workers
`app.workers.submit(type, payload, {priority, transfer}) → job {promise, cancel(), priority}`.
Handlers: `async (payload) => ({result, transfer})` in `src/workers/handlers/*.js`, registered in
`handlers/index.js`. Workers have the control maps installed. Transfer typed-array buffers.

## 7. Buildings
`generateBuilding(spec, lod)` (`lod ∈ 'mass'|'exterior'|'full'`) → `BuildingMeshData`
`{parts:[{material, position, normal, uv, index?, color?}], colliders?, bounds, anchors:{entrances,
floors, roof, rooms?, windows?}, stats}` in the building local frame. `'full'` adds interiors
(slabs, stair/lift cores, corridors, rooms, doors, furniture) and colliders. Material keys are the
vocabulary in `buildings/materials.js`; `getBuildingMaterial(key, app)` returns the shared patched
material. Every building must be readable as itself with outlines off: massing, roof edge,
storey lines, entrances, real window reveals, back-of-house, and use-specific structure.
Details (building-kit, additive): every part carries `index` and `color` (linear tint) and optional
`attributes {name: {array, itemSize}}` (window interior mapping / occupancy ids, far-facade data —
see `buildings/kit/README.md` §5); all parts of a building share one packed ArrayBuffer per
attribute kind (subarray views), so post with `transferList(data)` (de-duplicated); `data.meta`
optional. Worker jobs: `'building' {spec, lod}` → BuildingMeshData, `'buildingTextures' {name}`.
Main thread: `createBuildingObject(data, app)` → THREE.Group (one mesh per material, shadows set),
`createColliderMesh(data)` → invisible mesh with a three-mesh-bvh `boundsTree` ('full' colliders,
building frame) for `getColliders()`. `anchors.cameras = {street, entrance, lobby, stair, living,
back, roof: {pos, target}}` (§5 shot 07 viewpoints). Emissive in building materials uses the
lighting patch's unit (1.0 = typical lit window, × EMISSIVE_SCALE); window lights follow
`occupancy.windowLitMinute(hash, floor, bay, minute, profile)` at every LOD (same ids near & far).
Fix round 1 (building-kit, additive): material key `glass_curtain` (blue-grey coated curtain wall, iwin attributes
like `glass_window`); indoor keys carry a float `idl` (daylight factor); material colours are true mean albedos
(`norm`); batch helpers `castsShadow(key)`, `NO_SHADOW_KEYS`, `renderOrderOf(key)`, `attributeNamesOf(key)`
(kit/README §7 Batching); 'full' LOD exterior doors / sliders render open where the colliders leave the opening.
Fix round 2 (building-kit, additive): `kit/plan.js repairDoors(rooms, {roots})` is graph-based — every walkable room of
a floor is connected to the floor's stairs / street-door rooms (BFS; unreached rooms get a door to the best adjacent
reached room: same unit › common landing, never through a bath, never into another unit; doors into a stair room above
floor 0 only where they meet `stairRoom.landing` when given); `reachableRooms(rooms, roots)` exported; emitInterior
passes the street / shop door rooms as roots and reports leftovers in `data.meta.unreachableRooms`. residentialPlan
(also dorm.js): core slot = stair (2.8 m) when there is no lift (< 4 storeys), 'end' cores at the right end put the lift
column beside the flat (core.liftSide −1). Lobby fit-out: mailbox wall only for `HOUSING_USES` (residential,
residential_tower, shop_row, dorm; `emitInterior(ctx, plan, {mailboxes})` overrides), other uses get a reception desk
+ directory board. `roofDeck(b, rect, y, {holes})` leaves stair wells open under stair houses (walkable roof exits).
Material `plant` / `foliage`: physical, specularIntensity 0.22, no sheen, no alpha-to-coverage (`a2c` opt-in).
Fix round 3 (building-kit, additive): **narrow plots** (residential / shop_row / dorm, w < 9.5 m, not a house) are
`narrowPlan` point blocks (一梯一户, stair column along a side wall; `plan.narrow {stairLeft, full}`) — the old 'small'
layout (one room over a slabbed-over stair well) is gone; **shallow plans** (d − wallT − stair < 3.2 m, `plan.shallow`)
get `kit/cores.js coreLayoutX` — the switchback stair runs ALONG x against the service wall (`stair.landAt 'minx' |
'maxx'`, `endInset0/1`), no lift, service door off the ground-floor landing. Placement relative to any stair goes
through `stairFrame(stair)` / `stairPoint(…)` (emitInterior, emitAnchors' `cameras.stair`). Plan geometry changed for
those buildings (ids unchanged). **Roof exits**: emitRoof sets `plan.roof.stairHouse`; emitInterior then carries the last
flight to a roof-level floor landing and the stair-house door (`stairHouse(…, {doorU})`) opens off it (end wall at the
landing end, or the side wall beside it) — roofs of every ≥ 4-storey / podium building are walkable now (were not), so
podium towers' floors are reached from the podium terrace; a tower on a podium emits no bin store / bike racks
(`ctx.onPodium`) and is moved off the podium's core (forward, else sideways) until a 2.2 m walkway is left in front of
the podium stair-house door (`podiumParts`, shared by the near model and the massing — the tower position inside the
plot can differ from `meta.tower.x/z` by a few metres); rect towers narrower than 20 m on a podium are generated as a
slender residential block (residentialPlan) — the point-block tower plan degenerates below 20 m. Podium-tower `anchors.rooms[].floor` of the tower part were offset by the merged floor count (fixed).
Round towers: `anchors.rooms` (ground lobby + café sides, per floor corridor ring + 4 wedge flats), walkable
`cameras.living` (front wedge flat), the roof deck leaves the well open + roof-level landing. `glass_curtain` street
reflection: a near tower ring (42–75 m, 60–260 m tall) + a far ring (120–210 m) so steep up-looking reflections mirror
tower bodies. Interior mapping (`bkInterior`): mailbox wall only for occupancy profile 0 (housing); other lobbies show
a reception desk + backlit directory board. scripts/walk-buildings.mjs: `roof` result, `--floors N` (diagnostics).
Fix round 2 (buildings-z, additive): **clinic** = ring of two corridors round a daylight courtyard (light well through every
storey; the void is a plan room of kind `'lift'` named `'courtyard'`, so the interior pass leaves it open; glass walls / bands
/ garden / roof opening are the type's own geometry; narrow lots keep the single-corridor plan), sculpted drop-off canopy,
sign blade above the parapet (also in the mass LOD), ambulance bay with a parked ambulance; `anchors.cameras.courtyard` (new
key), `cameras.living` = a 2F consult room, `data.meta.clinic {ring, well}`. Riser rooms behind lifts (corridorPlan, clinic)
are kind `'shaft'` (walk tools skip them). **Sign content** helpers in `types/z_common.js` (`glyphText`, `crossMark`,
`trainMark`, `arrowMark`, `signContent`, `lightBox` (frame + recessed lit face, optional two-sided), `ledBoard` (cyan LED rows,
always lit)); `signTotem` always carries content. **Station** 'full': the shell soffit over the hall is lamp-lit plaster
with a luminance gradient, white ceramic inner walls, a stone floor whose vertex tint carries light pools under pendant
luminaires (+ wall washers, girder light lines); `z_hall.hall()` inner faces stop at the eave under a parapet (QQ-02).
**Warehouses**: `anchors.floors` = the spec's single storey; the office mezzanine is `anchors.mezzanines [{y, height, name}]`
(new additive key) + a room anchor; `shedLevels(ctx, {dockSide, raised})` / `warehouseKind(spec)` (types/warehouse.js) give
the same floor level / roof kind (flat / duo-pitch / sawtooth by hash) to the near model and the mass LOD.
Fix round 3 (buildings-z, additive): **station shells** are clad in an open-joint white ceramic rainscreen on the extrados and
on the soffits outside the hall (front visor, back overhang): `ceramic_white` modules ≈ 2.4 m (arc length of the section) ×
1.8 m with explicit UVs on the 1.2 × 0.6 m tile grid and a ± 3 % tone per module, 24 mm joints with cheeks down to
`stone_dark` joint-floor strips 50 mm in (only under the joints), aluminium nosings on the free edges, rooflight upstand frames,
valley box gutters (grating) draining to downpipes beside the facade columns, wing-edge gutters with stayed downpipes.
Station 'full' hall: inner walls `tile_wall` (indoor → lamp-lit at night, vertex falloff towards the floor), mezzanine soffit /
fascia indoor `plaster` with recessed downlights + an edge light line (floor pools follow them), in-hall stair flights /
escalator trusses indoor keys (`stone_floor`, `tile_wall` cheeks, `cabinet`), light boxes + LED boards on the paid-concourse
back wall (at grade). `types/z_common.js solarRack(b, rect, y, o)` = the kit `solarArray` layout with the cell
face 6 mm proud of its frame (clinic roof; the kit's 1 mm offset z-fights).
Fix round 2 (buildings-o, additive): O-zone storey tables follow the spec — `insulated_station` builds `floors` (≤ 3)
storeys of `groundFloorHeight` / `floorHeight` (upper decks under the vault), `pumphouse` / `meltwater_pump` with 1 storey
are compact single-height pump rooms, 2+ storeys = hall with the raised control room at `groundFloorHeight`
(`anchors.floors` = spec table; a `meta.pad` floor sits on the pad). `sluice_station` camera anchors (§5 07 O-version):
`walkway` (near abutment just downstream of the deck, looking along the deck rail across the canal: retained pool beyond
the raised leaves + the open bays' discharge below), `entrance` (duty door = 'control' entrance; ground view), `stair`
(interior flight · half landing · flight along the side-O wall, level camera beside the foot; trusted), `control` (= `living`;
inside the glazed bay opening behind the console row, through the glazing over the gate line), `back` (equipment yard,
which may now run 4.5 m past the service-side end of the pool facade; ground view), `gate`. The station no longer draws
any water: the jets of the OPEN bays are the water renderer's (`render/water/sluicejet.js` replicates `gateLayout`,
`waterInfo` and the chute — change them together). Greenhouse crops are leaf-blade plants per crop / growth stage.

## 8. Render subsystems
* **terrain**: quadtree LOD by screen-space error, tiles built in workers, skirts + shared edges,
  per-tile albedo/emission/normal textures from `world/surface.js`; `raycast`, `heightAtLatLon`,
  `isIdle`, emits `tile:add/remove`. Tile objects expose `{key, face, level, x, y, centerEcef,
  mesh, heights?, waterData?}`.
  Fix round 2 (additive): camera-first refinement — the tile chain under the camera (root → tiles of ≈ 6× the
  camera's height above the analytic ground, ≥ 40 m; L17 at eye level) is requested every frame, all levels at
  once, as single-tile jobs with absolute worker priority (−2e6 + level; roots −3e6; everything else ≥ −1e6).
  Until it has refined, the vertex shader shifts coarse tiles within 0.6 … 2.5 displayed-leaf sizes of the camera
  nadir by Δ = analytic − displayed ground height at the nadir (soft threshold 0.3–1 m, only while the camera is
  < ~8 km above ground or near / below the shown ground), so the camera never looks at the terrain from below;
  `terrain.displayShift(ecef)` → metres of that shift at a point (0 once refined; the CPU `heights` / `raycast` /
  tile objects are never shifted; `groundHeightAt` / `groundHeightCached` return the drawn ground — displayed leaf +
  shift — inside the shifted region, so props and camAltGround follow what is on screen), `terrain.chainInfo()` → `{target, depth, nadirLevel, hDisp, hTrue, hAG,
  datum}`. Steep faces (> ~46°) are shaded with an unstretched procedural rock / ice-cliff material (strata from
  the height, world-anchored 3D noise); steep tiles refine one level further. Resolved-water texels on mesh parts
  above the water level lose the water tint / gloss (dry bank colour sampled uphill).
  Fix round 3 (terrain-render, surface.js `surface-5`): **O-zone irrigation network at orbit** (§1 富氧水网呈蓝色树枝,
  QA2P-02) — texels > 150 m in O zones query the order-0 main canals of `world/terrain/irrigation.js` (same nodes / parents /
  bent segments as `hydro.canalsInTile`; uses its exports `node0, parent0, N0, DA0, outletSeg` and replicates `makeSeg` /
  `segDist` / `neighbour` — terrain-fn: keep those in sync or export them): canal lines box-prefiltered at a visual width
  max(real, exag·0.9 km·acc^0.9 ≤ 12 km) (acc = upstream node count → thin twigs, wide trunks; exag 1 from 2.6 km texels,
  log-linear to the real width at 400 m), farmland = statistical irrigated share along each main (lateral reach of its node,
  widened to the full reach at disc scales) toned lush → grown → ripening with the distance to the canal + field blocks of
  different stages (OX3 flooded paddies, OX5 orchards), no farm soil and mottled rough red earth beyond the irrigation ends;
  the urban plan's coarse farm share gives way to it from 1.6 km texels (fades out by 300 m). `orbitCanalQuery(x, y, z, texel)`
  (diagnostics). Also: G01 painted harbour tint = water's `HARBOUR_TINT` (0.016 0.100 0.165); `sampleTerrain.crevasse` →
  deep cold-blue slots + rime on OX4 ice-cliff faces (kept by the steep-face shader); OX1 basin floor (basin.js mask) reed /
  meadow belt on the lake shore, damp silt, mixed alluvium tones; the window-aggregate complement reads
  `city.farCoverage` (CITY_CFG mirror only as a fallback). Z-05: the ZR2 canyon lines (`layout.js` kind 'canyon', main stem +
  tributaries via `queryLines` / `lineParam`) are painted at orbit as a red-rock band of half-width max(true hw, exag·5.2 km
  main / 3.4 km tributaries) over the city paint (same exaggeration ramp; resolved scales keep the true canyon). Scale-dependent
  looks read the level's nominal 256² texel (`SHADE_CTX.texelRef`, set by the tile builder).
* **water**: sea / canal / lake surfaces per tile, shore foam, waves, depth colour, reflections.
* **city**: L13 city tiles → mass models (far), detailed buildings (near), interiors (on demand),
  picking (`raycast` → `{distance, buildingId, spec, point}`), colliders for walking,
  `getBuilding(id)`, `focusInfo(id)` → `{centerEcef, radius, entrances}`.
  Detailed buildings and street tiles are drawn through GPU-only batches (`render/city/batch.js`: one
  `THREE.BatchedMesh` subclass per material key, geometry only in WebGL buffers, per-instance matrix =
  building / tile frame relative to a camera-near anchor, per-camera culled multi-draw lists), so kit and
  street materials must stay batch-compatible (D5); `getBuilding(id).object3d` is always `null`. Batching
  adds two vertex-stage samplers, so city init raises `renderer.capabilities.maxTextures` (three's
  per-draw warning threshold only) to fragment + vertex units; per-stage limits are still enforced at link.
  `raycast` hits the detailed geometry (balconies, canopies) of buildings drawn detailed near the camera
  (CPU pick copy within ~450 m), the mass hull otherwise; the selection outline follows the drawn geometry.
  `getColliders(nearEcef, r)` requests 'full' around the given point wherever it is. G02 work towns
  (`render/city/towns.js`) are synthesised at the `mega.towns()` anchors (OX5, zone O, ids `OX5-G02-T<k>-<i>`,
  streamed with their L13 tile; urban's `buildingSpecById` does not know them, the `'buildingSpec'` job resolves
  them — fix round 2 below).
  Fix round 2 (city, additive): **long bridges (decision DB)** — street tiles draw only the walkable deck top of
  pieces carrying `bridgeType` (asphalt, footways, kerbs, railings, lane markings, a median barrier where the
  carriageway half is ≥ 9 m, rail slab + parapets + track, colliders); `render/city/bridges.js` (BridgeManager) collects
  those pieces from every displayed city tile (out to the mass radius, ~19 km), stitches them per (`bridgeId`, deck kind)
  along `bridgeS` in one bridge frame (a corridor crossing carries the rail and the parallel corridor road 34 m beside it with
  the same bridgeId: twin structures, the road twin's pylons on caissons inside the rail bridge's islands) and has the city worker build the whole structure (job `'cityBridge'`,
  `render/city/bridgeBuild.js`, rebuilt as more pieces stream in): deck layer 6 cm under the street deck, edge beam /
  parapet, steel box fairing (cable) or concrete box (girder / arch), piers + pile caps at the waterline (girder ≈ span/90
  spacing, cable approaches 60 m road / 50 m rail, auxiliary piers at the side-span ends), H pylons (legs outside the deck,
  deck-support + upper beam) / A pylons (inclined legs, anchorage head) on pile caps over rock-armoured oval islands
  (`base 'island'`, `baseR`, paved top, coping, service house, lamps) or caissons, semi-fan stay cables in two planes
  (deck anchors every 12 m road / 10 m rail to half the main span), arch ribs + springing blocks + spandrel columns, deck
  light heads (road: staggered like props' lamps, drawn beyond ~1.5 km where props' lamps end; rail: walkway lights) and
  red aviation lights on the pylon tops (+ mid height above 100 m). Cables and lights expand to a minimum pixel size
  (cables: coverage dither; lights: emissive × coverage, i.e. a 1/d fall-off beyond the minimum size, only at night) so fans and light rows read at 5–10 km.
  Not pickable; `city.bridges.list()` diagnostics. `city.farCoverage` → `{maxDist0, maxDist1, fadePx:[a, b],
  typicalSize, K, streamDist, truncated}`: mass visibility = smoothstep(fadePx, size·K/d) × (1 − smoothstep(maxDist0,
  maxDist1, d)); the dissolve band follows the maxTiles truncation of the streamed disc (it ends where the first dropped
  in-view tile begins) — terrain-render's window aggregate should read it instead of mirroring CITY_CFG. G02 town ids:
  the `'buildingSpec'` job (`workers/handlers/lookup.js`) tries `render/city/towns.js townSpecById(id)` (anchors from
  `sites.js`, identical specs to the streamed ones) before `urban.buildingSpecById`. Street materials: plaza / sidewalk /
  island paving is a procedural slab shader (analytic box-filtered joints, per-slab tone / roughness / tilt, wear, bevels,
  macro variation; plaza uv along the plaza's longest edge); upward street ground gets a street-canyon term (sky
  occluded by 1 − SVF, replaced by sunlit / skylit facade + ground bounce — shaded asphalt reads neutral dark grey
  instead of sky blue); park gravel paths use their own `gravel` key; rail centrelines at ±(1.435 + 0.07)/2 (inner gauge
  1.435 m: props' wheel treads should sit at ±0.7525 m). The selection rim draws only for the frame camera (never in the
  water's planar reflection).
  Fix round 3 (city, additive): **far facades** (`massMaterial.js`, program key city-mass-7) — once the window grid is
  sub-pixel the facade is the EXACT box filter of its storey / bay zones (spandrels, slab bands, mullions, window reveals
  whose depth hides glass with the view angle) instead of a flat average, so 2–6 km towers keep bands, sky-garden storeys
  and tone; coated curtain glass gets F0 0.26–0.38 (tint per building), aluminium / ceramic F0 by coverage, and the
  environment reflection is mixed with a city reflection (neighbour rings scaled to the building's height: low floors
  mirror the city, high floors the sky — far twin of the kit's BK_CURTAIN). The merged mass geometry carries a city
  far family in `facadeId.w` bits 10–15 (`massBuild.js farFamily(spec)`: glass tower white-banded / silver / round,
  crown, sail fins — mirrors `office.js` towerLayout's random stream; kit flags keep bits 0–6), and podium office towers
  get their crown (12 white blades / white louvred plant screen / frosted lantern box) and the two white sail fins as
  extra mass geometry (`massBuild.js officeTowerLayout` + `towerExtras`, same plan maths as the near model: crown tops
  identical to the 'exterior' model in Node). **Bollard light pools**:
  the `'cityBuilding'` job adds `data.bollards` (Float32Array [x, y, z, …] building frame, ground points of the kit's
  light bollards — `kit/site.js bollard()` via `bollardLine`, found by the lens-band + post-foot signature,
  `cityTile.js findBollards`; y = the draped ground heightAt(…, 1.5) + 0.14 m when the foot is within −0.6 … +1.2 m of
  the terrain — kit rows are level while plazas slope); `detail.js updatePools` draws night-gated additive warm discs
  (r 2.1 m, × the shared `uLpEmissiveScale`, like props' own light bollards) under those of the drawn detailed buildings.
  **Mass seating (QZ2-06)**: the seat target is the DRAWN ground — coarse tile height + `terrain.displayShift(ecef)` (the
  datum shift around the camera nadir) − planned ground, clamped ±240 m (was ±60 m); state channel A uses a signed
  square-root code (`tiles.js encodeSeat`, `SEAT_MAX` 250 m, cm steps near 0) decoded in the mass and mass-depth
  shaders; seat speed max(25 m/s, 3.5 × error / s). Cold start at C11: no floating far blocks at ~33 s.
* **mega**: the two megastructures with LOD; `raycast`.
* **props**: trees, street lights, trains on rail lines with timetables, ferries, vehicles, people, eVTOL air
  taxis. Trains run on the CityTileData rail polylines (D1: rail head = polyline y + 0.35 at grade, = polyline
  y on viaducts / bridges; car floor = rail head + 1.0 = platform top) and stop centred on the station building
  (x = 0) within its platform length. API: `nextArrival(stationId, solTime?)`, `trainsNear(maxDist?)`,
  `boatsNear()`, `aircraftNear()`, `wakes`, `stats()`, `cfg` toggles (trees, lamps, trains, boats, people,
  vehicles, aircraft).
  Fix round 2 (additive): pedestrians are `props/humans.js` body types (10: men / women / older / worker / youth /
  child, 1.28–1.90 m) × 3 LODs (< 30 m full: sculpted head + painted face, fingers, folds; < 110 m; < 320 m),
  skinned in the vertex shader by a procedural skeleton (15 joints, walk cycle + 6 idle poses, shadow depth
  material skinned too); outfits from a palette texture + fabric `DataArrayTexture`. Trees LOD0 = real branch
  skeletons (arc-length bark UVs, 1024×2048 bark + normal map) carrying leaf-cluster cards (LOD1 = same skeleton,
  fewer / larger cards); leaf materials fade edge-on cards (`aCardN`, `PROPS_LEAFFACE`). Night: `props/lights.js`
  keeps **20 THREE.SpotLights** in the scene (constant count, intensity 0 by day: no scene-wide recompiles) on
  the nearest lamp heads / public-entrance canopy downlights (place.js `elights`), so light pools fall on any
  patched material near the camera; farther lamps and light bollards keep additive decal pools (dimmed inside
  the spot radius). `stats().lights = {spots, radius}`. Ferries also run terminal-to-terminal lines from
  `harbour.js ferryNetwork` (props worker; reads urban `district2(key).piers / .ferry / .ferries` with kind
  'ferry' | 'landing'), in addition to the per-dock crossings and the G01 lines.
  Fix round 3 (additive): `treesNear(ecef, r = 30)` → `[{ecef (trunk base as displayed), height, crownBase, crownR,
  species, distance}]` (trees of the loaded prop tiles ≈ 2 km around the camera, horizontal distance, nearest first)
  for eye-view occlusion checks. The G01 harbour ferry line (two floating landings, ids `G01-H0/H1`) now crosses
  the basin through the S05 foreground (straight section 360 m ahead of the S05 camera, `harbour.js S05X`) with the
  eastbound ferry mid-crossing at the S05 bookmark time (constants follow the bookmark: pose 0.53127, 129.95260,
  heading 12.7, local 15:30 at 129.94351 — tell props if S05 moves); its landings avoid the urban piers
  (`district2().piers`) and approach slips along their axis. Train wheel treads at ±0.7525 m (open bogies, flanged
  wheels). No trees on the water side of water works (`meta.water`: facade → `dist − width/2`, ±12 m beyond the
  ends). Blossom foliage cards are branchlets with flower umbels (no disc cards).
* **controls**: orbit / fly / walk / focus, flyTo, back stack, pick, collisions (terrain + city).
  Programmatic poses (URL pose, bookmarks, `__MARS__.goto`, flight arrivals incl. building / mega views)
  are held at the requested position until user input: checked against the final ground (world
  `heightAt` full detail + hydro `waterAt` + walk colliders / picking hulls below), never lifted by
  coarse tiles, back at the requested pose once the scene refines (`controls.holdInfo()`). Building-view
  bookmarks go through `controls.buildingView(id, view, {lens, pitch, instant, waitMs})` (walk mode on the
  anchor's storey floor; resolves on arrival). Fly mode may dive below the water surface.
  Fix round 2: walkers stand on the FINAL ground — full-detail analytic terrain (`terrain.heightAtLatLon`,
  `Ground.walkTerrainAt`) + walk colliders / picking hulls — never on loaded tiles (walk drops, double-click walks,
  enterBuilding and the walk physics alike; the terrain system shifts the shown coarse tiles near the camera onto the
  same ground). A pose written from outside just BEFORE a controls request (flyTo / setMode / focusBuilding /
  enterBuilding / buildingView — e.g. a bookmark's provisional pose) is that request's start, processed at once; one
  written AFTER a request began ends it. Interrupted requests resolve `{arrived:false, interrupted}` with the reason:
  the input source ('pointer' | 'wheel' | 'key' | 'gesture' | 'api' | 'cancelled'), 'flight' (a new flight), 'superseded'
  (a newer focus / view request) or 'external' (a pose write). `App.applyBookmark`: the newest bookmark wins (older ones
  resolve false), building views interrupted by anything but the visitor are retried (≤ 2×) before the stored pose, and
  every false result is logged (console.info `[bookmark] …`). An eye-level pose followed by `setMode('walk')` (URL pose +
  `&mode=walk`) is held for walking like a building view. `controls.buildingViews(id)` answers for the focused building
  and for the buildings of the last buildingView / enterBuilding / getFocusInfo calls (cached focus data), refreshed in
  the background with the city's 'full' anchors (or kit anchors generated in a pool worker) — poll it. Eye-level outdoor
  views (street / entrance / back) are checked against the streamed neighbours' plan footprints (`city.findBuildings`;
  buildingView waits ≤ 20 s for the building's tile on bookmark landings, ≤ 3 s otherwise): an eye inside / against a
  neighbour, or a sight line through one below its roof, slides towards the building / round it; the result then carries
  `adjusted {moved, reason}`.
  Fix round 3: street trees count too (`props.treesNear`: the eye against a trunk / under a low crown, a trunk < 3 m in
  front of the lens, a trunk on the sight line covering the frame centre, a crown on it within 12 m of the lens; candidates
  also step back ×1.12 / ×1.25; buildingView waits for the prop tiles round the
  eye ≤ 12 s on bookmark landings, ≤ 1.5 s otherwise; a tree never undoes a neighbour fix). The single worker jobs a
  viewpoint waits on (kit camera anchors of one building, spec by id) run at priority −2.5e6 (after the terrain roots,
  before the camera chain). Bookmark landings (`opts.bookmark` with a stored pose): when the asset's own anchors do not
  provide the view — not generated within `anchorWaitMs` (bookmarks 60 s, others 45 s) or a view the asset lacks — the
  camera lands on the bookmark's stored pose (ground views re-seated only when the stored eye is not at eye level over the
  final ground; room / deck views walk, held, like kit anchors), never on the spec stand-ins or the stair → lobby → entrance
  chain (kept for UI calls without a stored pose). Results carry `source` ('city' | 'anchors' | 'spec' | 'bookmark').
  `App.applyBookmark` goes to the stored pose directly when buildingView returns false (no building data).
* **ui**: HUD (Chinese), time, bookmarks, search by ID / lat,lon / province, selection panel,
  debug layers, clean mode, capture. Fix round 1 (additive): the building panel lists the building's
  eye-level viewpoints (`controls.buildingViews(id)`, standard set until known) and flies there with
  `controls.buildingView(id, name)`; `'controls:hint' {kind:'building-loading'}` → toast; shot cards grouped
  by shot (01–09 + sub-frames, notes, lens, local time); user bookmarks store pose, solTime, subsolarLat,
  mode, `buildingId`, `use`, `view` / `viewPitch` / `viewLens` (while the camera stands at that building
  viewpoint, so revisits go through `buildingView`), `note`, `world` + `seed`. The layers panel also drives
  the pipeline's `settings.debugView` ('ao'), suspended in clean mode and captures. Building ID lookups use
  the pool's `'buildingSpec'` job (UI worker only as fallback). Automation: `__MARS__.ui.view(name)`,
  `__MARS__.ui.state()`.
  Fix round 3 (additive): the UI lookup worker (`ui/lookup.worker.js`, fallback of the pool job) runs the pool's own
  `'buildingSpec'` handler (`workers/handlers/lookup.js`; fallback `towns.townSpecById` → `urban.buildingSpecById`), so
  G02 work-town ids `OX5-G02-T<k>-<i>` resolve on every path. The 书签 panel lists `app/bookmarks.js CHECKS` (group
  `'check'`) as **验收视点**, grouped by the level in the name (`验收｜<区级|街级|建筑四面|建筑屋顶|冷启动> …`, `G0x …` →
  巨构; `format.splitCheckName / groupChecks`); search labels them 验收视点. **存视点** (building panel, `saveAllViews`)
  stores each viewpoint's ACTUALLY RESOLVED eye: `controls.buildingView` result `requested {lat, lon, alt}` + the rig's
  heading / pitch / lens at the arrival + the mode it entered (`mode` 'walk' on a floor, so controls CT1 walks a stored
  room pose) + `viewLens` (no `viewPitch`: revisits use the anchor's own pitch). Views reached from the panel in the last
  10 min reuse that arrival (`nav.recordView / resolvedView`); the rest are visited one by one (`instant`, no back entries,
  progress toast) and the camera returns to its start pose + mode (`nav.snapshot / restore`); visitor input or another
  camera request stops the tour (no return; the views resolved so far are saved). These bookmarks carry `viewSet: true`;
  revisit by building ID (`userBookmarks.forBuilding`) prefers the newest hand-saved bookmark of the building, else the
  set's street view. `nav.buildingView(spec, name, extra)` passes further buildingView options. Automation:
  `__MARS__.ui.saveViews()` → Promise<number added>, `__MARS__.ui.state().savingViews`.

### Tile water data (terrain → water renderer; owner: terrain-render)
Terrain tile objects (`tile:add/remove {tile}`, `terrain.drawnTiles()`) carry
`{key, face, level, x, y, centerEcef, mesh, minH, maxH, geomErr, texRes, size, bounds:{a0,a1,b0,b1},
n:65, heights, water, rev}` (`waterData` is an alias of `water`). `tile:add` fires when a tile enters the
displayed cut, `tile:remove` when it leaves it (a parent stays displayed until all four children are
ready; tiles may re-enter later from the cache). Displayed tiles get their textures upgraded in place
(128² → 256² / 512²): `tile.rev` then increments and `texRes`, `water.mask` / `water.maskRes` are
replaced (geometry, `heights` and the vertex water grids never change); if an upgrade finds water the
coarser build missed, the tile is re-announced (`tile:remove` + `tile:add`). `tile.water` is `null` when the tile has no water,
else (all grids share the terrain vertex grid: row-major `j*n+i`, `i` along `a`, vertex `(i,j)` at
face coords `a = a0+(a1-a0)·i/64`, `b = b0+(b1-b0)·j/64`):
```
type  Uint8Array(n*n)    hydro WaterType per vertex: 0 none, 1 sea, 2 canal/river, 3 lake/reservoir
level Float32Array(n*n)  water surface height (m above sea level); land vertices next to water carry
                         the neighbouring level (dilated 3 vertices) so shoreline quads have a surface
                         that the terrain depth test cuts at the true coastline; 0 elsewhere
depth Float32Array(n*n)  level − ground height of the vertex (m, > 0 submerged) on water and shoreline-
                         dilated vertices; −max(0, ground height) on other dry vertices (never > 0)
flow  Float32Array(n*n*2) unit flow (east, north) for canals / rivers / spillways, else 0
dist, width              Float32Array(n*n) canal centreline distance (1e9 = none) and channel width (m)
mask  Uint8Array(T*T)|null texel-resolution wet fraction 0..255 on the tile's albedo texel grid
                         (edge-centred texels, row 0 = b0, maskRes = T), for shore foam / alpha; only
                         water the mesh can draw (painted water, see below, is 0 here)
hasSea, hasCanal, hasLake, minLevel, maxLevel
```
`tile.heights` (Float32Array n·n) are the ground heights of the same vertices (the displayed mesh band
limit); on low shores (vertex less than max(2 m, 10 % of the vertex spacing) above its level), interior vertices
of the dilated band — water vertices included — whose 1-ring (±1 cell) touches wet `mask` texels (≥ 0.2) are
lowered to `level − 0.3 m` (`depth = 0.3`; fix round 2: wetness from the mask, i.e. hydro's classification, so
land below a perched river behind its levee no longer pulls levee crests down), so the visible waterline
follows `mask` instead of coarse triangles poking through the surface; `terrain.tileGridPosition(tile, i, j, h, out)` gives the render-space position of vertex `(i,j)`
at height `h` (float64 maths, floating-origin safe). The terrain albedo below the water level already
shows the bed seen through a moderate water column (sand → teal shallows → cobalt deep water), so the
water surface should add Fresnel reflection, specular, waves, foam and only a light extra absorption.
Water bodies the vertex grid cannot resolve are painted into the albedo as water (normal-map alpha
gloss ≥ 0.86 → the terrain draws a level glossy surface): canals narrower than 2 vertex spacings, and
every wet texel whose vertex quad does not have all four corners in the (dilated) `level` grid at that
water level (sub-vertex ponds and lagoons, a small lake beside a canal at another level). Contract check:
`node src/render/terrain/tools/check-water.mjs`.

### Water renderer (owner: water — render/water/*, world/sluice.js)
* One surface mesh per displayed terrain tile with `tile.water` (same 65×65 grid, every vertex at its
  water level, placed camera-relative each frame, odd edge vertices stitched against coarser displayed
  neighbours). Builds are time-sliced on the main thread (≈ 5 ms per frame, nearest first, siblings of a split
  in the same frame, typical 1–5 ms per tile); a tile that leaves the cut keeps its mesh visible until every
  pending tile overlapping it is built (hand-over: no holes while children / parents swap). `isIdle()` is false
  while builds are pending.
  Coverage = `water.mask` iso-line (0.5); occlusion = terrain depth test; log-depth bias towards the
  camera = 2 ppm of the distance + `min(geomErr, 0.15·vertex spacing, 0.25 m)` (≤ 0.01 % of the distance), so
  the surface never z-fights the painted shallows and never climbs onto quay walls / caissons (the terrain
  lowers wet shore vertices 0.3 m below the level). Canals narrower than 2 vertex spacings stay painted.
* Surface: 58 analytic waves (two swell systems / wind sea / chop / ripples, Mars dispersion) on the 4096 m
  face-plane lattice; every wave's amplitude and phase are modulated by planet-anchored regional noise
  (2–13 km, 3D noise of the planet direction: continuous across tiles and cube faces, not periodic), the
  wind-sea spectrum turns towards a regional wind direction and its strength varies regionally, so the
  lattice period / interference pattern never repeats at 5–20 km; gust patches (0.3–1 km, planet-anchored,
  drifting with the wind) + flow-advected ripples; unresolved slope variance → GGX roughness (orbit glint
  width). Foam (shore break, spillway / sluice plumes, caisson wash) uses a resolution-aware coverage
  (unresolved foam detail averaged analytically); whitecaps = breaking crests of steep wind-sea groups (a short
  white line along the crest + a fading, wind-streaked trail behind it, mean coverage calibrated); foam is
  dimmed on the night side. Polar water (beyond ~66–68°, `aWtrI` from latitude + `fields.ice`): ice floes
  (periodic Voronoi), brash ice and slush on meltwater pools / channels and the near-ice sea.
* `water.waterLevelAt(lat, lon)` → `{type, level, depth} | null` (displayed tiles, cheap).
* `water.addWake(id, pointsEcef newest-first, {width, strength, level})` / `removeWake(id)`: ribbon on the
  surface limited to ≈ 45 beams + 100 m of the track (white centre, bubble trail, Kelvin arms fading within
  ~10 beams, side vectors smoothed so turning tracks never fold; a track is cut at the first step longer than
  max(80 m, 8 beams)); props hands its boat tracks over (and hides its own strips).
* Canal sluices: gate rule `sluiceOpen(upLevel, downLevel)` in the pure module `world/sluice.js` (D2; levels
  snapped to cm, order-free, ~2/3 discharging; re-exported by render/water/tiles.js and index.js) — buildings-o
  imports it so the station's gates match the foam. Tiles from L11 take the exact sluice records of their L9
  ancestor (`hydro.canalsInTile` through the worker job `'canals'`, fetched once per L9 tile — fix round 3: the L11 query
  misses long trunk segments that cross the tile between two of the 9 samples it tests; tiles are rebuilt
  when the records arrive) and start the plume just downstream of each OPEN sluice on drawn canals; coarser tiles
  use level steps of the vertex grid (only where the higher reach is upstream: pumps get no plume). The plume
  spreads over the lower reach in metres (LOD independent). Spray: translucent motion-stretched streaks below
  the open G02 bays (spray.js).
* G02: `spillwayGateOpen(dam, bay)` (render/water/tiles.js) is the gate rule (water bay k = mega bay
  `bays−1−k`; megastructures/g02.js `gateOpen` replicates it); when `mega.spillways()` is available the
  exact chute outlets / flows are installed (`setG02Spillways`) and the G02 tiles rebuilt. Foam and
  jets below open bays (turbulent tailwater: fine ripples + rough microfacets → small glints), calm water below
  closed bays and on every reservoir surface above a dam.
* G01: swell damped inside the barrier arc (waves enter through the mouth / lock gaps), breaking
  wash along the seaward caisson faces, tidal turbulence through the mouth.
  Fix round 2 (W1 / W2 / W4): `tiles.js g01SeaState` — the swell passes the 560 m mouth and every lock whose outer AND
  inner gates are open (`lockState(i)`; replica rule in tiles.js, the megastructure layout's lock chunks installed with
  `setG01Locks(states)` → G01 tiles rebuilt only if they differ; outer-only open locks feed their chamber) and spreads in a
  diffraction fan (22° from the gap edges, amplitude ∝ 1/√width, head penumbra, slow decay); the per-vertex sheltering
  `calm` (0 on the mouth line, rising over 0.2–4 km, fetch regrowth to the west) damps only the LONG wind sea
  (λ > 3–24 m, shader) and the whitecaps, chop / ripples stay (no mirror basin), so swell, roughness and reflection change
  smoothly — no seam across the mouth; caisson wash only where a wall stands (not across the mouth / open lock gaps);
  whitecaps × (1 − calm)²; the incident swell shoals over the shelf (× 1.45 at the barrier line, e-fold 2.5 km offshore).
  The protected harbour has its own calm-water tint `HARBOUR_TINT` (material.js, linear 0.016 0.100 0.165, lighter
  azure-turquoise than the cobalt sea): driven near the camera by the per-vertex basin factor (tiles.js, written as
  −aWtrI: G01 is never polar; fades in 0.3–1.5 km inside the mouth) and by an analytic per-fragment basin mask
  (`wtrHarbourMask`: designed shore … barrier arc, half-pixel soft edges, coverage boosted at ≥ 1.5 km footprints, also
  calms the waves / glint there) at orbit / region footprints, so the basin reads from 2000 km+ inside the barrier's
  crest line (megastructures). `g01SeaStateAt(ux, uy, uz)`, `g01LockStates()` for tests.
* Sluice jets (W3, `sluicejet.js`): for every `sluice_station` near the camera (≤ 4 km; specs from 'city:tile') and every
  bay buildings-o draws OPEN (`buildings/types/sluice_station.js gateLayout`, lazily imported), a sheet in the station's
  pool frame: the brink (retained level curving down to the critical section over the sill; the sheet runs 3 cm under the
  tile surface upstream), the accelerating, thinning jet down the glacis (aerated white, Mars g), and the hydraulic-jump
  roller on the tail water (the tile plume continues downstream). Closed
  bays get nothing. Geometry replicates o_common.js `waterInfo` / gateStructure (pool side, gap, levels, bays, chute).
  The layer also publishes each station's open-bay spans (metres left of the flow from the canal centreline) at its gate
  centre; `WaterSystem._build` attaches them to the matching hydro sluice record (levels ±3 cm, ≤ 40 m) and tiles.js
  writes the tile plume below the open bays only (the reach below closed bays stays calm); the tiles under the station's
  L11 tile are rebuilt when spans arrive. (Fix round 2 also fixed the plume walk: Float32 distances re-pushed vertices on
  every path → exponential walk / failed builds on fine tiles next to open sluices.)
* Sluice jets, fix round 3 (W2): `jetProfile(Gm)` (shared hydraulics: drop, critical depth, toe speed, Froude number,
  conjugate depth), per open bay a jet sheet (glassy tongue over the sill, white water after ~35 % of the drop, roll-wave
  vertex relief, bump-mapped foam lumps) and per station ONE `jumpGrid` across the stilling basin (training wall to wall):
  white boiling roller from the plunge point (front ≤ 0.6 m over the tail water, vertex boils drifting downstream) over
  ≈ 6 conjugate depths, then a foam carpet torn into flow streaks (≤ 32 m) that the tile plume continues; cover = the open
  bays' jets spreading sideways past the 6.4 m pier ends (a closed bay leaves a calm wedge); spray streaks rise off the plunge
  of every open bay (spray.js `createSprayMaterial`, shared with the G02 spray). Uses buildings-o's pier length
  (10 m, end 6.4 m downstream of the gate line) and basin walls (zE − width … zE) — tell water if they change.
* Planar reflection, fix round 3 (W1): mipmapped target; the shader reads the reflected object's distance D from the
  mirror depth, re-projects the ray through the resolved wave normal (× 0.14 of the physical 2·tilt) at D (wavy break-up
  near the camera), and blurs it with an anisotropic Gaussian (12 IGN-jittered taps along the elevation, converging in
  stills; azimuth axis × tan(grazing) ≥ 12 %) of angular sigma 0.17 · σ(unresolved slopes of waves ≥ 0.3–3 m) ·
  (1 + 0.6 smoothstep(4, 120 m footprint)), scaled by D / (D + distance) through the projection: sharp where objects meet
  the water, far-shore towers merging into vertical streaks that fade into the sky reflection; near water keeps crisp waves.
* Foam (W6): spillway / sluice plume foam uses a flow-aligned streak texture (`wtrStreakPattern`: the three coarse
  octaves stretched 4–5× along the current on the two bracketing of eight rational lattice directions, 4096 m-periodic,
  same mean coverage as the isotropic pattern), so the plume tears into streaks along the flow downstream.
* Wakes (W5): turbulent centre spreads ≈ 5°, bubble trail ≈ 8.5°, Kelvin arms visible ~25–40 beams with echelon feathers.
* `waves.js waveHeight(face, x, y, t, swell, wind)`: CPU height of the analytic wave set without the regional
  jitter (props/cameras).
* Wave clock freezes after 24 still frames (temporal accumulation converges on a crisp surface);
  planar reflection pass when the camera is < 2.5 km above a large water body (sea / lake / wide
  canal), sky environment / analytic sky otherwise; underwater fog shells below the surface (fly mode may dive).
* Debug: `wireframe` (water grid), `lod` (tile level hue), `normals`, `objectId` (water class); none
  in clean mode.

### Megastructures (owner: megastructure — src/megastructures/*)
* G01 东海分段潮堤 / G02 南台地水阶 from `SITES` (sites.js). Geometry is generated in the system's own
  module workers (`megastructures/mega.worker.js`; one worker computes the terrain-keyed layout, the
  others receive it), per chunk (G01: 4-caisson runs, locks, abutments, mouth buoys; G02: per dam left /
  spillway / right block, switchback roads) and LOD `far` (silhouette, always resident) → `mid`
  (engineering units) → `near` (walkways, grating, railings, ladders, bolts, fenders, armour) by surface
  distance vs. projected size (sub-pixel far chunks are hidden). Vertices are authored in site-local
  metres and bent exactly onto the sphere; every chunk is placed camera-relative (anchor − origin).
* `mega.raycast(originRender, dirRender)` → `{type:'mega', id:'G01'|'G02', part (Chinese part name),
  partId, chunk, lod, distance, point}` | null (collider BVH of the displayed LOD).
* `mega.getColliders(nearEcef, radius)` → `[{mesh (geometry.boundsTree MeshBVH), anchorEcef, quaternion,
  id}]` (decks, crests, walkways, stairs as ramps, railings as walls); also pins the `near` LOD of the
  chunks around the point for ~4 s. Controls query it like `city.getColliders`.
* `mega.spillways()` → `[{id, damId, dam, bay, open, ecef, dirEcef, width, flow (m³/s), level,
  tailLevel, crestLevel, across (m along the dam axis a→b from its midpoint), lat, lon}]` — G02 chute
  outlets for the water renderer; `mega.gateStates()` → `{'G02-D1': [open per bay]}` (same at every LOD,
  replicates `spillwayGateOpen`); `mega.towns()` → G02 work-town anchors `[{id, lat, lon, y, radius,
  ecef}]`; `mega.views()` → shot 08 / 09 camera poses `{name: {lat, lon, alt, heading, pitch, lens}}`:
  `g01-300km, g01-30km, g01-5km, g01-2km, g01-300m, g01-heads, g01-ship, g01-ship-in, g01-office`
  (harbour office; `layout.G01.office.look:[x,z]` is its window direction), `g02-valley` (shot 08 opener:
  high oblique from below the escarpment looking upstream, six levels rising), `g02-down`, `g02-high`,
  `g02-ref`, `g02-dam50`, `g02-grille`; bookmarks reference them with `megaView` (app/bookmarks.js).
  `mega.raycast` results also carry `megaId`. `mega.info(id)` → `{id, name, centerEcef, radius}`.
* `mega.layout` is null until the layout arrived; `isIdle()` is false while the layout, the surface
  textures or any wanted LOD of a visible chunk are loading. Debug: `objectId` (colour per chunk),
  `wireframe`, `lod` (far blue / mid green / near orange); nothing extra in clean mode.
* Fix round 1 (additive): G01 cross-sections vary with function (full-width caissons at heads / quays /
  maintenance buildings, narrow plain caissons between), lock / abutment head complexes (head house + drum),
  mouth navigation light towers (red west / green east), lock heads with portal gantries; lock outer gates are
  mostly closed (`lockState`). `layout.G01.office` gains `radius` (harbour tower drum radius; the
  g01-office eye stands radius − 4.4 m from the axis toward `look`, 21° seaward of the tangent).
  `layout.G02.bands` = old-water-line deposit bands (chunks of kind `'band'`, one LOD) on R5 / R6;
  G02 roads draw with `mega_road` (sinks ≤ 3 m with camera distance). The `g01-5km` view (S09) is an oblique
  from the SE offing ~3.4 km from the mouth at 380 m.
* Fix round 2 (additive): **G01 orbit LOD (decision DG)** — `megastructures/orbitline.js` draws the crest of the 10
  caisson segments + 2 abutments (lock gaps / mouth stay real gaps) as a ribbon expanded in the vertex shader to
  max(true crest width, 1.6 px of the final image; px from `pipeline.pixelHeight`, so tiled captures agree), pulled
  4e-5·d + 2 m toward the camera; lit pale concrete by day, cold-white night-gated lamp rows (dotted every 96 m up
  close, averaged when sub-pixel); it fades out (stochastic, converges under accumulation) once the real crest is
  1.6–3.2 px wide (inside ~20–35 km the chunk LODs carry the barrier; hidden < 9 km). Not pickable; the protected
  harbour's calm-water tint at disc scales is terrain-render's (`surface.js harbourTint`). **Harbour office (S09c)**:
  `layout.G01.office.look` is now 25° seaward of the tangent; the red / green mouth navigation light towers stand on
  the harbour-side corner of the raised head blocks (6 m back from the end face; no longer on the seaward
  roundhead in the office window centre); office fit-out with self-lit console displays — material keys
  `mega_screen` (emissive page of the `megastructures/screens.js` atlas: `PAGE`, `screenUV(page)`,
  `generateScreenAtlas()`, made in a mega worker as texture job `'mega_screens'`) and `mega_chart` (paper chart).
  **G02 spillway sheet**: per open bay a subdivided free surface (`g02.js spillSheet`: side-wall pile-up, roll
  waves, streak ridges after the aeration inception; vertex colour r = aeration 0..1, g = pier-wall proximity,
  uv = (across, along) m) drawn by `mega_water` v3 (flow-aligned streaks scrolling at 6–17 m/s, glassy → white
  water, derivative bump). `mega.spillways()` outlets / flows are unchanged.
* **Memory residency (fix round 3, cross-module leak fixes — notes/memory.md)**: every streamed resource is GPU-only
  after upload unless the CPU reads it back, and every cache is capped (LRU + dispose). Terrain: tile DataTextures drop
  their texel arrays after upload (`texture.onUpdate`; a tile texture is never re-uploaded — upgrades make new textures,
  a lost context reloads the page), normal / morphDelta / trWl attributes drop their arrays (`onUpload`); resident cap
  `TERRAIN_CFG.cacheBytes` 1.0e9 (GPU, displayed + cached) / `cacheTiles` 1800; EMPTY quadtree leaves untouched for 600
  frames are pruned. Tile objects of evicted tiles carry `evicted: true` and `mesh: null` (additive; consumers that cache
  per-tile data must drop it — water does). Water caches hidden meshes only (≤ 320, LRU, evicted-tile meshes dropped).
  City: `GpuBatch` shrinks its GL buffers to 1/8 of the initial capacity when its last part is removed; hidden mass tiles are
  capped by JS bytes (`cacheBytes`) AND GPU bytes (`CITY_CFG.cacheGpuBytes` 320e6). Props keep ≤ 96 near CityTileData.
  Rule for new code: no CPU copy of uploaded data unless read back; no cache without a byte / count cap.

## 9. Automation & verification
* URL: `?pose=lat,lon,alt,heading,pitch[,lens]&time=15.5&bookmark=S01&clean=1&debug=province&mode=walk&select=<id>`.
  `&workers=N` sets the worker pool size (default: cores−2 for visitors, 3 in automated/webdriver sessions
  so concurrent verification runs do not oversubscribe the machine; pass `workers=8` for final captures).
* `window.__MARS__`: `ready, goto(bookmarkId|pose), setTime(h), set(key,v), pose(), waitIdle(ms),
  capture({scale}) → dataURL, stats(), bookmarks()`.
* Reference thumbnails (jpg) of every image in ../参考图: `web/.refs/*.jpg`.
* Shared dev server: `http://127.0.0.1:5173` (already running; do not start another on 5173 — use
  another port such as 5180+N if you need an isolated server).
* Screenshot + console report: `node scripts/shot.mjs --url "/?pose=...&clean=1" --out shots/<you>/x.png`
  (uses system Chrome with the real GPU). Look at your screenshots with the Read tool.
* Bookmark stills: `node scripts/capture-shots.mjs --base <url> [--only S05,S07c] --out shots/<dir>
  --width 1920 --height 1080 --query "&workers=8"` — fresh page per bookmark (cold landing), per-step
  timeouts, crashed pages replaced; `report.json` holds the final pose and stats of every still.
* Browser semaphore: when several agents work at once, wrap every command that starts Chrome in
  `node scripts/slot.mjs [--slots N] -- <command>` (default 3 browsers machine-wide; slots live in
  `.build/browser-slots`, stale slots of dead processes are reclaimed).
* Node previews: `import { initWorldNode, writePng } from './scripts/node-world.mjs'`.
* Memory soak (fix round 3): `node scripts/slot.mjs -- node scripts/memory-soak.mjs --base <url> --minutes 25 --dwell 30
  --out shots/<you>/soak --query "&workers=2"` — one page cycles a zoom ladder (orbit → 1000 km → 100 km → 20 km → 5 km →
  1 km → street → 200 m lateral) over 4 sites with lateral shifts, day / night and viewport resizes, logging
  renderer.info.memory, programs, scene objects, main heap after GC, worker heaps, per-system stats and the renderer / GPU
  process footprints (`soak.jsonl`, `soak.csv`, `summary.json` per-cycle maxima). Healthy = plateau after 2–3 cycles.
* Build check: `npx vite build --outDir .build/<your-name>` must succeed (never write to ./dist).
