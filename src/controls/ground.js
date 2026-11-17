// Ground & surface queries for the camera: full-detail terrain height, water level, roofs,
// screen-ray intersection with the visible world (terrain ∪ buildings ∪ megastructures) with a
// robust analytic fallback, and swept-segment clearance. Everything here is float64 ECEF.
// OWNER: controls agent.
//
// Uses only system contracts (all optional, absence tolerated):
//   terrain.raycast(oRender, dRender) -> {distance, ecef, lat, lon, h}|null
//   terrain.heightAtLatLon(lat, lon) -> m
//   city.raycast / mega.raycast(oRender, dRender) -> {distance, ...}|null
//   city.getColliders / mega.getColliders(nearEcef, radius) -> [{mesh, matrixWorld?}]
//   water.levelAt?(lat, lon) -> m | null   (else the displayed terrain tiles' water grids
//                                           (tile.water.type/level, ARCHITECTURE §8), else sea rule)
import * as THREE from 'three';
import { R } from '../core/constants.js';
import { origin } from '../core/origin.js';
import { unitToLatLon, vecToFace } from '../core/geo.js';
import { waterAt } from '../world/hydro.js';
import { raySphere, raySilhouette } from './math.js';
import { raycastColliders } from './collide.js';

export const MAX_ALT = 6.0e7;   // 60,000 km above sea level
/** full-detail world heights are evaluated only for points closer than this to the tile surface */
export const FULL_DETAIL_AGL = 400;

const _oR = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const LL = {};

export class Ground {
  constructor(app) {
    this.app = app;
    this._hring = Array.from({ length: 8 }, () => ({ x: NaN, y: NaN, z: NaN, h: 0, kind: 0, t: -1e9 })); // terrain height cache
    this._hringI = 0;
    this._wc = { x: NaN, y: NaN, z: NaN, level: -Infinity };
    this._tiles = null; this._tilesT = -1e9; this._fv = {};
    // diagnostics: terrain queries (count, total ms), full-detail world evaluations (count, worst ms)
    this.stats = { terrain: 0, terrainMs: 0, full: 0, fullMaxMs: 0, raycasts: 0 };
    // NOTE: world/hydro.js waterAt is NOT called on the main thread: its first call initialises
    // the canal network (≈0.3 s in Chrome, seconds in Node) and new regions cost ~6 ms. The drawn
    // terrain tiles already carry the water grids (ARCHITECTURE §8 "Tile water data").
  }

  /** water surface from the displayed terrain tiles: level (m), -Infinity (dry) or null (no tile) */
  tileWaterAt(p) {
    const t = this.sys.terrain;
    if (!t || !t.drawnTiles) return null;
    const now = performance.now();
    if (!this._tiles || now - this._tilesT > 120) { try { this._tiles = t.drawnTiles() || []; } catch { this._tiles = []; } this._tilesT = now; }
    const L = Math.hypot(p.x, p.y, p.z) || 1;
    const f = vecToFace(p.x / L, p.y / L, p.z / L, this._fv);
    let best = null;
    for (const tile of this._tiles) {
      const b = tile && tile.bounds;
      if (!b || tile.face !== f.face || f.a < b.a0 || f.a > b.a1 || f.b < b.b0 || f.b > b.b1) continue;
      if (!best || tile.level > best.level) best = tile;
    }
    if (!best) return null;
    const w = best.water || best.waterData;
    if (!w || !w.type || !w.level) return -Infinity;
    const n = best.n || 65, N = n - 1, b = best.bounds;
    const fu = Math.min(N, Math.max(0, ((f.a - b.a0) / (b.a1 - b.a0)) * N));
    const fv = Math.min(N, Math.max(0, ((f.b - b.b0) / (b.b1 - b.b0)) * N));
    const i0 = Math.min(N - 1, Math.floor(fu)), j0 = Math.min(N - 1, Math.floor(fv));
    const u = fu - i0, v = fv - j0;
    const k00 = j0 * n + i0, k10 = k00 + 1, k01 = k00 + n, k11 = k01 + 1;
    const near = u < 0.5 ? (v < 0.5 ? k00 : k01) : (v < 0.5 ? k10 : k11);
    if (!w.type[near]) return -Infinity;
    const lv = w.level;
    return (lv[k00] * (1 - u) + lv[k10] * u) * (1 - v) + (lv[k01] * (1 - u) + lv[k11] * u) * v;
  }

