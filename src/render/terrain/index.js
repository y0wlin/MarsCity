// Terrain system: cube-sphere quadtree LOD (full disc → ~0.1 m), tiles built in workers, terrain
// material, raycast / height queries, tile events. OWNER: terrain-render agent.
//
// CONTRACT (ARCHITECTURE.md §8 terrain)
//   init(), update(frame)
//   raycast(originRender:THREE.Vector3, dirRender:THREE.Vector3)
//       -> {distance, point:THREE.Vector3 (render), ecef:{x,y,z}, lat, lon, h, tile} | null
//       exact intersection with the displayed tile triangles (steep cliffs included)
//   heightAtLatLon(lat, lon) -> metres (CPU, full detail world function)
//   groundHeightCached() -> metres under the camera (cheap, from loaded tiles)
//   groundHeightAt(lat, lon) -> metres from the finest loaded tile (cheap, no world evaluation)
//   isIdle() -> false while any visible tile is loading / refining / morphing
//   events 'tile:add' / 'tile:remove' {tile}: a tile entered / left the displayed cut. tile =
//       {key, face, level, x, y, centerEcef:{x,y,z}, mesh, minH, maxH, geomErr, texRes, heights,
//        water, bounds:{a0,a1,b0,b1}, size, n, rev}   rev increments when the tile's textures are
//        upgraded in place (texRes, water.mask / maskRes replaced; geometry and heights unchanged)
//       heights: Float32Array(65×65) ground heights of the grid vertices (row j·65+i, i along a)
//       water:   see ARCHITECTURE.md §8 "Tile water data" (null when the tile has no water)
//   drawnTiles() -> array of the tile objects currently displayed
//   tileGridPosition(tile, i, j, h, out) -> render-space position of grid vertex (i, j) at height h
//   displayShift(ecef) -> metres the vertex shader currently shifts the shown terrain at that point (coarse-tile
//       datum shift around the camera while the chain under it refines; 0 once refined — see _updateDatum)
//   chainInfo() -> {target, depth, nadirLevel, hDisp, hTrue, datum} camera-first refinement state
import * as THREE from 'three';
import { R, FACE_ARC } from '../../core/constants.js';
import { origin } from '../../core/origin.js';
import { FACES, tileBounds, vecToFace, latLonToUnit, ecefToLatLonH, tileKey } from '../../core/geo.js';
import { heightAt } from '../../world/terrain.js';
import { getControlMaps } from '../../data/controlMaps.js';
import { N, NV, GRID_VERTS, TOTAL_VERTS, MAX_LEVEL, TEX_LOW, TEX_FAR, TEX_NEAR, tileSizeAt, vertexWavelength } from './config.js';
import { TerrainShared, createTileMaterial, DEBUG_MODES } from './material.js';
import { raycastTile, raySphere } from './raycast.js';

const QPI = Math.PI / 4;
const EMPTY = 0, LOADING = 1, READY = 2;

export const TERRAIN_CFG = {
  geomPx: 1.0,          // split when the mesh error projects above this many pixels
  texelPx: 1.25,        // split when one TEX_FAR texel projects above this many pixels
  orbitTexelPx: 0.62,   // … for planet-scale tiles (level ≤ 3; blended to texelPx at level 6)
  upgradePx: 1.5,       // displayed leaves whose TEX_FAR texel projects above this get TEX_NEAR
  nearTiles: 1.75,      // … and leaves closer to the eye than this many tile sizes
  maxRelax: 2.0,        // max texel-size relaxation for grazing (foreshortened) tiles
  minVertexPx: 2.0,     // geometric error stops splitting once grid vertices are this close on screen
  mergeHyst: 0.72,      // merge when below threshold × this
  morphTime: 0.5,       // s, geomorph + texture cross-fade of children
  uploadBudgetMs: 12,   // main-thread GPU upload budget per frame
  cacheBytes: 1.0e9,    // GPU memory budget of all resident tiles (displayed + cached); fix round 3 (memory): was 1.8e9
  cacheTiles: 1800,     // resident tile cap (fix round 3, memory: was a hard-coded 3000)
  staleFrames: 40,      // cancel requests not renewed for this many frames
  minPlanetH: -12000,   // occluder sphere for horizon culling (below the deepest terrain)
  lookahead: 1.6,       // also request grandchildren of splitting tiles whose children will split (ratio >)
  // camera-first refinement (Z-01): the tile chain under the camera, root → tiles of ≈ chainSize × the height
  // above ground (≥ chainMinSize m), is requested every frame with absolute priority, all levels at once
  chain: true,
  chainSize: 6,
  chainMinSize: 40,
  chainTex: 64,         // first-pass texture of intermediate chain tiles (replaced within seconds; upgraded if shown)
  datum: true,          // shift coarse tiles around the camera onto the analytic ground until the chain arrives
};
// worker priorities (lower runs first): roots, then the camera chain, then everything else (terrain ≥ −1e6·…)
const ROOT_PRI = -3e6, CHAIN_PRI = -2e6;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** BufferAttribute.onUpload callback (fix round 3, memory): the attribute is GPU-only after upload */
function releaseAttrArray() { this.array = null; }
/** ground height of a READY node's mesh at face coords (a, b) (its own alternating-diagonal triangles) */
function tileHeight(node, a, b) {
  const fu = Math.min(N, Math.max(0, (a - node.a0) / (node.a1 - node.a0) * N));
  const fv = Math.min(N, Math.max(0, (b - node.b0) / (node.b1 - node.b0) * N));
  const i0 = Math.min(N - 1, Math.floor(fu)), j0 = Math.min(N - 1, Math.floor(fv));
  const u = fu - i0, v = fv - j0, h = node.heights;
  const o = j0 * NV + i0;
  const h00 = h[o], h10 = h[o + 1], h01 = h[o + NV], h11 = h[o + NV + 1];
  if (((i0 + j0) & 1) === 0) return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + u * (h11 - h01) + v * (h01 - h00);
  return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}

// ---------------------------------------------------------------------------------------------
// shared topology
// ---------------------------------------------------------------------------------------------
let SHARED_INDEX = null, SHARED_UV = null, NO_WL = null;
function sharedTopology() {
  if (SHARED_INDEX) return;
  NO_WL = new Float32Array(TOTAL_VERTS * 2);   // (level, valid = 0): no drawn water (array shared, attribute per geometry)
  const idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v00 = j * NV + i, v10 = v00 + 1, v01 = v00 + NV, v11 = v01 + 1;
    if (((i + j) & 1) === 0) idx.push(v00, v10, v11, v00, v11, v01);
    else idx.push(v00, v10, v01, v10, v11, v01);
  }
  const edgeGrid = [(t) => t * NV, (t) => t * NV + N, (t) => t, (t) => N * NV + t];
  for (let e = 0; e < 4; e++) {
    const reversed = e === 1 || e === 2;
    for (let k = 0; k < N; k++) {
      const e0 = edgeGrid[e](k), e1 = edgeGrid[e](k + 1), s0 = GRID_VERTS + e * NV + k, s1 = s0 + 1;
      if (!reversed) idx.push(e0, e1, s0, e1, s1, s0);
      else idx.push(e1, e0, s1, e0, s0, s1);
    }
  }
  SHARED_INDEX = new Uint16Array(idx);
  const uv = new Float32Array(TOTAL_VERTS * 2);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) { const o = j * NV + i; uv[o * 2] = i / N; uv[o * 2 + 1] = j / N; }
  for (let e = 0; e < 4; e++) for (let t = 0; t < NV; t++) {
    const src = edgeGrid[e](t), dst = GRID_VERTS + e * NV + t;
    uv[dst * 2] = uv[src * 2]; uv[dst * 2 + 1] = uv[src * 2 + 1];
  }
  SHARED_UV = uv;
}

function faceDir(face, a, b, out) {
  const F = FACES[face], N0 = F[0], U = F[1], V = F[2];
  const s = Math.tan(a * QPI), t = Math.tan(b * QPI);
  const x = N0[0] + s * U[0] + t * V[0], y = N0[1] + s * U[1] + t * V[1], z = N0[2] + s * U[2] + t * V[2];
  const l = Math.sqrt(x * x + y * y + z * z);
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}

