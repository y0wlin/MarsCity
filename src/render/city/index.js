// City streaming: L13 city tiles → far mass models (worker-built, far facade shader), detailed
// buildings near the camera ('exterior' / 'full' with interiors + colliders), streets & ground,
// picking, selection outline, walk colliders. OWNER: city agent.
//
// CONTRACT (ARCHITECTURE.md §8 city; used by controls / ui / props)
//   init(), update(frame), isIdle()   isIdle is false while visible tiles / buildings are loading
//   raycast(originRender:Vector3, dirRender:Vector3)
//       -> {type:'building', id, buildingId, spec, distance, point:Vector3 (render), part:'mass'|lod} | null
//   getBuilding(id) -> {spec, object3d?, lod?, tile?} | null      (synchronous, streamed buildings)
//   focusInfo(id) -> Promise<{centerEcef, radius, heading, spec, entrances:[{kind, positionEcef,
//       dirEcef, width, side}], frame:{originEcef, quaternion}, anchors?, cameras?}> | null
//       works for any id (spec regenerated in a worker via 'buildingSpec' when not streamed) and
//       requests the 'full' LOD (interiors) of that building
//   getColliders(nearEcef, radius) -> [{mesh (geometry.boundsTree MeshBVH), anchorEcef, quaternion, id}]
//       'full' building colliders + street kerbs / sidewalks / steps / bridge decks near the point;
//       requests 'full' for buildings around the point (available a few frames later)
//   findBuildings({near:{lat,lon}|{x,y,z}, radius=500, use?, limit=200}) -> [{spec, distance}]
//   tiles() -> displayed tile records; tileData(key) -> CityTileData | null
//   events: 'city:tile' {tile, data} when a tile is displayed, 'city:tile-remove' {key, tile}
//   settings: outlines (selection outline unless clean), debugLayer 'objectId' | 'wireframe' | 'lod'
//   farCoverage -> {maxDist0, maxDist1, fadePx:[a, b], typicalSize, K, streamDist, truncated}: the camera distance
//       band (m) over which mass models dissolve (incl. the maxTiles truncation of the streamed disc) and the
//       projected-size fade (px) of a typicalSize (m) building — terrain draws its window aggregate as the complement
//   bridges.list() -> long bridges (decision DB) collected from the streamed tiles (bridges.js)
import * as THREE from 'three';
import { R, CITY_TILE_LEVEL, MAX_TILE_LEVEL } from '../../core/constants.js';
import { origin } from '../../core/origin.js';
import { latLonToUnit, ecefToLatLonH, parseTileKey, tileAt, tileKey } from '../../core/geo.js';
import { CITY_UNIFORMS } from './massMaterial.js';
import { INFO_STRIDE } from './massBuild.js';
import { CityTile, tilesAround } from './tiles.js';
import { DetailManager, loadBuildingMaterials, buildingFrameOf, whenCompiled } from './detail.js';
import { StreetManager } from './streets.js';
import { BridgeManager } from './bridges.js';
import { SelectionOutline } from './outline.js';
import { createCityPool } from './pool.js';

export const CITY_CFG = {
  refHeight: 30,        // m: a building of this height decides how far mass tiles are streamed
  minPx: 2.2,           // ... at this many device pixels
  maxDist: 19000,       // m
  maxTiles: 520,        // displayed tiles cap (nearest first)
  nearTiles: 1600,      // m: tiles kept even outside the view frustum (turning around)
  cacheGpuBytes: 320e6, // fix round 3 (memory): ... and up to this many bytes of hidden mass geometry on the GPU
  cacheBytes: 220e6,    // hidden tiles kept in memory up to this many (estimated JS) bytes; a tile is
                        // regenerated in ~20 ms of worker time, so the cache only smooths turning around
  uploadMs: 6,          // per frame main-thread budget for new tiles
  selectEvery: 6,       // frames between streaming selections (or when the camera moved)
  hideFrames: 45,       // frames a tile stays displayed after it stopped being wanted
  seatBudget: 2500,     // mass seat targets re-evaluated per frame (round robin)
  seatErr: 2,           // m: a mass model follows the displayed terrain only while the tile under it
                        // has a larger mesh error (coarse / still loading); refined → planned ground
};

const _ray = new THREE.Ray(), _lray = new THREE.Ray(), _inv = new THREE.Matrix4(), _sph = new THREE.Sphere(), _v = new THREE.Vector3();

const _seatP = { x: 0, y: 0, z: 0 };
export class CitySystem {
  constructor(app) {
    this.app = app;
    this.cfg = { ...CITY_CFG };
    this.tilesMap = new Map();     // key -> CityTile
    this.results = [];
    this.frameNo = 0; this.time = 0;
    this.K = 1400;
    this.changed = false;
    this._busy = true;
    this._lastSel = { x: NaN, y: NaN, z: NaN, f: -1e9, q: new THREE.Quaternion() };
    this.stats = { tilesWanted: 0, tilesDisplayed: 0, tilesLoading: 0, tilesCached: 0, buildings: 0, massTris: 0, massBytes: 0, tileMs: 0, tileBuilt: 0, uploadMs: 0 };
    this.specCache = new Map();
    this.hoverId = null; this.selectedId = null;
  }