  get sys() { return this.app.systems || {}; }

  // ---------------------------------------------------------------- terrain / water heights
  /**
   * Terrain height (m above sea level) at lat/lon: max(finest loaded tile surface, full-detail
   * world height). The full-detail evaluation (main thread: ~0.3 ms, the first query in a new
   * region builds its canal / lake caches, tens to hundreds of ms) is used only near the ground
   * (`full`; with `altAbove` — the height of the querying point — only within FULL_DETAIL_AGL of
   * the tile surface), so the camera never ends up below either the drawn mesh or the surface it
   * will refine to, and regional flights never pay for world evaluation.
   */
  terrainHeightLL(lat, lon, full = true, altAbove = null) {
    const t = this.sys.terrain;
    if (!t) return 0;
    let h = -Infinity;
    const t0 = performance.now();
    let usedFull = false;
    try {
      if (t.groundHeightAt) { const g = t.groundHeightAt(lat, lon); if (Number.isFinite(g)) h = g; }
      if (full && altAbove != null && h > -Infinity && altAbove - h > FULL_DETAIL_AGL) full = false;
      if (t.heightAtLatLon && (full || h === -Infinity)) { usedFull = true; const f = t.heightAtLatLon(lat, lon); if (Number.isFinite(f) && f > h) h = f; }
    } catch { /* tolerate a broken terrain system */ }
    const ms = performance.now() - t0;
    this.stats.terrain++; this.stats.terrainMs += ms;
    if (usedFull) { this.stats.full++; if (ms > this.stats.fullMaxMs) this.stats.fullMaxMs = ms; }
    this._lastFull = usedFull;
    return Number.isFinite(h) ? h : 0;
  }

  /**
   * Terrain height under ECEF point p; cached within tol metres. detail: 'auto' (full detail when
   * p is within FULL_DETAIL_AGL of the ground), true (always full detail), false (tiles only).
   */
  terrainHeightAt(p, tol = 0.02, detail = 'auto') {
    // small ring cache (the walker's feet, slope probes and the camera query a handful of points per
    // frame); entry kind: 2 full detail, 1 'auto' decision, 0 tiles only — reusable for requests ≤ it
    // (entries expire after 1 s: the loaded tiles refine under a resting camera)
    const need = detail === true ? 2 : detail === false ? 0 : 1;
    const ring = this._hring, now = performance.now();
    for (let i = 0; i < ring.length; i++) {
      const e = ring[i];
      if (e.kind >= need && now - e.t < 1000 && Math.abs(p.x - e.x) <= tol && Math.abs(p.y - e.y) <= tol && Math.abs(p.z - e.z) <= tol) return e.h;
    }
    const c = ring[this._hringI = (this._hringI + 1) % ring.length];
    unitToLatLon(p.x, p.y, p.z, LL);
    const alt = Math.hypot(p.x, p.y, p.z) - R;
    const h = need === 0 ? this.terrainHeightLL(LL.lat, LL.lon, false)
      : need === 2 ? this.terrainHeightLL(LL.lat, LL.lon, true)
        : this.terrainHeightLL(LL.lat, LL.lon, alt < 25000, alt);
    c.x = p.x; c.y = p.y; c.z = p.z; c.h = h; c.kind = need === 1 && this._lastFull ? 2 : need; c.t = now;
    return h;
  }