// ---------------------------------------------------------------------------------------------
// quadtree node
// ---------------------------------------------------------------------------------------------
class Node {
  constructor(face, level, x, y, parent) {
    this.face = face; this.level = level; this.x = x; this.y = y; this.parent = parent;
    this.key = tileKey(face, level, x, y);
    const b = tileBounds(face, level, x, y);
    this.a0 = b.a0; this.a1 = b.a1; this.b0 = b.b0; this.b1 = b.b1;
    this.children = null;
    this.state = EMPTY; this.job = null; this.result = null;
    this.minH = parent ? parent.minH : -9000; this.maxH = parent ? parent.maxH : 22000;
    this.geomErr = parent ? parent.geomErr * 0.5 : 2e5;
    this.size = tileSizeAt(level);
    // 3×3 sample directions (horizon + bounds), centre
    this.dirs = new Float64Array(27);
    const d = {};
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      faceDir(face, this.a0 + (this.a1 - this.a0) * i / 2, this.b0 + (this.b1 - this.b0) * j / 2, d);
      const o = (j * 3 + i) * 3; this.dirs[o] = d.x; this.dirs[o + 1] = d.y; this.dirs[o + 2] = d.z;
    }
    this.cx = this.dirs[12] * R; this.cy = this.dirs[13] * R; this.cz = this.dirs[14] * R;
    // true ground size (diagonal of the corners / √2)
    const dx = this.dirs[0] - this.dirs[24], dy = this.dirs[1] - this.dirs[25], dz = this.dirs[2] - this.dirs[26];
    const ex = this.dirs[6] - this.dirs[18], ey = this.dirs[7] - this.dirs[19], ez = this.dirs[8] - this.dirs[20];
    this.groundSize = Math.max(Math.hypot(dx, dy, dz), Math.hypot(ex, ey, ez)) * R / Math.SQRT2;
    this.updateSphere();
    // edge probes: points just outside each edge midpoint → {face, a, b}
    this.probes = null;
    this.split = false; this.drawn = false;
    this.lastTouch = -1; this.lastDrawn = -1; this.pinFrame = -1;
    this.morph = 1; this.morphStart = -1;
    this.mesh = null; this.info = null; this.bytes = 0; this.texRes = 0; this.steep = parent ? parent.steep : false;
    this.upgradeJob = null; this.sseRatio = 0; this.wantPriority = 0;
  }
  updateSphere() {
    // centre/radius from the 3×3 samples at min and max height (ECEF, absolute)
    let sx = 0, sy = 0, sz = 0;
    const rm = R + (this.minH + this.maxH) * 0.5;
    for (let k = 0; k < 9; k++) { sx += this.dirs[k * 3] * rm; sy += this.dirs[k * 3 + 1] * rm; sz += this.dirs[k * 3 + 2] * rm; }
    sx /= 9; sy /= 9; sz /= 9;
    let r2 = 0;
    for (let k = 0; k < 9; k++) for (const h of [this.minH, this.maxH]) {
      const r = R + h;
      const px = this.dirs[k * 3] * r - sx, py = this.dirs[k * 3 + 1] * r - sy, pz = this.dirs[k * 3 + 2] * r - sz;
      r2 = Math.max(r2, px * px + py * py + pz * pz);
    }
    // the 3×3 samples underestimate the bulge of large tiles: pad by the sagitta of half a tile
    const half = this.groundSize * 0.75;
    this.bsx = sx; this.bsy = sy; this.bsz = sz; this.bsr = Math.sqrt(r2) + (half * half) / (2 * R) + 1;
  }
  ensureChildren() {
    if (!this.children) {
      const L = this.level + 1, x = this.x * 2, y = this.y * 2;
      this.children = [new Node(this.face, L, x, y, this), new Node(this.face, L, x + 1, y, this), new Node(this.face, L, x, y + 1, this), new Node(this.face, L, x + 1, y + 1, this)];
    }
    return this.children;
  }
  ensureProbes() {
    if (this.probes) return this.probes;
    const eps = (this.a1 - this.a0) * 0.02;
    const am = (this.a0 + this.a1) / 2, bm = (this.b0 + this.b1) / 2;
    const pts = [[this.a0 - eps, bm], [this.a1 + eps, bm], [am, this.b0 - eps], [am, this.b1 + eps]];
    const d = {}, f = {};
    this.probes = pts.map(([a, b]) => { faceDir(this.face, a, b, d); vecToFace(d.x, d.y, d.z, f); return { face: f.face, a: f.a, b: f.b }; });
    return this.probes;
  }
}

// ---------------------------------------------------------------------------------------------
// system
// ---------------------------------------------------------------------------------------------
const _sphere = new THREE.Sphere();
const _v = new THREE.Vector3();

export class TerrainSystem {
  constructor(app) {
    this.app = app;
    this.cfg = { ...TERRAIN_CFG };
    this.roots = [];
    this.results = [];
    this.loading = new Set();
    this.upgrading = new Set();       // nodes with a queued / running texture upgrade job
    this.ready = new Set();
    this.drawn = new Set();
    this.drawnKeys = new Set();
    this.drawList = [];
    this.gpuBytes = 0;
    this.frameNo = 0;
    this.time = 0;
    this._ground = 0;
    this._groundFrame = -1;
    this._busy = true;
    this.stats = { built: 0, buildMs: 0, maxBuildMs: 0, uploads: 0, evicted: 0, cancelled: 0, upgrades: 0, lastBuild: null, byTex: {}, uploadMs: 0, maxUploadMs: 0 };
  }

  async init() {
    const app = this.app;
    sharedTopology();
    this.shared = new TerrainShared(app.renderer);
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;
    app.scene.add(this.group);
    this._detectLighting();
    for (let f = 0; f < 6; f++) this.roots.push(new Node(f, 0, 0, 0, null));
    for (const r of this.roots) this._submit(r, ROOT_PRI, TEX_LOW);
    this._makePlaceholder();
    app.events?.on?.('settings', (e) => { const key = e && e.key; if (key === 'debugLayer' || key === 'clean') this._applyDebug(); });
    this._applyDebug();
  }

  _detectLighting() {
    // If the planet lighting gates emissive maps by night (and reads the onset from alpha) we
    // must not gate twice. The stub lighting does nothing, so we gate ourselves by default.
    const L = this.app.lighting;
    let handled = false;
    try {
      handled = !!(L && (L.nightEmissive === true || L.features?.nightEmissive || L.capabilities?.nightEmissive ||
        (typeof L.supports === 'function' && L.supports('nightEmissive'))));
    } catch { handled = false; }
    this.shared.uniforms.uTrNightGate.value = handled ? 0 : 1;
  }

