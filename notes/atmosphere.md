# atmosphere — progress log

Owner files: src/render/pipeline.js, src/render/atmosphere/*, src/render/clouds/*, src/render/shaders/*,
dev/atmosphere.html, src/dev/atmosphere.js. Private port 5183 (build + preview into .build/atmosphere).

## State at resume (2026-11-16, instance N+1)
No notes file existed; previous instances left substantial, working code (committed in the
"WIP checkpoint" 2f21c71, no uncommitted diff in my files at resume).

Implemented (audited by reading the code):
- pipeline.js: custom pass graph (not EffectComposer): scene RT (RGBA16F + float depth texture, log
  depth), GTAO (half res, camera < 4 km above ground, fed back to patched materials next frame through
  a reprojection matrix, ambient only), atmosphere/cloud composite, TAA + progressive accumulation (256
  samples, variance clipping, float64 origin-delta reprojection), physically motivated exposure prior +
  metered corrections, bloom (Karis 13-tap / tent, cores clamped), output (exposure * user 2^EV, local
  exposure, AgX/ACES, sRGB, dither). capture({scale}) tiled with 64 px guard band, converged tiles, bloom
  and local exposure from an overview; PNG Blob. QUALITY presets ultra/high/medium. Settings events.
- atmosphere/: model.js (Rayleigh 8.5 km, Mie 1.5 km, ozone; SUN_ILLUMINANCE 8, EMISSIVE_SCALE 0.05),
  luts.js (transmittance, multiple scattering, SH sky irradiance atlas), frameLuts.js (sky-view LUT +
  froxel aerial perspective, camera inside atmosphere), envmap.js (sky+cloud cubemap -> PMREM, one face
  per frame), exposure.js (CPU exposure prior from LUT readback, orbit disc sampling), csm.js (4 cascades,
  4096^2, sphere fit + ECEF texel snapping), lighting.js (patch + documented GLSL API), index.js (system,
  sun light, hemi for unpatched, composite wiring, teleport exposure snap).
- clouds/: weather cubemap (2048^2, flow-advected, cyclones, fronts, veils), shape/detail 3D noise,
  cloud shadow map (local 2048^2 tangent plane / global equirect), drift with sol time; cloudPass.js half-
  res (full res while converging) cloud march with light march, multiple-scattering octaves, city glow.
- shaders/: atmosphere, clouds, composite (sky-view/AP LUT path inside, per-pixel march from space,
  stars, sun disc with limb darkening, airglow, city sky glow, orbit night-side dodge), lighting, post,
  gtao, common.
- dev bench with ~35 presets (orbit, night, limb, oblique, noon, sunset, dusk, bluehour, below/above
  clouds, cloud tests).

## Audit TODO (this instance)
- [x] build + preview on 5183 (`npx vite build --outDir .build/atmosphere --emptyOutDir` then
      `npx vite preview --outDir .build/atmosphere --port 5183 --strictPort --host 127.0.0.1`; rebuild
      while preview runs is fine). Bench batch b3-*.png: 14 presets, 0 console errors.
- [x] main app S01/S02/night118 (m3-*.png): no console errors; app not idle after 150 s (machine load
      avg ~380, workers pending) but orbit content is there.
- [~] (a) clouds: S01 cyclone = flat white disc (not clipped: ~188 sRGB) -> fixed by weather mottling +
      far-field relief shading (see log); scattered sea clouds OK.
- [x] (b) night lights from orbit: visible (m3-night118: warm networks with white cores). In S01 the
      night limb shows smeared gold streaks = coarse terrain emission foreshortened + 6x dodge -> dodge
      max lowered to 4.5x. Emission sharpness is terrain-render's (request in report).
- [x] (c) capture: previous instance verified 1280x720 -> x2 2560x1440, x4 5120x2880 (cap-sunset-*).
      Settings exposure/bloom/taa/shadows/pixelRatio/quality handled in pipeline 'settings' listener.
- [x] build check (`npx vite build --outDir .build/atmosphere` OK), superseded shots removed (kept the
      evidence set listed below), preview server on 5183 stopped, final report delivered (02:58).

## Log
- 01:40 weather gen: cyclone centre smaller/less solid, arms with clearer gaps; inside systems the
  coverage is thinned by billow mottling (0.5..1) -> broken interiors (mean coverage 5.3% -> 4.2%).
- 01:55 cloud shadows verified working (shadow-only render c2-regional-shadowonly.png); they are mostly
  hidden under the clouds themselves from orbit (offset 8 km/tan(elev)).
- 02:05 cloudPass: far-field relief shading (lpCloudRelief: weather top field as bump map along the
  sun's horizontal direction, only where the far-field weight fk > 0) -> orbit/regional clouds read as
  3D heaps instead of flat snow (c3-orbit, c3-4500, c3-regional).
- 02:15 composite: orbit night-side dodge max 6x -> 4.5x (lighting.js doc updated).
- 02:20 pipeline: once accum.n > quality.samples, only the scene pass runs (change detection) and the
  converged history is re-displayed (no AO / cloud march / TAA) -> GPU quiet on finished stills.
- 02:30 composite dodge split: the surface behind gets its own factor, the cloud layer in front uses
  the sun at the cloud point + 0.075 (sunlit cloud tops along the terminator are not lifted).
- 02:35 data debug layers (debugLayer != 'none' and not clean): clouds + cloud shadows off, aerial
  perspective x0.25.
- 02:40 main app (lead's new S01/S02 bookmarks): S02 night hemisphere reads like A02 (m4-S02.png);
  S01 clouds textured with relief (m5-S01.png). City 1.5 km pm/dusk (m5-city-*.png): patch lighting,
  CSM shadows, haze OK. Dusk road glow is in the terrain emission texture (identical with bloom off,
  m6-city-dusk-nobloom.png) -> request to terrain-render.

## Evidence kept in shots/atmosphere/
f-*.png (final bench batch: orbit, nightSide, terminator, noon, sunset, bluehour, cgndSun, below,
above, regional), c3-*.png (relief shading), c2-regional(-shadowonly).png (cloud shadows), m3-S01 /
m3-night118 (before), m4-S02, m5-S01, m5-city-pm/dusk, m6-city-dusk-nobloom (main app),
cap-sunset-x1/x2/x4.png (capture 1280x720 -> 2560x1440 -> 5120x2880), b3-weather-*.png (weather map).

## Remaining (for a next instance / QA)
- Static full-res cloud frames are heavy on the shared GPU (bench: 300-680 ms GPU per frame through
  dense decks while converging); converged stills now idle. Could march fewer steps per static frame.
- Far-field relief is a bump-map approximation; cloud shadows from orbit are mostly hidden under the
  clouds themselves (offset = 8.25 km / tan(sun elevation)).
- Sunlit clouds just beyond the ground terminator glow orange in S01 (physically motivated, may read
  as embers at small size).

## Fix round 1 (2026-11-16, private port 5204, build .build/atmosphere)
Defects: ★1 ground bounce on down-facing surfaces, ★2 night side too bright/flat at orbit, ★3 white
concrete pinkish (sky irradiance tint), 4 static cloud march cost, 5 atmosphere.isIdle never converging,
6 local soft glow of clouds over light cores.
### Done (code, verification pending)
- ★1 SH LUT is now SKY ONLY; ground irradiance row packed into the atlas (x 256..319, y 0);
  lpGroundBounceN(n, cloudT) = uLpGroundAlbedo * E_ground(mus) * (1-n.up)/2, inside the AO-multiplied
  ambient (LP_INDIRECT) and lpSkyIrradianceN. uLpGroundAlbedo = land cover at the camera from
  world/fields.js (urban grey 0.11, farm green, red rock, ice, water; planet average with altitude),
  eased while moving, snapped on still views. Cloud bases / env map add the bounce explicitly.
  Probe (noon): down-facing irradiance 2.35,1.19,0.63 -> 0.91,0.79,0.69 (city), shaded vertical wall
  1.39,0.94,0.90 -> 0.70,0.81,1.07 (blue shade).
- ★3 Rayleigh x1.2 (6.54,15.18,34.8 e-6), SUN_COLOR 1,0.955,0.905 -> 0.98,1,1.03: noon horizontal sun+sky
  R/G 1.097 B/G 0.918 -> ~1.03 / 0.985; low sun stays warm (R/G 1.17 at 15 deg).
- ★2 NIGHT_AMBIENT 0.034,0.040,0.056 -> 0.018,0.026,0.056 (cooler, -1/3 lum) + directional night term
  (40 %, from the sun azimuth at ~35 deg) for relief. Orbit exposure LOCKED (prior.lockK, >= 600 km:
  one day baseline 0.75 x noon, no metered corrections, no local exposure); night side lifted by the
  composite dodge to nightOrbitExposure 5.0 (uDodgeMax 4.5 -> 14).
- 4 cloud pass: static view -> full-res first frame, then interleaved 2x2 (1/4 pixels per frame);
  pipeline.accum.viewStatic (scene-content resets keep the view static).
- 5 pipeline.converged also true after 3x converge static frames + 2.5 s when animated content keeps
  restarting the accumulation.
- ★3 follow-up (06:00): S07 front (all shade) read too blue -> Rayleigh x1.12 (6.10,14.17,32.5 e-6),
  Mie haze x2.3 (scat 1.05e-5, abs 0.55,0.78,1.32 e-6: whiter sky irradiance, warm horizon), city bounce
  0.118,0.104,0.09. Bench (b-*.png): ceramic boxes neutral grey in shade (were pink-beige, f-noon.png),
  balcony undersides taupe over red rock / grey in cities, sunset still warm, clouds white.
- ★2 follow-up: composite also lifts the night-side shell beyond the limb (airglow) with the dodge
  (stars / sun disc not), so the locked day exposure keeps the faint night limb.
- 6: lpCityGlow blur 2.5/4.5 mips (~60-240 km) -> 1.5/3.0 (~30-80 km): glow stays local to the cores.
- ARCHITECTURE.md §3 lighting-patch + nightDodge lines updated (local ground albedo, locked orbit exposure).
- 06:50 night directional term 35 deg/40 % -> 25 deg/50 % (+-10 % per 5 deg slope; dirK clamp 2.2): m1-S02
  showed the right mauve-brown hue but too little relief from orbit.
- pipeline: exposure.settled threshold 0.03 -> 0.05 EV (meter noise of animated scenes flickered it).
### Verification (m1-*.png, one probe session, 1600x900, workers=2)
- m1-S01/S02/TE90/TW90: exposure 0.5896 in all four (locked baseline, lockK 1); S02 sunrise limb no longer
  blown out, night side lifted by the dodge (x8.5), lights pop on dark mauve-brown ground. Night ground
  HDR (pre-dodge) ~0.0020,0.0011,0.0010 (R:G:B 1:.55:.49, was 1:.45:.26).
- m1-G01-noon-300m / -2km: G01 concrete reads white/neutral grey at noon (was beige-pink); m1-S09 dusk warm.
- m1-S07 (front, all shade): cool light-grey facade, balcony/canopy undersides neutral (were saturated
  orange); m1-S07d: sunlit white ceramic white, shadows cool grey. No console errors in the session.
- S02 with cloudCoverage 3: no cloud formed over the measured cores -> glow inconclusive (item 6).
- idle watch failed (script bug: helper not defined) -> redone in m2.
### Verification (m2-*, b2-*, b3-*)
- m2-S02 (night term 25 deg / 50 %): relief slightly more legible, lights pop, exposure 0.5896 locked.
- item 5 idle watch (scripts/atmo-probe.mjs + __idleWatch): 400 km DAY over ZR1 -> atmosphere idle
  after 3.2 s (n=68), again 2.6 s after a scene-content restart; 1 km oblique DAY -> idle after 8.5 s via
  the static-view rule (n kept restarting: 160 worker jobs pending / animated content). Was "minutes".
- item 4 cloud A/B on the bench (gpuMedian ms while converging, full vs interleaved): per-PIXEL 2x2
  interleave saved nothing (covercast 288/312, below 367/355, ctop 594/585) -- GPUs shade 2x2 quads in
  32-wide SIMD groups, so one live pixel per quad still runs the whole march. Changed to 8x8 TILES
  (one tile of each 16x16 block per frame) at 07:10; b3 A/B queued behind other fixers' browsers.
  Per-pixel images (b2-*-il.png) show no artefacts; the tile variant marches the same static view.
### Remaining / known issues
- item 4: tile-interleave speed-up not yet measured (b3 benchmark never got a browser slot before the
  time-box; cancelled 07:32). Final build OK (.build/atmosphere), preview server on 5204 stopped.
- item 6: cloud glow over light cores is local now (30-80 km blur, e^2) and ~0.24x the area-averaged
  city radiance from orbit (physical estimate ~0.3x), but no cloud formed over the measured S02 cores, so
  it is not visually verified on a real core.
- S07 street still deep blue (asphalt + blue sky reflection; road material is city's / props').
- Moving-view cloud march (half res, 0.6 budget) still ~60-130 ms through dense decks.
### Helpers
- scripts/atmo-probe.mjs: open the app (or a dev bench), eval JS, --seq steps.json [{eval, idle, wait,
  out}] in ONE browser (one slot for many checks); prints JSON results.
### Requests (fix round 1; none blocks the atmosphere fixes)
- city / props (whoever owns the street asphalt): at S07 the road reads deep saturated blue (dark bluish
  albedo + glossy blue-sky reflection); a neutral dark-grey asphalt (~0.08-0.10, roughness >= 0.7)
  would match the now neutral daylight.
- terrain-render (optional): night relief from orbit comes from the terrain normals under the new
  directional night light (sun azimuth, 25 deg); a little more macro-relief in the orbit-LOD normals
  would bring S02 closer to A02.
- custom ShaderMaterials that include lp_lighting_pars and copy app.lighting.uniforms get the new
  uniform uLpGroundAlbedo automatically; ones that list uniforms by hand should add it (else the
  ground bounce is black, nothing breaks).

## Fix round 2 (2026-11-16, private port 5305, build .build/atmosphere)
Items: ★A1 street-level night (QQ-05), ★A2 blue-hour sky (QQ-07), ★A3 far-cascade shadows (QQ-01),
A4 WebGL context loss (QA-ID-05), A5 GTAO halos (QQ-12), A6 orbit day exposure (QQ-14), A7 debugView 'ao' grey.
### Log
- start: read ARCHITECTURE, brief §5/§6, qa-round1, round2 backlog, evidence (A-C02-0000, A-C04, B-S06blue,
  B-S08-C + crops, mont-ao). Plan: A1 = ground-level night regime (exposure cap +2 EV over the noon prior,
  emissive unit raised by the same factor at night so lights keep their look, night ambient lower/less
  blue near the ground, no local exposure at night); orbit regime (>= ~60 km) bit-identical to round 1.
- 12:40 S08 baseline (b0-S08 / b0-S08-noshadow / diff): the striped "acne" and the ruler-straight edges below
  the lowest dam are present WITH SHADOWS OFF -> terrain relief (regular ridges self-shaded by N.L at a 12 deg
  sun) and the straight-walled tailwater cut of the G02 landform (terrain-fn geometry); the CSM adds only the
  ridge cast shadows (diff). CSM still improved per item: slope-scaled bias (receiver geometric normal,
  kernel radius), cascade range 2.6 km + 9 x height above ground (<= 30 km; S08: 20 km instead of 7.8 km).
- 12:55 A1 code: exposure.js ground night cap (+2 EV over noon, soft-min p=4, groundK 4->60 km above ground,
  emissiveGain -> uLpEmissiveScale every frame, initial value = ground-night unit for value copiers),
  NIGHT_AMBIENT_GROUND, near-camera night light mostly dome (wd 0.15 within 1.5 km .. 0.5 beyond 20 km),
  local exposure off at night, sky / cloud city glow x gain. A2: sky glow gated to sun < -4..-14 deg,
  horizon-weighted (zenith 6 %). A4 context loss, A5 GTAO thin filter, A6 orbit +0.8 EV, A7 grey AO view.
- 13:05 first n1 probe never got ready: a backtick inside a GLSL comment (template literal) broke
  lighting.glsl.js -> fixed. A2 analysis (scratchpad ss.mjs, single scattering): with ozone R = 0.65e-6
  (680 nm value) the twilight zenith is magenta (R/B 0.90); R = 2.2e-6 (Chappuis band in the red channel)
  gives blue-violet (0.53/0.62/1.0) over an orange horizon, noon unchanged -> applied (+ SUN_COLOR red +2 %).
- 13:20 n1 (S06 / C04, A1 code): street night now artificial-light dominated (C04 plaza 34,46,78 -> 6,6,11,
  hall glow kept, lamp pools visible at S06), but (a) the GPU meter's "dayness" test keyed on physEV saw
  the capped night EV (0.84) as day and lifted it +1 EV (ev 1.88) -> dayness = min(old, 1 - nightK);
  (b) S06 sky black at sun -6.8 deg even without glow: the model's twilight at -6.8 is ~200x below the
  lights at any night exposure -> blue-hour lift: uLpSunE x twilightGain (1 by day, up to 7x once the sun
  is ~6 deg down, ground regime only: sky, sky irradiance, AP, clouds, reflections stay consistent; direct
  sun already set) and the night cap only engages from sun -4 deg (complete at -12): sunset / dusk / blue
  hour keep the round-1 exposure. NIGHT_AMBIENT_GROUND -> 0.020,0.025,0.040 (round-1 luminance, less
  blue: plaza ~14,17,26 instead of near black).
- 13:45 n2a (meter fix, twilight 7x): C04 ev 1.00 (+0.17 meter over the capped 0.84; metered noon was
  -0.80 -> lift 1.8 EV), plaza near black (old NA_ground; now raised), hall glow kept; S09 (sun -1 deg) ev
  2.89, unchanged character (pink-orange horizon band, alpenglow, blue water); S06 ev 2.50: sky no longer
  brown but greyish lavender (133,137,146 top -> 168,156,134 horizon) and facades too bright -> twilightMax
  7 -> 3 and a sky-only chroma lift at twilight (skySaturation 1 -> 1.75, composite uSkySat; 1 by day).
  vite build failed on another module mid-edit (lookup.js imports iceFootSystem missing from hydro.js) ->
  retry at the end.
### Requests (fix round 2)
- terrain-fn: QQ-01's S08 "acne stripes" and "ruler-straight shadow edges" are terrain, not CSM: with
  shadows OFF the same stripes (regular ridges a few tens of m apart on the slopes left of the lowest dam,
  self-shaded by N.L at the 12 deg sun) and the same straight edges (straight-walled tailwater cut below
  the dam, flat floor lit / walls dark) remain (shots/atmosphere/fix2/b0-S08*.png + diff). Vary / soften
  the ridge pattern and give the tailwater cut natural, irregular walls.
- props: glow sprites / light pools copy uLpEmissiveScale's VALUE at init (props/materials.js:540-541).
  It works (the value before the first frame is the ground-night unit), but bind the shared uniform object
  instead (uScale: app.lighting.uniforms.uLpEmissiveScale) so pools follow the night regime exactly.
- terrain-render (optional): cast shadows end at the CSM range (2.6 km + 9 x height, <= 30 km); terrain
  self-shadowing beyond it (per-tile horizon angles along the sun azimuth) would carry ridge shadows to
  the horizon in high oblique views.
- lead: S06 at local 19:09 (sun -6.8 deg) now reads as blue hour through the twilight lift; if a brighter
  sky is preferred, local ~18:58 (sun ~-4.5 deg) is the model's "classic" blue hour.
- 14:05 n2b (one session, 0 console errors / page errors): S08 ev 0.68 (b0 0.66: day unchanged), extended
  cascades add escarpment / terrace cast shadows 8-20 km out (n2-S08-vs-b0 diff; the terrain itself also
  differs between the runs: LOD / other fixers); C03 ev -0.21 (QA -0.24: day street unchanged), grey AO view
  (n2-C03-ao), mullion-top AO blobs now small faint dots (c-n2-C03-mullion vs QA mont-ao); S01 ev 0.04
  (= -0.76 + 0.8), land 150,117,109 -> 171,142,135, silver city 148 -> 170, cloud tops 143 -> 168, max px
  244, 0 px >= 250 (no clipping); night side unchanged (night-light crop 20,12,12 vs 20,15,17; dark sea 5 vs
  3); S06 (twilight 3x, sat 1.75) sky top 91,97,111 -> horizon 140,112,49 (old 96,75,72 brown -> 125,94,73),
  facades dark blue-grey with lit windows and lamp pools; C04 ev 1.00, hall glow 84,77,67 (old 82,77,74),
  plaza 2,3,6 (too crushed) -> NIGHT_AMBIENT_GROUND 0.040,0.050,0.070 (2x round-1 luminance through the 4.5x
  lower exposure: plaza ~13,17,25 expected); S06 sky gets an elevation-weighted blue-violet tint above the
  horizon band at twilight (composite, sky pixels only, 1 by day).
- vite build --outDir .build/atmosphere: OK at 13:50 (an earlier failure was another module mid-edit).
- 14:20 final: last tweak (NIGHT_AMBIENT_GROUND 0.040,0.050,0.070 + twilight sky tint) is code-reviewed and
  built (vite build OK 13:58) but NOT screenshot-verified: the n4 screenshot timed out (load 156) and n5
  waited > 18 min for the single machine-wide browser slot -> stopped. Earlier sessions (n2a / n2b, all the
  other round-2 code) had 0 console errors. Private dev server on 5305 stopped; no browsers left running.
### Status
- ★A1 done (C04 ev 1.00 = +1.8 EV over the metered noon -0.80; plaza / facades dark, lights unchanged);
  ★A2 done (S06 sky blue -> orange instead of brown; final tint unverified); ★A3 done for the CSM part (the
  S08 stripes / straight edges are terrain, see Requests); A4-A7 done (A4 not exercised: no way to force a
  context loss in the shared GPU session without risking other fixers' browsers).
- Evidence: shots/atmosphere/fix2/ b0-S08* (baseline + shadows off + diff), n2-S08 / n2-S08-vs-b0, n1/n2-C04,
  n3-C04, n2/n3-S06, n2-S09, n2-C03 / n2-C03-ao / c-n2-C03-mullion, n2-S01.

## Fix round 3 (2026-11-16, private port 5305, build .build/atmosphere)
Items: ★A1 cloud clock (QP-08), A2 orbit day disc grey (QQ-14 partly), A3 one screenshot each S06 (local 18:58) / C04.
### Log
- 20:45 start: read qa-round2 / qa-round1 texts, evidence (qa2-shots/cap/S01, cap2/S06 19:27 = new 18:58 bookmark with
  my round-2 final code, cap3b/C04). Machine load ~85, both browser slots busy (qa2-shots chain3, props).
  A1 plan: cloud time = state.solTime (0..24, a pure function: same time -> same clouds); the sol wrap is
  made seamless by a coverage-space dissolve over the sol's last hour (23..24) into the next sol's phase
  (cloud time solTime - 24 == the field at solTime 0): second weather / shape / detail fetch only while
  uCloudMix > 0. No bookmark has solTime in 22.53..24 (S01 22.533 is the latest), so every bookmark keeps the
  look of a fresh page load. A2 plan (Node AgX twin on the QA S01 pixels): orbit look in the output pass
  (uOrbitLook = exposure lockK): one-sided log contrast x1.12 above -2 EV (deep shadows / night side only
  shifted), saturation 1.20 -> 1.32, soft display shoulder from 0.84 (cloud tops <= ~245), orbit lift
  0.8 -> 1.1 EV. Predicted S01: ZR4 city 179 -> 193, land 139 -> 150 (sat .32 -> .35), cloud max 214 -> 227,
  a 244 px -> 243, night ground unchanged.
- 20:55 A1 code: clouds/index.js syncTime = pure function (exported cloudClock(solTime) -> {cloudTime = wrapped
  solTime, mix = smoothstep(23, 24, t)}, cloudPhase(t) -> rot / offA / offB); phase 2 uniforms uCloudRot2 /
  uCloudOffA2 / uCloudOffB2 / uCloudMix in lighting.js, cloud pass, shadow pass, env map (frozen per refresh);
  clouds.glsl.js: lpCloudBase blends the weather (coverage space) + shape noise, lpCloudDetail the detail noise
  (variance-preserving mix) only while uCloudMix > 0; lpCloudWeatherP(p, fp) for the far-field relief and
  lpCloudCoverage; weatherAt() blends too. Node test (scratchpad cloudclock-test.mjs): 15 -> 3 -> 15 and 2000
  random histories (incl. unwrapped / negative inputs) == fresh evaluation (diff 0); wrap 24 -> 0 continuous
  (dominant phase diff 2.6e-6 at e = 1e-4 h); dissolve starts with zero slope; all 44 bookmarks mix 0 and
  cloudTime == solTime (old clock: 15 -> 3 -> 15 gave -9).
- 20:57 A2 code: post.glsl.js agx() orbit look (uOrbitLook = pipeline._lockK x settings.orbitLook): log slope
  x1.14 above -2 EV, below it u*exp(u/2) (dip <= 0.1 EV, deep shadows / dodged night side unchanged), sat 1.32,
  per-channel tanh shoulder from 0.84 (grey max 245 at lockK 1); exposure.js orbitLift 0.8 -> 1.1. Build OK.
- 20:58 one probe session queued/started (TE0 15 -> 3 -> 15 pair, TE0 23.5 dissolve, S01, S06, C04).
- 21:10 probe session 1 (one browser, 1600x900, workers=2): TE0 time 15 -> 3 -> 15 pair (fix3-TE0-t15-a/-b,
  overlay fix3-TE0-t15-a-vs-b.png): clouds coincide (no red/green fringes), region diffs equal everywhere
  (clouds 3.8 / city 3.2 / land 4.3 mean = TAA / refinement noise, mean luma within 0.6), cloudTime 15 both
  times. A2 orbit look, QA2 round-2 frames -> fix3 (same bookmarks): TE0 ZR3 city p50 185 -> 200 (p90 209, max
  226), land 123 -> 133 (sat .34 -> .38), clouds p50 194 -> 205 / max 213 -> 226, max channel 231, terminator
  unchanged; S01 (lead's recomposed bookmark: terminator now through ZR1 west, two night cores) ZR4 city 179 ->
  194 (p90 212, max 227), land E 147 -> 165 (sat .27 -> .33), clouds max 214 -> 227, 0 px >= 250, night ground
  unchanged (p50 1, max 41 -> 43). fix3-TE0-t2350 was a wasted check: TE0 is on the night side at 23.5 (no
  artefacts, lights fine) -> dissolve / wrap to be re-checked on TE180 (day side at solTime 23-24).
- 21:20 A3: fix3-S06.png (local 18:58, sun -4.5 deg, ev 3.01, not idle: 559 jobs) = blue hour: sky top
  130,141,173 (blue-violet) over a warm horizon 182,171,142, facades / city 59-77 (dim blue-grey, sky ~2x
  brighter than the facades), warm windows + street lamps, cliffs dark red. fix3-C04.png (local 21:30, ev 1.00,
  emissive 0.212): plaza 12,17,24 (expected ~13,17,25 from NIGHT_AMBIENT_GROUND 0.040,0.050,0.070), lamp pools
  ~93, hall vault 84, dark facades 6, sky top 9,4,2 with stars, warm glow only at the horizon (35,23,12):
  artificial light carries the night. Both frames are pixel-identical in these regions to the QA2 captures
  (qa2-shots/cap2/S06 19:27, cap3b/C04, qa2-quality/A/A-C04) -> the QA2 runs already had the round-2 final
  ambient / sky tweak. Session: 0 console errors, 0 page errors (TE0, S01, S06, C04).
- 21:22 probe session 2 queued: TE180 (day side at solTime 23-24) at 23.999 / 0.000 (wrap continuity) / 23.5.
- 21:22 probe session 2 (TE180, day side at solTime 23-24; first attempt hit a dead preview server -> restarted):
  fix3-TE180-t23999 vs fix3-TE180-t0000 (cloudMix 0.999997 vs 0): mean diff 1.6 / 1.9 % px > 12 = noise level,
  i.e. the 24 -> 0 wrap is seamless (overlay fix3-TE180-wrap-overlay.png); fix3-TE180-t2350-dissolve (mix 0.5):
  one coherent, slightly thinner / wispier field mid-dissolve, no double image, no artefacts. Noon disc (TE180
  t0): land 213,160,140, city 206, clouds max 232, 0 px >= 250. 0 console / page errors.
- 21:25 final: vite build --outDir .build/atmosphere OK; preview on 5305 stopped; no browsers left. Node test
  copied to shots/atmosphere/fix3/cloudclock-test.mjs (ALL PASS).
### Status
- ★A1 done + verified (Node: pure function / 2000 histories / seamless wrap / bookmarks; browser: TE0 15 -> 3 -> 15
  pair identical at noise level, TE180 23.999 vs 0.000 identical, dissolve coherent).
- A2 done + verified (TE0 / S01 city bands 194-200 p50, p90 209-212, land +10-18 luma with more chroma, clouds max
  226-227, no clipping, night side unchanged).
- A3 done (fix3-S06.png blue hour, fix3-C04.png night; values above).
- Evidence (shots/atmosphere/fix3/): fix3-TE0-t15-a/-b + fix3-TE0-t15-a-vs-b (A1), fix3-TE180-t23999 / -t0000 /
  -wrap-overlay / -t2350-dissolve (A1 wrap), fix3-S01, fix3-TE0-t15-a (A2), fix3-S06, fix3-C04 (A3),
  fix3-TE0-t2350-dissolve (night side, no artefacts), cloudclock-test.mjs.
### Notes for the lead (no request blocks these fixes)
- Bookmarks: keep bookmark sol times out of 23.0-24.0 (the cloud dissolve hour; today none is there, S01 22.533
  is the latest). Captures made before this round through a goto chain could show history-shifted clouds
  (e.g. qa2-spot TE0 had a different cloud field than a fresh load); recaptures now always show the fresh-load
  field of the bookmark's sol time.
- QZ2-05 ("复核 30 km 高度的夜间曝光提升"): checked, unchanged. At 30 km above ground at deep night the ground
  regime is half engaged (groundK 0.55): exposure EV 1.76 x emissive gain 2.22 = effective emissive exposure ~7.5,
  the round-1 night value (orbit night side: 5.0 through the dodge), meter up-cap 0.3 EV there. The uniformly lit
  district outlines / street grid are the emission data (terrain-render); if the lead wants regional night views
  dimmer, blending the night exposure from ~7.5 (ground) to 5.0 between ~10 and 60 km is a one-line change in
  exposure.js (not done: not in this round's items, changes regional night shots).
