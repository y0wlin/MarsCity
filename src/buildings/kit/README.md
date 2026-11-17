# Building construction kit (`src/buildings/kit`)

Worker-safe, deterministic, plain-JS kit for **game-grade** buildings: every piece has real
thickness, crisp chamfered edges, reveals, sills, frames, thresholds and contact with the ground.
Owner: building-kit agent. Consumers: every `src/buildings/types/*.js` generator, the city
streamer (via `generateBuilding` → `BuildingMeshData`) and the material library.

```
generateBuilding(spec, lod)            src/buildings/index.js   (dispatcher, worker-safe)
  └─ type.generate(spec, lod, ctx)     src/buildings/types/<use>.js
       ├─ plan  (rooms, core, openings) kit/plan.js, kit/cores.js, types/residential_plan.js
       ├─ assemble passes               kit/assemble.js  (facades, bands, roof, base, anchors)
       ├─ interiors ('full')            src/buildings/interior/*
       └─ kit primitives                kit/*.js  →  ctx.b (MeshBuilder)  →  BuildingMeshData
getBuildingMaterial(key, app)          src/buildings/materials.js (main thread)
createBuildingObject(data, app)        src/buildings/materials.js (THREE.Group per building)
createColliderMesh(data)               src/buildings/materials.js (MeshBVH collision mesh, 'full')
worker jobs 'building' / 'buildingTextures'   src/workers/handlers/building.js
```

---------------------------------------------------------------------------------------------

## 0. Output format: `BuildingMeshData` (what the city streamer receives)

`generateBuilding(spec, lod)` (worker job `'building' {spec, lod}`) returns plain data in the
**building local frame** (metres; origin = footprint centre at `spec.ground.entrance`; +Y up; +Z =
outward normal of the front facade; +X = right hand of a viewer outside facing the front). Place it
with `geo.buildingAxes(spec.lat, spec.lon, spec.heading)` → columns `x, y, z` (ECEF unit vectors)
and origin `latLonHToEcef(spec.lat, spec.lon, spec.ground.entrance)` (floating origin: subtract
`origin` in float64, then float32), exactly as `src/dev/buildings-inapp.js placeMatrix()` does.

```
{
  parts: [{                        // one per material key, sorted by key; never empty arrays
    material: 'ceramic_white',     // key of the vocabulary (§5) → getBuildingMaterial(key, app)
    position: Float32Array(3n), normal: Float32Array(3n), uv: Float32Array(2n),   // uv in METRES
    color: Float32Array(3n),       // linear RGB tint multiplied with the material colour (always present)
    index: Uint32Array,            // triangles, CCW seen from the front (always present)
    attributes?: { iwin0|iwin1|iwin2|facade|facadeId: { array: Float32Array(4n), itemSize: 4 } },
  }],
  colliders?: {                    // 'full' only: walkable/blocking triangles, building frame
    position: Float32Array, index: Uint32Array },   // floors, landings, stair flights as ramps,
                                   // walls with door gaps, railings as 1.1 m walls, roof deck + parapets
  bounds: { min: [x,y,z], max: [x,y,z] },           // of all parts (building frame)
  anchors: {
    entrances: [{ kind: 'main'|'service'|'shop'|'back'|… (types add e.g. 'ambulance'), side: 'front'|'back'|'left'|'right',
                  pos: [x,y,z] (0.6 m outside the door, at FFL), dir: [x,0,z] (outward), width }],
    floors:   [{ level, y (finished floor level), height (floor-to-floor) }],   // level 0 = ground
    roof:     { y (roof deck), access: [x,y,z] (hatch / stair house exit) },
    rooms:    [{ floor, name, kind, unit, center: [x,y,z] (floor level), size: [w,h,d] }],
    windows:  [],                  // reserved (always empty for now)
    cameras:  { street, entrance, lobby?, stair?, living?, back, roof: { pos:[x,y,z], target:[x,y,z] } },
  },                               // §5 shot 07 viewpoints (eye 1.65 m); keys missing when n/a
  stats: { triangles, vertices, parts, ms, type (generator name), lod, id, colliderTriangles?, error? },
  meta?: { style, styleId, … },    // free-form (generator notes)
}
```

* All parts of one building share **one packed ArrayBuffer per attribute kind** (position, normal,
  uv, color, index, each extra attribute) and hold subarray views: post with
  `postMessage(data, transferList(data))` (`transferList` from `src/buildings/index.js`, de-duplicated;
  the handler in `workers/handlers/building.js` already does this).
* Main thread: `createBuildingObject(data, app, {name, castShadow, receiveShadow})` → `THREE.Group`
  (one mesh per part, shared patched materials, shadows set, transparent keys `renderOrder 2`,
  `userData {bounds, anchors, stats, colliders}`); `disposeBuildingObject(group)` frees geometries
  only (materials are shared — never dispose them); `createColliderMesh(data)` → invisible mesh with
  `geometry.boundsTree` (three-mesh-bvh) or `null`; parent it with the same transform as the group.
