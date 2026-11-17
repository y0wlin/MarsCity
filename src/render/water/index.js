// Water system: every visible water surface — the inner seas and coasts, canals and rivers, lakes and
// the six G02 reservoirs, shore / spillway foam, planar reflections near the camera, underwater fog.
// OWNER: water agent. See ARCHITECTURE.md §8 "Water renderer".
//
// CONTRACT
//   init(), update(frame), isIdle(), dispose()
//   One water mesh per displayed terrain tile with water (tile:add / tile:remove, terrain.drawnTiles()):
//   same vertex grid, camera-relative placement every frame, parents / children swap in the same frame
//   as the terrain (meshes are built synchronously when their tile enters the cut), edges stitched
//   against coarser neighbours exactly like the terrain.
//   waterLevelAt(lat, lon) -> {type, level} | null   level of the displayed water under a point (cheap)
//   addWake(id, pointsEcef[{x,y,z}] newest first, {width=12, strength=1, level=0}) / removeWake(id)
//       ship wakes (props): white water, bubble trail and Kelvin arms on the water surface (see wakes.js)
//   spray: mist puffs below the open G02 spillway bays (spray.js)
//   cfg: { freezeWhenStill, planar, planarScale, planarMaxAlt, foam }
//   Debug layers: 'wireframe' (water grid), 'lod' (tile level hue); nothing in clean mode.
import * as THREE from 'three';
import { R } from '../../core/constants.js';
import { origin } from '../../core/origin.js';
import { FACES, vecToFace, tileKey, latLonToUnit } from '../../core/geo.js';
import { buildWaterTile, setG02Spillways, setG01Locks, sluiceOpen, GRID_UV, N, NV } from './tiles.js';
import { SITES } from '../../world/sites.js';
import { createWaterMaterial, sharedUniforms, faceUniforms, tileUniforms, WATER_DEBUG } from './material.js';
import { faceData, wavePhases4 } from './waves.js';
import { PlanarReflection } from './reflection.js';
import { WakeLayer } from './wakes.js';
import { SprayLayer } from './spray.js';
import { SluiceJetLayer } from './sluicejet.js';

export { spillwayGateOpen, sluiceOpen } from './tiles.js';

const QPI = Math.PI / 4;
const SLUICE_REC_LEVEL = 9;      // quadtree level of the 'canals' records query (see _sluicesFor)
const _v = new THREE.Vector3(), _n = new THREE.Vector3();

function faceDir(face, a, b, out) {
  const F = FACES[face], N0 = F[0], U = F[1], V = F[2];
  const s = Math.tan(a * QPI), t = Math.tan(b * QPI);
  const x = N0[0] + s * U[0] + t * V[0], y = N0[1] + s * U[1] + t * V[1], z = N0[2] + s * U[2] + t * V[2];
  const l = Math.sqrt(x * x + y * y + z * z);
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}

export class WaterSystem {
  constructor(app) {
    this.app = app;
    this.cfg = { freezeWhenStill: true, planar: true, planarScale: 0.75, planarMaxAlt: 2500, foam: 1, buildBudgetMs: 5 };
    this.entries = new Map();      // terrain tile key -> entry {tile, water, mask, mesh, geo, mat, ...}
    this.drawnKeys = new Set();    // every displayed terrain tile key (for edge stitching)
    this.pending = new Map();      // key -> tile: entered the cut, water mesh not built yet (time-sliced builds)
    this.linger = new Map();       // key -> entry: left the cut, mesh kept visible until the tiles replacing it are built
    this.sluiceCache = new Map();  // L11 tile key -> {list|null}: hydro canal sluices (worker job 'canals')
    this.force = new Set();        // keys to rebuild (megastructure spillway data arrived)
    this._megaSync = false;
    this.time = 0;
    this._still = 0;
    this._frozen = false;
    this.frameNo = 0;
    this.stats = { meshes: 0, visible: 0, built: 0, buildMs: 0, maxBuildMs: 0, planar: 0, frameBuildMs: 0, maxFrameBuildMs: 0, deferred: 0, linger: 0 };
    this.under = false;
  }