  async init() {
    const app = this.app;
    // dedicated workers (city.worker.js): city tiles / detailed buildings / streets never wait behind
    // the shared pool's terrain jobs; falls back to app.workers
    this.pool = createCityPool() || app.workers;
    // GPU batches (batch.js) add two VERTEX-stage samplers (batchingTexture, batchingIdTexture) to the
    // kit / street programs; three's unit warning counts every sampler of a program against the
    // fragment-stage limit (MAX_TEXTURE_IMAGE_UNITS, 16 on Apple GPUs) and would log on every draw.
    // The real per-stage limits are still enforced by the GL at link time (a fragment shader with > 16
    // samplers fails to link and three reports it), so the warning threshold is raised to the units a
    // program can actually bind (fragment + vertex, ≤ MAX_COMBINED_TEXTURE_IMAGE_UNITS).
    try {
      const caps = app.renderer.capabilities, gl = app.renderer.getContext();
      const combined = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 0;
      const lim = Math.min(combined, (caps.maxTextures || 16) + (caps.maxVertexTextures || 0));
      if (lim > caps.maxTextures) caps.maxTextures = lim;
    } catch { /* keep three's default */ }
    this.root = new THREE.Group(); this.root.name = 'city'; this.root.matrixAutoUpdate = false;
    app.scene.add(this.root);
    this.massGroup = new THREE.Group(); this.massGroup.name = 'city-mass'; this.massGroup.matrixAutoUpdate = false;
    this.root.add(this.massGroup);
    this.detail = new DetailManager(this);
    this.root.add(this.detail.group);
    this.streets = new StreetManager(this);
    this.root.add(this.streets.group);
    this.bridges = new BridgeManager(this);
    this.root.add(this.bridges.group);
    this.outline = new SelectionOutline(this);
    this.root.add(this.outline.group);
    loadBuildingMaterials(app, this.pool);   // async: detailed buildings wait for it
    app.events.on('select', (sel) => this._onSelect(sel));
    app.events.on('hover', (h) => this._onHover(h));
    app.events.on('settings', ({ key }) => { if (key === 'debugLayer' || key === 'clean' || key === 'outlines') this._applySettings(); });
    app.events.on('mode', () => { this._lastSel.f = -1e9; });
    // the displayed terrain cut (terrain contract: tile:add / tile:remove {tile}) for the mass seating
    this._terr = new Map();      // numeric key -> terrain tile object {face, level, x, y, bounds, heights, geomErr, n}
    app.events.on('tile:add', ({ tile }) => { if (tile && tile.heights) this._terr.set(terrKey(tile.face, tile.level, tile.x, tile.y), tile); });
    app.events.on('tile:remove', ({ tile }) => { if (!tile) return; const k = terrKey(tile.face, tile.level, tile.x, tile.y); if (this._terr.get(k) === tile) this._terr.delete(k); });
    try { for (const tile of app.systems.terrain?.drawnTiles?.() || []) if (tile && tile.heights) this._terr.set(terrKey(tile.face, tile.level, tile.x, tile.y), tile); } catch { /* none yet */ }
    this._seatTargetFn = (t, i) => this._seatTarget(t, i);
    this._applySettings();
  }

  // ------------------------------------------------------------------------------------------
  update(frame) {
    this.frameNo++;
    this.time = frame.time ?? this.time + frame.dt;
    const vp = frame.viewport || { height: 900, pixelRatio: 1 };
    const fov = (frame.camera?.fov || 35) * Math.PI / 180;
    const lod = this.app.pipeline?.lodScale || 1;
    this.K = (vp.height * (vp.pixelRatio || 1) * lod) / (2 * Math.tan(fov / 2));
    CITY_UNIFORMS.uCityK.value = this.K;
    CITY_UNIFORMS.uCityFrame.value = frame.frameNo;
    // mass models dissolve over the outer 16 % of the streamed radius (no pop at its edge); when the maxTiles
    // cap truncates the disc, the band ends where the first dropped in-view tile begins (farCoverage)
    const dmax = this._effMaxDist();
    CITY_UNIFORMS.uCityMaxDist.value.set(dmax * 0.84, dmax * 0.97);
    if (frame.settings && frame.settings.debugLayer !== this._dbg) this._applySettings();

    this._select(frame);
    this._processResults(this.cfg.uploadMs);
    // seat the far city on the displayed terrain (round robin samples), then placement + state fades
    this._seat(frame);
    let fading = false;
    for (const t of this.tilesMap.values()) {
      if (!t.displayed) continue;
      t.place();
      if (t.stepFades(this.time)) fading = true;
      t.seatStep(frame.dt || 0.016);
      t.flushState();
    }
    if (this.frameNo % 3 === 0 || this.detail.queue.length) this.detail.select(frame, this._displayed());
    this.detail.upload(this.detail.cfg.uploadMs);
    this.detail.place();
    try { this.detail.updatePools(frame); } catch (e) { if (!this._poolWarned) { this._poolWarned = true; console.warn('[city] bollard pools', e); } }
    if (this._dbg === 'wireframe' && this.frameNo % 10 === 0) this.detail.updateWire(frame);
    this.streets.update(frame, this._displayed());
    this.bridges.update(frame);
    this.outline.update(frame);
    if (this.frameNo % 30 === 0) { this.detail.updateStats(); this._updateStats(); }
    const pend = this.results.length > 0 || this._loadingVisible > 0 || this.detail.pending() > 0 || this.streets.pending() > 0 || this.bridges.pending() > 0 || (this.pool !== this.app.workers && this.pool.pending > 0);
    this._busy = pend || fading;
  }