  _makePlaceholder() {
    // low-cost globe shown until the six root tiles exist (no relief)
    try {
      const m = getControlMaps();
      const W = 512, H = 256, data = new Uint8Array(W * H * 4);
      const sx = m.water.width / W, sy = m.water.height / H;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = Math.floor(y * sy) * m.water.width + Math.floor(x * sx);
        const o = ((H - 1 - y) * W + x) * 4;
        const water = m.water.data[i] > 127, dens = m.density.data[i] / 255;
        let r = 176, g = 84, b = 46;
        r += (205 - r) * dens; g += (200 - g) * dens; b += (192 - b) * dens;
        if (water) { r = 14; g = 44; b = 92; }
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, W, H); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
      const geo = new THREE.SphereGeometry(R - 500, 128, 64);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setX(i, (Math.atan2(pos.getX(i), pos.getZ(i)) / Math.PI + 1) / 2);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
      try { this.app.lighting?.patch?.(mat); } catch { /* optional */ }
      this.placeholder = new THREE.Mesh(geo, mat);
      this.placeholder.frustumCulled = false;
      this.app.scene.add(this.placeholder);
    } catch { this.placeholder = null; }
  }

  _applyDebug() {
    const layer = this.app.state?.settings?.debugLayer || 'none';
    const clean = this.app.state?.settings?.clean;
    const mode = clean ? 0 : (DEBUG_MODES[layer] ?? 0);
    const wantMaps = mode >= 1 && mode <= 3;
    if (wantMaps) this.shared.ensureDebugMaps();
    if (wantMaps !== this.shared.debugMapsOn) {
      // the packed control-map sampler is only compiled into the debug variant of the program
      this.shared.debugMapsOn = wantMaps;
      for (const n of this.ready) {
        const m = n.mesh && n.mesh.material; if (!m) continue;
        m.defines = m.defines || {};
        if (wantMaps) m.defines.TR_DEBUG_MAPS = 1; else delete m.defines.TR_DEBUG_MAPS;
        m.needsUpdate = true;
      }
    }
    this.shared.uniforms.uTrDebug.value = mode;
  }

  // -------------------------------------------------------------------------------------------
  update(frame) {
    this.frameNo++;
    this.time = frame.time ?? (this.time + (frame.dt || 0.016));
    const sh = this.shared.uniforms;
    sh.uTrPlanetCenter.value.copy(frame.planetCenter);
    sh.uTrSunDir.value.copy(frame.sunDir);
    this._updateLightBands(frame);
    if (frame.settings) {
      const dk = (frame.settings.debugLayer || 'none') + (frame.settings.clean ? '|clean' : '');
      if (dk !== this._lastDebug) { this._lastDebug = dk; this._applyDebug(); }
    }

    this._processResults(this.cfg.uploadBudgetMs);
    // camera / projection constants
    const cam = frame.camEcef;
    this._cam = cam;
    this._camR = Math.hypot(cam.x, cam.y, cam.z);
    this._camH = this._camR - R;
    // the chain under the camera is queued from the very first frame (behind the six roots only)
    this._focusChain();
    const rootsReady = this.roots.every((r) => r.state === READY);
    if (!rootsReady) {
      for (const r of this.roots) {
        if (r.state === READY) continue;
        r.lastTouch = this.frameNo;
        if (r.state === EMPTY && this._blocked(r) !== 1) this._submit(r, ROOT_PRI, TEX_LOW);
      }
      if (this.placeholder) this.placeholder.position.set(-origin.x, -origin.y, -origin.z);
      this._busy = true;
      return;
    }
    if (this.placeholder) {
      this.app.scene.remove(this.placeholder);
      this.placeholder.geometry.dispose(); this.placeholder.material.map?.dispose(); this.placeholder.material.dispose();
      this.placeholder = null;
    }

    const vp = frame.viewport || { height: 900, pixelRatio: 1 };
    const fov = (frame.camera?.fov || 35) * Math.PI / 180;
    this._K = (vp.height * (vp.pixelRatio || 1)) / (2 * Math.tan(fov / 2));
    this._frustum = frame.frustum;
    const rs = R + this.cfg.minPlanetH;
    this._hc = { x: cam.x / rs, y: cam.y / rs, z: cam.z / rs, rs };
    this._hc.vh2 = this._hc.x * this._hc.x + this._hc.y * this._hc.y + this._hc.z * this._hc.z - 1;

    // select the displayed cut
    this.drawList.length = 0;
    this._wanted = 0;
    for (const r of this.roots) this._traverse(r);
    this._balance();
    this._commitDrawSet(frame);
    this._updateDatum(frame);
    this._cancelStale();
    this._evict();
    if (this.frameNo % 240 === 0) this._prune();
    this._ground = this._sampleGround(cam.x, cam.y, cam.z);
    this._groundFrame = this.frameNo;
  }

  /** analytic (full detail) ground height at the unit direction, cached while the camera moves < ~5 cm */
  _analyticGround(ux, uy, uz) {
    const c = this._agc || (this._agc = { x: 0, y: 0, z: 0, h: 0, ok: false });
    const d2 = (ux - c.x) * (ux - c.x) + (uy - c.y) * (uy - c.y) + (uz - c.z) * (uz - c.z);
    if (!c.ok || d2 * R * R > 0.0025) {
      let h = 0;
      try { h = heightAt(ux, uy, uz, 0); } catch { h = 0; }
      c.x = ux; c.y = uy; c.z = uz; c.h = Number.isFinite(h) ? h : 0; c.ok = true;
    }
    return c.h;
  }

  /**
   * Camera-first refinement (Z-01, QA-ASSETS-01). Previously the display could only descend one level per
   * "all four children READY" step, two levels of requests deep, behind breadth tiles and city jobs, with the
   * four siblings of a split built back to back in ONE worker: a jump to a street pose stayed on L2–L5 tiles
   * for minutes. Now the whole chain under the camera — root → the level whose tiles are ≈ chainSize × the
   * camera's height above the analytic ground (≥ chainMinSize m; L17 at eye level) — is requested every
   * frame, all levels at once (tiles do not depend on their parents' data), as single-tile jobs so the four
   * siblings of a level build in parallel, with absolute priority (only the six roots go first), coarse levels
   * first so the display descends progressively. A not-yet-started sibling batch of the regular traversal is
   * split into single jobs. Intermediate levels use a cheap first texture pass (chainTex); the last two chain
   * levels use TEX_LOW; whatever ends up displayed is upgraded by the usual rules.
   */
  _focusChain() {
    if (!this.cfg.chain || !(this._camR > 0)) return;
    const cam = this._cam, r = this._camR;
    const ux = cam.x / r, uy = cam.y / r, uz = cam.z / r;
    const f = vecToFace(ux, uy, uz, _fc);
    // full-detail world height only for low cameras (it builds regional caches on first use: no hitches while the
    // globe spins at orbit, where the chain is a couple of levels deep and the datum shift is off anyway)
    const hT = this._camH > 40000 ? (this._ground || 0) : this._analyticGround(ux, uy, uz);
    const hAG = Math.max(0.5, this._camH - hT);
    this._hTrue = hT; this._hAG = hAG;
    const want = Math.max(this.cfg.chainMinSize, this.cfg.chainSize * hAG);
    let Lt = 1;
    while (Lt < MAX_LEVEL && tileSizeAt(Lt) * 0.85 > want) Lt++;
    this._chainTarget = Lt;
    const fno = this.frameNo;
    let node = this.roots[f.face], depth = node.state === READY ? 0 : -1;
    for (let L = 1; L <= Lt; L++) {
      const kids = node.ensureChildren();
      const am = (node.a0 + node.a1) * 0.5, bm = (node.b0 + node.b1) * 0.5;
      const focus = kids[(f.b >= bm ? 2 : 0) + (f.a >= am ? 1 : 0)];
      const T = L >= Lt - 1 ? TEX_LOW : this.cfg.chainTex;
      for (const k of kids) {
        const pri = CHAIN_PRI + L + (k === focus ? 0 : 0.5);
        k.chainFrame = fno; k.chainPri = pri; k.lastTouch = fno; k.wantPriority = pri;
        if (k.state === READY) continue;
        const blk = this._blocked(k);
        if (blk === 2) continue;
        this._wanted++;
        if (blk === 1) continue;
        if (k.state === LOADING && k.job && !k.result) {
          const j = k.job;
          if (j.nodes && !j.started) {
            // sibling batch still queued: split it so the siblings build in parallel
            try { j.cancel(); } catch { /* raced */ }
            for (const s of j.nodes) if (s.job === j) { s.job = null; s.state = EMPTY; this.loading.delete(s); }
          } else if (j.priority > pri) j.priority = pri;
        }
        if (k.state === EMPTY) this._submit(k, pri, T);
      }
      if (focus.state === READY && depth === L - 1) depth = L;
      node = focus;
    }
    this._chainDepth = depth;
  }

  /**
   * Coarse-tile datum shift. Until the chain under the camera has refined, the displayed (coarse) ground at the
   * camera can lie tens to hundreds of metres above or below the analytic ground the controls hold the camera
   * on: underground views, streets floating in the sky. The vertex shader moves every terrain vertex within
   * 0.6 (full) … 2.5 (none) displayed-leaf sizes of the camera nadir along its up vector by
   * Δ = analytic − displayed height at the nadir (soft threshold: |Δ| < 0.3 m → 0, full from 1 m), only while the
   * camera is low (fades out 1.5–8 km above ground) or close to / below the shown ground. Δ is continuous across
   * splits and merges (the displayed height follows the leaf's geomorph); the radius is smoothed in time.
   */
  _updateDatum(frame) {
    const u = this.shared.uniforms.uTrDatum.value;
    if (!this.cfg.datum || !(this._camR > 0)) { u.set(0, 1, 2, 0); this._datum = 0; return; }
    const cam = this._cam, r = this._camR;
    const f = vecToFace(cam.x / r, cam.y / r, cam.z / r, _fc);
    const leaf = this._leafAt(f.face, f.a, f.b);
    let target = 0, size = this._datumSize || 1000;
    this._nadirLevel = leaf ? leaf.level : -1;
    if (leaf && leaf.state === READY && leaf.heights) {
      let hD = tileHeight(leaf, f.a, f.b);
      const p = leaf.parent;
      if (leaf.morph < 1 && p && p.state === READY && p.heights) {
        const m = Math.max(0, leaf.morph), s = m * m * (3 - 2 * m);
        hD = tileHeight(p, f.a, f.b) * (1 - s) + hD * s;
      }
      this._hDisp = hD;
      const d = (this._hTrue ?? hD) - hD;
      const k = Math.max(1 - smooth(1500, 8000, this._hAG ?? 1e9), 1 - smooth(20, 120, this._camH - hD));
      target = d * smooth(0.3, 1.0, Math.abs(d)) * k;
      size = leaf.groundSize;
    }
    this._datum = target;
    const a = 1 - Math.exp(-Math.min(0.25, Math.max(0.001, frame.dt || 0.016)) / 0.4);
    this._datumSize = this._datumSize ? this._datumSize + (size - this._datumSize) * a : size;
    const S = this._datumSize;
    u.set(target, 0.6 * S, 2.5 * S, target !== 0 ? 1 : 0);
    // the shadow pass draws the unshifted mesh: no terrain shadow casters while a shift is active
    this._noCast = Math.abs(target) > 0.5;
  }

  /** metres the shader currently shifts the shown terrain at ECEF point p (0 outside the datum region) */
  displayShift(p) {
    const u = this.shared?.uniforms?.uTrDatum?.value;
    if (!u || !u.w || !this._cam) return 0;
    const c = this._cam, r = this._camR;
    const ux = c.x / r, uy = c.y / r, uz = c.z / r;
    const wx = p.x - c.x, wy = p.y - c.y, wz = p.z - c.z;
    const t = wx * ux + wy * uy + wz * uz;
    const hd = Math.hypot(wx - ux * t, wy - uy * t, wz - uz * t);
    return u.x * (1 - smooth(u.y, u.z, hd));
  }

  chainInfo() {
    return { target: this._chainTarget ?? -1, depth: this._chainDepth ?? -1, nadirLevel: this._nadirLevel ?? -1,
      hDisp: this._hDisp ?? null, hTrue: this._hTrue ?? null, hAG: this._hAG ?? null, datum: this._datum || 0 };
  }

  /**
   * Night light hand-over by camera distance (D3). The terrain's window aggregate is the complement of
   * the 3D city's building visibility (render/city: mass models fade in from 1.6 to 4 px projected size
   * and dissolve over 0.84–0.97 of the streamed radius min(maxDist, K·refHeight/minPx)), evaluated for a
   * typical 30 m building, so far windows are drawn exactly once. Street light fades out within ~1.5 km
   * of the camera, where the props street lamps and their light pools take over.
   */
  _updateLightBands(frame) {
    const sh = this.shared.uniforms;
    const city = this.app.systems?.city;
    const cfg = city && city.cfg;
    // fix round 3: the city's own effective far coverage (mass dissolve band incl. the maxTiles truncation of the streamed
    // disc, projected-size fade of its typical building) — the window aggregate is drawn as its exact complement
    if (city && city.enabled !== false) {
      let fc = null;
      try { fc = city.farCoverage; } catch { fc = null; }
      if (fc && fc.K > 0 && Number.isFinite(fc.maxDist0) && Number.isFinite(fc.maxDist1) && fc.fadePx) {
        sh.uTrCityFade.value.set((fc.typicalSize || 30) * fc.K, fc.fadePx[0], fc.fadePx[1], 1);
        sh.uTrCityMax.value.set(fc.maxDist0, fc.maxDist1);
        return;
      }
    }
    if (cfg && city.enabled !== false) {
      // fallback (city module without farCoverage / before its first frame): mirror CITY_CFG
      const vp = frame.viewport || { height: 900, pixelRatio: 1 };
      const fov = (frame.camera?.fov || 35) * Math.PI / 180;
      const lod = this.app.pipeline?.lodScale || 1;
      const K = city.K || (vp.height * (vp.pixelRatio || 1) * lod) / (2 * Math.tan(fov / 2));
      const dmax = Math.min(cfg.maxDist || 19000, K * (cfg.refHeight || 30) / (cfg.minPx || 2.2));
      sh.uTrCityFade.value.set(30 * K, 1.6, 4.0, 1);
      sh.uTrCityMax.value.set(dmax * 0.84, dmax * 0.97);
    } else sh.uTrCityFade.value.w = 0;
  }

  _visible(node) {
    // frustum (bounding sphere in render space)
    _sphere.center.set(node.bsx - origin.x, node.bsy - origin.y, node.bsz - origin.z);
    _sphere.radius = node.bsr;
    if (this._frustum && !this._frustum.intersectsSphere(_sphere)) return 0;
    // horizon: a tile is hidden if all 3×3 samples at its max height are behind the planet
    if (node.level >= 3 && this._hc.vh2 > 0) {
      const hc = this._hc, s = (R + node.maxH) / hc.rs;
      for (let k = 0; k < 9; k++) {
        const vx = node.dirs[k * 3] * s - hc.x, vy = node.dirs[k * 3 + 1] * s - hc.y, vz = node.dirs[k * 3 + 2] * s - hc.z;
        const vtDotVc = -(vx * hc.x + vy * hc.y + vz * hc.z);
        const occluded = vtDotVc > hc.vh2 && (vtDotVc * vtDotVc) / (vx * vx + vy * vy + vz * vz) > hc.vh2;
        if (!occluded) return 1;
      }
      return 2;   // in frustum but behind the horizon
    }
    return 1;
  }

  _closestDist(node) {
    const c = this._cam;
    const F = FACES[node.face], Nf = F[0], U = F[1], V = F[2];
    const dn = c.x * Nf[0] + c.y * Nf[1] + c.z * Nf[2];
    let d;
    if (dn > 0.2 * this._camR) {
      const s = (c.x * U[0] + c.y * U[1] + c.z * U[2]) / dn, t = (c.x * V[0] + c.y * V[1] + c.z * V[2]) / dn;
      let a = Math.atan(s) / QPI, b = Math.atan(t) / QPI;
      a = a < node.a0 ? node.a0 : a > node.a1 ? node.a1 : a;
      b = b < node.b0 ? node.b0 : b > node.b1 ? node.b1 : b;
      faceDir(node.face, a, b, _q);
      const h = this._camH < node.minH ? node.minH : this._camH > node.maxH ? node.maxH : this._camH;
      const r = R + h;
      const vx = c.x - _q.x * r, vy = c.y - _q.y * r, vz = c.z - _q.z * r;
      d = Math.sqrt(vx * vx + vy * vy + vz * vz);
      // sine of the viewing elevation at the closest point (1 = looking straight down)
      node.sinView = d > 1e-6 ? Math.abs(vx * _q.x + vy * _q.y + vz * _q.z) / d : 1;
    } else {
      d = Math.hypot(c.x - node.bsx, c.y - node.bsy, c.z - node.bsz) - node.bsr;
      node.sinView = 1;
    }
    return Math.max(d, 0.02);
  }

  _ratio(node, d) {
    const K = this._K;
    // geometric error is (mostly) radial: seen from above it projects by sin(zenith angle); keep a
    // floor so parallax under a moving camera and near-vertical silhouettes stay covered
    const sv = node.sinView ?? 1;
    const proj = Math.max(0.3, Math.sqrt(Math.max(0, 1 - sv * sv)));
    let g = (node.geomErr * proj * K) / (d * this.cfg.geomPx);
    // geometry can only refine while grid vertices are more than ~2 px apart on screen: beyond
    // that a step / cliff is already drawn as sharp as the screen allows (and height
    // discontinuities, which never converge, must not drive tiles to the max level)
    const vpx = ((node.groundSize / N) * K) / d;
    // steep tiles (cliffs, canyon walls, ice cliffs: cells rising > 1.2× their width) refine one level further, so
    // single triangles of a 1–3 km cliff do not read as facets (QQ-11)
    if (vpx < (node.steep ? this.cfg.minVertexPx * 0.5 : this.cfg.minVertexPx)) g = 0;
    // texture criterion: across-view texel size; strongly foreshortened tiles (grazing view)
    // may use slightly larger texels (anisotropic filtering covers the compressed direction).
    // Planet-scale tiles (levels ≤ 3–6) are supersampled (~2 texels per pixel): the disc then shows
    // the town structure of 5 km texels and point-like night lights (§6 抽查 1, A02 / A03) instead of
    // 10 km texels magnified, and the limb is not relaxed as much (no smeared night lights).
    const lt = Math.min(1, Math.max(0, (node.level - 3) / 3));
    const tpx = this.cfg.orbitTexelPx + (this.cfg.texelPx - this.cfg.orbitTexelPx) * lt;
    const relax = Math.min(1.3 + (this.cfg.maxRelax - 1.3) * lt, Math.max(1, 1 / Math.sqrt(Math.max(sv, 0.02))));
    const t = ((node.groundSize / TEX_FAR) * K) / (d * tpx * relax);
    return g > t ? g : t;
  }

  _traverse(node) {
    node.lastTouch = this.frameNo;
    const vis = this._visible(node);
    node.vis = vis;
    let wantSplit = false;
    if (vis === 1 && node.level < MAX_LEVEL) {
      const d = this._closestDist(node);
      node.dist = d;
      node.sseRatio = this._ratio(node, d);
      wantSplit = node.sseRatio > (node.split ? this.cfg.mergeHyst : 1);
    } else node.sseRatio = 0;
    if (wantSplit) {
      const kids = node.ensureChildren();
      let ready = 0;
      for (const k of kids) if (k.state === READY) ready++;
      if (ready < 4) {
        // urgency = screen-space error ratio × nearness boost: tiles under / near the camera refine
        // first instead of queueing behind far tiles with similar ratios (canyon / grazing views)
        const boost = this._boost(node);
        this._requestKids(kids, node.sseRatio * boost);
        // look-ahead: during a zoom the next level is built in parallel instead of level by level
        if (this.cfg.lookahead && node.level + 2 <= MAX_LEVEL) {
          for (const k of kids) {
            if (k.state === READY || this._visible(k) !== 1) continue;
            const r = this._ratio(k, this._closestDist(k));
            if (r > this.cfg.lookahead) this._requestKids(k.ensureChildren(), r * 0.5 * boost);
          }
        }
      }
      if (ready === 4) {
        node.split = true;
        for (const k of kids) this._traverse(k);
        return;
      }
    }
    node.split = false;
    this.drawList.push(node);
  }

  /** nearness boost of a node's request priority: ≈ 2.8 for tiles right under the camera, → 1 beyond a
   *  few camera heights above the ground */
  _boost(node) {
    const d = node.dist ?? this._closestDist(node);
    const hG = Math.max(150, (this._camH || 0) - (this._ground || 0));
    return 1 + 3 * Math.exp(-d / (2.5 * hG));
  }

  /** drawn leaf containing face point (face, a, b): descend while nodes are split */
  _leafAt(face, a, b) {
    let node = this.roots[face];
    while (node && node.split && node.children) {
      const am = (node.a0 + node.a1) * 0.5, bm = (node.b0 + node.b1) * 0.5;
      node = node.children[(b >= bm ? 2 : 0) + (a >= am ? 1 : 0)];
    }
    return node;
  }

  /**
   * Restricted quadtree (2:1 balance): a displayed tile never touches a displayed neighbour more than
   * one level coarser, so every edge is stitched exactly by the edge morph (uTrEdgeCoarse) and skirts
   * stay a safety net only. Coarse neighbours are split (if their children are loaded; otherwise the
   * children are requested with high priority and the skirts cover the gap meanwhile).
   */
  _balance() {
    const list = this.drawList;
    for (let iter = 0; iter < 24; iter++) {
      let changed = false;
      const add = [];
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (n.level < 2 || n.split) continue;
        const pr = n.ensureProbes();
        for (let e = 0; e < 4; e++) {
          const p = pr[e];
          const c = this._leafAt(p.face, p.a, p.b);
          if (!c || c.split || c.level >= n.level - 1) continue;
          const kids = c.ensureChildren();
          let ready = 0; for (const k of kids) if (k.state === READY) ready++;
          if (ready === 4) {
            c.split = true; c.forced = this.frameNo;
            for (const k of kids) { k.split = false; k.lastTouch = this.frameNo; k.vis = this._visible(k); if (k.vis === 1) { k.dist = this._closestDist(k); k.sseRatio = this._ratio(k, k.dist); } else k.sseRatio = 0; add.push(k); }
            changed = true;
          } else {
            this._requestKids(kids, Math.max(2, n.sseRatio) * 1.5 * this._boost(n));
          }
        }
      }
      if (!changed) break;
      // rebuild the cut: drop tiles that became split, append their children
      let w = 0;
      for (let i = 0; i < list.length; i++) if (!list[i].split) list[w++] = list[i];
      list.length = w;
      for (const k of add) list.push(k);
    }
  }

  _chooseTex(node) {
    // progressive: every tile starts at TEX_LOW (16× cheaper than TEX_NEAR); only displayed,
    // visible leaves are upgraded (ancestors are shown only briefly while children load)
    return TEX_LOW;
  }

  /** a failed build is retried with back-off; after 3 failures the tile is given up (its parent stays
   *  displayed) so a broken world function never keeps the system busy forever */
  _failed(node, err) {
    node.job = null; node.state = EMPTY; this.loading.delete(node);
    if (err?.cancelled) return;
    node.fails = (node.fails || 0) + 1;
    node.retryAt = this.frameNo + 30 * (1 << node.fails);
    this.stats.failed = (this.stats.failed || 0) + 1;
    if (node.fails <= 3) console.warn('[terrain] tile failed', node.key, `(attempt ${node.fails})`, err);
  }
  _blocked(node) {
    if (!node.fails) return 0;
    if (node.fails >= 3) return 2;                       // given up: not wanted any more
    return this.frameNo < node.retryAt ? 1 : 0;          // backing off: still wanted
  }

  _request(node, parentRatio, texRes) {
    node.lastTouch = this.frameNo;
    const blk = this._blocked(node);
    if (blk === 2) return;
    let pri = -Math.min(parentRatio, 1e6) + node.level * 1e-3;
    if (node.chainFrame === this.frameNo && node.chainPri < pri) pri = node.chainPri;   // camera chain: keep its urgency
    node.wantPriority = pri;
    this._wanted++;
    if (blk === 1) return;
    if (node.state === EMPTY) this._submit(node, pri, texRes || this._chooseTex(node));
    else if (node.state === LOADING && node.job && !node.result) node.job.priority = pri;
  }

  /** one single-tile worker job */
  _submit(node, pri, T) {
    const job = this.app.workers.submit('terrainTile', { face: node.face, level: node.level, x: node.x, y: node.y, texRes: T }, { priority: pri });
    node.job = job; node.state = LOADING; node.reqTex = T;
    this.loading.add(node);
    job.promise.then((res) => {
      if (node.job !== job) return;
      node.result = res; this.results.push(node);
    }, (err) => {
      if (node.job !== job) return;
      this._failed(node, err);
    });
  }

  /** request the missing children of a splitting tile as ONE worker job (shared world caches) */
  _requestKids(kids, parentRatio) {
    const pri = -Math.min(parentRatio, 1e6) + kids[0].level * 1e-3;
    const fresh = [];
    for (const k of kids) {
      if (k.state === READY) continue;
      k.lastTouch = this.frameNo;
      const blk = this._blocked(k);
      if (blk === 2) continue;
      const kp = k.chainFrame === this.frameNo && k.chainPri < pri ? k.chainPri : pri;   // camera chain: keep its urgency
      k.wantPriority = kp; this._wanted++;
      if (blk === 1) continue;
      if (k.state === EMPTY) fresh.push(k);
      else if (k.job && !k.result && !(k.job.nodes && k.job.priority < kp)) k.job.priority = kp;
    }
    if (!fresh.length) return;
    if (fresh.length === 1) { this._request(fresh[0], parentRatio, 0); return; }
    const tiles = fresh.map((k) => ({ face: k.face, level: k.level, x: k.x, y: k.y, texRes: this._chooseTex(k) }));
    const job = this.app.workers.submit('terrainTiles', { tiles }, { priority: pri });
    job.nodes = fresh;              // a not-yet-started batch may be split by the camera chain (_focusChain)
    for (const k of fresh) { k.job = job; k.state = LOADING; k.reqTex = tiles[0].texRes; this.loading.add(k); }
    job.promise.then((res) => {
      const list = res && res.results;
      for (let i = 0; i < fresh.length; i++) {
        const k = fresh[i];
        if (k.job !== job) continue;
        if (list && list[i]) { k.result = list[i]; this.results.push(k); }
        else this._failed(k, new Error('missing result'));
      }
    }, (err) => {
      for (const k of fresh) if (k.job === job) this._failed(k, err);
    });
  }

  /** returns true while an upgrade of `node` to T texels is pending (false: done / given up) */
  _requestUpgrade(node, T, px, force = false) {
    if ((node.texRes >= T && !force) || (node.upgradeFails || 0) >= 2) return false;
    node.upgradeWant = this.frameNo;
    // texture upgrades compete with tile builds on the builds' scale (−ratio × boost, see _traverse). A displayed
    // leaf still at its 128² first pass is 2× coarser than the split criterion: it ranks like a split of ratio
    // 2·px/upgradePx (near ones ahead of far splits, far ones next to them). Before (final-capture diagnosis,
    // S03): first-pass upgrades ranked below every far split, so in grazing views the near field stayed at 128²
    // for minutes. 256² → 512² upgrades of magnified leaves keep their old rank; barely magnified ones run last.
    const coarse = node.texRes > 0 && node.texRes < TEX_FAR ? TEX_FAR / node.texRes : 1;
    const pri = coarse > 1 ? -1.5 * Math.min((px * coarse) / this.cfg.upgradePx, 400)
      : (px > 2 ? -0.75 * Math.min(px / this.cfg.upgradePx, 400) : 1000 - px);
    if (node.upgradeJob) {
      if (node.upgradeTex >= T) { node.upgradeJob.priority = pri; return true; }
      try { node.upgradeJob.cancel(); } catch { /* */ }
    }
    const job = this.app.workers.submit('terrainTile', { face: node.face, level: node.level, x: node.x, y: node.y, texRes: T }, { priority: pri });
    node.upgradeJob = job; node.upgradeTex = T;
    this.upgrading.add(node);
    this.stats.upgradeReq = (this.stats.upgradeReq || 0) + 1;
    job.promise.then((res) => {
      if (node.upgradeJob !== job) return;
      node.upgradeResult = res; this.results.push(node);
    }, (err) => {
      if (node.upgradeJob !== job) return;
      node.upgradeJob = null; this.upgrading.delete(node);
      if (!err?.cancelled) { node.upgradeFails = (node.upgradeFails || 0) + 1; console.warn('[terrain] texture upgrade failed', node.key, err); }
    });
    return true;
  }

  _processResults(budgetMs) {
    if (!this.results.length) return;
    const t0 = performance.now();
    // coarse / urgent first
    this.results.sort((a, b) => a.wantPriority - b.wantPriority);
    while (this.results.length) {
      if (performance.now() - t0 > budgetMs) break;
      const node = this.results.shift();
      if (node.upgradeResult) {
        const res = node.upgradeResult; node.upgradeResult = null; node.upgradeJob = null;
        this.upgrading.delete(node);
        if (node.state === READY && (res.texRes > node.texRes || (node.degraded && res.texRes >= node.texRes))) this._applyUpgrade(node, res);
        continue;
      }
      if (node.state !== LOADING || !node.result) continue;
      const res = node.result; node.result = null; node.job = null;
      this.loading.delete(node);
      this._createGpu(node, res);
    }
  }

  _textures(res) {
    const sh = this.shared, T = res.texRes;
    const albedo = sh.makeTexture(res.albedo, T, true);
    const normal = sh.makeTexture(res.normal, T, false);
    const emission = res.emission ? sh.makeTexture(res.emission, T, true) : null;
    const r = this.app.renderer;
    if (r?.initTexture) { r.initTexture(albedo); r.initTexture(normal); if (emission) r.initTexture(emission); }
    const bytes = T * T * 4 * (emission ? 3 : 2) * 1.34;
    return { albedo, normal, emission, bytes };
  }

  _createGpu(node, res) {
    const t0 = performance.now();
    const g = new THREE.BufferGeometry();
    g.setIndex(new THREE.BufferAttribute(SHARED_INDEX, 1));
    g.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(SHARED_UV, 2));
    g.setAttribute('morphDelta', new THREE.BufferAttribute(res.morph, 3));
    // own BufferAttribute per geometry (a shared attribute object would lose its GL buffer when any tile is disposed)
    g.setAttribute('trWl', new THREE.BufferAttribute(res.wl || NO_WL, 2));
    // fix round 3 (memory): normals / geomorph deltas / water-line attributes are GPU-only (CPU raycasts and ground
    // sampling read node.positions / node.heights): drop their arrays once uploaded
    for (const k of ['normal', 'morphDelta', 'trWl']) g.attributes[k].onUpload(releaseAttrArray);
    const bs = res.bsphere;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(bs[0], bs[1], bs[2]), bs[3]);
    const tex = this._textures(res);
    const P = 2621.44;                       // period of the shader detail noise (m)
    const fa = (node.a0 * FACE_ARC) % P, fb = (node.b0 * FACE_ARC) % P;
    const Fc = FACES[node.face];
    const mat = createTileMaterial(this.shared, {
      albedo: tex.albedo, normal: tex.normal, emission: tex.emission, level: node.level,
      detailOrigin: [fa < 0 ? fa + P : fa, fb < 0 ? fb + P : fb], tileMeters: (node.a1 - node.a0) * FACE_ARC,
      faceOrigin: [node.a0 * FACE_ARC, node.b0 * FACE_ARC],
      texRes: res.texRes, faceU: Fc[1], faceV: Fc[2],
      upC: [res.center[0] / R, res.center[1] / R, res.center[2] / R],
      cMod: res.center.map((c) => ((c % 65536) + 65536) % 65536),
    }, this.app.lighting);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'terrain:' + node.key;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.receiveShadow = true;
    mesh.castShadow = node.level >= 9;
    mesh.userData.terrainTile = node.key;
    this.group.add(mesh);
    node.mesh = mesh; node.tex = tex; node.texRes = res.texRes;
    // built without (part of) the city (urban module missing / failing in that worker): rebuilt later
    node.degraded = res.urbanOk === false; node.degradedAt = this.time;
    node.positions = res.positions; node.heights = res.heights; node.rayBlocks = null;
    node.minH = res.minH; node.maxH = res.maxH; node.geomErr = res.geomErr;
    node.ccx = res.center[0]; node.ccy = res.center[1]; node.ccz = res.center[2];
    // precise bounding sphere (absolute)
    node.bsx = node.ccx + bs[0]; node.bsy = node.ccy + bs[1]; node.bsz = node.ccz + bs[2]; node.bsr = bs[3];
    node.water = res.water;
    node.steep = !!res.steep;
    node.bytes = tex.bytes + TOTAL_VERTS * 4 * 3 * 3 + (res.water ? GRID_VERTS * 24 : 0);
    this.gpuBytes += node.bytes;
    node.info = {
      key: node.key, face: node.face, level: node.level, x: node.x, y: node.y,
      centerEcef: { x: node.ccx, y: node.ccy, z: node.ccz }, mesh, minH: node.minH, maxH: node.maxH,
      geomErr: node.geomErr, texRes: node.texRes, heights: res.heights, water: res.water, waterData: res.water,
      bounds: { a0: node.a0, a1: node.a1, b0: node.b0, b1: node.b1 }, size: node.groundSize, n: NV, rev: 0,
    };
    node.state = READY;
    this.ready.add(node);
    // children estimates inherit the measured bounds
    if (node.children) for (const k of node.children) if (k.state !== READY) { k.minH = node.minH; k.maxH = node.maxH; k.geomErr = node.geomErr * 0.5; k.steep = node.steep; k.updateSphere(); }
    const ms = res.stats?.ms || 0;
    this.stats.built++; this.stats.buildMs += ms; this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, ms);
    const up = performance.now() - t0;
    this.stats.lastBuild = { key: node.key, T: res.texRes, ms: Math.round(ms), upload: +up.toFixed(1) };
    this.stats.uploads++; this.stats.uploadMs += up; this.stats.maxUploadMs = Math.max(this.stats.maxUploadMs, up);
    this._countBuild(res);
  }

  _applyUpgrade(node, res) {
    const old = node.tex;
    const tex = this._textures(res);
    const u = node.mesh.material;
    u.map = tex.albedo; u.normalMap = tex.normal; u.emissiveMap = tex.emission || this.shared.black;
    u.needsUpdate = !!old.emission !== !!tex.emission;
    node.tex = tex; node.texRes = res.texRes;
    node.degraded = res.urbanOk === false;
    u.userData.trUniforms.uTrTexRes.value = res.texRes;
    this.gpuBytes += tex.bytes - old.bytes; node.bytes += tex.bytes - old.bytes;
    old.albedo.dispose(); old.normal.dispose(); old.emission?.dispose();
    node.info.texRes = res.texRes;
    // finer texel heights refine the error / bounds estimates (geometry is identical)
    node.geomErr = res.geomErr; node.info.geomErr = res.geomErr;
    node.minH = Math.min(node.minH, res.minH); node.maxH = Math.max(node.maxH, res.maxH);
    node.info.minH = node.minH; node.info.maxH = node.maxH;
    node.info.rev = (node.info.rev || 0) + 1;
    if (node.water && res.water) { node.water.mask = res.water.mask; node.water.maskRes = res.water.maskRes; }
    else if (!node.water && res.water) {
      // water only resolved by the finer texels (narrow canal / pond): consumers saw water = null at
      // tile:add, so re-announce the tile
      node.water = res.water; node.info.water = res.water; node.info.waterData = res.water;
      if (node.drawn) { this.app.events?.emit?.('tile:remove', { tile: node.info }); this.app.events?.emit?.('tile:add', { tile: node.info }); }
    }
    // children cross-fading from this tile keep working (uniform values updated each frame)
    this.stats.upgrades++;
    this._countBuild(res);
  }

  _countBuild(res) {
    const T = res.texRes, st = res.stats || {}, ms = st.ms || 0;
    const b = this.stats.byTex[T] || (this.stats.byTex[T] = { n: 0, ms: 0, max: 0, vtx: 0, tex: 0, post: 0, maxKey: '' });
    b.n++; b.ms += ms; if (ms > b.max) { b.max = ms; b.maxKey = `${res.face}/${res.level}/${res.x}/${res.y} U${st.samplesU | 0} W${st.samplesW | 0}`; }
    b.vtx += st.msVertex || 0; b.tex += st.msTexel || 0; b.post += st.msPost || 0;
  }

  /**
   * Reverse geomorph on merges (zoom out): a tile that replaces its four displayed children does not pop
   * in — the children stay displayed for morphTime while they morph back to the parent's shape and
   * cross-fade to its texture, then the parent takes over (tile:add / tile:remove at the swap). A merge
   * that is cancelled (zoom back in) morphs the children up again from where they were.
   */
  _applyMerges(next) {
    const T = this.cfg.morphTime;
    if (!(T > 0)) return;
    let out = null;
    for (let i = 0; i < next.length; i++) {
      const n = next[i];
      const kids = n.children;
      let keep = false;
      if (!n.drawn && kids && n.state === READY && kids.every((k) => k.drawn && k.state === READY && k.mesh)) {
        if (!(n.mergeStart >= 0)) n.mergeStart = this.time;
        const t = (this.time - n.mergeStart) / T;
        if (t < 1) {
          keep = true;
          if (!out) out = next.slice(0, i);
          for (const k of kids) { k.revMorph = Math.min(k.revMorph ?? (k.morph ?? 1), 1 - t); k.revFrame = this.frameNo; out.push(k); }
        }
      }
      if (!keep) { n.mergeStart = -1; if (out) out.push(n); }
    }
    if (out) { next.length = 0; for (const x of out) next.push(x); }
  }

  _commitDrawSet(frame) {
    const next = this.drawList;
    const fno = this.frameNo;
    this._applyMerges(next);
    // pin ancestors of displayed tiles (needed for instant merges and the morph cross-fade)
    for (const n of next) { let p = n.parent; while (p && p.pinFrame !== fno) { p.pinFrame = fno; p = p.parent; } }
    const nextSet = new Set(next);
    const removed = new Set();
    for (const n of this.drawn) if (!nextSet.has(n)) removed.add(n);
    for (const n of removed) {
      n.drawn = false; n.revMorph = null;
      if (n.mesh) n.mesh.visible = false;
      this.drawn.delete(n); this.drawnKeys.delete(n.key);
      if (n.info) this.app.events?.emit?.('tile:remove', { tile: n.info });
    }
    const added = [];
    for (const n of next) if (!n.drawn) added.push(n);
    for (const n of added) {
      n.drawn = true;
      this.drawn.add(n); this.drawnKeys.add(n.key);
      // geomorph in when the tile replaces its parent that was on screen
      const p = n.parent;
      if (p && removed.has(p) && p.state === READY) { n.morphStart = this.time; n.morph = 0; }
      else { n.morph = 1; n.morphStart = -1; }
    }
    let busy = this._wanted > 0 || this.results.length > 0;
    const T = this.cfg.morphTime;
    for (const n of next) {
      n.lastDrawn = fno;
      const mesh = n.mesh;
      const merging = n.revFrame === fno;
      if (merging) { n.morph = n.revMorph; busy = true; }
      else {
        if (n.revMorph != null) { n.morph = n.revMorph; n.morphStart = this.time - n.revMorph * T; n.revMorph = null; }
        if (n.morph < 1) {
          n.morph = Math.min(1, (this.time - n.morphStart) / T);
          busy = true;
        }
      }
      const u = mesh.material.userData.trUniforms;
      const m = n.morph;
      u.uTrMorph.value = m * m * (3 - 2 * m);
      // stitch edges against a coarser displayed neighbour (geometry) — also selects the parent-texture
      // edge band in the material (texture LOD seams between levels)
      const e = u.uTrEdgeCoarse.value;
      if (n.level > 0) {
        const pr = n.ensureProbes();
        e.set(this._drawnAt(pr[0], n.level - 1), this._drawnAt(pr[1], n.level - 1), this._drawnAt(pr[2], n.level - 1), this._drawnAt(pr[3], n.level - 1));
      } else e.set(0, 0, 0, 0);
      const coarseEdge = e.x + e.y + e.z + e.w > 0;
      if ((m < 1 || coarseEdge) && n.parent && n.parent.state === READY && n.parent.tex) {
        const p = n.parent;
        u.uTrHasParent.value = 1;
        u.uTrParentMap.value = p.tex.albedo; u.uTrParentNormal.value = p.tex.normal;
        u.uTrParentXf.value.set((n.x & 1) * 0.5, (n.y & 1) * 0.5, 0.5, p.texRes);
        // a cheap chain first pass (chainTex) used as an edge-band / cross-fade source gets TEX_LOW (low priority)
        if (p.texRes < TEX_LOW && coarseEdge) this._requestUpgrade(p, TEX_LOW, 0);
      } else if (u.uTrHasParent.value) {
        u.uTrHasParent.value = 0; u.uTrParentMap.value = this.shared.grey; u.uTrParentNormal.value = this.shared.grey;
      }
      // floating origin
      mesh.position.set(n.ccx - origin.x, n.ccy - origin.y, n.ccz - origin.z);
      mesh.updateMatrix();
      mesh.visible = n.vis !== 2;          // behind the horizon: skip (frustum culling is three's)
      mesh.castShadow = n.level >= 9 && !this._noCast;
      // texture upgrade for leaves seen up close
      // texture resolution of displayed, visible leaves: 256² (the split criterion's texel), 512²
      // near the camera (max level with magnified texels, or within a few tile sizes of the eye)
      if (n.vis === 1 && n.dist && n.texRes < TEX_NEAR && !merging) {
        const leaf = n.sseRatio <= 1 || n.level >= MAX_LEVEL;   // not about to be replaced by children
        if (leaf) {
          const px256 = ((n.groundSize / TEX_FAR) * this._K) / n.dist;
          const near = px256 > this.cfg.upgradePx || n.dist < n.groundSize * this.cfg.nearTiles;
          const want = near ? TEX_NEAR : TEX_FAR;
          // progressive: a 128² first pass goes to 256² before 512² (4× cheaper, so the whole near field
          // sharpens one step within seconds instead of tile by tile at 512²)
          const step = n.texRes < TEX_FAR ? TEX_FAR : want;
          if (n.texRes < want && this._requestUpgrade(n, step, px256 * this._boost(n))) busy = true;
        }
      }
      // tiles built without the city (see tileBuilder urbanOk) are rebuilt a few times, 8 s apart
      if (n.degraded && n.upgradeJob && n.vis === 1) n.upgradeWant = fno;          // keep the rebuild alive
      if (n.degraded && n.vis === 1 && !n.upgradeJob && !merging && (n.degradedTries || 0) < 3 && this.time - (n.degradedAt || 0) > 8) {
        n.degradedTries = (n.degradedTries || 0) + 1; n.degradedAt = this.time;
        this._requestUpgrade(n, n.texRes, 1, true);
      }
    }
    for (const n of added) if (n.info) this.app.events?.emit?.('tile:add', { tile: n.info });
    this._busy = busy;
  }

  _drawnAt(p, level) {
    if (level < 0) return 0;
    const n = 1 << level;
    const x = Math.min(n - 1, Math.max(0, Math.floor((p.a + 1) * 0.5 * n)));
    const y = Math.min(n - 1, Math.max(0, Math.floor((p.b + 1) * 0.5 * n)));
    return this.drawnKeys.has(tileKey(p.face, level, x, y)) ? 1 : 0;
  }

  _cancelStale() {
    const lim = this.frameNo - this.cfg.staleFrames;
    const live = new Set();
    for (const n of this.loading) if (n.job && n.lastTouch >= lim) live.add(n.job);
    for (const n of [...this.loading]) {
      if (n.lastTouch < lim && n.job && !n.result) {
        const j = n.job; n.job = null; n.state = EMPTY; this.loading.delete(n);
        if (!live.has(j)) { try { j.cancel(); } catch { /* already done */ } this.stats.cancelled++; }
      }
    }
    // texture upgrades of tiles that are no longer wanted (left the cut, went off screen, were split):
    // otherwise they pile up at the back of the queue after every camera move, burn seconds of worker
    // time each on invisible tiles and keep app.isIdle() false
    const ulim = this.frameNo - Math.max(4, this.cfg.staleFrames >> 2);
    for (const n of [...this.upgrading]) {
      if (!n.upgradeJob) { this.upgrading.delete(n); continue; }
      if (n.upgradeResult || (n.upgradeWant ?? -1) >= ulim) continue;
      const j = n.upgradeJob; n.upgradeJob = null; this.upgrading.delete(n);
      try { j.cancel(); } catch { /* running or done */ }
      this.stats.upgradeCancelled = (this.stats.upgradeCancelled || 0) + 1;
    }
  }

  _evict() {
    const maxTiles = this.cfg.cacheTiles || 3000;
    if (this.gpuBytes < this.cfg.cacheBytes && this.ready.size < maxTiles) return;
    const fno = this.frameNo;
    const cand = [];
    for (const n of this.ready) {
      if (n.level === 0 || n.drawn || n.pinFrame === fno || n.lastTouch === fno) continue;
      cand.push(n);
    }
    cand.sort((a, b) => (a.lastDrawn - b.lastDrawn) || (b.level - a.level));
    for (const n of cand) {
      if (this.gpuBytes < this.cfg.cacheBytes * 0.9 && this.ready.size < maxTiles * 0.9) break;
      this._dispose(n);
      this.stats.evicted++;
    }
  }

  /**
   * Fix round 3 (memory): quadtree nodes were never pruned — every zoom to a new place left thousands of EMPTY Node
   * objects behind (~0.6 KB each, monotonic over a session). Drop child quads that are all EMPTY leaves (no job, no
   * result, not drawn, not in the camera chain) untouched for 600 frames; ensureChildren() recreates them on demand.
   */
  _prune() {
    const lim = this.frameNo - 600;
    const dead = (k) => k.state === EMPTY && !k.children && !k.job && !k.result && !k.upgradeJob && !k.upgradeResult &&
      !k.drawn && k.lastTouch < lim && (k.chainFrame ?? -1) < lim && !this.loading.has(k) && !this.ready.has(k);
    let pruned = 0;
    const visit = (n) => {
      if (!n.children) return;
      for (const k of n.children) visit(k);
      if (!n.split && n.children.every(dead)) { n.children = null; pruned += 4; }
    };
    for (const r of this.roots) visit(r);
    this.stats.pruned = (this.stats.pruned || 0) + pruned;
  }

  _dispose(n) {
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      n.mesh.material.dispose();
    }
    if (n.tex) { n.tex.albedo.dispose(); n.tex.normal.dispose(); n.tex.emission?.dispose(); }
    if (n.upgradeJob) { try { n.upgradeJob.cancel(); } catch { /* */ } n.upgradeJob = null; }
    this.upgrading.delete(n); n.upgradeResult = null;
    this.gpuBytes -= n.bytes;
    // fix round 3 (memory): consumers may still hold the tile object (water cache entries): mark it evicted and
    // drop the disposed mesh from it so a stale tile object no longer pins the geometry / material
    if (n.info) { n.info.evicted = true; n.info.mesh = null; }
    n.mesh = null; n.tex = null; n.info = null; n.positions = null; n.heights = null; n.water = null; n.rayBlocks = null;
    n.bytes = 0; n.state = EMPTY; n.split = false;
    this.ready.delete(n);
  }

  // -------------------------------------------------------------------------------------------
  // queries
  // -------------------------------------------------------------------------------------------
  isIdle() { return !this._busy; }

  heightAtLatLon(lat, lon) { const u = latLonToUnit(lat, lon); return heightAt(u.x, u.y, u.z, 0); }

  groundHeightCached() {
    if (this._groundFrame < 0) {
      const p = this.app.rig?.position;
      if (p) return this._sampleGround(p.x, p.y, p.z);
      return 0;
    }
    return this._ground;
  }

  /** ground height (m) at lat/lon from the finest loaded tile (falls back to the world function) */
  groundHeightAt(lat, lon) { const u = latLonToUnit(lat, lon); return this._sampleGround(u.x, u.y, u.z); }

  _deepestReady(x, y, z) {
    const f = vecToFace(x, y, z, _f);
    let node = this.roots[f.face];
    if (!node || node.state !== READY) return null;
    for (;;) {
      if (!node.children) break;
      const n = 1 << (node.level + 1);
      const cx = Math.min(n - 1, Math.max(0, Math.floor((f.a + 1) * 0.5 * n))) - node.x * 2;
      const cy = Math.min(n - 1, Math.max(0, Math.floor((f.b + 1) * 0.5 * n))) - node.y * 2;
      const k = node.children[cy * 2 + cx];
      if (!k || k.state !== READY) break;
      node = k;
    }
    return { node, face: f.face, a: f.a, b: f.b };
  }

  _sampleGround(x, y, z) {
    const r = Math.hypot(x, y, z) || 1;
    const ux = x / r, uy = y / r, uz = z / r;
    const hit = this._deepestReady(ux, uy, uz);
    if (!hit) return heightAt(ux, uy, uz, 50);
    const h = tileHeight(hit.node, hit.a, hit.b);
    // inside the coarse-tile datum region: the DRAWN ground (displayed leaf + shader shift), so props / camera
    // heights follow what is on screen while the chain under the camera refines
    const D = this.shared?.uniforms?.uTrDatum?.value;
    if (D && D.w > 0.5) {
      const shift = this.displayShift({ x: ux * (R + h), y: uy * (R + h), z: uz * (R + h) });
      if (shift !== 0) {
        const leaf = this._leafAt(hit.face, hit.a, hit.b);
        if (leaf && leaf.state === READY && leaf.heights) return tileHeight(leaf, hit.a, hit.b) + shift;
      }
    }
    return h;
  }

  /** displayed tile objects (same objects as in tile:add events) */
  drawnTiles() { const out = []; for (const n of this.drawn) if (n.info) out.push(n.info); return out; }
  getTile(key) { for (const n of this.drawn) if (n.key === key) return n.info; return null; }

  /** render-space position of grid vertex (i, j) of `tile` at height h (float64 maths) */
  tileGridPosition(tile, i, j, h, out = new THREE.Vector3()) {
    const b = tile.bounds;
    faceDir(tile.face, b.a0 + (b.a1 - b.a0) * i / N, b.b0 + (b.b1 - b.b0) * j / N, _q);
    const r = R + h;
    return out.set(_q.x * r - origin.x, _q.y * r - origin.y, _q.z * r - origin.z);
  }

  raycast(o, d) {
    const ox = o.x + origin.x, oy = o.y + origin.y, oz = o.z + origin.z;
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    const dx = d.x / dl, dy = d.y / dl, dz = d.z / dl;
    const cand = [];
    for (const n of this.drawn) {
      if (!n.positions) continue;
      const t = raySphere(n.bsx - ox, n.bsy - oy, n.bsz - oz, n.bsr, dx, dy, dz);
      if (t >= 0) cand.push([t, n]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    let best = Infinity, bestNode = null;
    for (const [tEntry, n] of cand) {
      if (tEntry > best) break;
      const t = raycastTile(n, ox - n.ccx, oy - n.ccy, oz - n.ccz, dx, dy, dz, best);
      if (t >= 0 && t < best) { best = t; bestNode = n; }
    }
    if (!bestNode) {
      // nothing loaded along the ray: intersect the mean surface sphere
      const rr = R;
      const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - rr * rr;
      const disc = b * b - c; if (disc < 0) return null;
      const t = -b - Math.sqrt(disc); if (t < 0) return null;
      best = t;
    }
    const ex = ox + dx * best, ey = oy + dy * best, ez = oz + dz * best;
    const ll = ecefToLatLonH(ex, ey, ez);
    return {
      distance: best, point: new THREE.Vector3(o.x + dx * best, o.y + dy * best, o.z + dz * best),
      ecef: { x: ex, y: ey, z: ez }, lat: ll.lat, lon: ll.lon, h: ll.h, tile: bestNode ? bestNode.info : null,
    };
  }

  /** diagnostics for the HUD / automation */
  debugStats() {
    const levels = {};
    let tris = 0;
    for (const n of this.drawn) { levels[n.level] = (levels[n.level] || 0) + 1; tris += N * N * 2 + 8 * N; }
    return {
      drawn: this.drawn.size, ready: this.ready.size, loading: this.loading.size, queued: this.results.length,
      gpuMB: Math.round(this.gpuBytes / 1048576), levels, tris, chain: this.chainInfo(), ...this.stats,
      avgBuildMs: this.stats.built ? Math.round(this.stats.buildMs / this.stats.built) : 0,
      buildByTex: Object.fromEntries(Object.entries(this.stats.byTex).map(([k, b]) => { const n = Math.max(1, b.n); return [k, { n: b.n, avgMs: Math.round(b.ms / n), maxMs: Math.round(b.max), slowest: b.maxKey, vertexMs: Math.round(b.vtx / n), texelMs: Math.round(b.tex / n), postMs: Math.round(b.post / n) }]; })),
      avgUploadMs: this.stats.uploads ? +(this.stats.uploadMs / this.stats.uploads).toFixed(2) : 0,
    };
  }

  dispose() {
    for (const n of [...this.ready]) this._dispose(n);
    this.app.scene.remove(this.group);
  }
}

const _q = {}, _f = {}, _fc = {};