* Call `initBuildingMaterials(app, {workers: app.workers})` once (procedural textures in the
  workers, job `'buildingTextures'`); materials render with flat colours until it resolves.
* LODs: `'mass'` ≈ 30–3000 tris (far facade shader attributes, §5), `'exterior'` full exterior
  detail (10-storey block ≈ 100 k tris, ≈ 8 ms in a worker), `'full'` exterior + interiors +
  colliders (≈ 280 k tris, ≈ 20 ms). `stats.error` is set when a type generator threw and the generic
  fallback was used (the result is still complete and usable).

## 1. Adding a building type (other engineers)

Create `src/buildings/types/<name>.js` — it is discovered automatically (Vite
`import.meta.glob`, main thread and workers; in plain Node call `registerTypeModules()` as
`scripts/bench-buildings.mjs` does). **Do not import `../index.js`** from a type (cycle). A file
without a default export carrying `uses` (helpers such as `residential_plan.js`) is ignored.

```js
import * as K from '../kit/index.js';
import { genericPlan, assembleAll } from './generic.js';   // optional starting point

export default {
  name: 'clinic',
  uses: ['clinic'],                    // BuildingSpec.use values handled by this module
  generate(spec, lod, ctx) {           // emit into ctx.b; never throw for odd specs
    const plan = genericPlan(ctx, { kind: 'clinic', groundKind: 'lobby' });
    // …tweak plan rooms / openings / entrances…
    assembleAll(ctx, plan);            // facades, bands, roof, base, interiors ('full'), anchors
    // …then add use-specific structure: K.canopyFlat(ctx.b, …), K.signPanel(…), ambulance bay…
  },
  massing(spec, ctx) {                 // optional 'mass' LOD volumes (else footprint / L / round)
    return K.defaultMassing(ctx.spec, ctx);
  },
};
```

`ctx` (made by `makeContext(spec, lod)` in `index.js`):

| field | meaning |
|---|---|
| `ctx.spec` | normalized spec (`kit/spec.js`): original fields + `_w, _d, _floors, _fh, _gh, _ground{fl,fr,br,bl,min,max}, _shared{left,right,back}, _entrances, _lat, _profile, _meta` |
| `ctx.lod` | `'mass' \| 'exterior' \| 'full'`; `ctx.full`, `ctx.mass` booleans |
| `ctx.b` | the `MeshBuilder` (§2) |
| `ctx.style` | style preset (`kit/styles.js`): materials by role + feature switches (zr_ceramic, zr_terrace, zr_island, zr_cold, zr_highland, zr_glass, o_utility) |
| `ctx.inst` | per-instance variation from `spec.hash` (ceramic temperature, balcony rhythm, window family, railing, fins, roof garden …) |
| `ctx.rng`, `ctx.sub(channel)` | seeded RNGs (`core/hash.js Rng`). **Never `Math.random()`.** Use a new `sub(channel)` per feature so adding a feature never reshuffles another. |

Roofs: call `K.roofSpec(spec, ctx.style, ctx.inst)` → `{kind:'flat'|'garden'|'pitched'|'other',
surface, pitchKey, solar, skylights, tint}` so the near roof agrees with the far city colour
(`spec.roof` + `spec.meta.roofKind` from urban.js); `kind 'other'` (vault, sawtooth, canopy, gable,
spire) is yours to build. `K.roofFarColor(r)` gives the matching far-model colour.

If a generator throws, the dispatcher logs once, disposes the builder and falls back to the generic
type (`stats.error`). `'full'` must add interiors **and colliders** (`b.colBox/colQuad/colPolyY`):
floors, walls with door gaps, stair flights as ramps, railings as low walls. Keep doorways open.

## 2. MeshBuilder (`kit/MeshBuilder.js`)

Part-accumulating builder: every vertex goes into the buffer of its **material key**, so a
building is one merged mesh per material. Typed arrays, pooled per thread (no growth / GC churn
after warm-up), transferable.

* Coordinates: metres, **building local frame** (origin = footprint centre at `ground.entrance`,
  +Y up, +Z = front facade normal, +X = right hand of a viewer facing the front).
* Faces are CCW seen from their front; normals are exact (transforms are rigid only).
* Transforms (post-multiplied like a scene graph): `push() pop() translate(x,y,z) rotY(a) rotX(a)
  rotZ(a) frame(ox,oy,oz, ux,uy,uz, vx,vy,vz, nx,ny,nz)` (right-handed u×v=n), `tp()/td()` map a
  local point/direction to the building frame.
* UVs are **metres**. Default `uvMode` 0 = box projection from the final building-frame position
  and normal (+ a per-building offset) → textures keep world scale and panel joints line up across
  pieces. Sweeps / lathes / explicit `quad(..., uvs)` use exact explicit UVs (no offset — the
  window interior mapping relies on them).