  async init() {
    const app = this.app;
    this.group = new THREE.Group();
    this.group.name = 'water';
    this.group.matrixAutoUpdate = false;
    app.scene.add(this.group);
    this.shared = sharedUniforms();
    const atmo = app.systems?.atmosphere;
    if (atmo?.luts?.ms?.texture) this.shared.uLpMsLut.value = atmo.luts.ms.texture;
    const em = atmo?.composite?.emissionUniform;
    if (em) { this.shared.uWtrEmission = em; this.shared.uWtrCityGlow.value = 0.015; }
    this.faces = [];
    for (let f = 0; f < 6; f++) { const fd = faceData(f); this.faces.push({ u: faceUniforms(fd), omega: fd.omega, phase0: fd.phase0 }); }
    this.planar = new PlanarReflection(app, this.shared);
    this.planar.hide.push(this.group);
    this.wakes = new WakeLayer(app, this);
    this.group.add(this.wakes.group);
    this.spray = new SprayLayer(app, this);
    this.group.add(this.spray.group);
    this.jets = new SluiceJetLayer(app, this);
    this.group.add(this.jets.group);
    this._makeUnderwater();
    this.planar.hide.push(this.underGroup);
    const ev = app.events;
    ev?.on?.('tile:add', ({ tile }) => this._onAdd(tile));
    ev?.on?.('tile:remove', ({ tile }) => this._onRemove(tile));
    ev?.on?.('settings', ({ key }) => { if (key === 'debugLayer' || key === 'clean') this._applyDebug(); });
    this._warmup();
    // tiles displayed before we subscribed
    try { for (const t of app.systems?.terrain?.drawnTiles?.() || []) this._onAdd(t); } catch { /* terrain not ready */ }
    this._applyDebug();
  }