  /**
   * The terrain a WALKER stands on at ECEF p: the final full-detail world height (terrain.heightAtLatLon
   * = world/terrain.js heightAt, band limit 0) — never the loaded tiles, which are metres to hundreds of
   * metres off while they refine (Z-02: walkers stood on an L4 tile 146 m above the real slope and fell
   * when it refined). The shown terrain around the camera is shifted onto this ground by the terrain
   * system while its chain refines (terrain.displayShift), so the walker and the drawn ground agree.
   * Ring-cached within `tol` metres (the analytic height of a point never changes).
   */
  walkTerrainAt(p, tol = 0.002) {
    const ring = this._wring || (this._wring = Array.from({ length: 12 }, () => ({ x: NaN, y: NaN, z: NaN, h: 0 })));
    for (let i = 0; i < ring.length; i++) {
      const e = ring[i];
      if (Math.abs(p.x - e.x) <= tol && Math.abs(p.y - e.y) <= tol && Math.abs(p.z - e.z) <= tol) return e.h;
    }
    const e = ring[this._wringI = ((this._wringI || 0) + 1) % ring.length];
    let h = NaN;
    const t = this.sys.terrain;
    const t0 = performance.now();
    try { if (t && t.heightAtLatLon) { unitToLatLon(p.x, p.y, p.z, LL); h = t.heightAtLatLon(LL.lat, LL.lon); } } catch { h = NaN; }
    if (Number.isFinite(h)) {
      const ms = performance.now() - t0;
      this.stats.terrain++; this.stats.terrainMs += ms; this.stats.full++; if (ms > this.stats.fullMaxMs) this.stats.fullMaxMs = ms;
    } else h = this.terrainHeightAt(p, tol, true);   // (test benches without a world function)
    e.x = p.x; e.y = p.y; e.z = p.z; e.h = h;
    return h;
  }

  /** water surface level under p, or -Infinity when dry */
  waterLevelAt(p, tol = 0.5) {
    const c = this._wc;
    if (Math.abs(p.x - c.x) <= tol && Math.abs(p.y - c.y) <= tol && Math.abs(p.z - c.z) <= tol) return c.level;
    let level = -Infinity;
    const w = this.sys.water;
    try {
      let known = false;
      if (w && w.levelAt) {
        unitToLatLon(p.x, p.y, p.z, LL);
        const l = w.levelAt(LL.lat, LL.lon);
        if (l !== undefined) { known = true; level = Number.isFinite(l) ? l : -Infinity; }
      }
      if (!known) {
        const tl = this.tileWaterAt(p);
        if (tl !== null) level = tl;
        else if (this.terrainHeightAt(p, Math.max(0.05, tol)) < 0) level = 0; // no tile: the sea is wherever terrain < 0
      }
    } catch { level = -Infinity; }
    c.x = p.x; c.y = p.y; c.z = p.z; c.level = level;
    return level;
  }

  /**
   * Height (m above sea level) of what the camera must stay above at p:
   * max(terrain, water surface, roofs/decks directly below p). opts: {water, buildings, roofProbe}
   */
  floorHeightAt(p, opts = {}) {
    const L = Math.hypot(p.x, p.y, p.z);
    const alt = L - R;
    if (alt > 45000) return 0; // nothing reaches this high — skip the expensive queries
    // short-lived positional cache (terrain tiles refine under a resting camera: TTL 250 ms)
    const key = (opts.water === false ? 0 : 1) + (opts.buildings === false ? 0 : 2);
    const fc = this._fc || (this._fc = [{}, {}, {}, {}]);
    const c = fc[key], now = performance.now();
    const tol = Math.max(0.005, Math.min(20, (alt - (c.h || 0)) * 0.001));
    if (now - c.t < 250 && Math.abs(p.x - c.x) <= tol && Math.abs(p.y - c.y) <= tol && Math.abs(p.z - c.z) <= tol) return c.h;
    let h = this.terrainHeightAt(p, opts.tol ?? Math.max(0.02, Math.min(50, (alt - 2000) * 0.002)));
    if (opts.water !== false && alt - h < 3000) {
      const wl = this.waterLevelAt(p, Math.max(0.5, (alt - h) * 0.01));
      if (wl > h) h = wl;
    }
    if (opts.buildings !== false && alt - h < 1500) {
      const roof = this.roofHeightBelow(p, opts.roofProbe ?? 0.5);
      if (roof > h) h = roof;
    }
    c.x = p.x; c.y = p.y; c.z = p.z; c.h = h; c.t = now;
    return h;
  }