  /**
   * Mass seating (round robin over the buildings of the displayed tiles, budget per frame). Buildings
   * are planned on the analytic full-detail ground (spec.ground); detailed buildings and their walk
   * colliders always stay there. Only a mass model standing on a COARSE displayed terrain tile (mesh
   * error > seatErr) follows the displayed surface (within ±240 m, animated), so far / still-loading
   * terrain never swallows or floats the city; once the tile under it is refined the offset converges
   * to 0 and the terrain mesh, not the building, is what changed.
   */
  _seat(frame) {
    if (!this._terr) return;
    const list = this._displayed();
    if (!list.length) return;
    let budget = this.cfg.seatBudget;
    let guard = list.length;
    while (budget > 0 && guard-- > 0) {
      this._seatIdx = ((this._seatIdx || 0) + 1) % list.length;
      const t = list[this._seatIdx];
      budget -= t.seatSample(this._seatTargetFn, Math.min(budget, 400)) + 8;
    }
  }

  /** seat target (m) of building i of city tile t: displayed − planned ground on coarse terrain, else 0 */
  _seatTarget(t, i) {
    const tt = this._terrainTileAt(t, t.bFace[i], t.bA[i], t.bB[i]);
    if (!tt || !(tt.geomErr > this.cfg.seatErr)) return 0;
    let h = terrainHeightIn(tt, t.bA[i], t.bB[i]);
    // the DRAWN ground: around the camera nadir terrain-render shifts coarse tiles onto the analytic ground
    // (terrain.displayShift, the datum shift of the camera-first refinement) — tile.heights are unshifted (QZ2-06)
    const T = this.app.systems && this.app.systems.terrain;
    if (T && T.displayShift) { const sh = T.displayShift(t.buildingCenter(i, _seatP)); if (Number.isFinite(sh)) h += sh; }
    const d = h - t.trueG[i];
    if (!Number.isFinite(d) || Math.abs(d) < 0.4) return 0;   // the walls reach 4 m below the lowest corner
    return Math.max(-240, Math.min(240, d));   // tiles.js SEAT_MAX 250 (QZ2-06: canyon tiles > 60 m off)
  }

  /**
   * Displayed terrain tile containing face point (a, b): the displayed cut is a partition, so exactly
   * one level holds it; levels are tried outwards from the one found last for city tile t.
   */
  _terrainTileAt(t, face, a, b) {
    const T = this._terr;
    const h = t.terrL >= 0 ? t.terrL : 15;
    for (let d = 0; d <= MAX_TILE_LEVEL; d++) {
      for (let s = 0; s < (d ? 2 : 1); s++) {
        const L = s ? h - d : h + d;
        if (L < 0 || L > MAX_TILE_LEVEL) continue;
        const n = 2 ** L;
        const hit = T.get(terrKey(face, L, cl(Math.floor((a + 1) * 0.5 * n), n), cl(Math.floor((b + 1) * 0.5 * n), n)));
        if (hit) { t.terrL = L; return hit; }
      }
    }
    return null;
  }

  _displayed() { if (!this._dispList || this._dispFrame !== this.frameNo) { this._dispList = []; for (const t of this.tilesMap.values()) if (t.displayed) this._dispList.push(t); this._dispFrame = this.frameNo; } return this._dispList; }