* Vertex colour = linear RGB **tint** of the material colour: `tint(r,g,b)`, `pushTint/popTint`,
  `withTint(rgb, fn)`. Every part always carries `color`.
* Extra vec4 attributes for some keys (`EXTRA_ATTRIBUTES`, `declareExtras`, `setExtra(name,a,b,c,d)`,
  `clearExtra`, per-vertex `setExtraFn(name, fn(X,Y,Z,NX,NY,NZ,out,offset))` from the building-frame
  position / normal — used for the indoor daylight `idl`). Call `K.clearGlassRoom(b)` after custom glass so later glass does not inherit a room.
* Emitters: `vert/tri/q` (low level), `quad`, `triangle`, `rectX/rectY/rectZ`, `box(key, x0,y0,z0,
  x1,y1,z1, faces)` with face mask `PX|NX|PY|NY|PZ|NZ`, `cbox(...c, bottom)` (all edges chamfered),
  `boxAt`, `polyY(key, outer, holes, y, facing)` (earcut), `sweep`, `lathe`, `cylinder`, `tube`,
  `prism`, `extrudeX`, `blob`.
* Colliders (`'full'`): `colBox`, `colQuad`, `colPolyY` (building frame triangles).
* Anchors: `b.anchors = {entrances, floors, roof, rooms, windows, cameras}` (plain values in the
  building frame — not transformed by push/translate); `b.meta` free (copied to `data.meta`).
* `finish()` → `{parts, colliders?, bounds, anchors, meta?, stats}`. All parts of one building share
  ONE packed ArrayBuffer per attribute kind (position, normal, uv, color, index, each extra) and hold
  subarray views → use `transferList(data)` (de-duplicated) when posting. `dispose()` releases the
  pooled buffers of an abandoned builder.

## 3. Primitives & components (all `fn(b, …)`, emit in the current local frame)

Everything below is re-exported by `kit/index.js` (`import * as K from '../kit/index.js'`), including
the plan / assemble / core helpers, `emitInterior`, `furnishRoom`, the furniture namespace
(`K.furniture.sofa(b, …)`) and `generateTexture`. Name note: `K.SIDES` is the MeshBuilder face mask
(`PX|NX|PZ|NZ`); the side-name array `['front','right','back','left']` is `K.SIDE_NAMES`.