  /** forget cached floor heights (after big jumps) */
  invalidate() { if (this._fc) for (const c of this._fc) c.t = -1e9; for (const e of this._hring) e.x = NaN; this._wc.x = NaN; }

  /**
   * The FINAL ground at ECEF p from the pure world functions — full-detail terrain height
   * (terrain.heightAtLatLon = world/terrain.js heightAt at full detail) and the hydro water surface
   * (world/hydro.js waterAt) — independent of which terrain tiles happen to be loaded. Programmatic
   * poses (bookmarks, URL poses, building / megastructure views) are held against this ground: a coarse
   * tile drawn above the true surface must not lift them. Small positional cache (the world functions
   * cost ≈ 0.2–0.5 ms per point; the first query in a new region builds its caches).
   * Returns {terrain, water (level or -Infinity), h: max of both}.
   */
  analyticAt(p, tol = 0.02) {
    const ac = this._ac || (this._ac = Array.from({ length: 4 }, () => ({ x: NaN, y: NaN, z: NaN, terrain: 0, water: -Infinity })));
    for (const e of ac) if (Math.abs(p.x - e.x) <= tol && Math.abs(p.y - e.y) <= tol && Math.abs(p.z - e.z) <= tol) return { terrain: e.terrain, water: e.water, h: Math.max(e.terrain, e.water) };
    const e = ac[this._acI = ((this._acI || 0) + 1) % ac.length];
    const L = Math.hypot(p.x, p.y, p.z) || 1;
    let terrain = NaN, water = -Infinity;
    try {
      const t = this.sys.terrain;
      unitToLatLon(p.x, p.y, p.z, LL);
      if (t && t.heightAtLatLon) terrain = t.heightAtLatLon(LL.lat, LL.lon);
    } catch { terrain = NaN; }
    if (!Number.isFinite(terrain)) terrain = this.terrainHeightAt(p, tol, true);
    // (hydro only with the real world's water system present: test benches mock their own terrain)
    if (this.sys.water) {
      try {
        const w = waterAt(p.x / L, p.y / L, p.z / L, this._wa || (this._wa = {}));
        if (w && w.type) water = w.type === 1 ? 0 : w.level;
      } catch { water = this.waterLevelAt(p, 0.5); }
    } else water = this.waterLevelAt(p, 0.5);
    if (!Number.isFinite(water)) water = -Infinity;
    e.x = p.x; e.y = p.y; e.z = p.z; e.terrain = terrain; e.water = water;
    return { terrain, water, h: Math.max(terrain, water) };
  }

  /**
   * Highest building / megastructure surface directly below ECEF p, within [p − maxDown, p + probeUp]
   * (m above sea level, or -Infinity): exact walk colliders where they have streamed in (city 'full'
   * LOD, megastructure near LOD — asking for them also requests that LOD), else the picking geometry of
   * the displayed LOD (city mass hull, megastructure collider BVH). `cols`: colliders around p (optional).
   */
  structureBelow(p, maxDown, probeUp = 0.3, cols = null) {
    const L = Math.hypot(p.x, p.y, p.z);
    _u.set(p.x / L, p.y / L, p.z / L);
    let best = -Infinity;
    cols = cols || this.collidersNear(p, 6);
    if (cols.length) {
      _oR.set(p.x - origin.x, p.y - origin.y, p.z - origin.z).addScaledVector(_u, probeUp);
      _d.copy(_u).negate();
      const hit = raycastColliders(cols, _oR, _d, probeUp + maxDown, {});
      if (hit) best = L - R + probeUp - hit.distance;
    }
    const ids = new Set();
    let megaCols = false;
    for (const c of cols) { if (c._src === 'city' && c.id != null) ids.add(String(c.id)); else if (c._src === 'mega') megaCols = true; }
    const hb = this.hullBelow(p, probeUp, maxDown, (kind, id) => (kind === 'building' && id != null && ids.has(String(id))) || (kind === 'mega' && megaCols));
    if (hb && hb.h > best) best = hb.h;
    return best;
  }