  // ------------------------------------------------------------------------------------------
  // streaming selection
  // ------------------------------------------------------------------------------------------
  _select(frame) {
    const cam = frame.camEcef;
    const L = this._lastSel;
    const moved = Math.hypot(cam.x - L.x, cam.y - L.y, cam.z - L.z);
    const rot = frame.camera ? 1 - Math.abs(frame.camera.quaternion.dot(L.q)) : 0;
    const altG = Math.max(1, frame.camAltGround ?? frame.camAlt);
    if (!(moved > Math.max(30, altG * 0.04) || rot > 2e-4 || this.frameNo - L.f >= this.cfg.selectEvery * (this.results.length ? 1 : 4))) {
      this._touchWanted(); return;
    }
    L.x = cam.x; L.y = cam.y; L.z = cam.z; L.f = this.frameNo; if (frame.camera) L.q.copy(frame.camera.quaternion);
    const cfg = this.cfg;
    const Dmax = Math.min(cfg.maxDist, this.K * cfg.refHeight / cfg.minPx);
    const camR = Math.hypot(cam.x, cam.y, cam.z);
    const gh = frame.camAlt - altG;               // ground height under the camera
    if (altG > Dmax) { this.stats.tilesWanted = 0; this._wanted = []; this._touchWanted(); return; }
    const ground = Math.sqrt(Math.max(0, Dmax * Dmax - altG * altG));
    const p = { x: cam.x / camR, y: cam.y / camR, z: cam.z / camR };
    const cands = tilesAround(p, ground + 500, this._cands || (this._cands = []));
    const fr = frame.frustum;
    const list = [];
    const rr = R + gh;
    for (const c of cands) {
      const t0 = this.tilesMap.get(c.key);
      const h = t0 && t0.data ? t0.h0 : gh;
      const r = R + h;
      const dx = c.cx * r - cam.x, dy = c.cy * r - cam.y, dz = c.cz * r - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ds = Math.max(0, d - 470);
      if (ds > Dmax) continue;
      _sph.center.set(c.cx * r - origin.x, c.cy * r - origin.y, c.cz * r - origin.z);
      _sph.radius = 520 + (t0 && t0.maxTop ? Math.max(0, t0.maxTop) : 120);
      const vis = !fr || fr.intersectsSphere(_sph);
      if (!vis && ds > cfg.nearTiles) continue;
      // horizon: tile centre below the camera's horizon (with margin)
      const cosC = (c.cx * cam.x + c.cy * cam.y + c.cz * cam.z) / camR;
      if (cosC < rr / camR - 0.002) continue;
      list.push({ c, d: ds, vis, score: vis ? ds : ds * 2 + 1500 });
    }
    list.sort((a, b) => a.score - b.score);
    // maxTiles truncation: the streamed disc is complete only up to the nearest dropped in-view tile
    this._truncDist = null;
    if (list.length > cfg.maxTiles) {
      for (let i = cfg.maxTiles; i < list.length; i++) if (list[i].vis) { this._truncDist = list[i].d; break; }
      list.length = cfg.maxTiles;
    }
    this._wanted = list;
    this.stats.tilesWanted = list.length;
    this._touchWanted();
  }

  _touchWanted() {
    const fno = this.frameNo;
    const list = this._wanted || [];
    let loadingVisible = 0;
    for (const w of list) {
      let t = this.tilesMap.get(w.c.key);
      if (!t) { t = new CityTile(w.c.face, w.c.x, w.c.y); this.tilesMap.set(t.key, t); }
      t.wantFrame = fno; t.dist = w.d; t.priority = w.score;
      if (t.state === 'empty') this._request(t);
      else if (t.state === 'loading') { if (t.job) t.job.priority = tilePriority(t.priority); loadingVisible++; }
      else if (t.state === 'ready' && !t.displayed) this._show(t);
    }
    this._loadingVisible = loadingVisible + this.results.length;
    // hide tiles that are no longer wanted; cancel their jobs; evict the cache
    // fix round 3 (memory): hidden tiles also hold their mass geometry on the GPU (t.gpuBytes) — capped separately
    let cached = 0, cachedGpu = 0;
    const gpuCap = this.cfg.cacheGpuBytes || Infinity;
    for (const t of this.tilesMap.values()) {
      if (t.wantFrame >= fno - this.cfg.hideFrames) continue;
      if (t.state === 'loading') { if (t.job && !t.job.started) { try { t.job.cancel(); } catch { /* */ } t.job = null; t.state = 'empty'; } continue; }
      if (t.displayed) this._hide(t);
      if (t.state === 'ready') { cached += t.bytes; cachedGpu += t.gpuBytes || 0; }
      else if (t.state === 'empty' || t.state === 'failed') this.tilesMap.delete(t.key);
    }
    if (cached > this.cfg.cacheBytes || cachedGpu > gpuCap) {
      const hidden = [...this.tilesMap.values()].filter((t) => t.state === 'ready' && !t.displayed).sort((a, b) => a.wantFrame - b.wantFrame);
      for (const t of hidden) { if (cached <= this.cfg.cacheBytes * 0.85 && cachedGpu <= gpuCap * 0.85) break; cached -= t.bytes; cachedGpu -= t.gpuBytes || 0; t.dispose(this.massGroup); this.streets.drop(t); this.tilesMap.delete(t.key); }
    }
    this.stats.tilesCachedBytes = cached; this.stats.tilesCachedGpuBytes = cachedGpu;
  }