| module | functions |
|---|---|
| `primitives.js` | `sweep(b,key,path3D,profile2D,{closed,closedProfile,caps,up,transport,smoothAngle,uScale})` (profile `[s,y]`, s = right of travel = outward for facade-order paths, CCW), `tube`, `lathe(b,key,[[r,y]],segs,{capTop,capBottom,x,y,z,a0,a1})`, `cylinder`, `prism(b,key,poly[[x,z]],y0,y1,{top,bottom})`, `extrudeX(b,key,profile[[z,y]],x0,x1)`, `blob`, `circleProfile`, `capIndices` |
| `walls.js` | `wallWithOpenings(b,{L,u0,y0,y1,T,openings:[{u0,u1,v0,v1,reveal,chamfer,noSillReveal}],outer,inner,innerReveals,capStart,capEnd,chamferStart,chamferEnd})` — crack-free grid outer face, chamfered opening edges, reveals 0.15–0.3 m to the frame plane, optional inner face/reveals; `gridFace`, `facadeFrame(b,side,w,d,inset)` (enter the wall frame of a rect side: x = u along the facade left→right seen from outside, y up, z outward), `facadePoint`, `facadeNormal`, `perimeterU`, `solidWall` |
| `polyfacade.js` | polygon / round footprints: `ringPolygon(cx,cz,r,n)` (n-gon in facade order, front facet centred on +z), `facadeOrder(poly)`, `polyEdges`, `edgeFrame(b,edge)`, `polyWalls(b,poly,{y0,y1,T,outer,inner,openings(e),units(e,ops)})`, `polyPlinth`, `polyParapet` (seamless swept coping), `insetPolygon`, `ringBandPath(cx,cz,r,depth(θ))`, `radialProjector` / `radialInside` (for `curvedBand({project, inside})`) |
| `windows.js` | `windowUnit(b,{u0,u1,v0,v1,R,type:'casement'\|'tall'\|'slider'\|'small'\|'strip'\|'fixed',cols,transoms,frameKey,glassKey,sillKey,sash,blind,blindDrop,louvres,juliet,room,inner,T})`, `shopfront`, `louvrePanel`, `sill`, `bar`, `frameRect`, `glassPane`, `setGlassRoom`, `clearGlassRoom`, `ROOM_KIND` |
| `doors.js` | `doorUnit(b,{u0,u1,v0,v1,R, kind:'single'\|'double'\|'glazed'\|'glazed_double'\|'service'\|'apartment'\|'interior'\|'entry', open, hinge, inward})` (handles at 1.0 m, thresholds, kick plates, architraves; `entry` = house front door with reeded glass strip, pull bar + lever, letter plate), `vestibule` (门斗), `leverHandle`, `pullBar` |
| `stairs.js` | `steps(b,{u0,u1,z0,y0,y1,cheeks,rails})` (riser ≤ 0.165, tread 0.30), `rampAlong` (≤ 1:12, two handrails + 0.7 m rail), `handrail(b,pts,{height,posts,lower})`, `stairFlights(b,{W,Lz,landD,halfD,rise,top,split})` (real switchback storey, balusters, wall rails, ramp colliders), `stairTop` (top floor of a well: floor over flight A + guard rail), `liftStorey`, `risers` |
| `cores.js` | `coreLayout({cx,zBack,towards,maxRise,minRun,lift,liftSide,landingDepth,W})`, `stairLength`, `groundSplit(rise)` (unequal flights → walk under the half landing to a back door); fix round 3: `coreLayoutX({cx,zBack,towards,maxRise,W,landD,halfD,landingDepth,landAt:'minx'\|'maxx',wallEnd,wallT,maxLen})` (shallow plans: flights ALONG x against the service wall, landing in front, no lift), `stairLengthX`, `stairFrame(stair)` → `{ox,oz,ax,az,W,Lz}` (the local stairFlights frame for landAt 'max' \| 'min' \| 'minx' \| 'maxx', honours `endInset0/1`), `stairPoint(stair,x,y,z,y0)`, `stairAlongX` — draw / place anything relative to a stair through `stairFrame`, never by testing `landAt === 'max'` |
| `structure.js` | `columnRound`, `columnSquare`, `columnGrid`, `canopyFlat` (fascia, soffit downlights, tie rods, sign), `canopyCurved` (ZR arch canopy), `porch` (glazed draught lobby), `awning`, `pergola({curved})`, `roundedSlab` |
| `balconies.js` | `bandPaths(w,d,{front,right,back,left: m \| t=>m},shared,{cornerR})` (continuous ZR band outline wrapping corners, undulating offsets, rounded returns into the wall, flush cuts at party walls), `curvedBand(b,path,y,{w,d,key,flat,deckKey,soffitKey,up,lights,project,inside})`, `railing(b,pts,y0,{kind:'glass'\|'bars',closed})`, `glassStrip`, `bandPlanter`, `ribbonToWall`, `railLine`, `disc` |
| `roof.js` | `parapets(b,rect,y,h,T,{sides:{front:'parapet'\|'none'\|'firewall'}})`, `coping`, `roofDeck` (membrane falls + drains), `deckArea`, `hvacUnit`, `acUnit`, `ventMushroom`, `ventStack`, `roofHatch({ladderDepth})`, `ladder`, `stairHouse(b,rect,y,h,{door:'front'\|'right'\|'back'\|'left', doorU})`, `liftOverrun`, `waterTank`, `antennaMast`, `solarArray({tilt,azimuth})`, `skylight`, `plantRoom`, `roofGarden(b,rect,y,seed,{keepOut})`, `bench`, `pitchedRoof(b,rect,y,{key:'roof_metal'\|'roof_shingle', ridgeAxis, partyA, partyB, vergeA, vergeB, roofTint, sunSide, seed})` (standing seams or glazed tiles, party-wall upstands for terraces, flush PV + roof windows) |
| `drainage.js` | `downpipe(b,u,yTop,yBottom)` (brackets, hopper, shoe), `scupper`, `gutter`, `roofDrain` |
| `plinth.js` | `plinth(b,spec,ffl,{key,skip})` (base course down to terrain − 0.6 m from the corner heights), `retainingSteps` (stepped retaining walls, channel, guard rail where terrain is above the floor), `sideGround`, `groundAlong`, `frameSide` |
| `facade.js` | `ribbonFin(b,pts3D,{width,thickness})` (sweeping ZR fins), `verticalFins`, `sunshade`, `signPanel` (blank light box), `plaque`, `wallLight`, `storeyLine`, `acScreen` (AC unit behind a louvre screen), `catmull` |
| `site.js` | `binStore`, `bikeRacks`, `bikeShelter`, `mailboxWall` (信报区 + parcel lockers), `bollard`, `pavingPad` |
| `vegetation.js` | `leafCluster` (dark core + outward-facing alpha leaf cards on a shell), `shrub`, `smallTree` (limbs + ellipsoid crown of clumps), `trailing`, `plantBed`, `planterBox({trail})` |
| `plan.js` | PlanModel helpers: `room`, `deriveOpenings` (windows from rooms: living → sliders behind balconies, bedrooms → tall/casement, kitchens sill 1.05, baths frosted …), `roomFacades`, `sharedEdges`, `sharedEdgeLength`, `repairDoors` (re-routes doors whose rooms share no edge ≥ width + 0.25 m; run by `emitInterior` on every floor), `connected`, `openTo`, `planToU`, `uToPlan`, `kindCode`, `roomW/roomD/roomCenter`, `resetRoomIds` |
| `assemble.js` | `emitFacades`, `emitBands` (railings only along stretches ≥ 0.8 m deep), `emitRoof({garden,solar,stairHouse,keepOut})` (sets `plan.roof.stairHouse`; the stair-house door opens off the roof-level floor landing — end wall at the landing end, else a side wall beside it; `core.roofDoor` forces a side), `emitBase({canopy,ramp,binStore,bikes,houseBins})`, `emitAnchors`, `rectOf`, `wallKeys`, `solidSpot` (a solid wall position for lamps / plaques) |
| `styles.js` | `STYLES`, `STYLE_ID`, `resolveStyle(spec)` (spec.style keyword › province › zone), `styleInstance(spec, style)`, `roofSpec`, `roofFarColor` |
| `spec.js` | `normalizeSpec`, `groundAt(spec,x,z)`, `sideBearing`, `daylightScore`, `occProfile` |
| `mass.js` | `emitMass(ctx, volumes)`, `defaultMassing(spec, ctx)` (rect / L / round, pitched roofs) |
| `texgen.js` | procedural tileable PBR textures (`generateTexture(name)`), used by materials.js / the worker |