  /** compile the tile builder's code paths once at init (the first real build otherwise pays ~10–40 ms of JIT) */
  _warmup() {
    const t0 = performance.now();
    try {
      const G = NV * NV;
      const W = { type: new Uint8Array(G), level: new Float32Array(G), depth: new Float32Array(G), flow: new Float32Array(G * 2),
        dist: new Float32Array(G).fill(1e9), width: new Float32Array(G), mask: null, maskRes: 0, hasSea: true, hasCanal: true, hasLake: true, minLevel: 0, maxLevel: 12 };
      for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
        const o = j * NV + i;
        if (i < 30) { W.type[o] = 1; W.depth[o] = 5 + i; }
        else if (i < 34) { W.type[o] = 2; W.level[o] = j < 32 ? 12 : 8; W.depth[o] = 3; W.width[o] = 80; W.flow[o * 2 + 1] = j < 32 ? 1 : 1; W.dist[o] = Math.abs(i - 32) * 40; }
        else if (i > 50) { W.type[o] = 3; W.level[o] = 20; W.depth[o] = 6; }
      }
      const b = { a0: 0.10, a1: 0.10 + 2 / 4096, b0: 0.10, b1: 0.10 + 2 / 4096 };
      const d = {};
      faceDir(4, (b.a0 + b.a1) / 2, (b.b0 + b.b1) / 2, d);
      const tile = { key: 'warmup', face: 4, level: 12, x: 0, y: 0, bounds: b, centerEcef: { x: d.x * R, y: d.y * R, z: d.z * R }, size: 1300, geomErr: 1, water: W };
      buildWaterTile(tile, { sluices: [{ u: d, up: 12, down: 8, heading: 0, width: 80, open: true }] });
      buildWaterTile(tile, { sluices: null });
    } catch (err) { /* warm-up only */ }
    this.stats.warmupMs = +(performance.now() - t0).toFixed(1);
  }

  _applyDebug() {
    const s = this.app.state?.settings || {};
    this.shared.uWtrDebug.value = s.clean ? 0 : (WATER_DEBUG[s.debugLayer] ?? 0);
  }

  // ---------------------------------------------------------------------------------------------
  _onAdd(tile) {
    if (!tile) return;
    this.drawnKeys.add(tile.key);
    const e = this.entries.get(tile.key);
    if (e) { e.tile = tile; e.drawn = true; e.linger = false; this.linger.delete(tile.key); }
    if (tile.water) this.pending.set(tile.key, tile);
    else if (!e) this.entries.set(tile.key, { tile, drawn: true, mesh: null, water: null });
  }

  _onRemove(tile) {
    if (!tile) return;
    this.drawnKeys.delete(tile.key);
    this.pending.delete(tile.key);
    const e = this.entries.get(tile.key);
    if (!e) return;
    e.drawn = false; e.lastDrawn = this.frameNo;
    // fix round 3 (memory): an entry without a mesh caches nothing (it only pinned the terrain tile object)
    if (!e.mesh) { this.entries.delete(tile.key); return; }
    // hand-over: the mesh stays until the tiles that replace it (children / parent) have their water built
    // (released in the next update when no pending tile overlaps it; event order within a frame is free)
    if (e.mesh) { e.linger = true; e.lingerFrame = this.frameNo; this.linger.set(tile.key, e); }
  }

  /**
   * Exact canal sluices around a tile (tiles from L11 with canals): hydro canalsInTile of the tile's L9
   * ancestor, fetched once per L9 tile through the worker job 'canals' (never on the main thread), flattened to
   * [{u, up, down, heading, width, open}] with the shared gate rule sluiceOpen (world/sluice.js). Returns null
   * while loading; the tiles below that ancestor are rebuilt when the records arrive.
   */
  _sluicesFor(tile) {
    if (!tile.water?.hasCanal || tile.level < 11) return null;
    // fix round 3 (W2): records of the L9 ANCESTOR (a superset of the L11 query): hydro canalsInTile tests a trunk
    // segment against the tile by 9 samples along it, so a 2.6 km L11 / 5 km L10 tile crossed by a long trunk between two
    // samples got no record (the S07O station's canal: 0 canals at L11 / L10, its sluice listed at L9) -> no plume
    const RL = SLUICE_REC_LEVEL;
    const d = tile.level - RL, kx = tile.x >> d, ky = tile.y >> d;
    const key = `${tile.face}/${RL}/${kx}/${ky}`;
    let c = this.sluiceCache.get(key);
    if (c) return c.list;
    if (this.sluiceCache.size > 600) { for (const [k, v] of this.sluiceCache) { if (v.list) this.sluiceCache.delete(k); if (this.sluiceCache.size < 400) break; } }
    c = { list: null };
    this.sluiceCache.set(key, c);
    const wk = this.app.workers;
    if (!wk?.submit) { c.list = []; return c.list; }
    try {
      // one cheap job per L11 tile; it gates the sluice plumes of every canal tile below it: right after the camera chain
      // (−2e6 + level), ahead of the regular tile builds (≥ −1e6), so a close-up never waits behind hundreds of tiles
      const job = wk.submit('canals', { face: tile.face, level: RL, x: kx, y: ky }, { priority: -1.2e6 });
      job.promise.then((res) => {
        const out = [];
        for (const ch of (Array.isArray(res) ? res : res?.canals) || []) {
          for (const s of ch.sluices || []) {
            const up = +s.upLevel, down = +s.downLevel;
            if (!Number.isFinite(up) || !Number.isFinite(down)) continue;
            out.push({ u: latLonToUnit(s.lat, s.lon), up: Math.max(up, down), down: Math.min(up, down), heading: +s.heading || 0, width: +ch.width || 10, open: sluiceOpen(up, down) });
          }
        }
        c.list = out;
        this.stats.sluices = (this.stats.sluices || 0) + out.length;
        if (!out.length) return;
        // rebuild the displayed / cached water meshes under this ancestor tile
        for (const [k, e] of this.entries) {
          const t = e.tile;
          if (!e.mesh || !t?.water?.hasCanal || t.face !== tile.face || t.level < 11) continue;
          const dd = t.level - RL;
          if ((t.x >> dd) !== kx || (t.y >> dd) !== ky) continue;
          e.dirty = true;
          if (e.drawn) this.pending.set(k, t);
        }
      }).catch(() => { c.list = []; });
    } catch { c.list = []; }
    return c.list;
  }

  /**
   * A sluice station's open bays became known (sluicejet.js): rebuild the canal water meshes under the L11 tile of its
   * gate so the plume sits below the open bays only.
   */
  _sluiceSpansChanged(u) {
    const f = vecToFace(u.x, u.y, u.z);
    const n = 1 << 11, kx = Math.min(n - 1, Math.max(0, Math.floor((f.a + 1) * 0.5 * n))), ky = Math.min(n - 1, Math.max(0, Math.floor((f.b + 1) * 0.5 * n)));
    for (const [k, e] of this.entries) {
      const t = e.tile;
      if (!e.mesh || !t?.water?.hasCanal || t.face !== f.face || t.level < 11) continue;
      const dd = t.level - 11;
      if ((t.x >> dd) !== kx || (t.y >> dd) !== ky) continue;
      e.dirty = true;
      if (e.drawn) this.pending.set(k, t);
    }
  }

  /** do two quadtree tiles overlap (one contains the other)? */
  static _overlap(a, b) {
    if (a.face !== b.face) return false;
    if (a.level <= b.level) { const d = b.level - a.level; return (b.x >> d) === a.x && (b.y >> d) === a.y; }
    const d = a.level - b.level; return (a.x >> d) === b.x && (a.y >> d) === b.y;
  }

  /**
   * Build the pending water meshes within a per-frame budget (time-sliced; a mesh rebuilt from the cache
   * costs nothing). Nearest tiles first; siblings (same parent) are finished in the same frame so a split
   * swaps all four children at once. Tiles that left the cut keep their mesh visible until every pending
   * tile overlapping them is built (no holes, no double surface for more than the hand-over).
   */
  _buildPending(frame) {
    const t0 = performance.now();
    const cam = frame.camEcef;
    const list = [];
    for (const [key, t] of this.pending) {
      let e = this.entries.get(key);
      const tile = e?.tile || t || this._tileFromTerrain(key);
      if (!tile) { this.pending.delete(key); continue; }
      if (!e) { e = { tile, drawn: true, mesh: null, water: null }; this.entries.set(key, e); }
      e.tile = tile;
      if (e.mesh && e.water === tile.water && !e.dirty) { this.pending.delete(key); continue; }     // cached
      const c = tile.centerEcef;
      list.push({ key, e, d: Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z) - (tile.size || 0), parent: `${tile.face}/${tile.level - 1}/${tile.x >> 1}/${tile.y >> 1}` });
    }
    list.sort((a, b) => a.d - b.d);
    const budget = this.frameNo < 3 ? 1e9 : this.cfg.buildBudgetMs;
    const doneParents = new Set();
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      if (!this.pending.has(it.key)) continue;
      if (performance.now() - t0 > budget && !doneParents.has(it.parent)) continue;
      // build this tile and its pending siblings now
      doneParents.add(it.parent);
      for (let m = k; m < list.length; m++) {
        const jt = list[m];
        if (jt.parent !== it.parent || !this.pending.has(jt.key)) continue;
        this._build(jt.e);
        this.pending.delete(jt.key);
      }
    }
    const ms = performance.now() - t0;
    this.stats.frameBuildMs = ms; this.stats.maxFrameBuildMs = Math.max(this.stats.maxFrameBuildMs, ms);
    this.stats.deferred = this.pending.size;
    // release lingering meshes that no pending tile overlaps any more (or after 3 s)
    for (const [key, e] of this.linger) {
      let wait = false;
      if (this.frameNo - e.lingerFrame < 180) for (const t of this.pending.values()) { if (t && WaterSystem._overlap(t, e.tile)) { wait = true; break; } }
      if (!wait) { e.linger = false; if (e.mesh && !e.drawn) e.mesh.visible = false; this.linger.delete(key); }
    }
    this.stats.linger = this.linger.size;
  }

  _build(e) {
    const tile = e.tile;
    const t0 = performance.now();
    let data = null;
    e.dirty = false;
    try { data = buildWaterTile(tile, { sluices: this.jets ? this.jets.attachSpans(this._sluicesFor(tile)) : this._sluicesFor(tile) }); } catch (err) { if (!this._buildWarned) { this._buildWarned = true; console.warn('[water] tile build failed', tile.key, err); } }
    e.water = tile.water;
    e.mask = tile.water?.mask || null;
    this._disposeMesh(e);
    if (!data) return;
    const g = new THREE.BufferGeometry();
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    g.setAttribute('aWtrGrid', new THREE.BufferAttribute(GRID_UV, 2));
    g.setAttribute('aWtrEdge', new THREE.BufferAttribute(data.edge, 3));
    g.setAttribute('aWtrA', new THREE.BufferAttribute(data.A, 4));
    g.setAttribute('aWtrB', new THREE.BufferAttribute(data.B, 4));
    g.setAttribute('aWtrF', new THREE.BufferAttribute(data.F, 4));
    g.setAttribute('aWtrI', new THREE.BufferAttribute(data.I, 1));
    const s = data.sphere;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(s[0], s[1], s[2]), s[3]);
    const u = tileUniforms();
    u.uWtrOrigin.value.set(data.origin[0], data.origin[1]);
    u.uWtrTileM.value = data.tileM;
    u.uWtrFaceU.value.fromArray(data.faceU);
    u.uWtrFaceV.value.fromArray(data.faceV);
    u.uWtrLevel.value = tile.level;
    // depth bias (m) towards the camera: z-fight safety against the painted shallows only. Fix round 1: the
    // terrain now lowers wet shore vertices 0.3 m below the level (shoreClamp), so the metric part is capped at
    // 0.25 m (it used to reach the tile's geometric error, up to 15 % of a vertex spacing): the water never
    // climbs onto quay walls, caisson faces or building plinths standing in it
    u.uWtrBias.value.set(2e-6, Math.min(tile.geomErr || 0, data.vs * 0.15, 0.25));
    const mat = createWaterMaterial(this.shared, this.faces[tile.face].u, u, this.app.lighting);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'water:' + tile.key;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.waterTile = tile.key;
    mesh.onBeforeRender = this._onBeforeRender;
    this.group.add(mesh);
    e.mesh = mesh; e.geo = g; e.mat = mat; e.u = u; e.data = data;
    this._applyMask(e);
    e.probes = this._probes(tile);
    const ms = performance.now() - t0;
    this.stats.built++; this.stats.buildMs += ms; this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, ms);
  }

  _applyMask(e) {
    const W = e.tile.water;
    e.maskTex?.dispose(); e.maskTex = null;
    const m = W?.mask, T = W?.maskRes || 0;
    if (m && T && m.length === T * T) {
      const t = new THREE.DataTexture(m, T, T, THREE.RedFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true; t.unpackAlignment = 1;
      t.needsUpdate = true;
      e.maskTex = t;
      e.u.uWtrMask.value = t; e.u.uWtrMaskRes.value = T; e.u.uWtrHasMask.value = 1;
    } else { e.u.uWtrMask.value = null; e.u.uWtrHasMask.value = 0; }
    e.mask = m || null;
  }

  _disposeMesh(e) {
    if (!e.mesh) return;
    this.group.remove(e.mesh);
    e.geo.dispose(); e.mat.dispose(); e.maskTex?.dispose();
    e.mesh = null; e.geo = null; e.mat = null; e.maskTex = null; e.u = null; e.data = null;
  }

  /** probe points just outside each edge midpoint (W, E, S, N) -> {face, a, b} */
  _probes(tile) {
    const b = tile.bounds, eps = (b.a1 - b.a0) * 0.02;
    const am = (b.a0 + b.a1) / 2, bm = (b.b0 + b.b1) / 2;
    const pts = [[b.a0 - eps, bm], [b.a1 + eps, bm], [am, b.b0 - eps], [am, b.b1 + eps]];
    const d = {}, f = {};
    return pts.map(([a, bb]) => { faceDir(tile.face, a, bb, d); vecToFace(d.x, d.y, d.z, f); return { face: f.face, a: f.a, b: f.b }; });
  }
  _drawnAt(p, level) {
    if (level < 0) return 0;
    const n = 1 << level;
    const x = Math.min(n - 1, Math.max(0, Math.floor((p.a + 1) * 0.5 * n)));
    const y = Math.min(n - 1, Math.max(0, Math.floor((p.b + 1) * 0.5 * n)));
    return this.drawnKeys.has(tileKey(p.face, level, x, y)) ? 1 : 0;
  }

  // ---------------------------------------------------------------------------------------------
  update(frame) {
    this.frameNo++;
    const app = this.app;
    const dt = Math.min(0.1, frame.dt || 0.016);
    // wave clock: frozen while the view is still so the pipeline's progressive accumulation converges
    // to a crisp surface (the pipeline has no reactive mask for animated surfaces yet)
    const still = !frame.moving && !(app.state?.timeSpeed);
    this._still = still ? this._still + 1 : 0;
    const freeze = this.cfg.freezeWhenStill && this._still > 24;
    if (!freeze) this.time += dt;
    if (freeze && !this._frozen) app.pipeline?.resetAccumulation?.(false);
    this._frozen = freeze;
    this.shared.uWtrTime.value = this.time % 4096;
    for (const f of this.faces) wavePhases4(this.time, f.omega, f.u.uWtrWaves.value, f.phase0);
    this.shared.uWtrSkyAnalytic.value = THREE.MathUtils.smoothstep(frame.camAlt, 25000, 70000);
    this.shared.uWtrFoamGain.value = this.cfg.foam;
    if (frame.settings && (frame.settings.debugLayer !== this._lastDebug || frame.settings.clean !== this._lastClean)) {
      this._lastDebug = frame.settings.debugLayer; this._lastClean = frame.settings.clean; this._applyDebug();
    }

    this._syncMega();
    this._syncLocks();
    // megastructure spillway / lock data arrived: rebuild the G02 / G01 tiles now
    if (this.force.size) {
      for (const key of this.force) { const e = this.entries.get(key); if (e && e.tile?.water) this._build(e); }
      this.force.clear();
    }
    // tiles that entered the cut: time-sliced builds with hand-over (see _buildPending)
    if (this.pending.size || this.linger.size) this._buildPending(frame);

    // per frame: placement, mask / water upgrades, edge stitching, visibility
    let visible = 0, meshes = 0;
    for (const [key, e] of this.entries) {
      if (!e.drawn && !e.linger) continue;
      const tile = e.tile;
      if (e.drawn && tile.water !== e.water) { if (tile.water) this.pending.set(key, tile); else { this._disposeMesh(e); e.water = null; } }
      if (!e.mesh) continue;
      if ((tile.water?.mask || null) !== e.mask) this._applyMask(e);
      meshes++;
      const c = tile.centerEcef;
      e.mesh.position.set(c.x - origin.x, c.y - origin.y, c.z - origin.z);
      e.mesh.updateMatrix();
      e.mesh.updateMatrixWorld();
      const L = tile.level;
      const ed = e.u.uWtrEdge.value;
      if (L > 0 && e.probes) ed.set(this._drawnAt(e.probes[0], L - 1), this._drawnAt(e.probes[1], L - 1), this._drawnAt(e.probes[2], L - 1), this._drawnAt(e.probes[3], L - 1));
      else ed.set(0, 0, 0, 0);
      // terrain mesh visibility (horizon culling) is mirrored; a lingering mesh stays until it is replaced
      e.mesh.visible = e.linger ? true : tile.mesh ? tile.mesh.visible !== false : true;
      if (e.mesh.visible) visible++;
    }
    this.stats.meshes = meshes; this.stats.visible = visible;
    this._evict();

    this._updatePlanar(frame);
    this._updateUnderwater(frame);
    this.wakes.update(frame);
    try { this.spray.update(frame); } catch (err) { if (!this._sprayWarned) { this._sprayWarned = true; console.warn('[water] spray', err); } }
    try { this.jets.update(frame); } catch (err) { if (!this._jetsWarned) { this._jetsWarned = true; console.warn('[water] sluice jets', err); } }
  }

  /**
   * G01 lock gate states from the megastructure layout (lock chunks carry lockState(idx)): the swell enters the harbour
   * only through the mouth and the locks whose gates are open (W4). tiles.js starts from a replica of the same rule;
   * the displayed G01 tiles are rebuilt only if the layout disagrees.
   */
  _syncLocks() {
    if (this._locksSync || (this.frameNo % 20) !== 11) return;
    const mega = this.app.systems?.mega;
    const chunks = mega?.layout?.G01?.chunks;
    if (!Array.isArray(chunks)) { if (this.frameNo > 1200 || (mega && !('layout' in mega))) this._locksSync = true; return; }
    this._locksSync = true;
    const states = [];
    for (const c of chunks) if (c.kind === 'lock' && c.lock && c.lock.state) states[c.lock.idx] = c.lock.state;
    let changed = false;
    try { changed = setG01Locks(states); } catch (err) { console.warn('[water] G01 lock states rejected', err); }
    this.stats.g01Locks = states.map((s) => (s ? (s.outerOpen ? (s.innerOpen ? 'O' : 'o') : '-') : '?')).join('');
    if (!changed) return;
    const S = SITES.tidalBarrier, la = S.lat * Math.PI / 180, lo = S.lon * Math.PI / 180;
    const cx = Math.cos(la) * Math.sin(lo) * R, cy = Math.sin(la) * R, cz = Math.cos(la) * Math.cos(lo) * R;
    for (const [key, e] of this.entries) {
      if (!e.mesh || !e.tile?.water?.hasSea) continue;
      const c = e.tile.centerEcef;
      if (Math.hypot(c.x - cx, c.y - cy, c.z - cz) < S.radius + 4000 + (e.tile.size || 0)) {
        if (e.drawn) this.force.add(key); else { this._disposeMesh(e); e.water = null; }
      }
    }
  }

  /** megastructure spillway outlets (exact chutes, flows, gate states) once its layout is loaded */
  _syncMega() {
    if (this._megaSync || (this.frameNo % 20) !== 5) return;
    const mega = this.app.systems?.mega;
    if (!mega || typeof mega.spillways !== 'function') { if (this.frameNo > 600) this._megaSync = true; return; }
    let list = null;
    try { list = mega.spillways(); } catch { list = null; }
    if (!list || !list.length) {
      // layout present but no spillways (G02 missing): keep the SITES default, never block isIdle()
      if (mega.layout) { this._megaEmpty = (this._megaEmpty || 0) + 1; if (this._megaEmpty > 30) this._megaSync = true; }
      return;
    }
    this._megaSync = true;
    let changed = false;
    try { changed = setG02Spillways(list); } catch (err) { console.warn('[water] spillway data rejected', err); }
    if (!changed) return;
    // rebuild the displayed / cached tiles around the water stairs
    const S = SITES.waterStairs, la = S.lat * Math.PI / 180, lo = S.lon * Math.PI / 180;
    const cx = Math.cos(la) * Math.sin(lo) * R, cy = Math.sin(la) * R, cz = Math.cos(la) * Math.cos(lo) * R;
    for (const [key, e] of this.entries) {
      if (!e.mesh) continue;
      const c = e.tile.centerEcef;
      if (Math.hypot(c.x - cx, c.y - cy, c.z - cz) < S.radius + 6000 + (e.tile.size || 0)) {
        if (e.drawn) this.force.add(key); else { this._disposeMesh(e); e.water = null; }
      }
    }
  }

  _tileFromTerrain(key) {
    try { return this.app.systems?.terrain?.getTile?.(key) || null; } catch { return null; }
  }

  _evict() {
    // fix round 3 (memory): the cache holds only hidden MESHES (mesh-less entries are dropped in _onRemove), capped
    // at 320 (was 900 entries incl. land tiles, each pinning its terrain tile object); a cached mesh whose terrain
    // tile was evicted can never be reused (a rebuilt tile brings a new water object) and is dropped at once
    const sweep = this.frameNo % 30 === 0;
    let cached = 0;
    for (const [k, e] of this.entries) {
      if (e.drawn || e.linger) continue;
      if (sweep && (!e.mesh || (e.tile && e.tile.evicted))) { this._disposeMesh(e); this.entries.delete(k); continue; }
      cached++;
    }
    if (cached <= 320) return;
    const cand = [];
    for (const [k, e] of this.entries) if (!e.drawn && !e.linger) cand.push([e.lastDrawn || 0, k, e]);
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < cand.length && cached > 256; i++, cached--) {
      this._disposeMesh(cand[i][2]);
      this.entries.delete(cand[i][1]);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // planar reflection: water level near the camera
  _updatePlanar(frame) {
    const pr = this.planar;
    pr.scale = this.cfg.planarScale;
    if (!this.cfg.planar) { pr.configure(false); return; }
    if ((this.frameNo % 6) === 1 || this._planarRef === undefined) this._planarRef = this._nearestWater(frame);
    const ref = this._planarRef;
    const camR = Math.hypot(frame.camEcef.x, frame.camEcef.y, frame.camEcef.z);
    const ok = ref && (camR - R - ref.level) < this.cfg.planarMaxAlt && (camR - R - ref.level) > 0.3;
    if (!ok) { pr.configure(false); return; }
    // plane: tangent at the camera nadir at the water level
    const cx = frame.camEcef.x / camR, cy = frame.camEcef.y / camR, cz = frame.camEcef.z / camR;
    const r = R + ref.level;
    _v.set(cx * r - origin.x, cy * r - origin.y, cz * r - origin.z);
    _n.set(cx, cy, cz);
    pr.configure(true, _v, _n, ref.level);
    // fade: the tangent plane departs from the curved surface (≈ d²/2R), reflections only near
    this.shared.uWtrPlanarFade.value = Math.max(3000, Math.min(16000, Math.sqrt(2 * R * 4.0)));
    this.stats.planar = pr.calls;
  }

  /** level of the closest displayed water (vertex scan of nearby fine tiles) */
  _nearestWater(frame) {
    const cam = frame.camEcef;
    const camR = Math.hypot(cam.x, cam.y, cam.z);
    const hAbove = camR - R;
    if (hAbove > 6000) return null;
    let best = null, bestD = Infinity;
    for (const e of this.entries.values()) {
      if (!e.drawn || !e.mesh || e.tile.level < 10) continue;
      const t = e.tile, c = t.centerEcef;
      const dc = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z);
      if (dc - t.size > Math.max(bestD, 8000)) continue;
      const W = t.water, P = e.data.position;
      const step = t.level >= 14 ? 2 : 1;
      for (let j = 0; j < NV; j += step) for (let i = 0; i < NV; i += step) {
        const o = j * NV + i;
        if (!W.type[o] || (W.type[o] === 2 && e.data.A[o * 4 + 1] < 0.5)) continue;
        const px = P[o * 3] + c.x - cam.x, py = P[o * 3 + 1] + c.y - cam.y, pz = P[o * 3 + 2] + c.z - cam.z;
        const d = px * px + py * py + pz * pz;
        if (d < bestD * bestD) { bestD = Math.sqrt(d); best = { level: W.level[o], type: W.type[o], dist: bestD }; }
      }
    }
    // only large water bodies get the planar pass (sea, lakes, wide canals)
    return best && best.dist < 9000 ? best : null;
  }

  // the first water mesh drawn in the main pass renders the planar reflection (nested render)
  _onBeforeRender = (renderer, scene, camera) => {
    if (this.planar.active) this.planar.render(renderer, scene, camera, this.app.pipeline?.frameIndex ?? this.frameNo);
  };

  // ---------------------------------------------------------------------------------------------
  // underwater: concentric camera-centred fog shells (depth-tested, no depth write). Fix round 1: 44 thin shells
  // (ratio 1.2) whose radii are jittered every frame (golden-ratio sequence) so the progressive accumulation
  // averages the opacity steps where the seabed / surface cut the shells (no banding arcs)
  _makeUnderwater() {
    const g = this.underGroup = new THREE.Group();
    g.name = 'water.underwater';
    g.visible = false;
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.underShells = [];
    const NS = 44, RATIO = 1.2;
    this.underRatio = RATIO;
    let r0 = 0;
    for (let k = 0; k < NS; k++) {
      const r = 0.3 * Math.pow(RATIO, k);
      const m = new THREE.MeshBasicMaterial({ color: 0x0a3550, transparent: true, opacity: 0.1, depthTest: true, depthWrite: false, side: THREE.BackSide, fog: false });
      m.name = 'water.underwaterFog';
      const sh = new THREE.Mesh(geo, m);
      sh.scale.setScalar(r);
      sh.renderOrder = 50 + (NS - k);
      sh.frustumCulled = false;
      sh.userData.r0 = r0; sh.userData.r1 = r;
      r0 = r;
      g.add(sh);
      this.underShells.push(sh);
    }
    this.app.scene.add(g);
  }

  _updateUnderwater(frame) {
    let under = false, level = 0;
    // near the ground (reservoirs / canals lie up to ~900 m above sea level) or near sea level: the water
    // level under the camera from the displayed water tiles (cheap; hydro waterAt costs ~1-3 ms)
    if (frame.camAlt < 400 || (frame.camAltGround ?? 1e9) < 400) {
      if (this.frameNo % 3 === 0 || this._underLevel === undefined) {
        let w = null;
        try { w = this.waterLevelAt(frame.camLat, frame.camLon); } catch { w = null; }
        this._underLevel = w && w.type ? w.level : null;
      }
      if (this._underLevel !== null && frame.camAlt < this._underLevel - 0.05) { under = true; level = this._underLevel; }
    }
    this.under = under;
    this.underGroup.visible = under;
    if (!under) return;
    const depth = level - frame.camAlt;
    const mus = frame.camUp.dot(frame.sunDir);
    const E = 8.0 * Math.max(0, mus) * 0.75 + 1.1 * THREE.MathUtils.smoothstep(mus, -0.15, 0.25) + 0.04;
    const att = Math.exp(-depth / 9);
    const sigma = 0.11;      // 1/m: ~9 m visibility
    const jit = Math.pow(this.underRatio, ((this.app.pipeline?.frameIndex ?? this.frameNo) * 0.6180339887) % 1);
    for (const s of this.underShells) {
      const { r0, r1 } = s.userData;
      s.material.opacity = 1 - Math.exp(-sigma * (r1 - r0));
      s.material.color.setRGB(0.010 * E * att, 0.050 * E * att, 0.070 * E * att);
      s.scale.setScalar(r1 * jit);
      s.position.set(0, 0, 0);
    }
  }

  // ---------------------------------------------------------------------------------------------
  /** water at a point from the displayed tiles (cheap; null when no water tile covers it) */
  waterLevelAt(lat, lon) {
    const u = latLonToUnit(lat, lon);
    const f = vecToFace(u.x, u.y, u.z);
    let best = null;
    for (const e of this.entries.values()) {
      if (!e.drawn || !e.mesh) continue;
      const t = e.tile, b = t.bounds;
      if (t.face !== f.face || f.a < b.a0 || f.a > b.a1 || f.b < b.b0 || f.b > b.b1) continue;
      if (best && best.tile.level >= t.level) continue;
      best = e;
    }
    if (!best) return null;
    const t = best.tile, b = t.bounds;
    const i = Math.round((f.a - b.a0) / (b.a1 - b.a0) * N), j = Math.round((f.b - b.b0) / (b.b1 - b.b0) * N);
    const o = j * NV + i;
    return { type: t.water.type[o], level: t.water.level[o], depth: t.water.depth[o] };
  }

  addWake(id, points, opts) { return this.wakes.add(id, points, opts); }
  removeWake(id) { return this.wakes.remove(id); }

  isIdle() {
    if (!this._megaSync && this.app.systems?.mega?.layout) return false;   // spillway data pending
    if (!this._locksSync && this.app.systems?.mega?.layout) return false;  // G01 lock states pending
    if (this.jets?.pending()) return false;                                 // sluice gate layout module loading
    return this.pending.size === 0 && this.force.size === 0;
  }

  debugStats() {
    return { ...this.stats, entries: this.entries.size, frozen: this._frozen, under: this.under, planarOn: this.planar.active, avgBuildMs: this.stats.built ? +(this.stats.buildMs / this.stats.built).toFixed(2) : 0, jets: { ...this.jets.stats } };
  }

  dispose() {
    for (const e of this.entries.values()) this._disposeMesh(e);
    this.entries.clear();
    this.planar.dispose();
    this.wakes.dispose();
    this.spray.dispose();
    this.jets.dispose();
    this.app.scene.remove(this.group);
    this.app.scene.remove(this.underGroup);
  }
}