  _request(t) {
    const w = this.pool;
    if (!w) return;
    t.state = 'loading';
    const job = w.submit('cityTile', { face: t.face, x: t.x, y: t.y, mass: true, towns: this._towns() }, { priority: tilePriority(t.priority) });
    t.job = job;
    job.promise.then((data) => {
      if (t.job !== job) return;
      t.job = null;
      this.results.push({ t, data });
    }, (err) => {
      if (t.job !== job) return;
      t.job = null; t.state = 'empty';
      if (!err?.cancelled) { console.warn('[city] tile failed', t.key, err); t.state = 'failed'; }
    });
  }

  /** G02 work-town anchors (mega.towns(): static site data) for the tile jobs (render/city/towns.js) */
  _towns() {
    if (this._townList === undefined) {
      let list = null;
      try { const m = this.app.systems && this.app.systems.mega; const t = m && m.towns ? m.towns() : null; if (t && t.length) list = t.map((q) => ({ id: q.id, lat: q.lat, lon: q.lon, y: q.y, radius: q.radius })); } catch { list = null; }
      if (!list && this.frameNo < 600) return null;   // mega not ready yet: ask again next time
      this._townList = list;
    }
    return this._townList;
  }

  _processResults(budgetMs) {
    if (!this.results.length) return;
    const t0 = performance.now();
    this.results.sort((a, b) => a.t.priority - b.t.priority);
    while (this.results.length && performance.now() - t0 < budgetMs) {
      const { t, data } = this.results.shift();
      if (!this.tilesMap.has(t.key)) continue;
      if (data && data.massError) console.warn('[city] mass build failed', t.key, data.massError);
      try { t.install(data, this.app, this.massGroup); } catch (e) { console.error('[city] tile install failed', t.key, e); t.state = 'failed'; continue; }
      t.state = 'ready';
      t.group.visible = false;
      if (this._wire) t.setWire(true);
      // the first tile's mass program is linked off the frame (parallel shader compile) before any is shown
      if (!this._massReady && !this._massCompiling && t.mesh) {
        this._massCompiling = true;
        t.group.visible = true;
        whenCompiled(this.app, t.group).then(() => { this._massReady = true; this._massCompiling = false; if (!t.displayed && t.group) t.group.visible = false; });
      }
      if (data.mass && data.mass.stats) { this.stats.tileBuilt++; this.stats.tileMs += (data.mass.stats.genMs || 0) + (data.mass.stats.ms || 0); }
      if (t.wantFrame >= this.frameNo - this.cfg.hideFrames) this._show(t);
    }
    this.stats.uploadMs = Math.max(this.stats.uploadMs * 0.95, performance.now() - t0);
  }

  _show(t) {
    if (t.displayed || !t.group || !this._massReady) return;
    t.displayed = true;
    t.group.visible = true;
    t.place();
    this.changed = true;
    // selection / hover state of re-displayed tiles
    if (this.hoverId && t.byId.has(this.hoverId)) t.setHighlight(t.byId.get(this.hoverId), 128);
    this.app.events.emit('city:tile', { tile: t, data: t.data });
    try { this.bridges.addTile(t); } catch (e) { console.warn('[city] bridge pieces', t.key, e); }
  }

  _hide(t) {
    if (!t.displayed) return;
    t.displayed = false;
    if (t.group) t.group.visible = false;
    this.detail.dropTile(t);
    this.streets.hide(t);
    this.app.events.emit('city:tile-remove', { key: t.key, tile: t });
  }

  /** effective streamed radius (m): min(maxDist, K·refHeight/minPx), cut to the maxTiles truncation */
  _effMaxDist() {
    const dmax = Math.min(this.cfg.maxDist, this.K * this.cfg.refHeight / this.cfg.minPx);
    return this._truncDist != null ? Math.max(500, Math.min(dmax, this._truncDist / 0.97)) : dmax;
  }

  /**
   * Far coverage of the 3D city (terrain-render: window aggregate = complement): mass models are visible by
   * projected size smoothstep(fadePx[0], fadePx[1], size·K/d) × (1 − smoothstep(maxDist0, maxDist1, d)), d =
   * camera distance (m), evaluated for a typicalSize (m) building.
   */
  get farCoverage() {
    const d = this._effMaxDist(), F = CITY_UNIFORMS.uCityFadePx.value;
    return { maxDist0: d * 0.84, maxDist1: d * 0.97, fadePx: [F.x, F.y], typicalSize: this.cfg.refHeight, K: this.K, streamDist: d, truncated: this._truncDist != null };
  }

  // ------------------------------------------------------------------------------------------
  // queries
  // ------------------------------------------------------------------------------------------
  isIdle() { return !this._busy; }

  tiles() { return this._displayed().slice(); }
  tileData(key) { const t = this.tilesMap.get(key); return t && t.data ? t.data : null; }

  /** {tile, index} of a streamed building */
  _locate(id) {
    id = String(id);
    for (const t of this.tilesMap.values()) if (t.byId && t.byId.has(id)) return { tile: t, index: t.byId.get(id) };
    return null;
  }

