# buildings-z — Zhurong public & commercial building family — progress log

Owner files: src/buildings/types/{clinic,school,market,station,ferry_terminal,research,office,civic_tower,
warehouse,port_shed,community}.js, src/buildings/types/z_*.js (helpers), dev/buildings-z.html, src/dev/buildings-z.js.
Private port 5193 (dev server, hmr off: `npx vite --config .build/buildings-z/vite.config.mjs`) — restart after edits
(watch disabled). Screenshots: shots/buildings-z/.

## Status
- 14:10 start (fresh, no previous notes). Read ARCHITECTURE, prompt §1/§3/§5/§6, kit README + kit sources,
  residential/generic types, urban specs.js/builders.js (what each use carries), materials vocabulary.
- 14:29 private dev server running on 5193 — kill when done.
- ~15:03 previous instance interrupted. Written by then: z_common.js, z_curtain.js, z_hall.js, z_station_geom.js,
  station.js, clinic.js, school.js, community.js, bench (src/dev/buildings-z.js, dev/buildings-z.html).
- 18:01 RESUMED (second instance). Node check (scratch zcheck.mjs over the bench specs): station/clinic/school/
  community generate at all LODs without errors; market/ferry_terminal/research/office/civic_tower/warehouse/
  port_shed missing → generic fallback (civic tower generic 'full' = 13 M tris!). Restarted private server (pid 82172).

- ~19:03 second instance interrupted (notes not updated after 18:01). Files then present: office.js, research.js
  (wrapper), civic_tower.js, warehouse.js, z_tower.js, z_curtain.js (updated); shots ct_*, of_*, glass_row.
- 23:01 RESUMED (third instance). All owned files pass `node --check`; missing: market.js, ferry_terminal.js,
  port_shed.js. Private server pid 88640 (started by previous instance) still on 5193.

- 23:10–00:05 (third instance): wrote market.js (colonnade + shop band + white ceramic vault nave with clerestory,
  glazed gable fans, stall grid, service band with loading bay), ferry_terminal.js (glazed 2-storey hall, terrace slab
  with stair well, floating rounded canopy on columns + pins, boarding walkway + gate portal), port_shed.js (shed()
  with quay doors at grade, yard docks, vault, glazed gables, container/pallet floor). shed(): docks kept clear of the
  office annex, second dock run (backDocks), clear height from raw spec.floorHeight (kit clamps _fh ≤ 7), vault massing
  on the near curve + closed gable ends. hall(): roof.parapetSides, roof.tint, noFloor. z_common: straightStair,
  slabWithHoles. Bench: harbour basin between hall and shed rows + ferry pier stand-in.

## Decisions
- Station track geometry (urban parcels.js): building centre is `off = (elevated ? 11/2+4 : 16/2+6) + d/2` from the
  track centreline, track along local x behind the back facade → track centre z = −off. Assumed 2 tracks at ±2.0 m,
  platform edge 1.60 m from track centre, rail head = track ground + 0.35 (at grade) / ground + 9.0 (elevated deck,
  RAIL.elevatedHeight), platform top = rail head + 1.0 m. Exported as STATION_GEOM from types/z_station_geom.js
  (request: city/props agents use the same numbers; suppress corridor fences over platform lengths).
- Plan-first via kit PlanModel + assemble passes for corridor buildings (clinic, school, community, research,
  low office); custom geometry for halls/sheds/stations/towers; curtain walls via own helper (z_curtain.js).
- Window bay ids: bay = floor((perimeterU(side)+u)/plan.bayW), floor index as mass shader → massing uses the
  same floorH/groundH/bayW so far/near lights agree.
- Towers ('office' podium towers, civic_tower): 'full' = real interiors only on lobby / podium / sky-garden floors;
  other floors keep interior-mapped glass (no empty transparent floors), slabs + cores + stair colliders everywhere.

## Done
- station (at-grade / elevated Z03 arch / halt), clinic, school (+ L gym wing), community (+ kiosk / pavilion / clubhouse)
- helpers: corridor plan, public openings, hall/shed kit (walls+roofs flat/vault/gable/sawtooth, roller doors,
  dock levellers, entrance steps), curtain walls, lofted fins.

## Remaining
- office, research, civic_tower, market, ferry_terminal, warehouse, port_shed
- bench: verify views for every type; perf table per type/LOD
- visual verification of all types; build check

## Verification
- (in progress)

