# memory — cross-module leak fixes (fix round 3)

Owner scope: targeted dispose / eviction / cache-cap edits in src/render/**, src/props/**, src/megastructures/**
(small Edit operations; module owners edit the same files this round). Every change is logged here with the
module owner named.

## Fix round 3

### 18:50 start
* Item ★LEAK (QQ2-02 + lead): single page over 35–45 min grows renderer.info.memory textures 3075→7389,
  geometries 949→2099 (shots/qa2-quality/A/reportA.json), GPU process 8.1 GB + renderer 7.3 GB → "Target crashed".
* Baseline snapshot build of the current tree (before any memory edit): `.build/memory-base`, served on 5401.
* Soak tool: `scripts/memory-soak.mjs` (one page, zoom ladder orbit→1000 km→100 km→20 km→5 km→1 km→street→200 m lateral,
  4 sites rotating, lateral shift on every revisit, day/night alternating, viewport resize each cycle; logs
  renderer.info.memory / programs / scene objects / main heap after GC / worker queue / per-system stats / OS
  footprint of the renderer + GPU processes). Baseline run queued (20 min, dwell 30 s, workers=2).

### 19:15 static audit → fixes (all small targeted edits, each marked `fix round 3 (memory)` in the source)
Findings (static audit of every allocation / dispose path in render/**, props/**, megastructures/**):
* No per-frame allocation leak in pipeline (capture / resize dispose their targets), atmosphere, clouds, mega LODs,
  props movers (fixed-capacity instancing), wakes. The growth is caches that are far too big + CPU copies they pin:
  - **terrain** (owner terrain-render): DataTexture keeps every tile's texel arrays in `image.data` after upload (up to
    3 MB JS per cached 512² tile); normal / morphDelta / trWl attribute arrays kept on the CPU (~140 KB / tile); cache cap
    1.8 GB GPU / 3000 tiles; quadtree Node objects never pruned (thousands per new place, monotonic).
  - **water** (owner water): one cache entry per terrain tile that ever showed, land tiles included (900 entries), each
    pinning the terrain tile OBJECT (heights, water grids, disposed mesh → geometry arrays + material → textures) long
    after terrain evicted the tile.
  - **city** (owner city): GpuBatch GPU buffers grow ×1.3 and never shrink (session peak kept forever); hidden mass tiles'
    GPU geometry not counted by the cache cap (CPU estimate only).
  - **props** (owner props): `cityCache` kept the last 400 CityTileData of the whole ~19 km city disc (~1 MB each in a city),
    though props only place tiles within ~2 km.
Fixes:
1. terrain/material.js `makeTexture`: `t.onUpdate = releaseTexels` (texel array dropped after upload; size kept; no
   version bump → never re-uploaded). terrain/index.js `_createGpu`: normal / morphDelta / trWl `onUpload(releaseAttrArray)`
   (position stays: raycast + node.positions; index / uv shared).
2. terrain/index.js caps: `TERRAIN_CFG.cacheBytes` 1.8e9 → 1.0e9, new `cacheTiles: 1800` (was hard-coded 3000 / 2700).
3. terrain/index.js `_dispose`: marks the tile object `evicted = true` and drops `info.mesh` (consumers holding the object
   no longer pin the disposed mesh). Additive field `tile.evicted` (ARCHITECTURE §8 terrain).
4. terrain/index.js `_prune()` every 240 frames: child quads that are all EMPTY leaves (no job / result / upgrade, not
   drawn, not in the camera chain, untouched 600 frames) are dropped; `ensureChildren()` recreates them.
5. water/index.js `_onRemove`: mesh-less entries deleted at once; `_evict`: hidden-mesh cache capped 320 → 256 (counts
   hidden meshes only), sweep every 30 frames drops cached meshes whose terrain tile was evicted (never reusable).
6. city/batch.js `GpuBatch._trim()`: when `liveCount` reaches 0 the GL buffers shrink to 1/8 of the initial capacity
   (≥ 4096 vertices; detail batches start at 131072 vertices ≈ 10 MB each, ~60 kit batches ≈ 0.6 GB idle at orbit);
   they regrow on demand through the existing ×1.3 GPU-copy path.
7. city/index.js `_touchWanted`: hidden mass tiles also capped by GPU bytes (`CITY_CFG.cacheGpuBytes` 320e6, LRU by
   wantFrame); `stats.tilesCachedGpuBytes`.
8. props/tiles.js `cityCache`: only announcements with `tile.dist ≤ 4 km`, LRU, 96 max (city.tileData() still serves
   every streamed tile).
Node unit checks: `node shots/memory/unit.mjs` → 21/21 PASS (batch trim + re-use, texel release w/o version bump,
prune bottom-up / keeps READY + recent, water cache rules, city GPU cap LRU).
Owners told here: terrain-render (1–4), water (5), city (6–7), props (8). Requests: see below.

### 19:20 browser
* Single machine slot held by qa2-shots chain3 since 18:47 (S06–S09c + C01–C10 captures, est. > 1 h). My soak chain is
  queued in one slot: after-run (fixed build `.build/memory`, 26 min) then baseline (`.build/memory-base`, 14 min), both
  served by one preview on 5401 (`/memory/`, `/memory-base/`). `shots/memory/chain.sh`.

### 19:30 caps tightened before the soak starts
* terrain cap 1.0e9 / 1800 tiles (displayed set at street level ≈ 0.4–0.6 GB, leaves ~0.4–0.6 GB of hidden cache);
  batch trim target 1/8 of initial. `.build/memory` rebuilt (soak still queued behind qa2-shots chain3).
* Before-curve from QA evidence (QQ2-02, shots/qa2-quality/A/reportA.json, same page, workers=6): textures 3075 (C03,
  ~9 min) → 3267 → 4241 (C04, same pose) → 5890 (C06) → 7389 (C05, 45 km away, 33 min) → crash at S07 (41 min);
  geometries 949 → 1041 → 1493 → 1741 → 2099. Explained by the caps: terrain alone may hold 3000 tiles × 2–3 textures.

### Requests (other owners — not edited by memory)
* **ui** `src/ui/buildingIndex.js`: `MAX_TILES = 600` keeps the full BuildingSpec arrays of the last 600 announced city
  tiles (~2.5 KB per spec, 200–400 specs per city tile → up to ~0.5 GB JS heap pinned after the city evicted those
  tiles). Store slim records ({id, lat, lon, use, province, name/height}) or cap at ~120 tiles.
* **lead / core** `src/app/App.js` `__MARS__.stats()`: add `programs: info.programs.length` and
  `heapMB: performance.memory?.usedJSHeapSize / 2**20` (QQ2-02 suggestion; the soak reads them directly meanwhile).
* **urban** `src/world/urban/*` Lru caps are entry counts (layoutCache 8000, infoCache 80000, candCache 90000,
  townCache 60000, corridors 16k–60k, two generations each) and every worker (world 2–8, city 2–6, props 3) holds its own
  copy; please make the big ones byte-aware or smaller and expose `lruStats()` through a worker job so the soak can
  log worker cache sizes.
* **city** (optional, decide with the lead): detail residency `DETAIL_CFG.byteBudget` 2.6e9 / `triBudget` 36e6 is the single
  largest GPU allocation (dense views hold ~2–2.6 GB of kit geometry + growth slack); fine on its own, but together with
  terrain / mass / water / shadow maps it is what pushed the GPU process to ~8 GB under memory pressure.

### 19:40 Node-side soak (browser slot still held by qa2-shots chain3: S06/S08 done 19:3x, C01–C10 still to come)
* `shots/memory/node-soak.mjs` runs the REAL `TerrainSystem` (+ the water system's tile-event cache: real `_onAdd` /
  `_onRemove` / `_evict`) with a mock renderer (upload = texture `onUpdate` / attribute `onUploadCallback`, like three),
  a mock worker pool (8 tiles / frame, synthetic tiles with the real array sizes, heights from the real `heightAt`) and the
  soak ladder (8 poses × 4 sites, lateral shift per revisit). `before` emulates the pre-fix code of exactly the touched
  paths (caps 1.8e9 / 3000, no texel release, old `_dispose` / water `_onRemove` / `_evict`, no prune). Logs per pose:
  resident / drawn tiles, live textures / geometries, live tile objects (WeakRef), live texel arrays (WeakRef),
  ArrayBuffer MB after GC, quadtree nodes, water entries → `shots/memory/node-soak-{before,after}.json`, curves
  `shots/memory/node-curves.png` (`plot-node.mjs`).
* `shots/memory/frag.mjs`: GpuBatch first-fit fragmentation under churn — capacity stays 1.1–1.5× the peak live bytes
  (bounded, but it creeps while a batch is never empty; the empty-trim resets it whenever the camera leaves the district).

### How to run the browser soak (not run by memory this round — the single machine slot never freed)
```
# serve a build (any port you own), then, inside the browser slot:
node scripts/slot.mjs -- node scripts/memory-soak.mjs --base http://127.0.0.1:<port> --minutes 26 --dwell 30 \
     --out shots/memory/after --query "&workers=2"
node shots/memory/plot.mjs shots/memory/base/soak.jsonl shots/memory/after/soak.jsonl shots/memory/curves.png
```
`shots/memory/chain.sh` runs after (26 min, `.build/memory` = this round's fixes) then base (14 min, `.build/memory-base` =
the tree before the memory edits) against one preview of `.build` on 5401 (`/memory/`, `/memory-base/`). Pass criteria:
per-cycle maxima of textures / geometries / main heap / renderer + GPU footprint flat after cycle 2–3, no crash.

### 20:16 results (Node soak, 6 cycles × 8 poses × 70 frames, 4 sites, `shots/memory/node-curves.png`)
Per-cycle maxima (red = before emulation, green = after):
```
before: cycle | resident | textures | liveInfos | liveTexelArrays | arrayBuffersMB | nodes | waterEntries
before: c0 | 1570 | 3928 | 1570 | 3942 | 1098 | 1570 | 843
before: c1 | 2002 | 5008 | 2002 | 5056 | 1399 | 2742 | 889
before: c2 | 2141 | 5354 | 2141 | 5384 | 1433 | 4006 | 858
before: c3 | 2079 | 5197 | 2079 | 5313 | 1433 | 4970 | 865
before: c4 | 2088 | 5220 | 2088 | 5300 | 1425 | 5314 | 873
before: c5 | 2000 | 5005 | 2000 | 5089 | 1406 | 5526 | 882
after:  c0 | 1122 | 2808 | 1122 |    0 |  113 | 1570 | 732
after:  c1 | 1223 | 3060 | 1223 |    0 |  120 | 2502 | 711
after:  c2 | 1234 | 3088 | 1234 |    0 |  120 | 2514 | 762
after:  c3 | 1184 | 2961 | 1184 |    0 |  117 | 2702 | 702
after:  c4 | 1221 | 3055 | 1221 |    0 |  122 | 2766 | 753
after:  c5 | 1246 | 3118 | 1246 |    0 |  122 | 2574 | 684
```
* After: every curve flat from cycle 1 (resident ≈ 1.2 k tiles at the 1.0 GB GPU cap, textures ≈ 3.0 k, ArrayBuffers
  ≈ 120 MB after GC, 0 live texel arrays, tile objects = resident, nodes bounded 2.5–2.8 k, water entries = drawn tiles).
* Before: ArrayBuffers 1.1–1.43 GB (texel copies of every resident tile + ~100–300 extra pinned through water entries of
  evicted tiles), textures 5.0–5.4 k (would reach ~7.5 k at the 3000-tile cap in the real app, cf. QQ2-02's 7389),
  quadtree nodes grow monotonically (1.6 k → 5.5 k in 6 cycles, no plateau).
* The browser soak (renderer / GPU footprints, city / props / water GPU parts in the real page) is NOT run: slot held by
  qa2-shots chain3 the whole time box (S06–S09 done ~20:1x, then data0809 + C01–C10 + extras). Queued chain cancelled
  at hand-off; `shots/memory/chain.sh` + `scripts/memory-soak.mjs` ready (see "How to run").
* Final `npx vite build --outDir .build/memory` OK; unit checks 21/21; preview on 5401 stopped.