  getBuilding(id) {
    if (id == null) return null;
    const loc = this._locate(id);
    if (loc) {
      const rec = this.detail.get(id);
      return { spec: loc.tile.data.buildings[loc.index], object3d: null, lod: rec && rec.lod ? rec.lod : 'mass', tile: loc.tile.key };
    }
    const s = this.specCache.get(String(id));
    return s ? { spec: s, object3d: null, lod: null } : null;
  }

  async _specById(id) {
    const key = String(id);
    const loc = this._locate(key);
    if (loc) return loc.tile.data.buildings[loc.index];
    if (this.specCache.has(key)) return this.specCache.get(key);
    const w = this.pool;
    if (!w) return null;
    try {
      const spec = await w.submit('buildingSpec', { id: key }, { priority: -50 }).promise;
      if (spec) { this.specCache.set(key, spec); if (this.specCache.size > 256) this.specCache.delete(this.specCache.keys().next().value); }
      return spec || null;
    } catch { return null; }
  }

  async focusInfo(id) {
    if (id == null) return null;
    const spec = await this._specById(id);
    if (!spec) return null;
    this.detail.wantFull(spec.id, 3600);
    const fr = buildingFrameOf(spec);
    const A = fr.axes, o = fr.originEcef;
    const toW = (x, y, z) => ({ x: o.x + A.x[0] * x + A.y[0] * y + A.z[0] * z, y: o.y + A.x[1] * x + A.y[1] * y + A.z[1] * z, z: o.z + A.x[2] * x + A.y[2] * y + A.z[2] * z });
    const toD = (x, y, z) => ({ x: A.x[0] * x + A.y[0] * y + A.z[0] * z, y: A.x[1] * x + A.y[1] * y + A.z[1] * z, z: A.x[2] * x + A.y[2] * y + A.z[2] * z });
    const w = (spec.footprint && spec.footprint.w) || 12, d = (spec.footprint && spec.footprint.d) || 12;
    const H = specHeight(spec);
    const rec = this.detail.get(spec.id);
    const entrances = [];
    const anchorEnts = rec && rec.anchors && rec.anchors.entrances;
    if (anchorEnts && anchorEnts.length) {
      for (const e of anchorEnts) if (e && e.pos) entrances.push({ kind: e.kind || 'main', positionEcef: toW(e.pos[0], e.pos[1], e.pos[2]), dirEcef: e.dir ? toD(e.dir[0], e.dir[1], e.dir[2]) : null, width: e.width || 1.6 });
    }
    if (!entrances.length) {
      for (const e of spec.entrances || []) {
        const off = e.offset || 0;
        let p, n;
        switch (e.side) {
          case 'back': p = [-off, 0, -d / 2]; n = [0, 0, -1]; break;
          case 'left': p = [-w / 2, 0, -off]; n = [-1, 0, 0]; break;
          case 'right': p = [w / 2, 0, off]; n = [1, 0, 0]; break;
          default: p = [off, 0, d / 2]; n = [0, 0, 1];
        }
        entrances.push({ kind: e.kind || 'main', side: e.side || 'front', positionEcef: toW(p[0], p[1], p[2]), dirEcef: toD(n[0], n[1], n[2]), width: e.width || 1.6 });
      }
    }
    const c = toW(0, H / 2, 0);
    return {
      id: spec.id, spec, centerEcef: c, radius: 0.5 * Math.hypot(w, d, H), heading: spec.heading || 0,
      entrances, frame: { originEcef: o, quaternion: { x: fr.quaternion.x, y: fr.quaternion.y, z: fr.quaternion.z, w: fr.quaternion.w } },
      anchors: rec && rec.anchors ? rec.anchors : null, cameras: rec && rec.anchors && rec.anchors.cameras ? rec.anchors.cameras : null,
      lod: rec ? rec.lod : null,
    };
  }
  focusData(id) { return this.focusInfo(id); }

  getColliders(nearEcef, radius = 14) {
    const out = [];
    if (!nearEcef) return out;
    this.detail.colliders(nearEcef, radius, out);
    this.streets.colliders(nearEcef, radius, out);
    // ask for 'full' around the walker (ready a few frames later)
    const P = {};
    for (const t of this._displayed()) {
      if (!t.info) continue;
      // only tiles that can hold a building near the point (tile half diagonal ≈ 470 m)
      const to = t.origin;
      if (Math.hypot(to.x - nearEcef.x, to.y - nearEcef.y, to.z - nearEcef.z) > 520 + radius + 60) continue;
      for (let i = 0; i < t.n; i++) {
        t.buildingCenter(i, P);
        const r = t.info[i * INFO_STRIDE + 3];
        if (Math.hypot(P.x - nearEcef.x, P.y - nearEcef.y, P.z - nearEcef.z) - r < radius + 25) this.detail.wantFull(t.data.buildings[i].id, 240);
      }
    }
    return out;
  }