  /** highest building/mega surface directly below p (within 2 km), or -Infinity */
  roofHeightBelow(p, probeUp = 0.5) {
    const L = Math.hypot(p.x, p.y, p.z);
    _u.set(p.x / L, p.y / L, p.z / L);
    _d.copy(_u).negate();
    _p.set(p.x + _u.x * probeUp, p.y + _u.y * probeUp, p.z + _u.z * probeUp);
    const hit = this.raycast(_p, _d, { terrain: false, city: true, mega: true, maxDist: 2000 });
    if (!hit) return -Infinity;
    return Math.hypot(hit.point.x, hit.point.y, hit.point.z) - R;
  }

  // ---------------------------------------------------------------- rays
  /**
   * Nearest visible-surface hit along a ray. o: ECEF origin, d: unit direction (ECEF axes).
   * opts: {terrain=true, city=true, mega=true, colliders=false, maxDist=Infinity}
   * Returns {distance, point:Vector3(ECEF), kind:'terrain'|'building'|'mega'|'collider', raw} or null.
   */
  raycast(o, d, opts = {}) {
    const s = this.sys;
    _oR.set(o.x - origin.x, o.y - origin.y, o.z - origin.z);
    const maxDist = opts.maxDist ?? Infinity;
    let best = null;
    const consider = (hit, kind) => {
      if (!hit || !Number.isFinite(hit.distance) || hit.distance < 0 || hit.distance > maxDist) return;
      // terrain's "nothing loaded along the ray" answer is a sea-level sphere guess: not a surface
      if (kind === 'terrain' && 'tile' in hit && hit.tile == null && !opts.acceptApprox) return;
      if (best && hit.distance >= best.distance) return;
      best = { distance: hit.distance, kind, raw: hit };
    };
    this.stats.raycasts++;
    if (opts.terrain !== false) { try { consider(s.terrain?.raycast?.(_oR, d), 'terrain'); } catch { /* ignore */ } }
    if (opts.city !== false) { try { consider(s.city?.raycast?.(_oR, d), 'building'); } catch { /* ignore */ } }
    if (opts.mega !== false) { try { consider(s.mega?.raycast?.(_oR, d), 'mega'); } catch { /* ignore */ } }
    if (opts.colliders) {
      const hit = raycastColliders(opts.colliders, _oR, d, maxDist);
      if (hit) consider({ distance: hit.distance, normal: hit.normal.clone() }, 'collider');
    }
    if (!best) return null;
    best.point = new THREE.Vector3(o.x + d.x * best.distance, o.y + d.y * best.distance, o.z + d.z * best.distance);
    // terrain under water: the visible surface is the water (grab / zoom / pick the water surface,
    // not the sea floor seen through it)
    if (best.kind === 'terrain' && opts.water !== false) this._waterEntry(o, d, best);
    return best;
  }