## 4th instance (resumed 01:05, Nov 16)
- 01:05 RESUMED. All owned files pass `node --check`; every bench spec generates with its own generator at all LODs
  (no generic fallback, no errors; Node: scratchpad/bz4/zcheck.mjs). Private server restarted (pid 6635, port 5193).
- 01:10–01:40 audit screenshots → shots/buildings-z/audit/*.png (stations, civic, glass, corridor rows; halls/sheds
  batch running). Machine heavily loaded: shots take 20–50 s each, worker gen times ×10.
- Audit findings (to fix): school 'interior' camera stares at a wall; civic towers read as glass tubes — need more
  white ceramic shell / rings / sky-garden planting to match R2/Z02; bench 'row' framing poor for low rows.
- 01:50–02:15 fixes: civic_tower refuge storeys → open sky gardens (z_tower.loftCurtain `open(level)` option;
  skyGarden(): timber deck, glass balustrade, planter ring + shrubs, trees in tubs, benches, white soffit with
  downlights, interior-mapped sky lobby glass set back 3.2–5.5 m, door bay open in 'full'; colliders: 1.3 m
  balustrade + sky-lobby walls); needle family: two halo rings (spokes + cyan line) at the upper sky gardens;
  lift doors now on every storey. school: interior camera = ground-floor classroom looking at the yard windows
  (L plan: first classroom not behind the gym), lobby camera looks along the corridor. Bench: low-row 'row'
  view is an oblique aerial. Verified: shots/buildings-z/audit/ct_r1_sky*.png, civic_row2.png, sc1_int2.png.
- Remaining before report: final shots (school L interior, rows), Node perf table, vite build, report.
- 02:20–02:45: station platform canopies get two continuous night-gated linear luminaires in the soffit
  (§1 客运站的顶棚透光; verified final/st_el_plat_night.png); station mass LOD adds the Z03 arch silhouette for
  elevated stations (final/station_mass2.png, 234 tris). Final Node table: scratchpad/bz4/perf_final.txt
  (timings ×10–100 inflated by load avg ≈ 360; use the 01:05 numbers for ms). `npx vite build --outDir
  .build/buildings-z` OK (43 s). NOTE: that build empties .build/buildings-z — the private dev-server config now
  lives in .build/buildings-z-dev/vite.config.mjs (hmr/watch off; restart after edits). Server stopped.

## Status at report time (02:45)
- DONE: all 11 types + helpers, bench (rows/views/LOD/cut/night/wire/bench=1), audit + final screenshots,
  build check. Report delivered.
- OPEN (for QA round): see knownIssues in the report — civic towers still glass-dark at distance (material),
  at-grade station hall exterior plain, interiors sparse, sky-garden far LOD = blank band, clean perf re-measure.

## Fix round 1
Private port 5211 (dev server, hmr/watch off: `npx vite --config .build/buildings-z-dev/vite.config.mjs`, restart after
edits). Shots: shots/buildings-z/fix1-*.png. Scratch: $SCRATCHPAD/bz-fix1/.
Items: ★1 civic/office towers glass_curtain + white ceramic massing (fins, slab bands, crowns, sky gardens, far flag-1
green); ★2 station hall Z03 sculptural shell + street entrance canopy, glass_shop hall lit at 21:30, platform canopy
lights from above; 3 STATION_GEOM canonical + meta.railGround / trackOffset (sign!), ferry waterSide / pierHeading,
port quaySide; 4 furnished lobbies / halls / clinic waiting, corrugated containers; 5 sky-garden 0.2 m deck step.
- [07:10] started (5th instance). Read ARCHITECTURE, prompt §5/§6, notes (building-kit, city, urban, props).
  Blocker from props/city: urban writes meta.trackOffset = building-frame z (NEGATIVE, −27.5) but stationTrack() read it
  as a positive distance → platforms built in front of the hall. Fix first.
- [07:12] item 3 DONE: z_station_geom.stationTrack accepts urban's NEGATIVE trackOffset (zTrack = −|trackOffset|) and
  meta.railHead; Node: S07 station ZR1-0.3.1a5.17w-n10.n5-0 trackZ −27.5 (was +27.5), railY 0.16 = urban railHead;
  ZR2 elevated ZR2-1.3.it.1f3-6.2-0 trackZ −22.5, railY 9.57 = railHead. Bench station specs carry urban-like meta.
- [07:22] ★1 DONE (code): civic towers glass_curtain (D4) + white ceramic spandrels on every family (sail 1.3 m, twist
  1.15, fluted 1.05, needle 0.95) + projecting white slab-edge bands (sail every storey, fluted/twist every 2nd, needle
  every 3rd), needle ribs every 2nd mullion, sky gardens every 21 floors (was 28). Office podium towers glass_curtain,
  50 % 'banded' (white spandrels + band per storey) vs silver-spandrel glass towers; refuge floors are now open sky
  gardens (were dark louvres — inconsistent with the far flag-1 green band); rect offices / research glass_curtain at
  'exterior'. skyGarden() moved to z_tower.js (shared), deck flush with the slab (+2 cm) → item 5 (no 0.2 m step at the
  sky-lobby door; white edge band = 0.18 m kerb outside the balustrade), lusher planter ring (0.7 m, shrubs 1.05–1.5).
- [07:30] ★2 DONE (code): station hall roof = Z03 shell set (3 barrel shells, main stations 5) springing at ys (walls stop
  there), centre shell wider/taller, cantilevered visors over the forecourt (8.5 m, main 11 m) whose tips lift 2.4 m —
  the entrance canopy that reads from the street — and 2.6 m over the platform; glazed arch fans front + back, valley
  gutters + white valley girders on white facade columns, frosted crown rooflights with a night-gated light line,
  two soffit light lines per shell; front fully glazed to the spring line. Hall glass uses bay ids whose public-profile
  decision is lit all night (litBays: lit at 05:00 / 12:00 / 21:30 / 00:30) → hall always lit in service hours.
  Platform canopies: luminous ridge rooflight strip (lit line from above at night). Mass LOD: hall to ys + coarse
  shells. Elevated: mezzanine (platform-level) doors through the back wall onto the deck; at grade: back-wall opening
  for the footbridge (bridge deck now overlaps the mezzanine edge).
- [07:42] item 4: z_common.furnishPublic (bench rows + aisle, planters, info totem, bins) used in station ticket hall +
  paid concourse ('full'), clinic waiting rooms (all floors) + lobby planters / screen, office lobby; port containers
  are real ISO 20 ft corrugated boxes (side / roof corrugation, posts, rails, doors with locking bars). ferry_terminal
  boarding walkway turns to meta.pierHeading (≤ 35°, anchor follows).
  Node: sweep of real city buildings (7 anchors, 69 gens, all my uses) 0 errors; synthetic port/warehouse/ferry OK.
  Bench shots: shots/buildings-z/fix1-civic-row.png, fix1-ct-sail-mid.png, fix1-glass-row.png, fix1-st-ag-corner.png,
  fix1-st-ag-street.png, fix1-st-el-corner.png, fix1-st-main-aerial.png, fix1-st-ag-night-aerial.png (0 console errors).

### Requests (fix round 1) — read by the other fixers
- **urban**: civic_tower footprints can be very small for their storey count (e.g. ZR1-0.3.1a3.186-n1.n2-0: 23.2 m square
  lot, 137 floors ≈ 560 m → plan Ø 19 m, slenderness 1:29 — reads as a tube whatever the cladding). Please give
  landmark towers ≥ 36–40 m lots (GEN[BU.CIVIC] s = min(len, depth) × 0.48 → clamp to ≥ 36) or cap floors at ≈ 3.5 × w.
- **city / props**: nothing new — stationTrack() now honours urban's NEGATIVE meta.trackOffset (both signs accepted) and
  meta.railHead, so the station platforms sit on the tile rails again (S07 station trackZ −27.5, railY = railHead).
- **lead (bookmarks)**: suggested ZR1 frames for QA of this round — civic towers + main station at 1 km:
  `pose=22.264576,117.932811,693,0,5,35&time=7.638`; at-grade S07 station front at 1 km:
  `pose=21.887337,118.001532,692,193.67,-8.5,50&time=7.633`; its forecourt at eye height:
  `pose=21.871898,117.997485,544,193.67,8,28&time=7.633`; same station at 21:30 local from 260 m: `time=13.633`.
- [07:55–08:30] app + bench verification and follow-up fixes:
  * app shots (port 5211, workers=2, load avg 70–145, not idle within 150 s, 0 console errors / warnings):
    fix1-app-civic-1km.png (ZR1 civic towers + office towers from 1 km: silver-white / blue-grey skyline, white bands,
    green sky-garden storeys near and far), fix1-app-station-1km.png (S07 at-grade station: three white shells read at
    1 km), fix1-app-station-street.png (forecourt at eye height: shells + visors, glass fans, entrance canopy),
    fix1-app-station-street-night.png (21:30: soffit light lines, lit hall interior through the glass, lit sign),
    fix1-app-station-night.png / -night2.png (21:30 from 420 m: crown light lines, lit visor sign).
  * hall glass dark at night in 'exterior' LOD: cause = interior mapping modelled the 11 m hall glazing as ONE huge room
    whose single lamp is ~13 m from everything → z_hall hallUnit `p.bayRooms` (station curtain openings): bay-sized rooms
    per glazing row (5 panes wide, lamp just above the row); fan glazing likewise (3 strips). Bench night street view now
    fully lit (fix1-st-ag-street-night2/3.png).
  * walkability (Node BFS with the walk-buildings rules from the entrance anchor, $SCRATCHPAD/bz-fix1/wbfs.mjs):
    – sloped sites put the at-grade hall floor above the platform (S07: FFL 2.93 vs platform 1.16 m) → new terrace at FFL
      outside the platform doors + broad steps (+ 1:12 ramp along the platform) down to the platform;
    – mezzanine slab covered the escalator + stair runs (no headroom → level 1 unreachable) → mezzanine() with wells over
      both runs (slabWithHoles), glass balustrades round the wells and along the front edge;
    – elevated: z_hall wall colliders now gapped for doors at ANY level (mezzanine doors onto the platform deck were
      walled off; ground doors unchanged); platform outer guard rail open over the hall (it blocked the platform doors).
    Result: S07 station + ZR2 elevated station: main door → ticket hall → stair → concourse (level 1) → platform all
    reachable (before: hall only / nothing above the ground floor). walk-buildings.mjs itself still reports lobby false
    for the sloped S07 site (its start node is the flat street plane under the 2.9 m landing — tool artefact).
  * misc: elevated back visor 0.6 m (clears the Z03 arch), crown light strip 0.44 m wide, office 'plant' crowns get
    white louvre blades, clinic / lobby signs hang from the ceiling (lobbies are open to the corridor), school +
    community lobbies furnished (lobbyFurniture), paid-concourse benches keep the platform-door aisles clear.
  * Node regression: sweep of real city buildings (48–69 gens, all my uses) 0 errors; synthetic civic/office/port/
    warehouse/ferry at mass/exterior/full 0 errors. Civic tower exterior 120–285 k tris (sky gardens ≈ 30 %).
- [08:50] civic tower at street level: fix1-app-civic-street.png (plaza in front of ZR1-0.3.1a3.186-n1.n2-0, 20 mm:
  fluted civic tower with white ribs + white spandrel bands rising past the plaza tree, banded / glass office towers,
  terraced residential — R2 / Z02 street skyline). Final bench batch: fix1-st-ag-street-night3.png (lit hall glass at
  21:30), fix1-st-el-back.png (Z03 arch over the platforms in front of the shell hall), fix1-st-main-street.png,
  fix1-st-ag-interior2.png, fix1-of-tp-crown.png; app fix1-app-station-street2.png (workers=3). 0 console errors.
  `npx vite build --outDir .build/buildings-z` OK (51.7 s, after the last code edit). Private server stopped.

### Status at report time (fix round 1, 08:52)
- DONE: ★1, ★2, items 3, 4, 5 (+ walkability fixes: sloped-site terrace, mezzanine wells, door colliders at any
  level, platform rail gap; ferry walkway follows pierHeading).
- Remaining / known: hall glass seen from far above at night still reads moderately dark (interior mapping looks at
  room floors from above); walk-buildings.mjs start-node artefact on sloped station sites; station service doors open to
  a yard at another level (pre-existing); civic towers on 23 m lots stay very slender (urban request); interior-mapped
  bay rooms behind the tall hall glazing show room partitions per glazing row (model limitation).

## Fix round 2
Private port 5307 (preview of `.build/buildings-z` or dev config `.build/buildings-z-dev/`, hmr/watch off). Shots:
shots/buildings-z/fix2-*.png. Scratch: $SCRATCHPAD/bz-fix2/.
Items: ★Z1 clinic identity (QY-01: massing, drop-off canopy, health cross / signage, daylight courtyard, reception +
waiting + consult rooms, no mailbox wall); Z2 station hall night (QQ-13: luminaires + falloff, lightboxes with content);
Z3 coplanar roof z-fighting (QQ-02 front low roof in C06; station / hall roofs); Z4 ZR3 warehouse floors spec 1 vs
anchors 2 (QA-ID) + port shed vs warehouse variation (qa-style).
- [start] read ARCHITECTURE, prompt §5/§6, qa-round1 (QY-01/02, QQ-02/13, QA-ID (2)), round2 backlog, evidence shots.
- [15:35] ★Z1 code done: clinic.js rewritten — ring plan (front + back corridor, two links) round a DAYLIGHT COURTYARD
  (light well through every storey: white slab bands + glass walls, garden with trees / benches at the bottom, open to
  the sky with an upstand + glass balustrade on the roof; void = 'lift'-kind room so the interior pass leaves it open);
  own roof (emitRoof cannot cut the hole): parapets, deck with holes, stair house with cyan-cross light boxes, lift
  overrun, plant, healing roof garden + solar, drainage. Sculpted drop-off shell canopy (lifted elliptic visor, two
  tapered columns, edge light line, downlights, two-sided cyan-cross name box on its crown), lay-by markings, sign blade
  rising 4.5 m above the parapet at a front corner (cyan crosses both faces + vertical glyph column; also in the mass
  LOD), ambulance bay with red-cross / 急诊 boxes + parked ambulance (70 %), consult rooms (couch on a curtain track,
  sink, chairs + the kit desk), registration counter under a hanging cross box, LED queue board, corridor arrow signs.
  Narrow lots (< 28 × 17 m or no 4.2 m middle band) keep the single-corridor plan + all identity pieces.
  Node: QY clinic + 6 real clinics mass/exterior/full 0 errors; walk-buildings ZR1-0.3.1a5.17w-n9.n6-0 122/122 rooms
  (riser rooms are kind 'shaft' now, also in corridorPlan).
- [15:35] sign content (Z2 part): z_common glyphText / crossMark / trainMark / arrowMark / signContent / lightBox (frame +
  recessed lit face, two-sided) / ledBoard; signTotem now always has content; K.signPanel replaced in station, ferry,
  warehouse, port shed, community, market; lobbyFurniture sign gets an arrow + glyphs.
- [15:35] Z2 station hall ('full'): vault soffit over the hall = lamp-lit plaster with a luminance gradient (peaks at the
  light lines / crown light, falls off to the springing + end walls), white ceramic inner walls (not uniform plaster),
  own stone floor grid with light pools under pendant discs + falloff to the walls (vertex tint, idl 0.7), pendants
  under the shells, wall-washer lines, light lines under the valley girders; LED departure boards back to back, ticket
  machine screens, two-sided platform / hall signs with pictograms.
- [15:35] Z3: kit --zfight audit of my types: fixed hall() inner plaster above the eave (vs parapet inner face), light-box
  case faces, signTotem 0.5 mm face, glassScreen coincident end mullions / transom faces, clinic blade vs side facade,
  courtyard band corners, ambulance stripes, station mezzanine over the glass lifts (car top = slab top), lift head vs
  tower canopy, fan frame vs shell edge, dock seals, ferry apron vs walkway deck. Remaining hits are kit-owned (requests).
- [15:35] Z4: warehouses = 1 storey in anchors (office mezzanine → anchors.mezzanines + a room anchor); shedLevels() shared
  by near + mass (mass top = exterior top on sloped lots); warehouse roof by hash (flat 42 % / duo-pitch 36 % / sawtooth
  22 %, mass gable), cladding families with a coloured base band; port sheds: port-blue band, painted 7-segment shed
  numbers on both gables, yellow / black jamb guards, crown ventilators.
- [15:33] Node regression: sweep of real buildings (69 gens, all my uses) 0 errors; synthetic port sheds / warehouses +
  real ZR3 warehouses mass / exterior / full 0 errors, massTop = extTop, floors 1/1; walk-buildings: clinic 122/122 rooms,
  S07 station walkable. `npx vite build --outDir .build/buildings-z` OK. Screenshot batch queued (slot busy since 15:17).

### Requests (fix round 2)
- **building-kit** (kit-owned coplanar faces the `--zfight` audit finds inside my buildings): `solarArray` (aluminium tray top
  1 mm under the solar_panel quad — 79 m² on one clinic roof, every emitRoof solar roof too), `parapets` coping corners
  (aluminium|aluminium at roof corners), `signPanel` (face 0.5 mm off its case; I no longer call it), `directoryBoard`
  (black face 2 mm off the case), `wallLight` (light_warm rects 2 mm off the box), `doorUnit` (wood_door|wood_door,
  aluminium_dark|aluminium_dark leaves / frames), `plinth` corners, steps vs landing (paving_stone|stone_step).
- **building-kit** (QY-02 at distance): the glass interior-mapping shader draws the residential lift lobby + mailbox wall for
  every `lobby` room kind (materials.js bkInterior: `lobby` branch) — station halls / public lobbies at 'exterior' LOD show
  mailboxes on the side walls. Please gate the mailbox wall (and the lift doors) on the occupancy profile (`vI2.w` == 0
  residential) and give public profiles plain walls / a counter. (My clinic remaps its lobby / waiting glass to shop /
  classroom boxes at 'exterior'; station hall glazing keeps `lobby` for its downlight row.)
- **lead (bookmarks / QA)**: clinic frames for QY-01 re-check: back 3/4 `pose=21.8700632,117.9972565,585.5,139,-22.08,35&time=2.633`,
  front aerial `pose=21.8687875,117.998897,566,283.67,-12,35&time=2.633`; buildingView ZR1-0.3.1a5.17w-n9.n6-0 'entrance',
  'lobby', 'interior' (lobby → registration + courtyard glass), 'courtyard' (new: 2F corridor looking down the light well),
  'living' (2F consult room → street). The round-1 C06 "front low roof" is not under the C06 camera in the current plan
  (the nearest roof is this clinic's, bottom right of the frame).
- [15:37] warehouse office mezzanine made reachable (it never was: the glass balustrade closed the whole edge; side offices
  put the stair under the slab): stair parallel to the hall-side edge, landing at mezzanine level, balustrade gap, guard;
  walk-buildings ZR3-4.3.ff.17p-n4.n1-1 rooms 2/2. 6-storey ring clinic 191/191, fallback clinic 94/94 rooms.
  Clinic 'exterior' interior mapping: lobby glass → shop box (pharmacy shelves), waiting → classroom box (seat rows),
  never the residential mailbox lobby. Sawtooth warehouse mass without parapet (as the near model).
- [15:44] clinic: glass spine over the entrance (upper waiting bays glazed almost floor-to-ceiling, framed by two white
  ceramic fins + lintel rising 0.9 m above the parapet), roof garden over ~64 % of the roof round the courtyard opening.
  Warehouse 'full': mezzanine slab top 15 mm under the timber floor (was 2 mm), rack beams between / inside the uprights
  (warehouse full z-fight 170 → 3.5 m²). Clinic exterior z-fight hits left are kit-owned only (solar tray, drainage, coping).
  Larger sweep: 165 gens 0 errors; 21 clinics across ZR1–ZR6 styles 57 gens 0 errors, 0 unreachable rooms.
  CPU raster previews (scratch r-*.png) confirm placement of blade / canopy / courtyard / ambulance bay / spine / roof.
- [15:48] market 'full': shared shop boundaries drew two identical partition boxes (762 m² coplanar), gallery slab 3 mm
  under its timber floor (405 m²) → one partition per boundary, slab 15 mm down; stall price boards get glyph content +
  5 mm offset (market full z-fight 1198 → 19 m²). Sweep after these edits: 0 errors.
- [15:59] still queued for a browser slot (1 machine-wide; mega 15:30–15:46, city 15:46–15:55, buildings-o since 15:55).
  Full-LOD z-fight totals now: clinic 228 → 35 m² (rest kit: solar tray, doors, sanitary), S07 station 49 → 16, market
  1198 → 19, ZR3 warehouse 170 → 3.5.

### Status at report time (fix round 2)
- DONE (code + Node verification): ★Z1 clinic identity, Z2 station hall night + sign content, Z3 coplanar faces in all my
  types (kit-owned remainder → request), Z4 warehouse storeys / mass consistency / variation + port shed identity.
- App screenshots: batch shots/buildings-z/fix2-*.png (clinic back 3/4 + front aerial + entrance + lobby, C04 night, ZR5
  port sheds) — see the report for which ones landed.
- [16:19] FINISH. The browser slot (MARS_SLOT_CAP 1) went to mega → city → buildings-o → buildings-o again between 15:17
  and 16:18; my app batch never started, so I stopped it and my dev server (5307). Evidence instead: CPU rasters of the
  generated meshes (shots/buildings-z/fix2-node-*.png: clinic front / back aerial, clinic interior camera (registration
  counter + cyan-cross box + courtyard garden), lobby camera, 2F consult room, station hall interior (pendants, LED
  boards, floor pools), port shed, duo-pitch warehouse) + Node checks above. The app batch to re-run on a quiet machine:
  $SCRATCHPAD/bz-fix2/b1.json (clinic back 3/4 + front aerial + entrance + lobby, C04, ZR5 port sheds).
  Final `npx vite build --outDir .build/buildings-z` OK (after the last edit).

## Fix round 3
Private port 5307 (preview of `.build/buildings-z`, hmr/watch off). Shots: shots/buildings-z/fix3-*.png. Scratch:
$SCRATCHPAD/bz-fix3/. Items: ★Z1 station shell outer surfaces (QQ2-04: panel joints, ceramic tile texture, edge trims,
rain gutters); ★Z2 station ground-floor waiting hall lit at 21:30 (QQ2-05); Z3 clinic app screenshot + Z roofs --zfight.
- [start] read ARCHITECTURE, brief, qa-round2 QQ2-04 / QQ2-05 + evidence (A-C03-x2 / crop-C03x2-shell: the C03 surface is the
  front-visor SOFFIT (render_white, UV = planar x,z, no joints) + the extrados (ceramic_band: 4 mm joints, invisible past
  ~15 m); A-C04 / crop-C04x2-hall: behind the ground-floor glass only non-indoor materials are visible (ceramic_white inner
  walls since round 2, render_white mezzanine soffit, concrete edges) — they get no lamp light at night (materials.js
  INDOOR_FRAG lamp term is for `indoor` keys only) → dark ground floor while the plaster vault is lit).
- [+55 min] ★Z1 code: station.js shellRoof — open-joint white ceramic rainscreen on every shell: modules ≈ 2.4 m (arc
  length, 2 × 1.2 m tiles) × 1.8 m (3 × 0.6 m courses), `ceramic_white` with UVs on the tile grid (tile joints / tone
  mosaic / roughness from the texture) + ± 3 % glaze tone per module, 24 mm open joints with cheeks down to a dark joint
  floor 50 mm in (strips only under the joints: no hidden backing, no coplanar pairs), on the extrados AND the soffits
  outside the hall (front visor, back overhang; the C03 surface is the visor soffit); silver L-nosing on the front / back
  edges, cover strips on the wing edges, rooflight upstand frames; valley box gutters with grating + outlets + downpipes
  beside the facade columns (shoe + drain grate), wing-edge gutters with stayed downpipes at the hall corners. Wing
  soffit strips outside the side walls no longer use the lamp-lit hall plaster in 'full'.
- ★Z2 code: hall inner walls `tile_wall` (indoor → lamp-lit at night, vertex falloff 0.6 → 1.0 towards the wall washers;
  round 2's outdoor `ceramic_white` took no lamp light); mezzanine soffit + fascia `plaster` (indoor) with recessed
  downlights (3 m grid clear of the wells) + a front-edge light line; their pools added to the floor tint; backlit light
  boxes + LED boards on the paid-concourse back wall between the platform doors (at grade).
- z-fight (own geometry): footbridge girder / roof stopped at the back wall (met the opening reveals), elevated bridge
  plates no longer overlap the platform / mezzanine paving (main station 46 m² → 0), platform canopy fascias abut at
  joined ends. Station full totals now S07 13.8, main ZR1-0.3.1a3.186-3.3-0 14.6 (was 60), ZR2 9.0 m² (rest kit-owned:
  doorUnit leaves, bollard light ring, plinth).
- [+75 min] Z3 roofs (`--zfight` audit, own sample of 19 buildings over all my uses, exterior): clinic roof PV = kit
  solarArray (cells 1 mm over the frame: 19.8 / 24.8 m² per ring clinic) → own `z_common.solarRack` (same layout, cells
  6 mm proud): ZR1-0.3.1a5.17w-n9.n6-0 22.7 → 2.8 m²; fluted civic tower: 10–16 rib end caps met at the apex (14 m²) →
  staggered 7 mm → ZR1-0.3.1a3.186-n1.n2-0 16.3 → 2.3 m². Remaining roof-level hits are kit-owned and small: parapet
  coping corners (aluminium|aluminium ≈ 0.4 m² per building, all my flat roofs), back-facade drainage grille
  (aluminium_dark|grille_dark ≤ 0.1 m²), drainage pipe clips (≈ 0.85 m² on clinic ZR1-0.3.1a4.17w-n8.n2-0).
  Regression: sweep 90 gens (all my uses, mass/exterior/full) 0 errors. Build OK. Preview 5307 (pid 15619). App batch
  (C03 ×2, C04 ×2, clinic front 3/4 ×2) queued behind the single browser slot (city capture holds it).

### Requests (fix round 3)
- **building-kit** (kit-owned coplanar faces the `--zfight` audit still finds in my buildings; all were requested in round 2):
  `roof.js solarArray` cell quad 1 mm over the frame top (every emitRoof solar roof; I now use my own `z_common.solarRack`
  with 6 mm on the ring clinic — the narrow-lot clinic still goes through emitRoof), `parapets` coping corners
  (aluminium|aluminium ≈ 0.4 m² on every flat roof of mine), back-facade drainage grille (aluminium_dark|grille_dark) and pipe
  clips, `doorUnit` leaves (aluminium_dark|aluminium_dark 5–8 m² on each station front), `bollard` light ring
  (aluminium_dark|light_warm), `plinth` corners.
- **lead (bookmarks)**: optional Z3 frame for the clinic ZR1-0.3.1a5.17w-n9.n6-0 (front 3/4 aerial with the roof):
  `pose=21.8682188,117.9989967,578.5,318.5,-24,35&time=2.633`. C03 / C04 stay the station checks for QQ2-04 / QQ2-05.
- [+95 min] verification (Node): kit `walk-buildings --zfight` clinic ZR1-0.3.1a5.17w-n9.n6-0 exterior 2.8 / full 14.9 m²
  (round 2: 22.7 / 35; rest kit doors / directory board / sanitary), S07 station 13.7 / 13.8 m² (no shell pairs); walk:
  S07 station rooms 2/2 lobby ✓ (the round-1 sloped-site artefact is gone), clinic 122/122 + roof ✓; synthetic halts
  (w 36 / 30) + a 230 m main at-grade station generate at all LODs. CPU raster previews (scratch r-c03 / r-c04 / r-aerial):
  module grid + nosings + gutters placed as intended; at night the ground band shows lit tile walls, the downlit mezzanine
  soffit and the light boxes. App batch still queued (slot held by other agents since 13:22 UTC).
- [+125 min] app batch ran 13:47–14:02 UTC (one browser, dpr 2, workers=3; idle not reached within 240 s under load
  avg 50–97, 0 console errors / warnings / page errors):
  * shots/buildings-z/fix3-C03-x2.png (+ crop fix3-C03-x2-crop-shell.png = QA's crop x1300–1900 y20–260): visor soffits read
    as panelised warm-white ceramic — dark open joints along / across the curve, tile courses + tone mosaic, silver nosing
    on the visor edges. QA hist region x1000–2200 y40–240: p5–p95 87.8–104.2, p1 81.6 / p99 113.2, 131 levels (was
    97.8–108.1 with 237 k px in one 16-level bin).
  * shots/buildings-z/fix3-C04-x2.png (21:30): the ground floor behind the glass is lit — warm tile walls, downlit mezzanine
    soffit, light boxes + LED boards on the paid-concourse back wall, consistent with the vault (vault p50 84.3 = before).
    QA regions (×2 coords): right band x1800–2900 y880–1100 p50 21.2 / p95 107.3 (was 4.9 / 16.4); left band
    x300–1400 p50 3.1 / p95 106.1 (was 3.0 / 18.5) — its median is the foreground street trees + the escalator truss.
  * shots/buildings-z/fix3-clinic-x2.png (Z3, ZR1-0.3.1a5.17w-n9.n6-0 front 3/4 aerial 10:30): sign blade with the cross,
    glass spine over the entrance, roof garden + courtyard balustrade + stair house, PV rows (own solarRack) behind.
- [+130 min] after the batch: in-hall escalator trusses `cabinet` + stair flights `stone_floor` / cheeks `tile_wall` in
  'full' (indoor → lamp-lit at night; the dark truss was the left-band median; night raster r-c04b confirms), not re-shot
  (browser budget). Final: sweep 90 gens 0 errors, synthetic halts / main OK, S07 station walk 2/2, `npx vite build --outDir
  .build/buildings-z` OK (22.6 s). Preview server 5307 stopped; no browser of mine running.

### Status at report time (fix round 3)
- DONE: ★Z1 (shell cladding: joints, ceramic tile texture + tone, nosings, gutters + downpipes), ★Z2 (lit ground floor
  at 21:30, full LOD; exterior LOD keeps the lit interior-mapped lobby bays), Z3 (clinic app shot; roof z-fight audit:
  own hits fixed — clinic PV, civic crown caps; station shells 0 pairs; kit-owned remainder → request).
- Also fixed (own z-fights): footbridge girder / roof vs back-wall opening reveals, elevated bridge plates vs platform /
  mezzanine paving (main station 46 m² → 0), platform canopy fascias at joined ends.
- Known: station stairRun landing vs next flight (stone_floor|stone_floor 0.55 m², pre-existing); canopy roof edge strip at
  the canopy joint (1.1 m², pre-existing); left C04 band median limited by foreground trees.