  /**
   * Streamed buildings near a point. near {lat, lon} measures the horizontal (surface) distance to
   * the building centres; near {x, y, z} (ECEF) the straight-line distance.
   */
  findBuildings({ near, radius = 500, use = null, limit = 200 } = {}) {
    if (!near) return [];
    const surface = Number.isFinite(near.lat) && Number.isFinite(near.lon);
    const u = surface ? latLonToUnit(near.lat, near.lon) : null;
    const p = surface ? null : near;
    const out = [];
    const P = {};
    for (const t of this.tilesMap.values()) {
      if (!t.data || !t.info) continue;
      // tile pre-test (tile half diagonal ≈ 470 m)
      const to = t.origin, tl = Math.hypot(to.x, to.y, to.z);
      const td = surface ? Math.hypot(to.x - u.x * tl, to.y - u.y * tl, to.z - u.z * tl) : Math.hypot(to.x - p.x, to.y - p.y, to.z - p.z);
      if (td > radius + 520 + (surface ? 0 : 300)) continue;
      for (let i = 0; i < t.n; i++) {
        const s = t.data.buildings[i];
        if (use && s.use !== use && !(Array.isArray(use) && use.includes(s.use))) continue;
        t.buildingCenter(i, P);
        let d;
        if (surface) { const l = Math.hypot(P.x, P.y, P.z); d = Math.hypot(P.x - u.x * l, P.y - u.y * l, P.z - u.z * l); }
        else d = Math.hypot(P.x - p.x, P.y - p.y, P.z - p.z);
        if (d <= radius) out.push({ spec: s, distance: d });
      }
    }
    out.sort((a, b) => a.distance - b.distance);
    return out.slice(0, limit);
  }