  /** replace an underwater terrain hit by the ray's entry into the water surface above it */
  _waterEntry(o, d, hit) {
    const p = hit.point;
    const L = Math.hypot(p.x, p.y, p.z);
    const level = this.waterLevelAt(p, Math.max(0.5, hit.distance * 1e-4));
    if (!(level > L - R + 0.02)) return hit;
    const t = raySphere(o, d, R + level);
    if (!(t >= 0) || t >= hit.distance) return hit;
    hit.floorDistance = hit.distance;
    hit.distance = t;
    hit.kind = 'water';
    hit.waterLevel = level;
    p.set(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    return hit;
  }

  /** reference ground height near the camera for analytic fallbacks */
  refHeight(o) {
    const L = Math.hypot(o.x, o.y, o.z);
    if (L - R > 60000) return 0;
    return Math.max(this.terrainHeightAt(o, Math.max(0.05, (L - R) * 0.01)), this.waterLevelAt(o, Math.max(0.5, (L - R) * 0.01)), -12000);
  }

  /**
   * Like raycast but always returns a usable anchor: the visible hit, else the ray against a
   * sphere at the local ground height ('sphere'), else (ray misses the planet) the silhouette
   * point ('silhouette'). Never null for finite inputs.
   */
  surfacePoint(o, d, opts = {}) {
    const hit = this.raycast(o, d, opts);
    if (hit) return hit;
    const r = R + this.refHeight(o);
    const t = raySphere(o, d, r);
    if (t >= 0) {
      const point = new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      return { distance: t, point, kind: 'sphere', raw: null };
    }
    const point = raySilhouette(o, d, r, new THREE.Vector3());
    return { distance: Math.hypot(point.x - o.x, point.y - o.y, point.z - o.z), point, kind: 'silhouette', raw: null };
  }

  /**
   * Largest fraction f ∈ [0,1] of the straight move p0→p1 that keeps `clearance` metres from any
   * building/mega surface (and terrain when opts.terrain) along the way.
   */
  sweep(p0, p1, clearance, opts = {}) {
    _d.set(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    const len = _d.length();
    if (len < 1e-6) return 1;
    _d.multiplyScalar(1 / len);
    const hit = this.raycast(p0, _d, { terrain: !!opts.terrain, city: opts.city !== false, mega: opts.mega !== false, colliders: opts.colliders, maxDist: len + clearance, water: opts.water });
    if (!hit) return 1;
    return Math.max(0, Math.min(1, (hit.distance - clearance) / len));
  }

  /** colliders near an ECEF point from every system that offers them (each tagged `_src`: 'city' | 'mega') */
  collidersNear(p, radius) {
    const out = [];
    for (const name of ['city', 'mega']) {
      const sys = this.sys[name];
      if (!sys || !sys.getColliders) continue;
      try {
        const list = sys.getColliders(p, radius);
        if (list && list.length) for (const c of list) if (c && c.mesh && c.mesh.geometry && c.mesh.geometry.boundsTree) { if (c._src !== name) c._src = name; out.push(c); }
      } catch (e) { if (!this._colErr) { console.warn('[controls] getColliders failed', e); this._colErr = true; } }
    }
    return out;
  }

  /**
   * Picking-hull surface (building mass model / megastructure) directly below ECEF p within
   * [p − maxDown, p + probeUp], for buildings whose walk colliders have not streamed in yet:
   * {h (m above sea level), kind 'building'|'mega', id} or null. `skip(kind, id)` → true ignores a
   * hit (the building already has colliders); the ray then continues below it.
   */
  hullBelow(p, probeUp, maxDown, skip = null) {
    const L = Math.hypot(p.x, p.y, p.z);
    _u.set(p.x / L, p.y / L, p.z / L);
    _d.copy(_u).negate();
    let start = -probeUp;
    for (let k = 0; k < 3; k++) {
      _p.set(p.x - _u.x * start, p.y - _u.y * start, p.z - _u.z * start);
      const hit = this.raycast(_p, _d, { terrain: false, water: false, city: true, mega: true, maxDist: maxDown - start });
      if (!hit) return null;
      const id = hit.raw ? (hit.raw.buildingId ?? hit.raw.id ?? null) : null;
      if (skip && skip(hit.kind, id)) { start += hit.distance + 0.05; if (start >= maxDown) return null; continue; }
      return { h: Math.hypot(hit.point.x, hit.point.y, hit.point.z) - R, kind: hit.kind, id };
    }
    return null;
  }
}