Interior pieces: `src/buildings/interior/` — `emitInterior(ctx, plan)` (floors, ceilings,
partitions with doors, stairs, lifts, light panels, colliders) and `furniture.js` (`sofa, coffeeTable,
rug, tvUnit, diningSet, chair, bed, bedside, wardrobe, desk, shelves, kitchenRun, toilet, vanity,
shower, bathtub, plantPot, floorLamp, gondola, counter, officeDesk, lobbyBench`), `rooms.js`
(`furnishRoom`: wall-based placement that respects doors and window sills).

## 4. PlanModel (plan-first generation)

```
{ w, d, ffl, wallT, slabT, bayW, house?,
  floors: [{ level, y (FFL), h (floor-to-floor), rooms: [Room], openings: [Opening], inset: {front,back,left,right} }],
  roof: { y, parapet, wallParapet, kind: 'flat'|'garden'|'pitched', surface, pitchKey, tint, solar, skylights, ridgeAxis?, access },
  core: { x0,x1,z0,z1, stair:{x0,x1,z0,z1,W,Lz,landAt,landD,halfD}, lift?, landing, groundSplit?, split0? },
  cores?: [core, …],               // several cores (wide blocks); core === cores[0]
  shared: {left,right,back}, entrances: [{kind, side, u0, u1, v1, room?, sign?, house?}],
  extraOpenings: [Opening], shafts: [[x,z]], lobby: {cx,cz,nx,nz,depth} }
Room    = { id, kind, name, x0,x1,z0,z1, floor, unit, doors:[{to, width, kind?, pos?:[x,z], at?}], open:[ids] }
Opening = { side, u0,u1, v0,v1 (absolute y), kind:'casement'|'tall'|'slider'|'small'|'strip'|'shop'|'door'|'vent', room, floor, … }
```
Room rects run to the **outer face** of exterior walls and to the centre of partitions. Rooms touching a
facade get windows from `deriveOpenings`; partitions + doors come from shared room edges
(`connected`, `open` removes the wall), furniture from `furnishRoom`, ceiling-light occupancy ids
from the room's first window.

Exterior doors ('full' LOD): the wall colliders leave every door, slider and shop-door opening
walkable, so those units render **open** — entrance / back / house doors and shop doors swing 65° inward
(vestibule inner doors too), the last slider panel slides behind its neighbour (`windowUnit({type:
'slider', open})`). 'exterior' LOD doors stay closed (interior-mapped lobby behind the glass).

Doors (`emitInterior`): a door listed in either room's `doors` is cut into their shared partition. It
sits 0.25 m from one end of the partition, clear of exterior wall thickness, unless `pos: [x, z]`
(plan point the door centre should be nearest to — e.g. the floor-landing end of a stair room) or
`at` (metres along the partition frame) is given. `repairDoors` first drops / re-routes doors whose
rooms touch only at a corner (same unit: hall › corridor › living › kitchen › bedroom; else an
adjacent common corridor / landing / lobby). Rooms that need a door must therefore share a real
edge with some room of their unit or a common circulation room. Every core of `plan.cores` (or
`plan.core`) gets switchback stairs (`core.stair`), a lift shaft (`core.lift`), a roof exit (stair
house from 4 floors, hatch + ladder below) and a lift overrun; the lowest floor of each stair
column is floored to the back wall (passage under the half landing to the service door).
Verify walkability with `node scripts/walk-buildings.mjs [--only id] [--verbose] [--png f --floor N]`
(2.5-D flood fill over the colliders from the street with the walk-mode capsule `WALK` of
`src/controls/modes/walk.js` (radius 0.28, step 0.35, height 1.8): lobby, stair, every floor, 2F living,
back door; `--id <buildingId>` checks real city buildings via `urban.buildingSpecById`). Camera anchors:
`stair` stands on the floor landing on the axis of the first flight and looks up it to the half landing;
`lobby` stands 1.6 m inside the street door, clear of the open door leaves.

