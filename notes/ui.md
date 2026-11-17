# ui — progress log

Owner: ui agent. Files: src/ui/* (index.js, hud.js, toolbar.js, drawer.js, selection.js, nav.js,
labels.js, timebar.js, modebar.js, toast.js, diagnostics.js, keyboard.js, buildingIndex.js, query.js,
format.js, store.js, dom.js, widgets.js, icons.js, lookup.worker.js, panels/*, styles.css) and the UI
bench dev/ui.html (mock app; written by the ui agent in round 0). Private port 5213.
Verification driver (scratch, kept for QA): `.build/ui-dev/verify.mjs` — suites `bench` / `phone` (dev/ui.html,
light) and `app` / `app2` / `app3` (real app); dev server config `.build/ui-dev/vite.config.mjs`:
`npx vite --config .build/ui-dev/vite.config.mjs` then
`node scripts/slot.mjs --slots 3 -- node .build/ui-dev/verify.mjs --base http://127.0.0.1:5213 --suite phone --out shots/ui`.

## Fix round 1
Started 07:20, finished ~08:35. Items (lead brief): 1 'controls:hint' toast · 2 building viewpoint buttons ·
3 grouped bookmarks + save current view · 4 §6 toggles + search-by-ID flight · 5 no overflow at 390 px.

### Done
1. index.js `_onControlsHint`: 'controls:hint' {kind:'building-loading'} → toast "室内载入中，稍候即可进入"
   (kind 'loading' with spinner, key 'building-loading', 4.8 s; a repeat only refreshes the visible toast —
   toast.js `key`, `dismiss(key)`).
2. selection.js "人眼视点" grid between the province line and the facts: names from
   `nav.buildingViewNames(id)` → `controls.buildingViews(id)`; while unknown — null, or only the
   spec-synthesised street / entrance / back / roof (rooms not loaded) — the standard seven
   街对面 / 入口 / 门厅 / 楼梯 / 起居室 / 后院 / 屋顶. Labels per use (format.viewButtons / viewLabel: living →
   控制室 for water works, 种植走道 for greenhouses, 楼上室内 for other non-homes; extras 室内 / 露台 / 检修道 /
   控制室 / 闸门 / 吊装面 …; aliases listed once). Click → `nav.buildingView` → `controls.buildingView(id, name,
   {spec} only while no focus data)`; busy pulse while flying; the button stays pressed while the camera is at
   that viewpoint (`nav.markView` / `currentView`, 1 m / 6°; also set by the 'goto' of building-view bookmarks);
   toast when the controls fell back to another view or the view does not exist. 8th cell "存视点": one user
   bookmark per viewpoint ({buildingId, view} → revisits through controls.buildingView; already saved views
   skipped). Re-checked every 15 frames (update()).
3. panels/bookmarks.js: shot cards grouped by number (format.groupShots): S<nn> card with title, sub-title,
   note (2-line clamp, full when current), lens · local time, building ID; sub-frames indented under it;
   the group of the current card is tinted; turntable with the shared sol time note; user bookmarks show
   name, building ID + viewpoint (or coordinates + altitude), note, local time · mode · lens, world-version
   warning; inline editor for name + note; "存当前视角" stores pose, solTime, subsolarLat, mode, buildingId,
   use, and while the camera stands at that building's viewpoint view / viewPitch / viewLens, plus note,
   world, seed (store.js `update()`, import whitelist).
4. panels/layers.js in §6 order: 验收顺序 (① 正片观察 = labels + outlines + debug layers off, ② locate), 标注
   (labels, outlines), 调试图层 (正片 / 定位: 对象 ID, 地形线框, LOD / 通道: 法线, 环境光遮蔽 = pipeline
   `settings.debugView 'ao'`, real pipeline only / 控制图), 画面 (clean, clouds, diagnostics). debugView is
   suspended in clean mode and captures (index.js). Search: ID → "飞往 …" → "已定位 …" (+ toast when the
   drawer is closed); partial IDs list indexed buildings with that prefix (nearest first); spec lookups use the
   pool 'buildingSpec' job (one request per id; the UI worker only as fallback).
5. Phones: selection actions wrap (no sideways scroller), view grid 4 × minmax(0, 1fr), layer grid minmax,
   ellipsis labels. Drawer keeps a scroll position per tab.

### Verification
- Bench (dev/ui.html, mock controls with buildingViews / buildingView): shots/ui/fix1-bench-*.png, 0 console
  errors; repeated hint → 1 toast; saved view bookmark {buildingId, view 'living', viewPitch, world, seed};
  存视点 → 6 more (living skipped).
- Phone 390×844 (touch): shots/ui/fix1-phone-*.png; every visible #mars-ui element inside [0, 390], document
  scrollWidth 390, 0 sideways scrollers in 8 states (default, building panel, bookmarks top / user list,
  layers, search, time popover, diagnostics); 0 console errors.
- Real app (private dev server, workers=2, machine load avg ~150): search "ZR1-0.3.1a5.17w-n8.n6-7" + Enter →
  selected at once, focus flight arrived in 13.4 s (outline + label), 街对面 → walk at the street anchor
  (1.65 m), pressed; save current view stored view 'street'; hint toast; panels; AO channel listed
  (shots/ui/fix1-app-*.png). S07 shot card → street view, 街对面 pressed; panel 起居室 → 2nd-floor living room
  (545.86 m, walk) looking at the station canopy + train (shots/ui/fix1-app2-*.png). AO → clean → restored →
  none. S07 card → 存视点 (7 bookmarks) → saved 后院 bookmark revisited through applyBookmark →
  controls.buildingView: walk at the back yard (541.64 m), 后院 pressed, bookmark current
  (shots/ui/fix1-app3-revisit-back.png). 0 console errors / 0 warnings in all real-app runs (reports
  shots/ui/report-*.json). Build OK (`npx vite build --outDir .build/ui`, 43 s, after the last edit).
  Private server stopped.
- Note: URL landings (`?bookmark=S07`) do not select the building (App applies them directly; selection only
  on card clicks / search) — left unchanged on purpose (capture pipeline uses URL bookmarks).

### Remaining / known
- The viewpoint list stays the provisional seven after a buildingView from outside focus mode, and after
  focusBuilding until the 'full' anchors refresh the focus data (controls request below); buttons for views
  the building lacks fall back inside controls (toast names the view used).
- G02 work-town buildings (OX5-G02-T…) are found by ID only while streamed (buildingSpecById does not know them).
- The AO debug view shows the pipeline's raw AO target (yellow / green), not a grey AO image (atmosphere).

### Requests
- controls: `buildingViews(id)` answers only for the focused building (`modes.focus.info`); after a
  `buildingView(id, …)` / `enterBuilding(id)` from outside focus mode it stays null, so the panel keeps the
  provisional standard list. Please also answer for the building of the last buildingView / enterBuilding /
  getFocusInfo (cache the normalised info by id). Also: after focusBuilding the list is only the
  spec-synthesised street / entrance / back / roof until a buildingView refreshes `fm.info` with the 'full'
  anchors — refresh it when the focused building reaches 'full'.
- lead (app/bookmarks.js): S07s (楼梯，定格二→三之间) is listed after S07c; move it between S07b and S07c so the
  grouped shot list reads in visiting order. Optionally carry the view actually used in the 'goto' payload of
  building-view bookmarks ({bookmark, view}) so fallbacks (living → interior) light the right button.
- atmosphere (info): `settings.debugView 'ao'` copies the raw AO render target (reads yellow / green); a grey
  single-channel view would read better as the §6 "材质通道".

## Fix round 3
Started ~21:30 (private port 5313; browser budget: one at a time, ≤ 3 app screenshots). Items (lead brief):
UI1 lookup.worker resolves G02 work-town ids (pool 'buildingSpec' handler / towns.townSpecById) ·
UI2 bookmarks panel "验收视点" section (app/bookmarks.js CHECKS C01–C13) · UI3 saveAllViews stores each
view's actually resolved eye pose (buildingView r.requested + rig heading / pitch / lens), not the generic fallback.

### Plan / progress
- [x] UI1  - [x] UI2  - [x] UI3  - [x] Node checks  - [x] build  - [x] app screenshots (3)  - [x] ARCHITECTURE ui subsection
  Finished ~21:52.

### Done (code)
1. UI1 `lookup.worker.js`: resolves through the pool's own `'buildingSpec'` handler (dynamic import of
   `workers/handlers/lookup.js`: `townSpecById || buildingSpecById`), fallback `towns.townSpecById` → `urban.buildingSpecById`
   when the handler cannot load (a failed import is retried on the next request). Node check
   (`.build/ui-dev/fix3-worker-check.mjs`, drives the worker's onmessage in Node): 187/187 G02 work-town ids identical to the
   pool job, the S07 urban id identical to urban.buildingSpecById, unknown ids → null.
2. UI2 `panels/bookmarks.js` "验收视点" section between 昼夜转台 and 我的书签: CHECKS grouped by level (`format.splitCheckName`
   / `groupChecks`: 区级 C01–C02 · 街级 C03–C05 · 建筑四面 C06–C09 · 建筑屋顶 C10 · 冷启动 C11 · 巨构 C12–C13), rows in the
   shot-card look (id, title, 2-line note → full when current, lens · local time), current row / group tinted on 'goto';
   one-line intro (§6 网页可复现; orbit = shots 01/02, interior = shot 07). Search labels group 'check' as 验收视点.
3. UI3 `selection.js saveAllViews` (async): per view the actually resolved eye — `nav.recordView(id, asked, r)` = r.requested
   {lat, lon, alt} + rig heading / pitch / lens right after the arrival + r.mode; reuses arrivals from the panel's view
   buttons (≤ 10 min), visits the rest with `buildingView(…, {instant, pushBack:false})` (progress toast, busy button),
   follows the building's real view list once known (provisional names it lacks are dropped), dedupes fallbacks by the
   view used, returns to the start pose + mode (`nav.snapshot / restore`, flyTo duration 0, walk held / focus keepPose),
   stops on visitor input / another camera request (no return; saves what it has), 75 s per-view timeout. Bookmarks:
   `{view (used), pose (resolved), mode (walk/orbit), viewLens, viewSet: true}` (no viewPitch). `__MARS__.ui.saveViews()`.
   The restore snapshot is taken right before the first jump (the visitor may move while the list loads).
4. store.js `forBuilding(id)` (revisit by ID): the newest hand-saved bookmark of the building, else the 存视点 set's
   street view, else the newest of the set (was: simply the newest — after 存视点 that was the roof view).
   `viewSet` kept by import.
- Node tour check `.build/ui-dev/fix3-tour-check.mjs` (panel + nav without DOM, mock controls.buildingView): 18/18 —
  7 views, pose = requested lat/lon/alt + that arrival's rig heading / pitch / lens (not the lifted rig alt), mode walk,
  viewLens, no viewPitch, instant + no back entries, one restore to the start pose, second press visits / saves nothing;
  panel arrival reused (not revisited); provisional list → the building's real list after the first arrival (interior,
  no lobby / stair / living); visitor input at view 3 → 2 saved, no restore; fallback deduped + missing view named;
  forBuilding order; viewSet survives export / import.
- Browser run (`.build/ui-dev/verify3.mjs`, `slot.mjs --slots 1`, preview build on 5313, 1600×900, workers=2; slot at 21:36,
  8.4 min, report `shots/ui/report-fix3.json`): 0 console errors / 0 page errors / 0 warnings.
  - UI1: bench (pool mock without 'buildingSpec' → UI worker) `selectBuilding('OX5-G02-T1-0')` → greenhouse OX5 / O in 1.3 s,
    panel shown; in the app the same id through the pool → panel shown.
  - UI2 (`shots/ui/fix3-checks-panel.png`): section 验收视点, 13 rows C01–C13 in groups 区级 / 街级 / 建筑四面 / 建筑屋顶 /
    冷启动 / 巨构; C06 clicked → camera at the S07 front facade, row current (aria-current, full note).
  - UI3 (`shots/ui/fix3-saveviews.png`): S07 building selected (provisional list), 存视点 → 7 bookmarks in 6.7 s (all
    mode walk, 28 mm), camera back at the start (0 m, 0°, orbit). Saved pose vs a fresh `controls.buildingView` of the same
    view: ≤ 3 mm, heading / pitch identical, all 7 (source 'city'); vs the old generic stand-ins: street 54 m, entrance
    1.6 m, lobby 8.7 m, stair 14 m, living 15 m, back 93 m, roof 66 m off.
  - QP-02 repro (`shots/ui/fix3-revisit-living.png`): reload (S01 landing) → `nav.gotoBookmark(…, {instant})` of the saved
    roof / back / living: landed 2 mm / 6.8 cm (back re-seated on the final ground, pitch 0.29°) / 3 mm from the stored
    pose, walk, held (src bookmark, lifted 0), panel button pressed; living = 2F window over the station canopy + train.
- Final build `npx vite build --outDir .build/ui` OK (16.7 s) after the last edit; preview server stopped; no browser left.
  The browser run used the build before the last two edits (lazy restore snapshot, viewSet / forBuilding) — both covered
  by the Node tour check (re-run on the final code: all passed; worker check 187/187).

### Requests
- controls (optional): a dry-run `controls.resolveBuildingView(id, name, opts)` → `{requested, heading, pitch, lens, mode,
  view, source}` (everything buildingView decides — anchors, clear-view slide, ground seat — without moving the camera)
  would let 存视点 store the resolved eyes without the visible instant tour (the UI would switch to it when present).