  /**
   * Nearest building hit along a render-space ray: per tile a bounding-sphere test, then per building
   * AABB + exact triangles of its mass model (tiles.js raycastLocal). Buildings faded out by the
   * projected-size dither are ignored; a building whose detailed version is drawn is picked through
   * its (hidden) mass model, which encloses the same volume.
   */
  raycast(o, d) {
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    _ray.origin.set(o.x, o.y, o.z); _ray.direction.set(d.x / dl, d.y / dl, d.z / dl);
    const cand = [];
    for (const t of this._displayed()) {
      if (!t.mesh || !t.bsphere) continue;
      _sph.copy(t.bsphere).applyMatrix4(t.group.matrixWorld);
      const inside = _sph.distanceToPoint(_ray.origin) <= 0;
      const hit = inside ? null : _ray.intersectSphere(_sph, _v);
      if (!hit && !inside) continue;
      cand.push([hit ? _v.distanceTo(_ray.origin) : 0, t]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const fadePx = CITY_UNIFORMS.uCityFadePx.value.x, farD = CITY_UNIFORMS.uCityMaxDist.value.y;
    const K = this.K;
    // detailed buildings on screen: their own triangles (balconies, canopies, railings outside the hull)
    const dh = this.detail.raycast(_ray.origin, _ray.direction, 1e7);
    let best = null, bestT = null;
    for (const [enter, t] of cand) {
      if (best && enter > best.t) break;
      if (dh && enter > dh.t) break;
      _inv.copy(t.group.matrixWorld).invert();
      _lray.copy(_ray).applyMatrix4(_inv);
      const I = t.info, B = t.data.buildings;
      // mass models replaced by a drawn detailed version with a pick copy are skipped (tested above)
      const accept = (i, tt) => tt < farD && (I[i * INFO_STRIDE + 6] * K) / Math.max(1, tt) >= fadePx && !this.detail.picksFor(B[i].id);
      const h = t.raycastLocal(_lray, Math.min(best ? best.t : 1e7, dh ? dh.t : 1e7), accept);
      if (h && (!best || h.t < best.t)) { best = h; bestT = t; }
    }
    if (dh && (!best || dh.t <= best.t)) {
      const rec = dh.rec, spec = rec.spec;
      return { type: 'building', id: spec.id, buildingId: spec.id, spec, distance: dh.t, point: _ray.at(dh.t, new THREE.Vector3()), part: rec.lod || 'exterior', tile: rec.tile ? rec.tile.key : null, index: rec.bi };
    }
    if (!best) return null;
    const spec = bestT.data.buildings[best.i];
    const rec = this.detail.get(spec.id);
    return { type: 'building', id: spec.id, buildingId: spec.id, spec, distance: best.t, point: _ray.at(best.t, new THREE.Vector3()), part: rec && rec.lod ? rec.lod : 'mass', tile: bestT.key, index: best.i };
  }

  // ------------------------------------------------------------------------------------------
  // selection / hover / settings
  // ------------------------------------------------------------------------------------------
  _onSelect(sel) {
    const id = sel && sel.type === 'building' ? String(sel.id) : null;
    this.selectedId = id;
    if (id) this.detail.wantFull(id, 3600);
    this.outline.setTarget(id);
  }
  _onHover(h) {
    const id = h && h.type === 'building' ? String(h.id) : null;
    if (id === this.hoverId) return;
    const prev = this.hoverId ? this._locate(this.hoverId) : null;
    if (prev) prev.tile.setHighlight(prev.index, 0);
    this.hoverId = id;
    const s = this.app.state.settings;
    const cur = id && !s.clean ? this._locate(id) : null;
    if (cur) cur.tile.setHighlight(cur.index, 128);
  }
  _applySettings() {
    const s = this.app.state.settings;
    const dbg = s.clean ? 'none' : (s.debugLayer || 'none');
    this._dbg = s.debugLayer;
    CITY_UNIFORMS.uCityDebug.value = dbg === 'objectId' ? 1 : dbg === 'lod' ? 2 : 0;
    const wire = dbg === 'wireframe';
    // mass wireframe keeps its CPU index (tiles.js); wire meshes cast no shadow (the depth pass would
    // copy the wireframe flag)
    for (const t of this.tilesMap.values()) if (t.mesh) t.setWire(wire);
    this._wire = wire;
    this.detail?.setDebug(dbg === 'objectId' || dbg === 'lod' || dbg === 'wireframe' ? dbg : null);
    this.streets?.setDebug(dbg);
    this.bridges?.setDebug(dbg === 'objectId' || dbg === 'lod' || dbg === 'wireframe' ? dbg : 'none');
    if (s.clean && this.hoverId) { const l = this._locate(this.hoverId); if (l) l.tile.setHighlight(l.index, 0); }
    this.outline?.refresh();
  }

  _updateStats() {
    let disp = 0, loading = 0, bld = 0, tris = 0, bytes = 0, cached = 0;
    for (const t of this.tilesMap.values()) {
      if (t.state === 'loading') loading++;
      if (t.displayed) { disp++; bld += t.n; tris += t.mesh ? t.mesh.geometry.index.count / 3 : 0; bytes += t.bytes; }
      else if (t.state === 'ready') cached++;
    }
    Object.assign(this.stats, { tilesDisplayed: disp, tilesLoading: loading, tilesCached: cached, buildings: bld, massTris: tris, massBytes: bytes });
  }

  debugStats() {
    this.detail.updateStats(); this._updateStats(); this.streets.updateStats(); this.bridges.updateStats();
    return { ...this.stats, detail: { ...this.detail.stats, recs: this.detail.recs.size, jobs: this.detail.jobs }, streets: this.streets.stats, bridges: this.bridges.stats, busy: this._busy, K: Math.round(this.K), farCoverage: this.farCoverage };
  }

  dispose() {
    for (const t of this.tilesMap.values()) t.dispose(this.massGroup);
    this.tilesMap.clear();
    this.bridges.dispose();
    this.app.scene.remove(this.root);
  }
}

/**
 * Worker-pool priority of a city tile job (lower runs first). Terrain geometry uses negative
 * priorities and always runs first; terrain texture upgrades sit near 1000. Near tiles (< ~10 km)
 * run before texture upgrades, far ones after; detailed buildings / streets interleave by distance
 * (detail.js, streets.js use the same metres → priority scale).
 */
export function tilePriority(score) { return 100 + score / 24; }

// numeric key of a terrain quadtree tile (level ≤ 20 < 2^5, x, y < 2^22: exact in a double)
function terrKey(face, level, x, y) { return ((face * 32 + level) * 4194304 + x) * 4194304 + y; }
function cl(i, n) { return i < 0 ? 0 : i >= n ? n - 1 : i; }
/**
 * Height of the displayed terrain tile `tile` (tile:add object: bounds, heights n×n, row j·n+i, i along
 * a) at face coordinates (a, b), on the mesh's own triangles (alternating diagonals, as
 * terrain.groundHeightAt samples them).
 */
function terrainHeightIn(tile, a, b) {
  const B = tile.bounds, h = tile.heights, NV = tile.n || 65, N = NV - 1;
  const fu = Math.min(N, Math.max(0, (a - B.a0) / (B.a1 - B.a0) * N));
  const fv = Math.min(N, Math.max(0, (b - B.b0) / (B.b1 - B.b0) * N));
  const i0 = Math.min(N - 1, Math.floor(fu)), j0 = Math.min(N - 1, Math.floor(fv));
  const u = fu - i0, v = fv - j0, o = j0 * NV + i0;
  const h00 = h[o], h10 = h[o + 1], h01 = h[o + NV], h11 = h[o + NV + 1];
  if (((i0 + j0) & 1) === 0) return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + u * (h11 - h01) + v * (h01 - h00);
  return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}

export function specHeight(spec) {
  if (!spec) return 0;
  if (spec.meta && Number.isFinite(spec.meta.height) && spec.meta.height > 0) return spec.meta.height;
  const fl = spec.floors || 1, fh = spec.floorHeight || 3.1;
  return (fl - 1) * fh + (spec.groundFloorHeight || fh);
}

export { tileAt, tileKey, parseTileKey, latLonToUnit, ecefToLatLonH, CITY_TILE_LEVEL };