Residential family (`types/residential*.js`, `shop_row.js`):
* `residentialPlan` — apartment blocks: arrival / service / daylight sides → cores (stair + lift,
  一梯两户) → through-units → bays → rooms; street door → lobby (信报区) → core; back door under the
  ground-floor half landing → bin store; stepped terraces (zr_terrace). Fix round 3: **shallow** blocks
  (d − wallT − stair length < 3.2 m, `plan.shallow`) take an along-x stair against the service wall
  (`coreLayoutX`; landing / lobby in front, door at the floor-landing end, service door off the
  ground-floor landing, no lift); a landing never leaves a ≤ 0.9 m roomless slit before the facade; an
  end core gives its whole front zone to its one flat. **Narrow** plots (w < 9.5 m, not a house,
  `plan.narrow`) use `narrowPlan`: one flat per floor (一梯一户) beside a stair column along the party /
  a side wall — landing + lobby in front of the stair when ≥ 1.5 m is left, else the stair spans the
  whole inner depth, the lobby moves beside it and the flat door opens off the floor landing.
* Roof exits (all plan types): when emitRoof builds a stair house (`plan.roof.stairHouse`, ≥ 4 storeys
  or `opts.stairHouse` — podiums), the last flight climbs to a roof-level floor landing (interior) and the
  door opens off it; walk-buildings reports `roof`.
* `housePlan` / `isHouse` — terraced houses (联排), detached houses and narrow shop-houses: hall open
  to a switchback stair along a party wall, living room on the street, kitchen-dining with the back
  door to the yard, bedrooms + bath upstairs; party walls blank; pitched roofs with ridges parallel to
  the street and party-wall upstands so each house of a terrace reads separately.
* `generateRoundTower` (round footprints) — n-gon drum with continuous balcony rings, set-back
  crown, wedge apartments around a central core; podium towers (`spec.meta.podium/tower`) put the
  rect or round tower on a shop podium with a roof terrace.

## 5. Material vocabulary (`materials.js`)

All materials are `MeshStandardMaterial`/`MeshPhysicalMaterial`, `vertexColors: true` (tints),
procedural sRGB base colour + linear normal + ORM (AO/rough/metal) textures, UVs in metres; patched
with `app.lighting.patch` when available.

| group | keys |
|---|---|
| shells | `ceramic_white` (glazed 1.2×0.6 panels), `ceramic_band` (bright band ceramic), `ceramic_grey`, `panel_insulated`, `panel_white`, `panel_grey` (O-zone panels with fixings), `render_white`, `plaster` (interior), `concrete`, `concrete_smooth`, `concrete_wet` |
| stone / ground | `stone_plinth` (blocks), `stone_sill`, `stone_step`, `stone_dark`, `basalt` (oxidised local basalt, coursed: plinths, retaining walls, canyon bases), `stone_floor`, `paving`, `paving_stone` |
| metals | `aluminium` (brushed, anisotropic), `aluminium_dark`, `steel` (galvanised), `steel_dark` (painted), `steel_brushed`, `steel_yellow` (safety rails), `steel_door`, `chrome`, `hvac`, `tank_white`, `grille_dark`, `blind` |
| glass | `glass_window` (insulated glazing, reflectance 0.125, with **interior mapping** — fake room box sized from the plan, furniture, curtains, occupancy night lights), `glass_shop` (same, shop / lobby interiors: lift lobby + mailbox wall + downlights for lobbies), **`glass_curtain`** (blue-grey coated curtain wall 蓝灰幕墙: reflectance 0.3 with a blue cast, the interior-mapped room stays visible through the coat — towers / offices; same `iwin0/1/2` as `glass_window`, use it with `K.setGlassRoom`), `glass_clear` (transparent, 'full' LOD windows / vestibules; carries `iwin*` for the street reflection), `glass_railing` (balustrades), `glass_agri` (agricultural / greenhouse glazing: transparent, slightly diffusing, two-sided), `glass_frosted` (baths, skylights; glows with the room's occupancy when it carries iwin ids), `mirror`, `solar_panel` |
| finishes | `wood`, `wood_deck`, `wood_floor`, `wood_door`, `cabinet`, `counter`, `tile_floor`, `tile_wall`, `porcelain`, `fabric`, `fabric_awning`, `black`, `rubber`, `plastic_bin`, `mat_entrance` |
| roof / planting | `roof_membrane`, `roof_gravel`, `roof_metal` (standing seam), `roof_tiles` (white ceramic roof pavers), `roof_shingle` (glazed ceramic roof tiles for pitched roofs), `soil`, `plant` (foliage core), `foliage` (alpha-tested leaf cards), `bark` |
| light | `light_warm` (night-gated lamps), `light_cyan` (guide lights, always on), `light_red` (aviation), `signage_blank` (blank light box), `light_panel` (interior ceiling panels, occupancy-gated) |
| far LOD | `mass_facade` (procedural storeys / windows / night lights), `mass_roof` (roofs, lips, gables; colour from the vertex tint) |

Material flags (internal): `dust` — red Martian dust on upward faces (ledges, sills, copings);
`macro` — low-frequency albedo variation; `indoor` (plaster, floors, tiles, cabinets, fabric …) —
sky light scaled by the per-vertex daylight factor `idl` (falloff from the room's windows, written by
`emitInterior`; 0 = not set → uniform `uBkIndoorAO`), warm lamp ambient at night; `norm` — **albedo
normalisation**: the procedural colour texture only modulates detail and the material colour `c` is the
true mean albedo (concrete `0xb9b6ae` → linear 0.48; before, the texture's own mean ≈ 0.32 darkened
concrete, stone, paving, membranes, metals and panels to a third of their colour). Vertex tints are
multiplied on top: a tint of 1 now means "the declared colour" — no compensation tints needed.

Glass reflections: façade glass (`glass_window`, `glass_shop`, `glass_curtain`, `glass_clear`,
`glass_railing`) replaces the sky environment's bare red ground below the horizon by a street section
seen from the pane (`bkStreetReflect`: street trees 6–9.5 m out, opposite frontage 19–36 m with a 9–43 m
skyline and gaps, paving / city beyond), using the pane's height above the street from its room ids
(storey × storey height + height in the room). Lower floors reflect trees and the opposite houses, upper
floors and far views mostly sky.

Lighting units: identical to `app.lighting` (sun ≈ 8 × transmittance, SH sky irradiance). Emissive is
authored in **emissive units** (1.0 = a typical lit window / street lamp) and multiplied by
`EMISSIVE_SCALE` 0.05 — by `app.lighting` when patched, by these shaders otherwise — so dev benches
and the app match at the same exposure (day ≈ 0.45, night ≈ 15, AgX). Facade lamps are night-gated
here (photocell); window glass, frosted panes and ceiling panels follow `occupancy.windowLitMinute`.

Unknown keys render neutral grey and warn once — add new keys to `materials.js` (owner) via a request.
Material sample board (§3 材质样板: dry / smooth / wet concrete, oxidised basalt, ceramic panels, brushed
aluminium, interior-mapped window glass, blue-grey curtain wall, agricultural glass, far-LOD façade with a
sky-garden storey, 18 % grey card, 1.7 m figure, one light): `dev/buildings.html?view=board&clean=1&time=10`
(`&panels=concrete,window,…` picks panels).

### Extra vertex attributes (vec4)

| key | attribute | content |
|---|---|---|
| `glass_window`, `glass_shop`, `glass_curtain`, `glass_clear` | `iwin0` | (pane u-offset from the room's left wall, room width, room depth, room height; `glass_clear`: 0 = no street reflection) |
| | `iwin1` | (pane bottom above the room floor, room seed 0..1, floor index, bay index) |
| | `iwin2` | (building hash hi16, hash lo16, room kind (`ROOM_KIND`), occupancy profile) |
| `light_panel`, `glass_frosted` | `iwin1`, `iwin2` | as above (floor, bay, hash, kind, profile); zero hash = never lit |
| `mass_facade` | `facade` | (floor height, bay width, style id (`STYLE_ID`), ground storey height incl. FFL) |
| | `facadeId` | (hash hi16, hash lo16, eave y, flags: 1 blank band, 2 shopfront ground floor, 4 balcony bands, 8 glazed ground floor; bits 4–6 occupancy profile) |
| indoor keys (`plaster`, floors, `tile_wall`, `cabinet`, `counter`, `fabric`, `wood_door`, `porcelain`, `black`, `mirror`) | `idl` (float) | daylight factor 0.2…0.9 of the outdoor sky irradiance (0 = not set) |

Flag 1 on `mass_facade`: **with bay width 0** (what `emitMass` writes for party walls and windowless
volumes) = blank wall; **with a bay width > 0** (loftMass refuge / plant storeys of towers) = **sky-garden
storey**, drawn green at distance (planting behind a glass balustrade, white slab edge and soffit, shaded
sky-lobby set-back). City far shaders should mirror this rule (`blank && facade.y > 0.05 m`).

`uv` on `mass_facade` = (perimeter metres from the front-left corner running front → right → back →
left — round volumes: around the n-gon from the front facet's left vertex —, metres above the
entrance level). Floor index at v: `v < groundH ? 0 : 1 + floor((v-groundH)/floorH)`; bay index
`floor(u / bayW)`. Near windows use the **same** (hash, floor, bay) so
`occupancy.windowLitMinute(hash, floor, bay, minute, profile)` lights the same windows at every LOD.
Volumes with `bands` add slab-edge lips per storey (`mass_roof`), pitched roofs a gable prism.

## 6. Recipes

* **Facade with real windows**: `b.push(); K.facadeFrame(b, 'front', w, d); K.wallWithOpenings(b, {L: w,
  y0, y1, T: 0.32, openings, outer: 'ceramic_white', inner: ctx.full ? 'plaster' : null, innerReveals: ctx.full,
  capStart: true, capEnd: true}); for (const o of openings) K.windowUnit(b, {...o, R: 0.2, room}); b.pop();`
* **Round / polygon facade**: `K.polyWalls(b, K.ringPolygon(0, 0, r, n), {y0, y1, T, outer, openings: (e) => [...],
  units: (e, ops) => ops.forEach((o) => K.windowUnit(b, {...o, R: 0.2}))})`, bands with
  `K.curvedBand(b, K.ringBandPath(0, 0, r, depth), y, {w: 2*r, d: 2*r, project: K.radialProjector(0, 0, r), inside: K.radialInside(0, 0, r)})`.
* **Entrance**: landing slab at FFL, `K.steps` to the terrain, `K.rampAlong` (≤ 1:12) for the main door,
  `K.canopyFlat/canopyCurved`, `K.wallLight`, `K.plaque` (place them with `solidSpot`), `K.doorUnit({kind:'glazed_double'})`.
* **Roof**: `K.roofSpec(...)`, `K.parapets` + `K.roofDeck` + core exit (`K.stairHouse` or `K.roofHatch`) + equipment on the
  service side (`K.hvacUnit`, vents above wet shafts) + `K.roofGarden` / `K.solarArray`; scuppers + `K.downpipe`;
  pitched: `K.pitchedRoof`.
* **Ground contact**: `K.plinth(b, spec, ffl)` always; `K.retainingSteps` where terrain rises above the floor.
* **Utility buildings (O zone)**: style `o_utility` gives panel shells, `steel_yellow` rails, roof gravel,
  small windows; use `K.louvrePanel`, `K.ladder`, `K.handrail`, `K.waterTank`, `K.plantRoom`, `K.canopyFlat`.

## 7. Batching (city BatchedMesh / merged geometry, decision D5)

Every kit material works unchanged in per-building meshes, merged geometry and `THREE.BatchedMesh`:
* **Shaders keep three's batching chunks.** The patches only insert code after `<project_vertex>`,
  `<color_fragment>`, `<lights_fragment_maps>`, `<lights_fragment_end>`, `<emissivemap_fragment>`,
  `<opaque_fragment>`; nothing replaces `batching_*`, `project_vertex` or `worldpos_vertex`. The world
  position / normal varyings (`VERT_XFORM`) apply `batchingMatrix` (USE_BATCHING) and `instanceMatrix`
  (USE_INSTANCING) exactly like three's own chunks; the interior-mapping room frame is taken in the
  geometry's own frame (building frame in a BatchedMesh; any frame whose +Y is up works).
* **No per-building uniforms, no onBeforeRender.** Uniforms are shared (`BUILDING_UNIFORMS`, lighting) or
  per material key (dust / macro amounts). Everything per building or per room travels as vertex data:
  `color` (tint), `uv` (metres, baked box projection), `iwin0/1/2` (room size, ids, hash, kind, profile),
  `idl` (indoor daylight), `facade/facadeId` (far LOD). A batch therefore needs no per-instance data
  beyond its matrix.
* **Same attribute set for every part of a key**: `position, normal, uv, color` + the key's extras
  (`EXTRA_ATTRIBUTES` in `MeshBuilder.js`; `attributeNamesOf(key)` from `materials.js`). Types never add
  extras to vocabulary keys (only `megastructures` declares extras, for its own `mega_*` keys).
* `materials.js` exports for batch builders: `castsShadow(key)` / `NO_SHADOW_KEYS`, `renderOrderOf(key)`
  (transparent glass 2), `isTransparentKey(key)`, `attributeNamesOf(key)`, `getBuildingMaterial(key, app)`.
* Transparent keys (`glass_clear`, `glass_railing`, `glass_agri`) use premultiplied `CustomBlending` and
  `depthWrite false`: sort / draw them after the opaque batches (`renderOrderOf`).

Performance: buffers are pooled; prefer `box` with face masks / `bar` over `cbox` for small parts,
sweep simplified polylines (`K.simplify`), avoid per-vertex allocations. Targets (worker, CPU): mass
≤ 2 ms, exterior 10-storey block ≤ 40 ms, full ≤ 200 ms — measure with `node scripts/bench-buildings.mjs`
(wall + CPU time) or the bench page `dev/buildings.html?bench=1` (in a real worker).
